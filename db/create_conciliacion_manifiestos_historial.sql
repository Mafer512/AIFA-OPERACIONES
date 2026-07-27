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
--    todas las cuentas tienen fila en public.profiles (o la tabla podría ni
--    siquiera existir según qué variante quedó activa). Se comprueba su
--    existencia con to_regclass() y se envuelve en EXCEPTION: un error aquí
--    no debe abortar el UPDATE/INSERT/DELETE que disparó el trigger.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cm_historial_usuario_actual()
RETURNS TABLE(nombre TEXT, email TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
    _email     TEXT;
    _meta_name TEXT;
    _full_name TEXT;
BEGIN
    SELECT u.email, u.raw_user_meta_data->>'full_name'
      INTO _email, _meta_name
      FROM auth.users u
     WHERE u.id = auth.uid();

    IF to_regclass('public.profiles') IS NOT NULL THEN
        BEGIN
            EXECUTE 'SELECT full_name FROM public.profiles WHERE id = $1'
              INTO _full_name USING auth.uid();
        EXCEPTION WHEN OTHERS THEN
            _full_name := NULL;
        END;
    END IF;

    RETURN QUERY SELECT
        COALESCE(NULLIF(TRIM(_full_name), ''), NULLIF(TRIM(_meta_name), ''), _email, 'Usuario desconocido'),
        _email;
END;
$$;
REVOKE ALL ON FUNCTION public._cm_historial_usuario_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._cm_historial_usuario_actual() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Trigger de auditoría. SECURITY DEFINER: el usuario que edita la tabla no
--    necesita permiso directo de escritura sobre el historial (de hecho no lo
--    tiene, ver política REVOKE más abajo); solo este trigger escribe en él.
--
--    NOTA (fix): la primera versión de este archivo diferenciaba NEW/OLD con
--    hstore(record), que requiere la extensión `hstore`. En Supabase esa
--    extensión suele instalarse en el esquema `extensions`, no en `public`
--    (mismo caso que pgcrypto, ver db/admin_password_management.sql); como el
--    search_path de esta función no incluía `extensions`, hstore(NEW) fallaba
--    con "function hstore(record) does not exist" — y al ser un error DENTRO
--    del trigger, abortaba toda la transacción del UPDATE (no solo el
--    registro de historial: el cambio del usuario tampoco se guardaba).
--    Esta versión usa jsonb (nativo de Postgres, sin extensión ni esquema de
--    por medio) para el mismo diff, evitando el problema de raíz.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._conciliacion_manifiestos_log_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
    _nombre TEXT;
    _email  TEXT;
    _key    TEXT;
    _new_j  jsonb;
    _old_j  jsonb;
BEGIN
    -- Defensa en profundidad: NINGÚN error dentro de este trigger debe poder
    -- abortar el INSERT/UPDATE/DELETE real del usuario. Si algo falla aquí
    -- (columna nueva con tipo raro, cambio futuro de esquema, etc.), se
    -- registra un WARNING en los logs de Postgres y se deja pasar la
    -- operación original sin auditoría, en vez de bloquearla.
    BEGIN
        SELECT nombre, email INTO _nombre, _email FROM public._cm_historial_usuario_actual();
        IF _nombre IS NULL THEN _nombre := 'Sistema'; END IF;

        IF TG_OP = 'INSERT' THEN
            INSERT INTO public.conciliacion_manifiestos_historial
                (manifiesto_id, operacion, valor_nuevo, usuario_id, usuario_nombre, usuario_email)
            VALUES (NEW.id, 'INSERT', to_jsonb(NEW)::text, auth.uid(), _nombre, _email);

        ELSIF TG_OP = 'DELETE' THEN
            INSERT INTO public.conciliacion_manifiestos_historial
                (manifiesto_id, operacion, valor_anterior, usuario_id, usuario_nombre, usuario_email)
            VALUES (OLD.id, 'DELETE', to_jsonb(OLD)::text, auth.uid(), _nombre, _email);

        ELSE -- UPDATE: una fila de historial por cada columna que realmente cambió.
            _new_j := to_jsonb(NEW);
            _old_j := to_jsonb(OLD);
            FOR _key IN SELECT jsonb_object_keys(_new_j) LOOP
                IF _key = 'id' THEN CONTINUE; END IF;
                IF (_new_j -> _key) IS DISTINCT FROM (_old_j -> _key) THEN
                    INSERT INTO public.conciliacion_manifiestos_historial
                        (manifiesto_id, operacion, columna, valor_anterior, valor_nuevo, usuario_id, usuario_nombre, usuario_email)
                    VALUES (NEW.id, 'UPDATE', _key, _old_j ->> _key, _new_j ->> _key, auth.uid(), _nombre, _email);
                END IF;
            END LOOP;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'conciliacion_manifiestos_historial: no se pudo registrar el cambio (%): %', TG_OP, SQLERRM;
    END;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
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
-- VERIFICACIÓN — ejecutar después de correr todo lo de arriba.
-- ----------------------------------------------------------------------------

-- 1) ¿El trigger quedó activo sobre la tabla?
-- select tgname, tgenabled from pg_trigger
--   where tgrelid = '"Conciliación Manifiestos"'::regclass and not tgisinternal;

-- 2) Prueba directa: actualiza una fila real y confirma que aparezca en el
--    historial de inmediato (reemplaza 123 por un id que exista).
-- update "Conciliación Manifiestos" set "MES" = "MES" where id = 123;
-- select * from public.conciliacion_manifiestos_historial where manifiesto_id = 123 order by creado_en desc limit 5;

-- 3) Ver todo lo más reciente / por registro:
-- select * from public.conciliacion_manifiestos_historial order by creado_en desc limit 20;
-- select * from public.conciliacion_manifiestos_historial where manifiesto_id = 123 order by creado_en desc;
-- ============================================================================
