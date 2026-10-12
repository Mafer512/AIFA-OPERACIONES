-- ============================================================================
-- SEGUIMIENTO · Repetir con un tiempo personalizado
-- (cada 18 meses, cada 3 años, cada 5 años…)
--
-- Sólo hace falta si ya habías corrido db/create_seguimiento.sql antes de este
-- cambio; ese archivo ya trae lo mismo. Es idempotente y no borra nada.
-- Supabase → SQL Editor → pegar → Run.
-- ============================================================================

BEGIN;

ALTER TABLE public.seguimiento_tareas ADD COLUMN IF NOT EXISTS recurrencia_meses integer;

COMMENT ON COLUMN public.seguimiento_tareas.recurrencia_meses IS
  'Con recurrencia = personalizada: cada cuántos meses se repite (1 a 240).';

ALTER TABLE public.seguimiento_tareas DROP CONSTRAINT IF EXISTS seguimiento_tareas_recurr_chk;
ALTER TABLE public.seguimiento_tareas ADD CONSTRAINT seguimiento_tareas_recurr_chk
  CHECK (recurrencia IN ('ninguna', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'bienal', 'personalizada'));

ALTER TABLE public.seguimiento_tareas DROP CONSTRAINT IF EXISTS seguimiento_tareas_recurr_meses_chk;
ALTER TABLE public.seguimiento_tareas ADD CONSTRAINT seguimiento_tareas_recurr_meses_chk
  CHECK (recurrencia <> 'personalizada' OR recurrencia_meses BETWEEN 1 AND 240);

COMMIT;

-- Que la API vea la columna nueva sin esperar.
NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'seguimiento_tareas' AND column_name = 'recurrencia_meses';
