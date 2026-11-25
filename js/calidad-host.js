/*
 * calidad-host.js — Calidad (SIGEC) se abre en su propia pestaña.
 *
 * El enlace Edificio Terminal → Calidad (SIGEC) no cambia la pantalla de AIFA
 * Operaciones: abre calidad/index.html en una pestaña aparte (siempre la misma,
 * si ya estaba abierta solo se trae al frente). Allí la cuenta es la misma con
 * la que se entró aquí; el rol lo da la base (calidad_mi_rol(), db/calidad_sigec.sql).
 *
 * El enlace sigue siendo data-section="calidad" para que Administración de
 * usuarios lo muestre u oculte como cualquier módulo. Si el navegador bloquea
 * la pestaña, o se llega por #calidad, la sección muestra un botón para abrirla.
 */
(function () {
    'use strict';

    var PAGINA = 'calidad/index.html';
    var PESTANA = 'aifa-calidad';

    /** Abre (o trae al frente) la pestaña de Calidad. false si el navegador la bloqueó. */
    function abrir(ruta) {
        var w = null;
        try { w = window.open(PAGINA + '#/' + (ruta || 'inicio'), PESTANA); } catch (_) { w = null; }
        if (!w) return false;
        try { w.focus(); } catch (_) { }
        return true;
    }

    function cerrarMenuMovil() {
        var s = document.getElementById('sidebar');
        var o = document.getElementById('sidebar-overlay');
        if (s && o && s.classList.contains('visible')) {
            s.classList.remove('visible');
            o.classList.remove('active');
            document.body.classList.remove('sidebar-open');
        }
    }

    // En fase de captura: llega antes que el manejador del menú, que cambiaría de sección.
    document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('[data-section="calidad"]');
        if (!a) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        cerrarMenuMovil();
        if (!abrir() && typeof window.showSection === 'function') window.showSection('calidad', a);
    }, true);

    window.calidadHost = { abrir: abrir };
})();
