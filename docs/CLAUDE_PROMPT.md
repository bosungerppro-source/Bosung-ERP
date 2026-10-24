# ColorPencil ERP — 개발/확장용 마스터 프롬프트 (Master prompt)

아래 프롬프트를 Claude(Claude Code 또는 채팅)에 그대로 붙여넣으면, 이 프로젝트와 동일한 구조의 ERP를 다시 만들거나 기능을 확장할 수 있습니다.
Dán nguyên prompt dưới đây vào Claude để tạo lại hoặc mở rộng hệ thống ERP này.

---

## PROMPT

너는 베트남 공장(BOSUNG VINA)의 **색연필 제조 ERP**를 만드는 시니어 풀스택 개발자다. 사용자는 대부분을 네가 스스로 판단해 적용하길 원하며, 정말 필요한 경우에만 질문한다. 마스터(백) 데이터는 사용자가 화면/엑셀에서 수정한다.

### 1. 목적
수주(PO) → 생산(사출·리필성형·핫포일스탬핑·조립·종이권취·포장) → 재고(원·부자재) 를 한 시스템에서 관리하고, 종합 대시보드로 현황을 보여준다.

### 2. 필수 요구사항
1. **한국어 / 베트남어 즉시 전환** (모든 라벨·메시지·표 머리글). 헬퍼 `L(ko, vi)`.
2. 저장·관리: **Excel(.xlsx) 업로드/다운로드, Google Sheets(공유 DB), Google Drive(백업 복사본)**.
3. **엑셀 업로드로 데이터 반영**: 현장 양식(원부자재 입출고장, 수주·생산 수량 관리, 공정별 일일 생산일보, 이동전표, BOM/배합표)을 자동 인식하고, 반영 방식(키 기준 갱신 / 기간 교체 / 전표번호 교체 / 추가 / 전체 교체)을 선택. 날짜 셀이 틀릴 때(파일명 날짜와 다름)를 감지해 수정 가능.
4. **종합 대시보드**(7차부터 위젯): KPI(포장 실적, 월 누계, 납기 임박/경과, 불량률, 가동 설비, 안전재고 미달), 공정별 카드, 일별 조립, 30일 추이, 월별 수주(Checking), 납기 PO, 재고 경고 — 사용자가 추가·삭제·순서·크기를 바꾼다.
5. UI는 "색연필 공장 대시보드" 디자인 시스템(왼쪽 어두운 사이드바, 흰 카드, 칩/진행바, 노란 포인트)을 따른다.
6. 간단히 테스트할 수 있는 **단일 HTML(ERP_Demo.html)** 과 **Windows 설치 파일(.exe)** 제공.

### 2-1. 2차 개정 요구사항 (반영 완료)
공정 커스터마이징(추가/이름/순서/삭제/입력항목/대시보드 표시) · 일별 생산수량 월간 표 · 월별×아이템별 수주 pcs 표 · 이동전표·입출고 전표작성 제거 · 안전재고 설정 품목만 발주 목록 · 외주 입출고(잔량 관리) · 사용자 정의 다단계 BOM(1번+2번→3번) · MRP 다품번(set/pcs) 입력 + 세미/원부자재 재고 대비 부족분 · 통합검색(Ctrl+K)·메뉴 배지·일보 붙여넣기/최근일보 불러오기·입력 현황.

### 2-2. 3차 개정: 한 PO에 여러 품번
- 수주 데이터는 (PO번호, 품번) 한 줄이 1행. 수주 목록은 **PO별 보기**(PO당 1행, 품번 수 표시)와 **품번 라인별 보기** 토글.
- 포장 실적은 생산일보(PCK)의 `po_no + code` 로 품번별 매칭 → 품번별 진행률, PO 진행률은 합산. 어느 품번에도 안 맞는 포장은 경고.
- PO 상태: 전 품번 완료=완료, 미완료 품번 중 하나라도 납기 경과=지연. 납기는 미완료 품번 중 가장 빠른 날짜.
- 수주 등록/편집 팝업: PO 헤더 1회 + 품번 라인 여러 개(추가/삭제), 품목군·pcs 자동입력(과거 PO 최빈값 → item_bom).
- "자재 소요량 계산 (전체 품번)" → MRP 탭에 PO의 모든 품번을 한 번에 투입.
- 대시보드/배지는 PO 단위(`C.poGroups`), 라인 단위는 `C.orders`.

### 3. 화면
종합 현황(7차: 위젯) / 수주 관리(진행률·납기 달력·상세·월별×품목군 표) / 생산 관리(일보 조회·입력·일별 생산수량·설비) / **품목**(12차: 품목 마스터 · 코드 사전 · 자료 점검 · 예시 자료) / **현장 재고**(12차: 현장 재고 · 생산 반영 · 수불 입력 · 수불 내역) / **원부자재 재고**(12차: 원부자재 재고 · 수불 입력 · 수불 내역 · 발주·안전재고 · 외주) / 제품·BOM·배합(MRP 소요량 계산 · 조립 BOM 자동 구성) / 엑셀·구글 연동 / 설정.

### 4. 도메인 규칙
- 재고(6차) = ECOUNT 기초재고(기준일) + 기준일 이후 수불(입고·출고·이동·조정) + 생산일보 자동 반영(입고·BOM 차감). 범위는 창고 / 공장 2묶음. 자세한 규칙은 아래 2-5.
- **11차부터**: 생산 반영의 BOM 차감은 현장 재고(반제품 · 완제품)만 — 원부자재(RM · SM · CM)는 절대 차감하지 않는다. 공정 중(WIP 단계) 품목은 현장 실사(TỒN KHO → `grp: 'floor'`)가 기초 · 기준일 (원부자재는 ECOUNT). 배럴 계열 = WIP01 · WIP11 · WIPx1. 아래 2-10.
- **12차부터**: 메뉴도 셋 — 품목 / 현장 재고 / 원부자재 재고 (수불 입력 · 수불 내역 · 배지도 따로). ECOUNT 비교는 없앴다 (2026-11 부터 ECOUNT 를 쓰지 않음). 확인되지 않은 코드 이름은 쓰지 않고 코드만 보인다. 아래 2-11.
- 안전재고 상태: 정상 / 임박(<120%) / 미달 / 마이너스 / 기준없음.
- 수주 상태: 완료 / 납기경과 / 생산중 / 대기. 포장 실적(set)은 포장일보의 PO 번호로 자동 집계.
- 배합표 coef = 제품 1개당 원료 g. 원료 소요 kg = 수량 × coef ÷ 1000. 수량은 색상수로 균등 배분.
- 공정 코드: INJ, REF, STP, ASM, WRP, PCK.

### 5. 기술 구조 (빌드 도구 없음)
- Vanilla JS SPA (`app/`), 전역 `window.ERP`, DOM 빌더 `h()`, Chart.js 4, SheetJS.
- `ERP.db`: 메모리 테이블, 저장은 서버모드(JSON 파일) 또는 IndexedDB. 행마다 `_id`.
- `server.js`: 의존성 없는 로컬 서버 (정적파일, `/api/*`, Google Apps Script 중계 `/api/gproxy`, 일일 백업 14일, LAN 옵션). 9차: 표마다 저장 번호(409 → 화면이 행 단위로 합침) · 설정 항목별 저장(PATCH) · Host/Origin/JSON 검사 · 사내망 PIN · PC 밖 자동 백업 · AI 중계 허용 목록 · 하루 한도.
- `electron/main.js`: 서버를 내장해 창으로 표시 (Electron 44, 10차). 설치 파일은 electron-builder(dir) + NSIS(`build/installer.nsi`, 설치 · 삭제 중 실행 감지).
- `google/Code.gs`: Apps Script 웹앱 (ping/list/put/get/snapshot/backup, 토큰 보호, 3판 = ping `ver: 3`).

### 6. 확장할 때 지켜야 할 것
- 새 표는 `app/js/schema.js` 의 `ERP.TABLES` 에 컬럼(ko/vi/type)을 추가하면 목록·폼·엑셀 내보내기·구글 동기화에 자동 반영된다.
- 새 엑셀 양식은 `app/js/xl.js` 에 detector + parser 를 추가한다.
- 새 화면은 `app/js/p_*.js` 에서 `ERP.pages.<id> = {ko, vi, render(root)}` 로 등록하고 `main.js` 의 NAV 에 추가한다.
- 모든 문자열은 `L()` 로 양국어 제공(`L(ko, '')` = 베트남어에서 빈 글자, `L(ko)` = 한국어 대체). 숫자/날짜 포맷은 `ERP.fmt`.
- 사용자 입력 · 엑셀에서 날짜 · 숫자를 읽을 때는 `ERP.fmt.parseDate` · `ERP.fmt.parseNum` (8차). 진행 중 PO 는 `ERP.calc.isOpen` (완료 · 취소 · 보류 제외).
- 표를 바꿀 때는 `DB.add / addMany / update / remove / replace / upsert / touch` (직접 `DB.t[n]` 을 바꾸면 반드시 `DB.touch(n)`) — 여러 PC 저장 합치기가 행 `_id` 와 저장 번호에 기대므로 (9차). 서버 쓰기 API 는 JSON 만, 바깥 요청은 `doFetch`.
- AI 대화 기록은 뒤에 붙이기만 한다 (중간 수정 · 삭제, 대화 중 시스템 프롬프트 · 도구 변경 금지 → 바뀐 것은 `role: "system"` 메시지) (9차).
- 변경 후: `npm run test:v9` (9차 여러 PC · 보안 · 백업) → Electron · 설치 스크립트를 바꿨으면 `npm run test:electron` (Linux + Xvfb, 10차) → `npm run test:v8` (8차 데이터 정확성, 현장 엑셀 `seed/factory`) → `npm run test:v7` (재고·위젯·화면, ECOUNT 엑셀은 `seed/ecount`; 이전 버전 업그레이드까지 보려면 `ERP_PREV=<이전 소스 폴더>`, 예: `git worktree add /tmp/prev v1.2.0`) → `npm run test:assistant` (비서·화면·서버) → `npm run demo` → `npm run dist`. 현장 엑셀 파서는 `npm test -- <엑셀폴더> [all]`.

### 7. 다음 개선 아이디어 (요청 시)
사용자/권한(역할별 화면), 작업지시서·LOT 추적, 설비 가동 실시간 입력(태블릿), 바코드 입출고, 원가 계산, 인쇄 양식(PDF), 자동 업데이트.

### 2-3. 4차: AI 생산 비서
- 화면 우측 하단 "✦ AI 비서" 채팅 패널. 읽기 전용 도구를 Claude 에 tool-use 로 제공하고, 도구는 브라우저 안의 ERP 데이터(`ERP.calc`, `ERP.mrp`)로 실행한다. 데이터 수정 도구는 없음.
- 서버 모드: API 키는 `data/ai.json`(권한 600)에만 저장, `/api/ai/config`(GET 은 hasKey·끝 4자리만) · `/api/ai/messages`(Anthropic 프록시). 데모(file://) 모드: 키는 해당 브라우저 localStorage, 브라우저에서 직접 호출(`anthropic-dangerous-direct-browser-access`).

### 2-4. 5차: 나만의 비서 (내장 모드 + 개인 설정)
**구성 (3개 파일, 로드 순서 고정: tools → local → assistant)**
- `app/js/assistant_tools.js` — 읽기 전용 도구 9개: `overview`, `find_orders`, `get_po`, `material_stock`, `production_summary`, `quality_downtime`, `reorder`, `mrp`, `briefing` + Anthropic 도구 정의 `ERP.ai.toolDefs`. **AI 모드와 내장 모드가 같은 함수를 쓰므로 숫자는 항상 같고, 대시보드와도 같다.**
- `app/js/assistant_local.js` — **내장 모드** (API 키·인터넷 불필요, AI 가 아님). 한국어 / 베트남어(성조 있음·없음) / 영어 키워드로 질문 유형(브리핑·납기·수주·PO 상세·자재 재고·발주·생산 실적·불량/정지·MRP)을 인식 → 도구 실행 → 표 형태 답변 + 화면 이동 버튼. 이해하지 못하면 지어내지 않고 예시 질문을 보여준다.
- `app/js/assistant.js` — 채팅 창, 내 설정, AI 모드(도구 호출 루프 최대 8회, 오류 시 대화 기록 되돌림, AI 호출 실패 시 내장 모드로 자동 전환하고 이유 표시).

**숫자 정의 (화면과 동일하게 유지할 것)**
- 납기 경과 PO = 진행 중이고 납기 후 **60일 이내** (대시보드 KPI). 60일을 넘긴 PO 는 "오래된 지연(stale)"로 따로 센다 (대부분은 마감 처리 누락일 수 있으나 실제 미완료일 수도 있어 진행률 분포를 같이 보여준다). 참고: 메뉴 배지는 30일, 수주 화면 KPI 는 90일 기준이라 화면마다 창이 다르다.
- 납기 임박 = 7일 이내. 안전재고 판정은 안전재고를 설정한 품목만(설정 수를 함께 안내). 발주 권장 = 안전재고 × 배수 − 잔량.
- 포장은 set(= ok_qty, PO 수량 단위)과 pcs(= ok_ea) 를 함께 표시. 불량률 = ng ÷ (양품 + ng).
- MRP: BOM 이 없거나 BOM 에 부품 코드·배합표가 없으면 "계산 불가"로 알리고 절대 "부족 없음"이라고 하지 않는다. 같은 품번 BOM 이 없으면 앞부분이 같은 품번의 BOM 을 쓰고 그 사실을 알린다.

**나만의 설정** (저장 위치 `ERP.db.meta`, 백업에 포함, "전체 삭제"해도 유지)
`aiName`(비서 이름) · `aiUser`(호칭) · `aiStyle`(short/detail) · `aiPrompt`(우리 공장 지침, AI 모드 시스템 프롬프트에 합쳐짐) · `aiQuick`(내 단축 질문 최대 8) · `aiOff`(AI 사용 안 함 = 데이터가 외부로 나가지 않음).

**API 키 보호**: 서버 `data/ai.json` 에만 저장, 화면·백업·meta 에는 끝 4자리만. 키 변경은 ERP 가 실행 중인 PC(loopback)에서만 가능 (LAN 브라우저는 403). 데모는 브라우저 localStorage.

**확장 방법**
1. 새 질문 유형 = `assistant_tools.js` 에 도구 추가(+ `toolDefs` 설명) → `assistant_local.js` 의 `KW` / `decide()` / 답변 포맷터 / `answer()` 추가 → `tools/selftest_assistant.js` 의 `TABLE` 에 질문 추가.
2. 한국어 정규식에는 ASCII `\b` 를 쓰지 않는다 (베트남어 글자가 단어 경계로 취급되어 "lượng" 이 `ng` 로 인식됨). 라틴 문자 단어는 성조를 제거한 텍스트용 두 번째 정규식에만 쓴다.
3. 쓰기 기능(수주 등록, 일보 입력 등)을 추가할 때는 반드시 사용자 확인 단계를 거치게 한다. 현재 도구는 모두 읽기 전용이다.
4. 시험: `npm run test:assistant` (Playwright 필요 — `npm i -D playwright`; 설치된 Chrome/Edge 를 쓰려면 `CHROMIUM=<경로>`). 실제 Anthropic API 는 호출하지 않고 가짜 응답으로 도구 호출 루프·오류 복구·서버 프록시·키 보호를 검사한다.

### 2-5. 6차: ECOUNT 기준 품목 · 재고 (v1.1.0, 2026-10-16)
자세한 결정·숫자·검증표는 `docs/PROMPT_v6_ECOUNT.md`.

**결정**: 품목·창고·기초재고는 ECOUNT 자료(2026-10-16)로 다시 구성한다. 재고의 기준은 이 ERP다(ECOUNT = 기초재고 + 비교용 — 12차에서 비교는 없앰). 범위 2묶음 창고(WH) / 공장(FAC). 수불은 엑셀 업로드 + 화면 입력. 생산일보는 입고 + BOM 차감. 예전 샘플은 행 단위 "예시"로 남긴다.

**파일 (로드 순서: schema, db, calc, inv, ui, xl, ecount, p_dashboard, p_orders, p_production, p_stock, p_bom, p_data, assistant_tools, assistant_local, assistant, main)**
- `app/js/inv.js` 재고 엔진 + ERP CODE 사전. `C.stock(upTo)` 를 덮어쓴다(옛 계산은 `C.stockLegacy`). 반환 형식은 그대로(code, m, name, prim, bal, safety, status …)이고 `by{WH,FAC}`, `open`, `sets`, `pcs`, `negative`, `susp`(이동 누락 의심), `stage/line/sub/cat`, `hidden` 이 더해졌다.
- `app/js/ecount.js` ECOUNT 5종 + 수불 양식 detector/job. `XL.addDetector` 로 앞에 끼워 넣고, job 은 `apply`/`preview`/`modes()` 훅을 가질 수 있다.
- `app/js/p_stock.js` 품목 · 현장 재고 · 원부자재 재고 화면 (12차: 메뉴 3개, `ERP.goStock(탭)`), `ERP.itemDetail(code)` 품목 상세(수불부·쓰이는 곳·관련 PO).
- 표: `items`(통합 품목, 키 code) · `warehouses` · `code_dict`(level+parent+code) · `stock_open`(scope+code) · `stock_tx` · `uploads` (`ecount_snap` 은 12차에서 없앰).

**도메인 규칙**
- ERP CODE = `단계-제품군(분류)-세부-품목코드`. 단계 15칸 흐름: RM → SM → CM → WIP00(심) → WIP01(배럴) → WIP02(노즈콘) → WIP03(홀더) → WIP04(스푼) → WIPx6 → WIPx5 → WIP11 → WIP55 → WIP(조립) → SG(마니라) → FG(박스, CT). + ETC(코드 없음), TEST(T* 테스트, 숨김). FD 는 FG 로 본다.
- 이름 = 내장 사전 + `code_dict` 표(표가 이김). 확인되지 않은 코드(`guessed`)는 12차부터 이름을 비워 두고 코드만 보인다 ("이름 미정"). 이름은 사용자가 코드 사전에 넣거나 ERP CODE 설명 파일로 정한다.
- 수불 효과: IN → to +, OUT → from −, MOVE → from − / to +, ADJ → ±, PROD → 공장 +, USE → 공장 −. 기준일 당일까지의 수불은 기초재고에 들어 있다고 본다.
- 생산 반영(`prodPost` = in_bom / in / off)은 **저장하지 않고** `prod_log` 에서 매번 계산 → 같은 일보를 다시 올려도 중복 없음. 단위: CT 는 `set_per_ct` 필요, SET 은 set, kg 는 weight_kg, 그 외 pcs. BOM 찾는 순서: `bom_lines` → 조립(색상 코드 → 배럴·노즈콘·리필·홀더·스푼) → 리필(배합표 g/개 → kg) → 포장(세트의 색상별 1개). 진단(BOM 없음 · 품목코드 아님 · 환산 없음 · 원료명 미연결)은 수불 내역 탭에 보인다.
- 이동 누락 의심 = 한 범위 +, 다른 범위 −. 자료 점검 탭의 [이동 전표 만들기] 로 정리한다.
- ECOUNT 재고현황 업로드 = 기초재고 (다시 올리면 그 범위의 기초재고 재설정 — 확인 필수, 12차에서 "비교만" 은 없앰). 품목등록 재업로드는 지우지 않고 "숨김 후보"(missing)만 표시하고, ECOUNT 안전재고가 비어 있으면 ERP 값을 유지한다.
- 예시 데이터: 시드의 `_meta.sample` 표 행에 `_ex:1`. `ERP.sampleCount(t)` / `ERP.isSample(t)` / `ERP.sampleChip(t)`. 손으로 고치거나(`DB.update`) 업로드로 갱신된(`DB.upsert`) 행은 `_ex` 가 지워진다. 설정의 일괄 삭제는 `_ex` 행만 지운다.
- 5차 데이터 업그레이드: `DB.init` 에서 `meta.v6` 이 없으면 `DB.upgradeV6()` — 없는 품목코드만 추가, 빈 표(warehouses·code_dict·stock_open·uploads)만 채움, 5차 샘플과 같은 행에만 `_ex`. 5차 백업 복원 후에도 실행된다.

**확장 방법**
- 새 ECOUNT/현장 양식: `ecount.js` 에 detector(sheetName, 머리글 행렬) → job 을 만들어 `XL.addDetector` 로 등록. 머리글 비교는 `.normalize('NFD')` 로 성조를 지운 뒤 반드시 `.normalize('NFC')` 로 되돌린다(한글이 자모로 쪼개져 매칭 실패). 한국어 바로 뒤에 ASCII `\b` 를 쓰지 않는다.
- 재고에 영향을 주는 새 화면은 `stock_tx` 행을 추가한다(`src` 로 출처 구분, 외주는 `src:'outsource'`). 계산 캐시는 `DB.memo` 의 의존 표 목록에 새 표를 넣어야 갱신된다.
- 시드를 다시 만들 때는 `npm run seed:v6` (기본 `seed/ecount` 의 ECOUNT 엑셀을 실제 업로드 화면으로 반영해 seed.json 생성). 새 ECOUNT 자료로 바꾸려면 그 폴더의 파일을 교체한다.
- 시험: (6차 당시) `test:v6` 91개 — 7차부터 `npm run test:v7` 에 포함.

### 2-6. 7차: 위젯 종합 현황 · 생산현장 재고 · 표로 답하는 비서 (v1.2.0, 2026-10-16)
자세한 요청 원문·해석·규칙은 `docs/PROMPT_v7_WIDGETS.md`.

**결정**: "Checking 일" = PO `due`(납기) 열 → 월별 수주량은 Checking 기준 pcs. 일별 생산량 표 = 한 달 · 품목군별 · 조립(ASM) 기본(위젯과 생산 탭 모두). 원부자재 = RM·SM·CM, 생산현장 = WIP00 … FG. 위젯 배치는 서버(`meta.dash`)에 저장해 모든 PC가 같이 본다. 품목군 선택은 `meta.poKindsOff` 하나를 종합 현황과 수주 관리가 같이 쓴다.

**종합 현황 위젯** (`app/js/p_dashboard.js`)
- 등록: `reg(id, { ko, vi, dko, dvi, cat: kpi|prod|order|stock|etc, w: 기본 칸, sizes: [..], multi?, defaults?, opts?: [{k, ko, vi, options}], go?(ctx, inst), render(ctx, inst) })`. 26종. `ctx` 는 기준일 · 일보 색인 등을 처음 쓸 때 계산(지연)한다.
- 배치 `meta.dash = [{k, id, w, o}]` — `ERP.dashLayout()` · `ERP.dashSave(l)` · `ERP.dashMove(k, target, after)` · `ERP.dashAdd(id)` · `ERP.dashDefault()`. 위젯 안 상태(달 이동 등)는 `ERP.state['w_' + k]`.
- 편집 모드 `ERP.state.dashEdit`: 끌어 놓기(HTML5 DnD) · ◀ ▶ · 크기 · ⚙ 설정 · ✕ · 갤러리(`ERP.WIDGET_CATS`). 위젯 하나의 오류는 그 위젯 안에만 표시.
- 새 위젯 = `reg()` 하나 추가 (필요하면 `DEFAULT` 에 넣기) → `tools/selftest_v7.js` 13장 갤러리 수 확인.

**재고 · 생산 반영** (`inv.js`, `p_stock.js`, `p_bom.js`)
- 구분 `INV.groupOf(item)` → 'mat' | 'floor' | 'test'. 탭 `matTab`: mat · floor · post · entry · ledger · reorder · outsource · compare · check · codes · master · legacy (옛 'stock' 은 자동 변환).
- `code_map` 표: 일보 코드/원료 이름 → ECOUNT 품목코드. `INV.codeMap().daily(proc, div, src)` · `.raw(name)`. 제안 `INV.suggestDaily(proc, div, src, name, remark)` · `INV.suggestRaw(name)`.
- 조립 BOM 자동 구성: `INV.asmPlan()` → `[{parent, name, stage, line, sub, stp, parts:[{role, code, name, conf: high|review|none, how: name|name+code|shared|line-name|none, cands}], conf, existing, auto}]`, `INV.applyAsm(parents, {onlyHigh, pick, force})` → `bom_lines`(`src:'auto'`). 직접 만든 BOM 은 `force` 없이 덮어쓰지 않는다.
- 사출(INJ) 원료 차감 = 일보 `raw_kg` × 원료 이름 → RM 코드. 진단 `diag.mapped` · `diag.resin` · `notItem`(키 proc|div|src).

**비서 답변 = 블록** (`assistant_local.js` → `assistant.js`)
- 블록: `{t:'h'}` 제목 · `{t:'sec'}` 구역 · `{t:'p'}` · `{t:'note'}` · `{t:'list', items}` · `{t:'table', cols:[{l, num}], rows, title, more, cmt}` (`cmt` = 표 밑 ※ 코멘트). `answer()` 는 `{blocks, text, actions}` 를 주고, `A.blocksToText` 가 글자 버전을 만든다.
- AI 모드는 FORMAT 규칙(굵은 제목 · Markdown 표 · 표 밑 ※ 코멘트)으로 답하고 `A.renderMd` 가 안전한 Markdown 일부만 그린다.

**저장**: `DB.queueSave` 는 표마다 0.7초 묶어 저장(대기 수는 표마다 1). `DB.flush()` 는 대기 중인 저장을 바로 보낸다 — 설치형 창 닫기 · 재시작 전에 `electron/main.js` 가 기다린다.

- 시험: `npm run test:v7` 149개 + `npm run test:assistant` 240개.

### 2-7. 8차: 실제 사용 전 데이터 정확성 (v1.3.0, 2026-10-19)
자세한 문제 · 결정 · 검증은 `docs/PROMPT_v8_ACCURACY.md`, 작업 기록은 `docs/history/v8_work_log.md`.

**배경**: 계정을 옮기며 v1.2.0 전체를 검토했다. 현장 엑셀을 넣으면 입력이 사라지거나 숫자가 틀리는 문제가 있어 실제 사용 전에 고쳤다 (재현 시험 `tools/selftest_v8.js` 를 먼저 만들고 고침).

**규칙 (이후 버전에서도 지킬 것)**
- **일보 교체**: 일보(`source:'daily-report'`) · ERP 양식(`'template'`) 행은 날짜 · 공정 · 출처 · 조(`shift`) · 작업장(`workplace`)이 모두 같을 때만 바꾼다. 누적 시트(`'history'`)는 공정 · 기간 전체를 바꾼다. 같은 날짜 · 공정에 누적 행이 있으면 일보는 기본 건너뜀(`job.overlap`), `job.overlapMode='replace'` 면 그날 누적 행 대신 일보. 조 = 시트 이름 → 행의 DAY/NIGHT 칸 → D. 작업장 = 일보의 "1. 작업장명" 칸.
- **수주 키**: `po.nat` = po_no · po_no2 · item_no · date · kind · kind2 · color, `po.multi` → `DB.upsert` 는 같은 키 줄을 순번으로 맞춘다 (합치지 않음).
- **강제 완료 (13차)**: PO 줄의 `done_at`(완료 처리일)이 있으면 포장 실적과 상관없이 완료. 수주 목록의 완료 버튼 · `C.closeByDue`. 아래 2-12.
- **원부자재의 기준 (14차)**: 창고 입출고장(BẢNG KÊ NHẬP XUẤT) — 품목 · 1월 1일 기초재고(기말 − 입고 + 출고) · 입출고. ECOUNT 재고현황은 없는 품목만 보완 (마이너스 0). 아래 2-13.
- **취소 · 보류**: `C.poCond(p)` ('cancel' · 'hold', Condition 칸). 표시가 있으면 줄 상태 = cancel/hold. PO 는 모든 줄이 취소/보류면 취소/보류, 아니면 그 줄을 뺀 줄로 계산. 진행 중 = `C.isOpen(o)`.
- **포장 일보**: `code` = PO 품번(열 1 → 열 0), `item` = 재고 품목코드(완제품 열 1), `ok_ct` = 실적 CT. 생산 반영은 `item` → `code` → `code_map`, CT 품목은 `ok_ct` 가 있으면 그대로.
- **품목군(일보)**: 누적 시트의 같은 코드 → ERP CODE 제품군별 누적 최빈값 → 설비 이름. **설비** = `C.machKey(r)` (공정 + 종류 + 번호).
- **기초재고 기준일**: 범위마다 `meta.openDate` (ECOUNT 재고현황 "기초재고로 설정" 때 저장, 없으면 `DB.upgradeV8` 가 행 날짜 최댓값으로 채움). 기준일 당일 · 이전 수불은 재고에 더하지 않으므로 입력 화면이 경고한다. 자동 수불 날짜 = `INV.suggestDate()`.
- **입출고장(KHO NVL)**: 원부자재 품목으로만 넣는다 (창고코드 → 품번 → Mã XNK 후보를 품번 앞부분 · 품명으로 좁힘 → VN 접미어).
- **날짜 · 숫자**: `ERP.fmt.parseDate` (일 먼저, 앞자리 13 이상이면 월 먼저, 못 읽으면 null → 미리보기에 표시하고 반영 안 함), `ERP.fmt.parseNum` (애매한 1.234 는 이 PC 숫자 형식 또는 설정 `numFmt`). 파일명 날짜 = `XL.fileDate`.
- **구글 시트**: 올릴 때 `types` 를 보내고 `google/Code.gs` 2판이 글자 · 날짜 열을 텍스트(@) 형식으로 쓴다 (ping `ver: 2`).
- **원료 연결**: 사출 원료는 사용자 연결(code_map raw)이 이름 매칭보다 먼저, 양품 0 이어도 원료 차감.
- **캐시**: 생산 반영 · 재고 캐시 키에 기준일 · 공정 단위 포함.
- 시험: `npm run test:v8` 72개 + `npm run test:v7` 149개(ERP_PREV) + `npm run test:assistant` 240개.

### 2-8. 9차: 여러 PC 동시 사용 · 보안 · 자동 백업 · AI 비서 (v1.4.0, 2026-10-19)
자세한 문제 · 결정 · 검증은 `docs/PROMPT_v9_MULTIPC_AI.md`, 작업 기록은 `docs/history/v9_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **저장 충돌**: 서버 `versions.json` 의 표별 저장 번호. 화면 `DB.sver` · `DB._base`(행 지문) → `PUT /api/t/:name` + `X-Base-Ver`, 409 면 `merge3` 로 합쳐 다시 (둘 다 고친 행 = 나중 PC, 지움 ↔ 고침 = 고친 행). 설정은 `PATCH /api/meta {set, del}`. 불러오기 `DB.poll()` 20초 · 창 포커스, 화면은 `ERP.onRemote` → 조용할 때 `ERP.refresh()`(스크롤 유지).
- **저장 안정성**: 실패하면 다시 시도(2초 → 1분), `DB.flush()` 는 보내는 중인 저장 · 설정까지 기다림. `DB.pending` = 아직 저장 안 된 표 수.
- **보안**: Host = 이 PC 이름 · IP · localhost(+ `ERP_ALLOW_HOSTS`), Origin 같은 곳, 쓰기는 JSON 만. 사내망 PIN(`lan.json`, pbkdf2, 쿠키 7일, 5번 틀리면 잠금) — loopback 은 면제, PIN 없으면 다른 PC 불가. PIN · AI 키 · 백업 설정은 loopback 에서만.
- **자동 백업**: `backup.json` (dir · keep · google) → 하루 한 번 `ERP_backup_YYYY-MM-DD.json` + (선택) Code.gs 3판 `backup`(gzip). 복원은 .json · .json.gz.
- **AI 비서**: 대화는 뒤에 붙이기만 (시스템 프롬프트 대화 시작 때 고정, 바뀐 날짜 · 언어 · 설정 = `role: "system"` 메시지, 30만 자 넘으면 요약으로 새 대화). `max_tokens` 16000 · effort low/medium · 캐시 · `fallbacks: "default"`(받는 모델만) · 429/529 retry-after · refusal / max_tokens 는 기록에 안 남김 · 도구 오류 `is_error` · 마지막 호출 `tool_choice: none` · 도구 결과는 `<목록>_total/_truncated`. 중계(`aiBody`): 모델 = 서버 설정, 정해진 필드만, 서버 도구 거절, 하루 한도(기본 400) · 사용량 `ai_usage.json`. 데모 키는 메모리에만. 설치형은 `net.fetch`.
- 시험: `npm run test:v9` 87개 + `npm run test:assistant` 289개 + `npm run test:v8` 72개 + `npm run test:v7` 149개(ERP_PREV).

### 2-9. 10차: 부품 업데이트 · 설치 파일 · 날짜 형식 안내 (v1.5.0, 2026-10-19)
자세한 내용은 `docs/PROMPT_v10_PARTS.md`, 작업 기록은 `docs/history/v10_work_log.md`.
- **Electron 44.5.1** (33 에서), **electron-builder 26.15.3** (25 에서, 빌드 도구 취약점 해소). `will-navigate` 는 `event.url`. Electron 을 올리면 `npm run test:electron` (`tools/smoke_electron.js`: 서버 모드 · 바깥 주소 · 팝업 · X 버튼으로 닫을 때 저장 · 종료 코드).
- **설치 · 삭제 중 실행 감지**: 설치 폴더의 exe 를 쓰기 모드로 열어 보고 실패하면 "실행 중 — 닫고 다시 시도" (`CheckRunning` / `un.CheckRunning`).
- **현장 일보 날짜**: `docs/GUIDE_EXCEL_DATES.md` (생산일자 칸 위치 · `2026-10-08` 또는 `08/10/2026` · 데이터 유효성 검사 · 지역 형식).
- **SheetJS 0.20.3 은 보류**: cdn.sheetjs.com 이 작업 환경에서 막힘. 열리면 `app/lib/xlsx.full.min.js` + 개발용 `xlsx` 교체 후 v7 · v8 · import 시험.

### 2-10. 11차: 공정 중(현장) 재고 · 원부자재 분리 · 배럴 계열 · BOM 사용량 (v1.6.0, 2026-10-20)
자세한 요청 원문 · 해석 · 규칙은 `docs/PROMPT_v11_FLOOR.md`, 작업 기록은 `docs/history/v11_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **원부자재는 생산 반영으로 절대 차감하지 않는다**: `INV.postRows` 는 원부자재(`isMatItem` = `INV.groupOf` 'mat') USE 를 만들지 않고, 사출 수지(`raw_kg`) · 배합표 원료(recipe kid)도 차감하지 않는다 → `diag.matSkip` (코드 · 원료 이름별 행 · 수량)에만 남긴다. 8차의 "사출 원료 차감 · 원료 연결로 차감" 규칙은 이것으로 바뀌었다 (원료 연결 `code_map raw` 는 진단에 이름을 붙일 때만 쓴다). 원부자재 재고는 수불(입고 · 출고 · 이동 · 조정)로만 바뀐다.
- **공정 중 재고 = 현장 실사**: 인식기 `floor_count` (머리글 `Mã mặt hàng · ERP CODE · SẢN XUẤT`, 시트마다 TOTAL). `stock_open` 행에 `grp: 'floor'` · scope FAC · `file` · `sheet`, 기준일 `meta.openDate.FLOOR` (파일 이름의 날짜, 화면에서 고칠 수 있음). WIP 단계(`INV.WIP_STAGES`)만 받고 원부자재 · 포장품 · ERP CODE 없는 행은 제외로 보인다. 품목 마스터에 없으면 ERP CODE 로 만든다(`src: 'floor'`).
- **현장 실사가 있으면** 공정 중 품목의 기초 = 현장 실사 행만 (ECOUNT 의 같은 품목 숫자 무시), 기준일 = 현장 실사일 (`INV.openDateFor(item)` — 수불 · 생산 반영 · 수불부 · 수불 입력 경고 모두). ECOUNT 재고현황 "기초재고로 설정" 은 `grp: 'floor'` 행을 지우지 않는다. 현장 실사를 다시 올리면 다른 파일 · 기준일의 현장 실사 행을 모두 바꾼다 (같은 파일의 시트는 차례로 더함).
- **배럴 계열**: `WIP[2-9]1` → 단계 `WIPx1` (이름 미정 — 화면에는 WIP21·31…), `INV.BARREL_STAGES = WIP01 · WIP11 · WIPx1`. 조립 BOM 배럴 후보 순서 WIP11 → WIPx1 → WIP01, 스탬핑 일보 제안 WIP11 · WIPx1. `DB.upgradeV11` 이 예전에 ETC 로 저장한 WIPn1 품목을 다시 분류.
- **BOM 사용량(배합표)**: 인식기 `recipes_usage` (`components` 시트, 첫 칸 `code` + `item code` + `color`), 기본 전체 교체, 같은 code 는 첫 행, 글자 열 = `note`, `열N` · 빈 열 제외, `meta.recipeSrc` 기록(배합표 탭에 표시). 소요량 · 신고서용 — 재고 차감 없음. `XL.apply` 는 반영 뒤 `job.after` 를 부른다, 업로드 화면은 `job.onFile` 을 부른다.
- 시험: `npm run test:v11` 50개 + v9 · v8 · v7 · assistant (사출 원료 · 원료 연결 기대값을 11차 규칙으로 고침).

### 2-11. 12차: 메뉴 3개 (품목 / 현장 재고 / 원부자재 재고) · ECOUNT 비교 없앰 · 이름 미정은 코드만 (v1.7.0, 2026-10-20)
자세한 요청 · 결정은 `docs/PROMPT_v12_MENUS.md`, 작업 기록은 `docs/history/v12_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **메뉴 3개**: `ERP.pages.items` (품목: master · codes · check · legacy), `ERP.pages.floor` (현장 재고: floor · post · fentry · fledger), `ERP.pages.materials` (원부자재 재고: mat · entry · ledger · reorder · outsource). 메뉴마다 고른 탭은 `ERP.state.itemTab` · `floorTab` · `mtab`. 새 재고 탭을 만들면 `p_stock.js` 의 `MENUS` · `TAB_PAGE` · `TAB_FN` 에 넣는다.
- **다른 화면에서 재고 탭으로**: `ERP.goStock(탭)` (그 탭이 있는 메뉴를 연다), `ERP.openStock(단계)` (단계 그룹의 메뉴를 그 단계 필터로). 예전 방식 `ERP.state.matTab = '탭'; ERP.goto('materials')` 도 맞는 메뉴로 보낸다 (`'stock'` → 단계 그룹, `'compare'` → 원부자재 재고).
- **현장 / 원부자재는 끝까지 따로**: 수불 입력 (`txe` / `txe_floor`) · 수불 내역 (`txl` / `txl_floor`) · 재고 표 (`stk_mat` / `stk_floor`) · 왼쪽 메뉴 배지 · 품목 목록(datalist) 모두 `INV.groupOf` 로 나눈다. 다른 쪽 품목은 입력에서 막는다. 생산 반영 자동 행은 현장 재고 수불 내역에만. 발주 · 안전재고는 원부자재만.
- **ECOUNT 비교 없음**: `ecount_snap` 표 · 비교 탭 · 재고현황 "비교만" 방식을 지웠다. 다시 만들지 않는다 (ECOUNT 는 2026-11 부터 쓰지 않음). ECOUNT 파일은 처음 자료(품목 · 창고 · ERP CODE 설명 · 기초재고)를 옮길 때만.
- **이름을 짐작하지 않는다**: 내장 사전에서 확인되지 않은 코드(`guessed`)는 이름이 빈칸이고 `INV.label` · `labelShort` 는 코드를 돌려준다 (묶음 단계는 `INV.stageCodeShow`: WIP06·x6 · WIP15·25·35 · WIP21·31…). 화면 글 · 시험 이름 · 문서에도 짐작한 이름을 쓰지 않는다. 물음표(?) 표시도 쓰지 않는다. 이름은 사용자에게 묻거나 사용자가 코드 사전 · ERP CODE 설명 파일로 넣는다.
- **코드 사전 저장**: guessed 줄은 빈 이름에서 시작, 이름을 넣으면 `guessed: false`, 이름이 모두 비면 `guessed: true`. 저장 뒤 다시 그리지 않는다 (입력 포커스 유지).
- **자료 올리기 결과 버튼**: 현장 실사 · 생산일보 → 현장 재고, 재고현황 · 수불 → 원부자재 재고, 품목 · 창고 · 코드 → 품목.
- **화면에 "null" 글자 금지**: `Element.append` · `replaceChildren` 에 null 을 넘기면 "null" 글자가 붙는다. 빈 값이 섞일 수 있으면 `ERP.put(el, ...)` (빈 값은 빼고 붙임) 를 쓰거나 `.filter(Boolean)` 으로 거른다. `h()` 는 null 을 건너뛴다. 공용 표(`ERP.grid`)의 빈 표 · 재고 · 수불 내역 · 외주 · 예시 자료 · 조립 BOM 에서 "null" 이 보이던 것을 12차에서 고쳤다.
- 물음표 표시도 쓰지 않는다: 이동 누락 의심은 "이동 누락" (말풍선에 "이동 누락 의심").
- **1.7.1 (2026-10-21)**: 사용자가 단계 이름을 정함 — CM = 소모품 (Vật tư tiêu hao), WIP06·x6 · WIP15·25·35 · WIP11 · WIP21·31… · WIP55 = 부품 (Linh kiện). 내장 사전에 넣음 (이름 미정은 34개: 제품군 2 · 세부 14 · 분류 18). 여러 단계가 같은 이름을 쓸 수 있으므로 목록 · 필터 · 미리보기는 `INV.stageTitle(code)` ("부품 · WIP11"), 단계 카드는 이름 아래 코드 줄.
- 시험: `npm run test:v12` 123개 (모든 화면 null · undefined 글자 검사 포함) + v11 · v9 · v8 · v7 · assistant (v7 의 ECOUNT 비교 시험은 "비교 없음 · 기초재고 재설정 경고" 로 바꿈).

### 2-12. 13차: 수주 강제 완료 — 완료 버튼 · 납기 기준 일괄 완료 (v1.8.0, 2026-10-21)
자세한 요청 · 결정은 `docs/PROMPT_v13_PO_DONE.md`, 작업 기록은 `docs/history/v13_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **완료 판단**: 줄 상태 = 포장 실적 ≥ 세트면 done, 아니면 납기 경과 late / 포장 중 prod / 대기 wait. **`done_at`(완료 처리일)이 있으면 done** (강제 완료). 그다음 취소 · 보류 표시가 이긴다. 줄에 `forced`, PO 에 `forced` · `doneAt`.
- **강제 완료는 사용자가 누른 것만**: 수주 목록(PO별 보기)의 **완료** 버튼 · 상세 칸의 **완료 처리** (확인 창). 그 PO 의 진행 중 줄에만 `done_at = 오늘`. **완료 취소** 는 `done_at` 을 지운다. 자동으로 넣지 않는다.
- **일괄 완료** `C.closeByDue(from, to, note)` — 납기(Checking)가 from ~ to 인 진행 중 줄 → 완료, 업로드 이력 `kind: 'po_close'`. 기간 · 기준은 사용자가 정한다 (2026-10-21: 납기 2025-01-01 ~ 2026-09-30, 347줄).
- 수주 엑셀을 다시 올려도(upsert) `done_at` 은 남는다. "전체 교체" 는 지운다.
- AI 비서 수주 도구: 강제 완료면 `remaining_sets` 0, `marked_done`.
- 시험: `npm run test:v13` 28개 + v12 · v11 · v9 · v8 · v7 · assistant.

### 2-13. 14차: 창고 입출고장 → 원부자재 재고 · ECOUNT 재고현황으로 보완 (v1.9.0, 2026-10-21)
자세한 요청 · 결정은 `docs/PROMPT_v14_WAREHOUSE.md`, 작업 기록은 `docs/history/v14_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **열**: A 전표번호 쓰지 않음 · C 입출고일 · D 업체코드 → `partner_code` · E 업체 → `partner` · F 품목코드 · G 세관신고 코드 → 품목 `xnk` · H 품목명 (베트남어 → 한국어 `EC.viToKo`, 원문 `name_vn`) · I 내용 → `purpose` · `lot` · `color` · `note` (`EC.splitContent`) · J 개당 kg → `kg_per_ea` · L/M 입고 · N/O 출고 · P/Q 기말 재고 (품목마다 같은 값).
- **품목 맞추기** (`resolveWh`, 반영할 때): 같은 코드 원부자재 → 제품번호(마지막 마디 0xx)로 적은 카톤 · 케이스는 Mã XNK + 앞 3마디가 같은 원부자재 하나 → 그 밖은 새 품목 (출고 내용 NL → RM kg, vật tư → SM 개). 한 ERP 품목에 창고 코드 둘 이상이면 합치지 않는다 (`pairs` 로 알림 — 사용자가 2026-10-21 네 쌍 모두 다른 물건으로 확인). 같은 코드가 **반제품(WIP · SG)이면 그 품목의 창고 재고**로 넣고 (1.10.1, `how: 'floor'` — 외주에서 받아 창고에 있는 반제품), **완제품(FG)이면 넣지 않는다** (창고는 완제품 번호로 포장 카톤을 적음).
- **원부자재 코드에는 생산량을 입고하지 않는다 (1.10.2)**: 창고 입출고장에서 완제품 번호로 들어온 포장 카톤(`CARTON - …`, SM, `src: 'wh'`)이 원부자재 품목이 되어, 같은 번호로 적힌 포장 일보(PO 품번)의 생산량이 카톤의 공장 재고로 들어가던 문제 (2026-10-21 생산 초기 입력 → 카톤 37개에 수백만 개). `INV.postRows` 는 원부자재(`isMatItem`) 품목에 PROD 를 만들지 않고 `diag.matProd` (코드별 행 · 일보 수량, 포장은 set)에만 남긴다 → 현장 재고 → 생산 반영 "원부자재 코드는 생산 입고하지 않음 (규칙)". BOM 현장 부품 차감 · 수주 진행(포장 실적) · 생산 관리 집계는 그대로. 원부자재 재고는 창고 수불로만 바뀐다 (11차 "차감하지 않는다"와 짝).
- **공정 중 품목의 창고 칸 (1.10.1)**: 현장 실사가 있어도 창고 입출고장 기초재고(grp 'wh')가 있는 공정 중 품목은 창고 칸 = 그 기초재고 + 창고 기준일 뒤 입출고, 공장 칸 = 현장 실사 (`INV.opening().whl`). 현장으로 분출 = 이동(창고 → 공장).
- **기초재고**: WH, 첫 입출고일 전날, 기말 − 입고 + 출고 (품목 단위로 환산), 마이너스면 0 + 마지막 날 ADJ (`purpose: '기말 재고 맞춤'`). 0 인 품목도 줄을 만든다. `grp: 'wh'`, `meta.openDate.WH` = 그 날.
- **출고 = 창고 → 외부** (원부자재 재고에서 빠짐, 생산 투입 포함 — 11차 규칙과 맞춤). `src: 'wh'`, 다시 올리면 같은 기간을 바꾼다.
- **ECOUNT 재고현황**: ERP CODE · Mã XNK 칸이 있으면 품목 작업(`ecount_items_stock`, 있는 칸만 · 숨김 후보 없음). 창고 입출고장과 같이 올리거나 `grp: 'wh'` 기초재고가 있으면 방식 `fill` — 기초재고가 있는 품목은 그대로, 없는 품목만 (마이너스 0, 현장 실사가 있으면 공정 중 품목은 뺌), `grp: 'fill'`.
- 업로드 화면은 파일을 모두 읽은 뒤 `job.onBatch(jobs, self)` 를 부른다 (XL.analyze 가 작업을 복사하므로 self 를 고친다).
- 시험: `npm run test:v14` 51개 + v13 · v12 · v11 · v9 · v8 · v7 · assistant.

### 2-14. 15차: 자동 업데이트 · 휴대폰으로 보기 (v1.10.0, 2026-10-21)
자세한 요청 · 결정은 `docs/PROMPT_v15_UPDATE_MOBILE.md`, 작업 기록은 `docs/history/v15_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **Release = 모든 PC 배포**: Release 워크플로가 설치 파일과 함께 `latest.json` `{version, file, sha256, size}` 를 올리고, 1.10.0 이상이 설치된 PC 는 `<releases>/latest/download/latest.json` 을 보고 자동 업데이트한다. main 버전의 Release 만 latest. latest.json 이름 · 형식 · 설치 파일 이름 규칙(`ColorPencil-ERP-Setup-<버전>.exe`)을 바꾸지 않는다.
- **자동 업데이트** (`electron/updater.js`): 켠 뒤 1분 · 4시간마다 확인 → 받기 (크기 · SHA-256) → **다음에 켤 때** 또는 **[지금 업데이트]** 로 설치. 일하는 중에 저절로 다시 시작하지 않는다. 설치 전 데이터 폴더 복사 (`update_backup`, 최근 5). 같은 설치가 두 번 안 되면 저절로 다시 하지 않음. 설치형(Windows · packaged)만 설치. 설정 `config.json` `autoUpdate`.
- **설치 프로그램 `/UPDATE`**: 진행 막대만 · ERP 가 닫히기를 30초 기다림 · 끝나면 ERP 다시 켬 · 바탕화면 바로가기를 다시 만들지 않음. ERP 는 `/UPDATE /D=<설치 폴더>` 로 부른다 (`/D=` 는 맨 끝 · 따옴표 없음 → `windowsVerbatimArguments`).
- **업데이트 API**: `GET /api/update` (보기 — 다른 PC 도), `PUT /api/update` · `POST /api/update/check` · `POST /api/update/install` 은 loopback 만.
- **휴대폰 (공장 Wi-Fi)**: 사내망 접속 그대로. 화면은 휴대폰 폭(390)에서 옆으로 밀리지 않게 만든다 — 새 화면 · 카드를 만들면 `npm run test:v15` 의 휴대폰 폭 시험에 넣는다 (`white-space: nowrap` 은 좁은 화면에서 풀리게, 넓은 표는 `.tbl-wrap` 안에서 옆으로). 900px 이하는 메뉴를 [☰] 로 접는다.
- **휴대폰 (공장 밖, 구글 웹 앱 Code.gs 4판)**: 요약 `ERP.mobileSummary()` 는 종합 현황과 같은 계산 (`ERP.dashCtx`) — 종합 현황 숫자를 바꾸면 요약도 같이 바뀐다. 이 PC 만 15분마다 보냄 (`mobileOn`). 비밀번호는 구글 쪽 해시로만, ERP 에 남기지 않는다. 휴대폰 화면 글자는 textContent 로만.
- **월별 조립 생산량 (1.10.1)**: 종합 현황 위젯 `asm_monthly` (기본 배치에서 `asm_daily` 다음, 저장한 배치에는 `meta.dashAsmMonthly` 로 한 번만 넣음) · 생산 관리 탭 `analysis` (일별) · `monthly` (월별) · 휴대폰 요약 `asmDaily` · `asmMonthly`. 일별과 월별은 항상 같이 둔다 (사용자가 둘 다 요구).
- 시험: `npm run test:v15` 155개 + GitHub Actions "자동 업데이트 시험 (Windows)" (`tools/update_e2e.js` — 실제 설치 프로그램 · Electron) + v14 · v13 · v12 · v11 · v9 · v8 · v7 · assistant.

### 2-15. 16차: 해외 주문 품목 — 자재구매 파일 · 리드타임 (v1.11.0, 2026-10-21)
자세한 요청 · 결정은 `docs/PROMPT_v16_BUY.md`, 작업 기록은 `docs/history/v16_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **자재구매 파일 = 해외 주문 품목 목록 · 안전재고 · 주문의 기준**: 인식기 `buy_list` (머리 Item Code · Safety stock · Inventory). 품목 `buy` · `buy_cat` · `name_kr` · `buy_ord` · `buy_unit` · `buy_inv`(파일 재고) — 파일에 없는 품목은 `buy` 를 끈다. 안전재고는 단위가 같으면 `safety`, 다르면 `buy_safety`. 없는 코드는 파일 이름 · 단위로 새 품목 (`src: 'buy'`, kg → RM, 그 밖 SM).
- **주문 `buy_orders`**: 주문일 칸 = 그 날 주문, 입고예정 칸 = `kind: 'inc'` (주문일 칸과 따로 — 파일의 Total = Inventory + 입고예정 + 주문일 칸). 다시 올리면 파일에 있는 주문일 · 품목의 입고 대기 주문과 입고예정은 파일 값, 입고 완료 · 파일에 없는 날짜는 그대로. **입고 완료는 합계에서 빼기만** (재고는 창고 입출고장 · 수불 — 두 번 세지 않음).
- **원부자재 재고 → 해외 주문 탭** (`ERP.buyTab`, 버튼 "해외 주문 품목만 N"): 칸 순서는 파일과 같게 (구분 … 평균) + 리드타임 · 도착 예정 · 상태 · 권장 주문량. 재고 = ERP 원부자재 재고 (단위가 다르면 개당 kg), 파일 재고와 다르면 "파일 …". 월 사용량 = 창고 출고(OUT · 창고 → 공장 이동) 지난 12달 ~ 지난달.
- **리드타임**: 품목 `lead_days` 또는 기본 `buyLead` (사용자가 정함, 비면 리드타임 없이). 주문 필요 = 합계 − 월 평균 ÷ 30 × 리드타임 < 안전재고, 권장 = 안전재고 + 리드타임 동안 쓸 양 − 합계 (kg 품목은 개당 kg 단위로 올림).
- 발주 필요 목록은 해외 주문 품목을 빼고 안내한다 (해외 주문 탭에서 따로).
- **재고 = 자재구매 파일의 재고 (1.11.1, 사용자 2026-10-21 "H열(Inventory) 값이 맞다")**: 올리면 `buy_stock` 이 파일 날짜의 ERP 재고와 H열의 차이를 조정(ADJ · 창고 · `src: 'buy'` · "자재구매 파일 재고 맞춤")으로 넣는다. 같은 날짜 파일을 다시 올리면 그 날의 이 조정만 다시 계산 (늘지 않음), 창고 입출고장을 다시 올려도 그대로.
- **같은 코드 · 다른 구분 = 따로 관리하는 재고 (1.11.2, 사용자: BIC 업체 요청으로 창고를 나눠 원료를 따로 관리)**: 자재구매 파일의 첫 줄은 ERP 품목, 같은 코드의 다른 구분 줄은 `buy_pools` (재고 = 파일 값, 안전재고 · 리드타임 따로), 주문은 `buy_orders.pool`. 재고 맞춤은 첫 줄만. 같은 구분 두 번은 첫 줄. 해외 주문 탭의 줄 열쇠 = 코드 + 구분 (`r.key`).
- **주문 파일은 ERP 가 만든다 (1.11.3, 사용자 2026-10-21)**: 권장 주문량 = 안전재고 + 리드타임 동안 쓸 양 − 합계를 **주문 단위**로 올림 (품목별 `buy_step` · pool `step`, 없으면 안전재고 자릿수 `ERP.buy.stepOf` — 백 단위 100, 천 단위 1,000 …). [주문 파일 만들기] = 이번 주문일 칸에 권장 주문량을 넣고 자재구매 파일과 같은 서식의 엑셀 (`ERP.buy.orderBook`: 시트 · 제목 · Author(`meta.buyHead`) · Date · 4행 머리 · Total 수식, 다시 올리면 인식). 따로 관리 재고는 표에서 고치고 입고 완료가 그 재고에 더한다.
- **현장 재고 위 칸 = 공정별 · 대분류 현재 재고 (1.11.4, 사용자 2026-10-21)**: 단계 카드 대신 `INV.procOfStage` (단계의 공정) × 제품군을 일보 품목군 이름으로 (`INV.LINE_DIV`: MINI Mini · REG Dial · PEN Pencil · CPC Click pencil · GLA Glass · MARKER Marker), 색깔 구분 없는 재고 합 (단위가 다르면 나눔). 원부자재 재고는 단계 카드 그대로. 생산 관리 일보 조회에 PO 번호 + 수주 보기 (`ERP.openPo`). → 1.12.0 (17차) 에서 이 칸은 피벗 표로 바뀜 (2-16).
- **다시 올려도 ERP 에서 넣은 값은 그대로 (1.11.5)**: 자재구매 파일의 주문일 · 입고예정 칸은 `src: 'file'` 주문만 바꾸거나 지운다 (ERP 주문은 그대로), 안전재고는 처음 목록에 들어올 때 · 비어 있을 때만 파일 값, 따로 관리 재고의 안전재고는 그대로 · 재고는 파일 날짜가 더 새것일 때만. 실제 ERP 자료에 무엇을 다시 올리기 전에는 사용자가 그동안 바꾼 것과 비교한다 (2026-10-21 사고).
- 시험: `npm run test:v16` 84개 + v15 · v14 · v13 · v12 · v11 · v9 · v8 · v7 · assistant.

### 2-16. 17차: 현장 재고 피벗 표 · 포장 누계 pcs · 지난달 값 · 기본 배치 (v1.12.0 ~ 1.12.5, 2026-10-22)
자세한 요청 · 결정은 `docs/PROMPT_v17_PIVOT.md`, 작업 기록은 `docs/history/v17_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **현장 재고 위 = 피벗 표 목록** (`app/js/pivot.js` `ERP.floorPivot`, 사용자 2026-10-22 "두번째사진(월별 조립 생산량) 형태로 조립부분만 … 다른공정들은 커스텀마이징 … 엑셀 피벗테이블처럼"):
  - 기본 표 = 조립 · 품목군 | 현재 재고.
  - 표마다 공정 · 품목군 거르기, 행 (품목군 · 공정 · 단계 · 품목), 열 (없음 = 현재 재고 한 칸 · 공정 · 품목군 · 단계), 범위, 제목, 재고 0 줄을 고른다.
  - 저장은 설정 `floorPivots` (모든 PC 같음). 연도 · 설정 열림은 화면 상태다.
  - 1.11.4 의 공정별 · 대분류 칸은 없앴다. 품목군 이름 (`INV.lineDivName`) · 공정 (`INV.procOfStage`) 은 1.11.4 와 같다.
- **값은 현재 재고만 (1.12.1, 사용자 "현재 재고잖아 월별은 필요없어 현재재고만 보여주면된다")**: `INV.rows()` — 아래 품목 표와 같은 계산. 월 열 · 연도 단추는 없다 (1.12.0 에 저장한 `cols: 'month'` 는 현재 재고 한 칸으로 읽음).
  - 공정 · 품목군 · 단계 열에는 줄 합계 열이 있다. 현재 재고 한 칸 표는 좁은 카드로, 여러 공정 표가 한 줄에 나란히.
- **단위가 섞이면 줄 · 합계를 단위별로** 나눈다 (포장 SET · CT). 재고 0 줄은 숨긴다 (설정으로 보기).
- 칸을 누르면 아래 품목 표를 `stk_floor.proc · line · stage` 로 거른다. 품목 줄은 수불부로 간다.
- **종합 현황 위젯 `floor_stock` (1.12.2, 사용자 "종합 현황에 이거 추가할수있게 해줘")**: "현장 재고 (공정별 현재 재고)" — 같은 피벗 계산 · 표, 가로 1칸, 여러 개, ⚙ 공정 (기본 조립) · 행 · 열, 칸을 누르면 현장 재고 (`ERP.pivot.pick`). 기본 배치에는 넣지 않는다 (사용자가 "+ 위젯 추가" 에서).
- **이번 달 포장 누계 = pcs (1.12.3, 사용자 "pcs로 표시해줘 세트가 아니고")**: `kpi_pck_month` = 포장 일보 pcs 칸(`ok_ea`) 합 (`ctx.pckPcs`), 전월 동기 대비도 pcs. pcs 가 비었거나 0 인 줄은 세트를 pcs 로 세지 않고 "pcs 없는 일보 N줄 (M세트) 빠짐" 으로 알린다. 휴대폰 요약 `pckMonth.ea · prevEa` · Code.gs 도 pcs. 기준일 포장 실적은 세트 그대로.
- **숫자 카드 아래 지난달 값 (1.12.4, 사용자 "따로 칸을 만들라는 말이 아니다. 같은칸 공간 남는거에")**: 이번 달 포장 누계 · 신규 수주 · 수주량(Checking) 카드 안 맨 아래(`withLast` · `.kpi-prev`)에 지난달 (1일 ~ 말일) 값. 새 위젯을 만들지 않는다.
- **종합 현황 기본 배치 = 사용자 배치 (1.12.5, 사용자 "이순서대로 하고 이게 기본세팅이야")**: 이번 달 포장 누계 · 신규 수주 · 수주량 · 조립 재고 (한 줄) → 월별 수주량 (차트 · 4칸) · 공정별 실적 (4칸) · 월별 조립 생산량 (조립 · 차트 · 4칸). 안전재고 미달 · 일별 조립 등 예전 기본 위젯은 "+ 위젯 추가" 에서. 15차의 "기본 배치에서 asm_daily 다음" 은 예전 기본 배치 이야기다. 기본 배치를 다시 바꾸려면 사용자에게 묻는다.
- 시험: `npm run test:v17` 67개 + v16 · v15 · v14 · v13 · v12 · v11 · v9 · v8 · v7 · assistant.

### 2-17. 18차: 여러 PC 자료 공유 — 구글 드라이브 (v1.13.0 ~ 1.13.4, 2026-10-22 ~ 24)
자세한 요청 · 결정은 `docs/PROMPT_v18_CLOUD.md`, 작업 기록은 `docs/history/v18_work_log.md`.

**규칙 (이후 버전에서도 지킬 것)**
- **PC 마다 설치한 ERP 끼리 자료 공유 = 구글 드라이브** (사용자 2026-10-22 "직원이 입력하고 자료입력한게 업데이트 되야하는데 … 구글시트.드라이브 연동해야돼"):
  - ERP 서버 `cloudsync.js` 가 표마다 구글 쪽 저장 번호를 보고 바뀐 표만 주고받는다 (30초마다 · 저장 뒤 3초 · 끄기 전). 화면이 아니라 서버가 한다.
  - 구글 쪽 = `google/Code.gs` 5판: 표마다 드라이브 파일 하나 (`ColorPencil ERP Data/<표>.json.gz.b64`) · 스크립트 속성 `T_<표>` · 저장소 이름표 `CLOUD_ID` · `cloud_info / cloud_get / cloud_put` (번호가 같을 때만 씀).
  - 합치기는 화면 db.js 와 같은 3-way merge (행 `_id` · 지문). 둘 다 고친 행은 나중에 맞춘 PC 내용.
  - 직원 여러 명이 각자 설치해 입력 · 업로드한다 (사용자 1.13.1 "지원여러명이서 입력하고 사용하는거다"). PC 대수 제한 없음 — 그래서 `cloud_info` 의 답은 스크립트 캐시 (10분, 잠금 안에서만 채움 · 바꿈) 에서 준다. 스크립트 속성 (하루 5만 번) 을 30초 물음에 쓰지 않는다.
- **이 PC 에만 두는 설정 = `cloudsync.js` `LOCAL_META`**: `gUrl` · `gToken` · `mobileOn` · `ai*` · `dash` · `dashAsmMonthly` · `numFmt` · `mrpLines` · `cloud*`. 새 설정 항목을 만들 때 PC 마다 달라야 하면 여기에 더한다 (아니면 모든 PC 같음).
- **처음 연결**: 사장님 PC 올리기 (`upload`), 직원 PC 구글 자료로 (`replace`, 이 PC 자료는 `cloud_backup` 에 먼저), 이 PC 에만 있는 행 더하기 (`merge`, 미리 보기), 덮어쓰기 (`overwrite`), 다시 켜기 (`resume`). 연결 · 끄기 · 코드는 ERP 가 실행 중인 PC 에서만.
- **Apps Script 주소는 사용자가 만든다** (구글 로그인 · 권한 승인). ERP 는 키를 넣은 코드 ([Apps Script 코드 복사]) 와 순서를 준다. 키 · 연결 코드 (`ERPC1.…`) 는 저장소에 올리지 않는다.
- 다른 PC 가 많이 지워 표가 절반 아래로 줄면 쓰기 전에 `cloud_backup` 에 복사한다. 깨진 표 파일은 빈 표로 보지 않는다. 자료를 통째로 바꾸는 버튼은 공유 중이면 경고한다.
- 휴대폰 보기는 같은 웹 앱 주소 (5판에 4판 기능 그대로). 요약은 휴대폰 보기를 켠 PC 가 보낸다.
- **구글 시트 = 공유 자료 보기 (1.13.2, Code.gs 6판)**: 그 Apps Script 의 구글 시트에 표마다 탭 (탭 이름 · 머리글 · 열 순서 = 화면, schema.js `ko`) + 맨 앞 "ERP 자료 안내". 자료를 고치는 곳은 ERP — 탭은 경고만 보호, 시트에서 고친 것은 다음 갱신 때 덮어쓴다.
  - 저장 (`cloud_put`) 과 시트 쓰기 (`cloud_sheet`) 는 따로다. 저장 응답 · 30초 판 · 끄기 전 보내기가 시트를 기다리면 안 된다 (큰 표는 수십 초). 보낸 뒤 20초 모아서 한 번, 뒤처진 지 1분이면 다른 PC 가 대신, [구글 시트 다시 쓰기] 는 바로.
  - 글자 열은 텍스트 서식 (코드 · 날짜가 바뀌지 않게), `=` 로 시작하는 글자는 `'` 를 붙여 수식이 되지 않게. 한 표의 오류는 그 표만 (같은 번호로 되풀이하지 않음). 5판 · 시트 없는 스크립트는 부르지 않고 안내.
  - 새 표 · 새 칸은 schema.js 에 넣으면 시트 탭 · 머리글에도 저절로 들어간다 (화면에 없는 칸은 칸 이름 그대로, `_` 로 시작하는 칸은 빠짐).
- **비밀 키 · 잠금 (1.13.3, 코드 검토 — 사용자 "보안·동작 오류부터 고쳤줘. 재현 시험을 먼저 만들고")**:
  - 구글 비밀 키 (`gToken`) 는 AI 키처럼 ERP 가 실행 중인 PC 밖으로 보내지 않는다 — 사내망의 다른 PC 브라우저에는 설정 답에서 빼고 (`server.js` `metaFor`), 그 브라우저는 `gUrl` · `gToken` 을 바꾸지 못한다 (`OWNER_META`). 그 브라우저의 구글 요청은 서버가 키를 넣되 연결된 웹 앱 주소로만. 새 비밀 설정을 만들면 `SECRET_META` · `OWNER_META` 에 더한다.
  - 덮어쓰기는 구글에만 있는 표 (이 ERP 가 아는 표) 도 빈 표로. 모르는 표 (새 판 ERP 의 표) 는 그대로.
  - 휴대폰 보기는 비밀번호 대신 휴대폰마다 열쇠를 기억하고, 비밀번호 잠금 (10번 · 10분) 은 기억해 둔 휴대폰을 막지 않는다 (누가 일부러 틀려 모두를 막지 못하게). 비밀번호를 바꾸면 열쇠도 모두 지운다.
  - Apps Script 속성 값은 9KB (UTF-8 바이트) 까지 — 글자 수로 재지 않는다. 덧붙이는 정보 (탭 이름 · 머리글) 를 못 써도 자료 저장은 실패하지 않게.
  - 실패한 [구글 시트 다시 쓰기] 는 버리지 않고 기다린 뒤 다시.
- **합치기 코드 하나 (1.13.4, 사용자 "남은 정리 항목 3개도 고쳐줘")**: 행 합치기 (3-way merge) · 행 지문 · `_id` 맞추기는 `app/js/merge.js` 하나 — 화면 `db.js` 와 서버 `cloudsync.js` 가 같이 쓴다. 규칙을 바꿀 때는 여기만. 같은 `_id` 두 행은 화면 · 서버 모두 `_id~순번`, 양쪽에 새로 생긴 같은 `_id` 는 겹침으로 세지 않는다.
- 서버가 화면에 그대로 보내는 오류 글은 한국어 / 베트남어 (`server.js` `ONLY_HERE` 등). 저장마다 백업 폴더 · 표 폴더를 훑지 않는다 (하루 백업 · 정리는 그날 처음 한 번, 공유의 `pending` 은 저장 번호로).
- 설치형: `cloudsync.js` · `google/**` 가 app.asar 에 들어간다 (`build.files`).
- 시험: `npm run test:v18` 184개 + v17 · v16 · v15 · v14 · v13 · v12 · v11 · v9 · v8 · v7 · assistant.
