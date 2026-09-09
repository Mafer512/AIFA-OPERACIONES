/* Módulo estadístico de operaciones — pantallas.
 *
 * Vive dentro de la pestaña Estadística de Conciliación, como sub-pestañas.
 * La última sub-pestaña ("Informe oficial") es el módulo que ya existía
 * (js/estadistico-informe.js + js/resumen-estadistico.js): este archivo NO lo
 * toca, sólo se acomoda a su lado.
 *
 * DE DÓNDE SALEN LAS CIFRAS
 *   De un único RPC, public.estadistica_agregado (migración 038), que suma en
 *   PostgreSQL sobre mv_estadistica_operaciones. Aquí NO se recorre ninguna
 *   tabla con reduce/filter/map para calcular una métrica: el navegador recibe
 *   renglones ya agregados —decenas, no decenas de miles— y sólo los pinta.
 *   Las únicas cuentas que se hacen del lado del cliente son las que operan
 *   sobre esos agregados ya recibidos (restar dos periodos, repartir un
 *   porcentaje de participación), y viven en js/estadistica-motor.js.
 *
 * CARGA PEREZOSA
 *   Cada área consulta cuando se abre por primera vez, no al entrar al módulo.
 *   Cambiar los filtros invalida lo cargado y vuelve a pedir sólo el área
 *   visible.
 */
(function () {
    'use strict';

    const Motor = window.EstadisticaMotor;
    if (!Motor) {
        console.error('No se cargó js/estadistica-motor.js: el módulo estadístico no puede arrancar.');
        return;
    }

    const $ = (id) => document.getElementById(id);
    const esc = (valor) => String(valor ?? '').replace(/[&<>'"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[c]);

    // Paleta alineada con la del resto del tablero (las mismas variables de
    // Bootstrap que ya usa el Informe Estadístico). No se introduce una segunda
    // identidad visual ni otra librería de gráficas: Chart.js ya está cargado.
    const COLORES = ['#0d6efd', '#20c997', '#fd7e14', '#6f42c1', '#dc3545', '#0dcaf0', '#ffc107', '#198754', '#6c757d', '#d63384'];

    const state = {
        nivel: null,              // admin | edit | capture | read | none
        filtros: Motor.filtrosVacios(),
        cargadas: new Set(),      // áreas ya pintadas con los filtros vigentes
        graficas: {},             // una instancia de Chart por canvas
        areaActiva: 'resumen',
        opcionesCargadas: false,
        ultimoExplorador: null,
        ultimoComparador: null,
        iniciado: false
    };

    // ── Cliente y permisos ───────────────────────────────────────────────────
    async function getClient() {
        const client = window.supabaseClient
            || (window.ensureSupabaseClient && await window.ensureSupabaseClient());
        if (!client) throw new Error('No se pudo inicializar el cliente de Supabase.');
        return client;
    }

    // El nivel lo dicta la BASE (estadistica_access_level), no el navegador.
    // El helper del cliente se usa sólo como respaldo optimista para no dejar
    // la pantalla en blanco si el RPC falla; toda escritura la vuelve a
    // comprobar la política de RLS.
    async function cargarNivel() {
        try {
            const client = await getClient();
            const { data, error } = await client.rpc('estadistica_access_level', {});
            if (error) throw error;
            state.nivel = String(data || 'none');
        } catch (error) {
            console.warn('No se pudo consultar estadistica_access_level, se usa el nivel del navegador:', error);
            try {
                state.nivel = String(window.sectionLevel?.('conciliacion') || 'read');
            } catch (_) {
                state.nivel = 'read';
            }
        }
        return state.nivel;
    }

    const puedeVer = () => state.nivel && state.nivel !== 'none';
    const puedeExportarDetalle = () => ['capture', 'edit', 'admin'].includes(state.nivel);
    const puedeDocumentosOficiales = () => ['edit', 'admin'].includes(state.nivel);
    const puedeAdministrarReglas = () => state.nivel === 'admin';

    // ── Consultas ────────────────────────────────────────────────────────────
    async function agregado(desde, hasta, dimensiones, filtrosExtra, limite) {
        const client = await getClient();
        const filtros = Object.assign({}, Motor.filtrosAJson(state.filtros), filtrosExtra || {});
        const { data, error } = await client.rpc('estadistica_agregado', {
            p_desde: desde,
            p_hasta: hasta,
            p_dimensiones: dimensiones || [],
            p_filtros: filtros,
            p_limite: limite || 5000
        });
        if (error) throw error;
        return (data || []).map(Motor.normalizarFila);
    }

    const totalDe = (filas) => Motor.combinar(filas);

    async function totalPeriodo(desde, hasta, filtrosExtra) {
        const filas = await agregado(desde, hasta, [], filtrosExtra, 1);
        return totalDe(filas);
    }

    // ── Barra de estado ──────────────────────────────────────────────────────
    function mostrarError(mensaje) {
        const el = $('est-error');
        if (!el) return;
        if (!mensaje) { el.classList.add('d-none'); el.textContent = ''; return; }
        el.textContent = mensaje;
        el.classList.remove('d-none');
    }

    function pintarAvisos(avisos) {
        const host = $('est-avisos');
        if (!host) return;
        const lista = (avisos || []).filter((a) => a.nivel !== 'info' || a.clave === 'canceladas');
        if (!lista.length) { host.classList.add('d-none'); host.innerHTML = ''; return; }
        host.classList.remove('d-none');
        host.innerHTML = lista.map((a) => {
            const clase = a.nivel === 'error' ? 'alert-danger' : (a.nivel === 'aviso' ? 'alert-warning' : 'alert-secondary');
            const icono = a.nivel === 'error' ? 'fa-circle-exclamation'
                : (a.nivel === 'aviso' ? 'fa-triangle-exclamation' : 'fa-circle-info');
            return `<div class="alert ${clase} py-2 px-3 mb-2" style="font-size:.8rem">
                <i class="fas ${icono} me-2"></i>${esc(a.mensaje)}</div>`;
        }).join('');
    }

    function ocupado(area, activo) {
        const boton = document.querySelector(`#est-subnav [data-est-area="${area}"]`);
        if (boton) boton.classList.toggle('opacity-50', !!activo);
    }

    // ── Tarjetas y tablas ────────────────────────────────────────────────────
    function tarjeta(titulo, valor, detalle, extra) {
        return `<div class="airline-stat-card">
            <span>${esc(titulo)}</span>
            <strong>${esc(valor)}</strong>
            ${detalle ? `<small>${detalle}</small>` : ''}
            ${extra || ''}
        </div>`;
    }

    // La variación se pinta con su estado, nunca como Infinity o NaN.
    function chipVariacion(v, etiqueta) {
        if (!v) return '';
        if (v.estado !== 'ok') {
            return `<small class="text-muted">${esc(etiqueta)}: ${esc(v.texto)}</small>`;
        }
        const clase = v.porcentual > 0 ? 'text-success' : (v.porcentual < 0 ? 'text-danger' : 'text-muted');
        const flecha = v.porcentual > 0 ? '▲' : (v.porcentual < 0 ? '▼' : '=');
        return `<small class="${clase}">${flecha} ${esc(v.texto)} <span class="text-muted">${esc(etiqueta)}</span></small>`;
    }

    function pintarTabla(idTabla, columnas, filas, opciones) {
        const tabla = $(idTabla);
        if (!tabla) return;
        const thead = tabla.querySelector('thead');
        const tbody = tabla.querySelector('tbody');
        const alineaDerecha = (col) => ['numero', 'decimal', 'porcentaje', 'carga'].includes(col.tipo);

        thead.innerHTML = `<tr>${columnas.map((c) =>
            `<th class="${alineaDerecha(c) ? 'text-end' : ''}" scope="col">${esc(c.titulo)}</th>`).join('')}</tr>`;

        if (!filas || !filas.length) {
            tbody.innerHTML = `<tr><td colspan="${columnas.length}" class="text-center text-muted py-3">
                ${esc((opciones && opciones.vacio) || 'Sin datos para el periodo y los filtros seleccionados.')}</td></tr>`;
            return;
        }

        const cuerpo = filas.map((fila) => `<tr>${columnas.map((col) => {
            const bruto = typeof col.valor === 'function' ? col.valor(fila) : fila[col.clave];
            const texto = col.html ? col.html(fila) : Motor.formatearPorTipo(bruto, col.tipo);
            return `<td class="${alineaDerecha(col) ? 'text-end' : ''}">${col.html ? texto : esc(texto)}</td>`;
        }).join('')}</tr>`).join('');

        let pie = '';
        if (opciones && opciones.total) {
            pie = `<tr class="fw-semibold table-light">${columnas.map((col, i) => {
                if (i === 0) return `<td>${esc(opciones.etiquetaTotal || 'TOTAL')}</td>`;
                const bruto = typeof col.valor === 'function' ? col.valor(opciones.total) : opciones.total[col.clave];
                return `<td class="${alineaDerecha(col) ? 'text-end' : ''}">${esc(Motor.formatearPorTipo(bruto, col.tipo))}</td>`;
            }).join('')}</tr>`;
        }
        tbody.innerHTML = cuerpo + pie;
    }

    function pintarGrafica(idCanvas, config) {
        const canvas = $(idCanvas);
        if (!canvas || !window.Chart) return;
        if (state.graficas[idCanvas]) { state.graficas[idCanvas].destroy(); }
        state.graficas[idCanvas] = new window.Chart(canvas, config);
    }

    const opcionesGrafica = (extra) => Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'bottom' },
            datalabels: { display: false }
        },
        scales: { y: { beginAtZero: true } }
    }, extra || {});

    // ── Filtros ──────────────────────────────────────────────────────────────
    function rangoDePreset(preset) {
        const hoy = Motor.hoyIso();
        const { anio, mes } = Motor.partesIso(hoy);
        switch (preset) {
            case 'mes_actual':   return Motor.rangoMes(anio, mes);
            case 'mes_anterior': return mes === 1 ? Motor.rangoMes(anio - 1, 12) : Motor.rangoMes(anio, mes - 1);
            case 'anio_actual':  return Motor.rangoAnio(anio);
            case 'anio_anterior':return Motor.rangoAnio(anio - 1);
            case 'ultimos_30':   return { desde: Motor.sumarDias(hoy, -29), hasta: hoy };
            case 'ultimos_90':   return { desde: Motor.sumarDias(hoy, -89), hasta: hoy };
            case 'ultimos_12m':  return { desde: Motor.sumarDias(hoy, -364), hasta: hoy };
            default:             return null;
        }
    }

    function leerFiltros() {
        const unaLista = (id) => {
            const v = $(id)?.value;
            return v ? [v] : [];
        };
        state.filtros = {
            fecha_inicio: $('est-f-desde')?.value || null,
            fecha_fin: $('est-f-hasta')?.value || null,
            aerolinea: unaLista('est-f-aerolinea'),
            matricula: unaLista('est-f-matricula'),
            tipo_aeronave: unaLista('est-f-tipo-aeronave'),
            tipo_servicio: unaLista('est-f-servicio'),
            direccion: unaLista('est-f-direccion'),
            nacional_internacional: unaLista('est-f-nacint'),
            segmento_aviacion: unaLista('est-f-segmento'),
            naturaleza_operacion: unaLista('est-f-naturaleza'),
            origen: [],
            destino: [],
            endpoint: unaLista('est-f-endpoint')
        };
        return state.filtros;
    }

    function aplicarPreset(preset) {
        const rango = rangoDePreset(preset);
        if (!rango) return;
        if ($('est-f-desde')) $('est-f-desde').value = rango.desde;
        if ($('est-f-hasta')) $('est-f-hasta').value = rango.hasta;
    }

    const desde = () => state.filtros.fecha_inicio;
    const hasta = () => state.filtros.fecha_fin;

    // Rellena los desplegables con lo que realmente existe en el periodo, no
    // con el catálogo completo: así no se ofrecen aerolíneas que no operaron.
    async function cargarOpcionesFiltro() {
        try {
            const client = await getClient();
            const { data, error } = await client.rpc('estadistica_opciones_filtro', {
                p_desde: desde(), p_hasta: hasta()
            });
            if (error) throw error;
            const porCampo = {};
            (data || []).forEach((fila) => {
                (porCampo[fila.campo] = porCampo[fila.campo] || []).push(fila);
            });
            const llenar = (id, campo, etiquetaVacia) => {
                const sel = $(id);
                if (!sel) return;
                const seleccionado = sel.value;
                sel.innerHTML = `<option value="">${esc(etiquetaVacia)}</option>`
                    + (porCampo[campo] || []).map((o) =>
                        `<option value="${esc(o.valor)}">${esc(o.etiqueta)}</option>`).join('');
                if (seleccionado) sel.value = seleccionado;
            };
            llenar('est-f-aerolinea', 'aerolinea', 'Todas');
            llenar('est-f-tipo-aeronave', 'tipo_aeronave', 'Todos');
            llenar('est-f-matricula', 'matricula', 'Todas');
            llenar('est-f-endpoint', 'endpoint', 'Todos');
            llenar('est-f-servicio', 'tipo_servicio', 'Todos');
            state.opcionesCargadas = true;
        } catch (error) {
            console.warn('No se pudieron cargar las opciones de filtro:', error);
        }
    }

    async function mostrarFrescura() {
        const el = $('est-frescura');
        if (!el) return;
        try {
            const client = await getClient();
            const { data } = await client.from('estadistica_refresco').select('refrescado_at').eq('id', 1).maybeSingle();
            if (data?.refrescado_at) {
                el.textContent = `Datos al ${new Date(data.refrescado_at).toLocaleString('es-MX')}`;
            }
        } catch (_) { /* la etiqueta es informativa: si falla, no estorba */ }
    }

    // ── A · Resumen ejecutivo ────────────────────────────────────────────────
    async function pintarResumen() {
        const rangoAnterior = Motor.periodoAnterior(desde(), hasta());
        const rangoAnioAnterior = Motor.mismoPeriodoAnioAnterior(desde(), hasta());

        const [mensual, total, totalAnterior, totalAnioAnterior] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            totalPeriodo(desde(), hasta()),
            totalPeriodo(rangoAnterior.desde, rangoAnterior.hasta),
            totalPeriodo(rangoAnioAnterior.desde, rangoAnioAnterior.hasta)
        ]);

        const v = (campo) => Motor.variacion(totalAnterior[campo], total[campo]);
        const vAnio = (campo) => Motor.variacion(totalAnioAnterior[campo], total[campo]);

        $('est-resumen-tarjetas').innerHTML = [
            tarjeta('Operaciones', Motor.fmtEntero(total.operaciones),
                `Llegadas ${Motor.fmtEntero(total.operacionesLlegada)} · Salidas ${Motor.fmtEntero(total.operacionesSalida)}`,
                `${chipVariacion(v('operaciones'), 'vs periodo anterior')}<br>${chipVariacion(vAnio('operaciones'), 'vs año anterior')}`),
            tarjeta('Pasajeros', Motor.fmtEntero(total.paxTotal),
                `Llegada ${Motor.fmtEntero(total.paxLlegada)} · Salida ${Motor.fmtEntero(total.paxSalida)}`,
                `${chipVariacion(v('paxTotal'), 'vs periodo anterior')}<br>${chipVariacion(vAnio('paxTotal'), 'vs año anterior')}`),
            tarjeta('Carga transportada', Motor.fmtToneladas(total.cargaTotalKg),
                `Nacional ${Motor.fmtToneladas(total.cargaNacionalKg)} · Internacional ${Motor.fmtToneladas(total.cargaInternacionalKg)}`,
                `${chipVariacion(v('cargaTotalKg'), 'vs periodo anterior')}<br>${chipVariacion(vAnio('cargaTotalKg'), 'vs año anterior')}`),
            tarjeta('Factor de ocupación', Motor.fmtPorcentaje(total.factorOcupacion),
                `${Motor.fmtEntero(total.ocupacionPax)} pasajeros sobre ${Motor.fmtEntero(total.ocupacionCapacidad)} asientos`,
                chipVariacion(vAnio('factorOcupacion'), 'vs año anterior')),
            tarjeta('Puntualidad', Motor.fmtPorcentaje(total.puntualidadPorcentaje),
                `${Motor.fmtEntero(total.operacionesPuntuales)} a tiempo de ${Motor.fmtEntero(total.operacionesEvaluablesPuntualidad)} evaluables`,
                chipVariacion(vAnio('puntualidadPorcentaje'), 'vs año anterior'))
        ].join('');

        // Calidad del dato: dice cuándo un indicador puede estar engañando.
        $('est-resumen-calidad').innerHTML = '<div class="d-flex gap-2 flex-wrap">'
            + Motor.calidad(total).map((c) => {
                const bajo = c.porcentaje !== null && c.porcentaje < 80;
                return `<span class="badge rounded-pill ${bajo ? 'bg-warning text-dark' : 'bg-light text-dark'} border">
                    ${esc(c.etiqueta)}: ${esc(c.texto)}</span>`;
            }).join('') + '</div>';

        pintarAvisos(Motor.validar(total));

        const etiquetas = mensual.map((f) => f.d1);
        pintarGrafica('est-resumen-chart', {
            type: 'line',
            data: {
                labels: etiquetas,
                datasets: [
                    { label: 'Operaciones', data: mensual.map((f) => f.operaciones), borderColor: COLORES[0], backgroundColor: COLORES[0], tension: 0.25, yAxisID: 'y' },
                    { label: 'Pasajeros', data: mensual.map((f) => f.paxTotal), borderColor: COLORES[1], backgroundColor: COLORES[1], tension: 0.25, yAxisID: 'y1' }
                ]
            },
            options: opcionesGrafica({
                scales: {
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Operaciones' } },
                    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Pasajeros' } }
                }
            })
        });

        const columnas = [
            { titulo: 'Indicador', clave: 'etiqueta' },
            { titulo: Motor.etiquetaRango(rangoAnioAnterior.desde, rangoAnioAnterior.hasta), clave: 'anioAnterior' },
            { titulo: Motor.etiquetaRango(rangoAnterior.desde, rangoAnterior.hasta), clave: 'anterior' },
            { titulo: Motor.etiquetaRango(desde(), hasta()), clave: 'actual' },
            { titulo: 'vs periodo anterior', clave: 'varAnterior', html: (f) => f.varAnterior },
            { titulo: 'vs año anterior', clave: 'varAnio', html: (f) => f.varAnio }
        ];
        const indicadores = [
            ['Operaciones', 'operaciones', 'numero'],
            ['Pasajeros', 'paxTotal', 'numero'],
            ['Carga', 'cargaTotalKg', 'carga'],
            ['Factor de ocupación', 'factorOcupacion', 'porcentaje'],
            ['Puntualidad', 'puntualidadPorcentaje', 'porcentaje']
        ];
        pintarTabla('est-resumen-variaciones', columnas, indicadores.map(([etiqueta, campo, tipo]) => ({
            etiqueta,
            anioAnterior: Motor.formatearPorTipo(totalAnioAnterior[campo], tipo),
            anterior: Motor.formatearPorTipo(totalAnterior[campo], tipo),
            actual: Motor.formatearPorTipo(total[campo], tipo),
            varAnterior: chipVariacion(Motor.variacion(totalAnterior[campo], total[campo]), ''),
            varAnio: chipVariacion(Motor.variacion(totalAnioAnterior[campo], total[campo]), '')
        })));
    }

    // ── B · Explorador ───────────────────────────────────────────────────────
    const COLUMNAS_METRICAS = [
        { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
        { titulo: 'Llegadas', clave: 'operacionesLlegada', tipo: 'numero' },
        { titulo: 'Salidas', clave: 'operacionesSalida', tipo: 'numero' },
        { titulo: 'Nacional', clave: 'operacionesNacional', tipo: 'numero' },
        { titulo: 'Internacional', clave: 'operacionesInternacional', tipo: 'numero' },
        { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
        { titulo: 'Carga', clave: 'cargaTotalKg', tipo: 'carga' },
        { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' },
        { titulo: 'Puntualidad', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' },
        { titulo: 'Canceladas', clave: 'operacionesCanceladas', tipo: 'numero' }
    ];

    function llenarSelectDimensiones() {
        const opciones = (incluirVacio) => (incluirVacio ? '<option value="">— sin agrupar —</option>' : '')
            + Object.entries(Motor.DIMENSIONES).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
        const dim1 = $('est-exp-dim1');
        const dim2 = $('est-exp-dim2');
        const dim3 = $('est-exp-dim3');
        if (dim1 && !dim1.options.length) { dim1.innerHTML = opciones(false); dim1.value = 'anio_mes'; }
        if (dim2 && !dim2.options.length) { dim2.innerHTML = opciones(true); dim2.value = ''; }
        if (dim3 && !dim3.options.length) { dim3.innerHTML = opciones(true); dim3.value = ''; }
    }

    async function pintarExplorador() {
        llenarSelectDimensiones();
        const dims = [$('est-exp-dim1')?.value, $('est-exp-dim2')?.value, $('est-exp-dim3')?.value]
            .filter(Boolean);
        const filas = await agregado(desde(), hasta(), dims, null, 5000);
        const total = totalDe(filas);
        state.ultimoExplorador = { dims, filas, total };

        const columnasDim = dims.map((d, i) => ({
            titulo: Motor.DIMENSIONES[d] || d,
            valor: (f) => Motor.etiquetaDimension(d, f[`d${i + 1}`])
        }));
        const columnas = columnasDim.concat(COLUMNAS_METRICAS);
        pintarTabla('est-exp-tabla', columnas, filas, { total, etiquetaTotal: 'TOTAL' });

        $('est-exp-conteo').textContent = `${Motor.fmtEntero(filas.length)} renglones`;
        $('est-exp-tarjetas').innerHTML = [
            tarjeta('Operaciones', Motor.fmtEntero(total.operaciones), `${Motor.fmtEntero(total.operacionesCanceladas)} canceladas excluidas`),
            tarjeta('Pasajeros', Motor.fmtEntero(total.paxTotal), ''),
            tarjeta('Carga', Motor.fmtToneladas(total.cargaTotalKg), ''),
            tarjeta('Factor de ocupación', Motor.fmtPorcentaje(total.factorOcupacion),
                Motor.cobertura(total.operacionesConOcupacion, total.operaciones).texto)
        ].join('');

        // Sólo se grafica cuando hay una dimensión: dos o tres cruzadas no dan
        // una serie legible, y una gráfica que no se entiende estorba.
        const canvas = $('est-exp-chart');
        if (canvas) canvas.parentElement.style.display = dims.length === 1 ? '' : 'none';
        if (dims.length === 1) {
            const top = filas.slice().sort((a, b) => b.operaciones - a.operaciones).slice(0, 25);
            pintarGrafica('est-exp-chart', {
                type: 'bar',
                data: {
                    labels: top.map((f) => Motor.etiquetaDimension(dims[0], f.d1)),
                    datasets: [{ label: 'Operaciones', data: top.map((f) => f.operaciones), backgroundColor: COLORES[0] }]
                },
                options: opcionesGrafica()
            });
        }
        pintarAvisos(Motor.validar(total));
    }

    // ── C · Operaciones ──────────────────────────────────────────────────────
    async function pintarOperaciones() {
        const [mensual, clasif, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['segmento_aviacion', 'naturaleza_operacion'], null, 100),
            totalPeriodo(desde(), hasta())
        ]);

        $('est-ops-tarjetas').innerHTML = [
            tarjeta('Operaciones válidas', Motor.fmtEntero(total.operaciones), 'Excluye canceladas'),
            tarjeta('Llegadas', Motor.fmtEntero(total.operacionesLlegada), ''),
            tarjeta('Salidas', Motor.fmtEntero(total.operacionesSalida), ''),
            tarjeta('Nacional / Internacional',
                `${Motor.fmtEntero(total.operacionesNacional)} / ${Motor.fmtEntero(total.operacionesInternacional)}`, ''),
            tarjeta('Canceladas', Motor.fmtEntero(total.operacionesCanceladas), 'No cuentan en ninguna métrica')
        ].join('');

        pintarGrafica('est-ops-chart', {
            type: 'bar',
            data: {
                labels: mensual.map((f) => f.d1),
                datasets: [
                    { label: 'Llegadas', data: mensual.map((f) => f.operacionesLlegada), backgroundColor: COLORES[0] },
                    { label: 'Salidas', data: mensual.map((f) => f.operacionesSalida), backgroundColor: COLORES[1] }
                ]
            },
            options: opcionesGrafica({ scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } })
        });

        pintarTabla('est-ops-tabla', [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Llegadas', clave: 'operacionesLlegada', tipo: 'numero' },
            { titulo: 'Salidas', clave: 'operacionesSalida', tipo: 'numero' },
            { titulo: 'Nacional', clave: 'operacionesNacional', tipo: 'numero' },
            { titulo: 'Internacional', clave: 'operacionesInternacional', tipo: 'numero' },
            { titulo: 'Canceladas', clave: 'operacionesCanceladas', tipo: 'numero' },
            { titulo: 'Sin clasificar', clave: 'operacionesSinClasificar', tipo: 'numero' }
        ], mensual, { total, etiquetaTotal: 'TOTAL' });

        pintarTabla('est-ops-clasif', [
            { titulo: 'Segmento', valor: (f) => f.d1 },
            { titulo: 'Naturaleza', valor: (f) => f.d2 },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Carga', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'Participación', valor: (f) => total.operaciones > 0 ? (f.operaciones / total.operaciones) * 100 : null, tipo: 'porcentaje' }
        ], clasif, { total, etiquetaTotal: 'TOTAL' });

        pintarAvisos(Motor.validar(total));
    }

    // ── D · Pasajeros ────────────────────────────────────────────────────────
    async function pintarPasajeros() {
        const [mensual, porAerolinea, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['aerolinea'], null, 500),
            totalPeriodo(desde(), hasta())
        ]);

        const cobOcup = Motor.cobertura(total.operacionesConOcupacion, total.operaciones);
        $('est-pax-tarjetas').innerHTML = [
            // PAX TOTAL = pasajeros de llegada + pasajeros de salida.
            tarjeta('Pasajeros totales', Motor.fmtEntero(total.paxTotal),
                `Llegada ${Motor.fmtEntero(total.paxLlegada)} + Salida ${Motor.fmtEntero(total.paxSalida)}`),
            tarjeta('Nacional', Motor.fmtEntero(total.paxNacional), ''),
            tarjeta('Internacional', Motor.fmtEntero(total.paxInternacional), ''),
            tarjeta('Factor de ocupación', Motor.fmtPorcentaje(total.factorOcupacion),
                `Calculado con ${cobOcup.texto} de las operaciones`),
            tarjeta('Promedio por operación',
                total.operacionesConPax > 0 ? Motor.fmtEntero((total.paxTotal || 0) / total.operacionesConPax) : '—',
                `${Motor.fmtEntero(total.operacionesConPax)} operaciones con dato de pasajeros`)
        ].join('');

        pintarGrafica('est-pax-chart', {
            type: 'line',
            data: {
                labels: mensual.map((f) => f.d1),
                datasets: [
                    { label: 'Llegada', data: mensual.map((f) => f.paxLlegada), borderColor: COLORES[0], backgroundColor: COLORES[0], tension: 0.25 },
                    { label: 'Salida', data: mensual.map((f) => f.paxSalida), borderColor: COLORES[1], backgroundColor: COLORES[1], tension: 0.25 },
                    { label: 'Total', data: mensual.map((f) => f.paxTotal), borderColor: COLORES[2], backgroundColor: COLORES[2], borderDash: [5, 4], tension: 0.25 }
                ]
            },
            options: opcionesGrafica()
        });

        pintarTabla('est-pax-tabla', [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Pax llegada', clave: 'paxLlegada', tipo: 'numero' },
            { titulo: 'Pax salida', clave: 'paxSalida', tipo: 'numero' },
            { titulo: 'Pax total', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Nacional', clave: 'paxNacional', tipo: 'numero' },
            { titulo: 'Internacional', clave: 'paxInternacional', tipo: 'numero' },
            { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' }
        ], mensual, { total, etiquetaTotal: 'TOTAL' });

        const conOcupacion = porAerolinea
            .filter((f) => f.factorOcupacion !== null)
            .sort((a, b) => (b.paxTotal || 0) - (a.paxTotal || 0));
        pintarTabla('est-pax-ocupacion', [
            { titulo: 'Aerolínea', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Asientos ofrecidos', clave: 'ocupacionCapacidad', tipo: 'numero' },
            { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' },
            { titulo: 'Cobertura', valor: (f) => Motor.cobertura(f.operacionesConOcupacion, f.operaciones).texto }
        ], conOcupacion, { vacio: 'Ninguna operación del periodo tiene a la vez pasajeros y capacidad de matrícula.' });

        pintarAvisos(Motor.validar(total));
    }

    // ── E · Aerolíneas ───────────────────────────────────────────────────────
    async function pintarAerolineas() {
        const rangoAnioAnterior = Motor.mismoPeriodoAnioAnterior(desde(), hasta());
        const [actual, anterior] = await Promise.all([
            agregado(desde(), hasta(), ['aerolinea'], null, 1000),
            agregado(rangoAnioAnterior.desde, rangoAnioAnterior.hasta, ['aerolinea'], null, 1000)
        ]);
        const previo = new Map(anterior.map((f) => [f.d1, f]));
        const repartoOps = Motor.participacion(actual, 'operaciones');
        const repartoPax = Motor.participacion(actual, 'paxTotal');
        const paxPorAerolinea = new Map(repartoPax.filas.map((f) => [f.d1, f.participacion]));

        const filas = repartoOps.filas
            .slice()
            .sort((a, b) => b.operaciones - a.operaciones)
            .map((f) => Object.assign({}, f, {
                participacionPax: paxPorAerolinea.get(f.d1) ?? null,
                crecimiento: Motor.variacion(previo.get(f.d1)?.operaciones ?? null, f.operaciones)
            }));

        const top = filas.slice(0, 12);
        pintarGrafica('est-aero-chart', {
            type: 'bar',
            data: {
                labels: top.map((f) => f.d1),
                datasets: [
                    { label: 'Operaciones', data: top.map((f) => f.operaciones), backgroundColor: COLORES[0] },
                    { label: 'Pasajeros', data: top.map((f) => f.paxTotal), backgroundColor: COLORES[1], yAxisID: 'y1' }
                ]
            },
            options: opcionesGrafica({
                scales: {
                    y: { beginAtZero: true, position: 'left' },
                    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
                }
            })
        });

        pintarTabla('est-aero-tabla', [
            { titulo: 'Aerolínea', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: '% operaciones', clave: 'participacion', tipo: 'porcentaje' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: '% pasajeros', clave: 'participacionPax', tipo: 'porcentaje' },
            { titulo: 'Carga', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' },
            { titulo: 'Crecimiento anual', clave: 'crecimiento', html: (f) => chipVariacion(f.crecimiento, '') }
        ], filas, { total: totalDe(actual), etiquetaTotal: 'TOTAL' });

        const avisos = Motor.validar(totalDe(actual));
        if (!repartoOps.cuadra && repartoOps.total > 0) {
            avisos.push({
                nivel: 'aviso',
                clave: 'participacion',
                mensaje: `Las participaciones por aerolínea suman ${Motor.fmtPorcentaje(repartoOps.sumaParticipacion)} en vez de 100 %.`
            });
        }
        pintarAvisos(avisos);
    }

    // ── F · Rutas y destinos ─────────────────────────────────────────────────
    async function pintarRutas() {
        const rangoAnioAnterior = Motor.mismoPeriodoAnioAnterior(desde(), hasta());
        const [actual, anterior, total] = await Promise.all([
            agregado(desde(), hasta(), ['endpoint', 'ciudad'], null, 2000),
            agregado(rangoAnioAnterior.desde, rangoAnioAnterior.hasta, ['endpoint'], null, 2000),
            totalPeriodo(desde(), hasta())
        ]);
        const previo = new Map(anterior.map((f) => [f.d1, f]));
        const reparto = Motor.participacion(actual, 'operaciones');
        const filas = reparto.filas
            .slice()
            .sort((a, b) => b.operaciones - a.operaciones)
            .map((f) => Object.assign({}, f, {
                crecimiento: Motor.variacion(previo.get(f.d1)?.operaciones ?? null, f.operaciones)
            }));

        $('est-rutas-tarjetas').innerHTML = [
            tarjeta('Destinos y orígenes distintos', Motor.fmtEntero(filas.length), 'En el periodo y con los filtros vigentes'),
            tarjeta('Operaciones nacionales', Motor.fmtEntero(total.operacionesNacional), ''),
            tarjeta('Operaciones internacionales', Motor.fmtEntero(total.operacionesInternacional), ''),
            tarjeta('Sin determinar', Motor.fmtEntero(total.operaciones - total.operacionesNacional - total.operacionesInternacional),
                'La ruta no resolvió contra el catálogo de aeropuertos')
        ].join('');

        const top = filas.slice(0, 20);
        pintarGrafica('est-rutas-chart', {
            type: 'bar',
            data: {
                labels: top.map((f) => f.d2 || f.d1),
                datasets: [{ label: 'Operaciones', data: top.map((f) => f.operaciones), backgroundColor: COLORES[0] }]
            },
            options: opcionesGrafica({ indexAxis: 'y', scales: { x: { beginAtZero: true } } })
        });

        pintarTabla('est-rutas-tabla', [
            { titulo: 'Código', clave: 'd1' },
            { titulo: 'Ciudad', clave: 'd2' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: '% del total', clave: 'participacion', tipo: 'porcentaje' },
            { titulo: 'Llegadas', clave: 'operacionesLlegada', tipo: 'numero' },
            { titulo: 'Salidas', clave: 'operacionesSalida', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Carga', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'Crecimiento anual', clave: 'crecimiento', html: (f) => chipVariacion(f.crecimiento, '') }
        ], filas, { total, etiquetaTotal: 'TOTAL' });
    }

    // ── G · Aeronaves ────────────────────────────────────────────────────────
    async function pintarAeronaves() {
        const [porTipo, porMatricula, total] = await Promise.all([
            agregado(desde(), hasta(), ['tipo_aeronave'], null, 1000),
            agregado(desde(), hasta(), ['matricula'], null, 3000),
            totalPeriodo(desde(), hasta())
        ]);

        const columnas = (etiqueta) => [
            { titulo: etiqueta, clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Asientos ofrecidos', clave: 'ocupacionCapacidad', tipo: 'numero' },
            {
                titulo: 'Capacidad promedio',
                valor: (f) => f.operacionesConOcupacion > 0 ? (f.ocupacionCapacidad || 0) / f.operacionesConOcupacion : null,
                tipo: 'numero'
            },
            { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' },
            { titulo: 'Carga', clave: 'cargaTotalKg', tipo: 'carga' }
        ];

        pintarTabla('est-aeronaves-tipo', columnas('Tipo de aeronave'),
            porTipo.slice().sort((a, b) => b.operaciones - a.operaciones), { total, etiquetaTotal: 'TOTAL' });
        pintarTabla('est-aeronaves-matricula', columnas('Matrícula'),
            porMatricula.slice().sort((a, b) => b.operaciones - a.operaciones), { total, etiquetaTotal: 'TOTAL' });
    }

    // ── H · Carga ────────────────────────────────────────────────────────────
    async function pintarCarga() {
        const [mensual, porAerolinea, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['aerolinea'], null, 1000),
            totalPeriodo(desde(), hasta())
        ]);

        $('est-carga-tarjetas').innerHTML = [
            tarjeta('Carga transportada', Motor.fmtToneladas(total.cargaTotalKg),
                `Nacional ${Motor.fmtToneladas(total.cargaNacionalKg)} · Internacional ${Motor.fmtToneladas(total.cargaInternacionalKg)}`),
            tarjeta('Descargada en AIFA', Motor.fmtToneladas(total.cargaDescargadaKg), 'Movimientos de llegada'),
            tarjeta('Embarcada en AIFA', Motor.fmtToneladas(total.cargaEmbarcadaKg), 'Movimientos de salida'),
            tarjeta('En tránsito', Motor.fmtToneladas(total.cargaTransitoKg),
                'Contabilizada una sola vez por rotación'),
            tarjeta('Correo', Motor.fmtToneladas(total.correoKg), '')
        ].join('');

        // Aviso honesto: mientras nadie capture el desglose, "descargada" y
        // "embarcada" son la carga transportada, no una medición aparte.
        const nota = $('est-carga-nota');
        const cob = Motor.cobertura(total.operacionesConDesgloseCarga, total.operacionesConCarga);
        if (nota) {
            if (cob.porcentaje === null || cob.porcentaje < 100) {
                nota.classList.remove('d-none');
                nota.innerHTML = '<i class="fas fa-circle-info me-1"></i>'
                    + `Desglose de carga capturado en ${esc(cob.texto)} de las operaciones con carga. `
                    + 'En las demás, "descargada" y "embarcada" se deducen de la carga transportada '
                    + '(que es lo mismo mientras no haya tránsito capturado) y el tránsito aparece en cero.';
            } else {
                nota.classList.add('d-none');
            }
        }

        pintarGrafica('est-carga-chart', {
            type: 'bar',
            data: {
                labels: mensual.map((f) => f.d1),
                datasets: [
                    { label: 'Nacional (t)', data: mensual.map((f) => Motor.kgAToneladas(f.cargaNacionalKg)), backgroundColor: COLORES[0] },
                    { label: 'Internacional (t)', data: mensual.map((f) => Motor.kgAToneladas(f.cargaInternacionalKg)), backgroundColor: COLORES[2] },
                    {
                        label: 'Total transportada (t)',
                        data: mensual.map((f) => Motor.kgAToneladas(f.cargaTotalKg)),
                        type: 'line', borderColor: COLORES[4], backgroundColor: COLORES[4], tension: 0.25
                    }
                ]
            },
            options: opcionesGrafica({ scales: { x: { stacked: true }, y: { stacked: false, beginAtZero: true } } })
        });

        const columnasCarga = [
            { titulo: 'Transportada', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'Nacional', clave: 'cargaNacionalKg', tipo: 'carga' },
            { titulo: 'Internacional', clave: 'cargaInternacionalKg', tipo: 'carga' },
            { titulo: 'Descargada', clave: 'cargaDescargadaKg', tipo: 'carga' },
            { titulo: 'Embarcada', clave: 'cargaEmbarcadaKg', tipo: 'carga' },
            { titulo: 'En tránsito', clave: 'cargaTransitoKg', tipo: 'carga' },
            { titulo: 'Correo', clave: 'correoKg', tipo: 'carga' }
        ];

        pintarTabla('est-carga-tabla',
            [{ titulo: 'Periodo', clave: 'd1' }].concat(columnasCarga).concat([
                { titulo: 'Operaciones con carga', clave: 'operacionesConCarga', tipo: 'numero' }
            ]), mensual, { total, etiquetaTotal: 'TOTAL' });

        pintarTabla('est-carga-aerolinea',
            [{ titulo: 'Aerolínea', clave: 'd1' }].concat(columnasCarga).concat([
                { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' }
            ]),
            porAerolinea.filter((f) => (f.cargaTotalKg || 0) > 0).sort((a, b) => (b.cargaTotalKg || 0) - (a.cargaTotalKg || 0)),
            { total, etiquetaTotal: 'TOTAL', vacio: 'Ninguna operación del periodo reporta carga.' });

        pintarAvisos(Motor.validar(total));
    }

    // ── I · Puntualidad y demoras ────────────────────────────────────────────
    async function pintarPuntualidad() {
        const [mensual, porAerolinea, porCausa, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['aerolinea'], null, 1000),
            agregado(desde(), hasta(), ['codigo_demora', 'causa_demora'], null, 500),
            totalPeriodo(desde(), hasta())
        ]);

        const cob = Motor.cobertura(total.operacionesEvaluablesPuntualidad, total.operaciones);
        $('est-punt-tarjetas').innerHTML = [
            tarjeta('Puntualidad', Motor.fmtPorcentaje(total.puntualidadPorcentaje),
                `Evaluada sobre ${cob.texto} de las operaciones`),
            tarjeta('A tiempo', Motor.fmtEntero(total.operacionesPuntuales), 'Hasta 15 minutos de diferencia'),
            tarjeta('Demoradas', Motor.fmtEntero(total.operacionesDemoradas), 'Más de 15 minutos'),
            tarjeta('Demora promedio', total.demoraPromedio === null ? '—' : `${Motor.fmtDecimal(total.demoraPromedio)} min`, ''),
            tarjeta('Máxima / mínima',
                `${total.demoraMaxima === null ? '—' : Motor.fmtEntero(total.demoraMaxima)} / ${total.demoraMinima === null ? '—' : Motor.fmtEntero(total.demoraMinima)} min`,
                'Minutos contra la hora programada')
        ].join('');

        pintarGrafica('est-punt-chart', {
            type: 'line',
            data: {
                labels: mensual.map((f) => f.d1),
                datasets: [
                    { label: 'Puntualidad (%)', data: mensual.map((f) => f.puntualidadPorcentaje), borderColor: COLORES[1], backgroundColor: COLORES[1], tension: 0.25 },
                    { label: 'Demora promedio (min)', data: mensual.map((f) => f.demoraPromedio), borderColor: COLORES[2], backgroundColor: COLORES[2], tension: 0.25, yAxisID: 'y1' }
                ]
            },
            options: opcionesGrafica({
                scales: {
                    y: { beginAtZero: true, position: 'left', suggestedMax: 100 },
                    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
                }
            })
        });

        const columnasPunt = [
            { titulo: 'A tiempo', clave: 'operacionesPuntuales', tipo: 'numero' },
            { titulo: 'Demoradas', clave: 'operacionesDemoradas', tipo: 'numero' },
            { titulo: 'Evaluables', clave: 'operacionesEvaluablesPuntualidad', tipo: 'numero' },
            { titulo: 'Puntualidad', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' },
            { titulo: 'Demora prom. (min)', clave: 'demoraPromedio', tipo: 'decimal' },
            { titulo: 'Máx (min)', clave: 'demoraMaxima', tipo: 'numero' },
            { titulo: 'Mín (min)', clave: 'demoraMinima', tipo: 'numero' }
        ];

        pintarTabla('est-punt-aerolinea',
            [{ titulo: 'Aerolínea', clave: 'd1' }, { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' }].concat(columnasPunt),
            porAerolinea.filter((f) => f.operacionesEvaluablesPuntualidad > 0)
                .sort((a, b) => b.operaciones - a.operaciones),
            { total, etiquetaTotal: 'TOTAL', vacio: 'Ninguna operación del periodo tiene hora real ni dictamen de puntualidad.' });

        pintarTabla('est-punt-causas', [
            { titulo: 'Código', clave: 'd1' },
            { titulo: 'Causa', clave: 'd2' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Demoradas', clave: 'operacionesDemoradas', tipo: 'numero' },
            { titulo: 'Minutos acumulados', clave: 'minutosDemoraTotal', tipo: 'numero' },
            { titulo: 'Demora prom. (min)', clave: 'demoraPromedio', tipo: 'decimal' }
        ], porCausa.filter((f) => f.d1 || f.d2).sort((a, b) => b.operacionesDemoradas - a.operacionesDemoradas),
            { vacio: 'No hay códigos ni causas de demora capturados en el periodo.' });

        pintarAvisos(Motor.validar(total));
    }

    // ── J · Comparador ───────────────────────────────────────────────────────
    function aplicarPresetComparador() {
        const preset = $('est-cmp-preset')?.value;
        const A = { desde: desde(), hasta: hasta() };
        let B = null;
        if (preset === 'anio_anterior') B = Motor.mismoPeriodoAnioAnterior(A.desde, A.hasta);
        else if (preset === 'periodo_anterior') B = Motor.periodoAnterior(A.desde, A.hasta);
        else if (preset === 'mes_actual_vs_anterior') {
            const { anio, mes } = Motor.partesIso(Motor.hoyIso());
            const actual = Motor.rangoMes(anio, mes);
            B = mes === 1 ? Motor.rangoMes(anio - 1, 12) : Motor.rangoMes(anio, mes - 1);
            $('est-cmp-a-desde').value = actual.desde;
            $('est-cmp-a-hasta').value = actual.hasta;
            $('est-cmp-b-desde').value = B.desde;
            $('est-cmp-b-hasta').value = B.hasta;
            return;
        } else return; // personalizado: se respeta lo que el usuario escribió
        $('est-cmp-a-desde').value = A.desde || '';
        $('est-cmp-a-hasta').value = A.hasta || '';
        $('est-cmp-b-desde').value = B.desde || '';
        $('est-cmp-b-hasta').value = B.hasta || '';
    }

    async function pintarComparador() {
        if (!$('est-cmp-a-desde')?.value) aplicarPresetComparador();
        const a = { desde: $('est-cmp-a-desde')?.value, hasta: $('est-cmp-a-hasta')?.value };
        const b = { desde: $('est-cmp-b-desde')?.value, hasta: $('est-cmp-b-hasta')?.value };
        if (!a.desde || !a.hasta || !b.desde || !b.hasta) {
            mostrarError('El comparador necesita las cuatro fechas.');
            return;
        }
        mostrarError(null);

        // En el comparador el orden es B (referencia) → A (actual): la variación
        // se lee "cuánto cambió A respecto de B".
        const [totalA, totalB] = await Promise.all([
            totalPeriodo(a.desde, a.hasta),
            totalPeriodo(b.desde, b.hasta)
        ]);
        const etiquetaA = Motor.etiquetaRango(a.desde, a.hasta);
        const etiquetaB = Motor.etiquetaRango(b.desde, b.hasta);
        const comparacion = Motor.comparar(totalB, totalA, etiquetaB, etiquetaA);
        state.ultimoComparador = { comparacion, etiquetaA, etiquetaB };

        pintarTabla('est-cmp-tabla', [
            { titulo: 'Indicador', clave: 'etiqueta' },
            { titulo: etiquetaB, valor: (f) => Motor.formatearPorTipo(f.valorA, f.tipo) },
            { titulo: etiquetaA, valor: (f) => Motor.formatearPorTipo(f.valorB, f.tipo) },
            { titulo: 'Diferencia', valor: (f) => f.variacion.absoluta === null ? '—' : Motor.formatearPorTipo(f.variacion.absoluta, f.tipo) },
            { titulo: 'Variación', clave: 'variacion', html: (f) => chipVariacion(f.variacion, '') }
        ], comparacion.metricas);
    }

    // ── L · Centro de descargas ──────────────────────────────────────────────
    //
    // Un solo lugar para todo lo descargable. Agregar un documento nuevo es
    // agregar una entrada a esta lista: no hay que tocar ninguna pantalla.
    const DOCUMENTOS = [
        {
            clave: 'resumen', titulo: 'Resumen estadístico del periodo', icono: 'fa-gauge-high',
            descripcion: 'Totales de operaciones, pasajeros, carga, ocupación y puntualidad, más los indicadores de calidad del dato.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'mensual', titulo: 'Serie mensual', icono: 'fa-chart-line',
            descripcion: 'Un renglón por mes con todas las métricas del motor.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'aerolinea', titulo: 'Reporte por aerolínea', icono: 'fa-plane',
            descripcion: 'Participación por operaciones y pasajeros, carga y factor de ocupación.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'ruta', titulo: 'Reporte por ruta y destino', icono: 'fa-route',
            descripcion: 'Origen/destino, nacional o internacional, participación y crecimiento.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'pasajeros', titulo: 'Reporte de pasajeros', icono: 'fa-users',
            descripcion: 'Llegada, salida, nacional, internacional y factor de ocupación por mes.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'carga', titulo: 'Reporte de carga', icono: 'fa-box',
            descripcion: 'Transportada, nacional, internacional, descargada, embarcada y en tránsito.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'puntualidad', titulo: 'Reporte de puntualidad', icono: 'fa-clock',
            descripcion: 'Operaciones a tiempo y demoradas, minutos de demora y causas.',
            nivel: 'read', formatos: ['csv', 'xlsx']
        },
        {
            clave: 'comparativo', titulo: 'Comparativo entre periodos', icono: 'fa-scale-balanced',
            descripcion: 'Los dos periodos del comparador con diferencia absoluta y porcentual. Requiere haber comparado antes.',
            nivel: 'read', formatos: ['csv']
        },
        {
            clave: 'detalle', titulo: 'Detalle de operaciones (filtrado)', icono: 'fa-table-list',
            descripcion: 'Una fila por movimiento con todos los campos resueltos. Exporta el resultado completo del filtro, no la página visible.',
            nivel: 'capture', formatos: ['csv']
        },
        {
            clave: 'sin_clasificar', titulo: 'Operaciones sin clasificar', icono: 'fa-circle-question',
            descripcion: 'Combinaciones que ninguna regla resuelve, con su conteo. Sirve para decidir qué reglas faltan.',
            nivel: 'read', formatos: ['csv']
        },
        {
            clave: 'informe_oficial', titulo: 'Informe Estadístico oficial (PDF)', icono: 'fa-file-pdf',
            descripcion: 'Documento institucional en tamaño oficio con visto bueno. Se genera desde la sub-pestaña "Informe oficial", sin cambios.',
            nivel: 'edit', formatos: ['ir']
        },
        {
            clave: 'resumen_oficial', titulo: 'Resumen Estadístico oficial (PDF)', icono: 'fa-file-pdf',
            descripcion: 'Documento institucional de 17 hojas en tamaño carta. Se genera desde la sub-pestaña "Informe oficial", sin cambios.',
            nivel: 'edit', formatos: ['ir']
        }
    ];

    function nivelAlcanza(requerido) {
        const orden = { none: 0, read: 1, capture: 2, edit: 3, admin: 4 };
        return (orden[state.nivel] || 0) >= (orden[requerido] || 0);
    }

    function pintarDescargas() {
        const host = $('est-descargas-lista');
        if (!host) return;
        host.innerHTML = DOCUMENTOS.map((doc) => {
            const permitido = nivelAlcanza(doc.nivel);
            const botones = doc.formatos.map((f) => {
                if (f === 'ir') {
                    return `<button class="btn btn-sm btn-outline-primary" data-est-doc="${esc(doc.clave)}" data-est-formato="ir" ${permitido ? '' : 'disabled'}>
                        <i class="fas fa-arrow-right me-1"></i>Ir al documento</button>`;
                }
                const icono = f === 'csv' ? 'fa-file-csv' : 'fa-file-excel';
                return `<button class="btn btn-sm btn-outline-success" data-est-doc="${esc(doc.clave)}" data-est-formato="${esc(f)}" ${permitido ? '' : 'disabled'}>
                    <i class="fas ${icono} me-1"></i>${f.toUpperCase()}</button>`;
            }).join(' ');
            return `<div class="col-12 col-md-6 col-xl-4">
                <div class="card h-100 shadow-sm border-0">
                    <div class="card-body d-flex flex-column">
                        <h6 class="fw-semibold text-primary mb-1"><i class="fas ${esc(doc.icono)} me-2"></i>${esc(doc.titulo)}</h6>
                        <p class="text-muted mb-3" style="font-size:.78rem">${esc(doc.descripcion)}</p>
                        <div class="mt-auto d-flex gap-2 flex-wrap align-items-center">
                            ${botones}
                            ${permitido ? '' : '<small class="text-muted"><i class="fas fa-lock me-1"></i>Requiere más permisos</small>'}
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // ── Descarga ─────────────────────────────────────────────────────────────
    function descargarBlob(blob, nombre) {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombre;
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function descargarCsv(columnas, filas, nombre) {
        const csv = Motor.construirCsv(columnas, filas);
        // El BOM es lo que hace que Excel abra los acentos bien.
        descargarBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`);
    }

    async function descargarExcel(hojas, nombre) {
        if (typeof ExcelJS === 'undefined') {
            mostrarError('No se pudo cargar ExcelJS. Descarga el CSV.');
            return;
        }
        const libro = new ExcelJS.Workbook();
        hojas.forEach(({ titulo, columnas, filas }) => {
            const hoja = libro.addWorksheet(titulo.slice(0, 31));
            hoja.addRow(columnas.map((c) => c.titulo));
            filas.forEach((fila) => {
                hoja.addRow(columnas.map((col) => {
                    const bruto = typeof col.valor === 'function' ? col.valor(fila) : fila[col.clave];
                    if (col.tipo === 'numero' || col.tipo === 'decimal' || col.tipo === 'porcentaje' || col.tipo === 'carga') {
                        return Motor.toNumero(bruto);
                    }
                    return bruto ?? '';
                }));
            });
            const encabezado = hoja.getRow(1);
            encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            encabezado.eachCell((celda) => {
                celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1F44' } };
            });
            hoja.columns.forEach((col, i) => {
                col.width = 20;
                const tipo = columnas[i]?.tipo;
                if (tipo === 'numero') col.numFmt = '#,##0';
                if (tipo === 'decimal' || tipo === 'carga') col.numFmt = '#,##0.00';
                if (tipo === 'porcentaje') col.numFmt = '0.00"%"';
            });
        });
        const buffer = await libro.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (typeof saveAs === 'function') saveAs(blob, `${nombre}.xlsx`);
        else descargarBlob(blob, `${nombre}.xlsx`);
    }

    const COLUMNAS_DOC = {
        mensual: [{ titulo: 'Periodo', clave: 'd1' }].concat(COLUMNAS_METRICAS),
        aerolinea: [
            { titulo: 'Aerolínea', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Llegadas', clave: 'operacionesLlegada', tipo: 'numero' },
            { titulo: 'Salidas', clave: 'operacionesSalida', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Carga (kg)', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'Asientos ofrecidos', clave: 'ocupacionCapacidad', tipo: 'numero' },
            { titulo: 'Factor de ocupación (%)', clave: 'factorOcupacion', tipo: 'porcentaje' },
            { titulo: 'Puntualidad (%)', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' }
        ],
        ruta: [
            { titulo: 'Código', clave: 'd1' },
            { titulo: 'Ciudad', clave: 'd2' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Llegadas', clave: 'operacionesLlegada', tipo: 'numero' },
            { titulo: 'Salidas', clave: 'operacionesSalida', tipo: 'numero' },
            { titulo: 'Nacional', clave: 'operacionesNacional', tipo: 'numero' },
            { titulo: 'Internacional', clave: 'operacionesInternacional', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Carga (kg)', clave: 'cargaTotalKg', tipo: 'carga' }
        ],
        pasajeros: [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Pax llegada', clave: 'paxLlegada', tipo: 'numero' },
            { titulo: 'Pax salida', clave: 'paxSalida', tipo: 'numero' },
            { titulo: 'Pax total', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Pax nacional', clave: 'paxNacional', tipo: 'numero' },
            { titulo: 'Pax internacional', clave: 'paxInternacional', tipo: 'numero' },
            { titulo: 'Asientos ofrecidos', clave: 'ocupacionCapacidad', tipo: 'numero' },
            { titulo: 'Factor de ocupación (%)', clave: 'factorOcupacion', tipo: 'porcentaje' },
            { titulo: 'Operaciones con dato de pax', clave: 'operacionesConPax', tipo: 'numero' }
        ],
        carga: [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Transportada (kg)', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'Nacional (kg)', clave: 'cargaNacionalKg', tipo: 'carga' },
            { titulo: 'Internacional (kg)', clave: 'cargaInternacionalKg', tipo: 'carga' },
            { titulo: 'Descargada (kg)', clave: 'cargaDescargadaKg', tipo: 'carga' },
            { titulo: 'Embarcada (kg)', clave: 'cargaEmbarcadaKg', tipo: 'carga' },
            { titulo: 'En tránsito (kg)', clave: 'cargaTransitoKg', tipo: 'carga' },
            { titulo: 'Correo (kg)', clave: 'correoKg', tipo: 'carga' },
            { titulo: 'Operaciones con carga', clave: 'operacionesConCarga', tipo: 'numero' },
            { titulo: 'Con desglose capturado', clave: 'operacionesConDesgloseCarga', tipo: 'numero' }
        ],
        puntualidad: [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'A tiempo', clave: 'operacionesPuntuales', tipo: 'numero' },
            { titulo: 'Demoradas', clave: 'operacionesDemoradas', tipo: 'numero' },
            { titulo: 'Evaluables', clave: 'operacionesEvaluablesPuntualidad', tipo: 'numero' },
            { titulo: 'Puntualidad (%)', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' },
            { titulo: 'Minutos de demora', clave: 'minutosDemoraTotal', tipo: 'numero' },
            { titulo: 'Demora promedio (min)', clave: 'demoraPromedio', tipo: 'decimal' },
            { titulo: 'Demora máxima (min)', clave: 'demoraMaxima', tipo: 'numero' },
            { titulo: 'Demora mínima (min)', clave: 'demoraMinima', tipo: 'numero' }
        ]
    };

    const COLUMNAS_DETALLE = [
        { titulo: 'Fecha', clave: 'fecha_operacion' },
        { titulo: 'Movimiento', clave: 'tipo_movimiento' },
        { titulo: 'Vuelo', clave: 'numero_vuelo' },
        { titulo: 'Aerolínea', clave: 'aerolinea' },
        { titulo: 'Matrícula', clave: 'matricula' },
        { titulo: 'Tipo aeronave', clave: 'tipo_aeronave' },
        { titulo: 'Capacidad', clave: 'capacidad_pasajeros', tipo: 'numero' },
        { titulo: 'Tipo servicio', clave: 'tipo_servicio' },
        { titulo: 'Descripción servicio', clave: 'tipo_servicio_descripcion' },
        { titulo: 'Origen', clave: 'origen_codigo' },
        { titulo: 'Destino', clave: 'destino_codigo' },
        { titulo: 'Ciudad', clave: 'endpoint_ciudad' },
        { titulo: 'Nacional/Internacional', clave: 'nacional_internacional' },
        { titulo: 'Segmento', clave: 'segmento_aviacion' },
        { titulo: 'Naturaleza', clave: 'naturaleza_operacion' },
        { titulo: 'Cancelada', valor: (f) => f.es_cancelada ? 'Sí' : 'No' },
        { titulo: 'Pasajeros', clave: 'pax', tipo: 'numero' },
        { titulo: 'Carga (kg)', clave: 'carga_total_kg', tipo: 'carga' },
        { titulo: 'Carga nacional (kg)', clave: 'carga_nacional_kg', tipo: 'carga' },
        { titulo: 'Carga internacional (kg)', clave: 'carga_internacional_kg', tipo: 'carga' },
        { titulo: 'Descargada (kg)', clave: 'carga_descargada_kg', tipo: 'carga' },
        { titulo: 'Embarcada (kg)', clave: 'carga_embarcada_kg', tipo: 'carga' },
        { titulo: 'Tránsito capturado (kg)', clave: 'carga_transito_kg', tipo: 'carga' },
        { titulo: 'Tránsito contable (kg)', clave: 'transito_contable_kg', tipo: 'carga' },
        { titulo: 'Correo (kg)', clave: 'correo_kg', tipo: 'carga' },
        { titulo: 'Minutos de demora', clave: 'minutos_demora', tipo: 'numero' },
        { titulo: 'Puntual', valor: (f) => f.es_puntual === null || f.es_puntual === undefined ? '' : (f.es_puntual ? 'Sí' : 'No') },
        { titulo: 'Código demora', clave: 'codigo_demora' },
        { titulo: 'Causa demora', clave: 'causa_demora' },
        { titulo: 'Rotación', clave: 'rotacion_id' },
        { titulo: 'Conciliado', valor: (f) => f.capturado ? 'Sí' : 'No' },
        { titulo: 'Fuente', clave: 'fuente_principal' }
    ];

    // El detalle se pide paginado: PostgREST corta las respuestas, y aunque no
    // lo hiciera, traer 200 mil filas de una sola vez tumba la pestaña.
    async function traerDetalleCompleto() {
        const client = await getClient();
        const filtros = Motor.filtrosAJson(state.filtros);
        const pagina = 10000;
        const TOPE = 200000;
        const filas = [];
        for (let offset = 0; offset < TOPE; offset += pagina) {
            const { data, error } = await client.rpc('estadistica_detalle', {
                p_desde: desde(), p_hasta: hasta(), p_filtros: filtros, p_limite: pagina, p_offset: offset
            });
            if (error) throw error;
            filas.push(...(data || []));
            if (!data || data.length < pagina) break;
        }
        return filas;
    }

    async function generarDocumento(clave, formato) {
        const sufijo = `${desde()}_a_${hasta()}`;
        const doc = DOCUMENTOS.find((d) => d.clave === clave);
        if (doc && !nivelAlcanza(doc.nivel)) {
            mostrarError('No tienes permisos para generar ese documento.');
            return;
        }
        mostrarError(null);

        if (formato === 'ir') {
            document.getElementById('est-tab-informe')?.click();
            return;
        }

        if (clave === 'resumen') {
            const total = await totalPeriodo(desde(), hasta());
            const columnas = [{ titulo: 'Indicador', clave: 'indicador' }, { titulo: 'Valor', clave: 'valor' }];
            const filas = [
                ['Periodo', Motor.etiquetaRango(desde(), hasta())],
                ['Operaciones válidas', total.operaciones],
                ['Operaciones de llegada', total.operacionesLlegada],
                ['Operaciones de salida', total.operacionesSalida],
                ['Operaciones canceladas (excluidas)', total.operacionesCanceladas],
                ['Operaciones nacionales', total.operacionesNacional],
                ['Operaciones internacionales', total.operacionesInternacional],
                ['Pasajeros totales', total.paxTotal],
                ['Pasajeros de llegada', total.paxLlegada],
                ['Pasajeros de salida', total.paxSalida],
                ['Carga transportada (kg)', total.cargaTotalKg],
                ['Carga descargada (kg)', total.cargaDescargadaKg],
                ['Carga embarcada (kg)', total.cargaEmbarcadaKg],
                ['Carga en tránsito (kg)', total.cargaTransitoKg],
                ['Factor de ocupación (%)', total.factorOcupacion],
                ['Puntualidad (%)', total.puntualidadPorcentaje],
                ['Demora promedio (min)', total.demoraPromedio],
                ['Operaciones sin clasificar', total.operacionesSinClasificar]
            ].map(([indicador, valor]) => ({ indicador, valor }))
                .concat(Motor.calidad(total).map((c) => ({ indicador: c.etiqueta, valor: c.texto })));
            if (formato === 'csv') descargarCsv(columnas, filas, `estadistica_resumen_${sufijo}`);
            else await descargarExcel([{ titulo: 'Resumen', columnas, filas }], `estadistica_resumen_${sufijo}`);
            return;
        }

        if (clave === 'comparativo') {
            if (!state.ultimoComparador) {
                mostrarError('Primero usa el Comparador para elegir los dos periodos.');
                return;
            }
            const { comparacion, etiquetaA, etiquetaB } = state.ultimoComparador;
            const columnas = [
                { titulo: 'Indicador', clave: 'etiqueta' },
                { titulo: etiquetaB, valor: (f) => f.valorA, tipo: 'numero' },
                { titulo: etiquetaA, valor: (f) => f.valorB, tipo: 'numero' },
                { titulo: 'Diferencia absoluta', valor: (f) => f.variacion.absoluta, tipo: 'numero' },
                { titulo: 'Variación (%)', valor: (f) => f.variacion.porcentual, tipo: 'porcentaje' },
                { titulo: 'Nota', valor: (f) => f.variacion.estado === 'ok' ? '' : f.variacion.texto }
            ];
            descargarCsv(columnas, comparacion.metricas, `estadistica_comparativo_${sufijo}`);
            return;
        }

        if (clave === 'detalle') {
            const filas = await traerDetalleCompleto();
            descargarCsv(COLUMNAS_DETALLE, filas, `estadistica_detalle_${sufijo}`);
            return;
        }

        if (clave === 'sin_clasificar') {
            const client = await getClient();
            const { data, error } = await client.rpc('estadistica_sin_clasificar', {
                p_desde: desde(), p_hasta: hasta(), p_limite: 1000
            });
            if (error) throw error;
            const columnas = [
                { titulo: 'Aerolínea', clave: 'aerolinea' },
                { titulo: 'Tipo de aeronave', clave: 'tipo_aeronave' },
                { titulo: 'Tipo de servicio', clave: 'tipo_servicio' },
                { titulo: 'Descripción del servicio', clave: 'tipo_servicio_descripcion' },
                { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
                { titulo: 'Pasajeros', clave: 'pax_total', tipo: 'numero' },
                { titulo: 'Carga (kg)', clave: 'carga_total_kg', tipo: 'carga' },
                { titulo: 'Primera fecha', clave: 'primera_fecha' },
                { titulo: 'Última fecha', clave: 'ultima_fecha' },
                { titulo: 'Vuelo de ejemplo', clave: 'ejemplo_vuelo' }
            ];
            descargarCsv(columnas, data || [], `estadistica_sin_clasificar_${sufijo}`);
            return;
        }

        // Los demás son un agregado por una dimensión.
        const dimensionPorDocumento = {
            mensual: ['anio_mes'],
            aerolinea: ['aerolinea'],
            ruta: ['endpoint', 'ciudad'],
            pasajeros: ['anio_mes'],
            carga: ['anio_mes'],
            puntualidad: ['anio_mes']
        };
        const dims = dimensionPorDocumento[clave];
        if (!dims) return;
        const filas = await agregado(desde(), hasta(), dims, null, 5000);
        const columnas = COLUMNAS_DOC[clave] || COLUMNAS_DOC.mensual;
        const nombre = `estadistica_${clave}_${sufijo}`;
        if (formato === 'csv') descargarCsv(columnas, filas, nombre);
        else await descargarExcel([{ titulo: doc ? doc.titulo : clave, columnas, filas }], nombre);
    }

    // ── Orquestación de áreas ────────────────────────────────────────────────
    const RENDERIZADORES = {
        resumen: pintarResumen,
        explorador: pintarExplorador,
        operaciones: pintarOperaciones,
        pasajeros: pintarPasajeros,
        aerolineas: pintarAerolineas,
        rutas: pintarRutas,
        aeronaves: pintarAeronaves,
        carga: pintarCarga,
        puntualidad: pintarPuntualidad,
        comparador: pintarComparador,
        descargas: async () => pintarDescargas()
    };

    async function mostrarArea(area, forzar) {
        state.areaActiva = area;

        // El Informe oficial tiene su propia barra: los filtros de este módulo
        // no le aplican y esconderlos evita sugerir que sí.
        $('est-filtros')?.classList.toggle('d-none', area === 'informe');
        if (area === 'informe') {
            // La gráfica del informe se creó con su panel oculto; al hacerse
            // visible hay que darle un empujón para que tome el tamaño real.
            const canvas = document.getElementById('informe-est-chart-mensual');
            try { window.Chart?.getChart?.(canvas)?.resize(); } catch (_) { }
            return;
        }
        if (area === 'clasificacion') {
            window.EstadisticaClasificacion?.mostrar?.(forzar);
            return;
        }

        const render = RENDERIZADORES[area];
        if (!render) return;
        if (!forzar && state.cargadas.has(area)) return;

        ocupado(area, true);
        try {
            await render();
            state.cargadas.add(area);
            mostrarError(null);
        } catch (error) {
            console.error(`No se pudo cargar el área "${area}" del módulo estadístico:`, error);
            mostrarError(`No se pudieron cargar los datos: ${error?.message || error}`);
        } finally {
            ocupado(area, false);
        }
    }

    function invalidar() {
        state.cargadas.clear();
        window.EstadisticaClasificacion?.invalidar?.();
    }

    async function aplicarFiltros() {
        leerFiltros();
        if (!desde() || !hasta()) {
            mostrarError('Elige un periodo: hacen falta las fechas desde y hasta.');
            return;
        }
        if (hasta() < desde()) {
            mostrarError('El periodo está invertido: la fecha "hasta" es anterior a "desde".');
            return;
        }
        invalidar();
        await cargarOpcionesFiltro();
        await mostrarArea(state.areaActiva, true);
    }

    // ── Arranque ─────────────────────────────────────────────────────────────
    function enlazar() {
        $('est-f-preset')?.addEventListener('change', (e) => {
            aplicarPreset(e.target.value);
            aplicarFiltros();
        });
        ['est-f-desde', 'est-f-hasta'].forEach((id) => {
            $(id)?.addEventListener('change', () => { if ($('est-f-preset')) $('est-f-preset').value = ''; });
        });
        $('est-btn-aplicar')?.addEventListener('click', aplicarFiltros);
        $('est-btn-limpiar')?.addEventListener('click', () => {
            ['est-f-aerolinea', 'est-f-tipo-aeronave', 'est-f-matricula', 'est-f-endpoint',
                'est-f-direccion', 'est-f-nacint', 'est-f-segmento', 'est-f-naturaleza', 'est-f-servicio']
                .forEach((id) => { if ($(id)) $(id).value = ''; });
            aplicarFiltros();
        });
        $('est-btn-refrescar')?.addEventListener('click', async () => {
            const boton = $('est-btn-refrescar');
            if (boton) boton.disabled = true;
            try {
                const client = await getClient();
                const { error } = await client.rpc('refrescar_estadistica', { p_forzar: true });
                if (error) throw error;
                await mostrarFrescura();
                invalidar();
                await mostrarArea(state.areaActiva, true);
            } catch (error) {
                console.error('No se pudo refrescar la estadística:', error);
                mostrarError(`No se pudo refrescar: ${error?.message || error}. Se requiere nivel de edición o administración.`);
            } finally {
                if (boton) boton.disabled = false;
            }
        });

        document.querySelectorAll('#est-subnav [data-est-area]').forEach((boton) => {
            boton.addEventListener('shown.bs.tab', () => mostrarArea(boton.dataset.estArea, false));
        });

        $('est-exp-consultar')?.addEventListener('click', () => mostrarArea('explorador', true));
        $('est-exp-csv')?.addEventListener('click', () => {
            if (!state.ultimoExplorador) return;
            const { dims, filas } = state.ultimoExplorador;
            const columnas = dims.map((d, i) => ({
                titulo: Motor.DIMENSIONES[d] || d,
                valor: (f) => Motor.etiquetaDimension(d, f[`d${i + 1}`])
            })).concat(COLUMNAS_METRICAS);
            descargarCsv(columnas, filas, `estadistica_explorador_${desde()}_a_${hasta()}`);
        });
        $('est-exp-excel')?.addEventListener('click', async () => {
            if (!state.ultimoExplorador) return;
            const { dims, filas } = state.ultimoExplorador;
            const columnas = dims.map((d, i) => ({
                titulo: Motor.DIMENSIONES[d] || d,
                valor: (f) => Motor.etiquetaDimension(d, f[`d${i + 1}`])
            })).concat(COLUMNAS_METRICAS);
            await descargarExcel([{ titulo: 'Explorador', columnas, filas }], `estadistica_explorador_${desde()}_a_${hasta()}`);
        });

        $('est-cmp-preset')?.addEventListener('change', aplicarPresetComparador);
        $('est-cmp-comparar')?.addEventListener('click', () => mostrarArea('comparador', true));
        $('est-cmp-csv')?.addEventListener('click', () => generarDocumento('comparativo', 'csv'));

        $('est-descargas-lista')?.addEventListener('click', async (e) => {
            const boton = e.target.closest('[data-est-doc]');
            if (!boton || boton.disabled) return;
            boton.disabled = true;
            try {
                await generarDocumento(boton.dataset.estDoc, boton.dataset.estFormato);
            } catch (error) {
                console.error('No se pudo generar el documento:', error);
                mostrarError(`No se pudo generar el documento: ${error?.message || error}`);
            } finally {
                boton.disabled = false;
            }
        });
    }

    async function iniciar() {
        if (state.iniciado) return;
        state.iniciado = true;

        await cargarNivel();
        if (!puedeVer()) {
            mostrarError('No tienes acceso al módulo estadístico. Solicítalo al administrador de Operaciones.');
            $('est-subcontent')?.classList.add('d-none');
            $('est-filtros')?.classList.add('d-none');
            return;
        }

        // Botones que la base no permitiría usar: se ocultan, y además cada
        // acción vuelve a fallar del lado del servidor si alguien fuerza el DOM.
        if (!puedeDocumentosOficiales()) $('est-btn-refrescar')?.classList.add('d-none');

        aplicarPreset($('est-f-preset')?.value || 'anio_actual');
        leerFiltros();
        llenarSelectDimensiones();
        pintarDescargas();
        await Promise.all([cargarOpcionesFiltro(), mostrarFrescura()]);
        await mostrarArea('resumen', true);
    }

    // Se expone lo mínimo que necesita la pantalla de Clasificación: el cliente
    // ya inicializado, el periodo vigente y la forma de invalidar lo pintado.
    window.EstadisticaPanel = {
        getClient,
        nivel: () => state.nivel,
        puedeAdministrarReglas,
        periodo: () => ({ desde: desde(), hasta: hasta() }),
        invalidarTodo: () => { invalidar(); mostrarArea(state.areaActiva, true); },
        mostrarError,
        pintarTabla,
        descargarCsv,
        esc
    };

    document.addEventListener('DOMContentLoaded', () => {
        const tabConciliacion = document.getElementById('tab-conci-estadistica');
        if (!tabConciliacion) return;
        enlazar();
        tabConciliacion.addEventListener('shown.bs.tab', () => { iniciar(); });
        if (tabConciliacion.classList.contains('active')) iniciar();
    });
})();
