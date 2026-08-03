-- Muebles y Bienes · Coordinación de Auditoría
-- Documentos privados; inventario derivado exclusivamente del Excel oficial.

CREATE TABLE IF NOT EXISTS public.muebles_bienes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_registro TEXT NOT NULL DEFAULT 'individual' CHECK (tipo_registro IN ('individual','lote')),
    familia TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    numero_serie TEXT,
    numero_control TEXT,
    cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    area_responsable TEXT,
    numero_economico TEXT,
    resguardo_folio TEXT,
    fecha_resguardo DATE,
    responsable TEXT,
    vehiculo_ubicacion TEXT,
    observaciones TEXT,
    fuente_hoja TEXT,
    fuente_fila INTEGER,
    fuente_indice INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    CONSTRAINT muebles_bienes_fuente_unique UNIQUE (fuente_hoja, fuente_fila, fuente_indice)
);

COMMENT ON COLUMN public.muebles_bienes.fuente_hoja IS 'Hoja original del Excel; necesaria para trazabilidad de importación.';
COMMENT ON COLUMN public.muebles_bienes.fuente_fila IS 'Fila original del Excel.';
COMMENT ON COLUMN public.muebles_bienes.fuente_indice IS 'Posición dentro de una celda que contiene varias series; evita claves inventadas.';

CREATE INDEX IF NOT EXISTS idx_mb_familia ON public.muebles_bienes(familia);
CREATE INDEX IF NOT EXISTS idx_mb_area ON public.muebles_bienes(area_responsable);
CREATE INDEX IF NOT EXISTS idx_mb_resguardo ON public.muebles_bienes(resguardo_folio);
CREATE INDEX IF NOT EXISTS idx_mb_numero_economico ON public.muebles_bienes(numero_economico);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_serie_unique ON public.muebles_bienes(numero_serie) WHERE numero_serie IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.muebles_bienes_documentos_archivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_documento TEXT NOT NULL,
    nombre_original TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
    tamano_bytes BIGINT NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 10485760),
    sha256 TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    uploader_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS idx_mb_doc_sha256 ON public.muebles_bienes_documentos_archivos(sha256);

CREATE TABLE IF NOT EXISTS public.muebles_bienes_documentos (
    bien_id UUID NOT NULL REFERENCES public.muebles_bienes(id) ON DELETE CASCADE,
    documento_id UUID NOT NULL REFERENCES public.muebles_bienes_documentos_archivos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    PRIMARY KEY (bien_id, documento_id)
);

CREATE OR REPLACE FUNCTION public.mb_access_level()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE v_role TEXT; v_permissions JSONB; v_override TEXT;
BEGIN
  SELECT role, COALESCE(permissions,'{}'::jsonb) INTO v_role,v_permissions FROM public.user_roles WHERE user_id=auth.uid();
  IF v_role IN ('admin','superadmin') THEN RETURN 'admin'; END IF;
  IF v_role IS NULL OR NOT public.user_can_access_section('muebles-bienes') THEN RETURN 'none'; END IF;
  v_override := v_permissions->'section_levels'->>'muebles-bienes';
  IF v_override IN ('read','capture','edit') THEN RETURN v_override; END IF;
  IF v_role IN ('editor','colab_editor','control_fauna','servicio_medico') THEN RETURN 'edit'; END IF;
  IF v_role='capturista' THEN RETURN 'capture'; END IF;
  RETURN 'read';
END $$;
GRANT EXECUTE ON FUNCTION public.mb_access_level() TO authenticated;

CREATE OR REPLACE FUNCTION public.mb_set_update_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); NEW.updated_by=auth.uid(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_mb_updated ON public.muebles_bienes;
CREATE TRIGGER trg_mb_updated BEFORE UPDATE ON public.muebles_bienes FOR EACH ROW EXECUTE FUNCTION public.mb_set_update_fields();

ALTER TABLE public.muebles_bienes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.muebles_bienes_documentos_archivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.muebles_bienes_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY mb_select ON public.muebles_bienes FOR SELECT TO authenticated USING (public.mb_access_level()<>'none');
CREATE POLICY mb_insert ON public.muebles_bienes FOR INSERT TO authenticated WITH CHECK (public.mb_access_level() IN ('admin','edit','capture'));
CREATE POLICY mb_update ON public.muebles_bienes FOR UPDATE TO authenticated USING (public.mb_access_level() IN ('admin','edit')) WITH CHECK (public.mb_access_level() IN ('admin','edit'));
CREATE POLICY mb_delete ON public.muebles_bienes FOR DELETE TO authenticated USING (public.mb_access_level()='admin');

CREATE POLICY mb_doc_file_select ON public.muebles_bienes_documentos_archivos FOR SELECT TO authenticated USING (public.mb_access_level()<>'none');
CREATE POLICY mb_doc_file_insert ON public.muebles_bienes_documentos_archivos FOR INSERT TO authenticated WITH CHECK (public.mb_access_level() IN ('admin','edit','capture'));
CREATE POLICY mb_doc_file_update ON public.muebles_bienes_documentos_archivos FOR UPDATE TO authenticated USING (public.mb_access_level() IN ('admin','edit')) WITH CHECK (public.mb_access_level() IN ('admin','edit'));
CREATE POLICY mb_doc_file_delete ON public.muebles_bienes_documentos_archivos FOR DELETE TO authenticated USING (public.mb_access_level() IN ('admin','edit'));
CREATE POLICY mb_doc_link_select ON public.muebles_bienes_documentos FOR SELECT TO authenticated USING (public.mb_access_level()<>'none');
CREATE POLICY mb_doc_link_insert ON public.muebles_bienes_documentos FOR INSERT TO authenticated WITH CHECK (public.mb_access_level() IN ('admin','edit','capture'));
CREATE POLICY mb_doc_link_delete ON public.muebles_bienes_documentos FOR DELETE TO authenticated USING (public.mb_access_level() IN ('admin','edit'));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('muebles-bienes-documentos','muebles-bienes-documentos',false,10485760,ARRAY['application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY mb_storage_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id='muebles-bienes-documentos' AND public.mb_access_level()<>'none');
CREATE POLICY mb_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='muebles-bienes-documentos' AND public.mb_access_level() IN ('admin','edit','capture') AND lower(storage.extension(name))='pdf');
CREATE POLICY mb_storage_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='muebles-bienes-documentos' AND public.mb_access_level() IN ('admin','edit')) WITH CHECK (bucket_id='muebles-bienes-documentos' AND public.mb_access_level() IN ('admin','edit') AND lower(storage.extension(name))='pdf');
CREATE POLICY mb_storage_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id='muebles-bienes-documentos' AND public.mb_access_level() IN ('admin','edit'));

GRANT SELECT,INSERT,UPDATE,DELETE ON public.muebles_bienes TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.muebles_bienes_documentos_archivos TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.muebles_bienes_documentos TO authenticated;
