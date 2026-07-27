-- ============================================================================
-- Historial de cambios — Conciliación Manifiestos
-- Ejecutar en: Supabase → SQL Editor. Es IDEMPOTENTE (se puede re-ejecutar).
-- ----------------------------------------------------------------------------
-- Registra automáticamente, vía TRIGGER (no depende de que el cliente llame a
-- ninguna función), cada alta/baja/modificación de "Conciliación Manifiestos":
--   · Quién  → usuario_id / usuario_nombre / usuario_email (resueltos y
--              congelados al momento del cambio; el registro no depende de
--              que la cuenta del usuario siga existiendo o conserve el mismo
--              nombre después).
--   · Cuándo → creado_en.
--   · Qué    → operacion (INSERT/UPDATE/DELETE) y, para UPDATE, una fila POR
--              CADA COLUMNA que realmente cambió (valor_anterior/valor_nuevo).
--
-- Al vivir en un trigger de base de datos (no en el cliente), queda auditado
-- cualquier cambio sin importar el camino que lo originó (autoguardado por
-- celda, guardado en lote, un script, o SQL directo en el panel de Supabase).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS hstore;

-- ----------------------------------------------------------------------------
-- 1) Tabla de historial. Sin FK hacia "Conciliación Manifiestos": el registro
--    de auditoría debe sobrevivir aunque la fila original se elimine (por eso
--    DELETE guarda una copia completa en valor_anterior).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conciliacion_manifiestos_historial (
    id              BIGSERIAL PRIMARY KEY,
    manifiesto_id   BIGINT,
    operacion       TEXT        NOT NULL CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
    columna         TEXT,                       -- NULL en INSERT/DELETE (afectan la fila completa)
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    usuario_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    usuario_nombre  TEXT        NOT NULL DEFAULT 'Sistema',
    usuario_email   TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cm_historial_manifiesto ON public.conciliacion_manifiestos_historial (manifiesto_id);
CREATE INDEX IF NOT EXISTS idx_cm_historial_fecha       ON public.conciliacion_manifiestos_historial (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_cm_historial_usuario      ON public.conciliacion_manifiestos_historial (usuario_id);

COMMENT ON TABLE public.conciliacion_manifiestos_historial IS
  'Auditoría inmutable de "Conciliación Manifiestos". Se llena únicamente vía trigger (trg_conciliacion_manifiestos_historial); no se expone INSERT/UPDATE/DELETE a clientes.';

-- ----------------------------------------------------------------------------
-- 2) Resuelve nombre/correo legibles del usuario actual, con fallbacks porque
--    en este proyecto conviven varias versiones de handle_new_user() y no
--    todas las cuentas tienen fila en public.profiles.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cm_historial_usuario_actual()
RETURNS TABLE(nombre TEXT, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
    SELECT
        COALESCE(NULLIF(TRIM(p.full_name), ''), NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''), u.email, 'Usuario desconocido'),
        u.email
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public._cm_historial_usuario_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._cm_historial_usuario_actual() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Trigger de auditoría. SECURITY DEFINER: el usuario que edita la tabla no
--    necesita permiso directo de escritura sobre el historial (de hecho no lo
--    tiene, ver política REVOKE más abajo); solo este trigger escribe en él.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._conciliacion_manifiestos_log_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
    _nombre TEXT;
    _email  TEXT;
    _key    TEXT;
    _diff   hstore;
BEGIN
    SELECT nombre, email INTO _nombre, _email FROM public._cm_historial_usuario_actual();
    IF _nombre IS NULL THEN _nombre := 'Sistema'; END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.conciliacion_manifiestos_historial
            (manifiesto_id, operacion, valor_nuevo, usuario_id, usuario_nombre, usuario_email)
        VALUES (NEW.id, 'INSERT', row_to_json(NEW)::text, auth.uid(), _nombre, _email);
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.conciliacion_manifiestos_historial
            (manifiesto_id, operacion, valor_anterior, usuario_id, usuario_nombre, usuario_email)
        VALUES (OLD.id, 'DELETE', row_to_json(OLD)::text, auth.uid(), _nombre, _email);
        RETURN OLD;

    ELSE -- UPDATE: una fila de historial por cada columna que realmente cambió.
        _diff := (hstore(NEW) - hstore(OLD));
        IF _diff IS NOT NULL AND array_length(akeys(_diff), 1) > 0 THEN
            FOR _key IN SELECT (each(_diff)).key LOOP
                IF _key = 'id' THEN CONTINUE; END IF;
                INSERT INTO public.conciliacion_manifiestos_historial
                    (manifiesto_id, operacion, columna, valor_anterior, valor_nuevo, usuario_id, usuario_nombre, usuario_email)
                VALUES (NEW.id, 'UPDATE', _key, (hstore(OLD)) -> _key, (hstore(NEW)) -> _key, auth.uid(), _nombre, _email);
            END LOOP;
        END IF;
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_conciliacion_manifiestos_historial ON "Conciliación Manifiestos";
CREATE TRIGGER trg_conciliacion_manifiestos_historial
    AFTER INSERT OR UPDATE OR DELETE ON "Conciliación Manifiestos"
    FOR EACH ROW EXECUTE FUNCTION public._conciliacion_manifiestos_log_change();

-- ----------------------------------------------------------------------------
-- 4) RLS: mismo nivel de LECTURA que ya tiene "Conciliación Manifiestos"
--    (cualquier authenticated, ver manifiestos_portal_schema.sql). Ninguna
--    escritura directa: sólo el trigger (SECURITY DEFINER) inserta filas, así
--    que el registro no puede alterarse ni borrarse desde la aplicación.
-- ----------------------------------------------------------------------------
ALTER TABLE public.conciliacion_manifiestos_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cm_historial_select_authenticated ON public.conciliacion_manifiestos_historial;
CREATE POLICY cm_historial_select_authenticated
    ON public.conciliacion_manifiestos_historial
    FOR SELECT
    USING (auth.role() = 'authenticated');

REVOKE INSERT, UPDATE, DELETE ON public.conciliacion_manifiestos_historial FROM authenticated, anon, PUBLIC;

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- select * from public.conciliacion_manifiestos_historial order by creado_en desc limit 20;
-- select * from public.conciliacion_manifiestos_historial where manifiesto_id = 123 order by creado_en desc;
-- ============================================================================
