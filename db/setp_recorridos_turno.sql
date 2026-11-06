-- ============================================================================
-- SETP · Turno de cada recorrido (Matutino, Vespertino o Nocturno)
--
-- NO crea ninguna tabla. Agrega la columna "turno" a la tabla
-- setp_recorridos que ya existe. El supervisor elige su turno al presionar
-- "Iniciar recorrido", y la tarjeta "Turno con más recorridos" los cuenta
-- por supervisor.
--
-- Los recorridos que ya existen quedan sin turno; se les puede asignar
-- desde la tabla Supervisor × turno. No modifica datos. Es idempotente.
-- Requiere haber corrido antes db/setp_modulo_completo.sql y
-- db/setp_recorridos_captura.sql.
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================

ALTER TABLE public.setp_recorridos
    ADD COLUMN IF NOT EXISTS turno text
        CHECK (turno IS NULL OR turno IN ('MATUTINO', 'VESPERTINO', 'NOCTURNO'));

CREATE INDEX IF NOT EXISTS idx_setp_recorridos_turno
    ON public.setp_recorridos (no_empleado, turno);

-- Que el aplicativo vea la columna nueva de inmediato.
NOTIFY pgrst, 'reload schema';

-- Comprobación: debe salir la columna turno.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'setp_recorridos' AND column_name = 'turno';
