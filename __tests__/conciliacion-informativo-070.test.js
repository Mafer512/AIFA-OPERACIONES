/* 070: casilla INFORMATIVO en Conciliación › Manifiestos.
 *
 * El vuelo marcado se sigue registrando igual, pero no cuenta en ninguna suma:
 * oficio y SWEAR (vista reportable), lote del cierre, Inicio y Numeralia
 * (_mh_cargar), tarjetas de la tabla y hojas de datos del Excel.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const sql = leer('supabase/migrations/070_conciliacion_informativo.sql');
const sql066 = leer('supabase/migrations/066_carga_por_cierre_y_mixtas.sql');
const scriptJs = leer('script.js');
const cierreJs = leer('js/conci-cierre-subsecretaria.js');
const css = leer('style.css');

const bloque = (texto, inicio, fin) => {
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`no encontré ${inicio}`);
  return texto.slice(i, texto.indexOf(fin, i) + fin.length);
};

describe('070_conciliacion_informativo.sql', () => {
  test('la columna nace en "no": lo ya guardado no cambia', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "INFORMATIVO" boolean NOT NULL DEFAULT false;/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
  });

  test('la vista reportable deja fuera los informativos en sus cuatro bloques', () => {
    const vista = bloque(sql, 'CREATE VIEW public.v_conciliacion_manifiestos_reportable', 'COMMENT ON VIEW');
    expect(vista.match(/NOT coalesce\((m|r)\."INFORMATIVO", false\)/g)).toHaveLength(4);
    expect(vista).toMatch(/WHERE m\.cierre_id IS NULL\s+AND NOT coalesce\(m\."INFORMATIVO", false\)/);
    expect(vista.match(/WHERE a\.estado = 'aplicado'\s+AND NOT coalesce\(r\."INFORMATIVO", false\)/g)).toHaveLength(2);
    expect(sql).toMatch(/DROP VIEW IF EXISTS public\.v_conciliacion_manifiestos_reportable;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.v_conciliacion_manifiestos_reportable TO authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.v_conciliacion_manifiestos_reportable FROM PUBLIC, anon;/);
  });

  test('lote y corte: un informativo aporta cero; marcarlo o desmarcarlo mueve la fila completa', () => {
    const totales = bloque(sql, 'FUNCTION public._conci_totales_numericos', '$$;');
    expect(totales).toContain("coalesce(p_datos ->> 'INFORMATIVO', 'false') <> 'true'");
    const delta = bloque(sql, 'FUNCTION public._conci_delta_numerico', '$$;');
    expect(delta).toContain("CASE WHEN coalesce(p_despues ->> 'INFORMATIVO', 'false') = 'true' THEN 0");
    expect(delta).toContain("CASE WHEN coalesce(p_antes ->> 'INFORMATIVO', 'false') = 'true' THEN 0");
  });

  test('Inicio / Numeralia: _mh_cargar es la de 066 con un solo filtro más', () => {
    const fn070 = bloque(sql, 'CREATE OR REPLACE FUNCTION public._mh_cargar(', 'FROM PUBLIC, anon, authenticated;');
    const fn066 = bloque(sql066, 'CREATE OR REPLACE FUNCTION public._mh_cargar(', 'FROM PUBLIC, anon, authenticated;');
    const filtro = '           -- 070: un vuelo INFORMATIVO no suma; si ya estaba, se borra (_mh_ids).\n'
      + '           AND NOT coalesce(c."INFORMATIVO", false)\n';
    expect(fn070).toContain(filtro);
    expect(fn070.replace(filtro, '')).toBe(fn066);
  });
});

describe('tabla de Manifiestos', () => {
  test('la columna va después de "Hora y Fecha Generación" y no es celda de captura', () => {
    expect(scriptJs).toMatch(/"Hora y Fecha Generación", "_fuente"\n\];/);
    expect(scriptJs).not.toMatch(/_CONCI_OUTPUT_COLUMNS = \[[^\]]*"INFORMATIVO"/);
    // Encabezado tras las columnas de datos y antes de Itinerario.
    expect(scriptJs).toMatch(/infTh\.textContent = 'INFORMATIVO';\s+trHead\.appendChild\(infTh\);\s+\/\/ Columna “Itinerario”/);
    // La celda no lleva data-col: el autoguardado de la fila nunca la envía.
    const td = bloque(scriptJs, 'function _conciInformativoTd(', '\n}\n');
    expect(td).not.toMatch(/dataset\.col\b/);
    expect(td).toContain("tr.classList.toggle('conci-row-informativo', box.checked)");
  });

  test('se guarda sola, al marcarla, sólo en filas abiertas ya guardadas', () => {
    const fn = bloque(scriptJs, 'async function _conciCambiarInformativo(', '\n}\n');
    expect(fn).toMatch(/\.update\(\{ INFORMATIVO: marcado \}\)\s+\.eq\('id', id\)/);
    expect(fn).toMatch(/if \(box\.dataset\.cerrado === '1'\) \{[\s\S]*?abrirModalCorreccion\(\{ manifiestoId: id, campo: 'INFORMATIVO', valor: marcado \}\)/);
    expect(fn).toMatch(/if \(!id\) \{\s+box\.checked = !marcado;/);
  });

  test('las tarjetas de la tabla no cuentan los informativos', () => {
    const strip = bloque(scriptJs, 'function _updateManifiestosSummaryStrip(', '\n}\n');
    expect(strip).toMatch(/for \(const row of rows\) \{\s+if \(_conciEsInformativo\(row\)\) continue;/);
    const resumen = bloque(scriptJs, 'function _conciUpdateResumen(', '\n}\n');
    expect(resumen).toMatch(/for \(const r of \(data \|\| \[\]\)\) \{\s+if \(_conciEsInformativo\(r\)\) continue;/);
  });

  test('Excel: fuera de las hojas de datos, en una hoja INFORMATIVOS aparte', () => {
    const fn = bloque(scriptJs, 'async function _conciExportToExcel(', '\nwindow.conciExportExcel');
    expect(fn).toContain(': delTipo.filter(r => _conciEsInformativo(r) === !!opts.soloInformativos);');
    expect(fn).toContain("sheetName: 'INFORMATIVOS Pasajeros'");
    expect(fn).toContain("sheetName: 'INFORMATIVOS Carga'");
    expect(fn).toContain("sheetName: targetWb ? `INFORMATIVOS ${isCarga ? 'Carga' : 'Pasajeros'}` : 'INFORMATIVOS'");
    // Por capturista no suma: cada quien conserva todo lo que capturó.
    expect(scriptJs).toContain('{ rows: grupos.get(nombre), sheetName, vueloCompleto: true, incluirInformativos: true }');
  });

  test('fila gris', () => {
    expect(css).toMatch(/#table-conci-manifiestos tbody tr\.conci-row-informativo>td,/);
    expect(css).toMatch(/background-color: #d5d8dc !important;/);
  });

  test('corrección de un cerrado: INFORMATIVO se elige con sí/no', () => {
    expect(cierreJs).toContain('<select class="form-select d-none" id="conci-corr-valor-informativo">');
    expect(cierreJs).toMatch(/const valorNuevo = esInformativo\s+\? modal\.querySelector\('#conci-corr-valor-informativo'\)\.value/);
  });
});
