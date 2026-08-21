const fs = require('fs');
const path = require('path');

const Core = require('../js/estadistico-informe-core');

const uiSource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'estadistico-informe.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

const resumenRows = [
  { anio: 2024, mes: 12, tipo_aviacion: 'comercial', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 10, pax_total: 1000, carga_kg_total: 0 },
  { anio: 2024, mes: 12, tipo_aviacion: 'comercial', direccion: 'D', nacional_internacional: 'Internacional', operaciones: 5, pax_total: 600, carga_kg_total: 0 },
  { anio: 2025, mes: 1, tipo_aviacion: 'carga', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 4, pax_total: 0, carga_kg_total: 8000 },
  { anio: 2025, mes: 1, tipo_aviacion: 'carga', direccion: 'D', nacional_internacional: 'Internacional', operaciones: 2, pax_total: 0, carga_kg_total: 5000 },
];

// Cifra mensual OFICIAL (monthly_operations), la fuente de verdad del informe.
// Noviembre y diciembre de 2024 van ratificados y traen más de lo que alcanzan
// a ver los manifiestos — que es lo normal: los manifiestos sólo cubren lo ya
// conciliado. Enero 2025 va marcado preliminar, así que ahí mandan ellos.
const monthlyOpsRows = [
  { year: 2024, month: 11, comercial_ops: 30, comercial_pax: 3000, general_ops: 5, general_pax: 11, carga_ops: 8, carga_tons: 20 },
  { year: 2024, month: 12, comercial_ops: 25, comercial_pax: 2500, general_ops: 3, general_pax: 9, carga_ops: 7, carga_tons: 15 },
  { year: 2025, month: 1, general_ops: 2, general_pax: 6, is_official: false },
];

// annual_operations sólo entra para años que no tengan ningún mes capturado:
// el total por año se deriva de los meses, para que la fila "TOTAL POR AÑO"
// siempre cuadre con la columna que tiene encima.
const annualOpsRows = [
  { year: 2024, comercial_ops_total: 55, comercial_pax_total: 5500, general_ops_total: 8, general_pax_total: 20, carga_ops_total: 15, carga_tons_total: 35 },
  { year: 2025, general_ops_total: 2, general_pax_total: 6 },
];

describe('InformeEstadisticoCore', () => {
  test('aggregateResumen suma operaciones_respaldo_itinerario (vuelos sin conciliar aún) por separado', () => {
    const rows = [
      { anio: 2025, mes: 1, tipo_aviacion: 'comercial', direccion: 'A', operaciones: 10, operaciones_respaldo_itinerario: 4, pax_total: 500, carga_kg_total: 0 },
    ];
    const result = Core.aggregateResumen(rows);
    expect(result.porAnio.get(2025).comercial.ops).toBe(10);
    expect(result.porAnio.get(2025).comercial.opsRespaldoItinerario).toBe(4);
  });

  test('aggregateResumen suma operaciones/pax/kg por año y por año-mes, separando Nacional/Internacional', () => {
    const result = Core.aggregateResumen(resumenRows);

    expect(result.anios).toEqual([2024, 2025]);
    expect(result.porAnio.get(2024).comercial).toMatchObject({
      ops: 15, opsLlegada: 10, opsSalida: 5, opsNacional: 10, opsInternacional: 5,
      pax: 1600, paxNacional: 1000, paxInternacional: 600,
    });
    expect(result.porAnio.get(2024).carga.ops).toBe(0);
    expect(result.porAnio.get(2025).carga).toMatchObject({
      ops: 6, opsLlegada: 4, opsSalida: 2, opsNacional: 4, opsInternacional: 2,
      kg: 13000, kgNacional: 8000, kgInternacional: 5000,
    });
    expect(result.porAnioMes.get('2024-12').comercial.ops).toBe(15);
    expect(result.porAnioMes.get('2025-1').carga.kg).toBe(13000);
  });

  // La historia del informe (desde 2022) sólo existe en monthly_operations:
  // maestra_operaciones apenas cubre los últimos meses de lo ya conciliado.
  // Estas cuatro pruebas fijan la regla de precedencia entre las dos fuentes.
  test('mergeOficiales: un mes ratificado manda sobre lo que ven los manifiestos', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);

    // Manifiestos ven 15 operaciones en diciembre 2024; la cifra oficial dice 25.
    expect(aggregated.porAnioMes.get('2024-12').comercial).toMatchObject({ ops: 25, pax: 2500, fuente: 'oficial' });
    // Y como la fuente oficial no trae desglose, éste se limpia en vez de
    // dejar el de manifiestos junto a un total que ya no le corresponde.
    expect(aggregated.porAnioMes.get('2024-12').comercial.opsNacional).toBe(0);
  });

  test('mergeOficiales: un mes marcado preliminar deja mandar a los manifiestos', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);

    // Enero 2025 va con is_official: false, así que la carga se queda con lo
    // conciliado (6 operaciones / 13,000 kg) …
    expect(aggregated.porAnioMes.get('2025-1').carga).toMatchObject({ ops: 6, kg: 13000 });
    // … pero Aviación General no tiene contraparte en manifiestos: aunque el
    // mes esté preliminar, la única cifra que existe es la oficial.
    expect(aggregated.porAnioMes.get('2025-1').general).toMatchObject({ ops: 2, pax: 6 });
  });

  test('mergeOficiales: el TOTAL POR AÑO se deriva de los meses, no de annual_operations', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);

    expect(aggregated.porAnio.get(2024).comercial).toMatchObject({ ops: 55, pax: 5500 });   // 30 + 25
    expect(aggregated.porAnio.get(2024).general).toMatchObject({ ops: 8, pax: 20 });        // 5 + 3
    expect(aggregated.porAnio.get(2024).carga).toMatchObject({ ops: 15, kg: 35000 });       // 8 + 7
    expect(aggregated.anios).toEqual([2024, 2025]);
  });

  test('mergeOficiales: un año sin ningún mes capturado sí cae a annual_operations', () => {
    const aggregated = Core.mergeOficiales(
      Core.aggregateResumen([]), [],
      [{ year: 2022, comercial_ops_total: 8996, comercial_pax_total: 912415, general_ops_total: 458, general_pax_total: 1385, carga_ops_total: 8, carga_tons_total: 5.19 }]
    );

    expect(aggregated.porAnio.get(2022).comercial).toMatchObject({ ops: 8996, pax: 912415 });
    expect(aggregated.porAnio.get(2022).carga.kg).toBeCloseTo(5190, 6);
    expect(aggregated.anios).toEqual([2022]);
  });

  test('buildAcumulado suma comercial + general para el total de operaciones/pasajeros y deja carga aparte', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const acumulado = Core.buildAcumulado(aggregated);

    expect(acumulado.comercial).toMatchObject({ ops: 55, pax: 5500 });
    expect(acumulado.general).toMatchObject({ ops: 10, pax: 26 });
    expect(acumulado.carga).toMatchObject({ ops: 21, kg: 48000 });
    expect(acumulado.totalOperaciones).toBe(65);
    expect(acumulado.totalPasajeros).toBe(5526);
  });

  test('aggregateAerolinea agrega llegada+salida por aerolínea, filtra por año y ordena por operaciones', () => {
    const aerolineaRows = [
      { anio: 2025, mes: 1, aerolinea: 'VOLARIS', tipo_aviacion: 'comercial', direccion: 'A', operaciones: 6, pax_total: 600, carga_kg_total: 0 },
      { anio: 2025, mes: 1, aerolinea: 'VOLARIS', tipo_aviacion: 'comercial', direccion: 'D', operaciones: 6, pax_total: 590, carga_kg_total: 0 },
      { anio: 2025, mes: 2, aerolinea: 'VIVA AEROBUS', tipo_aviacion: 'comercial', direccion: 'A', operaciones: 20, pax_total: 2000, carga_kg_total: 0 },
      { anio: 2025, mes: 2, aerolinea: 'VIVA AEROBUS', tipo_aviacion: 'comercial', direccion: 'D', operaciones: 20, pax_total: 1980, carga_kg_total: 0 },
      { anio: 2024, mes: 5, aerolinea: 'AEROMEXICO', tipo_aviacion: 'comercial', direccion: 'A', operaciones: 100, pax_total: 9000, carga_kg_total: 0 },
    ];

    const result = Core.aggregateAerolinea(aerolineaRows, 2025);

    expect(result.rows.map(r => r.aerolinea)).toEqual(['VIVA AEROBUS', 'VOLARIS']);
    expect(result.rows[0]).toMatchObject({ ops: 40, pax: 3980 });
    expect(result.rows[1]).toMatchObject({ ops: 12, pax: 1190 });
    expect(result.totalOps).toBe(52);
    expect(result.rows[0].participacionOps).toBeCloseTo((40 / 52) * 100, 10);
    expect(result.rows[1].participacionPax).toBeCloseTo((1190 / 5170) * 100, 10);
  });

  test('aggregateDiaCorte cuenta cada fila cruda como una operación, separando comercial de carga', () => {
    const rows = [
      { es_carga: false, direccion: 'A', pax_total: '150', carga_kg: 0, nacional_internacional: 'Nacional', fecha_operacion: '2026-01-15' },
      { es_carga: false, direccion: 'D', pax_total: '140', carga_kg: 0, nacional_internacional: 'Internacional', fecha_operacion: '2026-01-15' },
      { es_carga: true, direccion: 'A', pax_total: 0, carga_kg: '5000', nacional_internacional: 'Nacional', fecha_operacion: '2026-01-15' },
    ];

    const result = Core.aggregateDiaCorte(rows);

    expect(result.fecha).toBe('2026-01-15');
    expect(result.comercial).toMatchObject({ ops: 2, opsLlegada: 1, opsSalida: 1, pax: 290, opsNacional: 1, opsInternacional: 1 });
    expect(result.carga).toMatchObject({ ops: 1, opsLlegada: 1, kg: 5000, opsNacional: 1 });
  });

  test('computeOccupancyFactors solo usa filas con capacidad_matricula conocida y promedia llegada/salida', () => {
    const rows = [
      { aerolinea: 'VOLARIS', endpoint_code: 'CUN', direccion: 'A', pax_total: 150, capacidad_matricula: 180 },
      { aerolinea: 'VOLARIS', endpoint_code: 'CUN', direccion: 'D', pax_total: 140, capacidad_matricula: 180 },
      { aerolinea: 'DESCONOCIDA', endpoint_code: 'MTY', direccion: 'A', pax_total: 80, capacidad_matricula: null },
    ];

    const result = Core.computeOccupancyFactors(rows);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ aerolinea: 'VOLARIS', destino: 'CUN' });
    expect(result.rows[0].factorLlegada).toBeCloseTo((150 / 180) * 100, 8);
    expect(result.rows[0].factorSalida).toBeCloseTo((140 / 180) * 100, 8);
    expect(result.rows[0].factorTotal).toBeCloseTo(((150 + 140) / (180 * 2)) * 100, 8);
    expect(result.promedioGeneral).toBeCloseTo(result.rows[0].factorTotal, 8);
  });

  test('compareYears compara el mismo mes entre dos años (enero: solo 2025 tiene carga capturada)', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const comparacion = Core.compareYears(aggregated, 2025, 2024, 1);

    const carga = comparacion.rows.find(r => r.label === 'Operaciones Carga');
    expect(carga).toMatchObject({ a: 6, b: 0, variacion: null }); // base 0: % de variación indefinido
    expect(comparacion.rows.find(r => r.label === 'Operaciones Comercial')).toMatchObject({ a: 0, b: 0 });
  });

  test('compareYears sin mes compara el año completo (diciembre 2024 vs enero 2025 quedan en su propio año)', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const comparacion = Core.compareYears(aggregated, 2024, 2025);

    expect(comparacion.rows.find(r => r.label === 'Operaciones Comercial')).toMatchObject({ a: 55, b: 0 });
    const carga = comparacion.rows.find(r => r.label === 'Operaciones Carga');
    expect(carga.a).toBe(15);
    expect(carga.b).toBe(6);
    expect(carga.variacion).toBeCloseTo(150, 8); // de 6 a 15 es +150%
  });

  test('projectMonthClosure y projectYearClosure proyectan con regla de tres sobre días transcurridos', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);

    expect(Core.daysInMonth(2025, 1)).toBe(31);
    expect(Core.isLeapYear(2024)).toBe(true);
    expect(Core.daysInYear(2024)).toBe(366);
    expect(Core.dayOfYear(2025, 1, 10)).toBe(10);

    const mesProy = Core.projectMonthClosure(aggregated, 2025, 1, 10);
    expect(mesProy.carga.opsActual).toBe(6);
    expect(mesProy.carga.opsProyectado).toBeCloseTo(6 * (31 / 10), 8);

    const anioProy = Core.projectYearClosure(aggregated, 2024, 100);
    expect(anioProy.general.opsActual).toBe(8);
    expect(anioProy.general.opsProyectado).toBeCloseTo(8 * (366 / 100), 8);
    expect(Core.projectValue(10, 0, 30)).toBeNull();
  });

  test('buildMonthlySeries devuelve 12 meses con las operaciones por tipo de aviación', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const serie = Core.buildMonthlySeries(aggregated, 2025);

    expect(serie.labels).toHaveLength(12);
    expect(serie.cargaOps[0]).toBe(6);
    expect(serie.generalOps[0]).toBe(2);
    expect(serie.comercialOps[0]).toBe(0);
  });

  test('buildTablaMensualPorAnios pivotea a meses-por-fila/años-por-columna con TOTAL y ACUMULADO', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const pivot = Core.buildTablaMensualPorAnios(aggregated, 'comercial', [2024, 2025]);

    expect(pivot.anios).toEqual([2024, 2025]);
    expect(pivot.rows[11].celdas[2024].ops).toBe(25); // Diciembre 2024, cifra oficial
    expect(pivot.rows[10].celdas[2024].ops).toBe(30); // Noviembre 2024
    expect(pivot.rows[0].celdas[2025].ops).toBe(0); // Enero 2025 sin comercial
    expect(pivot.totalPorAnio[2024]).toMatchObject({ ops: 55, pax: 5500 });
    expect(pivot.totalGeneral).toMatchObject({ ops: 55, pax: 5500 }); // gran total, no suma corrida por año
  });

  test('buildResumenCronologico separa años cerrados, año en curso y hoy/ayer cuando hay corte diario', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const hoy = { anio: 2025, mes: 1, dia: 1 };
    const rows = Core.buildResumenCronologico(aggregated, 'carga', [2024, 2025], hoy, { ops: 6, pax: 0, kg: 13000 });

    expect(rows.map(r => r.label)).toEqual(['ENE. A DIC. 2024', '1 ENE. 2025', 'TOTAL']);
    expect(rows.find(r => r.label === 'TOTAL')).toMatchObject({ ops: 21, kg: 48000 });
  });

  test('buildResumenCronologico sin corte diario (Aviación General) deja el año en curso en un solo renglón', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const hoy = { anio: 2025, mes: 1, dia: 15 };
    const rows = Core.buildResumenCronologico(aggregated, 'general', [2024, 2025], hoy, null);

    expect(rows.map(r => r.label)).toEqual(['ENE. A DIC. 2024', 'ENE. A ENE. 2025', 'TOTAL']);
    expect(rows.find(r => r.label === 'ENE. A ENE. 2025')).toMatchObject({ ops: 2, pax: 6 });
  });

  test('findMissingDays detecta huecos de captura en un rango de fechas', () => {
    const rows = [{ fecha_operacion: '2026-01-15' }, { fecha_operacion: '2026-01-17' }];
    const faltantes = Core.findMissingDays(rows, '2026-01-15', '2026-01-17');
    expect(faltantes).toEqual(['2026-01-16']);
    expect(Core.findMissingDays([], null, null)).toEqual([]);
  });

  test('computeOccupancyFactors respeta el orden institucional de aerolíneas del documento autorizado', () => {
    // Entran desordenadas a propósito. El orden NO es alfabético ni por
    // volumen: es el orden fijo con el que se publica el informe.
    const rows = ['AERUS', 'VOLARIS', 'CONVIASA', 'AEROMEXICO', 'ARAJET', 'AEROLÍNEA EM', 'VIVA AEROBUS', 'CHINA SOUTHERN AIRLINES']
      .map(a => ({ aerolinea: a, endpoint_code: 'CUN', direccion: 'A', pax_total: 100, capacidad_matricula: 180 }));

    const result = Core.computeOccupancyFactors(rows);

    expect(result.rows.map(r => r.aerolinea)).toEqual([
      'AEROMEXICO', 'VOLARIS', 'VIVA AEROBUS', 'AEROLÍNEA EM',
      'CONVIASA', 'ARAJET', 'AERUS',
      'CHINA SOUTHERN AIRLINES', // fuera de la lista -> al final
    ]);
  });

  test('toNumber tolera texto, nulos y valores no numéricos', () => {
    expect(Core.toNumber('1,234')).toBe(1234);
    expect(Core.toNumber(null)).toBe(0);
    expect(Core.toNumber('')).toBe(0);
    expect(Core.toNumber(150)).toBe(150);
    expect(Core.toNumber('sin dato')).toBe(0);
  });

  test('los constructores de filas de exportación producen encabezado + filas consistentes con la agregación', () => {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen(resumenRows), monthlyOpsRows, annualOpsRows);
    const acumulado = Core.buildAcumulado(aggregated);

    const acumuladoRows = Core.buildAcumuladoRows(acumulado);
    expect(acumuladoRows[0]).toEqual(['Tipo de aviación', 'Operaciones', 'Pasajeros', 'Toneladas de carga (kg)']);
    expect(acumuladoRows.find(row => row[0] === 'Aviación de Carga')[3]).toBe(48000);

    const mensualRows = Core.buildMensualRows(aggregated, 2025);
    expect(mensualRows[0][0]).toBe('Mes');
    expect(mensualRows.some(row => row[1] === 'carga' && row[4] === 6)).toBe(true);

    const aerolineaAgg = Core.aggregateAerolinea([], 2025);
    expect(Core.buildAerolineaRows(aerolineaAgg)[0]).toEqual([
      'Aerolínea', 'Tipo', 'Operaciones', 'Participación Ops.', 'Pasajeros', 'Participación Pax.',
    ]);

    const ocupacionRows = Core.buildOcupacionRows({ rows: [] });
    expect(ocupacionRows[0]).toEqual(['Aerolínea', 'Destino', 'Factor de salida', 'Factor de llegada', 'Factor total']);
  });

  test('la interfaz consume el núcleo (mergeOficiales/buildAcumulado) y carga primero el núcleo', () => {
    expect(uiSource).toContain('Core.mergeOficiales(Core.aggregateResumen(resumenRows)');
    expect(uiSource).toContain('Core.buildAcumulado(aggregated)');
    expect(uiSource).toContain('Core.aggregateAerolinea(');
    expect(uiSource).toContain('Core.computeOccupancyFactors(');
    expect(indexSource.indexOf('js/estadistico-informe-core.js'))
      .toBeLessThan(indexSource.indexOf('js/estadistico-informe.js'));
  });
});
