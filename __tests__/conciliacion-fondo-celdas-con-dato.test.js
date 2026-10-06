/**
 * @jest-environment node
 *
 * Fondo azul grisáceo (día #EAF1F8 / #E2EBF5, noche #26364A / #2D4056) en las celdas con dato de 16 columnas de
 * Conciliación Manifiestos. _conciMarcarCeldaConDato pone la clase
 * conci-cell-con-dato y el CSS de index.html pinta el fondo.
 *
 * Se carga el index.html y el script.js reales y se usa el render real.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const RESALTADAS = ['MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN', 'AERONAVE',
  'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO',
  'PUNTUALIDAD / CANCELACIÓN', 'DEMORA +- 15 MIN.', 'CAPTURÓ', 'FACTOR DE OCUPACIÓN'];
const OTRAS = ['CIERRE SUBSECRETARIA', 'SLOT COORDINADO', 'HR. DE OPERACIÓN', 'HR. DE RECEPCIÓN',
  'TOTAL PAX', 'CÓDIGO DEMORA', 'OBSERVACIONES', 'CAPACIDAD MÁXIMA'];
const COLS = ['CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN',
  'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO',
  'SLOT COORDINADO', 'HR. DE OPERACIÓN', 'HR. DE RECEPCIÓN', 'TOTAL PAX', 'PUNTUALIDAD / CANCELACIÓN',
  'DEMORA +- 15 MIN.', 'CÓDIGO DEMORA', 'OBSERVACIONES', 'CAPTURÓ', 'CAPACIDAD MÁXIMA', 'FACTOR DE OCUPACIÓN'];

const LLENA = {
  id: 1, 'CIERRE SUBSECRETARIA': '2026-10-05', MES: '10', FECHA: '2026-10-04', 'TIPO DE MANIFIESTO': 'LLEGADA',
  AEROLINEA: 'AM', 'TIPO DE OPERACIÓN': 'Nacional', AERONAVE: 'E90', 'MATRÍCULA': 'XAACT',
  'ESTATUS MATRÍCULA': 'ACTIVA', '# DE VUELO': 'AM 871', 'DESTINO / ORIGEN': 'VER-NLU', RUTA: 'VER-NLU-PVR',
  'SLOT ASIGNADO': '04/10/2026 09:40', 'SLOT COORDINADO': '04/10/2026 09:40', 'HR. DE OPERACIÓN': '04/10/2026 10:12',
  'HR. DE RECEPCIÓN': '04/10/2026 12:00', 'TOTAL PAX': '90', 'CÓDIGO DEMORA': '93', OBSERVACIONES: 'Sin novedad',
  'CAPTURÓ': 'Omar Pizano', 'CAPACIDAD MÁXIMA': '100', 'FACTOR DE OCUPACIÓN': '90%',
};
// Nulos, undefined y solo espacios cuentan como vacío.
const VACIA = {
  id: 2, 'CIERRE SUBSECRETARIA': null, MES: null, FECHA: '   ', 'TIPO DE MANIFIESTO': undefined, AEROLINEA: '  ',
  'TIPO DE OPERACIÓN': '', AERONAVE: null, 'MATRÍCULA': ' ', 'ESTATUS MATRÍCULA': 'ACTIVA', '# DE VUELO': '',
  'DESTINO / ORIGEN': '', RUTA: '', 'SLOT ASIGNADO': '', 'SLOT COORDINADO': '', 'HR. DE OPERACIÓN': '',
  'HR. DE RECEPCIÓN': '', 'TOTAL PAX': '', 'CÓDIGO DEMORA': '', OBSERVACIONES: '', 'CAPTURÓ': '   ',
  'CAPACIDAD MÁXIMA': '', 'FACTOR DE OCUPACIÓN': '',
};
// Demora de 0 minutos y factor 0%: sí son dato.
const CEROS = {
  ...LLENA, id: 3, 'HR. DE OPERACIÓN': '04/10/2026 09:40', 'TOTAL PAX': '0', 'FACTOR DE OCUPACIÓN': '0%',
};

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

  win.eval(fs.readFileSync(path.join(raiz, 'script.js'), 'utf8') + `
    ;window.__conciPrueba = {
      resolverAerolinea(code, color) { _conciAirlineCodeMap.set(code, { name: 'AEROMÉXICO', color, textColor: '#ffffff' }); },
      filtroColumna(col, v) { _conciColFilters[col] = v; _conciApplyPillFilter(); },
      limpiarFiltros() { _conciClearAllTableFilters(); },
    };`);
  // AM con su color de catálogo, como en la tabla real (fondo azul, texto blanco).
  win.__conciPrueba.resolverAerolinea('AM', '#0b2161');
}, 60000);

afterAll(() => { if (win) win.close(); });

const fila = (id) => doc.querySelector(`#table-conci-manifiestos tbody tr[data-row-id="${id}"]`);
const celda = (id, col) => [...fila(id).querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col);
const conDato = (td) => td.classList.contains('conci-cell-con-dato');
const marcadas = (id) => [...fila(id).querySelectorAll('td.conci-cell-con-dato')].map((td) => td.dataset.col);

async function pintar(datos) {
  win.__conciPrueba.limpiarFiltros();
  win._renderConciManifiestosTable(datos.map((r) => ({ ...r })), COLS, 2026);
  for (let i = 0; i < 100 && !doc.querySelector('#table-conci-manifiestos tbody tr[data-row-id]'); i++) await esperar(20);
  await esperar(50);
}

describe('fondo resaltado en celdas con dato', () => {
  afterEach(() => { expect(errores).toEqual([]); });

  test('fila completa: solo las 16 columnas pedidas', async () => {
    await pintar([LLENA]);
    expect(marcadas(1).sort()).toEqual([...RESALTADAS].sort());
    OTRAS.forEach((col) => expect([col, conDato(celda(1, col))]).toEqual([col, false]));
    // Ni encabezados ni filtros.
    expect(doc.querySelectorAll('#table-conci-manifiestos thead .conci-cell-con-dato')).toHaveLength(0);
  }, 30000);

  test('vacías (null, undefined, espacios) y el "-" de fórmula conservan su apariencia', async () => {
    await pintar([VACIA]);
    // ESTATUS MATRÍCULA trae "ACTIVA": es la única con dato de esta fila.
    expect(marcadas(2)).toEqual(['ESTATUS MATRÍCULA']);
    expect(celda(2, 'PUNTUALIDAD / CANCELACIÓN').textContent).toBe('-');
    expect(celda(2, 'DEMORA +- 15 MIN.').textContent).toBe('-');
    expect(celda(2, 'FACTOR DE OCUPACIÓN').textContent).toBe('-');
  }, 30000);

  test('0 y 0% cuentan como dato', async () => {
    await pintar([CEROS]);
    expect(celda(3, 'DEMORA +- 15 MIN.').dataset.raw).toBe('0');
    expect(conDato(celda(3, 'DEMORA +- 15 MIN.'))).toBe(true);
    expect(celda(3, 'FACTOR DE OCUPACIÓN').dataset.raw).toBe('0%');
    expect(conDato(celda(3, 'FACTOR DE OCUPACIÓN'))).toBe(true);
  }, 30000);

  test('sigue el valor al capturar, borrar o recibir un cambio', async () => {
    await pintar([LLENA, VACIA]);
    const obs = celda(2, 'OBSERVACIONES');
    const aeronave = celda(2, 'AERONAVE');
    const ruta = celda(1, 'RUTA');

    aeronave.dataset.pendingRaw = 'E90'; // tecleado, aún sin guardar
    ruta.dataset.raw = '';               // vaciada por un cambio remoto
    obs.dataset.raw = 'Algo';            // columna fuera de la lista
    await esperar(0);
    expect(conDato(aeronave)).toBe(true);
    expect(conDato(ruta)).toBe(false);
    expect(conDato(obs)).toBe(false);

    aeronave.dataset.pendingRaw = '   '; // lo tecleado manda aunque haya algo guardado
    ruta.dataset.raw = 'VER-NLU-PVR';
    await esperar(0);
    expect(conDato(aeronave)).toBe(false);
    expect(conDato(ruta)).toBe(true);
  }, 30000);

  test('se conserva al filtrar y al volver a pintar (ordenar / actualizar)', async () => {
    await pintar([LLENA, VACIA]);
    win.__conciPrueba.filtroColumna('MATRÍCULA', 'XAACT');
    await esperar(50);
    expect(fila(1).style.display).not.toBe('none');
    expect(marcadas(1).sort()).toEqual([...RESALTADAS].sort());
    win.__conciPrueba.limpiarFiltros();

    await pintar([VACIA, LLENA]);
    expect(marcadas(1).sort()).toEqual([...RESALTADAS].sort());
    expect(marcadas(2)).toEqual(['ESTATUS MATRÍCULA']);
  }, 30000);

  test('aerolínea y estatus con discrepancia no tapan el fondo con estilos en línea', async () => {
    await pintar([{ ...LLENA }]);
    const aerolinea = celda(1, 'AEROLINEA');
    expect(aerolinea.textContent).toBe('AEROMÉXICO');
    expect(aerolinea.style.getPropertyValue('background')).toBe('');
    expect(aerolinea.style.getPropertyValue('color')).toBe('');
    expect(aerolinea.style.fontWeight).toBe('700');

    const estatus = celda(1, 'ESTATUS MATRÍCULA');
    win._conciRenderMatriculaStatusCell(estatus, 'ACTIVA', true, 'VIVA AEROBUS');
    expect(estatus.style.getPropertyValue('background')).toBe('');
    expect(estatus.querySelector('.fa-exclamation-triangle')).not.toBeNull();
  }, 30000);
});
