(function () {
  'use strict';
  /** app.js — Arranque del shell de la aplicación. */
  const { $, html, mount, on } = SIGEC.use('core/dom');
  const { relative, initials } = SIGEC.use('core/format');
  const session = SIGEC.use('core/session');
  const { initTheme, toggleTheme, isDark, onThemeChange } = SIGEC.use('core/theme');
  const { startRouter, rerender } = SIGEC.use('core/router');
  const { toast } = SIGEC.use('core/ui');
  const { getNotificaciones, contarPendientes } = SIGEC.use('data/api');
  const { NOTIF_KEYS } = SIGEC.use('data/catalogs');
  const u = session.user();

  function init() {
    initTheme();
    paintUser();
    paintPortalLink();
    wireShell();
    startRouter({ user: u, can: session.can });
    loadNotifications();
    refreshBadge();
    session.watchIdle(() => toast('Tu sesión se cerrará en menos de un minuto por inactividad. Mueve el cursor o presiona una tecla para continuar.', 'warn', 9000));
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

    on(document, 'click', '[data-action="logout"]', () => session.signOut());
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

  // Arranque (al final: las declaraciones de módulo ya están inicializadas)
  if (!u) session.signOut();
  else init();
})();
