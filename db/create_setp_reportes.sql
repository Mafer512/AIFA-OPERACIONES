-- ============================================================
-- Supervisores de Edificio Terminal (SETP)
-- Ruta: Sgd. Operacional -> Ops. Ed. Terminal -> SETP
-- Crea la tabla de registros importados desde la plantilla Excel
-- de SETP (Fecha, Turno, Supervisor, Área, Tipo, Descripción,
-- Estatus). El reporte agrupa por supervisor y por turno.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.setp_reportes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Huella de fecha+turno+supervisor+área+tipo+descripción: volver a
    -- importar el mismo Excel actualiza el estatus en lugar de duplicar.
    row_hash text NOT NULL UNIQUE,
    fecha date NOT NULL,
    turno text NOT NULL CHECK (turno IN ('MATUTINO', 'VESPERTINO', 'NOCTURNO')),
    supervisor text NOT NULL CHECK (length(trim(supervisor)) > 0),
    area text,
    tipo text,
    descripcion text,
    estatus text CHECK (estatus IS NULL OR estatus IN ('ABIERTO', 'EN PROCESO', 'CERRADO')),
    archivo_origen text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text,
    updated_by text
);

CREATE INDEX IF NOT EXISTS idx_setp_reportes_fecha
    ON public.setp_reportes (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_setp_reportes_supervisor_turno
    ON public.setp_reportes (supervisor, turno);

ALTER TABLE public.setp_reportes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS setp_reportes_read ON public.setp_reportes;
CREATE POLICY setp_reportes_read
    ON public.setp_reportes
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS setp_reportes_insert ON public.setp_reportes;
CREATE POLICY setp_reportes_insert
    ON public.setp_reportes
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS setp_reportes_update ON public.setp_reportes;
CREATE POLICY setp_reportes_update
    ON public.setp_reportes
    FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS setp_reportes_delete ON public.setp_reportes;
CREATE POLICY setp_reportes_delete
    ON public.setp_reportes
    FOR DELETE
    USING (auth.role() = 'authenticated');
