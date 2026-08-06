// virtual-office 서버: 정적 서빙 + GitHub 폴링 + 상태/요약 계산 + SSE 브로드캐스트.
// 프레임워크 없이 node:http만 사용한다. DEMO=1이면 가짜 데이터로 동작.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchRecentCommits, fetchCommitFiles, groupByMember } from './github.js';
import { computeStatus, classifyFiles } from './state.js';
import { summarizeMember } from './summarize.js';
import { buildDemoData } from './demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const config = JSON.parse(readFileSync(path.join(root, 'office.config.json'), 'utf8'));

const DEMO = process.env.DEMO === '1';
const members = DEMO ? config.demoMembers : config.members;
const PORT = Number(process.env.PORT ?? config.port ?? 3000);

let snapshot = { generatedAt: null, demo: DEMO, members: [] };
const sseClients = new Set();

async function collect() {
  let commitsByMember;
  let filesByMember;

  if (DEMO) {
    ({ commitsByMember, filesByMember } = buildDemoData(members));
  } else {
    const commits = await fetchRecentCommits(config.repo, config.branch);
    commitsByMember = groupByMember(commits, members);
    filesByMember = new Map();
    for (const member of members) {
      const own = commitsByMember.get(member.id) ?? [];
      const files = [];
      // 최근 커밋 몇 개만 상세 조회 (API 호출 절약, sha 단위 캐시됨)
      for (const c of own.slice(0, 5)) {
        try {
          files.push(...(await fetchCommitFiles(config.repo, c.sha)));
        } catch (err) {
          console.error(`[collect] 커밋 상세 조회 실패 ${c.sha}:`, err.message);
        }
      }
      filesByMember.set(member.id, files);
    }
  }

  const result = [];
  for (const member of members) {
    const commits = commitsByMember.get(member.id) ?? [];
    const files = filesByMember.get(member.id) ?? [];
    const lastPushAt = commits[0]?.date ?? null;
    const status = computeStatus(lastPushAt, config.thresholds);
    const summary = await summarizeMember(member, commits, files, config);
    result.push({
      id: member.id,
      name: member.name,
      role: member.role,
      status,
      lastPushAt,
      summary,
      commits: commits.slice(0, 8).map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.message.split('\n')[0],
        date: c.date,
      })),
      fileStats: classifyFiles(files.map((f) => f.filename)),
    });
  }

  snapshot = { generatedAt: new Date().toISOString(), demo: DEMO, members: result };
  broadcast();
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(snapshot));
    return;
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 정적 파일 (public/) — 경로 탈출 방지
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(root, 'public', path.normalize(rel));
  if (!filePath.startsWith(path.join(root, 'public')) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end('Internal Error');
  }
});

server.listen(PORT, () => {
  console.log(`virtual-office ${DEMO ? '(demo mode) ' : ''}→ http://localhost:${PORT}`);
  console.log(`repo: ${config.repo} · 팀원 ${members.length}명 · 폴링 ${config.pollIntervalSec}s`);
});

collect().catch((err) => console.error('[collect] 초기 수집 실패:', err.message));
setInterval(() => {
  collect().catch((err) => console.error('[collect] 폴링 실패:', err.message));
}, config.pollIntervalSec * 1000);
