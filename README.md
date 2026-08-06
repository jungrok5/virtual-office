# Guild HQ 🕹️

팀의 **실제 깃 활동**을 픽셀 오피스와 퀘스트 보드로 보여주는 자동 스탠드업 대시보드.
"누가 무엇을 했고, 지금 무엇을 하고 있고, 어디가 막혀 있는지"를 사람에게 묻지 않고 알기 위한 도구다.

출퇴근(자리에 있는지)은 그리지 않는다 — **일이 일어나는 것만 그린다.**
화면의 모든 요소는 실제 데이터에 1:1로 대응한다:

| 화면 | 실제 데이터 |
|---|---|
| 캐릭터 타이핑 / 모니터 켜짐 | 최근 N시간 내 푸시 |
| 책상의 불 🔥 | 담당 PR의 CI 실패 |
| 팡파레 "QUEST COMPLETE!" | PR 머지 |
| Quest Board — Doing | 열린 PR (API 불가 시: 기본 브랜치보다 앞선 피처 브랜치) |
| Did — 최근 24시간 | 커밋·머지 이력 |
| Evidence 갤러리 | 하네스가 찍어 커밋한 스크린샷 (`.guild/evidence/`) |

## 실행

```bash
npm install
npm start        # 라이브: 이 클론의 git 데이터 수집 (+가능하면 GitHub API 보강)
npm run demo     # 데모: 가짜 팀 데이터가 시나리오대로 재생
```

http://localhost:3000 접속. 설정은 `guild.config.json`.

### 환경변수 (모두 선택)

| 변수 | 효과 |
|---|---|
| `ANTHROPIC_API_KEY` | 멤버별 작업 한 줄 요약 + Q&A를 Claude가 수행 (없으면 규칙 기반 폴백) |
| `GITHUB_TOKEN` | GitHub API 보강 활성화 → PR 목록·CI 상태가 퀘스트에 반영 |
| `DEMO=1` | 데모 모드 |
| `PORT` | 포트 (기본 3000) |

## 수집 구조: git 필수, API 보강

- **git 트랜스포트** (`server/collect/git.js`) — 로컬 클론에서 `git fetch` 후 브랜치·커밋·작성자를 읽는다.
  네트워크 정책으로 GitHub API가 막힌 환경에서도 동작하는 기본 경로. 멤버는 커밋 작성자에서 자동 발견된다.
- **API 트랜스포트** (`server/collect/api.js`) — 접근 가능하면 열린 PR·CI 체크·머지 이력을 보강한다.
  첫 호출에서 401/403이면 스스로 비활성화되고 git 수집만으로 동작한다.

## 현황 Q&A

대시보드의 "길드 마스터에게 묻기"에서 자연어로 질문하면 현재 스냅샷을 근거로 답한다.
`ANTHROPIC_API_KEY`가 있으면 Claude가 스냅샷(JSON)을 읽고 답하고, 없으면 규칙 기반으로 답한다.
API: `POST /api/ask` `{ "question": "..." }`.

## 검증 하네스 + Evidence

```bash
npm run verify        # 데모 + 라이브 모두 검증
npm run verify:demo   # 데모만
```

하네스(`harness/verify.mjs`)는 서버를 띄우고 Playwright로 실제 화면을 열어
렌더링·Q&A 왕복을 검사한 뒤, 스크린샷과 체크 결과를 `.guild/evidence/<브랜치>/`에 남긴다.
**이 폴더는 커밋 대상이다** — 리뷰어와 대시보드(Evidence 갤러리)가 같은 이미지를 본다.
에이전트가 개발할 때도 이 루프를 쓴다: 구현 → `npm run verify` → 스크린샷 확인 → 커밋.

## 다음 단계

- GitHub 웹훅 수신 (폴링 → 실시간)
- 매일 아침 Slack 스탠드업 요약 발송
- Q&A에 도구 사용(diff·CI 로그 조회) 추가 — "왜 막혔어?"에 근거까지 답하기
