/**
 * Kilogramos de carga en la tarjeta de resumen de Manifiestos.
 *
 * La tarjeta buscaba "la primera columna que hable de KG y de CARGA". Como el
 * orden real es KGS. DE CARGA NACIONAL → KGS. DE CARGA INTERNACIONAL →
 * KG DE CARGA TOTAL, siempre ganaba la nacional y las otras dos se ignoraban.
 * En AIFA, donde la mayor parte de la carga es internacional, eso se veía como
 * decenas de operaciones de carga y "N/D" en kilogramos.
 *
 * La regla correcta: si la fila trae el total capturado, ese manda; si no, se
 * suman nacional e internacional. Nunca los tres, porque el total ya incluye a
 * los otros dos.
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

const api = new Function(`
  ${extractFunction('_conciSummaryColumnKey')}
  ${extractFunction('_conciSummaryNumber')}
  ${extractFunction('_conciSummaryFindColumn')}
  ${extractFunction('_conciSummaryHasValue')}
  ${extractFunction('_conciSummaryCargoColumns')}
  ${extractFunction('_conciSummaryCargoKgs')}
  return { _conciSummaryCargoColumns, _conciSummaryCargoKgs, _conciSummaryNumber };
`)();

// El orden real de las columnas de la tabla, que es lo que provocaba el fallo.
const COLUMNS = [
  'FECHA', 'AEROLINEA', 'TIPO DE OPERACIÓN', '# DE VUELO', 'TOTAL PAX',
  'KGS. DE EQUIPAJE',
  'KGS. DE CARGA NACIONAL',
  'KGS. DE CARGA INTERNACIONAL',
  'KG DE CARGA TOTAL',
  'CORREO', 'OBSERVACIONES',
];

const cargoCols = api._conciSummaryCargoColumns(COLUMNS);
const kgs = row => api._conciSummaryCargoKgs(row, cargoCols);

describe('columnas de carga detectadas', () => {
  test('identifica las tres columnas por separado', () => {
    expect(cargoCols.nacional).toBe('KGS. DE CARGA NACIONAL');
    expect(cargoCols.internacional).toBe('KGS. DE CARGA INTERNACIONAL');
    expect(cargoCols.total).toBe('KG DE CARGA TOTAL');
  });

  test('no confunde la internacional con la nacional', () => {
    expect(cargoCols.nacional).not.toBe(cargoCols.internacional);
  });

  test('deja fuera el equipaje de pasajeros', () => {
    expect(Object.values(cargoCols)).not.toContain('KGS. DE EQUIPAJE');
  });
});

describe('kilogramos de carga por fila', () => {
  test('suma la carga internacional, que antes se ignoraba', () => {
    const resultado = kgs({ 'KGS. DE CARGA INTERNACIONAL': '18500' });
    expect(resultado.kgs).toBe(18500);
    expect(resultado.captured).toBe(true);
  });

  test('suma nacional e internacional cuando vienen las dos', () => {
    expect(kgs({
      'KGS. DE CARGA NACIONAL': '1200',
      'KGS. DE CARGA INTERNACIONAL': '18500',
    }).kgs).toBe(19700);
  });

  test('el total capturado manda y no se duplica con el desglose', () => {
    const resultado = kgs({
      'KGS. DE CARGA NACIONAL': '1200',
      'KGS. DE CARGA INTERNACIONAL': '18500',
      'KG DE CARGA TOTAL': '19700',
    });
    expect(resultado.kgs).toBe(19700);
  });

  test('ignora el equipaje de pasajeros', () => {
    expect(kgs({ 'KGS. DE EQUIPAJE': '3400' }).captured).toBe(false);
  });

  test('acepta separadores de miles y unidades escritas a mano', () => {
    expect(kgs({ 'KG DE CARGA TOTAL': '19,700' }).kgs).toBe(19700);
    expect(kgs({ 'KG DE CARGA TOTAL': '18 500 kg' }).kgs).toBe(18500);
  });

  test('un cero capturado cuenta como dato, no como ausencia', () => {
    const resultado = kgs({ 'KG DE CARGA TOTAL': '0' });
    expect(resultado.kgs).toBe(0);
    expect(resultado.captured).toBe(true);
  });

  test('una fila sin nada capturado no cuenta', () => {
    expect(kgs({ 'KGS. DE CARGA NACIONAL': '', 'KG DE CARGA TOTAL': '   ' }))
      .toEqual({ kgs: 0, captured: false });
    expect(kgs({})).toEqual({ kgs: 0, captured: false });
  });
});

describe('el día completo', () => {
  // Un día realista: casi toda la carga es internacional. Antes la tarjeta
  // sumaba solo la nacional y mostraba "N/D".
  const DIA = [
    { 'AEROLINEA': 'VIVA AEROBUS', 'TOTAL PAX': '180' },
    { 'AEROLINEA': 'CARGOLUX', 'KGS. DE CARGA INTERNACIONAL': '92000' },
    { 'AEROLINEA': 'CHINA SOUTHERN', 'KGS. DE CARGA INTERNACIONAL': '78500' },
    { 'AEROLINEA': 'ESTAFETA', 'KGS. DE CARGA NACIONAL': '4200' },
    { 'AEROLINEA': 'AEROUNION', 'KG DE CARGA TOTAL': '31000' },
  ];

  test('el total del día suma nacional, internacional y totales', () => {
    const suma = DIA.reduce((acc, row) => acc + kgs(row).kgs, 0);
    expect(suma).toBe(92000 + 78500 + 4200 + 31000);
  });

  test('con carga capturada el día ya no reporta ausencia de datos', () => {
    expect(DIA.some(row => kgs(row).captured)).toBe(true);
  });

  test('un día sin carga capturada sí reporta ausencia', () => {
    const soloPax = [{ 'AEROLINEA': 'VIVA AEROBUS', 'TOTAL PAX': '180' }];
    expect(soloPax.some(row => kgs(row).captured)).toBe(false);
  });
});

describe('regresión', () => {
  test('ya no existe la búsqueda de "primera columna que coincida"', () => {
    expect(source).not.toMatch(/const kgsCarCol = _conciSummaryFindColumn/);
  });

  test('se retiró la función de resumen legacy sin usar', () => {
    expect(source).not.toContain('_updateManifiestosSummaryStripLegacy');
  });
});
