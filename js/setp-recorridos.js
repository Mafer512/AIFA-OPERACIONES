(function () {
    'use strict';

    // ============================================================
    // SETP · Supervisor × turno (recorridos de supervisión)
    // El supervisor es el usuario que inició sesión; su No. de empleado, nombre y
    // cargo se llenan solos. "Iniciar recorrido" fija la hora de inicio y
    // "Finalizar recorrido" la de término (las pone el servidor). La
    // evidencia es una foto (cámara del celular) o un archivo de la PC.
    // Tablas: setp_supervisores, setp_recorridos · Bucket: setp-evidencias
    // (ver db/setp_modulo_completo.sql y db/setp_recorridos_captura.sql).
    // ============================================================

    const T_SUPERVISORES = 'setp_supervisores';
    const T_RECORRIDOS = 'setp_recorridos';
    const BUCKET = 'setp-evidencias';
    const MODAL_ID = 'setp-usuario-modal';
    const MAX_FILE = 10 * 1024 * 1024;
    const LIST_LIMIT = 100;
    // Sin "No. de empleado" ni "Nombre y apellido" (se retiraron de la pantalla;
    // los datos siguen guardados y el historial los muestra).
    const COLS = 5;
    const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx';
    // Celular o tableta (no computadora): ahí el + abre directo la cámara.
    // Se ve el navegador y no la pantalla táctil, para que una laptop con
    // pantalla táctil siga como computadora. El iPad moderno se presenta como
    // Mac, por eso se revisa también si tiene pantalla táctil.
    const ES_MOVIL_O_TABLETA = (function () {
        var nav = window.navigator || {};
        if (nav.userAgentData && nav.userAgentData.mobile) return true;
        var ua = nav.userAgent || '';
        if (/Android|iPhone|iPad|iPod|Mobi|Tablet|Silk|Kindle/i.test(ua)) return true;
        return /Macintosh/i.test(ua) && (nav.maxTouchPoints || 0) > 1;
    })();
    // Turno que elige el supervisor al iniciar (columna turno, db/setp_recorridos_turno.sql).
    const TURNOS_REC = [
        { key: 'MATUTINO', label: 'Matutino' },
        { key: 'VESPERTINO', label: 'Diurno' },   // se guarda como VESPERTINO (columna turno)
        { key: 'NOCTURNO', label: 'Nocturno' }
    ];
    // Pisos que se eligen como "Área de recorrido".
    const PISOS = ['0.00', '5.25', '10.50'];
    // Módulos, locales, etiquetas, items y condiciones: js/setp-catalogo.js.
    function catalogo() { return window.setpCatalogo; }
    function moduloTexto(m) { return m.nombre + (m.zona ? ' (' + m.zona + ')' : ''); }
    // Selector de turno debajo del área de recorrido (false lo oculta sin borrarlo).
    const SELECTOR_TURNO = true;

    const state = {
        el: null,
        supervisores: [],
        recorridos: [],
        selected: '',
        loaded: false,
        error: '',
        busy: {},          // id de recorrido (o 'new') -> true mientras se guarda
        evidenciaFor: null, // recorrido que recibe el archivo elegido
        pending: {},        // id -> evidencia elegida que aún no se guarda (se guarda con ✓)
        editando: null,     // No. de empleado del usuario abierto en "Editar usuario"
        evidenciaExtra: false, // el archivo elegido es una evidencia adicional (+)
        extras: {},         // id de recorrido -> hallazgos de sus evidencias adicionales
        descFor: null,      // recorrido cuya descripción se está capturando
        resumen: [],        // todos los recorridos (id, no_empleado, turno) para la tarjeta de turnos
        enFormato: {},      // id de recorrido -> true si ya salió en un formato guardado
        turnoOk: true,      // false si aún no se aplica db/setp_recorridos_turno.sql
        turnoNuevo: '',     // turno elegido en el renglón "Iniciar recorrido"
        areaNueva: '',      // piso elegido en el renglón "Iniciar recorrido"
        areaCol: null,      // true si setp_hallazgos tiene la columna area (Cambiar el área responsable)
        areaElegir: false,  // lista de áreas abierta en la ventana "Descripción del hallazgo"
        status: null       // aviso visible { message, type }
    };

    function $(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function errText(error) {
        return esc(error && error.message ? error.message : error);
    }

    async function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (typeof window.ensureSupabaseClient === 'function') return window.ensureSupabaseClient();
        throw new Error('Cliente Supabase no disponible');
    }

    function canEdit() {
        var level = typeof window.setpAccessLevel === 'function' ? window.setpAccessLevel() : 'read';
        return ['admin', 'edit', 'capture'].indexOf(level) >= 0;
    }

    // "Crear usuario" sólo para superadmin (mismo criterio que el resto del aplicativo).
    function esSuperadmin() {
        try { return sessionStorage.getItem('user_role') === 'superadmin'; } catch (_) { return false; }
    }

    function supervisor(no) {
        return state.supervisores.find(function (s) { return s.no_empleado === no; }) || null;
    }

    function hhmm(time) {
        return time ? String(time).slice(0, 5) : '';
    }

    function fecha(ts) {
        if (!ts) return '';
        var d = new Date(ts);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    // El aviso se guarda en el estado para que render() lo vuelva a pintar
    // (antes, un render() justo después del aviso lo borraba).
    function statusClass() {
        return state.status ? 'alert alert-' + state.status.type + ' py-2 small mx-3 mt-3 mb-0' : 'd-none';
    }

    function setStatus(message, type) {
        state.status = message ? { message: message, type: type || 'info' } : null;
        var box = $('setp-rec-status');
        if (!box) return;
        box.className = statusClass();
        box.innerHTML = message || '';
    }

    // ---------- datos ----------

    async function load() {
        state.error = '';
        try {
            var sb = await getClient();
            var sup = await sb.from(T_SUPERVISORES).select('no_empleado, nombre, cargo').order('nombre', { ascending: true });
            if (sup.error) throw sup.error;
            state.supervisores = sup.data || [];
            // Todos los recorridos de todos los usuarios (por páginas de 1000):
            // "Detalle de registros" conserva el historial completo de cada uno.
            var rec = { data: [], error: null };
            for (var from = 0; ; from += 1000) {
                var pag = await sb.from(T_RECORRIDOS).select('*').order('registrado_en', { ascending: false }).range(from, from + 999);
                if (pag.error) { rec.error = pag.error; break; }
                rec.data = rec.data.concat(pag.data || []);
                if (!pag.data || pag.data.length < 1000) break;
            }
            if (rec.error) {
                state.recorridos = [];
                state.error = /registrado_en/.test(rec.error.message || '')
                    ? 'Para capturar recorridos aplica <code>db/setp_recorridos_captura.sql</code> en Supabase.'
                    : 'No se pudieron cargar los recorridos: ' + errText(rec.error);
            } else {
                state.recorridos = rec.data || [];
                state.extras = await cargarExtras(sb);
                state.resumen = await cargarResumen(sb);
                state.enFormato = await cargarEnFormato(sb);
            }
        } catch (error) {
            state.supervisores = [];
            state.recorridos = [];
            state.error = 'No se pudieron cargar los supervisores: ' + errText(error);
        }
        state.loaded = true;
    }

    // Recorridos que ya salieron en un formato guardado (setp_oficio_recorridos):
    // siguen en la base y en el historial, pero ya no se muestran en la tabla.
    async function cargarEnFormato(sb) {
        var map = {};
        for (var from = 0; ; from += 1000) {
            var res = await sb.from('setp_oficio_recorridos').select('recorrido_id').range(from, from + 999);
            if (res.error) return map;
            (res.data || []).forEach(function (x) { map[x.recorrido_id] = true; });
            if (!res.data || res.data.length < 1000) break;
        }
        return map;
    }

    // Evidencias adicionales: hallazgos cuya foto lleva "-rec-<id del recorrido>-x.jpg".
    async function cargarExtras(sb) {
        var map = {};
        var res = await sb.from('setp_hallazgos').select('id, descripcion, evidencia_url, evidencia_path')
            .like('evidencia_path', '%-rec-%-x.jpg').order('created_at', { ascending: true });
        if (res.error) return map; // sin evidencias adicionales no se detiene la captura
        (res.data || []).forEach(function (h) {
            var m = /-rec-(.+)-x\.jpg$/.exec(h.evidencia_path || '');
            if (m && h.evidencia_url) (map[m[1]] = map[m[1]] || []).push(h);
        });
        return map;
    }

    // Todos los recorridos (no sólo los últimos 100) con su turno, para la
    // tarjeta "Turno con más recorridos" de cada supervisor.
    async function cargarResumen(sb) {
        var cols = 'id, no_empleado, turno';
        var all = [];
        for (var from = 0; ; from += 1000) {
            var res = await sb.from(T_RECORRIDOS).select(cols).range(from, from + 999);
            if (res.error && cols.indexOf('turno') >= 0 && /turno/.test(res.error.message || '')) {
                // Sin la columna turno todavía: la captura sigue sin elegir turno.
                state.turnoOk = false;
                cols = 'id, no_empleado';
                from -= 1000;
                continue;
            }
            if (res.error) return all;
            all = all.concat(res.data || []);
            if (!res.data || res.data.length < 1000) break;
        }
        if (cols.indexOf('turno') >= 0) state.turnoOk = true;
        return all;
    }

    function actualizarResumen(row) {
        var item = { id: row.id, no_empleado: row.no_empleado, turno: row.turno || null };
        var i = state.resumen.findIndex(function (x) { return x.id === row.id; });
        if (i >= 0) state.resumen[i] = item; else state.resumen.push(item);
    }

    function replaceRow(row) {
        actualizarResumen(row);
        var found = false;
        state.recorridos = state.recorridos.map(function (r) {
            if (r.id !== row.id) return r;
            found = true;
            return row;
        });
        if (!found) state.recorridos.unshift(row);
    }

    // ---------- tabla ----------

    function ensureStyles() {
        if ($('setp-rec-styles')) return;
        var R = '#setp-recorridos-wrap';
        var style = document.createElement('style');
        style.id = 'setp-rec-styles';
        style.textContent = [
            // El texto oculto "Acciones" (visually-hidden, posición absoluta) se
            // queda dentro del desplazamiento de la tabla y no ensancha la página en celular.
            R + ' .table-responsive{position:relative;}',
            R + ' .setp-rec-table td{vertical-align:middle;}',
            // Hora de inicio y de término centradas (en celular y tableta son tarjetas: se quedan a la izquierda).
            '@container setp (min-width:1000px){' + R + ' .setp-rec-table th:nth-child(3),' + R + ' .setp-rec-table th:nth-child(4),' + R + ' .setp-rec-table td:nth-child(3),' + R + ' .setp-rec-table td:nth-child(4){text-align:center;}}',
            R + ' .setp-rec-area{min-width:180px;}',
            R + ' .setp-rec-hora{font-weight:700;font-variant-numeric:tabular-nums;color:#0f172a;}',
            R + ' .setp-rec-dia{display:block;font-size:.72rem;color:#64748b;}',
            R + ' .setp-rec-nuevo td{background:#f8fbff;}',
            R + ' .setp-rec-curso td{background:#fffbeb;}',
            R + ' .setp-rec-thumb{width:72px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;display:block;}',
            R + ' .setp-rec-file{display:inline-flex;align-items:center;gap:6px;max-width:200px;font-size:.8rem;}',
            R + ' .setp-rec-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            R + ' .setp-rec-hint td{color:#64748b;font-size:.82rem;text-align:center;padding:12px;}',
            R + ' .setp-rec-turno{margin-top:4px;max-width:160px;}',
            R + ' .setp-rec-evs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}',
            R + ' .setp-rec-thumb--pend{border:2px dashed #b45309;}',
            R + ' .setp-rec-mas{width:48px;height:48px;border-style:dashed;display:inline-flex;align-items:center;justify-content:center;}',
            R + ' .setp-rec-pend{color:#b45309;font-weight:600;}',
            R + ' .setp-rec-desc-btn{font-size:.72rem;text-decoration:none;}',
            // Botón flotante fijo para iniciar o finalizar el recorrido (pintarFab).
            // Encima del botón "Sugerencias" (#fb-fab-wrap, style.css), que ocupa la misma esquina.
            '#setp-rec-fab{position:fixed;right:calc(1.6rem + env(safe-area-inset-right,0px));bottom:calc(1.6rem + 64px + env(safe-area-inset-bottom,0px));z-index:1045;',
            'display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border:0;border-radius:999px;font:inherit;font-weight:700;font-size:.95rem;',
            'color:#fff;box-shadow:0 10px 24px rgba(15,23,42,.28);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;}',
            '#setp-rec-fab.is-ini{background:#198754;}',
            '#setp-rec-fab.is-fin{background:#dc3545;}',
            '#setp-rec-fab:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 14px 28px rgba(15,23,42,.34);}',
            '#setp-rec-fab:focus-visible{outline:3px solid #93c5fd;outline-offset:3px;}',
            '#setp-rec-fab:disabled{opacity:.85;cursor:progress;}',
            // Dentro de una sección del menú de tarjetas "Sugerencias" se oculta (style.css): baja a la esquina.
            'body.navdeck-mode.navdeck-active #setp-rec-fab{bottom:calc(1.6rem + env(safe-area-inset-bottom,0px));}',
            'body.dark-mode #setp-rec-fab{box-shadow:0 10px 24px rgba(0,0,0,.5);}',
            '@media (max-width:599.98px){#setp-rec-fab{padding:12px 16px;}}',
            // Modo oscuro (body.dark-mode).
            'body.dark-mode ' + R + ' .setp-rec-hora{color:var(--text-color);}',
            'body.dark-mode ' + R + ' .setp-rec-dia,body.dark-mode ' + R + ' .setp-rec-hint td{color:var(--text-muted-color);}',
            'body.dark-mode ' + R + ' .setp-rec-nuevo td{background:rgba(77,171,247,.08);}',
            'body.dark-mode ' + R + ' .setp-rec-curso td{background:rgba(251,191,36,.08);}',
            'body.dark-mode ' + R + ' .setp-rec-thumb{border-color:var(--border-color);}',
            'body.dark-mode ' + R + ' .setp-rec-thumb--pend{border-color:#f59e0b;}',
            'body.dark-mode ' + R + ' .setp-rec-pend{color:#fbbf24;}'
        ].concat(estilosResponsive(R)).join('');
        document.head.appendChild(style);
    }


    // Celular y tableta: con #setp-root más angosto que 1000 px (contenedor "setp",
    // js/setp-reportes.js) cada recorrido se ve como tarjeta en lugar de renglón,
    // sin deslizar a los lados. Tableta: 3 renglones; celular (< 600 px): 2 columnas.
    // Las etiquetas salen del orden de las columnas de la tabla.
    function estilosResponsive(R) {
        var T = R + ' .setp-rec-table';
        var etiquetas = ['Cargo', 'Área de recorrido', 'Hora de inicio', 'Hora de término', 'Evidencia'];
        var areas = ['car', 'area', 'ini', 'fin', 'ev', 'acc'];
        return [
            '@container setp (max-width:999.98px){',
            R + ' .table-responsive{overflow:visible;}',
            R + ' .table-responsive::after{display:none !important;}',
            T + ',' + T + ' tbody{display:block;width:100%;}',
            T + ' thead{display:none;}',
            T + ' tbody{padding:12px;}',
            T + ' tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-template-areas:"car car car acc" "area area ini fin" "ev ev ev ev";',
            'gap:10px 14px;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin-bottom:12px;background:#fff;box-shadow:0 4px 12px rgba(15,23,42,.04);}',
            T + ' tr:last-child{margin-bottom:0;}',
            T + ' tr.setp-rec-curso{background:#fffbeb;border-color:#fcd34d;}',
            T + ' tr.setp-rec-nuevo{background:#f8fbff;border-color:#bfdbfe;}',
            T + ' tr.setp-rec-hint{display:block;border-style:dashed;box-shadow:none;}',
            T + ' td{display:block;border:0;padding:0;min-width:0;background:transparent !important;box-shadow:none !important;}',
            T + ' td:empty{display:none;}',
            T + ' td::before{display:block;font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:3px;}',
            T + ' tr.setp-rec-hint td::before{content:none;}',
            etiquetas.map(function (e, i) { return T + ' td:nth-child(' + (i + 1) + ')::before{content:"' + e + '";}'; }).join(''),
            areas.map(function (a, i) { return T + ' tr:not(.setp-rec-hint) td:nth-child(' + (i + 1) + '){grid-area:' + a + ';}'; }).join(''),
            T + ' td:nth-child(6){justify-self:end;align-self:start;}',
            R + ' .setp-rec-area,' + R + ' .setp-rec-turno{min-width:0;max-width:none;width:100%;}',
            R + ' .setp-rec-turno{margin-top:6px;}',
            R + ' .setp-rec-file{max-width:100%;}',
            'body.dark-mode ' + T + ' tr{background:var(--card-bg);border-color:var(--border-color);box-shadow:0 4px 12px rgba(0,0,0,.25);}',
            'body.dark-mode ' + T + ' tr.setp-rec-curso{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.45);}',
            'body.dark-mode ' + T + ' tr.setp-rec-nuevo{background:rgba(77,171,247,.08);border-color:rgba(77,171,247,.4);}',
            'body.dark-mode ' + T + ' tr.setp-rec-hint{box-shadow:none;}',
            'body.dark-mode ' + T + ' td::before{color:var(--text-muted-color);}',
            '}',
            '@container setp (max-width:599.98px){',
            T + ' tbody{padding:10px;}',
            T + ' tr{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"car acc" "area area" "ini fin" "ev ev";gap:8px 12px;padding:12px;}',
            // Botones de captura a todo lo ancho de la tarjeta (fáciles de tocar).
            T + ' td:nth-child(3) .btn,' + T + ' td:nth-child(4) .btn,' + T + ' td:nth-child(5) > .btn:not(.btn-link){width:100%;}',
            R + ' .setp-rec-thumb{width:120px;height:80px;}',
            '}'
        ];
    }

    // Vista previa sin guardar: tocarla permite elegir otra.
    function evidenciaPendiente(r, p) {
        return '<button type="button" class="btn btn-link p-0 text-start" data-rec="' + (p.extra ? 'evidencia-mas' : 'evidencia') + '" data-id="' + esc(r.id) + '" title="Cambiar evidencia">' +
            (p.esFoto
                ? '<img class="setp-rec-thumb setp-rec-thumb--pend" src="' + esc(p.url) + '" alt="Evidencia sin guardar">'
                : '<span class="setp-rec-file"><i class="fas fa-file-alt"></i><span>' + esc(p.file.name) + '</span></span>') +
            '</button>';
    }

    function avisoPendiente(r, p) {
        return '<span class="setp-rec-dia setp-rec-pend">Sin guardar · presiona ✓</span>' +
            (p.esFoto && p.descripcion ? '<span class="setp-rec-dia">' + esc(p.descripcion) + (p.mismoQue ? ' · se une a <b>' + esc(p.mismoQue.folio || 'un hallazgo registrado') + '</b>' : '') + '</span>' : '') +
            (p.esFoto
            ? '<button type="button" class="btn btn-link p-0 setp-rec-desc-btn" data-rec="descripcion" data-id="' + esc(r.id) + '"><i class="fas fa-pen me-1"></i>' +
              (p.descripcion ? 'Editar descripción' : 'Agregar descripción') + '</button>'
            : '');
    }

    // Evidencia del recorrido: botón para capturarla y, ya guardada, el botón +
    // para evidencias adicionales (cada una es un hallazgo en "Hallazgos detectados").
    // consulta: renglón sólo para ver (recorrido de hoy de otro supervisor o ya en un formato).
    function evidenciaCell(r, consulta) {
        var busy = state.busy[r.id];
        var p = consulta ? null : state.pending[r.id];
        var edit = canEdit() && !consulta;
        if (!r.evidencia_url) {
            if (!edit) return '<span class="text-muted">—</span>';
            if (busy === 'guardar') return '<span class="spinner-border spinner-border-sm text-primary"></span>';
            if (p) return evidenciaPendiente(r, p) + avisoPendiente(r, p);
            return '<button type="button" class="btn btn-sm btn-outline-primary" data-rec="evidencia" data-id="' + esc(r.id) + '" title="Tomar foto o adjuntar archivo"><i class="fas fa-camera me-1"></i>Evidencia</button>';
        }
        // Ya guardadas, las evidencias no se repiten aquí: se ven en "Hallazgos
        // detectados" y en el historial. Sólo queda el + para capturar otra.
        if (!edit) return '<span class="text-muted small"><i class="fas fa-check me-1"></i>Guardada</span>';
        var html = '<div class="setp-rec-evs">';
        if (busy === 'guardar') html += '<span class="spinner-border spinner-border-sm text-primary"></span>';
        else if (p) html += evidenciaPendiente(r, p);
        else html += '<button type="button" class="btn btn-sm btn-outline-primary setp-rec-mas" data-rec="evidencia-mas" data-id="' + esc(r.id) + '" title="Tomar otra foto de evidencia" aria-label="Tomar otra foto de evidencia"><i class="fas fa-plus"></i></button>';
        html += '</div>';
        if (p && busy !== 'guardar') html += avisoPendiente(r, p);
        return html;
    }

    // Columna de acciones: ✓ (guardar evidencia) para quien captura y 🗑 sólo para superadmin.
    function conAcciones() {
        return canEdit() || esSuperadmin();
    }

    function accionesCell(r, consulta) {
        var html = '';
        if (state.pending[r.id] && canEdit() && !consulta) {
            html += state.busy[r.id] === 'guardar'
                ? '<span class="spinner-border spinner-border-sm text-success me-2"></span>'
                : '<button type="button" class="btn btn-sm btn-success me-1" data-rec="guardar" data-id="' + esc(r.id) + '" title="Guardar evidencia" aria-label="Guardar evidencia"><i class="fas fa-check"></i></button>';
        }
        if (esSuperadmin()) {
            html += state.busy[r.id] === 'borrar'
                ? '<span class="spinner-border spinner-border-sm text-danger"></span>'
                : '<button type="button" class="btn btn-sm btn-outline-danger" data-rec="borrar" data-id="' + esc(r.id) + '" title="Borrar recorrido" aria-label="Borrar recorrido"><i class="fas fa-trash-alt"></i></button>';
        }
        return '<td class="text-end text-nowrap">' + html + '</td>';
    }

    // "No. de empleado" y "Nombre y apellido" se retiraron de la tabla: sólo queda Cargo.
    function datosSupervisor(s) {
        return '<td>' + (s && s.cargo ? esc(s.cargo) : '—') + '</td>';
    }

    function turnoLabel(key) {
        var t = TURNOS_REC.find(function (x) { return x.key === key; });
        return t ? t.label : '';
    }

    // Lista de pisos para "Área de recorrido". Un recorrido guardado con otra
    // área la conserva como opción para no perderla. attrs: id o data-rec-area.
    function areaSelect(valor, attrs) {
        var opciones = PISOS.slice();
        if (valor && opciones.indexOf(valor) < 0) opciones.unshift(valor);
        return '<select class="form-select form-select-sm setp-rec-area" ' + attrs + ' aria-label="Área de recorrido">' +
            '<option value=""' + (valor ? '' : ' selected') + '>Área de recorrido…</option>' +
            opciones.map(function (p) {
                return '<option value="' + esc(p) + '"' + (valor === p ? ' selected' : '') + '>' + esc(p) + '</option>';
            }).join('') + '</select>';
    }

    function conTurno() { return SELECTOR_TURNO && state.turnoOk; }

    // Selector de turno (Matutino, Vespertino o Nocturno). attrs: id o data-rec-turno.
    function turnoSelect(valor, attrs) {
        return '<select class="form-select form-select-sm setp-rec-turno" ' + attrs + ' aria-label="Turno">' +
            '<option value=""' + (valor ? '' : ' selected') + '>Turno…</option>' +
            // Matutino ya no se ofrece; sólo se muestra en recorridos que ya lo tienen guardado.
            TURNOS_REC.filter(function (t) { return t.key !== 'MATUTINO' || valor === t.key; }).map(function (t) {
                return '<option value="' + t.key + '"' + (valor === t.key ? ' selected' : '') + '>' + t.label + '</option>';
            }).join('') + '</select>';
    }

    // Fecha del término: la del inicio, o el día siguiente si terminó después de medianoche.
    function fechaTermino(r) {
        var d = r.registrado_en ? new Date(r.registrado_en) : null;
        if (!d || isNaN(d)) return '';
        if (r.hora_inicio && r.hora_termino && String(r.hora_termino) < String(r.hora_inicio)) d.setDate(d.getDate() + 1);
        return fecha(d.toISOString());
    }

    // consulta: sólo para ver (recorrido de hoy de otro supervisor o que ya salió en un formato).
    function recorridoRow(r, consulta) {
        var s = supervisor(r.no_empleado) || { no_empleado: r.no_empleado, nombre: '', cargo: '' };
        var enCurso = !r.hora_termino;
        var editable = canEdit() && !state.busy[r.id] && !consulta;
        var area = editable
            ? areaSelect(r.area_recorrido || '', 'data-rec-area="' + esc(r.id) + '"')
            : esc(r.area_recorrido);
        if (conTurno()) {
            area += editable
                ? turnoSelect(r.turno || '', 'data-rec-turno="' + esc(r.id) + '"')
                : '<span class="setp-rec-dia">' + (r.turno ? 'Turno ' + esc(turnoLabel(r.turno)).toLowerCase() : 'Sin turno') + '</span>';
        }
        var termino;
        if (!enCurso) termino = '<span class="setp-rec-hora">' + hhmm(r.hora_termino) + '</span><span class="setp-rec-dia">' + fechaTermino(r) + '</span>' +
            (state.enFormato[r.id] ? '<span class="setp-rec-dia text-success"><i class="fas fa-file-signature me-1"></i>En formato guardado</span>' : '');
        else if (!canEdit() || consulta) termino = '<span class="badge text-bg-warning">En curso</span>';
        else if (state.busy[r.id] === 'finalizar') termino = '<span class="spinner-border spinner-border-sm text-danger"></span>';
        // Se finaliza con el botón flotante (pintarFab): aquí ya no se repite el botón.
        else termino = '<span class="badge text-bg-warning">En curso</span><span class="setp-rec-dia">Finalízalo con el botón de la esquina</span>';
        return '<tr' + (enCurso ? ' class="setp-rec-curso"' : '') + '>' + datosSupervisor(s) +
            '<td>' + area + '</td>' +
            '<td><span class="setp-rec-hora">' + hhmm(r.hora_inicio) + '</span><span class="setp-rec-dia">' + fecha(r.registrado_en) + '</span></td>' +
            '<td>' + termino + '</td>' +
            '<td>' + evidenciaCell(r, consulta) + '</td>' + (conAcciones() ? accionesCell(r, consulta) : '') + '</tr>';
    }

    // Renglón para iniciar un recorrido nuevo del supervisor elegido.
    function nuevoRow(s) {
        var busy = state.busy.new;
        return '<tr class="setp-rec-nuevo">' + datosSupervisor(s) +
            '<td>' + areaSelect(state.areaNueva, 'id="setp-rec-area-nueva"' + (busy ? ' disabled' : '')) +
            (conTurno() ? turnoSelect(state.turnoNuevo, 'id="setp-rec-turno-nuevo"' + (busy ? ' disabled' : '')) : '') + '</td>' +
            // Se inicia con el botón flotante (pintarFab): aquí ya no se repite el botón.
            '<td>' + (busy
                ? '<span class="spinner-border spinner-border-sm text-success"></span>'
                : '<span class="text-muted small">Elige área y turno, y presiona <b>Iniciar recorrido</b> en la esquina</span>') + '</td>' +
            '<td><span class="text-muted">—</span></td>' +
            '<td><span class="text-muted small">Al iniciar</span></td>' + (conAcciones() ? '<td></td>' : '') + '</tr>';
    }

    function render() {
        if (!state.el) return;
        var thead = '<thead><tr><th>Cargo</th><th>Área de recorrido</th>' +
            '<th>Hora de inicio de recorrido</th><th>Hora de término de recorrido</th>' +
            '<th title="Fotografía o archivo">Evidencia <span class="fw-normal text-lowercase">(foto o archivo)</span></th>' +
            (conAcciones() ? '<th><span class="visually-hidden">Acciones</span></th>' : '') + '</tr></thead>';
        var cols = COLS + (conAcciones() ? 1 : 0);
        var hint = function (html) { return '<tr class="setp-rec-hint"><td colspan="' + cols + '">' + html + '</td></tr>'; };
        var body = '';
        if (!state.loaded) {
            body = hint('<span class="spinner-border spinner-border-sm me-2"></span>Cargando recorridos…');
        } else if (state.error && !state.supervisores.length) {
            body = hint(state.error);
        } else if (!state.supervisores.length) {
            body = hint('Aún no hay supervisores.' + (esSuperadmin() ? ' Usa <b>Crear usuario</b> para dar de alta al primero.' : ''));
        } else {
            var s = state.selected ? supervisor(state.selected) : null;
            // Propios: los del supervisor elegido (o de todos) que aún no salen en un formato.
            var propio = function (r) { return (!s || r.no_empleado === s.no_empleado) && !state.enFormato[r.id]; };
            var lista = state.recorridos.filter(propio);
            // Además, los recorridos de HOY de todos los supervisores se ven siempre
            // (aunque se elija a otro o ya estén en un formato), sólo para consultar.
            var hoy = fechaLocal();
            var visibles = state.recorridos.filter(function (r) { return propio(r) || fechaLocal(r.registrado_en) === hoy; });
            if (state.error) {
                body += hint(state.error);
            } else if (!s) {
                body += hint('<i class="fas fa-circle-info me-1"></i>Tu usuario no está dado de alta como supervisor, así que no puedes registrar recorridos. El nombre de tu perfil debe coincidir con el de un supervisor.');
            } else if (canEdit() && !lista.some(function (r) { return !r.hora_termino; })) {
                body += nuevoRow(s);
            }
            body += visibles.map(function (r) { return recorridoRow(r, !propio(r)); }).join('');
            if (!visibles.length && s && !canEdit()) body += hint('Sin recorridos registrados.');
        }
        state.el.innerHTML = '<div id="setp-rec-status" class="' + statusClass() + '">' + (state.status ? state.status.message : '') + '</div>' +
            '<div class="table-responsive"><table class="table table-sm mb-0 setp-table setp-rec-table" id="setp-recorridos">' +
            thead + '<tbody>' + body + '</tbody></table></div>' +
            '<input type="file" id="setp-rec-file" class="d-none" accept="' + ACCEPT + '">';
        // "Detalle de registros" (js/setp-reportes.js) muestra el historial compacto.
        document.dispatchEvent(new CustomEvent('setp:recorridos-actualizados'));
        pintarFab();
    }

    // ---------- botón flotante ----------
    // Botón fijo en la esquina inferior derecha para iniciar el recorrido propio
    // o, si hay uno en curso, finalizarlo. Vive dentro de #setp-section, así que
    // sólo se ve en SETP. Lo ven quienes tienen acceso a SETP: las personas de
    // SETP_PERSONAS_CON_ACCESO (script.js) y los superadmin.
    var FAB_ID = 'setp-rec-fab';

    function recorridoEnCurso() {
        var s = state.selected ? supervisor(state.selected) : null;
        if (!s) return null;
        return state.recorridos.find(function (r) { return r.no_empleado === s.no_empleado && !r.hora_termino; }) || null;
    }

    function pintarFab() {
        var host = $('setp-section');
        if (!host) return;
        var fab = $(FAB_ID);
        var visible = state.loaded && (typeof window.puedeVerSetp !== 'function' || window.puedeVerSetp());
        if (!visible) { if (fab) fab.remove(); return; }
        if (!fab) {
            fab = document.createElement('button');
            fab.type = 'button';
            fab.id = FAB_ID;
            fab.addEventListener('click', clickFab);
            host.appendChild(fab);
        }
        var curso = recorridoEnCurso();
        var busy = curso ? state.busy[curso.id] : state.busy.new;
        fab.className = curso ? 'is-fin' : 'is-ini';
        fab.disabled = !!busy;
        fab.innerHTML = busy
            ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>' + (curso ? 'Finalizando…' : 'Iniciando…') + '</span>'
            : curso
                ? '<i class="fas fa-flag-checkered" aria-hidden="true"></i><span>Finalizar recorrido</span>'
                : '<i class="fas fa-play" aria-hidden="true"></i><span>Iniciar recorrido</span>';
        fab.title = curso ? 'Finalizar el recorrido en curso (' + (curso.area_recorrido || '') + ', inició ' + hhmm(curso.hora_inicio) + ' hrs)' : 'Iniciar un recorrido';
    }

    async function clickFab() {
        var wrap = state.el;
        if (!wrap) return;
        var ver = function (el) { (el || wrap).scrollIntoView({ behavior: 'smooth', block: 'center' }); };
        var s = state.selected ? supervisor(state.selected) : null;
        if (!s) {
            setStatus('Tu usuario no está dado de alta como supervisor, así que no puedes iniciar recorridos. El nombre de tu perfil debe coincidir con el de un supervisor.', 'warning');
            ver();
            return;
        }
        if (!canEdit()) {
            setStatus('Tu nivel en SETP es de consulta. Para iniciar recorridos pide el nivel de captura en Vistas.', 'warning');
            ver();
            return;
        }
        var curso = recorridoEnCurso();
        if (curso) {
            var ok = await confirmarBorrado(document, {
                tono: 'ok', kicker: 'Recorrido en curso', titulo: '¿Finalizar el recorrido?',
                filas: [['Área de recorrido', curso.area_recorrido || '—'], ['Inicio', hhmm(curso.hora_inicio) + ' hrs']],
                aviso: 'La hora de término la pone el sistema al confirmar. Después agrega la evidencia en el renglón del recorrido.',
                boton: 'Finalizar'
            });
            if (!ok) return;
            await finalizar(curso.id);
            var ev = wrap.querySelector('[data-id="' + curso.id + '"][data-rec^="evidencia"]');
            ver(ev ? ev.closest('tr') : null);
            return;
        }
        // Sin recorrido en curso: lleva al renglón para iniciar. Si ya eligió
        // área y turno lo inicia; si falta alguno, iniciar() lo pide y lo enfoca.
        ver(wrap.querySelector('tr.setp-rec-nuevo'));
        await iniciar();
    }

    // ---------- acciones ----------

    async function iniciar() {
        var s = supervisor(state.selected);
        var area = ($('setp-rec-area-nueva') || {}).value || '';
        area = area.trim().replace(/\s+/g, ' ');
        if (!s || !canEdit() || state.busy.new) return;
        if (!area) {
            setStatus('Elige el área de recorrido antes de iniciar.', 'warning');
            var input = $('setp-rec-area-nueva');
            if (input) input.focus();
            return;
        }
        var turnoSel = $('setp-rec-turno-nuevo');
        var turno = conTurno() && turnoSel ? turnoSel.value : '';
        if (conTurno() && !turno) {
            setStatus('Elige el turno del recorrido (Matutino, Vespertino o Nocturno) antes de iniciar.', 'warning');
            if (turnoSel) turnoSel.focus();
            return;
        }
        state.turnoNuevo = turno;
        state.busy.new = true;
        render();
        try {
            var sb = await getClient();
            // La hora de inicio la fija el servidor (db/setp_recorridos_captura.sql).
            var nuevo = { no_empleado: s.no_empleado, area_recorrido: area, hora_inicio: new Date().toTimeString().slice(0, 8) };
            if (turno) nuevo.turno = turno;
            var res = await sb.from(T_RECORRIDOS).insert([nuevo]).select('*').single();
            if (res.error) throw res.error;
            state.areaNueva = '';
            replaceRow(res.data);
            setStatus('');
        } catch (error) {
            var dup = error && error.code === '23505';
            var sinColumna = !dup && /turno/.test(error && error.message || '');
            setStatus(dup
                ? 'Este supervisor ya tiene un recorrido en curso. Se actualizó la tabla.'
                : sinColumna
                    ? 'Para guardar el turno falta aplicar <code>db/setp_recorridos_turno.sql</code> en Supabase.'
                    : 'No se pudo iniciar el recorrido: ' + errText(error), dup ? 'info' : 'danger');
            if (dup) await load();
        } finally {
            delete state.busy.new;
            render();
        }
    }

    async function finalizar(id) {
        if (!canEdit() || state.busy[id]) return;
        state.busy[id] = 'finalizar';
        render();
        try {
            var sb = await getClient();
            // El servidor reemplaza esta hora por la hora real de finalización.
            var res = await sb.from(T_RECORRIDOS)
                .update({ hora_termino: new Date().toTimeString().slice(0, 8) })
                .eq('id', id).select('*').single();
            if (res.error) throw res.error;
            replaceRow(res.data);
            setStatus('');
            // El formato del usuario queda guardado (sin No. de oficio) en
            // "Formatos guardados" para generarlo e imprimirlo al final del día.
            var fmt = window.setpFormato;
            if (fmt && fmt.guardarBorrador) {
                try {
                    await fmt.guardarBorrador(res.data);
                    setStatus('Recorrido finalizado. Su formato quedó guardado en <b>Formatos guardados</b> para generarlo e imprimirlo al final del día.', 'success');
                } catch (e) {
                    setStatus('Recorrido finalizado, pero su formato no se pudo guardar en <b>Formatos guardados</b>: ' + errText(e), 'warning');
                }
            }
        } catch (error) {
            setStatus('No se pudo finalizar el recorrido: ' + errText(error), 'danger');
        } finally {
            delete state.busy[id];
            render();
        }
    }

    async function guardarArea(id, input) {
        var r = state.recorridos.find(function (x) { return x.id === id; });
        var area = input.value.trim().replace(/\s+/g, ' ');
        if (!r || area === r.area_recorrido) return;
        if (!area) {
            input.value = r.area_recorrido;
            return setStatus('El área de recorrido no puede quedar vacía.', 'warning');
        }
        try {
            var sb = await getClient();
            var res = await sb.from(T_RECORRIDOS).update({ area_recorrido: area }).eq('id', id).select('*').single();
            if (res.error) throw res.error;
            replaceRow(res.data);
            setStatus('');
            input.classList.add('is-valid');
            setTimeout(function () { input.classList.remove('is-valid'); }, 1200);
        } catch (error) {
            input.value = r.area_recorrido;
            setStatus('No se pudo guardar el área: ' + errText(error), 'danger');
        }
    }

    async function guardarTurno(id, select) {
        var r = state.recorridos.find(function (x) { return x.id === id; });
        var turno = select.value || null;
        if (!r || turno === (r.turno || null)) return;
        try {
            var sb = await getClient();
            var res = await sb.from(T_RECORRIDOS).update({ turno: turno }).eq('id', id).select('*').single();
            if (res.error) throw res.error;
            replaceRow(res.data);
            setStatus('');
            render();
        } catch (error) {
            select.value = r.turno || '';
            setStatus('No se pudo guardar el turno: ' + errText(error), 'danger');
        }
    }

    function rutaDeUrl(url) {
        return url ? decodeURIComponent(String(url).split('/' + BUCKET + '/')[1] || '') : '';
    }

    // Borra el recorrido de Supabase y luego su archivo de evidencia.
    async function eliminarRecorridoBD(sb, r) {
        if (!esSuperadmin()) throw new Error('sólo un superadmin puede borrar registros.');
        // Un recorrido que ya salió en un formato guardado está protegido por la
        // base (setp_oficio_recorridos): el superadmin primero lo quita del formato.
        var lig = await sb.from('setp_oficio_recorridos').delete().eq('recorrido_id', r.id).select('oficio_id, recorrido_id');
        if (lig.error) throw new Error('no se pudo quitar del formato guardado: ' + lig.error.message);
        // Si el recorrido no se borra, vuelve a quedar ligado a su formato.
        var religar = async function () {
            if (lig.data && lig.data.length) { try { await sb.from('setp_oficio_recorridos').insert(lig.data); } catch (_) { /* sin efecto */ } }
        };
        var res = await sb.from(T_RECORRIDOS).delete().eq('id', r.id).select('id');
        if (res.error) {
            await religar();
            if (res.error.code === '23503') throw new Error('ya salió en un formato guardado y no se puede borrar.');
            throw res.error;
        }
        // Si los permisos de Supabase lo impiden, no hay error: sólo cero renglones.
        if (!res.data || !res.data.length) {
            await religar();
            throw new Error('Supabase no permitió borrarlo (revisa los permisos de setp_recorridos).');
        }
        var path = rutaDeUrl(r.evidencia_url);
        if (path) { try { await sb.storage.from(BUCKET).remove([path]); } catch (_) { /* la foto huérfana no impide el borrado */ } }
    }

    function quitarDelEstado(id) {
        state.recorridos = state.recorridos.filter(function (x) { return x.id !== id; });
        state.resumen = state.resumen.filter(function (x) { return x.id !== id; });
        delete state.extras[id];
        delete state.enFormato[id];
        soltarPendiente(id);
    }

    // Aviso extra del borrado cuando el recorrido ya salió en un formato guardado.
    function avisoFormato(r) {
        return state.enFormato[r.id] ? ' Ya salió en un formato guardado: se quita de ese formato.' : '';
    }

    // Sólo superadmin: borra el recorrido y su evidencia (p. ej. registros de prueba).
    async function borrar(id) {
        var r = state.recorridos.find(function (x) { return x.id === id; });
        if (!r || !esSuperadmin() || state.busy[id]) return;
        var s = supervisor(r.no_empleado);
        var ok = await confirmarBorrado(document, {
            kicker: 'Supervisor por turno',
            titulo: '¿Borrar este recorrido?',
            filas: [
                ['Supervisor', s ? s.nombre : r.no_empleado],
                ['Área de recorrido', r.area_recorrido],
                ['Fecha y hora', (fecha(r.registrado_en) || '—') + ' · ' + hhmm(r.hora_inicio) + ' hrs']
            ],
            aviso: 'También se borra su evidencia.' + avisoFormato(r) + ' No se puede deshacer.'
        });
        if (!ok || state.busy[id]) return;
        state.busy[id] = 'borrar';
        render();
        try {
            var sb = await getClient();
            await eliminarRecorridoBD(sb, r);
            quitarDelEstado(id);
            setStatus('');
        } catch (error) {
            setStatus('No se pudo borrar el recorrido: ' + errText(error), 'danger');
        } finally {
            delete state.busy[id];
            render();
        }
    }

    // Reduce las fotos a 1600 px como máximo y las guarda como JPEG.
    function compressImage(file) {
        return new Promise(function (resolve) {
            var img = new Image();
            var url = URL.createObjectURL(file);
            img.onload = function () {
                var scale = Math.min(1, 1600 / Math.max(img.width, img.height));
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.85);
            };
            img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    }

    function soltarPendiente(id) {
        var p = state.pending[id];
        if (p && p.url) URL.revokeObjectURL(p.url);
        delete state.pending[id];
    }

    // La foto o archivo elegido queda como vista previa; se guarda hasta presionar ✓.
    // Si es foto, se abre la ventana para describir el hallazgo.
    // extra: evidencia adicional (+); sólo fotos, porque cada una es un hallazgo.
    async function prepararEvidencia(id, file, extra) {
        var r = state.recorridos.find(function (x) { return x.id === id; });
        if (!r || !file || !canEdit()) return;
        var esFoto = /^image\//.test(file.type);
        if (extra && !esFoto) return setStatus('Las evidencias adicionales deben ser fotos, porque cada una se agrega como hallazgo en <b>Hallazgos detectados</b>.', 'warning');
        var blob = esFoto ? await compressImage(file) : file;
        if (blob.size > MAX_FILE) return setStatus('El archivo pesa más de 10 MB. Elige uno más ligero.', 'warning');
        // Al cambiar la foto se conserva lo ya capturado (etiqueta, item, módulo…).
        var previa = state.pending[id];
        var captura = {};
        if (previa && previa.extra === !!extra) {
            ['descripcion', 'etiqueta', 'item', 'condicion', 'cantidad', 'area', 'modulo', 'local', 'detalle', 'mismoQue'].forEach(function (k) { captura[k] = previa[k]; });
        }
        soltarPendiente(id);
        state.pending[id] = Object.assign(captura, { file: file, blob: blob, esFoto: esFoto, extra: !!extra, url: esFoto ? URL.createObjectURL(blob) : '' });
        setStatus(esFoto ? '' : 'Presiona <b>✓</b> para guardar la evidencia.', 'info');
        render();
        if (esFoto) abrirDescripcion(id);
    }

    // ext: extensión ('jpg') o sufijo con extensión ('rec-<id>.jpg').
    function rutaEvidencia(carpeta, ext) {
        return carpeta + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + (ext.indexOf('.') >= 0 ? '-' : '.') + ext;
    }

    // Fecha local (YYYY-MM-DD) del recorrido, para el hallazgo.
    function fechaLocal(ts) {
        var d = ts ? new Date(ts) : new Date();
        if (isNaN(d)) d = new Date();
        var p2 = function (n) { return n < 10 ? '0' + n : String(n); };
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    }

    // Columnas que pueden faltar si aún no se aplica su script SQL: se guarda sin
    // ellas. Sin "local" (db/setp_hallazgos_identificacion.sql), el local va en
    // el módulo para no perderlo.
    const COLUMNAS_OPCIONALES = ['no_empleado', 'seccion', 'local', 'etiqueta', 'item', 'condicion', 'cantidad', 'detalle', 'area'];

    async function insertarHallazgo(sb, hallazgo) {
        var campos = 'id, folio';
        var res;
        for (var intento = 0; intento <= COLUMNAS_OPCIONALES.length + 1; intento++) {
            res = await sb.from('setp_hallazgos').insert([hallazgo]).select(campos).single();
            if (!res.error) break;
            var msg = res.error.message || '';
            // Sin la columna folio: sólo se pide el id.
            if (campos !== 'id' && /folio/.test(msg)) { campos = 'id'; continue; }
            var col = COLUMNAS_OPCIONALES.find(function (c) { return c in hallazgo && new RegExp("'" + c + "'|\\b" + c + '\\b').test(msg); });
            if (!col) break;
            if (col === 'local' && hallazgo.local) hallazgo.modulo += ' (' + hallazgo.local + ')';
            delete hallazgo[col];
        }
        return res;
    }

    async function subirFotoHallazgo(sb, r, p, fechaRep) {
        var path = rutaEvidencia('hallazgos/' + fechaRep.slice(0, 7), 'rec-' + r.id + (p.extra ? '-x' : '') + '.jpg');
        var up = await sb.storage.from(BUCKET).upload(path, p.blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
        var pub = sb.storage.from(BUCKET).getPublicUrl(path);
        return { path: path, url: pub && pub.data ? pub.data.publicUrl : null };
    }

    // La ruta de la foto lleva el id del recorrido (y "-x" si es evidencia
    // adicional): así el historial y la tabla ligan el hallazgo con su recorrido.
    async function crearHallazgoDetectado(sb, r, p) {
        var fechaRep = fechaLocal(r.registrado_en);
        var foto = await subirFotoHallazgo(sb, r, p, fechaRep);
        var actor = sessionStorage.getItem('user_role') || 'authenticated';
        var descripcion = p.descripcion;
        var hallazgo = {
            fecha_reporte: fechaRep,
            // Ubicación exacta: módulo y local de la captura; el nivel es el piso del recorrido.
            modulo: p.modulo || r.area_recorrido,
            nivel: p.modulo ? r.area_recorrido : null,
            descripcion: descripcion,
            evidencia_url: foto.url,
            evidencia_path: foto.path,
            estatus: 'PENDIENTE',
            seccion: 'DETECTADOS',
            // Supervisor del recorrido (db/setp_hallazgos_por_supervisor.sql).
            no_empleado: r.no_empleado,
            // Identificación (db/setp_hallazgos_identificacion.sql).
            local: p.local || null,
            etiqueta: p.etiqueta || null,
            item: p.item || null,
            condicion: p.condicion || null,
            cantidad: Number(p.cantidad) || 1,
            detalle: p.detalle || null,
            created_by: actor,
            updated_by: actor
        };
        // Área responsable elegida a mano (columna area); si no, sale de la regla.
        if (p.area) hallazgo.area = p.area;
        var res = await insertarHallazgo(sb, hallazgo);
        if (res.error) {
            try { await sb.storage.from(BUCKET).remove([foto.path]); } catch (_) { /* sin efecto */ }
            throw res.error;
        }
        return {
            ym: fechaRep.slice(0, 7),
            fecha: fechaRep,
            folio: res.data && res.data.folio,
            hallazgo: { id: res.data && res.data.id, descripcion: descripcion, evidencia_url: foto.url, evidencia_path: foto.path }
        };
    }

    // "Es el mismo · agregar mi foto": no crea otro hallazgo; suma un reporte
    // al existente y guarda la foto (función setp_sumar_reporte de
    // db/setp_hallazgos_identificacion.sql; sin ella, se actualiza directo).
    async function sumarAHallazgo(sb, r, p) {
        var fechaRep = fechaLocal(r.registrado_en);
        var foto = await subirFotoHallazgo(sb, r, p, fechaRep);
        var extra = { url: foto.url, path: foto.path, no_empleado: r.no_empleado, fecha: fechaRep, recorrido_id: r.id, descripcion: p.descripcion };
        var res = await sb.rpc('setp_sumar_reporte', { p_hallazgo: p.mismoQue.id, p_foto: extra });
        if (res.error) {
            var cur = await sb.from('setp_hallazgos').select('veces, fotos_extra').eq('id', p.mismoQue.id).single();
            if (cur.error) {
                try { await sb.storage.from(BUCKET).remove([foto.path]); } catch (_) { /* sin efecto */ }
                throw cur.error;
            }
            res = await sb.from('setp_hallazgos').update({
                veces: (Number(cur.data.veces) || 1) + 1,
                fotos_extra: (cur.data.fotos_extra || []).concat([extra]),
                updated_at: new Date().toISOString()
            }).eq('id', p.mismoQue.id).select('id').single();
            if (res.error) {
                try { await sb.storage.from(BUCKET).remove([foto.path]); } catch (_) { /* sin efecto */ }
                throw res.error;
            }
        }
        return { ym: fechaRep.slice(0, 7), fecha: fechaRep, folio: p.mismoQue.folio, mismo: true, hallazgo: null };
    }

    // ✓ de una foto: crea el hallazgo o, si se eligió "Es el mismo", lo suma al existente.
    function registrarHallazgo(sb, r, p) {
        return p.mismoQue ? sumarAHallazgo(sb, r, p) : crearHallazgoDetectado(sb, r, p);
    }

    function avisoRegistrado(out) {
        return out.mismo
            ? 'Tu foto se agregó al hallazgo <b>' + esc(out.folio || 'registrado') + '</b> (no se creó otro).'
            : 'El hallazgo' + (out.folio ? ' <b>' + esc(out.folio) + '</b>' : '') + ' se agregó a <b>Hallazgos detectados</b> de ' + esc(mesDe(out.ym)) + '.';
    }

    function mesDe(ym) {
        return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    }

    // Reporte de hallazgos (js/setp-formato.js): si la fecha del hallazgo queda
    // fuera del periodo elegido, muestra su mes completo.
    function mostrarEnReporte(fecha) {
        if (window.setpFormato && window.setpFormato.reloadReport) window.setpFormato.reloadReport(fecha);
    }

    // ✓ de una evidencia adicional: sólo crea su hallazgo (el recorrido ya tiene su evidencia).
    async function guardarEvidenciaExtra(r, p) {
        state.busy[r.id] = 'guardar';
        render();
        try {
            var sb = await getClient();
            var out = await registrarHallazgo(sb, r, p);
            if (out.hallazgo) state.extras[r.id] = (state.extras[r.id] || []).concat([out.hallazgo]);
            soltarPendiente(r.id);
            setStatus('Evidencia agregada. ' + avisoRegistrado(out), 'success');
            mostrarEnReporte(out.fecha);
        } catch (error) {
            setStatus('No se pudo guardar la evidencia adicional: ' + errText(error), 'danger');
        } finally {
            delete state.busy[r.id];
            render();
        }
    }

    async function guardarEvidencia(id) {
        var r = state.recorridos.find(function (x) { return x.id === id; });
        var p = state.pending[id];
        if (!r || !p || !canEdit() || state.busy[id]) return;
        // Las fotos necesitan su descripción (ventana "Descripción del hallazgo").
        if (p.esFoto && !p.descripcion) return abrirDescripcion(id, 'Elige etiqueta, item, condición, módulo y local, y presiona <b>Guardar</b>. Después confirma con <b>✓</b>.');
        if (p.extra) return guardarEvidenciaExtra(r, p);
        var ext = p.esFoto ? 'jpg' : (String(p.file.name).split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
        var path = rutaEvidencia('recorridos/' + String(r.no_empleado).replace(/[^\w-]+/g, '_'), ext);
        state.busy[id] = 'guardar';
        render();
        var sb;
        var subido = false;
        try {
            sb = await getClient();
            var up = await sb.storage.from(BUCKET).upload(path, p.blob, { contentType: p.esFoto ? 'image/jpeg' : (p.file.type || 'application/octet-stream'), upsert: false });
            if (up.error) throw up.error;
            subido = true;
            var pub = sb.storage.from(BUCKET).getPublicUrl(path);
            var res = await sb.from(T_RECORRIDOS).update({
                evidencia_url: pub && pub.data ? pub.data.publicUrl : null,
                evidencia_nombre: p.file.name || (p.esFoto ? 'foto.jpg' : 'archivo'),
                evidencia_tipo: p.esFoto ? 'FOTO' : 'ARCHIVO'
            }).eq('id', id).select('*').single();
            if (res.error) throw res.error;
            replaceRow(res.data);
            soltarPendiente(id);
        } catch (error) {
            if (subido) { try { await sb.storage.from(BUCKET).remove([path]); } catch (_) { /* sin efecto */ } }
            setStatus('No se pudo guardar la evidencia: ' + errText(error), 'danger');
            delete state.busy[id];
            render();
            return;
        }
        if (!p.esFoto) {
            setStatus('Evidencia guardada.', 'success');
        } else {
            try {
                var out = await registrarHallazgo(sb, r, p);
                setStatus('Evidencia guardada. ' + avisoRegistrado(out) + ' Usa <b>+</b> si hay más evidencias.', 'success');
                mostrarEnReporte(out.fecha);
            } catch (error) {
                setStatus('La evidencia se guardó en el recorrido, pero no se pudo agregar a Hallazgos detectados: ' + errText(error), 'warning');
            }
        }
        delete state.busy[id];
        render();
    }

    function bind(el) {
        el.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-rec]');
            if (!btn) return;
            var act = btn.getAttribute('data-rec');
            var id = btn.getAttribute('data-id');
            if (act === 'iniciar') iniciar();
            else if (act === 'finalizar') finalizar(id);
            else if (act === 'borrar') borrar(id);
            else if (act === 'guardar') guardarEvidencia(id);
            else if (act === 'descripcion') abrirDescripcion(id);
            else if (act === 'evidencia' || act === 'evidencia-mas') {
                state.evidenciaFor = id;
                state.evidenciaExtra = act === 'evidencia-mas';
                var input = $('setp-rec-file');
                input.accept = state.evidenciaExtra ? 'image/*' : ACCEPT;
                // Las evidencias adicionales son sólo fotos: en celular y tableta
                // abren directo la cámara trasera cada vez, en vez de la galería.
                // En computadora se sigue eligiendo el archivo como siempre, y la
                // primera evidencia sigue permitiendo foto o archivo (PDF, Word…).
                if (state.evidenciaExtra && ES_MOVIL_O_TABLETA) input.setAttribute('capture', 'environment');
                else input.removeAttribute('capture');
                input.value = '';
                input.click();
            }
        });
        el.addEventListener('change', function (e) {
            if (e.target.id === 'setp-rec-file') {
                var file = e.target.files && e.target.files[0];
                if (file && state.evidenciaFor) prepararEvidencia(state.evidenciaFor, file, state.evidenciaExtra);
                state.evidenciaFor = null;
                state.evidenciaExtra = false;
            } else if (e.target.hasAttribute('data-rec-area')) {
                guardarArea(e.target.getAttribute('data-rec-area'), e.target);
            } else if (e.target.hasAttribute('data-rec-turno')) {
                guardarTurno(e.target.getAttribute('data-rec-turno'), e.target);
            } else if (e.target.id === 'setp-rec-turno-nuevo') {
                state.turnoNuevo = e.target.value;
            } else if (e.target.id === 'setp-rec-area-nueva') {
                state.areaNueva = e.target.value;
            }
        });
        el.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            if (e.target.id === 'setp-rec-area-nueva') { e.preventDefault(); iniciar(); }
            else if (e.target.hasAttribute('data-rec-area')) { e.preventDefault(); e.target.blur(); }
        });
    }

    // ---------- Ventana "Confirmar borrado" ----------
    // Reemplaza al window.confirm: fondo con desenfoque y el mismo estilo de la
    // página. Trae sus propios estilos para funcionar también en la ventana del
    // historial. Resuelve true sólo con "Borrar"; Cancelar, Esc o clic fuera = false.

    const CF_ID = 'setp-cf-modal';
    const CF_CSS = [
        // Encima de los modales del aplicativo (style.css los fuerza a z-index 1650).
        '#' + CF_ID + '{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;',
        'background:rgba(15,23,42,.38);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .18s ease;}',
        '#' + CF_ID + '.is-open{opacity:1;}',
        '#' + CF_ID + ' .cf-card{width:100%;max-width:460px;background:rgba(255,255,255,.97);border:1px solid #e2e8f0;border-radius:18px;color:#0f172a;',
        'box-shadow:0 24px 60px rgba(15,23,42,.28);transform:translateY(8px) scale(.98);transition:transform .18s ease;overflow:hidden;}',
        '#' + CF_ID + '.is-open .cf-card{transform:none;}',
        '#' + CF_ID + ' .cf-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #e2e8f0;}',
        '#' + CF_ID + ' .cf-icon{width:40px;height:40px;border-radius:12px;background:#fef2f2;color:#dc2626;display:flex;align-items:center;justify-content:center;flex:none;}',
        '#' + CF_ID + ' .cf-icon svg{width:20px;height:20px;}',
        '#' + CF_ID + ' .cf-kicker{font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;}',
        '#' + CF_ID + ' .cf-title{font-size:1.05rem;font-weight:800;margin:0;}',
        '#' + CF_ID + ' .cf-body{padding:16px 18px;}',
        '#' + CF_ID + ' .cf-info{border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;padding:10px 12px;margin:0 0 12px;}',
        '#' + CF_ID + ' .cf-info dt{font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;}',
        '#' + CF_ID + ' .cf-info dd{font-size:.88rem;font-weight:600;margin:0 0 6px;overflow-wrap:anywhere;}',
        '#' + CF_ID + ' .cf-info dd:last-child{margin-bottom:0;}',
        '#' + CF_ID + ' .cf-aviso{display:flex;gap:8px;align-items:flex-start;font-size:.82rem;color:#b91c1c;background:#fef2f2;border-radius:10px;padding:8px 10px;}',
        '#' + CF_ID + ' .cf-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;}',
        '#' + CF_ID + ' .cf-btn{font:inherit;font-size:.88rem;font-weight:600;padding:7px 16px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}',
        '#' + CF_ID + ' .cf-btn svg{width:16px;height:16px;}',
        '#' + CF_ID + ' .cf-no{background:#fff;color:#475569;border:1px solid #94a3b8;}#' + CF_ID + ' .cf-no:hover{background:#f1f5f9;}',
        '#' + CF_ID + ' .cf-si{background:#dc2626;color:#fff;border:1px solid #dc2626;}#' + CF_ID + ' .cf-si:hover{background:#b91c1c;}',
        '#' + CF_ID + ' .cf-btn:focus-visible{outline:3px solid rgba(37,99,235,.45);outline-offset:2px;}',
        // Tono "ok" (confirmar, no borrar): icono, aviso y botón en verde.
        '#' + CF_ID + '.cf-tono-ok .cf-icon{background:#ecfdf5;color:#059669;}',
        '#' + CF_ID + '.cf-tono-ok .cf-aviso{color:#065f46;background:#ecfdf5;}',
        '#' + CF_ID + '.cf-tono-ok .cf-si{background:#16a34a;border-color:#16a34a;}#' + CF_ID + '.cf-tono-ok .cf-si:hover{background:#15803d;}',
        '@media (prefers-reduced-motion:reduce){#' + CF_ID + ',#' + CF_ID + ' .cf-card{transition:none;}}',
        // Modo oscuro del aplicativo (en la ventana del historial no aplica: no tiene body.dark-mode).
        'body.dark-mode #' + CF_ID + '{background:rgba(0,0,0,.55);}',
        'body.dark-mode #' + CF_ID + ' .cf-card{background:rgba(30,39,57,.97);border-color:var(--border-color);color:var(--text-color);box-shadow:0 24px 60px rgba(0,0,0,.5);}',
        'body.dark-mode #' + CF_ID + ' .cf-head,body.dark-mode #' + CF_ID + ' .cf-foot{border-color:var(--border-color);}',
        'body.dark-mode #' + CF_ID + ' .cf-foot{background:rgba(255,255,255,.03);}',
        'body.dark-mode #' + CF_ID + ' .cf-kicker,body.dark-mode #' + CF_ID + ' .cf-info dt{color:var(--text-muted-color);}',
        'body.dark-mode #' + CF_ID + ' .cf-info{background:rgba(255,255,255,.04);border-color:var(--border-color);}',
        'body.dark-mode #' + CF_ID + ' .cf-icon{background:rgba(248,113,113,.15);color:#f87171;}',
        'body.dark-mode #' + CF_ID + ' .cf-aviso{background:rgba(248,113,113,.12);color:#fca5a5;}',
        'body.dark-mode #' + CF_ID + ' .cf-no{background:transparent;color:#c3c9d2;border-color:rgba(148,163,184,.5);}',
        'body.dark-mode #' + CF_ID + ' .cf-no:hover{background:rgba(255,255,255,.06);}',
        'body.dark-mode #' + CF_ID + '.cf-tono-ok .cf-icon{background:rgba(16,185,129,.15);color:#34d399;}',
        'body.dark-mode #' + CF_ID + '.cf-tono-ok .cf-aviso{background:rgba(16,185,129,.12);color:#6ee7b7;}'
    ].join('');

    const ICONO_CONFIRMAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

    // o: { kicker, titulo, filas: [[etiqueta, valor], …], aviso, tono: 'ok' (opcional), boton (opcional) }
    function confirmarBorrado(doc, o) {
        return new Promise(function (resolve) {
            var win = doc.defaultView || window;
            if (!doc.getElementById('setp-cf-styles')) {
                var st = doc.createElement('style');
                st.id = 'setp-cf-styles';
                st.textContent = CF_CSS;
                doc.head.appendChild(st);
            }
            var viejo = doc.getElementById(CF_ID);
            if (viejo) viejo.remove();
            var el = doc.createElement('div');
            el.id = CF_ID;
            var ok = o.tono === 'ok';
            var icono = ok ? ICONO_CONFIRMAR : ICONO_BORRAR;
            if (ok) el.className = 'cf-tono-ok';
            el.setAttribute('role', 'alertdialog');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('aria-labelledby', 'setp-cf-title');
            el.setAttribute('aria-describedby', 'setp-cf-aviso');
            el.innerHTML = '<div class="cf-card">' +
                '<div class="cf-head"><div class="cf-icon">' + icono + '</div>' +
                '<div><div class="cf-kicker">' + esc(o.kicker) + '</div><h3 class="cf-title" id="setp-cf-title">' + esc(o.titulo) + '</h3></div></div>' +
                '<div class="cf-body"><dl class="cf-info">' + o.filas.map(function (f) {
                    return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>';
                }).join('') + '</dl>' +
                '<div class="cf-aviso" id="setp-cf-aviso">' + esc(o.aviso) + '</div></div>' +
                '<div class="cf-foot"><button type="button" class="cf-btn cf-no" data-cf="no">Cancelar</button>' +
                '<button type="button" class="cf-btn cf-si" data-cf="si">' + icono + esc(o.boton || 'Borrar') + '</button></div></div>';
            // Con un modal de Bootstrap abierto (p. ej. "Formatos guardados"), la
            // ventana va dentro de él: así queda encima y Bootstrap no le quita el foco.
            var host = doc.querySelector('.modal.show') || doc.body;
            host.appendChild(el);
            var antes = doc.activeElement;
            var overflow = doc.body.style.overflow;
            doc.body.style.overflow = 'hidden';
            var no = el.querySelector('[data-cf="no"]');
            var si = el.querySelector('[data-cf="si"]');
            win.requestAnimationFrame(function () { el.classList.add('is-open'); });
            no.focus(); // la opción segura queda enfocada
            var cerrar = function (valor) {
                doc.removeEventListener('keydown', teclas, true);
                el.classList.remove('is-open');
                doc.body.style.overflow = overflow;
                win.setTimeout(function () { el.remove(); }, 180);
                try { if (antes && antes.focus && doc.contains(antes)) antes.focus(); } catch (_) { /* sin efecto */ }
                resolve(valor);
            };
            var teclas = function (e) {
                // Esc cierra sólo esta ventana (no el modal de abajo).
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(false); }
                else if (e.key === 'Tab') {
                    e.preventDefault();
                    (doc.activeElement === no ? si : no).focus();
                }
            };
            doc.addEventListener('keydown', teclas, true);
            el.addEventListener('click', function (e) {
                if (e.target === el || e.target.closest('[data-cf="no"]')) cerrar(false);
                else if (e.target.closest('[data-cf="si"]')) cerrar(true);
            });
        });
    }

    // ---------- Ventana "Descripción del hallazgo" ----------
    // Captura por pasos (catálogo de js/setp-catalogo.js): Etiqueta → Item →
    // Condición → Cantidad → Módulo y Local, más un detalle opcional. Al
    // presionar Guardar se buscan en la base hallazgos pendientes iguales (mismo
    // item en el mismo local; si el objeto se mueve, en todo el edificio durante
    // 24 h) y se pregunta "¿Es el mismo?" con las fotos lado a lado. Guardar
    // cierra la ventana; el hallazgo se confirma después con ✓.

    const DESC_ID = 'setp-desc-modal';
    const DESC_MAX = 500;
    const MOVIBLE_HORAS = 24;

    // Modo oscuro (body.dark-mode, script.js): mismas variables que el resto del aplicativo.
    function descEstilosOscuros(D) {
        return [
            D + '{background:rgba(0,0,0,.55);}',
            D + ' .sd-card{background:rgba(30,39,57,.97);border-color:var(--border-color);color:var(--text-color);box-shadow:0 24px 60px rgba(0,0,0,.5);}',
            D + ' .sd-head,' + D + ' .sd-foot{border-color:var(--border-color);}',
            D + ' .sd-foot{background:rgba(255,255,255,.03);}',
            D + ' .sd-icon{background:rgba(77,171,247,.14);color:var(--primary-color);}',
            D + ' .sd-kicker,' + D + ' .sd-lbl,' + D + ' .sd-count,' + D + ' .sd-note,' + D + ' .sd-mod-vacio,' + D + ' .sd-paso .h,' + D + ' .sd-dup-sub{color:var(--text-muted-color);}',
            D + ' .sd-title,' + D + ' .sd-val,' + D + ' .sd-dup-tit{color:var(--text-color);}',
            D + ' label,' + D + ' .sd-paso{color:#c3c9d2;}',
            D + ' .sd-paso .n{background:rgba(77,171,247,.18);color:#8cc8ff;}',
            D + ' .sd-info{background:rgba(255,255,255,.04);border-color:var(--border-color);}',
            D + ' .sd-info img,' + D + ' .sd-dup-foto{border-color:var(--border-color);}',
            D + ' .btn-close{filter:invert(1) grayscale(100%) brightness(2);}',
            D + ' .sd-mod-lista,' + D + ' .sd-loc-lista{background:rgba(15,23,42,.55);border-color:var(--border-color);}',
            D + ' .sd-mod-item{color:var(--text-color);}',
            D + ' .sd-mod-item i{color:var(--text-muted-color);}',
            D + ' .sd-mod-item[aria-checked="true"] i{color:inherit;}',
            D + ' .sd-mod-item:hover,' + D + ' .sd-loc:hover,' + D + ' .sd-chip:hover,' + D + ' .sd-cond button:hover{background:rgba(255,255,255,.06);}',
            D + ' .sd-mod-item[aria-checked="true"]{background:rgba(77,171,247,.16);color:#8cc8ff;}',
            D + ' .sd-loc,' + D + ' .sd-chip,' + D + ' .sd-cond button,' + D + ' .sd-cant button{background:rgba(255,255,255,.04);border-color:var(--border-color);color:#c3c9d2;}',
            D + ' .sd-loc[aria-checked="true"],' + D + ' .sd-cond button[aria-checked="true"]{background:#2563eb;border-color:#2563eb;color:#fff;}',
            D + ' .sd-chip[aria-checked="true"]{background:color-mix(in srgb,var(--c) 30%,transparent);border-color:var(--c);color:#fff;}',
            D + ' .sd-chip[aria-checked="true"] i{color:#fff;}',
            D + ' .sd-cant{border-color:var(--border-color);}',
            D + ' .sd-cant span{color:var(--text-color);}',
            D + ' .sd-resumen{background:rgba(77,171,247,.08);border-color:rgba(77,171,247,.3);color:#cfe6ff;}',
            D + ' .sd-resumen b{color:#fff;}',
            D + ' .sd-dup{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.45);}',
            D + ' .sd-dup-h{color:#fcd34d;}',
            D + ' .sd-dup-cand{background:rgba(15,23,42,.55);border-color:var(--border-color);}',
            D + ' .sd-dup-lbl{color:var(--text-muted-color);}',
            D + ' .sd-areabox{background:rgba(255,255,255,.04);border-color:var(--border-color);}',
            D + ' .sd-area-h{color:#c3c9d2;}',
            D + ' .sd-area-h .h{color:var(--text-muted-color);}',
            D + ' .sd-area-btn{background:rgba(255,255,255,.04);border-color:var(--border-color);color:#c3c9d2;}',
            D + ' .sd-area-nota{color:#6ee7b7;}',
            D + ' .sd-area-nota.is-man{color:#fcd34d;}'
        ];
    }

    function ensureDescModal() {
        if ($(DESC_ID)) return;
        var style = document.createElement('style');
        style.id = 'setp-desc-styles';
        var M = '#' + DESC_ID;
        style.textContent = [
            M + '{position:fixed;inset:0;z-index:1085;display:flex;align-items:center;justify-content:center;padding:16px;',
            'background:rgba(15,23,42,.38);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .18s ease;}',
            M + '.is-open{opacity:1;}',
            M + '[hidden]{display:none;}',
            M + ' .sd-card{width:100%;max-width:560px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;',
            'background:rgba(255,255,255,.96);border:1px solid #e2e8f0;border-radius:18px;',
            'box-shadow:0 24px 60px rgba(15,23,42,.28);transform:translateY(8px) scale(.98);transition:transform .18s ease;overflow:hidden;}',
            M + '.is-open .sd-card{transform:none;}',
            M + ' .sd-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #e2e8f0;flex:none;}',
            M + ' .sd-icon{width:40px;height:40px;border-radius:12px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;flex:none;}',
            M + ' .sd-kicker{font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;}',
            M + ' .sd-title{font-size:1.05rem;font-weight:800;color:#0f172a;margin:0;}',
            M + ' .sd-head .btn-close{margin-left:auto;}',
            M + ' .sd-body{padding:16px 18px;overflow-y:auto;flex:1 1 auto;min-height:0;}',
            M + ' .sd-info{display:flex;gap:14px;align-items:center;padding:10px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;margin-bottom:12px;}',
            M + ' .sd-info img{width:112px;height:80px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;flex:none;}',
            M + ' .sd-lbl{font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;}',
            M + ' .sd-val{font-size:.88rem;font-weight:600;color:#0f172a;margin-bottom:6px;overflow-wrap:anywhere;}',
            M + ' label{font-size:.8rem;font-weight:700;color:#334155;margin-bottom:4px;}',
            M + ' textarea{resize:vertical;min-height:64px;}',
            M + ' .sd-count{font-size:.72rem;color:#64748b;text-align:right;margin-top:4px;}',
            M + ' .sd-note{font-size:.76rem;color:#64748b;margin-top:8px;}',
            // Pasos
            M + ' .sd-paso{display:flex;align-items:center;gap:8px;margin:14px 0 6px;font-size:.8rem;font-weight:700;color:#334155;}',
            M + ' .sd-paso:first-child{margin-top:0;}',
            M + ' .sd-paso .n{width:20px;height:20px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:.7rem;display:inline-flex;align-items:center;justify-content:center;flex:none;}',
            M + ' .sd-paso .h{font-weight:400;color:#64748b;font-size:.76rem;}',
            M + ' .sd-et{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px;}',
            M + ' .sd-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px;}',
            M + ' .sd-chip{display:flex;align-items:center;gap:7px;font:inherit;font-size:.78rem;font-weight:600;padding:7px 9px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;color:#334155;text-align:left;cursor:pointer;line-height:1.2;}',
            M + ' .sd-chip i{width:16px;text-align:center;color:var(--c);flex:none;}',
            M + ' .sd-items .sd-chip{flex-direction:column;justify-content:center;text-align:center;padding:9px 6px;gap:4px;}',
            M + ' .sd-items .sd-chip i{font-size:1.05rem;width:auto;}',
            M + ' .sd-chip:hover{background:#f1f5f9;}',
            M + ' .sd-chip[aria-checked="true"]{background:color-mix(in srgb,var(--c) 12%,#fff);border-color:var(--c);color:#0f172a;font-weight:700;}',
            M + ' .sd-cond{display:flex;flex-wrap:wrap;gap:6px;}',
            M + ' .sd-cond button{font:inherit;font-size:.78rem;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;}',
            M + ' .sd-cond button:hover{background:#f1f5f9;}',
            M + ' .sd-cond button[aria-checked="true"]{background:#2563eb;border-color:#2563eb;color:#fff;}',
            M + ' .sd-cant{display:inline-flex;align-items:center;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;}',
            M + ' .sd-cant button{width:38px;height:34px;border:0;background:#f8fafc;color:#334155;font-weight:800;cursor:pointer;}',
            M + ' .sd-cant span{min-width:46px;text-align:center;font-weight:800;color:#0f172a;}',
            M + ' .sd-areabox{margin-top:14px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;}',
            M + ' .sd-areabox:empty{display:none;}',
            M + ' .sd-area-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.8rem;font-weight:700;color:#334155;margin-bottom:6px;}',
            M + ' .sd-area-h .h{font-weight:400;color:#64748b;font-size:.74rem;}',
            M + ' .sd-area-fila{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
            M + ' .sd-area-fila .setp-area-chip{font-size:.8rem;padding:5px 12px;}',
            M + ' .sd-area-btn{font:inherit;font-size:.74rem;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;}',
            M + ' .sd-area-nota{font-size:.74rem;font-weight:600;color:#047857;margin-top:5px;}',
            M + ' .sd-area-nota.is-man{color:#b45309;}',
            M + ' .sd-area-lista{margin-top:8px;}',
            M + ' .sd-area-lista button i{color:var(--c);margin-right:5px;}',
            M + ' .sd-area-lista button[aria-checked="true"] i{color:#fff;}',
            M + ' .sd-resumen{display:flex;align-items:flex-start;gap:8px;margin:14px 0 4px;padding:9px 11px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;font-size:.82rem;color:#1e3a8a;}',
            M + ' .sd-resumen i{margin-top:2px;}',
            M + ' .sd-mod-lista{list-style:none;margin:0;padding:4px;border:1px solid #e2e8f0;border-radius:12px;max-height:168px;overflow-y:auto;background:#fff;}',
            M + ' .sd-mod-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;font-size:.86rem;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:#0f172a;cursor:pointer;}',
            M + ' .sd-mod-item:hover{background:#f1f5f9;}',
            M + ' .sd-mod-item[aria-checked="true"]{background:#eff6ff;color:#1d4ed8;font-weight:700;}',
            M + ' .sd-loc-lista{display:flex;flex-wrap:wrap;gap:6px;max-height:132px;overflow-y:auto;padding:4px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;}',
            M + ' .sd-loc{font:inherit;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;}',
            M + ' .sd-loc:hover{background:#f1f5f9;}',
            M + ' .sd-loc[aria-checked="true"]{background:#2563eb;border-color:#2563eb;color:#fff;}',
            M + ' .sd-mod-vacio{font-size:.82rem;color:#64748b;padding:10px;text-align:center;}',
            M + ' :is(.sd-chip,.sd-cond button,.sd-loc,.sd-mod-item,.sd-cant button):focus-visible{outline:3px solid rgba(37,99,235,.45);outline-offset:1px;}',
            '@media (pointer:coarse){' + M + ' .sd-loc,' + M + ' .sd-cond button{min-height:40px;padding:6px 12px;}' + M + ' .sd-mod-item,' + M + ' .sd-chip{min-height:40px;}' + M + ' .sd-cant button{width:44px;height:40px;}}',
            // ¿Es el mismo?
            M + ' .sd-dup{border:1px solid #fcd34d;background:#fffbeb;border-radius:14px;padding:12px;}',
            M + ' .sd-dup-h{display:flex;gap:8px;align-items:flex-start;font-size:.84rem;color:#92400e;font-weight:700;margin-bottom:10px;}',
            M + ' .sd-dup-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start;}',
            M + ' .sd-dup-lbl{font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:4px;}',
            M + ' .sd-dup-foto{width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;display:block;background:#e2e8f0;}',
            M + ' .sd-dup-tit{font-size:.8rem;font-weight:700;color:#0f172a;margin-top:6px;overflow-wrap:anywhere;}',
            M + ' .sd-dup-sub{font-size:.74rem;color:#64748b;overflow-wrap:anywhere;}',
            M + ' .sd-dup-lista{display:flex;flex-direction:column;gap:10px;max-height:340px;overflow-y:auto;}',
            M + ' .sd-dup-cand{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:8px;}',
            M + ' .sd-dup-cand .btn{width:100%;margin-top:8px;}',
            M + ' .sd-dup-btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}',
            M + ' .sd-dup-btns .btn{flex:1 1 160px;}',
            '@media (max-width:480px){' + M + ' .sd-dup-grid{grid-template-columns:1fr;}}',
            M + ' .sd-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;flex:none;}',
            '@media (prefers-reduced-motion:reduce){' + M + ',' + M + ' .sd-card{transition:none;}}'
        ].concat(descEstilosOscuros('body.dark-mode ' + M)).join('');
        document.head.appendChild(style);
        var paso = function (n, texto, ayuda, id) {
            return '<div class="sd-paso"' + (id ? ' id="' + id + '"' : '') + '><span class="n">' + n + '</span>' + texto + (ayuda ? ' <span class="h">· ' + ayuda + '</span>' : '') + '</div>';
        };
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div id="' + DESC_ID + '" role="dialog" aria-modal="true" aria-labelledby="setp-desc-title" hidden>' +
            '<form class="sd-card" id="setp-desc-form" novalidate>' +
            '<div class="sd-head"><div class="sd-icon"><i class="fas fa-magnifying-glass"></i></div>' +
            '<div><div class="sd-kicker">Hallazgos detectados</div><h3 class="sd-title" id="setp-desc-title">Descripción del hallazgo</h3></div>' +
            '<button type="button" class="btn-close" data-desc="cerrar" aria-label="Cerrar"></button></div>' +
            '<div class="sd-body">' +
            '<div class="sd-info"><img id="setp-desc-foto" alt="Foto del hallazgo">' +
            '<div><div class="sd-lbl">Ubicación</div><div class="sd-val" id="setp-desc-area"></div>' +
            '<div class="sd-lbl">Recorrido</div><div class="sd-val mb-0" id="setp-desc-fecha"></div></div></div>' +
            '<div id="setp-desc-aviso" class="d-none"></div>' +
            '<div id="setp-desc-captura">' +
            paso(1, 'Etiqueta *', 'tipo de hallazgo', 'setp-desc-et-lbl') +
            '<div class="sd-et" id="setp-desc-et" role="radiogroup" aria-labelledby="setp-desc-et-lbl"></div>' +
            '<div id="setp-desc-item-wrap" hidden>' + paso(2, 'Item *', '¿qué elemento?', 'setp-desc-item-lbl') +
            '<div class="sd-items" id="setp-desc-item" role="radiogroup" aria-labelledby="setp-desc-item-lbl"></div>' +
            // Etiqueta "Otro": la descripción se escribe aquí, justo después del item.
            '<div id="setp-desc-otro-slot"></div>' +
            paso(3, 'Condición *', '', 'setp-desc-cond-lbl') +
            '<div class="sd-cond" id="setp-desc-cond" role="radiogroup" aria-labelledby="setp-desc-cond-lbl"></div>' +
            paso(4, 'Cantidad', 'piezas') +
            '<div class="sd-cant"><button type="button" data-cant="-1" aria-label="Menos">−</button><span id="setp-desc-cant" aria-live="polite">1</span><button type="button" data-cant="1" aria-label="Más">+</button></div>' +
            // Área responsable: sale sola de la etiqueta y el item (js/setp-catalogo.js).
            '<div class="sd-areabox" id="setp-desc-areabox" aria-live="polite"></div></div>' +
            paso(5, 'Módulo *', '', 'setp-desc-mod-lbl').replace('</div>', '<span class="h" id="setp-desc-mod-nivel"></span></div>') +
            '<ul class="sd-mod-lista" id="setp-desc-mod" role="radiogroup" aria-labelledby="setp-desc-mod-lbl"></ul>' +
            '<div id="setp-desc-loc-wrap" hidden>' + paso(6, 'Local *', '', 'setp-desc-loc-lbl').replace('</div>', '<span class="h" id="setp-desc-loc-mod"></span></div>') +
            '<div class="sd-loc-lista" id="setp-desc-loc" role="radiogroup" aria-labelledby="setp-desc-loc-lbl"></div></div>' +
            '<div class="sd-resumen d-none" id="setp-desc-resumen"></div>' +
            '<div id="setp-desc-text-home" hidden></div>' +
            '<div id="setp-desc-text-wrap">' +
            '<label for="setp-desc-text" class="mt-2" id="setp-desc-text-lbl">Detalle <span class="fw-normal text-muted">(opcional)</span></label>' +
            '<textarea id="setp-desc-text" class="form-control" maxlength="' + DESC_MAX + '" rows="2" placeholder="Ej. Respaldo roto en la fila 3"></textarea>' +
            '<div class="sd-count"><span id="setp-desc-n">0</span>/' + DESC_MAX + '</div></div>' +
            '<div class="sd-note"><i class="fas fa-circle-info me-1"></i>Al guardar se revisa si ya está reportado y se cierra esta ventana. Después presiona <b>✓</b> para confirmar el hallazgo.</div>' +
            '</div>' +
            '<div id="setp-desc-dup" hidden></div>' +
            '</div>' +
            '<div class="sd-foot" id="setp-desc-foot"><button type="button" class="btn btn-outline-secondary" data-desc="cerrar">Cancelar</button>' +
            '<button type="submit" class="btn btn-primary" id="setp-desc-guardar"><i class="fas fa-save me-1"></i>Guardar</button></div>' +
            '</form></div>';
        var modal = wrap.firstChild;
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal || e.target.closest('[data-desc="cerrar"]')) return cerrarDescripcion();
            var p = state.descFor && state.pending[state.descFor];
            if (!p) return;
            var b;
            // Al elegir algo se quita el aviso de "Falta elegir…".
            if (e.target.closest('[data-etq], [data-item], [data-cond], [data-modulo], [data-local]')) descAviso('');
            if ((b = e.target.closest('[data-etq]'))) {
                var etq = b.getAttribute('data-etq');
                if (p.etiqueta !== etq) { p.etiqueta = etq; p.item = ''; p.condicion = ''; p.area = ''; state.areaElegir = false; }
                pintarCaptura();
            } else if ((b = e.target.closest('[data-item]'))) {
                p.item = p.item === b.getAttribute('data-item') ? '' : b.getAttribute('data-item');
                // Otro item: el área vuelve a ser la de la regla.
                p.area = '';
                state.areaElegir = false;
                pintarCaptura();
                // Etiqueta "Otro": al elegir el item se pasa a escribir la descripción.
                if (p.etiqueta === 'OTRO' && p.item) $('setp-desc-text').focus();
            } else if ((b = e.target.closest('[data-area-cambiar]'))) {
                state.areaElegir = !state.areaElegir;
                pintarArea();
            } else if ((b = e.target.closest('[data-area-auto]'))) {
                p.area = '';
                state.areaElegir = false;
                pintarArea();
            } else if ((b = e.target.closest('[data-area-elige]'))) {
                var cat0 = catalogo();
                var elegida = b.getAttribute('data-area-elige');
                // Elegir la misma que marca la regla equivale a dejarla automática.
                p.area = cat0 && elegida === cat0.areaRegla(p.etiqueta, p.item) ? '' : elegida;
                state.areaElegir = false;
                pintarArea();
            } else if ((b = e.target.closest('[data-cond]'))) {
                p.condicion = p.condicion === b.getAttribute('data-cond') ? '' : b.getAttribute('data-cond');
                pintarCaptura();
            } else if ((b = e.target.closest('[data-cant]'))) {
                p.cantidad = Math.min(99, Math.max(1, (Number(p.cantidad) || 1) + Number(b.getAttribute('data-cant'))));
                pintarCaptura();
            } else if ((b = e.target.closest('[data-modulo]'))) {
                var nombre = b.getAttribute('data-modulo');
                // Tocar el módulo elegido lo quita; al cambiar de módulo se limpia el local.
                p.modulo = p.modulo === nombre ? '' : nombre;
                p.local = '';
                pintarCaptura();
            } else if ((b = e.target.closest('[data-local]'))) {
                var loc = b.getAttribute('data-local');
                p.local = p.local === loc ? '' : loc;
                pintarCaptura();
            } else if ((b = e.target.closest('[data-dup-mismo]'))) {
                p.mismoQue = { id: b.getAttribute('data-dup-mismo'), folio: b.getAttribute('data-dup-folio') || '' };
                terminarDescripcion();
            } else if (e.target.closest('[data-dup="otro"]')) {
                p.mismoQue = null;
                terminarDescripcion();
            } else if (e.target.closest('[data-dup="volver"]')) {
                vistaDuplicados(false);
            }
        });
        modal.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); cerrarDescripcion(); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardarDescripcion(); }
            else if (e.key === 'Tab') {
                // El foco se queda dentro de la ventana.
                var f = Array.prototype.filter.call(modal.querySelectorAll('button, textarea'), function (x) { return x.offsetParent !== null; });
                var first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
        $('setp-desc-text').addEventListener('input', function (e) {
            var p = state.descFor && state.pending[state.descFor];
            if (p) p.detalle = e.target.value;
            $('setp-desc-n').textContent = e.target.value.length;
            pintarResumen();
        });
        $('setp-desc-form').addEventListener('submit', function (e) { e.preventDefault(); guardarDescripcion(); });
    }

    // Módulos del nivel (área de recorrido) del recorrido abierto.
    function modulosDe(r) {
        var cat = catalogo();
        return cat ? cat.modulos(r.area_recorrido) : [];
    }

    // Texto de ubicación: "10.50 · Módulo E4 · SEIE4-12".
    function ubicacionTexto(r, p) {
        var m = modulosDe(r).find(function (x) { return x.nombre === p.modulo; });
        return [r.area_recorrido, m ? moduloTexto(m) : '', p.local].filter(Boolean).join(' · ');
    }

    function pintarCaptura() {
        var r = state.descFor && state.recorridos.find(function (x) { return x.id === state.descFor; });
        var p = state.descFor && state.pending[state.descFor];
        var cat = catalogo();
        if (!r || !p || !cat || !$('setp-desc-et')) return;
        var radio = function (on) { return ' role="radio" aria-checked="' + !!on + '"'; };
        // 1 · Etiqueta
        $('setp-desc-et').innerHTML = cat.etiquetas.map(function (e) {
            return '<button type="button" class="sd-chip" style="--c:' + e.color + '" data-etq="' + e.key + '"' + radio(p.etiqueta === e.key) + '>' +
                '<i class="fas ' + e.icono + '"></i>' + esc(e.nombre) + '</button>';
        }).join('');
        // 2 · Item, 3 · Condición, 4 · Cantidad
        var etq = cat.etiqueta(p.etiqueta);
        $('setp-desc-item-wrap').hidden = !etq;
        if (etq) {
            $('setp-desc-item').innerHTML = cat.items(etq.key).map(function (i) {
                return '<button type="button" class="sd-chip" style="--c:' + etq.color + '" data-item="' + esc(i.nombre) + '"' + radio(p.item === i.nombre) + '>' +
                    '<i class="fas ' + i.icono + '"></i>' + esc(i.nombre) + '</button>';
            }).join('');
            $('setp-desc-cond').innerHTML = cat.condiciones(etq.key).map(function (c) {
                return '<button type="button" data-cond="' + c.key + '"' + radio(p.condicion === c.key) + '>' + esc(c.texto) + '</button>';
            }).join('');
            $('setp-desc-cant').textContent = String(p.cantidad || 1);
            pintarArea();
        }
        // 5 · Módulo y 6 · Local
        var modulos = modulosDe(r);
        $('setp-desc-mod-nivel').textContent = '· Nivel ' + r.area_recorrido;
        $('setp-desc-mod').innerHTML = modulos.length
            ? modulos.map(function (m) {
                var on = p.modulo === m.nombre;
                return '<li><button type="button" class="sd-mod-item" data-modulo="' + esc(m.nombre) + '"' + radio(on) + '>' +
                    '<i class="' + (on ? 'fas fa-circle-dot' : 'far fa-circle') + '"></i>' + esc(moduloTexto(m)) + '</button></li>';
            }).join('')
            : '<li class="sd-mod-vacio">Aún no hay módulos para el nivel ' + esc(r.area_recorrido) + '.</li>';
        var elegido = modulos.find(function (m) { return m.nombre === p.modulo; });
        $('setp-desc-loc-wrap').hidden = !elegido;
        if (elegido) {
            $('setp-desc-loc-mod').textContent = '· ' + elegido.nombre;
            $('setp-desc-loc').innerHTML = elegido.locales.map(function (l) {
                return '<button type="button" class="sd-loc" data-local="' + esc(l) + '"' + radio(p.local === l) + '>' + esc(l) + '</button>';
            }).join('');
        }
        // Con item "Otro" el detalle es obligatorio (es la descripción).
        var otro = p.item === cat.OTRO;
        // Etiqueta "Otro": la casilla de descripción sube justo debajo del item
        // y sale hasta elegirlo; en las demás etiquetas va al final, como siempre.
        var etqOtro = p.etiqueta === 'OTRO';
        var caja = $('setp-desc-text-wrap');
        if (etqOtro) { if (caja.parentNode !== $('setp-desc-otro-slot')) $('setp-desc-otro-slot').appendChild(caja); }
        else if (caja.previousElementSibling !== $('setp-desc-text-home')) $('setp-desc-text-home').after(caja);
        caja.hidden = etqOtro && !p.item;
        $('setp-desc-text-lbl').innerHTML = etqOtro ? 'Descripción *' : (otro ? 'Describe el elemento *' : 'Detalle <span class="fw-normal text-muted">(opcional)</span>');
        $('setp-desc-text').placeholder = etqOtro ? 'Describe el hallazgo: qué es y qué tiene (ej. Cartel del evento desprendido)' : (otro ? 'Ej. Cartel del evento desprendido' : 'Ej. Respaldo roto en la fila 3');
        $('setp-desc-area').textContent = ubicacionTexto(r, p);
        pintarResumen();
    }

    // Área responsable del hallazgo: la de la regla (etiqueta + item) con cómo
    // reportarle. "Cambiar" aparece sólo si la base ya guarda el área elegida
    // (columna area de setp_hallazgos).
    function pintarArea() {
        var p = state.descFor && state.pending[state.descFor];
        var cat = catalogo();
        var box = $('setp-desc-areabox');
        if (!p || !cat || !box) return;
        if (!p.etiqueta || !cat.areaChip) { box.innerHTML = ''; return; }
        var regla = cat.areaRegla(p.etiqueta, p.item);
        var key = p.area || regla;
        var manual = !!p.area && p.area !== regla;
        var puede = state.areaCol === true;
        var html = '<div class="sd-area-h"><i class="fas fa-route"></i>Área responsable <span class="h">· se asigna sola según la etiqueta y el item</span></div>' +
            '<div class="sd-area-fila">' + cat.areaChip(key) +
            (puede ? '<button type="button" class="sd-area-btn" data-area-cambiar aria-expanded="' + !!state.areaElegir + '"><i class="fas fa-pen me-1"></i>' + (key ? 'Cambiar' : 'Elegir área') + '</button>' : '') +
            (puede && manual ? '<button type="button" class="sd-area-btn" data-area-auto><i class="fas fa-rotate-left me-1"></i>Usar la automática</button>' : '') + '</div>';
        if (manual) html += '<div class="sd-area-nota is-man"><i class="fas fa-user-pen me-1"></i>Cambiada por el supervisor' + (regla ? ' (la regla marca ' + esc(cat.area(regla).corto) + ')' : '') + '</div>';
        else if (key) html += '<div class="sd-area-nota"><i class="fas fa-wand-magic-sparkles me-1"></i>Asignada automáticamente</div>';
        else html += '<div class="sd-area-nota is-man"><i class="fas fa-circle-info me-1"></i>' + (puede ? 'Las tablas de responsables no lo asignan: queda a consideración del supervisor. Elige a qué área se reporta.' : 'Las tablas de responsables no lo asignan: queda a consideración del supervisor.') + '</div>';
        html += cat.areaInfo(key);
        if (puede && state.areaElegir) {
            html += '<div class="sd-cond sd-area-lista" role="radiogroup" aria-label="Área responsable">' + cat.areas().map(function (a) {
                return '<button type="button" data-area-elige="' + a.key + '" style="--c:' + a.color + '" role="radio" aria-checked="' + (a.key === key) + '"><i class="fas ' + a.icono + '"></i>' + esc(a.corto) + '</button>';
            }).join('') + '</div>';
        }
        box.innerHTML = html;
    }

    // ¿La base guarda el área elegida a mano? Se revisa una vez por sesión.
    async function revisarColumnaArea() {
        if (state.areaCol !== null) return;
        state.areaCol = false;
        try {
            var sb = await getClient();
            var res = await sb.from('setp_hallazgos').select('area').limit(1);
            state.areaCol = !res.error;
        } catch (_) { state.areaCol = false; }
        if (state.areaCol && state.descFor) pintarArea();
    }

    function pintarResumen() {
        var r = state.descFor && state.recorridos.find(function (x) { return x.id === state.descFor; });
        var p = state.descFor && state.pending[state.descFor];
        var cat = catalogo();
        var box = $('setp-desc-resumen');
        if (!r || !p || !cat || !box) return;
        var etq = cat.etiqueta(p.etiqueta);
        var texto = p.item && p.condicion ? cat.componer(p) : '';
        box.classList.toggle('d-none', !texto);
        if (!texto) return;
        var lugar = p.local ? ubicacionTexto(r, p) : '';
        box.innerHTML = '<i class="fas fa-clipboard-check"></i><div>Se registrará: <b>' + esc(texto) + '</b>' +
            '<div class="small">' + esc(etq ? etq.nombre : '') + (lugar ? ' · ' + esc(lugar) : '') + '</div></div>';
    }

    function descAviso(html, tipo) {
        var box = $('setp-desc-aviso');
        box.className = html ? 'alert alert-' + (tipo || 'warning') + ' py-2 small mb-2' : 'd-none';
        box.innerHTML = html || '';
    }

    function vistaDuplicados(on) {
        $('setp-desc-captura').hidden = !!on;
        $('setp-desc-dup').hidden = !on;
        $('setp-desc-foot').hidden = !!on;
        $('setp-desc-title').textContent = on ? '¿Es el mismo hallazgo?' : 'Descripción del hallazgo';
        if (!on) $('setp-desc-dup').innerHTML = '';
        var body = document.querySelector('#' + DESC_ID + ' .sd-body');
        if (body) body.scrollTop = 0;
    }

    function abrirDescripcion(id, aviso) {
        var r = state.recorridos.find(function (x) { return x.id === id; });
        var p = state.pending[id];
        if (!r || !p || !p.esFoto) return;
        ensureDescModal();
        state.descFor = id;
        if (!p.cantidad) p.cantidad = 1;
        $('setp-desc-foto').src = p.url;
        $('setp-desc-fecha').textContent = (fecha(r.registrado_en) || '—') + ' · ' + hhmm(r.hora_inicio) + ' hrs' + (p.extra ? ' · evidencia adicional' : '');
        $('setp-desc-text').value = p.detalle || '';
        $('setp-desc-n').textContent = String((p.detalle || '').length);
        descAviso(aviso || '', 'info');
        vistaDuplicados(false);
        state.areaElegir = false;
        pintarCaptura();
        revisarColumnaArea();
        var modal = $(DESC_ID);
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(function () { modal.classList.add('is-open'); });
        setTimeout(function () {
            var foco = modal.querySelector('.sd-chip[aria-checked="true"]') || modal.querySelector('.sd-chip');
            if (foco) foco.focus();
        }, 30);
    }

    function cerrarDescripcion() {
        var modal = $(DESC_ID);
        if (!modal || modal.hidden) return;
        var id = state.descFor;
        state.descFor = null;
        modal.classList.remove('is-open');
        document.body.style.overflow = '';
        setTimeout(function () { if (!modal.classList.contains('is-open')) modal.hidden = true; }, 180);
        // Regresa el foco al ✓ (o a la evidencia) del recorrido.
        var back = state.el && (state.el.querySelector('[data-rec="guardar"][data-id="' + id + '"]') || state.el.querySelector('[data-rec="descripcion"][data-id="' + id + '"]'));
        if (back) back.focus();
    }

    // Lo que falta por capturar (el primer paso pendiente recibe el foco).
    function faltantes(p) {
        var cat = catalogo();
        var f = [];
        if (!p.etiqueta) f.push(['etiqueta', '#setp-desc-et']);
        else if (!p.item) f.push(['item', '#setp-desc-item']);
        if (p.etiqueta && !p.condicion) f.push(['condición', '#setp-desc-cond']);
        if (!p.modulo) f.push(['módulo', '#setp-desc-mod']);
        else if (!p.local) f.push(['local', '#setp-desc-loc']);
        if (cat && p.item === cat.OTRO && !String(p.detalle || '').trim()) f.push([p.etiqueta === 'OTRO' ? 'descripción' : 'descripción del elemento', '#setp-desc-text']);
        return f;
    }

    // Hallazgos pendientes iguales en la base: mismo item en el mismo local
    // (y nivel); si el objeto se mueve (maleta, mochila…), en todos los niveles
    // del edificio durante las últimas 24 h, porque alguien pudo cambiarlo de
    // piso. Sin las columnas de db/setp_hallazgos_identificacion.sql no revisa.
    async function buscarDuplicados(r, p) {
        var cat = catalogo();
        if (!cat || (p.item === cat.OTRO && !cat.esMovible(p.etiqueta, p.item))) return [];
        try {
            var sb = await getClient();
            var res = await sb.from('setp_hallazgos')
                .select('id, folio, fecha_reporte, created_at, modulo, local, nivel, etiqueta, item, condicion, cantidad, descripcion, evidencia_url, no_empleado, veces')
                .eq('estatus', 'PENDIENTE').is('duplicado_de', null).eq('etiqueta', p.etiqueta).eq('item', p.item)
                .order('created_at', { ascending: false }).limit(40);
            if (res.error) return [];
            var nivel = cat.nivel(r.area_recorrido);
            var mov = cat.esMovible(p.etiqueta, p.item);
            var desde = Date.now() - MOVIBLE_HORAS * 3600 * 1000;
            return (res.data || []).filter(function (h) {
                if (mov) return new Date(h.created_at).getTime() >= desde;
                if (cat.nivel(h.nivel) !== nivel) return false;
                return h.local === p.local;
            });
        } catch (_) {
            return [];
        }
    }

    function fechaHora(ts) {
        var d = ts ? new Date(ts) : null;
        if (!d || isNaN(d)) return '';
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
            d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function pintarDuplicados(r, p, lista) {
        var cat = catalogo();
        var etq = cat.etiqueta(p.etiqueta);
        var mov = cat.esMovible(p.etiqueta, p.item);
        var yo = supervisor(r.no_empleado);
        var foto = function (url) {
            return url ? '<img class="sd-dup-foto" src="' + esc(url) + '" alt="Foto del hallazgo registrado">' : '<div class="sd-dup-foto d-flex align-items-center justify-content-center small text-muted">Sin foto</div>';
        };
        var donde = mov ? 'en el edificio terminal (todos los niveles) durante las últimas ' + MOVIBLE_HORAS + ' h' : 'en este mismo local (' + esc(p.local) + ')';
        $('setp-desc-dup').innerHTML = '<div class="sd-dup">' +
            '<div class="sd-dup-h"><i class="fas fa-triangle-exclamation mt-1"></i><span>' +
            (lista.length === 1 ? 'Ya hay un hallazgo pendiente igual' : 'Ya hay ' + lista.length + ' hallazgos pendientes iguales') +
            ': <b>' + esc(etq ? etq.nombre : '') + ' › ' + esc(p.item) + '</b> ' + donde + '.</span></div>' +
            '<div class="sd-dup-grid">' +
            '<div><div class="sd-dup-lbl">Tu foto · ahora</div>' + foto(p.url) +
            '<div class="sd-dup-tit">' + esc(cat.componer(p)) + '</div>' +
            '<div class="sd-dup-sub">' + esc(yo ? yo.nombre : r.no_empleado) + ' · ' + esc(ubicacionTexto(r, p)) + '</div></div>' +
            '<div class="sd-dup-lista">' + lista.map(function (h) {
                var s = supervisor(h.no_empleado);
                return '<div class="sd-dup-cand"><div class="sd-dup-lbl">' + esc(h.folio || 'Registrado') + ' · pendiente</div>' + foto(h.evidencia_url) +
                    '<div class="sd-dup-tit">' + esc(h.descripcion) + '</div>' +
                    '<div class="sd-dup-sub">' + esc([h.nivel, h.modulo, h.local].filter(Boolean).join(' · ')) + '</div>' +
                    '<div class="sd-dup-sub">' + esc(s ? s.nombre : (h.no_empleado || '')) + ' · ' + esc(fechaHora(h.created_at) || h.fecha_reporte) +
                    (h.veces > 1 ? ' · reportado ' + h.veces + ' veces' : '') + '</div>' +
                    '<button type="button" class="btn btn-warning btn-sm" data-dup-mismo="' + esc(h.id) + '" data-dup-folio="' + esc(h.folio || '') + '"><i class="fas fa-link me-1"></i>Es el mismo · agregar mi foto</button></div>';
            }).join('') + '</div></div>' +
            '<div class="small mt-2" style="color:inherit"><i class="fas fa-circle-info me-1"></i>Compara las fotos. Si es el mismo, tu foto se agrega a ese hallazgo y no se crea otro.</div>' +
            '<div class="sd-dup-btns"><button type="button" class="btn btn-outline-secondary btn-sm" data-dup="volver"><i class="fas fa-arrow-left me-1"></i>Regresar</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-dup="otro"><i class="fas fa-plus me-1"></i>Es otro hallazgo</button></div></div>';
        vistaDuplicados(true);
        var b = $('setp-desc-dup').querySelector('[data-dup-mismo]');
        if (b) b.focus();
    }

    async function guardarDescripcion() {
        var id = state.descFor;
        var p = id && state.pending[id];
        var r = id && state.recorridos.find(function (x) { return x.id === id; });
        if (!p || !r) return cerrarDescripcion();
        if (!catalogo()) return descAviso('No se cargó el catálogo de hallazgos (js/setp-catalogo.js). Recarga la página.', 'danger');
        p.detalle = $('setp-desc-text').value.trim().replace(/\s+/g, ' ');
        var falta = faltantes(p);
        if (falta.length) {
            descAviso('Falta elegir: <b>' + falta.map(function (f) { return f[0]; }).join(', ') + '</b>.');
            var el = document.querySelector('#' + DESC_ID + ' ' + falta[0][1]);
            if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); var f = el.matches('textarea') ? el : el.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
            return;
        }
        descAviso('');
        p.mismoQue = null;
        var btn = $('setp-desc-guardar');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Revisando…';
        var lista = await buscarDuplicados(r, p);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save me-1"></i>Guardar';
        if (state.descFor !== id) return; // se cerró mientras revisaba
        if (lista.length) return pintarDuplicados(r, p, lista);
        terminarDescripcion();
    }

    function terminarDescripcion() {
        var p = state.descFor && state.pending[state.descFor];
        if (!p) return cerrarDescripcion();
        p.descripcion = catalogo().componer(p);
        render();
        cerrarDescripcion();
        setStatus(p.mismoQue
            ? 'Tu foto se agregará al hallazgo <b>' + esc(p.mismoQue.folio || 'registrado') + '</b> (no se crea otro). Presiona <b>✓</b> para confirmar.'
            : 'Descripción guardada. Presiona <b>✓</b> para confirmar la evidencia y agregar el hallazgo a <b>Hallazgos detectados</b>.', 'info');
    }

    // ---------- Crear usuario (supervisor) ----------

    function ensureModal() {
        if ($(MODAL_ID)) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = [
            '<div class="modal fade" id="' + MODAL_ID + '" tabindex="-1" aria-labelledby="setp-usuario-title" aria-hidden="true">',
            ' <div class="modal-dialog">',
            '  <form class="modal-content" id="setp-usuario-form" novalidate>',
            '   <div class="modal-header"><h5 class="modal-title fw-bold" id="setp-usuario-title"><i class="fas fa-user-plus me-2 text-primary"></i>Crear usuario</h5>',
            '    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>',
            '   <div class="modal-body">',
            '    <div id="setp-usuario-status" class="d-none"></div>',
            '    <div class="mb-2"><label class="form-label small fw-semibold mb-1" for="setp-usuario-no">No. de empleado *</label><input type="text" id="setp-usuario-no" class="form-control" required></div>',
            '    <div class="mb-2"><label class="form-label small fw-semibold mb-1" for="setp-usuario-nombre">Nombre y apellido *</label><input type="text" id="setp-usuario-nombre" class="form-control" required></div>',
            '    <div class="mb-1"><label class="form-label small fw-semibold mb-1" for="setp-usuario-cargo">Cargo</label><input type="text" id="setp-usuario-cargo" class="form-control"></div>',
            '   </div>',
            '   <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>',
            '    <button type="submit" class="btn btn-primary" id="setp-usuario-save"><i class="fas fa-save me-1"></i>Guardar</button></div>',
            '  </form>',
            ' </div>',
            '</div>'
        ].join('');
        document.body.appendChild(wrap.firstChild);
        $('setp-usuario-form').addEventListener('submit', function (e) {
            e.preventDefault();
            if (state.editando) editarUsuario(); else crearUsuario();
        });
    }

    function modalStatus(message) {
        var box = $('setp-usuario-status');
        box.className = message ? 'alert alert-warning py-2 small' : 'd-none';
        box.innerHTML = message || '';
    }

    function ordenarSupervisores(list) {
        return list.sort(function (a, b) {
            return String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
        });
    }

    // El mismo modal sirve para crear (s = null) y para editar (s = supervisor).
    function abrirModalUsuario(s) {
        if (!esSuperadmin()) return;
        ensureModal();
        $('setp-usuario-form').reset();
        modalStatus('');
        state.editando = s ? s.no_empleado : null;
        $('setp-usuario-title').innerHTML = s
            ? '<i class="fas fa-user-pen me-2 text-primary"></i>Editar usuario'
            : '<i class="fas fa-user-plus me-2 text-primary"></i>Crear usuario';
        if (s) {
            $('setp-usuario-no').value = s.no_empleado;
            $('setp-usuario-nombre').value = s.nombre || '';
            $('setp-usuario-cargo').value = s.cargo || '';
        }
        var modal = bootstrap.Modal.getOrCreateInstance($(MODAL_ID));
        $(MODAL_ID).addEventListener('shown.bs.modal', function () { $('setp-usuario-no').focus(); }, { once: true });
        modal.show();
    }

    function abrirCrearUsuario() {
        abrirModalUsuario(null);
    }

    function abrirEditarUsuario(no) {
        var s = supervisor(no);
        if (s) abrirModalUsuario(s);
    }

    function datosModal() {
        var clean = function (id) { return $(id).value.trim().replace(/\s+/g, ' '); };
        return { no_empleado: clean('setp-usuario-no'), nombre: clean('setp-usuario-nombre'), cargo: clean('setp-usuario-cargo') || null };
    }

    async function crearUsuario() {
        if (!esSuperadmin()) return;
        var datos = datosModal();
        if (!datos.no_empleado || !datos.nombre) return modalStatus('Captura el No. de empleado y el nombre y apellido.');
        var existe = supervisor(datos.no_empleado);
        if (existe) return modalStatus('El No. de empleado <b>' + esc(datos.no_empleado) + '</b> ya está registrado (' + esc(existe.nombre) + ').');
        var btn = $('setp-usuario-save');
        btn.disabled = true;
        try {
            var sb = await getClient();
            var res = await sb.from(T_SUPERVISORES).insert([datos]).select('no_empleado, nombre, cargo').single();
            if (res.error) {
                if (res.error.code === '23505') throw new Error('ese No. de empleado ya está registrado.');
                if (res.error.code === '42501') throw new Error('falta aplicar db/setp_recorridos_captura.sql en Supabase.');
                throw res.error;
            }
            state.supervisores = ordenarSupervisores(state.supervisores.concat([res.data]));
            bootstrap.Modal.getOrCreateInstance($(MODAL_ID)).hide();
            // "Detalle de registros" (js/setp-reportes.js) se actualiza y lo muestra.
            document.dispatchEvent(new CustomEvent('setp:supervisor-creado', { detail: res.data }));
        } catch (error) {
            modalStatus('No se pudo crear el usuario: ' + errText(error));
        } finally {
            btn.disabled = false;
        }
    }

    // Editar y eliminar usan la misma tabla setp_supervisores; sólo necesitan
    // que Supabase tenga el permiso (db/setp_supervisores_permisos.sql).
    function sinPermiso(accion) {
        return 'la tabla setp_supervisores todavía no tiene permiso para ' + accion + ' en Supabase. '
            + 'No hace falta otra tabla: corre una sola vez db/setp_supervisores_permisos.sql en el SQL Editor de Supabase.';
    }

    // Sólo superadmin: corrige No. de empleado, nombre o cargo. Si cambia el
    // No. de empleado, Supabase actualiza sus recorridos (ON UPDATE CASCADE).
    async function editarUsuario() {
        var anterior = state.editando;
        var actual = supervisor(anterior);
        if (!esSuperadmin() || !actual) return;
        var datos = datosModal();
        if (!datos.no_empleado || !datos.nombre) return modalStatus('Captura el No. de empleado y el nombre y apellido.');
        if (datos.no_empleado === actual.no_empleado && datos.nombre === actual.nombre && (datos.cargo || null) === (actual.cargo || null)) {
            return modalStatus('No hay cambios que guardar.');
        }
        var otro = datos.no_empleado !== anterior ? supervisor(datos.no_empleado) : null;
        if (otro) return modalStatus('El No. de empleado <b>' + esc(datos.no_empleado) + '</b> ya está registrado (' + esc(otro.nombre) + ').');
        var btn = $('setp-usuario-save');
        btn.disabled = true;
        try {
            var sb = await getClient();
            var res = await sb.from(T_SUPERVISORES).update(datos).eq('no_empleado', anterior).select('no_empleado, nombre, cargo');
            if (res.error) {
                if (res.error.code === '23505') throw new Error('ese No. de empleado ya está registrado.');
                if (res.error.code === '42501') throw new Error(sinPermiso('editar'));
                throw res.error;
            }
            // Si los permisos de Supabase lo impiden, no hay error: sólo cero renglones.
            if (!res.data || !res.data.length) throw new Error(sinPermiso('editar'));
            var nuevo = res.data[0];
            state.supervisores = ordenarSupervisores(state.supervisores.map(function (s) { return s.no_empleado === anterior ? nuevo : s; }));
            state.recorridos.forEach(function (r) { if (r.no_empleado === anterior) r.no_empleado = nuevo.no_empleado; });
            state.resumen.forEach(function (r) { if (r.no_empleado === anterior) r.no_empleado = nuevo.no_empleado; });
            if (state.selected === anterior) state.selected = nuevo.no_empleado;
            state.editando = null;
            bootstrap.Modal.getOrCreateInstance($(MODAL_ID)).hide();
            document.dispatchEvent(new CustomEvent('setp:supervisor-editado', { detail: nuevo }));
            setStatus('Usuario actualizado: <b>' + esc(nuevo.nombre) + '</b>.', 'success');
        } catch (error) {
            modalStatus('No se pudo editar el usuario: ' + errText(error));
        } finally {
            btn.disabled = false;
        }
    }

    // Sólo superadmin. Si el supervisor tiene recorridos, Supabase no deja
    // borrarlo (ON DELETE RESTRICT): primero hay que borrar sus recorridos.
    async function eliminarUsuario(no) {
        var s = supervisor(no);
        if (!esSuperadmin() || !s || state.busy['usuario']) return;
        if (state.recorridos.some(function (r) { return r.no_empleado === no; })) {
            return setStatus('No se puede eliminar a <b>' + esc(s.nombre) + '</b> porque tiene recorridos registrados. Primero borra sus recorridos con <i class="fas fa-trash-alt"></i>.', 'warning');
        }
        if (!window.confirm('¿Eliminar este usuario?\n\nNo. de empleado: ' + s.no_empleado + '\nNombre: ' + s.nombre + (s.cargo ? '\nCargo: ' + s.cargo : '') + '\n\nNo se puede deshacer.')) return;
        state.busy['usuario'] = true;
        try {
            var sb = await getClient();
            var res = await sb.from(T_SUPERVISORES).delete().eq('no_empleado', no).select('no_empleado');
            if (res.error) {
                if (res.error.code === '23503') throw new Error('tiene recorridos registrados. Primero borra sus recorridos.');
                if (res.error.code === '42501') throw new Error(sinPermiso('eliminar'));
                throw res.error;
            }
            if (!res.data || !res.data.length) throw new Error(sinPermiso('eliminar'));
            state.supervisores = state.supervisores.filter(function (x) { return x.no_empleado !== no; });
            if (state.selected === no) state.selected = '';
            delete state.busy['usuario'];
            document.dispatchEvent(new CustomEvent('setp:supervisor-eliminado', { detail: { no_empleado: no } }));
            setStatus('Usuario eliminado: <b>' + esc(s.nombre) + '</b>.', 'success');
        } catch (error) {
            delete state.busy['usuario'];
            setStatus('No se pudo eliminar el usuario: ' + errText(error), 'danger');
        }
    }

    // ---------- Historial del supervisor (ventana nueva) ----------

    function normTexto(value) {
        return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function duracion(inicio, termino) {
        if (!inicio || !termino) return '';
        var min = function (t) { var p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1]); };
        var d = min(termino) - min(inicio);
        if (isNaN(d)) return '';
        if (d < 0) d += 24 * 60; // recorrido que cruza la medianoche
        return d < 60 ? d + ' min' : Math.floor(d / 60) + ' h ' + String(d % 60).padStart(2, '0') + ' min';
    }

    // Hallazgos de cada recorrido: el de su evidencia (principal) y los de sus
    // evidencias adicionales (+). id de recorrido -> { principal, extras }.
    async function hallazgosDe(sb, recs) {
        if (!recs.length) return {};
        var fechas = recs.map(function (r) { return fechaLocal(r.registrado_en); }).sort();
        var res = await sb.from('setp_hallazgos')
            .select('id, fecha_reporte, modulo, descripcion, estatus, evidencia_url, evidencia_path, evidencia_solucion_path, created_at')
            .gte('fecha_reporte', fechas[0]).lte('fecha_reporte', fechas[fechas.length - 1]);
        if (res.error) throw res.error;
        var lista = res.data || [];
        var map = {};
        var usados = {};
        var porFecha = function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); };
        var ruta = function (x) { return String(x.evidencia_path || ''); };
        // 1. La ruta de la foto del hallazgo lleva el id del recorrido ("-x" = adicional).
        recs.forEach(function (r) {
            var principal = lista.find(function (x) { return !usados[x.id] && ruta(x).indexOf('-rec-' + r.id + '.') >= 0; }) || null;
            if (principal) usados[principal.id] = true;
            var extras = lista.filter(function (x) { return !usados[x.id] && ruta(x).indexOf('-rec-' + r.id + '-x.') >= 0; }).sort(porFecha);
            extras.forEach(function (x) { usados[x.id] = true; });
            map[r.id] = { principal: principal, extras: extras };
        });
        // 2. Hallazgos guardados antes de esa liga: misma fecha y área, foto de
        //    recorrido (sin sufijo) y creados después de iniciar el recorrido.
        var legado = /^hallazgos\/\d{4}-\d{2}\/\d+-[a-z0-9]+\.jpg$/;
        recs.forEach(function (r) {
            if (map[r.id].principal || r.evidencia_tipo !== 'FOTO') return;
            var dia = fechaLocal(r.registrado_en);
            var desde = r.registrado_en ? new Date(r.registrado_en).getTime() : 0;
            var h = lista.filter(function (x) {
                return !usados[x.id] && legado.test(x.evidencia_path || '') && x.fecha_reporte === dia &&
                    normTexto(x.modulo) === normTexto(r.area_recorrido) && (!x.created_at || new Date(x.created_at).getTime() >= desde);
            }).sort(porFecha)[0];
            if (h) { map[r.id].principal = h; usados[h.id] = true; }
        });
        return map;
    }

    const ICONO_IMPRIMIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    const ICONO_BORRAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    const ICONO_REGRESAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>';
    const ICONO_INFORME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>';
    // Script de la ventana del historial:
    //  - "Ver informe" de cada registro abre una ventana nueva con el resumen de
    //    ese registro (el mismo que salía al imprimirlo), con su botón Imprimir.
    //  - "Regresar" cierra la ventana y vuelve a la pantalla de SETP.
    //  - El bote de basura (sólo superadmin) llama a borrarDesdeHistorial.
    const SCRIPT_HISTORIAL = [
        'function verInforme(tr){',
        ' var w=window.open("","_blank");',
        ' if(!w){alert("El navegador bloqueó la ventana del informe. Permite las ventanas emergentes de este sitio.");return;}',
        ' var n=tr.getAttribute("data-num");',
        ' var wrap=document.querySelector(".wrap").cloneNode(true);',
        ' wrap.querySelectorAll(".cards,#aviso").forEach(function(x){x.remove();});',
        ' wrap.querySelectorAll("tbody tr").forEach(function(x){if(x.getAttribute("data-num")!==n)x.remove();else{x.classList.add("imprimir");x.classList.remove("sel");x.removeAttribute("id");}});',
        ' wrap.querySelectorAll(".acc").forEach(function(x){x.remove();});',
        ' var lb=wrap.querySelector("#uno-label");if(lb)lb.textContent="Registro #"+n;',
        ' var b=wrap.querySelector("[data-regresar]");',
        ' if(b){b.removeAttribute("data-regresar");b.setAttribute("onclick","window.print()");b.innerHTML=' + JSON.stringify(ICONO_IMPRIMIR + 'Imprimir') + ';}',
        ' w.document.open();',
        ' w.document.write("<!DOCTYPE html><html lang=es><head>"+document.head.innerHTML+"<style>.uno-label{display:block;font-weight:800;margin:0 0 10px;}td img{width:160px;height:120px;}</style></head><body class=uno>"+wrap.outerHTML+"</body></html>");',
        ' w.document.close();',
        ' w.document.title="Informe · Registro #"+n+" · "+document.title.replace(/^Historial · /,"");',
        '}',
        'document.addEventListener("click",function(e){',
        ' var p=e.target.closest("[data-print]");',
        ' if(p){verInforme(p.closest("tr"));return;}',
        ' var b=e.target.closest("[data-borrar]");',
        ' if(b){if(window.__setpBorrar)window.__setpBorrar(b.getAttribute("data-borrar"));return;}',
        ' if(e.target.closest("[data-regresar]")){',
        '  try{if(window.opener&&!window.opener.closed)window.opener.focus();}catch(_){}',
        '  window.close();',
        '  setTimeout(function(){if(!window.closed&&history.length>1)history.back();},200);}',
        '});'
    ].join('');

    // marcado: id del recorrido desde cuyo "Ver historial" se abrió (se resalta).
    // aviso: { html, tipo } que se muestra arriba (p. ej. "Registro borrado").
    function historialDoc(s, recs, hallazgos, error, marcado, aviso) {
        var puedeBorrar = esSuperadmin();
        var ahora = new Date();
        var fechaHora = function (ts) {
            var d = ts ? new Date(ts) : null;
            return d && !isNaN(d) ? fecha(ts) + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
        };
        // Fecha del recorrido con su hora de inicio (la fija el servidor).
        var cuando = function (r) { return (fecha(r.registrado_en) || '—') + (r.hora_inicio ? ' ' + hhmm(r.hora_inicio) : ''); };
        var urlSegura = function (u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; };
        var cuerpo;
        if (error) {
            cuerpo = '<p class="msg msg-error">No se pudo cargar el historial: ' + error + '</p>';
        } else if (!recs) {
            cuerpo = '<p class="msg">Cargando historial…</p>';
        } else if (!recs.length) {
            cuerpo = '<p class="msg">Aún no hay reportes. Su primer punto de historial aparecerá al presionar <b>Iniciar recorrido</b>.</p>';
        } else {
            var delRecorrido = function (r) {
                var info = hallazgos[r.id] || { principal: null, extras: [] };
                return (info.principal ? [info.principal] : []).concat(info.extras);
            };
            var conHallazgo = recs.reduce(function (n, r) { return n + delRecorrido(r).length; }, 0);
            var tarjeta = function (label, value) { return '<div class="card"><div class="card-l">' + label + '</div><div class="card-v">' + value + '</div></div>'; };
            cuerpo = '<div class="cards">' +
                tarjeta('Reportes', recs.length) +
                tarjeta('Primer reporte', esc(cuando(recs[0]))) +
                tarjeta('Último reporte', esc(cuando(recs[recs.length - 1]))) +
                tarjeta('Hallazgos detectados', conHallazgo) +
                '</div><table><thead><tr><th>#</th><th>Fecha</th><th>Hora de inicio</th><th>Hora de término</th><th>Duración</th>' +
                '<th>Área de recorrido</th><th>Evidencia</th><th>Hallazgo detectado</th><th class="acc"><span class="sr">Imprimir</span></th></tr></thead><tbody>' +
                recs.map(function (r, i) {
                    var url = urlSegura(r.evidencia_url);
                    var evid = !url ? '—' : r.evidencia_tipo === 'FOTO'
                        ? '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="Evidencia del recorrido ' + (i + 1) + '"></a>'
                        : '<a href="' + esc(url) + '" target="_blank" rel="noopener">&#128206; ' + esc(r.evidencia_nombre || 'Archivo') + '</a>';
                    var info = hallazgos[r.id] || { extras: [] };
                    var extras = info.extras.map(function (h, j) {
                        var u = urlSegura(h.evidencia_url);
                        return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Evidencia adicional ' + (j + 1) + ' del recorrido ' + (i + 1) + '"></a>' : '';
                    }).join('');
                    if (extras) evid = '<div class="evs">' + (url ? evid : '') + extras + '</div>';
                    var hs = delRecorrido(r);
                    var hall = !hs.length ? '—' : hs.map(function (h) {
                        return '<div class="hl">' + esc(h.descripcion) + ' <span class="tag ' + (h.estatus === 'SOLUCIONADO' ? 'tag-ok' : 'tag-pend') + '">' +
                            (h.estatus === 'SOLUCIONADO' ? 'Solucionado' : 'Pendiente') + '</span></div>';
                    }).join('');
                    return '<tr data-num="' + (i + 1) + '"' + (r.id === marcado ? ' class="sel" id="registro-seleccionado"' : '') + '><td class="num">' + (i + 1) + '</td><td class="nw">' + esc(fecha(r.registrado_en) || '—') + '</td>' +
                        '<td class="nw">' + esc(hhmm(r.hora_inicio)) + ' hrs</td>' +
                        '<td class="nw">' + (r.hora_termino ? esc(hhmm(r.hora_termino)) + ' hrs' : '<span class="tag tag-curso">En curso</span>') + '</td>' +
                        '<td class="nw">' + esc(duracion(r.hora_inicio, r.hora_termino) || '—') + '</td>' +
                        '<td>' + esc(r.area_recorrido) + '</td><td>' + evid + '</td><td>' + hall + '</td>' +
                        '<td class="acc"><div class="acc-btns"><button type="button" class="btn-print" data-print aria-label="Ver informe del registro ' + (i + 1) + '">' + ICONO_INFORME + 'Ver informe</button>' +
                        (puedeBorrar ? '<button type="button" class="btn-del" data-borrar="' + esc(r.id) + '" title="Borrar registro" aria-label="Borrar el registro ' + (i + 1) + '">' + ICONO_BORRAR + '</button>' : '') +
                        '</div></td></tr>';
                }).reverse().join('') + '</tbody></table>';
        }
        return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>Historial · ' + esc(s.nombre) + '</title><style>' +
            'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f1f5f9;margin:0;padding:24px;}' +
            '.wrap{max-width:1200px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;}' +
            '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;border-bottom:2px solid #0f172a;padding-bottom:14px;margin-bottom:16px;}' +
            '.kicker{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b;}' +
            'h1{font-size:1.4rem;margin:4px 0 6px;}' +
            '.who{font-size:.9rem;color:#475569;}' +
            '.meta{font-size:.78rem;color:#64748b;text-align:right;}' +
            'button{font:inherit;font-size:.85rem;padding:7px 14px;border-radius:8px;border:1px solid #2a78d6;background:#2a78d6;color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}' +
            'button svg{width:16px;height:16px;flex:none;}' +
            '.btn-back{background:#fff;color:#2a78d6;margin-bottom:6px;}.btn-back:hover{background:#eff6ff;}' +
            '.btn-print{font-size:.78rem;padding:5px 10px;white-space:nowrap;}.btn-print:hover{background:#1d63b8;}' +
            'td.acc,th.acc{text-align:right;width:1%;}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);}' +
            '.uno-label{display:none;}' +
            '.acc-btns{display:flex;gap:6px;justify-content:flex-end;}' +
            '.btn-del{font-size:.78rem;padding:5px 8px;background:#fff;color:#dc2626;border-color:#dc2626;}.btn-del:hover{background:#fef2f2;}.btn-del:disabled{opacity:.6;cursor:wait;}' +
            '.aviso{padding:10px 12px;border-radius:10px;font-size:.85rem;margin-bottom:14px;}.aviso-ok{background:#ecfdf5;color:#047857;}.aviso-error{background:#fef2f2;color:#b91c1c;}.aviso-warn{background:#fffbeb;color:#b45309;}' +
            '.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px;}' +
            '.card{border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;}' +
            '.card-l{font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;}' +
            '.card-v{font-size:1.05rem;font-weight:800;margin-top:4px;}' +
            'table{width:100%;border-collapse:collapse;font-size:.84rem;}' +
            'th{text-align:left;font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;color:#475569;border-bottom:1px solid #cbd5e1;padding:8px;white-space:nowrap;}' +
            'td{border-bottom:1px solid #e2e8f0;padding:8px;vertical-align:middle;}' +
            'td.num{font-weight:800;color:#475569;}td.nw{white-space:nowrap;}' +
            'tr.sel td{background:#eff6ff;}tr.sel td.num{color:#1d4ed8;box-shadow:inset 3px 0 0 #2563eb;}' +
            'td img{width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;display:block;}' +
            'a{color:#1d4ed8;}.evs{display:flex;flex-wrap:wrap;gap:4px;}.hl+.hl{margin-top:6px;}' +
            '.tag{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;}' +
            '.tag-pend{background:#fef2f2;color:#b91c1c;}.tag-ok{background:#ecfdf5;color:#047857;}.tag-curso{background:#fffbeb;color:#b45309;}' +
            '.msg{padding:28px 8px;text-align:center;color:#64748b;}.msg-error{color:#b91c1c;}' +
            '@media (max-width:760px){.cards{grid-template-columns:repeat(2,minmax(0,1fr));}.meta{text-align:left;}}' +
            '@media print{body{background:#fff;padding:0;}.wrap{border:0;padding:0;}button,.acc{display:none !important;}tr{break-inside:avoid;}tr.sel td{background:none;box-shadow:none;}' +
            // Imprimir un solo registro: se ocultan los demás y los totales.
            'body.uno tbody tr:not(.imprimir),body.uno .cards{display:none;}body.uno .uno-label{display:block;font-weight:800;margin:0 0 10px;}' +
            'body.uno td img{width:160px;height:120px;}}' +
            '</style></head><body><div class="wrap"><div class="top"><div>' +
            '<div class="kicker">Supervisores de Edificio Terminal (SETP) · Historial de reportes</div>' +
            '<h1>' + esc(s.nombre) + '</h1>' +
            '<div class="who">No. de empleado: <b>' + esc(s.no_empleado) + '</b>' + (s.cargo ? ' · ' + esc(s.cargo) : '') + '</div></div>' +
            '<div class="meta"><button type="button" class="btn-back" data-regresar>' + ICONO_REGRESAR + 'Regresar</button><br>' +
            'Generado el ' + esc(fechaHora(ahora.toISOString())) + '</div></div><div id="aviso">' + (aviso ? '<div class="aviso aviso-' + aviso.tipo + '">' + aviso.html + '</div>' : '') + '</div>' +
            '<div class="uno-label" id="uno-label"></div>' + cuerpo + '</div>' +
            '<script>' + SCRIPT_HISTORIAL + (marcado ? 'var t=document.getElementById("registro-seleccionado");if(t)t.scrollIntoView({block:"center"});' : '') + '</script>' +
            '</body></html>';
    }

    function escribirVentana(w, html) {
        if (!w || w.closed) return;
        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    // Historial completo de un supervisor: cada recorrido es un punto,
    // numerado desde el primero (#1).
    async function abrirHistorial(no, recId) {
        var s = supervisor(no);
        if (!s) return;
        // La ventana se abre en el mismo clic para que el navegador no la bloquee.
        var w = window.open('', '_blank');
        if (!w) return setStatus('El navegador bloqueó la ventana del historial. Permite las ventanas emergentes de este sitio e inténtalo de nuevo.', 'warning');
        escribirVentana(w, historialDoc(s, null, null, ''));
        await cargarHistorial(w, s, recId);
    }

    async function cargarHistorial(w, s, recId, aviso) {
        try {
            var sb = await getClient();
            var recs = [];
            for (var from = 0; ; from += 1000) {
                var res = await sb.from(T_RECORRIDOS).select('*').eq('no_empleado', s.no_empleado)
                    .order('registrado_en', { ascending: true }).range(from, from + 999);
                if (res.error) throw res.error;
                recs = recs.concat(res.data || []);
                if (!res.data || res.data.length < 1000) break;
            }
            recs.sort(function (a, b) { return String(a.registrado_en).localeCompare(String(b.registrado_en)); });
            var hallazgos = {};
            try { hallazgos = await hallazgosDe(sb, recs); } catch (_) { /* el historial se muestra aunque falle la liga con hallazgos */ }
            escribirVentana(w, historialDoc(s, recs, hallazgos, '', recId, aviso));
            // El bote de basura de la ventana llama a esta función (sólo superadmin).
            if (w && !w.closed) {
                w.__setpBorrar = function (id) {
                    var r = recs.find(function (x) { return x.id === id; });
                    if (r) borrarDesdeHistorial(w, s, r, hallazgos[id]);
                };
            }
        } catch (error) {
            escribirVentana(w, historialDoc(s, null, null, errText(error)));
        }
    }

    // Sólo superadmin: borra un registro de prueba desde el historial: el
    // recorrido, su evidencia y los hallazgos que generó (con sus fotos).
    // Los hallazgos ligados sólo por fecha y área (anteriores a la liga) no se borran.
    async function borrarDesdeHistorial(w, s, r, info) {
        if (!esSuperadmin() || !w || w.closed) return;
        var ligado = function (h) { return String(h.evidencia_path || '').indexOf('-rec-' + r.id) >= 0; };
        var hs = info ? (info.principal ? [info.principal] : []).concat(info.extras).filter(ligado) : [];
        var detalle = (fecha(r.registrado_en) || '—') + ' · ' + hhmm(r.hora_inicio) + ' hrs · ' + r.area_recorrido;
        var tambien = 'su evidencia' + (hs.length ? ' y ' + (hs.length === 1 ? 'su hallazgo' : 'sus ' + hs.length + ' hallazgos') + ' de "Hallazgos detectados"' : '');
        var ok = await confirmarBorrado(w.document, {
            kicker: 'Historial · ' + s.nombre,
            titulo: '¿Borrar este registro?',
            filas: [
                ['Área de recorrido', r.area_recorrido],
                ['Fecha y hora', (fecha(r.registrado_en) || '—') + ' · ' + hhmm(r.hora_inicio) + ' hrs']
            ],
            aviso: 'También se borra ' + tambien + '.' + avisoFormato(r) + ' No se puede deshacer.'
        });
        if (!ok || w.closed) return;
        var btn = w.document.querySelector('[data-borrar="' + r.id + '"]');
        if (btn) btn.disabled = true;
        try {
            var sb = await getClient();
            await eliminarRecorridoBD(sb, r);
        } catch (error) {
            if (btn) btn.disabled = false;
            var box = w.document.getElementById('aviso');
            if (box) box.innerHTML = '<div class="aviso aviso-error">No se pudo borrar el registro: ' + errText(error) + '</div>';
            return;
        }
        var fallidos = 0;
        for (var i = 0; i < hs.length; i++) {
            try {
                var res = await sb.from('setp_hallazgos').delete().eq('id', hs[i].id).select('id');
                if (res.error || !res.data || !res.data.length) { fallidos++; continue; }
                var paths = [hs[i].evidencia_path, hs[i].evidencia_solucion_path].filter(Boolean);
                if (paths.length) { try { await sb.storage.from(BUCKET).remove(paths); } catch (_) { /* sin efecto */ } }
            } catch (_) { fallidos++; }
        }
        // Pantalla principal: tabla de recorridos, Detalle de registros y Reporte de hallazgos.
        quitarDelEstado(r.id);
        setStatus('');
        render();
        if (hs.length) mostrarEnReporte();
        await cargarHistorial(w, s, null, fallidos
            ? { tipo: 'warn', html: 'Se borró el registro, pero ' + fallidos + (fallidos === 1 ? ' hallazgo no se pudo borrar' : ' hallazgos no se pudieron borrar') + '. Bórralos desde el Reporte de hallazgos.' }
            : { tipo: 'ok', html: 'Registro borrado: ' + esc(detalle) + '.' });
    }

    // ---------- API pública ----------

    async function mount(container) {
        if (!container) return;
        if (state.el !== container) {
            ensureStyles();
            state.el = container;
            bind(container);
        }
        if (Object.keys(state.busy).length) return;
        render();
        await load();
        render();
    }

    window.setpRecorridos = {
        mount: mount,
        supervisores: function () { return state.supervisores.slice(); },
        // Supervisor del usuario que inició sesión ('' = todos).
        select: function (no) {
            var cambio = state.selected !== (no || '');
            state.selected = no || '';
            setStatus('');
            render();
            // El "Reporte de hallazgos" (js/setp-formato.js) muestra los del supervisor elegido.
            if (cambio) document.dispatchEvent(new CustomEvent('setp:supervisor-elegido', { detail: { no_empleado: state.selected } }));
        },
        seleccionado: function () { return state.selected; },
        // Ventana de confirmación con desenfoque (Promise<boolean>), la misma del borrado.
        confirmar: function (o) { return confirmarBorrado(document, o); },
        // Recorridos terminados del supervisor que aún no salen en un formato guardado.
        recorridosParaFormato: function (no) {
            return state.recorridos.filter(function (r) { return r.no_empleado === no && r.hora_termino && !state.enFormato[r.id]; });
        },
        // Tras guardar un formato: sus recorridos dejan de mostrarse en la tabla.
        marcarEnFormato: function (ids) {
            (ids || []).forEach(function (id) { state.enFormato[id] = true; });
            render();
        },
        // Recorridos cargados, más recientes primero (null mientras cargan).
        recorridos: function () { return state.loaded ? state.recorridos.slice() : null; },
        recorridosCompletos: function () { return true; }, // load() trae todos los recorridos
        enFormato: function (id) { return !!state.enFormato[id]; },
        // Todos los recorridos con su turno (null mientras cargan) y si ya existe la columna turno.
        resumen: function () { return state.loaded ? state.resumen.slice() : null; },
        turnoDisponible: function () { return state.turnoOk; },
        abrirHistorial: abrirHistorial,
        crearUsuario: abrirCrearUsuario,
        editarUsuario: abrirEditarUsuario,
        eliminarUsuario: eliminarUsuario,
        puedeCrearUsuario: esSuperadmin,
        canEdit: canEdit
    };
})();
