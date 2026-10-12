/* ==========================================================================
   SEGUIMIENTO · Dirección de Operación

   Órdenes, renovaciones, certificados y pendientes de las subdirecciones, con
   vistas de lista, tablero, calendario, cronograma y resumen; comentarios,
   bitácora, evidencias y recordatorio por WhatsApp.

   Por ahora sólo lo ven las cuentas en public.seguimiento_acceso
   (db/create_seguimiento.sql). La base aplica la misma regla con RLS, así que
   esconder el botón del menú es comodidad, no seguridad.

   Las reglas (vencimientos, recurrencia, filtros, mensaje de WhatsApp) viven
   en js/seguimiento-core.js; aquí sólo se pinta y se guarda. No toca nada de
   otros módulos: su sección, su menú flotante y su panel se crean solos.
   ========================================================================== */
(function () {
    'use strict';

    const C = window.SeguimientoCore;
    if (!C) { console.error('[Seguimiento] Falta js/seguimiento-core.js'); return; }

    const DUENO = 'isaac.lopez@aifa.operaciones';
    const BUCKET = 'seguimiento-evidencias';
    const MAX_ARCHIVO = 10 * 1024 * 1024;
    const PREFS = 'aifa_seguimiento_prefs_v1';
    const TIPOS_ARCHIVO = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
    const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
    const AVISOS = [0, 1, 3, 7, 15, 30, 60, 90];
    const VISTAS = [
        { clave: 'lista', nombre: 'Lista', icono: 'list-ul', ayuda: 'Tareas agrupadas, con todo a la vista para cambiarlo ahí mismo.' },
        { clave: 'tablero', nombre: 'Tablero', icono: 'table-columns', ayuda: 'Columnas por estatus: arrastra una tarjeta para cambiarlo.' },
        { clave: 'calendario', nombre: 'Calendario', icono: 'calendar-days', ayuda: 'Fechas límite del mes: arrastra para mover una fecha.' },
        { clave: 'cronograma', nombre: 'Cronograma', icono: 'chart-gantt', ayuda: 'Barras de inicio a fecha límite, como un Gantt.' },
        { clave: 'resumen', nombre: 'Resumen', icono: 'chart-pie', ayuda: 'Indicadores, vencidas y avance por subdirección.' },
    ];
    const SITUACION_UNO = {
        vencida: 'Vencida', vence_hoy: 'Vence hoy', por_vencer: 'Por vencer', a_tiempo: 'A tiempo',
        sin_fecha: 'Sin fecha', completada: 'Completada', cancelada: 'Cancelada',
    };
    const CAMPO_NOMBRE = {
        titulo: 'Nombre', estatus: 'Estatus', prioridad: 'Prioridad', subdireccion: 'Subdirección', gerencia: 'Gerencia',
        responsable: 'Responsable', fecha_inicio: 'Inicio', fecha_limite: 'Fecha límite', recurrencia: 'Repetición', recurrencia_meses: 'Repetición', tipo: 'Tipo',
    };
    const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    const $ = id => document.getElementById(id);
    const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const errTxt = e => (e && (e.message || e.error_description || e.details || e.hint)) || String(e || 'error desconocido');
    const recortar = (s, n = 60) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
    const hoy = () => C.hoyISO();
    const cssEsc = v => (window.CSS && typeof window.CSS.escape === 'function') ? window.CSS.escape(v) : String(v).replace(/["\\\]\[]/g, '\\$&');
    const raf = f => (typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(f) : setTimeout(f, 16));

    const state = {
        rol: null, revisado: false, revisando: null, sinInstalar: false, errorAcceso: null,
        sesion: { email: '', nombre: '' }, sinSesion: false,
        tareas: [], nComent: new Map(), personas: [], personasCargadas: false,
        cargado: false, cargando: null, errorCarga: null,
        vista: 'lista', agrupar: 'subdireccion', orden: { campo: 'fecha_limite', asc: true },
        filtros: { texto: '', subdirecciones: [], estatus: [], prioridades: [], tipos: [], responsable: '', situacion: '', verCerradas: false },
        colapsados: [], cal: null, gantt: { escala: 'semanas', inicio: null },
        dr: null, drTimers: {}, menu: null, canal: null, enVivo: null, pintando: 0, sucio: false,
        arrastrando: null, gruposPintados: new Map(),
    };

    /* ---------- Preferencias de quien mira (sólo comodidad) ---------- */
    function cargarPrefs() {
        try {
            const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
            if (VISTAS.some(v => v.clave === p.vista)) state.vista = p.vista;
            if (C.AGRUPACIONES.some(a => a.clave === p.agrupar)) state.agrupar = p.agrupar;
            if (Array.isArray(p.colapsados)) state.colapsados = p.colapsados.slice(0, 60);
            if (typeof p.verCerradas === 'boolean') state.filtros.verCerradas = p.verCerradas;
            if (p.orden && p.orden.campo) state.orden = { campo: String(p.orden.campo), asc: p.orden.asc !== false };
            if (p.escala === 'meses' || p.escala === 'semanas') state.gantt.escala = p.escala;
            if (typeof p.guiaOculta === 'boolean') state.guiaOculta = p.guiaOculta;
        } catch (_) { /* sin almacenamiento: valores por defecto */ }
    }
    function guardarPrefs() {
        try {
            localStorage.setItem(PREFS, JSON.stringify({
                vista: state.vista, agrupar: state.agrupar, colapsados: state.colapsados,
                verCerradas: state.filtros.verCerradas, orden: state.orden, escala: state.gantt.escala, guiaOculta: Boolean(state.guiaOculta),
            }));
        } catch (_) { /* nada */ }
    }

    /* ---------- Sesión y Supabase ---------- */
    async function sb() {
        let c = window.supabaseClient;
        if (!c && typeof window.ensureSupabaseClient === 'function') {
            try { c = await window.ensureSupabaseClient(); } catch (_) { c = null; }
        }
        return c || null;
    }

    /* Quién está conectado. Manda la sesión de Supabase (la toma revisarAcceso);
       después, lo que la aplicación guarda al iniciar sesión: 'currentUser' (el
       correo) y 'user_fullname'. 'user' en JSON es de la página de acceso vieja. */
    function usuario() {
        const leer = k => { try { return String(sessionStorage.getItem(k) || '').trim(); } catch (_) { return ''; } };
        let u = null;
        try { u = JSON.parse(sessionStorage.getItem('user') || 'null'); } catch (_) { u = null; }
        const meta = (u && u.user_metadata) || {};
        const actual = leer('currentUser');
        const email = (state.sesion.email || (actual.includes('@') ? actual : '') || String((u && u.email) || '')).toLowerCase();
        const util = n => (n && !n.includes('@') ? n : '');
        const nombre = util(leer('user_fullname')) || util(state.sesion.nombre) || util(String(meta.full_name || meta.name || '').trim())
            || (email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Usuario');
        return { email, nombre };
    }

    const puedeEditar = () => state.rol === 'admin' || state.rol === 'editor';
    const esAdmin = () => state.rol === 'admin';
    const buscar = id => state.tareas.find(t => t.id === id);
    const seccionActiva = () => Boolean($('seguimiento-section') && $('seguimiento-section').classList.contains('active'));

    /* ---------- Avisos ---------- */
    function toast(msg, tipo, accion) {
        const cont = $('seg-toasts');
        if (!cont) return;
        const el = document.createElement('div');
        el.className = 'seg-toast is-' + (tipo || 'ok');
        const ico = { ok: 'circle-check', error: 'circle-exclamation', info: 'circle-info' }[tipo || 'ok'] || 'circle-info';
        el.innerHTML = '<i class="fas fa-' + ico + '"></i><span>' + esc(msg) + '</span>';
        if (accion) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'seg-link';
            b.textContent = accion.texto;
            b.addEventListener('click', () => { el.remove(); accion.fn(); });
            el.appendChild(b);
        }
        cont.appendChild(el);
        setTimeout(() => el.remove(), accion ? 8000 : (tipo === 'error' ? 6500 : 4200));
    }

    function hace(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d)) return '';
        const s = (Date.now() - d.getTime()) / 1000;
        if (s < 60) return 'hace un momento';
        if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
        if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
        if (s < 86400 * 7) return 'hace ' + Math.round(s / 86400) + ' d';
        return C.fechaCorta(C.aISO(d));
    }

    /* Tooltips propios (ver "Tooltips" más abajo): título, detalle, atajo de
       teclado, ícono y un punto de color. Reemplazan al title del navegador. */
    function tip(titulo, sub, extra) {
        const e = extra || {};
        return ' data-tip="' + esc(titulo) + '"' +
            (sub ? ' data-tip-sub="' + esc(sub) + '"' : '') +
            (e.kbd ? ' data-tip-kbd="' + esc(e.kbd) + '"' : '') +
            (e.ico ? ' data-tip-ico="' + esc(e.ico) + '"' : '') +
            (e.c ? ' data-tip-c="' + esc(e.c) + '"' : '');
    }

    /** Iniciales en un círculo. Con conTip, el nombre completo al pasar el ratón. */
    function avatar(nombre, conTip) {
        const n = String(nombre || '').trim();
        if (!n) return '<span class="seg-avatar is-empty"' + (conTip ? tip('Sin responsable', 'Asígnale a alguien para poder recordarle.', { ico: 'user-slash' }) : '') +
            '><i class="fas fa-user" style="font-size:.7rem"></i></span>';
        return '<span class="seg-avatar" style="--c:' + C.colorDeNombre(n) + '"' + (conTip ? tip(n, 'Responsable', { ico: 'user' }) : '') + '>' + esc(C.iniciales(n)) + '</span>';
    }

    const linkify = html => html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    const tamTxt = n => !n ? '' : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
    const fechaDMY = iso => { const d = C.deISO(iso); return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() : ''; };

    /* ==========================================================================
       Estructura
       ========================================================================== */
    function asegurarSeccion() {
        if ($('seguimiento-section')) return $('seguimiento-section');
        const host = ($('coord-auditoria-section') || document.querySelector('.content-section'))?.parentElement;
        if (!host) return null;
        host.insertAdjacentHTML('beforeend',
            '<div id="seguimiento-section" class="content-section"><div class="seg-root"><div class="seg-shell" id="seg-shell"></div></div></div>');
        return $('seguimiento-section');
    }

    /* El panel, el menú y los avisos van colgados del body: dentro de la sección
       quedarían atrapados por cualquier transform de los contenedores. */
    function asegurarPortal() {
        if ($('seg-portal')) return;
        document.body.insertAdjacentHTML('beforeend',
            '<div class="seg-root" id="seg-portal">' +
            '<div class="seg-drawer-bd" id="seg-drawer-bd"></div>' +
            '<aside class="seg-drawer" id="seg-drawer" role="dialog" aria-modal="true" aria-label="Detalle de la tarea" aria-hidden="true"></aside>' +
            '<div class="seg-menu" id="seg-menu" role="menu" hidden></div>' +
            '<div class="seg-modal" id="seg-modal" hidden></div>' +
            '<div class="seg-toasts" id="seg-toasts" aria-live="polite"></div>' +
            '<div class="seg-tip" id="seg-tip" role="tooltip" hidden></div>' +
            '<input type="file" id="seg-file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple hidden>' +
            '</div>');
        conectarPortal();
    }

    function pintarEsqueleto() {
        const shell = $('seg-shell');
        if (!shell) return;
        shell.innerHTML =
            '<header class="seg-head">' +
              '<div class="seg-head-title">' +
                '<div class="seg-logo"><i class="fas fa-list-check"></i></div>' +
                '<div>' +
                  '<div class="seg-crumb"><span>Dirección de Operación</span><i class="fas fa-chevron-right" style="font-size:.55rem"></i>' +
                  '<span class="seg-crumb-tag">Seguimiento</span></div>' +
                  '<h2>Seguimiento de órdenes y pendientes</h2>' +
                '</div>' +
              '</div>' +
              '<div class="seg-head-actions">' +
                '<span class="seg-live" id="seg-live"' + tip('Actualización en vivo', 'Lo que cambien los demás aparece aquí sin recargar la página.', { ico: 'tower-broadcast' }) + '><span class="seg-dot"></span><span>Conectando…</span></span>' +
                '<button type="button" class="seg-btn" id="seg-btn-resumen"' + tip('Descargar resumen', 'Reporte ejecutivo en PDF o la tabla completa en Excel.', { ico: 'download' }) + '><i class="fas fa-download"></i>Descargar resumen</button>' +
                '<button type="button" class="seg-btn" id="seg-btn-acceso" hidden' + tip('Quién puede ver Seguimiento', 'Agrega o quita cuentas y elige su rol.', { ico: 'user-lock' }) + '><i class="fas fa-user-plus"></i>Acceso</button>' +
                '<button type="button" class="seg-btn seg-btn-primary" id="seg-btn-nueva"' + tip('Nueva tarea', 'Registra una orden, renovación, certificado o pendiente.', { kbd: 'N', ico: 'plus' }) + '><i class="fas fa-plus"></i>Nueva tarea</button>' +
              '</div>' +
            '</header>' +
            '<div class="seg-kpis" id="seg-kpis"></div>' +
            '<div class="seg-toolbar">' +
              '<nav class="seg-views" id="seg-views" role="tablist" aria-label="Vistas">' +
                VISTAS.map(v => '<button type="button" class="seg-view" role="tab" data-vista="' + v.clave + '"' + tip(v.nombre, v.ayuda, { ico: v.icono }) + '><i class="fas fa-' + v.icono + '"></i>' + v.nombre + '</button>').join('') +
              '</nav>' +
              '<div class="seg-tools">' +
                '<label class="seg-search"' + tip('Buscar', 'Por nombre, responsable, oficio, folio (SEG-0001) o etiqueta.', { kbd: '/', ico: 'magnifying-glass' }) + '><i class="fas fa-magnifying-glass"></i>' +
                  '<input id="seg-q" type="search" placeholder="Buscar tarea, responsable, oficio…" autocomplete="off" aria-label="Buscar"><kbd>/</kbd></label>' +
                '<button type="button" class="seg-tool" id="seg-btn-filtros"' + tip('Filtrar', 'Por situación, estatus, prioridad, tipo o responsable.', { ico: 'filter' }) + '><i class="fas fa-filter"></i>Filtros<span class="seg-badge" id="seg-nfiltros" hidden></span></button>' +
                '<button type="button" class="seg-tool" id="seg-btn-agrupar"' + tip('Agrupar la lista', 'Por subdirección, estatus, responsable, prioridad, tipo o vencimiento.', { ico: 'layer-group' }) + '><i class="fas fa-layer-group"></i><span id="seg-agrupar-txt"></span></button>' +
                '<button type="button" class="seg-tool" id="seg-btn-cerradas"' + tip('Mostrar cerradas', 'Incluye también las completadas y canceladas.', { ico: 'eye' }) + '><i class="fas fa-eye-slash"></i>Cerradas</button>' +
              '</div>' +
            '</div>' +
            '<div class="seg-chips" id="seg-chips" role="group" aria-label="Subdirecciones"></div>' +
            '<div class="seg-alerta" id="seg-alerta"></div>' +
            '<div id="seg-body" class="seg-body"></div>';
        conectarEsqueleto();
    }

    function pintarPuerta(tipo) {
        const shell = $('seg-shell');
        if (!shell) return;
        let html;
        if (tipo === 'instalar') {
            html = '<div class="seg-empty seg-gate"><div class="seg-empty-ico"><i class="fas fa-database"></i></div>' +
                '<h3>Falta preparar la base de datos</h3>' +
                '<p>El módulo ya está listo en la página, pero Supabase todavía no tiene sus tablas. Abre Supabase → SQL Editor, ' +
                'pega el contenido de <code>db/create_seguimiento.sql</code> y pulsa <b>Run</b>. Es seguro correrlo más de una vez.</p>' +
                '<button type="button" class="seg-btn seg-btn-primary" id="seg-reintentar-acceso"><i class="fas fa-rotate"></i>Ya lo corrí, revisar de nuevo</button></div>';
        } else if (tipo === 'error') {
            html = '<div class="seg-empty seg-gate"><div class="seg-empty-ico" style="color:var(--seg-danger);background:var(--seg-danger-soft)"><i class="fas fa-plug-circle-xmark"></i></div>' +
                '<h3>No se pudo cargar Seguimiento</h3><p>' + esc(state.errorCarga || 'Revisa tu conexión.') + '</p>' +
                '<button type="button" class="seg-btn seg-btn-primary" id="seg-reintentar-acceso"><i class="fas fa-rotate"></i>Reintentar</button></div>';
        } else {
            html = '';
        }
        shell.innerHTML = html;
        $('seg-reintentar-acceso')?.addEventListener('click', () => {
            state.revisado = false; state.cargado = false; state.errorCarga = null;
            entrar();
        });
    }

    /* ==========================================================================
       Acceso
       ========================================================================== */
    function pintarMenu() {
        const link = $('menu-seguimiento');
        if (!link) return;
        const ver = Boolean(state.rol);
        link.style.display = ver ? '' : 'none';
        link.setAttribute('aria-hidden', ver ? 'false' : 'true');
    }

    function revisarAcceso() {
        if (state.revisando) return state.revisando;
        state.revisando = (async () => {
            const c = await sb();
            if (!c) { state.revisado = false; return null; }
            // La sesión real, no lo que haya quedado en sessionStorage.
            let sesion = null;
            try {
                const r = c.auth && typeof c.auth.getSession === 'function' ? await c.auth.getSession() : null;
                sesion = r && r.data && r.data.session;
            } catch (_) { sesion = null; }
            state.errorAcceso = null;
            if (!sesion || !sesion.user) {
                state.sesion = { email: '', nombre: '' };
                state.sinSesion = true;
                state.rol = null; state.revisado = true; pintarMenu();
                return null;
            }
            const meta = sesion.user.user_metadata || {};
            state.sesion = { email: String(sesion.user.email || '').toLowerCase(), nombre: String(meta.full_name || meta.name || '').trim() };
            state.sinSesion = false;
            const u = usuario();
            try {
                const { data, error } = await c.rpc('seguimiento_mi_rol');
                if (error) throw error;
                state.rol = data || null;
                state.sinInstalar = false;
            } catch (e) {
                const msg = errTxt(e) + ' ' + String((e && e.code) || '');
                state.sinInstalar = /PGRST202|42883|42P01|does not exist|Could not find the function/i.test(msg);
                // Sin tablas, sólo el dueño ve el módulo, para que sepa qué falta.
                state.rol = state.sinInstalar && u.email === DUENO ? 'instalar' : null;
                if (!state.sinInstalar) {
                    console.warn('[Seguimiento] No se pudo revisar el acceso:', e);
                    state.errorAcceso = errTxt(e);
                }
            }
            state.revisado = true;
            pintarMenu();
            return state.rol;
        })().finally(() => { state.revisando = null; });
        return state.revisando;
    }

    function olvidarSesion() {
        state.rol = null; state.revisado = false; state.cargado = false; state.tareas = []; state.nComent = new Map();
        state.sesion = { email: '', nombre: '' };
        state.personas = []; state.personasCargadas = false;
        cerrarDrawer(true);
        if (state.canal) { sb().then(c => c && c.removeChannel(state.canal)).catch(() => {}); state.canal = null; }
        pintarMenu();
        if ($('seg-shell')) $('seg-shell').innerHTML = '';
    }

    async function entrar() {
        asegurarPortal();
        if (!state.revisado) await revisarAcceso();
        if (!seccionActiva()) return;
        if (!state.rol) {
            if (state.errorAcceso) { state.errorCarga = state.errorAcceso; pintarPuerta('error'); return; }
            salirDeSeccion();
            return;
        }
        if (state.rol === 'instalar') { pintarPuerta('instalar'); return; }
        if (!$('seg-body')) pintarEsqueleto();
        const acc = $('seg-btn-acceso');
        if (acc) acc.hidden = !esAdmin();
        const nueva = $('seg-btn-nueva');
        if (nueva) nueva.hidden = !puedeEditar();
        if (!state.cargado) {
            pintarCargando();
            const ok = await cargar();
            if (!ok) { pintarPuerta('error'); return; }
            cargarPersonas();
            suscribir();
        }
        renderTodo();
    }

    /* Sin acceso no hay nada que mostrar: se regresa a la sección de inicio
       de la persona, como si el módulo no existiera. Sin sesión no se mueve
       nada, porque ahí manda la pantalla de inicio de sesión. */
    function salirDeSeccion() {
        const shell = $('seg-shell');
        if (shell) shell.innerHTML = '';
        if (state.sinSesion || typeof window.showSection !== 'function') return;
        let destino = 'operaciones-totales';
        try { if (typeof window.getDefaultAllowedSection === 'function') destino = window.getDefaultAllowedSection() || destino; } catch (_) { /* nada */ }
        if (destino !== 'seguimiento') window.showSection(destino);
    }

    function pintarCargando() {
        const body = $('seg-body');
        if (body) body.innerHTML = '<div class="seg-skel"></div><div class="seg-skel"></div><div class="seg-skel"></div><div class="seg-skel" style="opacity:.6"></div>';
    }

    /* ==========================================================================
       Datos
       ========================================================================== */
    function cargar() {
        if (state.cargando) return state.cargando;
        state.cargando = (async () => {
            const c = await sb();
            if (!c) throw new Error('Supabase no está disponible.');
            const [t, cm] = await Promise.all([
                c.from('seguimiento_tareas').select('*').order('fecha_limite', { ascending: true, nullsFirst: false }).limit(5000),
                c.from('seguimiento_comentarios').select('tarea_id').limit(50000),
            ]);
            if (t.error) throw t.error;
            state.tareas = t.data || [];
            state.nComent = new Map();
            (cm.data || []).forEach(r => state.nComent.set(r.tarea_id, (state.nComent.get(r.tarea_id) || 0) + 1));
            state.cargado = true;
            state.errorCarga = null;
            return true;
        })().catch(e => {
            console.error('[Seguimiento] Error al cargar:', e);
            state.errorCarga = errTxt(e);
            return false;
        }).finally(() => { state.cargando = null; });
        return state.cargando;
    }

    async function cargarPersonas() {
        if (state.personasCargadas) return;
        state.personasCargadas = true;
        const mapa = new Map();
        const agregar = (nombre, extra) => {
            const n = String(nombre || '').trim().replace(/\s+/g, ' ');
            if (!n || /^vacante/i.test(n)) return;
            const k = C.normalizar(n);
            if (!mapa.has(k)) { mapa.set(k, Object.assign({ nombre: n, num: null, tel: '', puesto: '' }, extra || {})); return; }
            const p = mapa.get(k);
            Object.keys(extra || {}).forEach(x => { if (!p[x] && extra[x]) p[x] = extra[x]; });
        };
        try {
            const c = await sb();
            const { data, error } = await c.from('agenda_2026')
                .select('"No. Empleado","Nombre","Puesto","No. telefónico","Estatus"').limit(3000);
            if (error) throw error;
            (data || []).forEach(r => {
                if (/baja/i.test(String(r['Estatus'] || ''))) return;
                agregar(r['Nombre'], {
                    num: r['No. Empleado'] != null ? String(r['No. Empleado']) : null,
                    tel: String(r['No. telefónico'] || '').trim(),
                    puesto: String(r['Puesto'] || '').trim(),
                });
            });
        } catch (e) {
            console.info('[Seguimiento] Sin directorio para sugerir responsables:', errTxt(e));
        }
        state.tareas.forEach(t => agregar(t.responsable, { tel: t.responsable_tel || '' }));
        state.personas = [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }

    function suscribir() {
        if (state.canal) return;
        sb().then(c => {
            if (!c || typeof c.channel !== 'function' || state.canal) return;
            state.canal = c.channel('seguimiento-' + Math.random().toString(36).slice(2, 8))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'seguimiento_tareas' }, aplicarRemoto)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seguimiento_comentarios' }, p => {
                    const cm = p.new || {};
                    if (!cm.tarea_id) return;
                    const dr = state.dr;
                    if (dr && dr.id === cm.tarea_id && Array.isArray(dr.comentarios)) {
                        if (!dr.comentarios.some(x => x.id === cm.id)) { dr.comentarios.push(cm); pintarTab(); }
                        state.nComent.set(cm.tarea_id, dr.comentarios.length);
                    } else {
                        state.nComent.set(cm.tarea_id, (state.nComent.get(cm.tarea_id) || 0) + 1);
                    }
                    renderPronto();
                })
                .subscribe(estado => {
                    state.enVivo = estado === 'SUBSCRIBED';
                    pintarVivo();
                });
        }).catch(() => {});
    }

    function aplicarRemoto(p) {
        if (p.eventType === 'DELETE') {
            const id = p.old && p.old.id;
            state.tareas = state.tareas.filter(t => t.id !== id);
            if (state.dr && state.dr.id === id) cerrarDrawer(true);
        } else if (p.new && p.new.id) {
            const t = buscar(p.new.id);
            if (t) Object.assign(t, p.new); else state.tareas.push(p.new);
            pintarDrawerSi(p.new.id);
        }
        renderPronto();
    }

    function pintarVivo() {
        const el = $('seg-live');
        if (!el) return;
        el.classList.toggle('is-on', state.enVivo === true);
        el.lastElementChild.textContent = state.enVivo === true ? 'En vivo' : state.enVivo === false ? 'Sin tiempo real' : 'Conectando…';
    }

    /* ---------- Escritura ---------- */
    const TEXTOS_NULOS = ['descripcion', 'gerencia', 'responsable', 'responsable_tel', 'referencia', 'responsable_num'];
    function limpiarFila(datos) {
        const f = Object.assign({}, datos);
        TEXTOS_NULOS.forEach(k => { if (k in f) { const v = String(f[k] == null ? '' : f[k]).trim(); f[k] = v || null; } });
        ['fecha_inicio', 'fecha_limite'].forEach(k => { if (k in f && !f[k]) f[k] = null; });
        if ('titulo' in f) f.titulo = String(f.titulo || '').trim();
        if ('aviso_dias' in f) f.aviso_dias = Math.max(0, Math.min(365, parseInt(f.aviso_dias, 10) || 0));
        return f;
    }

    /** El error de la base, dicho de forma que se sepa qué hacer. */
    function mensajeError(e) {
        const m = errTxt(e) + ' ' + String((e && e.code) || '');
        if (/recurrencia_meses|seguimiento_tareas_recurr/i.test(m)) {
            return 'para repetir con un tiempo personalizado falta correr db/seguimiento_recurrencia_personalizada.sql en Supabase.';
        }
        return errTxt(e);
    }

    async function crearEnBase(datos, opts) {
        const o = opts || {};
        if (!puedeEditar()) { toast('Tu acceso a Seguimiento es de solo consulta.', 'error'); return null; }
        const u = usuario();
        const fila = limpiarFila(Object.assign({}, datos, { creado_por: u.nombre, creado_por_email: u.email, actualizado_por: u.nombre }));
        delete fila.id; delete fila.folio;
        const c = await sb();
        const { data, error } = await c.from('seguimiento_tareas').insert(fila).select().single();
        if (error) { toast('No se pudo crear la tarea: ' + mensajeError(error), 'error'); return null; }
        if (!buscar(data.id)) state.tareas.push(data);
        bitacora(data.id, 'creo', o.origen ? { origen: C.folio(o.origen.folio) } : {});
        renderPronto();
        return data;
    }

    async function actualizar(id, patchIn, opts) {
        const o = opts || {};
        const t = buscar(id);
        if (!t) return false;
        if (!puedeEditar()) { toast('Tu acceso a Seguimiento es de solo consulta.', 'error'); return false; }
        const patch = limpiarFila(patchIn);
        // La base exige inicio <= límite: si el límite se adelanta, el inicio lo sigue.
        const limite = 'fecha_limite' in patch ? patch.fecha_limite : t.fecha_limite;
        const inicio = 'fecha_inicio' in patch ? patch.fecha_inicio : t.fecha_inicio;
        if (limite && inicio && inicio > limite) {
            if ('fecha_inicio' in patch) { toast('El inicio no puede ser después de la fecha límite.', 'error'); pintarDrawerSi(id, true); return false; }
            patch.fecha_inicio = limite;
        }
        if ('titulo' in patch && !patch.titulo) { pintarDrawerSi(id, true); return false; }
        const antes = {};
        Object.keys(patch).forEach(k => { antes[k] = t[k]; });
        Object.assign(t, patch);
        renderPronto();
        pintarDrawerSi(id);
        indicador('guardando');
        const c = await sb();
        const { data, error } = await c.from('seguimiento_tareas')
            .update(Object.assign({}, patch, { actualizado_por: usuario().nombre }))
            .eq('id', id).select().maybeSingle();
        if (error || !data) {
            Object.assign(t, antes);
            renderPronto();
            pintarDrawerSi(id, true);
            indicador('error');
            toast(error ? 'No se guardó: ' + mensajeError(error) : 'No se guardó: la base no aceptó el cambio (revisa tu acceso).', 'error');
            return false;
        }
        Object.assign(t, data);
        indicador('ok');
        const cs = C.cambios(antes, patch);
        if (cs.length && o.bitacora !== false) bitacora(id, 'cambio', { cambios: cs });
        if (antes.estatus === 'completada' && patch.estatus && C.ABIERTOS.includes(patch.estatus)) {
            await quitarSiguienteSiSobra(t);
        }
        if (patch.estatus === 'completada' && antes.estatus !== 'completada') {
            const sig = await programarSiguiente(t);
            if (!sig && !o.silencioso) {
                const previo = antes.estatus;
                toast('«' + recortar(t.titulo, 48) + '» completada.', 'ok', { texto: 'Deshacer', fn: () => actualizar(id, { estatus: previo }) });
            }
        }
        renderPronto();
        pintarDrawerSi(id);
        return true;
    }

    /* Si se reabre una renovación que ya había programado la siguiente, esa
       siguiente sobra: se ofrece quitarla para que no quede repetida. */
    async function quitarSiguienteSiSobra(t) {
        const sig = t.siguiente_id && buscar(t.siguiente_id);
        if (!sig || !C.estaAbierta(sig)) return;
        const ok = window.confirm('Al completarla se había programado la siguiente: ' + C.folio(sig.folio) + ', para el ' +
            C.fechaLarga(sig.fecha_limite) + '.\n\n¿La quito para que no quede repetida?');
        if (!ok) return;
        const hecho = await actualizar(sig.id, { estatus: 'cancelada' }, { silencioso: true });
        if (hecho) {
            await actualizar(t.id, { siguiente_id: null }, { bitacora: false, silencioso: true });
            toast('Se quitó la siguiente que estaba programada (' + C.folio(sig.folio) + ').', 'ok');
        }
    }

    /* Una renovación completada deja programada la siguiente, con su ciclo. */
    async function programarSiguiente(t) {
        if (t.siguiente_id) return null;
        const datos = C.siguienteOcurrencia(t);
        if (!datos) return null;
        const nueva = await crearEnBase(datos, { origen: t });
        if (!nueva) return null;
        await actualizar(t.id, { siguiente_id: nueva.id }, { bitacora: false, silencioso: true });
        bitacora(t.id, 'recurrencia', { fecha: nueva.fecha_limite, folio: C.folio(nueva.folio) });
        const que = t.tipo === 'certificado' ? 'renovación del certificado' : t.tipo === 'renovacion' ? 'renovación' : 'ocurrencia';
        toast('Completada. La siguiente ' + que + ' quedó programada para el ' + C.fechaLarga(nueva.fecha_limite) + '.', 'ok',
            { texto: 'Abrir', fn: () => abrirTarea(nueva.id) });
        return nueva;
    }

    function bitacora(tareaId, accion, detalle) {
        sb().then(c => c && c.from('seguimiento_actividad').insert({ tarea_id: tareaId, autor: usuario().nombre, accion, detalle: detalle || {} }))
            .then(r => {
                if (r && r.error) console.warn('[Seguimiento] Bitácora:', r.error.message);
                const dr = state.dr;
                if (dr && dr.id === tareaId && dr.tab === 'actividad') cargarActividad(tareaId);
            })
            .catch(() => {});
    }

    async function eliminarTarea(id) {
        const t = buscar(id);
        if (!t || !esAdmin()) return;
        if (!window.confirm('¿Eliminar definitivamente «' + recortar(t.titulo, 80) + '»?\n\nSe borran también sus comentarios, bitácora y evidencias. Si sólo ya no aplica, mejor cámbiala a "Cancelada".')) return;
        const c = await sb();
        const rutas = (t.evidencias || []).map(e => e.path).filter(Boolean);
        const { error } = await c.from('seguimiento_tareas').delete().eq('id', id);
        if (error) { toast('No se pudo eliminar: ' + errTxt(error), 'error'); return; }
        if (rutas.length) c.storage.from(BUCKET).remove(rutas).catch(() => {});
        state.tareas = state.tareas.filter(x => x.id !== id);
        cerrarDrawer(true);
        renderPronto();
        toast('Tarea eliminada.', 'ok');
    }

    /* ==========================================================================
       Filtros y alcance
       ========================================================================== */
    function alcance() {
        // Todo lo que entra en subdirección, búsqueda y filtros de detalle, sin
        // importar estatus ni vencimiento: base de indicadores y resumen.
        return C.filtrar(state.tareas, Object.assign({}, state.filtros, { situacion: '', estatus: [], verCerradas: true }), hoy());
    }
    function visibles() {
        return C.ordenar(C.filtrar(state.tareas, state.filtros, hoy()), state.orden.campo, state.orden.asc);
    }
    function nFiltrosDetalle() {
        const f = state.filtros;
        return f.estatus.length + f.prioridades.length + f.tipos.length + (f.situacion ? 1 : 0) + (f.responsable ? 1 : 0);
    }
    const hayFiltros = () => Boolean(state.filtros.texto) || nFiltrosDetalle() > 0;
    function limpiarFiltros() {
        Object.assign(state.filtros, { texto: '', estatus: [], prioridades: [], tipos: [], responsable: '', situacion: '' });
        const q = $('seg-q');
        if (q) q.value = '';
        renderTodo();
    }
    const subdirUnica = () => state.filtros.subdirecciones.length === 1 ? state.filtros.subdirecciones[0] : '';

    /* ==========================================================================
       Pintado general
       ========================================================================== */
    function renderPronto() {
        if (!seccionActiva()) { state.sucio = true; return; }
        if (state.pintando) return;
        state.pintando = raf(() => { state.pintando = 0; renderTodo(); });
    }

    function renderTodo() {
        if (!$('seg-body') || !state.cargado) return;
        state.sucio = false;
        pintarKpis();
        pintarChips();
        pintarAlerta();
        pintarHerramientas();
        pintarVista();
        pintarVivo();
    }

    function pintarHerramientas() {
        document.querySelectorAll('#seg-views .seg-view').forEach(b => {
            const on = b.dataset.vista === state.vista;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const ag = $('seg-btn-agrupar');
        if (ag) {
            ag.hidden = state.vista !== 'lista';
            const a = C.AGRUPACIONES.find(x => x.clave === state.agrupar);
            $('seg-agrupar-txt').textContent = a ? (a.clave === 'ninguno' ? 'Sin agrupar' : 'Por ' + a.nombre.toLowerCase()) : '';
        }
        const ce = $('seg-btn-cerradas');
        if (ce) {
            ce.classList.toggle('is-on', state.filtros.verCerradas);
            ce.querySelector('i').className = 'fas fa-' + (state.filtros.verCerradas ? 'eye' : 'eye-slash');
            ce.dataset.tip = state.filtros.verCerradas ? 'Ocultar cerradas' : 'Mostrar cerradas';
            ce.dataset.tipSub = state.filtros.verCerradas ? 'Deja a la vista sólo lo que sigue abierto.' : 'Incluye también las completadas y canceladas.';
            ce.hidden = state.vista === 'resumen';
        }
        const n = nFiltrosDetalle();
        const badge = $('seg-nfiltros');
        if (badge) { badge.hidden = !n; badge.textContent = n; }
        $('seg-btn-filtros')?.classList.toggle('is-on', n > 0);
    }

    function pintarKpis() {
        const el = $('seg-kpis');
        if (!el) return;
        const f = state.filtros;
        const s = C.estadisticas(alcance(), hoy());
        const enCurso = ['en_proceso', 'en_revision', 'detenida'];
        const igual = (a, b) => a.length === b.length && a.every(x => b.includes(x));
        const kpis = [
            { id: 'abiertas', lbl: 'Pendientes', ico: 'list-check', c: '#4f46e5', val: s.abiertas,
              sub: s.pendientes + ' sin iniciar · ' + s.en_proceso + ' en curso', on: !f.situacion && !f.estatus.length,
              ayuda: 'Todo lo que sigue abierto. Clic para ver la lista completa.' },
            { id: 'vencidas', lbl: 'Vencidas', ico: 'triangle-exclamation', c: '#dc2626', val: s.vencidas,
              sub: s.vencidas ? 'Requieren atención hoy' : 'Nada vencido', on: f.situacion === 'vencida',
              ayuda: 'Su fecha límite ya pasó y siguen abiertas. Clic para ver sólo esas.' },
            { id: 'por_vencer', lbl: 'Por vencer', ico: 'hourglass-half', c: '#d97706', val: s.por_vencer,
              sub: 'Dentro de su plazo de aviso', on: f.situacion === 'por_vencer',
              ayuda: 'Vencen pronto: ya entraron en los días de aviso de cada tarea. Clic para verlas.' },
            { id: 'en_curso', lbl: 'En curso', ico: 'circle-half-stroke', c: '#2563eb', val: s.en_proceso,
              sub: 'En proceso, revisión o detenidas', on: igual(f.estatus, enCurso),
              ayuda: 'Ya se empezaron pero no se terminan. Clic para verlas.' },
            { id: 'completadas', lbl: 'Completadas', ico: 'circle-check', c: '#16a34a', val: s.completadas,
              sub: s.completadas_mes + ' este mes', on: igual(f.estatus, ['completada']),
              ayuda: 'Tareas palomeadas como hechas. Clic para verlas.' },
            { id: 'cumplimiento', lbl: 'A tiempo', ico: 'bullseye', c: '#0891b2', val: s.cumplimiento == null ? '—' : s.cumplimiento + '%',
              sub: s.con_fecha_cerradas ? s.a_tiempo + ' de ' + s.con_fecha_cerradas + ' cerradas en fecha' : 'Aún sin cierres con fecha', on: false,
              ayuda: 'De las que se cerraron con fecha límite, cuántas se hicieron a tiempo. Clic para ver el resumen.' },
        ];
        el.innerHTML = kpis.map(k =>
            '<button type="button" class="seg-kpi' + (k.on ? ' is-active' : '') + '" style="--c:' + k.c + '" data-kpi="' + k.id + '"' +
            tip(k.lbl + ': ' + k.val, k.ayuda, { c: k.c }) + '>' +
            '<div class="seg-kpi-lbl"><i class="fas fa-' + k.ico + '"></i>' + k.lbl + '</div>' +
            '<div class="seg-kpi-val">' + esc(k.val) + '</div><div class="seg-kpi-sub">' + esc(k.sub) + '</div></button>').join('');
    }

    function clicKpi(id) {
        const f = state.filtros;
        const enCurso = ['en_proceso', 'en_revision', 'detenida'];
        if (id === 'cumplimiento') { state.vista = 'resumen'; guardarPrefs(); renderTodo(); return; }
        if (state.vista === 'resumen') state.vista = 'lista';
        if (id === 'abiertas') { f.situacion = ''; f.estatus = []; }
        else if (id === 'vencidas' || id === 'por_vencer') { f.estatus = []; f.situacion = f.situacion === id ? '' : id; }
        else if (id === 'en_curso') { f.situacion = ''; f.estatus = f.estatus.length === 3 && f.estatus.every(x => enCurso.includes(x)) ? [] : enCurso.slice(); }
        else if (id === 'completadas') { f.situacion = ''; f.estatus = f.estatus.length === 1 && f.estatus[0] === 'completada' ? [] : ['completada']; }
        guardarPrefs();
        renderTodo();
    }

    function pintarChips() {
        const el = $('seg-chips');
        if (!el) return;
        const base = C.filtrar(state.tareas, Object.assign({}, state.filtros, { subdirecciones: [], situacion: '', estatus: [], verCerradas: false }), hoy());
        const sel = state.filtros.subdirecciones;
        el.innerHTML = '<button type="button" class="seg-chip' + (sel.length ? '' : ' is-on') + '" data-sd="" style="--c:#4f46e5"' +
            tip('Todas las subdirecciones', plural(base.length, 'tarea abierta', 'tareas abiertas'), { ico: 'layer-group' }) + '>' +
            '<i class="fas fa-layer-group" style="color:var(--seg-accent)"></i>Todas<span class="seg-chip-n">' + base.length + '</span></button>' +
            C.SUBDIRECCIONES.map(s => {
                const delSd = base.filter(t => t.subdireccion === s.clave);
                const n = delSd.length;
                const venc = delSd.filter(t => C.situacion(t, hoy()) === 'vencida').length;
                return '<button type="button" class="seg-chip' + (sel.includes(s.clave) ? ' is-on' : '') + '" data-sd="' + s.clave + '" style="--c:' + s.color + '"' +
                    tip(s.nombre, plural(n, 'abierta', 'abiertas') + (venc ? ' · ' + plural(venc, 'vencida', 'vencidas') : '') + '. Clic para ver sólo esta; puedes elegir varias.', { c: s.color }) + '>' +
                    '<span class="seg-chip-dot"></span>' + esc(s.corto) + '<span class="seg-chip-n">' + n + '</span></button>';
            }).join('');
    }

    function pintarAlerta() {
        const el = $('seg-alerta');
        if (!el) return;
        const h = hoy();
        const lista = alcance().filter(C.estaAbierta);
        const venc = lista.filter(t => C.situacion(t, h) === 'vencida').sort((a, b) => (a.fecha_limite < b.fecha_limite ? -1 : 1));
        const pronto = lista.filter(t => ['vence_hoy', 'por_vencer'].includes(C.situacion(t, h)));
        el.className = 'seg-alerta';
        if (venc.length) {
            const peor = venc[0];
            el.innerHTML = '<i class="fas fa-triangle-exclamation"></i><div class="seg-alerta-txt"><b>' + plural(venc.length, 'tarea vencida', 'tareas vencidas') + '</b>' +
                (pronto.length ? ' y ' + plural(pronto.length, 'por vencer', 'por vencer') : '') +
                '. La más atrasada: «' + esc(recortar(peor.titulo, 70)) + '» (' + esc(C.relativo(peor.fecha_limite, h)) + ').</div>' +
                '<button type="button" class="seg-btn seg-btn-sm" data-alerta="vencida"><i class="fas fa-eye"></i>Ver vencidas</button>';
        } else if (pronto.length) {
            el.classList.add('is-warn');
            el.innerHTML = '<i class="fas fa-hourglass-half"></i><div class="seg-alerta-txt"><b>' + plural(pronto.length, 'tarea', 'tareas') + '</b> dentro de su plazo de aviso. Buen momento para recordar al responsable.</div>' +
                '<button type="button" class="seg-btn seg-btn-sm" data-alerta="por_vencer"><i class="fas fa-eye"></i>Ver</button>';
        } else {
            el.innerHTML = '';
        }
    }

    function pintarVista() {
        const body = $('seg-body');
        if (!body) return;
        // Si se estaba escribiendo una tarea rápida, se conserva tras repintar.
        const act = document.activeElement;
        const rapida = act && body.contains(act) && act.dataset && act.dataset.add != null
            ? { clave: act.dataset.add, valor: act.value, pos: act.selectionStart } : null;
        const h = hoy();
        if (!state.tareas.length && state.vista !== 'resumen') {
            body.innerHTML = vacioInicial();
        } else if (state.vista === 'tablero') body.innerHTML = htmlTablero(h);
        else if (state.vista === 'calendario') body.innerHTML = htmlCalendario(h);
        else if (state.vista === 'cronograma') body.innerHTML = htmlCronograma(h);
        else if (state.vista === 'resumen') body.innerHTML = htmlResumen(h);
        else body.innerHTML = htmlLista(h);
        if (rapida) {
            const inp = body.querySelector('input[data-add="' + cssEsc(rapida.clave) + '"]');
            if (inp) { inp.value = rapida.valor; inp.focus(); try { inp.setSelectionRange(rapida.pos, rapida.pos); } catch (_) { /* nada */ } }
        }
    }

    function vacioInicial() {
        const ideas = [
            { tipo: 'certificado', titulo: 'Renovación de certificado', ico: 'certificate', recurrencia: 'anual', aviso: 60 },
            { tipo: 'renovacion', titulo: 'Renovación de contrato de servicio', ico: 'rotate', recurrencia: 'anual', aviso: 90 },
            { tipo: 'orden', titulo: 'Orden de la Dirección', ico: 'bullhorn', recurrencia: 'ninguna', aviso: 3 },
            { tipo: 'compromiso', titulo: 'Compromiso de comité', ico: 'handshake', recurrencia: 'ninguna', aviso: 7 },
        ];
        return '<div class="seg-empty"><div class="seg-empty-ico"><i class="fas fa-list-check"></i></div>' +
            '<h3>Empieza a darle seguimiento a las órdenes</h3>' +
            '<p>Registra lo que se le encarga a cada subdirección, las renovaciones de contratos y certificados con su vencimiento, ' +
            'y los compromisos de reuniones. El sistema avisa lo que está por vencer y lo que ya se pasó.</p>' +
            (puedeEditar()
                ? '<button type="button" class="seg-btn seg-btn-primary" data-accion="nueva"><i class="fas fa-plus"></i>Crear la primera tarea</button>' +
                  '<div class="seg-ideas">' + ideas.map(i =>
                    '<button type="button" class="seg-btn seg-btn-sm" data-accion="idea" data-tipo="' + i.tipo + '" data-titulo="' + esc(i.titulo) + '" data-recurrencia="' + i.recurrencia + '" data-aviso="' + i.aviso + '">' +
                    '<i class="fas fa-' + i.ico + '"></i>' + esc(i.titulo) + '</button>').join('') + '</div>'
                : '<p>Todavía no hay tareas registradas.</p>') +
            '</div>';
    }

    /* ==========================================================================
       Vista: Lista
       ========================================================================== */
    function htmlLista(h) {
        const vis = visibles();
        const todas = alcance();
        const gruposTodo = new Map(C.agrupar(todas, state.agrupar, h).map(g => [g.clave, g.tareas]));
        let grupos = C.agrupar(vis, state.agrupar, h);
        if (state.agrupar === 'subdireccion') {
            if (state.filtros.subdirecciones.length) grupos = grupos.filter(g => state.filtros.subdirecciones.includes(g.clave));
            else if (hayFiltros()) grupos = grupos.filter(g => g.tareas.length);
        }
        state.gruposPintados = new Map(grupos.map(g => [g.clave, g]));
        if (!grupos.length || grupos.every(g => !g.tareas.length) && state.agrupar !== 'subdireccion') {
            return '<div class="seg-empty"><div class="seg-empty-ico"><i class="fas fa-magnifying-glass"></i></div><h3>Nada coincide</h3>' +
                '<p>No hay tareas con estos filtros' + (state.filtros.verCerradas ? '' : ' (las cerradas están ocultas)') + '.</p>' +
                '<button type="button" class="seg-btn" data-accion="quitar-filtros"><i class="fas fa-filter-circle-xmark"></i>Quitar filtros</button></div>';
        }
        return grupos.map(g => htmlGrupo(g, gruposTodo.get(g.clave) || [], h)).join('');
    }

    function htmlEncabezado() {
        const col = (campo, txt) => {
            const on = state.orden.campo === campo;
            return '<button type="button" class="seg-sort' + (on ? ' is-on' : '') + '" data-accion="ordenar" data-campo="' + campo + '">' + txt +
                (on ? '<i class="fas fa-arrow-' + (state.orden.asc ? 'up' : 'down') + '"></i>' : '') + '</button>';
        };
        return '<div class="seg-tr seg-th" role="row">' +
            '<div role="columnheader" class="seg-th-hecha"' + tip('Hecha', 'Palomea la casilla cuando la tarea ya se cumplió.', { ico: 'square-check' }) + '>Hecha</div>' +
            '<div role="columnheader">' + col('titulo', 'Nombre') + '</div>' +
            '<div role="columnheader">Comentarios</div>' +
            '<div role="columnheader"><i class="fab fa-whatsapp seg-th-wa"></i>Recordatorio</div>' +
            '<div role="columnheader">' + col('responsable', 'Responsable') + '</div>' +
            '<div role="columnheader">' + col('fecha_limite', 'Fecha límite') + '</div>' +
            '<div role="columnheader">' + col('prioridad', 'Prioridad') + '</div>' +
            '<div role="columnheader">' + col('estatus', 'Estatus') + '</div></div>';
    }

    function htmlGrupo(g, todasDelGrupo, h) {
        const reales = todasDelGrupo.filter(t => t.estatus !== 'cancelada');
        const hechas = reales.filter(t => t.estatus === 'completada').length;
        const venc = reales.filter(t => C.situacion(t, h) === 'vencida').length;
        const porV = reales.filter(t => ['por_vencer', 'vence_hoy'].includes(C.situacion(t, h))).length;
        const pct = reales.length ? Math.round(hechas * 100 / reales.length) : 0;
        const llave = state.agrupar + ':' + g.clave;
        const col = state.colapsados.includes(llave);
        const ed = puedeEditar();
        return '<section class="seg-group' + (col ? ' is-collapsed' : '') + '">' +
            '<header class="seg-group-head" data-accion="grupo" data-grupo="' + esc(g.clave) + '" aria-expanded="' + (!col) + '">' +
              '<span class="seg-caret"><i class="fas fa-chevron-down"></i></span>' +
              '<span class="seg-group-pill" style="--c:' + g.color + '"><i class="fas fa-' + g.icono + '"></i>' + esc(g.nombre) + '</span>' +
              '<span class="seg-group-n">' + g.tareas.length + '</span>' +
              (reales.length ? '<span class="seg-group-prog"><span class="seg-mini-bar"><span style="width:' + pct + '%"></span></span>' + hechas + '/' + reales.length + ' completadas</span>' : '') +
              (venc ? '<span class="seg-group-flag is-danger"><i class="fas fa-triangle-exclamation"></i> ' + plural(venc, 'vencida', 'vencidas') + '</span>' : '') +
              (porV ? '<span class="seg-group-flag is-warn">' + porV + ' por vencer</span>' : '') +
              (ed ? '<button type="button" class="seg-btn seg-btn-sm seg-btn-ghost seg-group-add" data-accion="grupo-nueva" data-grupo="' + esc(g.clave) + '"><i class="fas fa-plus"></i>Tarea</button>' : '') +
            '</header>' +
            '<div class="seg-table" role="table" aria-label="' + esc(g.nombre) + '">' +
              htmlEncabezado() +
              (g.tareas.length ? g.tareas.map(t => htmlFila(t, h)).join('')
                : '<div class="seg-group-vacio">' + (hayFiltros() ? 'Nada con estos filtros.' : 'Sin tareas abiertas.') + '</div>') +
              (ed ? '<div class="seg-add-row"><i class="fas fa-plus"></i><input type="text" data-add="' + esc(g.clave) + '" maxlength="300" placeholder="Agregar tarea" aria-label="Agregar tarea en ' + esc(g.nombre) + '"><span class="seg-add-hint">Enter para guardar</span></div>' : '') +
            '</div></section>';
    }

    function htmlFila(t, h) {
        const sit = C.situacion(t, h);
        const est = C.EST[t.estatus] || C.ESTATUS[0];
        const prio = C.PRIO[t.prioridad] || C.PRIO.normal;
        const tipo = C.TIPO[t.tipo] || C.TIPO.tarea;
        const sd = C.SUBDIR[t.subdireccion];
        const ck = C.avanceChecklist(t);
        const nC = state.nComent.get(t.id) || 0;
        const cerrada = !C.estaAbierta(t);
        const ed = puedeEditar();
        const dis = ed ? '' : ' disabled';
        const meta = ['<span class="seg-tipo"><i class="fas fa-' + tipo.icono + '"></i>' + esc(tipo.nombre) + '</span>', '<span>' + C.folio(t.folio) + '</span>'];
        if (state.agrupar !== 'subdireccion' && sd) meta.push('<span style="color:' + sd.color + '">' + esc(sd.corto) + '</span>');
        if (t.gerencia) meta.push('<span>' + esc(t.gerencia) + '</span>');
        const tags = [];
        if (ck.total) tags.push('<span class="seg-tag' + (ck.hechos === ck.total ? ' is-ok' : '') + '"' + tipSubtareas(t) + '><i class="fas fa-list-check"></i>' + ck.hechos + '/' + ck.total + '</span>');
        if (C.mesesRecurrencia(t)) tags.push('<span class="seg-tag"' + tipRepeticion(t) + '><i class="fas fa-repeat"></i>' + esc(C.nombreRecurrencia(t)) + '</span>');
        const nEv = (t.evidencias || []).length;
        if (nEv) tags.push('<span class="seg-tag"' + tip(plural(nEv, 'evidencia adjunta', 'evidencias adjuntas'), (t.evidencias || []).map(e => e.nombre).slice(0, 4).join(' · '), { ico: 'paperclip' }) + '><i class="fas fa-paperclip"></i>' + nEv + '</span>');
        if (t.referencia) tags.push('<span class="seg-tag"' + tip('Referencia', t.referencia, { ico: 'file-lines' }) + '><i class="fas fa-file-lines"></i>' + esc(recortar(t.referencia, 32)) + '</span>');
        (t.etiquetas || []).slice(0, 3).forEach(e => tags.push('<span class="seg-tag is-label">#' + esc(e) + '</span>'));
        let fecha;
        if (!t.fecha_limite) fecha = '<span class="seg-fecha is-vacia"><b>Sin fecha</b></span>';
        else {
            const sub = t.estatus === 'completada'
                ? (t.completada_en ? 'cerrada ' + C.fechaCorta(C.aISO(new Date(t.completada_en))) : 'cerrada')
                : cerrada ? '' : C.relativo(t.fecha_limite, h);
            fecha = '<span class="seg-fecha is-' + (cerrada ? 'cerrada' : sit) + '"><b>' + C.fechaCorta(t.fecha_limite) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>';
        }
        const tel = C.telefonoWhatsApp(t.responsable_tel);
        const waTitle = tel ? 'Enviar recordatorio por WhatsApp a ' + (t.responsable || 'el responsable') : 'Recordatorio por WhatsApp (falta el número)';
        const nombreSit = { vencida: 'Venció', vence_hoy: 'Vence hoy', por_vencer: 'Vence', a_tiempo: 'Vence' }[sit];
        const tipFecha = t.fecha_limite
            ? tip(C.fechaLarga(t.fecha_limite), cerrada ? (t.estatus === 'completada' ? 'Ya está hecha.' : 'Cancelada.')
                : (nombreSit === 'Vence hoy' ? 'Vence hoy' : nombreSit + ' ' + C.relativo(t.fecha_limite, h)) + ' · avisa ' + plural(+t.aviso_dias || 0, 'día', 'días') + ' antes.' + (ed ? ' Clic para cambiarla.' : ''),
                { ico: 'calendar-check', c: sit === 'vencida' ? '#dc2626' : ['por_vencer', 'vence_hoy'].includes(sit) ? '#d97706' : '' })
            : tip('Sin fecha límite', ed ? 'Clic para ponerle una: así el sistema avisa antes de que venza.' : 'No tiene fecha límite.', { ico: 'calendar' });
        return '<div class="seg-tr seg-row is-' + sit + (cerrada ? ' is-cerrada' : '') + '" data-id="' + t.id + '" role="row" tabindex="0">' +
            '<div class="seg-td seg-td-hecha" role="cell">' + htmlHecho(t, dis) + '</div>' +
            '<div class="seg-td seg-td-nombre" role="cell">' +
              '<div class="seg-nombre"><div class="seg-meta">' + meta.join('<span>·</span>') + '</div>' +
                '<div class="seg-titulo">' + esc(t.titulo) + '</div>' + (tags.length ? '<div class="seg-tags">' + tags.join('') + '</div>' : '') + '</div>' +
            '</div>' +
            '<div class="seg-td" role="cell"><button type="button" class="seg-cell-btn' + (nC ? ' has-n' : '') + '" data-accion="comentarios"' + tip(nC ? plural(nC, 'comentario', 'comentarios') : 'Sin comentarios', nC ? 'Clic para leerlos o escribir un avance.' : 'Clic para escribir el primer avance.', { ico: 'comments' }) + '><i class="far fa-comment"></i>' + (nC || '') + '</button></div>' +
            '<div class="seg-td" role="cell"><div class="seg-wa-cell"><button type="button" class="seg-wa' + (tel ? '' : ' is-sin-tel') + '" data-accion="whatsapp"' + tipWhatsApp(t) + ' aria-label="' + esc(waTitle) + '"><i class="fab fa-whatsapp"></i></button>' +
              (t.ultimo_recordatorio ? '<small' + tip('Último recordatorio', new Date(t.ultimo_recordatorio).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }), { ico: 'clock-rotate-left' }) + '>' + esc(hace(t.ultimo_recordatorio)) + '</small>' : '') + '</div></div>' +
            '<div class="seg-td" role="cell"><button type="button" class="seg-cell-btn seg-resp" data-accion="responsable"' + dis +
              (t.responsable ? tip(t.responsable, [t.responsable_tel ? 'WhatsApp ' + t.responsable_tel : 'Sin WhatsApp registrado', ed ? 'Clic para cambiar' : ''].filter(Boolean).join(' · '), { ico: 'user' })
                : tip('Sin responsable', ed ? 'Clic para asignar a alguien del directorio.' : '', { ico: 'user-plus' })) + '>' + avatar(t.responsable) +
              '<span class="seg-resp-nombre">' + esc(t.responsable || 'Asignar') + '</span></button></div>' +
            '<div class="seg-td" role="cell"><button type="button" class="seg-cell-btn" data-accion="fecha"' + dis + tipFecha + '>' + fecha + '</button></div>' +
            '<div class="seg-td" role="cell"><button type="button" class="seg-cell-btn seg-prio" style="--c:' + prio.color + '" data-accion="prioridad"' + dis +
              tip('Prioridad ' + prio.nombre.toLowerCase(), ed ? 'Clic para cambiarla.' : '', { c: prio.color }) + '><i class="fas fa-flag"></i>' + prio.nombre + '</button></div>' +
            '<div class="seg-td" role="cell"><button type="button" class="seg-pill" style="--c:' + est.color + '" data-accion="estatus"' + dis +
              tip('Estatus: ' + est.nombre, ed ? 'Clic para cambiarlo.' : '', { c: est.color }) + '>' + est.nombre + (ed ? '<i class="fas fa-chevron-down"></i>' : '') + '</button></div>' +
            '</div>';
    }

    /** La casilla para palomear que ya se hizo. */
    function htmlHecho(t, dis, chica) {
        const hecha = t.estatus === 'completada';
        const txt = hecha ? 'Hecha. Clic para reabrir' : 'Marcar como hecha';
        const cuando = hecha && t.completada_en ? 'Se completó el ' + C.fechaLarga(C.aISO(new Date(t.completada_en))) + '. ' : '';
        const sub = hecha ? cuando + 'Clic para reabrirla.'
            : C.mesesRecurrencia(t) && t.fecha_limite ? 'Al palomearla se programa sola la siguiente (' + C.nombreRecurrencia(t).toLowerCase() + ').'
            : 'Palomea cuando ya se cumplió.';
        return '<button type="button" class="seg-hecho' + (hecha ? ' is-done' : '') + (chica ? ' seg-hecho-sm' : '') + '" data-accion="completar"' + (dis || '') +
            tip(hecha ? 'Hecha' : 'Marcar como hecha', dis ? '' : sub, { c: hecha ? '#16a34a' : '' }) + ' aria-label="' + txt + '" aria-pressed="' + hecha + '"><i class="fas fa-check"></i></button>';
    }

    function tipSubtareas(t) {
        const items = Array.isArray(t.checklist) ? t.checklist : [];
        const falta = items.filter(i => !i.hecho).map(i => '▫ ' + i.texto);
        const ck = C.avanceChecklist(t);
        return tip('Subtareas: ' + ck.hechos + ' de ' + ck.total + ' hechas', falta.length ? 'Falta: ' + falta.slice(0, 4).join('  ') + (falta.length > 4 ? '…' : '') : 'Todas hechas.', { ico: 'list-check' });
    }

    function tipRepeticion(t) {
        const m = C.mesesRecurrencia(t);
        return tip('Se repite ' + C.nombreRecurrencia(t).toLowerCase(), t.fecha_limite ? 'Al completarla se programa la siguiente para el ' + C.fechaLarga(C.sumarMeses(t.fecha_limite, m)) + '.' : 'Ponle fecha límite para programar la siguiente.', { ico: 'repeat' });
    }

    function tipWhatsApp(t) {
        const tel = C.telefonoWhatsApp(t.responsable_tel);
        return tel
            ? tip('Recordar por WhatsApp', 'A ' + (t.responsable || 'el responsable') + ' · ' + t.responsable_tel + '. Abre WhatsApp con el mensaje listo.', { ico: 'fab fa-whatsapp' })
            : tip('Recordar por WhatsApp', 'Falta el número: te lo pido y lo guardo para la próxima.', { ico: 'fab fa-whatsapp' });
    }

    /** Lo que una tarea nueva hereda del grupo donde se escribió. */
    function baseDeGrupo(clave) {
        const b = {};
        const g = state.gruposPintados.get(clave);
        if (state.agrupar === 'subdireccion') b.subdireccion = clave;
        else if (state.agrupar === 'estatus') b.estatus = clave;
        else if (state.agrupar === 'prioridad') b.prioridad = clave;
        else if (state.agrupar === 'tipo') b.tipo = clave;
        else if (state.agrupar === 'responsable' && g && g.nombre !== 'Sin responsable') b.responsable = g.nombre;
        if (!b.subdireccion && subdirUnica()) b.subdireccion = subdirUnica();
        return b;
    }

    async function crearRapida(input) {
        const titulo = String(input.value || '').trim();
        if (!titulo) return;
        const clave = input.dataset.add;
        const base = baseDeGrupo(clave);
        if (!base.subdireccion) { input.value = ''; nuevaTarea(Object.assign(base, { titulo })); return; }
        input.disabled = true;
        const nueva = await crearEnBase(Object.assign({ titulo, tipo: 'orden', prioridad: 'normal', estatus: 'pendiente' }, base));
        input.disabled = false;
        if (!nueva) return;
        input.value = '';
        renderTodo();
        const inp = document.querySelector('#seg-body input[data-add="' + cssEsc(clave) + '"]');
        if (inp) inp.focus();
        destellar(nueva.id);
    }

    function destellar(id) {
        raf(() => {
            const fila = document.querySelector('#seg-body [data-id="' + cssEsc(id) + '"]');
            if (!fila) return;
            fila.classList.add('is-flash');
            if (typeof fila.scrollIntoView === 'function') fila.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            setTimeout(() => fila.classList.remove('is-flash'), 1700);
        });
    }

    /* ==========================================================================
       Vista: Tablero
       ========================================================================== */
    function htmlTablero(h) {
        const vis = visibles();
        const ids = new Set(vis.map(t => t.id));
        // Las recién completadas se ven aunque las cerradas estén ocultas: así
        // el tablero muestra lo que se va cerrando.
        const recientes = state.filtros.verCerradas ? [] : alcance().filter(t => t.estatus === 'completada' && !ids.has(t.id)
            && t.completada_en && (Date.now() - new Date(t.completada_en).getTime()) / 864e5 <= 14);
        const tareas = vis.concat(recientes);
        const ed = puedeEditar();
        return '<div class="seg-board">' + C.ESTATUS.filter(e => e.clave !== 'cancelada' || state.filtros.verCerradas).map(e => {
            const lista = C.ordenar(tareas.filter(t => t.estatus === e.clave), state.orden.campo, state.orden.asc);
            return '<div class="seg-col" style="--c:' + e.color + '"' + (ed ? ' data-drop-estatus="' + e.clave + '"' : '') + '>' +
                '<div class="seg-col-head"><span class="seg-pill" style="--c:' + e.color + '">' + e.nombre + '</span><span class="seg-group-n">' + lista.length + '</span>' +
                (e.clave === 'completada' && recientes.length ? '<span class="seg-group-n" style="margin-left:auto;font-size:.68rem">últimos 14 días</span>' : '') + '</div>' +
                '<div class="seg-col-body">' + (lista.map(t => htmlTarjeta(t, h)).join('') || '<div class="seg-col-vacia">Arrastra aquí una tarea</div>') +
                (ed && C.ABIERTOS.includes(e.clave) ? '<button type="button" class="seg-col-add" data-accion="col-nueva" data-estatus="' + e.clave + '"><i class="fas fa-plus me-1"></i>Agregar</button>' : '') +
                '</div></div>';
        }).join('') + '</div>';
    }

    function htmlTarjeta(t, h) {
        const sit = C.situacion(t, h);
        const sd = C.SUBDIR[t.subdireccion] || { corto: t.subdireccion, color: '#64748b', icono: 'sitemap' };
        const prio = C.PRIO[t.prioridad] || C.PRIO.normal;
        const ck = C.avanceChecklist(t);
        const nC = state.nComent.get(t.id) || 0;
        const cerrada = !C.estaAbierta(t);
        return '<div class="seg-card is-' + sit + '" data-id="' + t.id + '"' + (puedeEditar() ? ' draggable="true"' : '') + ' tabindex="0">' +
            '<div class="seg-card-sd" style="--c:' + sd.color + '"><i class="fas fa-' + sd.icono + '"></i><span>' + esc(sd.corto) + '</span><span class="seg-card-folio">' + C.folio(t.folio) + '</span></div>' +
            '<div class="seg-card-title">' + htmlHecho(t, puedeEditar() ? '' : ' disabled', true) + '<span>' + esc(t.titulo) + '</span></div>' +
            '<div class="seg-card-foot">' +
              '<span class="seg-fecha is-' + (t.fecha_limite ? (cerrada ? 'cerrada' : sit) : 'vacia') + '"><i class="far fa-calendar"></i><b>' + (t.fecha_limite ? C.fechaCorta(t.fecha_limite) : 'Sin fecha') + '</b></span>' +
              '<span class="seg-card-icons">' +
                '<i class="fas fa-flag" style="color:' + prio.color + '"' + tip('Prioridad ' + prio.nombre.toLowerCase(), '', { c: prio.color }) + '></i>' +
                (ck.total ? '<span' + tipSubtareas(t) + '><i class="fas fa-list-check"></i> ' + ck.hechos + '/' + ck.total + '</span>' : '') +
                (nC ? '<span' + tip(plural(nC, 'comentario', 'comentarios'), 'Abre la tarea para leerlos.', { ico: 'comments' }) + '><i class="far fa-comment"></i> ' + nC + '</span>' : '') +
                (C.mesesRecurrencia(t) ? '<i class="fas fa-repeat"' + tipRepeticion(t) + '></i>' : '') +
              '</span>' + avatar(t.responsable, true) +
            '</div></div>';
    }

    /* ==========================================================================
       Vista: Calendario
       ========================================================================== */
    function htmlCalendario(h) {
        const mes = state.cal || h.slice(0, 7);
        const y = +mes.slice(0, 4), m = +mes.slice(5, 7);
        const primero = new Date(y, m - 1, 1, 12);
        const offset = (primero.getDay() + 6) % 7;
        const inicio = C.sumarDias(C.aISO(primero), -offset);
        const diasMes = new Date(y, m, 0).getDate();
        const celdas = Math.ceil((offset + diasMes) / 7) * 7;
        const vis = visibles();
        const porDia = new Map();
        vis.forEach(t => { if (t.fecha_limite) { if (!porDia.has(t.fecha_limite)) porDia.set(t.fecha_limite, []); porDia.get(t.fecha_limite).push(t); } });
        const sinFecha = vis.filter(t => !t.fecha_limite).length;
        const ed = puedeEditar();
        let html = '<div class="seg-cal"><div class="seg-cal-head">' +
            '<button type="button" class="seg-icon-btn" data-accion="cal-mover" data-n="-1" aria-label="Mes anterior"><i class="fas fa-chevron-left"></i></button>' +
            '<h3>' + C.MESES_LARGOS[m - 1] + ' ' + y + '</h3>' +
            '<button type="button" class="seg-icon-btn" data-accion="cal-mover" data-n="1" aria-label="Mes siguiente"><i class="fas fa-chevron-right"></i></button>' +
            '<button type="button" class="seg-btn seg-btn-sm" data-accion="cal-hoy">Hoy</button>' +
            '<span class="seg-cal-nota">' + (sinFecha ? plural(sinFecha, 'tarea sin fecha', 'tareas sin fecha') + ' · ' : '') +
            (ed ? 'Arrastra una tarea para cambiar su fecha límite · clic en un día para crear' : 'Fechas límite del mes') + '</span></div>' +
            '<div class="seg-cal-grid">' + DIAS_SEMANA.map(d => '<div class="seg-cal-dow">' + d + '</div>').join('');
        for (let i = 0; i < celdas; i++) {
            const iso = C.sumarDias(inicio, i);
            const d = C.deISO(iso);
            const lista = C.ordenar(porDia.get(iso) || [], 'prioridad', true);
            const max = 3;
            html += '<div class="seg-cal-day' + (d.getMonth() !== m - 1 ? ' is-otro' : '') + (iso === h ? ' is-hoy' : '') + '"' +
                (ed ? ' data-accion="cal-dia" data-drop-fecha="' + iso + '"' : '') + ' data-fecha="' + iso + '">' +
                '<span class="seg-cal-num">' + d.getDate() + '</span>' +
                lista.slice(0, max).map(t => {
                    const sd = C.SUBDIR[t.subdireccion] || { color: '#64748b' };
                    const sit = C.situacion(t, h);
                    const prio = C.PRIO[t.prioridad] || C.PRIO.normal;
                    return '<div class="seg-cal-ev' + (sit === 'vencida' ? ' is-vencida' : '') + (C.estaAbierta(t) ? '' : ' is-cerrada') + '" data-id="' + t.id + '" style="--c:' + sd.color + '"' +
                        (ed ? ' draggable="true"' : '') + tip(t.titulo, [(C.SUBDIR[t.subdireccion] || {}).corto, (C.EST[t.estatus] || {}).nombre, t.responsable].filter(Boolean).join(' · ') +
                            (ed ? '. Arrástrala a otro día para cambiar la fecha.' : ''), { c: sd.color }) + '>' +
                        '<i class="fas fa-flag" style="color:' + prio.color + ';font-size:.6rem"></i><span>' + esc(t.titulo) + '</span></div>';
                }).join('') +
                (lista.length > max ? '<button type="button" class="seg-cal-mas" data-accion="cal-mas" data-fecha="' + iso + '">+' + (lista.length - max) + ' más</button>' : '') +
                '</div>';
        }
        return html + '</div></div>';
    }

    /* ==========================================================================
       Vista: Cronograma
       ========================================================================== */
    function htmlCronograma(h) {
        const g = state.gantt;
        const semanas = g.escala === 'semanas';
        const lunesHoy = C.sumarDias(h, -((C.deISO(h).getDay() + 6) % 7));
        const inicio = g.inicio || C.sumarDias(lunesHoy, semanas ? -7 : -28);
        const dias = semanas ? 42 : 182;
        const fin = C.sumarDias(inicio, dias - 1);
        const ncols = semanas ? 42 : 26;
        const cols = [];
        for (let i = 0; i < ncols; i++) {
            const iso = C.sumarDias(inicio, semanas ? i : i * 7);
            const d = C.deISO(iso);
            const finde = semanas && (d.getDay() === 0 || d.getDay() === 6);
            const esHoy = semanas ? iso === h : (C.diasEntre(iso, h) >= 0 && C.diasEntre(iso, h) < 7);
            cols.push({ iso, finde, esHoy, lbl: String(d.getDate()) });
        }
        // Fila de meses encima de los días (o de las semanas).
        const meses = [];
        cols.forEach(c => {
            const k = c.iso.slice(0, 7);
            if (meses.length && meses[meses.length - 1].k === k) meses[meses.length - 1].n++;
            else meses.push({ k, n: 1 });
        });
        const plantilla = 'grid-template-columns:repeat(' + ncols + ',minmax(0,1fr))';
        const fondo = '<div class="seg-gantt-cols" style="' + plantilla + '">' + cols.map(c => '<div' + (c.finde ? ' class="is-finde"' : '') + '></div>').join('') + '</div>';
        const hoyPos = C.diasEntre(inicio, h);
        const lineaHoy = (hoyPos >= 0 && hoyPos < dias) ? (etq) => '<div class="seg-gantt-hoy' + (etq ? ' is-label' : '') + '" style="left:' + ((hoyPos + 0.5) / dias * 100).toFixed(3) + '%"></div>' : () => '';
        const enRango = visibles().filter(t => {
            if (!t.fecha_limite) return false;
            const ini = t.fecha_inicio || t.fecha_limite;
            return ini <= fin && t.fecha_limite >= inicio;
        });
        const sinFecha = visibles().filter(t => !t.fecha_limite).length;
        let filas = '';
        C.SUBDIRECCIONES.forEach(sd => {
            const lista = C.ordenar(enRango.filter(t => t.subdireccion === sd.clave), 'fecha_limite', true);
            if (!lista.length) return;
            filas += '<div class="seg-gantt-row is-grupo"><div class="seg-gantt-label"><span class="seg-group-pill" style="--c:' + sd.color + ';font-size:.72rem;padding:3px 9px"><i class="fas fa-' + sd.icono + '"></i>' + esc(sd.corto) + '</span><span class="seg-group-n">' + lista.length + '</span></div><div class="seg-gantt-track">' + fondo + lineaHoy(false) + '</div></div>';
            lista.forEach(t => {
                const ini = t.fecha_inicio || t.fecha_limite;
                const s = Math.max(0, C.diasEntre(inicio, ini));
                const e = Math.min(dias - 1, C.diasEntre(inicio, t.fecha_limite));
                const sit = C.situacion(t, h);
                const est = C.EST[t.estatus] || C.ESTATUS[0];
                const hito = !t.fecha_inicio || t.fecha_inicio === t.fecha_limite;
                const left = (s / dias * 100).toFixed(3);
                const width = ((e - s + 1) / dias * 100).toFixed(3);
                const estilo = hito ? 'left:calc(' + ((e + 0.5) / dias * 100).toFixed(3) + '% - 8px)' : 'left:' + left + '%;width:' + width + '%';
                filas += '<div class="seg-gantt-row"><div class="seg-gantt-label" data-id="' + t.id + '">' + avatar(t.responsable, true) +
                    '<div style="min-width:0"><div class="seg-titulo">' + esc(t.titulo) + '</div><div class="seg-meta">' + C.folio(t.folio) + ' · ' + C.fechaCorta(t.fecha_limite) + '</div></div></div>' +
                    '<div class="seg-gantt-track">' + fondo + lineaHoy(false) +
                    '<div class="seg-gantt-bar' + (hito ? ' is-hito' : '') + (sit === 'vencida' ? ' is-vencida' : '') + '" data-id="' + t.id + '" style="--c:' + est.color + ';' + estilo + '"' +
                    tip(t.titulo, (t.fecha_inicio ? C.fechaCorta(t.fecha_inicio) + ' → ' : 'Fecha límite: ') + C.fechaCorta(t.fecha_limite) + ' · ' + est.nombre +
                        (sit === 'vencida' ? ' · vencida' : '') + (t.responsable ? ' · ' + t.responsable : ''), { c: est.color }) + '>' +
                    (hito ? '' : esc(t.titulo)) + '</div></div></div>';
            });
        });
        const cab = '<div class="seg-cal-head">' +
            '<button type="button" class="seg-icon-btn" data-accion="gantt-mover" data-n="-1" aria-label="Antes"><i class="fas fa-chevron-left"></i></button>' +
            '<h3 style="min-width:0">' + C.fechaCorta(inicio) + ' – ' + C.fechaCorta(fin) + '</h3>' +
            '<button type="button" class="seg-icon-btn" data-accion="gantt-mover" data-n="1" aria-label="Después"><i class="fas fa-chevron-right"></i></button>' +
            '<button type="button" class="seg-btn seg-btn-sm" data-accion="gantt-hoy">Hoy</button>' +
            '<div style="display:flex;gap:4px;margin-left:8px">' +
              '<button type="button" class="seg-tool' + (semanas ? ' is-on' : '') + '" data-accion="gantt-escala" data-escala="semanas">6 semanas</button>' +
              '<button type="button" class="seg-tool' + (!semanas ? ' is-on' : '') + '" data-accion="gantt-escala" data-escala="meses">6 meses</button></div>' +
            '<span class="seg-cal-nota">' + (sinFecha ? plural(sinFecha, 'tarea sin fecha no aparece', 'tareas sin fecha no aparecen') + ' · ' : '') + 'Barra: de inicio a fecha límite · rombo: sólo fecha límite</span></div>';
        if (!filas) {
            return '<div class="seg-gantt">' + cab + '<div class="seg-vacio-mini" style="padding:40px">No hay tareas con fecha en este periodo.</div></div>';
        }
        return '<div class="seg-gantt">' + cab + '<div class="seg-gantt-scroll"><div class="seg-gantt-inner">' +
            '<div class="seg-gantt-row is-grupo" style="min-height:30px"><div class="seg-gantt-label" style="font-size:.68rem;font-weight:800;color:var(--seg-faint);text-transform:uppercase;letter-spacing:.06em">Tarea</div>' +
            '<div class="seg-gantt-track"><div class="seg-gantt-scale seg-gantt-meses" style="' + plantilla + '">' +
            meses.map(x => '<div style="grid-column:span ' + x.n + '">' +
                esc(x.n > 2 ? C.MESES_LARGOS[+x.k.slice(5) - 1] + ' ' + x.k.slice(0, 4) : C.MESES_LARGOS[+x.k.slice(5) - 1].slice(0, 3)) + '</div>').join('') + '</div>' +
            '<div class="seg-gantt-scale" style="' + plantilla + '">' +
            cols.map(c => '<div' + (c.esHoy ? ' class="is-hoy"' : '') + '>' + esc(c.lbl) + '</div>').join('') + '</div>' + lineaHoy(true) + '</div></div>' +
            filas + '</div></div></div>';
    }

    /* ==========================================================================
       Vista: Resumen
       ========================================================================== */
    function htmlResumen(h) {
        const todas = alcance();
        const s = C.estadisticas(todas, h);
        const sel = state.filtros.subdirecciones;
        const porSd = C.estadisticasPorSubdireccion(todas, h).filter(x => !sel.length || sel.includes(x.clave));
        const abiertas = todas.filter(C.estaAbierta);

        // Estado general: dona por estatus.
        const conteo = C.ESTATUS.filter(e => e.clave !== 'cancelada').map(e => ({ e, n: todas.filter(t => t.estatus === e.clave).length }));
        const total = conteo.reduce((a, x) => a + x.n, 0);
        let acum = 0;
        const segmentos = total ? conteo.filter(x => x.n).map(x => {
            const a = acum / total * 360; acum += x.n; const b = acum / total * 360;
            return x.e.color + ' ' + a.toFixed(2) + 'deg ' + b.toFixed(2) + 'deg';
        }).join(',') : 'var(--seg-border) 0 360deg';
        const dona = '<div class="seg-donut-wrap"><div class="seg-donut" style="background:conic-gradient(' + segmentos + ')"><div class="seg-donut-c"><div><b>' + total + '</b><small>tareas</small></div></div></div>' +
            '<div class="seg-legend">' + conteo.map(x => '<div style="--c:' + x.e.color + '"><i></i>' + x.e.nombre + '<b>' + x.n + '</b></div>').join('') + '</div></div>';

        const mes = h.slice(0, 7);
        const creadasMes = todas.filter(t => String(t.creado_en || '').slice(0, 7) === mes).length;
        const panelCumpl = '<div class="seg-gauge" style="color:' + (s.cumplimiento == null ? 'var(--seg-faint)' : s.cumplimiento >= 85 ? 'var(--seg-ok)' : s.cumplimiento >= 60 ? 'var(--seg-warn)' : 'var(--seg-danger)') + '">' +
            (s.cumplimiento == null ? '—' : s.cumplimiento + '%') + '</div>' +
            '<div style="font-size:.8rem;color:var(--seg-muted);margin:4px 0 14px">' + (s.con_fecha_cerradas ? s.a_tiempo + ' de ' + s.con_fecha_cerradas + ' tareas cerradas se completaron en fecha' : 'Se calcula al cerrar tareas con fecha límite') + '</div>' +
            '<div class="seg-sd-foot" style="margin:0 0 4px"><span>Avance general</span><b>' + s.avance + '%</b></div><div class="seg-bar" style="--c:var(--seg-accent)"><span style="width:' + s.avance + '%"></span></div>';
        const panelMes = '<div class="seg-sd-nums" style="margin:0">' +
            '<div><b>' + creadasMes + '</b><small>Nuevas</small></div><div><b>' + s.completadas_mes + '</b><small>Cerradas</small></div>' +
            '<div class="' + (s.vencidas ? 'is-danger' : '') + '"><b>' + s.vencidas + '</b><small>Vencidas hoy</small></div></div>' +
            '<div style="font-size:.78rem;color:var(--seg-muted);margin-top:12px">' + plural(abiertas.length, 'tarea abierta', 'tareas abiertas') + ' · ' + plural(s.por_vencer, 'por vencer', 'por vencer') + '</div>';

        const sdCards = '<div class="seg-sd-grid">' + porSd.map(x =>
            '<button type="button" class="seg-sd-card" style="--c:' + x.color + '" data-accion="sd" data-sd="' + x.clave + '"' +
            tip(x.nombre, 'Clic para ver su lista de tareas.', { c: x.color }) + '>' +
            '<div class="seg-sd-top"><span class="seg-sd-ico"><i class="fas fa-' + x.icono + '"></i></span><span class="seg-sd-name">' + esc(x.nombre) + '</span></div>' +
            '<div class="seg-sd-nums"><div><b>' + x.abiertas + '</b><small>Abiertas</small></div>' +
            '<div class="' + (x.vencidas ? 'is-danger' : '') + '"><b>' + x.vencidas + '</b><small>Vencidas</small></div>' +
            '<div class="' + (x.por_vencer ? 'is-warn' : '') + '"><b>' + x.por_vencer + '</b><small>Por vencer</small></div></div>' +
            '<div class="seg-bar"><span style="width:' + x.avance + '%"></span></div>' +
            '<div class="seg-sd-foot"><span>' + x.completadas + '/' + x.total + ' completadas</span><span>' + (x.cumplimiento == null ? '' : x.cumplimiento + '% a tiempo') + '</span></div></button>').join('') + '</div>';

        const li = (t, extra) => {
            const sd = C.SUBDIR[t.subdireccion] || { color: '#64748b', corto: '' };
            const sit = C.situacion(t, h);
            return '<div class="seg-li" data-id="' + t.id + '"><span class="seg-li-dot" style="--c:' + sd.color + '"></span>' +
                '<div class="seg-li-txt"><b>' + esc(t.titulo) + '</b><small>' + esc(sd.corto) + (t.responsable ? ' · ' + esc(t.responsable) : '') + '</small></div>' +
                '<span class="seg-li-when is-' + sit + '">' + esc(extra || C.relativo(t.fecha_limite, h)) + '</span>' +
                '<button type="button" class="seg-wa' + (C.telefonoWhatsApp(t.responsable_tel) ? '' : ' is-sin-tel') + '" style="width:28px;height:28px;font-size:.9rem" data-accion="whatsapp"' + tipWhatsApp(t) + '><i class="fab fa-whatsapp"></i></button></div>';
        };
        const vencidas = abiertas.filter(t => C.situacion(t, h) === 'vencida').sort((a, b) => a.fecha_limite < b.fecha_limite ? -1 : 1);
        const proximas = abiertas.filter(t => { const n = C.diasEntre(h, t.fecha_limite); return n != null && n >= 0 && n <= 30; })
            .sort((a, b) => a.fecha_limite < b.fecha_limite ? -1 : 1);
        const renov = abiertas.filter(t => ['renovacion', 'certificado'].includes(t.tipo) && t.fecha_limite)
            .sort((a, b) => a.fecha_limite < b.fecha_limite ? -1 : 1);
        const carga = new Map();
        abiertas.forEach(t => {
            const n = String(t.responsable || '').trim() || 'Sin responsable';
            const x = carga.get(n) || { n, total: 0, venc: 0 };
            x.total++; if (C.situacion(t, h) === 'vencida') x.venc++;
            carga.set(n, x);
        });
        const cargaTop = [...carga.values()].sort((a, b) => b.total - a.total || b.venc - a.venc).slice(0, 10);
        const maxCarga = Math.max(1, ...cargaTop.map(x => x.total));

        const listaHTML = (arr, vacio, extra) => arr.length
            ? '<div class="seg-list-mini">' + arr.slice(0, 10).map(t => li(t, extra && extra(t))).join('') + '</div>' + (arr.length > 10 ? '<div class="seg-vacio-mini">y ' + (arr.length - 10) + ' más</div>' : '')
            : '<div class="seg-vacio-mini">' + vacio + '</div>';

        return '<div class="seg-dash">' +
            '<div class="seg-panel seg-span-4"><h4><i class="fas fa-chart-pie"></i>Estado general</h4>' + dona + '</div>' +
            '<div class="seg-panel seg-span-4"><h4><i class="fas fa-bullseye"></i>Cumplimiento a tiempo</h4>' + panelCumpl + '</div>' +
            '<div class="seg-panel seg-span-4"><h4><i class="fas fa-calendar-check"></i>' + C.MESES_LARGOS[+mes.slice(5, 7) - 1] + '</h4>' + panelMes + '</div>' +
            '<div class="seg-panel seg-span-12"><h4><i class="fas fa-sitemap"></i>Por subdirección<span class="seg-panel-n">Clic para ver su lista</span></h4>' + sdCards + '</div>' +
            '<div class="seg-panel seg-span-6"><h4><i class="fas fa-triangle-exclamation" style="color:var(--seg-danger)"></i>Atención inmediata<span class="seg-panel-n">' + plural(vencidas.length, 'vencida', 'vencidas') + '</span></h4>' +
              listaHTML(vencidas, 'Nada vencido. ¡Bien!') + '</div>' +
            '<div class="seg-panel seg-span-6"><h4><i class="fas fa-calendar-week"></i>Próximos 30 días<span class="seg-panel-n">' + proximas.length + '</span></h4>' +
              listaHTML(proximas, 'Nada vence en los próximos 30 días.', t => C.fechaCorta(t.fecha_limite)) + '</div>' +
            '<div class="seg-panel seg-span-7"><h4><i class="fas fa-certificate"></i>Renovaciones y certificados<span class="seg-panel-n">' + renov.length + '</span></h4>' +
              listaHTML(renov, 'Sin renovaciones ni certificados registrados. Agrégalos con tipo "Renovación" o "Certificado / licencia" y su ciclo.', t => C.fechaCorta(t.fecha_limite)) + '</div>' +
            '<div class="seg-panel seg-span-5"><h4><i class="fas fa-users"></i>Carga por responsable<span class="seg-panel-n">abiertas · vencidas en rojo</span></h4>' +
              (cargaTop.length ? cargaTop.map(x => '<div class="seg-load-row"' + tip(x.n, plural(x.total, 'tarea abierta', 'tareas abiertas') + (x.venc ? ' · ' + plural(x.venc, 'vencida', 'vencidas') : ' · nada vencido'), { ico: 'user' }) + '><span>' + esc(x.n) + '</span><span class="seg-load-bar">' +
                '<i style="width:' + (x.venc / maxCarga * 100) + '%;background:var(--seg-danger)"></i><i style="width:' + ((x.total - x.venc) / maxCarga * 100) + '%;background:var(--seg-accent-2)"></i></span><b>' + x.total + '</b></div>').join('')
                : '<div class="seg-vacio-mini">Sin tareas abiertas.</div>') + '</div>' +
            '</div>';
    }

    /* ==========================================================================
       Menú flotante
       ========================================================================== */
    function abrirMenu(anchor, cfg) {
        cerrarMenu();
        const el = $('seg-menu');
        if (!el || !anchor) return;
        const items = cfg.items || [];
        let html = cfg.titulo ? '<div class="seg-menu-title">' + esc(cfg.titulo) + '</div>' : '';
        if (cfg.buscar) html += '<div style="padding:2px 2px 6px"><input type="text" class="seg-menu-q" placeholder="' + esc(cfg.buscar) + '" autocomplete="off"></div>' +
            (cfg.libre ? '<button type="button" class="seg-menu-item seg-menu-libre" hidden><i class="fas fa-pen" style="width:16px"></i><span></span></button>' : '');
        if (cfg.html) html += cfg.html;
        html += '<div class="seg-menu-items">' + items.map((it, i) => it.sep ? '<div class="seg-menu-sep"></div>' :
            '<button type="button" class="seg-menu-item' + (it.sel ? ' is-sel' : '') + (it.peligro ? ' is-danger' : '') + '" data-i="' + i + '" data-q="' + esc(C.normalizar((it.texto || '') + ' ' + (it.sub || ''))) + '"' + (it.color ? ' style="--c:' + it.color + '"' : '') + '>' +
            (it.color && !it.icono ? '<span class="seg-sw"></span>' : '') + (it.icono ? '<i class="' + (it.icono.includes(' ') ? it.icono : 'fas fa-' + it.icono) + '"' + (it.color ? ' style="color:' + it.color + ';width:16px"' : ' style="width:16px"') + '></i>' : '') +
            (it.avatar ? avatar(it.avatar) : '') +
            '<span style="min-width:0;flex:1"><span style="display:block;overflow:hidden;text-overflow:ellipsis">' + esc(it.texto) + '</span>' + (it.sub ? '<small style="display:block;color:var(--seg-faint);font-weight:500;font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.sub) + '</small>' : '') + '</span>' +
            (it.sel ? '<i class="fas fa-check"></i>' : '') + '</button>').join('') + '</div>';
        el.innerHTML = html;
        el.hidden = false;
        el.style.minWidth = (cfg.ancho || 210) + 'px';
        state.menu = { anchor, cfg, el };
        posicionar(el, anchor);
        el.querySelectorAll('.seg-menu-item[data-i]').forEach(b => b.addEventListener('click', () => {
            const it = items[+b.dataset.i];
            cerrarMenu();
            if (cfg.alElegir) cfg.alElegir(it.valor, it);
        }));
        const q = el.querySelector('.seg-menu-q');
        if (q) {
            const libre = el.querySelector('.seg-menu-libre');
            const candidatos = () => [...el.querySelectorAll('.seg-menu-item[data-i]:not([hidden])')].filter(b => !items[+b.dataset.i].fijo);
            const filtrar = () => {
                const v = C.normalizar(q.value);
                const partes = v.split(/\s+/).filter(Boolean);
                el.querySelectorAll('.seg-menu-item[data-i]').forEach(b => {
                    const it = items[+b.dataset.i];
                    b.hidden = !(it.fijo || !partes.length || partes.every(p => (b.dataset.q || '').includes(p)));
                });
                if (libre) {
                    libre.hidden = !q.value.trim();
                    libre.querySelector('span').textContent = 'Usar «' + q.value.trim() + '»';
                }
            };
            if (libre) libre.addEventListener('click', () => { const texto = q.value.trim(); cerrarMenu(); cfg.libre(texto); });
            q.addEventListener('input', filtrar);
            q.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const texto = q.value.trim();
                    const cand = candidatos();
                    if (texto && cand.length) cand[0].click();
                    else if (texto && cfg.libre) { cerrarMenu(); cfg.libre(texto); }
                    else el.querySelector('.seg-menu-item[data-i]:not([hidden])')?.click();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    el.querySelector('.seg-menu-item[data-i]:not([hidden])')?.focus();
                }
            });
            setTimeout(() => q.focus(), 20);
        } else {
            setTimeout(() => (el.querySelector('.seg-menu-item.is-sel') || el.querySelector('.seg-menu-item'))?.focus({ preventScroll: true }), 20);
        }
        if (cfg.montar) cfg.montar(el);
    }

    function posicionar(el, anchor) {
        const r = anchor.getBoundingClientRect();
        el.style.left = '0px';
        el.style.top = '0px';
        const w = el.offsetWidth, hgt = el.offsetHeight;
        let left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
        let top = r.bottom + 6;
        if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }

    function cerrarMenu() {
        const el = $('seg-menu');
        if (el && !el.hidden) { el.hidden = true; el.innerHTML = ''; }
        state.menu = null;
    }

    /* Menús de propiedades: sirven igual para la lista que para el panel. */
    function menuEstatus(anchor, t, alElegir) {
        abrirMenu(anchor, {
            titulo: 'Estatus',
            items: C.ESTATUS.map(e => ({ valor: e.clave, texto: e.nombre, color: e.color, icono: e.icono, sel: t.estatus === e.clave })),
            alElegir,
        });
    }
    function menuPrioridad(anchor, t, alElegir) {
        abrirMenu(anchor, {
            titulo: 'Prioridad',
            items: C.PRIORIDADES.map(p => ({ valor: p.clave, texto: p.nombre, color: p.color, icono: 'flag', sel: t.prioridad === p.clave })),
            alElegir,
        });
    }
    function menuFecha(anchor, t, campo, alElegir) {
        const h = hoy();
        const finMes = (() => { const d = C.deISO(h); return C.aISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); })();
        const viernes = C.sumarDias(h, (5 - C.deISO(h).getDay() + 7) % 7);
        const rapidas = [['Hoy', h], ['Mañana', C.sumarDias(h, 1)], ['Viernes', viernes], ['En 1 semana', C.sumarDias(h, 7)],
            ['En 15 días', C.sumarDias(h, 15)], ['Fin de mes', finMes], ['En 1 mes', C.sumarMeses(h, 1)], ['En 3 meses', C.sumarMeses(h, 3)]];
        abrirMenu(anchor, {
            titulo: campo === 'fecha_inicio' ? 'Fecha de inicio' : 'Fecha límite',
            ancho: 260,
            html: '<div style="padding:2px"><input type="date" class="seg-menu-fecha" value="' + esc(t[campo] || '') + '"></div>' +
                '<div class="seg-menu-quick">' + rapidas.map(([txt, iso]) => '<button type="button" class="seg-menu-item" data-f="' + iso + '">' + txt + '<small style="margin-left:auto;color:var(--seg-faint)">' + C.fechaCorta(iso).replace(/ \d+$/, '') + '</small></button>').join('') + '</div>' +
                (t[campo] ? '<div class="seg-menu-sep"></div><button type="button" class="seg-menu-item is-danger" data-f="">Quitar fecha</button>' : ''),
            montar(el) {
                const inp = el.querySelector('.seg-menu-fecha');
                inp.addEventListener('change', () => { if (inp.value) { cerrarMenu(); alElegir(inp.value); } });
                el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { cerrarMenu(); alElegir(b.dataset.f || null); }));
            },
        });
    }
    function menuResponsable(anchor, t, alElegir) {
        const actual = C.normalizar(t.responsable);
        const conocidos = new Set(state.personas.map(p => C.normalizar(p.nombre)));
        const extra = [];
        state.tareas.forEach(x => {
            const n = String(x.responsable || '').trim();
            if (n && !conocidos.has(C.normalizar(n))) { conocidos.add(C.normalizar(n)); extra.push({ nombre: n, num: x.responsable_num || null, tel: x.responsable_tel || '', puesto: '' }); }
        });
        const personas = state.personas.concat(extra).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        const items = [{ valor: '__nadie__', texto: 'Sin responsable', icono: 'user-slash', fijo: true }]
            .concat(personas.map(p => ({ valor: p, texto: p.nombre, sub: [p.puesto, p.tel].filter(Boolean).join(' · '), avatar: p.nombre, sel: C.normalizar(p.nombre) === actual })));
        abrirMenu(anchor, {
            titulo: 'Responsable', buscar: 'Buscar persona o escribir un nombre…', ancho: 300, items,
            alElegir: v => alElegir(v === '__nadie__' ? null : v),
            libre: texto => alElegir({ nombre: texto, num: null, tel: '' }),
        });
    }
    function menuSimple(anchor, titulo, opciones, actual, alElegir) {
        abrirMenu(anchor, { titulo, items: opciones.map(o => Object.assign({ sel: o.valor === actual }, o)), alElegir });
    }

    function patchResponsable(t, p) {
        if (!p) return { responsable: null, responsable_num: null, responsable_tel: null };
        const mismo = C.normalizar(p.nombre) === C.normalizar(t.responsable);
        return { responsable: p.nombre, responsable_num: p.num || null, responsable_tel: p.tel || (mismo ? t.responsable_tel : null) || null };
    }

    /* ==========================================================================
       WhatsApp
       ========================================================================== */
    function recordar(id, anchor) {
        const t = buscar(id);
        if (!t) return;
        if (!C.telefonoWhatsApp(t.responsable_tel)) {
            state.ultimoTel = '';
            abrirMenu(anchor, {
                titulo: 'WhatsApp de ' + (t.responsable || 'el responsable'), ancho: 280,
                html: '<div style="padding:2px 2px 6px"><input type="text" class="seg-menu-tel" inputmode="tel" placeholder="10 dígitos, ej. 55 1234 5678"></div>',
                items: [
                    { valor: 'guardar', texto: puedeEditar() ? 'Guardar número y enviar' : 'Enviar a este número', icono: 'fab fa-whatsapp', color: '#25a55a' },
                    { valor: 'sin', texto: 'Enviar eligiendo el contacto', icono: 'address-book' },
                ],
                montar(el) {
                    const inp = el.querySelector('.seg-menu-tel');
                    setTimeout(() => inp.focus(), 30);
                    inp.addEventListener('input', () => { state.ultimoTel = inp.value; });
                    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.querySelector('.seg-menu-item[data-i="0"]').click(); } });
                },
                alElegir: v => {
                    if (v === 'sin') { abrirWhatsApp(t, ''); return; }
                    const raw = state.ultimoTel || '';
                    const tel = C.telefonoWhatsApp(raw);
                    if (!tel) { toast('Ese número no parece válido: escribe 10 dígitos.', 'error'); return; }
                    if (puedeEditar()) actualizar(t.id, { responsable_tel: raw.trim() }, { bitacora: false, silencioso: true });
                    abrirWhatsApp(Object.assign({}, t, { responsable_tel: raw }), tel);
                },
            });
            return;
        }
        abrirWhatsApp(t, C.telefonoWhatsApp(t.responsable_tel));
    }

    function abrirWhatsApp(t, tel) {
        const texto = C.mensajeWhatsApp(t, hoy(), usuario().nombre);
        window.open('https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
        if (puedeEditar()) actualizar(t.id, { ultimo_recordatorio: new Date().toISOString() }, { bitacora: false, silencioso: true });
        bitacora(t.id, 'whatsapp', { a: t.responsable || null });
    }

    /* ==========================================================================
       Panel de detalle (crear y editar)
       ========================================================================== */
    function abrirTarea(id, opts) {
        const o = opts || {};
        if (!buscar(id)) return;
        flushTextos();
        cerrarMenu();
        state.dr = { modo: 'editar', id, tab: o.tab || 'comentarios', comentarios: null, actividad: null };
        pintarDrawer();
        mostrarDrawer(true);
        cargarComentarios(id);
        if (o.foco === 'composer') setTimeout(() => $('seg-composer')?.focus(), 260);
    }

    function nuevaTarea(base) {
        if (!puedeEditar()) { toast('Tu acceso a Seguimiento es de solo consulta.', 'error'); return; }
        flushTextos();
        cerrarMenu();
        const t = Object.assign({
            titulo: '', descripcion: '', tipo: 'orden', subdireccion: subdirUnica(), gerencia: '', estatus: 'pendiente', prioridad: 'normal',
            responsable: '', responsable_num: null, responsable_tel: '', fecha_inicio: null, fecha_limite: null,
            recurrencia: 'ninguna', aviso_dias: 7, referencia: '', etiquetas: [], checklist: [], evidencias: [],
        }, base || {});
        state.dr = { modo: 'crear', id: null, t, tab: 'comentarios', archivos: [] };
        pintarDrawer();
        mostrarDrawer(true);
        setTimeout(() => { const ti = $('seg-dr-titulo'); if (ti) { ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length); } }, 230);
    }

    function tareaDelPanel() {
        const dr = state.dr;
        if (!dr) return null;
        return dr.modo === 'crear' ? dr.t : buscar(dr.id);
    }

    function mostrarDrawer(si) {
        const d = $('seg-drawer'), bd = $('seg-drawer-bd');
        if (!d) return;
        d.classList.toggle('is-open', si);
        bd.classList.toggle('is-open', si);
        d.setAttribute('aria-hidden', si ? 'false' : 'true');
    }

    function cerrarDrawer(forzar) {
        const dr = state.dr;
        if (!dr) { mostrarDrawer(false); return; }
        if (!forzar && dr.modo === 'crear' && String(dr.t.titulo || '').trim()
            && !window.confirm('¿Descartar la tarea sin guardar?')) return;
        flushTextos();
        state.dr = null;
        cerrarMenu();
        mostrarDrawer(false);
    }

    /* ---------- Formulario del panel ----------
       Cada dato con su etiqueta arriba y su control con borde, agrupados en
       pasos que responden una pregunta. Lo obligatorio lleva *, lo que conviene
       llenar dice "Recomendado" y lo demás "opcional": así se sabe qué falta. */
    function campo(lbl, ico, control, o) {
        const op = o || {};
        const marca = op.req ? ' <b class="seg-req"' + tip('Obligatorio', 'Sin este dato no se puede crear la tarea.') + '>*</b>'
            : op.rec ? ' <span class="seg-badge-rec">Recomendado</span>'
            : op.opc ? ' <span class="seg-opc">opcional</span>' : '';
        return '<div class="seg-campo' + (op.full ? ' seg-campo-full' : '') + (op.falta ? ' is-falta' : '') + '"' + (op.id ? ' data-campo-de="' + op.id + '"' : '') + '>' +
            '<div class="seg-campo-lbl"><i class="fas fa-' + ico + '"></i>' + lbl + marca + '</div>' +
            control +
            (op.ayuda ? '<div class="seg-campo-ayuda' + (op.ayudaClase ? ' ' + op.ayudaClase : '') + '">' + op.ayuda + '</div>' : '') +
            '</div>';
    }
    /** Botón que abre un menú; se ve como una lista desplegable. */
    function ctlMenu(accion, html, dis, vacio) {
        return '<button type="button" class="seg-ctl seg-ctl-sel' + (vacio ? ' is-vacio' : '') + '" data-dr="' + accion + '"' + dis + '>' +
            '<span class="seg-ctl-txt">' + html + '</span><i class="fas fa-chevron-down seg-ctl-chev"></i></button>';
    }
    function paso(n, titulo, cuerpo) {
        return '<section class="seg-paso"><div class="seg-paso-h"><span class="seg-paso-n">' + n + '</span>' + titulo + '</div>' +
            '<div class="seg-campos">' + cuerpo + '</div></section>';
    }

    function htmlGuia() {
        return '<div class="seg-guia" id="seg-guia">' +
            '<div class="seg-guia-h"><i class="fas fa-lightbulb"></i>Guía rápida de llenado' +
              '<button type="button" class="seg-link" data-dr="guia">Ocultar</button></div>' +
            '<ol>' +
              '<li><b>Escribe qué hay que hacer.</b> Corto y claro, por ejemplo: «Renovar licencia de radio ante el IFT».</li>' +
              '<li><b>Elige la subdirección</b> a la que le toca. Si sabes quién lo atiende, asígnalo y pon su WhatsApp para poder recordarle.</li>' +
              '<li><b>Pon la fecha límite.</b> Si se renueva (licencias, certificados, contratos), elige cada cuánto se repite: al completarla se programa sola la siguiente.</li>' +
              '<li><b>Lo demás es opcional.</b> Si son varios pasos, agrégalos como subtareas. Puedes adjuntar PDF o fotos como evidencia desde ahora.</li>' +
              '<li><b>Cuando se cumpla, palomea la casilla</b> de la tarea (columna «Hecha»). Si se repite, la siguiente se programa sola.</li>' +
            '</ol>' +
            '<div class="seg-guia-ley"><span><b class="seg-req">*</b> Obligatorio</span><span><span class="seg-badge-rec">Recomendado</span> Conviene llenarlo</span>' +
              '<span><span class="seg-opc">opcional</span> Puede quedar vacío</span></div>' +
            '</div>';
    }

    /** En el detalle: palomear que ya se hizo, grande y a la vista. */
    function htmlBarraHecho(t, ed) {
        if (t.estatus === 'completada') {
            const cuando = t.completada_en ? C.fechaLarga(C.aISO(new Date(t.completada_en))) : '';
            return '<div class="seg-barra-hecho is-done"><span class="seg-hecho is-done" aria-hidden="true"><i class="fas fa-check"></i></span>' +
                '<div class="seg-barra-txt"><b>Hecha</b><small>' + esc(cuando ? 'Se completó el ' + cuando + '.' : 'Ya se completó.') + '</small></div>' +
                (ed ? '<button type="button" class="seg-btn seg-btn-sm" data-dr="completar"><i class="fas fa-rotate-left"></i>Reabrir</button>' : '') + '</div>';
        }
        if (t.estatus === 'cancelada') {
            return '<div class="seg-barra-hecho is-cancelada"><i class="fas fa-ban"></i><div class="seg-barra-txt"><b>Cancelada</b><small>Ya no aplica.</small></div>' +
                (ed ? '<button type="button" class="seg-btn seg-btn-sm" data-dr="reabrir"><i class="fas fa-rotate-left"></i>Reabrir</button>' : '') + '</div>';
        }
        if (!ed) return '';
        return '<button type="button" class="seg-barra-hecho" data-dr="completar">' +
            '<span class="seg-hecho" aria-hidden="true"><i class="fas fa-check"></i></span>' +
            '<span class="seg-barra-txt"><b>Marcar como hecha</b><small>Palomea aquí cuando ya se cumplió. Si tienes la evidencia, súbela abajo.</small></span></button>';
    }

    /** Lo que falta para poder crear la tarea. */
    function faltantes(t) {
        const f = [];
        if (!String(t.titulo || '').trim()) f.push('titulo');
        if (!t.subdireccion) f.push('subdireccion');
        return f;
    }
    const NOMBRE_FALTA = { titulo: 'el nombre', subdireccion: 'la subdirección' };

    function pintarFalta() {
        const dr = state.dr;
        const el = $('seg-dr-falta');
        if (!dr || dr.modo !== 'crear' || !el) return;
        const f = faltantes(dr.t);
        el.className = 'seg-dr-falta' + (f.length ? '' : ' is-ok');
        el.innerHTML = f.length
            ? '<i class="fas fa-circle-exclamation"></i>Falta ' + f.map(k => '<b>' + NOMBRE_FALTA[k] + '</b>').join(' y ')
            : '<i class="fas fa-circle-check"></i>Lista para crear';
    }

    /* Repinta el panel sólo si no se está escribiendo en él: un cambio remoto
       o el propio guardado no deben comerse lo que se está tecleando. */
    function pintarDrawerSi(id, forzar) {
        const dr = state.dr;
        if (!dr || dr.modo !== 'editar' || dr.id !== id) return;
        const act = document.activeElement;
        const escribiendo = act && $('seg-drawer').contains(act) && act.matches('textarea, input[type="text"], input[type="tel"], input:not([type])');
        if (escribiendo && !forzar) return;
        pintarDrawer();
    }

    function pintarDrawer() {
        const dr = state.dr;
        const el = $('seg-drawer');
        if (!dr || !el) return;
        const t = tareaDelPanel();
        if (!t) { cerrarDrawer(true); return; }
        const creando = dr.modo === 'crear';
        const ed = puedeEditar();
        const dis = ed ? '' : ' disabled';
        const h = hoy();
        const est = C.EST[t.estatus] || C.ESTATUS[0];
        const prio = C.PRIO[t.prioridad] || C.PRIO.normal;
        const sd = C.SUBDIR[t.subdireccion];
        const tipo = C.TIPO[t.tipo] || C.TIPO.orden;
        const mesesRep = C.mesesRecurrencia(t);
        const sit = C.situacion(t, h);
        const ck = C.avanceChecklist(t);
        const nC = state.nComent.get(t.id) || 0;
        const aviso = +t.aviso_dias;
        const evid = t.evidencias || [];
        const marcadas = dr.marcarFaltas ? faltantes(t) : [];
        // La guía se ve sola al crear; al editar, con el botón de ayuda.
        const verGuia = dr.guia != null ? dr.guia : (creando && !state.guiaOculta);

        let ayudaLimite = 'El sistema avisa antes de que venza.';
        let claseLimite = '';
        if (t.fecha_limite && C.estaAbierta(t)) {
            ayudaLimite = sit === 'vencida' ? 'Venció ' + esc(C.relativo(t.fecha_limite, h)) + '.' : 'Vence ' + esc(C.relativo(t.fecha_limite, h)) + '.';
            claseLimite = 'is-' + sit;
        }
        const tituloCtl = '<textarea class="seg-dr-titulo' + (creando ? ' is-form' : '') + '" id="seg-dr-titulo" rows="1" maxlength="300" data-campo="titulo" aria-label="Nombre de la tarea"' +
            ' placeholder="' + (creando ? 'Ej. Renovar licencia de radio ante el IFT' : 'Nombre de la tarea') + '"' + dis + '>' + esc(t.titulo) + '</textarea>';

        const paso1 = (creando
                ? campo('Nombre de la tarea', 'pen', tituloCtl, { req: true, full: true, id: 'titulo', falta: marcadas.includes('titulo') })
                : '') +
            campo('Tipo', 'shapes', ctlMenu('tipo', '<i class="fas fa-' + tipo.icono + '"></i>' + esc(tipo.nombre), dis)) +
            campo('Prioridad', 'flag', ctlMenu('prioridad', '<i class="fas fa-flag" style="color:' + prio.color + '"></i>' + esc(prio.nombre), dis)) +
            campo('Descripción', 'align-left',
                '<textarea class="seg-ctl seg-desc" data-campo="descripcion" placeholder="Instrucción completa, alcance, acuerdos…" maxlength="8000"' + dis + '>' + esc(t.descripcion || '') + '</textarea>',
                { opc: true, full: true });

        const paso2 =
            campo('Subdirección', 'sitemap', ctlMenu('subdireccion', sd
                ? '<i class="fas fa-' + sd.icono + '" style="color:' + sd.color + '"></i>' + esc(sd.nombre)
                : 'Elige a quién le toca', dis, !sd), { req: true, id: 'subdireccion', falta: marcadas.includes('subdireccion') }) +
            campo('Gerencia', 'building', ctlMenu('gerencia', t.gerencia ? esc(t.gerencia) : (sd ? 'Toda la subdirección' : 'Primero elige la subdirección'), dis, !t.gerencia), { opc: true }) +
            campo('Responsable', 'user', ctlMenu('responsable', t.responsable ? avatar(t.responsable) + esc(t.responsable) : 'Elige del directorio o escribe un nombre', dis, !t.responsable), { opc: true }) +
            campo('WhatsApp del responsable', 'phone',
                '<input type="tel" class="seg-ctl" data-campo="responsable_tel" placeholder="10 dígitos, ej. 55 1234 5678" value="' + esc(t.responsable_tel || '') + '" maxlength="30"' + dis + '>',
                { opc: true, ayuda: 'Para mandarle recordatorios con un clic.' });

        const paso3 =
            campo('Fecha límite', 'calendar-check',
                '<input type="date" class="seg-ctl" data-campo="fecha_limite" value="' + esc(t.fecha_limite || '') + '"' + dis + '>',
                { rec: true, ayuda: ayudaLimite, ayudaClase: claseLimite }) +
            campo('Inicio', 'calendar-plus',
                '<input type="date" class="seg-ctl" data-campo="fecha_inicio" value="' + esc(t.fecha_inicio || '') + '"' + dis + '>',
                { opc: true, ayuda: 'Para verla como barra en el cronograma.' }) +
            campo('¿Se repite?', 'repeat', ctlMenu('recurrencia', esc(C.nombreRecurrencia(t)), dis),
                { ayuda: mesesRep && t.fecha_limite && C.estaAbierta(t)
                    ? 'Al completarla se crea sola la siguiente, para el <b>' + esc(C.fechaLarga(C.sumarMeses(t.fecha_limite, mesesRep))) + '</b>.'
                    : 'Para licencias, certificados y contratos que se renuevan.' }) +
            campo('Avisar antes', 'bell', ctlMenu('aviso', esc(aviso === 0 ? 'El mismo día' : plural(aviso, 'día antes', 'días antes')), dis),
                { ayuda: 'Desde cuándo se marca «Por vencer».' });

        const paso4 =
            campo('Estatus', 'circle-half-stroke', ctlMenu('estatus', '<span class="seg-sw-dot" style="--c:' + est.color + '"></span>' + esc(est.nombre), dis)) +
            campo('Referencia', 'file-lines',
                '<input type="text" class="seg-ctl" data-campo="referencia" placeholder="Oficio, minuta o acuerdo" value="' + esc(t.referencia || '') + '" maxlength="200"' + dis + '>',
                { opc: true }) +
            campo('Etiquetas', 'hashtag',
                '<input type="text" class="seg-ctl" data-campo="etiquetas" placeholder="Separadas por coma, ej. IFT, licencias" value="' + esc((t.etiquetas || []).join(', ')) + '" maxlength="300"' + dis + '>',
                { opc: true, full: true });

        el.innerHTML =
            '<div class="seg-dr-head">' +
              '<span class="seg-dr-folio">' + (creando ? 'Nueva tarea' : C.folio(t.folio)) + '</span>' +
              '<span class="seg-dr-guardado" id="seg-dr-guardado">' + (creando ? '' : esc('Creada por ' + (t.creado_por || '—') + ' · ' + hace(t.creado_en))) + '</span>' +
              (creando ? '' : '<button type="button" class="seg-btn seg-btn-sm seg-btn-wa" data-dr="whatsapp"' + tipWhatsApp(t) + '><i class="fab fa-whatsapp"></i>Recordar</button>') +
              '<button type="button" class="seg-icon-btn' + (verGuia ? ' is-on' : '') + '" data-dr="guia"' + tip(verGuia ? 'Ocultar la guía' : 'Guía de llenado', 'Pasos sencillos para llenar la tarea.', { ico: 'lightbulb' }) + ' aria-label="Guía de llenado"><i class="far fa-circle-question"></i></button>' +
              (creando ? '' : '<button type="button" class="seg-icon-btn" data-dr="mas"' + tip('Más opciones', 'Copiar el mensaje, duplicar, cancelar o eliminar.', { ico: 'ellipsis' }) + ' aria-label="Más opciones"><i class="fas fa-ellipsis"></i></button>') +
              '<button type="button" class="seg-icon-btn" data-dr="cerrar"' + tip('Cerrar', creando ? 'Lo que no se haya creado se descarta.' : 'Todo se guarda solo.', { kbd: 'Esc' }) + ' aria-label="Cerrar"><i class="fas fa-xmark"></i></button>' +
            '</div>' +
            '<div class="seg-dr-body">' +
              (verGuia ? htmlGuia() : '') +
              (creando ? '' : tituloCtl + htmlBarraHecho(t, ed)) +
              paso(1, '¿Qué hay que hacer?', paso1) +
              paso(2, '¿A quién le toca?', paso2) +
              paso(3, '¿Para cuándo?', paso3) +
              paso(4, 'Seguimiento', paso4) +
              '<div class="seg-sec"><div class="seg-sec-h"><i class="fas fa-list-check"></i>Subtareas <span class="seg-opc">opcional</span><span class="seg-sec-n">' + (ck.total ? ck.hechos + '/' + ck.total : '') + '</span>' +
                (ck.total ? '<span class="seg-mini-bar"><span style="width:' + ck.pct + '%"></span></span>' : '') + '</div><div id="seg-ck">' + htmlChecklist(t, ed) + '</div></div>' +
              '<div class="seg-sec"><div class="seg-sec-h"><i class="fas fa-paperclip"></i>Evidencias <span class="seg-opc">opcional</span><span class="seg-sec-n">' + (evid.length || '') + '</span></div>' +
                '<div id="seg-evid">' + (creando ? htmlEvidenciasPendientes() : htmlEvidencias(t, ed)) + '</div></div>' +
              (creando ? '' :
                '<div class="seg-sec"><div class="seg-tabs" role="tablist">' +
                  '<button type="button" class="seg-tab' + (dr.tab === 'comentarios' ? ' is-active' : '') + '" data-dr="tab" data-tab="comentarios"><i class="far fa-comments me-1"></i>Comentarios ' + (nC ? '<span class="seg-sec-n">' + nC + '</span>' : '') + '</button>' +
                  '<button type="button" class="seg-tab' + (dr.tab === 'actividad' ? ' is-active' : '') + '" data-dr="tab" data-tab="actividad"><i class="fas fa-clock-rotate-left me-1"></i>Actividad</button>' +
                '</div><div id="seg-dr-tab"></div></div>') +
            '</div>' +
            '<div class="seg-dr-foot"' + (creando ? '' : ' hidden') + '>' +
              '<div class="seg-dr-falta" id="seg-dr-falta"></div>' +
              '<button type="button" class="seg-btn" data-dr="cerrar">Cancelar</button>' +
              '<button type="button" class="seg-btn seg-btn-primary" data-dr="crear"><i class="fas fa-check"></i>Crear tarea</button>' +
            '</div>';
        autoAltura($('seg-dr-titulo'));
        if (creando) pintarFalta();
        else pintarTab();
    }

    function autoAltura(ta) {
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }

    function htmlChecklist(t, ed) {
        const items = Array.isArray(t.checklist) ? t.checklist : [];
        return items.map(i => '<div class="seg-ck-item' + (i.hecho ? ' is-done' : '') + '" data-ck="' + esc(i.id) + '">' +
            '<input type="checkbox" ' + (i.hecho ? 'checked ' : '') + 'data-ck-accion="marcar" aria-label="Hecho"' + (ed ? '' : ' disabled') + '>' +
            '<input type="text" value="' + esc(i.texto) + '" data-ck-accion="texto" maxlength="300" aria-label="Subtarea"' + (ed ? '' : ' disabled') + '>' +
            (ed ? '<button type="button" class="seg-icon-btn" data-ck-accion="borrar"' + tip('Quitar subtarea') + ' aria-label="Quitar subtarea"><i class="fas fa-xmark"></i></button>' : '') +
            '</div>').join('') +
            (ed ? '<div class="seg-ck-new"><i class="fas fa-plus"></i><input type="text" id="seg-ck-nuevo" maxlength="300" placeholder="Agregar subtarea y Enter" aria-label="Nueva subtarea"></div>'
                : (items.length ? '' : '<div class="seg-vacio-mini" style="text-align:left;padding:4px 0">Sin subtareas.</div>'));
    }

    const htmlZonaArchivos = (txt) => '<div class="seg-drop" data-dr="subir" id="seg-drop" role="button" tabindex="0">' +
        '<i class="fas fa-paperclip"></i><b>Adjuntar PDF o fotos</b><small>' + txt + '</small></div>';

    /** Al crear: los archivos elegidos esperan y se suben en cuanto exista la tarea. */
    function htmlEvidenciasPendientes() {
        const lista = (state.dr && state.dr.archivos) || [];
        return (lista.length ? '<div class="seg-evid-list">' + lista.map((f, i) =>
            '<div class="seg-evid is-pend"><i class="fas ' + (extArchivo(f) === 'pdf' ? 'fa-file-pdf' : 'fa-file-image') + '"></i>' +
            '<div><b>' + esc(f.name) + '</b><small>' + esc(tamTxt(f.size)) + ' · se sube al crear</small></div>' +
            '<button type="button" class="seg-icon-btn" data-dr="quitar-pendiente" data-i="' + i + '"' + tip('Quitar archivo', 'Ya no se subirá con la tarea.') + ' aria-label="Quitar archivo"><i class="fas fa-xmark"></i></button></div>').join('') + '</div>' : '') +
            htmlZonaArchivos('Arrastra aquí o haz clic · PDF, JPG o PNG hasta 10 MB · se suben al crear la tarea');
    }

    function pintarEvidenciasPendientes() {
        const cont = $('seg-evid');
        if (cont && state.dr && state.dr.modo === 'crear') cont.innerHTML = htmlEvidenciasPendientes();
    }

    function extArchivo(f) {
        return TIPOS_ARCHIVO[f.type] || (/\.pdf$/i.test(f.name) ? 'pdf' : /\.jpe?g$/i.test(f.name) ? 'jpg' : /\.png$/i.test(f.name) ? 'png' : null);
    }

    /** null si el archivo sirve; si no, por qué. */
    function problemaArchivo(f) {
        if (!extArchivo(f)) return f.name + ': sólo se aceptan PDF, JPG o PNG.';
        if (f.size > MAX_ARCHIVO) return f.name + ': pesa más de 10 MB.';
        return null;
    }

    /** Archivos elegidos o arrastrados: al crear se guardan para después; al editar se suben ya. */
    function recibirArchivos(files) {
        const dr = state.dr;
        if (!dr || !puedeEditar()) return;
        if (dr.modo !== 'crear') { subirEvidencias(files); return; }
        Array.from(files || []).forEach(f => {
            const mal = problemaArchivo(f);
            if (mal) toast(mal, 'error'); else dr.archivos.push(f);
        });
        pintarEvidenciasPendientes();
    }

    function htmlEvidencias(t, ed) {
        const evid = t.evidencias || [];
        return (evid.length ? '<div class="seg-evid-list">' + evid.map((ev, i) =>
            '<div class="seg-evid" data-ev="' + i + '"' + tip(ev.nombre, 'Clic para abrirla en otra pestaña.', { ico: ev.tipo === 'pdf' ? 'file-pdf' : 'file-image' }) + '><i class="fas ' + (ev.tipo === 'pdf' ? 'fa-file-pdf' : 'fa-file-image') + '"></i>' +
            '<div><b>' + esc(ev.nombre) + '</b><small>' + esc([tamTxt(ev.tam), ev.subido_por, C.fechaCorta(ev.subido_en)].filter(Boolean).join(' · ')) + '</small></div>' +
            (ed ? '<button type="button" class="seg-icon-btn" data-ev-borrar="' + i + '"' + tip('Quitar evidencia', 'Se borra el archivo de la tarea.') + ' aria-label="Quitar evidencia"><i class="fas fa-trash"></i></button>' : '') + '</div>').join('') + '</div>' : '') +
            (ed ? htmlZonaArchivos('Arrastra aquí o haz clic · PDF, JPG o PNG hasta 10 MB')
                : (evid.length ? '' : '<div class="seg-vacio-mini" style="text-align:left;padding:4px 0">Sin evidencias.</div>'));
    }

    function pintarTab() {
        const dr = state.dr;
        const cont = $('seg-dr-tab');
        if (!dr || !cont || dr.modo !== 'editar') return;
        const borrador = $('seg-composer') ? $('seg-composer').value : '';
        if (dr.tab === 'actividad') {
            if (!dr.actividad) { cont.innerHTML = '<div class="seg-skel" style="height:30px"></div><div class="seg-skel" style="height:30px"></div>'; cargarActividad(dr.id); return; }
            cont.innerHTML = dr.actividad.length ? dr.actividad.map(a =>
                '<div class="seg-act"><i class="fas fa-' + iconoActividad(a.accion) + '"></i><div><b>' + esc(a.autor || a.autor_email || 'Alguien') + '</b> ' + textoActividad(a) + '</div><small>' + esc(hace(a.creado_en)) + '</small></div>').join('')
                : '<div class="seg-vacio-mini">Sin movimientos registrados.</div>';
            return;
        }
        const lista = dr.comentarios;
        const yo = usuario().email;
        cont.innerHTML = (lista == null ? '<div class="seg-skel" style="height:50px"></div>'
            : lista.length ? lista.map(cm =>
                '<div class="seg-coment' + (cm.autor_email === yo ? ' is-mio' : '') + '">' + avatar(cm.autor || cm.autor_email) +
                '<div class="seg-coment-body"><div class="seg-coment-head"><b>' + esc(cm.autor || cm.autor_email) + '</b><small' + tip(new Date(cm.creado_en).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }), '', { ico: 'clock' }) + '>' + esc(hace(cm.creado_en)) + '</small>' +
                ((cm.autor_email === yo || esAdmin()) ? '<button type="button" class="seg-link" data-coment-borrar="' + esc(cm.id) + '">Borrar</button>' : '') + '</div>' +
                '<div class="seg-coment-txt">' + linkify(esc(cm.texto)) + '</div></div></div>').join('')
            : '<div class="seg-vacio-mini" style="text-align:left">Sin comentarios. Anota aquí los avances: quedan con nombre y hora.</div>') +
            '<div class="seg-composer">' + avatar(usuario().nombre) +
            '<textarea id="seg-composer" maxlength="4000" placeholder="Escribe un avance o comentario…  (Ctrl+Enter para enviar)" aria-label="Nuevo comentario"></textarea>' +
            '<button type="button" class="seg-btn seg-btn-primary seg-btn-sm" data-dr="comentar"' + tip('Enviar comentario', 'Queda con tu nombre y la hora.', { kbd: 'Ctrl+Enter' }) + ' aria-label="Enviar comentario" style="height:44px"><i class="fas fa-paper-plane"></i></button></div>';
        if (borrador) $('seg-composer').value = borrador;
    }

    function iconoActividad(a) {
        return { creo: 'plus', cambio: 'pen', whatsapp: 'paper-plane', evidencia: 'paperclip', evidencia_borrada: 'trash', recurrencia: 'repeat' }[a] || 'circle';
    }
    function textoActividad(a) {
        const d = a.detalle || {};
        switch (a.accion) {
            case 'creo': return d.origen ? 'programó esta ocurrencia (viene de ' + esc(d.origen) + ')' : 'creó la tarea';
            case 'cambio': return (d.cambios || []).map(c => 'cambió <b>' + esc(CAMPO_NOMBRE[c.campo] || c.campo) + '</b>: ' + esc(C.etiquetaValor(c.campo, c.de)) + ' → <b>' + esc(C.etiquetaValor(c.campo, c.a)) + '</b>').join('; ') || 'editó la tarea';
            case 'whatsapp': return 'envió recordatorio por WhatsApp' + (d.a ? ' a ' + esc(d.a) : '');
            case 'evidencia': return 'adjuntó ' + esc((d.nombres || []).join(', '));
            case 'evidencia_borrada': return 'quitó la evidencia ' + esc(d.nombre || '');
            case 'recurrencia': return 'completó y programó la siguiente para el ' + esc(C.fechaLarga(d.fecha)) + (d.folio ? ' (' + esc(d.folio) + ')' : '');
            default: return esc(a.accion);
        }
    }

    async function cargarComentarios(id) {
        const c = await sb();
        if (!c) return;
        const { data, error } = await c.from('seguimiento_comentarios').select('*').eq('tarea_id', id).order('creado_en', { ascending: true });
        const dr = state.dr;
        if (!dr || dr.id !== id) return;
        dr.comentarios = error ? [] : (data || []);
        if (!error) state.nComent.set(id, dr.comentarios.length);
        if (error) toast('No se pudieron cargar los comentarios: ' + errTxt(error), 'error');
        pintarTab();
        renderPronto();
    }

    async function cargarActividad(id) {
        const c = await sb();
        if (!c) return;
        const { data } = await c.from('seguimiento_actividad').select('*').eq('tarea_id', id).order('creado_en', { ascending: false }).limit(200);
        const dr = state.dr;
        if (!dr || dr.id !== id) return;
        dr.actividad = data || [];
        if (dr.tab === 'actividad') pintarTab();
    }

    async function enviarComentario() {
        const dr = state.dr;
        const ta = $('seg-composer');
        if (!dr || !ta) return;
        const texto = ta.value.trim();
        if (!texto) { ta.focus(); return; }
        ta.disabled = true;
        const c = await sb();
        const { data, error } = await c.from('seguimiento_comentarios').insert({ tarea_id: dr.id, autor: usuario().nombre, texto }).select().single();
        ta.disabled = false;
        if (error) { toast('No se envió el comentario: ' + errTxt(error), 'error'); ta.focus(); return; }
        ta.value = '';
        if (Array.isArray(dr.comentarios) && !dr.comentarios.some(x => x.id === data.id)) dr.comentarios.push(data);
        state.nComent.set(dr.id, (dr.comentarios || []).length);
        pintarTab();
        renderPronto();
        setTimeout(() => $('seg-composer')?.focus(), 0);
    }

    async function borrarComentario(cid) {
        const dr = state.dr;
        if (!dr || !window.confirm('¿Borrar este comentario?')) return;
        const c = await sb();
        const { error } = await c.from('seguimiento_comentarios').delete().eq('id', cid);
        if (error) { toast('No se pudo borrar: ' + errTxt(error), 'error'); return; }
        dr.comentarios = (dr.comentarios || []).filter(x => x.id !== cid);
        state.nComent.set(dr.id, dr.comentarios.length);
        pintarTab();
        renderPronto();
    }

    /* ---------- Guardado de los campos del panel ---------- */
    function indicador(estado) {
        const el = $('seg-dr-guardado');
        if (!el || !state.dr || state.dr.modo !== 'editar') return;
        el.className = 'seg-dr-guardado' + (estado === 'ok' ? ' is-ok' : estado === 'error' ? ' is-error' : '');
        el.innerHTML = estado === 'guardando' ? '<i class="fas fa-circle-notch fa-spin"></i>Guardando…'
            : estado === 'editando' ? '<i class="fas fa-pen"></i>Editando…'
            : estado === 'ok' ? '<i class="fas fa-check"></i>Guardado'
            : '<i class="fas fa-circle-exclamation"></i>No se guardó';
    }

    function valorCampo(campo, raw) {
        if (campo === 'etiquetas') return C.etiquetasDeTexto(raw);
        return raw;
    }

    /** Texto del panel: se guarda al dejar de escribir (o al salir del campo). */
    function guardarTexto(campo, raw, ya) {
        const dr = state.dr;
        if (!dr) return;
        if (dr.modo === 'crear') { dr.t[campo] = valorCampo(campo, raw); return; }
        const id = dr.id;
        const pend = state.drTimers[campo];
        if (pend) clearTimeout(pend.timer);
        const fn = () => {
            delete state.drTimers[campo];
            const t = buscar(id);
            if (!t) return;
            const v = valorCampo(campo, raw);
            const igual = campo === 'etiquetas' ? JSON.stringify(t.etiquetas || []) === JSON.stringify(v) : String(t[campo] == null ? '' : t[campo]) === String(v == null ? '' : v).trim();
            if (igual) { indicador('ok'); return; }
            if (campo === 'titulo' && !String(v).trim()) { indicador('error'); toast('La tarea necesita un nombre.', 'error'); return; }
            actualizar(id, { [campo]: v }, { bitacora: campo === 'titulo' });
        };
        if (ya) { fn(); return; }
        indicador('editando');
        state.drTimers[campo] = { timer: setTimeout(fn, 800), fn };
    }

    function flushTextos() {
        Object.keys(state.drTimers).forEach(k => {
            const p = state.drTimers[k];
            clearTimeout(p.timer);
            p.fn();
        });
    }

    /** Cambio de una propiedad desde un menú del panel. */
    function cambiarDesdePanel(patch) {
        const dr = state.dr;
        if (!dr) return;
        if (dr.modo === 'crear') {
            Object.assign(dr.t, patch);
            pintarDrawer();
            return;
        }
        actualizar(dr.id, patch);
    }

    async function crearDesdePanel() {
        const dr = state.dr;
        if (!dr || dr.modo !== 'crear') return;
        const ti = $('seg-dr-titulo');
        if (ti) dr.t.titulo = ti.value;
        document.querySelectorAll('#seg-drawer [data-campo]').forEach(i => {
            if (i.dataset.campo !== 'titulo') dr.t[i.dataset.campo] = valorCampo(i.dataset.campo, i.value);
        });
        const falta = faltantes(dr.t);
        if (falta.length) {
            dr.marcarFaltas = true;
            pintarDrawer();
            toast('Falta ' + falta.map(k => NOMBRE_FALTA[k]).join(' y ') + '.', 'error');
            if (falta[0] === 'titulo') $('seg-dr-titulo')?.focus();
            else {
                const b = document.querySelector('#seg-drawer [data-dr="subdireccion"]');
                if (b) { b.focus(); b.click(); }
            }
            return;
        }
        if (dr.t.recurrencia !== C.PERSONALIZADA) delete dr.t.recurrencia_meses;
        if (dr.t.fecha_inicio && dr.t.fecha_limite && dr.t.fecha_inicio > dr.t.fecha_limite) { toast('El inicio no puede ser después de la fecha límite.', 'error'); return; }
        const btn = document.querySelector('#seg-drawer [data-dr="crear"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>Creando…'; }
        const nueva = await crearEnBase(dr.t);
        if (!nueva) { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i>Crear tarea'; } return; }
        const pendientes = dr.archivos || [];
        state.dr = { modo: 'editar', id: nueva.id, tab: 'comentarios', comentarios: [], actividad: null };
        pintarDrawer();
        renderTodo();
        destellar(nueva.id);
        toast('Tarea ' + C.folio(nueva.folio) + ' creada.', 'ok');
        if (pendientes.length) await subirEvidencias(pendientes);
    }

    /* ---------- Subtareas ---------- */
    function guardarChecklist(items, enfocarNuevo) {
        const dr = state.dr;
        if (!dr) return;
        if (dr.modo === 'crear') dr.t.checklist = items;
        else {
            const t = buscar(dr.id);
            if (t) t.checklist = items;
            actualizar(dr.id, { checklist: items }, { bitacora: false });
        }
        const t = tareaDelPanel();
        const cont = $('seg-ck');
        if (cont && t) cont.innerHTML = htmlChecklist(t, puedeEditar());
        const ck = C.avanceChecklist(t);
        const h = cont && cont.parentElement.querySelector('.seg-sec-h');
        if (h) h.innerHTML = '<i class="fas fa-list-check"></i>Subtareas <span class="seg-opc">opcional</span><span class="seg-sec-n">' + (ck.total ? ck.hechos + '/' + ck.total : '') + '</span>' + (ck.total ? '<span class="seg-mini-bar"><span style="width:' + ck.pct + '%"></span></span>' : '');
        if (enfocarNuevo) $('seg-ck-nuevo')?.focus();
    }

    /* ---------- Evidencias ---------- */
    async function subirEvidencias(files) {
        const dr = state.dr;
        if (!dr || dr.modo !== 'editar' || !puedeEditar()) return;
        const t = buscar(dr.id);
        const c = await sb();
        if (!t || !c) return;
        const nuevas = [];
        for (const f of Array.from(files || [])) {
            const mal = problemaArchivo(f);
            if (mal) { toast(mal, 'error'); continue; }
            const ext = extArchivo(f);
            const path = t.id + '/' + C.idCorto() + '.' + ext;
            toast('Subiendo ' + f.name + '…', 'info');
            const { error } = await c.storage.from(BUCKET).upload(path, f, { contentType: MIME[ext], upsert: false });
            if (error) { toast(f.name + ': ' + errTxt(error), 'error'); continue; }
            nuevas.push({ path, nombre: String(f.name).slice(0, 180), tipo: ext, tam: f.size, subido_por: usuario().nombre, subido_en: new Date().toISOString() });
        }
        if (!nuevas.length) return;
        const ok = await actualizar(t.id, { evidencias: (t.evidencias || []).concat(nuevas) }, { bitacora: false });
        if (!ok) { c.storage.from(BUCKET).remove(nuevas.map(n => n.path)).catch(() => {}); return; }
        bitacora(t.id, 'evidencia', { nombres: nuevas.map(n => n.nombre) });
        toast(nuevas.length === 1 ? 'Evidencia adjuntada.' : nuevas.length + ' evidencias adjuntadas.', 'ok');
        pintarDrawerSi(t.id, true);
    }

    async function abrirEvidencia(i) {
        const t = tareaDelPanel();
        const ev = t && (t.evidencias || [])[i];
        if (!ev) return;
        // La ventana se abre en el clic: si se abre después del await, el
        // navegador la bloquea.
        const w = window.open('', '_blank');
        const c = await sb();
        const { data, error } = await c.storage.from(BUCKET).createSignedUrl(ev.path, 600);
        if (error || !data) { if (w) w.close(); toast('No se pudo abrir la evidencia: ' + errTxt(error), 'error'); return; }
        if (w) { w.opener = null; w.location.href = data.signedUrl; } else window.location.assign(data.signedUrl);
    }

    async function borrarEvidencia(i) {
        const t = tareaDelPanel();
        const ev = t && (t.evidencias || [])[i];
        if (!ev || !window.confirm('¿Quitar la evidencia «' + ev.nombre + '»?')) return;
        const resto = t.evidencias.filter((_, k) => k !== i);
        const ok = await actualizar(t.id, { evidencias: resto }, { bitacora: false });
        if (!ok) return;
        sb().then(c => c.storage.from(BUCKET).remove([ev.path])).catch(() => {});
        bitacora(t.id, 'evidencia_borrada', { nombre: ev.nombre });
        pintarDrawerSi(t.id, true);
    }

    function duplicar(id) {
        const t = buscar(id);
        if (!t) return;
        nuevaTarea({
            titulo: t.titulo + ' (copia)', descripcion: t.descripcion || '', tipo: t.tipo, subdireccion: t.subdireccion,
            gerencia: t.gerencia || '', prioridad: t.prioridad, responsable: t.responsable || '', responsable_num: t.responsable_num || null,
            responsable_tel: t.responsable_tel || '', fecha_inicio: t.fecha_inicio, fecha_limite: t.fecha_limite,
            recurrencia: t.recurrencia, aviso_dias: t.aviso_dias, referencia: t.referencia || '', etiquetas: (t.etiquetas || []).slice(),
            checklist: (t.checklist || []).map(i => ({ id: C.idCorto(), texto: i.texto, hecho: false })),
        });
    }

    /* ==========================================================================
       Acceso (admin)
       ========================================================================== */
    function usuarioAEmail(u) {
        const s = String(u || '').trim().toLowerCase();
        if (!s) return '';
        if (s.includes('@')) return s;
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.') + '@aifa.operaciones';
    }

    function abrirAcceso() {
        if (!esAdmin()) return;
        const m = $('seg-modal');
        m.hidden = false;
        m.innerHTML = '<div class="seg-modal-box" role="dialog" aria-modal="true" aria-labelledby="seg-acc-t">' +
            '<div class="seg-modal-head"><i class="fas fa-user-lock" style="color:var(--seg-accent)"></i><h3 id="seg-acc-t">Quién puede ver Seguimiento</h3>' +
            '<button type="button" class="seg-icon-btn" data-m="cerrar" aria-label="Cerrar"><i class="fas fa-xmark"></i></button></div>' +
            '<div class="seg-modal-body"><p style="color:var(--seg-muted);font-size:.86rem;margin:0 0 10px">Sólo estas cuentas ven el módulo. ' +
            'A las demás no les aparece en el menú y la base tampoco les entrega los datos.</p>' +
            '<div id="seg-acc-lista"><div class="seg-skel"></div></div>' +
            '<div class="seg-acc-add"><input id="seg-acc-user" placeholder="Usuario (ej. gonzalo.sandoval)" autocomplete="off"><input id="seg-acc-nombre" placeholder="Nombre" autocomplete="off">' +
            '<select id="seg-acc-rol"><option value="editor">Editor</option><option value="admin">Admin</option><option value="lector">Lector</option></select>' +
            '<button type="button" class="seg-btn seg-btn-primary" data-m="agregar"><i class="fas fa-plus"></i>Agregar</button></div>' +
            '<div style="font-size:.76rem;color:var(--seg-faint);margin-top:10px">Es el mismo usuario con el que entra a la plataforma. <b>Admin</b>: además administra este acceso · <b>Editor</b>: crea y edita · <b>Lector</b>: consulta y comenta.</div>' +
            '</div></div>';
        cargarAcceso();
        setTimeout(() => $('seg-acc-user')?.focus(), 50);
    }

    async function cargarAcceso() {
        const c = await sb();
        const { data, error } = await c.from('seguimiento_acceso').select('*').order('creado_en');
        const cont = $('seg-acc-lista');
        if (!cont) return;
        if (error) { cont.innerHTML = '<div class="seg-vacio-mini">No se pudo leer: ' + esc(errTxt(error)) + '</div>'; return; }
        const yo = usuario().email;
        cont.innerHTML = (data || []).map(a => '<div class="seg-acc-row">' + avatar(a.nombre || a.email) +
            '<div style="min-width:0"><b>' + esc(a.nombre || a.email.split('@')[0]) + (a.email === yo ? ' <span class="seg-tag is-label"' + tip('Esta es tu cuenta', 'No puedes quitarte el acceso ni cambiar tu rol.') + '>Tú</span>' : '') + '</b><small>' + esc(a.email) + '</small></div>' +
            '<select data-acc-rol="' + esc(a.email) + '"' + (a.email === yo ? ' disabled' : '') + '>' +
            ['admin', 'editor', 'lector'].map(r => '<option value="' + r + '"' + (a.rol === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>').join('') + '</select>' +
            (a.email === yo ? '<span></span>' : '<button type="button" class="seg-icon-btn" data-acc-quitar="' + esc(a.email) + '"' + tip('Quitar acceso', 'Deja de ver el módulo en cuanto vuelva a entrar.') + ' aria-label="Quitar acceso"><i class="fas fa-user-minus"></i></button>') +
            '</div>').join('') || '<div class="seg-vacio-mini">Nadie todavía.</div>';
    }

    async function agregarAcceso() {
        const email = usuarioAEmail($('seg-acc-user').value);
        const nombre = $('seg-acc-nombre').value.trim();
        const rol = $('seg-acc-rol').value;
        if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) { toast('Escribe el usuario con el que entra a la plataforma.', 'error'); return; }
        const c = await sb();
        const { error } = await c.from('seguimiento_acceso').insert({ email, nombre: nombre || null, rol, agregado_por: usuario().nombre });
        if (error) { toast(/duplicate|23505/i.test(errTxt(error) + error.code) ? 'Esa cuenta ya tiene acceso.' : 'No se pudo agregar: ' + errTxt(error), 'error'); return; }
        $('seg-acc-user').value = '';
        $('seg-acc-nombre').value = '';
        toast('Acceso dado a ' + email + '. Lo verá al volver a entrar.', 'ok');
        cargarAcceso();
    }

    /* ==========================================================================
       Descargar resumen
       ========================================================================== */
    function filasExport() {
        const orden = C.SUBDIRECCIONES.map(s => s.clave);
        return C.ordenar(alcance(), 'fecha_limite', true)
            .sort((a, b) => orden.indexOf(a.subdireccion) - orden.indexOf(b.subdireccion));
    }

    function exportarExcel() {
        if (typeof XLSX === 'undefined') { toast('La librería de Excel aún no carga. Intenta en unos segundos.', 'error'); return; }
        const h = hoy();
        const lista = filasExport();
        const filas = lista.map(t => {
            const ck = C.avanceChecklist(t);
            const n = C.diasEntre(h, t.fecha_limite);
            return {
                'Folio': C.folio(t.folio), 'Tarea': t.titulo, 'Tipo': (C.TIPO[t.tipo] || {}).nombre || t.tipo,
                'Subdirección': (C.SUBDIR[t.subdireccion] || {}).nombre || t.subdireccion, 'Gerencia': t.gerencia || '',
                'Responsable': t.responsable || '', 'Teléfono': t.responsable_tel || '',
                'Estatus': (C.EST[t.estatus] || {}).nombre || t.estatus, 'Prioridad': (C.PRIO[t.prioridad] || {}).nombre || t.prioridad,
                'Inicio': fechaDMY(t.fecha_inicio), 'Fecha límite': fechaDMY(t.fecha_limite),
                'Situación': SITUACION_UNO[C.situacion(t, h)] || '',
                'Días para vencer': C.estaAbierta(t) && n != null ? n : '',
                'Se repite': C.mesesRecurrencia(t) ? C.nombreRecurrencia(t) : '', 'Referencia': t.referencia || '',
                'Etiquetas': (t.etiquetas || []).join(', '), 'Subtareas': ck.total ? ck.hechos + '/' + ck.total : '',
                'Comentarios': state.nComent.get(t.id) || 0, 'Evidencias': (t.evidencias || []).length,
                'Completada el': t.completada_en ? fechaDMY(C.aISO(new Date(t.completada_en))) : '',
                'Creada por': t.creado_por || '', 'Creada el': t.creado_en ? fechaDMY(C.aISO(new Date(t.creado_en))) : '',
                'Descripción': t.descripcion || '',
            };
        });
        const res = C.estadisticasPorSubdireccion(lista, h).map(s => ({
            'Subdirección': s.nombre, 'Total': s.total, 'Abiertas': s.abiertas, 'Vencidas': s.vencidas, 'Por vencer': s.por_vencer,
            'Completadas': s.completadas, 'Avance %': s.avance, 'A tiempo %': s.cumplimiento == null ? '' : s.cumplimiento,
        }));
        const g = C.estadisticas(lista, h);
        res.push({ 'Subdirección': 'TOTAL', 'Total': g.total, 'Abiertas': g.abiertas, 'Vencidas': g.vencidas, 'Por vencer': g.por_vencer,
            'Completadas': g.completadas, 'Avance %': g.avance, 'A tiempo %': g.cumplimiento == null ? '' : g.cumplimiento });
        const wb = XLSX.utils.book_new();
        const wsR = XLSX.utils.json_to_sheet(res);
        wsR['!cols'] = [{ wch: 44 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 11 }];
        const wsT = XLSX.utils.json_to_sheet(filas.length ? filas : [{ 'Tarea': 'Sin tareas' }]);
        wsT['!cols'] = [10, 46, 18, 34, 30, 26, 15, 13, 10, 11, 12, 11, 9, 13, 24, 20, 10, 11, 10, 13, 22, 11, 60].map(w => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');
        XLSX.utils.book_append_sheet(wb, wsT, 'Tareas');
        XLSX.writeFile(wb, 'Seguimiento_DO_' + h + '.xlsx');
        toast('Excel descargado.', 'ok');
    }

    function exportarPDF() {
        const w = window.open('', '_blank');
        if (!w) { toast('El navegador bloqueó la ventana del reporte. Permite ventanas emergentes.', 'error'); return; }
        w.document.open();
        w.document.write(htmlReporte());
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* nada */ } }, 700);
    }

    function htmlReporte() {
        const h = hoy();
        const lista = filasExport();
        const g = C.estadisticas(lista, h);
        const porSd = C.estadisticasPorSubdireccion(lista, h).filter(s => s.total);
        const abiertas = lista.filter(C.estaAbierta);
        const venc = abiertas.filter(t => C.situacion(t, h) === 'vencida');
        const prox = abiertas.filter(t => { const n = C.diasEntre(h, t.fecha_limite); return n != null && n >= 0 && n <= 30; });
        const logo = new URL('images/aifa-logo.png', location.href).href;
        const ahora = new Date();
        const fila = t => '<tr><td>' + C.folio(t.folio) + '</td><td><b>' + esc(t.titulo) + '</b>' + (t.referencia ? '<br><small>' + esc(t.referencia) + '</small>' : '') + '</td>' +
            '<td>' + esc((C.SUBDIR[t.subdireccion] || {}).corto || '') + '</td><td>' + esc(t.responsable || '—') + '</td>' +
            '<td>' + esc(C.fechaCorta(t.fecha_limite) || '—') + '</td><td>' + esc((C.EST[t.estatus] || {}).nombre || '') + '</td>' +
            '<td class="s-' + C.situacion(t, h) + '">' + esc(SITUACION_UNO[C.situacion(t, h)] || '') + (C.estaAbierta(t) && t.fecha_limite && t.fecha_limite !== h ? ' (' + esc(C.relativo(t.fecha_limite, h)) + ')' : '') + '</td></tr>';
        const tabla = (arr, vacio) => arr.length
            ? '<table><thead><tr><th>Folio</th><th>Tarea</th><th>Subdirección</th><th>Responsable</th><th>Fecha límite</th><th>Estatus</th><th>Situación</th></tr></thead><tbody>' + arr.map(fila).join('') + '</tbody></table>'
            : '<p class="vacio">' + vacio + '</p>';
        return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Seguimiento DO · ' + h + '</title><style>' +
            '@page{size:letter landscape;margin:14mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#1e293b;font-size:11px;margin:0}' +
            'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #4f46e5;padding-bottom:10px;margin-bottom:14px}header img{height:42px}' +
            'h1{font-size:18px;margin:0}header p{margin:2px 0 0;color:#64748b}.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}' +
            '.kpi{border:1px solid #e2e8f0;border-left:4px solid var(--c);border-radius:8px;padding:8px 10px}.kpi b{display:block;font-size:20px}.kpi span{color:#64748b;font-size:9.5px;text-transform:uppercase;font-weight:700;letter-spacing:.04em}' +
            'h2{font-size:13px;margin:18px 0 6px;color:#312e81;text-transform:uppercase;letter-spacing:.05em}table{width:100%;border-collapse:collapse;page-break-inside:auto}tr{page-break-inside:avoid}' +
            'th{background:#eef2ff;color:#312e81;text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;padding:6px}td{border-bottom:1px solid #e2e8f0;padding:5px 6px;vertical-align:top}' +
            'td small{color:#64748b}.s-vencida{color:#dc2626;font-weight:700}.s-por_vencer,.s-vence_hoy{color:#b45309;font-weight:700}.s-a_tiempo{color:#15803d}.vacio{color:#64748b;font-style:italic}' +
            '.bar{height:7px;background:#e2e8f0;border-radius:9px;overflow:hidden;width:110px;display:inline-block;vertical-align:middle}.bar i{display:block;height:100%;background:#16a34a}' +
            'footer{margin-top:18px;color:#94a3b8;font-size:9px;border-top:1px solid #e2e8f0;padding-top:6px}</style></head><body>' +
            '<header><img src="' + esc(logo) + '" alt="AIFA" onerror="this.remove()"><div><h1>Seguimiento de órdenes y pendientes — Dirección de Operación</h1>' +
            '<p>Corte: ' + esc(C.fechaLarga(h)) + ', ' + ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' h · Generado por ' + esc(usuario().nombre) +
            (state.filtros.subdirecciones.length ? ' · Alcance: ' + esc(state.filtros.subdirecciones.map(k => (C.SUBDIR[k] || {}).corto).join(', ')) : '') + '</p></div></header>' +
            '<div class="kpis">' +
            [['Abiertas', g.abiertas, '#4f46e5'], ['Vencidas', g.vencidas, '#dc2626'], ['Por vencer', g.por_vencer, '#d97706'], ['En curso', g.en_proceso, '#2563eb'],
                ['Completadas', g.completadas, '#16a34a'], ['A tiempo', g.cumplimiento == null ? '—' : g.cumplimiento + '%', '#0891b2']]
                .map(([l, v, c]) => '<div class="kpi" style="--c:' + c + '"><span>' + l + '</span><b>' + v + '</b></div>').join('') + '</div>' +
            '<h2>Por subdirección</h2><table><thead><tr><th>Subdirección</th><th>Abiertas</th><th>Vencidas</th><th>Por vencer</th><th>Completadas</th><th>Avance</th><th>A tiempo</th></tr></thead><tbody>' +
            (porSd.map(s => '<tr><td><b>' + esc(s.nombre) + '</b></td><td>' + s.abiertas + '</td><td' + (s.vencidas ? ' class="s-vencida"' : '') + '>' + s.vencidas + '</td><td>' + s.por_vencer + '</td><td>' + s.completadas + ' de ' + s.total + '</td>' +
                '<td><span class="bar"><i style="width:' + s.avance + '%"></i></span> ' + s.avance + '%</td><td>' + (s.cumplimiento == null ? '—' : s.cumplimiento + '%') + '</td></tr>').join('') || '<tr><td colspan="7" class="vacio">Sin tareas.</td></tr>') +
            '</tbody></table>' +
            '<h2>Vencidas (' + venc.length + ')</h2>' + tabla(venc, 'Nada vencido a la fecha de corte.') +
            '<h2>Vencen en los próximos 30 días (' + prox.length + ')</h2>' + tabla(prox, 'Nada vence en los próximos 30 días.') +
            C.SUBDIRECCIONES.map(sd => {
                const arr = abiertas.filter(t => t.subdireccion === sd.clave);
                return arr.length ? '<h2>Pendientes · ' + esc(sd.nombre) + ' (' + arr.length + ')</h2>' + tabla(arr, '') : '';
            }).join('') +
            '<footer>Aeropuerto Internacional Felipe Ángeles · Dirección de Operación · Módulo Seguimiento. Documento generado automáticamente.</footer>' +
            '</body></html>';
    }

    /* ==========================================================================
       Filtros (menú)
       ========================================================================== */
    function abrirFiltros(anchor) {
        const f = state.filtros;
        const responsables = [...new Set(state.tareas.map(t => String(t.responsable || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
        const opt = (grupo, valor, texto, color, on, icono) =>
            '<button type="button" class="seg-opt' + (on ? ' is-on' : '') + '" data-fg="' + grupo + '" data-fv="' + esc(valor) + '" style="--c:' + (color || 'var(--seg-accent)') + '">' +
            (icono ? '<i class="fas fa-' + icono + '"></i>' : '') + esc(texto) + '</button>';
        const html = '<div class="seg-filtros">' +
            '<h6>Situación</h6><div class="seg-opts">' +
              [['vencida', 'Vencidas', '#dc2626'], ['por_vencer', 'Por vencer', '#d97706'], ['a_tiempo', 'A tiempo', '#16a34a'], ['sin_fecha', 'Sin fecha', '#64748b']]
                .map(([v, t, c]) => opt('situacion', v, t, c, f.situacion === v, 'circle')).join('') + '</div>' +
            '<h6>Estatus</h6><div class="seg-opts">' + C.ESTATUS.map(e => opt('estatus', e.clave, e.nombre, e.color, f.estatus.includes(e.clave), 'circle')).join('') + '</div>' +
            '<h6>Prioridad</h6><div class="seg-opts">' + C.PRIORIDADES.map(p => opt('prioridades', p.clave, p.nombre, p.color, f.prioridades.includes(p.clave), 'flag')).join('') + '</div>' +
            '<h6>Tipo</h6><div class="seg-opts">' + C.TIPOS.map(x => opt('tipos', x.clave, x.nombre, null, f.tipos.includes(x.clave), x.icono)).join('') + '</div>' +
            (responsables.length ? '<h6>Responsable</h6><select class="seg-filtro-resp"><option value="">Todos</option>' +
                responsables.map(r => '<option' + (r === f.responsable ? ' selected' : '') + '>' + esc(r) + '</option>').join('') + '</select>' : '') +
            '<div class="seg-menu-sep" style="margin-top:10px"></div><button type="button" class="seg-menu-item" data-fl="1"><i class="fas fa-filter-circle-xmark"></i>Quitar todos los filtros</button></div>';
        abrirMenu(anchor, {
            html, ancho: 300,
            montar(el) {
                el.querySelectorAll('[data-fg]').forEach(b => b.addEventListener('click', () => {
                    const g = b.dataset.fg, v = b.dataset.fv;
                    if (g === 'situacion') f.situacion = f.situacion === v ? '' : v;
                    else f[g] = f[g].includes(v) ? f[g].filter(x => x !== v) : f[g].concat(v);
                    renderTodo();
                    abrirFiltros(anchor);
                }));
                el.querySelector('.seg-filtro-resp')?.addEventListener('change', e => { f.responsable = e.target.value; renderTodo(); });
                el.querySelector('[data-fl]').addEventListener('click', () => { cerrarMenu(); limpiarFiltros(); });
            },
        });
    }

    /* ==========================================================================
       Eventos
       ========================================================================== */
    function conectarEsqueleto() {
        $('seg-btn-nueva').addEventListener('click', () => nuevaTarea());
        $('seg-btn-acceso').addEventListener('click', abrirAcceso);
        $('seg-btn-resumen').addEventListener('click', e => abrirMenu(e.currentTarget, {
            titulo: 'Descargar resumen', ancho: 250,
            items: [
                { valor: 'pdf', texto: 'Reporte ejecutivo (PDF)', sub: 'Indicadores, vencidas y pendientes', icono: 'file-pdf', color: '#dc2626' },
                { valor: 'xlsx', texto: 'Tabla completa (Excel)', sub: 'Todas las tareas y su resumen', icono: 'file-excel', color: '#16a34a' },
            ],
            alElegir: v => (v === 'pdf' ? exportarPDF() : exportarExcel()),
        }));
        $('seg-views').addEventListener('click', e => {
            const b = e.target.closest('[data-vista]');
            if (!b) return;
            state.vista = b.dataset.vista;
            guardarPrefs();
            renderTodo();
        });
        let tq = 0;
        $('seg-q').addEventListener('input', e => {
            clearTimeout(tq);
            tq = setTimeout(() => { state.filtros.texto = e.target.value; renderTodo(); }, 160);
        });
        $('seg-btn-filtros').addEventListener('click', e => abrirFiltros(e.currentTarget));
        $('seg-btn-agrupar').addEventListener('click', e => abrirMenu(e.currentTarget, {
            titulo: 'Agrupar por',
            items: C.AGRUPACIONES.map(a => ({ valor: a.clave, texto: a.nombre, sel: a.clave === state.agrupar,
                icono: { subdireccion: 'sitemap', estatus: 'circle-half-stroke', responsable: 'user', prioridad: 'flag', tipo: 'shapes', vencimiento: 'clock', ninguno: 'bars' }[a.clave] })),
            alElegir: v => { state.agrupar = v; guardarPrefs(); renderTodo(); },
        }));
        $('seg-btn-cerradas').addEventListener('click', () => {
            state.filtros.verCerradas = !state.filtros.verCerradas;
            guardarPrefs();
            renderTodo();
        });
        $('seg-kpis').addEventListener('click', e => { const k = e.target.closest('[data-kpi]'); if (k) clicKpi(k.dataset.kpi); });
        $('seg-chips').addEventListener('click', e => {
            const b = e.target.closest('[data-sd]');
            if (!b) return;
            const v = b.dataset.sd;
            const sel = state.filtros.subdirecciones;
            state.filtros.subdirecciones = !v ? [] : sel.includes(v) ? sel.filter(x => x !== v) : sel.concat(v);
            renderTodo();
        });
        $('seg-alerta').addEventListener('click', e => {
            const b = e.target.closest('[data-alerta]');
            if (!b) return;
            state.filtros.estatus = [];
            state.filtros.situacion = b.dataset.alerta;
            if (state.vista === 'resumen') state.vista = 'lista';
            renderTodo();
        });

        const body = $('seg-body');
        body.addEventListener('click', e => {
            const objetivo = e.target.closest('[data-accion], [data-id]');
            if (!objetivo || !body.contains(objetivo)) return;
            if (objetivo.dataset.accion) { accionCuerpo(objetivo.dataset.accion, objetivo, e); return; }
            if (e.target.closest('input, textarea, a')) return;
            abrirTarea(objetivo.dataset.id);
        });
        body.addEventListener('keydown', e => {
            if (e.target.matches('input[data-add]')) {
                if (e.key === 'Enter') { e.preventDefault(); crearRapida(e.target); }
                else if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
                return;
            }
            if (e.key === 'Enter' && e.target.matches('[data-id]')) { e.preventDefault(); abrirTarea(e.target.dataset.id); }
        });
        // Arrastrar: tablero (cambia estatus) y calendario (cambia fecha).
        body.addEventListener('dragstart', e => {
            const card = e.target.closest && e.target.closest('[data-id][draggable="true"]');
            if (!card) return;
            state.arrastrando = card.dataset.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.id);
            card.classList.add('is-dragging');
        });
        body.addEventListener('dragend', () => {
            state.arrastrando = null;
            body.querySelectorAll('.is-dragging, .is-over').forEach(x => x.classList.remove('is-dragging', 'is-over'));
        });
        body.addEventListener('dragover', e => {
            const z = e.target.closest && e.target.closest('[data-drop-estatus], [data-drop-fecha]');
            if (!z || !state.arrastrando) return;
            e.preventDefault();
            body.querySelectorAll('.is-over').forEach(x => { if (x !== z) x.classList.remove('is-over'); });
            z.classList.add('is-over');
        });
        body.addEventListener('drop', e => {
            const z = e.target.closest && e.target.closest('[data-drop-estatus], [data-drop-fecha]');
            const id = state.arrastrando || e.dataTransfer.getData('text/plain');
            if (!z || !id) return;
            e.preventDefault();
            z.classList.remove('is-over');
            const t = buscar(id);
            if (!t) return;
            if (z.dataset.dropEstatus && z.dataset.dropEstatus !== t.estatus) actualizar(id, { estatus: z.dataset.dropEstatus });
            else if (z.dataset.dropFecha && z.dataset.dropFecha !== t.fecha_limite) actualizar(id, { fecha_limite: z.dataset.dropFecha });
        });
    }

    function accionCuerpo(accion, el, e) {
        const fila = el.closest('[data-id]');
        const id = fila && fila.dataset.id;
        const t = id && buscar(id);
        switch (accion) {
            case 'completar':
                if (!t) return;
                actualizar(id, { estatus: t.estatus === 'completada' ? 'pendiente' : 'completada' });
                return;
            case 'estatus': return t && menuEstatus(el, t, v => v !== t.estatus && actualizar(id, { estatus: v }));
            case 'prioridad': return t && menuPrioridad(el, t, v => v !== t.prioridad && actualizar(id, { prioridad: v }));
            case 'fecha': return t && menuFecha(el, t, 'fecha_limite', v => actualizar(id, { fecha_limite: v }));
            case 'responsable': return t && menuResponsable(el, t, p => actualizar(id, patchResponsable(t, p)));
            case 'whatsapp': return t && recordar(id, el);
            case 'comentarios': return t && abrirTarea(id, { tab: 'comentarios', foco: 'composer' });
            case 'grupo': {
                const llave = state.agrupar + ':' + el.dataset.grupo;
                state.colapsados = state.colapsados.includes(llave) ? state.colapsados.filter(x => x !== llave) : state.colapsados.concat(llave);
                guardarPrefs();
                el.closest('.seg-group')?.classList.toggle('is-collapsed');
                el.setAttribute('aria-expanded', String(!state.colapsados.includes(llave)));
                return;
            }
            case 'grupo-nueva': e.stopPropagation(); return nuevaTarea(baseDeGrupo(el.dataset.grupo));
            case 'col-nueva': return nuevaTarea({ estatus: el.dataset.estatus });
            case 'ordenar': {
                const c = el.dataset.campo;
                state.orden = state.orden.campo === c ? { campo: c, asc: !state.orden.asc } : { campo: c, asc: true };
                guardarPrefs();
                renderTodo();
                return;
            }
            case 'cal-mover': {
                const base = state.cal || hoy().slice(0, 7);
                state.cal = C.sumarMeses(base + '-01', +el.dataset.n).slice(0, 7);
                renderTodo();
                return;
            }
            case 'cal-hoy': state.cal = null; renderTodo(); return;
            case 'cal-dia': return nuevaTarea({ fecha_limite: el.dataset.fecha });
            case 'cal-mas': {
                const lista = visibles().filter(x => x.fecha_limite === el.dataset.fecha);
                abrirMenu(el, {
                    titulo: C.fechaLarga(el.dataset.fecha), ancho: 280,
                    items: lista.map(x => ({ valor: x.id, texto: x.titulo, sub: (C.SUBDIR[x.subdireccion] || {}).corto, color: (C.SUBDIR[x.subdireccion] || {}).color })),
                    alElegir: v => abrirTarea(v),
                });
                return;
            }
            case 'gantt-mover': {
                const g = state.gantt;
                const h = hoy();
                const lunes = C.sumarDias(h, -((C.deISO(h).getDay() + 6) % 7));
                const actual = g.inicio || C.sumarDias(lunes, g.escala === 'semanas' ? -7 : -28);
                g.inicio = g.escala === 'semanas' ? C.sumarDias(actual, 28 * +el.dataset.n) : C.sumarMeses(actual, 3 * +el.dataset.n);
                renderTodo();
                return;
            }
            case 'gantt-hoy': state.gantt.inicio = null; renderTodo(); return;
            case 'gantt-escala': state.gantt.escala = el.dataset.escala; state.gantt.inicio = null; guardarPrefs(); renderTodo(); return;
            case 'sd': state.filtros.subdirecciones = [el.dataset.sd]; state.vista = 'lista'; guardarPrefs(); renderTodo(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
            case 'quitar-filtros': limpiarFiltros(); return;
            case 'nueva': return nuevaTarea();
            case 'idea': return nuevaTarea({ tipo: el.dataset.tipo, titulo: '', recurrencia: el.dataset.recurrencia, aviso_dias: +el.dataset.aviso, descripcion: '' });
            default:
        }
    }

    function conectarPortal() {
        $('seg-drawer-bd').addEventListener('click', () => cerrarDrawer());
        const d = $('seg-drawer');
        d.addEventListener('click', e => {
            const b = e.target.closest('[data-dr], [data-ck-accion="borrar"], [data-ev], [data-ev-borrar], [data-coment-borrar]');
            if (!b) return;
            if (b.dataset.evBorrar != null) { e.stopPropagation(); borrarEvidencia(+b.dataset.evBorrar); return; }
            if (b.dataset.comentBorrar) { borrarComentario(b.dataset.comentBorrar); return; }
            if (b.dataset.ckAccion === 'borrar') {
                const t = tareaDelPanel();
                const cid = b.closest('[data-ck]').dataset.ck;
                guardarChecklist((t.checklist || []).filter(i => i.id !== cid));
                return;
            }
            if (b.dataset.ev != null) { abrirEvidencia(+b.dataset.ev); return; }
            accionPanel(b.dataset.dr, b);
        });
        d.addEventListener('input', e => {
            const c = e.target.dataset.campo;
            if (e.target.id === 'seg-dr-titulo') {
                autoAltura(e.target);
                if (state.dr && state.dr.modo === 'crear') {
                    state.dr.t.titulo = e.target.value;
                    pintarFalta();
                    if (e.target.value.trim()) e.target.closest('.seg-campo')?.classList.remove('is-falta');
                }
            }
            if (!c || e.target.type === 'date') return;
            if (c === 'etiquetas') { if (state.dr && state.dr.modo === 'crear') state.dr.t.etiquetas = C.etiquetasDeTexto(e.target.value); return; }
            guardarTexto(c, e.target.value);
        });
        d.addEventListener('change', e => {
            const el = e.target;
            const c = el.dataset.campo;
            if (c && el.type === 'date') {
                if (state.dr.modo === 'crear') { state.dr.t[c] = el.value || null; pintarDrawer(); return; }
                actualizar(state.dr.id, { [c]: el.value || null });
                return;
            }
            if (c === 'etiquetas') { guardarTexto(c, el.value, true); return; }
            if (el.dataset.ckAccion === 'marcar' || el.dataset.ckAccion === 'texto') {
                const t = tareaDelPanel();
                const cid = el.closest('[data-ck]').dataset.ck;
                guardarChecklist((t.checklist || []).map(i => i.id !== cid ? i
                    : Object.assign({}, i, el.dataset.ckAccion === 'marcar' ? { hecho: el.checked } : { texto: el.value.trim() || i.texto })));
            }
        });
        d.addEventListener('focusout', e => {
            const c = e.target.dataset && e.target.dataset.campo;
            if (c && state.drTimers[c]) { const p = state.drTimers[c]; clearTimeout(p.timer); p.fn(); }
        });
        d.addEventListener('keydown', e => {
            if (e.target.id === 'seg-ck-nuevo' && e.key === 'Enter') {
                e.preventDefault();
                const texto = e.target.value.trim();
                if (!texto) return;
                const t = tareaDelPanel();
                guardarChecklist((t.checklist || []).concat({ id: C.idCorto(), texto, hecho: false }), true);
                return;
            }
            if (e.target.id === 'seg-dr-titulo' && e.key === 'Enter') {
                e.preventDefault();
                if (state.dr && state.dr.modo === 'crear' && (e.ctrlKey || e.metaKey)) crearDesdePanel();
                else e.target.blur();
                return;
            }
            if (e.target.id === 'seg-composer' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviarComentario(); return; }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state.dr && state.dr.modo === 'crear') { e.preventDefault(); crearDesdePanel(); }
        });
        d.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#seg-drop'); if (z) { e.preventDefault(); z.classList.add('is-over'); } });
        d.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#seg-drop'); if (z) z.classList.remove('is-over'); });
        d.addEventListener('drop', e => {
            const z = e.target.closest && e.target.closest('#seg-drop');
            if (!z) return;
            e.preventDefault();
            z.classList.remove('is-over');
            recibirArchivos(e.dataTransfer.files);
        });
        $('seg-file').addEventListener('change', e => { recibirArchivos(e.target.files); e.target.value = ''; });

        $('seg-modal').addEventListener('click', e => {
            if (e.target === e.currentTarget || e.target.closest('[data-m="cerrar"]')) { e.currentTarget.hidden = true; e.currentTarget.innerHTML = ''; return; }
            if (e.target.closest('[data-m="agregar"]')) { agregarAcceso(); return; }
            const q = e.target.closest('[data-acc-quitar]');
            if (q) {
                if (!window.confirm('¿Quitar el acceso a ' + q.dataset.accQuitar + '?')) return;
                sb().then(c => c.from('seguimiento_acceso').delete().eq('email', q.dataset.accQuitar)).then(r => {
                    if (r.error) toast('No se pudo quitar: ' + errTxt(r.error), 'error'); else { toast('Acceso retirado.', 'ok'); cargarAcceso(); }
                });
            }
        });
        $('seg-modal').addEventListener('change', e => {
            const s = e.target.closest('[data-acc-rol]');
            if (!s) return;
            sb().then(c => c.from('seguimiento_acceso').update({ rol: s.value }).eq('email', s.dataset.accRol)).then(r => {
                if (r.error) toast('No se cambió el rol: ' + errTxt(r.error), 'error'); else toast('Rol actualizado.', 'ok');
            });
        });
        $('seg-modal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.seg-acc-add input')) { e.preventDefault(); agregarAcceso(); } });

        // Cerrar el menú flotante al hacer clic fuera, al desplazarse o al cambiar el tamaño.
        document.addEventListener('mousedown', e => {
            const m = state.menu;
            if (m && !m.el.contains(e.target) && !m.anchor.contains(e.target)) cerrarMenu();
        }, true);
        window.addEventListener('resize', cerrarMenu);
        document.addEventListener('scroll', e => {
            if (state.menu && !state.menu.el.contains(e.target)) cerrarMenu();
        }, true);
    }

    function accionPanel(accion, el) {
        const dr = state.dr;
        const t = tareaDelPanel();
        if (!dr || !t) return;
        switch (accion) {
            case 'cerrar': return cerrarDrawer();
            case 'crear': return crearDesdePanel();
            case 'whatsapp': return recordar(t.id, el);
            case 'estatus': return menuEstatus(el, t, v => cambiarDesdePanel({ estatus: v }));
            case 'prioridad': return menuPrioridad(el, t, v => cambiarDesdePanel({ prioridad: v }));
            case 'subdireccion':
                return menuSimple(el, 'Subdirección', C.SUBDIRECCIONES.map(s => ({ valor: s.clave, texto: s.nombre, icono: s.icono, color: s.color })), t.subdireccion, v => {
                    const sd = C.SUBDIR[v];
                    const patch = { subdireccion: v };
                    if (t.gerencia && sd && !sd.gerencias.includes(t.gerencia)) patch.gerencia = null;
                    cambiarDesdePanel(patch);
                });
            case 'gerencia': {
                const sd = C.SUBDIR[t.subdireccion];
                if (!sd) { toast('Primero elige la subdirección.', 'info'); return; }
                const ops = [{ valor: '', texto: 'Sin gerencia (toda la subdirección)', icono: 'minus' }].concat(sd.gerencias.map(g => ({ valor: g, texto: g, icono: 'building' })));
                return abrirMenu(el, {
                    titulo: 'Gerencia · ' + sd.corto, buscar: 'Buscar o escribir otra área…', ancho: 320,
                    items: ops.map(o => Object.assign({ sel: (t.gerencia || '') === o.valor, fijo: !o.valor }, o)),
                    alElegir: v => cambiarDesdePanel({ gerencia: v || null }),
                    libre: texto => cambiarDesdePanel({ gerencia: texto }),
                });
            }
            case 'responsable': return menuResponsable(el, t, p => cambiarDesdePanel(patchResponsable(t, p)));
            case 'tipo': return menuSimple(el, 'Tipo', C.TIPOS.map(x => ({ valor: x.clave, texto: x.nombre, icono: x.icono })), t.tipo, v => cambiarDesdePanel({ tipo: v }));
            case 'recurrencia': return menuRepeticion(el, t);
            case 'completar': return actualizar(t.id, { estatus: t.estatus === 'completada' ? 'pendiente' : 'completada' });
            case 'reabrir': return actualizar(t.id, { estatus: 'pendiente' });
            case 'aviso':
                return menuSimple(el, 'Avisar antes del vencimiento', AVISOS.map(n => ({ valor: n, texto: n === 0 ? 'El mismo día' : plural(n, 'día antes', 'días antes'), icono: 'bell' })), +t.aviso_dias, v => cambiarDesdePanel({ aviso_dias: v }));
            case 'tab':
                dr.tab = el.dataset.tab;
                document.querySelectorAll('#seg-drawer .seg-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === dr.tab));
                pintarTab();
                return;
            case 'guia': {
                const visible = Boolean($('seg-guia'));
                dr.guia = !visible;
                if (dr.modo === 'crear') { state.guiaOculta = visible; guardarPrefs(); }
                pintarDrawer();
                if (dr.guia) $('seg-drawer').querySelector('.seg-dr-body').scrollTop = 0;
                return;
            }
            case 'comentar': return enviarComentario();
            case 'subir': return $('seg-file').click();
            case 'quitar-pendiente':
                dr.archivos = (dr.archivos || []).filter((_, k) => k !== +el.dataset.i);
                pintarEvidenciasPendientes();
                return;
            case 'mas': {
                const items = [
                    { valor: 'copiar', texto: 'Copiar mensaje de recordatorio', icono: 'copy' },
                    { valor: 'duplicar', texto: 'Duplicar tarea', icono: 'clone' },
                ];
                if (puedeEditar() && C.estaAbierta(t)) items.push({ valor: 'cancelar', texto: 'Marcar como cancelada', icono: 'ban' });
                if (esAdmin()) items.push({ sep: true }, { valor: 'eliminar', texto: 'Eliminar definitivamente', icono: 'trash', peligro: true });
                return abrirMenu(el, {
                    items, ancho: 240,
                    alElegir: v => {
                        if (v === 'copiar') {
                            const txt = C.mensajeWhatsApp(t, hoy(), usuario().nombre);
                            (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
                                .then(() => toast('Mensaje copiado.', 'ok'), () => toast('No se pudo copiar.', 'error'));
                        } else if (v === 'duplicar') duplicar(t.id);
                        else if (v === 'cancelar') actualizar(t.id, { estatus: 'cancelada' });
                        else if (v === 'eliminar') eliminarTarea(t.id);
                    },
                });
            }
            default:
        }
    }

    /* ¿Se repite? Las opciones de siempre y "Personalizado": cada N meses o años. */
    function patchRepeticion(t, r) {
        const patch = { recurrencia: r.recurrencia };
        // Sólo se manda recurrencia_meses si hace falta: así funciona aunque la
        // base todavía no tenga la columna (db/seguimiento_recurrencia_personalizada.sql).
        if (r.recurrencia === C.PERSONALIZADA || t.recurrencia_meses != null) patch.recurrencia_meses = r.recurrencia_meses;
        return patch;
    }

    function menuRepeticion(anchor, t) {
        const actual = C.mesesRecurrencia(t);
        const siguiente = m => m && t.fecha_limite ? 'Siguiente: ' + C.fechaCorta(C.sumarMeses(t.fecha_limite, m)) : '';
        const items = C.RECURRENCIAS.map(r => ({ valor: r.clave, texto: r.nombre, icono: r.meses ? 'repeat' : 'minus', sub: siguiente(r.meses),
            sel: t.recurrencia === r.clave }));
        items.push({ sep: true });
        items.push({ valor: '__otro__', texto: t.recurrencia === C.PERSONALIZADA ? C.textoCada(actual) + ' (personalizado)' : 'Personalizado…',
            sub: t.recurrencia === C.PERSONALIZADA ? siguiente(actual) : 'Cada cierto número de meses o años', icono: 'sliders', sel: t.recurrencia === C.PERSONALIZADA });
        abrirMenu(anchor, {
            titulo: '¿Cada cuándo se repite?', ancho: 250, items,
            alElegir: v => {
                if (v === '__otro__') { menuRepeticionPersonalizada(anchor, t); return; }
                cambiarDesdePanel(patchRepeticion(t, { recurrencia: v, recurrencia_meses: null }));
            },
        });
    }

    function menuRepeticionPersonalizada(anchor, t) {
        const actual = C.mesesRecurrencia(t) || 18;
        const enAnios = actual % 12 === 0;
        abrirMenu(anchor, {
            titulo: 'Repetir cada…', ancho: 270,
            html: '<div class="seg-rep">' +
                '<input type="number" class="seg-rep-n" min="1" max="240" value="' + (enAnios ? actual / 12 : actual) + '" aria-label="Cantidad">' +
                '<select class="seg-rep-u" aria-label="Unidad"><option value="meses"' + (enAnios ? '' : ' selected') + '>meses</option><option value="anios"' + (enAnios ? ' selected' : '') + '>años</option></select></div>' +
                '<div class="seg-rep-prev"></div>' +
                '<div class="seg-rep-acc"><button type="button" class="seg-btn seg-btn-sm" data-rep="volver">Volver</button>' +
                '<button type="button" class="seg-btn seg-btn-sm seg-btn-primary" data-rep="ok"><i class="fas fa-check"></i>Aplicar</button></div>',
            montar(el) {
                const n = el.querySelector('.seg-rep-n'), u = el.querySelector('.seg-rep-u'), prev = el.querySelector('.seg-rep-prev');
                const meses = () => (parseInt(n.value, 10) || 0) * (u.value === 'anios' ? 12 : 1);
                const pintar = () => {
                    const m = meses();
                    if (m < 1 || m > C.MAX_MESES) { prev.className = 'seg-rep-prev is-mal'; prev.textContent = 'De 1 mes a 20 años.'; return; }
                    prev.className = 'seg-rep-prev';
                    prev.innerHTML = esc(C.textoCada(m)) + (t.fecha_limite ? ' · siguiente: <b>' + esc(C.fechaLarga(C.sumarMeses(t.fecha_limite, m))) + '</b>' : '');
                };
                const aplicar = () => {
                    const m = meses();
                    if (m < 1 || m > C.MAX_MESES) { n.focus(); return; }
                    cerrarMenu();
                    cambiarDesdePanel(patchRepeticion(t, C.recurrenciaDeMeses(m)));
                };
                n.addEventListener('input', pintar);
                u.addEventListener('change', pintar);
                n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } });
                el.querySelector('[data-rep="ok"]').addEventListener('click', aplicar);
                el.querySelector('[data-rep="volver"]').addEventListener('click', () => menuRepeticion(anchor, t));
                pintar();
                setTimeout(() => { n.focus(); n.select(); }, 30);
            },
        });
    }

    /* ==========================================================================
       Tooltips
       Uno solo para todo el módulo, colgado del portal: oscuro, con título,
       detalle, atajo e ícono, flecha hacia el elemento y un retraso corto que
       desaparece al pasar de uno a otro. En pantallas táctiles no se usan.
       ========================================================================== */
    const tipEdo = { objetivo: null, timer: 0, visibleHasta: 0 };

    function pintarTip(obj) {
        const el = $('seg-tip');
        if (!el || !obj || !obj.isConnected || !obj.dataset.tip) return;
        const d = obj.dataset;
        const ico = d.tipIco ? '<i class="' + (d.tipIco.includes(' ') ? d.tipIco : 'fas fa-' + d.tipIco) + '"></i>' : '';
        el.innerHTML = '<div class="seg-tip-h">' + (d.tipC ? '<span class="seg-tip-dot" style="--c:' + esc(d.tipC) + '"></span>' : ico) +
            '<span>' + esc(d.tip) + '</span>' + (d.tipKbd ? '<kbd>' + esc(d.tipKbd) + '</kbd>' : '') + '</div>' +
            (d.tipSub ? '<div class="seg-tip-sub">' + esc(d.tipSub) + '</div>' : '');
        el.hidden = false;
        el.classList.remove('is-on');
        const r = obj.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        let top = r.top - h - 10;
        const abajo = top < 8;
        if (abajo) top = r.bottom + 10;
        const centro = r.left + r.width / 2;
        const left = Math.max(8, Math.min(centro - w / 2, window.innerWidth - w - 8));
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.setProperty('--flecha', Math.max(12, Math.min(w - 12, centro - left)) + 'px');
        el.classList.toggle('is-abajo', abajo);
        raf(() => el.classList.add('is-on'));
    }

    function ocultarTip() {
        clearTimeout(tipEdo.timer);
        const el = $('seg-tip');
        if (el && !el.hidden) { el.hidden = true; el.classList.remove('is-on'); tipEdo.visibleHasta = Date.now(); }
        tipEdo.objetivo = null;
    }

    function conectarTips() {
        const tactil = window.matchMedia && window.matchMedia('(hover: none)').matches;
        const buscarObj = n => (n && n.closest ? n.closest('.seg-root [data-tip]') : null);
        if (!tactil) {
            document.addEventListener('mouseover', e => {
                const obj = buscarObj(e.target);
                if (obj === tipEdo.objetivo) return;
                ocultarTip();
                if (!obj) return;
                tipEdo.objetivo = obj;
                // Recién visto otro: aparece casi de inmediato, como al recorrer una barra.
                const espera = Date.now() - tipEdo.visibleHasta < 350 ? 40 : 380;
                tipEdo.timer = setTimeout(() => { if (tipEdo.objetivo === obj) pintarTip(obj); }, espera);
            });
            document.addEventListener('mouseout', e => {
                const obj = tipEdo.objetivo;
                if (obj && !obj.contains(e.relatedTarget)) ocultarTip();
            });
        }
        // Con teclado: al llegar con Tab se explica igual.
        document.addEventListener('focusin', e => {
            const obj = buscarObj(e.target);
            if (!obj || obj !== e.target) return;
            try { if (!obj.matches(':focus-visible')) return; } catch (_) { /* sin :focus-visible */ }
            tipEdo.objetivo = obj;
            pintarTip(obj);
        });
        document.addEventListener('focusout', () => ocultarTip());
        ['mousedown', 'wheel', 'keydown'].forEach(ev => document.addEventListener(ev, () => ocultarTip(), true));
        document.addEventListener('scroll', () => ocultarTip(), true);
    }

    /* Atajos: N nueva tarea, / buscar, Esc cerrar. Sólo con la sección a la vista. */
    function atajos(e) {
        if (e.key === 'Escape') {
            if (state.menu) { cerrarMenu(); e.preventDefault(); return; }
            const m = $('seg-modal');
            if (m && !m.hidden) { m.hidden = true; m.innerHTML = ''; return; }
            if (state.dr) {
                // Con un comentario o descripción a medio escribir, Esc sólo sale del campo.
                const a = document.activeElement;
                if (a && a.tagName === 'TEXTAREA' && a.value.trim() && $('seg-drawer').contains(a)) { a.blur(); return; }
                cerrarDrawer();
            }
            return;
        }
        if (!seccionActiva() || !state.cargado || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (state.dr || document.querySelector('.modal.show')) return;
        if (e.key === '/') { e.preventDefault(); $('seg-q')?.focus(); }
        else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); nuevaTarea(); }
    }

    /* ==========================================================================
       Arranque
       ========================================================================== */
    function iniciar() {
        const sec = asegurarSeccion();
        if (!sec) return;
        cargarPrefs();
        new MutationObserver(() => {
            if (seccionActiva()) { if (!state.cargado || !$('seg-body')) entrar(); else if (state.sucio) renderTodo(); }
            else if (state.dr) cerrarDrawer(true);
        }).observe(sec, { attributes: true, attributeFilter: ['class'] });
        document.addEventListener('keydown', atajos);
        conectarTips();
        const reRevisar = () => { olvidarSesion(); revisarAcceso().then(() => { if (seccionActiva()) entrar(); }); };
        window.addEventListener('aifa:login', reRevisar);
        // Al entrar, salir o cambiar de cuenta se vuelve a revisar el acceso.
        // Fuera del callback (setTimeout): supabase-js se traba si dentro de él
        // se llama a otra función de auth.
        sb().then(c => {
            if (c && c.auth && typeof c.auth.onAuthStateChange === 'function') {
                c.auth.onAuthStateChange((ev, session) => setTimeout(() => {
                    const email = String((session && session.user && session.user.email) || '').toLowerCase();
                    if (ev === 'SIGNED_OUT' || !email) { if (state.sesion.email || state.rol) olvidarSesion(); return; }
                    if (email !== state.sesion.email && !state.revisando) reRevisar();
                }, 0));
            }
        }).catch(() => {});
        // La sesión puede restaurarse un poco después de cargar la página.
        let intentos = 0;
        const probar = () => {
            revisarAcceso().then(rol => {
                if (seccionActiva()) entrar();
                if (rol == null && !state.revisado && ++intentos < 6) setTimeout(probar, 1500);
            });
        };
        probar();
        // Las vencidas cambian a medianoche aunque nadie toque nada.
        setInterval(() => { if (state.cargado) renderPronto(); }, 5 * 60 * 1000);
    }

    // La sección se crea en cuanto carga el script: así existe cuando la
    // aplicación restaura #seguimiento desde la URL.
    asegurarSeccion();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();

    window.seguimientoModule = Object.freeze({
        abrir: abrirTarea,
        nueva: nuevaTarea,
        recargar: () => { state.cargado = false; return entrar(); },
        revisarAcceso,
    });
})();
