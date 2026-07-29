-- =============================================================================
-- Unicidad de movimientos AODB y manifiestos
--
-- Identidad de negocio:
--   carrier + flight number + scheduled date + movement (A/D) + route endpoint
--
-- El modelo de turnaround se conserva: llegada y salida siguen compartiendo id,
-- pero cada movimiento obtiene su propia llave y su propia restricción UNIQUE.
-- La migración es idempotente y crea respaldos antes de retirar duplicados.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._aifa_normalize_identity_part(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT NULLIF(regexp_replace(upper(trim(coalesce(p_value, ''))), '[^A-Z0-9]+', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public._aifa_flight_number(p_designator text, p_carrier text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_designator text := public._aifa_normalize_identity_part(p_designator);
    v_carrier text := public._aifa_normalize_identity_part(p_carrier);
    v_number text;
BEGIN
    IF v_designator IS NULL THEN RETURN NULL; END IF;
    IF v_carrier IS NOT NULL AND left(v_designator, length(v_carrier)) = v_carrier THEN
        v_designator := substr(v_designator, length(v_carrier) + 1);
    END IF;
    v_number := substring(v_designator FROM '([0-9]+[A-Z]?)$');
    RETURN coalesce(NULLIF(v_number, ''), NULLIF(v_designator, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public._aifa_route_endpoint(p_routing text, p_direction text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_tokens text[];
    v_len integer;
    v_local integer := 0;
    v_index integer;
    v_direction text := upper(trim(coalesce(p_direction, '')));
BEGIN
    IF NULLIF(trim(coalesce(p_routing, '')), '') IS NULL THEN RETURN NULL; END IF;
    v_tokens := regexp_split_to_array(
        regexp_replace(upper(trim(p_routing)), '(^[^A-Z0-9]+|[^A-Z0-9]+$)', '', 'g'),
        '[^A-Z0-9]+'
    );
    v_len := coalesce(array_length(v_tokens, 1), 0);
    IF v_len = 0 THEN RETURN NULL; END IF;

    IF v_direction = 'A' THEN
        FOR v_index IN 1..v_len LOOP
            IF v_tokens[v_index] IN ('NLU', 'MMSM') THEN v_local := v_index; EXIT; END IF;
        END LOOP;
        IF v_local > 1 THEN RETURN public._aifa_normalize_identity_part(v_tokens[v_local - 1]); END IF;
        RETURN public._aifa_normalize_identity_part(v_tokens[1]);
    END IF;

    FOR v_index IN 1..v_len LOOP
        IF v_tokens[v_index] IN ('NLU', 'MMSM') THEN v_local := v_index; END IF;
    END LOOP;
    IF v_local > 0 AND v_local < v_len THEN
        RETURN public._aifa_normalize_identity_part(v_tokens[v_local + 1]);
    END IF;
    RETURN public._aifa_normalize_identity_part(v_tokens[v_len]);
END;
$$;

CREATE OR REPLACE FUNCTION public._aifa_date_near_reference(p_value text, p_reference date)
RETURNS date
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_match text[];
    v_day integer;
    v_month integer;
    v_reference date := coalesce(p_reference, current_date);
    v_year integer;
    v_candidate date;
    v_best date;
    v_distance integer;
    v_best_distance integer;
BEGIN
    v_match := regexp_match(upper(trim(coalesce(p_value, ''))), '([0-9]{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)');
    IF v_match IS NULL THEN RETURN NULL; END IF;
    v_day := v_match[1]::integer;
    v_month := CASE v_match[2]
        WHEN 'JAN' THEN 1 WHEN 'FEB' THEN 2 WHEN 'MAR' THEN 3 WHEN 'APR' THEN 4
        WHEN 'MAY' THEN 5 WHEN 'JUN' THEN 6 WHEN 'JUL' THEN 7 WHEN 'AUG' THEN 8
        WHEN 'SEP' THEN 9 WHEN 'OCT' THEN 10 WHEN 'NOV' THEN 11 WHEN 'DEC' THEN 12
    END;
    FOR v_year IN (extract(year FROM v_reference)::integer - 1)..(extract(year FROM v_reference)::integer + 1) LOOP
        BEGIN
            v_candidate := make_date(v_year, v_month, v_day);
            v_distance := abs(v_candidate - v_reference);
            IF v_best IS NULL OR v_distance < v_best_distance THEN
                v_best := v_candidate;
                v_best_distance := v_distance;
            END IF;
        EXCEPTION WHEN datetime_field_overflow THEN
            CONTINUE;
        END;
    END LOOP;
    RETURN v_best;
END;
$$;

CREATE OR REPLACE FUNCTION public._aifa_parse_manifest_date(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
    v_match text[];
    v_year integer;
BEGIN
    v_match := regexp_match(trim(coalesce(p_value, '')), '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{2,4})');
    IF v_match IS NOT NULL THEN
        v_year := v_match[3]::integer;
        IF v_year < 100 THEN v_year := 2000 + v_year; END IF;
        RETURN make_date(v_year, v_match[2]::integer, v_match[1]::integer);
    END IF;
    v_match := regexp_match(trim(coalesce(p_value, '')), '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})');
    IF v_match IS NOT NULL THEN
        RETURN make_date(v_match[1]::integer, v_match[2]::integer, v_match[3]::integer);
    END IF;
    RETURN NULL;
EXCEPTION WHEN datetime_field_overflow OR invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._aifa_manifest_direction(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN upper(coalesce(p_value, '')) ~ '(LLEG|ARRIV|ARRIVAL)' THEN 'A'
        WHEN upper(coalesce(p_value, '')) ~ '(SAL|DEP|DEPARTURE)' THEN 'D'
        ELSE NULL
    END
$$;

CREATE OR REPLACE FUNCTION public._aifa_movement_key(
    p_carrier text,
    p_designator text,
    p_scheduled_date date,
    p_direction text,
    p_routing text
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
    v_endpoint text := public._aifa_route_endpoint(p_routing, p_direction);
BEGIN
    IF v_carrier IS NULL OR v_number IS NULL OR p_scheduled_date IS NULL
       OR v_direction NOT IN ('A', 'D') OR v_endpoint IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN concat_ws('|', v_carrier, v_number, p_scheduled_date::text, v_direction, v_endpoint);
END;
$$;

COMMIT;

BEGIN;

ALTER TABLE public.vuelos_parte_operaciones_csv
    ADD COLUMN IF NOT EXISTS import_reference_date date,
    ADD COLUMN IF NOT EXISTS arr_scheduled_date date,
    ADD COLUMN IF NOT EXISTS dep_scheduled_date date,
    ADD COLUMN IF NOT EXISTS arr_movement_key text,
    ADD COLUMN IF NOT EXISTS dep_movement_key text;

ALTER TABLE public.itinerario_vuelos_editable
    ADD COLUMN IF NOT EXISTS import_reference_date date,
    ADD COLUMN IF NOT EXISTS arr_scheduled_date date,
    ADD COLUMN IF NOT EXISTS dep_scheduled_date date,
    ADD COLUMN IF NOT EXISTS arr_movement_key text,
    ADD COLUMN IF NOT EXISTS dep_movement_key text;

ALTER TABLE public.manifiestos_vuelos_editable
    ADD COLUMN IF NOT EXISTS import_reference_date date,
    ADD COLUMN IF NOT EXISTS arr_scheduled_date date,
    ADD COLUMN IF NOT EXISTS dep_scheduled_date date,
    ADD COLUMN IF NOT EXISTS arr_movement_key text,
    ADD COLUMN IF NOT EXISTS dep_movement_key text;

ALTER TABLE public."Conciliación Manifiestos"
    ADD COLUMN IF NOT EXISTS movement_key text;

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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aifa_identity_vpo ON public.vuelos_parte_operaciones_csv;
CREATE TRIGGER trg_aifa_identity_vpo
    BEFORE INSERT OR UPDATE ON public.vuelos_parte_operaciones_csv
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_aodb_movement_identity();

DROP TRIGGER IF EXISTS trg_aifa_identity_itinerario ON public.itinerario_vuelos_editable;
CREATE TRIGGER trg_aifa_identity_itinerario
    BEFORE INSERT OR UPDATE ON public.itinerario_vuelos_editable
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_aodb_movement_identity();

DROP TRIGGER IF EXISTS trg_aifa_identity_manifiestos_vuelos ON public.manifiestos_vuelos_editable;
CREATE TRIGGER trg_aifa_identity_manifiestos_vuelos
    BEFORE INSERT OR UPDATE ON public.manifiestos_vuelos_editable
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_aodb_movement_identity();

CREATE OR REPLACE FUNCTION public._aifa_sync_manifest_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_date date;
    v_direction text;
BEGIN
    v_date := coalesce(public._aifa_parse_manifest_date(NEW."FECHA"), NEW._portal_flight_date);
    IF v_date IS NOT NULL THEN NEW._portal_flight_date := v_date; END IF;
    v_direction := public._aifa_manifest_direction(NEW."TIPO DE MANIFIESTO");
    NEW.movement_key := public._aifa_movement_key(
        NEW."AEROLINEA", NEW."# DE VUELO", v_date,
        v_direction, NEW."DESTINO / ORIGEN"
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aifa_identity_conciliacion_manifiestos ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_aifa_identity_conciliacion_manifiestos
    BEFORE INSERT OR UPDATE ON public."Conciliación Manifiestos"
    FOR EACH ROW EXECUTE FUNCTION public._aifa_sync_manifest_identity();

-- Backfill: dispara los triggers y calcula fechas/llaves para datos existentes.
UPDATE public.vuelos_parte_operaciones_csv
SET import_reference_date = coalesce(import_reference_date, current_date);

UPDATE public.itinerario_vuelos_editable
SET import_reference_date = coalesce(import_reference_date, creado_en::date, current_date);

UPDATE public.manifiestos_vuelos_editable
SET import_reference_date = coalesce(import_reference_date, creado_en::date, current_date);

ALTER TABLE public.vuelos_parte_operaciones_csv
    ALTER COLUMN import_reference_date SET DEFAULT current_date;
ALTER TABLE public.itinerario_vuelos_editable
    ALTER COLUMN import_reference_date SET DEFAULT current_date;
ALTER TABLE public.manifiestos_vuelos_editable
    ALTER COLUMN import_reference_date SET DEFAULT current_date;

UPDATE public."Conciliación Manifiestos"
SET _portal_flight_date = coalesce(_portal_flight_date, public._aifa_parse_manifest_date("FECHA"));

COMMIT;

BEGIN;

-- Respaldos recuperables antes de retirar duplicados existentes.
CREATE TABLE IF NOT EXISTS public.vpo_duplicates_backup_20260729 AS
    SELECT source.*, now()::timestamptz AS backed_up_at
    FROM public.vuelos_parte_operaciones_csv source WHERE false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vpo_duplicates_backup_20260729_id
    ON public.vpo_duplicates_backup_20260729 (id);

CREATE TABLE IF NOT EXISTS public.itinerario_duplicates_backup_20260729 AS
    SELECT source.*, now()::timestamptz AS backed_up_at
    FROM public.itinerario_vuelos_editable source WHERE false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_itinerario_duplicates_backup_20260729_id
    ON public.itinerario_duplicates_backup_20260729 (id);

CREATE TABLE IF NOT EXISTS public.manifiestos_vuelos_duplicates_backup_20260729 AS
    SELECT source.*, now()::timestamptz AS backed_up_at
    FROM public.manifiestos_vuelos_editable source WHERE false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manifiestos_vuelos_duplicates_backup_20260729_id
    ON public.manifiestos_vuelos_duplicates_backup_20260729 (id);

CREATE TABLE IF NOT EXISTS public.conciliacion_manifiestos_duplicates_backup_20260729 AS
    SELECT source.*, now()::timestamptz AS backed_up_at
    FROM public."Conciliación Manifiestos" source WHERE false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conciliacion_manifiestos_duplicates_backup_20260729_id
    ON public.conciliacion_manifiestos_duplicates_backup_20260729 (id);

ALTER TABLE public.vpo_duplicates_backup_20260729 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerario_duplicates_backup_20260729 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifiestos_vuelos_duplicates_backup_20260729 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacion_manifiestos_duplicates_backup_20260729 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vpo_duplicates_backup_20260729 FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.itinerario_duplicates_backup_20260729 FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.manifiestos_vuelos_duplicates_backup_20260729 FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.conciliacion_manifiestos_duplicates_backup_20260729 FROM anon, authenticated, PUBLIC;

WITH duplicate_ids AS (
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY arr_movement_key ORDER BY id DESC) rn
        FROM public.vuelos_parte_operaciones_csv WHERE arr_movement_key IS NOT NULL
    ) ranked WHERE rn > 1
    UNION
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY dep_movement_key ORDER BY id DESC) rn
        FROM public.vuelos_parte_operaciones_csv WHERE dep_movement_key IS NOT NULL
    ) ranked WHERE rn > 1
)
INSERT INTO public.vpo_duplicates_backup_20260729
SELECT source.*, now() FROM public.vuelos_parte_operaciones_csv source JOIN duplicate_ids USING (id)
ON CONFLICT (id) DO NOTHING;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY arr_movement_key ORDER BY id DESC) rn
    FROM public.vuelos_parte_operaciones_csv WHERE arr_movement_key IS NOT NULL
)
DELETE FROM public.vuelos_parte_operaciones_csv source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY dep_movement_key ORDER BY id DESC) rn
    FROM public.vuelos_parte_operaciones_csv WHERE dep_movement_key IS NOT NULL
)
DELETE FROM public.vuelos_parte_operaciones_csv source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

WITH duplicate_ids AS (
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY arr_movement_key ORDER BY id DESC) rn
        FROM public.itinerario_vuelos_editable WHERE arr_movement_key IS NOT NULL
    ) ranked WHERE rn > 1
    UNION
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY dep_movement_key ORDER BY id DESC) rn
        FROM public.itinerario_vuelos_editable WHERE dep_movement_key IS NOT NULL
    ) ranked WHERE rn > 1
)
INSERT INTO public.itinerario_duplicates_backup_20260729
SELECT source.*, now() FROM public.itinerario_vuelos_editable source JOIN duplicate_ids USING (id)
ON CONFLICT (id) DO NOTHING;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY arr_movement_key ORDER BY id DESC) rn
    FROM public.itinerario_vuelos_editable WHERE arr_movement_key IS NOT NULL
)
DELETE FROM public.itinerario_vuelos_editable source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY dep_movement_key ORDER BY id DESC) rn
    FROM public.itinerario_vuelos_editable WHERE dep_movement_key IS NOT NULL
)
DELETE FROM public.itinerario_vuelos_editable source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

COMMIT;

BEGIN;

CREATE TEMP TABLE _aifa_override_restore_final ON COMMIT DROP AS
SELECT o.*, CASE
    WHEN o.direccion = 'LLEGADA' THEN v.arr_movement_key
    WHEN o.direccion = 'SALIDA' THEN v.dep_movement_key
    ELSE NULL
END AS movement_key
FROM public.conciliacion_vuelo_overrides o
LEFT JOIN public.manifiestos_vuelos_editable v ON v.id = o.vuelo_id;

WITH duplicate_ids AS (
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY arr_movement_key ORDER BY id DESC) rn
        FROM public.manifiestos_vuelos_editable WHERE arr_movement_key IS NOT NULL
    ) ranked WHERE rn > 1
    UNION
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY dep_movement_key ORDER BY id DESC) rn
        FROM public.manifiestos_vuelos_editable WHERE dep_movement_key IS NOT NULL
    ) ranked WHERE rn > 1
)
INSERT INTO public.manifiestos_vuelos_duplicates_backup_20260729
SELECT source.*, now() FROM public.manifiestos_vuelos_editable source JOIN duplicate_ids USING (id)
ON CONFLICT (id) DO NOTHING;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY arr_movement_key ORDER BY id DESC) rn
    FROM public.manifiestos_vuelos_editable WHERE arr_movement_key IS NOT NULL
)
DELETE FROM public.manifiestos_vuelos_editable source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY dep_movement_key ORDER BY id DESC) rn
    FROM public.manifiestos_vuelos_editable WHERE dep_movement_key IS NOT NULL
)
DELETE FROM public.manifiestos_vuelos_editable source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

WITH restore_candidates AS (
    SELECT
        target.id AS vuelo_id,
        saved.direccion,
        saved.aerolinea,
        saved.updated_at,
        saved.updated_by,
        row_number() OVER (
            PARTITION BY target.id, saved.direccion
            ORDER BY saved.updated_at DESC NULLS LAST, saved.id DESC
        ) AS rn
    FROM _aifa_override_restore_final saved
    JOIN public.manifiestos_vuelos_editable target
      ON (saved.direccion = 'LLEGADA' AND target.arr_movement_key = saved.movement_key)
      OR (saved.direccion = 'SALIDA' AND target.dep_movement_key = saved.movement_key)
    WHERE saved.movement_key IS NOT NULL
)
INSERT INTO public.conciliacion_vuelo_overrides
    (vuelo_id, direccion, aerolinea, updated_at, updated_by)
SELECT vuelo_id, direccion, aerolinea, updated_at, updated_by
FROM restore_candidates
WHERE rn = 1
ON CONFLICT (vuelo_id, direccion) DO UPDATE SET
    aerolinea = coalesce(EXCLUDED.aerolinea, conciliacion_vuelo_overrides.aerolinea),
    updated_at = greatest(EXCLUDED.updated_at, conciliacion_vuelo_overrides.updated_at),
    updated_by = coalesce(EXCLUDED.updated_by, conciliacion_vuelo_overrides.updated_by);

DELETE FROM public.conciliacion_vuelo_overrides current_override
WHERE NOT EXISTS (
    SELECT 1 FROM public.manifiestos_vuelos_editable current_flight
    WHERE current_flight.id = current_override.vuelo_id
)
AND EXISTS (
    SELECT 1 FROM _aifa_override_restore_final saved
    WHERE saved.vuelo_id = current_override.vuelo_id
      AND saved.direccion = current_override.direccion
      AND saved.movement_key IS NOT NULL
);

WITH duplicate_ids AS (
    SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY movement_key ORDER BY id DESC) rn
        FROM public."Conciliación Manifiestos" WHERE movement_key IS NOT NULL
    ) ranked WHERE rn > 1
)
INSERT INTO public.conciliacion_manifiestos_duplicates_backup_20260729
SELECT source.*, now() FROM public."Conciliación Manifiestos" source JOIN duplicate_ids USING (id)
ON CONFLICT (id) DO NOTHING;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY movement_key ORDER BY id DESC) rn
    FROM public."Conciliación Manifiestos" WHERE movement_key IS NOT NULL
)
DELETE FROM public."Conciliación Manifiestos" source USING ranked
WHERE source.id = ranked.id AND ranked.rn > 1;

-- El id SMALLINT se agotaría en 32,767 filas; se amplía junto con su secuencia.
ALTER TABLE public."Conciliación Manifiestos" ALTER COLUMN id TYPE bigint;
ALTER TABLE public.conciliacion_manifiestos_duplicates_backup_20260729 ALTER COLUMN id TYPE bigint;
DO $$
DECLARE
    v_sequence text;
    v_max_id bigint;
BEGIN
    v_sequence := pg_get_serial_sequence('public."Conciliación Manifiestos"', 'id');
    IF v_sequence IS NOT NULL THEN
        EXECUTE format('ALTER SEQUENCE %s AS bigint', v_sequence);
        SELECT coalesce(max(id), 0) INTO v_max_id FROM public."Conciliación Manifiestos";
        IF v_max_id > 0 THEN PERFORM setval(v_sequence::regclass, v_max_id, true); END IF;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vpo_arr_movement_key
    ON public.vuelos_parte_operaciones_csv (arr_movement_key) WHERE arr_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vpo_dep_movement_key
    ON public.vuelos_parte_operaciones_csv (dep_movement_key) WHERE dep_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_itinerario_arr_movement_key
    ON public.itinerario_vuelos_editable (arr_movement_key) WHERE arr_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_itinerario_dep_movement_key
    ON public.itinerario_vuelos_editable (dep_movement_key) WHERE dep_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manifiestos_vuelos_arr_movement_key
    ON public.manifiestos_vuelos_editable (arr_movement_key) WHERE arr_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manifiestos_vuelos_dep_movement_key
    ON public.manifiestos_vuelos_editable (dep_movement_key) WHERE dep_movement_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conciliacion_manifiestos_movement_key
    ON public."Conciliación Manifiestos" (movement_key) WHERE movement_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpo_arr_scheduled_date
    ON public.vuelos_parte_operaciones_csv (arr_scheduled_date);
CREATE INDEX IF NOT EXISTS idx_vpo_dep_scheduled_date
    ON public.vuelos_parte_operaciones_csv (dep_scheduled_date);
CREATE INDEX IF NOT EXISTS idx_itinerario_arr_scheduled_date
    ON public.itinerario_vuelos_editable (arr_scheduled_date);
CREATE INDEX IF NOT EXISTS idx_itinerario_dep_scheduled_date
    ON public.itinerario_vuelos_editable (dep_scheduled_date);
CREATE INDEX IF NOT EXISTS idx_manifiestos_vuelos_arr_scheduled_date
    ON public.manifiestos_vuelos_editable (arr_scheduled_date);
CREATE INDEX IF NOT EXISTS idx_manifiestos_vuelos_dep_scheduled_date
    ON public.manifiestos_vuelos_editable (dep_scheduled_date);

COMMIT;

-- Verificación posterior sugerida:
-- SELECT arr_movement_key, count(*) FROM public.manifiestos_vuelos_editable
-- WHERE arr_movement_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- SELECT dep_movement_key, count(*) FROM public.manifiestos_vuelos_editable
-- WHERE dep_movement_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- SELECT movement_key, count(*) FROM public."Conciliación Manifiestos"
-- WHERE movement_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
