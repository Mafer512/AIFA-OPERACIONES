-- CAUSA REAL del "muestra datos pero no guarda": en 019 las políticas de
-- escritura usaban USING (auth.role() = 'authenticated'). En Supabase actual
-- `auth.role()` está DEPRECADO y suele devolver NULL → la expresión es falsa →
-- UPDATE/INSERT/DELETE afectan 0 filas. La política SELECT usaba USING (true),
-- por eso los datos SÍ se mostraban pero no se podían guardar.
--
-- Las políticas ya están restringidas a `TO authenticated`, así que basta con
-- USING (true) / WITH CHECK (true): sólo usuarios autenticados escriben.

ALTER TABLE public."Conciliación Manifiestos" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cm_insert_authenticated ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_authenticated ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_delete_authenticated ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_select_authenticated ON public."Conciliación Manifiestos";

CREATE POLICY cm_select_authenticated
    ON public."Conciliación Manifiestos"
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY cm_insert_authenticated
    ON public."Conciliación Manifiestos"
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY cm_update_authenticated
    ON public."Conciliación Manifiestos"
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY cm_delete_authenticated
    ON public."Conciliación Manifiestos"
    FOR DELETE TO authenticated
    USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public."Conciliación Manifiestos"
    TO authenticated;
