(function () {
  'use strict';
  /** Reportes — Listado, detalle, alta y seguimiento de incidencias. */
  const { html, mount, $, on, debounce } = SIGEC.use('core/dom');
  const { num, dec, date, time, dateTime, minutes, isoDay } = SIGEC.use('core/format');
  const { pageHead, estadoBadge, severidadBadge, pagination, options, empty, toast, openModal, downloadCSV, showFieldErrors } = SIGEC.use('core/ui');
  const { listIncidencias, getIncidencia, crearIncidencia, actualizarEstado, exportIncidencias, validarIncidencia } = SIGEC.use('data/api');
  const { AEROLINEAS, TIPOS_INCIDENCIA, ESTADOS, SEVERIDADES, NIVELES, aerolineaName, slaDe } = SIGEC.use('data/catalogs');
  const PERIODOS_R = [
    { value: '7', label: 'Últimos 7 días' },
    { value: '30', label: 'Últimos 30 días' },
    { value: '90', label: 'Últimos 90 días' },
    { value: 'todo', label: 'Todo el historial' },
  ];
  const COLS = [
    { key: 'folio', label: 'Folio', sort: true },
    { key: 'fecha', label: 'Fecha y hora', sort: true },
    { key: 'tipo', label: 'Tipo de incidencia', sort: true },
    { key: 'aerolinea', label: 'Aerolínea', sort: true },
    { key: 'vuelo', label: 'Vuelo' },
    { key: 'severidad', label: 'Severidad', sort: true },
    { key: 'estado', label: 'Estado', sort: true },
    { key: 'observaciones', label: 'Observaciones' },
  ];

  let st;
  let ctxRef;
  let evidenciaURL = null;

  async function render(el, ctx) {
    ctxRef = ctx;
    const p = ctx.params;
    const pick = (v, list) => (list.includes(v) ? v : '');
    st = {
      filters: {
        periodo: PERIODOS_R.some((x) => x.value === p.periodo) ? p.periodo : '30',
        estado: pick(p.estado, ESTADOS.map((e) => e.code)),
        aerolinea: pick(p.aerolinea, AEROLINEAS.map((a) => a.code)),
        tipo: pick(p.tipo, TIPOS_INCIDENCIA),
        severidad: pick(p.severidad, SEVERIDADES.map((s) => s.code)),
        q: String(p.q || '').slice(0, 40),
      },
      page: Math.max(1, parseInt(p.page, 10) || 1),
      pageSize: [10, 25, 50].includes(Number(p.size)) ? Number(p.size) : 10,
      sort: { key: 'fecha', dir: 'desc' },
      selected: /^INC-\d{4}-\d{4}$/.test(p.folio || '') ? p.folio : null,
    };
    // Un folio directo (p. ej. desde notificaciones) amplía el periodo para encontrarlo.
    if (st.selected && !p.periodo) st.filters.periodo = 'todo';

    const f = st.filters;
    mount(el, html`
      ${pageHead({
        icon: 'bi-file-earmark-bar-graph-fill',
        title: 'Reportes de Incidencias',
        subtitle: 'Registro, consulta y seguimiento de incidencias de equipaje',
        aside: html`
          ${ctx.can('exportar') ? html`<button type="button" class="btn btn-outline btn-sm" id="btn-export"><i class="bi bi-download" aria-hidden="true"></i>Exportar CSV</button>` : ''}
          ${ctx.can('incidencia:crear') ? html`<button type="button" class="btn btn-accent btn-sm" id="btn-new"><i class="bi bi-plus-lg" aria-hidden="true"></i>Nueva incidencia</button>` : ''}`,
      })}

      <form class="filterbar" id="rep-filters" role="search" novalidate>
        <div class="field"><label for="r-periodo">Periodo</label><select class="form-select" id="r-periodo" name="periodo">${options(PERIODOS_R, f.periodo)}</select></div>
        <div class="field"><label for="r-estado">Estado</label><select class="form-select" id="r-estado" name="estado">${options(ESTADOS.map((e) => e.code), f.estado, { all: 'Todos' })}</select></div>
        <div class="field"><label for="r-aero">Aerolínea</label><select class="form-select" id="r-aero" name="aerolinea">${options(AEROLINEAS.map((a) => ({ value: a.code, label: a.name })), f.aerolinea, { all: 'Todas' })}</select></div>
        <div class="field"><label for="r-tipo">Tipo</label><select class="form-select" id="r-tipo" name="tipo">${options(TIPOS_INCIDENCIA, f.tipo, { all: 'Todos' })}</select></div>
        <div class="field"><label for="r-sev">Severidad</label><select class="form-select" id="r-sev" name="severidad">${options(SEVERIDADES.map((s) => s.code), f.severidad, { all: 'Todas' })}</select></div>
        <div class="field field--grow"><label for="r-q">Buscar</label>
          <div class="input-icon"><i class="bi bi-search" aria-hidden="true"></i>
          <input class="form-control" id="r-q" name="q" type="search" maxlength="40" placeholder="Folio, vuelo o equipo" value="${f.q}" autocomplete="off"></div></div>
        <div class="actions">
          <button type="button" class="btn btn-outline" id="btn-clear">Limpiar</button>
          <button type="submit" class="btn btn-accent"><i class="bi bi-search" aria-hidden="true"></i>Buscar</button>
        </div>
      </form>

      <section class="card-x card-x--flush mb-gap" aria-label="Listado de incidencias">
        <div class="card-x__body" id="rep-table"></div>
      </section>

      <div id="rep-detail"></div>
    `);

    const form = $('#rep-filters', el);
    form.addEventListener('submit', (e) => { e.preventDefault(); readFilters(form); st.page = 1; loadTable(el); });
    form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') { readFilters(form); st.page = 1; loadTable(el); } });
    form.elements.q.addEventListener('input', debounce(() => { readFilters(form); st.page = 1; loadTable(el); }, 350));
    $('#btn-clear', el).addEventListener('click', () => {
      form.reset();
      ['estado', 'aerolinea', 'tipo', 'severidad'].forEach((n) => { form.elements[n].value = ''; });
      form.elements.periodo.value = '30';
      form.elements.q.value = '';
      readFilters(form); st.page = 1; loadTable(el);
    });

    $('#btn-export', el)?.addEventListener('click', exportCSV);
    $('#btn-new', el)?.addEventListener('click', () => openNueva(el));

    on(el, 'click', '[data-page]', (_e, b) => { st.page = Number(b.dataset.page); loadTable(el); $('#rep-table', el).scrollIntoView({ block: 'nearest' }); });
    on(el, 'change', '#r-size', (e) => { st.pageSize = Number(e.target.value); st.page = 1; loadTable(el); });
    on(el, 'click', '[data-sort]', (_e, b) => {
      const k = b.dataset.sort;
      st.sort = { key: k, dir: st.sort.key === k && st.sort.dir === 'desc' ? 'asc' : 'desc' };
      loadTable(el);
    });
    on(el, 'click', '[data-open]', (_e, b) => openDetail(el, b.dataset.open, true));
    on(el, 'click', '[data-close-detail]', () => { st.selected = null; mount($('#rep-detail', el), html``); markSelected(el); persist(); $('#rep-table', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    on(el, 'click', '[data-print]', () => window.print());

    await loadTable(el);
    if (st.selected) openDetail(el, st.selected, false);
  }

  function readFilters(form) {
    const fd = new FormData(form);
    st.filters = {
      periodo: fd.get('periodo'), estado: fd.get('estado'), aerolinea: fd.get('aerolinea'),
      tipo: fd.get('tipo'), severidad: fd.get('severidad'), q: String(fd.get('q') || '').trim().slice(0, 40),
    };
  }

  function persist() {
    const f = st.filters;
    ctxRef.setParams({ ...f, periodo: f.periodo === '30' ? '' : f.periodo, page: st.page > 1 ? st.page : '', size: st.pageSize !== 10 ? st.pageSize : '', folio: st.selected || '' });
  }

  async function loadTable(el) {
    const box = $('#rep-table', el);
    box.classList.add('is-busy');
    let res;
    try {
      res = await listIncidencias({ filters: st.filters, page: st.page, pageSize: st.pageSize, sort: st.sort });
    } catch (err) {
      box.classList.remove('is-busy');
      if (ctxRef.isCurrent()) mount(box, empty('No fue posible cargar las incidencias', err.amigable ? err.message : 'Intenta nuevamente en unos momentos.', 'bi-cloud-slash'));
      return;
    }
    box.classList.remove('is-busy');
    if (!ctxRef.isCurrent()) return;
    st.page = res.page;
    persist();

    const sortIcon = (k) => (st.sort.key !== k ? 'bi-arrow-down-up' : st.sort.dir === 'asc' ? 'bi-sort-up' : 'bi-sort-down');
    mount(box, html`
      ${res.total === 0 ? empty('No se encontraron incidencias', 'Ajusta los filtros o amplía el periodo.', 'bi-search') : html`
      <div class="table-wrap">
        <table class="table-x">
          <caption class="visually-hidden">Incidencias registradas, ${res.total} resultados</caption>
          <thead><tr>
            ${COLS.map((c) => html`<th scope="col" ${c.key === st.sort.key ? html`aria-sort="${st.sort.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>
              ${c.sort ? html`<button type="button" class="th-sort" data-sort="${c.key}" ${c.key === st.sort.key ? html`data-dir="${st.sort.dir}"` : ''}>${c.label}<i class="bi ${sortIcon(c.key)}" aria-hidden="true"></i></button>` : c.label}</th>`)}
            <th scope="col" class="text-end">Acciones</th>
          </tr></thead>
          <tbody>
            ${res.rows.map((r) => html`<tr data-row="${r.folio}" class="${r.folio === st.selected ? 'is-selected' : ''}">
              <td class="mono">${r.folio}</td>
              <td><span class="d-block">${date(r.fecha)}</span><span class="muted">${time(r.fecha)} h</span></td>
              <td>${r.tipo}</td>
              <td title="${aerolineaName(r.aerolinea)}"><span class="fw-semibold">${r.aerolinea}</span></td>
              <td class="mono">${r.vuelo}</td>
              <td>${severidadBadge(r.severidad)}</td>
              <td>${estadoBadge(r.estado)}</td>
              <td class="clip muted" title="${r.observaciones}">${r.observaciones}</td>
              <td class="text-end"><button type="button" class="btn-link-accent" data-open="${r.folio}" aria-label="Ver detalle de ${r.folio}">Ver<i class="bi bi-chevron-right" aria-hidden="true"></i></button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
      <div class="d-flex align-items-center">
        <div class="flex-grow-1">${pagination(res)}</div>
      </div>
      <div class="d-flex justify-content-end align-items-center gap-2 px-3 pb-3 text-ink-3 small no-print">
        <label for="r-size">Registros por página</label>
        <select id="r-size" class="form-select form-select-sm w-auto">${options(['10', '25', '50'], String(st.pageSize))}</select>
      </div>`}
    `);
  }

  function markSelected(el) {
    el.querySelectorAll('tr[data-row]').forEach((tr) => tr.classList.toggle('is-selected', tr.dataset.row === st.selected));
  }

  // ------------------------------------------------------------ Detalle
  async function openDetail(el, folio, scroll) {
    const box = $('#rep-detail', el);
    let inc;
    try {
      inc = await getIncidencia(folio);
    } catch (err) {
      toast(err.amigable ? err.message : `No fue posible abrir la incidencia ${folio}.`, 'crit');
      return;
    }
    if (!ctxRef.isCurrent()) return;
    if (!inc) { toast(`No se encontró la incidencia ${folio}.`, 'warn'); return; }
    st.selected = folio;
    markSelected(el);
    persist();

    const sla = slaDe(inc.severidad);
    const resolTxt = inc.tiempoResolucion == null ? '—' : `${dec(inc.tiempoResolucion)} h`;
    const dentro = inc.tiempoResolucion != null && inc.tiempoResolucion <= sla;
    const dot = { Registrada: 'tl-dot', 'En proceso': 'tl-dot tl-dot--info', Solucionada: 'tl-dot tl-dot--ok', Pendiente: 'tl-dot tl-dot--warn' };
    const dotIcon = { Registrada: 'bi-plus', 'En proceso': 'bi-arrow-repeat', Solucionada: 'bi-check', Pendiente: 'bi-hourglass' };
    const canEdit = ctxRef.can('incidencia:editar');

    mount(box, html`
      <section class="card-x" aria-labelledby="det-t" id="detalle">
        <div class="card-x__head pb-2 border-bottom">
          <span class="page-head__icon" aria-hidden="true"><i class="bi bi-clipboard2-data-fill"></i></span>
          <div><h3 id="det-t" class="fs-6">Detalle del reporte</h3><span class="sub mono">${inc.folio}</span></div>
          <div class="card-x__actions no-print">
            <button type="button" class="btn btn-outline btn-sm" data-print><i class="bi bi-printer" aria-hidden="true"></i>Imprimir</button>
            <button type="button" class="btn btn-outline btn-sm" data-close-detail><i class="bi bi-arrow-left" aria-hidden="true"></i>Regresar</button>
          </div>
        </div>
        <div class="card-x__body">
          <div class="detail-grid">
            <dl class="dl">
              <dt>Folio</dt><dd class="mono">${inc.folio}</dd>
              <dt>Fecha</dt><dd>${dateTime(inc.fecha)} h</dd>
              <dt>Tipo</dt><dd>${inc.tipo}</dd>
              <dt>Aerolínea</dt><dd>${aerolineaName(inc.aerolinea)} (${inc.aerolinea})</dd>
              <dt>Vuelo</dt><dd class="mono">${inc.vuelo}</dd>
              <dt>Registró</dt><dd>${inc.registradoPor}</dd>
            </dl>
            <dl class="dl">
              <dt>Severidad</dt><dd>${severidadBadge(inc.severidad)}</dd>
              <dt>Estado</dt><dd>${estadoBadge(inc.estado)}</dd>
              <dt>Ubicación</dt><dd>${inc.edificio} · ${NIVELES.find((n) => n.code === inc.nivel)?.name ?? inc.nivel}</dd>
              <dt>Equipo</dt><dd class="mono">${inc.equipo}</dd>
              <dt>T. atención</dt><dd>${minutes(inc.tiempoAtencion)}</dd>
              <dt>T. resolución</dt><dd>${resolTxt} <span class="text-ink-3">/ objetivo ${sla} h</span>
                ${inc.tiempoResolucion != null ? html` ${dentro ? html`<span class="badge-x badge--ok"><i class="bi bi-check2" aria-hidden="true"></i>En SLA</span>` : html`<span class="badge-x badge--crit"><i class="bi bi-x" aria-hidden="true"></i>Fuera de SLA</span>`}` : ''}</dd>
            </dl>
            <div class="evidence-col">
              <div class="field-label mb-1">Evidencia</div>
              ${inc.evidenciaUrl
                ? html`<div class="evidence evidence--foto"><a href="${inc.evidenciaUrl}" target="_blank" rel="noopener noreferrer" title="Abrir la fotografía completa"><img src="${inc.evidenciaUrl}" alt="Evidencia fotográfica de ${inc.folio}"></a></div>`
                : html`<div class="evidence"><i class="bi bi-luggage" aria-hidden="true"></i><span>${inc.evidencia ? 'Fotografía adjunta (no se pudo abrir la vista previa)' : 'Sin evidencia fotográfica'}</span></div>`}
            </div>
          </div>

          <div class="mt-3"><div class="field-label mb-1">Descripción</div><p class="mb-0">${inc.descripcion}</p></div>

          <div class="grid-2 mt-3 mb-0">
            <div>
              <div class="field-label mb-2">Seguimiento</div>
              <ol class="timeline">${inc.seguimiento.map((s) => html`<li>
                <span class="${dot[s.estado] || 'tl-dot'}" aria-hidden="true"><i class="bi ${dotIcon[s.estado] || 'bi-dot'}"></i></span>
                <strong>${s.estado}</strong> <span class="tl-meta">· ${dateTime(s.fecha)} h · ${s.usuario}</span>
                <div class="text-ink-2">${s.nota}</div></li>`)}</ol>
            </div>
            ${canEdit && inc.estado !== 'Solucionada' ? html`
            <form id="form-estado" class="no-print" novalidate>
              <div class="field-label mb-2">Actualizar estado</div>
              <div class="mb-2"><label class="form-label" for="e-estado">Nuevo estado</label>
                <select class="form-select" id="e-estado" name="estado" required>${options(ESTADOS.map((e) => e.code).filter((c) => c !== inc.estado), '')}</select></div>
              <div class="mb-2"><label class="form-label" for="e-nota">Nota de seguimiento</label>
                <textarea class="form-control" id="e-nota" name="nota" rows="3" maxlength="300" required placeholder="Acción realizada, responsable, etc."></textarea>
                <div class="invalid-feedback" data-for="nota"></div></div>
              <button type="submit" class="btn btn-brand"><i class="bi bi-check2-circle" aria-hidden="true"></i>Guardar seguimiento</button>
            </form>` : html`<div>${!canEdit ? html`<div class="callout"><i class="bi bi-lock" aria-hidden="true"></i><div>Tu perfil puede consultar la incidencia; la actualización de estado corresponde a Supervisión de Calidad.</div></div>` : html`<div class="callout"><i class="bi bi-check-circle" aria-hidden="true"></i><div>Incidencia cerrada. Para reabrirla, contacta a Supervisión de Calidad.</div></div>`}</div>`}
          </div>
        </div>
      </section>`);

    const fe = $('#form-estado', box);
    fe?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nota = fe.elements.nota.value.trim();
      if (nota.length < 5) { showFieldErrors(fe, { nota: 'Escribe una nota de al menos 5 caracteres.' }); return; }
      const btn = fe.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await actualizarEstado(inc.folio, fe.elements.estado.value, nota, ctxRef.user);
        toast(`${inc.folio} actualizada a “${fe.elements.estado.value}”.`, 'ok');
        window.dispatchEvent(new CustomEvent('sigec:incidencias-changed'));
        await loadTable(el);
        openDetail(el, inc.folio, false);
      } catch (err) {
        toast(err.amigable ? err.message : 'No fue posible actualizar la incidencia.', 'crit');
        btn.disabled = false;
      }
    });

    if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --------------------------------------------------------- Nueva incidencia
  function openNueva(el) {
    const now = new Date();
    const local = `${isoDay(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const { el: m, close } = openModal({
      title: 'Nueva incidencia',
      icon: 'bi-plus-square-fill',
      size: 'modal-lg',
      body: html`<form id="form-inc" novalidate>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label" for="n-fecha">Fecha y hora *</label>
            <input class="form-control" type="datetime-local" id="n-fecha" name="fecha" value="${local}" max="${local}" required><div class="invalid-feedback" data-for="fecha"></div></div>
          <div class="col-md-6"><label class="form-label" for="n-tipo">Tipo de incidencia *</label>
            <select class="form-select" id="n-tipo" name="tipo" required>${options(TIPOS_INCIDENCIA, '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="tipo"></div></div>
          <div class="col-md-4"><label class="form-label" for="n-aero">Aerolínea *</label>
            <select class="form-select" id="n-aero" name="aerolinea" required>${options(AEROLINEAS.map((a) => ({ value: a.code, label: a.name })), '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="aerolinea"></div></div>
          <div class="col-md-4"><label class="form-label" for="n-vuelo">Vuelo *</label>
            <input class="form-control text-uppercase" id="n-vuelo" name="vuelo" maxlength="8" placeholder="AMX1345" autocomplete="off" required><div class="invalid-feedback" data-for="vuelo"></div></div>
          <div class="col-md-4"><label class="form-label" for="n-sev">Severidad *</label>
            <select class="form-select" id="n-sev" name="severidad" required>${options(SEVERIDADES.map((s) => ({ value: s.code, label: `${s.code} · SLA ${s.slaHoras} h` })), '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="severidad"></div></div>
          <div class="col-md-4"><label class="form-label" for="n-edif">Edificio</label>
            <select class="form-select" id="n-edif" name="edificio">${options(['T1', 'T2'], 'T1')}</select></div>
          <div class="col-md-4"><label class="form-label" for="n-nivel">Nivel *</label>
            <select class="form-select" id="n-nivel" name="nivel" required>${options(NIVELES.map((n) => ({ value: n.code, label: `${n.code} · ${n.name}` })), '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="nivel"></div></div>
          <div class="col-md-4"><label class="form-label" for="n-equipo">Equipo / banda</label>
            <input class="form-control" id="n-equipo" name="equipo" maxlength="30" placeholder="TTS02_IJ003" autocomplete="off"><div class="invalid-feedback" data-for="equipo"></div></div>
          <div class="col-12"><label class="form-label" for="n-desc">Descripción *</label>
            <textarea class="form-control" id="n-desc" name="descripcion" rows="3" maxlength="500" required placeholder="Describe lo ocurrido, ubicación exacta y acciones inmediatas."></textarea>
            <div class="d-flex"><div class="invalid-feedback d-block flex-grow-1" data-for="descripcion"></div><span class="char-count" id="n-count">0 / 500</span></div></div>
          <div class="col-md-7"><label class="form-label" for="n-file">Evidencia fotográfica</label>
            <input class="form-control" type="file" id="n-file" name="evidencia" accept="image/jpeg,image/png,image/webp">
            <div class="form-text">JPG, PNG o WEBP · máximo 5 MB.</div><div class="invalid-feedback" data-for="evidencia"></div></div>
          <div class="col-md-5"><div class="evidence" id="n-preview"><i class="bi bi-image" aria-hidden="true"></i><span>Vista previa</span></div></div>
        </div>
      </form>`,
      footer: html`<button type="button" class="btn btn-outline" data-bs-dismiss="modal">Cancelar</button>
        <button type="submit" form="form-inc" class="btn btn-accent"><i class="bi bi-save" aria-hidden="true"></i>Registrar incidencia</button>`,
    });

    const form = $('#form-inc', m);
    const desc = form.elements.descripcion;
    desc.addEventListener('input', () => { $('#n-count', m).textContent = `${desc.value.length} / 500`; });
    form.elements.vuelo.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    let fileOk = null;
    form.elements.evidencia.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const prev = $('#n-preview', m);
      if (evidenciaURL) { URL.revokeObjectURL(evidenciaURL); evidenciaURL = null; }
      fileOk = null;
      showFieldErrors(form, {});
      if (!file) { mount(prev, html`<i class="bi bi-image" aria-hidden="true"></i><span>Vista previa</span>`); return; }
      const err = await validarImagen(file);
      if (err) { showFieldErrors(form, { evidencia: err }); e.target.value = ''; mount(prev, html`<i class="bi bi-image" aria-hidden="true"></i><span>Vista previa</span>`); return; }
      fileOk = file;
      evidenciaURL = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.alt = 'Vista previa de la evidencia';
      img.src = evidenciaURL;
      prev.replaceChildren(img);
    });
    m.addEventListener('hidden.bs.modal', () => { if (evidenciaURL) { URL.revokeObjectURL(evidenciaURL); evidenciaURL = null; } });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.evidencia = fileOk || null;
      const errors = validarIncidencia(data);
      showFieldErrors(form, errors);
      if (Object.keys(errors).length) return;
      const btn = m.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const inc = await crearIncidencia(data, ctxRef.user);
        close();
        toast(`Incidencia ${inc.folio} registrada correctamente.`, 'ok');
        window.dispatchEvent(new CustomEvent('sigec:incidencias-changed'));
        st.page = 1; st.sort = { key: 'fecha', dir: 'desc' };
        await loadTable(el);
        openDetail(el, inc.folio, true);
      } catch (err) {
        showFieldErrors(form, err.fields || {});
        if (!err.fields || err.amigable) toast(err.amigable ? err.message : 'No fue posible registrar la incidencia.', 'crit');
        btn.disabled = false;
      }
    });
  }

  /** Valida tipo real por firma (magic bytes), no solo por extensión/MIME. */
  async function validarImagen(file) {
    if (file.size > 5 * 1024 * 1024) return 'La imagen supera 5 MB.';
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJPG = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
    const isPNG = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
    const isWEBP = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    return isJPG || isPNG || isWEBP ? null : 'Formato no permitido. Usa JPG, PNG o WEBP.';
  }

  // ------------------------------------------------------------- Exportar
  async function exportCSV() {
    const rows = await exportIncidencias(st.filters);
    if (!rows.length) { toast('No hay registros para exportar.', 'warn'); return; }
    downloadCSV(`incidencias_${isoDay(new Date())}.csv`, [
      { label: 'Folio', key: 'folio' },
      { label: 'Fecha', value: (r) => date(r.fecha) },
      { label: 'Hora', value: (r) => time(r.fecha) },
      { label: 'Tipo', key: 'tipo' },
      { label: 'Aerolínea', value: (r) => aerolineaName(r.aerolinea) },
      { label: 'Vuelo', key: 'vuelo' },
      { label: 'Edificio', key: 'edificio' },
      { label: 'Nivel', key: 'nivel' },
      { label: 'Equipo', key: 'equipo' },
      { label: 'Severidad', key: 'severidad' },
      { label: 'Estado', key: 'estado' },
      { label: 'T. atención (min)', key: 'tiempoAtencion' },
      { label: 'T. resolución (h)', key: 'tiempoResolucion' },
      { label: 'Descripción', key: 'descripcion' },
      { label: 'Observaciones', key: 'observaciones' },
    ], rows);
    toast(`Se exportaron ${num(rows.length)} registros.`, 'ok');
  }

  function destroy() {
    if (evidenciaURL) { URL.revokeObjectURL(evidenciaURL); evidenciaURL = null; }
  }

  SIGEC.define('views/reportes', { render, destroy });
})();
