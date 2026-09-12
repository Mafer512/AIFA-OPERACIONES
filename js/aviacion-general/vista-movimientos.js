/* Pantalla "Movimientos" del módulo de Aviación General / FBO.
 *
 * El histórico completo, paginado, ordenable y exportable.
 *
 * POR QUÉ PAGINADO Y NO "CARGAR TODO Y FILTRAR EN EL NAVEGADOR"
 *
 *   Hoy son 1,892 registros y cabrían en memoria. En dos años no, y para
 *   entonces cambiar el enfoque significa reescribir la pantalla con gente
 *   usándola. Se pide una página a la vez desde el principio: el filtro, el
 *   orden y el conteo los resuelve PostgreSQL con los índices de la migración
 *   046, y la pantalla no crece en costo aunque la tabla sí.
 *
 * La exportación es la excepción y está acotada: baja lo filtrado por tandas de
 * mil y avisa si se topa con el límite, porque una exportación truncada en
 * silencio es peor que una que no se hizo.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-movimientos: falta panel.js'); return; }

    const { Core, Datos, esc, aviso, cargando, vacio } = AG;

    const TAMANOS = [25, 50, 100, 200];

    const estado = {
        pagina: 1,
        porPagina: 50,
        orden: 'fecha_operacion',
        ascendente: false,
        total: 0,
        filas: []
    };

    // Columnas de la tabla. `orden` indica por cuál campo ordena la base al
    // hacer clic en el encabezado; sin `orden`, el encabezado no es pulsable.
    const COLUMNAS = [
        { campo: 'folio_rotacion',            titulo: 'No.',        orden: 'folio_rotacion', clase: 'ag-num' },
        { campo: 'fecha_operacion',           titulo: 'Fecha',      orden: 'fecha_operacion' },
        { campo: 'tipo_operacion',            titulo: 'Movimiento', orden: 'tipo_operacion' },
        { campo: 'ambito_operacion',          titulo: 'Ámbito',     orden: 'ambito_operacion' },
        { campo: 'operador',                  titulo: 'Operador',   orden: 'operador' },
        { campo: 'matricula',                 titulo: 'Matrícula',  orden: 'matricula', clase: 'ag-mono' },
        { campo: 'tipo_aeronave',             titulo: 'Aeronave',   orden: 'tipo_aeronave' },
        { campo: 'aeropuerto_origen_destino', titulo: 'Orig./Dest.', orden: 'aeropuerto_origen_destino', clase: 'ag-mono' },
        { campo: 'hora_programada',           titulo: 'Hr. prog.',  orden: 'hora_programada', clase: 'ag-num' },
        { campo: 'hora_real',                 titulo: 'Hr. real',   orden: 'hora_real', clase: 'ag-num' },
        { campo: 'adultos',                   titulo: 'Ad.',        clase: 'ag-num' },
        { campo: 'infantes',                  titulo: 'Inf.',       clase: 'ag-num' },
        { campo: 'pax_ag',                    titulo: 'Pax A.G.',   clase: 'ag-num fw-bold' },
        { campo: 'estado_validacion',         titulo: 'Validación', orden: 'estado_validacion' },
        { campo: '__acciones',                titulo: '' }
    ];

    // ── Presentación de una celda ───────────────────────────────────────────

    function insigniaTipo(valor) {
        const clase = valor === 'LLEGADA' ? 'ag-badge--llegada' : 'ag-badge--salida';
        const icono = valor === 'LLEGADA' ? 'fa-plane-arrival' : 'fa-plane-departure';
        return `<span class="ag-badge ${clase}"><i class="fas ${icono} me-1"></i>${esc(valor)}</span>`;
    }

    function insigniaAmbito(valor) {
        const clase = valor === 'INTERNACIONAL' ? 'ag-badge--int' : 'ag-badge--nal';
        return `<span class="ag-badge ${clase}">${esc(valor === 'INTERNACIONAL' ? 'INT' : 'NAL')}</span>`;
    }

    function insigniaValidacion(fila) {
        const mapa = {
            PENDIENTE: ['ag-badge--pend', 'fa-clock', 'Pendiente'],
            VALIDADO:  ['ag-badge--val', 'fa-check', 'Validado'],
            OBSERVADO: ['ag-badge--obs', 'fa-triangle-exclamation', 'Observado']
        };
        const [clase, icono, texto] = mapa[fila.estado_validacion] || mapa.PENDIENTE;
        const titulo = fila.observacion_validacion ? ` title="${esc(fila.observacion_validacion)}"` : '';
        return `<span class="ag-badge ${clase}"${titulo}><i class="fas ${icono} me-1"></i>${texto}</span>`;
    }

    function celda(fila, col) {
        switch (col.campo) {
            case 'fecha_operacion':   return esc(Core.fechaLarga(fila.fecha_operacion));
            case 'tipo_operacion':    return insigniaTipo(fila.tipo_operacion);
            case 'ambito_operacion':  return insigniaAmbito(fila.ambito_operacion);
            case 'hora_programada':   return esc(Core.horaCorta(fila.hora_programada));
            case 'hora_real':         return esc(Core.horaCorta(fila.hora_real));
            case 'estado_validacion': return insigniaValidacion(fila);
            case 'operador':
                return `<span class="d-inline-block text-truncate" style="max-width:220px" title="${esc(fila.operador)}">${esc(fila.operador)}</span>`;
            case 'observaciones':     return esc(fila.observaciones || '');
            case '__acciones':        return acciones(fila);
            default: {
                const v = fila[col.campo];
                return v === null || v === undefined || v === '' ? '—' : esc(v);
            }
        }
    }

    function acciones(fila) {
        const botones = [];
        const anulado = fila.estatus_registro !== 'ACTIVO';

        botones.push(`<button class="btn btn-sm btn-link p-0 px-1 text-secondary" data-ag-accion="historial" data-id="${fila.id}"
                        title="Ver historial de cambios"><i class="fas fa-clock-rotate-left"></i></button>`);

        if (AG.puedeCapturar() && !anulado) {
            botones.push(`<button class="btn btn-sm btn-link p-0 px-1 text-primary" data-ag-accion="editar" data-id="${fila.id}"
                            title="Editar movimiento"><i class="fas fa-pen"></i></button>`);
        }
        if (AG.puedeEditar()) {
            botones.push(anulado
                ? `<button class="btn btn-sm btn-link p-0 px-1 text-success" data-ag-accion="reactivar" data-id="${fila.id}"
                     title="Reactivar movimiento"><i class="fas fa-rotate-left"></i></button>`
                : `<button class="btn btn-sm btn-link p-0 px-1 text-danger" data-ag-accion="baja" data-id="${fila.id}"
                     title="Dar de baja (no se borra)"><i class="fas fa-ban"></i></button>`);
        }
        return `<div class="d-flex gap-1 ag-no-print">${botones.join('')}</div>`;
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
            const anulada = fila.estatus_registro !== 'ACTIVO' ? ' class="ag-anulada"' : '';
            const celdas = COLUMNAS.map((col) => `<td class="${col.clase || ''}">${celda(fila, col)}</td>`).join('');
            return `<tr${anulada} data-id="${fila.id}">${celdas}</tr>`;
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
            <button class="btn btn-sm btn-success" id="ag-mov-nuevo" hidden>
                <i class="fas fa-plus me-1"></i>Nuevo movimiento
            </button>
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
        tbody.innerHTML = `<tr><td colspan="${COLUMNAS.length}">${cargando('Consultando el histórico…')}</td></tr>`;

        const r = await Datos.listar({
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
        const ir = (pagina) => { estado.pagina = pagina; consultar(panel); };
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

    /**
     * Se exportan los MISMOS encabezados del Excel original.
     *
     * No es nostalgia: lo que sale de aquí se pega en oficios y comparativos
     * que llevan años con esos títulos. Cambiarlos por los nombres técnicos de
     * la base obligaría a quien recibe el archivo a traducir columna por
     * columna.
     */
    function aFilasPlanas(filas) {
        return filas.map((f) => ({
            'No.': f.folio_rotacion,
            'FECHA': f.fecha_operacion,
            'TIPO DE OPERACIÓN': f.tipo_operacion,
            'NACIONAL': f.ambito_operacion,
            'NOMBRE DEL OPERADOR': f.operador,
            'MATRÍCULA': f.matricula,
            'TIPO DE AERONAVE': f.tipo_aeronave,
            'DESTINO / ORIGEN': f.aeropuerto_origen_destino,
            'HR. PROG.': Core.horaCorta(f.hora_programada).replace('—', ''),
            'HR. REAL': Core.horaCorta(f.hora_real).replace('—', ''),
            'ADULTOS': f.adultos,
            'INFANTES': f.infantes,
            'PAX. A.G.': f.pax_ag,
            'PAX. O.D.': f.pax_od,
            'ESTADO': f.estado,
            'PAÍS': f.pais,
            'OBSERVACIONES': f.observaciones,
            'VALIDACIÓN': f.estado_validacion,
            'ESTATUS': f.estatus_registro
        }));
    }

    function nombreArchivo(extension) {
        const f = AG.filtros;
        const rango = [f.fecha_desde, f.fecha_hasta].filter(Boolean).join('_a_') || 'completo';
        return `aviacion_general_${rango}.${extension}`;
    }

    async function exportar(panel, formato) {
        const boton = panel.querySelector(formato === 'csv' ? '#ag-mov-csv' : '#ag-mov-excel');
        const textoOriginal = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Preparando…';
        try {
            const LIMITE = 20000;
            const filas = await Datos.listarTodo({ filtros: AG.filtros, limite: LIMITE });
            if (!filas.length) { aviso('No hay movimientos que exportar con estos filtros.', 'warning'); return; }
            if (filas.length >= LIMITE) {
                aviso(`La exportación se detuvo en ${Core.numero(LIMITE)} registros. Acota el rango de fechas para llevarte el resto.`, 'warning');
            }

            if (typeof root.XLSX === 'undefined') {
                aviso('No se pudo cargar la librería de Excel. Revisa tu conexión.', 'error');
                return;
            }

            const hoja = root.XLSX.utils.json_to_sheet(aFilasPlanas(filas));
            const libro = root.XLSX.utils.book_new();
            root.XLSX.utils.book_append_sheet(libro, hoja, 'Aviación General');

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

    // ── Acciones sobre una fila ─────────────────────────────────────────────

    async function manejarAccion(panel, accion, id) {
        const fila = estado.filas.find((f) => String(f.id) === String(id));

        if (accion === 'editar') {
            AG.emit('movimiento:editar', fila || { id: Number(id) });
            return;
        }
        if (accion === 'historial') {
            AG.emit('movimiento:historial', fila || { id: Number(id) });
            return;
        }
        if (accion === 'baja') {
            // Un motivo obligatorio, no un "¿estás seguro?". Dentro de un mes
            // la pregunta no va a ser si estaba seguro, va a ser por qué lo hizo.
            const motivo = root.prompt(
                `Dar de baja el movimiento #${id}.\n\nEl registro NO se borra: queda como ANULADO con este motivo.\n\nMotivo:`
            );
            if (motivo === null) return;
            if (!motivo.trim()) { aviso('La baja exige un motivo.', 'warning'); return; }
            try {
                await Datos.baja(Number(id), motivo.trim(), 'ANULADO');
                aviso('Movimiento dado de baja.', 'success');
                await consultar(panel);
                AG.emit('datos:cambiaron');
            } catch (error) { aviso(error.message, 'error'); }
            return;
        }
        if (accion === 'reactivar') {
            try {
                await Datos.reactivar(Number(id));
                aviso('Movimiento reactivado.', 'success');
                await consultar(panel);
                AG.emit('datos:cambiaron');
            } catch (error) { aviso(error.message, 'error'); }
        }
    }

    AG.registrarVista({
        id: 'movimientos',
        etiqueta: 'Movimientos',
        icono: 'fa-table-list',
        orden: 20,

        async montar(panel) {
            panel.innerHTML = plantilla();

            const nuevo = panel.querySelector('#ag-mov-nuevo');
            nuevo.hidden = !AG.puedeCapturar();
            nuevo.addEventListener('click', () => AG.emit('movimiento:nuevo'));

            panel.querySelector('#ag-mov-excel').addEventListener('click', () => exportar(panel, 'xlsx'));
            panel.querySelector('#ag-mov-csv').addEventListener('click', () => exportar(panel, 'csv'));
            panel.querySelector('#ag-mov-imprimir').addEventListener('click', () => root.print());

            // Delegación: la tabla se redibuja entera en cada consulta, así que
            // enganchar cada botón por separado sería volver a hacerlo cada vez.
            panel.querySelector('#ag-mov-tabla').addEventListener('click', (e) => {
                const th = e.target.closest('[data-ag-orden]');
                if (th) {
                    const campo = th.dataset.agOrden;
                    if (estado.orden === campo) estado.ascendente = !estado.ascendente;
                    else { estado.orden = campo; estado.ascendente = false; }
                    estado.pagina = 1;
                    consultar(panel);
                    return;
                }
                const btn = e.target.closest('[data-ag-accion]');
                if (btn) manejarAccion(panel, btn.dataset.agAccion, btn.dataset.id);
            });

            // Cuando otra pantalla guarda algo, ésta deja de estar al día.
            AG.on('datos:cambiaron', () => {
                if (panel.classList.contains('active')) consultar(panel);
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
