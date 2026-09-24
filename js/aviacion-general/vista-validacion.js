/* Pantalla "Validación" del módulo de Aviación General / FBO.
 *
 * La bandeja de lo que todavía no revisa nadie. Un movimiento nace PENDIENTE
 * —lo mismo si se capturó a mano que si entró por importación— y alguien con
 * nivel de edición lo pasa a VALIDADO o lo devuelve como OBSERVADO.
 *
 * POR QUÉ OBSERVAR EXIGE UN COMENTARIO
 *
 *   Porque un registro marcado "observado" sin decir qué tiene de malo no le
 *   sirve a quien lo va a corregir: sólo le informa que algo está mal y le deja
 *   la tarea de adivinar qué. La regla se aplica en los dos lados —aquí y en la
 *   función aviacion_general_validar de la migración 046—, de modo que tampoco
 *   se puede saltar llamando al RPC por fuera.
 *
 * Aquí vive también el enlace de rotaciones, que no es validación pero sí
 * saneamiento del mismo dato: unir cada llegada con su salida por folio. Se
 * deja en esta pestaña porque es la que abre quien está cuidando la calidad del
 * histórico, no quien está capturando.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-validacion: falta panel.js'); return; }

    const { Core, Datos, esc, aviso, cargando, vacio } = AG;

    const estado = { filas: [], seleccion: new Set(), porPagina: 200 };

    function plantilla() {
        return `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2 ag-no-print">
            <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary" id="ag-val-todos">
                    <i class="fas fa-check-double me-1"></i>Seleccionar todo
                </button>
                <button class="btn btn-outline-secondary" id="ag-val-ninguno">
                    <i class="fas fa-xmark me-1"></i>Ninguno
                </button>
            </div>
            <span class="small text-muted" id="ag-val-conteo">Nada seleccionado</span>

            <div class="ms-auto d-flex flex-wrap gap-2">
                <button class="btn btn-sm btn-success" id="ag-val-validar" disabled>
                    <i class="fas fa-check me-1"></i>Validar
                </button>
                <button class="btn btn-sm btn-warning" id="ag-val-observar" disabled>
                    <i class="fas fa-triangle-exclamation me-1"></i>Observar
                </button>
                <button class="btn btn-sm btn-outline-secondary" id="ag-val-pendiente" disabled>
                    <i class="fas fa-rotate-left me-1"></i>Regresar a pendiente
                </button>
            </div>
        </div>

        <div class="alert alert-secondary py-2 small d-none ag-no-print" id="ag-val-sin-permiso">
            <i class="fas fa-lock me-1"></i>
            Validar requiere nivel de edición en este módulo. Puedes consultar la bandeja, pero no cambiar estados.
        </div>

        <div class="ag-tabla-wrap">
            <table class="table table-hover ag-tabla mb-0" id="ag-val-tabla">
                <thead>
                    <tr>
                        <th style="width:34px"><input type="checkbox" class="form-check-input" id="ag-val-cab-check"
                                aria-label="Seleccionar todos los visibles"></th>
                        <th>Fila</th><th>Fecha</th><th>Mov.</th><th>Ámbito</th><th>Operador</th>
                        <th>Matrícula</th><th>Aeronave</th><th>O/D</th><th class="ag-num">Pax</th>
                        <th>Estado</th><th>Origen</th>
                    </tr>
                </thead>
                <tbody id="ag-val-tbody"></tbody>
            </table>
        </div>
        <div class="small text-muted mt-2" id="ag-val-pie"></div>

        <div class="ag-card mt-3" id="ag-val-herramientas">
            <h6>Saneamiento del histórico</h6>
            <div class="row g-2 align-items-end">
                <div class="col-12 col-md-7">
                    <div class="small text-muted">
                        <strong>Enlazar llegadas con salidas.</strong>
                        Recorre el periodo filtrado y une los movimientos que comparten folio de rotación
                        y matrícula. Sólo toca parejas inequívocas —una llegada y una salida—; lo ambiguo
                        lo deja intacto y lo reporta.
                    </div>
                </div>
                <div class="col-6 col-md-2">
                    <label class="form-label small fw-bold" for="ag-val-ventana">Días de ventana</label>
                    <input type="number" class="form-control form-control-sm" id="ag-val-ventana" value="3" min="0" max="30">
                </div>
                <div class="col-6 col-md-3">
                    <button class="btn btn-sm btn-outline-info w-100" id="ag-val-enlazar">
                        <i class="fas fa-link me-1"></i>Enlazar rotaciones
                    </button>
                </div>
            </div>
            <div id="ag-val-enlace-resultado" class="mt-2"></div>

            <hr class="my-3">

            <div class="row g-2 align-items-end">
                <div class="col-12 col-md-9">
                    <div class="small text-muted">
                        <strong>Capturas repetidas.</strong>
                        Busca movimientos con el mismo folio, matrícula, fecha y tipo: el
                        histórico cargado trae varios, porque el mismo renglón se anotó dos
                        veces en el Excel de origen. No se borra nada automáticamente —cuando
                        las dos copias discrepan, no siempre la buena es la primera—: se listan
                        para que las revises y anules la sobrante con su motivo.
                    </div>
                </div>
                <div class="col-12 col-md-3">
                    <button class="btn btn-sm btn-outline-warning w-100" id="ag-val-duplicados">
                        <i class="fas fa-clone me-1"></i>Buscar repetidos
                    </button>
                </div>
            </div>
            <div id="ag-val-duplicados-resultado" class="mt-2"></div>
        </div>`;
    }

    function filaHTML(f) {
        const mapa = {
            PENDIENTE: ['ag-badge--pend', 'Pendiente'],
            VALIDADO:  ['ag-badge--val', 'Validado'],
            OBSERVADO: ['ag-badge--obs', 'Observado']
        };
        const [clase, texto] = mapa[f.estado_validacion] || mapa.PENDIENTE;
        const origen = f.tipo_fuente === 'IMPORTACION_EXCEL'
            ? `<span class="ag-badge ag-badge--nal" title="${esc(f.archivo_origen || '')}${f.fila_origen ? ` · fila ${f.fila_origen}` : ''}">
                 <i class="fas fa-file-excel me-1"></i>Excel</span>`
            : `<span class="ag-badge ag-badge--nal"><i class="fas fa-keyboard me-1"></i>Captura</span>`;

        return `
        <tr data-id="${f.id}">
            <td><input type="checkbox" class="form-check-input ag-val-check" data-id="${f.id}"
                       ${estado.seleccion.has(f.id) ? 'checked' : ''} aria-label="Seleccionar movimiento ${f.id}"></td>
            <td class="ag-num text-muted">#${f.id}</td>
            <td>${esc(Core.fechaLarga(f.fecha_operacion))}</td>
            <td>${esc(f.tipo_operacion === 'LLEGADA' ? 'Llegada' : 'Salida')}</td>
            <td>${esc(f.ambito_operacion === 'INTERNACIONAL' ? 'INT' : 'NAL')}</td>
            <td class="text-truncate" style="max-width:200px" title="${esc(f.operador)}">${esc(f.operador)}</td>
            <td class="ag-mono">${esc(f.matricula)}</td>
            <td>${esc(f.tipo_aeronave)}</td>
            <td class="ag-mono">${esc(f.aeropuerto_origen_destino)}</td>
            <td class="ag-num">${esc(f.pax_ag)}</td>
            <td><span class="ag-badge ${clase}" ${f.observacion_validacion ? `title="${esc(f.observacion_validacion)}"` : ''}>${texto}</span></td>
            <td>${origen}</td>
        </tr>`;
    }

    async function consultar(panel) {
        const tbody = panel.querySelector('#ag-val-tbody');
        tbody.innerHTML = `<tr><td colspan="12">${cargando('Cargando la bandeja…')}</td></tr>`;
        estado.seleccion.clear();

        // Si el usuario no eligió un estado concreto en los filtros del módulo,
        // esta pantalla asume PENDIENTE: es la bandeja de lo que falta revisar,
        // no un segundo listado del histórico completo.
        const filtros = Object.assign({}, AG.filtros);
        if (!filtros.estado_validacion) filtros.estado_validacion = 'PENDIENTE';

        const r = await Datos.listar({ filtros, pagina: 1, porPagina: estado.porPagina, orden: 'fecha_operacion', ascendente: true });
        estado.filas = r.filas;

        tbody.innerHTML = r.filas.length
            ? r.filas.map(filaHTML).join('')
            : `<tr><td colspan="12">${vacio('No hay movimientos por revisar con estos filtros', 'fa-clipboard-check')}</td></tr>`;

        panel.querySelector('#ag-val-pie').textContent = r.total > estado.porPagina
            ? `Mostrando los ${Core.numero(estado.porPagina)} más antiguos de ${Core.numero(r.total)}. Acota el rango de fechas para ver el resto.`
            : `${Core.numero(r.total)} movimiento(s) en la bandeja.`;

        AG.marcador('validacion', r.total ? Core.numero(r.total) : '', r.total ? 'bg-warning text-dark' : 'bg-secondary');
        actualizarSeleccion(panel);
    }

    function actualizarSeleccion(panel) {
        const n = estado.seleccion.size;
        panel.querySelector('#ag-val-conteo').textContent =
            n ? `${Core.numero(n)} seleccionado(s)` : 'Nada seleccionado';
        const puede = AG.puedeValidar();
        ['#ag-val-validar', '#ag-val-observar', '#ag-val-pendiente'].forEach((sel) => {
            panel.querySelector(sel).disabled = !n || !puede;
        });
        const cab = panel.querySelector('#ag-val-cab-check');
        if (cab) {
            cab.checked = n > 0 && n === estado.filas.length;
            cab.indeterminate = n > 0 && n < estado.filas.length;
        }
    }

    async function cambiarEstado(panel, nuevoEstado) {
        if (!estado.seleccion.size) return;
        if (!AG.puedeValidar()) { aviso('No tienes permiso para validar en este módulo.', 'warning'); return; }

        let comentario = null;
        if (nuevoEstado === 'OBSERVADO') {
            comentario = root.prompt(
                `Observar ${estado.seleccion.size} movimiento(s).\n\n` +
                'Escribe qué hay que corregir. Este texto es lo que verá quien los revise:'
            );
            if (comentario === null) return;
            if (!comentario.trim()) { aviso('Observar un registro exige decir qué corregir.', 'warning'); return; }
        }

        const ids = Array.from(estado.seleccion);
        try {
            const afectados = await Datos.validar(ids, nuevoEstado, comentario ? comentario.trim() : null);
            aviso(`${Core.numero(afectados)} movimiento(s) marcados como ${nuevoEstado.toLowerCase()}.`, 'success');
            await consultar(panel);
            AG.emit('datos:cambiaron');
        } catch (error) {
            aviso(error.message, 'error');
        }
    }

    async function enlazar(panel) {
        const boton = panel.querySelector('#ag-val-enlazar');
        const caja = panel.querySelector('#ag-val-enlace-resultado');
        const ventana = Number(panel.querySelector('#ag-val-ventana').value) || 3;
        const f = AG.filtros;

        boton.disabled = true;
        caja.innerHTML = '<div class="small text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Buscando parejas…</div>';
        try {
            const r = await Datos.enlazarRotaciones(f.fecha_desde || null, f.fecha_hasta || null, ventana);
            caja.innerHTML = `
                <div class="alert alert-info py-2 small mb-0">
                    <strong>${Core.numero(r.movimientos_enlazados)}</strong> movimiento(s) enlazados.
                    ${r.grupos_ambiguos
                        ? `<strong>${Core.numero(r.grupos_ambiguos)}</strong> grupo(s) quedaron sin enlazar por ser ambiguos
                           (más de una llegada o más de una salida con el mismo folio y matrícula). Ésos hay que revisarlos a mano.`
                        : 'No quedaron grupos ambiguos.'}
                </div>`;
            AG.emit('datos:cambiaron');
        } catch (error) {
            caja.innerHTML = `<div class="alert alert-danger py-2 small mb-0">${esc(error.message)}</div>`;
        } finally {
            boton.disabled = false;
        }
    }

    async function buscarDuplicados(panel) {
        const boton = panel.querySelector('#ag-val-duplicados');
        const caja = panel.querySelector('#ag-val-duplicados-resultado');
        boton.disabled = true;
        caja.innerHTML = cargando('Comparando llaves naturales…');
        try {
            const grupos = await Datos.duplicados(AG.filtros);
            if (!grupos.length) {
                caja.innerHTML = `<div class="alert alert-success py-2 small mb-0">
                    <i class="fas fa-check me-1"></i>Ningún movimiento repetido con estos filtros.</div>`;
                return;
            }
            const conDiscrepancia = grupos.filter((g) => g.discrepan).length;
            caja.innerHTML = `
                <div class="alert alert-warning py-2 small mb-2">
                    <strong>${Core.numero(grupos.length)}</strong> grupo(s) repetidos.
                    ${conDiscrepancia
                        ? `<strong>${Core.numero(conDiscrepancia)}</strong> con datos que
                           <em>no coinciden</em> entre copias: ésos hay que abrirlos y decidir cuál vale.`
                        : 'Todas las copias coinciden en sus datos.'}
                </div>
                <div class="ag-tabla-wrap" style="max-height:280px">
                    <table class="table table-sm ag-tabla mb-0">
                        <thead><tr>
                            <th>Fecha</th><th>Folio</th><th>Mov.</th><th>Matrícula</th>
                            <th>Operador</th><th class="ag-num">Copias</th><th>Estado</th><th>IDs</th>
                        </tr></thead>
                        <tbody>${grupos.map((g) => `
                            <tr>
                                <td>${esc(Core.fechaLarga(g.fecha_operacion))}</td>
                                <td class="ag-num">${esc(g.folio_rotacion)}</td>
                                <td>${esc(g.tipo_operacion === 'LLEGADA' ? 'Llegada' : 'Salida')}</td>
                                <td class="ag-mono">${esc(g.matricula)}</td>
                                <td class="text-truncate" style="max-width:180px" title="${esc(g.operador || '')}">${esc(g.operador || '—')}</td>
                                <td class="ag-num">${esc(g.veces)}</td>
                                <td>${g.discrepan
                                    ? '<span class="ag-badge ag-badge--obs">Discrepan</span>'
                                    : '<span class="ag-badge ag-badge--nal">Idénticas</span>'}</td>
                                <td>${(g.ids || []).map((id) => `
                                    <button class="btn btn-link btn-sm p-0 px-1 align-baseline"
                                            data-ag-dup-id="${id}" title="Ver el historial del movimiento ${id}">#${id}</button>`).join('')}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (error) {
            caja.innerHTML = `<div class="alert alert-danger py-2 small mb-0">${esc(error.message)}</div>`;
        } finally {
            boton.disabled = false;
        }
    }

    AG.registrarVista({
        id: 'validacion',
        etiqueta: 'Validación',
        icono: 'fa-clipboard-check',
        orden: 50,

        async montar(panel) {
            panel.innerHTML = plantilla();

            if (!AG.puedeValidar()) {
                panel.querySelector('#ag-val-sin-permiso').classList.remove('d-none');
                panel.querySelector('#ag-val-herramientas').classList.add('d-none');
            }

            panel.querySelector('#ag-val-tabla').addEventListener('change', (e) => {
                if (e.target.id === 'ag-val-cab-check') {
                    if (e.target.checked) estado.filas.forEach((f) => estado.seleccion.add(f.id));
                    else estado.seleccion.clear();
                    panel.querySelectorAll('.ag-val-check').forEach((c) => { c.checked = e.target.checked; });
                    actualizarSeleccion(panel);
                    return;
                }
                if (e.target.classList.contains('ag-val-check')) {
                    const id = Number(e.target.dataset.id);
                    if (e.target.checked) estado.seleccion.add(id); else estado.seleccion.delete(id);
                    actualizarSeleccion(panel);
                }
            });

            panel.querySelector('#ag-val-todos').addEventListener('click', () => {
                estado.filas.forEach((f) => estado.seleccion.add(f.id));
                panel.querySelectorAll('.ag-val-check').forEach((c) => { c.checked = true; });
                actualizarSeleccion(panel);
            });
            panel.querySelector('#ag-val-ninguno').addEventListener('click', () => {
                estado.seleccion.clear();
                panel.querySelectorAll('.ag-val-check').forEach((c) => { c.checked = false; });
                actualizarSeleccion(panel);
            });

            panel.querySelector('#ag-val-validar').addEventListener('click', () => cambiarEstado(panel, 'VALIDADO'));
            panel.querySelector('#ag-val-observar').addEventListener('click', () => cambiarEstado(panel, 'OBSERVADO'));
            panel.querySelector('#ag-val-pendiente').addEventListener('click', () => cambiarEstado(panel, 'PENDIENTE'));
            panel.querySelector('#ag-val-enlazar').addEventListener('click', () => enlazar(panel));
            panel.querySelector('#ag-val-duplicados').addEventListener('click', () => buscarDuplicados(panel));

            // Los #id de la tabla de repetidos abren el historial de ese
            // movimiento, que es donde se ve qué se capturó y cuándo.
            panel.querySelector('#ag-val-duplicados-resultado').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-ag-dup-id]');
                if (btn) AG.emit('movimiento:historial', { id: Number(btn.dataset.agDupId) });
            });
        },

        async refrescar(panel) { await consultar(panel); }
    });
})(typeof window !== 'undefined' ? window : globalThis);
