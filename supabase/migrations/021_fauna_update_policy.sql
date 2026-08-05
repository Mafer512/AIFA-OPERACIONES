-- Alinea la actualización de impactos de fauna con el RBAC por módulo.
-- No modifica datos, columnas ni políticas de INSERT/DELETE/SELECT.

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.user_can_edit_section(text)') IS NULL THEN
        RAISE EXCEPTION
            'Falta public.user_can_edit_section(text). Ejecuta primero db/rbac_roles_v2.sql.';
    END IF;
END $$;

ALTER TABLE public.wildlife_strikes ENABLE ROW LEVEL SECURITY;
GRANT UPDATE ON TABLE public.wildlife_strikes TO authenticated;

-- Retira únicamente las variantes históricas de la política UPDATE. En el
-- repositorio coexistían políticas por rol fijo y por nivel de sección, lo que
-- podía dejar el frontend y la base de datos evaluando permisos diferentes.
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.wildlife_strikes;
DROP POLICY IF EXISTS "Enable update for authorized roles" ON public.wildlife_strikes;
DROP POLICY IF EXISTS "fauna_section_update" ON public.wildlife_strikes;
DROP POLICY IF EXISTS "fauna_lvl_update" ON public.wildlife_strikes;
DROP POLICY IF EXISTS "fauna_record_update" ON public.wildlife_strikes;

CREATE POLICY "fauna_record_update"
    ON public.wildlife_strikes
    FOR UPDATE
    TO authenticated
    USING (public.user_can_edit_section('fauna'))
    WITH CHECK (public.user_can_edit_section('fauna'));

COMMENT ON POLICY "fauna_record_update" ON public.wildlife_strikes IS
    'Permite editar impactos únicamente a usuarios con nivel edit/admin en la sección fauna.';

COMMIT;

-- Verificación posterior sugerida:
-- SELECT policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'wildlife_strikes'
--   AND cmd = 'UPDATE';
