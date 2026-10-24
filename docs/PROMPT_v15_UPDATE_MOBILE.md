# ColorPencil ERP — 15차 개정 프롬프트: 자동 업데이트 · 휴대폰으로 보기 (v1.10.0)

> 사용법: 이 저장소를 연 Claude Code 세션에서 아래 **PROMPT** 를 그대로 주면 같은 변경을 다시 적용하거나 이어서 고칠 수 있다.
> Cách dùng: đưa nguyên PROMPT bên dưới cho Claude Code trong phiên đã mở repository này.

---

## PROMPT

너는 BOSUNG VINA(베트남 색연필 공장) ERP를 유지보수하는 시니어 개발자다. 기능과 숫자 정의는 그대로 두고, 아래를 **14차(v1.9.0) 위에서** 한다. 이름 · 글자를 짐작해서 쓰지 말고, 모르면 사용자에게 묻는다.

### 1. 사용자 요청 (원문, 2026-10-21)
> erp가 업그레이드 컴퓨터에 설치했던 파일에서 자동으로 업데이트 되는거야? (→ 아니라고 답함)
> pc설치된게 자동업데이트 할수있게 만들수 없어?
> (방식을 설명한 뒤) 자동 업데이트 만들어줘 (위 방식대로, 1.10.0)
> 웹앱도 연결해서 핸드폰으로 볼수있게도 해줘

물어서 정한 것:
- 자동 업데이트 = 설명한 방식 그대로: 켤 때와 켜져 있는 동안 몇 시간마다 GitHub 확인 → 새 설치 파일을 뒤에서 받아 두고 온전한지 확인 → "새 버전 준비됨" 알림 → **[지금 업데이트]** 또는 **다음에 켤 때** 설치 (진행 막대가 잠깐 보이고 새 버전으로 켜짐) → 설치 전에 데이터 폴더 복사 → 설정에서 끄기 · 지금 확인. 닫을 때 바로 설치하지 않는다 (닫고 바로 PC 를 끄면 설치가 끊길 수 있어서). 일하는 중에 저절로 다시 시작하지 않는다 (사내망으로 붙은 다른 PC 가 끊기므로).
- 휴대폰: 보는 곳 = **둘 다** (공장 Wi-Fi 안에서는 ERP 그대로 · 공장 밖에서는 구글 웹 앱 요약), 주로 볼 화면 = **종합 현황 · 생산 관리**.

### 2. 자동 업데이트 — 확정한 규칙
1. 업데이트 정보 = GitHub Release 의 `latest.json` `{version, file, sha256, size, date}`. 확인 `<releases>/latest/download/latest.json` (API 를 쓰지 않음 → 호출 한도 없음, 사내 프록시도 Chromium 네트워크로), 받기 `<releases>/download/v<버전>/<파일>`. Release 워크플로가 설치 파일 · 데모와 함께 latest.json 을 올린다 (이름 · 형식 바꾸지 말 것). main 버전으로 만든 Release 만 "latest" 이므로, **Release 버튼 = 모든 PC 배포**.
2. `electron/updater.js` (Electron 없이 시험할 수 있게 fetch · spawn · 끝내기를 밖에서 받는다):
   - 확인: 켠 뒤 1분, 그 뒤 4시간마다 (자동 업데이트가 켜져 있을 때), 설정 [지금 확인] · 메뉴 "업데이트 확인…". 404 = "업데이트 정보 없음" (오류 아님). 지금 버전보다 높을 때만 받는다 (숫자 비교: 1.10.0 > 1.9.0, 내려가지 않음).
   - latest.json 검사: 버전 `x.y.z`, 파일 이름 = `ColorPencil-ERP-Setup-<같은 버전>.exe`, SHA-256 64자, 크기 0 ~ 600MB. 받으면서 크기 · SHA-256 을 확인하고 틀리면 지운다.
   - 받아 둔 것: `<userData>/update/<파일>` + `pending.json` `{version, file, sha256, size, from, at, tries}`. 기록 `update.log` (최근 200줄), 업데이트 기록 `history.json` (최근 20).
   - 설치: 데이터 폴더(하루 백업 `backup/` 은 빼고)를 `<userData>/update_backup/<시각>_v<지금>_to_v<새 버전>/` 에 복사 (최근 5개) → 설치 파일을 `/UPDATE /D=<지금 설치 폴더>` 로 실행 (detached · `windowsVerbatimArguments` · 프로그램 이름만 따옴표 — NSIS 의 `/D=` 는 맨 끝 · 따옴표 없음) → ERP 를 끝낸다. 켤 때 설치하기 전에 SHA-256 을 다시 확인한다 (손상이면 지우고 그냥 켬).
   - 같은 설치가 두 번 되지 않으면 (옛 버전으로 다시 켜짐) 저절로 다시 하지 않는다 → 오류 + [지금 업데이트] (켤 때마다 설치만 반복하지 않게).
   - 설치형(`app.isPackaged` · Windows)에서만 설치한다. 개발 실행(npm start)은 확인 · 받기까지.
   - 새 버전으로 켜지면 history 에 기록, 받아 둔 파일 정리, 화면에 한 번 알림 (`justUpdated`).
   - 남은 설치 파일 정리 (`sweep`): 켤 때 · 켠 지 30초 (끝난 설치 프로그램이 아직 열려 있어 못 지운 것). **받는 중 (확인 · 받기) 이면 건드리지 않고 30초 뒤 다시** (1.13.5 — 예전에는 켠 지 30초 안에 시작한 받기가 30초를 넘기면 받던 `.part` 를 지워 받기가 실패했다. 보통은 첫 확인이 1분 뒤라 겹치지 않고, 켜자마자 [업데이트 확인] 을 누르거나 첫 확인을 앞당긴 GitHub 시험에서 드러남).
3. `electron/main.js`: 켤 때 `up.startup()` 이 true 면 서버 · 창을 띄우지 않고 끝낸다 (설치 프로그램이 새 버전을 다시 켬). [지금 업데이트] = 화면의 대기 중인 저장 → 백업 · 설치 파일 실행 → 서버 닫기 · 끝내기 (설치 파일을 못 띄우면 그대로 둠). 메뉴 ERP: 업데이트 확인… · 자동 업데이트(체크) · 버전 표시. 설정 `config.json` 의 `autoUpdate` (없으면 켜짐). 시험용 환경 변수: `ERP_USER_DATA_DIR` (데이터 폴더, 잠금 전에), `ERP_UPDATE_BASE`, `ERP_UPDATE_FIRST_CHECK`.
4. 설치 프로그램 `/UPDATE` (`build/installer.nsi`): 첫 화면 · 폴더 · 마침 화면을 건너뛰고 진행 막대만, ERP 가 닫히기를 최대 30초 기다린 뒤에야 [다시 시도] 창, 끝나면 저절로 닫히고 ERP 를 다시 켠다 (`.onInstSuccess`), 바탕화면 바로가기를 지운 PC 에는 다시 만들지 않는다. 사용자 권한 (관리자 창 없음). 보통 설치(`/S` 포함)는 예전과 같다.
5. 서버 API: `GET /api/update` (상태 — 사내망의 다른 PC 도 보기만) · `PUT /api/update {auto}` · `POST /api/update/check` (최대 8초 기다리고 그때 상태, 받기는 뒤에서 계속) · `POST /api/update/install`. 쓰기는 이 PC(loopback)만, Host · Origin · JSON 검사는 그대로. 설치형이 아니면 `{desktop: false}`.
6. 화면: 설정 → **프로그램 업데이트** 카드 (지금 버전 · 상태 · 마지막 확인 · 마지막 업데이트 · 자동 업데이트 · 지금 확인 · 지금 업데이트). 받아 두었으면 이 PC 의 모든 화면 위에 알림 → [지금 업데이트] → 확인 창 (사내망의 다른 PC 도 잠깐 끊김) → 가림막. 새 버전으로 켜지면 알림 한 번 (브라우저마다).
7. 1.9.0 이하에는 이 기능이 없으므로 **각 PC 에 1.10.0 을 한 번 직접 설치**해야 한다 (데이터 · 설정 그대로). 이 PC 는 `app.asar` 를 바꿔 1.10.0 으로.

### 3. 휴대폰으로 보기 — 확정한 규칙
1. **공장 Wi-Fi 안에서**: 사내망 접속(9차 · PIN)으로 ERP 를 그대로 연다. 좁은 화면(900px 이하)은 왼쪽 메뉴를 **[☰ 지금 화면]** 으로 접고, 640px 이하는 카드 한 줄 · 표는 칸 안에서 옆으로 · 화면 전체가 옆으로 밀리지 않게 (`label.nowrap` 줄바꿈, `.flow .grp` 폭 제한, `.grid2` `minmax(0,1fr)`). 설정 → **휴대폰으로 보기**: 사내망 주소 + QR 코드 (`app/lib/qrcode.js` — qrcode-generator 1.4.4, MIT, `ERP.qrImg`) + 순서 (Wi-Fi · QR · PIN · 홈 화면에 추가). 사내망이 꺼져 있으면 켜는 법 (메뉴 · Windows 방화벽 "허용" · PIN). `app/manifest.webmanifest` · `icon-256.png` · theme-color (홈 화면에 추가).
2. **공장 밖에서 (구글 웹 앱, Code.gs 4판)**: 같은 웹 앱 주소를 휴대폰 브라우저로 열면 요약 화면 (`doGet` → HtmlService, 휴대폰 폭 meta; `?ping=1` 은 예전처럼 상태 JSON). ERP 가 `mobile {summary}` 로 요약을 보내면 드라이브 `ColorPencil ERP Backup/ERP_mobile.json` 하나에 덮어쓴다. 비밀번호 `mobile_pw {pw}` (6~32자, 빈 값 = 끄기) → 스크립트 속성에 소금 + SHA-256 해시만. 휴대폰 화면은 `google.script.run.mobileData(pw)` → `NO_PW` · `NO_DATA` · `BAD_PW` · `WAIT` (10번 틀리면 10분 잠금). 화면 글자는 모두 textContent (요약 안의 글자로 화면을 바꿀 수 없게). 이 휴대폰에서 기억 (localStorage) · 잠그기 · 한국어 / 베트남어.
3. **요약** `ERP.mobileSummary()` = 종합 현황 화면과 같은 계산 (`ERP.dashCtx`, `ERP.dashPrevMonth`): 기준일 = 최신 생산일보, KPI 8개 (기준일 포장 실적 · 이번 달 포장 누계 · 납기 임박/경과 PO · 진행 중 PO · 안전재고 미달 · 불량률 · 가동 설비 · 마이너스 재고), 공정별 실적, 납기 임박 수주 8 · 안전재고 미달 8, 생산 관리 = 이번 달 누계 (전월 같은 기간 대비) · 최근 14일 공정별 생산량 (포장 = 세트, 그 밖 = pcs).
4. **보내기**: 이 PC(loopback)에서만, 설정 `mobileOn` 이 켜져 있고 구글 주소가 있을 때 — 켠 뒤 1분, 그 뒤 15분마다 (요약이 바뀌었거나 마지막으로 보낸 지 1시간이 지났을 때). [지금 보내기]. 마지막 결과는 이 PC 의 localStorage (`erp_mobile_last`). 비밀번호는 ERP 에 남기지 않는다.
5. 옛 Code.gs (`unknown action`) → "Code.gs 4판을 다시 붙여넣고 새 버전으로 배포" 안내. 연결 테스트도 4판이 아니면 알림.

### 4. 코드
- 새 파일: `electron/updater.js`, `app/js/mobile.js`, `app/lib/qrcode.js`, `app/manifest.webmanifest`, `app/icon-256.png`, `tools/selftest_v15.js`, `tools/update_e2e.js`, `.github/workflows/update-test.yml`.
- `electron/main.js` (업데이트 · 메뉴), `server.js` (`opts.update` · `/api/update*` · `.webmanifest`), `build/installer.nsi` (`/UPDATE`), `.github/workflows/release.yml` (latest.json), `google/Code.gs` (4판), `app/js/main.js` (화면 위 알림 · `ERP.updateNow` · 메뉴 접기 · 휴대폰 요약 자동 보내기), `app/js/p_data.js` (설정 카드 2개 · `ERP.gcall`), `app/js/p_dashboard.js` (`ERP.dashCtx`), `app/css/app.css` (휴대폰 · 알림), `app/index.html`, `tools/build_demo.js` (데모에는 manifest 없음).

### 5. 검증
- `npm run test:v15` 138개: 버전 비교 · 확인 · 받기 (가짜 GitHub) · 손상 · 크기 · 이름 · 켤 때 설치 · 두 번 실패 · 자동 끔 · 설치 뒤 기록 · [지금 업데이트] · 서버 API (다른 PC 403) · 설정 카드 · 화면 위 알림 · 업데이트 뒤 알림 · 베트남어 · 설치 프로그램 · Release · 버전 번호 · 휴대폰 폭(390) 화면 · 메뉴 접기 · QR · manifest · Code.gs 4판 (Node vm) · 요약 = 종합 현황 숫자 · 비밀번호 · 보내기 · 15분 자동 · 휴대폰 화면 · 옛 Code.gs · 끄기.
- GitHub Actions **"자동 업데이트 시험 (Windows)"** (`tools/update_e2e.js`, 업데이트 관련 파일이 main 에 바뀌면 저절로): 설치 파일 두 개(A = 지금 버전, B = 끝자리 + 100)로 실제 조용한 설치 → B 받기 → 닫고 다시 켜면 B 설치 · B 로 다시 켜짐 (앱 및 기능 버전 · 데이터 · 복사본) → [지금 업데이트] → SHA-256 이 틀리면 받지 않음.
- 기존: v14 · v13 · v12 · v11 · v9 · v8 · v7 (`ERP_PREV` = 1.9.0) · assistant.

### 6. 지켜야 할 것
- 자동 업데이트는 **GitHub Release 를 믿는다** — Release 를 만드는 것 = 모든 PC 배포. GitHub 계정은 2단계 인증으로 지킨다. 설치 파일은 서명이 없으므로 SHA-256 으로만 확인한다.
- 일하는 중에 저절로 ERP 를 다시 시작하지 않는다. 설치 전 데이터 복사를 빼지 않는다.
- 휴대폰 요약에는 비밀번호 없이는 아무것도 보이지 않게 한다. 비밀번호는 해시로만.

### 7. 사용자 할 일
1. GitHub 에 올린 뒤 Actions → "Release — 설치 파일" → `1.10.0` → 다른 PC 마다 1.10.0 설치 파일을 한 번 덮어 설치 (데이터 그대로). 그 뒤부터 자동.
2. 공장 Wi-Fi 휴대폰: 이 PC 메뉴 ERP → 사내망 접속 켜기 (Windows 방화벽 "허용") → 설정 → 사내망 PIN → 설정 → 휴대폰으로 보기의 QR 을 휴대폰으로.
3. 공장 밖 휴대폰: 구글 시트 → Apps Script 에 `google/Code.gs` 4판 붙여넣기 (TOKEN 바꾸기) → 웹 앱으로 배포 → ERP 엑셀 · 구글 연동에 주소 · TOKEN → 설정 → 휴대폰으로 보기 → 비밀번호 정하고 켜기 → QR 을 휴대폰으로.
4. GitHub 계정 2단계 인증.
