/* 15차(v1.10.0) 휴대폰으로 보기
   ① 공장 Wi-Fi 안에서: 사내망 접속(9차)으로 휴대폰 브라우저가 ERP 를 그대로 연다 — 설정 카드에 주소 · QR 코드 · 순서
   ② 공장 밖에서: ERP(이 PC)가 종합 현황 · 생산 관리 요약을 구글 웹 앱(google/Code.gs 4판)으로 보내고, 휴대폰은 그 웹 앱 주소를 비밀번호로 연다
      요약은 ERP 가 켜져 있는 동안 15분마다 (바뀐 것이 있거나 1시간이 지났을 때) 보낸다. 비밀번호는 구글 쪽에 해시로만 저장. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;

  /** QR 코드 그림 (app/lib/qrcode.js, MIT) */
  ERP.qrImg = function (text, alt) {
    try { const q = window.qrcode(0, 'M'); q.addData(String(text)); q.make(); return h('img', { src: q.createDataURL(5, 2), alt: alt || String(text), width: 150, height: 150 }); }
    catch (e) { return h('span', { class: 'muted' }, 'QR: ' + e.message); }
  };

  // ---------------------------------------------------------------- 요약 (종합 현황 · 생산 관리 — 종합 현황 화면과 같은 계산)
  const isSet = (p) => p.id === 'PCK' || p.unit === 'set';
  const valOf = (p, a) => (isSet(p) ? a.ok : a.ea);
  const pinfo = (p) => ({ id: p.id, ko: p.ko, vi: p.vi, unit: isSet(p) ? 'set' : 'pcs', color: p.color || '' });
  ERP.mobileSummary = function () {
    const ref = C.latestProdDate(); const ctx = ERP.dashCtx(ref); const procs = ERP.dashProcs();
    const pw = ERP.dashPrevMonth(ref);
    const pck = ctx.byProc.PCK || C.agg([]), avP = ctx.avg.PCK || 0, mP = ctx.monthAgg('PCK', ctx.mStart, ref), pP = ctx.monthAgg('PCK', pw[0], pw[1]);
    let run = 0, tot = 0; procs.forEach(p => { const r = ctx.machRun(p.id); run += r; tot += Math.max(ctx.machTotal(p.id), r); });
    const day = C.agg(ctx.dayRows); const inv = ERP.inv.rows();
    const days = []; for (let i = 0; i < 14; i++) days.push(F.addDays(ref, -i));
    return {
      v: 1, app: 'colorpencil-erp', erp: ERP.v, at: new Date().toISOString(), ref, today: F.today(),
      kpi: {
        pckDay: { ok: pck.ok, ea: pck.ea, n: pck.n, avgPct: avP ? Math.round(pck.ea / avP * 100) : null },
        pckMonth: { ok: mP.ok, prev: pP.ok },
        due: { late: ctx.late.length, soon: ctx.soon.length, open: ctx.open.length },
        open: { n: ctx.open.length, prod: ctx.open.filter(o => o.st === 'prod').length, rem: ctx.open.reduce((a, o) => a + Math.max(0, o.sets - o.packed), 0) },
        low: ctx.low.length,
        ng: { rate: day.ngRate, ng: day.ng, total: day.ea + day.ng },
        mach: { run, tot },
        neg: { mat: inv.filter(s => s.negative && ERP.inv.groupOf(s) === 'mat').length, floor: inv.filter(s => s.negative && ERP.inv.groupOf(s) === 'floor').length },
      },
      procs: procs.map(p => { const a = ctx.byProc[p.id] || C.agg([]); const av = ctx.avg[p.id]; const r = ctx.machRun(p.id);
        return Object.assign(pinfo(p), { val: valOf(p, a), n: a.n, avgPct: av ? Math.round(a.ea / av * 100) : null, run: r, tot: Math.max(ctx.machTotal(p.id), r) }); }),
      due: ctx.open.filter(o => o.p.due).sort((a, b) => a.p.due.localeCompare(b.p.due)).filter(o => o.dday >= -30).slice(0, 8)
        .map(o => ({ po: o.p.po_no || '', customer: o.p.customer || '', item: o.p.item_no || '', kind: o.p.kind || '', packed: o.packed, sets: o.sets, due: o.p.due, dday: o.dday, st: o.st })),
      low: ctx.low.slice().sort((a, b) => (a.bal / (a.safety || 1)) - (b.bal / (b.safety || 1))).slice(0, 8)
        .map(s => ({ code: s.code, name: s.name || '', bal: Math.round(s.bal * 10) / 10, prim: s.prim || '', safety: s.safety || 0, neg: s.status === 'neg' })),
      daily: { days, procs: procs.map(p => Object.assign(pinfo(p), { vals: days.map(d => valOf(p, C.agg((ctx.ix.byDate.get(d) || []).filter(r => r.process === p.id)))) })) },
      month: procs.map(p => Object.assign(pinfo(p), { val: valOf(p, ctx.monthAgg(p.id, ctx.mStart, ref)), prev: valOf(p, ctx.monthAgg(p.id, pw[0], pw[1])) })),
    };
  };

  // ---------------------------------------------------------------- 보내기 (이 PC 만)
  const KEY = 'erp_mobile_last';
  const mob = ERP.mob = { last: null, sig: '', timer: null, busy: null };
  try { mob.last = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mob.last = null; }
  const remember = (o) => { mob.last = o; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 저장소 없음 */ } };
  /** 옛 Code.gs 이면 알아듣게 */
  ERP.gErr = (e) => { const m = String((e && e.message) || e); return /unknown action/.test(m) ? L('Apps Script 가 옛 판입니다 — google/Code.gs 4판을 다시 붙여넣고 "배포 관리 → 새 버전"으로 배포하세요', 'Apps Script là bản cũ — hãy dán lại google/Code.gs bản 4 và triển khai phiên bản mới') : m; };
  ERP.mobileSend = function () {
    if (mob.busy) return mob.busy;
    mob.busy = (async () => {
      const s = ERP.mobileSummary(); const body = JSON.stringify(s);
      try { await ERP.gcall({ action: 'mobile', summary: body }); mob.sig = JSON.stringify(Object.assign({}, s, { at: '' })); remember({ at: s.at, ok: true }); return s; }
      catch (e) { remember({ at: new Date().toISOString(), ok: false, error: ERP.gErr(e) }); throw e; }
    })().finally(() => { mob.busy = null; });
    return mob.busy;
  };
  /** ERP 가 켜져 있는 동안: 켠 뒤 1분, 그 뒤 15분마다 — 요약이 바뀌었거나 마지막으로 보낸 지 1시간이 지났을 때만 */
  ERP.mobileAuto = function (first, every) {
    clearTimeout(mob.timer);
    const tick = () => {
      mob.timer = setTimeout(tick, every || 15 * 60000);
      if (!DB.setting('mobileOn', false) || !DB.setting('gUrl', '')) return;
      let sig = ''; try { sig = JSON.stringify(Object.assign({}, ERP.mobileSummary(), { at: '' })); } catch (e) { return; }
      const old = mob.last && mob.last.ok && Date.now() - Date.parse(mob.last.at) < 3600000;
      if (sig === mob.sig && old) return;
      ERP.mobileSend().catch(() => { /* 마지막 결과는 설정 카드에 보임 */ });
    };
    mob.timer = setTimeout(tick, first === undefined ? 60000 : first);
  };

  // ---------------------------------------------------------------- 설정 카드
  const pad = (x) => String(x).padStart(2, '0');
  const when = (s) => { if (!s) return '–'; const d = new Date(s); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  ERP.phoneCard = function () {
    const box = h('div', { class: 'card', id: 'phoneCard' }, h('h3', L('휴대폰으로 보기', 'Xem trên điện thoại')), h('p', { class: 'help' }, '…'));
    const load = () => fetch('/api/info').then(r => r.json()).then(fill).catch(e => { box.lastChild.textContent = String(e.message || e); });
    function wifi(i) {
      const own = !!i.loopback; const addrs = own ? (i.lan || []) : [location.origin];
      const part = h('div', h('h4', { style: { margin: '6px 0' } }, L('① 공장 Wi-Fi 안에서 — ERP 그대로', '① Trong Wi-Fi nhà máy — ERP đầy đủ')));
      if (own && !i.lanOn) {
        ERP.put(part, h('div', { class: 'toolbar' }, ERP.chip('warn', L('사내망 접속 꺼짐', 'Mạng nội bộ đang tắt'))),
          h('p', { class: 'help' }, L('켜기: 이 PC 의 프로그램 메뉴 ERP → 사내망 접속 켜기 (재시작). 처음 켤 때 Windows 방화벽 창이 뜨면 "허용" 을 누르세요. 그다음 아래 사내망 PIN 을 정하면 휴대폰에서 들어올 수 있습니다.', 'Bật: menu ERP → Bật truy cập LAN (khởi động lại). Nếu Windows Firewall hỏi, hãy bấm "Cho phép". Sau đó đặt mã PIN.')));
        return part;
      }
      if (own && !i.hasPin) ERP.put(part, h('div', { class: 'toolbar' }, ERP.chip('warn', L('PIN 없음', 'Chưa có PIN')), h('span', { class: 'muted' }, L('사내망 접속 · 자동 백업 카드에서 PIN 을 정해야 휴대폰에서 들어올 수 있습니다', 'Hãy đặt mã PIN ở thẻ Mạng nội bộ · Sao lưu'))));
      if (!addrs.length) { ERP.put(part, h('p', { class: 'help' }, L('이 PC 의 네트워크 주소를 찾지 못했습니다 (Wi-Fi · 랜선 연결 확인).', 'Không tìm thấy địa chỉ mạng của máy này.'))); return part; }
      const qr = h('div', { class: 'qr' });
      const show = (u) => { qr.replaceChildren(ERP.qrImg(u, L('휴대폰 주소 QR', 'QR địa chỉ')), h('div', h('div', { class: 'muted' }, L('휴대폰 주소', 'Địa chỉ trên điện thoại')), h('code', u))); };
      const sel = addrs.length > 1 ? h('select', { class: 'inp', onchange: (e) => show(e.target.value) }, addrs.map(a => h('option', { value: a }, a))) : null;
      show(addrs[0]);
      ERP.put(part, sel ? h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, L('주소가 여러 개입니다 — 공장 Wi-Fi 와 같은 대역을 고르세요', 'Có nhiều địa chỉ — chọn cùng dải với Wi-Fi nhà máy')), sel) : null, qr,
        h('p', { class: 'help' }, L('① 휴대폰을 공장 Wi-Fi 에 연결 ② 카메라로 QR 코드를 찍어 주소 열기 ③ PIN 넣기 (처음 한 번, 7일 기억) ④ 브라우저 메뉴 → "홈 화면에 추가" 하면 앱처럼 열립니다. ERP 를 켠 이 PC 가 켜져 있어야 합니다. 휴대폰에서는 왼쪽 메뉴가 위의 [☰] 로 접힙니다.',
          '① Kết nối điện thoại vào Wi-Fi nhà máy ② Quét mã QR bằng camera ③ Nhập PIN (một lần, nhớ 7 ngày) ④ Menu trình duyệt → "Thêm vào màn hình chính". Máy chạy ERP phải đang bật.')));
      return part;
    }
    function google(own) {
      const part = h('div', { style: { borderTop: '1px solid var(--line2)', marginTop: '12px', paddingTop: '6px' } }, h('h4', { style: { margin: '6px 0' } }, L('② 공장 밖에서 — 구글 웹 앱 요약 (종합 현황 · 생산 관리)', '② Ngoài nhà máy — tóm tắt qua ứng dụng web Google')));
      const url = DB.setting('gUrl', '');
      if (!url) {
        ERP.put(part, h('p', { class: 'help' }, L('먼저 엑셀 · 구글 연동 → 구글 시트 · 드라이브에서 Apps Script 주소와 TOKEN 을 넣으세요 (google/Code.gs 4판으로 배포).', 'Trước tiên nhập URL Apps Script và TOKEN ở Excel · Google → Google Sheet · Drive (triển khai google/Code.gs bản 4).')),
          h('button', { class: 'btn', onclick: () => { ERP.state.dataTab = 'google'; ERP.goto('data'); } }, L('구글 연동으로', 'Sang kết nối Google')));
        return part;
      }
      const on = !!DB.setting('mobileOn', false); const last = mob.last;
      const pwIn = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', maxlength: '32', placeholder: L('6~32자', '6~32 ký tự'), style: { width: '170px' } });
      const run = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { ERP.toast(ERP.gErr(e), 'bad'); } box.replaceChildren(); load(); };
      const setPw = (e) => run(e.currentTarget, async () => {
        const v = pwIn.value; if (v.length < 6 || v.length > 32) { ERP.toast(L('비밀번호는 6~32자입니다', 'Mật khẩu 6~32 ký tự'), 'warn'); return; }
        await ERP.gcall({ action: 'mobile_pw', pw: v }); DB.setSetting('mobileOn', true); await DB.flush();
        await ERP.mobileSend(); ERP.toast(L('휴대폰 보기를 켰습니다 — 요약을 보냈습니다', 'Đã bật xem trên điện thoại — đã gửi tóm tắt'), 'ok');
      });
      ERP.put(part, h('div', { class: 'toolbar' }, ERP.chip(on ? 'ok' : 'neutral', on ? L('켜짐', 'Bật') : L('꺼짐', 'Tắt')),
          h('span', { class: 'muted' }, on ? L('마지막 보냄: ', 'Gửi lần cuối: ') + (last ? when(last.at) + (last.ok ? '' : ' · ' + L('실패', 'lỗi')) : '–') : L('비밀번호를 정하면 켜집니다', 'Đặt mật khẩu để bật'))),
        on && last && !last.ok ? h('p', { class: 'warn-text' }, last.error || '') : null,
        h('div', { class: 'qr' }, ERP.qrImg(url, L('구글 웹 앱 주소 QR', 'QR ứng dụng web')), h('div', h('div', { class: 'muted' }, L('휴대폰 주소 (어디서나)', 'Địa chỉ trên điện thoại (mọi nơi)')), h('code', url))),
        own ? h('div', { class: 'toolbar', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, L('휴대폰 보기 비밀번호', 'Mật khẩu xem trên điện thoại')), pwIn,
            h('button', { class: 'btn' + (on ? '' : ' primary'), onclick: setPw }, on ? L('비밀번호 바꾸기', 'Đổi mật khẩu') : L('비밀번호 정하고 켜기', 'Đặt mật khẩu và bật')),
            on ? h('button', { class: 'btn primary', onclick: (e) => run(e.currentTarget, async () => { await ERP.mobileSend(); ERP.toast(L('요약을 보냈습니다', 'Đã gửi tóm tắt'), 'ok'); }) }, L('지금 보내기', 'Gửi ngay')) : null,
            on ? h('button', { class: 'btn', onclick: async (e) => { const btn = e.currentTarget; if (!(await ERP.confirm(L('휴대폰 보기를 끕니다 (구글 쪽 비밀번호를 지우고 더 보내지 않음). 끌까요?', 'Tắt xem trên điện thoại (xóa mật khẩu phía Google, ngừng gửi)?')))) return;
              run(btn, async () => { await ERP.gcall({ action: 'mobile_pw', pw: '' }); DB.setSetting('mobileOn', false); await DB.flush(); ERP.toast(L('휴대폰 보기를 껐습니다', 'Đã tắt xem trên điện thoại'), 'ok'); }); } }, L('끄기', 'Tắt')) : null)
          : h('p', { class: 'help' }, L('비밀번호 · 보내기는 ERP 가 실행 중인 PC 에서 합니다.', 'Đặt mật khẩu · gửi trên máy đang chạy ERP.')),
        h('p', { class: 'help' }, L('휴대폰에서 이 주소를 열고 비밀번호를 넣으면 종합 현황 · 생산 관리 요약을 봅니다 (공장 밖 · 데이터 요금으로도). ERP 가 켜져 있는 동안 15분마다 새로 보냅니다. 비밀번호는 구글 쪽에 해시로만 저장되고, 요약은 이 구글 계정의 드라이브(ColorPencil ERP Backup 폴더)에 있습니다.',
          'Mở địa chỉ này trên điện thoại và nhập mật khẩu để xem tóm tắt Tổng quan · Sản xuất (cả ngoài nhà máy). Khi ERP đang chạy, cứ 15 phút gửi lại. Mật khẩu chỉ lưu dạng băm phía Google; tóm tắt nằm trong Drive của tài khoản Google này.')));
      return part;
    }
    function fill(i) { box.replaceChildren(); ERP.put(box, h('h3', L('휴대폰으로 보기', 'Xem trên điện thoại')), wifi(i), google(!!i.loopback)); }
    load();
    return box;
  };
})();
