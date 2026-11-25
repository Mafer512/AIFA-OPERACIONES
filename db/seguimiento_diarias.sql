-- ============================================================================
-- SEGUIMIENTO · Dos espacios: Diarias y Agenda
--
-- Diarias: el día a día. Pendientes cortos («llamar a SENEAM», «enviar el
--   oficio a AFAC») y rutinas que se repiten cada día, de lunes a viernes o cada
--   semana («revisar el parte de operaciones», «firmar la bitácora de turno»).
-- Agenda: lo que tiene fecha y seguimiento formal: órdenes de la Dirección,
--   compromisos de reunión, renovaciones y certificados. Es lo que ya existía:
--   todas las tareas actuales quedan en Agenda.
--
-- Las dos pasan por la validación del Director (db/seguimiento_validacion.sql).
-- En las rutinas, la siguiente se programa en cuanto se entrega la de hoy.
--
-- Requiere db/create_seguimiento.sql. Es idempotente: se puede correr más de
-- una vez. Supabase → SQL Editor → pegar → Run.
-- ============================================================================

BEGIN;

-- ── 1. El espacio de cada tarea ──────────────────────────────────────────────
ALTER TABLE public.seguimiento_tareas ADD COLUMN IF NOT EXISTS clase text NOT NULL DEFAULT 'agenda';
ALTER TABLE public.seguimiento_tareas DROP CONSTRAINT IF EXISTS seguimiento_tareas_clase_chk;
ALTER TABLE public.seguimiento_tareas ADD CONSTRAINT seguimiento_tareas_clase_chk
  CHECK (clase IN ('agenda', 'diaria'));

COMMENT ON COLUMN public.seguimiento_tareas.clase IS
  'Espacio: diaria (día a día y rutinas) o agenda (órdenes, compromisos, renovaciones).';

CREATE INDEX IF NOT EXISTS idx_seguimiento_tareas_clase ON public.seguimiento_tareas (clase, fecha_limite);

-- ── 2. Rutinas: cada día, de lunes a viernes, cada semana ─────────────────────
ALTER TABLE public.seguimiento_tareas DROP CONSTRAINT IF EXISTS seguimiento_tareas_recurr_chk;
ALTER TABLE public.seguimiento_tareas ADD CONSTRAINT seguimiento_tareas_recurr_chk
  CHECK (recurrencia IN ('ninguna', 'diaria', 'laborable', 'semanal',
                         'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'bienal', 'personalizada'));

COMMIT;

-- Que la API vea la columna nueva sin esperar.
NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT clase, count(*) FROM public.seguimiento_tareas GROUP BY clase;
-- SELECT folio, titulo, clase, recurrencia, fecha_limite, estatus
--   FROM public.seguimiento_tareas WHERE clase = 'diaria' ORDER BY fecha_limite NULLS LAST LIMIT 30;
