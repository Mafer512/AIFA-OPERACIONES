-- ============================================================
-- SETP · Formato de hallazgos del Edificio Terminal de Pasajeros
-- Ruta: Sgd. Operacional -> Ops. Ed. Terminal -> SETP -> Crear formato
-- Crea:
--   1) setp_hallazgos: hallazgos con evidencia fotográfica y su solución
--   2) setp_oficios:   oficios generados (datos + copia fija de las tablas)
--   3) Bucket público setp-evidencias para las fotografías
-- ============================================================

CREATE TABLE IF NOT EXISTS public.setp_hallazgos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha_reporte date NOT NULL,
    modulo text NOT NULL CHECK (length(trim(modulo)) > 0),
    nivel text,
    descripcion text NOT NULL CHECK (length(trim(descripcion)) > 0),
    evidencia_url text,
    evidencia_path text,
    estatus text NOT NULL DEFAULT 'PENDIENTE' CHECK (estatus IN ('PENDIENTE', 'SOLUCIONADO')),
    fecha_solucion date,
    evidencia_solucion_url text,
    evidencia_solucion_path text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text,
    updated_by text,
    CHECK (estatus = 'PENDIENTE' OR fecha_solucion IS NOT NULL),
    CHECK (fecha_solucion IS NULL OR fecha_solucion >= fecha_reporte)
);

CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_fecha_reporte
    ON public.setp_hallazgos (fecha_reporte);

CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_estatus
    ON public.setp_hallazgos (estatus, fecha_solucion);

CREATE TABLE IF NOT EXISTS public.setp_oficios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    numero text NOT NULL UNIQUE CHECK (length(trim(numero)) > 0),
    fecha_oficio date NOT NULL,
    periodo date NOT NULL,              -- primer día del mes reportado
    datos jsonb NOT NULL DEFAULT '{}'::jsonb,
    secciones jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text,
    updated_by text
);

CREATE INDEX IF NOT EXISTS idx_setp_oficios_created
    ON public.setp_oficios (created_at DESC);

ALTER TABLE public.setp_hallazgos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setp_oficios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS setp_hallazgos_read ON public.setp_hallazgos;
CREATE POLICY setp_hallazgos_read
    ON public.setp_hallazgos
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS setp_hallazgos_write ON public.setp_hallazgos;
CREATE POLICY setp_hallazgos_write
    ON public.setp_hallazgos
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS setp_oficios_read ON public.setp_oficios;
CREATE POLICY setp_oficios_read
    ON public.setp_oficios
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS setp_oficios_write ON public.setp_oficios;
CREATE POLICY setp_oficios_write
    ON public.setp_oficios
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- ── Bucket de evidencias fotográficas ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'setp-evidencias',
    'setp-evidencias',
    true,
    5242880,  -- 5 MB por foto (el navegador las comprime antes de subir)
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "setp_evidencias_public_read" ON storage.objects;
CREATE POLICY "setp_evidencias_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'setp-evidencias');

DROP POLICY IF EXISTS "setp_evidencias_auth_insert" ON storage.objects;
CREATE POLICY "setp_evidencias_auth_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'setp-evidencias');

DROP POLICY IF EXISTS "setp_evidencias_auth_update" ON storage.objects;
CREATE POLICY "setp_evidencias_auth_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'setp-evidencias');

DROP POLICY IF EXISTS "setp_evidencias_auth_delete" ON storage.objects;
CREATE POLICY "setp_evidencias_auth_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'setp-evidencias');
