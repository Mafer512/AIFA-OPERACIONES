(function () {
    'use strict';

    // ============================================================
    // SETP · Crear formato (oficio de hallazgos del Edificio Terminal)
    // Captura de hallazgos con evidencia fotográfica, datos del oficio,
    // vista previa e impresión con el formato oficial, y formatos guardados.
    // Tablas: setp_hallazgos, setp_oficios · Bucket: setp-evidencias
    // (ver db/create_setp_formatos.sql).
    // ============================================================

    const T_HALLAZGOS = 'setp_hallazgos';
    const T_OFICIOS = 'setp_oficios';
    const BUCKET = 'setp-evidencias';
    const MODAL_ID = 'setp-formato-modal';
    const MONTH_ABBR = ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.', 'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.'];
    const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const NIVELES = ['00', '5.25', '10.50'];

    const DEFAULT_DATOS = {
        numero: 'SSO/GOET/',
        lugar: 'Zumpango Edo. Mex.',
        leyenda: '2026, Año de Margarita Maza Parada',
        area1: 'Dirección de Operación.',
        area2: 'Subdirección de Seguridad Operacional.',
        destinatario: 'Para atención del C. Director de Operación del AIFA, S.A. de C.V.',
        antecedente: 'En relación con el Memorándum No. AIFA/SCSA/GC/109/2024 de 30 Ene. 2025, girado por la Subdirección de Coord. y Seguimiento de Acuerdos de este Aeropuerto',
        cierre: 'Lo anterior, a fin de que sea considerado en los trabajos de mantenimiento correspondientes.',
        despedida: 'Respetuosamente.',
        firmante_cargo: 'El Subdirector de Seguridad Operacional.',
        firmante_nombre: 'C. José Luis García Mateos.',
        ccp: [
            'el C. Encgdo. de Subdir. de Ingeniería, para su superior conocimiento. - Presente.',
            'el C. Encgdo. de Subdir. de Gestión Energética, mismo fin. - Presente.',
            'el C. Subdir. de Servicios Comerciales, igual fin. - Presente.',
            'el C. Subdir. de Tecnologías de la Información y Comunicación, para su conocimiento. - Presente.',
            'el C. Subdir. de Recursos Materiales, mismo fin. - Presente.',
            'el C. Encgdo. de Gcia. Ops. Edif. Term., para su conocimiento y seguimiento. - Presente.'
        ].join('\n'),
        iniciales: ''
    };

    const DATOS_FIELDS = [
        { key: 'numero', label: 'No. de oficio', col: 4 },
        { key: 'fecha_oficio', label: 'Fecha del oficio', col: 4, type: 'date' },
        { key: 'lugar', label: 'Lugar', col: 4 },
        { key: 'leyenda', label: 'Leyenda del año (sin comillas)', col: 12 },
        { key: 'area1', label: 'Área remitente (renglón 1)', col: 6 },
        { key: 'area2', label: 'Área remitente (renglón 2)', col: 6 },
        { key: 'destinatario', label: 'Destinatario', col: 12 },
        { key: 'antecedente', label: 'Antecedente (inicio del primer párrafo)', col: 12, rows: 2 },
        { key: 'cierre', label: 'Texto después de la primera tabla', col: 12 },
        { key: 'despedida', label: 'Despedida', col: 4 },
        { key: 'firmante_cargo', label: 'Cargo del firmante', col: 4 },
        { key: 'firmante_nombre', label: 'Nombre del firmante', col: 4 },
        { key: 'ccp', label: 'Con copia para (c.c.p.) — uno por renglón', col: 9, rows: 6 },
        { key: 'iniciales', label: 'Iniciales / rúbrica', col: 3 }
    ];

    const state = {
        hallazgos: [],
        lastOficio: null,
        periodo: '',
        editingId: null,
        files: { evidencia: null, solucion: null },
        dbReady: false,
        // 'db' (Supabase) o 'local' (este navegador, mientras no existan las tablas).
        store: null,
        // true con db/setp_hallazgos_por_supervisor.sql: cada supervisor ve
        // sólo sus hallazgos que aún no salen en un formato guardado.
        porSupervisor: false,
        // Formato guardado al finalizar el recorrido que se está generando
        // desde "Formatos guardados" (null = Generar formato normal).
        borrador: null,
        // id de hallazgo -> true si ya se guardó en un reporte ("Guardar reporte"):
        // sale de "Hallazgos detectados" (sigue en pendientes hasta su seguimiento).
        archivados: {},
        modal: null
    };

    // ---------- utilidades ----------

    function $(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function todayIso() {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function fmtDate(iso) {
        if (!iso) return '';
        var p = String(iso).slice(0, 10).split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    // 2026-11-02 -> "02 Nov. 2026."
    function fmtOficioDate(iso) {
        if (!iso) return '';
        var p = String(iso).slice(0, 10).split('-');
        return p[2] + ' ' + MONTH_ABBR[Number(p[1]) - 1] + ' ' + p[0] + '.';
    }

    function monthRange(ym) {
        var y = Number(ym.slice(0, 4));
        var m = Number(ym.slice(5, 7));
        var last = new Date(y, m, 0).getDate();
        return { y: y, m: m, last: last, start: ym + '-01', end: ym + '-' + pad(last) };
    }

    function prevMonth(ym) {
        var y = Number(ym.slice(0, 4));
        var m = Number(ym.slice(5, 7)) - 1;
        if (m === 0) { m = 12; y--; }
        return y + '-' + pad(m);
    }

    // "del 01 al 31 Oct. 2026"
    function periodText(ym) {
        var r = monthRange(ym);
        return 'del 01 al ' + r.last + ' ' + MONTH_ABBR[r.m - 1] + ' ' + r.y;
    }

    // Periodo con día ({ start, end } en 'YYYY-MM-DD'): "del 01 al 10 Nov. 2026",
    // "del 25 Oct. al 10 Nov. 2026" o "del 25 Dic. 2025 al 10 Ene. 2026".
    function rangoText(r) {
        var a = r.start.split('-'), b = r.end.split('-');
        var mes = function (p) { return MONTH_ABBR[Number(p[1]) - 1]; };
        if (a[0] === b[0] && a[1] === b[1]) return 'del ' + a[2] + ' al ' + b[2] + ' ' + mes(b) + ' ' + b[0];
        if (a[0] === b[0]) return 'del ' + a[2] + ' ' + mes(a) + ' al ' + b[2] + ' ' + mes(b) + ' ' + b[0];
        return 'del ' + a[2] + ' ' + mes(a) + ' ' + a[0] + ' al ' + b[2] + ' ' + mes(b) + ' ' + b[0];
    }

    function setStatus(message, type) {
        var box = $('setp-fmt-status');
        if (!box) return;
        box.className = message ? 'alert alert-' + (type || 'info') + ' py-2 small mb-3' : 'd-none';
        box.innerHTML = message || '';
    }

    async function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (typeof window.ensureSupabaseClient === 'function') return window.ensureSupabaseClient();
        throw new Error('Cliente Supabase no disponible');
    }

    function canEdit() {
        var level = typeof window.setpAccessLevel === 'function' ? window.setpAccessLevel() : 'read';
        return !!state.store && ['admin', 'edit', 'capture'].indexOf(level) >= 0;
    }

    function actor() {
        return sessionStorage.getItem('user_role') || 'authenticated';
    }

    // Supervisor elegido en el filtro (js/setp-recorridos.js) · '' = ninguno.
    function supervisorActual() {
        var rec = window.setpRecorridos;
        return rec && rec.seleccionado ? rec.seleccionado() : '';
    }

    function nombreSupervisor(no) {
        var rec = window.setpRecorridos;
        var s = rec ? rec.supervisores().find(function (x) { return x.no_empleado === no; }) : null;
        return s ? s.nombre : no;
    }

    // Hallazgos detectados del supervisor elegido que aún no salen en un
    // formato guardado (sin supervisor elegido, los de todos que aún no salen
    // en un formato; sin la columna, todos).
    function hallazgosVisibles() {
        var no = supervisorActual();
        if (!state.porSupervisor) return state.hallazgos;
        return state.hallazgos.filter(function (h) { return !h.oficio_id && (!no || h.no_empleado === no); });
    }

    // Secciones del reporte y del formato. Solucionados y pendientes (seguimiento
    // del mes anterior) salen de todos los hallazgos, como siempre; detectados,
    // sólo de los del supervisor elegido. oficioId: al reemplazar un formato
    // guardado, conserva los detectados que ya salieron en él.
    function seccionesDe(ym, oficioId) {
        var s = computeSections(ym, state.hallazgos);
        // Formato guardado al finalizar el recorrido: detectados, sólo los de
        // ese usuario (los de sus recorridos del día).
        if (state.borrador) {
            s.detectados = computeSections(ym, hallazgosDeBorrador(state.borrador)).detectados;
            return s;
        }
        if (state.porSupervisor) {
            var lista = hallazgosVisibles();
            if (oficioId) lista = lista.concat(state.hallazgos.filter(function (h) { return h.oficio_id === oficioId; }));
            s.detectados = computeSections(ym, lista).detectados;
        }
        // Los ya guardados con "Guardar reporte" no vuelven a salir en detectados.
        s.detectados = s.detectados.filter(function (h) { return !state.archivados[h.id]; });
        return s;
    }

    // ---------- formatos guardados al finalizar el recorrido (borradores) ----------
    // Al presionar "Finalizar recorrido" se guarda, por usuario y por día, un
    // borrador en setp_oficios con los recorridos de ese día. El No. de oficio
    // se captura a mano al generarlo (en "Formatos guardados"); mientras tanto
    // lleva una clave interna BORRADOR-<No. empleado>-<fecha> que no sale en
    // el documento. Al generarlo se imprime con el estatus actual de cada hallazgo.
    const BORRADOR = 'BORRADOR-';
    // Reportes de hallazgos guardados con "Guardar reporte" (por usuario y turno).
    const REPORTE = 'REPORTE-';

    // Registros internos de setp_oficios que no son oficios con número.
    function esBorrador(o) {
        var n = String(o && o.numero || '');
        return n.indexOf(BORRADOR) === 0 || n.indexOf(REPORTE) === 0;
    }

    function esReporte(o) {
        return String(o && o.numero || '').indexOf(REPORTE) === 0;
    }

    // Hallazgos de los recorridos del borrador (la foto lleva "-rec-<id>")
    // y, con db/setp_hallazgos_por_supervisor.sql, los capturados a su nombre.
    function hallazgosDeBorrador(b) {
        var ids = b.recorridos || [];
        return state.hallazgos.filter(function (h) {
            if (h.oficio_id && h.oficio_id !== b.convertido) return false;
            var ruta = String(h.evidencia_path || '');
            var deRecorrido = ids.some(function (id) {
                return ruta.indexOf('-rec-' + id + '.') >= 0 || ruta.indexOf('-rec-' + id + '-x.') >= 0;
            });
            return deRecorrido || (state.porSupervisor && h.no_empleado === b.no_empleado && h.fecha_reporte === b.fecha);
        });
    }

    function fechaLocalDe(ts) {
        var d = ts ? new Date(ts) : new Date();
        if (isNaN(d)) d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    // Lo llama js/setp-recorridos.js al finalizar un recorrido (r = recorrido guardado).
    async function guardarBorrador(r) {
        if (!r || !r.hora_termino || !r.no_empleado) return null;
        var sb = await getClient();
        var fecha = fechaLocalDe(r.registrado_en);
        var numero = BORRADOR + r.no_empleado + '-' + fecha;
        var prev = await sb.from(T_OFICIOS).select('id, secciones').eq('numero', numero).maybeSingle();
        if (prev.error) throw prev.error;
        var recorridos = ((prev.data && prev.data.secciones && prev.data.secciones.recorridos) || []).slice();
        if (recorridos.indexOf(r.id) < 0) recorridos.push(r.id);
        var payload = {
            numero: numero,
            fecha_oficio: fecha,
            periodo: fecha.slice(0, 7) + '-01',
            datos: {},
            secciones: { borrador: true, no_empleado: r.no_empleado, fecha: fecha, periodo: fecha.slice(0, 7), recorridos: recorridos },
            updated_by: actor(),
            updated_at: new Date().toISOString()
        };
        var res;
        if (prev.data) {
            res = await sb.from(T_OFICIOS).update(payload).eq('id', prev.data.id).select('id').single();
        } else {
            payload.created_by = actor();
            res = await sb.from(T_OFICIOS).insert([payload]).select('id').single();
        }
        if (res.error) throw res.error;
        return res.data;
    }

    function borradorDe(o) {
        var s = o.secciones || {};
        return {
            id: o.id, numero: o.numero, no_empleado: s.no_empleado || '', fecha: s.fecha || String(o.fecha_oficio || '').slice(0, 10),
            periodo: s.periodo || String(o.periodo || '').slice(0, 7), recorridos: s.recorridos || []
        };
    }

    // Borradores (todos) y formatos ya generados (los más recientes).
    async function listGuardados() {
        var sb = await getClient();
        var b = await sb.from(T_OFICIOS).select('id, numero, fecha_oficio, periodo, secciones').like('numero', BORRADOR + '%').order('fecha_oficio', { ascending: false });
        if (b.error) throw b.error;
        var f = await sb.from(T_OFICIOS).select('id, numero, fecha_oficio, periodo, created_at').order('created_at', { ascending: false }).limit(150);
        if (f.error) throw f.error;
        var r = await sb.from(T_OFICIOS).select('id, numero, fecha_oficio, periodo, secciones, created_at').like('numero', REPORTE + '%').order('created_at', { ascending: false });
        if (r.error) throw r.error;
        return {
            borradores: (b.data || []).filter(function (o) { return String(o.numero).indexOf(BORRADOR) === 0; }).map(borradorDe),
            formatos: (f.data || []).filter(function (o) { return !esBorrador(o); }).slice(0, 100),
            reportes: (r.data || []).filter(esReporte)
        };
    }

    // Tras guardar un formato con los recorridos del usuario, sus borradores
    // cuyos recorridos ya salieron en un formato se borran.
    async function limpiarBorradores(sb, no) {
        var rec = window.setpRecorridos;
        if (!no || !rec || !rec.enFormato) return;
        var res = await sb.from(T_OFICIOS).select('id, numero, secciones').like('numero', BORRADOR + no + '-%');
        if (res.error) return;
        var ids = (res.data || []).filter(function (o) {
            return String(o.numero).indexOf(BORRADOR + no + '-') === 0 &&
                ((o.secciones && o.secciones.recorridos) || []).every(function (id) { return rec.enFormato(id); });
        }).map(function (o) { return o.id; });
        if (ids.length) await sb.from(T_OFICIOS).delete().in('id', ids);
    }

    // Solucionado con seguimiento (igual que en computeSections).
    function estaResuelto(h) {
        return h.estatus === 'SOLUCIONADO' && !!h.evidencia_solucion_url && !!h.confirmado_en;
    }

    function ubicacionLines(h) {
        var lines = [esc(h.modulo) + (h.nivel ? ',' : '.')];
        if (h.nivel) lines.push('Nivel ' + esc(h.nivel) + '.');
        return lines.join('<br>');
    }

    // ---------- secciones del oficio ----------

    // Secciones del oficio:
    //   Detectados:   capturados como detectados y reportados en el mes del oficio.
    //   Pendientes:   todos los hallazgos (de cualquier supervisor y mes) que aún
    //                 no tienen seguimiento completo.
    //   Solucionados: con estatus Solucionado, evidencia de la solución y ✓,
    //                 solucionados dentro del mes del oficio.
    const SECCIONES = { detectados: 'DETECTADOS', solucionados: 'SOLUCIONADOS', pendientes: 'PENDIENTES' };

    // Datos del hallazgo que se guardan en el formato.
    function pickHallazgo(h) {
        return {
            id: h.id, seccion: h.seccion, estatus: h.estatus, fecha_reporte: h.fecha_reporte, modulo: h.modulo, nivel: h.nivel,
            descripcion: h.descripcion, evidencia_url: h.evidencia_url, fecha_solucion: h.fecha_solucion,
            evidencia_solucion_url: h.evidencia_solucion_url
        };
    }

    // Formato guardado con el estatus actual: sus detectados con los datos de
    // hoy; solucionados y pendientes recalculados, y los que estaban
    // pendientes en el formato y ya tienen seguimiento pasan a solucionados.
    function seccionesActuales(snap, ym) {
        var byId = {};
        state.hallazgos.forEach(function (h) { byId[h.id] = h; });
        var cur = computeSections(ym, state.hallazgos);
        var detectados = (snap.detectados || []).map(function (x) { return byId[x.id] ? pickHallazgo(byId[x.id]) : x; });
        var ya = {};
        var solucionados = cur.solucionados.slice();
        solucionados.forEach(function (h) { ya[h.id] = true; });
        (snap.pendientes || []).concat(snap.solucionados || []).forEach(function (x) {
            var h = byId[x.id];
            if (h && estaResuelto(h) && !ya[h.id]) { ya[h.id] = true; solucionados.push(pickHallazgo(h)); }
        });
        solucionados.sort(function (a, b) {
            var x = a.fecha_solucion || a.fecha_reporte, y = b.fecha_solucion || b.fecha_reporte;
            return x < y ? -1 : x > y ? 1 : 0;
        });
        return { periodo: ym, detectados: detectados, solucionados: solucionados, pendientes: cur.pendientes };
    }

    // ym: mes 'YYYY-MM' o, desde el Reporte de hallazgos, un rango { start, end } con día.
    function computeSections(ym, hallazgos) {
        var cur = typeof ym === 'string' ? monthRange(ym) : ym;
        if (typeof ym !== 'string') ym = ym.start.slice(0, 7);
        var inRange = function (d, r) { return d >= r.start && d <= r.end; };
        var byReporte = function (a, b) { return a.fecha_reporte < b.fecha_reporte ? -1 : a.fecha_reporte > b.fecha_reporte ? 1 : 0; };
        var bySolucion = function (a, b) {
            var x = a.fecha_solucion || a.fecha_reporte, y = b.fecha_solucion || b.fecha_reporte;
            return x < y ? -1 : x > y ? 1 : 0;
        };
        var pick = pickHallazgo;
        // Detectados: los capturados como detectados (o sin sección) reportados en el mes.
        var esDetectado = function (h) {
            return (h.seccion === SECCIONES.detectados || !h.seccion) && inRange(h.fecha_reporte, cur);
        };
        // Solucionado ya con seguimiento: estatus Solucionado, evidencia de la
        // solución y estatus confirmado con ✓.
        var resuelto = function (h) {
            return h.estatus === 'SOLUCIONADO' && !!h.evidencia_solucion_url && !!h.confirmado_en;
        };
        var out = { periodo: ym, detectados: [], solucionados: [], pendientes: [] };
        hallazgos.forEach(function (h) {
            if (esDetectado(h)) out.detectados.push(h);
            // Pendientes: los de todos los supervisores, de cualquier mes hasta el
            // del oficio, mientras no se les dé seguimiento. Solucionados: los que
            // ya lo tienen y se solucionaron dentro del mes.
            if (!resuelto(h)) { if (h.fecha_reporte <= cur.end) out.pendientes.push(h); }
            else if (h.fecha_solucion && inRange(h.fecha_solucion, cur)) out.solucionados.push(h);
        });
        out.detectados = out.detectados.sort(byReporte).map(pick);
        out.solucionados = out.solucionados.sort(bySolucion).map(pick);
        out.pendientes = out.pendientes.sort(byReporte).map(pick);
        return out;
    }

    // ---------- documento ----------

    function photoCell(url) {
        return url ? '<img src="' + esc(url) + '" alt="Evidencia fotográfica">' : '<span class="sin-foto">Sin evidencia</span>';
    }

    function tableHtml(rows, opts) {
        var head = (opts.title ? '<tr><th colspan="5" class="titulo">' + opts.title + '</th></tr>' : '') +
            '<tr><th class="c-no">No.</th><th class="c-fecha">' + opts.fechaLabel + '</th><th class="c-ubic">UBICACIÓN DE INCIDENCIA</th>' +
            '<th class="c-desc">DESCRIPCIÓN DE INCIDENCIA</th><th class="c-foto">' + opts.fotoLabel + '</th></tr>';
        var body = rows.length ? rows.map(function (h, i) {
            return '<tr><td class="c-no">' + (i + 1) + '</td><td class="c-fecha">' + fmtDate(h[opts.fechaKey]) + '</td>' +
                '<td class="c-ubic">' + ubicacionLines(h) + '</td><td class="c-desc">' + esc(h.descripcion) + '</td>' +
                '<td class="c-foto">' + photoCell(h[opts.fotoKey] || (opts.fotoAlt ? h[opts.fotoAlt] : null)) + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="vacio">Sin hallazgos en este periodo.</td></tr>';
        return '<table class="hallazgos"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    }

    function buildDocument(datos, secciones, mode) {
        var ym = secciones.periodo;
        var prevYm = prevMonth(ym);
        var logo = new URL('images/aifa-logo.png', document.baseURI).href;
        var ccp = String(datos.ccp || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        var css = [
            '@page{size:letter;margin:1.6cm 1.9cm 1.8cm 2.2cm;}',
            '@page{@top-center{content:"-" counter(page) "-";font:10pt Calibri,Arial,sans-serif;}}',
            '@page:first{@top-center{content:none;}}',
            'body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;color:#111;margin:0;}',
            '.membrete{display:flex;align-items:center;gap:18px;margin-bottom:14px;}',
            '.membrete img{width:4.4cm;height:auto;}',
            '.leyenda{flex:1;text-align:center;font-weight:700;font-size:11pt;}',
            '.encabezado{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;}',
            '.encabezado .der{text-align:right;}',
            '.destinatario{text-align:center;font-weight:700;text-decoration:underline;margin:10px 0 12px;}',
            'p{text-align:justify;line-height:1.35;margin:0 0 12px;}',
            'p.sangria{text-indent:1.2cm;}',
            'table.hallazgos{width:100%;border-collapse:collapse;margin:0 0 14px;font-size:10.5pt;}',
            'table.hallazgos th,table.hallazgos td{border:1px solid #222;padding:4px 6px;vertical-align:middle;}',
            'table.hallazgos th{font-weight:700;font-size:9.5pt;text-align:center;text-transform:uppercase;}',
            'table.hallazgos th.titulo{font-size:10pt;padding:6px;}',
            'table.hallazgos tr{page-break-inside:avoid;break-inside:avoid;}',
            'table.hallazgos thead{display:table-header-group;}',
            '.c-no{width:5%;text-align:center;}',
            '.c-fecha{width:12%;text-align:center;}',
            '.c-ubic{width:14%;text-align:center;}',
            '.c-desc{text-align:left;}',
            '.c-foto{width:4.6cm;text-align:center;padding:2px !important;}',
            'td.c-foto img{width:4.2cm;height:2.5cm;object-fit:cover;display:block;margin:auto;}',
            '.sin-foto{font-size:9pt;color:#666;}',
            'td.vacio{text-align:center;color:#555;padding:10px;}',
            '.firma{text-align:center;margin:56px 0 70px;line-height:1.5;page-break-inside:avoid;}',
            '.firma .nombre{margin-top:46px;}',
            '.ccp{font-size:9.5pt;line-height:1.45;}',
            '.ccp div{display:flex;gap:10px;}',
            '.iniciales{margin-top:28px;font-size:9pt;}'
        ].join('');
        // En pantalla (vista previa) el cuerpo se dibuja como una hoja carta.
        var screenCss = '@media screen{html{background:#e5e7eb;}body{width:21.59cm;min-height:27.94cm;margin:16px auto;padding:1.6cm 1.9cm 1.8cm 2.2cm;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.18);box-sizing:border-box;}}';
        var body = [
            '<div class="membrete"><img src="' + esc(logo) + '" alt="AIFA"><div class="leyenda">“' + esc(datos.leyenda) + '”.</div></div>',
            '<div class="encabezado"><div>' + esc(datos.area1) + '<br>' + esc(datos.area2) + '</div>',
            '<div class="der">' + esc(datos.lugar) + '<br>' + fmtOficioDate(datos.fecha_oficio) + '<br>No.: ' + esc(datos.numero) + '.</div></div>',
            '<div class="destinatario">' + esc(datos.destinatario) + '</div>',
            '<p class="sangria">' + esc(datos.antecedente) + ', me permito informar a esa Superioridad, los hallazgos detectados en el Edificio Terminal de Pasajeros durante el periodo comprendido ' + periodText(ym) + ', como a continuación se indica:</p>',
            tableHtml(secciones.detectados, { fechaLabel: 'FECHA DE REPORTE', fechaKey: 'fecha_reporte', fotoLabel: 'EVIDENCIA FOTOGRÁFICA', fotoKey: 'evidencia_url' }),
            '<p class="sangria">' + esc(datos.cierre) + '</p>',
            '<p>Asimismo, me permito informar a esa Superioridad, los hallazgos del periodo comprendido ' + periodText(prevYm) + '; solucionados en el mes de ' + MONTH_NAMES[Number(ym.slice(5, 7)) - 1] + ', así como, los pendientes por solventar, como a continuación se indica:</p>',
            tableHtml(secciones.solucionados, { title: 'HALLAZGOS SOLUCIONADOS.', fechaLabel: 'FECHA DE REPORTE SOLUCIONADO', fechaKey: 'fecha_solucion', fotoLabel: 'EVIDENCIA FOTOGRÁFICA SOLUCIONADA', fotoKey: 'evidencia_solucion_url', fotoAlt: 'evidencia_url' }),
            tableHtml(secciones.pendientes, { title: 'HALLAZGOS PENDIENTES POR SOLUCIONAR.', fechaLabel: 'FECHA DE REPORTE', fechaKey: 'fecha_reporte', fotoLabel: 'EVIDENCIA FOTOGRÁFICA', fotoKey: 'evidencia_url' }),
            '<div class="firma">' + esc(datos.despedida) + '<br>' + esc(datos.firmante_cargo) + '<div class="nombre">' + esc(datos.firmante_nombre) + '</div></div>',
            ccp.length ? '<div class="ccp">' + ccp.map(function (l) { return '<div><span>c.c.p.</span><span>' + esc(l) + '</span></div>'; }).join('') + '</div>' : '',
            datos.iniciales ? '<div class="iniciales">' + esc(datos.iniciales) + '</div>' : ''
        ].join('');
        var title = 'Oficio ' + (datos.numero || '') + ' · Hallazgos ' + periodText(ym);
        if (mode === 'word') {
            // Word ignora flexbox: el membrete y el encabezado van en tablas sin borde.
            body = body
                .replace(/<div class="membrete">(.*?)<div class="leyenda">(.*?)<\/div><\/div>/,
                    '<table width="100%" style="border:none;margin-bottom:12pt"><tr><td style="border:none;width:5cm"><img src="' + esc(logo) + '" width="166"></td><td style="border:none;text-align:center;font-weight:bold">$2</td></tr></table>')
                .replace(/<div class="encabezado"><div>(.*?)<\/div><div class="der">(.*?)<\/div><\/div>/,
                    '<table width="100%" style="border:none;margin-bottom:10pt"><tr><td style="border:none;vertical-align:top">$1</td><td style="border:none;text-align:right;vertical-align:top">$2</td></tr></table>')
                .replace(/<div class="ccp">([\s\S]*?)<\/div>(?=<div class="iniciales">|$)/, function (_m, inner) {
                    return '<div class="ccp">' + inner.replace(/<div><span>c\.c\.p\.<\/span><span>(.*?)<\/span><\/div>/g, '<p style="margin:0;text-align:left">c.c.p.&nbsp;&nbsp;$1</p>') + '</div>';
                })
                .replace(/<img src="([^"]+)" alt="Evidencia fotográfica">/g, '<img src="$1" width="159" height="95">');
            screenCss = '';
        }
        return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + screenCss + '</style></head><body>' + body + '</body></html>';
    }

    // win: ventana abierta antes (en el mismo clic) si el documento se arma después.
    function printDocument(html, win) {
        win = win && !win.closed ? win : window.open('', '_blank');
        if (!win) {
            alert('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        var imgs = Array.from(win.document.images);
        Promise.all(imgs.map(function (img) {
            return img.complete ? Promise.resolve() : new Promise(function (res) { img.onload = img.onerror = res; });
        })).then(function () {
            setTimeout(function () { win.focus(); win.print(); }, 150);
        });
    }

    function downloadWord(datos, secciones) {
        var html = buildDocument(datos, secciones, 'word');
        var blob = new Blob(['﻿', html], { type: 'application/msword' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Oficio_' + String(datos.numero || 'SETP').replace(/[^\w-]+/g, '_') + '.doc';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    // ---------- datos ----------

    // Si Supabase o la tabla no están disponibles, trabaja con los hallazgos
    // guardados en este navegador (state.store = 'local').
    async function loadHallazgos() {
        try {
            var sb = await getClient();
            var all = [];
            for (var from = 0; ; from += 1000) {
                var res = await sb.from(T_HALLAZGOS).select('*').order('fecha_reporte', { ascending: true }).range(from, from + 999);
                if (res.error) throw res.error;
                all = all.concat(res.data || []);
                if (!res.data || res.data.length < 1000) break;
            }
            state.hallazgos = all;
            state.store = 'db';
            // Columnas de db/setp_hallazgos_por_supervisor.sql.
            var c1 = await sb.from(T_HALLAZGOS).select('no_empleado, oficio_id').limit(1);
            var c2 = await sb.from(T_OFICIOS).select('no_empleado').limit(1);
            state.porSupervisor = !c1.error && !c2.error;
            // Hallazgos ya guardados en un reporte (Guardar reporte).
            var arch = {};
            var rr = await sb.from(T_OFICIOS).select('numero, secciones').like('numero', REPORTE + '%');
            if (!rr.error) {
                (rr.data || []).filter(esReporte).forEach(function (o) {
                    ((o.secciones && o.secciones.hallazgos) || []).forEach(function (h) { arch[h.id] = true; });
                });
            }
            state.archivados = arch;
        } catch (_) {
            state.hallazgos = readLocal();
            state.store = 'local';
            state.porSupervisor = false;
        }
        state.dbReady = state.store === 'db';
    }

    // ---------- almacenamiento local (sin base de datos) ----------

    const LOCAL_KEY = 'setp_hallazgos_local';

    function readLocal() {
        try {
            var list = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (_) { return []; }
    }

    function writeLocal(list) {
        try {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
        } catch (_) {
            throw new Error('el almacenamiento del navegador está lleno. Elimina hallazgos o usa fotografías más ligeras.');
        }
    }

    // Las fotos se guardan dentro del registro, más reducidas que en Supabase
    // para no agotar el espacio del navegador.
    async function photoToDataUrl(file) {
        var blob = await compressImage(file, 1000, 0.72);
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('no se pudo leer la fotografía.')); };
            reader.readAsDataURL(blob);
        });
    }

    async function loadLastOficio() {
        var sb = await getClient();
        // Los borradores (sin No. de oficio todavía) no cuentan como último oficio.
        var res = await sb.from(T_OFICIOS).select('numero, datos, periodo').not('numero', 'like', BORRADOR + '%').not('numero', 'like', REPORTE + '%').order('created_at', { ascending: false }).limit(20);
        if (res.error) throw res.error;
        state.lastOficio = (res.data || []).filter(function (o) { return !esBorrador(o); })[0] || null;
    }

    async function listOficios() {
        var sb = await getClient();
        var res = await sb.from(T_OFICIOS).select('id, numero, fecha_oficio, periodo, created_at').order('created_at', { ascending: false }).limit(30);
        if (res.error) throw res.error;
        return (res.data || []).filter(function (o) { return !esBorrador(o); });
    }

    async function getOficio(id) {
        var sb = await getClient();
        var res = await sb.from(T_OFICIOS).select('*').eq('id', id).single();
        if (res.error) throw res.error;
        return res.data;
    }

    // Reduce la foto a 1600 px como máximo (o el tamaño indicado) y la guarda como JPEG.
    function compressImage(file, maxSize, quality) {
        return new Promise(function (resolve) {
            if (!/^image\//.test(file.type)) return resolve(file);
            var img = new Image();
            var url = URL.createObjectURL(file);
            img.onload = function () {
                var max = maxSize || 1600;
                var scale = Math.min(1, max / Math.max(img.width, img.height));
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', quality || 0.85);
            };
            img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    }

    async function uploadPhoto(file, fecha, suffix) {
        var sb = await getClient();
        var blob = await compressImage(file);
        var path = 'hallazgos/' + fecha.slice(0, 7) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + suffix + '.jpg';
        var up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
        var pub = sb.storage.from(BUCKET).getPublicUrl(path);
        return { path: path, url: pub && pub.data ? pub.data.publicUrl : null };
    }

    async function removePhotos(paths) {
        paths = paths.filter(Boolean);
        if (!paths.length) return;
        try {
            var sb = await getClient();
            await sb.storage.from(BUCKET).remove(paths);
        } catch (_) { /* la foto huérfana no impide la operación */ }
    }

    // ---------- interfaz ----------

    function ensureStyles() {
        if ($('setp-fmt-styles')) return;
        var M = '#' + MODAL_ID;
        var style = document.createElement('style');
        style.id = 'setp-fmt-styles';
        style.textContent = [
            M + ' .modal-body{background:#f8fafc;}',
            M + ' .setp-fmt-steps .nav-link{font-weight:700;font-size:.85rem;color:#475569;}',
            M + ' .setp-fmt-steps .nav-link.active{color:#fff;background:#1d4ed8;}',
            M + ' .setp-fmt-card{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:14px 16px;margin-bottom:14px;}',
            M + ' .setp-fmt-card h6{font-weight:800;color:#0f172a;margin:0;}',
            M + ' .setp-fmt-count{display:inline-flex;min-width:24px;justify-content:center;border-radius:999px;background:#e2e8f0;color:#334155;font-size:.72rem;font-weight:800;padding:1px 8px;margin-left:6px;}',
            M + ' .setp-fmt-table td,' + M + ' .setp-fmt-table th{vertical-align:middle;font-size:.84rem;}',
            M + ' .setp-fmt-table th{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#475569;white-space:nowrap;}',
            M + ' .setp-fmt-thumb{width:84px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;background:#f1f5f9;display:block;}',
            M + ' .setp-fmt-nothumb{width:84px;height:54px;border-radius:6px;border:1px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.7rem;}',
            M + ' .setp-fmt-photo-preview{max-width:100%;max-height:140px;border-radius:8px;margin-top:6px;display:block;}',
            M + ' .setp-fmt-preview{width:100%;height:68vh;border:1px solid #cbd5e1;border-radius:10px;background:#e5e7eb;}',
            M + ' .setp-fmt-badge-ok{background:#ecfdf5;color:#047857;}',
            M + ' .setp-fmt-badge-pend{background:#fef2f2;color:#b91c1c;}',
            // Modo oscuro (body.dark-mode). La vista previa del formato se queda en blanco: es la hoja impresa.
            'body.dark-mode ' + M + ' .setp-fmt-steps .nav-link{color:#c3c9d2;}',
            'body.dark-mode ' + M + ' .setp-fmt-steps .nav-link.active{color:#fff;background:#1d4ed8;}',
            'body.dark-mode ' + M + ' .setp-fmt-card{background:rgba(255,255,255,.03);border-color:var(--border-color);}',
            'body.dark-mode ' + M + ' .setp-fmt-card h6{color:var(--text-color);}',
            'body.dark-mode ' + M + ' .setp-fmt-count{background:rgba(255,255,255,.1);color:var(--text-color);}',
            'body.dark-mode ' + M + ' .setp-fmt-table th{color:#c3c9d2;}',
            'body.dark-mode ' + M + ' .setp-fmt-thumb{border-color:var(--border-color);background:rgba(255,255,255,.05);}',
            'body.dark-mode ' + M + ' .setp-fmt-nothumb{border-color:rgba(148,163,184,.4);color:var(--text-muted-color);}',
            'body.dark-mode ' + M + ' .setp-fmt-preview{border-color:var(--border-color);background:#0f172a;}',
            'body.dark-mode ' + M + ' .setp-fmt-badge-ok{background:rgba(16,185,129,.15);color:#6ee7b7;}',
            'body.dark-mode ' + M + ' .setp-fmt-badge-pend{background:rgba(248,113,113,.15);color:#fca5a5;}',
            // Celular: el Periodo del oficio baja a su propio renglón y los pasos se deslizan.
            '@media (max-width:575.98px){' +
                M + ' .modal-header{flex-wrap:wrap;gap:8px;}' +
                M + ' .modal-header > .ms-auto{order:3;width:100%;margin:0 !important;}' +
                M + ' #setp-fmt-periodo{flex:1 1 auto;width:auto !important;}' +
                M + ' .setp-fmt-steps{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;}' +
                M + ' .setp-fmt-card{padding:12px;}' +
                M + ' .setp-fmt-preview{height:60vh;}' +
            '}'
        ].join('');
        document.head.appendChild(style);
    }

    function ensureModal() {
        if ($(MODAL_ID)) return;
        ensureStyles();
        var datosHtml = DATOS_FIELDS.map(function (f) {
            var id = 'setp-fmt-d-' + f.key;
            var input = f.rows
                ? '<textarea id="' + id + '" class="form-control form-control-sm" rows="' + f.rows + '"></textarea>'
                : '<input id="' + id + '" type="' + (f.type || 'text') + '" class="form-control form-control-sm">';
            return '<div class="col-md-' + f.col + '"><label class="form-label small fw-semibold mb-1" for="' + id + '">' + f.label + '</label>' + input + '</div>';
        }).join('');
        var wrap = document.createElement('div');
        wrap.innerHTML = [
            '<div class="modal fade" id="' + MODAL_ID + '" tabindex="-1" aria-labelledby="setp-fmt-title" aria-hidden="true">',
            ' <div class="modal-dialog modal-xl modal-dialog-scrollable">',
            '  <div class="modal-content">',
            '   <div class="modal-header">',
            '    <h5 class="modal-title fw-bold" id="setp-fmt-title"><i class="fas fa-file-signature me-2 text-primary"></i>Crear formato de hallazgos</h5>',
            '    <div class="ms-auto me-3 d-flex align-items-center gap-2"><label for="setp-fmt-periodo" class="small fw-semibold mb-0">Periodo del oficio</label><input type="month" id="setp-fmt-periodo" class="form-control form-control-sm" style="width:170px"></div>',
            '    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>',
            '   </div>',
            '   <div class="modal-body">',
            '    <div id="setp-fmt-status" class="d-none"></div>',
            '    <ul class="nav nav-pills setp-fmt-steps mb-3" role="tablist">',
            '     <li class="nav-item"><button class="nav-link active" data-step="hallazgos" type="button">1. Hallazgos</button></li>',
            '     <li class="nav-item"><button class="nav-link" data-step="datos" type="button">2. Datos del oficio</button></li>',
            '     <li class="nav-item"><button class="nav-link" data-step="preview" type="button">3. Vista previa</button></li>',
            '    </ul>',
            '    <div data-pane="hallazgos">',
            '     <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">',
            '      <div class="small text-muted" id="setp-fmt-periodo-hint"></div>',
            '      <button type="button" class="btn btn-sm btn-primary" id="setp-fmt-add"><i class="fas fa-plus me-1"></i>Agregar hallazgo</button>',
            '     </div>',
            '     <div class="setp-fmt-card d-none" id="setp-fmt-form-card">',
            '      <h6 class="mb-3" id="setp-fmt-form-title">Nuevo hallazgo</h6>',
            '      <form id="setp-fmt-form" class="row g-2" novalidate>',
            '       <div class="col-md-3"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-fecha">Fecha de reporte *</label><input type="date" id="setp-fmt-f-fecha" class="form-control form-control-sm" required></div>',
            '       <div class="col-md-3"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-modulo">Ubicación (módulo) *</label><input type="text" id="setp-fmt-f-modulo" class="form-control form-control-sm" placeholder="Módulo N" required></div>',
            '       <div class="col-md-2"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-nivel">Nivel</label><input type="text" id="setp-fmt-f-nivel" class="form-control form-control-sm" list="setp-fmt-niveles" placeholder="10.50"><datalist id="setp-fmt-niveles">' + NIVELES.map(function (n) { return '<option value="' + n + '">'; }).join('') + '</datalist></div>',
            '       <div class="col-md-4"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-foto">Evidencia fotográfica</label><input type="file" id="setp-fmt-f-foto" class="form-control form-control-sm" accept="image/*"><img id="setp-fmt-f-foto-prev" class="setp-fmt-photo-preview d-none" alt="Vista previa de la evidencia"></div>',
            '       <div class="col-12"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-desc">Descripción de incidencia *</label><textarea id="setp-fmt-f-desc" class="form-control form-control-sm" rows="2" required></textarea></div>',
            '       <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" id="setp-fmt-f-solucionado"><label class="form-check-label small fw-semibold" for="setp-fmt-f-solucionado">Hallazgo solucionado</label></div></div>',
            '       <div class="col-md-3 setp-fmt-sol d-none"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-fsol">Fecha de solución *</label><input type="date" id="setp-fmt-f-fsol" class="form-control form-control-sm"></div>',
            '       <div class="col-md-5 setp-fmt-sol d-none"><label class="form-label small fw-semibold mb-1" for="setp-fmt-f-fotosol">Evidencia fotográfica solucionada</label><input type="file" id="setp-fmt-f-fotosol" class="form-control form-control-sm" accept="image/*"><img id="setp-fmt-f-fotosol-prev" class="setp-fmt-photo-preview d-none" alt="Vista previa de la evidencia solucionada"></div>',
            '       <div class="col-12 d-flex justify-content-end gap-2 mt-2"><button type="button" class="btn btn-sm btn-outline-secondary" id="setp-fmt-cancel">Cancelar</button><button type="submit" class="btn btn-sm btn-primary" id="setp-fmt-save"><i class="fas fa-save me-1"></i>Guardar hallazgo</button></div>',
            '      </form>',
            '     </div>',
            '     <div id="setp-fmt-lists"></div>',
            '    </div>',
            '    <div data-pane="datos" class="d-none"><div class="setp-fmt-card"><div class="row g-2">' + datosHtml + '</div></div></div>',
            '    <div data-pane="preview" class="d-none">',
            '     <div class="d-flex justify-content-end gap-2 mb-2 flex-wrap">',
            '      <button type="button" class="btn btn-sm btn-outline-secondary" id="setp-fmt-word"><i class="fas fa-file-word me-1"></i>Descargar Word</button>',
            '      <button type="button" class="btn btn-sm btn-outline-primary" id="setp-fmt-print"><i class="fas fa-print me-1"></i>Imprimir / PDF</button>',
            '      <button type="button" class="btn btn-sm btn-success" id="setp-fmt-save-oficio"><i class="fas fa-save me-1"></i>Guardar formato</button>',
            '     </div>',
            '     <iframe id="setp-fmt-preview" class="setp-fmt-preview" title="Vista previa del oficio"></iframe>',
            '    </div>',
            '   </div>',
            '  </div>',
            ' </div>',
            '</div>'
        ].join('');
        document.body.appendChild(wrap.firstChild);
        bindModal();
    }

    function showStep(step) {
        var modal = $(MODAL_ID);
        modal.querySelectorAll('[data-step]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-step') === step); });
        modal.querySelectorAll('[data-pane]').forEach(function (p) { p.classList.toggle('d-none', p.getAttribute('data-pane') !== step); });
        if (step === 'preview') renderPreview();
    }

    function hallazgoRow(h, i, kind) {
        // En solucionados se muestra la foto de la solución y, si no hay, la del hallazgo (igual que en el oficio).
        var foto = kind === 'solucionados' ? (h.evidencia_solucion_url || h.evidencia_url) : h.evidencia_url;
        var fecha = kind === 'solucionados' ? h.fecha_solucion : h.fecha_reporte;
        var estatus = h.estatus === 'SOLUCIONADO'
            ? '<span class="badge setp-fmt-badge-ok"><i class="fas fa-check-circle me-1"></i>Solucionado ' + fmtDate(h.fecha_solucion) + '</span>'
            : '<span class="badge setp-fmt-badge-pend"><i class="fas fa-exclamation-circle me-1"></i>Pendiente</span>';
        var actions = canEdit()
            ? '<div class="btn-group btn-group-sm">' +
              (!h.confirmado_en ? '<button type="button" class="btn btn-outline-success" data-act="confirm" data-id="' + esc(h.id) + '" title="Confirmar estatus"><i class="fas fa-check"></i></button>' : '') +
              '<button type="button" class="btn btn-outline-primary" data-act="edit" data-id="' + esc(h.id) + '" title="Editar"><i class="fas fa-pen"></i></button>' +
              '<button type="button" class="btn btn-outline-danger" data-act="delete" data-id="' + esc(h.id) + '" title="Eliminar"><i class="fas fa-trash-alt"></i></button></div>'
            : '';
        return '<tr><td class="text-center">' + (i + 1) + '</td><td class="text-nowrap">' + fmtDate(fecha) + '</td>' +
            '<td>' + esc(h.modulo) + (h.nivel ? ', Nivel ' + esc(h.nivel) : '') + '</td><td>' + esc(h.descripcion) + '</td>' +
            '<td>' + (foto ? '<a href="' + esc(foto) + '" target="_blank" rel="noopener"><img class="setp-fmt-thumb" src="' + esc(foto) + '" alt="Evidencia"></a>' : '<div class="setp-fmt-nothumb">Sin foto</div>') + '</td>' +
            '<td>' + estatus + confirmadoHtml(h) + '</td><td class="text-end">' + actions + '</td></tr>';
    }

    function listCard(title, hint, rows, kind, fechaLabel) {
        var body = rows.length
            ? '<div class="table-responsive"><table class="table table-sm mb-0 setp-fmt-table"><thead><tr><th>No.</th><th>' + fechaLabel + '</th><th>Ubicación</th><th>Descripción</th><th>Evidencia</th><th>Estatus</th><th></th></tr></thead><tbody>' +
              rows.map(function (h, i) { return hallazgoRow(h, i, kind); }).join('') + '</tbody></table></div>'
            : '<div class="small text-muted py-2">Sin hallazgos.</div>';
        return '<div class="setp-fmt-card"><div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-1"><h6>' + title + '<span class="setp-fmt-count">' + rows.length + '</span></h6><span class="small text-muted">' + hint + '</span></div>' + body + '</div>';
    }

    function renderLists() {
        var ym = state.periodo;
        var byId = {};
        state.hallazgos.forEach(function (h) { byId[h.id] = h; });
        var s = currentSections();
        var full = function (list) { return list.map(function (x) { return byId[x.id] || x; }); };
        var prevYm = prevMonth(ym);
        $('setp-fmt-periodo-hint').innerHTML = 'Periodo reportado: <b>' + periodText(ym) + '</b> · Seguimiento del periodo ' + periodText(prevYm) +
            (state.borrador ? ' · Detectados de <b>' + esc(nombreSupervisor(state.borrador.no_empleado)) + '</b> en sus recorridos del ' + fmtDate(state.borrador.fecha)
                : state.porSupervisor && supervisorActual() ? ' · Detectados de <b>' + esc(nombreSupervisor(supervisorActual())) + '</b> que aún no salen en un formato' : '');
        $('setp-fmt-add').classList.toggle('d-none', !canEdit());
        $('setp-fmt-lists').innerHTML =
            listCard('Hallazgos detectados', 'Primera tabla del oficio', full(s.detectados), 'detectados', 'Fecha de reporte') +
            listCard('Hallazgos solucionados', 'Solucionados en ' + MONTH_NAMES[Number(ym.slice(5, 7)) - 1] + ', con evidencia y estatus confirmado', full(s.solucionados), 'solucionados', 'Fecha solucionado') +
            listCard('Hallazgos pendientes por solucionar', 'De todos los supervisores, hasta que se les dé seguimiento', full(s.pendientes), 'pendientes', 'Fecha de reporte');
    }

    function resetForm() {
        state.editingId = null;
        state.files = { evidencia: null, solucion: null };
        $('setp-fmt-form').reset();
        ['setp-fmt-f-foto-prev', 'setp-fmt-f-fotosol-prev'].forEach(function (id) { $(id).classList.add('d-none'); $(id).removeAttribute('src'); });
        toggleSolucion(false);
    }

    function toggleSolucion(on) {
        $('setp-fmt-f-solucionado').checked = !!on;
        document.querySelectorAll('#' + MODAL_ID + ' .setp-fmt-sol').forEach(function (el) { el.classList.toggle('d-none', !on); });
    }

    function openForm(h, focusSolucion) {
        resetForm();
        var card = $('setp-fmt-form-card');
        card.classList.remove('d-none');
        $('setp-fmt-form-title').textContent = h ? 'Editar hallazgo' : 'Nuevo hallazgo';
        if (h) {
            state.editingId = h.id;
            $('setp-fmt-f-fecha').value = h.fecha_reporte;
            $('setp-fmt-f-modulo').value = h.modulo || '';
            $('setp-fmt-f-nivel').value = h.nivel || '';
            $('setp-fmt-f-desc').value = h.descripcion || '';
            if (h.evidencia_url) { $('setp-fmt-f-foto-prev').src = h.evidencia_url; $('setp-fmt-f-foto-prev').classList.remove('d-none'); }
            var solved = h.estatus === 'SOLUCIONADO' || focusSolucion;
            toggleSolucion(solved);
            $('setp-fmt-f-fsol').value = h.fecha_solucion || (focusSolucion ? todayIso() : '');
            if (h.evidencia_solucion_url) { $('setp-fmt-f-fotosol-prev').src = h.evidencia_solucion_url; $('setp-fmt-f-fotosol-prev').classList.remove('d-none'); }
        } else {
            var r = monthRange(state.periodo);
            var today = todayIso();
            $('setp-fmt-f-fecha').value = today >= r.start && today <= r.end ? today : r.start;
        }
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        (focusSolucion ? $('setp-fmt-f-fsol') : $('setp-fmt-f-modulo')).focus();
    }

    // v = { fecha, modulo, nivel, desc, solved, fsol } · devuelve el mensaje de error o ''.
    function validateHallazgo(v) {
        if (!v.fecha || !v.modulo || !v.desc) return 'Completa fecha de reporte, ubicación y descripción.';
        if (v.solved && !v.fsol) return 'Indica la fecha de solución.';
        if (v.solved && v.fsol < v.fecha) return 'La fecha de solución no puede ser anterior a la fecha de reporte.';
        return '';
    }

    // Sube las fotos nuevas, guarda el hallazgo y actualiza state.hallazgos.
    // Lo usan el formulario del modal y la tabla de reporte del panel.
    async function persistHallazgo(prev, v, files) {
        var payload = {
            fecha_reporte: v.fecha,
            modulo: v.modulo,
            nivel: String(v.nivel || '').trim().replace(/^nivel\s*/i, '').replace(/\.$/, '') || null,
            descripcion: v.desc,
            estatus: v.solved ? 'SOLUCIONADO' : 'PENDIENTE',
            fecha_solucion: v.solved ? v.fsol : null,
            updated_by: actor(),
            updated_at: new Date().toISOString()
        };
        // La sección se fija al capturar y ya no cambia.
        if (!prev && v.seccion) payload.seccion = v.seccion;
        // Si cambia el estatus, el nuevo se vuelve a confirmar con ✓ (un detectado
        // pasa a solucionados sólo ya confirmado como solucionado).
        if (prev && prev.estatus !== payload.estatus && prev.confirmado_en) {
            payload.confirmado_en = null;
            payload.confirmado_por = null;
        }
        // Seguimiento desde ✓ de pendientes: la solución queda confirmada al guardarla.
        if (v.confirmar) {
            payload.confirmado_en = new Date().toISOString();
            payload.confirmado_por = actor();
        }
        // El hallazgo nuevo es del supervisor elegido.
        if (!prev && state.porSupervisor) payload.no_empleado = supervisorActual() || null;
        if (state.store === 'local') return persistLocal(prev, v, files, payload);
        var uploaded = [];
        try {
            var oldPaths = [];
            if (files.evidencia) {
                var p1 = await uploadPhoto(files.evidencia, v.fecha, 'e');
                uploaded.push(p1.path);
                payload.evidencia_url = p1.url;
                payload.evidencia_path = p1.path;
                if (prev) oldPaths.push(prev.evidencia_path);
            }
            if (v.solved && files.solucion) {
                var p2 = await uploadPhoto(files.solucion, v.fsol, 's');
                uploaded.push(p2.path);
                payload.evidencia_solucion_url = p2.url;
                payload.evidencia_solucion_path = p2.path;
                if (prev) oldPaths.push(prev.evidencia_solucion_path);
            }
            if (!v.solved && prev && prev.evidencia_solucion_path) {
                payload.evidencia_solucion_url = null;
                payload.evidencia_solucion_path = null;
                oldPaths.push(prev.evidencia_solucion_path);
            }
            var sb = await getClient();
            var res;
            if (prev) {
                res = await sb.from(T_HALLAZGOS).update(payload).eq('id', prev.id).select('*').single();
            } else {
                payload.created_by = actor();
                res = await sb.from(T_HALLAZGOS).insert([payload]).select('*').single();
            }
            if (res.error) throw res.error;
            removePhotos(oldPaths);
            if (prev) state.hallazgos = state.hallazgos.map(function (h) { return h.id === prev.id ? res.data : h; });
            else state.hallazgos.push(res.data);
            return res.data;
        } catch (error) {
            removePhotos(uploaded);
            throw error;
        }
    }

    async function persistLocal(prev, v, files, payload) {
        var row = Object.assign({}, prev || {
            id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            created_at: payload.updated_at,
            created_by: payload.updated_by,
            evidencia_url: null,
            evidencia_solucion_url: null
        }, payload);
        if (files.evidencia) row.evidencia_url = await photoToDataUrl(files.evidencia);
        if (!v.solved) row.evidencia_solucion_url = null;
        else if (files.solucion) row.evidencia_solucion_url = await photoToDataUrl(files.solucion);
        var list = prev
            ? state.hallazgos.map(function (h) { return h.id === prev.id ? row : h; })
            : state.hallazgos.concat([row]);
        writeLocal(list);
        state.hallazgos = list;
        return row;
    }

    async function removeHallazgo(h) {
        if (state.store === 'local') {
            var list = state.hallazgos.filter(function (x) { return x.id !== h.id; });
            writeLocal(list);
            state.hallazgos = list;
            return;
        }
        var sb = await getClient();
        var res = await sb.from(T_HALLAZGOS).delete().eq('id', h.id);
        if (res.error) throw res.error;
        removePhotos([h.evidencia_path, h.evidencia_solucion_path]);
        state.hallazgos = state.hallazgos.filter(function (x) { return x.id !== h.id; });
    }

    async function saveHallazgo(e) {
        e.preventDefault();
        if (!canEdit()) return;
        var v = {
            fecha: $('setp-fmt-f-fecha').value,
            modulo: $('setp-fmt-f-modulo').value.trim(),
            nivel: $('setp-fmt-f-nivel').value,
            desc: $('setp-fmt-f-desc').value.trim(),
            solved: $('setp-fmt-f-solucionado').checked,
            fsol: $('setp-fmt-f-fsol').value,
            // "Agregar hallazgo" del formato captura hallazgos detectados.
            seccion: SECCIONES.detectados
        };
        var invalid = validateHallazgo(v);
        if (invalid) return setStatus(invalid, 'warning');

        var btn = $('setp-fmt-save');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Guardando…';
        try {
            var prev = state.editingId ? state.hallazgos.find(function (h) { return h.id === state.editingId; }) : null;
            await persistHallazgo(prev, v, state.files);
            $('setp-fmt-form-card').classList.add('d-none');
            resetForm();
            setStatus('');
            renderLists();
        } catch (error) {
            setStatus('No se pudo guardar el hallazgo: ' + hallazgoErr(error), 'danger');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save me-1"></i>Guardar hallazgo';
        }
    }

    // Si faltan las columnas de db/setp_hallazgos_secciones.sql, lo dice claro.
    function hallazgoErr(error) {
        var msg = String(error && error.message ? error.message : error);
        if (/seccion|confirmado_/.test(msg)) return 'falta aplicar <code>db/setp_hallazgos_secciones.sql</code> en Supabase.';
        return esc(msg);
    }

    // El botón ✓ confirma el estatus actual del hallazgo; no lo cambia.
    async function confirmarEstatus(id, onDone, onError) {
        var h = state.hallazgos.find(function (x) { return x.id === id; });
        if (!h || !canEdit()) return;
        var estatus = h.estatus === 'SOLUCIONADO' ? 'Solucionado' : 'Pendiente';
        var ubicacion = h.modulo + (h.nivel ? ', Nivel ' + h.nivel : '');
        var aviso = 'El estatus no cambia; sólo queda registrado que se confirmó.';
        // Ventana de confirmación con desenfoque (js/setp-recorridos.js); si no está, la del navegador.
        var rec = window.setpRecorridos;
        var ok = rec && rec.confirmar
            ? await rec.confirmar({
                tono: 'ok',
                kicker: 'Confirmar estatus',
                titulo: '¿Confirmar el estatus "' + estatus + '"?',
                filas: [['Ubicación', ubicacion], ['Descripción', h.descripcion], ['Estatus', estatus]],
                aviso: aviso,
                boton: 'Confirmar'
            })
            : window.confirm('¿Confirmar el estatus "' + estatus + '" de este hallazgo?\n\n' + ubicacion + ' · ' + h.descripcion + '\n\n' + aviso);
        if (!ok) return;
        var cambios = { confirmado_en: new Date().toISOString(), confirmado_por: actor() };
        try {
            var saved;
            if (state.store === 'local') {
                saved = Object.assign({}, h, cambios);
                var list = state.hallazgos.map(function (x) { return x.id === id ? saved : x; });
                writeLocal(list);
                state.hallazgos = list;
            } else {
                var sb = await getClient();
                var res = await sb.from(T_HALLAZGOS).update(cambios).eq('id', id).select('*').single();
                if (res.error) throw res.error;
                saved = res.data;
                state.hallazgos = state.hallazgos.map(function (x) { return x.id === id ? saved : x; });
            }
            onDone();
        } catch (error) {
            onError('No se pudo confirmar el estatus: ' + hallazgoErr(error));
        }
    }

    function confirmadoHtml(h) {
        if (!h.confirmado_en) return '';
        var dia = new Date(h.confirmado_en).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return '<span class="d-block small text-success mt-1" title="Confirmado por ' + esc(h.confirmado_por || '') + '"><i class="fas fa-check-double me-1"></i>Confirmado ' + dia + '</span>';
    }

    async function deleteHallazgo(id) {
        var h = state.hallazgos.find(function (x) { return x.id === id; });
        if (!h || !canEdit()) return;
        if (!window.confirm('¿Eliminar el hallazgo "' + h.descripcion + '"?')) return;
        try {
            await removeHallazgo(h);
            if (state.editingId === id) { $('setp-fmt-form-card').classList.add('d-none'); resetForm(); }
            renderLists();
        } catch (error) {
            setStatus('No se pudo eliminar: ' + esc(error && error.message ? error.message : error), 'danger');
        }
    }

    // ---------- datos del oficio ----------

    function nextNumero(numero) {
        var m = String(numero || '').match(/^(.*?)(\d+)\s*$/);
        return m ? m[1] + String(Number(m[2]) + 1) : (numero || DEFAULT_DATOS.numero);
    }

    function fillDatos() {
        var base = Object.assign({}, DEFAULT_DATOS, state.lastOficio && state.lastOficio.datos ? state.lastOficio.datos : {});
        base.numero = state.lastOficio ? nextNumero(state.lastOficio.numero) : DEFAULT_DATOS.numero;
        // Formato guardado al finalizar el recorrido: el No. de oficio se captura a mano.
        if (state.borrador) base.numero = '';
        base.fecha_oficio = todayIso();
        DATOS_FIELDS.forEach(function (f) { $('setp-fmt-d-' + f.key).value = base[f.key] || ''; });
        $('setp-fmt-d-numero').placeholder = state.borrador ? 'Captura el No. de oficio (ej. SSO/GOET/1002)' : '';
    }

    function readDatos() {
        var datos = {};
        DATOS_FIELDS.forEach(function (f) { datos[f.key] = $('setp-fmt-d-' + f.key).value.trim(); });
        datos.leyenda = datos.leyenda.replace(/^[“"]+|[”"]+\.?$/g, '');
        datos.numero = datos.numero.replace(/\.$/, '');
        return datos;
    }

    function currentSections(oficioId) {
        return seccionesDe(state.periodo, oficioId);
    }

    function renderPreview() {
        $('setp-fmt-preview').srcdoc = buildDocument(readDatos(), currentSections(), 'screen');
    }

    async function saveOficio() {
        var datos = readDatos();
        if (!datos.numero || !/\d/.test(datos.numero)) { showStep('datos'); return setStatus('Captura el número de oficio.', 'warning'); }
        if (!datos.fecha_oficio) { showStep('datos'); return setStatus('Captura la fecha del oficio.', 'warning'); }
        if (esBorrador(datos)) { showStep('datos'); return setStatus('Ese No. de oficio no es válido. Captura el número del oficio.', 'warning'); }
        if (!canEdit()) return;
        // Formato guardado al finalizar el recorrido (desde "Formatos guardados").
        var b = state.borrador;
        // Con supervisor elegido, el formato y sus detectados quedan a su nombre.
        var no = state.porSupervisor ? (b ? b.no_empleado : supervisorActual()) : '';
        var btn = $('setp-fmt-save-oficio');
        btn.disabled = true;
        try {
            var sb = await getClient();
            var exists = await sb.from(T_OFICIOS).select(state.porSupervisor ? 'id, no_empleado' : 'id').eq('numero', datos.numero).maybeSingle();
            if (exists.error) throw exists.error;
            if (exists.data && no && exists.data.no_empleado && exists.data.no_empleado !== no) {
                showStep('datos');
                return setStatus('El No. de oficio <b>' + esc(datos.numero) + '</b> ya lo usa un formato de otro supervisor. Captura otro número.', 'warning');
            }
            if (exists.data && !window.confirm('Ya existe un formato con el No. ' + datos.numero + '. ¿Reemplazarlo?')) return;
            var secciones = currentSections(no && exists.data ? exists.data.id : null);
            // Sólo los detectados del supervisor quedan ligados al formato;
            // solucionados y pendientes son el seguimiento del mes anterior.
            var ids = no ? secciones.detectados.map(function (h) { return h.id; }) : [];
            if (no && !ids.length && !secciones.solucionados.length && !secciones.pendientes.length) {
                showStep('hallazgos');
                return setStatus('No hay hallazgos en este periodo para guardar en un formato.', 'warning');
            }
            var payload = {
                numero: datos.numero,
                fecha_oficio: datos.fecha_oficio,
                periodo: state.periodo + '-01',
                datos: datos,
                secciones: secciones,
                updated_by: actor(),
                updated_at: new Date().toISOString()
            };
            if (state.porSupervisor) payload.no_empleado = no || null;
            if (!exists.data) payload.created_by = actor();
            var res = await sb.from(T_OFICIOS).upsert(payload, { onConflict: 'numero' }).select('id').single();
            if (res.error) throw res.error;
            state.lastOficio = { numero: datos.numero, datos: datos };
            var msg = '<i class="fas fa-check-circle me-1"></i>Formato <b>' + esc(datos.numero) + '</b> guardado. Lo encuentras en <b>Formatos guardados</b>.';
            var oficioId = res.data.id;
            if (ids.length) {
                // Los detectados del formato quedan ligados a él y salen del reporte del supervisor.
                var up = await sb.from(T_HALLAZGOS).update({ oficio_id: oficioId }).in('id', ids).select('id');
                if (up.error) throw new Error('el formato se guardó, pero sus hallazgos no se pudieron ligar: ' + up.error.message);
                var ligados = (up.data || []).map(function (h) { return h.id; });
                if (!ligados.length) throw new Error('el formato se guardó, pero sin permiso para ligar sus hallazgos en setp_hallazgos.');
                state.hallazgos = state.hallazgos.map(function (h) {
                    return ligados.indexOf(h.id) >= 0 ? Object.assign({}, h, { oficio_id: oficioId }) : h;
                });
                msg += (ligados.length === 1 ? ' Su hallazgo detectado quedó guardado' : ' Sus ' + ligados.length + ' hallazgos detectados quedaron guardados') +
                    ' con el formato y <b>Hallazgos detectados</b> de ' + esc(nombreSupervisor(no)) + ' queda limpio para el siguiente.';
            }
            // Los recorridos terminados del supervisor quedan ligados al formato
            // (setp_oficio_recorridos) y dejan de mostrarse en "Supervisor × turno".
            // Con borrador: sólo sus recorridos del día.
            var sup = b ? b.no_empleado : supervisorActual();
            var rec = window.setpRecorridos;
            var recIds = sup && rec && rec.recorridosParaFormato ? rec.recorridosParaFormato(sup)
                .filter(function (r) { return !b || b.recorridos.indexOf(r.id) >= 0; })
                .map(function (r) { return r.id; }) : [];
            if (recIds.length) {
                var lr = await sb.from('setp_oficio_recorridos').insert(recIds.map(function (id) { return { oficio_id: oficioId, recorrido_id: id }; }));
                if (lr.error) throw new Error('el formato se guardó, pero sus recorridos no se pudieron ligar: ' + lr.error.message);
                rec.marcarEnFormato(recIds);
                msg += (recIds.length === 1 ? ' Su recorrido quedó guardado' : ' Sus ' + recIds.length + ' recorridos quedaron guardados') + ' con el formato.';
            }
            if (b) {
                // El borrador ya tiene No. de oficio: sale de "Por generar".
                if (!b.convertido) {
                    var del = await sb.from(T_OFICIOS).delete().eq('id', b.id);
                    if (del.error) throw new Error('el formato se guardó, pero no se pudo quitar de "Por generar": ' + del.error.message);
                }
                b.convertido = oficioId;
            } else {
                try { await limpiarBorradores(sb, sup); } catch (_) { /* el formato ya quedó guardado */ }
            }
            // Con borrador, el filtro sólo se limpia si es el mismo supervisor.
            if (sup && (!b || supervisorActual() === sup)) {
                // El filtro vuelve a --Seleccionar-- para que el siguiente supervisor elija su nombre.
                var sel = $('setp-f-supervisor');
                if (sel) { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); }
                msg += ' El filtro <b>Supervisor</b> quedó en --Seleccionar-- para el siguiente.';
            }
            renderLists();
            setStatus(msg, 'success');
        } catch (error) {
            setStatus('No se pudo guardar el formato: ' + esc(error && error.message ? error.message : error), 'danger');
        } finally {
            btn.disabled = false;
        }
    }

    // ---------- eventos ----------

    function previewFile(input, imgId, key) {
        var file = input.files && input.files[0];
        state.files[key] = file || null;
        var img = $(imgId);
        if (file) { img.src = URL.createObjectURL(file); img.classList.remove('d-none'); }
    }

    function bindModal() {
        var modal = $(MODAL_ID);
        modal.querySelectorAll('[data-step]').forEach(function (b) {
            b.addEventListener('click', function () { showStep(b.getAttribute('data-step')); });
        });
        $('setp-fmt-periodo').addEventListener('change', function (e) {
            if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
            state.periodo = e.target.value;
            renderLists();
            if (!modal.querySelector('[data-pane="preview"]').classList.contains('d-none')) renderPreview();
        });
        $('setp-fmt-add').addEventListener('click', function () { openForm(null); });
        $('setp-fmt-cancel').addEventListener('click', function () { $('setp-fmt-form-card').classList.add('d-none'); resetForm(); });
        $('setp-fmt-form').addEventListener('submit', saveHallazgo);
        $('setp-fmt-f-solucionado').addEventListener('change', function (e) {
            toggleSolucion(e.target.checked);
            if (e.target.checked && !$('setp-fmt-f-fsol').value) $('setp-fmt-f-fsol').value = todayIso();
        });
        $('setp-fmt-f-foto').addEventListener('change', function (e) { previewFile(e.target, 'setp-fmt-f-foto-prev', 'evidencia'); });
        $('setp-fmt-f-fotosol').addEventListener('change', function (e) { previewFile(e.target, 'setp-fmt-f-fotosol-prev', 'solucion'); });
        $('setp-fmt-lists').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-act]');
            if (!btn) return;
            var id = btn.getAttribute('data-id');
            var h = state.hallazgos.find(function (x) { return x.id === id; });
            var act = btn.getAttribute('data-act');
            if (act === 'edit' && h) openForm(h, false);
            else if (act === 'confirm' && h) confirmarEstatus(id, renderLists, function (msg) { setStatus(msg, 'danger'); });
            else if (act === 'delete') deleteHallazgo(id);
        });
        // El formato guardado al finalizar el recorrido se imprime ya con su No. de oficio (manual).
        var conNumero = function () {
            if (!state.borrador) return true;
            var n = readDatos().numero;
            if (n && /\d/.test(n) && !esBorrador({ numero: n })) return true;
            showStep('datos');
            setStatus('Captura el No. de oficio antes de imprimir o descargar el formato.', 'warning');
            $('setp-fmt-d-numero').focus();
            return false;
        };
        $('setp-fmt-print').addEventListener('click', function () { if (conNumero()) printDocument(buildDocument(readDatos(), currentSections(), 'print')); });
        $('setp-fmt-word').addEventListener('click', function () { if (conNumero()) downloadWord(readDatos(), currentSections()); });
        $('setp-fmt-save-oficio').addEventListener('click', saveOficio);
        // Lo capturado en el modal se refleja en la tabla de reporte del panel.
        // Al cerrar, el reporte vuelve a sus detectados de siempre (sin borrador).
        modal.addEventListener('hidden.bs.modal', function () { state.borrador = null; if (rep.el) renderReport(); });
    }

    // ---------- tabla de reporte (panel Supervisor × turno) ----------
    // Lista los hallazgos agrupados como en el oficio, permite capturarlos
    // en línea y "Generar formato" abre el oficio del periodo en vista previa.

    // periodo: mes de "desde" ('YYYY-MM'), para el seguimiento y el formato;
    // desde / hasta: periodo con día del reporte ('YYYY-MM-DD').
    const rep = { el: null, periodo: '', desde: '', hasta: '', editing: null, editKind: null, solveId: null, solving: false, files: { evidencia: null, solucion: null }, saving: false };
    const REP_COLS = 9;

    function repStatus(message, type) {
        var box = $('setp-rep-status');
        if (!box) return;
        box.className = message ? 'alert alert-' + (type || 'info') + ' py-2 small mx-3 mt-3 mb-0' : 'd-none';
        box.innerHTML = message || '';
    }

    function ensureReportStyles() {
        if ($('setp-rep-styles')) return;
        var R = '#setp-reporte-hallazgos';
        var style = document.createElement('style');
        style.id = 'setp-rep-styles';
        style.textContent = [
            R + '{border-top:1px solid #e2e8f0;}',
            R + ' .setp-rep-head{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#f8fafc;border-bottom:1px solid #e2e8f0;}',
            R + ' .setp-rep-title{font-weight:800;color:#0f172a;font-size:.9rem;margin:0;}',
            R + ' .setp-rep-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
            R + ' .setp-rep-actions label{font-size:.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:0;}',
            R + ' .setp-rep-periodo{display:flex;align-items:center;gap:6px;min-width:0;}',
            R + ' .setp-rep-periodo input{width:145px;min-width:0;}',
            R + ' .setp-rep-al{font-size:.8rem;color:#64748b;}',
            'body.dark-mode ' + R + ' .setp-rep-al{color:var(--text-muted-color);}',
            R + ' .setp-rep-table td{vertical-align:middle;}',
            R + ' .setp-rep-table td.setp-rep-desc{min-width:240px;white-space:normal;}',
            R + ' tr.setp-rep-group th{background:#eff6ff;color:#1e3a8a;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid #bfdbfe;}',
            R + ' .setp-rep-count{display:inline-flex;min-width:22px;justify-content:center;border-radius:999px;background:#dbeafe;color:#1e3a8a;font-size:.7rem;padding:0 7px;margin-left:6px;}',
            R + ' .setp-rep-note{font-weight:500;text-transform:none;letter-spacing:0;color:#475569;margin-left:6px;}',
            R + ' .setp-rep-add-grupo{font-size:.75rem;font-weight:700;text-transform:none;letter-spacing:0;text-decoration:none;vertical-align:baseline;}',
            R + ' td.setp-rep-none{color:#64748b;font-size:.8rem;text-align:center;padding:10px;}',
            R + ' .setp-rep-thumb{width:84px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;background:#f1f5f9;display:block;}',
            R + ' .setp-rep-nothumb{width:84px;height:54px;border-radius:6px;border:1px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.7rem;}',
            R + ' label.setp-rep-photo{cursor:pointer;margin:0;display:block;}',
            R + ' label.setp-rep-photo:hover .setp-rep-nothumb,' + R + ' label.setp-rep-photo:hover .setp-rep-thumb{border-color:#2563eb;}',
            R + ' label.setp-rep-photo.is-disabled{cursor:not-allowed;opacity:.45;}',
            R + ' tr.setp-rep-edit td{background:#f8fbff;}',
            R + ' tr.setp-rep-edit .form-control,' + R + ' tr.setp-rep-edit .form-select{min-width:120px;}',
            R + ' .setp-rep-local{display:inline-flex;align-items:center;margin-left:8px;padding:1px 8px;border-radius:999px;background:#fffbeb;color:#92400e;font-weight:600;}',
            R + ' .setp-rep-ok{background:#ecfdf5;color:#047857;}',
            R + ' .setp-rep-pend{background:#fef2f2;color:#b91c1c;}',
            // Modo oscuro (body.dark-mode).
            'body.dark-mode ' + R + '{border-top-color:var(--border-color);}',
            'body.dark-mode ' + R + ' .setp-rep-head{background:rgba(255,255,255,.03);border-bottom-color:var(--border-color);}',
            'body.dark-mode ' + R + ' .setp-rep-title{color:var(--text-color);}',
            'body.dark-mode ' + R + ' .setp-rep-actions label,body.dark-mode ' + R + ' td.setp-rep-none{color:var(--text-muted-color);}',
            'body.dark-mode ' + R + ' tr.setp-rep-group th{background:rgba(77,171,247,.12);color:#8cc8ff;border-bottom-color:rgba(77,171,247,.3);}',
            'body.dark-mode ' + R + ' .setp-rep-count{background:rgba(77,171,247,.2);color:#cfe6ff;}',
            'body.dark-mode ' + R + ' .setp-rep-note{color:#c3c9d2;}',
            'body.dark-mode ' + R + ' .setp-rep-thumb{border-color:var(--border-color);background:rgba(255,255,255,.05);}',
            'body.dark-mode ' + R + ' .setp-rep-nothumb{border-color:rgba(148,163,184,.4);color:var(--text-muted-color);}',
            'body.dark-mode ' + R + ' label.setp-rep-photo:hover .setp-rep-nothumb,body.dark-mode ' + R + ' label.setp-rep-photo:hover .setp-rep-thumb{border-color:var(--primary-color);}',
            'body.dark-mode ' + R + ' tr.setp-rep-edit td{background:rgba(77,171,247,.08);}',
            'body.dark-mode ' + R + ' .setp-rep-local{background:rgba(251,191,36,.14);color:#fcd34d;}',
            'body.dark-mode ' + R + ' .setp-rep-ok{background:rgba(16,185,129,.15);color:#6ee7b7;}',
            'body.dark-mode ' + R + ' .setp-rep-pend{background:rgba(248,113,113,.15);color:#fca5a5;}'
        ].concat(repEstilosResponsive(R)).join('');
        document.head.appendChild(style);
    }

    // Celular y tableta (#setp-root < 1000 px, contenedor "setp" de js/setp-reportes.js):
    // cada hallazgo, también el que se captura o edita, se ve como tarjeta y los
    // títulos de grupo como franjas. Las etiquetas siguen el orden de las columnas.
    function repEstilosResponsive(R) {
        var T = R + ' .setp-rep-table';
        var etiquetas = ['No.', 'Fecha de reporte', 'Ubicación de incidencia', 'Descripción de incidencia', 'Evidencia fotográfica', 'Estatus', 'Fecha de solución', 'Evidencia solucionada'];
        var areas = ['no', 'fec', 'ubi', 'des', 'evi', 'est', 'fso', 'evs', 'acc'];
        var card = T + ' tr:not(.setp-rep-group)';
        return [
            '@container setp (max-width:999.98px){',
            R + ' .table-responsive{overflow:visible;}',
            R + ' .table-responsive::after{display:none !important;}',
            T + ',' + T + ' tbody{display:block;width:100%;}',
            T + ' thead{display:none;}',
            T + ' tbody{padding:0 12px 4px;}',
            T + ' tr.setp-rep-group{display:block;margin:0 -12px 10px;}',
            T + ' tr.setp-rep-group th{display:block;white-space:normal;padding:10px 16px;line-height:1.6;}',
            card + '{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-template-areas:"no fec ubi acc" "des des des des" "evi est fso evs";',
            'gap:10px 14px;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin-bottom:12px;background:#fff;box-shadow:0 4px 12px rgba(15,23,42,.04);}',
            T + ' tr.setp-rep-edit{background:#f8fbff;border-color:#bfdbfe;}',
            T + ' td{display:block;border:0;padding:0;min-width:0;background:transparent !important;box-shadow:none !important;text-align:left !important;}',
            T + ' td::before{display:block;font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:3px;}',
            etiquetas.map(function (e, i) { return T + ' td:nth-child(' + (i + 1) + ')::before{content:"' + e + '";}'; }).join(''),
            areas.map(function (a, i) { return card + ' td:nth-child(' + (i + 1) + '):not([colspan]){grid-area:' + a + ';}'; }).join(''),
            T + ' td:nth-child(9){justify-self:end;align-self:start;}',
            // "Sin hallazgos." y "Cargando…": aviso simple, sin etiqueta.
            T + ' td[colspan]{grid-column:1/-1;text-align:center !important;}',
            T + ' td[colspan]::before{content:none;}',
            T + ' tr:has(> td[colspan]){border-style:dashed;box-shadow:none;background:transparent;}',
            R + ' .setp-rep-table td.setp-rep-desc{min-width:0;}',
            T + ' .form-control,' + T + ' .form-select{min-width:0 !important;width:100%;}',
            'body.dark-mode ' + card + '{background:var(--card-bg);border-color:var(--border-color);box-shadow:0 4px 12px rgba(0,0,0,.25);}',
            'body.dark-mode ' + T + ' tr.setp-rep-edit{background:rgba(77,171,247,.08);border-color:rgba(77,171,247,.4);}',
            'body.dark-mode ' + T + ' tr:has(> td[colspan]){background:transparent;box-shadow:none;}',
            'body.dark-mode ' + T + ' td::before{color:var(--text-muted-color);}',
            '}',
            '@container setp (max-width:599.98px){',
            card + '{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"no acc" "fec ubi" "des des" "evi evs" "est fso";gap:8px 12px;padding:12px;}',
            R + ' .setp-rep-thumb,' + R + ' .setp-rep-nothumb{width:100%;max-width:200px;height:96px;}',
            R + ' .setp-rep-head{padding:12px;}',
            R + ' .setp-rep-actions{width:100%;}',
            R + ' .setp-rep-actions .btn{flex:1 1 auto;}',
            R + ' .setp-rep-periodo{width:100%;}',
            R + ' .setp-rep-periodo input{flex:1 1 0;width:auto;}',
            '}'
        ];
    }

    function repShell() {
        return [
            '<div class="setp-rep-head">',
            '  <div><h4 class="setp-rep-title"><i class="fas fa-clipboard-list me-1 text-primary"></i>Reporte de hallazgos del Edificio Terminal</h4><div class="setp-panel-hint" id="setp-rep-hint"></div></div>',
            '  <div class="setp-rep-actions">',
            '    <div class="setp-rep-periodo" role="group" aria-label="Periodo del reporte">',
            '      <label for="setp-rep-desde">Periodo</label><input type="date" id="setp-rep-desde" class="form-control form-control-sm" aria-label="Periodo desde">',
            '      <span class="setp-rep-al">al</span><input type="date" id="setp-rep-hasta" class="form-control form-control-sm" aria-label="Periodo hasta">',
            '    </div>',
            '    <button type="button" class="btn btn-sm btn-outline-primary d-none" data-rep="add"><i class="fas fa-plus me-1"></i>Agregar hallazgo</button>',
            '    <button type="button" class="btn btn-sm btn-success" data-rep="generar"><i class="fas fa-file-signature me-1"></i>Generar formato</button>',
            '    <button type="button" class="btn btn-sm btn-outline-success" data-rep="guardados"><i class="fas fa-folder-open me-1"></i>Formatos guardados</button>',
            '  </div>',
            '</div>',
            '<div id="setp-rep-status" class="d-none"></div>',
            // Cámara (o archivo en PC) para la foto de la solución del ✓ de pendientes.
            '<input type="file" id="setp-rep-sol-file" class="d-none" accept="image/*" capture="environment" aria-label="Foto de la solución">',
            '<div class="table-responsive"><table class="table table-sm mb-0 setp-table setp-rep-table" id="setp-rep-table"></table></div>',
            '<datalist id="setp-rep-niveles">' + NIVELES.map(function (n) { return '<option value="' + n + '">'; }).join('') + '</datalist>'
        ].join('');
    }

    function repThumb(url) {
        return url
            ? '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="setp-rep-thumb" src="' + esc(url) + '" alt="Evidencia fotográfica"></a>'
            : '<span class="setp-rep-nothumb">Sin foto</span>';
    }

    function repPhotoInput(key, url, disabled, label) {
        return '<label class="setp-rep-photo' + (disabled ? ' is-disabled' : '') + '" title="' + label + '">' +
            (url ? '<img class="setp-rep-thumb" src="' + esc(url) + '" alt="' + label + '">' : '<span class="setp-rep-nothumb"><i class="fas fa-camera me-1"></i>Foto</span>') +
            '<input type="file" accept="image/*"' + (key === 'solucion' ? ' capture="environment"' : '') + ' class="d-none" data-file="' + key + '" aria-label="' + label + '"' + (disabled ? ' disabled' : '') + '></label>';
    }

    // kind: grupo donde se dibuja el renglón. En pendientes, ✓ da el seguimiento
    // (solución con evidencia) y el hallazgo pasa a solucionados.
    function repViewRow(h, n, kind) {
        var solved = h.estatus === 'SOLUCIONADO';
        var check = kind === 'pendientes'
            ? '<button type="button" class="btn btn-outline-success" data-rep="solve" data-id="' + esc(h.id) + '" title="Solucionado: tomar la foto de la solución y pasar a Hallazgos solucionados"><i class="fas fa-check"></i></button>'
            : (!h.confirmado_en ? '<button type="button" class="btn btn-outline-success" data-rep="confirm" data-id="' + esc(h.id) + '" title="Confirmar estatus"><i class="fas fa-check"></i></button>' : '');
        var actions = canEdit()
            ? '<div class="btn-group btn-group-sm">' + check +
              '<button type="button" class="btn btn-outline-primary" data-rep="edit" data-id="' + esc(h.id) + '" data-kind="' + (kind || '') + '" title="Editar"><i class="fas fa-pen"></i></button>' +
              '<button type="button" class="btn btn-outline-danger" data-rep="delete" data-id="' + esc(h.id) + '" title="Eliminar"><i class="fas fa-trash-alt"></i></button></div>'
            : '';
        return '<tr><td class="text-center">' + n + '</td><td class="text-nowrap">' + fmtDate(h.fecha_reporte) + '</td>' +
            '<td>' + esc(h.modulo) + (h.nivel ? '<br><span class="text-muted small">Nivel ' + esc(h.nivel) + '</span>' : '') + '</td>' +
            '<td class="setp-rep-desc">' + esc(h.descripcion) + '</td><td>' + repThumb(h.evidencia_url) + '</td>' +
            '<td><span class="badge ' + (solved ? 'setp-rep-ok"><i class="fas fa-check-circle me-1"></i>Solucionado' : 'setp-rep-pend"><i class="fas fa-exclamation-circle me-1"></i>Pendiente') + '</span>' + confirmadoHtml(h) + '</td>' +
            '<td class="text-nowrap">' + (solved ? fmtDate(h.fecha_solucion) : '—') + '</td>' +
            '<td>' + (solved ? repThumb(h.evidencia_solucion_url) : '—') + '</td>' +
            '<td class="text-end text-nowrap">' + actions + '</td></tr>';
    }

    // Hallazgo nuevo en curso de captura: 'new:detectados' | 'new:solucionados' | 'new:pendientes'.
    function repNewKind() {
        return typeof rep.editing === 'string' && rep.editing.indexOf('new:') === 0 ? rep.editing.slice(4) : null;
    }

    // h = hallazgo a editar, o null para uno nuevo de la sección `kind`. Los
    // nuevos traen las fechas acomodadas para caer en esa sección del oficio:
    // detectados se reportan en el mes del periodo; solucionados y pendientes
    // son del mes anterior (los solucionados, resueltos dentro del periodo).
    function repEditRow(h, n, kind) {
        var r = repRango();
        var p = monthRange(prevMonth(rep.periodo));
        var today = todayIso();
        var inMonth = function (range) { return today >= range.start && today <= range.end ? today : range.start; };
        var solved = h ? (h.estatus === 'SOLUCIONADO' || rep.solving) : kind === 'solucionados';
        var fecha = h ? h.fecha_reporte : (kind === 'detectados' ? inMonth(r) : p.start);
        var fsol = h && h.fecha_solucion ? h.fecha_solucion : (solved ? (h ? today : inMonth(r)) : '');
        var limits = function (range) { return h ? '' : ' min="' + range.start + '" max="' + range.end + '"'; };
        return '<tr class="setp-rep-edit" data-edit="' + (h ? esc(h.id) : 'new') + '">' +
            '<td class="text-center">' + (h ? n : '<i class="fas fa-plus text-primary" aria-label="Nuevo"></i>') + '</td>' +
            '<td><input type="date" class="form-control form-control-sm" data-f="fecha" value="' + esc(fecha) + '"' + limits(kind === 'detectados' ? r : p) + ' aria-label="Fecha de reporte"></td>' +
            '<td><input type="text" class="form-control form-control-sm mb-1" data-f="modulo" placeholder="Módulo N" value="' + esc(h ? h.modulo : '') + '" aria-label="Ubicación (módulo)">' +
            '<input type="text" class="form-control form-control-sm" data-f="nivel" list="setp-rep-niveles" placeholder="Nivel (10.50)" value="' + esc(h && h.nivel ? h.nivel : '') + '" aria-label="Nivel"></td>' +
            '<td class="setp-rep-desc"><textarea class="form-control form-control-sm" rows="3" data-f="desc" placeholder="Descripción de la incidencia" aria-label="Descripción de incidencia">' + esc(h ? h.descripcion : '') + '</textarea></td>' +
            '<td>' + repPhotoInput('evidencia', h && h.evidencia_url, false, 'Evidencia fotográfica') + '</td>' +
            '<td><select class="form-select form-select-sm" data-f="estatus" aria-label="Estatus"><option value="PENDIENTE">Pendiente</option><option value="SOLUCIONADO"' + (solved ? ' selected' : '') + '>Solucionado</option></select></td>' +
            '<td><input type="date" class="form-control form-control-sm" data-f="fsol" value="' + esc(fsol) + '"' + (kind === 'solucionados' ? limits(r) : '') + (solved ? '' : ' disabled') + ' aria-label="Fecha de solución"></td>' +
            '<td>' + repPhotoInput('solucion', h && h.evidencia_solucion_url, !solved, 'Evidencia fotográfica solucionada') + '</td>' +
            '<td class="text-end text-nowrap"><div class="btn-group btn-group-sm">' +
            '<button type="button" class="btn btn-primary" data-rep="save" title="Guardar"><i class="fas fa-save"></i></button>' +
            '<button type="button" class="btn btn-outline-secondary" data-rep="cancel" title="Cancelar"><i class="fas fa-times"></i></button></div></td></tr>';
    }

    function repGroup(title, note, rows, kind) {
        var add = canEdit()
            ? '<button type="button" class="btn btn-link btn-sm p-0 ms-2 setp-rep-add-grupo" data-rep="add-grupo" data-kind="' + kind + '"><i class="fas fa-plus me-1"></i>Agregar</button>'
            : '';
        var head = '<tr class="setp-rep-group"><th colspan="' + REP_COLS + '">' + title + '<span class="setp-rep-count">' + rows.length + '</span><span class="setp-rep-note">' + note + '</span>' + add + '</th></tr>';
        // El hallazgo se edita sólo en el grupo desde donde se abrió (puede salir en dos).
        var body = rows.map(function (h, i) {
            return rep.editing === h.id && rep.editKind === kind ? repEditRow(h, i + 1) : repViewRow(h, i + 1, kind);
        }).join('');
        if (repNewKind() === kind) body = repEditRow(null, 0, kind) + body;
        if (!body) body = '<tr><td colspan="' + REP_COLS + '" class="setp-rep-none">Sin hallazgos.</td></tr>';
        return '<tbody>' + head + body + '</tbody>';
    }

    // Periodo del reporte (del … al …, con día).
    function repRango() {
        return { start: rep.desde, end: rep.hasta };
    }

    function repPonerMes(ym) {
        var r = monthRange(ym);
        rep.desde = r.start;
        rep.hasta = r.end;
        rep.periodo = ym;
    }

    function renderReport() {
        if (!rep.el || !$('setp-rep-table')) return;
        var ym = rep.periodo;
        var prevYm = prevMonth(ym);
        var rango = repRango();
        var desde = $('setp-rep-desde'), hasta = $('setp-rep-hasta');
        desde.value = rep.desde;
        desde.max = rep.hasta;
        hasta.value = rep.hasta;
        hasta.min = rep.desde;
        var no = supervisorActual();
        $('setp-rep-hint').innerHTML = 'Periodo reportado ' + rangoText(rango) + ' · seguimiento del periodo ' + periodText(prevYm) +
            (state.porSupervisor && no ? ' · Detectados de <b>' + esc(nombreSupervisor(no)) + '</b> que aún no salen en un formato' : '') +
            (state.store === 'local' ? '<span class="setp-rep-local" title="Las tablas de Supabase (db/create_setp_formatos.sql) aún no están disponibles"><i class="fas fa-laptop me-1"></i>Guardado en este navegador</span>' : '');
        rep.el.querySelector('[data-rep="add"]').classList.toggle('d-none', !canEdit());        var table = $('setp-rep-table');
        var thead = '<thead><tr><th>No.</th><th>Fecha de reporte</th><th>Ubicación de incidencia</th><th>Descripción de incidencia</th><th>Evidencia fotográfica</th><th>Estatus</th><th>Fecha de solución</th><th>Evidencia solucionada</th><th></th></tr></thead>';
        var byId = {};
        state.hallazgos.forEach(function (h) { byId[h.id] = h; });
        var full = function (list) { return list.map(function (x) { return byId[x.id]; }); };
        var s = seccionesDe(rango);
        table.innerHTML = thead +
            repGroup('Hallazgos detectados', rangoText(rango), full(s.detectados), 'detectados') +
            repGroup('Hallazgos solucionados', 'solucionados ' + rangoText(rango) + ', con evidencia y estatus confirmado', full(s.solucionados), 'solucionados') +
            repGroup('Hallazgos pendientes por solucionar', 'de todos los supervisores, hasta que se les dé seguimiento', full(s.pendientes), 'pendientes');
    }

    // kind: grupo desde donde se abrió la edición ('detectados' | 'solucionados' | 'pendientes').
    function repStartEdit(id, solving, kind) {
        rep.editing = id;
        rep.editKind = kind || 'detectados';
        rep.solving = !!solving;
        rep.files = { evidencia: null, solucion: null };
        repStatus('');
        renderReport();
        var row = rep.el.querySelector('tr.setp-rep-edit');
        if (row) {
            var focus = row.querySelector(solving ? '[data-f="fsol"]' : '[data-f="modulo"]');
            if (focus) focus.focus();
        }
    }

    function repCancel() {
        rep.editing = null;
        rep.solving = false;
        rep.files = { evidencia: null, solucion: null };
        renderReport();
    }

    async function repSave(row) {
        if (rep.saving || !canEdit()) return;
        var get = function (f) { var el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value.trim() : ''; };
        var v = { fecha: get('fecha'), modulo: get('modulo'), nivel: get('nivel'), desc: get('desc'), solved: get('estatus') === 'SOLUCIONADO', fsol: get('fsol'), seccion: SECCIONES[repNewKind()] };
        var invalid = validateHallazgo(v);
        if (invalid) return repStatus(invalid, 'warning');
        var prev = repNewKind() ? null : state.hallazgos.find(function (h) { return h.id === rep.editing; });
        // Solucionado siempre lleva la foto de la solución (se sube al bucket al
        // guardar): si falta, se abre la cámara para tomarla.
        if (v.solved && !rep.files.solucion && !(prev && prev.evidencia_solucion_url)) {
            var camara = row.querySelector('[data-file="solucion"]');
            if (camara && !camara.disabled) camara.click();
            return repStatus('Toma la <b>foto de la solución</b> y vuelve a presionar <b>Guardar</b>.', 'warning');
        }
        // Seguimiento desde pendientes (✓ o lápiz): solucionado con evidencia queda
        // confirmado y pasa a Hallazgos solucionados.
        var seguimiento = !!prev && rep.editKind === 'pendientes' && v.solved;
        v.confirmar = seguimiento;
        var btn = row.querySelector('[data-rep="save"]');
        rep.saving = true;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        try {
            var saved = await persistHallazgo(prev, v, rep.files);
            rep.editing = null;
            rep.solving = false;
            rep.files = { evidencia: null, solucion: null };
            var s = seccionesDe(repRango());
            var visible = [s.detectados, s.solucionados, s.pendientes].some(function (l) { return l.some(function (x) { return x.id === saved.id; }); });
            if (seguimiento) {
                var mes = saved.fecha_solucion ? MONTH_NAMES[Number(saved.fecha_solucion.slice(5, 7)) - 1] + ' de ' + saved.fecha_solucion.slice(0, 4) : '';
                repStatus('<i class="fas fa-check-circle me-1"></i>Seguimiento guardado. El hallazgo pasó a <b>Hallazgos solucionados</b>' + (mes ? ' de ' + mes : '') + '.', 'success');
            } else {
                repStatus(visible ? '' : 'Hallazgo guardado. Su fecha de reporte (' + fmtDate(saved.fecha_reporte) + ') queda fuera del periodo mostrado.', 'info');
            }
            renderReport();
        } catch (error) {
            repStatus('No se pudo guardar el hallazgo: ' + hallazgoErr(error), 'danger');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i>';
        } finally {
            rep.saving = false;
        }
    }

    // ✓ de pendientes: abre la cámara (o el selector de archivos en PC) para la
    // foto de la solución; al tomarla, el hallazgo se guarda Solucionado.
    function repTomarFotoSolucion(id) {
        var input = $('setp-rep-sol-file');
        if (!input || !canEdit()) return;
        rep.solveId = id;
        repStatus('<i class="fas fa-camera me-1"></i>Toma la <b>foto de la solución</b> para pasar el hallazgo a Hallazgos solucionados.', 'info');
        input.value = '';
        input.click();
    }

    // Guarda el hallazgo como Solucionado (hoy), sube la foto de la solución al
    // bucket y lo confirma: sale de pendientes y pasa a Hallazgos solucionados.
    async function repSolucionar(id, foto) {
        var h = state.hallazgos.find(function (x) { return x.id === id; });
        if (!h || !canEdit() || rep.saving) return;
        var hoy = todayIso();
        var v = {
            fecha: h.fecha_reporte, modulo: h.modulo, nivel: h.nivel, desc: h.descripcion,
            solved: true, fsol: hoy >= h.fecha_reporte ? hoy : h.fecha_reporte, confirmar: true
        };
        rep.saving = true;
        repStatus('<span class="spinner-border spinner-border-sm me-2"></span>Guardando la foto de la solución…', 'info');
        try {
            var saved = await persistHallazgo(h, v, { evidencia: null, solucion: foto });
            var mes = MONTH_NAMES[Number(saved.fecha_solucion.slice(5, 7)) - 1] + ' de ' + saved.fecha_solucion.slice(0, 4);
            repStatus('<i class="fas fa-check-circle me-1"></i>Hallazgo solucionado. La foto se guardó y pasó a <b>Hallazgos solucionados</b> de ' + mes + '.', 'success');
            renderReport();
        } catch (error) {
            repStatus('No se pudo guardar la solución: ' + hallazgoErr(error), 'danger');
        } finally {
            rep.saving = false;
        }
    }

    async function repDelete(id) {
        var h = state.hallazgos.find(function (x) { return x.id === id; });
        if (!h || !canEdit()) return;
        if (!window.confirm('¿Eliminar el hallazgo "' + h.descripcion + '"?')) return;
        try {
            await removeHallazgo(h);
            if (rep.editing === id) rep.editing = null;
            repStatus('');
            renderReport();
        } catch (error) {
            repStatus('No se pudo eliminar: ' + esc(error && error.message ? error.message : error), 'danger');
        }
    }

    // ---------- Guardar reporte (por usuario y turno) ----------
    // Guarda los hallazgos detectados que se ven en el reporte, agrupados por
    // usuario y turno (los de su recorrido), y limpia "Hallazgos detectados".
    // Los hallazgos no se borran: los no solucionados siguen en "Pendientes
    // por solucionar" hasta su seguimiento. Los reportes quedan en
    // "Formatos guardados" para imprimirlos con el estatus actual.

    const TURNO_LABEL = { MATUTINO: 'Matutino', VESPERTINO: 'Diurno', NOCTURNO: 'Nocturno' };

    function grupoLabel(no, turno) {
        return (no ? nombreSupervisor(no) : 'Sin usuario') + ' · ' + (TURNO_LABEL[turno] || 'Sin turno');
    }

    function agruparPorUsuarioTurno(lista) {
        var rec = window.setpRecorridos;
        var recs = {};
        ((rec && rec.recorridos()) || []).forEach(function (r) { recs[r.id] = r; });
        var grupos = {};
        var orden = [];
        lista.forEach(function (h) {
            var m = /-rec-(.+?)(-x)?\.jpg$/.exec(String(h.evidencia_path || ''));
            var r = m ? recs[m[1]] : null;
            var no = r ? r.no_empleado : (h.no_empleado || '');
            var turno = r ? (r.turno || '') : '';
            var k = no + '|' + turno;
            if (!grupos[k]) { grupos[k] = { no_empleado: no, turno: turno, hallazgos: [] }; orden.push(k); }
            grupos[k].hallazgos.push(h);
        });
        return orden.map(function (k) { return grupos[k]; });
    }

    async function guardarReporte(btn) {
        if (!canEdit() || state.store !== 'db') return;
        var byId = {};
        state.hallazgos.forEach(function (h) { byId[h.id] = h; });
        var rango = repRango();
        var det = seccionesDe(rango).detectados.map(function (x) { return byId[x.id] || x; });
        if (!det.length) return repStatus('No hay hallazgos detectados por guardar ' + rangoText(rango) + '.', 'warning');
        var grupos = agruparPorUsuarioTurno(det);
        var filas = grupos.map(function (g) {
            return [grupoLabel(g.no_empleado, g.turno), g.hallazgos.length + (g.hallazgos.length === 1 ? ' hallazgo' : ' hallazgos')];
        });
        var aviso = 'Se guardan en Formatos guardados y "Hallazgos detectados" queda limpio. Ningún hallazgo se borra: los no solucionados siguen en "Pendientes por solucionar" hasta que se les dé seguimiento. Hazlo una vez guardado el formato.';
        var rec = window.setpRecorridos;
        var ok = rec && rec.confirmar
            ? await rec.confirmar({ tono: 'ok', kicker: 'Reporte de hallazgos · ' + rangoText(rango), titulo: '¿Guardar el reporte y limpiar los detectados?', filas: filas, aviso: aviso, boton: 'Guardar reporte' })
            : window.confirm('¿Guardar el reporte y limpiar Hallazgos detectados?\n\n' + filas.map(function (f) { return f.join(': '); }).join('\n') + '\n\n' + aviso);
        if (!ok) return;
        btn.disabled = true;
        rep.saving = true;
        try {
            var sb = await getClient();
            var hoy = todayIso();
            var sello = Date.now();
            var rows = grupos.map(function (g, i) {
                return {
                    numero: REPORTE + (g.no_empleado || 'SIN') + '-' + (g.turno || 'SIN') + '-' + sello + '-' + (i + 1),
                    fecha_oficio: hoy,
                    periodo: rep.periodo + '-01',
                    datos: {},
                    secciones: { reporte: true, no_empleado: g.no_empleado, turno: g.turno, fecha: hoy, periodo: rep.periodo, desde: rango.start, hasta: rango.end, guardado_en: new Date().toISOString(), hallazgos: g.hallazgos.map(pickHallazgo) },
                    created_by: actor(),
                    updated_by: actor(),
                    updated_at: new Date().toISOString()
                };
            });
            var res = await sb.from(T_OFICIOS).insert(rows).select('id');
            if (res.error) throw res.error;
            det.forEach(function (h) { state.archivados[h.id] = true; });
            rep.saving = false;
            renderReport();
            repStatus('<i class="fas fa-check-circle me-1"></i>Reporte guardado: ' + grupos.map(function (g) { return '<b>' + esc(grupoLabel(g.no_empleado, g.turno)) + '</b> (' + g.hallazgos.length + ')'; }).join(', ') +
                '. Lo encuentras en <b>Formatos guardados</b>; <b>Hallazgos detectados</b> quedó limpio.', 'success');
        } catch (error) {
            repStatus('No se pudo guardar el reporte: ' + esc(error && error.message ? error.message : error), 'danger');
        } finally {
            rep.saving = false;
            btn.disabled = false;
        }
    }

    // Documento del reporte guardado, con el estatus actual de cada hallazgo.
    function buildReporteDoc(o, mode) {
        var s = o.secciones || {};
        var byId = {};
        state.hallazgos.forEach(function (h) { byId[h.id] = h; });
        var rows = (s.hallazgos || []).map(function (x) { return byId[x.id] ? pickHallazgo(byId[x.id]) : x; });
        var logo = new URL('images/aifa-logo.png', document.baseURI).href;
        var foto = function (url) { return url ? '<img src="' + esc(url) + '" alt="Evidencia"' + (mode === 'word' ? ' width="140" height="84"' : '') + '>' : '<span class="sin">—</span>'; };
        var css = '@page{size:letter landscape;margin:1.4cm;}body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:10.5pt;color:#111;margin:0;}' +
            '.head{display:flex;align-items:center;gap:16px;margin-bottom:10px;}.head img{width:3.6cm;}h1{font-size:14pt;margin:0;}.sub{color:#334155;margin-top:4px;}' +
            'table{width:100%;border-collapse:collapse;margin-top:10px;}th,td{border:1px solid #222;padding:4px 6px;vertical-align:middle;}th{font-size:9pt;text-transform:uppercase;}' +
            'tr{page-break-inside:avoid;}td img{width:3.6cm;height:2.2cm;object-fit:cover;display:block;margin:auto;}.c{text-align:center;}.sin{color:#666;}';
        var body = '<div class="head"><img src="' + esc(logo) + '" alt="AIFA"' + (mode === 'word' ? ' width="136"' : '') + '><div><h1>Reporte de hallazgos del Edificio Terminal</h1>' +
            '<div class="sub"><b>' + esc(grupoLabel(s.no_empleado, s.turno)) + '</b> · Guardado el ' + fmtDate(s.fecha || o.fecha_oficio) + ' · Periodo ' + (s.desde && s.hasta ? rangoText({ start: s.desde, end: s.hasta }) : periodText(s.periodo || String(o.periodo).slice(0, 7))) + '</div></div></div>' +
            '<table><thead><tr><th>No.</th><th>Fecha de reporte</th><th>Ubicación de incidencia</th><th>Descripción de incidencia</th><th>Evidencia fotográfica</th><th>Estatus</th><th>Fecha de solución</th><th>Evidencia solucionada</th></tr></thead><tbody>' +
            (rows.length ? rows.map(function (h, i) {
                var sol = h.estatus === 'SOLUCIONADO';
                return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + fmtDate(h.fecha_reporte) + '</td><td class="c">' + ubicacionLines(h) + '</td><td>' + esc(h.descripcion) + '</td>' +
                    '<td class="c">' + foto(h.evidencia_url) + '</td><td class="c">' + (sol ? 'Solucionado' : 'Pendiente') + '</td>' +
                    '<td class="c">' + (sol ? fmtDate(h.fecha_solucion) : '—') + '</td><td class="c">' + (sol ? foto(h.evidencia_solucion_url) : '—') + '</td></tr>';
            }).join('') : '<tr><td colspan="8" class="c">Sin hallazgos.</td></tr>') + '</tbody></table>';
        var title = 'Reporte de hallazgos · ' + grupoLabel(s.no_empleado, s.turno) + ' · ' + fmtDate(s.fecha || o.fecha_oficio);
        return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body>' + body + '</body></html>';
    }

    async function descargarReporte(id, format, win) {
        var o = await getOficio(id);
        try { await loadHallazgos(); } catch (_) { /* se imprime como se guardó */ }
        if (format === 'word') {
            var blob = new Blob(['﻿', buildReporteDoc(o, 'word')], { type: 'application/msword' });
            var s = o.secciones || {};
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = ('Reporte_hallazgos_' + grupoLabel(s.no_empleado, s.turno) + '_' + (s.fecha || '')).replace(/[^\w-]+/g, '_') + '.doc';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } else {
            printDocument(buildReporteDoc(o, 'print'), win);
        }
    }

    function bindReport(el) {
        el.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-rep]');
            if (!btn) return;
            var act = btn.getAttribute('data-rep');
            var id = btn.getAttribute('data-id');
            // Mientras se guarda un renglón no se cambia la tabla (el guardado la vuelve a dibujar).
            if (rep.saving) return;
            if (act === 'generar') {
                if (rep.editing) return repStatus('Guarda o cancela el hallazgo en edición antes de generar el formato.', 'warning');
                open({ periodo: rep.periodo, step: 'preview' });
            } else if (act === 'guardados') {
                if (rep.editing) return repStatus('Guarda o cancela el hallazgo en edición antes de abrir los formatos guardados.', 'warning');
                abrirGuardados();
            } else if (act === 'add') repStartEdit('new:detectados', false);
            else if (act === 'add-grupo') repStartEdit('new:' + btn.getAttribute('data-kind'), false);
            else if (act === 'edit') repStartEdit(id, false, btn.getAttribute('data-kind'));
            else if (act === 'solve' && rep.editing) repStatus('Guarda o cancela el hallazgo en edición antes de solucionar otro.', 'warning');
            else if (act === 'solve') repTomarFotoSolucion(id);
            else if (act === 'confirm' && rep.editing) repStatus('Guarda o cancela el hallazgo en edición antes de confirmar otro.', 'warning');
            else if (act === 'confirm') confirmarEstatus(id, function () { repStatus(''); renderReport(); }, function (msg) { repStatus(msg, 'danger'); });
            else if (act === 'delete') repDelete(id);
            else if (act === 'cancel') repCancel();
            else if (act === 'save') repSave(btn.closest('tr'));
        });
        el.addEventListener('change', function (e) {
            var t = e.target;
            if (t.id === 'setp-rep-sol-file') {
                var foto = t.files && t.files[0];
                var hid = rep.solveId;
                rep.solveId = null;
                t.value = '';
                if (foto && hid) repSolucionar(hid, foto);
            } else if (t.id === 'setp-rep-desde' || t.id === 'setp-rep-hasta') {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(t.value)) return;
                var esDesde = t.id === 'setp-rep-desde';
                if (esDesde) rep.desde = t.value; else rep.hasta = t.value;
                // Si las fechas quedan al revés, la otra se iguala a la elegida.
                if (rep.desde > rep.hasta) { if (esDesde) rep.hasta = rep.desde; else rep.desde = rep.hasta; }
                rep.periodo = rep.desde.slice(0, 7);
                rep.editing = null;
                repStatus('');
                renderReport();
            } else if (t.matches('[data-f="estatus"]')) {
                var row = t.closest('tr');
                var on = t.value === 'SOLUCIONADO';
                var fsol = row.querySelector('[data-f="fsol"]');
                fsol.disabled = !on;
                if (on && !fsol.value) fsol.value = todayIso();
                var file = row.querySelector('[data-file="solucion"]');
                file.disabled = !on;
                file.closest('label').classList.toggle('is-disabled', !on);
                // Al marcarlo Solucionado se abre la cámara para la foto de la solución.
                var prevH = state.hallazgos.find(function (x) { return x.id === rep.editing; });
                if (on && !rep.files.solucion && !(prevH && prevH.evidencia_solucion_url)) file.click();
            } else if (t.matches('[data-file]')) {
                var f = t.files && t.files[0];
                if (!f) return;
                rep.files[t.getAttribute('data-file')] = f;
                var label = t.closest('label');
                var holder = label.querySelector('.setp-rep-thumb, .setp-rep-nothumb');
                var img = document.createElement('img');
                img.className = 'setp-rep-thumb';
                img.alt = label.getAttribute('title');
                img.src = URL.createObjectURL(f);
                holder.replaceWith(img);
            }
        });
    }

    // Monta (o recarga) la tabla de reporte dentro del contenedor indicado.
    async function mountReport(container) {
        if (!container) return;
        if (rep.el !== container) {
            ensureReportStyles();
            rep.el = container;
            // Por defecto, del 01 al último día del mes en curso.
            if (!rep.desde) repPonerMes(todayIso().slice(0, 7));
            container.innerHTML = repShell();
            bindReport(container);
        }
        if (rep.editing) return;
        $('setp-rep-table').innerHTML = '<tbody><tr><td class="setp-empty"><span class="spinner-border spinner-border-sm me-2"></span>Cargando hallazgos…</td></tr></tbody>';
        await loadHallazgos();
        renderReport();
    }

    // ---------- API pública ----------

    // opts.periodo ('YYYY-MM') y opts.step ('hallazgos' | 'datos' | 'preview') son opcionales.
    async function open(opts) {
        opts = opts || {};
        ensureModal();
        setStatus('');
        $('setp-fmt-form-card').classList.add('d-none');
        resetForm();
        // opts.borrador: formato guardado al finalizar el recorrido ("Formatos guardados").
        state.borrador = opts.borrador || null;
        $('setp-fmt-title').innerHTML = '<i class="fas fa-file-signature me-2 text-primary"></i>' + (state.borrador
            ? 'Formato de ' + esc(nombreSupervisor(state.borrador.no_empleado)) + ' · ' + fmtDate(state.borrador.fecha)
            : 'Crear formato de hallazgos');
        if (state.borrador) opts.periodo = state.borrador.periodo;
        // Por defecto se reporta el mes en curso (el seguimiento sigue siendo el mes anterior).
        state.periodo = /^\d{4}-\d{2}$/.test(opts.periodo || '') ? opts.periodo : todayIso().slice(0, 7);
        $('setp-fmt-periodo').value = state.periodo;
        showStep('hallazgos');
        $('setp-fmt-lists').innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Cargando hallazgos…</div>';
        state.modal = bootstrap.Modal.getOrCreateInstance($(MODAL_ID));
        state.modal.show();
        await loadHallazgos();
        state.lastOficio = null;
        if (state.store === 'db') {
            try { await loadLastOficio(); } catch (_) { /* sin oficios previos: se usan los datos por defecto */ }
        } else {
            setStatus('Las tablas de Supabase aún no están disponibles: el formato se genera con los hallazgos guardados en este navegador. Puedes descargarlo en Word o imprimirlo; para guardarlo en <b>Descargar formatos</b> aplica <code>db/create_setp_formatos.sql</code>.', 'info');
        }
        // Guardar formato requiere la tabla setp_oficios.
        $('setp-fmt-save-oficio').classList.toggle('d-none', !(canEdit() && state.store === 'db'));
        fillDatos();
        renderLists();
        if (opts.step && opts.step !== 'hallazgos') showStep(opts.step);
        if (state.borrador) {
            setStatus('Captura el <b>No. de oficio</b> y revisa los datos; en <b>3. Vista previa</b> puedes imprimirlo, descargarlo en Word y guardarlo. Los hallazgos salen con su estatus actual.', 'info');
            $('setp-fmt-d-numero').focus();
        }
    }

    // ---------- Formatos guardados ----------
    // Por generar: los guardados al finalizar el recorrido (sin No. de oficio).
    // Generados: los formatos con No. de oficio; se imprimen con el estatus actual.

    const GUARDADOS_ID = 'setp-guardados-modal';

    function ensureGuardados() {
        if ($(GUARDADOS_ID)) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = [
            '<div class="modal fade" id="' + GUARDADOS_ID + '" tabindex="-1" aria-labelledby="setp-guardados-title" aria-hidden="true">',
            ' <div class="modal-dialog modal-lg modal-dialog-scrollable">',
            '  <div class="modal-content">',
            '   <div class="modal-header">',
            '    <h5 class="modal-title fw-bold" id="setp-guardados-title"><i class="fas fa-folder-open me-2 text-success"></i>Formatos guardados</h5>',
            '    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>',
            '   </div>',
            '   <div class="modal-body" id="setp-guardados-body"></div>',
            '  </div>',
            ' </div>',
            '</div>'
        ].join('');
        document.body.appendChild(wrap.firstChild);
        var style = document.createElement('style');
        style.textContent = [
            '#' + GUARDADOS_ID + ' .setp-g-sec{font-size:.72rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#475569;margin:4px 0 8px;}',
            '#' + GUARDADOS_ID + ' .setp-g-list{list-style:none;margin:0 0 18px;padding:0;border:1px solid #e2e8f0;border-radius:12px;}',
            '#' + GUARDADOS_ID + ' .setp-g-list li{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;}',
            '#' + GUARDADOS_ID + ' .setp-g-list li:last-child{border-bottom:0;}',
            '#' + GUARDADOS_ID + ' .setp-g-main{flex:1;min-width:200px;}',
            '#' + GUARDADOS_ID + ' .setp-g-name{font-weight:700;color:#0f172a;font-size:.9rem;}',
            '#' + GUARDADOS_ID + ' .setp-g-sub{font-size:.78rem;color:#64748b;}',
            '#' + GUARDADOS_ID + ' .setp-g-empty{padding:12px 14px;color:#64748b;font-size:.84rem;}',
            'body.dark-mode #' + GUARDADOS_ID + ' .setp-g-sec{color:#c3c9d2;}',
            'body.dark-mode #' + GUARDADOS_ID + ' .setp-g-list,body.dark-mode #' + GUARDADOS_ID + ' .setp-g-list li{border-color:var(--border-color);}',
            'body.dark-mode #' + GUARDADOS_ID + ' .setp-g-name{color:var(--text-color);}',
            'body.dark-mode #' + GUARDADOS_ID + ' .setp-g-sub,body.dark-mode #' + GUARDADOS_ID + ' .setp-g-empty{color:var(--text-muted-color);}'
        ].join('');
        document.head.appendChild(style);
        $('setp-guardados-body').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-g]');
            if (!btn || btn.disabled) return;
            var act = btn.getAttribute('data-g');
            var id = btn.getAttribute('data-id');
            if (act === 'generar') {
                var b = (state.guardados || []).find(function (x) { return x.id === id; });
                if (!b) return;
                // El formato se abre cuando esta ventana termina de cerrarse.
                $(GUARDADOS_ID).addEventListener('hidden.bs.modal', function () { open({ borrador: b, step: 'datos' }); }, { once: true });
                bootstrap.Modal.getOrCreateInstance($(GUARDADOS_ID)).hide();
            } else if (act === 'eliminar') {
                eliminarGuardado(btn, btn.getAttribute('data-kind'), id, btn.getAttribute('data-label'));
            } else if (act === 'pdf' || act === 'word' || act === 'rep-pdf' || act === 'rep-word') {
                btn.disabled = true;
                var esRep = act.indexOf('rep-') === 0;
                var formato = esRep ? act.slice(4) : act;
                var win = null;
                if (formato === 'pdf') {
                    win = window.open('', '_blank');
                    if (win) win.document.write('<p style="font-family:Arial,sans-serif;padding:24px;color:#475569">Preparando el formato…</p>');
                }
                (esRep ? descargarReporte(id, formato, win) : downloadSaved(id, formato, win)).catch(function (error) {
                    if (win && !win.closed) win.close();
                    guardadosStatus('No se pudo abrir el formato: ' + esc(error && error.message ? error.message : error), 'danger');
                }).finally(function () { btn.disabled = false; });
            }
        });
    }

    function esSuperadminFmt() {
        try { return sessionStorage.getItem('user_role') === 'superadmin'; } catch (_) { return false; }
    }

    // Sólo superadmin: elimina un registro de "Formatos guardados" (pruebas).
    // Sólo borra el registro de setp_oficios: los hallazgos, sus fotos y los
    // recorridos se quedan.
    async function eliminarGuardado(btn, kind, id, label) {
        if (!esSuperadminFmt() || !id) return;
        var tipos = {
            borrador: { titulo: '¿Eliminar este formato por generar?', aviso: 'Sólo se quita de "Por generar". Los recorridos y hallazgos no se borran. Si el usuario finaliza otro recorrido ese mismo día, se vuelve a crear.' },
            formato: { titulo: '¿Eliminar este formato generado?', aviso: 'Los hallazgos y sus fotos no se borran. Sus recorridos vuelven a aparecer en "Supervisor por turno" para salir en otro formato.' },
            reporte: { titulo: '¿Eliminar este reporte de hallazgos?', aviso: 'Los hallazgos y sus fotos no se borran: vuelven a aparecer en "Hallazgos detectados".' }
        };
        var t = tipos[kind] || tipos.formato;
        var rec = window.setpRecorridos;
        var ok = rec && rec.confirmar
            ? await rec.confirmar({ kicker: 'Formatos guardados · sólo superadmin', titulo: t.titulo, filas: [['Registro', label || '']], aviso: t.aviso + ' Esta acción no se puede deshacer.', boton: 'Eliminar' })
            : window.confirm(t.titulo + '\n\n' + (label || '') + '\n\n' + t.aviso);
        if (!ok) return;
        btn.disabled = true;
        try {
            var sb = await getClient();
            var res = await sb.from(T_OFICIOS).delete().eq('id', id).select('id');
            if (res.error) throw res.error;
            if (!res.data || !res.data.length) throw new Error('Supabase no permitió eliminarlo (revisa los permisos de setp_oficios).');
            // Sus recorridos vuelven a la tabla (ya no están en un formato).
            if (kind === 'formato' && rec && rec.mount) {
                var wrap = document.getElementById('setp-recorridos-wrap');
                if (wrap) await rec.mount(wrap);
            }
            await abrirGuardados();
            if (rep.el) renderReport();
            guardadosStatus('<i class="fas fa-check-circle me-1"></i><b>' + esc(label || 'Registro') + '</b> eliminado.', 'success');
        } catch (error) {
            btn.disabled = false;
            guardadosStatus('No se pudo eliminar: ' + esc(error && error.message ? error.message : error), 'danger');
        }
    }

    function guardadosStatus(message, type) {
        var box = $('setp-guardados-status');
        if (!box) return;
        box.className = message ? 'alert alert-' + (type || 'info') + ' py-2 small mb-3' : 'd-none';
        box.innerHTML = message || '';
    }

    async function abrirGuardados() {
        ensureGuardados();
        var body = $('setp-guardados-body');
        body.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Cargando formatos…</div>';
        bootstrap.Modal.getOrCreateInstance($(GUARDADOS_ID)).show();
        var data;
        try {
            data = await listGuardados();
            await loadHallazgos();
        } catch (error) {
            body.innerHTML = '<div class="alert alert-warning small mb-0">Formatos no disponibles: ' + esc(error && error.message ? error.message : error) + '</div>';
            return;
        }
        var rec = window.setpRecorridos;
        var existe = {};
        ((rec && rec.recorridos()) || []).forEach(function (r) { existe[r.id] = true; });
        // Sólo los recorridos que siguen existiendo y aún no salen en un formato.
        var vigente = function (id) { return existe[id] && !(rec.enFormato && rec.enFormato(id)); };
        data.borradores.forEach(function (b) { b.recorridos = b.recorridos.filter(vigente); });
        var borradores = data.borradores.filter(function (b) { return b.recorridos.length; });
        state.guardados = borradores;
        var puede = canEdit();
        // Eliminar (pruebas): sólo superadmin.
        var sa = esSuperadminFmt();
        var delBtn = function (kind, id, label) {
            return sa ? '<button type="button" class="btn btn-sm btn-outline-danger" data-g="eliminar" data-kind="' + kind + '" data-id="' + esc(id) + '" data-label="' + esc(label) + '"' +
                ' title="Eliminar (sólo superadmin)" aria-label="Eliminar ' + esc(label) + '"><i class="fas fa-trash-alt"></i></button>' : '';
        };
        var porGenerar = borradores.length ? borradores.map(function (b) {
            var n = hallazgosDeBorrador(b).length;
            return '<li><div class="setp-g-main"><div class="setp-g-name">' + esc(nombreSupervisor(b.no_empleado)) + ' · ' + fmtDate(b.fecha) + '</div>' +
                '<div class="setp-g-sub">' + b.recorridos.length + (b.recorridos.length === 1 ? ' recorrido' : ' recorridos') + ' · ' +
                n + (n === 1 ? ' hallazgo detectado' : ' hallazgos detectados') + ' · Sin No. de oficio</div></div>' +
                (puede
                    ? '<button type="button" class="btn btn-sm btn-success" data-g="generar" data-id="' + esc(b.id) + '"><i class="fas fa-file-signature me-1"></i>Generar formato</button>'
                    : '<span class="small text-muted">Un usuario editor captura su No. de oficio</span>') +
                delBtn('borrador', b.id, nombreSupervisor(b.no_empleado) + ' · ' + fmtDate(b.fecha)) +
                '</li>';
        }).join('') : '<li class="setp-g-empty">No hay formatos por generar. Se agregan aquí al presionar <b>Finalizar recorrido</b>.</li>';
        var generados = data.formatos.length ? data.formatos.map(function (o) {
            var ym = String(o.periodo).slice(0, 7);
            return '<li><div class="setp-g-main"><div class="setp-g-name">' + esc(o.numero) + '</div>' +
                '<div class="setp-g-sub">Periodo ' + MONTH_ABBR[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4) + ' · Oficio del ' + fmtDate(o.fecha_oficio) + '</div></div>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" data-g="pdf" data-id="' + esc(o.id) + '"><i class="fas fa-file-pdf me-1"></i>Imprimir / PDF</button>' +
                '<button type="button" class="btn btn-sm btn-outline-primary" data-g="word" data-id="' + esc(o.id) + '"><i class="fas fa-file-word me-1"></i>Word</button>' +
                delBtn('formato', o.id, o.numero) + '</li>';
        }).join('') : '<li class="setp-g-empty">Aún no hay formatos generados.</li>';
        var reportes = data.reportes.length ? data.reportes.map(function (o) {
            var s = o.secciones || {};
            var n = (s.hallazgos || []).length;
            var hora = s.guardado_en ? new Date(s.guardado_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            return '<li><div class="setp-g-main"><div class="setp-g-name">' + esc(grupoLabel(s.no_empleado, s.turno)) + '</div>' +
                '<div class="setp-g-sub">Guardado el ' + fmtDate(s.fecha || o.fecha_oficio) + (hora ? ' · ' + esc(hora) + ' hrs' : '') + ' · ' + n + (n === 1 ? ' hallazgo' : ' hallazgos') + '</div></div>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" data-g="rep-pdf" data-id="' + esc(o.id) + '"><i class="fas fa-file-pdf me-1"></i>Imprimir / PDF</button>' +
                '<button type="button" class="btn btn-sm btn-outline-primary" data-g="rep-word" data-id="' + esc(o.id) + '"><i class="fas fa-file-word me-1"></i>Word</button>' +
                delBtn('reporte', o.id, grupoLabel(s.no_empleado, s.turno) + ' · ' + fmtDate(s.fecha || o.fecha_oficio) + (hora ? ' ' + hora : '')) + '</li>';
        }).join('') : '<li class="setp-g-empty">Aún no hay reportes guardados.</li>';
        body.innerHTML = '<div id="setp-guardados-status" class="d-none"></div>' +
            '<div class="setp-g-sec">Por generar <span class="text-muted fw-normal text-lowercase">(guardados al finalizar el recorrido)</span></div><ul class="setp-g-list">' + porGenerar + '</ul>' +
            '<div class="setp-g-sec">Generados <span class="text-muted fw-normal text-lowercase">(se imprimen con el estatus actual de cada hallazgo)</span></div><ul class="setp-g-list">' + generados + '</ul>' +
            '<div class="setp-g-sec">Reportes de hallazgos <span class="text-muted fw-normal text-lowercase">(por usuario y turno, con el estatus actual)</span></div><ul class="setp-g-list">' + reportes + '</ul>';
    }

    // Llena el menú "Descargar formatos" con los oficios guardados.
    async function renderSavedMenu(container) {
        container.innerHTML = '<li><span class="dropdown-item-text small text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Cargando…</span></li>';
        try {
            var list = await listOficios();
            if (!list.length) {
                container.innerHTML = '<li><span class="dropdown-item-text small text-muted">Aún no hay formatos guardados.</span></li>';
                return;
            }
            container.innerHTML = list.map(function (o) {
                var ym = String(o.periodo).slice(0, 7);
                var label = esc(o.numero) + ' <span class="text-muted small">· ' + MONTH_ABBR[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4) + '</span>';
                return '<li class="d-flex align-items-center gap-1 px-2">' +
                    '<button type="button" class="dropdown-item rounded flex-grow-1" data-oficio="' + esc(o.id) + '" data-format="pdf" title="Imprimir / PDF"><i class="fas fa-file-pdf text-danger me-2"></i>' + label + '</button>' +
                    '<button type="button" class="btn btn-sm btn-link text-primary p-1" data-oficio="' + esc(o.id) + '" data-format="word" title="Descargar Word" aria-label="Descargar ' + esc(o.numero) + ' en Word"><i class="fas fa-file-word"></i></button></li>';
            }).join('');
        } catch (error) {
            container.innerHTML = '<li><span class="dropdown-item-text small text-muted">Formatos no disponibles: aplica <code>db/create_setp_formatos.sql</code>.</span></li>';
        }
    }

    // win: ventana de impresión abierta en el clic (si no, el navegador la bloquea tras la espera).
    async function downloadSaved(id, format, win) {
        var o = await getOficio(id);
        var datos = o.datos || {};
        var secciones = o.secciones || { periodo: String(o.periodo).slice(0, 7), detectados: [], solucionados: [], pendientes: [] };
        // Se imprime con el estatus actual de cada hallazgo (seguimiento).
        try {
            await loadHallazgos();
            if (state.store === 'db') secciones = seccionesActuales(secciones, String(o.periodo).slice(0, 7));
        } catch (_) { /* sin conexión: se imprime como se guardó */ }
        if (format === 'word') downloadWord(datos, secciones);
        else printDocument(buildDocument(datos, secciones, 'print'), win);
    }

    // Al cambiar de supervisor en el filtro, el reporte muestra sólo los suyos.
    document.addEventListener('setp:supervisor-elegido', function () {
        if (!rep.el || rep.saving) return;
        rep.editing = null;
        rep.solving = false;
        rep.files = { evidencia: null, solucion: null };
        repStatus('');
        renderReport();
    });
    // Si cambia su No. de empleado, sus hallazgos lo siguen en la base: se recargan.
    document.addEventListener('setp:supervisor-editado', function () {
        if (rep.el && !rep.editing) mountReport(rep.el);
    });

    window.setpFormato = {
        open: open,
        mountReport: mountReport,
        // Recarga la tabla de reporte (p. ej. tras un hallazgo creado desde
        // Supervisor × turno). fecha: 'YYYY-MM-DD' o 'YYYY-MM'; si queda fuera
        // del periodo elegido, se muestra su mes completo. No interrumpe una captura en curso.
        reloadReport: function (fecha) {
            if (!rep.el || rep.editing) return Promise.resolve();
            fecha = String(fecha || '');
            if (/^\d{4}-\d{2}(-\d{2})?$/.test(fecha)) {
                var r = fecha.length === 10 ? { start: fecha, end: fecha } : monthRange(fecha);
                if (!rep.desde || r.end < rep.desde || r.start > rep.hasta) repPonerMes(fecha.slice(0, 7));
            }
            repStatus('');
            return mountReport(rep.el);
        },
        renderSavedMenu: renderSavedMenu,
        downloadSaved: downloadSaved,
        // Formato del usuario guardado al finalizar el recorrido (js/setp-recorridos.js).
        guardarBorrador: guardarBorrador,
        abrirGuardados: abrirGuardados,
        // expuesto para pruebas
        _computeSections: computeSections,
        _buildDocument: buildDocument
    };
})();
