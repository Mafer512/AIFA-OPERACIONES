-- Marca de agua corta y repetida.
-- Ejecutar DESPUÉS de create_document_watermarks.sql.

ALTER TABLE public.document_watermarks
  ADD COLUMN IF NOT EXISTS encrypted_payload text;

ALTER TABLE public.document_watermarks
  DROP CONSTRAINT IF EXISTS document_watermarks_encryption_version_check;

ALTER TABLE public.document_watermarks
  ADD CONSTRAINT document_watermarks_encryption_version_check
  CHECK (encryption_version IN (1, 2));

ALTER TABLE public.document_watermarks
  ALTER COLUMN encryption_version SET DEFAULT 2;

-- La función ya requiere permiso Miscelánea. Devuelve el payload cifrado sólo
-- a la Edge Function para descifrarlo y presentarlo en el validador.
DROP FUNCTION IF EXISTS public.validate_document_watermark(text);

CREATE OR REPLACE FUNCTION public.validate_document_watermark(p_code text)
RETURNS TABLE (
    registered boolean,
    record_id uuid,
    validation_count integer,
    encrypted_payload text
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
        UPDATE public.document_watermarks AS dw
           SET validation_count = dw.validation_count + 1,
               last_validated_at = now()
         WHERE dw.watermark_code = upper(trim(p_code))
         RETURNING dw.id, dw.validation_count, dw.encrypted_payload
    )
    SELECT true, changed.id, changed.validation_count, changed.encrypted_payload
      FROM changed;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::text;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_document_watermark(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_document_watermark(text) TO authenticated;
