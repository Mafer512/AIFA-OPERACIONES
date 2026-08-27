-- Borrado total de Conciliación: vacía Itinerario y Manifiestos en una sola
-- transacción. El historial de auditoría se conserva; el trigger existente
-- registra la eliminación de cada manifiesto capturado.

CREATE OR REPLACE FUNCTION public.conciliacion_eliminar_todos_los_vuelos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_capturas_pendientes bigint := 0;
    v_ajustes_conciliacion bigint := 0;
    v_manifiestos_capturados bigint := 0;
    v_vuelos_manifiestos bigint := 0;
    v_itinerario bigint := 0;
    v_bitacora_importacion bigint := 0;
BEGIN
    IF auth.uid() IS NULL
       OR coalesce(public.conciliacion_manifiestos_access_level(auth.uid()), 'view') NOT IN ('edit', 'admin') THEN
        RAISE EXCEPTION 'No tienes permiso para eliminar todos los vuelos de Conciliación.'
            USING ERRCODE = '42501';
    END IF;

    -- Estas dos tablas son auxiliares y pueden no existir en instalaciones
    -- antiguas. Si existen, también deben vaciarse para evitar que una captura
    -- pendiente o un ajuste huérfano reaparezca después del borrado.
    IF to_regclass('public.conciliacion_capturas_pendientes') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM public.conciliacion_capturas_pendientes'
            INTO v_capturas_pendientes;
        EXECUTE 'DELETE FROM public.conciliacion_capturas_pendientes';
    END IF;

    IF to_regclass('public.conciliacion_vuelo_overrides') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM public.conciliacion_vuelo_overrides'
            INTO v_ajustes_conciliacion;
        EXECUTE 'DELETE FROM public.conciliacion_vuelo_overrides';
    END IF;

    SELECT count(*) INTO v_manifiestos_capturados
      FROM public."Conciliación Manifiestos";
    DELETE FROM public."Conciliación Manifiestos";

    SELECT count(*) INTO v_vuelos_manifiestos
      FROM public.manifiestos_vuelos_editable;
    DELETE FROM public.manifiestos_vuelos_editable;

    SELECT count(*) INTO v_itinerario
      FROM public.itinerario_vuelos_editable;
    DELETE FROM public.itinerario_vuelos_editable;

    SELECT count(*) INTO v_bitacora_importacion
      FROM public.vuelos_parte_operaciones_csv;
    DELETE FROM public.vuelos_parte_operaciones_csv;

    RETURN jsonb_build_object(
        'capturas_pendientes', v_capturas_pendientes,
        'ajustes_conciliacion', v_ajustes_conciliacion,
        'manifiestos_capturados', v_manifiestos_capturados,
        'vuelos_manifiestos', v_vuelos_manifiestos,
        'itinerario', v_itinerario,
        'bitacora_importacion', v_bitacora_importacion,
        'metodo', 'rpc_atomica'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_eliminar_todos_los_vuelos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_eliminar_todos_los_vuelos() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_eliminar_todos_los_vuelos() IS
    'Vacía Itinerario y Manifiestos, incluidos manifiestos capturados, preservando la auditoría.';
