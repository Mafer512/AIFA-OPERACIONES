-- =============================================================================
-- Informe Estadístico — vistas de solo lectura sobre maestra_operaciones
--
-- Nuevo módulo "Estadística" (3ra pestaña de Conciliación). Reglas acordadas:
--   · Solo cuenta lo ya CAPTURADO: maestra_operaciones."hora_recepcion" no
--     nulo. Ese campo SOLO lo llena el trigger de "Conciliación Manifiestos"
--     (_aifa_sync_conciliacion_to_maestra, 024/025) — nunca los de itinerario,
--     manifiestos_carga o manifiestos_pasajeros — así que filtrar por él
--     identifica exactamente las filas que pasaron por el worksheet de
--     Conciliación, igual que "HR. DE RECEPCIÓN" no vacío identificaba lo
--     capturado en la tabla original.
--   · IMPORTANTE: esta versión NO toca "Conciliación Manifiestos" (ni lee de
--     ella ni le agrega índices) — esa tabla está en auditoría. Todo se lee
--     de maestra_operaciones (023-026), que la consolida junto con
--     itinerario_vuelos_editable / manifiestos_carga / manifiestos_pasajeros.
--   · Aviación Comercial y Aviación de Carga se calculan en vivo desde aquí.
--     Aviación General NO se deriva de este módulo (no se captura como
--     manifiesto comercial): la UI la lee de monthly_operations/annual_operations.
--   · Pasajeros vs Carga se decide por el catálogo administrable
--     conciliacion_catalogo_aerolineas.types, resuelto vía la FK
--     aerolinea_conciliacion_id que el propio trigger de 024/025 ya calculó
--     (misma regla que ya usaba _conciRowIsCargo en script.js, solo que aquí
--     llega pre-resuelta en vez de tener que repetir el match por nombre).
--
-- 100% ADITIVO sobre maestra_operaciones y sus catálogos: no se modifica
-- ninguna tabla, columna, trigger ni política ya existente. Reutiliza tal
-- cual, sin redefinir, _aifa_route_endpoint (010_flight_movement_uniqueness.sql)
-- y el chequeo de rol público.conciliacion_manifiestos_access_level (016).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Índice de apoyo sobre maestra_operaciones (tabla nueva, no la auditada).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_maestra_operaciones_informe_capturado
    ON public.maestra_operaciones (fecha_operacion)
    WHERE hora_recepcion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maestra_operaciones_informe_itinerario
    ON public.maestra_operaciones (fecha_operacion)
    WHERE hora_recepcion IS NULL AND (datos_origen ? 'itinerario_vuelos_editable');

-- -----------------------------------------------------------------------------
-- 1b) _aifa_tipo_aviacion_service_type — clasifica Comercial/General/Carga a
--     partir del código ICAO de "Service Type" ([Arr]/[Dep] Service Type de
--     itinerario_vuelos_editable, AODB — dato de sistema, NO texto libre
--     tecleado por un capturista, a diferencia de la vieja columna
--     "TIPO DE OPERACIÓN" de "Conciliación Manifiestos"). Mismo catálogo
--     estático que ya usa js/manifiestos.js (_initFlightServiceType) para
--     mostrárselo al capturista al elegir el tipo de vuelo — aquí solo se
--     usa para clasificar, sin tocar ese archivo.
--     SOLO respaldo temporal (ver punto 2): mientras la auditoría de
--     "Conciliación Manifiestos" avanza y hay pocos hora_recepcion reales,
--     esto deja poblar Comercial/Carga con vuelos programados en itinerario
--     aunque su manifiesto todavía no esté conciliado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_tipo_aviacion_service_type(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE upper(btrim(coalesce(p_code, '')))
        -- "Others" del catálogo ICAO: aviación general/privada/oficial/entrenamiento.
        WHEN 'D' THEN 'general' WHEN 'E' THEN 'general' WHEN 'I' THEN 'general'
        WHEN 'K' THEN 'general' WHEN 'N' THEN 'general' WHEN 'P' THEN 'general'
        WHEN 'T' THEN 'general' WHEN 'W' THEN 'general' WHEN 'X' THEN 'general'
        WHEN 'Y' THEN 'general' WHEN 'Z' THEN 'general'
        -- Cargo/Mail puros (sin pasajeros).
        WHEN 'A' THEN 'carga' WHEN 'F' THEN 'carga' WHEN 'H' THEN 'carga'
        WHEN 'M' THEN 'carga' WHEN 'V' THEN 'carga'
        -- Scheduled/Charter/Additional flights con pasajeros (incluye mixtos
        -- pasajero+carga L/Q/R, que cuentan como Comercial en este reparto).
        WHEN 'B' THEN 'comercial' WHEN 'C' THEN 'comercial' WHEN 'G' THEN 'comercial'
        WHEN 'J' THEN 'comercial' WHEN 'L' THEN 'comercial' WHEN 'O' THEN 'comercial'
        WHEN 'Q' THEN 'comercial' WHEN 'R' THEN 'comercial' WHEN 'S' THEN 'comercial'
        WHEN 'U' THEN 'comercial'
        ELSE NULL
    END
$$;

-- -----------------------------------------------------------------------------
-- 2) v_informe_manifiestos_normalizado — una fila por movimiento, con tipo de
--    aviación, kg, capacidad de matrícula y nacional/internacional resueltos.
--
--    Dos fuentes, con prioridad clara vía "capturado":
--      · capturado = true  → maestra_operaciones.hora_recepcion no nulo: dato
--        YA conciliado en "Conciliación Manifiestos" (aerolínea/pax/kg/ruta
--        normalizados por el trigger 024/025, catálogo por FK).
--      · capturado = false → SIN hora_recepcion pero con
--        datos_origen->'itinerario_vuelos_editable': respaldo TEMPORAL con
--        el dato programado (AODB) — Service Type para el tipo de aviación,
--        Routing para Nacional/Internacional, Boarded para pax si el AODB
--        lo trae. Solo entran aquí filas que clasifiquen Comercial o Carga;
--        las que salgan "general" por Service Type se excluyen (Aviación
--        General de este informe sigue viniendo SOLO de
--        monthly_operations/annual_operations, nunca de aquí).
--    Cuando el vuelo por fin se concilie (hora_recepcion se llene), la fila
--    pasa sola a capturado = true con los datos reales — no hay que revertir
--    nada a mano.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_informe_manifiestos_normalizado AS
WITH base AS (
    SELECT
        mo.*,
        -- Alias v_conciliado (no "conciliado" a secas): maestra_operaciones
        -- ya trae su propia columna "conciliado" (no documentada en ningún
        -- migration de este repo — se descubrió por el error 42702 al correr
        -- esto); mo.* la arrastra, así que un alias igual sería ambiguo aun
        -- calificado con b./c. — no es la misma columna, no se usa aquí.
        (mo.hora_recepcion IS NOT NULL) AS v_conciliado,
        mo.datos_origen -> 'itinerario_vuelos_editable' AS itin
    FROM public.maestra_operaciones mo
    WHERE mo.hora_recepcion IS NOT NULL
       OR (mo.datos_origen ? 'itinerario_vuelos_editable')
),
resuelto AS (
    SELECT
        b.*,
        CASE b.tipo_movimiento WHEN 'LLEGADA' THEN 'A' WHEN 'SALIDA' THEN 'D' ELSE NULL END AS v_direccion,
        CASE WHEN b.tipo_movimiento = 'LLEGADA' THEN '[Arr] ' ELSE '[Dep] ' END AS v_lado,
        CASE
            WHEN b.v_conciliado THEN b.aerolinea_origen
            ELSE coalesce(b.itin ->> (CASE b.tipo_movimiento WHEN 'LLEGADA' THEN '[Arr] Airline code' ELSE '[Dep] Airline code' END), b.aerolinea_origen)
        END AS v_aerolinea_cruda,
        CASE
            WHEN b.v_conciliado THEN b.pax_total
            ELSE coalesce(b.pax_total, public._aifa_safe_bigint(b.itin ->> (CASE b.tipo_movimiento WHEN 'LLEGADA' THEN '[Arr] Boarded' ELSE '[Dep] Boarded' END)))
        END AS v_pax_total,
        CASE
            WHEN b.v_conciliado THEN NULL
            ELSE public._aifa_tipo_aviacion_service_type(b.itin ->> (CASE b.tipo_movimiento WHEN 'LLEGADA' THEN '[Arr] Service Type' ELSE '[Dep] Service Type' END))
        END AS v_tipo_service_type,
        coalesce(b.destino_origen, b.origen_origen, b.ruta_origen, b.itin ->> 'Routing') AS v_routing
    FROM base b
),
clasificado AS (
    SELECT
        r.*,
        CASE
            WHEN r.v_conciliado THEN NULL -- se resuelve abajo vía catálogo de aerolíneas (ca.types)
            ELSE r.v_tipo_service_type
        END AS v_tipo_fallback
    FROM resuelto r
)
SELECT
    c.id AS manifiesto_id,
    c.fecha_operacion,
    c.v_direccion AS direccion,
    c.v_aerolinea_cruda AS aerolinea_cruda,
    coalesce(ca.name, c.v_aerolinea_cruda) AS aerolinea,
    CASE
        WHEN c.v_conciliado THEN (
            ca.types IS NOT NULL AND 'carga' = ANY (ca.types) AND NOT ('pasajeros' = ANY (ca.types))
        )
        ELSE (c.v_tipo_fallback = 'carga')
    END AS es_carga,
    c.v_pax_total AS pax_total,
    c.carga_total_kg AS carga_kg,
    c.equipaje_kg,
    c.correo_kg,
    c.matricula_origen AS matricula,
    mm.pasajeros AS capacidad_matricula,
    ep.codigo AS endpoint_code,
    CASE
        WHEN ep.codigo IS NULL THEN NULL
        WHEN left(ep.codigo, 2) = 'MM' AND length(ep.codigo) = 4 THEN 'Nacional'
        WHEN ap.pais IS NULL THEN NULL
        WHEN lower(btrim(ap.pais)) IN ('mexico', 'méxico') THEN 'Nacional'
        ELSE 'Internacional'
    END AS nacional_internacional,
    c.v_conciliado AS capturado
FROM clasificado c
LEFT JOIN LATERAL (
    SELECT cat.name, cat.types
    FROM public.conciliacion_catalogo_aerolineas cat
    WHERE cat.id = c.aerolinea_conciliacion_id
       OR upper(btrim(coalesce(cat.iata, ''))) = upper(btrim(coalesce(c.v_aerolinea_cruda, '')))
       OR lower(btrim(cat.name)) = lower(btrim(coalesce(c.v_aerolinea_cruda, '')))
    ORDER BY (cat.id = c.aerolinea_conciliacion_id) DESC,
             (lower(btrim(cat.name)) = lower(btrim(coalesce(c.v_aerolinea_cruda, '')))) DESC
    LIMIT 1
) ca ON true
LEFT JOIN public.matriculas_manifiestos mm ON mm.id = c.matricula_id
LEFT JOIN LATERAL (
    SELECT public._aifa_route_endpoint(c.v_routing, c.v_direccion) AS codigo
) ep ON true
LEFT JOIN public.catalogo_aeropuertos ap ON ap.iata = ep.codigo
WHERE c.v_conciliado OR c.v_tipo_fallback IN ('comercial', 'carga');

COMMENT ON VIEW public.v_informe_manifiestos_normalizado IS
    'Base normalizada del Informe Estadístico. capturado=true: manifiesto ya '
    'conciliado (hora_recepcion no nulo). capturado=false: RESPALDO TEMPORAL '
    'desde datos_origen->itinerario_vuelos_editable (AODB) mientras avanza la '
    'auditoría de "Conciliación Manifiestos" — se reemplaza solo por el dato '
    'real en cuanto el vuelo se concilie. No lee "Conciliación Manifiestos" '
    'directamente: todo sale de maestra_operaciones.';

GRANT SELECT ON public.v_informe_manifiestos_normalizado TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) v_informe_estadistico_resumen — agregado mensual por tipo de aviación,
--    dirección y nacional/internacional. Fuente de acumulados + tabla mensual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_informe_estadistico_resumen AS
SELECT
    extract(year FROM fecha_operacion)::int AS anio,
    extract(month FROM fecha_operacion)::int AS mes,
    CASE WHEN es_carga THEN 'carga' ELSE 'comercial' END AS tipo_aviacion,
    direccion,
    nacional_internacional,
    count(*)::bigint AS operaciones,
    coalesce(sum(pax_total), 0) AS pax_total,
    coalesce(sum(carga_kg), 0) AS carga_kg_total,
    coalesce(sum(equipaje_kg), 0) AS equipaje_kg_total,
    coalesce(sum(correo_kg), 0) AS correo_kg_total,
    -- Agregadas AL FINAL a propósito: CREATE OR REPLACE VIEW no permite
    -- insertar/reordenar columnas de una vista que ya existe, solo agregar
    -- al final (error 42P16 si no).
    count(*) FILTER (WHERE capturado)::bigint AS operaciones_conciliadas,
    count(*) FILTER (WHERE NOT capturado)::bigint AS operaciones_respaldo_itinerario
FROM public.v_informe_manifiestos_normalizado
WHERE fecha_operacion IS NOT NULL AND direccion IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;

COMMENT ON VIEW public.v_informe_estadistico_resumen IS
    'Agregado mensual (año/mes/tipo de aviación/dirección/nac-int) para el '
    'Informe Estadístico. Solo Comercial y Carga — Aviación General viene de '
    'monthly_operations/annual_operations, no de manifiestos. '
    'operaciones_respaldo_itinerario cuenta lo que todavía no tiene '
    'manifiesto conciliado (ver v_informe_manifiestos_normalizado.capturado).';

GRANT SELECT ON public.v_informe_estadistico_resumen TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) v_informe_estadistico_aerolinea — agregado mensual por aerolínea, para
--    la tabla de "Participación por aerolínea".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_informe_estadistico_aerolinea AS
SELECT
    extract(year FROM fecha_operacion)::int AS anio,
    extract(month FROM fecha_operacion)::int AS mes,
    coalesce(aerolinea, 'SIN AEROLÍNEA') AS aerolinea,
    CASE WHEN es_carga THEN 'carga' ELSE 'comercial' END AS tipo_aviacion,
    direccion,
    count(*)::bigint AS operaciones,
    coalesce(sum(pax_total), 0) AS pax_total,
    coalesce(sum(carga_kg), 0) AS carga_kg_total
FROM public.v_informe_manifiestos_normalizado
WHERE fecha_operacion IS NOT NULL AND direccion IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;

COMMENT ON VIEW public.v_informe_estadistico_aerolinea IS
    'Agregado mensual por aerolínea (año/mes/aerolínea/tipo/dirección) para '
    'la tabla de participación por aerolínea del Informe Estadístico.';

GRANT SELECT ON public.v_informe_estadistico_aerolinea TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) informe_estadistico_aprobaciones — "visto bueno" simple (validado / por /
--    cuándo), igual en espíritu al patrón validado/validado_por/validado_at ya
--    usado en itinerario_vuelos_editable / maestra_operaciones. Tabla nueva:
--    no toca ninguna tabla existente ni auditada.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.informe_estadistico_aprobaciones (
    id                 bigserial PRIMARY KEY,
    periodo_tipo       text NOT NULL CHECK (periodo_tipo IN ('mensual', 'anual', 'corte_dia')),
    anio               smallint NOT NULL,
    -- 0 = "no aplica" (periodo_tipo anual/corte_dia). Plano (no expresión) a
    -- propósito: así el UPSERT del cliente puede usar
    -- ON CONFLICT (periodo_tipo, anio, mes) directo contra el índice único.
    mes                smallint NOT NULL DEFAULT 0 CHECK (mes BETWEEN 0 AND 12),
    fecha_corte        date,
    validado           boolean NOT NULL DEFAULT false,
    validado_por       text,
    validado_por_uid   uuid,
    validado_at        timestamptz,
    pdf_url            text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_informe_estadistico_aprobaciones_periodo
    ON public.informe_estadistico_aprobaciones (periodo_tipo, anio, mes);

ALTER TABLE public.informe_estadistico_aprobaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS informe_estadistico_aprobaciones_select ON public.informe_estadistico_aprobaciones;
CREATE POLICY informe_estadistico_aprobaciones_select
    ON public.informe_estadistico_aprobaciones
    FOR SELECT TO authenticated
    USING (true);

-- Reutiliza tal cual la función ya existente de 016_conciliacion_manifiestos_rbac.sql
-- (sin modificarla): 'admin' ya cubre admin/superadmin de la sección "conciliacion".
DROP POLICY IF EXISTS informe_estadistico_aprobaciones_write ON public.informe_estadistico_aprobaciones;
CREATE POLICY informe_estadistico_aprobaciones_write
    ON public.informe_estadistico_aprobaciones
    FOR ALL TO authenticated
    USING (public.conciliacion_manifiestos_access_level(auth.uid()) = 'admin')
    WITH CHECK (public.conciliacion_manifiestos_access_level(auth.uid()) = 'admin');

GRANT SELECT, INSERT, UPDATE ON TABLE public.informe_estadistico_aprobaciones TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.informe_estadistico_aprobaciones_id_seq TO authenticated;

COMMENT ON TABLE public.informe_estadistico_aprobaciones IS
    'Visto bueno del Informe Estadístico por periodo (mensual/anual/corte de '
    'día): quién lo aprobó, cuándo, y el PDF generado en ese momento.';

COMMIT;
