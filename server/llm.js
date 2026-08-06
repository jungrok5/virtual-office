// LLM 백엔드 자동 선택 — 우선순위:
//   1. api  : ANTHROPIC_API_KEY가 있으면 Anthropic API (팀/서버 배포용)
//   2. cli  : claude CLI가 설치·로그인되어 있으면 `claude -p` 헤드리스 호출
//             → Claude Pro/Max 구독으로 동작, API 키 불필요
//   3. rules: 둘 다 없으면 null 반환 → 호출측이 규칙 기반 폴백
// GUILD_LLM=api|cli|rules 로 강제 지정 가능.

import { execFile } from 'node:child_process';
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
      console.log('[llm] claude CLI 모드 (구독 사용, API 키 불필요)');
      return (mode = 'cli');
    } catch { /* CLI 없음 */ }
  }
  console.log('[llm] 규칙 기반 모드 (LLM 없음)');
  return (mode = null);
}

export async function llmMode() {
  return (await detect()) ?? 'rules';
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
      // 시스템 지시를 프롬프트에 합쳐 전달. 모델은 CLI 로그인 계정의 기본값을 쓴다
      // (구독 플랜마다 쓸 수 있는 모델이 달라 강제하지 않는다).
      const text = `[지시]\n${system}\n\n[입력]\n${prompt}`;
      const { stdout } = await run('claude', ['-p', text, '--output-format', 'text'],
        { timeout: 120000, maxBuffer: 1024 * 1024 });
      return stdout.trim() || null;
    }
  } catch (err) {
    console.error(`[llm] ${m} 호출 실패:`, err.message.split('\n')[0]);
  }
  return null;
}
