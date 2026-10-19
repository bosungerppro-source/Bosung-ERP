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
종합 현황(7차: 위젯) / 수주 관리(진행률·납기 달력·상세·월별×품목군 표) / 생산 관리(일보 조회·입력·일별 생산수량·설비) / **품목·재고**(7차: 원부자재 · 생산현장 · 생산 반영 · 수불 입력 · 수불 내역 · 발주·안전재고 · 외주 · ECOUNT 비교 · 자료 점검 · 코드 사전 · 마스터 · 예시 자료) / 제품·BOM·배합(MRP 소요량 계산 · 조립 BOM 자동 구성) / 엑셀·구글 연동 / 설정.

### 4. 도메인 규칙
- 재고(6차) = ECOUNT 기초재고(기준일) + 기준일 이후 수불(입고·출고·이동·조정) + 생산일보 자동 반영(입고·BOM 차감). 범위는 창고 / 공장 2묶음. 자세한 규칙은 아래 2-5.
- 안전재고 상태: 정상 / 임박(<120%) / 미달 / 마이너스 / 기준없음.
- 수주 상태: 완료 / 납기경과 / 생산중 / 대기. 포장 실적(set)은 포장일보의 PO 번호로 자동 집계.
- 배합표 coef = 제품 1개당 원료 g. 원료 소요 kg = 수량 × coef ÷ 1000. 수량은 색상수로 균등 배분.
- 공정 코드: INJ, REF, STP, ASM, WRP, PCK.

### 5. 기술 구조 (빌드 도구 없음)
- Vanilla JS SPA (`app/`), 전역 `window.ERP`, DOM 빌더 `h()`, Chart.js 4, SheetJS.
- `ERP.db`: 메모리 테이블, 저장은 서버모드(JSON 파일) 또는 IndexedDB. 행마다 `_id`.
- `server.js`: 의존성 없는 로컬 서버 (정적파일, `/api/*`, Google Apps Script 중계 `/api/gproxy`, 일일 백업 14일, LAN 옵션).
- `electron/main.js`: 서버를 내장해 창으로 표시. 설치 파일은 electron-builder(dir) + NSIS(`build/installer.nsi`).
- `google/Code.gs`: Apps Script 웹앱 (ping/list/put/get/snapshot, 토큰 보호).

### 6. 확장할 때 지켜야 할 것
- 새 표는 `app/js/schema.js` 의 `ERP.TABLES` 에 컬럼(ko/vi/type)을 추가하면 목록·폼·엑셀 내보내기·구글 동기화에 자동 반영된다.
- 새 엑셀 양식은 `app/js/xl.js` 에 detector + parser 를 추가한다.
- 새 화면은 `app/js/p_*.js` 에서 `ERP.pages.<id> = {ko, vi, render(root)}` 로 등록하고 `main.js` 의 NAV 에 추가한다.
- 모든 문자열은 `L()` 로 양국어 제공(`L(ko, '')` = 베트남어에서 빈 글자, `L(ko)` = 한국어 대체). 숫자/날짜 포맷은 `ERP.fmt`.
- 변경 후: `npm run test:v7` (재고·위젯·화면, ECOUNT 엑셀은 `seed/ecount`; 이전 버전 업그레이드까지 보려면 `ERP_PREV=<이전 소스 폴더>`) → `npm run test:assistant` (비서·화면·서버) → `npm run demo` → `npm run dist`. 현장 엑셀 파서는 `npm test -- <엑셀폴더> [all]`.

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

**결정**: 품목·창고·기초재고는 ECOUNT 자료(2026-10-16)로 다시 구성한다. 재고의 기준은 이 ERP다(ECOUNT = 기초재고 + 비교용). 범위 2묶음 창고(WH) / 공장(FAC). 수불은 엑셀 업로드 + 화면 입력. 생산일보는 입고 + BOM 차감. 예전 샘플은 행 단위 "예시"로 남긴다.

**파일 (로드 순서: schema, db, calc, inv, ui, xl, ecount, p_dashboard, p_orders, p_production, p_stock, p_bom, p_data, assistant_tools, assistant_local, assistant, main)**
- `app/js/inv.js` 재고 엔진 + ERP CODE 사전. `C.stock(upTo)` 를 덮어쓴다(옛 계산은 `C.stockLegacy`). 반환 형식은 그대로(code, m, name, prim, bal, safety, status …)이고 `by{WH,FAC}`, `open`, `sets`, `pcs`, `negative`, `susp`(이동 누락 의심), `stage/line/sub/cat`, `hidden` 이 더해졌다.
- `app/js/ecount.js` ECOUNT 5종 + 수불 양식 detector/job. `XL.addDetector` 로 앞에 끼워 넣고, job 은 `apply`/`preview`/`modes()` 훅을 가질 수 있다.
- `app/js/p_stock.js` 품목·재고 화면, `ERP.itemDetail(code)` 품목 상세(수불부·쓰이는 곳·관련 PO).
- 표: `items`(통합 품목, 키 code) · `warehouses` · `code_dict`(level+parent+code) · `stock_open`(scope+code) · `stock_tx` · `ecount_snap` · `uploads`.

**도메인 규칙**
- ERP CODE = `단계-제품군(분류)-세부-품목코드`. 단계 15칸 흐름: RM → SM → CM → WIP00(심) → WIP01(배럴) → WIP02(노즈콘) → WIP03(홀더) → WIP04(스푼) → WIPx6 → WIPx5 → WIP11(스탬핑) → WIP55 → WIP(조립) → SG(마니라) → FG(박스, CT). + ETC(코드 없음), TEST(T* 테스트, 숨김). FD 는 FG 로 본다.
- 이름 = 내장 사전 + `code_dict` 표(표가 이김). 추정 이름은 `guessed` 로 "확인 필요" 표시.
- 수불 효과: IN → to +, OUT → from −, MOVE → from − / to +, ADJ → ±, PROD → 공장 +, USE → 공장 −. 기준일 당일까지의 수불은 기초재고에 들어 있다고 본다.
- 생산 반영(`prodPost` = in_bom / in / off)은 **저장하지 않고** `prod_log` 에서 매번 계산 → 같은 일보를 다시 올려도 중복 없음. 단위: CT 는 `set_per_ct` 필요, SET 은 set, kg 는 weight_kg, 그 외 pcs. BOM 찾는 순서: `bom_lines` → 조립(색상 코드 → 배럴·노즈콘·리필·홀더·스푼) → 리필(배합표 g/개 → kg) → 포장(세트의 색상별 1개). 진단(BOM 없음 · 품목코드 아님 · 환산 없음 · 원료명 미연결)은 수불 내역 탭에 보인다.
- 이동 누락 의심 = 한 범위 +, 다른 범위 −. 자료 점검 탭의 [이동 전표 만들기] 로 정리한다.
- ECOUNT 재고현황 첫 업로드 = 기초재고, 그 뒤는 "비교만"이 기본(재설정은 확인 필수). 품목등록 재업로드는 지우지 않고 "숨김 후보"(missing)만 표시하고, ECOUNT 안전재고가 비어 있으면 ERP 값을 유지한다.
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
