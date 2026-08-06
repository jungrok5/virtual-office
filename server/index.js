// Guild HQ 서버: 정적 서빙 + 수집(git 필수, API 보강) + 스냅샷/SSE + Q&A + evidence 목록.
// 프레임워크 없이 node:http만 사용. DEMO=1이면 가짜 데이터가 시나리오대로 재생된다.

import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFromGit } from './collect/git.js';
import { collectFromApi } from './collect/api.js';
import { buildState } from './state.js';
import { summarizeMember } from './summarize.js';
import { answerQuestion } from './ask.js';
import { buildDemoState } from './demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const config = JSON.parse(readFileSync(path.join(root, 'guild.config.json'), 'utf8'));

const DEMO = process.env.DEMO === '1';
const PORT = Number(process.env.PORT ?? config.port ?? 3000);
const pollSec = DEMO ? config.demoPollIntervalSec : config.pollIntervalSec;

let snapshot = null;
let prevShas = new Set();
const sseClients = new Set();

async function collect() {
  if (DEMO) {
    snapshot = buildDemoState();
    broadcast();
    return;
  }
  const git = await collectFromGit(root, config);
  const api = await collectFromApi(config.repo);
  const state = buildState({ git, api, config, prevShas });
  prevShas = new Set(state.shas);
  delete state.shas;

  for (const m of state.members) {
    const own = git.commits.filter((c) => (c.email || c.author).toLowerCase() === m.id);
    m.summary = await summarizeMember(m, own, config);
  }
  snapshot = state;
  broadcast();
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---- evidence: .guild/evidence/<branch>/ 의 manifest + 이미지 목록 ------
async function listEvidence() {
  const base = path.join(root, config.evidenceDir);
  if (!existsSync(base)) return [];
  const out = [];
  for (const branch of await readdir(base)) {
    const dir = path.join(base, branch);
    if (!(await stat(dir)).isDirectory()) continue;
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch { /* manifest 없이 이미지만 있어도 노출 */ }
    const files = (await readdir(dir)).filter((f) => /\.(png|jpg|jpeg|webp|svg)$/i.test(f));
    for (const file of files) {
      const meta = manifest?.screenshots?.find((s) => s.file === file);
      out.push({
        branch,
        file,
        url: `/evidence/${branch}/${file}`,
        caption: meta?.caption ?? file,
        createdAt: manifest?.createdAt ?? null,
        checks: manifest?.checks ?? null,
      });
    }
  }
  out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serveFile(res, filePath) {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}

// 경로 탈출 방지: base 밖으로 나가는 요청은 null
function safeJoin(base, rel) {
  const p = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/state') return json(res, 200, snapshot ?? { loading: true });

  if (url.pathname === '/api/evidence') return json(res, 200, await listEvidence());

  if (url.pathname === '/api/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body || '{}');
        if (!question || !snapshot) return json(res, 400, { error: 'question 필요 또는 수집 전' });
        json(res, 200, await answerQuestion(String(question).slice(0, 500), snapshot, config));
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    });
    return;
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (snapshot) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url.pathname.startsWith('/evidence/')) {
    const p = safeJoin(path.join(root, config.evidenceDir), url.pathname.slice('/evidence/'.length));
    return p ? serveFile(res, p) : (res.writeHead(404), res.end());
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const p = safeJoin(path.join(root, 'public'), rel);
  return p ? serveFile(res, p) : (res.writeHead(404), res.end());
});

server.listen(PORT, () => {
  console.log(`Guild HQ ${DEMO ? '(demo) ' : ''}→ http://localhost:${PORT}`);
  console.log(`repo: ${config.repo} · 폴링 ${pollSec}s`);
});

collect().catch((err) => console.error('[collect] 초기 수집 실패:', err.message));
setInterval(() => collect().catch((err) => console.error('[collect] 폴링 실패:', err.message)), pollSec * 1000);
