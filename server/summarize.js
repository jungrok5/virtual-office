// 작업 요약: 멤버별 최근 커밋을 한 줄 한국어로 요약한다.
// ANTHROPIC_API_KEY가 없으면 규칙 기반 폴백 — 키 없이도 전체 앱이 동작한다.

const cache = new Map(); // memberId → { sha, summary }
let client = null;
let sdkUnavailable = false;

async function getClient() {
  if (!process.env.ANTHROPIC_API_KEY || sdkUnavailable) return null;
  if (client) return client;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
    return client;
  } catch {
    sdkUnavailable = true;
    return null;
  }
}

function ruleBased(commits) {
  if (commits.length === 0) return '최근 활동 없음';
  const first = commits[0].subject;
  return commits.length === 1 ? first : `${first} 외 ${commits.length - 1}건`;
}

export async function summarizeMember(member, commits, config) {
  if (commits.length === 0) return ruleBased(commits);
  const latestSha = commits[0].sha;
  const cached = cache.get(member.id);
  if (cached && cached.sha === latestSha) return cached.summary;

  let summary = ruleBased(commits);
  const anthropic = await getClient();
  if (anthropic) {
    try {
      const list = commits
        .slice(0, config.summary.maxCommits)
        .map((c) => `- [${c.branch}] ${c.subject} (${c.date})`)
        .join('\n');
      const res = await anthropic.messages.create({
        model: config.summary.model,
        max_tokens: 300,
        system:
          '팀 현황판의 요약가다. 한 팀원의 최근 깃 커밋 목록을 보고 무슨 작업을 하는지 ' +
          '한국어 한 문장(40자 이내)으로 요약한다. 요약 문장만 출력한다.',
        messages: [{ role: 'user', content: `팀원: ${member.name}\n\n최근 커밋:\n${list}` }],
      });
      if (res.stop_reason !== 'refusal') {
        const text = res.content.find((b) => b.type === 'text')?.text?.trim();
        if (text) summary = text;
      }
    } catch (err) {
      console.error(`[summarize] ${member.name} 요약 실패, 폴백 사용:`, err.message);
    }
  }
  cache.set(member.id, { sha: latestSha, summary });
  return summary;
}
