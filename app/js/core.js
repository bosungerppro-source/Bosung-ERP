/* ColorPencil ERP - core helpers (namespace, i18n, DOM builder, formatting, modal/toast) */
(function (g) {
  'use strict';
  const ERP = g.ERP = { v: '1.2.0', lang: 'ko', pages: {}, state: {} };

  // ---------- language ----------
  try { ERP.lang = localStorage.getItem('erp_lang') || 'ko'; } catch (e) { /* ignore */ }
  /** L(ko, vi): returns the string for the current language */
  g.L = function (ko, vi) { return ERP.lang === 'vi' && (vi || vi === '') ? vi : ko; }; // vi '' = 베트남어에서는 표시 안 함 (예: '건', '개')
  ERP.setLang = function (l) {
    ERP.lang = l; try { localStorage.setItem('erp_lang', l); } catch (e) { /* ignore */ }
    document.documentElement.lang = l;
    ERP.render && ERP.render();
    ERP.aiMount && ERP.aiMount();
  };

  // ---------- DOM builder ----------
  g.h = function (tag, attrs) {
    const el = document.createElement(tag);
    let i = 2;
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs) || typeof attrs === 'string')) i = 1; else attrs = attrs || {};
    if (i === 2) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c.nodeType) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    for (let j = i === 2 ? 2 : 1; j < arguments.length; j++) add(arguments[j]);
    return el;
  };
  g.$ = (s, r) => (r || document).querySelector(s);
  g.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  ERP.svg = function (path, size, sw) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size || 20); s.setAttribute('height', size || 20); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', sw || 1.8);
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.appendChild(p); return s;
  };

  // ---------- formatting ----------
  const F = ERP.fmt = {
    n(x, d) {
      if (x === null || x === undefined || x === '' || isNaN(Number(x))) return '–';
      return Number(x).toLocaleString(ERP.lang === 'vi' ? 'vi-VN' : 'ko-KR', { maximumFractionDigits: d === undefined ? 0 : d, minimumFractionDigits: 0 });
    },
    n1(x) { return F.n(x, 1); }, n2(x) { return F.n(x, 2); },
    pct(x, d) { return (x === null || x === undefined || isNaN(x)) ? '–' : F.n(x * 100, d === undefined ? 1 : d) + '%'; },
    d(s) { return s ? String(s).slice(0, 10) : ''; },
    md(s) { return s ? String(s).slice(5, 10).replace('-', '/') : ''; },
    today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    diffDays(a, b) { return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); },
    dow(s) { const d = new Date(s + 'T00:00:00').getDay(); return (ERP.lang === 'vi' ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] : ['일', '월', '화', '수', '목', '금', '토'])[d]; },
    ym(s) { return s ? String(s).slice(0, 7) : ''; },
  };
  F.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- chip / bar helpers ----------
  ERP.TONE = {
    ok: { bg: '#E3F4EE', fg: '#0B6B52' }, warn: { bg: '#FCEFD9', fg: '#7A4600' }, bad: { bg: '#FBE6E4', fg: '#9F1F18' },
    info: { bg: '#E4EDFB', fg: '#174A94' }, neutral: { bg: '#EEF0F3', fg: '#3C4551' },
  };
  ERP.BAR = { ok: '#0E7A5F', warn: '#C77700', bad: '#B3261E', info: '#1F5FBF', neutral: '#8A93A0' };
  ERP.chip = (tone, label) => h('span', { class: 'chip', style: { background: ERP.TONE[tone].bg, color: ERP.TONE[tone].fg } }, label);
  ERP.bar = (pct, tone) => h('div', { class: 'bar' }, h('i', { style: { width: Math.max(0, Math.min(100, pct || 0)) + '%', background: ERP.BAR[tone || 'info'] } }));

  // ---------- toast / modal ----------
  ERP.toast = function (msg, tone) {
    let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); }
    const t = h('div', { class: 'toast ' + (tone || '') }, msg); box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, tone === 'bad' ? 6000 : 3200);
  };
  ERP.modal = function (o) {
    const back = h('div', { class: 'modal-back' });
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); o.onClose && o.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const foot = h('div', { class: 'modal-foot' });
    (o.buttons || []).forEach(b => foot.appendChild(h('button', {
      type: 'button', class: 'btn ' + (b.kind || ''), onclick: async () => { const r = b.onClick ? await b.onClick(close) : undefined; if (r !== false && !b.keep) close(); },
    }, b.label)));
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: o.width ? { width: o.width } : null },
      h('div', { class: 'modal-head' }, h('h3', o.title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'close', onclick: close }, '×')),
      h('div', { class: 'modal-body' }, o.body), (o.buttons && o.buttons.length) ? foot : null);
    back.appendChild(box); document.body.appendChild(back);
    const f = box.querySelector('input,select,textarea'); f && f.focus();
    return { close, box };
  };
  ERP.confirm = function (msg, okLabel, danger) {
    return new Promise(res => {
      ERP.modal({ title: L('확인', 'Xác nhận'), width: '420px', body: h('p', { style: { margin: 0, whiteSpace: 'pre-line' } }, msg),
        buttons: [{ label: L('취소', 'Hủy'), onClick: () => { res(false); } }, { label: okLabel || L('확인', 'Đồng ý'), kind: danger ? 'danger' : 'primary', onClick: () => { res(true); } }],
        onClose: () => res(false) });
    });
  };
  ERP.download = function (name, blob) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  ERP.kpi = function (label, value, unit, chipTone, chipLabel, note, barPct, barTone) {
    return h('div', { class: 'card kpi' },
      h('div', { class: 'kpi-label' }, label),
      h('div', { class: 'kpi-val' }, h('span', { class: 'v' }, value), unit ? h('span', { class: 'u' }, unit) : null),
      barPct !== undefined && barPct !== null ? ERP.bar(barPct, barTone) : null,
      h('div', { class: 'kpi-note' }, chipLabel ? ERP.chip(chipTone, chipLabel) : null, note ? h('span', note) : null));
  };
  ERP.tabs = function (defs, current, onSelect) {
    return h('div', { class: 'tabs', role: 'tablist' }, defs.map(d => h('button', { type: 'button', role: 'tab', class: 'tab' + (d.id === current ? ' on' : ''),
      'aria-selected': d.id === current ? 'true' : 'false', onclick: () => onSelect(d.id) }, d.label)));
  };

  // Re-entrancy guard: removing a focused <input> fires change/blur handlers that may redraw the same container.
  (function () {
    if (typeof Element === 'undefined' || !Element.prototype.replaceChildren) return; // Node 시험 도구 (DOM 없음)
    const rc = Element.prototype.replaceChildren; const busy = new WeakSet();
    Element.prototype.replaceChildren = function () { const a = arguments; if (busy.has(this)) { setTimeout(() => this.replaceChildren.apply(this, a), 0); return; } busy.add(this); try { rc.apply(this, a); } finally { busy.delete(this); } };
  })();
})(window);
