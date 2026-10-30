// -------------------------------------------------------------------
//  LISTA DE ASISTENCIA - COyH  |  js/coyh-asistencia.js  v5
//  Mejoras: estilo tabla, edicion de directorio (admin/editor)
// -------------------------------------------------------------------

/* -- Helpers ------------------------------------------------------ */
function _coyhSB() { return window.supabaseClient || window._supabase || null; }

function _coyhToast(msg, tipo) {
    tipo = tipo || 'success';
    var colors = { success:'#16a34a', error:'#dc2626', warning:'#d97706', info:'#2563eb' };
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:99999;'
        +'background:'+(colors[tipo]||colors.info)+';color:#fff;padding:10px 22px;border-radius:10px;'
        +'font-size:.84rem;font-weight:600;box-shadow:0 4px 18px rgba(0,0,0,.22);'
        +'max-width:90vw;text-align:center;pointer-events:none';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .35s';
        setTimeout(function(){ t.remove(); }, 380); }, 2600);
}

function _coyhCanEdit() {
    var r = sessionStorage.getItem('user_role') || '';
    return r === 'admin' || r === 'editor';
}

function _escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* -- Estilos CSS (inyectados una vez) ----------------------------- */
function _coyhInjectStyles() {
    if (document.getElementById('_coyh-styles')) return;
    var s = document.createElement('style');
    s.id = '_coyh-styles';
    s.textContent = [
        '#_coyh-body table{border-collapse:collapse;width:100%}',
        '#_coyh-body thead th{background:#0f172a;color:#f8fafc;padding:8px 10px;font-size:.72rem;',
            'font-weight:600;border:1px solid #1e293b;white-space:nowrap;',
            'position:sticky;top:0;z-index:2;box-shadow:inset 0 -2px 0 #334155}',
        '#_coyh-body td{border:1px solid #e2e8f0;padding:5px 10px;vertical-align:middle}',
        '#_coyh-body .coyh-cat-row td{background:#e8edf5!important;color:#334155;',
            'font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;',
            'padding:5px 14px;border-top:2px solid #7c9cbf!important}',
        '#_coyh-body .coyh-dep-cell{border-right:3px solid #94a3b8!important}',
        '#_coyh-body .coyh-conf-cell{border-left:2px solid #cbd5e1!important;text-align:center;padding:6px 8px}',
        '#_coyh-body .coyh-edit-cell{border-right:1px solid #e2e8f0!important;text-align:center;padding:4px 6px}',
        '#_coyh-body tbody tr:not(.coyh-cat-row):hover td{filter:brightness(.96)}',
        '#_coyh-body .coyh-dep-cell{cursor:pointer;user-select:none}',
        '#_coyh-body .coyh-dep-cell:hover .coyh-dep-name{text-decoration:underline;color:#1d4ed8}',
        '#_coyh-body tr.coyh-hl td{background:#eff6ff!important}',
        '#_coyh-body tr.coyh-hl .coyh-dep-cell{background:#dbeafe!important;border-left:3px solid #3b82f6!important}',
        '#_coyh-body .coyh-dep-group.coyh-drag-before tr:first-child td{border-top:2px solid #6366f1!important;position:relative}',
        '#_coyh-body .coyh-dep-group.coyh-dragging{opacity:.35}',
        '.coyh-drag-handle{cursor:grab;color:#94a3b8;display:inline-block;margin-right:5px;line-height:1;user-select:none;-webkit-user-select:none;vertical-align:middle}',
        '.coyh-drag-handle:hover{color:#6366f1}',
        '.coyh-drag-handle:active{cursor:grabbing}',
    ].join('');
    document.head.appendChild(s);
}

/* -- Estado del modal activo -------------------------------------- */
var _coyhData = {
    reunionId:       null,
    sesionLabel:     '',
    fecha:           '',
    participantes:   [],
    confirmaciones:  {},
    asistencia:      {},
};

var _COYH_CAT_LABEL = {
    autoridades:       'Autoridades civiles y militares',
    operadores_aereos: 'Operadores a\u00e9reos',
    prestadores:       'Prestadores de servicios aeroportuarios',
    permisionarios:    'Permisionarios / Socios comerciales',
    otros:             'Otros',
};

/* -------------------------------------------------------------------
   FUNCION PRINCIPAL
-------------------------------------------------------------------*/
async function coyhAbrirAsistencia(reunionId, sesionLabel, fecha) {
    if (!reunionId) { _coyhToast('No se pudo identificar la sesi\u00f3n', 'error'); return; }
    _coyhInjectStyles();

    var prev = document.getElementById('_coyh-modal');
    if (prev) { var inst = bootstrap.Modal.getInstance(prev); if(inst) inst.hide(); prev.remove(); }

    _coyhData = {
        reunionId:      reunionId,
        sesionLabel:    sesionLabel || 'Sesi\u00f3n',
        fecha:          fecha       || '',
        participantes:  [],
        confirmaciones: {},
        asistencia:     {}
    };
    window._coyhActiveTab = 'dir';

    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal fade" id="_coyh-modal" tabindex="-1" style="z-index:1070">'
        +'<div class="modal-dialog modal-fullscreen">'
        +'<div class="modal-content border-0 d-flex flex-column" style="height:100%">'

        +'<div class="modal-header border-0 flex-shrink-0 py-2 px-4"'
        +' style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">'
        +'<div class="flex-grow-1">'
        +'<div style="color:#7dd3fc;font-size:.65rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase">'
        +'<i class="fas fa-users me-1"></i>Comit\u00e9 de Operaci\u00f3n y Horarios \u25c6 COyH</div>'
        +'<h5 class="modal-title fw-bold mb-0 mt-1" style="color:#fff;font-size:.95rem">'
        +(sesionLabel||'Sesi\u00f3n')+' &mdash; '+(fecha||'')+'</h5>'
        +'</div>'
        +'<button type="button" class="btn-close btn-close-white ms-3" data-bs-dismiss="modal"></button>'
        +'</div>'
        +'<div style="height:4px;background:linear-gradient(90deg,#0ea5e9,#4f46e5);flex-shrink:0"></div>'

        +'<div style="background:#f1f5f9;border-bottom:2px solid #e2e8f0;flex-shrink:0" class="px-4 pt-2">'
        +'<ul class="nav nav-tabs border-0 gap-1" id="_coyh-tabs">'
        +'<li class="nav-item"><button class="nav-link active fw-semibold px-4 py-2" id="_coyh-tab-dir"'
        +' style="font-size:.8rem;border-radius:8px 8px 0 0;border:none;background:#fff;border-bottom:2px solid #fff"'
        +' onclick="_coyhSwitchTab(\'dir\')"><i class="fas fa-address-book me-1"></i>Directorio</button></li>'
        +'<li class="nav-item"><button class="nav-link fw-semibold px-4 py-2" id="_coyh-tab-lista"'
        +' style="font-size:.8rem;border-radius:8px 8px 0 0;border:none;background:transparent"'
        +' onclick="_coyhSwitchTab(\'lista\')"><i class="fas fa-clipboard-check me-1"></i>Lista de Asistencia'
        +'<span id="_coyh-badge-conf" class="badge ms-1" style="background:#2563eb;font-size:.6rem"></span>'
        +'</button></li>'
        +'</ul></div>'

        +'<div class="px-4 py-2 d-flex gap-2 flex-wrap align-items-center flex-shrink-0"'
        +' style="background:#f8fafc;border-bottom:1px solid #e5e7eb">'
        +'<div class="flex-grow-1" style="min-width:200px">'
        +'<div class="input-group input-group-sm">'
        +'<span class="input-group-text bg-white border-end-0"><i class="fas fa-search text-muted" style="font-size:.72rem"></i></span>'
        +'<input type="text" id="_coyh-search" class="form-control border-start-0 ps-0"'
        +' placeholder="Buscar por nombre, empresa o cargo\u2026" autocomplete="off"'
        +' oninput="_coyhRenderActivo()">'
        +'</div></div>'
        +'<select id="_coyh-cat-filter" class="form-select form-select-sm" style="width:auto" onchange="_coyhRenderActivo()">'
        +'<option value="all">Todos los grupos</option>'
        +'<option value="autoridades">Autoridades</option>'
        +'<option value="operadores_aereos">Operadores a\u00e9reos</option>'
        +'<option value="prestadores">Prestadores</option>'
        +'<option value="permisionarios">Permisionarios</option>'
        +'<option value="otros">Otros / Invitados</option>'
        +'</select>'
        +'<select id="_coyh-tipo-filter" class="form-select form-select-sm" style="width:auto" onchange="_coyhRenderActivo()">'
        +'<option value="all">Integrantes e Invitados</option>'
        +'<option value="integrante">Solo Integrantes</option>'
        +'<option value="invitado">Solo Invitados</option>'
        +'</select>'
        +'<div id="_coyh-stats" class="d-flex align-items-center gap-2"></div>'
        +'</div>'

        +'<div class="flex-grow-1 overflow-auto p-0"><div id="_coyh-body">'
        +'<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div>'
        +'<p class="text-muted mt-2 small">Cargando directorio\u2026</p></div>'
        +'</div></div>'

        +'<div class="modal-footer border-0 flex-shrink-0 py-2 px-4"'
        +' style="background:#f8fafc;border-top:1px solid #e5e7eb">'
        +'<span class="text-muted small me-auto" id="_coyh-footer-info"></span>'
        +'<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button>'
        +'<div class="btn-group btn-group-sm">'
        +'<button type="button" class="btn btn-sm fw-semibold dropdown-toggle"'
        +' data-bs-toggle="dropdown" aria-expanded="false"'
        +' style="background:#0f172a;color:#fff;border:none;border-radius:8px 0 0 8px">'
        +'<i class="fas fa-print me-1"></i>Imprimir</button>'
        +'<ul class="dropdown-menu dropdown-menu-end">'
        +'<li><a class="dropdown-item" href="#" onclick="_coyhImprimirLista(false);return false">'
        +'<i class="fas fa-users me-2 text-muted" style="width:14px"></i>Todos los confirmados</a></li>'
        +'<li><a class="dropdown-item" href="#" onclick="_coyhImprimirLista(true);return false">'
        +'<i class="fas fa-pen-nib me-2 text-muted" style="width:14px"></i>Solo los que firmaron</a></li>'
        +'</ul></div>'
        +'<div class="btn-group btn-group-sm ms-2">'
        +'<button type="button" class="btn btn-sm fw-semibold dropdown-toggle"'
        +' data-bs-toggle="dropdown" aria-expanded="false"'
        +' style="background:#15803d;color:#fff;border:none;border-radius:8px 0 0 8px">'
        +'<i class="fas fa-file-excel me-1"></i>Excel</button>'
        +'<ul class="dropdown-menu dropdown-menu-end">'
        +'<li><a class="dropdown-item" href="#" onclick="_coyhExportarExcel(false);return false">'
        +'<i class="fas fa-users me-2 text-muted" style="width:14px"></i>Todos los confirmados</a></li>'
        +'<li><a class="dropdown-item" href="#" onclick="_coyhExportarExcel(true);return false">'
        +'<i class="fas fa-pen-nib me-2 text-muted" style="width:14px"></i>Solo los que firmaron</a></li>'
        +'</ul></div>'
        +'<div class="btn-group btn-group-sm ms-2">'
        +'<button type="button" class="btn btn-sm fw-semibold dropdown-toggle"'
        +' data-bs-toggle="dropdown" aria-expanded="false"'
        +' style="background:#1d4ed8;color:#fff;border:none;border-radius:8px 0 0 8px">'
        +'<i class="fas fa-file-word me-1"></i>Word</button>'
        +'<ul class="dropdown-menu dropdown-menu-end">'
        +'<li><a class="dropdown-item" href="#" onclick="_coyhExportarWord(\'blank\');return false">'
        +'<i class="fas fa-pen me-2 text-muted" style="width:14px"></i>Con firmas en blanco</a></li>'
        +'<li><a class="dropdown-item" href="#" onclick="_coyhExportarWord(\'firmas\');return false">'
        +'<i class="fas fa-signature me-2 text-muted" style="width:14px"></i>Con firmas capturadas</a></li>'
        +'</ul></div>'
        +'</div>'
        +'</div></div></div>');

    var bsM = new bootstrap.Modal(document.getElementById('_coyh-modal'), { backdrop: true });
    document.getElementById('_coyh-modal').addEventListener('hidden.bs.modal', function() {
        var el = document.getElementById('_coyh-modal'); if(el) el.remove();
    });
    bsM.show();
    await _coyhCargarDatos(reunionId);
}

/* -- Cambio de pestana -------------------------------------------- */
function _coyhSwitchTab(tab) {
    window._coyhActiveTab = tab;
    ['dir','lista'].forEach(function(t) {
        var btn = document.getElementById('_coyh-tab-'+t);
        if (!btn) return;
        if (t === tab) {
            btn.classList.add('active');
            btn.style.background   = '#fff';
            btn.style.borderBottom = '2px solid #fff';
        } else {
            btn.classList.remove('active');
            btn.style.background   = 'transparent';
            btn.style.borderBottom = '';
        }
    });
    _coyhRenderActivo();
}
window._coyhActiveTab = 'dir';

/* -------------------------------------------------------------------
   CARGA DE DATOS
-------------------------------------------------------------------*/
async function _coyhCargarDatos(reunionId) {
    var sb = _coyhSB();
    if (!sb) { _coyhRenderError('Sin conexi\u00f3n a la base de datos'); return; }
    try {
        var results = await Promise.all([
            sb.from('coyh_participantes')
              .select('id,dependencia,nombre,cargo,tipo,categoria,tipo_lista,num_directorio,telefono,correo,domicilio,horario_atencion,orden')
              .eq('activo', true)
              .order('orden'),
            sb.from('coyh_confirmaciones')
              .select('id,participante_id,confirmado,confirmado_at')
              .eq('reunion_id', reunionId),
            sb.from('coyh_asistencia')
              .select('id,participante_id,firmado,firmado_at,firma_imagen')
              .eq('reunion_id', reunionId),
        ]);
        var rPart = results[0]; var rConf = results[1]; var rAsist = results[2];
        if (rPart.error)  throw rPart.error;
        if (rConf.error)  throw rConf.error;
        if (rAsist.error) throw rAsist.error;

        _coyhData.participantes = rPart.data || [];
        _coyhData.confirmaciones = {};
        (rConf.data || []).forEach(function(c){ _coyhData.confirmaciones[c.participante_id] = c; });
        _coyhData.asistencia = {};
        (rAsist.data || []).forEach(function(a){ _coyhData.asistencia[a.participante_id] = a; });

        _coyhRenderActivo();
    } catch(err) {
        console.error('[COyH] Error cargando datos:', err);
        _coyhRenderError('Error al cargar: '+(err.message||'desconocido'));
    }
}

function _coyhRenderActivo() {
    if (window._coyhActiveTab === 'lista') _coyhRenderLista();
    else                                    _coyhRenderDirectorio();
}

function _coyhUpdateStats(html) {
    var el = document.getElementById('_coyh-stats');
    if (el) el.innerHTML = html;
}

/* -------------------------------------------------------------------
   TAB 1 - DIRECTORIO
   Confirmacion por empresa (rowspan) + edicion por miembro (admin/editor)
-------------------------------------------------------------------*/
function _coyhRenderDirectorio() {
    var body = document.getElementById('_coyh-body');
    if (!body) return;

    var busqueda = (document.getElementById('_coyh-search') && document.getElementById('_coyh-search').value || '').toLowerCase();
    var catF     = (document.getElementById('_coyh-cat-filter')  && document.getElementById('_coyh-cat-filter').value)  || 'all';
    var tipoF    = (document.getElementById('_coyh-tipo-filter') && document.getElementById('_coyh-tipo-filter').value) || 'all';
    var conf     = _coyhData.confirmaciones;
    var canEdit  = _coyhCanEdit();
    var colCount = canEdit ? 9 : 8;

    var rows = _coyhData.participantes.filter(function(p) {
        if (catF  !== 'all' && p.categoria  !== catF)  return false;
        if (tipoF !== 'all' && p.tipo_lista !== tipoF)  return false;
        if (busqueda) {
            var hay = [p.dependencia, p.nombre, p.cargo].join(' ').toLowerCase();
            if (hay.indexOf(busqueda) === -1) return false;
        }
        return true;
    });

    /* Contar por dependencia (no por persona) */
    var depMap = {};
    _coyhData.participantes.forEach(function(p) {
        if (!depMap[p.dependencia]) depMap[p.dependencia] = false;
        if (conf[p.id] && conf[p.id].confirmado) depMap[p.dependencia] = true;
    });
    var totalDeps     = Object.keys(depMap).length;
    var totalConfDeps = Object.values(depMap).filter(Boolean).length;
    /* Deps visibles en la vista filtrada */
    var visibleDeps = {};
    rows.forEach(function(p){ visibleDeps[p.dependencia] = true; });
    var visibleDepsCount = Object.keys(visibleDeps).length;

    var badgeEl = document.getElementById('_coyh-badge-conf');
    if (badgeEl) badgeEl.textContent = totalConfDeps > 0 ? totalConfDeps+' confirmados' : '';
    _coyhUpdateStats('<span style="font-size:.73rem;color:#374151"><span style="font-weight:700;color:#2563eb">'+totalConfDeps+'</span><span class="text-muted"> / '+totalDeps+' dependencias confirmaron</span></span>');
    var footerEl = document.getElementById('_coyh-footer-info');
    if (footerEl) footerEl.textContent = 'Mostrando '+visibleDepsCount+' de '+totalDeps+' dependencias';

    if (!rows.length) {
        body.innerHTML = '<div class="text-center py-5 text-muted"><i class="fas fa-search fa-2x mb-3 d-block opacity-25"></i>Sin resultados.</div>';
        return;
    }

    /* Agrupar: categoria -> dependencia -> [miembros] */
    var grupos = {};
    rows.forEach(function(p) {
        var catKey = p.tipo_lista === 'invitado' ? '__invitados' : (p.categoria || 'otros');
        if (!grupos[catKey]) grupos[catKey] = {};
        if (!grupos[catKey][p.dependencia]) grupos[catKey][p.dependencia] = [];
        grupos[catKey][p.dependencia].push(p);
    });

    var catOrder = ['autoridades','operadores_aereos','prestadores','permisionarios','otros','__invitados'];

    var html = '<table class="table table-sm mb-0">'
        +'<thead><tr>'
        +'<th style="width:28px;text-align:center">#</th>'
        +'<th style="min-width:190px">Empresa / Dependencia</th>'
        +'<th style="min-width:160px">Representante</th>'
        +'<th>Cargo</th>'
        +'<th style="width:72px;text-align:center">Tipo</th>'
        +'<th style="width:42px;text-align:center">Tel.</th>'
        +'<th style="min-width:160px">Correo</th>'
        +(canEdit ? '<th style="width:36px"></th>' : '')
        +'<th style="width:152px;text-align:center">Confirmar asistencia</th>'
        +'</tr></thead>';

    var companyIdx = 1;
    catOrder.forEach(function(cat) {
        if (!grupos[cat]) return;

        var catLabel = cat === '__invitados'
            ? '<i class="fas fa-user-clock me-2" style="opacity:.6"></i>INVITADOS 2026'
            : '<i class="fas fa-layer-group me-2" style="opacity:.6"></i>'+(_COYH_CAT_LABEL[cat]||cat).toUpperCase();
        html += '<tbody class="coyh-cat-hdr" data-cat="'+cat+'">'
            +'<tr class="coyh-cat-row"><td colspan="'+colCount+'">'+catLabel+'</td></tr>'
            +'</tbody>';

        var depList = Object.keys(grupos[cat]);
        // Ordenar: usar campo "orden" de los datos (guardado en Supabase) como fuente principal
        // Fallback a localStorage si el campo orden no está disponible en los datos
        var _dOrd = _coyhLoadDepOrder();
        depList.sort(function(a, b) {
            var memberA = grupos[cat][a][0];
            var memberB = grupos[cat][b][0];
            var oa = memberA && memberA.orden != null ? memberA.orden : null;
            var ob = memberB && memberB.orden != null ? memberB.orden : null;
            // Si ambos tienen orden en DB, usar ese
            if (oa != null && ob != null) return oa - ob;
            // Si solo uno tiene orden en DB, ese va primero
            if (oa != null) return -1;
            if (ob != null) return  1;
            // Fallback: localStorage
            if (_dOrd && _dOrd.length) {
                var ia = _dOrd.indexOf(a), ib = _dOrd.indexOf(b);
                return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
            }
            return 0;
        });
        depList.forEach(function(dep) {
            var members  = grupos[cat][dep];
            var rowspan  = members.length;
            var allConf  = members.every(function(p){ return conf[p.id] && conf[p.id].confirmado; });
            var someConf = members.some(function(p){  return conf[p.id] && conf[p.id].confirmado; });
            var isInvitado = members[0].tipo_lista === 'invitado';

            /* Fondo de grupo */
            var groupBg  = allConf  ? '#f0fdf4'
                         : someConf ? '#fefce8'
                         : (companyIdx % 2 === 0 ? '#f8fafc' : '#ffffff');

            /* Boton de confirmacion por empresa */
            var escDep = _escHtml(dep);
            var btnHtml;
            if (allConf) {
                btnHtml = '<button class="btn btn-sm" data-dep="'+escDep+'"'
                    +' style="font-size:.62rem;padding:3px 9px;border-radius:7px;'
                    +'background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;white-space:nowrap"'
                    +' onclick="_coyhToggleConfEmpresa(this.dataset.dep,false)">'
                    +'<i class="fas fa-check me-1"></i>Presente</button>';
            } else if (someConf) {
                btnHtml = '<button class="btn btn-sm" data-dep="'+escDep+'"'
                    +' style="font-size:.62rem;padding:3px 9px;border-radius:7px;'
                    +'background:#fef3c7;color:#92400e;border:1px solid #fde68a;white-space:nowrap"'
                    +' onclick="_coyhToggleConfEmpresa(this.dataset.dep,true)">'
                    +'<i class="fas fa-users me-1"></i>Confirmar todos</button>';
            } else {
                btnHtml = '<button class="btn btn-sm" data-dep="'+escDep+'"'
                    +' style="font-size:.62rem;padding:3px 9px;border-radius:7px;'
                    +'background:#0f172a;color:#fff;border:none;white-space:nowrap"'
                    +' onclick="_coyhToggleConfEmpresa(this.dataset.dep,true)">'
                    +'<i class="fas fa-user-check me-1"></i>Confirmar</button>';
            }

            html += '<tbody class="coyh-dep-group" data-dep="'+escDep+'" data-cat="'+cat+'">';
            members.forEach(function(p, i) {
                var isFirst = i === 0;
                var bg      = 'background:'+groupBg;
                var escDepAttr = _escHtml(dep);

                var telHtml = p.telefono
                    ? '<a href="tel:'+p.telefono.replace(/\s/g,'')+'"'
                      +' style="font-size:.67rem;color:#2563eb" title="'+_escHtml(p.telefono)+'">'
                      +'<i class="fas fa-phone"></i></a>'
                    : '<span style="color:#d1d5db;font-size:.65rem">\u2014</span>';

                html += '<tr data-dep="'+escDepAttr+'">';

                /* # (rowspan, primera fila) */
                if (isFirst) {
                    html += '<td rowspan="'+rowspan+'" style="'+bg+';text-align:center;color:#94a3b8;'
                        +'font-size:.69rem;font-weight:600;vertical-align:middle">'+companyIdx+'</td>';
                }

                /* Empresa (rowspan, primera fila) */
                if (isFirst) {
                    html += '<td rowspan="'+rowspan+'" class="coyh-dep-cell" data-dep="'+escDepAttr+'"'
                        +' style="'+bg+';vertical-align:middle;padding:8px 10px"'
                        +' onclick="_coyhResaltarDep(this.dataset.dep)" title="click para resaltar">'
                        +'<span class="coyh-drag-handle" onclick="event.stopPropagation()" title="Arrastrar para reordenar"><i class="fas fa-grip-vertical" style="pointer-events:none"></i></span>'
                        +'<span class="coyh-dep-name" style="font-size:.77rem;line-height:1.4">'+_escHtml(dep)+'</span>'
                        +(isInvitado?'<br><span class="badge mt-1" style="font-size:.55rem;background:#fef3c7;color:#92400e">Invitado</span>':'')
                        +'</td>';
                }

                /* Representante */
                html += '<td style="'+bg+';font-size:.77rem">'+_escHtml(p.nombre)+'</td>';

                /* Cargo */
                html += '<td style="'+bg+';font-size:.73rem;color:#374151">'+_escHtml(p.cargo||'\u2014')+'</td>';

                /* Tipo */
                html += '<td style="'+bg+';text-align:center">'
                    +'<span class="badge" style="font-size:.6rem;background:'
                    +(p.tipo==='titular'?'#dbeafe':'#f3f4f6')
                    +';color:'+(p.tipo==='titular'?'#1e40af':'#4b5563')+'">'
                    +(p.tipo==='titular'?'Titular':'Suplente')+'</span></td>';

                /* Tel */
                html += '<td style="'+bg+';text-align:center">'+telHtml+'</td>';

                /* Correo */
                var correoHtml = p.correo
                    ? '<a href="mailto:'+_escHtml(p.correo)+'" style="font-size:.69rem;color:#2563eb;word-break:break-all"'
                      +' title="'+_escHtml(p.correo)+'"><i class="fas fa-envelope me-1" style="opacity:.55"></i>'
                      +_escHtml(p.correo)+'</a>'
                    : '<span style="color:#d1d5db;font-size:.65rem">\u2014</span>';
                html += '<td style="'+bg+';font-size:.7rem">'+correoHtml+'</td>';

                /* Editar (solo admin/editor, por miembro) */
                if (canEdit) {
                    html += '<td class="coyh-edit-cell" style="'+bg+'">'
                        +'<button class="btn btn-link btn-sm p-0" title="Editar"'
                        +' style="color:#64748b;font-size:.75rem;line-height:1"'
                        +' onclick="_coyhEditarParticipante(\''+p.id+'\')">'
                        +'<i class="fas fa-pen"></i></button></td>';
                }

                /* Confirmar (rowspan, primera fila) */
                if (isFirst) {
                    html += '<td rowspan="'+rowspan+'" class="coyh-conf-cell" style="'+bg+';vertical-align:middle">'+btnHtml+'</td>';
                }

                html += '</tr>';
            });

            html += '</tbody>';
            companyIdx++;
        });
    });

    html += '</table>';
    body.innerHTML = html;
    _coyhInitDragDrop();
}

/* -------------------------------------------------------------------
   TAB 2 - LISTA DE ASISTENCIA
-------------------------------------------------------------------*/
function _coyhRenderLista() {
    var body = document.getElementById('_coyh-body');
    if (!body) return;

    var busqueda = (document.getElementById('_coyh-search') && document.getElementById('_coyh-search').value || '').toLowerCase();
    var catF     = (document.getElementById('_coyh-cat-filter')  && document.getElementById('_coyh-cat-filter').value)  || 'all';
    var tipoF    = (document.getElementById('_coyh-tipo-filter') && document.getElementById('_coyh-tipo-filter').value) || 'all';
    var conf     = _coyhData.confirmaciones;
    var asist    = _coyhData.asistencia;

    var rows = _coyhData.participantes.filter(function(p) {
        if (!conf[p.id] || !conf[p.id].confirmado) return false;
        if (catF  !== 'all' && p.categoria  !== catF)  return false;
        if (tipoF !== 'all' && p.tipo_lista !== tipoF)  return false;
        if (busqueda) {
            var hay = [p.dependencia, p.nombre, p.cargo].join(' ').toLowerCase();
            if (hay.indexOf(busqueda) === -1) return false;
        }
        return true;
    });

    /* Contar por dependencia (no por persona) */
    var depStats = {};
    rows.forEach(function(p) {
        if (!depStats[p.dependencia]) depStats[p.dependencia] = false;
        if (asist[p.id] && asist[p.id].firmado) depStats[p.dependencia] = true;
    });
    var total    = Object.keys(depStats).length;
    var firmados = Object.values(depStats).filter(Boolean).length;
    var pct      = total > 0 ? Math.round(firmados/total*100) : 0;

    _coyhUpdateStats(
        '<span style="font-size:.73rem;color:#374151">'
        +'<span style="font-weight:700;color:#16a34a;font-size:.85rem">'+firmados+'</span>'
        +'<span class="text-muted"> / '+total+' firmaron</span></span>'
        +'<div style="width:120px"><div style="height:6px;background:#e5e7eb;border-radius:99px;overflow:hidden">'
        +'<div style="height:100%;width:'+pct+'%;background:'+(pct===100?'#16a34a':'#2563eb')
        +';border-radius:99px;transition:width .4s"></div></div></div>'
        +'<span style="font-size:.72rem;color:'+(pct===100?'#16a34a':'#6b7280')+';font-weight:600">'+pct+'%</span>'
        +(pct===100?'<span class="badge" style="background:#dcfce7;color:#15803d;font-size:.63rem">Lista completa</span>':'')
    );
    var footerEl = document.getElementById('_coyh-footer-info');
    if (footerEl) footerEl.textContent = total+' dependencias \u2014 '+firmados+' firmaron';

    if (!rows.length) {
        body.innerHTML = '<div class="text-center py-5 text-muted">'
            +'<i class="fas fa-user-clock fa-2x mb-3 d-block opacity-25"></i>'
            +'<p class="mb-1">Sin asistentes confirmados para esta sesi\u00f3n.</p>'
            +'<p class="small">Ve a la pesta\u00f1a <strong>Directorio</strong> y confirma qui\u00e9n asistir\u00e1.</p>'
            +'</div>';
        return;
    }

    var grupos = {};
    rows.forEach(function(p) {
        var key = p.tipo_lista === 'invitado' ? '__invitados' : (p.categoria || 'otros');
        if (!grupos[key]) grupos[key] = {};
        if (!grupos[key][p.dependencia]) grupos[key][p.dependencia] = [];
        grupos[key][p.dependencia].push(p);
    });

    var catOrder = ['autoridades','operadores_aereos','prestadores','permisionarios','otros','__invitados'];

    var html = '<table class="table table-sm mb-0">'
        +'<thead><tr>'
        +'<th style="width:28px;text-align:center">#</th>'
        +'<th>Empresa / Dependencia</th><th>Representante</th><th>Cargo</th>'
        +'<th style="width:68px;text-align:center">Tipo</th>'
        +'<th style="width:130px;text-align:center">Firma</th>'
        +'</tr></thead><tbody>';

    var depIdx = 1;
    catOrder.forEach(function(cat) {
        if (!grupos[cat] || !Object.keys(grupos[cat]).length) return;
        var catLabel = cat === '__invitados'
            ? '<i class="fas fa-user-clock me-2" style="opacity:.6"></i>INVITADOS'
            : '<i class="fas fa-layer-group me-2" style="opacity:.6"></i>'+(_COYH_CAT_LABEL[cat]||cat).toUpperCase();
        html += '<tr class="coyh-cat-row"><td colspan="6">'+catLabel+'</td></tr>';

        // Ordenar dependencias igual que el directorio (campo orden del primer miembro)
        var depList = Object.keys(grupos[cat]);
        depList.sort(function(a, b) {
            var oa = grupos[cat][a][0] && grupos[cat][a][0].orden != null ? grupos[cat][a][0].orden : 9999;
            var ob = grupos[cat][b][0] && grupos[cat][b][0].orden != null ? grupos[cat][b][0].orden : 9999;
            return oa - ob;
        });

        depList.forEach(function(dep) {
            var members = grupos[cat][dep];
            var rowspan = members.length;
            // Color de fondo del grupo: verde si todos firmaron, alterno si no
            var algunFirmado = members.some(function(p){ return asist[p.id] && asist[p.id].firmado; });
            var groupBg = algunFirmado ? '#f0fdf4' : (depIdx % 2 === 0 ? '#f8fafc' : '#ffffff');

            members.forEach(function(p, i) {
                var aRec    = asist[p.id];
                var firmado = aRec && aRec.firmado === true;
                var bg      = 'background:' + groupBg;
                var hora    = (firmado && aRec.firmado_at)
                    ? new Date(aRec.firmado_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
                    : null;

                var firmaCell;
                if (firmado) {
                    if (aRec.firma_imagen) {
                        firmaCell = '<img src="'+aRec.firma_imagen+'" alt="firma"'
                            +' style="max-width:110px;max-height:42px;border:1px solid #bbf7d0;'
                            +'border-radius:6px;background:#fff;padding:2px;cursor:pointer"'
                            +' onclick="_coyhVerFirma(\''+p.id+'\')">';
                    } else {
                        firmaCell = '<span class="badge" style="background:#dcfce7;color:#15803d;font-size:.67rem">'
                            +'<i class="fas fa-check me-1"></i>Presente</span>';
                    }
                } else {
                    firmaCell = '<button class="btn btn-sm fw-semibold"'
                        +' style="font-size:.65rem;padding:3px 10px;border-radius:7px;'
                        +'background:#0f172a;color:#fff;border:none;white-space:nowrap"'
                        +' onclick="_coyhAbrirPad(\''+p.id+'\')">'
                        +'<i class="fas fa-signature me-1"></i>Firmar</button>';
                }

                html += '<tr id="_coyh-row-'+p.id+'">';

                // Columna # — solo en la primera fila del grupo, con rowspan
                if (i === 0) {
                    html += '<td rowspan="'+rowspan+'" style="'+bg+';text-align:center;color:#94a3b8;'
                        +'font-size:.69rem;font-weight:600;vertical-align:middle">'+depIdx+'</td>';
                }

                // Columna Empresa — solo en la primera fila del grupo, con rowspan
                if (i === 0) {
                    html += '<td rowspan="'+rowspan+'" style="'+bg+';font-weight:600;font-size:.77rem;'
                        +'vertical-align:middle;padding:8px 10px">'+_escHtml(dep)+'</td>';
                }

                // Representante
                html += '<td style="'+bg+';font-size:.77rem'+(firmado?';font-weight:600':'')+'">'
                    +_escHtml(p.nombre)
                    +(firmado&&hora?'<br><span class="text-muted" style="font-size:.62rem">'
                    +'<i class="fas fa-check-circle text-success me-1"></i>Firm\u00f3 a las '+hora+'</span>':'')
                    +'</td>';

                // Cargo
                html += '<td style="'+bg+';font-size:.73rem;color:#374151">'+_escHtml(p.cargo||'\u2014')+'</td>';

                // Tipo
                html += '<td style="'+bg+';text-align:center"><span class="badge" style="font-size:.6rem;'
                    +'background:'+(p.tipo==='titular'?'#dbeafe':'#f3f4f6')
                    +';color:'+(p.tipo==='titular'?'#1e40af':'#4b5563')+'">'
                    +(p.tipo==='titular'?'Titular':'Suplente')+'</span></td>';

                // Firma
                html += '<td style="'+bg+';text-align:center;min-width:130px">'+firmaCell+'</td>';

                html += '</tr>';
            });

            depIdx++;
        });
    });

    html += '</tbody></table>';
    body.innerHTML = html;
}

/* -------------------------------------------------------------------
   CONFIRMAR / QUITAR ASISTENCIA POR EMPRESA (todos sus miembros)
-------------------------------------------------------------------*/
async function _coyhToggleConfEmpresa(dependencia, confirmar) {
    var sb = _coyhSB();
    if (!sb) { _coyhToast('Sin conexi\u00f3n', 'error'); return; }
    var parts = _coyhData.participantes.filter(function(p){ return p.dependencia === dependencia; });
    if (!parts.length) return;

    try {
        if (confirmar) {
            var authRes = await sb.auth.getUser();
            var userId  = authRes && authRes.data && authRes.data.user ? authRes.data.user.id : null;
            var now     = new Date().toISOString();
            var upserts = parts.map(function(p) {
                return { reunion_id: _coyhData.reunionId, participante_id: p.id,
                         confirmado: true, confirmado_at: now, confirmado_por: userId };
            });
            var res = await sb.from('coyh_confirmaciones')
                .upsert(upserts, { onConflict: 'reunion_id,participante_id' })
                .select('id,participante_id,confirmado,confirmado_at');
            if (res.error) throw res.error;
            (res.data || []).forEach(function(c){ _coyhData.confirmaciones[c.participante_id] = c; });
            _coyhToast(dependencia+' \u2014 confirmado', 'success');
        } else {
            var ids = parts
                .map(function(p){ return _coyhData.confirmaciones[p.id]; })
                .filter(Boolean).map(function(c){ return c.id; });
            if (ids.length) {
                var del = await sb.from('coyh_confirmaciones').delete().in('id', ids);
                if (del.error) throw del.error;
            }
            parts.forEach(function(p){ delete _coyhData.confirmaciones[p.id]; });
            _coyhToast(dependencia+' \u2014 confirmaci\u00f3n retirada', 'info');
        }
        var totalConf = Object.values(_coyhData.confirmaciones).filter(function(c){ return c.confirmado; }).length;
        var badgeEl = document.getElementById('_coyh-badge-conf');
        if (badgeEl) badgeEl.textContent = totalConf > 0 ? totalConf+' confirmados' : '';
        _coyhRenderActivo();
    } catch(err) {
        console.error('[COyH] Error confirmar empresa:', err);
        _coyhToast('Error: '+(err.message||''), 'error');
    }
}

/* -------------------------------------------------------------------
   EDICION DE PARTICIPANTE (solo admin/editor)
-------------------------------------------------------------------*/
function _coyhEditarParticipante(participanteId) {
    if (!_coyhCanEdit()) { _coyhToast('Sin permisos para editar', 'error'); return; }
    var p = _coyhData.participantes.find(function(x){ return x.id === participanteId; });
    if (!p) return;

    var prev = document.getElementById('_coyh-edit-modal');
    if (prev) { var bi=bootstrap.Modal.getInstance(prev); if(bi) bi.hide(); prev.remove(); }

    var catOptions = [
        { v:'autoridades',       l:'Autoridades civiles y militares' },
        { v:'operadores_aereos', l:'Operadores a\u00e9reos' },
        { v:'prestadores',       l:'Prestadores de servicios' },
        { v:'permisionarios',    l:'Permisionarios / Socios comerciales' },
        { v:'otros',             l:'Otros' },
    ].map(function(o){
        return '<option value="'+o.v+'"'+(p.categoria===o.v?' selected':'')+'>'+o.l+'</option>';
    }).join('');

    var fld = function(id, label, val, type) {
        type = type || 'text';
        return '<div class="col-12"><label class="form-label mb-1" style="font-size:.71rem;font-weight:600;color:#374151">'+label+'</label>'
            +'<input type="'+type+'" id="'+id+'" class="form-control form-control-sm" value="'+_escHtml(val||'')+'"></div>';
    };

    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal fade" id="_coyh-edit-modal" tabindex="-1" style="z-index:1085">'
        +'<div class="modal-dialog modal-dialog-centered" style="max-width:540px">'
        +'<div class="modal-content border-0" style="border-radius:14px;overflow:hidden">'
        +'<div class="modal-header py-2 px-4 border-0" style="background:#0f172a">'
        +'<div class="flex-grow-1">'
        +'<div style="color:#7dd3fc;font-size:.63rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase">'
        +'<i class="fas fa-pen me-1"></i>Editar participante</div>'
        +'<h6 class="modal-title fw-bold mb-0 mt-1" style="color:#fff;font-size:.87rem;line-height:1.3">'+_escHtml(p.nombre)+'</h6>'
        +'<div style="color:#94a3b8;font-size:.7rem">'+_escHtml(p.dependencia)+'</div>'
        +'</div>'
        +'<button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="modal"></button>'
        +'</div>'
        +'<div class="modal-body p-4">'
        +'<div class="row g-2">'
        +fld('_coyh-e-dep',   'Empresa / Dependencia',   p.dependencia)
        +fld('_coyh-e-nom',   'Nombre completo',          p.nombre)
        +fld('_coyh-e-cargo', 'Cargo',                    p.cargo)
        +'<div class="col-6"><label class="form-label mb-1" style="font-size:.71rem;font-weight:600;color:#374151">Tipo</label>'
        +'<select id="_coyh-e-tipo" class="form-select form-select-sm">'
        +'<option value="titular"'+(p.tipo==='titular'?' selected':'')+'>Titular</option>'
        +'<option value="suplente"'+(p.tipo==='suplente'?' selected':'')+'>Suplente</option>'
        +'</select></div>'
        +'<div class="col-6"><label class="form-label mb-1" style="font-size:.71rem;font-weight:600;color:#374151">Tipo lista</label>'
        +'<select id="_coyh-e-tlista" class="form-select form-select-sm">'
        +'<option value="integrante"'+(p.tipo_lista==='integrante'?' selected':'')+'>Integrante</option>'
        +'<option value="invitado"'+(p.tipo_lista==='invitado'?' selected':'')+'>Invitado</option>'
        +'</select></div>'
        +'<div class="col-12"><label class="form-label mb-1" style="font-size:.71rem;font-weight:600;color:#374151">Categor\u00eda</label>'
        +'<select id="_coyh-e-cat" class="form-select form-select-sm">'+catOptions+'</select></div>'
        +fld('_coyh-e-tel',    'Tel\u00e9fono',           p.telefono)
        +fld('_coyh-e-correo', 'Correo electr\u00f3nico', p.correo, 'email')
        +'</div>'
        +'</div>'
        +'<div class="modal-footer border-0 px-4 pt-0 pb-3">'
        +'<button type="button" class="btn btn-sm btn-outline-danger me-auto" style="font-size:.73rem"'
        +' onclick="_coyhEliminarParticipante(\''+participanteId+'\')">'
        +'<i class="fas fa-trash me-1"></i>Eliminar del directorio</button>'
        +'<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>'
        +'<button type="button" class="btn btn-sm fw-semibold" id="_coyh-e-save"'
        +' style="background:#0f172a;color:#fff;border:none;border-radius:8px;padding:5px 16px"'
        +' onclick="_coyhGuardarEdicion(\''+participanteId+'\')">'
        +'<i class="fas fa-save me-1"></i>Guardar cambios</button>'
        +'</div></div></div></div>');

    var editModal = document.getElementById('_coyh-edit-modal');
    var bsEdit = new bootstrap.Modal(editModal, { backdrop: false });
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1084';
    overlay.onclick = function(){ bsEdit.hide(); };
    document.body.appendChild(overlay);
    editModal.addEventListener('hidden.bs.modal', function(){ overlay.remove(); editModal.remove(); }, { once: true });
    bsEdit.show();
}

async function _coyhGuardarEdicion(participanteId) {
    var sb = _coyhSB();
    if (!sb) { _coyhToast('Sin conexi\u00f3n', 'error'); return; }

    var dep    = document.getElementById('_coyh-e-dep').value.trim();
    var nom    = document.getElementById('_coyh-e-nom').value.trim();
    var cargo  = document.getElementById('_coyh-e-cargo').value.trim();
    var tipo   = document.getElementById('_coyh-e-tipo').value;
    var tlista = document.getElementById('_coyh-e-tlista').value;
    var cat    = document.getElementById('_coyh-e-cat').value;
    var tel    = document.getElementById('_coyh-e-tel').value.trim();
    var correo = document.getElementById('_coyh-e-correo').value.trim();

    if (!dep || !nom) { _coyhToast('Empresa y nombre son requeridos', 'warning'); return; }

    var btn = document.getElementById('_coyh-e-save');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin me-1"></i>Guardando\u2026'; }

    try {
        var res = await sb.from('coyh_participantes').update({
            dependencia: dep,
            nombre:      nom,
            cargo:       cargo,
            tipo:        tipo,
            tipo_lista:  tlista,
            categoria:   cat,
            telefono:    tel    || null,
            correo:      correo || null,
            updated_at:  new Date().toISOString(),
        }).eq('id', participanteId).select('*').single();
        if (res.error) throw res.error;

        var idx = _coyhData.participantes.findIndex(function(x){ return x.id === participanteId; });
        if (idx !== -1) _coyhData.participantes[idx] = Object.assign(_coyhData.participantes[idx], res.data);

        var editModal = document.getElementById('_coyh-edit-modal');
        if (editModal) { var m=bootstrap.Modal.getInstance(editModal); if(m) m.hide(); }

        _coyhRenderActivo();
        _coyhToast('Cambios guardados correctamente', 'success');
    } catch(err) {
        console.error('[COyH] Error al guardar:', err);
        _coyhToast('Error: '+(err.message||'sin permisos'), 'error');
        if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-save me-1"></i>Guardar cambios'; }
    }
}

async function _coyhEliminarParticipante(participanteId) {
    var p = _coyhData.participantes.find(function(x){ return x.id === participanteId; });
    if (!p) return;
    if (!confirm('\u00bfEliminar a '+p.nombre+' del directorio?\nNo aparecer\u00e1 en futuras sesiones.')) return;

    var sb = _coyhSB();
    if (!sb) { _coyhToast('Sin conexi\u00f3n', 'error'); return; }
    try {
        var res = await sb.from('coyh_participantes').update({ activo: false }).eq('id', participanteId);
        if (res.error) throw res.error;

        _coyhData.participantes = _coyhData.participantes.filter(function(x){ return x.id !== participanteId; });

        var editModal = document.getElementById('_coyh-edit-modal');
        if (editModal) { var m=bootstrap.Modal.getInstance(editModal); if(m) m.hide(); }

        _coyhRenderActivo();
        _coyhToast(p.nombre+' eliminado del directorio', 'info');
    } catch(err) {
        console.error('[COyH] Error al eliminar:', err);
        _coyhToast('Error: '+(err.message||'sin permisos'), 'error');
    }
}

/* -------------------------------------------------------------------
   DRAG & DROP — REORDENAR EMPRESAS
-------------------------------------------------------------------*/
var _coyhDragDep = null;

function _coyhLoadDepOrder() {
    try {
        var s = localStorage.getItem('coyh_dep_order');
        return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
}

function _coyhSaveDepOrder() {
    var tbl = document.querySelector('#_coyh-body table');
    if (!tbl) return;

    // Recorrer TODOS los tbody en orden DOM para conocer la categoría visual
    // de cada dep-group (la última coyh-cat-hdr vista define la categoría actual)
    var allTbodies  = tbl.querySelectorAll('tbody');
    var currentCat  = null;
    var order = [];   // [{ dep, cat }]

    allTbodies.forEach(function(tb) {
        if (tb.classList.contains('coyh-cat-hdr')) {
            currentCat = tb.dataset.cat || currentCat;
        } else if (tb.classList.contains('coyh-dep-group')) {
            order.push({ dep: tb.dataset.dep, cat: currentCat || tb.dataset.cat });
        }
    });

    // Guardar en localStorage (fallback instantáneo)
    try { localStorage.setItem('coyh_dep_order', JSON.stringify(order.map(function(o){ return o.dep; }))); } catch(e) {}

    // Actualizar numeración visual inmediatamente
    _coyhActualizarNumeracion(order.map(function(o){ return o.dep; }));

    // Actualizar datos en memoria para re-renders posteriores
    var ordenPorDep = {};
    var catPorDep   = {};
    order.forEach(function(o, idx) {
        ordenPorDep[o.dep] = (idx + 1) * 10;
        catPorDep[o.dep]   = o.cat;
    });
    if (_coyhData && _coyhData.participantes) {
        _coyhData.participantes.forEach(function(p) {
            if (ordenPorDep[p.dependencia] !== undefined) {
                p.orden          = ordenPorDep[p.dependencia];
                p.num_directorio = order.findIndex(function(o){ return o.dep === p.dependencia; }) + 1;
                // Actualizar categoría si se movió de sección
                var newCat = catPorDep[p.dependencia];
                if (newCat && newCat !== '__invitados') {
                    p.categoria = newCat;
                    p.tipo_lista = 'integrante';
                } else if (newCat === '__invitados') {
                    p.tipo_lista = 'invitado';
                }
            }
        });
    }

    // Persistir en Supabase de forma async — una promesa por dependencia
    var sb = _coyhSB();
    if (!sb) { _coyhToast('Sin conexión — orden guardado solo localmente', 'warning'); return; }

    var promises = order.map(function(o, idx) {
        var updateFields = { orden: (idx + 1) * 10, num_directorio: idx + 1 };
        // Si la categoría visual difiere de la stored, actualizarla también
        if (o.cat && o.cat !== '__invitados') {
            updateFields.categoria  = o.cat;
            updateFields.tipo_lista = 'integrante';
        } else if (o.cat === '__invitados') {
            updateFields.tipo_lista = 'invitado';
        }
        return sb.from('coyh_participantes')
            .update(updateFields)
            .eq('dependencia', o.dep);
    });

    Promise.all(promises).then(function(results) {
        var firstError = results.find(function(r) { return r.error; });
        if (firstError) {
            console.error('[COyH] Error al guardar orden:', firstError.error);
            _coyhToast('Error al guardar el orden: ' + firstError.error.message, 'error');
        } else {
            _coyhToast('Orden guardado', 'success');
        }
    }).catch(function(err) {
        console.error('[COyH] Error al guardar orden:', err);
        _coyhToast('Error al guardar el orden', 'error');
    });
}

/** Actualiza los números visuales (#) de cada empresa sin re-renderizar */
function _coyhActualizarNumeracion(order) {
    var tbl = document.querySelector('#_coyh-body table');
    if (!tbl) return;
    order.forEach(function(dep, idx) {
        var tb = tbl.querySelector('tbody.coyh-dep-group[data-dep="'+_escHtml(dep)+'"]');
        if (!tb) return;
        var numCell = tb.querySelector('td[rowspan]');
        if (numCell) numCell.textContent = idx + 1;
    });
}

function _coyhInitDragDrop() {
    var tbl = document.querySelector('#_coyh-body table');
    if (!tbl) return;
    var groups = Array.from(tbl.querySelectorAll('tbody.coyh-dep-group'));

    groups.forEach(function(tb) {
        /* Activar draggable solo desde el handle */
        tb.querySelectorAll('.coyh-drag-handle').forEach(function(h) {
            h.addEventListener('pointerdown', function(e) {
                e.stopPropagation();
                tb.setAttribute('draggable', 'true');
            });
            h.addEventListener('pointerup', function() {
                setTimeout(function(){ tb.removeAttribute('draggable'); }, 200);
            });
        });

        tb.addEventListener('dragstart', function(e) {
            _coyhDragDep = tb.dataset.dep;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', _coyhDragDep);
            setTimeout(function(){ tb.classList.add('coyh-dragging'); }, 0);
        });

        tb.addEventListener('dragover', function(e) {
            if (!_coyhDragDep || tb.dataset.dep === _coyhDragDep) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            groups.forEach(function(b){ b.classList.remove('coyh-drag-before'); });
            tb.classList.add('coyh-drag-before');
        });

        tb.addEventListener('dragleave', function(e) {
            if (!tb.contains(e.relatedTarget)) tb.classList.remove('coyh-drag-before');
        });

        tb.addEventListener('drop', function(e) {
            e.preventDefault();
            groups.forEach(function(b){ b.classList.remove('coyh-drag-before'); });
            if (!_coyhDragDep || tb.dataset.dep === _coyhDragDep) return;
            var srcTb = null;
            groups.forEach(function(b){ if (b.dataset.dep === _coyhDragDep) srcTb = b; });
            if (!srcTb) return;
            tbl.insertBefore(srcTb, tb);
            _coyhSaveDepOrder();
        });

        tb.addEventListener('dragend', function() {
            tb.removeAttribute('draggable');
            tb.classList.remove('coyh-dragging');
            groups.forEach(function(b){ b.classList.remove('coyh-drag-before', 'coyh-dragging'); });
            _coyhDragDep = null;
        });
    });
}

/* -------------------------------------------------------------------
   RESALTAR EMPRESA AL HACER click EN DEPENDENCIA
-------------------------------------------------------------------*/
window._coyhDepSeleccionada = null;

function _coyhResaltarDep(dep) {
    var tabla = document.querySelector('#_coyh-body table');
    if (!tabla) return;
    var rows = tabla.querySelectorAll('tbody tr[data-dep]');
    if (window._coyhDepSeleccionada === dep) {
        /* Desseleccionar */
        rows.forEach(function(r){ r.classList.remove('coyh-hl'); });
        window._coyhDepSeleccionada = null;
    } else {
        /* Resaltar empresa seleccionada, quitar resaltado del resto */
        window._coyhDepSeleccionada = dep;
        rows.forEach(function(r){
            if (r.dataset.dep === dep) r.classList.add('coyh-hl');
            else                       r.classList.remove('coyh-hl');
        });
    }
}
window._coyhResaltarDep = _coyhResaltarDep;

/* -------------------------------------------------------------------
   PAD DE FIRMA
-------------------------------------------------------------------*/
function _coyhAbrirPad(participanteId) {
    var p = _coyhData.participantes.find(function(x){ return x.id === participanteId; });
    if (!p) return;
    var prev = document.getElementById('_coyh-pad-modal');
    if (prev) { var i=bootstrap.Modal.getInstance(prev); if(i) i.hide(); prev.remove(); }

    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal fade" id="_coyh-pad-modal" tabindex="-1" style="z-index:1080">'
        +'<div class="modal-dialog modal-dialog-centered" style="max-width:520px">'
        +'<div class="modal-content border-0" style="border-radius:16px;overflow:hidden">'
        +'<div class="modal-header border-0 pb-2" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">'
        +'<div class="flex-grow-1">'
        +'<div style="color:#7dd3fc;font-size:.64rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase">'
        +'<i class="fas fa-signature me-1"></i>Firma de asistencia</div>'
        +'<h6 class="modal-title fw-bold mb-0 mt-1" style="color:#fff;font-size:.88rem;line-height:1.3">'+_escHtml(p.nombre)+'</h6>'
        +'<div style="color:#94a3b8;font-size:.7rem">'+_escHtml(p.dependencia)+'</div>'
        +'</div>'
        +'<button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="modal"></button>'
        +'</div>'
        +'<div class="modal-body p-4">'
        +'<p class="text-muted mb-3" style="font-size:.78rem">Dibuje su firma. Confirme cuando est\u00e9 lista.</p>'
        +'<div style="border:2px solid #e5e7eb;border-radius:10px;background:#fff;position:relative;touch-action:none">'
        +'<canvas id="_coyh-pad-canvas" style="display:block;border-radius:8px;cursor:crosshair;width:100%" width="460" height="175"></canvas>'
        +'<div id="_coyh-pad-hint" style="position:absolute;inset:0;display:flex;align-items:center;'
        +'justify-content:center;pointer-events:none;color:#d1d5db;font-size:.76rem;user-select:none">'
        +'<i class="fas fa-pen me-2"></i>Firma aqu\u00ed</div>'
        +'</div>'
        +'<div class="d-flex justify-content-end mt-2">'
        +'<button class="btn btn-link btn-sm text-muted p-0" style="font-size:.73rem" onclick="_coyhPadLimpiar()">'
        +'<i class="fas fa-eraser me-1"></i>Limpiar</button></div>'
        +'</div>'
        +'<div class="modal-footer border-0 pt-0">'
        +'<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>'
        +'<button id="_coyh-pad-confirm" type="button" class="btn btn-sm fw-semibold"'
        +' style="background:#0f172a;color:#fff;border:none;border-radius:8px;padding:6px 18px"'
        +' onclick="_coyhGuardarFirma(\''+participanteId+'\')">'
        +'<i class="fas fa-check me-1"></i>Confirmar firma</button>'
        +'</div></div></div></div>');

    var padModal = document.getElementById('_coyh-pad-modal');
    var bsPad = new bootstrap.Modal(padModal, { backdrop: false });
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1079';
    overlay.onclick = function(){ bsPad.hide(); };
    document.body.appendChild(overlay);
    padModal.addEventListener('hidden.bs.modal', function(){ overlay.remove(); padModal.remove(); }, { once: true });
    padModal.addEventListener('shown.bs.modal',  function(){ _coyhPadInit(); },                     { once: true });
    bsPad.show();
}

var _coyhPadState = { drawing:false, hasStrokes:false, ctx:null, canvas:null };

function _coyhPadInit() {
    var canvas = document.getElementById('_coyh-pad-canvas');
    if (!canvas) return;
    _coyhPadState = { drawing:false, hasStrokes:false, ctx:canvas.getContext('2d'), canvas:canvas };
    var rect = canvas.getBoundingClientRect();
    var dpr  = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    var ctx = _coyhPadState.ctx;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    function pos(e) {
        var r = canvas.getBoundingClientRect();
        var s = e.touches ? e.touches[0] : e;
        return { x: s.clientX - r.left, y: s.clientY - r.top };
    }
    function start(e) { e.preventDefault(); _coyhPadState.drawing=true; var pt=pos(e); ctx.beginPath(); ctx.moveTo(pt.x,pt.y); var h=document.getElementById('_coyh-pad-hint'); if(h) h.style.display='none'; }
    function draw(e)  { if(!_coyhPadState.drawing) return; e.preventDefault(); var pt=pos(e); ctx.lineTo(pt.x,pt.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pt.x,pt.y); _coyhPadState.hasStrokes=true; }
    function stop(e)  { if(!_coyhPadState.drawing) return; e.preventDefault(); _coyhPadState.drawing=false; ctx.beginPath(); }
    canvas.addEventListener('mousedown',  start);
    canvas.addEventListener('mousemove',  draw);
    canvas.addEventListener('mouseup',    stop);
    canvas.addEventListener('mouseleave', stop);
    canvas.addEventListener('touchstart', start, { passive:false });
    canvas.addEventListener('touchmove',  draw,  { passive:false });
    canvas.addEventListener('touchend',   stop);
}

function _coyhPadLimpiar() {
    var s = _coyhPadState;
    if (!s.canvas || !s.ctx) return;
    s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    s.hasStrokes = false;
    var h = document.getElementById('_coyh-pad-hint'); if(h) h.style.display='';
}

async function _coyhGuardarFirma(participanteId) {
    if (!_coyhPadState.hasStrokes) { _coyhToast('Dibuja tu firma antes de confirmar','warning'); return; }
    var sb = _coyhSB();
    if (!sb) { _coyhToast('Sin conexi\u00f3n','error'); return; }
    var firmaBase64 = _coyhPadState.canvas.toDataURL('image/png');
    var btn = document.getElementById('_coyh-pad-confirm');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin me-1"></i>Guardando\u2026'; }
    try {
        var authRes = await sb.auth.getUser();
        var userId  = authRes && authRes.data && authRes.data.user ? authRes.data.user.id : null;
        var now     = new Date().toISOString();
        var pData   = _coyhData.participantes.find(function(x){ return x.id===participanteId; }) || {};
        var res = await sb.from('coyh_asistencia').upsert({
            reunion_id: _coyhData.reunionId, participante_id: participanteId,
            dependencia: pData.dependencia||'', nombre: pData.nombre||'',
            cargo: pData.cargo||'', tipo: pData.tipo||'titular',
            firmado: true, firmado_at: now, firmado_por: userId, firma_imagen: firmaBase64,
        }, { onConflict: 'reunion_id,participante_id' }).select('id,participante_id,firmado,firmado_at,firma_imagen').single();
        if (res.error) throw res.error;
        _coyhData.asistencia[participanteId] = res.data;
        var padEl = document.getElementById('_coyh-pad-modal');
        if (padEl) { var m=bootstrap.Modal.getInstance(padEl); if(m) m.hide(); }
        _coyhRenderLista();
        _coyhToast('Firma registrada correctamente','success');
    } catch(err) {
        console.error('[COyH] Error guardando firma:', err);
        _coyhToast('Error: '+(err.message||''),'error');
        if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-check me-1"></i>Confirmar firma'; }
    }
}

function _coyhVerFirma(participanteId) {
    var aRec = _coyhData.asistencia[participanteId];
    var p    = _coyhData.participantes.find(function(x){ return x.id===participanteId; });
    if (!aRec || !aRec.firma_imagen) return;
    var prev = document.getElementById('_coyh-ver-firma-modal');
    if (prev) { var mi=bootstrap.Modal.getInstance(prev); if(mi) mi.hide(); prev.remove(); }
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal fade" id="_coyh-ver-firma-modal" tabindex="-1" style="z-index:1090">'
        +'<div class="modal-dialog modal-dialog-centered" style="max-width:400px">'
        +'<div class="modal-content border-0" style="border-radius:14px;overflow:hidden">'
        +'<div class="modal-header border-0 py-2" style="background:#f8fafc">'
        +'<h6 class="modal-title fw-bold" style="font-size:.88rem">'
        +'<i class="fas fa-signature me-2 text-muted"></i>Firma \u2014 '+(p?_escHtml(p.nombre):'')+'</h6>'
        +'<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>'
        +'<div class="modal-body text-center p-4">'
        +'<img src="'+aRec.firma_imagen+'" alt="firma"'
        +' style="max-width:100%;border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:8px">'
        +'<div class="text-muted mt-2" style="font-size:.7rem">Firm\u00f3 el '
        +(aRec.firmado_at?new Date(aRec.firmado_at).toLocaleString('es-MX',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}):'')
        +'</div></div></div></div></div>');
    var m = document.getElementById('_coyh-ver-firma-modal');
    m.addEventListener('hidden.bs.modal', function(){ m.remove(); });
    new bootstrap.Modal(m).show();
}

function _coyhRenderError(msg) {
    var body = document.getElementById('_coyh-body');
    if (body) body.innerHTML = '<div class="text-center py-5 text-danger">'
        +'<i class="fas fa-exclamation-triangle fa-2x mb-3 d-block"></i>'
        +'<p class="mb-0 small">'+msg+'</p></div>';
}

/* -------------------------------------------------------------------
   IMPRIMIR LISTA
-------------------------------------------------------------------*/
function _coyhImprimirLista(soloFirmados) {
    var conf  = _coyhData.confirmaciones;
    var asist = _coyhData.asistencia;
    var confirmed = _coyhData.participantes.filter(function(p){ return conf[p.id] && conf[p.id].confirmado; });
    if (!confirmed.length) { _coyhToast('No hay asistentes confirmados para imprimir','warning'); return; }
    if (soloFirmados) {
        confirmed = confirmed.filter(function(p){ return asist[p.id] && asist[p.id].firmado; });
        if (!confirmed.length) { _coyhToast('Nadie ha firmado aún','warning'); return; }
    }

    var catOrder = ['autoridades','operadores_aereos','prestadores','permisionarios','otros','__invitados'];
    var grupos = {};
    confirmed.forEach(function(p) {
        var key = p.tipo_lista==='invitado'?'__invitados':(p.categoria||'otros');
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(p);
    });

    var subtitulo = soloFirmados
        ? 'Solo asistentes con firma (' + confirmed.length + ')'
        : 'Todos los confirmados (' + confirmed.length + ')';

    var filas = '';
    catOrder.forEach(function(cat) {
        if (!grupos[cat] || !grupos[cat].length) return;
        var label = cat==='__invitados'?'INVITADOS':(_COYH_CAT_LABEL[cat]||cat).toUpperCase();
        filas += '<tr><td colspan="5" class="cat-header">'+label+'</td></tr>';
        grupos[cat].forEach(function(p,i) {
            var aRec = asist[p.id];
            var firm = aRec && aRec.firmado;
            filas += '<tr class="'+(firm?'firmado':'')+'"><td style="text-align:center;color:#6b7280">'+(i+1)+'</td>'
                +'<td><strong>'+_escHtml(p.dependencia)+'</strong></td>'
                +'<td>'+_escHtml(p.nombre)+'<br><small style="color:#6b7280">'+(p.tipo==='titular'?'Titular':'Suplente')+'</small></td>'
                +'<td>'+_escHtml(p.cargo||'')+'</td>'
                +'<td style="text-align:center;width:110px">'
                +(aRec&&aRec.firma_imagen?'<img src="'+aRec.firma_imagen+'" style="max-width:90px;max-height:32px">':(firm?'\u2713 Presente':''))
                +'</td></tr>';
        });
    });

    var firmados = confirmed.filter(function(p){ return asist[p.id]&&asist[p.id].firmado; }).length;
    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
        +'<title>Lista de Asistencia COyH \u2014 '+_escHtml(_coyhData.sesionLabel)+'</title>'
        +'<style>'
        +'body{font-family:Arial,sans-serif;font-size:10pt;margin:18mm}'
        +'h1{font-size:12pt;margin:0 0 2px}h2{font-size:9.5pt;color:#475569;margin:0 0 10px;font-weight:normal}'
        +'.header{border-bottom:3px solid #0f172a;padding-bottom:8px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-end}'
        +'table{width:100%;border-collapse:collapse;font-size:8.5pt}'
        +'th{background:#0f172a;color:#fff;padding:4px 7px;text-align:left;font-size:7.5pt;border:1px solid #1e293b}'
        +'td{padding:3px 7px;border:1px solid #e5e7eb;vertical-align:middle}'
        +'.cat-header{background:#e8edf5;font-weight:700;font-size:7pt;color:#334155;text-transform:uppercase;letter-spacing:.04em;padding:5px 7px;border-top:2px solid #7c9cbf}'
        +'.firmado td{background:#f0fdf4}'
        +'@media print{button{display:none}}'
        +'</style></head><body>'
        +'<div class="header"><div>'
        +'<div style="font-size:7pt;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Aeropuerto Internacional Felipe \u00c1ngeles \u2014 COyH</div>'
        +'<h1>Lista de Asistencia</h1>'
        +'<h2>'+_escHtml(_coyhData.sesionLabel)+' &mdash; '+_escHtml(_coyhData.fecha)+'</h2>'
        +'<div style="font-size:7.5pt;color:#6b7280;margin-top:2px">'+subtitulo+'</div>'
        +'</div><div style="font-size:7.5pt;color:#6b7280;text-align:right">'
        +'Generado: '+new Date().toLocaleString('es-MX')+'<br>'
        +'<strong>'+firmados+' / '+confirmed.length+'</strong> asistentes confirmados con firma'
        +'</div></div>'
        +'<table><thead><tr>'
        +'<th>#</th><th>Empresa / Dependencia</th><th>Representante</th><th>Cargo</th>'
        +'<th style="text-align:center">Firma</th>'
        +'</tr></thead><tbody>'+filas+'</tbody></table>'
        +'<script>window.onload=function(){window.print();}<\/script>'
        +'</body></html>';

    var win = window.open('','_blank');
    if (!win) { _coyhToast('Habilita ventanas emergentes para imprimir','warning'); return; }
    win.document.write(html);
    win.document.close();
}

/* -------------------------------------------------------------------
   EXPORTAR A WORD (DOCX) — formato Acta COyH
-------------------------------------------------------------------*/
function _coyhExportarWord(mode) {
    // mode: 'blank'  = todos confirmados, columna firma en blanco (para firmar en papel)
    //       'firmas' = todos confirmados, con imágenes de firma capturadas
    if (typeof docx === 'undefined') {
        var s = document.createElement('script');
        s.src = 'https://unpkg.com/docx@7.8.2/build/index.js';
        s.onload  = function() { _coyhExportarWord(mode); };
        s.onerror = function() { _coyhToast('No se pudo cargar la librer\u00eda Word','danger'); };
        document.head.appendChild(s);
        _coyhToast('Cargando librer\u00eda Word\u2026','info');
        return;
    }
    var conf  = _coyhData.confirmaciones;
    var asist = _coyhData.asistencia;
    var lista = _coyhData.participantes.filter(function(p){ return conf[p.id] && conf[p.id].confirmado; });
    if (!lista.length) { _coyhToast('No hay asistentes confirmados','warning'); return; }

    /* Construir mapa de firmas (base64 ? ArrayBuffer) de forma síncrona */
    var sigMap = {};
    if (mode === 'firmas') {
        lista.forEach(function(p) {
            var aRec = asist[p.id];
            if (aRec && aRec.firmado && aRec.firma_imagen) {
                try {
                    var parts = aRec.firma_imagen.split(',');
                    var binary = atob(parts[1] || parts[0]);
                    var buf = new ArrayBuffer(binary.length);
                    var view = new Uint8Array(buf);
                    for (var i = 0; i < binary.length; i++) { view[i] = binary.charCodeAt(i); }
                    sigMap[p.id] = buf;
                } catch(e) { /* ignora si falla la conversión */ }
            }
        });
    }

    fetch('images/aifa-logo.png')
        .then(function(r){ return r.ok ? r.arrayBuffer() : null; })
        .catch(function(){ return null; })
        .then(function(logoData){ _coyhBuildWord(lista, asist, mode, logoData, sigMap); });
}

function _coyhBuildWord(lista, asist, mode, logoData, sigMap) {
    var D = docx;

    /* Info de sesión */
    var mNum  = (_coyhData.sesionLabel||'').match(/\d+/);
    var sNum  = mNum ? mNum[0] : '';
    var anio  = new Date().getFullYear();
    var actaTit = 'ACTA No. ' + sNum + '/' + anio;
    var sesUp   = (_coyhData.sesionLabel||'').toUpperCase();
    var fechUp  = (_coyhData.fecha||'').toUpperCase();

    /* Bordes */
    var B = function(sz, col){ return { style: D.BorderStyle.SINGLE, size: sz||6, color: col||'000000' }; };
    var fullBorder = { top:B(), bottom:B(), left:B(), right:B() };
    var noBorder   = { style: D.BorderStyle.NIL, size: 0, color: 'FFFFFF' };
    var noBorders  = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    /* Anchuras de columna en DXA (carta - márgenes 1.9cm c/lado ~ 9300 DXA) */
    var W = { dep:2325, rep:2790, car:2790, fir:1395 };

    /* Helpers */
    function R(text, o) {
        o = o || {};
        var cfg = { text: String(text||''), font: 'Noto Sans', size: o.size||18, bold: o.bold||false, color: o.color||'000000' };
        if (o.br) cfg.break = 1;
        return new D.TextRun(cfg);
    }
    function P(runs, align, sb, sa) {
        return new D.Paragraph({ children: runs, alignment: align||D.AlignmentType.CENTER, spacing:{ before:sb||80, after:sa||80 } });
    }
    function TC(paras, w, borders, vAlign) {
        return new D.TableCell({ width:{ size:w, type:D.WidthType.DXA }, borders:borders||fullBorder, verticalAlign:vAlign||D.VerticalAlign.CENTER, children:paras });
    }

    /* Celda de firma según modo */
    function firmaCell(p) {
        if (mode === 'blank') {
            /* Celda vacía para firmar en papel */
            return TC([new D.Paragraph({ children: [], spacing: { before: 320, after: 320 } })], W.fir);
        }
        /* mode === 'firmas' */
        var buf = sigMap[p.id];
        if (buf) {
            var img = new D.ImageRun({ data: buf, transformation: { width: 95, height: 38 } });
            return TC([new D.Paragraph({ children: [img], alignment: D.AlignmentType.CENTER, spacing: { before: 60, after: 60 } })], W.fir);
        }
        return TC([P([], D.AlignmentType.CENTER, 80, 80)], W.fir);
    }

    /* Fila cabecera de tabla */
    var headerRow = new D.TableRow({ tableHeader:true, children:[
        TC([P([R('DEPENDENCIA',              {bold:true,size:20})], D.AlignmentType.CENTER, 100, 100)], W.dep),
        TC([P([R('NOMBRE DEL',              {bold:true,size:20}), R('REPRESENTANTE',{bold:true,size:20,br:true})], D.AlignmentType.CENTER, 60, 60)], W.rep),
        TC([P([R('CARGO',                   {bold:true,size:20})], D.AlignmentType.CENTER, 100, 100)], W.car),
        TC([P([R('FIRMA',                   {bold:true,size:20})], D.AlignmentType.CENTER, 100, 100)], W.fir)
    ]});

    /* Filas de datos */
    var dataRows = lista.map(function(p) {
        var tipo = (p.tipo === 'titular') ? 'TITULAR' : 'SUPLENTE';
        return new D.TableRow({ children:[
            TC([P([R((p.dependencia||'').toUpperCase(), {bold:true,size:18})], D.AlignmentType.CENTER, 80, 80)], W.dep),
            TC([P([R(tipo,{size:14}), R((p.nombre||'').toUpperCase(),{size:18,br:true})], D.AlignmentType.CENTER, 60, 60)], W.rep),
            TC([P([R((p.cargo||'').toUpperCase(), {size:18})], D.AlignmentType.CENTER, 80, 80)], W.car),
            firmaCell(p)
        ]});
    });

    var mainTable = new D.Table({ width:{ size:9300, type:D.WidthType.DXA }, rows:[headerRow].concat(dataRows) });

    /* Encabezado: tabla invisible [logo | títulos | espacio] */
    var titleParas = [
        P([R(actaTit, {bold:true,size:22})], D.AlignmentType.CENTER, 40,  30),
        P([R(sesUp,   {bold:true,size:22})], D.AlignmentType.CENTER,  0,  30),
        P([R(fechUp,  {bold:true,size:22})], D.AlignmentType.CENTER,  0,  40)
    ];

    var hdrRowCells;
    if (logoData) {
        var logoImg = new D.ImageRun({ data: logoData, transformation:{ width:72, height:72 } });
        hdrRowCells = [
            new D.TableCell({ width:{size:1200,type:D.WidthType.DXA}, borders:noBorders, verticalAlign:D.VerticalAlign.CENTER,
                children:[new D.Paragraph({ children:[logoImg], alignment:D.AlignmentType.LEFT, spacing:{before:0,after:0} })] }),
            new D.TableCell({ width:{size:6900,type:D.WidthType.DXA}, borders:noBorders, verticalAlign:D.VerticalAlign.CENTER, children:titleParas }),
            new D.TableCell({ width:{size:1200,type:D.WidthType.DXA}, borders:noBorders, children:[new D.Paragraph({children:[]})] })
        ];
    } else {
        hdrRowCells = [
            new D.TableCell({ width:{size:9300,type:D.WidthType.DXA}, borders:noBorders, children:titleParas })
        ];
    }

    var headerTable = new D.Table({
        width: { size:9300, type:D.WidthType.DXA },
        borders: { top:noBorder, bottom:noBorder, left:noBorder, right:noBorder, insideH:noBorder, insideV:noBorder },
        rows: [new D.TableRow({ children: hdrRowCells })]
    });

    /* Pie de página */
    var footerPg = new D.Footer({ children:[
        new D.Paragraph({
            children: [R(sesUp + '    ' + fechUp + '    C.O. y H.', {size:16, color:'8B1515'})],
            alignment: D.AlignmentType.CENTER,
            border: { top:{ style:D.BorderStyle.SINGLE, size:6, color:'8B1515', space:4 } }
        })
    ]});

    var doc = new D.Document({ sections:[{
        properties: { page:{ margin:{ top:1080, right:1080, bottom:1080, left:1080 } } },
        footers: { default: footerPg },
        children: [
            headerTable,
            new D.Paragraph({ children:[], spacing:{ before:240, after:0 } }),
            mainTable
        ]
    }]});

    D.Packer.toBlob(doc).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a   = document.createElement('a');
        a.href  = url;
        var suf = mode === 'firmas' ? '_con_firmas' : '_en_blanco';
        a.download = 'COyH_Acta' + suf + '_' + new Date().toISOString().slice(0,10) + '.docx';
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 2000);
        _coyhToast('Archivo Word generado \u2713','success');
    }).catch(function(e) {
        console.error('Word error:', e);
        _coyhToast('Error al generar Word: ' + (e.message||e), 'danger');
    });
}

/* -------------------------------------------------------------------
   EXPORTAR A EXCEL (XLSX)
-------------------------------------------------------------------*/
function _coyhExportarExcel(soloFirmados) {
    if (typeof ExcelJS === 'undefined') {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        s.onload  = function() { _coyhExportarExcel(soloFirmados); };
        s.onerror = function() { _coyhToast('No se pudo cargar la librer\u00eda Excel','danger'); };
        document.head.appendChild(s);
        _coyhToast('Cargando librer\u00eda Excel\u2026','info');
        return;
    }
    var conf  = _coyhData.confirmaciones;
    var asist = _coyhData.asistencia;
    var lista = _coyhData.participantes.filter(function(p){ return conf[p.id] && conf[p.id].confirmado; });
    if (!lista.length) { _coyhToast('No hay asistentes confirmados','warning'); return; }
    if (soloFirmados) {
        lista = lista.filter(function(p){ return asist[p.id] && asist[p.id].firmado; });
        if (!lista.length) { _coyhToast('Nadie ha firmado a\u00fan','warning'); return; }
    }

    var catOrder = ['autoridades','operadores_aereos','prestadores','permisionarios','otros','__invitados'];
    var grupos = {};
    lista.forEach(function(p) {
        var key = p.tipo_lista==='invitado'?'__invitados':(p.categoria||'otros');
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(p);
    });

    var wb = new ExcelJS.Workbook();
    wb.creator = 'COyH AIFA';
    var ws = wb.addWorksheet('Asistencia COyH');

    var fBase  = { name: 'Noto Sans', size: 10 };
    var fBold  = { name: 'Noto Sans', size: 10, bold: true };
    var fTitle = { name: 'Noto Sans', size: 14, bold: true };
    var fSub   = { name: 'Noto Sans', size: 11 };
    var borderThin = {
        top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right:  { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };

    var sesion  = _coyhData.sesionLabel + ' \u2014 ' + _coyhData.fecha;
    var filtroTxt = soloFirmados ? 'Solo firmaron' : 'Todos los confirmados';

    /* --- Título --- */
    var r1 = ws.addRow(['Comit\u00e9 de Operaci\u00f3n y Horarios (COyH) \u2014 Lista de Asistencia']);
    r1.getCell(1).font = fTitle; r1.height = 22;
    var r2 = ws.addRow([sesion]);
    r2.getCell(1).font = fSub;
    var r3 = ws.addRow([filtroTxt]);
    r3.getCell(1).font = fSub;
    ws.addRow([]);

    /* --- Cabecera de columnas --- */
    var hdrs = ['#','Empresa / Dependencia','Representante','Cargo','Tipo','Tel\u00e9fono','Correo','Categor\u00eda','Confirm\u00f3','Firm\u00f3','Hora de firma'];
    var hRow = ws.addRow(hdrs);
    hRow.height = 22;
    hRow.eachCell(function(cell) {
        cell.font   = { name: 'Noto Sans', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top:    { style: 'thin' }, bottom: { style: 'thin' },
            left:   { style: 'thin' }, right:  { style: 'thin' }
        };
    });

    /* --- Datos por categoría --- */
    var rowNum = 1;
    catOrder.forEach(function(cat) {
        if (!grupos[cat] || !grupos[cat].length) return;
        var catLabel = cat==='__invitados'?'INVITADOS':(_COYH_CAT_LABEL[cat]||cat).toUpperCase();
        var catRow = ws.addRow(['--- ' + catLabel + ' ---']);
        catRow.height = 18;
        catRow.getCell(1).font = { name: 'Noto Sans', size: 10, bold: true, color: { argb: 'FF8B1515' } };
        catRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        ws.mergeCells(catRow.number, 1, catRow.number, 11);

        grupos[cat].forEach(function(p) {
            var aRec = asist[p.id];
            var firm = aRec && aRec.firmado ? 'S\u00ed' : 'No';
            var hora = (aRec && aRec.firmado && aRec.firmado_at)
                ? new Date(aRec.firmado_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : '';
            var dRow = ws.addRow([
                rowNum++,
                p.dependencia || '',
                p.nombre || '',
                p.cargo || '',
                p.tipo === 'titular' ? 'Titular' : 'Suplente',
                p.telefono || '',
                p.correo || '',
                _COYH_CAT_LABEL[p.categoria] || p.categoria || '',
                'S\u00ed',
                firm,
                hora
            ]);
            dRow.height = 16;
            dRow.eachCell(function(cell) {
                cell.font      = fBase;
                cell.alignment = { vertical: 'middle', wrapText: true };
                cell.border    = borderThin;
            });
        });
    });

    /* --- Anchos de columna --- */
    ws.columns = [
        {width:4},{width:32},{width:28},{width:30},
        {width:9},{width:14},{width:28},{width:22},
        {width:10},{width:8},{width:20}
    ];

    /* --- Generar y descargar --- */
    wb.xlsx.writeBuffer().then(function(buffer) {
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href   = url;
        var fechaHoy = new Date().toISOString().slice(0,10);
        var sufijo   = soloFirmados ? '_firmaron' : '_confirmados';
        a.download = 'COyH_Asistencia' + sufijo + '_' + fechaHoy + '.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 2000);
        _coyhToast('Archivo Excel generado \u2713','success');
    }).catch(function(e) {
        console.error('Excel error:', e);
        _coyhToast('Error al generar Excel: ' + (e.message||e), 'danger');
    });
}

/* -- Exports ------------------------------------------------------ */
window.coyhAbrirAsistencia      = coyhAbrirAsistencia;
window._coyhSwitchTab           = _coyhSwitchTab;
window._coyhToggleConfEmpresa   = _coyhToggleConfEmpresa;
window._coyhRenderActivo        = _coyhRenderActivo;
window._coyhEditarParticipante  = _coyhEditarParticipante;
window._coyhGuardarEdicion      = _coyhGuardarEdicion;
window._coyhEliminarParticipante= _coyhEliminarParticipante;
window._coyhAbrirPad            = _coyhAbrirPad;
window._coyhPadLimpiar          = _coyhPadLimpiar;
window._coyhGuardarFirma        = _coyhGuardarFirma;
window._coyhVerFirma            = _coyhVerFirma;
window._coyhImprimirLista       = _coyhImprimirLista;
window._coyhExportarExcel       = _coyhExportarExcel;
window._coyhExportarWord        = _coyhExportarWord;