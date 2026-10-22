-- =============================================================================
-- 068 · Cierre de Subsecretaría desde el sistema · DIAGNÓSTICO (sólo lectura)
-- (selecciona todo y Run). No modifica nada.
--
-- Desde el 22/10/2026 el cierre lo hace el botón de Conciliación › Manifiestos
-- y los libros dejan de recargarse. Antes del primer corte conviene ver:
--   1. el último cierre registrado en el sistema (el botón no admite una fecha
--      igual o anterior);
--   2. el LOTE que entraría hoy al corte: todo lo capturado en la aplicación y
--      sin cerrar, por FECHA. Lo de FECHA vieja (antes del 19/10) es sospechoso:
--      el corte de hoy lo reportaría hoy;
--   3. los manifiestos de las recargas que el libro traía SIN cierre: quedaron
--      fuera del mecanismo y el botón NUNCA los cerraría (los incorpora 069).
-- El Inicio y la Numeralia no cambian con nada de esto: cuentan por FECHA.
-- =============================================================================

-- 1) Último cierre y frontera de activación.
SELECT 'ultimo cierre del sistema' AS concepto,
       (SELECT max(fecha_corte)::text FROM public.conciliacion_cierres_subsecretaria) AS valor
UNION ALL
SELECT 'cierres registrados', (SELECT count(*)::text FROM public.conciliacion_cierres_subsecretaria)
UNION ALL
SELECT 'activacion (baseline_en)', (SELECT baseline_en::text FROM public.conciliacion_cierre_config WHERE id)
UNION ALL
SELECT 'ajustes pendientes (entran al siguiente corte)',
       (SELECT count(*)::text FROM public.conciliacion_ajustes WHERE estado = 'pendiente');

-- 2) Lote que entraría HOY al corte, por FECHA.
WITH lote AS (
    SELECT m.*, public._aifa_fecha_manifiesto(m."FECHA"::text, m."_portal_flight_date"::date) AS fecha
      FROM public."Conciliación Manifiestos" m
     WHERE m.cierre_id IS NULL
       AND m.cierre_capturado_en IS NOT NULL
       AND m.cierre_capturado_en >= (SELECT baseline_en FROM public.conciliacion_cierre_config WHERE id)
)
SELECT fecha,
       count(*)                                                   AS manifiestos,
       count(*) FILTER (WHERE coalesce(public._aifa_safe_numeric("TOTAL PAX"::text), 0) > 0) AS con_pasajeros,
       sum(coalesce(public._aifa_safe_numeric("TOTAL PAX"::text), 0))                       AS pasajeros,
       round(sum(coalesce(public._aifa_safe_numeric("KG DE CARGA TOTAL"::text), 0)) / 1000, 2) AS toneladas,
       min(cierre_capturado_en)                                   AS capturado_desde,
       max(cierre_capturado_en)                                   AS capturado_hasta,
       CASE WHEN fecha < DATE '2026-10-19' THEN 'REVISAR: fecha vieja' ELSE '' END AS nota
  FROM lote
 GROUP BY fecha
 ORDER BY fecha NULLS FIRST;

-- 3) De las recargas, sin cierre y fuera del mecanismo (el botón no los toma).
SELECT public._aifa_fecha_manifiesto(m."FECHA"::text, m."_portal_flight_date"::date) AS fecha,
       count(*)                                                   AS manifiestos,
       count(*) FILTER (WHERE m.cierre_es_carga_reportado IS TRUE) AS de_carga,
       sum(coalesce(public._aifa_safe_numeric(m."TOTAL PAX"::text), 0)) AS pasajeros
  FROM public."Conciliación Manifiestos" m
 WHERE m.cierre_id IS NULL
   AND m.cierre_capturado_en IS NULL
   AND nullif(btrim(coalesce(m."CIERRE SUBSECRETARIA"::text, '')), '') IS NULL
   AND public._aifa_fecha_manifiesto(m."FECHA"::text, m."_portal_flight_date"::date) >= DATE '2026-10-01'
 GROUP BY 1
 ORDER BY 1;

-- 4) Cómo clasificaría el corte la CARGA capturada en la aplicación. Al cerrar,
--    _conci_clasificacion_reportable() decide carga/pasajeros sólo por el
--    catálogo (types con 'carga'). Aquí: lo capturado en la aplicación desde la
--    activación que parece de carga (sin pasajeros y con kilos), por AEROLINEA,
--    con lo que el corte le pondría.
SELECT m."AEROLINEA"                                                         AS aerolinea_capturada,
       public._conci_clasificacion_reportable(to_jsonb(m)) ->> 'aerolinea'    AS aerolinea_que_reportaria,
       public._conci_clasificacion_reportable(to_jsonb(m)) ->> 'es_carga'     AS el_corte_la_marcaria_carga,
       count(*)                                                              AS manifiestos,
       round(sum(coalesce(public._aifa_safe_numeric(m."KG DE CARGA TOTAL"::text), 0)) / 1000, 2) AS toneladas
  FROM public."Conciliación Manifiestos" m
 WHERE m.cierre_capturado_en IS NOT NULL
   AND coalesce(public._aifa_safe_numeric(m."TOTAL PAX"::text), 0) = 0
   AND coalesce(public._aifa_safe_numeric(m."KG DE CARGA TOTAL"::text), 0) > 0
 GROUP BY 1, 2, 3
 ORDER BY 3, 4 DESC;

-- 5) Catálogo de las aerolíneas de pasajeros que también llevan carga.
SELECT id, name, iata, types, aliases, active
  FROM public.conciliacion_catalogo_aerolineas
 WHERE upper(btrim(coalesce(iata, ''))) IN ('CM', 'XN', 'Y4', 'VB', 'AM', '5D', 'V0', 'G6')
    OR name ILIKE ANY (ARRAY['%copa%', '%mexicana%', '%volaris%', '%viva%', '%aerom%xico%', '%conviasa%', '%global crossing%'])
 ORDER BY iata, id;
