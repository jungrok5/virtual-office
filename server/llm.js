// LLM 백엔드 자동 선택 — 우선순위:
//   1. api  : ANTHROPIC_API_KEY가 있으면 Anthropic API (팀/서버 배포용)
//   2. cli  : claude CLI가 설치·로그인되어 있으면 `claude -p` 헤드리스 호출
//             → Claude Pro/Max 구독으로 동작, API 키 불필요
//   3. rules: 둘 다 없으면 null 반환 → 호출측이 규칙 기반 폴백
// GUILD_LLM=api|cli|rules 로 강제 지정 가능.
//
// 보안: CLI 호출은 --tools "" 로 도구를 완전 비활성화한다 — 프롬프트에 섞인
// 신뢰할 수 없는 데이터(커밋 메시지 등)가 파일 읽기 등을 유발하지 못하게 한다.
// 프롬프트는 argv가 아닌 stdin으로 전달한다 (ps 노출 방지).

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
let mode; // 'api' | 'cli' | null (undefined = 미탐지)
let sdkClient = null;

async function detect() {
  if (mode !== undefined) return mode;
  const forced = process.env.GUILD_LLM;
  if (forced === 'rules') return (mode = null);

  if (forced !== 'cli' && process.env.ANTHROPIC_API_KEY) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      sdkClient = new Anthropic();
      console.log('[llm] Anthropic API 모드');
      return (mode = 'api');
    } catch { /* SDK 미설치 → 다음 후보 */ }
  }
  if (forced !== 'api') {
    try {
      await run('claude', ['--version'], { timeout: 15000 });
      console.log('[llm] claude CLI 모드 (구독 사용, API 키 불필요, 도구 비활성)');
      return (mode = 'cli');
    } catch { /* CLI 없음 */ }
  }
  console.log('[llm] 규칙 기반 모드 (LLM 없음)');
  return (mode = null);
}

export async function llmMode() {
  return (await detect()) ?? 'rules';
}

function runCli(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI 타임아웃 (${timeoutMs}ms)`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.split('\n')[0] || `CLI 종료 코드 ${code}`));
    });
    child.stdin.end(input);
  });
}

// 텍스트 완성 한 번. 실패·불가 시 null → 호출측이 폴백한다.
export async function complete({ system, prompt, model, maxTokens = 700 }) {
  const m = await detect();
  try {
    if (m === 'api') {
      const res = await sdkClient.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (res.stop_reason === 'refusal') return null;
      return res.content.find((b) => b.type === 'text')?.text?.trim() || null;
    }
    if (m === 'cli') {
      // 모델은 CLI 로그인 계정의 기본값을 쓴다 (플랜별 가용 모델이 달라 강제하지 않는다).
      const text = `[지시]\n${system}\n\n[입력]\n${prompt}`;
      const out = await runCli(['-p', '--output-format', 'text', '--tools', ''], text, 120000);
      return out.trim() || null;
    }
  } catch (err) {
    console.error(`[llm] ${m} 호출 실패:`, err.message.split('\n')[0]);
  }
  return null;
}
