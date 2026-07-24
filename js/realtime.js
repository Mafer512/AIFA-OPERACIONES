// ═══════════════════════════════════════════════════════════════════
//  REALTIME MANAGER — js/realtime.js
//  Suscripción centralizada a cambios en Supabase (postgres_changes).
//  Cuando cualquier tabla cambia:
//    1. Llama a las funciones de recarga registradas para esa tabla.
//    2. Dispara el evento DOM  window → CustomEvent('rt:change', { detail:{table,event} })
//  API pública:
//    window.rtManager.watch(tabla_o_array, fn)  — registrar recarga
//    window.rtManager.unwatch(fn)               — desregistrar
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Mapa tabla → [callbacks]
    const _reg = {};
    // Timers de debounce por tabla (evita recargas múltiples si llegan ráfagas)
    const _timers = {};
    const DEBOUNCE_MS = 600;

    let _channel = null;
    let _ready    = false;

    /* ─── API pública ──────────────────────────────────────────── */
    window.rtManager = {
        /**
         * Registrar una función de recarga para una o varias tablas.
         * @param {string|string[]} tables  Nombre(s) de tabla de Supabase
         * @param {Function}        fn      Función sin argumentos a llamar al detectar cambio
         */
        watch: function (tables, fn) {
            var list = Array.isArray(tables) ? tables : [tables];
            list.forEach(function (t) {
                if (!_reg[t]) _reg[t] = [];
                if (_reg[t].indexOf(fn) === -1) _reg[t].push(fn);
            });
        },
        /** Desregistrar una función de todas las tablas */
        unwatch: function (fn) {
            Object.keys(_reg).forEach(function (t) {
                _reg[t] = _reg[t].filter(function (f) { return f !== fn; });
            });
        }
    };

    /* ─── Dispatch con debounce ────────────────────────────────── */
    function _fire(table, eventType) {
        // Evento DOM (cualquier módulo puede escuchar)
        window.dispatchEvent(new CustomEvent('rt:change', {
            detail: { table: table, event: eventType }
        }));

        // Llamar callbacks registrados (con debounce por tabla)
        var fns = (_reg[table] || []).concat(_reg['*'] || []);
        if (fns.length === 0) return;

        clearTimeout(_timers[table]);
        _timers[table] = setTimeout(function () {
            fns.forEach(function (fn) {
                try { fn(table, eventType); } catch (e) {
                    console.error('[RT] Error en callback de', table, ':', e);
                }
            });
        }, DEBOUNCE_MS);
    }

    /* ─── Crear canal Supabase Realtime ─────────────────────────── */
    function _setup(client) {
        if (_channel) {
            try { client.removeChannel(_channel); } catch (_) {}
            _channel = null;
        }

        _channel = client
            .channel('rt-public-all', { config: { broadcast: { ack: false } } })
            .on('postgres_changes',
                { event: '*', schema: 'public' },
                function (payload) {
                    var table = (payload && payload.table) ? payload.table : '';
                    var ev    = (payload && payload.eventType) ? payload.eventType : 'CHANGE';
                    if (table) _fire(table, ev);
                }
            )
            .subscribe(function (status, err) {
                if (status === 'SUBSCRIBED') {
                    console.log('[RT] Realtime activo — escuchando cambios en public.*');
                    _ready = true;
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn('[RT] Problema con canal realtime (' + status + '). Reintentando en 8 s…');
                    _ready = false;
                    setTimeout(function () { _setup(client); }, 8000);
                } else if (status === 'CLOSED') {
                    _ready = false;
                }
            });
    }

    /* ─── Registro automático de módulos conocidos ──────────────── */
    // Se usan envoltorios "lazy" para que si el módulo aún no cargó
    // la función se resuelva en el momento del evento, no al registrar.
    function _lazy(fnName) {
        return function () {
            var fn = window[fnName];
            if (typeof fn === 'function') fn();
        };
    }

    // Recarga el itinerario/gráficas de inicio manteniendo filtros actuales
    function _reloadItinerario() {
        var fn = window.loadItineraryData;
        if (typeof fn === 'function') fn({ preserveFilters: true });
    }

    function _registerModules() {
        var rm = window.rtManager;

        // ── Itinerario / gráficas de inicio ─────────────────────
        rm.watch(['flights'], _reloadItinerario);

        // ── YoY Aviación General, Carga e Histórica ──────────────
        rm.watch(['monthly_operations'], function() {
            _lazy('genYoyReload')();
            _lazy('cargoYoyReload')();
            _lazy('comHistReload')();
        });

        // ── Operaciones parte diaria / mensual / anual ───────────
        rm.watch([
            'daily_operations',
            'vuelos_parte_operaciones',
            'parte_operations',
            'monthly_operations',
            'monthly_operations_2025',
            'annual_operations'
        ], function() {
            _lazy('parteOpsReload')();
            _lazy('refreshOperationsCardsData')();
            // Forzar recarga en analisis-mensual y analisis-anual
            window._monthlyDataLoaded = false;
            window._annualDataLoaded  = false;
        });

        // ── Demoras ──────────────────────────────────────────────
        rm.watch(['demoras', 'Demoras'], _lazy('renderDemoras'));

        // ── Manifiestos pasajeros ────────────────────────────────
        rm.watch([
            'Base de datos Manifiestos 2025',
            'Base de Datos Manifiestos Febrero 2026'
        ], _lazy('manifiestoReload'));

        // ── Manifiestos carga ────────────────────────────────────
        rm.watch(['Base de Manifiestos Carga Febrero 2026'], _lazy('cargaReload'));

        // ── Agenda (barra lateral de próximos eventos) ───────────
        rm.watch([
            'agenda_comites',
            'agenda_reuniones',
            'agenda_acuerdos'
        ], _lazy('agBarRefresh'));

        // ── Puntualidad ──────────────────────────────────────────
        rm.watch(['puntualidad', 'punctuality', 'punctuality_stats'], _lazy('puntualidadRefresh'));

        // ── Reportes HVAC (sincronizados desde AppSheet) ─────────
        rm.watch(['reportes_hvac'], _lazy('hvacReload'));

        // ── SSEI · Atención a Derrames ────────────────────────────
        rm.watch(['atencion_derrames'], _lazy('sseiDerramesReload'));

        // ── SSEI · Emergencias en Pista ───────────────────────────
        rm.watch(['emergencias_pista'], _lazy('sseiEmergenciasReload'));

        // ── Ingeniería Civil · ETP (vidrios y filtraciones) ───────
        rm.watch(['vidrios_etp', 'filtraciones_etp'], _lazy('ingenieriaCivilReload'));
    }

    /* ─── Auto-refresh por intervalo (red de seguridad) ────────────
       Refresca silenciosamente los datos aunque Realtime no esté
       configurado en Supabase. Intervalo conservador para no saturar.
    ─────────────────────────────────────────────────────────────── */
    var AUTO_REFRESH_MS = 3 * 60 * 1000; // cada 3 minutos

    function _startAutoRefresh() {
        setInterval(function () {
            // Solo refrescar si la pestaña del navegador está visible
            if (document.visibilityState === 'hidden') return;

            // Itinerario / inicio
            try { _reloadItinerario(); } catch (_) {}

            // Barra de agenda
            try { if (typeof window.agBarRefresh === 'function') window.agBarRefresh(); } catch (_) {}

            // YoY y Comparativa (resetear cache para que recarguen al entrar a la vista)
            try { window._monthlyDataLoaded = false; window._annualDataLoaded = false; } catch (_) {}
            try { if (typeof window.genYoyReload  === 'function') window.genYoyReload();  } catch (_) {}
            try { if (typeof window.cargoYoyReload === 'function') window.cargoYoyReload(); } catch (_) {}
            try { if (typeof window.comHistReload  === 'function') window.comHistReload();  } catch (_) {}

            // Puntualidad
            try { if (typeof window.puntualidadRefresh === 'function') window.puntualidadRefresh(); } catch (_) {}
        }, AUTO_REFRESH_MS);
    }

    /* ─── Inicialización (espera a que Supabase esté listo) ─────── */
    function _init() {
        var client = window.supabaseClient;
        if (!client) {
            setTimeout(_init, 600);
            return;
        }
        _registerModules();
        _setup(client);
        _startAutoRefresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        setTimeout(_init, 0);
    }
})();
