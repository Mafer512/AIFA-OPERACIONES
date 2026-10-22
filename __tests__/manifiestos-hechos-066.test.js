/* 066: en el resumen del Inicio, la carga por la clasificación congelada al
 * cerrar, y las mixtas (carga de aerolíneas de pasajeros) sin operación.
 *
 * Caso real (20/10/2026): el Inicio daba 13 operaciones / 444.78 t de carga y
 * el libro 15 / 499.24; COPA CARGO ("CM") y MEXICANA ("XN") se cerraron como
 * carga pero el catálogo las tiene como pasajeros y caían en Comercial.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'migrations');
const leer = archivo => fs.readFileSync(path.join(dir, archivo), 'utf8').replace(/\r\n/g, '\n');
const funcion = sql => sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public._mh_cargar('), sql.indexOf('\n$$;', sql.indexOf('CREATE OR REPLACE FUNCTION public._mh_cargar(')) + 4);

describe('066_carga_por_cierre_y_mixtas.sql', () => {
  const sql = leer('066_carga_por_cierre_y_mixtas.sql');
  const nueva = funcion(sql);
  const base = funcion(leer('062b_frontera_y_fecha.sql'));

  test('la clasificación congelada al cerrar manda antes que el catálogo', () => {
    expect(nueva).toMatch(/CASE WHEN s\.cierre_es_carga IS TRUE\s+THEN 'cierre_carga'\s+WHEN s\.cierre_es_carga IS FALSE THEN 'cierre_pasajeros'\s+ELSE\s+public\.aifa_regla_carga\(/);
  });

  test('la carga de una aerolínea de pasajeros no es operación', () => {
    expect(nueva).toMatch(/AND NOT \(p_fuente = 'CONCILIACION' AND cl\.motivo LIKE '%\\_carga'\s+AND public\.aifa_aerolinea_mixta\(coalesce\(s\.aerolinea_reportada, a\.nombre, s\.aerolinea_texto\)\)\)\)\s+AS es_operacion/);
    for (const a of ['AEROMÉXICO', 'CONVIASA', 'MEXICANA', 'VIVA AEROBUS', 'VOLARIS']) {
      expect(sql).toContain(`'${a}'`);
    }
    expect(sql).not.toMatch(/'COPA CARGO'\s*[,\]]/);   // Copa Cargo sí es operación
  });

  test('la aerolínea reportada al cerrar viaja en la tabla de paso; la maestra no cambia', () => {
    expect(nueva).toContain('aerolinea_reportada text');
    expect(nueva).toMatch(/c\."PAX QUE PAGAN TUA"::text\),\s+nullif\(btrim\(c\.cierre_aerolinea_reportada::text\), ''\)\s+FROM public\."Conciliación Manifiestos" c/);
    expect(nueva).toMatch(/m\."PAX QUE PAGAN TUA"::text\),\s+NULL::text\s+FROM public\.maestra_manifiestos m/);
  });

  test('fuera de esos tres ajustes, es la misma función de 062b', () => {
    const quitar = s => s
      .replace(/,\n\s+aerolinea_reportada text[^\n]*/, '')
      .replace(/,\n\s+NULL::text\n(\s+FROM public\.maestra_manifiestos)/, '\n$1')
      .replace(/,\n\s+nullif\(btrim\(c\.cierre_aerolinea_reportada::text\), ''\)\n/, '\n')
      .replace(/\(s\.aerolinea_texto IS NOT NULL\n[\s\S]*?AS es_operacion,/, '(s.aerolinea_texto IS NOT NULL) AS es_operacion,')
      .replace(/CASE WHEN s\.cierre_es_carga IS TRUE[\s\S]*?ELSE\n/, '')
      .replace(/s\.cierre_es_carga\)\n\s+END\n(\s+END AS motivo)/, 's.cierre_es_carga)\n$1')
      .replace(/\s+/g, ' ');
    const normal = s => s.replace(/\(s\.aerolinea_texto IS NOT NULL\)\s+AS es_operacion,/, '(s.aerolinea_texto IS NOT NULL) AS es_operacion,').replace(/\s+/g, ' ');
    expect(quitar(nueva)).toBe(normal(base));
  });
});
