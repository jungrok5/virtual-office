// 현황 Q&A: 질문을 받아 현재 스냅샷을 근거로 답한다.
// ANTHROPIC_API_KEY가 있으면 Claude가 스냅샷(JSON)을 읽고 답하고, 없으면 규칙 기반으로 답한다.

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

function ruleBased(question, state) {
  const q = question.trim();
  const hit = state.members.find((m) => m.name && q.includes(m.name));
  if (hit) {
    const lines = [];
    lines.push(hit.working
      ? `${hit.name}은(는) 최근 ${state.config?.workingWindowHours ?? 2}시간 내 푸시가 있어 작업 중으로 보입니다.`
      : `${hit.name}의 마지막 푸시는 ${hit.lastPushAt ?? '기록 없음'}입니다.`);
    const mine = state.quests.filter((x) => x.owner === hit.name);
    mine.forEach((x) => lines.push(x.blocked
      ? `진행 중: ${x.title} — CI 실패로 막혀 있습니다.`
      : `진행 중: ${x.title} (${x.branch})`));
    const done = state.did.filter((d) => d.who === hit.name).slice(0, 3);
    if (done.length) lines.push(`최근 완료: ${done.map((d) => d.what).join(' / ')}`);
    return lines.join('\n');
  }
  if (/막|블록|왜|문제|불/.test(q)) {
    const b = state.quests.filter((x) => x.blocked);
    return b.length
      ? b.map((x) => `${x.title} (${x.owner}) — CI 실패로 막혀 있습니다.`).join('\n')
      : '지금 막혀 있는 작업은 없습니다.';
  }
  if (/오늘|했|완료|됐/.test(q)) {
    return state.did.length
      ? '최근 24시간 작업:\n' + state.did.slice(0, 8).map((d) => `· ${d.who} — ${d.what}`).join('\n')
      : '최근 24시간 내 완료된 작업이 없습니다.';
  }
  return `현재: 진행 중 ${state.stats.quests}건, 최근 24시간 커밋 ${state.stats.commitsToday}건, ` +
    `블록 ${state.stats.blocked}건, 활동 멤버 ${state.stats.members}명. 멤버 이름으로 물으면 개인 현황을 알려드립니다.`;
}

export async function answerQuestion(question, state, config) {
  const anthropic = await getClient();
  if (!anthropic) return { answer: ruleBased(question, state), engine: 'rules' };

  // 스냅샷에서 답변에 필요한 부분만 추려 컨텍스트로 전달
  const context = {
    repo: state.repo,
    generatedAt: state.generatedAt,
    members: state.members,
    quests: state.quests,
    did: state.did.slice(0, 20),
    stats: state.stats,
  };
  try {
    const res = await anthropic.messages.create({
      model: config.summary.model,
      max_tokens: 700,
      system:
        '너는 개발팀 현황판 "Guild HQ"의 안내원이다. 아래 JSON은 지금 이 순간의 팀 작업 스냅샷이다. ' +
        '질문에 스냅샷 데이터만 근거로 한국어로 간결하게 답한다. 스냅샷에 없는 내용은 모른다고 답한다. ' +
        '날짜는 상대 시간(예: 3시간 전)으로 풀어서 말한다.\n\n' + JSON.stringify(context),
      messages: [{ role: 'user', content: question }],
    });
    if (res.stop_reason === 'refusal') return { answer: ruleBased(question, state), engine: 'rules' };
    const text = res.content.find((b) => b.type === 'text')?.text?.trim();
    return text ? { answer: text, engine: 'claude' } : { answer: ruleBased(question, state), engine: 'rules' };
  } catch (err) {
    console.error('[ask] Claude 응답 실패, 규칙 기반 폴백:', err.message);
    return { answer: ruleBased(question, state), engine: 'rules' };
  }
}
