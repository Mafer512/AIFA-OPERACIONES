-- Escritura controlada para Operaciones > Conciliación > Manifiestos.
-- Capturista: INSERT/UPDATE. Editor: INSERT/UPDATE/DELETE.
-- Admin/superadmin: administración completa. Un nivel de sección "read" o
-- una lista de secciones que no incluya "conciliacion" siempre bloquean escritura.

-- La política inferior confía en usuarios_aplicaciones. Cerrar primero el RPC
-- histórico de asignación evita que un usuario autenticado se autoasigne un rol.
CREATE OR REPLACE FUNCTION public.admin_assign_operaciones_access(
    p_user_id uuid,
    p_role text,
    p_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_app_id uuid;
    v_caller_authorized boolean := false;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_app_id
      FROM public.aplicaciones
     WHERE clave = 'OPERACIONES'
     LIMIT 1;
    IF v_app_id IS NULL THEN
        RAISE EXCEPTION 'Aplicación OPERACIONES no existe';
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM public.usuarios_aplicaciones ua
         WHERE ua.usuario_id = auth.uid()
           AND ua.aplicacion_id = v_app_id
           AND ua.estado = 'ACTIVO'
           AND lower(ua.rol) IN ('admin', 'superadmin')
    ) OR EXISTS (
        SELECT 1
          FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()
           AND lower(ur.role) IN ('superuser', 'superadmin')
    )
    INTO v_caller_authorized;

    IF NOT v_caller_authorized THEN
        RAISE EXCEPTION 'Acceso denegado: solo admin/superadmin puede asignar OPERACIONES'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.usuarios_aplicaciones (
        usuario_id, aplicacion_id, rol, permisos, estado
    )
    VALUES (
        p_user_id, v_app_id, p_role, coalesce(p_permissions, '{}'::jsonb), 'ACTIVO'
    )
    ON CONFLICT (usuario_id, aplicacion_id) DO UPDATE
       SET rol = EXCLUDED.rol,
           permisos = EXCLUDED.permisos,
           estado = 'ACTIVO';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_operaciones_access(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_operaciones_access(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.conciliacion_manifiestos_access_level(
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
    v_permissions jsonb := '{}'::jsonb;
    v_allowed_sections jsonb;
    v_section_level text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 'none';
    END IF;

    SELECT lower(coalesce(ua.rol, '')), coalesce(ua.permisos, '{}'::jsonb)
      INTO v_role, v_permissions
      FROM public.usuarios_aplicaciones ua
      JOIN public.aplicaciones app ON app.id = ua.aplicacion_id
     WHERE ua.usuario_id = p_user_id
       AND ua.estado = 'ACTIVO'
       AND app.clave = 'OPERACIONES'
     LIMIT 1;

    IF FOUND THEN
        IF v_role IN ('admin', 'superadmin') THEN
            RETURN 'admin';
        END IF;

        IF v_role NOT IN ('capturista', 'editor') THEN
            RETURN 'none';
        END IF;

        v_allowed_sections := v_permissions -> 'allowed_sections';
        IF jsonb_typeof(v_allowed_sections) = 'array'
           AND jsonb_array_length(v_allowed_sections) > 0
           AND NOT (v_allowed_sections ? 'conciliacion') THEN
            RETURN 'none';
        END IF;

        v_section_level := lower(coalesce(
            v_permissions -> 'section_levels' ->> 'conciliacion',
            ''
        ));
        IF v_section_level IN ('read', 'none') THEN
            RETURN 'none';
        END IF;

        -- El override puede reducir a un editor a captura, pero nunca elevar
        -- a un capturista a permisos destructivos.
        IF v_role = 'editor' AND v_section_level <> 'capture' THEN
            RETURN 'edit';
        END IF;
        RETURN 'capture';
    END IF;

    -- Los roles normales requieren asignación activa a OPERACIONES. Únicamente
    -- el superadministrador global conserva el acceso de contingencia existente.
    IF EXISTS (
        SELECT 1
          FROM public.user_roles ur
         WHERE ur.user_id = p_user_id
           AND lower(ur.role) IN ('superuser', 'superadmin')
    ) THEN
        RETURN 'admin';
    END IF;

    RETURN 'none';
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_manifiestos_access_level(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_manifiestos_access_level(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_conciliacion_portal_reviewer(
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_allowed boolean := false;
BEGIN
    IF p_user_id IS NULL OR to_regclass('public.perfiles') IS NULL THEN
        RETURN false;
    END IF;

    EXECUTE
        'SELECT EXISTS (
             SELECT 1 FROM public.perfiles p
              WHERE p.id = $1
                AND coalesce(p.activo, true)
                AND lower(coalesce(p.role, '''')) IN (''admin'', ''aifa'', ''afac'')
         )'
      INTO v_allowed
      USING p_user_id;
    RETURN v_allowed;
END;
$$;

REVOKE ALL ON FUNCTION public.is_conciliacion_portal_reviewer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conciliacion_portal_reviewer(uuid) TO authenticated;

ALTER TABLE public."Conciliación Manifiestos" ENABLE ROW LEVEL SECURITY;

-- Sustituir las políticas históricas permisivas. Las políticas RLS se combinan
-- con OR; dejarlas activas anularía la restricción por módulo y rol.
DROP POLICY IF EXISTS cm_insert_portal ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_authenticated ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_delete_authenticated ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_insert_portal_owner ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_portal_owner ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_portal_reviewer ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_insert_operaciones_capture ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_update_operaciones_capture ON public."Conciliación Manifiestos";
DROP POLICY IF EXISTS cm_delete_operaciones_manage ON public."Conciliación Manifiestos";

-- El prestador sólo crea y modifica sus propios manifiestos.
CREATE POLICY cm_insert_portal_owner
    ON public."Conciliación Manifiestos"
    FOR INSERT TO authenticated
    WITH CHECK ("_portal_user_id" = auth.uid());

CREATE POLICY cm_update_portal_owner
    ON public."Conciliación Manifiestos"
    FOR UPDATE TO authenticated
    USING ("_portal_user_id" = auth.uid())
    WITH CHECK ("_portal_user_id" = auth.uid());

-- Los revisores AIFA/AFAC conservan el flujo de aprobación del portal.
CREATE POLICY cm_update_portal_reviewer
    ON public."Conciliación Manifiestos"
    FOR UPDATE TO authenticated
    USING (public.is_conciliacion_portal_reviewer(auth.uid()))
    WITH CHECK (public.is_conciliacion_portal_reviewer(auth.uid()));

-- Escritura interna limitada al aplicativo y a la sección Conciliación.
CREATE POLICY cm_insert_operaciones_capture
    ON public."Conciliación Manifiestos"
    FOR INSERT TO authenticated
    WITH CHECK (
        public.conciliacion_manifiestos_access_level(auth.uid())
        IN ('capture', 'edit', 'admin')
    );

CREATE POLICY cm_update_operaciones_capture
    ON public."Conciliación Manifiestos"
    FOR UPDATE TO authenticated
    USING (
        public.conciliacion_manifiestos_access_level(auth.uid())
        IN ('capture', 'edit', 'admin')
    )
    WITH CHECK (
        public.conciliacion_manifiestos_access_level(auth.uid())
        IN ('capture', 'edit', 'admin')
    );

CREATE POLICY cm_delete_operaciones_manage
    ON public."Conciliación Manifiestos"
    FOR DELETE TO authenticated
    USING (
        public.conciliacion_manifiestos_access_level(auth.uid())
        IN ('edit', 'admin')
    );

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public."Conciliación Manifiestos"
    TO authenticated;

COMMENT ON FUNCTION public.conciliacion_manifiestos_access_level(uuid) IS
    'Nivel efectivo de escritura en Operaciones/Conciliación: capture, edit, admin o none.';
