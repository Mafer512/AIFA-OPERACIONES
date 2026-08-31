/**
 * @jest-environment jsdom
 *
 * El AODB puede operar el MISMO número de vuelo, por la MISMA ruta y el MISMO
 * día dos veces (segunda rotación). Ejemplo real del 10AUG26:
 *
 *   XN 1107  MTY-NLU-MTY  SIBT 10AUG 01:55  -> rota a XN 1100
 *   XN 1107  MTY-NLU-BJX  SIBT 10AUG 23:05  -> rota a XN 1420
 *
 * Con la identidad de la migración 010 (sin hora) las dos filas eran "el mismo
 * movimiento" y la importación abortaba con
 * "La fila N reutiliza un movimiento con un enlace de llegada/salida diferente."
 *
 * Estas pruebas ejercen el pipeline real de importCsvFromFile contra un cliente
 * Supabase falso que reproduce el trigger de identidad y el índice UNIQUE de la
 * migración 022 — (llave de movimiento, hora programada).
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'js', 'parte-ops-flights.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extractBlock(startMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`No se encontró el bloque: ${startMarker}`);
  const end = source.indexOf('\n    }\n', start);
  if (end === -1) throw new Error(`No se encontró el cierre de: ${startMarker}`);
  return source.slice(start, end + 7);
}

function extractConst(name, closer) {
  const start = source.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`No se encontró la constante: ${name}`);
  const end = source.indexOf(closer, start);
  return source.slice(start, end + closer.length);
}

const FUNCTIONS = [
  '    function normalizeValue(',
  '    function parseCsv(',
  '    function headersMatch(',
  '    function mapRowToObject(',
  '    function inferYearFromFilename(',
  '    function toLocalDateKey(',
  '    function inferImportReferenceDate(',
  '    function scheduledDateKey(',
  '    function scheduledSlotKey(',
  '    function movementIdentity(',
  '    function normalizeIdentityToken(',
  '    function normalizedFlightNumber(',
  '    function routeEndpoint(',
  '    function movementIdentityKey(',
  '    function prepareFlightIdentity(',
  '    function resolveMovementMatches(',
  '    function chunkArray(',
  '    function escapeHtml(',
  '    function ensureImportDialogStyles(',
  '    function showImportDialog(',
  '    function formatDateLabel(',
  '    function hideUploadCsvModal(',
  '    async function fetchAllFlightIdentityRows(',
  '    async function importCsvFromFile(',
  '    async function _mirrorRowsToEditableTables(',
  '    async function saveToDatabase(',
  '    async function updateExistingFlights(',
];

// Reconstruye el módulo con sus funciones reales y stubs para todo lo que toca
// la UI, para poder ejercer la importación completa sin navegador.
function buildImporter() {
  const code = [
    extractConst('HEADERS', '];'),
    extractConst('MONTHS', '};'),
    "const LOCAL_AIRPORT_CODES = new Set(['NLU', 'MMSM']);",
    "const TABLE_NAME = 'vuelos_parte_operaciones_csv';",
    "const EDIT_TABLE_NAME = 'itinerario_vuelos_editable';",
    "const MANIFIESTOS_MIRROR_TABLE_NAME = 'manifiestos_vuelos_editable';",
    extractConst('FLIGHT_IDENTITY_COLUMNS', "';"),
    extractConst('FLIGHT_FULL_SELECT', "].join(',');"),
    extractConst('_EXCLUDED_STATUS_RE', '/i;'),
    extractConst('IMPORT_DIALOG_STYLES', '`;'),
    'let lastImportYear = null;',
    'let _flightProbeCache = null;',
    'async function loadFlights() { _flightProbeCache = null; }',
    ...FUNCTIONS.map(extractBlock),
    'return { importCsvFromFile, movementIdentityKey, scheduledSlotKey, HEADERS };',
  ].join('\n');
  return new Function(code)();
}

const importer = buildImporter();
const { HEADERS } = importer;

function toCsv(rows) {
  const lines = [HEADERS.join(',')];
  rows.forEach(row => {
    lines.push(HEADERS.map(header => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(',') + ',');
  });
  return lines.join('\n') + '\n';
}

function flightRow(overrides) {
  const row = {};
  HEADERS.forEach(header => { row[header] = ''; });
  return Object.assign(row, overrides);
}

// XN 1107 llega de MTY a las 01:55 y sale como XN 1100 de vuelta a MTY.
const PRIMERA_ROTACION = flightRow({
  'Status': 'Take off',
  '[Arr] Airline code': 'XN',
  '[Arr] Flight Designator': 'XN 1107',
  '[Arr] ALDT': '10AUG 01:13',
  '[Arr] SIBT': '10AUG 01:55',
  '[Arr] AIBT': '10AUG 01:20',
  '[Arr] Stand': '107B',
  'Routing': 'MTY-NLU-MTY',
  'Aircraft type': 'E95',
  'Registration': 'XAMXB',
  '[Dep] Airline code': 'XN',
  '[Dep] Flight Designator': 'XN 1100',
  '[Dep] Stand': '107B',
  '[Dep] SOBT': '10AUG 06:00',
});

// El mismo XN 1107 vuelve a llegar de MTY el mismo día a las 23:05, ahora
// rotando hacia BJX como XN 1420. Es otro vuelo, no una reimportación.
const SEGUNDA_ROTACION = flightRow({
  'Status': 'Take off',
  '[Arr] Airline code': 'XN',
  '[Arr] Flight Designator': 'XN 1107',
  '[Arr] ALDT': '10AUG 22:49',
  '[Arr] SIBT': '10AUG 23:05',
  '[Arr] AIBT': '10AUG 22:56',
  '[Arr] Stand': '108A',
  'Routing': 'MTY-NLU-BJX',
  'Aircraft type': 'E90',
  'Registration': 'XAMXG',
  '[Dep] Airline code': 'XN',
  '[Dep] Flight Designator': 'XN 1420',
  '[Dep] Stand': '108A',
  '[Dep] SOBT': '11AUG 06:20',
});

const OTRO_VUELO = flightRow({
  'Status': 'Take off',
  '[Arr] Airline code': 'VB',
  '[Arr] Flight Designator': 'VB 9235',
  '[Arr] ALDT': '10AUG 19:34',
  '[Arr] SIBT': '10AUG 19:40',
  'Routing': 'MZT-NLU-TRC',
  'Aircraft type': '32A',
  'Registration': 'XAVAA',
  '[Dep] Airline code': 'VB',
  '[Dep] Flight Designator': 'VB 9500',
  '[Dep] SOBT': '10AUG 20:25',
});

const REFERENCE_DATE = new Date(2026, 7, 11, 12, 0, 0, 0);

// Cliente Supabase en memoria: replica el trigger _aifa_sync_aodb_movement_identity
// y los índices UNIQUE (llave de movimiento, hora programada) de la migración 022.
function createFakeSupabase(seedRows = []) {
  const tables = {
    vuelos_parte_operaciones_csv: [],
    itinerario_vuelos_editable: [],
    manifiestos_vuelos_editable: [],
  };
  let nextId = 1;

  const applyIdentityTrigger = row => {
    row.arr_movement_key = importer.movementIdentityKey(row, 'A', REFERENCE_DATE) || null;
    row.dep_movement_key = importer.movementIdentityKey(row, 'D', REFERENCE_DATE) || null;
    row.arr_movement_slot = importer.scheduledSlotKey(row['[Arr] SIBT']);
    row.dep_movement_slot = importer.scheduledSlotKey(row['[Dep] SOBT']);
    return row;
  };

  const uniquenessError = (table, row) => {
    for (const side of ['arr', 'dep']) {
      const key = row[`${side}_movement_key`];
      if (!key) continue;
      const slot = row[`${side}_movement_slot`] || '';
      const clash = tables[table].find(other =>
        String(other.id) !== String(row.id)
        && other[`${side}_movement_key`] === key
        && (other[`${side}_movement_slot`] || '') === slot
      );
      if (clash) {
        return {
          message: `duplicate key value violates unique constraint "uq_${side}_movement_identity" `
            + `Key (${side}_movement_key, ${side}_movement_slot)=(${key}, ${slot}) already exists.`,
        };
      }
    }
    return null;
  };

  seedRows.forEach(row => {
    const stored = applyIdentityTrigger({ ...row, id: nextId++ });
    Object.keys(tables).forEach(table => tables[table].push({ ...stored }));
  });

  const project = (rows, columns) => {
    if (columns === '*') return rows.map(row => ({ ...row }));
    const wanted = columns.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return rows.map(row => {
      const out = {};
      wanted.forEach(column => { out[column] = row[column] ?? null; });
      return out;
    });
  };

  function query(table) {
    let rows = tables[table];
    let columns = '*';
    let filtered = null;
    let error = null;

    const builder = {
      select(cols) { columns = cols || '*'; return builder; },
      order() { return builder; },
      range(from, to) {
        filtered = (filtered || rows).slice(from, to + 1);
        return builder;
      },
      in(column, values) {
        const set = new Set(values.map(String));
        filtered = (filtered || rows).filter(row => set.has(String(row[column])));
        return builder;
      },
      neq() { filtered = []; return builder; },
      delete() { tables[table] = []; rows = tables[table]; filtered = []; return builder; },
      insert(payload) {
        const list = Array.isArray(payload) ? payload : [payload];
        const inserted = [];
        for (const item of list) {
          const row = applyIdentityTrigger({ ...item, id: nextId++ });
          const conflict = uniquenessError(table, row);
          if (conflict) { error = conflict; filtered = []; return builder; }
          tables[table].push(row);
          inserted.push(row);
        }
        filtered = inserted;
        return builder;
      },
      upsert(payload) {
        const list = Array.isArray(payload) ? payload : [payload];
        const written = [];
        for (const item of list) {
          const index = tables[table].findIndex(row => String(row.id) === String(item.id));
          // PostgREST convierte el id de texto a bigint; el falso hace lo mismo
          // para que el registro conserve su id numérico original.
          const merged = applyIdentityTrigger(
            index >= 0
              ? { ...tables[table][index], ...item, id: tables[table][index].id }
              : { ...item, id: Number(item.id) || nextId++ }
          );
          const conflict = uniquenessError(table, merged);
          if (conflict) { error = conflict; filtered = []; return builder; }
          if (index >= 0) tables[table][index] = merged;
          else tables[table].push(merged);
          written.push(merged);
        }
        filtered = written;
        return builder;
      },
      then(resolve, reject) {
        const result = error
          ? { data: null, error }
          : { data: project(filtered || rows, columns), error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  }

  return { from: query, __tables: tables };
}

async function runImport(csvRows, seedRows = []) {
  const supabase = createFakeSupabase(seedRows);
  window.supabaseClient = supabase;
  const alerts = [];
  window.alert = message => alerts.push(String(message));
  global.alert = window.alert;
  global.bootstrap = { Modal: { getInstance: () => null } };

  // El resumen de importación ya no es un confirm() del navegador sino un
  // diálogo propio: se lee su texto y se pulsa el botón de confirmar.
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.ops-imp-overlay').forEach(overlay => {
      if (overlay.dataset.autoConfirmed) return;
      overlay.dataset.autoConfirmed = '1';
      alerts.push(overlay.textContent.replace(/\s+/g, ' ').trim());
      overlay.querySelector('[data-imp="confirm"]').click();
    });
  });
  observer.observe(document.body, { childList: true });

  const file = { name: 'Visits_11AUG26.csv', text: async () => toCsv(csvRows) };
  try {
    await importer.importCsvFromFile(file);
  } finally {
    observer.disconnect();
  }
  return { supabase, alerts, rows: supabase.__tables.vuelos_parte_operaciones_csv };
}

describe('importación del itinerario con doble rotación del mismo vuelo', () => {
  test('guarda las dos rotaciones de XN 1107 del mismo día como vuelos distintos', async () => {
    const { alerts, rows } = await runImport([PRIMERA_ROTACION, SEGUNDA_ROTACION, OTRO_VUELO]);

    expect(alerts.some(message => /No se pudo importar/i.test(message))).toBe(false);
    expect(rows).toHaveLength(3);

    const xn1107 = rows.filter(row => row['[Arr] Flight Designator'] === 'XN 1107');
    expect(xn1107).toHaveLength(2);
    expect(xn1107.map(row => row.arr_movement_slot).sort()).toEqual(['01:55', '23:05']);
    // Comparten la llave de negocio: es la hora la que las separa.
    expect(new Set(xn1107.map(row => row.arr_movement_key)).size).toBe(1);
    expect(xn1107.map(row => row['[Dep] Flight Designator']).sort()).toEqual(['XN 1100', 'XN 1420']);
  });

  test('reimportar el mismo archivo no duplica ni falla', async () => {
    const first = await runImport([PRIMERA_ROTACION, SEGUNDA_ROTACION, OTRO_VUELO]);
    const second = await runImport(
      [PRIMERA_ROTACION, SEGUNDA_ROTACION, OTRO_VUELO],
      first.rows.map(row => ({ ...row }))
    );

    expect(second.alerts.some(message => /No se pudo importar/i.test(message))).toBe(false);
    expect(second.rows).toHaveLength(3);
    expect(second.alerts.some(message => /No hay nada nuevo que importar/i.test(message))).toBe(true);
  });

  test('la segunda rotación se agrega cuando la primera ya estaba guardada', async () => {
    const { alerts, rows } = await runImport(
      [PRIMERA_ROTACION, SEGUNDA_ROTACION],
      [PRIMERA_ROTACION]
    );

    expect(alerts.some(message => /No se pudo importar/i.test(message))).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.arr_movement_slot).sort()).toEqual(['01:55', '23:05']);
  });

  test('un cambio de horario programado actualiza el vuelo en vez de duplicarlo', async () => {
    const reprogramado = flightRow({
      ...PRIMERA_ROTACION,
      '[Arr] SIBT': '10AUG 02:10',
      '[Arr] Stand': '109B',
    });
    const { alerts, rows } = await runImport([reprogramado], [PRIMERA_ROTACION]);

    expect(alerts.some(message => /No se pudo importar/i.test(message))).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]['[Arr] SIBT']).toBe('10AUG 02:10');
    expect(rows[0]['[Arr] Stand']).toBe('109B');
    expect(rows[0].arr_movement_slot).toBe('02:10');
  });
});
