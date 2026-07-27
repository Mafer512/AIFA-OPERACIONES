-- ============================================================================
-- FIX: inicio de sesión bloqueado en AIFA Operaciones (2026-07-27)
-- Ejecutar en: Supabase → SQL Editor.
-- ----------------------------------------------------------------------------
-- CAUSA RAÍZ
--   migrations/20260717_operaciones_access.sql activó RLS en
--   public.usuarios_aplicaciones y le dio política de SELECT, pero NUNCA
--   agregó una política de SELECT para public.aplicaciones (el catálogo
--   de aplicativos MHR/OPERACIONES).
--
--   getOperacionesAccess() en el cliente (script.js) hace:
--     select ... from usuarios_aplicaciones
--     .select('rol, permisos, estado, aplicaciones!inner(clave)')
--
--   Ese !inner necesita LEER public.aplicaciones. Si esa tabla tiene RLS
--   activo sin políticas (comportamiento por defecto de Postgres: RLS activo
--   + 0 políticas = nadie puede leer nada), el JOIN falla o devuelve 0 filas
--   para TODO usuario autenticado que no sea superadmin/superuser, y el login
--   se rechaza con "Tu usuario no tiene acceso asignado al aplicativo AIFA
--   Operaciones" aunque el usuario y la contraseña sean correctos.
--
-- FIX (solo lectura, aditivo, no toca escritura ni otras políticas)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'aplicaciones') then
    execute 'alter table public.aplicaciones enable row level security';
    execute 'drop policy if exists "aplicaciones_read_authenticated" on public.aplicaciones';
    execute 'create policy "aplicaciones_read_authenticated" on public.aplicaciones for select to authenticated using (true)';
  else
    raise notice 'public.aplicaciones no existe en este proyecto: omitido.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- DIAGNÓSTICO: ejecuta esto para ver si TU usuario tiene acceso asignado.
-- Reemplaza el correo por el que usas para iniciar sesión.
-- ----------------------------------------------------------------------------
-- select u.id, u.email,
--        ur.role as rol_global,
--        ua.estado as estado_operaciones, a.clave as app
-- from auth.users u
-- left join public.user_roles ur on ur.user_id = u.id
-- left join public.usuarios_aplicaciones ua on ua.usuario_id = u.id
-- left join public.aplicaciones a on a.id = ua.aplicacion_id and a.clave = 'OPERACIONES'
-- where u.email = 'TU_CORREO_AQUI';
--
-- Si "estado_operaciones" sale NULL o distinto de 'ACTIVO', y "rol_global" no
-- es 'admin'/'superadmin'/'superuser', ese usuario seguirá sin poder entrar
-- aunque este fix ya esté aplicado: hace falta darle de alta explícitamente.
--
-- ALTA MANUAL (solo si el diagnóstico de arriba muestra que falta):
-- select public.admin_assign_operaciones_access(
--   'UUID-DEL-USUARIO'::uuid,
--   'admin',              -- o el rol que corresponda
--   '{}'::jsonb
-- );
-- Nota: admin_assign_operaciones_access ya valida que quien la ejecuta sea
-- admin/superadmin (ver migrations/20260717_operaciones_access.sql).
-- ============================================================================
