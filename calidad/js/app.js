(function () {
  'use strict';
  /** app.js — Arranque del shell de la aplicación. */
  const { $, html, mount, on } = SIGEC.use('core/dom');
  const { relative, initials } = SIGEC.use('core/format');
  const session = SIGEC.use('core/session');
  const { conectar, salir } = SIGEC.use('core/conexion');
  const { initTheme, toggleTheme, isDark, onThemeChange } = SIGEC.use('core/theme');
  const { startRouter, rerender } = SIGEC.use('core/router');
  const { toast } = SIGEC.use('core/ui');
  const { getNotificaciones, contarPendientes } = SIGEC.use('data/api');
  const { NOTIF_KEYS } = SIGEC.use('data/catalogs');
  const cfg = window.SIGEC_CONFIG || {};
  const delSistema = cfg.sesionDelSistema === true && !window.SIGEC_ENV.embed;
  let u = session.user();

  function init() {
    initTheme();
    paintUser();
    paintPortalLink();
    wireShell();
    startRouter({ user: u, can: session.can });
    loadNotifications();
    refreshBadge();
    // Con la sesión de AIFA Operaciones, el cierre por inactividad lo decide el sistema.
    if (!delSistema) session.watchIdle(() => toast('Tu sesión se cerrará en menos de un minuto por inactividad. Mueve el cursor o presiona una tecla para continuar.', 'warn', 9000));
    onThemeChange(() => { syncThemeLabel(); rerender(); });
    syncThemeLabel();
  }

  function paintUser() {
    const role = session.ROLES[u.role]?.label ?? u.role;
    $('#user-initials').textContent = initials(u.name);
    $('#user-name').textContent = u.name;
    $('#user-role').textContent = role;
    $('#user-menu-name').textContent = u.name;
    $('#user-menu-area').textContent = `${role} · ${u.area}`;
  }

  function paintPortalLink() {
    const url = window.SIGEC_ENV.portalUrl;
    if (!url) return;
    const a = $('#portal-link');
    a.href = url;
    a.lastElementChild.textContent = `Volver a ${window.SIGEC_CONFIG.portalNombre || 'inicio'}`;
    a.hidden = false;
  }

  function syncThemeLabel() {
    $('#theme-toggle-label').textContent = isDark() ? 'Modo claro' : 'Modo oscuro';
  }

  function wireShell() {
    const app = $('#app');
    const btnMenu = $('#btn-menu');
    const setNav = (open) => {
      app.classList.toggle('nav-open', open);
      btnMenu.setAttribute('aria-expanded', String(open));
    };
    btnMenu.addEventListener('click', () => setNav(!app.classList.contains('nav-open')));
    $('#sidebar-backdrop').addEventListener('click', () => setNav(false));
    window.addEventListener('hashchange', () => setNav(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

    on(document, 'click', '[data-action="logout"]', () => (delSistema ? salir() : session.signOut()));
    on(document, 'click', '[data-action="toggle-theme"]', () => toggleTheme());
    on(document, 'click', '[data-action="notif-read-all"]', () => {
      readIds = new Set(notifs.map((n) => n.id));
      saveRead();
      renderNotifs();
    });
    window.addEventListener('sigec:incidencias-changed', () => { refreshBadge(); loadNotifications(); });
    window.addEventListener('sigec:notif-prefs', loadNotifications);
  }

  // ------------------------------------------------------- Notificaciones
  let notifs = [];
  let readIds = new Set();
  function loadRead() { try { readIds = new Set(JSON.parse(sessionStorage.getItem('sigec.notif.read') || '[]')); } catch { readIds = new Set(); } }
  function saveRead() { try { sessionStorage.setItem('sigec.notif.read', JSON.stringify([...readIds])); } catch { /* noop */ } }

  async function loadNotifications() {
    loadRead();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('sigec.notif.prefs') || '{}') || {}; } catch { saved = {}; }
    try {
      notifs = await getNotificaciones(Object.fromEntries(NOTIF_KEYS.map((n) => [n.id, saved[n.id] ?? n.def])));
    } catch {
      notifs = []; // sin base todavía: la pantalla activa ya muestra el aviso
    }
    renderNotifs();
  }

  function renderNotifs() {
    const unread = notifs.filter((n) => !readIds.has(n.id)).length;
    const dot = $('#notif-count');
    dot.hidden = unread === 0;
    dot.textContent = unread > 9 ? '9+' : String(unread);
    $('#btn-notif').setAttribute('aria-label', `Notificaciones${unread ? `, ${unread} sin leer` : ''}`);
    $('#notif-sub').textContent = unread ? `${unread} sin leer` : 'Todo al día';
    const kindClass = { crit: 'badge--crit', serious: 'badge--serious', warn: 'badge--warn', info: 'badge--info' };
    mount($('#notif-list'), html`${notifs.map((n) => html`
      <a class="notif ${readIds.has(n.id) ? '' : 'is-unread'}" href="${n.href}" data-notif="${n.id}">
        <span class="notif__icon ${kindClass[n.kind] || 'badge--info'}" aria-hidden="true"><i class="bi ${n.icon}"></i></span>
        <span class="min-w-0"><span class="notif__title d-block">${n.title}</span>
        <span class="notif__meta d-block text-truncate">${n.meta}</span>
        <span class="notif__meta">${relative(n.fecha)}</span></span>
      </a>`)}`);
    $('#notif-list').querySelectorAll('[data-notif]').forEach((a) => a.addEventListener('click', () => {
      readIds.add(a.dataset.notif); saveRead(); renderNotifs();
      window.bootstrap.Dropdown.getInstance($('#btn-notif'))?.hide();
    }));
  }

  async function refreshBadge() {
    let n = 0;
    try { n = await contarPendientes(); } catch { n = 0; }
    const b = $('#nav-badge-pendientes');
    b.hidden = !n;
    b.textContent = String(n);
    b.title = `${n} incidencias pendientes`;
  }

  /** Aviso a pantalla completa cuando no se puede entrar (sin acceso, falta el SQL…). */
  function aviso(titulo, texto) {
    document.title = 'Calidad · SIGEC · AIFA';
    mount($('#view'), html`<div class="card-x">${SIGEC.use('core/ui').empty(titulo, texto, 'bi-shield-lock')}
      <div class="text-center pb-4"><a class="btn btn-brand" href="${window.SIGEC_CONFIG.portalUrl || '../index.html'}"><i class="bi bi-arrow-left" aria-hidden="true"></i>Volver a AIFA Operaciones</a></div></div>`);
    $('#nav-list').hidden = true;
  }

  async function arrancar() {
    if (delSistema) {
      const pie = $('#footer-mode');
      if (pie && pie.lastChild) pie.lastChild.textContent = ' Sesión de AIFA Operaciones';
      let r;
      try { r = await conectar(); } catch (e) { r = { estado: 'error', error: e }; }
      if (r.estado === 'sin-sesion') { window.SIGEC_ENV.goLogin(''); return; }
      if (r.estado === 'sin-acceso') { aviso('Sin acceso a Calidad', 'Tu cuenta no tiene este módulo. Solicítalo al administrador de AIFA Operaciones.'); return; }
      if (r.estado !== 'ok') {
        const falta = /calidad_mi_rol|could not find the function|PGRST202|42883/i.test(`${r.error?.code || ''} ${r.error?.message || ''}`);
        aviso('No fue posible abrir Calidad', falta
          ? 'Calidad aún no está instalado en la base de datos: falta correr db/calidad_sigec.sql en Supabase.'
          : 'No hay conexión con la base de datos. Revisa tu red y recarga la página.');
        return;
      }
      u = session.user();
    }
    if (!u) session.signOut();
    else init();
  }

  // Arranque (al final: las declaraciones de módulo ya están inicializadas)
  arrancar();
})();
