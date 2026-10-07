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
