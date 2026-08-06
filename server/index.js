// Guild HQ 서버: 정적 서빙 + 수집(git 필수, API 보강) + 스냅샷/SSE + Q&A + evidence 목록.
// 프레임워크 없이 node:http만 사용. DEMO=1이면 가짜 데이터가 시나리오대로 재생된다.

import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFromGit } from './collect/git.js';
import { collectFromApi } from './collect/api.js';
import { buildState } from './state.js';
import { summarizeMember } from './summarize.js';
import { answerQuestion } from './ask.js';
import { buildDemoState } from './demo.js';
import { listEvidence } from './evidence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const config = JSON.parse(readFileSync(path.join(root, 'guild.config.json'), 'utf8'));

const DEMO = process.env.DEMO === '1';
const PORT = Number(process.env.PORT ?? config.port ?? 3000);
// 기본은 루프백에만 바인딩 — 외부 개방은 HOST=0.0.0.0 명시 + 가급적 GUILD_AUTH_TOKEN과 함께
const HOST = process.env.HOST ?? '127.0.0.1';
const AUTH_TOKEN = process.env.GUILD_AUTH_TOKEN || null;
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

const evidenceBase = path.join(root, config.evidenceDir);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(body));
}

// ---- 접근 제어: GUILD_AUTH_TOKEN이 설정된 경우에만 활성화 ----------------
function tokenEqual(a, b) {
  if (!a || !b) return false;
  // 길이 차이로 인한 예외·타이밍 편차를 없애기 위해 해시끼리 비교
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
function authorized(req, url) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ') && tokenEqual(header.slice(7), AUTH_TOKEN)) return true;
  if (tokenEqual(url.searchParams.get('token'), AUTH_TOKEN)) return true;
  const cookies = (req.headers.cookie ?? '').split(';').map((c) => c.trim());
  return cookies.some((c) => c.startsWith('guild_token=') && tokenEqual(c.slice('guild_token='.length), AUTH_TOKEN));
}

async function serveFile(res, filePath, extraHeaders = {}) {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      ...extraHeaders,
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}

// 경로 탈출 방지: base 밖으로 나가는 요청은 null (형제 디렉터리 프리픽스까지 차단)
function safeJoin(base, rel) {
  const p = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  return p.startsWith(base + path.sep) ? p : null;
}

// LLM 호출은 비싸다(구독/크레딧) — 동시 실행을 제한해 비용·리소스 소진을 막는다
let askInFlight = 0;
const ASK_MAX_CONCURRENT = 2;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!authorized(req, url)) {
    return json(res, 401, { error: '인증 필요 — Authorization: Bearer <GUILD_AUTH_TOKEN> 또는 ?token=' });
  }

  if (url.pathname === '/api/state') return json(res, 200, snapshot ?? { loading: true });

  if (url.pathname === '/api/evidence') return json(res, 200, await listEvidence(evidenceBase));

  if (url.pathname === '/api/ask' && req.method === 'POST') {
    if (askInFlight >= ASK_MAX_CONCURRENT) {
      return json(res, 429, { error: '질문 처리 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      askInFlight++;
      try {
        const { question } = JSON.parse(body || '{}');
        if (!question || !snapshot) return json(res, 400, { error: '질문이 비었거나 아직 수집 전입니다.' });
        json(res, 200, await answerQuestion(String(question).slice(0, 500), snapshot, config));
      } catch (err) {
        console.error('[ask] 처리 실패:', err.message);
        json(res, 500, { error: '질문 처리에 실패했습니다.' });
      } finally {
        askInFlight--;
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
  // ?token=으로 첫 진입한 브라우저에는 쿠키를 심어 이후 fetch가 자동 인증되게 한다
  const headers = AUTH_TOKEN && tokenEqual(url.searchParams.get('token'), AUTH_TOKEN)
    ? { 'Set-Cookie': `guild_token=${AUTH_TOKEN}; HttpOnly; SameSite=Strict; Path=/` }
    : {};
  return p ? serveFile(res, p, headers) : (res.writeHead(404), res.end());
});

server.listen(PORT, HOST, () => {
  console.log(`Guild HQ ${DEMO ? '(demo) ' : ''}→ http://${HOST}:${PORT}`);
  console.log(`repo: ${config.repo} · 폴링 ${pollSec}s · 인증 ${AUTH_TOKEN ? '켜짐' : '꺼짐'}`);
  if (HOST !== '127.0.0.1' && !AUTH_TOKEN) {
    console.warn('⚠ 외부 인터페이스에 인증 없이 바인딩되어 있습니다 — GUILD_AUTH_TOKEN 설정을 권장합니다.');
  }
});

collect().catch((err) => console.error('[collect] 초기 수집 실패:', err.message));
setInterval(() => collect().catch((err) => console.error('[collect] 폴링 실패:', err.message)), pollSec * 1000);
