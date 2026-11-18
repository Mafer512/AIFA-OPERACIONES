-- ============================================================================
-- SETP · Identificación de hallazgos (folio, ubicación exacta, etiquetas,
-- items) y control de duplicados
--
-- NO borra datos ni cambia los que ya existen. Agrega a setp_hallazgos:
--   folio          SETP-AAMM-0001 · único, lo asigna la base de datos al guardar
--                  (consecutivo por mes de la fecha de reporte).
--   local          clave del local (ej. SEIE4-12).
--   etiqueta       tipo de hallazgo (ej. MOBILIARIO).
--   item           elemento (ej. Butaca).
--   condicion      condición (ej. roto).
--   cantidad       piezas (1 por omisión).
--   detalle        texto libre opcional que acompaña a la captura.
--   veces          cuántas veces se ha reportado (sube con "Es el mismo").
--   fotos_extra    fotos de quienes lo reportaron después ("Es el mismo").
--   duplicado_de   si se fusionó, el hallazgo principal. Ya no sale en el
--                  reporte ni en el oficio, pero se conserva el registro.
-- y dos funciones que usa el aplicativo:
--   setp_sumar_reporte(hallazgo, foto)      "Es el mismo · agregar mi foto".
--   setp_fusionar_hallazgos(dup, principal) botón "Fusionar".
--
-- El oficio SSO/GOET/ no cambia: el folio y las etiquetas no se imprimen.
-- A los hallazgos que ya existen se les asigna su folio. Es idempotente.
-- Requiere db/create_setp_formatos.sql.
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================

ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS folio text;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS local text;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS etiqueta text;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS item text;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS condicion text;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS cantidad integer NOT NULL DEFAULT 1;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS detalle text;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS veces integer NOT NULL DEFAULT 1;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS fotos_extra jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.setp_hallazgos ADD COLUMN IF NOT EXISTS duplicado_de uuid
    REFERENCES public.setp_hallazgos (id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'setp_hallazgos_cantidad_chk') THEN
        ALTER TABLE public.setp_hallazgos ADD CONSTRAINT setp_hallazgos_cantidad_chk CHECK (cantidad >= 1);
    END IF;
END $$;

-- ── Folio consecutivo por mes ──────────────────────────────────────────────
-- Contador por mes (AAMM). Sólo lo usa el trigger; el aplicativo no lo toca.
CREATE TABLE IF NOT EXISTS public.setp_folios (
    mes text PRIMARY KEY,
    ultimo integer NOT NULL DEFAULT 0
);
ALTER TABLE public.setp_folios ENABLE ROW LEVEL SECURITY;  -- sin políticas: nadie lo lee ni escribe directo

CREATE OR REPLACE FUNCTION public.setp_siguiente_folio(p_fecha date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mes text := to_char(coalesce(p_fecha, current_date), 'YYMM');
    v_n integer;
BEGIN
    INSERT INTO public.setp_folios (mes, ultimo) VALUES (v_mes, 1)
    ON CONFLICT (mes) DO UPDATE SET ultimo = public.setp_folios.ultimo + 1
    RETURNING ultimo INTO v_n;
    RETURN 'SETP-' || v_mes || '-' || lpad(v_n::text, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.setp_siguiente_folio(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.setp_hallazgos_folio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.folio IS NULL OR btrim(NEW.folio) = '' THEN
        NEW.folio := public.setp_siguiente_folio(NEW.fecha_reporte);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_setp_hallazgos_folio ON public.setp_hallazgos;
CREATE TRIGGER trg_setp_hallazgos_folio
    BEFORE INSERT ON public.setp_hallazgos
    FOR EACH ROW EXECUTE FUNCTION public.setp_hallazgos_folio();

-- Folio para los hallazgos que ya existen (en orden de fecha de reporte y captura).
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id, fecha_reporte FROM public.setp_hallazgos
             WHERE folio IS NULL ORDER BY fecha_reporte, created_at, id
    LOOP
        UPDATE public.setp_hallazgos SET folio = public.setp_siguiente_folio(r.fecha_reporte) WHERE id = r.id;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_setp_hallazgos_folio ON public.setp_hallazgos (folio);

-- Búsqueda de posibles duplicados (mismo item pendiente en el mismo lugar).
CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_duplicados
    ON public.setp_hallazgos (estatus, etiqueta, item, nivel, local)
    WHERE duplicado_de IS NULL;

-- ── "Es el mismo · agregar mi foto" ────────────────────────────────────────
-- Suma un reporte al hallazgo existente (veces + 1) y guarda la foto nueva.
-- En una sola operación, para que dos personas a la vez no se pisen.
-- p_foto: { "url", "path", "no_empleado", "fecha", "recorrido_id" }
CREATE OR REPLACE FUNCTION public.setp_sumar_reporte(p_hallazgo uuid, p_foto jsonb)
RETURNS public.setp_hallazgos
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
    UPDATE public.setp_hallazgos
       SET veces = veces + 1,
           fotos_extra = fotos_extra || jsonb_build_array(p_foto),
           updated_at = now()
     WHERE id = p_hallazgo
    RETURNING *;
$$;
GRANT EXECUTE ON FUNCTION public.setp_sumar_reporte(uuid, jsonb) TO authenticated;

-- ── "Fusionar" ──────────────────────────────────────────────────────────────
-- p_dup se une a p_principal: el principal suma sus reportes y fotos; p_dup
-- queda marcado como duplicado (no se borra).
CREATE OR REPLACE FUNCTION public.setp_fusionar_hallazgos(p_dup uuid, p_principal uuid)
RETURNS public.setp_hallazgos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    d public.setp_hallazgos;
    res public.setp_hallazgos;
BEGIN
    IF p_dup = p_principal THEN
        RAISE EXCEPTION 'Un hallazgo no se puede fusionar consigo mismo.';
    END IF;
    SELECT * INTO d FROM public.setp_hallazgos WHERE id = p_dup FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el hallazgo a fusionar.'; END IF;
    IF d.duplicado_de IS NOT NULL THEN RAISE EXCEPTION 'Ese hallazgo ya está fusionado.'; END IF;
    UPDATE public.setp_hallazgos
       SET veces = veces + d.veces,
           fotos_extra = fotos_extra
               || CASE WHEN d.evidencia_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object(
                    'url', d.evidencia_url, 'path', d.evidencia_path, 'no_empleado', d.no_empleado,
                    'fecha', d.fecha_reporte, 'folio', d.folio)) END
               || d.fotos_extra,
           updated_at = now()
     WHERE id = p_principal AND duplicado_de IS NULL
    RETURNING * INTO res;
    IF res.id IS NULL THEN RAISE EXCEPTION 'El hallazgo principal no existe o ya está fusionado.'; END IF;
    UPDATE public.setp_hallazgos SET duplicado_de = p_principal, updated_at = now() WHERE id = p_dup;
    RETURN res;
END;
$$;
GRANT EXECUTE ON FUNCTION public.setp_fusionar_hallazgos(uuid, uuid) TO authenticated;

-- Que el aplicativo vea las columnas y funciones nuevas de inmediato.
NOTIFY pgrst, 'reload schema';

-- Comprobación: deben salir 10 renglones.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'setp_hallazgos'
  AND column_name IN ('folio', 'local', 'etiqueta', 'item', 'condicion', 'cantidad', 'detalle', 'veces', 'fotos_extra', 'duplicado_de')
ORDER BY column_name;
