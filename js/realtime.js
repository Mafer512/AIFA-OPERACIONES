// ═══════════════════════════════════════════════════════════════════
//  REALTIME POR MÓDULO — js/realtime.js
//  Solo quien está dentro de un módulo escucha los cambios de ese módulo.
//
//  Antes había un canal único sobre todo public.* abierto para cualquiera
//  con la página abierta, aunque fuera en la pantalla de acceso. Cada guardado
//  en Conciliación hacía recargar a todas las sesiones, trabajaran o no ahí, y
//  esas recargas encimadas eran las lecturas lentas de producción.
//
//    Entrar a un módulo   → se abre un canal por cada tabla suya.
//    Mientras se está     → cada cambio llega y recarga solo ese módulo.
//    Salir del módulo     → se cierran sus canales. Sin canales, supabase-js
//                           suelta también el WebSocket.
//    Volver               → los cambios ocurridos fuera no llegaron, así que al
//                           quedar suscrito se recarga una vez.
//
//  Una pestaña oculta conserva su canal un minuto (cambiar de ventana un
//  momento no debe sacar a nadie de la lista de conectados); después cuenta
//  como fuera del módulo.
//
//  El autoguardado no pasa por aquí: guardar, reintentar y enviar al cerrar van
//  por PostgREST y no dependen de que haya un canal abierto.
//
//  Solo hay tiempo real para "Conciliación Manifiestos" y daily_operations. Un
//  módulo sin tablas no abre canal: únicamente tiene el refresco periódico.
//
//  API pública:
//    window.rtManager.registrarModulo({ clave, secciones, panel, tablas,
//        alCambiar(tabla, evento), alEntrar, alSalir, sincronizarSiempre,
//        periodico })
//    window.rtManager.sincronizar()  — reevaluar en qué módulo se está
//    window.rtManager.estado()       — { modulo, tablas }, para diagnóstico
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Evita recargas múltiples si llegan ráfagas.
    var DEBOUNCE_MS = 600;
    var GRACIA_OCULTA_MS = 60 * 1000;
    // Si un canal no contesta, la sincronización de entrada no lo espera más.
    var ESPERA_CONFIRMACION_MS = 4000;
    // Una tabla fuera de la publicación de Realtime rechaza el canal para
    // siempre: se deja de insistir hasta la siguiente entrada al módulo.
    var REINTENTOS_MAX = 5;
    // Con la red caída, cerrar un canal tarda hasta 10 s en rendirse. La fila no
    // lo espera: entrar a otro módulo no puede depender de eso.
    var LIMITE_CIERRE_MS = 1500;
    var AUTO_REFRESH_MS = 3 * 60 * 1000;

    var _modulos = [];
    var _vigente = null;   // módulo abierto ahora y sus canales
    var _client = null;
    var _ocultaVencida = false;
    var _timerOculta = null;
    var _aperturas = 0;

    // Abrir y cerrar canales va siempre en fila, para que entrar y salir rápido
    // no se pise.
    var _cola = Promise.resolve();

    function _encolar(tarea) {
        _cola = _cola.then(tarea).catch(function (error) {
            console.warn('[RT] Error al cambiar de módulo:', error);
        });
        return _cola;
    }

    function _conLimite(promesa) {
        return Promise.race([promesa, new Promise(function (resolver) {
            setTimeout(resolver, LIMITE_CIERRE_MS);
        })]);
    }

    /* ─── API pública ──────────────────────────────────────────── */
    window.rtManager = {
        registrarModulo: function (definicion) {
            _modulos.push(Object.assign({ visitado: false }, definicion));
            if (_client) _reconciliar();
        },
        sincronizar: function () { _reconciliar(); },
        estado: function () {
            return {
                modulo: _vigente ? _vigente.modulo.clave : null,
                tablas: _vigente ? _vigente.modulo.tablas.slice() : []
            };
        }
    };

    /* ─── ¿En qué módulo está esta persona? ────────────────────── */
    function _enLanzador() {
        var body = document.body.classList;
        return body.contains('navdeck-mode') && !body.contains('navdeck-active');
    }

    function _moduloDeseado() {
        if (_ocultaVencida || _enLanzador()) return null;
        var app = document.getElementById('main-app');
        if (!app || app.classList.contains('hidden')) return null;
        var seccion = document.querySelector('.content-section.active');
        if (!seccion) return null;
        var clave = seccion.id.replace(/-section$/, '');
        for (var i = 0; i < _modulos.length; i++) {
            var modulo = _modulos[i];
            if (modulo.secciones.indexOf(clave) === -1) continue;
            if (modulo.panel) {
                var panel = document.getElementById(modulo.panel);
                if (!panel || !panel.classList.contains('active')) continue;
            }
            return modulo;
        }
        return null;
    }

    function _reconciliar() {
        return _encolar(function () {
            var actual = _vigente ? _vigente.modulo : null;
            if (_moduloDeseado() === actual) return;
            return _salir().then(function () {
                var deseado = _moduloDeseado();
                return deseado ? _entrar(deseado) : undefined;
            });
        });
    }

    /* ─── Entrar y salir ───────────────────────────────────────── */
    function _entrar(modulo) {
        var vigente = {
            modulo: modulo,
            canales: {},
            timers: {},
            porConfirmar: modulo.tablas.slice(),
            // La primera visita ya trae datos frescos con su propia carga. Al
            // volver, en cambio, lo ocurrido en ausencia no llegó por el canal.
            sincroniza: modulo.tablas.length > 0 && (modulo.sincronizarSiempre === true || modulo.visitado),
            confirmado: false,
            pendiente: false,
            esperaConfirmacion: null
        };
        modulo.visitado = true;
        _vigente = vigente;
        vigente.esperaConfirmacion = setTimeout(function () { _todoConfirmado(vigente); }, ESPERA_CONFIRMACION_MS);
        modulo.tablas.forEach(function (tabla) {
            vigente.canales[tabla] = { canal: null, intentos: 0, timer: null, caido: false };
            _abrirCanal(vigente, tabla);
        });
        return _conLimite(_llamar(modulo.alEntrar));
    }

    function _salir() {
        var vigente = _vigente;
        if (!vigente) return Promise.resolve();
        // Primero se suelta: el aviso tardío de CLOSED de un canal retirado ya
        // no encuentra a quién reclamarle una reconexión.
        _vigente = null;
        clearTimeout(vigente.esperaConfirmacion);
        Object.keys(vigente.timers).forEach(function (tabla) { clearTimeout(vigente.timers[tabla]); });
        var cierres = Object.keys(vigente.canales).map(function (tabla) {
            return _cerrarCanal(vigente.canales[tabla]);
        });
        cierres.push(_llamar(vigente.modulo.alSalir));
        return _conLimite(Promise.all(cierres));
    }

    function _llamar(gancho) {
        if (typeof gancho !== 'function') return Promise.resolve();
        try {
            return Promise.resolve(gancho()).catch(function (error) {
                console.warn('[RT] Error en el módulo:', error);
            });
        } catch (error) {
            console.warn('[RT] Error en el módulo:', error);
            return Promise.resolve();
        }
    }

    /* ─── Canales ──────────────────────────────────────────────── */
    // Un canal por tabla, no uno por módulo: una tabla que no esté en la
    // publicación hace rechazar el canal entero y se llevaría a las demás.
    //
    // Cada apertura lleva nombre propio. client.channel() devuelve el canal que
    // ya exista con ese nombre, y si cerrarlo falló (red caída) sigue ahí: el
    // canal "nuevo" sería el que estaba muerto.
    function _abrirCanal(vigente, tabla) {
        var entrada = vigente.canales[tabla];
        var indice = vigente.modulo.tablas.indexOf(tabla);
        _aperturas++;
        var canal = _client
            .channel('rt-' + vigente.modulo.clave + '-' + indice + '-' + _aperturas)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: tabla },
                function (payload) {
                    if (_vigente !== vigente) return;
                    _emitir(vigente, tabla, (payload && payload.eventType) ? payload.eventType : 'CHANGE');
                }
            );
        entrada.canal = canal;
        canal.subscribe(function (status) {
            // Un canal ya retirado sigue avisando: no tiene nada que decir.
            if (_vigente !== vigente || entrada.canal !== canal) return;
            if (status === 'SUBSCRIBED') {
                entrada.intentos = 0;
                _confirmar(vigente, tabla);
                // Lo que pasó durante el corte no se va a repetir.
                if (entrada.caido) {
                    entrada.caido = false;
                    if (vigente.confirmado) _emitir(vigente, tabla, 'SYNC');
                }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                entrada.caido = true;
                _confirmar(vigente, tabla);
                _programarReintento(vigente, tabla);
            }
        });
    }

    function _cerrarCanal(entrada) {
        clearTimeout(entrada.timer);
        entrada.timer = null;
        var canal = entrada.canal;
        entrada.canal = null;
        if (!canal) return Promise.resolve();
        return Promise.resolve(_client.removeChannel(canal)).catch(function () { /* ya estaba muerto */ });
    }

    function _programarReintento(vigente, tabla) {
        var entrada = vigente.canales[tabla];
        if (entrada.timer) return;
        if (entrada.intentos >= REINTENTOS_MAX) {
            console.warn('[RT] Sin tiempo real para "' + tabla + '" en este módulo. ¿Está en la publicación?');
            return;
        }
        var espera = Math.min(2000 * Math.pow(2, entrada.intentos), 30000);
        entrada.intentos++;
        entrada.timer = setTimeout(function () {
            entrada.timer = null;
            _reabrirCanal(vigente, tabla);
        }, espera);
    }

    function _reabrirCanal(vigente, tabla) {
        return _encolar(function () {
            if (_vigente !== vigente) return;
            return _conLimite(_cerrarCanal(vigente.canales[tabla])).then(function () {
                if (_vigente === vigente) _abrirCanal(vigente, tabla);
            });
        });
    }

    // Volver a la pestaña o recuperar la red: se reintenta ya, sin esperar.
    function _reabrirCaidos() {
        var vigente = _vigente;
        if (!vigente) return;
        Object.keys(vigente.canales).forEach(function (tabla) {
            var entrada = vigente.canales[tabla];
            if (!entrada.caido) return;
            clearTimeout(entrada.timer);
            entrada.timer = null;
            entrada.intentos = 0;
            _reabrirCanal(vigente, tabla);
        });
    }

    /* ─── Sincronización ───────────────────────────────────────── */
    function _confirmar(vigente, tabla) {
        var posicion = vigente.porConfirmar.indexOf(tabla);
        if (posicion !== -1) vigente.porConfirmar.splice(posicion, 1);
        if (!vigente.porConfirmar.length) _todoConfirmado(vigente);
    }

    function _todoConfirmado(vigente) {
        if (_vigente !== vigente || vigente.confirmado) return;
        vigente.confirmado = true;
        clearTimeout(vigente.esperaConfirmacion);
        if (vigente.sincroniza) _emitir(vigente, vigente.modulo.tablas[0], 'SYNC');
    }

    function _emitir(vigente, tabla, evento) {
        // En una pestaña oculta nadie está mirando: se anota y se recarga una
        // sola vez al volver, aunque hayan llegado cientos de avisos.
        if (document.hidden) {
            vigente.pendiente = true;
            return;
        }
        clearTimeout(vigente.timers[tabla]);
        vigente.timers[tabla] = setTimeout(function () {
            if (_vigente !== vigente) return;
            try {
                vigente.modulo.alCambiar(tabla, evento);
            } catch (e) {
                console.error('[RT] Error en callback de', tabla, ':', e);
            }
        }, DEBOUNCE_MS);
    }

    function _alCambiarVisibilidad() {
        clearTimeout(_timerOculta);
        _timerOculta = null;
        if (document.hidden) {
            _timerOculta = setTimeout(function () {
                _ocultaVencida = true;
                _reconciliar();
            }, GRACIA_OCULTA_MS);
            return;
        }
        _ocultaVencida = false;
        _reconciliar();
        _encolar(function () {
            _reabrirCaidos();
            var vigente = _vigente;
            if (vigente && vigente.pendiente) {
                vigente.pendiente = false;
                _emitir(vigente, vigente.modulo.tablas[0], 'SYNC');
            }
        });
    }

    /* ─── Módulos conocidos ────────────────────────────────────── */
    // Se usan envoltorios "lazy" para que si el módulo aún no cargó
    // la función se resuelva en el momento del evento, no al registrar.
    function _lazy(fnName) {
        return function () {
            var fn = window[fnName];
            return typeof fn === 'function' ? fn() : undefined;
        };
    }

    // Recarga el itinerario/gráficas de inicio manteniendo filtros actuales
    function _reloadItinerario() {
        var fn = window.loadItineraryData;
        if (typeof fn === 'function') fn({ preserveFilters: true });
    }

    function _recargarOperaciones(tabla, evento) {
        // Forzar recarga en analisis-mensual y analisis-anual
        window._monthlyDataLoaded = false;
        window._annualDataLoaded  = false;
        if (evento === 'SYNC' || evento === 'INTERVALO') {
            _lazy('genYoyReload')();
            _lazy('cargoYoyReload')();
            _lazy('comHistReload')();
        }
        if (tabla) _lazy('refreshOperationsCardsData')();
    }

    function _registerModules() {
        var rm = window.rtManager;

        // ── Itinerario / gráficas de inicio ─────────────────────
        rm.registrarModulo({
            clave: 'inicio', secciones: ['inicio'], tablas: [],
            alCambiar: _reloadItinerario, periodico: true
        });

        // ── YoY Aviación General, Carga e Histórica ──────────────
        rm.registrarModulo({
            clave: 'operaciones-totales', secciones: ['operaciones-totales'], tablas: ['daily_operations'],
            alCambiar: _recargarOperaciones, periodico: true
        });

        // ── Parte de operaciones (Gestión de Datos) ──────────────
        rm.registrarModulo({
            clave: 'parte-ops', secciones: ['data-management'], panel: 'pane-parte-ops',
            tablas: ['daily_operations'], alCambiar: _lazy('parteOpsReload')
        });

        // ── Conciliación Manifiestos: el módulo es la pestaña Manifiestos, no
        //    toda Conciliación. Al entrar se abre además el canal de presencia y
        //    cursores (script.js). La sincronización va siempre: cubre lo que se
        //    guardó entre la lectura inicial y el momento de quedar suscrito.
        rm.registrarModulo({
            clave: 'conci-manifiestos', secciones: ['conciliacion'], panel: 'pane-conci-comercial',
            tablas: ['Conciliación Manifiestos'],
            alCambiar: _lazy('_conciHandleRemoteTableChange'),
            alEntrar: _lazy('_conciEntrarModuloManifiestos'),
            alSalir: _lazy('_conciSalirModuloManifiestos'),
            sincronizarSiempre: true
        });

        // ── Reportes de Conciliación: solo tiran su caché. Sin consulta alguna,
        //    así que siempre es seguro avisar al entrar: mientras se estuvo
        //    fuera no llegó ningún aviso que la invalidara.
        rm.registrarModulo({
            clave: 'conci-reportes', secciones: ['conci-reportes'],
            tablas: ['Conciliación Manifiestos'],
            alCambiar: _lazy('_conciNotificarManifiestosCambiaron'),
            sincronizarSiempre: true
        });

        // ── Puntualidad ──────────────────────────────────────────
        rm.registrarModulo({
            clave: 'puntualidad', secciones: ['puntualidad-agosto'], tablas: [],
            alCambiar: _lazy('puntualidadRefresh'), periodico: true
        });
    }

    /* ─── Auto-refresh por intervalo (red de seguridad) ────────────
       Refresca silenciosamente el módulo abierto aunque Realtime no
       esté configurado en Supabase. Intervalo conservador para no
       saturar.
    ─────────────────────────────────────────────────────────────── */
    function _startAutoRefresh() {
        setInterval(function () {
            // Solo refrescar si la pestaña del navegador está visible
            if (document.visibilityState === 'hidden') return;

            // YoY y Comparativa (resetear cache para que recarguen al entrar a la vista)
            try { window._monthlyDataLoaded = false; window._annualDataLoaded = false; } catch (_) {}

            var app = document.getElementById('main-app');
            if (!app || app.classList.contains('hidden')) return;

            // Barra de agenda: se ve en toda la aplicación, no es de un módulo
            try { if (typeof window.agBarRefresh === 'function') window.agBarRefresh(); } catch (_) {}

            var vigente = _vigente;
            if (!vigente || !vigente.modulo.periodico) return;
            try { vigente.modulo.alCambiar(null, 'INTERVALO'); } catch (_) {}
        }, AUTO_REFRESH_MS);
    }

    /* ─── Cambios de pantalla ──────────────────────────────────── */
    function _vigilarNavegacion() {
        var observador = new MutationObserver(_reconciliar);
        var opciones = { attributes: true, attributeFilter: ['class'] };
        document.querySelectorAll('.content-section').forEach(function (seccion) {
            observador.observe(seccion, opciones);
        });
        var app = document.getElementById('main-app');
        if (app) observador.observe(app, opciones);
        observador.observe(document.body, opciones);
        document.addEventListener('shown.bs.tab', _reconciliar);
        document.addEventListener('visibilitychange', _alCambiarVisibilidad);
        window.addEventListener('online', function () { _encolar(_reabrirCaidos); });
    }

    /* ─── Inicialización (espera a que Supabase esté listo) ─────── */
    function _init() {
        var client = window.supabaseClient;
        if (!client) {
            setTimeout(_init, 600);
            return;
        }
        _client = client;
        _registerModules();
        _vigilarNavegacion();
        _startAutoRefresh();
        _reconciliar();
        // Una pestaña abierta en segundo plano nunca avisa que está oculta.
        if (document.hidden) _alCambiarVisibilidad();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        setTimeout(_init, 0);
    }
})();
