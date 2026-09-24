/* Pantalla "Importación" del módulo de Aviación General / FBO.
 *
 * Sube el histórico del Excel original a la base. Es la vía por la que entran
 * los registros que hoy tiene el archivo y la tabla todavía no.
 *
 * EL PRINCIPIO QUE ORDENA ESTA PANTALLA: NADA SE SUBE A CIEGAS
 *
 *   Una importación que "salió bien" y dejó 40 renglones fuera sin decirlo es
 *   una bomba de tiempo: el faltante se descubre meses después, cuadrando
 *   cifras contra un oficio, y para entonces ya nadie sabe qué archivo se
 *   subió. Por eso el flujo son cuatro pasos y ninguno se puede saltar:
 *
 *     1. Leer      — se abre el archivo en el navegador, sin mandar nada.
 *     2. Mapear    — se enseña qué columna del Excel cayó en qué campo, cuáles
 *                    no se reconocieron y cuáles se ignoran a propósito.
 *     3. Ensayar   — se manda a la base en modo simulación: valida y detecta
 *                    duplicados SIN escribir una sola fila.
 *     4. Confirmar — hasta aquí no se ha insertado nada.
 *
 *   Al final se puede descargar el detalle de lo rechazado, con su número de
 *   fila del Excel, para corregir el archivo y volver a subirlo.
 *
 * El archivo NUNCA sale del navegador: se lee con SheetJS del lado del cliente
 * y a la base sólo viajan las filas ya normalizadas.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-importacion: falta panel.js'); return; }

    const { Core, Datos, esc, aviso, vacio } = AG;

    const PREVIA = 25;   // renglones que se muestran en la vista previa

    const estado = {
        libro: null,
        nombreArchivo: '',
        hoja: '',
        encabezados: [],
        deteccion: null,
        preparadas: [],   // { movimiento, errores, avisos, filaExcel }
        validas: [],
        invalidas: [],
        ensayo: null,
        importando: false
    };

    function plantilla() {
        return `
        <div class="row g-3">
            <div class="col-12 col-lg-5">
                <div class="ag-card">
                    <h6>1 · Archivo</h6>
                    <div class="ag-dropzone" id="ag-imp-zona" tabindex="0" role="button"
                         aria-label="Seleccionar archivo de Excel">
                        <i class="fas fa-file-excel"></i>
                        <div class="fw-bold mt-2">Arrastra el Excel aquí</div>
                        <div class="small text-muted">o haz clic para buscarlo · .xlsx, .xls, .csv</div>
                    </div>
                    <input type="file" id="ag-imp-archivo" accept=".xlsx,.xls,.csv" hidden>

                    <div id="ag-imp-hojas" class="mt-3 d-none">
                        <label class="form-label small fw-bold" for="ag-imp-hoja">Hoja</label>
                        <select class="form-select form-select-sm" id="ag-imp-hoja"></select>
                    </div>

                    <div id="ag-imp-info" class="mt-3"></div>
                </div>
            </div>

            <div class="col-12 col-lg-7">
                <div class="ag-card">
                    <h6>2 · Columnas reconocidas</h6>
                    <div id="ag-imp-mapeo">${vacio('Elige un archivo para empezar', 'fa-file-circle-question')}</div>
                </div>
            </div>

            <div class="col-12">
                <div class="ag-card">
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                        <h6 class="mb-0">3 · Vista previa</h6>
                        <div class="d-flex gap-2" id="ag-imp-acciones-previa"></div>
                    </div>
                    <div id="ag-imp-resumen-previa"></div>
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

    // ── Paso 1: leer el archivo ─────────────────────────────────────────────

    async function leerArchivo(archivo) {
        if (typeof root.XLSX === 'undefined') {
            aviso('No se pudo cargar la librería de Excel. Revisa tu conexión.', 'error');
            return;
        }
        const info = document.getElementById('ag-imp-info');
        info.innerHTML = '<div class="small text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Leyendo el archivo…</div>';

        try {
            const buffer = await archivo.arrayBuffer();
            // cellDates: las fechas llegan como Date en vez de número de serie,
            // que es una fuente clásica de "todo se importó con fecha de 1900".
            estado.libro = root.XLSX.read(buffer, { cellDates: true, cellNF: false, cellText: false });
            estado.nombreArchivo = archivo.name;

            const selector = document.getElementById('ag-imp-hoja');
            selector.innerHTML = estado.libro.SheetNames
                .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
            document.getElementById('ag-imp-hojas').classList.toggle('d-none', estado.libro.SheetNames.length <= 1);

            info.innerHTML = `
                <div class="small">
                    <div class="fw-bold text-truncate" title="${esc(archivo.name)}">
                        <i class="fas fa-file-excel text-success me-1"></i>${esc(archivo.name)}
                    </div>
                    <div class="text-muted">${(archivo.size / 1024).toFixed(0)} KB ·
                        ${estado.libro.SheetNames.length} hoja(s)</div>
                </div>`;

            procesarHoja(estado.libro.SheetNames[0]);
        } catch (error) {
            console.error('[Aviación General] lectura de Excel', error);
            info.innerHTML = `<div class="alert alert-danger py-2 small mb-0">No se pudo leer el archivo: ${esc(error.message)}</div>`;
        }
    }

    // ── Paso 2: mapear columnas y normalizar ────────────────────────────────

    function procesarHoja(nombreHoja) {
        estado.hoja = nombreHoja;
        const hoja = estado.libro.Sheets[nombreHoja];

        // defval:'' evita que las celdas vacías desaparezcan del objeto, lo que
        // desalinearía el mapeo. raw:false deja que SheetJS aplique el formato
        // de la celda, que es lo que hace legibles las horas.
        const filas = root.XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false, cellDates: true });
        estado.encabezados = filas.length ? Object.keys(filas[0]) : [];
        estado.deteccion = Core.detectarColumnas(estado.encabezados);

        pintarMapeo();

        if (estado.deteccion.faltantes.length) {
            estado.preparadas = [];
            pintarPrevia();
            return;
        }

        // La fila del Excel = índice + 2 (una por el encabezado, una porque
        // Excel cuenta desde 1). Ese número es el que le sirve a quien va a ir
        // a corregir el archivo.
        estado.preparadas = filas.map((cruda, i) => {
            const r = Core.normalizarFilaExcel(cruda, { mapa: estado.deteccion.mapa, filaOrigen: i + 2 });
            r.filaExcel = i + 2;
            return r;
        });

        estado.validas = estado.preparadas.filter((r) => !r.errores.length);
        estado.invalidas = estado.preparadas.filter((r) => r.errores.length);
        estado.ensayo = null;

        pintarPrevia();
    }

    function pintarMapeo() {
        const caja = document.getElementById('ag-imp-mapeo');
        const d = estado.deteccion;
        if (!d) { caja.innerHTML = vacio('Elige un archivo para empezar', 'fa-file-circle-question'); return; }

        const etiquetas = {
            folio_rotacion: 'Folio de rotación (No.)', fecha_operacion: 'Fecha',
            tipo_operacion: 'Tipo de operación', ambito_operacion: 'Ámbito (nacional)',
            operador: 'Operador', matricula: 'Matrícula', tipo_aeronave: 'Tipo de aeronave',
            aeropuerto_origen_destino: 'Origen / destino', hora_programada: 'Hora programada',
            hora_real: 'Hora real', adultos: 'Adultos', infantes: 'Infantes',
            pax_od: 'Pax O.D.', estado: 'Estado', pais: 'País', observaciones: 'Observaciones'
        };

        const reconocidas = d.reconocidas.map((campo) => `
            <div class="ag-map-fila">
                <span class="text-success"><i class="fas fa-check me-1"></i>${esc(etiquetas[campo] || campo)}</span>
                <span class="text-muted font-monospace">${esc(d.mapa[campo])}</span>
            </div>`).join('');

        const faltantes = d.faltantes.length ? `
            <div class="alert alert-danger py-2 small mt-2 mb-0">
                <div class="fw-bold"><i class="fas fa-circle-exclamation me-1"></i>Faltan columnas obligatorias</div>
                <div>${d.faltantes.map((c) => esc(etiquetas[c] || c)).join(', ')}</div>
                <div class="mt-1">Sin ellas no se puede importar: revisa que la hoja elegida sea la correcta
                    y que los encabezados estén en la primera fila.</div>
            </div>` : '';

        const ignoradas = d.ignoradas.length ? `
            <div class="small text-muted mt-2">
                <i class="fas fa-eye-slash me-1"></i>Se ignoran a propósito:
                ${d.ignoradas.map((c) => `<span class="ag-chip-filtro">${esc(c.titulo)}</span>`).join(' ')}
                <div style="font-size:.7rem">PAX A.G. la calcula la base: capturarla provocaría un error.</div>
            </div>` : '';

        const desconocidas = d.desconocidas.length ? `
            <div class="small text-warning-emphasis mt-2">
                <i class="fas fa-circle-question me-1"></i>No se reconocieron (no se importan):
                ${d.desconocidas.map((c) => `<span class="ag-chip-filtro">${esc(c.titulo)}</span>`).join(' ')}
            </div>` : '';

        caja.innerHTML = `<div class="ag-mapeo">${reconocidas || '<div class="small text-muted">Ninguna columna reconocida.</div>'}</div>
                          ${faltantes}${ignoradas}${desconocidas}`;
    }

    // ── Paso 3: vista previa ────────────────────────────────────────────────

    function pintarPrevia() {
        const resumen = document.getElementById('ag-imp-resumen-previa');
        const wrap = document.getElementById('ag-imp-previa-wrap');
        const acciones = document.getElementById('ag-imp-acciones-previa');

        if (!estado.preparadas.length) {
            resumen.innerHTML = vacio('Sin filas que previsualizar', 'fa-table');
            wrap.classList.add('d-none');
            acciones.innerHTML = '';
            return;
        }

        const conAvisos = estado.preparadas.filter((r) => r.avisos.length).length;

        resumen.innerHTML = `
            <div class="d-flex flex-wrap gap-3 small">
                <span><strong>${Core.numero(estado.preparadas.length)}</strong> filas leídas</span>
                <span class="text-success"><strong>${Core.numero(estado.validas.length)}</strong> listas</span>
                <span class="text-danger"><strong>${Core.numero(estado.invalidas.length)}</strong> con errores</span>
                ${conAvisos ? `<span class="text-warning-emphasis"><strong>${Core.numero(conAvisos)}</strong> con avisos</span>` : ''}
            </div>
            ${estado.invalidas.length ? `
                <div class="alert alert-warning py-2 small mt-2 mb-0">
                    Las filas con errores <strong>no se importan</strong>. Puedes descargar el detalle,
                    corregir el archivo y volver a subirlo: lo que ya haya entrado no se duplica.
                </div>` : ''}`;

        acciones.innerHTML = `
            ${estado.invalidas.length ? `
                <button class="btn btn-sm btn-outline-danger" id="ag-imp-descargar-errores">
                    <i class="fas fa-file-arrow-down me-1"></i>Errores (${estado.invalidas.length})
                </button>` : ''}
            <button class="btn btn-sm btn-outline-info" id="ag-imp-ensayar" ${estado.validas.length ? '' : 'disabled'}>
                <i class="fas fa-flask me-1"></i>Ensayar sin guardar
            </button>
            <button class="btn btn-sm btn-info text-white fw-semibold" id="ag-imp-confirmar"
                    ${estado.validas.length && AG.puedeCapturar() ? '' : 'disabled'}>
                <i class="fas fa-cloud-arrow-up me-1"></i>Importar ${Core.numero(estado.validas.length)}
            </button>`;

        document.getElementById('ag-imp-ensayar')?.addEventListener('click', () => subir(true));
        document.getElementById('ag-imp-confirmar')?.addEventListener('click', () => subir(false));
        document.getElementById('ag-imp-descargar-errores')?.addEventListener('click', descargarErrores);

        const columnas = ['Fila', 'No.', 'Fecha', 'Mov.', 'Ámbito', 'Operador', 'Matrícula',
                          'Aeronave', 'O/D', 'Prog.', 'Real', 'Ad.', 'Inf.', 'Pax', 'Estado'];
        document.getElementById('ag-imp-previa-head').innerHTML =
            `<tr>${columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;

        // Primero lo que falla: si hay algo que revisar, es lo que hay que ver.
        const orden = [...estado.invalidas, ...estado.validas].slice(0, PREVIA);
        document.getElementById('ag-imp-previa-body').innerHTML = orden.map((r) => {
            const m = r.movimiento;
            const malo = r.errores.length > 0;
            const detalle = malo
                ? `<span class="ag-badge ag-badge--obs" title="${esc(r.errores.map((e) => e.mensaje).join(' · '))}">
                     <i class="fas fa-xmark me-1"></i>${esc(r.errores[0].mensaje)}</span>`
                : r.avisos.length
                    ? `<span class="ag-badge ag-badge--pend" title="${esc(r.avisos.join(' · '))}">
                         <i class="fas fa-triangle-exclamation me-1"></i>Aviso</span>`
                    : '<span class="ag-badge ag-badge--val"><i class="fas fa-check me-1"></i>Lista</span>';

            return `<tr class="${malo ? 'table-danger' : ''}">
                <td class="ag-num text-muted">${r.filaExcel}</td>
                <td class="ag-num">${esc(m.folio_rotacion ?? '—')}</td>
                <td>${esc(m.fecha_operacion || '—')}</td>
                <td>${esc(m.tipo_operacion || '—')}</td>
                <td>${esc(m.ambito_operacion || '—')}</td>
                <td class="text-truncate" style="max-width:180px" title="${esc(m.operador)}">${esc(m.operador || '—')}</td>
                <td class="ag-mono">${esc(m.matricula || '—')}</td>
                <td>${esc(m.tipo_aeronave || '—')}</td>
                <td class="ag-mono">${esc(m.aeropuerto_origen_destino || '—')}</td>
                <td class="ag-num">${esc(Core.horaCorta(m.hora_programada))}</td>
                <td class="ag-num">${esc(Core.horaCorta(m.hora_real))}</td>
                <td class="ag-num">${esc(m.adultos)}</td>
                <td class="ag-num">${esc(m.infantes)}</td>
                <td class="ag-num fw-bold">${Core.paxTotal(m)}</td>
                <td>${detalle}</td>
            </tr>`;
        }).join('');

        wrap.classList.remove('d-none');

        if (estado.preparadas.length > PREVIA) {
            document.getElementById('ag-imp-previa-body').insertAdjacentHTML('beforeend',
                `<tr><td colspan="${columnas.length}" class="text-center text-muted small py-2">
                    … y ${Core.numero(estado.preparadas.length - PREVIA)} filas más
                 </td></tr>`);
        }
    }

    // ── Pasos 3 y 4: ensayo e importación real ──────────────────────────────

    async function subir(esEnsayo) {
        if (estado.importando) return;
        if (!estado.validas.length) return;
        if (!esEnsayo && !AG.puedeCapturar()) {
            aviso('No tienes permiso para importar en este módulo.', 'warning');
            return;
        }

        // Una importación real es difícil de deshacer registro por registro:
        // se pregunta una vez, con el número exacto delante.
        if (!esEnsayo) {
            const ok = root.confirm(
                `Se van a insertar ${estado.validas.length} movimientos desde "${estado.nombreArchivo}".\n\n` +
                'Los que ya existan se omiten automáticamente. ¿Continuar?'
            );
            if (!ok) return;
        }

        estado.importando = true;
        const barra = document.getElementById('ag-imp-progreso');
        const relleno = barra.querySelector('.progress-bar');
        barra.classList.remove('d-none');
        relleno.style.width = '0%';

        const caja = document.getElementById('ag-imp-resultado');
        caja.innerHTML = `<div class="small text-muted">
            <span class="spinner-border spinner-border-sm me-1"></span>
            ${esEnsayo ? 'Ensayando contra la base…' : 'Importando…'}</div>`;

        try {
            const resultado = await Datos.importar({
                filas: estado.validas.map((r) => r.movimiento),
                archivo: estado.nombreArchivo,
                hoja: estado.hoja,
                simulacion: esEnsayo,
                onProgreso: ({ acumulado }) => {
                    relleno.style.width = `${Math.round((acumulado / estado.validas.length) * 100)}%`;
                }
            });

            if (esEnsayo) estado.ensayo = resultado;
            pintarResultado(resultado, esEnsayo);

            if (!esEnsayo) {
                aviso(`Importación terminada: ${resultado.insertadas} nuevos, ${resultado.duplicadas} ya existían.`, 'success');
                AG.emit('datos:cambiaron');
                AG.invalidar();
                AG.recargarOpciones();
            }
        } catch (error) {
            console.error('[Aviación General] importación', error);
            caja.innerHTML = `<div class="alert alert-danger py-2 small mb-0">
                <div class="fw-bold">No se pudo completar la importación</div>
                <div>${esc(error.message)}</div>
                <div class="mt-1">Cada tanda es transaccional: la que falló no dejó filas a medias.
                    Corrige la causa y vuelve a intentarlo; lo que ya entró no se duplicará.</div>
            </div>`;
        } finally {
            estado.importando = false;
            setTimeout(() => barra.classList.add('d-none'), 900);
        }
    }

    function pintarResultado(r, esEnsayo) {
        const caja = document.getElementById('ag-imp-resultado');
        const detalle = [...(r.detalle_duplicadas || []), ...(r.detalle_rechazadas || [])];

        caja.innerHTML = `
            <div class="alert ${esEnsayo ? 'alert-info' : 'alert-success'} py-2 mb-2">
                <div class="fw-bold">
                    <i class="fas ${esEnsayo ? 'fa-flask' : 'fa-circle-check'} me-1"></i>
                    ${esEnsayo ? 'Ensayo (no se guardó nada)' : 'Importación completada'}
                </div>
                <div class="d-flex flex-wrap gap-3 small mt-1">
                    <span><strong>${Core.numero(r.recibidas)}</strong> enviadas</span>
                    <span class="text-success"><strong>${Core.numero(r.insertadas)}</strong>
                        ${esEnsayo ? 'entrarían' : 'insertadas'}</span>
                    <span class="text-warning-emphasis"><strong>${Core.numero(r.duplicadas)}</strong> ya existían</span>
                    <span class="text-danger"><strong>${Core.numero(r.rechazadas)}</strong> rechazadas por la base</span>
                </div>
            </div>
            ${detalle.length ? `
                <div class="ag-tabla-wrap" style="max-height:240px">
                    <table class="table table-sm ag-tabla mb-0">
                        <thead><tr><th>Fila del Excel</th><th>Motivo</th></tr></thead>
                        <tbody>${detalle.slice(0, 200).map((d) => `
                            <tr><td class="ag-num">${esc(d.fila_origen ?? d.indice)}</td>
                                <td>${esc(d.motivo)}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>` : ''}
            ${esEnsayo && r.insertadas ? `
                <div class="small text-muted mt-2">
                    El ensayo se ve bien. Usa <strong>Importar</strong> para guardar de verdad.
                </div>` : ''}`;
    }

    /** Excel con las filas que no pasaron, para corregir el archivo de origen. */
    function descargarErrores() {
        if (typeof root.XLSX === 'undefined' || !estado.invalidas.length) return;
        const filas = estado.invalidas.map((r) => ({
            'Fila del Excel': r.filaExcel,
            'Motivos': r.errores.map((e) => e.mensaje).join(' · '),
            'No.': r.movimiento.folio_rotacion,
            'FECHA': r.movimiento.fecha_operacion,
            'TIPO DE OPERACIÓN': r.movimiento.tipo_operacion,
            'NACIONAL': r.movimiento.ambito_operacion,
            'NOMBRE DEL OPERADOR': r.movimiento.operador,
            'MATRÍCULA': r.movimiento.matricula,
            'TIPO DE AERONAVE': r.movimiento.tipo_aeronave,
            'DESTINO / ORIGEN': r.movimiento.aeropuerto_origen_destino
        }));
        const hoja = root.XLSX.utils.json_to_sheet(filas);
        const libro = root.XLSX.utils.book_new();
        root.XLSX.utils.book_append_sheet(libro, hoja, 'Filas con errores');
        root.XLSX.writeFile(libro, `errores_${estado.nombreArchivo.replace(/\.[^.]+$/, '')}.xlsx`);
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
                if (archivo) leerArchivo(archivo);
            });
            panel.querySelector('#ag-imp-hoja').addEventListener('change', (e) => procesarHoja(e.target.value));
        },

        async refrescar() { /* no depende de los filtros del módulo */ }
    });
})(typeof window !== 'undefined' ? window : globalThis);
