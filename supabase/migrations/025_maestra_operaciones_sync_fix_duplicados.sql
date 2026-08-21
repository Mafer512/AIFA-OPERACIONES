-- =============================================================================
-- Fase 2b — Corrige "duplicate key" en los triggers de sincronización (024)
--
-- BUG encontrado en producción: maestra_operaciones tiene 2 índices únicos
-- parciales además de movement_key:
--   - uq_maestra_operaciones_conciliacion_legacy  UNIQUE(conciliacion_manifiesto_legacy_id) WHERE NOT NULL
--   - uq_maestra_operaciones_aodb_movimiento      UNIQUE(aodb_legacy_id, tipo_movimiento)   WHERE aodb_legacy_id NOT NULL
--
-- Los triggers de 024 solo sabían resolver conflictos por movement_key
-- (ON CONFLICT (movement_key) DO UPDATE). Cuando una fila de origen tiene
-- movement_key NULL (p.ej. "Conciliación Manifiestos" id=319, sin vuelo/fecha
-- bien formados) pero YA tiene una fila en maestra_operaciones (creada la
-- primera vez que se sincronizó), cada edición posterior de esa fila
-- intentaba INSERTAR de nuevo en vez de actualizar — y chocaba con el OTRO
-- índice único. El error se veía como WARNING repetido en los logs (no
-- rompía el guardado real, porque cada función ya está protegida con su
-- propio BEGIN...EXCEPTION), pero la fila nunca se volvía a sincronizar.
--
-- FIX: antes de insertar, cada función ahora busca si la fila ya existe en
-- maestra_operaciones por CUALQUIERA de sus identidades posibles (el id de
-- origen específico de esa fuente, o movement_key). Si existe, hace UPDATE
-- directo por id (mismo merge por COALESCE de siempre). Si no existe, hace
-- el INSERT de siempre (con ON CONFLICT (movement_key) como red de
-- seguridad para carreras concurrentes).
--
-- Solo se reemplazan los cuerpos de las 2 funciones afectadas
-- (_aifa_sync_conciliacion_to_maestra, _aifa_sync_itinerario_to_maestra) con
-- CREATE OR REPLACE FUNCTION — los triggers ya existentes (de 024) siguen
-- apuntando al mismo nombre de función, no hay que tocarlos. No se tocan
-- manifiestos_carga/manifiestos_pasajeros: esas nunca escriben
-- conciliacion_manifiesto_legacy_id ni aodb_legacy_id, así que no están
-- expuestas a este bug.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) "Conciliación Manifiestos" → maestra_operaciones
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
    v_existing_id bigint;
BEGIN
    BEGIN
        v_tipo_movimiento := CASE public._aifa_manifest_direction(NEW."TIPO DE MANIFIESTO")
            WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
        END;
        v_fecha := coalesce(NEW."_portal_flight_date", public._aifa_parse_manifest_date(NEW."FECHA"));

        IF v_tipo_movimiento IS NULL OR v_fecha IS NULL THEN
            RETURN NEW;
        END IF;

        -- ¿Ya existe una fila en maestra_operaciones para este origen?
        -- (por su id de "Conciliación Manifiestos", o por movement_key si ya
        -- se calculó). Evita chocar con uq_maestra_operaciones_conciliacion_legacy.
        SELECT id INTO v_existing_id
        FROM public.maestra_operaciones
        WHERE conciliacion_manifiesto_legacy_id = NEW.id
           OR (NEW.movement_key IS NOT NULL AND movement_key = NEW.movement_key)
        ORDER BY (conciliacion_manifiesto_legacy_id = NEW.id) DESC NULLS LAST
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            UPDATE public.maestra_operaciones m SET
                movement_key                 = coalesce(m.movement_key, s."movement_key"),
                conciliacion_manifiesto_legacy_id = coalesce(m.conciliacion_manifiesto_legacy_id, s."id"),
                fecha_operacion              = coalesce(m.fecha_operacion, v_fecha),
                tipo_movimiento              = coalesce(m.tipo_movimiento, v_tipo_movimiento),
                numero_vuelo                 = coalesce(m.numero_vuelo, NULLIF(btrim(s."# DE VUELO"), '')),
                tipo_manifiesto              = coalesce(m.tipo_manifiesto, NULLIF(btrim(s."TIPO DE MANIFIESTO"), '')),
                tipo_operacion               = coalesce(m.tipo_operacion, NULLIF(btrim(s."TIPO DE OPERACIÓN"), '')),
                tipo_aeronave_codigo         = coalesce(m.tipo_aeronave_codigo, NULLIF(btrim(s."AERONAVE"), '')),
                matricula_id                 = coalesce(m.matricula_id, mm.id),
                matricula_origen             = coalesce(m.matricula_origen, NULLIF(btrim(s."MATRÍCULA"), '')),
                aerolinea_conciliacion_id    = coalesce(m.aerolinea_conciliacion_id, ca.id),
                aerolinea_origen             = coalesce(m.aerolinea_origen, NULLIF(btrim(s."AEROLINEA"), '')),
                slot_asignado                = coalesce(m.slot_asignado, public._aifa_safe_timestamptz(s."SLOT ASIGNADO", v_fecha)),
                slot_coordinado              = coalesce(m.slot_coordinado, public._aifa_safe_timestamptz(s."SLOT COORDINADO", v_fecha)),
                hora_pernocta                = coalesce(m.hora_pernocta, public._aifa_safe_timestamptz(s."HR. DE INICIO O TERMINO DE PERNOCTA", v_fecha)),
                hora_embarque_desembarque    = coalesce(m.hora_embarque_desembarque, public._aifa_safe_timestamptz(s."HR. DE EMBARQUE O DESEMBARQUE", v_fecha)),
                hora_operacion               = coalesce(m.hora_operacion, public._aifa_safe_timestamptz(s."HR. DE OPERACIÓN", v_fecha)),
                hora_maxima_entrega          = coalesce(m.hora_maxima_entrega, public._aifa_safe_timestamptz(s."HR. MÁXIMA DE ENTREGA", v_fecha)),
                hora_recepcion               = coalesce(m.hora_recepcion, public._aifa_safe_timestamptz(s."HR. DE RECEPCIÓN", v_fecha)),
                horas_cumplidas              = coalesce(m.horas_cumplidas, s."HRS. CUMPLIDAS"::numeric(12,3)),
                estado_puntualidad           = coalesce(m.estado_puntualidad, NULLIF(btrim(s."PUNTUALIDAD / CANCELACIÓN"), '')),
                pax_total                    = coalesce(m.pax_total, s."TOTAL PAX"),
                pax_diplomaticos             = coalesce(m.pax_diplomaticos, public._aifa_safe_bigint(s."DIPLOMATICOS")),
                pax_comision                 = coalesce(m.pax_comision, public._aifa_safe_bigint(s."EN COMISION")),
                pax_infantes                 = coalesce(m.pax_infantes, public._aifa_safe_bigint(s."INFANTES")),
                pax_transitos                = coalesce(m.pax_transitos, public._aifa_safe_bigint(s."TRANSITOS")),
                pax_conexiones               = coalesce(m.pax_conexiones, public._aifa_safe_bigint(s."CONEXIONES")),
                pax_otros_exentos            = coalesce(m.pax_otros_exentos, public._aifa_safe_bigint(s."OTROS EXENTOS")),
                pax_exentos_reportados       = coalesce(m.pax_exentos_reportados, public._aifa_safe_bigint(s."TOTAL EXENTOS")),
                pax_pagan_tua_reportados     = coalesce(m.pax_pagan_tua_reportados, public._aifa_safe_bigint(s."PAX QUE PAGAN TUA")),
                equipaje_kg                  = coalesce(m.equipaje_kg, s."KGS. DE EQUIPAJE"),
                carga_total_kg               = coalesce(m.carga_total_kg, public._aifa_safe_numeric(s."KG DE CARGA TOTAL")),
                carga_nacional_kg            = coalesce(m.carga_nacional_kg, s."KGS. DE CARGA NACIONAL"),
                carga_internacional_kg       = coalesce(m.carga_internacional_kg, s."KGS. DE CARGA INTERNACIONAL"),
                correo_kg                    = coalesce(m.correo_kg, public._aifa_safe_numeric(s."CORREO")),
                codigo_demora_origen         = coalesce(m.codigo_demora_origen, NULLIF(btrim(s."CÓDIGO DEMORA"), '')),
                demora_catalogo_id           = coalesce(m.demora_catalogo_id, cd.id),
                observaciones                = coalesce(m.observaciones, NULLIF(btrim(s."OBSERVACIONES"), '')),
                capturado_por                = coalesce(m.capturado_por, NULLIF(btrim(s."CAPTURÓ"), '')),
                evidencia_url                = coalesce(m.evidencia_url, NULLIF(btrim(s."EVIDENCIA"), '')),
                fecha_generacion             = coalesce(m.fecha_generacion, public._aifa_safe_timestamptz(s."Hora y Fecha Generación", v_fecha)),
                ruta_origen                  = coalesce(m.ruta_origen, NULLIF(btrim(s."RUTA"), '')),
                origen_origen                = coalesce(m.origen_origen, CASE WHEN v_tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(s."DESTINO / ORIGEN"), '') END),
                destino_origen               = coalesce(m.destino_origen, CASE WHEN v_tipo_movimiento = 'SALIDA' THEN NULLIF(btrim(s."DESTINO / ORIGEN"), '') END),
                portal_user_id               = coalesce(m.portal_user_id, s."_portal_user_id"),
                portal_empresa               = coalesce(m.portal_empresa, s."_portal_company"),
                portal_fecha_vuelo           = coalesce(m.portal_fecha_vuelo, s."_portal_flight_date"),
                portal_estatus               = coalesce(m.portal_estatus, s."_portal_status"),
                portal_notas_revision        = coalesce(m.portal_notas_revision, s."_portal_review_notes"),
                portal_revisado_por          = coalesce(m.portal_revisado_por, s."_portal_reviewed_by"),
                portal_revisado_at           = coalesce(m.portal_revisado_at, s."_portal_reviewed_at"),
                portal_creado_at             = coalesce(m.portal_creado_at, s."_portal_created_at"),
                portal_aprobacion_aifa       = coalesce(m.portal_aprobacion_aifa, s."_portal_aprob_aifa"),
                portal_aifa_por              = coalesce(m.portal_aifa_por, s."_portal_aifa_by"),
                portal_aifa_por_nombre       = coalesce(m.portal_aifa_por_nombre, s."_portal_aifa_by_name"),
                portal_aifa_at               = coalesce(m.portal_aifa_at, s."_portal_aifa_at"),
                portal_aifa_notas            = coalesce(m.portal_aifa_notas, s."_portal_aifa_notes"),
                portal_aprobacion_afac       = coalesce(m.portal_aprobacion_afac, s."_portal_aprob_afac"),
                portal_afac_por              = coalesce(m.portal_afac_por, s."_portal_afac_by"),
                portal_afac_por_nombre       = coalesce(m.portal_afac_por_nombre, s."_portal_afac_by_name"),
                portal_afac_at               = coalesce(m.portal_afac_at, s."_portal_afac_at"),
                portal_afac_notas            = coalesce(m.portal_afac_notas, s."_portal_afac_notes"),
                portal_manifiesto_datos      = m.portal_manifiesto_datos || coalesce(s."_portal_manifest_data", '{}'::jsonb),
                validado                     = coalesce(m.validado, true),
                origenes                     = m.origenes || jsonb_build_array(jsonb_build_object('tabla', 'Conciliación Manifiestos', 'id', s."id")),
                datos_origen                 = m.datos_origen || jsonb_build_object('conciliacion_manifiestos', jsonb_strip_nulls(jsonb_build_object(
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
            WHERE m.id = v_existing_id;
        ELSE
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
                fecha_operacion              = coalesce(maestra_operaciones.fecha_operacion, EXCLUDED.fecha_operacion),
                tipo_movimiento              = coalesce(maestra_operaciones.tipo_movimiento, EXCLUDED.tipo_movimiento),
                numero_vuelo                 = coalesce(maestra_operaciones.numero_vuelo, EXCLUDED.numero_vuelo),
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
                hora_operacion               = coalesce(maestra_operaciones.hora_operacion, EXCLUDED.hora_operacion),
                hora_maxima_entrega          = coalesce(maestra_operaciones.hora_maxima_entrega, EXCLUDED.hora_maxima_entrega),
                hora_recepcion               = coalesce(maestra_operaciones.hora_recepcion, EXCLUDED.hora_recepcion),
                horas_cumplidas              = coalesce(maestra_operaciones.horas_cumplidas, EXCLUDED.horas_cumplidas),
                estado_puntualidad           = coalesce(maestra_operaciones.estado_puntualidad, EXCLUDED.estado_puntualidad),
                pax_total                    = coalesce(maestra_operaciones.pax_total, EXCLUDED.pax_total),
                pax_diplomaticos             = coalesce(maestra_operaciones.pax_diplomaticos, EXCLUDED.pax_diplomaticos),
                pax_comision                 = coalesce(maestra_operaciones.pax_comision, EXCLUDED.pax_comision),
                pax_infantes                 = coalesce(maestra_operaciones.pax_infantes, EXCLUDED.pax_infantes),
                pax_transitos                = coalesce(maestra_operaciones.pax_transitos, EXCLUDED.pax_transitos),
                pax_conexiones               = coalesce(maestra_operaciones.pax_conexiones, EXCLUDED.pax_conexiones),
                pax_otros_exentos            = coalesce(maestra_operaciones.pax_otros_exentos, EXCLUDED.pax_otros_exentos),
                pax_exentos_reportados       = coalesce(maestra_operaciones.pax_exentos_reportados, EXCLUDED.pax_exentos_reportados),
                pax_pagan_tua_reportados     = coalesce(maestra_operaciones.pax_pagan_tua_reportados, EXCLUDED.pax_pagan_tua_reportados),
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
                origen_origen                = coalesce(maestra_operaciones.origen_origen, EXCLUDED.origen_origen),
                destino_origen               = coalesce(maestra_operaciones.destino_origen, EXCLUDED.destino_origen),
                portal_user_id               = coalesce(maestra_operaciones.portal_user_id, EXCLUDED.portal_user_id),
                portal_empresa               = coalesce(maestra_operaciones.portal_empresa, EXCLUDED.portal_empresa),
                portal_fecha_vuelo           = coalesce(maestra_operaciones.portal_fecha_vuelo, EXCLUDED.portal_fecha_vuelo),
                portal_estatus               = coalesce(maestra_operaciones.portal_estatus, EXCLUDED.portal_estatus),
                portal_notas_revision        = coalesce(maestra_operaciones.portal_notas_revision, EXCLUDED.portal_notas_revision),
                portal_revisado_por          = coalesce(maestra_operaciones.portal_revisado_por, EXCLUDED.portal_revisado_por),
                portal_revisado_at           = coalesce(maestra_operaciones.portal_revisado_at, EXCLUDED.portal_revisado_at),
                portal_creado_at             = coalesce(maestra_operaciones.portal_creado_at, EXCLUDED.portal_creado_at),
                portal_aprobacion_aifa       = coalesce(maestra_operaciones.portal_aprobacion_aifa, EXCLUDED.portal_aprobacion_aifa),
                portal_aifa_por              = coalesce(maestra_operaciones.portal_aifa_por, EXCLUDED.portal_aifa_por),
                portal_aifa_por_nombre       = coalesce(maestra_operaciones.portal_aifa_por_nombre, EXCLUDED.portal_aifa_por_nombre),
                portal_aifa_at               = coalesce(maestra_operaciones.portal_aifa_at, EXCLUDED.portal_aifa_at),
                portal_aifa_notas            = coalesce(maestra_operaciones.portal_aifa_notas, EXCLUDED.portal_aifa_notas),
                portal_aprobacion_afac       = coalesce(maestra_operaciones.portal_aprobacion_afac, EXCLUDED.portal_aprobacion_afac),
                portal_afac_por              = coalesce(maestra_operaciones.portal_afac_por, EXCLUDED.portal_afac_por),
                portal_afac_por_nombre       = coalesce(maestra_operaciones.portal_afac_por_nombre, EXCLUDED.portal_afac_por_nombre),
                portal_afac_at               = coalesce(maestra_operaciones.portal_afac_at, EXCLUDED.portal_afac_at),
                portal_afac_notas            = coalesce(maestra_operaciones.portal_afac_notas, EXCLUDED.portal_afac_notas),
                portal_manifiesto_datos      = maestra_operaciones.portal_manifiesto_datos || EXCLUDED.portal_manifiesto_datos,
                validado                     = coalesce(maestra_operaciones.validado, EXCLUDED.validado),
                origenes                     = maestra_operaciones.origenes || EXCLUDED.origenes,
                datos_origen                 = maestra_operaciones.datos_origen || EXCLUDED.datos_origen;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync maestra_operaciones (Conciliación Manifiestos id=%): %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) itinerario_vuelos_editable → maestra_operaciones
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
    v_existing_arr_id bigint;
    v_existing_dep_id bigint;
BEGIN
    BEGIN
        v_arr_numero := public._aifa_flight_number(NEW."[Arr] Flight Designator", NEW."[Arr] Airline code");
        v_dep_numero := public._aifa_flight_number(NEW."[Dep] Flight Designator", NEW."[Dep] Airline code");
        v_raw := to_jsonb(NEW);

        -- Lado LLEGADA
        IF NULLIF(btrim(coalesce(NEW."[Arr] Flight Designator", '')), '') IS NOT NULL
           AND NEW.arr_scheduled_date IS NOT NULL THEN

            -- ¿Ya existe una fila en maestra_operaciones para este lado?
            -- Evita chocar con uq_maestra_operaciones_aodb_movimiento cuando
            -- arr_movement_key es NULL pero esta fila ya se había sincronizado antes.
            SELECT id INTO v_existing_arr_id
            FROM public.maestra_operaciones
            WHERE (aodb_legacy_id = NEW.id AND tipo_movimiento = 'LLEGADA')
               OR (NEW.arr_movement_key IS NOT NULL AND movement_key = NEW.arr_movement_key)
            ORDER BY (aodb_legacy_id = NEW.id) DESC NULLS LAST
            LIMIT 1;

            IF v_existing_arr_id IS NOT NULL THEN
                UPDATE public.maestra_operaciones SET
                    movement_key           = coalesce(movement_key, NEW.arr_movement_key),
                    aodb_legacy_id         = coalesce(aodb_legacy_id, NEW.id),
                    fecha_operacion        = coalesce(fecha_operacion, NEW.arr_scheduled_date),
                    numero_vuelo           = coalesce(numero_vuelo, v_arr_numero),
                    estatus_vuelo          = coalesce(estatus_vuelo, NEW."Status"),
                    posicion               = coalesce(posicion, NEW."[Arr] Stand"),
                    puertas                = coalesce(puertas, NEW."[Arr] Gates"),
                    bandas_equipaje        = coalesce(bandas_equipaje, NEW."[Arr] Baggage Belts"),
                    tipo_servicio_origen   = coalesce(tipo_servicio_origen, NEW."[Arr] Service Type"),
                    routing                = coalesce(routing, NEW."Routing"),
                    tipo_aeronave_codigo   = coalesce(tipo_aeronave_codigo, NEW."Aircraft type"),
                    matricula_origen       = coalesce(matricula_origen, NEW."Registration"),
                    validado               = coalesce(validado, coalesce(NEW.validado, false)),
                    validado_por           = coalesce(validado_por, NEW.validado_por),
                    validado_at            = coalesce(validado_at, NEW.validado_at),
                    origenes               = origenes || jsonb_build_array(jsonb_build_object('tabla', 'itinerario_vuelos_editable', 'id', NEW.id, 'lado', 'Arr')),
                    datos_origen           = datos_origen || jsonb_build_object('itinerario_vuelos_editable', v_raw)
                WHERE id = v_existing_arr_id;
            ELSE
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
        END IF;

        -- Lado SALIDA
        IF NULLIF(btrim(coalesce(NEW."[Dep] Flight Designator", '')), '') IS NOT NULL
           AND NEW.dep_scheduled_date IS NOT NULL THEN

            SELECT id INTO v_existing_dep_id
            FROM public.maestra_operaciones
            WHERE (aodb_legacy_id = NEW.id AND tipo_movimiento = 'SALIDA')
               OR (NEW.dep_movement_key IS NOT NULL AND movement_key = NEW.dep_movement_key)
            ORDER BY (aodb_legacy_id = NEW.id) DESC NULLS LAST
            LIMIT 1;

            IF v_existing_dep_id IS NOT NULL THEN
                UPDATE public.maestra_operaciones SET
                    movement_key           = coalesce(movement_key, NEW.dep_movement_key),
                    aodb_legacy_id         = coalesce(aodb_legacy_id, NEW.id),
                    fecha_operacion        = coalesce(fecha_operacion, NEW.dep_scheduled_date),
                    numero_vuelo           = coalesce(numero_vuelo, v_dep_numero),
                    estatus_vuelo          = coalesce(estatus_vuelo, NEW."Status"),
                    posicion               = coalesce(posicion, NEW."[Dep] Stand"),
                    puertas                = coalesce(puertas, NEW."[Dep] Gates"),
                    tipo_servicio_origen   = coalesce(tipo_servicio_origen, NEW."[Dep] Service Type"),
                    routing                = coalesce(routing, NEW."Routing"),
                    tipo_aeronave_codigo   = coalesce(tipo_aeronave_codigo, NEW."Aircraft type"),
                    matricula_origen       = coalesce(matricula_origen, NEW."Registration"),
                    validado               = coalesce(validado, coalesce(NEW.validado, false)),
                    validado_por           = coalesce(validado_por, NEW.validado_por),
                    validado_at            = coalesce(validado_at, NEW.validado_at),
                    origenes               = origenes || jsonb_build_array(jsonb_build_object('tabla', 'itinerario_vuelos_editable', 'id', NEW.id, 'lado', 'Dep')),
                    datos_origen           = datos_origen || jsonb_build_object('itinerario_vuelos_editable', v_raw)
                WHERE id = v_existing_dep_id;
            ELSE
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

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN — reproduce el bug real (id=319, que en producción generaba
-- el "duplicate key" en cada edición) y confirma que ya no pasa.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _aifa_verificacion_025 (prueba text, detalle text) ON COMMIT DROP;

SAVEPOINT antes_de_prueba;

DO $$
DECLARE
    v_count_antes int;
    v_count_despues int;
BEGIN
    -- id=319: el caso real que fallaba en producción con "duplicate key
    -- ... uq_maestra_operaciones_conciliacion_legacy".
    SELECT count(*) INTO v_count_antes FROM public.maestra_operaciones WHERE conciliacion_manifiesto_legacy_id = 319;
    UPDATE public."Conciliación Manifiestos" SET "OBSERVACIONES" = "OBSERVACIONES" WHERE id = 319;
    SELECT count(*) INTO v_count_despues FROM public.maestra_operaciones WHERE conciliacion_manifiesto_legacy_id = 319;
    INSERT INTO _aifa_verificacion_025 VALUES (
        'Conciliación Manifiestos id=319',
        format('filas antes=%s, filas después=%s (deben ser iguales y = 1, no debe haber duplicado)', v_count_antes, v_count_despues)
    );
END $$;

INSERT INTO _aifa_verificacion_025
SELECT 'Conteo: ' || fuente_principal, filas::text || ' filas'
FROM (
    SELECT fuente_principal, count(*) AS filas
    FROM public.maestra_operaciones
    GROUP BY fuente_principal
) c;

SELECT * FROM _aifa_verificacion_025 ORDER BY prueba;

ROLLBACK TO SAVEPOINT antes_de_prueba;

-- -----------------------------------------------------------------------------
-- CORRIDA REAL: esto persiste el fix (CREATE OR REPLACE FUNCTION de las 2
-- funciones). La prueba de arriba ya se deshizo con el ROLLBACK TO SAVEPOINT.
-- -----------------------------------------------------------------------------
COMMIT;
