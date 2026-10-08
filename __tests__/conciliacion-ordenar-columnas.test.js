/**
 * @jest-environment jsdom
 *
 * Manifiestos › el cuadro de filtro de cada columna ofrece ordenar la tabla:
 * A → Z / Z → A para texto, Menor a mayor / Mayor a menor para números y Más
 * antigua / Más reciente para fechas. Se ordena por lo que muestra la celda;
 * DEMORA +- 15 MIN. por sus minutos. Los vacíos van siempre al final.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const bloque = (inicio, fin) => {
  const a = source.indexOf(inicio);
  const b = source.indexOf(fin, a);
  if (a === -1 || b === -1) throw new Error('No se encontró el bloque.');
  return source.slice(a, b);
};

function preparar(orden, columnas) {
  const ambiente = {
    _conciManifestosSummaryColumns: columnas,
    _conciEditFallbackYear: 2026,
    _conciExcelFilterValueGetter: col => fila => (fila[col] ?? ''),
    _conciDemoraMinutos: (asignado, coordinado, op) => (op === '' ? null : Number(op)),
    _conciTextoFiltrable: v => String(v ?? '').toLowerCase().trim(),
    _conciClaveCronologica: t => {
      const m = String(t).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
      return m ? `${m[3]}${m[2]}${m[1]}${m[4] || '00'}${m[5] || '00'}` : null;
    },
    _conciEsColumnaDemora15: col => /demora\s*\+\s*-?\s*15\s*min/i.test(String(col || '')),
    _conciIsFlightNumberColumn: col => /^#\s*de\s*vuelo$/i.test(String(col || '').trim()),
  };
  const nombres = Object.keys(ambiente);
  return new Function(...nombres,
    bloque('let _conciOrdenTabla = null;', 'function _conciAplicarOrden')
    + `; _conciOrdenTabla = ${JSON.stringify(orden)}; return { _conciOrdenarFilas, _conciTipoDeOrden };`
  )(...nombres.map(n => ambiente[n]));
}
const col = (filas, c) => filas.map(f => f[c]);

describe('ordenar por columna', () => {
  test('texto: A → Z y Z → A, sin acentos ni mayúsculas; vacíos al final', () => {
    const filas = [{ A: 'VOLARIS' }, { A: '' }, { A: 'aeroméxico' }, { A: 'ESTAFETA' }];
    expect(col(preparar({ col: 'A', dir: 'asc' }, ['A'])._conciOrdenarFilas(filas), 'A'))
      .toEqual(['aeroméxico', 'ESTAFETA', 'VOLARIS', '']);
    expect(col(preparar({ col: 'A', dir: 'desc' }, ['A'])._conciOrdenarFilas(filas), 'A'))
      .toEqual(['VOLARIS', 'ESTAFETA', 'aeroméxico', '']);
  });

  test('números: de menor a mayor como número, no como texto', () => {
    const filas = [{ N: '835' }, { N: '96' }, { N: '1205' }, { N: '-' }];
    const api = preparar({ col: 'N', dir: 'asc' }, ['N']);
    expect(api._conciTipoDeOrden(col(filas, 'N'))).toBe('numero');
    expect(col(api._conciOrdenarFilas(filas), 'N')).toEqual(['96', '835', '1205', '-']);
  });

  test('fechas: por calendario (01/11 después de 30/10), con hora', () => {
    const filas = [{ F: '01/11/2026' }, { F: '30/10/2026' }, { F: '30/10/2026 08:00' }];
    const api = preparar({ col: 'F', dir: 'asc' }, ['F']);
    expect(api._conciTipoDeOrden(col(filas, 'F'))).toBe('fecha');
    expect(col(api._conciOrdenarFilas(filas), 'F')).toEqual(['30/10/2026', '30/10/2026 08:00', '01/11/2026']);
    expect(col(preparar({ col: 'F', dir: 'desc' }, ['F'])._conciOrdenarFilas(filas), 'F'))
      .toEqual(['01/11/2026', '30/10/2026 08:00', '30/10/2026']);
  });

  test('DEMORA +- 15 MIN. ordena por los minutos, no por su categoría', () => {
    const D = 'DEMORA +- 15 MIN.';
    const OP = 'HR. DE OPERACIÓN';
    const filas = [{ [OP]: '31' }, { [OP]: '-54' }, { [OP]: '0' }, { [OP]: '' }, { [OP]: '-3' }];
    const ordenadas = preparar({ col: D, dir: 'asc' }, [D, OP])._conciOrdenarFilas(filas);
    expect(col(ordenadas, OP)).toEqual(['-54', '-3', '0', '31', '']);
  });

  test('# DE VUELO se ordena por número aunque alguno traiga letra', () => {
    const V = '# DE VUELO';
    const filas = [{ [V]: '9533' }, { [V]: '113D' }, { [V]: '096' }, { [V]: '113' }, { [V]: '1943' }, { [V]: '' }];
    const api = preparar({ col: V, dir: 'asc' }, [V]);
    expect(col(api._conciOrdenarFilas(filas), V)).toEqual(['096', '113', '113D', '1943', '9533', '']);
    expect(col(preparar({ col: V, dir: 'desc' }, [V])._conciOrdenarFilas(filas), V))
      .toEqual(['9533', '1943', '113D', '113', '096', '']);
    expect(source).toMatch(/const tipoOrden = _conciTipoOrdenColumna\(col,/);
  });

  test('AEROLINEA se ordena por el nombre que muestra la celda, no por el código', () => {
    const A = 'AEROLINEA';
    const nombres = { '2D': 'Eastern Airlines', '5X': 'UPS Airlines', '5Y': 'Atlas Air', AM: 'Aeroméxico' };
    const filas = [{ [A]: '2D' }, { [A]: '5X' }, { [A]: '5Y' }, { [A]: 'AM' }, { [A]: 'ZZ' }];
    const ambiente = {
      _conciManifestosSummaryColumns: [A], _conciEditFallbackYear: 2026,
      _conciExcelFilterValueGetter: c => f => (f[c] ?? ''),
      _conciDemoraMinutos: () => null,
      _conciTextoFiltrable: v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
      _conciClaveCronologica: () => null,
      _conciEsColumnaDemora15: () => false,
      _conciIsFlightNumberColumn: () => false,
      _conciResolveAirlineMeta: code => (nombres[code] ? { name: nombres[code] } : null),
    };
    const n = Object.keys(ambiente);
    const api = new Function(...n,
      bloque('let _conciOrdenTabla = null;', 'function _conciAplicarOrden')
      + `; _conciOrdenTabla = { col: '${A}', dir: 'asc' }; return { _conciOrdenarFilas };`
    )(...n.map(k => ambiente[k]));
    expect(col(api._conciOrdenarFilas(filas), A)).toEqual(['AM', '5Y', '2D', '5X', 'ZZ']);
  });

  test('empates conservan el orden que traía la tabla', () => {
    const filas = [{ A: 'X', i: 1 }, { A: 'X', i: 2 }, { A: 'X', i: 3 }];
    expect(col(preparar({ col: 'A', dir: 'desc' }, ['A'])._conciOrdenarFilas(filas), 'i')).toEqual([1, 2, 3]);
  });

  test('el cuadro de filtro trae la sección Ordenar y la tabla la aplica al pintar', () => {
    expect(source).toMatch(/<div class="small text-muted mb-1 px-1">Ordenar<\/div>/);
    expect(source).toMatch(/_conciAplicarOrden\(\{ col, dir: boton\.dataset\.dir \}\);/);
    expect(source).toMatch(/if \(_conciOrdenTabla && _conciManifestosSummaryColumns\.includes\(_conciOrdenTabla\.col\)\) \{\s*data = _conciOrdenarFilas\(_conciManifestosAllData\);/);
  });
});
