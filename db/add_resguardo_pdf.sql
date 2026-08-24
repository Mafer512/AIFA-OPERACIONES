-- ============================================================
-- Catálogo de Vehículos Terrestres — PDF de Número de Resguardo
-- Coordinación de Auditoría · Dirección de Operación · AIFA
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Columnas para el archivo PDF de resguardo
ALTER TABLE public.catalogo_vehiculos
    ADD COLUMN IF NOT EXISTS resguardo_pdf_path   TEXT,
    ADD COLUMN IF NOT EXISTS resguardo_pdf_nombre TEXT;

COMMENT ON COLUMN public.catalogo_vehiculos.resguardo_pdf_path IS
    'Ruta del archivo en el bucket privado vehiculos-resguardos.';
COMMENT ON COLUMN public.catalogo_vehiculos.resguardo_pdf_nombre IS
    'Nombre original del PDF de resguardo subido por el usuario.';

-- 2. Bucket privado para los PDFs de resguardo
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vehiculos-resguardos',
    'vehiculos-resguardos',
    false,
    10485760, -- 10 MB máximo por archivo
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura: cualquier usuario autenticado con acceso a la sección de auditoría
DROP POLICY IF EXISTS "veh_resguardos_select" ON storage.objects;
CREATE POLICY "veh_resguardos_select"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'vehiculos-resguardos' AND
        public.user_can_access_section('coord-auditoria')
    );

-- Subida: solo admins (mismo criterio que el resto del catálogo)
DROP POLICY IF EXISTS "veh_resguardos_insert" ON storage.objects;
CREATE POLICY "veh_resguardos_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'vehiculos-resguardos' AND
        lower(storage.extension(name)) = 'pdf' AND
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin')
        )
    );

-- Actualización (reemplazo de archivo): solo admins
DROP POLICY IF EXISTS "veh_resguardos_update" ON storage.objects;
CREATE POLICY "veh_resguardos_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'vehiculos-resguardos' AND
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin')
        )
    );

-- Eliminación: solo admins
DROP POLICY IF EXISTS "veh_resguardos_delete" ON storage.objects;
CREATE POLICY "veh_resguardos_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'vehiculos-resguardos' AND
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin')
        )
    );

-- ── NOTAS DE USO ──────────────────────────────────────────────
-- 1. El PDF se adjunta desde la columna "Número de Resguardo" del
--    catálogo de vehículos (ícono de lápiz -> selector de archivo PDF).
-- 2. El bucket 'vehiculos-resguardos' es privado; la vista/descarga
--    del PDF usa una URL firmada (createSignedUrl), no una URL pública.
-- 3. resguardo_pdf_path guarda la ruta interna del archivo y
--    resguardo_pdf_nombre el nombre original para mostrarlo en pantalla.
