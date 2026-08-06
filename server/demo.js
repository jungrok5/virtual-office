// 데모 모드: 실제 리포 없이 스냅샷 형태 그대로 가짜 데이터를 만든다.
// 폴링마다 시나리오 이벤트를 하나씩 재생해 씬이 살아있게 한다.

const MEMBERS = ['지훈', '수민', '태오', '하나'];

const SCRIPT = [
  { type: 'push', who: '지훈', msg: '인벤토리 정렬 스냅 로직' },
  { type: 'push', who: '수민', msg: '스킬 계수 재조정' },
  { type: 'ci_fail', who: '수민', quest: '#214 전투 밸런스 패치 시즌2' },
  { type: 'push', who: '태오', msg: '세션 토큰 만료 처리' },
  { type: 'push', who: '하나', msg: '튜토리얼 스킵 A/B 플래그' },
  { type: 'push', who: '수민', msg: '깨진 테스트 픽스처 갱신' },
  { type: 'ci_pass', who: '수민', quest: '#214 전투 밸런스 패치 시즌2' },
  { type: 'merge', who: '태오', quest: '#219 로그인 서버 리팩터' },
];

let step = 0;
let blocked214 = false;
let merged219 = false;

export function buildDemoState(now = new Date()) {
  const ev = SCRIPT[step % SCRIPT.length];
  step++;
  if (ev.type === 'ci_fail') blocked214 = true;
  if (ev.type === 'ci_pass') blocked214 = false;
  if (ev.type === 'merge') merged219 = true;
  if (step % SCRIPT.length === 0) merged219 = false; // 루프 재시작

  const iso = (minAgo) => new Date(now - minAgo * 60e3).toISOString();
  const quests = [
    { id: '#214', title: '전투 밸런스 패치 시즌2', owner: '수민', branch: 'feature/balance-s2', updatedAt: iso(12), blocked: blocked214, ci: blocked214 ? 'failing' : 'passing', source: 'pr' },
    { id: '#217', title: '인벤토리 드래그 정렬', owner: '지훈', branch: 'feature/inv-drag', updatedAt: iso(35), blocked: false, ci: 'passing', source: 'pr' },
  ];
  if (!merged219) {
    quests.push({ id: '#219', title: '로그인 서버 리팩터', owner: '태오', branch: 'refactor/login', updatedAt: iso(70), blocked: false, ci: 'running', source: 'pr' });
  }

  const did = [
    { who: '하나', what: '튜토리얼 이탈 구간 로그 추가', at: iso(90) },
    { who: '지훈', what: '상점 UI 겹침 버그 수정', at: iso(200) },
  ];
  if (merged219) did.unshift({ who: '태오', what: '로그인 서버 리팩터 머지 🎉', at: iso(1) });

  const events = ev.type === 'push'
    ? [{ type: 'push', who: ev.who, msg: ev.msg, branch: 'demo', at: now.toISOString() }]
    : [{ type: ev.type, who: ev.who, msg: ev.quest, branch: 'demo', at: now.toISOString() }];

  return {
    generatedAt: now.toISOString(),
    repo: 'demo/guild-hq',
    defaultBranch: 'main',
    apiAvailable: true,
    demo: true,
    members: MEMBERS.map((name, i) => ({
      id: name,
      name,
      lastPushAt: iso(10 + i * 47),
      commitCount: 9 - i,
      working: i < 2 || ev.who === name,
      summary: ['인벤토리 UX 개선 작업', '시즌2 밸런스 튜닝', '로그인 서버 구조 정리', '튜토리얼 지표 계측'][i],
    })),
    quests,
    did,
    stats: { commitsToday: 7 + (step % 5), quests: quests.length, blocked: blocked214 ? 1 : 0, members: 4 },
    events,
    shas: [],
  };
}
