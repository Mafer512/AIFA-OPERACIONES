/**
 * @jest-environment jsdom
 *
 * Itinerario de Vuelos: el filtro de fecha se respeta.
 *
 * Elegir un día sin vuelos cargados —por ejemplo uno futuro— mostraba el
 * ÚLTIMO día con datos, con su conteo y su etiqueta ("105 vuelos (22SEP)").
 * Desde afuera parecía que el filtro no servía: se pedía el 27 y se seguía
 * viendo el 22, sin ninguna señal de que la fecha se había ignorado.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs
  .readFileSync(path.resolve(__dirname, '..', 'js', 'parte-ops-flights.js'), 'utf8')
  .replace(/\r\n/g, '\n');

const CIERRE = '\n    }\n';

function trozo(firma) {
  const inicio = fuente.indexOf(firma);
  if (inicio === -1) throw new Error(`No se encontró ${firma} en parte-ops-flights.js`);
  const fin = fuente.indexOf(CIERRE, inicio);
  if (fin === -1) throw new Error(`No se encontró el final de ${firma}`);
  return fuente.slice(inicio, fin + CIERRE.length);
}

/** Monta loadFlights con la sonda de días y las filas que devolvería la base. */
function montar({ dias, filas }) {
  document.body.innerHTML = [
    '<input type="date" id="conci-date-picker">',
    '<input type="date" id="conci-date-end">',
    '<table><tbody id="tbody-ops-flights-csv"></tbody></table>',
  ].join('');

  window.supabaseClient = {
    from: () => ({
      select: () => ({
        in: (_columna, ids) => Promise.resolve({
          data: filas.filter(fila => ids.includes(fila.id)),
          error: null,
        }),
      }),
    }),
  };

  const probe = { dayIdMap: new Map(dias), totalCount: filas.length };

  // El cuerpo se arma concatenando: el código traído lleva plantillas con ${},
  // que una plantilla de la prueba interpolaría.
  const cuerpo = [
    'let currentData = [];',
    'let latestDataDate = null;',
    'let _dateWindowUserActivated = false;',
    'let _flightTotalCount = 0;',
    "let _peticionSinVuelos = '';",
    "const EDIT_TABLE_NAME = 'vuelos_itinerario';",
    'const normalizeRow = (fila) => fila;',
    'const escapeHtml = (texto) => String(texto);',
    'const computeLatestDataDate = () => {};',
    'const initCsvExcelFilterButtons = () => {};',
    'const _buildFlightProbeCache = async () => probe;',
    'const pintados = [];',
    'const applyAndRender = () => {',
    '    pintados.push({ filas: currentData.length, dia: latestDataDate, mensaje: _mensajeTablaVacia() });',
    '};',
    trozo('function _fechaLegible('),
    trozo('function _mensajeTablaVacia('),
    trozo('async function loadFlights()'),
    'return { loadFlights, ultimo: () => pintados[pintados.length - 1], cuantas: () => pintados.length };',
  ].join('\n');

  return new Function('document', 'window', 'probe', cuerpo)(document, window, probe);
}

const DIA_CON_DATOS = [['2026-09-21', [10]], ['2026-09-22', [11, 12]]];
const FILAS = [{ id: 10 }, { id: 11 }, { id: 12 }];

describe('el filtro de fecha del Itinerario', () => {
  test('un día sin vuelos cargados no muestra otro día en su lugar', async () => {
    const api = montar({ dias: DIA_CON_DATOS, filas: FILAS });
    document.getElementById('conci-date-picker').value = '2026-09-27';

    await api.loadFlights();

    const ultimo = api.ultimo();
    expect(ultimo.filas).toBe(0);
    // La etiqueta sigue el día que se pidió, no el último con datos.
    expect(ultimo.dia).toBe('2026-09-27');
    expect(ultimo.mensaje).toContain('27/09/2026');
  });

  test('el día elegido con vuelos se muestra tal cual', async () => {
    const api = montar({ dias: DIA_CON_DATOS, filas: FILAS });
    document.getElementById('conci-date-picker').value = '2026-09-21';

    await api.loadFlights();

    const ultimo = api.ultimo();
    expect(ultimo.filas).toBe(1);
    expect(ultimo.dia).toBe('2026-09-21');
    expect(ultimo.mensaje).toBe('No hay registros para mostrar.');
  });

  test('sin fecha elegida se sigue abriendo en el último día con datos', async () => {
    const api = montar({ dias: DIA_CON_DATOS, filas: FILAS });
    document.getElementById('conci-date-picker').value = '';

    await api.loadFlights();

    const ultimo = api.ultimo();
    expect(ultimo.filas).toBe(2);
    expect(ultimo.dia).toBe('2026-09-22');
  });

  test('un periodo sin vuelos lo dice con sus dos fechas', async () => {
    const api = montar({ dias: DIA_CON_DATOS, filas: FILAS });
    document.getElementById('conci-date-picker').value = '2026-09-25';
    document.getElementById('conci-date-end').value = '2026-09-30';

    await api.loadFlights();

    const ultimo = api.ultimo();
    expect(ultimo.filas).toBe(0);
    expect(ultimo.mensaje).toContain('25/09/2026');
    expect(ultimo.mensaje).toContain('30/09/2026');
  });
});
