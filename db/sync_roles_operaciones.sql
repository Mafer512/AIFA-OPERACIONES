-- ============================================================================
-- Iguala el acceso a OPERACIONES con lo que muestra el panel de usuarios
--
-- El panel guarda rol y vistas en user_roles, pero el inicio de sesión los lee
-- de usuarios_aplicaciones (OPERACIONES). Hasta el 2026-10-21 el panel no
-- copiaba los cambios allá, así que hacer admin a alguien o darle Colaboradores
-- no llegaba a su sesión. Desde entonces el panel sincroniza al guardar; este
-- script corrige a los usuarios que quedaron desfasados antes.
--
-- Sólo toca filas de OPERACIONES que ya existen: no da acceso a nadie nuevo.
-- Los permisos se combinan (lo del panel manda; se conservan llaves extra).
-- Idempotente. Supabase → SQL Editor → pegar → Run.
-- ============================================================================

-- 1. Quiénes están desfasados (antes de corregir).
SELECT u.email,
       ur.role                              AS rol_en_panel,
       ua.rol                               AS rol_en_sesion,
       ur.permissions -> 'allowed_sections' AS vistas_en_panel,
       ua.permisos    -> 'allowed_sections' AS vistas_en_sesion
FROM public.usuarios_aplicaciones ua
JOIN public.aplicaciones app ON app.id = ua.aplicacion_id AND app.clave = 'OPERACIONES'
JOIN public.user_roles ur    ON ur.user_id = ua.usuario_id
JOIN auth.users u            ON u.id = ua.usuario_id
WHERE ur.role IS NOT NULL
  AND (ua.rol IS DISTINCT FROM ur.role
       OR coalesce(ua.permisos, '{}'::jsonb) || coalesce(ur.permissions, '{}'::jsonb)
          IS DISTINCT FROM coalesce(ua.permisos, '{}'::jsonb))
ORDER BY u.email;

-- 2. Igualarlos.
UPDATE public.usuarios_aplicaciones ua
   SET rol      = ur.role,
       permisos = coalesce(ua.permisos, '{}'::jsonb) || coalesce(ur.permissions, '{}'::jsonb)
  FROM public.user_roles ur, public.aplicaciones app
 WHERE ur.user_id  = ua.usuario_id
   AND app.id      = ua.aplicacion_id
   AND app.clave   = 'OPERACIONES'
   AND ur.role IS NOT NULL
   AND (ua.rol IS DISTINCT FROM ur.role
        OR coalesce(ua.permisos, '{}'::jsonb) || coalesce(ur.permissions, '{}'::jsonb)
           IS DISTINCT FROM coalesce(ua.permisos, '{}'::jsonb));

-- 3. Comprobación: debe regresar cero filas.
SELECT u.email, ur.role AS rol_en_panel, ua.rol AS rol_en_sesion
FROM public.usuarios_aplicaciones ua
JOIN public.aplicaciones app ON app.id = ua.aplicacion_id AND app.clave = 'OPERACIONES'
JOIN public.user_roles ur    ON ur.user_id = ua.usuario_id
JOIN auth.users u            ON u.id = ua.usuario_id
WHERE ur.role IS NOT NULL AND ua.rol IS DISTINCT FROM ur.role;
