/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const blockStart = source.indexOf(startMarker);
  const blockEnd = source.indexOf(endMarker, blockStart);
  if (blockStart === -1 || blockEnd === -1) throw new Error('No se encontro el bloque solicitado.');
  return source.slice(blockStart, blockEnd);
}

const start = source.indexOf('function _conciPayloadIdentityValue');
const end = source.indexOf('function _conciAirlinePayloadEntry', start);

if (start === -1 || end === -1) {
  throw new Error('No se encontro el bloque de guardado por movement_key.');
}

const api = new Function(
  '_conciNormalizedColumnName',
  '_conciNormalizeEditableCellText',
  '_conciCoerceNumberCandidate',
  source.slice(start, end)
    + '; return { _conciMovementKeyFromPayload, _conciWriteRowSafe };'
)(
  value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''),
  value => String(value ?? '').trim(),
  value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
);

describe('guardado de Conciliacion por movement_key', () => {
  test('carga los manifiestos en la ventana normalizada que cubre cruces de medianoche', async () => {
    const fetchSource = sourceBetween(
      'async function _conciFetchManifestsForDate',
      '// Month abbreviation'
    );
    const calls = [];
    const query = {
      select: jest.fn(() => query),
      gte: jest.fn((column, value) => {
        calls.push({ type: 'gte', column, value });
        return query;
      }),
      lte: jest.fn((column, value) => {
        calls.push({ type: 'lte', column, value });
        return query;
      }),
      order: jest.fn(async () => ({ data: [{ id: 42 }], error: null })),
    };
    const fetchManifests = new Function(
      '_conciGetManifestColInfo',
      '_concifetchAllRows',
      '_conciIsoDateKey',
      'console',
      fetchSource + '; return _conciFetchManifestsForDate;'
    )(
      async () => ({ portalDateKey: '_portal_flight_date' }),
      jest.fn(),
      (year, month, day) => [
        year,
        String(month).padStart(2, '0'),
        String(day).padStart(2, '0'),
      ].join('-'),
      console
    );
    const client = { from: jest.fn(() => query) };

    const result = await fetchManifests(client, 2026, 8, 3, null);

    expect(result).toEqual({ data: [{ id: 42 }], error: null });
    expect(calls).toContainEqual({
      type: 'gte',
      column: '_portal_flight_date',
      value: '2026-08-02',
    });
    expect(calls).toContainEqual({
      type: 'lte',
      column: '_portal_flight_date',
      value: '2026-08-04',
    });
  });

  test('el cruce de filas prioriza movement_key sobre textos de vuelo', () => {
    expect(source).toContain('const vByMovementKey = new Map();');
    expect(source).toContain('const manifestMovementKey = String(mRow.movement_key || \'\').trim();');
    expect(source).toContain('const movementMatch = vByMovementKey.get(manifestMovementKey);');
  });

  test('calcula la misma identidad de una llegada que el trigger SQL', () => {
    expect(api._conciMovementKeyFromPayload({
      AEROLINEA: 'AM',
      '# DE VUELO': 'AM 123',
      FECHA: '03/08/2026',
      'TIPO DE MANIFIESTO': 'Llegada',
      'DESTINO / ORIGEN': 'MEX-NLU',
    })).toBe('AM|123|2026-08-03|A|MEX');
  });

  test('si el insert ya existe, actualiza su id sin duplicar ni pisar otras celdas', async () => {
    const calls = [];
    const duplicateError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint uq_conciliacion_manifiestos_movement_key',
      details: 'Key (movement_key)=(AM|123|2026-08-03|A|MEX) already exists.',
    };
    const client = {
      from: jest.fn(() => ({
        insert: payload => ({
          select: () => ({
            maybeSingle: async () => {
              calls.push({ type: 'insert', payload });
              return { data: null, error: duplicateError };
            },
          }),
        }),
        select: () => ({
          eq: (column, value) => ({
            maybeSingle: async () => {
              calls.push({ type: 'lookup', column, value });
              return { data: { id: 42 }, error: null };
            },
          }),
        }),
        update: payload => ({
          eq: (column, value) => ({
            select: () => ({
              maybeSingle: async () => {
                calls.push({ type: 'update', payload, column, value });
                return { data: { id: 42, ...payload }, error: null };
              },
            }),
          }),
        }),
      })),
    };
    const fullPayload = {
      AEROLINEA: 'AM',
      '# DE VUELO': 'AM 123',
      FECHA: '03/08/2026',
      'TIPO DE MANIFIESTO': 'Llegada',
      'DESTINO / ORIGEN': 'MEX-NLU',
      'TOTAL PAX': 181,
      OBSERVACIONES: 'valor previo de la fila virtual',
    };

    const result = await api._conciWriteRowSafe(client, fullPayload, null, {
      recoverMovementConflict: true,
      duplicateUpdatePayload: { 'TOTAL PAX': 181 },
    });

    expect(result.ok).toBe(true);
    expect(result.recoveredMovementConflict).toBe(true);
    expect(result.data).toEqual({ id: 42, 'TOTAL PAX': 181 });
    expect(calls).toContainEqual({
      type: 'lookup',
      column: 'movement_key',
      value: 'AM|123|2026-08-03|A|MEX',
    });
    expect(calls).toContainEqual({
      type: 'update',
      payload: { 'TOTAL PAX': 181 },
      column: 'id',
      value: '42',
    });
  });

  test('no declara éxito cuando un update afecta cero filas', async () => {
    const client = {
      from: jest.fn(() => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      })),
    };

    const result = await api._conciWriteRowSafe(client, { 'TOTAL PAX': 77 }, '42');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('CONCI_WRITE_NOT_CONFIRMED');
    expect(result.error.message).toContain('no confirmó ninguna fila');
  });

  test('no declara éxito si la base devuelve un valor distinto al capturado', async () => {
    const client = {
      from: jest.fn(() => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: 42, 'TOTAL PAX': 10 }, error: null }),
            }),
          }),
        }),
      })),
    };

    const result = await api._conciWriteRowSafe(client, { 'TOTAL PAX': 77 }, '42');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('CONCI_WRITE_NOT_CONFIRMED');
    expect(result.error.message).toContain('TOTAL PAX');
  });
});
