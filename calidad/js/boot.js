/*
 * boot.js — se ejecuta en <head>, antes del primer pintado.
 * 1) Aplica el tema guardado (evita parpadeo claro→oscuro).
 * 2) Detecta el modo incrustado (?embed=1) y publica SIGEC_ENV.
 * 3) Si la página es privada y no hay sesión vigente, redirige al login.
 *
 * NOTA DE SEGURIDAD: esta verificación es solo de experiencia de usuario.
 * La protección real de los datos debe residir en el servidor
 * (Supabase Auth + Row Level Security). Nunca confiar en el cliente.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var cfg = window.SIGEC_CONFIG || {};
  var embed = new URLSearchParams(window.location.search).get('embed') === '1';

  // Solo URLs relativas o http(s); descarta javascript:, data:, etc.
  function safe(url) {
    if (!url) return null;
    var s = String(url).trim();
    if (/^https?:/i.test(s)) return s;
    return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('//') === 0 ? null : s;
  }
  function page(name, params, hash) {
    var q = new URLSearchParams(params || {});
    if (embed) q.set('embed', '1');
    var qs = q.toString();
    return name + (qs ? '?' + qs : '') + (hash || '');
  }
  var minutes = Number(cfg.minutosInactividad) > 0 ? Number(cfg.minutosInactividad) : 15;

  var ENV = {
    embed: embed,
    idleMs: minutes * 60000,
    portalUrl: safe(cfg.portalUrl),
    page: page,
    goLogin: function (reason) {
      // Incrustado: decide el anfitrión (vuelve a entregar la sesión o cierra el módulo).
      var marco = null;
      try { marco = embed ? window.frameElement : null; } catch (e) { marco = null; }
      if (marco && typeof marco.sigecAlSalir === 'function') {
        marco.sigecAlSalir(reason || '');
        return;
      }
      var custom = safe(cfg.loginUrl);
      if (custom) {
        // El login del anfitrión debe ocupar toda la ventana, no el marco.
        (embed ? window.top : window).location.replace(new URL(custom, window.location.href).href);
        return;
      }
      window.location.replace(page('login.html', reason ? { motivo: reason } : {}));
    },
  };
  Object.defineProperty(window, 'SIGEC_ENV', { value: Object.freeze(ENV) });

  // Módulo que solo vive dentro del sistema anfitrión: abierto suelto, se va allá.
  if (cfg.soloIncrustado === true && !embed && safe(cfg.portalUrl)) {
    window.location.replace(new URL(safe(cfg.portalUrl), window.location.href).href);
    return;
  }

  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  // --- Tema -----------------------------------------------------------
  var pref = read('sigec.theme') || 'light';
  var dark = pref === 'dark' ||
    (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  if (read('sigec.density') === 'compact') root.setAttribute('data-density', 'compact');
  if (embed) root.setAttribute('data-embed', '1');

  // --- Guardia de sesión (solo páginas privadas) ---------------------
  if (document.currentScript && document.currentScript.hasAttribute('data-public')) return;

  var raw = null;
  try { raw = window.sessionStorage.getItem('sigec.session'); } catch (e) { raw = null; }
  var ok = false;
  if (raw) {
    try {
      var s = JSON.parse(raw);
      ok = !!(s && s.user && typeof s.lastActivity === 'number' && (Date.now() - s.lastActivity) < ENV.idleMs);
      if (!ok) window.sessionStorage.removeItem('sigec.session');
    } catch (e) { ok = false; }
  }
  if (!ok) ENV.goLogin(raw ? 'inactividad' : '');
})();
