/**
 * conci-manifiestos-historial.js
 * Historial de auditoría de Conciliación > Manifiestos.
 * Lee public.conciliacion_manifiestos_historial (llenada por trigger de BD,
 * ver db/create_conciliacion_manifiestos_historial.sql). Solo lectura: este
 * módulo nunca escribe en la tabla de historial.
 */
(function () {
    'use strict';

    const TABLE = 'conciliacion_manifiestos_historial';
    const esc = (v) => (typeof window.escapeHTML === 'function') ? window.escapeHTML(v) : String(v ?? '');

    let _rows = [];
    let _scopeRowId = null;   // si se abrió "ver historial" desde una fila puntual
    let _userFilter = '';
    let _search = '';
    let _dateFrom = '';
    let _dateTo = '';
    let _flightLabels = new Map(); // manifiesto_id -> "VB 7435 · 25/07/2026"

    /* ── DOM helpers ── */
    function modalEl() {
        let modal = document.getElementById('modal-conci-historial');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modal-conci-historial';
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        document.body.appendChild(modal);
        return modal;
    }

    function canSeeHistorial() {
        return typeof window._conciCanCurrentUserEdit === 'function'
            ? window._conciCanCurrentUserEdit()
            : true;
    }

    /* ── Formato ── */
    function relativeTime(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const diffMs = Date.now() - d.getTime();
        const min = Math.round(diffMs / 60000);
        if (min < 1) return 'justo ahora';
        if (min < 60) return `hace ${min} min`;
        const hrs = Math.round(min / 60);
        if (hrs < 24) return `hace ${hrs} h`;
        const days = Math.round(hrs / 24);
        if (days < 7) return `hace ${days} d`;
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function absoluteTime(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    // Color estable por usuario (mismo criterio visual que el resto de la app: hash simple -> hsl).
    function userColor(seed) {
        let h = 0;
        const s = String(seed || '');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return `hsl(${h % 360} 62% 42%)`;
    }

    function opMeta(operacion) {
        if (operacion === 'INSERT') return { icon: 'fa-circle-plus', label: 'Capturó el registro', tone: 'success' };
        if (operacion === 'DELETE') return { icon: 'fa-trash-alt', label: 'Eliminó el registro', tone: 'danger' };
        return { icon: 'fa-pen', label: 'Modificó campos', tone: 'primary' };
    }

    // Clasifica cada cambio de campo para que se distinga a simple vista:
    //   nuevo       → estaba vacío y ahora tiene valor (se capturó por primera vez)
    //   vaciado     → tenía valor y quedó vacío (se borró el dato de ese campo)
    //   modificado  → tenía un valor y cambió por otro
    const FIELD_KIND = {
        nuevo:      { label: 'Nuevo',       icon: 'fa-circle-plus',  tone: 'nuevo' },
        vaciado:    { label: 'Borrado',     icon: 'fa-circle-minus', tone: 'vaciado' },
        modificado: { label: 'Modificado',  icon: 'fa-pen',          tone: 'modificado' },
    };
    function classifyField(antes, despues) {
        const a = (antes ?? '').toString().trim();
        const d = (despues ?? '').toString().trim();
        if (!a && d) return 'nuevo';
        if (a && !d) return 'vaciado';
        return 'modificado';
    }

    function tryParseJson(text) {
        if (!text) return null;
        try { const v = JSON.parse(text); return (v && typeof v === 'object') ? v : null; } catch (_) { return null; }
    }

    // Etiqueta legible de a qué vuelo/registro pertenece un evento, ej.
    // "VB 7435 · 25/07/2026". Para INSERT/DELETE se lee directo del snapshot
    // capturado en ese momento (preciso incluso si el registro ya no existe);
    // para UPDATE se usa el catálogo cargado una vez al abrir el historial.
    function flightLabelFromSnapshot(snapshot) {
        if (!snapshot) return null;
        const vuelo = snapshot['# DE VUELO'] || snapshot['#DE VUELO'];
        const fecha = snapshot['FECHA'];
        const bits = [vuelo, fecha].filter(Boolean);
        return bits.length ? bits.join(' · ') : null;
    }
    function flightLabel(ev) {
        if (ev.operacion !== 'UPDATE') {
            const fromSnap = flightLabelFromSnapshot(ev.snapshot);
            if (fromSnap) return fromSnap;
        }
        if (ev.manifiesto_id && _flightLabels.has(String(ev.manifiesto_id))) {
            return _flightLabels.get(String(ev.manifiesto_id));
        }
        return ev.manifiesto_id ? `Registro #${ev.manifiesto_id}` : 'Registro nuevo';
    }

    // Trae, en una sola consulta, el vuelo/fecha actual de cada registro que
    // aparece en el historial cargado — evita mostrar solo un id interno.
    async function buildFlightLabels(rows) {
        const ids = [...new Set(rows.map(r => r.manifiesto_id).filter(v => v !== null && v !== undefined))];
        if (!ids.length) return new Map();
        try {
            const sb = window.supabaseClient;
            if (!sb) return new Map();
            const { data, error } = await sb.from('Conciliación Manifiestos')
                .select('id, "# DE VUELO", "FECHA"')
                .in('id', ids);
            if (error) throw error;
            const map = new Map();
            (data || []).forEach(r => {
                const bits = [r['# DE VUELO'], r['FECHA']].filter(Boolean);
                if (bits.length) map.set(String(r.id), bits.join(' · '));
            });
            return map;
        } catch (_) {
            return new Map();
        }
    }

    // Tabla EXHAUSTIVA (incluye columnas vacías/sin capturar) — la opción
    // "ver registro completo" para quien quiera revisar todo el registro,
    // separada de la vista rápida con los campos que sí tienen valor.
    function snapshotTableFull(json) {
        const entries = Object.entries(json || {}).filter(([k]) => k !== 'id');
        if (!entries.length) return '<span class="text-muted small">Sin datos.</span>';
        return `<div class="conci-hist-snapshot"><table class="table table-sm mb-0">${
            entries.map(([k, v]) => `<tr><th class="text-nowrap">${esc(k)}</th><td>${(v === null || v === '' || v === undefined) ? '<span class="conci-hist-empty">(vacío)</span>' : esc(String(v))}</td></tr>`).join('')
        }</table></div>`;
    }

    /* ── Carga ── */
    async function loadRows() {
        const sb = window.supabaseClient || (window.ensureSupabaseClient && await window.ensureSupabaseClient());
        if (!sb) throw new Error('Supabase no inicializado.');
        let q = sb.from(TABLE).select('*').order('creado_en', { ascending: false }).limit(1000);
        if (_scopeRowId) q = q.eq('manifiesto_id', _scopeRowId);
        if (_dateFrom) q = q.gte('creado_en', `${_dateFrom}T00:00:00`);
        if (_dateTo) q = q.lte('creado_en', `${_dateTo}T23:59:59`);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
    }

    // Agrupa filas de historial que pertenecen al MISMO evento de guardado:
    // mismo manifiesto_id + usuario + timestamp exacto (el trigger inserta
    // todas las columnas cambiadas de un mismo UPDATE con el mismo now()).
    function groupEvents(rows) {
        const map = new Map();
        rows.forEach((r) => {
            const key = `${r.manifiesto_id ?? 'null'}|${r.usuario_id ?? r.usuario_nombre}|${r.creado_en}|${r.operacion}`;
            if (!map.has(key)) {
                map.set(key, {
                    manifiesto_id: r.manifiesto_id,
                    operacion: r.operacion,
                    usuario_id: r.usuario_id,
                    usuario_nombre: r.usuario_nombre,
                    usuario_email: r.usuario_email,
                    creado_en: r.creado_en,
                    campos: [],
                    snapshot: null,
                });
            }
            const ev = map.get(key);
            if (r.operacion === 'UPDATE') {
                ev.campos.push({
                    columna: r.columna,
                    antes: r.valor_anterior,
                    despues: r.valor_nuevo,
                    kind: classifyField(r.valor_anterior, r.valor_nuevo),
                });
            } else if (r.operacion === 'INSERT') {
                ev.snapshot = tryParseJson(r.valor_nuevo);
            } else if (r.operacion === 'DELETE') {
                ev.snapshot = tryParseJson(r.valor_anterior);
            }
        });
        return Array.from(map.values());
    }

    function matchesFilters(ev) {
        if (_userFilter && String(ev.usuario_id || ev.usuario_nombre) !== _userFilter) return false;
        if (_search) {
            const needle = _search.toLowerCase();
            const haystack = [
                ev.usuario_nombre, ev.usuario_email, String(ev.manifiesto_id || ''),
                ...ev.campos.flatMap(c => [c.columna, c.antes, c.despues]),
            ].join(' ').toLowerCase();
            if (!haystack.includes(needle)) return false;
        }
        return true;
    }

    /* ── Render ── */
    // Agrupa los campos de un evento por tipo de cambio (nuevo/modificado/
    // vaciado) en vez de una lista plana — es lo que hace que se distinga a
    // simple vista qué se capturó por primera vez, qué se corrigió y qué se
    // borró, en lugar de tener que leer campo por campo.
    function groupFieldsByKind(campos) {
        const buckets = { nuevo: [], modificado: [], vaciado: [] };
        campos.forEach(c => buckets[c.kind].push(c));
        return buckets;
    }

    function renderFieldChip(c) {
        if (c.kind === 'nuevo') {
            return `<div class="conci-hist-chip conci-hist-chip-nuevo">
                <span class="conci-hist-chip-field">${esc(c.columna)}</span>
                <span class="conci-hist-chip-val conci-hist-after">${esc(c.despues)}</span>
            </div>`;
        }
        if (c.kind === 'vaciado') {
            return `<div class="conci-hist-chip conci-hist-chip-vaciado">
                <span class="conci-hist-chip-field">${esc(c.columna)}</span>
                <span class="conci-hist-chip-val conci-hist-before">${esc(c.antes)}</span>
            </div>`;
        }
        return `<div class="conci-hist-chip conci-hist-chip-modificado">
            <span class="conci-hist-chip-field">${esc(c.columna)}</span>
            <span class="conci-hist-chip-val">
                <span class="conci-hist-before">${esc(c.antes)}</span>
                <i class="fas fa-arrow-right conci-hist-arrow"></i>
                <span class="conci-hist-after">${esc(c.despues)}</span>
            </span>
        </div>`;
    }

    function renderFieldGroup(kind, campos) {
        if (!campos.length) return '';
        const k = FIELD_KIND[kind];
        return `<div class="conci-hist-group conci-hist-group-${kind}">
            <div class="conci-hist-group-title"><i class="fas ${k.icon} me-1"></i>${k.label} <span class="conci-hist-group-count">${campos.length}</span></div>
            <div class="conci-hist-chips">${campos.map(renderFieldChip).join('')}</div>
        </div>`;
    }

    // Campos con valor de un snapshot (INSERT/DELETE), listos para mostrar
    // como chips directamente en la tarjeta — visibles de entrada, sin tener
    // que abrir nada, igual que los campos "Modificado" de un UPDATE.
    function snapshotFilledFields(json) {
        return Object.entries(json || {})
            .filter(([k, v]) => k !== 'id' && v !== null && v !== '' && v !== undefined)
            .map(([columna, valor]) => ({ columna, valor }));
    }

    function renderSnapshotChip(kind, f) {
        const cls = kind === 'nuevo' ? 'conci-hist-chip-nuevo' : 'conci-hist-chip-vaciado';
        const valCls = kind === 'nuevo' ? 'conci-hist-after' : 'conci-hist-before';
        return `<div class="conci-hist-chip ${cls}">
            <span class="conci-hist-chip-field">${esc(f.columna)}</span>
            <span class="conci-hist-chip-val ${valCls}">${esc(f.valor)}</span>
        </div>`;
    }

    function renderSnapshotBody(ev) {
        const isInsert = ev.operacion === 'INSERT';
        const fields = snapshotFilledFields(ev.snapshot);
        const kind = isInsert ? 'nuevo' : 'vaciado';
        const k = FIELD_KIND[kind];
        const chips = fields.length
            ? `<div class="conci-hist-group conci-hist-group-${kind}">
                <div class="conci-hist-group-title"><i class="fas ${k.icon} me-1"></i>${isInsert ? 'Capturado' : 'Eliminado'} <span class="conci-hist-group-count">${fields.length}</span></div>
                <div class="conci-hist-chips">${fields.map(f => renderSnapshotChip(kind, f)).join('')}</div>
            </div>`
            : `<div class="text-muted small mt-1">Sin datos ${isInsert ? 'capturados' : 'guardados'} en este evento.</div>`;

        const fullId = `hist-full-${Math.random().toString(36).slice(2)}`;
        return `${chips}
            <a href="#" class="conci-hist-toggle-snap small" data-target="${fullId}">
                <i class="fas fa-chevron-right me-1"></i>Ver registro completo
            </a>
            <div id="${fullId}" class="d-none mt-2">${snapshotTableFull(ev.snapshot)}</div>`;
    }

    function updateSummaryLabel(buckets) {
        const parts = [];
        if (buckets.nuevo.length) parts.push(`${buckets.nuevo.length} nuevo${buckets.nuevo.length > 1 ? 's' : ''}`);
        if (buckets.modificado.length) parts.push(`${buckets.modificado.length} modificado${buckets.modificado.length > 1 ? 's' : ''}`);
        if (buckets.vaciado.length) parts.push(`${buckets.vaciado.length} borrado${buckets.vaciado.length > 1 ? 's' : ''}`);
        return parts.join(' · ');
    }

    function renderEventCard(ev) {
        const meta = opMeta(ev.operacion);
        const color = userColor(ev.usuario_id || ev.usuario_nombre);
        const flightBadge = `<button type="button" class="btn btn-sm conci-hist-flight-badge" data-manifiesto-id="${esc(ev.manifiesto_id)}" title="Ver solo el historial de este registro"><i class="fas fa-plane me-1"></i>${esc(flightLabel(ev))}</button>`;

        let opLabel = meta.label;
        let body;
        if (ev.operacion === 'UPDATE') {
            const buckets = groupFieldsByKind(ev.campos);
            const summary = updateSummaryLabel(buckets);
            opLabel = summary ? `Actualizó ${ev.campos.length} campo${ev.campos.length > 1 ? 's' : ''} <span class="conci-hist-op-summary">(${summary})</span>` : meta.label;
            body = [
                renderFieldGroup('nuevo', buckets.nuevo),
                renderFieldGroup('modificado', buckets.modificado),
                renderFieldGroup('vaciado', buckets.vaciado),
            ].join('');
        } else {
            const filledCount = snapshotFilledFields(ev.snapshot).length;
            if (filledCount) {
                opLabel = `${meta.label} <span class="conci-hist-op-summary">(${filledCount} campo${filledCount > 1 ? 's' : ''})</span>`;
            }
            body = renderSnapshotBody(ev);
        }

        return `
        <div class="conci-hist-event conci-hist-tone-${meta.tone}">
            <div class="conci-hist-rail"><div class="conci-hist-dot"><i class="fas ${meta.icon}"></i></div></div>
            <div class="conci-hist-card">
                <div class="conci-hist-headline">
                    <div class="conci-hist-avatar" style="background:${color}" title="${esc(ev.usuario_nombre)}">${esc(initials(ev.usuario_nombre))}</div>
                    <div class="conci-hist-who">
                        <span class="conci-hist-user">${esc(ev.usuario_nombre)}</span>
                        <span class="conci-hist-op">${opLabel}</span>
                    </div>
                    <span class="conci-hist-time ms-auto" title="${esc(absoluteTime(ev.creado_en))}">${esc(relativeTime(ev.creado_en))}</span>
                </div>
                <div class="conci-hist-flight-row">${flightBadge}</div>
                ${body}
            </div>
        </div>`;
    }

    function renderUserFilterOptions(events) {
        const seen = new Map();
        events.forEach(ev => {
            const key = String(ev.usuario_id || ev.usuario_nombre);
            if (!seen.has(key)) seen.set(key, ev.usuario_nombre);
        });
        const sel = document.getElementById('conci-hist-user-filter');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Todos los usuarios</option>' +
            Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
        sel.value = current || '';
    }

    function render() {
        const modal = modalEl();
        const events = groupEvents(_rows).filter(matchesFilters);
        const listEl = modal.querySelector('#conci-hist-list');
        const scopeBanner = modal.querySelector('#conci-hist-scope-banner');

        if (scopeBanner) {
            scopeBanner.classList.toggle('d-none', !_scopeRowId);
            if (_scopeRowId) {
                const label = _flightLabels.get(String(_scopeRowId)) || `registro #${_scopeRowId}`;
                scopeBanner.querySelector('span').textContent = `Mostrando solo el historial de ${label}.`;
            }
        }

        const totalCambios = _rows.length;
        const usuariosUnicos = new Set(_rows.map(r => r.usuario_id || r.usuario_nombre)).size;
        const ultimo = _rows[0] ? relativeTime(_rows[0].creado_en) : '—';
        const setStat = (id, val) => { const el = modal.querySelector('#' + id); if (el) el.textContent = val; };
        setStat('conci-hist-stat-total', totalCambios);
        setStat('conci-hist-stat-usuarios', usuariosUnicos);
        setStat('conci-hist-stat-ultimo', ultimo);

        renderUserFilterOptions(groupEvents(_rows));

        if (!listEl) return;
        if (!events.length) {
            listEl.innerHTML = `<div class="text-center text-muted py-5"><i class="fas fa-inbox fa-2x mb-2 d-block"></i>Sin cambios registrados${_search || _userFilter || _dateFrom || _dateTo ? ' para este filtro.' : ' todavía.'}</div>`;
            return;
        }
        listEl.innerHTML = renderTimeline(events);
    }

    // Inserta separadores "Hoy" / "Ayer" / fecha entre eventos de días
    // distintos — hace mucho más fácil escanear un historial largo en vez de
    // una lista continua de tarjetas.
    function dayLabel(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const now = new Date();
        const startOf = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
        const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
        if (diffDays === 0) return 'Hoy';
        if (diffDays === 1) return 'Ayer';
        return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function renderTimeline(events) {
        let lastDay = null;
        const parts = [];
        events.forEach(ev => {
            const label = dayLabel(ev.creado_en);
            if (label !== lastDay) {
                parts.push(`<div class="conci-hist-day-sep"><span>${esc(label)}</span></div>`);
                lastDay = label;
            }
            parts.push(renderEventCard(ev));
        });
        return `<div class="conci-hist-timeline">${parts.join('')}</div>`;
    }

    /* ── Modal shell ── */
    function ensureModalShell() {
        const modal = modalEl();
        modal.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"><div class="modal-content conci-catalog-modal-content">
            <div class="modal-header conci-catalog-modal-header text-white">
                <div><div class="conci-catalog-eyebrow">AUDITORÍA DE CONCILIACIÓN</div><h5 class="modal-title mb-0"><i class="fas fa-history me-2"></i>Historial de cambios — Manifiestos</h5></div>
                <button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div class="modal-body conci-catalog-modal-body">
                <div class="conci-catalog-notice"><i class="fas fa-shield-alt"></i><span>Registro automático e inmutable: cada alta, edición y eliminación queda guardada con usuario y fecha exacta. No puede modificarse desde la aplicación.</span></div>
                <div id="conci-hist-scope-banner" class="conci-hist-scope-banner d-none">
                    <span></span>
                    <button type="button" class="btn btn-sm btn-link p-0" id="conci-hist-clear-scope"><i class="fas fa-times me-1"></i>Ver historial completo</button>
                </div>
                <div class="row g-2 conci-catalog-stats mb-3">
                    <div class="col-4"><div class="conci-catalog-stat"><i class="fas fa-clock-rotate-left"></i><div><strong id="conci-hist-stat-total">—</strong><span>Cambios</span></div></div></div>
                    <div class="col-4"><div class="conci-catalog-stat"><i class="fas fa-users"></i><div><strong id="conci-hist-stat-usuarios">—</strong><span>Usuarios</span></div></div></div>
                    <div class="col-4"><div class="conci-catalog-stat"><i class="fas fa-bolt"></i><div><strong id="conci-hist-stat-ultimo">—</strong><span>Último cambio</span></div></div></div>
                </div>
                <div class="conci-hist-filters">
                    <input type="date" id="conci-hist-date-from" class="form-control form-control-sm" title="Desde">
                    <input type="date" id="conci-hist-date-to" class="form-control form-control-sm" title="Hasta">
                    <select id="conci-hist-user-filter" class="form-select form-select-sm"><option value="">Todos los usuarios</option></select>
                    <div class="input-group input-group-sm conci-catalog-search flex-grow-1">
                        <span class="input-group-text"><i class="fas fa-search"></i></span>
                        <input id="conci-hist-search" class="form-control" placeholder="Buscar por campo, valor o registro...">
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="conci-hist-refresh" title="Actualizar"><i class="fas fa-sync-alt"></i></button>
                </div>
                <div id="conci-hist-loading" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Cargando historial...</div>
                <div id="conci-hist-error" class="alert alert-danger d-none small"></div>
                <div id="conci-hist-list" class="conci-hist-list"></div>
            </div>
            <div class="modal-footer conci-catalog-modal-footer">
                <span><i class="fas fa-table me-1"></i>conciliacion_manifiestos_historial</span>
                <button type="button" class="btn btn-light border" data-bs-dismiss="modal">Cerrar</button>
            </div>
        </div></div>`;

        modal.querySelector('#conci-hist-clear-scope').addEventListener('click', () => { _scopeRowId = null; refresh(); });
        modal.querySelector('#conci-hist-refresh').addEventListener('click', () => refresh());
        modal.querySelector('#conci-hist-search').addEventListener('input', (e) => { _search = e.target.value.trim(); render(); });
        modal.querySelector('#conci-hist-user-filter').addEventListener('change', (e) => { _userFilter = e.target.value; render(); });
        modal.querySelector('#conci-hist-date-from').addEventListener('change', (e) => { _dateFrom = e.target.value; refresh(); });
        modal.querySelector('#conci-hist-date-to').addEventListener('change', (e) => { _dateTo = e.target.value; refresh(); });
        modal.querySelector('#conci-hist-list').addEventListener('click', (e) => {
            const toggle = e.target.closest('.conci-hist-toggle-snap');
            if (toggle) {
                e.preventDefault();
                const targetId = toggle.dataset.target;
                const target = modal.querySelector('#' + targetId);
                const icon = toggle.querySelector('i');
                if (target) {
                    target.classList.toggle('d-none');
                    if (icon) {
                        icon.classList.toggle('fa-chevron-right');
                        icon.classList.toggle('fa-chevron-down');
                    }
                }
                return;
            }
            const scopeBtn = e.target.closest('.conci-hist-flight-badge');
            if (scopeBtn && scopeBtn.dataset.manifiestoId) {
                _scopeRowId = scopeBtn.dataset.manifiestoId;
                refresh();
            }
        });
        return modal;
    }

    async function refresh() {
        const modal = modalEl();
        const loadEl = modal.querySelector('#conci-hist-loading');
        const errEl = modal.querySelector('#conci-hist-error');
        const listEl = modal.querySelector('#conci-hist-list');
        if (loadEl) loadEl.classList.remove('d-none');
        if (errEl) errEl.classList.add('d-none');
        if (listEl) listEl.innerHTML = '';
        try {
            _rows = await loadRows();
            _flightLabels = await buildFlightLabels(_rows);
            render();
        } catch (err) {
            if (errEl) {
                errEl.textContent = 'No se pudo cargar el historial: ' + (err.message || String(err));
                errEl.classList.remove('d-none');
            }
        } finally {
            if (loadEl) loadEl.classList.add('d-none');
        }
    }

    /* ── API pública ── */
    async function open({ manifiestoId = null } = {}) {
        if (!canSeeHistorial()) {
            alert('Solo usuarios autorizados de Manifiestos pueden ver el historial.');
            return;
        }
        _scopeRowId = manifiestoId ? String(manifiestoId) : null;
        _userFilter = ''; _search = ''; _dateFrom = ''; _dateTo = '';
        const modal = ensureModalShell();
        if (window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(modal).show();
        await refresh();
    }

    /* ── Init: botón de la barra de herramientas + icono por fila ── */
    function updateToolbarButtonVisibility() {
        const btn = document.getElementById('btn-conci-historial');
        if (btn) btn.classList.toggle('d-none', !canSeeHistorial());
    }

    function init() {
        const btn = document.getElementById('btn-conci-historial');
        if (btn) btn.addEventListener('click', () => open());

        // Delegación: icono "Ver historial" por fila, agregado dinámicamente
        // en la columna de acciones de la tabla (ver script.js: conci-row-action-col).
        const table = document.getElementById('table-conci-manifiestos');
        if (table) {
            table.addEventListener('click', (e) => {
                const rowBtn = e.target.closest('.conci-history-row');
                if (!rowBtn) return;
                open({ manifiestoId: rowBtn.dataset.rowId });
            });
        }

        window.addEventListener('admin-mode-changed', updateToolbarButtonVisibility);
        setTimeout(updateToolbarButtonVisibility, 500);
    }

    document.addEventListener('DOMContentLoaded', init);
    window.conciManifiestosHistorial = { open };
})();
