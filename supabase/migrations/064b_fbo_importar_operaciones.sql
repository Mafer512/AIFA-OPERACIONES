-- =============================================================================
-- 064b · Aviación General · FBO — importación del Layout a operaciones_fbo
--
-- REQUISITOS: public.operaciones_fbo (ya existe). Independiente de 064a.
-- REVERSA:    064_reversa_fbo.sql (borra sólo los objetos 064*, nunca datos)
--
-- Selecciona todo y Run. Es idempotente: se puede volver a correr.
--
-- QUÉ CREA
--   · fbo_previa_importacion(jsonb): para la vista previa. Recibe
--     [{registro, matricula, fecha_aterrizaje}] y devuelve
--       existentes    — registros del lote que ya están en la tabla;
--       coincidencias — operaciones YA guardadas con OTRO registro y la misma
--                       matrícula + fecha de aterrizaje (p. ej. la BASE2026-0855
--                       de la AG-2026-000004). Decide la pantalla: con
--                       exactamente una coincidencia se reemplaza; con varias,
--                       la fila se bloquea por ambigua.
--   · fbo_importar_operaciones(jsonb): en UNA transacción
--       1) borra las filas cuyo registro viene en el lote;
--       2) borra las filas cuyo registro viene en `reemplaza_registro` (sólo
--          las que la pantalla mostró como coincidencia única);
--       3) inserta el lote.
--     Devuelve {recibidas, insertados, reemplazados, reemplazados_por_coincidencia}.
--     Si algo falla no queda nada a medias. La pantalla manda bloques de 500.
--
-- Sin RLS, sin índices únicos, sin CHECK y sin FK. No altera la tabla.
-- fbo_importar_operaciones es SECURITY DEFINER para que funcione con
-- cualquier sesión (anon o authenticated) sin tocar los permisos de la
-- tabla; la seguridad del módulo se ajustará después.
-- =============================================================================

BEGIN;

DO $pre$
BEGIN
    IF to_regclass('public.operaciones_fbo') IS NULL THEN
        RAISE EXCEPTION '064b: falta la tabla public.operaciones_fbo.';
    END IF;
END
$pre$;


-- =============================================================================
-- 1) VISTA PREVIA
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_previa_importacion(p_filas jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
    WITH l AS (
        SELECT DISTINCT
               trim(e->>'registro')                        AS registro,
               upper(trim(e->>'matricula'))                AS matricula,
               nullif(e->>'fecha_aterrizaje', '')::date    AS fecha
          FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) e
         WHERE nullif(trim(e->>'registro'), '') IS NOT NULL
    )
    SELECT jsonb_build_object(
        'existentes', (
            SELECT coalesce(jsonb_agg(DISTINCT l.registro), '[]'::jsonb)
              FROM l
              JOIN public.operaciones_fbo o ON trim(o.registro) = l.registro
        ),
        'coincidencias', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'registro',           l.registro,
                       'registro_existente', trim(o.registro),
                       'fecha_aterrizaje',   o.fecha_aterrizaje,
                       'hora_aterrizaje',    o.hora_aterrizaje
                   ) ORDER BY l.registro, o.registro), '[]'::jsonb)
              FROM l
              JOIN public.operaciones_fbo o
                ON upper(trim(o.matricula)) = l.matricula
               AND o.fecha_aterrizaje      = l.fecha
             WHERE l.matricula <> ''
               AND trim(o.registro) <> l.registro
               -- Una operación que viene en el mismo lote no es "la otra".
               AND trim(o.registro) NOT IN (SELECT registro FROM l)
        )
    )
$fn$;

COMMENT ON FUNCTION public.fbo_previa_importacion(jsonb) IS
'Vista previa de la importación FBO: registros del lote que ya existen y operaciones guardadas con otro registro y la misma matrícula + fecha de aterrizaje. Sólo lee. (064b)';

GRANT EXECUTE ON FUNCTION public.fbo_previa_importacion(jsonb) TO anon, authenticated;


-- =============================================================================
-- 2) IMPORTACIÓN ATÓMICA
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_importar_operaciones(p_filas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_recibidas         integer;
    v_por_registro      integer := 0;
    v_por_coincidencia  integer := 0;
    v_insertadas        integer := 0;
BEGIN
    IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' THEN
        RAISE EXCEPTION 'fbo_importar_operaciones: p_filas debe ser un arreglo JSON.';
    END IF;

    v_recibidas := jsonb_array_length(p_filas);
    IF v_recibidas = 0 THEN
        RETURN jsonb_build_object('recibidas', 0, 'insertados', 0,
                                  'reemplazados', 0, 'reemplazados_por_coincidencia', 0);
    END IF;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_filas) e
                WHERE nullif(trim(e->>'registro'), '') IS NULL) THEN
        RAISE EXCEPTION 'fbo_importar_operaciones: hay filas sin registro.';
    END IF;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_filas) e
                GROUP BY trim(e->>'registro') HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'fbo_importar_operaciones: hay un registro repetido dentro del lote.';
    END IF;

    -- Sin índice único, dos importaciones simultáneas del mismo registro
    -- podrían borrar "nada" las dos e insertar dos veces. El candado de
    -- transacción las pone en fila: la segunda espera a que la primera termine.
    PERFORM pg_advisory_xact_lock(hashtext('public.fbo_importar_operaciones'));

    -- 1) Las que ya existen con el mismo registro se reemplazan.
    WITH lote AS (
        SELECT trim(e->>'registro') AS registro FROM jsonb_array_elements(p_filas) e
    ), borradas AS (
        DELETE FROM public.operaciones_fbo o
         USING lote l
         WHERE trim(o.registro) = l.registro
        RETURNING trim(o.registro) AS registro
    )
    SELECT count(DISTINCT registro) INTO v_por_registro FROM borradas;

    -- 2) La operación guardada con OTRO registro que la vista previa mostró
    --    como coincidencia única (misma matrícula + fecha de aterrizaje).
    WITH reemplaza AS (
        SELECT DISTINCT trim(e->>'reemplaza_registro') AS registro
          FROM jsonb_array_elements(p_filas) e
         WHERE nullif(trim(e->>'reemplaza_registro'), '') IS NOT NULL
    ), borradas AS (
        DELETE FROM public.operaciones_fbo o
         USING reemplaza r
         WHERE trim(o.registro) = r.registro
        RETURNING trim(o.registro) AS registro
    )
    SELECT count(DISTINCT registro) INTO v_por_coincidencia FROM borradas;

    -- 3) Inserción. Las claves del jsonb son los nombres de las columnas;
    --    las que sobran (reemplaza_registro) se ignoran.
    INSERT INTO public.operaciones_fbo (
        registro, operador, vuelo_operado_por, matricula, tipo_aeronave, tipo_ala,
        origen, nac_int_llegada, fecha_aterrizaje, hora_aterrizaje, hora_llegada_posicion,
        hora_desembarque, tiempo_desembarque,
        pax_llegada_adultos, pax_llegada_infantes, pax_llegada_totales,
        destino, nac_int_salida, fecha_salida_posicion, hora_embarque, hora_salida_posicion,
        hora_despegue, pax_salida_adultos, pax_salida_infantes, pax_salida_totales,
        pax_pagan_tua, tiempo_embarque, tiempo_permanencia_min,
        uds_traslado_pax, uds_acarreo_equipaje, mtow, mzfw, oficial_operaciones
    )
    SELECT trim(r.registro), r.operador, r.vuelo_operado_por, r.matricula, r.tipo_aeronave, r.tipo_ala,
           r.origen, r.nac_int_llegada, r.fecha_aterrizaje, r.hora_aterrizaje, r.hora_llegada_posicion,
           r.hora_desembarque, r.tiempo_desembarque,
           r.pax_llegada_adultos, r.pax_llegada_infantes, r.pax_llegada_totales,
           r.destino, r.nac_int_salida, r.fecha_salida_posicion, r.hora_embarque, r.hora_salida_posicion,
           r.hora_despegue, r.pax_salida_adultos, r.pax_salida_infantes, r.pax_salida_totales,
           r.pax_pagan_tua, r.tiempo_embarque, r.tiempo_permanencia_min,
           r.uds_traslado_pax, r.uds_acarreo_equipaje, round(r.mtow, 2), round(r.mzfw, 2), r.oficial_operaciones
      FROM jsonb_populate_recordset(NULL::public.operaciones_fbo, p_filas) r;
    GET DIAGNOSTICS v_insertadas = ROW_COUNT;

    RETURN jsonb_build_object(
        'recibidas',                     v_recibidas,
        'insertados',                    greatest(v_insertadas - v_por_registro - v_por_coincidencia, 0),
        'reemplazados',                  v_por_registro,
        'reemplazados_por_coincidencia', v_por_coincidencia
    );
END
$fn$;

COMMENT ON FUNCTION public.fbo_importar_operaciones(jsonb) IS
'Importa un bloque de operaciones FBO en una sola transacción: borra los registros del lote (y los reemplaza_registro aprobados en la vista previa) y los vuelve a insertar. Nunca duplica un registro. (064b)';

GRANT EXECUTE ON FUNCTION public.fbo_importar_operaciones(jsonb) TO anon, authenticated;

COMMIT;

SELECT 'fbo_previa_importacion' AS objeto, (to_regprocedure('public.fbo_previa_importacion(jsonb)') IS NOT NULL) AS existe
UNION ALL SELECT 'fbo_importar_operaciones', (to_regprocedure('public.fbo_importar_operaciones(jsonb)') IS NOT NULL);
