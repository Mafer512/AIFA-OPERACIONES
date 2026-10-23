/* Pantalla del módulo "Solicitud de Slots → SSIM".
 *
 * Reproduce la hoja del Comité de Operación y Horarios (encabezado + renglones
 * con horarios, frecuencia y vigencia en UTC) y la convierte en un archivo
 * IATA SSIM Cap. 7 con js/ssim-slots/core.js. Todas las reglas de conversión
 * viven en el núcleo; aquí sólo se captura, se guarda y se pinta.
 *
 * DÓNDE SE GUARDA
 *
 *   En el navegador de quien captura (localStorage), igual que un borrador.
 *   No hay tabla en Supabase para esto todavía. Para pasar una solicitud a
 *   otro equipo está "Exportar .json" / "Importar .json". Los tiempos de
 *   bloque y las diferencias UTC que se capturan se recuerdan aparte, para que
 *   la siguiente solicitud de la misma ruta ya los traiga.
 *
 * ARRANQUE
 *
 *   Igual que Aviación General: la sección se monta la primera vez que se
 *   vuelve `active`, vigilada con un MutationObserver. script.js no necesita
 *   saber que este módulo existe.
 */
(function (root) {
    'use strict';

    const Core = root.SsimSlotsCore;
    if (!Core) {
        console.error('[SSIM Slots] Falta js/ssim-slots/core.js: el módulo no puede arrancar.');
        return;
    }

    const ID_CONTENEDOR = 'ssim-slots-section';
    const CLAVE_LOCAL = 'aifa.ssimSlots.v1';
    const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v === null || v === undefined ? '' : v)
        .replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

    function aviso(mensaje, tipo) {
        if (typeof root.showNotification === 'function') root.showNotification(mensaje, tipo || 'info');
        else console.log(`[SSIM Slots] ${mensaje}`);
    }

    // ── Estado ──────────────────────────────────────────────────────────────

    const estado = {
        montado: false,
        almacen: { activa: null, solicitudes: {}, bloques: {}, husos: {} },
        catalogo: null,
        analisis: null,
        generado: null,
        temporizador: null,
        guardadoEn: null
    };

    const activa = () => estado.almacen.solicitudes[estado.almacen.activa];

    function cargarAlmacen() {
        try {
            const crudo = root.localStorage && root.localStorage.getItem(CLAVE_LOCAL);
            if (crudo) {
                const a = JSON.parse(crudo);
                if (a && typeof a === 'object' && a.solicitudes) estado.almacen = Object.assign(estado.almacen, a);
            }
        } catch (e) { console.warn('[SSIM Slots] No se pudo leer el borrador local', e); }
        if (!activa()) {
            const ids = Object.keys(estado.almacen.solicitudes);
            if (ids.length) estado.almacen.activa = ids[ids.length - 1];
            else agregarSolicitud(Core.nuevaSolicitud());
        }
    }

    function guardarAlmacen() {
        try {
            root.localStorage.setItem(CLAVE_LOCAL, JSON.stringify(estado.almacen));
            estado.guardadoEn = new Date();
            const s = $('ss-guardado');
            if (s) s.textContent = `Guardado en este equipo · ${estado.guardadoEn.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
        } catch (e) {
            const s = $('ss-guardado');
            if (s) s.textContent = 'No se pudo guardar en este equipo (almacenamiento bloqueado)';
        }
    }

    function agregarSolicitud(sol) {
        sol.modificada = new Date().toISOString();
        estado.almacen.solicitudes[sol.id] = sol;
        estado.almacen.activa = sol.id;
    }

    /** La solicitud con los tiempos de bloque y husos recordados debajo de los suyos. */
    function solicitudEfectiva() {
        const sol = activa();
        return Object.assign({}, sol, {
            bloques: Object.assign({}, estado.almacen.bloques, sol.bloques),
            husos: Object.assign({}, estado.almacen.husos, sol.husos)
        });
    }

    // ── Catálogos (data/master) ─────────────────────────────────────────────

    function parsearCsv(texto) {
        const filas = [];
        let fila = [], celda = '', comillas = false;
        const t = String(texto || '').replace(/^﻿/, '');
        for (let i = 0; i < t.length; i++) {
            const c = t[i];
            if (comillas) {
                if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; }
                else if (c === '"') comillas = false;
                else celda += c;
            } else if (c === '"') comillas = true;
            else if (c === ',') { fila.push(celda); celda = ''; }
            else if (c === '\n') { fila.push(celda.replace(/\r$/, '')); filas.push(fila); fila = []; celda = ''; }
            else celda += c;
        }
        if (celda || fila.length) { fila.push(celda); filas.push(fila); }
        return filas;
    }

    async function cargarCatalogos() {
        const leer = async (ruta) => {
            const r = await fetch(ruta, { cache: 'no-store' });
            if (!r.ok) throw new Error(`${ruta}: ${r.status}`);
            return parsearCsv(await r.text());
        };
        try {
            const [equipos, aeropuertos, aerolineas] = await Promise.all([
                leer('data/master/aircraft%20type.csv'), leer('data/master/airports.csv'), leer('data/master/airlines.csv')
            ]);
            const icaoAIata = {}, iata = new Set(), paises = {}, lineas = [];
            equipos.slice(1).forEach((f) => {
                const cIata = String(f[0] || '').trim().toUpperCase(), cIcao = String(f[1] || '').trim().toUpperCase();
                if (cIata) iata.add(cIata);
                if (cIata && cIcao && !icaoAIata[cIcao]) icaoAIata[cIcao] = cIata;
            });
            aeropuertos.slice(1).forEach((f) => {
                const c = String(f[0] || '').trim().toUpperCase();
                if (/^[A-Z]{3}$/.test(c)) paises[c] = String(f[3] || '').trim() || 'Sin país';
            });
            aerolineas.slice(1).forEach((f) => {
                const c = String(f[0] || '').trim().toUpperCase();
                if (c) lineas.push({ iata: c, nombre: String(f[2] || '').trim() });
            });
            estado.catalogo = { icaoAIata, iata, paises, lineas, equipos: equipos.slice(1).map((f) => String(f[1] || '').trim()).filter(Boolean) };
            pintarDatalists();
            analizarYPintar();
        } catch (e) {
            console.warn('[SSIM Slots] Catálogos no disponibles; se usan los de respaldo del núcleo.', e);
        }
    }

    function pintarDatalists() {
        const c = estado.catalogo;
        if (!c) return;
        const opciones = (lista) => lista.map((x) => `<option value="${esc(x.v)}">${esc(x.t || '')}</option>`).join('');
        const eq = new Set([...Object.keys(Core.EQUIPOS_ICAO_IATA), ...c.equipos]);
        $('ss-dl-equipos').innerHTML = opciones([...eq].sort().map((v) => ({ v, t: c.icaoAIata[v] || Core.EQUIPOS_ICAO_IATA[v] || '' })));
        $('ss-dl-estaciones').innerHTML = opciones(Object.keys(c.paises).sort().map((v) => ({ v, t: c.paises[v] })));
        $('ss-dl-lineas').innerHTML = opciones(c.lineas.map((x) => ({ v: x.iata, t: x.nombre })));
    }

    // ── Plantilla ───────────────────────────────────────────────────────────

    function plantilla() {
        return `
        <div class="ss-header d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div>
                <div class="ss-eyebrow"><i class="fas fa-clock me-1"></i>GOPA · Comité de Operación y Horarios</div>
                <h2>Solicitud de Slots → SSIM</h2>
                <p class="ss-sub">Captura la solicitud de horarios (UTC) tal como viene en la hoja del COyH y genera el archivo IATA SSIM Cap. 7.</p>
            </div>
            <div class="ss-solicitudes">
                <label for="ss-sel-solicitud">Solicitud</label>
                <div class="d-flex gap-1">
                    <select class="form-select form-select-sm" id="ss-sel-solicitud" data-cb-no></select>
                    <button class="btn btn-sm btn-light" id="ss-btn-nueva" title="Nueva solicitud"><i class="fas fa-plus"></i></button>
                    <button class="btn btn-sm btn-light" id="ss-btn-duplicar" title="Duplicar solicitud"><i class="fas fa-clone"></i></button>
                    <button class="btn btn-sm btn-light" id="ss-btn-eliminar" title="Eliminar solicitud"><i class="fas fa-trash-can"></i></button>
                </div>
            </div>
        </div>

        <div class="ss-barra d-flex flex-wrap align-items-center gap-2">
            <button class="btn btn-sm btn-outline-success" id="ss-btn-excel"><i class="fas fa-file-excel me-1"></i>Importar Excel</button>
            <input type="file" id="ss-file-excel" accept=".xlsx,.xls,.xlsm,.csv" hidden>
            <button class="btn btn-sm btn-outline-primary" id="ss-btn-pegar"><i class="fas fa-paste me-1"></i>Pegar renglones</button>
            <span class="ss-sep"></span>
            <button class="btn btn-sm btn-outline-secondary" id="ss-btn-exportar-json"><i class="fas fa-file-arrow-down me-1"></i>Exportar .json</button>
            <button class="btn btn-sm btn-outline-secondary" id="ss-btn-importar-json"><i class="fas fa-file-arrow-up me-1"></i>Importar .json</button>
            <input type="file" id="ss-file-json" accept=".json,application/json" hidden>
            <span class="ms-auto small text-muted" id="ss-guardado"></span>
        </div>

        <div class="ss-card">
            <div class="ss-card-title"><i class="fas fa-building me-1"></i>Encabezado</div>
            <div class="row g-2">
                <div class="col-12 col-md-5"><label for="ss-h-aerolinea">Línea aérea (razón social)</label>
                    <input class="form-control form-control-sm" id="ss-h-aerolinea" data-enc="aerolinea" placeholder="AEROENLACES NACIONALES S.A. DE C.V."></div>
                <div class="col-4 col-md-1"><label for="ss-h-iata">IATA</label>
                    <input class="form-control form-control-sm text-uppercase" id="ss-h-iata" data-enc="iata" maxlength="3" list="ss-dl-lineas" placeholder="VB"></div>
                <div class="col-8 col-md-3"><label for="ss-h-representante">Representante</label>
                    <input class="form-control form-control-sm" id="ss-h-representante" data-enc="representante"></div>
                <div class="col-6 col-md-3"><label for="ss-h-fecha">Fecha</label>
                    <input class="form-control form-control-sm" id="ss-h-fecha" data-enc="fecha" data-tipo="fecha" placeholder="dd/mm/aaaa" inputmode="numeric"></div>
                <div class="col-6 col-md-3"><label for="ss-h-tel-oficina">Teléfono oficina</label>
                    <input class="form-control form-control-sm" id="ss-h-tel-oficina" data-enc="telOficina" inputmode="tel"></div>
                <div class="col-6 col-md-3"><label for="ss-h-tel-celular">Teléfono celular</label>
                    <input class="form-control form-control-sm" id="ss-h-tel-celular" data-enc="telCelular" inputmode="tel"></div>
                <div class="col-4 col-md-2"><label for="ss-h-pagina">Página</label>
                    <input class="form-control form-control-sm" id="ss-h-pagina" data-enc="pagina"></div>
                <div class="col-4 col-md-2"><label for="ss-h-revision">Revisión</label>
                    <input class="form-control form-control-sm" id="ss-h-revision" data-enc="revision"></div>
                <div class="col-4 col-md-2"><label for="ss-h-control">No. control</label>
                    <input class="form-control form-control-sm" id="ss-h-control" data-enc="control"></div>
            </div>
        </div>

        <div class="ss-card">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <div class="ss-card-title mb-0"><i class="fas fa-table me-1"></i>Horarios solicitados <span class="ss-utc">UTC</span></div>
                <div class="ss-leyenda">
                    <span class="ss-mov ss-mov-N">N</span>Alta
                    <span class="ss-mov ss-mov-D">D</span>Baja
                    <span class="ss-mov ss-mov-C">C</span>Horario actual
                    <span class="ss-mov ss-mov-R">R</span>Horario revisado
                </div>
                <span class="ms-auto small text-muted">Tip: copia renglones en Excel y pégalos sobre cualquier celda.</span>
            </div>
            <div class="ss-tabla-wrap">
                <table class="ss-tabla" id="ss-tabla">
                    <thead>
                        <tr>
                            <th rowspan="2" class="ss-col-n">#</th>
                            <th rowspan="2">Tipo<br>mov.</th>
                            <th rowspan="2">Línea</th>
                            <th colspan="2">No. de vuelo</th>
                            <th rowspan="2">Equipo</th>
                            <th colspan="2">Horario UTC</th>
                            <th colspan="2">Ruta</th>
                            <th rowspan="2">Frecuencia UTC</th>
                            <th colspan="2">Vigencia UTC</th>
                            <th colspan="2">Tipo</th>
                            <th rowspan="2">No. slot</th>
                            <th rowspan="2">Observaciones</th>
                            <th rowspan="2" class="ss-col-acc"></th>
                        </tr>
                        <tr>
                            <th>Llega</th><th>Sale</th>
                            <th>Llega</th><th>Sale</th>
                            <th>Origen</th><th>Destino</th>
                            <th>Desde</th><th>Hasta</th>
                            <th>Llega</th><th>Sale</th>
                        </tr>
                    </thead>
                    <tbody id="ss-tbody"></tbody>
                </table>
            </div>
            <div class="d-flex flex-wrap gap-2 mt-2">
                <button class="btn btn-sm btn-outline-primary" id="ss-btn-renglon"><i class="fas fa-plus me-1"></i>Renglón</button>
                <button class="btn btn-sm btn-outline-primary" id="ss-btn-pareja"><i class="fas fa-right-left me-1"></i>Pareja C / R</button>
                <button class="btn btn-sm btn-outline-secondary" id="ss-btn-limpiar-vacios"><i class="fas fa-broom me-1"></i>Quitar renglones vacíos</button>
            </div>
        </div>

        <div class="row g-3">
            <div class="col-12 col-xl-5">
                <div class="ss-card h-100">
                    <div class="ss-card-title"><i class="fas fa-sliders me-1"></i>Conversión</div>
                    <div class="row g-2 mb-3">
                        <div class="col-4"><label for="ss-o-estacion">Estación</label>
                            <input class="form-control form-control-sm text-uppercase" id="ss-o-estacion" data-op="estacion" maxlength="3"></div>
                        <div class="col-8"><label for="ss-o-modo">Horario del archivo</label>
                            <select class="form-select form-select-sm" id="ss-o-modo" data-op="modoHora" data-cb-no>
                                <option value="U">UTC (como la solicitud)</option>
                                <option value="L">Local de cada aeropuerto</option>
                            </select></div>
                        <div class="col-12"><label for="ss-o-estatus">Estatus del itinerario</label>
                            <select class="form-select form-select-sm" id="ss-o-estatus" data-op="estatus" data-cb-no>
                                <option value="P">P · Planeación (solicitud)</option>
                                <option value="C">C · Confirmado (autorizado)</option>
                            </select></div>
                    </div>
                    <div class="ss-subtitulo">Tiempo de bloque por ruta
                        <i class="fas fa-circle-info ms-1" title="La hoja sólo trae la hora en la estación. La hora del otro aeropuerto se calcula con este tiempo. Se recuerda para la próxima solicitud."></i></div>
                    <div id="ss-bloques" class="mb-3"></div>
                    <div class="ss-subtitulo">Diferencia UTC por estación</div>
                    <div id="ss-husos"></div>
                </div>
            </div>
            <div class="col-12 col-xl-7">
                <div class="ss-card h-100">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div class="ss-card-title mb-0"><i class="fas fa-list-check me-1"></i>Revisión</div>
                        <span class="ms-auto" id="ss-estado-revision"></span>
                    </div>
                    <div id="ss-hallazgos"></div>
                </div>
            </div>
        </div>

        <div class="ss-card mt-3">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <div class="ss-card-title mb-0"><i class="fas fa-file-code me-1"></i>Resultado</div>
                <span class="small text-muted" id="ss-resumen-resultado"></span>
                <div class="ms-auto d-flex gap-2">
                    <button class="btn btn-sm btn-outline-secondary" id="ss-btn-copiar" disabled><i class="fas fa-copy me-1"></i>Copiar</button>
                    <button class="btn btn-sm btn-primary fw-semibold" id="ss-btn-descargar" disabled><i class="fas fa-download me-1"></i>Descargar .ssim</button>
                </div>
            </div>
            <ul class="nav ss-tabs mb-2" role="tablist">
                <li class="nav-item"><button class="nav-link active" data-ss-tab="vuelos" type="button">Vuelos SSIM <span class="badge bg-secondary" id="ss-badge-vuelos">0</span></button></li>
                <li class="nav-item"><button class="nav-link" data-ss-tab="salen" type="button">Salen del itinerario <span class="badge bg-secondary" id="ss-badge-salen">0</span></button></li>
                <li class="nav-item"><button class="nav-link" data-ss-tab="fechas" type="button">Por fecha</button></li>
                <li class="nav-item"><button class="nav-link" data-ss-tab="archivo" type="button">Archivo</button></li>
            </ul>
            <div data-ss-panel="vuelos" id="ss-panel-vuelos"></div>
            <div data-ss-panel="salen" id="ss-panel-salen" hidden></div>
            <div data-ss-panel="fechas" id="ss-panel-fechas" hidden></div>
            <div data-ss-panel="archivo" id="ss-panel-archivo" hidden></div>
        </div>

        <datalist id="ss-dl-equipos"></datalist>
        <datalist id="ss-dl-estaciones"></datalist>
        <datalist id="ss-dl-lineas"></datalist>

        <div class="modal fade" id="ss-modal-pegar" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-paste me-2"></i>Pegar renglones de la hoja</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="small text-muted mb-2">Selecciona en Excel los renglones de datos (desde "Tipo Movimiento" hasta "Observaciones") y pégalos aquí.
                            Se reconocen los que empiezan con N, D, C o R.</p>
                        <textarea class="form-control font-monospace small" id="ss-txt-pegar" rows="10" placeholder="C	VB		9212	A320		0313		OAX	_	_	_	_	5	_	_	16/10/26	23/10/26		J"></textarea>
                        <div class="form-check mt-2">
                            <input class="form-check-input" type="checkbox" id="ss-chk-reemplazar">
                            <label class="form-check-label small" for="ss-chk-reemplazar">Reemplazar los renglones actuales</label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <span class="small text-muted me-auto" id="ss-pegar-cuenta"></span>
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-sm btn-primary" id="ss-btn-pegar-aceptar">Agregar renglones</button>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // ── Encabezado y opciones ───────────────────────────────────────────────

    function pintarSelectorSolicitudes() {
        const sel = $('ss-sel-solicitud');
        const lista = Object.values(estado.almacen.solicitudes)
            .sort((a, b) => String(b.modificada || '').localeCompare(String(a.modificada || '')));
        sel.innerHTML = lista.map((s) => {
            const e = s.encabezado || {};
            const nombre = [e.iata || '—', e.aerolinea ? e.aerolinea.slice(0, 28) : 'Sin aerolínea', Core.fechaCorta(e.fecha), e.control ? `#${e.control}` : '']
                .filter(Boolean).join(' · ');
            return `<option value="${esc(s.id)}" ${s.id === estado.almacen.activa ? 'selected' : ''}>${esc(nombre)}</option>`;
        }).join('');
    }

    function pintarEncabezado() {
        const sol = activa();
        document.querySelectorAll(`#${ID_CONTENEDOR} [data-enc]`).forEach((el) => {
            const k = el.dataset.enc;
            el.value = k === 'fecha' ? fechaVista(sol.encabezado[k], true) : (sol.encabezado[k] || '');
        });
        document.querySelectorAll(`#${ID_CONTENEDOR} [data-op]`).forEach((el) => {
            el.value = sol.opciones[el.dataset.op] || '';
        });
    }

    /** ISO → dd/mm/aa (o dd/mm/aaaa). Lo que no es ISO se muestra tal cual, para que el error se vea. */
    function fechaVista(valor, largo) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '')) return valor || '';
        return largo ? `${valor.slice(8, 10)}/${valor.slice(5, 7)}/${valor.slice(0, 4)}` : Core.fechaCorta(valor);
    }

    // ── Tabla de renglones ──────────────────────────────────────────────────

    const CAMPOS_TEXTO = [
        // campo, clase, maxlength, atributos extra
        ['linea', 'ss-in-linea', 3, 'list="ss-dl-lineas"'],
        ['vueloLlega', 'ss-in-vuelo', 6, 'inputmode="numeric"'],
        ['vueloSale', 'ss-in-vuelo', 6, 'inputmode="numeric"'],
        ['equipo', 'ss-in-equipo', 5, 'list="ss-dl-equipos"'],
        ['horaLlega', 'ss-in-hora', 5, 'inputmode="numeric" placeholder="HHMM"'],
        ['horaSale', 'ss-in-hora', 5, 'inputmode="numeric" placeholder="HHMM"'],
        ['origen', 'ss-in-est', 3, 'list="ss-dl-estaciones"'],
        ['destino', 'ss-in-est', 3, 'list="ss-dl-estaciones"']
    ];

    function htmlFila(f, i) {
        const celda = ([campo, clase, max, extra]) =>
            `<td><input class="ss-in ${clase}" data-campo="${campo}" maxlength="${max}" ${extra} value="${esc(f[campo])}" aria-label="${campo} renglón ${i + 1}"></td>`;
        const dias = String(f.dias || '');
        return `
        <tr data-fila="${i}">
            <td class="ss-col-n">${i + 1}</td>
            <td><select class="ss-in ss-in-mov ss-mov-sel-${esc(f.mov)}" data-campo="mov" data-cb-no aria-label="Tipo de movimiento renglón ${i + 1}">
                ${['', 'N', 'D', 'C', 'R'].map((m) => `<option value="${m}" ${f.mov === m ? 'selected' : ''}>${m || '—'}</option>`).join('')}
            </select></td>
            ${CAMPOS_TEXTO.slice(0, 6).map(celda).join('')}
            ${CAMPOS_TEXTO.slice(6).map(celda).join('')}
            <td><div class="ss-dias" role="group" aria-label="Frecuencia renglón ${i + 1}">
                ${DIAS.map((d, k) => `<button type="button" class="ss-dia ${dias.includes(String(k + 1)) ? 'on' : ''}" data-dia="${k + 1}"
                    title="${DIAS_LARGOS[k]} (${k + 1})" aria-pressed="${dias.includes(String(k + 1))}">${k + 1}</button>`).join('')}
            </div></td>
            <td><input class="ss-in ss-in-fecha" data-campo="desde" maxlength="10" placeholder="dd/mm/aa" inputmode="numeric" value="${esc(fechaVista(f.desde))}"></td>
            <td><input class="ss-in ss-in-fecha" data-campo="hasta" maxlength="10" placeholder="dd/mm/aa" inputmode="numeric" value="${esc(fechaVista(f.hasta))}"></td>
            <td><input class="ss-in ss-in-tipo" data-campo="tipoLlega" maxlength="1" value="${esc(f.tipoLlega)}" title="Tipo de servicio IATA de la llegada (J regular pasajeros)"></td>
            <td><input class="ss-in ss-in-tipo" data-campo="tipoSale" maxlength="1" value="${esc(f.tipoSale)}" title="Tipo de servicio IATA de la salida (J regular pasajeros)"></td>
            <td><input class="ss-in ss-in-slot" data-campo="slot" maxlength="20" value="${esc(f.slot)}"></td>
            <td><input class="ss-in ss-in-obs" data-campo="obs" maxlength="120" value="${esc(f.obs)}"></td>
            <td class="ss-col-acc">
                <button type="button" class="ss-acc" data-accion="duplicar" title="Duplicar renglón"><i class="fas fa-clone"></i></button>
                <button type="button" class="ss-acc" data-accion="borrar" title="Borrar renglón"><i class="fas fa-xmark"></i></button>
            </td>
        </tr>`;
    }

    function pintarTabla() {
        const sol = activa();
        if (!sol.filas.length) sol.filas.push(Core.filaVacia());
        $('ss-tbody').innerHTML = sol.filas.map(htmlFila).join('');
    }

    /** Normaliza lo que se escribió en una celda al salir de ella. */
    function normalizarCampo(campo, valor) {
        const v = String(valor || '').trim();
        switch (campo) {
            case 'horaLlega': case 'horaSale': return Core.normalizarHora(v) || v;
            case 'desde': case 'hasta': return Core.normalizarFecha(v) || v;
            case 'mov': case 'tipoLlega': case 'tipoSale': return v.toUpperCase().slice(0, 1);
            case 'linea': case 'origen': case 'destino': case 'equipo': case 'vueloLlega': case 'vueloSale': return v.toUpperCase().replace(/\s+/g, '');
            default: return v;
        }
    }

    function filaDeEvento(ev) {
        const tr = ev.target.closest('tr[data-fila]');
        return tr ? +tr.dataset.fila : -1;
    }

    function enganchesTabla() {
        const tbody = $('ss-tbody');

        tbody.addEventListener('input', (ev) => {
            const el = ev.target;
            const i = filaDeEvento(ev);
            if (i < 0 || !el.dataset.campo) return;
            activa().filas[i][el.dataset.campo] = el.value;
            if (el.dataset.campo === 'mov') el.className = `ss-in ss-in-mov ss-mov-sel-${el.value}`;
            cambio();
        });

        tbody.addEventListener('change', (ev) => {
            const el = ev.target;
            const i = filaDeEvento(ev);
            if (i < 0 || !el.dataset.campo) return;
            const campo = el.dataset.campo;
            const fila = activa().filas[i];
            fila[campo] = normalizarCampo(campo, el.value);
            el.value = (campo === 'desde' || campo === 'hasta') ? fechaVista(fila[campo]) : fila[campo];
            cambio(true);
        });

        tbody.addEventListener('click', (ev) => {
            const dia = ev.target.closest('.ss-dia');
            const acc = ev.target.closest('.ss-acc');
            const i = filaDeEvento(ev);
            if (i < 0) return;
            const sol = activa();
            if (dia) {
                const d = dia.dataset.dia;
                const set = new Set(String(sol.filas[i].dias || '').split('').filter(Boolean));
                if (set.has(d)) set.delete(d); else set.add(d);
                sol.filas[i].dias = [...set].sort().join('');
                dia.classList.toggle('on', set.has(d));
                dia.setAttribute('aria-pressed', set.has(d));
                cambio(true);
            } else if (acc && acc.dataset.accion === 'duplicar') {
                sol.filas.splice(i + 1, 0, Object.assign({}, sol.filas[i]));
                pintarTabla(); cambio(true); enfocar(i + 1, 'mov');
            } else if (acc && acc.dataset.accion === 'borrar') {
                sol.filas.splice(i, 1);
                pintarTabla(); cambio(true);
            }
        });

        // Enter baja al mismo campo del renglón siguiente (y crea uno si es el último).
        tbody.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || !ev.target.dataset.campo) return;
            ev.preventDefault();
            ev.target.dispatchEvent(new Event('change', { bubbles: true }));
            const i = filaDeEvento(ev);
            const sol = activa();
            if (i === sol.filas.length - 1) {
                sol.filas.push(nuevaFilaPropuesta(sol.filas[i]));
                pintarTabla(); cambio(true);
            }
            enfocar(i + 1, ev.target.dataset.campo);
        });

        // Pegar varios renglones copiados de Excel sobre cualquier celda.
        tbody.addEventListener('paste', (ev) => {
            const txt = ev.clipboardData && ev.clipboardData.getData('text/plain');
            if (!txt || !/\t/.test(txt)) return;
            const filas = Core.parsearPegado(txt);
            if (!filas.length) return;
            ev.preventDefault();
            insertarFilas(filas, Math.max(0, filaDeEvento(ev)), false);
        });
    }

    function nuevaFilaPropuesta(anterior) {
        const f = Core.filaVacia();
        const sol = activa();
        f.linea = (anterior && anterior.linea) || sol.encabezado.iata || '';
        f.equipo = (anterior && anterior.equipo) || '';
        return f;
    }

    function enfocar(i, campo) {
        const el = document.querySelector(`#ss-tbody tr[data-fila="${i}"] [data-campo="${campo}"]`);
        if (el) { el.focus(); if (el.select) el.select(); }
    }

    /** Inserta renglones en la posición dada; los renglones vacíos se reemplazan. */
    function insertarFilas(filas, desde, reemplazar) {
        const sol = activa();
        if (reemplazar) sol.filas = [];
        else {
            sol.filas = sol.filas.filter((f, i) => i < desde || !Core.filaEnBlanco(f));
            desde = Math.min(desde, sol.filas.length);
        }
        sol.filas.splice(desde, 0, ...filas);
        const iatas = new Set(filas.map((f) => f.linea).filter(Boolean));
        if (!sol.encabezado.iata && iatas.size === 1) sol.encabezado.iata = [...iatas][0];
        pintarEncabezado(); pintarTabla(); cambio(true);
        aviso(`${filas.length} renglón(es) agregados.`, 'success');
    }

    // ── Análisis y paneles ──────────────────────────────────────────────────

    /** Marca un cambio: guarda y vuelve a analizar (con un pequeño retraso al teclear). */
    function cambio(inmediato) {
        activa().modificada = new Date().toISOString();
        clearTimeout(estado.temporizador);
        estado.temporizador = setTimeout(() => { guardarAlmacen(); analizarYPintar(); }, inmediato ? 0 : 350);
    }

    function analizarYPintar() {
        if (!estado.montado) return;
        const sol = solicitudEfectiva();
        estado.generado = Core.generarSsim(sol, estado.catalogo);
        estado.analisis = estado.generado.analisis;
        pintarEstadoFilas();
        pintarHallazgos();
        pintarBloques();
        pintarHusos();
        pintarResultado();
        pintarSelectorSolicitudes();
    }

    function pintarEstadoFilas() {
        const a = estado.analisis;
        const porFila = new Map();
        a.errores.concat(a.avisos.map((x) => Object.assign({ aviso: true }, x))).forEach((h) => {
            if (!h.fila) return;
            if (!porFila.has(h.fila)) porFila.set(h.fila, []);
            porFila.get(h.fila).push(h);
        });
        document.querySelectorAll('#ss-tbody tr[data-fila]').forEach((tr) => {
            const n = +tr.dataset.fila + 1;
            const h = porFila.get(n) || [];
            tr.classList.toggle('ss-fila-error', h.some((x) => !x.aviso));
            tr.classList.toggle('ss-fila-aviso', !h.some((x) => !x.aviso) && h.length > 0);
            tr.title = h.map((x) => `${x.aviso ? '⚠' : '✖'} ${x.msg}`).join('\n');
        });
    }

    function pintarHallazgos() {
        const a = estado.analisis;
        const caja = $('ss-hallazgos');
        const est = $('ss-estado-revision');
        const vacia = !activa().filas.some((f) => !Core.filaEnBlanco(f));
        if (vacia) {
            est.innerHTML = '';
            caja.innerHTML = '<div class="ss-vacio"><i class="fas fa-keyboard"></i>Captura o pega los renglones de la solicitud.</div>';
            return;
        }
        est.innerHTML = a.errores.length
            ? `<span class="badge bg-danger">${a.errores.length} por corregir</span>`
            : '<span class="badge bg-success"><i class="fas fa-check me-1"></i>Lista para generar</span>';
        if (a.avisos.length) est.innerHTML += ` <span class="badge bg-warning text-dark">${a.avisos.length} aviso(s)</span>`;
        const item = (h, tipo) => `
            <li class="ss-h ss-h-${tipo}">
                <i class="fas ${tipo === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}"></i>
                ${h.fila ? `<button type="button" class="ss-h-fila" data-ir-fila="${h.fila - 1}">Renglón ${h.fila}</button>` : ''}
                <span>${esc(h.msg)}</span>
            </li>`;
        caja.innerHTML = (a.errores.length || a.avisos.length)
            ? `<ul class="ss-hallazgos">${a.errores.map((h) => item(h, 'error')).join('')}${a.avisos.map((h) => item(h, 'aviso')).join('')}</ul>`
            : '<div class="ss-ok"><i class="fas fa-circle-check"></i>Sin observaciones. Revisa la pestaña <b>Vuelos SSIM</b> y descarga el archivo.</div>';
    }

    function pintarBloques() {
        const a = estado.analisis;
        const sol = activa();
        const caja = $('ss-bloques');
        if (!a.rutas.length) { caja.innerHTML = '<div class="small text-muted">Aparecen al capturar orígenes y destinos.</div>'; return; }
        caja.innerHTML = `<table class="ss-mini"><tbody>${a.rutas.sort((x, y) => x.ruta.localeCompare(y.ruta)).map((r) => {
            const propio = Number(sol.bloques[r.ruta]) > 0;
            const recordado = !propio && Number(estado.almacen.bloques[r.ruta]) > 0;
            const fuente = propio ? 'capturado' : recordado ? 'recordado' : r.referencia ? 'referencia' : 'falta';
            return `<tr class="${fuente === 'falta' ? 'ss-falta' : ''}">
                <td class="fw-semibold">${esc(r.ruta.replace('-', ' → '))}</td>
                <td><input class="form-control form-control-sm ss-in-min" type="number" min="10" max="1200" step="1"
                    data-bloque="${esc(r.ruta)}" value="${r.bloque || ''}" placeholder="min"></td>
                <td><span class="ss-fuente ss-fuente-${fuente}">${fuente}</span></td>
            </tr>`;
        }).join('')}</tbody></table>`;
    }

    function pintarHusos() {
        const a = estado.analisis;
        const sol = activa();
        $('ss-husos').innerHTML = `<table class="ss-mini"><tbody>${a.estaciones.map((e) => {
            const propio = !!Core.normalizarHuso(sol.husos[e.estacion]) || !!Core.normalizarHuso(estado.almacen.husos[e.estacion]);
            const fuente = propio ? 'capturado' : e.huso ? 'tabla' : 'falta';
            return `<tr class="${fuente === 'falta' ? 'ss-falta' : ''}">
                <td class="fw-semibold">${esc(e.estacion)}</td>
                <td><input class="form-control form-control-sm ss-in-min" data-huso="${esc(e.estacion)}" maxlength="5" value="${esc(e.huso)}" placeholder="-0600"></td>
                <td><span class="ss-fuente ss-fuente-${fuente}">${fuente}</span></td>
            </tr>`;
        }).join('')}</tbody></table>`;
    }

    const diasTexto = (dias) => [1, 2, 3, 4, 5, 6, 7].map((d) => (String(dias).includes(String(d)) ? d : '·')).join('');
    const varTexto = (n) => (n === 0 ? '' : n > 0 ? `+${n}` : String(n));

    function pintarResultado() {
        const g = estado.generado;
        const a = estado.analisis;
        const op = a.opciones;
        const tz = op.modoHora === 'L' ? 'hora local' : 'UTC';
        const vuelos = a.itinerarios.filter((it) => it.tramos);
        const nTramos = vuelos.reduce((n, it) => n + it.tramos.length, 0);
        $('ss-badge-vuelos').textContent = nTramos;
        $('ss-badge-salen').textContent = a.salen.length;
        $('ss-btn-descargar').disabled = !g.ok;
        $('ss-btn-copiar').disabled = !g.ok;
        $('ss-resumen-resultado').textContent = g.ok
            ? `${g.nombre} · ${g.tramos} tramo(s) · ${g.registros} registros`
            : a.errores.length ? 'Corrige los puntos de la revisión para generar el archivo.' : '';

        const ordenados = vuelos.slice().sort((x, y) => (x.linea + x.vuelo.padStart(4, '0')).localeCompare(y.linea + y.vuelo.padStart(4, '0')) || x.ivi.localeCompare(y.ivi));
        $('ss-panel-vuelos').innerHTML = ordenados.length ? `
            <div class="ss-tabla-wrap"><table class="ss-res">
                <thead><tr><th>Vuelo</th><th>IVI</th><th>Leg</th><th>Ruta</th><th>Desde</th><th>Hasta</th><th>Días</th>
                    <th>Sale (${tz})</th><th>Llega (${tz})</th><th>Bloque</th><th>Equipo</th><th>Mov.</th><th>Renglón</th></tr></thead>
                <tbody>${ordenados.map((it) => it.tramos.map((t) => `
                    <tr>
                        <td class="fw-semibold">${esc(it.linea)} ${esc(it.vuelo)}${esc(it.sufijo)}</td><td>${esc(it.ivi || '')}</td><td>${esc(t.leg)}</td>
                        <td>${esc(t.origen)} → ${esc(t.destino)}</td>
                        <td>${esc(Core.fechaCorta(t.desde))}</td><td>${esc(Core.fechaCorta(t.hasta))}</td>
                        <td class="font-monospace">${diasTexto(t.dias)}</td>
                        <td>${esc(t.std)}${varTexto(t.varSalida) ? `<sup>${varTexto(t.varSalida)}</sup>` : ''}</td>
                        <td>${esc(t.sta)}${varTexto(t.varLlegada) ? `<sup title="Llega ${t.varLlegada > 0 ? 'al día siguiente' : 'el día anterior'}">${varTexto(t.varLlegada)}</sup>` : ''}</td>
                        <td>${t.bloque} min</td><td>${esc(it.equipo)}</td>
                        <td><span class="ss-mov ss-mov-${esc(it.mov)}">${esc(it.mov)}</span></td>
                        <td><button type="button" class="ss-h-fila" data-ir-fila="${it.fila - 1}">${it.fila}</button></td>
                    </tr>`).join('')).join('')}</tbody>
            </table></div>
            <div class="small text-muted mt-1">Periodo y días son los de la salida del tramo, en ${tz}. <sup>+1</sup> = llega al día siguiente.</div>`
            : '<div class="ss-vacio"><i class="fas fa-plane-slash"></i>Sin altas (N) ni revisiones (R) convertibles todavía.</div>';

        $('ss-panel-salen').innerHTML = a.salen.length ? `
            <p class="small text-muted mb-2">Estos horarios (C = el que cambia, D = baja) no van en el SSIM: el archivo describe el itinerario como queda.</p>
            <div class="ss-tabla-wrap"><table class="ss-res">
                <thead><tr><th>Mov.</th><th>Vuelo</th><th>Ruta</th><th>Hora UTC en ${esc(op.estacion)}</th><th>Días UTC</th><th>Desde</th><th>Hasta</th><th>Renglón</th></tr></thead>
                <tbody>${a.salen.map((it) => {
                    const t = it.tramosUtc.find((x) => x.origen === op.estacion || x.destino === op.estacion) || it.tramosUtc[0];
                    const enEst = t.tipo === 'SALE' ? `Sale ${horaDe(t.depAbs)}` : `Llega ${horaDe(t.arrAbs)}`;
                    return `<tr><td><span class="ss-mov ss-mov-${esc(it.mov)}">${esc(it.mov)}</span></td>
                        <td class="fw-semibold">${esc(it.linea)} ${esc(it.vuelo)}</td><td>${esc(t.origen)} → ${esc(t.destino)}</td>
                        <td>${esc(enEst)}</td><td class="font-monospace">${diasTexto(it.diasUtc)}</td>
                        <td>${esc(Core.fechaCorta(it.desdeUtc))}</td><td>${esc(Core.fechaCorta(it.hastaUtc))}</td>
                        <td><button type="button" class="ss-h-fila" data-ir-fila="${it.fila - 1}">${it.fila}</button></td></tr>`;
                }).join('')}</tbody>
            </table></div>`
            : '<div class="ss-vacio"><i class="fas fa-inbox"></i>La solicitud no tiene cambios (C) ni bajas (D).</div>';

        const porFecha = Core.resumenPorFecha(a);
        $('ss-panel-fechas').innerHTML = porFecha.length ? `
            <p class="small text-muted mb-2">Movimientos en ${esc(op.estacion)} por fecha UTC: los que entran al itinerario (N, R) contra los que salen (C, D).</p>
            <div class="ss-tabla-wrap"><table class="ss-res ss-res-fechas">
                <thead><tr><th>Fecha UTC</th><th>Día</th><th>Entran</th><th>Salen</th><th>Neto</th></tr></thead>
                <tbody>${porFecha.map((r) => `<tr>
                    <td>${esc(Core.fechaCorta(r.fecha))}</td><td>${DIAS_LARGOS[r.dia - 1]}</td>
                    <td class="text-success fw-semibold">${r.entran}</td><td class="text-danger fw-semibold">${r.salen}</td>
                    <td class="fw-bold ${r.neto > 0 ? 'text-success' : r.neto < 0 ? 'text-danger' : 'text-muted'}">${r.neto > 0 ? '+' : ''}${r.neto}</td>
                </tr>`).join('')}</tbody>
            </table></div>`
            : '<div class="ss-vacio"><i class="fas fa-calendar"></i>Sin fechas todavía.</div>';

        const regla = Array.from({ length: 20 }, (_, i) => String((i + 1) % 10).padStart(10, ' ')).join('');
        $('ss-panel-archivo').innerHTML = g.ok ? `
            <div class="small text-muted mb-1">${g.registros} registros de 200 caracteres. Las líneas de ceros son relleno del formato (bloques de 5).</div>
            <pre class="ss-pre"><span class="ss-regla">${regla}</span>\n${esc(g.texto.replace(/\r\n$/, '').replace(/\r\n/g, '\n'))}</pre>`
            : '<div class="ss-vacio"><i class="fas fa-file-circle-xmark"></i>El archivo se genera cuando la revisión no tiene errores.</div>';
    }

    const horaDe = (min) => {
        const m = ((min % 1440) + 1440) % 1440;
        return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
    };

    // ── Acciones ────────────────────────────────────────────────────────────

    function descargar(nombre, contenido, tipo) {
        const blob = new Blob([contenido], { type: tipo });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function importarExcel(archivo) {
        if (!root.XLSX) { aviso('No está cargada la librería de Excel (XLSX).', 'error'); return; }
        try {
            const datos = await archivo.arrayBuffer();
            const libro = root.XLSX.read(datos, { type: 'array' });
            // La hoja de la solicitud: la primera que tenga renglones N/D/C/R.
            let mejor = null;
            libro.SheetNames.forEach((nombre) => {
                const matriz = root.XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: '' });
                const r = Core.leerHoja(matriz);
                if (!mejor || r.filas.length > mejor.filas.length) mejor = r;
            });
            if (!mejor || !mejor.filas.length) { aviso('No encontré renglones que empiecen con N, D, C o R en el archivo.', 'warning'); return; }
            const sol = Core.nuevaSolicitud();
            Object.assign(sol.encabezado, Object.fromEntries(Object.entries(mejor.encabezado).filter(([, v]) => v)));
            sol.filas = mejor.filas;
            const iatas = new Set(mejor.filas.map((f) => f.linea).filter(Boolean));
            if (iatas.size === 1) sol.encabezado.iata = [...iatas][0];
            agregarSolicitud(sol);
            guardarAlmacen(); pintarTodo();
            aviso(`Importados ${mejor.filas.length} renglones de ${archivo.name} como solicitud nueva.`, 'success');
        } catch (e) {
            console.error('[SSIM Slots] Importar Excel', e);
            aviso(`No se pudo leer el Excel: ${e.message || e}`, 'error');
        }
    }

    async function importarJson(archivo) {
        try {
            const datos = JSON.parse(await archivo.text());
            const base = Core.nuevaSolicitud();
            const sol = Object.assign(base, {
                encabezado: Object.assign(base.encabezado, datos.encabezado || {}),
                opciones: Object.assign(base.opciones, datos.opciones || {}),
                filas: Array.isArray(datos.filas) && datos.filas.length ? datos.filas.map((f) => Object.assign(Core.filaVacia(), f)) : base.filas,
                bloques: datos.bloques || {}, husos: datos.husos || {}
            });
            agregarSolicitud(sol);
            guardarAlmacen(); pintarTodo();
            aviso('Solicitud importada.', 'success');
        } catch (e) {
            aviso(`El archivo no es una solicitud válida: ${e.message || e}`, 'error');
        }
    }

    function abrirPegar() {
        const modalEl = $('ss-modal-pegar');
        $('ss-txt-pegar').value = '';
        $('ss-pegar-cuenta').textContent = '';
        $('ss-chk-reemplazar').checked = activa().filas.every((f) => Core.filaEnBlanco(f));
        if (root.bootstrap && root.bootstrap.Modal) root.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        setTimeout(() => $('ss-txt-pegar').focus(), 250);
    }

    function enganches() {
        const cont = $(ID_CONTENEDOR);

        cont.addEventListener('input', (ev) => {
            const el = ev.target;
            if (el.dataset.enc) {
                activa().encabezado[el.dataset.enc] = el.dataset.enc === 'iata' ? el.value.toUpperCase() : el.value;
                cambio();
            } else if (el.dataset.op) {
                activa().opciones[el.dataset.op] = el.dataset.op === 'estacion' ? el.value.toUpperCase() : el.value;
                cambio();
            }
        });
        cont.addEventListener('change', (ev) => {
            const el = ev.target;
            const sol = activa();
            if (el.dataset.enc === 'fecha') {
                sol.encabezado.fecha = Core.normalizarFecha(el.value) || el.value;
                el.value = fechaVista(sol.encabezado.fecha, true);
                cambio(true);
            } else if (el.dataset.bloque) {
                const v = Math.round(Number(el.value));
                const ruta = el.dataset.bloque;
                if (v > 0) { sol.bloques[ruta] = v; estado.almacen.bloques[ruta] = v; }
                else { delete sol.bloques[ruta]; delete estado.almacen.bloques[ruta]; }
                cambio(true);
            } else if (el.dataset.huso) {
                const h = Core.normalizarHuso(el.value);
                const e = el.dataset.huso;
                if (h) { sol.husos[e] = h; estado.almacen.husos[e] = h; }
                else { delete sol.husos[e]; delete estado.almacen.husos[e]; }
                cambio(true);
            } else if (el.dataset.op) cambio(true);
        });

        cont.addEventListener('click', (ev) => {
            const ir = ev.target.closest('[data-ir-fila]');
            if (ir) {
                const tr = document.querySelector(`#ss-tbody tr[data-fila="${ir.dataset.irFila}"]`);
                if (tr) {
                    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    tr.classList.add('ss-fila-foco');
                    setTimeout(() => tr.classList.remove('ss-fila-foco'), 1600);
                    const primero = tr.querySelector('[data-campo="mov"]');
                    if (primero) primero.focus({ preventScroll: true });
                }
                return;
            }
            const tab = ev.target.closest('[data-ss-tab]');
            if (tab) {
                cont.querySelectorAll('[data-ss-tab]').forEach((b) => b.classList.toggle('active', b === tab));
                cont.querySelectorAll('[data-ss-panel]').forEach((p) => { p.hidden = p.dataset.ssPanel !== tab.dataset.ssTab; });
            }
        });

        $('ss-sel-solicitud').addEventListener('change', (ev) => {
            estado.almacen.activa = ev.target.value;
            guardarAlmacen(); pintarTodo();
        });
        $('ss-btn-nueva').addEventListener('click', () => {
            agregarSolicitud(Core.nuevaSolicitud()); guardarAlmacen(); pintarTodo();
            $('ss-h-aerolinea').focus();
        });
        $('ss-btn-duplicar').addEventListener('click', () => {
            const copia = JSON.parse(JSON.stringify(activa()));
            copia.id = Core.nuevaSolicitud().id;
            copia.encabezado.revision = copia.encabezado.revision ? String(+copia.encabezado.revision + 1 || copia.encabezado.revision) : '';
            agregarSolicitud(copia); guardarAlmacen(); pintarTodo();
            aviso('Solicitud duplicada.', 'success');
        });
        $('ss-btn-eliminar').addEventListener('click', () => {
            const sol = activa();
            const nombre = [sol.encabezado.iata, sol.encabezado.aerolinea].filter(Boolean).join(' · ') || 'esta solicitud';
            if (!root.confirm(`¿Eliminar ${nombre}? No se puede deshacer.`)) return;
            delete estado.almacen.solicitudes[sol.id];
            const ids = Object.keys(estado.almacen.solicitudes);
            if (ids.length) estado.almacen.activa = ids[ids.length - 1];
            else agregarSolicitud(Core.nuevaSolicitud());
            guardarAlmacen(); pintarTodo();
        });

        $('ss-btn-renglon').addEventListener('click', () => {
            const sol = activa();
            sol.filas.push(nuevaFilaPropuesta(sol.filas[sol.filas.length - 1]));
            pintarTabla(); cambio(true); enfocar(sol.filas.length - 1, 'mov');
        });
        $('ss-btn-pareja').addEventListener('click', () => {
            const sol = activa();
            const base = nuevaFilaPropuesta(sol.filas[sol.filas.length - 1]);
            sol.filas = sol.filas.filter((f) => !Core.filaEnBlanco(f));
            sol.filas.push(Object.assign({}, base, { mov: 'C' }), Object.assign({}, base, { mov: 'R' }));
            pintarTabla(); cambio(true); enfocar(sol.filas.length - 2, 'vueloLlega');
        });
        $('ss-btn-limpiar-vacios').addEventListener('click', () => {
            const sol = activa();
            sol.filas = sol.filas.filter((f) => !Core.filaEnBlanco(f));
            pintarTabla(); cambio(true);
        });

        $('ss-btn-excel').addEventListener('click', () => $('ss-file-excel').click());
        $('ss-file-excel').addEventListener('change', (ev) => {
            const f = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (f) importarExcel(f);
        });
        $('ss-btn-importar-json').addEventListener('click', () => $('ss-file-json').click());
        $('ss-file-json').addEventListener('change', (ev) => {
            const f = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (f) importarJson(f);
        });
        $('ss-btn-exportar-json').addEventListener('click', () => {
            const sol = solicitudEfectiva();
            const e = sol.encabezado;
            const nombre = `${e.iata || 'SOLICITUD'}_solicitud_slots_${(e.fecha || '').replace(/-/g, '')}${e.control ? '_' + String(e.control).replace(/[^A-Za-z0-9]+/g, '') : ''}.json`;
            descargar(nombre, JSON.stringify({ formato: 'aifa-solicitud-slots', version: 1, ...sol }, null, 2), 'application/json');
        });

        $('ss-btn-pegar').addEventListener('click', abrirPegar);
        $('ss-txt-pegar').addEventListener('input', (ev) => {
            const n = Core.parsearPegado(ev.target.value).length;
            $('ss-pegar-cuenta').textContent = n ? `${n} renglón(es) reconocidos` : 'Ningún renglón reconocido todavía';
        });
        $('ss-btn-pegar-aceptar').addEventListener('click', () => {
            const filas = Core.parsearPegado($('ss-txt-pegar').value);
            if (!filas.length) { $('ss-pegar-cuenta').textContent = 'Ningún renglón reconocido: deben empezar con N, D, C o R.'; return; }
            const reemplazar = $('ss-chk-reemplazar').checked;
            insertarFilas(filas, reemplazar ? 0 : activa().filas.length, reemplazar);
            if (root.bootstrap && root.bootstrap.Modal) root.bootstrap.Modal.getOrCreateInstance($('ss-modal-pegar')).hide();
        });

        $('ss-btn-descargar').addEventListener('click', () => {
            const g = estado.generado;
            if (!g || !g.ok) return;
            descargar(g.nombre, g.texto, 'text/plain;charset=us-ascii');
            aviso(`Descargado ${g.nombre}`, 'success');
        });
        $('ss-btn-copiar').addEventListener('click', async () => {
            const g = estado.generado;
            if (!g || !g.ok) return;
            try { await navigator.clipboard.writeText(g.texto); aviso('SSIM copiado al portapapeles.', 'success'); }
            catch (_) { aviso('El navegador no permitió copiar; usa Descargar.', 'warning'); }
        });

        enganchesTabla();
    }

    function pintarTodo() {
        pintarSelectorSolicitudes();
        pintarEncabezado();
        pintarTabla();
        analizarYPintar();
    }

    // ── Montaje ─────────────────────────────────────────────────────────────

    function montar() {
        if (estado.montado) return;
        const cont = $(ID_CONTENEDOR);
        if (!cont) return;
        cont.innerHTML = plantilla();
        estado.montado = true;
        cargarAlmacen();
        enganches();
        pintarTodo();
        cargarCatalogos();
    }

    function enganchar() {
        const cont = $(ID_CONTENEDOR);
        if (!cont) { console.warn(`[SSIM Slots] No existe #${ID_CONTENEDOR} en el documento.`); return; }
        if (cont.classList.contains('active')) montar();
        new MutationObserver(() => { if (cont.classList.contains('active')) montar(); })
            .observe(cont, { attributes: true, attributeFilter: ['class'] });
    }

    root.SsimSlots = { montar, estado };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar);
    else enganchar();
})(typeof window !== 'undefined' ? window : globalThis);
