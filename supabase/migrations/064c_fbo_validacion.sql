-- =============================================================================
-- 064c · Aviación General · FBO — validación (SÓLO LECTURA)
--
-- REQUISITOS: 064a y 064b aplicadas.
-- No escribe nada: es un solo SELECT. Selecciona todo y Run; el resultado es
-- una tabla (orden, chequeo, esperado, obtenido, resultado).
--
-- resultado:
--   OK      — cuadra.
--   REVISAR — no cuadra: no usar el módulo hasta entender por qué.
--   INFO    — dato para el cuadro antes/después o anomalía de los datos de
--             origen (no la corrige: sólo la señala).
--
-- QUÉ COMPRUEBA
--   1-3   Que la vista tenga exactamente los movimientos de operaciones_fbo y
--         que fbo_resumen y el agregado mensual NO se trunquen: con más de
--         1000 movimientos, el total del RPC = count(*) de la vista.
--   10-   Que 2022-2025 den lo MISMO que hoy muestra el módulo
--         (aviacion_general_resumen, modo 'rotacion'), por año y por mes.
--   50-   Filtros combinados: el RPC = el mismo filtro escrito a mano.
--   60    Movimientos que cruzan de mes (llegada y salida en meses distintos).
--   70-   Cuadro antes/después 1 Ene – 31 Ago 2026.
--   90-   Anomalías de operaciones_fbo.
-- =============================================================================

WITH
-- ── 1-3 · conteos base y regla de las 1000 filas ────────────────────────────
base AS MATERIALIZED (
    SELECT (SELECT count(*) FROM public.operaciones_fbo WHERE fecha_aterrizaje      >= DATE '2026-01-01')
         + (SELECT count(*) FROM public.operaciones_fbo WHERE fecha_salida_posicion >= DATE '2026-01-01') AS fbo_directo,
           (SELECT count(*) FROM public.v_fbo_movimientos WHERE fuente = 'FBO')                        AS fbo_vista,
           (SELECT count(*) FROM public.v_fbo_movimientos)                                             AS vista,
           (public.fbo_resumen('{}'::jsonb)->'totales'->>'movimientos')::bigint                        AS rpc,
           (SELECT coalesce(sum(movimientos), 0) FROM public.fbo_movimientos_por_mes('{}'::jsonb))     AS mensual,
           (SELECT count(*) FROM public.fbo_movimientos_filtrados('{}'::jsonb))                        AS lista
),
-- ── 10- · histórico 2022-2025 contra el módulo actual ───────────────────────
anios AS (
    SELECT y FROM generate_series(2022, 2025) AS y
),
res_anio AS MATERIALIZED (
    SELECT y,
           public.fbo_resumen(jsonb_build_object('fecha_desde', y || '-01-01', 'fecha_hasta', y || '-12-31')) AS nuevo,
           public.aviacion_general_resumen(jsonb_build_object('fecha_desde', y || '-01-01', 'fecha_hasta', y || '-12-31'),
                                           'rotacion') AS actual
      FROM anios
),
metricas AS (
    SELECT k, row_number() OVER () AS i
      FROM unnest(ARRAY['movimientos', 'llegadas', 'salidas', 'pax', 'nacionales',
                        'internacionales', 'adultos', 'infantes']) AS k
),
hist AS (
    SELECT r.y, m.i, m.k,
           (r.actual->'totales'->>m.k)::numeric AS actual,
           (r.nuevo ->'totales'->>m.k)::numeric AS nuevo
      FROM res_anio r CROSS JOIN metricas m
),
mes_nuevo AS MATERIALIZED (
    SELECT periodo, movimientos, llegadas, salidas, pax
      FROM public.fbo_movimientos_por_mes('{"fecha_desde":"2022-01-01","fecha_hasta":"2025-12-31"}'::jsonb)
),
mes_actual AS MATERIALIZED (
    SELECT x->>'periodo'                 AS periodo,
           (x->>'movimientos')::bigint   AS movimientos,
           (x->>'llegadas')::bigint      AS llegadas,
           (x->>'salidas')::bigint       AS salidas,
           (x->>'pax')::bigint           AS pax
      FROM jsonb_array_elements(
               public.aviacion_general_resumen('{"fecha_desde":"2022-01-01","fecha_hasta":"2025-12-31"}'::jsonb,
                                               'rotacion')->'por_mes') AS x
),
mes_dif AS (
    SELECT count(*) AS meses_distintos,
           string_agg(coalesce(n.periodo, a.periodo), ', ' ORDER BY coalesce(n.periodo, a.periodo)) AS cuales
      FROM mes_nuevo n
      FULL JOIN mes_actual a ON a.periodo = n.periodo
     WHERE n.movimientos IS DISTINCT FROM a.movimientos
        OR n.llegadas    IS DISTINCT FROM a.llegadas
        OR n.salidas     IS DISTINCT FROM a.salidas
        OR n.pax         IS DISTINCT FROM a.pax
),
-- ── 50- · filtros combinados ────────────────────────────────────────────────
f1 AS (
    SELECT (public.fbo_resumen('{"fecha_desde":"2026-03-01","fecha_hasta":"2026-06-30","tipo_movimiento":"SALIDA","ambito":"INT"}'::jsonb)
              ->'totales'->>'movimientos')::bigint AS rpc,
           (SELECT count(*) FROM public.v_fbo_movimientos
             WHERE fecha BETWEEN DATE '2026-03-01' AND DATE '2026-06-30'
               AND tipo_movimiento = 'SALIDA' AND ambito = 'INT') AS manual
),
f2 AS (
    SELECT (public.fbo_resumen('{"fecha_desde":"2026-01-01","fecha_hasta":"2026-12-31","operador":"a","matricula":"n","tipo_movimiento":"LLEGADA"}'::jsonb)
              ->'totales'->>'movimientos')::bigint AS rpc,
           (SELECT count(*) FROM public.v_fbo_movimientos
             WHERE fecha BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
               AND operador ILIKE '%a%' AND matricula ILIKE '%n%'
               AND tipo_movimiento = 'LLEGADA') AS manual
),
f3 AS (
    -- Origen/destino: en llegadas busca en origen y en salidas en destino.
    SELECT (public.fbo_resumen('{"aeropuerto":"mmmx"}'::jsonb)->'totales'->>'movimientos')::bigint AS rpc,
           (SELECT count(*) FROM public.v_fbo_movimientos
             WHERE (tipo_movimiento = 'LLEGADA' AND fuente = 'FBO' AND origen  ILIKE '%mmmx%')
                OR (tipo_movimiento = 'SALIDA'  AND fuente = 'FBO' AND destino ILIKE '%mmmx%')
                OR (fuente = 'HISTORICO' AND aeropuerto ILIKE '%mmmx%')) AS manual
),
-- ── 60 · movimientos que cruzan de mes ──────────────────────────────────────
cruce AS (
    -- Cada operación que cruza de mes debe dar exactamente un movimiento en el
    -- mes de su llegada y otro en el mes de su salida.
    SELECT count(*) AS operaciones,
           count(*) FILTER (WHERE s.en_mes_llegada = 1 AND s.en_mes_salida = 1) AS una_por_mes
      FROM (
            SELECT o.id,
                   (SELECT count(*) FROM public.v_fbo_movimientos m
                     WHERE m.fuente = 'FBO' AND m.operacion_id = o.id
                       AND date_trunc('month', m.fecha) = date_trunc('month', o.fecha_aterrizaje))      AS en_mes_llegada,
                   (SELECT count(*) FROM public.v_fbo_movimientos m
                     WHERE m.fuente = 'FBO' AND m.operacion_id = o.id
                       AND date_trunc('month', m.fecha) = date_trunc('month', o.fecha_salida_posicion)) AS en_mes_salida
              FROM public.operaciones_fbo o
             WHERE o.fecha_aterrizaje      >= DATE '2026-01-01'
               AND o.fecha_salida_posicion >= DATE '2026-01-01'
               AND date_trunc('month', o.fecha_aterrizaje) <> date_trunc('month', o.fecha_salida_posicion)
           ) s
),
-- ── 70- · antes / después, 1 Ene – 31 Ago 2026 ─────────────────────────────
ad AS MATERIALIZED (
    SELECT public.aviacion_general_resumen('{"fecha_desde":"2026-01-01","fecha_hasta":"2026-08-31"}'::jsonb, 'rotacion') AS antes,
           public.fbo_resumen('{"fecha_desde":"2026-01-01","fecha_hasta":"2026-08-31"}'::jsonb)                         AS despues
),
metricas_ad AS (
    SELECT k, row_number() OVER () AS i
      FROM unnest(ARRAY['movimientos', 'llegadas', 'salidas', 'pax', 'nacionales',
                        'internacionales', 'operadores', 'matriculas']) AS k
),
-- ── 90- · anomalías de operaciones_fbo ──────────────────────────────────────
anom AS (
    SELECT count(*) FILTER (WHERE fecha_salida_posicion < fecha_aterrizaje)              AS salida_antes,
           string_agg(registro, ', ' ORDER BY registro)
               FILTER (WHERE fecha_salida_posicion < fecha_aterrizaje)                  AS salida_antes_cuales,
           count(*) FILTER (WHERE fecha_aterrizaje IS NULL)                              AS sin_llegada,
           count(*) FILTER (WHERE fecha_salida_posicion IS NULL)                         AS sin_salida,
           count(*) FILTER (WHERE coalesce(pax_llegada_adultos, 0) + coalesce(pax_llegada_infantes, 0)
                                  IS DISTINCT FROM coalesce(pax_llegada_totales, 0))     AS pax_llegada_no_cuadra,
           count(*) FILTER (WHERE coalesce(pax_salida_adultos, 0) + coalesce(pax_salida_infantes, 0)
                                  IS DISTINCT FROM coalesce(pax_salida_totales, 0))      AS pax_salida_no_cuadra,
           count(*) FILTER (WHERE fecha_aterrizaje > current_date
                               OR fecha_salida_posicion > current_date)                 AS fecha_futura,
           count(*) - count(DISTINCT trim(registro))                                     AS registros_repetidos
      FROM public.operaciones_fbo
)
SELECT orden, chequeo, esperado, obtenido, resultado
  FROM (
    SELECT 1 AS orden, 'FBO: movimientos en la vista = llegadas + salidas de operaciones_fbo' AS chequeo,
           fbo_directo::text AS esperado, fbo_vista::text AS obtenido,
           CASE WHEN fbo_directo = fbo_vista THEN 'OK' ELSE 'REVISAR' END AS resultado
      FROM base
    UNION ALL
    SELECT 2, 'Regla de 1000 filas: fbo_resumen = count(*) de la vista (debe ser > 1000)',
           vista::text, rpc::text,
           CASE WHEN vista = rpc AND rpc > 1000 THEN 'OK'
                WHEN vista = rpc THEN 'OK (pero hay <= 1000 movimientos)'
                ELSE 'REVISAR' END
      FROM base
    UNION ALL
    SELECT 3, 'Agregado mensual y lista paginable = fbo_resumen',
           rpc::text, mensual::text || ' / ' || lista::text,
           CASE WHEN mensual = rpc AND lista = rpc THEN 'OK' ELSE 'REVISAR' END
      FROM base
    UNION ALL
    SELECT 10 + (h.y - 2022) * 10 + h.i::int,
           'Histórico ' || h.y || ' · ' || h.k || ' (hoy en el módulo → nuevo)',
           coalesce(h.actual::text, '—'), coalesce(h.nuevo::text, '—'),
           CASE WHEN h.actual IS NOT DISTINCT FROM h.nuevo THEN 'OK' ELSE 'REVISAR' END
      FROM hist h
    UNION ALL
    SELECT 49, 'Histórico 2022-2025 · meses con diferencias (movimientos, llegadas, salidas o pax)',
           '0', meses_distintos::text || coalesce(' (' || cuales || ')', ''),
           CASE WHEN meses_distintos = 0 THEN 'OK' ELSE 'REVISAR' END
      FROM mes_dif
    UNION ALL
    SELECT 50, 'Filtros combinados: mar–jun 2026 · salidas · INT',
           manual::text, rpc::text, CASE WHEN manual = rpc THEN 'OK' ELSE 'REVISAR' END FROM f1
    UNION ALL
    SELECT 51, 'Filtros combinados: 2026 · llegadas · operador "a" · matrícula "n"',
           manual::text, rpc::text, CASE WHEN manual = rpc THEN 'OK' ELSE 'REVISAR' END FROM f2
    UNION ALL
    SELECT 52, 'Origen/destino "mmmx": origen en llegadas, destino en salidas',
           manual::text, rpc::text, CASE WHEN manual = rpc THEN 'OK' ELSE 'REVISAR' END FROM f3
    UNION ALL
    SELECT 60, 'Operaciones con llegada y salida en meses distintos: un movimiento en cada mes',
           operaciones::text, una_por_mes::text,
           CASE WHEN operaciones = una_por_mes THEN 'OK' ELSE 'REVISAR' END
      FROM cruce
    UNION ALL
    SELECT 70 + m.i::int,
           'Antes/después 1 Ene–31 Ago 2026 · ' || m.k,
           coalesce(ad.antes->'totales'->>m.k, '—'), coalesce(ad.despues->'totales'->>m.k, '—'), 'INFO'
      FROM ad CROSS JOIN metricas_ad m
    UNION ALL
    SELECT 79, 'Antes/después 1 Ene–31 Ago 2026 · operaciones (sólo después)',
           '—', ad.despues->'totales'->>'operaciones', 'INFO'
      FROM ad
    UNION ALL
    SELECT 90, 'operaciones_fbo · salida anterior a la llegada (fecha)',
           '0', salida_antes::text || coalesce(' (' || salida_antes_cuales || ')', ''),
           CASE WHEN salida_antes = 0 THEN 'OK' ELSE 'INFO' END FROM anom
    UNION ALL
    SELECT 91, 'operaciones_fbo · sin fecha de aterrizaje / sin salida',
           '—', sin_llegada::text || ' / ' || sin_salida::text, 'INFO' FROM anom
    UNION ALL
    SELECT 92, 'operaciones_fbo · adultos + infantes ≠ totales (llegada / salida)',
           '0 / 0', pax_llegada_no_cuadra::text || ' / ' || pax_salida_no_cuadra::text,
           CASE WHEN pax_llegada_no_cuadra = 0 AND pax_salida_no_cuadra = 0 THEN 'OK' ELSE 'INFO' END FROM anom
    UNION ALL
    SELECT 93, 'operaciones_fbo · fechas posteriores a hoy',
           '0', fecha_futura::text, CASE WHEN fecha_futura = 0 THEN 'OK' ELSE 'INFO' END FROM anom
    UNION ALL
    SELECT 94, 'operaciones_fbo · registros repetidos',
           '0', registros_repetidos::text, CASE WHEN registros_repetidos = 0 THEN 'OK' ELSE 'REVISAR' END FROM anom
  ) v
 ORDER BY orden;
