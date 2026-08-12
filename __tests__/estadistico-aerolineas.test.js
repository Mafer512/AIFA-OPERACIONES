const fs = require('fs');
const path = require('path');

const Core = require('../js/estadistico-aerolineas-core');

const seedSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '012_seed_airline_monthly_statistics_2026.sql'),
  'utf8'
);
const uiSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'estadistico-aerolineas.js'),
  'utf8'
);
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function rowsFromOfficialSeed() {
  return [...seedSql.matchAll(/\(2026,\s*(\d+),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*'Excel/g)]
    .map(match => ({
      year: 2026,
      month: Number(match[1]),
      aerolinea: match[2],
      pasajeros_total: Number(match[3]),
      operaciones_total: Number(match[4]),
      tipo_operacion: 'Consolidado',
    }));
}

const normalizedSeed = Core.normalizeRows(rowsFromOfficialSeed());
const MONTHS_JAN_JUL = [1, 2, 3, 4, 5, 6, 7];

describe('Estadístico por Aerolínea', () => {
  let consoleWarn;

  beforeAll(() => {
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleWarn.mockRestore();
  });

  test('la semilla oficial conserva los 64 registros mensuales del Excel', () => {
    expect(rowsFromOfficialSeed()).toHaveLength(64);
    expect(normalizedSeed.report).toMatchObject({
      inputRows: 64,
      validRows: 64,
      invalidRows: 0,
      invalidValues: 0,
      negativeValues: 0,
      emptyAirlines: 0,
      exactDuplicates: 0,
    });
  });

  test('enero-julio coincide con el total y participación de pasajeros del Excel', () => {
    const result = Core.aggregate(normalizedSeed.rows, {
      year: '2026',
      months: MONTHS_JAN_JUL,
      metric: 'pasajeros',
    });

    expect(result.total).toBe(4324002);
    expect(result.monthsWithData).toEqual(MONTHS_JAN_JUL);
    expect(result.activeAirlines).toBe(12);
    expect(result.top.airline).toBe('VIVA AEROBUS');
    expect(result.top.value).toBe(3146846);
    expect(result.top.participation).toBeCloseTo((3146846 / 4324002) * 100, 10);
    expect(result.rows.map(row => row.airline).slice(0, 4)).toEqual([
      'VIVA AEROBUS', 'VOLARIS', 'MEXICANA', 'AEROLITORAL',
    ]);
    expect(result.rows.reduce((sum, row) => sum + row.participation, 0)).toBeCloseTo(100, 10);
  });

  test('enero-julio coincide con el total y participación de operaciones del Excel', () => {
    const result = Core.aggregate(normalizedSeed.rows, {
      year: '2026',
      months: MONTHS_JAN_JUL,
      metric: 'operaciones',
    });

    expect(result.total).toBe(32551);
    expect(result.activeAirlines).toBe(12);
    expect(result.top.airline).toBe('VIVA AEROBUS');
    expect(result.top.value).toBe(19328);
    expect(result.top.participation).toBeCloseTo((19328 / 32551) * 100, 10);
  });

  test('conserva los totales del Excel para aerolíneas principales y de baja actividad', () => {
    const passengers = Core.aggregate(normalizedSeed.rows, {
      year: '2026', months: MONTHS_JAN_JUL, metric: 'pasajeros',
    });
    const operations = Core.aggregate(normalizedSeed.rows, {
      year: '2026', months: MONTHS_JAN_JUL, metric: 'operaciones',
    });
    const passengerByAirline = Object.fromEntries(passengers.rows.map(row => [row.airline, row.value]));
    const operationByAirline = Object.fromEntries(operations.rows.map(row => [row.airline, row.value]));

    expect(passengerByAirline).toMatchObject({
      'VIVA AEROBUS': 3146846,
      AEROLITORAL: 255595,
      AEROREGIONAL: 290,
      'GLOBAL CROSSING AIRLINES': 437,
    });
    expect(operationByAirline).toMatchObject({
      'VIVA AEROBUS': 19328,
      AEROLITORAL: 3516,
      AEROREGIONAL: 2,
      'GLOBAL CROSSING AIRLINES': 8,
    });
  });

  test.each([
    [[1], 'pasajeros', 601184, 9, 434463],
    [[1], 'operaciones', 4643, 9, 2773],
    [[1, 2, 3], 'pasajeros', 1708862, 9, 1227598],
  ])('agrega el escenario %j de %s sin mezclar meses', (months, metric, total, active, topValue) => {
    const result = Core.aggregate(normalizedSeed.rows, { year: '2026', months, metric });
    expect(result.total).toBe(total);
    expect(result.activeAirlines).toBe(active);
    expect(result.top.value).toBe(topValue);
    expect(result.monthsWithData).toEqual(months);
  });

  test('normaliza espacios, mayúsculas y acentos sin unir nombres distintos', () => {
    const normalized = Core.normalizeRows([
      { year: 2026, month: 1, aerolinea: ' Aerovías ', pasajeros_total: 100, operaciones_total: 1 },
      { year: 2026, month: 1, aerolinea: 'AEROVIAS', pasajeros_total: 100, operaciones_total: 1 },
      { year: 2026, month: 1, aerolinea: 'VIVA AEROBUS', pasajeros_total: 25, operaciones_total: 1 },
      { year: 2026, month: 1, aerolinea: 'VIVAAEROBUS', pasajeros_total: 30, operaciones_total: 1 },
    ]);
    const result = Core.aggregate(normalized.rows, { year: '2026', months: [1], metric: 'pasajeros' });

    expect(normalized.report.exactDuplicates).toBe(1);
    expect(normalized.report.nameVariants).toEqual([
      { key: 'AEROVIAS', labels: ['AEROVIAS', 'Aerovías'] },
    ]);
    expect(result.total).toBe(155);
    expect(result.activeAirlines).toBe(3);
  });

  test('convierte formatos numéricos comunes y rechaza valores inválidos', () => {
    expect(Core.parseNumber('3,146,846')).toMatchObject({ value: 3146846, valid: true });
    expect(Core.parseNumber('3.146.846')).toMatchObject({ value: 3146846, valid: true });
    expect(Core.parseNumber('1.234,50')).toMatchObject({ value: 1234.5, valid: true });
    expect(Core.parseNumber('72,78')).toMatchObject({ value: 72.78, valid: true });
    expect(Core.parseNumber('sin dato')).toMatchObject({ value: 0, valid: false });

    const normalized = Core.normalizeRows([
      { year: 2026, month: 1, aerolinea: 'PRUEBA', pasajeros_total: '-10', operaciones_total: 'sin dato' },
    ]);
    expect(normalized.report.negativeValues).toBe(1);
    expect(normalized.report.invalidValues).toBe(1);
    expect(Core.aggregate(normalized.rows, { year: '2026', months: [1], metric: 'pasajeros' }).total).toBe(0);
  });

  test('el estado vacío no produce NaN ni Infinity', () => {
    const result = Core.aggregate(normalizedSeed.rows, {
      year: '2025',
      months: [1],
      metric: 'pasajeros',
    });
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.top).toBeNull();
  });

  test('el filtro de año no mezcla ejercicios y resuelve empates por nombre', () => {
    const normalized = Core.normalizeRows([
      { year: 2025, month: 1, aerolinea: 'ZETA AIR', pasajeros_total: 50, operaciones_total: 1 },
      { year: 2025, month: 1, aerolinea: 'ALFA AIR', pasajeros_total: 50, operaciones_total: 1 },
      { year: 2026, month: 1, aerolinea: 'ALFA AIR', pasajeros_total: 900, operaciones_total: 9 },
    ]);
    const result = Core.aggregate(normalized.rows, {
      year: '2025', months: [1], metric: 'pasajeros',
    });

    expect(result.total).toBe(100);
    expect(result.rows.map(row => row.airline)).toEqual(['ALFA AIR', 'ZETA AIR']);
    expect(result.top.airline).toBe('ALFA AIR');
  });

  test('solo habilita meses que contienen información del indicador', () => {
    expect(Core.getAvailableMonths(normalizedSeed.rows, '2026', 'pasajeros')).toEqual(MONTHS_JAN_JUL);
    expect(Core.getAvailableMonths(normalizedSeed.rows, '2025', 'pasajeros')).toEqual([]);
  });

  test('aplica el mapa institucional exacto y reconoce sus variantes normalizadas', () => {
    expect(Core.AIRLINE_COLORS).toEqual({
      'VIVA AEROBUS': '#16A34A',
      VIVA: '#16A34A',
      VOLARIS: '#9C27B0',
      MEXICANA: '#C62828',
      AEROLITORAL: '#163A70',
      'AEROMEXICO CONNECT': '#163A70',
      ARAJET: '#6D28D9',
      AEROVIAS: '#0B2D5C',
      CONVIASA: '#E46C24',
      AERUS: '#A8D82E',
      MAGNICHARTERS: '#D71920',
      'GRIDIRON AIR': '#1F2937',
      'GLOBAL CROSSING AIRLINES': '#22CBD0',
      GLOBALX: '#22CBD0',
      'GLOBALX AIR': '#22CBD0',
      AEROREGIONAL: '#1B95D2',
    });
    expect(Core.getAirlineColor('  Viva   Aerobus ')).toBe('#16A34A');
    expect(Core.getAirlineColor('Aerovías')).toBe('#0B2D5C');
    expect(Core.getAirlineColor('Aeroméxico Connect')).toBe('#163A70');
    expect(Core.getAirlineColor('GLOBALX AIR')).toBe('#22CBD0');
  });

  test('una aerolínea desconocida usa el respaldo y genera una sola advertencia', () => {
    consoleWarn.mockClear();
    expect(Core.getAirlineColor('Nueva Aerolínea de Prueba')).toBe('#64748B');
    expect(Core.getAirlineColor(' nueva   aerolínea de prueba ')).toBe('#64748B');
    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  test('los colores no dependen del indicador, valor ni posición del ranking', () => {
    consoleWarn.mockClear();
    const passengerResult = Core.aggregate(normalizedSeed.rows, {
      year: '2026', months: MONTHS_JAN_JUL, metric: 'pasajeros',
    });
    const operationResult = Core.aggregate(normalizedSeed.rows, {
      year: '2026', months: [6], metric: 'operaciones',
    });
    const passengerColors = Object.fromEntries(passengerResult.rows.map(row => [row.airline, row.color]));

    expect(passengerResult.rows.every(row => row.color !== Core.DEFAULT_AIRLINE_COLOR)).toBe(true);
    expect(consoleWarn).not.toHaveBeenCalled();

    operationResult.rows.forEach(row => {
      expect(row.color).toBe(passengerColors[row.airline]);
      expect(row.color).toBe(Core.getAirlineColor(row.airline));
    });
  });

  test('el CSV comparte orden, filtros, totales y porcentajes de la agregación', () => {
    const result = Core.aggregate(normalizedSeed.rows, {
      year: '2026',
      months: [1, 2, 3],
      metric: 'pasajeros',
    });
    const csvRows = Core.buildCsvRows(result);

    expect(csvRows[0]).toEqual([
      'Año', 'Indicador', 'Meses seleccionados', 'Posición', 'Aerolínea', 'Total', 'Participación',
    ]);
    expect(csvRows[1].slice(0, 6)).toEqual([
      '2026', 'Pasajeros transportados', 'Ene | Feb | Mar', 1, 'VIVA AEROBUS', 1227598,
    ]);
    expect(csvRows.at(-1)).toEqual([
      '2026', 'Pasajeros transportados', 'Ene | Feb | Mar', '', 'TOTAL', 1708862, '100.00%',
    ]);
  });

  test('la interfaz consume una sola agregación y carga primero su helper', () => {
    expect(uiSource).toContain('state.aggregation = Core.aggregate(state.rows');
    expect(uiSource).toContain('renderSummary(result);');
    expect(uiSource).toContain('renderChart(result);');
    expect(uiSource).toContain('renderTable(result);');
    expect(uiSource).toContain('Core.buildCsvRows(result)');
    expect(uiSource).toContain("['\\uFEFF' + csv]");
    expect(uiSource).toContain(".join('\\r\\n')");
    expect(indexSource.indexOf('js/estadistico-aerolineas-core.js'))
      .toBeLessThan(indexSource.indexOf('js/estadistico-aerolineas.js'));
  });
});
