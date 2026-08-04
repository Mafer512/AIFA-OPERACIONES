-- Corrige el guardado (auto-save) de Operaciones > Conciliación > Manifiestos.
--
-- PROBLEMA (introducido en 016): la política de UPDATE/INSERT llamaba a
-- public.conciliacion_manifiestos_access_level(), que decidía el permiso de
-- ESCRITURA leyendo allowed_sections / section_levels desde
--   usuarios_aplicaciones.permisos
-- mientras que el CLIENTE decide quién puede editar leyendo esos mismos campos
-- desde OTRA tabla:
--   user_roles.permissions  (js/data-manager.js, refreshUserPermissionsFromServer)
-- Cuando ambos almacenes no coinciden (lo habitual), la función devolvía 'none'
-- y el UPDATE afectaba 0 filas SIN error → la fila se quedaba "Pendiente de
-- guardar". Por eso la tabla mostraba los datos pero no guardaba los cambios.
--
-- SOLUCIÓN: la escritura del servidor se basa en (a) la frontera del aplicativo
-- (has_operaciones_access) y (b) el ROL de escritura tomado de CUALQUIERA de los
-- dos almacenes (usuarios_aplicaciones.rol y user_roles.role). Se elimina el
-- sub-filtrado por allowed_sections/section_levels del lado servidor (frágil y
-- desincronizado); el nivel por módulo lo sigue aplicando el cliente. Las
-- políticas RLS de 016 no cambian: siguen llamando a esta misma función.

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
    v_app_role  text;
    v_glob_role text;
    v_rank      int;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 'none';
    END IF;

    -- Frontera del aplicativo: sólo usuarios con acceso activo a OPERACIONES
    -- (o superadministrador global) pueden escribir en el módulo.
    IF NOT public.has_operaciones_access(p_user_id) THEN
        RETURN 'none';
    END IF;

    -- Rol asignado en el aplicativo OPERACIONES.
    SELECT ua.rol
      INTO v_app_role
      FROM public.usuarios_aplicaciones ua
      JOIN public.aplicaciones app ON app.id = ua.aplicacion_id
     WHERE ua.usuario_id = p_user_id
       AND ua.estado = 'ACTIVO'
       AND app.clave = 'OPERACIONES'
     LIMIT 1;

    -- Rol global (RBAC v2) que también consulta el cliente para habilitar edición.
    SELECT ur.role
      INTO v_glob_role
      FROM public.user_roles ur
     WHERE ur.user_id = p_user_id
     LIMIT 1;

    -- El nivel efectivo es el mayor de ambos orígenes: así el guardado del
    -- servidor coincide con la habilitación de edición del cliente sin importar
    -- en cuál de los dos almacenes viva el rol de escritura del usuario.
    v_rank := greatest(
        CASE lower(coalesce(v_app_role, ''))
            WHEN 'superadmin' THEN 3
            WHEN 'superuser'  THEN 3
            WHEN 'admin'      THEN 3
            WHEN 'editor'     THEN 2
            WHEN 'capturista' THEN 1
            ELSE 0
        END,
        CASE lower(coalesce(v_glob_role, ''))
            WHEN 'superadmin' THEN 3
            WHEN 'superuser'  THEN 3
            WHEN 'admin'      THEN 3
            WHEN 'editor'     THEN 2
            WHEN 'capturista' THEN 1
            ELSE 0
        END
    );

    RETURN CASE v_rank
        WHEN 3 THEN 'admin'
        WHEN 2 THEN 'edit'
        WHEN 1 THEN 'capture'
        ELSE 'none'
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_manifiestos_access_level(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_manifiestos_access_level(uuid) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_manifiestos_access_level(uuid) IS
    'Nivel efectivo de escritura en Operaciones/Conciliación (capture|edit|admin|none). '
    'Frontera: has_operaciones_access. Rol = máximo entre usuarios_aplicaciones.rol y user_roles.role. '
    'El nivel por módulo (section_levels) lo aplica el cliente.';
