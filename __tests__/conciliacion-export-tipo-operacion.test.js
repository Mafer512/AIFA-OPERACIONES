/**
 * @jest-environment node
 *
 * "Exportar Excel › Total": la columna TIPO DE OPERACIÓN de las hojas
 * Pasajeros y Carga lleva la misma clasificación que muestra la tabla.
 *
 * La hoja Pasajeros la calculaba solo con el código de DESTINO / ORIGEN, y en
 * los manifiestos capturados ese campo guarda el nombre de la ciudad
 * ("Acapulco"), así que salía vacía aunque la celda dijera Nacional. La hoja
 * Carga usaba otra regla (el valor guardado sin normalizar, o la RUTA). Ahora
 * las dos usan la de la celda: el valor guardado si es Nacional / Internacional
 * y, si no, el extremo de la ruta según llegada o salida.
 *
 * Se carga el index.html y el script.js reales; ExcelJS se sustituye por un
 * registro mínimo de las filas que se escriben.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const PAISES = {
  NLU: 'México', ACA: 'México', OAX: 'México', GDL: 'México', VER: 'México', PVR: 'México', NLD: 'México', SLP: 'México',
  BOG: 'Colombia', FRA: 'Alemania', ATL: 'Estados Unidos', MIA: 'Estados Unidos',
};

// [vuelo, tipo de manifiesto, TIPO DE OPERACIÓN guardado, DESTINO / ORIGEN, RUTA, ¿carga?, lo que muestra la tabla]
const CASOS = [
  ['XN 1943', 'LLEGADA', 'Nacional', 'Acapulco', 'ACA-NLU', false, 'Nacional'],
  ['VB 9213', 'LLEGADA', 'NACIONAL', 'Oaxaca', 'OAX-NLU-GDL', false, 'Nacional'],
  ['VB 835', 'LLEGADA', 'INTERNACIONAL', 'Medellin', 'MDE-NLU', false, 'Internacional'],
  ['Y4 3960', 'SALIDA', 'Internacional', 'Bogota', 'NLU-BOG', false, 'Internacional'],
  ['Y4 1291', 'SALIDA', 'Nacional', 'Guadalajara', 'NLU-GDL', false, 'Nacional'],
  ['AM 871', 'LLEGADA', '', 'VER-NLU-PVR', 'VER-NLU-PVR', false, 'Nacional'],
  ['AM 880', 'SALIDA', 'J', 'VER-NLU-PVR', 'VER-NLU-PVR', false, 'Nacional'],
  ['AV 31', 'SALIDA', '', 'NLU-BOG', 'NLU-BOG', false, 'Internacional'],
  ['QR 8139', 'LLEGADA', 'Internacional', 'Frankfurt', 'FRA-NLU-ATL', true, 'Internacional'],
  ['QR 8139', 'SALIDA', '', 'FRA-NLU-ATL', 'FRA-NLU-ATL', true, 'Internacional'],
  ['E7 551', 'LLEGADA', 'H', 'NLD-NLU-SLP', 'NLD-NLU-SLP', true, 'Nacional'],
  ['E7 552', 'SALIDA', 'NACIONAL', 'San Luis Potosi', 'NLD-NLU-SLP', true, 'Nacional'],
];

const filaDe = ([vuelo, tipo, guardado, destinoOrigen, ruta, carga], i) => ({
  id: 5000 + i, 'CIERRE SUBSECRETARIA': '', MES: '10', FECHA: '2026-10-05',
  'TIPO DE MANIFIESTO': tipo, AEROLINEA: vuelo.slice(0, 2), 'TIPO DE OPERACIÓN': guardado,
  AERONAVE: 'A320', 'MATRÍCULA': 'XA' + i, 'ESTATUS MATRÍCULA': 'ACTIVA', '# DE VUELO': vuelo,
  'DESTINO / ORIGEN': destinoOrigen, RUTA: ruta,
  'SLOT ASIGNADO': `05/10/2026 ${String(i).padStart(2, '0')}:00`,
  'HR. DE OPERACIÓN': `05/10/2026 ${String(i).padStart(2, '0')}:10`,
  'HR. DE RECEPCIÓN': `05/10/2026 ${String(i).padStart(2, '0')}:30`,
  'TOTAL PAX': carga ? '' : String(100 + i), 'KG DE CARGA TOTAL': carga ? String(1000 * (i + 1)) : '',
  'CAPTURÓ': 'Prueba', cierre_es_carga_reportado: carga,
});

let win;
let doc;
let errores;
let libros;

// Lo justo de ExcelJS para registrar qué filas se escriben en cada hoja.
function excelFalso() {
  libros = [];
  const celdas = (valores) => valores.map((value) => ({ value }));
  class Hoja {
    constructor(nombre) { this.nombre = nombre; this.filas = []; this._cols = []; this.renglones = {}; }
    set columns(defs) { this._cols = defs.map((d) => ({ ...d })); this.encabezados = defs.map((d) => d.header); }
    get columns() { return this._cols; }
    getRow(n) {
      if (this.encabezados) { const c = celdas(this.encabezados); return { eachCell: (cb) => c.forEach((x, i) => cb(x, i + 1)) }; }
      // "Manifiestos capturados" escribe su encabezado celda por celda (renglón 3).
      return this.renglones[n] || (this.renglones[n] = {
        celdas: [],
        getCell(i) { return this.celdas[i - 1] || (this.celdas[i - 1] = {}); },
        eachCell(cb) { this.celdas.forEach((x, i) => cb(x, i + 1)); },
      });
    }
    getCell() { return {}; }
    mergeCells() {}
    addRow(valores) { this.filas.push(valores); const c = celdas(valores); return { eachCell: (cb) => c.forEach((x, i) => cb(x, i + 1)) }; }
    getColumn() { return {}; }
  }
  class Workbook {
    constructor() { this.hojas = []; this.xlsx = { writeBuffer: async () => new ArrayBuffer(0) }; libros.push(this); }
    addWorksheet(nombre) { const h = new Hoja(nombre); this.hojas.push(h); return h; }
  }
  return { Workbook };
}

beforeAll(() => {
  errores = [];
  const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  win = dom.window;
  doc = win.document;
  win.addEventListener('error', (e) => errores.push((e.error && e.error.stack) || e.message));

  const noop = () => {};
  const doble = new Proxy(function () {}, { get: () => doble, apply: () => doble, construct: () => doble });
  const consulta = new Proxy({}, {
    get: (t, p) => (p === 'then' ? (res) => Promise.resolve({ data: [], error: null }).then(res) : () => consulta),
  });
  Object.assign(win, {
    supabase: { createClient: () => ({ from: () => consulta, rpc: () => consulta, channel: () => doble, removeChannel: noop, auth: doble, storage: doble }) },
    bootstrap: { Modal: doble, Tooltip: doble, Tab: doble, Dropdown: doble, Offcanvas: doble, Collapse: doble, Popover: doble, Toast: doble },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
    Chart: doble, XLSX: doble, $: doble, jQuery: doble, Swal: doble, moment: doble,
    matchMedia: () => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    scrollTo: noop,
    open: () => null,
    alert: (m) => errores.push('alert: ' + m),
    saveAs: noop,
  });
  win.HTMLCanvasElement.prototype.getContext = () => doble;
  win.HTMLElement.prototype.scrollIntoView = noop;
  win.console.log = noop;
  win.console.warn = noop;

  // Las variables `let` / `const` de script.js solo se ven dentro del mismo eval.
  win.eval(fs.readFileSync(path.join(raiz, 'script.js'), 'utf8') + `
    ;window.__conciPrueba = {
      paises(mapa) { Object.entries(mapa).forEach(([k, v]) => _conciAirportCountryByIata.set(k, v)); },
      columnas() { return _CONCI_OUTPUT_COLUMNS.slice(); },
    };`);
  win.__conciPrueba.paises(PAISES);
  win.ExcelJS = excelFalso();
}, 60000);

afterAll(() => { if (win) win.close(); });

const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
// En el Excel # DE VUELO sale solo con el número ("XN 1943" → "1943"); la
// tabla guarda el vuelo completo. Se compara por el número en los dos lados.
const llave = (vuelo, tipo) => `${win._conciNumeroDeVuelo(vuelo)}|${tipo}`;

async function pintar(datos) {
  win._renderConciManifiestosTable(datos, win.__conciPrueba.columnas(), 2026);
  const inicio = Date.now();
  while (filas().length < datos.length && Date.now() - inicio < 8000) await esperar(20);
  await esperar(50);
}

// Lo que muestra la tabla en TIPO DE OPERACIÓN, por vuelo + tipo de manifiesto.
function tabla() {
  const m = new Map();
  filas().forEach((tr) => {
    const v = (c) => tr.querySelector(`td[data-col="${c}"]`).dataset.raw;
    m.set(llave(v('# DE VUELO'), v('TIPO DE MANIFIESTO')), v('TIPO DE OPERACIÓN'));
  });
  return m;
}

// Lo que quedó en cada hoja del libro Total, por vuelo + tipo de manifiesto.
async function exportarTotal() {
  await win.conciExportExcel('total');
  const libro = libros[libros.length - 1];
  const hojas = {};
  libro.hojas.forEach((h) => {
    const col = (nombre) => h.encabezados.indexOf(nombre);
    hojas[h.nombre] = {
      encabezados: h.encabezados,
      filas: h.filas,
      tipo: new Map(h.filas.map((f) => [llave(f[col('# DE VUELO')], f[col('TIPO DE MANIFIESTO')]), f[col('TIPO DE OPERACIÓN')]])),
    };
  });
  return hojas;
}

describe('Exportar Excel › Total: TIPO DE OPERACIÓN', () => {
  afterEach(() => { expect(errores).toEqual([]); });

  test('la tabla muestra la clasificación esperada (punto de partida)', async () => {
    await pintar(CASOS.map(filaDe));
    const t = tabla();
    CASOS.forEach(([vuelo, tipo, , , , , esperado]) => expect(t.get(llave(vuelo, tipo))).toBe(esperado));
  });

  test('Pasajeros y Carga llevan en cada fila lo mismo que la tabla', async () => {
    await pintar(CASOS.map(filaDe));
    const t = tabla();
    const hojas = await exportarTotal();
    expect(Object.keys(hojas)).toEqual(['Pasajeros', 'Carga']);

    const pax = CASOS.filter((c) => !c[5]);
    const carga = CASOS.filter((c) => c[5]);
    expect(hojas.Pasajeros.filas).toHaveLength(pax.length);
    expect(hojas.Carga.filas).toHaveLength(carga.length);
    pax.forEach(([vuelo, tipo]) => expect(hojas.Pasajeros.tipo.get(llave(vuelo, tipo))).toBe(t.get(llave(vuelo, tipo))));
    carga.forEach(([vuelo, tipo]) => expect(hojas.Carga.tipo.get(llave(vuelo, tipo))).toBe(t.get(llave(vuelo, tipo))));
    // Una sola columna TIPO DE OPERACIÓN por hoja, en su lugar de siempre.
    expect(hojas.Pasajeros.encabezados.filter((h) => h === 'TIPO DE OPERACIÓN')).toHaveLength(1);
    expect(hojas.Pasajeros.encabezados.indexOf('TIPO DE OPERACIÓN')).toBe(5);
    expect(hojas.Carga.encabezados.indexOf('TIPO DE OPERACIÓN')).toBe(3);
  });

  test('las filas que aún no se pintan (carga por lotes) se clasifican igual', async () => {
    await pintar(CASOS.map(filaDe));
    const t = tabla();
    // Sin filas en el DOM, la exportación sale solo de los datos cargados.
    doc.querySelector('#table-conci-manifiestos tbody').innerHTML = '';
    const hojas = await exportarTotal();
    CASOS.forEach(([vuelo, tipo, , , , carga]) => {
      expect(hojas[carga ? 'Carga' : 'Pasajeros'].tipo.get(llave(vuelo, tipo))).toBe(t.get(llave(vuelo, tipo)));
    });
  });

  test('sin datos suficientes no se inventa: la celda queda vacía, igual que en la tabla', async () => {
    // Sin TIPO DE OPERACIÓN guardado y con DESTINO / ORIGEN como nombre de
    // ciudad no hay código de aeropuerto del que deducirlo.
    const caso = ['VB 4000', 'LLEGADA', '', 'Puerto Vallarta', 'PVR-NLU', false];
    await pintar([...CASOS, caso].map(filaDe));
    expect(tabla().get(llave('VB 4000', 'LLEGADA'))).toBe('');
    const hojas = await exportarTotal();
    expect(hojas.Pasajeros.tipo.get(llave('VB 4000', 'LLEGADA'))).toBe('');
  });

  test('Manifiestos capturados › Exportar: misma clasificación, también en filas sin pintar', async () => {
    await pintar(CASOS.map(filaDe));
    const t = tabla();
    // Sin filas en el DOM salía el valor guardado: "J", "H", "NACIONAL" o vacío.
    doc.querySelector('#table-conci-manifiestos tbody').innerHTML = '';
    await win.conciExportPorCapturista();
    const libro = libros[libros.length - 1];
    expect(libro.hojas.map((h) => h.nombre)).toEqual(['Prueba']);
    const hoja = libro.hojas[0];
    const encabezados = hoja.getRow(3).celdas.map((c) => c.value);
    const col = (nombre) => encabezados.indexOf(nombre);
    expect(encabezados.filter((h) => h === 'TIPO DE OPERACIÓN')).toHaveLength(1);
    expect(hoja.filas).toHaveLength(CASOS.length);
    hoja.filas.forEach((f) => {
      expect(f[col('TIPO DE OPERACIÓN')]).toBe(t.get(llave(f[col('# DE VUELO')], f[col('TIPO DE MANIFIESTO')])));
    });
  });
});
