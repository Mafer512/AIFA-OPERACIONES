// ═══════════════════════════════════════════════════════════════════
//  AGENDA DE COMITÉS — js/agenda.js
//  Gestión de comités, sesiones y acuerdos del AIFA
// ═══════════════════════════════════════════════════════════════════

/* ── Constantes de colores por área ─────────────────────────────── */
const AG_AREA = {
    // ── Nivel 1 / Dirección General ──────────────────────────────
    DG:      { bg:'#e0f2fe', color:'#0c4a6e', border:'#0ea5e9', name:'Dirección General' },
    // ── Nivel 2 / Direcciones ─────────────────────────────────────
    DO:      { bg:'#ecfdf5', color:'#064e3b', border:'#059669', name:'Dirección de Operación' },
    DPE:     { bg:'#eef2ff', color:'#312e81', border:'#4f46e5', name:'Planeación Estratégica' },
    DCS:     { bg:'#eff6ff', color:'#1e3a8a', border:'#2563eb', name:'Comercial y Servicios' },
    DA:      { bg:'#fffbeb', color:'#78350f', border:'#d97706', name:'Administración' },
    DJ:      { bg:'#fef2f2', color:'#7f1d1d', border:'#ef4444', name:'Dirección Jurídica' },
    // ── Nivel 2 / Entidades especiales ───────────────────────────
    GPE:     { bg:'#f0f9ff', color:'#0369a1', border:'#0284c7', name:'Gerencia de Procesos y Estadística' },
    SMS:     { bg:'#ecfeff', color:'#155e75', border:'#06b6d4', name:'SMS' },
    // ── Nivel 3 / Subdirecciones de DO ───────────────────────────
    'SD-SO': { bg:'#e0f2fe', color:'#075985', border:'#0ea5e9', name:'Subdirección Seg. Operacional' },
    'SD-SA': { bg:'#eef2ff', color:'#3730a3', border:'#6366f1', name:'Subdirección Seg. Aviación' },
    'SD-ING':{ bg:'#f5f3ff', color:'#4c1d95', border:'#8b5cf6', name:'Subdirección de Ingeniería' },
    'SD-SC': { bg:'#f0fdfa', color:'#134e4a', border:'#14b8a6', name:'Subdirección Servicios Conexos' },
    // ── Nivel 3 / Subdirecciones de DPE ──────────────────────────
    'SD-CE':   { bg:'#e0f2fe', color:'#075985', border:'#0ea5e9', name:'Subdirección Coordinación Estratégica' },
    'SD-PROY': { bg:'#ecfeff', color:'#155e75', border:'#06b6d4', name:'Subdirección de Proyectos' },
    'SD-SCPE': { bg:'#cffafe', color:'#164e63', border:'#22d3ee', name:'Subdirección Seguimiento y Control' },
    // ── Nivel 3 / Subdirecciones de DCS ──────────────────────────
    'SD-CYS':  { bg:'#eff6ff', color:'#1e3a8a', border:'#3b82f6', name:'Subdirección Comercial y Servicios' },
    'SD-SAYC': { bg:'#dbeafe', color:'#1d4ed8', border:'#60a5fa', name:'Subdirección Servicios Aeroportuarios' },
    'SD-MYC':  { bg:'#bfdbfe', color:'#1e40af', border:'#93c5fd', name:'Subdirección Movilidad y Calidad' },
    // ── Nivel 3 / Subdirecciones de DA ───────────────────────────
    'SD-RH':   { bg:'#fffbeb', color:'#92400e', border:'#f59e0b', name:'Subdirección Recursos Humanos' },
    'SD-RM':   { bg:'#fef3c7', color:'#78350f', border:'#d97706', name:'Subdirección Recursos Materiales' },
    'SD-RF':   { bg:'#fde68a', color:'#713f12', border:'#b45309', name:'Subdirección Recursos Financieros' },
    'SD-SIS':  { bg:'#faf5ff', color:'#581c87', border:'#a855f7', name:'Subdirección de Sistemas' },
    // ── Nivel 3 / Subdirecciones de DJ ───────────────────────────
    'SD-CONS': { bg:'#fef2f2', color:'#991b1b', border:'#ef4444', name:'Subdirección Consultiva' },
    'SD-CONT': { bg:'#fee2e2', color:'#7f1d1d', border:'#dc2626', name:'Subdirección Contenciosa' },
    'SD-ACORP':{ bg:'#fecaca', color:'#6b2222', border:'#f87171', name:'Subdirección Asuntos Corporativos' },
    // ── Nivel 4 / Gerencias (pueden aparecer en comités) ─────────
    GSO:     { bg:'#f5f3ff', color:'#4c1d95', border:'#7c3aed', name:'Gerencia Seg. Operacional' },
    GC:      { bg:'#fdf2f8', color:'#831843', border:'#db2777', name:'Gerencia de Calidad' },
    UT:      { bg:'#ecfeff', color:'#164e63', border:'#0891b2', name:'Unidad de Transparencia' },
    // ── Fallback ──────────────────────────────────────────────────
    AFAC:    { bg:'#f8fafc', color:'#1e293b', border:'#475569', name:'AFAC / General' },
};

const AG_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const AG_MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/* ── Estado interno ─────────────────────────────────────────────── */
let _ag = { comites:[], reuniones:[], acuerdos:[], ready:false, activeArea:'all', calMonth: new Date().getMonth() };

/* ── Supabase helper ────────────────────────────────────────────── */
function _agSB() { return window.supabaseClient || window._supabase || null; }

/* ── Carga de datos (lazy, con caché) ──────────────────────────── */
async function _agEnsureData(force) {
    if (_ag.ready && !force) return;

    /* Asegurar cliente Supabase (igual que el resto de la app) */
    if (typeof window.ensureSupabaseClient === 'function') {
        try { await window.ensureSupabaseClient(); } catch (_) {}
    }
    const sb = _agSB();
    if (!sb) { console.warn('[Agenda] Supabase client not available'); return; }

    const [rC, rR] = await Promise.all([
        sb.from('agenda_comites')
          .select('*')
          .eq('activo', true)
          .order('numero'),
        sb.from('agenda_reuniones')
          .select('id,comite_id,area,numero_sesion,fecha_sesion,hora_inicio,estatus,observaciones')
          .gte('fecha_sesion', '2026-01-01')
          .lte('fecha_sesion', '2026-12-31')
          .order('fecha_sesion'),
    ]);

    if (rC.error) console.error('[Agenda] comites error:', rC.error);
    if (rR.error) console.error('[Agenda] reuniones error:', rR.error);

    _ag.comites   = rC.data  || [];
    _ag.reuniones = rR.data  || [];
    _ag.ready = true;
    console.log(`[Agenda] Loaded: ${_ag.comites.length} comités, ${_ag.reuniones.length} reuniones`);

    /* ── Asegurar user_area antes de renderizar (por si el flujo de login lo
       cargó antes de que las funciones async del re-fetch lo guardaran) ── */
    if (!sessionStorage.getItem('user_area')) {
        try {
            const { data: _authData } = await sb.auth.getUser();
            if (_authData?.user) {
                const { data: _rd } = await sb
                    .from('user_roles').select('role, permissions')
                    .eq('user_id', _authData.user.id).maybeSingle();
                if (_rd) {
                    const _r2 = _rd.role;
                    const _rl = { operacion:'DO', administracion:'DA', planeacion:'DPE', comercial:'DCS', seguridad_op:'GSO', transparencia:'UT', calidad:'GC' };
                    const _gl = ['admin','superadmin','director_general','editor','capturista','lector','viewer','colab_viewer','colab_editor'];
                    const _ua = _rd.permissions?.area || _rl[_r2] || (!_gl.includes(_r2) && _r2 ? _r2 : null);
                    if (_ua) sessionStorage.setItem('user_area', _ua);
                }
            }
        } catch (_) { /* silencioso — no bloquear la carga */ }
    }

    _agShowAdminButtons();
    _agPopulateAreaSelect();
}

/* Populate el <select> de filtro con solo las áreas que tienen datos */
function _agPopulateAreaSelect() {
    const sel = document.getElementById('ag-area-select');
    if (!sel) return;
    const current = sel.value;
    const usedAreas = new Set([
        ..._ag.comites.map(c => c.area),
        ..._ag.reuniones.map(r => r.area),
    ]);
    sel.innerHTML = '<option value="all">Todas las áreas</option>';
    Object.entries(AG_AREA).forEach(([key, ac]) => {
        if (!usedAreas.has(key)) return;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${ac.name} (${key})`;
        sel.appendChild(opt);
    });
    // Restaurar selección previa si sigue siendo válida
    if (current && (current === 'all' || usedAreas.has(current))) sel.value = current;
}

/* ─────────────────────────────────────────────────────────────────
   FILTRO DE ÁREA
───────────────────────────────────────────────────────────────────*/
function agFilterArea(area, btn) {
    _ag.activeArea = area;

    /* Sincronizar el select desplegable */
    const sel = document.getElementById('ag-area-select');
    if (sel) sel.value = area;

    const activeTabId = document.querySelector('#ag-main-tabs .nav-link.active')?.id;
    if (activeTabId === 'ag-tab-calendario') agLoadCalendario();
    else if (activeTabId === 'ag-tab-anual')     agLoadAnual();
    else if (activeTabId === 'ag-tab-comites')   agLoadComites();
    else if (activeTabId === 'ag-tab-reuniones') agLoadReuniones();
}

/* ─────────────────────────────────────────────────────────────────
   CALENDARIO GENERAL — grid mensual con detección de conflictos
───────────────────────────────────────────────────────────────────*/
/* Navega al calendario y desplaza hasta el día indicado (YYYY-MM-DD) */
async function agNavToDate(dateStr) {
    /* 1. Ir a la sección agenda */
    try {
        const link = document.querySelector('.menu-item[data-section="agenda"]');
        if (typeof showSection === 'function') showSection('agenda', link);
        else if (link) link.click();
    } catch (_) {}

    /* 2. Activar pestaña Calendario General */
    const tab = document.getElementById('ag-tab-calendario');
    if (tab) {
        const bsTab = bootstrap.Tab.getOrCreateInstance(tab);
        bsTab.show();
    }

    /* 3. Establecer el mes correcto y dibujar */
    const d = new Date(dateStr + 'T00:00:00');
    _ag.calMonth = d.getMonth();
    await agLoadCalendario();

    /* 4. Scroll suave a la celda del día */
    setTimeout(function() {
        const cell = document.getElementById('ag-cal-day-' + dateStr);
        if (cell) {
            cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
            /* Pulso visual para que sea obvio */
            cell.style.transition = 'outline .1s';
            cell.style.outline = '3px solid #4f46e5';
            cell.style.outlineOffset = '2px';
            setTimeout(function() { cell.style.outline = ''; cell.style.outlineOffset = ''; }, 1800);
        }
    }, 350);
}

async function agLoadCalendario() {
    const pane = document.getElementById('ag-pane-calendario');
    if (!pane) return;
    pane.innerHTML = `<div class="text-center py-5">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="text-muted mt-2 small">Cargando calendario…</p></div>`;
    await _agEnsureData();
    _agCalDraw();
}

/* Navega mes ±1 y redibuja */
function agCalNavMonth(delta) {
    _ag.calMonth = ((_ag.calMonth + delta + 12) % 12);
    _agCalDraw();
}

/* ── Renderiza el grid mensual completo ─────────────────────────── */
function _agCalDraw() {
    const pane = document.getElementById('ag-pane-calendario');
    if (!pane) return;

    const now     = new Date();
    const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soon    = new Date(today.getTime() + 14 * 86400000); /* próximas 2 semanas */
    const area    = _ag.activeArea || 'all';
    const year    = 2026;
    const month   = _ag.calMonth;

    const reuniones = area === 'all'
        ? _ag.reuniones
        : _ag.reuniones.filter(r => r.area === area);

    /* Agrupar sesiones del mes visible */
    const byDay = {};
    reuniones.forEach(r => {
        const d = new Date(r.fecha_sesion + 'T00:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) {
            const k = d.getDate();
            if (!byDay[k]) byDay[k] = [];
            byDay[k].push(r);
        }
    });

    /* Conflictos del mes */
    const conflictDaysMonth = new Set(
        Object.entries(byDay).filter(([, a]) => a.filter(r=>r.estatus!=='Cancelada').length >= 2).map(([k]) => +k)
    );

    /* Estadísticas */
    const allSes    = Object.values(byDay).flat();
    const totalMes  = allSes.length;
    const celeb     = allSes.filter(r => r.estatus === 'Celebrada').length;
    const cancel    = allSes.filter(r => r.estatus === 'Cancelada').length;
    const nConfl    = conflictDaysMonth.size;

    /* ── CSS inyectado una vez ──────────────────────────────────── */
    if (!document.getElementById('ag-cal-style')) {
        const s = document.createElement('style');
        s.id = 'ag-cal-style';
        s.textContent = `
        .ag-cal-cell { border-radius:10px; vertical-align:top; padding:10px 8px 8px; min-height:165px; position:relative; transition:box-shadow .15s; }
        .ag-cal-cell:hover { box-shadow:0 3px 12px rgba(0,0,0,.12) !important; z-index:1; }
        .ag-chip { display:block; padding:4px 7px 4px 6px; margin:2px 0; border-radius:0 6px 6px 0;
                   font-size:.72rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                   cursor:pointer; line-height:1.45; border-left-width:3px; border-left-style:solid;
                   transition:filter .12s; }
        .ag-chip:hover { filter:brightness(.94); }
        .ag-chip-past { opacity:.7; }
        .ag-chip-can  { text-decoration:line-through; opacity:.5; }
        .ag-chip-soon { animation:ag-pulse .9s infinite alternate; }
        @keyframes ag-pulse { from { filter:brightness(1); } to { filter:brightness(1.12); } }
        .ag-dow-weekend { background:#f8fafc !important; }
        .ag-day-num-today { background:#4f46e5; color:#fff !important; border-radius:50%;
                            width:24px; height:24px; display:inline-flex; align-items:center;
                            justify-content:center; font-size:.75rem; font-weight:700; }
        `;
        document.head.appendChild(s);
    }

    /* ─────────────────────────────────────────────────────────
       CABECERA
    ───────────────────────────────────────────────────────── */
    let html = `
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%);border-radius:14px;padding:16px 20px;margin-bottom:16px">
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
            <!-- Navegación -->
            <div class="d-flex align-items-center gap-2">
                <button class="btn btn-sm px-3 py-1" onclick="agCalNavMonth(-1)"
                    style="background:rgba(255,255,255,.1);color:#e2e8f0;border:1px solid rgba(255,255,255,.2);border-radius:8px;transition:background .15s"
                    onmouseover="this.style.background='rgba(255,255,255,.18)'" onmouseout="this.style.background='rgba(255,255,255,.1)'">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <div style="text-align:center;min-width:200px">
                    <div style="color:#93c5fd;font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${year}</div>
                    <div style="color:#fff;font-size:1.45rem;font-weight:800;line-height:1.15;letter-spacing:-.01em">${AG_MONTHS_FULL[month]}</div>
                </div>
                <button class="btn btn-sm px-3 py-1" onclick="agCalNavMonth(1)"
                    style="background:rgba(255,255,255,.1);color:#e2e8f0;border:1px solid rgba(255,255,255,.2);border-radius:8px;transition:background .15s"
                    onmouseover="this.style.background='rgba(255,255,255,.18)'" onmouseout="this.style.background='rgba(255,255,255,.1)'">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            <!-- KPIs -->
            <div class="d-flex gap-2 flex-wrap">
                <div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 14px;text-align:center;min-width:70px">
                    <div style="color:#fff;font-size:1.3rem;font-weight:800;line-height:1">${totalMes}</div>
                    <div style="color:#93c5fd;font-size:.65rem;font-weight:500">Sesiones</div>
                </div>
                <div style="background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.25);border-radius:10px;padding:8px 14px;text-align:center;min-width:70px">
                    <div style="color:#34d399;font-size:1.3rem;font-weight:800;line-height:1">${celeb}</div>
                    <div style="color:#34d399;font-size:.65rem;opacity:.85;font-weight:500">Celebradas</div>
                </div>
                ${cancel > 0 ? `<div style="background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.25);border-radius:10px;padding:8px 14px;text-align:center;min-width:70px">
                    <div style="color:#f87171;font-size:1.3rem;font-weight:800;line-height:1">${cancel}</div>
                    <div style="color:#f87171;font-size:.65rem;opacity:.85;font-weight:500">Canceladas</div>
                </div>` : ''}
                ${nConfl > 0
                    ? `<div style="background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.25);border-radius:10px;padding:8px 14px;text-align:center;min-width:70px">
                        <div style="color:#fbbf24;font-size:1.3rem;font-weight:800;line-height:1">${nConfl}</div>
                        <div style="color:#fbbf24;font-size:.65rem;opacity:.85;font-weight:500">Conflictos</div>
                       </div>`
                    : `<div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.18);border-radius:10px;padding:8px 14px;text-align:center">
                        <i class="fas fa-shield-alt" style="color:#34d399;font-size:1.1rem"></i>
                        <div style="color:#34d399;font-size:.62rem;opacity:.85;margin-top:3px;font-weight:500">Sin conflictos</div>
                       </div>`}
            </div>
        </div>
    </div>`;

    /* ─────────────────────────────────────────────────────────
       GRID
    ───────────────────────────────────────────────────────── */
    const DAYS_H = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    const firstDay  = new Date(year, month, 1);
    const totalDays = new Date(year, month + 1, 0).getDate();
    const startDow  = (firstDay.getDay() + 6) % 7;

    html += `<div style="overflow-x:auto">
    <table style="border-collapse:separate;border-spacing:6px;min-width:980px;width:100%">
      <thead><tr>`;
    DAYS_H.forEach((d, i) => {
        const isWe = i >= 5;
        html += `<th class="text-center pb-2" style="width:14.28%;font-size:.75rem;font-weight:700;
            color:${isWe ? '#8b5cf6' : '#6b7280'};letter-spacing:.04em;padding-bottom:8px">${d}</th>`;
    });
    html += `</tr></thead><tbody>`;

    let day = 1, col = startDow;
    let row = '<tr>';
    for (let i = 0; i < startDow; i++) {
        row += `<td class="ag-cal-cell" style="background:#f9fafb;border:1px solid #f1f5f9"></td>`;
    }

    while (day <= totalDays) {
        const sessions  = byDay[day] || [];
        const cellDate  = new Date(year, month, day);
        const isToday   = (year === now.getFullYear() && month === now.getMonth() && day === now.getDate());
        const isPastDay = cellDate < today;
        const isConfl   = conflictDaysMonth.has(day);
        const isWe      = col >= 5;

        const hasHourConfl = isConfl && (() => {
            const hm = sessions.filter(r=>r.hora_inicio&&r.estatus!=='Cancelada')
                .map(r=>{ const [h,m]=r.hora_inicio.split(':').map(Number); return h*60+m; });
            for (let i=0;i<hm.length;i++) for (let j=i+1;j<hm.length;j++)
                if (Math.abs(hm[i]-hm[j])<60) return true;
            return false;
        })();

        /* Estilo de celda */
        let cBg, cBorder, cShadow = '';
        if (isToday) {
            cBg = '#eef2ff'; cBorder = '2px solid #4f46e5'; cShadow = 'box-shadow:0 0 0 3px #6366f125;';
        } else if (hasHourConfl) {
            cBg = '#fff5f5'; cBorder = '2px solid #dc2626';
        } else if (isConfl) {
            cBg = '#fffbeb'; cBorder = '2px solid #d97706';
        } else if (sessions.length > 0) {
            cBg = isPastDay ? '#fafafa' : '#fcfcfe'; cBorder = '1.5px solid #cbd5e1';
        } else {
            cBg = isWe ? '#f8fafc' : '#fff'; cBorder = '1px solid #e2e8f0';
        }

        const _cellId = `ag-cal-day-${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        row += `<td id="${_cellId}" class="ag-cal-cell${isWe?' ag-dow-weekend':''}"
            style="background:${cBg};border:${cBorder};${cShadow}">`;

        /* Número de día */
        const numStyle = isToday ? 'class="ag-day-num-today"' : `style="font-size:.82rem;font-weight:700;color:${isPastDay?'#9ca3af':'#1f2937'}"`;
        row += `<div class="d-flex justify-content-between align-items-start mb-1">
            <span ${numStyle}>${day}</span>
            ${isConfl
                ? `<span style="background:${hasHourConfl?'#f43f5e':'#f59e0b'};color:#fff;
                    font-size:.58rem;padding:1px 5px;border-radius:10px;font-weight:700"
                    title="${sessions.filter(r=>r.estatus!=='Cancelada').length} comités coinciden">
                    ⚠ ×${sessions.filter(r=>r.estatus!=='Cancelada').length}</span>`
                : (sessions.length > 1 ? `<span style="color:#9ca3af;font-size:.6rem">${sessions.length}</span>` : '')}
        </div>`;

        /* Chips de sesión — siempre coloreados por área */
        const visible  = sessions.slice(0, 4);
        const overflow = sessions.length - 4;
        visible.forEach(r => {
            const comite   = _ag.comites.find(c => c.id === r.comite_id) || {};
            const _chipArea = comite.area || r.area; // comite.area es la fuente de verdad
            const ac       = AG_AREA[_chipArea] || AG_AREA.AFAC;
            const label    = comite.acronimo || (comite.nombre || '').split(' ').slice(0, 3).join(' ');
            const isCan    = r.estatus === 'Cancelada';
            const isCel    = r.estatus === 'Celebrada';
            const isUpSoon = !isPastDay && cellDate <= soon && !isCan;

            let extraCls = '';
            if (isCan)     extraCls = ' ag-chip-can';
            else if (isCel || isPastDay) extraCls = ' ag-chip-past';
            else if (isUpSoon)           extraCls = ' ag-chip-soon';

            /* Icono de estado (pequeño, al inicio) */
            let statusIcon = '';
            if (isCel)     statusIcon = `<i class="fas fa-check" style="font-size:.55rem;opacity:.7;margin-right:3px"></i>`;
            else if (isCan) statusIcon = `<i class="fas fa-times" style="font-size:.55rem;opacity:.7;margin-right:3px"></i>`;
            else if (isUpSoon) statusIcon = `<i class="fas fa-bell" style="font-size:.55rem;margin-right:3px"></i>`;

            const hora = r.hora_inicio ? r.hora_inicio.slice(0, 5) : '';

            row += `<span class="ag-chip${extraCls}"
                title="${comite.nombre || ''}\n${r.numero_sesion || ''} | ${r.estatus}${hora ? ' · ' + hora + 'h' : ''}${r.observaciones ? '\n' + r.observaciones : ''}${comite.horario_fijo ? '\n⏰ Horario preestablecido' : ''}\n\n🔍 Haz click para ver información normativa"
                style="background:${ac.bg};color:${ac.color};border-left-color:${ac.border}"
                onclick="_agShowComiteDetail('${r.comite_id}')">
                ${statusIcon}<span style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border}60;font-size:.56rem;font-weight:700;
                    padding:0 3px;border-radius:3px;margin-right:4px;letter-spacing:.01em">${_chipArea}</span>${hora ? `<span style="opacity:.5;font-size:.6rem;margin-right:2px">${hora}</span>` : ''}${label}${comite.horario_fijo ? `<i class="fas fa-clock" style="font-size:.55rem;color:#d97706;opacity:.85;margin-left:4px;flex-shrink:0" title="Horario preestablecido"></i>` : ''}
            </span>`;
        });
        if (overflow > 0) {
            row += `<div style="font-size:.6rem;color:#6b7280;text-align:right;margin-top:2px">+${overflow} más</div>`;
        }
        row += `</td>`;
        col++; day++;

        if (col === 7 || day > totalDays) {
            if (day > totalDays && col < 7)
                for (let i = col; i < 7; i++)
                    row += `<td class="ag-cal-cell" style="background:#f9fafb;border:1px solid #f1f5f9"></td>`;
            row += '</tr>';
            html += row;
            if (day <= totalDays) { row = '<tr>'; col = 0; }
        }
    }

    html += `</tbody></table></div>`;

    /* ── Leyenda de áreas (solo las que tienen comités o sesiones) ─ */
    const _legendAreas = new Set([
        ..._ag.comites.map(c => c.area),
        ..._ag.reuniones.map(r => r.area),
    ]);
    html += `<div class="d-flex flex-wrap gap-2 mt-3 align-items-center" style="font-size:.72rem">
        <span class="text-muted fw-semibold me-1">Áreas:</span>`;
    Object.entries(AG_AREA).forEach(([key, ac]) => {
        if (!_legendAreas.has(key)) return;
        html += `<span style="background:${ac.bg};color:${ac.color};border-left:3px solid ${ac.border};
            padding:3px 8px;border-radius:0 5px 5px 0;font-weight:600">${key} <span style="font-weight:400;opacity:.8">— ${ac.name}</span></span>`;
    });
    html += `</div>
    <div class="d-flex flex-wrap gap-3 mt-2 align-items-center" style="font-size:.71rem;color:#6b7280">
        <span class="fw-semibold">Estado:</span>
        <span><i class="fas fa-check" style="font-size:.6rem;margin-right:3px"></i>Celebrada (misma área, atenuada)</span>
        <span><i class="fas fa-bell" style="font-size:.6rem;margin-right:3px"></i>Próxima ≤14 días (brilla)</span>
        <span><i class="fas fa-times" style="font-size:.6rem;margin-right:3px"></i>Cancelada (tachada)</span>
        <span style="background:#eef2ff;border:2px solid #4f46e5;padding:1px 7px;border-radius:5px;color:#3730a3;font-weight:600">Hoy</span>
        <span style="background:#fff5f5;border:2px solid #dc2626;padding:1px 7px;border-radius:5px;color:#dc2626">⚠ Horas solapadas</span>
        <span style="background:#fffbeb;border:2px solid #d97706;padding:1px 7px;border-radius:5px;color:#92400e">⚠ Mismo día</span>
        <span style="background:#fffbeb;border:1px solid #fde68a;padding:1px 8px;border-radius:5px;color:#92400e;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-clock" style="font-size:.65rem"></i>Sesión periódica anual</span>
    </div>
    <div class="mt-2 px-3 py-2 rounded-3 d-flex align-items-start gap-2" style="background:#fffdf0;border:1px solid #fde68a;font-size:.72rem;color:#78350f">
        <i class="fas fa-clock" style="color:#d97706;margin-top:2px;flex-shrink:0"></i>
        <span><strong>Sesiones periódicas anuales:</strong> Los comités marcados con este ícono tienen un calendario de reuniones recurrente, establecido de manera permanente año con año en las mismas fechas. Su programación forma parte del ciclo operativo institucional.</span>
    </div>`;

    /* ── Detalle de conflictos del mes ──────────────────────────── */
    if (nConfl > 0) {
        const DOW = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        html += `<div class="mt-4 pt-3" style="border-top:2px dashed #e5e7eb">
            <div class="d-flex align-items-center gap-2 mb-3">
                <i class="fas fa-exclamation-triangle" style="color:#f59e0b"></i>
                <h6 class="mb-0 fw-bold" style="color:#1e1b4b">Días con sesiones coincidentes — ${AG_MONTHS_FULL[month]}</h6>
                <span class="badge bg-warning text-dark">${nConfl} día${nConfl !== 1 ? 's' : ''}</span>
            </div>
            <div class="row g-2">`;

        [...conflictDaysMonth].sort((a, b) => a - b).forEach(d => {
            const sesiones = byDay[d].filter(r => r.estatus !== 'Cancelada');
            if (sesiones.length < 2) return;
            const dDate = new Date(year, month, d);
            const hMins = sesiones.filter(r => r.hora_inicio)
                .map(r => { const [h, m] = r.hora_inicio.split(':').map(Number); return h * 60 + m; });
            let hourConfl = false;
            outer: for (let i = 0; i < hMins.length; i++)
                for (let j = i + 1; j < hMins.length; j++)
                    if (Math.abs(hMins[i] - hMins[j]) < 60) { hourConfl = true; break outer; }

            html += `<div class="col-12 col-md-6">
            <div class="card border-0" style="box-shadow:0 2px 8px rgba(0,0,0,.08);border-top:3px solid ${hourConfl?'#f43f5e':'#f59e0b'}!important">
                <div class="card-header py-2 px-3 d-flex justify-content-between align-items-center"
                     style="background:${hourConfl?'#fff1f2':'#fffbeb'}">
                    <span class="fw-semibold" style="font-size:.82rem;color:${hourConfl?'#be123c':'#92400e'}">
                        ${DOW[dDate.getDay()]} ${d} de ${AG_MONTHS_FULL[month]}
                    </span>
                    <span class="badge" style="background:${hourConfl?'#f43f5e':'#f59e0b'};color:#fff;font-size:.62rem">
                        ${hourConfl ? '⚠ Horas solapadas' : 'Mismo día'}
                    </span>
                </div>
                <div class="card-body p-0">
                <table class="table table-sm mb-0" style="font-size:.76rem">
                    <thead class="table-light"><tr>
                        <th class="ps-3" style="width:60px">Hora</th>
                        <th>Área</th><th>Comité</th><th>Sesión</th>
                    </tr></thead><tbody>`;
            sesiones.slice().sort((a, b) => (a.hora_inicio||'').localeCompare(b.hora_inicio||'')).forEach(r => {
                const comite = _ag.comites.find(c => c.id === r.comite_id) || {};
                const ac     = AG_AREA[r.area] || AG_AREA.AFAC;
                const rHMin  = r.hora_inicio ? (() => { const [h,m]=r.hora_inicio.split(':').map(Number); return h*60+m; })() : null;
                const solapa = rHMin !== null && hMins.some(hm => hm !== rHMin && Math.abs(hm - rHMin) < 60);
                html += `<tr style="${solapa?'background:#fff1f2':''}" >
                    <td class="ps-3 fw-bold text-nowrap">${r.hora_inicio ? r.hora_inicio.slice(0,5)+'h' : '—'}</td>
                    <td><span style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border};
                        padding:1px 6px;border-radius:4px;font-size:.65rem;font-weight:600">${r.area}</span></td>
                    <td title="${comite.nombre||''}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                        ${comite.acronimo || (comite.nombre||'').slice(0,30)}</td>
                    <td class="text-muted pe-2">${r.numero_sesion||'—'}</td>
                </tr>`;
            });
            html += `</tbody></table></div></div></div>`;
        });
        html += `</div></div>`;
    }

    pane.innerHTML = html;
}

/* ── Modal de detalle de comité ─────────────────────────────────── */
function _agShowComiteDetail(comiteId) {
    const comite = _ag.comites.find(c => c.id === comiteId);
    if (!comite) return;

    const ac      = AG_AREA[comite.area] || AG_AREA.AFAC;
    const today   = new Date();
    const sesiones = _ag.reuniones
        .filter(r => r.comite_id === comiteId)
        .sort((a, b) => a.fecha_sesion.localeCompare(b.fecha_sesion));

    /* ── Integrantes ── */
    let integrantesHtml = '<p class="text-muted small mb-0">Sin información de integrantes registrada.</p>';
    if (comite.integrantes) {
        const items = comite.integrantes.split('|').map(s => s.trim()).filter(Boolean);
        integrantesHtml = `<ul class="list-unstyled mb-0">${
            items.map(item => {
                const [nombre, rol = ''] = item.split('—').map(s => s.trim());
                return `<li class="d-flex align-items-start gap-2 py-1" style="border-bottom:1px solid #f3f4f6">
                    <i class="fas fa-user-tie mt-1 flex-shrink-0" style="font-size:.6rem;color:${ac.color}"></i>
                    <span style="font-size:.82rem"><strong>${nombre}</strong>${rol ? `<span class="text-muted"> — ${rol}</span>` : ''}</span>
                </li>`;
            }).join('')
        }</ul>`;
    }

    /* ── Sesiones ── */
    const _isCOYH = (comite.acronimo || '').toUpperCase() === 'COYH';
    const _colCount = 5 + (_agCanEdit(comite.area) ? 1 : 0) + (_isCOYH ? 1 : 0);
    let sesionesHtml = `<tr><td colspan="${_colCount}" class="text-center text-muted py-3 small">Sin sesiones registradas para 2026</td></tr>`;
    if (sesiones.length) {
        sesionesHtml = sesiones.map(r => {
            const d        = new Date(r.fecha_sesion + 'T00:00:00');
            const isCan    = r.estatus === 'Cancelada';
            const isCel    = r.estatus === 'Celebrada';
            const isPast   = d < today;
            const badge    = isCan ? '#dc2626' : isCel ? '#16a34a' : isPast ? '#6b7280' : '#2563eb';
            const fechaStr = `${d.getDate()} ${AG_MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
            return `<tr style="${isCan ? 'opacity:.55;text-decoration:line-through' : isCel ? 'background:#f0fdf4' : ''}">
                <td class="text-center fw-semibold" style="font-size:.78rem">${r.numero_sesion || '—'}</td>
                <td style="font-size:.78rem">${fechaStr}</td>
                <td class="text-center" style="font-size:.78rem">${r.hora_inicio ? r.hora_inicio.slice(0,5) + 'h' : '—'}</td>
                <td><span class="badge" style="background:${badge};font-size:.63rem">${r.estatus}</span></td>
                <td class="text-muted" style="font-size:.73rem">${r.observaciones || ''}</td>
                ${_isCOYH ? `
                <td class="text-center">
                  <button class="btn btn-sm fw-semibold"
                    style="font-size:.65rem;padding:3px 8px;border-radius:7px;white-space:nowrap;
                           background:#1e3a5f;color:#fff;border:none"
                    title="Directorio y lista de asistencia del COyH"
                    onclick="event.stopPropagation();coyhAbrirAsistencia('${r.id}','${r.numero_sesion || 'Sesión'}','${fechaStr}')">
                    <i class='fas fa-address-book me-1'></i>Directorio
                  </button>
                </td>` : ''}
                ${_agCanEdit(comite.area) ? `
                <td class="text-center">
                  <button class="btn btn-link btn-sm p-0" style="color:#6b7280" title="Editar sesión"
                    onclick="event.stopPropagation();agOpenEditSesion('${r.id}','${comite.id}')">
                    <i class='fas fa-pen' style='font-size:.7rem'></i>
                  </button>
                </td>` : ''}
            </tr>`;
        }).join('');
    }

    /* ── Si el modal ya está abierto, actualizar contenido en lugar de recrearlo ── */
    const _existingDet = document.getElementById('_ag-det-modal');
    const _isRefresh   = _existingDet && _existingDet.classList.contains('show');

    const _innerHtml = `
        <div class="modal-content border-0" style="border-radius:14px;overflow:hidden">
          <div class="modal-header border-0 pb-2" style="background:${ac.bg}">
            <div class="flex-grow-1">
              <div class="d-flex align-items-center gap-2 mb-1">
                <span class="badge fw-bold" style="background:${ac.bg};color:${ac.color};border:2px solid ${ac.border};font-size:.72rem">
                  ${comite.area}${comite.acronimo ? ' — ' + comite.acronimo : ''}
                </span>
                <span class="text-muted" style="font-size:.75rem">#${comite.numero}</span>
              </div>
              <h5 class="modal-title fw-bold mb-0" style="color:${ac.color};font-size:1rem;line-height:1.35">${comite.nombre}${comite.horario_fijo ? ` <i class="fas fa-clock ms-1" style="font-size:.75rem;color:#d97706" title="Horario preestablecido"></i>` : ''}</h5>
              ${comite.frecuencia ? `<div class="mt-1 text-muted" style="font-size:.74rem"><i class="fas fa-redo me-1" style="color:${ac.color};opacity:.7"></i>${comite.frecuencia}</div>` : ''}
            </div>
            ${_agCanEdit(comite.area) ? `
            <button class="btn btn-sm ms-2 flex-shrink-0"
              style="background:${ac.color};color:#fff;border:none;border-radius:8px;font-size:.75rem;padding:5px 12px"
              onclick="bootstrap.Modal.getInstance(document.getElementById('_ag-det-modal'))?.hide();setTimeout(()=>agOpenEditComite('${comite.id}'),300)">
              <i class='fas fa-pen me-1'></i>Editar comité</button>` : ''}
            <button type="button" class="btn-close ms-3" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div style="height:4px;background:linear-gradient(90deg,${ac.border},${ac.color})"></div>

          <div class="modal-body p-4">

            ${comite.descripcion ? `
            <div class="mb-4">
              <div class="d-flex align-items-center gap-2 mb-2">
                <i class="fas fa-info-circle" style="color:${ac.color}"></i>
                <span class="fw-bold text-uppercase" style="font-size:.7rem;color:#6b7280;letter-spacing:.05em">Descripción General</span>
              </div>
              <p class="mb-0" style="font-size:.87rem">${comite.descripcion}</p>
            </div>` : ''}

            ${comite.fundamento ? `
            <div class="mb-4 p-3 rounded-3" style="background:#f8fafc;border-left:4px solid ${ac.border}">
              <div class="d-flex align-items-center gap-2 mb-2">
                <i class="fas fa-balance-scale" style="color:${ac.color}"></i>
                <span class="fw-bold text-uppercase" style="font-size:.7rem;color:${ac.color};letter-spacing:.05em">Fundamento Legal</span>
              </div>
              <p class="mb-0" style="font-size:.82rem;color:#374151">${comite.fundamento}</p>
            </div>` : ''}

            ${comite.integrantes ? `
            <div class="mb-4">
              <div class="d-flex align-items-center gap-2 mb-2">
                <i class="fas fa-users" style="color:${ac.color}"></i>
                <span class="fw-bold text-uppercase" style="font-size:.7rem;color:#6b7280;letter-spacing:.05em">Integrantes</span>
              </div>
              ${integrantesHtml}
            </div>` : ''}

            <div>
              <div class="d-flex align-items-center gap-2 mb-2">
                <i class="fas fa-calendar-alt" style="color:${ac.color}"></i>
                <span class="fw-bold text-uppercase" style="font-size:.7rem;color:#6b7280;letter-spacing:.05em">Sesiones 2026</span>
                <span class="badge bg-secondary" style="font-size:.63rem">${sesiones.length}</span>
                ${_agCanEdit(comite.area) ? `
                <button class="btn btn-sm ms-auto py-1 px-2"
                  style="background:${ac.color};color:#fff;font-size:.7rem;border:none;border-radius:6px"
                  onclick="agOpenEditSesion(null,'${comite.id}')">
                  <i class='fas fa-plus me-1'></i>Agregar sesión</button>` : ''}
              </div>
              <div class="table-responsive">
                <table class="table table-sm table-hover mb-0" style="font-size:.77rem">
                  <thead class="table-light">
                    <tr>
                      <th class="text-center" style="width:80px">No. Sesión</th>
                      <th>Fecha</th>
                      <th class="text-center" style="width:75px">Hora</th>
                      <th style="width:95px">Estatus</th>
                      <th>Observaciones</th>
                      ${_isCOYH ? '<th style="width:110px;text-align:center">Directorio</th>' : ''}
                      ${_agCanEdit(comite.area) ? '<th style="width:46px"></th>' : ''}
                    </tr>
                  </thead>
                  <tbody>${sesionesHtml}</tbody>
                </table>
              </div>
            </div>

          </div><!-- /modal-body -->
        </div>`;

    if (_isRefresh && _existingDet) {
        /* Modal ya está visible: reemplazar solo el contenido sin tocarlo a nivel Bootstrap */
        const dialogEl = _existingDet.querySelector('.modal-dialog');
        if (dialogEl) dialogEl.innerHTML = _innerHtml;
    } else {
        if (_existingDet) _existingDet.remove();
        document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="_ag-det-modal" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        ${_innerHtml}
      </div>
    </div>`);
        const bsM = new bootstrap.Modal(document.getElementById('_ag-det-modal'), { backdrop: true });
        document.getElementById('_ag-det-modal').addEventListener('hidden.bs.modal', () => {
            document.getElementById('_ag-det-modal')?.remove();
        });
        bsM.show();
    }
}
/* ─────────────────────────────────────────────────────────────────
   VISTA ANUAL 2026
─────────────────────────────────────────────────────────────────*/
async function agLoadAnual() {
    const pane = document.getElementById('ag-pane-anual');
    if (!pane) return;
    pane.innerHTML = `<div class="text-center py-5">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="text-muted mt-2 small">Cargando vista anual…</p></div>`;
    await _agEnsureData();
    _agAnualDraw();
}

function _agAnualDraw() {
    const pane = document.getElementById('ag-pane-anual');
    if (!pane) return;

    const now    = new Date();
    const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soon   = new Date(today.getTime() + 14 * 86400000);
    const area   = _ag.activeArea || 'all';
    const year   = 2026;

    const reuniones = area === 'all'
        ? _ag.reuniones
        : _ag.reuniones.filter(r => r.area === area);

    /* Estadísticas anuales */
    const totalYear  = reuniones.length;
    const celebYear  = reuniones.filter(r => r.estatus === 'Celebrada').length;
    const cancelYear = reuniones.filter(r => r.estatus === 'Cancelada').length;
    const pendYear   = reuniones.filter(r => r.estatus !== 'Celebrada' && r.estatus !== 'Cancelada').length;

    /* Conteo por área para el resumen */
    const areaCounts = {};
    reuniones.forEach(r => {
        const k = r.area || 'AFAC';
        areaCounts[k] = (areaCounts[k] || 0) + 1;
    });

    let html = `
    <!-- Encabezado anual -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%);border-radius:14px;padding:18px 22px;margin-bottom:20px">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
        <div>
          <div style="color:#7dd3fc;font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Agenda de Comités</div>
          <div style="color:#fff;font-size:1.6rem;font-weight:900;line-height:1.1">Vista Anual 2026</div>
          <div style="color:#94a3b8;font-size:.76rem;margin-top:4px">${area === 'all' ? 'Todas las áreas' : 'Área: ' + area + ' — ' + (AG_AREA[area]?.name || '')}</div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <div style="background:rgba(255,255,255,.08);border-radius:10px;padding:10px 16px;text-align:center;min-width:75px">
            <div style="color:#fff;font-size:1.5rem;font-weight:900;line-height:1">${totalYear}</div>
            <div style="color:#94a3b8;font-size:.62rem">Total sesiones</div>
          </div>
          <div style="background:rgba(134,239,172,.12);border-radius:10px;padding:10px 16px;text-align:center;min-width:75px">
            <div style="color:#86efac;font-size:1.5rem;font-weight:900;line-height:1">${celebYear}</div>
            <div style="color:#86efac;font-size:.62rem;opacity:.8">Celebradas</div>
          </div>
          <div style="background:rgba(251,146,60,.12);border-radius:10px;padding:10px 16px;text-align:center;min-width:75px">
            <div style="color:#fb923c;font-size:1.5rem;font-weight:900;line-height:1">${pendYear}</div>
            <div style="color:#fb923c;font-size:.62rem;opacity:.8">Pendientes</div>
          </div>
          ${cancelYear > 0 ? `<div style="background:rgba(248,113,113,.12);border-radius:10px;padding:10px 16px;text-align:center;min-width:75px">
            <div style="color:#f87171;font-size:1.5rem;font-weight:900;line-height:1">${cancelYear}</div>
            <div style="color:#f87171;font-size:.62rem;opacity:.8">Canceladas</div>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Resumen por área -->
    <div class="d-flex flex-wrap gap-2 mb-4">
      ${Object.entries(areaCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
        const ac = AG_AREA[k] || AG_AREA.AFAC;
        return `<div style="background:${ac.bg};border:1.5px solid ${ac.border};border-radius:8px;padding:5px 11px;
          cursor:pointer;transition:box-shadow .15s" onclick="agFilterArea('${k}',null)">
          <span style="color:${ac.color};font-weight:700;font-size:.75rem">${k}</span>
          <span style="color:${ac.color};opacity:.7;font-size:.7rem"> — ${ac.name}</span>
          <span style="background:${ac.color};color:#fff;border-radius:10px;padding:1px 7px;font-size:.65rem;font-weight:700;margin-left:6px">${v}</span>
        </div>`;
      }).join('')}
      ${area !== 'all' ? `<div style="background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:8px;padding:5px 11px;cursor:pointer"
        onclick="agFilterArea('all',document.querySelector('[data-ag-area=all]'))">
        <span style="color:#475569;font-size:.75rem">← Todas las áreas</span>
      </div>` : ''}
    </div>

    <!-- Grid de 12 meses -->
    <div class="row g-3">`;

    for (let m = 0; m < 12; m++) {
        const firstDay  = new Date(year, m, 1);
        const totalDays = new Date(year, m + 1, 0).getDate();
        const startDow  = (firstDay.getDay() + 6) % 7; // Lunes=0
        const isCurrentMonth = (now.getFullYear() === year && now.getMonth() === m);

        /* Sesiones de este mes */
        const byDay = {};
        reuniones.forEach(r => {
            const d = new Date(r.fecha_sesion + 'T00:00:00');
            if (d.getFullYear() === year && d.getMonth() === m) {
                const k = d.getDate();
                if (!byDay[k]) byDay[k] = [];
                byDay[k].push(r);
            }
        });

        const totalMes  = Object.values(byDay).flat().length;
        const celebMes  = Object.values(byDay).flat().filter(r=>r.estatus==='Celebrada').length;

        /* Sesiones ordenadas por día/hora para el mes */
        const allSess = Object.entries(byDay)
            .flatMap(([d, sess]) => sess.map(r => ({...r, _day: +d})))
            .sort((a,b) => a._day - b._day || (a.hora_inicio||'').localeCompare(b.hora_inicio||''));

        /* Agrupar por día */
        const byDayOrdered = [];
        allSess.forEach(r => {
            const last = byDayOrdered[byDayOrdered.length - 1];
            if (last && last.day === r._day) last.sessions.push(r);
            else byDayOrdered.push({ day: r._day, sessions: [r] });
        });

        const DOW_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        const pendMes   = totalMes - celebMes;
        const pct       = totalMes > 0 ? Math.round(celebMes / totalMes * 100) : 0;

        html += `
        <div class="col-12 col-sm-6 col-xl-4">
          <div class="card border-0" style="border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);
              ${isCurrentMonth ? 'outline:2px solid #4f46e5;outline-offset:-1px;' : ''}">

            <!-- Cabecera del mes -->
            <div class="card-header border-0 px-3 py-0" style="background:${isCurrentMonth?'#eef2ff':'#f8fafc'};
                border-radius:12px 12px 0 0;cursor:pointer" onclick="_agAnualGoMonth(${m})">
              <div class="d-flex align-items-center justify-content-between" style="padding:10px 0 6px">
                <div class="d-flex align-items-center gap-2">
                  <span class="fw-bold" style="font-size:1rem;color:${isCurrentMonth?'#4338ca':'#1e293b'}">${AG_MONTHS_FULL[m]}</span>
                  ${totalMes > 0
                    ? `<span style="background:${isCurrentMonth?'#4f46e5':'#475569'};color:#fff;border-radius:20px;padding:1px 8px;font-size:.62rem;font-weight:700">${totalMes} ses.</span>`
                    : `<span style="font-size:.65rem;color:#9ca3af">Sin sesiones</span>`}
                </div>
                <div class="d-flex align-items-center gap-2">
                  ${celebMes > 0 ? `<span style="font-size:.68rem;color:#059669;font-weight:600"><i class="fas fa-check-circle me-1"></i>${celebMes} realizadas</span>` : ''}
                  ${pendMes > 0  ? `<span style="font-size:.68rem;color:#d97706;font-weight:600">${pendMes} pend.</span>` : ''}
                  <i class="fas fa-calendar-alt" style="font-size:.65rem;color:#94a3b8"></i>
                </div>
              </div>
              ${totalMes > 0 ? `
              <div style="height:3px;background:#e2e8f0;border-radius:2px;margin-bottom:8px">
                <div style="height:3px;width:${pct}%;background:${pct===100?'#059669':'#4f46e5'};border-radius:2px;transition:width .3s"></div>
              </div>` : ''}
            </div>

            <!-- Agenda por día -->
            <div class="card-body p-0" style="max-height:320px;overflow-y:auto">`;

        if (byDayOrdered.length === 0) {
            html += `<div class="text-center py-4" style="color:#cbd5e1;font-size:.8rem">
                <i class="fas fa-calendar-times d-block mb-1" style="font-size:1.4rem;opacity:.3"></i>
                Sin sesiones programadas</div>`;
        } else {
            byDayOrdered.forEach(({ day: d, sessions: daySess }) => {
                const dDate  = new Date(year, m, d);
                const isToday2 = (now.getFullYear()===year && now.getMonth()===m && now.getDate()===d);
                const isPast2  = dDate < today;
                const isSoon2  = !isPast2 && dDate <= soon;
                const dow    = DOW_SHORT[dDate.getDay()];
                const allCel = daySess.every(r => r.estatus === 'Celebrada');
                const allCan = daySess.every(r => r.estatus === 'Cancelada');

                /* Color del encabezado de día */
                let dayBg = '#f8fafc', dayColor = '#64748b';
                if (isToday2)      { dayBg = '#4f46e5'; dayColor = '#fff'; }
                else if (allCel)   { dayBg = '#ecfdf5'; dayColor = '#059669'; }
                else if (allCan)   { dayBg = '#fef2f2'; dayColor = '#dc2626'; }
                else if (isSoon2)  { dayBg = '#fffbeb'; dayColor = '#92400e'; }

                html += `<div style="border-bottom:1px solid #f1f5f9">
                  <!-- Encabezado del día -->
                  <div style="display:flex;align-items:center;gap:6px;padding:5px 12px 3px;background:${dayBg}">
                    <span style="background:${isToday2?'#fff':'rgba(0,0,0,.08)'};color:${isToday2?'#4f46e5':dayColor};
                      border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;
                      font-size:.72rem;font-weight:800;flex-shrink:0">${d}</span>
                    <span style="font-size:.65rem;font-weight:600;color:${dayColor};text-transform:uppercase;letter-spacing:.05em">${dow}</span>
                    ${isToday2 ? `<span style="font-size:.57rem;background:#fff;color:#4f46e5;border-radius:10px;padding:0 5px;font-weight:700">HOY</span>` : ''}
                    ${isSoon2 && !isToday2 ? `<span style="font-size:.57rem;color:#d97706"><i class="fas fa-bell"></i></span>` : ''}
                  </div>
                  <!-- Sesiones del día -->
                  <div style="padding:2px 6px 4px 6px">`;

                daySess.forEach(r => {
                    const comite  = _ag.comites.find(c => c.id === r.comite_id) || {};
                    const _chipArea = comite.area || r.area; // comite.area es la fuente de verdad
                    const ac      = AG_AREA[_chipArea] || AG_AREA.AFAC;
                    const isCan   = r.estatus === 'Cancelada';
                    const isCel   = r.estatus === 'Celebrada';
                    const hora    = r.hora_inicio ? r.hora_inicio.slice(0,5) : '';
                    const nombre  = comite.nombre || comite.acronimo || '—';

                    html += `<div style="display:flex;align-items:center;gap:5px;padding:3px 4px;border-radius:6px;
                        cursor:pointer;transition:background .12s;${isCan?'opacity:.45;text-decoration:line-through':''}
                        border-left:3px solid ${isCan?'#e5e7eb':ac.border};background:${isCan?'transparent':ac.bg}20;
                        margin-bottom:2px"
                        onmouseover="this.style.background='${ac.bg}'"
                        onmouseout="this.style.background='${isCan?'transparent':ac.bg}20'"
                        onclick="_agShowComiteDetail('${r.comite_id}')">
                      <span style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border};
                        font-size:.53rem;font-weight:800;padding:1px 4px;border-radius:3px;white-space:nowrap;flex-shrink:0">${_chipArea}</span>
                      ${hora ? `<span style="font-size:.62rem;color:#94a3b8;font-weight:600;flex-shrink:0;min-width:32px">${hora}</span>` : ''}
                      <span style="font-size:.73rem;color:${isCel?'#374151':'#1e293b'};font-weight:${isCel?'400':'600'};
                        line-height:1.3;flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${nombre}</span>
                      ${comite.horario_fijo ? `<i class="fas fa-clock" style="font-size:.6rem;color:#d97706;flex-shrink:0" title="Horario preestablecido"></i>` : ''}
                      ${isCel ? `<i class="fas fa-check-circle flex-shrink-0" style="font-size:.65rem;color:#059669"></i>` : ''}
                      ${isCan ? `<i class="fas fa-times-circle flex-shrink-0" style="font-size:.65rem;color:#dc2626"></i>` : ''}
                    </div>`;
                });

                html += `</div></div>`;
            });
        }

        html += `</div></div></div>`; // card-body / card / col
    }

    html += `</div>`; // row

    /* Leyenda de áreas al pie (solo las que tienen datos) */
    const _legendAreasAnual = new Set([
        ..._ag.comites.map(c => c.area),
        ..._ag.reuniones.map(r => r.area),
    ]);
    html += `<div class="d-flex flex-wrap gap-2 mt-4 align-items-center" style="font-size:.72rem">
        <span class="text-muted fw-semibold me-1">Áreas:</span>`;
    Object.entries(AG_AREA).forEach(([key, ac]) => {
        if (!_legendAreasAnual.has(key)) return;
        html += `<span style="background:${ac.bg};color:${ac.color};border-left:3px solid ${ac.border};
            padding:3px 8px;border-radius:0 5px 5px 0;font-weight:600">${key} <span style="font-weight:400;opacity:.8">— ${ac.name}</span></span>`;
    });
    html += `</div>`;
    html += `<div class="mt-3 px-3 py-2 rounded-3 d-flex align-items-start gap-2" style="background:#fffdf0;border:1px solid #fde68a;font-size:.72rem;color:#78350f">
        <i class="fas fa-clock" style="color:#d97706;margin-top:2px;flex-shrink:0"></i>
        <span><strong>Sesiones periódicas anuales:</strong> Los comités marcados con este ícono tienen un calendario de reuniones recurrente, establecido de manera permanente año con año en las mismas fechas. Su programación forma parte del ciclo operativo institucional.</span>
    </div>`;

    pane.innerHTML = html;
}

/* Navega al mes desde la vista anual */
function _agAnualGoMonth(m) {
    _ag.calMonth = m;
    /* Activar tab de calendario general */
    const tabBtn = document.getElementById('ag-tab-calendario');
    const tabPane = document.getElementById('ag-pane-calendario');
    if (tabBtn && tabPane) {
        document.querySelectorAll('#ag-main-tabs .nav-link').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#agenda-section .tab-pane').forEach(p => { p.classList.remove('show','active'); });
        tabBtn.classList.add('active');
        tabPane.classList.add('show','active');
    }
    agLoadCalendario();
}

/* ─────────────────────────────────────────────────────────────────
   COMITÉS (TARJETAS)
───────────────────────────────────────────────────────────────────*/
async function agLoadComites() {
    const grid    = document.getElementById('ag-comites-grid');
    const loading = document.getElementById('ag-comites-loading');
    const empty   = document.getElementById('ag-comites-empty');
    if (!grid) return;

    if (loading) loading.style.display = '';
    grid.style.display = 'none';
    if (empty) empty.classList.add('d-none');

    await _agEnsureData();

    const area    = _ag.activeArea || 'all';
    const comites = area === 'all' ? _ag.comites : _ag.comites.filter(c => c.area === area);

    if (loading) loading.style.display = 'none';

    if (!comites.length) {
        if (empty) empty.classList.remove('d-none');
        return;
    }

    const today = new Date();

    let html = '';
    comites.forEach(c => {
        const ac = AG_AREA[c.area] || AG_AREA.AFAC;

        /* Próxima sesión */
        const next = _ag.reuniones
            .filter(r => r.comite_id === c.id && new Date(r.fecha_sesion + 'T00:00:00') >= today && r.estatus !== 'Cancelada')
            .sort((a, b) => a.fecha_sesion.localeCompare(b.fecha_sesion))[0];

        /* Conteo del año */
        const total    = _ag.reuniones.filter(r => r.comite_id === c.id).length;
        const celebradas = _ag.reuniones.filter(r => r.comite_id === c.id && r.estatus === 'Celebrada').length;
        const pct = total ? Math.round(celebradas * 100 / total) : 0;

        let nextHtml = '';
        if (next) {
            const d    = new Date(next.fecha_sesion + 'T00:00:00');
            const diff = Math.ceil((d - today) / 86400000);
            nextHtml = `<div class="mt-2 pt-2 border-top" style="font-size:.75rem">
                <i class="fas fa-calendar-day me-1 text-muted"></i>
                <strong>Próxima:</strong> ${d.getDate()} ${AG_MONTHS_FULL[d.getMonth()]}
                ${next.hora_inicio ? ' · ' + next.hora_inicio.slice(0,5)+'h' : ''}
                <span class="badge ms-1" style="background:${diff<=7?'#dc2626':'#2563eb'};color:#fff;font-size:.6rem">${diff}d</span>
            </div>`;
        } else {
            nextHtml = `<div class="mt-2 pt-2 border-top text-muted" style="font-size:.75rem">
                <i class="fas fa-calendar-times me-1"></i>Sin sesiones pendientes en 2026</div>`;
        }

        html += `<div class="col-12 col-md-6 col-xl-4">
          <div class="ag-card-comite h-100" style="padding:14px 16px">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <span class="badge" style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border};font-size:.72rem">
                ${c.area}${c.acronimo ? ' — ' + c.acronimo : ''}
              </span>
              <div class="d-flex align-items-center gap-1">
                ${c.horario_fijo ? `<span title="Horario preestablecido — siempre sesiona en las mismas fechas"
                  style="font-size:.72rem;color:#d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:1px 5px">
                  <i class="fas fa-clock"></i></span>` : ''}
                <span class="badge bg-secondary" style="font-size:.62rem">#${c.numero}</span>
              </div>
            </div>
            <div class="fw-semibold mb-1" style="font-size:.85rem;line-height:1.35">${c.nombre}</div>
            ${c.frecuencia ? `<div class="text-muted" style="font-size:.72rem"><i class="fas fa-redo me-1"></i>${c.frecuencia}</div>` : ''}
            ${c.hora_sesion ? `<div class="text-muted" style="font-size:.72rem"><i class="fas fa-clock me-1"></i>${c.hora_sesion.slice(0,5)} h</div>` : ''}
            ${c.presidente ? `<div class="text-muted mt-1" style="font-size:.72rem"><i class="fas fa-user-tie me-1"></i>${c.presidente}</div>` : ''}
            <!-- Barra de avance -->
            ${total ? `<div class="mt-2">
              <div class="d-flex justify-content-between" style="font-size:.68rem;color:#6b7280">
                <span>${celebradas}/${total} sesiones celebradas</span><span>${pct}%</span>
              </div>
              <div class="progress" style="height:5px;border-radius:3px">
                <div class="progress-bar" style="width:${pct}%;background:${ac.color}" role="progressbar"></div>
              </div>
            </div>` : ''}
            ${_agCanEdit(c.area) ? `
            <div class="d-flex gap-1 mt-2 pt-2" style="border-top:1px solid #e5e7eb">
              <button class="btn btn-outline-secondary btn-sm py-0 px-2 flex-fill" style="font-size:.7rem"
                onclick="event.stopPropagation();agOpenEditComite('${c.id}')">
                <i class="fas fa-pen me-1"></i>Editar</button>
              <button class="btn btn-outline-primary btn-sm py-0 px-2 flex-fill" style="font-size:.7rem"
                onclick="event.stopPropagation();agOpenEditSesion(null,'${c.id}')">
                <i class="fas fa-calendar-plus me-1"></i>+ Sesión</button>
              <button data-clock-id="${c.id}"
                class="btn btn-sm py-0 px-2" style="font-size:.7rem;flex-shrink:0;
                  ${c.horario_fijo
                    ? 'background:#fffbeb;border:1.5px solid #fbbf24;color:#d97706;font-weight:700'
                    : 'background:#f9fafb;border:1.5px solid #d1d5db;color:#9ca3af'}"
                title="${c.horario_fijo ? 'Quitar horario preestablecido' : 'Marcar como horario preestablecido (mismas fechas cada año)'}"
                onclick="event.stopPropagation();_agToggleHorarioFijo('${c.id}')">
                <i class="fas fa-clock"></i>
              </button>
            </div>` : ''}
            ${nextHtml}
          </div>
        </div>`;
    });

    grid.innerHTML = html;
    grid.style.display = '';
}

/* ─────────────────────────────────────────────────────────────────
   REUNIONES (LISTA)
───────────────────────────────────────────────────────────────────*/
async function agLoadReuniones() {
    const list    = document.getElementById('ag-reuniones-list');
    const loading = document.getElementById('ag-reuniones-loading');
    const empty   = document.getElementById('ag-reuniones-empty');
    if (!list) return;

    if (loading) loading.style.display = '';
    list.style.display = 'none';
    if (empty) empty.classList.add('d-none');

    await _agEnsureData();

    const area       = _ag.activeArea || 'all';
    const filtEstatus = document.getElementById('ag-reuniones-filtro-estatus')?.value || '';
    const filtMes    = document.getElementById('ag-reuniones-filtro-mes')?.value || '';  // YYYY-MM

    let reuniones = area === 'all' ? [..._ag.reuniones] : _ag.reuniones.filter(r => r.area === area);
    if (filtEstatus) reuniones = reuniones.filter(r => r.estatus === filtEstatus);
    if (filtMes)     reuniones = reuniones.filter(r => r.fecha_sesion.startsWith(filtMes));

    if (loading) loading.style.display = 'none';

    if (!reuniones.length) {
        if (empty) empty.classList.remove('d-none');
        return;
    }

    const today = new Date();
    let html = `<div class="table-responsive"><table class="table table-sm table-hover">
      <thead class="table-light">
        <tr>
          <th style="min-width:60px">Fecha</th>
          <th>Comité</th>
          <th>Área</th>
          <th>Sesión</th>
          <th>Hora</th>
          <th>Estatus</th>
        </tr>
      </thead><tbody>`;

    reuniones.forEach(r => {
        const comite = _ag.comites.find(c => c.id === r.comite_id) || {};
        const ac     = AG_AREA[r.area] || AG_AREA.AFAC;
        const d      = new Date(r.fecha_sesion + 'T00:00:00');
        const isPast = d < today;

        html += `<tr class="${isPast ? 'text-muted' : ''}">
          <td class="text-nowrap small fw-semibold">${d.getDate()} ${AG_MONTHS[d.getMonth()]} ${d.getFullYear()}</td>
          <td class="small" title="${comite.nombre}">${comite.acronimo || (comite.nombre||'').slice(0,40)}</td>
          <td><span class="badge" style="background:${ac.bg};color:${ac.color};font-size:.65rem">${r.area}</span></td>
          <td class="small">${r.numero_sesion || '—'}</td>
          <td class="small text-nowrap">${r.hora_inicio ? r.hora_inicio.slice(0,5)+'h' : '—'}</td>
          <td><span class="ag-status-badge ag-status-${r.estatus}">${r.estatus}</span></td>
        </tr>`;
        if (r.observaciones) {
            html += `<tr class="bg-light"><td colspan="6" class="small text-muted py-1 ps-4">
                <i class="fas fa-info-circle me-1"></i>${r.observaciones}</td></tr>`;
        }
    });

    html += `</tbody></table></div>`;
    list.innerHTML = html;
    list.style.display = '';
}

/* ─────────────────────────────────────────────────────────────────
   ACUERDOS (LISTA)
───────────────────────────────────────────────────────────────────*/
async function agLoadAcuerdos() {
    const list    = document.getElementById('ag-acuerdos-list');
    const loading = document.getElementById('ag-acuerdos-loading');
    const empty   = document.getElementById('ag-acuerdos-empty');
    if (!list) return;

    if (loading) loading.style.display = '';
    list.style.display = 'none';
    if (empty) empty.classList.add('d-none');

    const sb = _agSB();
    if (!sb) { if (loading) loading.style.display = 'none'; return; }

    const filtEstatus = document.getElementById('ag-acuerdos-filtro-estatus')?.value || '';
    const area = _ag.activeArea || 'all';

    let q = sb.from('agenda_acuerdos')
        .select('*, reunion:reunion_id(fecha_sesion,numero_sesion,comite_id,area)')
        .order('created_at', { ascending: false })
        .limit(200);
    if (filtEstatus) q = q.eq('estatus', filtEstatus);
    if (area !== 'all') q = q.eq('area', area);

    const { data, error } = await q;
    if (loading) loading.style.display = 'none';

    if (error || !data || !data.length) {
        if (empty) empty.classList.remove('d-none');
        return;
    }

    let html = `<div class="table-responsive"><table class="table table-sm table-hover">
      <thead class="table-light"><tr>
        <th>#</th><th>Descripción</th><th>Área</th><th>Responsable</th>
        <th>Fecha límite</th><th>Estatus</th>
      </tr></thead><tbody>`;

    data.forEach(a => {
        const ac = AG_AREA[a.area] || AG_AREA.AFAC;
        const fl = a.fecha_limite ? new Date(a.fecha_limite + 'T00:00:00') : null;
        const vencido = fl && fl < new Date() && a.estatus !== 'Cumplido' && a.estatus !== 'Cancelado';
        html += `<tr class="${vencido?'table-danger':''}">
          <td class="small text-muted">${a.numero_acuerdo || '—'}</td>
          <td class="small">${a.descripcion}</td>
          <td><span class="badge" style="background:${ac.bg};color:${ac.color};font-size:.65rem">${a.area}</span></td>
          <td class="small">${a.responsable || '—'}</td>
          <td class="small text-nowrap">${fl ? fl.getDate()+' '+AG_MONTHS[fl.getMonth()] : '—'}</td>
          <td><span class="ag-status-badge ag-status-${a.estatus}">${a.estatus}</span></td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    list.innerHTML = html;
    list.style.display = '';
}

/* ═══════════════════════════════════════════════════════════════════
   ADMINISTRACIÓN — Módulo de Gestión de Comités y Sesiones
   admin/superadmin → acceso total (todas las áreas)
   editor         → solo puede editar el área asignada (permissions.area)
   Clave de área  → solo su área (nuevo esquema: role = 'DPE', 'GSO', etc.)
═══════════════════════════════════════════════════════════════════ */

/* ── Helpers de permisos ─────────────────────────────────────────── */
function _agUserRole()   { return sessionStorage.getItem('user_role') || 'viewer'; }

// Roles globales (sin área asignada)
const _AG_GLOBAL_ROLES = ['admin','editor','superadmin','director_general','capturista','lector','viewer','colab_viewer','colab_editor'];

// Mapa de compatibilidad con roles legacy de nombre descriptivo
const _AG_ROLE_AREA = {
    operacion:'DO', administracion:'DA', planeacion:'DPE',
    comercial:'DCS', seguridad_op:'GSO', transparencia:'UT', calidad:'GC',
};

function _agIsAdmin()    { return ['admin','superadmin'].includes(_agUserRole()); }

// Puede editar algún comité (tiene área asignada o es admin)
function _agCanEditAny() {
    if (_agIsAdmin()) return true;
    return !!_agUserArea();
}

// Puede editar comités de un área específica
function _agCanEdit(area) {
    if (_agIsAdmin()) return true;
    const userArea = _agUserArea();
    // Guardia null: sin área asignada no puede editar; comité sin área solo admin puede editar
    if (!userArea || !area) return false;
    return userArea === area;
}

// Devuelve la clave de área del usuario actual:
//   1. sessionStorage.user_area (calculado al login)
//   2. mapeo legacy: role 'seguridad_op' → 'GSO', etc.
//   3. role IS la clave directa (nuevo esquema: role='GSO', 'SD-SO', etc.)
function _agUserArea() {
    const stored = sessionStorage.getItem('user_area');
    if (stored) return stored;
    const role = _agUserRole();
    if (_AG_ROLE_AREA[role]) return _AG_ROLE_AREA[role];
    if (!_AG_GLOBAL_ROLES.includes(role)) return role; // role = clave directa
    return null;
}

/* ── Muestra botones admin según rol (llamado después de cargar datos) ── */
function _agShowAdminButtons() {
    const can = _agCanEditAny();
    const b1 = document.getElementById('ag-btn-nueva-reunion');
    const b2 = document.getElementById('ag-btn-nuevo-comite');
    const b3 = document.getElementById('ag-comites-actions');
    const b4 = document.getElementById('ag-btn-nueva-reunion-tab');
    if (b1) b1.style.display = can ? '' : 'none';
    if (b2) b2.style.display = can ? '' : 'none';
    if (b3 && can) b3.style.removeProperty('display');
    if (b4) b4.style.display = can ? '' : 'none';
}

/* ── Helpers UI ──────────────────────────────────────────────────── */
function _agRemoveModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    const inst = bootstrap.Modal.getInstance(m);
    if (inst) { inst.hide(); setTimeout(() => m.remove(), 300); }
    else m.remove();
}
function _agShowModal(id) {
    const m = document.getElementById(id);
    if (m) new bootstrap.Modal(m).show();
}
window._agToast = _agToast;
function _agToast(msg, color = '#1e293b') {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;` +
        `background:${color};color:#fff;padding:10px 18px;border-radius:10px;` +
        `font-size:.85rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.2);` +
        `animation:_ag-toast-in .2s ease`;
    t.textContent = msg;
    if (!document.getElementById('_ag-toast-style')) {
        const s = document.createElement('style');
        s.id = '_ag-toast-style';
        s.textContent = '@keyframes _ag-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
}
function _agRefreshActiveTab() {
    const id = document.querySelector('#ag-main-tabs .nav-link.active')?.id;
    if (id === 'ag-tab-calendario') agLoadCalendario();
    else if (id === 'ag-tab-anual')     agLoadAnual();
    else if (id === 'ag-tab-comites')   agLoadComites();
    else if (id === 'ag-tab-reuniones') agLoadReuniones();
}

/* ══════════════════════════════════════════════════════════════════
   TOGGLE HORARIO FIJO (desde tarjeta, sin abrir modal)
══════════════════════════════════════════════════════════════════ */
async function _agToggleHorarioFijo(comiteId) {
    const comite = _ag.comites.find(c => c.id === comiteId);
    if (!comite || !_agCanEdit(comite.area)) return;
    const newVal = !comite.horario_fijo;
    const sb = _agSB();
    if (!sb) return;
    const btn = document.querySelector(`[data-clock-id="${comiteId}"]`);
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
    const { error } = await sb.from('agenda_comites').update({ horario_fijo: newVal }).eq('id', comiteId);
    if (error) {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        alert('Error al actualizar: ' + error.message);
        return;
    }
    comite.horario_fijo = newVal;
    agLoadComites();
}

/* ══════════════════════════════════════════════════════════════════
   1. EDITAR / NUEVO COMITÉ
══════════════════════════════════════════════════════════════════ */
function agOpenEditComite(comiteId) {
    const comite = comiteId ? _ag.comites.find(c => c.id === comiteId) : null;
    if (comiteId && (!comite || !_agCanEdit(comite.area))) return;
    if (!comiteId && !_agCanEditAny()) return;

    const isAdmin  = _agIsAdmin();
    const userArea = _agUserArea();
    const isNew    = !comiteId;
    const curArea  = comite?.area || userArea || 'DO';
    const ac       = AG_AREA[curArea] || AG_AREA.AFAC;

    /* Integrantes pipe-sep → líneas */
    const integrantesLines = comite?.integrantes
        ? comite.integrantes.split('|').map(s => s.trim()).join('\n')
        : '';

    const FRECS = ['Quincenal','Mensual','Bimestral','Trimestral','Cuatrimestral','Semestral','Anual','Extraordinaria'];
    const AREAS = Object.entries(AG_AREA)
        .map(([k, v]) => `<option value="${k}" ${curArea === k ? 'selected' : ''}>${k} — ${v.name}</option>`)
        .join('');

    const areaHtml = isAdmin
        ? `<select class="form-select form-select-sm" id="_ag-ec-area">${AREAS}</select>`
        : `<input type="text" class="form-control form-control-sm" value="${curArea}" readonly style="background:#f8f9fa">`;

    const numReadonly = (!isAdmin && !isNew) ? 'readonly style="background:#f8f9fa"' : '';

    _agRemoveModal('_ag-edit-comite-modal');

    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="_ag-edit-comite-modal" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content border-0" style="border-radius:14px">
          <div class="modal-header border-0 pb-2" style="background:${ac.bg}">
            <h5 class="modal-title fw-bold" style="color:${ac.color}">
              <i class="fas fa-${isNew ? 'plus-circle' : 'edit'} me-2"></i>
              ${isNew ? 'Nuevo Comité' : 'Editar Comité'}
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div style="height:3px;background:linear-gradient(90deg,${ac.border},${ac.color})"></div>
          <div class="modal-body p-4">
            <input type="hidden" id="_ag-ec-id" value="${comiteId || ''}">
            <div class="row g-3">
              <div class="col-sm-8">
                <label class="form-label small fw-semibold mb-1">Nombre completo <span class="text-danger">*</span></label>
                <input class="form-control form-control-sm" id="_ag-ec-nombre"
                  value="${(comite?.nombre || '').replace(/"/g, '&quot;')}"
                  placeholder="Nombre del comité">
              </div>
              <div class="col-sm-4">
                <label class="form-label small fw-semibold mb-1">Acrónimo</label>
                <input class="form-control form-control-sm" id="_ag-ec-acronimo"
                  value="${comite?.acronimo || ''}" placeholder="Ej: CAAS">
              </div>
              <div class="col-sm-3">
                <label class="form-label small fw-semibold mb-1">Número</label>
                <input class="form-control form-control-sm" id="_ag-ec-numero"
                  value="${comite?.numero || ''}" placeholder="1, 11.1…" ${numReadonly}>
              </div>
              <div class="col-sm-3">
                <label class="form-label small fw-semibold mb-1">Área</label>
                ${areaHtml}
              </div>
              <div class="col-sm-3">
                <label class="form-label small fw-semibold mb-1">Frecuencia</label>
                <select class="form-select form-select-sm" id="_ag-ec-frecuencia">
                  ${FRECS.map(f => `<option ${comite?.frecuencia === f ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
              </div>
              <div class="col-sm-3">
                <label class="form-label small fw-semibold mb-1">Hora de sesión</label>
                <input type="time" class="form-control form-control-sm" id="_ag-ec-hora"
                  value="${comite?.hora_sesion?.slice(0, 5) || ''}">
              </div>
              <div class="col-12">
                <div class="form-check d-flex align-items-center gap-2 p-3 rounded-3"
                     style="background:#fffbeb;border:1.5px solid #fde68a;cursor:pointer"
                     onclick="document.getElementById('_ag-ec-horario-fijo').click()">
                  <input class="form-check-input flex-shrink-0 mt-0" type="checkbox" id="_ag-ec-horario-fijo"
                    onclick="event.stopPropagation()" ${comite?.horario_fijo ? 'checked' : ''}>
                  <label class="form-check-label mb-0" for="_ag-ec-horario-fijo" style="cursor:pointer;user-select:none">
                    <i class="fas fa-clock text-warning me-1"></i>
                    <span class="fw-semibold" style="font-size:.85rem">Horario preestablecido</span>
                    <span class="text-muted d-block" style="font-size:.73rem;line-height:1.3">
                      El comité siempre sesiona en las mismas fechas cada año. Se mostrará un ícono
                      <i class="fas fa-clock text-warning"></i> en el calendario y en la ficha del comité.
                    </span>
                  </label>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">Presidente / Coordinador</label>
                <input class="form-control form-control-sm" id="_ag-ec-presidente"
                  value="${(comite?.presidente || '').replace(/"/g, '&quot;')}"
                  placeholder="Nombre del presidente o coordinador">
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">Descripción general</label>
                <textarea class="form-control form-control-sm" id="_ag-ec-descripcion" rows="2"
                  placeholder="Propósito u objetivo del comité">${comite?.descripcion || ''}</textarea>
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">Fundamento legal / Normativa</label>
                <textarea class="form-control form-control-sm" id="_ag-ec-fundamento" rows="3"
                  placeholder="Artículo, decreto o acuerdo que le da origen…">${comite?.fundamento || ''}</textarea>
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">
                  Integrantes
                  <span class="text-muted fw-normal">(una persona por línea &mdash; Nombre — Cargo)</span>
                </label>
                <textarea class="form-control form-control-sm" id="_ag-ec-integrantes" rows="5"
                  placeholder="Juan Pérez — Director General&#10;María García — Secretaria Técnica">${integrantesLines}</textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-sm btn-primary fw-semibold" onclick="_agSaveComite()">
              <i class="fas fa-save me-1"></i>Guardar cambios
            </button>
          </div>
        </div>
      </div>
    </div>`);

    document.getElementById('_ag-edit-comite-modal')
        .addEventListener('hidden.bs.modal', () => document.getElementById('_ag-edit-comite-modal')?.remove());
    _agShowModal('_ag-edit-comite-modal');
}

async function _agSaveComite() {
    const id     = document.getElementById('_ag-ec-id').value;
    const nombre = document.getElementById('_ag-ec-nombre').value.trim();
    if (!nombre) { alert('El nombre es obligatorio'); return; }

    /* Integrantes: líneas → pipe-sep */
    const integrantes = document.getElementById('_ag-ec-integrantes').value
        .split('\n').map(s => s.trim()).filter(Boolean).join('|') || null;

    const isAdmin = _agIsAdmin();
    const data = {
        nombre,
        acronimo:    document.getElementById('_ag-ec-acronimo').value.trim()    || null,
        descripcion: document.getElementById('_ag-ec-descripcion').value.trim() || null,
        fundamento:  document.getElementById('_ag-ec-fundamento').value.trim()  || null,
        integrantes,
        frecuencia:  document.getElementById('_ag-ec-frecuencia').value         || null,
        hora_sesion:   document.getElementById('_ag-ec-hora').value               || null,
        presidente:    document.getElementById('_ag-ec-presidente').value.trim()  || null,
        horario_fijo:  document.getElementById('_ag-ec-horario-fijo').checked,
    };
    if (isAdmin) {
        data.area   = document.getElementById('_ag-ec-area').value;
        const num   = document.getElementById('_ag-ec-numero').value.trim();
        if (num) data.numero = num;
    }

    const sb = _agSB();
    if (!sb) return;

    let error, savedData;
    if (id) {
        ({ error } = await sb.from('agenda_comites').update(data).eq('id', id));
        if (!error) {
            const prevComite = _ag.comites.find(c => c.id === id) || {};
            window.logHistory?.('EDITAR', 'agenda_comites', id, {
                old: prevComite,
                new: { ...prevComite, ...data },
                summary: `Comité: ${data.nombre || prevComite.nombre}`
            });
        }
    } else {
        if (!data.area) data.area = _agUserArea();
        const { error: insErr, data: insData } = await sb.from('agenda_comites').insert(data).select('id').single();
        error = insErr;
        if (!error) {
            window.logHistory?.('CREAR', 'agenda_comites', insData?.id || null, {
                nombre: data.nombre,
                area: data.area,
                frecuencia: data.frecuencia
            });
        }
    }

    if (error) { alert('Error al guardar: ' + error.message); return; }

    _agRemoveModal('_ag-edit-comite-modal');
    _ag.ready = false;
    await _agEnsureData(true);
    _agRefreshActiveTab();
    /* Si el modal de detalle sigue abierto, refrescarlo con los datos nuevos */
    if (id && document.getElementById('_ag-det-modal')) {
        _agShowComiteDetail(id);
    }
    _agToast(id ? 'Comité actualizado ✓' : 'Comité creado ✓', '#059669');
}

/* ══════════════════════════════════════════════════════════════════
   2. AGREGAR / EDITAR SESIÓN
══════════════════════════════════════════════════════════════════ */
function agOpenEditSesion(sesionId, comiteId) {
    const sesion = sesionId ? _ag.reuniones.find(r => r.id === sesionId) : null;
    const cid    = sesion?.comite_id || comiteId;
    const comite = _ag.comites.find(c => c.id === cid);
    if (!comite || !_agCanEdit(comite.area)) return;

    const ac    = AG_AREA[comite.area] || AG_AREA.AFAC;
    const isNew = !sesionId;

    _agRemoveModal('_ag-edit-sesion-modal');

    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="_ag-edit-sesion-modal" tabindex="-1" style="z-index:1060">
      <div class="modal-dialog modal-dialog-scrollable" style="max-width:480px">
        <div class="modal-content border-0" style="border-radius:14px">
          <div class="modal-header border-0 pb-2" style="background:${ac.bg}">
            <h6 class="modal-title fw-bold" style="color:${ac.color}">
              <i class="fas fa-calendar-${isNew ? 'plus' : 'check'} me-2"></i>
              ${isNew ? 'Nueva Sesión' : 'Editar Sesión'}
              <span class="text-muted fw-normal ms-1" style="font-size:.78rem">
                — ${comite.acronimo || comite.nombre}
              </span>
            </h6>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div style="height:3px;background:linear-gradient(90deg,${ac.border},${ac.color})"></div>
          <div class="modal-body p-4">
            <input type="hidden" id="_ag-es-id"        value="${sesionId || ''}">
            <input type="hidden" id="_ag-es-comite-id" value="${cid || ''}">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">Número / Nombre de sesión</label>
                <input class="form-control form-control-sm" id="_ag-es-numero"
                  value="${(sesion?.numero_sesion || '').replace(/"/g, '&quot;')}"
                  placeholder="Ej: 5a Sesión Ordinaria 2026">
              </div>
              <div class="col-sm-7">
                <label class="form-label small fw-semibold mb-1">Fecha <span class="text-danger">*</span></label>
                <input type="date" class="form-control form-control-sm" id="_ag-es-fecha"
                  value="${sesion?.fecha_sesion || ''}">
              </div>
              <div class="col-sm-5">
                <label class="form-label small fw-semibold mb-1">Hora de inicio</label>
                <input type="time" class="form-control form-control-sm" id="_ag-es-hora"
                  value="${sesion?.hora_inicio?.slice(0, 5) || comite?.hora_sesion?.slice(0, 5) || ''}">
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">Estatus</label>
                <select class="form-select form-select-sm" id="_ag-es-estatus">
                  ${['Programada','Celebrada','Cancelada','Pospuesta'].map(e =>
                      `<option ${(sesion?.estatus || 'Programada') === e ? 'selected' : ''}>${e}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold mb-1">Observaciones</label>
                <textarea class="form-control form-control-sm" id="_ag-es-obs" rows="2"
                  placeholder="Notas, lugar, confirmación pendiente…">${sesion?.observaciones || ''}</textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0 ${!isNew ? 'justify-content-between' : ''}">
            ${!isNew ? `<button class="btn btn-sm btn-outline-danger"
                onclick="_agDeleteSesion('${sesionId}')">
                <i class="fas fa-trash me-1"></i>Eliminar</button>` : ''}
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button class="btn btn-sm btn-primary fw-semibold" onclick="_agSaveSesion()">
                <i class="fas fa-save me-1"></i>Guardar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`);

    document.getElementById('_ag-edit-sesion-modal')
        .addEventListener('hidden.bs.modal', () => document.getElementById('_ag-edit-sesion-modal')?.remove());
    _agShowModal('_ag-edit-sesion-modal');
}

async function _agSaveSesion() {
    const id    = document.getElementById('_ag-es-id').value;
    const cid   = document.getElementById('_ag-es-comite-id').value;
    const fecha = document.getElementById('_ag-es-fecha').value;
    if (!fecha) { alert('La fecha es obligatoria'); return; }

    const comite = _ag.comites.find(c => c.id === cid);
    if (!comite || !_agCanEdit(comite.area)) return;

    const data = {
        comite_id:     cid,
        area:          comite.area,
        numero_sesion: document.getElementById('_ag-es-numero').value.trim() || null,
        fecha_sesion:  fecha,
        hora_inicio:   document.getElementById('_ag-es-hora').value || null,
        estatus:       document.getElementById('_ag-es-estatus').value,
        observaciones: document.getElementById('_ag-es-obs').value.trim() || null,
    };

    const sb = _agSB();
    if (!sb) return;

    let error;
    if (id) {
        ({ error } = await sb.from('agenda_reuniones').update(data).eq('id', id));
        if (!error) {
            const prevSesion = _ag.reuniones.find(r => r.id === id) || {};
            window.logHistory?.('EDITAR', 'agenda_reuniones', id, {
                old: prevSesion,
                new: { ...prevSesion, ...data },
                summary: `Sesión ${data.numero_sesion || prevSesion.numero_sesion || ''} — ${comite?.acronimo || comite?.nombre || ''}`
            });
        }
    } else {
        const { error: insErr, data: insData } = await sb.from('agenda_reuniones').insert(data).select('id').single();
        error = insErr;
        if (!error) {
            window.logHistory?.('CREAR', 'agenda_reuniones', insData?.id || null, {
                comite: comite?.nombre,
                area: data.area,
                fecha: data.fecha_sesion,
                numero_sesion: data.numero_sesion,
                estatus: data.estatus
            });
        }
    }

    if (error) { alert('Error al guardar: ' + error.message); return; }

    _agRemoveModal('_ag-edit-sesion-modal');
    _ag.ready = false;
    await _agEnsureData(true);
    _agRefreshActiveTab();
    /* Si el modal de detalle sigue abierto, refrescarlo con los datos nuevos */
    if (document.getElementById('_ag-det-modal')) {
        _agShowComiteDetail(cid);
    }
    _agToast(id ? 'Sesión actualizada ✓' : 'Sesión agregada ✓', '#2563eb');
}

async function _agDeleteSesion(sesionId) {
    if (!confirm('¿Eliminar esta sesión permanentemente? Esta acción no se puede deshacer.')) return;
    const sesion = _ag.reuniones.find(r => r.id === sesionId);
    if (!sesion) return;
    const comite = _ag.comites.find(c => c.id === sesion.comite_id);
    if (!comite || !_agCanEdit(comite.area)) return;

    const sb = _agSB();
    const { error } = await sb.from('agenda_reuniones').delete().eq('id', sesionId);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    window.logHistory?.('ELIMINAR', 'agenda_reuniones', sesionId, {
        comite: comite?.nombre,
        area: sesion.area,
        fecha: sesion.fecha_sesion,
        numero_sesion: sesion.numero_sesion
    });

    _agRemoveModal('_ag-edit-sesion-modal');
    _ag.ready = false;
    await _agEnsureData(true);
    _agRefreshActiveTab();
    /* Si el modal de detalle sigue abierto, refrescarlo */
    if (document.getElementById('_ag-det-modal') && sesion?.comite_id) {
        _agShowComiteDetail(sesion.comite_id);
    }
    _agToast('Sesión eliminada', '#dc2626');
}

/* ── Selección de comité cuando se abre "Nueva Reunión" ─────────── */
function _agPickComiteForSesion(lista) {
    _agRemoveModal('_ag-pick-comite-modal');
    const opts = lista.map(c => {
        const ac = AG_AREA[c.area] || AG_AREA.AFAC;
        return `<button class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-2"
            onclick="agOpenEditSesion(null,'${c.id}');_agRemoveModal('_ag-pick-comite-modal')">
            <span style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border};
              font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap">${c.area}</span>
            <span style="font-size:.84rem">${c.nombre}</span>
        </button>`;
    }).join('');

    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="_ag-pick-comite-modal" tabindex="-1">
      <div class="modal-dialog modal-dialog-scrollable" style="max-width:520px">
        <div class="modal-content border-0" style="border-radius:14px">
          <div class="modal-header">
            <h6 class="modal-title fw-bold">
              <i class="fas fa-calendar-plus me-2 text-primary"></i>
              ¿A qué comité agregar la sesión?
            </h6>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-2">
            <div class="list-group list-group-flush">${opts}</div>
          </div>
        </div>
      </div>
    </div>`);

    document.getElementById('_ag-pick-comite-modal')
        .addEventListener('hidden.bs.modal', () => document.getElementById('_ag-pick-comite-modal')?.remove());
    _agShowModal('_ag-pick-comite-modal');
}

/* ── Punto de entrada para "Nueva Reunión" (header) ─────────────── */
function agOpenNuevaReunion() {
    if (!_agCanEditAny()) return;
    const area    = _ag.activeArea !== 'all' ? _ag.activeArea : _agUserArea();
    const lista   = area ? _ag.comites.filter(c => c.area === area) : _ag.comites;
    _agPickComiteForSesion(lista);
}

/* ── Punto de entrada para "Nuevo Comité" ──────────────────────── */
function agOpenNuevoComite() {
    agOpenEditComite(null);
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTAR SESIONES A GOOGLE CALENDAR / .ICS
   Muestra un modal con las sesiones próximas del área del usuario.
   Cada evento tiene un link directo a Google Calendar y hay un
   botón para descargar el archivo .ics (compatible con todos los
   calendarios: Google, Apple, Outlook, etc.)
═══════════════════════════════════════════════════════════════════ */
async function agOpenGoogleCalendar() {
    await _agEnsureData();

    const userArea = _agUserArea();
    const isAdmin  = _agIsAdmin();
    const today    = new Date();
    today.setHours(0, 0, 0, 0);

    /* ── Filtrar sesiones próximas (no canceladas) ────────────── */
    let sesiones = _ag.reuniones.filter(r => {
        const d = new Date(r.fecha_sesion + 'T00:00:00');
        return d >= today && r.estatus !== 'Cancelada';
    });
    if (!isAdmin && userArea) {
        sesiones = sesiones.filter(r => r.area === userArea);
    }
    sesiones.sort((a, b) => a.fecha_sesion.localeCompare(b.fecha_sesion));

    /* ── Construir objetos de evento ──────────────────────────── */
    function _padDT(r) {
        const comite  = _ag.comites.find(c => c.id === r.comite_id) || {};
        const dateStr = r.fecha_sesion.replace(/-/g, '');
        const rawHora = r.hora_inicio || comite.hora_sesion || '09:00:00';
        const hora6   = rawHora.replace(/:/g, '').slice(0, 6).padEnd(6, '0');
        const startDT = dateStr + 'T' + hora6;

        /* end = start + 2 h */
        const startD  = new Date(r.fecha_sesion + 'T' + rawHora);
        const endD    = new Date(startD.getTime() + 2 * 3600000);
        const endDT   = endD.getFullYear().toString()
            + String(endD.getMonth() + 1).padStart(2, '0')
            + String(endD.getDate()).padStart(2, '0')
            + 'T'
            + String(endD.getHours()).padStart(2, '0')
            + String(endD.getMinutes()).padStart(2, '0')
            + '00';
        return { startDT, endDT };
    }

    const eventos = sesiones.map(r => {
        const comite  = _ag.comites.find(c => c.id === r.comite_id) || {};
        const ac      = AG_AREA[r.area] || AG_AREA.AFAC;
        const { startDT, endDT } = _padDT(r);
        const title   = [comite.acronimo || comite.nombre || 'Comité',
                         'Sesión ' + (r.numero_sesion || '')].filter(Boolean).join(' – ').trim();
        const details = [
            comite.nombre || '',
            r.observaciones ? 'Observaciones: ' + r.observaciones : '',
            'Área: ' + (ac.name || r.area),
            comite.presidente ? 'Presidente: ' + comite.presidente : '',
        ].filter(Boolean).join('\n');

        const location = 'AIFA – Aeropuerto Internacional Felipe Ángeles, Zumpango, Estado de México';
        const gcalUrl  = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
            + '&text='     + encodeURIComponent(title)
            + '&dates='    + startDT + '/' + endDT
            + '&details='  + encodeURIComponent(details)
            + '&location=' + encodeURIComponent(location);

        return { r, comite, ac, title, startDT, endDT, gcalUrl, details, location };
    });

    /* ── Genera contenido ICS ─────────────────────────────────── */
    function buildICS(evs) {
        const escICS = s => (s || '').toString()
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');

        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//AIFA OPERACIONES//Agenda Comités 2026//ES',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:AIFA – Sesiones 2026',
            'X-WR-TIMEZONE:America/Mexico_City',
        ];
        evs.forEach(ev => {
            lines.push(
                'BEGIN:VEVENT',
                'UID:aifa-sesion-' + ev.r.id + '@aifa.gob.mx',
                'DTSTART;TZID=America/Mexico_City:' + ev.startDT,
                'DTEND;TZID=America/Mexico_City:'   + ev.endDT,
                'SUMMARY:'     + escICS(ev.title),
                'DESCRIPTION:' + escICS(ev.details),
                'LOCATION:'    + escICS(ev.location),
                'STATUS:CONFIRMED',
                'END:VEVENT',
            );
        });
        lines.push('END:VCALENDAR');
        return lines.join('\r\n');
    }

    /* ── Construir filas del modal ────────────────────────────── */
    const areaLabel  = isAdmin ? 'Todas las áreas' : (AG_AREA[userArea]?.name || userArea || 'Tu área');
    const countLabel = eventos.length
        ? `${eventos.length} sesión${eventos.length !== 1 ? 'es' : ''} próxima${eventos.length !== 1 ? 's' : ''}`
        : 'sin sesiones próximas';

    let rows = '';
    if (!eventos.length) {
        rows = `<div class="text-center text-muted py-5">
            <i class="fas fa-calendar-times fa-2x mb-2 d-block"></i>
            No hay sesiones próximas para <strong>${areaLabel}</strong>
        </div>`;
    } else {
        eventos.forEach(ev => {
            const d  = new Date(ev.r.fecha_sesion + 'T00:00:00');
            const ac = ev.ac;
            rows += `
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
              <div class="flex-shrink-0 text-center rounded px-2 py-1"
                   style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border};min-width:54px">
                <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${AG_MONTHS[d.getMonth()]}</div>
                <div style="font-size:1.15rem;font-weight:700;line-height:1.1">${d.getDate()}</div>
                <div style="font-size:.58rem;opacity:.75">${d.getFullYear()}</div>
              </div>
              <div class="flex-grow-1" style="min-width:0">
                <div class="fw-semibold text-truncate" style="font-size:.83rem" title="${ev.title}">${ev.title}</div>
                <div class="text-muted d-flex align-items-center gap-1 flex-wrap mt-1" style="font-size:.72rem">
                  ${ev.r.hora_inicio ? `<span><i class="fas fa-clock me-1"></i>${ev.r.hora_inicio.slice(0,5)} h</span>` : ''}
                  <span class="badge" style="background:${ac.bg};color:${ac.color};border:1px solid ${ac.border};font-size:.6rem">${ev.r.area}</span>
                </div>
              </div>
              <a href="${ev.gcalUrl}" target="_blank" rel="noopener noreferrer"
                 class="btn btn-sm flex-shrink-0"
                 style="background:#1a73e8;color:#fff;font-size:.72rem;white-space:nowrap;padding:5px 10px;border-radius:6px"
                 aria-label="Agregar al calendario de Google: ${ev.title}">
                <i class="fab fa-google me-1"></i><span class="d-none d-sm-inline">Agregar</span><span class="d-sm-none">+</span>
              </a>
            </div>`;
        });
    }

    /* ── Montar y mostrar el modal ────────────────────────────── */
    document.getElementById('_ag-gcal-modal')?.remove();
    const modal = document.createElement('div');
    modal.id        = '_ag-gcal-modal';
    modal.className = 'modal fade';
    modal.setAttribute('tabindex', '-1');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', '_ag-gcal-title');

    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-scrollable" style="max-width:500px">
        <div class="modal-content">
          <div class="modal-header border-0 pb-2 text-white"
               style="background:linear-gradient(135deg,#1a73e8 0%,#0d47a1 100%)">
            <div>
              <h5 class="modal-title mb-0" id="_ag-gcal-title">
                <i class="fab fa-google me-2"></i>Sincronizar con Google Calendar
              </h5>
              <div style="font-size:.74rem;opacity:.85;margin-top:2px">
                ${areaLabel} &middot; ${countLabel}
              </div>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>

          <div class="modal-body px-3 py-2">
            ${eventos.length ? `
            <div class="alert alert-light border mb-2 py-2 px-3" style="font-size:.76rem">
              <i class="fas fa-info-circle me-1 text-primary"></i>
              Haz click en <strong>Agregar</strong> en cada sesión que quieras añadir a tu calendario,
              o descarga el archivo <strong>.ics</strong> para importar todas de una vez.
            </div>` : ''}
            ${rows}
          </div>

          ${eventos.length ? `
          <div class="modal-footer border-0 py-2 justify-content-between flex-wrap gap-2">
            <small class="text-muted" style="font-size:.71rem">
              <i class="fas fa-mobile-alt me-1"></i>
              El archivo .ics se abre directamente con Google Calendar en Android e iOS
            </small>
            <button id="_ag-gcal-ics-btn" class="btn btn-outline-secondary btn-sm" style="font-size:.75rem">
              <i class="fas fa-download me-1"></i>Descargar .ics (${eventos.length})
            </button>
          </div>` : ''}
        </div>
      </div>`;

    document.body.appendChild(modal);

    /* Descargar ICS */
    modal.querySelector('#_ag-gcal-ics-btn')?.addEventListener('click', () => {
        const ics  = buildICS(eventos);
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
            href: url, download: 'aifa-sesiones-2026.ics',
        });
        a.click();
        URL.revokeObjectURL(url);
    });

    modal.addEventListener('hidden.bs.modal', () => modal.remove());
    _agShowModal('_ag-gcal-modal');
}

/* ─────────────────────────────────────────────────────────────────
   HOOK EN showSection — auto-carga al navegar a la sección
───────────────────────────────────────────────────────────────────*/
(function _agPatchNav() {
    function patch() {
        const orig = window.showSection;
        if (typeof orig !== 'function') return false;
        if (orig._agPatched) return true;

        window.showSection = function(sectionKey, linkEl) {
            orig(sectionKey, linkEl);
            if (sectionKey === 'agenda') {
                /* Carga el calendario al entrar a la sección */
                setTimeout(agLoadCalendario, 50);
                /* También carga comités para que el tab esté listo */
                setTimeout(agLoadComites, 80);
            }
        };
        window.showSection._agPatched = true;
        return true;
    }

    if (!patch()) {
        document.addEventListener('DOMContentLoaded', function _agDomReady() {
            if (!patch()) {
                /* Reintentar cada 300ms durante 5s */
                let attempts = 0;
                const timer = setInterval(() => {
                    if (patch() || ++attempts > 16) clearInterval(timer);
                }, 300);
            }
            document.removeEventListener('DOMContentLoaded', _agDomReady);
        });
    }
})();

/* Bootstrap tab events */
document.addEventListener('DOMContentLoaded', function() {
    const TABS_WITH_FILTER  = new Set(['ag-tab-comites','ag-tab-reuniones','ag-tab-acuerdos']);

    document.getElementById('ag-main-tabs')?.addEventListener('shown.bs.tab', function(e) {
        const tabId  = e.target?.id;
        const filter = document.getElementById('ag-area-filters');
        if (filter) filter.style.display = TABS_WITH_FILTER.has(tabId) ? '' : 'none';
    });

    const tabComites = document.getElementById('ag-tab-comites');
    if (tabComites) {
        tabComites.addEventListener('shown.bs.tab', agLoadComites);
    }

    /* Si llegamos con la sección ya activa (recarga directa) */
    const agSection = document.getElementById('agenda-section');
    if (agSection && agSection.classList.contains('active')) {
        agLoadCalendario();
    }

    /* Inicializar estado del botón de notificaciones */
    if (typeof window.agNotificationsInit === 'function') {
        window.agNotificationsInit();
    }
});

