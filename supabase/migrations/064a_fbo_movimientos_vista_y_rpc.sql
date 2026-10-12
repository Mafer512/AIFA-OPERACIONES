-- =============================================================================
-- 064a · Aviación General · FBO — vista de movimientos y funciones de consulta
--
-- REQUISITOS: public.operaciones_fbo (ya existe, con el histórico 2026);
--             046/047/051 aplicadas (aviacion_general_operaciones y
--             aviacion_general_ancla).
-- SIGUE CON:  064b_fbo_importar_operaciones.sql
-- VALIDACIÓN: 064c_fbo_validacion.sql (sólo lectura)
-- REVERSA:    064_reversa_fbo.sql (borra sólo los objetos 064*, nunca datos)
--
-- Selecciona todo y Run. Es idempotente: se puede volver a correr.
--
-- QUÉ CREA
--   · v_fbo_movimientos: una fila por MOVIMIENTO, de dos fuentes:
--       a) HISTORICO — aviacion_general_operaciones ACTIVO con fecha < 2026
--          (sólo lectura). Cuenta en la MISMA fecha que hoy usa el módulo
--          (aviacion_general_resumen, modo 'rotacion', regla de 051): llegadas
--          en su fecha; salidas de 2022-2023 ancladas a la fecha de su llegada
--          (aviacion_general_ancla); 2024 y 2025 en su fecha real. Así los
--          totales 2022-2025 no se mueven (lo comprueba 064c).
--       b) FBO — operaciones_fbo: cada operación da hasta 2 movimientos
--          (llegada si fecha_aterrizaje >= 2026-01-01, salida si
--          fecha_salida_posicion >= 2026-01-01), cada uno en su propia fecha.
--     movimiento_id no choca entre fuentes: FBO = id*2 (llegada) e id*2+1
--     (salida); HISTORICO = -id. La columna `fuente` lo dice explícito.
--     operacion_id es NULL en el histórico (ahí no existe la operación).
--   · fbo_patron(text): patrón ILIKE con comodines escapados.
--   · fbo_movimientos_filtrados(jsonb): la ÚNICA definición de los filtros.
--     La usan la lista paginada, el resumen y el agregado mensual.
--   · fbo_resumen(jsonb): KPIs y tops, sumados en PostgreSQL.
--   · fbo_movimientos_por_mes(jsonb): una fila por mes.
--   · fbo_opciones(): valores para los desplegables, en un solo jsonb.
--
-- Nada aquí escribe datos ni altera tablas existentes. Sin RLS, sin índices
-- únicos, sin CHECK y sin FK.
-- =============================================================================

BEGIN;

DO $pre$
BEGIN
    IF to_regclass('public.operaciones_fbo') IS NULL THEN
        RAISE EXCEPTION '064a: falta la tabla public.operaciones_fbo.';
    END IF;
    IF to_regclass('public.aviacion_general_operaciones') IS NULL THEN
        RAISE EXCEPTION '064a: falta la tabla public.aviacion_general_operaciones.';
    END IF;
    IF to_regprocedure('public.aviacion_general_ancla(integer, text, date)') IS NULL THEN
        RAISE EXCEPTION '064a: falta public.aviacion_general_ancla (migración 047).';
    END IF;
END
$pre$;

-- Se rehacen desde cero para poder volver a correr el archivo aunque cambie
-- una columna de la vista (CREATE OR REPLACE VIEW no lo permite).
DROP FUNCTION IF EXISTS public.fbo_movimientos_por_mes(jsonb);
DROP FUNCTION IF EXISTS public.fbo_resumen(jsonb);
DROP FUNCTION IF EXISTS public.fbo_movimientos_filtrados(jsonb);
DROP FUNCTION IF EXISTS public.fbo_opciones();
DROP VIEW IF EXISTS public.v_fbo_movimientos;


-- =============================================================================
-- 1) VISTA
-- =============================================================================
CREATE VIEW public.v_fbo_movimientos WITH (security_invoker = true) AS
-- b) FBO · llegadas
SELECT 'FBO'::text                                         AS fuente,
       (o.id * 2)::bigint                                  AS movimiento_id,
       o.id::bigint                                        AS operacion_id,
       o.registro::text                                    AS registro,
       'LLEGADA'::text                                     AS tipo_movimiento,
       o.fecha_aterrizaje::date                            AS fecha,
       o.fecha_aterrizaje::date                            AS fecha_real,
       o.hora_aterrizaje::time                             AS hora,
       o.hora_aterrizaje::time                             AS hora_pista,
       o.hora_llegada_posicion::time                       AS hora_posicion,
       upper(nullif(trim(o.nac_int_llegada), ''))::text    AS ambito,
       upper(nullif(trim(o.origen), ''))::text             AS aeropuerto,
       nullif(trim(o.origen), '')::text                    AS origen,
       nullif(trim(o.destino), '')::text                   AS destino,
       coalesce(o.pax_llegada_adultos, 0)::integer         AS pax_adultos,
       coalesce(o.pax_llegada_infantes, 0)::integer        AS pax_infantes,
       (coalesce(o.pax_llegada_adultos, 0)
        + coalesce(o.pax_llegada_infantes, 0))::integer    AS pax_total,
       o.operador::text                                    AS operador,
       o.matricula::text                                   AS matricula,
       o.tipo_aeronave::text                               AS tipo_aeronave,
       o.tipo_ala::text                                    AS tipo_ala,
       o.vuelo_operado_por::text                           AS vuelo_operado_por,
       (o.fecha_salida_posicion IS NULL)                   AS operacion_abierta
  FROM public.operaciones_fbo o
 WHERE o.fecha_aterrizaje >= DATE '2026-01-01'

UNION ALL

-- b) FBO · salidas
SELECT 'FBO'::text,
       (o.id * 2 + 1)::bigint,
       o.id::bigint,
       o.registro::text,
       'SALIDA'::text,
       o.fecha_salida_posicion::date,
       o.fecha_salida_posicion::date,
       o.hora_salida_posicion::time,
       o.hora_despegue::time,
       o.hora_salida_posicion::time,
       upper(nullif(trim(o.nac_int_salida), ''))::text,
       upper(nullif(trim(o.destino), ''))::text,
       nullif(trim(o.origen), '')::text,
       nullif(trim(o.destino), '')::text,
       coalesce(o.pax_salida_adultos, 0)::integer,
       coalesce(o.pax_salida_infantes, 0)::integer,
       (coalesce(o.pax_salida_adultos, 0)
        + coalesce(o.pax_salida_infantes, 0))::integer,
       o.operador::text,
       o.matricula::text,
       o.tipo_aeronave::text,
       o.tipo_ala::text,
       o.vuelo_operado_por::text,
       false
  FROM public.operaciones_fbo o
 WHERE o.fecha_salida_posicion >= DATE '2026-01-01'

UNION ALL

-- a) HISTORICO · aviacion_general_operaciones, sólo lectura.
--    pax_total = pax_ag (adultos + infantes + pax_total_reportado), que es lo
--    que suma hoy el módulo: en los años capturados como total no hay desglose
--    y por eso pax_total puede ser mayor que pax_adultos + pax_infantes.
SELECT 'HISTORICO'::text,
       (-h.id)::bigint,
       NULL::bigint,
       ('HIST-' || h.id)::text,
       h.tipo_operacion::text,
       h.fecha_conteo::date,
       h.fecha_operacion::date,
       h.hora_real::time,
       (CASE WHEN h.tipo_operacion = 'LLEGADA' THEN h.hora_aterrizaje
             ELSE h.hora_despegue END)::time,
       (CASE WHEN h.tipo_operacion = 'LLEGADA' THEN h.hora_entrada_posicion
             ELSE h.hora_salida_posicion END)::time,
       (CASE h.ambito_operacion WHEN 'NACIONAL'      THEN 'NAC'
                                WHEN 'INTERNACIONAL' THEN 'INT' END)::text,
       h.aeropuerto::text,
       (CASE WHEN h.tipo_operacion = 'LLEGADA' THEN h.aeropuerto END)::text,
       (CASE WHEN h.tipo_operacion = 'SALIDA'  THEN h.aeropuerto END)::text,
       coalesce(h.adultos, 0)::integer,
       coalesce(h.infantes, 0)::integer,
       coalesce(h.pax_ag, 0)::integer,
       h.operador::text,
       h.matricula::text,
       h.tipo_aeronave::text,
       NULL::text,
       NULL::text,
       NULL::boolean
  FROM (
        SELECT o.id, o.tipo_operacion, o.ambito_operacion, o.fecha_operacion,
               o.hora_real, o.hora_aterrizaje, o.hora_entrada_posicion,
               o.hora_salida_posicion, o.hora_despegue,
               o.adultos, o.infantes, o.pax_ag,
               o.operador, o.matricula, o.tipo_aeronave,
               -- Hasta 2024 el origen/destino se anotó como ciudad y desde
               -- 2025 como código: se toma el que haya, como hoy.
               upper(coalesce(nullif(trim(o.aeropuerto_origen_destino), ''),
                              nullif(trim(o.ciudad_origen_destino), ''))) AS aeropuerto,
               -- Fecha de conteo: la misma regla de aviacion_general_resumen
               -- (051) en modo 'rotacion'. 051 además usa la fecha real
               -- cuando el ANCLA cae en 2024/2025; aquí eso no puede pasar:
               -- la fecha es < 2026 y no es 2024/2025, o sea <= 2023, y el
               -- ancla sólo va hacia atrás. El ancla sólo se calcula cuando
               -- hace falta (salidas de 2022-2023).
               CASE
                   WHEN o.tipo_operacion = 'LLEGADA' THEN o.fecha_operacion
                   WHEN extract(year FROM o.fecha_operacion)::int IN (2024, 2025)
                        THEN o.fecha_operacion
                   ELSE public.aviacion_general_ancla(o.folio_rotacion, o.matricula, o.fecha_operacion)
               END AS fecha_conteo
          FROM public.aviacion_general_operaciones o
         WHERE o.estatus_registro = 'ACTIVO'
           -- Una salida sólo se ancla hacia atrás (<= 60 días) y nunca hacia
           -- 2025, así que fecha_operacion < 2026 equivale a fecha de conteo
           -- < 2026: el histórico y FBO no se pisan.
           AND o.fecha_operacion < DATE '2026-01-01'
       ) h;

COMMENT ON VIEW public.v_fbo_movimientos IS
'Movimientos de Aviación General · FBO. HISTORICO = aviacion_general_operaciones ACTIVO < 2026 (fecha de conteo de aviacion_general_resumen); FBO = llegadas y salidas de operaciones_fbo >= 2026. movimiento_id: FBO id*2 / id*2+1, HISTORICO -id. (064a)';

GRANT SELECT ON public.v_fbo_movimientos TO anon, authenticated;


-- =============================================================================
-- 2) PATRÓN DE BÚSQUEDA
--    Coincidencia parcial sin distinguir mayúsculas, con % _ \ escapados:
--    buscar "N_1" no debe casar con "NX1".
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_patron(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
    SELECT CASE
               WHEN nullif(trim(p), '') IS NULL THEN NULL
               ELSE '%' || replace(replace(replace(trim(p), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           END
$fn$;

GRANT EXECUTE ON FUNCTION public.fbo_patron(text) TO anon, authenticated;


-- =============================================================================
-- 3) FILTROS — definición única
--
-- Claves de p_filtros (ausente, null o '' = no filtra):
--   fecha_desde, fecha_hasta  'YYYY-MM-DD', sobre la fecha de cada movimiento
--   tipo_movimiento           LLEGADA | SALIDA
--   ambito                    NAC | INT
--   operador, matricula, tipo_aeronave   parcial, sin mayúsculas
--   aeropuerto                origen en llegadas, destino en salidas
--   texto                     operador, matrícula, tipo, origen, destino, registro
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_movimientos_filtrados(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.v_fbo_movimientos
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
    WITH p AS (
        SELECT coalesce(p_filtros, '{}'::jsonb) AS j
    ),
    f AS (
        SELECT nullif(j->>'fecha_desde', '')::date              AS desde,
               nullif(j->>'fecha_hasta', '')::date              AS hasta,
               nullif(upper(trim(j->>'tipo_movimiento')), '')   AS tipo,
               nullif(upper(trim(j->>'ambito')), '')            AS ambito,
               public.fbo_patron(j->>'operador')                AS operador,
               public.fbo_patron(j->>'matricula')               AS matricula,
               public.fbo_patron(j->>'tipo_aeronave')           AS aeronave,
               public.fbo_patron(j->>'aeropuerto')              AS aeropuerto,
               public.fbo_patron(j->>'texto')                   AS texto
          FROM p
    )
    SELECT m.*
      FROM public.v_fbo_movimientos m
     CROSS JOIN f
     WHERE (f.desde      IS NULL OR m.fecha >= f.desde)
       AND (f.hasta      IS NULL OR m.fecha <= f.hasta)
       AND (f.tipo       IS NULL OR m.tipo_movimiento = f.tipo)
       AND (f.ambito     IS NULL OR m.ambito = f.ambito)
       AND (f.operador   IS NULL OR m.operador ILIKE f.operador)
       AND (f.matricula  IS NULL OR m.matricula ILIKE f.matricula)
       AND (f.aeronave   IS NULL OR m.tipo_aeronave ILIKE f.aeronave)
       AND (f.aeropuerto IS NULL OR m.aeropuerto ILIKE f.aeropuerto)
       AND (f.texto IS NULL
            OR m.operador      ILIKE f.texto
            OR m.matricula     ILIKE f.texto
            OR m.tipo_aeronave ILIKE f.texto
            OR m.origen        ILIKE f.texto
            OR m.destino       ILIKE f.texto
            OR m.registro      ILIKE f.texto)
$fn$;

COMMENT ON FUNCTION public.fbo_movimientos_filtrados(jsonb) IS
'Definición única de los filtros del módulo FBO sobre v_fbo_movimientos. La lista se pide con rpc(...,{count:exact}).order().range(): pagina del lado del servidor. (064a)';

GRANT EXECUTE ON FUNCTION public.fbo_movimientos_filtrados(jsonb) TO anon, authenticated;


-- =============================================================================
-- 4) RESUMEN — KPIs y tops en un solo jsonb (nunca se trunca a 1000 filas:
--    es un valor, no un conjunto de filas)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_resumen(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH m AS (
    SELECT * FROM public.fbo_movimientos_filtrados(p_filtros)
),
t AS (
    SELECT count(*)                                                    AS movimientos,
           count(*) FILTER (WHERE tipo_movimiento = 'LLEGADA')         AS llegadas,
           count(*) FILTER (WHERE tipo_movimiento = 'SALIDA')          AS salidas,
           coalesce(sum(pax_total), 0)                                 AS pax,
           coalesce(sum(pax_total)    FILTER (WHERE tipo_movimiento = 'LLEGADA'), 0) AS pax_llegada,
           coalesce(sum(pax_total)    FILTER (WHERE tipo_movimiento = 'SALIDA'), 0)  AS pax_salida,
           coalesce(sum(pax_adultos), 0)                               AS adultos,
           coalesce(sum(pax_infantes), 0)                              AS infantes,
           count(*) FILTER (WHERE ambito = 'NAC')                      AS nacionales,
           count(*) FILTER (WHERE ambito = 'INT')                      AS internacionales,
           count(*) FILTER (WHERE ambito IS NULL OR ambito NOT IN ('NAC', 'INT')) AS sin_ambito,
           -- Las filas históricas no tienen operación (operacion_id NULL).
           count(DISTINCT operacion_id)                                AS operaciones,
           count(DISTINCT operacion_id) FILTER (WHERE operacion_abierta) AS operaciones_abiertas,
           count(*) FILTER (WHERE fuente = 'HISTORICO')                AS movimientos_historicos,
           count(DISTINCT nullif(upper(trim(operador)), ''))           AS operadores,
           count(DISTINCT nullif(upper(trim(matricula)), ''))          AS matriculas,
           min(fecha)                                                  AS fecha_min,
           max(fecha)                                                  AS fecha_max
      FROM m
),
top AS (
    SELECT 'operadores'::text AS k, upper(trim(operador)) AS clave,
           count(*) AS movimientos, coalesce(sum(pax_total), 0) AS pax
      FROM m WHERE nullif(trim(operador), '') IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'aeronaves', upper(trim(tipo_aeronave)),
           count(*), coalesce(sum(pax_total), 0)
      FROM m WHERE nullif(trim(tipo_aeronave), '') IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'aeropuertos', aeropuerto,
           count(*), coalesce(sum(pax_total), 0)
      FROM m WHERE aeropuerto IS NOT NULL GROUP BY 2
),
rk AS (
    SELECT top.*, row_number() OVER (PARTITION BY k ORDER BY movimientos DESC, clave) AS n
      FROM top
),
mat AS (
    SELECT upper(trim(matricula)) AS clave,
           count(*)               AS movimientos,
           min(tipo_aeronave)     AS tipo_aeronave,
           min(operador)          AS operador
      FROM m
     WHERE nullif(trim(matricula), '') IS NOT NULL
     GROUP BY 1
     ORDER BY 2 DESC, 1
     LIMIT 15
)
SELECT jsonb_build_object(
    'totales',         (SELECT to_jsonb(t) FROM t),
    'top_operadores',  (SELECT coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'movimientos', movimientos, 'pax', pax)
                                         ORDER BY n), '[]'::jsonb)
                          FROM rk WHERE k = 'operadores' AND n <= 15),
    'top_aeronaves',   (SELECT coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'movimientos', movimientos, 'pax', pax)
                                         ORDER BY n), '[]'::jsonb)
                          FROM rk WHERE k = 'aeronaves' AND n <= 15),
    'top_aeropuertos', (SELECT coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'movimientos', movimientos, 'pax', pax)
                                         ORDER BY n), '[]'::jsonb)
                          FROM rk WHERE k = 'aeropuertos' AND n <= 15),
    'top_matriculas',  (SELECT coalesce(jsonb_agg(to_jsonb(mat) ORDER BY mat.movimientos DESC, mat.clave), '[]'::jsonb)
                          FROM mat)
)
$fn$;

COMMENT ON FUNCTION public.fbo_resumen(jsonb) IS
'KPIs del módulo FBO sobre fbo_movimientos_filtrados: movimientos, llegadas, salidas, pasajeros (adultos/infantes), NAC/INT, operaciones (sólo FBO), operadores y matrículas distintos (upper(trim), sin vacíos), y tops. (064a)';

GRANT EXECUTE ON FUNCTION public.fbo_resumen(jsonb) TO anon, authenticated;


-- =============================================================================
-- 5) MOVIMIENTOS POR MES — una fila por mes, según la fecha de cada movimiento
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_movimientos_por_mes(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
    periodo     text,
    anio        integer,
    mes         integer,
    llegadas    bigint,
    salidas     bigint,
    movimientos bigint,
    pax_llegada bigint,
    pax_salida  bigint,
    pax         bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
    SELECT to_char(m.fecha, 'YYYY-MM'),
           extract(year  FROM m.fecha)::integer,
           extract(month FROM m.fecha)::integer,
           count(*) FILTER (WHERE m.tipo_movimiento = 'LLEGADA'),
           count(*) FILTER (WHERE m.tipo_movimiento = 'SALIDA'),
           count(*),
           coalesce(sum(m.pax_total) FILTER (WHERE m.tipo_movimiento = 'LLEGADA'), 0),
           coalesce(sum(m.pax_total) FILTER (WHERE m.tipo_movimiento = 'SALIDA'), 0),
           coalesce(sum(m.pax_total), 0)
      FROM public.fbo_movimientos_filtrados(p_filtros) m
     GROUP BY 1, 2, 3
     ORDER BY 1
$fn$;

COMMENT ON FUNCTION public.fbo_movimientos_por_mes(jsonb) IS
'Llegadas, salidas, movimientos y pasajeros por mes del módulo FBO, con los mismos filtros que fbo_resumen. (064a)';

GRANT EXECUTE ON FUNCTION public.fbo_movimientos_por_mes(jsonb) TO anon, authenticated;


-- =============================================================================
-- 6) OPCIONES — valores presentes, para los desplegables (un solo jsonb)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fbo_opciones()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
    WITH d(k, v) AS (
        SELECT 'operadores',     upper(trim(operador))      FROM public.v_fbo_movimientos
        UNION
        SELECT 'matriculas',     upper(trim(matricula))     FROM public.v_fbo_movimientos
        UNION
        SELECT 'tipos_aeronave', upper(trim(tipo_aeronave)) FROM public.v_fbo_movimientos
        UNION
        SELECT 'aeropuertos',    aeropuerto                 FROM public.v_fbo_movimientos
    )
    SELECT coalesce(jsonb_object_agg(k, vs), '{}'::jsonb)
      FROM (SELECT k, jsonb_agg(v ORDER BY v) AS vs
              FROM d
             WHERE nullif(v, '') IS NOT NULL
             GROUP BY k) s
$fn$;

GRANT EXECUTE ON FUNCTION public.fbo_opciones() TO anon, authenticated;

COMMIT;

-- Confirmación visible: cinco funciones y la vista.
SELECT 'v_fbo_movimientos' AS objeto, (to_regclass('public.v_fbo_movimientos') IS NOT NULL) AS existe
UNION ALL SELECT 'fbo_patron',                (to_regprocedure('public.fbo_patron(text)') IS NOT NULL)
UNION ALL SELECT 'fbo_movimientos_filtrados', (to_regprocedure('public.fbo_movimientos_filtrados(jsonb)') IS NOT NULL)
UNION ALL SELECT 'fbo_resumen',               (to_regprocedure('public.fbo_resumen(jsonb)') IS NOT NULL)
UNION ALL SELECT 'fbo_movimientos_por_mes',   (to_regprocedure('public.fbo_movimientos_por_mes(jsonb)') IS NOT NULL)
UNION ALL SELECT 'fbo_opciones',              (to_regprocedure('public.fbo_opciones()') IS NOT NULL);
