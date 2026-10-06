/**
 * @jest-environment node
 *
 * "# DE VUELO" muestra solo el número de vuelo, sin el código de la aerolínea,
 * en la tabla de Conciliación Manifiestos y en Exportar Excel (Total, Pasajeros
 * y Carga): "EK 9915" → "9915", "AM998" → "998".
 *
 * Varios códigos IATA llevan un dígito ("M7", "W8", "L3", "K4"), así que
 * quedarse con todos los dígitos convertiría "M7 6810" en "76810". Lo guardado
 * no cambia: data-raw, la búsqueda, los filtros y el editor siguen trabajando
 * con el vuelo completo, y "Exportar por capturista" lo sigue exportando así.
 *
 * Se carga el index.html y el script.js reales; ExcelJS se sustituye por un
 * registro mínimo de las filas que se escriben.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const VUELO = '# DE VUELO';

// [vuelo guardado, AEROLINEA, ¿carga?, lo que debe verse]
const CASOS = [
  ['AM998', 'AM', false, '998'],
  ['AM 871', 'AM', false, '871'],
  ['EK 9915', 'EK', true, '9915'],
  ['M7 6810', 'M7', false, '6810'],
  ['W8 968', 'W8', true, '968'],
  ['L3 6218', 'L3', true, '6218'],
  ['K4 4819', 'K4', true, '4819'],
  ['998', 'AM', false, '998'],
  ['AM 0998', 'AM', false, '0998'],
  ['0123', 'Y4', false, '0123'],
  // Pegado a un código con dígito: lo separa la AEROLINEA de la fila.
  ['M76810', 'M7', false, '6810'],
  ['W8968', 'W8', true, '968'],
  // Sin AEROLINEA no hay de dónde saber el corte: se deja tal cual.
  ['M76810', '', false, 'M76810'],
  ['', 'VB', false, ''],
  [null, 'VB', false, ''],
];

const crudo = (vuelo) => (vuelo === null || vuelo === undefined ? '' : String(vuelo).trim());

const filaDe = ([vuelo, aerolinea, carga], i) => ({
  id: 7000 + i, 'CIERRE SUBSECRETARIA': '', MES: '10', FECHA: '2026-10-05',
  'TIPO DE MANIFIESTO': i % 2 ? 'SALIDA' : 'LLEGADA', AEROLINEA: aerolinea, 'TIPO DE OPERACIÓN': 'Nacional',
  AERONAVE: 'A320', 'MATRÍCULA': 'XA-T' + String(i).padStart(2, '0'), 'ESTATUS MATRÍCULA': 'ACTIVA', [VUELO]: vuelo,
  'DESTINO / ORIGEN': 'GDL-NLU', RUTA: 'GDL-NLU',
  'SLOT ASIGNADO': `05/10/2026 ${String(i).padStart(2, '0')}:00`,
  'HR. DE OPERACIÓN': `05/10/2026 ${String(i).padStart(2, '0')}:10`,
  'HR. DE RECEPCIÓN': `05/10/2026 ${String(i).padStart(2, '0')}:30`,
  'TOTAL PAX': carga ? '' : String(100 + i), 'KG DE CARGA TOTAL': carga ? String(1000 * (i + 1)) : '',
  'CAPTURÓ': 'Prueba', cierre_es_carga_reportado: carga,
});
const DATOS = CASOS.map(filaDe);

let win;
let doc;
let errores;
let libros;

// Lo justo de ExcelJS para registrar qué filas se escriben en cada hoja.
function excelFalso() {
  libros = [];
  const celdas = (valores) => valores.map((value) => ({ value }));
  class Hoja {
    constructor(nombre) { this.nombre = nombre; this.filas = []; this._cols = []; }
    set columns(defs) { this._cols = defs.map((d) => ({ ...d })); this.encabezados = defs.map((d) => d.header); }
    get columns() { return this._cols; }
    getRow() { const c = celdas(this.encabezados); return { eachCell: (cb) => c.forEach((x, i) => cb(x, i + 1)) }; }
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
      columnas() { return _CONCI_OUTPUT_COLUMNS.slice(); },
      filtrar(col, texto) { if (texto) _conciColFilters[col] = texto; else delete _conciColFilters[col]; _conciApplyPillFilter(); },
    };`);
  win.ExcelJS = excelFalso();
}, 60000);

afterAll(() => { if (win) win.close(); });

const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
const celda = (tr, col) => [...tr.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col);
const filaDeMatricula = (matricula) => filas().find((tr) => celda(tr, 'MATRÍCULA').dataset.raw === matricula);

async function pintar() {
  win._renderConciManifiestosTable(DATOS, win.__conciPrueba.columnas(), 2026);
  const inicio = Date.now();
  while (filas().length < DATOS.length && Date.now() - inicio < 8000) await esperar(20);
  await esperar(50);
}

// Lo que muestra la tabla en # DE VUELO, por matrícula.
const tablaVisible = () => new Map(filas().map((tr) => [celda(tr, 'MATRÍCULA').dataset.raw, celda(tr, VUELO).textContent]));

// # DE VUELO de cada hoja del último libro, por matrícula.
function hojasDelUltimoLibro() {
  const libro = libros[libros.length - 1];
  const hojas = {};
  libro.hojas.forEach((h) => {
    const col = (nombre) => h.encabezados.indexOf(nombre);
    hojas[h.nombre] = new Map(h.filas.map((f) => [f[col('MATRÍCULA')], f[col(VUELO)]]));
  });
  return hojas;
}

describe('# DE VUELO: solo el número de vuelo', () => {
  afterEach(() => { expect(errores).toEqual([]); });

  test('el código se separa por su forma, nunca quedándose con todos los dígitos', () => {
    const casos = [
      ['AM998', '', '998'], ['AM 871', '', '871'], ['EK 9915', '', '9915'], ['M7 6810', '', '6810'],
      ['W8 968', '', '968'], ['L3 6218', '', '6218'], ['K4 4819', '', '4819'], ['998', '', '998'],
      ['am-998', '', '998'], ['AMX 123', '', '123'], ['XN 1107A', '', '1107A'],
      ['AM 0998', '', '0998'], ['0998', '', '0998'], [4103, 'VB', '4103'],
      ['M76810', 'M7', '6810'], ['K44819', 'K4', '4819'], ['M76810', '', 'M76810'],
      ['', 'AM', ''], [null, 'AM', ''], [undefined, '', ''], ['   ', '', ''],
      ['VIVA 998', '', 'VIVA 998'], ['123 456', '', '123 456'],
      // Una AEROLINEA sin letras no recorta un número sin prefijo.
      ['76810', '7', '76810'],
    ];
    casos.forEach(([valor, aerolinea, esperado]) => {
      expect([valor, win._conciNumeroDeVuelo(valor, aerolinea)]).toEqual([valor, esperado]);
    });
  });

  test('la tabla muestra el número y conserva el vuelo completo en data-raw', async () => {
    await pintar();
    CASOS.forEach(([vuelo, , , esperado], i) => {
      const td = celda(filaDeMatricula(DATOS[i]['MATRÍCULA']), VUELO);
      expect([vuelo, td.textContent]).toEqual([vuelo, esperado]);
      expect(td.dataset.raw).toBe(crudo(vuelo));
    });
  });

  test('buscar por el vuelo completo o por el número sigue encontrando la fila', async () => {
    await pintar();
    const visibles = () => filas().filter((tr) => tr.style.display !== 'none').map((tr) => celda(tr, VUELO).dataset.raw).sort();
    for (const [texto, esperado] of [
      ['EK 9915', ['EK 9915']], ['EK9915', ['EK 9915']], ['9915', ['EK 9915']],
      ['M7', ['M7 6810', 'M76810', 'M76810']], ['0998', ['AM 0998']],
    ]) {
      win.__conciPrueba.filtrar(VUELO, texto);
      expect([texto, visibles()]).toEqual([texto, esperado.sort()]);
    }
    win.__conciPrueba.filtrar(VUELO, '');
    expect(visibles()).toHaveLength(DATOS.length);
  });

  test('el editor trae el vuelo completo y al cerrarse la celda vuelve a mostrar el número', async () => {
    await pintar();
    const td = celda(filaDeMatricula('XA-T01'), VUELO); // AM 871
    win._conciActivateCellEditor(td);
    const input = td.querySelector('input');
    expect(input.value).toBe('AM 871');
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(td.textContent).toBe('871');
    expect(td.dataset.raw).toBe('AM 871');
    expect(td.dataset.dirty).toBeUndefined();

    win._conciCommitCellRaw(td, 'AM 0871', false, 'AM 0871');
    expect(td.textContent).toBe('0871');
    expect(td.dataset.raw).toBe('AM 0871');
    expect(td.dataset.pendingRaw).toBe('AM 0871');
  });

  test('Total, Pasajeros y Carga exportan el mismo número que muestra la tabla', async () => {
    await pintar();
    const tabla = tablaVisible();
    const pax = CASOS.filter((c) => !c[2]).length;
    const carga = CASOS.filter((c) => c[2]).length;

    await win.conciExportExcel('pax');
    const soloPax = hojasDelUltimoLibro();
    await win.conciExportExcel('carga');
    const soloCarga = hojasDelUltimoLibro();
    await win.conciExportExcel('total');
    const total = hojasDelUltimoLibro();
    expect(Object.keys(total)).toEqual(['Pasajeros', 'Carga']);

    [soloPax.Pasajeros, soloCarga.Carga, total.Pasajeros, total.Carga].forEach((hoja) => {
      hoja.forEach((valor, matricula) => {
        expect([matricula, valor]).toEqual([matricula, tabla.get(matricula)]);
        expect(typeof valor).toBe('string'); // texto: conserva los ceros a la izquierda
      });
    });
    expect(soloPax.Pasajeros.size + soloCarga.Carga.size).toBe(pax + carga);
    expect(soloPax.Pasajeros.get('XA-T08')).toBe('0998');
    expect(soloPax.Pasajeros.get('XA-T13')).toBe('');
    expect(soloPax.Pasajeros.get('XA-T14')).toBe('');
  });

  test('las filas que aún no se pintan (carga por lotes) exportan igual', async () => {
    await pintar();
    doc.querySelector('#table-conci-manifiestos tbody').innerHTML = '';
    await win.conciExportExcel('total');
    const total = hojasDelUltimoLibro();
    CASOS.forEach(([, , esCarga, esperado], i) => {
      expect(total[esCarga ? 'Carga' : 'Pasajeros'].get(DATOS[i]['MATRÍCULA'])).toBe(esperado);
    });
  });

  test('Exportar por capturista conserva el vuelo completo', async () => {
    await pintar();
    await win.conciExportPorCapturista('pax');
    const hojas = hojasDelUltimoLibro();
    expect(Object.keys(hojas)).toEqual(['Prueba']);
    hojas.Prueba.forEach((valor, matricula) => {
      const i = DATOS.findIndex((d) => d['MATRÍCULA'] === matricula);
      expect(valor).toBe(crudo(CASOS[i][0]));
    });
  });
});
