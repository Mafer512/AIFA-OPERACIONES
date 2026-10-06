-- =====================================================================
-- 062a · VALIDACIÓN PREVIA a la 062b (solo lectura; repítela cuando quieras)
--
-- Compara, mes por mes de 2026 hasta el corte de la maestra
-- (config_fuentes.fecha_corte_maestra), lo que trae maestra_manifiestos
-- contra lo que trae "Conciliación Manifiestos" y contra
-- cifras_oficiales_mensuales. La FECHA se lee con el mismo criterio que
-- usará la 062b: con año (AAAA-MM-DD o DD/MM/AAAA) → si no trae año,
-- _portal_flight_date (sólo Conciliación) → si tampoco, ILEGIBLE.
--
-- Comercial/Carga: maestra por tipo_reporte; Conciliación por la
-- clasificación que ya tiene en manifiestos_hechos (regla de la 058).
-- Operación = fila con AEROLINEA.
--
-- alerta: VACÍO          → la maestra no trae ese mes
--         MUY POR DEBAJO → la maestra trae < 90 % de lo oficial
--         REVISAR        → difiere más de 2 % de lo oficial
--         OK
-- =====================================================================

-- 1) Mes por mes: maestra vs Conciliación vs oficial
WITH corte AS (
    SELECT nullif(btrim(valor::text, ' "'), '')::date AS maestra
      FROM public.config_fuentes WHERE clave = 'fecha_corte_maestra'
), crudo AS (
    SELECT 'MAESTRA'::text AS fuente, m.id, m."FECHA"::text AS fecha_texto, NULL::date AS portal,
           nullif(btrim(m."AEROLINEA"::text), '') IS NOT NULL AS es_operacion,
           CASE upper(coalesce(m.tipo_reporte, '')) WHEN 'CARGA' THEN true WHEN 'PASAJEROS' THEN false END AS es_carga,
           m."TOTAL PAX"::text AS pax_texto, m."KG DE CARGA TOTAL"::text AS kg_texto
      FROM public.maestra_manifiestos m
    UNION ALL
    SELECT 'CONCILIACION', c.id, c."FECHA"::text, c."_portal_flight_date"::date,
           nullif(btrim(c."AEROLINEA"::text), '') IS NOT NULL,
           h.es_carga,
           c."TOTAL PAX"::text, c."KG DE CARGA TOTAL"::text
      FROM public."Conciliación Manifiestos" c
      LEFT JOIN public.manifiestos_hechos h ON h.fuente = 'CONCILIACION' AND h.id_origen = c.id
), partes AS (
    SELECT cr.*,
           regexp_match(btrim(coalesce(cr.fecha_texto, '')), '^(\d{4})-(\d{1,2})-(\d{1,2})(\D|$)')    AS iso,
           regexp_match(btrim(coalesce(cr.fecha_texto, '')), '^(\d{1,2})/(\d{1,2})/(\d{4})(\D|$)')   AS dmy
      FROM crudo cr
), ymd AS (
    SELECT p.*,
           CASE WHEN p.iso IS NOT NULL THEN p.iso[1]::int WHEN p.dmy IS NOT NULL THEN p.dmy[3]::int END AS y,
           CASE WHEN p.iso IS NOT NULL THEN p.iso[2]::int WHEN p.dmy IS NOT NULL THEN p.dmy[2]::int END AS mo,
           CASE WHEN p.iso IS NOT NULL THEN p.iso[3]::int WHEN p.dmy IS NOT NULL THEN p.dmy[1]::int END AS d
      FROM partes p
), fechadas AS (
    SELECT y2.*,
           coalesce(
               CASE WHEN y2.y BETWEEN 1900 AND 2100 AND y2.mo BETWEEN 1 AND 12 AND y2.d >= 1 THEN
                   CASE WHEN y2.d <= extract(day FROM (make_date(y2.y, y2.mo, 1) + interval '1 month - 1 day'))::int
                        THEN make_date(y2.y, y2.mo, y2.d) END
               END,
               y2.portal) AS fecha
      FROM ymd y2
), meses AS (
    SELECT f.fuente, extract(month FROM f.fecha)::int AS mes,
           count(*) FILTER (WHERE f.es_operacion)                                   AS manifiestos_con_aerolinea,
           count(*) FILTER (WHERE f.es_operacion AND f.es_carga IS FALSE)           AS com_ops,
           sum(public._aifa_safe_numeric(f.pax_texto)) FILTER (WHERE f.es_carga IS FALSE) AS com_pax,
           count(*) FILTER (WHERE f.es_operacion AND f.es_carga IS TRUE)            AS car_ops,
           round(sum(public._aifa_safe_numeric(f.kg_texto)) FILTER (WHERE f.es_carga IS TRUE) / 1000, 2) AS car_ton,
           count(*) FILTER (WHERE f.es_carga IS NULL)                               AS sin_clasificar
      FROM fechadas f, corte
     WHERE f.fecha >= DATE '2026-01-01' AND f.fecha <= corte.maestra
     GROUP BY 1, 2
), oficial AS (
    SELECT o.mes,
           max(o.operaciones) FILTER (WHERE o.categoria = 'comercial') AS com_ops,
           max(o.pasajeros)   FILTER (WHERE o.categoria = 'comercial') AS com_pax,
           max(o.operaciones) FILTER (WHERE o.categoria = 'carga')     AS car_ops,
           max(o.toneladas)   FILTER (WHERE o.categoria = 'carga')     AS car_ton
      FROM public.cifras_oficiales_mensuales o, corte
     WHERE o.anio = 2026 AND make_date(o.anio, o.mes, 1) <= corte.maestra
     GROUP BY o.mes
), lista AS (
    SELECT generate_series(1, extract(month FROM (SELECT maestra FROM corte))::int) AS mes
)
SELECT l.mes,
       coalesce(ma.com_ops, 0) AS maestra_com_ops,  coalesce(co.com_ops, 0) AS conci_com_ops,  of.com_ops AS oficial_com_ops,
       coalesce(ma.com_pax, 0) AS maestra_com_pax,  coalesce(co.com_pax, 0) AS conci_com_pax,  of.com_pax AS oficial_com_pax,
       coalesce(ma.car_ops, 0) AS maestra_car_ops,  coalesce(co.car_ops, 0) AS conci_car_ops,  of.car_ops AS oficial_car_ops,
       coalesce(ma.car_ton, 0) AS maestra_car_ton,  coalesce(co.car_ton, 0) AS conci_car_ton,  of.car_ton AS oficial_car_ton,
       coalesce(ma.sin_clasificar, 0) AS maestra_sin_tipo_reporte,
       coalesce(co.sin_clasificar, 0) AS conci_sin_clasificar,
       CASE WHEN of.com_ops > 0 THEN round(100.0 * (coalesce(ma.com_ops, 0) - of.com_ops) / of.com_ops, 2) END AS maestra_vs_oficial_com_ops_pct,
       CASE WHEN of.car_ops > 0 THEN round(100.0 * (coalesce(ma.car_ops, 0) - of.car_ops) / of.car_ops, 2) END AS maestra_vs_oficial_car_ops_pct,
       CASE
           WHEN coalesce(ma.manifiestos_con_aerolinea, 0) = 0 THEN 'VACÍO'
           WHEN coalesce(of.com_ops, 0) > 0 AND coalesce(ma.com_ops, 0) < 0.9 * of.com_ops THEN 'MUY POR DEBAJO'
           WHEN coalesce(of.car_ops, 0) > 0 AND coalesce(ma.car_ops, 0) < 0.9 * of.car_ops THEN 'MUY POR DEBAJO'
           WHEN coalesce(of.com_ops, 0) > 0 AND abs(coalesce(ma.com_ops, 0) - of.com_ops) > 0.02 * of.com_ops THEN 'REVISAR'
           WHEN coalesce(of.car_ops, 0) > 0 AND abs(coalesce(ma.car_ops, 0) - of.car_ops) > 0.02 * of.car_ops THEN 'REVISAR'
           WHEN coalesce(ma.sin_clasificar, 0) > 0 THEN 'REVISAR (tipo_reporte vacío)'
           ELSE 'OK'
       END AS alerta
  FROM lista l
  LEFT JOIN meses ma ON ma.fuente = 'MAESTRA'      AND ma.mes = l.mes
  LEFT JOIN meses co ON co.fuente = 'CONCILIACION' AND co.mes = l.mes
  LEFT JOIN oficial of ON of.mes = l.mes
 ORDER BY l.mes;

-- 2) ¿Las columnas 2026 de la maestra vienen como las de 2022-2025?
--    tipo_reporte debe ser PASAJEROS o CARGA en todas; FECHA legible; TOTAL PAX
--    y KG DE CARGA TOTAL convertibles a número cuando traen algo.
SELECT CASE WHEN public._aifa_parse_manifest_date(m."FECHA"::text) >= DATE '2026-01-01' THEN '2026' ELSE '2022-2025' END AS periodo,
       coalesce(m.tipo_reporte, '(vacío)')                                         AS tipo_reporte,
       count(*)                                                                     AS filas,
       count(*) FILTER (WHERE nullif(btrim(m."AEROLINEA"::text), '') IS NULL)       AS sin_aerolinea,
       count(*) FILTER (WHERE m."TOTAL PAX" IS NULL)                                AS sin_total_pax,
       count(*) FILTER (WHERE nullif(btrim(m."KG DE CARGA TOTAL"::text), '') IS NOT NULL
                          AND public._aifa_safe_numeric(m."KG DE CARGA TOTAL"::text) IS NULL) AS kg_no_numerico,
       count(*) FILTER (WHERE nullif(btrim(m."TIPO DE MANIFIESTO"::text), '') IS NULL) AS sin_tipo_manifiesto,
       min(m."FECHA"::text) FILTER (WHERE true)                                     AS ejemplo_fecha
  FROM public.maestra_manifiestos m
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- 3) De dónde saldrá la fecha de cada manifiesto, por fuente.
WITH f AS (
    SELECT 'MAESTRA' AS fuente, m."FECHA"::text AS fecha_texto, NULL::date AS portal
      FROM public.maestra_manifiestos m
    UNION ALL
    SELECT 'CONCILIACION', c."FECHA"::text, c."_portal_flight_date"::date
      FROM public."Conciliación Manifiestos" c
)
SELECT fuente,
       CASE
           WHEN btrim(coalesce(fecha_texto, '')) ~ '^\d{4}-\d{1,2}-\d{1,2}(\D|$)'
             OR btrim(coalesce(fecha_texto, '')) ~ '^\d{1,2}/\d{1,2}/\d{4}(\D|$)' THEN 'FECHA con año'
           WHEN portal IS NOT NULL THEN 'sin año → _portal_flight_date'
           ELSE 'ILEGIBLE (no entrará)'
       END AS origen_de_la_fecha,
       count(*) AS filas,
       (array_agg(DISTINCT fecha_texto))[1:5] AS ejemplos
  FROM f
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- 4) La maestra no debe traer nada después de su corte.
SELECT count(*) AS maestra_despues_del_corte
  FROM public.maestra_manifiestos m
 WHERE public._aifa_parse_manifest_date(m."FECHA"::text)
       > (SELECT nullif(btrim(valor::text, ' "'), '')::date FROM public.config_fuentes WHERE clave = 'fecha_corte_maestra');
