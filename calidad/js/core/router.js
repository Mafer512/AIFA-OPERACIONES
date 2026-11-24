(function () {
  'use strict';
  /**
   * router.js — Enrutador por hash (#/vista?param=valor) con carga diferida de vistas.
   * Cada vista exporta: render(container, ctx) y opcionalmente destroy().
   */
  const { mount, html, $, $$ } = SIGEC.use('core/dom');
  const { viewSkeleton, empty } = SIGEC.use('core/ui');
  const ROUTES = {
    inicio:        { title: 'Panel de control', load: () => Promise.resolve(SIGEC.use('views/inicio')) },
    reportes:      { title: 'Reportes de incidencias', load: () => Promise.resolve(SIGEC.use('views/reportes')) },
    encuestas:     { title: 'Respuestas de encuestas', load: () => Promise.resolve(SIGEC.use('views/encuestas')) },
    documentacion: { title: 'Documentación', load: () => Promise.resolve(SIGEC.use('views/documentacion')) },
    directorio:    { title: 'Directorio', load: () => Promise.resolve(SIGEC.use('views/directorio')) },
    configuracion: { title: 'Configuración', load: () => Promise.resolve(SIGEC.use('views/configuracion')) },
  };

  let currentView = null;
  let currentName = null;
  let renderToken = 0;
  let baseCtx = {};

  function parseHash() {
    const h = window.location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = h.split('?');
    const name = (path || 'inicio').toLowerCase();
    return { name, params: Object.fromEntries(new URLSearchParams(query)) };
  }

  function navigate(name, params = {}, { replace = false } = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    const hash = `#/${name}${q ? `?${q}` : ''}`;
    if (replace) history.replaceState(null, '', hash); else window.location.hash = hash;
    if (replace) render();
  }

  /** Actualiza parámetros en la URL sin volver a renderizar la vista. */
  function setParams(params) {
    const { name } = parseHash();
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    history.replaceState(null, '', `#/${name}${q ? `?${q}` : ''}`);
  }

  async function render() {
    const { name, params } = parseHash();
    const route = ROUTES[name];
    const container = $('#view');
    const token = ++renderToken;

    if (currentView?.destroy) { try { currentView.destroy(); } catch (e) { console.error(e); } }
    currentView = null;

    $$('.nav-link-app').forEach((a) => {
      const active = a.dataset.route === name;
      a.classList.toggle('is-active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (!route) {
      document.title = 'No encontrado · SIGEC';
      mount(container, html`<div class="card-x">${empty('Página no encontrada', 'La sección solicitada no existe.', 'bi-signpost-split')}</div>`);
      return;
    }

    document.title = `${route.title} · SIGEC · AIFA`;
    if (currentName !== name) mount(container, viewSkeleton());
    currentName = name;

    try {
      const mod = await route.load();
      if (token !== renderToken) return; // navegación más reciente en curso
      currentView = mod;
      // Contenedor nuevo por render: los listeners delegados de la vista anterior se descartan con él.
      const host = document.createElement('div');
      host.className = `view view--${name}`;
      container.replaceChildren(host);
      await mod.render(host, { ...baseCtx, params, navigate, setParams, isCurrent: () => token === renderToken });
      if (token !== renderToken) return;
      const heading = $('#page-title', host);
      if (heading && document.activeElement?.closest?.('.sidebar, .dropdown-menu')) heading.focus({ preventScroll: true });
    } catch (err) {
      console.error(err);
      if (token === renderToken) {
        const detalle = err && err.amigable ? err.message : 'Intenta nuevamente. Si el problema persiste, avisa al administrador de AIFA Operaciones.';
        mount(container, html`<div class="card-x">${empty('No fue posible cargar la sección', detalle, 'bi-exclamation-triangle')}</div>`);
      }
    }
  }

  function rerender() { render(); }

  function startRouter(ctx) {
    baseCtx = ctx;
    window.addEventListener('hashchange', render);
    if (!window.location.hash) history.replaceState(null, '', '#/inicio');
    render();
  }

  SIGEC.define('core/router', { parseHash, navigate, setParams, rerender, startRouter });
})();
