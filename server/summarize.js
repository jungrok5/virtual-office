// AI 작업 요약: 커밋 메시지 + 변경 파일 성격을 Claude에게 넘겨 2~3문장 요약을 만든다.
// ANTHROPIC_API_KEY가 없으면 규칙 기반 요약으로 폴백 — 키 없이도 전체 앱이 동작한다.

import { classifyFiles, categoryLabel } from './state.js';

const cache = new Map(); // memberId → { sha, summary }
let anthropicClient = null;
let sdkUnavailable = false;

async function getClient() {
  if (!process.env.ANTHROPIC_API_KEY || sdkUnavailable) return null;
  if (anthropicClient) return anthropicClient;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic();
    return anthropicClient;
  } catch {
    // npm install 전이거나 SDK 미설치 — 규칙 기반 폴백으로 진행
    sdkUnavailable = true;
    return null;
  }
}

function ruleBasedSummary(member, commits, fileStats) {
  if (commits.length === 0) return `${member.name}님의 최근 푸시 기록이 없습니다.`;
  const firstLine = commits[0].message.split('\n')[0];
  const parts = Object.entries(fileStats)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${categoryLabel(key)} ${n}건`);
  const fileDesc = parts.length ? ` (변경: ${parts.join(', ')})` : '';
  return `최근 커밋 ${commits.length}개 — "${firstLine}" 등의 작업을 진행했습니다${fileDesc}.`;
}

export async function summarizeMember(member, commits, files, config) {
  if (commits.length === 0) return ruleBasedSummary(member, commits, {});
  const latestSha = commits[0].sha;
  const cached = cache.get(member.id);
  if (cached && cached.sha === latestSha) return cached.summary;

  const fileStats = classifyFiles(files.map((f) => f.filename));
  let summary = ruleBasedSummary(member, commits, fileStats);

  const client = await getClient();
  if (client) {
    try {
      const commitList = commits
        .slice(0, config.summary.maxCommits)
        .map((c) => `- ${c.message.split('\n')[0]} (${c.date})`)
        .join('\n');
      const fileList = files.slice(0, 40).map((f) => f.filename).join(', ');
      const response = await client.messages.create({
        model: config.summary.model,
        max_tokens: 1024,
        system:
          '너는 팀 가상 오피스의 안내원이다. 한 팀원의 최근 깃 커밋과 변경 파일을 보고, ' +
          '동료들이 작업 맥락을 파악할 수 있도록 한국어 2~3문장으로 친근하게 요약한다. ' +
          '파일 확장자로 직군(코드/아트/기획 문서)을 추론해 반영한다. 요약 문장만 출력한다.',
        messages: [
          {
            role: 'user',
            content:
              `팀원: ${member.name} (${member.role})\n\n최근 커밋:\n${commitList}\n\n` +
              `변경 파일: ${fileList || '(정보 없음)'}`,
          },
        ],
      });
      if (response.stop_reason !== 'refusal') {
        const text = response.content.find((b) => b.type === 'text')?.text?.trim();
        if (text) summary = text;
      }
    } catch (err) {
      console.error(`[summarize] ${member.id} API 요약 실패, 폴백 사용:`, err.message);
    }
  }

  cache.set(member.id, { sha: latestSha, summary });
  return summary;
}
