(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SeguimientoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /* Seguimiento · Dirección de Operación — reglas sin interfaz.

       Todo lo que decide algo (qué está vencido, qué sigue en una renovación,
       cómo se agrupa, qué se le escribe al responsable por WhatsApp) vive aquí,
       sin tocar el DOM ni Supabase, para poder probarlo solo. js/seguimiento.js
       sólo pinta y guarda. */

    /* ---------- Catálogos ---------- */

    // Las subdirecciones de la Dirección de Operación. "DO" es la propia
    // Dirección: Coord. Auditoría, GPyC y Archivo le reportan directo.
    const SUBDIRECCIONES = Object.freeze([
        { clave: 'SSO', nombre: 'Subdirección de Seguridad Operacional', corto: 'Seguridad Operacional', icono: 'plane-departure', color: '#2563eb',
          gerencias: ['Gerencia de Operaciones Parte Aeronáutica', 'Gerencia de Operaciones Edificio Terminal', 'Gerencia de Seguridad Operacional', 'Gerencia de Servicios Médicos'] },
        { clave: 'SSA', nombre: 'Subdirección de Seguridad de la Aviación', corto: 'Seguridad de la Aviación', icono: 'user-shield', color: '#7c3aed',
          gerencias: ['Gerencia de Seguridad', 'Gerencia de Identificación Aeroportuaria', 'Gerencia de Programas de Seguridad', 'Gerencia de Protección Civil'] },
        { clave: 'SSC', nombre: 'Subdirección de Servicios Conexos', corto: 'Servicios Conexos', icono: 'truck-ramp-box', color: '#ea580c',
          gerencias: ['Gerencia de Carga', 'Gerencia de Combustibles', 'Gerencia de Aviación General'] },
        { clave: 'SI', nombre: 'Subdirección de Ingeniería', corto: 'Ingeniería', icono: 'helmet-safety', color: '#16a34a',
          gerencias: ['Gerencia de Ingeniería Civil', 'Gerencia de Ingeniería Electromecánica', 'Gerencia de Operación y Mantenimiento de Instalaciones Hidráulicas'] },
        { clave: 'SGE', nombre: 'Subdirección de Gestión Energética', corto: 'Gestión Energética', icono: 'bolt', color: '#ca8a04',
          gerencias: ['Gerencia de Generación', 'Gerencia de Transformación y Distribución'] },
        { clave: 'DO', nombre: 'Dirección de Operación', corto: 'Dirección (staff)', icono: 'sitemap', color: '#334155',
          gerencias: ['Coordinación de Auditoría', 'Gerencia de Proyectos y Concursos', 'Archivo'] },
    ]);

    // En el orden en que avanza una tarea. "cancelada" queda al final y fuera
    // de los conteos de pendientes. "por_validar": quien la hizo la entregó y
    // falta que el Director (admin de Seguimiento) la valide para darla por
    // terminada (db/seguimiento_validacion.sql).
    const ESTATUS = Object.freeze([
        { clave: 'pendiente',   nombre: 'Pendiente',   color: '#64748b', icono: 'circle' },
        { clave: 'en_proceso',  nombre: 'En proceso',  color: '#2563eb', icono: 'circle-half-stroke' },
        { clave: 'en_revision', nombre: 'En revisión', color: '#9333ea', icono: 'magnifying-glass' },
        { clave: 'detenida',    nombre: 'Detenida',    color: '#ea580c', icono: 'circle-pause' },
        { clave: 'por_validar', nombre: 'Por validar', color: '#0891b2', icono: 'stamp' },
        { clave: 'completada',  nombre: 'Completada',  color: '#16a34a', icono: 'circle-check' },
        { clave: 'cancelada',   nombre: 'Cancelada',   color: '#94a3b8', icono: 'circle-xmark' },
    ]);

    const PRIORIDADES = Object.freeze([
        { clave: 'urgente', nombre: 'Urgente', color: '#dc2626', peso: 0 },
        { clave: 'alta',    nombre: 'Alta',    color: '#f59e0b', peso: 1 },
        { clave: 'normal',  nombre: 'Normal',  color: '#3b82f6', peso: 2 },
        { clave: 'baja',    nombre: 'Baja',    color: '#94a3b8', peso: 3 },
    ]);

    const TIPOS = Object.freeze([
        { clave: 'orden',       nombre: 'Orden',                 icono: 'bullhorn' },
        { clave: 'renovacion',  nombre: 'Renovación',            icono: 'rotate' },
        { clave: 'certificado', nombre: 'Certificado / licencia', icono: 'certificate' },
        { clave: 'compromiso',  nombre: 'Compromiso de reunión', icono: 'handshake' },
        { clave: 'tarea',       nombre: 'Tarea',                 icono: 'square-check' },
    ]);

    // Las de días (diaria, de lunes a viernes, semanal) son para las rutinas de
    // Diarias; las de meses, para renovaciones y certificados.
    const RECURRENCIAS = Object.freeze([
        { clave: 'ninguna',    nombre: 'No se repite', meses: 0 },
        { clave: 'diaria',     nombre: 'Cada día',        meses: 0, dias: 1 },
        { clave: 'laborable',  nombre: 'Lunes a viernes', meses: 0, dias: 1, laborable: true },
        { clave: 'semanal',    nombre: 'Cada semana',     meses: 0, dias: 7 },
        { clave: 'mensual',    nombre: 'Cada mes',     meses: 1 },
        { clave: 'bimestral',  nombre: 'Cada 2 meses', meses: 2 },
        { clave: 'trimestral', nombre: 'Cada 3 meses', meses: 3 },
        { clave: 'semestral',  nombre: 'Cada 6 meses', meses: 6 },
        { clave: 'anual',      nombre: 'Cada año',     meses: 12 },
        { clave: 'bienal',     nombre: 'Cada 2 años',  meses: 24 },
    ]);
    // Cada cuántos meses lo escribe la persona (18 meses, 3 años…): se guarda
    // en recurrencia_meses. No va en RECURRENCIAS porque no es una opción fija.
    const PERSONALIZADA = 'personalizada';
    const MAX_MESES = 240;

    /* Dos espacios: Diarias (el día a día y las rutinas) y Agenda (lo que tiene
       fecha y seguimiento formal: órdenes, compromisos, renovaciones). Lo que no
       trae espacio es de Agenda. */
    const CLASES = Object.freeze([
        { clave: 'diaria', nombre: 'Diarias', icono: 'sun', ayuda: 'El día a día: pendientes cortos y rutinas que se repiten.' },
        { clave: 'agenda', nombre: 'Agenda', icono: 'calendar-days', ayuda: 'Órdenes, compromisos y renovaciones con fecha y seguimiento formal.' },
    ]);
    const claseDe = t => (t && t.clase === 'diaria' ? 'diaria' : 'agenda');

    const AGRUPACIONES = Object.freeze([
        { clave: 'subdireccion', nombre: 'Subdirección' },
        { clave: 'estatus',      nombre: 'Estatus' },
        { clave: 'responsable',  nombre: 'Responsable' },
        { clave: 'prioridad',    nombre: 'Prioridad' },
        { clave: 'tipo',         nombre: 'Tipo' },
        { clave: 'vencimiento',  nombre: 'Vencimiento' },
        { clave: 'ninguno',      nombre: 'Sin agrupar' },
    ]);

    const porClave = lista => Object.freeze(Object.fromEntries(lista.map(x => [x.clave, x])));
    const SUBDIR = porClave(SUBDIRECCIONES);
    const EST = porClave(ESTATUS);
    const PRIO = porClave(PRIORIDADES);
    const TIPO = porClave(TIPOS);
    const RECU = Object.freeze(Object.assign({}, porClave(RECURRENCIAS),
        { [PERSONALIZADA]: { clave: PERSONALIZADA, nombre: 'Personalizado', meses: null } }));

    const ABIERTOS = Object.freeze(['pendiente', 'en_proceso', 'en_revision', 'detenida', 'por_validar']);
    const estaAbierta = t => ABIERTOS.includes(t && t.estatus);

    /* ---------- Fechas (siempre en días calendario, hora local) ---------- */

    const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    function aISO(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function hoyISO(ahora) { return aISO(ahora instanceof Date ? ahora : new Date()); }

    /** 'AAAA-MM-DD' (o un timestamp) → Date a mediodía local; null si no es fecha. */
    function deISO(valor) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor == null ? '' : valor));
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
        return d.getMonth() === +m[2] - 1 ? d : null;
    }

    /** Días de a → b (positivo si b es después). */
    function diasEntre(a, b) {
        const da = deISO(a), db = deISO(b);
        if (!da || !db) return null;
        return Math.round((db - da) / 86400000);
    }

    function sumarDias(iso, dias) {
        const d = deISO(iso);
        if (!d) return null;
        d.setDate(d.getDate() + dias);
        return aISO(d);
    }

    /** Suma meses sin desbordar: 31 ene + 1 mes = 28/29 feb, no 3 mar. */
    function sumarMeses(iso, meses) {
        const d = deISO(iso);
        if (!d) return null;
        const dia = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + meses);
        const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(dia, ultimo));
        return aISO(d);
    }

    function fechaCorta(iso) {
        const d = deISO(iso);
        if (!d) return '';
        return d.getDate() + ' ' + MESES_CORTOS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2);
    }

    function fechaLarga(iso) {
        const d = deISO(iso);
        if (!d) return '';
        return d.getDate() + ' de ' + MESES_LARGOS[d.getMonth()] + ' de ' + d.getFullYear();
    }

    /** "hoy", "mañana", "en 5 días", "ayer", "hace 3 días". */
    function relativo(iso, hoy) {
        const n = diasEntre(hoy, iso);
        if (n == null) return '';
        if (n === 0) return 'hoy';
        if (n === 1) return 'mañana';
        if (n === -1) return 'ayer';
        return n > 0 ? 'en ' + n + ' días' : 'hace ' + (-n) + ' días';
    }

    /* ---------- Vencimientos ---------- */

    /**
     * En qué situación está una tarea respecto a su fecha límite:
     *   completada · cancelada · por_validar · sin_fecha · vencida · vence_hoy · por_vencer · a_tiempo
     * "por_vencer" es dentro de los días de aviso de la propia tarea. Una tarea
     * entregada que espera validación ya no está «vencida»: el trabajo se hizo;
     * si fue tarde, lo dice el cumplimiento a tiempo.
     */
    function situacion(t, hoy) {
        if (!t) return 'sin_fecha';
        if (t.estatus === 'completada') return 'completada';
        if (t.estatus === 'cancelada') return 'cancelada';
        if (t.estatus === 'por_validar') return 'por_validar';
        const n = diasEntre(hoy, t.fecha_limite);
        if (n == null) return 'sin_fecha';
        if (n < 0) return 'vencida';
        if (n === 0) return 'vence_hoy';
        const aviso = Number.isFinite(+t.aviso_dias) ? +t.aviso_dias : 7;
        return n <= aviso ? 'por_vencer' : 'a_tiempo';
    }

    const SITUACIONES = Object.freeze({
        vencida:    { nombre: 'Vencidas',     color: '#dc2626', orden: 0 },
        vence_hoy:  { nombre: 'Vencen hoy',   color: '#ea580c', orden: 1 },
        por_vencer: { nombre: 'Por vencer',   color: '#d97706', orden: 2 },
        a_tiempo:   { nombre: 'A tiempo',     color: '#16a34a', orden: 3 },
        sin_fecha:  { nombre: 'Sin fecha',    color: '#64748b', orden: 4 },
        por_validar: { nombre: 'Por validar', color: '#0891b2', orden: 5 },
        completada: { nombre: 'Completadas',  color: '#16a34a', orden: 6 },
        cancelada:  { nombre: 'Canceladas',   color: '#94a3b8', orden: 7 },
    });

    /** ¿Se completó a tiempo? null si no está completada o no tenía fecha. Cuenta
        el día en que se entregó, no el de la validación: lo que tarde el visto
        bueno no es atraso de quien la hizo. */
    function completadaATiempo(t) {
        if (!t || t.estatus !== 'completada' || !t.fecha_limite) return null;
        const fin = t.entregada_en || t.completada_en;
        if (!fin) return null;
        const cierre = aISO(new Date(fin));
        return diasEntre(t.fecha_limite, cierre) <= 0;
    }

    /* ---------- Recurrencia ---------- */

    /**
     * La siguiente ocurrencia de una tarea recurrente, lista para insertarse, o
     * null si no se repite. Se cuenta desde la fecha límite anterior y no desde
     * el día en que se cerró: una licencia que se renovó tarde sigue venciendo
     * en su mismo ciclo.
     */
    /** Cada cuántos meses se repite una tarea (0 si no se repite). */
    function mesesRecurrencia(t) {
        if (!t || !t.recurrencia || t.recurrencia === 'ninguna') return 0;
        if (t.recurrencia === PERSONALIZADA) {
            const n = parseInt(t.recurrencia_meses, 10);
            return n >= 1 && n <= MAX_MESES ? n : 0;
        }
        return (RECU[t.recurrencia] || {}).meses || 0;
    }

    /** "Cada mes", "Cada 18 meses", "Cada 3 años"… */
    function textoCada(meses) {
        const n = parseInt(meses, 10) || 0;
        if (!n) return 'No se repite';
        if (n === 1) return 'Cada mes';
        if (n === 12) return 'Cada año';
        if (n % 12 === 0) return 'Cada ' + (n / 12) + ' años';
        return 'Cada ' + n + ' meses';
    }

    /** Cada cuántos días se repite una rutina (0 si no es por días). */
    function diasRecurrencia(t) { return (t && RECU[t.recurrencia] && RECU[t.recurrencia].dias) || 0; }

    /** ¿Se repite (por días o por meses)? */
    const seRepite = t => mesesRecurrencia(t) > 0 || diasRecurrencia(t) > 0;

    function nombreRecurrencia(t) {
        return diasRecurrencia(t) ? RECU[t.recurrencia].nombre : textoCada(mesesRecurrencia(t));
    }

    /** ¿Cae de lunes a viernes? */
    function esLaborable(iso) {
        const d = deISO(iso);
        return Boolean(d) && d.getDay() !== 0 && d.getDay() !== 6;
    }

    /**
     * La fecha límite de la siguiente ocurrencia, o null si no se repite.
     * Las de meses conservan su ciclo (una licencia renovada tarde sigue en su
     * mismo ciclo). Las rutinas por días avanzan hasta después de hoy: si una se
     * hizo tarde, la siguiente es mañana, no una fila de días atrasados.
     */
    function fechaSiguiente(t, hoy) {
        if (!t || !t.fecha_limite) return null;
        const r = RECU[t.recurrencia] || {};
        if (r.dias) {
            const tope = hoy && hoy > t.fecha_limite ? hoy : t.fecha_limite;
            let f = sumarDias(t.fecha_limite, r.dias);
            while (f <= tope) f = sumarDias(f, r.dias);
            if (r.laborable) while (!esLaborable(f)) f = sumarDias(f, 1);
            return f;
        }
        const meses = mesesRecurrencia(t);
        return meses ? sumarMeses(t.fecha_limite, meses) : null;
    }

    /** Lo que se guarda al elegir "cada N meses": la opción fija si existe, si no la personalizada. */
    function recurrenciaDeMeses(meses) {
        const n = parseInt(meses, 10) || 0;
        if (!n) return { recurrencia: 'ninguna', recurrencia_meses: null };
        const fija = RECURRENCIAS.find(r => r.meses === n);
        return fija ? { recurrencia: fija.clave, recurrencia_meses: null } : { recurrencia: PERSONALIZADA, recurrencia_meses: n };
    }

    function siguienteOcurrencia(t, hoy) {
        const meses = mesesRecurrencia(t);
        const limite = fechaSiguiente(t, hoy || hoyISO());
        if (!limite) return null;
        const duracion = t.fecha_inicio ? diasEntre(t.fecha_inicio, t.fecha_limite) : null;
        // Las subtareas con fecha se mueven igual que la tarea: conservan su
        // distancia en días a la fecha límite.
        const checklist = Array.isArray(t.checklist)
            ? t.checklist.map(i => Object.assign({ id: i.id, texto: i.texto, hecho: false },
                i.fecha_inicio ? { fecha_inicio: sumarDias(limite, -diasEntre(i.fecha_inicio, t.fecha_limite)) } : {},
                i.fecha ? { fecha: sumarDias(limite, -diasEntre(i.fecha, t.fecha_limite)) } : {}))
            : [];
        return {
            titulo: t.titulo,
            descripcion: t.descripcion || null,
            tipo: t.tipo,
            subdireccion: t.subdireccion,
            gerencia: t.gerencia || null,
            estatus: 'pendiente',
            prioridad: t.prioridad,
            responsable: t.responsable || null,
            responsable_num: t.responsable_num || null,
            responsable_tel: t.responsable_tel || null,
            fecha_inicio: duracion != null ? sumarDias(limite, -duracion) : null,
            fecha_limite: limite,
            recurrencia: t.recurrencia,
            ...(t.recurrencia === PERSONALIZADA ? { recurrencia_meses: meses } : {}),
            aviso_dias: t.aviso_dias,
            referencia: t.referencia || null,
            etiquetas: Array.isArray(t.etiquetas) ? t.etiquetas.slice() : [],
            checklist,
            tarea_origen: t.tarea_origen || t.id || null,
            // Sigue en su mismo espacio (sólo si la base ya tiene la columna).
            ...('clase' in t ? { clase: claseDe(t) } : {}),
        };
    }

    /* ---------- Buscar, filtrar, ordenar, agrupar ---------- */

    const normalizar = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

    function folio(n) { return n == null ? '' : 'SEG-' + String(n).padStart(4, '0'); }

    function textoBuscable(t) {
        return normalizar([
            t.titulo, t.descripcion, t.responsable, t.referencia, t.gerencia, folio(t.folio),
            SUBDIR[t.subdireccion] && SUBDIR[t.subdireccion].nombre,
            TIPO[t.tipo] && TIPO[t.tipo].nombre,
            (t.etiquetas || []).join(' '),
        ].filter(Boolean).join(' '));
    }

    /**
     * filtros: { texto, subdirecciones[], estatus[], prioridades[], tipos[],
     *            responsable, situacion, verCerradas }
     * Sin verCerradas se esconden las completadas y canceladas, como ClickUp.
     */
    function filtrar(tareas, filtros, hoy) {
        const f = filtros || {};
        const q = normalizar(f.texto);
        const en = (lista, v) => !lista || !lista.length || lista.includes(v);
        return (tareas || []).filter(t => {
            if (!f.verCerradas && !estaAbierta(t) && !(f.estatus && f.estatus.includes(t.estatus))) return false;
            if (!en(f.subdirecciones, t.subdireccion)) return false;
            if (!en(f.estatus, t.estatus)) return false;
            if (!en(f.prioridades, t.prioridad)) return false;
            if (!en(f.tipos, t.tipo)) return false;
            if (f.responsable && normalizar(t.responsable) !== normalizar(f.responsable)) return false;
            if (f.situacion) {
                const s = situacion(t, hoy);
                const quiere = f.situacion === 'por_vencer' ? ['por_vencer', 'vence_hoy'] : [f.situacion];
                if (!quiere.includes(s)) return false;
            }
            if (q && !q.split(/\s+/).every(p => textoBuscable(t).includes(p))) return false;
            return true;
        });
    }

    const pesoPrioridad = t => (PRIO[t.prioridad] ? PRIO[t.prioridad].peso : 9);

    /** Orden por defecto: lo abierto primero, luego por fecha límite (sin fecha al final) y prioridad. */
    function ordenar(tareas, campo, asc) {
        const dir = asc === false ? -1 : 1;
        const lista = (tareas || []).slice();
        const porFecha = (a, b) => {
            if (!a.fecha_limite && !b.fecha_limite) return 0;
            if (!a.fecha_limite) return 1;
            if (!b.fecha_limite) return -1;
            return a.fecha_limite < b.fecha_limite ? -1 : a.fecha_limite > b.fecha_limite ? 1 : 0;
        };
        const cmp = {
            fecha_limite: (a, b) => porFecha(a, b) * dir || pesoPrioridad(a) - pesoPrioridad(b),
            prioridad: (a, b) => (pesoPrioridad(a) - pesoPrioridad(b)) * dir || porFecha(a, b),
            titulo: (a, b) => normalizar(a.titulo).localeCompare(normalizar(b.titulo), 'es') * dir,
            responsable: (a, b) => normalizar(a.responsable || '~').localeCompare(normalizar(b.responsable || '~'), 'es') * dir || porFecha(a, b),
            estatus: (a, b) => (ESTATUS.findIndex(e => e.clave === a.estatus) - ESTATUS.findIndex(e => e.clave === b.estatus)) * dir || porFecha(a, b),
            folio: (a, b) => ((a.folio || 0) - (b.folio || 0)) * dir,
        }[campo] || ((a, b) => porFecha(a, b) || pesoPrioridad(a) - pesoPrioridad(b));
        return lista.sort((a, b) => (estaAbierta(b) - estaAbierta(a)) || cmp(a, b));
    }

    /**
     * Grupos para la vista de lista: [{ clave, nombre, color, icono, tareas }].
     * Las subdirecciones salen todas aunque estén vacías, para poder agregarles
     * una tarea desde su propio grupo; los demás criterios sólo con lo que hay.
     */
    function agrupar(tareas, por, hoy) {
        const lista = tareas || [];
        if (por === 'ninguno') return [{ clave: 'todas', nombre: 'Todas las tareas', color: '#475569', icono: 'list', tareas: lista }];
        if (por === 'subdireccion') {
            return SUBDIRECCIONES.map(s => ({
                clave: s.clave, nombre: s.nombre, corto: s.corto, color: s.color, icono: s.icono,
                tareas: lista.filter(t => t.subdireccion === s.clave),
            }));
        }
        if (por === 'estatus') {
            return ESTATUS.map(e => ({ clave: e.clave, nombre: e.nombre, color: e.color, icono: e.icono, tareas: lista.filter(t => t.estatus === e.clave) }))
                .filter(g => g.tareas.length || (ABIERTOS.includes(g.clave) && g.clave !== 'por_validar'));
        }
        if (por === 'prioridad') {
            return PRIORIDADES.map(p => ({ clave: p.clave, nombre: p.nombre, color: p.color, icono: 'flag', tareas: lista.filter(t => t.prioridad === p.clave) }))
                .filter(g => g.tareas.length);
        }
        if (por === 'tipo') {
            return TIPOS.map(x => ({ clave: x.clave, nombre: x.nombre, color: '#475569', icono: x.icono, tareas: lista.filter(t => t.tipo === x.clave) }))
                .filter(g => g.tareas.length);
        }
        if (por === 'vencimiento') {
            return Object.keys(SITUACIONES)
                .map(k => ({ clave: k, nombre: SITUACIONES[k].nombre, color: SITUACIONES[k].color, icono: 'clock', tareas: lista.filter(t => situacion(t, hoy) === k) }))
                .filter(g => g.tareas.length);
        }
        // responsable
        const mapa = new Map();
        lista.forEach(t => {
            const nombre = String(t.responsable || '').trim() || 'Sin responsable';
            const k = normalizar(nombre);
            if (!mapa.has(k)) mapa.set(k, { clave: k, nombre, color: colorDeNombre(nombre), icono: 'user', tareas: [] });
            mapa.get(k).tareas.push(t);
        });
        return [...mapa.values()].sort((a, b) =>
            (a.nombre === 'Sin responsable') - (b.nombre === 'Sin responsable') || a.nombre.localeCompare(b.nombre, 'es'));
    }

    /* ---------- Indicadores ---------- */

    function estadisticas(tareas, hoy) {
        const lista = tareas || [];
        const s = { total: 0, abiertas: 0, pendientes: 0, en_proceso: 0, por_validar: 0, completadas: 0, vencidas: 0, por_vencer: 0,
                    completadas_mes: 0, a_tiempo: 0, con_fecha_cerradas: 0, cumplimiento: null };
        const mes = String(hoy || hoyISO()).slice(0, 7);
        lista.forEach(t => {
            if (t.estatus === 'cancelada') return;
            s.total++;
            const sit = situacion(t, hoy);
            if (estaAbierta(t)) {
                s.abiertas++;
                if (t.estatus === 'pendiente') s.pendientes++;
                else if (t.estatus === 'por_validar') s.por_validar++;
                else s.en_proceso++;
                if (sit === 'vencida') s.vencidas++;
                if (sit === 'por_vencer' || sit === 'vence_hoy') s.por_vencer++;
            }
            if (t.estatus === 'completada') {
                s.completadas++;
                if (t.completada_en && aISO(new Date(t.completada_en)).slice(0, 7) === mes) s.completadas_mes++;
                const ok = completadaATiempo(t);
                if (ok != null) { s.con_fecha_cerradas++; if (ok) s.a_tiempo++; }
            }
        });
        s.cumplimiento = s.con_fecha_cerradas ? Math.round(s.a_tiempo * 100 / s.con_fecha_cerradas) : null;
        s.avance = s.total ? Math.round(s.completadas * 100 / s.total) : 0;
        return s;
    }

    function estadisticasPorSubdireccion(tareas, hoy) {
        return SUBDIRECCIONES.map(sd => Object.assign({ clave: sd.clave, nombre: sd.nombre, corto: sd.corto, color: sd.color, icono: sd.icono },
            estadisticas((tareas || []).filter(t => t.subdireccion === sd.clave), hoy)));
    }

    /**
     * Diarias acomodadas como una agenda personal: atrasadas, hoy, mañana, esta
     * semana, más adelante, sin fecha, entregadas (esperan validación) y lo que
     * se terminó hoy.
     */
    function agendaDelDia(tareas, hoy) {
        const s = { atrasadas: [], hoy: [], manana: [], semana: [], despues: [], sinFecha: [], entregadas: [], hechas: [] };
        const manana = sumarDias(hoy, 1);
        const orden = (a, b) => pesoPrioridad(a) - pesoPrioridad(b) || String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es');
        const porFecha = (a, b) => (a.fecha_limite < b.fecha_limite ? -1 : a.fecha_limite > b.fecha_limite ? 1 : orden(a, b));
        (tareas || []).forEach(t => {
            if (!t || t.estatus === 'cancelada') return;
            if (t.estatus === 'completada') {
                if (t.completada_en && aISO(new Date(t.completada_en)) === hoy) s.hechas.push(t);
                return;
            }
            if (t.estatus === 'por_validar') { s.entregadas.push(t); return; }
            const f = t.fecha_limite;
            if (!f) s.sinFecha.push(t);
            else if (f < hoy) s.atrasadas.push(t);
            else if (f === hoy) s.hoy.push(t);
            else if (f === manana) s.manana.push(t);
            else if (diasEntre(hoy, f) <= 7) s.semana.push(t);
            else s.despues.push(t);
        });
        s.atrasadas.sort(porFecha);
        s.semana.sort(porFecha);
        s.despues.sort(porFecha);
        s.hoy.sort(orden);
        s.manana.sort(orden);
        s.sinFecha.sort(orden);
        s.hechas.sort(orden);
        s.entregadas.sort((a, b) => String(a.entregada_en || '').localeCompare(String(b.entregada_en || '')));
        return s;
    }

    /* ---------- Resumen ejecutivo (PDF y Excel) ----------
       Lo que un jefe quiere ver de un vistazo: cómo está hoy (abiertas,
       vencidas, por validar), qué se hizo en el periodo (terminadas, a tiempo,
       cuánto tardaron), quién lo hizo y lo más importante dicho en palabras. */
    const PERIODOS = Object.freeze([
        { clave: 'mes', nombre: 'Este mes' },
        { clave: 'mes_anterior', nombre: 'Mes anterior' },
        { clave: '30', nombre: 'Últimos 30 días' },
        { clave: 'trimestre', nombre: 'Este trimestre' },
        { clave: 'anio', nombre: 'Este año' },
        { clave: 'todo', nombre: 'Todo el historial' },
    ]);

    /** «1 al 18 de noviembre de 2026», «19 de octubre al 18 de noviembre de 2026»… */
    function textoRango(desde, hasta) {
        const a = deISO(desde), b = deISO(hasta);
        if (!a || !b) return '';
        if (a.getFullYear() !== b.getFullYear()) return fechaLarga(desde) + ' al ' + fechaLarga(hasta);
        if (a.getMonth() !== b.getMonth()) return a.getDate() + ' de ' + MESES_LARGOS[a.getMonth()] + ' al ' + fechaLarga(hasta);
        return a.getDate() + ' al ' + fechaLarga(hasta);
    }

    /** { clave, nombre, desde, hasta, texto } del periodo elegido (desde null = todo). */
    function rangoPeriodo(clave, hoy, desdeLibre, hastaLibre) {
        const d = deISO(hoy);
        const y = d.getFullYear(), m = d.getMonth();
        const iso = (yy, mm, dd) => aISO(new Date(yy, mm, dd, 12));
        let desde = null, hasta = hoy, nombre = (PERIODOS.find(x => x.clave === clave) || {}).nombre || 'Periodo';
        if (clave === 'mes') desde = iso(y, m, 1);
        else if (clave === 'mes_anterior') { desde = iso(y, m - 1, 1); hasta = iso(y, m, 0); }
        else if (clave === '30') desde = sumarDias(hoy, -29);
        else if (clave === 'trimestre') desde = iso(y, Math.floor(m / 3) * 3, 1);
        else if (clave === 'anio') desde = iso(y, 0, 1);
        else if (clave === 'libre') {
            nombre = 'Personalizado';
            desde = desdeLibre || null;
            hasta = hastaLibre || hoy;
            if (desde && hasta < desde) { const x = desde; desde = hasta; hasta = x; }
        }
        const texto = desde ? textoRango(desde, hasta) : 'Todo el historial, al ' + fechaLarga(hasta);
        return { clave, nombre, desde, hasta, texto };
    }

    const diaDe = ts => (ts ? aISO(new Date(ts)) : null);
    const promedio = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null);
    const porciento = (n, d) => (d ? Math.round(n * 100 / d) : null);

    /** Una tarea terminada, con lo que costó: días de atención, de validación y desfase contra su fecha límite. */
    function fichaTerminada(t) {
        const inicio = t.fecha_inicio || diaDe(t.creado_en);
        const fin = diaDe(t.entregada_en) || diaDe(t.completada_en);
        const validada = diaDe(t.validada_en) || diaDe(t.completada_en);
        return {
            tarea: t, inicio, fin, validada,
            dias: inicio && fin ? Math.max(0, diasEntre(inicio, fin)) : null,
            validacion: t.entregada_en && validada ? Math.max(0, diasEntre(diaDe(t.entregada_en), validada)) : null,
            desfase: fin && t.fecha_limite ? diasEntre(t.fecha_limite, fin) : null,   // > 0: días tarde
            aTiempo: completadaATiempo(t),
        };
    }

    /**
     * Todo lo que lleva el resumen ejecutivo.
     * o: { hoy, desde, hasta } — el estado (abiertas, vencidas…) es al corte de
     * hoy; lo que «pasó» (nuevas, entregadas, terminadas) es dentro del periodo.
     */
    function reporteEjecutivo(tareas, o) {
        const hoy = o.hoy;
        const desde = o.desde || null;
        const hasta = o.hasta || hoy;
        const enPeriodo = iso => Boolean(iso) && (!desde || iso >= desde) && iso <= hasta;
        const todas = (tareas || []).filter(Boolean);
        const lista = todas.filter(t => t.estatus !== 'cancelada');
        const dias = t => diasEntre(hoy, t.fecha_limite);

        const terminadas = lista.filter(t => t.estatus === 'completada' && enPeriodo(diaDe(t.validada_en) || diaDe(t.completada_en)))
            .map(fichaTerminada)
            .sort((a, b) => String(b.validada || '').localeCompare(String(a.validada || '')));
        const abiertas = lista.filter(t => estaAbierta(t) && t.estatus !== 'por_validar');
        const vencidas = abiertas.filter(t => situacion(t, hoy) === 'vencida')
            .map(t => ({ tarea: t, atraso: -dias(t) }))
            .sort((a, b) => b.atraso - a.atraso || pesoPrioridad(a.tarea) - pesoPrioridad(b.tarea));
        const porVencer = abiertas.filter(t => ['vence_hoy', 'por_vencer'].includes(situacion(t, hoy)));
        const proximas = abiertas.filter(t => t.fecha_limite && dias(t) >= 0 && dias(t) <= 30)
            .map(t => ({ tarea: t, dias: dias(t) }))
            .sort((a, b) => a.dias - b.dias || pesoPrioridad(a.tarea) - pesoPrioridad(b.tarea));
        const porValidar = lista.filter(t => t.estatus === 'por_validar')
            .map(t => ({ tarea: t, esperando: t.entregada_en ? Math.max(0, diasEntre(diaDe(t.entregada_en), hoy)) : null }))
            .sort((a, b) => (b.esperando || 0) - (a.esperando || 0));
        const renovaciones = abiertas.filter(t => (t.tipo === 'renovacion' || t.tipo === 'certificado') && t.fecha_limite && dias(t) >= 0 && dias(t) <= 90)
            .map(t => ({ tarea: t, dias: dias(t) }))
            .sort((a, b) => a.dias - b.dias);
        const nuevas = lista.filter(t => enPeriodo(diaDe(t.creado_en)));
        const entregadas = lista.filter(t => t.entregada_en && enPeriodo(diaDe(t.entregada_en)));
        const conFecha = terminadas.filter(x => x.aTiempo != null);
        const completadasTotal = lista.filter(t => t.estatus === 'completada').length;

        const kpis = {
            abiertas: abiertas.length, vencidas: vencidas.length, porVencer: porVencer.length, porValidar: porValidar.length,
            nuevas: nuevas.length, entregadas: entregadas.length, terminadas: terminadas.length,
            aTiempo: conFecha.filter(x => x.aTiempo).length, conFecha: conFecha.length,
            aTiempoPct: porciento(conFecha.filter(x => x.aTiempo).length, conFecha.length),
            diasPromedio: promedio(terminadas.map(x => x.dias).filter(v => v != null)),
            validacionPromedio: promedio(terminadas.map(x => x.validacion).filter(v => v != null)),
            avance: porciento(completadasTotal, lista.length),
            total: lista.length, canceladas: todas.length - lista.length,
        };

        // Por responsable: lo que terminó en el periodo y lo que tiene hoy.
        const personas = new Map();
        const persona = t => {
            const nombre = String(t.responsable || '').trim();
            const k = normalizar(nombre) || '~';
            if (!personas.has(k)) personas.set(k, { nombre: nombre || 'Sin responsable', terminadas: 0, aTiempo: 0, conFecha: 0, dias: [], abiertas: 0, vencidas: 0, porValidar: 0 });
            return personas.get(k);
        };
        terminadas.forEach(x => {
            const p = persona(x.tarea);
            p.terminadas++;
            if (x.aTiempo != null) { p.conFecha++; if (x.aTiempo) p.aTiempo++; }
            if (x.dias != null) p.dias.push(x.dias);
        });
        abiertas.forEach(t => { const p = persona(t); p.abiertas++; if (situacion(t, hoy) === 'vencida') p.vencidas++; });
        porValidar.forEach(x => { persona(x.tarea).porValidar++; });
        const porResponsable = [...personas.values()].map(p => ({
            nombre: p.nombre, terminadas: p.terminadas, aTiempo: p.aTiempo, conFecha: p.conFecha,
            aTiempoPct: porciento(p.aTiempo, p.conFecha), diasPromedio: promedio(p.dias),
            abiertas: p.abiertas, vencidas: p.vencidas, porValidar: p.porValidar,
        })).sort((a, b) => (a.nombre === 'Sin responsable') - (b.nombre === 'Sin responsable')
            || b.terminadas - a.terminadas || b.vencidas - a.vencidas || b.abiertas - a.abiertas || a.nombre.localeCompare(b.nombre, 'es'));

        const porSubdireccion = SUBDIRECCIONES.map(sd => {
            const de = arr => arr.filter(x => (x.tarea || x).subdireccion === sd.clave);
            const term = de(terminadas);
            const cf = term.filter(x => x.aTiempo != null);
            const total = lista.filter(t => t.subdireccion === sd.clave);
            return {
                clave: sd.clave, nombre: sd.nombre, corto: sd.corto, color: sd.color,
                abiertas: de(abiertas).length, vencidas: de(vencidas).length, porVencer: de(porVencer).length, porValidar: de(porValidar).length,
                terminadas: term.length, aTiempoPct: porciento(cf.filter(x => x.aTiempo).length, cf.length),
                diasPromedio: promedio(term.map(x => x.dias).filter(v => v != null)),
                total: total.length, avance: porciento(total.filter(t => t.estatus === 'completada').length, total.length),
            };
        });

        const estatus = ESTATUS.filter(e => e.clave !== 'cancelada')
            .map(e => ({ clave: e.clave, nombre: e.nombre, color: e.color, n: lista.filter(t => t.estatus === e.clave).length }));

        return { hoy, desde, hasta, kpis, estatus, terminadas, abiertas, vencidas, porVencer, proximas, porValidar, renovaciones, nuevas, entregadas, porResponsable, porSubdireccion };
    }

    /** Lo más importante del resumen, en frases cortas. tono: rojo · ambar · verde · azul · cian */
    function destacadosReporte(r) {
        const k = r.kpis;
        const out = [];
        const quien = t => (t.responsable ? t.responsable : 'sin responsable');
        const dd = n => (n === 1 ? '1 día' : n + ' días');
        if (r.vencidas.length) {
            const peor = r.vencidas[0];
            out.push({ tono: 'rojo', texto: (k.vencidas === 1 ? '1 tarea vencida' : k.vencidas + ' tareas vencidas') + '. La más atrasada: «' + peor.tarea.titulo + '», ' + dd(peor.atraso) + ' de atraso (' + quien(peor.tarea) + ').' });
        } else if (k.abiertas) {
            out.push({ tono: 'verde', texto: 'Ninguna tarea vencida a la fecha de corte.' });
        }
        if (k.terminadas) {
            out.push({ tono: k.aTiempoPct == null || k.aTiempoPct >= 80 ? 'verde' : k.aTiempoPct >= 60 ? 'ambar' : 'rojo',
                texto: (k.terminadas === 1 ? 'Se terminó 1 tarea' : 'Se terminaron ' + k.terminadas + ' tareas') + ' en el periodo' +
                    (k.aTiempoPct != null ? '; ' + k.aTiempoPct + '% se entregó a tiempo (' + k.aTiempo + ' de ' + k.conFecha + ' con fecha límite).' : '.') });
        } else {
            out.push({ tono: 'azul', texto: 'En el periodo no se terminó ninguna tarea.' });
        }
        if (k.diasPromedio != null) out.push({ tono: 'azul', texto: 'En promedio, una tarea tardó ' + dd(k.diasPromedio) + ' desde su inicio hasta su entrega.' });
        if (k.validacionPromedio != null || k.porValidar) {
            out.push({ tono: k.porValidar ? 'cian' : 'azul', texto: (k.validacionPromedio != null ? 'La validación del Director tomó en promedio ' + dd(k.validacionPromedio) + '.' : '') +
                (k.porValidar ? (k.validacionPromedio != null ? ' ' : '') + (k.porValidar === 1 ? '1 tarea espera' : k.porValidar + ' tareas esperan') + ' su validación.' : '') });
        }
        const conPend = r.porSubdireccion.filter(s => s.abiertas).sort((a, b) => b.vencidas - a.vencidas || b.abiertas - a.abiertas);
        if (conPend.length && k.abiertas) {
            const s = conPend[0];
            out.push({ tono: s.vencidas ? 'ambar' : 'azul', texto: s.nombre + ' concentra ' + s.abiertas + ' de ' + k.abiertas + (k.abiertas === 1 ? ' pendiente' : ' pendientes') + ' (' + porciento(s.abiertas, k.abiertas) + '%)' +
                (s.vencidas ? ', ' + (s.vencidas === 1 ? '1 vencida.' : s.vencidas + ' vencidas.') : '.') });
        }
        const destacada = r.porResponsable.filter(p => p.nombre !== 'Sin responsable' && p.terminadas)
            .sort((a, b) => b.terminadas - a.terminadas || (b.aTiempoPct || 0) - (a.aTiempoPct || 0))[0];
        if (destacada) out.push({ tono: 'verde', texto: destacada.nombre + ' terminó ' + destacada.terminadas + (destacada.terminadas === 1 ? ' tarea' : ' tareas') + (destacada.aTiempoPct != null ? ', ' + destacada.aTiempoPct + '% a tiempo' : '') + '.' });
        const atrasado = r.porResponsable.filter(p => p.vencidas).sort((a, b) => b.vencidas - a.vencidas)[0];
        if (atrasado && atrasado.vencidas > 1) out.push({ tono: 'ambar', texto: atrasado.nombre + ' tiene ' + atrasado.vencidas + ' tareas vencidas: conviene darle seguimiento.' });
        if (r.renovaciones.length) {
            const pr = r.renovaciones[0];
            out.push({ tono: 'ambar', texto: (r.renovaciones.length === 1 ? '1 renovación o certificado vence' : r.renovaciones.length + ' renovaciones o certificados vencen') + ' en los próximos 90 días; el primero, «' + pr.tarea.titulo + '», el ' + fechaLarga(pr.tarea.fecha_limite) + '.' });
        }
        return out;
    }

    /** Avance del checklist: { hechos, total, pct }. */
    function avanceChecklist(t) {
        const items = Array.isArray(t && t.checklist) ? t.checklist : [];
        const hechos = items.filter(i => i && i.hecho).length;
        return { hechos, total: items.length, pct: items.length ? Math.round(hechos * 100 / items.length) : 0 };
    }

    /* ---------- Subtareas con fecha ----------
       Una subtarea ocupa un tramo del periodo de la tarea: del día de inicio
       (fecha_inicio, opcional) al día en que debe quedar (fecha). Si sólo trae
       fecha, es de un solo día. Juntas reparten el periodo de la tarea: del
       inicio (o de la primera subtarea) a la fecha límite. */

    /** Primer día de la subtarea (su inicio o, si es de un día, su fecha). */
    const inicioSubtarea = i => (i && (i.fecha_inicio || i.fecha)) || null;

    /** Días que dura la subtarea, contando ambos extremos (0 sin fecha). */
    function diasSubtarea(i) {
        if (!i || !i.fecha) return 0;
        return diasEntre(inicioSubtarea(i), i.fecha) + 1;
    }

    /** Subtareas que tienen fecha, en orden de inicio. */
    function subtareasConFecha(t) {
        const items = Array.isArray(t && t.checklist) ? t.checklist : [];
        const clave = i => inicioSubtarea(i) + '|' + i.fecha;
        return items.filter(i => i && i.fecha).slice().sort((a, b) => clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0);
    }

    /** Periodo que cubre la tarea con sus subtareas: { inicio, fin } o null sin fechas. */
    function periodoTarea(t) {
        const subs = subtareasConFecha(t);
        const ultimo = subs.reduce((m, i) => (!m || i.fecha > m ? i.fecha : m), null);
        const inicio = t.fecha_inicio || (subs.length ? inicioSubtarea(subs[0]) : null) || t.fecha_limite || null;
        const fin = t.fecha_limite || ultimo || inicio;
        if (!inicio || !fin) return null;
        return inicio <= fin ? { inicio, fin } : { inicio: fin, fin: inicio };
    }

    /** ¿La subtarea empieza antes del inicio o termina después de la fecha límite de la tarea? */
    function subtareaFueraDePeriodo(item, t) {
        if (!item || !item.fecha) return false;
        if (t.fecha_inicio && inicioSubtarea(item) < t.fecha_inicio) return true;
        return Boolean(t.fecha_limite && item.fecha > t.fecha_limite);
    }

    /** Fechas propuestas para la siguiente subtarea: el día después de la
        última, o el inicio de la tarea. { inicio: '', fin: '' } si ya no cabe. */
    function sugerirFechasSubtarea(t) {
        const ultimo = subtareasConFecha(t).reduce((m, i) => (!m || i.fecha > m ? i.fecha : m), null);
        const propuesta = ultimo ? sumarDias(ultimo, 1) : (t.fecha_inicio || '');
        if (!propuesta || (t.fecha_limite && propuesta > t.fecha_limite)) return { inicio: '', fin: '' };
        return { inicio: propuesta, fin: propuesta };
    }

    /** Cambia el inicio o el fin de una subtarea y deja el par en orden: sin
        fin se toma el inicio (un día); si el inicio queda después del fin, se
        mueve el otro extremo. Devuelve la subtarea nueva. */
    function ajustarFechasSubtarea(item, campo, valor) {
        // Borrar el fin de una de un solo día le quita la fecha; de un tramo, la deja en su inicio.
        let ini = campo === 'inicio' ? (valor || '') : (campo === 'fin' && !valor ? (item.fecha_inicio || '') : (item.fecha_inicio || item.fecha || ''));
        let fin = campo === 'fin' ? (valor || '') : (item.fecha || '');
        if (ini && !fin) fin = ini;
        if (!ini && fin) ini = fin;
        if (ini && fin && ini > fin) { if (campo === 'inicio') fin = ini; else ini = fin; }
        const sigue = Object.assign({}, item);
        delete sigue.fecha_inicio; delete sigue.fecha;
        if (fin) sigue.fecha = fin;
        if (ini && fin && ini !== fin) sigue.fecha_inicio = ini;
        return sigue;
    }

    /** Da fechas a las subtareas que no las tienen: reparte el periodo en
        tramos seguidos, uno por subtarea, que juntos lo cubren completo (6
        subtareas en 6 días = una por día; 3 en 6 días = dos días cada una).
        Las que ya tienen fecha no se tocan. Devuelve una lista nueva. */
    function repartirSubtareas(items, inicio, fin) {
        const lista = Array.isArray(items) ? items : [];
        if (!inicio || !fin || fin < inicio) return lista.slice();
        const sinFecha = lista.filter(i => i && !i.fecha);
        const n = sinFecha.length;
        const dias = diasEntre(inicio, fin) + 1;
        const tramos = new Map(sinFecha.map((item, k) => {
            const desde = Math.floor(k * dias / n);
            const hasta = Math.max(desde, Math.floor((k + 1) * dias / n) - 1);
            return [item, { ini: sumarDias(inicio, desde), fin: sumarDias(inicio, hasta) }];
        }));
        return lista.map(i => {
            if (!tramos.has(i)) return i;
            const r = tramos.get(i);
            return Object.assign({}, i, r.ini !== r.fin ? { fecha_inicio: r.ini } : {}, { fecha: r.fin });
        });
    }

    /** Días del periodo de la tarea que ya tienen al menos una subtarea. */
    function diasCubiertos(t) {
        const p = periodoTarea(t);
        if (!p) return { cubiertos: 0, total: 0 };
        const total = diasEntre(p.inicio, p.fin) + 1;
        const dias = new Set();
        subtareasConFecha(t).forEach(i => {
            for (let d = inicioSubtarea(i); d <= i.fecha; d = sumarDias(d, 1)) if (d >= p.inicio && d <= p.fin) dias.add(d);
        });
        return { cubiertos: dias.size, total };
    }

    /* ---------- Tareas duplicadas ----------
       Antes de crear una tarea se compara su nombre con las tareas abiertas.
       «igual»: el mismo nombre sin importar mayúsculas, acentos, signos ni
       palabras de relleno.
       «parecida»: comparten casi todas sus palabras importantes (las de, la,
       para… no cuentan). Las cerradas no cuentan: renovar lo ya completado no
       es duplicar. */
    const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'para', 'por', 'con', 'sin', 'un', 'una', 'unos', 'unas', 'que', 'se', 'ante', 'bajo', 'desde', 'hacia', 'hasta', 'sobre', 'entre', 'tras', 'segun', 'contra']);
    // Los puntos se quitan (I.F.T. = IFT); los demás signos separan palabras.
    const claveTitulo = titulo => normalizar(titulo).replace(/\./g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const palabrasTitulo = titulo => new Set(claveTitulo(titulo).split(' ').filter(w => w && !PALABRAS_VACIAS.has(w)));

    /** Tareas abiertas que podrían ser la misma que «nueva»: [{ tarea, tipo, parecido, mismaSubdireccion }],
        primero las iguales y las de la misma subdirección. */
    function posiblesDuplicadas(nueva, tareas) {
        const clave = claveTitulo(nueva && nueva.titulo);
        if (!clave) return [];
        const propias = palabrasTitulo(nueva.titulo);
        return (Array.isArray(tareas) ? tareas : [])
            .filter(t => t && t.id !== nueva.id && estaAbierta(t))
            .map(t => {
                const mismaSubdireccion = Boolean(nueva.subdireccion) && t.subdireccion === nueva.subdireccion;
                const otras = palabrasTitulo(t.titulo);
                const comunes = [...propias].filter(w => otras.has(w)).length;
                const union = new Set([...propias, ...otras]).size;
                // Igual también si sólo cambian las palabras de relleno («de la», «para»…).
                const mismasPalabras = propias.size > 0 && comunes === propias.size && comunes === otras.size;
                if (claveTitulo(t.titulo) === clave || mismasPalabras) return { tarea: t, tipo: 'igual', parecido: 1, mismaSubdireccion };
                const parecido = union ? comunes / union : 0;
                return comunes >= 2 && parecido >= 0.7 ? { tarea: t, tipo: 'parecida', parecido, mismaSubdireccion } : null;
            })
            .filter(Boolean)
            .sort((a, b) => (a.tipo === 'igual' ? 0 : 1) - (b.tipo === 'igual' ? 0 : 1)
                || Number(b.mismaSubdireccion) - Number(a.mismaSubdireccion) || b.parecido - a.parecido)
            .slice(0, 5);
    }

    /** Una igual en la misma subdirección no se crea: es la misma tarea. */
    const bloqueaDuplicado = candidatas => (candidatas || []).some(c => c.tipo === 'igual' && c.mismaSubdireccion);

    /* ---------- Tablero de mando ----------
       Lo que un director, subdirector o gerente necesita leer al entrar: qué
       está vencido, qué vence pronto, qué está detenido y dónde, sólo de su
       parte de la Dirección. */

    // Claves de área (tabla areas / permisos del usuario) → subdirección de Seguimiento.
    const CLAVES_AREA = Object.freeze({ 'SD-SO': 'SSO', 'SD-SA': 'SSA', 'SD-SC': 'SSC', 'SD-ING': 'SI', SGE: 'SGE', SSO: 'SSO', SSA: 'SSA', SSC: 'SSC', SI: 'SI' });
    const ROLES_DIRECCION = Object.freeze(['admin', 'superadmin', 'director_general']);
    const ALCANCE_TODO = Object.freeze({ tipo: 'todo', subdireccion: null, gerencia: null });

    /** De qué parte de la Dirección es responsable quien entra, según su área:
        { tipo: 'todo' | 'subdireccion' | 'gerencia', subdireccion, gerencia }.
        area = { clave, nombre, nivel, padre: { clave, nombre } } (o null). */
    function alcanceDeArea(area, rol) {
        if (ROLES_DIRECCION.includes(String(rol || '').trim().toLowerCase())) return ALCANCE_TODO;
        if (!area) return ALCANCE_TODO;
        const clave = String(area.clave || '').trim().toUpperCase();
        if (clave === 'DO' || Number(area.nivel) === 1) return ALCANCE_TODO;
        const n = normalizar(area.nombre);
        const sd = CLAVES_AREA[clave] ? SUBDIR[CLAVES_AREA[clave]]
            : SUBDIRECCIONES.find(x => x.clave !== 'DO' && n && (n === normalizar(x.nombre) || n === normalizar(x.corto) || n === normalizar(x.nombre.replace(/^Subdirecci[oó]n de /, ''))));
        if (sd) return { tipo: 'subdireccion', subdireccion: sd.clave, gerencia: null };
        for (const x of SUBDIRECCIONES) {
            const g = x.gerencias.find(nombre => normalizar(nombre) === n);
            if (g) return { tipo: 'gerencia', subdireccion: x.clave, gerencia: g };
        }
        // Una gerencia que no está en el catálogo: se toma la subdirección de su área de arriba.
        if (area.padre) {
            const arriba = alcanceDeArea(area.padre, '');
            if (arriba.tipo === 'subdireccion') return arriba;
        }
        return ALCANCE_TODO;
    }

    /** Las vistas que puede elegir: la suya y las más amplias (gerencia → subdirección → todo). */
    function alcancesPosibles(base) {
        const b = base || ALCANCE_TODO;
        const lista = [];
        if (b.tipo === 'gerencia') lista.push(b);
        if (b.tipo === 'gerencia' || b.tipo === 'subdireccion') lista.push({ tipo: 'subdireccion', subdireccion: b.subdireccion, gerencia: null });
        lista.push(ALCANCE_TODO);
        return lista;
    }

    function filtrarAlcance(tareas, alcance) {
        const a = alcance || ALCANCE_TODO;
        return (tareas || []).filter(t => {
            if (a.tipo === 'todo') return true;
            if (t.subdireccion !== a.subdireccion) return false;
            return a.tipo !== 'gerencia' || normalizar(t.gerencia) === normalizar(a.gerencia);
        });
    }

    /** Qué tan urgente es una tarea abierta para el tablero (menor = antes); null si no requiere atención. */
    function urgenciaMando(t, hoy) {
        if (!estaAbierta(t)) return null;
        const sit = situacion(t, hoy);
        if (sit === 'vencida') return 0;
        if (sit === 'vence_hoy') return 1;
        if (t.estatus === 'detenida') return 2;
        if (sit === 'por_vencer') return 3;
        return null;
    }

    /** Lo que se lee en el tablero: cifras, lo que requiere atención y las renovaciones próximas. */
    function resumenMando(tareas, hoy, opciones) {
        const o = Object.assign({ diasRenovacion: 90 }, opciones || {});
        const abiertas = (tareas || []).filter(estaAbierta);
        const dias = t => diasEntre(hoy, t.fecha_limite);
        const atencion = abiertas
            .map(t => ({ tarea: t, urgencia: urgenciaMando(t, hoy), situacion: situacion(t, hoy), dias: dias(t) }))
            .filter(x => x.urgencia != null)
            .sort((a, b) => a.urgencia - b.urgencia
                || (a.dias == null ? 1e6 : a.dias) - (b.dias == null ? 1e6 : b.dias)
                || pesoPrioridad(a.tarea) - pesoPrioridad(b.tarea));
        const renovaciones = abiertas
            .filter(t => (t.tipo === 'renovacion' || t.tipo === 'certificado') && dias(t) != null && dias(t) >= 0 && dias(t) <= o.diasRenovacion)
            .map(t => ({ tarea: t, dias: dias(t) }))
            .sort((a, b) => a.dias - b.dias);
        const est = estadisticas(tareas, hoy);
        return {
            abiertas: abiertas.length,
            vencidas: est.vencidas,
            semana: abiertas.filter(t => dias(t) != null && dias(t) >= 0 && dias(t) <= 7).length,
            detenidas: abiertas.filter(t => t.estatus === 'detenida').length,
            porValidar: abiertas.filter(t => t.estatus === 'por_validar').length,
            cumplimiento: est.cumplimiento,
            atencion,
            renovaciones,
        };
    }

    /** Desglose para el semáforo: por subdirección (todo), por gerencia (una subdirección)
        o por responsable (una gerencia). [{ clave, nombre, color, abiertas, vencidas, porVencer, nivel }] */
    function desgloseMando(tareas, alcance, hoy) {
        const a = alcance || ALCANCE_TODO;
        const cuenta = lista => {
            const r = { abiertas: 0, vencidas: 0, porVencer: 0 };
            lista.forEach(t => {
                if (!estaAbierta(t)) return;
                r.abiertas++;
                const sit = situacion(t, hoy);
                if (sit === 'vencida') r.vencidas++;
                else if (sit === 'por_vencer' || sit === 'vence_hoy') r.porVencer++;
            });
            r.nivel = r.vencidas ? 'rojo' : r.porVencer ? 'ambar' : r.abiertas ? 'verde' : 'vacio';
            return r;
        };
        const propias = filtrarAlcance(tareas, a);
        if (a.tipo === 'todo') {
            return SUBDIRECCIONES.map(sd => Object.assign({ clave: sd.clave, nombre: sd.corto, color: sd.color, icono: sd.icono },
                cuenta(propias.filter(t => t.subdireccion === sd.clave))));
        }
        if (a.tipo === 'subdireccion') {
            const sd = SUBDIR[a.subdireccion];
            const filas = (sd ? sd.gerencias : []).map(g => Object.assign({ clave: g, nombre: g, color: sd.color, icono: 'building' },
                cuenta(propias.filter(t => normalizar(t.gerencia) === normalizar(g)))));
            const sinGerencia = propias.filter(t => !String(t.gerencia || '').trim());
            if (sinGerencia.length) filas.push(Object.assign({ clave: '', nombre: 'Toda la subdirección', color: sd ? sd.color : '#64748b', icono: 'sitemap' }, cuenta(sinGerencia)));
            return filas;
        }
        const porPersona = new Map();
        propias.filter(estaAbierta).forEach(t => {
            const n = String(t.responsable || '').trim() || 'Sin responsable';
            if (!porPersona.has(n)) porPersona.set(n, []);
            porPersona.get(n).push(t);
        });
        return [...porPersona.entries()]
            .map(([n, lista]) => Object.assign({ clave: n, nombre: n, color: colorDeNombre(n), icono: 'user' }, cuenta(lista)))
            .sort((x, y) => y.vencidas - x.vencidas || y.abiertas - x.abiertas || x.nombre.localeCompare(y.nombre, 'es'));
    }

    /* ---------- Área de cada cuenta (quién ve y trabaja qué) ----------
       Misma regla que la base (db/seguimiento_alcance_por_area.sql):
         admin o sin área         → toda la Dirección
         subdirección             → subdirector: todo lo de su subdirección
         subdirección + gerencia  → gerente: su gerencia y lo de toda la
                                    subdirección (sin gerencia); nada de otras
                                    gerencias. */
    const ALCANCE_DIRECCION = Object.freeze({ tipo: 'todo', subdireccion: null, gerencia: null });

    /** El alcance de una cuenta de seguimiento_acceso ({ rol, subdireccion, gerencia }). */
    function alcanceDeAcceso(fila) {
        if (!fila || fila.rol === 'admin' || !fila.subdireccion || !SUBDIR[fila.subdireccion]) return ALCANCE_DIRECCION;
        const g = String(fila.gerencia || '').trim();
        return g ? { tipo: 'gerencia', subdireccion: fila.subdireccion, gerencia: g }
            : { tipo: 'subdireccion', subdireccion: fila.subdireccion, gerencia: null };
    }

    /** ¿Una tarea de esta subdirección y gerencia le toca a quien tiene este alcance? */
    function dentroDeAlcance(alcance, subdireccion, gerencia) {
        const a = alcance || ALCANCE_DIRECCION;
        if (a.tipo === 'todo') return true;
        if (subdireccion !== a.subdireccion) return false;
        if (a.tipo === 'subdireccion') return true;
        const g = normalizar(gerencia);
        return !g || g === normalizar(a.gerencia);
    }

    /** Subdirecciones en las que puede trabajar. */
    function subdireccionesPermitidas(alcance) {
        const a = alcance || ALCANCE_DIRECCION;
        return a.tipo === 'todo' ? SUBDIRECCIONES.map(x => x.clave) : [a.subdireccion];
    }

    /** Gerencias que puede asignar en una subdirección ('' = toda la subdirección), y si puede escribir otra. */
    function gerenciasPermitidas(alcance, subdireccion) {
        const a = alcance || ALCANCE_DIRECCION;
        const sd = SUBDIR[subdireccion];
        if (!sd || !dentroDeAlcance(a, subdireccion, '')) return { opciones: [], libre: false };
        if (a.tipo === 'gerencia') return { opciones: ['', a.gerencia], libre: false };
        return { opciones: [''].concat(sd.gerencias), libre: true };
    }

    /** Texto para mostrar el área: «Toda la Dirección», «Subdirección de…» o la gerencia. */
    function nombreAlcanceArea(alcance) {
        const a = alcance || ALCANCE_DIRECCION;
        if (a.tipo === 'todo') return 'Toda la Dirección';
        if (a.tipo === 'gerencia') return a.gerencia;
        return (SUBDIR[a.subdireccion] || {}).nombre || a.subdireccion;
    }

    /* ---------- Sugerir el área desde Colaboradores ----------
       Colaboradores (agenda_2026) sabe en qué subdirección y gerencia está cada
       persona, si está comisionada y cuál es su puesto. Con eso se propone el
       área de cada cuenta: el Director ve todo; un subdirector, su subdirección;
       un gerente (o su gente), su gerencia. Si está comisionado, cuenta donde
       trabaja de verdad. */
    const llaveCol = k => normalizar(k).replace(/[^a-z0-9]+/g, ' ').trim();
    function campoColaborador(fila, prueba) {
        const k = Object.keys(fila || {}).find(x => prueba(llaveCol(x)));
        return k ? String(fila[k] == null ? '' : fila[k]).trim() : '';
    }
    const esVacioArea = v => !v || /^(0|no|n a|na|-+|ninguna|sin dato)$/.test(llaveCol(v));

    function subdireccionDeTexto(texto) {
        const n = llaveCol(texto);
        if (!n) return null;
        const sd = SUBDIRECCIONES.find(x => {
            const nombre = llaveCol(x.nombre), corto = llaveCol(x.corto), sinPref = llaveCol(x.nombre.replace(/^Subdirecci[oó]n de /, ''));
            return n === nombre || n === corto || n === sinPref || (x.clave.length > 2 && n === x.clave.toLowerCase()) || (n.length > 8 && (nombre.includes(n) || n.includes(sinPref)));
        });
        if (sd) return sd.clave;
        return n === 'direccion de operacion' ? 'DO' : null;
    }
    function gerenciaDeTexto(subdireccion, texto) {
        const n = llaveCol(texto);
        if (!n) return null;
        // Primero el nombre exacto (en su subdirección y luego en cualquiera), y
        // sólo después parecidos: «Gerencia de Seguridad» no es la «… Operacional».
        const orden = (subdireccion && SUBDIR[subdireccion] ? [SUBDIR[subdireccion]] : []).concat(SUBDIRECCIONES);
        const pruebas = [g => llaveCol(g) === n, g => n.length > 10 && (llaveCol(g).includes(n) || n.includes(llaveCol(g)))];
        for (const prueba of pruebas) {
            for (const sd of orden) {
                const g = sd.gerencias.find(prueba);
                if (g) return { subdireccion: sd.clave, gerencia: g };
            }
        }
        return null;
    }

    /** Área sugerida para una persona del directorio: { subdireccion, gerencia, motivo } o null. */
    function areaDeColaborador(fila) {
        if (!fila) return null;
        const puesto = llaveCol(campoColaborador(fila, k => k === 'puesto' || k.startsWith('puesto ') || k === 'cargo'));
        const flag = llaveCol(campoColaborador(fila, k => k === 'personal comisionado' || (k.includes('comision') && !/direcc|subdir|gerenc|coordin/.test(k))));
        const comisionado = /^(1|si|true)$/.test(flag) || flag.includes('comisionad');
        const subCom = campoColaborador(fila, k => /^subdir/.test(k) && k.includes('comision'));
        const gerCom = campoColaborador(fila, k => /^gerencia/.test(k) && k.includes('comision'));
        const subOrg = campoColaborador(fila, k => /^subdir/.test(k) && !k.includes('comision'));
        const gerOrg = campoColaborador(fila, k => /^gerencia/.test(k) && !k.includes('comision'));
        const usarCom = comisionado && !esVacioArea(subCom);
        const subTxt = usarCom ? subCom : subOrg;
        const gerTxt = usarCom ? gerCom : gerOrg;
        const motivoBase = usarCom ? ' (comisionado)' : '';

        // El Director (no el subdirector) ve toda la Dirección.
        if (/\bdirector(a)?\b/.test(puesto) && !/subdirector/.test(puesto)) return { subdireccion: null, gerencia: null, motivo: 'Puesto de Director' };
        let sd = esVacioArea(subTxt) ? null : subdireccionDeTexto(subTxt);
        const gTxt = esVacioArea(gerTxt) ? null : gerenciaDeTexto(sd, gerTxt);
        if (!sd && gTxt) sd = gTxt.subdireccion;
        if (!sd) return null;
        if (/subdirector/.test(puesto)) return { subdireccion: sd, gerencia: null, motivo: 'Subdirector' + motivoBase };
        if (gTxt && gTxt.subdireccion === sd) return { subdireccion: sd, gerencia: gTxt.gerencia, motivo: (/gerente/.test(puesto) ? 'Gerente' : 'Su gerencia') + motivoBase };
        return { subdireccion: sd, gerencia: null, motivo: 'Su subdirección' + motivoBase };
    }

    /** La persona del directorio que corresponde a una cuenta, por nombre o por usuario. */
    function colaboradorDeCuenta(cuenta, filas) {
        const activas = (filas || []).filter(f => !/baja/i.test(campoColaborador(f, k => k === 'estatus' || k === 'status')));
        const tokens = v => llaveCol(v).split(' ').filter(w => w.length > 1 && !PALABRAS_VACIAS.has(w));
        const nombreDe = f => campoColaborador(f, k => k === 'nombre' || k === 'nombre completo');
        const unico = lista => (lista.length === 1 ? lista[0] : null);
        const nom = llaveCol(cuenta && cuenta.nombre);
        if (nom) {
            const exacta = unico(activas.filter(f => llaveCol(nombreDe(f)) === nom));
            if (exacta) return exacta;
            const t = tokens(cuenta.nombre);
            if (t.length >= 2) {
                const contiene = unico(activas.filter(f => { const ft = new Set(tokens(nombreDe(f))); return t.every(w => ft.has(w)); }));
                if (contiene) return contiene;
            }
        }
        const usuario = String((cuenta && cuenta.email) || '').split('@')[0];
        const tu = tokens(usuario.replace(/[._-]+/g, ' '));
        if (tu.length >= 2) return unico(activas.filter(f => { const ft = new Set(tokens(nombreDe(f))); return tu.every(w => ft.has(w)); }));
        return null;
    }

    /* ---------- Archivos (evidencias y archivos de cada subtarea) ----------
       PDF, Word, Excel e imágenes. La extensión del nombre manda: Windows
       reporta un .csv como «application/vnd.ms-excel» y no es un Excel. */
    const ARCHIVOS = Object.freeze({
        pdf:  { mime: 'application/pdf', icono: 'file-pdf', color: '#dc2626', nombre: 'PDF' },
        doc:  { mime: 'application/msword', icono: 'file-word', color: '#2563eb', nombre: 'Word' },
        docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', icono: 'file-word', color: '#2563eb', nombre: 'Word' },
        xls:  { mime: 'application/vnd.ms-excel', icono: 'file-excel', color: '#16a34a', nombre: 'Excel' },
        xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', icono: 'file-excel', color: '#16a34a', nombre: 'Excel' },
        jpg:  { mime: 'image/jpeg', icono: 'file-image', color: '#7c3aed', nombre: 'Imagen' },
        png:  { mime: 'image/png', icono: 'file-image', color: '#7c3aed', nombre: 'Imagen' },
    });
    const MAX_ARCHIVO = 25 * 1024 * 1024;

    /** 'pdf', 'docx', 'xlsx', 'jpg'… o null si no es un tipo aceptado. */
    function extensionArchivo(nombre, mime) {
        const m = /\.([a-z0-9]+)$/i.exec(String(nombre || ''));
        let ext = m ? m[1].toLowerCase() : '';
        if (ext === 'jpeg') ext = 'jpg';
        if (ARCHIVOS[ext]) return ext;
        if (ext) return null;
        const porMime = Object.keys(ARCHIVOS).find(k => ARCHIVOS[k].mime === mime);
        return porMime || null;
    }

    /** Ícono y color de un archivo guardado ({ tipo }). */
    const datosArchivo = tipo => ARCHIVOS[tipo] || { mime: 'application/octet-stream', icono: 'file', color: '#64748b', nombre: 'Archivo' };

    /* Límites de lo que entra a la base. La base tiene los mismos (o más
       holgados) en db/seguimiento_validacion.sql: aquí se avisa antes, con
       palabras; allá se impide aunque alguien se salte la página. */
    const LIMITES = Object.freeze({
        archivoBytes: MAX_ARCHIVO,
        archivosPorVez: 10,
        evidenciasPorTarea: 30,
        archivosPorSubtarea: 10,
        subtareas: 60,
        titulo: 300, descripcion: 8000, referencia: 200, responsable: 200, gerencia: 200, telefono: 30,
        obs: 2000, comentario: 4000, nombreArchivo: 180,
    });

    /** 512 KB, 3.4 MB, 1.0 GB… */
    function tamanoTexto(n) {
        const b = +n || 0;
        if (!b) return '';
        if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
        const uno = v => v.toFixed(1).replace(/\.0$/, '');
        if (b < 1024 * 1024 * 1024) return uno(b / 1024 / 1024) + ' MB';
        return uno(b / 1024 / 1024 / 1024) + ' GB';
    }

    /** null si el archivo sirve; si no, por qué (sin el nombre: quien llama lo pone). */
    function problemaArchivo(f) {
        if (!f) return 'No se pudo leer el archivo.';
        if (!extensionArchivo(f.name, f.type)) return 'Tipo no permitido: sólo se aceptan PDF, Word, Excel, JPG o PNG.';
        if (!f.size) return 'Está vacío (0 bytes).';
        if (f.size > MAX_ARCHIVO) return 'Pesa ' + tamanoTexto(f.size) + '; el máximo es ' + tamanoTexto(MAX_ARCHIVO) + '.';
        return null;
    }

    /** ¿Los primeros bytes son de verdad de ese tipo? Así un programa renombrado
        a .pdf no pasa. bytes: los primeros ~1 KB del archivo. */
    function firmaValida(ext, bytes) {
        const b = bytes || [];
        const en = (firma, desde) => firma.every((v, i) => b[(desde || 0) + i] === v);
        const zip = [0x50, 0x4B];                       // .docx / .xlsx son un ZIP
        const ole = [0xD0, 0xCF, 0x11, 0xE0];          // .doc / .xls de Office 97-2003
        if (ext === 'pdf') {                           // «%PDF» dentro del primer KB
            for (let i = 0; i + 4 <= Math.min(b.length, 1024); i++) if (en([0x25, 0x50, 0x44, 0x46], i)) return true;
            return false;
        }
        if (ext === 'png') return en([0x89, 0x50, 0x4E, 0x47]);
        if (ext === 'jpg') return en([0xFF, 0xD8, 0xFF]);
        if (ext === 'docx' || ext === 'xlsx') return en(zip);
        if (ext === 'doc' || ext === 'xls') return en(ole) || en(zip);
        return false;
    }

    /** Todas las rutas de archivos de una tarea: evidencias y los de sus subtareas. */
    function rutasDeArchivos(t) {
        const ev = ((t && t.evidencias) || []).map(e => e && e.path);
        const ck = ((t && t.checklist) || []).flatMap(i => ((i && i.archivos) || []).map(a => a && a.path));
        return ev.concat(ck).filter(Boolean);
    }

    /* ---------- Personas ---------- */

    const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);

    function iniciales(nombre) {
        const limpio = String(nombre || '').replace(/@.*/, '').replace(/[._]/g, ' ').trim();
        const palabras = limpio.split(/\s+/).filter(p => p && !PARTICULAS.has(p.toLowerCase()));
        if (!palabras.length) return '?';
        if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
        // Nombre + primer apellido: "Isaac Azhael López Cancino" → IL,
        // "Gonzalo Sandoval González" → GS.
        const apellido = palabras.length >= 3 ? palabras[palabras.length - 2] : palabras[1];
        return (palabras[0][0] + apellido[0]).toUpperCase();
    }

    const PALETA_PERSONAS = ['#4f46e5', '#0891b2', '#be185d', '#15803d', '#b45309', '#7c3aed', '#0f766e', '#c2410c', '#1d4ed8', '#9f1239'];
    function colorDeNombre(nombre) {
        const s = normalizar(nombre);
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return PALETA_PERSONAS[h % PALETA_PERSONAS.length];
    }

    /* ---------- WhatsApp ---------- */

    /** Número para wa.me: sólo dígitos, con 52 si viene a 10 dígitos. '' si no sirve. */
    function telefonoWhatsApp(raw) {
        let d = String(raw || '').replace(/\D/g, '');
        if (d.length === 10) d = '52' + d;
        if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
        return d.length >= 11 && d.length <= 15 ? d : '';
    }

    function mensajeWhatsApp(t, hoy, firma) {
        const sd = SUBDIR[t.subdireccion];
        const est = EST[t.estatus];
        const prio = PRIO[t.prioridad];
        const sit = situacion(t, hoy);
        const saludo = t.responsable ? 'Hola ' + String(t.responsable).trim().split(/\s+/)[0] + ', ' : 'Hola, ';
        const lineas = [
            '*AIFA · Dirección de Operación — Seguimiento*',
            '',
            saludo + 'te comparto el recordatorio de esta actividad:',
            '',
            '📌 *' + String(t.titulo || '').trim() + '*' + (t.folio ? ' (' + folio(t.folio) + ')' : ''),
        ];
        if (sd) lineas.push('🏢 ' + sd.nombre + (t.gerencia ? ' · ' + t.gerencia : ''));
        if (t.fecha_limite) {
            const cuando = sit === 'vencida' ? 'venció ' + relativo(t.fecha_limite, hoy)
                : sit === 'vence_hoy' ? 'vence hoy' : 'vence ' + relativo(t.fecha_limite, hoy);
            lineas.push('📅 Fecha límite: ' + fechaLarga(t.fecha_limite) + ' (' + cuando + ')');
        }
        if (est) lineas.push('🚦 Estatus: ' + est.nombre + (prio ? ' · Prioridad ' + prio.nombre.toLowerCase() : ''));
        if (t.referencia) lineas.push('📄 Referencia: ' + t.referencia);
        const pendientes = (Array.isArray(t.checklist) ? t.checklist : []).filter(i => i && !i.hecho).map(i => '   ▫️ ' + i.texto);
        if (pendientes.length) lineas.push('', 'Pendiente por atender:', ...pendientes.slice(0, 8));
        lineas.push('', sit === 'vencida'
            ? 'La fecha ya pasó: por favor infórmame hoy el avance y la nueva fecha de cumplimiento.'
            : 'Por favor compárteme el avance. Gracias.');
        if (firma) lineas.push('', '— ' + firma);
        return lineas.join('\n');
    }

    function urlWhatsApp(t, hoy, firma) {
        const tel = telefonoWhatsApp(t.responsable_tel);
        return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(mensajeWhatsApp(t, hoy, firma));
    }

    /* ---------- Varios ---------- */

    /** 12 caracteres [a-z0-9]: id de subtarea y nombre de archivo de evidencia
        (la política del bucket exige de 6 a 64 de esos caracteres). */
    function idCorto() {
        const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(12)) : null;
        let s = '';
        for (let i = 0; i < 12; i++) s += abc[(c ? c[i] : Math.floor(Math.random() * 256)) % abc.length];
        return s;
    }

    /** Etiquetas desde un texto con comas: sin repetidas ni vacías. */
    function etiquetasDeTexto(texto) {
        const vistas = new Set();
        return String(texto || '').split(/[,;]/).map(s => s.trim().replace(/^#/, '')).filter(s => {
            const k = normalizar(s);
            if (!k || vistas.has(k)) return false;
            vistas.add(k);
            return true;
        }).slice(0, 12);
    }

    /** Lo que cambió entre dos versiones de una tarea, para la bitácora. */
    const CAMPOS_BITACORA = ['titulo', 'estatus', 'prioridad', 'subdireccion', 'gerencia', 'responsable', 'fecha_inicio', 'fecha_limite', 'recurrencia', 'recurrencia_meses', 'tipo'];
    function cambios(antes, despues) {
        return CAMPOS_BITACORA
            .filter(k => k in (despues || {}) && String((antes || {})[k] ?? '') !== String(despues[k] ?? ''))
            .map(k => ({ campo: k, de: (antes || {})[k] ?? null, a: despues[k] ?? null }));
    }

    /** Texto legible de un valor de catálogo para la bitácora. */
    function etiquetaValor(campo, valor) {
        if (valor == null || valor === '') return '—';
        if (campo === 'estatus') return (EST[valor] || {}).nombre || valor;
        if (campo === 'prioridad') return (PRIO[valor] || {}).nombre || valor;
        if (campo === 'subdireccion') return (SUBDIR[valor] || {}).corto || valor;
        if (campo === 'tipo') return (TIPO[valor] || {}).nombre || valor;
        if (campo === 'recurrencia') return (RECU[valor] || {}).nombre || valor;
        if (campo === 'clase') return valor === 'diaria' ? 'Diarias' : 'Agenda';
        if (campo === 'recurrencia_meses') return textoCada(valor);
        if (campo === 'fecha_limite' || campo === 'fecha_inicio') return fechaCorta(valor);
        return String(valor);
    }

    return Object.freeze({
        SUBDIRECCIONES, ESTATUS, PRIORIDADES, TIPOS, RECURRENCIAS, AGRUPACIONES, SITUACIONES,
        SUBDIR, EST, PRIO, TIPO, RECU, ABIERTOS,
        CLASES, claseDe, diasRecurrencia, seRepite, esLaborable, fechaSiguiente, agendaDelDia,
        estaAbierta, aISO, hoyISO, deISO, diasEntre, sumarDias, sumarMeses, fechaCorta, fechaLarga, relativo,
        situacion, completadaATiempo, siguienteOcurrencia,
        PERSONALIZADA, MAX_MESES, mesesRecurrencia, textoCada, nombreRecurrencia, recurrenciaDeMeses,
        normalizar, folio, filtrar, ordenar, agrupar,
        estadisticas, estadisticasPorSubdireccion, avanceChecklist,
        subtareasConFecha, periodoTarea, subtareaFueraDePeriodo, sugerirFechasSubtarea, repartirSubtareas,
        inicioSubtarea, diasSubtarea, ajustarFechasSubtarea, diasCubiertos,
        posiblesDuplicadas, bloqueaDuplicado,
        alcanceDeArea, alcancesPosibles, filtrarAlcance, urgenciaMando, resumenMando, desgloseMando,
        PERIODOS, rangoPeriodo, textoRango, fichaTerminada, reporteEjecutivo, destacadosReporte,
        ARCHIVOS, MAX_ARCHIVO, LIMITES, tamanoTexto, firmaValida, extensionArchivo, datosArchivo, problemaArchivo, rutasDeArchivos,
        ALCANCE_DIRECCION, alcanceDeAcceso, dentroDeAlcance, subdireccionesPermitidas, gerenciasPermitidas, nombreAlcanceArea,
        areaDeColaborador, colaboradorDeCuenta,
        iniciales, colorDeNombre, telefonoWhatsApp, mensajeWhatsApp, urlWhatsApp,
        idCorto, etiquetasDeTexto, cambios, etiquetaValor, MESES_LARGOS,
    });
});
