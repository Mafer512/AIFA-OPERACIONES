-- =====================================================================
-- 065 · Rol "Director General" (director_general)
-- (selecciona todo y Run). Correr ANTES de crear o asignar el rol desde
-- Administración de Usuarios; sin esto la base responde "Rol inválido".
--
-- Qué hace: SOLO AMPLÍA la lista de roles válidos con 'director_general'
-- en las cuatro funciones que la validan. Cada función es copia exacta
-- de su versión vigente (db/rbac_roles_v2.sql) con el rol agregado; no
-- toca tablas, columnas, triggers, políticas ni usuarios existentes.
--   1. _validate_user_role()        (trigger trg_validate_user_role)
--   2. admin_update_user_role()     (cambiar rol desde la lista)
--   3. admin_create_user_role()     (alta de usuario)
--   4. assign_user_role()           (RPC legacy)
--
-- Nivel de escritura: user_access_level() ya resuelve cualquier rol no
-- listado como 'read', así que Director General queda en SOLO LECTURA en
-- los módulos que se le asignen en "Vistas" (section_levels puede
-- afinarlo por módulo, igual que con los demás roles). No es admin: no
-- administra usuarios ni pasa las políticas 'admin','superadmin'.
--
-- Reversa: volver a correr las mismas funciones de db/rbac_roles_v2.sql
-- (secciones 2–5). Los usuarios que ya tengan el rol lo conservan porque
-- _validate_user_role acepta cualquier rol que ya exista en user_roles.
-- =====================================================================

BEGIN;

-- 1. Validación del trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._validate_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _global_roles TEXT[] := ARRAY[
        -- Roles principales v2
        'admin', 'superadmin', 'editor', 'capturista', 'lector',
        'director_general',
        -- Legacy / especiales (compatibilidad)
        'viewer', 'colab_viewer', 'colab_editor',
        'control_fauna', 'servicio_medico'
    ];
BEGIN
    -- Roles globales: siempre válidos
    IF NEW.role = ANY(_global_roles) THEN
        RETURN NEW;
    END IF;

    -- Roles de área: debe existir en la tabla areas como clave activa
    IF EXISTS (
        SELECT 1 FROM public.areas
        WHERE clave = NEW.role
          AND estado = 'ACTIVO'
    ) THEN
        RETURN NEW;
    END IF;

    -- También aceptar claves legacy de nombre-rol por compatibilidad
    IF NEW.role IN ('operacion','administracion','planeacion','comercial','seguridad_op','transparencia','calidad') THEN
        RETURN NEW;
    END IF;

    -- Grandfather: cualquier rol que YA exista en la tabla se sigue aceptando
    -- (blinda datos de producción ante valores no contemplados en esta lista).
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = NEW.role) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Rol no válido: %', NEW.role;
END;
$$;

-- 2. Cambiar rol ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
    p_user_id   UUID,
    p_role      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_role TEXT;
    _valid      BOOLEAN;
BEGIN
    SELECT role INTO caller_role
    FROM public.user_roles
    WHERE user_id = auth.uid();

    IF caller_role IS NULL OR caller_role NOT IN ('admin','superadmin') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Acceso denegado: solo admin/superadmin puede cambiar roles');
    END IF;

    -- Validar rol (globales v2 + legacy + clave de área activa)
    _valid := p_role IN (
        'admin','superadmin','editor','capturista','lector','director_general',
        'viewer','colab_viewer','colab_editor','control_fauna','servicio_medico'
    ) OR EXISTS (SELECT 1 FROM public.areas WHERE clave = p_role AND estado = 'ACTIVO');

    IF NOT _valid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Rol inválido: ' || p_role);
    END IF;

    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES (p_user_id, p_role, '{}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

    RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_role(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_user_role(UUID, TEXT) TO authenticated;

-- 3. Alta de usuario ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_user_role(
    p_user_id          UUID,
    p_role             TEXT,
    p_dir_id           TEXT    DEFAULT NULL,
    p_subdir_id        TEXT    DEFAULT NULL,
    p_allowed_sections TEXT[]  DEFAULT NULL,
    p_section_levels   JSONB   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_role TEXT;
    perms       JSONB;
    _valid      BOOLEAN;
BEGIN
    SELECT role INTO caller_role
    FROM public.user_roles
    WHERE user_id = auth.uid();

    IF caller_role IS NULL OR caller_role NOT IN ('admin','superadmin') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Acceso denegado: solo admin/superadmin puede crear roles');
    END IF;

    _valid := p_role IN (
        'admin','superadmin','editor','capturista','lector','director_general',
        'viewer','colab_viewer','colab_editor','control_fauna','servicio_medico'
    ) OR EXISTS (SELECT 1 FROM public.areas WHERE clave = p_role AND estado = 'ACTIVO');

    IF NOT _valid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Rol inválido: ' || p_role);
    END IF;

    perms := jsonb_build_object('estado', 'ACTIVO');
    IF p_dir_id    IS NOT NULL AND p_dir_id    <> '' THEN perms := perms || jsonb_build_object('direccion_id',    p_dir_id);    END IF;
    IF p_subdir_id IS NOT NULL AND p_subdir_id <> '' THEN perms := perms || jsonb_build_object('subdireccion_id', p_subdir_id); END IF;
    IF p_allowed_sections IS NOT NULL THEN
        perms := perms || jsonb_build_object('allowed_sections', to_jsonb(p_allowed_sections));
    END IF;
    IF p_section_levels IS NOT NULL AND p_section_levels <> '{}'::jsonb THEN
        perms := perms || jsonb_build_object('section_levels', p_section_levels);
    END IF;

    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES (p_user_id, p_role, perms)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

    RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_user_role(UUID, TEXT, TEXT, TEXT, TEXT[], JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_create_user_role(UUID, TEXT, TEXT, TEXT, TEXT[], JSONB) TO authenticated;

-- 4. RPC legacy ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_user_role(
    p_user_id uuid,
    p_role    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _caller TEXT;
BEGIN
    SELECT role INTO _caller FROM public.user_roles WHERE user_id = auth.uid();
    IF _caller IS NULL OR _caller NOT IN ('admin','superadmin') THEN
        RAISE EXCEPTION 'No autorizado: solo administradores pueden asignar roles';
    END IF;

    IF NOT (p_role IN (
        'admin','superadmin','editor','capturista','lector','director_general',
        'viewer','colab_viewer','colab_editor','control_fauna','servicio_medico'
    ) OR EXISTS (SELECT 1 FROM public.areas WHERE clave = p_role AND estado = 'ACTIVO')) THEN
        RAISE EXCEPTION 'Rol no válido: %', p_role;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_user_role(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.assign_user_role(uuid, text) TO authenticated;

COMMIT;

-- Verificación: las cuatro funciones deben decir "acepta director_general = true".
SELECT p.proname AS funcion,
       position('director_general' IN pg_get_functiondef(p.oid)) > 0 AS "acepta director_general"
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('_validate_user_role','admin_update_user_role','admin_create_user_role','assign_user_role')
 ORDER BY 1;
