-- =====================================================================
-- Cifras oficiales forzadas (js/estadistico-informe-overrides.js, informe
-- del corte 14-sep-2026) contra manifiestos_hechos. Solo lectura.
--
-- *_dif = manifiestos − oficial.
-- base: 'reporte'   = por fecha_reporte (cierre de Subsecretaría o FECHA),
--                     la misma con la que cuadraron 2022-2025 (061a);
--       'operacion' = por FECHA del manifiesto (como el Excel de 2026).
-- en_app: desde la migración 060 sólo siguen ACTIVAS las de carga ene–ago
-- 2026 (marca "Cifra oficial capturada"); las demás quedan de referencia.
-- Aviación General no se compara: no sale de manifiestos.
-- =====================================================================
WITH oficial (tipo, concepto, base, desde, hasta, ops, pax, ton, activa) AS (
    VALUES
    -- Comercial, mensual 2026 (septiembre: del 1 al corte, 14-sep)
    ('comercial', 'mensual ene 2026', 'operacion', '2026-01-01', '2026-01-31', 4643, 601184, NULL::numeric, false),
    ('comercial', 'mensual feb 2026', 'operacion', '2026-02-01', '2026-02-28', 4113, 514583, NULL, false),
    ('comercial', 'mensual mar 2026', 'operacion', '2026-03-01', '2026-03-31', 4609, 593095, NULL, false),
    ('comercial', 'mensual abr 2026', 'operacion', '2026-04-01', '2026-04-30', 4786, 639049, NULL, false),
    ('comercial', 'mensual may 2026', 'operacion', '2026-05-01', '2026-05-31', 4757, 670381, NULL, false),
    ('comercial', 'mensual jun 2026', 'operacion', '2026-06-01', '2026-06-30', 4590, 593921, NULL, false),
    ('comercial', 'mensual jul 2026', 'operacion', '2026-07-01', '2026-07-31', 5054, 712027, NULL, false),
    ('comercial', 'mensual ago 2026', 'operacion', '2026-08-01', '2026-08-31', 5147, 730001, NULL, false),
    ('comercial', 'mensual sep 2026 (al 14)', 'operacion', '2026-09-01', '2026-09-14', 2112, 273460, NULL, false),
    -- Carga, mensual 2026
    ('carga', 'mensual ene 2026', 'operacion', '2026-01-01', '2026-01-31', 1035, NULL, 31579.77, true),
    ('carga', 'mensual feb 2026', 'operacion', '2026-02-01', '2026-02-28', 1008, NULL, 32265.40, true),
    ('carga', 'mensual mar 2026', 'operacion', '2026-03-01', '2026-03-31', 1061, NULL, 35900.33, true),
    ('carga', 'mensual abr 2026', 'operacion', '2026-04-01', '2026-04-30', 1047, NULL, 33478.36, true),
    ('carga', 'mensual may 2026', 'operacion', '2026-05-01', '2026-05-31', 1070, NULL, 34039.07, true),
    ('carga', 'mensual jun 2026', 'operacion', '2026-06-01', '2026-06-30', 1145, NULL, 35206.46, true),
    ('carga', 'mensual jul 2026', 'operacion', '2026-07-01', '2026-07-31', 1098, NULL, 36089.41, true),
    ('carga', 'mensual ago 2026', 'operacion', '2026-08-01', '2026-08-31', 1196, NULL, 38197.59, true),
    ('carga', 'mensual sep 2026 (al 14)', 'operacion', '2026-09-01', '2026-09-14', 549, NULL, 15715.24, false),
    -- Total por año
    ('comercial', 'año 2022', 'reporte', '2022-01-01', '2022-12-31',  8996,  912415, NULL, false),
    ('comercial', 'año 2023', 'reporte', '2023-01-01', '2023-12-31', 23211, 2631261, NULL, false),
    ('comercial', 'año 2024', 'reporte', '2024-01-01', '2024-12-31', 51734, 6318454, NULL, false),
    ('comercial', 'año 2025', 'reporte', '2025-01-01', '2025-12-31', 52597, 7058219, NULL, false),
    ('comercial', 'año 2026 (al 14-sep)', 'operacion', '2026-01-01', '2026-09-14', 39811, 5327701, NULL, false),
    ('carga', 'año 2022', 'reporte', '2022-01-01', '2022-12-31',     8, NULL,      5.19, false),
    ('carga', 'año 2023', 'reporte', '2023-01-01', '2023-12-31',  5578, NULL, 186319.83, false),
    ('carga', 'año 2024', 'reporte', '2024-01-01', '2024-12-31', 13219, NULL, 447341.17, false),
    ('carga', 'año 2025', 'reporte', '2025-01-01', '2025-12-31', 12041, NULL, 406192.74, false),
    ('carga', 'año 2026 (al 14-sep)', 'operacion', '2026-01-01', '2026-09-14', 9209, NULL, 292471.63, false),
    -- Cronológico 2026
    ('comercial', 'cronológico ene–ago 2026', 'operacion', '2026-01-01', '2026-08-31', 37699, 5054241, NULL, false),
    ('comercial', 'cronológico 1–13 sep 2026', 'operacion', '2026-09-01', '2026-09-13', 1887, 244271, NULL, false),
    ('carga', 'cronológico ene–ago 2026', 'operacion', '2026-01-01', '2026-08-31', 8660, NULL, 276756.39, false),
    ('carga', 'cronológico 1–13 sep 2026', 'operacion', '2026-09-01', '2026-09-13', 510, NULL, 14660.59, false),
    -- Acumulado y día de corte (como los muestra el Informe: por fecha de reporte)
    ('comercial', 'acumulado al 14-sep-2026', 'reporte', '2022-01-01', '2026-09-14', 176349, 22248050, NULL, false),
    ('carga', 'acumulado al 14-sep-2026', 'reporte', '2022-01-01', '2026-09-14', 40055, NULL, 1332330.55, false),
    ('comercial', 'día de corte 14-sep-2026', 'reporte', '2026-09-14', '2026-09-14', 225, 29189, NULL, false),
    ('carga', 'día de corte 14-sep-2026', 'reporte', '2026-09-14', '2026-09-14', 39, NULL, 1054.65, false)
)
SELECT o.tipo,
       o.concepto,
       o.base,
       o.ops                                   AS ops_oficial,
       m.ops                                   AS ops_manifiestos,
       m.ops - o.ops                           AS ops_dif,
       o.pax                                   AS pax_oficial,
       CASE WHEN o.pax IS NOT NULL THEN m.pax END          AS pax_manifiestos,
       CASE WHEN o.pax IS NOT NULL THEN m.pax - o.pax END  AS pax_dif,
       o.ton                                   AS ton_oficial,
       CASE WHEN o.ton IS NOT NULL THEN m.ton END          AS ton_manifiestos,
       CASE WHEN o.ton IS NOT NULL THEN m.ton - o.ton END  AS ton_dif,
       CASE WHEN o.activa THEN 'ACTIVA (cifra oficial capturada)' ELSE 'referencia (inactiva)' END AS en_app
  FROM oficial o
 CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE h.es_operacion)        AS ops,
              coalesce(sum(h.pax), 0)                       AS pax,
              round(coalesce(sum(h.carga_kg), 0) / 1000, 2) AS ton
         FROM public.manifiestos_hechos h
        WHERE h.es_carga = (o.tipo = 'carga')
          AND ((o.base = 'reporte'   AND h.fecha_reporte   BETWEEN o.desde::date AND o.hasta::date)
            OR (o.base = 'operacion' AND h.fecha_operacion BETWEEN o.desde::date AND o.hasta::date))
 ) m
 ORDER BY o.tipo DESC, o.desde, o.hasta;
