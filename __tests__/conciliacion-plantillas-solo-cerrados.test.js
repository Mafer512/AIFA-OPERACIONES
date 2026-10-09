/**
 * @jest-environment jsdom
 *
 * Reportes › Plantillas (por FECHA) sólo cuentan manifiestos con CIERRE
 * SUBSECRETARIA, como el libro, que sólo tiene manifiestos cerrados.
 *
 * Caso real: del 01 al 12 de septiembre (menos el 09) la Plantilla 2 salía al
 * doble. Una importación vieja dejó una copia de esos vuelos SIN cierre y con
 * la fecha interna al revés (01/09 → 9 de enero), así que la limpieza por fecha
 * no la quitó; la Plantilla, que agrupa por FECHA, la sumaba junto con lo
 * cargado del Excel.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');

function cargar(fuente) {
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, o) => {
    if (tipo !== 'DOMContentLoaded') registrar(tipo, fn, o);
  });
  new Function(fuente)();
  espia.mockRestore();
}

const COLUMNAS = {
  cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO',
  operacion: 'TIPO DE OPERACIÓN', aerolinea: 'AEROLINEA', pax: 'TOTAL PAX', portal: '_portal_flight_date',
  aerolineaReportada: 'cierre_aerolinea_reportada',
};
const manifiesto = (o) => ({
  'CIERRE SUBSECRETARIA': o.cierre ?? null, 'FECHA': o.fecha, 'TIPO DE MANIFIESTO': o.tipo,
  'TIPO DE OPERACIÓN': 'Nacional', 'AEROLINEA': 'VB', 'TOTAL PAX': o.pax,
  '_portal_flight_date': o.portal ?? null,
  'cierre_aerolinea_reportada': o.delLibro ? 'VIVA AEROBUS' : null,
});

describe('Plantilla 2 por FECHA, sólo con lo cerrado', () => {
  beforeAll(() => {
    window._conciRowIsCargo = () => false;
    cargar(leer('js/conci-reportes-pasajeros.js'));
  });

  test('la copia vieja sin cierre (fecha interna al revés) no duplica el día', () => {
    const filas = [
      // Lo cargado del Excel, cerrado.
      manifiesto({ cierre: '01/09/2026', fecha: '01/09/2026', tipo: 'LLEGADA', pax: 100, portal: '2026-09-01' }),
      manifiesto({ cierre: '02/09/2026', fecha: '01/09/2026', tipo: 'SALIDA', pax: 80, portal: '2026-09-01' }),
      // La copia vieja: mismos vuelos, sin cierre, fecha interna 9 de enero.
      manifiesto({ fecha: '01/09/2026', tipo: 'LLEGADA', pax: 100, portal: '2026-01-09' }),
      manifiesto({ fecha: '01/09/2026', tipo: 'SALIDA', pax: 80, portal: '2026-01-09' }),
    ];
    const r = window.conciReportesPasajeros.agregar({ filas, columnas: COLUMNAS }, '2026-09-30');
    const dia1 = r.porDia[0];
    expect(dia1.pax).toEqual({ llegada: 100, salida: 80 });
    expect(dia1.ops).toEqual({ llegada: 1, salida: 1 });
    expect(r.anioPlantillas.pax).toBe(180);
  });

  test('lo cargado del libro sin cierre (31/08 cerrado el 01/09) sí entra a la Plantilla, no al oficio', () => {
    const filas = [
      manifiesto({ cierre: '31/08/2026', fecha: '31/08/2026', tipo: 'LLEGADA', pax: 90, delLibro: true }),
      manifiesto({ fecha: '31/08/2026', tipo: 'LLEGADA', pax: 70, delLibro: true }),
    ];
    const r = window.conciReportesPasajeros.agregar({ filas, columnas: COLUMNAS }, '2026-08-31');
    expect(r.porDia[30].pax.llegada).toBe(160);
    expect(r.porDia[30].ops.llegada).toBe(2);
    // El oficio (por CIERRE) sólo ve el cerrado.
    const dia = r.sub.actual.dia.LLEGADA.NACIONAL;
    expect(dia.pax).toBe(90);
    expect(dia.ops).toBe(1);
  });

  test('"EDICIÓN POSTERIOR" cuadra la Plantilla: suma, o resta una operación si sus pasajeros son negativos', () => {
    const edicion = (o) => ({ ...manifiesto({ fecha: o.fecha, tipo: o.tipo, pax: o.pax }),
      'AEROLINEA': 'EDICIÓN POSTERIOR', 'TIPO DE OPERACIÓN': 'EDICIÓN POSTERIOR', 'cierre_aerolinea_reportada': 'EDICIÓN POSTERIOR' });
    const filas = [
      manifiesto({ cierre: '12/08/2026', fecha: '12/08/2026', tipo: 'LLEGADA', pax: 100, delLibro: true }),
      manifiesto({ cierre: '15/08/2026', fecha: '15/08/2026', tipo: 'LLEGADA', pax: 72, delLibro: true }),
      edicion({ fecha: '12/08/2026', tipo: 'LLEGADA', pax: 152 }),
      edicion({ fecha: '12/08/2026', tipo: 'LLEGADA', pax: 0 }),
      edicion({ fecha: '15/08/2026', tipo: 'LLEGADA', pax: -72 }),
    ];
    const r = window.conciReportesPasajeros.agregar({ filas, columnas: COLUMNAS }, '2026-08-31');
    expect(r.porDia[11].pax.llegada).toBe(252);
    expect(r.porDia[11].ops.llegada).toBe(3);
    expect(r.porDia[14].pax.llegada).toBe(0);
    expect(r.porDia[14].ops.llegada).toBe(0);
    // Plantilla 1: su propia línea, con lo neto del mes (152 + 0 − 72 / +1 +1 −1).
    const linea = r.porAerolinea.mes.get('EDICIÓN POSTERIOR');
    expect(linea).toEqual(expect.objectContaining({ pax: 80, ops: 1 }));
    // Los oficios (por CIERRE) no la ven.
    expect(r.sub.actual.mes.LLEGADA.NACIONAL.pax + r.sub.actual.mes.LLEGADA.INTERNACIONAL.pax).toBe(172);

    // En la Plantilla 1 (pantalla y Excel) no se muestra, pero el TOTAL sí la suma.
    const excel = window.conciReportesPasajeros.filasPlantilla1(r);
    expect(excel.some(f => String(f[0]).toUpperCase().includes('EDICIÓN POSTERIOR'))).toBe(false);
    const totales = excel.filter(f => f[0] === 'TOTAL');
    expect(totales[totales.length - 1]).toEqual(['TOTAL', 252, 3]); // mes: 100 + 72 + 80 / 1 + 1 + 1
  });

  test('carga: las hojas por FECHA usan la misma regla', () => {
    const carga = leer('js/conci-reportes-carga.js');
    const i = carga.indexOf('// ── Hoja 1, Hoja 2, Reporte de Carga y presentación: por FECHA ──');
    expect(i).toBeGreaterThan(-1);
    expect(carga.slice(i, i + 2500)).toMatch(/if \(esAjuste\) continue;[\s\S]*?if \(!cierre && !delLibro\) continue;[\s\S]*?const fecha = aIso/);
  });
});

describe('Plantillas: cuentan lo cerrado hasta el día en que se generan, como la Numeralia', () => {
  // Caso real: septiembre generado el 06/10. Los vuelos del 30/09 se cerraron
  // el 01/10; la Numeralia del libro (actualización 06/10) los trae y la
  // Plantilla 2 al 30/09 salía corta. El oficio del 30/09 no debe cambiar.
  const filasBase = [
    manifiesto({ cierre: '30/09/2026', fecha: '30/09/2026', tipo: 'LLEGADA', pax: 100, delLibro: true }),
    manifiesto({ cierre: '01/10/2026', fecha: '30/09/2026', tipo: 'LLEGADA', pax: 70, delLibro: true }),
    manifiesto({ cierre: '07/10/2026', fecha: '30/09/2026', tipo: 'SALIDA', pax: 55, delLibro: true }),
  ].map((f, i) => ({ ...f, _uid: 'M' + String(i).padStart(6, '0'), _signo: 1 }));

  let llamadas;
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 6, 12, 0, 0), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    llamadas = [];
    // Como la RPC: sólo lo cerrado hasta p_hasta.
    window.supabaseClient = {
      rpc: async (nombre, args) => {
        llamadas.push(args);
        const iso = t => t.split('/').reverse().join('-');
        return { data: filasBase.filter(f => iso(f['CIERRE SUBSECRETARIA']) <= args.p_hasta && f._uid > (args.p_despues || '')), error: null };
      },
    };
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha" value="2026-09-30">
      <button id="btn-conci-rep-pax-generar"></button>
      <button data-conci-rep-pax="subsecretaria" class="active"></button>
      <button data-conci-rep-pax="plantilla2"></button>
      <div id="conci-rep-pax-estado"></div><div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    const registrar = document.addEventListener.bind(document);
    const arranques = [];
    const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, o) => {
      if (tipo === 'DOMContentLoaded') arranques.push(fn); else registrar(tipo, fn, o);
    });
    new Function(leer('js/conci-reportes-pasajeros.js'))();
    espia.mockRestore();
    arranques.forEach(fn => fn());
  });
  afterEach(() => { jest.useRealTimers(); delete window.supabaseClient; });

  test('el reporte del 30/09 generado el 06/10 lee hasta el 06/10: la Plantilla 2 trae lo cerrado el 01/10', async () => {
    const api = window.conciReportesPasajeros;
    await api.generar();
    expect(llamadas[0].p_hasta).toBe('2026-10-06');
    // Lo que leyó (hasta el 06/10), agregado al 30/09.
    const leido = filasBase.filter(f => f['CIERRE SUBSECRETARIA'] !== '07/10/2026');
    const datos = api.agregar({ filas: leido, columnas: COLUMNAS, hasta: '2026-10-06' }, '2026-09-30');
    // Plantilla 2: 100 + 70 (lo cerrado el 07/10 aún no existe hoy).
    expect(datos.porDia[29].pax.llegada).toBe(170);
    expect(datos.porDia[29].ops.llegada).toBe(2);
    // El oficio del 30/09 sigue con lo cerrado hasta el 30/09.
    expect(datos.sub.actual.dia.LLEGADA.NACIONAL.pax).toBe(100);
    expect(datos.sub.actual.mes.LLEGADA.NACIONAL.ops).toBe(1);
    // La Plantilla dice hasta cuándo se actualizó, en el Excel y en pantalla.
    expect(api.filasPlantilla2(datos)[1][0]).toBe('Fecha de actualización: 06/10/2026');
    document.querySelector('[data-conci-rep-pax="plantilla2"]').click();
    const pantalla = document.getElementById('conci-rep-pax-salida').textContent.replace(/\s+/g, ' ');
    expect(pantalla).toContain('Fecha de actualización: 06/10/2026');
    expect(pantalla).toContain('TOTAL 170 0 170');   // pasajeros
    expect(pantalla).toContain('TOTAL 2 0 2');       // operaciones
  });

  test('un reporte de hoy o de una fecha futura lee hasta esa misma fecha', async () => {
    document.getElementById('conci-rep-pax-fecha').value = '2026-10-06';
    await window.conciReportesPasajeros.generar();
    expect(llamadas[0].p_hasta).toBe('2026-10-06');
  });
});
