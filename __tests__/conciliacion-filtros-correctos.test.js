/**
 * @jest-environment node
 *
 * Filtros de la tabla de Conciliación Manifiestos: que cada fila mostrada cumpla
 * lo pedido y que no falte ninguna que sí lo cumpla.
 *
 *  · Los "Filtrar…" no distinguen acentos ni mayúsculas: "aeromexico" no
 *    encontraba AEROMÉXICO, "jose" no encontraba a José Pérez.
 *  · En las columnas de categoría se busca el inicio de la etiqueta:
 *    "nacional" traía también las Internacional y "activa" las NO ACTIVA.
 *  · El filtro desplegable lista y compara lo que se ve en la celda: la misma
 *    fecha guardada como "05/10", "05/10/2026" o "2026-10-05" eran tres
 *    opciones y elegir una dejaba fuera las otras; igual "LLEGADA"/"Llegada".
 *  · Buscar en el desplegable y Aceptar deja solo lo encontrado, como Excel.
 *  · "Filtrar…" de # DE VUELO y el buscador de vuelo muestran el mismo texto.
 *  · Al quitar un filtro con miles de filas pintadas no se muestran todas de
 *    golpe (casi 2 s de maquetado): las que no caben aparecen al desplazarse,
 *    en orden y sin faltar ninguna.
 *
 * Se carga el index.html y el script.js reales y se usa el render real. jsdom
 * no calcula alturas: se simula la del contenedor con scroll.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const COLS = ['CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN',
  'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO',
  'HR. DE OPERACIÓN', 'HR. DE RECEPCIÓN', 'PUNTUALIDAD / CANCELACIÓN', 'CAPTURÓ'];

let id = 7000;
const fila = (o) => ({
  id: ++id, 'CIERRE SUBSECRETARIA': '', MES: '10', FECHA: '05/10/2026', 'TIPO DE MANIFIESTO': 'LLEGADA',
  AEROLINEA: 'AM', 'TIPO DE OPERACIÓN': 'Nacional', AERONAVE: 'A320', 'MATRÍCULA': 'XA' + id,
  'ESTATUS MATRÍCULA': 'ACTIVA', '# DE VUELO': `AM ${id}`, 'DESTINO / ORIGEN': 'MTY-NLU', RUTA: 'MTY-NLU',
  'SLOT ASIGNADO': '05/10/2026 10:00', 'HR. DE OPERACIÓN': '', 'HR. DE RECEPCIÓN': '', 'PUNTUALIDAD / CANCELACIÓN': '',
  'CAPTURÓ': '', ...o,
});

const DATOS = [
  fila({ AEROLINEA: 'AM', '# DE VUELO': 'AM 100', 'CAPTURÓ': 'José Pérez', 'HR. DE RECEPCIÓN': '06/10/2026 08:00' }),
  fila({ AEROLINEA: 'CX', '# DE VUELO': 'CX 096', 'TIPO DE OPERACIÓN': 'Internacional', 'ESTATUS MATRÍCULA': 'NO IDENTIFICADA' }),
  fila({ AEROLINEA: 'VB', '# DE VUELO': 'VB 001', FECHA: '2026-10-05', 'TIPO DE MANIFIESTO': 'Salida' }),
  fila({ AEROLINEA: 'VB', '# DE VUELO': 'VB 002', FECHA: '05/10', 'TIPO DE MANIFIESTO': 'Llegada',
    'TIPO DE OPERACIÓN': 'Internacional', 'ESTATUS MATRÍCULA': 'NO IDENTIFICADA' }),
  fila({ AEROLINEA: 'AM', '# DE VUELO': 'AM 200', FECHA: '06/10/2026', 'TIPO DE MANIFIESTO': 'SALIDA',
    'SLOT ASIGNADO': '06/10/2026 09:00', 'HR. DE OPERACIÓN': '06/10/2026 09:00' }),
  fila({ AEROLINEA: 'Y4', '# DE VUELO': 'Y4 0007', 'SLOT ASIGNADO': '05/10/2026 11:00', 'HR. DE OPERACIÓN': '05/10/2026 12:00' }),
];

let win;
let doc;
let errores;
let scrollTop = 0;
const altoVista = 600;

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
    // El catálogo de aerolíneas real, para que la celda muestre AEROMÉXICO y no "AM".
    fetch: (url) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(/airlines\.json/.test(String(url))
        ? JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'airlines.json'), 'utf8'))
        : []),
      text: () => Promise.resolve(''),
    }),
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
      filtroTexto(col, texto) { if (texto) _conciColFilters[col] = texto; else delete _conciColFilters[col]; _conciApplyPillFilter(); },
      filtroExcel(col) { return _conciExcelFilters[col] || null; },
    };`);

  // Alturas del contenedor con scroll (jsdom no tiene layout): 40 px por fila visible.
  const wrap = doc.getElementById('conci-manifiestos-scroll');
  const filasVisibles = () => [...wrap.querySelectorAll('tbody tr')].filter((tr) => tr.style.display !== 'none').length;
  Object.defineProperty(wrap, 'clientHeight', { get: () => altoVista });
  Object.defineProperty(wrap, 'scrollHeight', { get: () => Math.max(altoVista, 90 + 40 * filasVisibles()) });
  Object.defineProperty(wrap, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => {
      const nuevo = Math.max(0, Math.min(v, wrap.scrollHeight - altoVista));
      if (nuevo === scrollTop) return;
      scrollTop = nuevo;
      wrap.dispatchEvent(new win.Event('scroll'));
    },
  });
  win._conciInitQuickFlightSearch();
  return win._ensureConciAirlineCatalog();
}, 60000);

afterAll(() => { if (win) win.close(); });

const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
const visibles = () => filas().filter((tr) => tr.style.display !== 'none');
const vuelos = () => visibles().map((tr) => tr.querySelector('td[data-col="# DE VUELO"]').dataset.raw);
const menu = () => doc.querySelector('.conci-excel-dropdown');
const opciones = () => [...menu().querySelectorAll('.conci-ef-item')].map((it) => it.querySelector('label').textContent);

async function pintar(datos = DATOS) {
  win.eval('_conciClearAllTableFilters()');
  scrollTop = 0;
  win._renderConciManifiestosTable(datos, COLS, 2026);
  const inicio = Date.now();
  while (filas().length < Math.min(datos.length, 250) && Date.now() - inicio < 8000) await esperar(20);
  await esperar(50);
}

async function escribirEnFiltro(col, texto) {
  const input = doc.querySelector(`#table-conci-manifiestos .conci-col-filter[data-col="${col}"]`);
  input.value = texto;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  await esperar(260); // debounce de 200 ms
}

function abrirExcel(col) {
  doc.querySelectorAll('.conci-excel-dropdown').forEach((m) => m.remove());
  doc.querySelector(`#table-conci-manifiestos thead .conci-ef-btn[data-col="${col}"]`).click();
  expect(menu()).not.toBeNull();
}

describe('"Filtrar…" sin acentos ni mayúsculas', () => {
  beforeEach(() => pintar());
  afterEach(() => { expect(errores).toEqual([]); });

  test.each([
    ['AEROLINEA', 'aeromexico', ['AM 100', 'AM 200']],
    ['AEROLINEA', 'AEROMÉXICO', ['AM 100', 'AM 200']],
    ['AEROLINEA', '  viva   aerobus ', ['VB 001', 'VB 002']],
    ['CAPTURÓ', 'jose', ['AM 100']],
    ['CAPTURÓ', 'PÉREZ', ['AM 100']],
  ])('%s "%s"', async (col, texto, esperados) => {
    await escribirEnFiltro(col, texto);
    expect(vuelos()).toEqual(esperados);
  });

  test('sin coincidencias muestra el aviso y al borrar vuelven todas', async () => {
    await escribirEnFiltro('AEROLINEA', 'zzzz');
    expect(visibles()).toHaveLength(0);
    expect(doc.querySelector('tr.conci-filter-empty').textContent).toMatch(/No hay vuelos que coincidan/);
    // Centrado en los miles de px de la fila quedaba fuera de la pantalla: el
    // texto va en un bloque que se queda a la vista (position: sticky).
    expect(doc.querySelector('tr.conci-filter-empty .conci-aviso-tabla').textContent).toMatch(/No hay vuelos que coincidan/);
    const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8');
    expect(css).toMatch(/#table-conci-manifiestos \.conci-aviso-tabla \{[^}]*position: sticky;[^}]*left: 0;/);
    await escribirEnFiltro('AEROLINEA', '');
    expect(visibles()).toHaveLength(DATOS.length);
  });
});

describe('columnas de categoría: no se cruzan entre sí', () => {
  beforeEach(() => pintar());
  afterEach(() => { expect(errores).toEqual([]); });

  test.each([
    ['TIPO DE OPERACIÓN', 'nacional', ['AM 100', 'VB 001', 'AM 200', 'Y4 0007']],
    ['TIPO DE OPERACIÓN', 'nac', ['AM 100', 'VB 001', 'AM 200', 'Y4 0007']],
    ['TIPO DE OPERACIÓN', 'Internacional', ['CX 096', 'VB 002']],
    ['ESTATUS MATRÍCULA', 'activa', ['AM 100', 'VB 001', 'AM 200', 'Y4 0007']],
    ['ESTATUS MATRÍCULA', 'no activa', ['CX 096', 'VB 002']],
    ['TIPO DE MANIFIESTO', 'llegada', ['AM 100', 'CX 096', 'VB 002', 'Y4 0007']],
    ['TIPO DE MANIFIESTO', 'SAL', ['VB 001', 'AM 200']],
    // Ninguna etiqueta empieza con "tiempo": se busca al inicio de una palabra.
    ['PUNTUALIDAD / CANCELACIÓN', 'tiempo', ['AM 200']],
    ['PUNTUALIDAD / CANCELACIÓN', 'demora', ['Y4 0007']],
    ['MES', 'oct', DATOS.map((r) => r['# DE VUELO'])],
  ])('%s "%s"', async (col, texto, esperados) => {
    await escribirEnFiltro(col, texto);
    expect(vuelos()).toEqual(esperados);
  });
});

describe('filtro desplegable: lo que se ve en la celda', () => {
  beforeEach(() => pintar());
  afterEach(() => {
    doc.querySelectorAll('.conci-excel-dropdown').forEach((m) => m.remove());
    expect(errores).toEqual([]);
  });

  test('FECHA: una opción por día aunque se haya guardado en otro formato', () => {
    abrirExcel('FECHA');
    expect(opciones()).toEqual(['05/10/2026', '06/10/2026']);
    menu().querySelector('.conci-ef-label[data-value="05/10/2026"]').click();
    expect(vuelos()).toEqual(['AM 100', 'CX 096', 'VB 001', 'VB 002', 'Y4 0007']);
  });

  test('TIPO DE MANIFIESTO: "LLEGADA" incluye las guardadas como "Llegada"', () => {
    abrirExcel('TIPO DE MANIFIESTO');
    expect(opciones()).toEqual(['LLEGADA', 'SALIDA']);
    menu().querySelector('.conci-ef-label[data-value="LLEGADA"]').click();
    expect(vuelos()).toEqual(['AM 100', 'CX 096', 'VB 002', 'Y4 0007']);
  });

  test('MES se lista como se ve ("Octubre")', () => {
    abrirExcel('MES');
    expect(opciones()).toEqual(['Octubre']);
  });

  test('buscar y Aceptar deja solo lo encontrado, como Excel', () => {
    abrirExcel('AEROLINEA');
    const buscar = menu().querySelector('#conci-ef-search');
    buscar.value = 'viva';
    buscar.dispatchEvent(new win.Event('input', { bubbles: true }));
    menu().querySelector('#conci-ef-apply').click();
    expect(vuelos()).toEqual(['VB 001', 'VB 002']);
    expect([...win.__conciPrueba.filtroExcel('AEROLINEA')]).toEqual(['VB']);
  });

  test('buscar sin acentos encuentra la opción con acento', () => {
    abrirExcel('CAPTURÓ');
    const buscar = menu().querySelector('#conci-ef-search');
    buscar.value = 'jose perez';
    buscar.dispatchEvent(new win.Event('input', { bubbles: true }));
    const encontradas = [...menu().querySelectorAll('.conci-ef-item')].filter((it) => it.style.display !== 'none');
    expect(encontradas.map((it) => it.dataset.value)).toEqual(['José Pérez']);
  });

  test('se combina con "Filtrar…" y las pastillas; quitar uno conserva los demás', async () => {
    abrirExcel('AEROLINEA');
    menu().querySelector('.conci-ef-label[data-value="VB"]').click();
    doc.getElementById('conci-pill-llegadas').click();
    expect(vuelos()).toEqual(['VB 002']);
    await escribirEnFiltro('TIPO DE OPERACIÓN', 'nacional');
    expect(vuelos()).toEqual([]);
    await escribirEnFiltro('TIPO DE OPERACIÓN', '');
    expect(vuelos()).toEqual(['VB 002']);
    doc.getElementById('conci-pill-llegadas').click();
    expect(vuelos()).toEqual(['VB 001', 'VB 002']);
    doc.getElementById('btn-conci-clear-filters').click();
    expect(visibles()).toHaveLength(DATOS.length);
  });
});

describe('# DE VUELO', () => {
  beforeEach(() => pintar());
  afterEach(() => { expect(errores).toEqual([]); });

  test('"Filtrar…" de la columna y el buscador de vuelo muestran lo mismo', async () => {
    await escribirEnFiltro('# DE VUELO', 'CX 096');
    expect(doc.getElementById('conci-quick-flight').value).toBe('CX 096');
    expect(vuelos()).toEqual(['CX 096']);
  });

  test('conserva los ceros: "0007" no es "7"', async () => {
    await escribirEnFiltro('# DE VUELO', '0007');
    expect(vuelos()).toEqual(['Y4 0007']);
    await escribirEnFiltro('# DE VUELO', '096');
    expect(vuelos()).toEqual(['CX 096']);
  });
});

describe('miles de filas pintadas', () => {
  // 1 200 filas de 3 aerolíneas; un filtro escaso obliga a pintarlas todas.
  const MUCHAS = Array.from({ length: 1200 }, (_, i) => {
    const al = i === 1150 ? 'CX' : ['AM', 'VB', 'Y4'][i % 3];
    return fila({ AEROLINEA: al, '# DE VUELO': i === 1150 ? 'CX 096' : `${al} ${1000 + i}` });
  });

  afterEach(() => { expect(errores).toEqual([]); });

  test('quitar el filtro no muestra todas de golpe; al desplazarse aparecen todas y en orden', async () => {
    await pintar(MUCHAS);
    await escribirEnFiltro('# DE VUELO', 'CX 096');
    const inicio = Date.now();
    while (visibles().length === 0 && Date.now() - inicio < 8000) await esperar(20);
    expect(vuelos()).toEqual(['CX 096']);
    expect(filas()).toHaveLength(1200);

    await escribirEnFiltro('# DE VUELO', '');
    expect(visibles()).toHaveLength(600);
    expect(visibles().map((tr) => Number(tr.dataset.rowIndex))).toEqual([...Array(600).keys()]);

    const wrap = doc.getElementById('conci-manifiestos-scroll');
    for (let i = 0; i < 20 && visibles().length < 1200; i++) {
      wrap.scrollTop = wrap.scrollHeight;
      await esperar(40);
    }
    expect(visibles().map((tr) => Number(tr.dataset.rowIndex))).toEqual([...Array(1200).keys()]);
  }, 30000);

  test('un filtro nuevo sobre filas diferidas las vuelve a evaluar todas', async () => {
    await pintar(MUCHAS);
    await escribirEnFiltro('# DE VUELO', 'CX 096');
    const inicio = Date.now();
    while (visibles().length === 0 && Date.now() - inicio < 8000) await esperar(20);
    await escribirEnFiltro('# DE VUELO', '');
    expect(visibles()).toHaveLength(600);
    // Con filas diferidas, la aerolínea de la fila 1150 (pintada pero oculta) sigue encontrándose.
    await escribirEnFiltro('AEROLINEA', 'cathay');
    expect(vuelos()).toEqual(['CX 096']);
  }, 30000);
});
