/**
 * @jest-environment node
 *
 * Catálogos de matrículas de Conciliación Manifiestos.
 *
 * Lo que se fija:
 *   1. data/master/aircraft.csv y la carga inicial de matriculas_manifiestos no
 *      tienen matrículas repetidas con otra escritura (XA-VBZ / XAVBZ), ni
 *      espacios, ni minúsculas, y las verificadas en el registro FAA tienen su
 *      tipo.
 *   2. Guardar desde "Catálogo de matrículas" quita los espacios y rechaza una
 *      matrícula que ya existe escrita de otra forma.
 *   3. Si la tabla ya trae repetidas, la pantalla usa siempre la editada más
 *      recientemente (antes, cualquiera).
 *
 * Detalle de la revisión: docs/catalogo-matriculas-revision.md
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const llave = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const aircraft = fs.readFileSync(path.join(raiz, 'data', 'master', 'aircraft.csv'), 'utf8')
  .replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(1).map((l) => l.split(','));
const semilla = [...fs.readFileSync(path.join(raiz, 'db', 'seed_matriculas_manifiestos.sql'), 'utf8')
  .matchAll(/^\s*\(\d+, '([^']*)'/gm)].map((m) => m[1]);

const repetidas = (lista) => {
  const vistas = new Map();
  lista.forEach((m) => vistas.set(llave(m), [...(vistas.get(llave(m)) || []), m]));
  return [...vistas].filter(([, v]) => v.length > 1).map(([k]) => k);
};

describe('archivos de matrículas', () => {
  test('aircraft.csv no tiene repetidas salvo la pendiente de validar', () => {
    // EI-MAE aparece con dos operadores (GH y M7) y dos MTOW; falta saber cuál es.
    expect(repetidas(aircraft.map((c) => c[0]))).toEqual(['EIMAE']);
  });

  test('la carga inicial del catálogo de matrículas no tiene repetidas', () => {
    expect(semilla).toHaveLength(575);
    expect(repetidas(semilla)).toEqual([]);
  });

  test('ninguna matrícula trae espacios ni minúsculas, salvo la que corrige la 059', () => {
    const raras = (lista) => lista.filter((m) => /\s|[a-z]/.test(m));
    expect(raras(aircraft.map((c) => c[0]))).toEqual([]);
    expect(raras(semilla)).toEqual(['HP1536 CMP']);
  });

  test('las matrículas verificadas en el registro FAA tienen su tipo', () => {
    const tipo = Object.fromEntries(aircraft.map((c) => [c[0], c[1]]));
    // FAA 2026-10-06
    expect(tipo.N188AM).toBe('7M8');      // 737-8
    expect(tipo.N864GT).toBe('74N');      // 747-83QF
    expect(tipo.N430GT).toBe('74Y');      // 747-4H6F
    expect(tipo.N415UP).toBe('75F');      // 757-24APF
    expect(tipo.N337QT).toBe('333');      // A330-343
    expect(tipo.N332QT).toBe('332');      // A330-243F
    expect(tipo.N211RH).toBe('SW4');      // SA227-AC (estaba como MD-11)
    expect(tipo.N878FD).toBe('77F');      // 777F
    expect(tipo.N546VL).toBe('32N');      // A320-271N
  });

  test('los Embraer de Mexicana son E2, como dice su catálogo de matrículas', () => {
    // XA-MXA: E195-E2 de 132 asientos (prensa, ago-2025); el catálogo de
    // matrículas tiene MXA-MXE como E195-E2 y MXF como ERJ 190-300 (E190-E2).
    const fila = Object.fromEntries(aircraft.map((c) => [c[0], c]));
    ['XAMXA', 'XAMXB', 'XAMXC', 'XAMXD', 'XAMXE'].forEach((m) => {
      expect(fila[m][1]).toBe('295');
      expect(fila[m][3]).toBe('132');
    });
    expect(fila.XAMXF[1]).toBe('290');
  });

  test('la aerolínea corresponde al código del operador', () => {
    const fila = Object.fromEntries(aircraft.map((c) => [c[0], c]));
    expect(fila.HI1098[7]).toBe('Arajet');
    expect(fila.XAVUQ[7]).toBe('Volaris');
    expect(fila.CGPAJ[7]).toBe('Cargojet Airways');
    expect(fila.N538VL[4]).toBe('CIVILIAN');
  });
});

describe('pantalla "Catálogo de matrículas"', () => {
  let win;
  let errores;
  let avisos;
  let insertados;
  let respuestaCatalogo;

  beforeAll(() => {
    errores = [];
    avisos = [];
    insertados = [];
    respuestaCatalogo = [];
    const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), {
      url: 'http://localhost:3000/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    win = dom.window;
    win.addEventListener('error', (e) => errores.push((e.error && e.error.stack) || e.message));

    const noop = () => {};
    const doble = new Proxy(function () {}, { get: () => doble, apply: () => doble, construct: () => doble });
    // Cliente mínimo: cualquier consulta encadenada responde vacío; la del
    // catálogo de matrículas responde lo que diga la prueba, e insert/update
    // se registran.
    const consulta = (tabla) => {
      const resultado = () => ({ data: tabla === 'matriculas_manifiestos' ? respuestaCatalogo : [], error: null });
      const q = new Proxy({}, {
        get: (t, p) => {
          if (p === 'then') return (res, rej) => Promise.resolve(resultado()).then(res, rej);
          if (p === 'insert' || p === 'update') return (payload) => { insertados.push(payload); return q; };
          return () => q;
        },
      });
      return q;
    };
    Object.assign(win, {
      supabase: { createClient: () => ({ from: consulta, rpc: () => consulta(''), channel: () => doble, removeChannel: noop, auth: doble, storage: doble }) },
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
      ;window.supabaseClient = window.supabase.createClient();
      _conciCatalogFeedback = (mensaje, tono) => window.__avisos.push({ mensaje, tono });
      _conciRenderScopedCatalog = () => {};
      _conciLoadScopedCatalog = async () => {};
      window.__mat = {
        formatear: (v) => _conciFormatMatriculaForCatalog(v),
        filas: (rows) => { _conciScopedCatalogRows = rows; },
        guardar: (form) => _conciSaveScopedCatalog({ preventDefault() {}, currentTarget: form }, 'matricula'),
        cargar: async () => { _conciMatriculaCatalogLoaded = false; await _ensureConciMatriculaCatalog(); return _conciMatriculaCatalogMap; },
      };`);
  }, 60000);

  beforeEach(() => {
    avisos.length = 0;
    insertados.length = 0;
    win.__avisos = avisos;
  });
  afterAll(() => { if (win) win.close(); });
  afterEach(() => { expect(errores).toEqual([]); });

  const formulario = (campos) => {
    const form = win.document.createElement('form');
    Object.entries({ id: '', matricula: '', aerolinea: 'VOLARIS', estatus: 'ACTIVO', tipo_de_aeronave: '', tipo_de_aeronave_2: '',
      mlw_ton: '', mtow_ton: '', mzfw_ton: '', promedio: '', pasajeros: '186', ...campos }).forEach(([name, value]) => {
      const input = win.document.createElement('input');
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });
    return form;
  };

  test('al guardar se quitan los espacios y se pasa a mayúsculas, conservando el guion', () => {
    expect(win.__mat.formatear('HP1536 CMP')).toBe('HP1536CMP');
    expect(win.__mat.formatear(' xa-vbz ')).toBe('XA-VBZ');
    expect(win.__mat.formatear('N 542VL')).toBe('N542VL');
  });

  test('una matrícula que ya existe con otra escritura no se vuelve a dar de alta', async () => {
    win.__mat.filas([{ id: 7, matricula: 'XA-VBZ', aerolinea: 'VIVA AEROBUS' }]);
    await win.__mat.guardar(formulario({ matricula: 'xavbz' }));
    expect(insertados).toEqual([]);
    expect(avisos[0].tono).toBe('danger');
    expect(avisos[0].mensaje).toMatch(/ya está en el catálogo como XA-VBZ \(VIVA AEROBUS\)/);
  });

  test('editar el mismo registro sí se permite, y una matrícula nueva se guarda', async () => {
    win.__mat.filas([{ id: 7, matricula: 'XA-VBZ', aerolinea: 'VIVA AEROBUS' }]);
    await win.__mat.guardar(formulario({ id: '7', matricula: 'XA-VBZ', aerolinea: 'VIVA AEROBUS' }));
    await win.__mat.guardar(formulario({ matricula: 'XA-VXY' }));
    expect(insertados.map((p) => p.matricula)).toEqual(['XA-VBZ', 'XA-VXY']);
  });

  test('si la tabla trae repetidas, manda la editada más recientemente', async () => {
    // La consulta pide orden por updated_at descendente: la primera es la más reciente.
    respuestaCatalogo = [
      { matricula: 'XA-VBZ', aerolinea: 'VIVA AEROBUS', estatus: 'ACTIVO', pasajeros: 240 },
      { matricula: 'XAVBZ', aerolinea: 'VOLARIS', estatus: 'ACTIVO', pasajeros: 186 },
    ];
    const mapa = await win.__mat.cargar();
    expect(mapa.get('XAVBZ')).toMatchObject({ aerolinea: 'VIVA AEROBUS', pasajeros: 240 });
  });
});
