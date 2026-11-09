-- ============================================================================
-- SEGUIMIENTO · Cada quien ve y trabaja sólo las tareas de su área
--
-- A cada cuenta de public.seguimiento_acceso se le asigna su área:
--
--   sin área (subdireccion NULL)        → toda la Dirección (Director, staff)
--   subdirección, sin gerencia          → subdirector: todo lo de su subdirección,
--                                          de cualquiera de sus gerencias
--   subdirección + gerencia             → gerente: lo de su gerencia y lo que es
--                                          de toda su subdirección (sin gerencia);
--                                          nada de las otras gerencias
--
-- Y el rol sigue diciendo qué puede hacer dentro de su área:
--   admin  → todo, en toda la Dirección, y administra el acceso
--   editor → crea, edita, completa y comenta
--   lector → consulta y comenta
--
-- La regla vive aquí (RLS), no sólo en la página: fuera de su área no lee, no
-- crea, no edita, no comenta ni sube evidencias, aunque lo intente por la API.
--
-- Además: seguimiento_cuentas(), para que el admin busque a quién darle acceso
-- entre las cuentas de la plataforma en lugar de escribir el usuario a ciegas.
--
-- Requiere db/create_seguimiento.sql. Es idempotente.
-- Supabase → SQL Editor → pegar → Run.
-- ============================================================================

BEGIN;

-- ── 1. El área de cada cuenta ────────────────────────────────────────────────
ALTER TABLE public.seguimiento_acceso ADD COLUMN IF NOT EXISTS subdireccion text;
ALTER TABLE public.seguimiento_acceso ADD COLUMN IF NOT EXISTS gerencia text;

ALTER TABLE public.seguimiento_acceso DROP CONSTRAINT IF EXISTS seguimiento_acceso_subdir_chk;
ALTER TABLE public.seguimiento_acceso ADD CONSTRAINT seguimiento_acceso_subdir_chk
  CHECK (subdireccion IS NULL OR subdireccion IN ('DO', 'SSO', 'SSA', 'SSC', 'SI', 'SGE'));
-- Una gerencia siempre va dentro de una subdirección.
ALTER TABLE public.seguimiento_acceso DROP CONSTRAINT IF EXISTS seguimiento_acceso_gerencia_chk;
ALTER TABLE public.seguimiento_acceso ADD CONSTRAINT seguimiento_acceso_gerencia_chk
  CHECK (gerencia IS NULL OR (subdireccion IS NOT NULL AND length(btrim(gerencia)) > 0));

COMMENT ON COLUMN public.seguimiento_acceso.subdireccion IS
  'Subdirección de la cuenta. NULL = toda la Dirección.';
COMMENT ON COLUMN public.seguimiento_acceso.gerencia IS
  'Gerencia de la cuenta dentro de su subdirección. NULL = toda la subdirección (subdirector).';

-- ── 2. ¿Esta área le toca a quien está conectado? ───────────────────────────
CREATE OR REPLACE FUNCTION public.seguimiento_en_alcance(p_subdireccion text, p_gerencia text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN a.rol = 'admin'                 THEN true
      WHEN a.subdireccion IS NULL          THEN true          -- toda la Dirección
      WHEN a.subdireccion <> p_subdireccion THEN false
      WHEN a.gerencia IS NULL              THEN true          -- subdirector
      -- Gerente: su gerencia, o lo que es de toda la subdirección.
      ELSE nullif(btrim(coalesce(p_gerencia, '')), '') IS NULL
           OR lower(btrim(p_gerencia)) = lower(btrim(a.gerencia))
    END
    FROM public.seguimiento_acceso a
    WHERE a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    LIMIT 1
  ), false);
$$;

-- Lo mismo, a partir de una tarea (para comentarios, bitácora y evidencias).
CREATE OR REPLACE FUNCTION public.seguimiento_tarea_en_alcance(p_tarea uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT public.seguimiento_en_alcance(t.subdireccion, t.gerencia)
    FROM public.seguimiento_tareas t
    WHERE t.id = p_tarea
  ), false);
$$;

-- Versión que recibe texto: la ruta de una evidencia empieza con el id de la tarea.
CREATE OR REPLACE FUNCTION public.seguimiento_ruta_en_alcance(p_ruta text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text := split_part(coalesce(p_ruta, ''), '/', 1);
BEGIN
  IF v_id !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  RETURN public.seguimiento_tarea_en_alcance(v_id::uuid);
END;
$$;

REVOKE ALL ON FUNCTION public.seguimiento_en_alcance(text, text) FROM public;
REVOKE ALL ON FUNCTION public.seguimiento_tarea_en_alcance(uuid) FROM public;
REVOKE ALL ON FUNCTION public.seguimiento_ruta_en_alcance(text) FROM public;
GRANT EXECUTE ON FUNCTION public.seguimiento_en_alcance(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seguimiento_tarea_en_alcance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seguimiento_ruta_en_alcance(text) TO authenticated;

-- ── 3. Tareas ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "seguimiento_tareas_select" ON public.seguimiento_tareas;
DROP POLICY IF EXISTS "seguimiento_tareas_insert" ON public.seguimiento_tareas;
DROP POLICY IF EXISTS "seguimiento_tareas_update" ON public.seguimiento_tareas;
CREATE POLICY "seguimiento_tareas_select" ON public.seguimiento_tareas
  FOR SELECT TO authenticated
  USING (public.seguimiento_puede_ver() AND public.seguimiento_en_alcance(subdireccion, gerencia));
CREATE POLICY "seguimiento_tareas_insert" ON public.seguimiento_tareas
  FOR INSERT TO authenticated
  WITH CHECK (public.seguimiento_puede_editar() AND public.seguimiento_en_alcance(subdireccion, gerencia));
-- USING revisa la tarea como estaba; WITH CHECK, como queda: tampoco se puede
-- «mandar» una tarea a otra área para sacarla del propio alcance.
CREATE POLICY "seguimiento_tareas_update" ON public.seguimiento_tareas
  FOR UPDATE TO authenticated
  USING (public.seguimiento_puede_editar() AND public.seguimiento_en_alcance(subdireccion, gerencia))
  WITH CHECK (public.seguimiento_puede_editar() AND public.seguimiento_en_alcance(subdireccion, gerencia));

-- ── 4. Comentarios y bitácora: sólo de tareas del área ─────────────────────
DROP POLICY IF EXISTS "seguimiento_comentarios_select" ON public.seguimiento_comentarios;
DROP POLICY IF EXISTS "seguimiento_comentarios_insert" ON public.seguimiento_comentarios;
CREATE POLICY "seguimiento_comentarios_select" ON public.seguimiento_comentarios
  FOR SELECT TO authenticated
  USING (public.seguimiento_puede_ver() AND public.seguimiento_tarea_en_alcance(tarea_id));
CREATE POLICY "seguimiento_comentarios_insert" ON public.seguimiento_comentarios
  FOR INSERT TO authenticated
  WITH CHECK (public.seguimiento_puede_ver() AND public.seguimiento_tarea_en_alcance(tarea_id)
              AND autor_email = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "seguimiento_actividad_select" ON public.seguimiento_actividad;
DROP POLICY IF EXISTS "seguimiento_actividad_insert" ON public.seguimiento_actividad;
CREATE POLICY "seguimiento_actividad_select" ON public.seguimiento_actividad
  FOR SELECT TO authenticated
  USING (public.seguimiento_puede_ver() AND public.seguimiento_tarea_en_alcance(tarea_id));
CREATE POLICY "seguimiento_actividad_insert" ON public.seguimiento_actividad
  FOR INSERT TO authenticated
  WITH CHECK (public.seguimiento_puede_ver() AND public.seguimiento_tarea_en_alcance(tarea_id));

-- ── 5. Evidencias: la ruta empieza con el id de la tarea ────────────────────
DROP POLICY IF EXISTS "seguimiento_evidencias_select" ON storage.objects;
DROP POLICY IF EXISTS "seguimiento_evidencias_insert" ON storage.objects;
DROP POLICY IF EXISTS "seguimiento_evidencias_delete" ON storage.objects;
CREATE POLICY "seguimiento_evidencias_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'seguimiento-evidencias' AND public.seguimiento_puede_ver()
         AND public.seguimiento_ruta_en_alcance(name));
CREATE POLICY "seguimiento_evidencias_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'seguimiento-evidencias'
    AND public.seguimiento_puede_editar()
    AND name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{6,64}\.(pdf|jpg|png)$'
    AND public.seguimiento_ruta_en_alcance(name)
  );
CREATE POLICY "seguimiento_evidencias_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'seguimiento-evidencias' AND public.seguimiento_puede_editar()
         AND public.seguimiento_ruta_en_alcance(name));

-- ── 6. Cuentas de la plataforma, para buscarlas al dar acceso ───────────────
-- Sólo un admin de Seguimiento puede llamarla. Devuelve las cuentas con acceso a
-- AIFA Operaciones (las mismas que lista el panel de usuarios) con su nombre.
CREATE OR REPLACE FUNCTION public.seguimiento_cuentas()
RETURNS TABLE (email text, nombre text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT lower(u.email)::text,
         coalesce(nullif(btrim(p.full_name), ''),
                  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(btrim(u.raw_user_meta_data ->> 'name'), ''))::text
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE public.seguimiento_es_admin()
    AND u.email IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.usuarios_aplicaciones ua
              JOIN public.aplicaciones a ON a.id = ua.aplicacion_id
              WHERE ua.usuario_id = u.id AND a.clave = 'OPERACIONES' AND ua.estado = 'ACTIVO')
      OR EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = u.id AND lower(ur.role) IN ('superuser', 'superadmin'))
    )
  ORDER BY 2 NULLS LAST, 1;
$$;
REVOKE ALL ON FUNCTION public.seguimiento_cuentas() FROM public;
GRANT EXECUTE ON FUNCTION public.seguimiento_cuentas() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Asignar áreas ───────────────────────────────────────────────────────────
-- Se hace desde el módulo (Seguimiento → Acceso), que además sugiere el área
-- de cada persona a partir de Colaboradores. Por SQL sería, por ejemplo:
--   UPDATE public.seguimiento_acceso SET subdireccion = 'SSO', gerencia = NULL
--    WHERE email = 'subdirector.sso@aifa.operaciones';                -- subdirector
--   UPDATE public.seguimiento_acceso SET subdireccion = 'SSO', gerencia = 'Gerencia de Seguridad Operacional'
--    WHERE email = 'gerente.gso@aifa.operaciones';                    -- gerente

-- Verificación:
-- SELECT email, rol, subdireccion, gerencia FROM public.seguimiento_acceso ORDER BY subdireccion NULLS FIRST, gerencia NULLS FIRST;
-- SELECT policyname, tablename, cmd FROM pg_policies WHERE tablename LIKE 'seguimiento_%' OR policyname LIKE 'seguimiento_%';
