(function () {
  'use strict';
  /** ui.js — Componentes de interfaz reutilizables (todos escapan datos vía html``). */
  const { html, raw, mount, $ } = SIGEC.use('core/dom');
  const { num, dec } = SIGEC.use('core/format');
  const { ESTADOS, SEVERIDADES } = SIGEC.use('data/catalogs');
  // --------------------------------------------------------------- Toasts
  const TOAST_ICON = { ok: 'bi-check-circle-fill', warn: 'bi-exclamation-triangle-fill', crit: 'bi-x-octagon-fill', info: 'bi-info-circle-fill' };
  function toast(message, kind = 'info', ms = 4200) {
    const stack = $('#toasts');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast-x toast-x--${kind}`;
    mount(el, html`<i class="bi ${TOAST_ICON[kind] || TOAST_ICON.info}" aria-hidden="true"></i><div>${message}</div>`);
    stack.appendChild(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 220); }, ms);
  }

  // --------------------------------------------------------------- Badges
  function estadoBadge(estado) {
    const e = ESTADOS.find((x) => x.code === estado) || { badge: 'neutral', icon: 'bi-circle' };
    return html`<span class="badge-x badge--${e.badge}"><i class="bi ${e.icon}" aria-hidden="true"></i>${estado}</span>`;
  }
  function severidadBadge(sev) {
    const s = SEVERIDADES.find((x) => x.code === sev) || { badge: 'neutral', icon: 'bi-circle' };
    return html`<span class="badge-x badge--${s.badge}"><i class="bi ${s.icon}" aria-hidden="true"></i>${sev}</span>`;
  }
  function badge(text, kind = 'neutral', icon) {
    return html`<span class="badge-x badge--${kind}">${icon ? html`<i class="bi ${icon}" aria-hidden="true"></i>` : ''}${text}</span>`;
  }
  function stars(n, max = 5) {
    const k = Math.round(n);
    return html`<span class="stars" role="img" aria-label="${k} de ${max} estrellas">${raw('★'.repeat(k))}<span class="off">${raw('★'.repeat(max - k))}</span></span>`;
  }

  // ---------------------------------------------------------------- Delta
  /** goodWhen: 'up' | 'down' — define si subir es bueno o malo. */
  function delta(value, prev, { goodWhen = 'up', mode = 'pct', label = 'vs periodo anterior' } = {}) {
    if (value == null || prev == null || (mode === 'pct' && !prev)) return html`<span class="delta delta--flat">—</span>`;
    const diff = mode === 'pct' ? ((value - prev) / prev) * 100 : value - prev;
    if (Math.abs(diff) < 0.05) return html`<span class="delta delta--flat" title="${label}"><i class="bi bi-dash" aria-hidden="true"></i>0%</span>`;
    const up = diff > 0;
    const good = (up && goodWhen === 'up') || (!up && goodWhen === 'down');
    const txt = mode === 'pct' ? `${dec(Math.abs(diff))}%` : `${dec(Math.abs(diff))} pts`;
    return html`<span class="delta ${good ? 'delta--good' : 'delta--bad'}" title="${label}">
      <i class="bi ${up ? 'bi-caret-up-fill' : 'bi-caret-down-fill'}" aria-hidden="true"></i>${txt}
      <span class="visually-hidden">${up ? 'aumento' : 'disminución'} ${label}</span></span>`;
  }

  // ------------------------------------------------------------ Sparkline
  function sparkline(values, tone = 'c1') {
    const v = values.map((x) => (Number.isFinite(x) ? x : 0));
    if (v.length < 2) return '';
    const W = 200, H = 34, P = 3;
    const min = Math.min(...v), max = Math.max(...v);
    const span = max - min || 1;
    const pts = v.map((y, i) => [P + (i * (W - 2 * P)) / (v.length - 1), H - P - ((y - min) / span) * (H - 2 * P)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${d} L${pts.at(-1)[0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
    // Solo números en el path: se construye con raw() de forma segura.
    const t = /^[a-z0-9-]+$/.test(tone) ? tone : 'c1';
    return raw(`<svg class="kpi__spark tone-${t}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="area" d="${area}"/><path class="line" d="${d}"/></svg>`);
  }

  // ----------------------------------------------------------------- Ring
  function ring(percent, tone = 'c1') {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const R = 48, C = 2 * Math.PI * R;
    const off = C * (1 - p / 100);
    const t = /^[a-z0-9-]+$/.test(tone) ? tone : 'c1';
    return raw(`<svg class="ring tone-${t}" viewBox="0 0 118 118" role="img" aria-label="${Math.round(p)} por ciento">
      <circle class="track" cx="59" cy="59" r="${R}"/>
      <circle class="bar" cx="59" cy="59" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
      <text x="59" y="66" text-anchor="middle">${Math.round(p)}%</text></svg>`);
  }

  // ------------------------------------------------------------------ KPI
  function kpiCard({ label, value, unit, icon, tone = 'brand', deltaHtml, spark, sparkTone, foot }) {
    return html`<article class="kpi">
      <div class="kpi__top">
        <span class="kpi__icon kpi__icon--${tone}" aria-hidden="true"><i class="bi ${icon}"></i></span>
        <div class="min-w-0">
          <div class="kpi__label">${label}</div>
          <div class="kpi__row"><span class="kpi__value">${value}${unit ? html`<small>${unit}</small>` : ''}</span>${deltaHtml || ''}</div>
        </div>
      </div>
      ${spark ? sparkline(spark, sparkTone) : ''}
      ${foot ? html`<div class="kpi__foot">${foot}</div>` : ''}
    </article>`;
  }

  // ---------------------------------------------------------- Paginación
  function pagination({ page, pages, total, pageSize }) {
    const from = total ? (page - 1) * pageSize + 1 : 0;
    const to = Math.min(total, page * pageSize);
    const nums = [];
    const push = (n) => nums.push(n);
    const win = 1;
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= page - win && i <= page + win)) push(i);
      else if (nums.at(-1) !== '…') push('…');
    }
    return html`<div class="table-foot">
      <span>Mostrando ${num(from)} – ${num(to)} de ${num(total)} registros</span>
      <nav class="pager" aria-label="Paginación">
        <button type="button" data-page="1" ${page <= 1 ? raw('disabled') : ''} aria-label="Primera página"><i class="bi bi-chevron-double-left"></i></button>
        <button type="button" data-page="${page - 1}" ${page <= 1 ? raw('disabled') : ''} aria-label="Página anterior"><i class="bi bi-chevron-left"></i></button>
        ${nums.map((n) => (n === '…'
          ? html`<span class="gap">…</span>`
          : html`<button type="button" data-page="${n}" ${n === page ? raw('aria-current="page"') : ''}>${n}</button>`))}
        <button type="button" data-page="${page + 1}" ${page >= pages ? raw('disabled') : ''} aria-label="Página siguiente"><i class="bi bi-chevron-right"></i></button>
        <button type="button" data-page="${pages}" ${page >= pages ? raw('disabled') : ''} aria-label="Última página"><i class="bi bi-chevron-double-right"></i></button>
      </nav>
    </div>`;
  }

  // ------------------------------------------------------- Vacío / carga
  function empty(title = 'Sin resultados', hint = 'Ajusta los filtros e intenta de nuevo.', icon = 'bi-inbox') {
    return html`<div class="empty"><i class="bi ${icon}" aria-hidden="true"></i><strong>${title}</strong>${hint}</div>`;
  }
  function viewSkeleton() {
    return html`<div class="view-loading" aria-busy="true" aria-label="Cargando">
      <div class="skeleton h-40"></div>
      <div class="kpi-grid">${[1, 2, 3, 4].map(() => html`<div class="skeleton h-110"></div>`)}</div>
      <div class="grid-2"><div class="skeleton h-300"></div><div class="skeleton h-300"></div></div>
    </div>`;
  }

  function pageHead({ icon, title, subtitle, aside }) {
    return html`<header class="page-head">
      <span class="page-head__icon" aria-hidden="true"><i class="bi ${icon}"></i></span>
      <div><h2 id="page-title" tabindex="-1">${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
      ${aside ? html`<div class="page-head__aside">${aside}</div>` : ''}
    </header>`;
  }

  function options(list, selected, { all } = {}) {
    return html`${all ? html`<option value="">${all}</option>` : ''}${list.map((o) => {
      const v = typeof o === 'string' ? o : o.value ?? o.code;
      const l = typeof o === 'string' ? o : o.label ?? o.name ?? o.code;
      return html`<option value="${v}" ${String(v) === String(selected ?? '') ? raw('selected') : ''}>${l}</option>`;
    })}`;
  }

  // -------------------------------------------------------------- Modal
  /** Crea un modal Bootstrap efímero; devuelve { el, modal, close }. */
  function openModal({ title, icon = 'bi-pencil-square', body, footer, size = '' }) {
    const host = document.createElement('div');
    host.className = 'modal fade';
    host.tabIndex = -1;
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('role', 'dialog');
    const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
    host.setAttribute('aria-labelledby', titleId);
    mount(host, html`<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size}">
      <div class="modal-content">
        <div class="modal-header"><h2 class="modal-title" id="${titleId}"><i class="bi ${icon}" aria-hidden="true"></i>${title}</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
        <div class="modal-body">${body}</div>
        ${footer ? html`<div class="modal-footer">${footer}</div>` : ''}
      </div></div>`);
    document.body.appendChild(host);
    const modal = new window.bootstrap.Modal(host, { backdrop: 'static' });
    host.addEventListener('hidden.bs.modal', () => { modal.dispose(); host.remove(); });
    modal.show();
    return { el: host, modal, close: () => modal.hide() };
  }

  // ------------------------------------------------------------ Export CSV
  /** CSV con BOM (Excel) y neutralización de inyección de fórmulas. */
  function downloadCSV(filename, columns, rows) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [columns.map((c) => cell(c.label)).join(',')];
    rows.forEach((r) => lines.push(columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[^\w.-]+/g, '_');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /** Muestra errores de validación por campo en un formulario Bootstrap. */
  function showFieldErrors(form, errors = {}) {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    form.querySelectorAll('.invalid-feedback[data-for]').forEach((el) => { el.textContent = ''; });
    Object.entries(errors).forEach(([name, msg]) => {
      const input = form.elements[name];
      if (input) input.classList.add('is-invalid');
      const fb = form.querySelector(`.invalid-feedback[data-for="${name}"]`);
      if (fb) fb.textContent = msg;
    });
    const first = Object.keys(errors)[0];
    if (first && form.elements[first]) form.elements[first].focus();
  }

  SIGEC.define('core/ui', { toast, estadoBadge, severidadBadge, badge, stars, delta, sparkline, ring, kpiCard, pagination, empty, viewSkeleton, pageHead, options, openModal, downloadCSV, showFieldErrors });
})();
