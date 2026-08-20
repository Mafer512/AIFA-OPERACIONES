// ============================================================
// vehiculos.js — Catálogo de Vehículos Terrestres
// Coordinación de Auditoría · Dirección de Operación · AIFA
// ============================================================
(function () {
    'use strict';

    // ── Estado interno ────────────────────────────────────────
    const state = {
        all: [],          // todos los registros de la BD
        filtered: [],     // subset con filtros aplicados
        view: 'grid',     // 'grid' | 'list'
        loaded: false,
        loading: false,
        isAdmin: false,
        editingId: null,  // UUID del registro en edición
        uploadFile: null  // File object pendiente de subir
    };

    // ── Paleta de colores por tipo de vehículo ────────────────
    const TYPE_COLOR = {
        'Camioneta':      { bg: '#1a3a6e', text: '#ffffff', icon: 'fa-truck-pickup' },
        'Camioneta Van':  { bg: '#0d6efd', text: '#ffffff', icon: 'fa-van-shuttle' },
        'Automóvil':      { bg: '#198754', text: '#ffffff', icon: 'fa-car' },
        'Motocicleta':    { bg: '#fd7e14', text: '#ffffff', icon: 'fa-motorcycle' },
        'Camión':         { bg: '#6f42c1', text: '#ffffff', icon: 'fa-truck' },
        'Autobús':        { bg: '#0a6640', text: '#ffffff', icon: 'fa-bus' },
        'Ambulancia':     { bg: '#dc3545', text: '#ffffff', icon: 'fa-ambulance' },
        'Montacargas':    { bg: '#e67e22', text: '#ffffff', icon: 'fa-forklift' },
        'default':        { bg: '#495057', text: '#ffffff', icon: 'fa-car' }
    };

    const FUEL_BADGE = {
        'Diesel':     { cls: 'bg-dark text-white',     icon: 'fa-oil-can' },
        'Gasolina':   { cls: 'bg-warning text-dark',   icon: 'fa-gas-pump' },
        'Eléctrico':  { cls: 'bg-success text-white',  icon: 'fa-bolt' },
        'Híbrido':    { cls: 'bg-info text-dark',      icon: 'fa-leaf' },
        'default':    { cls: 'bg-secondary text-white', icon: 'fa-gas-pump' }
    };

    // ── Helpers ───────────────────────────────────────────────
    function normalize(str) {
        return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function daysUntil(dateStr) {
        if (!dateStr) return null;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const exp = new Date(dateStr + 'T00:00:00');
        return Math.ceil((exp - now) / 86400000);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function insuranceBadge(vigencia) {
        const days = daysUntil(vigencia);
        if (days === null)  return '<span class="badge bg-secondary"><i class="fas fa-question me-1"></i>Sin datos</span>';
        if (days < 0)       return '<span class="badge bg-danger"><i class="fas fa-times-circle me-1"></i>Vencida</span>';
        if (days <= 30)     return `<span class="badge bg-danger"><i class="fas fa-exclamation-triangle me-1"></i>Vence en ${days}d</span>`;
        if (days <= 90)     return `<span class="badge bg-warning text-dark"><i class="fas fa-clock me-1"></i>Vence en ${days}d</span>`;
        return `<span class="badge bg-success"><i class="fas fa-shield-alt me-1"></i>Vigente · ${formatDate(vigencia)}</span>`;
    }

    function statusBadge(estado) {
        const map = {
            'Activo':        'bg-success',
            'Mantenimiento': 'bg-warning text-dark',
            'Baja':          'bg-danger'
        };
        return `<span class="badge ${map[estado] || 'bg-secondary'}">${estado || '—'}</span>`;
    }

    // ── KPIs ──────────────────────────────────────────────────
    function updateKPIs(data) {
        const total      = data.length;
        const activos    = data.filter(v => v.estado === 'Activo').length;
        const mant       = data.filter(v => v.estado === 'Mantenimiento').length;
        const porVencer  = data.filter(v => {
            const d = daysUntil(v.vigencia_seguro);
            return d !== null && d >= 0 && d <= 90;
        }).length;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('veh-kpi-total',       total);
        set('veh-kpi-activos',     activos);
        set('veh-kpi-mantenimiento', mant);
        set('veh-kpi-vigencia',    porVencer);
    }

    // ── Render: tarjeta de vehículo (grid) ───────────────────
    function cardHTML(v) {
        const tc       = TYPE_COLOR[v.tipo_vehiculo] || TYPE_COLOR['default'];
        const fc       = FUEL_BADGE[v.combustible]   || FUEL_BADGE['default'];
        const fullName = [v.marca, v.submarca].filter(Boolean).join(' ');
        const imgSrc   = v.imagen_url || null;

        const days = daysUntil(v.vigencia_seguro);
        const cardBorder = (days !== null && days < 0)  ? 'border-danger' :
                           (days !== null && days <= 30) ? 'border-warning' : 'border-0';

        return `
        <div class="col-12 col-md-6 col-xl-4" data-veh-id="${v.id}">
          <div class="card shadow-sm rounded-4 h-100 overflow-hidden veh-card ${cardBorder}"
               style="cursor:pointer; transition: transform .18s, box-shadow .18s;"
               onmouseenter="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 32px rgba(0,0,0,.15)'"
               onmouseleave="this.style.transform='';this.style.boxShadow=''"
               onclick="window.vehiculosModule.openDetail('${v.id}')">

            <!-- Franja superior de color por tipo -->
            <div class="position-absolute top-0 start-0 end-0" style="height:4px;background:${tc.bg};"></div>

            <!-- Foto del vehículo -->
            <div class="position-relative" style="height:180px;background:#f0f2f5;overflow:hidden;">
              ${imgSrc
                ? `<img src="${imgSrc}" alt="${fullName}" class="w-100 h-100" style="object-fit:cover;"
                        onerror="this.parentElement.innerHTML=window.vehiculosModule.placeholderHTML('${tc.bg}','${tc.icon}','${fullName}')">`
                : `<div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center"
                        style="background:linear-gradient(135deg,${tc.bg}22,${tc.bg}44);">
                     <i class="fas ${tc.icon} fa-4x" style="color:${tc.bg};opacity:.5;"></i>
                     <span class="small text-muted mt-2">${fullName}</span>
                   </div>`
              }
              <!-- Badge código AIFA -->
              <div class="position-absolute bottom-0 start-0 m-2">
                <span class="badge rounded-pill fw-bold px-3 py-2 shadow"
                      style="background:#E8770A;color:#fff;font-size:.8rem;letter-spacing:.05em;">
                  <i class="fas fa-id-badge me-1"></i>${v.codigo_aifa}
                </span>
              </div>
              <!-- Badge estado -->
              <div class="position-absolute top-0 end-0 m-2">
                ${statusBadge(v.estado)}
              </div>
            </div>

            <!-- Cuerpo -->
            <div class="card-body p-3">
              <h6 class="fw-bold mb-0 text-dark" style="font-size:.95rem;">${fullName}</h6>
              <p class="text-muted mb-2" style="font-size:.78rem;">${v.tipo_vehiculo} · Modelo ${v.anio_modelo || '—'}</p>

              <!-- Specs rápidas -->
              <div class="d-flex flex-wrap gap-1 mb-2">
                <span class="badge rounded-pill ${fc.cls}" style="font-size:.72rem;">
                  <i class="fas ${fc.icon} me-1"></i>${v.combustible || '—'}
                </span>
                <span class="badge rounded-pill bg-light text-dark" style="font-size:.72rem;">
                  <i class="fas fa-cog me-1"></i>${v.transmision || '—'}
                </span>
                ${v.color ? `<span class="badge rounded-pill bg-light text-dark" style="font-size:.72rem;"><i class="fas fa-palette me-1"></i>${v.color}</span>` : ''}
              </div>

              <!-- Placas -->
              <div class="d-flex align-items-center gap-2 mb-2 p-2 rounded-3" style="background:#f8f9fa;">
                <i class="fas fa-car-side text-muted" style="font-size:.8rem;"></i>
                <span class="fw-semibold" style="font-size:.78rem;font-family:'Roboto Mono',monospace;">
                  ${v.placas || '—'}
                </span>
              </div>

              <!-- Seguro -->
              <div style="font-size:.78rem;">${insuranceBadge(v.vigencia_seguro)}</div>
            </div>

            <!-- Footer con acción -->
            <div class="card-footer bg-white border-top-0 pt-0 pb-3 px-3">
              <button class="btn btn-sm w-100 rounded-pill fw-semibold"
                      style="background:linear-gradient(135deg,#0a1f44,#1a3a6e);color:white;font-size:.78rem;"
                      onclick="event.stopPropagation();window.vehiculosModule.openDetail('${v.id}')">
                <i class="fas fa-eye me-1"></i>Ver ficha completa
              </button>
            </div>
          </div>
        </div>`;
    }

    // ── Render: fila de tabla (list view) ────────────────────
    function rowHTML(v) {
        const fullName = [v.marca, v.submarca].filter(Boolean).join(' ');
        return `
        <tr style="cursor:pointer;" onclick="window.vehiculosModule.openDetail('${v.id}')">
          <td>
            <span class="badge rounded-pill fw-bold px-2 py-1" style="background:#E8770A;color:#fff;font-size:.75rem;">
              ${v.codigo_aifa}
            </span>
          </td>
          <td>
            <div class="fw-semibold">${fullName}</div>
            <div class="text-muted small">${v.tipo_vehiculo}</div>
          </td>
          <td>${v.anio_modelo || '—'}</td>
          <td><code class="small">${v.placas || '—'}</code></td>
          <td>${v.combustible || '—'}</td>
          <td>${statusBadge(v.estado)}</td>
          <td id="veh-cell-responsable_nombre-${v.id}" onclick="event.stopPropagation()">${editableCellHTML(v, 'responsable_nombre')}</td>
          <td id="veh-cell-numero_resguardo-${v.id}" onclick="event.stopPropagation()">${editableCellHTML(v, 'numero_resguardo')}</td>
          <td id="veh-cell-vigencia_seguro-${v.id}" onclick="event.stopPropagation()">${editableCellHTML(v, 'vigencia_seguro')}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary rounded-pill"
                    onclick="event.stopPropagation();window.vehiculosModule.openDetail('${v.id}')"
                    title="Ver ficha">
              <i class="fas fa-eye"></i>
            </button>
          </td>
        </tr>`;
    }

    // ── Celdas editables in-line: Responsable / Resguardo / Vigencia de póliza ──
    const EDITABLE_FIELDS = {
        responsable_nombre: { label: 'Responsable',          placeholder: 'Nombre del responsable' },
        numero_resguardo:   { label: 'Número de resguardo',  placeholder: 'No. de resguardo' },
        vigencia_seguro:    { label: 'Vigencia de póliza',   type: 'date', render: v => insuranceBadge(v.vigencia_seguro) }
    };

    function editableCellHTML(v, field) {
        const cfg = EDITABLE_FIELDS[field];
        const raw = v[field];
        const val = cfg.render ? cfg.render(v) : (raw ? escapeHtml(raw) : '<span class="text-muted">—</span>');
        return `
          <span class="d-inline-flex align-items-center gap-1">
            <span class="small">${val}</span>
            <button type="button" class="btn btn-sm btn-link p-0 text-muted" style="font-size:.72rem;"
                    onclick="window.vehiculosModule.editCell('${v.id}','${field}')" title="Editar ${cfg.label.toLowerCase()}">
              <i class="fas fa-pencil-alt"></i>
            </button>
          </span>`;
    }

    function editCell(id, field) {
        const cfg  = EDITABLE_FIELDS[field];
        const v    = state.all.find(x => x.id === id);
        const cell = document.getElementById(`veh-cell-${field}-${id}`);
        if (!v || !cell || !cfg) return;
        const isDate  = cfg.type === 'date';
        const rawVal  = v[field] ? String(v[field]).slice(0, 10) : '';
        cell.innerHTML = `
          <div class="d-flex align-items-center gap-1">
            <input type="${isDate ? 'date' : 'text'}" class="form-control form-control-sm"
                   style="min-width:${isDate ? '150' : '130'}px;font-size:.78rem;"
                   id="veh-input-${field}-${id}" value="${rawVal}"
                   ${isDate ? '' : `placeholder="${cfg.placeholder}"`}>
            <button type="button" class="btn btn-sm btn-success py-0 px-2"
                    onclick="window.vehiculosModule.saveCell('${id}','${field}')" title="Guardar">
              <i class="fas fa-check"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2"
                    onclick="window.vehiculosModule.cancelCell('${id}','${field}')" title="Cancelar">
              <i class="fas fa-times"></i>
            </button>
          </div>`;
        const input = document.getElementById(`veh-input-${field}-${id}`);
        if (input) {
            input.focus();
            input.select();
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); saveCell(id, field); }
                if (e.key === 'Escape') { e.preventDefault(); cancelCell(id, field); }
            });
        }
    }

    function cancelCell(id, field) {
        const v = state.all.find(x => x.id === id);
        const cell = document.getElementById(`veh-cell-${field}-${id}`);
        if (v && cell) cell.innerHTML = editableCellHTML(v, field);
    }

    async function saveCell(id, field) {
        const cfg   = EDITABLE_FIELDS[field];
        const input = document.getElementById(`veh-input-${field}-${id}`);
        const cell  = document.getElementById(`veh-cell-${field}-${id}`);
        if (!input || !cell || !cfg) return;
        const value = input.value.trim() || null;

        cell.innerHTML = '<span class="small text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Guardando…</span>';
        try {
            const supabase = await window.ensureSupabaseClient();
            const { error } = await supabase
                .from('catalogo_vehiculos')
                .update({ [field]: value })
                .eq('id', id);
            if (error) throw error;

            const v  = state.all.find(x => x.id === id);
            const vf = state.filtered.find(x => x.id === id);
            if (v)  v[field]  = value;
            if (vf) vf[field] = value;
            if (field === 'vigencia_seguro') updateKPIs(state.all);

            cell.innerHTML = editableCellHTML(v || { id, [field]: value }, field);
            showToast(`${cfg.label} actualizado ✓`, 'success');
        } catch (err) {
            console.error(`[vehiculos] saveCell(${field}) error:`, err);
            showToast(`Error al guardar ${cfg.label.toLowerCase()}: ` + (err.message || err), 'danger');
            const v = state.all.find(x => x.id === id);
            cell.innerHTML = editableCellHTML(v || {}, field);
        }
    }

    // ── Placeholder cuando no hay imagen ─────────────────────
    function placeholderHTML(bg, icon, name) {
        return `<div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center"
                     style="background:linear-gradient(135deg,${bg}22,${bg}44);">
                  <i class="fas ${icon} fa-4x" style="color:${bg};opacity:.5;"></i>
                  <span class="small text-muted mt-2">${name}</span>
                </div>`;
    }

    // ── Render principal ──────────────────────────────────────
    function render() {
        const grid    = document.getElementById('veh-grid');
        const table   = document.getElementById('veh-table-body');
        const empty   = document.getElementById('veh-empty');
        const gridWr  = document.getElementById('veh-grid-wrapper');
        const listWr  = document.getElementById('veh-list-wrapper');
        if (!grid) return;

        const data = state.filtered;

        if (!data.length) {
            if (empty) empty.classList.remove('d-none');
            if (grid) grid.innerHTML = '';
            if (table) table.innerHTML = '';
            return;
        }
        if (empty) empty.classList.add('d-none');

        if (state.view === 'grid') {
            if (gridWr) gridWr.classList.remove('d-none');
            if (listWr) listWr.classList.add('d-none');
            grid.innerHTML = data.map(cardHTML).join('');
        } else {
            if (gridWr) gridWr.classList.add('d-none');
            if (listWr) listWr.classList.remove('d-none');
            if (table) table.innerHTML = data.map(rowHTML).join('');
        }

        updateKPIs(state.all);
    }

    // ── Filtrado ──────────────────────────────────────────────
    function applyFilters() {
        const q     = normalize(document.getElementById('veh-search')?.value || '');
        const tipo  = document.getElementById('veh-filter-tipo')?.value || 'all';
        const est   = document.getElementById('veh-filter-estado')?.value || 'all';
        const comb  = document.getElementById('veh-filter-combustible')?.value || 'all';

        state.filtered = state.all.filter(v => {
            if (tipo !== 'all' && v.tipo_vehiculo !== tipo) return false;
            if (est  !== 'all' && v.estado !== est)         return false;
            if (comb !== 'all' && v.combustible !== comb)   return false;
            if (q) {
                const searchable = [
                    v.codigo_aifa, v.marca, v.submarca, v.tipo_vehiculo,
                    v.placas, v.numero_serie, v.numero_economico, v.color,
                    v.aseguradora, v.area_responsable,
                    v.responsable_nombre, v.numero_resguardo
                ].map(normalize).join(' ');
                if (!searchable.includes(q)) return false;
            }
            return true;
        });
        render();
    }

    // ── Cambiar vista ─────────────────────────────────────────
    function setView(mode) {
        state.view = mode;
        const btnGrid = document.getElementById('veh-view-grid');
        const btnList = document.getElementById('veh-view-list');
        if (btnGrid) { btnGrid.classList.toggle('btn-primary', mode === 'grid'); btnGrid.classList.toggle('btn-outline-secondary', mode !== 'grid'); }
        if (btnList) { btnList.classList.toggle('btn-primary', mode === 'list'); btnList.classList.toggle('btn-outline-secondary', mode !== 'list'); }
        render();
    }

    // ── Modal: ficha de detalle ───────────────────────────────
    function openDetail(id) {
        const v = state.all.find(x => x.id === id);
        if (!v) return;

        const fullName  = [v.marca, v.submarca].filter(Boolean).join(' ');
        const tc        = TYPE_COLOR[v.tipo_vehiculo] || TYPE_COLOR['default'];
        const days      = daysUntil(v.vigencia_seguro);
        const imgSrc    = v.imagen_url || null;

        const insuranceAlert = (days !== null && days < 0)
            ? `<div class="alert alert-danger p-2 small mb-3"><i class="fas fa-exclamation-circle me-2"></i>Póliza <strong>VENCIDA</strong> desde ${formatDate(v.vigencia_seguro)}</div>`
            : (days !== null && days <= 30)
            ? `<div class="alert alert-warning p-2 small mb-3"><i class="fas fa-clock me-2"></i>Póliza vence en <strong>${days} días</strong> (${formatDate(v.vigencia_seguro)})</div>`
            : '';

        const body = document.getElementById('veh-detail-body');
        if (!body) return;

        body.innerHTML = `
          <!-- Cabecera de ficha -->
          <div class="rounded-3 mb-4 p-4 text-white d-flex align-items-center gap-4"
               style="background:linear-gradient(135deg,#0a1f44,#1a3a6e);">
            <div class="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                 style="width:72px;height:72px;background:rgba(255,255,255,.12);">
              <i class="fas ${tc.icon} fa-2x" style="color:rgba(255,255,255,.9);"></i>
            </div>
            <div>
              <div class="d-flex align-items-center gap-2 mb-1">
                <span class="badge rounded-pill fw-bold px-3 py-2" style="background:#E8770A;font-size:.85rem;">
                  ${v.codigo_aifa}
                </span>
                ${statusBadge(v.estado)}
              </div>
              <h4 class="fw-black mb-0">${fullName}</h4>
              <p class="mb-0 opacity-75 small">${v.tipo_vehiculo} · Modelo ${v.anio_modelo || '—'} · ${v.color || ''}</p>
            </div>
          </div>

          ${insuranceAlert}

          <!-- Foto -->
          ${imgSrc ? `<div class="mb-4 rounded-4 overflow-hidden shadow-sm" style="max-height:280px;">
            <img src="${imgSrc}" alt="${fullName}" class="w-100" style="object-fit:cover;max-height:280px;">
          </div>` : ''}

          <!-- Datos en grid -->
          <div class="row g-3">
            <!-- Col izquierda -->
            <div class="col-md-6">
              <h6 class="fw-bold text-uppercase small text-muted mb-2 letter-spacing-1">
                <i class="fas fa-clipboard-list me-1"></i>Datos de Registro
              </h6>
              <table class="table table-sm table-borderless mb-0">
                <tbody>
                  ${row2('Número de Serie', v.numero_serie, 'fa-barcode')}
                  ${row2('No. Económico',   v.numero_economico, 'fa-hashtag')}
                  ${row2('Placas',          v.placas, 'fa-car-side')}
                  ${row2('Área',            v.area_responsable, 'fa-building')}
                  ${row2('Responsable',        v.responsable_nombre, 'fa-user')}
                  ${row2('Número de Resguardo', v.numero_resguardo, 'fa-file-signature')}
                </tbody>
              </table>
            </div>
            <!-- Col derecha -->
            <div class="col-md-6">
              <h6 class="fw-bold text-uppercase small text-muted mb-2 letter-spacing-1">
                <i class="fas fa-cogs me-1"></i>Especificaciones Técnicas
              </h6>
              <table class="table table-sm table-borderless mb-0">
                <tbody>
                  ${row2('Combustible',  v.combustible,  'fa-gas-pump')}
                  ${row2('Transmisión',  v.transmision,  'fa-cog')}
                  ${row2('Capacidad',    v.capacidad_pasajeros ? v.capacidad_pasajeros + ' personas' : '—', 'fa-users')}
                </tbody>
              </table>
            </div>
            <!-- Seguro (ancho completo) -->
            <div class="col-12">
              <hr class="my-2">
              <h6 class="fw-bold text-uppercase small text-muted mb-2">
                <i class="fas fa-shield-alt me-1"></i>Seguro Vehicular
              </h6>
              <table class="table table-sm table-borderless mb-0">
                <tbody>
                  ${row2('Aseguradora', v.aseguradora, 'fa-building-shield')}
                  ${row2('Póliza No.',  v.poliza_numero, 'fa-file-contract')}
                  ${row2('Descripción', v.poliza_descripcion, 'fa-align-left')}
                  ${row2('Vigencia',    formatDate(v.vigencia_seguro) + ' ' + (days !== null ? (days >= 0 ? `<span class="text-muted small">(${days}d restantes)</span>` : `<span class="text-danger small">(VENCIDA)</span>`) : ''), 'fa-calendar-check')}
                </tbody>
              </table>
            </div>
            ${v.notas ? `<div class="col-12"><hr class="my-2">
              <h6 class="fw-bold text-uppercase small text-muted mb-2"><i class="fas fa-sticky-note me-1"></i>Notas</h6>
              <p class="small text-muted mb-0 ps-2">${v.notas}</p>
            </div>` : ''}
          </div>`;

        document.getElementById('veh-detail-title').textContent = `${v.codigo_aifa} · ${fullName}`;

        // Botón editar (solo admin)
        const editBtn = document.getElementById('veh-detail-edit-btn');
        if (editBtn) {
            editBtn.classList.toggle('d-none', !state.isAdmin);
            editBtn.onclick = () => { closeDetailModal(); openFormModal(v.id); };
        }

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('veh-detail-modal'));
        modal.show();
    }

    function row2(label, value, icon) {
        return `<tr>
          <td class="text-muted small py-1" style="width:40%;white-space:nowrap;">
            <i class="fas ${icon} me-1 opacity-50"></i>${label}
          </td>
          <td class="fw-semibold small py-1">${value || '—'}</td>
        </tr>`;
    }

    function closeDetailModal() {
        const modal = bootstrap.Modal.getInstance(document.getElementById('veh-detail-modal'));
        if (modal) modal.hide();
    }

    // ── Modal: formulario agregar / editar ────────────────────
    function openFormModal(id) {
        const v = id ? state.all.find(x => x.id === id) : null;
        state.editingId = id || null;
        state.uploadFile = null;

        const modal = document.getElementById('veh-form-modal');
        if (!modal) return;

        // Título
        document.getElementById('veh-form-title').textContent = v ? `Editar ${v.codigo_aifa}` : 'Agregar vehículo';

        // Llenar campos
        const fields = ['codigo_aifa','tipo_vehiculo','marca','submarca','anio_modelo','color',
                        'numero_serie','numero_economico','placas','combustible','transmision',
                        'capacidad_pasajeros','aseguradora','poliza_numero','poliza_descripcion',
                        'vigencia_seguro','estado','area_responsable','responsable_nombre',
                        'numero_resguardo','notas'];
        fields.forEach(f => {
            const el = document.getElementById(`vf-${f}`);
            if (el) el.value = v ? (v[f] ?? '') : '';
        });

        // Preview foto
        const prev = document.getElementById('vf-foto-preview');
        if (prev) {
            prev.src = (v && v.imagen_url) ? v.imagen_url : '';
            prev.classList.toggle('d-none', !(v && v.imagen_url));
        }

        // Botón eliminar: solo al editar, no al agregar
        const delBtn = document.getElementById('vf-delete-btn');
        if (delBtn) delBtn.classList.toggle('d-none', !state.editingId);

        const m = bootstrap.Modal.getOrCreateInstance(modal);
        m.show();
    }

    // ── Guardar (insert/update) ────────────────────────────────
    async function saveVehiculo() {
        const btn = document.getElementById('vf-save-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando…'; }

        try {
            const supabase = await window.ensureSupabaseClient();
            const payload = {};
            const fields = ['codigo_aifa','tipo_vehiculo','marca','submarca','anio_modelo','color',
                            'numero_serie','numero_economico','placas','combustible','transmision',
                            'capacidad_pasajeros','aseguradora','poliza_numero','poliza_descripcion',
                            'vigencia_seguro','estado','area_responsable','responsable_nombre','notas'];
            fields.forEach(f => {
                const el = document.getElementById(`vf-${f}`);
                if (!el) return;
                const raw = el.value.trim();
                payload[f] = raw === '' ? null : raw;
            });

            // Convertir numéricos
            if (payload.anio_modelo) payload.anio_modelo = parseInt(payload.anio_modelo) || null;
            if (payload.capacidad_pasajeros) payload.capacidad_pasajeros = parseInt(payload.capacidad_pasajeros) || null;
            if (!payload.vigencia_seguro) payload.vigencia_seguro = null;

            // Subir foto si hay archivo pendiente
            if (state.uploadFile) {
                const ext = state.uploadFile.name.split('.').pop().toLowerCase();
                const path = `${payload.codigo_aifa || 'vehiculo'}-${Date.now()}.${ext}`;
                const { error: upErr } = await supabase.storage
                    .from('vehiculos-fotos')
                    .upload(path, state.uploadFile, { upsert: true });
                if (!upErr) {
                    const { data: urlData } = supabase.storage.from('vehiculos-fotos').getPublicUrl(path);
                    payload.imagen_url = urlData?.publicUrl || null;
                }
            }

            let error;
            if (state.editingId) {
                ({ error } = await supabase.from('catalogo_vehiculos').update(payload).eq('id', state.editingId));
            } else {
                ({ error } = await supabase.from('catalogo_vehiculos').insert(payload));
            }

            if (error) throw error;

            bootstrap.Modal.getInstance(document.getElementById('veh-form-modal'))?.hide();
            await load(true);
            showToast(state.editingId ? 'Vehículo actualizado ✓' : 'Vehículo agregado ✓', 'success');
        } catch (err) {
            console.error('[vehiculos] save error:', err);
            showToast('Error al guardar: ' + (err.message || err), 'danger');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-2"></i>Guardar'; }
        }
    }

    // ── Eliminar con confirmación desde formulario ─────────
    function confirmDelete() {
        if (!state.editingId) return;
        const v = state.all.find(x => x.id === state.editingId);
        const label = v ? `${v.codigo_aifa} – ${[v.marca, v.submarca].filter(Boolean).join(' ')}` : 'este vehículo';
        if (!confirm(`¿Eliminar ${label} del catálogo?\nEsta acción no se puede deshacer.`)) return;
        bootstrap.Modal.getInstance(document.getElementById('veh-form-modal'))?.hide();
        deleteVehiculo(state.editingId);
    }

    // ── Eliminar ──────────────────────────────────────────────
    async function deleteVehiculo(id) {
        if (!confirm('¿Eliminar este vehículo del catálogo? Esta acción no se puede deshacer.')) return;
        try {
            const supabase = await window.ensureSupabaseClient();
            const { error } = await supabase.from('catalogo_vehiculos').delete().eq('id', id);
            if (error) throw error;
            closeDetailModal();
            await load(true);
            showToast('Vehículo eliminado', 'warning');
        } catch (err) {
            showToast('Error al eliminar: ' + (err.message || err), 'danger');
        }
    }

    // ── Toast de notificación ─────────────────────────────────
    function showToast(msg, type = 'success') {
        const container = document.getElementById('veh-toast-container');
        if (!container) return;
        const id = 'vt-' + Date.now();
        container.insertAdjacentHTML('beforeend', `
          <div id="${id}" class="toast align-items-center text-white bg-${type} border-0 show" role="alert" style="min-width:260px;">
            <div class="d-flex">
              <div class="toast-body small fw-semibold">${msg}</div>
              <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="document.getElementById('${id}').remove()"></button>
            </div>
          </div>`);
        setTimeout(() => { document.getElementById(id)?.remove(); }, 4000);
    }

    // ── Carga desde Supabase ──────────────────────────────────
    async function load(force = false) {
        if (state.loading) return;
        if (state.loaded && !force) { applyFilters(); return; }

        state.loading = true;
        const loading = document.getElementById('veh-loading');
        const grid    = document.getElementById('veh-grid');
        if (loading) loading.classList.remove('d-none');
        if (grid)    grid.innerHTML = '';

        try {
            const supabase = await window.ensureSupabaseClient();
            const { data, error } = await supabase
                .from('catalogo_vehiculos')
                .select('*')
                .order('codigo_aifa', { ascending: true });

            if (error) throw error;

            state.all    = data || [];
            state.loaded = true;

            // Detectar rol admin
            const role = sessionStorage.getItem('user_role') || '';
            state.isAdmin = ['admin', 'superadmin'].includes(role);

            // Mostrar botón agregar si admin
            const addBtn = document.getElementById('veh-add-btn');
            if (addBtn) addBtn.classList.toggle('d-none', !state.isAdmin);

            applyFilters();
        } catch (err) {
            console.error('[vehiculos] load error:', err);
            if (grid) grid.innerHTML = `
              <div class="col-12 text-center py-5">
                <i class="fas fa-exclamation-triangle fa-3x text-warning mb-3"></i>
                <p class="text-muted">No se pudieron cargar los vehículos. Verifica tu conexión.</p>
                <button class="btn btn-sm btn-outline-primary rounded-pill" onclick="window.vehiculosModule.reload()">
                  <i class="fas fa-redo me-1"></i>Reintentar
                </button>
              </div>`;
        } finally {
            state.loading = false;
            if (loading) loading.classList.add('d-none');
        }
    }

    // ── Manejo de foto ────────────────────────────────────────
    function handlePhotoChange(input) {
        const file = input.files?.[0];
        if (!file) return;
        state.uploadFile = file;
        const prev = document.getElementById('vf-foto-preview');
        if (prev) {
            prev.src = URL.createObjectURL(file);
            prev.classList.remove('d-none');
        }
    }

    // ── Inicialización del módulo (llamada al entrar a sección)
    function init() {
        // Bind filtros (solo primera vez, usando flag en el DOM)
        const search = document.getElementById('veh-search');
        if (search && !search.dataset.bound) {
            search.dataset.bound = '1';
            search.addEventListener('input', applyFilters);
            ['veh-filter-tipo','veh-filter-estado','veh-filter-combustible'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', applyFilters);
            });
        }
        load();
    }

    // ── API pública ───────────────────────────────────────────
    window.vehiculosModule = {
        init,
        reload:          () => load(true),
        openDetail,
        openFormModal,
        saveVehiculo,
        deleteVehiculo,
        editCell,
        saveCell,
        cancelCell,
        confirmDelete,
        setView,
        applyFilters,
        placeholderHTML,
        handlePhotoChange
    };

    // Funciones globales para onclick en HTML
    window.setVehView         = mode => window.vehiculosModule.setView(mode);
    window.openVehModal       = ()   => window.vehiculosModule.openFormModal(null);
    window.saveVehForm        = ()   => window.vehiculosModule.saveVehiculo();
    window.deleteVeh          = id   => window.vehiculosModule.deleteVehiculo(id);
    window.vehPhotoChanged    = el   => window.vehiculosModule.handlePhotoChange(el);

})();
