-- =====================================================================
-- 063a · Diagnóstico previo a estadistica_ajustada — SOLO LECTURA
--
-- No crea, no cambia y no borra nada. Corre cada bloque por separado
-- (selecciónalo y Run) y pásame el resultado de cada uno.
--
--   1. Cortes vigentes y columnas de las cifras oficiales que ya existen.
--   2. PDF S4-INF-RES-2026(3) (corte 4-oct-2026) contra
--      v_cifras_oficiales_vigentes: sólo renglones que difieren.
--   3. Por mes y segmento: oficial contra el detalle real que se repartiría,
--      con el factor y alertas (SIN DATOS, OFICIAL CERO, factor > ±10 %).
--   4. 2025 Comercial: llegadas / salidas reales por mes.
--   5. Qué suma hoy la pestaña Operaciones en 2025 (Segmento = Todos).
--   6. Tamaño de la capa: filas y celdas distintas al grano propuesto.
--   7. Por qué la Carga 2025 no suma en la pestaña Operaciones (al final).
-- =====================================================================

-- 1) Cortes y estructura -------------------------------------------------
SELECT public.fn_fecha_corte_maestra() AS corte_maestra,
       public.fn_fecha_corte_oficial() AS corte_oficial;

SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('cifras_oficiales_mensuales', 'v_cifras_oficiales_vigentes', 'cifras_oficiales')
 ORDER BY table_name, ordinal_position;

-- 2) PDF contra v_cifras_oficiales_vigentes (ene-2022 a ago-2026) ----------
--    medida = pasajeros (comercial, general) o toneladas (carga).
WITH pdf_anual (categoria, anio, ops, med) AS (VALUES
    ('comercial', 2022, ARRAY[0,0,138,356,371,356,338,620,1327,1866,1784,1840]::numeric[],
                        ARRAY[0,0,14225,35593,36405,33354,36280,53580,102521,185617,203094,211746]::numeric[]),
    ('comercial', 2023, ARRAY[1856,1650,1840,1710,1851,1839,2029,2108,1731,2106,2027,2464]::numeric[],
                        ARRAY[186572,165315,196339,205008,218322,208041,256590,266541,197770,231971,221425,277367]::numeric[]),
    ('comercial', 2024, ARRAY[3161,3190,3620,4333,4387,4509,4701,4749,4553,4779,4816,4936]::numeric[],
                        ARRAY[339052,354017,424298,518932,521107,544724,600910,602796,547003,590528,624883,650204]::numeric[]),
    ('comercial', 2025, ARRAY[4488,4016,4426,4575,4443,4129,4430,4500,4135,4291,4458,4706]::numeric[],
                        ARRAY[565716,488440,570097,621197,586299,541400,604758,630952,546457,584629,632853,685421]::numeric[]),
    ('comercial', 2026, ARRAY[4643,4113,4609,4786,4757,4590,5054,5147]::numeric[],
                        ARRAY[601184,514583,593095,639049,670381,593921,712027,730001]::numeric[]),
    ('general',   2022, ARRAY[0,0,34,24,48,24,24,20,38,76,108,62]::numeric[],
                        ARRAY[0,0,51,54,154,69,66,34,98,219,483,157]::numeric[]),
    ('general',   2023, ARRAY[120,128,158,170,142,226,194,170,196,270,230,208]::numeric[],
                        ARRAY[498,402,463,1191,513,585,452,510,427,1109,1167,843]::numeric[]),
    ('general',   2024, ARRAY[178,223,192,218,261,174,199,185,271,348,242,286]::numeric[],
                        ARRAY[566,793,1645,2863,3108,2164,2496,2151,2964,4274,2946,3667]::numeric[]),
    ('general',   2025, ARRAY[251,242,272,249,226,209,234,282,249,315,285,257]::numeric[],
                        ARRAY[2353,1348,1601,1840,1576,3177,1515,3033,948,1298,1089,1336]::numeric[]),
    ('general',   2026, ARRAY[194,242,263,246,225,276,245,201]::numeric[],
                        ARRAY[549,985,1349,1502,5793,1230,3015,505]::numeric[]),
    ('carga',     2022, ARRAY[0,0,2,0,0,0,0,0,4,2,0,0]::numeric[],
                        ARRAY[0,0,0.49,0,0,0,0,0,4.70,0,0,0]::numeric[]),
    ('carga',     2023, ARRAY[0,5,83,86,86,101,296,661,995,1116,1049,1100]::numeric[],
                        ARRAY[0,24.79,1776.11,1973.07,2054.75,2657.15,12061.95,22653.13,32211.53,37567.61,36843.49,36496.25]::numeric[]),
    ('carga',     2024, ARRAY[1063,1056,1139,1140,1184,1135,1116,1145,1052,1123,1084,982]::numeric[],
                        ARRAY[33787.30,32861.00,38209.17,38502.94,40133.83,39593.67,38531.59,39174.34,35995.97,38827.07,37606.79,34117.49]::numeric[]),
    ('carga',     2025, ARRAY[880,803,916,902,1006,1014,1021,1082,992,1155,1127,1143]::numeric[],
                        ARRAY[27764.47,26628.78,33154.97,30785.67,34190.60,37708.07,35649.92,35737.78,31076.71,37273.41,38433.81,37788.56]::numeric[]),
    ('carga',     2026, ARRAY[1035,1008,1061,1047,1070,1145,1098,1196]::numeric[],
                        ARRAY[31579.77,32265.40,35900.33,33478.36,34039.07,35206.46,36089.41,38197.59]::numeric[])
), pdf AS (
    SELECT p.categoria, p.anio, u.mes::int AS mes, u.operaciones, u.medida
      FROM pdf_anual p, unnest(p.ops, p.med) WITH ORDINALITY AS u(operaciones, medida, mes)
), vig AS (
    SELECT lower(v.categoria) AS categoria, v.anio::int AS anio, v.mes::int AS mes,
           v.operaciones::numeric AS operaciones,
           CASE WHEN lower(v.categoria) = 'carga' THEN v.toneladas ELSE v.pasajeros END::numeric AS medida
      FROM public.v_cifras_oficiales_vigentes v
     WHERE make_date(v.anio::int, v.mes::int, 1) <= DATE '2026-08-01'
)
SELECT coalesce(p.categoria, v.categoria) AS categoria,
       coalesce(p.anio, v.anio)           AS anio,
       coalesce(p.mes, v.mes)             AS mes,
       p.operaciones AS pdf_ops,  v.operaciones AS bd_ops,
       p.medida      AS pdf_medida, v.medida    AS bd_medida
  FROM pdf p
  FULL JOIN vig v ON v.categoria = p.categoria AND v.anio = p.anio AND v.mes = p.mes
 WHERE coalesce(p.operaciones, 0) <> coalesce(v.operaciones, 0)
    OR coalesce(p.medida, 0)      <> coalesce(v.medida, 0)
 ORDER BY 1, 2, 3;
-- Esperado: cero renglones (o sólo meses que la BD no tiene en cero).

-- 3) Oficial contra detalle real, por mes y segmento ----------------------
--    Comercial / Carga: manifiestos_hechos (operaciones = filas con
--    AEROLINEA; "válidas" = no canceladas, como en Estadística).
--    General: totales_detalle_por_dia (regla de rotación de FBO).
WITH ofi AS (
    SELECT v.anio::int AS anio, v.mes::int AS mes, lower(v.categoria) AS cat,
           v.operaciones::numeric AS ops,
           CASE WHEN lower(v.categoria) = 'carga' THEN v.toneladas ELSE v.pasajeros END::numeric AS medida
      FROM public.v_cifras_oficiales_vigentes v
     WHERE make_date(v.anio::int, v.mes::int, 1) <= public.fn_fecha_corte_oficial()
), real_mh AS (
    SELECT h.anio::int AS anio, h.mes::int AS mes,
           CASE WHEN h.es_carga THEN 'carga' ELSE 'comercial' END AS cat,
           count(*)                                AS ops_todas,
           count(*) FILTER (WHERE NOT h.cancelado) AS ops_validas,
           count(*) FILTER (WHERE h.cancelado)     AS ops_canceladas,
           CASE WHEN h.es_carga
                THEN round(coalesce(sum(h.carga_kg) FILTER (WHERE NOT h.cancelado), 0) / 1000, 2)
                ELSE coalesce(sum(h.pax) FILTER (WHERE NOT h.cancelado), 0)
           END                                     AS medida
      FROM public.manifiestos_hechos h
     WHERE h.es_operacion
       AND h.fecha_reporte <= public.fn_fecha_corte_oficial()
     GROUP BY 1, 2, 3, h.es_carga
), real_ag AS (
    SELECT extract(year FROM t.fecha)::int AS anio, extract(month FROM t.fecha)::int AS mes,
           'general'::text AS cat,
           sum(t.operaciones) AS ops_todas, sum(t.operaciones) AS ops_validas, 0::bigint AS ops_canceladas,
           sum(t.pasajeros) AS medida
      FROM public.totales_detalle_por_dia(DATE '2022-01-01', public.fn_fecha_corte_oficial()) t
     WHERE t.categoria = 'general'
     GROUP BY 1, 2
), r AS (
    SELECT * FROM real_mh UNION ALL SELECT * FROM real_ag
)
SELECT coalesce(o.anio, r.anio) AS anio, coalesce(o.mes, r.mes) AS mes, coalesce(o.cat, r.cat) AS segmento,
       o.ops AS oficial_ops, r.ops_validas AS real_ops_validas, r.ops_canceladas AS real_canceladas,
       round(o.ops / nullif(r.ops_validas, 0), 4) AS factor_ops,
       o.medida AS oficial_pax_o_ton, r.medida AS real_pax_o_ton,
       round(o.medida / nullif(r.medida, 0), 4) AS factor_pax_o_ton,
       CASE
           WHEN coalesce(o.ops, 0) > 0 AND coalesce(r.ops_validas, 0) = 0       THEN 'SIN DATOS (ops)'
           WHEN coalesce(o.medida, 0) > 0 AND coalesce(r.medida, 0) = 0         THEN 'SIN DATOS (pax/ton)'
           WHEN coalesce(o.ops, 0) = 0 AND coalesce(r.ops_validas, 0) > 0       THEN 'OFICIAL CERO'
           WHEN abs(o.ops / nullif(r.ops_validas, 0) - 1) > 0.10
             OR abs(o.medida / nullif(r.medida, 0) - 1) > 0.10                  THEN 'FACTOR > ±10%'
           ELSE 'OK'
       END AS alerta
  FROM ofi o
  FULL JOIN r ON r.anio = o.anio AND r.mes = o.mes AND r.cat = o.cat
 ORDER BY 3, 1, 2;

-- 4) 2025 Comercial: llegadas / salidas reales por mes ---------------------
SELECT h.mes,
       count(*) FILTER (WHERE NOT h.cancelado AND h.direccion = 'A') AS llegadas,
       count(*) FILTER (WHERE NOT h.cancelado AND h.direccion = 'D') AS salidas,
       count(*) FILTER (WHERE NOT h.cancelado AND h.direccion IS NULL) AS sin_sentido,
       round(100.0 * count(*) FILTER (WHERE NOT h.cancelado AND h.direccion = 'A')
             / nullif(count(*) FILTER (WHERE NOT h.cancelado), 0), 2) AS pct_llegadas
  FROM public.manifiestos_hechos h
 WHERE h.es_operacion AND NOT h.es_carga AND h.anio = 2025
 GROUP BY ROLLUP (h.mes)
 ORDER BY h.mes NULLS LAST;

-- 5) Qué suma hoy la pestaña Operaciones en 2025 (sin filtros) -------------
SELECT m.segmento_aviacion, m.naturaleza_operacion,
       count(*) FILTER (WHERE NOT m.es_cancelada)                     AS validas,
       count(*) FILTER (WHERE m.es_cancelada)                         AS canceladas,
       count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A') AS llegadas,
       count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D') AS salidas
  FROM public.mv_estadistica_operaciones m
 WHERE m.fecha_operacion BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'
 GROUP BY ROLLUP (m.segmento_aviacion, m.naturaleza_operacion)
 ORDER BY 1 NULLS LAST, 2 NULLS LAST;

-- 6) Tamaño de la capa ----------------------------------------------------
SELECT h.anio,
       count(*) AS filas,
       count(DISTINCT (h.fecha_reporte, h.aerolinea, h.direccion, h.nacional_internacional,
                       h.destino, h.aeronave, h.matricula, h.es_carga)) AS celdas_grano_propuesto
  FROM public.manifiestos_hechos h
 WHERE h.es_operacion
 GROUP BY ROLLUP (h.anio)
 ORDER BY h.anio NULLS LAST;

-- 7) Carga 2025: ¿dónde se pierde? -----------------------------------------
--    Con todos los filtros en "Todos" el panel manda p_filtros = {} y el
--    rango de fechas no cuenta como filtro, así que la causa está en la BD.
-- 7a) Qué objetos están vivos y de dónde leen.
SELECT c.relname, c.relkind,
       position('manifiestos_hechos' IN coalesce(pg_get_viewdef(c.oid), '')) > 0 AS lee_manifiestos_hechos,
       right(regexp_replace(coalesce(pg_get_viewdef(c.oid), ''), '\s+', ' ', 'g'), 300) AS final_de_la_definicion
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('mv_estadistica_operaciones', 'v_estadistica_operaciones', 'mv_estadistica_operaciones_pre060');

SELECT position('FROM public.mv_estadistica_operaciones m' IN pg_get_functiondef(p.oid)) > 0 AS agregado_lee_mv,
       position('es_carga' IN pg_get_functiondef(p.oid)) > 0                                 AS agregado_menciona_es_carga
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.estadistica_agregado(date, date, text[], jsonb, integer)');

-- 7b) manifiestos_hechos 2025 por fuente y clasificación.
SELECT h.fuente, h.es_carga, h.es_operacion, h.clasificacion_origen, count(*) AS filas
  FROM public.manifiestos_hechos h
 WHERE h.fecha_reporte BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2, 3, 4;

-- 7c) maestra_manifiestos 2025 (por su FECHA) por tipo_reporte y AEROLINEA vacía.
SELECT coalesce(m.tipo_reporte, '(nulo)')        AS tipo_reporte,
       (nullif(btrim(m."AEROLINEA"), '') IS NULL) AS sin_aerolinea,
       count(*)                                   AS filas
  FROM public.maestra_manifiestos m
 WHERE public._aifa_fecha_manifiesto(m."FECHA"::text, NULL::date) BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'
 GROUP BY 1, 2
 ORDER BY 1, 2;
