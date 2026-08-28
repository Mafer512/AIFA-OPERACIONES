
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.agenda_2026
  ADD COLUMN IF NOT EXISTS foto_ine TEXT,
  ADD COLUMN IF NOT EXISTS foto_ine_rev TEXT,
  ADD COLUMN IF NOT EXISTS foto_cred TEXT,
  ADD COLUMN IF NOT EXISTS cv_url TEXT,
  ADD COLUMN IF NOT EXISTS grado_academico TEXT,
  ADD COLUMN IF NOT EXISTS sangre TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_actualizado_en timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_estado TEXT DEFAULT 'pendiente';

COMMENT ON COLUMN public.agenda_2026.foto_ine IS 'Data URL o URL publica del INE frente';
COMMENT ON COLUMN public.agenda_2026.foto_ine_rev IS 'Data URL o URL publica del INE reverso';
COMMENT ON COLUMN public.agenda_2026.foto_cred IS 'Data URL o URL publica de TIA/credencial';
COMMENT ON COLUMN public.agenda_2026.cv_url IS 'URL publica del CV del colaborador';
COMMENT ON COLUMN public.agenda_2026.grado_academico IS 'Grado academico del colaborador';
COMMENT ON COLUMN public.agenda_2026.sangre IS 'Tipo de sangre del colaborador';
COMMENT ON COLUMN public.agenda_2026.onboarding_actualizado_en IS 'Ultima actualizacion desde portal QR';
COMMENT ON COLUMN public.agenda_2026.onboarding_estado IS 'pendiente|completo';

-- 2) Tabla de links QR/token
CREATE TABLE IF NOT EXISTS public.colab_onboarding_links (
  token TEXT PRIMARY KEY DEFAULT lower(md5(clock_timestamp()::text || random()::text)),
  num_empleado TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_colab_onboarding_links_num ON public.colab_onboarding_links (num_empleado);
CREATE INDEX IF NOT EXISTS idx_colab_onboarding_links_exp ON public.colab_onboarding_links (expires_at);

ALTER TABLE public.colab_onboarding_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'colab_onboarding_links' AND policyname = 'onboarding_links_admin_read'
  ) THEN
    CREATE POLICY onboarding_links_admin_read
      ON public.colab_onboarding_links
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin','superadmin','editor','colab_editor')
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'colab_onboarding_links' AND policyname = 'onboarding_links_admin_write'
  ) THEN
    CREATE POLICY onboarding_links_admin_write
      ON public.colab_onboarding_links
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin','superadmin','editor','colab_editor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin','superadmin','editor','colab_editor')
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._touch_colab_onboarding_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_colab_onboarding_links ON public.colab_onboarding_links;
CREATE TRIGGER trg_touch_colab_onboarding_links
BEFORE UPDATE ON public.colab_onboarding_links
FOR EACH ROW EXECUTE FUNCTION public._touch_colab_onboarding_links();

-- 3) Utilitario: localizar columna real por patrones regex
CREATE OR REPLACE FUNCTION public._agenda_col_by_patterns(patterns text[])
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  p text;
  c text;
BEGIN
  IF patterns IS NULL OR array_length(patterns, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH p IN ARRAY patterns LOOP
    SELECT column_name INTO c
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agenda_2026'
      AND column_name ~* p
    ORDER BY ordinal_position
    LIMIT 1;

    IF c IS NOT NULL THEN
      RETURN c;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 4) Crea link QR para onboarding (uso admin)
CREATE OR REPLACE FUNCTION public.create_colab_onboarding_link(
  p_num_empleado text,
  p_days_valid int DEFAULT 30,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin','superadmin','editor','colab_editor')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'No autorizado para crear links de onboarding';
  END IF;

  IF p_num_empleado IS NULL OR btrim(p_num_empleado) = '' THEN
    RAISE EXCEPTION 'num_empleado es obligatorio';
  END IF;

  v_token := lower(md5(
    coalesce(btrim(p_num_empleado), '') || '|' ||
    coalesce(auth.uid()::text, '') || '|' ||
    coalesce(p_metadata::text, '') || '|' ||
    clock_timestamp()::text || '|' ||
    random()::text
  ));

  INSERT INTO public.colab_onboarding_links (token, num_empleado, expires_at, metadata, activo)
  VALUES (
    v_token,
    btrim(p_num_empleado),
    now() + make_interval(days => GREATEST(1, COALESCE(p_days_valid, 30))),
    COALESCE(p_metadata, '{}'::jsonb),
    true
  );

  RETURN jsonb_build_object(
    'token', v_token,
    'num_empleado', btrim(p_num_empleado),
    'url_suffix', 'colaborador-registro.html?token=' || v_token,
    'expires_at', (now() + make_interval(days => GREATEST(1, COALESCE(p_days_valid, 30))))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_colab_onboarding_link(text, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_colab_onboarding_link(text, int, jsonb) TO authenticated;

-- 5) Consulta de avance por token (uso anon/authed)
CREATE OR REPLACE FUNCTION public.get_colab_onboarding(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lnk public.colab_onboarding_links%ROWTYPE;
  col_num text;
  col_nombre text;
  col_puesto text;
  col_profesion text;
  col_militar text;
  col_nivel text;
  col_plaza text;
  col_turno text;
  col_ryr text;
  col_grado text;
  col_matricula text;
  col_cedula text;
  col_comisionado text;
  col_direccion text;
  col_subdireccion text;
  col_gerencia text;
  col_coordinacion text;
  col_licencia text;
  col_licencia_tipo text;
  col_vig_licencia text;
  col_vig_credencial text;
  col_vig_ine text;
  col_estado_civil text;
  col_dependientes text;
  col_rubrica text;
  col_doc_ingreso text;
  col_alerg_med text;
  col_alerg_ali text;
  col_nss text;
  col_c1_nombre text;
  col_c1_parentesco text;
  col_c1_tel text;
  col_c2_nombre text;
  col_c2_parentesco text;
  col_c2_tel text;
  col_curp text;
  col_cel text;
  col_correo text;
  col_correo_pers text;
  col_extension text;
  col_fecha_ing text;
  col_onom text;
  col_cv_url text;
  col_grado_acad text;
  col_sangre text;
  col_domicilio text;
  col_rfc text;
  col_f_ine text;
  col_f_ine_rev text;
  col_f_tia text;
  row_json jsonb;
  v_nombre text;
BEGIN
  SELECT * INTO lnk
  FROM public.colab_onboarding_links
  WHERE token = p_token
    AND activo = true
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Token invalido o expirado');
  END IF;

  col_num        := public._agenda_col_by_patterns(ARRAY['no\.?\s*empl', 'num.*empl', 'empleado', '^id$']);
  col_nombre     := public._agenda_col_by_patterns(ARRAY['^nombre$', 'nombre']);
  col_puesto     := public._agenda_col_by_patterns(ARRAY['^puesto$', 'cargo', 'posici']);
  col_profesion  := public._agenda_col_by_patterns(ARRAY['licenciatura', 'maestr[ií]a', 'nombre.*lic', 'nombre.*maest', 'profesi[oó]n$', '^profes[^i]']);
  col_militar    := public._agenda_col_by_patterns(ARRAY['militar', '^civil$']);
  col_nivel      := public._agenda_col_by_patterns(ARRAY['^nivel$']);
  col_plaza      := public._agenda_col_by_patterns(ARRAY['^plaza$']);
  col_turno      := public._agenda_col_by_patterns(ARRAY['^turno$']);
  col_ryr        := public._agenda_col_by_patterns(ARRAY['ryr']);
  col_grado      := public._agenda_col_by_patterns(ARRAY['^grado$']);
  col_matricula  := public._agenda_col_by_patterns(ARRAY['matr[íi]cula', 'matricula']);
  col_cedula     := public._agenda_col_by_patterns(ARRAY['c[eé]dula']);
  col_comisionado:= public._agenda_col_by_patterns(ARRAY['^personal\s+comisionado$', 'comision']);
  col_direccion  := public._agenda_col_by_patterns(ARRAY['^dir\.', 'dir\..*org', '^direcci[oó]n', 'direcci(?!.*sub)']);
  col_subdireccion := public._agenda_col_by_patterns(ARRAY['^subdir\.', 'subdir\..*org', 'subdir']);
  col_gerencia   := public._agenda_col_by_patterns(ARRAY['gerencia.*org', 'gerencia']);
  col_coordinacion := public._agenda_col_by_patterns(ARRAY['coordinac.*org', 'coordinaci']);
  col_licencia   := public._agenda_col_by_patterns(ARRAY['^licencia$', 'licencia.*manejo']);
  col_licencia_tipo := public._agenda_col_by_patterns(ARRAY['tipo.*lic', '^tipo$']);
  col_vig_licencia := public._agenda_col_by_patterns(ARRAY['vig.*lic', 'licencia.*vig']);
  col_vig_credencial := public._agenda_col_by_patterns(ARRAY['vig.*cred', 'cred.*vig', 'vigencia.*tia', 'tia.*vig']);
  col_vig_ine    := public._agenda_col_by_patterns(ARRAY['vig.*ine', 'ine.*vig']);
  col_estado_civil := public._agenda_col_by_patterns(ARRAY['estado.*civil']);
  col_dependientes := public._agenda_col_by_patterns(ARRAY['dependiente', 'hijo']);
  col_rubrica    := public._agenda_col_by_patterns(ARRAY['r[uú]brica']);
  col_doc_ingreso := public._agenda_col_by_patterns(ARRAY['doc.*ingreso', 'ingreso.*doc']);
  col_alerg_med  := public._agenda_col_by_patterns(ARRAY['al.*med', 'medicamento']);
  col_alerg_ali  := public._agenda_col_by_patterns(ARRAY['al.*ali', 'alimento']);
  col_nss        := public._agenda_col_by_patterns(ARRAY['^nss$']);
  col_c1_nombre  := public._agenda_col_by_patterns(ARRAY['contacto.*1.*nom', 'emergencia.*1.*nom', 'contacto_?1']);
  col_c1_parentesco := public._agenda_col_by_patterns(ARRAY['contacto.*1.*par', 'parentesco.*1', 'parentesco']);
  col_c1_tel     := public._agenda_col_by_patterns(ARRAY['contacto.*1.*tel', 'tel.*1', 'tel[eé]fono.*1']);
  col_c2_nombre  := public._agenda_col_by_patterns(ARRAY['contacto.*2.*nom', 'emergencia.*2.*nom', 'contacto_?2']);
  col_c2_parentesco := public._agenda_col_by_patterns(ARRAY['contacto.*2.*par', 'parentesco.*2']);
  col_c2_tel     := public._agenda_col_by_patterns(ARRAY['contacto.*2.*tel', 'tel.*2', 'tel[eé]fono.*2']);
  col_curp       := public._agenda_col_by_patterns(ARRAY['^curp$']);
  col_cel        := public._agenda_col_by_patterns(ARRAY['cel[uú]lar', 'm[oó]vil', 'celular', 'cel', 'tel[eé]f[oó]nico', 'no\.?\s*tel', 'tel[eé]fono']);
  col_extension  := public._agenda_col_by_patterns(ARRAY['^ext\.?$', 'extensi']);
  col_correo     := public._agenda_col_by_patterns(ARRAY['correo.*inst', 'institucional.*correo']);
  col_correo_pers:= public._agenda_col_by_patterns(ARRAY['correo.*pers', 'personal.*correo', '^correo$', '^email$']);
  col_fecha_ing  := public._agenda_col_by_patterns(ARRAY['fecha.*ingreso', 'fecha.*alta', 'ingreso', 'alta']);
  col_onom       := public._agenda_col_by_patterns(ARRAY['^fecha\s+de\s+nacimiento$', 'fecha.*nac', 'nacimient', '^cumplea[nñ]os$', 'onom', 'birth']);
  col_cv_url     := public._agenda_col_by_patterns(ARRAY['^cv_url$', '^cv$', 'curriculum', 'curr[ií]culum']);
  col_grado_acad := public._agenda_col_by_patterns(ARRAY['grado.*acad', 'academ']);
  col_sangre     := public._agenda_col_by_patterns(ARRAY['sangre']);
  col_domicilio  := public._agenda_col_by_patterns(ARRAY['domicil']);
  col_rfc        := public._agenda_col_by_patterns(ARRAY['^rfc$']);
  col_f_ine      := public._agenda_col_by_patterns(ARRAY['foto.*ine', 'ine.*frente']);
  col_f_ine_rev  := public._agenda_col_by_patterns(ARRAY['ine.*rev', 'rev.*ine', 'ine.*reverso']);
  col_f_tia      := public._agenda_col_by_patterns(ARRAY['foto.*cred', 'cred.*foto', 'fotograf[ií]a.*tia', 'foto.*tia']);

  IF col_num IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No se detecto columna de numero de empleado en agenda_2026');
  END IF;

  EXECUTE format('SELECT to_jsonb(a) FROM public.agenda_2026 a WHERE %I = $1 LIMIT 1', col_num)
    INTO row_json
    USING lnk.num_empleado;

  -- Identidad no editable desde el portal: el nombre sale del expediente y, si aun no
  -- existe el registro, del que capturo el area al generar el QR.
  v_nombre := nullif(btrim(COALESCE(row_json ->> col_nombre, '')), '');
  IF v_nombre IS NULL THEN
    v_nombre := nullif(btrim(COALESCE(lnk.metadata ->> 'nombre', '')), '');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'token', lnk.token,
    'num_empleado', lnk.num_empleado,
    'nombre', COALESCE(v_nombre, ''),
    'locked_fields', jsonb_build_array('num_empleado', 'nombre'),
    'metadata', lnk.metadata,
    'data', jsonb_build_object(
      'nombre', COALESCE(v_nombre, ''),
      'puesto', COALESCE(row_json ->> col_puesto, ''),
      'profesion', COALESCE(row_json ->> col_profesion, ''),
      'militar', COALESCE(row_json ->> col_militar, ''),
      'nivel', COALESCE(row_json ->> col_nivel, ''),
      'plaza', COALESCE(row_json ->> col_plaza, ''),
      'turno', COALESCE(row_json ->> col_turno, ''),
      'ryr', COALESCE(row_json ->> col_ryr, ''),
      'grado', COALESCE(row_json ->> col_grado, ''),
      'matricula', COALESCE(row_json ->> col_matricula, ''),
      'cedula', COALESCE(row_json ->> col_cedula, ''),
      'comisionado', COALESCE(row_json ->> col_comisionado, ''),
      'direccion', COALESCE(row_json ->> col_direccion, ''),
      'subdireccion', COALESCE(row_json ->> col_subdireccion, ''),
      'gerencia', COALESCE(row_json ->> col_gerencia, ''),
      'coordinacion', COALESCE(row_json ->> col_coordinacion, ''),
      'licencia', COALESCE(row_json ->> col_licencia, ''),
      'licencia_tipo', COALESCE(row_json ->> col_licencia_tipo, ''),
      'vig_licencia', COALESCE(row_json ->> col_vig_licencia, ''),
      'vig_credencial', COALESCE(row_json ->> col_vig_credencial, ''),
      'vig_ine', COALESCE(row_json ->> col_vig_ine, ''),
      'curp', COALESCE(row_json ->> col_curp, ''),
      'celular', COALESCE(row_json ->> col_cel, ''),
      'extension', COALESCE(row_json ->> col_extension, ''),
      'correo', COALESCE(row_json ->> col_correo, ''),
      'correo_personal', COALESCE(row_json ->> col_correo_pers, ''),
      'fecha_ingreso', COALESCE(row_json ->> col_fecha_ing, ''),
      'onomastico', COALESCE(row_json ->> col_onom, ''),
      'cv_url', COALESCE(row_json ->> col_cv_url, ''),
      'grado_academico', COALESCE(row_json ->> col_grado_acad, ''),
      'sangre', COALESCE(row_json ->> col_sangre, ''),
      'estado_civil', COALESCE(row_json ->> col_estado_civil, ''),
      'dependientes', COALESCE(row_json ->> col_dependientes, ''),
      'domicilio', COALESCE(row_json ->> col_domicilio, ''),
      'rfc', COALESCE(row_json ->> col_rfc, ''),
      'nss', COALESCE(row_json ->> col_nss, ''),
      'alerg_med', COALESCE(row_json ->> col_alerg_med, ''),
      'alerg_ali', COALESCE(row_json ->> col_alerg_ali, ''),
      'rubrica', COALESCE(row_json ->> col_rubrica, ''),
      'doc_ingreso', COALESCE(row_json ->> col_doc_ingreso, ''),
      'c1_nombre', COALESCE(row_json ->> col_c1_nombre, ''),
      'c1_parentesco', COALESCE(row_json ->> col_c1_parentesco, ''),
      'c1_tel', COALESCE(row_json ->> col_c1_tel, ''),
      'c2_nombre', COALESCE(row_json ->> col_c2_nombre, ''),
      'c2_parentesco', COALESCE(row_json ->> col_c2_parentesco, ''),
      'c2_tel', COALESCE(row_json ->> col_c2_tel, ''),
      'foto_ine', COALESCE(row_json ->> col_f_ine, ''),
      'foto_ine_rev', COALESCE(row_json ->> col_f_ine_rev, ''),
      'foto_cred', COALESCE(row_json ->> col_f_tia, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_colab_onboarding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_colab_onboarding(text) TO anon, authenticated;

-- 6) Guarda onboarding por token (insert/update agenda_2026)
CREATE OR REPLACE FUNCTION public.save_colab_onboarding(
  p_token text,
  p_payload jsonb,
  p_final boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lnk public.colab_onboarding_links%ROWTYPE;
  col_num text;
  col_nombre text;
  col_puesto text;
  col_profesion text;
  col_militar text;
  col_nivel text;
  col_plaza text;
  col_turno text;
  col_ryr text;
  col_grado text;
  col_matricula text;
  col_cedula text;
  col_comisionado text;
  col_direccion text;
  col_subdireccion text;
  col_gerencia text;
  col_coordinacion text;
  col_licencia text;
  col_licencia_tipo text;
  col_vig_licencia text;
  col_vig_credencial text;
  col_vig_ine text;
  col_curp text;
  col_cel text;
  col_extension text;
  col_correo text;
  col_correo_pers text;
  col_fecha_ing text;
  col_onom text;
  col_cv_url text;
  col_grado_acad text;
  col_sangre text;
  col_domicilio text;
  col_rfc text;
  col_nss text;
  col_estado_civil text;
  col_dependientes text;
  col_alerg_med text;
  col_alerg_ali text;
  col_rubrica text;
  col_doc_ingreso text;
  col_c1_nombre text;
  col_c1_parentesco text;
  col_c1_tel text;
  col_c2_nombre text;
  col_c2_parentesco text;
  col_c2_tel text;
  col_f_ine text;
  col_f_ine_rev text;
  col_f_tia text;
  col_ob_upt text;
  col_ob_sta text;

  v_exists int;
  v_nombre text;
  db_payload jsonb := '{}'::jsonb;
  kv record;
  set_sql text := '';
  cols_sql text := '';
  vals_sql text := '';
  -- 'nombre' no se valida aqui: es campo bloqueado y lo resuelve el servidor.
  required_keys text[] := ARRAY[
    'puesto', 'profesion', 'grado_academico', 'matricula', 'cedula', 'ryr', 'nivel', 'plaza', 'turno', 'militar', 'comisionado', 'direccion', 'subdireccion', 'gerencia', 'coordinacion',
    'curp', 'celular', 'extension', 'correo_personal', 'fecha_ingreso', 'onomastico',
    'cv_url', 'sangre', 'domicilio', 'rfc', 'nss',
    'estado_civil', 'dependientes', 'alerg_med', 'alerg_ali', 'licencia', 'licencia_tipo', 'vig_licencia', 'vig_credencial', 'vig_ine', 'rubrica', 'doc_ingreso',
    'c1_nombre', 'c1_parentesco', 'c1_tel', 'c2_nombre', 'c2_parentesco', 'c2_tel',
    'foto_ine', 'foto_ine_rev', 'foto_cred'
  ];
  required_key text;
  required_col text;
  required_value text;
  missing_fields text[] := ARRAY[]::text[];
  i int;
BEGIN
  SELECT * INTO lnk
  FROM public.colab_onboarding_links
  WHERE token = p_token
    AND activo = true
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Token invalido o expirado');
  END IF;

  col_num          := public._agenda_col_by_patterns(ARRAY['no\.?\s*empl', 'num.*empl', 'empleado', '^id$']);
  col_nombre       := public._agenda_col_by_patterns(ARRAY['^nombre$', 'nombre']);
  col_puesto       := public._agenda_col_by_patterns(ARRAY['^puesto$', 'cargo', 'posici']);
  col_profesion    := public._agenda_col_by_patterns(ARRAY['licenciatura', 'maestr[ií]a', 'nombre.*lic', 'nombre.*maest', 'profesi[oó]n$', '^profes[^i]']);
  col_militar      := public._agenda_col_by_patterns(ARRAY['militar', '^civil$']);
  col_nivel        := public._agenda_col_by_patterns(ARRAY['^nivel$']);
  col_plaza        := public._agenda_col_by_patterns(ARRAY['^plaza$']);
  col_turno        := public._agenda_col_by_patterns(ARRAY['^turno$']);
  col_ryr          := public._agenda_col_by_patterns(ARRAY['ryr']);
  col_grado        := public._agenda_col_by_patterns(ARRAY['^grado$']);
  col_matricula    := public._agenda_col_by_patterns(ARRAY['matr[íi]cula', 'matricula']);
  col_cedula       := public._agenda_col_by_patterns(ARRAY['c[eé]dula']);
  col_comisionado  := public._agenda_col_by_patterns(ARRAY['^personal\s+comisionado$', 'comision']);
  col_direccion    := public._agenda_col_by_patterns(ARRAY['^dir\.', 'dir\..*org', '^direcci[oó]n', 'direcci(?!.*sub)']);
  col_subdireccion := public._agenda_col_by_patterns(ARRAY['^subdir\.', 'subdir\..*org', 'subdir']);
  col_gerencia     := public._agenda_col_by_patterns(ARRAY['gerencia.*org', 'gerencia']);
  col_coordinacion := public._agenda_col_by_patterns(ARRAY['coordinac.*org', 'coordinaci']);
  col_licencia     := public._agenda_col_by_patterns(ARRAY['^licencia$', 'licencia.*manejo']);
  col_licencia_tipo := public._agenda_col_by_patterns(ARRAY['tipo.*lic', '^tipo$']);
  col_vig_licencia := public._agenda_col_by_patterns(ARRAY['vig.*lic', 'licencia.*vig']);
  col_vig_credencial := public._agenda_col_by_patterns(ARRAY['vig.*cred', 'cred.*vig', 'vigencia.*tia', 'tia.*vig']);
  col_vig_ine      := public._agenda_col_by_patterns(ARRAY['vig.*ine', 'ine.*vig']);
  col_curp         := public._agenda_col_by_patterns(ARRAY['^curp$']);
  col_cel          := public._agenda_col_by_patterns(ARRAY['cel[uú]lar', 'm[oó]vil', 'celular', 'cel', 'tel[eé]f[oó]nico', 'no\.?\s*tel', 'tel[eé]fono']);
  col_extension    := public._agenda_col_by_patterns(ARRAY['^ext\.?$', 'extensi']);
  col_correo       := public._agenda_col_by_patterns(ARRAY['correo.*inst', 'institucional.*correo']);
  col_correo_pers  := public._agenda_col_by_patterns(ARRAY['correo.*pers', 'personal.*correo', '^correo$', '^email$']);
  col_fecha_ing    := public._agenda_col_by_patterns(ARRAY['fecha.*ingreso', 'fecha.*alta', 'ingreso', 'alta']);
  col_onom         := public._agenda_col_by_patterns(ARRAY['^fecha\s+de\s+nacimiento$', 'fecha.*nac', 'nacimient', '^cumplea[nñ]os$', 'onom', 'birth']);
  col_cv_url       := public._agenda_col_by_patterns(ARRAY['^cv_url$', '^cv$', 'curriculum', 'curr[ií]culum']);
  col_grado_acad   := public._agenda_col_by_patterns(ARRAY['grado.*acad', 'academ']);
  col_sangre       := public._agenda_col_by_patterns(ARRAY['sangre']);
  col_domicilio    := public._agenda_col_by_patterns(ARRAY['domicil']);
  col_rfc          := public._agenda_col_by_patterns(ARRAY['^rfc$']);
  col_nss          := public._agenda_col_by_patterns(ARRAY['^nss$']);
  col_estado_civil := public._agenda_col_by_patterns(ARRAY['estado.*civil']);
  col_dependientes := public._agenda_col_by_patterns(ARRAY['dependiente', 'hijo']);
  col_alerg_med    := public._agenda_col_by_patterns(ARRAY['al.*med', 'medicamento']);
  col_alerg_ali    := public._agenda_col_by_patterns(ARRAY['al.*ali', 'alimento']);
  col_rubrica      := public._agenda_col_by_patterns(ARRAY['r[uú]brica']);
  col_doc_ingreso  := public._agenda_col_by_patterns(ARRAY['doc.*ingreso', 'ingreso.*doc']);
  col_c1_nombre    := public._agenda_col_by_patterns(ARRAY['contacto.*1.*nom', 'emergencia.*1.*nom', 'contacto_?1']);
  col_c1_parentesco:= public._agenda_col_by_patterns(ARRAY['contacto.*1.*par', 'parentesco.*1', 'parentesco']);
  col_c1_tel       := public._agenda_col_by_patterns(ARRAY['contacto.*1.*tel', 'tel.*1', 'tel[eé]fono.*1']);
  col_c2_nombre    := public._agenda_col_by_patterns(ARRAY['contacto.*2.*nom', 'emergencia.*2.*nom', 'contacto_?2']);
  col_c2_parentesco:= public._agenda_col_by_patterns(ARRAY['contacto.*2.*par', 'parentesco.*2']);
  col_c2_tel       := public._agenda_col_by_patterns(ARRAY['contacto.*2.*tel', 'tel.*2', 'tel[eé]fono.*2']);
  col_f_ine        := public._agenda_col_by_patterns(ARRAY['foto.*ine', 'ine.*frente']);
  col_f_ine_rev    := public._agenda_col_by_patterns(ARRAY['ine.*rev', 'rev.*ine', 'ine.*reverso']);
  col_f_tia        := public._agenda_col_by_patterns(ARRAY['foto.*cred', 'cred.*foto', 'fotograf[ií]a.*tia', 'foto.*tia']);
  col_ob_upt       := public._agenda_col_by_patterns(ARRAY['onboarding_actualizado_en']);
  col_ob_sta       := public._agenda_col_by_patterns(ARRAY['onboarding_estado']);

  IF col_num IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No se detecto columna de numero de empleado en agenda_2026');
  END IF;

  -- Campos bloqueados: el numero de empleado sale del token y el nombre del expediente
  -- (o de la metadata que capturo el area al generar el QR). Lo que mande el portal se ignora.
  IF col_nombre IS NOT NULL THEN
    EXECUTE format('SELECT nullif(btrim(%I::text), '''') FROM public.agenda_2026 WHERE %I = $1 LIMIT 1', col_nombre, col_num)
      INTO v_nombre
      USING lnk.num_empleado;
  END IF;

  IF v_nombre IS NULL THEN
    v_nombre := nullif(btrim(COALESCE(lnk.metadata ->> 'nombre', '')), '');
  END IF;

  IF p_final AND col_nombre IS NOT NULL AND v_nombre IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Tu enlace no trae nombre asignado. Pide al area de personal que genere de nuevo tu QR.'
    );
  END IF;

  IF p_final THEN
    FOR i IN 1..COALESCE(array_length(required_keys, 1), 0) LOOP
      required_key := required_keys[i];
      required_col := CASE required_key
        WHEN 'puesto' THEN col_puesto
        WHEN 'profesion' THEN col_profesion
        WHEN 'grado_academico' THEN col_grado_acad
        WHEN 'matricula' THEN col_matricula
        WHEN 'cedula' THEN col_cedula
        WHEN 'ryr' THEN col_ryr
        WHEN 'nivel' THEN col_nivel
        WHEN 'plaza' THEN col_plaza
        WHEN 'turno' THEN col_turno
        WHEN 'militar' THEN col_militar
        WHEN 'comisionado' THEN col_comisionado
        WHEN 'direccion' THEN col_direccion
        WHEN 'subdireccion' THEN col_subdireccion
        WHEN 'gerencia' THEN col_gerencia
        WHEN 'coordinacion' THEN col_coordinacion
        WHEN 'curp' THEN col_curp
        WHEN 'celular' THEN col_cel
        WHEN 'extension' THEN col_extension
        WHEN 'correo_personal' THEN col_correo_pers
        WHEN 'fecha_ingreso' THEN col_fecha_ing
        WHEN 'onomastico' THEN col_onom
        WHEN 'cv_url' THEN col_cv_url
        WHEN 'sangre' THEN col_sangre
        WHEN 'estado_civil' THEN col_estado_civil
        WHEN 'dependientes' THEN col_dependientes
        WHEN 'domicilio' THEN col_domicilio
        WHEN 'rfc' THEN col_rfc
        WHEN 'nss' THEN col_nss
        WHEN 'alerg_med' THEN col_alerg_med
        WHEN 'alerg_ali' THEN col_alerg_ali
        WHEN 'licencia' THEN col_licencia
        WHEN 'licencia_tipo' THEN col_licencia_tipo
        WHEN 'vig_licencia' THEN col_vig_licencia
        WHEN 'vig_credencial' THEN col_vig_credencial
        WHEN 'vig_ine' THEN col_vig_ine
        WHEN 'rubrica' THEN col_rubrica
        WHEN 'doc_ingreso' THEN col_doc_ingreso
        WHEN 'c1_nombre' THEN col_c1_nombre
        WHEN 'c1_parentesco' THEN col_c1_parentesco
        WHEN 'c1_tel' THEN col_c1_tel
        WHEN 'c2_nombre' THEN col_c2_nombre
        WHEN 'c2_parentesco' THEN col_c2_parentesco
        WHEN 'c2_tel' THEN col_c2_tel
        WHEN 'foto_ine' THEN col_f_ine
        WHEN 'foto_ine_rev' THEN col_f_ine_rev
        WHEN 'foto_cred' THEN col_f_tia
        ELSE NULL
      END;

      IF required_col IS NULL THEN
        CONTINUE;
      END IF;

      required_value := btrim(COALESCE(p_payload ->> required_key, ''));
      IF required_value = '' THEN
        missing_fields := array_append(missing_fields, required_key);
      END IF;
    END LOOP;

    IF array_length(missing_fields, 1) IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Faltan campos obligatorios del onboarding',
        'missing_fields', missing_fields
      );
    END IF;
  END IF;

  db_payload := db_payload || jsonb_build_object(col_num, lnk.num_empleado);

  IF col_nombre IS NOT NULL AND v_nombre IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_nombre, v_nombre); END IF;
  IF p_payload ? 'puesto'          AND col_puesto IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_puesto,       nullif(btrim(p_payload->>'puesto'), '')); END IF;
  IF p_payload ? 'profesion'       AND col_profesion IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_profesion,   nullif(btrim(p_payload->>'profesion'), '')); END IF;
  IF p_payload ? 'grado_academico' AND col_grado_acad IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_grado_acad,   nullif(btrim(p_payload->>'grado_academico'), '')); END IF;
  IF p_payload ? 'matricula'       AND col_matricula IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_matricula,   nullif(btrim(p_payload->>'matricula'), '')); END IF;
  IF p_payload ? 'cedula'          AND col_cedula IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_cedula,      nullif(btrim(p_payload->>'cedula'), '')); END IF;
  IF p_payload ? 'ryr'             AND col_ryr IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_ryr,         nullif(btrim(p_payload->>'ryr'), '')); END IF;
  IF p_payload ? 'nivel'           AND col_nivel IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_nivel,       nullif(btrim(p_payload->>'nivel'), '')); END IF;
  IF p_payload ? 'plaza'           AND col_plaza IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_plaza,       nullif(btrim(p_payload->>'plaza'), '')); END IF;
  IF p_payload ? 'turno'           AND col_turno IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_turno,       nullif(btrim(p_payload->>'turno'), '')); END IF;
  IF p_payload ? 'militar'         AND col_militar IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_militar,     nullif(btrim(p_payload->>'militar'), '')); END IF;
  IF p_payload ? 'comisionado'     AND col_comisionado IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_comisionado, nullif(btrim(p_payload->>'comisionado'), '')); END IF;
  IF p_payload ? 'direccion'       AND col_direccion IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_direccion,   nullif(btrim(p_payload->>'direccion'), '')); END IF;
  IF p_payload ? 'subdireccion'    AND col_subdireccion IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_subdireccion, nullif(btrim(p_payload->>'subdireccion'), '')); END IF;
  IF p_payload ? 'gerencia'        AND col_gerencia IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_gerencia,    nullif(btrim(p_payload->>'gerencia'), '')); END IF;
  IF p_payload ? 'coordinacion'    AND col_coordinacion IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_coordinacion, nullif(btrim(p_payload->>'coordinacion'), '')); END IF;
  IF p_payload ? 'curp'            AND col_curp IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_curp,         nullif(btrim(p_payload->>'curp'), '')); END IF;
  IF p_payload ? 'celular'         AND col_cel IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_cel,          nullif(btrim(p_payload->>'celular'), '')); END IF;
  IF p_payload ? 'extension'       AND col_extension IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_extension,    nullif(btrim(p_payload->>'extension'), '')); END IF;
  IF p_payload ? 'correo'          AND col_correo IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_correo,       nullif(btrim(p_payload->>'correo'), '')); END IF;
  IF p_payload ? 'correo_personal' AND col_correo_pers IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_correo_pers, nullif(btrim(p_payload->>'correo_personal'), '')); END IF;
  IF p_payload ? 'fecha_ingreso'   AND col_fecha_ing IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_fecha_ing,   nullif(btrim(p_payload->>'fecha_ingreso'), '')); END IF;
  IF p_payload ? 'onomastico'      AND col_onom IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_onom,         nullif(btrim(p_payload->>'onomastico'), '')); END IF;
  IF p_payload ? 'cv_url'          AND col_cv_url IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_cv_url,       nullif(btrim(p_payload->>'cv_url'), '')); END IF;
  IF p_payload ? 'sangre'          AND col_sangre IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_sangre,       nullif(btrim(p_payload->>'sangre'), '')); END IF;
  IF p_payload ? 'estado_civil'    AND col_estado_civil IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_estado_civil, nullif(btrim(p_payload->>'estado_civil'), '')); END IF;
  IF p_payload ? 'dependientes'    AND col_dependientes IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_dependientes, nullif(btrim(p_payload->>'dependientes'), '')); END IF;
  IF p_payload ? 'domicilio'       AND col_domicilio IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_domicilio,    nullif(btrim(p_payload->>'domicilio'), '')); END IF;
  IF p_payload ? 'rfc'             AND col_rfc IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_rfc,          nullif(btrim(p_payload->>'rfc'), '')); END IF;
  IF p_payload ? 'nss'             AND col_nss IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_nss,          nullif(btrim(p_payload->>'nss'), '')); END IF;
  IF p_payload ? 'alerg_med'       AND col_alerg_med IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_alerg_med,    nullif(btrim(p_payload->>'alerg_med'), '')); END IF;
  IF p_payload ? 'alerg_ali'       AND col_alerg_ali IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_alerg_ali,    nullif(btrim(p_payload->>'alerg_ali'), '')); END IF;
  IF p_payload ? 'licencia'        AND col_licencia IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_licencia,    nullif(btrim(p_payload->>'licencia'), '')); END IF;
  IF p_payload ? 'licencia_tipo'   AND col_licencia_tipo IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_licencia_tipo, nullif(btrim(p_payload->>'licencia_tipo'), '')); END IF;
  IF p_payload ? 'vig_licencia'    AND col_vig_licencia IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_vig_licencia, nullif(btrim(p_payload->>'vig_licencia'), '')); END IF;
  IF p_payload ? 'vig_credencial'  AND col_vig_credencial IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_vig_credencial, nullif(btrim(p_payload->>'vig_credencial'), '')); END IF;
  IF p_payload ? 'vig_ine'         AND col_vig_ine IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_vig_ine,       nullif(btrim(p_payload->>'vig_ine'), '')); END IF;
  IF p_payload ? 'rubrica'         AND col_rubrica IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_rubrica,     nullif(btrim(p_payload->>'rubrica'), '')); END IF;
  IF p_payload ? 'doc_ingreso'     AND col_doc_ingreso IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_doc_ingreso, nullif(btrim(p_payload->>'doc_ingreso'), '')); END IF;
  IF p_payload ? 'c1_nombre'       AND col_c1_nombre IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_c1_nombre,    nullif(btrim(p_payload->>'c1_nombre'), '')); END IF;
  IF p_payload ? 'c1_parentesco'   AND col_c1_parentesco IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_c1_parentesco, nullif(btrim(p_payload->>'c1_parentesco'), '')); END IF;
  IF p_payload ? 'c1_tel'          AND col_c1_tel IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_c1_tel,       nullif(btrim(p_payload->>'c1_tel'), '')); END IF;
  IF p_payload ? 'c2_nombre'       AND col_c2_nombre IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_c2_nombre,    nullif(btrim(p_payload->>'c2_nombre'), '')); END IF;
  IF p_payload ? 'c2_parentesco'   AND col_c2_parentesco IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_c2_parentesco, nullif(btrim(p_payload->>'c2_parentesco'), '')); END IF;
  IF p_payload ? 'c2_tel'          AND col_c2_tel IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_c2_tel,       nullif(btrim(p_payload->>'c2_tel'), '')); END IF;
  IF p_payload ? 'foto_ine'        AND col_f_ine IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_f_ine,        nullif(p_payload->>'foto_ine', '')); END IF;
  IF p_payload ? 'foto_ine_rev'    AND col_f_ine_rev IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_f_ine_rev,    nullif(p_payload->>'foto_ine_rev', '')); END IF;
  IF p_payload ? 'foto_cred'       AND col_f_tia IS NOT NULL THEN db_payload := db_payload || jsonb_build_object(col_f_tia,        nullif(p_payload->>'foto_cred', '')); END IF;

  IF col_ob_upt IS NOT NULL THEN
    db_payload := db_payload || jsonb_build_object(col_ob_upt, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  END IF;

  IF col_ob_sta IS NOT NULL THEN
    db_payload := db_payload || jsonb_build_object(
      col_ob_sta,
      CASE
        WHEN p_final
         AND COALESCE(nullif(p_payload->>'foto_ine', ''), '') <> ''
         AND COALESCE(nullif(p_payload->>'foto_ine_rev', ''), '') <> ''
         AND COALESCE(nullif(p_payload->>'foto_cred', ''), '') <> ''
         AND COALESCE(nullif(p_payload->>'cv_url', ''), '') <> ''
         AND COALESCE(nullif(p_payload->>'grado_academico', ''), '') <> ''
         AND COALESCE(nullif(p_payload->>'sangre', ''), '') <> ''
        THEN 'completo'
        ELSE 'pendiente'
      END
    );
  END IF;

  EXECUTE format('SELECT count(*) FROM public.agenda_2026 WHERE %I = %L', col_num, lnk.num_empleado) INTO v_exists;

  IF v_exists > 0 THEN
    FOR kv IN SELECT key, value FROM jsonb_each_text(db_payload) LOOP
      IF kv.key = col_num THEN CONTINUE; END IF;
      set_sql := set_sql || CASE WHEN set_sql = '' THEN '' ELSE ', ' END || format('%I = %L', kv.key, kv.value);
    END LOOP;

    IF set_sql <> '' THEN
      EXECUTE format('UPDATE public.agenda_2026 SET %s WHERE %I = %L', set_sql, col_num, lnk.num_empleado);
    END IF;
  ELSE
    FOR kv IN SELECT key, value FROM jsonb_each_text(db_payload) LOOP
      cols_sql := cols_sql || CASE WHEN cols_sql = '' THEN '' ELSE ', ' END || format('%I', kv.key);
      vals_sql := vals_sql || CASE WHEN vals_sql = '' THEN '' ELSE ', ' END || format('%L', kv.value);
    END LOOP;

    EXECUTE format('INSERT INTO public.agenda_2026 (%s) VALUES (%s)', cols_sql, vals_sql);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'num_empleado', lnk.num_empleado,
    'nombre', COALESCE(v_nombre, ''),
    'locked_fields', jsonb_build_array('num_empleado', 'nombre')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_colab_onboarding(text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_colab_onboarding(text, jsonb, boolean) TO anon, authenticated;
