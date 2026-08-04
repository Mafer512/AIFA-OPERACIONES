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

describe('captura de celdas en Conciliacion > Manifiestos', () => {
  test.each([
    '_conciInitLiveCollab',
    '_conciSetPresenceCell',
    '_conciBeginCellPresence',
    '_conciBroadcastCellInput',
    '_conciHandlePresenceSync',
    '_conciApplyRemotePresenceHighlights',
    '_conciCellStillClaimed',
    '_conciHandleRemoteCellInput',
    '_conciHandleRemoteTableChange',
    '_conciMaybeApplyDeferredRemoteRefresh',
  ])('%s conserva su definicion', (functionName) => {
    const declaration = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`, 'g');
    expect(source.match(declaration)).toHaveLength(1);
  });

  test('la colaboracion encuentra ids y columnas con espacios o caracteres especiales', () => {
    const finderSource = sourceBetween(
      'function _conciFindLiveCell',
      'function _conciApplyRemotePresenceHighlights'
    );
    const findLiveCell = new Function(
      finderSource + '; return _conciFindLiveCell;'
    )();
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    row.dataset.rowId = 'fila "A" [1]';
    cell.dataset.col = 'HR. DE OPERACIÓN "REAL"';
    row.appendChild(cell);
    tbody.appendChild(row);
    table.appendChild(tbody);

    expect(findLiveCell(table, 'fila "A" [1]', 'HR. DE OPERACIÓN "REAL"')).toBe(cell);
    expect(findLiveCell(table, 'fila inexistente', 'HR. DE OPERACIÓN "REAL"')).toBeNull();
    expect(source).toContain('_conciFindLiveCell(tbody, rowId, col)');
    expect(source).toContain('_conciFindLiveCell(table, payload.rowId, payload.col)');
  });

  test('las celdas AERONAVE y de texto abren su editor sin bloquear la captura', () => {
    const activationSource = sourceBetween(
      'function _conciActivateCellEditor',
      'function _conciCommitCellRaw'
    );
    const beginPresence = jest.fn();
    const activateAircraft = jest.fn();
    const broadcastCellInput = jest.fn();
    const activateCell = new Function(
      '_conciIsMatriculaStatusColumn',
      '_conciIsProtectedEditColumn',
      '_conciIsCalculatedColumn',
      '_conciNormalizeEditableCellText',
      '_conciBeginCellPresence',
      '_conciIsOperationTypeColumn',
      '_conciActivateOperationTypeEditor',
      '_conciIsManifestTypeColumn',
      '_conciActivateManifestTypeEditor',
      '_conciIsRoutingColumn',
      '_conciActivateRoutingEditor',
      '_conciIsAeronaveColumn',
      '_conciActivateAeronaveEditor',
      '_conciColIsDate',
      '_conciColIsDateTime',
      '_conciRefreshMatriculaValidationForRow',
      '_conciUpdateSummaryLiveCell',
      '_conciRefreshCalculatedCellsForRow',
      '_conciBroadcastCellInput',
      'document',
      activationSource + '; return _conciActivateCellEditor;'
    )(
      () => false,
      () => false,
      () => false,
      value => String(value || '').trim(),
      beginPresence,
      () => false,
      jest.fn(),
      () => false,
      jest.fn(),
      () => false,
      jest.fn(),
      column => column === 'AERONAVE',
      activateAircraft,
      () => false,
      () => false,
      jest.fn(),
      jest.fn(),
      jest.fn(),
      broadcastCellInput,
      document
    );

    const cell = document.createElement('td');
    cell.dataset.col = 'AERONAVE';
    cell.dataset.raw = 'A320';

    expect(() => activateCell(cell)).not.toThrow();
    expect(beginPresence).toHaveBeenCalledWith(cell);
    expect(activateAircraft).toHaveBeenCalledWith(cell, 'A320');

    const textCell = document.createElement('td');
    textCell.dataset.col = 'VUELO';
    textCell.dataset.raw = 'AM123';

    expect(() => activateCell(textCell)).not.toThrow();
    const input = textCell.querySelector('.conci-cell-input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('AM123');

    input.value = 'AM456';
    expect(() => input.dispatchEvent(new Event('input', { bubbles: true }))).not.toThrow();
    expect(broadcastCellInput).toHaveBeenCalledWith(textCell, 'AM456');
  });
});
