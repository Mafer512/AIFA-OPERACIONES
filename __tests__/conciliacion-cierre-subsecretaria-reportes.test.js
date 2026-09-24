/**
 * @jest-environment jsdom
 *
 * Cierre de Subsecretaría — ARITMÉTICA de los informes con ajustes aplicados.
 *
 * Estas pruebas no miran el texto de la migración: construyen el DATASET que
 * v_conciliacion_manifiestos_reportable devuelve y comprueban los números que
 * salen. Son la contraparte funcional de las guardas estáticas de
 * conciliacion-cierre-subsecretaria-sql.test.js.
 *
 * El contrato de la vista, que es lo que aquí se simula:
 *   · fila normal (legacy, abierta o cerrada)  → _signo +1;
 *   · ajuste aplicado                          → DOS filas, _signo −1 con los
 *     valores ANTES y _signo +1 con los de DESPUÉS, ambas con "CIERRE
 *     SUBSECRETARIA" = fecha del corte QUE LAS APLICÓ y con la "FECHA" de
 *     operación ORIGINAL intacta.
 *
 * Lo que se fija:
 *   1. el informe de un día ya cerrado NO cambia al regenerarlo;
 *   2. el +30 de una corrección aparece en el informe del corte siguiente;
 *   3. una corrección numérica NO inventa una operación;
 *   4. una reclasificación mueve pasajeros Y operación de un bucket al otro,
 *      con neto total cero;
 *   5. lo mismo para carga (nacional / internacional / total);
 *   6. los acumulados (mes, año, histórico) cuadran;
 *   7. y —esto es lo que separa los dos usos— las filas sintéticas de ajuste
 *      alimentan SÓLO el oficio de SUBSECRETARÍA, que se agrupa por CIERRE
 *      SUBSECRETARIA. Los reportes que se agrupan por FECHA (Plantilla 1,
 *      Plantilla 2, Hoja 1, Hoja 2, Reporte de Carga, presentación) NO se
 *      recalculan: una corrección posterior no puede reescribir el informe de
 *      un día que ya se reportó.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const modPax = fs.readFileSync(path.join(raiz, 'js', 'conci-reportes-pasajeros.js'), 'utf8');
const MODS_CARGA = ['conci-carga-catalogo.js', 'conci-presentacion-carga.js', 'conci-reportes-carga.js']
  .map(f => fs.readFileSync(path.join(raiz, 'js', f), 'utf8'));

/** Evalúa los módulos quedándose solo con los arranques de esta evaluación. */
function cargar(fuentes) {
  const arranques = [];
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener')
    .mockImplementation((tipo, fn, opciones) => {
      if (tipo === 'DOMContentLoaded') { arranques.push(fn); return; }
      registrar(tipo, fn, opciones);
    });
  for (const src of fuentes) new Function(src)();
  espia.mockRestore();
  arranques.forEach(fn => fn());
}

/* ── Las columnas TAL COMO las detecta cada módulo sobre la vista ───────── */

const COLUMNAS_PAX = {
  cierre: 'CIERRE SUBSECRETARIA',
  fecha: 'FECHA',
  tipo: 'TIPO DE MANIFIESTO',
  operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA',
  pax: 'TOTAL PAX',
  portal: '_portal_flight_date',
  signo: '_signo',
  esAjuste: '_es_ajuste',
  uid: '_uid'
};

const COLUMNAS_CARGA = {
  cierre: 'CIERRE SUBSECRETARIA',
  fecha: 'FECHA',
  tipo: 'TIPO DE MANIFIESTO',
  operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA',
  cargaNac: 'KGS. DE CARGA NACIONAL',
  cargaInt: 'KGS. DE CARGA INTERNACIONAL',
  cargaTotal: 'KG DE CARGA TOTAL',
  portal: '_portal_flight_date',
  signo: '_signo',
  esAjuste: '_es_ajuste',
  uid: '_uid'
};

let _uid = 0;
const uid = (p) => `${p}${String(++_uid).padStart(6, '0')}`;

/** Fila normal de la vista (legacy, abierta o cerrada desde snapshot). */
function fila(campos) {
  return {
    'CIERRE SUBSECRETARIA': campos.cierre ?? campos.fecha,
    'FECHA': campos.fecha,
    'TIPO DE MANIFIESTO': campos.tipo ?? 'LLEGADA',
    'TIPO DE OPERACIÓN': 'operacion' in campos ? campos.operacion : 'NACIONAL',
    'AEROLINEA': 'aerolinea' in campos ? campos.aerolinea : 'VIVA AEROBUS',
    'TOTAL PAX': campos.pax ?? 0,
    'KGS. DE CARGA NACIONAL': campos.nac ?? 0,
    'KGS. DE CARGA INTERNACIONAL': campos.int ?? 0,
    'KG DE CARGA TOTAL': campos.total ?? 0,
    '_portal_flight_date': campos.fecha,
    '_es_ajuste': false,
    '_signo': 1,
    '_uid': uid('M')
  };
}

/**
 * Las DOS contribuciones de un ajuste aplicado, tal como las produce la vista.
 * `antes` y `despues` son los campos de la fila antes y después de corregirla;
 * `aplicadoEn` es la fecha del corte que consumió el evento — y por tanto la
 * "CIERRE SUBSECRETARIA" de ambas contribuciones. La FECHA de operación se
 * conserva tal cual estaba.
 */
function ajuste({ antes, despues, aplicadoEn }) {
  const n = ++_uid;
  return [
    { ...fila(antes), 'CIERRE SUBSECRETARIA': aplicadoEn, '_es_ajuste': true, '_signo': -1, '_uid': `X${n}A` },
    { ...fila(despues), 'CIERRE SUBSECRETARIA': aplicadoEn, '_es_ajuste': true, '_signo': 1, '_uid': `X${n}D` }
  ];
}

const DIA_A = '2026-09-01';
const DIA_B = '2026-09-02';

/* ═══════════════════════════════════════════════════════════════════════ */

describe('PASAJEROS — corrección numérica: 150 → 180 aplicada en el corte siguiente', () => {
  let api;

  beforeEach(() => {
    _uid = 0;
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    delete window._conciRowIsCargo;
    cargar([modPax]);
    api = window.conciReportesPasajeros;
  });

  /**
   * Día A: un manifiesto de 150 PAX, cerrado en el corte del día A.
   * Día B: otro manifiesto de 1000 PAX, cerrado en el corte del día B.
   * En el día B se autoriza la corrección 150 → 180 del manifiesto del día A,
   * y el corte del día B la consume.
   */
  const DATOS = () => [
    fila({ fecha: DIA_A, cierre: DIA_A, pax: 150 }),
    fila({ fecha: DIA_B, cierre: DIA_B, pax: 1000 }),
    ...ajuste({
      antes: { fecha: DIA_A, pax: 150 },
      despues: { fecha: DIA_A, pax: 180 },
      aplicadoEn: DIA_B
    })
  ];

  const agregar = (fechaIso) => api.agregar({ filas: DATOS(), columnas: COLUMNAS_PAX }, fechaIso);

  test('el informe del día A regenerado sigue diciendo 150: el histórico no se reescribe', () => {
    const r = agregar(DIA_A);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.pax).toBe(150);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.ops).toBe(1);
  });

  test('el informe del día B incluye el +30: 1000 + 30 = 1030', () => {
    const r = agregar(DIA_B);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.pax).toBe(1030);
  });

  test('una corrección numérica NO aumenta el número de operaciones del día B', () => {
    const r = agregar(DIA_B);
    // Un solo manifiesto nuevo (+1) y el par del ajuste (−1 +1) = 1.
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.ops).toBe(1);
  });

  test('el acumulado del mes es 1180 = 150 + 1000 + 30, con 2 operaciones', () => {
    const r = agregar(DIA_B);
    expect(r.sub.actual.mes.LLEGADA.NACIONAL.pax).toBe(1180);
    expect(r.sub.actual.mes.LLEGADA.NACIONAL.ops).toBe(2);
  });

  test('la columna del día anterior del oficio del día B sigue mostrando 150', () => {
    const r = agregar(DIA_B);
    expect(r.cierres.anterior).toBe(DIA_A);
    expect(r.sub.anterior.dia.LLEGADA.NACIONAL.pax).toBe(150);
    expect(r.sub.anterior.dia.LLEGADA.NACIONAL.ops).toBe(1);
  });

  test('los acumulados del año y del histórico también cuadran', () => {
    const r = agregar(DIA_B);
    expect(r.sub.actual.anio.LLEGADA.NACIONAL.pax).toBe(1180);
    expect(r.sub.actual.historico.LLEGADA.NACIONAL.pax).toBe(1180);
  });

  test('LA PLANTILLA DEL DÍA A REGENERADA DESPUÉS SIGUE EN 150, no 180', () => {
    // El caso que da sentido a todo esto: el informe por FECHA del día A ya se
    // entregó con 150. Regenerarlo después de la corrección debe dar 150 otra
    // vez, o el reporte histórico dejaría de coincidir con el entregado.
    const rA = agregar(DIA_A);
    expect(rA.porDia[0].pax.llegada).toBe(150);
    expect(rA.porDia[0].ops.llegada).toBe(1);
    expect(rA.porAerolinea.dia.get('VIVA AEROBUS').pax).toBe(150);

    // Y tampoco cambia al regenerarlo desde el día B: el renglón del 1 de
    // septiembre sigue en 150, no en 180.
    const rB = agregar(DIA_B);
    expect(rB.porDia[0].pax.llegada).toBe(150);
    expect(rB.porDia[0].ops.llegada).toBe(1);
    expect(rB.porDia[1].pax.llegada).toBe(1000);
    expect(rB.porDia[1].ops.llegada).toBe(1);
  });

  test('Plantilla 1 por aerolínea: el mes suma 1150 PAX y 2 operaciones (sin el ajuste)', () => {
    // 150 del día A + 1000 del día B. El +30 vive en el oficio de
    // Subsecretaría del corte B, no aquí.
    const r = agregar(DIA_B);
    const viva = r.porAerolinea.mes.get('VIVA AEROBUS');
    expect(viva.pax).toBe(1150);
    expect(viva.ops).toBe(2);
  });

  test('el promedio anual de la Plantilla 2 tampoco se recalcula con el ajuste', () => {
    const r = agregar(DIA_B);
    expect(r.anioPlantillas.pax).toBe(1150);
    expect(r.anioPlantillas.ops).toBe(2);
  });

  test('las dos matemáticas conviven: SUBSECRETARÍA 1030 el día B, plantillas 1150 en el mes', () => {
    // Misma descarga, mismos datos, dos agrupaciones distintas y ambas
    // correctas bajo su propia lógica.
    const r = agregar(DIA_B);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.pax).toBe(1030);
    expect(r.sub.actual.mes.LLEGADA.NACIONAL.pax).toBe(1180);
    expect(r.porAerolinea.mes.get('VIVA AEROBUS').pax).toBe(1150);
  });
});

describe('PASAJEROS — reclasificación NACIONAL → INTERNACIONAL', () => {
  let api;

  beforeEach(() => {
    _uid = 0;
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    delete window._conciRowIsCargo;
    cargar([modPax]);
    api = window.conciReportesPasajeros;
  });

  // Día A: 150 PAX NACIONAL. En el día B se reclasifica a INTERNACIONAL sin
  // tocar el número de pasajeros.
  const DATOS = () => [
    fila({ fecha: DIA_A, cierre: DIA_A, pax: 150, operacion: 'NACIONAL' }),
    ...ajuste({
      antes: { fecha: DIA_A, pax: 150, operacion: 'NACIONAL' },
      despues: { fecha: DIA_A, pax: 150, operacion: 'INTERNACIONAL' },
      aplicadoEn: DIA_B
    })
  ];

  const agregar = (fechaIso) => api.agregar({ filas: DATOS(), columnas: COLUMNAS_PAX }, fechaIso);

  test('el informe del día A no cambia: NACIONAL 150, 1 operación', () => {
    const dia = agregar(DIA_A).sub.actual.dia;
    expect(dia.LLEGADA.NACIONAL).toEqual({ pax: 150, ops: 1 });
    expect(dia.LLEGADA.INTERNACIONAL).toEqual({ pax: 0, ops: 0 });
  });

  test('el informe del día B lleva el efecto: −150 NACIONAL, +150 INTERNACIONAL', () => {
    const dia = agregar(DIA_B).sub.actual.dia;
    expect(dia.LLEGADA.NACIONAL.pax).toBe(-150);
    expect(dia.LLEGADA.INTERNACIONAL.pax).toBe(150);
  });

  test('y la operación se mueve de bucket: −1 NACIONAL, +1 INTERNACIONAL', () => {
    const dia = agregar(DIA_B).sub.actual.dia;
    expect(dia.LLEGADA.NACIONAL.ops).toBe(-1);
    expect(dia.LLEGADA.INTERNACIONAL.ops).toBe(1);
  });

  test('el neto del día B es cero en pasajeros y en operaciones', () => {
    const dia = agregar(DIA_B).sub.actual.dia;
    const pax = dia.LLEGADA.NACIONAL.pax + dia.LLEGADA.INTERNACIONAL.pax;
    const ops = dia.LLEGADA.NACIONAL.ops + dia.LLEGADA.INTERNACIONAL.ops;
    expect(pax).toBe(0);
    expect(ops).toBe(0);
  });

  test('el acumulado del mes queda con la distribución corregida: 0 nacional, 150 internacional', () => {
    const mes = agregar(DIA_B).sub.actual.mes;
    expect(mes.LLEGADA.NACIONAL).toEqual({ pax: 0, ops: 0 });
    expect(mes.LLEGADA.INTERNACIONAL).toEqual({ pax: 150, ops: 1 });
  });
});

describe('PASAJEROS — reclasificación de AEROLINEA', () => {
  let api;

  beforeEach(() => {
    _uid = 0;
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    delete window._conciRowIsCargo;
    delete window._conciResolveAirlineMeta;
    cargar([modPax]);
    api = window.conciReportesPasajeros;
  });

  const DATOS = () => [
    fila({ fecha: DIA_A, cierre: DIA_A, pax: 150, aerolinea: 'VIVA AEROBUS' }),
    ...ajuste({
      antes: { fecha: DIA_A, pax: 150, aerolinea: 'VIVA AEROBUS' },
      despues: { fecha: DIA_A, pax: 150, aerolinea: 'VOLARIS' },
      aplicadoEn: DIA_B
    })
  ];

  test('la Plantilla 1 del periodo ya reportado conserva la aerolínea con la que se reportó', () => {
    // La corrección es real y queda en el expediente (fila viva + ledger),
    // pero no reescribe un informe por FECHA ya emitido.
    const r = api.agregar({ filas: DATOS(), columnas: COLUMNAS_PAX }, DIA_B);
    expect(r.porAerolinea.mes.get('VIVA AEROBUS')).toEqual(expect.objectContaining({ pax: 150, ops: 1 }));
    expect(r.porAerolinea.mes.get('VOLARIS')).toBeUndefined();
  });

  test('en el oficio de SUBSECRETARÍA del corte B la reclasificación de aerolínea neta a cero', () => {
    // El oficio cuenta la PRESENCIA de AEROLINEA, no cuál es: −1 y +1 se
    // cancelan, y los pasajeros también. Ninguna cifra se mueve por cambiar el
    // nombre de la aerolínea, que es lo correcto.
    const dia = api.agregar({ filas: DATOS(), columnas: COLUMNAS_PAX }, DIA_B).sub.actual.dia;
    expect(dia.LLEGADA.NACIONAL).toEqual({ pax: 0, ops: 0 });
  });

  test('la tabla del Excel no imprime renglones fantasma en cero neto', () => {
    const r = api.agregar({ filas: DATOS(), columnas: COLUMNAS_PAX }, DIA_B);
    const filasXls = api.filasPlantilla1(r);
    const totales = filasXls.filter(f => f[0] === 'TOTAL');
    expect(totales).toHaveLength(2);
    // "Del día" (día B) no tiene operaciones propias; el acumulado del mes sí.
    expect(totales[0]).toEqual(['TOTAL', 0, 0]);
    expect(totales[1]).toEqual(['TOTAL', 150, 1]);
    expect(filasXls.every(f => !(f[1] === 0 && f[2] === 0 && f[0] !== 'TOTAL'))).toBe(true);
  });
});

describe('CARGA — corrección numérica y reclasificación', () => {
  let api;

  beforeEach(() => {
    _uid = 0;
    document.body.innerHTML = `
      <input type="date" id="conci-rep-carga-fecha" value="${DIA_B}">
      <button id="btn-conci-rep-carga-generar"></button>
      <div id="conci-rep-carga-estado"></div>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>`;
    window._conciRowIsCargo = () => true;
    cargar(MODS_CARGA);
    api = window.conciReportesCarga;
  });

  afterEach(() => { delete window._conciRowIsCargo; delete window._conciResolveAirlineMeta; });

  const agregar = (filas, fechaIso) => api.agregar({ filas, columnas: COLUMNAS_CARGA }, fechaIso);

  test('corrección de kilos: 5000 → 6000 aparece en el corte siguiente y no crea una operación', () => {
    const datos = [
      fila({ fecha: DIA_A, cierre: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 5000 }),
      fila({ fecha: DIA_B, cierre: DIA_B, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 1000 }),
      ...ajuste({
        antes: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 5000 },
        despues: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 6000 },
        aplicadoEn: DIA_B
      })
    ];

    // Día A regenerado: intacto.
    const a = agregar(datos, DIA_A);
    expect(a.sub.actual.dia.LLEGADA.INTERNACIONAL).toEqual({ kg: 5000, ops: 1 });

    // Día B: 1000 propios + 1000 de ajuste (−5000 +6000), y UNA operación.
    const b = agregar(datos, DIA_B);
    expect(b.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(2000);
    expect(b.sub.actual.dia.LLEGADA.INTERNACIONAL.ops).toBe(1);

    // Acumulado del mes: 5000 + 1000 + 1000 = 7000, con 2 operaciones.
    expect(b.sub.actual.mes.LLEGADA.INTERNACIONAL.kg).toBe(7000);
    expect(b.sub.actual.mes.LLEGADA.INTERNACIONAL.ops).toBe(2);
  });

  test('reclasificación NACIONAL → INTERNACIONAL: mueve kilos y operación, neto cero', () => {
    const datos = [
      fila({ fecha: DIA_A, cierre: DIA_A, operacion: 'NACIONAL', aerolinea: 'ESTAFETA', nac: 3000 }),
      ...ajuste({
        antes: { fecha: DIA_A, operacion: 'NACIONAL', aerolinea: 'ESTAFETA', nac: 3000 },
        despues: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 3000 },
        aplicadoEn: DIA_B
      })
    ];

    const a = agregar(datos, DIA_A);
    expect(a.sub.actual.dia.LLEGADA.NACIONAL).toEqual({ kg: 3000, ops: 1 });
    expect(a.sub.actual.dia.LLEGADA.INTERNACIONAL).toEqual({ kg: 0, ops: 0 });

    const dia = agregar(datos, DIA_B).sub.actual.dia;
    expect(dia.LLEGADA.NACIONAL).toEqual({ kg: -3000, ops: -1 });
    expect(dia.LLEGADA.INTERNACIONAL).toEqual({ kg: 3000, ops: 1 });
    expect(dia.LLEGADA.NACIONAL.kg + dia.LLEGADA.INTERNACIONAL.kg).toBe(0);
    expect(dia.LLEGADA.NACIONAL.ops + dia.LLEGADA.INTERNACIONAL.ops).toBe(0);

    // Y el mes queda con la distribución corregida.
    const mes = agregar(datos, DIA_B).sub.actual.mes;
    expect(mes.LLEGADA.NACIONAL).toEqual({ kg: 0, ops: 0 });
    expect(mes.LLEGADA.INTERNACIONAL).toEqual({ kg: 3000, ops: 1 });
  });

  test('"KG DE CARGA TOTAL" corregido en una captura vieja también viaja con signo', () => {
    // Captura antigua: solo el total, atribuido por TIPO DE OPERACIÓN.
    const datos = [
      fila({ fecha: DIA_A, cierre: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', total: 2000 }),
      ...ajuste({
        antes: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', total: 2000 },
        despues: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', total: 2500 },
        aplicadoEn: DIA_B
      })
    ];
    const b = agregar(datos, DIA_B);
    expect(b.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(500);
    expect(b.sub.actual.dia.LLEGADA.INTERNACIONAL.ops).toBe(0); // −1 +1
    expect(b.sub.actual.mes.LLEGADA.INTERNACIONAL.kg).toBe(2500);
    expect(b.sub.actual.mes.LLEGADA.INTERNACIONAL.ops).toBe(1);
  });

  test('Hoja 1, Reporte de Carga y presentación NO se recalculan: siguen con lo reportado', () => {
    // Equivalente de carga al caso de pasajeros: el ajuste se cobra en el
    // oficio de Subsecretaría del corte B, y los bloques por FECHA conservan
    // los 5000 que se reportaron.
    const datos = [
      fila({ fecha: DIA_A, cierre: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 5000 }),
      ...ajuste({
        antes: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 5000 },
        despues: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 6000 },
        aplicadoEn: DIA_B
      })
    ];
    const r = agregar(datos, DIA_B);
    expect(r.anioActual.kg).toBe(5000);
    expect(r.anioActual.ops).toBe(1);
    const estafeta = r.porAerolinea.get('ESTAFETA');
    expect(estafeta.kg).toBe(5000);
    expect(estafeta.ops).toBe(1);
    expect(r.porMes[8].impKg).toBe(5000);
    expect(r.porMes[8].opsIntLlegada).toBe(1);

    // Y el mismo día A regenerado después sigue exactamente igual.
    const a = agregar(datos, DIA_A);
    expect(a.anioActual.kg).toBe(5000);
    expect(a.porMes[8].impKg).toBe(5000);

    // Mientras que el oficio de Subsecretaría del corte B sí recoge los +1000.
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(1000);
  });

  test('una reclasificación de carga tampoco reescribe el Reporte de Carga del mes ya reportado', () => {
    const datos = [
      fila({ fecha: DIA_A, cierre: DIA_A, operacion: 'NACIONAL', aerolinea: 'ESTAFETA', nac: 3000 }),
      ...ajuste({
        antes: { fecha: DIA_A, operacion: 'NACIONAL', aerolinea: 'ESTAFETA', nac: 3000 },
        despues: { fecha: DIA_A, operacion: 'INTERNACIONAL', aerolinea: 'ESTAFETA', int: 3000 },
        aplicadoEn: DIA_B
      })
    ];
    const r = agregar(datos, DIA_B);
    // El Reporte de Carga sólo cuenta carga internacional: como se reportó
    // nacional, sigue en cero, y la operación internacional tampoco aparece.
    expect(r.porMes[8].impKg).toBe(0);
    expect(r.porMes[8].opsIntLlegada).toBe(0);
    // Pero el oficio del corte B sí mueve el bucket.
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.kg).toBe(-3000);
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(3000);
  });
});

describe('Compatibilidad: sin la vista nueva, todo cuenta con signo +1', () => {
  test('pasajeros — filas sin _signo se agregan como siempre', () => {
    _uid = 0;
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    delete window._conciRowIsCargo;
    cargar([modPax]);
    const api = window.conciReportesPasajeros;
    const columnasViejas = { ...COLUMNAS_PAX, signo: null, esAjuste: null, uid: null };
    const filas = [
      { 'CIERRE SUBSECRETARIA': DIA_A, 'FECHA': DIA_A, 'TIPO DE MANIFIESTO': 'LLEGADA',
        'TIPO DE OPERACIÓN': 'NACIONAL', 'AEROLINEA': 'VIVA AEROBUS', 'TOTAL PAX': 150 }
    ];
    const r = api.agregar({ filas, columnas: columnasViejas }, DIA_A);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL).toEqual({ pax: 150, ops: 1 });
  });
});
