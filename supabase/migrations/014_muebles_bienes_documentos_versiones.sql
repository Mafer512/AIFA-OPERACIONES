-- Ejecutar después de 011/012 ya aplicadas. No modifica bienes ni otros módulos.
ALTER TABLE public.muebles_bienes_documentos_archivos
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS uploader_email TEXT;

ALTER TABLE public.muebles_bienes_documentos_archivos
  DROP CONSTRAINT IF EXISTS muebles_bienes_documentos_archivos_sha256_key;
CREATE INDEX IF NOT EXISTS idx_mb_doc_sha256
  ON public.muebles_bienes_documentos_archivos(sha256);

DROP POLICY IF EXISTS mb_doc_file_update ON public.muebles_bienes_documentos_archivos;
CREATE POLICY mb_doc_file_update
  ON public.muebles_bienes_documentos_archivos FOR UPDATE TO authenticated
  USING (public.mb_access_level() IN ('admin','edit'))
  WITH CHECK (public.mb_access_level() IN ('admin','edit'));

GRANT SELECT,INSERT,UPDATE,DELETE
  ON public.muebles_bienes_documentos_archivos TO authenticated;
