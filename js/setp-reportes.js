(function () {
    'use strict';

    // ============================================================
    // Supervisores de Edificio Terminal (SETP)
    // Filtros, indicadores (tabla setp_reportes) y "Detalle de registros":
    // historial compacto de los reportes (recorridos) de cada supervisor,
    // con "Ver historial" para abrirlo completo en una ventana nueva.
    // ============================================================

    const ROOT_ID = 'setp-root';
    const SECTION_KEY = 'setp';
    const TABLE = 'setp_reportes';
    // Primeros tres slots de la paleta categórica validada (todos los pares).
    const TURNOS = [
        { key: 'MATUTINO', label: 'Matutino', color: '#2a78d6' },
        { key: 'VESPERTINO', label: 'Vespertino', color: '#eb6834' },
        { key: 'NOCTURNO', label: 'Nocturno', color: '#1baf7a' }
    ];
    const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    const state = {
        initialized: false,
        loading: false,
        dbReady: false,
        rows: []
    };

    // ---------- utilidades ----------

    function $(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtNumber(value) {
        return Number(value || 0).toLocaleString('es-MX');
    }

    function fmtPercent(value) {
        if (value == null || !isFinite(value)) return '—';
        return value.toLocaleString('es-MX', { maximumFractionDigits: 1 }) + '%';
    }

    function plain(value) {
        return String(value == null ? '' : value)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .trim().toUpperCase().replace(/\s+/g, ' ');
    }

    function setStatus(message, type) {
        var box = $('setp-status');
        if (!box) return;
        if (!message) {
            box.className = 'alert d-none mb-3';
            box.innerHTML = '';
            return;
        }
        box.className = 'alert alert-' + (type || 'info') + ' mb-3';
        box.innerHTML = message;
    }

    async function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (typeof window.ensureSupabaseClient === 'function') return window.ensureSupabaseClient();
        throw new Error('Cliente Supabase no disponible');
    }

    // Nivel del módulo "setp" que el administrador asigna en Vistas (section_levels).
    function accessLevel() {
        try {
            var role = sessionStorage.getItem('user_role') || '';
            if (role === 'admin' || role === 'superadmin') return 'admin';
            var level = (window.dataManager && window.dataManager.sectionLevels || {})[SECTION_KEY];
            if (level) return level;
            return ['editor', 'gso'].indexOf(role) >= 0 ? 'capture' : 'read';
        } catch (_) {
            return 'read';
        }
    }

    // Compartido con js/setp-formato.js.
    window.setpAccessLevel = accessLevel;

    // ---------- estilos y estructura ----------

    function ensureStyles() {
        if ($('setp-styles')) return;
        var R = '#' + ROOT_ID;
        var style = document.createElement('style');
        style.id = 'setp-styles';
        style.textContent = [
            R + '{--setp-surface:#fff;--setp-ink:#0f172a;--setp-ink-2:#475569;--setp-muted:#64748b;--setp-line:#e2e8f0;}',
            // Modo oscuro (body.dark-mode, script.js): colores del aplicativo.
            'body.dark-mode ' + R + '{--setp-surface:var(--card-bg);--setp-ink:var(--text-color);--setp-ink-2:#c3c9d2;--setp-muted:var(--text-muted-color);--setp-line:var(--border-color);}',
            'body.dark-mode ' + R + ' .setp-kpi,body.dark-mode ' + R + ' .setp-panel{box-shadow:0 6px 16px rgba(0,0,0,.25);}',
            'body.dark-mode ' + R + ' .setp-hist-dot--curso{background:var(--card-bg);box-shadow:inset 0 0 0 2px #fbbf24;}',
            'body.dark-mode ' + R + ' .setp-hist-tag--curso{color:#fbbf24;}',
            R + ' .setp-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:end;justify-content:space-between;margin-bottom:14px;}',
            R + ' .setp-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;}',
            R + ' .setp-filters .form-select{min-width:140px;}',
            R + ' .setp-filters label{font-size:.72rem;font-weight:700;color:var(--setp-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;display:block;}',
            R + ' .setp-actions{display:flex;flex-wrap:wrap;gap:8px;}',
            R + ' .setp-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px;}',
            R + ' .setp-kpi{border:1px solid var(--setp-line);border-radius:16px;background:var(--setp-surface);padding:14px 16px;box-shadow:0 6px 16px rgba(15,23,42,.04);}',
            R + ' .setp-kpi-label{font-size:.7rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--setp-muted);}',
            R + ' .setp-kpi-value{font-size:1.6rem;font-weight:800;color:var(--setp-ink);line-height:1.1;margin-top:8px;overflow-wrap:anywhere;}',
            R + ' .setp-kpi-sub{font-size:.78rem;color:var(--setp-muted);margin-top:6px;}',
            R + ' .setp-kpi-who{font-size:.74rem;color:var(--setp-muted);}',
            R + ' .setp-turnos{display:flex;flex-wrap:wrap;gap:4px 12px;margin:4px 0 2px;}',
            R + ' .setp-turno{display:inline-flex;align-items:center;gap:5px;color:var(--setp-ink-2);white-space:nowrap;}',
            R + ' .setp-turno b{color:var(--setp-ink);font-variant-numeric:tabular-nums;}',
            R + ' .setp-turno i.dot{width:8px;height:8px;border-radius:50%;display:inline-block;}',
            R + ' .setp-turno--top{font-weight:700;color:var(--setp-ink);}',
            R + ' .setp-turno--total{padding-left:10px;border-left:1px solid var(--setp-line);}',
            R + ' .setp-panel{border:1px solid var(--setp-line);border-radius:16px;background:var(--setp-surface);box-shadow:0 6px 16px rgba(15,23,42,.04);min-width:0;}',
            R + ' .setp-panel-head{padding:12px 16px;border-bottom:1px solid var(--setp-line);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}',
            R + ' .setp-panel-title{font-weight:800;color:var(--setp-ink);font-size:.95rem;margin:0;}',
            R + ' .setp-panel-hint{font-size:.74rem;color:var(--setp-muted);}',
            R + ' .setp-table th{white-space:nowrap;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--setp-ink-2);}',
            R + ' .setp-table td{vertical-align:middle;font-size:.85rem;}',
            R + ' .setp-actions .dropdown-menu{min-width:320px;max-height:420px;overflow:auto;}',
            R + ' .setp-empty{padding:28px 16px;text-align:center;color:var(--setp-muted);}',
            R + ' .setp-detail{max-height:420px;overflow:auto;}',
            R + ' .setp-hist{list-style:none;margin:0;padding:0;}',
            R + ' .setp-hist li{display:flex;align-items:center;gap:12px;padding:9px 16px;border-bottom:1px solid var(--setp-line);}',
            R + ' .setp-hist li:last-child{border-bottom:0;}',
            R + ' .setp-hist-dot{width:10px;height:10px;border-radius:50%;flex:none;background:#2a78d6;}',
            R + ' .setp-hist-dot--curso{background:#fff;box-shadow:inset 0 0 0 2px #b45309;}',
            R + ' .setp-hist-main{min-width:0;flex:1;}',
            R + ' .setp-hist-when{font-size:.86rem;color:var(--setp-ink);}',
            R + ' .setp-hist-sub{font-size:.76rem;color:var(--setp-muted);overflow-wrap:anywhere;}',
            R + ' .setp-hist-tag{font-size:.72rem;font-weight:700;white-space:nowrap;color:var(--setp-ink-2);}',
            R + ' .setp-hist-tag--curso{color:#b45309;}',
            R + ' .setp-hist-btn{white-space:nowrap;flex:none;}',
            R + ' .setp-detail-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
            R + ' #setp-detail-usuario{width:auto;min-width:220px;}',
            '@media (max-width:575px){' + R + ' .setp-hist li{flex-wrap:wrap;}' + R + ' .setp-hist-btn{width:100%;}}',
            '@media (max-width:1199px){' + R + ' .setp-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}}',
            '@media (max-width:575px){' + R + ' .setp-kpis{grid-template-columns:1fr;}}',
            // Responsive por ancho del módulo (no de la ventana): así también se
            // acomoda cuando el menú lateral le quita espacio. Las tablas de
            // js/setp-recorridos.js y js/setp-formato.js usan este contenedor.
            R + '{container-type:inline-size;container-name:setp;}',
            '#setp-section .section-heading{font-size:clamp(1.3rem,4.6vw,2rem);overflow-wrap:anywhere;}',
            '@container setp (max-width:599.98px){',
            R + ' .setp-toolbar{flex-direction:column;align-items:stretch;}',
            R + ' .setp-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));}',
            R + ' .setp-filters > div:first-child{grid-column:1/-1;}',
            R + ' .setp-filters .form-select{min-width:0;width:100%;}',
            R + ' .setp-actions .btn{flex:1 1 auto;}',
            R + ' .setp-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}',
            R + ' .setp-kpi{padding:10px 12px;border-radius:12px;}',
            R + ' .setp-kpi:nth-child(n+3){grid-column:1/-1;}',
            R + ' .setp-kpi-value{font-size:1.3rem;margin-top:4px;}',
            R + ' .setp-panel{border-radius:12px;}',
            R + ' .setp-panel-head{padding:10px 12px;}',
            R + ' .setp-detail-tools,' + R + ' #setp-detail-usuario{width:100%;min-width:0;}',
            R + ' .setp-hist li{padding:9px 12px;}',
            '}',
            // Pantallas táctiles (celular y tableta): controles de al menos 40 px y
            // letra de 16 px en campos para que iOS no acerque la página al tocarlos.
            '@media (pointer:coarse){',
            R + ' .btn-sm{min-height:40px;}',
            R + ' .form-select-sm,' + R + ' .form-control-sm{min-height:40px;font-size:16px;}',
            R + ' .btn-group-sm > .btn{min-width:40px;}',
            '}'
        ].join('');
        document.head.appendChild(style);
    }

    function renderShell() {
        var root = $(ROOT_ID);
        if (!root) return;
        root.innerHTML = [
            '<div id="setp-status" class="alert d-none mb-3"></div>',
            '<div class="setp-toolbar">',
            '  <div class="setp-filters" role="group" aria-label="Filtros del reporte SETP">',
            // El filtro Supervisor se retiró de la pantalla: el supervisor es el usuario
            // que inició sesión (supervisorDeSesion). Este select oculto sólo guarda
            // su No. de empleado para el resto del módulo.
            '    <select id="setp-f-supervisor" hidden aria-hidden="true" tabindex="-1"></select>',
            '  </div>',
            '  <div class="setp-actions">',
            '    <button type="button" class="btn btn-sm btn-primary d-none" id="setp-crear-usuario"><i class="fas fa-user-plus me-1"></i>Crear usuario</button>',
            '    <button type="button" class="btn btn-sm btn-outline-primary d-none" id="setp-editar-usuario"><i class="fas fa-user-pen me-1"></i>Editar usuario</button>',
            '    <button type="button" class="btn btn-sm btn-outline-danger d-none" id="setp-eliminar-usuario"><i class="fas fa-user-xmark me-1"></i>Eliminar usuario</button>',
            '  </div>',
            '</div>',
            '<div class="setp-kpis" id="setp-kpis"></div>',
            '<div class="setp-panel mb-3">',
            '  <div class="setp-panel-head"><h3 class="setp-panel-title">Supervisor por turno</h3><span class="setp-panel-hint">Recorridos de supervisión</span></div>',
            '  <div id="setp-recorridos-wrap"></div>',
            '  <div id="setp-reporte-hallazgos"></div>',
            '</div>',
            '<div class="setp-panel">',
            '  <div class="setp-panel-head"><h3 class="setp-panel-title">Detalle de registros</h3>',
            '    <div class="setp-detail-tools">',
            '      <span class="setp-panel-hint" id="setp-detail-hint"></span>',
            '      <label class="visually-hidden" for="setp-detail-usuario">Consultar historial de</label>',
            '      <select id="setp-detail-usuario" class="form-select form-select-sm" title="Consulta el historial de registros de cualquier usuario"></select>',
            '    </div>',
            '  </div>',
            '  <div class="setp-detail" id="setp-detail"></div>',
            '</div>'
        ].join('');
    }

    // ---------- datos ----------

    async function loadRows() {
        var sb;
        try {
            sb = await getClient();
        } catch (error) {
            state.dbReady = false;
            state.rows = [];
            setStatus('Supabase no está disponible. No es posible cargar los registros de SETP.', 'warning');
            return;
        }
        var all = [];
        var pageSize = 1000;
        for (var from = 0; ; from += pageSize) {
            var res = await sb.from(TABLE).select('*')
                .order('fecha', { ascending: false })
                .order('created_at', { ascending: false })
                .range(from, from + pageSize - 1);
            if (res.error) {
                state.dbReady = false;
                state.rows = [];
                setStatus('La tabla <code>' + TABLE + '</code> aún no está disponible. Aplica primero <code>db/create_setp_reportes.sql</code> en Supabase para habilitar el módulo.', 'warning');
                return;
            }
            all = all.concat(res.data || []);
            if (!res.data || res.data.length < pageSize) break;
        }
        state.dbReady = true;
        state.rows = all;
    }

    // Los filtros Mes, Año y Supervisor se retiraron.
    function fillFilters() {
        fillSupervisores();
    }

    function palabras(value) {
        return plain(value).replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    }

    // Supervisor de setp_supervisores que corresponde al usuario que inició
    // sesión: todas las palabras de su nombre están en el nombre del perfil
    // (sin acentos, mayúsculas ni orden). Si hay varios, el más completo.
    // '' = el usuario no es supervisor (p. ej. un superadmin): ve a todos.
    function supervisorDeSesion(list) {
        var yo = [];
        try { yo = palabras(sessionStorage.getItem('user_fullname')); } catch (_) { }
        if (!yo.length) return '';
        var mejor = null, largo = 0;
        (list || []).forEach(function (s) {
            var p = palabras(s.nombre);
            if (p.length > largo && p.every(function (w) { return yo.indexOf(w) >= 0; })) { mejor = s; largo = p.length; }
        });
        return mejor ? mejor.no_empleado : '';
    }

    // Supervisores dados de alta en setp_supervisores (js/setp-recorridos.js).
    // El valor de cada opción es el No. de empleado; queda elegido el del usuario.
    // detalleNo: usuario a mostrar en "Detalle de registros" (el recién creado
    // o editado); si no se da, el Detalle muestra al propio usuario.
    function fillSupervisores(detalleNo) {
        var list = window.setpRecorridos ? window.setpRecorridos.supervisores() : [];
        var supSel = $('setp-f-supervisor');
        var propio = supervisorDeSesion(list);
        supSel.innerHTML = '<option value=""></option>' + list.map(function (s) {
            return '<option value="' + esc(s.no_empleado) + '">' + esc(s.nombre) + '</option>';
        }).join('');
        supSel.value = propio;
        fillUsuarioDetalle(list, detalleNo || propio);
        if (window.setpRecorridos) window.setpRecorridos.select(propio);
    }

    // "Detalle de registros" tiene su propio selector de usuario: cualquiera
    // puede consultar el historial de otro (Luis el de Tania y viceversa) sin
    // cambiar el supervisor que captura en "Supervisor × turno".
    // Arranca en el propio usuario.
    function fillUsuarioDetalle(list, valor) {
        var sel = $('setp-detail-usuario');
        if (!sel) return;
        list = list || (window.setpRecorridos ? window.setpRecorridos.supervisores() : []);
        sel.innerHTML = '<option value="">Todos los usuarios</option>' + list.map(function (s) {
            return '<option value="' + esc(s.no_empleado) + '">' + esc(s.nombre) + '</option>';
        }).join('');
        sel.value = list.some(function (s) { return s.no_empleado === valor; }) ? valor : '';
    }

    function usuarioDetalle() {
        var sel = $('setp-detail-usuario');
        var opt = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex] : null;
        return { no: sel ? sel.value : '', nombre: opt ? opt.textContent : '' };
    }

    function getFilters() {
        var supSel = $('setp-f-supervisor');
        var supOpt = supSel.selectedIndex > 0 ? supSel.options[supSel.selectedIndex] : null;
        return {
            year: '', // filtros Mes y Año retirados
            month: '',
            turno: '', // filtro Turno eliminado
            supervisor: supOpt ? supOpt.textContent : '',
            noEmpleado: supSel.value
        };
    }

    function applyFilters(rows, f) {
        return rows.filter(function (r) {
            var y = String(r.fecha).slice(0, 4);
            var m = Number(String(r.fecha).slice(5, 7));
            if (f.year && y !== f.year) return false;
            if (f.month && m !== Number(f.month)) return false;
            if (f.turno && r.turno !== f.turno) return false;
            if (f.supervisor && plain(r.supervisor) !== plain(f.supervisor)) return false;
            return true;
        });
    }

    function periodLabel(f) {
        if (f.month && f.year) return MONTH_NAMES[f.month - 1] + ' ' + f.year;
        if (f.month) return MONTH_NAMES[f.month - 1] + ' (todos los años)';
        if (f.year) return String(f.year);
        return 'todo el histórico';
    }

    function aggregateBySupervisor(rows) {
        var map = {};
        rows.forEach(function (r) {
            var s = map[r.supervisor] || (map[r.supervisor] = { supervisor: r.supervisor, total: 0, cerrados: 0, ultimo: '', MATUTINO: 0, VESPERTINO: 0, NOCTURNO: 0 });
            s.total++;
            s[r.turno] = (s[r.turno] || 0) + 1;
            if (r.estatus === 'CERRADO') s.cerrados++;
            if (String(r.fecha) > s.ultimo) s.ultimo = String(r.fecha);
        });
        return Object.values(map).sort(function (a, b) { return b.total - a.total || a.supervisor.localeCompare(b.supervisor, 'es'); });
    }

    // ---------- render ----------

    function render() {
        var f = getFilters();
        var rows = applyFilters(state.rows, f);
        var bySup = aggregateBySupervisor(rows);
        renderKpis(rows, bySup, f);
        renderDetail();
        pintarBotonesUsuario();
    }

    // Crear, editar y eliminar usuario: sólo superadmin. Editar y eliminar
    // actúan sobre el usuario elegido en "Detalle de registros".
    function pintarBotonesUsuario() {
        var superadmin = !!(window.setpRecorridos && window.setpRecorridos.puedeCrearUsuario());
        var elegido = $('setp-detail-usuario') ? $('setp-detail-usuario').value : '';
        ['setp-crear-usuario', 'setp-editar-usuario', 'setp-eliminar-usuario'].forEach(function (id) {
            var btn = $(id);
            if (btn) btn.classList.toggle('d-none', !superadmin);
        });
        ['setp-editar-usuario', 'setp-eliminar-usuario'].forEach(function (id) {
            var btn = $(id);
            if (!btn) return;
            btn.disabled = !elegido;
            btn.title = elegido ? '' : 'Elige un usuario en "Detalle de registros"';
        });
    }

    function kpi(label, value, sub) {
        return '<div class="setp-kpi"><div class="setp-kpi-label">' + label + '</div><div class="setp-kpi-value">' + value + '</div><div class="setp-kpi-sub">' + sub + '</div></div>';
    }

    // "Turno con más recorridos": recorridos del supervisor elegido (o de todos)
    // por turno —el que el supervisor eligió al iniciar— y la suma total.
    function kpiTurnos(f) {
        var label = 'Turno con más recorridos';
        var rec = window.setpRecorridos;
        var resumen = rec ? rec.resumen() : [];
        if (!resumen) return kpi(label, '…', 'Cargando recorridos…');
        if (!rec.turnoDisponible()) return kpi(label, '—', 'Para contar por turno aplica <code>db/setp_recorridos_turno.sql</code> en Supabase.');
        var lista = resumen.filter(function (r) { return !f.noEmpleado || r.no_empleado === f.noEmpleado; });
        var cuenta = TURNOS.map(function (t) {
            return { t: t, n: lista.filter(function (r) { return r.turno === t.key; }).length };
        });
        var total = cuenta.reduce(function (s, c) { return s + c.n; }, 0);
        var max = Math.max.apply(null, cuenta.map(function (c) { return c.n; }));
        var top = total ? cuenta.filter(function (c) { return c.n === max; }) : [];
        var sinTurno = lista.length - total;
        var sub = '<div class="setp-kpi-who">' + esc(f.noEmpleado ? f.supervisor : 'Todos los supervisores') + '</div>' +
            '<div class="setp-turnos">' + cuenta.map(function (c) {
                var esTop = top.indexOf(c) >= 0;
                return '<span class="setp-turno' + (esTop ? ' setp-turno--top' : '') + '"><i class="dot" style="background:' + c.t.color + '"></i>' +
                    c.t.label + ' <b>' + fmtNumber(c.n) + '</b></span>';
            }).join('') +
            '<span class="setp-turno setp-turno--total">Total <b>' + fmtNumber(total) + '</b></span></div>' +
            (sinTurno ? '<div class="setp-kpi-who">' + fmtNumber(sinTurno) + (sinTurno === 1 ? ' recorrido sin turno' : ' recorridos sin turno') + '</div>' : '');
        return kpi(label, top.length ? top.map(function (c) { return c.t.label; }).join(' y ') : '—', sub);
    }

    function renderKpis(rows, bySup, f) {
        var cerrados = rows.filter(function (r) { return r.estatus === 'CERRADO'; }).length;
        var conEstatus = rows.filter(function (r) { return r.estatus; }).length;
        var top = bySup[0];
        $('setp-kpis').innerHTML = [
            kpi('Registros', fmtNumber(rows.length), 'Periodo: ' + esc(periodLabel(f))),
            kpi('Supervisores', fmtNumber(bySup.length), top ? 'Más registros: ' + esc(top.supervisor) + ' (' + fmtNumber(top.total) + ')' : 'Sin registros'),
            kpiTurnos(f),
            kpi('Cierre', conEstatus ? fmtPercent(cerrados / conEstatus * 100) : '—', fmtNumber(cerrados) + ' cerrados de ' + fmtNumber(conEstatus) + ' con estatus')
        ].join('');
    }

    // ---------- Detalle de registros (historial compacto) ----------

    function fechaDe(ts) {
        var d = ts ? new Date(ts) : null;
        return d && !isNaN(d) ? d : null;
    }

    function hhmm(time) {
        return time ? String(time).slice(0, 5) : '';
    }

    // Cada recorrido es un punto del historial de su supervisor. Se filtra por
    // Supervisor, Mes y Año (los recorridos no tienen turno).
    function renderDetail() {
        var box = $('setp-detail');
        var hint = $('setp-detail-hint');
        if (!box) return;
        var f = getFilters();
        // El usuario lo elige el selector propio del Detalle (no el filtro Supervisor).
        var u = usuarioDetalle();
        f.noEmpleado = u.no;
        f.supervisor = u.nombre;

        var rec = window.setpRecorridos;
        var todos = rec ? rec.recorridos() : [];
        if (!todos) {
            hint.textContent = '';
            box.innerHTML = '<div class="setp-empty"><span class="spinner-border spinner-border-sm me-2"></span>Cargando historial…</div>';
            return;
        }
        var nombres = {};
        rec.supervisores().forEach(function (s) { nombres[s.no_empleado] = s.nombre; });
        var lista = todos.filter(function (r) {
            if (f.noEmpleado && r.no_empleado !== f.noEmpleado) return false;
            var d = fechaDe(r.registrado_en);
            if (f.year && (!d || String(d.getFullYear()) !== f.year)) return false;
            if (f.month && (!d || d.getMonth() + 1 !== Number(f.month))) return false;
            return true;
        });
        hint.textContent = lista.length ? fmtNumber(lista.length) + (lista.length === 1 ? ' reporte' : ' reportes') + (rec.recorridosCompletos() ? '' : ' recientes') : '';
        if (!lista.length) {
            var vacio = !todos.some(function (r) { return !f.noEmpleado || r.no_empleado === f.noEmpleado; });
            box.innerHTML = '<div class="setp-empty">' + (vacio && f.noEmpleado
                ? 'Aún no hay reportes de <b>' + esc(f.supervisor) + '</b>. Al presionar <b>Iniciar recorrido</b> aparecerá aquí su primer punto de historial.'
                : vacio ? 'Aún no hay reportes registrados.' : 'No hay reportes con los filtros seleccionados.') + '</div>';
            return;
        }
        box.innerHTML = '<ul class="setp-hist">' + lista.map(function (r) {
            var d = fechaDe(r.registrado_en);
            var dia = d ? d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
            var enCurso = !r.hora_termino;
            var sub = [];
            if (!f.noEmpleado) sub.push(esc(nombres[r.no_empleado] || r.no_empleado));
            sub.push(esc(r.area_recorrido));
            if (r.evidencia_url) sub.push('<i class="fas ' + (r.evidencia_tipo === 'FOTO' ? 'fa-camera' : 'fa-paperclip') + '" title="Con evidencia"></i> Evidencia');
            return '<li><span class="setp-hist-dot' + (enCurso ? ' setp-hist-dot--curso' : '') + '" aria-hidden="true"></span>' +
                '<div class="setp-hist-main"><div class="setp-hist-when"><b>' + dia + '</b> · ' + esc(hhmm(r.hora_inicio)) + ' hrs</div>' +
                '<div class="setp-hist-sub">' + sub.join(' · ') + '</div></div>' +
                (enCurso
                    ? '<span class="setp-hist-tag setp-hist-tag--curso"><i class="fas fa-circle-play me-1"></i>En curso</span>'
                    : '<span class="setp-hist-tag"><i class="fas fa-flag-checkered me-1"></i>Finalizado ' + esc(hhmm(r.hora_termino)) + '</span>') +
                '<button type="button" class="btn btn-sm btn-outline-primary setp-hist-btn" data-hist-no="' + esc(r.no_empleado) + '" data-hist-id="' + esc(r.id) + '"' +
                ' title="Abrir el historial de ' + esc(nombres[r.no_empleado] || r.no_empleado) + ' en una ventana nueva"><i class="fas fa-clock-rotate-left me-1"></i>Ver historial</button>' +
                '</li>';
        }).join('') + '</ul>';
    }

    // ---------- ciclo de vida ----------

    function bindEvents() {
        // Consultar el historial de otro usuario cambia el Detalle y el
        // usuario sobre el que actúan Editar y Eliminar (superadmin).
        $('setp-detail-usuario').addEventListener('change', function () {
            renderDetail();
            pintarBotonesUsuario();
        });
        $('setp-crear-usuario').addEventListener('click', function () {
            if (window.setpRecorridos) window.setpRecorridos.crearUsuario();
        });
        $('setp-editar-usuario').addEventListener('click', function () {
            if (window.setpRecorridos) window.setpRecorridos.editarUsuario($('setp-detail-usuario').value);
        });
        $('setp-eliminar-usuario').addEventListener('click', function () {
            if (window.setpRecorridos) window.setpRecorridos.eliminarUsuario($('setp-detail-usuario').value);
        });
        // "Ver historial" de cada registro: abre el historial de su supervisor con ese registro resaltado.
        $('setp-detail').addEventListener('click', function (e) {
            var b = e.target.closest('[data-hist-no]');
            if (b && window.setpRecorridos) window.setpRecorridos.abrirHistorial(b.getAttribute('data-hist-no'), b.getAttribute('data-hist-id'));
        });
        // El usuario recién creado o editado queda elegido en el Detalle;
        // al eliminarlo, el Detalle vuelve al propio usuario.
        ['setp:supervisor-creado', 'setp:supervisor-editado', 'setp:supervisor-eliminado'].forEach(function (name) {
            document.addEventListener(name, function (e) {
                fillSupervisores(name === 'setp:supervisor-eliminado' ? '' : e.detail && e.detail.no_empleado);
                render();
            });
        });
        // Cada recorrido iniciado, finalizado o borrado se refleja en el historial.
        // También la tarjeta "Turno con más recorridos".
        document.addEventListener('setp:recorridos-actualizados', render);
    }

    function init() {
        if (state.initialized) return;
        if (!$(ROOT_ID)) return;
        state.initialized = true;
        ensureStyles();
        renderShell();
        bindEvents();
    }

    async function refresh() {
        if (state.loading) return;
        state.loading = true;
        var btn = $('setp-refresh');
        if (btn) btn.disabled = true;
        // Tabla de reporte de hallazgos (js/setp-formato.js), con su propia carga.
        if (window.setpFormato) window.setpFormato.mountReport($('setp-reporte-hallazgos'));
        // Supervisores y recorridos (js/setp-recorridos.js): el filtro Supervisor los usa.
        var recorridos = window.setpRecorridos ? window.setpRecorridos.mount($('setp-recorridos-wrap')) : Promise.resolve();
        try {
            await Promise.all([loadRows(), recorridos]);
            if (state.dbReady) setStatus('');
            fillFilters();
            render();
        } catch (error) {
            setStatus('No se pudieron cargar los registros: ' + esc(error && error.message ? error.message : error), 'danger');
        } finally {
            state.loading = false;
            if (btn) btn.disabled = false;
        }
    }

    function isSectionVisible() {
        var section = $(SECTION_KEY + '-section');
        return !!section && (section.classList.contains('active') || section.offsetParent !== null);
    }

    async function activateModule() {
        init();
        // Sección exclusiva (script.js, SETP_PERSONAS_CON_ACCESO): no cargar datos a nadie más.
        if (typeof window.puedeVerSetp === 'function' && !window.puedeVerSetp()) return;
        if (!isSectionVisible()) return;
        await refresh();
    }

    document.addEventListener('DOMContentLoaded', function () {
        init();
        if (isSectionVisible()) activateModule();
    });

    (function patchShowSection() {
        var previousShowSection = window.showSection;
        if (typeof previousShowSection !== 'function') {
            document.addEventListener('DOMContentLoaded', patchShowSection, { once: true });
            return;
        }
        if (previousShowSection.__setpPatched) return;
        window.showSection = function (id) {
            var result = previousShowSection.apply(this, arguments);
            if (id === SECTION_KEY) activateModule();
            return result;
        };
        window.showSection.__setpPatched = true;
    })();

    window.initSetpReportes = activateModule;
})();
