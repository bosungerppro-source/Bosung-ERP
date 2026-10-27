'use strict';
/* 8차(v1.3.0) 자동 시험: 실제 사용 전 데이터 정확성
   주/야·작업장별 일보 교체 · 누적 시트와 겹침 · 수주 줄 합쳐짐 · 취소/보류 PO · KHO NVL 입출고장 품목 찾기 · ERP 일보 양식 ·
   날짜/숫자 해석 · 기초재고 기준일 · PO 편집기 · BOM 새 조합 · 수불 입력 · 구글 시트 형 보존 · 정확도 개선 · 데모 자료
   사용:  npm run test:v8 [-- <현장 엑셀 폴더>]   (기본 seed/factory · Playwright 필요: npm i -D playwright 또는 NODE_PATH 로 전역 설치본) */
const path = require('path'), fs = require('fs'), os = require('os'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DIR = process.argv[2] || path.join(ROOT, 'seed', 'factory');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 500 ? s.slice(0, 500) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const near = (name, got, want, tol) => ok(name, typeof got === 'number' && Math.abs(got - want) <= (tol || 0.006), { got, want });
const section = (t) => console.log('\n■ ' + t);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const need = (f) => { const p = path.join(DIR, f); if (!fs.existsSync(p)) { console.error('현장 엑셀이 없습니다: ' + p); process.exit(2); } return p; };
const serial = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

(async () => {
  const F_ASM = need('Bao_cao_lap_rap_08-10-2026.xlsx'), F_PCK = need('Bao_cao_dong_goi_08-10-2026.xlsx'), F_HOSO = need('Ho_so_quan_ly_san_xuat_2026.xlsx');
  const work = tmp('erp-v8-x-');
  // 조립 일보(주간, 1층) 하나에서: 날짜만 바꾼 주간 / 야간 / 2층 사본을 만든다 (누적 시트에 없는 날 2026-10-20)
  const asmCopy = (file, sheetName, opt) => {
    const wb = XLSX.readFile(F_ASM, { cellStyles: false }); const ws = wb.Sheets['BC lắp ráp Ca ngày'];
    ws.L4 = { t: 'n', v: serial(opt.date || '2026-10-20'), z: 'yyyy-mm-dd' };
    if (opt.floor) ws.C4 = { t: 's', v: '  Ass ( floor ' + opt.floor + ' ) / Lắp ráp tầng ' + opt.floor };
    const out = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(out, ws, sheetName);
    const p = path.join(work, file); XLSX.writeFile(out, p); return p;
  };
  const F_DAY = asmCopy('asm_day_2026-10-20.xlsx', 'BC lắp ráp Ca ngày', {});
  const F_NIGHT = asmCopy('asm_night_2026-10-20.xlsx', 'BC lắp ráp Ca đêm', {});
  const F_FLOOR2 = asmCopy('asm_floor2_2026-10-20.xlsx', 'BC lắp ráp Ca ngày', { floor: 2 });
  const pckCopy = (() => { const wb = XLSX.readFile(F_PCK); const ws = wb.Sheets['Báo cáo (2)']; ws.M3 = { t: 'n', v: serial('2026-10-20'), z: 'yyyy-mm-dd' }; const p = path.join(work, 'pck_2026-10-20.xlsx'); XLSX.writeFile(wb, p); return p; })();

  const dataDir = tmp('erp-v8-'); const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 4900 + Math.floor(Math.random() * 150) /* 5060 · 5061 은 브라우저가 막는 포트라 피함 */ });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await (await browser.newContext({ viewport: { width: 1480, height: 920 }, acceptDownloads: true, locale: 'en-US' })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const ev = (fn, a) => page.evaluate(fn, a);
  await page.goto(S.url + '/#/dashboard');
  await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 120000 });
  await ev(() => { window.confirm = () => true; });
  /** upload files through the real upload screen; keep only jobs accepted by `keep` (stringified fn), optionally tweak jobs, then apply */
  const upload = async (files, keepSrc, tweakSrc) => {
    await ev(() => { document.querySelectorAll('.modal-back').forEach(m => m.remove()); ERP.state.dataTab = 'import'; ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await page.waitForTimeout(200);
    await page.setInputFiles('.drop input[type=file]', files);
    await page.waitForFunction(() => ERP.state.imp && ERP.state.imp.jobs && ERP.state.imp.jobs.length > 0, null, { timeout: 120000 });
    const info = await ev(([k, t]) => { const keep = new Function('j', 'return (' + k + ')(j)'); const jobs = ERP.state.imp.jobs; jobs.forEach(j => { j.include = !!(j.table && j.rows.length && keep(j)); }); if (t) new Function('jobs', '(' + t + ')(jobs)')(jobs.filter(j => j.include));
      return jobs.filter(j => j.include).map(j => ({ table: j.table, proc: j.proc, mode: j.mode, rows: j.rows.length, overlap: j.overlap || 0, sheet: j.sheet, shifts: Array.from(new Set(j.rows.map(r => r.shift))), wp: Array.from(new Set(j.rows.map(r => r.workplace || ''))) })); }, [keepSrc, tweakSrc || '']);
    await ev(() => ERP.render()); await page.waitForTimeout(150);
    await page.click('text=선택 항목 모두 반영'); await page.waitForTimeout(500);
    return info;
  };

  // ------------------------------------------------------------------------------------------
  section('1. 공용 해석 함수: 날짜 · 숫자 · 파일명 날짜');
  {
    const r = await ev((s17) => {
      const F = ERP.fmt; if (!F.parseDate || !F.parseNum) return null;
      const d = ['2026-10-17', '17/10/2026', '17.10.2026', '17-10-26', '8/10/2026', '10/25/2026', s17, '2026/10/17', '17/10/2026 08:30', 'abc', '', '2026-13-01', '31/02/2026'].map(x => F.parseDate(x));
      d.push(F.parseDate(new Date(2026, 9, 17)));
      const n = [['35.000', ','], ['35,000', '.'], ['1.234,5'], ['1,234.5'], ['(1,000)'], ['1.5', '.'], ['1,5', ','], ['1.234', ','], ['1.234', '.'], ['1.234.567'], [''], ['abc'], ['−120'], [' 2 200 '], [42]].map(a => F.parseNum(a[0], a[1]));
      const fdt = ERP.xl.fileDate ? ['Bao_cao_2026-10-08.xlsx', 'Bao_cao_lap_rap_08-10-2026.xlsx', 'Bao_cao_ep_loi_08.10.26.xlsx', 'report.xlsx'].map(x => ERP.xl.fileDate(x)) : null;
      return { d, n, fdt };
    }, serial('2026-10-17'));
    ok('ERP.fmt.parseDate / parseNum 있음', !!r);
    if (r) {
      eq('날짜 해석 (ISO · 일/월/년 · 점 · 두 자리 연도 · 일 먼저 · 앞자리>12면 월 먼저 · 엑셀 숫자 · 시각 무시 · 잘못된 값은 null)', r.d,
        ['2026-10-17', '2026-10-17', '2026-10-17', '2026-10-17', '2026-10-08', '2026-10-25', '2026-10-17', '2026-10-17', '2026-10-17', null, null, null, null, '2026-10-17']);
      eq('숫자 해석 (35.000 vi · 35,000 en · 1.234,5 · 1,234.5 · (1,000) · 소수 · 애매한 1.234 는 소수점 기호로 · 묶음 여러 개 · 빈칸/글자 null · − · 공백 천단위 · 숫자)', r.n,
        [35000, 35000, 1234.5, 1234.5, -1000, 1.5, 1.5, 1234, 1.234, 1234567, null, null, -120, 2200, 42]);
      eq('파일명 날짜 (ISO 를 26-10-08 로 잘못 읽지 않음)', r.fdt, ['2026-10-08', '2026-10-08', '2026-10-08', null]);
    }
    const ctxVi = await browser.newContext({ locale: 'vi-VN' }); const pv = await ctxVi.newPage(); await pv.goto(S.url + '/#/dashboard');
    await pv.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready, null, { timeout: 120000 });
    const loc = await pv.evaluate(() => ERP.fmt.parseNum ? [ERP.fmt.parseNum('35.000'), ERP.fmt.parseNum('1,5')] : null); await ctxVi.close();
    const locEn = await ev(() => ERP.fmt.parseNum ? [ERP.fmt.parseNum('35.000'), ERP.fmt.parseNum('35,000')] : null);
    eq('PC 숫자 형식 자동: vi-VN 은 35.000 = 35000, 1,5 = 1.5', loc, [35000, 1.5]); eq('PC 숫자 형식 자동: en-US 는 35.000 = 35, 35,000 = 35000', locEn, [35, 35000]);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('2. 일보 교체: 같은 날 다른 조(주/야) · 다른 작업장(층) · 직접 입력은 지우지 않는다');
  {
    await ev(() => { ERP.db.add('prod_log', { date: '2026-10-20', process: 'ASM', shift: 'D', machine_no: '9', code: 'BM01002', ok_qty: 111, ok_ea: 111, source: 'manual' }); });
    const cnt = () => ev(() => { const r = ERP.db.rows('prod_log').filter(x => x.date === '2026-10-20' && x.process === 'ASM'); return { n: r.length, D: r.filter(x => x.shift === 'D' && x.source !== 'manual').length, N: r.filter(x => x.shift === 'N').length, manual: r.filter(x => x.source === 'manual').length, sum: r.reduce((a, x) => a + (+x.ok_qty || 0), 0) }; });
    const j1 = await upload([F_DAY], "j => j.table === 'prod_log'");
    eq('주간 일보 인식: 조립 18행 · 조 D · 작업장 1층', [j1.length, j1[0] && j1[0].rows, j1[0] && j1[0].shifts, j1[0] && /floor 1/i.test(j1[0].wp[0] || '')], [1, 18, ['D'], true]);
    const a1 = await cnt();
    const j2 = await upload([F_NIGHT], "j => j.table === 'prod_log'");
    eq('야간 일보 인식: 시트 이름 "Ca đêm" → 조 N', j2[0] && j2[0].shifts, ['N']);
    const a2 = await cnt();
    eq('야간을 올려도 주간은 남음 (주간 18 + 야간 18 + 직접 입력 1)', [a2.D, a2.N, a2.manual], [18, 18, 1]);
    await upload([F_DAY], "j => j.table === 'prod_log'"); const a3 = await cnt();
    eq('같은 주간 일보를 다시 올리면 그 일보만 교체 (중복 없음)', [a3.D, a3.N, a3.manual], [18, 18, 1]);
    await upload([F_FLOOR2], "j => j.table === 'prod_log'"); const a4 = await cnt();
    eq('2층 일보는 1층 일보를 지우지 않음 (주간 36)', [a4.D, a4.N, a4.manual], [36, 18, 1]);
    ok('첫 업로드 결과 = 주간 18 + 직접 입력 1', a1.D === 18 && a1.manual === 1, a1);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('3. 누적 시트(Ho_so)와 같은 날짜의 일보: 기본은 건너뛰고, 고르면 일보로 바꾼다');
  {
    const before = await ev(() => { const r = ERP.db.rows('prod_log').filter(x => x.date === '2026-10-08' && x.process === 'ASM'); return { hist: r.filter(x => x.source === 'history').length, daily: r.filter(x => x.source === 'daily-report').length }; });
    eq('데모 자료 10-08 조립 = 누적 시트 18행, 일보 0행 (중복 제거됨)', before, { hist: 18, daily: 0 });
    const j = await upload([F_ASM], "j => j.table === 'prod_log' && j.proc === 'ASM'");
    ok('미리보기: 누적 시트와 겹침 18행 표시', j[0] && j[0].overlap === 18, j);
    const a = await ev(() => { const r = ERP.db.rows('prod_log').filter(x => x.date === '2026-10-08' && x.process === 'ASM'); return { hist: r.filter(x => x.source === 'history').length, daily: r.filter(x => x.source === 'daily-report').length }; });
    eq('기본(건너뜀): 누적 시트 18행 그대로, 일보는 더하지 않음', a, { hist: 18, daily: 0 });
    await upload([F_ASM], "j => j.table === 'prod_log' && j.proc === 'ASM'", "jobs => jobs.forEach(j => { j.overlapMode = 'replace'; })");
    const b = await ev(() => { const r = ERP.db.rows('prod_log').filter(x => x.date === '2026-10-08' && x.process === 'ASM'); return { hist: r.filter(x => x.source === 'history').length, daily: r.filter(x => x.source === 'daily-report').length }; });
    eq('"일보로 바꾸기": 그날 누적 시트 행 대신 일보 18행', b, { hist: 0, daily: 18 });
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('4. 수주(PO) 업로드: 키가 같은 줄도 합치지 않는다 · 다시 올려도 늘지 않는다');
  {
    await ev(() => ERP.db.replace('po', []));
    const j = await upload([F_HOSO], "j => j.table === 'po'");
    const r = await ev(() => { const po = ERP.db.rows('po'); const m = ERP.calc.monthlyPO('due'); const y26 = Object.keys(m).filter(k => k.startsWith('2026')).reduce((a, k) => a + Object.values(m[k]).reduce((s, v) => s + v, 0), 0);
      return { n: po.length, p6008: po.filter(p => String(p.po_no) === '5003306008').length, bulk04: (m['2026-04'] || {}).Bulk || 0, y26, l004: po.filter(p => p.item_no === '68-7409-L-004').length }; });
    // 1.13.11: PO 번호가 있는 줄 (PO 번호 + 품번 기준) · 없는 줄 (예전 키) 두 묶음
    eq('PO 시트 521줄 모두 저장 (PO 번호 있는 줄 · 없는 줄 두 묶음)', [j.length, j.reduce((a, x) => a + x.rows, 0), r.n], [2, 521, 521]); eq('PO 5003306008 = 3줄', r.p6008, 3);
    near('2026-04 Bulk = 공장 PO Sum 244,499.996', r.bulk04, 244499.996, 0.01); near('2026년 합계 = 공장 PO Sum 133,848,305.996', r.y26, 133848305.996, 0.01);
    ok('68-7409-L-004 줄들(Po No2 다름)이 합쳐지지 않음', r.l004 > 1, r.l004);
    await upload([F_HOSO], "j => j.table === 'po'");
    eq('같은 파일 다시 올림 → 그대로 521줄', await ev(() => ERP.db.rows('po').length), 521);
    const it = await ev(() => { ERP.db.upsert('items', [{ code: 'DUPX', name: 'a' }, { code: 'DUPX', name: 'b' }]); return ERP.db.rows('items').filter(x => x.code === 'DUPX').map(x => x.name); });
    eq('마스터 표(품목)는 같은 키를 하나로 합침 (마지막 값)', it, ['b']);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('5. 취소 · 보류 PO 는 진행 · 지연 · MRP 에서 빠진다');
  {
    const r = await ev(() => { const C = ERP.calc; if (!C.poCond) return null; const lines = C.orders(); const bad = lines.filter(o => C.poCond(o.p) && (o.st === 'late' || o.st === 'prod' || o.st === 'wait' || o.soon));
      const groups = C.poGroups(); const allCancel = groups.filter(g => g.lines.every(l => C.poCond(l.p) === 'cancel'));
      return { conds: ['Cancle', 'cancle', 'Di hold', '취소', 'hủy', 'HOLD', 'ok', ''].map(c => C.poCond({ condition: c })), bad: bad.length, nCancel: lines.filter(o => o.st === 'cancel').length, nHold: lines.filter(o => o.st === 'hold').length, mism: lines.filter(o => C.poCond(o.p) && o.st !== C.poCond(o.p)).length,
        groupSt: Array.from(new Set(allCancel.map(g => g.st))), sample: allCancel.length ? allCancel[0].po_no : null }; });
    ok('C.poCond 있음', !!r);
    if (r) {
      eq('Condition 해석', r.conds, ['cancel', 'cancel', 'hold', 'cancel', 'cancel', 'hold', '', '']);
      eq('취소·보류 줄은 대기/생산/지연/임박이 아님', r.bad, 0); ok('취소 · 보류 표시가 이긴다 (PO 번호가 있는 줄: 취소 19 · 보류 10, 포장이 끝난 취소 줄 포함)', r.mism === 0 && r.nCancel === 19 && r.nHold === 10, r);
      eq('모든 줄이 취소인 PO = 취소 상태', r.groupSt, ['cancel']);
      await ev(() => { ERP.state.bomTab = 'mrp'; ERP.state.params = {}; ERP.goto('bom'); ERP.render(); }); await page.waitForTimeout(300);
      await page.click('text=진행 중 수주에서 가져오기'); await page.waitForTimeout(300);
      const txt = await ev(() => document.querySelector('.modal').innerText); await ev(() => document.querySelector('.modal-back').remove());
      ok('MRP 가져오기 목록에 취소 PO 없음', r.sample && !txt.includes(String(r.sample)), r.sample);
    }
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('6. KHO NVL 입출고장: 카톤·마니라를 완제품으로 넣지 않는다');
  {
    const r = await ev(() => { const INV = ERP.inv; const rows = ERP.db.rows('inout'); const c = INV.ledgerToTx(rows, { outMode: 'move' }); const IT = INV.items();
      const bad = c.rows.filter(t => t.code && /^(FG|SG|WIP)/.test(INV.info(IT.get(t.code)).stage || '')); const carton = INV.ledgerToTx([{ date: '2026-10-19', type: 'IN', item_code: '52-9824-0-006', wh_code: 'R-430VN', name: 'CARTON - USA MINI 24 FUN EFFECTS', in_ea: 10 }], {}).rows[0];
      const old = INV.ledgerToTx([{ date: '2026-10-19', type: 'IN', item_code: 'R-0031', wh_code: 'R-003', name: 'Paraffin wax - KR', in_kg: 10 }, { date: '2026-10-19', type: 'OUT', item_code: 'CASE-X', wh_code: 'R-401VN', name: '12CT MINI - MEX 25', out_ea: 7 }, { date: '2026-10-19', type: 'OUT', item_code: 'R-103VN', wh_code: 'R-103VN', name: 'LDPE', out_kg: 3 }], { outMode: 'move' }).rows.map(x => x.code || null);
      return { n: c.rows.length, bad: bad.length, badSample: bad.slice(0, 3).map(t => t._orig.item_code + '/' + t._orig.wh_code + '→' + t.code), carton: carton.code || null, old }; });
    eq('완제품·반제품으로 들어간 줄 0', r.bad, 0); eq('CARTON 52-9824-0-006 (R-430VN) → 카톤 품목 52-9824-0-808', r.carton, '52-9824-0-808');
    eq('기존 연결 그대로 (R-003 · Mã XNK+품명 52-0712 · VN 접미어 R-103)', r.old, ['R-003', '52-0712', 'R-103']);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('7. ERP 일보 양식(일보 양식 받기)을 채워 올리면 그 공정의 생산일보로 들어간다');
  {
    const r = await ev(() => {
      if (!ERP.xl.dailyTemplateBook) return null;
      const X = window.XLSX; const wb = ERP.xl.dailyTemplateBook();
      wb.SheetNames.forEach(n => { const ws = wb.Sheets[n]; const aoa = X.utils.sheet_to_json(ws, { header: 1 }); const hdr = aoa.find(r => r.some(c => /생산일|Ngày SX/.test(String(c)))); const hi = aoa.indexOf(hdr);
        const row = hdr.map(c => /생산일|Ngày SX/.test(String(c)) ? '2026-10-21' : /주\/야|Ca/.test(String(c)) ? 'N' : /양품|SL đạt/.test(String(c)) ? 500 : /코드|Mã hàng/.test(String(c)) ? 'BM01002' : /설비번호|Số máy/.test(String(c)) ? '1' : null);
        const out = aoa.slice(0, hi + 1).concat([row]); wb.Sheets[n] = X.utils.aoa_to_sheet(out); });
      const back = X.read(X.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array', cellDates: false });
      const jobs = ERP.xl.analyze(back, {}); return jobs.map(j => ({ sheet: j.sheet, table: j.table, proc: j.proc, mode: j.mode, n: j.rows.length, p: j.rows[0] && j.rows[0].process, sh: j.rows[0] && j.rows[0].shift, d: j.rows[0] && j.rows[0].date }));
    });
    ok('XL.dailyTemplateBook 있음', !!r);
    if (r) {
      const procs = ['INJ', 'REF', 'STP', 'ASM', 'WRP', 'PCK'];
      eq('6개 공정 시트 모두 생산일보로 인식', r.map(j => [j.table, j.proc, j.p, j.mode, j.n, j.sh, j.d]), procs.map(p => ['prod_log', p, p, 'range', 1, 'N', '2026-10-21']));
    }
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('8. 글자 날짜 · 빈 출발 범위: 수불 양식');
  {
    const f = path.join(work, 'tx_text_dates.xlsx'); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['일자 / Ngày', '전표번호 / Số CT', '구분 (입고/출고/이동/조정) / Loại', '출발 (창고/공장) / Từ', '도착 (창고/공장) / Đến', '품목코드 / Mã hàng', '수량 / Số lượng', '거래처 / Đối tác', '참조 (PO 등) / Tham chiếu', '비고 / Ghi chú'],
      ['17/10/2026', 'TD-1', '입고', '', '창고', 'R-001', 100, '', '', ''], ['abc', 'TD-1', '입고', '', '창고', 'R-001', 5, '', '', ''], ['17/10/2026', 'TD-1', '이동', '', '창고', 'R-002', 7, '', '', '']]), 'stock_tx');
    XLSX.writeFile(wb, f);
    const before = await ev(() => { const s = ERP.calc.stock().get('R-001'); const s2 = ERP.calc.stock().get('R-002'); return { r1: s.by.WH, r2wh: s2.by.WH, r2fac: s2.by.FAC }; });
    const j = await upload([f], "j => j.table === 'stock_tx'");
    const a = await ev(() => { const s = ERP.calc.stock().get('R-001'); const s2 = ERP.calc.stock().get('R-002'); const tx = ERP.db.rows('stock_tx').filter(t => t.doc_no === 'TD-1'); return { r1: s.by.WH, r2wh: s2.by.WH, r2fac: s2.by.FAC, dates: tx.map(t => t.date), moves: tx.filter(t => t.kind === 'MOVE').map(t => t.from_scope + '>' + t.to_scope) }; });
    eq('17/10/2026 → 2026-10-17 로 저장, 읽지 못한 날짜 줄은 건너뜀', a.dates, ['2026-10-17', '2026-10-17']);
    near('R-001 창고 +100 (재고에 반영됨)', a.r1 - before.r1, 100); eq('이동 · 출발 빈칸 · 도착 창고 → 공장 → 창고', a.moves, ['FAC>WH']);
    near('R-002 창고 +7 / 공장 −7', (a.r2wh - before.r2wh) - (a.r2fac - before.r2fac), 14);
    const lt = await ev(() => ERP.inv.ledgerToTx([{ date: '17/10/2026', type: 'IN', item_code: 'R-001', wh_code: 'R-001', name: 'BEE WAX', in_kg: 1 }], {}).rows[0].date); eq('입출고장 글자 날짜도 ISO', lt, '2026-10-17');
    ok('미리보기에 날짜 확인 필요 1건', j[0] && j[0].rows === 3, j);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('9. 기초재고 기준일: 범위마다 하나로 고정 · 기준일 이전 입력 경고 · 이동 전표 날짜');
  {
    const r = await ev(() => { const INV = ERP.inv; const od0 = INV.openDates(); ERP.db.add('stock_open', { date: '2026-10-19', scope: 'WH', code: 'R-999X', qty: 1 }); const od1 = INV.openDates();
      return { meta: ERP.db.meta.openDate || null, od0: [od0.WH, od0.FAC], od1: [od1.WH, od1.FAC], sug: INV.suggestDate ? INV.suggestDate() : null }; });
    eq('meta.openDate 저장', r.meta && [r.meta.WH, r.meta.FAC], ['2026-10-16', '2026-10-16']); eq('나중 날짜 행 하나를 더해도 기준일 그대로', r.od1, ['2026-10-16', '2026-10-16']);
    const today = await ev(() => ERP.fmt.today()); ok('이동 전표 날짜 = 오늘 (기준일 다음 날 이후)', r.sug === (today > '2026-10-16' ? today : '2026-10-17'), r.sug);
    const s2 = await ev(() => { const t = ERP.fmt.today(); ERP.db.meta.openDate = { WH: t, FAC: t }; ERP.db.ver.stock_open++; const v = ERP.inv.suggestDate ? ERP.inv.suggestDate() : null; return { v, t }; });
    eq('기준일이 오늘이면 이동 전표는 내일 날짜', s2.v, await ev((t) => ERP.fmt.addDays(t, 1), s2.t));
    await ev(() => { ERP.db.meta.openDate = { WH: '2026-10-16', FAC: '2026-10-16' }; ERP.db.ver.stock_open++; });
    await ev(() => { ERP.state.txe = { rows: [{ date: '2026-10-16', kind: 'IN', to: 'WH', code: 'R-001', qty: 5 }] }; ERP.state.matTab = 'entry'; ERP.goto('materials'); ERP.render(); }); await page.waitForTimeout(300);
    const w = await ev(() => document.querySelector('main table.entry tbody').innerText); ok('기준일 당일 입력 줄에 "재고에 반영되지 않음" 경고', /반영되지 않/.test(w), w.slice(0, 200));
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('10. 수불 입력: 검사에 걸린 줄은 저장 뒤에도 남는다');
  {
    await ev(() => { ERP.state.txe = { rows: [{ date: '2026-10-20', kind: 'IN', to: 'WH', code: 'R-001', qty: 3 }, { date: '2026-10-20', kind: 'IN', to: 'WH', code: 'NOPE-CODE', qty: 4 }] }; ERP.state.matTab = 'entry'; ERP.render(); }); await page.waitForTimeout(300);
    await page.click('main button.btn.primary'); await page.waitForTimeout(400);
    const r = await ev(() => ({ rows: ERP.state.txe.rows.filter(x => x.code).map(x => x.code), saved: ERP.db.rows('stock_tx').filter(t => t.date === '2026-10-20' && t.code === 'R-001' && t.qty === 3).length }));
    eq('잘못된 줄(NOPE-CODE)은 입력표에 남고, 맞는 줄만 저장', [r.rows, r.saved], [['NOPE-CODE'], 1]);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('11. PO 편집기: 한 줄을 고쳐도 다른 줄의 날짜 · 납기는 그대로');
  {
    const before = await ev(() => ERP.db.rows('po').filter(p => String(p.po_no) === 'PC25-0733').map(p => [p.date, p.due]).sort());
    await ev(() => { ERP.state.ord = { tab: 'all', sel: 'PC25-0733', view: 'po' }; ERP.goto('orders'); ERP.render(); }); await page.waitForTimeout(400);
    await page.click('text=수주 편집 · 품번 추가'); await page.waitForTimeout(300);
    const inputs = await page.$$('.modal table.entry tbody tr:nth-child(2) input[type=number]'); await inputs[2].fill('40'); await inputs[2].dispatchEvent('change');
    await page.click('.modal-foot button.primary'); await page.waitForTimeout(400);
    const after = await ev(() => ERP.db.rows('po').filter(p => String(p.po_no) === 'PC25-0733').map(p => [p.date, p.due]).sort());
    eq('줄별 수주일 · 납기 유지', after, before);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('12. BOM "새 조합 만들기": 이미 구성이 있는 품목이면 바꾸고, 중복하지 않는다');
  {
    await ev(() => { ERP.db.addMany('bom_lines', [{ parent: 'AM2511', child: 'RR11', qty: 1, src: 'auto' }, { parent: 'AM2511', child: 'AFAM11', qty: 1, src: 'auto' }, { parent: 'AM2511', child: 'RSP', qty: 1, src: 'auto' }]); ERP.bomEditor(null); });
    await page.waitForTimeout(200);
    const ins = await page.$$('.modal input[list="dl_bomc"]'); await ins[0].fill('AM2511'); await ins[0].dispatchEvent('change'); await page.waitForTimeout(150);
    const kids = await page.$$('.modal table.entry tbody input[list="dl_bomc"]');
    const vals = await Promise.all(kids.map(k => k.inputValue()));
    ok('기존 구성(3줄)을 불러옴', vals.filter(Boolean).length === 3, vals);
    await ev(() => { const rows = document.querySelectorAll('.modal table.entry tbody tr'); rows[rows.length - 1].querySelector('button').click(); });
    await page.click('.modal-foot button.primary'); await page.waitForTimeout(300);
    const r = await ev(() => ERP.db.rows('bom_lines').filter(l => l.parent === 'AM2511').map(l => l.child).sort());
    eq('저장 뒤 AM2511 = 2줄 (중복 없음)', r, ['AFAM11', 'RR11']);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('13. 구글 시트: 코드 · 날짜 글자가 숫자로 바뀌지 않게 (열 종류 전달 · Code.gs 텍스트 형식)');
  {
    // Code.gs (Apps Script) in a sandbox with fake SpreadsheetApp
    const calls = []; const sheet = { _last: 0, clear() { this._last = 0; }, setFrozenRows() {}, getLastRow() { return this._last; }, getMaxRows: () => 1000, getMaxColumns: () => 50, insertRowsAfter() {}, insertColumnsAfter() {} };
    const mkRange = (r, c, nr, nc) => { const g = { setValues: (v) => { calls.push(['setValues', r, c, nr, nc, v]); sheet._last = Math.max(sheet._last, r + nr - 1); return g; }, setNumberFormat: (f) => { calls.push(['fmt', r, c, nr, nc, f]); return g; },
      setNumberFormats: (f) => { calls.push(['fmts', r, c, nr, nc, f]); return g; }, setFontWeight: () => g, getValues: () => [] }; return g; };
    sheet.getRange = (r, c, nr, nc) => mkRange(r, c, nr || 1, nc || 1);
    const ctx = { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet, getName: () => 'T', getUrl: () => 'u', getSpreadsheetTimeZone: () => 'Asia/Ho_Chi_Minh', getSheets: () => [] }) }, ContentService: { createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 'json' } }, DriveApp: {}, Utilities: {} };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'google', 'Code.gs'), 'utf8').replace("var TOKEN = 'CHANGE-ME'", "var TOKEN = 'T1'"), ctx);
    const ping = ctx.doPost({ postData: { contents: JSON.stringify({ token: 'T1', action: 'ping' }) } });
    ok('Code.gs ping 에 ver 2', ping.ver >= 2, ping);
    ctx.doPost({ postData: { contents: JSON.stringify({ token: 'T1', action: 'put', table: 'items', cols: ['code', 'qty', 'date'], types: ['t', 'n', 'd'], rows: [['0414210300', 5, '2026-10-17'], ['523034E200', 1, '2026-10-18']], first: true }) } });
    const fmtIdx = calls.findIndex(c => c[0] === 'fmt' || c[0] === 'fmts'); const valIdx = calls.findIndex(c => c[0] === 'setValues' && c[1] > 1);
    ok('값을 쓰기 전에 글자 · 날짜 열을 텍스트(@) 형식으로', fmtIdx >= 0 && fmtIdx < valIdx && JSON.stringify(calls[fmtIdx]).includes('@'), calls.slice(0, 6));
    // client: push sends column types, pull keeps text columns as text
    const r = await ev(async () => {
      const sent = []; const orig = window.fetch;
      window.fetch = async (url, o) => { if (String(url).includes('/api/gproxy')) { const b = JSON.parse(JSON.parse(o.body).body); sent.push(b); const resp = b.action === 'get' ? (b.table === 'warehouses' ? { ok: true, cols: ['code', 'name', 'safety'], rows: [['0414210300', 'A', 5], ['523034E200', 'B', '7']], total: 2 } : { ok: true, cols: [], rows: [], total: 0 }) : { ok: true, ver: 2, sheet: 'T', url: 'u', written: (b.rows || []).length }; return new Response(JSON.stringify(resp), { status: 200 }); } return orig(url, o); };
      ERP.db.setSetting('gUrl', 'https://script.google.com/macros/s/x/exec'); ERP.db.setSetting('gToken', 'T1'); ERP.state.dataTab = 'google'; location.hash = '#/data'; await new Promise(r => setTimeout(r, 300)); ERP.render();
      document.querySelectorAll('input[data-t]').forEach(x => { x.checked = x.dataset.t === 'warehouses'; });
      const bPush = Array.from(document.querySelectorAll('button')).find(b => /구글 시트로 올리기/.test(b.textContent)); bPush.click(); await new Promise(r => setTimeout(r, 400));
      window.confirm = () => true; const keep = ERP.confirm; ERP.confirm = async () => true;
      const bPull = Array.from(document.querySelectorAll('button')).find(b => /구글 시트에서 가져오기/.test(b.textContent)); bPull.click(); await new Promise(r => setTimeout(r, 500));
      ERP.confirm = keep; window.fetch = orig;
      const put = sent.find(b => b.action === 'put'); const w = ERP.db.rows('warehouses');
      return { types: put && put.types, codes: w.map(x => x.code), typesOfCode: w.map(x => typeof x.code) };
    });
    ok('올릴 때 열 종류(types)를 함께 보냄', Array.isArray(r.types) && r.types[0] === 't', r.types);
    eq('가져올 때 코드 글자 그대로 (0 으로 시작 · E 들어간 코드)', [r.codes, r.typesOfCode], [['0414210300', '523034E200'], ['string', 'string']]);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('14. 정확도: 포장 일보 품번 · 조립 일보 품목군 · 설비 대수 · MRP · 사출 원료 · 공정 단위 · 품목 재업로드 · 되돌리기 · 포장 BOM · 자동 BOM');
  {
    const j = await upload([pckCopy], "j => j.table === 'prod_log'");
    const p = await ev(() => { const rows = ERP.db.rows('prod_log').filter(r => r.date === '2026-10-20' && r.process === 'PCK'); const o = ERP.calc.orders().find(x => String(x.p.po_no) === '124370E');
      const post = ERP.inv.postRows(rows, { mode: 'in' }).rows.map(t => t.code); return { codes: rows.map(r => r.code), items: rows.map(r => r.item), post: Array.from(new Set(post)).sort(), live: o ? o.live : null }; });
    eq('포장 일보 code = PO 품번 (68-7406-0-002 · Marlin)', Array.from(new Set(p.codes)).sort(), ['68-7406-0-002', 'Marlin']);
    eq('포장 일보 item = 완제품 코드 (68-7406-0-002 · 041L)', Array.from(new Set(p.items)).sort(), ['041L', '68-7406-0-002']);
    eq('생산 반영 = 완제품(CT) 입고', p.post, ['041L', '68-7406-0-002']); ok('PO 124370E 진행에 일보 포장 반영', p.live > 0, p.live);
    const d = await ev(() => { const rows = ERP.db.rows('prod_log').filter(r => r.date === '2026-10-20' && r.process === 'ASM' && r.source === 'daily-report'); return Array.from(new Set(rows.map(r => r.division))).sort(); });
    ok('조립 일보 품목군에 "Regular" 없음 (누적 시트 기준: Dial 등)', !d.includes('Regular') && d.includes('Dial') && d.includes('Mini'), d);
    const m = await ev(() => { const C = ERP.calc; const h = ERP.db.rows('prod_log').filter(r => r.date === '2026-10-08' && r.process === 'INJ'); const a = ERP.db.rows('prod_log').filter(r => r.date === '2026-10-20' && r.process === 'ASM' && r.source === 'daily-report' && /floor 1/i.test(r.workplace || '') && r.shift === 'D');
      return { asm: C.agg(a).machines.size, key: C.machKey ? C.machKey({ process: 'ASM', machine: 'Regular Assy M/C', machine_no: '1' }) !== C.machKey({ process: 'ASM', machine: 'Mini Assy M/C', machine_no: '1' }) : false }; });
    eq('조립 1층 주간 가동 설비 = 11대 (Mini/Regular 1번을 따로 셈)', [m.asm, m.key], [11, true]);
    const mrp = await ev(() => ERP.poMrpLines ? ERP.poMrpLines('4700025118') : null);
    ok('MRP 전체 품번: 완료된 줄(52-9724-L-002)은 빼고 남은 수량만', Array.isArray(mrp) && mrp.length === 1 && mrp[0].qty > 0 && !mrp.some(l => /52-9724/.test(l.code)), mrp);
    const inj = await ev(() => { ERP.db.add('code_map', { kind: 'raw', src: 'PP', item: 'R-102' }); const p = ERP.inv.postRows([{ _id: 'x1', date: '2026-10-20', process: 'INJ', code: 'Barrel', part: 'Barrel', division: 'Pencil', ok_qty: 100, raw_material: 'PP', raw_kg: 100 }, { _id: 'x2', date: '2026-10-20', process: 'INJ', code: 'BM09', ok_qty: 0, raw_material: 'PP', raw_kg: 50 }], { mode: 'in_bom' });
      const s = p.diag.matSkip.get('R-102'); return [p.rows.filter(t => t.kind === 'USE').map(t => [t.code, t.qty]), s ? [s.n, s.qty] : null]; });
    // 11차: 원부자재는 생산 반영으로 차감하지 않는다 — 사용자 연결(PP → R-102)은 진단에 이름을 붙일 때만, 양품 0 행도 진단에 남는다
    eq('사출 원료: 사용자 연결(PP → R-102) 로 알아보지만 차감 0 · 진단 2행 150 kg', inj, [[], [2, 150]]);
    const unit = await ev(() => { ERP.db.add('items', { code: 'TSET1', name: 'test set', unit: 'SET', pcs_per_set: 10, src: 'local' }); ERP.db.add('prod_log', { date: '2026-10-20', process: 'WRP', code: 'TSET1', ok_qty: 100, ok_ea: 100, source: 'manual' });
      const q = () => (ERP.inv.prodPost().rows.find(t => t.code === 'TSET1' && t.kind === 'PROD') || {}).qty; const a = q(); const P = ERP.PROC.find(x => x.id === 'WRP'); P.unit = 'set'; ERP.saveProcs(); const b = q(); P.unit = 'pcs'; ERP.saveProcs(); return [a, b]; });
    eq('공정 단위를 바꾸면 생산 반영도 바로 다시 계산 (pcs 10 set → set 100 set)', unit, [10, 100]);
    const undo = await ev(async () => { const kinds = ['stock_tx']; const before = ERP.lastUpload(kinds); return before; });
    const f = path.join(work, 'tx_undo.xlsx'); { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['일자', '전표번호', '구분', '출발', '도착', '품목코드', '수량'], ['2026-10-21', 'UN-1', '입고', '', '창고', 'R-001', 1]]), 's'); XLSX.writeFile(wb, f); }
    await upload([f], "j => j.table === 'stock_tx'");
    await page.click('text=되돌리기'); await page.waitForTimeout(300); await page.click('.modal-foot .btn.primary'); await page.waitForTimeout(400);
    eq('되돌리기 → 마지막 업로드일도 되돌아감', await ev(() => ERP.lastUpload(['stock_tx'])), undo);
    const sim = await ev(() => { const r = ERP.inv.postRows([{ _id: 'y1', date: '2026-10-20', process: 'PCK', code: '52-9724-K-000', ok_qty: 120 }], { mode: 'in_bom' }); return r.diag.similar ? Array.from(r.diag.similar.keys()) : null; });
    ok('포장 BOM 을 비슷한 품번으로 대신 쓰면 진단에 표시', Array.isArray(sim) && sim.includes('52-9724-K-000'), sim);
    const ab = await ev(() => { ERP.state.bomTab = 'asm'; ERP.state.asm = { kind: 'asm', line: '', stat: '', q: '', page: 0, pick: {} }; ERP.goto('bom'); ERP.render();
      const plan = ERP.inv.asmPlan().filter(x => !x.stp && !x.existing); const high = plan.filter(x => x.conf === 'high').length; const btn = Array.from(document.querySelectorAll('main button.btn.primary')).find(b => /확실한 부품만/.test(b.textContent)); return { high, label: btn ? btn.textContent : '' }; });
    ok('자동 BOM 일괄 적용 = 모든 부품이 확실한 품번만', ab.label.includes('(' + ab.high + ')'), ab);
    const loc = await ev(() => { ERP.db.add('items', { code: 'LOCAL-1', name: 'Mine', src: 'local' }); const job = ERP.ecount.itemsJob([{ code: 'LOCAL-1', name: 'Other', erp_code: 'SM-X-Y-LOCAL-1' }]); ERP.xl.apply(job);
      const it = ERP.db.rows('items').find(x => x.code === 'LOCAL-1'); const out = [it.name, it.src]; ERP.db.rows('items').forEach(r => { delete r.missing; }); ERP.db.touch('items'); return out; });
    eq('ECOUNT 품목 재업로드: 직접 만든 품목은 그대로', loc, ['Mine', 'local']);
  }

  await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  section('15. 데모 자료 정리');
  {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'seed', 'seed.json'), 'utf8'));
    const hist = new Set(seed.prod_log.filter(r => r.source === 'history').map(r => r.date + '|' + r.process));
    eq('누적 시트와 같은 날·공정의 일보 행 없음', seed.prod_log.filter(r => r.source === 'daily-report' && hist.has(r.date + '|' + r.process)).length, 0);
    eq('PO 머리글 행(Po No) 없음', seed.po.filter(p => /^po no$/i.test(String(p.po_no))).length, 0);
    eq('8월 10일로 잘못 들어간 종이권취 일보 없음', seed.prod_log.filter(r => r.process === 'WRP' && r.date === '2026-08-10').length, 0);
    eq('시드에 기초재고 기준일', seed._meta && seed._meta.openDate && [seed._meta.openDate.WH, seed._meta.openDate.FAC], ['2026-10-16', '2026-10-16']);
    const oct = seed.prod_log.filter(r => r.process === 'ASM' && r.date >= '2026-10-01' && r.date <= '2026-10-31').reduce((a, r) => a + (r.ok_ea !== undefined && r.ok_ea !== null && r.ok_ea !== '' ? +r.ok_ea : +r.ok_qty || 0), 0);
    eq('10월 조립 합계 = 2,615,099 (중복 제거)', oct, 2615099);
  }

  ok('페이지 오류 0', errors.length === 0, errors.slice(0, 5));
  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + ' / 전체 ' + (pass + fail) : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (fail) { console.log('\n실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
