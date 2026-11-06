-- ============================================================================
-- SETP · Captura de recorridos y "Crear usuario" desde el aplicativo
-- Requiere haber corrido antes db/setp_modulo_completo.sql.
--
--   1. "Crear usuario": da de alta supervisores desde la página SETP.
--   2. Momento del registro: se llena solo; sirve para ordenar los
--      recorridos y mostrar de qué día es cada uno.
--   3. Hora de inicio y de término en tiempo real, fijadas por el servidor
--      (hora del centro de México): "Iniciar recorrido" fija la hora de
--      inicio y "Finalizar recorrido" la de término. Una vez fijadas, no se
--      pueden cambiar.
--   4. Un solo recorrido en curso por supervisor.
--
-- NO modifica tablas existentes del aplicativo. Es idempotente.
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================


-- ── 1. Crear usuario (supervisor) desde el aplicativo ───────────────────────
DROP POLICY IF EXISTS setp_supervisores_insert ON public.setp_supervisores;
CREATE POLICY setp_supervisores_insert
    ON public.setp_supervisores
    FOR INSERT TO authenticated
    WITH CHECK (true);

GRANT INSERT ON public.setp_supervisores TO authenticated;


-- ── 2. Momento del registro (automático) ────────────────────────────────────
ALTER TABLE public.setp_recorridos
    ADD COLUMN IF NOT EXISTS registrado_en timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_setp_recorridos_registrado
    ON public.setp_recorridos (registrado_en DESC);


-- ── 3. Horas en tiempo real, fijadas por el servidor ────────────────────────
-- Al iniciar, la hora de inicio es la del servidor (no la del celular).
-- Al finalizar, basta con mandar cualquier hora de término: el servidor la
-- reemplaza por la hora real. Lo ya fijado no se puede modificar.
CREATE OR REPLACE FUNCTION public.setp_recorridos_horas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    ahora time(0) := (now() AT TIME ZONE 'America/Mexico_City')::time(0);
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.hora_inicio := ahora;
        NEW.hora_termino := NULL;
        NEW.registrado_en := now();
    ELSE
        NEW.hora_inicio := OLD.hora_inicio;
        NEW.registrado_en := OLD.registrado_en;
        IF OLD.hora_termino IS NOT NULL THEN
            NEW.hora_termino := OLD.hora_termino;
        ELSIF NEW.hora_termino IS NOT NULL THEN
            NEW.hora_termino := ahora;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_setp_recorridos_horas ON public.setp_recorridos;
CREATE TRIGGER trg_setp_recorridos_horas
    BEFORE INSERT OR UPDATE ON public.setp_recorridos
    FOR EACH ROW EXECUTE FUNCTION public.setp_recorridos_horas();


-- ── 4. Un solo recorrido en curso por supervisor ────────────────────────────
-- Evita que "Iniciar recorrido" se registre dos veces si se presiona doble.
CREATE UNIQUE INDEX IF NOT EXISTS idx_setp_recorridos_en_curso
    ON public.setp_recorridos (no_empleado)
    WHERE hora_termino IS NULL;


-- ── 5. Que el aplicativo vea los cambios de inmediato ───────────────────────
NOTIFY pgrst, 'reload schema';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'setp_recorridos'
ORDER BY ordinal_position;
