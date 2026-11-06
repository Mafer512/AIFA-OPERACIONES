-- ============================================================================
-- SETP · Hallazgos y formatos por supervisor
--
-- NO crea ninguna tabla ni borra datos. Agrega columnas a tablas que ya
-- existen para que cada supervisor trabaje por separado:
--   setp_hallazgos.no_empleado  supervisor que capturó el hallazgo.
--   setp_hallazgos.oficio_id    formato en el que salió el hallazgo detectado.
--                               Mientras esté vacío, aparece en "Hallazgos
--                               detectados" de su supervisor; al guardar el
--                               formato se llena y esa sección queda limpia
--                               para el siguiente.
--   setp_oficios.no_empleado    supervisor dueño de cada formato guardado.
--
-- "Hallazgos solucionados" y "pendientes por solucionar" no cambian: siguen
-- siendo el seguimiento del mes anterior con todos los hallazgos.
-- Los hallazgos detectados que ya existen quedan sin supervisor: siguen en
-- la base de datos, pero ya no se cargan en "Hallazgos detectados".
-- Si se cambia el No. de empleado de un supervisor, sus hallazgos y formatos
-- lo siguen (ON UPDATE CASCADE). Es idempotente.
-- Requiere haber corrido antes db/setp_modulo_completo.sql y
-- db/setp_hallazgos_secciones.sql.
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================

ALTER TABLE public.setp_hallazgos
    ADD COLUMN IF NOT EXISTS no_empleado text
        REFERENCES public.setp_supervisores (no_empleado) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.setp_hallazgos
    ADD COLUMN IF NOT EXISTS oficio_id uuid
        REFERENCES public.setp_oficios (id) ON DELETE SET NULL;

ALTER TABLE public.setp_oficios
    ADD COLUMN IF NOT EXISTS no_empleado text
        REFERENCES public.setp_supervisores (no_empleado) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_supervisor
    ON public.setp_hallazgos (no_empleado, oficio_id);

CREATE INDEX IF NOT EXISTS idx_setp_oficios_supervisor
    ON public.setp_oficios (no_empleado, created_at DESC);

-- Que el aplicativo vea las columnas nuevas de inmediato.
NOTIFY pgrst, 'reload schema';

-- Comprobación: deben salir 3 renglones.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'setp_hallazgos' AND column_name IN ('no_empleado', 'oficio_id'))
    OR (table_name = 'setp_oficios' AND column_name = 'no_empleado'))
ORDER BY table_name, column_name;
