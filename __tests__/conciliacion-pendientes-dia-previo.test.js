/**
 * Conciliación › Manifiestos: con una sola fecha en el filtro, la vista
 * muestra el día elegido y además anexa los manifiestos SIN CAPTURAR del día
 * previo (HR. DE RECEPCIÓN vacía, mismo criterio que el pill "Sin capturar").
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');

function extraer(inicio, fin) {
  const a = js.indexOf(inicio);
  const b = js.indexOf(fin, a + inicio.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return js.slice(a, b);
}

const COLS = ['FECHA', 'TIPO DE MANIFIESTO', '# DE VUELO', 'SLOT ASIGNADO', 'HR. DE OPERACIÓN', 'HR. DE RECEPCIÓN'];

function cargar() {
  const ctx = {
    _conciIsReceptionColumn: (c) => /^hr\.?\s+de\s+recepci[oó]n$/i.test(String(c).trim()),
    _conciIsoDateKey: (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    // dd/mm/aaaa [hh:mm]
    _conciParseDateTimeParts: (v) => {
      const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      return m ? { day: +m[1], month: +m[2], year: +m[3] } : null;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extraer('function _conciEsPendienteDelDiaPrevio(', 'function _conciRowMatchesOperationDay('), ctx);
  return ctx;
}

describe('pendientes del día previo', () => {
  const { _conciEsPendienteDelDiaPrevio: pendiente } = cargar();
  const fila = (o) => Object.assign({ FECHA: '28/09/2026', 'SLOT ASIGNADO': '28/09/2026 23:45', 'HR. DE OPERACIÓN': '', 'HR. DE RECEPCIÓN': '' }, o);

  test('del día previo y sin HR. DE RECEPCIÓN: se anexa', () => {
    expect(pendiente(fila({}), COLS, 2026, '2026-09-28')).toBe(true);
  });

  test('del día previo pero ya capturado: no se anexa', () => {
    expect(pendiente(fila({ 'HR. DE RECEPCIÓN': '29/09/2026 02:10' }), COLS, 2026, '2026-09-28')).toBe(false);
  });

  test('de dos días antes: no se anexa', () => {
    expect(pendiente(fila({ FECHA: '27/09/2026', 'SLOT ASIGNADO': '27/09/2026 10:00' }), COLS, 2026, '2026-09-28')).toBe(false);
  });

  test('sin ninguna fecha legible: no se arrastra', () => {
    expect(pendiente(fila({ FECHA: '', 'SLOT ASIGNADO': '' }), COLS, 2026, '2026-09-28')).toBe(false);
  });

  test('cancelado o no operativo: no se anexa', () => {
    const cols = COLS.concat(['Status', 'PUNTUALIDAD / CANCELACIÓN', 'OBSERVACIONES']);
    expect(pendiente(fila({ Status: 'Cancelled' }), cols, 2026, '2026-09-28')).toBe(false);
    expect(pendiente(fila({ Status: 'Not operating' }), cols, 2026, '2026-09-28')).toBe(false);
    expect(pendiente(fila({ 'PUNTUALIDAD / CANCELACIÓN': 'CANCELADO' }), cols, 2026, '2026-09-28')).toBe(false);
    expect(pendiente(fila({ OBSERVACIONES: 'VUELO CANCELADO POR LA AEROLÍNEA' }), cols, 2026, '2026-09-28')).toBe(false);
    // Lo demás sigue entrando.
    expect(pendiente(fila({ Status: 'Landed', 'PUNTUALIDAD / CANCELACIÓN': 'DEMORA', OBSERVACIONES: 'REPERCUSION' }), cols, 2026, '2026-09-28')).toBe(true);
  });

  test('cambio de mes: el 30/09 es el previo del 1/10', () => {
    expect(pendiente(fila({ FECHA: '30/09/2026', 'SLOT ASIGNADO': '30/09/2026 22:00' }), COLS, 2026, '2026-09-30')).toBe(true);
  });
});

describe('la carga de la tabla', () => {
  const carga = extraer('async function loadConciliacionManifiestos(', 'window.loadConciliacionManifiestos = loadConciliacionManifiestos;');

  test('solo con una fecha se consulta también el día previo', () => {
    expect(carga).toMatch(/const diaPrevio = \(ventana && ventana\.desde === ventana\.hasta\) \? _conciIsoDesplazado\(ventana\.desde, -1\) : '';/);
    expect(carga).toMatch(/_conciFetchManifestsForDate\(client, year, month, day, dayEnd, ventanaConsulta\)/);
    expect(carga).toMatch(/_conciVueloEnVentana\(r, year, ventanaConsulta\)/);
  });

  test('del día elegido entra todo; del previo solo lo sin capturar', () => {
    expect(carga).toMatch(/if \(_conciRowMatchesWindow\(r, columns, year, ventana\)\) return true;\s*if \(!diaPrevio \|\| !_conciEsPendienteDelDiaPrevio\(r, columns, year, diaPrevio\)\) return false;/);
  });

  test('las exportaciones del día no incluyen lo arrastrado del previo', () => {
    const exportRows = extraer('function _conciGetExportRows()', 'function _conciExportCargoRow(');
    expect(exportRows).toMatch(/return rows\.filter\(r => !\(r && r\._conci_dia_previo\)\);/);
  });

  test('la fila arrastrada lleva su marca ámbar', () => {
    expect(js).toMatch(/tr\.classList\.add\('conci-row-dia-previo'\)/);
    expect(css).toMatch(/tr\.conci-row-dia-previo:not\(\.conci-row-overcapacity\)>td:first-child \{\s*border-left: 4px solid #f59f00 !important;/);
  });
});
