-- Evita que la auditoría bloquee la captura de Conciliación > Manifiestos.
-- Una versión anterior usaba hstore(NEW/OLD); si la extensión no estaba en el
-- search_path, el trigger abortaba también el INSERT/UPDATE principal.

CREATE OR REPLACE FUNCTION public._conciliacion_manifiestos_log_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_name text := 'Sistema';
    v_email text;
    v_key text;
    v_new jsonb;
    v_old jsonb;
BEGIN
    -- La auditoría es secundaria: ningún error suyo debe cancelar la captura.
    BEGIN
        IF to_regprocedure('public._cm_historial_usuario_actual()') IS NOT NULL THEN
            SELECT nombre, email
              INTO v_name, v_email
              FROM public._cm_historial_usuario_actual();
            v_name := coalesce(nullif(trim(v_name), ''), 'Sistema');
        END IF;

        IF TG_OP = 'INSERT' THEN
            INSERT INTO public.conciliacion_manifiestos_historial
                (manifiesto_id, operacion, valor_nuevo, usuario_id, usuario_nombre, usuario_email)
            VALUES
                (NEW.id, 'INSERT', to_jsonb(NEW)::text, auth.uid(), v_name, v_email);
        ELSIF TG_OP = 'DELETE' THEN
            INSERT INTO public.conciliacion_manifiestos_historial
                (manifiesto_id, operacion, valor_anterior, usuario_id, usuario_nombre, usuario_email)
            VALUES
                (OLD.id, 'DELETE', to_jsonb(OLD)::text, auth.uid(), v_name, v_email);
        ELSE
            v_new := to_jsonb(NEW);
            v_old := to_jsonb(OLD);
            FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
                IF v_key <> 'id' AND (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
                    INSERT INTO public.conciliacion_manifiestos_historial
                        (manifiesto_id, operacion, columna, valor_anterior, valor_nuevo,
                         usuario_id, usuario_nombre, usuario_email)
                    VALUES
                        (NEW.id, 'UPDATE', v_key, v_old ->> v_key, v_new ->> v_key,
                         auth.uid(), v_name, v_email);
                END IF;
            END LOOP;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'conciliacion_manifiestos_historial: auditoría omitida (%): %', TG_OP, SQLERRM;
    END;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conciliacion_manifiestos_historial
    ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_conciliacion_manifiestos_historial
    AFTER INSERT OR UPDATE OR DELETE ON public."Conciliación Manifiestos"
    FOR EACH ROW EXECUTE FUNCTION public._conciliacion_manifiestos_log_change();
