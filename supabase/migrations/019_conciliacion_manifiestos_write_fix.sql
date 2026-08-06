-- URGENTE (producción): restaura el guardado en Operaciones > Conciliación >
-- Manifiestos. Las políticas basadas en función de la migración 016
-- (conciliacion_manifiestos_access_level) siguen bloqueando el UPDATE/INSERT de
-- usuarios legítimos porque dependen de almacenes de permisos que no coinciden
-- con lo que evalúa el cliente. El resultado: la fila muestra los datos pero el
-- UPDATE afecta 0 filas y la captura se pierde al refrescar.
--
-- Esta migración vuelve al patrón permisivo-autenticado que usa el resto del
-- repo (ver 003: `auth.role() = 'authenticated'`) y que YA funcionaba antes de
-- 016. La restricción por rol (capturista/editor/admin) la sigue aplicando el
-- cliente (js: _conciCanCurrentUserEdit / _conciCanCurrentUserManage) y el
-- acceso al aplicativo lo controla el login (usuarios_aplicaciones / OPERACIONES).

ALTER TABLE public."Conciliación Manifiestos" ENABLE ROW LEVEL SECURITY;

-- Elimina TODAS las políticas de escritura conocidas (permisivas e históricas y
-- las basadas en función de 016) para partir de un estado limpio y predecible.
DROP POLICY IF EXISTS cm_insert_portal              ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_authenticated       ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_delete_authenticated       ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_insert_authenticated       ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_insert_portal_owner        ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_portal_owner        ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_portal_reviewer     ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_insert_operaciones_capture ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_operaciones_capture ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_delete_operaciones_manage  ON public."Conciliación Manifiestos";

-- Escritura para cualquier usuario autenticado (mismo patrón que el resto de
-- tablas del proyecto). El control de rol/sección lo hace la interfaz.
CREATE POLICY cm_insert_authenticated
    ON public."Conciliación Manifiestos"
    FOR INSERT TO authenticated
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY cm_update_authenticated
    ON public."Conciliación Manifiestos"
    FOR UPDATE TO authenticated
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY cm_delete_authenticated
    ON public."Conciliación Manifiestos"
    FOR DELETE TO authenticated
    USING (auth.role() = 'authenticated');

-- Lectura: asegurar que exista una política SELECT permisiva para authenticated.
DROP POLICY IF EXISTS cm_select_authenticated ON public."Conciliación Manifiestos";
CREATE POLICY cm_select_authenticated
    ON public."Conciliación Manifiestos"
    FOR SELECT TO authenticated
    USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public."Conciliación Manifiestos"
    TO authenticated;
