/**
 * @jest-environment node
 *
 * Catálogo de aeronaves de Conciliación Manifiestos.
 *
 * Lo que se fija:
 *   1. data/master/aircraft type.csv no tiene códigos repetidos, filas de
 *      prueba ni designadores ICAO que no existen (Doc 8643, 2026-10-06), y
 *      aircraft.csv sólo usa códigos del catálogo.
 *   2. Un ICAO que cubre varias variantes (B738, A320) no se traduce a una al
 *      azar; uno inequívoco (B38M) se guarda como su IATA (7M8).
 *   3. Un valor fuera del catálogo se muestra tal cual y marcado; abrir y
 *      cerrar la celda sin escribir no lo cambia.
 *   4. La importación de Excel avisa qué AERONAVE no reconoce.
 *
 * Se carga el index.html y el script.js reales y se usa el render real.
 * Detalle de la revisión: docs/catalogo-aeronaves-revision.md
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const leerCsv = (archivo) => fs.readFileSync(path.join(raiz, 'data', 'master', archivo), 'utf8')
  .replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(1).map((l) => l.split(',').map((c) => c.trim()));
const CSV_TIPOS = fs.readFileSync(path.join(raiz, 'data', 'master', 'aircraft type.csv'), 'utf8');

describe('archivos del catálogo', () => {
  const tipos = leerCsv('aircraft type.csv');
  const iatas = tipos.map((c) => c[0]);

  test('cada código IATA aparece una sola vez y tiene 3 caracteres', () => {
    expect(iatas.filter((c, i) => iatas.indexOf(c) !== i)).toEqual([]);
    expect(iatas.filter((c) => !/^[A-Z0-9]{3}$/.test(c))).toEqual([]);
  });

  test('no quedan filas de prueba ni códigos de operador', () => {
    expect(tipos.filter((c) => /test/i.test(c[2]))).toEqual([]);
    expect(iatas).not.toContain('770');
    expect(iatas).not.toContain('YA');
  });

  test('no quedan designadores ICAO que Doc 8643 no tiene', () => {
    const icaos = tipos.map((c) => c[1]).filter(Boolean);
    ['B31M', 'B781', 'B77F', 'LT2', 'DC9'].forEach((invalido) => expect(icaos).not.toContain(invalido));
    expect(icaos.filter((c) => !/^[A-Z][A-Z0-9]{1,3}$/.test(c))).toEqual([]);
  });

  test('las correcciones de nombre están aplicadas', () => {
    const nombre = (iata) => tipos.find((c) => c[0] === iata)[2];
    expect(nombre('74Y')).toBe('B747-400F');
    expect(nombre('76X')).toBe('B767-200 Freighter');
    expect(nombre('CR1')).toBe('CRJ-100');
    // El CRJ-1000 queda una sola vez, en su código propio.
    expect(tipos.filter((c) => c[2] === 'CRJ-1000').map((c) => c[0])).toEqual(['CRK']);
  });

  test('aircraft.csv sólo usa tipos que existen en el catálogo', () => {
    const tiposMatricula = new Set(leerCsv('aircraft.csv').map((c) => c[1]));
    expect([...tiposMatricula].filter((t) => !iatas.includes(t))).toEqual([]);
  });

  test('las matrículas verificadas en el registro FAA tienen su tipo', () => {
    const tipoDe = Object.fromEntries(leerCsv('aircraft.csv').map((c) => [c[0], c[1]]));
    // FAA 2026-10-06: 737-8 (MAX 8), 737-9 (MAX 9) y SAAB 340B.
    ['N105JS', 'N109JS', 'N110JS', 'N868AM', 'N173AM'].forEach((m) => expect(tipoDe[m]).toBe('7M8'));
    ['N115AM', 'N891AM'].forEach((m) => expect(tipoDe[m]).toBe('7M9'));
    expect(tipoDe.N3172).toBe('SF3');
  });
});

describe('en la tabla de Conciliación', () => {
  const COL = 'AERONAVE';
  const COLS = ['CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN',
    COL, 'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'SLOT ASIGNADO'];
  const VALORES = ['32N', 'A-320', 'B738', 'A321', ''];
  const DATOS = VALORES.map((aeronave, i) => ({
    id: 8100 + i, 'CIERRE SUBSECRETARIA': '', MES: '10', FECHA: '2026-10-04',
    'TIPO DE MANIFIESTO': 'LLEGADA', AEROLINEA: 'ZZ', 'TIPO DE OPERACIÓN': 'Nacional',
    [COL]: aeronave, 'MATRÍCULA': 'XA' + i, 'ESTATUS MATRÍCULA': 'ACTIVA',
    '# DE VUELO': `ZZ ${300 + i}`, 'DESTINO / ORIGEN': 'MTY-NLU', RUTA: 'MTY-NLU',
    'SLOT ASIGNADO': `04/10/2026 ${String(i).padStart(2, '0')}:00`,
  }));

  let win;
  let doc;
  let errores;
  let avisos;

  beforeAll(async () => {
    errores = [];
    avisos = [];
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
      // El catálogo real, servido como lo sirve el servidor.
      fetch: (url) => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve([]),
        text: () => Promise.resolve(/aircraft type\.csv/.test(String(url)) ? CSV_TIPOS : ''),
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
      ;window.__aero = {
        cargar: () => _ensureConciAircraftTypeMap(),
        resolver: (t) => _conciResolveAeronaveInput(t),
        vista: (v) => _conciAeronaveDisplay(v),
        nombre: (c) => _conciAircraftTypeByCode.get(c),
        opciones: () => _conciAircraftTypeOptions,
        construir: (csv) => _conciBuildAircraftTypeCatalog(csv),
        editar: (td, raw) => _conciActivateAeronaveEditor(td, raw),
      };`);
    win.showNotification = (msg) => avisos.push(msg);
    win.eval(fs.readFileSync(path.join(raiz, 'js', 'conci-importar-excel.js'), 'utf8'));
    await win.__aero.cargar();
  }, 60000);

  afterAll(() => { if (win) win.close(); });
  afterEach(() => { expect(errores).toEqual([]); });

  const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
  const celda = (tr) => tr.querySelector(`td[data-col="${COL}"]`);

  async function pintar() {
    win._renderConciManifiestosTable(DATOS, COLS, 2026);
    const inicio = Date.now();
    while (filas().length < DATOS.length && Date.now() - inicio < 8000) await esperar(20);
    await esperar(50);
  }

  describe('traducción de códigos', () => {
    test('un IATA se ve con el nombre del catálogo', () => {
      expect(win.__aero.nombre('32N')).toBe('A320neo');
      expect(win.__aero.nombre('74Y')).toBe('B747-400F');
    });

    test('los Embraer E2 que manda el itinerario (295, 290) se reconocen', () => {
      // 295 = E195-E2 e 290 = E190-E2 (IATA); ICAO E295 / E290 (Doc 8643).
      // Antes no estaban en el catálogo y la celda mostraba "295" sin nombre.
      expect(win.__aero.nombre('295')).toBe('E195-E2');
      expect(win.__aero.nombre('290')).toBe('E190-E2');
      expect(win.__aero.resolver('E295')).toEqual({ code: '295', name: 'E195-E2' });
      expect(win.__aero.vista('295')).toMatchObject({ text: 'E195-E2', sinCatalogo: false });
    });

    test('un valor con dos equipos muestra ambos modelos y queda marcado', () => {
      const doble = win.__aero.vista('295/E95');
      expect(doble.text).toBe('E195-E2 / ERJ-195');
      expect(doble.sinCatalogo).toBe(true);
      expect(doble.title).toMatch(/varios modelos/);
      expect(win.__aero.vista('E95/295').text).toBe('ERJ-195 / E195-E2');
      // Si las dos partes son el mismo modelo, no hay duda que marcar.
      expect(win.__aero.vista('295/E295')).toMatchObject({ text: 'E195-E2', sinCatalogo: false });
      // Si una parte no existe, se ve tal cual.
      expect(win.__aero.vista('295/XYZ')).toMatchObject({ text: '295/XYZ', sinCatalogo: true });
    });

    test('un ICAO inequívoco se traduce; uno que cubre varias variantes no', () => {
      expect(win.__aero.nombre('B38M')).toBe('B737 MAX 8');
      expect(win.__aero.nombre('A21N')).toBe('A321neo');
      // Antes: B738 -> "737-800 (Scimitar wl)" y A320 -> "A320-200 Ceo" (ganaba la última fila).
      expect(win.__aero.nombre('B738')).toBeUndefined();
      expect(win.__aero.nombre('A320')).toBeUndefined();
      expect(win.__aero.nombre('B77L')).toBeUndefined();
    });

    test('si un texto es IATA de una fila e ICAO de otra, manda el IATA', () => {
      const cat = win.__aero.construir('IATA,ICAO,Name\nDC9,DC93,DC-9-30\nXX1,DC9,Otro');
      expect(cat.byCode.get('DC9')).toBe('DC-9-30');
    });

    test('un código IATA repetido no duplica la opción ni cambia el nombre', () => {
      const cat = win.__aero.construir('IATA,ICAO,Name\n7M7,B37M,737 MAX 7\n7M7,B37M,Boeing 737 MAX7');
      expect(cat.options).toEqual([{ code: '7M7', name: '737 MAX 7' }]);
      expect(cat.byCode.get('B37M')).toBe('737 MAX 7');
    });

    test('el editor guarda IATA aunque se escriba el ICAO', () => {
      expect(win.__aero.resolver('B38M')).toEqual({ code: '7M8', name: 'B737 MAX 8' });
      expect(win.__aero.resolver('A320neo (32N)')).toEqual({ code: '32N', name: 'A320neo' });
    });

    test('un ICAO o un nombre que corresponden a varios modelos quedan sin resolver', () => {
      const b738 = win.__aero.resolver('B738');
      expect(b738.name).toBe('');
      expect(b738.ambiguous.map((o) => o.code).sort()).toEqual(['738', '73H', '73K', '7S8']);
      const crj700 = win.__aero.resolver('CRJ-700');
      expect(crj700.name).toBe('');
      expect(crj700.ambiguous.map((o) => o.code).sort()).toEqual(['CR7', 'CRA']);
    });

    test('lo que no está en el catálogo se conserva tal cual', () => {
      expect(win.__aero.resolver('A-320')).toEqual({ code: 'A-320', name: '' });
    });
  });

  describe('celdas', () => {
    beforeEach(pintar);

    test('cada valor se muestra sin perder el dato guardado', () => {
      expect(filas().map((tr) => celda(tr).textContent.trim())).toEqual(['A320neo', 'A-320', 'B738', 'A321-100/200', '']);
      expect(filas().map((tr) => celda(tr).dataset.raw)).toEqual(VALORES);
    });

    test('los valores fuera del catálogo o ambiguos quedan marcados para revisión', () => {
      const marcadas = filas().map((tr) => celda(tr).classList.contains('conci-aeronave-sin-catalogo'));
      expect(marcadas).toEqual([false, true, true, false, false]);
      expect(celda(filas()[1]).title).toMatch(/no está en el catálogo/);
      expect(celda(filas()[2]).title).toMatch(/varios modelos/);
    });

    test('abrir y cerrar sin escribir no cambia un valor heredado', () => {
      // "A321" también es un ICAO inequívoco (321): no debe convertirse solo.
      const td = celda(filas()[3]);
      win.__aero.editar(td, td.dataset.raw);
      td.querySelector('input').dispatchEvent(new win.Event('blur'));
      expect(td.dataset.raw).toBe('A321');
      expect(td.dataset.dirty).toBeUndefined();
    });

    test('escribir un ICAO inequívoco guarda su IATA y quita la marca', () => {
      const td = celda(filas()[1]);
      win.__aero.editar(td, td.dataset.raw);
      const input = td.querySelector('input');
      input.value = 'B38M';
      input.dispatchEvent(new win.Event('blur'));
      expect(td.dataset.raw).toBe('7M8');
      expect(td.textContent.trim()).toBe('B737 MAX 8');
      expect(td.classList.contains('conci-aeronave-sin-catalogo')).toBe(false);
    });

    test('escribir un ICAO ambiguo se rechaza y pide elegir de la lista', () => {
      const td = celda(filas()[0]);
      win.__aero.editar(td, td.dataset.raw);
      const input = td.querySelector('input');
      input.value = 'B738';
      input.dispatchEvent(new win.Event('blur'));
      expect(td.dataset.raw).toBe('32N');
      expect(avisos[avisos.length - 1]).toMatch(/varios modelos.*Elige uno de la lista/);
    });
  });

  test('la importación de Excel avisa qué AERONAVE no reconoce', () => {
    const plan = {
      insertar: [
        { payload: { AERONAVE: 'A-320' } }, { payload: { AERONAVE: 'A-320' } },
        { payload: { AERONAVE: '32N' } }, { payload: { AERONAVE: 'B738' } },
      ],
      actualizar: [{ payload: { AERONAVE: 'B737-8MAX' } }, { payload: { 'TOTAL PAX': 12 } }],
    };
    expect(win.ConciImportarExcel.aeronavesFueraDeCatalogo(plan)).toEqual([
      { valor: 'A-320', filas: 2 },
      { valor: 'B737-8MAX', filas: 1 },
      { valor: 'B738', filas: 1 },
    ]);
  });
});
