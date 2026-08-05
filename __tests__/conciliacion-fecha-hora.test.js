/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const scriptSource = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = scriptSource.indexOf(startMarker);
  const end = scriptSource.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`No se encontro el bloque entre ${startMarker} y ${endMarker}`);
  }
  return scriptSource.slice(start, end);
}

const validatorSnippet = sourceBetween(
  'function _conciNormalizeTimeInput',
  'function _conciGetNextEditableCell'
);

const validators = new Function(
  '_conciPad2',
  `${validatorSnippet}
   return { _conciNormalizeTimeInput, _conciIsValidCalendarDate, _conciIsValidIsoDateInput };`
)(value => String(value).padStart(2, '0'));

const editorSnippet = sourceBetween(
  'function _conciActivateDateTimeEditor',
  'function _conciSetTableEditableState'
);

function loadDateTimeEditor(commitCell) {
  const factory = new Function(
    'window', 'document', '_conciIsValidCalendarDate', '_conciIsValidIsoDateInput',
    '_conciNormalizeTimeInput', '_conciNormalizeEditableCellText',
    '_conciCommitCellRaw', '_conciUpdateSummaryLiveCell', '_conciPad2',
    '_conciRefreshCalculatedCellsForRow', '_conciRefreshManifestDateOrderValidation',
    '_CONCI_MIN_YEAR', '_CONCI_MAX_YEAR',
    editorSnippet + '; return _conciActivateDateTimeEditor;'
  );
  return factory(
    window, document,
    validators._conciIsValidCalendarDate,
    validators._conciIsValidIsoDateInput,
    validators._conciNormalizeTimeInput,
    value => String(value || '').trim(),
    commitCell, jest.fn(),
    value => String(value).padStart(2, '0'),
    jest.fn(),
    jest.fn(),
    2000,
    2100
  );
}

function createCell(raw = '') {
  document.body.innerHTML = '<table><tbody><tr><td data-col=HR></td></tr></tbody></table>';
  const td = document.querySelector('td');
  td.dataset.raw = raw;
  td.dataset.pendingRaw = raw;
  return td;
}

describe('validacion de fecha y hora en Conciliacion > Manifiestos', () => {
  test.each([
    ['23:59', '23:59'],
    ['930', '09:30'],
    ['8', '08:00'],
    ['0000', '00:00'],
  ])('normaliza una hora valida %s', (input, expected) => {
    expect(validators._conciNormalizeTimeInput(input)).toBe(expected);
  });

  test.each(['24:00', '23:60', '25:856', '25:8', '12:345', 'abc'])
    ('rechaza la hora invalida %s', (input) => {
      expect(validators._conciNormalizeTimeInput(input)).toBe('');
    });

  test.each([
    [2026, 2, 28, true],
    [2024, 2, 29, true],
    [2026, 2, 29, false],
    [2026, 15, 1, false],
    [2026, 1, 35, false],
    [193, 1, 1, false],
  ])('valida una fecha calendario %s-%s-%s', (year, month, day, expected) => {
    expect(validators._conciIsValidCalendarDate(year, month, day)).toBe(expected);
  });

  test.each([
    ['2026-07-30', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-15-35', false],
    ['0193-01-01', false],
    ['193-01-01', false],
  ])('valida la fecha ISO %s', (input, expected) => {
    expect(validators._conciIsValidIsoDateInput(input)).toBe(expected);
  });

  test('mantiene abierta la celda y no guarda una hora fuera de rango', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('30/07/2026 12:00');
    activateEditor(td, {
      withTime: true,
      parts: { year: 2026, month: 7, day: 30, hour: 12, minute: 0 },
      currentRaw: '30/07/2026 12:00',
    });

    expect(td.querySelector('.conci-dt-date').min).toBe('2000-01-01');
    expect(td.querySelector('.conci-dt-date').max).toBe('2100-12-31');

    const timeInput = td.querySelector('.conci-dt-time');
    timeInput.value = '25:85';
    timeInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(td._conciCloseEditor(true, false)).toBe(false);
    expect(commitCell).not.toHaveBeenCalled();
    expect(timeInput.classList.contains('is-invalid')).toBe(true);
    expect(timeInput.validationMessage).toContain('00:00 a 23:59');
  });

  test('confirma y normaliza una fecha y hora validas', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('30/07/2026 12:00');
    activateEditor(td, {
      withTime: true,
      parts: { year: 2026, month: 7, day: 30, hour: 12, minute: 0 },
      currentRaw: '30/07/2026 12:00',
    });

    const timeInput = td.querySelector('.conci-dt-time');
    timeInput.value = '2359';
    timeInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(td._conciCloseEditor(true, false)).toBe(true);
    expect(commitCell).toHaveBeenCalledWith(
      td, '30/07/2026 23:59', false, '30/07/2026 23:59'
    );
  });

  test('rechaza un anio menor a cuatro digitos', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('');
    activateEditor(td, { withTime: false, parts: null, currentRaw: '' });

    const dateInput = td.querySelector('.conci-dt-date');
    dateInput.value = '0193-01-01';
    dateInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(td._conciCloseEditor(true, false)).toBe(false);
    expect(commitCell).not.toHaveBeenCalled();
    expect(dateInput.classList.contains('is-invalid')).toBe(true);
  });

  test('conserva el anio visible al avanzar con Tab sin editar', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('29JUL 00:32');
    td.textContent = '29/07/2026 00:32';

    activateEditor(td, {
      withTime: true,
      parts: { year: 2026, month: 7, day: 29, hour: 0, minute: 32 },
      currentRaw: '29JUL 00:32',
    });

    expect(td._conciCloseEditor(true, 'next')).toBe(true);
    expect(commitCell).toHaveBeenCalledWith(
      td, '29JUL 00:32', 'next', '29/07/2026 00:32'
    );
  });
});
