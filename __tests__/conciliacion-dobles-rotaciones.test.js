/**
 * Conciliación › Manifiestos: dos rotaciones reales del mismo vuelo el mismo
 * día (p. ej. AEROLITORAL 875 el 08/09, a las 06:03 y a la 01:40 del día
 * siguiente). La unicidad de la base pasa a ser (movement_key, hora del SLOT
 * ASIGNADO); al chocar un guardado, el cliente debe encontrar la rotación de
 * la MISMA hora y no la otra.
 */

const fs = require('fs');
const path = require('path');

const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8').replace(/\r\n/g, '\n');

function extraer(nombre) {
  const inicio = js.search(new RegExp(`^(async )?function ${nombre}\\(`, 'm'));
  expect(inicio).toBeGreaterThan(-1);
  const fin = js.indexOf('\n}\n', inicio);
  return js.slice(inicio, fin + 2);
}

const api = new Function(`
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciPayloadIdentityValue')}
  ${extraer('_conciMovementKeyFromPayload')}
  ${extraer('_conciMovementKeyFromDuplicateError')}
  ${extraer('_conciFindExistingMovementRowId')}
  return { _conciMovementKeyFromDuplicateError, _conciFindExistingMovementRowId };
`)();

// Como PostgREST: maybeSingle con más de una fila responde error (PGRST116).
function cliente(filas) {
  return {
    from() {
      const q = {
        select() { return q; },
        eq(col, val) { q.llave = val; return q; },
        maybeSingle() { q.uno = true; return q; },
        then(res) {
          const hallados = filas.filter(f => f.movement_key === q.llave);
          const r = !q.uno ? { data: hallados, error: null }
            : hallados.length > 1 ? { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
            : { data: hallados[0] || null, error: null };
          return Promise.resolve(r).then(res);
        },
      };
      return q;
    },
  };
}

describe('dobles rotaciones', () => {
  test('el detalle del índice con dos columnas da la llave', () => {
    const error = { code: '23505', details: 'Key (movement_key, _aifa_movement_slot("SLOT ASIGNADO"::text))=(5D|875|2026-09-08|A|CHIHUAHUA, 06:00) already exists.' };
    expect(api._conciMovementKeyFromDuplicateError(error)).toBe('5D|875|2026-09-08|A|CHIHUAHUA');
  });

  test('el detalle con una sola columna sigue funcionando', () => {
    const error = { code: '23505', details: 'Key (movement_key)=(XN|1761|2026-09-30|A|MID) already exists.' };
    expect(api._conciMovementKeyFromDuplicateError(error)).toBe('XN|1761|2026-09-30|A|MID');
  });

  test('con dos rotaciones elige la de la misma hora de SLOT', async () => {
    const filas = [
      { id: 11, movement_key: '5D|875|2026-09-08|A|CHIHUAHUA', 'SLOT ASIGNADO': '08/09/2026 06:00' },
      { id: 12, movement_key: '5D|875|2026-09-08|A|CHIHUAHUA', 'SLOT ASIGNADO': '09/09/2026 01:30' },
    ];
    const error = { code: '23505', details: 'Key (movement_key, _aifa_movement_slot("SLOT ASIGNADO"::text))=(5D|875|2026-09-08|A|CHIHUAHUA, 01:30) already exists.' };
    const payload = { 'SLOT ASIGNADO': '09SEP 01:30' };
    expect(await api._conciFindExistingMovementRowId(cliente(filas), payload, error)).toBe(12);
    expect(await api._conciFindExistingMovementRowId(cliente(filas), { 'SLOT ASIGNADO': '08/09/2026 6:00' }, error)).toBe(11);
  });

  test('misma hora de slot pero distinto día: el vuelo de ayer retrasado y el de hoy', async () => {
    // AEROLITORAL 875, FECHA 08/09: slot 07/09 19:20 (operó 00:03) y slot 08/09 19:20.
    const filas = [
      { id: 21, movement_key: '5D|875|2026-09-08|A|MERIDA', 'SLOT ASIGNADO': '07/09/2026 19:20' },
      { id: 22, movement_key: '5D|875|2026-09-08|A|MERIDA', 'SLOT ASIGNADO': '08SEP 19:20' },
    ];
    const error = { code: '23505', details: 'Key (movement_key, _aifa_movement_slot_fecha("SLOT ASIGNADO"::text))=(5D|875|2026-09-08|A|MERIDA, 08/09 19:20) already exists.' };
    expect(api._conciMovementKeyFromDuplicateError(error)).toBe('5D|875|2026-09-08|A|MERIDA');
    expect(await api._conciFindExistingMovementRowId(cliente(filas), { 'SLOT ASIGNADO': '08/09/2026 19:20' }, error)).toBe(22);
    expect(await api._conciFindExistingMovementRowId(cliente(filas), { 'SLOT ASIGNADO': '2026-09-07 19:20' }, error)).toBe(21);
  });

  test('con una sola fila la regresa sin mirar el slot', async () => {
    const filas = [{ id: 7, movement_key: 'XN|1761|2026-09-30|A|MID', 'SLOT ASIGNADO': '' }];
    const error = { code: '23505', details: 'Key (movement_key)=(XN|1761|2026-09-30|A|MID) already exists.' };
    expect(await api._conciFindExistingMovementRowId(cliente(filas), {}, error)).toBe(7);
  });

  test('sin rotación de la misma hora no se adivina', async () => {
    const filas = [
      { id: 11, movement_key: 'K', 'SLOT ASIGNADO': '08/09/2026 06:00' },
      { id: 12, movement_key: 'K', 'SLOT ASIGNADO': '09/09/2026 01:30' },
    ];
    const error = { code: '23505', details: 'Key (movement_key)=(K) already exists.' };
    expect(await api._conciFindExistingMovementRowId(cliente(filas), { 'SLOT ASIGNADO': '10:00' }, error)).toBeNull();
  });
});
