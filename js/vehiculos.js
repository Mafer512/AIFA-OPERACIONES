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
        uploadFile: null, // File object pendiente de subir (foto)
        resguardoFile: null, // File object pendiente de subir (PDF de resguardo)
        previewRequest: null, // token de la última solicitud de vista previa (evita respuestas fuera de orden)
        mantVehiculoId: null, // vehículo activo al registrar un mantenimiento
        // Visor de PDF embebido (modal)
        viewerRequest: 0,
        viewerPdf: null,
        viewerVehId: null,
        viewerPage: 1,
        viewerPages: null,
        viewerScale: 1,
        viewerFitMode: 'page',
        viewerRenderRequest: 0,
        viewerRenderTask: null,
        viewerResizeTimer: null,
        viewerSignedUrl: null
    };

    // Cache de miniaturas ya renderizadas: "id:storage_path" -> dataURL
    const resguardoPreviewCache = new Map();

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
        const pdfBtn = (field === 'numero_resguardo' && v.resguardo_pdf_path)
            ? `<button type="button" class="btn btn-sm btn-link p-0 text-danger" style="font-size:.8rem;"
                       onclick="window.vehiculosModule.viewResguardoPdf('${v.id}')"
                       onmouseenter="window.vehiculosModule.showResguardoPreview(event,'${v.id}')"
                       onmouseleave="window.vehiculosModule.hideResguardoPreview()"
                       title="Ver PDF: ${escapeHtml(v.resguardo_pdf_nombre || 'resguardo.pdf')}">
                 <i class="fas fa-file-pdf"></i>
               </button>`
            : '';
        return `
          <span class="d-inline-flex align-items-center gap-1">
            <span class="small">${val}</span>
            ${pdfBtn}
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
        state.resguardoFile = null;
        const isDate  = cfg.type === 'date';
        const rawVal  = v[field] ? String(v[field]).slice(0, 10) : '';
        const pdfRow  = field === 'numero_resguardo' ? `
            <div class="d-flex align-items-center justify-content-center gap-2 mt-1 w-100">
              <label for="veh-input-resguardo-pdf-${id}"
                     class="btn btn-sm btn-outline-primary rounded-pill py-0 px-2 mb-0 d-inline-flex align-items-center"
                     style="font-size:.7rem;line-height:1;cursor:pointer;white-space:nowrap;">
                <i class="fas fa-paperclip me-1"></i>Adjuntar PDF
              </label>
              <input type="file" accept="application/pdf,.pdf" class="d-none"
                     id="veh-input-resguardo-pdf-${id}"
                     onchange="window.vehiculosModule.handleResguardoFileChange('${id}', this)">
              <span id="veh-resguardo-filename-${id}" class="small text-muted text-truncate d-inline-flex align-items-center" style="max-width:130px;font-size:.7rem;line-height:1;">
                Ningún archivo seleccionado
              </span>
            </div>
            ${v.resguardo_pdf_path ? `<div class="d-flex align-items-center justify-content-center gap-2 small text-muted mt-1" style="font-size:.7rem;">
                <span><i class="fas fa-file-pdf me-1 text-danger"></i>Actual: ${escapeHtml(v.resguardo_pdf_nombre || 'archivo.pdf')}</span>
                <button type="button" class="btn btn-sm btn-link p-0 text-danger" style="font-size:.78rem;line-height:1;"
                        onclick="window.vehiculosModule.removeResguardoPdf('${id}')" title="Eliminar PDF adjunto">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>` : ''}` : '';
        cell.innerHTML = `
          <div class="d-flex flex-column gap-1">
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
            </div>
            ${pdfRow}
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

    function handleResguardoFileChange(id, input) {
        const label = document.getElementById(`veh-resguardo-filename-${id}`);
        const file  = input.files?.[0];
        if (!file) {
            state.resguardoFile = null;
            if (label) label.textContent = 'Ningún archivo seleccionado';
            return;
        }
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        if (!isPdf) {
            showToast('Solo se permiten archivos PDF.', 'danger');
            input.value = '';
            state.resguardoFile = null;
            if (label) label.textContent = 'Ningún archivo seleccionado';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast('El PDF no debe superar 10 MB.', 'danger');
            input.value = '';
            state.resguardoFile = null;
            if (label) label.textContent = 'Ningún archivo seleccionado';
            return;
        }
        state.resguardoFile = file;
        if (label) { label.textContent = file.name; label.title = file.name; }
    }

    function cancelCell(id, field) {
        state.resguardoFile = null;
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
        const file  = field === 'numero_resguardo' ? state.resguardoFile : null;

        cell.innerHTML = '<span class="small text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Guardando…</span>';
        try {
            const supabase = await window.ensureSupabaseClient();
            const payload = { [field]: value };

            if (file) {
                const v = state.all.find(x => x.id === id);
                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const path = `${(v?.codigo_aifa || id).replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}-${safeName}`;
                const { error: upErr } = await supabase.storage
                    .from('vehiculos-resguardos')
                    .upload(path, file, { upsert: true, contentType: 'application/pdf' });
                if (upErr) throw upErr;
                payload.resguardo_pdf_path   = path;
                payload.resguardo_pdf_nombre = file.name;
            }

            const { error } = await supabase
                .from('catalogo_vehiculos')
                .update(payload)
                .eq('id', id);
            if (error) throw error;

            const v  = state.all.find(x => x.id === id);
            const vf = state.filtered.find(x => x.id === id);
            Object.entries(payload).forEach(([k, val]) => {
                if (v)  v[k]  = val;
                if (vf) vf[k] = val;
            });
            if (field === 'vigencia_seguro') updateKPIs(state.all);

            state.resguardoFile = null;
            cell.innerHTML = editableCellHTML(v || { id, ...payload }, field);
            showToast(`${cfg.label} actualizado ✓`, 'success');
        } catch (err) {
            console.error(`[vehiculos] saveCell(${field}) error:`, err);
            showToast(`Error al guardar ${cfg.label.toLowerCase()}: ` + (err.message || err), 'danger');
            const v = state.all.find(x => x.id === id);
            cell.innerHTML = editableCellHTML(v || {}, field);
        }
    }

    // ── Visor de PDF embebido (modal, sin abrir pestaña nueva) ──
    function ensureViewerUI() {
        if (document.getElementById('veh-pdf-modal')) return;
        document.body.insertAdjacentHTML('beforeend', `
          <div class="modal fade" id="veh-pdf-modal" tabindex="-1" aria-labelledby="veh-pdf-title">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header py-2">
                  <div class="min-w-0 overflow-hidden">
                    <h6 id="veh-pdf-title" class="modal-title mb-0 text-truncate">Documento PDF</h6>
                    <small id="veh-pdf-meta" class="text-muted text-truncate d-block"></small>
                  </div>
                  <button class="btn-close flex-shrink-0" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                </div>
                <div class="modal-body p-0 veh-pdf-body">
                  <div class="veh-pdf-toolbar d-flex flex-wrap gap-2 align-items-center p-2 border-bottom bg-light">
                    <button id="veh-pdf-prev" type="button" class="btn btn-sm btn-outline-secondary" title="Página anterior" aria-label="Página anterior" onclick="window.vehiculosModule.viewerPage(-1)"><i class="fas fa-chevron-left"></i></button>
                    <span id="veh-pdf-page-label" class="small text-nowrap">Página 1</span>
                    <button id="veh-pdf-next" type="button" class="btn btn-sm btn-outline-secondary" title="Página siguiente" aria-label="Página siguiente" onclick="window.vehiculosModule.viewerPage(1)"><i class="fas fa-chevron-right"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" title="Alejar" aria-label="Alejar" onclick="window.vehiculosModule.viewerZoom(-1)"><i class="fas fa-search-minus"></i></button>
                    <span id="veh-pdf-zoom-label" class="small text-nowrap">100%</span>
                    <button type="button" class="btn btn-sm btn-outline-secondary" title="Acercar" aria-label="Acercar" onclick="window.vehiculosModule.viewerZoom(1)"><i class="fas fa-search-plus"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="window.vehiculosModule.viewerFit()">Ajustar al ancho</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="window.vehiculosModule.viewerFitPage()">Ajustar página</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" title="Restablecer zoom inicial" onclick="window.vehiculosModule.viewerReset()"><i class="fas fa-rotate-left me-1"></i>Restablecer</button>
                    <button type="button" class="btn btn-sm btn-outline-primary ms-auto" onclick="window.vehiculosModule.viewerOpenTab()"><i class="fas fa-external-link-alt me-1"></i>Otra pestaña</button>
                    <button type="button" class="btn btn-sm btn-primary" onclick="window.vehiculosModule.viewerDownload()"><i class="fas fa-download me-1"></i>Descargar</button>
                  </div>
                  <div id="veh-pdf-stage" tabindex="0" aria-label="Visor PDF desplazable">
                    <div id="veh-pdf-loading" class="position-absolute top-50 start-50 translate-middle text-center text-white">
                      <span class="spinner-border"></span>
                      <div class="small mt-2">Preparando documento…</div>
                    </div>
                    <div id="veh-pdf-canvas-wrap"><canvas id="veh-pdf-canvas" class="d-none" aria-label="Página del documento PDF"></canvas></div>
                    <div id="veh-pdf-fallback" class="alert alert-warning position-absolute top-50 start-50 translate-middle d-none mb-0">
                      No se pudo mostrar el PDF.
                      <button type="button" class="btn btn-sm btn-outline-dark" onclick="window.vehiculosModule.viewerOpenTab()">Abrir en otra pestaña</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>`);
        document.head.insertAdjacentHTML('beforeend', `<style id="veh-pdf-styles">
          #veh-pdf-modal .modal-dialog{width:min(1500px,96vw);max-width:none;height:96vh;margin:2vh auto}
          #veh-pdf-modal .modal-content{height:100%;overflow:hidden}
          #veh-pdf-modal .modal-header{flex:0 0 auto}
          #veh-pdf-modal .veh-pdf-body{display:flex;flex-direction:column;min-height:0;overflow:hidden}
          #veh-pdf-modal .veh-pdf-toolbar{flex:0 0 auto;z-index:2}
          #veh-pdf-stage{position:relative;flex:1 1 auto;min-height:0;overflow:auto;background:#525659;overscroll-behavior:contain;touch-action:pan-x pan-y}
          #veh-pdf-canvas-wrap{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:100%;min-height:100%;width:max-content;height:max-content;padding:16px}
          #veh-pdf-canvas{display:block;flex:none;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.35)}
          #veh-pdf-loading,#veh-pdf-fallback{z-index:3}
          @media(max-width:767.98px){
            #veh-pdf-modal .modal-dialog{width:100vw;max-width:none;height:100vh;height:100dvh;margin:0}
            #veh-pdf-modal .modal-content{border:0;border-radius:0}
            #veh-pdf-modal .modal-header{padding:.5rem .75rem}
            #veh-pdf-modal .veh-pdf-toolbar{padding:.4rem!important;gap:.3rem!important}
            #veh-pdf-modal .veh-pdf-toolbar .btn{padding:.25rem .45rem}
            #veh-pdf-canvas-wrap{padding:8px}
          }
        </style>`);
        document.getElementById('veh-pdf-modal')?.addEventListener('hidden.bs.modal', clearViewer);
        window.addEventListener('resize', () => {
            clearTimeout(state.viewerResizeTimer);
            state.viewerResizeTimer = setTimeout(() => {
                if (state.viewerPdf && document.getElementById('veh-pdf-modal')?.classList.contains('show')) {
                    applyViewerChange(Boolean(state.viewerFitMode));
                }
            }, 150);
        });
    }

    function cancelViewerRender() {
        state.viewerRenderRequest = (state.viewerRenderRequest || 0) + 1;
        try { state.viewerRenderTask?.cancel?.(); } catch (_) { /* noop */ }
        state.viewerRenderTask = null;
    }

    function clearViewer() {
        cancelViewerRender();
        clearTimeout(state.viewerResizeTimer);
        const pdf = state.viewerPdf;
        state.viewerPdf = null;
        state.viewerVehId = null;
        state.viewerPages = null;
        state.viewerPage = 1;
        state.viewerScale = 1;
        state.viewerFitMode = 'page';
        try { pdf?.destroy?.()?.catch?.(() => {}); } catch (_) { /* noop */ }
        const canvas = document.getElementById('veh-pdf-canvas');
        const ctx = canvas?.getContext?.('2d');
        if (canvas) { ctx?.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0; canvas.classList.add('d-none'); }
        document.getElementById('veh-pdf-loading')?.classList.remove('d-none');
        document.getElementById('veh-pdf-fallback')?.classList.add('d-none');
    }

    function showViewerModal() {
        const el = document.getElementById('veh-pdf-modal');
        const modal = bootstrap.Modal.getOrCreateInstance(el);
        if (el.classList.contains('show')) return Promise.resolve();
        const shown = new Promise(resolve => el.addEventListener('shown.bs.modal', () => requestAnimationFrame(resolve), { once: true }));
        modal.show();
        return shown;
    }

    // ── Ver PDF de resguardo (visor embebido, URL firmada) ─────
    async function viewResguardoPdf(id) {
        const v = state.all.find(x => x.id === id);
        if (!v?.resguardo_pdf_path) return;
        ensureViewerUI();

        const request = (state.viewerRequest = (state.viewerRequest || 0) + 1);
        let pdf = null;
        try {
            const supabase = await window.ensureSupabaseClient();
            const { data, error } = await supabase.storage
                .from('vehiculos-resguardos')
                .createSignedUrl(v.resguardo_pdf_path, 300);
            if (error) throw error;
            if (!window.pdfjsLib?.getDocument) throw new Error('El visor PDF no está disponible en este momento.');

            pdf = await window.pdfjsLib.getDocument({ url: data.signedUrl }).promise;
            if (request !== state.viewerRequest) { pdf.destroy?.(); return; }
            if (!pdf?.numPages) throw new Error('El archivo no contiene páginas PDF legibles.');

            clearViewer();
            state.viewerPdf       = pdf;
            state.viewerVehId     = id;
            state.viewerPage      = 1;
            state.viewerPages     = pdf.numPages;
            state.viewerScale     = 1;
            state.viewerFitMode   = 'page';
            state.viewerSignedUrl = data.signedUrl;

            const titleEl = document.getElementById('veh-pdf-title');
            const metaEl  = document.getElementById('veh-pdf-meta');
            if (titleEl) titleEl.textContent = v.resguardo_pdf_nombre || 'Documento PDF';
            if (metaEl)  metaEl.textContent  = `${v.codigo_aifa} · Núm. de resguardo: ${v.numero_resguardo || '—'}`;
            document.getElementById('veh-pdf-fallback')?.classList.add('d-none');
            document.getElementById('veh-pdf-loading')?.classList.remove('d-none');
            updateViewerStatus();

            await showViewerModal();
            if (request !== state.viewerRequest) return;
            await applyViewerChange(true);
        } catch (err) {
            console.error('[vehiculos] viewResguardoPdf error:', err);
            if (request === state.viewerRequest) {
                if (state.viewerVehId) {
                    showActiveViewerError(err);
                } else {
                    if (pdf && state.viewerPdf !== pdf) { try { pdf.destroy?.(); } catch (_) { /* noop */ } }
                    clearViewer();
                    showToast('No se pudo abrir el PDF: ' + (err.message || err), 'danger');
                }
            }
        }
    }

    function viewerFitScale(baseViewport, mode) {
        const stage = document.getElementById('veh-pdf-stage');
        const padding = window.innerWidth < 768 ? 16 : 32;
        const availableWidth  = Math.max(1, stage.clientWidth  - padding - 2);
        const availableHeight = Math.max(1, stage.clientHeight - padding - 2);
        const widthScale = availableWidth / baseViewport.width;
        return Math.max(.1, mode === 'width' ? widthScale : Math.min(widthScale, availableHeight / baseViewport.height));
    }

    function updateViewerStatus() {
        const pageLabel = document.getElementById('veh-pdf-page-label');
        const zoomLabel = document.getElementById('veh-pdf-zoom-label');
        if (pageLabel) pageLabel.textContent = `Página ${state.viewerPage}${state.viewerPages ? ` de ${state.viewerPages}` : ''}`;
        if (zoomLabel) zoomLabel.textContent = `${Math.round((state.viewerScale || 1) * 100)}%`;
        const prevBtn = document.getElementById('veh-pdf-prev');
        const nextBtn = document.getElementById('veh-pdf-next');
        if (prevBtn) prevBtn.disabled = state.viewerPage <= 1;
        if (nextBtn) nextBtn.disabled = !state.viewerPages || state.viewerPage >= state.viewerPages;
    }

    async function refreshViewer(recalculateFit = false) {
        if (!state.viewerPdf) return;
        cancelViewerRender();
        const request = state.viewerRenderRequest;
        const pdf = state.viewerPdf;
        state.viewerPage = Math.min(state.viewerPages, Math.max(1, state.viewerPage));
        updateViewerStatus();
        document.getElementById('veh-pdf-loading')?.classList.remove('d-none');
        document.getElementById('veh-pdf-fallback')?.classList.add('d-none');

        try {
            const page = await pdf.getPage(state.viewerPage);
            if (request !== state.viewerRenderRequest || pdf !== state.viewerPdf) return;
            const base = page.getViewport({ scale: 1 });
            if (recalculateFit) state.viewerScale = viewerFitScale(base, state.viewerFitMode || 'page');
            state.viewerScale = Math.min(4, Math.max(.1, state.viewerScale));

            const cssViewport    = page.getViewport({ scale: state.viewerScale });
            const outputScale    = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
            const renderViewport = page.getViewport({ scale: state.viewerScale * outputScale });
            const canvas  = document.getElementById('veh-pdf-canvas');
            const context = canvas.getContext('2d', { alpha: false });
            canvas.width  = Math.ceil(renderViewport.width);
            canvas.height = Math.ceil(renderViewport.height);
            canvas.style.width  = `${cssViewport.width}px`;
            canvas.style.height = `${cssViewport.height}px`;

            const task = page.render({ canvasContext: context, viewport: renderViewport });
            state.viewerRenderTask = task;
            await task.promise;
            if (request !== state.viewerRenderRequest || pdf !== state.viewerPdf) return;
            state.viewerRenderTask = null;
            canvas.classList.remove('d-none');
            document.getElementById('veh-pdf-loading')?.classList.add('d-none');
            updateViewerStatus();
            const stage = document.getElementById('veh-pdf-stage');
            requestAnimationFrame(() => stage.scrollTo({ top: 0, left: Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2), behavior: 'auto' }));
        } catch (err) {
            if (err?.name === 'RenderingCancelledException' || request !== state.viewerRenderRequest) return;
            state.viewerRenderTask = null;
            throw err;
        }
    }

    function showActiveViewerError(err) {
        const canvas   = document.getElementById('veh-pdf-canvas');
        const fallback = document.getElementById('veh-pdf-fallback');
        cancelViewerRender();
        canvas?.classList.add('d-none');
        document.getElementById('veh-pdf-loading')?.classList.add('d-none');
        if (fallback) {
            fallback.innerHTML = `No se pudo mostrar el PDF. ${escapeHtml(err?.message || '')}
              <button type="button" class="btn btn-sm btn-outline-dark" onclick="window.vehiculosModule.viewerOpenTab()">Abrir en otra pestaña</button>`;
            fallback.classList.remove('d-none');
        }
        showToast('No se pudo mostrar el PDF: ' + (err?.message || err), 'danger');
    }

    async function applyViewerChange(recalculateFit = false) {
        try { await refreshViewer(recalculateFit); }
        catch (err) { showActiveViewerError(err); }
    }

    async function viewerPage(delta) {
        const next = Math.min(state.viewerPages || 1, Math.max(1, state.viewerPage + delta));
        if (next === state.viewerPage) return;
        state.viewerPage = next;
        await applyViewerChange(false);
    }

    async function viewerZoom(direction) {
        state.viewerFitMode = null;
        state.viewerScale = Math.min(4, Math.max(.1, (state.viewerScale || 1) * (direction > 0 ? 1.15 : 1 / 1.15)));
        await applyViewerChange(false);
    }

    async function viewerFit()     { state.viewerFitMode = 'width'; await applyViewerChange(true); }
    async function viewerFitPage() { state.viewerFitMode = 'page';  await applyViewerChange(true); }
    async function viewerReset()   { state.viewerFitMode = 'page';  await applyViewerChange(true); }

    function viewerOpenTab() {
        if (!state.viewerVehId || !state.viewerSignedUrl) return;
        const opened = window.open(state.viewerSignedUrl, '_blank', 'noopener');
        if (opened === null) showToast('El navegador bloqueó la nueva pestaña.', 'warning');
    }

    function viewerDownload() {
        if (!state.viewerVehId || !state.viewerSignedUrl) return;
        const v = state.all.find(x => x.id === state.viewerVehId);
        const a = document.createElement('a');
        a.href = state.viewerSignedUrl;
        a.download = v?.resguardo_pdf_nombre || 'resguardo.pdf';
        a.rel = 'noopener';
        a.click();
    }

    // ── Vista previa al pasar el mouse sobre el ícono de PDF ────
    function ensureResguardoPreviewEl() {
        let el = document.getElementById('veh-resguardo-preview');
        if (!el) {
            el = document.createElement('div');
            el.id = 'veh-resguardo-preview';
            el.style.cssText = 'position:fixed;z-index:3000;display:none;background:#fff;'
                + 'border:1px solid rgba(0,0,0,.15);border-radius:10px;'
                + 'box-shadow:0 10px 30px rgba(0,0,0,.25);padding:8px;pointer-events:none;';
            el.innerHTML = `<div id="veh-resguardo-preview-body"
                                  class="d-flex align-items-center justify-content-center"
                                  style="width:200px;height:260px;"></div>`;
            document.body.appendChild(el);
        }
        return el;
    }

    function positionResguardoPreview(el, evt) {
        const margin = 14;
        const w = el.offsetWidth  || 216;
        const h = el.offsetHeight || 276;
        let x = evt.clientX + margin;
        let y = evt.clientY + margin;
        if (x + w > window.innerWidth)  x = evt.clientX - w - margin;
        if (y + h > window.innerHeight) y = window.innerHeight - h - margin;
        el.style.left = `${Math.max(margin, x)}px`;
        el.style.top  = `${Math.max(margin, y)}px`;
    }

    async function showResguardoPreview(evt, id) {
        const v = state.all.find(x => x.id === id);
        if (!v?.resguardo_pdf_path) return;

        const el   = ensureResguardoPreviewEl();
        const body = document.getElementById('veh-resguardo-preview-body');
        el.style.display = 'block';
        positionResguardoPreview(el, evt);

        const cacheKey = `${id}:${v.resguardo_pdf_path}`;
        const cached = resguardoPreviewCache.get(cacheKey);
        if (cached) {
            body.innerHTML = `<img src="${cached}" alt="Vista previa del PDF" style="max-width:100%;max-height:100%;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.15);">`;
            positionResguardoPreview(el, evt);
            return;
        }

        body.innerHTML = '<span class="spinner-border spinner-border-sm text-muted"></span>';
        const token = `${id}:${Date.now()}`;
        state.previewRequest = token;
        try {
            if (!window.pdfjsLib?.getDocument) throw new Error('PDF.js no está disponible.');
            const supabase = await window.ensureSupabaseClient();
            const { data, error } = await supabase.storage
                .from('vehiculos-resguardos')
                .createSignedUrl(v.resguardo_pdf_path, 120);
            if (error) throw error;

            const pdf   = await window.pdfjsLib.getDocument({ url: data.signedUrl }).promise;
            const page  = await pdf.getPage(1);
            const base  = page.getViewport({ scale: 1 });
            const scale = 200 / base.width;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width  = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#fff' }).promise;
            const src = canvas.toDataURL('image/jpeg', .85);
            pdf.destroy?.();

            resguardoPreviewCache.set(cacheKey, src);
            if (state.previewRequest === token) {
                body.innerHTML = `<img src="${src}" alt="Vista previa del PDF" style="max-width:100%;max-height:100%;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.15);">`;
                positionResguardoPreview(el, evt);
            }
        } catch (err) {
            console.error('[vehiculos] showResguardoPreview error:', err);
            if (state.previewRequest === token) {
                body.innerHTML = '<span class="small text-muted text-center px-2">Vista previa no disponible</span>';
            }
        }
    }

    function hideResguardoPreview() {
        const el = document.getElementById('veh-resguardo-preview');
        if (el) el.style.display = 'none';
        state.previewRequest = null;
    }

    // ── Eliminar PDF de resguardo (archivo + referencia en BD) ──
    async function removeResguardoPdf(id) {
        const v = state.all.find(x => x.id === id);
        if (!v?.resguardo_pdf_path) return;
        if (!confirm(`¿Eliminar el PDF adjunto "${v.resguardo_pdf_nombre || 'archivo.pdf'}"?\nEsta acción no se puede deshacer.`)) return;

        try {
            const supabase = await window.ensureSupabaseClient();
            const { error: rmErr } = await supabase.storage
                .from('vehiculos-resguardos')
                .remove([v.resguardo_pdf_path]);
            if (rmErr) throw rmErr;

            const { error } = await supabase
                .from('catalogo_vehiculos')
                .update({ resguardo_pdf_path: null, resguardo_pdf_nombre: null })
                .eq('id', id);
            if (error) throw error;

            v.resguardo_pdf_path = null;
            v.resguardo_pdf_nombre = null;
            const vf = state.filtered.find(x => x.id === id);
            if (vf) { vf.resguardo_pdf_path = null; vf.resguardo_pdf_nombre = null; }

            showToast('PDF de resguardo eliminado', 'warning');

            // Si la celda sigue en modo edición, la redibuja sin el PDF; si no, refresca la vista normal.
            const cell = document.getElementById(`veh-cell-numero_resguardo-${id}`);
            if (cell && document.getElementById(`veh-input-numero_resguardo-${id}`)) {
                editCell(id, 'numero_resguardo');
            } else if (cell) {
                cell.innerHTML = editableCellHTML(v, 'numero_resguardo');
            }
        } catch (err) {
            console.error('[vehiculos] removeResguardoPdf error:', err);
            showToast('Error al eliminar el PDF: ' + (err.message || err), 'danger');
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
                  ${row2('Número de Resguardo', (v.numero_resguardo || '—') + (v.resguardo_pdf_path
                        ? ` <button type="button" class="btn btn-sm btn-link p-0 ms-1 text-danger" style="font-size:.85rem;"
                                    onclick="window.vehiculosModule.viewResguardoPdf('${v.id}')"
                                    title="Ver PDF: ${escapeHtml(v.resguardo_pdf_nombre || 'resguardo.pdf')}">
                              <i class="fas fa-file-pdf"></i></button>`
                        : ''), 'fa-file-signature')}
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

            <!-- Mantenimientos realizados -->
            <div class="col-12">
              <hr class="my-2">
              <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                <h6 class="fw-bold text-uppercase small text-muted mb-0">
                  <i class="fas fa-wrench me-1"></i>Mantenimientos Realizados
                </h6>
                ${state.isAdmin ? `<button type="button" class="btn btn-sm btn-outline-primary rounded-pill px-3"
                        onclick="window.vehiculosModule.openMantModal('${v.id}')">
                  <i class="fas fa-plus me-1"></i>Registrar mantenimiento
                </button>` : ''}
              </div>
              <div id="veh-mant-list">
                <p class="small text-muted text-center py-3 mb-0">
                  <span class="spinner-border spinner-border-sm me-2"></span>Cargando historial…
                </p>
              </div>
            </div>
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
        loadMantenimientos(v.id);
    }

    // ── Mantenimientos: helpers de presentación ───────────────
    function mantTypeBadge(tipo) {
        const map = { 'Preventivo': 'bg-info text-dark', 'Correctivo': 'bg-warning text-dark' };
        return `<span class="badge ${map[tipo] || 'bg-secondary'}">${tipo || '—'}</span>`;
    }

    function formatMoney(val) {
        if (val === null || val === undefined || val === '') return '—';
        const n = Number(val);
        if (Number.isNaN(n)) return '—';
        return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function mantenimientosListHTML(rows) {
        if (!rows.length) {
            return `<p class="small text-muted text-center py-3 mb-0">Sin mantenimientos registrados.</p>`;
        }
        return `
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr class="small text-muted text-uppercase">
                  <th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Km</th>
                  <th>Costo</th><th>Taller</th><th>Responsable</th><th>Próximo</th>
                  ${state.isAdmin ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${rows.map(m => `
                  <tr>
                    <td class="small text-nowrap">${formatDate(m.fecha)}</td>
                    <td>${mantTypeBadge(m.tipo)}</td>
                    <td class="small">${escapeHtml(m.descripcion)}</td>
                    <td class="small text-nowrap">${m.kilometraje != null ? Number(m.kilometraje).toLocaleString('es-MX') + ' km' : '—'}</td>
                    <td class="small text-nowrap">${formatMoney(m.costo)}</td>
                    <td class="small">${m.taller ? escapeHtml(m.taller) : '—'}</td>
                    <td class="small">${m.responsable ? escapeHtml(m.responsable) : '—'}</td>
                    <td class="small text-nowrap">${m.proximo_mantenimiento ? formatDate(m.proximo_mantenimiento) : '—'}</td>
                    ${state.isAdmin ? `<td class="text-center">
                      <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2"
                              onclick="window.vehiculosModule.deleteMantenimiento('${m.id}','${m.vehiculo_id}')"
                              title="Eliminar registro">
                        <i class="fas fa-trash-alt"></i>
                      </button>
                    </td>` : ''}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
    }

    async function loadMantenimientos(vehiculoId) {
        const container = document.getElementById('veh-mant-list');
        if (!container) return;
        try {
            const supabase = await window.ensureSupabaseClient();
            const { data, error } = await supabase
                .from('vehiculo_mantenimientos')
                .select('*')
                .eq('vehiculo_id', vehiculoId)
                .order('fecha', { ascending: false });
            if (error) throw error;
            container.innerHTML = mantenimientosListHTML(data || []);
        } catch (err) {
            console.error('[vehiculos] loadMantenimientos error:', err);
            container.innerHTML = '';
        }
    }

    // ── Mantenimientos: modal de registro ──────────────────────
    function openMantModal(vehiculoId) {
        state.mantVehiculoId = vehiculoId;
        ['vm-kilometraje', 'vm-descripcion', 'vm-costo', 'vm-taller', 'vm-responsable', 'vm-proximo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const tipoEl = document.getElementById('vm-tipo');
        if (tipoEl) tipoEl.value = 'Preventivo';
        const fechaEl = document.getElementById('vm-fecha');
        if (fechaEl) fechaEl.value = new Date().toISOString().slice(0, 10);
        const msgEl = document.getElementById('veh-mant-msg');
        if (msgEl) msgEl.innerHTML = '';

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('veh-mant-modal'));
        modal.show();
    }

    async function saveMantenimiento() {
        const msgEl = document.getElementById('veh-mant-msg');
        const btn   = document.getElementById('vm-save-btn');
        const setMsg = (html, type) => {
            if (msgEl) msgEl.innerHTML = html ? `<div class="alert alert-${type} p-2 small mb-3">${html}</div>` : '';
        };

        const vehiculoId     = state.mantVehiculoId;
        const fecha           = document.getElementById('vm-fecha')?.value || '';
        const tipo             = document.getElementById('vm-tipo')?.value || '';
        const descripcion     = document.getElementById('vm-descripcion')?.value.trim() || '';
        const kilometrajeRaw  = document.getElementById('vm-kilometraje')?.value;
        const costoRaw         = document.getElementById('vm-costo')?.value;
        const taller           = document.getElementById('vm-taller')?.value.trim() || null;
        const responsable     = document.getElementById('vm-responsable')?.value.trim() || null;
        const proximo          = document.getElementById('vm-proximo')?.value || null;

        if (!vehiculoId)  { setMsg('No se identificó el vehículo.', 'danger'); return; }
        if (!fecha)       { setMsg('La fecha es obligatoria.', 'warning'); return; }
        if (!tipo)        { setMsg('El tipo de mantenimiento es obligatorio.', 'warning'); return; }
        if (!descripcion) { setMsg('La descripción del trabajo realizado es obligatoria.', 'warning'); return; }

        const payload = {
            vehiculo_id: vehiculoId,
            fecha,
            tipo,
            descripcion,
            kilometraje: kilometrajeRaw ? parseInt(kilometrajeRaw, 10) : null,
            costo: costoRaw ? parseFloat(costoRaw) : null,
            taller,
            responsable,
            proximo_mantenimiento: proximo || null
        };

        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando…'; }
        try {
            const supabase = await window.ensureSupabaseClient();
            const { error } = await supabase.from('vehiculo_mantenimientos').insert(payload);
            if (error) throw error;

            bootstrap.Modal.getInstance(document.getElementById('veh-mant-modal'))?.hide();
            await loadMantenimientos(vehiculoId);
            showToast('Mantenimiento registrado ✓', 'success');
        } catch (err) {
            console.error('[vehiculos] saveMantenimiento error:', err);
            setMsg(escapeHtml(err.message || String(err)), 'danger');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Guardar'; }
        }
    }

    // ── Mantenimientos: tabla consolidada (todos los vehículos) ──
    function mantenimientosAllListHTML(rows) {
        if (!rows.length) {
            return `<p class="small text-muted text-center py-4 mb-0">Sin mantenimientos registrados.</p>`;
        }
        return `
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr class="small text-muted text-uppercase">
                  <th>Vehículo</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Km</th>
                  <th>Costo</th><th>Taller</th><th>Responsable</th><th>Próximo</th>
                  ${state.isAdmin ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${rows.map(m => {
                    const veh = m.catalogo_vehiculos;
                    const vehLabel = veh ? [veh.marca, veh.submarca].filter(Boolean).join(' ') : '';
                    return `
                      <tr>
                        <td class="small text-nowrap">
                          <span class="badge rounded-pill fw-bold px-2 py-1 me-1" style="background:#E8770A;color:#fff;font-size:.7rem;">${veh ? escapeHtml(veh.codigo_aifa) : '—'}</span>
                          ${escapeHtml(vehLabel)}
                        </td>
                        <td class="small text-nowrap">${formatDate(m.fecha)}</td>
                        <td>${mantTypeBadge(m.tipo)}</td>
                        <td class="small">${escapeHtml(m.descripcion)}</td>
                        <td class="small text-nowrap">${m.kilometraje != null ? Number(m.kilometraje).toLocaleString('es-MX') + ' km' : '—'}</td>
                        <td class="small text-nowrap">${formatMoney(m.costo)}</td>
                        <td class="small">${m.taller ? escapeHtml(m.taller) : '—'}</td>
                        <td class="small">${m.responsable ? escapeHtml(m.responsable) : '—'}</td>
                        <td class="small text-nowrap">${m.proximo_mantenimiento ? formatDate(m.proximo_mantenimiento) : '—'}</td>
                        ${state.isAdmin ? `<td class="text-center">
                          <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2"
                                  onclick="window.vehiculosModule.deleteMantenimiento('${m.id}','${m.vehiculo_id}')"
                                  title="Eliminar registro">
                            <i class="fas fa-trash-alt"></i>
                          </button>
                        </td>` : ''}
                      </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
    }

    async function loadMantAll() {
        const container = document.getElementById('veh-mant-all-body');
        if (!container) return;
        container.innerHTML = `<p class="small text-muted text-center py-4 mb-0"><span class="spinner-border spinner-border-sm me-2"></span>Cargando mantenimientos…</p>`;
        try {
            const supabase = await window.ensureSupabaseClient();
            const { data, error } = await supabase
                .from('vehiculo_mantenimientos')
                .select('*, catalogo_vehiculos(codigo_aifa, marca, submarca)')
                .order('fecha', { ascending: false });
            if (error) throw error;
            container.innerHTML = mantenimientosAllListHTML(data || []);
        } catch (err) {
            console.error('[vehiculos] loadMantAll error:', err);
            container.innerHTML = '';
        }
    }

    function openMantAllModal() {
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('veh-mant-all-modal'));
        modal.show();
        loadMantAll();
    }

    async function deleteMantenimiento(id, vehiculoId) {
        if (!state.isAdmin) return;
        if (!confirm('¿Eliminar este registro de mantenimiento?\nEsta acción no se puede deshacer.')) return;
        try {
            const supabase = await window.ensureSupabaseClient();
            const { error } = await supabase.from('vehiculo_mantenimientos').delete().eq('id', id);
            if (error) throw error;

            if (vehiculoId && document.getElementById('veh-mant-list')) await loadMantenimientos(vehiculoId);
            if (document.getElementById('veh-mant-all-body')) await loadMantAll();
            showToast('Mantenimiento eliminado', 'warning');
        } catch (err) {
            console.error('[vehiculos] deleteMantenimiento error:', err);
            showToast('Error al eliminar: ' + (err.message || err), 'danger');
        }
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
        handleResguardoFileChange,
        viewResguardoPdf,
        removeResguardoPdf,
        showResguardoPreview,
        hideResguardoPreview,
        viewerPage,
        viewerZoom,
        viewerFit,
        viewerFitPage,
        viewerReset,
        viewerOpenTab,
        viewerDownload,
        openMantModal,
        saveMantenimiento,
        openMantAllModal,
        deleteMantenimiento,
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
