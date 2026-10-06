-- =============================================================================
-- 062b · Frontera maestra/Conciliación por config_fuentes y conteo por FECHA
--
-- REQUISITOS: 058-060 aplicadas; 062a revisada; config_fuentes con
-- fecha_corte_maestra ('2026-07-31') y fecha_corte_oficial ('2026-08-31').
-- REVERSA:   062b_reversa_frontera_y_fecha.sql
-- SEGUIMIENTO (solo lectura): 062b_seguimiento.sql
--
-- Selecciona todo y Run. Responde al instante: el trabajo lo hace pg_cron en
-- UNA sola transacción (un bloque DO con EXCEPTION): o queda todo, o no queda
-- nada, y la bitácora _mig_paso_log dice el paso y el error. Termina en
-- "FIN: OK". Se puede volver a correr: todo es CREATE OR REPLACE y el
-- rehecho de los meses es idempotente.
--
-- QUÉ CAMBIA
--   1. fn_fecha_corte_maestra(): lee config_fuentes.fecha_corte_maestra.
--   2. Frontera del DETALLE, excluyente: maestra_manifiestos con FECHA <=
--      corte_maestra; "Conciliación Manifiestos" con FECHA > corte_maestra.
--      Ya no hay 2026-01-01 fijo en _mh_cargar, manifiestos_hechos_refrescar
--      ni manifiestos_hechos_rehacer_mes. Lo que una fuente tenga del otro
--      lado de la frontera se BORRA de manifiestos_hechos (nunca se cuenta dos
--      veces), existan o no esas filas en la tabla de origen.
--   3. Todo cuenta por la FECHA del manifiesto: fecha_reporte = FECHA. Ya no
--      se lee "CIERRE SUBSECRETARIA" (fecha_cierre queda NULL). La FECHA se
--      lee así: con año (AAAA-MM-DD o DD/MM/AAAA) → si no trae año,
--      _portal_flight_date (sólo Conciliación) → si tampoco, NO entra y queda
--      en v_manifiestos_fecha_ilegible.
--   4. totales_detalle_por_dia(desde, hasta): RPC de solo lectura con el
--      detalle diario por categoría (comercial, carga, general). AG sale de
--      aviacion_general_operaciones con la regla de aviacion_general_resumen.
--   5. Rehace manifiestos_hechos: maestra hasta 2025 (cambia la fecha de los
--      que tenían cierre) y de 2026-01 al mes en curso, mes por mes, las dos
--      fuentes. Los resúmenes se rehacen en cada mes que cambia.
--   6. Verificación final; si una falla, se deshace todo:
--        · ninguna fila de Conciliación con FECHA <= corte_maestra;
--        · ninguna fila de maestra con FECHA > corte_maestra;
--        · cero manifiestos repetidos entre fuentes (fecha + vuelo + sentido);
--        · fecha_reporte = fecha_operacion en todas las filas;
--        · los resúmenes suman lo mismo que los hechos;
--        · ningún mes ene..corte_maestra de 2026 sin operaciones de maestra si
--          hay cifra oficial; toda fila de maestra 2026 con tipo_reporte.
--      Se anotan (sin abortar) las diferencias maestra vs oficial por mes y
--      cuántas filas quedaron con FECHA ilegible.
--
-- Respeta la 060: no toca sus vistas compatibles, permisos ni el pg_cron
-- manifiestos_hechos_refresco (que sigue cada 10 minutos y, con esto, ya
-- respeta la frontera). No modifica maestra_manifiestos ni "Conciliación
-- Manifiestos": sólo los lee.
-- =============================================================================

DO $pre$
DECLARE
    v_corte_m date;
    v_corte_o date;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron no está habilitado.';
    END IF;
    IF to_regprocedure('public._mh_cargar(text,date,date,boolean)') IS NULL
       OR to_regclass('public.mv_estadistica_operaciones_pre060') IS NULL THEN
        RAISE EXCEPTION 'Faltan la 058-060 (manifiestos_hechos y el cambio de reportes).';
    END IF;
    IF to_regclass('public.config_fuentes') IS NULL OR to_regclass('public.cifras_oficiales_mensuales') IS NULL THEN
        RAISE EXCEPTION 'Faltan config_fuentes o cifras_oficiales_mensuales.';
    END IF;
    SELECT nullif(btrim(valor::text, ' "'), '')::date INTO v_corte_m FROM public.config_fuentes WHERE clave = 'fecha_corte_maestra';
    SELECT nullif(btrim(valor::text, ' "'), '')::date INTO v_corte_o FROM public.config_fuentes WHERE clave = 'fecha_corte_oficial';
    IF v_corte_m IS NULL OR v_corte_o IS NULL THEN
        RAISE EXCEPTION 'config_fuentes debe tener fecha_corte_maestra y fecha_corte_oficial (hoy: % / %).', v_corte_m, v_corte_o;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('mig_062b_frontera', 'mig_062b_reversa', 'mig_manifiestos_hechos')) THEN
        RAISE EXCEPTION 'Ya hay una migración de manifiestos_hechos en la agenda de pg_cron; espera a que termine.';
    END IF;
    RAISE NOTICE 'Corte maestra: % · corte oficial: %', v_corte_m, v_corte_o;
END;
$pre$;

DELETE FROM public._mig_paso_log;

SELECT cron.schedule(
    'mig_062b_frontera',
    '* * * * *',
    $job$
SELECT cron.unschedule('mig_062b_frontera');
SET statement_timeout = 0;
SET lock_timeout = '120s';
SET max_parallel_workers_per_gather = 0;
DO $do$
DECLARE
    _paso   text := 'F62 0 inicio';
    _ini    timestamptz := clock_timestamp();
    _r      jsonb;
    _corte  date;
    _mes    date;
    _hasta  date;
    _n      bigint;
    _n2     bigint;
    _txt    text;
BEGIN
    _paso := 'F62 1 candado';
    PERFORM pg_advisory_xact_lock(hashtext('manifiestos_hechos')::bigint);

    _paso := 'F62 2 funciones';
    _ini := clock_timestamp();
    -- ── Corte del DETALLE ────────────────────────────────────────────────
    CREATE OR REPLACE FUNCTION public.fn_fecha_corte_maestra()
    RETURNS date
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $fn$
        SELECT nullif(btrim(cf.valor::text, ' "'), '')::date
          FROM public.config_fuentes cf
         WHERE cf.clave = 'fecha_corte_maestra'
    $fn$;
    COMMENT ON FUNCTION public.fn_fecha_corte_maestra() IS
        'Frontera del DETALLE de manifiestos (config_fuentes.fecha_corte_maestra): FECHA <= corte sale de '
        'maestra_manifiestos y FECHA > corte de "Conciliación Manifiestos". Excluyente (062b).';
    REVOKE ALL ON FUNCTION public.fn_fecha_corte_maestra() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.fn_fecha_corte_maestra() TO authenticated;

    -- ── FECHA del manifiesto ─────────────────────────────────────────────
    -- Sólo cuenta como "con año" AAAA-MM-DD o DD/MM/AAAA, y sólo si la fecha
    -- existe (31/02 no). Sin bloque EXCEPTION: se valida antes de construirla.
    CREATE OR REPLACE FUNCTION public._aifa_fecha_con_anio(p_fecha text)
    RETURNS date
    LANGUAGE plpgsql
    IMMUTABLE
    PARALLEL SAFE
    SET search_path = pg_catalog, pg_temp
    AS $fn$
    DECLARE
        v  text := btrim(coalesce(p_fecha, ''));
        m  text[];
        y  int;
        mo int;
        d  int;
    BEGIN
        m := regexp_match(v, '^(\d{4})-(\d{1,2})-(\d{1,2})(\D|$)');
        IF m IS NOT NULL THEN
            y := m[1]::int; mo := m[2]::int; d := m[3]::int;
        ELSE
            m := regexp_match(v, '^(\d{1,2})/(\d{1,2})/(\d{4})(\D|$)');
            IF m IS NULL THEN
                RETURN NULL;
            END IF;
            d := m[1]::int; mo := m[2]::int; y := m[3]::int;
        END IF;
        IF y NOT BETWEEN 1900 AND 2100 OR mo NOT BETWEEN 1 AND 12 OR d < 1 THEN
            RETURN NULL;
        END IF;
        IF d > extract(day FROM (make_date(y, mo, 1) + interval '1 month - 1 day'))::int THEN
            RETURN NULL;
        END IF;
        RETURN make_date(y, mo, d);
    END;
    $fn$;

    -- Prioridad: FECHA con año → _portal_flight_date (sólo Conciliación) →
    -- NULL (va a v_manifiestos_fecha_ilegible, no se descarta en silencio).
    CREATE OR REPLACE FUNCTION public._aifa_fecha_manifiesto(p_fecha text, p_portal date)
    RETURNS date
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    SET search_path = pg_catalog, pg_temp
    AS $fn$
        SELECT coalesce(public._aifa_fecha_con_anio(p_fecha), p_portal)
    $fn$;

    CREATE OR REPLACE FUNCTION public._aifa_fecha_manifiesto_origen(p_fecha text, p_portal date)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    SET search_path = pg_catalog, pg_temp
    AS $fn$
        SELECT CASE
            WHEN public._aifa_fecha_con_anio(p_fecha) IS NOT NULL THEN 'FECHA'
            WHEN p_portal IS NOT NULL THEN 'PORTAL'
            ELSE 'ILEGIBLE'
        END
    $fn$;

    REVOKE ALL ON FUNCTION public._aifa_fecha_con_anio(text) FROM PUBLIC, anon;
    REVOKE ALL ON FUNCTION public._aifa_fecha_manifiesto(text, date) FROM PUBLIC, anon;
    REVOKE ALL ON FUNCTION public._aifa_fecha_manifiesto_origen(text, date) FROM PUBLIC, anon;

    -- ── Manifiestos cuya FECHA no se puede leer ──────────────────────────
    CREATE OR REPLACE VIEW public.v_manifiestos_fecha_ilegible AS
    SELECT 'MAESTRA'::text           AS fuente,
           m.id                      AS id_origen,
           m."FECHA"::text           AS fecha_texto,
           NULL::date                AS portal_flight_date,
           m."AEROLINEA"::text       AS aerolinea,
           m."# DE VUELO"::text      AS numero_vuelo,
           m."TIPO DE MANIFIESTO"::text AS tipo_manifiesto,
           m.tipo_reporte
      FROM public.maestra_manifiestos m
     WHERE public._aifa_fecha_manifiesto(m."FECHA"::text, NULL::date) IS NULL
    UNION ALL
    SELECT 'CONCILIACION', c.id, c."FECHA"::text, c."_portal_flight_date"::date,
           c."AEROLINEA"::text, c."# DE VUELO"::text, c."TIPO DE MANIFIESTO"::text, NULL::text
      FROM public."Conciliación Manifiestos" c
     WHERE public._aifa_fecha_manifiesto(c."FECHA"::text, c."_portal_flight_date"::date) IS NULL;
    COMMENT ON VIEW public.v_manifiestos_fecha_ilegible IS
        'Manifiestos que NO entran a manifiestos_hechos porque su FECHA no trae año legible '
        '(AAAA-MM-DD o DD/MM/AAAA) ni hay _portal_flight_date de respaldo (062b).';
    REVOKE ALL ON public.v_manifiestos_fecha_ilegible FROM anon, authenticated;

    -- ── Totales diarios del DETALLE, por categoría y según FECHA ─────────
    -- comercial/carga: manifiestos_resumen_dia (maestra <= corte_maestra,
    -- Conciliación después). general: aviacion_general_operaciones con la
    -- MISMA regla de fecha que aviacion_general_resumen (051): las llegadas
    -- por su fecha; las salidas, ancladas a su llegada, salvo 2024-2025 que
    -- van por fecha real. Así Inicio y FBO coinciden por construcción.
    CREATE OR REPLACE FUNCTION public.totales_detalle_por_dia(p_desde date, p_hasta date)
    RETURNS TABLE (fecha date, categoria text, operaciones bigint, pasajeros numeric, toneladas numeric)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $fn$
        SELECT r.fecha_reporte,
               CASE WHEN r.es_carga THEN 'carga' ELSE 'comercial' END,
               sum(r.operaciones)::bigint,
               sum(r.pax),
               sum(r.carga_kg) / 1000
          FROM public.manifiestos_resumen_dia r
         WHERE r.fecha_reporte BETWEEN p_desde AND p_hasta
         GROUP BY r.fecha_reporte, r.es_carga
        UNION ALL
        SELECT g.fecha_conteo, 'general', count(*)::bigint, coalesce(sum(g.pax_ag), 0)::numeric, NULL::numeric
          FROM (
            SELECT CASE
                       WHEN o.tipo_operacion = 'LLEGADA' THEN o.fecha_operacion
                       WHEN extract(year FROM o.fecha_operacion)::int IN (2024, 2025)
                         OR extract(year FROM a.ancla)::int IN (2024, 2025) THEN o.fecha_operacion
                       ELSE a.ancla
                   END AS fecha_conteo,
                   o.pax_ag
              FROM public.aviacion_general_operaciones o
             CROSS JOIN LATERAL (
                   SELECT public.aviacion_general_ancla(o.folio_rotacion, o.matricula, o.fecha_operacion) AS ancla
             ) a
             WHERE o.estatus_registro = 'ACTIVO'
               -- La fecha de conteo nunca es posterior a la del movimiento ni
               -- más de 60 días anterior (ver aviacion_general_ancla).
               AND o.fecha_operacion BETWEEN p_desde AND p_hasta + 60
          ) g
         WHERE g.fecha_conteo BETWEEN p_desde AND p_hasta
         GROUP BY g.fecha_conteo
         ORDER BY 1, 2
    $fn$;
    COMMENT ON FUNCTION public.totales_detalle_por_dia(date, date) IS
        'Detalle diario por categoría (comercial, carga, general) según la FECHA del manifiesto; '
        'AG con la regla de aviacion_general_resumen. Lo consume js/totales-service.js (062b).';
    REVOKE ALL ON FUNCTION public.totales_detalle_por_dia(date, date) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.totales_detalle_por_dia(date, date) TO authenticated;

    -- inicio_manifiestos_por_dia no cambia de cuerpo (lee manifiestos_resumen_dia,
    -- que desde aquí va por FECHA); sólo su descripción.
    COMMENT ON FUNCTION public.inicio_manifiestos_por_dia(date, date) IS
        'Totales diarios de Comercial y Carga, desde manifiestos_resumen_dia, por la FECHA del manifiesto. '
        'FECHA <= fn_fecha_corte_maestra(): maestra_manifiestos (por tipo_reporte); después: '
        '"Conciliación Manifiestos" (por aifa_regla_carga). Ya no usa CIERRE SUBSECRETARIA (062b).';
    COMMENT ON COLUMN public.manifiestos_hechos.fecha_reporte IS
        'Fecha en que cuenta el manifiesto: su FECHA (desde 062b; antes, el cierre de Subsecretaría).';
    COMMENT ON COLUMN public.manifiestos_hechos.fecha_cierre IS
        'Ya no se usa (062b): queda NULL.';


CREATE OR REPLACE FUNCTION public._mh_cargar(
    p_fuente     text,
    p_desde      date,
    p_hasta      date DEFAULT NULL,
    p_resumenes  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
-- Las auxiliares de 010/023 llevan bloque EXCEPTION y están marcadas
-- PARALLEL SAFE: en un plan paralelo abortan con "cannot start commands
-- during a parallel operation" (mismo motivo que en 033-045).
SET max_parallel_workers_per_gather = 0
-- La firma md5 incluye horas: con la zona fija sale igual desde pg_cron que
-- desde el editor SQL, y no se reescriben filas que no cambiaron.
SET TimeZone = 'UTC'
AS $$
DECLARE
    v_hasta     date := coalesce(p_hasta, DATE '9999-12-31');
    v_meses     date[];
    v_leidas    bigint;
    v_borradas  bigint;
    v_escritas  bigint;
    v_meses_n   integer := 0;
    -- Frontera del DETALLE (062b): maestra con FECHA <= corte, Conciliación > corte.
    v_corte     date := public.fn_fecha_corte_maestra();
BEGIN
    IF v_corte IS NULL THEN
        RAISE EXCEPTION 'Falta fecha_corte_maestra en config_fuentes.';
    END IF;
    IF p_fuente IS NULL OR p_fuente NOT IN ('MAESTRA', 'CONCILIACION') THEN
        RAISE EXCEPTION 'Fuente inválida: % (MAESTRA o CONCILIACION).', p_fuente;
    END IF;
    IF p_desde IS NULL OR v_hasta < p_desde THEN
        RAISE EXCEPTION 'Ventana inválida: % a %.', p_desde, p_hasta;
    END IF;

    DROP TABLE IF EXISTS pg_temp._mh_ids, pg_temp._mh_stage, pg_temp._mh_aer,
                         pg_temp._mh_des, pg_temp._mh_mat, pg_temp._mh_nuevo;

    -- Lo que ya está guardado en la ventana, más lo de esta fuente que quedó
    -- del otro lado de la frontera (se borra: así nunca se cuenta dos veces).
    CREATE TEMP TABLE _mh_ids ON COMMIT DROP AS
    SELECT h.id_origen, h.fecha_reporte, h.firma
      FROM public.manifiestos_hechos h
     WHERE h.fuente = p_fuente
       AND (h.fecha_operacion BETWEEN p_desde AND v_hasta
            OR (p_fuente = 'MAESTRA'      AND h.fecha_operacion >  v_corte)
            OR (p_fuente = 'CONCILIACION' AND h.fecha_operacion <= v_corte));
    CREATE UNIQUE INDEX ON pg_temp._mh_ids (id_origen);

    CREATE TEMP TABLE _mh_stage (
        id_origen bigint PRIMARY KEY, fecha_operacion date, fecha_cierre date, fecha_reporte date,
        direccion text, tipo_manifiesto text, aerolinea_texto text, tipo_reporte text,
        cierre_es_carga boolean, tipo_operacion text, destino_texto text, numero_vuelo text,
        aeronave text, matricula text, slot_asignado timestamptz, hora_operacion timestamptz,
        hora_recepcion timestamptz, capturado boolean, puntualidad text, demora_15_min text,
        codigo_demora text, pax numeric, equipaje_kg numeric, carga_kg numeric,
        carga_nacional_kg numeric, carga_internacional_kg numeric, correo_kg numeric,
        pax_infantes numeric, pax_transitos numeric, pax_conexiones numeric,
        pax_exentos numeric, pax_pagan_tua numeric
    ) ON COMMIT DROP;

    IF p_fuente = 'MAESTRA' THEN
        INSERT INTO pg_temp._mh_stage
        SELECT m.id, f.fecha_operacion, NULL::date, f.fecha_operacion,
               public._aifa_manifest_direction(m."TIPO DE MANIFIESTO"),
               nullif(upper(btrim(m."TIPO DE MANIFIESTO")), ''),
               nullif(btrim(m."AEROLINEA"), ''),
               m.tipo_reporte,
               NULL::boolean,
               nullif(btrim(m."TIPO DE OPERACIÓN"), ''),
               nullif(btrim(m."DESTINO / ORIGEN"), ''),
               nullif(btrim(m."# DE VUELO"), ''),
               nullif(btrim(m."AERONAVE"), ''),
               nullif(upper(btrim(m."MATRÍCULA")), ''),
               public._aifa_parse_manifest_ts(m."SLOT ASIGNADO", f.fecha_operacion),
               public._aifa_parse_manifest_ts(m."HR. DE OPERACIÓN", f.fecha_operacion),
               public._aifa_parse_manifest_ts(m."HR. DE RECEPCIÓN", f.fecha_operacion),
               nullif(btrim(m."HR. DE RECEPCIÓN"), '') IS NOT NULL,
               nullif(btrim(m."PUNTUALIDAD / CANCELACIÓN"), ''),
               nullif(btrim(m."DEMORA +- 15 MIN."), ''),
               nullif(btrim(m."CÓDIGO DEMORA"), ''),
               public._aifa_safe_numeric(m."TOTAL PAX"::text),
               public._aifa_safe_numeric(m."KGS. DE EQUIPAJE"::text),
               public._aifa_safe_numeric(m."KG DE CARGA TOTAL"::text),
               public._aifa_safe_numeric(m."KGS. DE CARGA NACIONAL"::text),
               public._aifa_safe_numeric(m."KGS. DE CARGA INTERNACIONAL"::text),
               public._aifa_safe_numeric(m."CORREO"::text),
               public._aifa_safe_numeric(m."INFANTES"::text),
               public._aifa_safe_numeric(m."TRANSITOS"::text),
               public._aifa_safe_numeric(m."CONEXIONES"::text),
               public._aifa_safe_numeric(m."TOTAL EXENTOS"::text),
               public._aifa_safe_numeric(m."PAX QUE PAGAN TUA"::text)
          FROM public.maestra_manifiestos m
         CROSS JOIN LATERAL (
               SELECT public._aifa_fecha_manifiesto(m."FECHA"::text, NULL::date) AS fecha_operacion
         ) f
         WHERE f.fecha_operacion IS NOT NULL
           AND f.fecha_operacion <= v_corte
           AND (f.fecha_operacion BETWEEN p_desde AND v_hasta
                OR m.id IN (SELECT i.id_origen FROM pg_temp._mh_ids i));
    ELSE
        INSERT INTO pg_temp._mh_stage
        SELECT c.id, f.fecha_operacion, NULL::date, f.fecha_operacion,
               public._aifa_manifest_direction(c."TIPO DE MANIFIESTO"::text),
               nullif(upper(btrim(c."TIPO DE MANIFIESTO"::text)), ''),
               nullif(btrim(c."AEROLINEA"::text), ''),
               NULL::text,
               c.cierre_es_carga_reportado,
               nullif(btrim(c."TIPO DE OPERACIÓN"::text), ''),
               nullif(btrim(c."DESTINO / ORIGEN"::text), ''),
               nullif(btrim(c."# DE VUELO"::text), ''),
               nullif(btrim(c."AERONAVE"::text), ''),
               nullif(upper(btrim(c."MATRÍCULA"::text)), ''),
               public._aifa_parse_manifest_ts(c."SLOT ASIGNADO"::text, f.fecha_operacion),
               public._aifa_parse_manifest_ts(c."HR. DE OPERACIÓN"::text, f.fecha_operacion),
               public._aifa_parse_manifest_ts(c."HR. DE RECEPCIÓN"::text, f.fecha_operacion),
               nullif(btrim(c."HR. DE RECEPCIÓN"::text), '') IS NOT NULL,
               nullif(btrim(c."PUNTUALIDAD / CANCELACIÓN"::text), ''),
               nullif(btrim(c."DEMORA +- 15 MIN."::text), ''),
               nullif(btrim(c."CÓDIGO DEMORA"::text), ''),
               public._aifa_safe_numeric(c."TOTAL PAX"::text),
               public._aifa_safe_numeric(c."KGS. DE EQUIPAJE"::text),
               public._aifa_safe_numeric(c."KG DE CARGA TOTAL"::text),
               public._aifa_safe_numeric(c."KGS. DE CARGA NACIONAL"::text),
               public._aifa_safe_numeric(c."KGS. DE CARGA INTERNACIONAL"::text),
               public._aifa_safe_numeric(c."CORREO"::text),
               public._aifa_safe_numeric(c."INFANTES"::text),
               public._aifa_safe_numeric(c."TRANSITOS"::text),
               public._aifa_safe_numeric(c."CONEXIONES"::text),
               public._aifa_safe_numeric(c."TOTAL EXENTOS"::text),
               public._aifa_safe_numeric(c."PAX QUE PAGAN TUA"::text)
          FROM public."Conciliación Manifiestos" c
         CROSS JOIN LATERAL (
               SELECT public._aifa_fecha_manifiesto(c."FECHA"::text, c."_portal_flight_date"::date) AS fecha_operacion
         ) f
         -- Sin prefiltro por _portal_flight_date: la fecha manda la FECHA y
         -- el respaldo sólo aplica cuando no trae año.
         WHERE f.fecha_operacion IS NOT NULL
           AND f.fecha_operacion > v_corte
           AND (f.fecha_operacion BETWEEN p_desde AND v_hasta
                OR c.id IN (SELECT i.id_origen FROM pg_temp._mh_ids i));
    END IF;
    GET DIAGNOSTICS v_leidas = ROW_COUNT;

    -- Aerolíneas, destinos y matrículas: se resuelven UNA vez por valor
    -- distinto, con las mismas claves (y el mismo orden de desempate) que
    -- aifa_resolver_aerolinea() / aifa_resolver_destino(). Los catálogos se
    -- copian primero a tablas temporales para no recalcular sus claves en
    -- cada comparación, y cada criterio va en su propio join por igualdad.
    DROP TABLE IF EXISTS pg_temp._mh_cat_aer, pg_temp._mh_cat_ap;
    CREATE TEMP TABLE _mh_cat_aer ON COMMIT DROP AS SELECT * FROM public.v_aifa_aerolineas_claves;
    CREATE TEMP TABLE _mh_cat_ap  ON COMMIT DROP AS SELECT * FROM public.v_aifa_aeropuertos_claves;

    CREATE TEMP TABLE _mh_aer ON COMMIT DROP AS
    WITH t AS (
        SELECT DISTINCT s.aerolinea_texto AS txt,
               upper(s.aerolinea_texto) AS up,
               public._aifa_norm_texto(s.aerolinea_texto) AS norm
          FROM pg_temp._mh_stage s
         WHERE s.aerolinea_texto IS NOT NULL
    ), cand AS (
        SELECT t.txt, 1 AS prioridad, k.id, k.name, k.iata, k.types
          FROM t JOIN pg_temp._mh_cat_aer k ON k.tipo_clave = 'iata' AND k.clave = t.up
        UNION ALL
        SELECT t.txt, 2, k.id, k.name, k.iata, k.types
          FROM t JOIN pg_temp._mh_cat_aer k ON k.tipo_clave = 'nombre' AND k.clave = t.norm
    )
    SELECT DISTINCT ON (t.txt) t.txt, c.id AS catalogo_id, c.name AS nombre, c.iata, c.types
      FROM t LEFT JOIN cand c ON c.txt = t.txt
     ORDER BY t.txt, c.prioridad NULLS LAST, c.id;

    CREATE TEMP TABLE _mh_des ON COMMIT DROP AS
    WITH t AS (
        SELECT DISTINCT s.destino_texto AS txt, s.direccion AS dir,
               upper(s.destino_texto) AS up,
               public._aifa_norm_texto(s.destino_texto) AS norm,
               CASE WHEN upper(s.destino_texto) ~ '[^A-Z0-9 ]'
                    THEN public._aifa_route_endpoint(s.destino_texto, coalesce(s.direccion, 'D')) END AS ruta
          FROM pg_temp._mh_stage s
         WHERE s.destino_texto IS NOT NULL
    ), cand AS (
        SELECT t.txt, t.dir, 1 AS prioridad, k.iata, k.ciudad, k.pais
          FROM t JOIN pg_temp._mh_cat_ap k ON k.tipo_clave = 'iata' AND k.clave = t.up
        UNION ALL
        SELECT t.txt, t.dir, 2, k.iata, k.ciudad, k.pais
          FROM t JOIN pg_temp._mh_cat_ap k ON k.tipo_clave = 'ciudad' AND k.clave = t.norm
        UNION ALL
        SELECT t.txt, t.dir, 3, k.iata, k.ciudad, k.pais
          FROM t JOIN pg_temp._mh_cat_ap k ON k.tipo_clave = 'iata' AND k.clave = t.ruta
    )
    SELECT DISTINCT ON (t.txt, t.dir) t.txt, t.dir,
           coalesce(c.iata, t.up)    AS codigo,
           coalesce(c.ciudad, t.txt) AS ciudad,
           c.pais,
           (c.iata IS NOT NULL)      AS resuelto
      FROM t LEFT JOIN cand c ON c.txt = t.txt AND c.dir IS NOT DISTINCT FROM t.dir
     ORDER BY t.txt, t.dir, c.prioridad NULLS LAST, c.iata;

    CREATE TEMP TABLE _mh_mat ON COMMIT DROP AS
    SELECT DISTINCT ON (upper(btrim(mm.matricula))) upper(btrim(mm.matricula)) AS matricula, mm.pasajeros
      FROM public.matriculas_manifiestos mm
     WHERE mm.pasajeros > 0
       AND upper(btrim(mm.matricula)) IN (SELECT s.matricula FROM pg_temp._mh_stage s WHERE s.matricula IS NOT NULL)
     ORDER BY upper(btrim(mm.matricula)), mm.id DESC;

    -- Filas ya normalizadas, con su firma.
    CREATE TEMP TABLE _mh_nuevo ON COMMIT DROP AS
    SELECT x.*, md5(x::text) AS firma
      FROM (
        SELECT
            p_fuente                                             AS fuente,
            s.id_origen,
            s.fecha_operacion,
            s.fecha_cierre,
            s.fecha_reporte,
            extract(year  FROM s.fecha_reporte)::smallint        AS anio,
            extract(month FROM s.fecha_reporte)::smallint        AS mes,
            extract(day   FROM s.fecha_reporte)::smallint        AS dia,
            s.direccion,
            s.tipo_manifiesto,
            s.aerolinea_texto,
            coalesce(a.nombre, public._aifa_aerolinea_por_omision(s.aerolinea_texto), s.aerolinea_texto) AS aerolinea,
            coalesce(a.iata, CASE WHEN public._aifa_aerolinea_por_omision(s.aerolinea_texto) IS NOT NULL
                                  THEN upper(s.aerolinea_texto) END)  AS aerolinea_codigo,
            a.catalogo_id                                        AS aerolinea_catalogo_id,
            (s.aerolinea_texto IS NOT NULL)                      AS es_operacion,
            CASE WHEN p_fuente = 'MAESTRA' THEN upper(coalesce(s.tipo_reporte, '')) = 'CARGA'
                 ELSE cl.motivo LIKE '%\_carga' END              AS es_carga,
            CASE WHEN p_fuente = 'MAESTRA' THEN 'tipo_reporte_' || lower(coalesce(s.tipo_reporte, 'sin_dato'))
                 ELSE cl.motivo END                              AS clasificacion_origen,
            s.tipo_operacion,
            s.destino_texto,
            d.codigo                                             AS destino,
            d.ciudad                                             AS destino_ciudad,
            d.pais                                               AS destino_pais,
            coalesce(d.resuelto, false)                          AS destino_resuelto,
            public._aifa_nacional_internacional(s.tipo_operacion, d.codigo, d.pais) AS nacional_internacional,
            CASE
                WHEN public._aifa_norm_texto(s.tipo_operacion) LIKE 'nac%'
                  OR public._aifa_norm_texto(s.tipo_operacion) LIKE 'int%' THEN 'declarado'
                WHEN public._aifa_nacional_internacional(NULL, d.codigo, d.pais) IS NOT NULL THEN 'catalogo'
                ELSE 'sin_determinar'
            END                                                  AS nacint_origen,
            s.numero_vuelo,
            s.aeronave,
            s.matricula,
            mt.pasajeros                                         AS capacidad_pax,
            s.slot_asignado,
            s.hora_operacion,
            s.hora_recepcion,
            sl.minutos                                           AS minutos_vs_slot,
            coalesce(
                CASE
                    WHEN sl.minutos IS NULL THEN NULL
                    WHEN sl.minutos < -15 THEN 'ANTICIPADO'
                    WHEN sl.minutos <= -1 THEN 'ANTES'
                    WHEN sl.minutos = 0   THEN 'EN TIEMPO'
                    WHEN sl.minutos <= 15 THEN 'DESPUÉS'
                    ELSE 'DEMORA'
                END,
                CASE public._estadistica_norm(s.puntualidad)
                    WHEN 'ANTICIPADO' THEN 'ANTICIPADO'
                    WHEN 'ANTES'      THEN 'ANTES'
                    WHEN 'ENTIEMPO'   THEN 'EN TIEMPO'
                    WHEN 'DESPUES'    THEN 'DESPUÉS'
                    WHEN 'DEMORA'     THEN 'DEMORA'
                    WHEN 'DEMORADO'   THEN 'DEMORA'
                END)                                             AS clasificacion_slot,
            s.puntualidad,
            s.demora_15_min,
            s.codigo_demora,
            (upper(coalesce(s.puntualidad, '')) LIKE '%CANCEL%') AS cancelado,
            s.capturado,
            s.pax,
            s.equipaje_kg,
            s.carga_kg,
            s.carga_nacional_kg,
            s.carga_internacional_kg,
            s.correo_kg,
            s.pax_infantes,
            s.pax_transitos,
            s.pax_conexiones,
            s.pax_exentos,
            s.pax_pagan_tua
          FROM pg_temp._mh_stage s
          LEFT JOIN pg_temp._mh_aer a ON a.txt = s.aerolinea_texto
          LEFT JOIN pg_temp._mh_des d ON d.txt = s.destino_texto AND d.dir IS NOT DISTINCT FROM s.direccion
          LEFT JOIN pg_temp._mh_mat mt ON mt.matricula = s.matricula
          CROSS JOIN LATERAL (
              SELECT CASE WHEN p_fuente = 'CONCILIACION' THEN
                         public.aifa_regla_carga(
                             a.types,
                             coalesce(a.nombre, public._aifa_aerolinea_por_omision(s.aerolinea_texto), s.aerolinea_texto),
                             s.tipo_operacion,
                             s.cierre_es_carga)
                     END AS motivo
          ) cl
          CROSS JOIN LATERAL (
              SELECT CASE
                         WHEN s.slot_asignado IS NOT NULL AND s.hora_operacion IS NOT NULL
                          AND extract(epoch FROM (s.hora_operacion - s.slot_asignado)) / 60.0 BETWEEN -720 AND 2880
                         THEN round(extract(epoch FROM (s.hora_operacion - s.slot_asignado)) / 60.0)
                     END AS minutos
          ) sl
      ) x;

    -- Meses que cambian: los de la fecha vieja y los de la nueva de cada fila
    -- borrada, nueva o con firma distinta.
    SELECT array_agg(DISTINCT date_trunc('month', z.f)::date) INTO v_meses
      FROM (
        SELECT i.fecha_reporte AS f
          FROM pg_temp._mh_ids i
         WHERE NOT EXISTS (SELECT 1 FROM pg_temp._mh_nuevo n WHERE n.id_origen = i.id_origen)
        UNION
        SELECT h.fecha_reporte
          FROM pg_temp._mh_nuevo n
          JOIN public.manifiestos_hechos h ON h.fuente = p_fuente AND h.id_origen = n.id_origen
         WHERE h.firma IS DISTINCT FROM n.firma
        UNION
        SELECT n.fecha_reporte
          FROM pg_temp._mh_nuevo n
          LEFT JOIN public.manifiestos_hechos h ON h.fuente = p_fuente AND h.id_origen = n.id_origen
         WHERE h.firma IS DISTINCT FROM n.firma
      ) z;

    DELETE FROM public.manifiestos_hechos h
     USING pg_temp._mh_ids i
     WHERE h.fuente = p_fuente
       AND h.id_origen = i.id_origen
       AND NOT EXISTS (SELECT 1 FROM pg_temp._mh_nuevo n WHERE n.id_origen = i.id_origen);
    GET DIAGNOSTICS v_borradas = ROW_COUNT;

    INSERT INTO public.manifiestos_hechos AS h (
        fuente, id_origen, fecha_operacion, fecha_cierre, fecha_reporte, anio, mes, dia,
        direccion, tipo_manifiesto, aerolinea_texto, aerolinea, aerolinea_codigo,
        aerolinea_catalogo_id, es_operacion, es_carga, clasificacion_origen, tipo_operacion,
        destino_texto, destino, destino_ciudad, destino_pais, destino_resuelto,
        nacional_internacional, nacint_origen, numero_vuelo, aeronave, matricula, capacidad_pax,
        slot_asignado, hora_operacion, hora_recepcion, minutos_vs_slot, clasificacion_slot,
        puntualidad, demora_15_min, codigo_demora, cancelado, capturado, pax, equipaje_kg,
        carga_kg, carga_nacional_kg, carga_internacional_kg, correo_kg, pax_infantes,
        pax_transitos, pax_conexiones, pax_exentos, pax_pagan_tua, firma, actualizado_at)
    SELECT
        n.fuente, n.id_origen, n.fecha_operacion, n.fecha_cierre, n.fecha_reporte, n.anio, n.mes, n.dia,
        n.direccion, n.tipo_manifiesto, n.aerolinea_texto, n.aerolinea, n.aerolinea_codigo,
        n.aerolinea_catalogo_id, n.es_operacion, n.es_carga, n.clasificacion_origen, n.tipo_operacion,
        n.destino_texto, n.destino, n.destino_ciudad, n.destino_pais, n.destino_resuelto,
        n.nacional_internacional, n.nacint_origen, n.numero_vuelo, n.aeronave, n.matricula, n.capacidad_pax,
        n.slot_asignado, n.hora_operacion, n.hora_recepcion, n.minutos_vs_slot, n.clasificacion_slot,
        n.puntualidad, n.demora_15_min, n.codigo_demora, n.cancelado, n.capturado, n.pax, n.equipaje_kg,
        n.carga_kg, n.carga_nacional_kg, n.carga_internacional_kg, n.correo_kg, n.pax_infantes,
        n.pax_transitos, n.pax_conexiones, n.pax_exentos, n.pax_pagan_tua, n.firma, now()
      FROM pg_temp._mh_nuevo n
    ON CONFLICT (fuente, id_origen) DO UPDATE SET
        fecha_operacion = EXCLUDED.fecha_operacion, fecha_cierre = EXCLUDED.fecha_cierre,
        fecha_reporte = EXCLUDED.fecha_reporte, anio = EXCLUDED.anio, mes = EXCLUDED.mes, dia = EXCLUDED.dia,
        direccion = EXCLUDED.direccion, tipo_manifiesto = EXCLUDED.tipo_manifiesto,
        aerolinea_texto = EXCLUDED.aerolinea_texto, aerolinea = EXCLUDED.aerolinea,
        aerolinea_codigo = EXCLUDED.aerolinea_codigo, aerolinea_catalogo_id = EXCLUDED.aerolinea_catalogo_id,
        es_operacion = EXCLUDED.es_operacion, es_carga = EXCLUDED.es_carga,
        clasificacion_origen = EXCLUDED.clasificacion_origen, tipo_operacion = EXCLUDED.tipo_operacion,
        destino_texto = EXCLUDED.destino_texto, destino = EXCLUDED.destino,
        destino_ciudad = EXCLUDED.destino_ciudad, destino_pais = EXCLUDED.destino_pais,
        destino_resuelto = EXCLUDED.destino_resuelto, nacional_internacional = EXCLUDED.nacional_internacional,
        nacint_origen = EXCLUDED.nacint_origen, numero_vuelo = EXCLUDED.numero_vuelo,
        aeronave = EXCLUDED.aeronave, matricula = EXCLUDED.matricula, capacidad_pax = EXCLUDED.capacidad_pax,
        slot_asignado = EXCLUDED.slot_asignado, hora_operacion = EXCLUDED.hora_operacion,
        hora_recepcion = EXCLUDED.hora_recepcion, minutos_vs_slot = EXCLUDED.minutos_vs_slot,
        clasificacion_slot = EXCLUDED.clasificacion_slot, puntualidad = EXCLUDED.puntualidad,
        demora_15_min = EXCLUDED.demora_15_min, codigo_demora = EXCLUDED.codigo_demora,
        cancelado = EXCLUDED.cancelado, capturado = EXCLUDED.capturado, pax = EXCLUDED.pax,
        equipaje_kg = EXCLUDED.equipaje_kg, carga_kg = EXCLUDED.carga_kg,
        carga_nacional_kg = EXCLUDED.carga_nacional_kg, carga_internacional_kg = EXCLUDED.carga_internacional_kg,
        correo_kg = EXCLUDED.correo_kg, pax_infantes = EXCLUDED.pax_infantes,
        pax_transitos = EXCLUDED.pax_transitos, pax_conexiones = EXCLUDED.pax_conexiones,
        pax_exentos = EXCLUDED.pax_exentos, pax_pagan_tua = EXCLUDED.pax_pagan_tua,
        firma = EXCLUDED.firma, actualizado_at = now()
     WHERE h.firma IS DISTINCT FROM EXCLUDED.firma;
    GET DIAGNOSTICS v_escritas = ROW_COUNT;

    IF p_resumenes AND v_meses IS NOT NULL THEN
        v_meses_n := public._mh_recalcular_resumenes(v_meses);
    END IF;

    DROP TABLE IF EXISTS pg_temp._mh_ids, pg_temp._mh_stage, pg_temp._mh_aer,
                         pg_temp._mh_des, pg_temp._mh_mat, pg_temp._mh_nuevo,
                         pg_temp._mh_cat_aer, pg_temp._mh_cat_ap;

    RETURN jsonb_build_object(
        'fuente', p_fuente, 'desde', p_desde, 'hasta', p_hasta,
        'leidas', v_leidas, 'escritas', v_escritas, 'borradas', v_borradas,
        'meses_resumen', v_meses_n, 'corte_maestra', v_corte);
END;
$$;

CREATE OR REPLACE FUNCTION public.manifiestos_hechos_refrescar(p_dias integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET max_parallel_workers_per_gather = 0
AS $$
DECLARE
    v_inicio timestamptz := clock_timestamp();
    v_desde  date;
    v_r      jsonb;
    v_ms     integer;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('manifiestos_hechos')::bigint) THEN
        RETURN jsonb_build_object('omitido', 'otro refresco en curso');
    END IF;

    v_desde := greatest((now() AT TIME ZONE 'America/Mexico_City')::date - greatest(coalesce(p_dias, 60), 1),
                        public.fn_fecha_corte_maestra() + 1);
    v_r := public._mh_cargar('CONCILIACION', v_desde, NULL, true);
    v_ms := (extract(epoch FROM clock_timestamp() - v_inicio) * 1000)::int;

    INSERT INTO public.manifiestos_hechos_refresco (id, refrescado_at, duracion_ms, detalle)
    VALUES (true, now(), v_ms, v_r)
    ON CONFLICT (id) DO UPDATE
        SET refrescado_at = excluded.refrescado_at, duracion_ms = excluded.duracion_ms,
            detalle = excluded.detalle;

    -- Las etiquetas "Datos al …" de Estadística y del Informe.
    IF to_regclass('public.estadistica_refresco') IS NOT NULL THEN
        UPDATE public.estadistica_refresco
           SET refrescado_at = now(), duracion_ms = v_ms
         WHERE id = 1;
    END IF;
    IF to_regclass('public.informe_estadistico_refresco') IS NOT NULL THEN
        INSERT INTO public.informe_estadistico_refresco (id, refrescado_at, duracion_ms)
        VALUES (true, now(), v_ms)
        ON CONFLICT (id) DO UPDATE
            SET refrescado_at = excluded.refrescado_at, duracion_ms = excluded.duracion_ms;
    END IF;

    RETURN v_r || jsonb_build_object('duracion_ms', v_ms);
END;
$$;

CREATE OR REPLACE FUNCTION public.manifiestos_hechos_rehacer_mes(p_anio integer, p_mes integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET max_parallel_workers_per_gather = 0
AS $$
DECLARE
    v_ini date;
    v_fin date;
BEGIN
    IF p_anio IS NULL OR p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'Mes inválido: %-%', p_anio, p_mes;
    END IF;
    v_ini := make_date(p_anio, p_mes, 1);
    v_fin := (v_ini + interval '1 month - 1 day')::date;
    PERFORM pg_advisory_xact_lock(hashtext('manifiestos_hechos')::bigint);
    -- Las dos fuentes, siempre: cada una toma sólo su lado de la frontera
    -- (fn_fecha_corte_maestra) y borra lo suyo que haya quedado del otro.
    RETURN jsonb_build_object(
        'maestra',      public._mh_cargar('MAESTRA', v_ini, v_fin, true),
        'conciliacion', public._mh_cargar('CONCILIACION', v_ini, v_fin, true));
END;
$$;

    REVOKE ALL ON FUNCTION public._mh_cargar(text, date, date, boolean) FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.manifiestos_hechos_refrescar(integer) FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.manifiestos_hechos_rehacer_mes(integer, integer) FROM PUBLIC, anon, authenticated;

    _corte := public.fn_fecha_corte_maestra();
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(), 'corte maestra ' || _corte);

    _paso := 'F62 3 maestra hasta 2025 por FECHA';
    _ini := clock_timestamp();
    _r := public._mh_cargar('MAESTRA', DATE '1900-01-01', DATE '2025-12-31', true);
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle) VALUES (_paso, _ini, clock_timestamp(), _r::text);

    -- 2026 en adelante, mes por mes, las dos fuentes (cada una toma su lado).
    _mes := DATE '2026-01-01';
    _hasta := date_trunc('month', greatest((now() AT TIME ZONE 'America/Mexico_City')::date, _corte))::date;
    WHILE _mes <= _hasta LOOP
        _paso := 'F62 4 mes ' || to_char(_mes, 'YYYY-MM');
        _ini := clock_timestamp();
        _r := public.manifiestos_hechos_rehacer_mes(extract(year FROM _mes)::int, extract(month FROM _mes)::int);
        INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle) VALUES (_paso, _ini, clock_timestamp(), _r::text);
        _mes := (_mes + interval '1 month')::date;
    END LOOP;

    -- Lo de Conciliación con FECHA posterior al mes en curso (vuelos ya dados de alta).
    _paso := 'F62 5 Conciliación posterior';
    _ini := clock_timestamp();
    _r := public._mh_cargar('CONCILIACION', _mes, NULL, true);
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle) VALUES (_paso, _ini, clock_timestamp(), _r::text);

    -- ── Verificación ─────────────────────────────────────────────────────
    _paso := 'F62 6 verificación';
    _ini := clock_timestamp();

    SELECT count(*) INTO _n FROM public.manifiestos_hechos WHERE fuente = 'CONCILIACION' AND fecha_operacion <= _corte;
    IF _n > 0 THEN RAISE EXCEPTION '% filas de Conciliación con FECHA <= corte maestra (%).', _n, _corte; END IF;

    SELECT count(*) INTO _n FROM public.manifiestos_hechos WHERE fuente = 'MAESTRA' AND fecha_operacion > _corte;
    IF _n > 0 THEN RAISE EXCEPTION '% filas de maestra con FECHA > corte maestra (%).', _n, _corte; END IF;

    SELECT count(*) INTO _n FROM public.manifiestos_hechos WHERE fecha_reporte IS DISTINCT FROM fecha_operacion;
    IF _n > 0 THEN RAISE EXCEPTION '% filas con fecha_reporte distinta de la FECHA.', _n; END IF;

    SELECT count(*) INTO _n
      FROM (SELECT fecha_operacion, upper(numero_vuelo) AS vuelo, direccion
              FROM public.manifiestos_hechos
             WHERE numero_vuelo IS NOT NULL
             GROUP BY 1, 2, 3
            HAVING count(DISTINCT fuente) > 1) d;
    IF _n > 0 THEN RAISE EXCEPTION '% manifiestos (fecha + vuelo + sentido) aparecen en las dos fuentes.', _n; END IF;

    SELECT coalesce(sum(manifiestos), 0) INTO _n FROM public.manifiestos_resumen_dia;
    SELECT count(*) INTO _n2 FROM public.manifiestos_hechos;
    IF _n <> _n2 THEN RAISE EXCEPTION 'Los resúmenes (%) no suman lo mismo que los hechos (%).', _n, _n2; END IF;

    SELECT count(*) INTO _n FROM public.manifiestos_hechos
     WHERE fuente = 'MAESTRA' AND fecha_operacion >= DATE '2026-01-01'
       AND clasificacion_origen NOT IN ('tipo_reporte_pasajeros', 'tipo_reporte_carga');
    IF _n > 0 THEN RAISE EXCEPTION '% filas de maestra 2026 sin tipo_reporte PASAJEROS/CARGA: no se pueden clasificar.', _n; END IF;

    SELECT string_agg(to_char(o.fecha_mes, 'YYYY-MM'), ', ') INTO _txt
      FROM (SELECT make_date(anio, mes, 1) AS fecha_mes, operaciones
              FROM public.cifras_oficiales_mensuales
             WHERE categoria = 'comercial' AND make_date(anio, mes, 1) BETWEEN DATE '2026-01-01' AND _corte) o
     WHERE coalesce(o.operaciones, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.manifiestos_hechos h
                        WHERE h.fuente = 'MAESTRA' AND h.es_operacion
                          AND h.fecha_operacion >= o.fecha_mes
                          AND h.fecha_operacion < (o.fecha_mes + interval '1 month')::date);
    IF _txt IS NOT NULL THEN RAISE EXCEPTION 'Meses con cifra oficial pero sin manifiestos en la maestra: %.', _txt; END IF;

    -- Informativo: maestra vs oficial por mes (2026 hasta el corte de la maestra).
    SELECT string_agg(format('%s %s: maestra %s / oficial %s (%s%%)',
                             to_char(x.fecha_mes, 'YYYY-MM'), x.categoria, x.maestra, x.oficial,
                             CASE WHEN x.oficial > 0 THEN round(100.0 * (x.maestra - x.oficial) / x.oficial, 1) END),
                      ' · ' ORDER BY x.fecha_mes, x.categoria)
      INTO _txt
      FROM (
        SELECT make_date(o.anio, o.mes, 1) AS fecha_mes, o.categoria,
               coalesce(o.operaciones, 0) AS oficial,
               (SELECT count(*) FROM public.manifiestos_hechos h
                 WHERE h.fuente = 'MAESTRA' AND h.es_operacion
                   AND h.es_carga = (o.categoria = 'carga')
                   AND h.fecha_operacion >= make_date(o.anio, o.mes, 1)
                   AND h.fecha_operacion < (make_date(o.anio, o.mes, 1) + interval '1 month')::date) AS maestra
          FROM public.cifras_oficiales_mensuales o
         WHERE o.categoria IN ('comercial', 'carga')
           AND make_date(o.anio, o.mes, 1) BETWEEN DATE '2026-01-01' AND _corte
      ) x;
    SELECT count(*) INTO _n FROM public.v_manifiestos_fecha_ilegible;
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(),
            'OK · ' || _n || ' filas con FECHA ilegible (v_manifiestos_fecha_ilegible) · ops maestra vs oficial: '
            || coalesce(_txt, 'sin meses'));

    _paso := 'F62 7 analyze';
    BEGIN
        ANALYZE public.manifiestos_hechos;
        ANALYZE public.manifiestos_resumen_dia;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES ('FIN', clock_timestamp(), clock_timestamp(), 'OK');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._mig_paso_log (paso, inicio, fin, error)
    VALUES (_paso, _ini, clock_timestamp(), SQLSTATE || ': ' || SQLERRM);
END
$do$;
$job$
);

-- Confirmación visible: un renglón = agendada; en <= 1 minuto arranca y
-- desaparece de aquí. Sigue con 062b_seguimiento.sql.
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mig_062b_frontera';
