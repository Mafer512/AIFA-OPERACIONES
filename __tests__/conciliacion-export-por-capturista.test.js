/**
 * Conciliación › "Exportar por capturista" como menú Pasajeros / Carga.
 *
 * Igual que "Exportar Excel", el botón abre un menú. Cada opción descarga un
 * libro con una hoja por capturista, y cada hoja es la de Exportar Excel ›
 * Pasajeros o Carga (mismo formato) con solo lo que capturó esa persona.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const js = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

function extraer(inicio, fin) {
  const a = js.indexOf(inicio);
  const b = js.indexOf(fin, a + inicio.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return js.slice(a, b);
}

describe('Exportar por capturista', () => {
  test('el botón abre un menú con Pasajeros y Carga', () => {
    const a = html.indexOf('id="btn-conci-export-por-capturista"');
    const menu = html.slice(html.lastIndexOf('<div class="dropdown">', a), html.indexOf('</ul>', a));
    expect(menu).toMatch(/data-bs-toggle="dropdown"/);
    expect(menu).toMatch(/aria-labelledby="btn-conci-export-por-capturista"/);
    expect(menu).toMatch(/conciExportPorCapturista\('pax'\)[^<]*<i class="fas fa-users[^"]*"><\/i>Pasajeros/);
    expect(menu).toMatch(/conciExportPorCapturista\('carga'\)[^<]*<i class="fas fa-box-open[^"]*"><\/i>Carga/);
    expect(menu).not.toMatch(/'total'/);
  });

  test('cada hoja usa el formato de Exportar Excel y lleva el nombre del capturista', async () => {
    const llamadas = [];
    const guardados = [];
    const filas = [
      { 'CAPTURÓ': 'Laura Macotela M', tipo: 'pax' },
      { 'CAPTURÓ': 'Carlos Barrales', tipo: 'carga' },
      { 'CAPTURÓ': 'Carlos Barrales', tipo: 'pax' },
      { 'CAPTURÓ': '', tipo: 'pax' },
    ];
    const ctx = {
      _conciGetExportRows: () => filas,
      _conciManifestosSummaryColumns: ['AEROLINEA', 'CAPTURÓ'],
      _conciExportGetField: (r, keys) => r[keys[0]],
      // Simula _conciExportToExcel: agrega hoja solo si hay filas del tipo.
      _conciExportToExcel: async (kind, wb, opts) => {
        llamadas.push({ kind, wb, sheetName: opts.sheetName, n: opts.rows.length });
        return opts.rows.some(r => r.tipo === kind);
      },
      ExcelJS: { Workbook: function () { this.xlsx = { writeBuffer: async () => 'buf' }; } },
      saveAs: (blob, nombre) => guardados.push(nombre),
      Blob: function () {},
      alert: (m) => { throw new Error(m); },
    };
    vm.createContext(ctx);
    vm.runInContext(extraer('async function _conciExportPorCapturistaFormato', 'async function _conciExportPorCapturista('), ctx);

    await ctx._conciExportPorCapturistaFormato('pax');
    expect(llamadas.map(l => l.sheetName)).toEqual(['Carlos Barrales', 'Laura Macotela M', 'SIN CAPTURISTA IDENTIFICADO']);
    expect(llamadas.every(l => l.kind === 'pax' && l.wb === llamadas[0].wb)).toBe(true);
    expect(llamadas[0].n).toBe(2);
    expect(guardados[0]).toMatch(/^Conciliacion_Por_Capturista_Pasajeros_\d{4}-\d{2}-\d{2}\.xlsx$/);

    llamadas.length = 0;
    await ctx._conciExportPorCapturistaFormato('carga');
    expect(llamadas.map(l => l.kind)).toEqual(['carga', 'carga', 'carga']);
    expect(guardados[1]).toMatch(/^Conciliacion_Por_Capturista_Carga_/);
  });

  test('la hoja por capturista sale de la misma ruta que Exportar Excel', () => {
    const exportar = extraer('async function _conciExportToExcel(kind, targetWb, opts = {})', 'window.conciExportExcel = _conciExportToExcel;');
    expect(exportar).toMatch(/\(targetWb && Array\.isArray\(opts\.rows\)\) \? opts\.rows : _conciGetExportRows\(\)/);
    expect(exportar).toMatch(/wb\.addWorksheet\(\(targetWb && opts\.sheetName\) \|\| sheetLabel,/);
    // Con targetWb solo entra lo ya recibido (capturado).
    expect(exportar).toMatch(/\.filter\(r => !targetWb \|\| _conciRecibido\(r\)\)/);
    // Sin tipo sigue el formato anterior (botón de la ventana "Manifiestos capturados").
    const principal = extraer('async function _conciExportPorCapturista(kind)', 'window.conciExportPorCapturista');
    expect(principal).toMatch(/if \(kind === 'pax' \|\| kind === 'carga'\) return _conciExportPorCapturistaFormato\(kind\);/);
  });
});
