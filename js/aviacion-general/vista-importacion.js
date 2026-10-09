/* Pantalla "Importación" del módulo de Aviación General / FBO.
 *
 * Sube el Layout del sistema FBO (la misma estructura que docs/fbo/Lay-out.xlsx,
 * sin importar el nombre del archivo) a public.operaciones_fbo.
 *
 * NADA SE SUBE A CIEGAS
 *
 *   1. Archivo     — se lee en el navegador con SheetJS; el archivo no sale de
 *                    aquí. La lectura y el mapeo son de layout-fbo.js (puro,
 *                    probado con el propio Lay-out.xlsx).
 *   2. Validación  — por fila: errores que la bloquean y advertencias que no.
 *                    Se puede descargar en CSV.
 *   3. Vista previa — cuántas son nuevas, cuántas ya existen (por registro) y
 *                    cuáles reemplazan una operación guardada con otro registro
 *                    (misma matrícula + fecha de aterrizaje; si coinciden
 *                    varias, la fila se bloquea por ambigua).
 *   4. Confirmar   — fbo_importar_operaciones (064b), en bloques de 500; cada
 *                    bloque es una transacción: reemplaza y nunca duplica.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-importacion: falta panel.js'); return; }
    const Layout = root.AviacionGeneralLayoutFbo;
    if (!Layout) { console.error('[Aviación General] vista-importacion: falta layout-fbo.js'); return; }

    const { Core, Datos, esc, aviso, vacio } = AG;

    const PREVIA = 25;        // filas transformadas que se muestran
    const MAX_INCIDENCIAS = 300;
    const EXTENSIONES = /\.(xlsx|xls)$/i;

    /**
     * @typedef {Object} FilaPreparada
     * @property {import('./layout-fbo').FilaLayout} fila
     * @property {'NUEVA'|'REEMPLAZA'|'BLOQUEADA'} estado
     * @property {string|null} reemplazaRegistro  Operación guardada con otro registro que sustituye.
     * @property {boolean}     existe             Su mismo registro ya está guardado.
     */

    const estado = {
        nombreArchivo: '',
        resultado: null,
        /** @type {FilaPreparada[]} */
        preparadas: [],
        incidencias: [],
        previaError: null,
        importando: false,
        importado: false
    };

    function plantilla() {
        return `
        <div class="row g-3">
            <div class="col-12 col-lg-5">
                <div class="ag-card">
                    <h6>1 · Archivo</h6>
                    <div class="ag-dropzone" id="ag-imp-zona" tabindex="0" role="button"
                         aria-label="Seleccionar el Layout de Excel">
                        <i class="fas fa-file-excel"></i>
                        <div class="fw-bold mt-2">Arrastra el Layout aquí</div>
                        <div class="small text-muted">o haz clic para buscarlo · .xlsx o .xls</div>
                    </div>
                    <input type="file" id="ag-imp-archivo" accept=".xlsx,.xls" hidden>
                    <div id="ag-imp-info" class="mt-3"></div>
                </div>
            </div>

            <div class="col-12 col-lg-7">
                <div class="ag-card">
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                        <h6 class="mb-0">2 · Validación</h6>
                        <button class="btn btn-sm btn-outline-secondary d-none" id="ag-imp-csv">
                            <i class="fas fa-file-csv me-1"></i>Descargar reporte CSV
                        </button>
                    </div>
                    <div id="ag-imp-validacion">${vacio('Elige un archivo para empezar', 'fa-file-circle-question')}</div>
                </div>
            </div>

            <div class="col-12">
                <div class="ag-card">
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                        <h6 class="mb-0">3 · Vista previa</h6>
                        <button class="btn btn-sm btn-info text-white fw-semibold" id="ag-imp-confirmar" disabled>
                            <i class="fas fa-cloud-arrow-up me-1"></i>Confirmar importación
                        </button>
                    </div>
                    <div id="ag-imp-resumen-previa">${vacio('Sin filas que previsualizar', 'fa-table')}</div>
                    <div class="ag-tabla-wrap mt-2 d-none" id="ag-imp-previa-wrap">
                        <table class="table table-sm ag-tabla mb-0">
                            <thead id="ag-imp-previa-head"></thead>
                            <tbody id="ag-imp-previa-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="col-12">
                <div class="ag-card">
                    <h6>4 · Resultado</h6>
                    <div id="ag-imp-resultado">${vacio('Todavía no se ha subido nada', 'fa-cloud-arrow-up')}</div>
                    <div class="progress mt-2 d-none" id="ag-imp-progreso" style="height:.55rem">
                        <div class="progress-bar bg-info" role="progressbar" style="width:0%"></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    const $id = (id) => document.getElementById(id);

    // ── 1 · Leer el archivo ─────────────────────────────────────────────────

    async function leerArchivo(archivo) {
        if (estado.importando) return;
        if (typeof root.XLSX === 'undefined') {
            aviso('No se pudo cargar la librería de Excel. Revisa tu conexión.', 'error');
            return;
        }
        const info = $id('ag-imp-info');
        if (!EXTENSIONES.test(archivo.name || '')) {
            info.innerHTML = `<div class="alert alert-danger py-2 small mb-0">Formato no válido: elige un archivo .xlsx o .xls.</div>`;
            return;
        }
        info.innerHTML = '<div class="small text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Leyendo el archivo…</div>';
        reiniciar();

        try {
            const buffer = await archivo.arrayBuffer();
            // Sin cellDates: las fechas llegan como número de serie de Excel y
            // layout-fbo.js las convierte sin pasar por Date ni por UTC.
            const libro = root.XLSX.read(buffer, { type: 'array', cellDates: false });
            estado.nombreArchivo = archivo.name;
            estado.resultado = Layout.parsearLayout(Layout.hojasDesdeLibro(libro, root.XLSX));
        } catch (error) {
            console.error('[Aviación General] lectura del Layout', error);
            info.innerHTML = `<div class="alert alert-danger py-2 small mb-0">No se pudo leer el archivo: ${esc(error.message)}</div>`;
            return;
        }

        pintarInfo(archivo);
        if (estado.resultado.error) {
            pintarValidacion();
            pintarPrevia();
            return;
        }
        await prepararContraBase();
        pintarValidacion();
        pintarPrevia();
    }

    function reiniciar() {
        estado.resultado = null;
        estado.preparadas = [];
        estado.incidencias = [];
        estado.previaError = null;
        estado.importado = false;
        const resultado = $id('ag-imp-resultado');
        if (resultado) resultado.innerHTML = vacio('Todavía no se ha subido nada', 'fa-cloud-arrow-up');
    }

    function pintarInfo(archivo) {
        const r = estado.resultado;
        const faltantes = r.columnasFaltantes.length ? `
            <div class="alert alert-warning py-2 small mt-2 mb-0">
                <div class="fw-bold">Columnas que no vienen en el archivo (se leen vacías):</div>
                <div>${r.columnasFaltantes.map(esc).join(', ')}</div>
            </div>` : '';
        $id('ag-imp-info').innerHTML = r.error
            ? `<div class="alert alert-danger py-2 small mb-0">${esc(r.error)}</div>`
            : `<div class="small">
                   <div class="fw-bold text-truncate" title="${esc(archivo.name)}">
                       <i class="fas fa-file-excel text-success me-1"></i>${esc(archivo.name)}
                   </div>
                   <div class="text-muted">${(archivo.size / 1024).toFixed(0)} KB · hoja <strong>${esc(r.hoja)}</strong> ·
                       encabezados en la fila ${esc(r.filaEncabezado)} · ${Core.numero(r.filas.length)} filas</div>
               </div>${faltantes}`;
    }

    // ── 3 · Contra lo que ya está guardado ──────────────────────────────────

    async function prepararContraBase() {
        const filas = estado.resultado.filas;
        const validas = filas.filter((f) => !f.errores.length);
        estado.incidencias = Layout.incidencias(filas);

        /** @type {Map<string, {existe: boolean, reemplazaRegistro: string|null, error: string|null}>} */
        let clasif = new Map();
        try {
            const previa = await Datos.previaImportacion(validas.map((f) => ({
                registro: f.registro,
                matricula: f.operacion.matricula,
                fecha_aterrizaje: f.operacion.fecha_aterrizaje
            })));
            clasif = new Map(Layout.clasificarContraBase(validas.map((f) => f.registro), previa)
                .map((c) => [c.registro, c]));
        } catch (error) {
            console.error('[Aviación General] vista previa', error);
            estado.previaError = error.message || String(error);
        }

        estado.preparadas = filas.map((fila) => {
            if (fila.errores.length) return { fila, estado: 'BLOQUEADA', reemplazaRegistro: null, existe: false };
            const c = clasif.get(fila.registro) || { existe: false, reemplazaRegistro: null, error: null };
            if (c.error) {
                estado.incidencias.push({
                    filaExcel: fila.filaExcel, registro: fila.registro, tipo: 'ERROR',
                    campo: 'Matrícula / Aterrizaje', motivo: c.error
                });
                return { fila, estado: 'BLOQUEADA', reemplazaRegistro: null, existe: c.existe };
            }
            if (c.reemplazaRegistro) {
                estado.incidencias.push({
                    filaExcel: fila.filaExcel, registro: fila.registro, tipo: 'ADVERTENCIA',
                    campo: 'Matrícula / Aterrizaje',
                    motivo: `Reemplaza la operación guardada ${c.reemplazaRegistro} (misma matrícula y fecha de aterrizaje)`
                });
            }
            return {
                fila,
                estado: c.existe || c.reemplazaRegistro ? 'REEMPLAZA' : 'NUEVA',
                reemplazaRegistro: c.reemplazaRegistro,
                existe: c.existe
            };
        });
    }

    const importables = () => estado.preparadas.filter((p) => p.estado !== 'BLOQUEADA');

    // ── 2 · Reporte de validación ───────────────────────────────────────────

    function pintarValidacion() {
        const caja = $id('ag-imp-validacion');
        const boton = $id('ag-imp-csv');
        const r = estado.resultado;
        if (!r || r.error) {
            caja.innerHTML = vacio(r && r.error ? 'El archivo no tiene la estructura del Layout' : 'Elige un archivo para empezar',
                'fa-file-circle-question');
            boton.classList.add('d-none');
            return;
        }

        const errores = estado.incidencias.filter((i) => i.tipo === 'ERROR');
        const advertencias = estado.incidencias.filter((i) => i.tipo === 'ADVERTENCIA');
        const bloqueadas = estado.preparadas.filter((p) => p.estado === 'BLOQUEADA').length;
        boton.classList.toggle('d-none', !estado.incidencias.length);

        const ordenadas = estado.incidencias.slice()
            .sort((a, b) => a.filaExcel - b.filaExcel || (a.tipo === b.tipo ? 0 : a.tipo === 'ERROR' ? -1 : 1));

        caja.innerHTML = `
            <div class="d-flex flex-wrap gap-3 small mb-2">
                <span class="text-danger"><strong>${Core.numero(errores.length)}</strong> errores
                    (${Core.numero(bloqueadas)} filas bloqueadas)</span>
                <span class="text-warning-emphasis"><strong>${Core.numero(advertencias.length)}</strong> advertencias</span>
            </div>
            ${ordenadas.length ? `
                <div class="ag-tabla-wrap" style="max-height:260px">
                    <table class="table table-sm ag-tabla mb-0">
                        <thead><tr><th class="ag-num">Fila</th><th>Registro</th><th>Tipo</th><th>Campo</th><th>Motivo</th></tr></thead>
                        <tbody>${ordenadas.slice(0, MAX_INCIDENCIAS).map((i) => `
                            <tr class="${i.tipo === 'ERROR' ? 'table-danger' : ''}">
                                <td class="ag-num">${esc(i.filaExcel)}</td>
                                <td class="ag-mono">${esc(i.registro || '—')}</td>
                                <td>${i.tipo === 'ERROR'
                                    ? '<span class="ag-badge ag-badge--obs">Error</span>'
                                    : '<span class="ag-badge ag-badge--pend">Advertencia</span>'}</td>
                                <td>${esc(i.campo)}</td>
                                <td>${esc(i.motivo)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                ${ordenadas.length > MAX_INCIDENCIAS
                    ? `<div class="small text-muted mt-1">Se muestran ${MAX_INCIDENCIAS} de ${Core.numero(ordenadas.length)}; el CSV las trae todas.</div>`
                    : ''}`
                : '<div class="small text-success"><i class="fas fa-check me-1"></i>Sin errores ni advertencias.</div>'}`;
    }

    function descargarCsv() {
        if (!estado.incidencias.length) return;
        // BOM para que Excel abra el CSV en UTF-8 y respete los acentos.
        const blob = new Blob(['\uFEFF' + Layout.reporteCsv(estado.incidencias)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `validacion_${estado.nombreArchivo.replace(/\.[^.]+$/, '')}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ── 3 · Vista previa ────────────────────────────────────────────────────

    function instante(fecha, hora) {
        if (!fecha) return '—';
        return `${Core.fechaLarga(fecha)}${hora ? ` ${Core.horaCorta(hora)}` : ''}`;
    }

    function insigniaEstado(p) {
        if (p.estado === 'BLOQUEADA') {
            return '<span class="ag-badge ag-badge--obs"><i class="fas fa-xmark me-1"></i>Bloqueada</span>';
        }
        if (p.estado === 'REEMPLAZA') {
            const que = p.reemplazaRegistro ? `Reemplaza ${p.reemplazaRegistro}` : 'Reemplaza (ya existe)';
            return `<span class="ag-badge ag-badge--pend" title="${esc(que)}"><i class="fas fa-rotate me-1"></i>${esc(que)}</span>`;
        }
        return '<span class="ag-badge ag-badge--val"><i class="fas fa-plus me-1"></i>Nueva</span>';
    }

    function pintarPrevia() {
        const resumen = $id('ag-imp-resumen-previa');
        const wrap = $id('ag-imp-previa-wrap');
        const boton = $id('ag-imp-confirmar');

        if (!estado.preparadas.length) {
            resumen.innerHTML = vacio('Sin filas que previsualizar', 'fa-table');
            wrap.classList.add('d-none');
            boton.disabled = true;
            return;
        }

        const total = estado.preparadas.length;
        const nuevas = estado.preparadas.filter((p) => p.estado === 'NUEVA').length;
        const existentes = estado.preparadas.filter((p) => p.estado === 'REEMPLAZA' && p.existe).length;
        const porCoincidencia = estado.preparadas.filter((p) => p.reemplazaRegistro).length;
        const bloqueadas = estado.preparadas.filter((p) => p.estado === 'BLOQUEADA').length;
        const listas = importables().length;

        resumen.innerHTML = `
            <div class="d-flex flex-wrap gap-3 small">
                <span><strong>${Core.numero(total)}</strong> filas</span>
                <span class="text-success"><strong>${Core.numero(nuevas)}</strong> nuevas</span>
                <span class="text-warning-emphasis"><strong>${Core.numero(existentes)}</strong> ya existen (se reemplazan)</span>
                <span class="text-warning-emphasis"><strong>${Core.numero(porCoincidencia)}</strong>
                    reemplazan una operación guardada con otro registro</span>
                <span class="text-danger"><strong>${Core.numero(bloqueadas)}</strong> bloqueadas</span>
            </div>
            ${estado.previaError ? `
                <div class="alert alert-danger py-2 small mt-2 mb-0">
                    <div class="fw-bold">No se pudo comparar contra lo ya guardado</div>
                    <div>${esc(estado.previaError)}</div>
                    <div class="mt-1">Sin esa comparación no se importa: podría duplicar operaciones.</div>
                </div>` : ''}
            ${estado.importado ? `
                <div class="alert alert-info py-2 small mt-2 mb-0">
                    Este archivo ya se importó. Vuelve a cargarlo para revisar y reimportar.
                </div>` : ''}`;

        boton.disabled = !listas || !!estado.previaError || estado.importado || estado.importando || !AG.puedeCapturar();
        boton.innerHTML = `<i class="fas fa-cloud-arrow-up me-1"></i>Confirmar importación (${Core.numero(listas)})`;

        const columnas = ['Fila', 'Registro', 'Matrícula', 'Operador', 'Prestador', 'Aeronave', 'Ala',
                          'Origen', 'Llegada', 'Ámb.', 'Pax', 'Destino', 'Salida', 'Ámb.', 'Pax',
                          'Perm. (min)', 'MTOW', 'Estado'];
        $id('ag-imp-previa-head').innerHTML = `<tr>${columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;

        $id('ag-imp-previa-body').innerHTML = estado.preparadas.slice(0, PREVIA).map((p) => {
            const o = p.fila.operacion;
            return `<tr class="${p.estado === 'BLOQUEADA' ? 'table-danger' : ''}">
                <td class="ag-num text-muted">${esc(p.fila.filaExcel)}</td>
                <td class="ag-mono">${esc(o.registro || '—')}</td>
                <td class="ag-mono">${esc(o.matricula || '—')}</td>
                <td class="text-truncate" style="max-width:180px" title="${esc(o.operador || '')}">${esc(o.operador || '—')}</td>
                <td>${esc(o.vuelo_operado_por || '—')}</td>
                <td>${esc(o.tipo_aeronave || '—')}</td>
                <td>${esc(o.tipo_ala || '—')}</td>
                <td class="ag-mono">${esc(o.origen || '—')}</td>
                <td class="text-nowrap">${esc(instante(o.fecha_aterrizaje, o.hora_aterrizaje))}</td>
                <td>${esc(o.nac_int_llegada || '—')}</td>
                <td class="ag-num">${esc(o.pax_llegada_totales)}</td>
                <td class="ag-mono">${esc(o.destino || '—')}</td>
                <td class="text-nowrap">${esc(instante(o.fecha_salida_posicion, o.hora_salida_posicion))}</td>
                <td>${esc(o.nac_int_salida || '—')}</td>
                <td class="ag-num">${esc(o.pax_salida_totales)}</td>
                <td class="ag-num">${esc(o.tiempo_permanencia_min ?? '—')}</td>
                <td class="ag-num">${esc(o.mtow ?? '—')}</td>
                <td>${insigniaEstado(p)}</td>
            </tr>`;
        }).join('') + (total > PREVIA
            ? `<tr><td colspan="${columnas.length}" class="text-center text-muted small py-2">
                   … y ${Core.numero(total - PREVIA)} filas más
               </td></tr>`
            : '');

        wrap.classList.remove('d-none');
    }

    // ── 4 · Importar ────────────────────────────────────────────────────────

    async function importar() {
        if (estado.importando || estado.importado || estado.previaError) return;
        if (!AG.puedeCapturar()) { aviso('No tienes permiso para importar en este módulo.', 'warning'); return; }
        const lista = importables();
        if (!lista.length) return;

        const bloqueadas = estado.preparadas.length - lista.length;
        const ok = root.confirm(
            `Se van a guardar ${lista.length} operaciones de "${estado.nombreArchivo}".\n\n` +
            'Las que ya existen (mismo registro) y las que reemplazan una operación guardada con otro ' +
            'registro se sustituyen; las nuevas se insertan.' +
            (bloqueadas ? `\n${bloqueadas} fila(s) bloqueada(s) NO se importan.` : '') +
            '\n\n¿Continuar?'
        );
        if (!ok) return;

        estado.importando = true;
        pintarPrevia();
        const barra = $id('ag-imp-progreso');
        const relleno = barra.querySelector('.progress-bar');
        barra.classList.remove('d-none');
        relleno.style.width = '0%';
        const caja = $id('ag-imp-resultado');
        caja.innerHTML = `<div class="small text-muted">
            <span class="spinner-border spinner-border-sm me-1"></span>Importando…</div>`;

        try {
            const r = await Datos.importarOperaciones({
                filas: lista.map((p) => Layout.aPayload(p.fila.operacion, p.reemplazaRegistro)),
                onProgreso: ({ acumulado }) => {
                    relleno.style.width = `${Math.round((acumulado / lista.length) * 100)}%`;
                }
            });
            estado.importado = true;
            pintarResultado(r, bloqueadas, null);
            aviso(`Importación terminada: ${r.insertados} nuevas, ${r.reemplazados + r.reemplazados_por_coincidencia} reemplazadas.`, 'success');
        } catch (error) {
            console.error('[Aviación General] importación', error);
            pintarResultado(error.parcial || null, bloqueadas, error);
            if (error.parcial && error.parcial.bloquesGuardados) estado.importado = true;
        } finally {
            estado.importando = false;
            setTimeout(() => barra.classList.add('d-none'), 900);
            pintarPrevia();
            // Resumen y Movimientos quedan viejos: se recargan al abrirlos.
            AG.emit('datos:cambiaron');
            AG.invalidar();
            AG.recargarOpciones();
        }
    }

    function pintarResultado(r, bloqueadas, error) {
        const caja = $id('ag-imp-resultado');
        const cifras = r ? `
            <div class="d-flex flex-wrap gap-3 small mt-1">
                <span class="text-success"><strong>${Core.numero(r.insertados)}</strong> insertadas</span>
                <span class="text-warning-emphasis"><strong>${Core.numero(r.reemplazados)}</strong> reemplazadas (mismo registro)</span>
                <span class="text-warning-emphasis"><strong>${Core.numero(r.reemplazados_por_coincidencia)}</strong>
                    reemplazadas (otro registro, misma matrícula y fecha)</span>
                <span class="text-danger"><strong>${Core.numero(bloqueadas)}</strong> omitidas por error</span>
            </div>` : '';

        if (error) {
            caja.innerHTML = `<div class="alert alert-danger py-2 small mb-0">
                <div class="fw-bold">No se pudo completar la importación</div>
                <div>${esc(error.message)}</div>
                ${r && r.bloquesGuardados
                    ? `<div class="mt-1">Se guardaron completos ${r.bloquesGuardados} de ${r.bloques} bloques; el bloque que falló no dejó nada a medias.
                           Al volver a importar el archivo, lo ya guardado se reemplaza: no se duplica.</div>${cifras}`
                    : '<div class="mt-1">No se guardó nada. Corrige la causa y vuelve a intentarlo.</div>'}
            </div>`;
            return;
        }
        caja.innerHTML = `
            <div class="alert alert-success py-2 mb-0">
                <div class="fw-bold"><i class="fas fa-circle-check me-1"></i>Importación completada</div>
                ${cifras}
            </div>`;
    }

    AG.registrarVista({
        id: 'importacion',
        etiqueta: 'Importación',
        icono: 'fa-file-import',
        orden: 40,
        visible: () => AG.puedeCapturar(),

        async montar(panel) {
            panel.innerHTML = plantilla();

            const zona = panel.querySelector('#ag-imp-zona');
            const entrada = panel.querySelector('#ag-imp-archivo');

            zona.addEventListener('click', () => entrada.click());
            zona.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); }
            });
            ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => {
                e.preventDefault(); zona.classList.add('ag-drag');
            }));
            ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => {
                e.preventDefault(); zona.classList.remove('ag-drag');
            }));
            zona.addEventListener('drop', (e) => {
                const archivo = e.dataTransfer?.files?.[0];
                if (archivo) leerArchivo(archivo);
            });
            entrada.addEventListener('change', (e) => {
                const archivo = e.target.files?.[0];
                // Se limpia para que volver a elegir el MISMO archivo dispare change.
                e.target.value = '';
                if (archivo) leerArchivo(archivo);
            });
            panel.querySelector('#ag-imp-csv').addEventListener('click', descargarCsv);
            panel.querySelector('#ag-imp-confirmar').addEventListener('click', importar);
        },

        async refrescar() { /* no depende de los filtros del módulo */ }
    });

    root.AviacionGeneralImportacion = { get estado() { return estado; } };
})(typeof window !== 'undefined' ? window : globalThis);
