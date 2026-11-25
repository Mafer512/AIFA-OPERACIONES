/**
 * Calidad (SIGEC) conectado a la base: las pantallas siguen hablando sólo con
 * calidad/js/data/api.js, que ahora lee y escribe las tablas calidad_* de
 * Supabase (db/calidad_sigec.sql) con el cliente del sistema. Aquí se usa un
 * Supabase falso en memoria con el mismo comportamiento que las reglas de la
 * base (folio por año, bitácora, cambio de estado por función).
 */
const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const ARCHIVOS = ['js/sigec.js', 'js/core/format.js', 'js/core/dom.js', 'js/data/catalogs.js', 'js/data/fuente.js', 'js/data/api.js'];

const DIA = 86400000;
const hace = (ms) => new Date(Date.now() - ms).toISOString();

function supabaseFalso(semilla = {}) {
  const tablas = {
    calidad_incidencias: [],
    calidad_incidencia_seguimiento: [],
    calidad_encuestas_pasajeros: [],
    calidad_encuestas_aerolineas: [],
    calidad_documentos: [],
    calidad_directorio: [],
    ...JSON.parse(JSON.stringify(semilla)),
  };
  const log = { lecturas: [], inserts: [], updates: [], deletes: [], rpc: [], subidas: [], borrados: [], firmadas: [] };
  const fallas = {};
  let sig = 5000;
  const folios = {};

  function ejecutar(tabla, st) {
    if (fallas[tabla]) return { data: null, error: fallas[tabla] };
    const filas = tablas[tabla];
    if (!filas) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${tabla}' in the schema cache` } };
    const coincide = (r) => st.filtros.every(([c, v]) => r[c] === v);
    if (st.op === 'select') {
      log.lecturas.push(tabla);
      let res = filas.filter(coincide);
      [...st.orden].reverse().forEach(([c, asc]) => {
        res = res.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      });
      if (st.rango) res = res.slice(st.rango[0], st.rango[1] + 1);
      if (st.unico) {
        const r = res[0] || null;
        return { data: r ? { ...r } : null, error: st.unico === 'single' && !r ? { code: 'PGRST116', message: 'no rows' } : null };
      }
      return { data: res.map((r) => ({ ...r })), error: null };
    }
    if (st.op === 'insert') {
      log.inserts.push([tabla, { ...st.fila }]);
      const fila = { id: ++sig, ...st.fila };
      if (tabla === 'calidad_incidencias') {
        const y = new Date(fila.fecha).getFullYear();
        folios[y] = (folios[y] || 0) + 1;
        Object.assign(fila, {
          folio: `INC-${y}-${String(folios[y]).padStart(4, '0')}`,
          estado: 'Pendiente', observaciones: 'En espera de asignación.', tiempo_atencion: null, tiempo_resolucion: null,
        });
        tablas.calidad_incidencia_seguimiento.push({ id: ++sig, incidencia_id: fila.id, fecha: new Date().toISOString(), estado: 'Registrada', nota: 'Incidencia registrada en el sistema.', usuario: fila.registrado_por });
      }
      if (tabla === 'calidad_documentos') fila.fecha = new Date().toISOString();
      filas.push(fila);
      return { data: { ...fila }, error: null };
    }
    if (st.op === 'update') {
      log.updates.push([tabla, { ...st.cambios }, st.filtros]);
      const r = filas.find(coincide);
      Object.assign(r, st.cambios);
      return { data: { ...r }, error: null };
    }
    log.deletes.push([tabla, st.filtros]);
    tablas[tabla] = filas.filter((r) => !coincide(r));
    return { data: null, error: null };
  }

  function from(tabla) {
    const st = { op: 'select', filtros: [], orden: [], rango: null, fila: null, cambios: null, unico: null };
    const q = {
      select() { return q; },
      order(c, { ascending = true } = {}) { st.orden.push([c, ascending]); return q; },
      range(a, b) { st.rango = [a, b]; return q; },
      eq(c, v) { st.filtros.push([c, v]); return q; },
      maybeSingle() { st.unico = 'maybe'; return q; },
      single() { st.unico = 'single'; return q; },
      insert(fila) { st.op = 'insert'; st.fila = fila; return q; },
      update(c) { st.op = 'update'; st.cambios = c; return q; },
      delete() { st.op = 'delete'; return q; },
      then(ok, ko) { return Promise.resolve().then(() => ejecutar(tabla, st)).then(ok, ko); },
    };
    return q;
  }

  async function rpc(nombre, args) {
    log.rpc.push([nombre, args]);
    if (fallas[`rpc:${nombre}`]) return { data: null, error: fallas[`rpc:${nombre}`] };
    if (nombre === 'calidad_actualizar_estado') {
      const r = tablas.calidad_incidencias.find((i) => i.folio === args.p_folio);
      Object.assign(r, { estado: args.p_estado, observaciones: args.p_nota, tiempo_atencion: 42 });
      tablas.calidad_incidencia_seguimiento.push({ id: ++sig, incidencia_id: r.id, fecha: new Date().toISOString(), estado: args.p_estado, nota: args.p_nota, usuario: args.p_usuario });
      return { data: { ...r }, error: null };
    }
    if (nombre === 'calidad_usuarios') {
      return { data: [{ id: 'u1', nombre: 'Ana Ruiz', usuario: 'ana.ruiz@aifa.operaciones', area: 'GOET', rol: 'supervisor', activo: true, ultimo_acceso: '2026-11-20T10:00:00Z' }], error: null };
    }
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  }

  const storage = {
    from(bucket) {
      return {
        async upload(ruta, cuerpo, op) {
          log.subidas.push({ bucket, ruta, tipo: op && op.contentType, tam: cuerpo.size, cuerpoTipo: cuerpo.type });
          return fallas.upload ? { data: null, error: fallas.upload } : { data: { path: ruta }, error: null };
        },
        async createSignedUrl(ruta, seg, op) {
          log.firmadas.push({ bucket, ruta, seg, op });
          const d = op && op.download ? `&download=${encodeURIComponent(op.download)}` : '';
          return { data: { signedUrl: `https://demo.supabase.co/storage/v1/object/sign/${bucket}/${ruta}?token=t${d}` }, error: null };
        },
        async remove(rutas) { log.borrados.push({ bucket, rutas }); return { data: [], error: null }; },
      };
    },
  };

  return { from, rpc, storage, tablas, log, fallas };
}

function incidencia(id, extra) {
  return {
    id, folio: `INC-2026-${String(id).padStart(4, '0')}`, fecha: hace(2 * DIA), tipo: 'Equipaje dañado', aerolinea: 'AMX', vuelo: 'AMX1345',
    nivel: 'PB', edificio: 'T1', equipo: 'TTS02', severidad: 'Media', estado: 'Pendiente', descripcion: 'Maleta con la rueda rota al salir de la banda.',
    observaciones: 'En espera de asignación.', tiempo_atencion: null, tiempo_resolucion: null, registrado_por: 'Ana Ruiz', evidencia_path: null,
    ...extra,
  };
}

const SEMILLA = {
  calidad_incidencias: [
    incidencia(1),
    incidencia(2, { fecha: hace(2 * DIA + 3600000), estado: 'Solucionada', tiempo_atencion: 12, tiempo_resolucion: '3.50', severidad: 'Media', aerolinea: 'VIV', vuelo: 'VIV1200' }),
    incidencia(3, { estado: 'En proceso', tiempo_atencion: 30, fecha: hace(5 * DIA) }),
    incidencia(4, { fecha: hace(200 * DIA) }),
  ],
  calidad_encuestas_pasajeros: [
    { id: 1, fecha: hace(DIA), aerolinea: 'AMX', calificacion: 5, recomienda: true, comentario: 'Muy rápido', canal: 'QR en sala' },
    { id: 2, fecha: hace(DIA), aerolinea: 'VIV', calificacion: 2, recomienda: false, comentario: 'Tardó mucho', canal: 'Kiosco' },
  ],
  calidad_documentos: [
    { id: 1, cat: 'procedimientos', nombre: 'Atención de equipaje', codigo: 'PR-CAL-001', descripcion: '', tipo: 'Procedimiento', version: '1.0', formato: 'PDF', kb: 120, archivo_path: 'procedimientos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf', archivo_nombre: 'pr1.pdf', fecha: hace(30 * DIA) },
    { id: 2, cat: 'procedimientos', nombre: 'Atención de equipaje', codigo: 'PR-CAL-001', descripcion: '', tipo: 'Procedimiento', version: '2.0', formato: 'PDF', kb: 130, archivo_path: 'procedimientos/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf', archivo_nombre: 'pr2.pdf', fecha: hace(DIA) },
    { id: 3, cat: 'formatos', nombre: 'Reporte de daño', codigo: 'FO-CAL-010', descripcion: '', tipo: 'Formato', version: '1.0', formato: 'XLSX', kb: 40, archivo_path: 'formatos/cccccccc-cccc-4ccc-8ccc-cccccccccccc.xlsx', archivo_nombre: 'fo.xlsx', fecha: hace(DIA) },
  ],
  calidad_directorio: [
    { id: 1, nombre: 'Luis Pérez', cargo: 'Supervisor', area: 'Operaciones BHS', ext: '3310', correo: 'luis@aifa.operaciones', turno: 'Matutino', orden: 0 },
  ],
};

let sb;
let api;
let win;

// Cada prueba en una ventana nueva: SIGEC no se puede volver a definir.
function cargarModulo(cliente) {
  win = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/calidad/index.html?embed=1', runScripts: 'outside-only' }).window;
  win.structuredClone = (v) => v8.deserialize(v8.serialize(v));
  if (!win.Blob.prototype.arrayBuffer) {
    win.Blob.prototype.arrayBuffer = function () {
      return new Promise((ok) => { const fr = new win.FileReader(); fr.onload = () => ok(fr.result); fr.readAsArrayBuffer(this); });
    };
  }
  win.SIGEC_CONFIG = { supabase: () => cliente };
  ARCHIVOS.forEach((f) => win.eval(leer(`calidad/${f}`)));
  return win.SIGEC.use('data/api');
}

const archivo = (bytes, nombre, tipo) => new win.File([bytes], nombre, { type: tipo });
const png = () => archivo(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]), 'foto.png', 'image/png');
const ahoraLocal = () => new Date(Date.now() - 60000).toISOString();
const NUEVA = { fecha: ahoraLocal(), tipo: 'Retraso en entrega', aerolinea: 'VOI', vuelo: 'voi2201', nivel: 'N1', edificio: 'T1', equipo: '', severidad: 'Alta', descripcion: 'El equipaje llegó 50 minutos tarde al carrusel 4.' };

beforeEach(() => {
  sb = supabaseFalso(SEMILLA);
  api = cargarModulo(sb);
});

describe('lectura de la base', () => {
  test('el panel calcula los indicadores con las incidencias y encuestas reales', async () => {
    const d = await api.getDashboard({ periodo: '30' });
    expect(d.kpis.registradas.value).toBe(3);         // la de hace 200 días queda fuera
    expect(d.kpis.pendientes.value).toBe(1);
    expect(d.kpis.enProceso.value).toBe(1);
    expect(d.kpis.solucionadas.value).toBe(1);
    expect(d.kpis.atencion.value).toBe(21);            // (12 + 30) / 2 min
    expect(d.satisfaccion.pasajerosN).toBe(2);
    expect(d.satisfaccion.pasajeros).toBe(50);
  });

  test('el listado filtra, ordena por fecha y convierte columnas de la base', async () => {
    const res = await api.listIncidencias({ filters: { periodo: 'todo' }, pageSize: 2 });
    expect(res.total).toBe(4);
    expect(res.pages).toBe(2);
    expect(res.rows.map((r) => r.folio)).toEqual(['INC-2026-0001', 'INC-2026-0002']);
    const viva = await api.listIncidencias({ filters: { periodo: 'todo', aerolinea: 'VIV' } });
    expect(viva.rows).toHaveLength(1);
    expect(viva.rows[0].tiempoResolucion).toBe(3.5);   // numeric llega como texto
    expect(viva.rows[0].equipo).toBe('TTS02');
  });

  test('guarda la lectura unos segundos y la renueva después de escribir', async () => {
    await api.getDashboard({ periodo: '30' });
    await api.listIncidencias({ filters: { periodo: '30' } });
    await api.contarPendientes();
    const porTabla = (t) => sb.log.lecturas.filter((x) => x === t).length;
    expect(porTabla('calidad_incidencias')).toBe(1);
    await api.crearIncidencia(NUEVA, { name: 'Ana Ruiz' });
    expect(await api.contarPendientes()).toBe(3);
    expect(porTabla('calidad_incidencias')).toBe(2);
    api.refrescar();
    await api.contarPendientes();
    expect(porTabla('calidad_incidencias')).toBe(3);
  });

  test('lee por páginas de 1000 (más de mil incidencias)', async () => {
    const muchas = Array.from({ length: 1500 }, (_, i) => incidencia(i + 1));
    sb = supabaseFalso({ calidad_incidencias: muchas });
    api = cargarModulo(sb);
    const res = await api.listIncidencias({ filters: { periodo: 'todo' } });
    expect(res.total).toBe(1500);
    expect(sb.log.lecturas.filter((t) => t === 'calidad_incidencias')).toHaveLength(2);
  });

  test('sin las tablas, el mensaje dice qué SQL falta correr', async () => {
    sb.fallas.calidad_encuestas_pasajeros = { code: 'PGRST205', message: "Could not find the table 'public.calidad_encuestas_pasajeros' in the schema cache" };
    await expect(api.getDashboard({})).rejects.toMatchObject({ amigable: true, message: expect.stringContaining('db/calidad_sigec.sql') });
  });

  test('sin cliente de Supabase avisa que se abra desde AIFA Operaciones', async () => {
    api = cargarModulo(null);
    await expect(api.listDirectorio()).rejects.toMatchObject({ amigable: true, message: expect.stringContaining('AIFA Operaciones') });
  });
});

describe('incidencias', () => {
  test('registrar sube la evidencia al bucket privado y guarda la ruta, no el archivo', async () => {
    const inc = await api.crearIncidencia({ ...NUEVA, evidencia: png() }, { name: 'Ana Ruiz' });
    expect(inc.folio).toMatch(/^INC-\d{4}-\d{4}$/);
    expect(inc.estado).toBe('Pendiente');
    expect(inc.seguimiento[0].estado).toBe('Registrada');
    expect(sb.log.subidas).toHaveLength(1);
    const sub = sb.log.subidas[0];
    expect(sub.bucket).toBe('calidad-evidencias');
    expect(sub.ruta).toMatch(/^incidencias\/[0-9a-f-]{36}\.png$/);
    expect(sub.tipo).toBe('image/png');
    expect(sub.cuerpoTipo).toBe('image/png');
    const [tabla, fila] = sb.log.inserts[0];
    expect(tabla).toBe('calidad_incidencias');
    expect(fila).toMatchObject({ vuelo: 'VOI2201', registrado_por: 'Ana Ruiz', evidencia_path: sub.ruta, equipo: null, severidad: 'Alta' });
    expect(fila).not.toHaveProperty('evidencia');
    expect(fila).not.toHaveProperty('folio');            // lo pone la base
  });

  test('una "imagen" que no lo es no se sube ni se registra', async () => {
    const falsa = archivo(new Uint8Array([0x4D, 0x5A, 0x90, 0, 1, 2, 3, 4, 5, 6, 7, 8]), 'foto.png', 'image/png');
    await expect(api.crearIncidencia({ ...NUEVA, evidencia: falsa }, { name: 'Ana' })).rejects.toMatchObject({ fields: { evidencia: expect.any(String) } });
    expect(sb.log.subidas).toHaveLength(0);
    expect(sb.log.inserts).toHaveLength(0);
  });

  test('datos inválidos se detienen antes de tocar la base', async () => {
    await expect(api.crearIncidencia({ ...NUEVA, vuelo: 'X', descripcion: 'corta' }, {})).rejects.toMatchObject({ fields: { vuelo: expect.any(String), descripcion: expect.any(String) } });
    expect(sb.log.inserts).toHaveLength(0);
  });

  test('si la base rechaza el registro, la foto subida se borra y el aviso es claro', async () => {
    sb.fallas.calidad_incidencias = { code: '42501', message: 'new row violates row-level security policy for table "calidad_incidencias"' };
    await expect(api.crearIncidencia({ ...NUEVA, evidencia: png() }, { name: 'Ana' }))
      .rejects.toMatchObject({ amigable: true, message: 'Tu cuenta no tiene permiso para esta acción en Calidad.' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sb.log.borrados).toEqual([{ bucket: 'calidad-evidencias', rutas: [sb.log.subidas[0].ruta] }]);
  });

  test('el detalle trae la bitácora y un enlace temporal a la foto', async () => {
    sb.tablas.calidad_incidencias[0].evidencia_path = 'incidencias/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg';
    const inc = await api.getIncidencia('INC-2026-0001');
    expect(inc.evidencia).toBe(true);
    expect(inc.evidenciaUrl).toContain('calidad-evidencias/incidencias/');
    expect(sb.log.firmadas[0]).toMatchObject({ bucket: 'calidad-evidencias', seg: 600 });
    expect(await api.getIncidencia('<script>')).toBeNull();
  });

  test('cambiar el estado pasa por la función de la base, que calcula los tiempos', async () => {
    const inc = await api.actualizarEstado('INC-2026-0001', 'En proceso', '  Se asignó a la cuadrilla BHS  ', { name: 'Jorge Supervisor' });
    expect(sb.log.rpc[0]).toEqual(['calidad_actualizar_estado', { p_folio: 'INC-2026-0001', p_estado: 'En proceso', p_nota: 'Se asignó a la cuadrilla BHS', p_usuario: 'Jorge Supervisor' }]);
    expect(sb.log.updates).toHaveLength(0);              // nunca un UPDATE directo
    expect(inc.estado).toBe('En proceso');
    expect(inc.tiempoAtencion).toBe(42);
    expect(inc.seguimiento.map((s) => s.estado)).toEqual(['En proceso']);
    await expect(api.actualizarEstado('INC-2026-0001', 'Cerrada', 'nota larga', {})).rejects.toThrow('Estado inválido');
  });

  test('un mensaje escrito por la base para la persona se muestra tal cual', async () => {
    sb.fallas['rpc:calidad_actualizar_estado'] = { code: '42501', message: 'La incidencia está cerrada; sólo un administrador de Calidad puede reabrirla.' };
    await expect(api.actualizarEstado('INC-2026-0002', 'Pendiente', 'Reabrir por reclamo', {}))
      .rejects.toMatchObject({ message: 'La incidencia está cerrada; sólo un administrador de Calidad puede reabrirla.' });
  });
});

describe('encuestas, documentos, directorio y usuarios', () => {
  test('capturar una encuesta en papel guarda sí/no como booleano', async () => {
    const e = await api.crearEncuesta('pasajeros', { fecha: ahoraLocal(), aerolinea: 'AMX', calificacion: '4', recomienda: 'si', canal: 'Formato impreso', comentario: ' Bien ' }, { name: 'Capturista' });
    expect(sb.log.inserts[0]).toEqual(['calidad_encuestas_pasajeros', expect.objectContaining({ aerolinea: 'AMX', calificacion: 4, recomienda: true, canal: 'Formato impreso', comentario: 'Bien', capturado_por: 'Capturista' })]);
    expect(e.recomienda).toBe(true);
    await expect(api.crearEncuesta('aerolineas', { fecha: ahoraLocal(), aerolinea: 'AMX', calificacion: '9', recomienda: 'quizá', area: 'Otra', evaluador: 'x' }, {}))
      .rejects.toMatchObject({ fields: { calificacion: expect.any(String), recomienda: expect.any(String), area: expect.any(String), evaluador: expect.any(String) } });
  });

  test('documentación: sólo la versión vigente de cada código y descarga con enlace temporal', async () => {
    const { rows, counts } = await api.listDocumentos('procedimientos');
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('2.0');
    expect(counts).toMatchObject({ procedimientos: 1, formatos: 1, instructivos: 0, capacitacion: 0 });
    const url = await api.urlDocumento(rows[0].id);
    expect(url).toContain('download=PR-CAL-001%20Atenci%C3%B3n%20de%20equipaje%20v2.0.pdf');
    expect(sb.log.firmadas[0]).toMatchObject({ bucket: 'calidad-documentos', ruta: 'procedimientos/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf', seg: 120 });
  });

  test('publicar un documento sube el archivo y registra su ruta', async () => {
    const pdf = archivo('%PDF-1.7 hola', 'manual.pdf', 'application/pdf');
    await api.agregarDocumento({ nombre: 'Manual de calidad', codigo: 'MA-CAL-001', version: '1.0', cat: 'capacitacion', tipo: 'Manual', descripcion: '', formato: 'PDF', kb: 1, archivo: pdf }, { name: 'Jorge' });
    expect(sb.log.subidas[0]).toMatchObject({ bucket: 'calidad-documentos', tipo: 'application/pdf' });
    expect(sb.log.subidas[0].ruta).toMatch(/^capacitacion\/[0-9a-f-]{36}\.pdf$/);
    expect(sb.log.inserts[0][1]).toMatchObject({ codigo: 'MA-CAL-001', archivo_path: sb.log.subidas[0].ruta, archivo_nombre: 'manual.pdf', subido_por: 'Jorge', descripcion: null });
    const { rows } = await api.listDocumentos('capacitacion');
    expect(rows.map((d) => d.codigo)).toEqual(['MA-CAL-001']);
  });

  test('directorio: agregar, editar y quitar contactos', async () => {
    await api.guardarContacto({ nombre: 'María López', area: 'Gerencia de Calidad', ext: '4101', correo: 'maria@aifa.operaciones', cargo: '', turno: '' });
    expect(sb.log.inserts[0]).toEqual(['calidad_directorio', expect.objectContaining({ nombre: 'María López', ext: '4101', cargo: null })]);
    await api.guardarContacto({ id: 1, nombre: 'Luis Pérez', area: 'Operaciones BHS', ext: '3311' });
    expect(sb.log.updates[0][0]).toBe('calidad_directorio');
    expect(sb.log.updates[0][2]).toEqual([['id', 1]]);
    await api.eliminarContacto('1');
    expect(sb.log.deletes[0]).toEqual(['calidad_directorio', [['id', 1]]]);
    const lista = await api.listDirectorio();
    expect(lista.map((p) => p.nombre)).toEqual(['María López']);
    await expect(api.guardarContacto({ nombre: 'X', area: '', ext: 'abc', correo: 'no' })).rejects.toMatchObject({ fields: { nombre: expect.any(String), area: expect.any(String), ext: expect.any(String), correo: expect.any(String) } });
  });

  test('usuarios con acceso vienen de la función de la base', async () => {
    const u = await api.listUsuarios();
    expect(u[0]).toMatchObject({ nombre: 'Ana Ruiz', rol: 'supervisor', activo: true, area: 'GOET' });
    expect(u[0].ultimoAcceso.getTime()).toBe(Date.parse('2026-11-20T10:00:00Z'));
  });
});
