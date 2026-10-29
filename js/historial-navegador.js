/* ==========================================================================
   Flechas del navegador (Atrás / Adelante)
   --------------------------------------------------------------------------
   La aplicación cambia de módulo sin recargar la página, y cada cambio
   REEMPLAZA la dirección (history.replaceState en showSection y
   exitSectionToMenu). Así el navegador nunca tenía a dónde regresar: la flecha
   Atrás sacaba al usuario de la página en vez de llevarlo a la vista anterior.

   Aquí no se toca ninguna de esas llamadas. Solo se decide, en el momento en
   que ocurren, si el cambio lo pidió el usuario —un clic o una tecla— y en ese
   caso se APILA una entrada nueva en vez de reemplazar la actual. Lo que la
   aplicación hace por su cuenta (restaurar la sesión, normalizar el hash,
   sacar a alguien de un módulo al que perdió acceso) sigue reemplazando como
   siempre, para no llenar el historial de pasos que nadie dio.

   Al ir Atrás o Adelante (flechas, Alt+←/→, botones laterales del ratón,
   gesto de deslizar en el celular) el navegador dispara 'popstate' y aquí se
   reabre la vista que indica la dirección: el módulo del hash, o el lanzador
   de tarjetas si no hay hash.
   ========================================================================== */
(function () {
    'use strict';

    const SESSION_USER = 'currentUser';

    /* Eventos con los que una persona pide navegar. Un sondeo de permisos, un
       temporizador o una promesa que se resuelve corren sin window.event. */
    const EVENTOS_DEL_USUARIO = new Set([
        'click', 'auxclick', 'keydown', 'keyup', 'change', 'submit',
        'pointerup', 'mouseup', 'touchend'
    ]);

    /* Pantalla completa de Conciliación y de Reportes. Sus botones "Inicio"
       las sueltan al salir; salir con Atrás tiene que hacer lo mismo, o el
       lanzador quedaría tapado. Si se regresa a Conciliación, showSection las
       vuelve a poner según la pestaña activa. */
    const CLASES_DE_PANTALLA_COMPLETA = [
        'conci-manifest-workspace', 'conci-itinerary-workspace', 'conci-estadistica-workspace',
        'conci-reportes-abierto', 'conci-reportes-workspace'
    ];

    let aplicandoHistorial = false;

    /** Módulo al que apunta un hash: '' es el lanzador, null si no es una vista de la app. */
    function claveDeVista(hash) {
        const clave = String(hash || '').replace(/^#/, '').trim();
        if (!clave) return '';
        if (clave === 'recover' || !/^[a-z0-9-]+$/i.test(clave)) return null;
        return clave;
    }

    function pidioElUsuario() {
        const evento = window.event;
        return !!evento && EVENTOS_DEL_USUARIO.has(evento.type);
    }

    function debeApilar(url) {
        if (aplicandoHistorial || url == null || !pidioElUsuario()) return false;
        let destino;
        try { destino = new URL(String(url), location.href); } catch (_) { return false; }
        // Solo cambios de vista dentro de esta misma página.
        if (destino.origin !== location.origin
            || destino.pathname !== location.pathname
            || destino.search !== location.search
            || destino.hash === location.hash) return false;
        return claveDeVista(destino.hash) !== null && claveDeVista(location.hash) !== null;
    }

    const reemplazarOriginal = history.replaceState;
    history.replaceState = function (state, title, url) {
        if (debeApilar(url)) return history.pushState(state, title, url);
        return reemplazarOriginal.apply(this, arguments);
    };

    function irAlLanzador() {
        if (typeof window._navdeckShowMenu === 'function') window._navdeckShowMenu();
        else if (typeof window.exitSectionToMenu === 'function') window.exitSectionToMenu();
    }

    window.addEventListener('popstate', () => {
        // Sin sesión manda la pantalla de inicio de sesión: no hay vista que abrir.
        try { if (!sessionStorage.getItem(SESSION_USER)) return; } catch (_) { return; }
        const clave = claveDeVista(location.hash);
        if (clave === null) return;

        aplicandoHistorial = true;
        try {
            document.body.classList.remove(...CLASES_DE_PANTALLA_COMPLETA);
            // restoreSectionFromNavigation valida permisos: un módulo al que ya
            // no se tiene acceso no se abre y se cae al lanzador.
            // preserveActiveTab: regresar es volver a la sub-pestaña en la que
            // se estaba, no a la de arranque que pide el elemento del menú.
            const abierta = !!clave
                && typeof window.restoreSectionFromNavigation === 'function'
                && window.restoreSectionFromNavigation(clave, { preserveActiveTab: true });
            if (!abierta) irAlLanzador();
        } catch (e) {
            console.warn('[Historial] no se pudo abrir la vista:', e);
        } finally {
            aplicandoHistorial = false;
        }
    });
})();
