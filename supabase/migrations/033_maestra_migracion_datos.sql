-- =============================================================================
-- 033 — Migración de los datos existentes hacia maestra_operaciones
--
-- REQUISITO: correr antes 032_maestra_estructura_previa.sql (con COMMIT).
--
-- MODELO DE PROPIEDAD (el acordado)
--
--   ITINERARIO  →  datos_origen (JSON, respaldo intacto de cómo llegó el AODB)
--                  + las columnas de su propio schema: horas programadas y
--                  reales, posición, puertas, bandas, abordados, estatus,
--                  routing, tipo de servicio, validación.
--                  NADIE MÁS escribe datos_origen.
--
--   MANIFIESTOS →  las columnas de captura: slots, horas de operación y
--                  recepción, pasajeros, carga, correo, demoras, puntualidad,
--                  observaciones, cierre de subsecretaría.
--                  Puede CORREGIR los datos de identidad que el itinerario
--                  precargó (número de vuelo, aerolínea, matrícula, aeronave):
--                  el capturista es la autoridad sobre lo que realmente voló.
--                  NUNCA toca datos_origen.
--
--   PORTAL      →  portal_* y portal_manifiesto_datos, donde va íntegro el
--                  formato oficial AFAC (comandante, licencia, tripulación,
--                  OACI, FBO, firma, PDF, desglose nacional/internacional de
--                  pasajeros y el desglose por clase).
--
-- Por eso los pasos van en ESTE orden y no en otro: cada capa se escribe encima
-- de la anterior, y la de más arriba gana en las columnas compartidas.
--
-- IDEMPOTENTE: se puede correr las veces que haga falta. Cada paso resuelve
-- primero a qué fila de maestra_operaciones le toca (por id heredado, por
-- cliente_uuid o por identidad de movimiento), actualiza las que ya existen e
-- inserta solo las que faltan. No usa ON CONFLICT: maestra_operaciones tiene
-- cuatro índices únicos y ON CONFLICT solo sabe resolver uno — ése fue el bug
-- que corrigió la 025.
--
-- LAS TABLAS DE ORIGEN NO SE TOCAN: solo se LEEN. Ni un UPDATE, INSERT o DELETE
-- sobre ellas. Los catálogos tampoco (airlines, catalogo_demoras,
-- catalogo_aeropuertos, matriculas_manifiestos, flight_service_type,
-- conciliacion_catalogo_aerolineas): solo se consultan para resolver FK.
--
-- FUERA DE ALCANCE: las tablas mensuales históricas van en 034.
--
-- MODO DE USO
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK: no persiste
--      nada. Revisar el bloque de VERIFICACIÓN del final.
--   2) Si los conteos cuadran, cambiar ROLLBACK por COMMIT y volver a correr el
--      archivo completo.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;

-- Sin paralelismo en esta transacción, y es obligatorio, no una optimización.
--
-- Las funciones auxiliares de las migraciones 010 y 023
-- (_aifa_parse_manifest_date, _aifa_safe_numeric, _aifa_safe_timestamptz,
-- _aifa_date_near_reference) están declaradas PARALLEL SAFE, pero todas llevan
-- un bloque EXCEPTION. En PL/pgSQL un EXCEPTION abre una subtransacción interna,
-- y un worker paralelo no puede abrir subtransacciones: Postgres aborta con
--     25000: cannot start commands during a parallel operation
-- El error solo se dispara cuando el planificador elige un plan paralelo, que es
-- justo lo que hace al escanear estas tablas completas. Por eso no se había visto
-- antes: las consultas normales de la app son pequeñas y nunca paralelizan.
--
-- Se apaga aquí, acotado a esta transacción, en vez de tocar esas funciones:
-- las usan otras partes del sistema y reetiquetarlas es un cambio aparte, con su
-- propia prueba: la corrección definitiva es reetiquetarlas como PARALLEL
-- UNSAFE, o quitarles el EXCEPTION, en una migración dedicada.
SET LOCAL max_parallel_workers_per_gather = 0;

-- =============================================================================
-- PASO A — itinerario_vuelos_editable → maestra_operaciones
--
-- Una fila del AODB es un vuelo-día "ancho" con lado de llegada y lado de
-- salida. maestra_operaciones normaliza a una fila por movimiento, así que cada
-- fila de origen produce hasta 2. Solo se produce el lado que realmente existe
-- (tiene Flight Designator) y cuya fecha programada se pudo calcular:
-- fecha_operacion es NOT NULL.
--
-- datos_origen recibe la fila ENTERA (to_jsonb), con los dos lados, sin importar
-- cuál de los dos se esté produciendo. Así, desde cualquiera de las dos filas de
-- maestra se puede reconstruir el registro original completo.
-- =============================================================================

CREATE TEMP TABLE _mig_itin ON COMMIT DROP AS
WITH lados AS (
    SELECT
        t.id                                                     AS legacy_id,
        'LLEGADA'::text                                          AS tipo_movimiento,
        t.arr_movement_key                                       AS movement_key,
        coalesce(t.arr_movement_slot, '')                        AS movement_slot,
        t.arr_scheduled_date                                     AS fecha_operacion,
        public._aifa_flight_number(t."[Arr] Flight Designator",
                                   t."[Arr] Airline code")       AS numero_vuelo,
        t."[Arr] Airline code"                                   AS aerolinea_codigo,
        t."[Arr] SIBT"                                           AS hora_programada_txt,
        t."[Arr] ALDT"                                           AS hora_pista_txt,
        t."[Arr] AIBT"                                           AS hora_bloque_txt,
        NULL::text                                               AS attt_crudo,
        t."[Arr] Stand"                                          AS posicion,
        t."[Arr] Gates"                                          AS puertas,
        t."[Arr] Baggage Belts"                                  AS bandas_equipaje,
        t."[Arr] Boarded"                                        AS abordados_txt,
        t."[Arr] Service Type"                                   AS tipo_servicio,
        'A'::text                                                AS direccion,
        t."Status"                                               AS estatus_vuelo,
        t."Routing"                                              AS routing,
        t."Aircraft type"                                        AS tipo_aeronave,
        t."Registration"                                         AS matricula,
        coalesce(t.validado, false)                              AS validado,
        t.validado_por,
        t.validado_at,
        t.import_reference_date,
        to_jsonb(t)                                              AS crudo
    FROM public.itinerario_vuelos_editable t
    WHERE NULLIF(btrim(coalesce(t."[Arr] Flight Designator", '')), '') IS NOT NULL
      AND t.arr_scheduled_date IS NOT NULL

    UNION ALL

    SELECT
        t.id,
        'SALIDA',
        t.dep_movement_key,
        coalesce(t.dep_movement_slot, ''),
        t.dep_scheduled_date,
        public._aifa_flight_number(t."[Dep] Flight Designator",
                                   t."[Dep] Airline code"),
        t."[Dep] Airline code",
        t."[Dep] SOBT",
        t."[Dep] ATOT",
        t."[Dep] AOBT",
        t."[Dep] ATTT",   -- duración en minutos, NO una hora: ver la nota del UPDATE
        t."[Dep] Stand",
        t."[Dep] Gates",
        NULL,                       -- las bandas de equipaje solo aplican a llegadas
        t."[Dep] Boarded",
        t."[Dep] Service Type",
        'D',
        t."Status",
        t."Routing",
        t."Aircraft type",
        t."Registration",
        coalesce(t.validado, false),
        t.validado_por,
        t.validado_at,
        t.import_reference_date,
        to_jsonb(t)
    FROM public.itinerario_vuelos_editable t
    WHERE NULLIF(btrim(coalesce(t."[Dep] Flight Designator", '')), '') IS NOT NULL
      AND t.dep_scheduled_date IS NOT NULL
)
SELECT
    l.*,
    -- Extremo de la ruta que NO es NLU: destino para una salida, origen para una
    -- llegada. Solo se guarda como IATA si el código existe en el catálogo de
    -- aeropuertos; si no, la FK lo rechazaría y se pierde la fila entera.
    (SELECT ap.iata
       FROM public.catalogo_aeropuertos ap
      WHERE ap.iata = public._aifa_route_endpoint(l.routing, l.direccion)
      LIMIT 1)                                                   AS endpoint_iata,
    (SELECT a.id
       FROM public.airlines a
      WHERE upper(btrim(a.id)) = upper(btrim(l.aerolinea_codigo))
      LIMIT 1)                                                   AS aerolinea_id,
    (SELECT mm.id
       FROM public.matriculas_manifiestos mm
      WHERE public._aifa_normalize_identity_part(mm.matricula)
          = public._aifa_normalize_identity_part(l.matricula)
      LIMIT 1)                                                   AS matricula_id,
    (SELECT fst.codigo
       FROM public.flight_service_type fst
      WHERE upper(btrim(fst.codigo)) = upper(btrim(l.tipo_servicio))
      LIMIT 1)                                                   AS tipo_servicio_codigo,
    NULL::bigint                                                 AS maestra_id
FROM lados l;

-- Resolución: ¿esta fila de origen ya tiene su fila en maestra_operaciones?
--   1º por el id heredado del AODB (el vínculo más fuerte y ya indexado),
--   2º por identidad de movimiento (movement_key + slot), que es como la
--      encontraría una fila nacida antes desde Conciliación.
UPDATE _mig_itin s
SET maestra_id = m.id
FROM public.maestra_operaciones m
WHERE m.aodb_legacy_id = s.legacy_id
  AND m.tipo_movimiento = s.tipo_movimiento;

UPDATE _mig_itin s
SET maestra_id = m.id
FROM public.maestra_operaciones m
WHERE s.maestra_id IS NULL
  AND s.movement_key IS NOT NULL
  AND m.movement_key = s.movement_key
  AND coalesce(m.movement_slot, '') = s.movement_slot;

-- --- A.1 · Actualiza las filas que ya existen -------------------------------
-- Se asignan directamente (no coalesce): el itinerario es el dueño de estas
-- columnas, así que una reimportación del AODB debe poder corregirlas. Lo que
-- captura Manifiestos vive en otras columnas y no se toca aquí.
UPDATE public.maestra_operaciones m
SET
    aodb_legacy_id               = s.legacy_id,
    movement_key                 = coalesce(m.movement_key, s.movement_key),
    movement_slot                = coalesce(nullif(m.movement_slot, ''), s.movement_slot),
    estatus_vuelo                = s.estatus_vuelo,
    routing                      = s.routing,
    posicion                     = s.posicion,
    puertas                      = s.puertas,
    bandas_equipaje              = coalesce(s.bandas_equipaje, m.bandas_equipaje),
    pax_abordados                = public._aifa_safe_bigint(s.abordados_txt),
    hora_programada              = public._aifa_aodb_timestamptz(s.hora_programada_txt, s.fecha_operacion),
    hora_real_pista              = public._aifa_aodb_timestamptz(s.hora_pista_txt,      s.fecha_operacion),
    hora_real_bloque             = public._aifa_aodb_timestamptz(s.hora_bloque_txt,     s.fecha_operacion),
    -- hora_attt NO se llena desde "[Dep] ATTT". Comprobado contra los datos
    -- reales de la base: esa columna no trae una hora sino una DURACIÓN en
    -- minutos ("815'", "140'", "99'"), así que interpretarla como timestamptz
    -- daría NULL siempre y, peor, etiquetaría el dato como algo que no es.
    -- Queda íntegra en datos_origen->'itinerario_vuelos_editable'->>'[Dep] ATTT'.
    -- Si hace falta reportarla, pide una columna de minutos propia, no ésta.
    tipo_servicio_origen         = s.tipo_servicio,
    tipo_servicio_codigo         = coalesce(s.tipo_servicio_codigo, m.tipo_servicio_codigo),
    fecha_referencia_importacion = s.import_reference_date,
    validado                     = s.validado,
    validado_por                 = s.validado_por,
    validado_at                  = s.validado_at,
    -- Identidad compartida: el itinerario solo la PRECARGA. Si Manifiestos ya
    -- escribió algo ahí, se respeta — el capturista vio el documento real.
    numero_vuelo                 = coalesce(m.numero_vuelo, s.numero_vuelo),
    aerolinea_id                 = coalesce(m.aerolinea_id, s.aerolinea_id),
    aerolinea_origen             = coalesce(m.aerolinea_origen, s.aerolinea_codigo),
    matricula_id                 = coalesce(m.matricula_id, s.matricula_id),
    matricula_origen             = coalesce(m.matricula_origen, s.matricula),
    tipo_aeronave_codigo         = coalesce(m.tipo_aeronave_codigo, s.tipo_aeronave),
    origen_iata                  = CASE WHEN s.direccion = 'A' THEN coalesce(m.origen_iata,  s.endpoint_iata) ELSE m.origen_iata  END,
    destino_iata                 = CASE WHEN s.direccion = 'D' THEN coalesce(m.destino_iata, s.endpoint_iata) ELSE m.destino_iata END,
    -- El respaldo íntegro. Solo este paso lo escribe, en toda la migración.
    datos_origen                 = m.datos_origen
                                   || jsonb_build_object('itinerario_vuelos_editable', s.crudo),
    origenes                     = CASE
        WHEN m.origenes @> jsonb_build_array(jsonb_build_object('tabla', 'itinerario_vuelos_editable', 'id', s.legacy_id))
            THEN m.origenes
        ELSE m.origenes || jsonb_build_array(jsonb_build_object(
                'tabla', 'itinerario_vuelos_editable', 'id', s.legacy_id,
                'lado', CASE WHEN s.direccion = 'A' THEN 'Arr' ELSE 'Dep' END))
    END
FROM _mig_itin s
WHERE m.id = s.maestra_id;

-- --- A.2 · Inserta las que faltan -------------------------------------------
WITH nuevas AS (
    INSERT INTO public.maestra_operaciones (
        aodb_legacy_id, movement_key, movement_slot, tipo_movimiento, fecha_operacion,
        numero_vuelo, estatus_vuelo, routing, posicion, puertas, bandas_equipaje,
        pax_abordados, hora_programada, hora_real_pista, hora_real_bloque,
        tipo_servicio_origen, tipo_servicio_codigo, tipo_aeronave_codigo,
        aerolinea_id, aerolinea_origen, matricula_id, matricula_origen,
        origen_iata, destino_iata,
        validado, validado_por, validado_at, fecha_referencia_importacion,
        fuente_principal, origenes, datos_origen
    )
    SELECT
        s.legacy_id, s.movement_key, s.movement_slot, s.tipo_movimiento, s.fecha_operacion,
        s.numero_vuelo, s.estatus_vuelo, s.routing, s.posicion, s.puertas, s.bandas_equipaje,
        public._aifa_safe_bigint(s.abordados_txt),
        public._aifa_aodb_timestamptz(s.hora_programada_txt, s.fecha_operacion),
        public._aifa_aodb_timestamptz(s.hora_pista_txt,      s.fecha_operacion),
        public._aifa_aodb_timestamptz(s.hora_bloque_txt,     s.fecha_operacion),
        s.tipo_servicio, s.tipo_servicio_codigo, s.tipo_aeronave,
        s.aerolinea_id, s.aerolinea_codigo, s.matricula_id, s.matricula,
        CASE WHEN s.direccion = 'A' THEN s.endpoint_iata END,
        CASE WHEN s.direccion = 'D' THEN s.endpoint_iata END,
        s.validado, s.validado_por, s.validado_at, s.import_reference_date,
        'ITINERARIO_VUELOS_EDITABLE',
        jsonb_build_array(jsonb_build_object(
            'tabla', 'itinerario_vuelos_editable', 'id', s.legacy_id,
            'lado', CASE WHEN s.direccion = 'A' THEN 'Arr' ELSE 'Dep' END)),
        jsonb_build_object('itinerario_vuelos_editable', s.crudo)
    FROM _mig_itin s
    WHERE s.maestra_id IS NULL
    RETURNING id, aodb_legacy_id, tipo_movimiento
)
UPDATE _mig_itin s
SET maestra_id = n.id
FROM nuevas n
WHERE n.aodb_legacy_id = s.legacy_id
  AND n.tipo_movimiento = s.tipo_movimiento;

-- =============================================================================
-- PASO B — "Conciliación Manifiestos" → maestra_operaciones
--
-- La capa de captura. Escribe encima de lo que dejó el itinerario en las
-- columnas compartidas y llena en exclusiva las columnas de manifiesto.
-- NO TOCA datos_origen.
--
-- El emparejamiento con la fila que dejó el itinerario es el punto delicado:
-- Conciliación no tiene movement_slot. Cuando un movement_key tiene un solo
-- movimiento en maestra, se empareja sin más. Cuando tiene varios (rotación
-- doble), se intenta desempatar con "SLOT ASIGNADO"; si tampoco alcanza, la
-- fila se queda como registro propio y aparece listada en la VERIFICACIÓN para
-- revisarla a mano, en vez de adivinar y cruzar el manifiesto con el vuelo
-- equivocado.
-- =============================================================================

CREATE TEMP TABLE _mig_conci ON COMMIT DROP AS
SELECT
    cm.id                                                        AS legacy_id,
    cm.cliente_uuid,
    cm.movement_key,
    public._aifa_movement_slot(cm."SLOT ASIGNADO")               AS slot_candidato,
    CASE public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO")
        WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
    END                                                          AS tipo_movimiento,
    coalesce(cm."_portal_flight_date",
             public._aifa_parse_manifest_date(cm."FECHA"))       AS fecha_operacion,
    (SELECT mm.id
       FROM public.matriculas_manifiestos mm
      WHERE public._aifa_normalize_identity_part(mm.matricula)
          = public._aifa_normalize_identity_part(cm."MATRÍCULA")
      LIMIT 1)                                                   AS matricula_id,
    (SELECT c.id
       FROM public.conciliacion_catalogo_aerolineas c
      WHERE lower(btrim(c.name)) = lower(btrim(cm."AEROLINEA"))
         OR upper(btrim(coalesce(c.iata, ''))) = upper(btrim(cm."AEROLINEA"))
         OR lower(btrim(cm."AEROLINEA")) = ANY (SELECT lower(btrim(a)) FROM unnest(c.aliases) a)
      ORDER BY (lower(btrim(c.name)) = lower(btrim(cm."AEROLINEA"))) DESC
      LIMIT 1)                                                   AS aerolinea_conciliacion_id,
    NULL::bigint                                                 AS maestra_id,
    NULL::text                                                   AS ambiguedad
FROM public."Conciliación Manifiestos" cm;

-- fecha_operacion y tipo_movimiento son NOT NULL con CHECK en la maestra. Una
-- fila cuyo "TIPO DE MANIFIESTO" o "FECHA" no se pudieron interpretar no puede
-- migrarse; se marca y se reporta en vez de tumbar el paso completo.
UPDATE _mig_conci
SET ambiguedad = 'sin_tipo_o_fecha'
WHERE tipo_movimiento IS NULL OR fecha_operacion IS NULL;

-- 1º por el id heredado (ya migrada en una corrida anterior)
UPDATE _mig_conci s
SET maestra_id = m.id
FROM public.maestra_operaciones m
WHERE s.ambiguedad IS NULL
  AND m.conciliacion_manifiesto_legacy_id = s.legacy_id;

-- 2º por cliente_uuid
UPDATE _mig_conci s
SET maestra_id = m.id
FROM public.maestra_operaciones m
WHERE s.maestra_id IS NULL
  AND s.ambiguedad IS NULL
  AND s.cliente_uuid IS NOT NULL
  AND m.cliente_uuid = s.cliente_uuid;

-- 3º por identidad de movimiento, con el slot como desempate
UPDATE _mig_conci s
SET maestra_id = (
    SELECT m.id
      FROM public.maestra_operaciones m
     WHERE m.movement_key = s.movement_key
       AND m.conciliacion_manifiesto_legacy_id IS NULL
     ORDER BY (coalesce(m.movement_slot, '') = s.slot_candidato) DESC,
              m.id
     LIMIT 1
)
WHERE s.maestra_id IS NULL
  AND s.ambiguedad IS NULL
  AND s.movement_key IS NOT NULL
  AND (
      -- un solo movimiento con esa llave: no hay nada que desempatar
      (SELECT count(*) FROM public.maestra_operaciones m2
        WHERE m2.movement_key = s.movement_key) = 1
      -- o varios, pero el slot resuelve cuál
      OR EXISTS (SELECT 1 FROM public.maestra_operaciones m3
                  WHERE m3.movement_key = s.movement_key
                    AND coalesce(m3.movement_slot, '') = s.slot_candidato)
  );

-- Rotación doble que el slot no pudo desempatar: se anota para el reporte. La
-- fila igual se migra, pero como registro propio y no cruzada con ningún vuelo.
UPDATE _mig_conci s
SET ambiguedad = 'rotacion_doble_sin_desempate'
WHERE s.maestra_id IS NULL
  AND s.ambiguedad IS NULL
  AND s.movement_key IS NOT NULL
  AND (SELECT count(*) FROM public.maestra_operaciones m
        WHERE m.movement_key = s.movement_key) > 1;

-- -----------------------------------------------------------------------------
-- ¿Qué filas pueden conservar su identidad de movimiento al insertarse?
--
-- Una fila que no encontró destino se va a INSERTAR. Si lo hace con un
-- (movement_key, movement_slot) que YA está ocupado, el índice único
-- uq_maestra_operaciones_movement_identity la rechaza y se cae la migración
-- entera — no solo esa fila.
--
-- Pasa en dos situaciones reales:
--   (a) el manifiesto duplica a otro que ya tomó ese movimiento (dos capturas
--       del mismo vuelo, o una rotación doble donde el vuelo libre ya se agotó);
--   (b) dos manifiestos de ESTE mismo lote reclaman la misma identidad, y el
--       INSERT las choca entre sí dentro de una sola sentencia.
--
-- A la que no puede conservarla se le retira y se inserta como registro propio.
-- Quedarse sin movement_key significa que no cruza con ningún vuelo, que es
-- justo lo correcto para un duplicado que alguien tiene que resolver a mano: el
-- dato no se pierde y no se cruza con el vuelo equivocado.
-- -----------------------------------------------------------------------------
ALTER TABLE _mig_conci ADD COLUMN conserva_identidad boolean NOT NULL DEFAULT true;

-- (a) la identidad ya está ocupada en maestra_operaciones
UPDATE _mig_conci s
SET conserva_identidad = false
WHERE s.maestra_id IS NULL
  AND (
      s.movement_key IS NULL
      OR EXISTS (
          SELECT 1 FROM public.maestra_operaciones m
           WHERE m.movement_key = s.movement_key
             AND coalesce(m.movement_slot, '') = coalesce(s.slot_candidato, '')
      )
  );

-- (b) entre las que sobrevivieron a (a), solo la de id más bajo se queda con la
--     identidad. La sentencia lee la foto de _mig_conci anterior a sí misma, así
--     que "las que sobrevivieron" es un conjunto estable mientras se evalúa.
UPDATE _mig_conci s
SET conserva_identidad = false
WHERE s.maestra_id IS NULL
  AND s.conserva_identidad
  AND EXISTS (
      SELECT 1 FROM _mig_conci o
       WHERE o.maestra_id IS NULL
         AND o.conserva_identidad
         AND o.legacy_id < s.legacy_id
         AND o.movement_key = s.movement_key
         AND coalesce(o.slot_candidato, '') = coalesce(s.slot_candidato, '')
  );

UPDATE _mig_conci s
SET ambiguedad = 'identidad_ocupada_se_inserta_suelta'
WHERE s.maestra_id IS NULL
  AND s.ambiguedad IS NULL
  AND NOT s.conserva_identidad
  AND s.movement_key IS NOT NULL;

-- --- B.1 · Actualiza --------------------------------------------------------
UPDATE public.maestra_operaciones m
SET
    conciliacion_manifiesto_legacy_id = s.legacy_id,
    cliente_uuid              = coalesce(s.cliente_uuid, m.cliente_uuid),
    movement_key              = coalesce(m.movement_key, s.movement_key),
    -- Identidad: el capturista corrige lo que el AODB precargó.
    numero_vuelo              = coalesce(NULLIF(btrim(cm."# DE VUELO"), ''),        m.numero_vuelo),
    aerolinea_origen          = coalesce(NULLIF(btrim(cm."AEROLINEA"), ''),         m.aerolinea_origen),
    aerolinea_conciliacion_id = coalesce(s.aerolinea_conciliacion_id,               m.aerolinea_conciliacion_id),
    matricula_origen          = coalesce(NULLIF(btrim(cm."MATRÍCULA"), ''),         m.matricula_origen),
    matricula_id              = coalesce(s.matricula_id,                            m.matricula_id),
    tipo_aeronave_codigo      = coalesce(NULLIF(btrim(cm."AERONAVE"), ''),          m.tipo_aeronave_codigo),
    -- Columnas exclusivas de la captura: asignación directa, el manifiesto manda.
    tipo_manifiesto           = NULLIF(btrim(cm."TIPO DE MANIFIESTO"), ''),
    tipo_operacion            = NULLIF(btrim(cm."TIPO DE OPERACIÓN"), ''),
    estatus_matricula         = NULLIF(btrim(cm."ESTATUS MATRÍCULA"), ''),
    ruta_origen               = NULLIF(btrim(cm."RUTA"), ''),
    origen_origen             = CASE WHEN s.tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(cm."DESTINO / ORIGEN"), '') ELSE m.origen_origen  END,
    destino_origen            = CASE WHEN s.tipo_movimiento = 'SALIDA'  THEN NULLIF(btrim(cm."DESTINO / ORIGEN"), '') ELSE m.destino_origen END,
    slot_asignado             = public._aifa_safe_timestamptz(cm."SLOT ASIGNADO",                       s.fecha_operacion),
    slot_coordinado           = public._aifa_safe_timestamptz(cm."SLOT COORDINADO",                     s.fecha_operacion),
    hora_pernocta             = public._aifa_safe_timestamptz(cm."HR. DE INICIO O TERMINO DE PERNOCTA", s.fecha_operacion),
    hora_embarque_desembarque = public._aifa_safe_timestamptz(cm."HR. DE EMBARQUE O DESEMBARQUE",       s.fecha_operacion),
    hora_operacion            = public._aifa_safe_timestamptz(cm."HR. DE OPERACIÓN",                    s.fecha_operacion),
    hora_maxima_entrega       = public._aifa_safe_timestamptz(cm."HR. MÁXIMA DE ENTREGA",               s.fecha_operacion),
    hora_recepcion            = public._aifa_safe_timestamptz(cm."HR. DE RECEPCIÓN",                    s.fecha_operacion),
    horas_cumplidas           = cm."HRS. CUMPLIDAS"::numeric(12,3),
    estado_puntualidad        = NULLIF(btrim(cm."PUNTUALIDAD / CANCELACIÓN"), ''),
    demora_15_min             = NULLIF(btrim(cm."DEMORA +- 15 MIN."), ''),
    codigo_demora_origen      = NULLIF(btrim(cm."CÓDIGO DEMORA"), ''),
    demora_catalogo_id        = (SELECT cd.id FROM public.catalogo_demoras cd
                                  WHERE upper(btrim(cd.codigo)) = upper(btrim(cm."CÓDIGO DEMORA"))
                                    AND cd.tipo_movimiento = s.tipo_movimiento
                                  LIMIT 1),
    pax_total                 = cm."TOTAL PAX",
    pax_diplomaticos          = public._aifa_safe_bigint(cm."DIPLOMATICOS"),
    pax_comision              = public._aifa_safe_bigint(cm."EN COMISION"),
    pax_infantes              = public._aifa_safe_bigint(cm."INFANTES"),
    pax_transitos             = public._aifa_safe_bigint(cm."TRANSITOS"),
    pax_conexiones            = public._aifa_safe_bigint(cm."CONEXIONES"),
    pax_otros_exentos         = public._aifa_safe_bigint(cm."OTROS EXENTOS"),
    pax_exentos_reportados    = public._aifa_safe_bigint(cm."TOTAL EXENTOS"),
    pax_pagan_tua_reportados  = public._aifa_safe_bigint(cm."PAX QUE PAGAN TUA"),
    equipaje_kg               = cm."KGS. DE EQUIPAJE",
    -- carga_total_kg es el TOTAL EFECTIVO, no la copia literal de la columna.
    -- Regla de _conciSummaryCargoKgs (script.js) y del test conciliacion-kgs-carga:
    -- si el capturista puso el total, ése manda; si no, se suman nacional e
    -- internacional; nunca los tres, porque el total ya incluye a los otros dos.
    -- Copiarlo literal dejaba en NULL a las filas con desglose y sin total, y el
    -- Informe Estadístico —que lee esta columna como carga_kg— las reportaría en
    -- cero aunque la pantalla de Conciliación sí muestra la suma.
    carga_total_kg            = coalesce(
        public._aifa_safe_numeric(cm."KG DE CARGA TOTAL"),
        CASE WHEN cm."KGS. DE CARGA NACIONAL" IS NOT NULL
               OR cm."KGS. DE CARGA INTERNACIONAL" IS NOT NULL
             THEN coalesce(cm."KGS. DE CARGA NACIONAL", 0)
                + coalesce(cm."KGS. DE CARGA INTERNACIONAL", 0)
        END),
    carga_nacional_kg         = cm."KGS. DE CARGA NACIONAL",
    carga_internacional_kg    = cm."KGS. DE CARGA INTERNACIONAL",
    correo_kg                 = public._aifa_safe_numeric(cm."CORREO"),
    observaciones             = NULLIF(btrim(cm."OBSERVACIONES"), ''),
    cierre_subsecretaria      = NULLIF(btrim(cm."CIERRE SUBSECRETARIA"), ''),
    capturado_por             = NULLIF(btrim(cm."CAPTURÓ"), ''),
    evidencia_url             = NULLIF(btrim(cm."EVIDENCIA"), ''),
    fecha_generacion          = public._aifa_safe_timestamptz(cm."Hora y Fecha Generación", s.fecha_operacion),
    conciliado                = true,
    -- Workflow del portal
    portal_user_id            = coalesce(cm._portal_user_id,      m.portal_user_id),
    portal_empresa            = coalesce(cm._portal_company,      m.portal_empresa),
    portal_fecha_vuelo        = coalesce(cm._portal_flight_date,  m.portal_fecha_vuelo),
    portal_estatus            = coalesce(cm._portal_status,       m.portal_estatus),
    portal_notas_revision     = coalesce(cm._portal_review_notes, m.portal_notas_revision),
    portal_revisado_por       = coalesce(cm._portal_reviewed_by,  m.portal_revisado_por),
    portal_revisado_at        = coalesce(cm._portal_reviewed_at,  m.portal_revisado_at),
    portal_creado_at          = coalesce(cm._portal_created_at,   m.portal_creado_at),
    portal_aprobacion_aifa    = coalesce(cm._portal_aprob_aifa,   m.portal_aprobacion_aifa),
    portal_aifa_por           = coalesce(cm._portal_aifa_by,      m.portal_aifa_por),
    portal_aifa_por_nombre    = coalesce(cm._portal_aifa_by_name, m.portal_aifa_por_nombre),
    portal_aifa_at            = coalesce(cm._portal_aifa_at,      m.portal_aifa_at),
    portal_aifa_notas         = coalesce(cm._portal_aifa_notes,   m.portal_aifa_notas),
    portal_aprobacion_afac    = coalesce(cm._portal_aprob_afac,   m.portal_aprobacion_afac),
    portal_afac_por           = coalesce(cm._portal_afac_by,      m.portal_afac_por),
    portal_afac_por_nombre    = coalesce(cm._portal_afac_by_name, m.portal_afac_por_nombre),
    portal_afac_at            = coalesce(cm._portal_afac_at,      m.portal_afac_at),
    portal_afac_notas         = coalesce(cm._portal_afac_notes,   m.portal_afac_notas),
    portal_manifiesto_datos   = m.portal_manifiesto_datos
                                || coalesce(cm._portal_manifest_data, '{}'::jsonb),
    origenes                  = CASE
        WHEN m.origenes @> jsonb_build_array(jsonb_build_object('tabla', 'Conciliación Manifiestos', 'id', s.legacy_id))
            THEN m.origenes
        ELSE m.origenes || jsonb_build_array(jsonb_build_object('tabla', 'Conciliación Manifiestos', 'id', s.legacy_id))
    END
FROM _mig_conci s
JOIN public."Conciliación Manifiestos" cm ON cm.id = s.legacy_id
WHERE m.id = s.maestra_id;

-- --- B.2 · Inserta ----------------------------------------------------------
WITH nuevas AS (
    INSERT INTO public.maestra_operaciones (
        conciliacion_manifiesto_legacy_id, cliente_uuid, movement_key, movement_slot,
        fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto, tipo_operacion,
        tipo_aeronave_codigo, matricula_id, matricula_origen, estatus_matricula,
        aerolinea_conciliacion_id, aerolinea_origen, ruta_origen, origen_origen, destino_origen,
        slot_asignado, slot_coordinado, hora_pernocta, hora_embarque_desembarque,
        hora_operacion, hora_maxima_entrega, hora_recepcion, horas_cumplidas,
        estado_puntualidad, demora_15_min, codigo_demora_origen, demora_catalogo_id,
        pax_total, pax_diplomaticos, pax_comision, pax_infantes, pax_transitos,
        pax_conexiones, pax_otros_exentos, pax_exentos_reportados, pax_pagan_tua_reportados,
        equipaje_kg, carga_total_kg, carga_nacional_kg, carga_internacional_kg, correo_kg,
        observaciones, cierre_subsecretaria, capturado_por, evidencia_url, fecha_generacion,
        conciliado, validado,
        portal_user_id, portal_empresa, portal_fecha_vuelo, portal_estatus,
        portal_notas_revision, portal_revisado_por, portal_revisado_at, portal_creado_at,
        portal_aprobacion_aifa, portal_aifa_por, portal_aifa_por_nombre, portal_aifa_at,
        portal_aifa_notas, portal_aprobacion_afac, portal_afac_por, portal_afac_por_nombre,
        portal_afac_at, portal_afac_notas, portal_manifiesto_datos,
        fuente_principal, origenes
    )
    SELECT
        s.legacy_id, s.cliente_uuid,
        -- Sin identidad si otro manifiesto ya reclamó ese movimiento: ver el
        -- bloque "¿Qué filas pueden conservar su identidad?" de más arriba.
        CASE WHEN s.conserva_identidad THEN s.movement_key   END,
        CASE WHEN s.conserva_identidad THEN s.slot_candidato END,
        s.fecha_operacion, s.tipo_movimiento,
        NULLIF(btrim(cm."# DE VUELO"), ''),
        NULLIF(btrim(cm."TIPO DE MANIFIESTO"), ''),
        NULLIF(btrim(cm."TIPO DE OPERACIÓN"), ''),
        NULLIF(btrim(cm."AERONAVE"), ''),
        s.matricula_id,
        NULLIF(btrim(cm."MATRÍCULA"), ''),
        NULLIF(btrim(cm."ESTATUS MATRÍCULA"), ''),
        s.aerolinea_conciliacion_id,
        NULLIF(btrim(cm."AEROLINEA"), ''),
        NULLIF(btrim(cm."RUTA"), ''),
        CASE WHEN s.tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(cm."DESTINO / ORIGEN"), '') END,
        CASE WHEN s.tipo_movimiento = 'SALIDA'  THEN NULLIF(btrim(cm."DESTINO / ORIGEN"), '') END,
        public._aifa_safe_timestamptz(cm."SLOT ASIGNADO",                       s.fecha_operacion),
        public._aifa_safe_timestamptz(cm."SLOT COORDINADO",                     s.fecha_operacion),
        public._aifa_safe_timestamptz(cm."HR. DE INICIO O TERMINO DE PERNOCTA", s.fecha_operacion),
        public._aifa_safe_timestamptz(cm."HR. DE EMBARQUE O DESEMBARQUE",       s.fecha_operacion),
        public._aifa_safe_timestamptz(cm."HR. DE OPERACIÓN",                    s.fecha_operacion),
        public._aifa_safe_timestamptz(cm."HR. MÁXIMA DE ENTREGA",               s.fecha_operacion),
        public._aifa_safe_timestamptz(cm."HR. DE RECEPCIÓN",                    s.fecha_operacion),
        cm."HRS. CUMPLIDAS"::numeric(12,3),
        NULLIF(btrim(cm."PUNTUALIDAD / CANCELACIÓN"), ''),
        NULLIF(btrim(cm."DEMORA +- 15 MIN."), ''),
        NULLIF(btrim(cm."CÓDIGO DEMORA"), ''),
        (SELECT cd.id FROM public.catalogo_demoras cd
          WHERE upper(btrim(cd.codigo)) = upper(btrim(cm."CÓDIGO DEMORA"))
            AND cd.tipo_movimiento = s.tipo_movimiento
          LIMIT 1),
        cm."TOTAL PAX",
        public._aifa_safe_bigint(cm."DIPLOMATICOS"),
        public._aifa_safe_bigint(cm."EN COMISION"),
        public._aifa_safe_bigint(cm."INFANTES"),
        public._aifa_safe_bigint(cm."TRANSITOS"),
        public._aifa_safe_bigint(cm."CONEXIONES"),
        public._aifa_safe_bigint(cm."OTROS EXENTOS"),
        public._aifa_safe_bigint(cm."TOTAL EXENTOS"),
        public._aifa_safe_bigint(cm."PAX QUE PAGAN TUA"),
        cm."KGS. DE EQUIPAJE",
        -- Total efectivo, misma regla que en el UPDATE de arriba.
        coalesce(
            public._aifa_safe_numeric(cm."KG DE CARGA TOTAL"),
            CASE WHEN cm."KGS. DE CARGA NACIONAL" IS NOT NULL
                   OR cm."KGS. DE CARGA INTERNACIONAL" IS NOT NULL
                 THEN coalesce(cm."KGS. DE CARGA NACIONAL", 0)
                    + coalesce(cm."KGS. DE CARGA INTERNACIONAL", 0)
            END),
        cm."KGS. DE CARGA NACIONAL",
        cm."KGS. DE CARGA INTERNACIONAL",
        public._aifa_safe_numeric(cm."CORREO"),
        NULLIF(btrim(cm."OBSERVACIONES"), ''),
        NULLIF(btrim(cm."CIERRE SUBSECRETARIA"), ''),
        NULLIF(btrim(cm."CAPTURÓ"), ''),
        NULLIF(btrim(cm."EVIDENCIA"), ''),
        public._aifa_safe_timestamptz(cm."Hora y Fecha Generación", s.fecha_operacion),
        true, true,
        cm._portal_user_id, cm._portal_company, cm._portal_flight_date, cm._portal_status,
        cm._portal_review_notes, cm._portal_reviewed_by, cm._portal_reviewed_at, cm._portal_created_at,
        cm._portal_aprob_aifa, cm._portal_aifa_by, cm._portal_aifa_by_name, cm._portal_aifa_at,
        cm._portal_aifa_notes, cm._portal_aprob_afac, cm._portal_afac_by, cm._portal_afac_by_name,
        cm._portal_afac_at, cm._portal_afac_notes, coalesce(cm._portal_manifest_data, '{}'::jsonb),
        'CONCILIACION_MANIFIESTOS',
        jsonb_build_array(jsonb_build_object('tabla', 'Conciliación Manifiestos', 'id', s.legacy_id))
    FROM _mig_conci s
    JOIN public."Conciliación Manifiestos" cm ON cm.id = s.legacy_id
    WHERE s.maestra_id IS NULL
      AND s.ambiguedad IS DISTINCT FROM 'sin_tipo_o_fecha'
    RETURNING id, conciliacion_manifiesto_legacy_id
)
UPDATE _mig_conci s
SET maestra_id = n.id
FROM nuevas n
WHERE n.conciliacion_manifiesto_legacy_id = s.legacy_id;

-- =============================================================================
-- PASO C — manifiestos_pasajeros y manifiestos_carga → maestra_operaciones
--
-- El formato oficial AFAC entero se guarda en portal_manifiesto_datos, según lo
-- acordado: son datos que se imprimen en el manifiesto, no dimensiones de
-- reporte. Solo suben a columna el folio (identidad del documento) y las cifras
-- que Estadística sí suma.
--
-- legacy_manifest_id apunta al id de "Conciliación Manifiestos" con el que nació
-- el manifiesto, así que ése es el vínculo más directo con la fila de maestra.
-- =============================================================================

-- --- C.1 · manifiestos_pasajeros -------------------------------------------
CREATE TEMP TABLE _mig_pax ON COMMIT DROP AS
SELECT
    mp.id                                                        AS legacy_uuid,
    NULLIF(btrim(mp.legacy_manifest_id), '')::bigint             AS conci_legacy_id,
    mp.fecha_vuelo,
    CASE lower(btrim(coalesce(mp.direccion, '')))
        WHEN 'llegada' THEN 'LLEGADA' WHEN 'salida' THEN 'SALIDA' ELSE NULL
    END                                                          AS tipo_movimiento,
    NULL::bigint                                                 AS maestra_id
FROM public.manifiestos_pasajeros mp;

UPDATE _mig_pax s
SET maestra_id = m.id
FROM public.maestra_operaciones m
WHERE s.conci_legacy_id IS NOT NULL
  AND m.conciliacion_manifiesto_legacy_id = s.conci_legacy_id;

UPDATE public.maestra_operaciones m
SET
    folio                   = coalesce(NULLIF(btrim(mp.folio), ''), m.folio),
    pax_total               = coalesce(m.pax_total, NULLIF(round(mp.total_pasajeros)::bigint, 0)),
    equipaje_kg             = coalesce(m.equipaje_kg, NULLIF(mp.total_equipaje_kg, 0)),
    carga_total_kg          = coalesce(m.carga_total_kg, NULLIF(mp.total_carga_kg, 0)),
    correo_kg               = coalesce(m.correo_kg, NULLIF(mp.total_correo_kg, 0)),
    portal_estatus          = coalesce(m.portal_estatus, mp.estado),
    portal_empresa          = coalesce(m.portal_empresa, mp.empresa),
    portal_user_id          = coalesce(m.portal_user_id, mp.user_id),
    -- El formato oficial íntegro, bajo su propia llave para no chocar con lo que
    -- el portal ya hubiera guardado.
    portal_manifiesto_datos = m.portal_manifiesto_datos
                              || jsonb_build_object('manifiesto_pasajeros',
                                   to_jsonb(mp)),
    origenes                = CASE
        WHEN m.origenes @> jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_pasajeros', 'id', mp.id))
            THEN m.origenes
        ELSE m.origenes || jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_pasajeros', 'id', mp.id))
    END
FROM _mig_pax s
JOIN public.manifiestos_pasajeros mp ON mp.id = s.legacy_uuid
WHERE m.id = s.maestra_id;

-- --- C.2 · manifiestos_carga ------------------------------------------------
CREATE TEMP TABLE _mig_carga ON COMMIT DROP AS
SELECT
    mc.id                                                        AS legacy_id,
    NULLIF(btrim(mc.legacy_manifest_id), '')::bigint             AS conci_legacy_id,
    CASE lower(btrim(coalesce(mc.direccion, '')))
        WHEN 'llegada' THEN 'LLEGADA' WHEN 'salida' THEN 'SALIDA' ELSE NULL
    END                                                          AS tipo_movimiento,
    NULL::bigint                                                 AS maestra_id
FROM public.manifiestos_carga mc;

UPDATE _mig_carga s
SET maestra_id = m.id
FROM public.maestra_operaciones m
WHERE s.conci_legacy_id IS NOT NULL
  AND m.conciliacion_manifiesto_legacy_id = s.conci_legacy_id;

UPDATE public.maestra_operaciones m
SET
    folio                   = coalesce(NULLIF(btrim(mc.folio), ''), m.folio),
    pax_total               = coalesce(m.pax_total, NULLIF(round(mc.total_pasajeros)::bigint, 0)),
    equipaje_kg             = coalesce(m.equipaje_kg, NULLIF(mc.total_equipaje_kg, 0)),
    carga_total_kg          = coalesce(m.carga_total_kg, NULLIF(mc.total_carga_kg, 0)),
    correo_kg               = coalesce(m.correo_kg, NULLIF(mc.total_correo_kg, 0)),
    portal_estatus          = coalesce(m.portal_estatus, mc.estado),
    portal_empresa          = coalesce(m.portal_empresa, mc.empresa),
    portal_user_id          = coalesce(m.portal_user_id, mc.user_id),
    portal_manifiesto_datos = m.portal_manifiesto_datos
                              || jsonb_build_object('manifiesto_carga',
                                   to_jsonb(mc)),
    origenes                = CASE
        WHEN m.origenes @> jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_carga', 'id', mc.id))
            THEN m.origenes
        ELSE m.origenes || jsonb_build_array(jsonb_build_object('tabla', 'manifiestos_carga', 'id', mc.id))
    END
FROM _mig_carga s
JOIN public.manifiestos_carga mc ON mc.id = s.legacy_id
WHERE m.id = s.maestra_id;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
CREATE TEMP TABLE _mig_reporte (paso text, prueba text, valor text) ON COMMIT DROP;

INSERT INTO _mig_reporte
SELECT 'A · Itinerario', 'filas de origen', count(*)::text FROM public.itinerario_vuelos_editable
UNION ALL SELECT 'A · Itinerario', 'movimientos producibles',   count(*)::text FROM _mig_itin
UNION ALL SELECT 'A · Itinerario', 'ya existían (actualizadas)', count(*)::text FROM _mig_itin WHERE maestra_id IS NOT NULL
UNION ALL SELECT 'A · Itinerario', 'sin fila en maestra (ERROR si > 0)', count(*)::text FROM _mig_itin WHERE maestra_id IS NULL
UNION ALL SELECT 'A · Itinerario', 'lado llegada descartado (sin designator o sin fecha)',
    (SELECT count(*)::text FROM public.itinerario_vuelos_editable
      WHERE NULLIF(btrim(coalesce("[Arr] Flight Designator", '')), '') IS NULL
         OR arr_scheduled_date IS NULL)
UNION ALL SELECT 'A · Itinerario', 'lado salida descartado (sin designator o sin fecha)',
    (SELECT count(*)::text FROM public.itinerario_vuelos_editable
      WHERE NULLIF(btrim(coalesce("[Dep] Flight Designator", '')), '') IS NULL
         OR dep_scheduled_date IS NULL)

UNION ALL SELECT 'B · Conciliación', 'filas de origen',           count(*)::text FROM public."Conciliación Manifiestos"
UNION ALL SELECT 'B · Conciliación', 'migradas',                  count(*)::text FROM _mig_conci WHERE maestra_id IS NOT NULL
UNION ALL SELECT 'B · Conciliación', 'cruzadas con un vuelo',     count(*)::text FROM _mig_conci s WHERE s.maestra_id IN (SELECT maestra_id FROM _mig_itin WHERE maestra_id IS NOT NULL)
UNION ALL SELECT 'B · Conciliación', 'sin tipo o sin fecha (REVISAR)', count(*)::text FROM _mig_conci WHERE ambiguedad = 'sin_tipo_o_fecha'
UNION ALL SELECT 'B · Conciliación', 'rotación doble sin desempate (REVISAR)', count(*)::text FROM _mig_conci WHERE ambiguedad = 'rotacion_doble_sin_desempate'
UNION ALL SELECT 'B · Conciliación', 'identidad ya ocupada, insertadas sueltas (REVISAR)', count(*)::text FROM _mig_conci WHERE ambiguedad = 'identidad_ocupada_se_inserta_suelta'

UNION ALL SELECT 'C · Portal pax',   'filas de origen',          count(*)::text FROM public.manifiestos_pasajeros
UNION ALL SELECT 'C · Portal pax',   'enlazadas a maestra',      count(*)::text FROM _mig_pax WHERE maestra_id IS NOT NULL
UNION ALL SELECT 'C · Portal pax',   'sin manifiesto padre (REVISAR)', count(*)::text FROM _mig_pax WHERE maestra_id IS NULL
UNION ALL SELECT 'C · Portal carga', 'filas de origen',          count(*)::text FROM public.manifiestos_carga
UNION ALL SELECT 'C · Portal carga', 'enlazadas a maestra',      count(*)::text FROM _mig_carga WHERE maestra_id IS NOT NULL
UNION ALL SELECT 'C · Portal carga', 'sin manifiesto padre (REVISAR)', count(*)::text FROM _mig_carga WHERE maestra_id IS NULL

UNION ALL SELECT 'TOTAL', 'filas en maestra_operaciones',        count(*)::text FROM public.maestra_operaciones
UNION ALL SELECT 'TOTAL', 'con datos_origen del itinerario',     count(*)::text FROM public.maestra_operaciones WHERE datos_origen ? 'itinerario_vuelos_editable'
UNION ALL SELECT 'TOTAL', 'con captura de manifiesto',           count(*)::text FROM public.maestra_operaciones WHERE hora_recepcion IS NOT NULL
UNION ALL SELECT 'TOTAL', 'con formato oficial en portal_manifiesto_datos', count(*)::text
    FROM public.maestra_operaciones
    WHERE portal_manifiesto_datos ? 'manifiesto_pasajeros' OR portal_manifiesto_datos ? 'manifiesto_carga';

SELECT paso, prueba, valor FROM _mig_reporte ORDER BY paso, prueba;

-- Detalle de lo que quedó pendiente de revisión humana.
SELECT 'conciliacion_sin_tipo_o_fecha' AS caso, s.legacy_id,
       cm."FECHA", cm."TIPO DE MANIFIESTO", cm."# DE VUELO", cm."AEROLINEA"
  FROM _mig_conci s
  JOIN public."Conciliación Manifiestos" cm ON cm.id = s.legacy_id
 WHERE s.ambiguedad = 'sin_tipo_o_fecha'
 ORDER BY s.legacy_id
 LIMIT 200;

SELECT s.ambiguedad AS caso, s.legacy_id, s.movement_key,
       s.slot_candidato, cm."SLOT ASIGNADO", cm."# DE VUELO", cm."FECHA"
  FROM _mig_conci s
  JOIN public."Conciliación Manifiestos" cm ON cm.id = s.legacy_id
 WHERE s.ambiguedad IN ('rotacion_doble_sin_desempate', 'identidad_ocupada_se_inserta_suelta')
 ORDER BY s.ambiguedad, s.legacy_id
 LIMIT 200;

-- Ninguna fila del itinerario puede quedarse sin su fila en maestra.
DO $$
DECLARE v_faltan bigint;
BEGIN
    SELECT count(*) INTO v_faltan FROM _mig_itin WHERE maestra_id IS NULL;
    IF v_faltan > 0 THEN
        RAISE EXCEPTION 'PASO A incompleto: % movimientos del itinerario sin fila en maestra_operaciones', v_faltan;
    END IF;
END $$;

-- =============================================================================
-- Revisar los tres listados de arriba. Si los conteos cuadran y los casos a
-- revisar son aceptables, cambiar la siguiente línea de ROLLBACK a COMMIT y
-- volver a correr el archivo completo.
-- =============================================================================
ROLLBACK;
