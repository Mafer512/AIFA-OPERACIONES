-- =====================================================================
-- 062b · SEGUIMIENTO (selecciona todo y Run; repítelo). No modifica nada.
-- Sirve para la 062b (tarea mig_062b_frontera) y para su reversa
-- (mig_062b_reversa).
--
-- Terminó bien cuando: en_agenda = 0 · trabajando = 0 · la bitácora
-- termina en "FIN: OK". Si dice ERROR, copia el texto completo.
-- =====================================================================
SELECT
    (SELECT count(*) FROM cron.job WHERE jobname IN ('mig_062b_frontera', 'mig_062b_reversa')) AS en_agenda,
    (SELECT count(*) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state <> 'idle'
        AND (query ILIKE '%mig_062b_frontera%' OR query ILIKE '%mig_062b_reversa%'))      AS trabajando,
    (SELECT max(now() - query_start) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state <> 'idle'
        AND (query ILIKE '%mig_062b_frontera%' OR query ILIKE '%mig_062b_reversa%'))      AS lleva,
    (SELECT string_agg(paso || ': ' || coalesce(detalle, 'ERROR → ' || error), E'\n' ORDER BY id)
       FROM public._mig_paso_log)                                                         AS bitacora;

SELECT status, left(return_message, 300) AS mensaje, start_time, end_time
  FROM cron.job_run_details
 WHERE command ILIKE '%mig_062b_%'
 ORDER BY start_time DESC
 LIMIT 3;

-- Después de "FIN: OK": así quedó la frontera.
SELECT fuente,
       min(fecha_operacion) AS desde,
       max(fecha_operacion) AS hasta,
       count(*)             AS manifiestos,
       count(*) FILTER (WHERE fecha_reporte IS DISTINCT FROM fecha_operacion) AS fecha_reporte_distinta
  FROM public.manifiestos_hechos
 GROUP BY fuente
 ORDER BY 2;

-- Filas que no entraron porque su FECHA no se puede leer.
SELECT fuente, count(*) AS filas FROM public.v_manifiestos_fecha_ilegible GROUP BY fuente;
