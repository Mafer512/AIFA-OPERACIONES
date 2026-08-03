-- Muebles y Bienes: carga documental sólo con edición e historial protegido.
-- No modifica datos existentes ni políticas de otros módulos.

BEGIN;

DROP POLICY IF EXISTS mb_doc_file_insert ON public.muebles_bienes_documentos_archivos;
CREATE POLICY mb_doc_file_insert
  ON public.muebles_bienes_documentos_archivos FOR INSERT TO authenticated
  WITH CHECK (public.mb_access_level() IN ('admin','edit'));

DROP POLICY IF EXISTS mb_doc_link_insert ON public.muebles_bienes_documentos;
CREATE POLICY mb_doc_link_insert
  ON public.muebles_bienes_documentos FOR INSERT TO authenticated
  WITH CHECK (public.mb_access_level() IN ('admin','edit'));

DROP POLICY IF EXISTS mb_storage_insert ON storage.objects;
CREATE POLICY mb_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='muebles-bienes-documentos'
    AND public.mb_access_level() IN ('admin','edit')
    AND lower(storage.extension(name))='pdf'
  );

CREATE OR REPLACE FUNCTION public.mb_can_audit_history()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path=public
AS $$
  SELECT public.mb_access_level() IN ('admin','edit');
$$;

REVOKE ALL ON FUNCTION public.mb_can_audit_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mb_can_audit_history() TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.change_history') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS mb_change_history_select_guard ON public.change_history';
    EXECUTE $policy$
      CREATE POLICY mb_change_history_select_guard
      ON public.change_history AS RESTRICTIVE
      FOR SELECT TO authenticated
      USING (
        entity_type IS DISTINCT FROM 'Muebles y Bienes'
        OR public.mb_can_audit_history()
      )
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS mb_change_history_insert_guard ON public.change_history';
    EXECUTE $policy$
      CREATE POLICY mb_change_history_insert_guard
      ON public.change_history AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (
        entity_type IS DISTINCT FROM 'Muebles y Bienes'
        OR (
          public.mb_access_level() IN ('admin','edit')
          AND user_id=auth.uid()
        )
      )
    $policy$;
  END IF;
END $$;

COMMIT;
