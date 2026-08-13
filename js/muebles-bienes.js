(function () {
    'use strict';

    const SECTION = 'muebles-bienes';
    const BUCKET = 'muebles-bienes-documentos';
    const MAX_PDF = 10 * 1024 * 1024;
    const LOAD_TIMEOUT_MS = 20000;
    const THUMBNAIL_STYLE = 'header-v3';
    const THUMBNAIL_CROP = Object.freeze({ left: .10, top: .085, width: .80, height: .115 });
    const state = { all: [], filtered: [], docs: new Map(), docsLoaded: new Set(), loaded: false, loading: false, view: 'grid', editingId: null, replacingDocId: null, raf: 0, signedUrls: new Map(), validatedPdfs: new WeakSet(), thumbnailCache: new Map(), thumbnailJobs: new Map(), thumbnailQueue: [], thumbnailQueued: new Set(), thumbnailActive: 0, thumbnailObserver: null, previewBienId: null, previewIndex: 0, previewCloseTimer: 0, previewRequest: 0, viewerDoc: null, viewerBienId: null, viewerOpening: null, viewerRequest: 0, viewerPdf: null, viewerRenderTask: null, viewerRenderRequest: 0, viewerResizeTimer: 0, viewerPage: 1, viewerPages: null, viewerScale: 1, viewerFitMode: 'page', uploading: false, duplicateResolver: null, quickBienId: null, quickUploads: new Set(), quickSuccess: new Set(), quickTimers: new Map() };
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const fmtDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('es-MX') : '—';
    const canCapture = () => window.dataManager?.canCaptureSection?.(SECTION) || ['admin', 'superadmin'].includes(sessionStorage.getItem('user_role'));
    const canEdit = () => window.dataManager?.canEditSection?.(SECTION) || ['admin', 'superadmin'].includes(sessionStorage.getItem('user_role'));
    const canViewHistory = () => canEdit();
    const qty = row => Number(row.cantidad) || 1;
    const hasAvailableSignal = value => {
        const text = norm(value);
        return /\bdisponibles?\b/.test(text) && !/(?:\b(?:no|sin)\s+disponibles?\b|\bindisponible\b)/.test(text);
    };
    function isAvailable(row) {
        const directFields = [row.area_responsable, row.numero_economico, row.responsable, row.vehiculo_ubicacion];
        if (directFields.some(hasAvailableSignal)) return true;
        const notes = norm(row.observaciones);
        if (!hasAvailableSignal(notes)) return false;
        const assignedAt = notes.search(/\b(?:instalad[oa]s?|asignad[oa]s?|en uso)\b/);
        if (assignedAt < 0 || !row.numero_serie) return true;
        return notes.slice(0, assignedAt).includes(norm(row.numero_serie));
    }

    // Ícono y color por familia (Font Awesome 6, ya cargado por index.html). Se
    // resuelve por coincidencia sobre el nombre normalizado y no por igualdad
    // exacta, para que una variante de captura (acentos, mayúsculas, sufijo de
    // modelo distinto) siga cayendo en el ícono correcto. Gana la primera regla.
    //
    // El color va atado a la familia, nunca a su posición en la fila: si mañana
    // se agrega o se retira una categoría, las demás conservan su color. Los
    // hexadecimales son una paleta categórica validada (banda de luminosidad,
    // piso de croma, separación para daltonismo y contraste sobre el blanco de
    // la tarjeta). No los reemplaces sueltos: el orden es lo que garantiza que
    // dos vecinas se distingan. Una familia nueva cae al gris neutro de "otros".
    const FAMILY_STYLES = [
        [/telecomunicacion/, 'tower-cell', '#1baf7a'],
        [/ruggear|rg72/, 'mobile-screen-button', '#eda100'],
        [/aereo|a120/, 'plane', '#e87ba4'],
        [/\bbase\b/, 'tower-broadcast', '#008300'],
        [/\bmovil\b/, 'car', '#4a3aa7'],
        [/repetidor|uhf/, 'signal', '#e34948'],
        [/\bkw\b|kenwood/, 'walkie-talkie', '#eb6834'],
    ];
    const ALL_STYLE = { icon: 'table-cells-large', color: '#2a78d6' };
    const OTHER_STYLE = { icon: 'box', color: '#6c757d' };
    function familyStyle(value) {
        const match = FAMILY_STYLES.find(([pattern]) => pattern.test(norm(value)));
        return match ? { icon: match[1], color: match[2] } : OTHER_STYLE;
    }

    function ensureUI() {
        if ($('muebles-bienes-section')) return;
        const host = $('coord-auditoria-section')?.parentElement;
        if (!host) return;
        host.insertAdjacentHTML('beforeend', `
        <div id="muebles-bienes-section" class="content-section container-fluid">
          <div id="mb-toast" class="position-fixed bottom-0 end-0 p-3" style="z-index:11000"></div>
          <div class="rounded-4 mb-4 p-4 p-md-5 position-relative overflow-hidden" style="background:linear-gradient(135deg,#0a1f44,#1a3a6e 55%,#2c5282);">
            <i class="fas fa-boxes-stacked position-absolute top-0 end-0 opacity-10 text-white" style="font-size:13rem;transform:translate(12%,-18%)"></i>
            <span class="badge rounded-pill mb-3" style="background:rgba(232,119,10,.18);color:#ffad55">Coordinación de Auditoría</span>
            <h1 class="fw-bold text-white mb-1">Muebles y Bienes</h1>
            <p class="text-white-50 mb-0">Inventario de equipos de radiocomunicación, telecomunicaciones y resguardos documentales</p>
            <button class="btn btn-sm btn-light rounded-circle position-absolute bottom-0 end-0 m-3" onclick="mueblesBienesModule.reload()" title="Actualizar"><i class="fas fa-sync-alt text-primary"></i></button>
          </div>
          <div id="mb-family-tabs" class="d-flex flex-nowrap align-items-stretch gap-3 overflow-auto py-2 mb-4" role="tablist" aria-label="Filtrar por tipo de equipo"></div>
          <div class="card border-0 shadow-sm rounded-4 mb-4"><div class="card-body p-3 d-flex flex-wrap gap-2 align-items-center">
            <div class="input-group flex-grow-1" style="max-width:390px"><span class="input-group-text bg-white"><i class="fas fa-search"></i></span><input id="mb-search" class="form-control" placeholder="Buscar serie, equipo, área, responsable…"></div>
            <select id="mb-filter-familia" class="form-select form-select-sm rounded-pill" style="width:auto"><option value="">Todos los equipos</option></select>
            <select id="mb-filter-area" class="form-select form-select-sm rounded-pill" style="width:auto"><option value="">Todas las áreas</option></select>
            <select id="mb-filter-disponibilidad" class="form-select form-select-sm rounded-pill" style="width:auto"><option value="">Toda disponibilidad</option><option value="asignado">Asignados</option><option value="disponible">Disponibles</option></select>
            <select id="mb-filter-doc" class="form-select form-select-sm rounded-pill" style="width:auto"><option value="">Con y sin documento</option><option value="si">Con documento</option><option value="no">Sin documento</option></select>
            <button class="btn btn-sm btn-outline-secondary rounded-pill" id="mb-clear"><i class="fas fa-eraser me-1"></i>Limpiar</button>
            <button id="mb-recent-history" type="button" class="btn btn-sm btn-outline-dark rounded-pill d-none" onclick="mueblesBienesModule.openRecentHistory()"><i class="fas fa-clock-rotate-left me-1"></i>Últimas modificaciones</button>
            <div class="ms-auto btn-group btn-group-sm"><button id="mb-grid-btn" class="btn btn-primary" onclick="mueblesBienesModule.setView('grid')"><i class="fas fa-th-large"></i></button><button id="mb-table-btn" class="btn btn-outline-secondary" onclick="mueblesBienesModule.setView('table')"><i class="fas fa-list"></i></button></div>
            <button id="mb-add" class="btn btn-sm rounded-pill d-none" style="background:#E8770A;color:white" onclick="mueblesBienesModule.openForm()"><i class="fas fa-plus me-1"></i>Agregar bien</button>
            <button id="mb-import-pdfs" class="btn btn-sm btn-outline-primary rounded-pill d-none" onclick="document.getElementById('mb-import-files').click()"><i class="fas fa-file-import me-1"></i>Importar PDFs</button><input id="mb-import-files" type="file" accept="application/pdf,.pdf" multiple class="d-none"><input id="mb-quick-doc-file" type="file" accept="application/pdf,.pdf" class="d-none">
            <button class="btn btn-sm btn-outline-success rounded-pill" onclick="mueblesBienesModule.exportCSV()"><i class="fas fa-file-csv me-1"></i>CSV</button>
          </div></div>
          <div id="mb-loading" class="text-center py-5"><div class="spinner-border text-primary"></div><p class="text-muted mt-2">Cargando inventario…</p></div>
          <div id="mb-load-error" class="alert alert-danger text-center d-none" role="alert"><div id="mb-load-error-text">No se pudo cargar el inventario.</div><button type="button" class="btn btn-sm btn-outline-danger mt-2" onclick="mueblesBienesModule.reload()"><i class="fas fa-rotate-right me-1"></i>Reintentar</button></div>
          <div id="mb-empty" class="text-center py-5 d-none"><i class="fas fa-box-open fa-3x text-muted"></i><p class="mt-3">No se encontraron bienes con los criterios seleccionados.</p></div>
          <div id="mb-grid" class="row g-4"></div>
          <div id="mb-table-wrap" class="card border-0 shadow-sm rounded-4 d-none"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead class="table-dark"><tr><th>Equipo</th><th>Serie / lote</th><th>Cantidad</th><th>Área responsable</th><th>Resguardo</th><th>Responsable</th><th>Documentación</th><th></th></tr></thead><tbody id="mb-tbody"></tbody></table></div></div>
        </div>`);
        document.body.insertAdjacentHTML('beforeend', modalHTML());
        document.body.insertAdjacentHTML('beforeend', duplicateModalHTML());
        document.head.insertAdjacentHTML('beforeend', `<style id="mb-doc-styles">.mb-family-tab{width:156px;padding:0;background:#fff;border-color:rgba(11,11,11,.1);cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}.mb-family-tab .card-body{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:.15rem}.mb-family-tab-chip{display:flex;align-items:center;justify-content:center;width:38px;height:38px;margin-bottom:.4rem;border-radius:50%;background:#f1f3f7;background:color-mix(in srgb,var(--mb-tab-color) 14%,#fff)}.mb-family-tab-icon{font-size:1.05rem;line-height:1;color:var(--mb-tab-color)}.mb-family-tab-count{color:#0b0b0b;line-height:1.1}.mb-family-tab-label{color:#52514e;white-space:normal;overflow-wrap:anywhere;line-height:1.2;min-height:2.4em;display:flex;align-items:center}.mb-family-tab:hover{border-color:var(--mb-tab-color);transform:translateY(-2px)}.mb-family-tab:focus-visible{outline:2px solid var(--mb-tab-color);outline-offset:2px}.mb-family-tab-active{border-color:var(--mb-tab-color);background:#f7f9fc;background:color-mix(in srgb,var(--mb-tab-color) 7%,#fff);box-shadow:0 0 0 2px rgba(11,11,11,.12),0 .5rem 1rem rgba(11,11,11,.08)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--mb-tab-color) 34%,transparent),0 .5rem 1rem rgba(11,11,11,.08)!important}.mb-family-tab-active .mb-family-tab-chip{background:#e9edf5;background:color-mix(in srgb,var(--mb-tab-color) 26%,#fff)}@media(max-width:575.98px){.mb-family-tab{width:132px}.mb-family-tab .card-body{padding:.65rem!important}}@media(prefers-reduced-motion:reduce){.mb-family-tab{transition:none}.mb-family-tab:hover{transform:none}}.mb-doc-trigger{border:0}.mb-doc-clickable{cursor:pointer}.mb-doc-preview{position:fixed;z-index:12050;width:min(430px,calc(100vw - 20px));max-height:min(590px,calc(100vh - 20px));overflow:auto}.mb-preview-frame{height:300px;background:#e9ecef}.mb-preview-open iframe,.mb-preview-open img{pointer-events:none}.mb-doc-name{background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left}.mb-card-visual{width:100%;height:112px;display:flex;align-items:center;justify-content:center}.mb-card-pdf-preview{padding:0!important;overflow:hidden;background:#eef4fb}.mb-card-pdf-thumb{display:block;width:100%;height:100%;object-fit:cover;object-position:center top;background:#fff}.mb-card-thumb-fallback{pointer-events:none}.mb-quick-uploading,.mb-quick-upload-success{background:#ecfdf3!important;box-shadow:0 0 0 3px rgba(25,135,84,.35),0 .5rem 1rem rgba(25,135,84,.16)!important}.mb-quick-uploading .mb-card-visual,.mb-quick-upload-success .mb-card-visual{background:linear-gradient(135deg,#e4f8eb,#d1f0dc)!important}.mb-quick-uploading .card-body,.mb-quick-uploading .card-footer,.mb-quick-upload-success .card-body,.mb-quick-upload-success .card-footer{background:transparent!important}.mb-quick-state{z-index:4;pointer-events:none}.mb-card-flash{animation:mbPdfFlash 4s ease}@keyframes mbPdfFlash{0%,45%{box-shadow:0 0 0 4px #20c997,0 12px 34px rgba(32,201,151,.35)!important}100%{box-shadow:var(--bs-box-shadow-sm)!important}}.mb-doc-flash{animation:mbBadgeFlash 4s ease}@keyframes mbBadgeFlash{0%,50%{background:#0d6efd!important;transform:scale(1.12)}100%{transform:none}}#mb-pdf-modal .modal-dialog{width:min(1500px,96vw);max-width:none;height:96vh;margin:2vh auto}#mb-pdf-modal .modal-content{height:100%;overflow:hidden}#mb-pdf-modal .modal-header{flex:0 0 auto}#mb-pdf-modal .mb-pdf-body{display:flex;flex-direction:column;min-height:0;overflow:hidden}#mb-pdf-modal .mb-pdf-toolbar{flex:0 0 auto;z-index:2}#mb-pdf-stage{position:relative;flex:1 1 auto;min-height:0;overflow:auto;background:#525659;overscroll-behavior:contain;touch-action:pan-x pan-y}#mb-pdf-canvas-wrap{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:100%;min-height:100%;width:max-content;height:max-content;padding:16px}#mb-pdf-canvas{display:block;flex:none;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.35)}#mb-pdf-loading,#mb-pdf-fallback{z-index:3}@media(max-width:767.98px){#mb-pdf-modal .modal-dialog{width:100vw;max-width:none;height:100vh;height:100dvh;margin:0}#mb-pdf-modal .modal-content{border:0;border-radius:0}#mb-pdf-modal .modal-header{padding:.5rem .75rem}#mb-pdf-modal .mb-pdf-toolbar{padding:.4rem!important;gap:.3rem!important}#mb-pdf-modal .mb-pdf-toolbar .btn{padding:.25rem .45rem}#mb-pdf-canvas-wrap{padding:8px}}</style>`);
        bindUI();
    }

    function modalHTML() {
        return `<div class="modal fade" id="mb-detail-modal" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><h5 id="mb-detail-title" class="modal-title">Ficha del bien</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div id="mb-detail-body" class="modal-body"></div><div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button><button id="mb-edit-detail" class="btn btn-primary d-none">Editar</button></div></div></div></div>
        <div class="modal fade" id="mb-form-modal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><h5 id="mb-form-title" class="modal-title">Bien</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><form id="mb-form"><div class="row g-3">
          ${field('familia','Equipo / familia','text',true)}${field('descripcion','Descripción','text',true,'col-12')}${field('numero_serie','Número de serie')}${field('numero_control','Número de control')}${field('cantidad','Cantidad','number',true)}${field('area_responsable','Área responsable')}${field('numero_economico','Número económico / unidad')}${field('resguardo_folio','Folio de resguardo')}${field('fecha_resguardo','Fecha de resguardo','date')}${field('responsable','Responsable / firma')}${field('vehiculo_ubicacion','Vehículo o ubicación')}${field('observaciones','Observaciones','text',false,'col-12')}
        </div></form><div id="mb-form-error" class="alert alert-danger d-none mt-3"></div></div><div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button><button id="mb-save" class="btn btn-primary">Guardar</button></div></div></div></div>
        <div class="modal fade" id="mb-doc-modal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Agregar documento PDF</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><label class="form-label">Tipo de documento</label><select id="mb-doc-type" class="form-select mb-3"><option>Factura</option><option selected>Resguardo</option><option>Garantía</option><option>Evidencia</option><option>Acta</option><option>Baja</option><option>Mantenimiento</option><option>Otro</option></select><input id="mb-doc-file" type="file" class="form-control" accept="application/pdf,.pdf"><div class="form-text">Solo PDF, máximo 10 MB.</div><div id="mb-upload-state" class="d-none mt-3"><div class="small fw-semibold" id="mb-upload-label">Subiendo PDF…</div><div class="progress mt-2" style="height:8px"><div class="progress-bar progress-bar-striped progress-bar-animated w-100"></div></div></div><div id="mb-doc-error" class="alert alert-danger d-none mt-3"></div></div><div class="modal-footer"><button id="mb-doc-cancel" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button><button id="mb-doc-upload" class="btn btn-primary">Subir</button></div></div></div></div>
        <div id="mb-doc-preview" class="card shadow-lg border-0 mb-doc-preview d-none" role="dialog" aria-label="Previsualización de documentos" onmouseenter="mueblesBienesModule.cancelPreviewClose()" onmouseleave="mueblesBienesModule.schedulePreviewClose()"><div class="card-header d-flex justify-content-between align-items-center"><b>Documentos</b><button class="btn-close" onclick="mueblesBienesModule.closePreview()"></button></div><div id="mb-preview-tabs" class="list-group list-group-horizontal overflow-auto rounded-0"></div><div id="mb-preview-body" class="card-body"></div></div>
        <div class="modal fade" id="mb-pdf-modal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header py-2"><div class="min-w-0 overflow-hidden"><h6 id="mb-pdf-title" class="modal-title mb-0 text-truncate">Documento PDF</h6><small id="mb-pdf-meta" class="text-muted text-truncate d-block"></small></div><button class="btn-close flex-shrink-0" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body p-0 mb-pdf-body"><div class="mb-pdf-toolbar d-flex flex-wrap gap-2 align-items-center p-2 border-bottom bg-light"><button id="mb-pdf-prev" type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" title="Página anterior" aria-label="Página anterior" onclick="mueblesBienesModule.viewerPage(-1)"><i class="fas fa-chevron-left"></i></button><span id="mb-pdf-page-label" class="small text-nowrap">Página 1</span><button id="mb-pdf-next" type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" title="Página siguiente" aria-label="Página siguiente" onclick="mueblesBienesModule.viewerPage(1)"><i class="fas fa-chevron-right"></i></button><button type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" title="Alejar" aria-label="Alejar" onclick="mueblesBienesModule.viewerZoom(-1)"><i class="fas fa-search-minus"></i></button><span id="mb-pdf-zoom-label" class="small text-nowrap">100%</span><button type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" title="Acercar" aria-label="Acercar" onclick="mueblesBienesModule.viewerZoom(1)"><i class="fas fa-search-plus"></i></button><button type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" onclick="mueblesBienesModule.viewerFit()">Ajustar al ancho</button><button type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" onclick="mueblesBienesModule.viewerFitPage()">Ajustar página</button><button type="button" class="btn btn-sm btn-outline-secondary mb-doc-clickable" title="Restablecer zoom inicial" onclick="mueblesBienesModule.viewerReset()"><i class="fas fa-rotate-left me-1"></i>Restablecer</button><button type="button" class="btn btn-sm btn-outline-primary ms-auto mb-doc-clickable" onclick="mueblesBienesModule.viewerOpenTab(event)"><i class="fas fa-external-link-alt me-1"></i>Otra pestaña</button><button id="mb-pdf-download" type="button" class="btn btn-sm btn-primary d-none mb-doc-clickable" onclick="mueblesBienesModule.viewerDownload()"><i class="fas fa-download me-1"></i>Descargar</button></div><div id="mb-pdf-stage" tabindex="0" aria-label="Visor PDF desplazable"><div id="mb-pdf-loading" class="position-absolute top-50 start-50 translate-middle text-center text-white"><span class="spinner-border"></span><div class="small mt-2">Preparando documento…</div></div><div id="mb-pdf-canvas-wrap"><canvas id="mb-pdf-canvas" class="d-none" aria-label="Página del documento PDF"></canvas></div><div id="mb-pdf-fallback" class="alert alert-warning position-absolute top-50 start-50 translate-middle d-none mb-0">No se pudo mostrar el PDF. <button type="button" class="btn btn-sm btn-outline-dark mb-doc-clickable" onclick="mueblesBienesModule.viewerOpenTab(event)">Abrir en otra pestaña</button></div></div></div></div></div></div>
        <div class="modal fade" id="mb-import-pending-modal" tabindex="-1" aria-labelledby="mb-import-pending-title"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><div><h5 id="mb-import-pending-title" class="modal-title">PDFs pendientes</h5><small id="mb-import-pending-summary" class="text-muted"></small></div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><div class="alert alert-warning">Estos archivos no se subieron porque no se pudo determinar con seguridad el bien correspondiente.</div><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Archivo</th><th>Motivo</th></tr></thead><tbody id="mb-import-pending-body"></tbody></table></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>
        <div class="modal fade" id="mb-history-modal" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><div><h5 class="modal-title mb-0"><i class="fas fa-clock-rotate-left me-2"></i>Últimas modificaciones</h5><small class="text-muted">Muebles y Bienes</small></div><button class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div id="mb-history-body" class="modal-body"></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>`;
    }

    function field(id, label, type = 'text', required = false, col = 'col-md-6') {
        return `<div class="${col}"><label class="form-label">${label}${required ? ' *' : ''}</label><input id="mbf-${id}" name="${id}" type="${type}" class="form-control" ${required ? 'required' : ''}></div>`;
    }

    function duplicateModalHTML() {
        return `<div class="modal fade" id="mb-duplicate-modal" tabindex="-1" aria-labelledby="mb-duplicate-title"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 id="mb-duplicate-title" class="modal-title">Documento duplicado</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancelar"></button></div><div class="modal-body"><p class="mb-2">Ya existe un documento con las mismas características:</p><div id="mb-duplicate-info" class="small text-muted border rounded p-2"></div><p class="small text-muted mt-3 mb-0">Elige cómo deseas continuar.</p></div><div class="modal-footer"><button type="button" id="mb-duplicate-cancel" class="btn btn-outline-secondary">Cancelar</button><button type="button" id="mb-duplicate-replace" class="btn btn-outline-warning">Reemplazar</button><button type="button" id="mb-duplicate-version" class="btn btn-primary">Guardar como nueva versión</button></div></div></div></div>`;
    }

    function bindUI() {
        const search = $('mb-search');
        search?.addEventListener('input', () => { cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(applyFilters); });
        ['mb-filter-familia','mb-filter-area','mb-filter-disponibilidad','mb-filter-doc'].forEach(id => $(id)?.addEventListener('change', applyFilters));
        // Las pestañas escriben en el dropdown y disparan el mismo applyFilters,
        // por eso no hace falta sincronizar nada a mano en sentido inverso.
        $('mb-family-tabs')?.addEventListener('click', event => {
            const btn = event.target.closest('[data-mb-family]');
            if (!btn) return;
            const familia = $('mb-filter-familia');
            if (familia) familia.value = btn.dataset.mbFamily;
            applyFilters();
        });
        $('mb-clear')?.addEventListener('click', () => { search.value = ''; ['mb-filter-familia','mb-filter-area','mb-filter-disponibilidad','mb-filter-doc'].forEach(id => $(id).value = ''); applyFilters(); });
        $('mb-save')?.addEventListener('click', save);
        $('mb-doc-file')?.addEventListener('change', event => validateSelectedFile(event.target));
        $('mb-quick-doc-file')?.addEventListener('change', quickFileSelected);
        $('mb-doc-upload')?.addEventListener('click', uploadDocumentSafe);
        $('mb-import-files')?.addEventListener('change', event => bulkImportDocuments([...event.target.files]));
        $('mb-doc-modal')?.addEventListener('hide.bs.modal', event => { if(state.uploading){event.preventDefault();toast('Espera a que termine la carga del documento.','warning');} });
        ['cancel','replace','version'].forEach(choice => $(`mb-duplicate-${choice}`)?.addEventListener('click', () => resolveDuplicate(choice)));
        $('mb-duplicate-modal')?.addEventListener('hide.bs.modal', () => resolveDuplicate('cancel', false));
        window.addEventListener('beforeunload', event => { if(state.uploading){event.preventDefault();event.returnValue='';} });
        $('mb-pdf-modal')?.addEventListener('hidden.bs.modal', clearViewer);
        window.addEventListener('resize', () => { clearTimeout(state.viewerResizeTimer);state.viewerResizeTimer=setTimeout(() => { if(state.viewerPdf&&$('mb-pdf-modal')?.classList.contains('show'))refreshViewer(Boolean(state.viewerFitMode)).catch(showActiveViewerError); },150); });
    }

    function withTimeout(promise, timeoutMs = LOAD_TIMEOUT_MS, message = 'La consulta tardó demasiado. Revisa la conexión e intenta nuevamente.') {
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    async function load(force = false) {
        ensureUI();
        if (state.loading || (state.loaded && !force)) { if (state.loaded) applyFilters(); return; }
        state.loading = true;
        $('mb-loading')?.classList.remove('d-none');
        $('mb-load-error')?.classList.add('d-none');
        try {
            const sb = await withTimeout(window.ensureSupabaseClient(), LOAD_TIMEOUT_MS, 'No se pudo iniciar la conexión con Supabase.');
            const [goodsRes, linksRes] = await withTimeout(Promise.all([
                sb.from('muebles_bienes').select('*').order('familia').order('numero_serie'),
                sb.from('muebles_bienes_documentos').select('bien_id,documento_id')
            ]));
            if (goodsRes.error) throw goodsRes.error;
            if (linksRes.error) throw linksRes.error;
            state.all = (goodsRes.data || []).map(row => ({ ...row, _search: norm([row.familia,row.descripcion,row.numero_serie,row.numero_control,row.area_responsable,row.numero_economico,row.resguardo_folio,row.responsable,row.vehiculo_ubicacion,row.observaciones].join(' ')) }));
            state.docs = new Map(); state.docsLoaded = new Set();
            (linksRes.data || []).forEach(link => { if (!state.docs.has(link.bien_id)) state.docs.set(link.bien_id, []); state.docs.get(link.bien_id).push({id:link.documento_id,_placeholder:true}); });
            state.loaded = true;
            populateFilters();
            $('mb-add')?.classList.toggle('d-none', !canCapture());
            $('mb-import-pdfs')?.classList.toggle('d-none', !canEdit());
            $('mb-recent-history')?.classList.toggle('d-none', !canViewHistory());
            applyFilters();
        } catch (error) {
            const message=error?.message||'Error desconocido al consultar el inventario.';
            console.error('[muebles-bienes] load', error);
            const errorBox=$('mb-load-error'),errorText=$('mb-load-error-text');
            if(errorText)errorText.textContent=`No se pudo cargar el inventario: ${message}`;
            errorBox?.classList.remove('d-none');
            toast(`No se pudo cargar el inventario: ${message}`, 'danger');
        } finally { state.loading = false; $('mb-loading')?.classList.add('d-none'); }
    }

    function activateOnEntry() {
        const section=$('muebles-bienes-section');
        if(location.hash==='#muebles-bienes'||section?.classList.contains('active'))load();
    }

    function populateFilters() {
        refreshFamilyFilterUI();
        fillSelect('mb-filter-area', [...new Set(state.all.map(x => x.area_responsable).filter(Boolean))].sort(), 'Todas las áreas');
    }
    function fillSelect(id, values, first) { const el=$(id), current=el?.value||''; if(el){el.innerHTML=`<option value="">${first}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''); el.value=current;} }

    function currentFilterValues() {
        return {
            q: norm($('mb-search')?.value),
            familia: $('mb-filter-familia')?.value || '',
            area: $('mb-filter-area')?.value || '',
            availability: $('mb-filter-disponibilidad')?.value || '',
            doc: $('mb-filter-doc')?.value || '',
        };
    }

    // Mismo criterio de filtrado que usaba applyFilters, extraído para que los
    // conteos de las pestañas y del dropdown no dupliquen la regla. `skip` omite
    // un criterio: los conteos por familia lo usan para ignorar la familia ya
    // seleccionada, de modo que cada opción diga a cuántas unidades llegarías si
    // la eligieras, y no cero para todas las demás.
    function rowMatches(row, f, skip) {
        if (skip !== 'q' && f.q && !row._search.includes(f.q)) return false;
        if (skip !== 'familia' && f.familia && row.familia !== f.familia) return false;
        if (skip !== 'area' && f.area && row.area_responsable !== f.area) return false;
        if (skip !== 'availability' && f.availability && (f.availability === 'disponible') !== isAvailable(row)) return false;
        if (skip !== 'doc' && f.doc && (f.doc === 'si') !== (state.docs.get(row.id)?.length > 0)) return false;
        return true;
    }

    function familyList() { return [...new Set(state.all.map(x => x.familia).filter(Boolean))].sort(); }

    // Suma unidades (campo cantidad), no número de registros, igual que las
    // tarjetas de resumen. El total incluye los bienes sin familia capturada,
    // porque "Todos" sí los muestra, aunque no tengan pestaña propia.
    function familyCounts() {
        const f = currentFilterValues(), counts = new Map();
        let total = 0;
        state.all.forEach(row => {
            if (!rowMatches(row, f, 'familia')) return;
            const units = qty(row);
            total += units;
            if (row.familia) counts.set(row.familia, (counts.get(row.familia) || 0) + units);
        });
        return { counts, total };
    }

    // Dropdown y pestañas se pintan juntos desde el mismo conteo. La fuente de
    // verdad de la selección es #mb-filter-familia, así que ambos quedan
    // sincronizados por construcción.
    function refreshFamilyFilterUI() {
        const el = $('mb-filter-familia');
        if (!el) return;
        const selected = el.value, families = familyList(), { counts, total } = familyCounts();

        el.innerHTML = `<option value="">Todos los equipos (${total})</option>`
            + families.map(v => `<option value="${esc(v)}">${esc(v)} (${counts.get(v) || 0})</option>`).join('');
        el.value = selected;

        const tabs = $('mb-family-tabs');
        if (!tabs) return;
        // Tarjeta redondeada con ícono, número grande y label debajo: hereda el
        // formato que tenían las tarjetas de resumen, ahora retiradas de la
        // cabecera. Sigue siendo un <button>, así que el clic, el foco por
        // teclado y el handler de #mb-family-tabs funcionan igual que antes.
        const tab = (value, label, count, style) => {
            const active = value === selected;
            return `<button type="button" role="tab" aria-selected="${active}" data-mb-family="${esc(value)}" style="--mb-tab-color:${style.color}" class="mb-family-tab card border shadow-sm rounded-4 flex-shrink-0${active ? ' mb-family-tab-active' : ''}"><div class="card-body text-center p-3"><span class="mb-family-tab-chip"><i class="fas fa-${style.icon} mb-family-tab-icon"></i></span><div class="fw-bold fs-4 mb-family-tab-count">${count}</div><div class="small fw-semibold mb-family-tab-label">${esc(label)}</div></div></button>`;
        };
        tabs.innerHTML = tab('', 'Todos', total, ALL_STYLE)
            + families.map(v => tab(v, v, counts.get(v) || 0, familyStyle(v))).join('');
    }

    function applyFilters() {
        const f = currentFilterValues();
        state.filtered = state.all.filter(row => rowMatches(row, f));
        render();
    }

    // La cabecera ya no monta las cuatro tarjetas de resumen: esa fila la ocupan
    // ahora las tarjetas de categoría, que traen su propio conteo desde
    // familyCounts(). La función sobrevive protegida contra la ausencia de los
    // nodos #mb-kpi-* para que render() no truene; si vuelve a montarse un bloque
    // de indicadores, sigue alimentándolo sin cambios.
    function updateKPIs() {
        const nodes = ['total','asignados','disponibles','sin-doc'].map(id => $(`mb-kpi-${id}`));
        if (nodes.some(node => !node)) return;
        const total=state.all.reduce((a,r)=>a+qty(r),0), available=state.all.filter(isAvailable).reduce((a,r)=>a+qty(r),0), noDoc=state.all.filter(r=>!state.docs.get(r.id)?.length).reduce((a,r)=>a+qty(r),0);
        const [totalNode,assignedNode,availableNode,noDocNode]=nodes;
        totalNode.textContent=total; assignedNode.textContent=total-available; availableNode.textContent=available; noDocNode.textContent=noDoc;
    }

    function render() {
        updateKPIs(); refreshFamilyFilterUI(); const empty=!state.filtered.length;
        $('mb-empty')?.classList.toggle('d-none', !empty); $('mb-grid')?.classList.toggle('d-none', empty || state.view !== 'grid'); $('mb-table-wrap')?.classList.toggle('d-none', empty || state.view !== 'table');
        if (empty) { state.thumbnailObserver?.disconnect?.(); return; }
        $('mb-grid').innerHTML=state.filtered.map(cardHTML).join(''); $('mb-tbody').innerHTML=state.filtered.map(rowHTML).join('');
        scheduleCardThumbnails();
    }
    function docBadge(row) { const count=state.docs.get(row.id)?.length||0;if(count)return `<button type="button" class="badge bg-success mb-doc-trigger mb-doc-clickable" data-mb-doc-bien="${row.id}" aria-label="Abrir ${count} documento(s)" onmouseenter="mueblesBienesModule.previewDocuments(event,'${row.id}')" onmouseleave="mueblesBienesModule.schedulePreviewClose()" onfocus="mueblesBienesModule.previewDocuments(event,'${row.id}')" onclick="mueblesBienesModule.openDocuments(event,'${row.id}')"><i class="fas fa-file-pdf me-1"></i>${count}</button>`;if(!canEdit())return '<span class="badge bg-secondary">Sin PDF</span>';const loading=state.quickUploads.has(row.id);return `<button type="button" class="badge bg-secondary mb-doc-clickable" data-mb-doc-bien="${row.id}" data-mb-quick-upload="${row.id}" aria-label="Cargar PDF para este bien" onclick="mueblesBienesModule.chooseQuickDocument(event,'${row.id}')" ${loading?'disabled':''}>${loading?'<span class="spinner-border spinner-border-sm me-1"></span>Subiendo…':'Sin PDF'}</button>`; }
    function cardFallbackIcon(row) { return `<i class="fas ${norm(row.familia).includes('radio')?'fa-walkie-talkie':'fa-box'} fa-4x text-primary opacity-50 mb-card-thumb-fallback"></i>`; }
    function cardVisual(row) {
        const doc=preferredThumbnailDocument(state.docs.get(row.id)||[]);
        if(!doc)return `<div class="p-4 text-center mb-card-visual" style="background:linear-gradient(135deg,#eef4fb,#dfeaf7)">${cardFallbackIcon(row)}</div>`;
        const cached=cachedDocumentThumbnail(doc),content=cached?`<img class="mb-card-pdf-thumb" src="${esc(cached)}" alt="Primera página del PDF asociado a ${esc(row.familia)}">`:cardFallbackIcon(row);
        return `<div class="text-center mb-card-visual mb-card-pdf-preview" data-mb-thumbnail-bien="${row.id}" data-mb-thumbnail-doc="${doc.id}" aria-busy="${cached?'false':'true'}">${content}</div>`;
    }
    function cardHTML(row) { const loading=state.quickUploads.has(row.id),success=state.quickSuccess.has(row.id),quickClass=loading?'mb-quick-uploading':success?'mb-quick-upload-success':'',quickState=loading?'<span class="mb-quick-state badge bg-success position-absolute top-0 start-50 translate-middle-x mt-2" data-mb-quick-state><span class="spinner-border spinner-border-sm me-1"></span>Subiendo PDF…</span>':success?'<span class="mb-quick-state badge bg-success position-absolute top-0 start-50 translate-middle-x mt-2" data-mb-quick-state><i class="fas fa-check-circle me-1"></i>Listo</span>':'';return `<div class="col-12 col-md-6 col-xl-4" data-mb-card="${row.id}"><div class="card border-0 shadow-sm rounded-4 h-100 overflow-hidden position-relative ${quickClass}">${quickState}${cardVisual(row)}<div class="card-body"><div class="d-flex justify-content-between gap-2"><h6 class="fw-bold">${esc(row.familia)}</h6>${docBadge(row)}</div><p class="small text-muted text-truncate">${esc(row.descripcion)}</p><div class="small"><b>Serie:</b> <code>${esc(row.numero_serie||'Lote')}</code></div><div class="small"><b>Cantidad:</b> ${qty(row)}</div><div class="small text-truncate"><b>Área:</b> ${esc(row.area_responsable||'Sin asignar')}</div><div class="small"><b>Resguardo:</b> ${esc(row.resguardo_folio||'—')}</div></div><div class="card-footer bg-white border-0"><button class="btn btn-sm btn-primary w-100 rounded-pill" onclick="mueblesBienesModule.openDetail('${row.id}')"><i class="fas fa-eye me-1"></i>Ver ficha completa</button></div></div></div>`; }
    function rowHTML(row) { return `<tr data-mb-row="${row.id}"><td><b>${esc(row.familia)}</b><div class="small text-muted text-truncate" style="max-width:280px">${esc(row.descripcion)}</div></td><td><code>${esc(row.numero_serie||`Lote ${row.numero_control||''}`)}</code></td><td>${qty(row)}</td><td>${esc(row.area_responsable||'—')}</td><td>${esc(row.resguardo_folio||'—')}</td><td>${esc(row.responsable||'—')}</td><td>${docBadge(row)}</td><td><button class="btn btn-sm btn-outline-primary" onclick="mueblesBienesModule.openDetail('${row.id}')"><i class="fas fa-eye"></i></button></td></tr>`; }

    function setView(view) { state.view=view; $('mb-grid-btn')?.classList.toggle('btn-primary',view==='grid'); $('mb-grid-btn')?.classList.toggle('btn-outline-secondary',view!=='grid'); $('mb-table-btn')?.classList.toggle('btn-primary',view==='table'); $('mb-table-btn')?.classList.toggle('btn-outline-secondary',view!=='table'); render(); }

    async function loadDocuments(bienId){if(state.docsLoaded.has(bienId))return state.docs.get(bienId)||[];const sb=await window.ensureSupabaseClient(),res=await sb.from('muebles_bienes_documentos').select('documento:muebles_bienes_documentos_archivos(*)').eq('bien_id',bienId);if(res.error)throw res.error;const docs=(res.data||[]).map(x=>x.documento).filter(Boolean);state.docs.set(bienId,docs);state.docsLoaded.add(bienId);return docs;}
    function preferredThumbnailDocument(docs) {
        return [...docs].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||(Number(b.version)||1)-(Number(a.version)||1))[0]||null;
    }
    function thumbnailSignature(doc){return `${THUMBNAIL_STYLE}:${doc?.sha256||doc?.storage_path||'pendiente'}:${Number(doc?.version)||1}`;}
    function cachedDocumentThumbnail(doc){const cached=doc?.id?state.thumbnailCache.get(doc.id):null;if(!cached)return null;if(doc._placeholder||cached.signature===thumbnailSignature(doc))return cached.src;state.thumbnailCache.delete(doc.id);return null;}
    function invalidateDocumentThumbnail(doc){const id=typeof doc==='string'?doc:doc?.id;if(!id)return;state.thumbnailCache.delete(id);state.signedUrls.delete(id);}
    function thumbnailVisuals(bienId){return [...document.querySelectorAll('[data-mb-thumbnail-bien]')].filter(el=>el.dataset.mbThumbnailBien===bienId);}
    function applyDocumentThumbnail(bienId,doc,src){
        thumbnailVisuals(bienId).forEach(visual=>{if(visual.dataset.mbThumbnailDoc!==doc.id)return;visual.innerHTML=`<img class="mb-card-pdf-thumb" src="${esc(src)}" alt="Primera página de ${esc(doc.nombre_original||'el PDF asociado')}">`;visual.setAttribute('aria-busy','false');visual.removeAttribute('title');});
    }
    function markThumbnailUnavailable(bienId,docId){thumbnailVisuals(bienId).forEach(visual=>{if(visual.dataset.mbThumbnailDoc!==docId)return;visual.setAttribute('aria-busy','false');visual.setAttribute('title','Vista previa no disponible; el PDF puede abrirse desde el indicador verde.');});}
    async function generateDocumentThumbnail(bienId,requestedDocId){
        const docs=await loadDocuments(bienId),doc=preferredThumbnailDocument(docs);
        if(!doc)return null;
        thumbnailVisuals(bienId).forEach(visual=>{if(visual.dataset.mbThumbnailDoc===requestedDocId)visual.dataset.mbThumbnailDoc=doc.id;});
        const cached=cachedDocumentThumbnail(doc);if(cached){applyDocumentThumbnail(bienId,doc,cached);return cached;}
        const jobKey=`${doc.id}:${thumbnailSignature(doc)}`;
        let job=state.thumbnailJobs.get(jobKey);
        if(!job){
            job=(async()=>{
                if(!window.pdfjsLib?.getDocument)throw new Error('PDF.js no está disponible.');
                const url=await signedUrl(doc),pdf=await window.pdfjsLib.getDocument({url}).promise;
                try{
                    if(!pdf?.numPages)throw new Error('El PDF no contiene páginas legibles.');
                    const page=await pdf.getPage(1),base=page.getViewport({scale:1}),visual=thumbnailVisuals(bienId).find(el=>el.dataset.mbThumbnailDoc===doc.id),quality=Math.min(2,Math.max(1.5,window.devicePixelRatio||1)),targetWidth=Math.max(1,Math.round((visual?.clientWidth||560)*quality)),targetHeight=Math.max(1,Math.round((visual?.clientHeight||112)*quality)),cropLeft=base.width*THUMBNAIL_CROP.left,cropTop=base.height*THUMBNAIL_CROP.top,cropWidth=base.width*THUMBNAIL_CROP.width,cropHeight=base.height*THUMBNAIL_CROP.height,scale=Math.max(.1,Math.max(targetWidth/cropWidth,targetHeight/cropHeight)),viewport=page.getViewport({scale}),canvas=document.createElement('canvas'),context=canvas.getContext('2d'),offsetX=(targetWidth-cropWidth*scale)/2-cropLeft*scale,offsetY=(targetHeight-cropHeight*scale)/2-cropTop*scale;
                    if(!context)throw new Error('No se pudo preparar la miniatura.');
                    canvas.width=targetWidth;canvas.height=targetHeight;
                    await page.render({canvasContext:context,viewport,transform:[1,0,0,1,offsetX,offsetY],background:'#fff'}).promise;page.cleanup?.();
                    const src=canvas.toDataURL('image/jpeg',.88);state.thumbnailCache.set(doc.id,{signature:thumbnailSignature(doc),src});return src;
                }finally{try{await pdf?.destroy?.();}catch(cleanupError){console.warn('[muebles-bienes] no se pudo liberar la miniatura PDF',cleanupError);}}
            })();
            state.thumbnailJobs.set(jobKey,job);job.then(()=>state.thumbnailJobs.delete(jobKey),()=>state.thumbnailJobs.delete(jobKey));
        }
        const src=await job;applyDocumentThumbnail(bienId,doc,src);return src;
    }
    function pumpThumbnailQueue(){
        while(state.thumbnailActive<2&&state.thumbnailQueue.length){
            const next=state.thumbnailQueue.shift(),queueKey=`${next.bienId}:${next.docId}`;state.thumbnailQueued.delete(queueKey);state.thumbnailActive++;
            generateDocumentThumbnail(next.bienId,next.docId).catch(()=>markThumbnailUnavailable(next.bienId,next.docId)).finally(()=>{state.thumbnailActive--;pumpThumbnailQueue();});
        }
    }
    function queueCardThumbnail(bienId,docId,priority=false){
        const queueKey=`${bienId}:${docId}`;if(state.thumbnailQueued.has(queueKey))return;state.thumbnailQueued.add(queueKey);state.thumbnailQueue[priority?'unshift':'push']({bienId,docId});pumpThumbnailQueue();
    }
    function scheduleCardThumbnails(){
        state.thumbnailObserver?.disconnect?.();
        const visuals=[...document.querySelectorAll('[data-mb-thumbnail-bien]')];if(!visuals.length||state.view!=='grid')return;
        if(!('IntersectionObserver' in window)){visuals.forEach(visual=>queueCardThumbnail(visual.dataset.mbThumbnailBien,visual.dataset.mbThumbnailDoc));return;}
        state.thumbnailObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;state.thumbnailObserver?.unobserve(entry.target);queueCardThumbnail(entry.target.dataset.mbThumbnailBien,entry.target.dataset.mbThumbnailDoc);}),{rootMargin:'320px 0px'});
        visuals.forEach(visual=>{const doc=preferredThumbnailDocument(state.docs.get(visual.dataset.mbThumbnailBien)||[]),cached=doc&&cachedDocumentThumbnail(doc);if(cached)applyDocumentThumbnail(visual.dataset.mbThumbnailBien,doc,cached);else state.thumbnailObserver.observe(visual);});
    }
    function refreshCardThumbnail(bienId){const doc=preferredThumbnailDocument(state.docs.get(bienId)||[]);if(!doc)return;thumbnailVisuals(bienId).forEach(visual=>visual.dataset.mbThumbnailDoc=doc.id);queueCardThumbnail(bienId,doc.id,true);}
    async function openDetail(id) {
        const row=state.all.find(x=>x.id===id); if(!row)return; let docs=[];try{docs=await loadDocuments(id);}catch(e){toast(`No se pudieron cargar los documentos: ${e.message}`,'danger');}
        $('mb-detail-title').textContent=row.numero_serie?`${row.familia} · ${row.numero_serie}`:row.familia;
        $('mb-detail-body').innerHTML=`<div class="row g-4"><div class="col-lg-7"><h6>Información general</h6>${detailsTable(row)}</div><div class="col-lg-5"><div class="d-flex justify-content-between"><h6>Documentos</h6>${canEdit()?`<button class="btn btn-sm btn-outline-primary" onclick="mueblesBienesModule.openDocument('${id}')"><i class="fas fa-upload me-1"></i>Agregar PDF</button>`:''}</div><div class="list-group mt-2">${docs.length?docs.map(d=>docHTML(d,id)).join(''):'<div class="text-muted small p-3">Sin documentación relacionada.</div>'}</div></div></div>`;
        const edit=$('mb-edit-detail'); edit.classList.toggle('d-none',!canEdit()); edit.onclick=()=>{bootstrap.Modal.getInstance($('mb-detail-modal'))?.hide();openForm(id)};
        bootstrap.Modal.getOrCreateInstance($('mb-detail-modal')).show();
    }
    function detailsTable(r) { const fields=[['Descripción',r.descripcion],['Número de serie',r.numero_serie],['Número de control',r.numero_control],['Cantidad',qty(r)],['Área responsable',r.area_responsable],['Número económico / unidad',r.numero_economico],['Folio de resguardo',r.resguardo_folio],['Fecha de resguardo',fmtDate(r.fecha_resguardo)],['Responsable / firma',r.responsable],['Vehículo o ubicación',r.vehiculo_ubicacion],['Observaciones',r.observaciones],['Fuente',`${r.fuente_hoja||'—'} · fila ${r.fuente_fila||'—'}`]]; return `<table class="table table-sm">${fields.map(([k,v])=>`<tr><th style="width:38%">${k}</th><td>${esc(v||'—')}</td></tr>`).join('')}</table>`; }
    function docHTML(doc,bienId) { return `<div class="list-group-item"><div class="d-flex justify-content-between gap-2"><div><i class="fas fa-file-pdf text-danger me-2"></i><b>${esc(doc.tipo_documento)}</b><div class="small text-muted">${esc(doc.nombre_original)}${doc.version>1?` · v${doc.version}`:''}</div></div><div class="btn-group btn-group-sm"><button type="button" class="btn btn-outline-primary mb-doc-clickable" title="Ver" onclick="mueblesBienesModule.openViewer(event,'${doc.id}','${bienId}')"><i class="fas fa-eye"></i></button>${canEdit()?`<button class="btn btn-outline-secondary" title="Reemplazar" onclick="mueblesBienesModule.openDocument('${bienId}','${doc.id}')"><i class="fas fa-rotate"></i></button><button class="btn btn-outline-secondary" title="Reclasificar" onclick="mueblesBienesModule.reclassifyDocument('${doc.id}','${bienId}')"><i class="fas fa-tag"></i></button><button class="btn btn-outline-secondary" title="Reasignar" onclick="mueblesBienesModule.reassignDocument('${doc.id}','${bienId}')"><i class="fas fa-share"></i></button><button class="btn btn-outline-danger" title="Eliminar" onclick="mueblesBienesModule.deleteDocument('${doc.id}','${bienId}')"><i class="fas fa-trash"></i></button>`:''}</div></div></div>`; }

    function openForm(id=null) { if(id&&!canEdit()||!id&&!canCapture())return; const row=id?state.all.find(x=>x.id===id):null; state.editingId=id; $('mb-form-title').textContent=id?'Editar bien':'Agregar bien'; $('mb-form').reset(); ['familia','descripcion','numero_serie','numero_control','cantidad','area_responsable','numero_economico','resguardo_folio','fecha_resguardo','responsable','vehiculo_ubicacion','observaciones'].forEach(k=>{const el=$(`mbf-${k}`);if(el)el.value=row?.[k]??(k==='cantidad'?1:'')}); $('mb-form-error').classList.add('d-none'); bootstrap.Modal.getOrCreateInstance($('mb-form-modal')).show(); }
    async function save() { const form=$('mb-form'); if(!form.reportValidity())return; const payload=Object.fromEntries(new FormData(form)); payload.cantidad=Math.max(1,parseInt(payload.cantidad,10)||1); Object.keys(payload).forEach(k=>{if(payload[k]==='')payload[k]=null}); const old=state.all.find(x=>x.id===state.editingId); try{const sb=await window.ensureSupabaseClient();let res;if(state.editingId)res=await sb.from('muebles_bienes').update(payload).eq('id',state.editingId).select().single();else res=await sb.from('muebles_bienes').insert(payload).select().single();if(res.error)throw res.error;await window.logHistory?.(state.editingId?'EDITAR':'CREAR','Muebles y Bienes',res.data.id,{old,new:res.data,summary:state.editingId?'Bien actualizado':'Bien creado'});bootstrap.Modal.getInstance($('mb-form-modal'))?.hide();state.loaded=false;await load(true);toast('Información guardada correctamente.');}catch(e){const el=$('mb-form-error');el.textContent=e.message;el.classList.remove('d-none');} }

    async function openDocument(id, replaceId=null) { if(!canEdit())return toast('No tienes permiso de edición para cargar documentos.','warning'); try{await loadDocuments(id);}catch(e){return toast(e.message,'danger');} const previous=(state.docs.get(id)||[]).find(d=>d.id===replaceId);if(replaceId&&!previous)return toast('No se encontró el documento que deseas reemplazar.','danger');if(previous&&!confirm(`¿Reemplazar ${previous.nombre_original}? El documento actual se conservará hasta que el nuevo PDF quede guardado y auditado correctamente.`))return;state.editingId=id; state.replacingDocId=replaceId; state.uploading=false; $('mb-doc-file').value=''; $('mb-doc-error').classList.add('d-none');$('mb-upload-state').classList.add('d-none'); $('mb-doc-type').value=previous?.tipo_documento||'Resguardo'; bootstrap.Modal.getOrCreateInstance($('mb-doc-modal')).show(); }
    function documentRecord(doc) {
        const keys=['id','tipo_documento','nombre_original','storage_path','mime_type','tamano_bytes','sha256','version','uploader_email','created_at','created_by'];
        return Object.fromEntries(keys.filter(key=>doc[key]!==undefined).map(key=>[key,doc[key]]));
    }
    async function restoreDocumentLink(sb,doc,bienId,fileBackup,restoreFile) {
        if(restoreFile&&fileBackup&&doc.storage_path){
            const restoredFile=await sb.storage.from(BUCKET).upload(doc.storage_path,fileBackup,{contentType:doc.mime_type||'application/pdf',upsert:true});
            if(restoredFile.error)throw new Error(`No se pudo restaurar el archivo anterior: ${restoredFile.error.message}`);
        }
        const restoredMeta=await sb.from('muebles_bienes_documentos_archivos').upsert(documentRecord(doc),{onConflict:'id'});
        if(restoredMeta.error)throw new Error(`No se pudieron restaurar los metadatos anteriores: ${restoredMeta.error.message}`);
        const restoredLink=await sb.from('muebles_bienes_documentos').upsert({bien_id: bienId,documento_id: doc.id},{onConflict:'bien_id,documento_id',ignoreDuplicates:true});
        if(restoredLink.error)throw new Error(`No se pudo restaurar la relación del documento anterior: ${restoredLink.error.message}`);
    }
    async function removeDocumentLink(sb,doc,bienId) {
        const references=await sb.from('muebles_bienes_documentos').select('bien_id',{count:'exact',head:true}).eq('documento_id',doc.id);
        if(references.error)throw references.error;
        const removesFile=(references.count||0)<=1;
        let fileBackup=null,mutationStarted=false,storageRemovalAttempted=false;
        if(removesFile&&doc.storage_path){
            const downloaded=await sb.storage.from(BUCKET).download(doc.storage_path);
            if(downloaded.error)throw downloaded.error;
            fileBackup=downloaded.data;
        }
        try{
            mutationStarted=true;
            const unlink=await sb.from('muebles_bienes_documentos').delete().eq('bien_id',bienId).eq('documento_id',doc.id);
            if(unlink.error)throw unlink.error;
            if(removesFile){
                const removeMeta=await sb.from('muebles_bienes_documentos_archivos').delete().eq('id',doc.id);
                if(removeMeta.error)throw removeMeta.error;
                if(doc.storage_path){
                    storageRemovalAttempted=true;
                    const removeFile=await sb.storage.from(BUCKET).remove([doc.storage_path]);
                    if(removeFile.error)throw removeFile.error;
                }
            }
        }catch(error){
            if(mutationStarted){
                try{await restoreDocumentLink(sb,doc,bienId,fileBackup,storageRemovalAttempted);}
                catch(recoveryError){const combined=new Error(`${error.message}. ${recoveryError.message}`);combined.recoveryFailed=true;throw combined;}
            }
            throw error;
        }
    }
    function validateFile(file) {
        if(!file)throw new Error('Selecciona un archivo PDF.');
        const mime=String(file.type||'').toLowerCase();
        if(mime&&mime!=='application/pdf'&&mime!=='application/octet-stream')throw new Error('El archivo debe ser un PDF válido.');
        if(!/\.pdf$/i.test(file.name||''))throw new Error('El archivo debe tener extensión .pdf.');
        if(!file.size)throw new Error('El PDF está vacío.');
        if(file.size>MAX_PDF)throw new Error('El PDF supera el máximo de 10 MB.');
    }
    async function validateReadablePdf(file,label=file?.name||'el archivo') {
        if(state.validatedPdfs.has(file))return true;
        if(!await hasPdfHeader(file))throw new Error(`El archivo ${label} no contiene una cabecera PDF válida.`);
        if(!window.pdfjsLib?.getDocument)throw new Error('No se puede validar el contenido del PDF porque PDF.js no está disponible.');
        let task=null,pdf=null;
        try{
            task=window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),stopAtErrors:true});
            pdf=await task.promise;
            if(!pdf?.numPages)throw new Error('El documento no contiene páginas.');
            const page=await pdf.getPage(1),viewport=page?.getViewport?.({scale:1});
            if(!viewport||!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width<=0||viewport.height<=0)throw new Error('La primera página no es legible.');
            if(page.getOperatorList)await page.getOperatorList();
            state.validatedPdfs.add(file);return true;
        }catch(error){
            throw new Error(`El archivo ${label} está dañado o no es un PDF legible. ${error?.message||''}`.trim());
        }finally{
            try{if(pdf)await pdf.destroy?.();else await task?.destroy?.();}catch(cleanupError){console.warn('[muebles-bienes] no se pudo liberar el validador PDF',cleanupError);}
        }
    }
    async function validateSelectedFile(input) { const file=input?.files?.[0],err=$('mb-doc-error'); if(!file){err?.classList.add('d-none');return false;} try{validateFile(file);await validateReadablePdf(file);err?.classList.add('d-none');$('mb-upload-label').textContent=`PDF listo: ${file.name}`;return true;}catch(e){if(input)input.value='';if(err){err.textContent=e.message;err.classList.remove('d-none');}return false;} }
    function resolveDuplicate(choice, close=true) { const resolver=state.duplicateResolver; if(!resolver)return;state.duplicateResolver=null;if(close)bootstrap.Modal.getInstance($('mb-duplicate-modal'))?.hide();resolver(choice); }
    function duplicateDecision(duplicate, exactHash){ $('mb-duplicate-info').innerHTML=`<b>${esc(duplicate.nombre_original||'Documento')}</b><br>${Math.round((duplicate.tamano_bytes||0)/1024)} KB${exactHash?' · coincidencia exacta por contenido':' · coincidencia por nombre y tamano'}`;return new Promise(resolve=>{state.duplicateResolver=resolve;bootstrap.Modal.getOrCreateInstance($('mb-duplicate-modal')).show();}); }
    function setQuickCardState(bienId,status='idle'){
        clearTimeout(state.quickTimers.get(bienId));state.quickTimers.delete(bienId);
        if(status==='success')state.quickSuccess.add(bienId);else state.quickSuccess.delete(bienId);
        document.querySelectorAll(`[data-mb-quick-upload="${bienId}"]`).forEach(button=>{button.disabled=status==='loading';button.innerHTML=status==='loading'?'<span class="spinner-border spinner-border-sm me-1"></span>Subiendo…':'Sin PDF';});
        const card=document.querySelector(`[data-mb-card="${bienId}"] .card`);
        const tableRow=document.querySelector(`[data-mb-row="${bienId}"]`);
        card?.classList.remove('mb-quick-uploading','mb-quick-upload-success');card?.querySelector('[data-mb-quick-state]')?.remove();
        tableRow?.classList.remove('table-success');
        if(status==='loading'&&card){
            card.classList.add('mb-quick-uploading');
            card.insertAdjacentHTML('afterbegin','<span class="mb-quick-state badge bg-success position-absolute top-0 start-50 translate-middle-x mt-2" data-mb-quick-state><span class="spinner-border spinner-border-sm me-1"></span>Subiendo PDF…</span>');
        }else if(status==='success'){
            card?.classList.add('mb-quick-upload-success');
            card?.insertAdjacentHTML('afterbegin','<span class="mb-quick-state badge bg-success position-absolute top-0 start-50 translate-middle-x mt-2" data-mb-quick-state><i class="fas fa-check-circle me-1"></i>Listo</span>');
            state.quickTimers.set(bienId,setTimeout(()=>{state.quickSuccess.delete(bienId);const currentCard=document.querySelector(`[data-mb-card="${bienId}"] .card`),currentRow=document.querySelector(`[data-mb-row="${bienId}"]`);currentCard?.classList.remove('mb-quick-upload-success');currentCard?.querySelector('[data-mb-quick-state]')?.remove();currentRow?.classList.remove('table-success');state.quickTimers.delete(bienId);},4000));
        }
        if((status==='loading'||status==='success')&&tableRow)tableRow.classList.add('table-success');
    }
    function focusBienRecord(bienId){
        const visibleModal=document.querySelector('#mb-doc-modal.show,#mb-detail-modal.show');
        if(visibleModal){visibleModal.addEventListener('hidden.bs.modal',()=>focusBienRecord(bienId),{once:true});return;}
        requestAnimationFrame(()=>{const selector=state.view==='table'?`[data-mb-row="${bienId}"]`:`[data-mb-card="${bienId}"]`,target=document.querySelector(selector);target?.scrollIntoView?.({behavior:'smooth',block:'center',inline:'nearest'});});
    }
    function refreshDocumentUI(bienId,notice,showSuccess=false,returnToCard=false){
        const row=state.all.find(r=>r.id===bienId);render();document.querySelectorAll(`[data-mb-doc-bien="${bienId}"]`).forEach(el=>el.outerHTML=docBadge(row));updateKPIs();
        const detail=$('mb-detail-modal');if(detail?.classList.contains('show')&&!returnToCard)openDetail(bienId);
        if(showSuccess){setQuickCardState(bienId,'success');refreshCardThumbnail(bienId);focusBienRecord(bienId);return;}
        const card=document.querySelector(`[data-mb-card="${bienId}"] .card`);card?.classList.add('mb-card-flash');document.querySelectorAll(`[data-mb-doc-bien="${bienId}"]`).forEach(el=>el.classList.add('mb-doc-flash'));
        if(card){card.insertAdjacentHTML('afterbegin',`<span class="badge bg-success position-absolute top-0 start-0 m-2" data-mb-new-label style="z-index:2">${esc(notice)}</span>`);setTimeout(()=>{card.classList.remove('mb-card-flash');card.querySelector('[data-mb-new-label]')?.remove();},4000);}
        focusBienRecord(bienId);
    }
    function chooseQuickDocument(event,bienId){
        consumeDocumentEvent(event);
        if(!canEdit())return toast('No tienes permiso de edición para cargar documentos.','warning');
        if(state.uploading||state.quickUploads.has(bienId))return toast('Ya hay una carga de PDF en curso.','warning');
        if(!state.all.some(row=>row.id===bienId))return toast('No se encontró el bien seleccionado.','danger');
        if(state.docs.get(bienId)?.length)return toast('Este bien ya tiene documentos. Usa el indicador verde para abrirlos.','info');
        const input=$('mb-quick-doc-file');state.quickBienId=bienId;input.value='';input.click();
    }
    async function quickFileSelected(event){
        const input=event.target,file=input.files?.[0],bienId=state.quickBienId;state.quickBienId=null;
        if(!file||!bienId){input.value='';return;}
        if(!canEdit()){input.value='';return toast('No tienes permiso de edición para cargar documentos.','warning');}
        if(state.quickUploads.has(bienId)){input.value='';return;}
        state.quickUploads.add(bienId);setQuickCardState(bienId,'loading');
        await uploadDocumentSafe({quick:true,bienId,file,type:'Resguardo'});
    }
    async function uploadDocument() { return uploadDocumentSafe(); }
    function referenciaBien(bien){return `${bien?.familia||'Bien'} — ${bien?.numero_serie?`Serie ${bien.numero_serie}`:`Lote ${bien?.numero_control||''}`}`;}
    function consumeDocumentEvent(event){event?.preventDefault?.();event?.stopPropagation?.();event?.stopImmediatePropagation?.();}
    async function signedUrl(doc) {
        if(!doc?.storage_path)throw new Error('El registro no tiene un archivo PDF asociado.');
        const cached=state.signedUrls.get(doc.id);
        if(cached&&cached.expires>Date.now())return cached.url;
        const sb=await window.ensureSupabaseClient(),{data,error}=await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path,300);
        if(error)throw new Error(`No se pudo localizar el archivo en el almacenamiento: ${error.message}`);
        if(!data?.signedUrl)throw new Error('El almacenamiento no devolvió una dirección válida para el PDF.');
        state.signedUrls.set(doc.id,{url:data.signedUrl,expires:Date.now()+240000});
        return data.signedUrl;
    }
    function findDocument(docId,bienId){return (state.docs.get(bienId)||[]).find(doc=>doc.id===docId)||null;}
    function documentOpenMessage(doc,error){return `No se pudo abrir ${doc?.nombre_original||'el PDF'}. ${error?.message||'El archivo no existe o no está disponible.'}`;}
    function reportPdfCleanup(scope,error){console.warn(`[muebles-bienes] no se pudo liberar ${scope}`,error);}
    function cancelViewerRender(){state.viewerRenderRequest++;try{state.viewerRenderTask?.cancel?.();}catch(error){reportPdfCleanup('el render del visor PDF',error);}state.viewerRenderTask=null;}
    function clearViewer(){
        cancelViewerRender();clearTimeout(state.viewerResizeTimer);
        const pdf=state.viewerPdf;state.viewerPdf=null;state.viewerDoc=null;state.viewerBienId=null;state.viewerPages=null;state.viewerPage=1;state.viewerScale=1;state.viewerFitMode='page';
        try{const destroyed=pdf?.destroy?.();destroyed?.catch?.(error=>reportPdfCleanup('el documento del visor PDF',error));}catch(error){reportPdfCleanup('el documento del visor PDF',error);}
        const canvas=$('mb-pdf-canvas'),context=canvas?.getContext?.('2d');if(canvas){context?.clearRect(0,0,canvas.width,canvas.height);canvas.width=0;canvas.height=0;canvas.classList.add('d-none');}
        $('mb-pdf-loading')?.classList.remove('d-none');$('mb-pdf-fallback')?.classList.add('d-none');
    }
    async function openPDF(event,docId,bienId) {
        consumeDocumentEvent(event);
        const doc=findDocument(docId,bienId);
        if(!doc)return toast('No se encontró el documento seleccionado para este bien.','danger');
        try{const opened=window.open(await signedUrl(doc),'_blank','noopener');if(opened===null)throw new Error('El navegador bloqueó la nueva pestaña.');}
        catch(e){toast(documentOpenMessage(doc,e),'danger');}
    }
    async function openDocuments(event,bienId){
        const anchor=event?.currentTarget||event?.target;
        consumeDocumentEvent(event);
        try{
            const docs=await loadDocuments(bienId);
            if(!docs.length){closePreview();return toast('Este bien ya no tiene documentos disponibles. Actualiza el módulo e inténtalo nuevamente.','warning');}
            if(docs.length===1){closePreview();return openViewer(null,docs[0].id,bienId);}
            return previewDocuments({currentTarget:anchor,target:anchor},bienId);
        }catch(e){closePreview();toast(`No se pudieron abrir los documentos de este bien. ${e.message}`,'danger');}
    }
    function positionPreview(anchor){const box=$('mb-doc-preview'),rect=anchor.getBoundingClientRect(),gap=8;box.classList.remove('d-none');const width=box.offsetWidth||430,height=box.offsetHeight||520;let left=rect.right+gap,top=rect.top;if(left+width>innerWidth-10)left=Math.max(10,rect.left-width-gap);if(top+height>innerHeight-10)top=Math.max(10,innerHeight-height-10);box.style.left=`${left}px`;box.style.top=`${top}px`;}
    async function previewDocuments(event,bienId,toggle=false){cancelPreviewClose();const box=$('mb-doc-preview'),anchor=event?.currentTarget||event?.target;if(!anchor)return;if(toggle&&state.previewBienId===bienId&&!box.classList.contains('d-none'))return closePreview();const request=++state.previewRequest;state.previewBienId=bienId;state.previewIndex=0;$('mb-preview-tabs').innerHTML='';$('mb-preview-body').innerHTML='<div class="text-center py-5"><span class="spinner-border text-primary"></span><div class="small mt-2">Cargando documentos…</div></div>';positionPreview(anchor);try{const docs=await loadDocuments(bienId);if(request!==state.previewRequest||state.previewBienId!==bienId)return;if(!docs.length)return closePreview();$('mb-preview-tabs').innerHTML=docs.map((d,i)=>`<button type="button" class="list-group-item list-group-item-action small text-nowrap mb-doc-clickable ${i===0?'active':''}" onmouseenter="mueblesBienesModule.selectPreview(${i},'${bienId}')" onfocus="mueblesBienesModule.selectPreview(${i},'${bienId}')" onclick="mueblesBienesModule.openViewer(event,'${d.id}','${bienId}')">${esc(d.tipo_documento||'PDF')} ${i+1}</button>`).join('');await renderPreview();}catch(e){if(request===state.previewRequest)$('mb-preview-body').innerHTML=`<div class="alert alert-warning">No se pudo cargar la documentación. ${esc(e.message)}</div>`;}}
    async function renderPreview(){
        const bienId=state.previewBienId,index=state.previewIndex,docs=state.docs.get(bienId)||[],doc=docs[index];
        if(!doc)return closePreview();
        try{
            const url=await signedUrl(doc),created=doc.created_at?new Date(doc.created_at).toLocaleString('es-MX'):'Sin fecha',openAction=`mueblesBienesModule.openViewer(event,'${doc.id}','${bienId}')`;
            let preview='<div class="mb-preview-frame d-flex align-items-center justify-content-center"><span class="spinner-border text-primary"></span></div>';
            if(window.pdfjsLib){
                const pdf=await window.pdfjsLib.getDocument({url}).promise,page=await pdf.getPage(1),base=page.getViewport({scale:1}),scale=Math.min(1.4,400/base.width),viewport=page.getViewport({scale}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
                canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:ctx,viewport}).promise;
                preview=`<button type="button" class="mb-preview-frame mb-preview-open mb-doc-clickable text-center overflow-hidden border-0 p-0 w-100" aria-label="Abrir ${esc(doc.nombre_original)}" onclick="${openAction}"><img class="h-100 mw-100" alt="Primera página de ${esc(doc.nombre_original)}" src="${canvas.toDataURL('image/jpeg',.82)}"></button>`;
            }else{
                preview=`<button type="button" class="mb-preview-frame mb-preview-open mb-doc-clickable border-0 p-0 w-100" aria-label="Abrir ${esc(doc.nombre_original)}" onclick="${openAction}"><iframe class="w-100 h-100 border-0" loading="lazy" src="${esc(url)}#page=1&zoom=page-width&toolbar=0" title="Primera página de ${esc(doc.nombre_original)}"></iframe></button>`;
            }
            if(state.previewBienId!==bienId||state.previewIndex!==index)return;
            $('mb-preview-body').innerHTML=`${preview}<h6 class="mt-3 mb-1 text-break"><button type="button" class="mb-doc-name mb-doc-clickable text-break" onclick="${openAction}">${esc(doc.nombre_original)}</button></h6><div class="small text-muted"><b>${esc(doc.tipo_documento||'Documento')}</b> · ${esc(created)}</div><div class="small text-muted mb-3">Cargado por: ${esc(doc.uploader_email||doc.created_by||'Sin información')}</div><div class="d-flex flex-wrap gap-2"><button type="button" class="btn btn-sm btn-primary mb-doc-clickable" onclick="${openAction}"><i class="fas fa-eye me-1"></i>Ver PDF completo</button><button type="button" class="btn btn-sm btn-outline-primary mb-doc-clickable" onclick="mueblesBienesModule.openPDF(event,'${doc.id}','${bienId}')"><i class="fas fa-external-link-alt me-1"></i>Otra pestaña</button></div>`;
        }catch(e){if(state.previewBienId===bienId&&state.previewIndex===index)$('mb-preview-body').innerHTML=`<div class="alert alert-warning">No se pudo generar la vista previa. ${esc(e.message)}</div><button type="button" class="btn btn-sm btn-outline-primary mb-doc-clickable" onclick="mueblesBienesModule.openPDF(event,'${doc.id}','${bienId}')">Abrir en otra pestaña</button>`;}
    }
    function selectPreview(index,bienId){if(state.previewBienId!==bienId)return;state.previewIndex=index;$('mb-preview-tabs').querySelectorAll('button').forEach((button,i)=>button.classList.toggle('active',i===index));renderPreview();}
    function schedulePreviewClose(){clearTimeout(state.previewCloseTimer);state.previewCloseTimer=setTimeout(closePreview,350);}
    function cancelPreviewClose(){clearTimeout(state.previewCloseTimer);}
    function closePreview(){cancelPreviewClose();state.previewRequest++;$('mb-doc-preview')?.classList.add('d-none');const frame=$('mb-preview-body')?.querySelector('iframe');if(frame)frame.src='about:blank';state.previewBienId=null;}
    async function loadViewerPdf(url){
        if(!window.pdfjsLib?.getDocument)throw new Error('El visor PDF no está disponible en este momento.');
        const pdf=await window.pdfjsLib.getDocument({url}).promise;
        if(!pdf?.numPages){try{await pdf?.destroy?.();}catch(error){reportPdfCleanup('el PDF ilegible',error);}throw new Error('El archivo no contiene páginas PDF legibles.');}
        return pdf;
    }
    function showViewerModal(){
        const element=$('mb-pdf-modal'),modal=bootstrap.Modal.getOrCreateInstance(element);
        if(element.classList.contains('show'))return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const shown=new Promise(resolve=>element.addEventListener('shown.bs.modal',()=>requestAnimationFrame(resolve),{once:true}));modal.show();return shown;
    }
    async function openViewer(event,docId,bienId){
        consumeDocumentEvent(event);
        const doc=findDocument(docId,bienId);let modalOpened=false,pdf=null;
        if(!doc){state.viewerRequest++;state.viewerOpening=null;clearViewer();toast('No se encontró el documento seleccionado para este bien.','danger');return false;}
        const openingKey=`${bienId}:${docId}`;
        if(state.viewerOpening===openingKey)return false;
        const request=++state.viewerRequest;state.viewerOpening=openingKey;
        try{
            const url=await signedUrl(doc);pdf=await loadViewerPdf(url);
            if(request!==state.viewerRequest){try{await pdf.destroy?.();}catch(error){reportPdfCleanup('el PDF cancelado',error);}return false;}
            clearViewer();state.viewerPdf=pdf;state.viewerDoc=doc;state.viewerBienId=bienId;state.viewerPage=1;state.viewerPages=pdf.numPages;state.viewerScale=1;state.viewerFitMode='page';
            $('mb-pdf-title').textContent=doc.nombre_original||'Documento PDF';
            $('mb-pdf-meta').textContent=`${doc.tipo_documento||'Documento'} · ${doc.created_at?new Date(doc.created_at).toLocaleString('es-MX'):'Sin fecha'}`;
            $('mb-pdf-download').classList.toggle('d-none',!canEdit());$('mb-pdf-fallback')?.classList.add('d-none');$('mb-pdf-loading')?.classList.remove('d-none');updateViewerStatus();
            closePreview();const shown=showViewerModal();modalOpened=true;await shown;await refreshViewer(true);
            if(request!==state.viewerRequest)return false;
            return true;
        }catch(e){if(request===state.viewerRequest){if(modalOpened&&state.viewerDoc)showActiveViewerError(e);else{if(pdf&&state.viewerPdf!==pdf){try{await pdf.destroy?.();}catch(cleanupError){reportPdfCleanup('el PDF que no pudo abrirse',cleanupError);}}clearViewer();toast(documentOpenMessage(doc,e),'danger');}}return false;}
        finally{if(request===state.viewerRequest)state.viewerOpening=null;}
    }
    function viewerFitScale(baseViewport,mode){
        const stage=$('mb-pdf-stage'),padding=window.innerWidth<768?16:32,availableWidth=Math.max(1,stage.clientWidth-padding-2),availableHeight=Math.max(1,stage.clientHeight-padding-2),widthScale=availableWidth/baseViewport.width;
        return Math.max(.1,mode==='width'?widthScale:Math.min(widthScale,availableHeight/baseViewport.height));
    }
    function updateViewerStatus(){
        $('mb-pdf-page-label').textContent=`Página ${state.viewerPage}${state.viewerPages?` de ${state.viewerPages}`:''}`;
        $('mb-pdf-zoom-label').textContent=`${Math.round(state.viewerScale*100)}%`;
        if($('mb-pdf-prev'))$('mb-pdf-prev').disabled=state.viewerPage<=1;
        if($('mb-pdf-next'))$('mb-pdf-next').disabled=!state.viewerPages||state.viewerPage>=state.viewerPages;
    }
    async function refreshViewer(recalculateFit=false){
        if(!state.viewerPdf)return;
        cancelViewerRender();const request=state.viewerRenderRequest,pdf=state.viewerPdf;
        state.viewerPage=Math.min(state.viewerPages,Math.max(1,state.viewerPage));updateViewerStatus();
        $('mb-pdf-loading')?.classList.remove('d-none');$('mb-pdf-fallback')?.classList.add('d-none');
        try{
            const page=await pdf.getPage(state.viewerPage);if(request!==state.viewerRenderRequest||pdf!==state.viewerPdf)return;
            const base=page.getViewport({scale:1});if(recalculateFit)state.viewerScale=viewerFitScale(base,state.viewerFitMode||'page');
            state.viewerScale=Math.min(4,Math.max(.1,state.viewerScale));
            const cssViewport=page.getViewport({scale:state.viewerScale}),outputScale=Math.min(2,Math.max(1,window.devicePixelRatio||1)),renderViewport=page.getViewport({scale:state.viewerScale*outputScale}),canvas=$('mb-pdf-canvas'),context=canvas.getContext('2d',{alpha:false});
            canvas.width=Math.ceil(renderViewport.width);canvas.height=Math.ceil(renderViewport.height);canvas.style.width=`${cssViewport.width}px`;canvas.style.height=`${cssViewport.height}px`;
            const task=page.render({canvasContext:context,viewport:renderViewport});state.viewerRenderTask=task;await task.promise;
            if(request!==state.viewerRenderRequest||pdf!==state.viewerPdf)return;
            state.viewerRenderTask=null;canvas.classList.remove('d-none');$('mb-pdf-loading')?.classList.add('d-none');updateViewerStatus();
            const stage=$('mb-pdf-stage');requestAnimationFrame(()=>stage.scrollTo({top:0,left:Math.max(0,(stage.scrollWidth-stage.clientWidth)/2),behavior:'auto'}));
        }catch(error){if(error?.name==='RenderingCancelledException'||request!==state.viewerRenderRequest)return;state.viewerRenderTask=null;throw error;}
    }
    function showActiveViewerError(error){
        const doc=state.viewerDoc,canvas=$('mb-pdf-canvas'),fallback=$('mb-pdf-fallback');cancelViewerRender();canvas?.classList.add('d-none');$('mb-pdf-loading')?.classList.add('d-none');
        if(fallback){fallback.innerHTML=`${esc(documentOpenMessage(doc,error))} <button type="button" class="btn btn-sm btn-outline-dark mb-doc-clickable" onclick="mueblesBienesModule.viewerOpenTab(event)">Abrir en otra pestaña</button>`;fallback.classList.remove('d-none');}
        toast(documentOpenMessage(doc,error),'danger');
    }
    async function applyViewerChange(recalculateFit=false){try{await refreshViewer(recalculateFit);}catch(e){showActiveViewerError(e);}}
    async function viewerPage(delta){const next=Math.min(state.viewerPages||1,Math.max(1,state.viewerPage+delta));if(next===state.viewerPage)return;state.viewerPage=next;await applyViewerChange(false);}
    async function viewerZoom(direction){state.viewerFitMode=null;state.viewerScale=Math.min(4,Math.max(.1,state.viewerScale*(direction>0?1.15:1/1.15)));await applyViewerChange(false);}
    async function viewerFit(){state.viewerFitMode='width';await applyViewerChange(true);}
    async function viewerFitPage(){state.viewerFitMode='page';await applyViewerChange(true);}
    async function viewerReset(){state.viewerFitMode='page';await applyViewerChange(true);}
    async function viewerOpenTab(event){consumeDocumentEvent(event);if(!state.viewerDoc)return toast('No hay un PDF activo para abrir.','warning');try{const opened=window.open(await signedUrl(state.viewerDoc),'_blank','noopener');if(opened===null)throw new Error('El navegador bloqueó la nueva pestaña.');}catch(e){toast(documentOpenMessage(state.viewerDoc,e),'danger');}}
    async function viewerDownload(){if(!canEdit()||!state.viewerDoc)return;try{const a=document.createElement('a');a.href=await signedUrl(state.viewerDoc);a.download=state.viewerDoc.nombre_original||'documento.pdf';a.rel='noopener';a.click();}catch(e){toast(documentOpenMessage(state.viewerDoc,e),'danger');}}
    async function reclassifyDocument(docId,bienId){if(!canEdit())return;const doc=(state.docs.get(bienId)||[]).find(d=>d.id===docId);if(!doc)return;const allowed=['Factura','Resguardo','Garantía','Evidencia','Acta','Baja','Mantenimiento','Otro'],answer=prompt(`Nuevo tipo: ${allowed.join(', ')}`,doc.tipo_documento);if(answer===null)return;const next=allowed.find(x=>norm(x)===norm(answer));if(!next)return toast('Tipo documental no válido.','warning');const previous=doc.tipo_documento;if(next===previous)return;try{const sb=await window.ensureSupabaseClient(),result=await sb.from('muebles_bienes_documentos_archivos').update({tipo_documento:next}).eq('id',docId);if(result.error)throw result.error;doc.tipo_documento=next;await window.logHistory?.('RECLASIFICAR_DOCUMENTO','Muebles y Bienes',bienId,{documento:doc.nombre_original,anterior:previous,nuevo:next});openDetail(bienId);toast('Documento reclasificado.');}catch(e){toast(e.message,'danger');}}
    async function reassignDocument(docId,bienId){if(!canEdit())return;const doc=(state.docs.get(bienId)||[]).find(d=>d.id===docId);if(!doc)return;const answer=prompt('Número de serie, folio, número económico, control o ID exacto del bien destino:','');if(answer===null||!answer.trim())return;const value=answer.trim(),key=norm(value),matches=state.all.filter(r=>r.id===value||[r.numero_serie,r.resguardo_folio,r.numero_economico,r.numero_control].some(v=>v&&norm(v)===key));if(matches.length!==1)return toast(matches.length?'El identificador es ambiguo; no se realizó la asociación.':'No se encontró un bien con ese identificador exacto.','warning');const target=matches[0];if(target.id===bienId)return toast('El documento ya pertenece a ese bien.','warning');if(!confirm(`Reasignar ${doc.nombre_original} a ${referenciaBien(target)}?`))return;try{const sb=await window.ensureSupabaseClient(),add=await sb.from('muebles_bienes_documentos').insert({bien_id:target.id,documento_id:doc.id});if(add.error)throw add.error;const remove=await sb.from('muebles_bienes_documentos').delete().eq('bien_id',bienId).eq('documento_id',doc.id);if(remove.error){await sb.from('muebles_bienes_documentos').delete().eq('bien_id',target.id).eq('documento_id',doc.id);throw remove.error;}state.docs.set(bienId,(state.docs.get(bienId)||[]).filter(d=>d.id!==doc.id));state.docs.set(target.id,[...(state.docs.get(target.id)||[]),doc]);await window.logHistory?.('REASIGNAR_DOCUMENTO','Muebles y Bienes',target.id,{documento:doc.nombre_original,origen:bienId,destino:target.id});applyFilters();openDetail(bienId);toast(`Documento reasignado a ${referenciaBien(target)}.`);}catch(e){toast(e.message,'danger');}}
    async function deleteDocument(docId,bienId) { if(!canEdit()||!confirm('¿Desvincular este documento del bien? Si no tiene más relaciones, también se eliminará el archivo.'))return;try{const sb=await window.ensureSupabaseClient(),doc=(state.docs.get(bienId)||[]).find(x=>x.id===docId);if(!doc)throw new Error('Documento no encontrado.');await removeDocumentLink(sb,doc,bienId);invalidateDocumentThumbnail(doc);await window.logHistory?.('ELIMINAR_DOCUMENTO','Muebles y Bienes',bienId,{nombre:doc.nombre_original});state.loaded=false;await load(true);openDetail(bienId);toast('Documento desvinculado.','warning');}catch(e){toast(e.message,'danger');} }

    async function hasPdfHeader(file) { const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());return String.fromCharCode(...bytes)==='%PDF-'; }
    async function sha256(file) { if(!await hasPdfHeader(file))throw new Error(`El archivo ${file.name||''} no contiene una cabecera PDF válida o está dañado.`);const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
    async function verifyStoredPdf(sb,storagePath,expected={}) {
        const downloaded=await sb.storage.from(BUCKET).download(storagePath);
        if(downloaded.error)throw new Error(`El PDF se subió, pero no se pudo verificar en el almacenamiento: ${downloaded.error.message}`);
        const stored=downloaded.data;
        if(!stored?.size)throw new Error('El archivo guardado en el almacenamiento está vacío.');
        if(expected.size&&stored.size!==expected.size)throw new Error(`El tamaño guardado (${stored.size} bytes) no coincide con el archivo seleccionado (${expected.size} bytes).`);
        const storedHash=await sha256(stored);
        if(expected.hash&&storedHash!==expected.hash)throw new Error('El contenido guardado no coincide con el PDF seleccionado.');
        await validateReadablePdf(stored,expected.name||'guardado en el almacenamiento');
        return true;
    }
    function documentTargets(name) {
        const misses=[],folioMatch=name.match(/(?:DO|CA)-CA-(\d{2,4})|CA-EC-(\d{2,4})/i);
        if(folioMatch){
            const folio=folioMatch[1]?`DO/CA/${folioMatch[1]}`:`CA/EC/${folioMatch[2]}`,goods=state.all.filter(r=>norm(r.resguardo_folio)===norm(folio));
            if(goods.length)return{criterion:'folio',value:folio,goods};
            misses.push(`No existe un bien con el folio ${folio}.`);
        }
        const serial=(name.match(/\bC1[A-Z0-9]{6}\b/i)||[])[0];
        if(serial){
            const goods=state.all.filter(r=>norm(r.numero_serie)===norm(serial));
            if(goods.length===1)return{criterion:'serie',value:serial,goods};
            if(goods.length>1)return{criterion:'serie',value:serial,goods:[],reason:`La serie ${serial} coincide con ${goods.length} bienes; se requiere una coincidencia única.`};
            misses.push(`No existe un bien con la serie ${serial}.`);
        }
        return{criterion:null,value:null,goods:[],reason:misses.join(' ')||'El nombre no contiene un folio DO-CA/CA-EC ni una serie reconocible.'};
    }
    function showPendingImports(pending){
        if(!pending.length)return;
        $('mb-import-pending-summary').textContent=`${pending.length} archivo(s) sin asociar`;
        $('mb-import-pending-body').innerHTML=pending.map(item=>`<tr><td class="text-break fw-semibold">${esc(item.file)}</td><td class="text-break">${esc(item.reason)}</td></tr>`).join('');
        bootstrap.Modal.getOrCreateInstance($('mb-import-pending-modal')).show();
    }
    async function existingTargetLinks(sb,docId,goods){
        const ids=[...new Set(goods.map(good=>good.id))];if(!ids.length)return new Set();
        const result=await sb.from('muebles_bienes_documentos').select('bien_id').eq('documento_id',docId).in('bien_id',ids);
        if(result.error)throw result.error;
        return new Set((result.data||[]).map(link=>link.bien_id));
    }
    async function rollbackBulkImport(sb,{doc,storagePath,newBienIds=[],created=false}){
        const failures=[];let canRemoveStorage=!doc?.id;
        if(doc?.id&&newBienIds.length){const unlink=await sb.from('muebles_bienes_documentos').delete().eq('documento_id',doc.id).in('bien_id',newBienIds);if(unlink.error)failures.push(`relaciones: ${unlink.error.message}`);}
        if(created&&doc?.id){const metadata=await sb.from('muebles_bienes_documentos_archivos').delete().eq('id',doc.id);canRemoveStorage=!metadata.error;if(metadata.error)failures.push(`metadatos: ${metadata.error.message}; el archivo físico se conservó para evitar una referencia rota`);}
        if(created&&storagePath&&canRemoveStorage){const stored=await sb.storage.from(BUCKET).remove([storagePath]);if(stored.error)failures.push(`almacenamiento: ${stored.error.message}`);}
        if(failures.length)throw new Error(`No se pudo revertir completamente la importación (${failures.join('; ')}).`);
    }
    async function bulkImportDocuments(files) {
        if(!canEdit()||!files.length)return;
        const button=$('mb-import-pdfs');
        button.disabled=true;
        button.innerHTML='<span class="spinner-border spinner-border-sm me-1"></span>Analizando…';
        const summary={selected:files.length,unique:0,uploaded:0,relationships:0,duplicates:0,pending:[]};
        try{
            const sb=await window.ensureSupabaseClient(),auth=await sb.auth.getUser();
            if(auth.error)throw auth.error;
            const user=auth.data?.user,seenHashes=new Set(),batchDocs=new Map(),verifiedDocs=new Set();
            for(const file of files){
                let doc=null,storagePath=null,createdHere=false,newBienIds=[];
                try{
                    validateFile(file);
                    const hash=await sha256(file);await validateReadablePdf(file);
                    if(!seenHashes.has(hash)){seenHashes.add(hash);summary.unique++;}
                    const target=documentTargets(file.name);
                    if(!target.goods.length)throw new Error(target.reason);

                    doc=batchDocs.get(hash)||null;
                    if(doc){summary.duplicates++;}
                    else{
                        const existing=await sb.from('muebles_bienes_documentos_archivos').select('*').eq('sha256',hash).order('version',{ascending:false}).order('created_at',{ascending:false}).limit(1).maybeSingle();
                        if(existing.error)throw existing.error;
                        doc=existing.data;
                        if(doc)summary.duplicates++;
                        else{
                            const folder=safePath(target.value,80);storagePath=`${folder}/${hash.slice(0,16)}-${safePath(file.name)}`;
                            const uploaded=await sb.storage.from(BUCKET).upload(storagePath,file,{contentType:'application/pdf',upsert:false});
                            if(uploaded.error)throw uploaded.error;
                            await verifyStoredPdf(sb,storagePath,{name:file.name,size:file.size,hash});
                            const created=await sb.from('muebles_bienes_documentos_archivos').insert({tipo_documento:'Resguardo',nombre_original:file.name,storage_path:storagePath,mime_type:'application/pdf',tamano_bytes:file.size,sha256:hash}).select().single();
                            if(created.error)throw created.error;
                            doc=created.data;createdHere=true;verifiedDocs.add(doc.id);
                        }
                    }
                    if(!verifiedDocs.has(doc.id)){await verifyStoredPdf(sb,doc.storage_path,{name:doc.nombre_original||file.name,size:doc.tamano_bytes||file.size,hash:doc.sha256||hash});verifiedDocs.add(doc.id);}

                    const linkedBefore=await existingTargetLinks(sb,doc.id,target.goods),missingGoods=target.goods.filter(good=>!linkedBefore.has(good.id));
                    if(!missingGoods.length){batchDocs.set(hash,doc);continue;}
                    const goodsWithAnotherPdf=missingGoods.filter(good=>(state.docs.get(good.id)||[]).some(current=>current.id!==doc.id));
                    if(goodsWithAnotherPdf.length&&!window.confirm(`${goodsWithAnotherPdf.length} bien(es) ya tienen PDF. Se conservarán sus documentos actuales y se agregará ${file.name}. ¿Continuar?`))throw new Error('Importación cancelada: se conservaron los documentos existentes.');
                    const links=missingGoods.map(good=>({bien_id:good.id,documento_id:doc.id}));
                    const linked=await sb.from('muebles_bienes_documentos').insert(links);
                    if(linked.error)throw linked.error;
                    newBienIds=missingGoods.map(good=>good.id);
                    await insertDocumentHistory(sb,user,'IMPORTAR_DOCUMENTO',newBienIds[0],{bien:missingGoods.map(referenciaBien).join('; '),bienes:newBienIds,archivo:doc.nombre_original||file.name,documento:doc.nombre_original||file.name,tipo:doc.tipo_documento||'Resguardo',reutilizado:!createdHere,nuevo:doc.nombre_original||file.name});
                    newBienIds.forEach(bienId=>{const current=state.docs.get(bienId)||[];if(!current.some(item=>item.id===doc.id))state.docs.set(bienId,[...current,doc]);});
                    batchDocs.set(hash,doc);summary.uploaded+=createdHere?1:0;summary.relationships+=newBienIds.length;
                }catch(error){
                    try{await rollbackBulkImport(sb,{doc,storagePath,newBienIds,created:createdHere||Boolean(storagePath&&!doc)});}
                    catch(recoveryError){console.error('[muebles-bienes] recuperación de importación PDF',recoveryError);summary.pending.push({file:file.name||'Sin nombre',reason:`${error.message} ${recoveryError.message}`});continue;}
                    summary.pending.push({file:file.name||'Sin nombre',reason:error.message});
                }
            }
            state.loaded=false;await load(true);
            const pendingText=summary.pending.length?` ${summary.pending.length} quedaron pendientes.`:'';
            toast(`Importación terminada: ${summary.uploaded} PDF(s), ${summary.relationships} relación(es), ${summary.duplicates} duplicado(s).${pendingText}`,summary.pending.length?'warning':'success');
            showPendingImports(summary.pending);
            console.info('[muebles-bienes] importación PDF',summary);
        }catch(e){
            console.error('[muebles-bienes] importación PDF',e);toast(`Error de importación: ${e.message}`,'danger');
        }finally{
            button.disabled=false;button.innerHTML='<i class="fas fa-file-import me-1"></i>Importar PDFs';$('mb-import-files').value='';
        }
    }
    function safePath(value,maxLength=180){
        const original=String(value||''),extension=(original.match(/\.[a-zA-Z0-9]{1,9}$/)||[])[0]||'';
        let safe=original.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'_').replace(/_+/g,'_').replace(/^[_\.]+|[_\.]+$/g,'');
        if(!safe||safe.toLowerCase()===extension.slice(1).toLowerCase())safe=`archivo${extension}`;
        else if(extension&&!safe.toLowerCase().endsWith(extension.toLowerCase()))safe=`${safe.replace(/[\._]+$/g,'')}${extension}`;
        if(safe.length<=maxLength)return safe;
        const dot=safe.lastIndexOf('.'),finalExtension=dot>0&&safe.length-dot<=10?safe.slice(dot):'',base=finalExtension?safe.slice(0,dot):safe;
        return `${base.slice(0,Math.max(1,maxLength-finalExtension.length))}${finalExtension}`;
    }
    function setUploadState(active,label='') {
        state.uploading=active;
        $('mb-upload-state')?.classList.toggle('d-none',!active);
        if(active&&label)$('mb-upload-label').textContent=label;
        if($('mb-doc-upload'))$('mb-doc-upload').disabled=active;
        if($('mb-doc-cancel'))$('mb-doc-cancel').disabled=active;
    }
    async function rollbackNewDocument(sb,created,storagePath,bienId,linked) {
        if(linked&&created){
            await removeDocumentLink(sb,created,bienId);
            return;
        }
        if(created){
            const removeMeta=await sb.from('muebles_bienes_documentos_archivos').delete().eq('id',created.id);
            if(removeMeta.error)throw removeMeta.error;
        }
        if(storagePath){
            const removeFile=await sb.storage.from(BUCKET).remove([storagePath]);
            if(removeFile.error)throw removeFile.error;
        }
    }
    async function insertDocumentHistory(sb,user,action,bienId,details){
        if(!user?.id)throw new Error('No se pudo identificar al usuario para registrar la auditoría.');
        const result=await sb.from('change_history').insert({user_id:user.id,user_email:user.email||'Usuario',action_type:action,entity_type:'Muebles y Bienes',record_id:bienId,details});
        if(result.error)throw new Error(`No se pudo registrar la auditoría: ${result.error.message}`);
    }
    async function uploadDocumentSafe(options={}) {
        const quick=options.quick===true,bienId=options.bienId||state.editingId,input=quick?$('mb-quick-doc-file'):$('mb-doc-file'),file=options.file||input?.files?.[0],type=(options.type||$('mb-doc-type')?.value||'Documento').trim(),err=$('mb-doc-error'),bien=state.all.find(r=>r.id===bienId),replaceId=quick?null:state.replacingDocId;
        let sb=null,uploadedPath=null,created=null,linked=false,committed=false,succeeded=false,visualStarted=false;
        try {
            if(!canEdit())throw new Error('No tienes permiso de edición para cargar documentos.');
            if(state.uploading)throw new Error('Ya hay una carga en curso.');
            if(!bien)throw new Error('No se identificó el bien destino. Abre la ficha correcta e intenta de nuevo.');
            state.quickUploads.add(bienId);visualStarted=true;setQuickCardState(bienId,'loading');
            validateFile(file);err?.classList.add('d-none');setUploadState(true,`Validando ${file.name}…`);
            const hash=await sha256(file);await validateReadablePdf(file);
            setUploadState(true,`Subiendo ${file.name} a ${bien.familia}…`);
            sb=await window.ensureSupabaseClient();
            const exact=await sb.from('muebles_bienes_documentos_archivos').select('*').eq('sha256',hash).limit(1);if(exact.error)throw exact.error;
            const sameMeta=exact.data?.[0]?exact:await sb.from('muebles_bienes_documentos_archivos').select('*').eq('nombre_original',file.name).eq('tamano_bytes',file.size).limit(1);if(sameMeta.error)throw sameMeta.error;
            const duplicate=sameMeta.data?.[0];let choice=replaceId?'replace':'version';
            if(duplicate){choice=await duplicateDecision(duplicate,duplicate.sha256===hash);if(choice==='cancel')return;}
            const currentDocs=state.docs.get(bienId)||[];
            const selectedPrevious=currentDocs.find(d=>d.id===replaceId);
            const previous=choice==='replace'?(selectedPrevious||currentDocs.find(d=>d.tipo_documento===type)||null):null;
            const storagePath=`${bienId}/${crypto.randomUUID()}-${safePath(file.name)}`;const up=await sb.storage.from(BUCKET).upload(storagePath,file,{contentType:'application/pdf',upsert:false});if(up.error)throw up.error;uploadedPath=storagePath;
            setUploadState(true,`Verificando ${file.name} en el almacenamiento…`);await verifyStoredPdf(sb,storagePath,{name:file.name,size:file.size,hash});
            const userResult=await sb.auth.getUser();if(userResult.error)throw userResult.error;const user=userResult.data?.user,version=Math.max(0,...currentDocs.filter(d=>d.tipo_documento===type).map(d=>Number(d.version)||1))+1;
            const createdResult=await sb.from('muebles_bienes_documentos_archivos').insert({tipo_documento:type,nombre_original:file.name,storage_path:storagePath,mime_type:'application/pdf',tamano_bytes:file.size,sha256:hash,version,uploader_email:user?.email||null}).select().single();
            if(createdResult.error)throw createdResult.error;created=createdResult.data;
            const link=await sb.from('muebles_bienes_documentos').insert({bien_id:bienId,documento_id:created.id});if(link.error)throw link.error;linked=true;
            await insertDocumentHistory(sb,user,previous?'REEMPLAZAR_DOCUMENTO':'AGREGAR_DOCUMENTO',bienId,{bien:referenciaBien(bien),documento:file.name,archivo:file.name,tipo:type,version,anterior:previous?.nombre_original||null,nuevo:file.name});
            committed=true;

            let previousRemoved=false,cleanupWarning=null;
            if(previous){
                try{await removeDocumentLink(sb,previous,bienId);previousRemoved=true;invalidateDocumentThumbnail(previous);}
                catch(cleanupError){cleanupWarning=cleanupError;(cleanupError.recoveryFailed?console.error:console.warn)('[muebles-bienes] retiro seguro del documento anterior',cleanupError);}
            }
            const docs=currentDocs.filter(d=>!(previousRemoved&&d.id===previous.id));
            if(!docs.some(d=>d.id===created.id))docs.push(created);
            state.docs.set(bienId,docs);state.docsLoaded.add(bienId);
            if(!quick)state.replacingDocId=null;input.value='';
            setUploadState(false);
            if(!quick){bootstrap.Modal.getInstance($('mb-doc-modal'))?.hide();bootstrap.Modal.getInstance($('mb-detail-modal'))?.hide();}
            state.quickUploads.delete(bienId);succeeded=true;
            refreshDocumentUI(bienId,quick?'Listo':previousRemoved?'Documento actualizado':previous?'Nueva versión guardada':'PDF agregado',true,!quick);
            if(cleanupWarning?.recoveryFailed)toast('El PDF nuevo quedó guardado y auditado, pero no se pudo confirmar la recuperación del documento anterior. Conserva esta alerta y solicita revisión administrativa.','danger');
            else if(cleanupWarning)toast('El PDF nuevo quedó guardado y auditado; el documento anterior se conservó porque no pudo retirarse de forma segura.','warning');
            else toast(`${previous?'Documento actualizado':'PDF agregado correctamente'} a ${referenciaBien(bien)}: ${file.name}`);
        } catch(e) {
            let message=e.message;
            if(!committed&&sb){
                try{await rollbackNewDocument(sb,created,uploadedPath,bienId,linked);}
                catch(cleanupError){console.error('[muebles-bienes] recuperación de carga fallida',cleanupError);message+=` No se pudo limpiar por completo la carga nueva: ${cleanupError.message}`;}
            }
            setUploadState(false);
            if(committed){if(!quick)bootstrap.Modal.getInstance($('mb-doc-modal'))?.hide();toast(`El PDF quedó guardado, pero la interfaz no terminó de actualizarse: ${message}`,'warning');}
            else if(quick)toast(`No se pudo cargar el PDF: ${message}`,'danger');
            else if(err){err.textContent=message;err.classList.remove('d-none');}
        } finally {
            setUploadState(false);
            if(quick)input.value='';
            if(visualStarted&&!succeeded){state.quickUploads.delete(bienId);setQuickCardState(bienId,'idle');}
        }
    }

    function historyActionLabel(action){
        const labels={AGREGAR_DOCUMENTO:'PDF agregado',IMPORTAR_DOCUMENTO:'PDF importado',REEMPLAZAR_DOCUMENTO:'PDF reemplazado',ELIMINAR_DOCUMENTO:'PDF eliminado',RECLASIFICAR_DOCUMENTO:'PDF reclasificado',REASIGNAR_DOCUMENTO:'PDF reasignado',CREAR:'Bien creado',EDITAR:'Bien editado',ELIMINAR:'Bien eliminado'};
        return labels[action]||String(action||'Modificación').replace(/_/g,' ').toLowerCase().replace(/^./,letter=>letter.toUpperCase());
    }
    function historyFile(details){return details?.archivo||details?.documento||details?.nombre||'—';}
    function historyChangeHTML(details,action){
        if(!details)return '<span class="text-muted">—</span>';
        if(details.mode==='diff'&&Array.isArray(details.changes)&&details.changes.length)return `<div class="vstack gap-1">${details.changes.map(change=>`<div><span class="text-muted">${esc(String(change.field||'Campo').replace(/_/g,' '))}:</span> <span class="text-danger text-decoration-line-through">${esc(change.old??'—')}</span> <i class="fas fa-arrow-right mx-1 text-muted"></i><span class="text-success fw-semibold">${esc(change.new??'—')}</span></div>`).join('')}</div>`;
        const file=historyFile(details);
        if(action==='AGREGAR_DOCUMENTO')return `<span class="text-muted">—</span> <i class="fas fa-arrow-right mx-1"></i><span class="text-success fw-semibold">${esc(file)}</span>`;
        if(action==='ELIMINAR_DOCUMENTO')return `<span class="text-danger text-decoration-line-through">${esc(file)}</span> <i class="fas fa-arrow-right mx-1"></i><span class="text-muted">Eliminado</span>`;
        if(details.anterior!==undefined||details.nuevo!==undefined)return `<span class="text-danger text-decoration-line-through">${esc(details.anterior??'—')}</span> <i class="fas fa-arrow-right mx-1"></i><span class="text-success fw-semibold">${esc(details.nuevo??file)}</span>`;
        if(details.origen!==undefined||details.destino!==undefined)return `<span class="text-danger text-decoration-line-through">${esc(details.origen??'—')}</span> <i class="fas fa-arrow-right mx-1"></i><span class="text-success fw-semibold">${esc(details.destino??'—')}</span>`;
        return `<span class="text-muted">${esc(details.summary||details.bien||'—')}</span>`;
    }
    function historyBien(log){
        const row=state.all.find(item=>item.id===log.record_id),details=log.details&&typeof log.details==='object'?log.details:{};
        return row?referenciaBien(row):details.bien||`ID ${log.record_id||'—'}`;
    }
    function historyRowHTML(log){
        const date=log.created_at?new Date(log.created_at):null,valid=date&&!Number.isNaN(date.getTime()),details=log.details&&typeof log.details==='object'?log.details:{},file=historyFile(details);
        return `<tr><td class="text-nowrap"><div class="fw-semibold">${valid?esc(date.toLocaleDateString('es-MX')):'—'}</div><div class="small text-muted">${valid?esc(date.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})):'—'}</div></td><td class="text-break">${esc(log.user_email||'Usuario')}</td><td>${esc(historyBien(log))}</td><td><span class="badge bg-secondary">${esc(historyActionLabel(log.action_type))}</span></td><td class="text-break">${esc(file)}</td><td class="small">${historyChangeHTML(details,log.action_type)}</td></tr>`;
    }
    async function loadRecentHistory(){
        const body=$('mb-history-body');if(!body)return;
        body.innerHTML='<div class="text-center py-5"><span class="spinner-border text-primary"></span><div class="text-muted mt-2">Cargando modificaciones…</div></div>';
        try{
            if(!canViewHistory())throw new Error('No tienes permiso de auditoría para consultar este historial.');
            const sb=await window.ensureSupabaseClient(),result=await sb.from('change_history').select('created_at,user_email,action_type,record_id,details').eq('entity_type','Muebles y Bienes').order('created_at',{ascending:false}).limit(50);
            if(result.error)throw result.error;
            const logs=result.data||[];
            if(!logs.length){body.innerHTML='<div class="text-center text-muted py-5"><i class="fas fa-history fa-2x mb-2"></i><div>No hay modificaciones registradas.</div></div>';return;}
            body.innerHTML=`<div class="table-responsive"><table class="table table-sm table-hover align-middle"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Bien afectado</th><th>Acción</th><th>Archivo</th><th>Valor anterior y nuevo</th></tr></thead><tbody>${logs.map(historyRowHTML).join('')}</tbody></table></div>`;
        }catch(error){body.innerHTML=`<div class="alert alert-danger mb-0">No se pudieron cargar las últimas modificaciones: ${esc(error.message)}</div>`;}
    }
    function openRecentHistory(){
        if(!canViewHistory())return toast('No tienes permiso de auditoría para consultar este historial.','warning');
        bootstrap.Modal.getOrCreateInstance($('mb-history-modal')).show();loadRecentHistory();
    }

    function exportCSV() { const headers=['familia','descripcion','numero_serie','numero_control','cantidad','area_responsable','numero_economico','resguardo_folio','fecha_resguardo','responsable','vehiculo_ubicacion','observaciones'];const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv='\uFEFF'+[headers.join(','),...state.filtered.map(r=>headers.map(h=>quote(r[h])).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`muebles_bienes_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href); }
    function toast(message,type='success'){const id=`mbt-${Date.now()}`;$('mb-toast')?.insertAdjacentHTML('beforeend',`<div id="${id}" class="toast show text-bg-${type} border-0"><div class="d-flex"><div class="toast-body">${esc(message)}</div><button class="btn-close btn-close-white m-auto me-2" onclick="this.closest('.toast').remove()"></button></div></div>`);setTimeout(()=>$(`${id}`)?.remove(),4500);}

    window.mueblesBienesModule={init:()=>load(),reload:()=>load(true),setView,openDetail,openForm,openDocument,chooseQuickDocument,openPDF,openDocuments,deleteDocument,reclassifyDocument,reassignDocument,previewDocuments,selectPreview,schedulePreviewClose,cancelPreviewClose,closePreview,openViewer,viewerPage,viewerZoom,viewerFit,viewerFitPage,viewerReset,viewerOpenTab,viewerDownload,openRecentHistory,exportCSV,bulkImportDocuments};
    ensureUI();
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',activateOnEntry,{once:true});
    else queueMicrotask(activateOnEntry);
})();
