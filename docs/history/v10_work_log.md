# 10차 — 부품 업데이트 · 설치 파일 · 날짜 형식 안내 (2026-10-19, v1.5.0)

대상: 9차(v1.4.0) 소스. 내용 · 규칙은 `docs/PROMPT_v10_PARTS.md`, 개발 규칙은 `docs/CLAUDE_PROMPT.md` 2-9.

## 한 일
- **Electron 33.4.11 → 44.5.1**: 지원 계열 42 · 43 · 44 중 최신, 나온 지 2주 지난 패치 (44.9.0 은 2026-10-17 출시라 제외). `electron/main.js` 의 `will-navigate` 는 `event.url` 을 먼저 읽음.
- **electron-builder 25.1.8 → 26.15.3** (npm `latest` 태그): npm audit 의 critical 1 · high 11 (tar · node-gyp · builder-util-runtime 등, 모두 빌드 도구) 해소. 남은 것: moderate 8 (sprintf-js ← global-agent ← @electron/get, Electron 을 내려받을 때만 씀) · high 1 (xlsx, 아래).
- **설치 · 삭제 중 실행 감지** (`build/installer.nsi`): 설치 폴더의 exe 를 쓰기 모드로 열어 보고 실패하면 "실행 중 — 창을 닫고 [다시 시도]" (한 · 베 · 영). `.onInit` · 설치 폴더 화면을 떠날 때 · 파일 복사 직전 · `un.onInit`. 쓰지 않던 `FindWindow` 줄 삭제. makensis 컴파일 확인.
- **현장 일보 날짜 안내** `docs/GUIDE_EXCEL_DATES.md` (한 · 베): 현장 엑셀 4개의 실제 생산일자 칸 — 포장 M3 · 리필 N5 · 조립 L4(값은 맞지만 10/8/26 로 표시) · 종이권취 I3(**2026-08-10 으로 저장**, 10월 8일을 월/일 엑셀에 입력). 규칙 · 데이터 유효성 검사 · Windows 지역 형식 · ERP 미리보기 확인 · 반장 확인표.
- **Electron 실행 시험** `tools/smoke_electron.js` (`npm run test:electron`): Xvfb 에서 electron/main.js 실행, 메인 프로세스는 Node inspector 로 `BrowserWindow.close()` (X 버튼과 같은 길). 처음에는 화면 쪽 `window.close()` 로 닫아 "보내는 중인 저장"이 남은 채 닫히는 것처럼 보였으나, 이는 X 버튼과 다른 길이라 시험 방법을 바꿈 (X 버튼 길에서는 닫기 전 대기 0 · 저장 확인 · 종료 코드 0).
- **SheetJS 0.20.3: 보류** — cdn.sheetjs.com 이 작업 환경 네트워크 정책에서 403. npm 에는 0.18.5 까지만 있음. 사용자에게 허용 방법을 알림.

## 숫자
- 설치 파일 84,093,200 → 114,112,748 바이트 (Electron 44 가 더 큼).

## 검증
- `npm run test:electron` 8개 통과 (Electron 44.5.1 · ERP 1.5.0) · `npm run test:v9` 87 · `npm run test:assistant` 289 · `npm run test:v8` 72 · `npm run test:v7` 149 (`ERP_PREV=<v1.2.0 소스>`) 통과 · `npm test -- seed/factory` 오류 0.
- 빌드: `ColorPencil-ERP-Setup-1.5.0.exe` 114,112,748 바이트, SHA-256 `cd8154aa8c35234167eb66208d4715e544896de0ed77645758d394d1afcaf311`. app.asar 의 app/ · server.js · electron/ = 소스, package.json 1.5.0, exe 버전 정보 44.5.1.
- Windows 에서의 설치 · 실행 감지 · 삭제는 사용자가 확인 (이 환경은 Linux).

## 남은 확인 (사용자)
- ERP 를 켜 둔 채 설치 파일을 실행 → "실행 중" 안내 → 닫고 [다시 시도] → 설치. 제어판에서 삭제할 때도 같은 안내.
- 현장 반장에게 `GUIDE_EXCEL_DATES.md` 안내, 일보 양식에 데이터 유효성 검사 걸기.
- SheetJS 업데이트를 원하면 작업 환경 네트워크 허용 목록에 `cdn.sheetjs.com` 추가.
