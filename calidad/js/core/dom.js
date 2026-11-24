(function () {
  'use strict';
  /**
   * dom.js — Renderizado seguro.
   *
   * Toda interpolación dentro de html`` se ESCAPA automáticamente.
   * Para insertar marcado de confianza (otro html``), se pasa tal cual:
   * el resultado de html`` es un SafeHTML y no se vuelve a escapar.
   * Nunca usar raw() con datos provenientes del usuario o del servidor.
   */

  class SafeHTML {
    constructor(value) { this.value = value; }
    toString() { return this.value; }
  }

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"'`=]/g, (c) => ESC_MAP[c]);
  }

  function renderValue(v) {
    if (v === null || v === undefined || v === false) return '';
    if (v instanceof SafeHTML) return v.value;
    if (Array.isArray(v)) return v.map(renderValue).join('');
    return esc(v);
  }

  function html(strings, ...values) {
    let out = '';
    for (let i = 0; i < strings.length; i++) {
      out += strings[i];
      if (i < values.length) out += renderValue(values[i]);
    }
    return new SafeHTML(out);
  }

  /** Solo para cadenas literales del propio código (p. ej. SVG generado con números). */
  function raw(trustedString) { return new SafeHTML(String(trustedString)); }

  /** Inserta SafeHTML en un contenedor y aplica estilos dinámicos permitidos por la CSP. */
  function mount(el, safe) {
    if (!(safe instanceof SafeHTML)) throw new TypeError('mount() requiere html``');
    el.innerHTML = safe.value;
    hydrate(el);
    return el;
  }

  /**
   * La CSP bloquea atributos style="" en marcado; los valores dinámicos se
   * declaran como data-* y se aplican aquí vía CSSOM (permitido por la CSP).
   */
  function hydrate(root) {
    root.querySelectorAll('[data-w]').forEach((el) => {
      const n = Math.max(0, Math.min(100, Number(el.dataset.w) || 0));
      requestAnimationFrame(() => { el.style.width = n + '%'; });
    });
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Delegación de eventos: on(root, 'click', '[data-action="x"]', fn) */
  function on(root, type, selector, handler, opts) {
    const fn = (ev) => {
      const target = ev.target.closest(selector);
      if (target && root.contains(target)) handler(ev, target);
    };
    root.addEventListener(type, fn, opts);
    return () => root.removeEventListener(type, fn, opts);
  }

  function debounce(fn, ms = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /** Solo permite URLs relativas, http(s) y mailto/tel. */
  function safeUrl(url) {
    const s = String(url ?? '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    // Relativa: sin esquema (nada de "javascript:", "data:", etc.)
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith('//')) return s;
    return '#';
  }

  SIGEC.define('core/dom', { esc, html, raw, mount, hydrate, $, $$, on, debounce, safeUrl });
})();
