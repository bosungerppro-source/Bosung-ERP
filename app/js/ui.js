/* UI components: data grid with search/sort/paging/CRUD, record form */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt;

  ERP.cellText = function (c, v) {
    if (v === null || v === undefined || v === '') return '';
    if (c.t === 'n') { const x = Number(v); if (isNaN(x)) return String(v); return F.n(x, Number.isInteger(x) ? 0 : (Math.abs(x) < 1000 ? 2 : 1)); }
    if (c.t === 'd') return F.d(v);
    if (c.t === 'b') return v ? '✓' : '';
    const o = ERP.colOpts(c); if (o && (c.t === 's')) { const f = o.find(x => String(x.v) === String(v)); return f ? f.label : String(v); }
    return String(v);
  };

  /** generic form modal for a table row */
  ERP.form = function (table, row, o) {
    o = o || {}; const S = ERP.TABLES[table]; const isNew = !row; const data = Object.assign({}, o.defaults || {}, row || {});
    const inputs = {};
    const fields = S.cols.filter(c => !(o.hide || []).includes(c.k)).map(c => {
      let inp;
      const opts = ERP.colOpts(c);
      if (c.t === 's' || (opts && c.t === 't' && false)) {
        inp = h('select', { class: 'inp' }, h('option', { value: '' }, '—'), (opts || []).map(x => h('option', { value: x.v, selected: String(data[c.k]) === String(x.v) }, x.label)));
      } else if (c.t === 'b') {
        inp = h('input', { type: 'checkbox', checked: !!data[c.k], style: { width: '20px', height: '20px' } });
      } else {
        const type = c.t === 'n' ? 'number' : c.t === 'd' ? 'date' : c.t === 'tm' ? 'time' : 'text';
        inp = h('input', { class: 'inp', type, step: c.t === 'n' ? 'any' : null, value: data[c.k] === undefined || data[c.k] === null ? '' : data[c.k] });
        if (opts && c.t === 't') { const id = 'dl_' + table + '_' + c.k; inp.setAttribute('list', id); inp = h('span', { style: { display: 'contents' } }, inp, h('datalist', { id }, opts.map(x => h('option', { value: x.v })))); inputs[c.k] = inp.firstChild; }
      }
      if (!inputs[c.k]) inputs[c.k] = inp;
      return h('div', { class: 'field' }, h('label', ERP.colLabel(c), c.req ? h('span', { class: 'req' }, ' *') : null), inp);
    });
    const collect = () => {
      const out = {};
      for (const c of S.cols) {
        const el = inputs[c.k]; if (!el) continue; let v;
        if (c.t === 'b') v = el.checked; else v = el.value;
        if (c.t === 'n') v = v === '' ? undefined : Number(v);
        else if (c.t !== 'b') v = v === '' ? undefined : v;
        out[c.k] = v;
      }
      return out;
    };
    const modal = ERP.modal({
      title: (isNew ? L('추가 · ', 'Thêm · ') : L('수정 · ', 'Sửa · ')) + ERP.tableLabel(table), width: '980px',
      body: h('div', { class: 'form-grid' }, fields),
      buttons: [].concat(!isNew && o.canDelete !== false ? [{ label: L('삭제', 'Xóa'), kind: 'danger', onClick: async (close) => {
        if (await ERP.confirm(L('이 행을 삭제할까요?', 'Xóa dòng này?'), L('삭제', 'Xóa'), true)) { DB.remove(table, row._id); o.onSaved && o.onSaved(); ERP.toast(L('삭제했습니다', 'Đã xóa'), 'ok'); } else return false;
      } }] : [], [{ label: L('취소', 'Hủy') }, { label: L('저장', 'Lưu'), kind: 'primary', onClick: () => {
        const v = collect();
        for (const c of S.cols) if (c.req && (v[c.k] === undefined || v[c.k] === '')) { ERP.toast(ERP.colLabel(c) + L(' 입력이 필요합니다', ' là bắt buộc'), 'bad'); return false; }
        if (o.beforeSave) { const r = o.beforeSave(v); if (r === false) return false; }
        Object.keys(v).forEach(k => { if (v[k] === undefined) delete v[k]; });
        if (isNew) DB.add(table, v); else { const r2 = DB.rows(table).find(x => x._id === row._id); S.cols.forEach(c => { if (!(c.k in v)) delete r2[c.k]; }); DB.update(table, row._id, v); }
        ERP.toast(L('저장했습니다', 'Đã lưu'), 'ok'); o.onSaved && o.onSaved();
      } }]),
    });
    return modal;
  };

  /** Data grid */
  ERP.grid = function (opt) {
    const table = opt.table; const S = ERP.TABLES[table];
    const st = { q: '', sk: opt.sortKey || (S.sort ? S.sort[0] : null), sd: opt.sortDir || (S.sort ? S.sort[1] : 1), page: 0, ps: opt.pageSize || 50, f: {}, sel: new Set() };
    const el = h('div');
    const getCols = () => (opt.cols || S.cols.filter(c => c.list));
    const baseRows = () => opt.rows ? opt.rows() : DB.rows(table);

    function filtered() {
      let rows = baseRows();
      (opt.filters || []).forEach(f => { const v = st.f[f.id]; if (v) rows = rows.filter(r => f.test ? f.test(r, v) : String(r[f.key]) === v); });
      if (st.q) {
        const q = st.q.toLowerCase();
        const keys = (opt.searchKeys || S.cols.map(c => c.k));
        rows = rows.filter(r => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).toLowerCase().includes(q)) return true; } return false; });
      }
      if (st.sk) {
        const k = st.sk, d = st.sd; const col = getCols().find(c => c.k === k) || S.cols.find(c => c.k === k);
        const isN = col && col.t === 'n';
        rows = rows.slice().sort((a, b) => {
          let x = a[k], y = b[k];
          if (x === undefined || x === null || x === '') return 1; if (y === undefined || y === null || y === '') return -1;
          if (isN) return (Number(x) - Number(y)) * d;
          return String(x).localeCompare(String(y), undefined, { numeric: true }) * d;
        });
      }
      return rows;
    }

    function render() {
      const cols = getCols(); const rows = filtered(); const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / st.ps)); if (st.page >= pages) st.page = pages - 1;
      const slice = rows.slice(st.page * st.ps, st.page * st.ps + st.ps);
      const canEdit = opt.canEdit !== false;
      const tb = h('div', { class: 'toolbar' },
        h('label', { class: 'search' }, ERP.svg('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z', 17), h('input', { type: 'search', placeholder: L('검색', 'Tìm kiếm'), value: st.q, oninput: (e) => { st.q = e.target.value; st.page = 0; clearTimeout(st._t); st._t = setTimeout(() => { render(); const i = $('.search input', el); i && (i.focus(), i.setSelectionRange(i.value.length, i.value.length)); }, 250); } })),
        (opt.filters || []).map(f => h('select', { class: 'inp', 'aria-label': f.label, onchange: (e) => { st.f[f.id] = e.target.value; st.page = 0; render(); } },
          h('option', { value: '' }, f.label + ': ' + L('전체', 'Tất cả')), f.options().map(o => h('option', { value: o.v, selected: st.f[f.id] === String(o.v) }, o.label)))),
        opt.toolbar ? opt.toolbar(st, render) : null,
        h('span', { class: 'sp' }),
        st.sel.size ? h('button', { class: 'btn danger sm', onclick: async () => { if (await ERP.confirm(L(st.sel.size + '개 행을 삭제할까요?', 'Xóa ' + st.sel.size + ' dòng?'), L('삭제', 'Xóa'), true)) { DB.remove(table, Array.from(st.sel)); st.sel.clear(); render(); } } }, L('선택 삭제 (' + st.sel.size + ')', 'Xóa đã chọn (' + st.sel.size + ')')) : null,
        opt.export !== false ? h('button', { class: 'btn sm', onclick: () => ERP.xl.exportRows(table, rows, cols) }, L('엑셀 내보내기', 'Xuất Excel')) : null,
        opt.canAdd !== false ? h('button', { class: 'btn primary', onclick: () => ERP.form(table, null, { defaults: opt.defaults ? opt.defaults() : {}, onSaved: render, beforeSave: opt.beforeSave }) }, '+ ' + L('추가', 'Thêm')) : null);

      const thead = h('tr', canEdit ? h('th', { style: { width: '32px' } }, h('input', { type: 'checkbox', 'aria-label': 'select all', checked: slice.length && slice.every(r => st.sel.has(r._id)), onchange: (e) => { slice.forEach(r => e.target.checked ? st.sel.add(r._id) : st.sel.delete(r._id)); render(); } })) : null,
        cols.map(c => h('th', { class: 'sortable' + (c.t === 'n' ? ' num' : ''), onclick: () => { if (st.sk === c.k) st.sd = -st.sd; else { st.sk = c.k; st.sd = 1; } render(); } },
          ERP.colLabel(c), st.sk === c.k ? (st.sd > 0 ? ' ▲' : ' ▼') : '')),
        (opt.extraCols || []).map(c => h('th', { class: c.num ? 'num' : '' }, c.label())));
      const tbody = slice.map(r => h('tr', { class: (opt.onRowClick || canEdit ? 'click' : '') + (st.sel.has(r._id) ? ' sel' : ''), onclick: (e) => {
          if (e.target.tagName === 'INPUT') return;
          if (opt.onRowClick) opt.onRowClick(r, render); else if (canEdit) ERP.form(table, r, { onSaved: render, beforeSave: opt.beforeSave });
        } },
        canEdit ? h('td', h('input', { type: 'checkbox', checked: st.sel.has(r._id), onchange: (e) => { e.target.checked ? st.sel.add(r._id) : st.sel.delete(r._id); render(); } })) : null,
        cols.map(c => h('td', { class: c.t === 'n' ? 'num' : '', title: r[c.k] !== undefined ? String(r[c.k]) : null }, ERP.cellText(c, r[c.k]))),
        (opt.extraCols || []).map(c => h('td', { class: c.num ? 'num' : '' }, c.render(r)))));
      const body = h('div', { class: 'tbl-wrap', style: opt.maxH ? { maxHeight: opt.maxH } : null }, h('table', { class: 'tbl' }, h('thead', thead), h('tbody', tbody)));
      const pager = h('div', { class: 'pager' },
        h('span', total.toLocaleString() + L('건', ' dòng') + (total !== baseRows().length ? ' / ' + L('전체 ', 'tổng ') + baseRows().length.toLocaleString() : '')),
        h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } },
          h('button', { class: 'btn', disabled: st.page === 0, onclick: () => { st.page--; render(); } }, '‹'),
          (st.page + 1) + ' / ' + pages,
          h('button', { class: 'btn', disabled: st.page >= pages - 1, onclick: () => { st.page++; render(); } }, '›'),
          h('select', { class: 'inp', style: { minHeight: '32px' }, onchange: (e) => { st.ps = Number(e.target.value); st.page = 0; render(); } }, [25, 50, 100, 200].map(n => h('option', { value: n, selected: st.ps === n }, n + L('개씩', '/trang'))))));
      el.replaceChildren(...[tb, total ? body : h('div', { class: 'empty' }, L('데이터가 없습니다.', 'Không có dữ liệu.')), total ? pager : null].filter(Boolean));   // null 을 넘기면 "null" 글자가 붙는다
    }
    render();
    return { el, refresh: render, state: st };
  };

  // simple table (no CRUD) used by reports
  ERP.simpleTable = function (cols, rows, o) {
    o = o || {};
    return h('div', { class: 'tbl-wrap', style: o.maxH ? { maxHeight: o.maxH } : null }, h('table', { class: 'tbl' },
      h('thead', h('tr', cols.map(c => h('th', { class: c.num ? 'num' : '' }, c.label)))),
      h('tbody', rows.length ? rows.map(r => h('tr', { class: o.onClick ? 'click' : '', onclick: o.onClick ? () => o.onClick(r) : null }, cols.map(c => h('td', { class: c.num ? 'num' : '', style: c.style ? c.style(r) : null }, c.render(r))))) : h('tr', h('td', { colspan: cols.length, class: 'empty' }, L('데이터가 없습니다.', 'Không có dữ liệu.'))))));
  };

  // chart helper (Chart.js)
  ERP.charts = [];
  ERP.chart = function (cfg, tall) {
    const cv = h('canvas'); const box = h('div', { class: 'chart-box' + (tall ? ' tall' : '') }, cv);
    setTimeout(() => {
      if (!window.Chart) { box.textContent = 'Chart.js missing'; return; }
      cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } } }, cfg.options || {});
      try { ERP.charts.push(new Chart(cv, cfg)); } catch (e) { console.error(e); }
    }, 0);
    return box;
  };
  ERP.destroyCharts = () => { ERP.charts.forEach(c => { try { c.destroy(); } catch (e) { /* ignore */ } }); ERP.charts = []; };
  ERP.palette = ['#1F5FBF', '#0E7A5F', '#B45F06', '#5B4BB7', '#A8326B', '#2B7A8C', '#8A93A0', '#C77700', '#B3261E'];
})();
