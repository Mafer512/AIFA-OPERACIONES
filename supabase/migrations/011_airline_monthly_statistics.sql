-- Histórico oficial por aerolínea, mes y año.
-- Ejecutar en Supabase SQL Editor antes de cargar los datos 2022–2026.
-- Cada renglón representa los totales de una aerolínea en un mes.

CREATE TABLE IF NOT EXISTS public.airline_monthly_statistics (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year                  SMALLINT NOT NULL CHECK (year BETWEEN 2022 AND 2026),
  month                 SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  airline_code          TEXT NOT NULL,
  airline_name          TEXT,
  arrivals_passengers   BIGINT NOT NULL DEFAULT 0 CHECK (arrivals_passengers >= 0),
  departures_passengers BIGINT NOT NULL DEFAULT 0 CHECK (departures_passengers >= 0),
  arrivals_operations   INTEGER NOT NULL DEFAULT 0 CHECK (arrivals_operations >= 0),
  departures_operations INTEGER NOT NULL DEFAULT 0 CHECK (departures_operations >= 0),
  total_passengers      BIGINT NOT NULL DEFAULT 0 CHECK (total_passengers >= 0),
  total_operations      INTEGER NOT NULL DEFAULT 0 CHECK (total_operations >= 0),
  source                TEXT NOT NULL DEFAULT 'historico oficial',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month, airline_code)
);

-- Compatibilidad si la tabla se creó con una versión previa de esta migración.
ALTER TABLE public.airline_monthly_statistics
  ADD COLUMN IF NOT EXISTS total_passengers BIGINT NOT NULL DEFAULT 0 CHECK (total_passengers >= 0),
  ADD COLUMN IF NOT EXISTS total_operations INTEGER NOT NULL DEFAULT 0 CHECK (total_operations >= 0);

CREATE INDEX IF NOT EXISTS idx_airline_monthly_statistics_period
  ON public.airline_monthly_statistics (year DESC, month, airline_code);

ALTER TABLE public.airline_monthly_statistics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "airline_monthly_statistics_read" ON public.airline_monthly_statistics;
DROP POLICY IF EXISTS "airline_monthly_statistics_write" ON public.airline_monthly_statistics;
CREATE POLICY "airline_monthly_statistics_read"
  ON public.airline_monthly_statistics FOR SELECT TO authenticated USING (true);
CREATE POLICY "airline_monthly_statistics_write"
  ON public.airline_monthly_statistics FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Plantilla de carga: sustituir los ceros por los totales oficiales de cada
-- aerolínea y mes. El UPSERT permite volver a cargar o corregir un mes.
-- INSERT INTO public.airline_monthly_statistics
--   (year, month, airline_code, airline_name, total_passengers,
--    total_operations, source)
-- VALUES
--   (2022, 1, 'XX', 'Aerolínea ejemplo', 0, 0, 'Reporte oficial 2022')
-- ON CONFLICT (year, month, airline_code) DO UPDATE SET
--   airline_name = EXCLUDED.airline_name,
--   total_passengers = EXCLUDED.total_passengers,
--   total_operations = EXCLUDED.total_operations,
--   source = EXCLUDED.source,
--   updated_at = now();
