// 상태 모델: git/API 수집 결과를 하나의 스냅샷으로 조립한다.
// members(작성자 자동 발견) · quests(진행 중) · did(최근 완료) · stats · events(폴링 간 변화).

const DAY = 24 * 36e5;

function memberKey(c) {
  return (c.email || c.author || '').toLowerCase();
}

export function buildState({ git, api, config, now = new Date(), prevShas = new Set() }) {
  const commits = git.commits ?? [];

  // 작성자 자동 발견 — 사람/에이전트 구분 없이 커밋 작성자가 곧 멤버
  const membersMap = new Map();
  for (const c of commits) {
    const key = memberKey(c);
    if (!key) continue;
    const m = membersMap.get(key) ?? { id: key, name: c.author, lastPushAt: null, commitCount: 0 };
    m.commitCount++;
    if (!m.lastPushAt || c.date > m.lastPushAt) m.lastPushAt = c.date;
    membersMap.set(key, m);
  }
  const members = [...membersMap.values()]
    .sort((a, b) => (b.lastPushAt ?? '').localeCompare(a.lastPushAt ?? ''))
    .map((m) => ({
      ...m,
      working: m.lastPushAt && now - new Date(m.lastPushAt) < config.workingWindowHours * 36e5,
    }));

  // quests: PR이 보이면 PR, 아니면 기본 브랜치보다 앞선 피처 브랜치
  let quests;
  if (api?.pulls) {
    quests = api.pulls.map((pr) => ({
      id: `#${pr.number}`,
      title: pr.title,
      owner: pr.author,
      branch: pr.branch,
      updatedAt: pr.updatedAt,
      blocked: pr.ci === 'failing',
      ci: pr.ci,
      source: 'pr',
    }));
  } else {
    quests = (git.featureBranches ?? [])
      .filter((b) => b.aheadCount > 0)
      .map((b) => ({
        id: b.name,
        title: b.commits[0]?.subject ?? b.name,
        owner: b.commits[0]?.author ?? '',
        branch: b.name,
        updatedAt: b.lastCommitAt,
        blocked: false,
        ci: 'unknown',
        source: 'branch',
      }));
  }

  // did: 최근 24시간 커밋 + 머지된 PR
  const dayAgo = new Date(now - DAY).toISOString();
  const did = commits
    .filter((c) => c.date >= dayAgo)
    .slice(0, 20)
    .map((c) => ({ who: c.author, what: c.subject, at: c.date, sha: c.sha.slice(0, 7) }));
  for (const pr of api?.merged ?? []) {
    if (pr.mergedAt >= dayAgo) did.unshift({ who: pr.author, what: `${pr.title} 머지 🎉`, at: pr.mergedAt });
  }
  did.sort((a, b) => b.at.localeCompare(a.at));

  // events: 지난 폴링 이후 새로 나타난 커밋 → 씬 애니메이션 트리거
  const events = [];
  for (const c of commits) {
    if (!prevShas.has(c.sha)) {
      events.push({ type: 'push', who: c.author, msg: c.subject, branch: c.branch, at: c.date });
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  return {
    generatedAt: now.toISOString(),
    repo: config.repo,
    defaultBranch: git.defaultBranch,
    apiAvailable: Boolean(api),
    members,
    quests,
    did,
    stats: {
      commitsToday: commits.filter((c) => c.date >= dayAgo).length,
      quests: quests.length,
      blocked: quests.filter((q) => q.blocked).length,
      members: members.length,
    },
    events: prevShas.size === 0 ? [] : events.slice(-10), // 첫 수집은 전부 신규라 이벤트 생략
    shas: commits.map((c) => c.sha),
  };
}
