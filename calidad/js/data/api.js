(function () {
  'use strict';
  /**
   * api.js — Capa de acceso a datos.
   *
   * Las vistas SOLO hablan con este módulo. Los registros vienen de la base de
   * AIFA Operaciones (data/fuente, tablas calidad_*); aquí se filtran y se
   * calculan los indicadores, con la misma firma y forma de respuesta que tenía
   * la versión ilustrativa, de modo que las vistas no cambian.
   */
  const fuente = SIGEC.use('data/fuente');
  const { TIPOS_INCIDENCIA, AEROLINEAS, NIVELES, SEVERIDADES, ESTADOS, DOC_CATEGORIAS, CANALES_ENCUESTA, AREAS_EVALUADAS, slaDe } = SIGEC.use('data/catalogs');
  const { startOfDay, endOfDay, addDays, dayMonth } = SIGEC.use('core/format');
  const clone = (x) => structuredClone(x);
  const DAY = 86400000;

  // Última lectura de la base. Cada función pública la refresca (con la copia
  // de unos segundos que guarda fuente.js) antes de calcular.
  let DB = { now: new Date(), cargado: null, incidencias: [], encuestasPasajeros: [], encuestasAerolineas: [], documentos: [], directorio: [] };
  async function cargar() {
    DB = await fuente.datos();
    return DB;
  }

  // ------------------------------------------------------------ Utilidades
  function resolveRange(f = {}) {
    const now = new Date();
    if (f.periodo === 'custom' && f.desde && f.hasta) {
      const a = startOfDay(f.desde), b = endOfDay(f.hasta);
      return a <= b ? { desde: a, hasta: b } : { desde: startOfDay(f.hasta), hasta: endOfDay(f.desde) };
    }
    if (f.periodo === 'todo') return { desde: new Date(0), hasta: now };
    const days = Number(f.periodo) || 30;
    return { desde: startOfDay(addDays(now, -(days - 1))), hasta: now };
  }

  function prevRange({ desde, hasta }) {
    const len = hasta - desde;
    return { desde: new Date(desde.getTime() - len - 1), hasta: new Date(desde.getTime() - 1) };
  }

  const inRange = (d, r) => d >= r.desde && d <= r.hasta;

  function matchInc(inc, f) {
    if (f.aerolinea && inc.aerolinea !== f.aerolinea) return false;
    if (f.tipo && inc.tipo !== f.tipo) return false;
    if (f.nivel && inc.nivel !== f.nivel) return false;
    if (f.estado && inc.estado !== f.estado) return false;
    if (f.severidad && inc.severidad !== f.severidad) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!(`${inc.folio} ${inc.vuelo} ${inc.equipo} ${inc.observaciones}`.toLowerCase().includes(q))) return false;
    }
    return true;
  }

  const incIn = (r, f) => DB.incidencias.filter((i) => inRange(i.fecha, r) && matchInc(i, f));
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const share = (n, d) => (d ? (n / d) * 100 : 0);

  /** Divide un rango en cubetas (diarias o semanales). */
  function buckets(r, forceCount, dailyMax = 45) {
    const days = Math.max(1, Math.round((r.hasta - r.desde) / DAY));
    const step = forceCount ? (r.hasta - r.desde) / forceCount : (days <= dailyMax ? DAY : 7 * DAY);
    const out = [];
    for (let t = r.desde.getTime(); t < r.hasta.getTime(); t += step) {
      out.push({ desde: new Date(t), hasta: new Date(Math.min(t + step - 1, r.hasta.getTime())) });
    }
    return { list: out, weekly: !forceCount && days > dailyMax };
  }

  const countIn = (rows, b) => rows.filter((x) => x.fecha >= b.desde && x.fecha <= b.hasta).length;

  // ----------------------------------------------------------- Dashboard
  async function getDashboard(f = {}) {
    await cargar();
    const r = resolveRange(f);
    const p = prevRange(r);
    const cur = incIn(r, f);
    const prev = incIn(p, f);

    const by = (rows, key, value) => rows.filter((x) => x[key] === value);
    const sparkB = buckets(r, 12).list;
    const spark = (rows, fn = (sub) => sub.length) => sparkB.map((b) => fn(rows.filter((x) => x.fecha >= b.desde && x.fecha <= b.hasta)));
    const atencion = (rows) => avg(rows.map((x) => x.tiempoAtencion).filter((x) => x != null));

    const kpi = (curRows, prevRows, sparkFn) => ({ value: curRows.length, prev: prevRows.length, spark: spark(curRows, sparkFn) });
    const kpis = {
      registradas: kpi(cur, prev),
      pendientes: kpi(by(cur, 'estado', 'Pendiente'), by(prev, 'estado', 'Pendiente')),
      enProceso: kpi(by(cur, 'estado', 'En proceso'), by(prev, 'estado', 'En proceso')),
      solucionadas: kpi(by(cur, 'estado', 'Solucionada'), by(prev, 'estado', 'Solucionada')),
      atencion: { value: atencion(cur), prev: atencion(prev), spark: spark(cur, (sub) => atencion(sub) ?? 0) },
    };

    const porTipo = TIPOS_INCIDENCIA.map((t) => ({ label: t, value: by(cur, 'tipo', t).length }))
      .sort((a, b) => b.value - a.value);

    const tb = buckets(r);
    const pb = buckets(p);
    const tendencia = {
      weekly: tb.weekly,
      labels: tb.list.map((b) => (tb.weekly ? `Sem ${dayMonth(b.desde)}` : dayMonth(b.desde))),
      actual: tb.list.map((b) => countIn(cur, b)),
      anterior: tb.list.map((_, i) => (pb.list[i] ? countIn(prev, pb.list[i]) : null)),
    };

    const severidad = SEVERIDADES.map((s) => ({ ...s, value: by(cur, 'severidad', s.code).length }));
    const porNivel = NIVELES.map((n) => ({ label: n.code, name: n.name, value: by(cur, 'nivel', n.code).length }));

    const encP = DB.encuestasPasajeros.filter((e) => inRange(e.fecha, r) && (!f.aerolinea || e.aerolinea === f.aerolinea));
    const encA = DB.encuestasAerolineas.filter((e) => inRange(e.fecha, r) && (!f.aerolinea || e.aerolinea === f.aerolinea));
    const satisfaccion = {
      pasajeros: share(encP.filter((e) => e.calificacion >= 4).length, encP.length),
      pasajerosN: encP.length,
      aerolineas: share(encA.filter((e) => e.calificacion >= 4).length, encA.length),
      aerolineasN: encA.length,
    };

    return clone({ rango: r, kpis, porTipo, tendencia, severidad, porNivel, satisfaccion, total: cur.length, actualizado: new Date() });
  }

  // ------------------------------------------------- Análisis de calidad
  async function getCalidad(f = {}) {
    await cargar();
    const r = resolveRange(f);
    const p = prevRange(r);
    const encF = (e, rr) => inRange(e.fecha, rr) && (!f.aerolinea || e.aerolinea === f.aerolinea);
    const cur = DB.encuestasPasajeros.filter((e) => encF(e, r));
    const prev = DB.encuestasPasajeros.filter((e) => encF(e, p));
    const promedio = (rows) => avg(rows.map((e) => e.calificacion));
    const recomienda = (rows) => share(rows.filter((e) => e.recomienda).length, rows.length);

    const incCur = incIn(r, f).filter((i) => i.estado === 'Solucionada');
    const incPrev = incIn(p, f).filter((i) => i.estado === 'Solucionada');
    const enSla = (rows) => share(rows.filter((i) => i.tiempoResolucion <= slaDe(i.severidad)).length, rows.length);
    const resol = (rows) => avg(rows.map((i) => i.tiempoResolucion));

    const kpis = {
      satisfaccion: { value: promedio(cur), prev: promedio(prev) },
      recomienda: { value: recomienda(cur), prev: recomienda(prev) },
      respuestas: { value: cur.length, prev: prev.length },
      sla: { value: enSla(incCur), prev: enSla(incPrev) },
      resolucion: { value: resol(incCur), prev: resol(incPrev) },
    };

    const porAerolinea = AEROLINEAS
      .map((a) => {
        const rows = DB.encuestasPasajeros.filter((e) => inRange(e.fecha, r) && e.aerolinea === a.code);
        return { label: a.name, code: a.code, value: promedio(rows) ?? 0, n: rows.length };
      })
      .filter((x) => x.n > 0)
      .sort((a, b) => b.value - a.value);

    const distribucion = [5, 4, 3, 2, 1].map((c) => ({ label: `${c} ★`, cal: c, value: cur.filter((e) => e.calificacion === c).length }));

    const tb = buckets(r, null, 14); // muestras diarias pequeñas: agrupar por semana
    const tendencia = {
      weekly: tb.weekly,
      labels: tb.list.map((b) => (tb.weekly ? `Sem ${dayMonth(b.desde)}` : dayMonth(b.desde))),
      values: tb.list.map((b) => {
        const rows = cur.filter((e) => e.fecha >= b.desde && e.fecha <= b.hasta);
        return rows.length ? +share(rows.filter((e) => e.calificacion >= 4).length, rows.length).toFixed(1) : null;
      }),
    };

    const slaPorSeveridad = SEVERIDADES.map((s) => {
      const rows = incCur.filter((i) => i.severidad === s.code);
      return { label: s.code, sla: s.slaHoras, value: +enSla(rows).toFixed(1), n: rows.length };
    });

    const comentarios = cur.filter((e) => e.comentario).sort((a, b) => b.fecha - a.fecha).slice(0, 6);

    return clone({ rango: r, kpis, porAerolinea, distribucion, tendencia, slaPorSeveridad, comentarios });
  }

  // ---------------------------------------------------------- Incidencias
  const SORTERS = {
    folio: (a, b) => a.id - b.id,
    fecha: (a, b) => a.fecha - b.fecha,
    tipo: (a, b) => a.tipo.localeCompare(b.tipo, 'es'),
    aerolinea: (a, b) => a.aerolinea.localeCompare(b.aerolinea),
    estado: (a, b) => a.estado.localeCompare(b.estado, 'es'),
    severidad: (a, b) => SEVERIDADES.findIndex((s) => s.code === a.severidad) - SEVERIDADES.findIndex((s) => s.code === b.severidad),
  };

  function queryIncidencias(f) {
    const r = resolveRange(f);
    return incIn(r, f);
  }

  async function listIncidencias({ filters = {}, page = 1, pageSize = 10, sort = { key: 'fecha', dir: 'desc' } } = {}) {
    await cargar();
    const rows = queryIncidencias(filters);
    const cmp = SORTERS[sort.key] || SORTERS.fecha;
    rows.sort((a, b) => (sort.dir === 'asc' ? cmp(a, b) : cmp(b, a)));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const pg = Math.min(Math.max(1, page), pages);
    return clone({ rows: rows.slice((pg - 1) * pageSize, pg * pageSize), total, page: pg, pages, pageSize });
  }

  async function exportIncidencias(filters = {}) {
    await cargar();
    return clone(queryIncidencias(filters).sort((a, b) => b.fecha - a.fecha));
  }

  async function getIncidencia(folio) {
    if (!/^INC-\d{4}-\d{4,}$/.test(String(folio || ''))) return null;
    return fuente.incidencia(folio);
  }

  const VUELO_RE = /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/;
  function validarIncidencia(d) {
    const errors = {};
    if (!TIPOS_INCIDENCIA.includes(d.tipo)) errors.tipo = 'Selecciona un tipo válido.';
    if (!AEROLINEAS.some((a) => a.code === d.aerolinea)) errors.aerolinea = 'Selecciona una aerolínea.';
    if (!VUELO_RE.test(String(d.vuelo || '').toUpperCase())) errors.vuelo = 'Formato de vuelo inválido (ej. AMX1345).';
    if (!NIVELES.some((n) => n.code === d.nivel)) errors.nivel = 'Selecciona un nivel.';
    if (!SEVERIDADES.some((s) => s.code === d.severidad)) errors.severidad = 'Selecciona la severidad.';
    const desc = String(d.descripcion || '').trim();
    if (desc.length < 10 || desc.length > 500) errors.descripcion = 'Describe la incidencia (10 a 500 caracteres).';
    const f = new Date(d.fecha);
    if (Number.isNaN(f.getTime()) || f > new Date(Date.now() + 5 * 60000)) errors.fecha = 'La fecha no puede ser futura.';
    if (d.equipo && !/^[A-Za-z0-9 _\-./]{1,30}$/.test(d.equipo)) errors.equipo = 'Solo letras, números y - _ . /';
    return errors;
  }

  /** data.evidencia: el archivo de imagen (File) o null. */
  async function crearIncidencia(data, usuario) {
    const errors = validarIncidencia(data);
    if (Object.keys(errors).length) { const e = new Error('Datos inválidos'); e.fields = errors; throw e; }
    return fuente.crearIncidencia(data, usuario);
  }

  async function actualizarEstado(folio, estado, nota, usuario) {
    if (!ESTADOS.some((e) => e.code === estado)) throw new Error('Estado inválido');
    return fuente.actualizarEstado(folio, estado, nota, usuario);
  }

  async function contarPendientes() {
    await cargar();
    return DB.incidencias.filter((i) => i.estado === 'Pendiente').length;
  }

  // ------------------------------------------------------------ Encuestas
  async function listEncuestas(tipo, { filters = {}, page = 1, pageSize = 10 } = {}) {
    await cargar();
    const src = tipo === 'aerolineas' ? DB.encuestasAerolineas : DB.encuestasPasajeros;
    const r = resolveRange(filters);
    const rows = src.filter((e) =>
      inRange(e.fecha, r) &&
      (!filters.aerolinea || e.aerolinea === filters.aerolinea) &&
      (!filters.calificacion || e.calificacion === Number(filters.calificacion)) &&
      (!filters.recomienda || (filters.recomienda === 'si') === e.recomienda) &&
      (!filters.q || (e.comentario || '').toLowerCase().includes(filters.q.toLowerCase())))
      .sort((a, b) => b.fecha - a.fecha);
    const total = rows.length;
    const dist = [5, 4, 3, 2, 1].map((c) => ({ cal: c, value: rows.filter((e) => e.calificacion === c).length }));
    const resumen = {
      total,
      promedio: avg(rows.map((e) => e.calificacion)),
      recomienda: share(rows.filter((e) => e.recomienda).length, total),
      negativas: rows.filter((e) => e.calificacion <= 2).length,
      dist,
    };
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const pg = Math.min(Math.max(1, page), pages);
    return clone({ rows: rows.slice((pg - 1) * pageSize, pg * pageSize), total, page: pg, pages, pageSize, resumen });
  }

  async function exportEncuestas(tipo, filters = {}) {
    const res = await listEncuestas(tipo, { filters, page: 1, pageSize: 100000 });
    return res.rows;
  }

  function validarEncuesta(tipo, d) {
    const errors = {};
    if (!AEROLINEAS.some((a) => a.code === d.aerolinea)) errors.aerolinea = 'Selecciona una aerolínea.';
    const cal = Number(d.calificacion);
    if (!Number.isInteger(cal) || cal < 1 || cal > 5) errors.calificacion = 'Elige una calificación de 1 a 5.';
    if (!['si', 'no'].includes(d.recomienda)) errors.recomienda = 'Indica si recomendaría el servicio.';
    const f = new Date(d.fecha);
    if (Number.isNaN(f.getTime()) || f > new Date(Date.now() + 5 * 60000)) errors.fecha = 'La fecha no puede ser futura.';
    if (String(d.comentario || '').length > 500) errors.comentario = 'Máximo 500 caracteres.';
    if (tipo === 'aerolineas') {
      if (!AREAS_EVALUADAS.includes(d.area)) errors.area = 'Selecciona el área evaluada.';
      const ev = String(d.evaluador || '').trim();
      if (ev.length < 3 || ev.length > 120) errors.evaluador = 'Escribe quién evalúa (3 a 120 caracteres).';
    } else if (!CANALES_ENCUESTA.includes(d.canal)) {
      errors.canal = 'Selecciona el canal.';
    }
    return errors;
  }

  async function crearEncuesta(tipo, data, usuario) {
    const errors = validarEncuesta(tipo, data);
    if (Object.keys(errors).length) { const e = new Error('Datos inválidos'); e.fields = errors; throw e; }
    return fuente.crearEncuesta(tipo === 'aerolineas' ? 'aerolineas' : 'pasajeros', data, usuario);
  }

  // ----------------------------------------------------------- Documentos
  /** Solo la versión vigente de cada código: la publicada más recientemente. */
  function vigentes(docs) {
    const porCodigo = new Map();
    docs.forEach((d) => {
      const prev = porCodigo.get(d.codigo);
      if (!prev || d.fecha > prev.fecha || (+d.fecha === +prev.fecha && d.id > prev.id)) porCodigo.set(d.codigo, d);
    });
    return [...porCodigo.values()];
  }

  async function listDocumentos(cat, q = '') {
    await cargar();
    const qq = q.trim().toLowerCase();
    const match = (d) => !qq || `${d.nombre} ${d.codigo} ${d.descripcion} ${d.tipo}`.toLowerCase().includes(qq);
    const docs = vigentes(DB.documentos);
    const counts = Object.fromEntries(DOC_CATEGORIAS.map((c) => [c.id, docs.filter((d) => d.cat === c.id && match(d)).length]));
    const rows = docs.filter((d) => d.cat === cat && match(d)).sort((a, b) => b.fecha - a.fecha);
    return clone({ rows, counts });
  }

  /** doc: { nombre, codigo, version, cat, tipo, descripcion, formato, kb, archivo (File) } */
  async function agregarDocumento(doc, usuario) {
    return fuente.agregarDocumento(doc, usuario);
  }

  /** Enlace temporal para descargar el documento. */
  async function urlDocumento(id) {
    await cargar();
    const doc = DB.documentos.find((d) => d.id === Number(id));
    if (!doc) throw Object.assign(new Error('El documento ya no está disponible.'), { amigable: true });
    return fuente.urlDocumento(doc);
  }

  // ----------------------------------------------------------- Directorio
  async function listDirectorio(q = '', area = '') {
    await cargar();
    const qq = q.trim().toLowerCase();
    return clone(DB.directorio
      .filter((p) =>
        (!area || p.area === area) &&
        (!qq || `${p.nombre} ${p.cargo} ${p.area} ${p.ext}`.toLowerCase().includes(qq)))
      .sort((a, b) => a.orden - b.orden || a.area.localeCompare(b.area, 'es') || a.nombre.localeCompare(b.nombre, 'es')));
  }

  const EXT_RE = /^\d{2,6}$/;
  const CORREO_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function validarContacto(p) {
    const errors = {};
    const nombre = String(p.nombre || '').trim();
    if (nombre.length < 3 || nombre.length > 120) errors.nombre = 'Escribe el nombre (3 a 120 caracteres).';
    const area = String(p.area || '').trim();
    if (!area || area.length > 80) errors.area = 'Selecciona el área.';
    if (String(p.cargo || '').length > 120) errors.cargo = 'Máximo 120 caracteres.';
    if (p.ext && !EXT_RE.test(String(p.ext).trim())) errors.ext = 'Solo números (2 a 6 dígitos).';
    if (p.correo && !CORREO_RE.test(String(p.correo).trim())) errors.correo = 'Correo inválido.';
    if (String(p.turno || '').length > 60) errors.turno = 'Máximo 60 caracteres.';
    return errors;
  }

  async function guardarContacto(p) {
    const errors = validarContacto(p);
    if (Object.keys(errors).length) { const e = new Error('Datos inválidos'); e.fields = errors; throw e; }
    return fuente.guardarContacto(p);
  }

  async function eliminarContacto(id) {
    return fuente.eliminarContacto(Number(id));
  }

  // ------------------------------------------------------------- Usuarios
  /** Cuentas de AIFA Operaciones con acceso a Calidad (solo administradores). */
  async function listUsuarios() {
    return fuente.usuarios();
  }

  // -------------------------------------------------------- Notificaciones
  /** prefs: { criticas, nuevas, sla, encuestas, documentos } — true/false por tipo. */
  async function getNotificaciones(prefs = {}) {
    await cargar();
    const now = Date.now();
    const abiertas = DB.incidencias.filter((i) => i.estado !== 'Solucionada').sort((a, b) => b.fecha - a.fecha);
    const list = [];
    const addInc = (i, extra) => {
      if (list.some((n) => n.id === `inc-${i.folio}`)) return;
      list.push({ id: `inc-${i.folio}`, title: `${i.folio} · ${i.tipo}`, fecha: i.fecha, href: `#/reportes?folio=${i.folio}`, ...extra });
    };
    if (prefs.criticas) {
      abiertas.filter((i) => i.severidad === 'Crítica' || i.severidad === 'Alta').slice(0, 3).forEach((i) => addInc(i, {
        kind: i.severidad === 'Crítica' ? 'crit' : 'serious', icon: 'bi-exclamation-triangle-fill', meta: `Severidad ${i.severidad.toLowerCase()} · ${i.vuelo}`,
      }));
    }
    if (prefs.sla) {
      abiertas.filter((i) => {
        const left = i.fecha.getTime() + slaDe(i.severidad) * 3600000 - now;
        return left > 0 && left <= 30 * 60000;
      }).forEach((i) => addInc(i, { kind: 'warn', icon: 'bi-hourglass-split', meta: 'A menos de 30 min de exceder su SLA' }));
    }
    if (prefs.nuevas) {
      abiertas.filter((i) => now - i.fecha < DAY).slice(0, 3).forEach((i) => addInc(i, { kind: 'info', icon: 'bi-plus-circle-fill', meta: `Nueva · severidad ${i.severidad.toLowerCase()}` }));
    }
    if (prefs.encuestas) {
      const e = [...DB.encuestasPasajeros].sort((a, b) => b.fecha - a.fecha).find((x) => x.calificacion <= 2 && x.comentario);
      if (e) list.push({ id: `enc-${e.id}`, kind: 'warn', icon: 'bi-emoji-frown-fill', title: `Encuesta con calificación ${e.calificacion}/5`, meta: `“${e.comentario}”`, fecha: e.fecha, href: '#/encuestas' });
    }
    if (prefs.documentos) {
      const doc = [...DB.documentos].sort((a, b) => b.fecha - a.fecha)[0];
      if (doc) list.push({ id: `doc-${doc.id}`, kind: 'info', icon: 'bi-file-earmark-arrow-up-fill', title: 'Documento actualizado', meta: `${doc.codigo} · ${doc.nombre}`, fecha: doc.fecha, href: '#/documentacion' });
    }
    return clone(list.sort((a, b) => b.fecha - a.fecha));
  }

  const lastUpdate = () => DB.cargado || new Date();

  /** La próxima consulta vuelve a leer la base (botón «Actualizar»). */
  function refrescar() { fuente.invalidar(); }

  SIGEC.define('data/api', {
    resolveRange, getDashboard, getCalidad, listIncidencias, exportIncidencias, getIncidencia, validarIncidencia, crearIncidencia,
    actualizarEstado, contarPendientes, listEncuestas, exportEncuestas, validarEncuesta, crearEncuesta, listDocumentos, agregarDocumento,
    urlDocumento, listDirectorio, validarContacto, guardarContacto, eliminarContacto, listUsuarios, getNotificaciones, lastUpdate, refrescar,
  });
})();
