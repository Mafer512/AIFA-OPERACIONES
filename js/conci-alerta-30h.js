/**
 * conci-alerta-30h.js
 * Conciliación > Manifiestos: alerta puramente informativa de vuelos que
 * llevan más de 30 horas sin un manifiesto REAL capturado en
 * public."Conciliación Manifiestos".
 *
 * NO crea manifiestos, NO calcula pasajeros, NO asume nada sobre el vuelo y
 * NO lo cierra. Sólo avisa. La decisión sigue siendo humana.
 *
 * Fuente de datos: las mismas filas ya enriquecidas ("Solo Vuelos" +
 * manifiestos reales) que script.js arma para la tira de resumen y que ya
 * consume js/conci-cierre-subsecretaria.js — este módulo se engancha al mismo
 * hook (_updateManifiestosSummaryStrip llama a
 * window._conciAlerta30hOnSummaryData si existe) para no duplicar el cruce
 * Itinerario/Manifiestos. "Manifiesto capturado" = row._fuente !== 'Solo
 * Vuelos' (una fila con datos reales persistidos); una fila "Solo Vuelos" es
 * un espejo del itinerario sin manifiesto propio.
 *
 * Regla de las 30 horas (ver window._conciHorasDesdeSlot en script.js, que
 * reutiliza el mismo parseo de fecha/hora y la misma prioridad SLOT
 * COORDINADO > SLOT ASIGNADO que ya usa _conciDemoraMinutos):
 *   1. SLOT COORDINADO si existe.
 *   2. si no, SLOT ASIGNADO.
 *   3. si ninguno es una fecha/hora válida, NO se marca vencido: no se
 *      inventa una hora de referencia.
 *
 * Interruptor general (activado por omisión), persistente en
 * conciliacion_alerta30h_config (migración 054) — no en localStorage, para
 * que la configuración sea la misma para todos los usuarios del módulo.
 * Cambiarlo exige el MISMO privilegio que el Cierre de Subsecretaría
 * (admin/superadmin o permissions.conciliacion_cierra_subsecretaria); no se
 * crea un permiso nuevo, y el RPC vuelve a exigirlo del lado servidor.
 */
(function () {
    'use strict';

    const esc = (v) => (typeof window.escapeHTML === 'function') ? window.escapeHTML(v) : String(v ?? '');
    const UMBRAL_HORAS = 30;

    let _habilitado = true;      // valor por defecto hasta que responda el servidor
    let _estadoCargado = false;
    let _vencidos = [];          // último cálculo: [{ vuelo, ruta, fecha, horas, direccion }]
    let _cargandoEstado = false;

    function _conciEsAdminGlobal() {
        const role = (typeof window._conciCurrentUserRole === 'function') ? window._conciCurrentUserRole() : '';
        return role === 'admin' || role === 'superadmin';
    }

    // Mismo privilegio que el Cierre de Subsecretaría — a propósito, no se
    // crea uno nuevo para este interruptor.
    function puedeAdministrarAlerta() {
        if (_conciEsAdminGlobal()) return true;
        try {
            return window.dataManager?.permissions?.conciliacion_cierra_subsecretaria === true;
        } catch (_) {
            return false;
        }
    }

    function anioFiltro() {
        const raw = document.getElementById('filter-conci-manifiestos-year')?.value;
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
    }

    async function cargarEstado() {
        if (!window.supabaseClient || _cargandoEstado) return _habilitado;
        _cargandoEstado = true;
        try {
            const { data, error } = await window.supabaseClient
                .from('conciliacion_alerta30h_config')
                .select('habilitado')
                .eq('id', true)
                .maybeSingle();
            if (error) throw error;
            if (data && typeof data.habilitado === 'boolean') _habilitado = data.habilitado;
            _estadoCargado = true;
        } catch (err) {
            console.warn('[Alerta 30h] No se pudo leer el interruptor general:', err);
        } finally {
            _cargandoEstado = false;
        }
        return _habilitado;
    }

    async function fijarEstado(habilitado) {
        if (!window.supabaseClient) throw new Error('Sin cliente de Supabase.');
        const { error } = await window.supabaseClient.rpc('conciliacion_alerta30h_set_estado', {
            p_habilitado: !!habilitado,
        });
        if (error) throw error;
        _habilitado = !!habilitado;
        _estadoCargado = true;
    }

    /**
     * Calcula, sobre las filas YA enriquecidas por script.js, cuáles son
     * vuelos "Solo Vuelos" (sin manifiesto real) vencidos por más de 30 h
     * desde su SLOT de referencia. No toca la base de datos.
     */
    function calcularVencidos(rows) {
        const list = Array.isArray(rows) ? rows : [];
        const ahora = new Date();
        const year = anioFiltro();
        const out = [];
        if (typeof window._conciHorasDesdeSlot !== 'function') return out;
        for (const row of list) {
            if (!row || row._fuente !== 'Solo Vuelos') continue;
            const slotAsignado = row['SLOT ASIGNADO'];
            const slotCoordinado = row['SLOT COORDINADO'];
            const horas = window._conciHorasDesdeSlot(slotAsignado, slotCoordinado, year, ahora);
            if (horas === null || !Number.isFinite(horas)) continue; // sin dato confiable: no se marca
            if (horas < UMBRAL_HORAS) continue;
            out.push({
                vuelo: row['# DE VUELO'] || '',
                aerolinea: row['AEROLINEA'] || '',
                ruta: row['DESTINO / ORIGEN'] || row['RUTA'] || '',
                fecha: row['FECHA'] || '',
                horas,
            });
        }
        return out;
    }

    function renderBadge() {
        const btn = document.getElementById('btn-conci-alerta30h-pendientes');
        const badge = document.getElementById('badge-conci-alerta30h-pendientes');
        if (!btn) return;
        const n = _habilitado ? _vencidos.length : 0;
        btn.classList.toggle('d-none', !_estadoCargado || !_habilitado || n === 0);
        if (badge) badge.textContent = String(n);
    }

    function renderToggle() {
        const wrap = document.getElementById('conci-alerta30h-toggle-wrap');
        const input = document.getElementById('conci-alerta30h-toggle');
        if (!wrap || !input) return;
        wrap.classList.toggle('d-none', !puedeAdministrarAlerta());
        input.checked = !!_habilitado;
    }

    function bsModal(id) {
        const el = document.getElementById(id);
        if (!el || !window.bootstrap) return null;
        return window.bootstrap.Modal.getOrCreateInstance(el);
    }

    function modalListaEl() {
        let modal = document.getElementById('modal-conci-alerta30h');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modal-conci-alerta30h';
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header bg-warning">
                    <h5 class="modal-title"><i class="fas fa-triangle-exclamation me-2"></i>Vuelos sin manifiesto capturado (&gt; 30 h)</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                </div>
                <div class="modal-body">
                    <p class="small text-muted">Alerta informativa. No crea, calcula ni cierra ningún manifiesto: sólo indica qué vuelos llevan más de 30 horas desde su slot sin que el área de Manifiestos haya capturado datos reales.</p>
                    <div id="conci-alerta30h-lista"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-light border" data-bs-dismiss="modal">Cerrar</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        return modal;
    }

    function abrirModalLista() {
        const modal = modalListaEl();
        const lista = modal.querySelector('#conci-alerta30h-lista');
        if (!_vencidos.length) {
            lista.innerHTML = '<div class="text-center text-muted py-3">Sin vuelos vencidos por el momento.</div>';
        } else {
            lista.innerHTML = _vencidos.map(v => `<div class="border rounded p-2 mb-2">
                <div><strong>${esc(v.vuelo || '—')}</strong> · ${esc(v.aerolinea || '—')} · ${esc(v.ruta || '—')}</div>
                <div class="small text-muted">FECHA ${esc(v.fecha || '—')} · ${esc(v.horas.toFixed(1))} h desde el slot</div>
            </div>`).join('');
        }
        bsModal('modal-conci-alerta30h')?.show();
    }

    /* ── Hook llamado por script.js con las mismas filas enriquecidas ── */
    window._conciAlerta30hOnSummaryData = function (rows) {
        _vencidos = calcularVencidos(rows);
        if (!_estadoCargado) {
            cargarEstado().then(() => { renderBadge(); renderToggle(); });
            return;
        }
        renderBadge();
    };

    async function onToggleChange(ev) {
        const input = ev.target;
        const anterior = _habilitado;
        input.disabled = true;
        try {
            await fijarEstado(input.checked);
        } catch (err) {
            input.checked = anterior;
            alert(err.message || String(err));
        } finally {
            input.disabled = false;
            renderBadge();
        }
    }

    function init() {
        document.getElementById('btn-conci-alerta30h-pendientes')?.addEventListener('click', abrirModalLista);
        document.getElementById('conci-alerta30h-toggle')?.addEventListener('change', onToggleChange);
        cargarEstado().then(() => { renderBadge(); renderToggle(); });
        window.addEventListener('admin-mode-changed', renderToggle);
    }

    document.addEventListener('DOMContentLoaded', init);
    window.conciAlerta30h = { abrirModalLista };
})();
