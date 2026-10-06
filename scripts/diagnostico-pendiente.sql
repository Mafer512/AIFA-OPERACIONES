-- =============================================================================
-- Diagnóstico pendiente: catálogo de matrículas y AERONAVE en los manifiestos.
-- SÓLO LECTURA. Cuatro consultas; cada una devuelve UNA tabla (columna
-- "revision" dice de qué parte es cada fila). Correr una por una:
-- seleccionarla y Run, luego Export -> CSV.
-- Contexto: docs/catalogo-aeronaves-revision.md y docs/catalogo-matriculas-revision.md
-- =============================================================================


-- 0) ¿Ya se aplicaron (COMMIT) las migraciones 058 y 059? ----------------------
SELECT to_regclass('public.catalogo_aeronaves_equivalencias') IS NOT NULL AS migracion_058_aplicada,
       EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = 'uq_matriculas_manifiestos_matricula_llave') AS migracion_059_aplicada;


-- A) Matrículas: catálogo y manifiestos en una sola tabla -----------------------
WITH cat AS (
    SELECT id, matricula, aerolinea, tipo_de_aeronave_2, pasajeros, mlw_ton, mtow_ton, mzfw_ton,
           regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g') AS k
      FROM public.matriculas_manifiestos
),
man AS (
    SELECT regexp_replace(upper("MATRÍCULA"), '[^A-Z0-9]', '', 'g') AS k,
           "MATRÍCULA" AS valor, "AEROLINEA" AS aerolinea, "AERONAVE" AS aeronave,
           date_trunc('month', public._aifa_parse_manifest_date("FECHA"))::date AS mes
      FROM public.maestra_manifiestos
     WHERE nullif(btrim("MATRÍCULA"), '') IS NOT NULL
)
SELECT '1 repetida en catálogo' AS revision, k AS matricula,
       string_agg(DISTINCT aerolinea, ' | ') AS aerolinea,
       string_agg(format('%s (id %s, %s pax)', matricula, id, pasajeros), ' | ') AS detalle,
       count(*)::int AS registros
  FROM cat GROUP BY k HAVING count(*) > 1
UNION ALL
SELECT '2 escritura rara en catálogo', matricula, aerolinea, 'espacios, minúsculas o caracteres especiales', 1
  FROM cat
 WHERE matricula <> btrim(matricula) OR btrim(matricula) ~ '\s' OR matricula ~ '[a-z]' OR matricula ~ '[^A-Za-z0-9 -]'
UNION ALL
SELECT '3 formato raro en catálogo', matricula, aerolinea, 'no cumple el formato de su país (o país no contemplado)', 1
  FROM cat
 WHERE k !~ '^(X[ABC][A-Z]{3}|N[1-9][0-9]{0,4}|N[1-9][0-9]{0,3}[A-HJ-NP-Z]|N[1-9][0-9]{0,2}[A-HJ-NP-Z]{2}|HP[0-9]{3,4}[A-Z]{0,3}|HI[0-9]{3,4}|YV[0-9]{3,4}[A-Z]?|(CC|9H|EI|EC|HC|LX|TC|A6|A7|ET)[A-Z]{3}|C[FGI][A-Z]{3})$'
UNION ALL
SELECT '4 capacidad o pesos', matricula, aerolinea,
       concat_ws(', ',
           CASE WHEN pasajeros IS NULL OR pasajeros = 0 THEN 'sin capacidad' END,
           CASE WHEN pasajeros > 450 THEN 'más de 450 pax' END,
           CASE WHEN mlw_ton > mtow_ton THEN 'MLW mayor que MTOW' END,
           CASE WHEN mzfw_ton > mlw_ton THEN 'MZFW mayor que MLW' END)
       || format(' · %s · %s pax', tipo_de_aeronave_2, pasajeros), 1
  FROM cat
 WHERE pasajeros IS NULL OR pasajeros = 0 OR pasajeros > 450 OR mlw_ton > mtow_ton OR mzfw_ton > mlw_ton
UNION ALL
SELECT '5 capacidades muy distintas', coalesce(tipo_de_aeronave_2, '(sin modelo)'), aerolinea,
       format('de %s a %s pax: %s', min(pasajeros), max(pasajeros),
              string_agg(format('%s=%s', matricula, pasajeros), ' ' ORDER BY pasajeros)),
       count(*)::int
  FROM cat GROUP BY aerolinea, tipo_de_aeronave_2
HAVING max(pasajeros) - min(pasajeros) > 40
UNION ALL
SELECT '6 varias aerolíneas en el mismo mes', k, string_agg(DISTINCT aerolinea, ' | '),
       coalesce(to_char(mes, 'YYYY-MM'), 'fecha ilegible'), count(*)::int
  FROM man GROUP BY k, mes HAVING count(DISTINCT aerolinea) > 1
UNION ALL
SELECT '7 en manifiestos pero no en catálogo', m.k, string_agg(DISTINCT m.aerolinea, ' | '),
       concat_ws(' · ', string_agg(DISTINCT m.valor, ' | '), string_agg(DISTINCT m.aeronave, ' | ')), count(*)::int
  FROM man m
 WHERE NOT EXISTS (SELECT 1 FROM cat c WHERE c.k = m.k)
 GROUP BY m.k
 ORDER BY 1, 5 DESC;


-- B) AERONAVE, FECHA, datos_origen y tipo_reporte en una sola tabla -------------
WITH m AS (
    SELECT "AERONAVE" AS aeronave,
           upper(btrim(regexp_replace(coalesce("AERONAVE", ''), '\s+', ' ', 'g'))) AS clave,
           regexp_replace(upper(coalesce("MATRÍCULA", '')), '[^A-Z0-9]', '', 'g') AS matricula,
           "AEROLINEA" AS aerolinea, "FECHA" AS fecha,
           public._aifa_parse_manifest_date("FECHA") AS dia,
           tipo_reporte, datos_origen
      FROM public.maestra_manifiestos
)
SELECT '1 valores de AERONAVE' AS revision, coalesce(aeronave, '<vacío>') AS valor, count(*)::int AS registros,
       format('%s matrículas · %s aerolíneas · del %s al %s',
              count(DISTINCT matricula), count(DISTINCT aerolinea), min(dia), max(dia)) AS detalle
  FROM m GROUP BY aeronave
UNION ALL
SELECT '2 matrícula con varios modelos en el mes',
       matricula || ' ' || coalesce(to_char(date_trunc('month', dia), 'YYYY-MM'), 'fecha ilegible'),
       count(*)::int,
       concat_ws(' · ', string_agg(DISTINCT coalesce(aeronave, '<vacío>'), ' | '), string_agg(DISTINCT aerolinea, ' | '))
  FROM m WHERE matricula <> ''
 GROUP BY matricula, date_trunc('month', dia)
HAVING count(DISTINCT regexp_replace(clave, '[^A-Z0-9]', '', 'g')) > 1
UNION ALL
SELECT '3 formatos de FECHA', regexp_replace(coalesce(fecha, '<NULL>'), '[0-9]', '9', 'g'), count(*)::int,
       format('%s no se pueden convertir · ejemplo: %s', count(*) FILTER (WHERE dia IS NULL), min(fecha))
  FROM m GROUP BY 2
UNION ALL
SELECT '4 claves de datos_origen', k, count(*)::int, ''
  FROM m, LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(datos_origen) = 'object'
                                         THEN datos_origen ELSE '{}'::jsonb END) AS k
 GROUP BY k
UNION ALL
SELECT '5 claves de datos_origen (2o nivel)', e.key || '.' || k2, count(*)::int, ''
  FROM m,
       LATERAL jsonb_each(CASE WHEN jsonb_typeof(datos_origen) = 'object' THEN datos_origen ELSE '{}'::jsonb END) AS e,
       LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value ELSE '{}'::jsonb END) AS k2
 GROUP BY e.key, k2
UNION ALL
SELECT '6 tipo_reporte', coalesce(tipo_reporte, '<NULL>'), count(*)::int,
       format('%s sin AERONAVE · %s valores distintos de AERONAVE',
              count(*) FILTER (WHERE clave = ''), count(DISTINCT aeronave))
  FROM m GROUP BY tipo_reporte
 ORDER BY 1, 3 DESC;


-- C) Los 2 manifiestos con HB1730CMP (debe ser HP1730CMP, Copa) ----------------
SELECT id, "FECHA", "TIPO DE MANIFIESTO", "AEROLINEA", "MATRÍCULA", "AERONAVE"
  FROM public.maestra_manifiestos
 WHERE regexp_replace(upper("MATRÍCULA"), '[^A-Z0-9]', '', 'g') = 'HB1730CMP';
