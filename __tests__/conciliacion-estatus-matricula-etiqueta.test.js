/**
 * @jest-environment node
 *
 * Etiqueta de ESTATUS MATRÍCULA en Conciliación Manifiestos.
 *
 * En pantalla el estatus se lee "ACTIVA" o "NO ACTIVA". Es solo nomenclatura:
 * el valor que se guarda, se filtra y se exporta sigue siendo "ACTIVA" o
 * "NO IDENTIFICADA", y los criterios para asignarlo no cambian.
 *
 * Se carga el index.html y el script.js reales y se usa el render real.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const COL = 'ESTATUS MATRÍCULA';
const COLS = ['CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN',
  'AERONAVE', 'MATRÍCULA', COL, '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO', 'HR. DE RECEPCIÓN'];

// Lo que deja _conciApplyMatriculaCatalogValidation antes de pintar.
const ESTATUS = ['ACTIVA', 'NO IDENTIFICADA', 'ACTIVA', 'NO IDENTIFICADA', 'ACTIVA', 'ACTIVA'];
const DATOS = ESTATUS.map((estatus, i) => ({
  id: 7000 + i, 'CIERRE SUBSECRETARIA': '', MES: '10', FECHA: '2026-10-04',
  'TIPO DE MANIFIESTO': i % 2 ? 'SALIDA' : 'LLEGADA', AEROLINEA: 'ZZ', 'TIPO DE OPERACIÓN': 'Nacional',
  AERONAVE: 'A320', 'MATRÍCULA': 'XA' + i, [COL]: estatus,
  '# DE VUELO': `ZZ ${200 + i}`, 'DESTINO / ORIGEN': 'MTY-NLU', RUTA: 'MTY-NLU',
  'SLOT ASIGNADO': `04/10/2026 ${String(i).padStart(2, '0')}:00`, 'HR. DE RECEPCIÓN': '',
}));

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
      datos() { return _conciManifestosAllData; },
      filtro(col) { return _conciExcelFilters[col] || null; },
    };`);
}, 60000);

afterAll(() => { if (win) win.close(); });

const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
const visibles = () => filas().filter((tr) => tr.style.display !== 'none');
const celda = (tr) => tr.querySelector(`td[data-col="${COL}"]`);
const menu = () => doc.querySelector('.conci-excel-dropdown');
const items = () => [...menu().querySelectorAll('.conci-ef-item')];

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

function aceptarCon(valoresInternos) {
  menu().querySelectorAll('.conci-ef-chk').forEach((chk) => { chk.checked = valoresInternos.includes(chk.value); });
  menu().querySelector('#conci-ef-apply').click();
}

const conEstatus = (estatus) => filas().filter((tr, i) => ESTATUS[i] === estatus);

describe('etiqueta de ESTATUS MATRÍCULA', () => {
  beforeEach(pintar);
  afterEach(() => { expect(errores).toEqual([]); });

  test('las celdas dicen ACTIVA / NO ACTIVA con sus colores y conservan el valor interno', () => {
    expect(filas().map((tr) => celda(tr).textContent.trim()))
      .toEqual(['ACTIVA', 'NO ACTIVA', 'ACTIVA', 'NO ACTIVA', 'ACTIVA', 'ACTIVA']);
    expect(filas().map((tr) => celda(tr).dataset.raw)).toEqual(ESTATUS);
    expect(filas().map((tr) => celda(tr).querySelector('span').style.color))
      .toEqual(ESTATUS.map((e) => (e === 'ACTIVA' ? 'rgb(25, 135, 84)' : 'rgb(220, 53, 69)')));
    expect(doc.querySelector('#table-conci-manifiestos tbody').textContent).not.toContain('IDENTIFICADA');
    // Exportar sigue tomando el valor interno.
    expect(filas().map((tr) => win._conciExportCellRaw(celda(tr)))).toEqual(ESTATUS);
  });

  test('el desplegable ofrece exactamente ACTIVA y NO ACTIVA', () => {
    abrirFiltro();
    expect(items().map((it) => it.querySelector('label').textContent)).toEqual(['ACTIVA', 'NO ACTIVA']);
    expect(items().map((it) => it.dataset.value)).toEqual(['ACTIVA', 'NO IDENTIFICADA']);
    expect(menu().textContent).not.toContain('IDENTIFICADA');
  });

  test('NO ACTIVA deja exactamente las filas que antes eran NO IDENTIFICADA', () => {
    abrirFiltro();
    aceptarCon(['NO IDENTIFICADA']);
    expect(visibles()).toEqual(conEstatus('NO IDENTIFICADA'));
    expect(visibles()).toHaveLength(2);
  });

  test('ACTIVA deja exactamente las filas ACTIVA', () => {
    abrirFiltro();
    aceptarCon(['ACTIVA']);
    expect(visibles()).toEqual(conEstatus('ACTIVA'));
    expect(visibles()).toHaveLength(4);
  });

  test('clic en el texto "NO ACTIVA" (solo ese valor) filtra igual', () => {
    abrirFiltro();
    menu().querySelector('.conci-ef-label[data-value="NO IDENTIFICADA"]').click();
    expect(visibles()).toEqual(conEstatus('NO IDENTIFICADA'));
  });

  test('ambas opciones muestran todo; "Borrar filtro" y "Limpiar filtros" restauran la tabla', () => {
    abrirFiltro();
    aceptarCon(['NO IDENTIFICADA']);
    abrirFiltro();
    aceptarCon(['ACTIVA', 'NO IDENTIFICADA']);
    expect(visibles()).toHaveLength(DATOS.length);
    expect(win.__conciPrueba.filtro(COL)).toBeNull();

    abrirFiltro();
    aceptarCon(['ACTIVA']);
    abrirFiltro();
    menu().querySelector('#conci-ef-none').click();
    menu().querySelector('#conci-ef-apply').click();
    expect(visibles()).toHaveLength(DATOS.length);
    expect(win.__conciPrueba.filtro(COL)).toBeNull();

    abrirFiltro();
    aceptarCon(['NO IDENTIFICADA']);
    expect(visibles()).toHaveLength(2);
    win.eval('_conciClearAllTableFilters()');
    expect(visibles()).toHaveLength(DATOS.length);
    expect(win.__conciPrueba.filtro(COL)).toBeNull();
  });

  test('el buscador del desplegable encuentra "no activa"', () => {
    abrirFiltro();
    const buscar = menu().querySelector('#conci-ef-search');
    buscar.value = 'no activa';
    buscar.dispatchEvent(new win.Event('input', { bubbles: true }));
    expect(items().filter((it) => it.style.display !== 'none').map((it) => it.dataset.value))
      .toEqual(['NO IDENTIFICADA']);
  });

  test('el combo de edición muestra NO ACTIVA y guarda NO IDENTIFICADA', () => {
    const td = celda(filas()[1]);
    win._conciActivateMatriculaStatusEditor(td, td.dataset.raw);
    const select = td.querySelector('select');
    expect([...select.options].map((o) => o.textContent)).toEqual(['ACTIVA', 'NO ACTIVA']);
    expect([...select.options].map((o) => o.value)).toEqual(['ACTIVA', 'NO IDENTIFICADA']);
    expect(select.value).toBe('NO IDENTIFICADA');
    // Al cerrarlo sin cambiar, la celda vuelve a decir NO ACTIVA y conserva el valor.
    select.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(td.querySelector('select')).toBeNull();
    expect(td.textContent.trim()).toBe('NO ACTIVA');
    expect(td.dataset.raw).toBe('NO IDENTIFICADA');
  });

  test('no cambia los datos cargados', () => {
    abrirFiltro();
    aceptarCon(['NO IDENTIFICADA']);
    expect(win.__conciPrueba.datos().map((r) => r[COL])).toEqual(ESTATUS);
  });
});
