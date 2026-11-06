-- ============================================================================
-- SETP · Permisos para "Editar usuario" y "Eliminar usuario"
--
-- NO crea ninguna tabla. Usa la misma tabla setp_supervisores que ya existe;
-- sólo le da el permiso de editar y eliminar, que hoy no tiene (sólo tiene
-- el de consultar y el de crear). Se corre una sola vez.
--
-- Requiere haber corrido antes db/setp_modulo_completo.sql y
-- db/setp_recorridos_captura.sql.
--
--   1. Editar: corrige No. de empleado, nombre y apellido, o cargo. Si cambia
--      el No. de empleado, sus recorridos se actualizan solos (ON UPDATE
--      CASCADE ya definido en setp_recorridos).
--   2. Eliminar: borra al supervisor. Si tiene recorridos registrados, la base
--      lo impide (ON DELETE RESTRICT ya definido en setp_recorridos).
--
-- En el aplicativo, ambos botones sólo aparecen para superadmin.
-- Sólo agrega permisos a setp_supervisores; no modifica datos. Es idempotente.
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================

DROP POLICY IF EXISTS setp_supervisores_update ON public.setp_supervisores;
CREATE POLICY setp_supervisores_update
    ON public.setp_supervisores
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS setp_supervisores_delete ON public.setp_supervisores;
CREATE POLICY setp_supervisores_delete
    ON public.setp_supervisores
    FOR DELETE TO authenticated
    USING (true);

GRANT UPDATE, DELETE ON public.setp_supervisores TO authenticated;

-- Que el aplicativo vea los cambios de inmediato.
NOTIFY pgrst, 'reload schema';

-- Comprobación: deben salir las políticas de select, insert, update y delete.
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'setp_supervisores'
ORDER BY policyname;
