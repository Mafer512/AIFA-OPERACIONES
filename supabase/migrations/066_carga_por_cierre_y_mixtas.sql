-- =============================================================================
-- 066 · Inicio: la carga por la clasificación del cierre, y las mixtas sin operación
-- (selecciona todo y Run). Después corre, aparte, el rehacer de septiembre y octubre.
--
-- Problema (20/10/2026): el Inicio daba 13 operaciones / 444.78 t de carga y el
-- libro 15 / 499.24. public.aifa_regla_carga() revisa primero el catálogo, y
-- COPA CARGO ("CM") y MEXICANA ("XN") están ahí como aerolíneas de pasajeros:
-- sus manifiestos de carga, aunque se cerraron como carga, caían en Comercial
-- (que además sumaba esas 6 operaciones de más).
--
-- Qué cambia, sólo en public._mh_cargar() (copia exacta de 062b con tres ajustes):
--   1. Si el manifiesto se cerró con la clasificación congelada
--      (cierre_es_carga_reportado), ésa manda, como en el oficio a la
--      Subsecretaría y el mensaje del SWEAR. Sin ella, la regla de siempre.
--   2. Mixtas: la carga de una aerolínea de pasajeros (AEROMÉXICO, CONVIASA,
--      MEXICANA, VIVA AEROBUS y VOLARIS, las mismas del oficio de carga) suma
--      sus kilos a Carga pero no cuenta como operación: el vuelo ya está en su
--      manifiesto de pasajeros. Con ella el REPORTE CARGA del libro da sus 769
--      operaciones al 20/10/2026. Copa (Copa Cargo) sí es operación de carga.
--   3. La aerolínea reportada al cerrar (cierre_aerolinea_reportada) se usa
--      para reconocer la mixta; COPA CARGO no es mixta aunque comparta "CM".
-- No toca la maestra (hasta el corte), ni tablas, ni los manifiestos.
-- Reversa: correr de nuevo la definición de _mh_cargar de 062b_frontera_y_fecha.sql.
-- =============================================================================

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
COMMENT ON FUNCTION public.aifa_aerolinea_mixta(text) IS
    'Aerolínea de pasajeros que también lleva carga: su manifiesto de carga suma kilos a Carga pero no es operación (066).';
REVOKE ALL ON FUNCTION public.aifa_aerolinea_mixta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aifa_aerolinea_mixta(text) TO authenticated;

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
        pax_exentos numeric, pax_pagan_tua numeric,
        aerolinea_reportada text   -- 066: cierre_aerolinea_reportada (Conciliación)
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
               public._aifa_safe_numeric(m."PAX QUE PAGAN TUA"::text),
               NULL::text
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
               public._aifa_safe_numeric(c."PAX QUE PAGAN TUA"::text),
               nullif(btrim(c.cierre_aerolinea_reportada::text), '')
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
            (s.aerolinea_texto IS NOT NULL
             AND NOT (p_fuente = 'CONCILIACION' AND cl.motivo LIKE '%\_carga'
                      AND public.aifa_aerolinea_mixta(coalesce(s.aerolinea_reportada, a.nombre, s.aerolinea_texto))))
                                                                 AS es_operacion,
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
                         CASE WHEN s.cierre_es_carga IS TRUE  THEN 'cierre_carga'
                              WHEN s.cierre_es_carga IS FALSE THEN 'cierre_pasajeros'
                              ELSE
                         public.aifa_regla_carga(
                             a.types,
                             coalesce(a.nombre, public._aifa_aerolinea_por_omision(s.aerolinea_texto), s.aerolinea_texto),
                             s.tipo_operacion,
                             s.cierre_es_carga)
                         END
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

REVOKE ALL ON FUNCTION public._mh_cargar(text, date, date, boolean) FROM PUBLIC, anon, authenticated;

-- Comprobación de la regla (no toca nada).
SELECT 'mixta: MEXICANA = ' || public.aifa_aerolinea_mixta('MEXICANA')          AS prueba
UNION ALL SELECT 'mixta: VIVA AEROBUS = ' || public.aifa_aerolinea_mixta('Viva Aerobus')
UNION ALL SELECT 'mixta: COPA CARGO = ' || public.aifa_aerolinea_mixta('COPA CARGO')
UNION ALL SELECT 'mixta: CATHAY PACIFIC = ' || public.aifa_aerolinea_mixta('CATHAY PACIFIC');

-- -----------------------------------------------------------------------------
-- DESPUÉS (en otra ejecución): rehace septiembre y octubre con la regla nueva y
-- muestra el 20/10/2026 (debe dar carga 15 operaciones / 499.24 t con los
-- manifiestos con cierre, más los que se cargaron sin cierre).
--   SELECT public.manifiestos_hechos_rehacer_mes(2026, 9);
--   SELECT public.manifiestos_hechos_rehacer_mes(2026, 10);
--   SELECT fecha_reporte, es_carga, sum(operaciones) AS operaciones, round(sum(carga_kg) / 1000, 2) AS toneladas
--     FROM public.manifiestos_resumen_dia WHERE fecha_reporte = DATE '2026-10-20' GROUP BY 1, 2;
-- -----------------------------------------------------------------------------
