-- Marca de agua verificable — AIFA Operaciones
-- Ejecutar una sola vez en Supabase SQL Editor antes de habilitar el módulo.
-- La clave AES NO se guarda en esta base: configurar WATERMARK_ENCRYPTION_KEY
-- únicamente en el entorno del servidor Node.

CREATE TABLE IF NOT EXISTS public.document_watermarks (
    id uuid PRIMARY KEY,
    watermark_code text NOT NULL UNIQUE,
    document_name text NOT NULL,
    document_sha256 char(64) NOT NULL,
    source_mime_type text NOT NULL,
    output_mime_type text NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    issued_by_name text NOT NULL,
    encryption_version smallint NOT NULL DEFAULT 1 CHECK (encryption_version = 1),
    validation_count integer NOT NULL DEFAULT 0 CHECK (validation_count >= 0),
    last_validated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_watermarks_issued_by_idx
    ON public.document_watermarks (issued_by, issued_at DESC);

ALTER TABLE public.document_watermarks ENABLE ROW LEVEL SECURITY;

-- La función reproduce la regla de navegación de Miscelánea en backend:
-- admin/superadmin siempre; sin lista o lista vacía conserva el acceso base;
-- con lista explícita se requiere "miscelanea".
CREATE OR REPLACE FUNCTION public.can_use_miscelanea()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT ur.role IN ('admin', 'superadmin')
      OR NOT (COALESCE(ur.permissions, '{}'::jsonb) ? 'allowed_sections')
      OR jsonb_array_length(COALESCE(ur.permissions->'allowed_sections', '[]'::jsonb)) = 0
      OR COALESCE(ur.permissions->'allowed_sections', '[]'::jsonb) ? 'miscelanea'
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    LIMIT 1
  ), false);
$$;

REVOKE ALL ON FUNCTION public.can_use_miscelanea() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_use_miscelanea() TO authenticated;

DROP POLICY IF EXISTS document_watermarks_insert_own ON public.document_watermarks;
CREATE POLICY document_watermarks_insert_own
    ON public.document_watermarks
    FOR INSERT TO authenticated
    WITH CHECK (issued_by = auth.uid() AND public.can_use_miscelanea());

DROP POLICY IF EXISTS document_watermarks_select_owner_or_admin ON public.document_watermarks;
CREATE POLICY document_watermarks_select_owner_or_admin
    ON public.document_watermarks
    FOR SELECT TO authenticated
    USING (
        issued_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
        )
    );

-- Valida que el token recibido siga existiendo y actualiza su auditoría. No
-- devuelve el código ni el hash del documento; el backend descifra el token.
CREATE OR REPLACE FUNCTION public.validate_document_watermark(p_code text)
RETURNS TABLE (
    registered boolean,
    record_id uuid,
    validation_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.can_use_miscelanea() THEN
        RAISE EXCEPTION 'No autorizado para validar marcas de agua';
    END IF;

    RETURN QUERY
    WITH changed AS (
        UPDATE public.document_watermarks
           SET validation_count = validation_count + 1,
               last_validated_at = now()
         WHERE watermark_code = p_code
         RETURNING id, validation_count
    )
    SELECT true, changed.id, changed.validation_count FROM changed;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::integer;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_document_watermark(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_document_watermark(text) TO authenticated;

REVOKE ALL ON TABLE public.document_watermarks FROM anon;
GRANT INSERT, SELECT ON TABLE public.document_watermarks TO authenticated;

COMMENT ON TABLE public.document_watermarks IS
  'Registro verificable de documentos marcados por AIFA Operaciones. El token se cifra en el backend con AES-256-GCM.';
