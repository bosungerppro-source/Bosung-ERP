# ColorPencil ERP — 10차 개정 프롬프트: 부품 업데이트 · 설치 파일 · 날짜 형식 안내 (v1.5.0)

> 사용법: 이 저장소를 연 Claude Code 세션에서 아래 **PROMPT** 를 그대로 주면 같은 변경을 다시 적용하거나 이어서 고칠 수 있다.
> Cách dùng: đưa nguyên PROMPT bên dưới cho Claude Code trong phiên đã mở repository này.

---

## PROMPT

너는 BOSUNG VINA(베트남 색연필 공장) ERP를 유지보수하는 시니어 개발자다. 대부분은 스스로 판단해 적용하고 정말 필요한 것만 묻는다. 기능과 숫자 정의는 그대로 두고, 아래를 **9차(v1.4.0) 위에서** 한다.

### 1. 배경 (2026-10-19)
- 8차 검토에서 미룬 것: Electron 33(지원 종료) · SheetJS 0.18.5(알려진 취약점) 업데이트, 설치 · 삭제 중에 ERP 가 실행 중이면 알리기, 현장 일보 엑셀의 날짜 칸 형식 (종이권취 일보가 10월 8일 대신 8월 10일로 저장되어 있었음).

### 2. 한 것
| 항목 | 내용 |
|---|---|
| **Electron 33.4.11 → 44.5.1** | 지금 지원되는 최신 계열(42 · 43 · 44) 중 44. 나온 지 2주가 지난 패치를 고름 (44.5.1, 2026-09-30). `will-navigate` 는 `event.url` 을 먼저 읽음 (예전 인자 방식은 없어질 예정). Windows 10 이상 필요 |
| **electron-builder 25.1.8 → 26.15.3** (npm `latest`) | 빌드 도구의 tar · node-gyp 등 알려진 취약점(critical 1 · high 11) 해소. 설치 프로그램에 들어가는 코드는 아님. 남은 moderate(sprintf-js, Electron 내려받기용)도 빌드 때만 씀 |
| **설치 · 삭제 중 실행 감지** (`build/installer.nsi`) | 설치 폴더의 `ColorPencil ERP.exe` 를 쓰기 모드로 열어 보고(실행 중인 exe 는 Windows 가 쓰기를 막음) 열리지 않으면 "실행 중 — 창을 닫고 [다시 시도]" (한 · 베 · 영). 설치 시작 · 설치 폴더를 고른 뒤 · 파일 복사 직전 · 삭제 시작 때 확인. 플러그인 없이 동작, 다른 Windows 사용자의 ERP 는 상관없음 |
| **현장 일보 날짜 안내** (`docs/GUIDE_EXCEL_DATES.md`, 한 · 베) | 실제 사례(4개 일보의 생산일자 칸 · 저장 값 · 표시), 규칙(생산일자 칸 위치, 연도 4자리 · 일 먼저, 가장 안전한 `2026-10-08`, 파일 이름 날짜, 한 파일 = 하루 · 공정 · 조), 엑셀 데이터 유효성 검사 거는 법, Windows 지역 형식 확인, ERP 미리보기에서 확인, 반장 확인표 |
| **Electron 실행 시험** (`tools/smoke_electron.js`, `npm run test:electron`) | Linux + Xvfb 에서 electron/main.js 그대로 실행: 서버 모드 · 버전 · 바깥 주소 이동 막음 · 팝업 막음 · X 버튼(BrowserWindow.close)으로 닫을 때 대기 중인 저장을 보내고 코드 0 으로 종료 |
| **SheetJS 0.18.5 → 0.20.3: 보류** | 배포처(cdn.sheetjs.com)가 이 작업 환경의 네트워크 정책에서 막힘(403). npm 에는 0.18.5 까지만 있다. 접근이 열리면 `app/lib/xlsx.full.min.js` 와 개발용 `xlsx` 를 0.20.3 으로 바꾸고 현장 엑셀 시험(v7 · v8 · import)을 다시 돌린다. 영향: 0.18.5 는 조작된 엑셀을 열 때 prototype pollution(0.19.3 에서 고침) · ReDoS(0.20.2 에서 고침) 취약점이 있다 — ERP 는 공장 안의 엑셀만 여는 데다 화면 그리기에 innerHTML 을 쓰지 않아 위험은 낮다 |

### 3. 지켜야 할 것
- Electron 을 올릴 때: 지원되는 최신 계열에서 나온 지 2주 지난 패치 → `npm run test:electron` → `npm run dist` → 설치 파일 안 app.asar 가 소스와 같은지 확인.
- 설치 스크립트를 바꾸면 `makensis` 로 컴파일까지 확인한다 (Windows 에서의 실행 확인은 사용자).
- 현장 엑셀의 날짜 규칙은 `docs/GUIDE_EXCEL_DATES.md` 를 기준으로 안내한다 (ERP 쪽 해석 규칙은 8차 `ERP.fmt.parseDate`).

### 4. 검증 (반드시 통과)
- `npm run test:electron` (Electron 44.5.1) · `npm run test:v9` 87 · `npm run test:assistant` 289 · `npm run test:v8` 72 · `npm run test:v7` 149 (ERP_PREV = v1.2.0 소스) · `npm test -- seed/factory`.
- `npm run dist` → 설치 파일 SHA-256 기록, app.asar 의 app/ · server.js · electron/ = 소스.

### 5. 사용자 할 일
- 설치 파일로 덮어 설치 (ERP 를 켜 둔 채 설치하면 닫으라는 안내가 나오는지 확인).
- 현장 반장에게 `GUIDE_EXCEL_DATES.md` 안내 (일보 양식에 데이터 유효성 검사 걸기).
- SheetJS 업데이트를 하려면 작업 환경의 네트워크 허용 목록에 `cdn.sheetjs.com` 을 더해 달라고 알려 준다.
