/**
 * Un día con vuelos y CERO manifiestos tiene que verse.
 *
 * Síntoma reportado: tras vaciar la tabla de manifiestos y volver a cargar los
 * vuelos, Conciliación mostraba los 230 renglones del día con los encabezados
 * correctos y TODAS las celdas en blanco — sólo "ESTATUS MATRÍCULA: NO
 * IDENTIFICADA", que es lo que sale justamente cuando la matrícula viene vacía.
 * Los contadores de Llegadas y Salidas marcaban 0 con 230 filas en pantalla.
 *
 * La causa: el juego de columnas se deducía leyendo una fila real de
 * "Conciliación Manifiestos". Sin ninguna fila no había esquema, y entonces
 * cada vuelo se escribía en llaves inventadas ('# de Vuelo', 'Aerolínea') que
 * no son las que la tabla pinta ('# DE VUELO', 'AEROLINEA'). Fila poblada,
 * celdas vacías.
 *
 * La lista canónica de columnas ES el esquema: sus nombres son los mismos de la
 * base, por eso se captura contra ella. Estas pruebas fijan que se use también
 * cuando no hay ni un manifiesto.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

function extraerConst(nombre) {
  const marca = `const ${nombre} = `;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n];\n', inicio) + 4);
}

const construir = new Function(`
  const _CONCI_MONTHS = { ENE:1, FEB:2, MAR:3, ABR:4, MAY:5, JUN:6, JUL:7, AGO:8, SEP:9, OCT:10, NOV:11, DIC:12,
                          JAN:1, APR:4, AUG:8, DEC:12 };
  const _conciAirlineOverrides = new Map();
  ${extraerConst('_CONCI_OUTPUT_COLUMNS')}
  ${extraer('_conciExtractVueloDateParts')}
  ${extraer('_conciDetect')}
  ${extraer('_conciGetAssignedSlot')}
  ${extraer('_conciGetOperationHour')}
  ${extraer('_conciParseDateTimeParts')}
  ${extraer('_conciPad2')}
  ${extraer('_conciResolveYear')}
  ${extraer('_conciVueloToRow')}
  ${extraer('_conciBuildEnriched')}
  return { _conciBuildEnriched, _CONCI_OUTPUT_COLUMNS };
`);

const { _conciBuildEnriched, _CONCI_OUTPUT_COLUMNS } = construir();

// Un vuelo tal y como llega de manifiestos_vuelos_editable: una fila del
// itinerario con su llegada y su salida.
const VUELO = {
  id: 13475,
  Status: 'Billing validated',
  '[Arr] Airline code': 'W8',
  '[Arr] Flight Designator': 'W8 952',
  '[Arr] SIBT': '27AUG 07:50',
  '[Arr] AIBT': '27AUG 07:47',
  '[Arr] ALDT': '27AUG 07:41',
  '[Arr] Stand': '606A',
  '[Arr] Service Type': 'F',
  '[Dep] Airline code': 'W8',
  '[Dep] Flight Designator': 'W8 951',
  '[Dep] SOBT': '27AUG 20:00',
  '[Dep] AOBT': '27AUG 21:22',
  '[Dep] Service Type': 'F',
  Routing: 'CVG-NLU-CVG',
  'Aircraft type': '763',
  Registration: 'CFMAJ',
};

describe('Conciliación con vuelos pero sin ningún manifiesto', () => {
  test('cada vuelo produce una llegada y una salida', () => {
    const { rows } = _conciBuildEnriched([], [VUELO], []);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r['TIPO DE MANIFIESTO'])).toEqual(['LLEGADA', 'SALIDA']);
  });

  test('las celdas caen en las columnas que la tabla pinta, no en llaves inventadas', () => {
    const { rows, columns } = _conciBuildEnriched([], [VUELO], []);
    const llegada = rows[0];

    // El síntoma exacto: la fila traía datos, pero bajo nombres que la tabla
    // nunca consulta.
    expect(llegada['# de Vuelo']).toBeUndefined();
    expect(llegada['Aerolínea']).toBeUndefined();

    expect(llegada['# DE VUELO']).toBe('W8 952');
    expect(llegada['AEROLINEA']).toBe('W8');
    expect(llegada['AERONAVE']).toBe('763');
    expect(llegada['MATRÍCULA']).toBe('CFMAJ');
    expect(llegada['RUTA']).toBe('CVG-NLU-CVG');
    expect(llegada['SLOT ASIGNADO']).toBe('27AUG 07:50');
    expect(llegada['HR. DE OPERACIÓN']).toBe('27AUG 07:47');
    expect(llegada['FECHA']).toBe('27/08');
    expect(llegada['MES']).toBe('8');

    // Toda columna con valor tiene que existir en el juego que se renderiza:
    // si no, la celda se pierde igual que antes.
    const conValor = Object.keys(llegada).filter(k => !k.startsWith('_') && llegada[k] !== '');
    conValor.forEach(k => expect(columns).toContain(k));
  });

  test('la salida toma los datos del lado de salida', () => {
    const { rows } = _conciBuildEnriched([], [VUELO], []);
    const salida = rows[1];
    expect(salida['# DE VUELO']).toBe('W8 951');
    expect(salida['SLOT ASIGNADO']).toBe('27AUG 20:00');
    expect(salida['HR. DE OPERACIÓN']).toBe('27AUG 21:22');
  });

  test('las columnas son las mismas haya o no manifiestos', () => {
    const sinManifiestos = _conciBuildEnriched([], [VUELO], []).columns;
    const conManifiestos = _conciBuildEnriched(
      [],
      [VUELO],
      [Object.fromEntries(_CONCI_OUTPUT_COLUMNS.map(c => [c, '']))],
    ).columns;
    expect(sinManifiestos).toEqual(conManifiestos);
  });

  test('un vuelo cancelado sigue sin aparecer en Manifiestos', () => {
    const cancelado = { ...VUELO, Status: 'Cancelled' };
    const { rows } = _conciBuildEnriched([], [cancelado], []);
    expect(rows).toHaveLength(0);
  });
});
