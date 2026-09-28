/**
 * Campo "KGS. DE CARGA EN TRANSITO" en la captura de Conciliación Manifiestos.
 * Es aditivo: se captura, se guarda y se exporta, pero NO participa en
 * ningún total de carga.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const script = leer('script.js');
const sql = leer('supabase/migrations/055_conciliacion_manifiestos_carga_en_transito.sql');
const CAMPO = 'KGS. DE CARGA EN TRANSITO';

function extraer(nombre) {
  const inicio = script.indexOf(`function ${nombre}(`);
  if (inicio === -1) throw new Error(`No se encontró ${nombre}`);
  return script.slice(inicio, script.indexOf('\n}\n', inicio) + 2);
}

const api = new Function(`
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciIsNumericCaptureColumn')}
  ${extraer('_conciSummaryColumnKey')}
  ${extraer('_conciSummaryFindColumn')}
  ${extraer('_conciSummaryCargoColumns')}
  return { _conciIsNumericCaptureColumn, _conciSummaryCargoColumns };
`)();

describe('KGS. DE CARGA EN TRANSITO', () => {
  test('la migración agrega una columna numeric NULL, idempotente y sin default', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "KGS\. DE CARGA EN TRANSITO" numeric;/);
    expect(sql).not.toMatch(/"KGS\. DE CARGA EN TRANSITO" numeric\s+(DEFAULT|NOT NULL)/);
  });

  test('está en el esquema de captura, entre el total de carga y CORREO', () => {
    const lista = script.match(/const _CONCI_OUTPUT_COLUMNS = \[([\s\S]*?)\];/)[1];
    const cols = lista.match(/"[^"]+"/g).map((s) => s.slice(1, -1));
    const i = cols.indexOf(CAMPO);
    expect(i).toBeGreaterThan(-1);
    expect(cols[i - 1]).toBe('KG DE CARGA TOTAL');
    expect(cols[i + 1]).toBe('CORREO');
  });

  test('se filtra como numérica al capturar', () => {
    expect(api._conciIsNumericCaptureColumn(CAMPO)).toBe(true);
  });

  test('NO cuenta como carga total/nacional/internacional en la tarjeta resumen', () => {
    const c = api._conciSummaryCargoColumns([
      'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL', CAMPO,
    ]);
    expect(c.total).toBe('KG DE CARGA TOTAL');
    expect(c.nacional).toBe('KGS. DE CARGA NACIONAL');
    expect(c.internacional).toBe('KGS. DE CARGA INTERNACIONAL');
    expect(c.generico).toBeNull();
  });

  test('es corregible tras el cierre pero NO mueve totales de informe', () => {
    const cuerpo = sql.match(/_conci_campos_editables_cierre\(\)[\s\S]*?^\$\$;/m)[0];
    expect(cuerpo).toContain(`'${CAMPO}'`);
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/_conci_campos_numericos_cierre/);
  });
});
