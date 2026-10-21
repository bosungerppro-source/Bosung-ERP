# 15차 — 자동 업데이트 · 휴대폰으로 보기 (2026-10-21, v1.10.0)

대상: 14차(v1.9.0) 소스. 요청 · 결정 · 규칙은 `docs/PROMPT_v15_UPDATE_MOBILE.md`, 개발 규칙은 `docs/CLAUDE_PROMPT.md` 2-14.

## 요청
- "erp가 업그레이드 … 자동으로 업데이트 되는거야?" → 아니라고 답함 (설치형은 스스로 바뀌지 않음, 이 PC 는 app.asar 교체, 다른 PC 는 설치 파일 덮어 설치).
- "pc설치된게 자동업데이트 할수있게 만들수 없어?" → 방식을 설명 → "자동 업데이트 만들어줘 (위 방식대로, 1.10.0)".
- "웹앱도 연결해서 핸드폰으로 볼수있게도 해줘".

## 물어서 정한 것
- 자동 업데이트 = 설명한 방식 (켤 때 · 4시간마다 확인, 받아 두기, 다음에 켤 때 또는 [지금 업데이트], 설치 전 데이터 복사, 설정에서 끄기).
- 휴대폰: 보는 곳 = 둘 다 (공장 Wi-Fi + 구글 웹 앱), 볼 화면 = 종합 현황 · 생산 관리.

## 정한 것 (묻지 않음)
- 업데이트 정보는 GitHub API 대신 `releases/latest/download/latest.json` (호출 한도 없음). Release 워크플로가 latest.json 을 올린다.
- 설치는 NSIS 설치 파일을 `/UPDATE` 로 (Electron 의 자동 업데이트 라이브러리를 쓰지 않음 — 설치 파일을 electron-builder 가 아닌 우리 NSIS 스크립트로 만들기 때문, 의존성도 늘지 않음).
- 닫을 때 바로 설치하지 않고 다음에 켤 때 (닫자마자 PC 를 끄면 설치가 끊길 수 있음). 같은 설치가 두 번 안 되면 멈춤.
- 공장 밖 휴대폰은 이미 있는 구글 연동(Code.gs)을 4판으로 — 같은 웹 앱 주소를 휴대폰으로 열면 요약 화면, 비밀번호는 해시로만.
- QR 코드는 qrcode-generator 1.4.4 (MIT, npm) 를 `app/lib/qrcode.js` 로 (네트워크 · eval 없음 확인).

## 한 일
- `electron/updater.js` (새): 확인 · 받기 (크기 · SHA-256) · 켤 때 설치 · [지금 업데이트] · 데이터 복사 · 두 번 실패 멈춤 · 기록 (`update.log` · `history.json`) · 남은 설치 파일 정리.
- `electron/main.js`: 켤 때 설치 (서버 · 창 전에), 메뉴 (업데이트 확인 · 자동 업데이트 · 버전), 시험용 `ERP_USER_DATA_DIR` · `ERP_UPDATE_BASE` · `ERP_UPDATE_FIRST_CHECK`.
- `server.js`: `/api/update` (보기) · `PUT /api/update` · `POST /api/update/check` · `POST /api/update/install` (loopback 만), `.webmanifest`.
- `build/installer.nsi`: `/UPDATE` (진행 막대만 · 30초 기다림 · 자동 닫힘 · ERP 다시 켜기 · 바탕화면 바로가기 다시 만들지 않음).
- `.github/workflows/release.yml`: latest.json. `.github/workflows/update-test.yml` + `tools/update_e2e.js` (새): Windows 실제 설치 시험.
- `app/js/main.js`: 화면 위 알림 · `ERP.updateNow` · 업데이트 뒤 알림 · 메뉴 접기 [☰] · 휴대폰 요약 자동 보내기. `app/js/p_data.js`: 설정 카드 "프로그램 업데이트" · "휴대폰으로 보기" 자리, `ERP.gcall`, 연결 테스트 4판 알림. `app/js/mobile.js` (새): `ERP.mobileSummary` · `ERP.mobileSend` · `ERP.mobileAuto` · `ERP.phoneCard` · `ERP.qrImg`. `app/js/p_dashboard.js`: `ERP.dashCtx`.
- `app/css/app.css`: 휴대폰 (900px 메뉴 접기 · 640px 한 줄 · `label.nowrap` · `.flow .grp` · `.grid2`) · 알림 · QR.
- `google/Code.gs` 4판: `doGet` 휴대폰 화면 · `mobile` · `mobile_pw` · `mobileData` (잠금).
- `app/manifest.webmanifest` · `app/icon-256.png` · `index.html` (manifest · apple-touch-icon · theme-color), `tools/build_demo.js` (데모에는 manifest 없음).
- 버전 1.10.0, 새 시험 `tools/selftest_v15.js` (`npm run test:v15`), v9 시험의 Code.gs 판 번호 기대값을 "3 이상" 으로.

## 고친 것 (시험에서 찾음)
- 설정 카드에 "nullnull" 글자 (replaceChildren 에 null) → `ERP.put` (12차 규칙).
- 휴대폰 폭에서 설정 화면이 510px · 현장 재고가 1119px 로 넓어짐 → `.grid2` `minmax(0,1fr)`, 좁은 화면의 `label.nowrap` 줄바꿈, `.flow .grp` 폭 제한.
- 휴대폰 보기 [끄기] 가 확인 창 뒤에 아무것도 안 함 (await 뒤 `e.currentTarget` 이 비어 있음) → 버튼을 먼저 잡아 둠.

## 검증 (Windows 11 · Chrome, 사용자 PC)
- `npm run test:v15` 139 / 139.
- `npm run test:v14` 42 / 42 · `test:v13` 28 / 28 · `test:v12` 123 / 123 · `test:v11` 50 / 50 · `test:v8` 72 / 72 · `test:assistant` 290 / 290 · `test:v9` 86 / 87 (Windows 환경 차이 1개, 이전과 같음).
- `npm run test:v7` 149 / 149 (`ERP_PREV` = 1.9.0 소스 → 1.10.0 업그레이드).
- 설치형과 같은 실행 파일 (`electron-builder --win dir`, Electron 44.5.1) 로 따로 떨어진 데이터 폴더에서: 켜서 새 버전 받기 (net.fetch) → [지금 업데이트] → 데이터 복사 · 설치 파일 실행 · 정상 종료 → 다시 켜면 켤 때 설치 → 두 번째 실패 뒤에는 ERP 가 켜지고 오류 + 지금 업데이트 → 창 닫기로 정상 종료, 실제 ERP 데이터 그대로 (11 / 11, 설치 파일 대신 Windows whoami.exe 복사본).
- 휴대폰 폭(390): 종합 현황 · 생산 관리(탭 5개) · 수주 · 현장 재고 · 원부자재 재고 · 품목 · BOM · 엑셀 · 설정 모두 옆으로 밀리지 않음. 데모(file://) PC · 휴대폰 폭 오류 없음.
- 실제 NSIS 설치 프로그램의 `/UPDATE` 는 이 PC 에 NSIS 가 없어 GitHub Actions "자동 업데이트 시험 (Windows)" 에서 확인한다 (main 에 올리면 저절로 돈다).

## 이 PC 반영 (2026-10-21)
- 바꾸기 전 데이터: `05_backup/ERP_data_before_v1.10.0_2026-10-21/` (파일 75개), 1.9.0 프로그램 파일은 `resources/app.asar.v1.9.0`.
- `electron-builder --win dir` 로 만든 1.10.0 `app.asar` 로 바꿈 (설치 폴더의 실행 파일 · Electron 은 그대로, 들어 있는 파일 · 버전 확인).
- 켜서 확인 (보기만): 화면 1.10.0 · 서버 모드, 자료 그대로 (품목 712 · 수주 줄 485 (완료 347) · 입출고 5,351 · 기초재고 662 · 거래처 39), 설정의 프로그램 업데이트 · 휴대폰으로 보기 카드, 휴대폰 폭에서 종합 현황 · 생산 관리 · 원부자재 재고 · 현장 재고 · 수주 관리 모두 맞음, 화면 오류 0.
- 켠 뒤 1분에 실제 GitHub 확인 → "업데이트 정보 없음" (아직 Release 가 없음 — 오류 아님). 창 닫기로 정상 종료, 데이터 폴더 그대로.
- 사내망 접속이 꺼져 있고 구글 연동 주소도 없어서 휴대폰 보기는 아직 켜지지 않았다 (사용자 할 일).

## GitHub Actions "자동 업데이트 시험 (Windows)" (실제 NSIS 설치 프로그램 · Electron, windows-latest)
- 1차 (`2f67c89`): 조용한 설치 (빈칸 있는 폴더) · 새 버전 받기 · 닫고 다시 켜면 `/UPDATE` 설치 → 새 버전으로 다시 켜짐 (앱 및 기능 버전 · 업데이트 기록 · 설치 파일 정리) · [지금 업데이트] · SHA-256 이 틀리면 받지 않음 — 모두 통과. "데이터 그대로" 2건만 실패: 시험 데이터에 `seeded` 표시가 없어 처음 켤 때 예시 자료로 바뀐 것 (업데이트와 무관, 시험 준비 실수).
- 2차 (`d648ab6`, 시험 데이터를 이미 쓰던 ERP 처럼 준비): 모두 통과.
- 사용자 결정 (2026-10-21): "자동으로 올려줘 이제 더이상 물어보지마" → 시험이 통과한 변경은 묻지 않고 GitHub 에 올린다. Release(모든 PC 배포)는 사용자가 Actions 에서 누른다.

## 1.10.1 보완 — 월별 조립 생산량 (2026-10-21)
- 사용자: "생산관리 탭에도 일별 조립 생산량, 월별 조립 생산량을 볼 수 있게 해줘. 종합 현황에도 일별 조립 생산량만 있고 월별 조립 생산량이 없어."
- 종합 현황: 위젯 `asm_monthly` "월별 조립 생산량" (품목군 × 1~12월, 연도 이동, 표/차트, 공정 고르기) — 기본 배치에서 `asm_daily` 바로 다음. 화면 편집으로 저장해 둔 배치에는 한 번만 넣는다 (`meta.dashAsmMonthly`, 사용자가 빼면 다시 넣지 않음). 계산 `ERP.prodByMonth` (포장 · 세트 공정은 세트, 그 밖 pcs — 일별 위젯과 같은 규칙).
- 생산 관리: 탭 "일별 조립 생산량" (예전 "일별 생산수량") · 새 탭 "월별 조립 생산량" (`monthlyTab`: 행 1~12월, 열 품목군 또는 공정, 연 합계 · 입력된 달 · 월 평균 · 가장 많은 달, 막대, 엑셀). 공정을 바꾸면 탭 이름도 그 공정.
- 휴대폰 요약: `asmDaily` (이번 달 날짜 × 품목군) · `asmMonthly` (올해 1~12월 × 품목군), 구글 웹 앱 화면의 생산 관리 칸에 두 표.
- 시험: `npm run test:v15` 155 / 155 (11장: 위젯 위치 · 연 합계 = 그해 조립 합 · 차트 · 연도 이동 · 저장한 배치에 한 번 넣기 · 생산 관리 탭 · 이 달 칸 = 일별 탭 월 합계 · 공정 바꾸기 · 베트남어 · 휴대폰 요약 · 휴대폰 화면 · 휴대폰 폭), v7 기본 배치 13개 · v7 · v12 탭 목록에 monthly.
