-- ============================================================================
-- GOMIH | Hidraulicas: destino del agua por pozo (AIFA / Ciudad Militar)
--
-- PROBLEMA QUE RESUELVE
--   La demanda AIFA / Cd. Militar del dashboard se leia de las columnas
--   aifa_m3 y cd_militar_m3 de "Extracción_agua_diaria", pero el formulario
--   de captura dejo de pedir ese desglose y guarda 0 en ambas. Resultado:
--   los KPI de demanda y la grafica de distribucion salen siempre vacios.
--
-- MODELO
--   En vez de pedir un desglose diario que nadie tiene, se registra a que
--   destino surte cada pozo. Cada fila significa "DESDE (anio, mes) el pozo
--   X surte a Y", y sigue vigente hasta que otra fila mas reciente la
--   reemplace. Asi se configura una vez y los meses siguientes heredan solo.
--
-- Ejecutar en Supabase SQL Editor o aplicar como migracion.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hidra_pozo_destino (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anio        SMALLINT NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    mes         SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    pozo        TEXT     NOT NULL CHECK (btrim(pozo) <> ''),
    destino     TEXT     NOT NULL CHECK (destino IN ('AIFA', 'CD_MILITAR')),
    created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hidra_pozo_destino UNIQUE (anio, mes, pozo)
);

COMMENT ON TABLE public.hidra_pozo_destino IS
    'Destino del agua extraida por pozo. Cada fila rige DESDE (anio, mes) en adelante hasta que otra fila mas reciente la reemplace.';
COMMENT ON COLUMN public.hidra_pozo_destino.destino IS
    'AIFA o CD_MILITAR. Un pozo sin ninguna fila vigente cuenta como "sin asignar" y no suma a ninguna demanda.';

-- Sirve la busqueda "la fila vigente mas reciente para este pozo".
CREATE INDEX IF NOT EXISTS idx_hidra_pozo_destino_vigencia
    ON public.hidra_pozo_destino (pozo, anio DESC, mes DESC);

CREATE OR REPLACE FUNCTION public.hidra_pozo_destino_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hidra_pozo_destino_updated ON public.hidra_pozo_destino;
CREATE TRIGGER trg_hidra_pozo_destino_updated
    BEFORE UPDATE ON public.hidra_pozo_destino
    FOR EACH ROW EXECUTE FUNCTION public.hidra_pozo_destino_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hidra_pozo_destino TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hidra_pozo_destino_id_seq TO authenticated;

-- RLS: se reusa el helper por niveles (capture escribe, edit borra) si existe;
-- si no, se cae a politicas equivalentes basadas en la seccion.
DO $$
BEGIN
    IF to_regprocedure('public._rls_apply_write_levels(regclass,text,text,boolean)') IS NOT NULL THEN
        PERFORM public._rls_apply_write_levels(
            'public.hidra_pozo_destino'::regclass, 'hidraulicas', 'hidra_pozo_destino');
    ELSE
        EXECUTE 'ALTER TABLE public.hidra_pozo_destino ENABLE ROW LEVEL SECURITY';

        DROP POLICY IF EXISTS hidra_pozo_destino_select ON public.hidra_pozo_destino;
        CREATE POLICY hidra_pozo_destino_select
            ON public.hidra_pozo_destino FOR SELECT TO authenticated USING (true);

        DROP POLICY IF EXISTS hidra_pozo_destino_insert ON public.hidra_pozo_destino;
        CREATE POLICY hidra_pozo_destino_insert
            ON public.hidra_pozo_destino FOR INSERT TO authenticated
            WITH CHECK (public.user_can_access_section('hidraulicas'));

        DROP POLICY IF EXISTS hidra_pozo_destino_update ON public.hidra_pozo_destino;
        CREATE POLICY hidra_pozo_destino_update
            ON public.hidra_pozo_destino FOR UPDATE TO authenticated
            USING (public.user_can_access_section('hidraulicas'))
            WITH CHECK (public.user_can_access_section('hidraulicas'));

        DROP POLICY IF EXISTS hidra_pozo_destino_delete ON public.hidra_pozo_destino;
        CREATE POLICY hidra_pozo_destino_delete
            ON public.hidra_pozo_destino FOR DELETE TO authenticated
            USING (public.user_can_access_section('hidraulicas'));
    END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Vista de demanda mensual, con la misma regla que aplica la app:
--   1) si la fila diaria trae desglose historico capturado, se respeta;
--   2) si no, todo el volumen del pozo va al destino vigente de ese mes;
--   3) si el pozo no tiene destino vigente, cuenta como "sin asignar".
-- Asi aifa + cd_militar + sin_asignar siempre da el total extraido.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_hidra_demanda_mensual AS
SELECT
    e.anio,
    e.mes,
    SUM(CASE
            WHEN COALESCE(e.aifa_m3, 0) <> 0 OR COALESCE(e.cd_militar_m3, 0) <> 0
                THEN COALESCE(e.aifa_m3, 0)
            WHEN d.destino = 'AIFA' THEN COALESCE(e.volumen_m3, 0)
            ELSE 0
        END) AS aifa_m3,
    SUM(CASE
            WHEN COALESCE(e.aifa_m3, 0) <> 0 OR COALESCE(e.cd_militar_m3, 0) <> 0
                THEN COALESCE(e.cd_militar_m3, 0)
            WHEN d.destino = 'CD_MILITAR' THEN COALESCE(e.volumen_m3, 0)
            ELSE 0
        END) AS cd_militar_m3,
    SUM(CASE
            WHEN COALESCE(e.aifa_m3, 0) <> 0 OR COALESCE(e.cd_militar_m3, 0) <> 0 THEN 0
            WHEN d.destino IS NULL THEN COALESCE(e.volumen_m3, 0)
            ELSE 0
        END) AS sin_asignar_m3,
    SUM(COALESCE(e.volumen_m3, 0)) AS total_m3
FROM public."Extracción_agua_diaria" e
LEFT JOIN LATERAL (
    SELECT pd.destino
    FROM public.hidra_pozo_destino pd
    WHERE pd.pozo = e.pozo
      AND (pd.anio * 12 + pd.mes) <= (e.anio * 12 + e.mes)
    ORDER BY pd.anio DESC, pd.mes DESC
    LIMIT 1
) d ON TRUE
GROUP BY e.anio, e.mes;

GRANT SELECT ON public.v_hidra_demanda_mensual TO authenticated;

-- Verificacion:
-- SELECT * FROM public.v_hidra_demanda_mensual WHERE anio = 2026 ORDER BY mes;
-- Mientras no se asigne ningun pozo, todo el volumen aparece en sin_asignar_m3.
