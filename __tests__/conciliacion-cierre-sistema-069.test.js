/* 069: el Cierre de Subsecretaría vuelve a hacerse desde el sistema.
 *
 * Al cerrar, la carga de las aerolíneas que el catálogo tiene sólo como
 * pasajeros (Copa con "CM", Mexicana, Volaris, Viva…) se habría marcado como
 * pasajeros; y lo que el libro traía sin cierre quedó fuera del mecanismo.
 */
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '069_cierre_sistema_activar.sql'), 'utf8')
  .replace(/\r\n/g, '\n');
const funcion = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public._conci_clasificacion_reportable'),
  sql.indexOf('$$;', sql.indexOf('CREATE OR REPLACE FUNCTION public._conci_clasificacion_reportable')));

describe('069_cierre_sistema_activar.sql', () => {
  test('una fila aún abierta conserva la marca del libro; una cerrada (corrección) se recalcula', () => {
    expect(funcion).toMatch(/IF nullif\(p_datos ->> 'cierre_id', ''\) IS NULL\s+AND nullif\(p_datos ->> 'cierre_es_carga_reportado', ''\) IS NOT NULL THEN/);
  });

  test('carga: aerolínea sólo de carga, o sin pasajeros y con kilos', () => {
    expect(funcion).toMatch(/WHEN v_carga AND NOT v_pasajeros THEN true\s+WHEN v_pax = 0 AND v_kg > 0 THEN true\s+ELSE false END/);
    expect(funcion).toContain("p_datos ->> 'TOTAL PAX'");
    expect(funcion).toContain("p_datos ->> 'KG DE CARGA TOTAL'");
  });

  test('mixtas: las del oficio de carga, sin Copa', () => {
    const lista = sql.slice(sql.indexOf('FUNCTION public.aifa_aerolinea_mixta'), sql.indexOf('$fn$;'));
    for (const a of ['AEROMÉXICO', 'CONVIASA', 'MEXICANA', 'VIVA AEROBUS', 'VOLARIS']) expect(lista).toContain(`'${a}'`);
    expect(lista).not.toMatch(/COPA/);
  });

  test('lo que el libro traía sin cierre entra al lote, con el permiso interno de escritura', () => {
    expect(sql).toMatch(/SELECT public\._conci_lock_contabilidad\(\);\s+SELECT public\._conci_permitir_escritura_cerrada\(\);/);
    expect(sql).toMatch(/AND m\.cierre_capturado_en IS NULL\s+AND nullif\(btrim\(coalesce\(m\."CIERRE SUBSECRETARIA"::text, ''\)\), ''\) IS NULL/);
    expect(sql).toMatch(/SET cierre_capturado_en = clock_timestamp\(\)/);
    expect(sql).toMatch(/SELECT public\._conci_fin_escritura_cerrada\(\);\s+COMMIT;/);
  });
});
