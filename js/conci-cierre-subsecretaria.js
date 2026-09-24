/**
 * conci-cierre-subsecretaria.js
 * Cierre de Subsecretaría de Conciliación > Manifiestos: corte manual que se
 * lleva TODOS los manifiestos capturados y aún no cerrados —sea cual sea la
 * fecha de operación de cada vuelo—, les escribe la fecha del corte en
 * "CIERRE SUBSECRETARIA", los congela en un snapshot y bloquea su edición.
 * Una corrección autorizada posterior no reescribe el histórico: registra un
 * evento con la fila completa antes y después, y ese evento entra (una sola
 * vez) al siguiente corte.
 *
 * DOS FECHAS DISTINTAS: "FECHA" es la de la operación; "CIERRE SUBSECRETARIA"
 * es la del informe en que se reportó. Un vuelo del 21 capturado el 22 se
 * cierra en el corte del 22. Por eso este módulo NUNCA manda al RPC la fecha
 * del filtro de la tabla.
 *
 * La lógica de negocio (candado, snapshot, ajustes, consumo, atomicidad,
 * privilegios, reautenticación) vive en Postgres — ver
 * supabase/migrations/053_conciliacion_cierre_subsecretaria.sql y sus RPC:
 * conciliacion_cerrar_subsecretaria, conciliacion_solicitar_correccion,
 * conciliacion_resolver_solicitud_correccion, conciliacion_resumen_lote_abierto,
 * conciliacion_ajustes_detalle, conciliacion_solicitudes_pendientes. Este
 * módulo es solo interfaz; nunca decide privilegios ni calcula ajustes por
 * su cuenta — solo interpreta lo que el RPC devuelve, y lo que decide aquí
 * (qué botones mostrar) es SOLO UX: la BD vuelve a exigir todo del lado
 * servidor sin importar qué haga este archivo.
 *
 * Autorización: no existen roles "Supervisor"/"Jefe en turno" en el sistema.
 * Se usan DOS privilegios granulares independientes (misma arquitectura
 * JSONB que ya usa section_levels): permissions.conciliacion_cierra_subsecretaria
 * (realizar el corte diario) y permissions.conciliacion_autoriza_correccion
 * (resolver correcciones sobre manifiestos ya cerrados) — admin/superadmin
 * tienen ambos implícitos; cualquier otro usuario puede recibir uno, el
 * otro, o ninguno, sin volverse admin de todo el sistema. Quien NO tiene el
 * segundo puede igualmente levantar una SOLICITUD de corrección; queda
 * pendiente hasta que alguien con ese privilegio la aprueba o rechaza (con
 * su propia sesión, su propia reautenticación).
 */
(function () {
    'use strict';

    const esc = (v) => (typeof window.escapeHTML === 'function') ? window.escapeHTML(v) : String(v ?? '');

    // Mismas listas que _conci_campos_editables_cierre() / _conci_campos_numericos_cierre()
    // en la migración 053 — aquí solo para poblar el <select> del modal; la
    // whitelist real (la que importa para seguridad) se valida en el RPC.
    //
    // "CIERRE SUBSECRETARIA" NO está y no debe volver: desde el nuevo
    // mecanismo la escribe el sistema con la fecha del corte. Nadie mueve una
    // fila de un corte a otro editando una celda.
    const CAMPOS_EDITABLES = [
        'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA',
        'TIPO DE OPERACIÓN', 'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO',
        'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO', 'SLOT COORDINADO',
        'HR. DE INICIO O TERMINO DE PERNOCTA', 'HR. DE EMBARQUE O DESEMBARQUE',
        'HR. DE OPERACIÓN', 'HR. MÁXIMA DE ENTREGA', 'HR. DE RECEPCIÓN', 'HRS. CUMPLIDAS',
        'TOTAL PAX', 'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS', 'CONEXIONES',
        'OTROS EXENTOS', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'KGS. DE EQUIPAJE',
        'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL', 'CORREO',
        'PUNTUALIDAD / CANCELACIÓN', 'DEMORA +- 15 MIN.', 'CÓDIGO DEMORA', 'OBSERVACIONES',
        'CAPTURÓ', 'CAPACIDAD MÁXIMA', 'FACTOR DE OCUPACIÓN', 'EVIDENCIA', 'Hora y Fecha Generación'
    ];
    // Debe coincidir EXACTAMENTE con _conci_campos_numericos_cierre() del SQL
    // (hay una prueba que lo verifica). Son los campos que MUEVEN TOTALES.
    // Ojo: TODA corrección autorizada genera un evento del ledger, numérica o
    // no —una reclasificación de TIPO DE OPERACIÓN cambia el informe sin
    // cambiar ningún total—; esta lista solo sirve para etiquetar en el
    // desplegable cuáles además mueven una cifra.
    const CAMPOS_NUMERICOS = new Set([
        'TOTAL PAX', 'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS', 'CONEXIONES',
        'OTROS EXENTOS', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'KGS. DE EQUIPAJE',
        'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL',
        'CORREO'
    ]);

    let _cierreRowMap = new Map();   // manifiesto id (string) -> cierre_id
    let _previoPax = 0;
    let _fijoData = null;            // último resultado de conciliacion_resumen_lote_abierto
    let _cargandoLote = false;       // evita pedir el mismo resumen dos veces a la vez

    /* ── Privilegios (solo UX — la BD vuelve a exigirlos siempre) ── */
    function _conciEsAdminGlobal() {
        const role = (typeof window._conciCurrentUserRole === 'function') ? window._conciCurrentUserRole() : '';
        return role === 'admin' || role === 'superadmin';
    }

    // Puede realizar el Cierre de Subsecretaría: admin/superadmin, o
    // permissions.conciliacion_cierra_subsecretaria = true.
    function puedeCerrar() {
        if (_conciEsAdminGlobal()) return true;
        try {
            return window.dataManager?.permissions?.conciliacion_cierra_subsecretaria === true;
        } catch (_) {
            return false;
        }
    }

    // Puede aplicar/resolver correcciones sobre manifiestos cerrados:
    // admin/superadmin, o permissions.conciliacion_autoriza_correccion = true.
    // Privilegio distinto de puedeCerrar(): cerrar el día es una acción
    // rutinaria; autorizar una corrección retroactiva a un informe ya
    // oficial es más sensible y puede recaer en otra persona.
    function puedeAutorizarCorreccion() {
        if (_conciEsAdminGlobal()) return true;
        try {
            return window.dataManager?.permissions?.conciliacion_autoriza_correccion === true;
        } catch (_) {
            return false;
        }
    }

    // Puede levantar una solicitud de corrección sobre un manifiesto cerrado
    // (aunque no tenga privilegio para resolverla ella misma): cualquiera que
    // ya pueda capturar/editar Manifiestos hoy.
    function puedeSolicitarCorreccion() {
        return typeof window._conciCanCurrentUserEdit === 'function' ? window._conciCanCurrentUserEdit() : false;
    }

    function bsModal(id) {
        const el = document.getElementById(id);
        if (!el || !window.bootstrap) return null;
        return window.bootstrap.Modal.getOrCreateInstance(el);
    }

    function fmt(n) {
        return (Number(n) || 0).toLocaleString('es-MX');
    }

    // Nota deliberada: aquí NO hay ninguna función que lea el filtro de fecha
    // de la tabla. El corte no se decide por la fecha que el usuario esté
    // mirando —ésa es una fecha de OPERACIÓN— sino por el lote pendiente, y su
    // fecha de informe la pone el servidor. Reintroducir un
    // "fechaSeleccionadaIso()" aquí volvería a meter el error de origen.

    async function reautenticar(password) {
        const email = sessionStorage.getItem('currentUser') || '';
        const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw new Error('Contraseña incorrecta. No se realizó ningún cambio.');
    }

    /**
     * Avisa de que los datos de Manifiestos cambiaron. Lo escuchan los módulos
     * de Reportes (pasajeros y carga) para tirar su caché: si no, después de un
     * cierre o de una corrección seguirían sirviendo las filas que descargaron
     * antes, porque su caché sólo compara la fecha pedida. Se emite tras cada
     * escritura CONFIRMADA, nunca "por si acaso": el objetivo es que la caché
     * no sobreviva a una modificación, no dejar de cachear.
     *
     * script.js emite el mismo evento desde sus propios puntos de escritura
     * confirmada (_conciWriteRowSafe y _conciEliminarRegistro); aquí se usa la
     * función que expone, y si no estuviera se emite igual desde este módulo.
     */
    function notificarManifiestosCambiaron() {
        try {
            if (typeof window._conciNotificarManifiestosCambiaron === 'function') {
                window._conciNotificarManifiestosCambiaron();
                return;
            }
            window.dispatchEvent(new CustomEvent('conciliacion:manifiestos-cambiaron'));
        } catch (_) { /* nunca debe tumbar el flujo que acaba de guardar */ }
    }

    /* ── Tarjetas FIJO / PREVIO / TOTAL ──────────────────────────────────
     * FIJO   = el LOTE que entraría al próximo corte (todo lo capturado y aún
     *          no cerrado) más el efecto neto de los ajustes pendientes. No es
     *          un día: el lote no se define por fecha de operación, igual que
     *          el corte. Lo calcula el servidor con la MISMA aritmética que
     *          después verá el informe (−antes +después), así que el KPI y el
     *          oficio no pueden divergir.
     * PREVIO = vuelos programados sin manifiesto capturado ("Solo Vuelos") de
     *          lo que hay en pantalla; lo calcula el cliente al recibir las
     *          filas ya enriquecidas.
     * TOTAL  = FIJO + PREVIO.
     */
    function renderKpiCards() {
        const fijoPax = Number(_fijoData?.totales_reportados?.['TOTAL PAX']) || 0;
        const total = fijoPax + _previoPax;
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('mf-cierre-fijo', fmt(fijoPax));
        setEl('mf-cierre-previo', fmt(_previoPax));
        setEl('mf-cierre-total', fmt(total));

        const fijoCard = document.getElementById('mf-cierre-card-fijo');
        if (fijoCard) {
            const n = Number(_fijoData?.total_manifiestos) || 0;
            const ajustes = Number(_fijoData?.ajustes_pendientes) || 0;
            const ultimo = _fijoData?.ultimo_cierre;
            const cola = ultimo
                ? ` Último corte: ${ultimo.fecha_corte || ''} (${ultimo.total_manifiestos || 0} manifiestos), por ${ultimo.cerrado_por_nombre || ''}.`
                : ' Todavía no se ha realizado ningún Cierre de Subsecretaría.';
            fijoCard.title = `Lote pendiente del próximo Cierre de Subsecretaría: ${n} manifiestos capturados`
                + (ajustes ? ` y ${ajustes} ajuste(s) de cortes anteriores por aplicar.` : ', sin ajustes por aplicar.')
                + cola;
        }
        ['mf-cierre-card-fijo', 'mf-cierre-card-previo', 'mf-cierre-card-total'].forEach(id => {
            document.getElementById(id)?.classList.remove('d-none');
        });
    }

    async function cargarResumenLote() {
        if (!window.supabaseClient || _cargandoLote) return;
        _cargandoLote = true;
        try {
            const { data, error } = await window.supabaseClient.rpc('conciliacion_resumen_lote_abierto');
            if (error) throw error;
            _fijoData = data;
        } catch (err) {
            console.warn('[Cierre Subsecretaría] No se pudo cargar el resumen del lote abierto:', err);
        } finally {
            _cargandoLote = false;
            // Aunque el lado servidor falle, PREVIO se calcula en el cliente:
            // se pintan las tarjetas igual para no dejar la fila en blanco.
            renderKpiCards();
        }
    }

    // Hook llamado por script.js (_updateManifiestosSummaryStrip) con las
    // mismas filas ya enriquecidas (capturadas + "Solo Vuelos") que usan sus
    // propias tarjetas — así PREVIO no duplica la lógica de cruce con
    // itinerario, y el candado por fila usa el mismo cierre_id ya traído.
    window._conciCierreOnSummaryData = function (rows) {
        const list = Array.isArray(rows) ? rows : [];
        const map = new Map();
        let previoPax = 0;
        for (const row of list) {
            if (!row) continue;
            const id = String(row.id ?? '').trim();
            if (id && row.cierre_id !== undefined && row.cierre_id !== null) {
                map.set(id, row.cierre_id);
            }
            if (row._fuente === 'Solo Vuelos') {
                const pax = Number(row['TOTAL PAX']);
                if (Number.isFinite(pax)) previoPax += pax;
            }
        }
        _cierreRowMap = map;
        _previoPax = previoPax;

        // PREVIO ya está calculado con lo que acaba de llegar: se pinta de
        // inmediato, sin esperar al servidor. El FIJO se pide en paralelo y las
        // tarjetas se repintan cuando responda (o cuando falle:
        // cargarResumenLote repinta siempre).
        renderKpiCards();
        cargarResumenLote();
    };

    /* ── Icono de fila cerrada + acceso a corrección/solicitud ── */
    window._conciCierreExtraRowAction = function (group, persistedId) {
        const id = String(persistedId || '').trim();
        if (!id || !_cierreRowMap.has(id)) return;
        if (puedeSolicitarCorreccion()) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-outline-warning conci-cierre-corregir-row';
            btn.title = puedeAutorizarCorreccion()
                ? 'Manifiesto cerrado por Cierre de Subsecretaría — corregir'
                : 'Manifiesto cerrado por Cierre de Subsecretaría — solicitar corrección';
            btn.innerHTML = '<i class="fas fa-lock"></i>';
            btn.addEventListener('click', () => abrirModalCorreccion({ manifiestoId: id }));
            group.appendChild(btn);
        } else {
            const span = document.createElement('span');
            span.className = 'btn btn-outline-secondary disabled';
            span.title = 'Manifiesto cerrado por Cierre de Subsecretaría';
            span.innerHTML = '<i class="fas fa-lock"></i>';
            group.appendChild(span);
        }
    };

    /* ── Modal: Cierre de Subsecretaría (doble confirmación + contraseña) ── */
    function modalCierreEl() {
        let modal = document.getElementById('modal-conci-cierre-subsecretaria');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modal-conci-cierre-subsecretaria';
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.setAttribute('data-bs-backdrop', 'static');
        modal.innerHTML = `<div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header bg-warning">
                    <h5 class="modal-title"><i class="fas fa-lock me-2"></i>Cierre de Subsecretaría</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                </div>
                <div class="modal-body">
                    <div id="conci-cierre-paso-1">
                        <div class="alert alert-secondary py-2 px-3 small d-none" id="conci-cierre-ya-cerrado"></div>
                        <p>Está por realizar el <strong>Cierre de Subsecretaría</strong> con fecha de corte <strong id="conci-cierre-fecha-1">—</strong>.</p>
                        <p class="small text-muted mb-2" id="conci-cierre-detalle"></p>
                        <p class="mb-0">Entran <strong>todos</strong> los manifiestos capturados que todavía no se han cerrado, sea cual sea la fecha de operación de cada vuelo. Quedarán cerrados con esa fecha de corte en <em>CIERRE SUBSECRETARIA</em>, y los informes generados no podrán modificarse posteriormente.</p>
                    </div>
                    <div id="conci-cierre-paso-2" class="d-none">
                        <div class="alert alert-warning py-2 px-3 small mb-3">
                            Confirme el Cierre de Subsecretaría. Las modificaciones posteriores a los manifiestos
                            requerirán autorización y sus diferencias serán aplicadas en un informe posterior.
                        </div>
                        <label class="form-label small fw-semibold" for="conci-cierre-password">Confirme su contraseña</label>
                        <input type="password" class="form-control" id="conci-cierre-password" autocomplete="current-password">
                        <div id="conci-cierre-msg" class="small mt-2"></div>
                    </div>
                    <div id="conci-cierre-resultado" class="d-none"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-light border" data-bs-dismiss="modal" id="conci-cierre-cancelar">Cancelar</button>
                    <button type="button" class="btn btn-warning" id="conci-cierre-continuar">Continuar</button>
                    <button type="button" class="btn btn-danger d-none" id="conci-cierre-confirmar">Confirmar cierre</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);

        modal.querySelector('#conci-cierre-continuar').addEventListener('click', () => {
            modal.querySelector('#conci-cierre-paso-1').classList.add('d-none');
            modal.querySelector('#conci-cierre-paso-2').classList.remove('d-none');
            modal.querySelector('#conci-cierre-continuar').classList.add('d-none');
            modal.querySelector('#conci-cierre-confirmar').classList.remove('d-none');
            modal.querySelector('#conci-cierre-password')?.focus();
        });
        modal.querySelector('#conci-cierre-confirmar').addEventListener('click', ejecutarCierre);
        modal.addEventListener('hidden.bs.modal', () => resetModalCierre(modal));
        return modal;
    }

    function resetModalCierre(modal) {
        modal.querySelector('#conci-cierre-ya-cerrado')?.classList.add('d-none');
        modal.querySelector('#conci-cierre-continuar').disabled = false;
        modal.querySelector('#conci-cierre-paso-1').classList.remove('d-none');
        modal.querySelector('#conci-cierre-paso-2').classList.add('d-none');
        modal.querySelector('#conci-cierre-resultado').classList.add('d-none');
        modal.querySelector('#conci-cierre-resultado').innerHTML = '';
        modal.querySelector('#conci-cierre-continuar').classList.remove('d-none');
        modal.querySelector('#conci-cierre-confirmar').classList.add('d-none');
        modal.querySelector('#conci-cierre-password').value = '';
        modal.querySelector('#conci-cierre-msg').innerHTML = '';
        modal.querySelector('#conci-cierre-cancelar').textContent = 'Cancelar';
    }

    async function ejecutarCierre() {
        const modal = modalCierreEl();
        const msgEl = modal.querySelector('#conci-cierre-msg');
        const pwEl = modal.querySelector('#conci-cierre-password');
        const btnConfirmar = modal.querySelector('#conci-cierre-confirmar');
        let password = pwEl.value;
        if (!password) {
            msgEl.innerHTML = '<span class="text-danger">Ingresa tu contraseña.</span>';
            return;
        }
        btnConfirmar.disabled = true;
        msgEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Verificando contraseña…</span>';
        try {
            // Re-autenticación real contra Supabase Auth (mismo patrón que el
            // cambio de contraseña del usuario) — nunca se compara la
            // contraseña "a mano" en el cliente.
            await reautenticar(password);

            msgEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Realizando el cierre…</span>';
            // SIN parámetros. El RPC ya no acepta fecha: la pone el servidor
            // (el día en curso en México, derivado del mismo instante lógico
            // del corte). Así no hay nada que enviar desde DevTools para
            // fechar un cierre en el pasado.
            const { data, error } = await window.supabaseClient.rpc('conciliacion_cerrar_subsecretaria');
            if (error) throw error;

            const ajustes = Number(data.total_ajustes_consumidos) || 0;
            const resEl = modal.querySelector('#conci-cierre-resultado');
            resEl.classList.remove('d-none');
            resEl.innerHTML = `<div class="alert alert-success py-2 px-3 small mb-0">
                <i class="fas fa-check-circle me-1"></i>Cierre realizado con fecha <strong>${esc(data.fecha_corte)}</strong>:
                <strong>${esc(data.total_manifiestos)}</strong> manifiestos quedaron cerrados${ajustes
                    ? ` y se aplicaron <strong>${esc(ajustes)}</strong> ajuste(s) de cortes anteriores`
                    : ''}.
            </div>`;
            modal.querySelector('#conci-cierre-paso-2').classList.add('d-none');
            btnConfirmar.classList.add('d-none');
            modal.querySelector('#conci-cierre-cancelar').textContent = 'Cerrar';

            if (typeof window.loadConciliacionManifiestos === 'function') {
                window.loadConciliacionManifiestos({ forceRefresh: true, allowLocalEditsReplace: true });
            }
            notificarManifiestosCambiaron();
            cargarResumenLote();
        } catch (err) {
            msgEl.innerHTML = `<span class="text-danger">${esc(err.message || String(err))}</span>`;
        } finally {
            btnConfirmar.disabled = false;
            // La contraseña no sobrevive al intento: ni en el input ni en la
            // variable local. Nunca se guarda, ni se registra, ni viaja al RPC.
            pwEl.value = '';
            password = '';
        }
    }

    /**
     * Vuelca en el paso 1 del modal lo que dice el último resumen del lote: la
     * fecha DEL CORTE (no la del filtro de la tabla), qué entrará, y —si el
     * corte de hoy ya se hizo— que sólo se admite uno por fecha y a qué corte
     * irá lo que quede pendiente. Bloquear "Continuar" ahí es sólo claridad:
     * quien decide y rechaza sigue siendo la base de datos.
     */
    function pintarEstadoModalCierre(modal) {
        modal.querySelector('#conci-cierre-fecha-1').textContent =
            _fijoData?.siguiente_fecha_corte || new Date().toLocaleDateString('es-MX');

        const n = Number(_fijoData?.total_manifiestos) || 0;
        const ajustes = Number(_fijoData?.ajustes_pendientes) || 0;
        const detalle = modal.querySelector('#conci-cierre-detalle');
        if (detalle) {
            detalle.textContent = `Entrarán al corte ${n} manifiesto(s) capturado(s) y aún no cerrado(s)`
                + (ajustes ? `, más ${ajustes} ajuste(s) autorizado(s) de cortes anteriores.` : '.');
        }

        const yaCerradoHoy = _fijoData?.cierre_de_hoy_realizado === true;
        const aviso = modal.querySelector('#conci-cierre-ya-cerrado');
        if (aviso) {
            aviso.classList.toggle('d-none', !yaCerradoHoy);
            if (yaCerradoHoy) {
                aviso.textContent = `El Cierre de Subsecretaría del ${_fijoData?.ultimo_cierre?.fecha_corte || 'día de hoy'}`
                    + ' ya se realizó, y sólo se admite uno por fecha. Lo capturado después y las correcciones'
                    + ` autorizadas después entrarán al corte del ${_fijoData?.siguiente_fecha_corte || 'día siguiente'}.`;
            }
        }
        modal.querySelector('#conci-cierre-continuar').disabled = yaCerradoHoy;
    }

    function abrirModalCierre() {
        if (!puedeCerrar()) {
            alert('No tienes privilegio para realizar el Cierre de Subsecretaría.');
            return;
        }
        const modal = modalCierreEl();
        resetModalCierre(modal);
        pintarEstadoModalCierre(modal);
        // El resumen suele estar ya cargado (lo pide cada carga de la tabla),
        // pero si no, se repinta en cuanto responda: el aviso de "ya se cerró
        // hoy" no puede depender de haber abierto antes otra pantalla.
        cargarResumenLote().then(() => pintarEstadoModalCierre(modal));
        bsModal('modal-conci-cierre-subsecretaria')?.show();
    }

    /* ── Modal: corregir / solicitar corrección de un manifiesto cerrado ── */
    function modalCorreccionEl() {
        let modal = document.getElementById('modal-conci-correccion-cerrado');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modal-conci-correccion-cerrado';
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.setAttribute('data-bs-backdrop', 'static');
        modal.innerHTML = `<div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header bg-warning">
                    <h5 class="modal-title"><i class="fas fa-unlock-alt me-2"></i>Corregir manifiesto cerrado</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-warning py-2 px-3 small" id="conci-corr-aviso">
                        El informe ya cerrado no se reescribe: se registra un ajuste con la fila completa antes y
                        después, y ese ajuste entra al siguiente Cierre de Subsecretaría que se realice.
                    </div>
                    <div class="mb-2">
                        <label class="form-label small fw-semibold">ID del manifiesto</label>
                        <input type="number" class="form-control" id="conci-corr-manifiesto-id">
                    </div>
                    <div class="mb-2">
                        <label class="form-label small fw-semibold">Campo a corregir</label>
                        <select class="form-select" id="conci-corr-campo"></select>
                    </div>
                    <div class="mb-2">
                        <label class="form-label small fw-semibold">Nuevo valor</label>
                        <input type="text" class="form-control" id="conci-corr-valor-nuevo">
                    </div>
                    <div class="mb-2">
                        <label class="form-label small fw-semibold">Motivo de la corrección</label>
                        <textarea class="form-control" id="conci-corr-motivo" rows="2"></textarea>
                    </div>
                    <div class="mb-2" id="conci-corr-password-grp">
                        <label class="form-label small fw-semibold">Confirme su contraseña</label>
                        <input type="password" class="form-control" id="conci-corr-password" autocomplete="current-password">
                    </div>
                    <div id="conci-corr-msg" class="small"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-light border" data-bs-dismiss="modal">Cancelar</button>
                    <button type="button" class="btn btn-warning" id="conci-corr-confirmar">Enviar</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        const sel = modal.querySelector('#conci-corr-campo');
        sel.innerHTML = CAMPOS_EDITABLES.map(c =>
            `<option value="${esc(c)}">${esc(c)}${CAMPOS_NUMERICOS.has(c) ? ' (mueve totales)' : ''}</option>`
        ).join('');
        modal.querySelector('#conci-corr-confirmar').addEventListener('click', ejecutarCorreccion);
        modal.addEventListener('hidden.bs.modal', () => {
            modal.querySelector('#conci-corr-valor-nuevo').value = '';
            modal.querySelector('#conci-corr-motivo').value = '';
            modal.querySelector('#conci-corr-password').value = '';
            modal.querySelector('#conci-corr-msg').innerHTML = '';
        });
        return modal;
    }

    async function ejecutarCorreccion() {
        const modal = modalCorreccionEl();
        const msgEl = modal.querySelector('#conci-corr-msg');
        const manifiestoId = Number(modal.querySelector('#conci-corr-manifiesto-id').value);
        const campo = modal.querySelector('#conci-corr-campo').value;
        const valorNuevo = modal.querySelector('#conci-corr-valor-nuevo').value;
        const motivo = modal.querySelector('#conci-corr-motivo').value.trim();
        const requierePassword = puedeAutorizarCorreccion(); // se aplicará de inmediato: escribe datos
        const pwEl = modal.querySelector('#conci-corr-password');
        let password = pwEl.value;

        if (!manifiestoId) { msgEl.innerHTML = '<span class="text-danger">Indica el ID del manifiesto.</span>'; return; }
        if (!motivo) { msgEl.innerHTML = '<span class="text-danger">Indica el motivo de la corrección.</span>'; return; }
        if (requierePassword && !password) { msgEl.innerHTML = '<span class="text-danger">Ingresa tu contraseña.</span>'; return; }

        const btn = modal.querySelector('#conci-corr-confirmar');
        btn.disabled = true;
        try {
            if (requierePassword) {
                msgEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Verificando contraseña…</span>';
                await reautenticar(password);
            }

            msgEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Enviando…</span>';
            const { data, error } = await window.supabaseClient.rpc('conciliacion_solicitar_correccion', {
                p_manifiesto_id: manifiestoId,
                p_campo: campo,
                p_valor_nuevo: valorNuevo,
                p_motivo: motivo,
            });
            if (error) throw error;

            const dif = data?.diferencia;
            const difTxt = (dif === null || dif === undefined)
                ? 'sin efecto sobre los totales; la reclasificación sí se reflejará en el siguiente informe'
                : `ajuste ${dif > 0 ? '+' : ''}${dif}`;
            if (data.estado === 'aplicada') {
                msgEl.innerHTML = `<span class="text-success"><i class="fas fa-check-circle me-1"></i>Corrección aplicada (${esc(difTxt)}).</span>`;
            } else {
                msgEl.innerHTML = '<span class="text-success"><i class="fas fa-paper-plane me-1"></i>Solicitud enviada. Un usuario con privilegio de autorización debe aprobarla.</span>';
            }

            if (typeof window.loadConciliacionManifiestos === 'function') {
                window.loadConciliacionManifiestos({ forceRefresh: true, allowLocalEditsReplace: true });
            }
            notificarManifiestosCambiaron();
            refrescarBadgeSolicitudes();
            setTimeout(() => bsModal('modal-conci-correccion-cerrado')?.hide(), 1800);
        } catch (err) {
            msgEl.innerHTML = `<span class="text-danger">${esc(err.message || String(err))}</span>`;
        } finally {
            btn.disabled = false;
            // La contraseña no sobrevive al intento.
            pwEl.value = '';
            password = '';
        }
    }

    function abrirModalCorreccion({ manifiestoId = '' } = {}) {
        if (!puedeSolicitarCorreccion()) {
            alert('No tienes permiso de captura en Manifiestos.');
            return;
        }
        const modal = modalCorreccionEl();
        modal.querySelector('#conci-corr-manifiesto-id').value = manifiestoId || '';
        const privilegiado = puedeAutorizarCorreccion();
        modal.querySelector('#conci-corr-password-grp').classList.toggle('d-none', !privilegiado);
        modal.querySelector('#conci-corr-confirmar').textContent = privilegiado ? 'Aplicar corrección' : 'Enviar solicitud';
        modal.querySelector('#conci-corr-aviso').textContent = privilegiado
            ? 'El informe ya cerrado no se reescribe: se registra un ajuste con la fila completa antes y después, y ese ajuste entra al siguiente Cierre de Subsecretaría. Vale igual para un número (150 → 180 suma +30) que para una reclasificación (NACIONAL → INTERNACIONAL mueve la operación de columna).'
            : 'No tienes privilegio para autorizar correcciones: esto queda como SOLICITUD hasta que alguien con ese privilegio la apruebe. El manifiesto no cambia todavía.';
        bsModal('modal-conci-correccion-cerrado')?.show();
    }

    /* ── Modal: bandeja de solicitudes pendientes (solo quien autoriza) ── */
    function modalSolicitudesEl() {
        let modal = document.getElementById('modal-conci-solicitudes-pendientes');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modal-conci-solicitudes-pendientes';
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header bg-warning">
                    <h5 class="modal-title"><i class="fas fa-inbox me-2"></i>Solicitudes de corrección pendientes</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                </div>
                <div class="modal-body">
                    <div id="conci-sol-loading" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Cargando…</div>
                    <div id="conci-sol-vacio" class="text-center text-muted py-4 d-none"><i class="fas fa-inbox fa-2x mb-2 d-block"></i>No hay solicitudes pendientes.</div>
                    <div id="conci-sol-lista"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-light border" data-bs-dismiss="modal">Cerrar</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#conci-sol-lista').addEventListener('click', (e) => {
            const item = e.target.closest('.conci-sol-item');
            if (!item) return;

            // Paso 1: abre el bloque de confirmación de esa solicitud.
            const abrir = e.target.closest('[data-sol-pedir]');
            if (abrir) {
                const aprobar = abrir.dataset.solPedir === 'aprobar';
                const conf = item.querySelector('.conci-sol-confirmar');
                conf.dataset.solAprobar = aprobar ? '1' : '0';
                conf.classList.remove('d-none');
                conf.querySelector('.conci-sol-titulo').textContent = aprobar
                    ? 'Confirma tu contraseña para APROBAR y aplicar esta corrección.'
                    : 'Confirma tu contraseña para RECHAZAR esta solicitud.';
                conf.querySelector('.conci-sol-password').focus();
                return;
            }

            // Cancelar la confirmación: limpia la contraseña escrita.
            const cancelar = e.target.closest('[data-sol-cancelar]');
            if (cancelar) {
                const conf = item.querySelector('.conci-sol-confirmar');
                conf.querySelector('.conci-sol-password').value = '';
                conf.querySelector('.conci-sol-comentario').value = '';
                conf.classList.add('d-none');
                return;
            }

            // Paso 2: ejecuta.
            const ejecutar = e.target.closest('[data-sol-ejecutar]');
            if (ejecutar) {
                const conf = item.querySelector('.conci-sol-confirmar');
                resolverSolicitudDesdeLista(
                    Number(item.dataset.solItemId),
                    conf.dataset.solAprobar === '1',
                    item
                );
            }
        });
        return modal;
    }

    function renderSolicitudItem(sol) {
        const fecha = sol.creado_en ? new Date(sol.creado_en).toLocaleString('es-MX') : '';
        const dif = sol.diferencia;
        const difTxt = (dif === null || dif === undefined) ? '' : ` · ajuste ${dif > 0 ? '+' : ''}${dif}`;
        return `<div class="conci-sol-item border rounded p-2 mb-2" data-sol-item-id="${esc(sol.id)}">
            <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                    <div><strong>Manifiesto #${esc(sol.manifiesto_id)}</strong> — ${esc(sol.campo)}</div>
                    <div class="small text-muted">${esc(sol.valor_anterior ?? '—')} → <strong>${esc(sol.valor_nuevo ?? '—')}</strong>${difTxt}</div>
                    <div class="small">${esc(sol.motivo)}</div>
                    <div class="small text-muted">Solicitó: ${esc(sol.usuario_modifica_nombre)} · ${esc(fecha)}</div>
                </div>
                <div class="d-flex gap-1 flex-shrink-0">
                    <button type="button" class="btn btn-sm btn-success" data-sol-pedir="aprobar" title="Aprobar y aplicar"><i class="fas fa-check"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-sol-pedir="rechazar" title="Rechazar"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div class="conci-sol-confirmar border-top mt-2 pt-2 d-none">
                <div class="small fw-semibold conci-sol-titulo mb-1"></div>
                <div class="d-flex gap-2 flex-wrap align-items-start">
                    <input type="password" class="form-control form-control-sm conci-sol-password" style="max-width:14rem" autocomplete="current-password" placeholder="Contraseña">
                    <input type="text" class="form-control form-control-sm conci-sol-comentario" style="max-width:18rem" placeholder="Comentario (opcional)">
                    <button type="button" class="btn btn-sm btn-warning" data-sol-ejecutar="1">Confirmar</button>
                    <button type="button" class="btn btn-sm btn-light border" data-sol-cancelar="1">Cancelar</button>
                </div>
            </div>
            <div class="conci-sol-resultado small mt-1"></div>
        </div>`;
    }

    async function resolverSolicitudDesdeLista(id, aprobar, itemEl) {
        const resultadoEl = itemEl?.querySelector('.conci-sol-resultado');
        const confEl = itemEl?.querySelector('.conci-sol-confirmar');
        const pwEl = confEl?.querySelector('.conci-sol-password');
        const comentarioEl = confEl?.querySelector('.conci-sol-comentario');
        let password = pwEl ? pwEl.value : '';
        const comentario = comentarioEl && comentarioEl.value.trim() ? comentarioEl.value.trim() : null;

        if (!password) {
            if (resultadoEl) resultadoEl.innerHTML = '<span class="text-danger">Ingresa tu contraseña.</span>';
            return;
        }
        if (resultadoEl) resultadoEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Procesando…</span>';
        try {
            await reautenticar(password);
            const { error } = await window.supabaseClient.rpc('conciliacion_resolver_solicitud_correccion', {
                p_solicitud_id: id,
                p_aprobar: aprobar,
                p_comentario: comentario,
            });
            if (error) throw error;
            if (resultadoEl) {
                resultadoEl.innerHTML = aprobar
                    ? '<span class="text-success"><i class="fas fa-check-circle me-1"></i>Aprobada y aplicada.</span>'
                    : '<span class="text-danger"><i class="fas fa-times-circle me-1"></i>Rechazada.</span>';
            }
            confEl?.classList.add('d-none');
            itemEl?.querySelectorAll('[data-sol-pedir]').forEach(b => { b.disabled = true; });
            if (typeof window.loadConciliacionManifiestos === 'function') {
                window.loadConciliacionManifiestos({ forceRefresh: true, allowLocalEditsReplace: true });
            }
            notificarManifiestosCambiaron();
            refrescarBadgeSolicitudes();
        } catch (err) {
            if (resultadoEl) resultadoEl.innerHTML = `<span class="text-danger">${esc(err.message || String(err))}</span>`;
        } finally {
            // La contraseña no sobrevive al intento, ni en el DOM ni en memoria.
            if (pwEl) pwEl.value = '';
            password = '';
        }
    }

    async function abrirModalSolicitudes() {
        if (!puedeAutorizarCorreccion()) {
            alert('No tienes privilegio para resolver solicitudes de corrección.');
            return;
        }
        const modal = modalSolicitudesEl();
        const loading = modal.querySelector('#conci-sol-loading');
        const vacio = modal.querySelector('#conci-sol-vacio');
        const lista = modal.querySelector('#conci-sol-lista');
        loading.classList.remove('d-none');
        vacio.classList.add('d-none');
        lista.innerHTML = '';
        bsModal('modal-conci-solicitudes-pendientes')?.show();
        try {
            const { data, error } = await window.supabaseClient.rpc('conciliacion_solicitudes_pendientes');
            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            if (!rows.length) {
                vacio.classList.remove('d-none');
            } else {
                lista.innerHTML = rows.map(renderSolicitudItem).join('');
            }
        } catch (err) {
            lista.innerHTML = `<div class="alert alert-danger small">${esc(err.message || String(err))}</div>`;
        } finally {
            loading.classList.add('d-none');
        }
    }

    async function refrescarBadgeSolicitudes() {
        const badge = document.getElementById('badge-conci-solicitudes-pendientes');
        const btn = document.getElementById('btn-conci-solicitudes-pendientes');
        if (!btn || !puedeAutorizarCorreccion() || !window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient.rpc('conciliacion_solicitudes_pendientes');
            if (error) throw error;
            const n = Array.isArray(data) ? data.length : 0;
            if (badge) {
                badge.textContent = String(n);
                badge.classList.toggle('d-none', n === 0);
            }
        } catch (err) {
            console.warn('[Cierre Subsecretaría] No se pudo consultar solicitudes pendientes:', err);
        }
    }

    /* ── Init: botones de la barra de herramientas ── */
    function updateToolbarVisibility() {
        const cierra = puedeCerrar();
        const autoriza = puedeAutorizarCorreccion();
        const solicita = puedeSolicitarCorreccion();
        document.getElementById('btn-conci-cierre-subsecretaria')?.classList.toggle('d-none', !cierra);
        document.getElementById('btn-conci-corregir-cerrado')?.classList.toggle('d-none', !solicita);
        document.getElementById('btn-conci-solicitudes-pendientes')?.classList.toggle('d-none', !autoriza);
        if (autoriza) refrescarBadgeSolicitudes();
    }

    function init() {
        document.getElementById('btn-conci-cierre-subsecretaria')?.addEventListener('click', abrirModalCierre);
        document.getElementById('btn-conci-corregir-cerrado')?.addEventListener('click', () => abrirModalCorreccion({}));
        document.getElementById('btn-conci-solicitudes-pendientes')?.addEventListener('click', abrirModalSolicitudes);

        // El FIJO ya no depende del filtro de fecha: el lote pendiente es el
        // mismo se mire el día que se mire. Se refresca cuando llegan filas
        // nuevas (hook de la tira de resumen) y tras cada cierre o corrección.
        window.addEventListener('admin-mode-changed', updateToolbarVisibility);
        setTimeout(updateToolbarVisibility, 500);
    }

    document.addEventListener('DOMContentLoaded', init);
    window.conciCierreSubsecretaria = { abrirModalCierre, abrirModalCorreccion, abrirModalSolicitudes };
})();
