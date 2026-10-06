-- =============================================================================
-- 059 · Manifiestos — LLENADO de manifiestos_hechos y sus resúmenes
--
-- Selecciona todo y Run. Responde al instante: el trabajo lo hace la base en
-- segundo plano con pg_cron (no hay petición HTTP que el editor pueda cortar).
-- La tarea se quita sola de la agenda al arrancar.
--
-- Todo o nada: el llenado va en UN bloque DO con EXCEPTION. Si algo falla, se
-- deshace todo lo de ese bloque (las tablas quedan como estaban) y la bitácora
-- public._mig_paso_log guarda el paso y el error. Si termina bien, la última
-- línea de la bitácora es "FIN: OK".
--
-- Seguimiento (solo lectura, repítelo cuantas veces quieras):
--     059_manifiestos_hechos_seguimiento.sql
--
-- Idempotente: volver a correrlo vacía las tablas de hechos/resúmenes y las
-- llena otra vez desde cero. NO toca las tablas de origen.
--
-- Qué hace, en orden:
--   MH 1  toma el candado de refresco (no se encima con otro llenado)
--   MH 2  vacía manifiestos_hechos y los cuatro resúmenes
--   MH 3  maestra_manifiestos, FECHA ≤ 31/12/2025   (≈175 mil filas)
--   MH 4  "Conciliación Manifiestos", FECHA ≥ 01/01/2026
--   MH 5  los cuatro resúmenes, completos
--   MH 6  estadísticas del planificador (ANALYZE)
--
-- El refresco automático cada 10 minutos NO se agenda aquí: lo agenda la 060
-- al pasar los reportes a producción.
-- =============================================================================

DO $pre$
BEGIN
    IF to_regprocedure('public._mh_cargar(text,date,date,boolean)') IS NULL
       OR to_regclass('public.manifiestos_hechos') IS NULL THEN
        RAISE EXCEPTION 'Falta la 058 (manifiestos_hechos y _mh_cargar). Córrela primero.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron no está habilitado en este proyecto (Database → Extensions).';
    END IF;
END;
$pre$;

-- Bitácora limpia para este llenado (mismo patrón que las migraciones 08/14).
DELETE FROM public._mig_paso_log;

SELECT cron.schedule(
    'mig_manifiestos_hechos',
    '* * * * *',
    $job$
SELECT cron.unschedule('mig_manifiestos_hechos');
SET statement_timeout = 0;
SET lock_timeout = '120s';
SET max_parallel_workers_per_gather = 0;
DO $do$
DECLARE
    _paso text := 'MH 0 inicio';
    _ini  timestamptz := clock_timestamp();
    _r    jsonb;
BEGIN
    _paso := 'MH 1 candado';
    PERFORM pg_advisory_xact_lock(hashtext('manifiestos_hechos')::bigint);

    _paso := 'MH 2 vaciar';
    TRUNCATE public.manifiestos_hechos,
             public.manifiestos_resumen_dia,
             public.manifiestos_resumen_mes_aerolinea,
             public.manifiestos_resumen_mes_destino,
             public.manifiestos_resumen_mes_aerolinea_destino;

    _paso := 'MH 3 maestra_manifiestos (FECHA <= 2025)';
    _ini := clock_timestamp();
    _r := public._mh_cargar('MAESTRA', DATE '1900-01-01', DATE '2025-12-31', false);
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(), _r::text);

    _paso := 'MH 4 Conciliación Manifiestos (FECHA >= 2026)';
    _ini := clock_timestamp();
    _r := public._mh_cargar('CONCILIACION', DATE '2026-01-01', NULL, false);
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(), _r::text);

    _paso := 'MH 5 resumenes';
    _ini := clock_timestamp();
    PERFORM public._mh_recalcular_resumenes(NULL);
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(),
            (SELECT count(*) FROM public.manifiestos_resumen_dia) || ' renglones por día · '
            || (SELECT count(*) FROM public.manifiestos_resumen_mes_aerolinea) || ' mes+aerolínea · '
            || (SELECT count(*) FROM public.manifiestos_resumen_mes_destino) || ' mes+destino · '
            || (SELECT count(*) FROM public.manifiestos_resumen_mes_aerolinea_destino) || ' mes+aerolínea+destino');

    _paso := 'MH 6 analyze';
    _ini := clock_timestamp();
    BEGIN
        ANALYZE public.manifiestos_hechos;
        ANALYZE public.manifiestos_resumen_dia;
        ANALYZE public.manifiestos_resumen_mes_aerolinea;
        ANALYZE public.manifiestos_resumen_mes_destino;
        ANALYZE public.manifiestos_resumen_mes_aerolinea_destino;
    EXCEPTION WHEN OTHERS THEN
        NULL;  -- solo afina el planificador; autovacuum lo hará de todos modos
    END;
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(),
            (SELECT count(*) FROM public.manifiestos_hechos WHERE fuente = 'MAESTRA') || ' de maestra · '
            || (SELECT count(*) FROM public.manifiestos_hechos WHERE fuente = 'CONCILIACION') || ' de Conciliación');

    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES ('FIN', clock_timestamp(), clock_timestamp(), 'OK');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._mig_paso_log (paso, inicio, fin, error)
    VALUES (_paso, _ini, clock_timestamp(), SQLSTATE || ': ' || SQLERRM);
END
$do$;
$job$
);

-- Confirmación visible: un renglón = agendada; en ≤ 1 minuto arranca y
-- desaparece de aquí. Sigue con 059_manifiestos_hechos_seguimiento.sql.
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'mig_manifiestos_hechos';
