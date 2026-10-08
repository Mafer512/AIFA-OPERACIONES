/**
 * @jest-environment jsdom
 *
 * Manifiestos › las listas de los filtros de PUNTUALIDAD / CANCELACIÓN y
 * DEMORA +- 15 MIN. sólo ofrecen lo que existe en los renglones que dejan los
 * DEMÁS filtros (como en Excel). Caso real: con PUNTUALIDAD en ANTICIPADO, la
 * lista de DEMORA ofrecía las seis categorías aunque sólo había "Menor a -15";
 * con DEMORA en 0, la de PUNTUALIDAD ofrecía todas aunque sólo había EN TIEMPO.
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

const PUNT = 'PUNTUALIDAD / CANCELACIÓN';
const DEM = 'DEMORA +- 15 MIN.';
const FILAS = [
  { [PUNT]: 'ANTICIPADO', [DEM]: 'Menor a -15', 'TIPO DE MANIFIESTO': 'LLEGADA' },
  { [PUNT]: 'ANTICIPADO', [DEM]: 'Menor a -15', 'TIPO DE MANIFIESTO': 'SALIDA' },
  { [PUNT]: 'EN TIEMPO', [DEM]: '0', 'TIPO DE MANIFIESTO': 'LLEGADA' },
  { [PUNT]: 'ANTES', [DEM]: 'Entre -1 y -15', 'TIPO DE MANIFIESTO': 'SALIDA' },
  { [PUNT]: 'DEMORA', [DEM]: 'Mayor a +15', 'TIPO DE MANIFIESTO': 'LLEGADA' },
];

function preparar({ excel = {}, dir = null } = {}) {
  const texto = s => String(s ?? '').toLowerCase().trim();
  const ambiente = {
    _conciExcelFilters: excel,
    _conciManifestosSummaryColumns: [PUNT, DEM, 'TIPO DE MANIFIESTO'],
    _conciManifestosAllData: FILAS,
    _conciClassFilter: null, _conciDirFilter: dir, _conciOvercapFilter: false, _conciCaptureFilter: null,
    _conciPlanDeFiltros: () => ({ texto: [], excel: [], columnas: new Set(), buscaRecepcion: false }),
    _conciTextoFiltrable: texto,
    _conciExcelFilterValueGetter: col => fila => fila[col],
    _conciIsReceptionColumn: () => false,
    _conciRowIsCargo: () => false,
    _conciNormalizeEditableCellText: v => String(v ?? '').trim(),
    _conciCompactText: v => String(v || ''),
    _conciCeldasParaFiltro: () => new Map(),
    _conciRowPassesPillFilter: () => true,
    _conciRowPassesColFilter: () => true,
  };
  const nombres = Object.keys(ambiente);
  return new Function(...nombres,
    bloque('const _conciEsColumnaDemora15', 'function _conciCategoriaDemora')
    + bloque('// PUNTUALIDAD / CANCELACIÓN y DEMORA +- 15 MIN.: su lista', 'function _showConciExcelFilter')
    + '; return { _conciEsFiltroEnCascada, _conciPasaOtrosFiltros };'
  )(...nombres.map(n => ambiente[n]));
}

const opciones = (api, col) => {
  const pasa = api._conciPasaOtrosFiltros(col);
  return [...new Set(FILAS.filter((f, i) => pasa(f, i)).map(f => f[col]))].sort();
};

describe('listas en cascada de PUNTUALIDAD y DEMORA', () => {
  test('sólo esas dos columnas', () => {
    const api = preparar();
    expect(api._conciEsFiltroEnCascada(PUNT)).toBe(true);
    expect(api._conciEsFiltroEnCascada(DEM)).toBe(true);
    expect(api._conciEsFiltroEnCascada('AEROLINEA')).toBe(false);
  });

  test('con PUNTUALIDAD en ANTICIPADO, DEMORA sólo ofrece "Menor a -15"', () => {
    const api = preparar({ excel: { [PUNT]: new Set(['ANTICIPADO']) } });
    expect(opciones(api, DEM)).toEqual(['Menor a -15']);
    // Su propia lista no se recorta por su propio filtro.
    expect(opciones(api, PUNT)).toEqual(['ANTES', 'ANTICIPADO', 'DEMORA', 'EN TIEMPO']);
  });

  test('con DEMORA en 0, PUNTUALIDAD sólo ofrece EN TIEMPO', () => {
    const api = preparar({ excel: { [DEM]: new Set(['0']) } });
    expect(opciones(api, PUNT)).toEqual(['EN TIEMPO']);
  });

  test('las píldoras también cuentan: sólo llegadas', () => {
    const api = preparar({ dir: 'arr' });
    expect(opciones(api, PUNT)).toEqual(['ANTICIPADO', 'DEMORA', 'EN TIEMPO']);
  });

  test('sin otros filtros, todo lo que hay', () => {
    const api = preparar();
    expect(opciones(api, DEM)).toEqual(['0', 'Entre -1 y -15', 'Mayor a +15', 'Menor a -15']);
  });

  test('la lista del filtro usa esta revisión para esas columnas', () => {
    expect(source).toMatch(/const pasaOtros = _conciEsFiltroEnCascada\(col\) \? _conciPasaOtrosFiltros\(col\) : null;/);
    expect(source).toMatch(/if \(pasaOtros && !pasaOtros\(datos, i\)\) return;/);
  });
});
