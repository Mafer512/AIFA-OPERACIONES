/**
 * @jest-environment jsdom
 *
 * Conciliación Manifiestos: el filtro por RANGO de fechas.
 *
 * Al pedir del 16 al 20, la consulta traía los cinco días pero la tabla
 * mostraba sólo el 16: dos filtros del navegador —el de vuelos del itinerario
 * y el filtro fino por día de operación— comparaban contra UN solo día, el de
 * inicio. Desde afuera parecía que faltaban registros o que la tabla cortaba
 * los resultados.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function trozo(firma, cierre = '\n}\n') {
  const inicio = fuente.indexOf(firma);
  if (inicio === -1) throw new Error(`No se encontró ${firma} en script.js`);
  const fin = fuente.indexOf(cierre, inicio);
  if (fin === -1) throw new Error(`No se encontró el final de ${firma}`);
  return fuente.slice(inicio, fin + cierre.length);
}

const api = new Function('document', [
  trozo('const _CONCI_MONTHS = {', '};\n'),
  trozo('function _conciResolveYear('),
  trozo('function _conciParseDateTimeParts('),
  trozo('function _conciIsoDateKey('),
  trozo('function _conciExtractVueloDateParts('),
  trozo('function _conciGetOperationHour('),
  trozo('function _conciVentanaDelFiltro('),
  trozo('function _conciIsoDesplazado('),
  trozo('function _conciIsoDentroDeVentana('),
  trozo('function _conciVueloEnVentana('),
  trozo('function _conciRowMatchesWindow('),
  'return { _conciVentanaDelFiltro, _conciIsoDesplazado, _conciVueloEnVentana, _conciRowMatchesWindow };',
].join('\n'))(document);

function pintarFiltros(desde, hasta) {
  document.body.innerHTML = [
    `<input type="date" id="filter-conci-fecha-desde" value="${desde}">`,
    `<input type="date" id="filter-conci-fecha-hasta" value="${hasta}">`,
  ].join('');
}

const VENTANA = { desde: '2026-09-16', hasta: '2026-09-20' };
const COLUMNAS = ['FECHA', 'HR. DE OPERACIÓN', 'SLOT ASIGNADO', '# DE VUELO'];

describe('la ventana de fechas del filtro', () => {
  test('un rango da sus dos extremos', () => {
    pintarFiltros('2026-09-16', '2026-09-20');
    expect(api._conciVentanaDelFiltro()).toEqual(VENTANA);
  });

  test('un solo día da una ventana de ese día', () => {
    pintarFiltros('2026-09-16', '');
    expect(api._conciVentanaDelFiltro()).toEqual({ desde: '2026-09-16', hasta: '2026-09-16' });
  });

  test('un rango invertido no encoge la ventana al revés', () => {
    pintarFiltros('2026-09-16', '2026-09-10');
    expect(api._conciVentanaDelFiltro()).toEqual({ desde: '2026-09-16', hasta: '2026-09-16' });
  });

  test('sin fecha en el filtro no hay ventana', () => {
    pintarFiltros('', '');
    expect(api._conciVentanaDelFiltro()).toBeNull();
  });

  test('la consulta se amplía un día a cada lado, también al cambiar de mes', () => {
    expect(api._conciIsoDesplazado('2026-09-28', -1)).toBe('2026-09-27');
    expect(api._conciIsoDesplazado('2026-10-03', 1)).toBe('2026-10-04');
    expect(api._conciIsoDesplazado('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('las filas del rango', () => {
  const fila = (fecha) => ({ FECHA: fecha, '# DE VUELO': 'VB 1234' });

  test('los días de en medio del rango se conservan', () => {
    ['16/09/2026', '17/09/2026', '18/09/2026', '19/09/2026', '20/09/2026'].forEach(fecha => {
      expect(api._conciRowMatchesWindow(fila(fecha), COLUMNAS, 2026, VENTANA)).toBe(true);
    });
  });

  test('un día fuera del rango se descarta', () => {
    expect(api._conciRowMatchesWindow(fila('21/09/2026'), COLUMNAS, 2026, VENTANA)).toBe(false);
    expect(api._conciRowMatchesWindow(fila('15/09/2026'), COLUMNAS, 2026, VENTANA)).toBe(false);
  });

  test('cuenta el día de operación, no sólo el programado', () => {
    const cruzaMedianoche = { FECHA: '15/09/2026', 'HR. DE OPERACIÓN': '16/09/2026 00:20' };
    expect(api._conciRowMatchesWindow(cruzaMedianoche, COLUMNAS, 2026, VENTANA)).toBe(true);
  });

  test('una fila sin ninguna fecha legible se conserva, no se pierde', () => {
    expect(api._conciRowMatchesWindow({ FECHA: '', '# DE VUELO': 'VB 1' }, COLUMNAS, 2026, VENTANA)).toBe(true);
  });
});

describe('los vuelos del itinerario en el rango', () => {
  test('un vuelo de en medio del rango entra', () => {
    expect(api._conciVueloEnVentana({ '[Arr] SIBT': '18SEP 07:00' }, 2026, VENTANA)).toBe(true);
  });

  test('un vuelo fuera del rango no entra', () => {
    expect(api._conciVueloEnVentana({ '[Arr] SIBT': '22SEP 07:00' }, 2026, VENTANA)).toBe(false);
  });

  test('los dos extremos del rango entran', () => {
    expect(api._conciVueloEnVentana({ '[Dep] SOBT': '16SEP 23:40' }, 2026, VENTANA)).toBe(true);
    expect(api._conciVueloEnVentana({ '[Dep] SOBT': '20SEP 05:10' }, 2026, VENTANA)).toBe(true);
  });
});

describe('el cargador usa la ventana', () => {
  const cargador = fuente.slice(
    fuente.indexOf('async function loadConciliacionManifiestos'),
    fuente.indexOf('function _conciSyncScrollHeight')
  );

  test('los dos filtros del navegador comparan contra la ventana, no contra un solo dia', () => {
    expect(cargador).toContain('const ventana = _conciVentanaDelFiltro();');
    expect(cargador).toContain('if (ventana) return _conciVueloEnVentana(r, year, ventana);');
    expect(cargador).toContain('_conciRowMatchesWindow(r, columns, year, ventana)');
    // La consulta tambien recibe la ventana, para los rangos que cambian de mes.
    expect(cargador).toContain('_conciFetchManifestsForDate(client, year, month, day, dayEnd, ventana)');
  });
});
