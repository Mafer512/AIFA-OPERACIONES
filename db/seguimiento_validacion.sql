-- ============================================================================
-- SEGUIMIENTO · El Director valida las tareas antes de darlas por terminadas
--             · Archivos y observaciones en cada subtarea
--
-- 1. Estatus nuevo «por_validar». Cuando alguien que no es admin de
--    Seguimiento marca una tarea como hecha, queda «Por validar»: la entregó,
--    pero no cuenta como terminada hasta que un admin (el Director de
--    Operación) la valida. El admin puede validarla (pasa a «completada») o
--    regresarla con observaciones (vuelve a «en_proceso»).
--    Se guarda quién la entregó y cuándo, y quién la validó y cuándo.
--    La regla vive aquí, en la base: aunque alguien intente marcarla como
--    completada por la API, la base la deja «por validar»; y una tarea ya
--    validada sólo la reabre un admin.
--
-- 2. Evidencias y archivos de subtareas: además de PDF, JPG y PNG, ahora
--    Word (.doc, .docx) y Excel (.xls, .xlsx), hasta 25 MB. Los archivos de
--    cada subtarea van en el mismo bucket privado, dentro de la carpeta de su
--    tarea; sus datos y la observación se guardan en la propia subtarea
--    (checklist: [{ id, texto, hecho, obs, archivos: [...] }]).
--
-- 3. Límites: textos, número de subtareas y de archivos, y tamaño de los
--    datos de cada tarea, para que nada desmedido dañe la base.
--
-- Requiere db/create_seguimiento.sql. Respeta db/seguimiento_alcance_por_area.sql
-- si ya se corrió. Es idempotente: se puede correr más de una vez.
-- Supabase → SQL Editor → pegar → Run.
-- ============================================================================

BEGIN;

-- ── 1. Estatus «por_validar» ─────────────────────────────────────────────────
ALTER TABLE public.seguimiento_tareas DROP CONSTRAINT IF EXISTS seguimiento_tareas_estatus_chk;
ALTER TABLE public.seguimiento_tareas ADD CONSTRAINT seguimiento_tareas_estatus_chk
  CHECK (estatus IN ('pendiente', 'en_proceso', 'en_revision', 'detenida', 'por_validar', 'completada', 'cancelada'));

ALTER TABLE public.seguimiento_tareas ADD COLUMN IF NOT EXISTS entregada_en  timestamptz;
ALTER TABLE public.seguimiento_tareas ADD COLUMN IF NOT EXISTS entregada_por text;
ALTER TABLE public.seguimiento_tareas ADD COLUMN IF NOT EXISTS validada_en   timestamptz;
ALTER TABLE public.seguimiento_tareas ADD COLUMN IF NOT EXISTS validada_por  text;

COMMENT ON COLUMN public.seguimiento_tareas.entregada_en IS 'Cuándo se entregó para validación (marcada como hecha por quien no es admin).';
COMMENT ON COLUMN public.seguimiento_tareas.entregada_por IS 'Quién la entregó para validación.';
COMMENT ON COLUMN public.seguimiento_tareas.validada_en IS 'Cuándo un admin de Seguimiento la validó y dio por terminada.';
COMMENT ON COLUMN public.seguimiento_tareas.validada_por IS 'Qué admin de Seguimiento la validó.';

-- ── 2. La regla ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._seguimiento_validacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_jwt   jsonb := auth.jwt();
  -- Sin sesión (SQL Editor) o con la llave de servicio: se trata como admin.
  v_admin boolean := v_jwt IS NULL
                     OR coalesce(v_jwt ->> 'role', '') = 'service_role'
                     OR coalesce(public.seguimiento_es_admin(), false);
  v_quien text := lower(coalesce(v_jwt ->> 'email', ''));
  v_antes text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.estatus END;
BEGIN
  -- Sólo un admin da por terminada una tarea: si alguien más la marca como
  -- completada, queda entregada y «por validar».
  IF NEW.estatus = 'completada' AND v_antes IS DISTINCT FROM 'completada' AND NOT v_admin THEN
    NEW.estatus := 'por_validar';
  END IF;

  -- Una tarea ya validada sólo la reabre un admin.
  IF v_antes = 'completada' AND NEW.estatus <> 'completada' AND NOT v_admin THEN
    RAISE EXCEPTION 'Esta tarea ya fue validada: sólo el Director (admin de Seguimiento) puede reabrirla.'
      USING ERRCODE = '42501';
  END IF;

  -- Entrega: cuándo y quién (si ya traía fecha de entrega, se conserva).
  IF NEW.estatus = 'por_validar' AND v_antes IS DISTINCT FROM 'por_validar' THEN
    NEW.entregada_en  := coalesce(NEW.entregada_en, now());
    NEW.entregada_por := coalesce(nullif(btrim(NEW.entregada_por), ''), nullif(v_quien, ''));
    NEW.validada_en   := NULL;
    NEW.validada_por  := NULL;
  END IF;

  -- Validación: cuándo y quién.
  IF NEW.estatus = 'completada' AND v_antes IS DISTINCT FROM 'completada' THEN
    NEW.validada_en  := now();
    NEW.validada_por := coalesce(nullif(btrim(NEW.validada_por), ''), nullif(v_quien, ''));
  END IF;

  -- De regreso a trabajo (o cancelada): ya no hay entrega ni validación.
  IF NEW.estatus NOT IN ('por_validar', 'completada') THEN
    NEW.entregada_en  := NULL;
    NEW.entregada_por := NULL;
    NEW.validada_en   := NULL;
    NEW.validada_por  := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Corre antes que trg_touch_seguimiento (orden alfabético): así la fecha de
-- cierre (completada_en) sólo se pone cuando de verdad queda completada.
DROP TRIGGER IF EXISTS trg_seguimiento_validacion ON public.seguimiento_tareas;
CREATE TRIGGER trg_seguimiento_validacion
BEFORE INSERT OR UPDATE ON public.seguimiento_tareas
FOR EACH ROW EXECUTE FUNCTION public._seguimiento_validacion();

-- ── 3. Archivos: Word y Excel además de PDF e imágenes, hasta 25 MB ────────
UPDATE storage.buckets
   SET file_size_limit = 26214400,  -- 25 MB
       allowed_mime_types = ARRAY[
         'application/pdf', 'image/jpeg', 'image/png',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]
 WHERE id = 'seguimiento-evidencias';

-- La ruta sigue siendo <id de la tarea>/<nombre aleatorio>.<extensión>; sólo
-- se agregan las extensiones. Si ya se corrió el alcance por área, se respeta.
DROP POLICY IF EXISTS "seguimiento_evidencias_insert" ON storage.objects;
DO $$
BEGIN
  IF to_regprocedure('public.seguimiento_ruta_en_alcance(text)') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "seguimiento_evidencias_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'seguimiento-evidencias'
          AND public.seguimiento_puede_editar()
          AND name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{6,64}\.(pdf|jpg|png|doc|docx|xls|xlsx)$'
          AND public.seguimiento_ruta_en_alcance(name)
        )
    $p$;
  ELSE
    EXECUTE $p$
      CREATE POLICY "seguimiento_evidencias_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'seguimiento-evidencias'
          AND public.seguimiento_puede_editar()
          AND name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{6,64}\.(pdf|jpg|png|doc|docx|xls|xlsx)$'
        )
    $p$;
  END IF;
END;
$$;

-- ── 4. Límites: que nada desmedido llegue a la base ────────────────────────
-- La página avisa antes con palabras (textos, archivos, subtareas); esto lo
-- impide aunque alguien se salte la página. Son NOT VALID: aplican a todo lo
-- que se cree o modifique desde ahora y no fallan por datos que ya existan.
-- El tamaño de cada archivo (25 MB) lo limita el bucket, arriba.
ALTER TABLE public.seguimiento_tareas DROP CONSTRAINT IF EXISTS seguimiento_tareas_limites_chk;
ALTER TABLE public.seguimiento_tareas ADD CONSTRAINT seguimiento_tareas_limites_chk CHECK (
      length(coalesce(descripcion, ''))     <= 8000
  AND length(coalesce(referencia, ''))      <= 300
  AND length(coalesce(responsable, ''))     <= 200
  AND length(coalesce(gerencia, ''))        <= 200
  AND length(coalesce(responsable_tel, '')) <= 30
  AND coalesce(array_length(etiquetas, 1), 0) <= 20
  AND jsonb_array_length(checklist)  <= 100            -- subtareas (la página permite 60)
  AND jsonb_array_length(evidencias) <= 50             -- evidencias (la página permite 30)
  AND pg_column_size(checklist)  <= 1048576            -- 1 MB de datos de subtareas
  AND pg_column_size(evidencias) <= 262144             -- 256 KB de datos de evidencias
) NOT VALID;

ALTER TABLE public.seguimiento_comentarios DROP CONSTRAINT IF EXISTS seguimiento_comentarios_largo_chk;
ALTER TABLE public.seguimiento_comentarios ADD CONSTRAINT seguimiento_comentarios_largo_chk
  CHECK (length(btrim(texto)) BETWEEN 1 AND 4000) NOT VALID;

COMMIT;

-- Que la API vea las columnas nuevas sin esperar.
NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'seguimiento_tareas' AND column_name IN ('entregada_en', 'entregada_por', 'validada_en', 'validada_por');
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.seguimiento_tareas'::regclass AND NOT tgisinternal;
-- SELECT id, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'seguimiento-evidencias';
-- SELECT folio, titulo, estatus, entregada_por, entregada_en, validada_por, validada_en
--   FROM public.seguimiento_tareas WHERE estatus IN ('por_validar', 'completada') ORDER BY actualizado_en DESC LIMIT 20;
