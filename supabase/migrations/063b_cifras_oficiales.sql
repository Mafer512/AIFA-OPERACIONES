-- =====================================================================
-- 063b · cifras_oficiales: cifras entregadas a la Subsecretaría
-- (selecciona todo y Run). UNA transacción: o queda todo, o nada.
-- Tarda menos de un segundo. Se puede volver a correr (UPSERT).
--
-- Fuente: S4-INF-RES-2026(3).PDF, corte 4 de octubre de 2026.
-- Se cargan SÓLO los meses oficiales: ene-2022 a ago-2026 (cierre de
-- agosto validado el 08-sep-2026). Septiembre y octubre de 2026 en ese PDF
-- salen de manifiestos por día: no son cifra oficial y no entran.
--
-- Segmentos:
--   COMERCIAL  operaciones + pasajeros  (toneladas NULL)
--   GENERAL    operaciones + pasajeros  (toneladas NULL)
--   CARGA      operaciones + toneladas  (pasajeros NULL)
--
-- Es la base del reparto de estadistica_ajustada (063c). NO toca
-- cifras_oficiales_mensuales ni v_cifras_oficiales_vigentes (las leen el
-- Inicio y el Informe oficial); al final se listan las diferencias contra
-- esa vista, sólo para revisar.
--
-- Verificación (aborta si falla): cada año suma lo mismo que el renglón
-- anual del PDF. Toneladas: ±0.01, porque el PDF redondea cada mes por
-- separado (Σ meses 2024 = 447,341.16 vs 447,341.17; 2025 = 406,192.75 vs
-- 406,192.74).
-- =====================================================================
BEGIN;

SET LOCAL lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.cifras_oficiales (
    anio         smallint     NOT NULL CHECK (anio BETWEEN 2022 AND 2100),
    mes          smallint     NOT NULL CHECK (mes BETWEEN 1 AND 12),
    segmento     text         NOT NULL CHECK (segmento IN ('COMERCIAL', 'GENERAL', 'CARGA')),
    operaciones  integer      NOT NULL CHECK (operaciones >= 0),
    pasajeros    integer               CHECK (pasajeros >= 0),
    toneladas    numeric(14,2)         CHECK (toneladas >= 0),
    fuente       text         NOT NULL,
    fecha_corte  date         NOT NULL,
    cargado_at   timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (anio, mes, segmento),
    CONSTRAINT cifras_oficiales_medida_por_segmento CHECK (
        (segmento = 'CARGA'  AND pasajeros IS NULL AND toneladas IS NOT NULL)
     OR (segmento <> 'CARGA' AND toneladas IS NULL AND pasajeros IS NOT NULL))
);

COMMENT ON TABLE public.cifras_oficiales IS
    'Cifras oficiales entregadas a la Subsecretaría, por mes y segmento (COMERCIAL, GENERAL, CARGA). '
    'Base del reparto de estadistica_ajustada: cada (mes, segmento) suma exactamente esto. Se carga '
    'desde el PDF del informe (063b); no se captura desde la app.';
COMMENT ON COLUMN public.cifras_oficiales.fuente IS 'Documento del que sale la cifra.';
COMMENT ON COLUMN public.cifras_oficiales.fecha_corte IS 'Corte del documento fuente.';

ALTER TABLE public.cifras_oficiales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cifras_oficiales FROM anon, authenticated;
GRANT SELECT ON public.cifras_oficiales TO authenticated;
DROP POLICY IF EXISTS cifras_oficiales_lectura ON public.cifras_oficiales;
CREATE POLICY cifras_oficiales_lectura ON public.cifras_oficiales
    FOR SELECT TO authenticated USING (true);

-- ── Carga desde el PDF ───────────────────────────────────────────────
-- Un renglón por segmento y año; los arreglos van de enero a diciembre
-- (2026: enero a agosto). med = pasajeros (COMERCIAL, GENERAL) o
-- toneladas (CARGA).
CREATE TEMP TABLE _co_pdf ON COMMIT DROP AS
WITH pdf_anual (segmento, anio, ops, med) AS (VALUES
    ('COMERCIAL', 2022, ARRAY[0,0,138,356,371,356,338,620,1327,1866,1784,1840]::numeric[],
                        ARRAY[0,0,14225,35593,36405,33354,36280,53580,102521,185617,203094,211746]::numeric[]),
    ('COMERCIAL', 2023, ARRAY[1856,1650,1840,1710,1851,1839,2029,2108,1731,2106,2027,2464]::numeric[],
                        ARRAY[186572,165315,196339,205008,218322,208041,256590,266541,197770,231971,221425,277367]::numeric[]),
    ('COMERCIAL', 2024, ARRAY[3161,3190,3620,4333,4387,4509,4701,4749,4553,4779,4816,4936]::numeric[],
                        ARRAY[339052,354017,424298,518932,521107,544724,600910,602796,547003,590528,624883,650204]::numeric[]),
    ('COMERCIAL', 2025, ARRAY[4488,4016,4426,4575,4443,4129,4430,4500,4135,4291,4458,4706]::numeric[],
                        ARRAY[565716,488440,570097,621197,586299,541400,604758,630952,546457,584629,632853,685421]::numeric[]),
    ('COMERCIAL', 2026, ARRAY[4643,4113,4609,4786,4757,4590,5054,5147]::numeric[],
                        ARRAY[601184,514583,593095,639049,670381,593921,712027,730001]::numeric[]),
    ('GENERAL',   2022, ARRAY[0,0,34,24,48,24,24,20,38,76,108,62]::numeric[],
                        ARRAY[0,0,51,54,154,69,66,34,98,219,483,157]::numeric[]),
    ('GENERAL',   2023, ARRAY[120,128,158,170,142,226,194,170,196,270,230,208]::numeric[],
                        ARRAY[498,402,463,1191,513,585,452,510,427,1109,1167,843]::numeric[]),
    ('GENERAL',   2024, ARRAY[178,223,192,218,261,174,199,185,271,348,242,286]::numeric[],
                        ARRAY[566,793,1645,2863,3108,2164,2496,2151,2964,4274,2946,3667]::numeric[]),
    ('GENERAL',   2025, ARRAY[251,242,272,249,226,209,234,282,249,315,285,257]::numeric[],
                        ARRAY[2353,1348,1601,1840,1576,3177,1515,3033,948,1298,1089,1336]::numeric[]),
    ('GENERAL',   2026, ARRAY[194,242,263,246,225,276,245,201]::numeric[],
                        ARRAY[549,985,1349,1502,5793,1230,3015,505]::numeric[]),
    ('CARGA',     2022, ARRAY[0,0,2,0,0,0,0,0,4,2,0,0]::numeric[],
                        ARRAY[0,0,0.49,0,0,0,0,0,4.70,0,0,0]::numeric[]),
    ('CARGA',     2023, ARRAY[0,5,83,86,86,101,296,661,995,1116,1049,1100]::numeric[],
                        ARRAY[0,24.79,1776.11,1973.07,2054.75,2657.15,12061.95,22653.13,32211.53,37567.61,36843.49,36496.25]::numeric[]),
    ('CARGA',     2024, ARRAY[1063,1056,1139,1140,1184,1135,1116,1145,1052,1123,1084,982]::numeric[],
                        ARRAY[33787.30,32861.00,38209.17,38502.94,40133.83,39593.67,38531.59,39174.34,35995.97,38827.07,37606.79,34117.49]::numeric[]),
    ('CARGA',     2025, ARRAY[880,803,916,902,1006,1014,1021,1082,992,1155,1127,1143]::numeric[],
                        ARRAY[27764.47,26628.78,33154.97,30785.67,34190.60,37708.07,35649.92,35737.78,31076.71,37273.41,38433.81,37788.56]::numeric[]),
    ('CARGA',     2026, ARRAY[1035,1008,1061,1047,1070,1145,1098,1196]::numeric[],
                        ARRAY[31579.77,32265.40,35900.33,33478.36,34039.07,35206.46,36089.41,38197.59]::numeric[])
)
SELECT p.segmento, p.anio::smallint AS anio, u.mes::smallint AS mes, u.ops, u.med
  FROM pdf_anual p, unnest(p.ops, p.med) WITH ORDINALITY AS u(ops, med, mes);

-- Totales anuales impresos en el PDF ("TOTAL POR AÑO"; 2026 = ENE-SEP menos
-- septiembre, que no es oficial).
CREATE TEMP TABLE _co_pdf_anual ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('COMERCIAL', 2022,  8996,  912415::numeric), ('COMERCIAL', 2023, 23211, 2631261),
    ('COMERCIAL', 2024, 51734, 6318454),          ('COMERCIAL', 2025, 52597, 7058219),
    ('COMERCIAL', 2026, 37699, 5054241),
    ('GENERAL',   2022,   458,    1385),          ('GENERAL',   2023,  2212,    8160),
    ('GENERAL',   2024,  2777,   29637),          ('GENERAL',   2025,  3071,   21114),
    ('GENERAL',   2026,  1892,   14928),
    ('CARGA',     2022,     8,       5.19),       ('CARGA',     2023,  5578,  186319.83),
    ('CARGA',     2024, 13219,  447341.17),       ('CARGA',     2025, 12041,  406192.74),
    ('CARGA',     2026,  8660,  276756.39)
) AS t(segmento, anio, ops, med);

DO $verif$
DECLARE
    v_txt text;
BEGIN
    SELECT string_agg(format('%s %s: meses %s / %s · PDF %s / %s', a.segmento, a.anio, s.ops, s.med, a.ops, a.med), ' · ')
      INTO v_txt
      FROM _co_pdf_anual a
      LEFT JOIN (SELECT segmento, anio, sum(ops) AS ops, sum(med) AS med FROM _co_pdf GROUP BY 1, 2) s
        ON s.segmento = a.segmento AND s.anio = a.anio
     WHERE s.ops IS DISTINCT FROM a.ops::numeric
        OR abs(coalesce(s.med, -1) - a.med) > CASE WHEN a.segmento = 'CARGA' THEN 0.011 ELSE 0 END;
    IF v_txt IS NOT NULL THEN
        RAISE EXCEPTION 'Las cifras mensuales no suman el total anual del PDF: %', v_txt;
    END IF;
END;
$verif$;

INSERT INTO public.cifras_oficiales AS c (anio, mes, segmento, operaciones, pasajeros, toneladas, fuente, fecha_corte, cargado_at)
SELECT p.anio, p.mes, p.segmento, p.ops::integer,
       CASE WHEN p.segmento <> 'CARGA' THEN p.med::integer END,
       CASE WHEN p.segmento =  'CARGA' THEN p.med END,
       'S4-INF-RES-2026(3).PDF', DATE '2026-10-04', now()
  FROM _co_pdf p
ON CONFLICT (anio, mes, segmento) DO UPDATE SET
    operaciones = EXCLUDED.operaciones, pasajeros = EXCLUDED.pasajeros, toneladas = EXCLUDED.toneladas,
    fuente = EXCLUDED.fuente, fecha_corte = EXCLUDED.fecha_corte, cargado_at = now()
 WHERE (c.operaciones, c.pasajeros, c.toneladas, c.fuente, c.fecha_corte)
       IS DISTINCT FROM (EXCLUDED.operaciones, EXCLUDED.pasajeros, EXCLUDED.toneladas, EXCLUDED.fuente, EXCLUDED.fecha_corte);

COMMIT;

-- ── Resultado 1: totales por año y segmento (deben ser los del PDF) ────
SELECT segmento, anio, count(*) AS meses, sum(operaciones) AS operaciones,
       sum(pasajeros) AS pasajeros, sum(toneladas) AS toneladas
  FROM public.cifras_oficiales
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- ── Resultado 2 (informativo): diferencias contra v_cifras_oficiales_vigentes
-- Cero renglones = las dos fuentes dicen lo mismo.
SELECT coalesce(c.segmento, upper(v.categoria)) AS segmento,
       coalesce(c.anio, v.anio::int)            AS anio,
       coalesce(c.mes,  v.mes::int)             AS mes,
       c.operaciones AS pdf_ops, v.operaciones AS vigente_ops,
       coalesce(c.pasajeros::numeric, c.toneladas)                                           AS pdf_medida,
       CASE WHEN lower(v.categoria) = 'carga' THEN v.toneladas ELSE v.pasajeros END::numeric AS vigente_medida
  FROM public.cifras_oficiales c
  FULL JOIN (SELECT * FROM public.v_cifras_oficiales_vigentes
              WHERE make_date(anio::int, mes::int, 1) <= DATE '2026-08-01') v
    ON upper(v.categoria) = c.segmento AND v.anio::int = c.anio AND v.mes::int = c.mes
 WHERE coalesce(c.operaciones, 0) <> coalesce(v.operaciones, 0)
    OR coalesce(c.pasajeros::numeric, c.toneladas, 0)
       <> coalesce(CASE WHEN lower(v.categoria) = 'carga' THEN v.toneladas ELSE v.pasajeros END, 0)
 ORDER BY 1, 2, 3;
