-- =============================================================================
-- 069 · Cierre de Subsecretaría desde el sistema · ACTIVAR
-- (selecciona todo y Run). Correr ANTES del primer cierre con el botón.
--
-- Desde el 22/10/2026 el cierre lo hace el botón de Conciliación › Manifiestos
-- y los libros dejan de recargarse. El cierre sirve para el oficio y el
-- mensaje del SWEAR; el Inicio y la Numeralia siguen contando por FECHA.
--
-- 1. Carga o pasajeros AL CERRAR (_conci_clasificacion_reportable). Antes sólo
--    miraba el catálogo, y Aeroméxico, Copa, Conviasa, Global X, Mexicana,
--    Viva y Volaris están ahí sólo como pasajeros: su carga (y Copa Cargo, que
--    se captura con "CM") se habría cerrado como pasajeros. Ahora:
--      · fila aún abierta que ya trae la marca del libro (recargas) → esa;
--      · aerolínea sólo de carga en el catálogo → carga;
--      · si no: sin pasajeros y con kilos → carga; si no, pasajeros.
--    Con un manifiesto ya cerrado (corrección autorizada) se recalcula con la
--    regla, como antes.
-- 2. Mixtas (Inicio, 066): las mismas que el oficio de carga —Aeroméxico,
--    Conviasa, Mexicana, Viva y Volaris—; Copa sí es operación de carga.
-- 3. Los manifiestos de las recargas que el libro traía SIN cierre quedaron
--    fuera del mecanismo (el botón nunca los tomaría): entran al lote del
--    próximo cierre.
-- Al final muestra lo que reportaría el primer cierre, por FECHA y segmento.
-- Se puede volver a correr.
-- =============================================================================
BEGIN;

-- 1) Clasificación al cerrar.
CREATE OR REPLACE FUNCTION public._conci_clasificacion_reportable(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_bruto text := nullif(btrim(coalesce(
        p_datos ->> 'AEROLINEA', p_datos ->> 'aerolinea',
        p_datos ->> 'AIRLINE', p_datos ->> 'airline', ''
    )), '');
    v_name  text;
    v_types text[];
    v_carga boolean;
    v_pasajeros boolean;
    v_pax numeric;
    v_kg  numeric;
BEGIN
    -- Aún abierta y con la marca del libro (recargas): se respeta.
    IF nullif(p_datos ->> 'cierre_id', '') IS NULL
       AND nullif(p_datos ->> 'cierre_es_carga_reportado', '') IS NOT NULL THEN
        RETURN jsonb_build_object(
            'es_carga', (p_datos ->> 'cierre_es_carga_reportado')::boolean,
            'aerolinea', coalesce(nullif(btrim(p_datos ->> 'cierre_aerolinea_reportada'), ''), v_bruto));
    END IF;

    SELECT c.name, c.types
      INTO v_name, v_types
      FROM public.conciliacion_catalogo_aerolineas c
     WHERE c.active
       AND (upper(btrim(c.iata)) = upper(v_bruto)
            OR lower(btrim(c.name)) = lower(v_bruto)
            OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE lower(btrim(a)) = lower(v_bruto)))
     ORDER BY c.id
     LIMIT 1;

    v_carga := coalesce(EXISTS (SELECT 1 FROM unnest(coalesce(v_types, '{}'::text[])) t
                                 WHERE lower(btrim(t)) IN ('carga', 'cargo')), false);
    v_pasajeros := coalesce(EXISTS (SELECT 1 FROM unnest(coalesce(v_types, '{}'::text[])) t
                                     WHERE lower(btrim(t)) LIKE '%pasajeros%'), false);
    v_pax := coalesce(public._aifa_safe_numeric(p_datos ->> 'TOTAL PAX'), 0);
    v_kg  := coalesce(nullif(public._aifa_safe_numeric(p_datos ->> 'KG DE CARGA TOTAL'), 0),
                      coalesce(public._aifa_safe_numeric(p_datos ->> 'KGS. DE CARGA NACIONAL'), 0)
                    + coalesce(public._aifa_safe_numeric(p_datos ->> 'KGS. DE CARGA INTERNACIONAL'), 0));

    RETURN jsonb_build_object(
        'es_carga', CASE WHEN v_carga AND NOT v_pasajeros THEN true
                         WHEN v_pax = 0 AND v_kg > 0 THEN true
                         ELSE false END,
        'aerolinea', coalesce(v_name, v_bruto)
    );
END;
$$;
REVOKE ALL ON FUNCTION public._conci_clasificacion_reportable(jsonb) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._conci_clasificacion_reportable(jsonb) IS
    'Carga o pasajeros al cerrar (069): fila abierta con la marca del libro → esa; aerolínea sólo de carga '
    'en el catálogo → carga; si no, sin pasajeros y con kilos → carga. Devuelve también la aerolínea a reportar.';

-- 2) Mixtas: las del oficio de carga (js/conci-reportes-carga.js).
CREATE OR REPLACE FUNCTION public.aifa_aerolinea_mixta(p_nombre text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $fn$
    SELECT coalesce(public._aifa_norm_texto(p_nombre) = ANY (ARRAY(SELECT public._aifa_norm_texto(x) FROM unnest(ARRAY[
        'AEROMÉXICO', 'AEROMEXICO', 'AEROMÉXICO CONNECT', 'AEROLITORAL', 'CONVIASA',
        'MEXICANA', 'MEXICANA DE AVIACIÓN', 'VIVA AEROBUS', 'VIVA', 'VOLARIS'
    ]) x)), false)
$fn$;
REVOKE ALL ON FUNCTION public.aifa_aerolinea_mixta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aifa_aerolinea_mixta(text) TO authenticated;

-- 3) Lo que el libro traía sin cierre entra al lote del próximo cierre.
SELECT public._conci_lock_contabilidad();
SELECT public._conci_permitir_escritura_cerrada();
CREATE TEMP TABLE _incorporados ON COMMIT DROP AS
SELECT m.id
  FROM public."Conciliación Manifiestos" m
 WHERE m.cierre_id IS NULL
   AND m.cierre_capturado_en IS NULL
   AND nullif(btrim(coalesce(m."CIERRE SUBSECRETARIA"::text, '')), '') IS NULL
   AND public._aifa_fecha_manifiesto(m."FECHA"::text, m."_portal_flight_date"::date) >= DATE '2026-10-01';
UPDATE public."Conciliación Manifiestos" m
   SET cierre_capturado_en = clock_timestamp()
 WHERE m.id IN (SELECT id FROM _incorporados);
SELECT public._conci_fin_escritura_cerrada();

COMMIT;

-- Lo que reportaría el primer cierre, por FECHA y segmento (con la regla nueva).
WITH lote AS (
    SELECT m.*,
           public._aifa_fecha_manifiesto(m."FECHA"::text, m."_portal_flight_date"::date) AS fecha,
           (public._conci_clasificacion_reportable(to_jsonb(m)) ->> 'es_carga')::boolean AS es_carga
      FROM public."Conciliación Manifiestos" m
     WHERE m.cierre_id IS NULL
       AND m.cierre_capturado_en IS NOT NULL
       AND m.cierre_capturado_en >= (SELECT baseline_en FROM public.conciliacion_cierre_config WHERE id)
)
SELECT fecha,
       CASE WHEN es_carga THEN 'carga' ELSE 'pasajeros' END                      AS segmento,
       count(*)                                                                    AS manifiestos,
       sum(coalesce(public._aifa_safe_numeric("TOTAL PAX"::text), 0))             AS pasajeros,
       round(sum(coalesce(public._aifa_safe_numeric("KG DE CARGA TOTAL"::text), 0)) / 1000, 2) AS toneladas,
       CASE WHEN fecha < DATE '2026-10-19' THEN 'REVISAR: fecha vieja' ELSE '' END AS nota
  FROM lote
 GROUP BY 1, 2
 ORDER BY 1 NULLS FIRST, 2;
