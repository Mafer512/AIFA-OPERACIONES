-- ============================================================================
-- Cambiar el número de empleado de un colaborador
--
-- El número de empleado es la llave con la que todo se cuelga del colaborador:
-- su renglón en agenda_2026, sus cursos, su expediente, su historial de
-- cambios, los enlaces del portal QR y las tareas de Seguimiento que tiene
-- asignadas. Cambiarlo sólo en la ficha dejaría todo eso huérfano, así que esta
-- función lo cambia en todas partes en una sola transacción: o se mueve todo,
-- o no se mueve nada. Y deja el cambio en el historial del colaborador.
--
-- Los archivos en Storage (foto, CV, PDFs de amonestaciones y comentarios) los
-- renombra la aplicación justo después, con los permisos del editor.
--
-- Requiere public.is_colab_editor() (db/fix_rls_colaboradores_edicion.sql).
-- Idempotente. Supabase → SQL Editor → pegar → Run.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_colab_editor()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.is_colab_editor(). Corre antes db/fix_rls_colaboradores_edicion.sql.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.colab_cambiar_num_empleado(
    p_anterior       text,
    p_nuevo          text,
    p_usuario_nombre text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ant      text := btrim(coalesce(p_anterior, ''));
    v_new      text := btrim(coalesce(p_nuevo, ''));
    v_cols     text[] := ARRAY['num_empleado', 'No. Empleado', 'numero_empleado', 'no_empleado'];
    v_col      text;
    v_tipo     text;
    v_n        int;
    v_ocupado  text;
    v_t        text;
    v_tcol     text;
    v_ttipo    text;
    v_cnt      int;
    v_huerfanos text := '';
    v_movidos  jsonb := '{}'::jsonb;
    -- Tablas que guardan el número de empleado del colaborador (tabla, columna).
    v_rel      text[][] := ARRAY[
        ARRAY['colab_historial',        'num_empleado'],
        ARRAY['colab_cursos',           'num_empleado'],
        ARRAY['colab_expediente',       'num_empleado'],
        ARRAY['colab_onboarding_links', 'num_empleado'],
        ARRAY['seguimiento_tareas',     'responsable_num']
    ];
    i int;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Tu sesión expiró. Vuelve a iniciar sesión.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_colab_editor() THEN
        RAISE EXCEPTION 'Sólo un editor de Colaboradores puede cambiar el número de empleado.' USING ERRCODE = '42501';
    END IF;
    IF v_ant = '' OR v_new = '' THEN
        RAISE EXCEPTION 'Falta el número de empleado.';
    END IF;
    IF v_new !~ '^[A-Za-z0-9_-]{1,64}$' THEN
        RAISE EXCEPTION 'El número nuevo sólo puede tener letras, números, guion o guion bajo, sin espacios.';
    END IF;
    IF v_new = v_ant THEN
        RAISE EXCEPTION 'El número nuevo es igual al actual.';
    END IF;

    -- Columna del número en agenda_2026 (y su tipo, para no romper si es numérica).
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO v_col, v_tipo
      FROM pg_attribute a
     WHERE a.attrelid = 'public.agenda_2026'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname = ANY (v_cols)
     ORDER BY array_position(v_cols, a.attname::text)
     LIMIT 1;
    IF v_col IS NULL THEN
        RAISE EXCEPTION 'No encontré la columna del número de empleado en agenda_2026.';
    END IF;

    -- El colaborador existe una sola vez, y se bloquea mientras se cambia.
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.agenda_2026 WHERE btrim(%I::text) = $1 FOR UPDATE) s', v_col)
       INTO v_n USING v_ant;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'No existe un colaborador con el número %.', v_ant;
    END IF;
    IF v_n > 1 THEN
        RAISE EXCEPTION 'Hay % registros con el número %. Corrige el duplicado antes de cambiarlo.', v_n, v_ant;
    END IF;

    -- El número nuevo no puede ser de otra persona.
    EXECUTE format('SELECT coalesce(to_jsonb(t)->>''nombre'', to_jsonb(t)->>''Nombre'', ''(sin nombre)'') FROM public.agenda_2026 t WHERE btrim(%I::text) = $1 LIMIT 1', v_col)
       INTO v_ocupado USING v_new;
    IF v_ocupado IS NOT NULL THEN
        RAISE EXCEPTION 'El número % ya pertenece a %.', v_new, v_ocupado;
    END IF;

    -- Ni puede tener registros sueltos (de alguien dado de baja o eliminado):
    -- se mezclarían con los de este colaborador.
    FOR i IN 1 .. array_length(v_rel, 1) LOOP
        v_t := v_rel[i][1]; v_tcol := v_rel[i][2];
        CONTINUE WHEN v_t = 'seguimiento_tareas';
        IF to_regclass('public.' || v_t) IS NOT NULL THEN
            EXECUTE format('SELECT count(*) FROM public.%I WHERE btrim(%I::text) = $1', v_t, v_tcol) INTO v_cnt USING v_new;
            IF v_cnt > 0 THEN v_huerfanos := v_huerfanos || format(' %s (%s)', v_t, v_cnt); END IF;
        END IF;
    END LOOP;
    IF v_huerfanos <> '' THEN
        RAISE EXCEPTION 'Ya hay registros guardados con el número %:%. Pueden ser de otra persona; revisa antes de usarlo.', v_new, v_huerfanos;
    END IF;

    -- 1. La ficha.
    BEGIN
        EXECUTE format('UPDATE public.agenda_2026 SET %I = $1::%s WHERE btrim(%I::text) = $2', v_col, v_tipo, v_col)
          USING v_new, v_ant;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'En esta base el número de empleado sólo admite dígitos.';
    END;

    -- 2. Todo lo que cuelga del número.
    FOR i IN 1 .. array_length(v_rel, 1) LOOP
        v_t := v_rel[i][1]; v_tcol := v_rel[i][2];
        IF to_regclass('public.' || v_t) IS NULL THEN CONTINUE; END IF;
        SELECT format_type(a.atttypid, a.atttypmod) INTO v_ttipo
          FROM pg_attribute a
         WHERE a.attrelid = ('public.' || v_t)::regclass AND a.attname = v_tcol AND NOT a.attisdropped;
        IF v_ttipo IS NULL THEN CONTINUE; END IF;
        EXECUTE format('UPDATE public.%I SET %I = $1::%s WHERE btrim(%I::text) = $2', v_t, v_tcol, v_ttipo, v_tcol)
          USING v_new, v_ant;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_movidos := v_movidos || jsonb_build_object(v_t, v_cnt);
    END LOOP;

    -- 3. El historial del colaborador.
    INSERT INTO public.colab_historial (num_empleado, campo, valor_anterior, valor_nuevo, usuario_id, usuario_nombre, fecha)
    VALUES (v_new, 'num_empleado', v_ant, v_new, auth.uid(), coalesce(nullif(btrim(p_usuario_nombre), ''), 'Usuario'), now());

    RETURN jsonb_build_object('ok', true, 'anterior', v_ant, 'nuevo', v_new, 'columna', v_col, 'movidos', v_movidos);
END;
$$;

REVOKE ALL ON FUNCTION public.colab_cambiar_num_empleado(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.colab_cambiar_num_empleado(text, text, text) TO authenticated;

-- Comprobación: la función existe y es SECURITY DEFINER.
SELECT proname, prosecdef AS security_definer
  FROM pg_proc
 WHERE proname = 'colab_cambiar_num_empleado';
