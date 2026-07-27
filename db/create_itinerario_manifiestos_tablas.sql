-- ============================================================================
-- Tablas editables independientes: Itinerario de Vuelos y Manifiestos
-- Ejecutar en: Supabase → SQL Editor. Es IDEMPOTENTE (se puede re-ejecutar).
-- ----------------------------------------------------------------------------
-- Hasta ahora, Itinerario de Vuelos y Conciliación Manifiestos leían la MISMA
-- tabla de vuelos importados (vuelos_parte_operaciones_csv), que solo permitía
-- editar dos columnas angostas (observaciones, validado) — todo lo demás era
-- de solo lectura para no arriesgar la otra pestaña.
--
-- Estas dos tablas nuevas son copias independientes y totalmente editables:
--   · itinerario_vuelos_editable   → respalda la pestaña Itinerario de Vuelos
--                                     y el panel admin "Itinerario del Día".
--   · manifiestos_vuelos_editable  → respalda el lado "vuelos" del cruce en
--                                     Conciliación Manifiestos.
--
-- vuelos_parte_operaciones_csv NO se modifica: sigue siendo la bitácora cruda
-- de cada importación (CSV/JSON/PDF), exactamente como hoy.
--
-- id se preserva IDÉNTICO al de la fila de origen en vuelos_parte_operaciones_
-- csv (no es autogenerado) porque conciliacion_vuelo_overrides ya guarda
-- ajustes de aerolínea usando ese id como referencia; si cambiara, esos
-- ajustes quedarían huérfanos silenciosamente.
--
-- ⚠ IMPORTANTE: este script solo crea las tablas y deja preparado que las
-- IMPORTACIONES FUTURAS las llenen. Los vuelos que ya existían en
-- vuelos_parte_operaciones_csv antes de correr esto NO se copian solos —
-- ejecutar además db/backfill_itinerario_manifiestos_tablas.sql (una sola
-- vez, justo después de este) o Itinerario de Vuelos y Manifiestos
-- aparecerán vacíos aunque la tabla cruda tenga datos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.itinerario_vuelos_editable (
    id                        BIGINT PRIMARY KEY,
    "Status"                  TEXT,
    "[Arr] Airline code"      TEXT,
    "[Arr] Flight Designator" TEXT,
    "[Arr] ALDT"              TEXT,
    "[Arr] SIBT"              TEXT,
    "[Arr] AIBT"              TEXT,
    "[Arr] Stand"             TEXT,
    "[Arr] Gates"             TEXT,
    "[Arr] Boarded"           TEXT,
    "[Arr] Baggage Belts"     TEXT,
    "[Arr] Service Type"      TEXT,
    "Routing"                 TEXT,
    "[Dep] Service Type"      TEXT,
    "Aircraft type"           TEXT,
    "Registration"            TEXT,
    "[Dep] Airline code"      TEXT,
    "[Dep] Flight Designator" TEXT,
    "[Dep] Stand"             TEXT,
    "[Dep] Gates"             TEXT,
    "[Dep] Boarded"           TEXT,
    "[Dep] SOBT"              TEXT,
    "[Dep] AOBT"              TEXT,
    "[Dep] ATOT"              TEXT,
    "[Dep] ATTT"              TEXT,
    observaciones             TEXT,
    validado                  BOOLEAN     DEFAULT FALSE,
    validado_por              TEXT,
    validado_at               TIMESTAMPTZ,
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.manifiestos_vuelos_editable (
    id                        BIGINT PRIMARY KEY,
    "Status"                  TEXT,
    "[Arr] Airline code"      TEXT,
    "[Arr] Flight Designator" TEXT,
    "[Arr] ALDT"              TEXT,
    "[Arr] SIBT"              TEXT,
    "[Arr] AIBT"              TEXT,
    "[Arr] Stand"             TEXT,
    "[Arr] Gates"             TEXT,
    "[Arr] Boarded"           TEXT,
    "[Arr] Baggage Belts"     TEXT,
    "[Arr] Service Type"      TEXT,
    "Routing"                 TEXT,
    "[Dep] Service Type"      TEXT,
    "Aircraft type"           TEXT,
    "Registration"            TEXT,
    "[Dep] Airline code"      TEXT,
    "[Dep] Flight Designator" TEXT,
    "[Dep] Stand"             TEXT,
    "[Dep] Gates"             TEXT,
    "[Dep] Boarded"           TEXT,
    "[Dep] SOBT"              TEXT,
    "[Dep] AOBT"              TEXT,
    "[Dep] ATOT"              TEXT,
    "[Dep] ATTT"              TEXT,
    -- validado/validado_por/validado_at se mantienen sincronizados con
    -- itinerario_vuelos_editable (misma escritura desde toggleValidacion) para
    -- que el badge "Itinerario validado" en Conciliación se siga viendo igual
    -- que hoy.
    validado                  BOOLEAN     DEFAULT FALSE,
    validado_por              TEXT,
    validado_at               TIMESTAMPTZ,
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itin_vuelos_arr_sibt ON public.itinerario_vuelos_editable ("[Arr] SIBT");
CREATE INDEX IF NOT EXISTS idx_itin_vuelos_dep_sobt ON public.itinerario_vuelos_editable ("[Dep] SOBT");
CREATE INDEX IF NOT EXISTS idx_itin_vuelos_validado  ON public.itinerario_vuelos_editable (validado);

CREATE INDEX IF NOT EXISTS idx_manif_vuelos_arr_sibt ON public.manifiestos_vuelos_editable ("[Arr] SIBT");
CREATE INDEX IF NOT EXISTS idx_manif_vuelos_dep_sobt ON public.manifiestos_vuelos_editable ("[Dep] SOBT");
CREATE INDEX IF NOT EXISTS idx_manif_vuelos_flight_arr ON public.manifiestos_vuelos_editable ("[Arr] Flight Designator");
CREATE INDEX IF NOT EXISTS idx_manif_vuelos_flight_dep ON public.manifiestos_vuelos_editable ("[Dep] Flight Designator");

-- RLS: mismo nivel que vuelos_parte_operaciones_csv hoy (sin cambiar postura
-- de seguridad existente — ver db/create_vuelos_parte_operaciones_csv.sql).
ALTER TABLE public.itinerario_vuelos_editable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir gestión total de itinerario editable" ON public.itinerario_vuelos_editable;
CREATE POLICY "Permitir gestión total de itinerario editable"
ON public.itinerario_vuelos_editable
FOR ALL
TO public
USING (true)
WITH CHECK (true);

ALTER TABLE public.manifiestos_vuelos_editable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir gestión total de manifiestos vuelos editable" ON public.manifiestos_vuelos_editable;
CREATE POLICY "Permitir gestión total de manifiestos vuelos editable"
ON public.manifiestos_vuelos_editable
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- select count(*) from public.itinerario_vuelos_editable;
-- select count(*) from public.manifiestos_vuelos_editable;
-- select id, "Status", validado from public.itinerario_vuelos_editable limit 5;
-- ============================================================================
