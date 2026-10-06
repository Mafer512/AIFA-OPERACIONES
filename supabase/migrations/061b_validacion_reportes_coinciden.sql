-- =====================================================================
-- 061b · VALIDACIÓN de que inicio, Informe y Estadística dicen lo mismo
-- (solo lectura). Se corre DESPUÉS de la 060; antes, las vistas del
-- Informe y de Estadística todavía son las viejas y saldrá REVISAR.
--
-- Por año de reporte, las operaciones desde cada capa deben ser iguales:
-- hechos directo · resumen por día · inicio · Informe · Estadística.
-- Estadística excluye las canceladas de "operaciones" (regla del módulo),
-- por eso se compara contra hechos sin canceladas.
-- =====================================================================
WITH h AS (
    SELECT anio,
           count(*) FILTER (WHERE es_operacion)                  AS ops,
           count(*) FILTER (WHERE es_operacion AND NOT cancelado) AS ops_sin_cancel,
           count(*) FILTER (WHERE NOT es_operacion)              AS filas_sin_aerolinea,
           count(*) FILTER (WHERE es_operacion AND cancelado)    AS canceladas
      FROM public.manifiestos_hechos GROUP BY anio
), d AS (
    SELECT anio, sum(operaciones) AS ops FROM public.manifiestos_resumen_dia GROUP BY anio
), i AS (
    SELECT extract(year FROM fecha)::int AS anio, sum(comercial_ops + carga_ops) AS ops
      FROM public.inicio_manifiestos_por_dia() GROUP BY 1
), inf AS (
    SELECT anio, sum(operaciones) AS ops FROM public.v_informe_estadistico_resumen GROUP BY anio
), est AS (
    SELECT anio, count(*) FILTER (WHERE NOT es_cancelada) AS ops FROM public.v_estadistica_operaciones GROUP BY anio
)
SELECT h.anio, h.ops AS hechos, d.ops AS resumen_dia, i.ops AS inicio, inf.ops AS informe,
       h.ops_sin_cancel AS hechos_sin_canceladas, est.ops AS estadistica,
       h.canceladas, h.filas_sin_aerolinea,
       CASE WHEN h.ops = d.ops AND h.ops = i.ops AND h.ops = inf.ops AND h.ops_sin_cancel = est.ops
            THEN 'OK' ELSE 'REVISAR' END AS estado
  FROM h
  LEFT JOIN d USING (anio) LEFT JOIN i USING (anio) LEFT JOIN inf USING (anio) LEFT JOIN est USING (anio)
 ORDER BY h.anio;
