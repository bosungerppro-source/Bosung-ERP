# ColorPencil ERP (BOSUNG VINA) — Claude 작업 지침

BOSUNG VINA(베트남 색연필 공장)의 수주 · 생산 · 재고 · 원부자재 ERP. Vanilla JS SPA(`app/`) + 의존성 없는 Node 서버(`server.js`) + Electron 설치형(`electron/`).
저장소: GitHub `bosungerppro-source/Bosung-ERP` (공개 저장소, 브랜치 `main`). 2026-10-20 에 공개로 두기로 했다 — 소스 · 예시 데이터 · Release(설치 파일)를 누구나 볼 수 있으므로 API 키 · 비밀번호 · 토큰은 저장소에 올리지 않는다.

## 일하는 방식
- 너는 이 ERP를 유지보수하는 시니어 개발자다. 대부분은 스스로 판단해서 적용하고, 정말 필요한 것만 묻는다.
- 화면 글자는 한국어 / 베트남어 둘 다 넣는다 (`L(ko, vi)`, 베트남어에서 숨길 글자는 `L(ko, '')`).
- 이름 · 글자를 짐작해서 쓰지 않는다. 확인되지 않은 코드 이름은 비워 두고 코드만 보이게 하고, 사용자에게 묻는다 (12차).
- 사용자에게 하는 설명 · 질문은 한국어로 쓴다.
- 규칙과 지금까지의 결정은 문서에 있다. 작업 전에 읽는다.
  - `docs/CLAUDE_PROMPT.md` — 마스터 규칙 (1차부터 지금까지 모든 결정, 숫자 정의)
  - `docs/PROMPT_v6_ECOUNT.md` (6차 v1.1.0), `docs/PROMPT_v7_WIDGETS.md` (7차 v1.2.0), `docs/PROMPT_v8_ACCURACY.md` (8차 v1.3.0), `docs/PROMPT_v9_MULTIPC_AI.md` (9차 v1.4.0), `docs/PROMPT_v10_PARTS.md` (10차 v1.5.0), `docs/PROMPT_v11_FLOOR.md` (11차 v1.6.0), `docs/PROMPT_v12_MENUS.md` (12차 v1.7.0 · 1.7.1), `docs/PROMPT_v13_PO_DONE.md` (13차 v1.8.0), `docs/PROMPT_v14_WAREHOUSE.md` (14차 v1.9.0), `docs/PROMPT_v15_UPDATE_MOBILE.md` (15차 v1.10.0), `docs/PROMPT_v16_BUY.md` (16차 v1.11.0) …
  - `docs/history/*_work_log.md` — 차수별 작업 기록 (결정 · 숫자 · 검증)
- 기존 숫자 정의(납기 경과 60일 등)와 사용자 설정(`ai*`, 위젯 배치)은 바꾸지 않는다. 바꿀 때는 문서에 이유를 남긴다.

## 개발 명령 (클라우드 환경)
```
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci     # 의존성 (Electron 실행 파일은 빌드할 때 받음)
export NODE_PATH=/opt/node22/lib/node_modules   # 전역 Playwright 사용 (Chromium: /opt/pw-browsers/chromium)
npm run server                              # http://127.0.0.1:3210
npm run test:v16                            # 해외 주문 품목 (자재구매 파일 · 리드타임) (16차)
npm run test:v15                            # 자동 업데이트 · 휴대폰으로 보기 · 구글 웹 앱 4판 (15차)
npm run test:v14                            # 창고 입출고장 → 원부자재 · ECOUNT 재고현황 보완 (14차)
npm run test:v13                            # 수주 강제 완료 · 완료 버튼 · 납기 기준 일괄 완료 (13차)
npm run test:v12                            # 메뉴 3개 · ECOUNT 비교 없음 · 이름 미정은 코드만 (12차)
npm run test:v11                            # 현장 실사 · 원부자재 차감 안 함 · 배럴 계열 · BOM 사용량 (11차)
npm run test:v9                             # 여러 PC 저장 합치기 · Host/Origin · 사내망 PIN · 자동 백업 (9차)
npm run test:v8                             # 데이터 정확성 · 현장 엑셀 (8차)
npm run test:v7                             # 재고 · 위젯 · 화면 (ERP_PREV=<이전 버전 소스 폴더> 를 주면 업그레이드 시험 포함)
npm run test:assistant                      # AI 비서 · 서버 프록시 (가짜 API)
npm run test:electron                       # Electron 실행 시험 (Linux + Xvfb, 먼저 node node_modules/electron/install.js)
npm test -- <현장 엑셀 폴더>                 # 현장 엑셀 양식 인식
npm run demo                                # dist/ERP_Demo.html
npm run dist                                # dist/win-unpacked + 설치 파일 (makensis 필요: apt-get install -y nsis)
```
- 이전 버전 소스는 git 태그로 꺼낸다: `git worktree add /tmp/prev v1.2.0` → `ERP_PREV=/tmp/prev npm run test:v7`.

## 확장 규칙 (자세한 것은 docs/CLAUDE_PROMPT.md 6장)
- 새 표: `app/js/schema.js` 의 `ERP.TABLES` (목록 · 폼 · 엑셀 · 구글 동기화에 자동 반영). 계산 캐시는 `DB.memo` 의존 표 목록에 새 표를 넣는다.
- 새 엑셀 양식: `app/js/xl.js` (현장 양식) 또는 `app/js/ecount.js` (ECOUNT · 수불) 에 detector + parser.
- 새 화면: `app/js/p_*.js` 에서 `ERP.pages.<id>` 등록 → `main.js` NAV.
- 날짜 · 숫자를 사용자 입력이나 엑셀에서 읽을 때는 공용 해석 함수(`ERP.fmt.parseDate`, `ERP.fmt.parseNum`)를 쓴다.
- 표를 바꿀 때는 `DB.add / update / remove / replace / upsert / touch` 를 쓴다 (여러 PC 저장 합치기가 행 `_id` 와 저장 번호에 기댐). 서버 쓰기 API 는 JSON 만.
- AI 비서 대화 기록은 뒤에 붙이기만 한다 (중간 수정 · 삭제, 대화 중 시스템 프롬프트 · 도구 변경 금지).
- 고칠 때는 재현 시험을 먼저 만들고(고치기 전 실패 확인) 고친다.

## 출시 절차
1. 시험 전부 통과 (위 명령 + 그 차수의 새 시험).
2. `package.json` · `app/js/core.js` (`ERP.v`) · `build/installer.nsi` 기본값 · `npm run dist` 스크립트의 버전 번호를 함께 올린다.
3. `npm run demo` · `npm run dist` → 설치 파일 SHA-256 기록.
4. 문서: README, `docs/CLAUDE_PROMPT.md` 새 차수 항목, `docs/PROMPT_v<차수>_*.md`, `docs/history/<차수>_work_log.md`.
5. `docs/releases/v<버전>.md` (Release 설명) 작성 → 커밋 → `main` push → 사용자에게 **Actions → "Release — 설치 파일" → Run workflow** (버전 입력) 실행을 안내. 워크플로가 설치 파일 · 데모 · `latest.json` 을 빌드해 태그와 Release 를 만든다.
   - **15차부터 Release = 모든 PC 배포**: 1.10.0 이상이 설치된 PC 는 latest.json 을 보고 다음에 켤 때 새 버전을 설치한다. 시험이 모두 통과한 main 만 Release 로 만든다. 업데이트 관련 파일(electron · installer.nsi · server.js · package.json)을 바꾸면 Actions "자동 업데이트 시험 (Windows)" 결과도 확인한다.
   - Claude Code 클라우드 세션은 태그 push · Release 쓰기 · 저장소 설정 변경이 막혀 있고(403), GitHub GraphQL 도 쓸 수 없다 (`gh api repos/<owner>/<repo>/...` REST 만).
   - 만든 설치 파일은 세션에서 사용자에게 바로 보낼 수도 있다 (28MB 조각 + `join_installer.bat` 방식도 가능).
6. 사용자에게: 바뀐 점, PC에서 확인할 것, 사용자가 할 일.
