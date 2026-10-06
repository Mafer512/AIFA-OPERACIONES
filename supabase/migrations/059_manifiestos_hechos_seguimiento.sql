-- =====================================================================
-- 059 · SEGUIMIENTO del llenado de manifiestos_hechos
-- (selecciona todo y Run; repítelo cuantas veces quieras). No modifica nada.
--
-- Terminó bien cuando:  en_agenda = 0 · trabajando = 0 · la bitácora
-- termina en "FIN: OK". Si dice ERROR, copia el texto completo.
-- =====================================================================
SELECT
    (SELECT count(*) FROM cron.job WHERE jobname = 'mig_manifiestos_hechos')   AS en_agenda,
    (SELECT count(*) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state <> 'idle'
        AND query ILIKE '%mig_manifiestos_hechos%')                            AS trabajando,
    (SELECT max(now() - query_start) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state <> 'idle'
        AND query ILIKE '%mig_manifiestos_hechos%')                            AS lleva,
    (SELECT string_agg(paso || ': ' || coalesce(detalle, 'ERROR → ' || error)
                       || ' (' || coalesce(to_char(fin - inicio, 'HH24:MI:SS'), '—') || ')',
                       ' · ' ORDER BY id)
       FROM public._mig_paso_log)                                              AS bitacora;

-- Último intento de pg_cron (por si la tarea ni siquiera llegó a la bitácora).
SELECT status, left(return_message, 300) AS mensaje, start_time, end_time
  FROM cron.job_run_details
 WHERE command ILIKE '%mig_manifiestos_hechos%'
 ORDER BY start_time DESC
 LIMIT 3;

-- Lo que hay hoy en la tabla de hechos, por fuente y año de reporte.
SELECT fuente,
       anio,
       count(*)                                         AS manifiestos,
       count(*) FILTER (WHERE es_operacion)             AS operaciones,
       count(*) FILTER (WHERE es_operacion AND es_carga) AS operaciones_carga,
       count(*) FILTER (WHERE fecha_cierre IS NOT NULL) AS con_cierre,
       count(*) FILTER (WHERE NOT destino_resuelto AND destino IS NOT NULL) AS destino_sin_catalogo,
       count(*) FILTER (WHERE aerolinea_catalogo_id IS NULL AND es_operacion) AS aerolinea_sin_catalogo
  FROM public.manifiestos_hechos
 GROUP BY 1, 2
 ORDER BY 2, 1;
