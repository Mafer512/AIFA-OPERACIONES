/* ==========================================================================
   Reportes (Carga / Pasajeros)
   --------------------------------------------------------------------------
   Reportes es una PÁGINA propia, no una vista dentro de Conciliación: su
   marcado es una .content-section hermana de #conciliacion-section, así que
   al abrirla las pestañas de Conciliación (Itinerario / Manifiestos /
   Estadística) desaparecen junto con el resto de esa sección y queda solo la
   barra de Reportes con sus dos apartados.

   La navegación se hace aquí y no con showSection() porque showSection filtra
   por la lista blanca de módulos del usuario (isSectionAllowed) y Reportes no
   es un módulo del menú: se entra desde Manifiestos, que ya validó el acceso.
   Pasar por showSection rebotaría al operador a su módulo por omisión.
   ========================================================================== */
(function () {
    'use strict';

    const ID_REPORTES = 'conci-reportes-section';
    const ID_ORIGEN = 'conciliacion-section';

    /* Clases del espacio de trabajo a pantalla completa de Conciliación: fijan
       esa sección sobre todo lo demás, así que hay que soltarlas al salir. */
    const CLASES_ORIGEN = ['conci-manifest-workspace', 'conci-itinerary-workspace'];

    /* Reportes usa su propio espacio de trabajo a pantalla completa, con las
       mismas reglas: sin encabezado, sin barra de agenda y sin barra lateral,
       de modo que arriba quede solo su barra con el botón Menú. */
    const CLASE_WORKSPACE = 'conci-reportes-workspace';

    function seccion(id) { return document.getElementById(id); }

    function reportesAbiertos() {
        return !!seccion(ID_REPORTES)?.classList.contains('active');
    }

    /** Abre Reportes como página completa, apagando la sección de Conciliación. */
    function abrirReportes() {
        const destino = seccion(ID_REPORTES);
        if (!destino) return;

        document.body.classList.remove(...CLASES_ORIGEN);
        document.querySelectorAll('.content-section.active')
            .forEach(sec => sec.classList.remove('active'));
        destino.classList.add('active');
        document.body.classList.add('conci-reportes-abierto', CLASE_WORKSPACE);

        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
        seccion(ID_REPORTES)?.querySelector('#tab-conci-rep-carga')?.focus();
    }

    /**
     * Regresa a Conciliación tal como estaba. No se toca la pestaña activa:
     * Manifiestos sigue siendo la suya porque nunca se desmontó, con su
     * captura, sus filtros y su scroll intactos.
     */
    function cerrarReportes() {
        const origen = seccion(ID_ORIGEN);
        seccion(ID_REPORTES)?.classList.remove('active');
        document.body.classList.remove('conci-reportes-abierto', CLASE_WORKSPACE);
        if (!origen) return;

        origen.classList.add('active');
        // Devuelve el modo pantalla completa si la pestaña activa lo pide.
        if (typeof window._conciUpdateWorkspaceMode === 'function') {
            window._conciUpdateWorkspaceMode();
        }
        document.getElementById('btn-conci-reportes')?.focus();
    }

    function alternarReportes() {
        if (reportesAbiertos()) cerrarReportes();
        else abrirReportes();
    }

    /** El botón Menú sale del módulo por completo, no regresa a Manifiestos. */
    function irAlMenu() {
        seccion(ID_REPORTES)?.classList.remove('active');
        document.body.classList.remove('conci-reportes-abierto', CLASE_WORKSPACE, ...CLASES_ORIGEN);
        if (typeof window._navdeckShowMenu === 'function') window._navdeckShowMenu();
        else if (typeof window.exitSectionToMenu === 'function') window.exitSectionToMenu();
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-conci-reportes')?.addEventListener('click', alternarReportes);
        document.getElementById('btn-conci-reportes-volver')?.addEventListener('click', cerrarReportes);
        document.getElementById('btn-conci-reportes-menu')?.addEventListener('click', irAlMenu);

        // Esc regresa a Manifiestos solo desde Reportes, para no robarle la
        // tecla a la captura por celda de la tabla.
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !reportesAbiertos()) return;
            cerrarReportes();
        });

        // Si el operador se va por el menú lateral, showSection ya apagó esta
        // sección; solo queda limpiar la marca del body.
        document.querySelectorAll('.menu-item[data-section]').forEach(link => {
            link.addEventListener('click', () => {
                setTimeout(() => {
                    if (reportesAbiertos()) return;
                    document.body.classList.remove('conci-reportes-abierto', CLASE_WORKSPACE);
                }, 0);
            });
        });
    });

    window.conciReportes = {
        abrir: abrirReportes,
        cerrar: cerrarReportes,
        alternar: alternarReportes,
        abiertos: reportesAbiertos
    };
})();
