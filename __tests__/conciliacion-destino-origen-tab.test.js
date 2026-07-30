/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const start = source.indexOf('function _conciActivateRoutingEditor');
const end = source.indexOf('function _conciIsOperationTypeColumn', start);

if (start === -1 || end === -1) {
  throw new Error('No se encontro el editor de DESTINO / ORIGEN.');
}

const normalize = value => String(value || '').trim();
const airports = [
  { ciudad: 'Torreon', iata: 'TRC' },
  { ciudad: 'Zaragoza', iata: 'ZAZ' },
];
const commitCell = jest.fn((td, raw, move, displayText) => {
  td.dataset.pendingRaw = raw;
  td.dataset.routeRaw = raw;
  td.dataset.raw = raw;
  td.textContent = displayText;
});

const activateRoutingEditor = new Function(
  '_conciIsOperationTypeColumn',
  '_conciNormalizeOperationType',
  '_conciAirportOptionsForOperation',
  '_conciNormalizeEditableCellText',
  '_conciAirportMatchesValue',
  '_conciAirportStoredValue',
  '_conciAirportOptionLabel',
  '_conciCommitCellRaw',
  source.slice(start, end) + '; return _conciActivateRoutingEditor;'
)(
  column => column === 'TIPO DE OPERACION',
  value => normalize(value),
  () => airports,
  normalize,
  (airport, value) => {
    const selected = normalize(value).toUpperCase();
    return airport.ciudad.toUpperCase() === selected || airport.iata === selected;
  },
  airport => airport.ciudad,
  airport => airport.ciudad,
  commitCell
);

describe('DESTINO / ORIGEN al navegar con Tab', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    commitCell.mockClear();
  });

  test('mantiene la ciudad visible sin reemplazarla por la ruta completa', () => {
    const row = document.createElement('tr');
    const operationCell = document.createElement('td');
    operationCell.dataset.col = 'TIPO DE OPERACION';
    operationCell.dataset.raw = 'Nacional';
    operationCell.textContent = 'Nacional';

    const routingCell = document.createElement('td');
    routingCell.dataset.col = 'DESTINO / ORIGEN';
    routingCell.dataset.raw = 'Torreon';
    routingCell.dataset.routeRaw = 'TRC-NLU-TRC';
    routingCell.dataset.pendingRaw = 'TRC-NLU-TRC';
    routingCell.textContent = 'Torreon';

    row.append(operationCell, routingCell);
    document.body.appendChild(row);

    activateRoutingEditor(routingCell, 'TRC-NLU-TRC');

    const select = routingCell.querySelector('select');
    expect(select.value).toBe('Torreon');

    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(commitCell).toHaveBeenCalledWith(
      routingCell,
      'TRC-NLU-TRC',
      'next',
      'Torreon'
    );
    expect(routingCell.textContent).toBe('Torreon');
    expect(routingCell.dataset.routeRaw).toBe('TRC-NLU-TRC');
  });
});
