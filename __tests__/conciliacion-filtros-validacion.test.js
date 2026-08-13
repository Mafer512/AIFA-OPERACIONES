/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const scriptSource = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const styleSource = fs.readFileSync(path.resolve(__dirname, '..', 'style.css'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = scriptSource.indexOf(startMarker);
  const end = scriptSource.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('No se encontro el bloque solicitado.');
  return scriptSource.slice(start, end);
}

const dateSource = sourceBetween(
  'function _conciResolveYear',
  'function _conciHrMaximaEntrega'
);
const dateApi = new Function(
  dateSource + '; return { _conciParseDateTimeParts, _conciPartsToDate };'
)();

const validationSource = sourceBetween(
  'function _conciNormalizedColumnName',
  'function _conciRefreshCalculatedCellsForRow'
);
const refreshDateOrderValidation = new Function(
  '_conciParseDateTimeParts',
  '_conciIsValidCalendarDate',
  '_conciPartsToDate',
  '_conciEditFallbackYear',
  validationSource + '; return _conciRefreshManifestDateOrderValidation;'
)(
  dateApi._conciParseDateTimeParts,
  (year, month, day) => {
    if (![year, month, day].every(Number.isInteger)) return false;
    if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  },
  dateApi._conciPartsToDate,
  2026
);

function addCell(row, column, value) {
  const td = document.createElement('td');
  td.dataset.col = column;
  td.dataset.raw = value;
  td.textContent = value;
  row.appendChild(td);
  return td;
}

function buildValidationRow(manifestType, boarding, operation) {
  const row = document.createElement('tr');
  addCell(row, 'TIPO DE MANIFIESTO', manifestType);
  const boardingCell = addCell(row, 'HR. DE EMBARQUE O DESEMBARQUE', boarding);
  const operationCell = addCell(row, 'HR. DE OPERACION', operation);
  document.body.appendChild(row);
  return { row, boardingCell, operationCell };
}

describe('validador de fechas por tipo de manifiesto', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test.each([
    ['LLEGADA', '29/07/2026 16:00', '29/07/2026 15:00', true],
    ['SALIDA', '29/07/2026 14:00', '29/07/2026 15:00', true],
    ['LLEGADA', '29/07/2026 14:00', '29/07/2026 15:00', false],
    ['SALIDA', '29/07/2026 16:00', '29/07/2026 15:00', false],
    ['LLEGADA', '29/07/2026 15:00', '29/07/2026 15:00', false],
    ['LLEGADA', '', '29/07/2026 15:00', false],
    ['LLEGADA', '35/15/2026 25:80', '29/07/2026 15:00', false],
    ['LLEGADA', '16:00', '29/07/2026 15:00', false],
  ])('%s con embarque/desembarque %s y operación %s => %s', (type, boarding, operation, expected) => {
    const { row, boardingCell, operationCell } = buildValidationRow(type, boarding, operation);
    const shouldShowError = !!(boarding && operation && !expected);

    expect(refreshDateOrderValidation(row)).toBe(expected);
    expect(row.classList.contains('conci-date-order-valid')).toBe(expected);
    expect(row.dataset.conciDateOrderValid === '1').toBe(expected);
    expect(boardingCell.classList.contains('conci-date-order-valid-cell')).toBe(expected);
    expect(operationCell.classList.contains('conci-date-order-valid-cell')).toBe(expected);
    expect(row.classList.contains('conci-date-order-error')).toBe(shouldShowError);
    expect(row.dataset.conciDateOrderError === '1').toBe(shouldShowError);
    expect(boardingCell.classList.contains('conci-date-order-error-cell')).toBe(shouldShowError);
    expect(operationCell.classList.contains('conci-date-order-error-cell')).toBe(shouldShowError);
    if (shouldShowError) {
      expect(boardingCell.dataset.conciDateOrderAlert).toContain('Revisa las fechas/horas');
      expect(operationCell.dataset.conciDateOrderAlert).toContain('Revisa las fechas/horas');
      expect(boardingCell.getAttribute('aria-invalid')).toBe('true');
      expect(operationCell.getAttribute('aria-invalid')).toBe('true');
    }
  });

  test('actualiza el color usando el valor que aún se está capturando', () => {
    const { row, boardingCell, operationCell } = buildValidationRow(
      'LLEGADA',
      '29/07/2026 14:00',
      '29/07/2026 15:00'
    );

    expect(refreshDateOrderValidation(row)).toBe(false);
    expect(row.classList.contains('conci-date-order-error')).toBe(true);
    expect(refreshDateOrderValidation(row, {
      [boardingCell.dataset.col]: '29/07/2026 16:00',
    })).toBe(true);
    expect(row.classList.contains('conci-date-order-valid')).toBe(true);
    expect(row.classList.contains('conci-date-order-error')).toBe(false);
    expect(boardingCell.classList.contains('conci-date-order-valid-cell')).toBe(true);
    expect(operationCell.classList.contains('conci-date-order-valid-cell')).toBe(true);
    expect(boardingCell.classList.contains('conci-date-order-error-cell')).toBe(false);
    expect(operationCell.classList.contains('conci-date-order-error-cell')).toBe(false);
    expect(boardingCell.hasAttribute('aria-invalid')).toBe(false);
    expect(operationCell.hasAttribute('aria-invalid')).toBe(false);
  });

  test('colorea únicamente las celdas involucradas y nunca el renglón completo', () => {
    expect(styleSource).toContain('td.conci-date-order-valid-cell');
    expect(styleSource).toContain('background: #e7f1ff !important');
    expect(styleSource).toContain('td.conci-date-order-error-cell');
    expect(styleSource).not.toMatch(/tr\.conci-date-order-valid[^\{]*>\s*td\s*[,\{]/);
    expect(styleSource).not.toMatch(/tr\.conci-date-order-error[^\{]*>\s*td\s*[,\{]/);
  });
});

describe('limpieza conjunta de filtros de Manifiestos', () => {
  test('el toolbar incluye Limpiar filtros junto a la exportación', () => {
    expect(indexSource).toContain('id="btn-conci-clear-filters"');
    expect(indexSource).toContain('Limpiar filtros');
  });

  test('incluye botones para manifiestos capturados y sin capturar', () => {
    expect(indexSource).toContain('id="conci-pill-capturados"');
    expect(indexSource).toContain('id="conci-pill-sin-capturar"');
    expect(indexSource).toContain('id="conci-count-capturados"');
    expect(indexSource).toContain('id="conci-count-sin-capturar"');
  });

  test('borra filtros de texto, Excel y pills, y vuelve a mostrar las filas', () => {
    document.body.innerHTML = `
      <span id="conci-pill-llegadas"></span>
      <span id="conci-pill-salidas"></span>
      <span id="conci-pill-pax"></span>
      <span id="conci-pill-carga"></span>
      <span id="conci-count-pax-detail"></span>
      <span id="conci-count-carga-detail"></span>
      <div class="conci-excel-dropdown"></div>
      <table id="table-conci-manifiestos">
        <thead>
          <tr><th class="conci-th"><button class="conci-ef-btn" data-col="AEROLINEA"><i></i></button></th></tr>
          <tr><th><input class="conci-col-filter" value="AMX"></th></tr>
        </thead>
        <tbody>
          <tr data-row-index="0" data-row-cargo="0" data-row-dir="dep">
            <td data-col="AEROLINEA" data-raw="VB">Viva</td>
          </tr>
        </tbody>
      </table>`;

    const updateExcelIcons = jest.fn();
    const updatePillStyles = jest.fn();
    const filterSource = sourceBetween(
      'let _conciClassFilter = null',
      'function _showConciExcelFilter'
    );
    const api = new Function(
      'document',
      '_updateConciExcelFilterIcons',
      '_conciUpdatePillActiveStyles',
      '_conciNormalizedColumnName',
      '_conciNormalizeEditableCellText',
      filterSource + `
        return {
          apply: _conciApplyPillFilter,
          clear: _conciClearAllTableFilters,
          seed: function () {
            _conciClassFilter = 'carga';
            _conciDirFilter = 'arr';
            _conciCaptureFilter = 'capturados';
            _conciColFilters = { AEROLINEA: 'AMX' };
            _conciExcelFilters = { AEROLINEA: new Set(['AMX']) };
            _conciManifestosAllData = [{ AEROLINEA: 'VB' }];
          },
          state: function () {
            return {
              classFilter: _conciClassFilter,
              dirFilter: _conciDirFilter,
              captureFilter: _conciCaptureFilter,
              colFilters: _conciColFilters,
              excelFilters: _conciExcelFilters,
            };
          },
          capture: function (value) {
            _conciClassFilter = null;
            _conciDirFilter = null;
            _conciCaptureFilter = value;
          }
        };`
    )(
      document,
      updateExcelIcons,
      updatePillStyles,
      value => String(value || '').toLowerCase(),
      value => String(value || '').trim()
    );

    api.seed();
    api.apply();
    const row = document.querySelector('tr[data-row-index]');
    expect(row.style.display).toBe('none');

    api.clear();

    expect(api.state()).toEqual({
      classFilter: null,
      dirFilter: null,
      captureFilter: null,
      colFilters: {},
      excelFilters: {},
    });
    expect(document.querySelector('.conci-col-filter').value).toBe('');
    expect(document.querySelector('.conci-excel-dropdown')).toBeNull();
    expect(document.getElementById('conci-count-pax-detail').classList.contains('d-none')).toBe(true);
    expect(document.getElementById('conci-count-carga-detail').classList.contains('d-none')).toBe(true);
    expect(row.style.display).toBe('');
    expect(updateExcelIcons).toHaveBeenCalled();
    expect(updatePillStyles).toHaveBeenCalled();
  });

  test('HR. DE RECEPCION tiene prioridad sobre CIERRE SUBSECRETARIA', () => {
    document.body.innerHTML = `
      <table id="table-conci-manifiestos"><tbody>
        <tr id="solo-recepcion" data-row-index="0"><td data-col="CIERRE SUBSECRETARIA"></td><td data-col="HR. DE RECEPCIÓN" data-raw="12/08/2026 10:00"></td></tr>
        <tr id="solo-cierre" data-row-index="1"><td data-col="CIERRE SUBSECRETARIA" data-raw="12/08/2026">12/08/2026</td><td data-col="HR. DE RECEPCIÓN"></td></tr>
        <tr id="ambos" data-row-index="2"><td data-col="CIERRE SUBSECRETARIA" data-raw="12/08/2026"></td><td data-col="HR. DE RECEPCIÓN" data-raw="12/08/2026 11:00"></td></tr>
      </tbody></table>`;
    const filterSource = sourceBetween('let _conciClassFilter = null', 'function _showConciExcelFilter');
    const api = new Function('document', '_updateConciExcelFilterIcons', '_conciUpdatePillActiveStyles', '_conciNormalizedColumnName', '_conciNormalizeEditableCellText', filterSource + `
      return { apply: _conciApplyPillFilter, set: value => { _conciCaptureFilter = value; } };
    `)(document, () => {}, () => {}, value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9#]+/g, ' ').trim().toLowerCase(), value => String(value || '').trim());

    api.set('capturados'); api.apply();
    expect(document.getElementById('solo-recepcion').style.display).toBe('');
    expect(document.getElementById('solo-cierre').style.display).toBe('none');
    expect(document.getElementById('ambos').style.display).toBe('');
    api.set('sin-capturar'); api.apply();
    expect(document.getElementById('solo-recepcion').style.display).toBe('none');
    expect(document.getElementById('solo-cierre').style.display).toBe('');
  });
});
