/* ========================================================================
   Mapa Interactivo — toggle del botón "Mapa Interactivo" del header.
   Extraído de index.html (inline) en v=20260616m para reducir HTML y
   permitir cargarlo con `defer`. Comportamiento idéntico al original.
   ======================================================================== */
(function () {
    var _mapaActiveSectionKey = null;
    var _mapaActiveSectionEl  = null;
    var _mapaLastToggleTs     = 0;
    // Recuerda si NOSOTROS agregamos la clase navdeck-active al abrir, para
    // poder retirarla al cerrar (sin afectar el caso en que el usuario ya
    // estaba viendo un modulo de deck).
    var _mapaAddedNavdeckActive = false;

    function _mapaLog(msg, extra) {
        try { console.log('[MapaInteractivo]', msg, extra || ''); } catch (e) {}
    }
    function _mapaErr(msg, err) {
        try { console.error('[MapaInteractivo]', msg, err); } catch (e) {}
    }

    window.toggleMapaInteractivo = function () {
        // Double-fire guard: ignore second invocation within 250ms (e.g. onclick + listener both firing)
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (now - _mapaLastToggleTs < 250) {
            _mapaLog('toggle ignored (double-fire guard)', now - _mapaLastToggleTs);
            return;
        }
        _mapaLastToggleTs = now;

        try {
            var section = document.getElementById('mapa-interactivo-section');
            var iframe  = document.getElementById('mapa-interactivo-iframe');
            var btn     = document.getElementById('btn-mapa-interactivo');
            if (!section || !iframe) {
                _mapaErr('section or iframe missing', { section: !!section, iframe: !!iframe });
                return;
            }
            var isOpen  = section.classList.contains('active');
            _mapaLog(isOpen ? 'closing' : 'opening');

            if (isOpen) {
                document.body.classList.remove('mapa-abierto');
                section.classList.remove('active');
                iframe.src = '';
                if (btn) btn.classList.remove('active');
                if (_mapaAddedNavdeckActive) {
                    document.body.classList.remove('navdeck-active');
                    _mapaAddedNavdeckActive = false;
                }
                if (_mapaActiveSectionEl && document.body.contains(_mapaActiveSectionEl)) {
                    _mapaActiveSectionEl.classList.add('active');
                } else if (typeof showSection === 'function' && _mapaActiveSectionKey) {
                    try { showSection(_mapaActiveSectionKey); } catch (e) { _mapaErr('showSection failed', e); }
                }
                _mapaActiveSectionKey = null;
                _mapaActiveSectionEl  = null;
            } else {
                // La barra HOY / MAÑANA se oculta dentro de los módulos; con el mapa
                // abierto vuelve (ahí está su botón para cerrarlo). Se marca antes de
                // medirla para que el mapa quede justo debajo.
                document.body.classList.add('mapa-abierto');
                var agBar = document.getElementById('ag-today-bar');
                var topPx = agBar ? (agBar.getBoundingClientRect().bottom) : 160;
                section.style.top = topPx + 'px';

                _mapaActiveSectionEl  = document.querySelector('.content-section.active');
                _mapaActiveSectionKey = typeof getActiveSectionKey === 'function' ? getActiveSectionKey() : null;
                document.querySelectorAll('.content-section').forEach(function (s) { s.classList.remove('active'); });
                section.classList.add('active');
                iframe.src = 'aifa_plano_interactivo.html';
                if (btn) btn.classList.add('active');

                // En modo deck (navdeck-mode sin navdeck-active) hay reglas globales
                // que ocultan .main-content y .content-section. Activamos navdeck-active
                // para que el contenedor padre se renderice y el mapa sea visible.
                if (document.body.classList.contains('navdeck-mode') &&
                    !document.body.classList.contains('navdeck-active')) {
                    document.body.classList.add('navdeck-active');
                    _mapaAddedNavdeckActive = true;
                    _mapaLog('navdeck-active enabled for map view');
                }
            }
        } catch (e) {
            _mapaErr('toggle threw', e);
        }
    };

    // Backup binding: si el onclick inline falla por cualquier razón
    // (listener externo con stopImmediatePropagation, atributo eliminado
    // por sanitizer, etc.) un addEventListener directo sigue activando el toggle.
    function _mapaBindBtn() {
        var btn = document.getElementById('btn-mapa-interactivo');
        if (!btn || btn.dataset.mapaBound === '1') return;
        btn.dataset.mapaBound = '1';
        btn.addEventListener('click', function () {
            // El onclick inline ya llama a toggleMapaInteractivo; la guardia
            // de doble-disparo de 250 ms previene la doble ejecución.
            window.toggleMapaInteractivo();
        });
        _mapaLog('button bound');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _mapaBindBtn);
    } else {
        _mapaBindBtn();
    }

    // Si el mapa deja de estar activo por cualquier camino (menú, botón Inicio,
    // otra sección), la barra HOY / MAÑANA vuelve a su regla normal.
    function _mapaVigilarSeccion() {
        var section = document.getElementById('mapa-interactivo-section');
        if (!section || section.dataset.mapaVigilada === '1' || typeof MutationObserver === 'undefined') return;
        section.dataset.mapaVigilada = '1';
        new MutationObserver(function () {
            if (!section.classList.contains('active')) document.body.classList.remove('mapa-abierto');
        }).observe(section, { attributes: true, attributeFilter: ['class'] });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _mapaVigilarSeccion);
    } else {
        _mapaVigilarSeccion();
    }

    // Cuando se navega via menu-item, descargar el iframe y limpiar estado
    document.addEventListener('click', function (e) {
        var menuItem = e.target.closest('.menu-item[data-section]');
        if (!menuItem) return;
        var iframe  = document.getElementById('mapa-interactivo-iframe');
        var btn     = document.getElementById('btn-mapa-interactivo');
        var section = document.getElementById('mapa-interactivo-section');
        if (section) section.classList.remove('active');
        document.body.classList.remove('mapa-abierto');
        if (iframe)  iframe.src = '';
        if (btn)     btn.classList.remove('active');
        if (_mapaAddedNavdeckActive) {
            _mapaAddedNavdeckActive = false;
        }
        _mapaActiveSectionKey = null;
        _mapaActiveSectionEl  = null;
    });
})();
