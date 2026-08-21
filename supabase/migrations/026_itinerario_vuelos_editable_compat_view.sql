-- =============================================================================
-- Fase 3a — Vista de compatibilidad para migrar los READS del Itinerario/Slots
-- hacia maestra_operaciones, sin tocar ningún WRITE.
--
-- itinerario_vuelos_editable es una tabla "ancha" (una fila = un vuelo-día,
-- con columnas "[Arr] ..." y "[Dep] ..." combinadas). maestra_operaciones
-- normaliza a una fila por movimiento (LLEGADA/SALIDA separados). El trigger
-- _aifa_sync_itinerario_to_maestra (024/025) guarda en cada sincronización la
-- fila original COMPLETA como JSON en datos_origen->'itinerario_vuelos_editable'
-- (to_jsonb(NEW), con ambos lados Arr/Dep), sin importar cuál lado disparó la
-- sincronización — así que basta una fila representativa por aodb_legacy_id
-- para reconstruir la forma ancha original exacta.
--
-- PASO A: backfill de seguridad — re-dispara el trigger (UPDATE sin cambios
-- reales) sobre cualquier fila de itinerario_vuelos_editable que hoy no
-- tenga ningún aodb_legacy_id apuntándole en maestra_operaciones. Nota: un
-- diagnóstico inicial marcó 4 filas como "huérfanas" usando un filtro
-- equivocado (fuente_principal = 'ITINERARIO_VUELOS_EDITABLE'); en realidad
-- esas 4 SÍ estaban sincronizadas — solo que su fila en maestra_operaciones
-- nació primero desde otra fuente (ej. Conciliación), así que su
-- fuente_principal quedó con ese otro valor aunque itinerario también le
-- aportó datos (visible en su columna origenes). Corregido: el criterio
-- correcto es solo aodb_legacy_id, sin filtrar por fuente_principal.
--
-- PASO B: la vista de compatibilidad en sí, de solo lectura. Mismo ajuste:
-- ya no filtra por fuente_principal, solo por aodb_legacy_id IS NOT NULL.
--
-- No se toca ningún WRITE path de la app — los 4 puntos de lectura que
-- migran a esta vista son: js/parte-ops-flights.js (_buildFlightProbeCache,
-- loadFlights), js/ops-flights-admin.js (loadData), js/estadistico-
-- aerolineas.js (loadEditableItinerary).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO A: backfill de filas huérfanas (re-dispara el trigger, no cambia datos)
-- -----------------------------------------------------------------------------
UPDATE public.itinerario_vuelos_editable t
SET id = t.id
WHERE NOT EXISTS (
    SELECT 1 FROM public.maestra_operaciones m
    WHERE m.aodb_legacy_id = t.id
);

-- Verificación: debe dar 0 huérfanos después del backfill.
SELECT count(*) AS huerfanos_restantes
FROM public.itinerario_vuelos_editable t
WHERE NOT EXISTS (
    SELECT 1 FROM public.maestra_operaciones m
    WHERE m.aodb_legacy_id = t.id
);

-- -----------------------------------------------------------------------------
-- PASO B: vista de compatibilidad, de solo lectura
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_itinerario_vuelos_editable_compat AS
WITH ranked AS (
    SELECT
        m.aodb_legacy_id,
        m.datos_origen -> 'itinerario_vuelos_editable' AS j,
        row_number() OVER (
            PARTITION BY m.aodb_legacy_id
            ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
        ) AS rn
    FROM public.maestra_operaciones m
    WHERE m.aodb_legacy_id IS NOT NULL
      AND m.datos_origen ? 'itinerario_vuelos_editable'
)
SELECT
    aodb_legacy_id AS id,
    j->>'Status' AS "Status",
    j->>'[Arr] Airline code' AS "[Arr] Airline code",
    j->>'[Arr] Flight Designator' AS "[Arr] Flight Designator",
    j->>'[Arr] ALDT' AS "[Arr] ALDT",
    j->>'[Arr] SIBT' AS "[Arr] SIBT",
    j->>'[Arr] AIBT' AS "[Arr] AIBT",
    j->>'[Arr] Stand' AS "[Arr] Stand",
    j->>'[Arr] Gates' AS "[Arr] Gates",
    j->>'[Arr] Boarded' AS "[Arr] Boarded",
    j->>'[Arr] Baggage Belts' AS "[Arr] Baggage Belts",
    j->>'[Arr] Service Type' AS "[Arr] Service Type",
    j->>'Routing' AS "Routing",
    j->>'Aircraft type' AS "Aircraft type",
    j->>'Registration' AS "Registration",
    j->>'[Dep] Airline code' AS "[Dep] Airline code",
    j->>'[Dep] Flight Designator' AS "[Dep] Flight Designator",
    j->>'[Dep] Stand' AS "[Dep] Stand",
    j->>'[Dep] Gates' AS "[Dep] Gates",
    j->>'[Dep] Boarded' AS "[Dep] Boarded",
    j->>'[Dep] SOBT' AS "[Dep] SOBT",
    j->>'[Dep] AOBT' AS "[Dep] AOBT",
    j->>'[Dep] ATOT' AS "[Dep] ATOT",
    j->>'[Dep] ATTT' AS "[Dep] ATTT",
    j->>'[Dep] Service Type' AS "[Dep] Service Type",
    NULLIF(j->>'arr_scheduled_date','')::date AS arr_scheduled_date,
    NULLIF(j->>'dep_scheduled_date','')::date AS dep_scheduled_date,
    NULLIF(j->>'import_reference_date','')::date AS import_reference_date,
    j->>'arr_movement_key' AS arr_movement_key,
    j->>'dep_movement_key' AS dep_movement_key,
    j->>'arr_movement_slot' AS arr_movement_slot,
    j->>'dep_movement_slot' AS dep_movement_slot,
    j->>'observaciones' AS observaciones,
    NULLIF(j->>'validado','')::boolean AS validado,
    j->>'validado_por' AS validado_por,
    NULLIF(j->>'validado_at','')::timestamptz AS validado_at
FROM ranked
WHERE rn = 1
ORDER BY id;

-- GRANT es evaluado antes que RLS (mismo patrón que 024): sin esto, el rol
-- authenticated no puede leer la vista aunque maestra_operaciones ya tenga
-- su política de SELECT.
GRANT SELECT ON public.vw_itinerario_vuelos_editable_compat TO authenticated;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN — todo junto en UN SOLO resultado (el SQL Editor de Supabase
-- solo muestra el resultado del último SELECT que corre).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _aifa_verificacion_026 (prueba text, detalle text) ON COMMIT DROP;

INSERT INTO _aifa_verificacion_026
SELECT '1) Huérfanos restantes', count(*)::text || ' (esperado: 0)'
FROM public.itinerario_vuelos_editable t
WHERE NOT EXISTS (
    SELECT 1 FROM public.maestra_operaciones m
    WHERE m.aodb_legacy_id = t.id
);

INSERT INTO _aifa_verificacion_026
SELECT '2) Filas en vista vs tabla legacy',
       (SELECT count(*) FROM public.vw_itinerario_vuelos_editable_compat)::text
       || ' vs ' ||
       (SELECT count(*) FROM public.itinerario_vuelos_editable)::text
       || ' (esperado: iguales)';

INSERT INTO _aifa_verificacion_026
SELECT '3) Comparación de 20 filas recientes',
       'ok=' || count(*) FILTER (WHERE status_ok AND arr_sibt_ok AND dep_sobt_ok AND arr_date_ok AND dep_date_ok AND validado_ok AND obs_ok)::text
       || ' de ' || count(*)::text || ' (esperado: iguales)'
FROM (
    SELECT
        t."Status" IS NOT DISTINCT FROM v."Status" AS status_ok,
        t."[Arr] SIBT" IS NOT DISTINCT FROM v."[Arr] SIBT" AS arr_sibt_ok,
        t."[Dep] SOBT" IS NOT DISTINCT FROM v."[Dep] SOBT" AS dep_sobt_ok,
        t.arr_scheduled_date IS NOT DISTINCT FROM v.arr_scheduled_date AS arr_date_ok,
        t.dep_scheduled_date IS NOT DISTINCT FROM v.dep_scheduled_date AS dep_date_ok,
        t.validado IS NOT DISTINCT FROM v.validado AS validado_ok,
        t.observaciones IS NOT DISTINCT FROM v.observaciones AS obs_ok
    FROM public.itinerario_vuelos_editable t
    JOIN public.vw_itinerario_vuelos_editable_compat v ON v.id = t.id
    ORDER BY t.id DESC
    LIMIT 20
) c;

INSERT INTO _aifa_verificacion_026
SELECT '4) Antes huérfana id=' || id, '[Arr] Flight Designator=' || coalesce("[Arr] Flight Designator", '<NULL>')
       || ', [Arr] SIBT=' || coalesce("[Arr] SIBT", '<NULL>')
       || ', validado=' || coalesce(validado::text, '<NULL>')
FROM public.vw_itinerario_vuelos_editable_compat
WHERE id IN (11197, 11483, 11514, 11617);

SELECT * FROM _aifa_verificacion_026 ORDER BY prueba;

-- -----------------------------------------------------------------------------
-- Por defecto esta corrida es SOLO PRUEBA: no persiste nada (ni el backfill
-- del Paso A ni la vista del Paso B). Cuando los resultados de arriba se vean
-- bien, cambiar la siguiente línea de ROLLBACK a COMMIT y volver a correr el
-- archivo completo.
-- -----------------------------------------------------------------------------
ROLLBACK;
