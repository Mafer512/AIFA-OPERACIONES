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

  test('un día nuevo, después del último oficio registrado (20/10), se suma a ése', () => {
    const filas = [...OCTUBRE, ...diaCarga('21/10/2026', [10000, 990000], [1, 30]), ...diaPax('21/10/2026', [20000, 1000], [150, 10])];
    const texto = M.componer(M.calcular({ filas, columnas: COLUMNAS }, C.columnas(filas[0]), '2026-10-21'));
    expect(texto).toContain('a.	Pasajeros: 21,000 (20,000 Nacionales, 1,000 Internacionales).');
    expect(texto).toContain('a. Pasajeros: 419,088 (390,772 Nacionales, 28,316 Internacionales).');      // mes: 398,088 + 21,000
    expect(texto).toContain('a. Pasajeros: 6,069,203 (5,741,001 Nacionales, 328,202 Internacionales).');
    expect(texto).toContain('c. Carga: 339,057 (6,833 Nacionales, 332,224 Internacionales).');           // año: 338,057 + 1,000
    expect(texto).toContain('d. Operaciones: 12,708 (2,875 Nacionales, 9,833 Internacionales).');
  });

  test('la variación contra 2025 sale del libro "VARIACION 2025-2026", ya no "sin dato"', () => {
    const S = window.ConciSaldosOficio;
    // Los acumulados 2025 de la tabla del libro.
    expect(S.acumuladoAnioAnterior('2025-10-01')).toMatchObject({ pax: 5171399, ton: 293940 });
    expect(S.acumuladoAnioAnterior('2025-10-04')).toMatchObject({ pax: 5223905, ton: 297292 });
    expect(S.acumuladoAnioAnterior('2025-10-31')).toMatchObject({ pax: 5739945, ton: 329972 });
    expect(S.acumuladoAnioAnterior('2025-01-07')).toMatchObject({ pax: 145168, ton: 5105 });
    expect(S.acumuladoAnioAnterior('2025-03-01')).toMatchObject({ pax: 1071347, ton: 55328 });
    // Sin los días de ese mes no se inventa.
    expect(S.acumuladoAnioAnterior('2025-02-14')).toBeNull();
    expect(S.acumuladoAnioAnterior('2025-11-01')).toBeNull();
    // 06/10/2026: 5,759,386 vs 5,262,647 y 320,156 t vs 299,576 t.
    const texto = mensaje('2026-10-06');
    expect(texto).toContain('5,759,386 (⬆️ 9.44%)');
    expect(texto).toContain('320,156 (⬆️ 6.87%)');
    expect(texto).not.toContain('sin dato');
  });

  // Octubre: el libro corrigió el mes a mano (quitó los vuelos de septiembre
  // cerrados en octubre: la carga el 05/10, los pasajeros el 12/10) y varios
  // días cambiaron después de enviarse. Cada oficio de octubre está registrado
  // tal como se envió, también el dato del día.
  const mensajeCon = (filas, fecha) => M.componer(M.calcular({ filas, columnas: COLUMNAS }, C.columnas(filas[0]), fecha));
  // Lo que hoy da la base esos días (distinto de lo enviado).
  const BASE_HOY = [
    ...diaPax('15/10/2026', [19652, 1191], [157, 8]),           // se enviaron 19,647 nacionales
    ...diaCarga('15/10/2026', [43270, 1836340], [7, 57]),
    ...diaPax('18/10/2026', [13960, 1167], [97, 11]),
    ...diaCarga('18/10/2026', [0, 1533220], [1, 35]),            // se enviaron 1,558 t
    ...diaPax('19/10/2026', [19667, 1124], [146, 8]),            // se enviaron 1,123 internacionales
    ...diaCarga('19/10/2026', [14860, 1811070], [7, 47]),        // se enviaron 1,801 t
  ];

  test('cada oficio de octubre está registrado; una fecha usa el más reciente', () => {
    expect(S.cortes[0].fecha).toBe('2026-09-30');
    expect(S.cortes.map(c => c.fecha).slice(1)).toEqual(Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
    expect(S.vigente('2026-10-17').fecha).toBe('2026-10-17');
    expect(S.vigente('2026-11-02').fecha).toBe('2026-10-20');
    expect(S.vigente('2026-08-15').fecha).toBe('2026-09-30');
  });

  // Los mensajes enviados (copiados del SWEAR), renglón por renglón.
  const ENVIADOS = {
    // El libro editó después este bloque de carga (305 t / 12 ops); se envió esto.
    '2026-10-05': [
      'c. Carga: 1,543 (106 Nacionales, 1,437 Internacionales).',
      'd. Operaciones: 52 (13 Nacionales, 39 Internacionales).',
      'c. Carga: 6,810 (233 Nacionales, 6,577 Internacionales).',
      'd. Operaciones: 213 (32 Nacionales, 181 Internacionales).',
      'c. Carga: 319,430 (6,275 Nacionales, 313,155 Internacionales).',
      '5,741,274 (⬆️ 9.50%)', '319,430 (⬆️ 7.13%)',
    ],
    // El ajuste del 12/10: el mes ya sin los vuelos de septiembre.
    '2026-10-12': [
      'a.\tPasajeros: 24,511 (22,823 Nacionales, 1,688 Internacionales).',
      'a. Pasajeros: 231,613 (215,202 Nacionales, 16,411 Internacionales).',
      'c. Carga: 13,189 (469 Nacionales, 12,720 Internacionales).',
      'a. Pasajeros: 5,881,728 (5,565,431 Nacionales, 316,297 Internacionales).',
      'c. Carga: 327,048 (6,563 Nacionales, 320,485 Internacionales).',
      '5,881,728 (⬆️ 9.54%)', '327,048 (⬆️ 6.85%)',
    ],
    // El porcentaje de carga sale de las toneladas 2025 sin redondear (6.87, no 6.88).
    '2026-10-16': [
      'c. Carga: 18,362 (583 Nacionales, 17,779 Internacionales).',
      'd. Operaciones: 595 (80 Nacionales, 515 Internacionales).',
      '5,959,349 (⬆️ 9.47%)', '332,221 (⬆️ 6.87%)',
    ],
    '2026-10-15': [
      'a.	Pasajeros: 20,838 (19,647 Nacionales, 1,191 Internacionales).',
      'c. Carga: 1,880 (39 Nacionales, 1,841 Internacionales).',
      'a. Pasajeros: 286,720 (266,268 Nacionales, 20,452 Internacionales).',
      'b. Operaciones: 2,128 (1,984 Nacionales, 144 Internacionales).',
      'c. Carga: 16,994 (575 Nacionales, 16,419 Internacionales).',
      'd. Operaciones: 557 (80 Nacionales, 477 Internacionales).',
      'a. Pasajeros: 5,936,835 (5,616,497 Nacionales, 320,338 Internacionales).',
      'c. Carga: 330,853 (6,669 Nacionales, 324,184 Internacionales).',
      'a. Pasajeros: 22,857,383 (21,527,526 Nacionales, 1,329,857 Internacionales).',
      'c. Carga: 1,370,256 (45,018 Nacionales, 1,325,238 Internacionales).',
      '5,936,835 (⬆️ 9.45%)', '330,853 (⬆️ 6.92%)',
    ],
    '2026-10-18': [
      'a.	Pasajeros: 15,127 (13,960 Nacionales, 1,167 Internacionales).',
      'b.	Operaciones: 108 (97 Nacionales, 11 Internacionales).',
      'c. Carga: 1,558 (0 Nacionales, 1,558 Internacionales).',
      'd. Operaciones: 36 (1 Nacionales, 35 Internacionales).',
      'a. Pasajeros: 353,184 (328,611 Nacionales, 24,573 Internacionales).',
      'b. Operaciones: 2,607 (2,431 Nacionales, 176 Internacionales).',
      'c. Carga: 21,449 (699 Nacionales, 20,750 Internacionales).',
      'd. Operaciones: 681 (93 Nacionales, 588 Internacionales).',
      'a. Pasajeros: 6,003,299 (5,678,840 Nacionales, 324,459 Internacionales).',
      'b. Operaciones: 44,911 (42,446 Nacionales, 2,465 Internacionales).',
      'c. Carga: 335,308 (6,793 Nacionales, 328,515 Internacionales).',
      'd. Operaciones: 12,589 (2,864 Nacionales, 9,725 Internacionales).',
      'a. Pasajeros: 22,923,847 (21,589,869 Nacionales, 1,333,978 Internacionales).',
      'b. Operaciones: 181,460 (169,624 Nacionales, 11,836 Internacionales).',
      'c. Carga: 1,374,711 (45,142 Nacionales, 1,329,569 Internacionales).',
      'd. Operaciones: 44,800 (4,628 Nacionales, 40,172 Internacionales).',
      '6,003,299 (⬆️ 9.53%)', '335,308 (⬆️ 7.15%)',
    ],
    '2026-10-19': [
      'a.	Pasajeros: 20,790 (19,667 Nacionales, 1,123 Internacionales).',
      'c. Carga: 1,801 (15 Nacionales, 1,786 Internacionales).',
      'a. Pasajeros: 373,974 (348,278 Nacionales, 25,696 Internacionales).',
      'b. Operaciones: 2,761 (2,577 Nacionales, 184 Internacionales).',
      'c. Carga: 23,250 (714 Nacionales, 22,536 Internacionales).',
      'd. Operaciones: 735 (100 Nacionales, 635 Internacionales).',
      'a. Pasajeros: 6,024,089 (5,698,507 Nacionales, 325,582 Internacionales).',
      'c. Carga: 337,109 (6,808 Nacionales, 330,301 Internacionales).',
      'a. Pasajeros: 22,944,637 (21,609,536 Nacionales, 1,335,101 Internacionales).',
      'c. Carga: 1,376,512 (45,157 Nacionales, 1,331,355 Internacionales).',
      '6,024,089 (⬆️ 9.49%)', '337,109 (⬆️ 7.37%)',
    ],
  };
  // 20/10: el día lleva ajustes que DATA no trae (+1 pax internacional; −6 t y
  // un vuelo nacional en carga).
  ENVIADOS['2026-10-20'] = [
    'a.	Pasajeros: 24,114 (22,494 Nacionales, 1,620 Internacionales).',
    'c. Carga: 948 (15 Nacionales, 933 Internacionales).',
    'd. Operaciones: 34 (3 Nacionales, 31 Internacionales).',
    'a. Pasajeros: 398,088 (370,772 Nacionales, 27,316 Internacionales).',
    'c. Carga: 24,198 (729 Nacionales, 23,469 Internacionales).',
    'a. Pasajeros: 6,048,203 (5,721,001 Nacionales, 327,202 Internacionales).',
    'c. Carga: 338,057 (6,823 Nacionales, 331,234 Internacionales).',
    'd. Operaciones: 44,888 (4,638 Nacionales, 40,250 Internacionales).',
    '6,048,203 (⬆️ 9.52%)', '338,057 (⬆️ 7.15%)',
  ];
  test.each(Object.keys(ENVIADOS))('el mensaje del %s sale igual al enviado', fecha => {
    const texto = mensajeCon([...OCTUBRE, ...BASE_HOY], fecha);
    ENVIADOS[fecha].forEach(renglon => expect(texto).toContain(renglon));
  });

  test('el oficio de pasajeros (Reportes) da lo mismo que el mensaje', () => {
    const r = P.agregar({ filas: OCTUBRE, columnas: COLUMNAS }, '2026-10-06').sub.actual.anio;
    const suma = lado => r.LLEGADA[lado].pax + r.SALIDA[lado].pax;
    expect(suma('NACIONAL') + suma('INTERNACIONAL')).toBe(5759386);
  });
});
