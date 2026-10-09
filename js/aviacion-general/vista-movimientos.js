/* Pantalla "Movimientos" del módulo de Aviación General / FBO.
 *
 * Una fila por movimiento (llegada o salida) de v_fbo_movimientos: las
 * operaciones de operaciones_fbo desde 2026 y el histórico 2022-2025.
 * Paginado, ordenable y exportable.
 *
 * POR QUÉ PAGINADO EN EL SERVIDOR
 *
 *   PostgREST corta cada respuesta en 1000 filas y la tabla ya pasa de eso.
 *   Se pide una página a la vez a fbo_movimientos_filtrados con range() y el
 *   conteo exacto: el filtro, el orden y el total los resuelve PostgreSQL con
 *   la MISMA definición de filtros que el Resumen, así el "de N movimientos"
 *   de aquí es el mismo número que el KPI.
 *
 * La exportación baja lo filtrado por páginas de mil y avisa si se topa con el
 * límite, porque una exportación truncada en silencio es peor que una que no
 * se hizo.
 *
 * Sin edición ni bajas: el módulo es estadístico y las correcciones entran
 * reimportando el Layout, que reemplaza por registro.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-movimientos: falta panel.js'); return; }

    const { Core, Datos, esc, aviso, cargando, vacio } = AG;

    const TAMANOS = [25, 50, 100, 200];
    const LIMITE_EXPORTACION = 50000;

    const estado = {
        pagina: 1,
        porPagina: 50,
        orden: 'fecha',
        ascendente: false,
        total: 0,
        filas: []
    };

    // `orden` es la columna de v_fbo_movimientos por la que ordena la base al
    // hacer clic en el encabezado; sin `orden`, el encabezado no es pulsable.
    const COLUMNAS = [
        { campo: 'registro',          titulo: 'Registro',    orden: 'registro', clase: 'ag-mono' },
        { campo: 'fecha',             titulo: 'Fecha',       orden: 'fecha' },
        { campo: 'hora',              titulo: 'Hora',        orden: 'hora', clase: 'ag-num' },
        { campo: 'tipo_movimiento',   titulo: 'Movimiento',  orden: 'tipo_movimiento' },
        { campo: 'ambito',            titulo: 'Ámbito',      orden: 'ambito' },
        { campo: 'operador',          titulo: 'Operador',    orden: 'operador' },
        { campo: 'vuelo_operado_por', titulo: 'Prestador',   orden: 'vuelo_operado_por' },
        { campo: 'matricula',         titulo: 'Matrícula',   orden: 'matricula', clase: 'ag-mono' },
        { campo: 'tipo_aeronave',     titulo: 'Aeronave',    orden: 'tipo_aeronave' },
        { campo: 'tipo_ala',          titulo: 'Ala' },
        { campo: 'aeropuerto',        titulo: 'Orig./Dest.', orden: 'aeropuerto', clase: 'ag-mono' },
        { campo: 'hora_pista',        titulo: 'Pista',       clase: 'ag-num' },
        { campo: 'hora_posicion',     titulo: 'Posición',    clase: 'ag-num' },
        { campo: 'pax_adultos',       titulo: 'Ad.',         clase: 'ag-num' },
        { campo: 'pax_infantes',      titulo: 'Inf.',        clase: 'ag-num' },
        { campo: 'pax_total',         titulo: 'Pax',         orden: 'pax_total', clase: 'ag-num fw-bold' }
    ];

    // ── Presentación de una celda ───────────────────────────────────────────

    function insigniaTipo(valor) {
        const llegada = valor === 'LLEGADA';
        const clase = llegada ? 'ag-badge--llegada' : 'ag-badge--salida';
        const icono = llegada ? 'fa-plane-arrival' : 'fa-plane-departure';
        return `<span class="ag-badge ${clase}"><i class="fas ${icono} me-1"></i>${esc(valor)}</span>`;
    }

    function insigniaAmbito(valor) {
        if (valor !== 'NAC' && valor !== 'INT') return valor ? esc(valor) : '—';
        return `<span class="ag-badge ${valor === 'INT' ? 'ag-badge--int' : 'ag-badge--nal'}">${esc(valor)}</span>`;
    }

    function celda(fila, col) {
        switch (col.campo) {
            case 'registro':
                if (fila.fuente === 'HISTORICO') {
                    return `<span class="ag-od-ciudad" title="Histórico 2022–2025 (aviacion_general_operaciones)">${esc(fila.registro)}</span>`;
                }
                return esc(fila.registro || '—');
            case 'fecha': {
                // En el histórico, una salida de 2022-2023 cuenta en la fecha de
                // su llegada (como siempre ha contado el módulo). Se enseña la
                // fecha real y se avisa en qué fecha cuenta.
                const real = esc(Core.fechaLarga(fila.fecha_real || fila.fecha));
                if (fila.fecha_real && fila.fecha && fila.fecha_real !== fila.fecha) {
                    return `<span class="ag-od-ciudad" title="Cuenta el ${esc(Core.fechaLarga(fila.fecha))}, fecha de su llegada (rotación)">${real}</span>`;
                }
                return real;
            }
            case 'hora':
            case 'hora_pista':
            case 'hora_posicion':
                return esc(Core.horaCorta(fila[col.campo]));
            case 'tipo_movimiento': return insigniaTipo(fila.tipo_movimiento);
            case 'ambito':          return insigniaAmbito(fila.ambito);
            case 'operador':
                return `<span class="d-inline-block text-truncate" style="max-width:220px" title="${esc(fila.operador)}">${esc(fila.operador || '—')}</span>`;
            default: {
                const v = fila[col.campo];
                return v === null || v === undefined || v === '' ? '—' : esc(v);
            }
        }
    }

    // ── Armado de la tabla ──────────────────────────────────────────────────

    function encabezados() {
        return COLUMNAS.map((col) => {
            if (!col.orden) return `<th class="${col.clase || ''}">${esc(col.titulo)}</th>`;
            const activa = estado.orden === col.orden;
            const flecha = activa ? (estado.ascendente ? '▲' : '▼') : '';
            return `<th class="${col.clase || ''}" role="button" data-ag-orden="${col.orden}"
                        title="Ordenar por ${esc(col.titulo)}">${esc(col.titulo)}
                        <span class="text-info">${flecha}</span></th>`;
        }).join('');
    }

    function cuerpo() {
        if (!estado.filas.length) {
            return `<tr><td colspan="${COLUMNAS.length}">${vacio('No hay movimientos con estos filtros', 'fa-filter-circle-xmark')}</td></tr>`;
        }
        return estado.filas.map((fila) => {
            const celdas = COLUMNAS.map((col) => `<td class="${col.clase || ''}">${celda(fila, col)}</td>`).join('');
            return `<tr data-id="${esc(fila.movimiento_id)}">${celdas}</tr>`;
        }).join('');
    }

    function paginador() {
        const desde = estado.total === 0 ? 0 : (estado.pagina - 1) * estado.porPagina + 1;
        const hasta = Math.min(estado.pagina * estado.porPagina, estado.total);
        const paginas = Math.max(1, Math.ceil(estado.total / estado.porPagina));
        return `
            <div class="d-flex flex-wrap align-items-center gap-2 justify-content-between mt-2 ag-no-print">
                <div class="small text-muted">
                    <strong>${Core.numero(desde)}–${Core.numero(hasta)}</strong> de
                    <strong>${Core.numero(estado.total)}</strong> movimientos
                </div>
                <div class="d-flex align-items-center gap-2">
                    <select class="form-select form-select-sm w-auto" id="ag-mov-tam" aria-label="Registros por página">
                        ${TAMANOS.map((t) => `<option value="${t}" ${t === estado.porPagina ? 'selected' : ''}>${t} por página</option>`).join('')}
                    </select>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary" id="ag-mov-primera" ${estado.pagina <= 1 ? 'disabled' : ''}>
                            <i class="fas fa-angles-left"></i></button>
                        <button class="btn btn-outline-secondary" id="ag-mov-antes" ${estado.pagina <= 1 ? 'disabled' : ''}>
                            <i class="fas fa-angle-left"></i></button>
                        <span class="btn btn-outline-secondary disabled">${estado.pagina} / ${paginas}</span>
                        <button class="btn btn-outline-secondary" id="ag-mov-despues" ${estado.pagina >= paginas ? 'disabled' : ''}>
                            <i class="fas fa-angle-right"></i></button>
                        <button class="btn btn-outline-secondary" id="ag-mov-ultima" ${estado.pagina >= paginas ? 'disabled' : ''}>
                            <i class="fas fa-angles-right"></i></button>
                    </div>
                </div>
            </div>`;
    }

    function plantilla() {
        return `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2 ag-no-print">
            <span class="small text-muted">
                Llegadas cuentan en su fecha de aterrizaje y salidas en su fecha de salida de posición.
            </span>
            <div class="ms-auto d-flex gap-2">
                <button class="btn btn-sm btn-outline-success" id="ag-mov-excel">
                    <i class="fas fa-file-excel me-1"></i>Excel
                </button>
                <button class="btn btn-sm btn-outline-secondary" id="ag-mov-csv">
                    <i class="fas fa-file-csv me-1"></i>CSV
                </button>
                <button class="btn btn-sm btn-outline-secondary" id="ag-mov-imprimir">
                    <i class="fas fa-print me-1"></i>Imprimir
                </button>
            </div>
        </div>

        <div class="ag-tabla-wrap">
            <table class="table table-hover ag-tabla mb-0" id="ag-mov-tabla">
                <thead><tr id="ag-mov-thead"></tr></thead>
                <tbody id="ag-mov-tbody"></tbody>
            </table>
        </div>
        <div id="ag-mov-paginador"></div>`;
    }

    // ── Consulta y pintado ──────────────────────────────────────────────────

    async function consultar(panel) {
        const tbody = panel.querySelector('#ag-mov-tbody');
        tbody.innerHTML = `<tr><td colspan="${COLUMNAS.length}">${cargando('Consultando los movimientos…')}</td></tr>`;

        const r = await Datos.movimientos({
            filtros: AG.filtros,
            pagina: estado.pagina,
            porPagina: estado.porPagina,
            orden: estado.orden,
            ascendente: estado.ascendente
        });

        estado.filas = r.filas;
        estado.total = r.total;

        panel.querySelector('#ag-mov-thead').innerHTML = encabezados();
        tbody.innerHTML = cuerpo();
        panel.querySelector('#ag-mov-paginador').innerHTML = paginador();
        conectarPaginador(panel);
        AG.marcador('movimientos', Core.numero(estado.total), 'bg-info text-dark');
    }

    function conectarPaginador(panel) {
        const ir = (pagina) => { estado.pagina = pagina; consultar(panel).catch((e) => AG.pintarError(panel.querySelector('#ag-mov-paginador'), e)); };
        const paginas = Math.max(1, Math.ceil(estado.total / estado.porPagina));
        panel.querySelector('#ag-mov-primera')?.addEventListener('click', () => ir(1));
        panel.querySelector('#ag-mov-antes')?.addEventListener('click', () => ir(Math.max(1, estado.pagina - 1)));
        panel.querySelector('#ag-mov-despues')?.addEventListener('click', () => ir(Math.min(paginas, estado.pagina + 1)));
        panel.querySelector('#ag-mov-ultima')?.addEventListener('click', () => ir(paginas));
        panel.querySelector('#ag-mov-tam')?.addEventListener('change', (e) => {
            estado.porPagina = Number(e.target.value) || 50;
            ir(1);
        });
    }

    // ── Exportación ─────────────────────────────────────────────────────────

    function aFilasPlanas(filas) {
        return filas.map((f) => ({
            'REGISTRO': f.registro,
            'FUENTE': f.fuente === 'HISTORICO' ? 'HISTÓRICO' : 'FBO',
            'FECHA': f.fecha_real || f.fecha,
            'FECHA DE CONTEO': f.fecha,
            'HORA': Core.horaCorta(f.hora).replace('—', ''),
            'MOVIMIENTO': f.tipo_movimiento,
            'ÁMBITO': f.ambito,
            'OPERADOR': f.operador,
            'PRESTADOR': f.vuelo_operado_por,
            'MATRÍCULA': f.matricula,
            'TIPO DE AERONAVE': f.tipo_aeronave,
            'TIPO DE ALA': f.tipo_ala,
            'ORIGEN': f.origen,
            'DESTINO': f.destino,
            'HR. PISTA': Core.horaCorta(f.hora_pista).replace('—', ''),
            'HR. POSICIÓN': Core.horaCorta(f.hora_posicion).replace('—', ''),
            'PAX ADULTOS': f.pax_adultos,
            'PAX INFANTES': f.pax_infantes,
            'PAX TOTAL': f.pax_total
        }));
    }

    function nombreArchivo(extension) {
        const f = AG.filtros;
        const rango = [f.fecha_desde, f.fecha_hasta].filter(Boolean).join('_a_') || 'completo';
        return `aviacion_general_movimientos_${rango}.${extension}`;
    }

    async function exportar(panel, formato) {
        const boton = panel.querySelector(formato === 'csv' ? '#ag-mov-csv' : '#ag-mov-excel');
        const textoOriginal = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Preparando…';
        try {
            if (typeof root.XLSX === 'undefined') {
                aviso('No se pudo cargar la librería de Excel. Revisa tu conexión.', 'error');
                return;
            }
            const { filas, total } = await Datos.movimientosTodos({ filtros: AG.filtros, limite: LIMITE_EXPORTACION });
            if (!filas.length) { aviso('No hay movimientos que exportar con estos filtros.', 'warning'); return; }
            if (filas.length < total) {
                aviso(`La exportación se detuvo en ${Core.numero(filas.length)} de ${Core.numero(total)} movimientos. Acota el rango de fechas para llevarte el resto.`, 'warning');
            }

            const hoja = root.XLSX.utils.json_to_sheet(aFilasPlanas(filas));
            const libro = root.XLSX.utils.book_new();
            root.XLSX.utils.book_append_sheet(libro, hoja, 'Movimientos');
            if (formato === 'csv') {
                root.XLSX.writeFile(libro, nombreArchivo('csv'), { bookType: 'csv' });
            } else {
                root.XLSX.writeFile(libro, nombreArchivo('xlsx'));
            }
            aviso(`Se exportaron ${Core.numero(filas.length)} movimientos.`, 'success');
        } catch (error) {
            console.error('[Aviación General] exportación', error);
            aviso(error.message || 'No se pudo exportar.', 'error');
        } finally {
            boton.disabled = false;
            boton.innerHTML = textoOriginal;
        }
    }

    AG.registrarVista({
        id: 'movimientos',
        etiqueta: 'Movimientos',
        icono: 'fa-table-list',
        orden: 20,

        async montar(panel) {
            panel.innerHTML = plantilla();

            panel.querySelector('#ag-mov-excel').addEventListener('click', () => exportar(panel, 'xlsx'));
            panel.querySelector('#ag-mov-csv').addEventListener('click', () => exportar(panel, 'csv'));
            panel.querySelector('#ag-mov-imprimir').addEventListener('click', () => root.print());

            // Delegación: la tabla se redibuja entera en cada consulta.
            panel.querySelector('#ag-mov-tabla').addEventListener('click', (e) => {
                const th = e.target.closest('[data-ag-orden]');
                if (!th) return;
                const campo = th.dataset.agOrden;
                if (estado.orden === campo) estado.ascendente = !estado.ascendente;
                else { estado.orden = campo; estado.ascendente = false; }
                estado.pagina = 1;
                consultar(panel).catch((err) => AG.pintarError(panel.querySelector('#ag-mov-paginador'), err));
            });

            // Cuando la importación guarda algo, esta lista deja de estar al día.
            AG.on('datos:cambiaron', () => {
                if (panel.classList.contains('active')) {
                    consultar(panel).catch((err) => AG.pintarError(panel.querySelector('#ag-mov-paginador'), err));
                }
            });
        },

        async refrescar(panel) {
            estado.pagina = 1;
            await consultar(panel);
        }
    });

    root.AviacionGeneralMovimientos = {
        get estado() { return Object.assign({}, estado); }
    };
})(typeof window !== 'undefined' ? window : globalThis);
