/* Informe Estadístico — pestaña "Estadística" de Conciliación.
 *
 * Desglose mensual de las tres aviaciones: monthly_operations /
 * annual_operations, la cifra oficial que captura el área (misma tabla y misma
 * regla de "oficial vs preliminar" que js/comparativa-historica.js).
 * Detalle diario (cifras del día de corte, factor de ocupación, participación
 * por aerolínea) y meses todavía no ratificados: manifiestos ya conciliados,
 * vía v_informe_estadistico_resumen / _aerolinea / v_informe_manifiestos_
 * normalizado — ver supabase/migrations/027 y 028 (esta última los materializa).
 */
(function () {
    'use strict';

    const Core = window.InformeEstadisticoCore;
    if (!Core) {
        console.error('No se cargó el núcleo del Informe Estadístico.');
        return;
    }

    const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
    const kgFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
    const pctFormat = (value) => Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';

    const state = {
        loaded: false,
        loadingPromise: null,
        aggregated: null,
        acumulado: null,
        aerolineaRowsRaw: [],
        anios: [],
        anioSeleccionado: null,
        anioComparar: null,
        aprobacion: null,
        diaCorte: null,
        ocupacion: { rows: [], promedioGeneral: null },
        ocupacionRowsRaw: [],
        ocupacionDesde: null,
        ocupacionHasta: null,
        aeropuertos: {},
        aerolineaAnioCargado: null,
        datosAl: null,
        corteIso: null,
        corte: null,
        chart: null
    };

    const $ = (id) => document.getElementById(id);
    const fmt = (value) => numberFormat.format(Number.isFinite(Number(value)) ? Number(value) : 0);
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);

    // PostgREST corta cada respuesta en 1,000 renglones, así que hay que
    // paginar. `filtro` permite acotar del lado del servidor: cada página de
    // más es una consulta de más, y antes de 028 cada consulta recalculaba la
    // normalización completa (ver esa migración).
    async function fetchAllRows(client, table, select, filtro) {
        const rows = [];
        const batchSize = 1000;
        for (let from = 0; ; from += batchSize) {
            let query = client.from(table).select(select);
            if (filtro) query = filtro(query);
            const { data, error } = await query.range(from, from + batchSize - 1);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < batchSize) break;
        }
        return rows;
    }

    function todayIso() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function isoDateMinusDays(isoDate, days) {
        const d = new Date(`${isoDate}T12:00:00`);
        d.setDate(d.getDate() - days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function parseIsoDate(iso) {
        const [anio, mes, dia] = String(iso).split('-').map(Number);
        return { anio, mes, dia };
    }

    // El informe cierra con el DÍA ANTERIOR, no con el de hoy: las aerolíneas
    // tienen 30 horas para entregar el manifiesto, así que la cifra de hoy
    // siempre estaría a medias. Por eso el documento oficial lleva
    // "Actualización" (hoy) y "Corte" (ayer) como fechas distintas.
    function corteIsoPorOmision() {
        return isoDateMinusDays(todayIso(), 1);
    }

    function canApprove() {
        try {
            return typeof window.sectionLevel === 'function' && window.sectionLevel('conciliacion') === 'admin';
        } catch (_) {
            return false;
        }
    }

    // ── Carga de datos ──────────────────────────────────────────────────────
    // La carga va en DOS tandas para que la pestaña deje de tardar tanto en
    // mostrar algo:
    //   1) el núcleo del informe (vistas ya agregadas por año/mes) — se pinta
    //      en cuanto llega;
    //   2) el detalle diario, que es lo caro, porque sale de
    //      v_informe_manifiestos_normalizado (esa vista recorre toda
    //      maestra_operaciones con joins laterales por renglón).
    // La tanda 2 hace UNA sola pasada de 15 días: antes eran dos consultas
    // distintas al mismo rango (cifras del día + factor de ocupación), o sea
    // el doble de trabajo en el servidor para los mismos renglones.
    const COLUMNAS_RESUMEN = 'anio,mes,tipo_aviacion,direccion,nacional_internacional,operaciones,pax_total,carga_kg_total,operaciones_respaldo_itinerario';
    const COLUMNAS_AEROLINEA = 'anio,aerolinea,tipo_aviacion,operaciones,pax_total,carga_kg_total';
    const COLUMNAS_DETALLE = 'fecha_operacion,direccion,aerolinea,es_carga,pax_total,carga_kg,capacidad_matricula,endpoint_code,nacional_internacional';

    async function getClient() {
        const client = window.supabaseClient || (window.ensureSupabaseClient && await window.ensureSupabaseClient());
        if (!client) throw new Error('No se pudo inicializar el cliente de Supabase.');
        return client;
    }

    async function loadCore(client) {
        const [resumenRows, monthlyRows, annualRows, aeropuertos] = await Promise.all([
            fetchAllRows(client, 'v_informe_estadistico_resumen', COLUMNAS_RESUMEN),
            fetchAllRows(client, 'monthly_operations', '*'),
            fetchAllRows(client, 'annual_operations', '*'),
            loadAeropuertos(client),
            loadFrescura(client)
        ]);

        const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyRows, annualRows);
        state.aggregated = aggregated;
        state.acumulado = Core.buildAcumulado(aggregated);
        state.aeropuertos = aeropuertos;
        state.anios = aggregated.anios.slice().sort((a, b) => b - a);
        if (!state.anios.includes(state.anioSeleccionado)) {
            state.anioSeleccionado = state.anios[0] || new Date().getFullYear();
        }
        if (!state.anios.includes(state.anioComparar)) {
            state.anioComparar = null; // opt-in: sin comparar hasta que el usuario elija un año
        }
    }

    // Códigos de ruta → ciudad, para que el factor de ocupación diga "CANCÚN"
    // y no "CUN" (el informe oficial va por ciudad). Tabla chica y de catálogo:
    // no encarece la carga y se pide en paralelo con el resto.
    async function loadAeropuertos(client) {
        try {
            const rows = await fetchAllRows(client, 'catalogo_aeropuertos', 'iata,ciudad');
            const mapa = {};
            (rows || []).forEach((row) => {
                const codigo = String(row?.iata || '').trim().toUpperCase();
                const ciudad = String(row?.ciudad || '').trim();
                if (codigo && ciudad) mapa[codigo] = ciudad.toUpperCase();
            });
            return mapa;
        } catch (error) {
            console.info('[Informe Estadístico] Sin catálogo de aeropuertos:', error.message);
            return {};
        }
    }

    // Detalle de los últimos 15 días (hasta el día de corte). De esta única
    // consulta salen: factor de ocupación, cifras del día de corte y la alerta
    // de días sin captura.
    async function loadDetalle(client) {
        const hasta = state.corteIso;
        const desde = isoDateMinusDays(hasta, 14);
        state.ocupacionDesde = desde;
        state.ocupacionHasta = hasta;
        try {
            // .range explícito: sin él, PostgREST puede recortar la respuesta a
            // su límite por omisión y el factor saldría calculado a medias.
            const { data, error } = await client
                .from('v_informe_manifiestos_normalizado')
                .select(COLUMNAS_DETALLE)
                .gte('fecha_operacion', desde)
                .lte('fecha_operacion', hasta)
                .range(0, 49999);
            if (error) throw error;
            const rows = data || [];
            // Se resuelve el nombre de la ciudad ANTES de agrupar para que el
            // factor de ocupación quede ordenado por ciudad (como el informe
            // oficial) y no por código de ruta.
            rows.forEach((row) => { row.destino = nombreDestino(row.endpoint_code); });
            state.ocupacionRowsRaw = rows;
            state.ocupacion = Core.computeOccupancyFactors(rows);
            state.diaCorte = Core.aggregateDiaCorte(rows.filter((r) => String(r.fecha_operacion).slice(0, 10) === hasta));
            state.diaCorte.fecha = hasta;
        } catch (error) {
            console.info('[Informe Estadístico] Sin detalle diario disponible:', error.message);
            state.ocupacionRowsRaw = [];
            state.ocupacion = { rows: [], promedioGeneral: null };
            state.diaCorte = Core.aggregateDiaCorte([]);
            state.diaCorte.fecha = hasta;
        }
    }

    // Sólo el año seleccionado: la tabla de participación no usa los demás.
    // Traerlos todos daba varios miles de renglones, o sea ~7 páginas, y cada
    // página era una consulta completa a la vista (ver 028).
    async function loadAerolineas(client, anio) {
        try {
            state.aerolineaRowsRaw = await fetchAllRows(
                client, 'v_informe_estadistico_aerolinea', COLUMNAS_AEROLINEA,
                (q) => q.eq('anio', anio)
            );
            state.aerolineaAnioCargado = anio;
        } catch (error) {
            console.info('[Informe Estadístico] Sin participación por aerolínea:', error.message);
            state.aerolineaRowsRaw = [];
            state.aerolineaAnioCargado = null;
        }
    }

    // ── Datos que sólo usa el Resumen Estadístico ───────────────────────────
    // Se piden cuando se aprieta su botón, no al abrir la pestaña: son dos
    // consultas más que el Informe Estadístico no necesita.
    async function loadDatosResumen(client) {
        const [aerolineasPorAnio, fauna] = await Promise.all([
            loadAerolineasHistorico(client),
            loadFauna(client, state.corte.anio)
        ]);
        return { aerolineasPorAnio, fauna };
    }

    // Participación por aerolínea de TODOS los años, del histórico oficial
    // (airline_monthly_statistics) — no de manifiestos: igual que el desglose
    // mensual, los manifiestos no llegan a 2022.
    async function loadAerolineasHistorico(client) {
        const porAnio = new Map();
        try {
            const rows = await fetchAllRows(client, 'airline_monthly_statistics',
                'year,airline_code,airline_name,total_operations,total_passengers');
            (rows || []).forEach((row) => {
                const anio = Number(row?.year);
                if (!Number.isInteger(anio)) return;
                const nombre = String(row?.airline_name || row?.airline_code || 'SIN AEROLÍNEA').toUpperCase();
                if (!porAnio.has(anio)) porAnio.set(anio, new Map());
                const mapa = porAnio.get(anio);
                if (!mapa.has(nombre)) mapa.set(nombre, { aerolinea: nombre, ops: 0, pax: 0 });
                const item = mapa.get(nombre);
                item.ops += Core.toNumber(row.total_operations);
                item.pax += Core.toNumber(row.total_passengers);
            });
        } catch (error) {
            console.info('[Resumen Estadístico] Sin histórico por aerolínea:', error.message);
        }
        const salida = new Map();
        porAnio.forEach((mapa, anio) => {
            salida.set(anio, [...mapa.values()].sort((a, b) => b.pax - a.pax || b.ops - a.ops));
        });
        return salida;
    }

    // Capturas de fauna del año en curso, por mes y por clase (rescued_wildlife).
    const CLASES_FAUNA = { MAMIFERO: 'mamifero', REPTIL: 'reptil', AVE: 'ave' };
    async function loadFauna(client, anio) {
        try {
            const rows = await fetchAllRows(client, 'rescued_wildlife', 'date,class,quantity');
            const porMes = Core.MONTHS.map(() => ({ mamifero: 0, reptil: 0, ave: 0 }));
            const totales = { mamifero: 0, reptil: 0, ave: 0 };
            let acumulado = 0;
            (rows || []).forEach((row) => {
                const iso = String(row?.date || '').slice(0, 10);
                if (!iso) return;
                const cantidad = Core.toNumber(row.quantity) || 1;
                acumulado += cantidad;
                if (Number(iso.slice(0, 4)) !== Number(anio)) return;
                const clave = CLASES_FAUNA[Core.normalizaAerolinea(row.class)];
                if (!clave) return;
                const mes = Number(iso.slice(5, 7)) - 1;
                if (mes < 0 || mes > 11) return;
                porMes[mes][clave] += cantidad;
                totales[clave] += cantidad;
            });
            return { porMes, totales, acumulado };
        } catch (error) {
            console.info('[Resumen Estadístico] Sin capturas de fauna:', error.message);
            return null;
        }
    }

    // Hora de los datos que está sirviendo la vista materializada (028). Si la
    // migración todavía no se corrió, la tabla no existe: no es un error, sólo
    // significa que las vistas siguen siendo en vivo y no hay nada que mostrar.
    async function loadFrescura(client) {
        try {
            const { data, error } = await client
                .from('informe_estadistico_refresco')
                .select('refrescado_at')
                .maybeSingle();
            if (error) throw error;
            state.datosAl = data?.refrescado_at || null;
        } catch (_) {
            state.datosAl = null;
        }
    }

    // Pide al servidor recalcular las vistas materializadas. La función SQL
    // trae su propio freno (no recalcula si tiene menos de 2 minutos), así que
    // apretar "Actualizar" varias veces no cuesta nada.
    async function pedirRefresco(client) {
        try {
            const { error } = await client.rpc('refrescar_informe_estadistico', { p_forzar: false });
            if (error) throw error;
        } catch (error) {
            // Sin la migración 028 la función no existe y las vistas son en
            // vivo: recargar sin más ya trae lo último.
            console.info('[Informe Estadístico] Sin refresco materializado:', error.message);
        }
    }

    async function loadAprobacion(client) {
        try {
            const { data, error } = await client
                .from('informe_estadistico_aprobaciones')
                .select('*')
                .eq('periodo_tipo', 'anual')
                .eq('anio', state.anioSeleccionado)
                .maybeSingle();
            if (error) throw error;
            state.aprobacion = data || null;
        } catch (error) {
            state.aprobacion = null;
        }
    }

    // Aviso de carga en la barra de herramientas. La pestaña ya no se queda
    // muda mientras corre la consulta pesada: primero aparece el informe y
    // luego se completa el detalle diario.
    function setBusy(texto) {
        const el = $('informe-est-cargando');
        if (!el) return;
        el.classList.toggle('d-none', !texto);
        el.innerHTML = texto
            ? `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>${escapeHtml(texto)}`
            : '';
    }

    function load() {
        if (state.loaded) return Promise.resolve();
        if (state.loadingPromise) return state.loadingPromise;
        state.corteIso = state.corteIso || corteIsoPorOmision();
        state.corte = parseIsoDate(state.corteIso);
        setBusy('Cargando informe…');
        state.loadingPromise = (async () => {
            const client = await getClient();
            await loadCore(client);
            renderAll();                       // el grueso del informe ya se ve
            setBusy('Calculando detalle diario…');
            await Promise.all([
                loadDetalle(client),
                loadAerolineas(client, state.anioSeleccionado),
                loadAprobacion(client)
            ]);
            renderDetalle();
            renderAerolinea();
            renderAprobacion();
        })()
            .catch((error) => {
                console.error('No se pudo cargar el Informe Estadístico:', error);
                renderError('No se pudo cargar el Informe Estadístico. Intenta recargar.');
            })
            .finally(() => {
                setBusy(null);
                state.loaded = true;
                state.loadingPromise = null;
            });
        return state.loadingPromise;
    }

    // "Actualizar" no sólo relee: primero le pide al servidor recalcular las
    // vistas materializadas (028), que es lo que hace que el dato avance.
    async function reload() {
        state.loaded = false;
        state.diaCorte = null;
        state.aerolineaAnioCargado = null;
        state.corteIso = corteIsoPorOmision();
        setBusy('Actualizando datos…');
        try {
            const client = await getClient();
            await pedirRefresco(client);
        } catch (error) {
            console.info('[Informe Estadístico] No se pudo pedir el refresco:', error.message);
        }
        await load();
    }

    // ── Render ───────────────────────────────────────────────────────────────
    function renderError(message) {
        const el = $('informe-est-error');
        if (el) { el.textContent = message; el.classList.remove('d-none'); }
        $('informe-est-root')?.classList.add('d-none');
    }

    // Las vistas del informe están materializadas (028): los datos pueden ir
    // unos minutos atrás de maestra_operaciones. Se muestra la hora de corte
    // para que eso sea visible y no una sorpresa.
    function renderFrescura() {
        const el = $('informe-est-frescura');
        if (!el) return;
        if (!state.datosAl) { el.classList.add('d-none'); el.textContent = ''; return; }
        const fecha = new Date(state.datosAl);
        el.classList.remove('d-none');
        el.textContent = `Datos al ${fecha.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`;
        el.title = 'Hora del último recálculo del informe. "Actualizar" lo recalcula.';
    }

    function renderAll() {
        $('informe-est-error')?.classList.add('d-none');
        $('informe-est-root')?.classList.remove('d-none');
        renderFrescura();
        configureYearSelect();
        configureCompararSelect();
        renderAcumulado();
        renderMensual();
        renderAerolinea();
        renderAprobacion();
        renderComparativa();
        renderProyeccion();
        renderChart();
        renderDetalle();
    }

    // Todo lo que depende de la consulta pesada de los últimos 15 días. Se
    // vuelve a pintar cuando esa tanda termina.
    function renderDetalle() {
        renderDiaCorte();
        renderOcupacion();
        renderAlertas();
    }

    function configureYearSelect() {
        const select = $('informe-est-anio');
        if (!select) return;
        select.innerHTML = state.anios.map((anio) => `<option value="${anio}">${anio}</option>`).join('');
        select.value = String(state.anioSeleccionado || '');
        select.onchange = () => {
            state.anioSeleccionado = Number(select.value);
            // La participación por aerolínea se pide por año, así que cambiar
            // de año exige volver a pedirla (antes venían todos los años de un
            // jalón, que era justo lo caro).
            const anio = state.anioSeleccionado;
            const client = window.supabaseClient;
            renderMensual();
            renderProyeccion();
            renderChart();
            if (!client) return;
            state.aerolineaRowsRaw = [];
            state.aerolineaAnioCargado = null;
            renderAerolinea();
            Promise.all([loadAprobacion(client), loadAerolineas(client, anio)]).finally(() => {
                if (state.anioSeleccionado !== anio) return; // llegó tarde: ya cambió otra vez
                renderAerolinea();
                renderAprobacion();
            });
        };
    }

    // ── Herramienta 1: comparativa año contra año ───────────────────────────
    function configureCompararSelect() {
        const select = $('informe-est-anio-comparar');
        if (!select) return;
        const opciones = ['<option value="">Sin comparar</option>']
            .concat(state.anios.map((anio) => `<option value="${anio}">${anio}</option>`));
        select.innerHTML = opciones.join('');
        select.value = state.anioComparar ? String(state.anioComparar) : '';
        select.onchange = () => {
            state.anioComparar = select.value ? Number(select.value) : null;
            renderComparativa();
        };
    }

    function renderComparativa() {
        const host = $('informe-est-comparativa');
        const thead = document.querySelector('#informe-est-tabla-comparativa thead');
        const tbody = document.querySelector('#informe-est-tabla-comparativa tbody');
        if (!host || !thead || !tbody) return;
        if (!state.anioComparar || state.anioComparar === state.anioSeleccionado) {
            host.classList.add('d-none');
            return;
        }
        host.classList.remove('d-none');
        const comparacion = Core.compareYears(state.aggregated, state.anioSeleccionado, state.anioComparar);
        thead.innerHTML = `<tr><th>Indicador</th><th class="text-end">${comparacion.anioA}</th><th class="text-end">${comparacion.anioB}</th><th class="text-end">Variación</th></tr>`;
        tbody.innerHTML = comparacion.rows.map((row) => {
            const arriba = Number.isFinite(row.variacion) && row.variacion > 0;
            const abajo = Number.isFinite(row.variacion) && row.variacion < 0;
            const icono = arriba ? '<i class="fas fa-arrow-up text-success me-1"></i>' : (abajo ? '<i class="fas fa-arrow-down text-danger me-1"></i>' : '');
            return `<tr>
                <td>${escapeHtml(row.label)}</td>
                <td class="text-end">${fmt(row.a)}</td>
                <td class="text-end">${fmt(row.b)}</td>
                <td class="text-end">${icono}${pctFormat(row.variacion)}</td>
            </tr>`;
        }).join('');
    }

    // ── Herramienta 2: proyección de cierre ─────────────────────────────────
    function renderProyeccion() {
        const host = $('informe-est-proyeccion');
        if (!host) return;
        const now = new Date();
        const anio = state.anioSeleccionado;
        if (anio !== now.getFullYear()) {
            host.classList.add('d-none');
            host.innerHTML = '';
            return;
        }
        host.classList.remove('d-none');
        const mes = now.getMonth() + 1;
        const diaCorte = now.getDate();
        const diaDelAnio = Core.dayOfYear(anio, mes, diaCorte);
        const mesProy = Core.projectMonthClosure(state.aggregated, anio, mes, diaCorte);
        const anioProy = Core.projectYearClosure(state.aggregated, anio, diaDelAnio);
        const monthName = Core.MONTHS[mes - 1]?.name || '';
        const card = (titulo, sub, proy) => `
            <div class="airline-stat-card">
                <span>${escapeHtml(titulo)}</span>
                <strong>${fmt((proy.comercial.opsProyectado || 0) + (proy.general.opsProyectado || 0))} ops. proyectadas</strong>
                <small>${escapeHtml(sub)}</small>
                <small>Comercial ${fmt(proy.comercial.opsActual)} → ${fmt(proy.comercial.opsProyectado)} · Carga ${fmt(proy.carga.opsActual)} → ${fmt(proy.carga.opsProyectado)}</small>
            </div>`;
        host.innerHTML = card(`Proyección de cierre — ${monthName} ${anio}`, `Al día ${diaCorte} de ${mesProy.totalDias}`, mesProy)
            + card(`Proyección de cierre — Año ${anio}`, `Día ${diaDelAnio} de ${anioProy.totalDias}`, anioProy);
    }

    // ── Herramienta 3: gráfica de barras del desglose mensual ───────────────
    function renderChart() {
        const canvas = $('informe-est-chart-mensual');
        if (!canvas || !window.Chart || !state.aggregated) return;
        const serie = Core.buildMonthlySeries(state.aggregated, state.anioSeleccionado);
        if (state.chart) { state.chart.destroy(); state.chart = null; }
        state.chart = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels: serie.labels,
                datasets: [
                    { label: 'Comercial', data: serie.comercialOps, backgroundColor: '#0d6efd' },
                    { label: 'General', data: serie.generalOps, backgroundColor: '#20c997' },
                    { label: 'Carga', data: serie.cargaOps, backgroundColor: '#fd7e14' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }

    // ── Herramienta 4: alertas de días sin captura ──────────────────────────
    function renderAlertas() {
        const host = $('informe-est-alertas');
        if (!host) return;
        const faltantes = Core.findMissingDays(state.ocupacionRowsRaw, state.ocupacionDesde, state.ocupacionHasta);
        if (!faltantes.length) {
            host.classList.add('d-none');
            host.innerHTML = '';
            return;
        }
        host.classList.remove('d-none');
        host.innerHTML = `<i class="fas fa-triangle-exclamation me-2"></i>` +
            `${faltantes.length} día(s) sin ningún manifiesto capturado en los últimos 15 días: ` +
            `${faltantes.map((f) => escapeHtml(f)).join(', ')} — revisar si falta captura.`;
    }

    function respaldoNota(counters) {
        const n = counters?.opsRespaldoItinerario || 0;
        return n > 0 ? `<small class="text-warning">${fmt(n)} de itinerario, aún sin conciliar</small>` : '';
    }

    function renderAcumulado() {
        const host = $('informe-est-acumulado');
        if (!host || !state.acumulado) return;
        const a = state.acumulado;
        host.innerHTML = `
            <div class="airline-stat-card">
                <span>Operaciones Comercial + General</span>
                <strong>${fmt(a.totalOperaciones)}</strong>
                <small>Comercial ${fmt(a.comercial.ops)} · General ${fmt(a.general.ops)}</small>
                ${respaldoNota(a.comercial)}
            </div>
            <div class="airline-stat-card">
                <span>Pasajeros transportados</span>
                <strong>${fmt(a.totalPasajeros)}</strong>
                <small>Comercial ${fmt(a.comercial.pax)} · General ${fmt(a.general.pax)}</small>
            </div>
            <div class="airline-stat-card">
                <span>Operaciones de Carga</span>
                <strong>${fmt(a.carga.ops)}</strong>
                <small>${kgFormat.format((a.carga.kg || 0) / 1000)} toneladas</small>
                ${respaldoNota(a.carga)}
            </div>`;
    }

    function renderDiaCorte() {
        const host = $('informe-est-dia');
        if (!host) return;
        if (!state.diaCorte) {
            host.innerHTML = '<div class="airline-stat-card"><span>Cifras del día de corte</span><strong class="text-muted">Calculando…</strong></div>';
            return;
        }
        const d = state.diaCorte;
        host.innerHTML = `
            <div class="airline-stat-card">
                <span>Cifras del día (${escapeHtml(d.fecha || state.corteIso || todayIso())})</span>
                <strong>${fmt(d.comercial.ops + d.carga.ops)} ops.</strong>
                <small>Comercial ${fmt(d.comercial.ops)} (${fmt(d.comercial.pax)} pax) · Carga ${fmt(d.carga.ops)} (${kgFormat.format((d.carga.kg || 0) / 1000)} t)</small>
                <small class="text-muted">Aviación General: sin corte diario (fuente oficial mensual).</small>
            </div>`;
    }

    function renderMensual() {
        const thead = document.querySelector('#informe-est-tabla-mensual thead');
        const tbody = document.querySelector('#informe-est-tabla-mensual tbody');
        if (!thead || !tbody) return;
        thead.innerHTML = `<tr>
            <th>Mes</th><th>Tipo</th>
            <th class="text-end">Ops. Nac.</th><th class="text-end">Ops. Int.</th><th class="text-end">Ops. Total</th>
            <th class="text-end">Pax. Nac.</th><th class="text-end">Pax. Int.</th><th class="text-end">Pax. Total</th>
        </tr>`;
        const anio = state.anioSeleccionado;
        const rows = [];
        Core.MONTHS.forEach((month) => {
            const entry = state.aggregated?.porAnioMes?.get(`${anio}-${month.number}`);
            if (!entry) return;
            Core.TIPOS.forEach((tipo) => {
                const c = entry[tipo];
                if (!c || c.ops === 0) return;
                // La cifra mensual oficial no trae desglose Nacional/
                // Internacional; se marca con "—" en vez de fingir un cero que
                // no sumaría con el total.
                const oficial = c.fuente === 'oficial';
                const desglose = (valor) => oficial ? '<span class="text-muted">—</span>' : fmt(valor);
                rows.push(`<tr>
                    <td>${month.name}</td>
                    <td class="text-capitalize">${tipo}</td>
                    <td class="text-end">${desglose(c.opsNacional)}</td>
                    <td class="text-end">${desglose(c.opsInternacional)}</td>
                    <td class="text-end fw-bold">${fmt(c.ops)}</td>
                    <td class="text-end">${desglose(c.paxNacional)}</td>
                    <td class="text-end">${desglose(c.paxInternacional)}</td>
                    <td class="text-end fw-bold">${fmt(c.pax)}</td>
                </tr>`);
            });
        });
        tbody.innerHTML = rows.join('') || '<tr><td colspan="8" class="text-center text-muted">Sin datos capturados para este año.</td></tr>';
    }

    function renderAerolinea() {
        const thead = document.querySelector('#informe-est-tabla-aerolinea thead');
        const tbody = document.querySelector('#informe-est-tabla-aerolinea tbody');
        if (!thead || !tbody) return;
        const result = Core.aggregateAerolinea(state.aerolineaRowsRaw, state.anioSeleccionado);
        thead.innerHTML = `<tr>
            <th>Aerolínea</th><th>Tipo</th>
            <th class="text-end">Operaciones</th><th class="text-end">Part. Ops.</th>
            <th class="text-end">Pasajeros</th><th class="text-end">Part. Pax.</th>
        </tr>`;
        // Esta tabla se pide por año: mientras el año que se está mostrando no
        // sea el que ya se cargó, lo que hay en memoria no corresponde.
        if (state.aerolineaAnioCargado !== state.anioSeleccionado) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Calculando…</td></tr>';
            return;
        }
        tbody.innerHTML = result.rows.map((item) => `<tr>
            <td class="fw-semibold">${escapeHtml(item.aerolinea)}</td>
            <td class="text-capitalize">${item.tipo}</td>
            <td class="text-end">${fmt(item.ops)}</td>
            <td class="text-end">${pctFormat(item.participacionOps)}</td>
            <td class="text-end">${fmt(item.pax)}</td>
            <td class="text-end">${pctFormat(item.participacionPax)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted">Sin datos para este año.</td></tr>';
    }

    function renderOcupacion() {
        const thead = document.querySelector('#informe-est-tabla-ocupacion thead');
        const tbody = document.querySelector('#informe-est-tabla-ocupacion tbody');
        if (!thead || !tbody) return;
        const result = state.ocupacion || { rows: [], promedioGeneral: null };
        thead.innerHTML = `<tr><th>Aerolínea</th><th>Destino</th>
            <th class="text-end">De salida</th><th class="text-end">De llegada</th><th class="text-end">Total</th></tr>`;
        if (!state.diaCorte) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Calculando…</td></tr>';
            return;
        }
        tbody.innerHTML = result.rows.map((item) => `<tr>
            <td class="fw-semibold">${escapeHtml(item.aerolinea)}</td>
            <td>${escapeHtml(nombreDestino(item.destino))}</td>
            <td class="text-end">${pctFormat(item.factorSalida)}</td>
            <td class="text-end">${pctFormat(item.factorLlegada)}</td>
            <td class="text-end fw-bold">${pctFormat(item.factorTotal)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted">Sin vuelos con matrícula/capacidad conocida en los últimos 15 días.</td></tr>';
        const promedio = $('informe-est-ocupacion-promedio');
        if (promedio) promedio.textContent = `Promedio general: ${pctFormat(result.promedioGeneral)}`;
    }

    function renderAprobacion() {
        const badge = $('informe-est-visto-bueno-badge');
        const btn = $('informe-est-btn-visto-bueno');
        const allowed = canApprove();
        if (btn) btn.classList.toggle('d-none', !allowed);
        if (!badge) return;
        if (state.aprobacion?.validado) {
            const fecha = state.aprobacion.validado_at ? new Date(state.aprobacion.validado_at).toLocaleString('es-MX') : '';
            badge.innerHTML = `<i class="fas fa-check-circle me-1"></i>Visto bueno de ${escapeHtml(state.aprobacion.validado_por || '')} · ${escapeHtml(fecha)}`;
            badge.classList.remove('d-none');
            badge.classList.add('text-success');
        } else {
            badge.innerHTML = '<i class="fas fa-clock me-1"></i>Pendiente de visto bueno';
            badge.classList.remove('d-none', 'text-success');
        }
    }

    // ── Exportación ──────────────────────────────────────────────────────────
    function csvCell(value) {
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    function toCsv(sections) {
        return sections.map(({ title, rows }) => [
            csvCell(title),
            ...rows.map((row) => row.map(csvCell).join(','))
        ].join('\r\n')).join('\r\n\r\n');
    }

    function collectSections() {
        const aerolineaAgg = Core.aggregateAerolinea(state.aerolineaRowsRaw, state.anioSeleccionado);
        const sections = [
            { title: `Acumulados — Informe Estadístico`, rows: Core.buildAcumuladoRows(state.acumulado) },
            { title: `Desglose mensual ${state.anioSeleccionado}`, rows: Core.buildMensualRows(state.aggregated, state.anioSeleccionado) },
            { title: `Participación por aerolínea ${state.anioSeleccionado}`, rows: Core.buildAerolineaRows(aerolineaAgg) },
            { title: 'Factor de ocupación (últimos 15 días)', rows: Core.buildOcupacionRows(state.ocupacion || { rows: [] }) }
        ];
        if (state.anioComparar && state.anioComparar !== state.anioSeleccionado) {
            const comparacion = Core.compareYears(state.aggregated, state.anioSeleccionado, state.anioComparar);
            sections.push({ title: `Comparativa ${comparacion.anioA} vs ${comparacion.anioB}`, rows: Core.buildComparativaRows(comparacion) });
        }
        const now = new Date();
        if (state.anioSeleccionado === now.getFullYear()) {
            const proy = Core.projectYearClosure(state.aggregated, state.anioSeleccionado, Core.dayOfYear(now.getFullYear(), now.getMonth() + 1, now.getDate()));
            sections.push({ title: `Proyección de cierre ${state.anioSeleccionado}`, rows: Core.buildProyeccionRows(proy) });
        }
        return sections;
    }

    function exportCsv() {
        if (!state.aggregated) return;
        const csv = toCsv(collectSections());
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, `informe_estadistico_${state.anioSeleccionado || 'periodo'}.csv`);
    }

    async function exportExcel() {
        if (!state.aggregated || typeof ExcelJS === 'undefined') return;
        const workbook = new ExcelJS.Workbook();
        collectSections().forEach(({ title, rows }) => {
            const sheet = workbook.addWorksheet(title.slice(0, 31));
            rows.forEach((row) => sheet.addRow(row));
            const headerRow = sheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1F44' } };
                cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            });
            sheet.columns.forEach((col) => { col.width = 22; });
        });
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (typeof saveAs === 'function') saveAs(blob, `informe_estadistico_${state.anioSeleccionado || 'periodo'}.xlsx`);
    }

    // ── Plantilla impresa del Informe Estadístico oficial (para el PDF) ────
    // Reproduce el documento AUTORIZADO ("Original (bueno).pdf"): hoja tamaño
    // OFICIO vertical, banda de sección crema con texto azul marino, bloque
    // OPERACIONES en beige y bloque PASAJEROS/TONELADAS en azul, columna MES
    // con trama, filetes SOLO verticales entre columnas y tabla cronológica
    // angosta debajo de cada desglose.
    //
    // La paleta y los anchos NO están puestos a ojo: se midieron sobre el PDF
    // de referencia rasterizado (muestreo de píxel). Si hay que retocar algo,
    // conviene volver a medir en vez de tantear.
    const C = {
        tan:    '#D4C19C', // fila de años del lado OPERACIONES y celda "MES"
        tanHdr: '#DDCEB1', // encabezado OPERACIONES de las tablas chicas
        cream:  '#F3ECDD', // súper-encabezado OPERACIONES y ACUMULADO (ops)
        navy:   '#0D1F2D', // fila de años del lado PASAJEROS y texto oscuro
        blue:   '#DEEBF7', // súper-encabezado PASAJEROS y ACUMULADO (pax)
        band:   '#ECE4D4', // banda de sección (AVIACIÓN COMERCIAL…)
        cell:   '#F2F2F2', // fondo de las celdas de datos
        total:  '#DADADA', // fila TOTAL POR AÑO
        gray:   '#BFBFBF', // etiqueta ACUMULADO / TOTAL
        big:    '#9D2449', // guinda de los números grandes
        rule:   '#595959', // filetes verticales entre columnas
        maroon: '#800000', // encabezados de Puntos de Conexión
        zebra:  '#F2F2F2', // trama de la columna MES
        zebraPuntos: '#E9E1C9' // renglones alternos de Puntos de Conexión
    };

    // Ancho del "papel" en px: el PDF escala esta hoja al ancho útil de una
    // página oficio, así que este número fija la DENSIDAD (qué tan alta es una
    // fila respecto del ancho de la hoja), no el tamaño final impreso.
    const HOJA_W = 760;

    // Tamaño de página del documento autorizado: OFICIO (legal, 215.9×355.6 mm)
    // con márgenes de ~17.6 mm a los lados. Con A4 las tablas salían más
    // apretadas y el corte de página no coincidía con el original.
    const PDF_PAGINA = { formato: 'legal', margenX: 17.6, margenSup: 9, margenInf: 10 };

    // Toneladas SIEMPRE con dos decimales ("0.00", "33,787.30"), como el
    // original — kgFormat (el del tablero) omite los ceros a la derecha.
    const tonFormat = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function formatDateLong(date) {
        return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    function isoToLong(iso) {
        if (!iso) return '';
        const d = new Date(`${iso}T12:00:00`);
        return Number.isNaN(d.getTime()) ? String(iso) : formatDateLong(d);
    }

    const cellStyle = (extra) => `font-size:5.9px;line-height:1.35;padding:0 3px;border:0;${extra || ''}`;
    const th = (t, x) => `<th style="${cellStyle(x)}">${t}</th>`;
    const td = (t, x) => `<td style="${cellStyle(x)}">${t}</td>`;
    const VL = `border-left:1px solid ${C.rule};`;   // filete vertical izquierdo
    const VR = `border-right:1px solid ${C.rule};`;  // filete vertical derecho

    // Banda de sección: crema, texto azul marino centrado, sin filetes.
    function bandaHtml(titulo) {
        return `<div style="background:${C.band};color:${C.navy};text-align:center;font-weight:700;font-size:7.2px;padding:2px 0;margin:8px 0 5px;letter-spacing:.2px;">${escapeHtml(titulo)}</div>`;
    }

    // "Cifras del <fecha>": etiqueta a la izquierda (dos renglones, alineada a
    // la derecha) y las dos métricas como columnas — encabezado OPERACIONES en
    // beige, el otro en azul claro, valores sobre trama gris.
    function cifrasDelDiaHtml(fechaTexto, ops, secTexto, secValor) {
        return `
            <table style="border-collapse:collapse;width:36%;table-layout:fixed;">
                <colgroup><col style="width:44%"><col style="width:28%"><col style="width:28%"></colgroup>
                <tr>
                    <td rowspan="2" style="${cellStyle(`padding-right:10px;font-size:6.1px;font-weight:700;color:${C.navy};text-align:right;line-height:1.5;`)}">Cifras del<br>${escapeHtml(fechaTexto)}</td>
                    ${th('OPERACIONES', `background:${C.tanHdr};color:${C.navy};text-align:center;font-weight:700;`)}
                    ${th(secTexto, `background:${C.blue};color:${C.navy};text-align:center;font-weight:700;`)}
                </tr>
                <tr>
                    ${td(fmt(ops), `background:${C.cell};text-align:center;`)}
                    ${td(secValor, `background:${C.cell};text-align:center;`)}
                </tr>
            </table>`;
    }

    // Desglose mensual: MES por renglón; OPERACIONES y PASAJEROS/TONELADAS
    // como súper-columnas, con un año por sub-columna dentro de cada una.
    // ACUMULADO es un gran total fusionado por súper-columna (no una suma
    // corrida por año).
    function tablaAnioHtml(pivot, unidadSecundaria) {
        const anios = pivot.anios;
        if (!anios.length) return '<p style="font-size:6px;color:#777;">Sin datos.</p>';
        const n = anios.length;
        const esKg = unidadSecundaria === 'kg';
        const etiqueta2 = esKg ? 'TONS. TRANSPORTADAS' : 'PASAJEROS';
        const val2 = (c) => esKg ? tonFormat.format((c.kg || 0) / 1000) : fmt(c.pax);

        // El colgroup manda sobre los width de las celdas: la primera fila
        // lleva colspan, así que sin colgroup los anchos no se aplicaban y la
        // franja separadora entre los dos bloques se inflaba.
        // El reparto NO es simétrico: en el original el bloque OPERACIONES es
        // más ancho que el de PASAJEROS (47.2% contra 37.2% de la hoja).
        const colsOps = anios.map(() => `<col style="width:${(47.2 / n).toFixed(3)}%">`).join('');
        const colsSec = anios.map(() => `<col style="width:${(37.2 / n).toFixed(3)}%">`).join('');
        const colgroup = `<colgroup><col style="width:15%">${colsOps}<col style="width:0.6%">${colsSec}</colgroup>`;
        const hueco = '<td style="border:0;padding:0;"></td>';
        const huecoTh = '<th style="border:0;padding:0;"></th>';

        // En el original los renglones NO llevan filetes horizontales: sólo
        // separadores verticales entre columnas, y cada bloque cierra con un
        // filete a la derecha de su última columna.
        const grupo = (render, fondo, extra) => anios.map((a, i) =>
            td(render(a), `background:${fondo};text-align:center;${VL}${i === n - 1 ? VR : ''}${extra || ''}`)).join('');

        const cabeceraGrupos = `<tr>${th('', 'border:0;')}`
            + `<th style="${cellStyle(`background:${C.cream};color:${C.navy};text-align:center;font-weight:700;`)}" colspan="${n}">OPERACIONES</th>`
            + huecoTh
            + `<th style="${cellStyle(`background:${C.blue};color:${C.navy};text-align:center;font-weight:700;`)}" colspan="${n}">${etiqueta2}</th></tr>`;

        const anioTh = (a, fondo, color, i) => th(a, `background:${fondo};color:${color};text-align:center;font-weight:700;${VL}${i === n - 1 ? VR : ''}`);
        const cabeceraAnios = `<tr>${th('MES', `background:${C.tan};color:${C.navy};text-align:center;font-weight:700;`)}`
            + anios.map((a, i) => anioTh(a, C.tan, C.navy, i)).join('')
            + huecoTh
            + anios.map((a, i) => anioTh(a, C.navy, '#FFFFFF', i)).join('') + '</tr>';

        const cuerpo = pivot.rows.map((r, idx) =>
            `<tr>${td(escapeHtml(r.mes).toUpperCase(), `background:${idx % 2 === 0 ? C.zebra : '#FFFFFF'};color:${C.navy};text-align:center;font-weight:700;`)}`
            + grupo((a) => fmt(r.celdas[a].ops), C.cell)
            + hueco
            + grupo((a) => val2(r.celdas[a]), C.cell) + '</tr>').join('');

        const totalRow = `<tr>${td('TOTAL POR AÑO', `background:${C.total};color:${C.navy};text-align:center;font-weight:700;`)}`
            + grupo((a) => fmt(pivot.totalPorAnio[a].ops), C.total, 'font-weight:700;')
            + hueco
            + grupo((a) => val2(pivot.totalPorAnio[a]), C.total, 'font-weight:700;') + '</tr>';

        const acumRow = `<tr>${td('ACUMULADO', `background:${C.gray};color:${C.navy};text-align:center;font-weight:700;`)}`
            + `<td style="${cellStyle(`background:${C.cream};text-align:center;font-weight:700;${VL}${VR}`)}" colspan="${n}">${fmt(pivot.totalGeneral.ops)}</td>`
            + hueco
            + `<td style="${cellStyle(`background:${C.blue};text-align:center;font-weight:700;${VL}${VR}`)}" colspan="${n}">${val2(pivot.totalGeneral)}</td></tr>`;

        return `<table style="border-collapse:collapse;width:100%;table-layout:fixed;">${colgroup}${cabeceraGrupos}${cabeceraAnios}${cuerpo}${totalRow}${acumRow}</table>`;
    }

    // Tabla cronológica secundaria (años cerrados, mes en curso, día de corte,
    // TOTAL). Angosta y pegada a la izquierda, como en el original.
    function tablaCronologicaHtml(rows, unidadSecundaria) {
        const esKg = unidadSecundaria === 'kg';
        const etiqueta2 = esKg ? 'TONELADAS' : 'PASAJEROS';
        const cuerpo = rows.map((r) => {
            const esTotal = r.label === 'TOTAL';
            const v2 = esKg ? tonFormat.format((r.kg || 0) / 1000) : fmt(r.pax);
            const negrita = esTotal ? 'font-weight:700;' : '';
            return `<tr>
                ${td(escapeHtml(r.label), `background:${esTotal ? C.gray : C.cell};color:${C.navy};text-align:center;font-weight:700;`)}
                ${td(fmt(r.ops), `background:${esTotal ? C.cream : '#FFFFFF'};text-align:center;${VL}${negrita}`)}
                ${td(v2, `background:${esTotal ? C.blue : '#FFFFFF'};text-align:center;${VL}${VR}${negrita}`)}
            </tr>`;
        }).join('');
        return `
            <table style="border-collapse:collapse;width:36%;table-layout:fixed;margin-top:6px;">
                <colgroup><col style="width:42%"><col style="width:36%"><col style="width:22%"></colgroup>
                <tr>
                    ${th('', 'border:0;')}
                    ${th('OPERACIONES', `background:${C.tanHdr};color:${C.navy};text-align:center;font-weight:700;${VL}`)}
                    ${th(etiqueta2, `background:${C.blue};color:${C.navy};text-align:center;font-weight:700;${VL}${VR}`)}
                </tr>
                ${cuerpo}
            </table>`;
    }

    function seccionTipoHtml(titulo, tipo, unidadSecundaria, diaCorteCounters, corte) {
        const anios = state.anios;
        const pivot = Core.buildTablaMensualPorAnios(state.aggregated, tipo, anios);
        const cronologico = Core.buildResumenCronologico(state.aggregated, tipo, anios, corte, diaCorteCounters);
        const esKg = unidadSecundaria === 'kg';
        const secTexto = esKg ? 'TONELADAS' : 'PASAJEROS';
        const secValor = diaCorteCounters
            ? (esKg ? tonFormat.format((diaCorteCounters.kg || 0) / 1000) : fmt(diaCorteCounters.pax))
            : 'N/D';
        const fechaCorte = formatDateLong(new Date(corte.anio, corte.mes - 1, corte.dia));
        return `
            ${bandaHtml(titulo)}
            <div style="margin:4px 0 6px;">${cifrasDelDiaHtml(fechaCorte, diaCorteCounters ? diaCorteCounters.ops : 0, secTexto, secValor)}</div>
            <div style="font-size:6.1px;font-weight:700;color:${C.navy};margin:0 0 4px;">Desglose mensual por año:</div>
            ${tablaAnioHtml(pivot, unidadSecundaria)}
            ${tablaCronologicaHtml(cronologico, unidadSecundaria)}`;
    }

    // Colores pastel por aerolínea del documento autorizado (muestreados del
    // PDF de referencia). Se comparan normalizados porque el nombre llega del
    // catálogo y varía ("Aeroméxico" / "AEROMEXICO" / "Viva Aerobus").
    const OCUPACION_COLORES = {
        AEROMEXICO: '#EAF3FA', 'AEROMEXICO CONNECT': '#EAF3FA',
        VOLARIS: '#EDE2F6',
        'VIVA AEROBUS': '#E2EFDA', VIVAAEROBUS: '#E2EFDA',
        'AEROLINEA EM': '#A9D08E',
        CONVIASA: '#FCE4D6', ARAJET: '#CC99FF',
        AERUS: '#D0CECE', 'MEXICANA DE AVIACION': '#D0CECE'
    };
    const colorAerolinea = (nombre) => OCUPACION_COLORES[Core.normalizaAerolinea(nombre)] || '#FFFFFF';

    // El informe oficial nombra el destino por CIUDAD ("CANCÚN"), no por el
    // código de la ruta ("CUN"). El mapa sale de catalogo_aeropuertos, que ya
    // usa el resto de la app; si un código no está catalogado se deja tal cual.
    function nombreDestino(codigo) {
        const key = String(codigo || '').trim().toUpperCase();
        return (state.aeropuertos && state.aeropuertos[key]) || key;
    }

    function factorOcupacionHtml() {
        const ocup = state.ocupacion || { rows: [], promedioGeneral: null };
        if (!ocup.rows.length) return '<p style="font-size:6px;color:#777;">Sin datos de ocupación en el periodo.</p>';
        const grupos = [];
        ocup.rows.forEach((item) => {
            const last = grupos[grupos.length - 1];
            if (last && last.aerolinea === item.aerolinea) last.destinos.push(item);
            else grupos.push({ aerolinea: item.aerolinea, destinos: [item] });
        });
        const cuerpo = grupos.map((g) => {
            const bg = colorAerolinea(g.aerolinea);
            return g.destinos.map((item, i) => `<tr>
                ${i === 0 ? `<td style="${cellStyle(`background:${bg};color:${C.navy};font-weight:700;text-align:center;vertical-align:middle;`)}" rowspan="${g.destinos.length}">${escapeHtml(g.aerolinea).toUpperCase()}</td>` : ''}
                ${td(escapeHtml(nombreDestino(item.destino)), `background:${C.cell};color:${C.navy};`)}
                ${td(pctFormat(item.factorSalida), 'text-align:center;')}
                ${td(pctFormat(item.factorLlegada), 'text-align:center;')}
                ${td(pctFormat(item.factorTotal), 'text-align:center;font-weight:700;')}
            </tr>`).join('');
        }).join('');
        const hd = `background:${C.navy};color:#fff;text-align:center;font-weight:700;`;
        return `
            <div style="width:54%;">
                <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
                    <colgroup><col style="width:28%"><col style="width:24%"><col style="width:16%"><col style="width:16%"><col style="width:16%"></colgroup>
                    <tr>${th('AEROLÍNEA', hd)}${th('DESTINO', hd)}${th('DE SALIDA', hd)}${th('DE LLEGADA', hd)}${th('TOTAL', hd)}</tr>
                    ${cuerpo}
                </table>
                <div style="font-size:5.9px;margin-top:3px;text-align:right;color:${C.navy};">Promedio General: ${pctFormat(ocup.promedioGeneral)}</div>
            </div>`;
    }

    // ── Puntos de conexión AIFA-CDMX / Edo. Méx. / Rutas foráneas ───────────
    // Dato ESTÁTICO institucional (transporte terrestre, costos, empresas): no
    // viene de manifiestos ni de ninguna vista de este módulo — se transcribió
    // del documento de referencia. El costo en USD se CALCULA con un tipo de
    // cambio fijo (17.42, el que se deduce del propio documento) en vez de
    // transcribir dos cifras por fila y duplicar el riesgo de error.
    const USD_RATE = 17.42;
    const usd = (mxn) => `$${(mxn / USD_RATE).toFixed(2)}`;

    const PUNTOS_CDMX = [
        { lugar: 'Central del Norte', tiempo: '45 Min.', ahorro: '23 Min.', filas: [
            { costo: 130, empresa: 'ECO ELITE', frec: 4 }, { costo: 93, empresa: 'FUTURA', frec: 2 },
            { costo: 94, empresa: 'ADO', frec: 3 }, { costo: 90, empresa: 'COSTA LINE', frec: 2 },
            { costo: 95, empresa: 'PEGASSO', frec: 18 }
        ] },
        { lugar: 'Central del Sur', tiempo: '60 Min.', ahorro: '18 Min.', filas: [{ costo: 140, empresa: 'PEGASSO', frec: 10 }] },
        { lugar: 'Central TAPO', tiempo: '40 Min.', ahorro: '15 Min.', filas: [{ costo: 178, empresa: 'ADO', frec: 42 }] },
        { lugar: 'Central de Autobuses Observatorio', tiempo: '60 Min.', ahorro: '', filas: [{ costo: 185, empresa: 'FLECHA ROJA', frec: 2 }] },
        { lugar: 'AICM', tiempo: '40 Min.', ahorro: '15 Min.', filas: [{ costo: 178, empresa: 'ADO', frec: 42 }] },
        { lugar: 'Indios Verdes', tiempo: '35 Min.', ahorro: '12 Min.', filas: [
            { costo: 82, empresa: 'ADO', frec: 3 }, { costo: 93, empresa: 'FUTURA', frec: 2 }
        ] },
        { lugar: 'La Condesa (Parque España)', tiempo: '55 Min.', ahorro: '', filas: [{ costo: 150, empresa: 'ECO ELITE', frec: 6 }] },
        { lugar: 'La Roma (Plaza Luis Cabrera)', tiempo: '55 Min.', ahorro: '', filas: [{ costo: 150, empresa: 'ECO ELITE', frec: 6 }] },
        { lugar: 'WTC', tiempo: '55 Min.', ahorro: '20 Min.', filas: [{ costo: 178, empresa: 'E-BUS', frec: 10 }] },
        { lugar: 'Ángel de la Independencia', tiempo: '60 Min.', ahorro: '', filas: [
            { costo: 150, empresa: 'PEGASSO', frec: 13 }, { costo: 178, empresa: 'E-BUS', frec: 10 }
        ] },
        { lugar: 'Monumento a la Revolución', tiempo: '45 Min.', ahorro: '', filas: [{ costo: 130, empresa: 'ECO ELITE', frec: 11 }] },
        { lugar: 'Bellas Artes', tiempo: '45 Min.', ahorro: '', filas: [
            { costo: 130, empresa: 'ECO ELITE', frec: 12 }, { costo: 134, empresa: 'CAMINANTE', frec: 4 }
        ] }
    ];

    const PUNTOS_EDOMEX = [
        { no: 1, lugar: 'Cuautitlán Izcalli', tiempo: '38 Min.', ahorro: '10 Min.', filas: [{ costo: 140, empresa: 'CAMINANTE', frec: 4 }] },
        { no: 2, lugar: 'Satélite', tiempo: '46 Min.', ahorro: '18 Min.', filas: [
            { costo: 162, empresa: 'CAMINANTE', frec: 4 }, { costo: 120, empresa: 'ECO ELITE', frec: 2 }
        ] },
        { no: 3, lugar: 'Tepotzotlán', tiempo: '44 Min.', ahorro: '', filas: [{ costo: 100, empresa: 'ETN', frec: 3 }] },
        { no: 4, lugar: 'Valle Dorado', tiempo: '30 Min.', ahorro: '10 Min.', filas: [{ costo: 120, empresa: 'ECO ELITE', frec: 2 }] },
        { no: 5, lugar: 'Huehuetoca', tiempo: '30 Min.', ahorro: '', filas: [{ costo: 93, empresa: 'AVM', frec: 1 }] },
        { no: 6, lugar: 'Zumpango', tiempo: '30 Min.', ahorro: '01:01 Hs.', filas: [{ costo: 45, empresa: 'ZUMPANGO TRAVELS', frec: 18 }] },
        { no: 7, lugar: 'Tecámac (Real)', tiempo: '30 Min.', ahorro: '', filas: [{ costo: 35, empresa: 'AIFA BUS', frec: 29 }] },
        { no: 8, lugar: 'Tecámac', tiempo: '25 Min.', ahorro: '', filas: [{ costo: 20, empresa: 'AIFA BUS', frec: 12 }] },
        { no: 9, lugar: 'Ecatepec (Puente de Fierro)', tiempo: '20 Min.', ahorro: '', filas: [{ costo: 35, empresa: 'TAMIXAR', frec: 33 }] },
        { no: 10, lugar: 'Cd. Azteca', tiempo: '01:32 Hs.', ahorro: '', filas: [{ costo: 10, empresa: 'MEXIBUS', frec: 'N/A' }] },
        { no: null, lugar: 'Ojo de Agua', tiempo: '35 Min.', ahorro: '', filas: [{ costo: 10, empresa: '', frec: '' }] }
    ];

    const RUTAS_FORANEAS = [
        { no: 1, lugar: 'Tizayuca', filas: [{ costo: 50, empresa: 'AIFABUS', frec: 8 }] },
        { no: 2, lugar: 'Toluca, Edo. Méx.', filas: [{ costo: 382, empresa: 'CAMINANTE', frec: 6 }] },
        { no: 3, lugar: 'Pachuca, Hgo./Villas de Pachuca/Terminal de Autobuses', filas: [
            { costo: 156, empresa: 'ADO', frec: 2 }, { costo: 168, empresa: 'FUTURA', frec: 10 }, { costo: 168, empresa: 'OMNIBUS', frec: 2 }
        ] },
        { no: 4, lugar: 'Tulancingo, Hgo.', filas: [{ costo: 238, empresa: 'FUTURA', frec: 1 }] },
        { no: 5, lugar: 'Tula de Allende, Hgo.', filas: [{ costo: 203, empresa: 'AVM', frec: 1 }] },
        { no: 6, lugar: 'Tepeji del Rio, Hgo.', filas: [{ costo: 203, empresa: 'AVM', frec: 1 }] },
        { no: 7, lugar: 'Actopan, Hgo.', filas: [{ costo: 288, empresa: 'AVM', frec: 1 }] },
        { no: 8, lugar: 'Cuernavaca', filas: [{ costo: 555, empresa: 'PULLMAN', frec: 5 }] },
        { no: 9, lugar: 'Paseo Destino / CAPU', filas: [
            { costo: 496, empresa: 'ADO', frec: 4 }, { costo: 545, empresa: 'ESTRELLA ROJA', frec: 9 }
        ] },
        { no: 10, lugar: 'Huauchinango', filas: [{ costo: 377, empresa: 'OMNIBUS', frec: 2 }] },
        { no: 11, lugar: 'Querétaro', filas: [
            { costo: 535, empresa: 'PRIMERA PLUS', frec: 6 }, { costo: 555, empresa: 'ETN', frec: 3 }, { costo: 567, empresa: 'OMNIBUS', frec: 1 }
        ] },
        { no: 12, lugar: 'San Juan Del Río', filas: [
            { costo: 374, empresa: 'OMNIBUS', frec: 1 }, { costo: 393, empresa: 'PRIMERA PLUS', frec: 3 }, { costo: 400, empresa: 'ETN', frec: 2 }
        ] },
        { no: 13, lugar: 'Chilpancingo', filas: [{ costo: 640, empresa: 'COSTA LINE', frec: 2 }] },
        { no: 14, lugar: 'Acapulco', filas: [{ costo: 920, empresa: 'COSTA LINE', frec: 2 }] },
        { no: 15, lugar: 'Celaya', filas: [{ costo: 750, empresa: 'PRIMERA PLUS', frec: 1 }] },
        { no: 16, lugar: 'León', filas: [{ costo: 800, empresa: 'ETN', frec: 1 }] },
        { no: 17, lugar: 'León', filas: [{ costo: 900, empresa: 'PRIMERA PLUS', frec: 1 }] },
        { no: 18, lugar: 'Poza Rica', filas: [{ costo: 612, empresa: 'OMNIBUS', frec: 2 }] },
        { no: 19, lugar: 'Tuxpan', filas: [{ costo: 656, empresa: 'OMNIBUS', frec: 1 }, { costo: 542, empresa: 'FUTURA', frec: 1 }] },
        { no: 20, lugar: 'Aguascalientes', filas: [{ costo: 1132, empresa: 'OMNIBUS', frec: 1 }] },
        { no: 21, lugar: 'Zacatecas', filas: [{ costo: 1545, empresa: 'OMNIBUS', frec: 1 }] },
        { no: 22, lugar: 'Tampico', filas: [{ costo: 1175, empresa: 'OMNIBUS', frec: 1 }] },
        { no: 23, lugar: 'Salamanca', filas: [{ costo: 920, empresa: 'ETN', frec: 1 }] },
        { no: 24, lugar: 'San Miguel de Allende', filas: [{ costo: 865, empresa: 'ETN', frec: 1 }] },
        { no: 25, lugar: 'Guanajuato', filas: [{ costo: 1125, empresa: 'ETN', frec: 1 }] },
        { no: 26, lugar: 'Durango', filas: [{ costo: 2487, empresa: 'OMNIBUS', frec: 1 }] }
    ];

    const RENTA_AUTOS = ['Hertz', 'Mex Rent A Car', 'Europcar'];
    const SERVICIOS_TAXI = ['Eco Shuttle', 'Atoysa', 'Shedai', 'AMS Sonrod', 'Zumpango Travels', 'Conument', 'Toximer', 'Sky Ride Cabs', 'Taxis Marín', 'Driver'];

    // Tabla de puntos de conexión: encabezado vino sólido y renglones alternos
    // en beige. `variante`: 'cdmx' (sin No.), 'edomex' (con No. + tiempos),
    // 'foranea' (con No., sin tiempos). En el documento autorizado estas
    // tablas NO llevan título encima — arrancan directo con su encabezado.
    // Estas tablas van con letra más chica que el resto del informe (así están
    // en el original): son siete columnas dentro de una tirilla que ocupa un
    // cuarto del ancho de la hoja, y con la tipografía general los nombres de
    // las líneas de autobús se desbordaban.
    const mini = (extra) => `font-size:4.7px;line-height:1.35;padding:1.6px 2px;border:0;${extra || ''}`;
    const thMini = (t, x) => `<th style="${mini(x)}">${t}</th>`;
    const tdMini = (t, x) => `<td style="${mini(x)}">${t}</td>`;

    // Anchos por variante, en porcentaje (medidos sobre el original): 'cdmx'
    // (sin No.), 'edomex' (con No. y tiempos) y 'foranea' (con No., sin
    // tiempos). EMPRESA y FRECUENCIAS van holgadas a propósito: son las que
    // llevan el texto más largo y, apretadas, se partían a media palabra.
    const ANCHOS_CONEXION = {
        cdmx:    { no: 0, lugar: 25, tiempo: 10, ahorro: 11.5, costo: 10, usd: 10.4, empresa: 15.6, frec: 17.5 },
        edomex:  { no: 6, lugar: 21, tiempo: 9.5, ahorro: 11, costo: 9.5, usd: 10, empresa: 15.5, frec: 17.5 },
        foranea: { no: 6, lugar: 33, tiempo: 0, ahorro: 0, costo: 12, usd: 13, empresa: 19, frec: 17 }
    };

    function tablaConexionHtml(filasLugar, variante) {
        const w = ANCHOS_CONEXION[variante] || ANCHOS_CONEXION.cdmx;
        const conNo = variante !== 'cdmx';
        const conTiempo = variante !== 'foranea';
        const hd = `background:${C.maroon};color:#fff;text-align:center;font-weight:700;`;
        let zebra = true; // el primer grupo va en blanco, como el original
        const cuerpo = filasLugar.map((lugar) => {
            zebra = !zebra;
            const bg = zebra ? `background:${C.zebraPuntos};` : '';
            return lugar.filas.map((fila, i) => `<tr>
                ${i === 0 && conNo ? `<td style="${mini(`${bg}text-align:center;`)}" rowspan="${lugar.filas.length}">${lugar.no ?? ''}</td>` : ''}
                ${i === 0 ? `<td style="${mini(`${bg}font-weight:700;`)}" rowspan="${lugar.filas.length}">${escapeHtml(lugar.lugar)}</td>` : ''}
                ${i === 0 && conTiempo ? `<td style="${mini(`${bg}text-align:center;`)}" rowspan="${lugar.filas.length}">${escapeHtml(lugar.tiempo || '')}</td>` : ''}
                ${i === 0 && conTiempo ? `<td style="${mini(`${bg}text-align:center;`)}" rowspan="${lugar.filas.length}">${escapeHtml(lugar.ahorro || '-')}</td>` : ''}
                ${tdMini(fila.costo !== '' ? `$${fmt(fila.costo)}` : '', `${bg}text-align:center;`)}
                ${tdMini(fila.costo !== '' ? usd(fila.costo) : '', `${bg}text-align:center;`)}
                ${tdMini(escapeHtml(fila.empresa), `${bg}text-align:center;font-weight:700;`)}
                ${tdMini(fila.frec, `${bg}text-align:center;font-weight:700;`)}
            </tr>`).join('');
        }).join('');
        return `
            <table style="border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:7px;">
                <tr>
                    ${conNo ? thMini('NO.', `${hd}width:${w.no}%;`) : ''}
                    ${thMini('LUGAR', `${hd}width:${w.lugar}%;`)}
                    ${conTiempo ? thMini('TIEMPO ACTUAL', `${hd}width:${w.tiempo}%;`) : ''}
                    ${conTiempo ? thMini('AHORRO DE TIEMPO', `${hd}width:${w.ahorro}%;`) : ''}
                    ${thMini('COSTO', `${hd}width:${w.costo}%;`)}
                    ${thMini('COSTO USD', `${hd}width:${w.usd}%;`)}
                    ${thMini('EMPRESA', `${hd}width:${w.empresa}%;`)}
                    ${thMini('FRECUENCIAS', `${hd}width:${w.frec}%;`)}
                </tr>
                ${cuerpo}
            </table>`;
    }

    function listaEmpresasHtml(items) {
        const hd = `background:${C.maroon};color:#fff;text-align:center;font-weight:700;`;
        let zebra = false;
        const cuerpo = items.map((n) => {
            zebra = !zebra;
            return `<tr>${tdMini(escapeHtml(n), `text-align:center;${zebra ? `background:${C.zebraPuntos};` : ''}`)}</tr>`;
        }).join('');
        return `<table style="border-collapse:collapse;width:100%;"><tr>${thMini('EMPRESA', hd)}</tr>${cuerpo}</table>`;
    }

    // Bloque de Puntos de Conexión en TRES COLUMNAS paralelas, como el
    // documento autorizado: CDMX + Edo. Méx. | rutas foráneas | resumen y
    // empresas. Las cifras del resumen son parte del dato estático transcrito
    // (no se derivan de las tablas: el original cuenta "conexiones" con un
    // criterio propio que no es el número de renglones).
    function puntosConexionHtml() {
        return bandaHtml('PUNTOS DE CONEXIÓN AIFA - CDMX') + puntosConexionCuerpoHtml();
    }

    // El cuerpo va aparte de la banda porque el Resumen Estadístico reutiliza
    // este mismo bloque bajo su propio estilo de título de sección.
    function puntosConexionCuerpoHtml() {
        return `
            <div style="display:flex;gap:2.5%;align-items:flex-start;padding-left:3.5%;">
                <div style="flex:0 0 29.3%;">
                    ${tablaConexionHtml(PUNTOS_CDMX, 'cdmx')}
                    ${tablaConexionHtml(PUNTOS_EDOMEX, 'edomex')}
                </div>
                <div style="flex:0 0 30.3%;">
                    ${tablaConexionHtml(RUTAS_FORANEAS, 'foranea')}
                </div>
                <div style="flex:0 0 22.8%;margin-left:1.5%;">
                    <div style="border:1px solid #9A9A9A;border-radius:9px;padding:6px 8px;font-size:5.9px;line-height:1.8;color:${C.navy};margin-bottom:8px;box-shadow:1px 2px 3px rgba(0,0,0,.18);">
                        <div style="font-weight:700;text-align:center;margin-bottom:3px;">Resumen:</div>
                        <div>✓ <strong>12</strong> puntos de conexión con la CDMX.</div>
                        <div>✓ <strong>10</strong> puntos de conexión con el Edo. Méx.</div>
                        <div>✓ <strong>27</strong> conexiones con terminales de <strong>26</strong> ciudades en <strong>13</strong> Entidades de la República Mexicana.</div>
                        <div>✓ <strong>${SERVICIOS_TAXI.length}</strong> empresas de Taxi.</div>
                        <div>✓ <strong>${RENTA_AUTOS.length}</strong> empresas arrendadoras de autos.</div>
                    </div>
                    <div style="display:flex;gap:6%;align-items:flex-start;">
                        <div style="flex:1;padding-top:14px;">${listaEmpresasHtml(RENTA_AUTOS)}</div>
                        <div style="flex:1;">${listaEmpresasHtml(SERVICIOS_TAXI)}</div>
                    </div>
                </div>
            </div>`;
    }

    // Encabezado repetido en cada hoja: título centrado y, a la derecha,
    // "Actualización" (día en que se genera) y "Corte" (último día incluido),
    // ambos subrayados y en columnas separadas como en el original.
    function encabezadoHtml(actualizacion, corte) {
        const label = 'border:0;padding:0 5px 0 0;text-align:right;white-space:nowrap;';
        const value = 'border:0;padding:0;text-decoration:underline;white-space:nowrap;';
        return `
            <div style="display:flex;align-items:flex-start;">
                <div style="flex:1;"></div>
                <h1 style="flex:0 0 auto;font-size:11.6px;margin:0;letter-spacing:.4px;text-align:center;color:${C.navy};font-weight:700;">INFORME ESTADÍSTICO</h1>
                <div style="flex:1;display:flex;justify-content:flex-end;">
                    <table style="border-collapse:collapse;font-size:5.9px;color:${C.navy};line-height:1.6;">
                        <tr><td style="${label}">Actualización:</td><td style="${value}">${escapeHtml(actualizacion)}</td></tr>
                        <tr><td style="${label}">Corte:</td><td style="${value}font-weight:700;">${escapeHtml(corte)}</td></tr>
                    </table>
                </div>
            </div>`;
    }

    // Bloque de acumulado: número grande en guinda, etiqueta debajo y las dos
    // aperturas (Comercial / General) con la cifra alineada a la derecha y el
    // texto a la izquierda, igual que el original.
    function acumuladoBloqueHtml(total, etiqueta, comercial, general) {
        const cifra = `border:0;padding:0 4px 0 0;text-align:right;font-size:5.9px;font-weight:700;color:${C.navy};white-space:nowrap;`;
        const texto = 'border:0;padding:0;font-size:5.9px;color:#3F3F3F;white-space:nowrap;';
        return `
            <div style="text-align:center;">
                <div style="font-size:8.4px;font-weight:700;color:${C.big};line-height:1.35;">${fmt(total)}</div>
                <div style="font-size:6.4px;color:${C.big};line-height:1.4;">${escapeHtml(etiqueta)}</div>
                <table style="border-collapse:collapse;margin:2px auto 0;">
                    <tr><td style="${cifra}">${fmt(comercial)}</td><td style="${texto}">de Aviación Comercial</td></tr>
                    <tr><td style="${cifra}">${fmt(general)}</td><td style="${texto}">de Aviación General</td></tr>
                </table>
            </div>`;
    }

    function buildReportHtml() {
        const corte = state.corte || parseIsoDate(corteIsoPorOmision());
        const corteDate = new Date(corte.anio, corte.mes - 1, corte.dia);
        const corteTexto = formatDateLong(corteDate);
        const a = state.acumulado;
        const d = state.diaCorte || Core.aggregateDiaCorte([]);
        const encabezado = encabezadoHtml(formatDateLong(new Date()), corteTexto);

        return `
        <div style="font-family:'Montserrat','Segoe UI',Calibri,Arial,sans-serif;color:${C.navy};width:${HOJA_W}px;background:#fff;">
            <div class="informe-hoja">
                ${encabezado}
                <p style="font-size:6.8px;font-weight:700;margin:10px 0 6px;">Del 21 de marzo de 2022 al ${escapeHtml(corteTexto)} se acumulan:</p>
                <div style="display:flex;justify-content:space-around;margin-bottom:4px;">
                    ${acumuladoBloqueHtml(a.totalOperaciones, 'operaciones aéreas', a.comercial.ops, a.general.ops)}
                    ${acumuladoBloqueHtml(a.totalPasajeros, 'pasajeros transportados', a.comercial.pax, a.general.pax)}
                </div>
                ${seccionTipoHtml('AVIACIÓN COMERCIAL', 'comercial', 'pax', d.comercial, corte)}
                ${seccionTipoHtml('AVIACIÓN GENERAL', 'general', 'pax', null, corte)}
                ${seccionTipoHtml('AVIACIÓN DE CARGA', 'carga', 'kg', d.carga, corte)}
                <div style="font-size:5.1px;color:#333;margin-top:8px;line-height:1.5;">
                    <strong>Nota:</strong> Todas las cifras que se presentan son de carácter preliminar y susceptibles a ajustes, derivado de la conciliación de datos entre los registros de la Dirección de Operación y los Manifiestos de las Aerolíneas, realizada en tiempo vencido, ya que, de conformidad con su contrato, las líneas aéreas cuentan con un periodo de 30 horas para hacer entrega de su Manifiesto. Por lo anterior, los datos presentados no son definitivos y pueden variar en el futuro.
                </div>
            </div>
            <div class="informe-hoja">
                ${encabezado}
                ${bandaHtml('FACTOR DE OCUPACIÓN PROMEDIO')}
                <p style="font-size:6.1px;margin:6px 0 7px;padding-left:3.5%;"><strong>Periodo promediado:</strong>&nbsp;&nbsp;Del ${escapeHtml(isoToLong(state.ocupacionDesde))} al ${escapeHtml(isoToLong(state.ocupacionHasta))}</p>
                ${factorOcupacionHtml()}
                ${puntosConexionHtml()}
            </div>
        </div>`;
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    // Alto real "con tinta" de un canvas: baja una copia angosta y busca desde
    // abajo el último renglón que no sea blanco. Sirve para no arrastrar el
    // margen sobrante de la hoja y, sobre todo, para no generar una página
    // final en blanco al rebanar.
    function alturaConTinta(canvas) {
        const ancho = 60;
        const lienzo = document.createElement('canvas');
        lienzo.width = ancho;
        lienzo.height = canvas.height;
        // Sin contexto 2D (entornos sin canvas real) se usa el alto completo:
        // el PDF sale igual, sólo con el margen sobrante de la última hoja.
        const ctx = lienzo.getContext && lienzo.getContext('2d');
        if (!ctx) return canvas.height;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, ancho, canvas.height);
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, ancho, canvas.height);
        const data = ctx.getImageData(0, 0, ancho, canvas.height).data;
        for (let y = canvas.height - 1; y >= 0; y -= 1) {
            const fila = y * ancho * 4;
            for (let x = 0; x < ancho; x += 1) {
                const i = fila + x * 4;
                if (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248) return y + 1;
            }
        }
        return canvas.height;
    }

    // Recorta una banda horizontal del canvas de la hoja. Si el entorno no da
    // contexto 2D se devuelve la hoja completa: peor encuadre, pero nunca un
    // PDF roto.
    function rebanar(canvas, desdeY, altoTrozo) {
        const trozo = document.createElement('canvas');
        trozo.width = canvas.width;
        trozo.height = altoTrozo;
        const ctx = trozo.getContext && trozo.getContext('2d');
        if (!ctx) return canvas.toDataURL('image/jpeg', 0.95);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, trozo.width, trozo.height);
        ctx.drawImage(canvas, 0, desdeY, canvas.width, altoTrozo, 0, 0, canvas.width, altoTrozo);
        return trozo.toDataURL('image/jpeg', 0.95);
    }

    // Cada .informe-hoja se rasteriza una vez y se coloca a ESCALA FIJA sobre
    // hojas tamaño oficio. Si una hoja no cabe en una página se parte en
    // rebanadas verticales en lugar de encogerse: así la densidad de las
    // tablas es idéntica en todas las páginas, como en el documento
    // autorizado (antes se escalaba "para que cupiera" y cada página salía
    // con un tamaño de letra distinto).
    // `pagina` y `selector` vienen por parámetro porque los dos documentos del
    // módulo no comparten formato: el Informe Estadístico es OFICIO y el Resumen
    // Estadístico CARTA, cada uno como su original.
    // El documento se arma dentro de un IFRAME propio en vez de colgarlo de la
    // página. La razón es de rendimiento, no de estilo: para cada hoja,
    // html2canvas clona el documento ENTERO al que pertenece el elemento. Con
    // el marcado colgado de index.html eso significaba clonar toda la
    // aplicación —decenas de miles de nodos— una vez por hoja, y el Resumen
    // Estadístico, que son 17, se quedaba más de un minuto "pensando".
    // Dentro del iframe el documento a clonar es sólo el informe.
    async function construirPdfDesdeHtml(html, pagina, selector, avisar) {
        const conf = pagina || PDF_PAGINA;
        const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDFCtor || !window.html2canvas) throw new Error('Faltan jsPDF o html2canvas.');

        const marco = document.createElement('iframe');
        marco.setAttribute('aria-hidden', 'true');
        marco.style.cssText = 'position:fixed;left:-99999px;top:0;width:1400px;height:800px;border:0;';
        document.body.appendChild(marco);

        try {
            const doc = marco.contentDocument;
            // Las hojas usan Montserrat; sin la hoja de estilo de la fuente el
            // PDF saldría con la tipografía de reserva.
            const fuentes = [...document.querySelectorAll('link[rel="stylesheet"]')]
                .filter((l) => /fonts\.(googleapis|gstatic)/.test(l.href))
                .map((l) => l.outerHTML).join('');
            doc.open();
            doc.write(`<!doctype html><html><head><meta charset="utf-8">${fuentes}</head><body style="margin:0;background:#fff;">${html}</body></html>`);
            doc.close();
            if (doc.fonts && doc.fonts.ready) { try { await doc.fonts.ready; } catch (_) { /* sin API de fuentes */ } }
            marco.style.height = `${Math.max(800, doc.body.scrollHeight)}px`;

            const pdf = new jsPDFCtor({ unit: 'mm', format: conf.formato, orientation: 'portrait' });
            const anchoPagina = pdf.internal.pageSize.getWidth();
            const altoPagina = pdf.internal.pageSize.getHeight();
            const ancho = anchoPagina - conf.margenX * 2;
            const altoUtil = altoPagina - conf.margenSup - conf.margenInf;
            const hojas = doc.querySelectorAll(selector || '.informe-hoja');
            let primera = true;

            for (let i = 0; i < hojas.length; i += 1) {
                if (avisar) avisar(i + 1, hojas.length);
                // Cede el hilo para que el aviso de avance alcance a pintarse.
                await new Promise((listo) => window.setTimeout(listo, 0));
                const canvas = await window.html2canvas(hojas[i], { scale: 3, useCORS: true, backgroundColor: '#ffffff' });
                const mmPorPx = ancho / canvas.width;
                const pxPorPagina = Math.max(1, Math.floor(altoUtil / mmPorPx));
                const alto = alturaConTinta(canvas);
                for (let y = 0; y < alto; y += pxPorPagina) {
                    const altoTrozo = Math.min(pxPorPagina, alto - y);
                    const rebanada = rebanar(canvas, y, altoTrozo);
                    if (!primera) pdf.addPage();
                    primera = false;
                    pdf.addImage(rebanada, 'JPEG', conf.margenX, conf.margenSup, ancho, altoTrozo * mmPorPx);
                }
            }
            return pdf.output('blob');
        } finally {
            marco.remove();
        }
    }

    // ── Resumen Estadístico (segundo documento) ─────────────────────────────
    // Promedio DIARIO del mes en curso: total del mes entre los días corridos
    // hasta el corte. Devuelve null cuando el mes todavía no tiene nada, para
    // que la hoja muestre "—" en vez de un cero que parecería un dato.
    function promedioDelMes() {
        const corte = state.corte;
        if (!corte || !corte.dia || !state.aggregated) return {};
        const mes = Core.monthTotals(state.aggregated, corte.anio, corte.mes);
        const opsAereas = (mes.comercial.ops || 0) + (mes.general.ops || 0);
        const paxAereos = (mes.comercial.pax || 0) + (mes.general.pax || 0);
        return {
            ops: opsAereas ? Math.round(opsAereas / corte.dia) : null,
            pax: paxAereos ? Math.round(paxAereos / corte.dia) : null,
            cargaOps: mes.carga.ops ? Math.round(mes.carga.ops / corte.dia) : null,
            cargaTons: mes.carga.kg ? (mes.carga.kg / 1000) / corte.dia : null
        };
    }

    async function descargarResumen() {
        const Resumen = window.ResumenEstadistico;
        const btn = $('informe-est-btn-resumen');
        if (!Resumen) { alert('No se pudo cargar la plantilla del Resumen Estadístico. Recarga la página.'); return; }
        if (!window.jspdf?.jsPDF || typeof window.html2canvas === 'undefined') { alert('No se pudo cargar el generador de PDF. Recarga la página e intenta de nuevo.'); return; }
        if (!state.aggregated) { alert('Espera a que termine de cargar el informe.'); return; }
        if (btn) btn.disabled = true;
        setBusy('Armando el Resumen Estadístico…');

        try {
            const client = await getClient();
            const extra = await loadDatosResumen(client);
            const html = Resumen.buildHtml({
                acumulado: state.acumulado,
                aggregated: state.aggregated,
                anios: state.anios.slice().sort((a, b) => a - b),
                corte: state.corte,
                diaCorte: state.diaCorte || Core.aggregateDiaCorte([]),
                promedioMes: promedioDelMes(),
                ocupacion: state.ocupacion,
                ocupacionDesdeTexto: isoToLong(state.ocupacionDesde),
                ocupacionHastaTexto: isoToLong(state.ocupacionHasta),
                aerolineasPorAnio: extra.aerolineasPorAnio,
                fauna: extra.fauna,
                // El bloque de transporte terrestre es el mismo dato estático
                // que ya arma el Informe Estadístico; se reutiliza tal cual.
                puntosConexionHtml: puntosConexionCuerpoHtml(),
                // La apertura Nacional/Internacional de carga sólo existe en
                // manifiestos, que no cubren la historia: se deja marcada.
                cargaNacional: null,
                cargaInternacional: null
            });

            const pdfBlob = await construirPdfDesdeHtml(html, Resumen.PAGINA, '.resumen-hoja',
                (hoja, total) => setBusy(`Resumen Estadístico: hoja ${hoja} de ${total}…`));
            downloadBlob(pdfBlob, `resumen_estadistico_${state.corteIso || todayIso()}.pdf`);
        } catch (error) {
            console.error('No se pudo generar el Resumen Estadístico:', error);
            alert('No se pudo generar el Resumen Estadístico. Intenta de nuevo.');
        } finally {
            setBusy(null);
            if (btn) btn.disabled = false;
        }
    }

    async function darVistoBueno() {
        if (!canApprove()) return;
        const btn = $('informe-est-btn-visto-bueno');
        // El PDF se arma con jsPDF + html2canvas directo (ya no con html2pdf).
        if (!window.jspdf?.jsPDF || typeof window.html2canvas === 'undefined') { alert('No se pudo cargar el generador de PDF. Recarga la página e intenta de nuevo.'); return; }
        if (btn) btn.disabled = true;
        setBusy('Generando el Informe Estadístico…');

        try {
            // Se arma el PDF hoja por hoja en vez de dejar que html2pdf pagine
            // solo: su salto de página (page-break-before, clase legacy y
            // pagebreak.before) no se respetó en la 0.10.1 con este marcado, y
            // el encabezado de la hoja 2 se colaba al pie de la 1. Rasterizando
            // cada .informe-hoja por separado, una hoja == una página, siempre.
            const pdfBlob = await construirPdfDesdeHtml(buildReportHtml(), PDF_PAGINA, '.informe-hoja',
                (hoja, total) => setBusy(`Informe Estadístico: hoja ${hoja} de ${total}…`));

            const fileName = `informe_estadistico_${state.anioSeleccionado}_${Date.now()}.pdf`;
            // Entrega inmediata al navegador — antes solo se subía a Storage
            // y no había forma de verlo/descargarlo desde la pantalla.
            downloadBlob(pdfBlob, fileName);

            const client = window.supabaseClient;
            const { error: uploadError } = await client.storage
                .from('manifiestos_pdfs')
                .upload(fileName, pdfBlob, { contentType: 'application/pdf', upsert: false });
            if (uploadError) throw uploadError;
            const { data: pub } = client.storage.from('manifiestos_pdfs').getPublicUrl(fileName);

            const displayName = sessionStorage.getItem('user_display_name') || sessionStorage.getItem('user_email') || 'Administrador';
            const payload = {
                periodo_tipo: 'anual',
                anio: state.anioSeleccionado,
                mes: 0, // 0 = "no aplica" para periodo anual (ver 027_informe_estadistico_manifiestos.sql)
                fecha_corte: state.corteIso || todayIso(),
                validado: true,
                validado_por: displayName,
                validado_at: new Date().toISOString(),
                pdf_url: pub?.publicUrl || null
            };
            const { error: upsertError } = await client
                .from('informe_estadistico_aprobaciones')
                .upsert(payload, { onConflict: 'periodo_tipo,anio,mes' });
            if (upsertError) throw upsertError;

            await loadAprobacion(client);
            renderAprobacion();
        } catch (error) {
            console.error('No se pudo generar el visto bueno del Informe Estadístico:', error);
            alert('No se pudo generar el PDF/visto bueno. Intenta de nuevo.');
        } finally {
            setBusy(null);
            if (btn) btn.disabled = false;
        }
    }

    function bindToolbar() {
        $('informe-est-btn-refresh')?.addEventListener('click', () => reload());
        $('informe-est-btn-csv')?.addEventListener('click', exportCsv);
        $('informe-est-btn-excel')?.addEventListener('click', exportExcel);
        $('informe-est-btn-visto-bueno')?.addEventListener('click', darVistoBueno);
        $('informe-est-btn-resumen')?.addEventListener('click', descargarResumen);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const tabButton = document.getElementById('tab-conci-estadistica');
        if (!tabButton) return;
        bindToolbar();
        tabButton.addEventListener('shown.bs.tab', () => load());
        if (tabButton.classList.contains('active')) load();
    });
})();
