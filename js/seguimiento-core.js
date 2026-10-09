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
    // de los conteos de pendientes.
    const ESTATUS = Object.freeze([
        { clave: 'pendiente',   nombre: 'Pendiente',   color: '#64748b', icono: 'circle' },
        { clave: 'en_proceso',  nombre: 'En proceso',  color: '#2563eb', icono: 'circle-half-stroke' },
        { clave: 'en_revision', nombre: 'En revisión', color: '#9333ea', icono: 'magnifying-glass' },
        { clave: 'detenida',    nombre: 'Detenida',    color: '#ea580c', icono: 'circle-pause' },
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

    const RECURRENCIAS = Object.freeze([
        { clave: 'ninguna',    nombre: 'No se repite', meses: 0 },
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

    const ABIERTOS = Object.freeze(['pendiente', 'en_proceso', 'en_revision', 'detenida']);
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
     *   completada · cancelada · sin_fecha · vencida · vence_hoy · por_vencer · a_tiempo
     * "por_vencer" es dentro de los días de aviso de la propia tarea.
     */
    function situacion(t, hoy) {
        if (!t) return 'sin_fecha';
        if (t.estatus === 'completada') return 'completada';
        if (t.estatus === 'cancelada') return 'cancelada';
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
        completada: { nombre: 'Completadas',  color: '#16a34a', orden: 5 },
        cancelada:  { nombre: 'Canceladas',   color: '#94a3b8', orden: 6 },
    });

    /** ¿Se completó a tiempo? null si no está completada o no tenía fecha. */
    function completadaATiempo(t) {
        if (!t || t.estatus !== 'completada' || !t.fecha_limite || !t.completada_en) return null;
        const cierre = aISO(new Date(t.completada_en));
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

    function nombreRecurrencia(t) { return textoCada(mesesRecurrencia(t)); }

    /** Lo que se guarda al elegir "cada N meses": la opción fija si existe, si no la personalizada. */
    function recurrenciaDeMeses(meses) {
        const n = parseInt(meses, 10) || 0;
        if (!n) return { recurrencia: 'ninguna', recurrencia_meses: null };
        const fija = RECURRENCIAS.find(r => r.meses === n);
        return fija ? { recurrencia: fija.clave, recurrencia_meses: null } : { recurrencia: PERSONALIZADA, recurrencia_meses: n };
    }

    function siguienteOcurrencia(t) {
        const meses = mesesRecurrencia(t);
        if (!meses || !t.fecha_limite) return null;
        const limite = sumarMeses(t.fecha_limite, meses);
        const duracion = t.fecha_inicio ? diasEntre(t.fecha_inicio, t.fecha_limite) : null;
        const checklist = Array.isArray(t.checklist)
            ? t.checklist.map(i => ({ id: i.id, texto: i.texto, hecho: false }))
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
                .filter(g => g.tareas.length || ABIERTOS.includes(g.clave));
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
        const s = { total: 0, abiertas: 0, pendientes: 0, en_proceso: 0, completadas: 0, vencidas: 0, por_vencer: 0,
                    completadas_mes: 0, a_tiempo: 0, con_fecha_cerradas: 0, cumplimiento: null };
        const mes = String(hoy || hoyISO()).slice(0, 7);
        lista.forEach(t => {
            if (t.estatus === 'cancelada') return;
            s.total++;
            const sit = situacion(t, hoy);
            if (estaAbierta(t)) {
                s.abiertas++;
                if (t.estatus === 'pendiente') s.pendientes++; else s.en_proceso++;
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

    /** Avance del checklist: { hechos, total, pct }. */
    function avanceChecklist(t) {
        const items = Array.isArray(t && t.checklist) ? t.checklist : [];
        const hechos = items.filter(i => i && i.hecho).length;
        return { hechos, total: items.length, pct: items.length ? Math.round(hechos * 100 / items.length) : 0 };
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
        if (campo === 'recurrencia_meses') return textoCada(valor);
        if (campo === 'fecha_limite' || campo === 'fecha_inicio') return fechaCorta(valor);
        return String(valor);
    }

    return Object.freeze({
        SUBDIRECCIONES, ESTATUS, PRIORIDADES, TIPOS, RECURRENCIAS, AGRUPACIONES, SITUACIONES,
        SUBDIR, EST, PRIO, TIPO, RECU, ABIERTOS,
        estaAbierta, aISO, hoyISO, deISO, diasEntre, sumarDias, sumarMeses, fechaCorta, fechaLarga, relativo,
        situacion, completadaATiempo, siguienteOcurrencia,
        PERSONALIZADA, MAX_MESES, mesesRecurrencia, textoCada, nombreRecurrencia, recurrenciaDeMeses,
        normalizar, folio, filtrar, ordenar, agrupar,
        estadisticas, estadisticasPorSubdireccion, avanceChecklist,
        iniciales, colorDeNombre, telefonoWhatsApp, mensajeWhatsApp, urlWhatsApp,
        idCorto, etiquetasDeTexto, cambios, etiquetaValor, MESES_LARGOS,
    });
});
