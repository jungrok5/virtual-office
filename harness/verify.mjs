// 구현 검증 하네스: 서버를 띄우고 Playwright로 실제 화면을 확인한다.
// 결과 스크린샷과 체크 리스트를 .guild/evidence/<브랜치>/에 남긴다 — 이 폴더는 커밋 대상이다.
// 사용: node harness/verify.mjs        (데모 + 라이브 모두 검증)
//       node harness/verify.mjs --demo-only

import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const branch = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
  .toString().trim().replace(/[^\w.-]+/g, '-');
const outDir = path.join(root, '.guild', 'evidence', branch);

const checks = [];
const screenshots = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function startServer(env, port) {
  const child = spawn('node', ['server/index.js'], {
    cwd: root, env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return child;
}

async function waitForState(port, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://localhost:${port}/api/state`);
      const body = await res.json();
      if (res.ok && !body.loading) return body;
    } catch { /* 서버 기동 대기 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 준비되지 않음 (port ${port})`);
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

async function shot(page, file, caption) {
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
  screenshots.push({ file, caption });
  console.log(`📸 ${file} — ${caption}`);
}

async function verifyDemo(browser) {
  const port = 4173;
  const server = startServer({ DEMO: '1' }, port);
  try {
    await waitForState(port);
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(`http://localhost:${port}/`);

    check('데모: 페이지 타이틀', (await page.title()) === 'Guild HQ');
    await page.waitForSelector('#doing .card', { timeout: 10000 });
    const cards = await page.locator('#doing .card').count();
    check('데모: 퀘스트 카드 렌더링', cards > 0, `${cards}장`);
    const commitChip = await page.locator('#c-commits').textContent();
    check('데모: 통계 칩 채워짐', commitChip !== '–', `24h 커밋 ${commitChip}`);

    // 씬 이벤트가 최소 한 번 재생될 때까지 (데모 폴링 5초)
    await page.waitForSelector('#ticker div', { timeout: 15000 });
    check('데모: 이벤트 티커 동작', true);

    // Q&A 왕복
    await page.fill('#ask-input', '오늘 뭐 됐어?');
    await page.click('#ask-form button');
    // LLM 백엔드(API/CLI)에 따라 응답이 수십 초 걸릴 수 있다
    await page.waitForFunction(() => document.querySelectorAll('#chat .msg.bot').length >= 2, null, { timeout: 90000 });
    const answer = await page.locator('#chat .msg.bot').last().textContent();
    check('데모: Q&A 응답', Boolean(answer?.trim()), answer.slice(0, 60));

    await shot(page, 'demo-office.png', '데모 모드 전체 화면 — 씬·퀘스트 보드·Q&A 응답');
    await page.close();
  } finally {
    server.kill();
  }
}

async function verifyLive(browser) {
  const port = 4174;
  const server = startServer({ DEMO: '0' }, port);
  try {
    const state = await waitForState(port, 60000);
    check('라이브: git 수집 성공', state.members?.length >= 1, `멤버 ${state.members?.length}명, 퀘스트 ${state.quests?.length}건`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => document.getElementById('c-members').textContent !== '–', null, { timeout: 10000 });
    await shot(page, 'live-office.png', `라이브 — ${state.repo} 실데이터 (${state.apiAvailable ? 'git+API' : 'git 수집'})`);
    await page.close();
  } finally {
    server.kill();
  }
}

// 정적 스냅샷 모드: build-static 산출물을 파일 서버로 띄워 검증한다 (Pages 배포와 동일 조건)
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
function serveDir(dir, port) {
  const srv = http.createServer(async (req, res) => {
    const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0].slice(1));
    try {
      const body = await readFile(path.join(dir, rel));
      res.writeHead(200, { 'Content-Type': STATIC_MIME[path.extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

async function verifyStatic(browser) {
  execFileSync('node', ['scripts/build-static.mjs'], { cwd: root, stdio: 'inherit' });
  const srv = await serveDir(path.join(root, 'dist'), 4175);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // 모바일 뷰포트
    await page.goto('http://localhost:4175/');
    await page.waitForFunction(() => document.getElementById('c-members').textContent !== '–', null, { timeout: 15000 });
    const label = await page.locator('#repo-label').textContent();
    check('정적: 스냅샷 모드 감지', label.includes('정적 스냅샷'), label);
    check('정적: WebLLM 버튼 노출', await page.locator('#llm-row').isVisible());
    // 자체 호스팅 web-llm 번들이 CSP(script-src 'self') 하에서 로드되고 export를 노출하는지
    const vendorOk = await page.evaluate(async () => {
      try {
        const m = await import('./vendor/web-llm-0.2.84.mjs');
        return typeof m.CreateMLCEngine === 'function' && Array.isArray(m.prebuiltAppConfig?.model_list);
      } catch (e) { return 'ERR:' + (e.message || e); }
    });
    check('정적: 자체 호스팅 WebLLM 번들 로드', vendorOk === true, String(vendorOk));
    // 클라이언트 규칙 기반 Q&A (LLM 미로드 상태)
    await page.fill('#ask-input', '오늘 뭐 했어?');
    await page.click('#ask-form button');
    await page.waitForFunction(() => document.querySelectorAll('#chat .msg.bot').length >= 2, null, { timeout: 10000 });
    const ans = await page.locator('#chat .msg.bot').last().textContent();
    check('정적: 클라이언트 Q&A 응답', Boolean(ans?.trim()), ans.slice(0, 50));
    await shot(page, 'static-mobile.png', '정적 스냅샷 모드 — 모바일(390px) 뷰, 서버 없이 state.json 렌더링');

    // 동작 원리·설계 문서 페이지
    await page.goto('http://localhost:4175/about.html');
    check('정적: 설계 문서 페이지', (await page.title()).includes('동작 원리'));
    check('정적: 문서→대시보드 링크', await page.locator('a.back[href="./"]').first().isVisible());
    await shot(page, 'about-page.png', '동작 원리·설계 문서 페이지 (모바일 뷰)');
    await page.close();
  } finally {
    srv.close();
  }
}

const demoOnly = process.argv.includes('--demo-only');
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await launchBrowser();
try {
  await verifyDemo(browser);
  if (!demoOnly) {
    await verifyLive(browser);
    await verifyStatic(browser);
  }
} finally {
  await browser.close();
}

await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({
  branch,
  createdAt: new Date().toISOString(),
  screenshots,
  checks,
}, null, 2));

const failed = checks.filter((c) => !c.pass);
console.log(`\n결과: ${checks.length - failed.length}/${checks.length} 통과 → ${path.relative(root, outDir)}/`);
process.exit(failed.length ? 1 : 0);
