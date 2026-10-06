-- =============================================================================
-- 057c · Inicio — cifras de Comercial y Carga desde los manifiestos (CORRECCIÓN 2)
-- Reemplaza la función de la 057 con el MISMO nombre, parámetros y columnas:
-- la app no cambia. Selecciona todo y Run.
--
-- REGLA DE FECHA (vale para las dos tablas)
--   · Con "CIERRE SUBSECRETARIA" → cuenta en la fecha del CIERRE.
--   · Sin "CIERRE SUBSECRETARIA" → cuenta en su FECHA (la de la operación).
--   Todos los manifiestos cuentan; el cierre solo decide en qué día caen.
--
-- DE QUÉ TABLA SALE CADA MANIFIESTO (por FECHA de operación, no por cierre)
--   · FECHA hasta el 31/12/2025 → maestra_manifiestos.
--   · FECHA desde el 01/01/2026 → "Conciliación Manifiestos".
--   Así ningún manifiesto se cuenta dos veces, aunque su cierre caiga en
--   el año siguiente.
--
-- COMERCIAL O CARGA
--   · Histórico: por la base de origen (tipo_reporte): PASAJEROS → Comercial,
--     CARGA → Carga. Reproduce las cifras oficiales sin duplicar vuelos que
--     están en la base de pasajeros y en la de carga.
--   · Conciliación: por el catálogo de aerolíneas, como en la 057.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inicio_manifiestos_por_dia(
    p_desde date DEFAULT NULL,
    p_hasta date DEFAULT NULL
)
RETURNS TABLE (
    fecha date,
    comercial_ops bigint,
    comercial_pax numeric,
    carga_ops bigint,
    carga_kg numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    WITH
    -- ── Histórico (FECHA hasta 2025): fecha del cierre si lo tiene, si no FECHA ──
    maestra_filas AS (
        SELECT
            coalesce(
                CASE WHEN btrim(m."CIERRE SUBSECRETARIA") ~ '^\d{2}/\d{2}/\d{4}$'
                     THEN to_date(btrim(m."CIERRE SUBSECRETARIA"), 'DD/MM/YYYY') END,
                to_date(m."FECHA", 'DD/MM/YYYY'))                    AS fecha,
            (m.tipo_reporte = 'CARGA')                                AS es_carga,
            nullif(btrim(m."AEROLINEA"), '') IS NOT NULL              AS con_aerolinea,
            coalesce(m."TOTAL PAX", 0)::numeric                       AS pax,
            coalesce(public._aifa_safe_numeric(m."KG DE CARGA TOTAL"), 0) AS kg
        FROM public.maestra_manifiestos m
        WHERE m."FECHA" ~ '^\d{2}/\d{2}/\d{4}$'
          AND to_date(m."FECHA", 'DD/MM/YYYY') < DATE '2026-01-01'
    ),
    maestra AS (
        SELECT fecha, es_carga,
               count(*) FILTER (WHERE con_aerolinea) AS ops,
               sum(pax) AS pax,
               sum(kg)  AS kg
        FROM maestra_filas
        WHERE (p_desde IS NULL OR fecha >= p_desde)
          AND (p_hasta IS NULL OR fecha <= p_hasta)
        GROUP BY 1, 2
    ),

    -- ── Desde 2026 (FECHA): Conciliación; fecha del cierre si lo tiene, si no FECHA ──
    conci AS (
        SELECT
            coalesce(c."_portal_flight_date", public._aifa_parse_manifest_date(c."FECHA"::text)) AS fecha_operacion,
            coalesce(
                CASE WHEN btrim(c."CIERRE SUBSECRETARIA") ~ '^\d{1,2}/\d{1,2}/\d{4}$'
                     THEN to_date(btrim(c."CIERRE SUBSECRETARIA"), 'DD/MM/YYYY') END,
                c."_portal_flight_date",
                public._aifa_parse_manifest_date(c."FECHA"::text))   AS fecha,
            btrim(coalesce(c."AEROLINEA"::text, ''))                          AS aerolinea,
            upper(left(btrim(coalesce(c."TIPO DE OPERACIÓN"::text, '')), 1))  AS servicio,
            coalesce(public._aifa_safe_numeric(c."TOTAL PAX"::text), 0)       AS pax,
            coalesce(public._aifa_safe_numeric(c."KG DE CARGA TOTAL"::text), 0) AS kg
        FROM public."Conciliación Manifiestos" c
    ),
    grupos AS (
        SELECT f.fecha, f.aerolinea, f.servicio,
               count(*) FILTER (WHERE f.aerolinea <> '') AS ops,
               sum(f.pax) AS pax,
               sum(f.kg)  AS kg
        FROM conci f
        WHERE f.fecha_operacion >= DATE '2026-01-01'
          AND f.fecha IS NOT NULL
          AND (p_desde IS NULL OR f.fecha >= p_desde)
          AND (p_hasta IS NULL OR f.fecha <= p_hasta)
        GROUP BY 1, 2, 3
    ),
    aerolineas AS (
        SELECT DISTINCT g.aerolinea,
            btrim(regexp_replace(regexp_replace(
                translate(lower(g.aerolinea), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
                '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')) AS normal
        FROM grupos g
        WHERE g.aerolinea <> ''
    ),
    tipos AS (
        SELECT a.aerolinea, cat.types
        FROM aerolineas a
        LEFT JOIN LATERAL (
            SELECT ca.types
            FROM public.conciliacion_catalogo_aerolineas ca
            WHERE upper(btrim(coalesce(ca.iata, ''))) = upper(a.aerolinea)
               OR btrim(regexp_replace(regexp_replace(
                    translate(lower(ca.name), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
                    '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')) = a.normal
               OR EXISTS (
                    SELECT 1 FROM unnest(ca.aliases) al
                    WHERE btrim(regexp_replace(regexp_replace(
                        translate(lower(al), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
                        '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')) = a.normal
               )
            ORDER BY (upper(btrim(coalesce(ca.iata, ''))) = upper(a.aerolinea)) DESC, ca.id
            LIMIT 1
        ) cat ON true
    ),
    conci_clasificado AS (
        SELECT g.fecha,
            CASE
                WHEN 'carga' = ANY (coalesce(t.types, '{}')) AND NOT ('pasajeros' = ANY (coalesce(t.types, '{}'))) THEN true
                WHEN 'pasajeros' = ANY (coalesce(t.types, '{}')) AND NOT ('carga' = ANY (coalesce(t.types, '{}'))) THEN false
                ELSE g.servicio IN ('F', 'H')
            END AS es_carga,
            g.ops, g.pax, g.kg
        FROM grupos g
        LEFT JOIN tipos t ON t.aerolinea = g.aerolinea
    ),

    -- ── Unión y totales por día ───────────────────────────────────────────
    todo AS (
        SELECT fecha, es_carga, ops, pax, kg FROM maestra
        UNION ALL
        SELECT fecha, es_carga, ops, pax, kg FROM conci_clasificado
    )
    SELECT
        t.fecha,
        coalesce(sum(t.ops) FILTER (WHERE NOT t.es_carga), 0)::bigint,
        coalesce(sum(t.pax) FILTER (WHERE NOT t.es_carga), 0),
        coalesce(sum(t.ops) FILTER (WHERE t.es_carga), 0)::bigint,
        coalesce(sum(t.kg)  FILTER (WHERE t.es_carga), 0)
    FROM todo t
    GROUP BY t.fecha
    ORDER BY t.fecha;
$$;

COMMENT ON FUNCTION public.inicio_manifiestos_por_dia(date, date) IS
    'Totales diarios de Comercial y Carga para el inicio. Cada manifiesto cuenta en la fecha de su '
    '"CIERRE SUBSECRETARIA" o, si no tiene, en su FECHA. FECHA hasta 2025: maestra_manifiestos '
    '(Comercial/Carga por tipo_reporte); desde 2026: "Conciliación Manifiestos" (por catálogo).';

REVOKE ALL ON FUNCTION public.inicio_manifiestos_por_dia(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inicio_manifiestos_por_dia(date, date) TO authenticated;

COMMIT;

-- Comprobación rápida: totales por año
-- 2024 debe dar 51,734 ops comerciales, 6,318,454 pax y 15,719 ops de carga
-- (2024 no tiene cierres, así que no cambia respecto a su FECHA)
SELECT extract(year FROM fecha)::int AS anio,
       sum(comercial_ops) AS comercial_ops, sum(comercial_pax) AS comercial_pax,
       sum(carga_ops)     AS carga_ops,     round(sum(carga_kg) / 1000, 1) AS carga_toneladas
FROM public.inicio_manifiestos_por_dia()
GROUP BY 1
ORDER BY 1;
