-- =============================================================================
-- Segunda rotación del mismo vuelo en el mismo día
--
-- La identidad de 010 (carrier + flight number + scheduled date + A/D + estación)
-- no distingue dos operaciones reales del MISMO número de vuelo, la MISMA ruta y
-- el MISMO día. El AODB sí las exporta así:
--
--   XN 1107  MTY-NLU-MTY  SIBT 10AUG 01:55  (rota a XN 1100)
--   XN 1107  MTY-NLU-BJX  SIBT 10AUG 23:05  (rota a XN 1420)
--
-- Ambas son vuelos distintos, ambas están activas, y con la llave de 010 chocaban
-- entre sí: el índice UNIQUE rechazaba la segunda y la importación abortaba.
--
-- Se agrega la hora programada (HH:MM de SIBT/SOBT) como parte de la restricción
-- de unicidad, SIN tocar *_movement_key. Eso importa: Conciliación Manifiestos
-- cruza manifiestos contra vuelos por movement_key y los manifiestos solo traen
-- fecha, no hora. La llave sigue siendo la misma; lo único que cambia es que la
-- unicidad ahora es (llave, hora programada) en vez de (llave).
--
-- La restricción nueva es MÁS DÉBIL que la de 010, así que ninguna fila existente
-- puede violarla y no hace falta depurar duplicados. Es idempotente.
-- =============================================================================

BEGIN;

-- '10AUG 23:05' -> '23:05'.  Sin hora reconocible devuelve '' (nunca NULL, para
-- que el índice UNIQUE sí compare esas filas entre sí en vez de tratarlas como
-- distintas, que es como Postgres trata los NULL).
CREATE OR REPLACE FUNCTION public._aifa_movement_slot(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_match text[];
BEGIN
    v_match := regexp_match(coalesce(p_value, ''), '([0-9]{1,2}):([0-9]{2})');
    IF v_match IS NULL THEN RETURN ''; END IF;
    RETURN lpad(v_match[1], 2, '0') || ':' || v_match[2];
END;
$$;

ALTER TABLE public.vuelos_parte_operaciones_csv
    ADD COLUMN IF NOT EXISTS arr_movement_slot text,
    ADD COLUMN IF NOT EXISTS dep_movement_slot text;

ALTER TABLE public.itinerario_vuelos_editable
    ADD COLUMN IF NOT EXISTS arr_movement_slot text,
    ADD COLUMN IF NOT EXISTS dep_movement_slot text;

ALTER TABLE public.manifiestos_vuelos_editable
    ADD COLUMN IF NOT EXISTS arr_movement_slot text,
    ADD COLUMN IF NOT EXISTS dep_movement_slot text;

-- Misma función de 010 más el cálculo de la hora programada.
CREATE OR REPLACE FUNCTION public._aifa_sync_aodb_movement_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.import_reference_date := coalesce(NEW.import_reference_date, current_date);
    NEW.arr_scheduled_date := CASE
        WHEN NULLIF(trim(coalesce(NEW."[Arr] SIBT", '')), '') IS NULL THEN NULL
        ELSE public._aifa_date_near_reference(NEW."[Arr] SIBT", NEW.import_reference_date)
    END;
    NEW.dep_scheduled_date := CASE
        WHEN NULLIF(trim(coalesce(NEW."[Dep] SOBT", '')), '') IS NULL THEN NULL
        ELSE public._aifa_date_near_reference(NEW."[Dep] SOBT", NEW.import_reference_date)
    END;
    NEW.arr_movement_key := public._aifa_movement_key(
        NEW."[Arr] Airline code", NEW."[Arr] Flight Designator",
        NEW.arr_scheduled_date, 'A', NEW."Routing"
    );
    NEW.dep_movement_key := public._aifa_movement_key(
        NEW."[Dep] Airline code", NEW."[Dep] Flight Designator",
        NEW.dep_scheduled_date, 'D', NEW."Routing"
    );
    NEW.arr_movement_slot := public._aifa_movement_slot(NEW."[Arr] SIBT");
    NEW.dep_movement_slot := public._aifa_movement_slot(NEW."[Dep] SOBT");
    RETURN NEW;
END;
$$;

COMMIT;

BEGIN;

-- Backfill: dispara el trigger para calcular la hora de lo ya guardado.
UPDATE public.vuelos_parte_operaciones_csv
SET import_reference_date = import_reference_date
WHERE arr_movement_slot IS NULL OR dep_movement_slot IS NULL;

UPDATE public.itinerario_vuelos_editable
SET import_reference_date = import_reference_date
WHERE arr_movement_slot IS NULL OR dep_movement_slot IS NULL;

UPDATE public.manifiestos_vuelos_editable
SET import_reference_date = import_reference_date
WHERE arr_movement_slot IS NULL OR dep_movement_slot IS NULL;

COMMIT;

BEGIN;

-- Unicidad por movimiento + hora programada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vpo_arr_movement_identity
    ON public.vuelos_parte_operaciones_csv (arr_movement_key, coalesce(arr_movement_slot, ''))
    WHERE arr_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vpo_dep_movement_identity
    ON public.vuelos_parte_operaciones_csv (dep_movement_key, coalesce(dep_movement_slot, ''))
    WHERE dep_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_itinerario_arr_movement_identity
    ON public.itinerario_vuelos_editable (arr_movement_key, coalesce(arr_movement_slot, ''))
    WHERE arr_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_itinerario_dep_movement_identity
    ON public.itinerario_vuelos_editable (dep_movement_key, coalesce(dep_movement_slot, ''))
    WHERE dep_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manifiestos_vuelos_arr_movement_identity
    ON public.manifiestos_vuelos_editable (arr_movement_key, coalesce(arr_movement_slot, ''))
    WHERE arr_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manifiestos_vuelos_dep_movement_identity
    ON public.manifiestos_vuelos_editable (dep_movement_key, coalesce(dep_movement_slot, ''))
    WHERE dep_movement_key IS NOT NULL;

-- Los índices de 010 (solo por llave) ya no aplican: son los que rechazaban la
-- segunda rotación del día. Se retiran DESPUÉS de crear los nuevos para que la
-- tabla nunca quede un instante sin protección contra duplicados.
DROP INDEX IF EXISTS public.uq_vpo_arr_movement_key;
DROP INDEX IF EXISTS public.uq_vpo_dep_movement_key;
DROP INDEX IF EXISTS public.uq_itinerario_arr_movement_key;
DROP INDEX IF EXISTS public.uq_itinerario_dep_movement_key;
DROP INDEX IF EXISTS public.uq_manifiestos_vuelos_arr_movement_key;
DROP INDEX IF EXISTS public.uq_manifiestos_vuelos_dep_movement_key;

CREATE INDEX IF NOT EXISTS idx_vpo_arr_movement_key
    ON public.vuelos_parte_operaciones_csv (arr_movement_key);
CREATE INDEX IF NOT EXISTS idx_vpo_dep_movement_key
    ON public.vuelos_parte_operaciones_csv (dep_movement_key);
CREATE INDEX IF NOT EXISTS idx_itinerario_arr_movement_key
    ON public.itinerario_vuelos_editable (arr_movement_key);
CREATE INDEX IF NOT EXISTS idx_itinerario_dep_movement_key
    ON public.itinerario_vuelos_editable (dep_movement_key);
CREATE INDEX IF NOT EXISTS idx_manifiestos_vuelos_arr_movement_key
    ON public.manifiestos_vuelos_editable (arr_movement_key);
CREATE INDEX IF NOT EXISTS idx_manifiestos_vuelos_dep_movement_key
    ON public.manifiestos_vuelos_editable (dep_movement_key);

COMMIT;

-- Verificación posterior sugerida:
-- SELECT arr_movement_key, arr_movement_slot, count(*)
-- FROM public.itinerario_vuelos_editable
-- WHERE arr_movement_key IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Las dos rotaciones de XN 1107 del 10AUG ahora conviven:
-- SELECT id, "[Arr] Flight Designator", "[Arr] SIBT", "Routing", arr_movement_slot
-- FROM public.itinerario_vuelos_editable WHERE arr_movement_key = 'XN|1107|2026-08-10|A|MTY';
