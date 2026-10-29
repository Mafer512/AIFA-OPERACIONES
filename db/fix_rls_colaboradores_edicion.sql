-- ============================================================================
-- La ficha se guardaba "sin error" y no se escribía nada
--
-- Con RLS activo, un UPDATE que no pasa la política no falla: afecta cero
-- filas y PostgREST responde 200 sin decir nada. Desde la aplicación se ve
-- como "capturé la fecha de baja y no se guardó", aunque la columna exista y
-- el usuario tenga permiso de edición en la interfaz.
--
-- Dos cosas lo provocan, y las dos se corrigen aquí:
--
--   1. is_colab_editor() comparaba el rol contra una lista corta y con un
--      normalizado a medias: 'Super Admin' se convertía en 'super_admin', que
--      no estaba en la lista, así que el usuario quedaba fuera. Además leía
--      UNA fila de user_roles con LIMIT 1 y sin ORDER BY: con más de una fila
--      podía tomar justo la que no era.
--
--   2. La tabla puede tener RLS habilitado y quedarse sin política de UPDATE
--      (o con una vieja que apunta a otra función). Sin política, ningún
--      UPDATE pasa y nadie se entera.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- Cómo correrlo: Supabase → SQL Editor → pegar → Run.
-- ============================================================================

-- ── 1. Antes de tocar nada: qué hay hoy ─────────────────────────────────────
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'agenda_2026'
ORDER BY cmd, policyname;

-- ── 2. Quién es editor del directorio ───────────────────────────────────────
-- Se compara el rol sin espacios, guiones ni mayúsculas, así que da igual si
-- está escrito 'Superadmin', 'super admin', 'SUPER_ADMIN' o 'Colab Editor'.
-- Y basta con que UNA de las filas del usuario tenga un rol con permiso.
--
-- El rol se busca en los dos lugares de donde la aplicación lo toma:
--   · usuarios_aplicaciones (rol en el aplicativo OPERACIONES, acceso ACTIVO):
--     es lo que lee el inicio de sesión y lo que habilita "Editar" en la ficha.
--   · user_roles (rol global), para administradores de todo el sistema.
-- Si sólo se miraba user_roles, quien era editor en OPERACIONES veía el botón
-- de guardar y la base le respondía "sin permiso" (fotos, INE, licencia…).
--
-- Esta es la ÚNICA definición de la función: los scripts de buckets la exigen
-- en lugar de redefinirla, para que correrlos no regrese la versión vieja.
CREATE OR REPLACE FUNCTION public.is_colab_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND regexp_replace(lower(coalesce(role, '')), '[^a-z0-9]', '', 'g') IN (
              'admin',
              'superadmin',
              'colabeditor',
              'colabed',
              'colaboradoreditor',
              'colaboradored',
              'colaboradoredit'
          )
    ) OR EXISTS (
        SELECT 1
        FROM public.usuarios_aplicaciones ua
        JOIN public.aplicaciones app ON app.id = ua.aplicacion_id
        WHERE ua.usuario_id = auth.uid()
          AND ua.estado = 'ACTIVO'
          AND app.clave = 'OPERACIONES'
          AND regexp_replace(lower(coalesce(ua.rol, '')), '[^a-z0-9]', '', 'g') IN (
              'admin',
              'superadmin',
              'colabeditor',
              'colabed',
              'colaboradoreditor',
              'colaboradored',
              'colaboradoredit'
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_colab_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_colab_editor() TO authenticated;

-- Si en tu instalación el rol general 'editor' también debe poder editar el
-- directorio, agrega 'editor' a la lista de arriba y vuelve a correr el script.

-- ── 3. Políticas de agenda_2026, sin duplicados ni versiones viejas ─────────
ALTER TABLE public.agenda_2026 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agenda_2026: lectura roles colab"        ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026: lectura autenticados"       ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026: lectura todos autenticados" ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026: edicion colab_editor"       ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_select_authenticated"        ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_insert_colab_editor"         ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_update_colab_editor"         ON public.agenda_2026;
DROP POLICY IF EXISTS "agenda_2026_delete_colab_editor"         ON public.agenda_2026;

CREATE POLICY "agenda_2026_select_authenticated"
    ON public.agenda_2026 FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "agenda_2026_insert_colab_editor"
    ON public.agenda_2026 FOR INSERT TO authenticated
    WITH CHECK (public.is_colab_editor());

CREATE POLICY "agenda_2026_update_colab_editor"
    ON public.agenda_2026 FOR UPDATE TO authenticated
    USING (public.is_colab_editor())
    WITH CHECK (public.is_colab_editor());

CREATE POLICY "agenda_2026_delete_colab_editor"
    ON public.agenda_2026 FOR DELETE TO authenticated
    USING (public.is_colab_editor());

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
-- (a) Tu rol tal como está guardado y cómo queda al normalizarlo, en los dos
--     lugares. En el SQL Editor no hay sesión: cambia el correo por el tuyo.
SELECT 'user_roles' AS origen, u.email, ur.role AS rol_guardado,
       regexp_replace(lower(coalesce(ur.role, '')), '[^a-z0-9]', '', 'g') AS rol_normalizado
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id
WHERE u.email = 'tu_correo@ejemplo.com'
UNION ALL
SELECT 'usuarios_aplicaciones (' || ua.estado || ')', u.email, ua.rol,
       regexp_replace(lower(coalesce(ua.rol, '')), '[^a-z0-9]', '', 'g')
FROM auth.users u
JOIN public.usuarios_aplicaciones ua ON ua.usuario_id = u.id
JOIN public.aplicaciones app ON app.id = ua.aplicacion_id AND app.clave = 'OPERACIONES'
WHERE u.email = 'tu_correo@ejemplo.com';

-- (b) Con esto en true, la aplicación ya puede escribir. En el SQL Editor
--     auth.uid() suele venir vacío (no hay sesión de usuario), así que lo
--     definitivo es probar el guardado desde la ficha.
SELECT public.is_colab_editor() AS puedo_editar_el_directorio;

-- (c) Las políticas que quedaron.
SELECT policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'agenda_2026'
ORDER BY cmd, policyname;

-- (d) Nadie debe tener políticas RESTRICTIVE aquí: una sola bloquea todo lo
--     demás. Si esta consulta devuelve filas, hay que revisarlas.
--     (pg_policies.permissive es texto: 'PERMISSIVE' o 'RESTRICTIVE'.)
SELECT policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'agenda_2026'
  AND upper(permissive) <> 'PERMISSIVE';
