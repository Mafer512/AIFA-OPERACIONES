/**
 * @jest-environment node
 *
 * La sincronización HVAC no puede mandar dos veces el mismo "Reporte ID".
 *
 * Error reportado desde los logs de Supabase:
 *
 *     ON CONFLICT DO UPDATE command cannot affect row a second time
 *
 * El upsert va en UNA sola sentencia. Si el lote trae dos filas con el mismo
 * reporte_id, Postgres tendría que insertar y actualizar la misma fila dentro
 * del mismo comando, y eso no lo hace: rechaza el lote ENTERO. Es decir, una
 * fila duplicada en la hoja de cálculo tira al suelo la sincronización
 * completa, no solo esa fila —que era justo lo que se veía: unos días entraban
 * registros y otros no entraba ninguno—.
 *
 * La restricción unique de la tabla no tiene nada que ver y funciona bien: en
 * producción hay 369 filas, cero reporte_id duplicados y cero vacíos.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs
  .readFileSync(path.resolve(__dirname, '..', 'scripts', 'appsheet_hvac_to_supabase.gs'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = fuente.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en el .gs`);
  return fuente.slice(inicio, fuente.indexOf('\n}\n', inicio) + 2);
}

const { dedupePorClave } = new Function(`
  ${extraer('dedupePorClave')}
  return { dedupePorClave };
`)();

const fila = (id, estado) => ({ reporte_id: id, estado, equipo: 'UMA-' + id });

describe('el lote que se manda a Supabase', () => {
  test('sin repetidos, pasa tal cual', () => {
    const r = dedupePorClave([fila('a', 'Abierto'), fila('b', 'Cerrado')], 'reporte_id');
    expect(r.filas).toHaveLength(2);
    expect(Object.keys(r.repetidas)).toEqual([]);
  });

  test('el caso que rompía: dos filas con el mismo Reporte ID', () => {
    const r = dedupePorClave(
      [fila('a', 'Abierto'), fila('b', 'Cerrado'), fila('a', 'Cerrado')],
      'reporte_id',
    );
    expect(r.filas).toHaveLength(2);
    expect(r.filas.map((f) => f.reporte_id)).toEqual(['a', 'b']);
  });

  test('gana la última, que es la que ganaría en el upsert', () => {
    const r = dedupePorClave([fila('a', 'Abierto'), fila('a', 'Cerrado')], 'reporte_id');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].estado).toBe('Cerrado');
  });

  test('se conserva el orden de aparición', () => {
    const r = dedupePorClave(
      [fila('c'), fila('a'), fila('b'), fila('a')],
      'reporte_id',
    );
    expect(r.filas.map((f) => f.reporte_id)).toEqual(['c', 'a', 'b']);
  });

  test('tres iguales también se reducen a una', () => {
    const r = dedupePorClave([fila('a', '1'), fila('a', '2'), fila('a', '3')], 'reporte_id');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].estado).toBe('3');
    expect(r.repetidas.a).toBe(3);
  });

  test('un lote vacío no rompe nada', () => {
    const r = dedupePorClave([], 'reporte_id');
    expect(r.filas).toEqual([]);
  });
});

describe('el aviso para limpiar la hoja', () => {
  test('dice qué claves venían repetidas y cuántas veces', () => {
    const r = dedupePorClave(
      [fila('a'), fila('b'), fila('a'), fila('c'), fila('a'), fila('b')],
      'reporte_id',
    );
    expect(r.repetidas).toEqual({ a: 3, b: 2 });
  });

  test('no inventa repetidos cuando no los hay', () => {
    const r = dedupePorClave([fila('a'), fila('b'), fila('c')], 'reporte_id');
    expect(r.repetidas).toEqual({});
  });
});

describe('claves que podrían chocar con el prototipo', () => {
  // Un mapa normal trataría "constructor" o "__proto__" como si ya existieran.
  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'un Reporte ID llamado "%s" se trata como cualquier otro',
    (id) => {
      const r = dedupePorClave([fila(id, 'uno'), fila('normal', 'dos')], 'reporte_id');
      expect(r.filas).toHaveLength(2);
      expect(r.repetidas).toEqual({});
    },
  );

  test('y si de verdad se repite, se detecta', () => {
    const r = dedupePorClave([fila('__proto__', 'uno'), fila('__proto__', 'dos')], 'reporte_id');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].estado).toBe('dos');
  });
});

describe('el script llama al de-duplicado antes de mandar', () => {
  test('upsertBatch recibe el lote ya limpio, no el original', () => {
    const cuerpo = extraer('syncAll');
    expect(cuerpo).toContain('dedupePorClave(payload, CONFLICT_COL)');
    expect(cuerpo).toContain('upsertBatch(limpio.filas)');
    expect(cuerpo).not.toMatch(/upsertBatch\(payload\)/);
  });

  test('hay una función para encontrar los repetidos en la hoja', () => {
    expect(fuente).toContain('function debugDuplicados(');
  });
});

describe('el esquema del repo y el script de sincronizacion no se separan', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '..', 'db', 'reportes_hvac.sql'), 'utf8');

  // Columnas declaradas dentro del create table.
  const cuerpo = sql.slice(
    sql.indexOf('create table if not exists public.reportes_hvac ('),
    sql.indexOf('\n);'),
  );
  const columnasSql = new Set(
    cuerpo.split('\n').slice(1)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('--'))
      .map((l) => l.split(/\s+/)[0]),
  );

  // Columnas a las que el .gs mapea los encabezados de la hoja.
  const columnasGs = [...fuente.matchAll(/^\s*'[^']+'\s*:\s*'(\w+)'/gm)].map((m) => m[1]);

  test('cada columna que manda el .gs existe en la tabla', () => {
    const faltantes = columnasGs.filter((c) => !columnasSql.has(c));
    expect(faltantes).toEqual([]);
  });

  test('el .gs manda las 18 columnas de datos', () => {
    expect(columnasGs).toHaveLength(18);
  });

  test('reporte_id es la llave primaria, como en produccion', () => {
    // Comprobado contra la base el 17-ago-2026: reportes_hvac_pkey es
    // PRIMARY KEY (reporte_id). El archivo declaraba antes una columna "pk"
    // que la tabla real no tiene.
    expect(cuerpo).toMatch(/reporte_id\s+text\s+primary key/);
    expect(columnasSql.has('pk')).toBe(false);
  });

  test('la columna del ON CONFLICT es la misma en los dos lados', () => {
    expect(fuente).toContain("var CONFLICT_COL  = 'reporte_id'");
    expect(columnasSql.has('reporte_id')).toBe(true);
  });
});
