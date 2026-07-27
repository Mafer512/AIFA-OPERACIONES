-- ============================================================================
-- Backfill: llena itinerario_vuelos_editable y manifiestos_vuelos_editable
-- con los vuelos que YA estaban importados antes de crear esas tablas.
-- Ejecutar en: Supabase → SQL Editor, DESPUÉS de
-- db/create_itinerario_manifiestos_tablas.sql. Es IDEMPOTENTE (se puede
-- re-ejecutar sin duplicar filas — ON CONFLICT (id) DO NOTHING).
-- ----------------------------------------------------------------------------
-- create_itinerario_manifiestos_tablas.sql solo dejó preparado que las
-- IMPORTACIONES FUTURAS llenen ambas tablas nuevas; los vuelos que ya
-- existían en vuelos_parte_operaciones_csv antes de ese cambio nunca se
-- copiaron — por eso Itinerario de Vuelos y Manifiestos aparecen vacíos
-- hasta correr este script una vez.
-- ============================================================================

INSERT INTO public.itinerario_vuelos_editable (
    id, "Status", "[Arr] Airline code", "[Arr] Flight Designator", "[Arr] ALDT",
    "[Arr] SIBT", "[Arr] AIBT", "[Arr] Stand", "[Arr] Gates", "[Arr] Boarded",
    "[Arr] Baggage Belts", "[Arr] Service Type", "Routing", "[Dep] Service Type",
    "Aircraft type", "Registration", "[Dep] Airline code", "[Dep] Flight Designator",
    "[Dep] Stand", "[Dep] Gates", "[Dep] Boarded", "[Dep] SOBT", "[Dep] AOBT",
    "[Dep] ATOT", "[Dep] ATTT", observaciones, validado, validado_por, validado_at
)
SELECT
    id, "Status", "[Arr] Airline code", "[Arr] Flight Designator", "[Arr] ALDT",
    "[Arr] SIBT", "[Arr] AIBT", "[Arr] Stand", "[Arr] Gates", "[Arr] Boarded",
    "[Arr] Baggage Belts", "[Arr] Service Type", "Routing", "[Dep] Service Type",
    "Aircraft type", "Registration", "[Dep] Airline code", "[Dep] Flight Designator",
    "[Dep] Stand", "[Dep] Gates", "[Dep] Boarded", "[Dep] SOBT", "[Dep] AOBT",
    "[Dep] ATOT", "[Dep] ATTT", observaciones, validado, validado_por, validado_at
FROM public.vuelos_parte_operaciones_csv
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.manifiestos_vuelos_editable (
    id, "Status", "[Arr] Airline code", "[Arr] Flight Designator", "[Arr] ALDT",
    "[Arr] SIBT", "[Arr] AIBT", "[Arr] Stand", "[Arr] Gates", "[Arr] Boarded",
    "[Arr] Baggage Belts", "[Arr] Service Type", "Routing", "[Dep] Service Type",
    "Aircraft type", "Registration", "[Dep] Airline code", "[Dep] Flight Designator",
    "[Dep] Stand", "[Dep] Gates", "[Dep] Boarded", "[Dep] SOBT", "[Dep] AOBT",
    "[Dep] ATOT", "[Dep] ATTT", validado, validado_por, validado_at
)
SELECT
    id, "Status", "[Arr] Airline code", "[Arr] Flight Designator", "[Arr] ALDT",
    "[Arr] SIBT", "[Arr] AIBT", "[Arr] Stand", "[Arr] Gates", "[Arr] Boarded",
    "[Arr] Baggage Belts", "[Arr] Service Type", "Routing", "[Dep] Service Type",
    "Aircraft type", "Registration", "[Dep] Airline code", "[Dep] Flight Designator",
    "[Dep] Stand", "[Dep] Gates", "[Dep] Boarded", "[Dep] SOBT", "[Dep] AOBT",
    "[Dep] ATOT", "[Dep] ATTT", validado, validado_por, validado_at
FROM public.vuelos_parte_operaciones_csv
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- select count(*) from public.vuelos_parte_operaciones_csv;   -- total original
-- select count(*) from public.itinerario_vuelos_editable;     -- debe coincidir
-- select count(*) from public.manifiestos_vuelos_editable;    -- debe coincidir
-- ============================================================================
