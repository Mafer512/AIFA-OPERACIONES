(function () {
  'use strict';
  /** Inicio — Panel de control (Indicadores operativos / Análisis de calidad). */
  const { html, mount, $, on } = SIGEC.use('core/dom');
  const { num, dec, pct, dateTime, isoDay } = SIGEC.use('core/format');
  const { pageHead, kpiCard, delta, ring, options, empty, stars, toast, viewSkeleton } = SIGEC.use('core/ui');
  const { ChartSet, chartCard, bindChartTable, barChart, lineChart, donutChart } = SIGEC.use('core/charts');
  const { getDashboard, getCalidad, resolveRange, refrescar } = SIGEC.use('data/api');
  const { AEROLINEAS, TIPOS_INCIDENCIA, NIVELES, PERIODOS, aerolineaName } = SIGEC.use('data/catalogs');
  const charts = new ChartSet();
  let state;

  function readState(params) {
    const valid = (v, list, key = 'code') => (list.some((x) => (typeof x === 'string' ? x : x[key]) === v) ? v : '');
    const periodo = PERIODOS.some((p) => p.value === params.periodo) ? params.periodo : '30';
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    return {
      tab: params.tab === 'calidad' ? 'calidad' : 'operativos',
      periodo,
      desde: isDay(params.desde) ? params.desde : '',
      hasta: isDay(params.hasta) ? params.hasta : '',
      aerolinea: valid(params.aerolinea, AEROLINEAS),
      tipo: valid(params.tipo, TIPOS_INCIDENCIA),
      nivel: valid(params.nivel, NIVELES),
      comparar: params.comparar !== '0',
    };
  }

  const toFilters = (s) => ({
    periodo: s.periodo,
    desde: s.desde ? new Date(`${s.desde}T00:00:00`) : null,
    hasta: s.hasta ? new Date(`${s.hasta}T00:00:00`) : null,
    aerolinea: s.aerolinea, tipo: s.tipo, nivel: s.nivel,
  });

  async function render(el, ctx) {
    state = readState(ctx.params);
    const r = resolveRange(toFilters(state));
    if (!state.desde) state.desde = isoDay(r.desde);
    if (!state.hasta) state.hasta = isoDay(r.hasta);

    mount(el, html`
      ${pageHead({
        icon: 'bi-bar-chart-line-fill',
        title: 'Panel de control',
        subtitle: 'Indicadores de calidad del servicio de equipaje y atención',
        aside: html`<span><i class="bi bi-calendar3" aria-hidden="true"></i> Última actualización: <strong id="last-update">—</strong></span>
          <button type="button" class="btn btn-outline btn-sm" id="btn-refresh" aria-label="Actualizar datos"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i>Actualizar</button>`,
      })}

      <div class="tabs" role="tablist" aria-label="Secciones del panel">
        <button type="button" class="tab" role="tab" data-tab="operativos" aria-selected="${String(state.tab === 'operativos')}"><i class="bi bi-speedometer2" aria-hidden="true"></i>Indicadores operativos</button>
        <button type="button" class="tab" role="tab" data-tab="calidad" aria-selected="${String(state.tab === 'calidad')}"><i class="bi bi-patch-check" aria-hidden="true"></i>Análisis de calidad</button>
      </div>

      <form class="filterbar" id="dash-filters" novalidate>
        <div class="field"><label for="f-periodo">Periodo</label>
          <select class="form-select" id="f-periodo" name="periodo">${options(PERIODOS, state.periodo)}</select></div>
        <div class="field"><label for="f-desde">Fecha inicial</label>
          <input class="form-control" type="date" id="f-desde" name="desde" value="${state.desde}" max="${isoDay(new Date())}"></div>
        <div class="field"><label for="f-hasta">Fecha final</label>
          <input class="form-control" type="date" id="f-hasta" name="hasta" value="${state.hasta}" max="${isoDay(new Date())}"></div>
        <div class="field"><label for="f-aero">Aerolínea</label>
          <select class="form-select" id="f-aero" name="aerolinea">${options(AEROLINEAS.map((a) => ({ value: a.code, label: a.name })), state.aerolinea, { all: 'Todas' })}</select></div>
        <div class="field" data-only="operativos"><label for="f-tipo">Tipo de incidencia</label>
          <select class="form-select" id="f-tipo" name="tipo">${options(TIPOS_INCIDENCIA, state.tipo, { all: 'Todos' })}</select></div>
        <div class="field" data-only="operativos"><label for="f-nivel">Nivel</label>
          <select class="form-select" id="f-nivel" name="nivel">${options(NIVELES.map((n) => ({ value: n.code, label: `${n.code} · ${n.name}` })), state.nivel, { all: 'Todos' })}</select></div>
        <div class="actions">
          <label class="check"><input class="form-check-input m-0" type="checkbox" name="comparar"> Comparar con periodo anterior</label>
          <button type="submit" class="btn btn-brand"><i class="bi bi-funnel-fill" aria-hidden="true"></i>Aplicar filtros</button>
        </div>
      </form>

      <div id="dash-body"></div>
      <p class="footnote"><i class="bi bi-info-circle" aria-hidden="true"></i>El comparativo usa un periodo de igual duración inmediatamente anterior.</p>
    `);

    $('#dash-filters', el).elements.comparar.checked = state.comparar;
    syncTabFields(el);

    const form = $('#dash-filters', el);
    form.elements.periodo.addEventListener('change', () => {
      if (form.elements.periodo.value === 'custom') { form.elements.desde.focus(); return; }
      const rr = resolveRange({ periodo: form.elements.periodo.value });
      form.elements.desde.value = isoDay(rr.desde);
      form.elements.hasta.value = isoDay(rr.hasta);
    });
    ['desde', 'hasta'].forEach((n) => form.elements[n].addEventListener('change', () => { form.elements.periodo.value = 'custom'; }));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const desde = fd.get('desde'), hasta = fd.get('hasta');
      if (fd.get('periodo') === 'custom' && (!desde || !hasta)) { toast('Indica fecha inicial y final.', 'warn'); return; }
      if (desde && hasta && desde > hasta) { toast('La fecha inicial no puede ser posterior a la final.', 'warn'); return; }
      Object.assign(state, {
        periodo: fd.get('periodo'), desde, hasta,
        aerolinea: fd.get('aerolinea'), tipo: fd.get('tipo'), nivel: fd.get('nivel'), comparar: fd.get('comparar') === 'on',
      });
      persist(ctx);
      loadBody(el, ctx);
    });

    on(el, 'click', '[data-tab]', (_e, btn) => {
      state.tab = btn.dataset.tab;
      el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      syncTabFields(el);
      persist(ctx);
      loadBody(el, ctx);
    });
    $('#btn-refresh', el).addEventListener('click', () => { refrescar(); loadBody(el, ctx); });

    await loadBody(el, ctx);
  }

  function syncTabFields(el) {
    el.querySelectorAll('[data-only]').forEach((f) => { f.hidden = f.dataset.only !== state.tab; });
  }

  function persist(ctx) {
    ctx.setParams({
      tab: state.tab === 'calidad' ? 'calidad' : '',
      periodo: state.periodo === '30' ? '' : state.periodo,
      desde: state.periodo === 'custom' ? state.desde : '',
      hasta: state.periodo === 'custom' ? state.hasta : '',
      aerolinea: state.aerolinea, tipo: state.tipo, nivel: state.nivel,
      comparar: state.comparar ? '' : '0',
    });
  }

  async function loadBody(el, ctx) {
    const body = $('#dash-body', el);
    if (!body.firstElementChild) mount(body, viewSkeleton());
    body.classList.add('is-busy');
    try {
      const filters = toFilters(state);
      if (state.tab === 'calidad') {
        const data = await getCalidad(filters);
        if (!ctx.isCurrent()) return;
        renderCalidad(body, data);
        $('#last-update', el).textContent = `${dateTime(new Date())} h`;
      } else {
        const data = await getDashboard(filters);
        if (!ctx.isCurrent()) return;
        renderOperativos(body, data);
        $('#last-update', el).textContent = `${dateTime(data.actualizado)} h`;
      }
    } catch (err) {
      if (!ctx.isCurrent()) return;
      charts.destroy();
      mount(body, html`<div class="card-x">${empty('No fue posible cargar los indicadores', err.amigable ? err.message : 'Intenta nuevamente en unos momentos.', 'bi-cloud-slash')}</div>`);
    } finally {
      body.classList.remove('is-busy');
    }
  }

  // ======================================================== Operativos
  function renderOperativos(body, d) {
    charts.destroy();
    const k = d.kpis;
    const cmp = state.comparar;
    const dl = (kk, goodWhen) => (cmp ? delta(kk.value, kk.prev, { goodWhen }) : '');
    // Pendientes/en proceso son estados vivos: se comparan contra el total, no contra el periodo anterior.
    const share = (v) => html`<span class="delta delta--flat" title="Proporción del total del periodo">${d.total ? pct((v / d.total) * 100) : '0%'} del total</span>`;

    mount(body, html`
      <section class="kpi-grid" aria-label="Indicadores clave">
        ${kpiCard({ label: 'Incidencias registradas', value: num(k.registradas.value), icon: 'bi-luggage-fill', tone: 'brand', deltaHtml: dl(k.registradas, 'down'), spark: k.registradas.spark, sparkTone: 'c1' })}
        ${kpiCard({ label: 'Pendientes', value: num(k.pendientes.value), icon: 'bi-clock-fill', tone: 'warn', deltaHtml: share(k.pendientes.value), spark: k.pendientes.spark, sparkTone: 'warn' })}
        ${kpiCard({ label: 'En proceso', value: num(k.enProceso.value), icon: 'bi-gear-fill', tone: 'info', deltaHtml: share(k.enProceso.value), spark: k.enProceso.spark, sparkTone: 'info' })}
        ${kpiCard({ label: 'Solucionadas', value: num(k.solucionadas.value), icon: 'bi-check-lg', tone: 'ok', deltaHtml: dl(k.solucionadas, 'up'), spark: k.solucionadas.spark, sparkTone: 'ok' })}
        ${kpiCard({ label: 'Tiempo promedio de atención', value: k.atencion.value == null ? '—' : Math.round(k.atencion.value), unit: k.atencion.value == null ? '' : 'min', icon: 'bi-stopwatch-fill', tone: 'neutral', deltaHtml: dl(k.atencion, 'down'), spark: k.atencion.spark, sparkTone: 'ink' })}
      </section>

      ${d.total === 0 ? html`<div class="card-x mb-gap">${empty('Sin incidencias en el periodo', 'Prueba con otro rango de fechas o elimina filtros.', 'bi-clipboard-check')}</div>` : ''}

      <div class="grid-2">
        ${chartCard({ id: 'ch-tipo', title: 'Incidencias por tipo', size: 'chart-box--lg' })}
        ${chartCard({
          id: 'ch-tend', title: 'Tendencia de incidencias', sub: d.tendencia.weekly ? 'por semana' : 'por día', size: 'chart-box--lg',
          legend: html`<span class="legend-inline"><span><i class="swatch swatch--line sw-c1"></i>Actual</span>${cmp ? html`<span><i class="swatch swatch--dashed"></i>Periodo anterior</span>` : ''}</span>`,
        })}
      </div>

      <div class="grid-3">
        ${chartCard({
          id: 'ch-sev', title: 'Incidencias por severidad',
          body: html`<div class="donut-wrap">
            <div class="donut"><canvas role="img" aria-label="Gráfica de dona: incidencias por severidad"></canvas>
              <div class="donut__center"><strong>${num(d.total)}</strong><span>Total</span></div></div>
            <ul class="legend-list">${[...d.severidad].reverse().map((s) => html`<li>
              <i class="swatch ${s.sw}" aria-hidden="true"></i><i class="bi ${s.icon} text-ink-3" aria-hidden="true"></i>${s.code}
              <b>${num(s.value)}</b><em>${d.total ? pct((s.value / d.total) * 100) : '0%'}</em></li>`)}</ul>
          </div>`,
        })}
        ${chartCard({ id: 'ch-nivel', title: 'Incidencias por nivel', sub: 'nivel del edificio' })}
        ${chartCard({
          id: 'ch-sat', title: 'Satisfacción del servicio', sub: 'encuestas · 4–5 ★',
          body: html`<div class="ring-grid">
            <div>${d.satisfaccion.pasajerosN ? ring(d.satisfaccion.pasajeros, 'c1') : html`<div class="ring-empty">Sin datos</div>`}<div class="ring-label">Pasajeros</div><div class="ring-sub">${num(d.satisfaccion.pasajerosN)} respuestas</div></div>
            <div>${d.satisfaccion.aerolineasN ? ring(d.satisfaccion.aerolineas, 'c2') : html`<div class="ring-empty">Sin datos</div>`}<div class="ring-label">Aerolíneas</div><div class="ring-sub">${num(d.satisfaccion.aerolineasN)} evaluaciones</div></div>
          </div>`,
        })}
      </div>
    `);

    // Por tipo (una serie → un color)
    const tipoCard = $('#ch-tipo', body);
    charts.add(barChart($('canvas', tipoCard), { labels: d.porTipo.map((x) => x.label), values: d.porTipo.map((x) => x.value), horizontal: true, label: 'Incidencias' }));
    bindChartTable(tipoCard, [{ label: 'Tipo', value: (r) => r.label }, { label: 'Incidencias', num: true, value: (r) => num(r.value) }, { label: '% del total', num: true, value: (r) => (d.total ? pct((r.value / d.total) * 100, 1) : '0%') }], d.porTipo);

    // Tendencia
    const tendCard = $('#ch-tend', body);
    const series = [{ label: 'Actual', data: d.tendencia.actual, tone: 'c1', fill: true }];
    if (cmp) series.push({ label: 'Periodo anterior', data: d.tendencia.anterior, tone: 'c-prev', dashed: true });
    charts.add(lineChart($('canvas', tendCard), { labels: d.tendencia.labels, series }));
    bindChartTable(tendCard, [
      { label: d.tendencia.weekly ? 'Semana' : 'Día', value: (r) => r.l },
      { label: 'Actual', num: true, value: (r) => num(r.a) },
      ...(cmp ? [{ label: 'Periodo anterior', num: true, value: (r) => (r.p == null ? '—' : num(r.p)) }] : []),
    ], d.tendencia.labels.map((l, i) => ({ l, a: d.tendencia.actual[i], p: d.tendencia.anterior[i] })));

    // Severidad (colores de estado reservados + icono + texto)
    const sevCard = $('#ch-sev', body);
    const sevTone = { Baja: '--sev-baja', Media: '--sev-media', Alta: '--sev-alta', Crítica: '--sev-critica' };
    charts.add(donutChart($('canvas', sevCard), { labels: d.severidad.map((s) => s.code), values: d.severidad.map((s) => s.value), tones: d.severidad.map((s) => sevTone[s.code]) }));
    bindChartTable(sevCard, [{ label: 'Severidad', value: (r) => r.code }, { label: 'Incidencias', num: true, value: (r) => num(r.value) }, { label: 'SLA', num: true, value: (r) => `${r.slaHoras} h` }], d.severidad);

    // Nivel
    const nivelCard = $('#ch-nivel', body);
    charts.add(barChart($('canvas', nivelCard), { labels: d.porNivel.map((n) => n.label), values: d.porNivel.map((n) => n.value), tone: 'c2', label: 'Incidencias' }));
    bindChartTable(nivelCard, [{ label: 'Nivel', value: (r) => `${r.label} · ${r.name}` }, { label: 'Incidencias', num: true, value: (r) => num(r.value) }], d.porNivel);

    bindChartTable($('#ch-sat', body), [{ label: 'Segmento', value: (r) => r.s }, { label: 'Satisfacción', num: true, value: (r) => pct(r.v, 1) }, { label: 'Muestra', num: true, value: (r) => num(r.n) }],
      [{ s: 'Pasajeros', v: d.satisfaccion.pasajeros, n: d.satisfaccion.pasajerosN }, { s: 'Aerolíneas', v: d.satisfaccion.aerolineas, n: d.satisfaccion.aerolineasN }]);
  }

  // ========================================================== Calidad
  function renderCalidad(body, d) {
    charts.destroy();
    const k = d.kpis;
    const cmp = state.comparar;
    const dl = (kk, goodWhen, mode) => (cmp ? delta(kk.value, kk.prev, { goodWhen, mode }) : '');

    mount(body, html`
      <section class="kpi-grid" aria-label="Indicadores de calidad">
        ${kpiCard({ label: 'Satisfacción promedio', value: k.satisfaccion.value == null ? '—' : dec(k.satisfaccion.value), unit: '/ 5', icon: 'bi-star-fill', tone: 'accent', deltaHtml: dl(k.satisfaccion, 'up') })}
        ${kpiCard({ label: 'Recomendaría el servicio', value: dec(k.recomienda.value), unit: '%', icon: 'bi-hand-thumbs-up-fill', tone: 'brand', deltaHtml: dl(k.recomienda, 'up', 'pts') })}
        ${kpiCard({ label: 'Encuestas respondidas', value: num(k.respuestas.value), icon: 'bi-ui-checks', tone: 'info', deltaHtml: dl(k.respuestas, 'up') })}
        ${kpiCard({ label: 'Cumplimiento de SLA', value: dec(k.sla.value), unit: '%', icon: 'bi-shield-check', tone: 'ok', deltaHtml: dl(k.sla, 'up', 'pts'), foot: 'Incidencias solucionadas dentro de su tiempo objetivo' })}
        ${kpiCard({ label: 'T. promedio de resolución', value: k.resolucion.value == null ? '—' : dec(k.resolucion.value), unit: 'h', icon: 'bi-hourglass-bottom', tone: 'neutral', deltaHtml: dl(k.resolucion, 'down') })}
      </section>

      <div class="grid-2">
        ${chartCard({ id: 'ch-aero', title: 'Satisfacción por aerolínea', sub: 'calificación promedio (1–5)', size: 'chart-box--lg' })}
        ${chartCard({ id: 'ch-tsat', title: 'Tendencia de satisfacción', sub: `% de calificaciones 4–5 ★ ${d.tendencia.weekly ? 'por semana' : 'por día'}`, size: 'chart-box--lg' })}
      </div>

      <div class="grid-3">
        ${chartCard({ id: 'ch-dist', title: 'Distribución de calificaciones' })}
        ${chartCard({ id: 'ch-sla', title: 'SLA por severidad', sub: '% dentro de objetivo' })}
        <section class="card-x card-x--banded" aria-labelledby="cm-t">
          <div class="card-x__head"><h3 id="cm-t">Comentarios recientes</h3>
            <div class="card-x__actions"><a class="btn btn-ghost btn-sm" href="#/encuestas" aria-label="Ver todas las encuestas"><i class="bi bi-arrow-right" aria-hidden="true"></i></a></div></div>
          <div class="card-x__body pt-1">
            ${d.comentarios.length ? html`<ul class="comment-list">${d.comentarios.map((c) => html`<li>
              <span>“${c.comentario}”</span>
              <span class="meta">${stars(c.calificacion)}<span>${aerolineaName(c.aerolinea)}</span><span>· ${dateTime(c.fecha)}</span></span></li>`)}</ul>`
              : empty('Sin comentarios', 'No hay comentarios en el periodo.', 'bi-chat-square-text')}
          </div>
        </section>
      </div>
    `);

    const aeroCard = $('#ch-aero', body);
    charts.add(barChart($('canvas', aeroCard), { labels: d.porAerolinea.map((a) => a.label), values: d.porAerolinea.map((a) => +a.value.toFixed(2)), horizontal: true, max: 5, format: (v) => dec(v), label: 'Promedio' }));
    bindChartTable(aeroCard, [{ label: 'Aerolínea', value: (r) => r.label }, { label: 'Promedio', num: true, value: (r) => dec(r.value) }, { label: 'Respuestas', num: true, value: (r) => num(r.n) }], d.porAerolinea);

    const tsCard = $('#ch-tsat', body);
    const vals = d.tendencia.values.filter((v) => v != null);
    charts.add(lineChart($('canvas', tsCard), { labels: d.tendencia.labels, series: [{ label: 'Satisfacción', data: d.tendencia.values, tone: 'c1', fill: true }], format: (v) => `${Math.round(v)}%`, suggestedMin: vals.length ? Math.max(0, Math.floor(Math.min(...vals) / 10) * 10 - 10) : 0, max: 100 }));
    bindChartTable(tsCard, [{ label: d.tendencia.weekly ? 'Semana' : 'Día', value: (r) => r.l }, { label: '% 4–5 ★', num: true, value: (r) => (r.v == null ? '—' : pct(r.v, 1)) }], d.tendencia.labels.map((l, i) => ({ l, v: d.tendencia.values[i] })));

    const distCard = $('#ch-dist', body);
    charts.add(barChart($('canvas', distCard), { labels: d.distribucion.map((x) => x.label), values: d.distribucion.map((x) => x.value), tone: 'c4', label: 'Respuestas' }));
    bindChartTable(distCard, [{ label: 'Calificación', value: (r) => r.label }, { label: 'Respuestas', num: true, value: (r) => num(r.value) }], d.distribucion);

    const slaCard = $('#ch-sla', body);
    charts.add(barChart($('canvas', slaCard), { labels: d.slaPorSeveridad.map((x) => `${x.label} (${x.sla} h)`), values: d.slaPorSeveridad.map((x) => x.value), horizontal: true, max: 100, tone: 'c2', format: (v) => `${Math.round(v)}%`, label: 'Cumplimiento' }));
    bindChartTable(slaCard, [{ label: 'Severidad', value: (r) => r.label }, { label: 'Objetivo', num: true, value: (r) => `${r.sla} h` }, { label: 'Cumplimiento', num: true, value: (r) => pct(r.value, 1) }, { label: 'Casos', num: true, value: (r) => num(r.n) }], d.slaPorSeveridad);
  }

  function destroy() { charts.destroy(); }

  SIGEC.define('views/inicio', { render, destroy });
})();
