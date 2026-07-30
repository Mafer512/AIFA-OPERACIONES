/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('No se encontro el bloque solicitado.');
  return source.slice(start, end);
}

const calculationSource = sourceBetween(
  'function _conciResolveYear',
  'function _conciHrMaximaEntrega'
);
const calculationApi = new Function(
  'document',
  calculationSource + '; return { _conciHrsCumplidas, _conciPuntualidad, _conciRenderHrsCumplidasCell, _conciRenderPuntualidadCell };'
)(document);

const refreshSource = sourceBetween(
  'function _conciNormalizedColumnName',
  'function _conciIsManifestTypeColumn'
);
const isCalculatedColumn = new Function(
  refreshSource + '; return _conciIsCalculatedColumn;'
)();
const shouldPersistCalculatedColumn = new Function(
  refreshSource + '; return _conciShouldPersistCalculatedColumn;'
)();
const refreshRow = new Function(
  '_conciHrsCumplidas', '_conciPuntualidad',
  '_conciRenderHrsCumplidasCell', '_conciRenderPuntualidadCell',
  '_conciEditFallbackYear',
  refreshSource + '; return _conciRefreshCalculatedCellsForRow;'
)(
  calculationApi._conciHrsCumplidas,
  calculationApi._conciPuntualidad,
  calculationApi._conciRenderHrsCumplidasCell,
  calculationApi._conciRenderPuntualidadCell,
  2026
);

function addCell(row, column, value = '') {
  const td = document.createElement('td');
  td.dataset.col = column;
  td.dataset.raw = value;
  td.dataset.pendingRaw = value;
  td.textContent = value;
  row.appendChild(td);
  return td;
}

describe('calculos en tiempo real de Conciliacion > Manifiestos', () => {
  test.each([
    'HRS. CUMPLIDAS',
    'HRS CUMPLIDAS',
    'PUNTUALIDAD / CANCELACION',
    'PUNTUALIDAD/CANCELACION',
    'HR. MAXIMA DE ENTREGA',
    'TOTAL EXENTOS',
    'PAX QUE PAGAN TUA',
  ])('reconoce %s como columna calculada', (column) => {
    expect(isCalculatedColumn(column)).toBe(true);
  });

  test.each([
    'TOTAL EXENTOS',
    'PAX QUE PAGAN TUA',
  ])('persiste %s aunque sea una columna calculada', (column) => {
    expect(shouldPersistCalculatedColumn(column)).toBe(true);
  });

  test('actualiza HRS. CUMPLIDAS y PUNTUALIDAD con formato homologado', () => {
    const row = document.createElement('tr');
    document.body.appendChild(row);
    addCell(row, 'SLOT ASIGNADO', '29/07/2026 00:45');
    addCell(row, 'HR. DE OPERACION', '29/07/2026 00:43');
    addCell(row, 'HR. DE RECEPCION', '30/07/2026 06:43');
    const hoursCell = addCell(row, 'HRS. CUMPLIDAS', '-');
    const statusCell = addCell(row, 'PUNTUALIDAD / CANCELACION', 'ANTES');

    refreshRow(row);

    expect(hoursCell.textContent).toBe('30.00');
    expect(statusCell.textContent).toContain('ANTES');
    expect(statusCell.querySelector('span')).not.toBeNull();
    expect(statusCell.querySelector('span').style.color).toBe('rgb(46, 125, 50)');
  });

  test('recalcula inmediatamente usando el valor que aun se esta capturando', () => {
    const row = document.createElement('tr');
    document.body.appendChild(row);
    addCell(row, 'SLOT ASIGNADO', '29/07/2026 00:45');
    const operationCell = addCell(row, 'HR. DE OPERACION', '29/07/2026 00:43');
    addCell(row, 'HR. DE RECEPCION', '30/07/2026 06:43');
    const hoursCell = addCell(row, 'HRS. CUMPLIDAS', '-');
    const statusCell = addCell(row, 'PUNTUALIDAD / CANCELACION', '-');

    refreshRow(row, { [operationCell.dataset.col]: '29/07/2026 01:10' });

    expect(hoursCell.textContent).toBe('29.55');
    expect(hoursCell.style.color).toBe('rgb(46, 125, 50)');
    expect(statusCell.textContent).toContain('DEMORA');
    expect(statusCell.querySelector('span').style.color).toBe('rgb(198, 40, 40)');
  });

  test('calcula TOTAL EXENTOS y PAX QUE PAGAN TUA mientras se capturan datos', () => {
    const row = document.createElement('tr');
    document.body.appendChild(row);
    addCell(row, 'TOTAL PAX', '180');
    addCell(row, 'DIPLOMATICOS', '1');
    addCell(row, 'EN COMISION', '2');
    const infantsCell = addCell(row, 'INFANTES', '3');
    addCell(row, 'TRANSITOS', '4');
    addCell(row, 'CONEXIONES', '5');
    addCell(row, 'OTROS EXENTOS', '6');
    const exemptionsCell = addCell(row, 'TOTAL EXENTOS', '0');
    const payingPaxCell = addCell(row, 'PAX QUE PAGAN TUA', '0');

    refreshRow(row);

    expect(exemptionsCell.textContent).toBe('21');
    expect(payingPaxCell.textContent).toBe('159');

    refreshRow(row, { [infantsCell.dataset.col]: '10' });

    expect(exemptionsCell.textContent).toBe('28');
    expect(payingPaxCell.textContent).toBe('152');
  });
});
