-- ============================================================================
-- Muebles y Bienes: PDFs de hasta 25 MB (antes 10 MB)
--
-- El límite vive en tres lugares y los tres tienen que coincidir:
--   1. js/muebles-bienes.js (MAX_PDF)            → avisa antes de subir
--   2. el bucket muebles-bienes-documentos       → Storage rechaza lo mayor
--   3. muebles_bienes_documentos_archivos.tamano_bytes (CHECK) → la base
--      rechaza registrar el archivo aunque Storage lo haya aceptado
--
-- 25 MB = 26,214,400 bytes: cubre un archivo de 25,000 KB.
-- Idempotente. Supabase → SQL Editor → pegar → Run.
-- ============================================================================

BEGIN;

-- 1. Bucket
UPDATE storage.buckets
   SET file_size_limit = 26214400
 WHERE id = 'muebles-bienes-documentos';

-- 2. Restricción de tamaño de la tabla. El CHECK de 011 se creó sin nombre,
--    así que se busca el que hable de tamano_bytes y se reemplaza.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'public'
           AND rel.relname = 'muebles_bienes_documentos_archivos'
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) ILIKE '%tamano_bytes%'
    LOOP
        EXECUTE format('ALTER TABLE public.muebles_bienes_documentos_archivos DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.muebles_bienes_documentos_archivos
    ADD CONSTRAINT muebles_bienes_documentos_archivos_tamano_bytes_check
    CHECK (tamano_bytes > 0 AND tamano_bytes <= 26214400);

COMMIT;

-- Comprobación: el bucket en 26214400 y una sola restricción de tamaño.
SELECT id, file_size_limit FROM storage.buckets WHERE id = 'muebles-bienes-documentos';
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.muebles_bienes_documentos_archivos'::regclass
   AND pg_get_constraintdef(oid) ILIKE '%tamano_bytes%';
