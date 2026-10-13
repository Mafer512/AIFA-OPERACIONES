-- =====================================================================
-- 063e · Validación de estadistica_ajustada — SOLO LECTURA
-- Correr después de la 063c con "FIN: OK". Cada bloque por separado.
--
--   1. Por mes y segmento: Σ ajustado contra cifras_oficiales.
--      Esperado: estado = OK (diferencia < 0.001) en todos, salvo los
--      marcados SIN DATOS (oficial > 0 sin detalle: no se inventa).
--   2. Resumen del bloque 1 por estado.
--   3. Por año y segmento: Σ ajustado contra Σ cifras_oficiales.
--   4. 2025 Comercial: llegadas / salidas, % real contra % ajustado.
--   5. Ningún manifiesto con 0 operaciones ajustadas y pasajeros > 0.
-- =====================================================================

-- 1) Σ ajustado vs oficial, por mes y segmento ------------------------------
WITH aj AS (
    SELECT anio, mes, segmento,
           sum(ops_ajustadas) AS ops, sum(pax_ajustados) AS pax, sum(ton_ajustadas) AS ton
      FROM public.estadistica_ajustada
     GROUP BY 1, 2, 3
), v AS (
    SELECT c.anio, c.mes, c.segmento,
           c.operaciones AS oficial_ops, c.pasajeros AS oficial_pax, c.toneladas AS oficial_ton,
           coalesce(a.ops, 0) AS ajustado_ops, coalesce(a.pax, 0) AS ajustado_pax, coalesce(a.ton, 0) AS ajustado_ton,
           m.factor_ops, m.factor_pax, m.factor_ton, m.aviso
      FROM public.cifras_oficiales c
      LEFT JOIN aj a ON a.anio = c.anio AND a.mes = c.mes AND a.segmento = c.segmento
      LEFT JOIN public.estadistica_ajustada_mes m ON m.anio = c.anio AND m.mes = c.mes AND m.segmento = c.segmento
     WHERE (make_date(c.anio, c.mes, 1) + interval '1 month - 1 day')::date <= public.fn_fecha_corte_oficial()
)
SELECT anio, mes, segmento,
       oficial_ops, round(ajustado_ops, 6) AS ajustado_ops, round(ajustado_ops - oficial_ops, 6) AS dif_ops,
       oficial_pax, round(ajustado_pax, 6) AS ajustado_pax, round(ajustado_pax - oficial_pax, 6) AS dif_pax,
       oficial_ton, round(ajustado_ton, 6) AS ajustado_ton, round(ajustado_ton - oficial_ton, 6) AS dif_ton,
       round(factor_ops, 6) AS factor_ops, round(factor_pax, 6) AS factor_pax, round(factor_ton, 6) AS factor_ton,
       CASE
           WHEN aviso IS NOT NULL THEN aviso
           WHEN abs(ajustado_ops - oficial_ops) < 0.001
            AND (oficial_pax IS NULL OR abs(ajustado_pax - oficial_pax) < 0.001)
            AND (oficial_ton IS NULL OR abs(ajustado_ton - oficial_ton) < 0.001) THEN 'OK'
           ELSE 'REVISAR'
       END AS estado
  FROM v
 ORDER BY segmento, anio, mes;

-- 2) Resumen por estado ----------------------------------------------------
WITH aj AS (
    SELECT anio, mes, segmento,
           sum(ops_ajustadas) AS ops, sum(pax_ajustados) AS pax, sum(ton_ajustadas) AS ton
      FROM public.estadistica_ajustada
     GROUP BY 1, 2, 3
)
SELECT CASE
           WHEN m.aviso IS NOT NULL THEN 'SIN DATOS'
           WHEN abs(coalesce(a.ops, 0) - c.operaciones) < 0.001
            AND (c.pasajeros IS NULL OR abs(coalesce(a.pax, 0) - c.pasajeros) < 0.001)
            AND (c.toneladas IS NULL OR abs(coalesce(a.ton, 0) - c.toneladas) < 0.001) THEN 'OK'
           ELSE 'REVISAR'
       END AS estado,
       count(*) AS meses_segmento
  FROM public.cifras_oficiales c
  LEFT JOIN aj a ON a.anio = c.anio AND a.mes = c.mes AND a.segmento = c.segmento
  LEFT JOIN public.estadistica_ajustada_mes m ON m.anio = c.anio AND m.mes = c.mes AND m.segmento = c.segmento
 WHERE (make_date(c.anio, c.mes, 1) + interval '1 month - 1 day')::date <= public.fn_fecha_corte_oficial()
 GROUP BY 1
 ORDER BY 1;

-- 3) Por año y segmento ----------------------------------------------------
SELECT c.segmento, c.anio,
       sum(c.operaciones) AS oficial_ops, round(sum(a.ops), 4) AS ajustado_ops,
       sum(c.pasajeros)   AS oficial_pax, round(sum(a.pax), 4) AS ajustado_pax,
       sum(c.toneladas)   AS oficial_ton, round(sum(a.ton), 4) AS ajustado_ton
  FROM public.cifras_oficiales c
  LEFT JOIN (SELECT anio, mes, segmento, sum(ops_ajustadas) AS ops, sum(pax_ajustados) AS pax, sum(ton_ajustadas) AS ton
               FROM public.estadistica_ajustada GROUP BY 1, 2, 3) a
    ON a.anio = c.anio AND a.mes = c.mes AND a.segmento = c.segmento
 WHERE (make_date(c.anio, c.mes, 1) + interval '1 month - 1 day')::date <= public.fn_fecha_corte_oficial()
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- 4) 2025 Comercial: llegadas / salidas, real contra ajustado ---------------
--    El % ajustado de cada mes es el real (el factor es uno por mes y
--    segmento); lo que cambia es la escala. variacion_pct_llegadas mide qué
--    tanto se mueve el % mes a mes (0 = fijo).
WITH x AS (
    SELECT e.mes,
           sum(e.ops_real)      FILTER (WHERE h.direccion = 'A') AS llegadas_real,
           sum(e.ops_real)      FILTER (WHERE h.direccion = 'D') AS salidas_real,
           sum(e.ops_ajustadas) FILTER (WHERE h.direccion = 'A') AS llegadas_aj,
           sum(e.ops_ajustadas) FILTER (WHERE h.direccion = 'D') AS salidas_aj,
           sum(e.ops_real)      AS total_real,
           sum(e.ops_ajustadas) AS total_aj
      FROM public.estadistica_ajustada e
      JOIN public.manifiestos_hechos h ON e.origen = 'MANIFIESTO' AND h.id = e.id_origen
     WHERE e.segmento = 'COMERCIAL' AND e.anio = 2025
     GROUP BY e.mes
)
SELECT mes,
       llegadas_real, salidas_real,
       round(100 * llegadas_real / nullif(total_real, 0), 3) AS pct_llegadas_real,
       round(llegadas_aj, 2) AS llegadas_aj, round(salidas_aj, 2) AS salidas_aj, round(total_aj, 4) AS total_aj,
       round(100 * llegadas_aj / nullif(total_aj, 0), 3) AS pct_llegadas_aj,
       round(stddev_samp(100 * llegadas_real / nullif(total_real, 0)) OVER (), 3) AS variacion_pct_llegadas
  FROM x
 ORDER BY mes;

-- 5) Manifiestos con 0 operaciones ajustadas y pasajeros > 0 (esperado: 0) --
SELECT count(*) AS filas
  FROM public.estadistica_ajustada
 WHERE NOT cancelado AND ops_ajustadas = 0 AND pax_ajustados > 0;
