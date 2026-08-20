-- ============================================================================
-- GOMIH | Residuos: columna capturable "Residuos de manejo especial"
-- El bloque de la tabla pasa a llamarse "Residuos de manejo especial y solidos
-- urbanos" y suma una cuarta columna con captura propia, junto a inorganicos,
-- organicos y lodos.
-- Ejecutar en Supabase SQL Editor o aplicar como migracion.
-- ============================================================================

ALTER TABLE public.hidra_residuos_manejo_especial
    ADD COLUMN IF NOT EXISTS manejo_especial_kg NUMERIC(16,2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.hidra_residuos_manejo_especial'::regclass
          AND conname = 'ck_hidra_residuos_manejo_especial_kg'
    ) THEN
        ALTER TABLE public.hidra_residuos_manejo_especial
            ADD CONSTRAINT ck_hidra_residuos_manejo_especial_kg
            CHECK (manejo_especial_kg IS NULL OR manejo_especial_kg >= 0);
    END IF;
END;
$$;

COMMENT ON COLUMN public.hidra_residuos_manejo_especial.manejo_especial_kg IS
    'Residuos de manejo especial capturados aparte de inorganicos, organicos y lodos, en kilogramos. NULL = sin dato capturado.';

COMMENT ON TABLE public.hidra_residuos_manejo_especial IS
    'Registro mensual de residuos de manejo especial y solidos urbanos, peligrosos y valorizables de GOMIH.';

-- La vista anual se recrea: manejo_especial_kg pasa a ser la columna capturada
-- y el total del bloque se expone aparte para evitar ambiguedad.
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
                          OR valorizables_kg IS NOT NULL) AS meses_con_dato
FROM public.hidra_residuos_manejo_especial
GROUP BY anio;

GRANT SELECT ON public.v_hidra_residuos_resumen_anual TO authenticated;

-- Verificacion:
-- SELECT * FROM public.v_hidra_residuos_resumen_anual WHERE anio = 2026;
-- manejo_especial_kg arranca en 0.00 porque la columna nace sin captura.
