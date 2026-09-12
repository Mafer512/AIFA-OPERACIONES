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
        opcionesPorCampo: {},
        ultimoExplorador: null,
        ultimoComparador: null,
        diagnostico: null,
        fboFiltro: null,
        fboMetrica: 'movimientos',
        fboUltimo: null,
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
            // Van al pie de la página, como texto sobre el fondo: el icono
            // conserva el color que dice si es advertencia o error.
            const nivel = a.nivel === 'error' ? 'error' : (a.nivel === 'aviso' ? 'aviso' : 'info');
            const icono = nivel === 'error' ? 'fa-circle-exclamation'
                : (nivel === 'aviso' ? 'fa-triangle-exclamation' : 'fa-circle-info');
            return `<p class="est-aviso est-aviso-${nivel}"><i class="fas ${icono}" aria-hidden="true"></i><span>${esc(a.mensaje)}</span></p>`;
        }).join('');
    }

    // ── Aviso mientras se arma el reporte ────────────────────────────────────
    // Las consultas no informan su avance, así que el porcentaje es una
    // estimación: sube rápido al principio y se frena cerca del final, sin
    // llegar a 100 antes de que estén los datos. Entonces el aviso se quita.
    const ETAPAS_CARGA = [
        [0, 'Conectando con la base de datos…'],
        [20, 'Recolectando la información…'],
        [55, 'Calculando las cifras…'],
        [80, 'Terminando el reporte, espere un momento…']
    ];
    const cargasEnCurso = new Map();

    function porcentajeCarga(segundos) {
        return Math.min(95, Math.round(95 * (1 - Math.exp(-Math.max(0, segundos) / 6))));
    }

    function pintarAvisoCarga(nodo, pct) {
        const etapa = ETAPAS_CARGA.filter(([desde]) => pct >= desde).pop();
        nodo.querySelector('.est-carga-mensaje').textContent = etapa[1];
        nodo.querySelector('.est-carga-relleno').style.width = `${pct}%`;
        nodo.querySelector('.est-carga-porcentaje').textContent = `${pct} %`;
        nodo.querySelector('.est-carga-barra').setAttribute('aria-valuenow', String(pct));
    }

    function mostrarAvisoCarga(area) {
        const pane = $(`est-pane-${area}`);
        if (!pane || cargasEnCurso.has(area)) return;
        const nodo = document.createElement('div');
        nodo.className = 'est-carga';
        nodo.setAttribute('role', 'status');
        nodo.setAttribute('aria-live', 'polite');
        nodo.innerHTML = `
            <div class="est-carga-icono" aria-hidden="true"><i class="fas fa-chart-column"></i></div>
            <p class="est-carga-titulo">Estamos creando el reporte</p>
            <p class="est-carga-mensaje"></p>
            <div class="est-carga-barra" role="progressbar" aria-label="Avance estimado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="est-carga-relleno"></div>
            </div>
            <p class="est-carga-porcentaje"></p>`;
        pane.prepend(nodo);
        pane.classList.add('est-pane-cargando');
        const inicio = Date.now();
        const avanzar = () => pintarAvisoCarga(nodo, porcentajeCarga((Date.now() - inicio) / 1000));
        avanzar();
        cargasEnCurso.set(area, { pane, nodo, reloj: setInterval(avanzar, 300) });
    }

    function quitarAvisoCarga(area) {
        const carga = cargasEnCurso.get(area);
        if (!carga) return;
        clearInterval(carga.reloj);
        cargasEnCurso.delete(area);
        carga.nodo.remove();
        carga.pane.classList.remove('est-pane-cargando');
        // Las gráficas se dibujaron con el panel oculto: que tomen su tamaño real.
        carga.pane.querySelectorAll('canvas').forEach((canvas) => {
            try { window.Chart?.getChart?.(canvas)?.resize(); } catch (_) { }
        });
    }

    function ocupado(area, activo) {
        const boton = document.querySelector(`#est-subnav [data-est-area="${area}"]`);
        // Se marca con un indicador que gira, no atenuado: un botón gris parece
        // deshabilitado, y el área sí se puede abrir mientras carga.
        if (boton) {
            boton.classList.toggle('est-cargando', !!activo);
            boton.setAttribute('aria-busy', activo ? 'true' : 'false');
        }
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

    // Opciones comunes de las gráficas, con los colores del tema: el gris por
    // omisión de Chart.js casi no se lee sobre el fondo oscuro. Cada eje y la
    // leyenda toman el color del texto salvo que la gráfica diga otro.
    function opcionesGrafica(extra) {
        const tema = fboTema();
        const opciones = Object.assign({
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom' },
                datalabels: { display: false }
            },
            scales: { y: { beginAtZero: true } }
        }, extra || {});
        const leyenda = opciones.plugins && opciones.plugins.legend;
        if (leyenda && !leyenda.labels) leyenda.labels = { color: tema.texto };
        Object.values(opciones.scales || {}).forEach((eje) => {
            eje.ticks = Object.assign({ color: tema.texto }, eje.ticks || {});
            eje.grid = Object.assign({ color: tema.rejilla }, eje.grid || {});
            if (eje.title && !eje.title.color) eje.title.color = tema.texto;
        });
        return opciones;
    }

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
            // Se conservan todas: la barra superior usa unas cuantas y el
            // filtro adicional del Explorador puede pedir cualquiera.
            state.opcionesPorCampo = porCampo;
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

    // ── Diagnóstico: por qué una pantalla sale vacía ────────────────────────
    //
    // Un "sin datos" mudo no dice nada: puede ser que no haya operaciones en
    // ese periodo, que la materialización esté vieja, o que el filtro no
    // alcance nada. Esto lo contesta con las cifras reales.
    async function cargarDiagnostico() {
        if (state.diagnostico) return state.diagnostico;
        try {
            const client = await getClient();
            const { data, error } = await client.rpc('estadistica_diagnostico', {});
            if (error) throw error;
            state.diagnostico = Array.isArray(data) ? (data[0] || null) : (data || null);
        } catch (error) {
            console.warn('No se pudo obtener el diagnóstico del módulo estadístico:', error);
            state.diagnostico = null;
        }
        return state.diagnostico;
    }

    // Devuelve un aviso explicando el vacío, o null si sí hubo operaciones.
    async function avisoDeVacio(total) {
        if (total && total.operaciones > 0) return null;
        const d = await cargarDiagnostico();
        const periodo = Motor.etiquetaRango(desde(), hasta());

        if (!d || Number(d.movimientos || 0) === 0) {
            return {
                nivel: 'error',
                clave: 'vacio_total',
                mensaje: 'La estadística no tiene ningún movimiento cargado. Falta aplicar las '
                    + 'migraciones del módulo o refrescar la vista materializada '
                    + '(REFRESH MATERIALIZED VIEW public.mv_estadistica_operaciones).'
            };
        }

        const filtros = Motor.filtrosActivos(state.filtros);
        const rango = d.primera_fecha && d.ultima_fecha
            ? `Hay ${Motor.fmtEntero(d.movimientos)} movimientos entre ${d.primera_fecha} y ${d.ultima_fecha}.`
            : `Hay ${Motor.fmtEntero(d.movimientos)} movimientos cargados.`;
        const frescura = d.refrescado_at
            ? ` Última actualización de la estadística: ${new Date(d.refrescado_at).toLocaleString('es-MX')}.`
            : '';
        return {
            nivel: 'aviso',
            clave: 'vacio_periodo',
            mensaje: `Sin operaciones en ${periodo}`
                + (filtros ? ` con los ${filtros} filtro(s) aplicados` : '')
                + `. ${rango}${frescura}`
        };
    }

    // Envuelve el pintado de avisos de cada área: agrega el de vacío cuando
    // corresponde, para que ninguna sección se quede muda.
    async function pintarAvisosDe(total) {
        const avisos = Motor.validar(total);
        const vacio = await avisoDeVacio(total);
        pintarAvisos(vacio ? [vacio].concat(avisos) : avisos);
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

    // Las canceladas ya no salen de una sola señal: la bandera 'cancelado' de
    // la operación manda, y el texto del AODB y del manifiesto quedan como
    // respaldo. Decir cuántas vienen de cada una ayuda a saber si la captura
    // de la bandera va al día.
    const cancelPorOrigen = (total) => total.operacionesCanceladas > 0
        ? 'No cuentan en ninguna métrica'
        : 'Sin cancelaciones en el periodo';

    // ── Tablero: el diseño de FBO en todas las áreas ─────────────────────────
    // Cada área abre con una frase que cuenta el periodo, tarjetas con icono y
    // variación, barras de composición, tendencias con su promedio y rankings
    // horizontales con el valor al final de la barra. Todo se arma con lo que
    // ya devolvió el servidor: aquí sólo se reparten proporciones y se escribe.
    const negrita = (texto) => `<b>${esc(texto)}</b>`;
    const periodoTexto = () => `Del ${fboFecha(desde())} al ${fboFecha(hasta())}`;

    function pintarFrase(id, html) {
        const el = $(id);
        if (el) el.innerHTML = html;
    }

    function pintarComposicion(id, barras) {
        const el = $(id);
        if (!el) return;
        el.innerHTML = barras.filter(Boolean).join('')
            || '<p class="text-muted small mb-0">Sin datos que repartir en el periodo.</p>';
    }

    // Cómo cambió algo contra el mismo periodo del año anterior, en palabras.
    function cambioTexto(variacion, sujeto) {
        if (!variacion || variacion.estado !== 'ok') return '';
        const p = variacion.porcentual;
        if (p === 0) return ` Contra el mismo periodo del año anterior, ${sujeto} quedaron igual.`;
        return ` Contra el mismo periodo del año anterior, ${sujeto} ${p > 0 ? 'crecieron' : 'bajaron'} ${Motor.fmtPorcentaje(Math.abs(p), 1)}.`;
    }

    // Escribe el valor al final de cada barra horizontal, con el formato del área.
    function etiquetasDeBarra(formato) {
        return {
            id: 'tbEtiquetas',
            afterDatasetsDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                if (!meta || !meta.data) return;
                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
                ctx.fillStyle = fboTema().valor;
                ctx.textBaseline = 'middle';
                meta.data.forEach((barra, i) => {
                    ctx.fillText(formato(chart.data.datasets[0].data[i]), barra.x + 6, barra.y);
                });
                ctx.restore();
            }
        };
    }

    // Ranking horizontal con los primeros de una lista ya ordenada.
    function pintarRanking(idCanvas, filas, opciones) {
        const o = Object.assign({
            limite: 10,
            color: COLORES[0],
            serie: 'Operaciones',
            etiqueta: (f) => f.d1,
            valor: (f) => f.operaciones,
            formato: (v) => Motor.fmtEntero(v)
        }, opciones || {});
        const lista = (filas || []).slice(0, o.limite);
        const canvas = $(idCanvas);
        if (canvas && canvas.parentElement) canvas.parentElement.style.height = `${Math.max(9, lista.length * 1.9 + 2.5)}rem`;
        pintarGrafica(idCanvas, {
            type: 'bar',
            data: {
                labels: lista.map((f) => String(o.etiqueta(f) ?? '—')),
                datasets: [{
                    label: o.serie,
                    data: lista.map((f) => Motor.toNumero(o.valor(f)) ?? 0),
                    backgroundColor: o.color,
                    borderRadius: 6,
                    maxBarThickness: 22
                }]
            },
            options: opcionesGrafica({
                indexAxis: 'y',
                interaction: { mode: 'nearest', axis: 'y', intersect: false },
                layout: { padding: { right: 64 } },
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => (o.globo ? o.globo(lista[ctx.dataIndex] || {}) : `${o.serie}: ${o.formato(ctx.parsed.x)}`)
                        }
                    }
                },
                scales: {
                    x: Object.assign({ beginAtZero: true }, o.maximo ? { suggestedMax: o.maximo } : {}),
                    y: {
                        grid: { display: false },
                        // Los nombres largos se abrevian en el eje; completos, en el globo.
                        ticks: {
                            callback(valor) {
                                const ancho = (this.chart && this.chart.width) || 600;
                                const cabe = Math.max(10, Math.min(24, Math.floor(ancho / 24)));
                                const texto = String(this.getLabelForValue(valor));
                                return texto.length > cabe ? `${texto.slice(0, cabe - 1)}…` : texto;
                            }
                        }
                    }
                }
            }),
            plugins: [etiquetasDeBarra(o.formato)]
        });
    }

    // Tendencia mensual: barras apiladas por serie y la línea punteada del
    // promedio del periodo, que se saca aquí sólo para dibujarla. El total del
    // globo es el que mandó el servidor, no una suma de las barras.
    function pintarTendencia(idCanvas, mensual, series, opciones) {
        const o = opciones || {};
        const formato = o.formato || ((v) => Motor.fmtEntero(v));
        const canvas = $(idCanvas);
        if (canvas && canvas.parentElement) canvas.parentElement.style.height = '';
        const totales = mensual.map((f) => Motor.toNumero(o.total(f)) || 0);
        const promedio = totales.length ? totales.reduce((a, v) => a + v, 0) / totales.length : 0;
        pintarGrafica(idCanvas, {
            type: 'bar',
            data: {
                labels: mensual.map((f) => fboMes(f.d1)),
                datasets: series.map((s) => ({
                    type: 'bar',
                    label: s.etiqueta,
                    data: mensual.map((f) => Motor.toNumero(s.valor(f)) ?? 0),
                    backgroundColor: s.color,
                    borderRadius: 4,
                    maxBarThickness: 56,
                    stack: 'mes'
                })).concat([{
                    type: 'line',
                    label: `Promedio mensual: ${formato(promedio)}`,
                    data: totales.map(() => promedio),
                    borderColor: fboTema().oscuro ? '#94a3b8' : '#64748b',
                    borderDash: [6, 4],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    stack: 'promedio'
                }])
            },
            options: opcionesGrafica({
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom' },
                    datalabels: { display: false },
                    tooltip: {
                        callbacks: {
                            footer: (elementos) => (elementos.length
                                ? `Total: ${formato(totales[elementos[0].dataIndex])}`
                                : '')
                        }
                    }
                },
                scales: {
                    x: { stacked: true, grid: { display: false } },
                    y: { stacked: true, beginAtZero: true }
                }
            })
        });
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
        const chips = (campo, soloAnio) => (soloAnio ? '' : `${chipVariacion(v(campo), 'vs periodo anterior')}<br>`)
            + chipVariacion(vAnio(campo), 'vs año anterior');

        pintarFrase('est-resumen-frase', `${periodoTexto()} se ${fboUno(total.operaciones, 'registró', 'registraron')} `
            + `${negrita(Motor.fmtEntero(total.operaciones))} ${fboUno(total.operaciones, 'operación', 'operaciones')} `
            + `(${fboCuenta(total.operacionesLlegada, 'llegada', 'llegadas')} y ${fboCuenta(total.operacionesSalida, 'salida', 'salidas')}) `
            + `con ${negrita(Motor.fmtEntero(total.paxTotal))} pasajeros y ${negrita(Motor.fmtToneladas(total.cargaTotalKg))} de carga.`
            + (total.factorOcupacion === null || total.factorOcupacion === undefined ? ''
                : ` El factor de ocupación fue de ${negrita(Motor.fmtPorcentaje(total.factorOcupacion))}.`)
            + (total.puntualidadPorcentaje === null || total.puntualidadPorcentaje === undefined ? ''
                : ` El ${negrita(Motor.fmtPorcentaje(total.puntualidadPorcentaje))} de las operaciones evaluables cumplió la ventana del slot.`)
            + cambioTexto(vAnio('operaciones'), 'las operaciones'));

        $('est-resumen-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-plane', color: '#0d6efd', titulo: 'Operaciones', valor: Motor.fmtEntero(total.operaciones),
                detalle: `Llegadas ${Motor.fmtEntero(total.operacionesLlegada)} · Salidas ${Motor.fmtEntero(total.operacionesSalida)}`,
                variacion: chips('operaciones') }),
            kpiFbo({ icono: 'fa-users', color: '#20c997', titulo: 'Pasajeros', valor: Motor.fmtEntero(total.paxTotal),
                detalle: `Llegada ${Motor.fmtEntero(total.paxLlegada)} · Salida ${Motor.fmtEntero(total.paxSalida)}`,
                variacion: chips('paxTotal') }),
            kpiFbo({ icono: 'fa-box', color: '#fd7e14', titulo: 'Carga transportada', valor: Motor.fmtToneladas(total.cargaTotalKg),
                detalle: `Nacional ${Motor.fmtToneladas(total.cargaNacionalKg)} · Internacional ${Motor.fmtToneladas(total.cargaInternacionalKg)}`,
                variacion: chips('cargaTotalKg') }),
            kpiFbo({ icono: 'fa-chair', color: '#6f42c1', titulo: 'Factor de ocupación', valor: Motor.fmtPorcentaje(total.factorOcupacion),
                detalle: `${Motor.fmtEntero(total.ocupacionPax)} pasajeros sobre ${Motor.fmtEntero(total.ocupacionCapacidad)} asientos`,
                variacion: chips('factorOcupacion', true) }),
            kpiFbo({ icono: 'fa-clock', color: '#198754', titulo: 'Puntualidad', valor: Motor.fmtPorcentaje(total.puntualidadPorcentaje),
                detalle: `${Motor.fmtEntero(total.operacionesPuntuales)} a tiempo de ${Motor.fmtEntero(total.operacionesEvaluablesPuntualidad)} evaluables`,
                variacion: chips('puntualidadPorcentaje', true) })
        ].join('');

        // Calidad del dato: dice cuándo un indicador puede estar engañando.
        $('est-resumen-calidad').innerHTML = '<div class="fbo-destacados">'
            + Motor.calidad(total).map((c) => {
                const bajo = c.porcentaje !== null && c.porcentaje < 80;
                return `<span class="fbo-destacado${bajo ? ' fbo-destacado-aviso' : ''}">`
                    + `<i class="fas ${bajo ? 'fa-triangle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i>`
                    + `<span><small>${esc(c.etiqueta)}</small><b>${esc(c.texto)}</b></span></span>`;
            }).join('') + '</div>';

        await pintarAvisosDe(total);

        pintarGrafica('est-resumen-chart', {
            type: 'bar',
            data: {
                labels: mensual.map((f) => fboMes(f.d1)),
                datasets: [
                    { type: 'bar', label: 'Operaciones', data: mensual.map((f) => f.operaciones), backgroundColor: '#0d6efd', borderRadius: 4, maxBarThickness: 48, yAxisID: 'y' },
                    { type: 'line', label: 'Pasajeros', data: mensual.map((f) => f.paxTotal), borderColor: '#20c997', backgroundColor: '#20c997', tension: 0.3, pointRadius: 3, yAxisID: 'y1' }
                ]
            },
            options: opcionesGrafica({
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Operaciones' } },
                    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Pasajeros' } }
                }
            })
        });

        pintarComposicion('est-resumen-composicion', [
            barraComposicion('Operaciones por movimiento', [
                { etiqueta: 'Llegadas', valor: fboNum(total.operacionesLlegada), color: '#0d6efd' },
                { etiqueta: 'Salidas', valor: fboNum(total.operacionesSalida), color: '#20c997' }
            ]),
            barraComposicion('Operaciones por ámbito', [
                { etiqueta: 'Nacional', valor: fboNum(total.operacionesNacional), color: '#0369a1' },
                { etiqueta: 'Internacional', valor: fboNum(total.operacionesInternacional), color: '#fd7e14' }
            ]),
            barraComposicion('Carga por ámbito (t)', [
                { etiqueta: 'Nacional', valor: fboNum(Motor.kgAToneladas(total.cargaNacionalKg)), color: '#6f42c1' },
                { etiqueta: 'Internacional', valor: fboNum(Motor.kgAToneladas(total.cargaInternacionalKg)), color: '#d63384' }
            ]),
            barraComposicion('Ventana del slot', [
                { etiqueta: 'Cumple', valor: fboNum(total.operacionesPuntuales), color: '#198754' },
                { etiqueta: 'Fuera de ventana', valor: fboNum(total.operacionesAnticipadas) + fboNum(total.operacionesDemoradas), color: '#dc3545' }
            ])
        ]);

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
        { titulo: 'Cumple slot', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' },
        { titulo: 'Rotaciones', clave: 'rotaciones', tipo: 'numero' },
        { titulo: 'T. en tierra (min)', clave: 'turnaroundPromedioMin', tipo: 'decimal' },
        { titulo: 'Canceladas', clave: 'operacionesCanceladas', tipo: 'numero' }
    ];

    // Campos por los que se puede filtrar además de la barra superior. Son
    // los mismos que entiende el RPC en p_filtros; se llenan con los valores
    // que de verdad existen en el periodo.
    const CAMPOS_FILTRO_EXTRA = Object.freeze({
        posicion: 'Posición',
        puerta: 'Puerta',
        banda: 'Banda de equipaje',
        tipo_operacion: 'Tipo de operación (origen)',
        motivo_operativo: 'Motivo operativo',
        codigo_demora: 'Código de demora',
        fuente: 'Fuente del dato'
    });

    function llenarFiltroExtra() {
        const campo = $('est-exp-filtro-campo');
        if (campo && !campo.options.length) {
            campo.innerHTML = '<option value="">— ninguno —</option>'
                + Object.entries(CAMPOS_FILTRO_EXTRA)
                    .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
        }
        const valor = $('est-exp-filtro-valor');
        const nota = $('est-exp-filtro-nota');
        const elegido = campo?.value || '';
        if (!valor) return;
        if (!elegido) {
            valor.innerHTML = '<option value="">Todos</option>';
            valor.disabled = true;
            if (nota) nota.textContent = '';
            return;
        }
        valor.disabled = false;
        const opciones = (state.opcionesPorCampo || {})[elegido] || [];
        const previo = valor.value;
        valor.innerHTML = '<option value="">Todos</option>'
            + opciones.map((o) => `<option value="${esc(o.valor)}">${esc(o.etiqueta)}</option>`).join('');
        if (previo) valor.value = previo;
        if (nota) {
            nota.textContent = opciones.length
                ? `${opciones.length} valor(es) en el periodo`
                : 'Sin valores capturados en el periodo';
        }
    }

    function filtroExtra() {
        const campo = $('est-exp-filtro-campo')?.value;
        const valor = $('est-exp-filtro-valor')?.value;
        return campo && valor ? { [campo]: [valor] } : null;
    }

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
        llenarFiltroExtra();
        const extra = filtroExtra();
        const filas = await agregado(desde(), hasta(), dims, extra, 5000);
        const total = totalDe(filas);
        state.ultimoExplorador = { dims, filas, total, extra };

        const columnasDim = dims.map((d, i) => ({
            titulo: Motor.DIMENSIONES[d] || d,
            valor: (f) => Motor.etiquetaDimension(d, f[`d${i + 1}`])
        }));
        const columnas = columnasDim.concat(COLUMNAS_METRICAS);
        pintarTabla('est-exp-tabla', columnas, filas, { total, etiquetaTotal: 'TOTAL' });

        $('est-exp-conteo').textContent = `${Motor.fmtEntero(filas.length)} renglones`;
        pintarFrase('est-exp-frase', `${periodoTexto()}, agrupado por ${esc(dims.map((d) => Motor.DIMENSIONES[d] || d).join(' × '))}: `
            + `${negrita(Motor.fmtEntero(filas.length))} ${fboUno(filas.length, 'renglón', 'renglones')} con `
            + `${negrita(Motor.fmtEntero(total.operaciones))} operaciones, ${negrita(Motor.fmtEntero(total.paxTotal))} pasajeros `
            + `y ${negrita(Motor.fmtToneladas(total.cargaTotalKg))} de carga.${extra ? ' Con el filtro adicional aplicado.' : ''}`);
        $('est-exp-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-plane', color: '#0d6efd', titulo: 'Operaciones', valor: Motor.fmtEntero(total.operaciones),
                detalle: `${Motor.fmtEntero(total.operacionesCanceladas)} canceladas excluidas` }),
            kpiFbo({ icono: 'fa-users', color: '#20c997', titulo: 'Pasajeros', valor: Motor.fmtEntero(total.paxTotal),
                detalle: `Llegada ${Motor.fmtEntero(total.paxLlegada)} · Salida ${Motor.fmtEntero(total.paxSalida)}` }),
            kpiFbo({ icono: 'fa-box', color: '#fd7e14', titulo: 'Carga', valor: Motor.fmtToneladas(total.cargaTotalKg),
                detalle: `${Motor.fmtEntero(total.operacionesConCarga)} operaciones con carga` }),
            kpiFbo({ icono: 'fa-chair', color: '#6f42c1', titulo: 'Factor de ocupación', valor: Motor.fmtPorcentaje(total.factorOcupacion),
                detalle: Motor.cobertura(total.operacionesConOcupacion, total.operaciones).texto })
        ].join('');

        // Sólo se grafica cuando hay una dimensión: dos o tres cruzadas no dan
        // una serie legible, y una gráfica que no se entiende estorba.
        const canvas = $('est-exp-chart');
        const panelGrafica = canvas ? canvas.closest('.fbo-panel') : null;
        if (panelGrafica) panelGrafica.hidden = dims.length !== 1;
        if (dims.length === 1) {
            if (dims[0] === 'anio_mes') {
                pintarTendencia('est-exp-chart', filas.slice().sort((a, b) => String(a.d1).localeCompare(String(b.d1))), [
                    { etiqueta: 'Llegadas', valor: (f) => f.operacionesLlegada, color: '#0d6efd' },
                    { etiqueta: 'Salidas', valor: (f) => f.operacionesSalida, color: '#20c997' }
                ], { total: (f) => f.operaciones });
            } else {
                pintarRanking('est-exp-chart', filas.slice().sort((a, b) => b.operaciones - a.operaciones), {
                    limite: 20,
                    etiqueta: (f) => Motor.etiquetaDimension(dims[0], f.d1),
                    globo: (f) => `${Motor.fmtEntero(f.operaciones)} operaciones · ${Motor.fmtEntero(f.paxTotal)} pasajeros`
                });
            }
        }
        await pintarAvisosDe(total);
    }

    // ── C · Operaciones ──────────────────────────────────────────────────────
    async function pintarOperaciones() {
        const [mensual, clasif, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['segmento_aviacion', 'naturaleza_operacion'], null, 100),
            totalPeriodo(desde(), hasta())
        ]);

        const sinAmbito = fboNum(total.operaciones) - fboNum(total.operacionesNacional) - fboNum(total.operacionesInternacional);
        pintarFrase('est-ops-frase', `${periodoTexto()} se ${fboUno(total.operaciones, 'registró', 'registraron')} `
            + `${negrita(Motor.fmtEntero(total.operaciones))} ${fboUno(total.operaciones, 'operación válida', 'operaciones válidas')}: `
            + `${fboCuenta(total.operacionesLlegada, 'llegada', 'llegadas')} y ${fboCuenta(total.operacionesSalida, 'salida', 'salidas')}. `
            + `El ${negrita(fboPctTexto(fboNum(total.operacionesNacional), fboNum(total.operaciones)))} fue nacional.`
            + (fboNum(total.operacionesCanceladas)
                ? ` ${fboCuenta(total.operacionesCanceladas, 'operación cancelada', 'operaciones canceladas')} no ${fboUno(total.operacionesCanceladas, 'cuenta', 'cuentan')} en ninguna métrica.`
                : ' Sin cancelaciones en el periodo.'));

        $('est-ops-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-plane', color: '#0d6efd', titulo: 'Operaciones válidas', valor: Motor.fmtEntero(total.operaciones), detalle: 'Excluye canceladas' }),
            kpiFbo({ icono: 'fa-plane-arrival', color: '#0891b2', titulo: 'Llegadas', valor: Motor.fmtEntero(total.operacionesLlegada),
                detalle: `${fboPctTexto(fboNum(total.operacionesLlegada), fboNum(total.operaciones))} del total` }),
            kpiFbo({ icono: 'fa-plane-departure', color: '#20c997', titulo: 'Salidas', valor: Motor.fmtEntero(total.operacionesSalida),
                detalle: `${fboPctTexto(fboNum(total.operacionesSalida), fboNum(total.operaciones))} del total` }),
            kpiFbo({ icono: 'fa-globe', color: '#0369a1', titulo: 'Nacional / Internacional',
                valor: `${Motor.fmtEntero(total.operacionesNacional)} / ${Motor.fmtEntero(total.operacionesInternacional)}`,
                detalle: sinAmbito > 0 ? `${Motor.fmtEntero(sinAmbito)} sin determinar` : 'Todas con ámbito' }),
            kpiFbo({ icono: 'fa-ban', color: '#dc3545', titulo: 'Canceladas', valor: Motor.fmtEntero(total.operacionesCanceladas), detalle: cancelPorOrigen(total) }),
            kpiFbo({ icono: 'fa-right-left', color: '#6f42c1', titulo: 'Rotaciones', valor: Motor.fmtEntero(total.rotaciones),
                detalle: total.turnaroundPromedioMin === null || total.turnaroundPromedioMin === undefined
                    ? 'Sin tiempo en tierra medible'
                    : `Tiempo en tierra promedio ${Motor.fmtDecimal(total.turnaroundPromedioMin)} min` })
        ].join('');

        pintarTendencia('est-ops-chart', mensual, [
            { etiqueta: 'Llegadas', valor: (f) => f.operacionesLlegada, color: '#0d6efd' },
            { etiqueta: 'Salidas', valor: (f) => f.operacionesSalida, color: '#20c997' }
        ], { total: (f) => f.operaciones });

        pintarComposicion('est-ops-composicion', [
            barraComposicion('Movimiento', [
                { etiqueta: 'Llegadas', valor: fboNum(total.operacionesLlegada), color: '#0d6efd' },
                { etiqueta: 'Salidas', valor: fboNum(total.operacionesSalida), color: '#20c997' }
            ]),
            barraComposicion('Ámbito', [
                { etiqueta: 'Nacional', valor: fboNum(total.operacionesNacional), color: '#0369a1' },
                { etiqueta: 'Internacional', valor: fboNum(total.operacionesInternacional), color: '#fd7e14' },
                { etiqueta: 'Sin determinar', valor: Math.max(0, sinAmbito), color: FBO_GRIS }
            ]),
            barraComposicion('Clasificación', [
                { etiqueta: 'Clasificadas', valor: fboNum(total.operacionesClasificadas), color: '#6f42c1' },
                { etiqueta: 'Sin clasificar', valor: fboNum(total.operacionesSinClasificar), color: FBO_GRIS }
            ]),
            barraComposicion('Estado', [
                { etiqueta: 'Válidas', valor: fboNum(total.operaciones), color: '#198754' },
                { etiqueta: 'Canceladas', valor: fboNum(total.operacionesCanceladas), color: '#dc3545' }
            ])
        ]);

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

        await pintarAvisosDe(total);
    }

    // ── D · Pasajeros ────────────────────────────────────────────────────────
    async function pintarPasajeros() {
        const [mensual, porAerolinea, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['aerolinea'], null, 500),
            totalPeriodo(desde(), hasta())
        ]);

        const cobOcup = Motor.cobertura(total.operacionesConOcupacion, total.operaciones);
        pintarFrase('est-pax-frase', `${periodoTexto()} ${fboUno(total.paxTotal, 'viajó', 'viajaron')} `
            + `${negrita(Motor.fmtEntero(total.paxTotal))} ${fboUno(total.paxTotal, 'pasajero', 'pasajeros')} `
            + `(${Motor.fmtEntero(total.paxLlegada)} de llegada y ${Motor.fmtEntero(total.paxSalida)} de salida); `
            + `el ${negrita(fboPctTexto(fboNum(total.paxNacional), fboNum(total.paxTotal)))} fue nacional.`
            + (total.factorOcupacion === null || total.factorOcupacion === undefined ? ''
                : ` El factor de ocupación fue de ${negrita(Motor.fmtPorcentaje(total.factorOcupacion))}, calculado con ${esc(cobOcup.texto)} de las operaciones.`));

        $('est-pax-tarjetas').innerHTML = [
            // PAX TOTAL = pasajeros de llegada + pasajeros de salida.
            kpiFbo({ icono: 'fa-users', color: '#20c997', titulo: 'Pasajeros totales', valor: Motor.fmtEntero(total.paxTotal),
                detalle: `Llegada ${Motor.fmtEntero(total.paxLlegada)} + Salida ${Motor.fmtEntero(total.paxSalida)}` }),
            kpiFbo({ icono: 'fa-flag', color: '#0369a1', titulo: 'Nacional', valor: Motor.fmtEntero(total.paxNacional),
                detalle: `${fboPctTexto(fboNum(total.paxNacional), fboNum(total.paxTotal))} del total` }),
            kpiFbo({ icono: 'fa-earth-americas', color: '#fd7e14', titulo: 'Internacional', valor: Motor.fmtEntero(total.paxInternacional),
                detalle: `${fboPctTexto(fboNum(total.paxInternacional), fboNum(total.paxTotal))} del total` }),
            kpiFbo({ icono: 'fa-chair', color: '#6f42c1', titulo: 'Factor de ocupación', valor: Motor.fmtPorcentaje(total.factorOcupacion),
                detalle: `Calculado con ${cobOcup.texto} de las operaciones` }),
            kpiFbo({ icono: 'fa-divide', color: '#0891b2', titulo: 'Promedio por operación',
                valor: total.operacionesConPax > 0 ? Motor.fmtEntero((total.paxTotal || 0) / total.operacionesConPax) : '—',
                detalle: `${Motor.fmtEntero(total.operacionesConPax)} operaciones con dato de pasajeros` }),
            kpiFbo({ icono: 'fa-user-clock', color: '#64748b', titulo: 'Programados vs no abordados',
                valor: `${Motor.fmtEntero(total.paxProgramados)} / ${Motor.fmtEntero(total.paxNoAbordados)}`,
                detalle: total.tasaNoAbordados === null || total.tasaNoAbordados === undefined
                    ? 'Sin pasajeros programados capturados'
                    : `Tasa de no abordaje ${Motor.fmtPorcentaje(total.tasaNoAbordados)}` }),
            kpiFbo({ icono: 'fa-shuffle', color: '#0d6efd', titulo: 'Tránsitos y conexiones',
                valor: `${Motor.fmtEntero(total.paxTransitos)} / ${Motor.fmtEntero(total.paxConexiones)}`,
                detalle: 'Pasajeros que no inician ni terminan viaje en AIFA' }),
            kpiFbo({ icono: 'fa-receipt', color: '#198754', titulo: 'Pagan TUA', valor: Motor.fmtEntero(total.paxPaganTua),
                detalle: `Exentos ${Motor.fmtEntero(total.paxExentos)}` }),
            kpiFbo({ icono: 'fa-user-shield', color: '#dc3545', titulo: 'Inadmitidos y repatriados',
                valor: `${Motor.fmtEntero(total.paxInadmitidos)} / ${Motor.fmtEntero(total.paxRepatriados)}`, detalle: '' })
        ].join('');

        pintarTendencia('est-pax-chart', mensual, [
            { etiqueta: 'Llegada', valor: (f) => f.paxLlegada, color: '#0d6efd' },
            { etiqueta: 'Salida', valor: (f) => f.paxSalida, color: '#20c997' }
        ], { total: (f) => f.paxTotal });

        pintarComposicion('est-pax-composicion', [
            barraComposicion('Dirección', [
                { etiqueta: 'Llegada', valor: fboNum(total.paxLlegada), color: '#0d6efd' },
                { etiqueta: 'Salida', valor: fboNum(total.paxSalida), color: '#20c997' }
            ]),
            barraComposicion('Ámbito', [
                { etiqueta: 'Nacional', valor: fboNum(total.paxNacional), color: '#0369a1' },
                { etiqueta: 'Internacional', valor: fboNum(total.paxInternacional), color: '#fd7e14' }
            ]),
            barraComposicion('TUA', [
                { etiqueta: 'Pagan', valor: fboNum(total.paxPaganTua), color: '#198754' },
                { etiqueta: 'Exentos', valor: fboNum(total.paxExentos), color: FBO_GRIS }
            ])
        ]);

        pintarTabla('est-pax-tabla', [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Pax llegada', clave: 'paxLlegada', tipo: 'numero' },
            { titulo: 'Pax salida', clave: 'paxSalida', tipo: 'numero' },
            { titulo: 'Pax total', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Nacional', clave: 'paxNacional', tipo: 'numero' },
            { titulo: 'Internacional', clave: 'paxInternacional', tipo: 'numero' },
            { titulo: 'Programados', clave: 'paxProgramados', tipo: 'numero' },
            { titulo: 'No abordados', clave: 'paxNoAbordados', tipo: 'numero' },
            { titulo: 'Tránsitos', clave: 'paxTransitos', tipo: 'numero' },
            { titulo: 'Conexiones', clave: 'paxConexiones', tipo: 'numero' },
            { titulo: 'Pagan TUA', clave: 'paxPaganTua', tipo: 'numero' },
            { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' }
        ], mensual, { total, etiquetaTotal: 'TOTAL' });

        const conOcupacion = porAerolinea
            .filter((f) => f.factorOcupacion !== null)
            .sort((a, b) => (b.paxTotal || 0) - (a.paxTotal || 0));
        pintarRanking('est-pax-ocupacion-chart', conOcupacion, {
            color: '#6f42c1',
            serie: 'Factor de ocupación',
            valor: (f) => f.factorOcupacion,
            formato: (valor) => Motor.fmtPorcentaje(valor, 1),
            maximo: 100,
            globo: (f) => `${Motor.fmtPorcentaje(f.factorOcupacion, 1)} · ${Motor.fmtEntero(f.paxTotal)} pasajeros en ${Motor.fmtEntero(f.operaciones)} operaciones`
        });
        pintarTabla('est-pax-ocupacion', [
            { titulo: 'Aerolínea', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'paxTotal', tipo: 'numero' },
            { titulo: 'Asientos ofrecidos', clave: 'ocupacionCapacidad', tipo: 'numero' },
            { titulo: 'F. ocupación', clave: 'factorOcupacion', tipo: 'porcentaje' },
            { titulo: 'Cobertura', valor: (f) => Motor.cobertura(f.operacionesConOcupacion, f.operaciones).texto }
        ], conOcupacion, { vacio: 'Ninguna operación del periodo tiene a la vez pasajeros y capacidad de matrícula.' });

        await pintarAvisosDe(total);
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
        const totalAerolineas = totalDe(actual);

        const principal = filas[0];
        const top3 = filas.slice(0, 3).reduce((a, f) => a + (Motor.toNumero(f.participacion) || 0), 0);
        pintarFrase('est-aero-frase', principal
            ? `${periodoTexto()} ${fboUno(filas.length, 'operó', 'operaron')} ${negrita(Motor.fmtEntero(filas.length))} `
                + `${fboUno(filas.length, 'aerolínea', 'aerolíneas')}. La principal fue ${negrita(principal.d1)} con `
                + `${negrita(Motor.fmtPorcentaje(principal.participacion, 1))} de las operaciones`
                + (filas.length > 3 ? `; las tres primeras concentran ${negrita(Motor.fmtPorcentaje(top3, 1))}.` : '.')
            : `${periodoTexto()} no hay operaciones de aerolíneas con los filtros vigentes.`);

        $('est-aero-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-plane', color: '#0d6efd', titulo: 'Aerolíneas con operación', valor: Motor.fmtEntero(filas.length),
                detalle: 'En el periodo y con los filtros vigentes' }),
            kpiFbo({ icono: 'fa-trophy', color: '#fd7e14', titulo: 'Principal', valor: principal ? principal.d1 : '—',
                detalle: principal ? `${Motor.fmtPorcentaje(principal.participacion, 1)} de las operaciones` : '' }),
            kpiFbo({ icono: 'fa-layer-group', color: '#6f42c1', titulo: 'Concentración', valor: Motor.fmtPorcentaje(top3, 1),
                detalle: 'Operaciones de las tres primeras' }),
            kpiFbo({ icono: 'fa-users', color: '#20c997', titulo: 'Pasajeros', valor: Motor.fmtEntero(totalAerolineas.paxTotal),
                detalle: `Factor de ocupación ${Motor.fmtPorcentaje(totalAerolineas.factorOcupacion)}` })
        ].join('');

        pintarRanking('est-aero-chart', filas, {
            limite: 12,
            globo: (f) => `${Motor.fmtEntero(f.operaciones)} operaciones (${Motor.fmtPorcentaje(f.participacion, 1)}) · `
                + `${Motor.fmtEntero(f.paxTotal)} pasajeros`
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
        ], filas, { total: totalAerolineas, etiquetaTotal: 'TOTAL' });

        const avisos = Motor.validar(totalAerolineas);
        if (!repartoOps.cuadra && repartoOps.total > 0) {
            avisos.push({
                nivel: 'aviso',
                clave: 'participacion',
                mensaje: `Las participaciones por aerolínea suman ${Motor.fmtPorcentaje(repartoOps.sumaParticipacion)} en vez de 100 %.`
            });
        }
        const vacio = await avisoDeVacio(totalAerolineas);
        pintarAvisos(vacio ? [vacio].concat(avisos) : avisos);
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
        const lugar = (f) => (f.d2 ? `${f.d2} (${f.d1})` : String(f.d1 ?? '—'));
        const sinAmbito = fboNum(total.operaciones) - fboNum(total.operacionesNacional) - fboNum(total.operacionesInternacional);

        const principal = filas[0];
        pintarFrase('est-rutas-frase', `${periodoTexto()} hubo operaciones con `
            + `${negrita(Motor.fmtEntero(filas.length))} ${fboUno(filas.length, 'destino u origen', 'destinos y orígenes distintos')}.`
            + (principal ? ` El más frecuente fue ${negrita(lugar(principal))} con ${negrita(Motor.fmtPorcentaje(principal.participacion, 1))} de las operaciones.` : '')
            + ` El ${negrita(fboPctTexto(fboNum(total.operacionesNacional), fboNum(total.operaciones)))} de las operaciones fue nacional.`);

        $('est-rutas-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-location-dot', color: '#0f766e', titulo: 'Destinos y orígenes distintos', valor: Motor.fmtEntero(filas.length),
                detalle: 'En el periodo y con los filtros vigentes' }),
            kpiFbo({ icono: 'fa-flag', color: '#0369a1', titulo: 'Operaciones nacionales', valor: Motor.fmtEntero(total.operacionesNacional),
                detalle: `${fboPctTexto(fboNum(total.operacionesNacional), fboNum(total.operaciones))} del total` }),
            kpiFbo({ icono: 'fa-earth-americas', color: '#fd7e14', titulo: 'Operaciones internacionales', valor: Motor.fmtEntero(total.operacionesInternacional),
                detalle: `${fboPctTexto(fboNum(total.operacionesInternacional), fboNum(total.operaciones))} del total` }),
            kpiFbo({ icono: 'fa-circle-question', color: '#94a3b8', titulo: 'Sin determinar', valor: Motor.fmtEntero(sinAmbito),
                detalle: 'La ruta no resolvió contra el catálogo de aeropuertos' })
        ].join('');

        pintarRanking('est-rutas-chart', filas, {
            limite: 15,
            color: '#0f766e',
            etiqueta: lugar,
            globo: (f) => `${Motor.fmtEntero(f.operaciones)} operaciones (${Motor.fmtPorcentaje(f.participacion, 1)}) · `
                + `${Motor.fmtEntero(f.paxTotal)} pasajeros`
        });

        pintarComposicion('est-rutas-composicion', [
            barraComposicion('Ámbito', [
                { etiqueta: 'Nacional', valor: fboNum(total.operacionesNacional), color: '#0369a1' },
                { etiqueta: 'Internacional', valor: fboNum(total.operacionesInternacional), color: '#fd7e14' },
                { etiqueta: 'Sin determinar', valor: Math.max(0, sinAmbito), color: FBO_GRIS }
            ]),
            barraComposicion('Dirección', [
                { etiqueta: 'Llegadas', valor: fboNum(total.operacionesLlegada), color: '#0d6efd' },
                { etiqueta: 'Salidas', valor: fboNum(total.operacionesSalida), color: '#20c997' }
            ])
        ]);

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

        await pintarAvisosDe(total);
    }

    // ── G · Aeronaves ────────────────────────────────────────────────────────
    async function pintarAeronaves() {
        const [porTipo, porMatricula, total] = await Promise.all([
            agregado(desde(), hasta(), ['tipo_aeronave'], null, 1000),
            agregado(desde(), hasta(), ['matricula'], null, 3000),
            totalPeriodo(desde(), hasta())
        ]);
        const tipos = porTipo.slice().sort((a, b) => b.operaciones - a.operaciones);
        const matriculas = porMatricula.slice().sort((a, b) => b.operaciones - a.operaciones);
        const tipoPrincipal = tipos.find((f) => f.d1);

        pintarFrase('est-aeronaves-frase', `${periodoTexto()} ${fboUno(tipos.length, 'operó', 'operaron')} `
            + `${negrita(Motor.fmtEntero(tipos.length))} ${fboUno(tipos.length, 'tipo de aeronave', 'tipos de aeronave')} y `
            + `${negrita(Motor.fmtEntero(matriculas.length))} ${fboUno(matriculas.length, 'matrícula distinta', 'matrículas distintas')}.`
            + (tipoPrincipal ? ` El tipo más usado fue ${negrita(tipoPrincipal.d1)}, con `
                + `${negrita(fboPctTexto(fboNum(tipoPrincipal.operaciones), fboNum(total.operaciones)))} de las operaciones.` : ''));

        $('est-aeronaves-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-right-left', color: '#6f42c1', titulo: 'Rotaciones', valor: Motor.fmtEntero(total.rotaciones),
                detalle: `${Motor.cobertura(total.operacionesConTurnaround, total.operacionesSalida).texto} con tiempo en tierra medible` }),
            kpiFbo({ icono: 'fa-stopwatch', color: '#0891b2', titulo: 'Tiempo en tierra promedio',
                valor: total.turnaroundPromedioMin === null || total.turnaroundPromedioMin === undefined ? '—' : `${Motor.fmtDecimal(total.turnaroundPromedioMin)} min`,
                detalle: total.turnaroundMinimoMin === null || total.turnaroundMinimoMin === undefined ? 'Sin rotaciones emparejadas'
                    : `Entre ${Motor.fmtEntero(total.turnaroundMinimoMin)} y ${Motor.fmtEntero(total.turnaroundMaximoMin)} min` }),
            kpiFbo({ icono: 'fa-moon', color: '#1a2f55', titulo: 'Pernoctas', valor: Motor.fmtEntero(total.operacionesPernocta),
                detalle: total.pernoctaPromedioMin === null || total.pernoctaPromedioMin === undefined ? 'Sin pernoctas capturadas'
                    : `Promedio ${Motor.fmtDecimal(total.pernoctaPromedioMin / 60)} h` }),
            kpiFbo({ icono: 'fa-chair', color: '#20c997', titulo: 'Asientos ofrecidos', valor: Motor.fmtEntero(total.ocupacionCapacidad),
                detalle: `Factor de ocupación ${Motor.fmtPorcentaje(total.factorOcupacion)}` })
        ].join('');

        const globo = (f) => `${Motor.fmtEntero(f.operaciones)} operaciones · ${Motor.fmtEntero(f.paxTotal)} pasajeros`;
        pintarRanking('est-aeronaves-chart', tipos, { color: '#6f42c1', etiqueta: (f) => f.d1 || 'Sin dato', globo });
        pintarRanking('est-aeronaves-mat-chart', matriculas, { color: '#0d6efd', etiqueta: (f) => f.d1 || 'Sin dato', globo });

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
            { titulo: 'Rotaciones', clave: 'rotaciones', tipo: 'numero' },
            { titulo: 'T. en tierra (min)', clave: 'turnaroundPromedioMin', tipo: 'decimal' },
            { titulo: 'Carga', clave: 'cargaTotalKg', tipo: 'carga' }
        ];

        pintarTabla('est-aeronaves-tipo', columnas('Tipo de aeronave'), tipos, { total, etiquetaTotal: 'TOTAL' });
        pintarTabla('est-aeronaves-matricula', columnas('Matrícula'), matriculas, { total, etiquetaTotal: 'TOTAL' });

        await pintarAvisosDe(total);
    }

    // ── H · Carga ────────────────────────────────────────────────────────────
    async function pintarCarga() {
        const [mensual, porAerolinea, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['aerolinea'], null, 1000),
            totalPeriodo(desde(), hasta())
        ]);
        const conCarga = porAerolinea.filter((f) => (f.cargaTotalKg || 0) > 0)
            .sort((a, b) => (b.cargaTotalKg || 0) - (a.cargaTotalKg || 0));
        const toneladas = (kg) => fboNum(Motor.kgAToneladas(kg));
        const fmtT = (t) => `${Motor.fmtDecimal(t)} t`;

        pintarFrase('est-carga-frase', `${periodoTexto()} se ${fboUno(total.operacionesConCarga, 'transportó', 'transportaron')} `
            + `${negrita(Motor.fmtToneladas(total.cargaTotalKg))} de carga: ${esc(Motor.fmtToneladas(total.cargaNacionalKg))} nacional y `
            + `${esc(Motor.fmtToneladas(total.cargaInternacionalKg))} internacional, en `
            + `${fboCuenta(total.operacionesConCarga, 'operación con carga', 'operaciones con carga')}.`
            + (conCarga[0] ? ` La aerolínea con más carga fue ${negrita(conCarga[0].d1)}, con `
                + `${negrita(fboPctTexto(fboNum(conCarga[0].cargaTotalKg), fboNum(total.cargaTotalKg)))} del total.` : ''));

        $('est-carga-tarjetas').innerHTML = [
            kpiFbo({ icono: 'fa-box', color: '#fd7e14', titulo: 'Carga transportada', valor: Motor.fmtToneladas(total.cargaTotalKg),
                detalle: `Nacional ${Motor.fmtToneladas(total.cargaNacionalKg)} · Internacional ${Motor.fmtToneladas(total.cargaInternacionalKg)}` }),
            kpiFbo({ icono: 'fa-arrow-down', color: '#0d6efd', titulo: 'Descargada en AIFA', valor: Motor.fmtToneladas(total.cargaDescargadaKg),
                detalle: 'Movimientos de llegada' }),
            kpiFbo({ icono: 'fa-arrow-up', color: '#20c997', titulo: 'Embarcada en AIFA', valor: Motor.fmtToneladas(total.cargaEmbarcadaKg),
                detalle: 'Movimientos de salida' }),
            kpiFbo({ icono: 'fa-shuffle', color: '#6f42c1', titulo: 'En tránsito', valor: Motor.fmtToneladas(total.cargaTransitoKg),
                detalle: 'Contabilizada una sola vez por rotación' }),
            kpiFbo({ icono: 'fa-envelope', color: '#0891b2', titulo: 'Correo', valor: Motor.fmtToneladas(total.correoKg), detalle: '' }),
            // Importación/exportación es OTRA dimensión: una carga de
            // importación es además internacional y puede ir en tránsito.
            kpiFbo({ icono: 'fa-file-invoice', color: '#1a2f55', titulo: 'Importación / Exportación',
                valor: `${Motor.fmtToneladas(total.cargaImportacionKg)} / ${Motor.fmtToneladas(total.cargaExportacionKg)}`,
                detalle: 'Régimen aduanal, independiente de nacional/internacional' }),
            kpiFbo({ icono: 'fa-suitcase', color: '#94a3b8', titulo: 'Equipaje', valor: Motor.fmtToneladas(total.equipajeKg),
                detalle: 'No forma parte de la carga transportada' })
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

        pintarTendencia('est-carga-chart', mensual, [
            { etiqueta: 'Nacional (t)', valor: (f) => Motor.kgAToneladas(f.cargaNacionalKg), color: '#0d6efd' },
            { etiqueta: 'Internacional (t)', valor: (f) => Motor.kgAToneladas(f.cargaInternacionalKg), color: '#fd7e14' }
        ], { total: (f) => Motor.kgAToneladas(f.cargaTotalKg), formato: fmtT });

        pintarComposicion('est-carga-composicion', [
            barraComposicion('Ámbito (t)', [
                { etiqueta: 'Nacional', valor: toneladas(total.cargaNacionalKg), color: '#0d6efd' },
                { etiqueta: 'Internacional', valor: toneladas(total.cargaInternacionalKg), color: '#fd7e14' }
            ]),
            barraComposicion('Movimiento en AIFA (t)', [
                { etiqueta: 'Descargada', valor: toneladas(total.cargaDescargadaKg), color: '#0369a1' },
                { etiqueta: 'Embarcada', valor: toneladas(total.cargaEmbarcadaKg), color: '#20c997' },
                { etiqueta: 'En tránsito', valor: toneladas(total.cargaTransitoKg), color: '#6f42c1' }
            ]),
            barraComposicion('Régimen aduanal (t)', [
                { etiqueta: 'Importación', valor: toneladas(total.cargaImportacionKg), color: '#1a2f55' },
                { etiqueta: 'Exportación', valor: toneladas(total.cargaExportacionKg), color: '#d63384' }
            ])
        ]);

        pintarRanking('est-carga-aero-chart', conCarga, {
            color: '#fd7e14',
            serie: 'Carga (t)',
            valor: (f) => Motor.kgAToneladas(f.cargaTotalKg),
            formato: fmtT,
            globo: (f) => `${Motor.fmtToneladas(f.cargaTotalKg)} en ${Motor.fmtEntero(f.operacionesConCarga || f.operaciones)} operaciones`
        });

        const columnasCarga = [
            { titulo: 'Transportada', clave: 'cargaTotalKg', tipo: 'carga' },
            { titulo: 'Nacional', clave: 'cargaNacionalKg', tipo: 'carga' },
            { titulo: 'Internacional', clave: 'cargaInternacionalKg', tipo: 'carga' },
            { titulo: 'Descargada', clave: 'cargaDescargadaKg', tipo: 'carga' },
            { titulo: 'Embarcada', clave: 'cargaEmbarcadaKg', tipo: 'carga' },
            { titulo: 'En tránsito', clave: 'cargaTransitoKg', tipo: 'carga' },
            { titulo: 'Correo', clave: 'correoKg', tipo: 'carga' },
            { titulo: 'Importación', clave: 'cargaImportacionKg', tipo: 'carga' },
            { titulo: 'Exportación', clave: 'cargaExportacionKg', tipo: 'carga' }
        ];

        pintarTabla('est-carga-tabla',
            [{ titulo: 'Periodo', clave: 'd1' }].concat(columnasCarga).concat([
                { titulo: 'Operaciones con carga', clave: 'operacionesConCarga', tipo: 'numero' }
            ]), mensual, { total, etiquetaTotal: 'TOTAL' });

        pintarTabla('est-carga-aerolinea',
            [{ titulo: 'Aerolínea', clave: 'd1' }].concat(columnasCarga).concat([
                { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' }
            ]),
            conCarga,
            { total, etiquetaTotal: 'TOTAL', vacio: 'Ninguna operación del periodo reporta carga.' });

        await pintarAvisosDe(total);
    }

    // ── I · Puntualidad y demoras ────────────────────────────────────────────
    async function pintarPuntualidad() {
        const [mensual, porAerolinea, porCausa, total] = await Promise.all([
            agregado(desde(), hasta(), ['anio_mes'], null, 240),
            agregado(desde(), hasta(), ['aerolinea'], null, 1000),
            agregado(desde(), hasta(), ['codigo_demora', 'causa_demora'], null, 500),
            totalPeriodo(desde(), hasta())
        ]);
        const causas = porCausa.filter((f) => f.d1 || f.d2).sort((a, b) => b.operacionesDemoradas - a.operacionesDemoradas);
        const causa = (f) => [f.d1, f.d2].filter(Boolean).join(' · ');

        const cob = Motor.cobertura(total.operacionesEvaluablesPuntualidad, total.operaciones);
        pintarFrase('est-punt-frase', (total.puntualidadPorcentaje === null || total.puntualidadPorcentaje === undefined
            ? `${periodoTexto()} ninguna operación tiene slot ni dictamen con qué evaluarse.`
            : `${periodoTexto()} el ${negrita(Motor.fmtPorcentaje(total.puntualidadPorcentaje))} de las operaciones evaluables `
                + `cumplió la ventana del slot (${esc(cob.texto)} de las operaciones tienen con qué evaluarse).`)
            + ` ${fboCuenta(total.operacionesDemoradas, 'operación', 'operaciones')} ${fboUno(total.operacionesDemoradas, 'tuvo', 'tuvieron')} `
            + 'demora de más de 15 minutos.'
            + (causas[0] ? ` La causa más frecuente fue ${negrita(causa(causas[0]))}.` : ''));

        $('est-punt-tarjetas').innerHTML = [
            // La medición oficial es contra el SLOT VIGENTE
            // (coalesce(slot_coordinado, slot_asignado)), no contra la hora
            // programada. Cumplir la ventana es ANTES, EN TIEMPO o DESPUÉS.
            kpiFbo({ icono: 'fa-circle-check', color: '#198754', titulo: 'Cumple la ventana del slot', valor: Motor.fmtPorcentaje(total.puntualidadPorcentaje),
                detalle: `ANTES + EN TIEMPO + DESPUÉS, sobre ${cob.texto} de las operaciones` }),
            kpiFbo({ icono: 'fa-clock', color: '#0d6efd', titulo: 'En tiempo', valor: Motor.fmtEntero(total.operacionesEnTiempo),
                detalle: `Antes ${Motor.fmtEntero(total.operacionesAntes)} · Después ${Motor.fmtEntero(total.operacionesDespues)}` }),
            kpiFbo({ icono: 'fa-triangle-exclamation', color: '#dc3545', titulo: 'Fuera de ventana',
                valor: `${Motor.fmtEntero(total.operacionesAnticipadas)} / ${Motor.fmtEntero(total.operacionesDemoradas)}`,
                detalle: 'Anticipadas / con demora (más de 15 min)' }),
            kpiFbo({ icono: 'fa-arrows-left-right', color: '#6f42c1', titulo: 'Desviación media contra el slot',
                valor: total.minutosVsSlotPromedio === null || total.minutosVsSlotPromedio === undefined ? '—' : `${Motor.fmtDecimal(total.minutosVsSlotPromedio)} min`,
                detalle: 'Positivo = después del slot' }),
            kpiFbo({ icono: 'fa-hourglass-half', color: '#fd7e14', titulo: 'Demora operacional',
                valor: total.demoraPromedio === null || total.demoraPromedio === undefined ? '—' : `${Motor.fmtDecimal(total.demoraPromedio)} min`,
                detalle: 'Retraso del vuelo, no cumplimiento del permiso' })
        ].join('');

        pintarGrafica('est-punt-chart', {
            type: 'bar',
            data: {
                labels: mensual.map((f) => fboMes(f.d1)),
                datasets: [
                    { type: 'line', label: 'Cumple slot (%)', data: mensual.map((f) => f.puntualidadPorcentaje), borderColor: '#198754', backgroundColor: '#198754', tension: 0.3, pointRadius: 3, yAxisID: 'y' },
                    { type: 'bar', label: 'Demora promedio (min)', data: mensual.map((f) => f.demoraPromedio), backgroundColor: 'rgba(253, 126, 20, .55)', borderRadius: 4, maxBarThickness: 48, yAxisID: 'y1' }
                ]
            },
            options: opcionesGrafica({
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, position: 'left', suggestedMax: 100, title: { display: true, text: '% cumple' } },
                    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'min' } }
                }
            })
        });

        pintarComposicion('est-punt-composicion', [
            barraComposicion('Resultado contra el slot', [
                { etiqueta: 'Anticipadas', valor: fboNum(total.operacionesAnticipadas), color: '#0dcaf0' },
                { etiqueta: 'Antes', valor: fboNum(total.operacionesAntes), color: '#20c997' },
                { etiqueta: 'En tiempo', valor: fboNum(total.operacionesEnTiempo), color: '#198754' },
                { etiqueta: 'Después', valor: fboNum(total.operacionesDespues), color: '#ffc107' },
                { etiqueta: 'Demora', valor: fboNum(total.operacionesDemoradas), color: '#dc3545' }
            ])
        ]);

        pintarRanking('est-punt-causas-chart', causas, {
            color: '#dc3545',
            serie: 'Demoradas',
            etiqueta: causa,
            valor: (f) => f.operacionesDemoradas,
            globo: (f) => `${Motor.fmtEntero(f.operacionesDemoradas)} demoradas · ${Motor.fmtEntero(f.minutosDemoraTotal)} minutos acumulados`
        });

        const columnasPunt = [
            { titulo: 'Anticipadas', clave: 'operacionesAnticipadas', tipo: 'numero' },
            { titulo: 'Antes', clave: 'operacionesAntes', tipo: 'numero' },
            { titulo: 'En tiempo', clave: 'operacionesEnTiempo', tipo: 'numero' },
            { titulo: 'Después', clave: 'operacionesDespues', tipo: 'numero' },
            { titulo: 'Demora', clave: 'operacionesDemoradas', tipo: 'numero' },
            { titulo: 'Evaluables', clave: 'operacionesEvaluablesPuntualidad', tipo: 'numero' },
            { titulo: 'Cumple slot', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' },
            { titulo: 'Desv. vs slot (min)', clave: 'minutosVsSlotPromedio', tipo: 'decimal' },
            { titulo: 'Demora oper. prom. (min)', clave: 'demoraPromedio', tipo: 'decimal' }
        ];

        pintarTabla('est-punt-aerolinea',
            [{ titulo: 'Aerolínea', clave: 'd1' }, { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' }].concat(columnasPunt),
            porAerolinea.filter((f) => f.operacionesEvaluablesPuntualidad > 0)
                .sort((a, b) => b.operaciones - a.operaciones),
            { total, etiquetaTotal: 'TOTAL', vacio: 'Ninguna operación del periodo tiene slot ni dictamen de puntualidad con qué evaluarse.' });

        pintarTabla('est-punt-causas', [
            { titulo: 'Código', clave: 'd1' },
            { titulo: 'Causa', clave: 'd2' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Demoradas', clave: 'operacionesDemoradas', tipo: 'numero' },
            { titulo: 'Minutos acumulados', clave: 'minutosDemoraTotal', tipo: 'numero' },
            { titulo: 'Demora prom. (min)', clave: 'demoraPromedio', tipo: 'decimal' }
        ], causas, { vacio: 'No hay códigos ni causas de demora capturados en el periodo.' });

        await pintarAvisosDe(total);
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

        const operaciones = comparacion.metricas.find((f) => f.clave === 'operaciones') || comparacion.metricas[0];
        pintarFrase('est-cmp-frase', `Periodo A ${negrita(etiquetaA)} contra periodo B ${negrita(etiquetaB)}, que sirve de referencia: `
            + 'cada variación dice cuánto cambió A respecto de B.'
            + (operaciones && operaciones.variacion && operaciones.variacion.estado === 'ok'
                ? ` Las operaciones ${operaciones.variacion.porcentual >= 0 ? 'crecieron' : 'bajaron'} `
                    + `${negrita(Motor.fmtPorcentaje(Math.abs(operaciones.variacion.porcentual), 1))}.`
                : ''));

        // Una tarjeta por indicador principal: el valor de A, el de B debajo y
        // la variación con su flecha.
        const ICONOS = ['fa-plane', 'fa-users', 'fa-box', 'fa-chair', 'fa-clock', 'fa-right-left'];
        const tarjetas = $('est-cmp-tarjetas');
        if (tarjetas) {
            tarjetas.innerHTML = comparacion.metricas.slice(0, 6).map((f, i) => kpiFbo({
                icono: ICONOS[i % ICONOS.length],
                color: COLORES[i % COLORES.length],
                titulo: f.etiqueta,
                valor: Motor.formatearPorTipo(f.valorB, f.tipo),
                detalle: `${etiquetaB}: ${Motor.formatearPorTipo(f.valorA, f.tipo)}`,
                variacion: chipVariacion(f.variacion, `vs ${etiquetaB}`)
            })).join('');
        }

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
            return `<article class="tb-doc">
                <span class="tb-doc-icono" aria-hidden="true"><i class="fas ${esc(doc.icono)}"></i></span>
                <div class="tb-doc-texto">
                    <h6>${esc(doc.titulo)}</h6>
                    <p>${esc(doc.descripcion)}</p>
                </div>
                <div class="tb-doc-acciones">
                    ${botones}
                    ${permitido ? '' : '<small class="text-muted"><i class="fas fa-lock me-1"></i>Requiere más permisos</small>'}
                </div>
            </article>`;
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
            { titulo: 'Pax programados', clave: 'paxProgramados', tipo: 'numero' },
            { titulo: 'Pax no abordados', clave: 'paxNoAbordados', tipo: 'numero' },
            { titulo: 'Pax en transito', clave: 'paxTransitos', tipo: 'numero' },
            { titulo: 'Pax en conexion', clave: 'paxConexiones', tipo: 'numero' },
            { titulo: 'Pax que pagan TUA', clave: 'paxPaganTua', tipo: 'numero' },
            { titulo: 'Pax exentos', clave: 'paxExentos', tipo: 'numero' },
            { titulo: 'Pax inadmitidos', clave: 'paxInadmitidos', tipo: 'numero' },
            { titulo: 'Pax repatriados', clave: 'paxRepatriados', tipo: 'numero' },
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
            { titulo: 'Importacion (kg)', clave: 'cargaImportacionKg', tipo: 'carga' },
            { titulo: 'Exportacion (kg)', clave: 'cargaExportacionKg', tipo: 'carga' },
            { titulo: 'Equipaje (kg)', clave: 'equipajeKg', tipo: 'carga' },
            { titulo: 'Operaciones con carga', clave: 'operacionesConCarga', tipo: 'numero' },
            { titulo: 'Con desglose capturado', clave: 'operacionesConDesgloseCarga', tipo: 'numero' }
        ],
        puntualidad: [
            { titulo: 'Periodo', clave: 'd1' },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Anticipadas', clave: 'operacionesAnticipadas', tipo: 'numero' },
            { titulo: 'Antes', clave: 'operacionesAntes', tipo: 'numero' },
            { titulo: 'En tiempo', clave: 'operacionesEnTiempo', tipo: 'numero' },
            { titulo: 'Despues', clave: 'operacionesDespues', tipo: 'numero' },
            { titulo: 'Con demora', clave: 'operacionesDemoradas', tipo: 'numero' },
            { titulo: 'Evaluables', clave: 'operacionesEvaluablesPuntualidad', tipo: 'numero' },
            { titulo: 'Cumple ventana de slot (%)', clave: 'puntualidadPorcentaje', tipo: 'porcentaje' },
            { titulo: 'Desviacion media vs slot (min)', clave: 'minutosVsSlotPromedio', tipo: 'decimal' },
            { titulo: 'Operaciones con slot', clave: 'operacionesConSlot', tipo: 'numero' },
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
        { titulo: 'Tipo servicio', clave: 'tipo_servicio' },
        { titulo: 'Descripción servicio', clave: 'tipo_servicio_descripcion' },
        { titulo: 'Origen', clave: 'origen_codigo' },
        { titulo: 'Destino', clave: 'destino_codigo' },
        { titulo: 'Ciudad', clave: 'endpoint_ciudad' },
        { titulo: 'Nacional/Internacional', clave: 'nacional_internacional' },
        { titulo: 'Origen nacional/internacional', clave: 'nacint_origen' },
        { titulo: 'Nombre original del extremo', clave: 'endpoint_nombre' },
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
        { titulo: 'Slot asignado', clave: 'slot_asignado' },
        { titulo: 'Slot coordinado', clave: 'slot_coordinado' },
        { titulo: 'Slot vigente', clave: 'slot_vigente' },
        { titulo: 'Origen del slot', clave: 'slot_origen' },
        { titulo: 'Hora de operacion', clave: 'hora_operacion' },
        { titulo: 'Minutos vs slot', clave: 'minutos_vs_slot', tipo: 'numero' },
        { titulo: 'Adherencia al slot', clave: 'clasificacion_slot' },
        { titulo: 'Minutos de demora', clave: 'minutos_demora', tipo: 'numero' },
        { titulo: 'Código demora', clave: 'codigo_demora' },
        { titulo: 'Causa demora', clave: 'causa_demora' },
        { titulo: 'Pax programados', clave: 'pax_programados', tipo: 'numero' },
        { titulo: 'Pax no abordados', clave: 'pax_no_abordados', tipo: 'numero' },
        { titulo: 'Pax en transito', clave: 'pax_transitos', tipo: 'numero' },
        { titulo: 'Pax en conexion', clave: 'pax_conexiones', tipo: 'numero' },
        { titulo: 'Pax pagan TUA', clave: 'pax_pagan_tua_reportados', tipo: 'numero' },
        { titulo: 'Pax inadmitidos', clave: 'pax_inadmitidos', tipo: 'numero' },
        { titulo: 'Pax repatriados', clave: 'pax_repatriados', tipo: 'numero' },
        { titulo: 'Capacidad', clave: 'capacidad_pasajeros', tipo: 'numero' },
        { titulo: 'Origen de la capacidad', clave: 'capacidad_origen' },
        { titulo: 'Carga importacion (kg)', clave: 'carga_importacion_kg', tipo: 'carga' },
        { titulo: 'Carga exportacion (kg)', clave: 'carga_exportacion_kg', tipo: 'carga' },
        { titulo: 'Equipaje (kg)', clave: 'equipaje_kg', tipo: 'carga' },
        { titulo: 'Posicion', clave: 'posicion' },
        { titulo: 'Puerta', clave: 'puerta' },
        { titulo: 'Banda', clave: 'banda' },
        { titulo: 'Escala', clave: 'escala_codigo' },
        { titulo: 'Estatus matricula', clave: 'estatus_matricula' },
        { titulo: 'Codigo AFAC', clave: 'codigo_afac' },
        { titulo: 'Motivo operativo', clave: 'motivo_operativo' },
        { titulo: 'Senal de cancelacion', clave: 'cancelado_origen' },
        { titulo: 'Rotacion', clave: 'rotacion_clave' },
        { titulo: 'Origen de la rotacion', clave: 'rotacion_origen' },
        { titulo: 'Tiempo en tierra (min)', clave: 'turnaround_min', tipo: 'numero' },
        { titulo: 'Pernocta (min)', clave: 'minutos_pernocta', tipo: 'numero' },
        { titulo: 'Conciliado', valor: (f) => f.conciliado ? 'Si' : 'No' },
        { titulo: 'Validado', valor: (f) => f.validado ? 'Si' : 'No' },
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

    // ── J · FBO · Aviación General ───────────────────────────────────────────
    // Primer tablero con la visualización nueva: una frase que cuenta el
    // periodo, tarjetas con su variación, la tendencia con selector, barras de
    // composición y rankings que filtran todo el tablero al tocarlos.
    //
    // Las cifras llegan ya sumadas de aviacion_general_resumen (migración 046),
    // la misma función que usa el módulo de Aviación General: las dos pantallas
    // dicen lo mismo y aquí no se recalcula ninguna métrica. En el navegador
    // sólo se sacan proporciones y el promedio mensual, para pintar.
    const FBO_MOVIMIENTO = Object.freeze({ A: 'LLEGADA', D: 'SALIDA' });
    const FBO_AMBITO = Object.freeze({ Nacional: 'NACIONAL', Internacional: 'INTERNACIONAL' });
    // Lo que se puede elegir tocando el tablero, y cómo se llama en pantalla.
    const FBO_CAMPOS = Object.freeze({
        operador: 'Operador',
        tipo_aeronave: 'Tipo de aeronave',
        aeropuerto: 'Origen / destino',
        matricula: 'Matrícula'
    });
    // Filtros de la barra cuyas opciones salen de la operación de las otras
    // ventanas, no de Aviación General: en FBO no se aplican, y se avisa.
    const FBO_FILTROS_AJENOS = Object.freeze([
        ['aerolinea', 'Aerolínea'], ['tipo_aeronave', 'Tipo aeronave'], ['matricula', 'Matrícula'],
        ['endpoint', 'Origen / destino'], ['segmento_aviacion', 'Segmento'],
        ['naturaleza_operacion', 'Naturaleza'], ['tipo_servicio', 'Tipo servicio']
    ]);
    // Cómo se nombra, en la nota de cada ranking, lo que llega sin dato.
    const FBO_SIN_DATO = Object.freeze({ operador: 'operador', tipo_aeronave: 'tipo de aeronave', aeropuerto: 'origen / destino' });
    const FBO_GRIS = '#94a3b8';

    const fboNum = (valor) => Number(valor) || 0;
    const fboPct = (parte, total) => (total > 0 ? (parte / total) * 100 : 0);
    const fboClave = (clave) => (clave === null || clave === undefined || String(clave).trim() === '' ? null : String(clave));
    const fboUno = (n, singular, plural) => (fboNum(n) === 1 ? singular : plural);
    const fboCuenta = (n, singular, plural) => `${Motor.fmtEntero(n)} ${fboUno(n, singular, plural)}`;

    // Proporción para leer: sin decimales, salvo que sea menos de 1 %.
    function fboPctTexto(parte, total) {
        const pct = fboPct(parte, total);
        return Motor.fmtPorcentaje(pct, pct > 0 && pct < 1 ? 1 : 0);
    }

    // Colores de ejes y leyendas según el tema: el gris por omisión de
    // Chart.js casi no se lee sobre el fondo oscuro.
    function fboTema() {
        const oscuro = document.body.classList.contains('dark-mode');
        return {
            oscuro,
            texto: oscuro ? '#cbd5e1' : '#475569',
            rejilla: oscuro ? 'rgba(148, 163, 184, .16)' : 'rgba(148, 163, 184, .22)',
            valor: oscuro ? '#e2e8f0' : '#0f172a'
        };
    }

    function fboMes(periodo) {
        const [anio, mes] = String(periodo || '').split('-').map(Number);
        const m = Motor.MESES[mes - 1];
        return m ? `${m.corto} ${anio}` : String(periodo || '');
    }

    function fboFecha(iso) {
        const { anio, mes, dia } = Motor.partesIso(iso);
        return dia ? `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}` : '—';
    }

    // Los filtros de la barra que sí le aplican a Aviación General, con los
    // nombres y valores que entiende aviacion_general_filtro_ok.
    function filtrosFbo(desdeIso, hastaIso) {
        const f = state.filtros || {};
        const filtros = {
            fecha_desde: desdeIso || '',
            fecha_hasta: hastaIso || '',
            tipo_operacion: FBO_MOVIMIENTO[(f.direccion || [])[0]] || '',
            ambito_operacion: FBO_AMBITO[(f.nacional_internacional || [])[0]] || ''
        };
        if (state.fboFiltro) filtros[state.fboFiltro.campo] = state.fboFiltro.valor;
        return filtros;
    }

    async function resumenFbo(filtros) {
        const client = await getClient();
        const { data, error } = await client.rpc('aviacion_general_resumen', { p_filtros: filtros });
        if (error) {
            if (error.code === 'PGRST202' || error.code === '42883') {
                throw new Error('falta la función aviacion_general_resumen en la base (migración 046 de Aviación General).');
            }
            throw error;
        }
        return data || {};
    }

    function filtrarFbo(campo, valor) {
        if (!FBO_CAMPOS[campo] || !fboClave(valor)) return;
        state.fboFiltro = { campo, valor: String(valor) };
        mostrarArea('fbo', true);
    }

    // Escribe el valor al final de cada barra horizontal: así el número no
    // depende de adivinarlo contra el eje.
    const FBO_ETIQUETAS = {
        id: 'fboEtiquetas',
        afterDatasetsDraw(chart) {
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data) return;
            const { ctx } = chart;
            ctx.save();
            ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.fillStyle = fboTema().valor;
            ctx.textBaseline = 'middle';
            meta.data.forEach((barra, i) => {
                ctx.fillText(Motor.fmtEntero(chart.data.datasets[0].data[i]), barra.x + 6, barra.y);
            });
            ctx.restore();
        }
    };

    function fraseFbo(t, rango) {
        const mov = fboNum(t.movimientos);
        return `Del ${fboFecha(rango.desde)} al ${fboFecha(rango.hasta)} ${fboUno(mov, 'se atendió', 'se atendieron')} `
            + `<b>${Motor.fmtEntero(mov)}</b> ${fboUno(mov, 'movimiento', 'movimientos')} de aviación general `
            + `(${fboCuenta(t.llegadas, 'llegada', 'llegadas')} y ${fboCuenta(t.salidas, 'salida', 'salidas')}) `
            + `con <b>${Motor.fmtEntero(t.pax)}</b> ${fboUno(t.pax, 'pasajero', 'pasajeros')}, `
            + `de <b>${Motor.fmtEntero(t.operadores)}</b> ${fboUno(t.operadores, 'operador', 'operadores')} `
            + `y ${fboCuenta(t.matriculas, 'aeronave distinta', 'aeronaves distintas')}. `
            + `El ${fboPctTexto(fboNum(t.nacionales), mov)} fue nacional.`;
    }

    function kpiFbo({ icono, color, titulo, valor, detalle, variacion }) {
        return `<div class="fbo-kpi" style="--fbo-color:${color}">
            <span class="fbo-kpi-icono" aria-hidden="true"><i class="fas ${icono}"></i></span>
            <div class="fbo-kpi-texto">
                <span class="fbo-kpi-titulo">${esc(titulo)}</span>
                <strong class="fbo-kpi-valor">${esc(valor)}</strong>
                ${detalle ? `<small class="fbo-kpi-detalle">${esc(detalle)}</small>` : ''}
                ${variacion || ''}
            </div>
        </div>`;
    }

    function pintarKpisFbo(t, previo) {
        const v = (campo) => (previo ? chipVariacion(Motor.variacion(previo[campo], t[campo]), 'vs periodo anterior') : '');
        const mov = fboNum(t.movimientos);
        $('est-fbo-kpis').innerHTML = [
            kpiFbo({ icono: 'fa-plane', color: '#0d6efd', titulo: 'Movimientos', valor: Motor.fmtEntero(mov),
                detalle: `${Motor.fmtEntero(t.llegadas)} llegadas · ${Motor.fmtEntero(t.salidas)} salidas`, variacion: v('movimientos') }),
            kpiFbo({ icono: 'fa-right-left', color: '#0891b2', titulo: 'Vuelos atendidos', valor: Motor.fmtEntero(t.rotaciones),
                detalle: 'Llegada y salida de una visita cuentan una vez', variacion: v('rotaciones') }),
            kpiFbo({ icono: 'fa-users', color: '#20c997', titulo: 'Pasajeros', valor: Motor.fmtEntero(t.pax),
                detalle: `${Motor.fmtEntero(t.adultos)} adultos · ${Motor.fmtEntero(t.infantes)} infantes`, variacion: v('pax') }),
            kpiFbo({ icono: 'fa-hashtag', color: '#6f42c1', titulo: 'Aeronaves distintas', valor: Motor.fmtEntero(t.matriculas),
                detalle: 'Matrículas diferentes en el periodo', variacion: v('matriculas') }),
            kpiFbo({ icono: 'fa-building', color: '#fd7e14', titulo: 'Operadores', valor: Motor.fmtEntero(t.operadores),
                detalle: 'Distintos en el periodo', variacion: v('operadores') }),
            kpiFbo({ icono: 'fa-circle-check', color: '#198754', titulo: 'Validados',
                valor: fboPctTexto(fboNum(t.validados), mov),
                detalle: `${Motor.fmtEntero(t.validados)} de ${Motor.fmtEntero(mov)} · ${Motor.fmtEntero(t.observados)} observados` })
        ].join('');
    }

    function destacadoFbo(icono, titulo, texto, campo, valor) {
        const cuerpo = `<i class="fas ${icono}" aria-hidden="true"></i><span><small>${esc(titulo)}</small><b>${esc(texto)}</b></span>`;
        return campo
            ? `<button type="button" class="fbo-destacado" data-fbo-campo="${esc(campo)}" data-fbo-valor="${esc(valor)}" title="Ver solo ${esc(valor)}">${cuerpo}</button>`
            : `<span class="fbo-destacado">${cuerpo}</span>`;
    }

    function pintarDestacadosFbo(d) {
        const mov = fboNum((d.totales || {}).movimientos);
        const chips = [];
        // Lo que ya está filtrado no se vuelve a destacar: sería el 100 %.
        const filtrado = state.fboFiltro ? state.fboFiltro.campo : null;
        const meses = d.por_mes || [];
        if (meses.length > 1) {
            const pico = meses.reduce((a, f) => (fboNum(f.movimientos) > fboNum(a.movimientos) ? f : a), meses[0]);
            chips.push(destacadoFbo('fa-arrow-trend-up', 'Mes con más movimientos',
                `${fboMes(pico.periodo)} · ${Motor.fmtEntero(pico.movimientos)}`));
        }
        const primero = (lista) => (lista || []).find((f) => fboClave(f.clave));
        const operador = primero(d.top_operadores);
        if (operador && filtrado !== 'operador') {
            chips.push(destacadoFbo('fa-building', 'Operador principal',
                `${operador.clave} · ${fboPctTexto(fboNum(operador.movimientos), mov)}`, 'operador', operador.clave));
        }
        const aeronave = primero(d.top_aeronaves);
        if (aeronave && filtrado !== 'tipo_aeronave') {
            chips.push(destacadoFbo('fa-plane-up', 'Aeronave más usada',
                `${aeronave.clave} · ${Motor.fmtEntero(aeronave.movimientos)}`, 'tipo_aeronave', aeronave.clave));
        }
        const aeropuerto = primero(d.top_aeropuertos);
        if (aeropuerto && filtrado !== 'aeropuerto') {
            chips.push(destacadoFbo('fa-location-dot', 'Origen / destino más frecuente',
                `${aeropuerto.clave} · ${Motor.fmtEntero(aeropuerto.movimientos)}`, 'aeropuerto', aeropuerto.clave));
        }
        // Calidad del dato, a la vista: una buena parte de los movimientos no
        // trae origen/destino, y sin decirlo el ranking engañaría.
        const sinDato = (d.top_aeropuertos || []).find((f) => !fboClave(f.clave));
        if (sinDato && mov) {
            chips.push('<span class="fbo-destacado fbo-destacado-aviso"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>'
                + `<span><small>Calidad del dato</small><b>${fboPctTexto(fboNum(sinDato.movimientos), mov)} sin origen / destino</b></span></span>`);
        }
        $('est-fbo-destacados').innerHTML = chips.join('');
    }

    function barraComposicion(titulo, partes) {
        const total = partes.reduce((a, p) => a + p.valor, 0);
        if (!total) return '';
        const pct = (p) => fboPctTexto(p.valor, total);
        return `<div class="fbo-comp">
            <div class="fbo-comp-titulo">${esc(titulo)}</div>
            <div class="fbo-comp-barra" role="img" aria-label="${esc(partes.map((p) => `${p.etiqueta} ${pct(p)}`).join(', '))}">
                ${partes.map((p) => `<span style="width:${fboPct(p.valor, total).toFixed(2)}%;background:${p.color}" title="${esc(p.etiqueta)}: ${Motor.fmtEntero(p.valor)}"></span>`).join('')}
            </div>
            <div class="fbo-comp-leyenda">${partes.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.etiqueta)} <b>${pct(p)}</b> <small>${Motor.fmtEntero(p.valor)}</small></span>`).join('')}</div>
        </div>`;
    }

    function pintarComposicionFbo(t) {
        $('est-fbo-composicion').innerHTML = [
            barraComposicion('Movimiento', [
                { etiqueta: 'Llegadas', valor: fboNum(t.llegadas), color: '#0d6efd' },
                { etiqueta: 'Salidas', valor: fboNum(t.salidas), color: '#20c997' }
            ]),
            barraComposicion('Ámbito', [
                { etiqueta: 'Nacional', valor: fboNum(t.nacionales), color: '#0369a1' },
                { etiqueta: 'Internacional', valor: fboNum(t.internacionales), color: '#fd7e14' }
            ]),
            barraComposicion('Pasajeros', [
                { etiqueta: 'Adultos', valor: fboNum(t.adultos), color: '#6f42c1' },
                { etiqueta: 'Infantes', valor: fboNum(t.infantes), color: '#d63384' }
            ]),
            barraComposicion('Validación', [
                { etiqueta: 'Validados', valor: fboNum(t.validados), color: '#198754' },
                { etiqueta: 'Pendientes', valor: fboNum(t.pendientes), color: FBO_GRIS },
                { etiqueta: 'Observados', valor: fboNum(t.observados), color: '#dc3545' }
            ])
        ].join('');
    }

    // La tendencia se vuelve a dibujar con lo ya traído: cambiar entre
    // movimientos y pasajeros no consulta otra vez.
    function pintarTendenciaFbo() {
        const datos = state.fboUltimo;
        if (!datos) return;
        const filas = datos.por_mes || [];
        const pax = state.fboMetrica === 'pax';
        const tema = fboTema();
        const valores = filas.map((f) => fboNum(pax ? f.pax : f.movimientos));
        const promedio = valores.length ? valores.reduce((a, v) => a + v, 0) / valores.length : 0;
        const barra = { type: 'bar', borderRadius: 4, maxBarThickness: 56, stack: 'mes' };
        const barras = pax
            ? [Object.assign({ label: 'Pasajeros', data: valores, backgroundColor: '#6f42c1' }, barra)]
            : [
                Object.assign({ label: 'Llegadas', data: filas.map((f) => fboNum(f.llegadas)), backgroundColor: '#0d6efd' }, barra),
                Object.assign({ label: 'Salidas', data: filas.map((f) => fboNum(f.salidas)), backgroundColor: '#20c997' }, barra)
            ];
        pintarGrafica('est-fbo-mes', {
            type: 'bar',
            data: {
                labels: filas.map((f) => fboMes(f.periodo)),
                datasets: barras.concat([{
                    type: 'line',
                    label: `Promedio mensual: ${Motor.fmtEntero(promedio)}`,
                    data: valores.map(() => promedio),
                    borderColor: tema.oscuro ? '#94a3b8' : '#64748b',
                    borderDash: [6, 4],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    stack: 'promedio'
                }])
            },
            options: opcionesGrafica({
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom', labels: { color: tema.texto } },
                    datalabels: { display: false },
                    tooltip: {
                        callbacks: {
                            // El total del mes es el que manda el servidor, no una suma aquí.
                            footer: (elementos) => {
                                if (pax || !elementos.length) return '';
                                return `Total: ${Motor.fmtEntero((filas[elementos[0].dataIndex] || {}).movimientos)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: tema.texto } },
                    y: { stacked: true, beginAtZero: true, grid: { color: tema.rejilla }, ticks: { color: tema.texto } }
                }
            })
        });
        const titulo = $('est-fbo-t-mes');
        if (titulo) titulo.textContent = pax ? 'Pasajeros por mes' : 'Movimientos por mes';
        document.querySelectorAll('#est-pane-fbo [data-fbo-metrica]').forEach((boton) => {
            const activo = boton.dataset.fboMetrica === (pax ? 'pax' : 'movimientos');
            boton.classList.toggle('active', activo);
            boton.setAttribute('aria-pressed', activo ? 'true' : 'false');
        });
    }

    // Lo que no trae dato no entra a la gráfica: con la mitad de los
    // movimientos sin origen/destino, esa barra aplastaría a las demás. Se
    // dice debajo, con su cifra, en lugar de esconderlo.
    function pintarRankingFbo(idCanvas, filas, campo, color, total) {
        const lista = (filas || []).filter((f) => fboClave(f.clave)).slice(0, 10);
        const sinDato = (filas || []).filter((f) => !fboClave(f.clave)).reduce((a, f) => a + fboNum(f.movimientos), 0);
        const nota = $(`${idCanvas}-sin`);
        if (nota) {
            nota.hidden = !sinDato;
            nota.innerHTML = sinDato
                ? `<i class="fas fa-circle-info" aria-hidden="true"></i><span>Además, ${fboCuenta(sinDato, 'movimiento', 'movimientos')} `
                    + `(${fboPctTexto(sinDato, total)}) no ${fboUno(sinDato, 'trae', 'traen')} ${esc(FBO_SIN_DATO[campo])} `
                    + `y no se grafica${fboUno(sinDato, '', 'n')}.</span>`
                : '';
        }
        const canvas = $(idCanvas);
        if (canvas && canvas.parentElement) canvas.parentElement.style.height = `${Math.max(9, lista.length * 1.9 + 2.5)}rem`;
        const tema = fboTema();
        pintarGrafica(idCanvas, {
            type: 'bar',
            data: {
                labels: lista.map((f) => String(f.clave)),
                datasets: [{
                    label: 'Movimientos',
                    data: lista.map((f) => fboNum(f.movimientos)),
                    backgroundColor: color,
                    borderRadius: 6,
                    maxBarThickness: 22
                }]
            },
            options: opcionesGrafica({
                indexAxis: 'y',
                interaction: { mode: 'nearest', axis: 'y', intersect: false },
                layout: { padding: { right: 48 } },
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const f = lista[ctx.dataIndex] || {};
                                return `${Motor.fmtEntero(f.movimientos)} movimientos · ${Motor.fmtEntero(f.pax)} pasajeros · `
                                    + `${Motor.fmtPorcentaje(fboPct(fboNum(f.movimientos), total), 1)} del total`;
                            }
                        }
                    }
                },
                scales: {
                    x: { beginAtZero: true, grid: { color: tema.rejilla }, ticks: { color: tema.texto } },
                    y: {
                        grid: { display: false },
                        // Los nombres largos se abrevian en el eje; completos, en el globo.
                        ticks: {
                            color: tema.texto,
                            callback(valor) {
                                // Cuántas letras caben depende del ancho de la gráfica.
                                const ancho = (this.chart && this.chart.width) || 600;
                                const cabe = Math.max(10, Math.min(24, Math.floor(ancho / 24)));
                                const texto = String(this.getLabelForValue(valor));
                                return texto.length > cabe ? `${texto.slice(0, cabe - 1)}…` : texto;
                            }
                        }
                    }
                },
                // Tocar una barra filtra todo el tablero por ese elemento.
                onClick: (evento, elementos) => {
                    const elegido = elementos && elementos[0];
                    if (elegido) filtrarFbo(campo, (lista[elegido.index] || {}).clave);
                },
                onHover: (evento, elementos) => {
                    const destino = evento && evento.native && evento.native.target;
                    if (destino) destino.style.cursor = elementos && elementos.length ? 'pointer' : 'default';
                }
            }),
            plugins: [FBO_ETIQUETAS]
        });
    }

    function pintarMatriculasFbo(filas) {
        const lista = (filas || []).filter((f) => fboClave(f.clave)).slice(0, 10);
        const maximo = Math.max(1, ...lista.map((f) => fboNum(f.movimientos)));
        $('est-fbo-matriculas').innerHTML = lista.length
            ? `<ol class="fbo-lista">${lista.map((f, i) => `<li>
                <span class="fbo-lista-pos">${i + 1}</span>
                <button type="button" class="fbo-lista-clave" data-fbo-campo="matricula" data-fbo-valor="${esc(f.clave)}" title="Ver solo la ${esc(f.clave)}">${esc(f.clave)}</button>
                <span class="fbo-lista-detalle">${esc([f.operador, f.tipo_aeronave].filter(Boolean).join(' · '))}</span>
                <span class="fbo-lista-barra" aria-hidden="true"><span style="width:${(fboNum(f.movimientos) / maximo * 100).toFixed(1)}%"></span></span>
                <b class="fbo-lista-valor">${Motor.fmtEntero(f.movimientos)}</b>
            </li>`).join('')}</ol>`
            : '<p class="text-muted small mb-0">Sin matrículas en el periodo.</p>';
    }

    // Con el periodo vacío no hay nada que tocar: sin filtro, ni la pista.
    function pintarFiltroFbo(vacio) {
        const caja = $('est-fbo-filtro');
        if (!caja) return;
        const f = state.fboFiltro;
        caja.innerHTML = f
            ? `<span class="fbo-chip"><i class="fas fa-filter" aria-hidden="true"></i>${esc(FBO_CAMPOS[f.campo])}: <b>${esc(f.valor)}</b>`
                + `<button type="button" class="fbo-chip-quitar" data-fbo-quitar aria-label="Quitar el filtro de ${esc(FBO_CAMPOS[f.campo])}">&times;</button></span>`
            : (vacio ? '' : '<span class="fbo-pista"><i class="fas fa-hand-pointer" aria-hidden="true"></i>Toca una barra, un destacado o una matrícula para ver solo eso.</span>');
    }

    function pintarNotaFbo() {
        const nota = $('est-fbo-nota');
        if (!nota) return;
        const ajenos = FBO_FILTROS_AJENOS.filter(([campo]) => (state.filtros[campo] || []).length).map(([, etiqueta]) => etiqueta);
        nota.classList.toggle('d-none', !ajenos.length);
        nota.innerHTML = ajenos.length
            ? '<i class="fas fa-circle-info me-1" aria-hidden="true"></i>En FBO se aplican el periodo, Movimiento y Territorial. '
                + `${esc(ajenos.join(', '))} ${ajenos.length === 1 ? 'es un filtro' : 'son filtros'} de las otras ventanas `
                + `y aquí no se aplica${ajenos.length === 1 ? '' : 'n'}.`
            : '';
    }

    async function pintarVacioFbo(rango) {
        let historico = null;
        try { historico = (await resumenFbo({})).totales || null; } catch (_) { historico = null; }
        const hay = historico && fboNum(historico.movimientos);
        $('est-fbo-vacio').innerHTML = `<i class="fas fa-plane-slash" aria-hidden="true"></i>
            <p class="fbo-vacio-titulo">No hay movimientos de aviación general del ${fboFecha(rango.desde)} al ${fboFecha(rango.hasta)}${state.fboFiltro ? ' con el filtro elegido' : ''}.</p>
            ${hay ? `<p>El histórico cargado va del ${fboFecha(historico.fecha_min)} al ${fboFecha(historico.fecha_max)}.</p>
                <button type="button" class="btn btn-sm btn-primary" data-fbo-historico data-desde="${esc(historico.fecha_min)}" data-hasta="${esc(historico.fecha_max)}">
                    <i class="fas fa-clock-rotate-left me-1" aria-hidden="true"></i>Ver todo el histórico</button>` : ''}`;
    }

    // Las gráficas se dibujan con lo ya traído: al cambiar la métrica o el
    // tema se repintan sin volver a consultar.
    function pintarGraficasFbo() {
        const datos = state.fboUltimo;
        const total = fboNum(((datos || {}).totales || {}).movimientos);
        if (!total) return;
        pintarTendenciaFbo();
        pintarRankingFbo('est-fbo-operadores', datos.top_operadores, 'operador', '#0d6efd', total);
        pintarRankingFbo('est-fbo-aeronaves', datos.top_aeronaves, 'tipo_aeronave', '#6f42c1', total);
        pintarRankingFbo('est-fbo-aeropuertos', datos.top_aeropuertos, 'aeropuerto', '#0f766e', total);
    }

    async function pintarFbo() {
        const rango = { desde: desde(), hasta: hasta() };
        const anterior = Motor.periodoAnterior(rango.desde, rango.hasta);
        const [actual, previo] = await Promise.all([
            resumenFbo(filtrosFbo(rango.desde, rango.hasta)),
            // La comparación es un extra: si falla, el tablero sale sin ella.
            resumenFbo(filtrosFbo(anterior.desde, anterior.hasta)).catch(() => null)
        ]);
        state.fboUltimo = actual;
        const t = actual.totales || {};
        const vacio = !fboNum(t.movimientos);
        pintarFiltroFbo(vacio);
        pintarNotaFbo();
        $('est-fbo-vacio')?.classList.toggle('d-none', !vacio);
        $('est-fbo-contenido')?.classList.toggle('d-none', vacio);
        $('est-fbo-frase').innerHTML = vacio ? '' : fraseFbo(t, rango);
        if (vacio) {
            await pintarVacioFbo(rango);
            return;
        }
        pintarKpisFbo(t, previo && previo.totales);
        pintarDestacadosFbo(actual);
        pintarComposicionFbo(t);
        pintarGraficasFbo();
        pintarMatriculasFbo(actual.top_matriculas);
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
        fbo: pintarFbo,
        descargas: async () => pintarDescargas()
    };

    async function mostrarArea(area, forzar) {
        state.areaActiva = area;

        // El Informe oficial tiene su propia barra: los filtros de este módulo
        // no le aplican y esconderlos evita sugerir que sí.
        $('est-filtros')?.classList.toggle('d-none', area === 'informe');
        // Los avisos de arriba son de la operación del itinerario; en FBO,
        // que lee Aviación General, sólo confundirían.
        if ($('est-avisos')) $('est-avisos').hidden = area === 'fbo';
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
        mostrarAvisoCarga(area);
        try {
            await render();
            state.cargadas.add(area);
            mostrarError(null);
        } catch (error) {
            console.error(`No se pudo cargar el área "${area}" del módulo estadístico:`, error);
            mostrarError(`No se pudieron cargar los datos: ${error?.message || error}`);
        } finally {
            ocupado(area, false);
            quitarAvisoCarga(area);
        }
    }

    function invalidar() {
        state.cargadas.clear();
        state.diagnostico = null;
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
            // Limpiar también quita lo que se eligió tocando el tablero de FBO.
            state.fboFiltro = null;
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

        // FBO: un solo escucha para todo lo que se toca dentro del tablero.
        $('est-pane-fbo')?.addEventListener('click', (evento) => {
            const metrica = evento.target.closest('[data-fbo-metrica]');
            if (metrica) {
                state.fboMetrica = metrica.dataset.fboMetrica === 'pax' ? 'pax' : 'movimientos';
                pintarTendenciaFbo();
                return;
            }
            if (evento.target.closest('[data-fbo-quitar]')) {
                state.fboFiltro = null;
                mostrarArea('fbo', true);
                return;
            }
            const elegido = evento.target.closest('[data-fbo-campo]');
            if (elegido) {
                filtrarFbo(elegido.dataset.fboCampo, elegido.dataset.fboValor);
                return;
            }
            const historico = evento.target.closest('[data-fbo-historico]');
            if (historico && $('est-f-desde') && $('est-f-hasta')) {
                if ($('est-f-preset')) $('est-f-preset').value = '';
                $('est-f-desde').value = historico.dataset.desde;
                $('est-f-hasta').value = historico.dataset.hasta;
                aplicarFiltros();
            }
        });

        // Al cambiar entre claro y oscuro, las gráficas toman sus colores otra
        // vez: FBO se repinta con lo ya traído, el área abierta se vuelve a
        // pintar y las demás, en su próxima apertura. Sólo reacciona la
        // instancia cuyo tablero sigue en la página.
        const raizTablero = $('est-subnav');
        let temaOscuro = document.body.classList.contains('dark-mode');
        if (window.MutationObserver) {
            new MutationObserver(() => {
                const oscuro = document.body.classList.contains('dark-mode');
                if (oscuro === temaOscuro || (raizTablero && !raizTablero.isConnected)) return;
                temaOscuro = oscuro;
                const area = state.areaActiva;
                if (area === 'fbo') {
                    pintarGraficasFbo();
                    [...state.cargadas].filter((a) => a !== 'fbo').forEach((a) => state.cargadas.delete(a));
                    return;
                }
                state.cargadas.clear();
                if (RENDERIZADORES[area]) mostrarArea(area, true);
            }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }

        $('est-exp-consultar')?.addEventListener('click', () => mostrarArea('explorador', true));
        $('est-exp-filtro-campo')?.addEventListener('change', () => {
            if ($('est-exp-filtro-valor')) $('est-exp-filtro-valor').value = '';
            llenarFiltroExtra();
        });
        $('est-exp-filtro-valor')?.addEventListener('change', () => mostrarArea('explorador', true));
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
        porcentajeCarga,
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
