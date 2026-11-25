(function () {
  'use strict';
  /**
   * fuente.js — Conexión con la base de AIFA Operaciones (Supabase).
   *
   * Tablas, reglas y buckets: db/calidad_sigec.sql. Lee las tablas completas y
   * las entrega con la misma forma que usaban los datos ilustrativos, así api.js
   * calcula indicadores igual que antes. Guarda la lectura unos segundos para no
   * repetir consultas al cambiar de pantalla; cada escritura la invalida.
   *
   * El cliente es el del sistema (config.supabase): misma sesión, mismas reglas
   * (RLS). La página solo oculta botones; quien autoriza es la base.
   */
  const cfg = window.SIGEC_CONFIG || {};
  const VIGENCIA_MS = 20000;
  const PAGINA = 1000;
  const MAX_PAGINAS = 200;
  const BUCKET_EVIDENCIAS = 'calidad-evidencias';
  const BUCKET_DOCUMENTOS = 'calidad-documentos';

  const TABLAS = {
    incidencias: 'calidad_incidencias',
    encuestasPasajeros: 'calidad_encuestas_pasajeros',
    encuestasAerolineas: 'calidad_encuestas_aerolineas',
    documentos: 'calidad_documentos',
    directorio: 'calidad_directorio',
  };

  const COLUMNAS = {
    calidad_incidencias: 'id,folio,fecha,tipo,aerolinea,vuelo,nivel,edificio,equipo,severidad,estado,descripcion,observaciones,tiempo_atencion,tiempo_resolucion,registrado_por,evidencia_path',
    calidad_encuestas_pasajeros: 'id,fecha,aerolinea,calificacion,recomienda,comentario,canal',
    calidad_encuestas_aerolineas: 'id,fecha,aerolinea,area,calificacion,recomienda,comentario,evaluador',
    calidad_documentos: 'id,cat,nombre,codigo,descripcion,tipo,version,formato,kb,archivo_path,archivo_nombre,fecha',
    calidad_directorio: 'id,nombre,cargo,area,ext,correo,turno,orden',
  };

  const MIME_DOC = {
    PDF: 'application/pdf',
    DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  // ------------------------------------------------------------ Errores
  /** Error con un texto que se puede mostrar tal cual (err.amigable). */
  function amigable(texto, extra) {
    return Object.assign(new Error(texto), { amigable: true }, extra || {});
  }

  function traducir(error, accion) {
    const code = String(error?.code ?? error?.statusCode ?? error?.status ?? '');
    const msg = String(error?.message ?? error ?? '');
    let texto;
    if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code) || /does not exist|could not find the (table|function)|bucket not found/i.test(msg)) {
      texto = 'Calidad aún no está instalado en la base de datos: falta correr db/calidad_sigec.sql en Supabase.';
    } else if (code === '42501' || code === '403' || /row-level security|permission denied|not authorized|unauthorized/i.test(msg)) {
      texto = /^[A-ZÁÉÍÓÚÑ¿]/.test(msg) && !/row-level|permission denied/i.test(msg) ? msg : 'Tu cuenta no tiene permiso para esta acción en Calidad.';
    } else if (code === '413' || /payload too large|exceeded the maximum allowed size/i.test(msg)) {
      texto = 'El archivo excede el tamaño permitido.';
    } else if (/mime type .* is not supported|invalid mime/i.test(msg)) {
      texto = 'Ese tipo de archivo no está permitido.';
    } else if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
      texto = 'Sin conexión con la base de datos. Revisa tu red e intenta de nuevo.';
    } else if (/JWT|session/i.test(msg)) {
      texto = 'Tu sesión venció. Vuelve a iniciar sesión en AIFA Operaciones.';
    } else if (['22023', '22007', 'P0001', 'P0002'].includes(code) && msg) {
      texto = msg; // mensajes escritos en la base para la persona
    } else {
      texto = `No fue posible ${accion}. Intenta de nuevo.`;
    }
    return amigable(texto, { code, causa: error });
  }

  // ------------------------------------------------------------- Cliente
  function cliente() {
    let c = null;
    try { c = typeof cfg.supabase === 'function' ? cfg.supabase() : null; } catch { c = null; }
    if (!c || typeof c.from !== 'function') {
      throw amigable('Sin conexión con la base de datos. Abre Calidad desde AIFA Operaciones.', { code: 'sin-cliente' });
    }
    return c;
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ------------------------------------------------------------ Lecturas
  const fecha = (v) => (v ? new Date(v) : null);
  const numero = (v) => (v == null || v === '' ? null : Number(v));

  const MAPEO = {
    calidad_incidencias: (r) => ({
      id: Number(r.id),
      folio: r.folio,
      fecha: fecha(r.fecha),
      tipo: r.tipo,
      aerolinea: r.aerolinea,
      vuelo: r.vuelo,
      nivel: r.nivel,
      edificio: r.edificio || 'T1',
      equipo: r.equipo || '—',
      severidad: r.severidad,
      estado: r.estado,
      descripcion: r.descripcion || '',
      observaciones: r.observaciones || '',
      tiempoAtencion: numero(r.tiempo_atencion),
      tiempoResolucion: numero(r.tiempo_resolucion),
      registradoPor: r.registrado_por || '—',
      evidencia: !!r.evidencia_path,
      evidenciaPath: r.evidencia_path || null,
      seguimiento: [],
    }),
    calidad_encuestas_pasajeros: (r) => ({
      id: Number(r.id), fecha: fecha(r.fecha), aerolinea: r.aerolinea, calificacion: Number(r.calificacion),
      recomienda: !!r.recomienda, comentario: r.comentario || '', canal: r.canal || '—',
    }),
    calidad_encuestas_aerolineas: (r) => ({
      id: Number(r.id), fecha: fecha(r.fecha), aerolinea: r.aerolinea, area: r.area || '—', calificacion: Number(r.calificacion),
      recomienda: !!r.recomienda, comentario: r.comentario || '', evaluador: r.evaluador || '',
    }),
    calidad_documentos: (r) => ({
      id: Number(r.id), cat: r.cat, nombre: r.nombre, codigo: r.codigo, descripcion: r.descripcion || '', tipo: r.tipo,
      version: r.version, formato: r.formato, kb: Number(r.kb) || 0, fecha: fecha(r.fecha),
      path: r.archivo_path, archivoNombre: r.archivo_nombre || '',
    }),
    calidad_directorio: (r) => ({
      id: Number(r.id), nombre: r.nombre, cargo: r.cargo || '', area: r.area, ext: r.ext || '', correo: r.correo || '',
      turno: r.turno || '', orden: Number(r.orden) || 0,
    }),
  };

  async function leerTodo(tabla) {
    const c = cliente();
    const filas = [];
    for (let p = 0; p < MAX_PAGINAS; p++) {
      const desde = p * PAGINA;
      const { data, error } = await c.from(tabla).select(COLUMNAS[tabla]).order('id', { ascending: true }).range(desde, desde + PAGINA - 1);
      if (error) throw traducir(error, 'cargar la información');
      const lote = Array.from(data || []);
      filas.push(...lote);
      if (lote.length < PAGINA) break;
    }
    return filas.map(MAPEO[tabla]);
  }

  let foto = null; // { t, promesa }

  /** Todas las tablas, con la forma { now, incidencias, encuestasPasajeros, … }. */
  function datos({ fresco = false } = {}) {
    if (!fresco && foto && Date.now() - foto.t < VIGENCIA_MS) return foto.promesa;
    const promesa = Promise.all(Object.entries(TABLAS).map(async ([clave, tabla]) => [clave, await leerTodo(tabla)]))
      .then((pares) => ({ now: new Date(), cargado: new Date(), ...Object.fromEntries(pares) }));
    const actual = { t: Date.now(), promesa };
    foto = actual;
    promesa.catch(() => { if (foto === actual) foto = null; });
    return promesa;
  }

  function invalidar() { foto = null; }

  async function urlFirmada(bucket, ruta, segundos, descarga) {
    const opciones = descarga ? { download: descarga } : undefined;
    const { data, error } = await cliente().storage.from(bucket).createSignedUrl(ruta, segundos, opciones);
    if (error || !data?.signedUrl) throw traducir(error || 'sin enlace', 'abrir el archivo');
    return data.signedUrl;
  }

  async function incidencia(folio) {
    const c = cliente();
    const { data, error } = await c.from(TABLAS.incidencias).select(COLUMNAS.calidad_incidencias).eq('folio', folio).maybeSingle();
    if (error) throw traducir(error, 'abrir la incidencia');
    if (!data) return null;
    const inc = MAPEO.calidad_incidencias(data);
    const seg = await c.from('calidad_incidencia_seguimiento').select('id,fecha,estado,nota,usuario')
      .eq('incidencia_id', data.id).order('fecha', { ascending: true }).order('id', { ascending: true });
    if (seg.error) throw traducir(seg.error, 'leer el seguimiento');
    inc.seguimiento = Array.from(seg.data || []).map((s) => ({ fecha: fecha(s.fecha), estado: s.estado, nota: s.nota, usuario: s.usuario || '—' }));
    if (inc.evidenciaPath) {
      try { inc.evidenciaUrl = await urlFirmada(BUCKET_EVIDENCIAS, inc.evidenciaPath, 600); } catch { inc.evidenciaUrl = null; }
    }
    return inc;
  }

  // ---------------------------------------------------------- Escrituras
  /**
   * El cliente vive en la ventana del sistema y allá `instanceof Blob` no
   * reconoce un archivo de este iframe: se rehace con el Blob de esa ventana.
   */
  async function cuerpoDeArchivo(archivo, tipo) {
    let B = window.Blob;
    try { if (window.parent && window.parent !== window && window.parent.Blob) B = window.parent.Blob; } catch { /* otro origen */ }
    return new B([await archivo.arrayBuffer()], { type: tipo });
  }

  async function subir(bucket, ruta, archivo, tipo) {
    const cuerpo = await cuerpoDeArchivo(archivo, tipo);
    const { error } = await cliente().storage.from(bucket).upload(ruta, cuerpo, { contentType: tipo, upsert: false, cacheControl: '3600' });
    if (error) throw traducir(error, 'subir el archivo');
  }

  function quitarArchivo(bucket, ruta) {
    try { Promise.resolve(cliente().storage.from(bucket).remove([ruta])).catch(() => {}); } catch { /* noop */ }
  }

  /** Tipo real de la imagen por su firma (magic bytes). */
  async function formatoImagen(archivo) {
    const h = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
    if (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
    if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) return { ext: 'png', mime: 'image/png' };
    if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
    return null;
  }

  const recortar = (v, n) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, n) : null;
  };

  async function crearIncidencia(data, usuario) {
    const c = cliente();
    const archivo = data.evidencia && typeof data.evidencia === 'object' && data.evidencia.size > 0 ? data.evidencia : null;
    let ruta = null;
    if (archivo) {
      const f = await formatoImagen(archivo);
      if (!f) throw amigable('La evidencia debe ser JPG, PNG o WEBP.', { fields: { evidencia: 'Formato no permitido. Usa JPG, PNG o WEBP.' } });
      if (archivo.size > 5 * 1024 * 1024) throw amigable('La imagen supera 5 MB.', { fields: { evidencia: 'La imagen supera 5 MB.' } });
      ruta = `incidencias/${uuid()}.${f.ext}`;
      await subir(BUCKET_EVIDENCIAS, ruta, archivo, f.mime);
    }
    const fila = {
      fecha: new Date(data.fecha).toISOString(),
      tipo: data.tipo,
      aerolinea: data.aerolinea,
      vuelo: String(data.vuelo || '').toUpperCase(),
      nivel: data.nivel,
      edificio: data.edificio || 'T1',
      equipo: recortar(data.equipo, 30),
      severidad: data.severidad,
      descripcion: String(data.descripcion || '').trim(),
      registrado_por: recortar(usuario?.name, 200),
      evidencia_path: ruta,
    };
    const { data: fila2, error } = await c.from(TABLAS.incidencias).insert(fila).select(COLUMNAS.calidad_incidencias).single();
    if (error) {
      if (ruta) quitarArchivo(BUCKET_EVIDENCIAS, ruta);
      throw traducir(error, 'registrar la incidencia');
    }
    invalidar();
    const inc = MAPEO.calidad_incidencias(fila2);
    inc.seguimiento = [{ fecha: new Date(), estado: 'Registrada', nota: 'Incidencia registrada en el sistema.', usuario: inc.registradoPor }];
    return inc;
  }

  async function actualizarEstado(folio, estado, nota, usuario) {
    const { error } = await cliente().rpc('calidad_actualizar_estado', {
      p_folio: folio,
      p_estado: estado,
      p_nota: String(nota || '').trim().slice(0, 300),
      p_usuario: recortar(usuario?.name, 200),
    });
    if (error) throw traducir(error, 'actualizar la incidencia');
    invalidar();
    return incidencia(folio);
  }

  async function crearEncuesta(tipo, data, usuario) {
    const tabla = tipo === 'aerolineas' ? TABLAS.encuestasAerolineas : TABLAS.encuestasPasajeros;
    const fila = {
      fecha: new Date(data.fecha).toISOString(),
      aerolinea: data.aerolinea,
      calificacion: Number(data.calificacion),
      recomienda: data.recomienda === 'si',
      comentario: recortar(data.comentario, 500),
      capturado_por: recortar(usuario?.name, 200),
    };
    if (tipo === 'aerolineas') {
      fila.area = data.area;
      fila.evaluador = recortar(data.evaluador, 120);
    } else {
      fila.canal = data.canal;
    }
    const { data: guardada, error } = await cliente().from(tabla).insert(fila).select(COLUMNAS[tabla]).single();
    if (error) throw traducir(error, 'guardar la encuesta');
    invalidar();
    return MAPEO[tabla](guardada);
  }

  async function agregarDocumento(doc, usuario) {
    const archivo = doc.archivo;
    const mime = MIME_DOC[doc.formato];
    if (!archivo || !mime) throw amigable('Selecciona un archivo PDF, DOCX, XLSX o PPTX.', { fields: { archivo: 'Selecciona un archivo válido.' } });
    const ruta = `${doc.cat}/${uuid()}.${doc.formato.toLowerCase()}`;
    await subir(BUCKET_DOCUMENTOS, ruta, archivo, mime);
    const fila = {
      cat: doc.cat,
      nombre: String(doc.nombre).trim(),
      codigo: String(doc.codigo).trim().toUpperCase(),
      descripcion: recortar(doc.descripcion, 160),
      tipo: doc.tipo,
      version: doc.version,
      formato: doc.formato,
      kb: Math.max(0, Math.round(Number(doc.kb) || 0)),
      archivo_path: ruta,
      archivo_nombre: recortar(archivo.name, 200),
      subido_por: recortar(usuario?.name, 200),
    };
    const { data, error } = await cliente().from(TABLAS.documentos).insert(fila).select(COLUMNAS.calidad_documentos).single();
    if (error) {
      quitarArchivo(BUCKET_DOCUMENTOS, ruta);
      throw traducir(error, 'publicar el documento');
    }
    invalidar();
    return MAPEO.calidad_documentos(data);
  }

  /** Enlace de descarga de corta duración (2 min), con un nombre legible. */
  async function urlDocumento(doc) {
    const limpio = `${doc.codigo} ${doc.nombre} v${doc.version}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
    return urlFirmada(BUCKET_DOCUMENTOS, doc.path, 120, `${limpio}.${String(doc.formato).toLowerCase()}`);
  }

  async function guardarContacto(p) {
    const fila = {
      nombre: String(p.nombre || '').trim(),
      cargo: recortar(p.cargo, 120),
      area: String(p.area || '').trim(),
      ext: recortar(p.ext, 6),
      correo: recortar(p.correo, 120),
      turno: recortar(p.turno, 60),
    };
    const c = cliente();
    const q = p.id ? c.from(TABLAS.directorio).update(fila).eq('id', p.id) : c.from(TABLAS.directorio).insert(fila);
    const { data, error } = await q.select(COLUMNAS.calidad_directorio).single();
    if (error) throw traducir(error, 'guardar el contacto');
    invalidar();
    return MAPEO.calidad_directorio(data);
  }

  async function eliminarContacto(id) {
    const { error } = await cliente().from(TABLAS.directorio).delete().eq('id', id);
    if (error) throw traducir(error, 'eliminar el contacto');
    invalidar();
  }

  async function usuarios() {
    const { data, error } = await cliente().rpc('calidad_usuarios');
    if (error) throw traducir(error, 'cargar los usuarios');
    return Array.from(data || []).map((u) => ({
      id: u.id,
      nombre: u.nombre || u.usuario,
      usuario: u.usuario,
      area: u.area || '—',
      rol: u.rol,
      activo: !!u.activo,
      ultimoAcceso: fecha(u.ultimo_acceso),
    }));
  }

  SIGEC.define('data/fuente', {
    TABLAS, datos, invalidar, incidencia, crearIncidencia, actualizarEstado, crearEncuesta,
    agregarDocumento, urlDocumento, guardarContacto, eliminarContacto, usuarios, traducir,
  });
})();
