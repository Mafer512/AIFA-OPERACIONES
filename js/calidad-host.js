/*
 * calidad-host.js — Calidad (SIGEC) dentro de Edificio Terminal.
 *
 * El módulo vive en calidad/ y se muestra en un iframe del mismo sitio
 * (calidad/modulo.js), así sus estilos y su Bootstrap no chocan con los de aquí.
 * Este archivo le entrega quién está conectado y con qué rol, y mantiene viva su
 * sesión mientras la de AIFA Operaciones siga abierta; al cerrarla, Calidad se
 * cierra con ella.
 *
 * El rol sale de la base (calidad_mi_rol(), db/calidad_sigec.sql), que lo
 * calcula con el nivel del módulo «calidad» en Administración de usuarios. La
 * base es también la que autoriza cada lectura y escritura (RLS).
 */
(function () {
    'use strict';

    var SECCION = 'calidad';
    var ROLES = ['admin', 'supervisor', 'capturista', 'consulta'];
    var NIVEL_A_ROL = { admin: 'admin', edit: 'supervisor', capture: 'capturista', read: 'consulta' };
    var CADA_MS = 5000;

    var montado = null;   // lo que devuelve SigecCalidad.montar
    var firma = '';       // cuenta y rol con que se montó
    var vigia = null;
    var abriendo = null;
    var esperas = 0;

    function cuenta() {
        try { return sessionStorage.getItem('currentUser') || ''; } catch (_) { return ''; }
    }

    function leer(clave) {
        try { return sessionStorage.getItem(clave) || ''; } catch (_) { return ''; }
    }

    function contenedor() { return document.getElementById('vista-calidad'); }

    function seccionActiva() {
        var s = document.getElementById(SECCION + '-section');
        return !!s && s.classList.contains('active');
    }

    // Rol que da la base; si la función aún no existe (falta el SQL), el mismo
    // cálculo que usa el menú. null = sin acceso.
    async function rolDeCalidad() {
        var sb = window.supabaseClient;
        if (sb && typeof sb.rpc === 'function') {
            try {
                var r = await sb.rpc('calidad_mi_rol');
                if (r && !r.error) return ROLES.indexOf(r.data) >= 0 ? r.data : null;
            } catch (_) { /* sin red o sin la función: se usa el menú */ }
        }
        var nivel = typeof window.sectionLevel === 'function' ? window.sectionLevel(SECCION) : 'read';
        return NIVEL_A_ROL[nivel] || null;
    }

    function usuario(rol) {
        var email = cuenta();
        return {
            username: email,
            name: leer('user_fullname') || email,
            role: rol,
            area: leer('user_area') || 'AIFA Operaciones',
        };
    }

    function aviso(icono, titulo, texto) {
        var c = contenedor();
        if (!c) return;
        var caja = document.createElement('div');
        caja.className = 'vista-calidad__aviso';
        var i = document.createElement('i');
        i.className = 'fas ' + icono;
        i.setAttribute('aria-hidden', 'true');
        var h = document.createElement('strong');
        h.textContent = titulo;
        var p = document.createElement('p');
        p.textContent = texto;
        caja.append(i, h, p);
        c.replaceChildren(caja);
    }

    function desmontar() {
        if (montado) { try { montado.desmontar(); } catch (_) { } }
        montado = null;
        firma = '';
        if (vigia) { clearInterval(vigia); vigia = null; }
    }

    // Cerrar Calidad junto con AIFA Operaciones (o si cambió la cuenta).
    function cerrar() {
        desmontar();
        try { if (window.SigecCalidad) window.SigecCalidad.cerrarSesion(); } catch (_) { }
        var c = contenedor();
        if (c) c.replaceChildren();
    }

    function vigilar() {
        if (vigia) return;
        vigia = setInterval(function () {
            if (!montado) return;
            if (firma.split('|')[0] !== cuenta()) { cerrar(); return; }
            try { window.SigecCalidad.renovarSesion(); } catch (_) { }
        }, CADA_MS);
    }

    // El módulo se quedó sin sesión: se le vuelve a entregar si AIFA Operaciones
    // sigue abierta; si no, se cierra.
    function alSalir() {
        if (!cuenta()) { cerrar(); return; }
        desmontar();
        if (seccionActiva()) abrir();
    }

    async function _abrir(ruta) {
        var c = contenedor();
        if (!c || !cuenta()) return;
        if (!window.SigecCalidad) {
            aviso('fa-triangle-exclamation', 'No se pudo cargar Calidad', 'Recarga la página. Si sigue igual, avisa al administrador.');
            return;
        }
        var rol = await rolDeCalidad();
        if (!rol) {
            desmontar();
            aviso('fa-lock', 'Sin acceso a Calidad', 'Tu cuenta no tiene este módulo. Solicítalo al administrador de AIFA Operaciones.');
            return;
        }
        var u = usuario(rol);
        var nueva = u.username + '|' + u.role;
        window.SigecCalidad.iniciarSesion(u);
        if (montado && firma === nueva && c.contains(montado.iframe)) {
            if (ruta) montado.ir(ruta);
            return;
        }
        desmontar();
        firma = nueva;
        montado = window.SigecCalidad.montar(c, { ruta: ruta || 'inicio', alSalir: alSalir });
        vigilar();
    }

    /** Abre (o deja como está) el módulo. ruta: inicio | reportes | encuestas | … */
    function abrir(ruta) {
        if (abriendo) return abriendo;
        abriendo = _abrir(ruta).catch(function (e) {
            console.warn('[Calidad]', e);
        }).then(function () { abriendo = null; });
        return abriendo;
    }

    function estilos() {
        if (document.getElementById('calidad-host-css')) return;
        var st = document.createElement('style');
        st.id = 'calidad-host-css';
        st.textContent = [
            '.vista-calidad{height:calc(100vh - 190px);min-height:560px;border-radius:14px;overflow:hidden;',
            'background:#f4f6f5;border:1px solid rgba(15,53,41,.12);box-shadow:0 1px 3px rgba(15,23,42,.06);}',
            '.vista-calidad iframe{display:block;width:100%;height:100%;border:0;}',
            '.vista-calidad__aviso{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;',
            'gap:8px;padding:24px;text-align:center;color:#475569;}',
            '.vista-calidad__aviso i{font-size:2rem;color:#0F3529;opacity:.8;}',
            '.vista-calidad__aviso strong{font-size:1.05rem;color:#0f172a;}',
            '.vista-calidad__aviso p{margin:0;max-width:440px;}',
            '@media (max-width:767.98px){.vista-calidad{height:calc(100vh - 150px);border-radius:10px;}}',
            'body.dark-mode .vista-calidad,[data-theme="dark"] .vista-calidad{background:#0f1a16;border-color:rgba(255,255,255,.08);}'
        ].join('');
        document.head.appendChild(st);
    }

    // Al recargar con #calidad la sección puede activarse antes de que termine
    // de restaurarse la sesión: se espera a la cuenta (hasta ~20 s).
    function alActivar() {
        if (!seccionActiva()) { esperas = 0; return; }
        if (cuenta()) { esperas = 0; abrir(); return; }
        if (esperas++ < 40) setTimeout(alActivar, 500);
    }

    function iniciar() {
        estilos();
        var sec = document.getElementById(SECCION + '-section');
        if (!sec) return;
        // La sección se activa con showSection (clase .active): entonces se monta.
        new MutationObserver(alActivar).observe(sec, { attributes: true, attributeFilter: ['class'] });
        alActivar();
    }

    window.calidadHost = { abrir: abrir, cerrar: cerrar };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
        else iniciar();
    }
})();
