-- ============================================================================
-- SETP · Secciones independientes y confirmación de estatus de hallazgos
-- Requiere haber corrido antes db/setp_modulo_completo.sql.
--
--   1. seccion: cada hallazgo se queda en la sección donde se capturó
--      (Hallazgos detectados, Hallazgos solucionados o Hallazgos pendientes
--      por solucionar), aunque después cambie su estatus. Las tres secciones
--      se juntan sólo al generar el formato.
--   2. confirmado_en / confirmado_por: el botón ✓ confirma el estatus actual
--      del hallazgo (no lo cambia) y deja registro de cuándo y quién.
--
-- Sólo agrega columnas a setp_hallazgos; no modifica datos existentes.
-- Es idempotente. Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================

ALTER TABLE public.setp_hallazgos
    ADD COLUMN IF NOT EXISTS seccion text
        CHECK (seccion IS NULL OR seccion IN ('DETECTADOS', 'SOLUCIONADOS', 'PENDIENTES'));

ALTER TABLE public.setp_hallazgos
    ADD COLUMN IF NOT EXISTS confirmado_en timestamptz;

ALTER TABLE public.setp_hallazgos
    ADD COLUMN IF NOT EXISTS confirmado_por text;

CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_seccion
    ON public.setp_hallazgos (seccion, fecha_reporte);

-- Que el aplicativo vea las columnas nuevas de inmediato.
NOTIFY pgrst, 'reload schema';

-- Comprobación: deben salir seccion, confirmado_en y confirmado_por.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'setp_hallazgos'
  AND column_name IN ('seccion', 'confirmado_en', 'confirmado_por');
