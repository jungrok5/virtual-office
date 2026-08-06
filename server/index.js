// Guild HQ 서버: 정적 서빙 + 수집(git 필수, API 보강) + 스냅샷/SSE + Q&A + evidence 목록.
// 프레임워크 없이 node:http만 사용. DEMO=1이면 가짜 데이터가 시나리오대로 재생된다.

import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
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
    const own = git.commits.filter((c) => (c.author || c.email).toLowerCase() === m.id);
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
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

// 심층 방어 보안 헤더. script-src를 self+wasm으로 제한해(WebLLM은 자체 호스팅) 인젝션 시
// 임의 JS 실행을 막고, object/base/frame을 차단한다.
// connect/img는 온디바이스 LLM 모델 가중치·WASM 커널 다운로드를 위해 https 허용(데이터).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self' https: data: blob:",
  ].join('; '),
};

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extraHeaders });
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
      ...SECURITY_HEADERS,
      ...extraHeaders,
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}

// 경로 탈출 방지: base 밖으로 나가는 요청은 null (형제 디렉터리 프리픽스까지 차단)
// 문자열 검사만으로는 심볼릭 링크 탈출을 못 막는다 — 링크가 가능한 경로엔 realpath 검사를 함께 쓴다.
function safeJoin(base, rel) {
  const p = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  return p.startsWith(base + path.sep) ? p : null;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return null; } // 잘못된 %인코딩
}

// 심링크까지 해석한 실제 경로가 base 안에 있는지 확인 (evidence 등 외부 기여 가능 경로용)
async function realPathInside(base, target) {
  try {
    const [rb, rt] = await Promise.all([realpath(base), realpath(target)]);
    return rt === rb || rt.startsWith(rb + path.sep) ? rt : null;
  } catch {
    return null; // 존재하지 않거나 접근 불가
  }
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
    // 카운터를 '수락 시점'에 즉시 증가시킨다 — 본문 수신 완료(end) 시점에 증가하면
    // slow-body 요청 다수가 체크를 동시에 통과해 동시성 제한을 우회할 수 있다.
    if (askInFlight >= ASK_MAX_CONCURRENT) {
      return json(res, 429, { error: '질문 처리 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    askInFlight++;
    let done = false;
    const release = () => { if (!done) { done = true; askInFlight--; } };
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('close', release); // 클라이언트 중단(slow-body 후 끊기 등)에도 반드시 반환
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body || '{}');
        if (!question || !snapshot) return json(res, 400, { error: '질문이 비었거나 아직 수집 전입니다.' });
        json(res, 200, await answerQuestion(String(question).slice(0, 500), snapshot, config));
      } catch (err) {
        console.error('[ask] 처리 실패:', err.message);
        json(res, 500, { error: '질문 처리에 실패했습니다.' });
      } finally {
        release();
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
    const rel = safeDecode(url.pathname.slice('/evidence/'.length));
    const p = rel === null ? null : safeJoin(evidenceBase, rel);
    // 문자열 검사 통과 후 심링크 실경로까지 base 안인지 확인 (커밋된 심링크로 서버 파일 유출 차단)
    const real = p ? await realPathInside(evidenceBase, p) : null;
    return real ? serveFile(res, real) : (res.writeHead(404), res.end());
  }

  const decoded = url.pathname === '/' ? 'index.html' : safeDecode(url.pathname.slice(1));
  const p = decoded === null ? null : safeJoin(path.join(root, 'public'), decoded);
  // ?token=으로 첫 진입한 브라우저에는 쿠키를 심어 이후 fetch가 자동 인증되게 한다.
  // HTTPS(프록시 뒤 포함)면 Secure를 붙여 평문 전송을 막는다.
  const isHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const headers = AUTH_TOKEN && tokenEqual(url.searchParams.get('token'), AUTH_TOKEN)
    ? { 'Set-Cookie': `guild_token=${AUTH_TOKEN}; HttpOnly; SameSite=Strict; Path=/${isHttps ? '; Secure' : ''}` }
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
