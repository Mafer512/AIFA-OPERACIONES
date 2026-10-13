/**
 * @jest-environment jsdom
 *
 * Oficios a la Subsecretaría y mensaje del SWEAR: los acumulados como los del
 * oficio oficial, y que todo cuadre desde el 01/10/2026.
 *
 * Caso real (06/10/2026): el mensaje de la app decía año 1,424,218 pasajeros
 * (la base no tiene enero a julio de 2026 ni los años anteriores), carga del
 * mes 7,541 t / 331 ops y del día 39 ops; el oficial, 5,759,386 pasajeros,
 * 7,536 t / 251 ops y 38 ops. El oficial:
 *   · lleva cada acumulado como suma corrida (el de ayer más el dato del día),
 *     con las toneladas del día ya en enteros;
 *   · desde el cierre del 14/09/2026 no cuenta las operaciones de las mixtas;
 *   · arrastra lo ya enviado, aunque el libro se haya corregido después (el
 *     01/10 se envió 1,443 t y el libro hoy da 1,448).
 * La app parte del saldo oficial del 30/09/2026 y lleva el dato enviado de los
 * días de octubre que cambiaron (js/conci-saldos-oficio.js).
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = archivo => fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8');

function cargar(archivos) {
  const arranques = [];
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, o) => {
    if (tipo === 'DOMContentLoaded') { arranques.push(fn); return; }
    registrar(tipo, fn, o);
  });
  for (const a of archivos) new Function(leer(a))();
  espia.mockRestore();
  arranques.forEach(fn => fn());
}

const COLUMNAS = {
  cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO', operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA', pax: 'TOTAL PAX', esCargaReportado: 'cierre_es_carga_reportado',
  aerolineaReportada: 'cierre_aerolinea_reportada',
};
const pax = o => ({
  'CIERRE SUBSECRETARIA': o.cierre, 'FECHA': o.fecha || o.cierre, 'TIPO DE MANIFIESTO': o.tipo || 'LLEGADA',
  'TIPO DE OPERACIÓN': o.op || 'NACIONAL', 'AEROLINEA': o.aerolinea || 'VB', 'TOTAL PAX': o.pax,
  'KGS. DE CARGA NACIONAL': 0, 'KGS. DE CARGA INTERNACIONAL': 0, 'KG DE CARGA TOTAL': 0,
  cierre_es_carga_reportado: false, cierre_aerolinea_reportada: o.reportada || 'VIVA AEROBUS',
});
const carga = o => ({
  'CIERRE SUBSECRETARIA': o.cierre, 'FECHA': o.fecha || o.cierre, 'TIPO DE MANIFIESTO': o.tipo || 'LLEGADA',
  'TIPO DE OPERACIÓN': o.op || 'INTERNACIONAL', 'AEROLINEA': o.aerolinea || 'M7', 'TOTAL PAX': 0,
  'KGS. DE CARGA NACIONAL': o.nac || 0, 'KGS. DE CARGA INTERNACIONAL': o.int || 0,
  'KG DE CARGA TOTAL': (o.nac || 0) + (o.int || 0),
  cierre_es_carga_reportado: true, cierre_aerolinea_reportada: o.reportada || 'MAS DE CARGA',
});

// Un día del oficio con sus cifras: tantos manifiestos como operaciones; el
// primero de cada lado lleva los pasajeros (o kilos) del lado.
function diaPax(cierre, [paxNac, paxInt], [opsNac, opsInt]) {
  const filas = [];
  for (let i = 0; i < opsNac; i++) filas.push(pax({ cierre, pax: i ? 0 : paxNac }));
  for (let i = 0; i < opsInt; i++) filas.push(pax({ cierre, op: 'INTERNACIONAL', pax: i ? 0 : paxInt }));
  return filas;
}
function diaCarga(cierre, [kgNac, kgInt], [opsNac, opsInt]) {
  const filas = [];
  for (let i = 0; i < opsNac; i++) filas.push(carga({ cierre, op: 'NACIONAL', nac: i ? 0 : kgNac }));
  for (let i = 0; i < opsInt; i++) filas.push(carga({ cierre, int: i ? 0 : kgInt }));
  return filas;
}

describe('carga: el oficio como el oficial', () => {
  let C;
  beforeAll(() => {
    delete window.ConciSaldosOficio;
    cargar(['conci-carga-catalogo.js', 'conci-presentacion-carga.js', 'conci-reportes-carga.js']);
    C = window.conciReportesCarga;
  });
  const agregar = (filas, fecha) => C.agregar({ filas, columnas: C.columnas(filas[0]) }, fecha);

  test('las mixtas dejan de contar como operación desde el cierre del 14/09/2026; sus kilos siempre', () => {
    const filas = [
      carga({ cierre: '13/09/2026', reportada: 'VOLARIS', aerolinea: 'Y4', op: 'NACIONAL', nac: 1000 }),
      carga({ cierre: '14/09/2026', reportada: 'VOLARIS', aerolinea: 'Y4', op: 'NACIONAL', nac: 1000 }),
      carga({ cierre: '14/09/2026', reportada: 'MAS DE CARGA', int: 5000 }),
    ];
    const r = agregar(filas, '2026-09-14');
    expect(C.totales(r.sub.actual.dia).total.ops).toBe(1);        // sólo Mas de Carga
    expect(C.totales(r.sub.anterior.dia).total.ops).toBe(1);      // el 13/09 Volaris sí contaba
    expect(C.totales(r.sub.actual.mes).total.ops).toBe(2);
    expect(C.toneladas(r.sub.actual.dia).enteras.total).toBe(6);  // los kilos de Volaris sí
  });

  test('las toneladas acumuladas son la suma de las de cada día ya en enteros, como el oficio', () => {
    const filas = [carga({ cierre: '01/10/2026', int: 600 }), carga({ cierre: '02/10/2026', int: 600 })];
    const r = agregar(filas, '2026-10-02');
    expect(C.toneladas(r.sub.actual.dia).enteras.total).toBe(1);
    expect(C.toneladas(r.sub.actual.mes).enteras.total).toBe(2);  // 1 + 1, no round(1.2)
  });

  test('el Reporte de Carga y la Hoja 1 siguen con lo cerrado hasta la fecha pedida', () => {
    const filas = [
      carga({ cierre: '30/09/2026', fecha: '30/09/2026', int: 1000 }),
      carga({ cierre: '01/10/2026', fecha: '30/09/2026', int: 9000 }),
    ];
    const r = agregar(filas, '2026-09-30');
    expect(r.porMes[8].impKg).toBe(1000);
    expect(r.anioActual.kg).toBe(1000);
  });
});

describe('saldo oficial del 30/09/2026 y datos enviados: todo cuadra desde el 01/10/2026', () => {
  let P, C, M, S;
  beforeAll(() => {
    cargar(['conci-saldos-oficio.js', 'conci-reportes-pasajeros.js', 'conci-carga-catalogo.js',
      'conci-presentacion-carga.js', 'conci-reportes-carga.js', 'conci-mensaje-envio.js']);
    P = window.conciReportesPasajeros;
    C = window.conciReportesCarga;
    M = window.conciMensajeEnvio;
    S = window.ConciSaldosOficio;
  });
  afterAll(() => { delete window.ConciSaldosOficio; });

  // Octubre tal como lo tiene hoy la base: pasajeros iguales a lo enviado;
  // carga del 01/10 y 02/10 corregida en el libro después de enviarse.
  const OCTUBRE = [
    ...diaPax('01/10/2026', [10034, 1271], [80, 9]),
    ...diaPax('02/10/2026', [20771, 1223], [163, 13]),
    ...diaPax('03/10/2026', [24184, 1749], [168, 12]),
    ...diaPax('04/10/2026', [16441, 1420], [109, 10]),
    ...diaPax('05/10/2026', [22822, 1603], [165, 12]),
    ...diaPax('06/10/2026', [17251, 861], [138, 6]),
    ...diaCarga('01/10/2026', [48000, 1400000], [9, 41]),    // el libro hoy (se envió 47 / 1,396)
    ...diaCarga('02/10/2026', [25000, 1250000], [4, 36]),    // el libro hoy (se envió 28 / 1,247; 5 / 35)
    ...diaCarga('03/10/2026', [18000, 1433000], [3, 38]),
    ...diaCarga('04/10/2026', [34000, 1064000], [2, 28]),
    ...diaCarga('05/10/2026', [106000, 1437000], [13, 39]),
    ...diaCarga('06/10/2026', [45000, 681000], [11, 27]),
  ];
  const mensaje = fecha => M.componer(M.calcular({ filas: OCTUBRE, columnas: COLUMNAS }, C.columnas(OCTUBRE[0]), fecha));

  test('el saldo es el del oficio del 30/09/2026 y lleva lo enviado el 01 y 02/10', () => {
    expect(S.fecha).toBe('2026-09-30');
    expect(S.pasajeros.anio.pax.total).toBe(5639756);
    expect(S.carga.anio.ton.total).toBe(312620);
    expect(S.enviados.carga['2026-10-01'].ton.total).toBe(1443);
  });

  test('el mensaje del 06/10/2026 sale idéntico al oficial (salvo el porcentaje contra 2025)', () => {
    const texto = mensaje('2026-10-06');
    [
      'a.\tPasajeros: 18,112 (17,251 Nacionales, 861 Internacionales).',
      'b.\tOperaciones: 144 (138 Nacionales, 6 Internacionales).',
      'c. Carga: 726 (45 Nacionales, 681 Internacionales).',
      'd. Operaciones: 38 (11 Nacionales, 27 Internacionales).',
      'a. Pasajeros: 119,630 (111,503 Nacionales, 8,127 Internacionales).',
      'b. Operaciones: 885 (823 Nacionales, 62 Internacionales).',
      'c. Carga: 7,536 (278 Nacionales, 7,258 Internacionales).',
      'd. Operaciones: 251 (43 Nacionales, 208 Internacionales).',
      'a. Pasajeros: 5,759,386 (5,452,773 Nacionales, 306,613 Internacionales).',
      'b. Operaciones: 43,102 (40,765 Nacionales, 2,337 Internacionales).',
      'c. Carga: 320,156 (6,320 Nacionales, 313,836 Internacionales).',
      'd. Operaciones: 12,119 (2,805 Nacionales, 9,314 Internacionales).',
      'a. Pasajeros: 22,679,934 (21,363,802 Nacionales, 1,316,132 Internacionales).',
      'b. Operaciones: 179,651 (167,943 Nacionales, 11,708 Internacionales).',
      'c. Carga: 1,359,559 (44,669 Nacionales, 1,314,890 Internacionales).',
      'd. Operaciones: 44,330 (4,569 Nacionales, 39,761 Internacionales).',
    ].forEach(renglon => expect(texto).toContain(renglon));
  });

  test('el del 01/10/2026 lleva lo enviado ese día (1,443 t), no lo que hoy dice el libro', () => {
    const texto = mensaje('2026-10-01');
    expect(texto).toContain('c. Carga: 1,443 (47 Nacionales, 1,396 Internacionales).');
    expect(texto).toContain('d. Operaciones: 50 (9 Nacionales, 41 Internacionales).');
    // Año: 312,620 + 1,443; operaciones 11,868 + 50.
    expect(texto).toContain('c. Carga: 314,063 (6,089 Nacionales, 307,974 Internacionales).');
    expect(texto).toContain('d. Operaciones: 11,918 (2,771 Nacionales, 9,147 Internacionales).');
    expect(texto).toContain('a. Pasajeros: 5,651,061 (5,351,304 Nacionales, 299,757 Internacionales).');
  });

  test('el del 02/10/2026: el reparto enviado y el mes 2,718 t / 90 ops', () => {
    const texto = mensaje('2026-10-02');
    expect(texto).toContain('c. Carga: 1,275 (28 Nacionales, 1,247 Internacionales).');
    expect(texto).toContain('d. Operaciones: 40 (5 Nacionales, 35 Internacionales).');
    expect(texto).toContain('c. Carga: 2,718 (75 Nacionales, 2,643 Internacionales).');
    expect(texto).toContain('d. Operaciones: 90 (14 Nacionales, 76 Internacionales).');
  });

  test('un día nuevo se suma al saldo con la regla del oficio', () => {
    const filas = [...OCTUBRE, ...diaCarga('07/10/2026', [10000, 990000], [1, 30]), ...diaPax('07/10/2026', [20000, 1000], [150, 10])];
    const texto = M.componer(M.calcular({ filas, columnas: COLUMNAS }, C.columnas(filas[0]), '2026-10-07'));
    expect(texto).toContain('c. Carga: 321,156 (6,330 Nacionales, 314,826 Internacionales).');
    expect(texto).toContain('d. Operaciones: 12,150 (2,806 Nacionales, 9,344 Internacionales).');
    expect(texto).toContain('a. Pasajeros: 5,780,386 (5,472,773 Nacionales, 307,613 Internacionales).');
  });

  test('la variación contra 2025 sale del libro "VARIACION 2025-2026", ya no "sin dato"', () => {
    const S = window.ConciSaldosOficio;
    // Los acumulados 2025 de la tabla del libro.
    expect(S.acumuladoAnioAnterior('2025-10-01')).toEqual({ pax: 5171399, ton: 293940 });
    expect(S.acumuladoAnioAnterior('2025-10-04')).toEqual({ pax: 5223905, ton: 297292 });
    expect(S.acumuladoAnioAnterior('2025-10-31')).toEqual({ pax: 5739945, ton: 329972 });
    expect(S.acumuladoAnioAnterior('2025-01-07')).toEqual({ pax: 145168, ton: 5105 });
    expect(S.acumuladoAnioAnterior('2025-03-01')).toEqual({ pax: 1071347, ton: 55328 });
    // Sin los días de ese mes no se inventa.
    expect(S.acumuladoAnioAnterior('2025-02-14')).toBeNull();
    expect(S.acumuladoAnioAnterior('2025-11-01')).toBeNull();
    // 06/10/2026: 5,759,386 vs 5,262,647 y 320,156 t vs 299,576 t.
    const texto = mensaje('2026-10-06');
    expect(texto).toContain('5,759,386 (⬆️ 9.44%)');
    expect(texto).toContain('320,156 (⬆️ 6.87%)');
    expect(texto).not.toContain('sin dato');
  });

  test('el oficio de pasajeros (Reportes) da lo mismo que el mensaje', () => {
    const r = P.agregar({ filas: OCTUBRE, columnas: COLUMNAS }, '2026-10-06').sub.actual.anio;
    const suma = lado => r.LLEGADA[lado].pax + r.SALIDA[lado].pax;
    expect(suma('NACIONAL') + suma('INTERNACIONAL')).toBe(5759386);
  });
});
