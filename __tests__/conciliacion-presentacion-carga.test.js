/**
 * @jest-environment node
 *
 * La presentación de carga armada sobre la plantilla original.
 *
 * Aquí se corre el generador de verdad —la plantilla real, los logotipos
 * reales y JSZip— y se abre el .pptx que produce. Lo que se cuida:
 *
 *   · Ningún marcador {{...}} llega impreso a la baraja.
 *   · Las tarjetas de las diapositivas 3 a 6 llevan su logotipo.
 *   · La imagen EMF con las cifras de agosto no vuelve a aparecer.
 *   · El acumulado no cuenta dos veces el día del corte.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const raiz = path.resolve(__dirname, '..');

/** Carga los tres módulos con lo mínimo de navegador que necesitan. */
function cargar(resolver) {
  const window = { addEventListener() {} };
  const document = {
    addEventListener() {}, getElementById: () => null, querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {}, contains: () => false } }
  };
  window._conciRowIsCargo = () => true;
  if (resolver) window._conciResolveAirlineMeta = resolver;
  for (const archivo of ['conci-carga-catalogo.js', 'conci-presentacion-carga.js', 'conci-reportes-carga.js']) {
    new Function('window', 'document', fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8'))(window, document);
  }
  return window;
}

const COLUMNAS = {
  cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO', operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA', cargaNac: 'KGS. DE CARGA NACIONAL', cargaInt: 'KGS. DE CARGA INTERNACIONAL',
  cargaTotal: 'KG DE CARGA TOTAL', portal: null
};

const manifiesto = c => ({
  'CIERRE SUBSECRETARIA': c.cierre ?? c.fecha,
  'FECHA': c.fecha,
  'TIPO DE MANIFIESTO': c.tipo ?? 'LLEGADA',
  'TIPO DE OPERACIÓN': c.operacion ?? 'INTERNACIONAL',
  'AEROLINEA': c.aerolinea ?? 'ESTAFETA',
  'KGS. DE CARGA NACIONAL': c.nac ?? 0,
  'KGS. DE CARGA INTERNACIONAL': c.int ?? 0,
  'KG DE CARGA TOTAL': 0
});

const leerDelRepo = ruta => fs.readFileSync(path.join(raiz, ruta));

describe('el catálogo de la presentación', () => {
  const { ConciCargaCatalogo: C } = cargar();

  test('son las 58 aerolíneas de la Hoja 1, con los conteos de la baraja', () => {
    expect(C.AEROLINEAS).toHaveLength(58);
    expect(C.conteos()).toEqual({ regular: 18, fletamento: 35, mixta: 5 });
  });

  test('cada aerolínea sale en una sola tarjeta', () => {
    const enTarjetas = [3, 4, 5, 6].flatMap(n => C.TARJETAS[n].nombres);
    expect(enTarjetas).toHaveLength(58);
    expect(new Set(enTarjetas).size).toBe(58);
    enTarjetas.forEach(nombre => expect(C.porNombre.has(nombre)).toBe(true));
  });

  test('cada aerolínea tiene su logotipo en el repo', () => {
    const faltan = C.AEROLINEAS.filter(a => !fs.existsSync(path.join(raiz, C.logoDe(a.nombre))));
    expect(faltan.map(a => a.nombre)).toEqual([]);
  });

  test('lo capturado se reconoce por alias, aunque no diga el nombre de la Hoja 1', () => {
    expect(C.entradaDe('MAS AIR').nombre).toBe('MAS DE CARGA');
    expect(C.entradaDe('Awesome Cargo').nombre).toBe('TM AEROLINEAS');
    expect(C.entradaDe('LA NUEVA AEROLÍNEA').nombre).toBe('COPA CARGO');
    expect(C.entradaDe('AEROUNION').nombre).toBe('AEROUNIÓN');
    expect(C.entradaDe('AEROLINEA INVENTADA')).toBeNull();
  });

  test('y por código IATA cuando el catálogo de la tabla lo conoce', () => {
    const w = cargar(v => (String(v).toUpperCase() === 'MAS AIR' ? { name: 'MAS Air', iata: 'M7' } : null));
    expect(w.ConciCargaCatalogo.entradaDe('AEROTRANSPORTES CUALQUIERA', 'M7').nombre).toBe('MAS DE CARGA');
  });
});

describe('el modelo de la baraja', () => {
  const w = cargar();
  const api = w.conciReportesCarga;

  test('el acumulado no cuenta dos veces el día del corte', () => {
    const datos = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-08-30', int: 1000 }),
        manifiesto({ fecha: '2026-08-31', int: 2000 })
      ],
      columnas: COLUMNAS
    }, '2026-08-31');
    const t = api.modeloPresentacion(datos).texto;
    // CARGA 2026 llega hasta el día anterior; el renglón del día es el corte.
    expect(t.ANIO_4_ETQ).toBe('CARGA 2026');
    expect(t.ANIO_4_OPS).toBe('1');
    expect(t.DIA_OPS).toBe('1');
    expect(t.H1_OPS_TOTAL).toBe('2');
    // 6,661 + 15,719 + 14,830 de la línea base, más las dos del año.
    expect(t.ACUM_OPS).toBe('37,212');
    expect(t.ACUM_TON).toBe('1,040,285.68');
  });

  test('una aerolínea sin operaciones deja su renglón y su tarjeta en blanco', () => {
    const datos = api.agregar({ filas: [manifiesto({ fecha: '2026-08-31', int: 5000 })], columnas: COLUMNAS }, '2026-08-31');
    const m = api.modeloPresentacion(datos);
    const tsm = m.tarjetas[3][0];
    expect(tsm).toMatchObject({ nombre: 'AERONAVES TSM', ops: '', ton: '' });
    const estafeta = m.tarjetas[3].find(t => t.nombre === 'ESTAFETA');
    expect(estafeta).toMatchObject({ ops: '1', ton: '5.00' });
    expect(estafeta.logo).toBe('images/presentacion-carga/logos/estafeta.png');
  });
});

describe('el .pptx', () => {
  const w = cargar();
  const api = w.conciReportesCarga;
  const construir = modelo => w.ConciPresentacionCarga.construir({ JSZip, cargar: leerDelRepo }, modelo);

  async function abrir(fecha, filas) {
    const datos = api.agregar({ filas, columnas: COLUMNAS }, fecha);
    const zip = await JSZip.loadAsync(await construir(api.modeloPresentacion(datos)));
    const leer = p => zip.file(p).async('string');
    return { zip, leer };
  }

  let baraja;
  beforeAll(async () => {
    baraja = await abrir('2026-08-31', [
      manifiesto({ fecha: '2026-08-30', int: 385800, aerolinea: 'AERONAVES TSM' }),
      manifiesto({ fecha: '2026-08-31', int: 1709340, aerolinea: 'ESTAFETA' })
    ]);
  });

  test('conserva las diez diapositivas de la plantilla', () => {
    const diapositivas = Object.keys(baraja.zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(diapositivas).toHaveLength(10);
  });

  test('ningún marcador llega impreso', async () => {
    for (let n = 1; n <= 10; n++) {
      expect(await baraja.leer(`ppt/slides/slide${n}.xml`)).not.toMatch(/\{\{/);
    }
  });

  test('la portada y los totales llevan las cifras del periodo', async () => {
    expect(await baraja.leer('ppt/slides/slide1.xml')).toContain('>Agosto 2026<');
    const s7 = await baraja.leer('ppt/slides/slide7.xml');
    expect(s7).toContain('>37,212<');
  });

  test('cada tarjeta lleva su logotipo', async () => {
    const s3 = await baraja.leer('ppt/slides/slide3.xml');
    expect((s3.match(/name="Tarjeta /g) || [])).toHaveLength(18);
    expect((s3.match(/name="Logo /g) || [])).toHaveLength(18);
    expect(await baraja.leer('ppt/slides/_rels/slide3.xml.rels')).toContain('../media/logo-estafeta.png');
    expect(baraja.zip.file('ppt/media/logo-estafeta.png')).not.toBeNull();
    const s6 = await baraja.leer('ppt/slides/slide6.xml');
    expect((s6.match(/name="Logo /g) || [])).toHaveLength(5);
  });

  test('un renglón sin operaciones lleva un espacio, no una celda vacía', async () => {
    // Un tramo vacío pierde los 7 pt y el renglón crece hasta sacar la tabla
    // de la diapositiva; la baraja original traía un espacio en esas celdas.
    const s2 = await baraja.leer('ppt/slides/slide2.xml');
    const inicio = s2.indexOf('>ABSA<');
    const renglon = s2.slice(inicio, s2.indexOf('</a:tr>', inicio));
    expect((renglon.match(/<a:t> <\/a:t>/g) || [])).toHaveLength(2);
  });

  test('las cifras de agosto de la original no vuelven', () => {
    for (const emf of ['image12.emf', 'image13.emf', 'image14.emf', 'image15.emf']) {
      expect(baraja.zip.file(`ppt/media/${emf}`)).toBeNull();
    }
  });

  test('sin nombres de personas en los metadatos', async () => {
    const core = await baraja.leer('docProps/core.xml');
    expect(core).toContain('<dc:creator>AIFA</dc:creator>');
    expect(core).toContain('<cp:lastModifiedBy>AIFA</cp:lastModifiedBy>');
  });

  test('un año con menos renglones de historia ajusta la tabla', async () => {
    const b = await abrir('2025-12-31', [manifiesto({ fecha: '2025-12-31', int: 1000 })]);
    const s2 = await b.leer('ppt/slides/slide2.xml');
    expect(s2).not.toMatch(/\{\{/);
    expect((s2.match(/>CARGA 2025</g) || [])).toHaveLength(1);
    expect(s2).not.toContain('>CARGA 2026<');
  });

  test('lee las medidas de un PNG por su encabezado', () => {
    const dim = w.ConciPresentacionCarga.dimensionesImagen(leerDelRepo('images/presentacion-carga/logos/ups.png'));
    expect(dim.ext).toBe('png');
    expect(dim.ancho).toBeGreaterThan(0);
    expect(dim.alto).toBeGreaterThan(0);
  });
});
