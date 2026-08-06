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

### LLM 백엔드: API 키 없이도, 구독으로도

요약·Q&A는 세 가지 방식 중 자동으로 선택된다 (`server/llm.js`):

1. **`ANTHROPIC_API_KEY`** — Anthropic API 직접 호출 (팀 서버 배포용)
2. **claude CLI (구독)** — API 키가 없어도 [Claude Code CLI](https://claude.com/claude-code)가
   설치·로그인되어 있으면 `claude -p` 헤드리스 호출로 동작한다.
   **Claude Pro/Max 구독이면 추가 비용 없이** 본인 구독 사용량으로 요약·Q&A가 돌아간다.
3. **규칙 기반** — 둘 다 없으면 LLM 없이 커밋 메시지 기반으로 답한다. 앱 전체가 그대로 동작한다.

`GUILD_LLM=api|cli|rules`로 강제 지정 가능.

### 환경변수 (모두 선택)

| 변수 | 효과 |
|---|---|
| `ANTHROPIC_API_KEY` | LLM 백엔드를 API 모드로 (없으면 CLI → 규칙 기반 순으로 폴백) |
| `GUILD_LLM` | LLM 백엔드 강제 지정: `api` / `cli` / `rules` |
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

## 정적 스냅샷 모드 (서버 없이 GitHub Pages)

`.github/workflows/pages.yml`이 푸시·매시간마다 수집을 돌려 `state.json` + evidence를
GitHub Pages로 배포한다 → `https://<owner>.github.io/<repo>/`

- 프론트는 서버(`/api/state`)가 없으면 자동으로 `state.json`을 읽는 정적 모드로 전환된다.
- **Q&A도 서버 없이 동작한다** — 엔진 사다리 (API·구독 불필요):
  1. **크롬 내장 AI (Gemini Nano)** — 크롬 148+의 Prompt API. 별도 다운로드 없이
     브라우저 내장 모델로 답변 (auto/내장 선택 시 우선 시도)
  2. **WebLLM (WebGPU)** — Qwen3.5 라인을 기기 GPU에서 직접 실행.
     기기 맞춤 자동 선택: 플래그십 폰·PC는 4B(3.9GB), 중급 2B, 저사양 0.8B.
     드롭다운으로 0.8B~9B 수동 선택 가능 (한 번 받으면 캐시)
  3. **규칙 기반** — 둘 다 없으면 LLM 없이 데이터 조회 답변
- **PWA**: 모바일 브라우저에서 "홈 화면에 추가"하면 앱처럼 설치된다. 오프라인엔 마지막 스냅샷 표시.
- 로컬 미리보기: `node scripts/build-static.mjs` 후 `dist/`를 아무 정적 서버로 서빙.
- 주의: Pages는 인증이 없다 — 리포가 퍼블릭이면 현황판도 퍼블릭이다.

## 보안 메모

- **바인딩**: 기본으로 `127.0.0.1`에만 열린다. 팀에 개방하려면 `HOST=0.0.0.0`을 명시하고,
  이때는 `GUILD_AUTH_TOKEN`을 함께 설정하라 — 모든 요청에
  `Authorization: Bearer <토큰>` 또는 첫 진입 시 `?token=<토큰>`(이후 쿠키 자동 인증)이 요구된다.
- **LLM 비용 보호**: `/api/ask`는 동시 2건까지만 처리한다 (초과 시 429).
- **프롬프트 인젝션**: 커밋 메시지·질문은 신뢰할 수 없는 입력으로 취급한다.
  CLI 모드는 `--tools ""`로 도구를 완전 비활성화해 파일 접근 유발을 차단하고,
  시스템 프롬프트가 데이터/지시 경계를 명시한다. 단, 조작된 커밋 메시지가 요약 "내용"을
  왜곡할 가능성까지 없앨 수는 없다 — 현황판의 답은 참고용이며 원본은 항상 깃 히스토리다.
- **Evidence는 커밋된다**: `.guild/evidence/` 스크린샷은 리포 공개 범위 그대로 공개된다.
  퍼블릭 리포에서 민감한 데이터가 보이는 배포 화면을 하네스로 찍지 않도록 주의.

## 다음 단계

- GitHub 웹훅 수신 (폴링 → 실시간)
- 매일 아침 Slack 스탠드업 요약 발송
- Q&A에 도구 사용(diff·CI 로그 조회) 추가 — "왜 막혔어?"에 근거까지 답하기
