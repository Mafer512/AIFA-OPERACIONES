-- =============================================================================
-- 071 · Conciliación › Manifiestos: Cierre de Subsecretaría e INFORMATIVO
--       para editor, admin y superadmin
-- (selecciona todo y Run). Se puede volver a correr.
--
-- Hasta 070, cerrar el día y autorizar correcciones de cerrados era sólo de
-- admin/superadmin (o de quien tuviera el permiso suelto). Ahora el editor
-- también: conciliacion_manifiestos_access_level() le da 'edit'.
--   · conciliacion_puede_cerrar_subsecretaria()   → 'admin' o 'edit'
--   · conciliacion_puede_autorizar_correccion()   → 'admin' o 'edit'
-- Los permisos sueltos (conciliacion_cierra_subsecretaria /
-- conciliacion_autoriza_correccion) siguen valiendo para cualquier otro rol.
-- Asignarlos (conciliacion_manifiestos_set_privilegio) sigue siendo de admin.
--
-- Casilla INFORMATIVO: saca el vuelo de los totales, así que la marca o
-- desmarca sólo editor/admin/superadmin (o quien autoriza correcciones). Un
-- capturista la ve, pero no la cambia. Sin sesión (SQL Editor, pg_cron) no se
-- restringe.
-- =============================================================================
BEGIN;

-- 1) Cerrar el día.
CREATE OR REPLACE FUNCTION public.conciliacion_puede_cerrar_subsecretaria()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RETURN false; END IF;
    IF public.conciliacion_manifiestos_access_level(v_uid) IN ('admin', 'edit') THEN RETURN true; END IF;
    RETURN public._conci_tiene_flag_permiso(v_uid, 'conciliacion_cierra_subsecretaria');
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() IS
    'true si QUIEN LLAMA puede realizar el Cierre de Subsecretaría: '
    'editor/admin/superadmin (071), o permissions.conciliacion_cierra_subsecretaria = true. '
    'Sin parámetro de usuario a propósito: nadie sondea privilegios ajenos.';

-- 2) Autorizar correcciones de manifiestos cerrados.
CREATE OR REPLACE FUNCTION public.conciliacion_puede_autorizar_correccion()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RETURN false; END IF;
    IF public.conciliacion_manifiestos_access_level(v_uid) IN ('admin', 'edit') THEN RETURN true; END IF;
    RETURN public._conci_tiene_flag_permiso(v_uid, 'conciliacion_autoriza_correccion');
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_puede_autorizar_correccion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_puede_autorizar_correccion() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_puede_autorizar_correccion() IS
    'true si QUIEN LLAMA puede aplicar/resolver correcciones sobre manifiestos '
    'cerrados: editor/admin/superadmin (071), o '
    'permissions.conciliacion_autoriza_correccion = true.';

-- 3) Quién cambia la casilla INFORMATIVO.
CREATE OR REPLACE FUNCTION public._conci_informativo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL
       OR public.conciliacion_manifiestos_access_level(auth.uid()) IN ('admin', 'edit')
       OR public.conciliacion_puede_autorizar_correccion() THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Sólo editor, admin o superadmin pueden marcar un vuelo como informativo.'
        USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public._conci_informativo_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conci_informativo_guard_upd ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_conci_informativo_guard_upd
    BEFORE UPDATE OF "INFORMATIVO" ON public."Conciliación Manifiestos"
    FOR EACH ROW
    WHEN (NEW."INFORMATIVO" IS DISTINCT FROM OLD."INFORMATIVO")
    EXECUTE FUNCTION public._conci_informativo_guard();

DROP TRIGGER IF EXISTS trg_conci_informativo_guard_ins ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_conci_informativo_guard_ins
    BEFORE INSERT ON public."Conciliación Manifiestos"
    FOR EACH ROW
    WHEN (NEW."INFORMATIVO")
    EXECUTE FUNCTION public._conci_informativo_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Comprobación (no toca nada): quién de OPERACIONES puede cerrar y autorizar.
SELECT u.email,
       public.conciliacion_manifiestos_access_level(u.id) AS nivel,
       public.conciliacion_manifiestos_access_level(u.id) IN ('admin', 'edit')
           OR public._conci_tiene_flag_permiso(u.id, 'conciliacion_cierra_subsecretaria') AS cierra,
       public.conciliacion_manifiestos_access_level(u.id) IN ('admin', 'edit')
           OR public._conci_tiene_flag_permiso(u.id, 'conciliacion_autoriza_correccion') AS autoriza
  FROM auth.users u
 WHERE public.conciliacion_manifiestos_access_level(u.id) <> 'none'
 ORDER BY nivel, u.email;
