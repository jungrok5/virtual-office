// 데모 모드: 토큰·실제 레포 없이도 오피스가 돌아가도록 가짜 커밋을 생성한다.
// 팀원마다 마지막 푸시 시각을 다르게 주어 근무/자리비움/퇴근 상태가 모두 보이게 한다.

const DEMO_COMMITS = {
  dev1: {
    hoursAgo: 0.4,
    commits: [
      { message: 'feat: 오피스 캔버스 클릭 판정 추가', files: ['public/office.js', 'public/sprites.js'] },
      { message: 'fix: SSE 재접속 시 상태 중복 수신 수정', files: ['server/index.js'] },
      { message: 'chore: 폴링 주기 설정값으로 분리', files: ['office.config.json', 'server/index.js'] },
    ],
  },
  art1: {
    hoursAgo: 1.2,
    commits: [
      { message: 'art: 전투 씬 UI 버튼 에셋 2차 업데이트', files: ['assets/ui/battle_btn.png', 'assets/ui/battle_btn.psd'] },
      { message: 'art: 캐릭터 대기 모션 스프라이트 추가', files: ['assets/char/idle_01.png', 'assets/char/idle_02.png'] },
    ],
  },
  plan1: {
    hoursAgo: 3.5,
    commits: [
      { message: 'docs: 시즌2 밸런스 패치 기획서 초안', files: ['docs/season2_balance.md'] },
      { message: 'docs: 상점 개편안 수치 시트 갱신', files: ['docs/shop_rework.xlsx'] },
    ],
  },
  dev2: {
    hoursAgo: 9,
    commits: [
      { message: 'refactor: 매치메이킹 큐 로직 정리', files: ['src/server/matchmaking.cs'] },
      { message: 'fix: 패킷 유실 재전송 처리', files: ['src/server/net/retry.cs'] },
    ],
  },
};

export function buildDemoData(members, now = new Date()) {
  const commitsByMember = new Map();
  const filesByMember = new Map();
  for (const member of members) {
    const seed = DEMO_COMMITS[member.id] ?? { hoursAgo: 6, commits: [] };
    const base = now.getTime() - seed.hoursAgo * 36e5;
    const commits = seed.commits.map((c, i) => ({
      sha: `demo-${member.id}-${i}`,
      message: c.message,
      authorName: member.name,
      authorEmail: '',
      login: member.gitAuthors[0],
      date: new Date(base - i * 40 * 60e3).toISOString(),
    }));
    commitsByMember.set(member.id, commits);
    filesByMember.set(
      member.id,
      seed.commits.flatMap((c) => c.files.map((filename) => ({ filename, status: 'modified' })))
    );
  }
  return { commitsByMember, filesByMember };
}
