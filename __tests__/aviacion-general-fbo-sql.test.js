/**
 * Migraciones 064 del módulo FBO.
 *
 * No hay PostgreSQL en la batería de pruebas: esto no ejecuta el SQL, vigila
 * las invariantes que, de romperse, sólo se descubrirían en producción:
 *
 *   · objetos nuevos sin RLS, sin REVOKE y sin restricciones (ni índices
 *     únicos, ni CHECK, ni FK), como se pidió;
 *   · ninguna migración altera, vacía ni borra tablas; la importación sólo
 *     borra de operaciones_fbo los registros que vienen en el lote;
 *   · la reversa elimina sólo los objetos 064 —todos— y nunca datos;
 *   · las columnas que inserta fbo_importar_operaciones son las del SQL de
 *     referencia del Layout y las mismas que produce layout-fbo.js;
 *   · la validación 064c es de sólo lectura.
 */

const fs = require('fs');
const path = require('path');
const Layout = require('../js/aviacion-general/layout-fbo.js');

const raiz = path.resolve(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');
/** Sin comentarios de línea, para afirmar sobre el SQL que sí corre. */
const vivo = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const M = {
    a: leer('supabase', 'migrations', '064a_fbo_movimientos_vista_y_rpc.sql'),
    b: leer('supabase', 'migrations', '064b_fbo_importar_operaciones.sql'),
    c: leer('supabase', 'migrations', '064c_fbo_validacion.sql'),
    reversa: leer('supabase', 'migrations', '064_reversa_fbo.sql')
};
const REFERENCIA = leer('docs', 'fbo', 'carga_layout_fbo_operaciones_fbo.sql');

/** Lista de columnas del primer INSERT INTO public.operaciones_fbo (...) del texto. */
function columnasInsert(sql) {
    const m = vivo(sql).match(/INSERT\s+INTO\s+public\.operaciones_fbo\s*\(([^)]*)\)/i);
    if (!m) throw new Error('No hay INSERT INTO public.operaciones_fbo');
    return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

/** Nombres de las funciones que crea un archivo. */
function funcionesCreadas(sql) {
    return Array.from(vivo(sql).matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi)).map((m) => m[1]);
}

describe('objetos nuevos sin RLS ni restricciones', () => {
    test.each(Object.keys(M))('%s no enciende RLS, no revoca y no crea restricciones ni índices', (k) => {
        const sql = vivo(M[k]);
        expect(sql).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
        expect(sql).not.toMatch(/CREATE\s+POLICY/i);
        expect(sql).not.toMatch(/\bREVOKE\b/i);
        expect(sql).not.toMatch(/\bUNIQUE\b/i);
        expect(sql).not.toMatch(/\bCHECK\s*\(/i);
        expect(sql).not.toMatch(/\bREFERENCES\b|FOREIGN\s+KEY/i);
        expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
        expect(sql).not.toMatch(/ADD\s+CONSTRAINT/i);
    });

    test.each(Object.keys(M))('%s no altera, vacía ni borra tablas', (k) => {
        const sql = vivo(M[k]);
        expect(sql).not.toMatch(/ALTER\s+TABLE/i);
        expect(sql).not.toMatch(/DROP\s+TABLE/i);
        expect(sql).not.toMatch(/\bTRUNCATE\b/i);
        expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    });

    test('las funciones y la vista se conceden a anon y authenticated', () => {
        [...funcionesCreadas(M.a), ...funcionesCreadas(M.b)].forEach((f) => {
            expect(vivo(M.a + M.b)).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${f}\\([^)]*\\)\\s+TO\\s+anon,\\s*authenticated`, 'i'));
        });
        expect(vivo(M.a)).toMatch(/GRANT\s+SELECT\s+ON\s+public\.v_fbo_movimientos\s+TO\s+anon,\s*authenticated/i);
    });
});

describe('064a · vista y consultas', () => {
    const sql = vivo(M.a);

    test('no escribe datos', () => {
        expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i);
    });

    test('el histórico es sólo ACTIVO y anterior a 2026; FBO desde 2026', () => {
        expect(sql).toMatch(/FROM\s+public\.aviacion_general_operaciones\s+o\s+WHERE\s+o\.estatus_registro\s*=\s*'ACTIVO'\s+AND\s+o\.fecha_operacion\s*<\s*DATE\s+'2026-01-01'/i);
        expect(sql).toMatch(/WHERE\s+o\.fecha_aterrizaje\s*>=\s*DATE\s+'2026-01-01'/i);
        expect(sql).toMatch(/WHERE\s+o\.fecha_salida_posicion\s*>=\s*DATE\s+'2026-01-01'/i);
    });

    test('el histórico cuenta en la misma fecha que el módulo actual (ancla de 047, regla de 051)', () => {
        expect(sql).toMatch(/public\.aviacion_general_ancla\(o\.folio_rotacion,\s*o\.matricula,\s*o\.fecha_operacion\)/);
        expect(sql).toMatch(/IN\s*\(2024,\s*2025\)/);
    });

    test('movimiento_id no choca entre fuentes y hay columna fuente', () => {
        expect(sql).toMatch(/\(o\.id \* 2\)::bigint\s+AS movimiento_id/);
        expect(sql).toMatch(/\(o\.id \* 2 \+ 1\)::bigint/);
        expect(sql).toMatch(/\(-h\.id\)::bigint/);
        expect(sql).toMatch(/'FBO'::text\s+AS fuente/);
        expect(sql).toMatch(/'HISTORICO'::text/);
        expect(sql).toMatch(/NULL::bigint,\s*\('HIST-' \|\| h\.id\)::text/);
    });

    test('los filtros se definen una sola vez y los usan resumen y mensual', () => {
        expect((sql.match(/CREATE OR REPLACE FUNCTION public\.fbo_movimientos_filtrados/g) || []).length).toBe(1);
        expect(sql).toMatch(/FROM public\.fbo_movimientos_filtrados\(p_filtros\)\s*\)/);
        expect(sql).toMatch(/FROM public\.fbo_movimientos_filtrados\(p_filtros\) m/);
    });

    test('Operadores y Matrículas distintos normalizan con upper(trim()) y excluyen vacíos', () => {
        expect(sql).toMatch(/count\(DISTINCT nullif\(upper\(trim\(operador\)\), ''\)\)/);
        expect(sql).toMatch(/count\(DISTINCT nullif\(upper\(trim\(matricula\)\), ''\)\)/);
    });
});

describe('064b · importación', () => {
    const sql = vivo(M.b);

    test('sólo borra de operaciones_fbo, por registro', () => {
        const borrados = sql.match(/DELETE\s+FROM\s+[\w.]+/gi) || [];
        expect(borrados.length).toBe(2);
        borrados.forEach((d) => expect(d).toMatch(/DELETE\s+FROM\s+public\.operaciones_fbo$/i));
        expect(sql).toMatch(/WHERE trim\(o\.registro\) = l\.registro/);
        expect(sql).toMatch(/WHERE trim\(o\.registro\) = r\.registro/);
    });

    test('rechaza lotes sin registro o con registro repetido, y serializa importaciones', () => {
        expect(sql).toMatch(/hay filas sin registro/);
        expect(sql).toMatch(/registro repetido dentro del lote/);
        expect(sql).toMatch(/pg_advisory_xact_lock/);
    });

    test('inserta las mismas columnas que el SQL de referencia del Layout', () => {
        expect(columnasInsert(M.b).sort()).toEqual(columnasInsert(REFERENCIA).sort());
    });

    test('las columnas que produce layout-fbo.js son exactamente las que inserta la 064b', () => {
        const fila = Layout.mapearFila([], {}, 1);
        expect(Object.keys(fila.operacion).sort()).toEqual(columnasInsert(M.b).sort());
    });
});

describe('064c · validación', () => {
    test('es de sólo lectura: un único SELECT, sin transacción ni DML', () => {
        const sql = vivo(M.c);
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|BEGIN|COMMIT)\b/i);
        expect(sql.trim().endsWith(';')).toBe(true);
        expect((sql.match(/;/g) || []).length).toBe(1);
    });

    test('compara 2022-2025 contra lo que hoy muestra el módulo y prueba la regla de 1000 filas', () => {
        const sql = vivo(M.c);
        expect(sql).toMatch(/generate_series\(2022, 2025\)/);
        expect(sql).toMatch(/aviacion_general_resumen\([^;]*'rotacion'\)/);
        expect(sql).toMatch(/rpc > 1000/);
    });
});

describe('064 · reversa', () => {
    const sql = vivo(M.reversa);

    test('no toca datos', () => {
        expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|INSERT|UPDATE)\b/i);
        expect(sql).not.toMatch(/DROP\s+TABLE/i);
        expect(sql).not.toMatch(/\bCASCADE\b/i);
    });

    test('elimina todas las funciones de 064a y 064b, y la vista', () => {
        [...funcionesCreadas(M.a), ...funcionesCreadas(M.b)].forEach((f) => {
            expect(sql).toMatch(new RegExp(`DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+public\\.${f}\\(`, 'i'));
        });
        expect(sql).toMatch(/DROP\s+VIEW\s+IF\s+EXISTS\s+public\.v_fbo_movimientos/i);
    });

    test('sólo elimina objetos 064', () => {
        const creados = new Set([...funcionesCreadas(M.a), ...funcionesCreadas(M.b), 'v_fbo_movimientos']);
        const eliminados = Array.from(sql.matchAll(/DROP\s+(?:FUNCTION|VIEW)\s+IF\s+EXISTS\s+public\.(\w+)/gi)).map((m) => m[1]);
        expect(eliminados.length).toBeGreaterThan(0);
        eliminados.forEach((o) => expect(creados.has(o)).toBe(true));
    });
});
