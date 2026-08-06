-- ============================================================
-- BUCKET PRIVADO: employee-document-images
-- INE frente/reverso y TIA/Credencial de colaboradores.
-- Ejecutar en Supabase > SQL Editor.
-- ============================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-document-images',
  'employee-document-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.is_colab_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT lower(replace(trim(role), ' ', '_')) IN ('admin', 'superadmin', 'colab_editor')
    FROM public.user_roles
    WHERE user_id = auth.uid()
    LIMIT 1
  ), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_colab_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_colab_editor() TO authenticated;

DROP POLICY IF EXISTS "employee_document_images_select" ON storage.objects;
DROP POLICY IF EXISTS "employee_document_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "employee_document_images_update" ON storage.objects;
DROP POLICY IF EXISTS "employee_document_images_delete" ON storage.objects;

-- Las rutas las genera la aplicación; nunca usa el nombre original del archivo.
-- Formato: <numero_empleado>/<tipo>-<token>.<jpg|png>
CREATE POLICY "employee_document_images_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-document-images'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(ine_front|ine_back|credential)-[A-Za-z0-9_-]+\.(jpg|png)$'
  );

CREATE POLICY "employee_document_images_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-document-images'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(ine_front|ine_back|credential)-[A-Za-z0-9_-]+\.(jpg|png)$'
  );

CREATE POLICY "employee_document_images_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-document-images'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(ine_front|ine_back|credential)-[A-Za-z0-9_-]+\.(jpg|png)$'
  )
  WITH CHECK (
    bucket_id = 'employee-document-images'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(ine_front|ine_back|credential)-[A-Za-z0-9_-]+\.(jpg|png)$'
  );

CREATE POLICY "employee_document_images_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-document-images'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(ine_front|ine_back|credential)-[A-Za-z0-9_-]+\.(jpg|png)$'
  );

COMMIT;

-- Verificación:
-- SELECT id, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'employee-document-images';
-- SELECT policyname, roles, cmd FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'employee_document_images_%'
-- ORDER BY policyname;
