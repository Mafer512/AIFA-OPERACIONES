-- ============================================================================
-- EXPEDIENTE LABORAL DE COLABORADORES
-- Incapacidades, reconocimientos, retardos, designaciones y oficios de comisión,
-- cada uno con su documento (PDF, JPG o PNG).
--
-- Por qué una tabla y no renglones en agenda_2026 como Amonestaciones y
-- Comentarios: ahí el PDF se liga por número de renglón (num_1.pdf, num_2.pdf…)
-- y al borrar o reordenar un renglón los documentos quedan desfasados. Aquí
-- cada registro tiene su id, sus fechas y su documento.
--
-- Las incapacidades llevan datos médicos: sólo las ven los editores del
-- directorio (is_colab_editor()). Lo demás lo ve cualquiera que ya puede ver la
-- ficha. Los documentos van a un bucket PRIVADO y se abren con enlaces
-- firmados que vencen.
--
-- Requiere public.is_colab_editor() (db/fix_rls_colaboradores_edicion.sql).
-- Es idempotente: se puede correr de nuevo. No toca agenda_2026.
-- Supabase → SQL Editor → pegar → Run.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_colab_editor()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.is_colab_editor(). Corre antes db/fix_rls_colaboradores_edicion.sql.';
  END IF;
END $$;

-- ── 1. Registros ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.colab_expediente (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  num_empleado     text NOT NULL,
  tipo             text NOT NULL,
  titulo           text,          -- incapacidad: ramo · reconocimiento: nombre · designación: cargo · comisión: área
  emisor           text,          -- quién la expide u otorga (IMSS, ISSSTE, una Dirección…)
  folio            text,          -- folio de la incapacidad u número de oficio
  fecha_inicio     date,
  fecha_fin        date,          -- designación o comisión sin fin = vigente
  minutos          integer,       -- retardos
  justificado      boolean,       -- retardos
  detalle          text,
  documento_path   text,          -- ruta dentro del bucket colab-expediente-docs
  documento_nombre text,          -- nombre original, para mostrarlo
  creado_por       uuid DEFAULT auth.uid(),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colab_expediente_tipo_chk
    CHECK (tipo IN ('incapacidad', 'reconocimiento', 'retardo', 'designacion', 'comision')),
  CONSTRAINT colab_expediente_fechas_chk
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT colab_expediente_minutos_chk
    CHECK (minutos IS NULL OR minutos BETWEEN 1 AND 1440)
);

CREATE INDEX IF NOT EXISTS idx_colab_expediente_num_tipo
  ON public.colab_expediente (num_empleado, tipo, fecha_inicio DESC);

COMMENT ON TABLE public.colab_expediente IS
  'Expediente laboral: incapacidades, reconocimientos, retardos, designaciones y comisiones, con su documento.';

CREATE OR REPLACE FUNCTION public._touch_colab_expediente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_colab_expediente ON public.colab_expediente;
CREATE TRIGGER trg_touch_colab_expediente
BEFORE UPDATE ON public.colab_expediente
FOR EACH ROW EXECUTE FUNCTION public._touch_colab_expediente();

-- ── 2. Permisos ──────────────────────────────────────────────────────────────
ALTER TABLE public.colab_expediente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "colab_expediente_select" ON public.colab_expediente;
DROP POLICY IF EXISTS "colab_expediente_insert" ON public.colab_expediente;
DROP POLICY IF EXISTS "colab_expediente_update" ON public.colab_expediente;
DROP POLICY IF EXISTS "colab_expediente_delete" ON public.colab_expediente;

CREATE POLICY "colab_expediente_select"
  ON public.colab_expediente FOR SELECT TO authenticated
  USING (tipo <> 'incapacidad' OR public.is_colab_editor());

CREATE POLICY "colab_expediente_insert"
  ON public.colab_expediente FOR INSERT TO authenticated
  WITH CHECK (public.is_colab_editor());

CREATE POLICY "colab_expediente_update"
  ON public.colab_expediente FOR UPDATE TO authenticated
  USING (public.is_colab_editor())
  WITH CHECK (public.is_colab_editor());

CREATE POLICY "colab_expediente_delete"
  ON public.colab_expediente FOR DELETE TO authenticated
  USING (public.is_colab_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colab_expediente TO authenticated;

-- ── 3. Documentos: bucket privado ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'colab-expediente-docs',
  'colab-expediente-docs',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "colab_expediente_docs_select" ON storage.objects;
DROP POLICY IF EXISTS "colab_expediente_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "colab_expediente_docs_update" ON storage.objects;
DROP POLICY IF EXISTS "colab_expediente_docs_delete" ON storage.objects;

-- Ruta que genera la aplicación: <num_empleado>/<tipo>/<id>.<pdf|jpg|png>
CREATE POLICY "colab_expediente_docs_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'colab-expediente-docs'
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(incapacidad|reconocimiento|retardo|designacion|comision)/[A-Za-z0-9_-]+\.(pdf|jpg|png)$'
    AND (name !~ '/incapacidad/' OR public.is_colab_editor())
  );

CREATE POLICY "colab_expediente_docs_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'colab-expediente-docs'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(incapacidad|reconocimiento|retardo|designacion|comision)/[A-Za-z0-9_-]+\.(pdf|jpg|png)$'
  );

CREATE POLICY "colab_expediente_docs_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'colab-expediente-docs' AND public.is_colab_editor())
  WITH CHECK (
    bucket_id = 'colab-expediente-docs'
    AND public.is_colab_editor()
    AND name ~ '^[A-Za-z0-9_-]{1,64}/(incapacidad|reconocimiento|retardo|designacion|comision)/[A-Za-z0-9_-]+\.(pdf|jpg|png)$'
  );

CREATE POLICY "colab_expediente_docs_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'colab-expediente-docs' AND public.is_colab_editor());

COMMIT;

-- Verificación:
-- SELECT tipo, count(*) FROM public.colab_expediente GROUP BY tipo;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'colab_expediente';
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'colab-expediente-docs';
