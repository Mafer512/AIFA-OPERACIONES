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
   return {
     _conciNormalizeTimeInput, _conciIsValidCalendarDate,
     _conciIsValidIsoDateInput,
     _conciFormatDateMask, _conciMaskedDateToIso,
     _conciIsoToMaskedDate, _conciExpandDateMaskYear,
   };`
)(value => String(value).padStart(2, '0'));

const maskSnippet = sourceBetween(
  'function _conciAttachDateMask',
  '// ── Filtro desplegable estilo Excel'
);

// Detectores que deciden que columnas abren el editor de fecha.
const colTypes = new Function(
  `${sourceBetween('function _conciColIsDate', 'function _conciNormalizeTimeInput')}
   return { _conciColIsDate, _conciColIsDateTime };`
)();

const attachDateMask = new Function(
  '_conciFormatDateMask', '_conciExpandDateMaskYear', '_conciIsoToMaskedDate',
  `${maskSnippet}; return _conciAttachDateMask;`
)(
  validators._conciFormatDateMask,
  validators._conciExpandDateMaskYear,
  validators._conciIsoToMaskedDate
);

const editorSnippet = sourceBetween(
  'function _conciActivateDateTimeEditor',
  'function _conciSetTableEditableState'
);

function loadDateTimeEditor(commitCell) {
  const factory = new Function(
    'window', 'document', '_conciIsValidCalendarDate', '_conciIsValidIsoDateInput',
    '_conciNormalizeTimeInput', '_conciNormalizeEditableCellText',
    '_conciMaskedDateToIso', '_conciIsoToMaskedDate', '_conciAttachDateMask',
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
    validators._conciMaskedDateToIso,
    validators._conciIsoToMaskedDate,
    attachDateMask,
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

  test.each([
    ['1', '1'],
    ['12', '12'],
    ['1203', '12/03'],
    ['12032', '12/03/2'],
    ['120326', '12/03/2026'], // el siglo se completa en cuanto hay 2 digitos
    ['1203199', '12/03/199'], // tercer digito: el anio se toma tal cual
    ['12032026', '12/03/2026'],
    ['120320261', '12/03/2026'],
  ])('da formato dd/mm/aaaa a los digitos %s', (typed, expected) => {
    expect(validators._conciFormatDateMask(typed)).toBe(expected);
  });

  test.each([
    ['12/03/26', '2026-03-12'],
    ['120326', '2026-03-12'],
    ['12/03/2026', '2026-03-12'],
    ['12/03/1998', '1998-03-12'],
    ['29/02/24', '2024-02-29'],
  ])('convierte la mascara %s a ISO', (masked, expected) => {
    expect(validators._conciMaskedDateToIso(masked)).toBe(expected);
  });

  test.each(['', '12', '12/03', '12/03/2', '31/02/26', '12/13/26'])
    ('no convierte a ISO la fecha invalida %s', (masked) => {
      expect(validators._conciMaskedDateToIso(masked)).toBe('');
    });

  test('completa el anio al confirmar el campo', () => {
    expect(validators._conciExpandDateMaskYear('12/03/26')).toBe('12/03/2026');
    expect(validators._conciExpandDateMaskYear('12/03/1998')).toBe('12/03/1998');
    // Lo incompleto se deja tal cual para que el usuario lo pueda corregir.
    expect(validators._conciExpandDateMaskYear('12/03')).toBe('12/03');
  });

  // Teclea digito por digito como lo haria el capturista.
  function typeDigits(input, keys) {
    const seen = [];
    for (const key of keys) {
      input.dispatchEvent(new window.KeyboardEvent('keydown', {
        key, bubbles: true, cancelable: true,
      }));
      seen.push(input.value);
    }
    return seen;
  }

  test('la mascara muestra el anio completo al teclear el 6o digito', () => {
    document.body.innerHTML = '<input id=f value="2026-08-06">';
    const input = document.getElementById('f');
    attachDateMask(input);

    expect(input.type).toBe('text');
    expect(input.value).toBe('06/08/2026'); // el valor ISO inicial se muestra con mascara

    input.select();
    expect(typeDigits(input, '101026')).toEqual([
      '1', '10', '10/1', '10/10', '10/10/2', '10/10/2026',
    ]);
  });

  test('la mascara deja escribir un anio de otro siglo', () => {
    document.body.innerHTML = '<input id=f>';
    const input = document.getElementById('f');
    attachDateMask(input);

    const seen = typeDigits(input, '12031998');
    expect(seen[5]).toBe('12/03/2019'); // completado provisional con 2 digitos
    expect(input.value).toBe('12/03/1998'); // al seguir tecleando manda lo escrito
  });

  test('Backspace borra digito por digito', () => {
    document.body.innerHTML = '<input id=f>';
    const input = document.getElementById('f');
    attachDateMask(input);

    typeDigits(input, '101026');
    expect(input.value).toBe('10/10/2026');
    typeDigits(input, ['Backspace']);
    expect(input.value).toBe('10/10/2');
  });

  test('CIERRE SUBSECRETARIA se captura con el editor de fecha', () => {
    expect(colTypes._conciColIsDate('CIERRE SUBSECRETARIA')).toBe(true);
    expect(colTypes._conciColIsDate('FECHA')).toBe(true);
  });

  test('teclear 101026 en CIERRE SUBSECRETARIA captura 10/10/2026', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    document.body.innerHTML =
      '<table><tbody><tr><td data-col="CIERRE SUBSECRETARIA"></td></tr></tbody></table>';
    const td = document.querySelector('td');
    activateEditor(td, { withTime: false, parts: null, currentRaw: '' });

    const dateInput = td.querySelector('.conci-dt-date');
    typeDigits(dateInput, '101026'); // tecleo continuo, sin escribir el siglo
    expect(dateInput.value).toBe('10/10/2026');

    expect(td._conciCloseEditor(true, false)).toBe(true);
    expect(commitCell).toHaveBeenCalledWith(td, '10/10/2026', false, '10/10/2026');
  });

  test('teclear 120326 en la celda captura 12/03/2026', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('');
    activateEditor(td, { withTime: false, parts: null, currentRaw: '' });

    const dateInput = td.querySelector('.conci-dt-date');
    typeDigits(dateInput, '120326');
    expect(dateInput.value).toBe('12/03/2026');

    expect(td._conciCloseEditor(true, false)).toBe(true);
    expect(commitCell).toHaveBeenCalledWith(td, '12/03/2026', false, '12/03/2026');
  });

  test('sigue aceptando el anio completo de cuatro digitos', () => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('');
    activateEditor(td, { withTime: false, parts: null, currentRaw: '' });

    const dateInput = td.querySelector('.conci-dt-date');
    typeDigits(dateInput, '12031998');
    expect(dateInput.value).toBe('12/03/1998');

    expect(td._conciCloseEditor(true, false)).toBe(true);
    expect(commitCell).toHaveBeenCalledWith(td, '12/03/1998', false, '12/03/1998');
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

    // Campo de texto con mascara dd/mm/aaaa, no <input type=date> nativo.
    expect(td.querySelector('.conci-dt-date').type).toBe('text');
    expect(td.querySelector('.conci-dt-date').value).toBe('30/07/2026');

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

  test.each([
    ['1203', '12/03'],
    ['12032', '12/03/2'],
    ['310226', '31/02/2026'], // 31 de febrero no existe
  ])('rechaza la fecha incompleta o invalida %s', (typed, formatted) => {
    const commitCell = jest.fn();
    const activateEditor = loadDateTimeEditor(commitCell);
    const td = createCell('');
    activateEditor(td, { withTime: false, parts: null, currentRaw: '' });

    const dateInput = td.querySelector('.conci-dt-date');
    typeDigits(dateInput, typed);
    expect(dateInput.value).toBe(formatted);

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
