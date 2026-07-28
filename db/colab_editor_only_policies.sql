-- =============================================================
-- Control definitivo de edición para Colaboradores
-- Solo el rol colab_editor puede modificar información.
-- Ejecutar en Supabase > SQL Editor.
-- =============================================================

BEGIN;

-- Helper: normaliza y valida el rol del usuario autenticado.
CREATE OR REPLACE FUNCTION public.is_colab_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((
        SELECT lower(replace(trim(role), ' ', '_')) = 'colab_editor'
        FROM public.user_roles
        WHERE user_id = auth.uid()
        LIMIT 1
    ), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_colab_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_colab_editor() TO authenticated;

-- agenda_2026: lectura para usuarios autenticados; escritura solo colab_editor.
ALTER TABLE public.agenda_2026 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agenda_2026: lectura roles colab" ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026: edicion colab_editor" ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_select_authenticated" ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_insert_colab_editor" ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_update_colab_editor" ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_delete_colab_editor" ON public.agenda_2026;

CREATE POLICY "agenda_2026_select_authenticated"
    ON public.agenda_2026
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "agenda_2026_insert_colab_editor"
    ON public.agenda_2026
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_colab_editor());

CREATE POLICY "agenda_2026_update_colab_editor"
    ON public.agenda_2026
    FOR UPDATE
    TO authenticated
    USING (public.is_colab_editor())
    WITH CHECK (public.is_colab_editor());

CREATE POLICY "agenda_2026_delete_colab_editor"
    ON public.agenda_2026
    FOR DELETE
    TO authenticated
    USING (public.is_colab_editor());

-- colab_cursos: lectura para usuarios autenticados; escritura solo colab_editor.
DO $$
BEGIN
    IF to_regclass('public.colab_cursos') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.colab_cursos ENABLE ROW LEVEL SECURITY';

        EXECUTE 'DROP POLICY IF EXISTS "colab_cursos_select_authenticated" ON public.colab_cursos';
        EXECUTE 'DROP POLICY IF EXISTS "colab_cursos_insert_colab_editor" ON public.colab_cursos';
        EXECUTE 'DROP POLICY IF EXISTS "colab_cursos_update_colab_editor" ON public.colab_cursos';
        EXECUTE 'DROP POLICY IF EXISTS "colab_cursos_delete_colab_editor" ON public.colab_cursos';

        EXECUTE 'CREATE POLICY "colab_cursos_select_authenticated" ON public.colab_cursos FOR SELECT TO authenticated USING (true)';
        EXECUTE 'CREATE POLICY "colab_cursos_insert_colab_editor" ON public.colab_cursos FOR INSERT TO authenticated WITH CHECK (public.is_colab_editor())';
        EXECUTE 'CREATE POLICY "colab_cursos_update_colab_editor" ON public.colab_cursos FOR UPDATE TO authenticated USING (public.is_colab_editor()) WITH CHECK (public.is_colab_editor())';
        EXECUTE 'CREATE POLICY "colab_cursos_delete_colab_editor" ON public.colab_cursos FOR DELETE TO authenticated USING (public.is_colab_editor())';
    END IF;
END $$;

-- colab_historial: lectura para usuarios autenticados; altas solo colab_editor.
DO $$
BEGIN
    IF to_regclass('public.colab_historial') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.colab_historial ENABLE ROW LEVEL SECURITY';

        EXECUTE 'DROP POLICY IF EXISTS "colab_historial_select_authenticated" ON public.colab_historial';
        EXECUTE 'DROP POLICY IF EXISTS "colab_historial_insert_colab_editor" ON public.colab_historial';

        EXECUTE 'CREATE POLICY "colab_historial_select_authenticated" ON public.colab_historial FOR SELECT TO authenticated USING (true)';
        EXECUTE 'CREATE POLICY "colab_historial_insert_colab_editor" ON public.colab_historial FOR INSERT TO authenticated WITH CHECK (public.is_colab_editor())';
    END IF;
END $$;

-- Storage: agrega políticas de escritura para buckets usados por colaboradores.
-- Si existen políticas amplias anteriores en storage.objects, revísalas con la
-- consulta final y elimínalas manualmente solo si permiten escritura fuera de colab_editor.
DROP POLICY IF EXISTS "storage_colab_docs_insert_colab_editor" ON storage.objects;
DROP POLICY IF EXISTS "storage_colab_docs_update_colab_editor" ON storage.objects;
DROP POLICY IF EXISTS "storage_colab_docs_delete_colab_editor" ON storage.objects;

CREATE POLICY "storage_colab_docs_insert_colab_editor"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id IN ('employee-cvs', 'employee-photos', 'colab-cursos-pdfs')
        AND public.is_colab_editor()
    );

CREATE POLICY "storage_colab_docs_update_colab_editor"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id IN ('employee-cvs', 'employee-photos', 'colab-cursos-pdfs')
        AND public.is_colab_editor()
    )
    WITH CHECK (
        bucket_id IN ('employee-cvs', 'employee-photos', 'colab-cursos-pdfs')
        AND public.is_colab_editor()
    );

CREATE POLICY "storage_colab_docs_delete_colab_editor"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id IN ('employee-cvs', 'employee-photos', 'colab-cursos-pdfs')
        AND public.is_colab_editor()
    );

COMMIT;

-- Verificación recomendada después de ejecutar:
-- SELECT public.is_colab_editor();
-- SELECT schemaname, tablename, policyname, cmd
-- FROM pg_policies
-- WHERE (schemaname = 'public' AND tablename IN ('agenda_2026','colab_cursos','colab_historial'))
--    OR (schemaname = 'storage' AND tablename = 'objects')
-- ORDER BY schemaname, tablename, policyname;
