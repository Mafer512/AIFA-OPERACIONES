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
  calculationSource + '; return { _conciHrsCumplidas, _conciPuntualidad, _conciDemoraMinutos, _conciDemoraHorasMinutos, _conciRenderDemoraMinutosCell, _conciRenderHrsCumplidasCell, _conciRenderPuntualidadCell };'
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
  '_conciRenderHrsCumplidasCell', '_conciRenderPuntualidadCell', '_conciDemoraMinutos', '_conciRenderDemoraMinutosCell',
  '_conciEditFallbackYear',
  refreshSource + '; return _conciRefreshCalculatedCellsForRow;'
)(
  calculationApi._conciHrsCumplidas,
  calculationApi._conciPuntualidad,
  calculationApi._conciRenderHrsCumplidasCell,
  calculationApi._conciRenderPuntualidadCell,
  calculationApi._conciDemoraMinutos,
  calculationApi._conciRenderDemoraMinutosCell,
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
    'KG DE CARGA TOTAL',
    'DEMORA +- 15 MIN.',
  ])('reconoce %s como columna calculada', (column) => {
    expect(isCalculatedColumn(column)).toBe(true);
  });

  test.each([
    'TOTAL EXENTOS',
    'PAX QUE PAGAN TUA',
    'KG DE CARGA TOTAL',
    'DEMORA +- 15 MIN.',
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

  test('calcula demora con prioridad de SLOT COORDINADO y colorea por tolerancia', () => {
    expect(calculationApi._conciDemoraMinutos(
      '12/08/2026 10:00', '12/08/2026 10:20', '12/08/2026 10:40', 2026
    )).toBe(20);
    expect(calculationApi._conciDemoraMinutos(
      '12/08/2026 10:00', '', '12/08/2026 09:50', 2026
    )).toBe(-10);

    const red = document.createElement('td');
    calculationApi._conciRenderDemoraMinutosCell(red, 20);
    expect(red.textContent).toBe('+20');
    expect(red.style.color).toBe('rgb(198, 40, 40)');
    expect(red.title).toContain('+20 min');

    const green = document.createElement('td');
    calculationApi._conciRenderDemoraMinutosCell(green, -15);
    expect(green.textContent).toBe('-15');
    expect(green.style.color).toBe('rgb(46, 125, 50)');
  });

  test('simplifica los minutos del mensaje emergente a horas y minutos', () => {
    expect(calculationApi._conciDemoraHorasMinutos(1445)).toBe('+24 hr 5 min');
    expect(calculationApi._conciDemoraHorasMinutos(-125)).toBe('-2 hr 5 min');
    expect(calculationApi._conciDemoraHorasMinutos(60)).toBe('+1 hr');
    expect(calculationApi._conciDemoraHorasMinutos(0)).toBe('0 min');

    const cell = document.createElement('td');
    calculationApi._conciRenderDemoraMinutosCell(cell, 1445);
    expect(cell.title).toContain('1445 minuto(s) = +24 hr 5 min');
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

  test('borra KG DE CARGA TOTAL al vaciar el ultimo componente capturado', () => {
    const row = document.createElement('tr');
    document.body.appendChild(row);
    const nationalCell = addCell(row, 'KGS. DE CARGA NACIONAL', '4');
    addCell(row, 'KGS. DE CARGA INTERNACIONAL', '');
    const totalCell = addCell(row, 'KG DE CARGA TOTAL', '4');
    totalCell.dataset.origRaw = '4';

    refreshRow(row, { [nationalCell.dataset.col]: '' });

    expect(totalCell.textContent).toBe('');
    expect(totalCell.dataset.pendingRaw).toBe('');
    expect(totalCell.dataset.dirty).toBe('1');
  });

  test('conserva el total historico al renderizar una fila sin desglose', () => {
    const row = document.createElement('tr');
    document.body.appendChild(row);
    addCell(row, 'KGS. DE CARGA NACIONAL', '');
    addCell(row, 'KGS. DE CARGA INTERNACIONAL', '');
    const totalCell = addCell(row, 'KG DE CARGA TOTAL', '4');

    refreshRow(row);

    expect(totalCell.textContent).toBe('4');
  });
});
