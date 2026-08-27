-- ============================================================================
-- GOMIH | Residuos historicos 2022-2025
-- Fuente: Registros de residuos 2022-2025.xlsx
--
-- El archivo conserva un esquema distinto al de 2026:
--   - residuos de manejo especial y solidos urbanos: organicos e inorganicos;
--   - residuos peligrosos.
-- Los campos vacios y las filas con "..." se mantienen como NULL: no son cero.
-- ============================================================================

-- Crea el calendario completo solicitado (marzo de 2022 a diciembre de 2025)
-- sin sobrescribir registros que pudieran haberse capturado previamente.
WITH periodos AS (
    SELECT fecha::date
    FROM generate_series(
        DATE '2022-03-01',
        DATE '2025-12-01',
        INTERVAL '1 month'
    ) AS serie(fecha)
)
INSERT INTO public.hidra_residuos_manejo_especial
    (anio, mes_num, mes_nombre, inorganicos_kg, organicos_kg, lodos_kg,
     manejo_especial_kg, peligrosos_kg, valorizables_kg, observaciones, fuente)
SELECT
    EXTRACT(YEAR FROM fecha)::SMALLINT,
    EXTRACT(MONTH FROM fecha)::SMALLINT,
    CASE EXTRACT(MONTH FROM fecha)::INT
        WHEN 1 THEN 'Enero' WHEN 2 THEN 'Febrero' WHEN 3 THEN 'Marzo'
        WHEN 4 THEN 'Abril' WHEN 5 THEN 'Mayo' WHEN 6 THEN 'Junio'
        WHEN 7 THEN 'Julio' WHEN 8 THEN 'Agosto' WHEN 9 THEN 'Septiembre'
        WHEN 10 THEN 'Octubre' WHEN 11 THEN 'Noviembre' WHEN 12 THEN 'Diciembre'
    END,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'Registros de residuos 2022-2025.xlsx'
FROM periodos
ON CONFLICT (anio, mes_num) DO NOTHING;

-- Valores y estados textuales que aparecen de forma explicita en el archivo.
-- Los textos combinados de 2022 se repiten por mes para que la tabla web pueda
-- mostrarlos sin perder el alcance de las celdas combinadas del Excel.
INSERT INTO public.hidra_residuos_manejo_especial
    (anio, mes_num, mes_nombre, inorganicos_kg, organicos_kg, lodos_kg,
     manejo_especial_kg, peligrosos_kg, valorizables_kg, observaciones, fuente)
VALUES
    (2022,  3, 'Marzo',       5280.00,      0.00, NULL, NULL,    NULL, NULL, 'Sin generación',  'Registros de residuos 2022-2025.xlsx'),
    (2022,  4, 'Abril',      22640.00,      0.00, NULL, NULL,    NULL, NULL, 'Sin generación',  'Registros de residuos 2022-2025.xlsx'),
    (2022,  5, 'Mayo',           NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin generación',  'Registros de residuos 2022-2025.xlsx'),
    (2022,  6, 'Junio',          NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin disposición', 'Registros de residuos 2022-2025.xlsx'),
    (2022,  7, 'Julio',          NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin disposición', 'Registros de residuos 2022-2025.xlsx'),
    (2022,  8, 'Agosto',         NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin disposición', 'Registros de residuos 2022-2025.xlsx'),
    (2022,  9, 'Septiembre',     NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin disposición', 'Registros de residuos 2022-2025.xlsx'),
    (2022, 10, 'Octubre',        NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin disposición', 'Registros de residuos 2022-2025.xlsx'),
    (2022, 11, 'Noviembre',      NULL,      NULL, NULL, NULL,    NULL, NULL, 'Sin disposición', 'Registros de residuos 2022-2025.xlsx'),
    (2022, 12, 'Diciembre',      NULL,      NULL, NULL, NULL,  403.60, NULL, NULL,               'Registros de residuos 2022-2025.xlsx'),
    (2023,  1, 'Enero',      41420.00,  82860.00, NULL, NULL,  476.60, NULL, NULL,               'Registros de residuos 2022-2025.xlsx'),
    (2023,  2, 'Febrero',    29650.00, 108120.00, NULL, NULL,    0.00, NULL, NULL,               'Registros de residuos 2022-2025.xlsx'),
    (2024,  1, 'Enero',      52180.00,  12830.00, NULL, NULL,  172.20, NULL, NULL,               'Registros de residuos 2022-2025.xlsx'),
    (2024,  2, 'Febrero',    68840.00,   3640.00, NULL, NULL,  575.00, NULL, NULL,               'Registros de residuos 2022-2025.xlsx'),
    (2025,  1, 'Enero',      91836.00,   2950.00, NULL, NULL,  173.00, NULL, NULL,               'Registros de residuos 2022-2025.xlsx'),
    (2025,  2, 'Febrero',    17710.00,  86390.00, NULL, NULL, 1624.40, NULL, NULL,               'Registros de residuos 2022-2025.xlsx')
ON CONFLICT (anio, mes_num) DO UPDATE SET
    mes_nombre          = EXCLUDED.mes_nombre,
    inorganicos_kg      = EXCLUDED.inorganicos_kg,
    organicos_kg        = EXCLUDED.organicos_kg,
    lodos_kg            = NULL,
    manejo_especial_kg  = NULL,
    peligrosos_kg       = EXCLUDED.peligrosos_kg,
    valorizables_kg     = NULL,
    observaciones       = EXCLUDED.observaciones,
    fuente              = EXCLUDED.fuente,
    updated_at          = NOW();

-- Incluye los estados textuales historicos en el conteo de meses reportados.
DROP VIEW IF EXISTS public.v_hidra_residuos_resumen_anual;

CREATE VIEW public.v_hidra_residuos_resumen_anual AS
SELECT
    anio,
    SUM(COALESCE(inorganicos_kg, 0)) AS inorganicos_kg,
    SUM(COALESCE(organicos_kg, 0)) AS organicos_kg,
    SUM(COALESCE(lodos_kg, 0)) AS lodos_kg,
    SUM(COALESCE(manejo_especial_kg, 0)) AS manejo_especial_kg,
    SUM(COALESCE(inorganicos_kg, 0)
        + COALESCE(organicos_kg, 0)
        + COALESCE(lodos_kg, 0)
        + COALESCE(manejo_especial_kg, 0)) AS manejo_especial_urbanos_kg,
    SUM(COALESCE(peligrosos_kg, 0)) AS peligrosos_kg,
    SUM(COALESCE(valorizables_kg, 0)) AS valorizables_kg,
    COUNT(*) FILTER (WHERE inorganicos_kg IS NOT NULL
                          OR organicos_kg IS NOT NULL
                          OR lodos_kg IS NOT NULL
                          OR manejo_especial_kg IS NOT NULL
                          OR peligrosos_kg IS NOT NULL
                          OR valorizables_kg IS NOT NULL
                          OR NULLIF(BTRIM(observaciones), '') IS NOT NULL) AS meses_con_dato
FROM public.hidra_residuos_manejo_especial
GROUP BY anio;

GRANT SELECT ON public.v_hidra_residuos_resumen_anual TO authenticated;

-- Totales verificables con los valores explicitamente disponibles en la fuente:
-- 2022: manejo especial y urbanos 27,920.00 kg; peligrosos   403.60 kg.
-- 2023: manejo especial y urbanos 262,050.00 kg; peligrosos 476.60 kg.
-- 2024: manejo especial y urbanos 137,490.00 kg; peligrosos 747.20 kg.
-- 2025: manejo especial y urbanos 198,886.00 kg; peligrosos 1,797.40 kg.
-- ============================================================================
