/**
 * @jest-environment jsdom
 *
 * Origen de datos de "Exportar Excel" en Conciliación > Manifiestos.
 *
 * La exportación leía _conciRenderCache. Esa caché se limpia en cada guardado
 * exitoso (para que la vista nunca muestre datos viejos) y nada la vuelve a
 * llenar hasta recargar la tabla, así que exportar justo después de capturar
 * respondía "No hay datos cargados para exportar" — justo al terminar de
 * capturar, que es cuando se arma el reporte del día. Y mientras la caché sí
 * existía, era una foto anterior: podía exportar sin lo recién capturado.
 *
 * Ahora las filas salen de lo que está vivo en la tabla.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`No se encontró ${name} en script.js`);
  const end = source.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`No se encontró el cierre de ${name}`);
  return source.slice(start, end + 2);
}

// _conciIsRoutingColumn vive lejos y solo necesitamos su criterio.
const api = new Function(`
  let _conciManifestosAllData = [];
  let _conciSummaryLiveOverrides = new Map();
  function _conciIsRoutingColumn(col) {
    return /destino\\s*\\/\\s*origen|routing/i.test(String(col || ''));
  }
  ${extractFunction('_conciExportCellRaw')}
  ${extractFunction('_conciGetExportRows')}
  return {
    _conciGetExportRows,
    setData: (rows) => { _conciManifestosAllData = rows; },
    setOverrides: (map) => { _conciSummaryLiveOverrides = map; },
  };
`)();

const COLUMNS = ['FECHA', 'AEROLINEA', '# DE VUELO', 'DESTINO / ORIGEN', 'TOTAL PAX', 'OBSERVACIONES'];

/** Dibuja una tabla equivalente a la que renderiza el módulo. */
function renderTable(rows) {
  document.body.innerHTML = `
    <table id="table-conci-manifiestos"><tbody></tbody></table>
  `;
  const tbody = document.querySelector('#table-conci-manifiestos tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = row._index;
    if (row._new) { tr.dataset.conciNew = '1'; tr.dataset.rowFuente = 'Solo Manifiestos'; }
    if (row._persisted) { tr.dataset.conciSummaryPersisted = '1'; tr.dataset.rowFuente = 'Solo Manifiestos'; }
    COLUMNS.forEach(col => {
      const td = document.createElement('td');
      td.dataset.col = col;
      const cell = row.cells[col] || {};
      if (cell.raw !== undefined) td.dataset.raw = cell.raw;
      if (cell.routeRaw !== undefined) td.dataset.routeRaw = cell.routeRaw;
      if (cell.pendingRaw !== undefined) td.dataset.pendingRaw = cell.pendingRaw;
      if (cell.editing !== undefined) {
        const input = document.createElement('input');
        input.value = cell.editing;
        td.appendChild(input);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  return tbody;
}

beforeEach(() => {
  api.setOverrides(new Map());
  document.body.innerHTML = '';
});

describe('filas para exportar', () => {
  test('toma lo capturado en pantalla aunque la base todavía no lo confirme', () => {
    api.setData([{ 'AEROLINEA': 'VIVA AEROBUS', 'TOTAL PAX': '150', 'OBSERVACIONES': '' }]);
    renderTable([{
      _index: 0,
      cells: {
        'AEROLINEA': { raw: 'VIVA AEROBUS' },
        'TOTAL PAX': { raw: '150', pendingRaw: '178' },
        'OBSERVACIONES': { raw: '', pendingRaw: 'demora por clima' },
      },
    }]);

    const rows = api._conciGetExportRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]['TOTAL PAX']).toBe('178');
    expect(rows[0]['OBSERVACIONES']).toBe('demora por clima');
  });

  test('una celda con el editor abierto exporta lo que se está escribiendo', () => {
    api.setData([{ 'TOTAL PAX': '150' }]);
    renderTable([{ _index: 0, cells: { 'TOTAL PAX': { raw: '150', editing: '183' } } }]);

    expect(api._conciGetExportRows()[0]['TOTAL PAX']).toBe('183');
  });

  test('el routing exporta el código, no el nombre de ciudad que se muestra', () => {
    api.setData([{ 'DESTINO / ORIGEN': 'MEX-UIO' }]);
    renderTable([{
      _index: 0,
      cells: { 'DESTINO / ORIGEN': { raw: 'QUITO', routeRaw: 'MEX-UIO' } },
    }]);

    expect(api._conciGetExportRows()[0]['DESTINO / ORIGEN']).toBe('MEX-UIO');
  });

  test('incluye las filas creadas en esta sesión', () => {
    api.setData([{ 'AEROLINEA': 'VIVA AEROBUS' }]);
    renderTable([
      { _index: 0, cells: { 'AEROLINEA': { raw: 'VIVA AEROBUS' } } },
      { _index: 'new', _new: true, cells: { 'AEROLINEA': { raw: 'ESTAFETA' }, '# DE VUELO': { raw: 'E7 710' } } },
    ]);

    const rows = api._conciGetExportRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]['AEROLINEA']).toBe('ESTAFETA');
    expect(rows[1]['# DE VUELO']).toBe('E7 710');
    expect(rows[1]._fuente).toBe('Solo Manifiestos');
  });

  test('una fila nueva ya guardada aparece una sola vez', () => {
    api.setData([{ 'AEROLINEA': 'VIVA AEROBUS' }]);
    renderTable([
      { _index: 0, cells: { 'AEROLINEA': { raw: 'VIVA AEROBUS' } } },
      { _index: 'new', _persisted: true, cells: { 'AEROLINEA': { raw: 'CARGOLUX' } } },
    ]);

    const rows = api._conciGetExportRows();
    expect(rows).toHaveLength(2);
    expect(rows.filter(r => r['AEROLINEA'] === 'CARGOLUX')).toHaveLength(1);
  });

  test('conserva las columnas que no se dibujan en la tabla', () => {
    // id y _fuente no son celdas visibles pero el resto del código las usa.
    api.setData([{ id: 42, _fuente: 'Manifiestos + Vuelos', 'TOTAL PAX': '150' }]);
    renderTable([{ _index: 0, cells: { 'TOTAL PAX': { raw: '150', pendingRaw: '160' } } }]);

    const row = api._conciGetExportRows()[0];
    expect(row.id).toBe(42);
    expect(row._fuente).toBe('Manifiestos + Vuelos');
    expect(row['TOTAL PAX']).toBe('160');
  });

  test('sin tabla dibujada devuelve los datos cargados', () => {
    api.setData([{ 'AEROLINEA': 'VIVA AEROBUS' }]);
    expect(api._conciGetExportRows()).toEqual([{ 'AEROLINEA': 'VIVA AEROBUS' }]);
  });

  test('sin datos ni tabla no inventa filas', () => {
    api.setData([]);
    expect(api._conciGetExportRows()).toEqual([]);
  });
});

describe('regresión', () => {
  // Sin comentarios: los comentarios citan a propósito el texto anterior para
  // explicar qué se cambió, y eso no debe hacer fallar la comprobación.
  const exportFn = source
    .slice(
      source.indexOf('async function _conciExportToExcel'),
      source.indexOf('\n}\n', source.indexOf('async function _conciExportToExcel'))
    )
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  test('la exportación ya no depende de la caché de render', () => {
    expect(exportFn).not.toContain('_conciRenderCache');
    expect(exportFn).toContain('_conciGetExportRows()');
  });

  test('el aviso ya no promete respetar los filtros de la tabla', () => {
    expect(exportFn).not.toContain('en la vista actual');
    expect(exportFn).toContain('en el día cargado');
  });
});

describe('alcance: se exporta el día completo', () => {
  // Decisión del área (12 ago 2026): exportar TODO el día, no lo filtrado.
  // Estas pruebas la fijan para que no cambie por accidente.
  const exportFn = source.slice(
    source.indexOf('async function _conciExportToExcel'),
    source.indexOf('\n}\n', source.indexOf('async function _conciExportToExcel'))
  );

  test('no consulta los filtros de columna', () => {
    expect(exportFn).not.toMatch(/_conciColFilters|_conciExcelFilters/);
  });

  test('no consulta los filtros de píldora (llegadas, salidas, sobrecupo)', () => {
    expect(exportFn).not.toMatch(/_conciClassFilter|_conciDirFilter|_conciOvercapFilter/);
  });

  test('no descarta las filas ocultas por un filtro', () => {
    // Las filas filtradas siguen en el DOM con display:none; se incluyen.
    expect(exportFn).not.toMatch(/style\.display|offsetParent/);
  });

  test('lo único que separa las dos hojas es pasajeros contra carga', () => {
    expect(exportFn).toContain('_conciRowIsCargo');
  });

  test('las filas ocultas por un filtro sí llegan a la exportación', () => {
    api.setData([{ 'AEROLINEA': 'VIVA AEROBUS' }, { 'AEROLINEA': 'CARGOLUX' }]);
    const tbody = renderTable([
      { _index: 0, cells: { 'AEROLINEA': { raw: 'VIVA AEROBUS' } } },
      { _index: 1, cells: { 'AEROLINEA': { raw: 'CARGOLUX' } } },
    ]);
    // El filtro esconde la segunda fila, como hace _conciApplyPillFilter.
    tbody.querySelectorAll('tr')[1].style.display = 'none';

    const rows = api._conciGetExportRows();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r['AEROLINEA'])).toEqual(['VIVA AEROBUS', 'CARGOLUX']);
  });
});
