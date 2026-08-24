-- Fuente de detalle para el Estadístico por Aerolínea.
-- Guarda un Parte de Operaciones por fecha y sus vuelos en formato JSON.
-- Ejecutar una sola vez en Supabase SQL Editor si la tabla no existe.

CREATE TABLE IF NOT EXISTS public.vuelos_parte_operaciones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vuelos_parte_operaciones_date
  ON public.vuelos_parte_operaciones (date DESC);

ALTER TABLE public.vuelos_parte_operaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vuelos_parte_operaciones_authenticated_select" ON public.vuelos_parte_operaciones;
DROP POLICY IF EXISTS "vuelos_parte_operaciones_authenticated_write" ON public.vuelos_parte_operaciones;

CREATE POLICY "vuelos_parte_operaciones_authenticated_select"
  ON public.vuelos_parte_operaciones FOR SELECT TO authenticated USING (true);

CREATE POLICY "vuelos_parte_operaciones_authenticated_write"
  ON public.vuelos_parte_operaciones FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
