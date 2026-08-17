-- =============================================================================
--  Cola de capturas pendientes — Conciliación Manifiestos
--
--  El borrador local (localStorage) rescata una captura que no llegó a la base
--  cuando la persona vuelve a entrar EN ESA MISMA COMPUTADORA. Si la máquina se
--  apaga y no vuelve, o la persona sigue desde otro equipo, lo capturado se
--  queda ahí encerrado: nadie más puede verlo ni recuperarlo, y nadie sabe
--  siquiera que existía.
--
--  Esta tabla es la red de seguridad compartida. En cuanto alguien teclea algo
--  que todavía no está confirmado en la tabla principal, ese valor queda aquí,
--  del lado del servidor. Cuando la base confirma la captura, la fila se borra.
--
--  No es una segunda fuente de verdad: solo contiene lo que TODAVÍA no está en
--  "Conciliación Manifiestos". Lo que está confirmado no vive aquí.
--
--  Ejecutar en: Supabase → SQL Editor → Run
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.conciliacion_capturas_pendientes (
    id           bigserial PRIMARY KEY,
    -- A qué celda pertenece. row_id es texto porque una fila recién creada aún
    -- no tiene id en la base: se identifica por su clave temporal de pantalla.
    row_id       text        NOT NULL,
    columna      text        NOT NULL,
    valor        text,
    -- Quién la capturó y desde dónde. cliente_id distingue dos pestañas de la
    -- misma persona.
    usuario      text        NOT NULL,
    usuario_id   uuid        DEFAULT auth.uid(),
    cliente_id   text        NOT NULL,
    -- Para poder mostrar los pendientes del día que se está trabajando.
    fecha_vuelo  date,
    vuelo        text,
    intentos     integer     NOT NULL DEFAULT 1,
    ultimo_error text,
    creado_en    timestamptz NOT NULL DEFAULT now(),
    visto_en     timestamptz NOT NULL DEFAULT now()
);

-- Una celda pendiente por persona: si vuelve a teclear encima, se actualiza esa
-- misma fila en vez de acumular una por pulsación.
CREATE UNIQUE INDEX IF NOT EXISTS conci_pendientes_celda_unica
    ON public.conciliacion_capturas_pendientes (row_id, columna, cliente_id);

CREATE INDEX IF NOT EXISTS conci_pendientes_fecha
    ON public.conciliacion_capturas_pendientes (fecha_vuelo);

CREATE INDEX IF NOT EXISTS conci_pendientes_visto
    ON public.conciliacion_capturas_pendientes (visto_en);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Todos los autenticados ven la cola completa: el sentido de tenerla en el
-- servidor es justamente que un supervisor —o un compañero -- pueda ver lo que
-- quedó a medias en otra computadora y rescatarlo.
ALTER TABLE public.conciliacion_capturas_pendientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conci_pendientes_leer" ON public.conciliacion_capturas_pendientes;
CREATE POLICY "conci_pendientes_leer" ON public.conciliacion_capturas_pendientes
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "conci_pendientes_escribir" ON public.conciliacion_capturas_pendientes;
CREATE POLICY "conci_pendientes_escribir" ON public.conciliacion_capturas_pendientes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Realtime, para que la barra de pendientes se actualice sola en todas las
-- pantallas sin recargar.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'conciliacion_capturas_pendientes'
    ) THEN
        ALTER PUBLICATION supabase_realtime
            ADD TABLE public.conciliacion_capturas_pendientes;
    END IF;
END;
$$;

-- ── Limpieza ─────────────────────────────────────────────────────────────────
-- Un pendiente de hace semanas ya no es un rescate, es basura que puede
-- resucitar una captura que alguien corrigió después. Se descarta a los 7 días.
CREATE OR REPLACE FUNCTION public.conci_pendientes_purgar(dias integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    borradas integer;
BEGIN
    DELETE FROM public.conciliacion_capturas_pendientes
    WHERE visto_en < now() - (dias || ' days')::interval;
    GET DIAGNOSTICS borradas = ROW_COUNT;
    RETURN borradas;
END;
$$;

COMMIT;

-- ── Consultas útiles ─────────────────────────────────────────────────────────
--
-- Qué hay pendiente ahora mismo, y de quién:
--
-- SELECT usuario, fecha_vuelo, vuelo, columna, valor, intentos, ultimo_error,
--        creado_en
-- FROM conciliacion_capturas_pendientes
-- ORDER BY creado_en;
--
-- Pendientes de más de una hora (esos ya no se van a resolver solos):
--
-- SELECT * FROM conciliacion_capturas_pendientes
-- WHERE creado_en < now() - interval '1 hour'
-- ORDER BY creado_en;
--
-- Limpieza manual:
--
-- SELECT public.conci_pendientes_purgar(7);
