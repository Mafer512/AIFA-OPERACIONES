(function () {
  'use strict';
  /** Configuración — Perfil, apariencia, notificaciones, seguridad, usuarios y catálogos. */
  const { html, mount, $, on } = SIGEC.use('core/dom');
  const { dateTime, relative, initials } = SIGEC.use('core/format');
  const { pageHead, badge, toast, empty } = SIGEC.use('core/ui');
  const { ROLES, current } = SIGEC.use('core/session');
  const { getThemePref, setThemePref, getDensity, setDensity } = SIGEC.use('core/theme');
  const { listUsuarios } = SIGEC.use('data/api');
  const { TIPOS_INCIDENCIA, AEROLINEAS, NIVELES, SEVERIDADES } = SIGEC.use('data/catalogs');
  const SECTIONS = [
    { id: 'perfil', label: 'Mi perfil', icon: 'bi-person-circle' },
    { id: 'apariencia', label: 'Apariencia', icon: 'bi-palette-fill' },
    { id: 'notificaciones', label: 'Notificaciones', icon: 'bi-bell-fill' },
    { id: 'seguridad', label: 'Seguridad', icon: 'bi-shield-lock-fill' },
    { id: 'usuarios', label: 'Usuarios y roles', icon: 'bi-people-fill', perm: 'usuarios:gestionar' },
    { id: 'catalogos', label: 'Catálogos', icon: 'bi-list-ul', perm: 'catalogos:ver' },
  ];

  const NOTIF_KEYS = SIGEC.use('data/catalogs').NOTIF_KEYS;

  /** Función del sistema anfitrión (AIFA Operaciones), si el módulo está incrustado. */
  function anfitrion(nombre) {
    try {
      const p = window.parent;
      return p && p !== window && typeof p[nombre] === 'function' ? p[nombre].bind(p) : null;
    } catch { return null; }
  }

  let ctxRef;

  async function render(el, ctx) {
    ctxRef = ctx;
    const visible = SECTIONS.filter((s) => !s.perm || ctx.can(s.perm));
    const sec = visible.some((s) => s.id === ctx.params.s) ? ctx.params.s : 'perfil';

    mount(el, html`
      ${pageHead({ icon: 'bi-gear-fill', title: 'Configuración', subtitle: 'Preferencias personales y administración del sistema' })}
      <div class="settings">
        <nav class="card-x settings-nav" aria-label="Secciones de configuración">
          ${SECTIONS.map((s) => {
            const allowed = !s.perm || ctx.can(s.perm);
            return allowed
              ? html`<a href="#/configuracion?s=${s.id}" data-sec="${s.id}" class="${s.id === sec ? 'is-active' : ''}" ${s.id === sec ? html`aria-current="page"` : ''}><i class="bi ${s.icon}" aria-hidden="true"></i>${s.label}</a>`
              : '';
          })}
        </nav>
        <div id="settings-body"></div>
      </div>`);

    on(el, 'click', '[data-sec]', (e, a) => {
      e.preventDefault();
      ctx.setParams({ s: a.dataset.sec === 'perfil' ? '' : a.dataset.sec });
      el.querySelectorAll('[data-sec]').forEach((x) => {
        x.classList.toggle('is-active', x === a);
        if (x === a) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
      });
      show(el, a.dataset.sec);
    });

    await show(el, sec);
  }

  async function show(el, id) {
    const body = $('#settings-body', el);
    const fn = { perfil, apariencia, notificaciones, seguridad, usuarios, catalogos }[id] || perfil;
    await fn(body);
  }

  // ---------------------------------------------------------------- Perfil
  function perfil(body) {
    const u = ctxRef.user;
    const s = current();
    mount(body, html`
      <section class="card-x settings-section" aria-labelledby="p-t">
        <div class="card-x__head"><h3 id="p-t">Mi perfil</h3></div>
        <div class="card-x__body">
          <div class="d-flex align-items-center gap-3 mb-3">
            <span class="avatar avatar--g" aria-hidden="true">${initials(u.name)}</span>
            <div><div class="fw-bold fs-6">${u.name}</div><div class="text-ink-3">${u.username.includes('@') ? u.username : `@${u.username}`}</div></div>
            <div class="ms-auto">${badge(ROLES[u.role]?.label ?? u.role, ROLES[u.role]?.color ?? 'neutral', 'bi-person-badge')}</div>
          </div>
          <dl class="dl">
            <dt>Área</dt><dd>${u.area}</dd>
            <dt>Rol</dt><dd>${ROLES[u.role]?.label ?? u.role}</dd>
            <dt>Sesión iniciada</dt><dd>${s?.issuedAt ? `${dateTime(s.issuedAt)} h` : '—'}</dd>
          </dl>
          <div class="callout mt-3"><i class="bi bi-info-circle-fill" aria-hidden="true"></i><div>Tu nombre y tu rol vienen de tu cuenta de AIFA Operaciones. Si alguno es incorrecto, solicita la corrección al administrador del sistema.</div></div>
        </div>
      </section>`);
  }

  // ------------------------------------------------------------ Apariencia
  function apariencia(body) {
    const theme = getThemePref();
    const dens = getDensity();
    const opt = (v, label, cls) => html`<button type="button" class="option-card" role="radio" aria-checked="${String(theme === v)}" data-theme-opt="${v}">
      <div class="option-card__preview ${cls}"><span class="s"></span><span class="m"></span></div><strong>${label}</strong></button>`;
    const dopt = (v, label, desc) => html`<button type="button" class="option-card" role="radio" aria-checked="${String(dens === v)}" data-density-opt="${v}">
      <strong>${label}</strong><div class="text-ink-3 small">${desc}</div></button>`;
    mount(body, html`
      <section class="card-x settings-section" aria-labelledby="a-t">
        <div class="card-x__head"><h3 id="a-t">Tema</h3></div>
        <div class="card-x__body"><div class="option-cards" role="radiogroup" aria-labelledby="a-t">
          ${opt('light', 'Claro', '')}${opt('dark', 'Oscuro', 'dark')}${opt('system', 'Según el sistema', 'auto')}
        </div></div>
      </section>
      <section class="card-x settings-section" aria-labelledby="d-t">
        <div class="card-x__head"><h3 id="d-t">Densidad de tablas</h3></div>
        <div class="card-x__body"><div class="option-cards" role="radiogroup" aria-labelledby="d-t">
          ${dopt('comfortable', 'Cómoda', 'Más espacio entre filas.')}${dopt('compact', 'Compacta', 'Más registros visibles.')}
        </div></div>
      </section>`);
    body.querySelectorAll('[data-theme-opt]').forEach((b) => b.addEventListener('click', () => {
      setThemePref(b.dataset.themeOpt);
      body.querySelectorAll('[data-theme-opt]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    body.querySelectorAll('[data-density-opt]').forEach((b) => b.addEventListener('click', () => {
      setDensity(b.dataset.densityOpt);
      body.querySelectorAll('[data-density-opt]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      toast('Densidad actualizada.', 'ok', 2000);
    }));
  }

  // -------------------------------------------------------- Notificaciones
  function readPrefs() {
    try { return JSON.parse(localStorage.getItem('sigec.notif.prefs') || '{}'); } catch { return {}; }
  }
  function notificaciones(body) {
    const prefs = readPrefs();
    mount(body, html`
      <section class="card-x settings-section" aria-labelledby="n-t">
        <div class="card-x__head"><h3 id="n-t">Notificaciones</h3><span class="sub">Se muestran en la campana del encabezado</span></div>
        <div class="card-x__body pt-1">
          ${NOTIF_KEYS.map((n) => html`<div class="switch-row">
            <div><strong id="nl-${n.id}">${n.title}</strong><p>${n.desc}</p></div>
            <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" data-notif-pref="${n.id}" aria-labelledby="nl-${n.id}"></div>
          </div>`)}
        </div>
      </section>`);
    body.querySelectorAll('[data-notif-pref]').forEach((inp) => {
      const def = NOTIF_KEYS.find((n) => n.id === inp.dataset.notifPref).def;
      inp.checked = prefs[inp.dataset.notifPref] ?? def;
      inp.addEventListener('change', () => {
        const p = readPrefs();
        p[inp.dataset.notifPref] = inp.checked;
        try { localStorage.setItem('sigec.notif.prefs', JSON.stringify(p)); } catch { /* noop */ }
        window.dispatchEvent(new CustomEvent('sigec:notif-prefs'));
        toast('Preferencia guardada.', 'ok', 1800);
      });
    });
  }

  // -------------------------------------------------------------- Seguridad
  function seguridad(body) {
    const cambiar = anfitrion('pwOpenChangeOwn');
    mount(body, html`
      <section class="card-x settings-section" aria-labelledby="s-t">
        <div class="card-x__head"><h3 id="s-t">Sesión</h3></div>
        <div class="card-x__body">
          <dl class="dl">
            <dt>Cuenta</dt><dd>La misma de AIFA Operaciones</dd>
            <dt>Cierre</dt><dd>Se cierra junto con la sesión de AIFA Operaciones</dd>
            <dt>Permisos</dt><dd>Los valida la base de datos en cada consulta</dd>
          </dl>
        </div>
      </section>
      <section class="card-x settings-section" aria-labelledby="pw-t">
        <div class="card-x__head"><h3 id="pw-t">Contraseña</h3></div>
        <div class="card-x__body">
          <p class="text-ink-2">Tu contraseña es la de AIFA Operaciones. Al cambiarla aquí se cambia para todo el sistema.</p>
          ${cambiar
            ? html`<button type="button" class="btn btn-brand" id="btn-pw"><i class="bi bi-key-fill" aria-hidden="true"></i>Cambiar contraseña</button>`
            : html`<div class="callout"><i class="bi bi-info-circle-fill" aria-hidden="true"></i><div>Cámbiala desde AIFA Operaciones, en el menú de tu usuario.</div></div>`}
        </div>
      </section>`);
    $('#btn-pw', body)?.addEventListener('click', () => cambiar());
  }

  // --------------------------------------------------------------- Usuarios
  async function usuarios(body) {
    if (!ctxRef.can('usuarios:gestionar')) return perfil(body);
    let list;
    try {
      list = await listUsuarios();
    } catch (err) {
      if (ctxRef.isCurrent()) mount(body, html`<section class="card-x settings-section">${empty('No fue posible cargar los usuarios', err.amigable ? err.message : 'Intenta nuevamente en unos momentos.', 'bi-cloud-slash')}</section>`);
      return;
    }
    if (!ctxRef.isCurrent()) return;
    const administrar = anfitrion('showSection');
    mount(body, html`
      <section class="card-x card-x--flush settings-section" aria-labelledby="u-t">
        <div class="card-x__head pb-3"><h3 id="u-t">Usuarios y roles</h3><span class="sub">${list.length} cuentas con acceso a Calidad</span>
          ${administrar ? html`<div class="card-x__actions"><button type="button" class="btn btn-accent btn-sm" id="btn-invite"><i class="bi bi-person-gear" aria-hidden="true"></i>Administrar accesos</button></div>` : ''}</div>
        <div class="card-x__body"><div class="table-wrap"><table class="table-x">
          <caption class="visually-hidden">Usuarios del sistema</caption>
          <thead><tr><th scope="col">Nombre</th><th scope="col">Usuario</th><th scope="col">Área</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Último acceso</th></tr></thead>
          <tbody>${list.map((u) => html`<tr>
            <td><div class="d-flex align-items-center gap-2"><span class="avatar" aria-hidden="true">${initials(u.nombre)}</span><span class="fw-semibold">${u.nombre}</span></div></td>
            <td class="mono">${u.usuario}</td>
            <td class="muted">${u.area}</td>
            <td>${badge(ROLES[u.rol].label, ROLES[u.rol].color)}</td>
            <td>${u.activo ? badge('Activo', 'ok', 'bi-check-circle-fill') : badge('Inactivo', 'neutral', 'bi-slash-circle')}</td>
            <td class="muted">${u.ultimoAcceso ? relative(u.ultimoAcceso) : 'Nunca'}</td>
          </tr>`)}</tbody>
        </table></div></div>
      </section>
      <section class="card-x settings-section" aria-labelledby="r-t">
        <div class="card-x__head"><h3 id="r-t">Matriz de permisos</h3></div>
        <div class="card-x__body"><div class="table-wrap"><table class="chart-table">
          <thead><tr><th>Acción</th>${Object.values(ROLES).map((r) => html`<th class="text-center">${r.label}</th>`)}</tr></thead>
          <tbody>${[
            ['Consultar panel, reportes y encuestas', [1, 1, 1, 1]],
            ['Registrar incidencias y encuestas', [1, 1, 1, 0]],
            ['Actualizar estado de incidencias', [1, 1, 0, 0]],
            ['Publicar documentos y mantener el directorio', [1, 1, 0, 0]],
            ['Exportar información', [1, 1, 1, 1]],
            ['Administrar usuarios y catálogos', [1, 0, 0, 0]],
          ].map(([a, v]) => html`<tr><td>${a}</td>${v.map((x) => html`<td class="text-center">${x ? html`<i class="bi bi-check-circle-fill text-ok" aria-label="Permitido"></i>` : html`<i class="bi bi-dash text-ink-3" aria-label="No permitido"></i>`}</td>`)}</tr>`)}</tbody>
        </table></div>
        <p class="footnote mt-3 mb-0"><i class="bi bi-info-circle" aria-hidden="true"></i>Nivel del módulo «Calidad (SIGEC)» en Administración de usuarios: Lectura = Consulta · Captura = Capturista · Edición = Supervisor. Los administradores de AIFA Operaciones son administradores aquí.</p></div>
      </section>`);
    // Los accesos se dan en AIFA Operaciones → Administración de usuarios (módulo «Calidad»).
    $('#btn-invite', body)?.addEventListener('click', () => administrar('admin-usuarios'));
  }

  // -------------------------------------------------------------- Catálogos
  function catalogos(body) {
    const card = (title, items) => html`<section class="card-x" aria-label="${title}">
      <div class="card-x__head"><h3>${title}</h3><span class="sub">${items.length}</span></div>
      <div class="card-x__body pt-2"><div class="chip-group">${items.map((i) => html`<span class="badge-x badge--neutral">${i}</span>`)}</div></div></section>`;
    mount(body, html`
      <div class="callout mb-gap"><i class="bi bi-info-circle-fill" aria-hidden="true"></i><div>Los catálogos alimentan filtros, formularios e indicadores. Para agregar una aerolínea, un tipo de incidencia o un nivel, solicítalo al administrador de AIFA Operaciones.</div></div>
      <div class="grid-2">
        ${card('Tipos de incidencia', TIPOS_INCIDENCIA)}
        ${card('Aerolíneas', AEROLINEAS.map((a) => `${a.code} · ${a.name}`))}
        ${card('Niveles del edificio', NIVELES.map((n) => `${n.code} · ${n.name}`))}
        ${card('Severidad y SLA', SEVERIDADES.map((s) => `${s.code} · ${s.slaHoras} h`))}
      </div>`);
  }

  SIGEC.define('views/configuracion', { render });
})();
