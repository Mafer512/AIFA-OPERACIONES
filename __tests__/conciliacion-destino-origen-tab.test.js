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

describe('atravesar DESTINO / ORIGEN no marca la celda como capturada', () => {
  // La celda muestra la ciudad ("Torreon") y guarda la ruta ("TRC-NLU-TRC").
  // Al cerrarse, el editor devuelve la ruta; compararla contra lo que se veía
  // daba por capturada una celda que nadie tocó, y eso firmaba la fila en
  // CAPTURÓ con el nombre de quien sólo pasó por ahí.
  const trozo = (nombre) => {
    const inicio = source.indexOf('function ' + nombre);
    if (inicio === -1) throw new Error('No se encontró ' + nombre);
    return source.slice(inicio, source.indexOf('\nfunction ', inicio + 10));
  };

  const construirCommit = () => {
    const nada = () => {};
    return new Function(
      '_conciNormalizeEditableCellText', '_conciIsRoutingColumn', '_conciBorradorGuardarCelda',
      '_conciBorradorQuitarCelda', '_conciNormalizedColumnName', '_conciIsOperationTypeColumn',
      '_conciRenderOperationTypeCell', '_conciResolveAirlineMeta', '_conciApplyAirlineCellPreview',
      '_conciRecordUndo', '_conciMarkCellChanged', '_conciChangeCleanup',
      '_conciRefreshMatriculaValidationForRow', '_conciRefreshCalculatedCellsForRow',
      '_conciAutoSaveRow', '_conciBroadcastFoco', '_conciGetNextEditableCell',
      '_conciAsegurarCeldaVisible', '_conciActivateCellEditor', '_conciGetPrevEditableCell',
      '_conciFocusFilterOrAbove', '_conciFocusBelow', '_conciFirstEditableCellInRow',
      '_conciMaybeApplyDeferredRemoteRefresh', '_conciEditMode',
      trozo('_conciCeldaValorCrudo') + '\n' + trozo('_conciCommitCellRaw') + '\nreturn _conciCommitCellRaw;'
    )(
      normalize,
      col => String(col || '').toUpperCase().includes('DESTINO'),
      nada, nada,
      col => String(col || '').toUpperCase().trim(),
      () => false, nada, () => null, nada, nada, nada, nada, nada, nada, nada, nada,
      () => null, nada, nada, () => null, nada, nada, () => null, nada, true
    );
  };

  const celdaRouting = () => {
    document.body.innerHTML = '<table><tbody><tr><td data-col="DESTINO / ORIGEN"></td></tr></tbody></table>';
    const td = document.querySelector('td');
    td.dataset.raw = 'Torreon';           // lo que se ve
    td.dataset.routeRaw = 'TRC-NLU-TRC';  // lo que se guarda
    td.textContent = 'Torreon';
    return td;
  };

  test('cerrar el editor con el mismo valor deja la celda limpia', () => {
    const commit = construirCommit();
    const td = celdaRouting();

    commit(td, 'TRC-NLU-TRC', false, 'Torreon');

    expect(td.dataset.dirty).toBeUndefined();
    expect(td.closest('tr').dataset.dirty).toBeUndefined();
  });

  test('elegir otro aeropuerto sí la marca como capturada', () => {
    const commit = construirCommit();
    const td = celdaRouting();

    commit(td, 'Zaragoza', false, 'Zaragoza');

    expect(td.dataset.dirty).toBe('1');
  });
});
