/* Armazón del módulo de Aviación General / FBO.
 *
 * Este archivo NO pinta ninguna pantalla. Lo que hace es:
 *   · construir la sección (encabezado, barra de filtros, pestañas);
 *   · guardar el estado que todas las pantallas comparten —los filtros y el
 *     nivel de acceso— en un solo lugar;
 *   · ofrecer un registro al que cada pantalla se apunta cuando se carga.
 *
 * POR QUÉ UN REGISTRO Y NO UNA LISTA DE PESTAÑAS ESCRITA AQUÍ
 *
 *   Porque así agregar una pantalla nueva es crear un archivo y una etiqueta de
 *   <script>, sin volver a tocar el armazón. Si mañana Aviación General pide
 *   "Combustible cargado" o "Pernoctas", el archivo nuevo se registra y
 *   aparece; si un archivo no se carga, su pestaña simplemente no existe y el
 *   resto del módulo sigue funcionando. Es la misma idea que sostiene al módulo
 *   estadístico: núcleo puro, capa de datos y pantallas, separados.
 *
 * ARRANQUE
 *
 *   La sección se monta la primera vez que se entra a ella, no al cargar el
 *   portal. Se detecta con un MutationObserver sobre la clase `active` del
 *   contenedor, deliberadamente en vez de tocar showSection() en script.js:
 *   el módulo se acopla a la aplicación sin que la aplicación tenga que saber
 *   que este módulo existe.
 */
(function (root) {
    'use strict';

    const Core = root.AviacionGeneralCore;
    const Datos = root.AviacionGeneralDatos;

    if (!Core || !Datos) {
        console.error('[Aviación General] Falta core.js o datos.js: el módulo no puede arrancar.');
        return;
    }

    const SECCION = 'aviacion-general';
    const ID_CONTENEDOR = 'aviacion-general-section';

    // ── Estado compartido ───────────────────────────────────────────────────
    const estado = {
        montado: false,
        nivel: 'read',
        filtros: Object.assign(Core.filtrosVacios(), Core.rangoAnioActual()),
        opciones: null,
        vistaActiva: null,
        // Pantallas ya pintadas con los filtros vigentes. Cambiar un filtro
        // vacía este conjunto: así cada pestaña vuelve a consultar cuando se
        // abre, y ninguna consulta de más mientras está escondida.
        frescas: new Set()
    };

    const vistas = [];
    const oyentes = {};

    // ── Utilidades que comparten todas las pantallas ────────────────────────

    const $ = (id) => document.getElementById(id);

    /** Escapa para interpolar en HTML. Todo texto que venga de la base pasa por aquí. */
    function esc(valor) {
        return String(valor === null || valor === undefined ? '' : valor)
            .replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    }

    function aviso(mensaje, tipo) {
        if (typeof root.showNotification === 'function') {
            root.showNotification(mensaje, tipo || 'info');
        } else {
            console.log(`[Aviación General] ${mensaje}`);
        }
    }

    /**
     * Un error de red o de permisos no debe dejar la pantalla en blanco: se
     * escribe dentro del propio panel, donde el usuario está mirando, y además
     * se manda a la consola completo para quien tenga que diagnosticarlo.
     */
    function pintarError(contenedor, error) {
        console.error('[Aviación General]', error);
        const msg = esc(error && error.message ? error.message : String(error));
        if (contenedor) {
            contenedor.innerHTML = `
                <div class="alert alert-danger d-flex align-items-start gap-2 m-0">
                    <i class="fas fa-triangle-exclamation mt-1"></i>
                    <div>
                        <div class="fw-bold">No se pudo cargar esta pantalla</div>
                        <div class="small">${msg}</div>
                    </div>
                </div>`;
        }
    }

    function cargando(texto) {
        return `<div class="ag-vacio"><div class="spinner-border text-info mb-2" role="status"></div>
                <div class="small">${esc(texto || 'Consultando…')}</div></div>`;
    }

    function vacio(texto, icono) {
        return `<div class="ag-vacio"><i class="fas ${esc(icono || 'fa-plane-slash')}"></i>
                <div>${esc(texto)}</div></div>`;
    }

    // ── Niveles de acceso ───────────────────────────────────────────────────
    //
    // El nivel lo dicta el RBAC del portal, igual que en el resto de los
    // módulos. Con RLS apagado esto oculta botones pero NO protege la tabla:
    // está asumido y documentado en la migración 046. El día que se encienda
    // RLS, la base vuelve a ser la autoridad y esto queda como cortesía visual.

    function leerNivel() {
        try {
            if (typeof root.sectionLevel === 'function') {
                return String(root.sectionLevel(SECCION) || 'read');
            }
        } catch (_) { /* sin sesión todavía */ }
        return 'read';
    }

    const puedeCapturar = () => ['admin', 'edit', 'capture'].includes(estado.nivel);
    const puedeEditar   = () => ['admin', 'edit'].includes(estado.nivel);
    const puedeValidar  = () => ['admin', 'edit'].includes(estado.nivel);
    const puedeAdmin    = () => estado.nivel === 'admin';

    // ── Bus de eventos interno ──────────────────────────────────────────────

    function on(evento, fn) { (oyentes[evento] = oyentes[evento] || []).push(fn); }
    function emit(evento, carga) {
        (oyentes[evento] || []).forEach((fn) => {
            try { fn(carga); } catch (e) { console.warn('[Aviación General] oyente falló', evento, e); }
        });
    }

    // ── Registro de pantallas ───────────────────────────────────────────────

    /**
     * Cada pantalla se registra con:
     *   id        — sufijo del panel (#ag-pane-<id>)
     *   etiqueta  — texto de la pestaña
     *   icono     — clase de Font Awesome
     *   orden     — posición en la barra de pestañas
     *   montar    — se llama UNA vez, con el elemento del panel
     *   refrescar — se llama cada vez que la pestaña se abre con datos viejos
     *   visible   — opcional: función que decide si la pestaña se muestra
     */
    function registrarVista(def) {
        if (!def || !def.id || typeof def.montar !== 'function') {
            console.warn('[Aviación General] Registro de vista inválido', def);
            return;
        }
        vistas.push(Object.assign({ orden: 100, icono: 'fa-circle', visible: () => true }, def));
        vistas.sort((a, b) => a.orden - b.orden);
        // Si el módulo ya estaba montado (un archivo que llegó tarde), se
        // reconstruyen las pestañas para que la pantalla nueva aparezca.
        if (estado.montado) construirPestanas();
    }

    // ── Construcción de la sección ──────────────────────────────────────────

    function plantilla() {
        return `
        <div class="ag-header d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div>
                <div class="ag-eyebrow"><i class="fas fa-paper-plane me-1"></i>GAG · Subdirección de Servicios Conexos</div>
                <h2>Aviación General · FBO</h2>
                <p class="ag-sub">Captura, consulta y resguardo del histórico de movimientos de aviación general.</p>
            </div>
            <div class="d-flex align-items-center gap-2">
                <span class="ag-nivel" id="ag-nivel-badge" title="Tu nivel de acceso en este módulo">—</span>
                <button class="btn btn-sm btn-light fw-semibold" id="ag-btn-recargar" title="Volver a consultar">
                    <i class="fas fa-rotate"></i>
                </button>
            </div>
        </div>

        <div id="ag-diagnostico"></div>

        <div class="ag-filtros">
            <div class="row g-2 align-items-end">
                <div class="col-6 col-md-2">
                    <label for="ag-f-desde">Desde</label>
                    <input type="date" class="form-control form-control-sm" id="ag-f-desde">
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-hasta">Hasta</label>
                    <input type="date" class="form-control form-control-sm" id="ag-f-hasta">
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-tipo">Movimiento</label>
                    <select class="form-select form-select-sm" id="ag-f-tipo">
                        <option value="">Todos</option>
                        <option value="LLEGADA">Llegadas</option>
                        <option value="SALIDA">Salidas</option>
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-ambito">Ámbito</label>
                    <select class="form-select form-select-sm" id="ag-f-ambito">
                        <option value="">Todos</option>
                        <option value="NACIONAL">Nacional</option>
                        <option value="INTERNACIONAL">Internacional</option>
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-validacion">Validación</label>
                    <select class="form-select form-select-sm" id="ag-f-validacion">
                        <option value="">Todas</option>
                        <option value="PENDIENTE">Pendientes</option>
                        <option value="VALIDADO">Validados</option>
                        <option value="OBSERVADO">Observados</option>
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-estatus">Estatus</label>
                    <select class="form-select form-select-sm" id="ag-f-estatus">
                        <option value="ACTIVO">Activos</option>
                        <option value="ANULADO">Anulados</option>
                        <option value="TODOS">Todos</option>
                    </select>
                </div>
                <div class="col-12 col-md-3">
                    <label for="ag-f-operador">Operador</label>
                    <input type="text" class="form-control form-control-sm" id="ag-f-operador"
                           list="ag-dl-operadores" placeholder="Nombre del operador">
                    <datalist id="ag-dl-operadores"></datalist>
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-matricula">Matrícula</label>
                    <input type="text" class="form-control form-control-sm" id="ag-f-matricula"
                           list="ag-dl-matriculas" placeholder="XA-…">
                    <datalist id="ag-dl-matriculas"></datalist>
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-aeronave">Tipo de aeronave</label>
                    <input type="text" class="form-control form-control-sm" id="ag-f-aeronave"
                           list="ag-dl-aeronaves" placeholder="G650, C421…">
                    <datalist id="ag-dl-aeronaves"></datalist>
                </div>
                <div class="col-6 col-md-2">
                    <label for="ag-f-aeropuerto">Origen / destino</label>
                    <input type="text" class="form-control form-control-sm" id="ag-f-aeropuerto"
                           list="ag-dl-aeropuertos" placeholder="MMTO, MMGL…">
                    <datalist id="ag-dl-aeropuertos"></datalist>
                </div>
                <div class="col-12 col-md-3">
                    <label for="ag-f-texto">Búsqueda libre</label>
                    <input type="search" class="form-control form-control-sm" id="ag-f-texto"
                           placeholder="Operador, matrícula, observaciones…">
                </div>
                <div class="col-12 d-flex flex-wrap gap-2 align-items-center pt-1">
                    <button class="btn btn-sm btn-info text-white fw-semibold" id="ag-btn-aplicar">
                        <i class="fas fa-filter me-1"></i>Aplicar
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" id="ag-btn-limpiar">
                        <i class="fas fa-eraser me-1"></i>Limpiar
                    </button>
                    <span class="ms-auto small text-muted" id="ag-filtros-resumen"></span>
                </div>
            </div>
        </div>

        <ul class="nav ag-tabs mb-3" id="ag-tabs" role="tablist"></ul>
        <div class="tab-content" id="ag-tab-content"></div>`;
    }

    function construirPestanas() {
        const barra = $('ag-tabs');
        const contenido = $('ag-tab-content');
        if (!barra || !contenido) return;

        const disponibles = vistas.filter((v) => {
            try { return v.visible(); } catch (_) { return true; }
        });

        barra.innerHTML = disponibles.map((v, i) => `
            <li class="nav-item" role="presentation">
                <button class="nav-link ${i === 0 ? 'active' : ''}" id="ag-tab-${esc(v.id)}"
                        data-ag-vista="${esc(v.id)}" type="button" role="tab">
                    <i class="fas ${esc(v.icono)} me-1"></i>${esc(v.etiqueta)}
                    <span class="badge bg-secondary ms-1 d-none" id="ag-badge-${esc(v.id)}"></span>
                </button>
            </li>`).join('');

        // Los paneles ya montados se conservan: reconstruir las pestañas no
        // debe tirar el trabajo hecho (una captura a medias, por ejemplo).
        disponibles.forEach((v, i) => {
            let panel = $(`ag-pane-${v.id}`);
            if (!panel) {
                panel = document.createElement('div');
                panel.id = `ag-pane-${v.id}`;
                panel.className = 'tab-pane fade';
                panel.setAttribute('role', 'tabpanel');
                contenido.appendChild(panel);
            }
            panel.classList.toggle('show', i === 0);
            panel.classList.toggle('active', i === 0);
        });

        barra.querySelectorAll('[data-ag-vista]').forEach((btn) => {
            btn.addEventListener('click', () => abrirVista(btn.dataset.agVista));
        });

        if (disponibles.length) abrirVista(estado.vistaActiva || disponibles[0].id);
    }

    /**
     * Abre una pantalla. La monta si es la primera vez y la refresca si sus
     * datos quedaron viejos por un cambio de filtros.
     *
     * Cada pantalla consulta cuando se abre, no cuando se entra al módulo: con
     * seis pestañas, cargarlas todas de golpe son seis viajes a la base de los
     * que el usuario normalmente sólo mira uno.
     */
    async function abrirVista(id) {
        const vista = vistas.find((v) => v.id === id);
        if (!vista) return;

        estado.vistaActiva = id;

        document.querySelectorAll('#ag-tabs .nav-link').forEach((b) => {
            b.classList.toggle('active', b.dataset.agVista === id);
        });
        document.querySelectorAll('#ag-tab-content .tab-pane').forEach((p) => {
            const activo = p.id === `ag-pane-${id}`;
            p.classList.toggle('show', activo);
            p.classList.toggle('active', activo);
        });

        const panel = $(`ag-pane-${id}`);
        if (!panel) return;

        try {
            if (!panel.dataset.montado) {
                panel.dataset.montado = '1';
                await vista.montar(panel, API);
            }
            if (!estado.frescas.has(id) && typeof vista.refrescar === 'function') {
                await vista.refrescar(panel, API);
            }
            estado.frescas.add(id);
        } catch (error) {
            pintarError(panel, error);
        }
    }

    // ── Filtros ─────────────────────────────────────────────────────────────

    function leerFiltrosDelFormulario() {
        return {
            fecha_desde:       $('ag-f-desde')?.value || '',
            fecha_hasta:       $('ag-f-hasta')?.value || '',
            tipo_operacion:    $('ag-f-tipo')?.value || '',
            ambito_operacion:  $('ag-f-ambito')?.value || '',
            estado_validacion: $('ag-f-validacion')?.value || '',
            estatus_registro:  $('ag-f-estatus')?.value || 'ACTIVO',
            operador:          ($('ag-f-operador')?.value || '').trim(),
            matricula:         ($('ag-f-matricula')?.value || '').trim(),
            tipo_aeronave:     ($('ag-f-aeronave')?.value || '').trim(),
            aeropuerto:        ($('ag-f-aeropuerto')?.value || '').trim(),
            texto:             ($('ag-f-texto')?.value || '').trim()
        };
    }

    function escribirFiltrosEnFormulario(f) {
        const asigna = (id, valor) => { const el = $(id); if (el) el.value = valor || ''; };
        asigna('ag-f-desde', f.fecha_desde);
        asigna('ag-f-hasta', f.fecha_hasta);
        asigna('ag-f-tipo', f.tipo_operacion);
        asigna('ag-f-ambito', f.ambito_operacion);
        asigna('ag-f-validacion', f.estado_validacion);
        asigna('ag-f-estatus', f.estatus_registro || 'ACTIVO');
        asigna('ag-f-operador', f.operador);
        asigna('ag-f-matricula', f.matricula);
        asigna('ag-f-aeronave', f.tipo_aeronave);
        asigna('ag-f-aeropuerto', f.aeropuerto);
        asigna('ag-f-texto', f.texto);
    }

    function aplicarFiltros() {
        estado.filtros = leerFiltrosDelFormulario();
        // Todo lo pintado quedó viejo. La pestaña abierta se recarga ya; las
        // demás, cuando alguien las abra.
        estado.frescas.clear();
        describirFiltros();
        emit('filtros:cambiaron', estado.filtros);
        if (estado.vistaActiva) {
            const id = estado.vistaActiva;
            estado.vistaActiva = null;
            abrirVista(id);
        }
    }

    function limpiarFiltros() {
        estado.filtros = Object.assign(Core.filtrosVacios(), Core.rangoAnioActual());
        escribirFiltrosEnFormulario(estado.filtros);
        aplicarFiltros();
    }

    function describirFiltros() {
        const el = $('ag-filtros-resumen');
        if (!el) return;
        const f = estado.filtros;
        const partes = [];
        if (f.fecha_desde || f.fecha_hasta) {
            partes.push(`${f.fecha_desde ? Core.fechaLarga(f.fecha_desde) : 'inicio'} — ${f.fecha_hasta ? Core.fechaLarga(f.fecha_hasta) : 'hoy'}`);
        }
        if (f.tipo_operacion)    partes.push(f.tipo_operacion === 'LLEGADA' ? 'llegadas' : 'salidas');
        if (f.ambito_operacion)  partes.push(f.ambito_operacion.toLowerCase());
        if (f.estado_validacion) partes.push(f.estado_validacion.toLowerCase());
        if (f.estatus_registro && f.estatus_registro !== 'ACTIVO') partes.push(f.estatus_registro.toLowerCase());
        ['operador', 'matricula', 'tipo_aeronave', 'aeropuerto', 'texto'].forEach((k) => {
            if (f[k]) partes.push(`${k.replace('_', ' ')}: ${f[k]}`);
        });
        el.textContent = partes.length ? partes.join(' · ') : 'Sin filtros';
    }

    /** Rellena los datalist con lo que realmente existe en la tabla. */
    async function cargarOpciones() {
        try {
            estado.opciones = await Datos.opciones();
        } catch (error) {
            console.warn('[Aviación General] No se pudieron cargar los catálogos:', error);
            return;
        }
        const llenar = (idLista, valores) => {
            const dl = $(idLista);
            if (!dl) return;
            dl.innerHTML = (valores || []).map((v) => `<option value="${esc(v)}"></option>`).join('');
        };
        llenar('ag-dl-operadores', estado.opciones.operadores);
        llenar('ag-dl-matriculas', estado.opciones.matriculas);
        llenar('ag-dl-aeronaves', estado.opciones.tipos_aeronave);
        llenar('ag-dl-aeropuertos', estado.opciones.aeropuertos);
    }

    /**
     * Si la migración no está aplicada, decirlo con todas sus letras y con el
     * nombre del archivo que hay que correr. Es el error más probable la
     * primera vez que alguien abre el módulo en un entorno nuevo, y el más
     * fácil de arreglar si se explica.
     */
    async function revisarInstalacion() {
        const caja = $('ag-diagnostico');
        if (!caja) return true;
        const d = await Datos.diagnostico();
        if (d.tabla && d.funciones) { caja.innerHTML = ''; return true; }

        caja.innerHTML = `
            <div class="alert alert-warning d-flex align-items-start gap-2">
                <i class="fas fa-database mt-1"></i>
                <div>
                    <div class="fw-bold">El módulo no está instalado completo en la base de datos</div>
                    <div class="small">${esc(d.mensaje || 'Faltan objetos en PostgreSQL.')}</div>
                    <div class="small mt-1">
                        Aplicar <code>supabase/migrations/046_aviacion_general_fbo.sql</code>
                        (se corre completo, se revisa la verificación y se cambia
                        <code>ROLLBACK</code> por <code>COMMIT</code>).
                    </div>
                </div>
            </div>`;
        return false;
    }

    // ── API que se entrega a cada pantalla ──────────────────────────────────

    const API = {
        SECCION,
        Core,
        Datos,
        estado,
        $, esc, aviso, pintarError, cargando, vacio,
        on, emit,
        registrarVista,
        puedeCapturar, puedeEditar, puedeValidar, puedeAdmin,
        get filtros() { return Object.assign({}, estado.filtros); },
        get nivel() { return estado.nivel; },
        get opciones() { return estado.opciones || {}; },

        /** Marca todas las pantallas como viejas y recarga la que está abierta. */
        invalidar() {
            estado.frescas.clear();
            if (estado.vistaActiva) {
                const id = estado.vistaActiva;
                estado.vistaActiva = null;
                abrirVista(id);
            }
        },

        /** Contador junto al nombre de una pestaña (p. ej. pendientes por validar). */
        marcador(idVista, texto, clase) {
            const b = $(`ag-badge-${idVista}`);
            if (!b) return;
            if (texto === null || texto === undefined || texto === '') {
                b.classList.add('d-none');
                return;
            }
            b.textContent = texto;
            b.className = `badge ms-1 ${clase || 'bg-secondary'}`;
        },

        abrirVista,
        recargarOpciones: cargarOpciones
    };

    // ── Montaje ─────────────────────────────────────────────────────────────

    async function montar() {
        if (estado.montado) return;
        const contenedor = $(ID_CONTENEDOR);
        if (!contenedor) return;

        estado.montado = true;
        estado.nivel = leerNivel();
        contenedor.innerHTML = plantilla();

        const badge = $('ag-nivel-badge');
        if (badge) {
            const etiquetas = {
                admin: 'Administrador', edit: 'Edición', capture: 'Captura',
                read: 'Sólo lectura', none: 'Sin acceso'
            };
            badge.textContent = etiquetas[estado.nivel] || estado.nivel;
        }

        escribirFiltrosEnFormulario(estado.filtros);
        describirFiltros();

        $('ag-btn-aplicar')?.addEventListener('click', aplicarFiltros);
        $('ag-btn-limpiar')?.addEventListener('click', limpiarFiltros);
        $('ag-btn-recargar')?.addEventListener('click', () => { cargarOpciones(); API.invalidar(); });

        // Enter en cualquier campo de texto aplica: teclear y tener que ir a
        // buscar el botón con el ratón es exactamente lo que hace que la gente
        // deje de usar los filtros.
        ['ag-f-operador', 'ag-f-matricula', 'ag-f-aeronave', 'ag-f-aeropuerto', 'ag-f-texto'].forEach((id) => {
            $(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicarFiltros(); });
        });
        ['ag-f-desde', 'ag-f-hasta', 'ag-f-tipo', 'ag-f-ambito', 'ag-f-validacion', 'ag-f-estatus'].forEach((id) => {
            $(id)?.addEventListener('change', aplicarFiltros);
        });

        construirPestanas();

        const listo = await revisarInstalacion();
        if (listo) await cargarOpciones();
    }

    /**
     * Se engancha a la sección sin tocar showSection().
     *
     * El observador vigila la clase `active` del contenedor, que es lo que la
     * navegación del portal cambia al entrar. Así el módulo no depende de que
     * alguien recuerde agregarle un hook en script.js, y script.js no necesita
     * enterarse de que este módulo existe.
     */
    function enganchar() {
        const contenedor = $(ID_CONTENEDOR);
        if (!contenedor) {
            console.warn(`[Aviación General] No existe #${ID_CONTENEDOR} en el documento.`);
            return;
        }

        if (contenedor.classList.contains('active')) montar();

        new MutationObserver(() => {
            if (contenedor.classList.contains('active')) montar();
        }).observe(contenedor, { attributes: true, attributeFilter: ['class'] });

        // El nivel de acceso puede llegar después del montaje (la sesión se
        // resuelve de forma asíncrona). Cuando cambie, se vuelve a preguntar y
        // se reconstruyen las pestañas por si alguna dejó de aplicar.
        root.addEventListener('admin-mode-changed', () => {
            const nuevo = leerNivel();
            if (nuevo === estado.nivel || !estado.montado) return;
            estado.nivel = nuevo;
            const badge = $('ag-nivel-badge');
            if (badge) badge.textContent = nuevo;
            construirPestanas();
            emit('nivel:cambio', nuevo);
        });
    }

    root.AviacionGeneral = API;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enganchar);
    } else {
        enganchar();
    }
})(typeof window !== 'undefined' ? window : globalThis);
