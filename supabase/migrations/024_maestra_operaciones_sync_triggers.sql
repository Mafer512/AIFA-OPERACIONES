-- =============================================================================
-- Fase 2 — Sincronización automática hacia maestra_operaciones (triggers)
--
-- NO se toca ningún archivo .js, ninguna prueba, ningún RLS/política de las
-- tablas existentes. La app sigue funcionando exactamente igual que hoy.
--
-- Se agregan 4 triggers AFTER INSERT OR UPDATE (mismas 4 tablas que migró
-- supabase/migrations/023_maestra_operaciones_migracion_fase1.sql): cada vez
-- que la app escribe en una tabla vieja, la fila correspondiente en
-- maestra_operaciones se actualiza sola. Cada función reutiliza EXACTAMENTE
-- la misma lógica de mapeo de 023 (mismas columnas, mismos cast defensivos,
-- mismo merge por COALESCE(existente, nuevo)), solo que operando sobre NEW
-- en vez de sobre toda la tabla.
--
-- No se propagan DELETE (ver plan: una fila de maestra puede tener aportes de
-- varias fuentes fusionadas; borrar por la baja de una sola fuente podría
-- destruir el aporte de otra).
--
-- Cada función está envuelta en BEGIN...EXCEPTION WHEN OTHERS para que un
-- error de sincronización NUNCA aborte la escritura real del usuario en la
-- tabla vieja (mismo principio de defensa en profundidad que ya usa el
-- trigger de auditoría _conciliacion_manifiestos_log_change).
--
-- Reutiliza sin modificar las funciones auxiliares ya creadas por 010 y 023:
-- _aifa_normalize_identity_part, _aifa_flight_number, _aifa_route_endpoint,
-- _aifa_parse_manifest_date, _aifa_manifest_direction, _aifa_movement_key,
-- _aifa_movement_key_from_endpoint, _aifa_safe_numeric, _aifa_safe_bigint,
-- _aifa_safe_timestamptz.
--
-- MODO DE USO: igual que 023 — correr completo primero (termina en
-- ROLLBACK), revisar el bloque de verificación, y solo cuando se vea bien
-- cambiar la última línea a COMMIT y volver a correr.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) "Conciliación Manifiestos" → maestra_operaciones  (cuerpo = Paso A de 023)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_sync_conciliacion_to_maestra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tipo_movimiento text;
    v_fecha date;
BEGIN
    BEGIN
        v_tipo_movimiento := CASE public._aifa_manifest_direction(NEW."TIPO DE MANIFIESTO")
            WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
        END;
        v_fecha := coalesce(NEW."_portal_flight_date", public._aifa_parse_manifest_date(NEW."FECHA"));

        -- fecha_operacion y tipo_movimiento son NOT NULL (+ CHECK) en maestra_operaciones.
        -- Si no se pudieron interpretar, no hay nada que sincronizar para esta fila.
        IF v_tipo_movimiento IS NULL OR v_fecha IS NULL THEN
            RETURN NEW;
        END IF;

        INSERT INTO public.maestra_operaciones (
            movement_key, conciliacion_manifiesto_legacy_id, fecha_operacion, tipo_movimiento,
            numero_vuelo, tipo_manifiesto, tipo_operacion, tipo_aeronave_codigo,
            matricula_id, matricula_origen, aerolinea_conciliacion_id, aerolinea_origen,
            slot_asignado, slot_coordinado, hora_pernocta, hora_embarque_desembarque,
            hora_operacion, hora_maxima_entrega, hora_recepcion, horas_cumplidas,
            estado_puntualidad, pax_total, pax_diplomaticos, pax_comision, pax_infantes,
            pax_transitos, pax_conexiones, pax_otros_exentos, pax_exentos_reportados,
            pax_pagan_tua_reportados, equipaje_kg, carga_total_kg, carga_nacional_kg,
            carga_internacional_kg, correo_kg, codigo_demora_origen, demora_catalogo_id,
            observaciones, capturado_por, evidencia_url, fecha_generacion, ruta_origen,
            origen_origen, destino_origen,
            portal_user_id, portal_empresa, portal_fecha_vuelo, portal_estatus,
            portal_notas_revision, portal_revisado_por, portal_revisado_at, portal_creado_at,
            portal_aprobacion_aifa, portal_aifa_por, portal_aifa_por_nombre, portal_aifa_at,
            portal_aifa_notas, portal_aprobacion_afac, portal_afac_por, portal_afac_por_nombre,
            portal_afac_at, portal_afac_notas, portal_manifiesto_datos,
            validado, fuente_principal, origenes, datos_origen
        )
        SELECT
            s."movement_key",
            s."id",
            v_fecha,
            v_tipo_movimiento,
            NULLIF(btrim(s."# DE VUELO"), ''),
            NULLIF(btrim(s."TIPO DE MANIFIESTO"), ''),
            NULLIF(btrim(s."TIPO DE OPERACIÓN"), ''),
            NULLIF(btrim(s."AERONAVE"), ''),
            mm.id,
            NULLIF(btrim(s."MATRÍCULA"), ''),
            ca.id,
            NULLIF(btrim(s."AEROLINEA"), ''),
            public._aifa_safe_timestamptz(s."SLOT ASIGNADO", v_fecha),
            public._aifa_safe_timestamptz(s."SLOT COORDINADO", v_fecha),
            public._aifa_safe_timestamptz(s."HR. DE INICIO O TERMINO DE PERNOCTA", v_fecha),
            public._aifa_safe_timestamptz(s."HR. DE EMBARQUE O DESEMBARQUE", v_fecha),
            public._aifa_safe_timestamptz(s."HR. DE OPERACIÓN", v_fecha),
            public._aifa_safe_timestamptz(s."HR. MÁXIMA DE ENTREGA", v_fecha),
            public._aifa_safe_timestamptz(s."HR. DE RECEPCIÓN", v_fecha),
            s."HRS. CUMPLIDAS"::numeric(12,3),
            NULLIF(btrim(s."PUNTUALIDAD / CANCELACIÓN"), ''),
            s."TOTAL PAX",
            public._aifa_safe_bigint(s."DIPLOMATICOS"),
            public._aifa_safe_bigint(s."EN COMISION"),
            public._aifa_safe_bigint(s."INFANTES"),
            public._aifa_safe_bigint(s."TRANSITOS"),
            public._aifa_safe_bigint(s."CONEXIONES"),
            public._aifa_safe_bigint(s."OTROS EXENTOS"),
            public._aifa_safe_bigint(s."TOTAL EXENTOS"),
            public._aifa_safe_bigint(s."PAX QUE PAGAN TUA"),
            s."KGS. DE EQUIPAJE",
            public._aifa_safe_numeric(s."KG DE CARGA TOTAL"),
            s."KGS. DE CARGA NACIONAL",
            s."KGS. DE CARGA INTERNACIONAL",
            public._aifa_safe_numeric(s."CORREO"),
            NULLIF(btrim(s."CÓDIGO DEMORA"), ''),
            cd.id,
            NULLIF(btrim(s."OBSERVACIONES"), ''),
            NULLIF(btrim(s."CAPTURÓ"), ''),
            NULLIF(btrim(s."EVIDENCIA"), ''),
            public._aifa_safe_timestamptz(s."Hora y Fecha Generación", v_fecha),
            NULLIF(btrim(s."RUTA"), ''),
            CASE WHEN v_tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(s."DESTINO / ORIGEN"), '') END,
            CASE WHEN v_tipo_movimiento = 'SALIDA' THEN NULLIF(btrim(s."DESTINO / ORIGEN"), '') END,
            s."_portal_user_id", s."_portal_company", s."_portal_flight_date", s."_portal_status",
            s."_portal_review_notes", s."_portal_reviewed_by", s."_portal_reviewed_at", s."_portal_created_at",
            s."_portal_aprob_aifa", s."_portal_aifa_by", s."_portal_aifa_by_name", s."_portal_aifa_at",
            s."_portal_aifa_notes", s."_portal_aprob_afac", s."_portal_afac_by", s."_portal_afac_by_name",
            s."_portal_afac_at", s."_portal_afac_notes", coalesce(s."_portal_manifest_data", '{}'::jsonb),
            true,
            'CONCILIACION_MANIFIESTOS',
            jsonb_build_array(jsonb_build_object('tabla', 'Conciliación Manifiestos', 'id', s."id")),
            jsonb_build_object('conciliacion_manifiestos', jsonb_strip_nulls(jsonb_build_object(
                'estatus_matricula', s."ESTATUS MATRÍCULA",
                'mes', s."MES",
                'demora_15_min', s."DEMORA +- 15 MIN.",
                'destino_origen_crudo', s."DESTINO / ORIGEN"
            )))
        FROM (SELECT (NEW).*) AS s
        LEFT JOIN public.matriculas_manifiestos mm
            ON public._aifa_normalize_identity_part(mm.matricula) = public._aifa_normalize_identity_part(s."MATRÍCULA")
        LEFT JOIN LATERAL (
            SELECT c.id FROM public.conciliacion_catalogo_aerolineas c
            WHERE lower(btrim(c.name)) = lower(btrim(s."AEROLINEA"))
               OR upper(btrim(coalesce(c.iata, ''))) = upper(btrim(s."AEROLINEA"))
               OR lower(btrim(s."AEROLINEA")) = ANY (SELECT lower(btrim(a)) FROM unnest(c.aliases) a)
            ORDER BY (lower(btrim(c.name)) = lower(btrim(s."AEROLINEA"))) DESC
            LIMIT 1
        ) ca ON true
        LEFT JOIN public.catalogo_demoras cd
            ON upper(btrim(cd.codigo)) = upper(btrim(s."CÓDIGO DEMORA"))
           AND cd.tipo_movimiento = v_tipo_movimiento
        ON CONFLICT (movement_key) WHERE movement_key IS NOT NULL DO UPDATE SET
            conciliacion_manifiesto_legacy_id = coalesce(maestra_operaciones.conciliacion_manifiesto_legacy_id, EXCLUDED.conciliacion_manifiesto_legacy_id),
            fecha_operacion            = coalesce(maestra_operaciones.fecha_operacion, EXCLUDED.fecha_operacion),
            tipo_movimiento             = coalesce(maestra_operaciones.tipo_movimiento, EXCLUDED.tipo_movimiento),
            numero_vuelo                = coalesce(maestra_operaciones.numero_vuelo, EXCLUDED.numero_vuelo),
            tipo_manifiesto              = coalesce(maestra_operaciones.tipo_manifiesto, EXCLUDED.tipo_manifiesto),
            tipo_operacion               = coalesce(maestra_operaciones.tipo_operacion, EXCLUDED.tipo_operacion),
            tipo_aeronave_codigo         = coalesce(maestra_operaciones.tipo_aeronave_codigo, EXCLUDED.tipo_aeronave_codigo),
            matricula_id                 = coalesce(maestra_operaciones.matricula_id, EXCLUDED.matricula_id),
            matricula_origen             = coalesce(maestra_operaciones.matricula_origen, EXCLUDED.matricula_origen),
            aerolinea_conciliacion_id    = coalesce(maestra_operaciones.aerolinea_conciliacion_id, EXCLUDED.aerolinea_conciliacion_id),
            aerolinea_origen             = coalesce(maestra_operaciones.aerolinea_origen, EXCLUDED.aerolinea_origen),
            slot_asignado                = coalesce(maestra_operaciones.slot_asignado, EXCLUDED.slot_asignado),
            slot_coordinado              = coalesce(maestra_operaciones.slot_coordinado, EXCLUDED.slot_coordinado),
            hora_pernocta                = coalesce(maestra_operaciones.hora_pernocta, EXCLUDED.hora_pernocta),
            hora_embarque_desembarque    = coalesce(maestra_operaciones.hora_embarque_desembarque, EXCLUDED.hora_embarque_desembarque),
            hora_operacion                = coalesce(maestra_operaciones.hora_operacion, EXCLUDED.hora_operacion),
            hora_maxima_entrega          = coalesce(maestra_operaciones.hora_maxima_entrega, EXCLUDED.hora_maxima_entrega),
            hora_recepcion                = coalesce(maestra_operaciones.hora_recepcion, EXCLUDED.hora_recepcion),
            horas_cumplidas              = coalesce(maestra_operaciones.horas_cumplidas, EXCLUDED.horas_cumplidas),
            estado_puntualidad           = coalesce(maestra_operaciones.estado_puntualidad, EXCLUDED.estado_puntualidad),
            pax_total                    = coalesce(maestra_operaciones.pax_total, EXCLUDED.pax_total),
            pax_diplomaticos             = coalesce(maestra_operaciones.pax_diplomaticos, EXCLUDED.pax_diplomaticos),
            pax_comision                 = coalesce(maestra_operaciones.pax_comision, EXCLUDED.pax_comision),
            pax_infantes                 = coalesce(maestra_operaciones.pax_infantes, EXCLUDED.pax_infantes),
            pax_transitos                = coalesce(maestra_operaciones.pax_transitos, EXCLUDED.pax_transitos),
            pax_conexiones               = coalesce(maestra_operaciones.pax_conexiones, EXCLUDED.pax_conexiones),
            pax_otros_exentos            = coalesce(maestra_operaciones.pax_otros_exentos, EXCLUDED.pax_otros_exentos),
            pax_exentos_reportados      = coalesce(maestra_operaciones.pax_exentos_reportados, EXCLUDED.pax_exentos_reportados),
            pax_pagan_tua_reportados    = coalesce(maestra_operaciones.pax_pagan_tua_reportados, EXCLUDED.pax_pagan_tua_reportados),
            equipaje_kg                  = coalesce(maestra_operaciones.equipaje_kg, EXCLUDED.equipaje_kg),
            carga_total_kg               = coalesce(maestra_operaciones.carga_total_kg, EXCLUDED.carga_total_kg),
            carga_nacional_kg            = coalesce(maestra_operaciones.carga_nacional_kg, EXCLUDED.carga_nacional_kg),
            carga_internacional_kg       = coalesce(maestra_operaciones.carga_internacional_kg, EXCLUDED.carga_internacional_kg),
            correo_kg                    = coalesce(maestra_operaciones.correo_kg, EXCLUDED.correo_kg),
            codigo_demora_origen         = coalesce(maestra_operaciones.codigo_demora_origen, EXCLUDED.codigo_demora_origen),
            demora_catalogo_id           = coalesce(maestra_operaciones.demora_catalogo_id, EXCLUDED.demora_catalogo_id),
            observaciones                = coalesce(maestra_operaciones.observaciones, EXCLUDED.observaciones),
            capturado_por                = coalesce(maestra_operaciones.capturado_por, EXCLUDED.capturado_por),
            evidencia_url                = coalesce(maestra_operaciones.evidencia_url, EXCLUDED.evidencia_url),
            fecha_generacion             = coalesce(maestra_operaciones.fecha_generacion, EXCLUDED.fecha_generacion),
            ruta_origen                  = coalesce(maestra_operaciones.ruta_origen, EXCLUDED.ruta_origen),
            origen_origen                 = coalesce(maestra_operaciones.origen_origen, EXCLUDED.origen_origen),
            destino_origen                = coalesce(maestra_operaciones.destino_origen, EXCLUDED.destino_origen),
            portal_user_id                = coalesce(maestra_operaciones.portal_user_id, EXCLUDED.portal_user_id),
            portal_empresa                = coalesce(maestra_operaciones.portal_empresa, EXCLUDED.portal_empresa),
            portal_fecha_vuelo           = coalesce(maestra_operaciones.portal_fecha_vuelo, EXCLUDED.portal_fecha_vuelo),
            portal_estatus                = coalesce(maestra_operaciones.portal_estatus, EXCLUDED.portal_estatus),
            portal_notas_revision        = coalesce(maestra_operaciones.portal_notas_revision, EXCLUDED.portal_notas_revision),
            portal_revisado_por          = coalesce(maestra_operaciones.portal_revisado_por, EXCLUDED.portal_revisado_por),
            portal_revisado_at           = coalesce(maestra_operaciones.portal_revisado_at, EXCLUDED.portal_revisado_at),
            portal_creado_at              = coalesce(maestra_operaciones.portal_creado_at, EXCLUDED.portal_creado_at),
            portal_aprobacion_aifa       = coalesce(maestra_operaciones.portal_aprobacion_aifa, EXCLUDED.portal_aprobacion_aifa),
            portal_aifa_por               = coalesce(maestra_operaciones.portal_aifa_por, EXCLUDED.portal_aifa_por),
            portal_aifa_por_nombre       = coalesce(maestra_operaciones.portal_aifa_por_nombre, EXCLUDED.portal_aifa_por_nombre),
            portal_aifa_at                = coalesce(maestra_operaciones.portal_aifa_at, EXCLUDED.portal_aifa_at),
            portal_aifa_notas             = coalesce(maestra_operaciones.portal_aifa_notas, EXCLUDED.portal_aifa_notas),
            portal_aprobacion_afac       = coalesce(maestra_operaciones.portal_aprobacion_afac, EXCLUDED.portal_aprobacion_afac),
            portal_afac_por               = coalesce(maestra_operaciones.portal_afac_por, EXCLUDED.portal_afac_por),
            portal_afac_por_nombre       = coalesce(maestra_operaciones.portal_afac_por_nombre, EXCLUDED.portal_afac_por_nombre),
            portal_afac_at                = coalesce(maestra_operaciones.portal_afac_at, EXCLUDED.portal_afac_at),
            portal_afac_notas             = coalesce(maestra_operaciones.portal_afac_notas, EXCLUDED.portal_afac_notas),
            portal_manifiesto_datos      = maestra_operaciones.portal_manifiesto_datos || EXCLUDED.portal_manifiesto_datos,
            validado                     = coalesce(maestra_operaciones.validado, EXCLUDED.validado),
            origenes                     = maestra_operaciones.origenes || EXCLUDED.origenes,
            datos_origen                 = maestra_operaciones.datos_origen || EXCLUDED.datos_origen;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync maestra_operaciones (Conciliación Manifiestos id=%): %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aifa_sync_conciliacion_to_maestra ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_aifa_sync_conciliacion_to_maestra
    AFTER INSERT OR UPDATE ON public."Conciliación Manifiestos"
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_conciliacion_to_maestra();

-- -----------------------------------------------------------------------------
-- 2) itinerario_vuelos_editable → maestra_operaciones  (cuerpo = Paso B de 023)
--    Una fila de origen puede producir hasta 2 filas (LLEGADA/SALIDA).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_sync_itinerario_to_maestra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_arr_numero text;
    v_dep_numero text;
    v_raw jsonb;
BEGIN
    BEGIN
        v_arr_numero := public._aifa_flight_number(NEW."[Arr] Flight Designator", NEW."[Arr] Airline code");
        v_dep_numero := public._aifa_flight_number(NEW."[Dep] Flight Designator", NEW."[Dep] Airline code");
        v_raw := to_jsonb(NEW);

        -- Lado LLEGADA
        IF NULLIF(btrim(coalesce(NEW."[Arr] Flight Designator", '')), '') IS NOT NULL
           AND NEW.arr_scheduled_date IS NOT NULL THEN
            INSERT INTO public.maestra_operaciones (
                movement_key, aodb_legacy_id, tipo_movimiento, fecha_operacion, numero_vuelo,
                estatus_vuelo, posicion, puertas, bandas_equipaje, tipo_servicio_origen,
                routing, tipo_aeronave_codigo, matricula_origen,
                validado, validado_por, validado_at,
                fuente_principal, origenes, datos_origen
            )
            VALUES (
                NEW.arr_movement_key, NEW.id, 'LLEGADA', NEW.arr_scheduled_date, v_arr_numero,
                NEW."Status", NEW."[Arr] Stand", NEW."[Arr] Gates", NEW."[Arr] Baggage Belts", NEW."[Arr] Service Type",
                NEW."Routing", NEW."Aircraft type", NEW."Registration",
                coalesce(NEW.validado, false), NEW.validado_por, NEW.validado_at,
                'ITINERARIO_VUELOS_EDITABLE',
                jsonb_build_array(jsonb_build_object('tabla', 'itinerario_vuelos_editable', 'id', NEW.id, 'lado', 'Arr')),
                jsonb_build_object('itinerario_vuelos_editable', v_raw)
            )
            ON CONFLICT (movement_key) WHERE movement_key IS NOT NULL DO UPDATE SET
                aodb_legacy_id        = coalesce(maestra_operaciones.aodb_legacy_id, EXCLUDED.aodb_legacy_id),
                fecha_operacion        = coalesce(maestra_operaciones.fecha_operacion, EXCLUDED.fecha_operacion),
                numero_vuelo           = coalesce(maestra_operaciones.numero_vuelo, EXCLUDED.numero_vuelo),
                estatus_vuelo          = coalesce(maestra_operaciones.estatus_vuelo, EXCLUDED.estatus_vuelo),
                posicion               = coalesce(maestra_operaciones.posicion, EXCLUDED.posicion),
                puertas                = coalesce(maestra_operaciones.puertas, EXCLUDED.puertas),
                bandas_equipaje        = coalesce(maestra_operaciones.bandas_equipaje, EXCLUDED.bandas_equipaje),
                tipo_servicio_origen   = coalesce(maestra_operaciones.tipo_servicio_origen, EXCLUDED.tipo_servicio_origen),
                routing                = coalesce(maestra_operaciones.routing, EXCLUDED.routing),
                tipo_aeronave_codigo   = coalesce(maestra_operaciones.tipo_aeronave_codigo, EXCLUDED.tipo_aeronave_codigo),
                matricula_origen       = coalesce(maestra_operaciones.matricula_origen, EXCLUDED.matricula_origen),
                validado               = coalesce(maestra_operaciones.validado, EXCLUDED.validado),
                validado_por           = coalesce(maestra_operaciones.validado_por, EXCLUDED.validado_por),
                validado_at            = coalesce(maestra_operaciones.validado_at, EXCLUDED.validado_at),
                origenes               = maestra_operaciones.origenes || EXCLUDED.origenes,
                datos_origen           = maestra_operaciones.datos_origen || EXCLUDED.datos_origen;
        END IF;

        -- Lado SALIDA
        IF NULLIF(btrim(coalesce(NEW."[Dep] Flight Designator", '')), '') IS NOT NULL
           AND NEW.dep_scheduled_date IS NOT NULL THEN
            INSERT INTO public.maestra_operaciones (
                movement_key, aodb_legacy_id, tipo_movimiento, fecha_operacion, numero_vuelo,
                estatus_vuelo, posicion, puertas, bandas_equipaje, tipo_servicio_origen,
                routing, tipo_aeronave_codigo, matricula_origen,
                validado, validado_por, validado_at,
                fuente_principal, origenes, datos_origen
            )
            VALUES (
                NEW.dep_movement_key, NEW.id, 'SALIDA', NEW.dep_scheduled_date, v_dep_numero,
                NEW."Status", NEW."[Dep] Stand", NEW."[Dep] Gates", NULL, NEW."[Dep] Service Type",
                NEW."Routing", NEW."Aircraft type", NEW."Registration",
                coalesce(NEW.validado, false), NEW.validado_por, NEW.validado_at,
                'ITINERARIO_VUELOS_EDITABLE',
                jsonb_build_array(jsonb_build_object('tabla', 'itinerario_vuelos_editable', 'id', NEW.id, 'lado', 'Dep')),
                jsonb_build_object('itinerario_vuelos_editable', v_raw)
            )
            ON CONFLICT (movement_key) WHERE movement_key IS NOT NULL DO UPDATE SET
                aodb_legacy_id        = coalesce(maestra_operaciones.aodb_legacy_id, EXCLUDED.aodb_legacy_id),
                fecha_operacion        = coalesce(maestra_operaciones.fecha_operacion, EXCLUDED.fecha_operacion),
                numero_vuelo           = coalesce(maestra_operaciones.numero_vuelo, EXCLUDED.numero_vuelo),
                estatus_vuelo          = coalesce(maestra_operaciones.estatus_vuelo, EXCLUDED.estatus_vuelo),
                posicion               = coalesce(maestra_operaciones.posicion, EXCLUDED.posicion),
                puertas                = coalesce(maestra_operaciones.puertas, EXCLUDED.puertas),
                bandas_equipaje        = coalesce(maestra_operaciones.bandas_equipaje, EXCLUDED.bandas_equipaje),
                tipo_servicio_origen   = coalesce(maestra_operaciones.tipo_servicio_origen, EXCLUDED.tipo_servicio_origen),
                routing                = coalesce(maestra_operaciones.routing, EXCLUDED.routing),
                tipo_aeronave_codigo   = coalesce(maestra_operaciones.tipo_aeronave_codigo, EXCLUDED.tipo_aeronave_codigo),
                matricula_origen       = coalesce(maestra_operaciones.matricula_origen, EXCLUDED.matricula_origen),
                validado               = coalesce(maestra_operaciones.validado, EXCLUDED.validado),
                validado_por           = coalesce(maestra_operaciones.validado_por, EXCLUDED.validado_por),
                validado_at            = coalesce(maestra_operaciones.validado_at, EXCLUDED.validado_at),
                origenes               = maestra_operaciones.origenes || EXCLUDED.origenes,
                datos_origen           = maestra_operaciones.datos_origen || EXCLUDED.datos_origen;
        END IF;

        -- Enlaza el par LLEGADA/SALIDA que acaba de generar esta fila (acotado
        -- a este id de origen, no a toda la tabla como en la migración 023).
        UPDATE public.maestra_operaciones m1
        SET movimiento_relacionado_id = m2.id
        FROM public.maestra_operaciones m2
        WHERE m1.aodb_legacy_id = NEW.id
          AND m2.aodb_legacy_id = NEW.id
          AND m1.fuente_principal = 'ITINERARIO_VUELOS_EDITABLE'
          AND m2.fuente_principal = 'ITINERARIO_VUELOS_EDITABLE'
          AND m1.tipo_movimiento <> m2.tipo_movimiento
          AND m1.movimiento_relacionado_id IS NULL;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync maestra_operaciones (itinerario_vuelos_editable id=%): %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aifa_sync_itinerario_to_maestra ON public.itinerario_vuelos_editable;
CREATE TRIGGER trg_aifa_sync_itinerario_to_maestra
    AFTER INSERT OR UPDATE ON public.itinerario_vuelos_editable
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_itinerario_to_maestra();

-- -----------------------------------------------------------------------------
-- 3) manifiestos_carga → maestra_operaciones  (cuerpo = Paso C de 023)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_sync_manifiestos_carga_to_maestra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_direction text;
    v_tipo_movimiento text;
    v_movement_key text;
BEGIN
    BEGIN
        v_direction := public._aifa_manifest_direction(NEW.direccion);
        v_tipo_movimiento := CASE v_direction WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL END;
        v_movement_key := public._aifa_movement_key_from_endpoint(
            NEW.aerolinea_codigo, NEW.numero_vuelo, NEW.fecha_vuelo, v_direction, NEW.aeropuerto_referencia
        );

        IF v_movement_key IS NULL THEN
            RETURN NEW;
        END IF;

        INSERT INTO public.maestra_operaciones (
            movement_key, fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto,
            aerolinea_origen, tipo_aeronave_codigo, matricula_origen, matricula_id,
            pax_total, equipaje_kg, carga_total_kg, correo_kg,
            portal_estatus, portal_empresa, portal_user_id,
            fuente_principal, origenes, datos_origen
        )
        SELECT
            v_movement_key, NEW.fecha_vuelo, v_tipo_movimiento, NULLIF(btrim(NEW.numero_vuelo), ''), NULLIF(btrim(NEW.tipo_manifesto), ''),
            coalesce(NULLIF(btrim(NEW.aerolinea_nombre), ''), NULLIF(btrim(NEW.aerolinea_codigo), '')),
            NULLIF(btrim(NEW.aeronave), ''), NULLIF(btrim(NEW.matricula), ''), mm.id,
            NULLIF(round(NEW.total_pasajeros)::bigint, 0),
            NULLIF(NEW.total_equipaje_kg, 0), NULLIF(NEW.total_carga_kg, 0), NULLIF(NEW.total_correo_kg, 0),
            NEW.estado, NEW.empresa, NEW.user_id,
            'MANIFIESTOS_CARGA',
            jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_carga', 'id', NEW.id)),
            jsonb_build_object('manifiestos_carga', jsonb_strip_nulls(jsonb_build_object(
                'folio', NEW.folio, 'legacy_manifest_id', NEW.legacy_manifest_id,
                'aerolinea_codigo', NEW.aerolinea_codigo, 'aeropuerto_referencia', NEW.aeropuerto_referencia,
                'datos', NEW.datos
            )))
        FROM (SELECT 1) _dummy
        LEFT JOIN public.matriculas_manifiestos mm
            ON public._aifa_normalize_identity_part(mm.matricula) = public._aifa_normalize_identity_part(NEW.matricula)
        ON CONFLICT (movement_key) WHERE movement_key IS NOT NULL DO UPDATE SET
            tipo_manifiesto        = coalesce(maestra_operaciones.tipo_manifiesto, EXCLUDED.tipo_manifiesto),
            aerolinea_origen       = coalesce(maestra_operaciones.aerolinea_origen, EXCLUDED.aerolinea_origen),
            tipo_aeronave_codigo   = coalesce(maestra_operaciones.tipo_aeronave_codigo, EXCLUDED.tipo_aeronave_codigo),
            matricula_origen       = coalesce(maestra_operaciones.matricula_origen, EXCLUDED.matricula_origen),
            matricula_id           = coalesce(maestra_operaciones.matricula_id, EXCLUDED.matricula_id),
            pax_total              = coalesce(maestra_operaciones.pax_total, EXCLUDED.pax_total),
            equipaje_kg            = coalesce(maestra_operaciones.equipaje_kg, EXCLUDED.equipaje_kg),
            carga_total_kg         = coalesce(maestra_operaciones.carga_total_kg, EXCLUDED.carga_total_kg),
            correo_kg              = coalesce(maestra_operaciones.correo_kg, EXCLUDED.correo_kg),
            portal_estatus         = coalesce(maestra_operaciones.portal_estatus, EXCLUDED.portal_estatus),
            portal_empresa         = coalesce(maestra_operaciones.portal_empresa, EXCLUDED.portal_empresa),
            portal_user_id         = coalesce(maestra_operaciones.portal_user_id, EXCLUDED.portal_user_id),
            origenes                = maestra_operaciones.origenes || EXCLUDED.origenes,
            datos_origen            = maestra_operaciones.datos_origen || EXCLUDED.datos_origen;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync maestra_operaciones (manifiestos_carga id=%): %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aifa_sync_manifiestos_carga_to_maestra ON public.manifiestos_carga;
CREATE TRIGGER trg_aifa_sync_manifiestos_carga_to_maestra
    AFTER INSERT OR UPDATE ON public.manifiestos_carga
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_manifiestos_carga_to_maestra();

-- -----------------------------------------------------------------------------
-- 4) manifiestos_pasajeros → maestra_operaciones  (cuerpo = Paso D de 023)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_sync_manifiestos_pasajeros_to_maestra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_direction text;
    v_tipo_movimiento text;
    v_movement_key text;
    v_pax_diplomaticos bigint;
    v_pax_comision bigint;
    v_pax_infantes bigint;
    v_pax_transitos bigint;
    v_pax_conexiones bigint;
    v_pax_otros_exentos bigint;
    v_pax_total bigint;
BEGIN
    BEGIN
        v_direction := public._aifa_manifest_direction(NEW.direccion);
        v_tipo_movimiento := CASE v_direction WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL END;
        v_movement_key := public._aifa_movement_key_from_endpoint(
            NEW.aerolinea_codigo, NEW.numero_vuelo, NEW.fecha_vuelo, v_direction, NEW.aeropuerto_referencia
        );

        IF v_movement_key IS NULL THEN
            RETURN NEW;
        END IF;

        v_pax_diplomaticos  := NULLIF(coalesce(NEW.pax_dip_nac, 0) + coalesce(NEW.pax_dip_int, 0), 0);
        v_pax_comision      := NULLIF(coalesce(NEW.pax_com_nac, 0) + coalesce(NEW.pax_com_int, 0), 0);
        v_pax_infantes      := NULLIF(coalesce(NEW.pax_inf_nac, 0) + coalesce(NEW.pax_inf_int, 0), 0);
        v_pax_transitos     := NULLIF(coalesce(NEW.pax_tra_nac, 0) + coalesce(NEW.pax_tra_int, 0), 0);
        v_pax_conexiones    := NULLIF(coalesce(NEW.pax_con_nac, 0) + coalesce(NEW.pax_con_int, 0), 0);
        v_pax_otros_exentos := NULLIF(coalesce(NEW.pax_exe_nac, 0) + coalesce(NEW.pax_exe_int, 0), 0);
        v_pax_total         := NULLIF(coalesce(NEW.pax_tot_nac, 0) + coalesce(NEW.pax_tot_int, 0), 0);

        INSERT INTO public.maestra_operaciones (
            movement_key, fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto,
            aerolinea_origen, tipo_aeronave_codigo, matricula_origen, matricula_id,
            pax_total, pax_diplomaticos, pax_comision, pax_infantes, pax_transitos,
            pax_conexiones, pax_otros_exentos, equipaje_kg, carga_total_kg, correo_kg,
            portal_estatus, portal_empresa, portal_user_id,
            fuente_principal, origenes, datos_origen
        )
        SELECT
            v_movement_key, NEW.fecha_vuelo, v_tipo_movimiento, NULLIF(btrim(NEW.numero_vuelo), ''), NULLIF(btrim(NEW.tipo_manifesto), ''),
            coalesce(NULLIF(btrim(NEW.aerolinea_nombre), ''), NULLIF(btrim(NEW.aerolinea_codigo), '')),
            NULLIF(btrim(NEW.aeronave), ''), NULLIF(btrim(NEW.matricula), ''), mm.id,
            coalesce(v_pax_total, NULLIF(round(NEW.total_pasajeros)::bigint, 0)),
            v_pax_diplomaticos, v_pax_comision, v_pax_infantes, v_pax_transitos,
            v_pax_conexiones, v_pax_otros_exentos,
            coalesce(NULLIF(NEW.kgs_equipaje, 0), NULLIF(NEW.total_equipaje_kg, 0)),
            coalesce(NULLIF(NEW.kgs_carga, 0), NULLIF(NEW.total_carga_kg, 0)),
            coalesce(NULLIF(NEW.kgs_correo, 0), NULLIF(NEW.total_correo_kg, 0)),
            NEW.estado, NEW.empresa, NEW.user_id,
            'MANIFIESTOS_PASAJEROS',
            jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_pasajeros', 'id', NEW.id)),
            jsonb_build_object('manifiestos_pasajeros', jsonb_strip_nulls(jsonb_build_object(
                'comandante', NEW.comandante, 'num_licencia', NEW.num_licencia, 'tripulacion_ps', NEW.tripulacion_ps,
                'clase_servicio', NEW.clase_servicio, 'explotador', NEW.explotador,
                'aeropuerto_origen', NEW.aeropuerto_origen, 'oaci_origen', NEW.oaci_origen,
                'aeropuerto_escala', NEW.aeropuerto_escala, 'oaci_escala', NEW.oaci_escala,
                'aeropuerto_destino', NEW.aeropuerto_destino, 'oaci_destino', NEW.oaci_destino,
                'h_itin', NEW.h_itin, 'h_real', NEW.h_real, 'h_calzos', NEW.h_calzos, 'h_puerta', NEW.h_puerta,
                'posicion', NEW.posicion, 'motivo_demora', NEW.motivo_demora, 'fbo', NEW.fbo,
                'demora1_codigo', NEW.demora1_codigo, 'demora1_tiempo', NEW.demora1_tiempo,
                'demora2_codigo', NEW.demora2_codigo, 'demora2_tiempo', NEW.demora2_tiempo,
                'pasajeros_primera', NEW.pasajeros_primera, 'pasajeros_turista', NEW.pasajeros_turista,
                'pasajeros_menores', NEW.pasajeros_menores, 'pasajeros_infantes', NEW.pasajeros_infantes,
                'pasajeros_tercera_edad', NEW.pasajeros_tercera_edad, 'pasajeros_discapacitados', NEW.pasajeros_discapacitados,
                'pasajeros_total', NEW.pasajeros_total, 'firma_elaboro', NEW.firma_elaboro, 'pdf_url', NEW.pdf_url,
                'pax_dni', NEW.pax_dni, 'pax_tua_nac', NEW.pax_tua_nac, 'pax_tua_int', NEW.pax_tua_int,
                'folio', NEW.folio, 'legacy_manifest_id', NEW.legacy_manifest_id,
                'aerolinea_codigo', NEW.aerolinea_codigo, 'aeropuerto_referencia', NEW.aeropuerto_referencia,
                'datos', NEW.datos
            )))
        FROM (SELECT 1) _dummy
        LEFT JOIN public.matriculas_manifiestos mm
            ON public._aifa_normalize_identity_part(mm.matricula) = public._aifa_normalize_identity_part(NEW.matricula)
        ON CONFLICT (movement_key) WHERE movement_key IS NOT NULL DO UPDATE SET
            tipo_manifiesto        = coalesce(maestra_operaciones.tipo_manifiesto, EXCLUDED.tipo_manifiesto),
            aerolinea_origen       = coalesce(maestra_operaciones.aerolinea_origen, EXCLUDED.aerolinea_origen),
            tipo_aeronave_codigo   = coalesce(maestra_operaciones.tipo_aeronave_codigo, EXCLUDED.tipo_aeronave_codigo),
            matricula_origen       = coalesce(maestra_operaciones.matricula_origen, EXCLUDED.matricula_origen),
            matricula_id           = coalesce(maestra_operaciones.matricula_id, EXCLUDED.matricula_id),
            pax_total              = coalesce(maestra_operaciones.pax_total, EXCLUDED.pax_total),
            pax_diplomaticos       = coalesce(maestra_operaciones.pax_diplomaticos, EXCLUDED.pax_diplomaticos),
            pax_comision           = coalesce(maestra_operaciones.pax_comision, EXCLUDED.pax_comision),
            pax_infantes           = coalesce(maestra_operaciones.pax_infantes, EXCLUDED.pax_infantes),
            pax_transitos          = coalesce(maestra_operaciones.pax_transitos, EXCLUDED.pax_transitos),
            pax_conexiones         = coalesce(maestra_operaciones.pax_conexiones, EXCLUDED.pax_conexiones),
            pax_otros_exentos      = coalesce(maestra_operaciones.pax_otros_exentos, EXCLUDED.pax_otros_exentos),
            equipaje_kg            = coalesce(maestra_operaciones.equipaje_kg, EXCLUDED.equipaje_kg),
            carga_total_kg         = coalesce(maestra_operaciones.carga_total_kg, EXCLUDED.carga_total_kg),
            correo_kg              = coalesce(maestra_operaciones.correo_kg, EXCLUDED.correo_kg),
            portal_estatus         = coalesce(maestra_operaciones.portal_estatus, EXCLUDED.portal_estatus),
            portal_empresa         = coalesce(maestra_operaciones.portal_empresa, EXCLUDED.portal_empresa),
            portal_user_id         = coalesce(maestra_operaciones.portal_user_id, EXCLUDED.portal_user_id),
            origenes                = maestra_operaciones.origenes || EXCLUDED.origenes,
            datos_origen            = maestra_operaciones.datos_origen || EXCLUDED.datos_origen;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync maestra_operaciones (manifiestos_pasajeros id=%): %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aifa_sync_manifiestos_pasajeros_to_maestra ON public.manifiestos_pasajeros;
CREATE TRIGGER trg_aifa_sync_manifiestos_pasajeros_to_maestra
    AFTER INSERT OR UPDATE ON public.manifiestos_pasajeros
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_manifiestos_pasajeros_to_maestra();

-- -----------------------------------------------------------------------------
-- 5) RLS: única política nueva — lectura para authenticated. Ninguna política
--    de escritura para usuarios normales: la única vía de escritura son los
--    4 triggers SECURITY DEFINER de arriba.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS maestra_operaciones_select_authenticated ON public.maestra_operaciones;
CREATE POLICY maestra_operaciones_select_authenticated
    ON public.maestra_operaciones
    FOR SELECT
    TO authenticated
    USING (true);

-- GRANT es evaluado antes que RLS: sin esto, la política de arriba no basta
-- para que el cliente de la app (rol authenticated) pueda leer la tabla/vista.
GRANT SELECT ON public.maestra_operaciones TO authenticated;
GRANT SELECT ON public.vw_maestra_operaciones TO authenticated;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN — revisar esto antes de decidir COMMIT o ROLLBACK.
-- Hace una escritura real de PRUEBA en cada una de las 4 tablas (dentro de
-- esta misma transacción, se revierte con el ROLLBACK final si no se cambia
-- a COMMIT) y confirma que maestra_operaciones se actualizó sola.
-- -----------------------------------------------------------------------------

-- Punto de retorno: todo lo de ARRIBA de aquí (funciones, triggers, política,
-- grants) se conserva si se llega a COMMIT. Todo lo de ABAJO (la prueba en sí)
-- se deshace siempre con el ROLLBACK TO SAVEPOINT de más adelante, sin
-- importar si al final se hace COMMIT o ROLLBACK de la transacción completa.
SAVEPOINT antes_de_prueba;

-- Tabla temporal para juntar el resultado de la prueba y poder verlo como
-- una fila normal de resultados (los RAISE NOTICE no siempre se ven en el
-- SQL Editor de Supabase, así que evitamos depender de ellos).
CREATE TEMP TABLE _aifa_verificacion_024 (prueba text, detalle text) ON COMMIT DROP;

DO $$
DECLARE
    v_test_id bigint;
    v_count int;
BEGIN
    -- Prueba sobre "Conciliación Manifiestos": toca la fila más reciente con
    -- movement_key ya calculado (no crea filas nuevas, solo dispara UPDATE).
    SELECT id INTO v_test_id FROM public."Conciliación Manifiestos"
    WHERE movement_key IS NOT NULL ORDER BY id DESC LIMIT 1;
    IF v_test_id IS NOT NULL THEN
        UPDATE public."Conciliación Manifiestos" SET "OBSERVACIONES" = "OBSERVACIONES" WHERE id = v_test_id;
        SELECT count(*) INTO v_count FROM public.maestra_operaciones WHERE conciliacion_manifiesto_legacy_id = v_test_id;
        INSERT INTO _aifa_verificacion_024 VALUES (
            'Conciliación Manifiestos',
            format('id=%s -> filas en maestra_operaciones=%s (esperado >= 1)', v_test_id, v_count)
        );
    ELSE
        INSERT INTO _aifa_verificacion_024 VALUES ('Conciliación Manifiestos', 'no hay filas con movement_key para probar.');
    END IF;

    -- Prueba sobre itinerario_vuelos_editable.
    SELECT id INTO v_test_id FROM public.itinerario_vuelos_editable
    WHERE arr_movement_key IS NOT NULL OR dep_movement_key IS NOT NULL ORDER BY id DESC LIMIT 1;
    IF v_test_id IS NOT NULL THEN
        UPDATE public.itinerario_vuelos_editable SET observaciones = observaciones WHERE id = v_test_id;
        SELECT count(*) INTO v_count FROM public.maestra_operaciones WHERE aodb_legacy_id = v_test_id;
        INSERT INTO _aifa_verificacion_024 VALUES (
            'itinerario_vuelos_editable',
            format('id=%s -> filas en maestra_operaciones=%s (esperado >= 1)', v_test_id, v_count)
        );
    ELSE
        INSERT INTO _aifa_verificacion_024 VALUES ('itinerario_vuelos_editable', 'no hay filas con movement_key para probar.');
    END IF;
END $$;

-- Conteo final por fuente, metido en la misma tabla temporal para que todo
-- salga junto en UN SOLO resultado (el SQL Editor de Supabase solo muestra
-- el resultado del último SELECT que corre, así que evitamos tener 2).
INSERT INTO _aifa_verificacion_024
SELECT 'Conteo: ' || fuente_principal, filas::text || ' filas'
FROM (
    SELECT fuente_principal, count(*) AS filas
    FROM public.maestra_operaciones
    GROUP BY fuente_principal
) c;

-- ÚNICO resultado a revisar: primero las 2 filas de prueba (deben decir
-- "filas en maestra_operaciones=1" o más), luego el conteo por fuente
-- (debe coincidir con lo que ya había: 96 / 1965 / 3).
SELECT * FROM _aifa_verificacion_024 ORDER BY prueba;

-- Deshace SOLO la prueba (el UPDATE de mentiras sobre las 2 tablas viejas y
-- la tabla temporal), sin afectar lo de arriba (funciones/triggers/política/
-- permisos). Así, aunque se pase a COMMIT, la prueba nunca deja rastro real
-- en "Conciliación Manifiestos" ni en itinerario_vuelos_editable.
ROLLBACK TO SAVEPOINT antes_de_prueba;

-- -----------------------------------------------------------------------------
-- CORRIDA REAL: esto persiste las funciones/triggers/política/grants.
-- La prueba de arriba ya se deshizo con el ROLLBACK TO SAVEPOINT, así que este
-- COMMIT no deja ningún rastro falso en las tablas viejas.
-- -----------------------------------------------------------------------------
COMMIT;
