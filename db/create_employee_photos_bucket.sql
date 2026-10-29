-- ============================================================
--  BUCKET: employee-photos
--  Fotos de empleados nombradas por número de empleado
--  Ejemplos: 1551.png, 1612.jpg, 1614.jpg
--  Ejecutar en: Supabase -> SQL Editor
-- ============================================================

BEGIN;

-- 1. Crear o reparar el bucket público. ON CONFLICT debe actualizar la
-- configuración efectiva: DO NOTHING dejaba buckets antiguos con MIME/límites
-- incorrectos y no solucionaba un despliegue parcial.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-photos',
  'employee-photos',
  true,
  5242880,                              -- límite 5 MB por foto
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  name               = EXCLUDED.name,
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Mantener la misma autorización del módulo: sólo Admin, Superadmin y
-- Colab Editor pueden escribir. La función usa auth.uid(), no datos del cliente.
-- Está definida SOLO en db/fix_rls_colaboradores_edicion.sql; aquí no se
-- redefine para no regresar la versión vieja (sólo user_roles, LIMIT 1).
DO $$
BEGIN
  IF to_regprocedure('public.is_colab_editor()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.is_colab_editor(). Corre antes db/fix_rls_colaboradores_edicion.sql.';
  END IF;
END $$;

-- 3. Sustituir políticas históricas. La política INSERT anterior aplicaba a
-- PUBLIC y permitía cargas anónimas; se elimina para no degradar seguridad.
DROP POLICY IF EXISTS "employee_photos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_select_colab_editor" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_insert_auth" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_update_auth" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_delete_auth" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_insert_colab_editor" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_update_colab_editor" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_delete_colab_editor" ON storage.objects;

-- El bucket sigue siendo público para mostrar una foto cuando ya se conoce su
-- URL, pero los metadatos/listados sólo se exponen a editores autorizados. Esta
-- política SELECT también es requerida por Storage para realizar un upsert.
CREATE POLICY "employee_photos_select_colab_editor"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND public.is_colab_editor()
  );

CREATE POLICY "employee_photos_insert_colab_editor"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND public.is_colab_editor()
  );

CREATE POLICY "employee_photos_update_colab_editor"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND public.is_colab_editor()
  )
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND public.is_colab_editor()
  );

CREATE POLICY "employee_photos_delete_colab_editor"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND public.is_colab_editor()
  );

COMMIT;

-- ============================================================
--  URL pública de una foto (referencia):
--  https://<PROJECT_REF>.supabase.co/storage/v1/object/public/employee-photos/1612.jpg
--
--  Verificación:
--  SELECT id, public, file_size_limit, allowed_mime_types
--  FROM storage.buckets WHERE id = 'employee-photos';
--  SELECT policyname, roles, cmd FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname LIKE 'employee_photos_%'
--  ORDER BY policyname;
-- ============================================================
