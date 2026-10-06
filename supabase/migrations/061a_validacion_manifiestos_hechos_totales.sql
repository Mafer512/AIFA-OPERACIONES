-- =====================================================================
-- 061a · VALIDACIÓN de manifiestos_hechos contra los totales (solo lectura)
-- Se puede repetir cuando sea. La parte que compara inicio, Informe y
-- Estadística es la 061b.
--
-- Desde la 062b todo cuenta por la FECHA del manifiesto y la frontera del
-- detalle es fn_fecha_corte_maestra() (maestra <= corte, Conciliación >
-- corte); ya no hay 2026-01-01 fijo.
--
-- estado = OK      → cuadra exacto (toneladas: ±0.1)
-- estado = REVISAR → hay diferencia; *_dif dice cuánta (real − esperado)
-- 2026: se compara el detalle contra cifras_oficiales_mensuales hasta
-- fn_fecha_corte_oficial(); "TOLERABLE" si difiere ≤ 0.5 %.
-- =====================================================================

-- 1) Por año (2022-2025), por FECHA DE REPORTE (desde la 062b, la FECHA del
--    manifiesto): comercial ops / comercial pax / carga ops / carga toneladas.
--    Estos esperados son los del detalle validado con la 057c (que contaba
--    por cierre de Subsecretaría): un año puede moverse unas filas si tenía
--    cierres que caían en el año siguiente.
WITH esperado (anio, com_ops, com_pax, car_ops, car_ton) AS (
    VALUES (2022,  9639,  912415,     8,     41.6),
           (2023, 23318, 2631261,  6687, 190902.2),
           (2024, 51734, 6318454, 15719, 453740.0),
           (2025, 52597, 7058219, 14830, 434565.8)
), real AS (
    SELECT anio,
           sum(operaciones) FILTER (WHERE NOT es_carga)            AS com_ops,
           sum(pax)         FILTER (WHERE NOT es_carga)            AS com_pax,
           sum(operaciones) FILTER (WHERE es_carga)                AS car_ops,
           round(sum(carga_kg) FILTER (WHERE es_carga) / 1000, 1)  AS car_ton
      FROM public.manifiestos_resumen_dia
     GROUP BY anio
)
SELECT e.anio,
       coalesce(r.com_ops, 0)                 AS comercial_ops,
       coalesce(r.com_ops, 0) - e.com_ops     AS comercial_ops_dif,
       coalesce(r.com_pax, 0)                 AS comercial_pax,
       coalesce(r.com_pax, 0) - e.com_pax     AS comercial_pax_dif,
       coalesce(r.car_ops, 0)                 AS carga_ops,
       coalesce(r.car_ops, 0) - e.car_ops     AS carga_ops_dif,
       coalesce(r.car_ton, 0)                 AS carga_ton,
       coalesce(r.car_ton, 0) - e.car_ton     AS carga_ton_dif,
       CASE WHEN coalesce(r.com_ops, 0) = e.com_ops AND coalesce(r.com_pax, 0) = e.com_pax
             AND coalesce(r.car_ops, 0) = e.car_ops AND abs(coalesce(r.car_ton, 0) - e.car_ton) <= 0.1
            THEN 'OK' ELSE 'REVISAR' END       AS estado
  FROM esperado e
  LEFT JOIN real r ON r.anio = e.anio
 ORDER BY e.anio;

-- 2) 2026 por mes, por FECHA: el detalle de manifiestos_hechos (maestra hasta
--    fn_fecha_corte_maestra(), Conciliación después) contra
--    cifras_oficiales_mensuales, para los meses hasta fn_fecha_corte_oficial().
WITH corte AS (
    SELECT public.fn_fecha_corte_maestra() AS maestra, public.fn_fecha_corte_oficial() AS oficial
), real AS (
    SELECT extract(month FROM fecha_operacion)::int                        AS mes,
           string_agg(DISTINCT fuente, ' + ')                              AS fuente_detalle,
           count(*) FILTER (WHERE es_operacion AND NOT es_carga)           AS com_ops,
           sum(pax) FILTER (WHERE NOT es_carga)                            AS com_pax,
           count(*) FILTER (WHERE es_operacion AND es_carga)               AS car_ops,
           round(sum(carga_kg) FILTER (WHERE es_carga) / 1000, 2)          AS car_ton
      FROM public.manifiestos_hechos
     WHERE fecha_operacion >= DATE '2026-01-01'
       AND fecha_operacion <  DATE '2027-01-01'
     GROUP BY 1
), oficial AS (
    SELECT o.mes,
           max(o.operaciones) FILTER (WHERE o.categoria = 'comercial') AS com_ops,
           max(o.pasajeros)   FILTER (WHERE o.categoria = 'comercial') AS com_pax,
           max(o.operaciones) FILTER (WHERE o.categoria = 'carga')     AS car_ops,
           max(o.toneladas)   FILTER (WHERE o.categoria = 'carga')     AS car_ton
      FROM public.cifras_oficiales_mensuales o, corte
     WHERE o.anio = 2026 AND make_date(o.anio, o.mes, 1) <= corte.oficial
     GROUP BY o.mes
)
SELECT e.mes,
       r.fuente_detalle,
       coalesce(r.com_ops, 0)               AS detalle_com_ops,
       e.com_ops                            AS oficial_com_ops,
       coalesce(r.com_ops, 0) - e.com_ops   AS com_ops_dif,
       coalesce(r.com_pax, 0)               AS detalle_com_pax,
       e.com_pax                            AS oficial_com_pax,
       coalesce(r.com_pax, 0) - e.com_pax   AS com_pax_dif,
       coalesce(r.car_ops, 0)               AS detalle_car_ops,
       e.car_ops                            AS oficial_car_ops,
       coalesce(r.car_ton, 0)               AS detalle_car_ton,
       e.car_ton                            AS oficial_car_ton,
       CASE
           WHEN coalesce(r.com_ops, 0) = e.com_ops AND coalesce(r.com_pax, 0) = e.com_pax
            AND coalesce(r.car_ops, 0) = e.car_ops AND abs(coalesce(r.car_ton, 0) - e.car_ton) <= 0.1 THEN 'OK'
           WHEN abs(coalesce(r.com_ops, 0) - e.com_ops) <= 0.005 * e.com_ops
            AND abs(coalesce(r.com_pax, 0) - e.com_pax) <= 0.005 * e.com_pax
            AND abs(coalesce(r.car_ops, 0) - e.car_ops) <= 0.005 * nullif(e.car_ops, 0) THEN 'TOLERABLE'
           ELSE 'REVISAR'
       END                                  AS estado
  FROM oficial e
  LEFT JOIN real r ON r.mes = e.mes
 ORDER BY e.mes;

-- 3) Cómo se clasificó Comercial/Carga en Conciliación (2026), por motivo.
SELECT clasificacion_origen, es_carga, count(*) AS manifiestos,
       count(DISTINCT aerolinea) AS aerolineas,
       string_agg(DISTINCT aerolinea, ', ') FILTER (WHERE clasificacion_origen NOT LIKE 'catalogo%') AS fuera_de_catalogo
  FROM public.manifiestos_hechos
 WHERE fuente = 'CONCILIACION'
 GROUP BY 1, 2
 ORDER BY 3 DESC;

-- 4) Avisos de periodo activos (el de carga ene–ago 2026 se quita así:
--    UPDATE public.manifiestos_avisos_periodo SET activo = false WHERE clave = 'carga_2026_ene_ago';)
SELECT clave, texto, desde, hasta, categoria, ambitos, activo FROM public.manifiestos_avisos_periodo;

-- Después de la 062b: 062c_quitar_aviso_carga.sql y 061b_validacion_reportes_coinciden.sql
