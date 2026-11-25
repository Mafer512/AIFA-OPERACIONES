(function () {
  'use strict';
  /** Encuestas — Respuestas de pasajeros y evaluaciones de aerolíneas. */
  const { html, mount, $, on, debounce } = SIGEC.use('core/dom');
  const { num, dec, pct, date, time, isoDay } = SIGEC.use('core/format');
  const { pageHead, pagination, options, empty, stars, badge, toast, downloadCSV, openModal, showFieldErrors } = SIGEC.use('core/ui');
  const { listEncuestas, exportEncuestas, crearEncuesta } = SIGEC.use('data/api');
  const { AEROLINEAS, CANALES_ENCUESTA, AREAS_EVALUADAS, aerolineaName } = SIGEC.use('data/catalogs');
  const CALIFICACIONES = [
    { value: '5', label: '5 · Excelente' },
    { value: '4', label: '4 · Bueno' },
    { value: '3', label: '3 · Regular' },
    { value: '2', label: '2 · Malo' },
    { value: '1', label: '1 · Muy malo' },
  ];
  const PERIODOS_E = [
    { value: '7', label: 'Últimos 7 días' },
    { value: '30', label: 'Últimos 30 días' },
    { value: '90', label: 'Últimos 90 días' },
    { value: 'todo', label: 'Todo el historial' },
  ];

  let st;
  let ctxRef;

  async function render(el, ctx) {
    ctxRef = ctx;
    const p = ctx.params;
    st = {
      tipo: p.tipo === 'aerolineas' ? 'aerolineas' : 'pasajeros',
      filters: {
        periodo: PERIODOS_E.some((x) => x.value === p.periodo) ? p.periodo : '30',
        aerolinea: AEROLINEAS.some((a) => a.code === p.aerolinea) ? p.aerolinea : '',
        calificacion: ['1', '2', '3', '4', '5'].includes(p.cal) ? p.cal : '',
        recomienda: ['si', 'no'].includes(p.rec) ? p.rec : '',
        q: '',
      },
      page: 1,
      pageSize: 10,
    };

    mount(el, html`
      ${pageHead({
        icon: 'bi-ui-checks',
        title: 'Respuestas de Encuestas',
        subtitle: 'Percepción del servicio por pasajeros y aerolíneas',
        aside: html`
          ${ctx.can('exportar') ? html`<button type="button" class="btn btn-outline btn-sm" id="btn-export"><i class="bi bi-download" aria-hidden="true"></i>Exportar CSV</button>` : ''}
          ${ctx.can('encuesta:capturar') ? html`<button type="button" class="btn btn-accent btn-sm" id="btn-capturar"><i class="bi bi-plus-lg" aria-hidden="true"></i>Registrar encuesta</button>` : ''}`,
      })}

      <div class="tabs" role="tablist" aria-label="Tipo de encuesta">
        <button type="button" class="tab" role="tab" data-tipo="pasajeros" aria-selected="${String(st.tipo === 'pasajeros')}"><i class="bi bi-people-fill" aria-hidden="true"></i>Encuesta a Pasajeros</button>
        <button type="button" class="tab" role="tab" data-tipo="aerolineas" aria-selected="${String(st.tipo === 'aerolineas')}"><i class="bi bi-airplane-fill" aria-hidden="true"></i>Encuesta a Aerolíneas</button>
      </div>

      <form class="filterbar" id="enc-filters" role="search" novalidate>
        <div class="field"><label for="e-periodo">Periodo</label><select class="form-select" id="e-periodo" name="periodo">${options(PERIODOS_E, st.filters.periodo)}</select></div>
        <div class="field"><label for="e-aero">Aerolínea</label><select class="form-select" id="e-aero" name="aerolinea">${options(AEROLINEAS.map((a) => ({ value: a.code, label: a.name })), st.filters.aerolinea, { all: 'Todas' })}</select></div>
        <div class="field"><label for="e-cal">Calificación</label><select class="form-select" id="e-cal" name="calificacion">${options(['5', '4', '3', '2', '1'].map((v) => ({ value: v, label: `${v} / 5` })), st.filters.calificacion, { all: 'Todas' })}</select></div>
        <div class="field"><label for="e-rec">¿Recomendaría?</label><select class="form-select" id="e-rec" name="recomienda">${options([{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }], st.filters.recomienda, { all: 'Todos' })}</select></div>
        <div class="field field--grow"><label for="e-q">Comentario contiene</label>
          <div class="input-icon"><i class="bi bi-search" aria-hidden="true"></i><input class="form-control" id="e-q" name="q" type="search" maxlength="40" placeholder="p. ej. retraso" autocomplete="off"></div></div>
        <div class="actions"><button type="submit" class="btn btn-accent"><i class="bi bi-search" aria-hidden="true"></i>Consultar</button></div>
      </form>

      <div id="enc-summary"></div>
      <section class="card-x card-x--flush" aria-label="Respuestas"><div class="card-x__body" id="enc-table"></div></section>
      <p class="footnote"><i class="bi bi-info-circle" aria-hidden="true"></i>Las respuestas en papel se capturan con «Registrar encuesta» · Los comentarios se muestran como texto plano.</p>
    `);

    const form = $('#enc-filters', el);
    const apply = () => { readFilters(form); st.page = 1; load(el); };
    form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
    form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') apply(); });
    form.elements.q.addEventListener('input', debounce(apply, 350));

    on(el, 'click', '[data-tipo]', (_e, b) => {
      st.tipo = b.dataset.tipo; st.page = 1;
      el.querySelectorAll('[data-tipo]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      load(el);
    });
    on(el, 'click', '[data-page]', (_e, b) => { st.page = Number(b.dataset.page); load(el); });
    $('#btn-export', el)?.addEventListener('click', exportCSV);
    $('#btn-capturar', el)?.addEventListener('click', () => abrirCaptura(el));

    await load(el);
  }

  function readFilters(form) {
    const fd = new FormData(form);
    st.filters = { periodo: fd.get('periodo'), aerolinea: fd.get('aerolinea'), calificacion: fd.get('calificacion'), recomienda: fd.get('recomienda'), q: String(fd.get('q') || '').trim().slice(0, 40) };
  }

  async function load(el) {
    const tbl = $('#enc-table', el);
    tbl.classList.add('is-busy');
    let res;
    try {
      res = await listEncuestas(st.tipo, { filters: st.filters, page: st.page, pageSize: st.pageSize });
    } catch (err) {
      tbl.classList.remove('is-busy');
      if (ctxRef.isCurrent()) {
        mount($('#enc-summary', el), html``);
        mount(tbl, empty('No fue posible cargar las encuestas', err.amigable ? err.message : 'Intenta nuevamente en unos momentos.', 'bi-cloud-slash'));
      }
      return;
    }
    tbl.classList.remove('is-busy');
    if (!ctxRef.isCurrent()) return;
    st.page = res.page;
    const f = st.filters;
    ctxRef.setParams({ tipo: st.tipo === 'aerolineas' ? 'aerolineas' : '', periodo: f.periodo === '30' ? '' : f.periodo, aerolinea: f.aerolinea, cal: f.calificacion, rec: f.recomienda });

    const s = res.resumen;
    const maxDist = Math.max(1, ...s.dist.map((d) => d.value));
    mount($('#enc-summary', el), html`
      <div class="grid-2-1">
        <div class="stat-grid mb-0">
          <div class="stat"><span class="stat__icon stat__icon--info" aria-hidden="true"><i class="bi bi-inboxes-fill"></i></span>
            <div><div class="stat__label">${st.tipo === 'pasajeros' ? 'Respuestas' : 'Evaluaciones'}</div><div class="stat__value">${num(s.total)}</div></div></div>
          <div class="stat"><span class="stat__icon stat__icon--accent" aria-hidden="true"><i class="bi bi-star-fill"></i></span>
            <div><div class="stat__label">Calificación promedio</div><div class="stat__value">${s.promedio == null ? '—' : dec(s.promedio)} <small>/ 5</small></div></div></div>
          <div class="stat"><span class="stat__icon" aria-hidden="true"><i class="bi bi-hand-thumbs-up-fill"></i></span>
            <div><div class="stat__label">Recomendaría el servicio</div><div class="stat__value">${pct(s.recomienda, 1)}</div></div></div>
          <div class="stat"><span class="stat__icon stat__icon--warn" aria-hidden="true"><i class="bi bi-emoji-frown-fill"></i></span>
            <div><div class="stat__label">Calificaciones 1–2 ★</div><div class="stat__value">${num(s.negativas)} <small>${s.total ? pct((s.negativas / s.total) * 100, 1) : ''}</small></div></div></div>
        </div>
        <section class="card-x" aria-labelledby="dist-t">
          <div class="card-x__head"><h3 id="dist-t">Distribución de calificaciones</h3></div>
          <div class="card-x__body pt-2">
            ${s.dist.map((d) => html`<div class="hbar">
              <span>${stars(d.cal)}</span>
              <span class="hbar__track" role="img" aria-label="${d.cal} estrellas: ${d.value} respuestas"><span class="hbar__fill" data-w="${(d.value / maxDist) * 100}"></span></span>
              <span class="hbar__val">${num(d.value)}</span></div>`)}
          </div>
        </section>
      </div>`);

    const isP = st.tipo === 'pasajeros';
    mount(tbl, html`${res.total === 0 ? empty('Sin respuestas', 'No hay encuestas con los filtros seleccionados.', 'bi-chat-square-dots') : html`
      <div class="table-wrap"><table class="table-x">
        <caption class="visually-hidden">Respuestas de encuestas a ${isP ? 'pasajeros' : 'aerolíneas'}</caption>
        <thead><tr>
          <th scope="col">Fecha</th>
          <th scope="col">Aerolínea</th>
          ${isP ? html`<th scope="col">Canal</th>` : html`<th scope="col">Área evaluada</th>`}
          <th scope="col">Calificación general</th>
          <th scope="col">¿Recomendaría el servicio?</th>
          <th scope="col">Comentarios</th>
        </tr></thead>
        <tbody>${res.rows.map((r) => html`<tr>
          <td><span class="d-block">${date(r.fecha)}</span><span class="muted">${time(r.fecha)} h</span></td>
          <td>${aerolineaName(r.aerolinea)}</td>
          <td class="muted">${isP ? r.canal : r.area}</td>
          <td><span class="d-inline-flex align-items-center gap-2">${stars(r.calificacion)}<strong class="${r.calificacion >= 4 ? 'text-ok' : r.calificacion <= 2 ? 'text-crit' : ''}">${r.calificacion} / 5</strong></span></td>
          <td>${r.recomienda ? badge('Sí', 'ok', 'bi-hand-thumbs-up-fill') : badge('No', 'crit', 'bi-hand-thumbs-down-fill')}</td>
          <td class="clip" title="${r.comentario}">${r.comentario ? html`“${r.comentario}”` : html`<span class="muted">Sin comentario</span>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${pagination(res)}`}`);
  }

  // ------------------------------------------------------------ Captura
  /** Registra una respuesta (p. ej. de un formato en papel) en la pestaña activa. */
  function abrirCaptura(el) {
    const isP = st.tipo === 'pasajeros';
    const now = new Date();
    const local = `${isoDay(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const { el: m, close } = openModal({
      title: isP ? 'Registrar encuesta de pasajero' : 'Registrar evaluación de aerolínea',
      icon: isP ? 'bi-people-fill' : 'bi-airplane-fill',
      size: 'modal-lg',
      body: html`<form id="form-enc" novalidate autocomplete="off"><div class="row g-3">
        <div class="col-md-6"><label class="form-label" for="c-fecha">Fecha y hora *</label>
          <input class="form-control" type="datetime-local" id="c-fecha" name="fecha" value="${local}" max="${local}" required><div class="invalid-feedback" data-for="fecha"></div></div>
        <div class="col-md-6"><label class="form-label" for="c-aero">Aerolínea *</label>
          <select class="form-select" id="c-aero" name="aerolinea" required>${options(AEROLINEAS.map((a) => ({ value: a.code, label: a.name })), st.filters.aerolinea, { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="aerolinea"></div></div>
        <div class="col-md-6"><label class="form-label" for="c-cal">Calificación general *</label>
          <select class="form-select" id="c-cal" name="calificacion" required>${options(CALIFICACIONES, '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="calificacion"></div></div>
        <div class="col-md-6"><label class="form-label" for="c-rec">¿Recomendaría el servicio? *</label>
          <select class="form-select" id="c-rec" name="recomienda" required>${options([{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }], '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="recomienda"></div></div>
        ${isP ? html`
        <div class="col-md-6"><label class="form-label" for="c-canal">Canal *</label>
          <select class="form-select" id="c-canal" name="canal" required>${options(CANALES_ENCUESTA, CANALES_ENCUESTA[0])}</select><div class="invalid-feedback" data-for="canal"></div></div>` : html`
        <div class="col-md-6"><label class="form-label" for="c-area">Área evaluada *</label>
          <select class="form-select" id="c-area" name="area" required>${options(AREAS_EVALUADAS, '', { all: 'Selecciona…' })}</select><div class="invalid-feedback" data-for="area"></div></div>
        <div class="col-md-6"><label class="form-label" for="c-eval">Evaluador *</label>
          <input class="form-control" id="c-eval" name="evaluador" maxlength="120" placeholder="Jefatura de estación, cargo o nombre" required><div class="invalid-feedback" data-for="evaluador"></div></div>`}
        <div class="col-12"><label class="form-label" for="c-com">Comentario</label>
          <textarea class="form-control" id="c-com" name="comentario" rows="3" maxlength="500" placeholder="Tal como lo escribió quien respondió."></textarea>
          <div class="d-flex"><div class="invalid-feedback d-block flex-grow-1" data-for="comentario"></div><span class="char-count" id="c-count">0 / 500</span></div></div>
      </div></form>`,
      footer: html`<button type="button" class="btn btn-outline" data-bs-dismiss="modal">Cancelar</button>
        <button type="submit" form="form-enc" class="btn btn-accent"><i class="bi bi-save" aria-hidden="true"></i>Guardar respuesta</button>`,
    });
    const form = $('#form-enc', m);
    form.elements.comentario.addEventListener('input', (e) => { $('#c-count', m).textContent = `${e.target.value.length} / 500`; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = m.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await crearEncuesta(st.tipo, data, ctxRef.user);
      } catch (err) {
        showFieldErrors(form, err.fields || {});
        if (!err.fields || err.amigable) toast(err.amigable ? err.message : 'No fue posible guardar la respuesta.', 'crit');
        btn.disabled = false;
        return;
      }
      close();
      toast(isP ? 'Encuesta registrada.' : 'Evaluación registrada.', 'ok');
      st.page = 1;
      load(el);
    });
  }

  async function exportCSV() {
    const rows = await exportEncuestas(st.tipo, st.filters);
    if (!rows.length) { toast('No hay registros para exportar.', 'warn'); return; }
    const isP = st.tipo === 'pasajeros';
    downloadCSV(`encuestas_${st.tipo}_${isoDay(new Date())}.csv`, [
      { label: 'Fecha', value: (r) => date(r.fecha) },
      { label: 'Hora', value: (r) => time(r.fecha) },
      { label: 'Aerolínea', value: (r) => aerolineaName(r.aerolinea) },
      { label: isP ? 'Canal' : 'Área evaluada', value: (r) => (isP ? r.canal : r.area) },
      { label: 'Calificación', key: 'calificacion' },
      { label: 'Recomendaría', value: (r) => (r.recomienda ? 'Sí' : 'No') },
      { label: 'Comentario', key: 'comentario' },
    ], rows);
    toast(`Se exportaron ${num(rows.length)} registros.`, 'ok');
  }

  SIGEC.define('views/encuestas', { render });
})();
