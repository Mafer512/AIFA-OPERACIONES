-- =============================================================================
-- 060 · Reportes sobre manifiestos_hechos — CAMBIO EN PRODUCCIÓN
--
-- Selecciona todo y Run. UNA sola transacción: o queda todo, o no queda nada.
-- Tarda segundos (incluye un refresco de los últimos 60 días de Conciliación).
--
-- REQUISITO: 058 aplicada, 059 terminada con "FIN: OK" y 061a en OK
--            (059_manifiestos_hechos_seguimiento.sql).
-- REVERSA:   060_reversa_reportes_sobre_manifiestos_hechos.sql
--
-- Qué hace:
--   1. Renombra lo viejo a *_pre060 (NO borra nada):
--        mv_estadistica_operaciones, v_estadistica_operaciones,
--        mv_informe_estadistico_base/_resumen/_aerolinea,
--        v_informe_manifiestos_normalizado, v_informe_estadistico_resumen/_aerolinea,
--        estadistica_agregado/_detalle/_sin_clasificar/_opciones_filtro/_diagnostico,
--        refrescar_estadistica, refrescar_informe_estadistico,
--        inicio_manifiestos_por_dia.
--      El sufijo es _pre060, no _old: en producción ya existen objetos *_old
--      de un cambio anterior y NO se tocan. El tipo real de cada objeto se lee
--      de pg_class.relkind (hoy mv_estadistica_operaciones es una TABLA que
--      llena v_estadistica_calculo; los mv_informe_* son vistas
--      materializadas) y se usa ALTER TABLE / VIEW / MATERIALIZED VIEW según
--      corresponda. v_estadistica_calculo no se toca.
--   2. Crea objetos NUEVOS con los MISMOS nombres, columnas y orden que los
--      viejos, leyendo solo de manifiestos_hechos y sus resúmenes. Una columna
--      que ya no tiene fuente sale NULL con su mismo tipo; las columnas nuevas
--      van al final (fecha_reporte, fecha_operacion_manifiesto, fuente_tabla…).
--        · mv_* y v_* pasan a ser vistas simples sobre tablas ya tipadas e
--          indexadas: no se refrescan, siempre están al día con los hechos.
--        · fecha_operacion de estas vistas = fecha_reporte (la fecha en que
--          cuenta el manifiesto: cierre de Subsecretaría o su FECHA). La FECHA
--          del manifiesto queda en fecha_operacion_manifiesto.
--        · fuente_principal = 'PASAJEROS' / 'CARGA'.
--   3. Quita de pg_cron los refrescos viejos (refrescar_estadistica,
--      refrescar_informe_estadistico) y agenda manifiestos_hechos_refresco cada
--      10 minutos (Conciliación, últimos 60 días).
--   4. Verifica que ninguna columna que hoy consume la app se haya perdido. Si
--      falta una, aborta y no cambia nada.
--
-- No toca maestra_manifiestos, "Conciliación Manifiestos" (ni sus triggers ni
-- RLS), maestra_operaciones* ni las tablas de reglas de clasificación.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';
SET LOCAL max_parallel_workers_per_gather = 0;

CREATE TEMP TABLE IF NOT EXISTS _mh_reporte (orden serial, objeto text, detalle text);
TRUNCATE _mh_reporte;

-- -----------------------------------------------------------------------------
-- 0) Prerrequisitos
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
    v_maestra bigint;
    v_conci   bigint;
BEGIN
    IF to_regprocedure('public.manifiestos_hechos_refrescar(integer)') IS NULL THEN
        RAISE EXCEPTION 'Falta la 058. Córrela primero.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron no está habilitado: el refresco cada 10 minutos lo necesita.';
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mig_manifiestos_hechos') THEN
        RAISE EXCEPTION 'La 059 todavía no termina (sigue en la agenda de pg_cron). Revisa 059_manifiestos_hechos_seguimiento.sql.';
    END IF;
    SELECT count(*) FILTER (WHERE fuente = 'MAESTRA'), count(*) FILTER (WHERE fuente = 'CONCILIACION')
      INTO v_maestra, v_conci
      FROM public.manifiestos_hechos;
    IF v_maestra = 0 OR v_conci = 0 THEN
        RAISE EXCEPTION 'manifiestos_hechos no está lleno (maestra: %, Conciliación: %). Corre la 059 y espera "FIN: OK".',
            v_maestra, v_conci;
    END IF;
    IF (SELECT count(*) FROM public.manifiestos_resumen_dia) = 0 THEN
        RAISE EXCEPTION 'Los resúmenes están vacíos. Corre la 059 y espera "FIN: OK".';
    END IF;
END;
$pre$;

-- -----------------------------------------------------------------------------
-- 1) Vista compatible: mismas columnas, en el mismo orden y con el mismo tipo
--    que el objeto de referencia (*_pre060). Columna sin fuente → NULL::tipo.
--    Columna con otro tipo de la misma familia (número, texto, fecha,
--    booleano, intervalo) → se convierte al tipo viejo. Si la familia cambia,
--    se deja el tipo nuevo y se reporta. Columnas nuevas → al final.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mh_vista_compatible(
    p_nombre     text,
    p_referencia regclass,
    p_consulta   text,
    p_comentario text,
    p_lectura    boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_tmp  text := '_mh_vc_' || p_nombre;
    v_oid  oid;
    v_cols text[] := '{}';
    v_rep  text[] := '{}';
    r      record;
BEGIN
    EXECUTE format('DROP VIEW IF EXISTS pg_temp.%I', v_tmp);
    EXECUTE format('CREATE TEMP VIEW %I AS %s', v_tmp, p_consulta);
    v_oid := to_regclass('pg_temp.' || quote_ident(v_tmp));

    IF p_referencia IS NOT NULL THEN
        FOR r IN
            SELECT a.attname,
                   format_type(a.atttypid, a.atttypmod) AS tipo,
                   t.typcategory                        AS cat,
                   n.attname                            AS nuevo,
                   format_type(n.atttypid, n.atttypmod) AS nuevo_tipo,
                   nt.typcategory                       AS nuevo_cat
              FROM pg_attribute a
              JOIN pg_type t ON t.oid = a.atttypid
              LEFT JOIN pg_attribute n
                     ON n.attrelid = v_oid AND n.attname = a.attname AND n.attnum > 0 AND NOT n.attisdropped
              LEFT JOIN pg_type nt ON nt.oid = n.atttypid
             WHERE a.attrelid = p_referencia AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum
        LOOP
            IF r.nuevo IS NULL THEN
                v_cols := v_cols || format('NULL::%s AS %I', r.tipo, r.attname);
                v_rep  := v_rep  || (r.attname || ' sin fuente (NULL)');
            ELSIF r.nuevo_tipo = r.tipo THEN
                v_cols := v_cols || format('s.%I', r.attname);
            ELSIF r.cat = r.nuevo_cat AND r.cat IN ('N', 'S', 'D', 'B', 'T') THEN
                v_cols := v_cols || format('s.%I::%s AS %I', r.attname, r.tipo, r.attname);
            ELSE
                v_cols := v_cols || format('s.%I', r.attname);
                v_rep  := v_rep  || (r.attname || ' cambia de ' || r.tipo || ' a ' || r.nuevo_tipo);
            END IF;
        END LOOP;
    END IF;

    FOR r IN
        SELECT n.attname
          FROM pg_attribute n
         WHERE n.attrelid = v_oid AND n.attnum > 0 AND NOT n.attisdropped
           AND (p_referencia IS NULL OR NOT EXISTS (
                SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = p_referencia AND a.attname = n.attname
                   AND a.attnum > 0 AND NOT a.attisdropped))
         ORDER BY n.attnum
    LOOP
        v_cols := v_cols || format('s.%I', r.attname);
        IF p_referencia IS NOT NULL THEN
            v_rep := v_rep || (r.attname || ' nueva');
        END IF;
    END LOOP;

    EXECUTE format('DROP VIEW pg_temp.%I', v_tmp);
    EXECUTE format('CREATE VIEW public.%I AS SELECT %s FROM (%s) s',
                   p_nombre, array_to_string(v_cols, ', '), p_consulta);
    EXECUTE format('COMMENT ON VIEW public.%I IS %L', p_nombre, p_comentario);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', p_nombre);
    IF p_lectura THEN
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', p_nombre);
    END IF;

    INSERT INTO pg_temp._mh_reporte (objeto, detalle)
    VALUES (p_nombre, coalesce(nullif(array_to_string(v_rep, ' · '), ''), 'mismas columnas y tipos'));
    RETURN p_nombre;
END;
$$;

REVOKE ALL ON FUNCTION public._mh_vista_compatible(text, regclass, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Lo viejo pasa a *_pre060. Si esta migración ya se había corrido (ya existe
--    el *_pre060), se quita el objeto nuevo para volver a crearlo: así es
--    idempotente sin tocar jamás lo viejo.
-- -----------------------------------------------------------------------------
DO $ren$
DECLARE
    v_fun  text[] := ARRAY[
        -- primero la que depende del TIPO de mv_estadistica_operaciones
        'estadistica_detalle(date, date, jsonb, integer, integer)',
        'estadistica_agregado(date, date, text[], jsonb, integer)',
        'estadistica_sin_clasificar(date, date, integer)',
        'estadistica_opciones_filtro(date, date)',
        'estadistica_diagnostico()',
        'refrescar_estadistica(boolean)',
        'refrescar_informe_estadistico(boolean)',
        'inicio_manifiestos_por_dia(date, date)'];
    -- v_* antes que mv_*: al recrear, la vista que depende se quita primero.
    v_rel  text[] := ARRAY[
        'v_estadistica_operaciones', 'mv_estadistica_operaciones',
        'v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen',
        'v_informe_estadistico_aerolinea', 'mv_informe_estadistico_base',
        'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea'];
    v_firma text;
    v_base  text;
    v_args  text;
    v_rel1  text;
    v_kind  "char";
    v_res   text;
BEGIN
    -- El inicio debe seguir devolviendo lo mismo que la 057c.
    IF to_regprocedure('public.inicio_manifiestos_por_dia(date, date)') IS NOT NULL
       AND to_regprocedure('public.inicio_manifiestos_por_dia_pre060(date, date)') IS NULL THEN
        v_res := pg_get_function_result(to_regprocedure('public.inicio_manifiestos_por_dia(date, date)'));
        IF v_res <> 'TABLE(fecha date, comercial_ops bigint, comercial_pax numeric, carga_ops bigint, carga_kg numeric)' THEN
            RAISE EXCEPTION 'inicio_manifiestos_por_dia en la base no es la 057c (devuelve %). No se cambia nada.', v_res;
        END IF;
    END IF;

    FOREACH v_firma IN ARRAY v_fun LOOP
        v_base := split_part(v_firma, '(', 1);
        v_args := '(' || split_part(v_firma, '(', 2);
        IF to_regprocedure('public.' || v_base || '_pre060' || v_args) IS NOT NULL THEN
            IF to_regprocedure('public.' || v_firma) IS NOT NULL THEN
                EXECUTE format('DROP FUNCTION public.%I%s', v_base, v_args);
            END IF;
        ELSIF to_regprocedure('public.' || v_firma) IS NOT NULL THEN
            EXECUTE format('ALTER FUNCTION public.%I%s RENAME TO %I', v_base, v_args, v_base || '_pre060');
            INSERT INTO pg_temp._mh_reporte (objeto, detalle) VALUES (v_base || v_args, 'renombrada a ' || v_base || '_pre060');
        END IF;
    END LOOP;

    FOREACH v_rel1 IN ARRAY v_rel LOOP
        SELECT c.relkind INTO v_kind FROM pg_class c WHERE c.oid = to_regclass('public.' || v_rel1);
        IF to_regclass('public.' || v_rel1 || '_pre060') IS NOT NULL THEN
            IF v_kind = 'v' THEN
                EXECUTE format('DROP VIEW public.%I', v_rel1);
            ELSIF v_kind IS NOT NULL THEN
                RAISE EXCEPTION 'Existen %_pre060 y también % (relkind %): revisar a mano antes de seguir.',
                    v_rel1, v_rel1, v_kind;
            END IF;
        ELSIF v_kind IS NOT NULL THEN
            -- El tipo real manda: en producción mv_estadistica_operaciones es
            -- una TABLA ('r'), no una vista materializada.
            IF v_kind NOT IN ('r', 'p', 'v', 'm') THEN
                RAISE EXCEPTION '% tiene un tipo inesperado (relkind %): revisar a mano.', v_rel1, v_kind;
            END IF;
            EXECUTE format('ALTER %s public.%I RENAME TO %I',
                           CASE v_kind WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END,
                           v_rel1, v_rel1 || '_pre060');
            INSERT INTO pg_temp._mh_reporte (objeto, detalle)
            VALUES (v_rel1, 'renombrada a ' || v_rel1 || '_pre060 ('
                    || CASE v_kind WHEN 'm' THEN 'vista materializada' WHEN 'v' THEN 'vista' ELSE 'tabla' END || ')');
        END IF;
    END LOOP;
END;
$ren$;

-- -----------------------------------------------------------------------------
-- 3) Estadística: mv_estadistica_operaciones / v_estadistica_operaciones
--    Una fila por OPERACIÓN (manifiesto con AEROLINEA).
--      segmento_aviacion    = 'COMERCIAL' (todo manifiesto es aviación comercial)
--      naturaleza_operacion = 'CARGA' / 'PASAJEROS' (regla de la 058)
--      clasificada          = true  (ya no depende de las reglas por aerolínea)
--      minutos_vs_slot      = HR. DE OPERACIÓN − SLOT ASIGNADO
-- -----------------------------------------------------------------------------
SELECT public._mh_vista_compatible(
    'mv_estadistica_operaciones',
    to_regclass('public.mv_estadistica_operaciones_pre060'),
    $q$
    SELECT
        h.id,
        h.fecha_reporte                                        AS fecha_operacion,
        h.anio::int                                            AS anio,
        h.mes::int                                             AS mes,
        h.dia::int                                             AS dia,
        extract(isodow FROM h.fecha_reporte)::int              AS dia_semana,
        to_char(h.fecha_reporte, 'IYYY-"W"IW')                 AS semana_iso,
        to_char(h.fecha_reporte, 'YYYY-"T"Q')                  AS trimestre,
        CASE h.direccion WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' END AS tipo_movimiento,
        h.direccion,
        h.numero_vuelo,
        coalesce(h.aerolinea, 'SIN AEROLÍNEA')                 AS aerolinea,
        h.aerolinea_codigo,
        h.aerolinea_catalogo_id                                AS aerolinea_conciliacion_id,
        h.matricula,
        h.aeronave                                             AS tipo_aeronave,
        h.tipo_operacion,
        h.tipo_manifiesto,
        h.destino                                              AS endpoint_codigo,
        h.destino_texto                                        AS endpoint_nombre,
        coalesce(h.destino_ciudad, h.destino, 'Sin identificar') AS endpoint_ciudad,
        CASE h.direccion WHEN 'A' THEN h.destino ELSE 'NLU' END AS origen_codigo,
        CASE h.direccion WHEN 'D' THEN h.destino ELSE 'NLU' END AS destino_codigo,
        CASE h.direccion
            WHEN 'A' THEN coalesce(h.destino, '?') || ' → NLU'
            ELSE 'NLU → ' || coalesce(h.destino, '?')
        END                                                    AS ruta,
        h.nacional_internacional,
        h.nacint_origen,
        h.cancelado                                            AS es_cancelada,
        CASE WHEN h.cancelado THEN 'puntualidad' END           AS cancelado_origen,
        'COMERCIAL'::text                                      AS segmento_aviacion,
        CASE WHEN h.es_carga THEN 'CARGA' ELSE 'PASAJEROS' END AS naturaleza_operacion,
        true                                                   AS clasificada,
        h.pax,
        h.pax_transitos,
        h.pax_conexiones,
        h.pax_infantes,
        h.pax_exentos                                          AS pax_exentos_reportados,
        h.pax_pagan_tua                                        AS pax_pagan_tua_reportados,
        h.capacidad_pax                                        AS capacidad_pasajeros,
        CASE WHEN h.capacidad_pax IS NOT NULL THEN 'matricula' ELSE 'desconocida' END AS capacidad_origen,
        (h.pax IS NOT NULL AND h.capacidad_pax IS NOT NULL)    AS ocupacion_evaluable,
        h.carga_kg                                             AS carga_total_kg,
        h.carga_nacional_kg,
        h.carga_internacional_kg,
        h.correo_kg,
        h.equipaje_kg,
        CASE WHEN h.direccion = 'A' THEN h.carga_kg END        AS carga_descargada_kg,
        CASE WHEN h.direccion = 'D' THEN h.carga_kg END        AS carga_embarcada_kg,
        false                                                  AS carga_desglose_capturado,
        'sin_rotacion'::text                                   AS rotacion_origen,
        false                                                  AS es_cabeza_rotacion,
        h.slot_asignado                                        AS slot_vigente,
        h.slot_asignado,
        CASE WHEN h.slot_asignado IS NOT NULL THEN 'asignado' END AS slot_origen,
        h.minutos_vs_slot,
        h.clasificacion_slot,
        h.minutos_vs_slot                                      AS minutos_demora,
        h.codigo_demora,
        h.demora_15_min,
        h.slot_asignado                                        AS hora_programada,
        h.hora_operacion,
        h.hora_operacion                                       AS hora_real,
        extract(hour FROM (coalesce(h.slot_asignado, h.hora_operacion) AT TIME ZONE 'America/Mexico_City'))::int AS hora_local,
        h.capturado                                            AS conciliado,
        h.capturado,
        CASE WHEN h.es_carga THEN 'CARGA' ELSE 'PASAJEROS' END AS fuente_principal,
        -- nuevas
        h.fecha_reporte,
        h.fecha_operacion                                      AS fecha_operacion_manifiesto,
        h.fecha_cierre,
        h.fuente                                               AS fuente_tabla,
        h.id_origen,
        h.es_carga,
        h.aerolinea_texto,
        h.destino_pais,
        h.destino_resuelto,
        h.clasificacion_origen
    FROM public.manifiestos_hechos h
    WHERE h.es_operacion
    $q$,
    'Una fila por operación (manifiesto con AEROLINEA) de manifiestos_hechos: maestra_manifiestos '
    'hasta 2025 y "Conciliación Manifiestos" desde 2026. fecha_operacion = fecha_reporte (cierre de '
    'Subsecretaría o FECHA). Vista simple: no se refresca, sigue a manifiestos_hechos (060).'
);

SELECT public._mh_vista_compatible(
    'v_estadistica_operaciones',
    to_regclass('public.v_estadistica_operaciones_pre060'),
    'SELECT * FROM public.mv_estadistica_operaciones',
    'Nombre público y estable del detalle estadístico por operación (sobre manifiestos_hechos, 060).'
);

-- -----------------------------------------------------------------------------
-- 4) Informe Estadístico
-- -----------------------------------------------------------------------------
SELECT public._mh_vista_compatible(
    'mv_informe_estadistico_base',
    to_regclass('public.mv_informe_estadistico_base_pre060'),
    $q$
    SELECT
        h.id                     AS manifiesto_id,
        h.fecha_reporte          AS fecha_operacion,
        h.direccion,
        h.aerolinea_texto        AS aerolinea_cruda,
        h.aerolinea,
        h.es_carga,
        h.pax                    AS pax_total,
        h.carga_kg,
        h.equipaje_kg,
        h.correo_kg,
        h.matricula,
        h.capacidad_pax          AS capacidad_matricula,
        h.destino                AS endpoint_code,
        h.nacional_internacional,
        true                     AS capturado,
        -- nuevas
        h.fecha_reporte,
        h.fecha_operacion        AS fecha_operacion_manifiesto,
        h.fuente                 AS fuente_tabla,
        h.id_origen,
        h.cancelado,
        h.destino_ciudad
    FROM public.manifiestos_hechos h
    WHERE h.es_operacion
    $q$,
    'Base del Informe Estadístico: una fila por operación de manifiestos_hechos. fecha_operacion = '
    'fecha_reporte. capturado = true siempre (ya no hay respaldo de itinerario).',
    false
);

SELECT public._mh_vista_compatible(
    'mv_informe_estadistico_resumen',
    to_regclass('public.mv_informe_estadistico_resumen_pre060'),
    $q$
    SELECT
        r.anio::int                                              AS anio,
        r.mes::int                                               AS mes,
        CASE WHEN r.es_carga THEN 'carga' ELSE 'comercial' END   AS tipo_aviacion,
        r.direccion,
        r.nacional_internacional,
        sum(r.operaciones)::bigint                               AS operaciones,
        sum(r.pax)                                               AS pax_total,
        sum(r.carga_kg)                                          AS carga_kg_total,
        sum(r.equipaje_kg)                                       AS equipaje_kg_total,
        sum(r.correo_kg)                                         AS correo_kg_total,
        sum(r.operaciones_capturadas)::bigint                    AS operaciones_conciliadas,
        0::bigint                                                AS operaciones_respaldo_itinerario,
        -- nuevas
        sum(r.operaciones_canceladas)::bigint                    AS operaciones_canceladas,
        sum(r.manifiestos)::bigint                               AS manifiestos
    FROM public.manifiestos_resumen_dia r
    GROUP BY 1, 2, 3, 4, 5
    $q$,
    'Agregado mensual del Informe Estadístico (año/mes/tipo/dirección/nac-int) sobre '
    'manifiestos_resumen_dia. Las canceladas cuentan (como en los Excel oficiales).',
    false
);

SELECT public._mh_vista_compatible(
    'mv_informe_estadistico_aerolinea',
    to_regclass('public.mv_informe_estadistico_aerolinea_pre060'),
    $q$
    SELECT
        r.anio::int                                              AS anio,
        r.mes::int                                               AS mes,
        coalesce(r.aerolinea, 'SIN AEROLÍNEA')                   AS aerolinea,
        CASE WHEN r.es_carga THEN 'carga' ELSE 'comercial' END   AS tipo_aviacion,
        r.direccion,
        sum(r.operaciones)::bigint                               AS operaciones,
        sum(r.pax)                                               AS pax_total,
        sum(r.carga_kg)                                          AS carga_kg_total
    FROM public.manifiestos_resumen_mes_aerolinea r
    GROUP BY 1, 2, 3, 4, 5
    HAVING sum(r.operaciones) > 0
    $q$,
    'Agregado mensual por aerolínea (normalizada al catálogo) sobre manifiestos_resumen_mes_aerolinea.',
    false
);

SELECT public._mh_vista_compatible(
    'v_informe_manifiestos_normalizado',
    to_regclass('public.v_informe_manifiestos_normalizado_pre060'),
    'SELECT * FROM public.mv_informe_estadistico_base',
    'Base normalizada del Informe Estadístico: manifiestos_hechos (maestra_manifiestos hasta 2025, '
    '"Conciliación Manifiestos" desde 2026). fecha_operacion = fecha_reporte.'
);

SELECT public._mh_vista_compatible(
    'v_informe_estadistico_resumen',
    to_regclass('public.v_informe_estadistico_resumen_pre060'),
    'SELECT * FROM public.mv_informe_estadistico_resumen',
    'Agregado mensual (año/mes/tipo de aviación/dirección/nac-int) del Informe Estadístico. Solo '
    'Comercial y Carga, desde manifiestos.'
);

SELECT public._mh_vista_compatible(
    'v_informe_estadistico_aerolinea',
    to_regclass('public.v_informe_estadistico_aerolinea_pre060'),
    'SELECT * FROM public.mv_informe_estadistico_aerolinea',
    'Agregado mensual por aerolínea (año/mes/aerolínea/tipo/dirección) del Informe Estadístico.'
);

-- -----------------------------------------------------------------------------
-- 5) RPC de Estadística: mismas firmas y columnas que 043/044, ahora sobre la
--    vista nueva (copia fiel; solo cambia de dónde lee mv_estadistica_operaciones).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estadistica_agregado(
    p_desde       date,
    p_hasta       date,
    p_dimensiones text[] DEFAULT '{}'::text[],
    p_filtros     jsonb  DEFAULT '{}'::jsonb,
    p_limite      integer DEFAULT 5000
)
RETURNS TABLE (
    d1 text, d2 text, d3 text, d4 text,

    operaciones               bigint,
    operaciones_llegada       bigint,
    operaciones_salida        bigint,
    operaciones_canceladas    bigint,
    operaciones_nacional      bigint,
    operaciones_internacional bigint,

    pax_total          numeric,
    pax_llegada        numeric,
    pax_salida         numeric,
    pax_nacional       numeric,
    pax_internacional  numeric,
    operaciones_con_pax bigint,

    carga_total_kg          numeric,
    carga_nacional_kg       numeric,
    carga_internacional_kg  numeric,
    carga_descargada_kg     numeric,
    carga_embarcada_kg      numeric,
    carga_transito_kg       numeric,
    correo_kg               numeric,
    operaciones_con_carga   bigint,
    operaciones_con_desglose_carga bigint,

    ocupacion_pax        numeric,
    ocupacion_capacidad  numeric,
    factor_ocupacion     numeric,
    operaciones_con_ocupacion bigint,

    operaciones_puntuales  bigint,
    operaciones_demoradas  bigint,
    minutos_demora_total   numeric,
    demora_promedio        numeric,
    demora_maxima          numeric,
    demora_minima          numeric,
    operaciones_evaluables_puntualidad bigint,

    operaciones_clasificadas   bigint,
    operaciones_sin_clasificar bigint,
    operaciones_capturadas     bigint,

    -- ── v2: columnas nuevas, siempre AL FINAL ────────────────────────────────
    -- Se agregan al final a propósito: el cliente mapea por nombre, pero
    -- cualquier consumidor que lea por posición sigue viendo lo mismo que antes.
    carga_importacion_kg   numeric,
    carga_exportacion_kg   numeric,
    equipaje_kg            numeric,

    pax_programados        numeric,
    pax_no_abordados       numeric,
    pax_inadmitidos        numeric,
    pax_repatriados        numeric,
    pax_transitos          numeric,
    pax_conexiones         numeric,
    pax_exentos            numeric,
    pax_pagan_tua          numeric,
    operaciones_con_pax_programados bigint,

    operaciones_pernocta   bigint,
    minutos_pernocta_total numeric,

    turnaround_promedio_min numeric,
    turnaround_minimo_min   numeric,
    turnaround_maximo_min   numeric,
    operaciones_con_turnaround bigint,

    rotaciones             bigint,
    operaciones_conciliadas bigint,
    operaciones_validadas   bigint,

    -- Adherencia al slot, con el vocabulario oficial completo.
    operaciones_anticipadas   bigint,
    operaciones_antes         bigint,
    operaciones_en_tiempo     bigint,
    operaciones_despues       bigint,
    operaciones_con_slot      bigint,
    minutos_vs_slot_promedio  numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    -- Lista blanca de dimensiones. La clave es lo que manda el cliente; el
    -- valor es la expresión SQL. Nada fuera de este mapa llega al SQL: lo único
    -- dinámico de esta función son estos nombres, ya validados. Los VALORES
    -- viajan siempre como parámetros ($1..$4), nunca interpolados.
    v_mapa   jsonb := jsonb_build_object(
        'anio',                   'm.anio::text',
        'mes',                    'lpad(m.mes::text, 2, ''0'')',
        'anio_mes',               'm.anio::text || ''-'' || lpad(m.mes::text, 2, ''0'')',
        'trimestre',              'm.trimestre',
        'fecha',                  'm.fecha_operacion::text',
        'semana',                 'm.semana_iso',
        'dia_semana',             'm.dia_semana::text',
        'hora',                   'lpad(m.hora_local::text, 2, ''0'')',
        'direccion',              'm.direccion',
        'tipo_movimiento',        'm.tipo_movimiento',
        'aerolinea',              'm.aerolinea',
        'aerolinea_codigo',       'm.aerolinea_codigo',
        'matricula',              'm.matricula',
        'estatus_matricula',      'm.estatus_matricula',
        'tipo_aeronave',          'm.tipo_aeronave',
        'tipo_servicio',          'm.tipo_servicio',
        'tipo_operacion',         'm.tipo_operacion',
        'codigo_afac',            'm.codigo_afac',
        'segmento_aviacion',      'coalesce(m.segmento_aviacion, ''SIN CLASIFICAR'')',
        'naturaleza_operacion',   'coalesce(m.naturaleza_operacion, ''SIN CLASIFICAR'')',
        'nacional_internacional', 'coalesce(m.nacional_internacional, ''Sin determinar'')',
        'origen',                 'm.origen_codigo',
        'destino',                'm.destino_codigo',
        'endpoint',               'm.endpoint_codigo',
        'ciudad',                 'm.endpoint_ciudad',
        'escala',                 'm.escala_codigo',
        'ruta',                   'm.ruta',
        'posicion',               'm.posicion',
        'puerta',                 'm.puerta',
        'banda',                  'm.banda',
        'codigo_demora',          'm.codigo_demora',
        'causa_demora',           'm.causa_demora',
        'motivo_operativo',       'm.motivo_operativo',
        'fuente',                 'm.fuente_principal',
        'capacidad_origen',       'm.capacidad_origen',
        'rotacion_origen',        'm.rotacion_origen',
        'clasificacion_slot',     'coalesce(m.clasificacion_slot, ''SIN SLOT'')',
        'slot_origen',            'coalesce(m.slot_origen, ''sin slot'')',
        'nacint_origen',          'm.nacint_origen',
        'conciliado',             'CASE WHEN m.conciliado THEN ''Conciliada'' ELSE ''Sin conciliar'' END',
        'cancelado_origen',       'coalesce(m.cancelado_origen, ''No cancelada'')'
    );
    v_dims   text[] := '{}';
    v_dim    text;
    v_select text;
    v_group  text;
    v_sql    text;
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    IF p_desde IS NULL OR p_hasta IS NULL THEN
        RAISE EXCEPTION 'estadistica_agregado requiere p_desde y p_hasta.' USING ERRCODE = '22004';
    END IF;
    IF p_hasta < p_desde THEN
        RAISE EXCEPTION 'El rango de fechas está invertido (% > %).', p_desde, p_hasta
            USING ERRCODE = '22007';
    END IF;

    FOREACH v_dim IN ARRAY coalesce(p_dimensiones, '{}'::text[]) LOOP
        IF NOT (v_mapa ? v_dim) THEN
            RAISE EXCEPTION 'Dimensión no reconocida: %. Válidas: %',
                v_dim, (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_mapa) k)
                USING ERRCODE = '22023';
        END IF;
        v_dims := v_dims || (v_mapa ->> v_dim);
        EXIT WHEN array_length(v_dims, 1) >= 4;
    END LOOP;

    v_select := concat_ws(', ',
        coalesce(v_dims[1], 'NULL::text') || ' AS d1',
        coalesce(v_dims[2], 'NULL::text') || ' AS d2',
        coalesce(v_dims[3], 'NULL::text') || ' AS d3',
        coalesce(v_dims[4], 'NULL::text') || ' AS d4'
    );
    v_group := CASE
        WHEN array_length(v_dims, 1) IS NULL THEN ''
        ELSE 'GROUP BY ' || (
            SELECT string_agg(i::text, ', ') FROM generate_series(1, array_length(v_dims, 1)) i
        )
    END;

    v_sql := format($q$
        SELECT %s,

            count(*) FILTER (WHERE NOT m.es_cancelada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D')::bigint,
            count(*) FILTER (WHERE m.es_cancelada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Nacional')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Internacional')::bigint,

            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A'))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D'))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Nacional'))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Internacional'))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.pax IS NOT NULL)::bigint,

            (sum(m.carga_total_kg)         FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_nacional_kg)      FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_internacional_kg) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_descargada_kg)    FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A'))::numeric,
            (sum(m.carga_embarcada_kg)     FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D'))::numeric,
            (sum(m.transito_contable_kg)   FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.correo_kg)              FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.carga_total_kg IS NOT NULL AND m.carga_total_kg > 0)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.carga_desglose_capturado)::bigint,

            (sum(m.pax)                 FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric,
            (sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric,
            -- Factor de ocupación: SUM(pax)/SUM(capacidad), NO el promedio de
            -- los cocientes por fila. El cast va DESPUÉS del FILTER y entre
            -- paréntesis: sum(x)::numeric FILTER (...) es error de sintaxis.
            CASE
                WHEN coalesce(sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable), 0) > 0
                THEN round(
                    100.0 * (sum(m.pax)                 FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric
                          / (sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric
                , 2)
            END::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable)::bigint,

            -- "Puntual" = CUMPLE LA VENTANA DEL SLOT: ANTES, EN TIEMPO o
            -- DESPUÉS. ANTICIPADO también queda fuera de ventana, aunque el
            -- vuelo se haya adelantado: el permiso es una ventana, no un techo.
            count(*) FILTER (WHERE NOT m.es_cancelada
                             AND m.clasificacion_slot IN ('ANTES', 'EN TIEMPO', 'DESPUÉS'))::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'DEMORA')::bigint,
            (sum(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada AND m.minutos_demora > 0))::numeric,
            round(avg(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada), 2)::numeric,
            (max(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (min(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND NOT m.clasificada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.capturado)::bigint,

            (sum(m.carga_importacion_kg) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_exportacion_kg) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.equipaje_kg)          FILTER (WHERE NOT m.es_cancelada))::numeric,

            (sum(m.pax_programados)          FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_no_abordados)         FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_inadmitidos)          FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_repatriados)          FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_transitos)            FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_conexiones)           FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_exentos_reportados)   FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_pagan_tua_reportados) FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.pax_programados IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.minutos_pernocta IS NOT NULL)::bigint,
            (sum(m.minutos_pernocta) FILTER (WHERE NOT m.es_cancelada))::numeric,

            round(avg(m.turnaround_min) FILTER (WHERE NOT m.es_cancelada), 2)::numeric,
            (min(m.turnaround_min) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (max(m.turnaround_min) FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.turnaround_min IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.es_cabeza_rotacion)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.conciliado)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.validado)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'ANTICIPADO')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'ANTES')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'EN TIEMPO')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'DESPUÉS')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.slot_vigente IS NOT NULL)::bigint,
            round(avg(m.minutos_vs_slot) FILTER (WHERE NOT m.es_cancelada), 2)::numeric

        FROM public.mv_estadistica_operaciones m
        WHERE m.fecha_operacion >= $1
          AND m.fecha_operacion <= $2
          AND public._estadistica_filtro_ok(m.aerolinea,              $3 -> 'aerolinea')
          AND public._estadistica_filtro_ok(m.matricula,              $3 -> 'matricula')
          AND public._estadistica_filtro_ok(m.tipo_aeronave,          $3 -> 'tipo_aeronave')
          AND public._estadistica_filtro_ok(m.tipo_servicio,          $3 -> 'tipo_servicio')
          AND public._estadistica_filtro_ok(m.direccion,              $3 -> 'direccion')
          AND public._estadistica_filtro_ok(m.nacional_internacional, $3 -> 'nacional_internacional')
          AND public._estadistica_filtro_ok(m.segmento_aviacion,      $3 -> 'segmento_aviacion')
          AND public._estadistica_filtro_ok(m.naturaleza_operacion,   $3 -> 'naturaleza_operacion')
          AND public._estadistica_filtro_ok(m.origen_codigo,          $3 -> 'origen')
          AND public._estadistica_filtro_ok(m.destino_codigo,         $3 -> 'destino')
          AND public._estadistica_filtro_ok(m.endpoint_codigo,        $3 -> 'endpoint')
          AND public._estadistica_filtro_ok(m.posicion,               $3 -> 'posicion')
          AND public._estadistica_filtro_ok(m.puerta,                 $3 -> 'puerta')
          AND public._estadistica_filtro_ok(m.banda,                  $3 -> 'banda')
          AND public._estadistica_filtro_ok(m.tipo_operacion,         $3 -> 'tipo_operacion')
          AND public._estadistica_filtro_ok(m.motivo_operativo,       $3 -> 'motivo_operativo')
          AND public._estadistica_filtro_ok(m.codigo_demora,          $3 -> 'codigo_demora')
          AND public._estadistica_filtro_ok(m.fuente_principal,       $3 -> 'fuente')
          AND public._estadistica_filtro_ok(m.clasificacion_slot,     $3 -> 'clasificacion_slot')
        %s
        ORDER BY 1, 2, 3, 4
        LIMIT $4
    $q$, v_select, v_group);

    RETURN QUERY EXECUTE v_sql
        USING p_desde, p_hasta, coalesce(p_filtros, '{}'::jsonb), greatest(coalesce(p_limite, 5000), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.estadistica_sin_clasificar(
    p_desde  date,
    p_hasta  date,
    p_limite integer DEFAULT 200
)
RETURNS TABLE (
    aerolinea       text,
    aerolinea_id    bigint,
    aerolinea_codigo text,
    tipo_aeronave   text,
    tipo_servicio   text,
    tipo_servicio_descripcion text,
    operaciones     bigint,
    pax_total       numeric,
    carga_total_kg  numeric,
    primera_fecha   date,
    ultima_fecha    date,
    ejemplo_vuelo   text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        m.aerolinea,
        m.aerolinea_conciliacion_id,
        m.aerolinea_codigo,
        m.tipo_aeronave,
        m.tipo_servicio,
        max(m.tipo_servicio_descripcion),
        count(*)::bigint,
        (sum(m.pax))::numeric,
        (sum(m.carga_total_kg))::numeric,
        min(m.fecha_operacion),
        max(m.fecha_operacion),
        (array_agg(m.numero_vuelo ORDER BY m.fecha_operacion DESC) FILTER (WHERE m.numero_vuelo IS NOT NULL))[1]
    FROM public.mv_estadistica_operaciones m
    WHERE m.fecha_operacion >= p_desde
      AND m.fecha_operacion <= p_hasta
      AND NOT m.clasificada
      AND NOT m.es_cancelada
    GROUP BY m.aerolinea, m.aerolinea_conciliacion_id, m.aerolinea_codigo,
             m.tipo_aeronave, m.tipo_servicio
    ORDER BY count(*) DESC
    LIMIT greatest(coalesce(p_limite, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.estadistica_detalle(
    p_desde   date,
    p_hasta   date,
    p_filtros jsonb   DEFAULT '{}'::jsonb,
    p_limite  integer DEFAULT 50000,
    p_offset  integer DEFAULT 0
)
RETURNS SETOF public.mv_estadistica_operaciones
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT m.*
    FROM public.mv_estadistica_operaciones m
    WHERE m.fecha_operacion >= p_desde
      AND m.fecha_operacion <= p_hasta
      AND public._estadistica_filtro_ok(m.aerolinea,              p_filtros -> 'aerolinea')
      AND public._estadistica_filtro_ok(m.matricula,              p_filtros -> 'matricula')
      AND public._estadistica_filtro_ok(m.tipo_aeronave,          p_filtros -> 'tipo_aeronave')
      AND public._estadistica_filtro_ok(m.tipo_servicio,          p_filtros -> 'tipo_servicio')
      AND public._estadistica_filtro_ok(m.direccion,              p_filtros -> 'direccion')
      AND public._estadistica_filtro_ok(m.nacional_internacional, p_filtros -> 'nacional_internacional')
      AND public._estadistica_filtro_ok(m.segmento_aviacion,      p_filtros -> 'segmento_aviacion')
      AND public._estadistica_filtro_ok(m.naturaleza_operacion,   p_filtros -> 'naturaleza_operacion')
      AND public._estadistica_filtro_ok(m.origen_codigo,          p_filtros -> 'origen')
      AND public._estadistica_filtro_ok(m.destino_codigo,         p_filtros -> 'destino')
      AND public._estadistica_filtro_ok(m.endpoint_codigo,        p_filtros -> 'endpoint')
      AND public._estadistica_filtro_ok(m.posicion,               p_filtros -> 'posicion')
      AND public._estadistica_filtro_ok(m.puerta,                 p_filtros -> 'puerta')
      AND public._estadistica_filtro_ok(m.banda,                  p_filtros -> 'banda')
      AND public._estadistica_filtro_ok(m.tipo_operacion,         p_filtros -> 'tipo_operacion')
      AND public._estadistica_filtro_ok(m.motivo_operativo,       p_filtros -> 'motivo_operativo')
      AND public._estadistica_filtro_ok(m.codigo_demora,          p_filtros -> 'codigo_demora')
      AND public._estadistica_filtro_ok(m.fuente_principal,       p_filtros -> 'fuente')
      AND public._estadistica_filtro_ok(m.clasificacion_slot,     p_filtros -> 'clasificacion_slot')
    ORDER BY m.fecha_operacion, m.id
    LIMIT greatest(coalesce(p_limite, 50000), 1)
    OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_detalle(date, date, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_detalle(date, date, jsonb, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.estadistica_opciones_filtro(
    p_desde date,
    p_hasta date
)
RETURNS TABLE (campo text, valor text, etiqueta text, operaciones bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH v AS (
        SELECT * FROM public.mv_estadistica_operaciones
         WHERE fecha_operacion >= p_desde AND fecha_operacion <= p_hasta
           AND NOT es_cancelada
    )
    SELECT 'aerolinea'::text, aerolinea::text, aerolinea::text, count(*)::bigint
      FROM v WHERE aerolinea IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_aeronave'::text, tipo_aeronave::text, tipo_aeronave::text, count(*)::bigint
      FROM v WHERE tipo_aeronave IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'matricula'::text, matricula::text, matricula::text, count(*)::bigint
      FROM v WHERE matricula IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_servicio'::text, tipo_servicio::text,
           (tipo_servicio || coalesce(' — ' || max(tipo_servicio_descripcion), ''))::text,
           count(*)::bigint
      FROM v WHERE tipo_servicio IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'endpoint'::text, endpoint_codigo::text,
           (endpoint_codigo || coalesce(' — ' || max(endpoint_ciudad), ''))::text, count(*)::bigint
      FROM v WHERE endpoint_codigo IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'posicion'::text, posicion::text, posicion::text, count(*)::bigint
      FROM v WHERE posicion IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'puerta'::text, puerta::text, puerta::text, count(*)::bigint
      FROM v WHERE puerta IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'banda'::text, banda::text, banda::text, count(*)::bigint
      FROM v WHERE banda IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_operacion'::text, tipo_operacion::text, tipo_operacion::text, count(*)::bigint
      FROM v WHERE tipo_operacion IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'motivo_operativo'::text, motivo_operativo::text, motivo_operativo::text, count(*)::bigint
      FROM v WHERE motivo_operativo IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'codigo_demora'::text, codigo_demora::text,
           (codigo_demora || coalesce(' — ' || max(causa_demora), ''))::text, count(*)::bigint
      FROM v WHERE codigo_demora IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'fuente'::text, fuente_principal::text, fuente_principal::text, count(*)::bigint
      FROM v WHERE fuente_principal IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'clasificacion_slot'::text, clasificacion_slot::text, clasificacion_slot::text, count(*)::bigint
      FROM v WHERE clasificacion_slot IS NOT NULL GROUP BY 2
    ORDER BY 1, 4 DESC, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_opciones_filtro(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_opciones_filtro(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.estadistica_diagnostico()
RETURNS TABLE (
    movimientos          bigint,
    canceladas           bigint,
    clasificadas         bigint,
    sin_clasificar       bigint,
    con_pax              bigint,
    con_capacidad        bigint,
    con_carga            bigint,
    con_rotacion         bigint,
    conciliadas          bigint,
    primera_fecha        date,
    ultima_fecha         date,
    refrescado_at        timestamptz,
    reglas_activas       bigint,
    por_anio             jsonb,
    por_fuente           jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        count(*)::bigint,
        count(*) FILTER (WHERE m.es_cancelada)::bigint,
        count(*) FILTER (WHERE m.clasificada)::bigint,
        count(*) FILTER (WHERE NOT m.clasificada)::bigint,
        count(*) FILTER (WHERE m.pax IS NOT NULL)::bigint,
        count(*) FILTER (WHERE m.capacidad_pasajeros IS NOT NULL)::bigint,
        count(*) FILTER (WHERE m.carga_total_kg IS NOT NULL AND m.carga_total_kg > 0)::bigint,
        count(*) FILTER (WHERE m.rotacion_clave IS NOT NULL)::bigint,
        count(*) FILTER (WHERE m.conciliado)::bigint,
        min(m.fecha_operacion),
        max(m.fecha_operacion),
        (SELECT r.refrescado_at FROM public.estadistica_refresco r WHERE r.id = 1),
        (SELECT count(*)::bigint FROM public.estadistica_reglas_clasificacion WHERE activo),
        (SELECT coalesce(jsonb_object_agg(t.anio, t.n), '{}'::jsonb)
           FROM (SELECT anio::text AS anio, count(*) AS n
                   FROM public.mv_estadistica_operaciones GROUP BY 1) t),
        (SELECT coalesce(jsonb_object_agg(t.fuente, t.n), '{}'::jsonb)
           FROM (SELECT coalesce(fuente_principal, 'sin fuente') AS fuente, count(*) AS n
                   FROM public.mv_estadistica_operaciones GROUP BY 1) t)
    FROM public.mv_estadistica_operaciones m;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_diagnostico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_diagnostico() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) Inicio: mismo nombre, parámetros y columnas que la 057c, ahora sobre
--    manifiestos_resumen_dia (ya no recorre las dos tablas en cada consulta).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inicio_manifiestos_por_dia(
    p_desde date DEFAULT NULL,
    p_hasta date DEFAULT NULL
)
RETURNS TABLE (
    fecha date,
    comercial_ops bigint,
    comercial_pax numeric,
    carga_ops bigint,
    carga_kg numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT r.fecha_reporte,
           coalesce(sum(r.operaciones) FILTER (WHERE NOT r.es_carga), 0)::bigint,
           coalesce(sum(r.pax)         FILTER (WHERE NOT r.es_carga), 0),
           coalesce(sum(r.operaciones) FILTER (WHERE r.es_carga), 0)::bigint,
           coalesce(sum(r.carga_kg)    FILTER (WHERE r.es_carga), 0)
      FROM public.manifiestos_resumen_dia r
     WHERE (p_desde IS NULL OR r.fecha_reporte >= p_desde)
       AND (p_hasta IS NULL OR r.fecha_reporte <= p_hasta)
     GROUP BY r.fecha_reporte
     ORDER BY r.fecha_reporte;
$$;

COMMENT ON FUNCTION public.inicio_manifiestos_por_dia(date, date) IS
    'Totales diarios de Comercial y Carga para el inicio, desde manifiestos_resumen_dia. Cada '
    'manifiesto cuenta en la fecha de su "CIERRE SUBSECRETARIA" o, si no tiene, en su FECHA. '
    'FECHA hasta 2025: maestra_manifiestos (por tipo_reporte); desde 2026: "Conciliación '
    'Manifiestos" (por aifa_regla_carga).';

REVOKE ALL ON FUNCTION public.inicio_manifiestos_por_dia(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inicio_manifiestos_por_dia(date, date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) Botones "Actualizar": mismas firmas que 028/038. Ya no recalculan vistas
--    materializadas: refrescan los últimos 60 días de Conciliación en
--    manifiestos_hechos. Conservan el freno de 2 minutos y el candado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refrescar_estadistica(p_forzar boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ultimo timestamptz;
BEGIN
    IF public.estadistica_access_level(auth.uid()) NOT IN ('admin', 'edit') THEN
        RAISE EXCEPTION 'Acceso denegado: se requiere nivel edit o admin para refrescar la estadística.'
            USING ERRCODE = '42501';
    END IF;

    SELECT refrescado_at INTO v_ultimo FROM public.estadistica_refresco WHERE id = 1;
    IF NOT p_forzar AND v_ultimo IS NOT NULL AND v_ultimo > now() - interval '2 minutes' THEN
        RETURN v_ultimo;
    END IF;

    PERFORM public.manifiestos_hechos_refrescar(60);

    UPDATE public.estadistica_refresco SET refrescado_por = auth.uid() WHERE id = 1
    RETURNING refrescado_at INTO v_ultimo;
    RETURN coalesce(v_ultimo, now());
END;
$$;

COMMENT ON FUNCTION public.refrescar_estadistica(boolean) IS
    'Refresca manifiestos_hechos (Conciliación, últimos 60 días). Requiere nivel edit o admin. '
    'Freno de 2 minutos salvo p_forzar; candado para no encimar refrescos (060).';

REVOKE ALL ON FUNCTION public.refrescar_estadistica(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refrescar_estadistica(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.refrescar_informe_estadistico(p_forzar boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ultimo timestamptz;
BEGIN
    SELECT refrescado_at INTO v_ultimo FROM public.informe_estadistico_refresco WHERE id;
    IF NOT p_forzar AND v_ultimo IS NOT NULL AND v_ultimo > now() - interval '2 minutes' THEN
        RETURN v_ultimo;
    END IF;

    PERFORM public.manifiestos_hechos_refrescar(60);

    SELECT refrescado_at INTO v_ultimo FROM public.informe_estadistico_refresco WHERE id;
    RETURN coalesce(v_ultimo, now());
END;
$$;

COMMENT ON FUNCTION public.refrescar_informe_estadistico(boolean) IS
    'Refresca manifiestos_hechos (Conciliación, últimos 60 días). p_forzar=false no hace nada si '
    'el último refresco tiene menos de 2 minutos. Devuelve la hora de los datos vigentes (060).';

REVOKE ALL ON FUNCTION public.refrescar_informe_estadistico(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refrescar_informe_estadistico(boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8) pg_cron: fuera los refrescos de las vistas materializadas viejas; dentro
--    el de manifiestos_hechos cada 10 minutos. Va en la misma transacción:
--    si algo falla, la agenda queda como estaba.
-- -----------------------------------------------------------------------------
DO $cron$
DECLARE
    v_job text;
BEGIN
    FOR v_job IN SELECT jobname FROM cron.job
                  WHERE jobname IN ('refrescar_estadistica', 'refrescar_informe_estadistico')
    LOOP
        PERFORM cron.unschedule(v_job);
        INSERT INTO pg_temp._mh_reporte (objeto, detalle) VALUES ('pg_cron ' || v_job, 'quitado de la agenda');
    END LOOP;

    PERFORM cron.schedule(
        'manifiestos_hechos_refresco',
        '*/10 * * * *',
        $cmd$SELECT public.manifiestos_hechos_refrescar(60)$cmd$
    );
    INSERT INTO pg_temp._mh_reporte (objeto, detalle)
    VALUES ('pg_cron manifiestos_hechos_refresco', 'cada 10 minutos, Conciliación últimos 60 días');
END;
$cron$;

-- -----------------------------------------------------------------------------
-- 9) Ponerse al corriente: lo capturado entre la 059 y ahora.
-- -----------------------------------------------------------------------------
INSERT INTO _mh_reporte (objeto, detalle)
SELECT 'refresco inicial', public.manifiestos_hechos_refrescar(60)::text;

-- -----------------------------------------------------------------------------
-- 10) Verificación. Si algo falla, se aborta y NO queda ningún cambio.
-- -----------------------------------------------------------------------------
DO $verif$
DECLARE
    v_rel     text;
    v_falta   text[] := '{}';
    v_firma   text;
    v_viejo   regprocedure;
    v_nuevo   regprocedure;
BEGIN
    -- a) Ninguna columna de los objetos viejos se perdió.
    FOREACH v_rel IN ARRAY ARRAY[
        'mv_estadistica_operaciones', 'v_estadistica_operaciones',
        'mv_informe_estadistico_base', 'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea',
        'v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen', 'v_informe_estadistico_aerolinea'] LOOP
        IF to_regclass('public.' || v_rel) IS NULL THEN
            v_falta := v_falta || (v_rel || ' (no se creó)');
            CONTINUE;
        END IF;
        IF to_regclass('public.' || v_rel || '_pre060') IS NOT NULL THEN
            v_falta := v_falta || ARRAY(
                SELECT v_rel || '.' || a.attname
                  FROM pg_attribute a
                 WHERE a.attrelid = to_regclass('public.' || v_rel || '_pre060')
                   AND a.attnum > 0 AND NOT a.attisdropped
                   AND NOT EXISTS (SELECT 1 FROM pg_attribute n
                                    WHERE n.attrelid = to_regclass('public.' || v_rel)
                                      AND n.attname = a.attname AND n.attnum > 0 AND NOT n.attisdropped));
        END IF;
    END LOOP;

    -- b) Las funciones nuevas devuelven, al menos, las columnas de las viejas.
    FOREACH v_firma IN ARRAY ARRAY[
        'estadistica_agregado(date, date, text[], jsonb, integer)',
        'estadistica_sin_clasificar(date, date, integer)',
        'estadistica_opciones_filtro(date, date)',
        'estadistica_diagnostico()',
        'inicio_manifiestos_por_dia(date, date)'] LOOP
        v_nuevo := to_regprocedure('public.' || v_firma);
        v_viejo := to_regprocedure('public.' || replace(v_firma, '(', '_pre060('));
        IF v_nuevo IS NULL THEN
            v_falta := v_falta || (v_firma || ' (no se creó)');
        ELSIF v_viejo IS NOT NULL THEN
            v_falta := v_falta || ARRAY(
                SELECT v_firma || ' → ' || o.nombre
                  FROM (SELECT unnest(p.proargnames) AS nombre, unnest(p.proargmodes) AS modo
                          FROM pg_proc p WHERE p.oid = v_viejo) o
                 WHERE o.modo IN ('t', 'o')
                   AND NOT EXISTS (
                       SELECT 1 FROM (SELECT unnest(q.proargnames) AS nombre, unnest(q.proargmodes) AS modo
                                        FROM pg_proc q WHERE q.oid = v_nuevo) n
                        WHERE n.modo IN ('t', 'o') AND n.nombre = o.nombre));
        END IF;
    END LOOP;

    IF to_regprocedure('public.estadistica_detalle(date, date, jsonb, integer, integer)') IS NULL
       OR to_regprocedure('public.refrescar_estadistica(boolean)') IS NULL
       OR to_regprocedure('public.refrescar_informe_estadistico(boolean)') IS NULL THEN
        v_falta := v_falta || 'estadistica_detalle / refrescar_* (no se crearon)'::text;
    END IF;

    IF cardinality(v_falta) > 0 THEN
        RAISE EXCEPTION E'El cambio NO se aplicó. Falta:\n  %', array_to_string(v_falta, E'\n  ');
    END IF;

    -- c) Las vistas responden y no están vacías.
    IF NOT EXISTS (SELECT 1 FROM public.v_informe_estadistico_resumen)
       OR NOT EXISTS (SELECT 1 FROM public.v_estadistica_operaciones)
       OR NOT EXISTS (SELECT 1 FROM public.inicio_manifiestos_por_dia(DATE '2024-01-01', DATE '2024-01-31')) THEN
        RAISE EXCEPTION 'El cambio NO se aplicó: las vistas nuevas salen vacías.';
    END IF;
END;
$verif$;

COMMIT;

-- =============================================================================
-- Qué cambió (solo lectura). "sin fuente (NULL)" = columna que ya no tiene
-- dato en los manifiestos y se conserva vacía con su tipo.
-- =============================================================================
SELECT objeto, detalle FROM _mh_reporte ORDER BY orden;

-- Totales por año desde el inicio (deben coincidir con la 061a).
SELECT extract(year FROM fecha)::int AS anio,
       sum(comercial_ops) AS comercial_ops, sum(comercial_pax) AS comercial_pax,
       sum(carga_ops)     AS carga_ops,     round(sum(carga_kg) / 1000, 1) AS carga_toneladas
  FROM public.inicio_manifiestos_por_dia()
 GROUP BY 1
 ORDER BY 1;

-- Siguiente: 061b_validacion_reportes_coinciden.sql (solo lectura).
