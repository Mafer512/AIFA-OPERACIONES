/**
 * @jest-environment node
 *
 * Filtro desplegable de la columna "TIPO DE OPERACIÓN" en Conciliación
 * Manifiestos.
 *
 * Las filas que vienen del itinerario guardan en esa columna el Service Type
 * IATA del vuelo ("J", "F", "H", "C", "O", "P"…), mientras la celda muestra
 * Nacional / Internacional según el valor guardado o la ruta. El filtro listaba
 * y comparaba el valor guardado, así que ofrecía esas letras junto a Nacional e
 * Internacional. Ahora usa la misma clasificación que la celda, sin tocar el
 * dato: el código sigue ahí porque decide si la fila es de carga.
 *
 * Se carga el index.html y el script.js reales y se usa el render real.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const COL = 'TIPO DE OPERACIÓN';
const COLS = ['CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', COL,
  'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO',
  'HR. DE RECEPCIÓN'];

const PAISES = {
  OAX: 'México', SLP: 'México', TRC: 'México', MTY: 'México', GDL: 'México', NLU: 'México', MID: 'México', CUN: 'México',
  FRA: 'Alemania', PVG: 'China', SJO: 'Costa Rica', BOG: 'Colombia', IAH: 'Estados Unidos', LAX: 'Estados Unidos',
};

// [guardado, tipo de manifiesto, ruta, lo que debe mostrar la celda]
const CASOS = [
  ['J', 'LLEGADA', 'OAX-NLU-GDL', 'Nacional'],
  ['C', 'SALIDA', 'MID-NLU-SLP', 'Nacional'],
  ['P', 'LLEGADA', 'TRC-NLU-CUN', 'Nacional'],
  ['F', 'LLEGADA', 'FRA-NLU-IAH', 'Internacional'],
  ['H', 'SALIDA', 'ANC-NLU-PVG', 'Internacional'],
  ['O', 'SALIDA', 'LAX-NLU-SJO', 'Internacional'],
  ['J', 'SALIDA', 'BOGOTA-NLU-BOG', 'Internacional'],
  // Lo guardado manda sobre la ruta, igual que en la celda.
  ['Internacional', 'LLEGADA', 'MTY-NLU', 'Internacional'],
  ['NACIONAL', 'SALIDA', 'NLU-FRA', 'Nacional'],
];

const DATOS = CASOS.map(([guardado, tipo, ruta], i) => ({
  id: 9000 + i, 'CIERRE SUBSECRETARIA': '', MES: '10', FECHA: '2026-10-02',
  'TIPO DE MANIFIESTO': tipo, AEROLINEA: 'ZZ', [COL]: guardado,
  AERONAVE: 'A320', 'MATRÍCULA': 'XA' + i, 'ESTATUS MATRÍCULA': 'ACTIVA',
  '# DE VUELO': `ZZ ${100 + i}`, 'DESTINO / ORIGEN': ruta, RUTA: ruta,
  'SLOT ASIGNADO': `02/10/2026 ${String(i).padStart(2, '0')}:00`, 'HR. DE RECEPCIÓN': '',
}));
const CODIGOS_ORIGINALES = DATOS.map((r) => r[COL]);

let win;
let doc;
let errores;

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
  });
  win.HTMLCanvasElement.prototype.getContext = () => doble;
  win.HTMLElement.prototype.scrollIntoView = noop;
  win.console.log = noop;
  win.console.warn = noop;

  // Las variables `let` de script.js solo se ven dentro del mismo eval.
  win.eval(fs.readFileSync(path.join(raiz, 'script.js'), 'utf8') + `
    ;window.__conciPrueba = {
      paises(mapa) { Object.entries(mapa).forEach(([k, v]) => _conciAirportCountryByIata.set(k, v)); },
      datos() { return _conciManifestosAllData; },
      filtro(col) { return _conciExcelFilters[col] || null; },
    };`);
  win.__conciPrueba.paises(PAISES);
}, 60000);

afterAll(() => { if (win) win.close(); });

const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
const visibles = () => filas().filter((tr) => tr.style.display !== 'none');
const celda = (tr) => tr.querySelector(`td[data-col="${COL}"]`);
const mostrado = (tr) => celda(tr).dataset.raw;
const menu = () => doc.querySelector('.conci-excel-dropdown');
const opciones = () => [...menu().querySelectorAll('.conci-ef-item')].map((it) => it.dataset.value);

async function pintar() {
  win.eval('_conciClearAllTableFilters()');
  win._renderConciManifiestosTable(DATOS, COLS, 2026);
  const inicio = Date.now();
  while (filas().length < DATOS.length && Date.now() - inicio < 8000) await esperar(20);
  await esperar(50);
}

function abrirFiltro() {
  doc.querySelector(`#table-conci-manifiestos thead .conci-ef-btn[data-col="${COL}"]`).click();
  expect(menu()).not.toBeNull();
}

function aceptarCon(valores) {
  menu().querySelectorAll('.conci-ef-chk').forEach((chk) => { chk.checked = valores.includes(chk.value); });
  menu().querySelector('#conci-ef-apply').click();
}

const deTipo = (tipo) => filas().filter((tr) => mostrado(tr) === tipo);

describe('filtro de TIPO DE OPERACIÓN', () => {
  beforeEach(pintar);
  afterEach(() => { expect(errores).toEqual([]); });

  test('la celda muestra la clasificación esperada (punto de partida)', () => {
    expect(filas().map(mostrado)).toEqual(CASOS.map((c) => c[3]));
  });

  test('solo ofrece Nacional e Internacional, no los códigos del itinerario', () => {
    abrirFiltro();
    expect(opciones()).toEqual(['Internacional', 'Nacional']);
  });

  test('marcar solo Nacional deja exactamente las filas que la tabla muestra como Nacional', () => {
    abrirFiltro();
    aceptarCon(['Nacional']);
    expect(visibles()).toEqual(deTipo('Nacional'));
    expect(visibles()).toHaveLength(4);
  });

  test('marcar solo Internacional deja exactamente las filas que la tabla muestra como Internacional', () => {
    abrirFiltro();
    aceptarCon(['Internacional']);
    expect(visibles()).toEqual(deTipo('Internacional'));
    expect(visibles()).toHaveLength(5);
  });

  test('clic en el texto ("solo ese valor") usa la misma clasificación', () => {
    abrirFiltro();
    menu().querySelector('.conci-ef-label[data-value="Internacional"]').click();
    expect(visibles()).toEqual(deTipo('Internacional'));
  });

  test('ambas opciones muestran todas las filas y no dejan filtro activo', () => {
    abrirFiltro();
    aceptarCon(['Nacional']);
    abrirFiltro();
    // Al reabrir, la casilla refleja el filtro vigente.
    const marcadas = [...menu().querySelectorAll('.conci-ef-chk')].filter((c) => c.checked).map((c) => c.value);
    expect(marcadas).toEqual(['Nacional']);
    aceptarCon(['Nacional', 'Internacional']);
    expect(visibles()).toHaveLength(DATOS.length);
    expect(win.__conciPrueba.filtro(COL)).toBeNull();
  });

  test('"Borrar filtro" + Aceptar y "Limpiar filtros" restauran la tabla', () => {
    abrirFiltro();
    aceptarCon(['Internacional']);
    abrirFiltro();
    menu().querySelector('#conci-ef-none').click();
    menu().querySelector('#conci-ef-apply').click();
    expect(visibles()).toHaveLength(DATOS.length);
    expect(win.__conciPrueba.filtro(COL)).toBeNull();

    abrirFiltro();
    aceptarCon(['Nacional']);
    expect(visibles()).toHaveLength(4);
    win.eval('_conciClearAllTableFilters()');
    expect(visibles()).toHaveLength(DATOS.length);
    expect(win.__conciPrueba.filtro(COL)).toBeNull();
  });

  test('no toca el dato guardado ni la clasificación carga / pasajeros', () => {
    abrirFiltro();
    aceptarCon(['Internacional']);
    expect(win.__conciPrueba.datos().map((r) => r[COL])).toEqual(CODIGOS_ORIGINALES);
    // F y H (Service Type de carga) siguen marcando la fila como carga.
    expect(filas().map((tr) => tr.dataset.rowCargo)).toEqual(['0', '0', '0', '1', '1', '0', '0', '0', '0']);
  });

  test('las demás columnas siguen filtrándose por su valor guardado', () => {
    doc.querySelector('#table-conci-manifiestos thead .conci-ef-btn[data-col="TIPO DE MANIFIESTO"]').click();
    expect(opciones()).toEqual(['LLEGADA', 'SALIDA']);
    aceptarCon(['SALIDA']);
    expect(visibles().map((tr) => tr.dataset.rowDir)).toEqual(Array(5).fill('dep'));
  });
});
