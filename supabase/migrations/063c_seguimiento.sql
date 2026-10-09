-- =====================================================================
-- 063c · Seguimiento (SOLO LECTURA). Corre cada bloque por separado.
-- Termina bien cuando la bitácora dice "FIN: OK".
-- =====================================================================

-- 1) ¿Sigue en la agenda? (vacío = ya arrancó o ya terminó)
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname IN ('mig_063c_ajustada', 'estadistica_ajustada_refresco');

-- 2) Bitácora: paso, duración y error si lo hubo.
SELECT id, paso, inicio, fin, round(extract(epoch FROM fin - inicio)::numeric, 1) AS segundos, detalle, error
  FROM public._mig_paso_log
 ORDER BY id;

-- 3) Meses con aviso (oficial > 0 sin detalle): NO se inventó reparto.
SELECT anio, mes, segmento, oficial_ops, real_ops, oficial_pax, real_pax, oficial_ton, real_ton, aviso
  FROM public.estadistica_ajustada_mes
 WHERE aviso IS NOT NULL
 ORDER BY anio, mes, segmento;

-- 4) Último refresco.
SELECT refrescado_at, duracion_ms, pendiente_completo, detalle
  FROM public.estadistica_ajustada_control;
