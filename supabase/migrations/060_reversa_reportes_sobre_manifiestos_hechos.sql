-- =============================================================================
-- 060 · REVERSA — regresa los reportes a los objetos *_pre060
--
-- Selecciona todo y Run. La parte 1 es UNA sola transacción: o regresa todo,
-- o nada. La parte 2 (rellenar lo que estuvo congelado) va aparte.
--
-- Qué hace:
--   1. Quita de la agenda manifiestos_hechos_refresco y vuelve a agendar lo
--      que había en producción antes de la 060 (estado del 2026-10-05):
--        refrescar_informe_estadistico · '0 * * * *' ·
--        SELECT public.refrescar_informe_estadistico(true)
--      (refrescar_estadistica NO estaba agendada: no se agenda.)
--   2. Borra SOLO los objetos que creó la 060 (vistas y funciones nuevas).
--   3. Renombra cada *_pre060 a su nombre original, con ALTER TABLE / VIEW /
--      MATERIALIZED VIEW según su pg_class.relkind (mv_estadistica_operaciones
--      es una TABLA). Los objetos *_old de un cambio anterior NO se tocan.
--   4. Deja refrescar_estadistica y refrescar_informe_estadistico EXACTAMENTE
--      como estaban en producción antes de la 060 (definiciones copiadas aquí
--      como respaldo, por si su *_pre060 no existiera).
--   5. (Parte 2) Rellena lo que estuvo congelado mientras corría la 060: la
--      tabla mv_estadistica_operaciones desde v_estadistica_calculo y las
--      vistas materializadas del Informe.
--
-- NO borra manifiestos_hechos, sus resúmenes ni las funciones de la 058: se
-- pueden volver a usar corriendo otra vez la 060.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';
SET LOCAL max_parallel_workers_per_gather = 0;

DO $rev$
DECLARE
    v_fun  text[] := ARRAY[
        'estadistica_detalle(date, date, jsonb, integer, integer)',
        'estadistica_agregado(date, date, text[], jsonb, integer)',
        'estadistica_sin_clasificar(date, date, integer)',
        'estadistica_opciones_filtro(date, date)',
        'estadistica_diagnostico()',
        'refrescar_estadistica(boolean)',
        'refrescar_informe_estadistico(boolean)',
        'inicio_manifiestos_por_dia(date, date)'];
    v_rel  text[] := ARRAY[
        'v_estadistica_operaciones', 'mv_estadistica_operaciones',
        'v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen',
        'v_informe_estadistico_aerolinea', 'mv_informe_estadistico_base',
        'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea'];
    v_firma text;
    v_base  text;
    v_args  text;
    v_rel1  text;
    v_kind  "char";
BEGIN
    IF to_regclass('public.mv_estadistica_operaciones_pre060') IS NULL
       AND to_regclass('public.mv_informe_estadistico_base_pre060') IS NULL THEN
        RAISE EXCEPTION 'No hay objetos *_pre060: la 060 no está aplicada. Nada que revertir.';
    END IF;

    -- 1) Agenda: la de producción antes de la 060.
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'manifiestos_hechos_refresco';
        PERFORM cron.schedule('refrescar_informe_estadistico', '0 * * * *',
            $c$SELECT public.refrescar_informe_estadistico(true)$c$);
    END IF;

    -- 2) y 3) Funciones: la nueva se borra solo si existe su *_pre060.
    FOREACH v_firma IN ARRAY v_fun LOOP
        v_base := split_part(v_firma, '(', 1);
        v_args := '(' || split_part(v_firma, '(', 2);
        IF to_regprocedure('public.' || v_base || '_pre060' || v_args) IS NOT NULL THEN
            IF to_regprocedure('public.' || v_firma) IS NOT NULL THEN
                EXECUTE format('DROP FUNCTION public.%I%s', v_base, v_args);
            END IF;
            EXECUTE format('ALTER FUNCTION public.%I%s RENAME TO %I', v_base || '_pre060', v_args, v_base);
        END IF;
    END LOOP;

    -- Vistas: la nueva (siempre una VIEW simple) se borra solo si existe su *_pre060.
    FOREACH v_rel1 IN ARRAY v_rel LOOP
        IF to_regclass('public.' || v_rel1 || '_pre060') IS NULL THEN
            CONTINUE;
        END IF;
        SELECT c.relkind INTO v_kind FROM pg_class c WHERE c.oid = to_regclass('public.' || v_rel1);
        IF v_kind = 'v' THEN
            EXECUTE format('DROP VIEW public.%I', v_rel1);
        ELSIF v_kind IS NOT NULL THEN
            RAISE EXCEPTION '% no es una vista creada por la 060 (relkind %): revisar a mano.', v_rel1, v_kind;
        END IF;
    END LOOP;
    FOREACH v_rel1 IN ARRAY v_rel LOOP
        SELECT c.relkind INTO v_kind FROM pg_class c WHERE c.oid = to_regclass('public.' || v_rel1 || '_pre060');
        IF v_kind IS NULL THEN
            CONTINUE;
        ELSIF v_kind NOT IN ('r', 'p', 'v', 'm') THEN
            RAISE EXCEPTION '%_pre060 tiene un tipo inesperado (relkind %): revisar a mano.', v_rel1, v_kind;
        END IF;
        EXECUTE format('ALTER %s public.%I RENAME TO %I',
                       CASE v_kind WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END,
                       v_rel1 || '_pre060', v_rel1);
    END LOOP;
END;
$rev$;

-- -----------------------------------------------------------------------------
-- 4) Respaldo: las dos funciones de refresco tal como estaban en producción
--    antes de la 060 (pg_get_functiondef del 2026-10-05). Si el paso anterior
--    ya las regresó de *_pre060, esto deja exactamente el mismo cuerpo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refrescar_informe_estadistico(p_forzar boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_ultimo timestamptz;
    v_inicio timestamptz := clock_timestamp();
BEGIN
    SELECT refrescado_at INTO v_ultimo
    FROM public.informe_estadistico_refresco WHERE id;

    IF NOT p_forzar AND v_ultimo IS NOT NULL AND v_ultimo > now() - interval '2 minutes' THEN
        RETURN v_ultimo;  -- suficientemente fresco, no vale la pena recalcular
    END IF;

    -- Si ya hay otro refresco en curso, este se sale en vez de formarse: el que
    -- va corriendo va a dejar los datos igual de frescos.
    IF NOT pg_try_advisory_xact_lock(hashtext('informe_estadistico_refresco')::bigint) THEN
        RETURN v_ultimo;
    END IF;

    -- CONCURRENTLY deja seguir leyendo mientras se recalcula, pero PostgreSQL
    -- puede rechazarlo dentro de una transacción, y el cuerpo de una función
    -- siempre lo está (más aún dentro de un bloque con EXCEPTION, que abre una
    -- subtransacción). Si lo rechaza se cae al refresco normal: bloquea las
    -- lecturas los segundos que tarde, pero nunca deja de funcionar. Por eso el
    -- refresco automático va cada 10 minutos y no cada minuto.
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_informe_estadistico_base;
    EXCEPTION WHEN active_sql_transaction OR feature_not_supported THEN
        REFRESH MATERIALIZED VIEW public.mv_informe_estadistico_base;
    END;

    -- Los agregados son chicos: refresco normal, milisegundos.
    REFRESH MATERIALIZED VIEW public.mv_informe_estadistico_resumen;
    REFRESH MATERIALIZED VIEW public.mv_informe_estadistico_aerolinea;

    INSERT INTO public.informe_estadistico_refresco (id, refrescado_at, duracion_ms)
    VALUES (true, now(), (extract(epoch FROM clock_timestamp() - v_inicio) * 1000)::int)
    ON CONFLICT (id) DO UPDATE
        SET refrescado_at = excluded.refrescado_at,
            duracion_ms = excluded.duracion_ms;

    RETURN now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.refrescar_estadistica(p_forzar boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ultimo timestamptz;
    v_inicio timestamptz := clock_timestamp();
    v_desde  date := (now() AT TIME ZONE 'America/Mexico_City')::date - 60;
BEGIN
    IF public.estadistica_access_level(auth.uid()) NOT IN ('admin', 'edit') THEN
        RAISE EXCEPTION 'Acceso denegado: se requiere nivel edit o admin para refrescar la estadística.'
            USING ERRCODE = '42501';
    END IF;

    SELECT refrescado_at INTO v_ultimo FROM public.estadistica_refresco WHERE id = 1;

    -- Freno de 2 minutos contra refrescos encimados
    IF NOT p_forzar AND v_ultimo IS NOT NULL AND v_ultimo > now() - interval '2 minutes' THEN
        RETURN v_ultimo;
    END IF;

    -- Un solo refresco a la vez
    IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_estadistica')) THEN
        RETURN v_ultimo;
    END IF;

    PERFORM set_config('app.est_desde', v_desde::text, true);
    PERFORM set_config('app.est_hasta', '', true);

    DELETE FROM public.mv_estadistica_operaciones WHERE fecha_operacion >= v_desde;

    INSERT INTO public.mv_estadistica_operaciones
    SELECT * FROM public.v_estadistica_calculo;

    UPDATE public.estadistica_refresco
       SET refrescado_at = now(),
           refrescado_por = auth.uid(),
           duracion_ms = (extract(epoch FROM (clock_timestamp() - v_inicio)) * 1000)::int
     WHERE id = 1
     RETURNING refrescado_at INTO v_ultimo;

    RETURN v_ultimo;
END;
$function$;

REVOKE ALL ON FUNCTION public.refrescar_informe_estadistico(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refrescar_informe_estadistico(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.refrescar_estadistica(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refrescar_estadistica(boolean) TO authenticated;

COMMIT;

-- =============================================================================
-- PARTE 2 — Rellenar lo que estuvo congelado mientras corría la 060.
-- Va FUERA de la transacción de arriba: si el editor corta aquí, la reversa ya
-- quedó; el refresco agendado del Informe y el botón "Actualizar" de
-- Estadística terminan el trabajo.
-- =============================================================================

-- a) Estadística. mv_estadistica_operaciones es una TABLA que llena
--    v_estadistica_calculo (misma lógica que refrescar_estadistica, que aquí no
--    se puede llamar porque pide un usuario con nivel edit/admin). Se rellena
--    desde 60 días antes del último día que alcanzó a tener antes de la 060,
--    para cubrir todo el tiempo que estuvo congelada. Si fuera una vista
--    materializada, se refresca.
DO $relleno$
DECLARE
    v_kind  "char";
    v_desde date;
    v_inicio timestamptz := clock_timestamp();
BEGIN
    SELECT c.relkind INTO v_kind FROM pg_class c WHERE c.oid = to_regclass('public.mv_estadistica_operaciones');
    IF v_kind = 'm' THEN
        REFRESH MATERIALIZED VIEW public.mv_estadistica_operaciones;
    ELSIF v_kind IN ('r', 'p') THEN
        SELECT coalesce(max(fecha_operacion), (now() AT TIME ZONE 'America/Mexico_City')::date) - 60
          INTO v_desde
          FROM public.mv_estadistica_operaciones
         WHERE fecha_operacion <= (now() AT TIME ZONE 'America/Mexico_City')::date;
        PERFORM set_config('app.est_desde', v_desde::text, true);
        PERFORM set_config('app.est_hasta', '', true);
        DELETE FROM public.mv_estadistica_operaciones WHERE fecha_operacion >= v_desde;
        INSERT INTO public.mv_estadistica_operaciones
        SELECT * FROM public.v_estadistica_calculo;
    END IF;
    UPDATE public.estadistica_refresco
       SET refrescado_at = now(),
           duracion_ms = (extract(epoch FROM (clock_timestamp() - v_inicio)) * 1000)::int
     WHERE id = 1;
END;
$relleno$;

-- b) Informe: su propia función (no pide nivel de usuario).
SELECT public.refrescar_informe_estadistico(true);

-- Comprobación: todo regresó a su nombre y los *_pre060 ya no existen
-- (los *_old de antes siguen ahí, intactos).
SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND (c.relname LIKE 'mv_estadistica_operaciones%' OR c.relname LIKE 'v_estadistica_operaciones%'
        OR c.relname LIKE 'mv_informe_estadistico_%' OR c.relname LIKE 'v_informe_%')
 ORDER BY 1;

SELECT jobname, schedule, command FROM cron.job
 WHERE jobname IN ('refrescar_estadistica', 'refrescar_informe_estadistico', 'manifiestos_hechos_refresco');
