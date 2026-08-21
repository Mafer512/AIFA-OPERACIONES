-- =============================================================================
-- Migración fase 1 hacia maestra_operaciones (Manifiestos + Slots)
--
-- Fuentes migradas en esta fase (todas se quedan intactas, solo se LEEN):
--   "Conciliación Manifiestos", itinerario_vuelos_editable,
--   manifiestos_carga, manifiestos_pasajeros
--
-- Fuera de alcance (no se tocan): manifiestos_vuelos_editable (duplicado de
-- itinerario_vuelos_editable), conciliacion_vuelo_overrides,
-- vuelos_parte_operaciones, los 5 históricos por mes/año, los backups
-- *_duplicates_backup_20260729.
--
-- Catálogos: SOLO LECTURA. catalogo_demoras, matriculas_manifiestos,
-- catalogo_aeropuertos, airlines, flight_service_type,
-- conciliacion_catalogo_aerolineas — ni un ALTER, INSERT, UPDATE ni DELETE
-- sobre ellos en todo este archivo.
--
-- Reutiliza sin modificar las funciones de
-- supabase/migrations/010_flight_movement_uniqueness.sql:
--   _aifa_normalize_identity_part, _aifa_flight_number, _aifa_route_endpoint,
--   _aifa_parse_manifest_date, _aifa_manifest_direction, _aifa_movement_key.
-- Y las columnas que esa migración ya calculó y depuró: movement_key /
-- arr_movement_key / dep_movement_key / arr_scheduled_date / dep_scheduled_date.
--
-- MODO DE USO:
--   1) Correr el archivo completo tal cual (termina en ROLLBACK). No persiste
--      nada. Revisar el resultado del bloque de verificación al final.
--   2) Si los conteos y las muestras se ven bien, cambiar la última línea
--      "ROLLBACK;" por "COMMIT;" y volver a correr todo el archivo completo.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0) Funciones auxiliares nuevas (mismo estilo que 010_flight_movement_uniqueness.sql)
-- -----------------------------------------------------------------------------

-- Variante de _aifa_movement_key que recibe el IATA del otro extremo ya
-- resuelto (manifiestos_carga / manifiestos_pasajeros ya traen
-- aeropuerto_referencia limpio) en vez de tener que parsear texto de ruta libre.
CREATE OR REPLACE FUNCTION public._aifa_movement_key_from_endpoint(
    p_carrier text,
    p_designator text,
    p_scheduled_date date,
    p_direction text,
    p_endpoint text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_carrier text := public._aifa_normalize_identity_part(p_carrier);
    v_number text := public._aifa_flight_number(p_designator, p_carrier);
    v_direction text := upper(trim(coalesce(p_direction, '')));
    v_endpoint text := public._aifa_normalize_identity_part(p_endpoint);
BEGIN
    IF v_carrier IS NULL OR v_number IS NULL OR p_scheduled_date IS NULL
       OR v_direction NOT IN ('A', 'D') OR v_endpoint IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN concat_ws('|', v_carrier, v_number, p_scheduled_date::text, v_direction, v_endpoint);
END;
$$;

-- Cast defensivo texto→numeric: nunca lanza error, regresa NULL si no hay
-- forma segura de interpretar el valor. Varias columnas de "Conciliación
-- Manifiestos" (DIPLOMATICOS, TRANSITOS, KG DE CARGA TOTAL, etc.) son TEXT
-- aunque deberían ser numéricas, con formatos históricos inconsistentes.
CREATE OR REPLACE FUNCTION public._aifa_safe_numeric(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_clean text;
BEGIN
    v_clean := regexp_replace(trim(coalesce(p_value, '')), '[^0-9.\-]', '', 'g');
    IF v_clean = '' OR v_clean = '-' OR v_clean = '.' THEN RETURN NULL; END IF;
    RETURN v_clean::numeric;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._aifa_safe_bigint(p_value text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT round(public._aifa_safe_numeric(p_value))::bigint
$$;

-- Cast defensivo texto→timestamptz: intenta el parseo nativo de Postgres
-- (cubre ISO y buena parte de formatos comunes) y, si el valor es solo una
-- hora ("HH:MM"), la combina con la fecha de referencia. Nunca lanza error;
-- si no puede interpretarlo con certeza regresa NULL y el valor crudo de
-- todas formas queda respaldado en datos_origen.
CREATE OR REPLACE FUNCTION public._aifa_safe_timestamptz(p_value text, p_reference_date date DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_text text := trim(coalesce(p_value, ''));
BEGIN
    IF v_text = '' THEN RETURN NULL; END IF;
    BEGIN
        RETURN v_text::timestamptz;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    IF p_reference_date IS NOT NULL AND v_text ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' THEN
        BEGIN
            RETURN (p_reference_date::text || ' ' || v_text)::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
    END IF;
    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- PASO A — "Conciliación Manifiestos" (dato ya curado: gana en caso de choque)
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        cm.*,
        public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO") AS v_direction,
        CASE public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO")
            WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
        END AS v_tipo_movimiento,
        coalesce(cm."_portal_flight_date", public._aifa_parse_manifest_date(cm."FECHA")) AS v_fecha
    FROM public."Conciliación Manifiestos" cm
)
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
    s.v_fecha,
    s.v_tipo_movimiento,
    NULLIF(btrim(s."# DE VUELO"), ''),
    NULLIF(btrim(s."TIPO DE MANIFIESTO"), ''),
    NULLIF(btrim(s."TIPO DE OPERACIÓN"), ''),
    NULLIF(btrim(s."AERONAVE"), ''),
    mm.id,
    NULLIF(btrim(s."MATRÍCULA"), ''),
    ca.id,
    NULLIF(btrim(s."AEROLINEA"), ''),
    public._aifa_safe_timestamptz(s."SLOT ASIGNADO", s.v_fecha),
    public._aifa_safe_timestamptz(s."SLOT COORDINADO", s.v_fecha),
    public._aifa_safe_timestamptz(s."HR. DE INICIO O TERMINO DE PERNOCTA", s.v_fecha),
    public._aifa_safe_timestamptz(s."HR. DE EMBARQUE O DESEMBARQUE", s.v_fecha),
    public._aifa_safe_timestamptz(s."HR. DE OPERACIÓN", s.v_fecha),
    public._aifa_safe_timestamptz(s."HR. MÁXIMA DE ENTREGA", s.v_fecha),
    public._aifa_safe_timestamptz(s."HR. DE RECEPCIÓN", s.v_fecha),
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
    public._aifa_safe_timestamptz(s."Hora y Fecha Generación", s.v_fecha),
    NULLIF(btrim(s."RUTA"), ''),
    CASE WHEN s.v_tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(s."DESTINO / ORIGEN"), '') END,
    CASE WHEN s.v_tipo_movimiento = 'SALIDA' THEN NULLIF(btrim(s."DESTINO / ORIGEN"), '') END,
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
FROM src s
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
   AND cd.tipo_movimiento = s.v_tipo_movimiento
-- fecha_operacion y tipo_movimiento son NOT NULL (+ CHECK) en maestra_operaciones;
-- si "TIPO DE MANIFIESTO" o "FECHA"/_portal_flight_date no se pudieron interpretar,
-- la fila se excluye de esta pasada en vez de tumbar todo el INSERT. Ver punto 2b
-- de VERIFICACIÓN para contar cuántas filas quedaron fuera por esto.
WHERE s.v_tipo_movimiento IS NOT NULL
  AND s.v_fecha IS NOT NULL
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

-- -----------------------------------------------------------------------------
-- PASO B — itinerario_vuelos_editable (AODB). Cada fila puede producir hasta
-- 2 filas de maestra (LLEGADA / SALIDA). TODO el registro crudo (incluidas las
-- horas AODB) va a datos_origen; ninguna hora se promueve a columna
-- normalizada en esta fase (ver Contexto del plan).
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        t.*,
        public._aifa_flight_number(t."[Arr] Flight Designator", t."[Arr] Airline code") AS v_arr_numero,
        public._aifa_flight_number(t."[Dep] Flight Designator", t."[Dep] Airline code") AS v_dep_numero,
        to_jsonb(t) AS v_raw
    FROM public.itinerario_vuelos_editable t
),
arr_rows AS (
    SELECT
        s.arr_movement_key AS movement_key,
        s.id AS aodb_legacy_id,
        'LLEGADA'::text AS tipo_movimiento,
        s.arr_scheduled_date AS fecha_operacion,
        s.v_arr_numero AS numero_vuelo,
        s."Status" AS estatus_vuelo,
        s."[Arr] Stand" AS posicion,
        s."[Arr] Gates" AS puertas,
        s."[Arr] Baggage Belts" AS bandas_equipaje,
        s."[Arr] Service Type" AS tipo_servicio_origen,
        s."Routing" AS routing,
        s."Aircraft type" AS tipo_aeronave_codigo,
        s."Registration" AS matricula_origen,
        coalesce(s.validado, false) AS validado,
        s.validado_por,
        s.validado_at,
        s.v_raw AS datos_origen,
        'Arr'::text AS lado
    FROM src s
    -- fecha_operacion es NOT NULL en maestra_operaciones: si arr_scheduled_date
    -- no se pudo calcular (SIBT no parseable), se excluye esta fila en vez de
    -- tumbar todo el INSERT.
    WHERE NULLIF(btrim(coalesce(s."[Arr] Flight Designator", '')), '') IS NOT NULL
      AND s.arr_scheduled_date IS NOT NULL
),
dep_rows AS (
    SELECT
        s.dep_movement_key AS movement_key,
        s.id AS aodb_legacy_id,
        'SALIDA'::text AS tipo_movimiento,
        s.dep_scheduled_date AS fecha_operacion,
        s.v_dep_numero AS numero_vuelo,
        s."Status" AS estatus_vuelo,
        s."[Dep] Stand" AS posicion,
        s."[Dep] Gates" AS puertas,
        NULL::text AS bandas_equipaje,
        s."[Dep] Service Type" AS tipo_servicio_origen,
        s."Routing" AS routing,
        s."Aircraft type" AS tipo_aeronave_codigo,
        s."Registration" AS matricula_origen,
        coalesce(s.validado, false) AS validado,
        s.validado_por,
        s.validado_at,
        s.v_raw AS datos_origen,
        'Dep'::text AS lado
    FROM src s
    WHERE NULLIF(btrim(coalesce(s."[Dep] Flight Designator", '')), '') IS NOT NULL
      AND s.dep_scheduled_date IS NOT NULL
),
combined AS (
    SELECT * FROM arr_rows
    UNION ALL
    SELECT * FROM dep_rows
)
INSERT INTO public.maestra_operaciones (
    movement_key, aodb_legacy_id, tipo_movimiento, fecha_operacion, numero_vuelo,
    estatus_vuelo, posicion, puertas, bandas_equipaje, tipo_servicio_origen,
    routing, tipo_aeronave_codigo, matricula_origen,
    validado, validado_por, validado_at,
    fuente_principal, origenes, datos_origen
)
SELECT
    c.movement_key, c.aodb_legacy_id, c.tipo_movimiento, c.fecha_operacion, c.numero_vuelo,
    c.estatus_vuelo, c.posicion, c.puertas, c.bandas_equipaje, c.tipo_servicio_origen,
    c.routing, c.tipo_aeronave_codigo, c.matricula_origen,
    c.validado, c.validado_por, c.validado_at,
    'ITINERARIO_VUELOS_EDITABLE',
    jsonb_build_array(jsonb_build_object('tabla', 'itinerario_vuelos_editable', 'id', c.aodb_legacy_id, 'lado', c.lado)),
    jsonb_build_object('itinerario_vuelos_editable', c.datos_origen)
FROM combined c
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

-- Enlaza el par LLEGADA/SALIDA que vino del mismo registro de itinerario_vuelos_editable.
UPDATE public.maestra_operaciones m1
SET movimiento_relacionado_id = m2.id
FROM public.maestra_operaciones m2
WHERE m1.aodb_legacy_id IS NOT NULL
  AND m1.aodb_legacy_id = m2.aodb_legacy_id
  AND m1.fuente_principal = 'ITINERARIO_VUELOS_EDITABLE'
  AND m2.fuente_principal = 'ITINERARIO_VUELOS_EDITABLE'
  AND m1.tipo_movimiento <> m2.tipo_movimiento
  AND m1.movimiento_relacionado_id IS NULL;

-- -----------------------------------------------------------------------------
-- PASO C — manifiestos_carga (complementa; no pisa lo que ya haya de A/B)
-- 0 se trata como "sin dato" en los totales porque las columnas son
-- NOT NULL DEFAULT 0 y no se puede distinguir de un valor real vacío.
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        mc.*,
        public._aifa_manifest_direction(mc.direccion) AS v_direction,
        CASE public._aifa_manifest_direction(mc.direccion)
            WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
        END AS v_tipo_movimiento
    FROM public.manifiestos_carga mc
),
src2 AS (
    SELECT
        s.*,
        public._aifa_movement_key_from_endpoint(
            s.aerolinea_codigo, s.numero_vuelo, s.fecha_vuelo, s.v_direction, s.aeropuerto_referencia
        ) AS v_movement_key
    FROM src s
)
INSERT INTO public.maestra_operaciones (
    movement_key, fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto,
    aerolinea_origen, tipo_aeronave_codigo, matricula_origen, matricula_id,
    pax_total, equipaje_kg, carga_total_kg, correo_kg,
    portal_estatus, portal_empresa, portal_user_id,
    fuente_principal, origenes, datos_origen
)
SELECT
    s.v_movement_key, s.fecha_vuelo, s.v_tipo_movimiento, NULLIF(btrim(s.numero_vuelo), ''), NULLIF(btrim(s.tipo_manifesto), ''),
    coalesce(NULLIF(btrim(s.aerolinea_nombre), ''), NULLIF(btrim(s.aerolinea_codigo), '')),
    NULLIF(btrim(s.aeronave), ''), NULLIF(btrim(s.matricula), ''), mm.id,
    NULLIF(round(s.total_pasajeros)::bigint, 0),
    NULLIF(s.total_equipaje_kg, 0), NULLIF(s.total_carga_kg, 0), NULLIF(s.total_correo_kg, 0),
    s.estado, s.empresa, s.user_id,
    'MANIFIESTOS_CARGA',
    jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_carga', 'id', s.id)),
    jsonb_build_object('manifiestos_carga', jsonb_strip_nulls(jsonb_build_object(
        'folio', s.folio, 'legacy_manifest_id', s.legacy_manifest_id,
        'aerolinea_codigo', s.aerolinea_codigo, 'aeropuerto_referencia', s.aeropuerto_referencia,
        'datos', s.datos
    )))
FROM src2 s
LEFT JOIN public.matriculas_manifiestos mm
    ON public._aifa_normalize_identity_part(mm.matricula) = public._aifa_normalize_identity_part(s.matricula)
WHERE s.v_movement_key IS NOT NULL
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

-- -----------------------------------------------------------------------------
-- PASO D — manifiestos_pasajeros (complementa; agrega pares nac/int a los
-- campos normalizados de pax; todo el desglose fino sin columna propia en
-- maestra_operaciones se respalda en datos_origen).
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        mp.*,
        public._aifa_manifest_direction(mp.direccion) AS v_direction,
        CASE public._aifa_manifest_direction(mp.direccion)
            WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
        END AS v_tipo_movimiento
    FROM public.manifiestos_pasajeros mp
),
src2 AS (
    SELECT
        s.*,
        public._aifa_movement_key_from_endpoint(
            s.aerolinea_codigo, s.numero_vuelo, s.fecha_vuelo, s.v_direction, s.aeropuerto_referencia
        ) AS v_movement_key,
        NULLIF(coalesce(s.pax_dip_nac, 0) + coalesce(s.pax_dip_int, 0), 0) AS v_pax_diplomaticos,
        NULLIF(coalesce(s.pax_com_nac, 0) + coalesce(s.pax_com_int, 0), 0) AS v_pax_comision,
        NULLIF(coalesce(s.pax_inf_nac, 0) + coalesce(s.pax_inf_int, 0), 0) AS v_pax_infantes,
        NULLIF(coalesce(s.pax_tra_nac, 0) + coalesce(s.pax_tra_int, 0), 0) AS v_pax_transitos,
        NULLIF(coalesce(s.pax_con_nac, 0) + coalesce(s.pax_con_int, 0), 0) AS v_pax_conexiones,
        NULLIF(coalesce(s.pax_exe_nac, 0) + coalesce(s.pax_exe_int, 0), 0) AS v_pax_otros_exentos,
        NULLIF(coalesce(s.pax_tot_nac, 0) + coalesce(s.pax_tot_int, 0), 0) AS v_pax_total
    FROM src s
)
INSERT INTO public.maestra_operaciones (
    movement_key, fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto,
    aerolinea_origen, tipo_aeronave_codigo, matricula_origen, matricula_id,
    pax_total, pax_diplomaticos, pax_comision, pax_infantes, pax_transitos,
    pax_conexiones, pax_otros_exentos, equipaje_kg, carga_total_kg, correo_kg,
    portal_estatus, portal_empresa, portal_user_id,
    fuente_principal, origenes, datos_origen
)
SELECT
    s.v_movement_key, s.fecha_vuelo, s.v_tipo_movimiento, NULLIF(btrim(s.numero_vuelo), ''), NULLIF(btrim(s.tipo_manifesto), ''),
    coalesce(NULLIF(btrim(s.aerolinea_nombre), ''), NULLIF(btrim(s.aerolinea_codigo), '')),
    NULLIF(btrim(s.aeronave), ''), NULLIF(btrim(s.matricula), ''), mm.id,
    coalesce(s.v_pax_total, NULLIF(round(s.total_pasajeros)::bigint, 0)),
    s.v_pax_diplomaticos, s.v_pax_comision, s.v_pax_infantes, s.v_pax_transitos,
    s.v_pax_conexiones, s.v_pax_otros_exentos,
    coalesce(NULLIF(s.kgs_equipaje, 0), NULLIF(s.total_equipaje_kg, 0)),
    coalesce(NULLIF(s.kgs_carga, 0), NULLIF(s.total_carga_kg, 0)),
    coalesce(NULLIF(s.kgs_correo, 0), NULLIF(s.total_correo_kg, 0)),
    s.estado, s.empresa, s.user_id,
    'MANIFIESTOS_PASAJEROS',
    jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_pasajeros', 'id', s.id)),
    jsonb_build_object('manifiestos_pasajeros', jsonb_strip_nulls(jsonb_build_object(
        'comandante', s.comandante, 'num_licencia', s.num_licencia, 'tripulacion_ps', s.tripulacion_ps,
        'clase_servicio', s.clase_servicio, 'explotador', s.explotador,
        'aeropuerto_origen', s.aeropuerto_origen, 'oaci_origen', s.oaci_origen,
        'aeropuerto_escala', s.aeropuerto_escala, 'oaci_escala', s.oaci_escala,
        'aeropuerto_destino', s.aeropuerto_destino, 'oaci_destino', s.oaci_destino,
        'h_itin', s.h_itin, 'h_real', s.h_real, 'h_calzos', s.h_calzos, 'h_puerta', s.h_puerta,
        'posicion', s.posicion, 'motivo_demora', s.motivo_demora, 'fbo', s.fbo,
        'demora1_codigo', s.demora1_codigo, 'demora1_tiempo', s.demora1_tiempo,
        'demora2_codigo', s.demora2_codigo, 'demora2_tiempo', s.demora2_tiempo,
        'pasajeros_primera', s.pasajeros_primera, 'pasajeros_turista', s.pasajeros_turista,
        'pasajeros_menores', s.pasajeros_menores, 'pasajeros_infantes', s.pasajeros_infantes,
        'pasajeros_tercera_edad', s.pasajeros_tercera_edad, 'pasajeros_discapacitados', s.pasajeros_discapacitados,
        'pasajeros_total', s.pasajeros_total, 'firma_elaboro', s.firma_elaboro, 'pdf_url', s.pdf_url,
        'pax_dni', s.pax_dni, 'pax_tua_nac', s.pax_tua_nac, 'pax_tua_int', s.pax_tua_int,
        'folio', s.folio, 'legacy_manifest_id', s.legacy_manifest_id,
        'aerolinea_codigo', s.aerolinea_codigo, 'aeropuerto_referencia', s.aeropuerto_referencia,
        'datos', s.datos
    )))
FROM src2 s
LEFT JOIN public.matriculas_manifiestos mm
    ON public._aifa_normalize_identity_part(mm.matricula) = public._aifa_normalize_identity_part(s.matricula)
WHERE s.v_movement_key IS NOT NULL
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

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN — revisar esto antes de decidir COMMIT o ROLLBACK.
-- -----------------------------------------------------------------------------

-- 1) Total migrado y desglose por fuente.
SELECT fuente_principal, count(*) AS filas
FROM public.maestra_operaciones
GROUP BY fuente_principal
ORDER BY fuente_principal;

-- 2) Filas sin movement_key (no se pudo normalizar vuelo+fecha+sentido) —
--    requieren revisión manual, no bloquean el resto de la migración.
SELECT fuente_principal, count(*) AS filas_sin_movement_key
FROM public.maestra_operaciones
WHERE movement_key IS NULL
GROUP BY fuente_principal;

-- 2b) Filas de "Conciliación Manifiestos" / itinerario_vuelos_editable que NO
--     se migraron en absoluto (a diferencia del punto 2, aquí ni siquiera se
--     insertaron) porque no se pudo determinar fecha_operacion o
--     tipo_movimiento — columnas NOT NULL en maestra_operaciones. Deben
--     revisarse a mano en la tabla origen; esta migración no las modifica.
SELECT
    'Conciliación Manifiestos' AS tabla,
    count(*) FILTER (
        WHERE public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO") IS NULL
           OR coalesce(cm."_portal_flight_date", public._aifa_parse_manifest_date(cm."FECHA")) IS NULL
    ) AS filas_excluidas,
    count(*) AS filas_totales_en_origen
FROM public."Conciliación Manifiestos" cm
UNION ALL
SELECT
    'itinerario_vuelos_editable (lado Arr)',
    count(*) FILTER (
        WHERE NULLIF(btrim(coalesce(t."[Arr] Flight Designator", '')), '') IS NOT NULL
          AND t.arr_scheduled_date IS NULL
    ),
    count(*) FILTER (WHERE NULLIF(btrim(coalesce(t."[Arr] Flight Designator", '')), '') IS NOT NULL)
FROM public.itinerario_vuelos_editable t
UNION ALL
SELECT
    'itinerario_vuelos_editable (lado Dep)',
    count(*) FILTER (
        WHERE NULLIF(btrim(coalesce(t."[Dep] Flight Designator", '')), '') IS NOT NULL
          AND t.dep_scheduled_date IS NULL
    ),
    count(*) FILTER (WHERE NULLIF(btrim(coalesce(t."[Dep] Flight Designator", '')), '') IS NOT NULL)
FROM public.itinerario_vuelos_editable t;

-- 3) Ningún movement_key debe repetirse (el índice único ya lo garantiza;
--    esto es solo una confirmación visual).
SELECT movement_key, count(*)
FROM public.maestra_operaciones
WHERE movement_key IS NOT NULL
GROUP BY movement_key
HAVING count(*) > 1;

-- 4) Muestra enriquecida (usa la vista ya creada) para revisar que los
--    catálogos sí resolvieron (aerolínea, matrícula, demora).
SELECT id, movement_key, fecha_operacion, tipo_movimiento, numero_vuelo,
       aerolinea, matricula, causa_demora, fuente_principal
FROM public.vw_maestra_operaciones
ORDER BY id
LIMIT 20;

-- 5) Confirmar que las tablas origen y los catálogos no cambiaron.
SELECT 'Conciliación Manifiestos' AS tabla, count(*) FROM public."Conciliación Manifiestos"
UNION ALL SELECT 'itinerario_vuelos_editable', count(*) FROM public.itinerario_vuelos_editable
UNION ALL SELECT 'manifiestos_carga', count(*) FROM public.manifiestos_carga
UNION ALL SELECT 'manifiestos_pasajeros', count(*) FROM public.manifiestos_pasajeros
UNION ALL SELECT 'catalogo_demoras', count(*) FROM public.catalogo_demoras
UNION ALL SELECT 'matriculas_manifiestos', count(*) FROM public.matriculas_manifiestos;

-- -----------------------------------------------------------------------------
-- CORRIDA REAL: esta línea ya quedó en COMMIT. Al correr este archivo
-- completo en el SQL Editor de Supabase, la migración SÍ se guarda.
-- -----------------------------------------------------------------------------
COMMIT;
