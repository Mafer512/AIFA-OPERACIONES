(function () {
  'use strict';
  /** Directorio — Contactos de áreas involucradas en la gestión de la calidad. */
  const { html, mount, $, on, debounce, safeUrl } = SIGEC.use('core/dom');
  const { initials } = SIGEC.use('core/format');
  const { pageHead, empty, badge, toast, openModal, showFieldErrors } = SIGEC.use('core/ui');
  const { listDirectorio, guardarContacto, eliminarContacto } = SIGEC.use('data/api');
  const { AREAS } = SIGEC.use('data/catalogs');
  const AVATAR_TONE = ['', 'avatar--g', 'avatar--b', 'avatar--d'];
  let st;
  let ctxRef;

  async function render(el, ctx) {
    ctxRef = ctx;
    st = { q: '', area: '', todos: [] };
    const puedeEditar = ctx.can('directorio:editar');
    mount(el, html`
      ${pageHead({
        icon: 'bi-person-lines-fill',
        title: 'Directorio',
        subtitle: 'Contactos operativos y de escalamiento',
        aside: puedeEditar ? html`<button type="button" class="btn btn-accent btn-sm" id="btn-contacto"><i class="bi bi-person-plus-fill" aria-hidden="true"></i>Agregar contacto</button>` : '',
      })}
      <div class="filterbar">
        <div class="field field--grow"><label for="dir-q">Buscar</label>
          <div class="input-icon"><i class="bi bi-search" aria-hidden="true"></i><input class="form-control" id="dir-q" type="search" maxlength="40" placeholder="Nombre, cargo o extensión" autocomplete="off"></div></div>
        <div class="field w-100"><span class="field-label">Área</span>
          <div class="chip-group" role="group" aria-label="Filtrar por área" id="dir-areas"></div></div>
      </div>
      <div id="dir-list"></div>
      <p class="footnote"><i class="bi bi-info-circle" aria-hidden="true"></i>Contactos de escalamiento de Calidad · Los mantiene actualizados Supervisión de Calidad.</p>
    `);

    $('#dir-q', el).addEventListener('input', debounce((e) => { st.q = e.target.value; load(el); }, 200));
    on(el, 'click', '[data-area]', (_e, b) => { st.area = b.dataset.area; load(el); });
    $('#btn-contacto', el)?.addEventListener('click', () => abrirContacto(el, null));
    on(el, 'click', '[data-editar]', (_e, b) => abrirContacto(el, st.todos.find((p) => String(p.id) === b.dataset.editar) || null));
    on(el, 'click', '[data-eliminar]', (_e, b) => quitar(el, st.todos.find((p) => String(p.id) === b.dataset.eliminar)));
    await load(el);
  }

  /** Áreas del catálogo que tienen contactos, y luego cualquier otra registrada. */
  function areasConContactos(todos) {
    const usadas = new Set(todos.map((p) => p.area));
    const extra = [...usadas].filter((a) => !AREAS.includes(a)).sort((a, b) => a.localeCompare(b, 'es'));
    return [...AREAS.filter((a) => usadas.has(a)), ...extra];
  }

  async function load(el) {
    let rows;
    try {
      [rows, st.todos] = await Promise.all([listDirectorio(st.q, st.area), listDirectorio()]);
    } catch (err) {
      if (ctxRef.isCurrent()) mount($('#dir-list', el), html`<div class="card-x">${empty('No fue posible cargar el directorio', err.amigable ? err.message : 'Intenta nuevamente en unos momentos.', 'bi-cloud-slash')}</div>`);
      return;
    }
    if (!ctxRef.isCurrent()) return;
    const areas = areasConContactos(st.todos);
    if (st.area && !areas.includes(st.area)) st.area = '';
    mount($('#dir-areas', el), html`
      <button type="button" class="chip" data-area="" aria-pressed="${String(!st.area)}">Todas</button>
      ${areas.map((a) => html`<button type="button" class="chip" data-area="${a}" aria-pressed="${String(st.area === a)}">${a}</button>`)}`);

    const puedeEditar = ctxRef.can('directorio:editar');
    const vacio = st.todos.length === 0
      ? empty('Directorio vacío', puedeEditar ? 'Agrega los contactos de escalamiento con el botón «Agregar contacto».' : 'Aún no hay contactos registrados.', 'bi-person-lines-fill')
      : empty('Sin coincidencias', 'Prueba con otro término o área.', 'bi-person-x');
    mount($('#dir-list', el), html`${rows.length === 0 ? html`<div class="card-x">${vacio}</div>` : html`
      <div class="contact-grid">${rows.map((p) => html`
        <article class="card-x contact">
          <div class="contact__head">
            <span class="avatar ${AVATAR_TONE[p.id % AVATAR_TONE.length]}" aria-hidden="true">${initials(p.nombre)}</span>
            <div class="min-w-0"><div class="contact__name">${p.nombre}</div><div class="contact__role">${p.cargo || '—'}</div></div>
            ${puedeEditar ? html`<div class="contact__actions">
              <button type="button" class="icon-btn icon-btn--sm" data-editar="${p.id}" aria-label="Editar a ${p.nombre}" title="Editar"><i class="bi bi-pencil" aria-hidden="true"></i></button>
              <button type="button" class="icon-btn icon-btn--sm" data-eliminar="${p.id}" aria-label="Quitar a ${p.nombre}" title="Quitar"><i class="bi bi-trash3" aria-hidden="true"></i></button>
            </div>` : ''}
          </div>
          <div>${badge(p.area, 'brand', 'bi-diagram-3')}</div>
          <ul class="contact__list">
            ${p.ext ? html`<li><i class="bi bi-telephone-fill" aria-hidden="true"></i><span>Ext. <strong>${p.ext}</strong></span></li>` : ''}
            ${p.correo ? html`<li><i class="bi bi-envelope-fill" aria-hidden="true"></i><a href="${safeUrl(`mailto:${p.correo}`)}">${p.correo}</a></li>` : ''}
            ${p.turno ? html`<li><i class="bi bi-clock-fill" aria-hidden="true"></i><span>${p.turno}</span></li>` : ''}
          </ul>
        </article>`)}</div>`}`);
  }

  function abrirContacto(el, p) {
    const areas = [...new Set([...AREAS, ...st.todos.map((x) => x.area)])];
    const v = p || { nombre: '', cargo: '', area: '', ext: '', correo: '', turno: '' };
    const { el: m, close } = openModal({
      title: p ? 'Editar contacto' : 'Agregar contacto',
      icon: p ? 'bi-pencil-square' : 'bi-person-plus-fill',
      body: html`<form id="form-contacto" novalidate autocomplete="off"><div class="row g-3">
        <div class="col-12"><label class="form-label" for="c-nombre">Nombre *</label>
          <input class="form-control" id="c-nombre" name="nombre" maxlength="120" value="${v.nombre}" required><div class="invalid-feedback" data-for="nombre"></div></div>
        <div class="col-md-6"><label class="form-label" for="c-cargo">Cargo</label>
          <input class="form-control" id="c-cargo" name="cargo" maxlength="120" value="${v.cargo}"><div class="invalid-feedback" data-for="cargo"></div></div>
        <div class="col-md-6"><label class="form-label" for="c-area">Área *</label>
          <input class="form-control" id="c-area" name="area" maxlength="80" list="c-areas" value="${v.area}" required>
          <datalist id="c-areas">${areas.map((a) => html`<option value="${a}"></option>`)}</datalist>
          <div class="invalid-feedback" data-for="area"></div></div>
        <div class="col-md-4"><label class="form-label" for="c-ext">Extensión</label>
          <input class="form-control" id="c-ext" name="ext" maxlength="6" inputmode="numeric" value="${v.ext}"><div class="invalid-feedback" data-for="ext"></div></div>
        <div class="col-md-8"><label class="form-label" for="c-correo">Correo</label>
          <input class="form-control" id="c-correo" name="correo" type="email" maxlength="120" value="${v.correo}"><div class="invalid-feedback" data-for="correo"></div></div>
        <div class="col-12"><label class="form-label" for="c-turno">Horario o turno</label>
          <input class="form-control" id="c-turno" name="turno" maxlength="60" placeholder="Lun–Vie · 08:00–17:00" value="${v.turno}"><div class="invalid-feedback" data-for="turno"></div></div>
      </div></form>`,
      footer: html`<button type="button" class="btn btn-outline" data-bs-dismiss="modal">Cancelar</button>
        <button type="submit" form="form-contacto" class="btn btn-accent"><i class="bi bi-save" aria-hidden="true"></i>Guardar</button>`,
    });
    const form = $('#form-contacto', m);
    form.elements.ext.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (p) data.id = p.id;
      const btn = m.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await guardarContacto(data);
      } catch (err) {
        showFieldErrors(form, err.fields || {});
        if (!err.fields || err.amigable) toast(err.amigable ? err.message : 'No fue posible guardar el contacto.', 'crit');
        btn.disabled = false;
        return;
      }
      close();
      toast(p ? 'Contacto actualizado.' : 'Contacto agregado.', 'ok');
      load(el);
    });
  }

  function quitar(el, p) {
    if (!p) return;
    const { el: m, close } = openModal({
      title: 'Quitar contacto',
      icon: 'bi-trash3',
      body: html`<p class="mb-0">¿Quitar a <strong>${p.nombre}</strong> (${p.area}) del directorio?</p>`,
      footer: html`<button type="button" class="btn btn-outline" data-bs-dismiss="modal">Cancelar</button>
        <button type="button" class="btn btn-accent" data-confirmar><i class="bi bi-trash3" aria-hidden="true"></i>Quitar</button>`,
    });
    $('[data-confirmar]', m).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await eliminarContacto(p.id);
        close();
        toast('Contacto quitado.', 'ok');
        load(el);
      } catch (err) {
        toast(err.amigable ? err.message : 'No fue posible quitar el contacto.', 'crit');
        b.disabled = false;
      }
    });
  }

  SIGEC.define('views/directorio', { render });
})();
