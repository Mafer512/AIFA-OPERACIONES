-- ============================================================================
-- GOMIH | Residuos de manejo especial, peligrosos y valorizables
-- Tabla mensual, datos base 2026, vista anual y RLS.
-- Ejecutar en Supabase SQL Editor o aplicar como migracion.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hidra_residuos_manejo_especial (
    id                           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anio                         SMALLINT NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    mes_num                      SMALLINT NOT NULL CHECK (mes_num BETWEEN 1 AND 12),
    mes_nombre                   TEXT NOT NULL,
    inorganicos_kg               NUMERIC(16,2) CHECK (inorganicos_kg IS NULL OR inorganicos_kg >= 0),
    organicos_kg                 NUMERIC(16,2) CHECK (organicos_kg IS NULL OR organicos_kg >= 0),
    lodos_kg                     NUMERIC(16,2) CHECK (lodos_kg IS NULL OR lodos_kg >= 0),
    peligrosos_kg                NUMERIC(16,2) CHECK (peligrosos_kg IS NULL OR peligrosos_kg >= 0),
    valorizables_kg              NUMERIC(16,2) CHECK (valorizables_kg IS NULL OR valorizables_kg >= 0),
    observaciones                TEXT,
    fuente                       TEXT NOT NULL DEFAULT 'ASECA, S.A. de C.V. | Gerencia de Servicios Generales',
    created_by                   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hidra_residuos_anio_mes UNIQUE (anio, mes_num),
    CONSTRAINT ck_hidra_residuos_mes_nombre CHECK (btrim(mes_nombre) <> '')
);

COMMENT ON TABLE public.hidra_residuos_manejo_especial IS
    'Registro mensual de residuos de manejo especial, peligrosos y valorizables de GOMIH.';
COMMENT ON COLUMN public.hidra_residuos_manejo_especial.inorganicos_kg IS
    'Residuos de manejo especial inorganicos, en kilogramos. NULL = sin dato capturado.';
COMMENT ON COLUMN public.hidra_residuos_manejo_especial.organicos_kg IS
    'Residuos de manejo especial organicos, en kilogramos. NULL = sin dato capturado.';
COMMENT ON COLUMN public.hidra_residuos_manejo_especial.lodos_kg IS
    'Lodos, en kilogramos. NULL = sin dato capturado.';
COMMENT ON COLUMN public.hidra_residuos_manejo_especial.peligrosos_kg IS
    'Residuos peligrosos, en kilogramos. NULL = sin dato capturado.';
COMMENT ON COLUMN public.hidra_residuos_manejo_especial.valorizables_kg IS
    'Residuos valorizables, en kilogramos. NULL = sin dato capturado.';

CREATE INDEX IF NOT EXISTS idx_hidra_residuos_anio
    ON public.hidra_residuos_manejo_especial (anio);
CREATE INDEX IF NOT EXISTS idx_hidra_residuos_anio_mes
    ON public.hidra_residuos_manejo_especial (anio, mes_num);

CREATE OR REPLACE FUNCTION public.hidra_residuos_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hidra_residuos_updated ON public.hidra_residuos_manejo_especial;
CREATE TRIGGER trg_hidra_residuos_updated
    BEFORE UPDATE ON public.hidra_residuos_manejo_especial
    FOR EACH ROW EXECUTE FUNCTION public.hidra_residuos_set_updated_at();

-- Fuente de verdad para el permiso de captura del módulo.
CREATE OR REPLACE FUNCTION public.hidra_residuos_can_write()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT LOWER(role) INTO v_role
    FROM public.user_roles
    WHERE user_id = auth.uid();

    IF v_role IN ('admin', 'superadmin', 'superuser') THEN
        RETURN TRUE;
    END IF;

    IF v_role IN ('editor', 'capturista')
       AND public.user_can_access_section('hidraulicas') THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hidra_residuos_can_write() TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hidra_residuos_manejo_especial TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hidra_residuos_manejo_especial_id_seq TO authenticated;

ALTER TABLE public.hidra_residuos_manejo_especial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hidra_residuos_select ON public.hidra_residuos_manejo_especial;
CREATE POLICY hidra_residuos_select
    ON public.hidra_residuos_manejo_especial
    FOR SELECT TO authenticated
    USING (public.user_can_access_section('hidraulicas'));

DROP POLICY IF EXISTS hidra_residuos_insert ON public.hidra_residuos_manejo_especial;
CREATE POLICY hidra_residuos_insert
    ON public.hidra_residuos_manejo_especial
    FOR INSERT TO authenticated
    WITH CHECK (public.hidra_residuos_can_write());

DROP POLICY IF EXISTS hidra_residuos_update ON public.hidra_residuos_manejo_especial;
CREATE POLICY hidra_residuos_update
    ON public.hidra_residuos_manejo_especial
    FOR UPDATE TO authenticated
    USING (public.hidra_residuos_can_write())
    WITH CHECK (public.hidra_residuos_can_write());

DROP POLICY IF EXISTS hidra_residuos_delete ON public.hidra_residuos_manejo_especial;
CREATE POLICY hidra_residuos_delete
    ON public.hidra_residuos_manejo_especial
    FOR DELETE TO authenticated
    USING (public.hidra_residuos_can_write());

CREATE OR REPLACE VIEW public.v_hidra_residuos_resumen_anual AS
SELECT
    anio,
    SUM(COALESCE(inorganicos_kg, 0)) AS inorganicos_kg,
    SUM(COALESCE(organicos_kg, 0)) AS organicos_kg,
    SUM(COALESCE(lodos_kg, 0)) AS lodos_kg,
    SUM(COALESCE(inorganicos_kg, 0) + COALESCE(organicos_kg, 0) + COALESCE(lodos_kg, 0)) AS manejo_especial_kg,
    SUM(COALESCE(peligrosos_kg, 0)) AS peligrosos_kg,
    SUM(COALESCE(valorizables_kg, 0)) AS valorizables_kg,
    COUNT(*) FILTER (WHERE inorganicos_kg IS NOT NULL
                          OR organicos_kg IS NOT NULL
                          OR lodos_kg IS NOT NULL
                          OR peligrosos_kg IS NOT NULL
                          OR valorizables_kg IS NOT NULL) AS meses_con_dato
FROM public.hidra_residuos_manejo_especial
GROUP BY anio;

GRANT SELECT ON public.v_hidra_residuos_resumen_anual TO authenticated;

-- Datos proporcionados en la tabla de referencia. Los meses sin captura se
-- insertan como NULL para conservar la diferencia entre "sin dato" y 0.00 kg.
INSERT INTO public.hidra_residuos_manejo_especial
    (anio, mes_num, mes_nombre, inorganicos_kg, organicos_kg, lodos_kg, peligrosos_kg, valorizables_kg)
VALUES
    (2026,  1, 'Enero',      0.00,      0.00,      0.00, 499.20, NULL),
    (2026,  2, 'Febrero', 79480.00, 42070.00,  7570.00, 938.00, 9283.00),
    (2026,  3, 'Marzo',  158900.00, 91100.00,     0.00, 568.10, NULL),
    (2026,  4, 'Abril',  247170.00,150970.00, 14550.00, 159.40, NULL),
    (2026,  5, 'Mayo',   360500.00,174770.00, 14550.00, 867.70, NULL),
    (2026,  6, 'Junio',       NULL,      NULL,      NULL,   NULL, NULL),
    (2026,  7, 'Julio',       NULL,      NULL,      NULL,   NULL, NULL),
    (2026,  8, 'Agosto',      NULL,      NULL,      NULL,   NULL, NULL),
    (2026,  9, 'Septiembre',  NULL,      NULL,      NULL,   NULL, NULL),
    (2026, 10, 'Octubre',     NULL,      NULL,      NULL,   NULL, NULL),
    (2026, 11, 'Noviembre',   NULL,      NULL,      NULL,   NULL, NULL),
    (2026, 12, 'Diciembre',   NULL,      NULL,      NULL,   NULL, NULL)
ON CONFLICT (anio, mes_num) DO UPDATE SET
    mes_nombre      = EXCLUDED.mes_nombre,
    inorganicos_kg  = EXCLUDED.inorganicos_kg,
    organicos_kg    = EXCLUDED.organicos_kg,
    lodos_kg        = EXCLUDED.lodos_kg,
    peligrosos_kg   = EXCLUDED.peligrosos_kg,
    valorizables_kg = EXCLUDED.valorizables_kg,
    updated_at      = NOW();

-- Verificaciones esperadas después de ejecutar:
-- manejo especial: 1,341,630.00 kg con los valores mensuales capturados abajo.
-- La tabla de referencia muestra un subtotal de 1,341,620.00 kg; existe una
-- diferencia de 10.00 kg entre ese subtotal y la suma de sus filas mensuales.
-- peligrosos:           3,032.40 kg
-- valorizables:          9,283.00 kg
-- SELECT * FROM public.v_hidra_residuos_resumen_anual WHERE anio = 2026;
