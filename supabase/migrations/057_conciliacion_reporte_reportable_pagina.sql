-- =============================================================================
-- 057 · Reportes de Conciliación: lectura ligera y por cursor
--
-- SÍNTOMA
--   Reportes (pasajeros y carga) y el mensaje para WhatsApp/Webex tardaban
--   mucho y a veces caían por tiempo de espera (statement timeout).
--
-- CAUSA
--   Los tres leen TODOS los manifiestos hasta la fecha (los acumulados del año
--   y desde el inicio los necesitan) con conciliacion_reporte_reportable, que
--   regresa la fila COMPLETA de cada manifiesto (to_jsonb(v): ~60 columnas,
--   incluido _portal_manifest_data). La API corta cada respuesta en 10,000
--   renglones, así que el cliente pide por páginas con offset; pero la función
--   no se puede "inlinear" (tiene SET search_path) y cada página recalcula y
--   ordena el resultado entero para quedarse con un pedazo: con ~45,000
--   manifiestos son unas diez veces el trabajo completo.
--
-- QUÉ HACE
--   conciliacion_reporte_reportable_pagina(p_hasta, p_despues, p_limite):
--     · mismo filtro que conciliacion_reporte_reportable (misma vista
--       reportable, mismos cierres y ajustes);
--     · sólo las columnas que usan los reportes y el mensaje;
--     · paginada por cursor sobre _uid (orden total de la vista): cada página
--       pide "los siguientes p_limite después de este _uid".
--   El cliente la usa primero y, si no existe todavía, cae a la función de
--   siempre (js/conci-reportes-pasajeros.js y js/conci-reportes-carga.js).
--   Regresa columnas normales (RETURNS TABLE), no JSONB: así sólo PostgREST
--   serializa, una vez. Los nombres son los mismos de la tabla, que es lo que
--   buscan los reportes. No cambia ningún dato.
--
--   Se evaluó además tipar la fecha de cierre con índice, ordenar por id y
--   sacar columnas del JSONB de los snapshots: no ayudan HOY, porque los
--   reportes leen casi el 100% de la tabla (un índice no se usa para eso) y
--   no hay cierres ni ajustes (esas partes de la vista están vacías).
-- =============================================================================
BEGIN;

-- Por si se corrió una versión anterior que regresaba JSONB: no se puede
-- cambiar el tipo de retorno con CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.conciliacion_reporte_reportable_pagina(date, text, integer);

CREATE FUNCTION public.conciliacion_reporte_reportable_pagina(
    p_hasta   date,
    p_despues text    DEFAULT '',
    p_limite  integer DEFAULT 5000
)
RETURNS TABLE (
    "id"                          bigint,
    "_uid"                        text,
    "_signo"                      smallint,
    "_es_ajuste"                  boolean,
    "CIERRE SUBSECRETARIA"        text,
    "FECHA"                       text,
    "_portal_flight_date"         date,
    "TIPO DE MANIFIESTO"          text,
    "TIPO DE OPERACIÓN"           text,
    "AEROLINEA"                   text,
    "# DE VUELO"                  text,
    "TOTAL PAX"                   bigint,
    "KGS. DE CARGA NACIONAL"      numeric,
    "KGS. DE CARGA INTERNACIONAL" numeric,
    "KG DE CARGA TOTAL"           text,
    "HR. DE RECEPCIÓN"            text,
    "cierre_es_carga_reportado"   boolean,
    "cierre_aerolinea_reportada"  text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT v.id, v._uid, v._signo, v._es_ajuste,
           v."CIERRE SUBSECRETARIA", v."FECHA", v._portal_flight_date,
           v."TIPO DE MANIFIESTO", v."TIPO DE OPERACIÓN", v."AEROLINEA", v."# DE VUELO",
           v."TOTAL PAX", v."KGS. DE CARGA NACIONAL", v."KGS. DE CARGA INTERNACIONAL",
           v."KG DE CARGA TOTAL", v."HR. DE RECEPCIÓN",
           v.cierre_es_carga_reportado, v.cierre_aerolinea_reportada
      FROM public.v_conciliacion_manifiestos_reportable v
     WHERE v._uid > coalesce(p_despues, '')
       AND (
            public._aifa_parse_manifest_date(v."CIERRE SUBSECRETARIA") <= p_hasta
            OR (
                nullif(btrim(v."CIERRE SUBSECRETARIA"), '') IS NULL
                AND coalesce(v._portal_flight_date, public._aifa_parse_manifest_date(v."FECHA")) <= p_hasta
            )
       )
     ORDER BY v._uid
     LIMIT least(greatest(coalesce(p_limite, 5000), 1), 10000);
$$;

REVOKE ALL ON FUNCTION public.conciliacion_reporte_reportable_pagina(date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliacion_reporte_reportable_pagina(date, text, integer) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_reporte_reportable_pagina(date, text, integer) IS
    'Lectura de Reportes y del mensaje de Conciliación: mismo filtro que '
    'conciliacion_reporte_reportable, sólo las columnas que usan, paginada por '
    'cursor sobre _uid (pedir los siguientes p_limite después de p_despues).';

-- La API reconoce la función nueva sin reiniciar.
NOTIFY pgrst, 'reload schema';

COMMIT;
