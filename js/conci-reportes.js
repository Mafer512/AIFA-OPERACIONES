/* ==========================================================================
   Conciliación > Manifiestos > Reportes
   --------------------------------------------------------------------------
   El botón "Reportes" de la barra de Manifiestos intercambia la tabla por la
   vista de reportes, que se divide en dos apartados por pestañas: Carga y
   Pasajeros. Es el mismo mecanismo que usa conciliacion-board.js en la
   pestaña de Itinerario: dos vistas hermanas y una que se oculta con d-none,
   así el estado de la tabla (captura en curso, filtros, scroll) sobrevive
   intacto al ir y volver.
   ========================================================================== */
(function () {
    'use strict';

    const ID_TABLA = 'conci-manifiestos-tabla-view';
    const ID_REPORTES = 'conci-reportes-view';

    function vistas() {
        return {
            tabla: document.getElementById(ID_TABLA),
            reportes: document.getElementById(ID_REPORTES),
            btn: document.getElementById('btn-conci-reportes')
        };
    }

    /** Muestra la vista de reportes y oculta la tabla de manifiestos. */
    function abrirReportes() {
        const { tabla, reportes, btn } = vistas();
        if (!tabla || !reportes) return;
        tabla.classList.add('d-none');
        reportes.classList.remove('d-none');
        if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
        document.body.classList.add('conci-reportes-abierto');
        // Devolver el foco a un control de la vista nueva para que quien navega
        // por teclado no quede anclado en un botón que acaba de ocultarse.
        document.getElementById('btn-conci-reportes-volver')?.focus();
    }

    /** Regresa a la tabla de Conciliación Manifiestos. */
    function cerrarReportes() {
        const { tabla, reportes, btn } = vistas();
        if (!tabla || !reportes) return;
        reportes.classList.add('d-none');
        tabla.classList.remove('d-none');
        if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
        document.body.classList.remove('conci-reportes-abierto');
        btn?.focus();
    }

    function alternarReportes() {
        const { reportes } = vistas();
        if (!reportes) return;
        if (reportes.classList.contains('d-none')) abrirReportes();
        else cerrarReportes();
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-conci-reportes')?.addEventListener('click', alternarReportes);
        document.getElementById('btn-conci-reportes-volver')?.addEventListener('click', cerrarReportes);

        // Esc cierra los reportes solo cuando están abiertos, para no robarle la
        // tecla a la captura por celda de la tabla de Manifiestos.
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            const reportes = document.getElementById(ID_REPORTES);
            if (!reportes || reportes.classList.contains('d-none')) return;
            cerrarReportes();
        });
    });

    // Al cambiar de pestaña dentro de Conciliación, la vista de reportes vuelve
    // a su estado cerrado: pertenece a Manifiestos y no debe seguir montada
    // cuando el operador se va a Itinerario o Estadística.
    document.addEventListener('DOMContentLoaded', () => {
        ['tab-conci-itinerario', 'tab-conci-estadistica'].forEach(id => {
            document.getElementById(id)?.addEventListener('shown.bs.tab', cerrarReportes);
        });
    });

    window.conciReportes = { abrir: abrirReportes, cerrar: cerrarReportes, alternar: alternarReportes };
})();
