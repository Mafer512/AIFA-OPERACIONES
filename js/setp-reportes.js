(function () {
    'use strict';

    // ============================================================
    // Supervisores de Edificio Terminal (SETP)
    // Indicadores (a partir de los recorridos) y "Detalle de registros":
    // historial compacto de los reportes (recorridos) de cada supervisor,
    // con "Ver historial" para abrirlo completo en una ventana nueva.
    // ============================================================

    const ROOT_ID = 'setp-root';
    const SECTION_KEY = 'setp';
    // Primeros tres slots de la paleta categórica validada (todos los pares).
    const TURNOS = [
        { key: 'VESPERTINO', label: 'Vespertino', color: '#eb6834' },
        { key: 'NOCTURNO', label: 'Nocturno', color: '#1baf7a' }
    ];

    const state = {
        initialized: false,
        loading: false
    };

    // Periodo cargado: meses hacia atrás desde hoy (0 = todo el histórico).
    const MESES_INICIALES = 3;
    const PASO_MESES = 3;
    const periodo = { meses: 0, desde: '' };
    ponerPeriodo(MESES_INICIALES);
    window.setpPeriodo = {
        // 'YYYY-MM-DD' desde donde se cargan los datos ('' = todo el histórico).
        desde: function () { return periodo.desde; },
        meses: function () { return periodo.meses; }
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
            R + ' .setp-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px;}',
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
            // Detalle agrupado por día: un renglón por día que se despliega.
            R + ' .setp-dia{border-bottom:1px solid var(--setp-line);}',
            R + ' .setp-dia:last-child{border-bottom:0;}',
            R + ' .setp-dia > summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:10px 16px;}',
            R + ' .setp-dia > summary::-webkit-details-marker{display:none;}',
            R + ' .setp-dia > summary:hover{background:rgba(100,116,139,.08);}',
            R + ' .setp-dia-chev{flex:none;width:14px;color:var(--setp-muted);transition:transform .15s;}',
            R + ' .setp-dia[open] > summary .setp-dia-chev{transform:rotate(90deg);}',
            R + ' .setp-dia-fecha{font-size:.88rem;color:var(--setp-ink);}',
            R + ' .setp-dia-fecha span{color:var(--setp-muted);font-weight:400;}',
            R + ' .setp-dia-res{flex:1;min-width:0;font-size:.76rem;color:var(--setp-muted);text-align:right;overflow-wrap:anywhere;}',
            R + ' .setp-dia-res b{color:var(--setp-ink);}',
            R + ' .setp-dia-res .setp-hist-tag--curso{font-size:.76rem;}',
            R + ' .setp-dia .setp-hist{border-top:1px solid var(--setp-line);}',
            R + ' .setp-dia .setp-hist li{padding-left:42px;}',
            '@media (prefers-reduced-motion:reduce){' + R + ' .setp-dia-chev{transition:none;}}',
            R + ' .setp-detail-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
            // Título centrado exacto: ocupa todo el ancho del encabezado y el
            // ícono y el texto se centran juntos como un solo bloque.
            R + ' .setp-head-rep{flex:1 1 100%;min-width:0;display:flex;justify-content:center;align-items:center;}',
            R + ' .setp-rep-title{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-weight:800;color:var(--setp-ink);font-size:.9rem;line-height:1.2;margin:0;text-align:center;}',
            R + ' .setp-rep-title i{flex:none;}',
            R + ' .setp-detail-left{display:flex;align-items:center;gap:10px 20px;flex-wrap:wrap;min-width:0;}',
            R + ' .setp-detail-periodo{display:flex;align-items:center;gap:6px;min-width:0;}',
            R + ' .setp-detail-periodo label{font-size:.72rem;font-weight:700;color:var(--setp-muted);text-transform:uppercase;letter-spacing:.05em;margin:0;}',
            R + ' .setp-detail-periodo input{width:145px;min-width:0;}',
            R + ' .setp-detail-al{font-size:.8rem;color:var(--setp-muted);}',
            R + ' #setp-detail-usuario{width:auto;min-width:220px;}',
            // Barra del periodo cargado (últimos 3 meses, más o todo el histórico).
            R + ' .setp-periodo{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;border:1px solid var(--setp-line);border-radius:12px;background:var(--setp-surface);padding:8px 12px;margin-bottom:12px;font-size:.82rem;color:var(--setp-muted);}',
            R + ' .setp-periodo:empty{display:none;}',
            R + ' .setp-periodo b{color:var(--setp-ink);}',
            R + ' .setp-periodo-ico{color:#1c7ed6;}',
            R + ' .setp-periodo-txt{flex:1 1 auto;min-width:0;}',
            R + ' .setp-periodo-btns{display:flex;gap:8px;flex-wrap:wrap;}',
            R + ' .setp-periodo-btn{border:1px solid #a5d8ff;background:#e7f5ff;color:#1864ab;border-radius:999px;padding:4px 12px;font-size:.78rem;font-weight:600;line-height:1.4;}',
            R + ' .setp-periodo-btn:hover{background:#d0ebff;}',
            R + ' .setp-periodo-btn--sec{background:transparent;border-color:var(--setp-line);color:var(--setp-ink-2);}',
            R + ' .setp-periodo-btn--sec:hover{background:rgba(100,116,139,.1);}',
            R + ' .setp-periodo-btn:disabled{opacity:.55;}',
            'body.dark-mode ' + R + ' .setp-periodo-btn:not(.setp-periodo-btn--sec){background:rgba(77,171,247,.15);border-color:rgba(77,171,247,.45);color:#8cc8ff;}',
            'body.dark-mode ' + R + ' .setp-periodo-ico{color:#4dabf7;}',
            // Mientras carga: barras grises en lugar de ceros.
            R + ' .setp-sk{display:block;height:12px;border-radius:6px;background:var(--setp-line);animation:setp-sk 1.2s ease-in-out infinite;}',
            R + ' .setp-sk--valor{height:26px;margin-top:4px;}',
            '@keyframes setp-sk{0%,100%{opacity:1;}50%{opacity:.45;}}',
            '@media (prefers-reduced-motion:reduce){' + R + ' .setp-sk{animation:none;}}',
            '@media (pointer:coarse){' + R + ' .setp-periodo-btn{min-height:40px;padding:6px 14px;}}',
            '@media (max-width:575px){' + R + ' .setp-hist li{flex-wrap:wrap;}' + R + ' .setp-hist-btn{width:100%;}}',
            '@media (max-width:1199px){' + R + ' .setp-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}' + R + ' .setp-kpi:nth-child(3){grid-column:1/-1;}}',
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
            R + ' .setp-detail-tools,' + R + ' #setp-detail-usuario,' + R + ' .setp-detail-left,' + R + ' .setp-detail-periodo{width:100%;min-width:0;}',
            R + ' .setp-detail-periodo input{flex:1 1 0;width:auto;}',
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
            // El filtro Supervisor se retiró de la pantalla: el supervisor es el usuario
            // que inició sesión (supervisorDeSesion). Este select oculto sólo guarda
            // su No. de empleado para el resto del módulo. Los botones Crear, Editar y
            // Eliminar usuario también se retiraron (la barra quedó vacía).
            '<select id="setp-f-supervisor" hidden aria-hidden="true" tabindex="-1"></select>',
            '<div class="setp-periodo" id="setp-periodo" role="status" aria-live="polite"></div>',
            '<div class="setp-kpis" id="setp-kpis"></div>',
            '<div class="setp-panel mb-3">',
            // Tarjeta de recorridos de supervisión (antes titulada "Supervisor por turno").
            '  <div class="setp-panel-head">',
            // Qué contiene la tarjeta: el Reporte de hallazgos.
            '    <div class="setp-head-rep"><h4 class="setp-rep-title"><i class="fas fa-clipboard-list text-primary" aria-hidden="true"></i>Reporte de hallazgos en recorridos</h4></div>',
            '  </div>',
            '  <div id="setp-recorridos-wrap"></div>',
            '  <div id="setp-reporte-hallazgos"></div>',
            '</div>',
            '<div class="setp-panel">',
            '  <div class="setp-panel-head"><div class="setp-detail-left"><h3 class="setp-panel-title">Detalle de registros</h3>',
            // PERIODO: días que muestra el Detalle (y periodo del Reporte de hallazgos, js/setp-formato.js).
            '    <div class="setp-detail-periodo" role="group" aria-label="Periodo">',
            '      <label for="setp-rep-desde">Periodo</label><input type="date" id="setp-rep-desde" class="form-control form-control-sm" aria-label="Periodo desde">',
            '      <span class="setp-detail-al">al</span><input type="date" id="setp-rep-hasta" class="form-control form-control-sm" aria-label="Periodo hasta">',
            '    </div>',
            // Abre los formatos guardados (js/setp-formato.js).
            '    <button type="button" class="btn btn-sm btn-outline-success" id="setp-detail-guardados"><i class="fas fa-folder-open me-1"></i>Formatos guardados</button>',
            '  </div>',
            '    <div class="setp-detail-tools">',
            '      <span class="setp-panel-hint" id="setp-detail-hint"></span>',
            '      <button type="button" class="btn btn-sm btn-outline-secondary d-none" id="setp-detail-hoy" title="Ocultar los días anteriores y mostrar sólo los recorridos de hoy"><i class="fas fa-calendar-day me-1"></i>Ver sólo hoy</button>',
            '      <label class="visually-hidden" for="setp-detail-usuario">Consultar historial de</label>',
            '      <select id="setp-detail-usuario" class="form-select form-select-sm" title="Consulta el historial de registros de cualquier usuario"></select>',
            '    </div>',
            '  </div>',
            '  <div class="setp-detail" id="setp-detail"></div>',
            '</div>'
        ].join('');
    }

    // ---------- datos ----------

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
        // Superadmin: administra el módulo completo sin ser supervisor (modo
        // administración de js/setp-recorridos.js): ve y gestiona a todos.
        if (esSuperadmin()) propio = '';
        supSel.value = propio;
        fillUsuarioDetalle(list, detalleNo || propio);
        if (window.setpRecorridos) window.setpRecorridos.select(propio);
    }

    function esSuperadmin() {
        try { return sessionStorage.getItem('user_role') === 'superadmin'; } catch (_) { return false; }
    }

    // "Detalle de registros" tiene su propio selector de usuario: cualquiera
    // puede consultar el historial de otro (Luis el de Tania y viceversa) sin
    // cambiar el supervisor que captura en "Supervisor × turno".
    // Arranca en el propio usuario.
    function fillUsuarioDetalle(list, valor) {
        var sel = $('setp-detail-usuario');
        if (!sel) return;
        list = list || (window.setpRecorridos ? window.setpRecorridos.supervisores() : []);
        // Sólo el personal de SETP (SETP_PERSONAS_CON_ACCESO en script.js): quien
        // no pertenece al grupo no aparece en la lista, aunque esté en la base.
        var personal = (window.setpPersonasConAcceso || []).map(palabras);
        if (personal.length) {
            list = list.filter(function (s) {
                var nombre = palabras(s.nombre);
                return personal.some(function (p) { return p.length && p.every(function (w) { return nombre.indexOf(w) >= 0; }); });
            });
        }
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

    // ---------- periodo cargado ----------
    // Al abrir SETP se cargan sólo los últimos 3 meses (registros, recorridos y
    // hallazgos). "Cargar 3 meses anteriores" amplía el periodo y "Todo el
    // histórico" lo quita. Los pendientes por solucionar y los recorridos en
    // curso se cargan siempre, sin importar su fecha (js/setp-formato.js y
    // js/setp-recorridos.js leen window.setpPeriodo). El historial de cada
    // supervisor ("Ver historial") siempre es completo.

    function haceMeses(n) {
        var d = new Date();
        d.setMonth(d.getMonth() - n);
        var p = function (x) { return x < 10 ? '0' + x : String(x); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function fmtDia(iso) {
        var p = String(iso).split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function ponerPeriodo(meses) {
        periodo.meses = meses;
        periodo.desde = meses ? haceMeses(meses) : '';
    }

    function renderPeriodo() {
        var box = $('setp-periodo');
        if (!box) return;
        var cargando = state.loading;
        var txt = periodo.desde
            ? 'los <b>últimos ' + periodo.meses + ' meses</b> (desde ' + fmtDia(periodo.desde) + ')'
            : '<b>todo el histórico</b>';
        if (cargando) {
            box.innerHTML = '<span class="spinner-border spinner-border-sm setp-periodo-ico" aria-hidden="true"></span>' +
                '<span class="setp-periodo-txt">Cargando ' + (periodo.desde ? 'registros de ' : '') + txt + '…</span>';
            return;
        }
        var btn = function (accion, icono, texto, sec, titulo) {
            return '<button type="button" class="setp-periodo-btn' + (sec ? ' setp-periodo-btn--sec' : '') + '" data-periodo="' + accion + '" title="' + titulo + '">' +
                (icono ? '<i class="fas ' + icono + ' me-1" aria-hidden="true"></i>' : '') + texto + '</button>';
        };
        var btns = [];
        if (periodo.desde) {
            btns.push(btn('mas', 'fa-clock-rotate-left', 'Cargar ' + PASO_MESES + ' meses anteriores', false, 'Agrega los ' + PASO_MESES + ' meses anteriores a lo que ya se muestra'));
            btns.push(btn('todo', '', 'Todo el histórico', true, 'Carga todos los registros desde el inicio; puede tardar más'));
        }
        if (periodo.meses !== MESES_INICIALES) {
            btns.push(btn('inicio', '', 'Volver a ' + MESES_INICIALES + ' meses', true, 'Muestra otra vez sólo los últimos ' + MESES_INICIALES + ' meses'));
        }
        box.innerHTML = '<i class="fas fa-calendar-days setp-periodo-ico" aria-hidden="true"></i>' +
            '<span class="setp-periodo-txt">Mostrando ' + txt + '</span>' +
            '<span class="setp-periodo-btns">' + btns.join('') + '</span>';
    }

    // Indicadores en gris mientras se cargan (en lugar de 0 o "—").
    function renderKpisCargando() {
        var box = $('setp-kpis');
        if (!box) return;
        var anchos = [40, 30, 60];
        box.innerHTML = ['Registros', 'Supervisores', 'Turno con más recorridos'].map(function (label, i) {
            return kpi(label, '<span class="setp-sk setp-sk--valor" style="width:' + anchos[i] + '%"></span>', '<span class="setp-sk" style="width:70%"></span>');
        }).join('');
        box.setAttribute('aria-busy', 'true');
    }

    function cambiarPeriodo(accion) {
        if (state.loading) return;
        if (accion === 'mas') ponerPeriodo(periodo.meses + PASO_MESES);
        else if (accion === 'todo') ponerPeriodo(0);
        else if (accion === 'inicio') ponerPeriodo(MESES_INICIALES);
        else return;
        refresh();
    }

    // ---------- render ----------

    function render() {
        // Mientras se cargan los datos, los indicadores siguen en gris (los
        // avisos de js/setp-recorridos.js llegan antes de que termine la carga).
        if (state.loading) { renderDetail(); return; }
        renderKpis(getFilters());
        renderDetail();
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

    // PERIODO de los indicadores Registros y Supervisores: el mismo que el
    // Reporte de hallazgos (js/setp-formato.js); por omisión, el mes en curso.
    var periodoKpi = null;

    function mesEnCurso() {
        var d = new Date();
        return {
            desde: claveDia(new Date(d.getFullYear(), d.getMonth(), 1)),
            hasta: claveDia(new Date(d.getFullYear(), d.getMonth() + 1, 0))
        };
    }

    // Registros: recorridos del PERIODO (del supervisor de la sesión o de todos).
    // Supervisores: cuántos hicieron recorridos en el PERIODO y quién hizo más.
    function renderKpis(f) {
        var box = $('setp-kpis');
        if (!box) return;
        var rec = window.setpRecorridos;
        var todos = rec ? rec.recorridos() : [];
        box.removeAttribute('aria-busy');
        if (!todos) {
            box.innerHTML = [
                kpi('Registros', '…', 'Cargando recorridos…'),
                kpi('Supervisores', '…', 'Cargando recorridos…'),
                kpiTurnos(f)
            ].join('');
            return;
        }
        var p = periodoKpi || mesEnCurso();
        var lista = todos.filter(function (r) {
            var k = claveDia(fechaDe(r.registrado_en));
            return k >= p.desde && k <= p.hasta;
        });
        var propios = f.noEmpleado ? lista.filter(function (r) { return r.no_empleado === f.noEmpleado; }) : lista;
        var enCurso = propios.filter(function (r) { return !r.hora_termino; }).length;
        // Si el PERIODO empieza antes de lo cargado, la cifra puede estar incompleta.
        var recortado = periodo.desde && p.desde < periodo.desde
            ? '<div class="setp-kpi-who">Cargados desde ' + fmtDia(periodo.desde) + '</div>' : '';
        var subReg = '<div class="setp-kpi-who">' + esc(f.noEmpleado ? f.supervisor : 'Todos los supervisores') + '</div>' +
            'Recorridos del ' + fmtDia(p.desde) + ' al ' + fmtDia(p.hasta) +
            (enCurso ? ' · ' + fmtNumber(enCurso) + ' en curso' : '') + recortado;

        var nombres = {};
        (rec.supervisores() || []).forEach(function (s) { nombres[s.no_empleado] = s.nombre; });
        var porSup = {};
        lista.forEach(function (r) { porSup[r.no_empleado] = (porSup[r.no_empleado] || 0) + 1; });
        var ranking = Object.keys(porSup).map(function (no) { return { nombre: nombres[no] || no, n: porSup[no] }; })
            .sort(function (a, b) { return b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'); });
        var top = ranking[0];
        var subSup = top
            ? 'Más recorridos: ' + esc(top.nombre) + ' (' + fmtNumber(top.n) + ')'
            : 'Sin recorridos en el periodo';

        box.innerHTML = [
            kpi('Registros', fmtNumber(propios.length), subReg),
            kpi('Supervisores', fmtNumber(ranking.length), subSup + recortado),
            kpiTurnos(f)
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
        // Por omisión sólo se ve el día de hoy; los días anteriores aparecen
        // al elegir un PERIODO en "Reporte de hallazgos" (js/setp-formato.js).
        var hoy = claveDia(new Date());
        var rango = filtroDias || { desde: hoy, hasta: hoy };
        var soloHoy = !filtroDias;
        var btnHoy = $('setp-detail-hoy');
        if (btnHoy) btnHoy.classList.toggle('d-none', soloHoy);
        var lista = todos.filter(function (r) {
            if (f.noEmpleado && r.no_empleado !== f.noEmpleado) return false;
            var k = claveDia(fechaDe(r.registrado_en));
            return k >= rango.desde && k <= rango.hasta;
        });
        var dias = agruparPorDia(lista);
        var etiqueta = soloHoy ? 'Hoy' : 'Periodo ' + fmtDia(rango.desde) + ' al ' + fmtDia(rango.hasta);
        hint.textContent = etiqueta + ' · ' + fmtNumber(lista.length) + (lista.length === 1 ? ' reporte' : ' reportes') +
            (soloHoy ? '' : ' en ' + fmtNumber(dias.length) + (dias.length === 1 ? ' día' : ' días'));
        if (!lista.length && soloHoy) {
            box.innerHTML = '<div class="setp-empty">Sin recorridos hoy' + (f.noEmpleado ? ' de <b>' + esc(f.supervisor) + '</b>' : '') +
                '. Para ver días anteriores elige las fechas en <b>PERIODO</b>.</div>';
            return;
        }
        if (!lista.length && periodo.desde && rango.desde < periodo.desde) {
            box.innerHTML = '<div class="setp-empty">Sin reportes cargados en ese periodo. Sólo están cargados los recorridos desde ' + fmtDia(periodo.desde) +
                '; usa <b>Cargar ' + PASO_MESES + ' meses anteriores</b> o <b>Todo el histórico</b> (arriba) para ver los anteriores.</div>';
            return;
        }
        if (!lista.length) {
            var vacio = !todos.some(function (r) { return !f.noEmpleado || r.no_empleado === f.noEmpleado; });
            var recortado = !rec.recorridosCompletos();
            box.innerHTML = '<div class="setp-empty">' + (vacio && recortado
                ? 'Sin reportes ' + (f.noEmpleado ? 'de <b>' + esc(f.supervisor) + '</b> ' : '') + 'en los últimos ' + periodo.meses + ' meses. Usa <b>Cargar ' + PASO_MESES + ' meses anteriores</b> o <b>Todo el histórico</b> (arriba) para ver los anteriores.'
                : vacio && f.noEmpleado
                ? 'Aún no hay reportes de <b>' + esc(f.supervisor) + '</b>. Al presionar <b>Iniciar recorrido</b> aparecerá aquí su primer punto de historial.'
                : vacio ? 'Aún no hay reportes registrados.' : 'No hay reportes con los filtros seleccionados.') + '</div>';
            return;
        }
        // Un renglón por día (desplegable) con sus recorridos dentro. Se
        // recuerda qué días están abiertos entre re-renders; si el usuario
        // aún no ha abierto ninguno, se abre el día más reciente.
        box.innerHTML = dias.map(function (g, i) {
            var abierto = diasAbiertos ? !!diasAbiertos[g.key] : i === 0;
            var conEvid = g.items.filter(function (r) { return r.evidencia_url; }).length;
            var enCurso = g.items.filter(function (r) { return !r.hora_termino; }).length;
            var res = ['<b>' + fmtNumber(g.items.length) + '</b> ' + (g.items.length === 1 ? 'recorrido' : 'recorridos')];
            if (!f.noEmpleado) {
                var sups = {};
                g.items.forEach(function (r) { sups[r.no_empleado] = 1; });
                var n = Object.keys(sups).length;
                res.push(fmtNumber(n) + (n === 1 ? ' supervisor' : ' supervisores'));
            }
            if (conEvid) res.push('<i class="fas fa-camera" aria-hidden="true"></i> ' + fmtNumber(conEvid) + ' con evidencia');
            if (enCurso) res.push('<span class="setp-hist-tag--curso"><i class="fas fa-circle-play me-1"></i>' + fmtNumber(enCurso) + ' en curso</span>');
            return '<details class="setp-dia" data-dia="' + esc(g.key) + '"' + (abierto ? ' open' : '') + '>' +
                '<summary><i class="fas fa-chevron-right setp-dia-chev" aria-hidden="true"></i>' +
                '<div class="setp-dia-fecha"><b>' + esc(g.titulo) + '</b> <span>' + esc(g.semana) + '</span></div>' +
                '<div class="setp-dia-res">' + res.join(' · ') + '</div></summary>' +
                '<ul class="setp-hist">' + g.items.map(function (r) { return itemDetalle(r, f, nombres); }).join('') + '</ul>' +
                '</details>';
        }).join('');
    }

    // null = el usuario aún no abre/cierra días; luego { 'YYYY-MM-DD': true }.
    var diasAbiertos = null;
    // null = sólo hoy; { desde, hasta } ('YYYY-MM-DD') = PERIODO elegido.
    var filtroDias = null;

    function claveDia(d) {
        var p = function (x) { return x < 10 ? '0' + x : String(x); };
        return d ? d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) : 'sin-fecha';
    }

    // Agrupa los recorridos por día local de registrado_en, del más reciente
    // al más antiguo; dentro de cada día, en orden de hora de inicio.
    function agruparPorDia(lista) {
        var map = {}, orden = [];
        lista.forEach(function (r) {
            var d = fechaDe(r.registrado_en);
            var k = claveDia(d);
            if (!map[k]) {
                map[k] = {
                    key: k,
                    titulo: d ? d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sin fecha',
                    semana: d ? d.toLocaleDateString('es-MX', { weekday: 'long' }) : '',
                    items: []
                };
                orden.push(k);
            }
            map[k].items.push(r);
        });
        orden.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
        return orden.map(function (k) {
            var g = map[k];
            g.items.sort(function (a, b) { return String(a.hora_inicio || '').localeCompare(String(b.hora_inicio || '')); });
            return g;
        });
    }

    function itemDetalle(r, f, nombres) {
            var enCurso = !r.hora_termino;
            var sub = [];
            if (!f.noEmpleado) sub.push(esc(nombres[r.no_empleado] || r.no_empleado));
            sub.push(esc(r.area_recorrido));
            if (r.evidencia_url) sub.push('<i class="fas ' + (r.evidencia_tipo === 'FOTO' ? 'fa-camera' : 'fa-paperclip') + '" title="Con evidencia"></i> Evidencia');
            return '<li><span class="setp-hist-dot' + (enCurso ? ' setp-hist-dot--curso' : '') + '" aria-hidden="true"></span>' +
                '<div class="setp-hist-main"><div class="setp-hist-when"><b>' + esc(hhmm(r.hora_inicio)) + ' hrs</b></div>' +
                '<div class="setp-hist-sub">' + sub.join(' · ') + '</div></div>' +
                (enCurso
                    ? '<span class="setp-hist-tag setp-hist-tag--curso"><i class="fas fa-circle-play me-1"></i>En curso</span>'
                    : '<span class="setp-hist-tag"><i class="fas fa-flag-checkered me-1"></i>Finalizado ' + esc(hhmm(r.hora_termino)) + '</span>') +
                '<button type="button" class="btn btn-sm btn-outline-primary setp-hist-btn" data-hist-no="' + esc(r.no_empleado) + '" data-hist-id="' + esc(r.id) + '"' +
                ' title="Abrir el historial de ' + esc(nombres[r.no_empleado] || r.no_empleado) + ' en una ventana nueva"><i class="fas fa-clock-rotate-left me-1"></i>Ver historial</button>' +
                '</li>';
    }

    // ---------- ciclo de vida ----------

    function bindEvents() {
        // Consultar el historial de otro usuario cambia el Detalle.
        $('setp-detail-usuario').addEventListener('change', renderDetail);
        // Barra del periodo: Cargar meses anteriores, Todo el histórico, Volver.
        $('setp-periodo').addEventListener('click', function (e) {
            var b = e.target.closest('[data-periodo]');
            if (b) cambiarPeriodo(b.getAttribute('data-periodo'));
        });
        // "Ver historial" de cada registro: abre el historial de su supervisor con ese registro resaltado.
        $('setp-detail').addEventListener('click', function (e) {
            var b = e.target.closest('[data-hist-no]');
            if (b && window.setpRecorridos) window.setpRecorridos.abrirHistorial(b.getAttribute('data-hist-no'), b.getAttribute('data-hist-id'));
        });
        // PERIODO del Reporte de hallazgos (js/setp-formato.js): muestra esos días.
        document.addEventListener('setp:periodo-reporte', function (e) {
            var p = e.detail || {};
            if (!/^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '')) return;
            filtroDias = { desde: p.desde, hasta: p.hasta };
            periodoKpi = { desde: p.desde, hasta: p.hasta };
            diasAbiertos = null;
            render();
        });
        // "Ver sólo hoy": vuelve a ocultar los días anteriores.
        $('setp-detail-hoy').addEventListener('click', function () {
            filtroDias = null;
            diasAbiertos = null;
            renderDetail();
        });
        // Recordar qué días abrió o cerró el usuario para conservarlos cuando
        // el Detalle se vuelve a pintar (nuevo recorrido, cambio de usuario…).
        $('setp-detail').addEventListener('click', function (e) {
            var s = e.target.closest('.setp-dia > summary');
            if (!s) return;
            var dEl = s.parentNode;
            if (!diasAbiertos) {
                diasAbiertos = {};
                $('setp-detail').querySelectorAll('.setp-dia[open]').forEach(function (x) { diasAbiertos[x.getAttribute('data-dia')] = true; });
            }
            var k = dEl.getAttribute('data-dia');
            // El clic aún no cambia "open": el nuevo estado es el contrario.
            if (!dEl.open) diasAbiertos[k] = true; else delete diasAbiertos[k];
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
        renderPeriodo();
        renderKpisCargando();
        // Tabla de reporte de hallazgos (js/setp-formato.js), con su propia carga.
        if (window.setpFormato) window.setpFormato.mountReport($('setp-reporte-hallazgos'));
        // Supervisores y recorridos (js/setp-recorridos.js): el filtro Supervisor los usa.
        var recorridos = window.setpRecorridos ? window.setpRecorridos.mount($('setp-recorridos-wrap')) : Promise.resolve();
        try {
            await recorridos;
            state.loading = false;
            setStatus('');
            fillSupervisores();
            render();
        } catch (error) {
            state.loading = false;
            setStatus('No se pudieron cargar los recorridos: ' + esc(error && error.message ? error.message : error), 'danger');
            try { render(); } catch (_) { /* los indicadores quedan con lo que haya */ }
        } finally {
            state.loading = false;
            if (btn) btn.disabled = false;
            renderPeriodo();
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
