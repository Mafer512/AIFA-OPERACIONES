-- ============================================================================
-- Fecha y motivo de baja en agenda_2026
--
-- El directorio ya sabe leer la fecha de baja (una persona con fecha cumplida
-- deja de contar en el Resumen), pero no había dónde capturarla desde la ficha.
-- Este script solo se asegura de que las dos columnas existan; si ya las creó
-- agenda_2026_incorpora_personal_baja_20260727.sql, no hace nada.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- Cómo correrlo: Supabase → SQL Editor → pegar → Run.
-- ============================================================================

ALTER TABLE public.agenda_2026
  ADD COLUMN IF NOT EXISTS "Fecha de baja"   text,
  ADD COLUMN IF NOT EXISTS "Motivos de baja" text;

COMMENT ON COLUMN public.agenda_2026."Fecha de baja" IS
  'Fecha en que la persona causó baja, en formato AAAA-MM-DD. Con este dato el Resumen del Directorio deja de contarla a partir de ese día.';

COMMENT ON COLUMN public.agenda_2026."Motivos de baja" IS
  'Motivo de la baja capturado desde la ficha del colaborador (renuncia, término de contrato, etc.).';

-- ── Comprobación: las dos columnas deben aparecer aquí ──────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'agenda_2026'
  AND column_name IN ('Fecha de baja', 'Motivos de baja')
ORDER BY column_name;

-- ── Quién tiene ya una baja registrada ──────────────────────────────────────
SELECT "No. Empleado", "Nombre", "Estatus", "Fecha de baja", "Motivos de baja"
FROM public.agenda_2026
WHERE COALESCE(NULLIF(btrim("Fecha de baja"), ''), NULL) IS NOT NULL
ORDER BY "Fecha de baja" DESC
LIMIT 50;
