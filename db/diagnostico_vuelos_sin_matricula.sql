-- =============================================================================
-- Diagnóstico (solo lectura): vuelos del 10/10/2026 que siguen sin matrícula.
-- Según el AODB (Visits_12OCT26.csv): VB 7016/7304/7314/7017 cancelados,
-- VZ 8767 no operó, XN 1765 operó con XAMXH, EUS 001/002 sin operar.
-- Si aquí siguen como "Flight scheduled" y sin matrícula, ese archivo no se
-- ha importado o la importación no aplicó el cambio.
-- =============================================================================
SELECT v.id,
       v."Status"                       AS status_en_la_base,
       v."[Arr] Flight Designator"      AS llegada,
       v."[Arr] SIBT"                   AS sibt,
       v."[Arr] ALDT"                   AS aldt,
       v."[Dep] Flight Designator"      AS salida,
       v."[Dep] SOBT"                   AS sobt,
       v."[Dep] AOBT"                   AS aobt,
       v."Registration"                 AS matricula,
       v.import_reference_date          AS fecha_de_importacion,
       c."Status"                       AS status_en_la_cruda
  FROM public.manifiestos_vuelos_editable v
  LEFT JOIN public.vuelos_parte_operaciones_csv c ON c.id = v.id
 WHERE (v.arr_scheduled_date = DATE '2026-10-10' OR v.dep_scheduled_date = DATE '2026-10-10')
   AND (upper(replace(coalesce(v."[Arr] Flight Designator", ''), ' ', '')) IN ('VB7016','VB7304','VB7314','VB7017','VZ8767','XN1765','EUS001','AC7251')
     OR upper(replace(coalesce(v."[Dep] Flight Designator", ''), ' ', '')) IN ('VB7016','VB7304','VB7314','VB7017','VZ8768','EUS002','AC7251'))
 ORDER BY v.id;
