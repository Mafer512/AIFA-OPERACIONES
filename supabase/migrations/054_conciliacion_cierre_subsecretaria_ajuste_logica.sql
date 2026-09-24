-- Cierre de Subsecretaría — ajustes de negocio sobre 053
-- Requiere 053_conciliacion_cierre_subsecretaria.sql ya instalada. NO copia su
-- contenido: sólo agrega lo que falta. 053 NO se toca — sigue siendo la
-- instalación original ya ejecutada en producción.
--
-- QUÉ TRAE ESTA MIGRACIÓN
--
--   1) HISTORIAL DE CAPTURA EN "CAPTURÓ" — servidor, no sólo cliente.
--      Cada persona que modifica un campo de NEGOCIO de un manifiesto (antes o
--      después del cierre) queda concatenada en "CAPTURÓ" con " | ", una sola
--      vez cada una, en el orden en que intervino. Antes de esta migración esa
--      regla sólo vivía en script.js y sólo cubría a la primera persona (la
--      celda se llenaba una vez y ya no se volvía a tocar): un update REST
--      directo, otra pestaña, el autoguardado o el keepalive podían escribir
--      datos reales sin dejar ningún rastro de quién lo hizo. Ahora la regla
--      vive en un trigger, así que ninguna vía de escritura puede saltársela.
--
--      "Campo de negocio" es exactamente la whitelist que ya existe —
--      _conci_campos_editables_cierre()— menos "CAPTURÓ" misma. Se reutiliza
--      esa lista en vez de inventar una nueva: es la misma que ya decide qué
--      puede tocar una corrección autorizada, y matiene una sola fuente de
--      verdad para "qué es un campo de negocio" en todo el módulo.
--
--      Si quien escribe fija "CAPTURÓ" explícitamente en el mismo UPDATE (una
--      captura manual de esa celda, o una corrección dirigida al propio campo
--      "CAPTURÓ" —sigue en la whitelist para eso—), se respeta tal cual: el
--      trigger no pisa un valor que alguien puso a propósito. Sólo concatena
--      cuando "CAPTURÓ" NO cambió en el mismo UPDATE pero sí cambió algún otro
--      campo de negocio.
--
--      El cierre de un manifiesto (cierre_id, "CIERRE SUBSECRETARIA",
--      cierre_es_carga_reportado, cierre_aerolinea_reportada) NO está en la
--      whitelist de negocio, así que quien realiza el corte NUNCA se agrega a
--      "CAPTURÓ" por el solo hecho de cerrar.
--
--   2) ALERTA DE 30 HORAS SIN MANIFIESTO — solo lectura, con interruptor.
--      Igual que 053 no crea nada en "Conciliación Manifiestos" a partir de un
--      registro de Itinerario, esta migración tampoco. La detección de "vuelo
--      sin manifiesto real capturado tras 30 horas de SLOT COORDINADO (o SLOT
--      ASIGNADO si no hay coordinado)" ocurre enteramente en el cliente, sobre
--      las mismas filas "Solo Vuelos" que ya arma script.js — no se duplica
--      ese cruce aquí ni en el cliente. Lo único que esta migración agrega es
--      la CONFIGURACIÓN persistente del interruptor general (activado por
--      omisión), con el mismo patrón de fila única que ya usan
--      conciliacion_cierre_config (053) e informe_estadistico_refresco (028):
--      id boolean PRIMARY KEY DEFAULT true CHECK (id).
--
--      Para cambiarlo NO se crea un permiso nuevo: se reutiliza exactamente
--      el mismo que decide quién puede realizar el corte
--      (conciliacion_puede_cerrar_subsecretaria(): admin/superadmin o
--      permissions.conciliacion_cierra_subsecretaria), validado del lado
--      servidor en el RPC de escritura, no sólo en la UI.
--
--   3) conciliacion_resumen_periodo — NO se recrea.
--      Se revisó: la 053 instalada la eliminó explícitamente
--      (DROP FUNCTION IF EXISTS public.conciliacion_resumen_periodo(date);)
--      porque pertenecía a un borrador anterior con otro modelo de datos.
--      Ningún archivo JS del proyecto la invoca hoy (js/conci-cierre-
--      subsecretaria.js sólo llama a conciliacion_resumen_lote_abierto, que sí
--      existe y es la que alimenta las tarjetas FIJO/PREVIO/TOTAL). Recrearla
--      sin que nada la use añadiría superficie sin ningún beneficio, así que
--      esta migración deliberadamente NO la repone.
--
--   4) Criterio del lote del corte — SIN CAMBIOS.
--      Se evaluó restringir el lote de cada corte a "sólo lo capturado el
--      mismo día calendario del corte", pero esa regla, aplicada de forma
--      estricta, puede dejar manifiestos huérfanos para siempre si algún día
--      se salta el corte (nadie lo hace a las 18:00): un manifiesto capturado
--      ese día no entraría a NINGÚN corte futuro, porque cada corte futuro
--      sólo miraría "su propio día". Eso contradice el principio ya
--      auditado y probado en 053 de que nada queda huérfano, y no hay en este
--      módulo ningún mecanismo de cierre retroactivo (deliberadamente: la
--      fecha del corte no es elegible por el cliente). Decisión confirmada
--      con el usuario: se conserva el criterio actual de 053 (lo que falta
--      por cerrar, sin importar en qué día se capturó), que en operación
--      normal —un corte cada día— produce exactamente el mismo resultado que
--      "capturado el día X entra en el corte X".
--
-- MÉTODO DE DESPLIEGUE: igual que 053 — un solo BEGIN/COMMIT, sin CREATE INDEX
-- CONCURRENTLY (la tabla nueva nace vacía, así que un índice normal es
-- instantáneo), compatible con `supabase db push`, la integración GitHub y el
-- SQL Editor.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0) REQUISITO: 053 ya instalada
-- =============================================================================

DO $$
BEGIN
    IF to_regprocedure('public.conciliacion_cerrar_subsecretaria()') IS NULL THEN
        RAISE EXCEPTION
            '054 requiere que 053_conciliacion_cierre_subsecretaria.sql ya esté instalada (falta public.conciliacion_cerrar_subsecretaria()).'
            USING ERRCODE = '42883';
    END IF;
    IF to_regprocedure('public._conci_campos_editables_cierre()') IS NULL THEN
        RAISE EXCEPTION
            '054 requiere el helper public._conci_campos_editables_cierre() de 053.'
            USING ERRCODE = '42883';
    END IF;
    IF to_regprocedure('public._conci_usuario_nombre()') IS NULL THEN
        RAISE EXCEPTION
            '054 requiere el helper public._conci_usuario_nombre() de 053.'
            USING ERRCODE = '42883';
    END IF;
    IF to_regprocedure('public.conciliacion_puede_cerrar_subsecretaria()') IS NULL THEN
        RAISE EXCEPTION
            '054 requiere public.conciliacion_puede_cerrar_subsecretaria() de 053.'
            USING ERRCODE = '42883';
    END IF;
    IF to_regprocedure('public.conciliacion_manifiestos_access_level(uuid)') IS NULL THEN
        RAISE EXCEPTION
            '054 requiere public.conciliacion_manifiestos_access_level(uuid), ya usada por 053.'
            USING ERRCODE = '42883';
    END IF;
END $$;

-- =============================================================================
-- 1) HISTORIAL DE CAPTURA EN "CAPTURÓ"
-- =============================================================================

-- Concatena p_nombre a la lista "A | B | C" en p_actual, una sola vez cada
-- nombre, conservando el orden de primera intervención. Pura y pequeña a
-- propósito: la lógica de "cuándo" concatenar vive en el trigger; ésta sólo
-- sabe "cómo".
CREATE OR REPLACE FUNCTION public._conci_capturo_agregar(p_actual text, p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_nombre, '')), '') IS NULL THEN p_actual
        WHEN nullif(btrim(coalesce(p_actual, '')), '') IS NULL THEN btrim(p_nombre)
        WHEN btrim(p_nombre) = ANY (
            SELECT btrim(parte) FROM unnest(string_to_array(p_actual, '|')) AS parte
        ) THEN p_actual
        ELSE btrim(p_actual) || ' | ' || btrim(p_nombre)
    END;
$$;

REVOKE ALL ON FUNCTION public._conci_capturo_agregar(text, text) FROM PUBLIC;

COMMENT ON FUNCTION public._conci_capturo_agregar(text, text) IS
    'Concatena un nombre a la lista "A | B | C" de "CAPTURÓ", una sola vez cada '
    'uno, en orden de primera intervención. No decide CUÁNDO llamarse — eso lo '
    'hace _conci_capturo_historial().';

-- Trigger BEFORE INSERT/UPDATE: mantiene "CAPTURÓ" como historial de quienes
-- tocaron datos de NEGOCIO, del lado servidor. No es SECURITY DEFINER —igual
-- que _conci_proteger_cierre de 053— porque no necesita privilegios propios
-- más allá de los que ya usa _conci_usuario_nombre() (que sí lo es).
CREATE OR REPLACE FUNCTION public._conci_capturo_historial()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_nombre text;
    v_cambio_negocio boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Una fila nueva sólo llega aquí cuando ya trae datos reales que
        -- guardar (el cliente no envía un INSERT con payload vacío). Si nadie
        -- fijó "CAPTURÓ" explícitamente, se firma con quien está autenticado.
        IF nullif(btrim(coalesce(NEW."CAPTURÓ", '')), '') IS NULL THEN
            NEW."CAPTURÓ" := public._conci_usuario_nombre();
        END IF;
        RETURN NEW;
    END IF;

    -- TG_OP = 'UPDATE'
    IF NEW."CAPTURÓ" IS DISTINCT FROM OLD."CAPTURÓ" THEN
        -- Alguien fijó "CAPTURÓ" a propósito en este mismo UPDATE (captura
        -- manual de la celda, o una corrección dirigida a ese campo — sigue
        -- en la whitelist para permitirlo). Se respeta tal cual.
        RETURN NEW;
    END IF;

    v_cambio_negocio := EXISTS (
        SELECT 1
          FROM unnest(public._conci_campos_editables_cierre()) AS c(campo)
         WHERE c.campo <> 'CAPTURÓ'
           AND (to_jsonb(NEW) ->> c.campo) IS DISTINCT FROM (to_jsonb(OLD) ->> c.campo)
    );

    IF v_cambio_negocio THEN
        v_nombre := public._conci_usuario_nombre();
        NEW."CAPTURÓ" := public._conci_capturo_agregar(OLD."CAPTURÓ", v_nombre);
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._conci_capturo_historial() IS
    'Trigger de "Conciliación Manifiestos": concatena en "CAPTURÓ" a cada '
    'persona que modifica un campo de NEGOCIO (whitelist de '
    '_conci_campos_editables_cierre() menos "CAPTURÓ"), una sola vez cada una, '
    'en orden de intervención. El cierre (cierre_id, "CIERRE SUBSECRETARIA", '
    'cierre_es_carga_reportado, cierre_aerolinea_reportada) no está en esa '
    'whitelist, así que quien cierra NUNCA se agrega por el solo hecho de '
    'cerrar. Si "CAPTURÓ" se fija explícitamente en el mismo UPDATE, se '
    'respeta sin concatenar.';

-- BEFORE ROW, igual que el trigger de protección de 053. El orden relativo
-- entre ambos no cambia el resultado (_conci_proteger_cierre nunca toca
-- "CAPTURÓ"), pero se nombra para que corra antes en el orden alfabético con
-- el que Postgres ejecuta los triggers BEFORE ROW de una misma tabla.
DROP TRIGGER IF EXISTS trg_conci_manifiestos_capturo_historial
    ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_conci_manifiestos_capturo_historial
    BEFORE INSERT OR UPDATE ON public."Conciliación Manifiestos"
    FOR EACH ROW EXECUTE FUNCTION public._conci_capturo_historial();

-- =============================================================================
-- 2) ALERTA DE 30 HORAS SIN MANIFIESTO — interruptor general
--
-- Sólo configuración. La detección en sí (SLOT COORDINADO / SLOT ASIGNADO +
-- FECHA vs. ahora, sobre las filas "Solo Vuelos") ocurre en el cliente; ver
-- js/conci-alerta-30h.js. Esta tabla NO participa en ningún cierre ni informe.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.conciliacion_alerta30h_config (
    id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
    habilitado              boolean NOT NULL DEFAULT true,
    actualizado_en          timestamptz NOT NULL DEFAULT now(),
    actualizado_por         uuid REFERENCES auth.users(id),
    actualizado_por_nombre  text
);

COMMENT ON TABLE public.conciliacion_alerta30h_config IS
    'Interruptor general (una sola fila) de la alerta operativa "vuelo sin '
    'manifiesto capturado tras 30 h de SLOT COORDINADO/ASIGNADO". Activado por '
    'omisión. No crea, cierra ni modifica ningún manifiesto ni vuelo: es '
    'puramente informativo.';

-- Activado por omisión, y sin pisar un valor ya cambiado en una reinstalación.
INSERT INTO public.conciliacion_alerta30h_config (id, habilitado)
VALUES (true, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.conciliacion_alerta30h_config ENABLE ROW LEVEL SECURITY;

-- Mismo criterio de lectura que el resto del módulo: cualquiera con acceso a
-- Conciliación > Manifiestos.
DROP POLICY IF EXISTS conciliacion_alerta30h_config_select ON public.conciliacion_alerta30h_config;
CREATE POLICY conciliacion_alerta30h_config_select
    ON public.conciliacion_alerta30h_config FOR SELECT TO authenticated
    USING (public.conciliacion_manifiestos_access_level(auth.uid()) <> 'none');

GRANT SELECT ON public.conciliacion_alerta30h_config TO authenticated;

-- Sin policy de escritura: la única vía es el RPC de abajo (SECURITY DEFINER).

-- Encender/apagar el interruptor. Reutiliza EXACTAMENTE el privilegio que ya
-- decide quién realiza el corte — no se crea un permiso nuevo — y lo vuelve a
-- validar del lado servidor en cada llamada, sin confiar en lo que decida la
-- UI.
CREATE OR REPLACE FUNCTION public.conciliacion_alerta30h_set_estado(p_habilitado boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_nombre text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;
    IF p_habilitado IS NULL THEN
        RAISE EXCEPTION 'p_habilitado no puede ser NULL.' USING ERRCODE = '22004';
    END IF;
    IF NOT public.conciliacion_puede_cerrar_subsecretaria() THEN
        RAISE EXCEPTION 'No tienes privilegio para cambiar la alerta de 30 horas.'
            USING ERRCODE = '42501';
    END IF;

    v_nombre := public._conci_usuario_nombre();

    UPDATE public.conciliacion_alerta30h_config
       SET habilitado = p_habilitado,
           actualizado_en = now(),
           actualizado_por = auth.uid(),
           actualizado_por_nombre = v_nombre
     WHERE id;

    RETURN jsonb_build_object('habilitado', p_habilitado, 'actualizado_por_nombre', v_nombre);
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_alerta30h_set_estado(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_alerta30h_set_estado(boolean) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_alerta30h_set_estado(boolean) IS
    'Enciende/apaga la alerta general de 30 h. Exige exactamente el mismo '
    'privilegio que conciliacion_cerrar_subsecretaria() (admin/superadmin o '
    'permissions.conciliacion_cierra_subsecretaria); no crea un permiso '
    'nuevo. No toca manifiestos, vuelos ni cierres.';

-- Refresca la caché de esquema de PostgREST.
NOTIFY pgrst, 'reload schema';

COMMIT;
