-- =============================================================================
-- 038 — Motor de agregación estadística
--
-- >>> SUPERADA POR 040_estadistica_motor_v2.sql <<<
--
-- Este archivo se escribió reconstruyendo el esquema de maestra_operaciones a
-- partir de los INSERT de las migraciones 023-034, porque la tabla se creó a
-- mano en Supabase y su DDL no estaba en el repositorio. Con el DDL real a la
-- vista aparecieron 26 columnas que este motor no usaba, cuatro de ellas
-- corrigiendo decisiones que aquí hubo que inferir (cancelado, rotacion_key,
-- movimiento_relacionado_id y capacidad_max_pax).
--
-- La 040 reemplaza la vista materializada y las cuatro funciones de aquí.
-- Lo único que sigue viniendo de este archivo es estadistica_refresco y
-- refrescar_estadistica(), que la 040 no toca.
--
-- Si vas a aplicar todo desde cero: correr esta y luego la 040. Si ya la
-- aplicaste, basta con correr la 040.
--
-- REQUISITOS (en este orden, ya con COMMIT):
--   036_estadistica_clasificacion_reglas.sql
--   037_estadistica_carga_transito.sql
--
-- QUÉ ES
--
--   La DEFINICIÓN CANÓNICA de cada métrica del módulo estadístico, en un solo
--   lugar. Resumen ejecutivo, explorador, comparador, informes y exportaciones
--   consultan todos la misma función: si mañana cambia qué cuenta como
--   "operación válida", cambia aquí y cambia en todas las pantallas a la vez.
--   Ninguna de esas fórmulas se vuelve a escribir en JavaScript.
--
-- FUENTE
--
--   public.vw_maestra_operaciones — es la que manda el conjunto de filas.
--   Se le une public.maestra_operaciones por id para leer las columnas
--   operacionales crudas. Por qué las dos y no sólo la vista: la vista fue
--   creada directamente en Supabase y no está versionada en este repositorio,
--   así que su lista exacta de columnas no se puede dar por conocida; en cambio
--   las columnas de la tabla sí están documentadas por las migraciones 023, 024,
--   025, 032, 033 y 034. De la vista se toman únicamente los campos que el
--   repositorio documenta que resuelve —aerolinea, matricula, causa_demora,
--   fuente_principal (023, bloque de verificación) y matricula_estatus (032)—.
--   Además, las columnas que agregó la 037 NO aparecerían en la vista aunque se
--   hubiera definido como SELECT mo.*: Postgres expande el asterisco al crearla
--   y no lo vuelve a expandir después.
--
--   El bloque 0 comprueba ese contrato ANTES de crear nada y, si falta alguna
--   columna, aborta diciendo exactamente cuál. Es preferible fallar aquí y en
--   voz alta que publicar una estadística silenciosamente incompleta.
--
-- RENDIMIENTO
--
--   El trabajo pesado se hace UNA vez, en una vista materializada indexada, y
--   no en cada consulta — misma lección que dejó la migración 028, donde tres
--   vistas normales encadenadas se recalculaban enteras en cada página de
--   PostgREST. El navegador nunca descarga filas de detalle para sumarlas: pide
--   agregados ya calculados.
--
-- 100% ADITIVO. No toca ninguna tabla, vista, función, política ni índice
-- existente. No modifica los objetos de las migraciones 027/028 (el Informe
-- Estadístico sigue funcionando exactamente igual, sobre sus propias vistas).
--
-- MODO DE USO
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK.
--   2) Revisar la VERIFICACIÓN y, si se ve bien, cambiar ROLLBACK por COMMIT.
--      OJO: CREATE MATERIALIZED VIEW dentro de la transacción de prueba llena
--      la vista de verdad; en bases grandes la primera corrida puede tardar.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;

-- Mismo motivo que en 033/034/035: las funciones auxiliares de 010 y 023 llevan
-- bloque EXCEPTION pero están marcadas PARALLEL SAFE, y en un plan paralelo eso
-- aborta con "25000: cannot start commands during a parallel operation".
SET LOCAL max_parallel_workers_per_gather = 0;


-- =============================================================================
-- 0) CONTRATO DE COLUMNAS — falla temprano y con nombre y apellido
-- =============================================================================
DO $contrato$
DECLARE
    v_faltan text[] := '{}';
    v_col    text;
BEGIN
    IF to_regclass('public.vw_maestra_operaciones') IS NULL THEN
        RAISE EXCEPTION
            'No existe public.vw_maestra_operaciones. Es la fuente principal del módulo estadístico.';
    END IF;

    -- De la vista sólo se exigen los campos que el repositorio documenta.
    FOREACH v_col IN ARRAY ARRAY['id', 'aerolinea', 'matricula', 'causa_demora', 'fuente_principal'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'vw_maestra_operaciones'
               AND column_name = v_col
        ) THEN
            v_faltan := v_faltan || ('vw_maestra_operaciones.' || v_col);
        END IF;
    END LOOP;

    -- De la tabla se exigen las columnas operacionales que usa el motor.
    FOREACH v_col IN ARRAY ARRAY[
        'id', 'fecha_operacion', 'tipo_movimiento', 'numero_vuelo',
        'aerolinea_conciliacion_id', 'aerolinea_origen',
        'matricula_id', 'matricula_origen', 'tipo_aeronave_codigo',
        'tipo_servicio_codigo', 'tipo_servicio_origen',
        'origen_iata', 'destino_iata', 'origen_origen', 'destino_origen',
        'ruta_origen', 'routing',
        'pax_total', 'pax_abordados',
        'carga_total_kg', 'carga_nacional_kg', 'carga_internacional_kg',
        'correo_kg', 'equipaje_kg',
        'carga_descargada_kg', 'carga_embarcada_kg', 'carga_transito_kg',
        'estatus_vuelo', 'estado_puntualidad',
        'hora_programada', 'hora_real_pista', 'hora_real_bloque',
        'minutos_demora', 'codigo_demora_origen',
        'hora_recepcion', 'aodb_legacy_id'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'maestra_operaciones'
               AND column_name = v_col
        ) THEN
            v_faltan := v_faltan || ('maestra_operaciones.' || v_col);
        END IF;
    END LOOP;

    IF array_length(v_faltan, 1) > 0 THEN
        RAISE EXCEPTION E'Faltan columnas requeridas por el motor estadístico:\n  %\n\nRevisar si 037_estadistica_carga_transito.sql ya se aplicó, y si vw_maestra_operaciones expone id/aerolinea/matricula/causa_demora/fuente_principal.',
            array_to_string(v_faltan, E'\n  ');
    END IF;

    RAISE NOTICE 'Contrato de columnas verificado.';
END;
$contrato$;


-- =============================================================================
-- 1) mv_estadistica_operaciones — una fila por MOVIMIENTO, ya resuelta
--
--    Todo lo caro (clasificación por reglas, nacional/internacional por
--    catálogo de aeropuertos, capacidad por matrícula, atribución de tránsito
--    por rotación, cálculo de demora) se paga aquí una sola vez.
-- =============================================================================
DROP MATERIALIZED VIEW IF EXISTS public.mv_estadistica_operaciones CASCADE;

CREATE MATERIALIZED VIEW public.mv_estadistica_operaciones AS
WITH base AS (
    SELECT
        v.id,
        mo.fecha_operacion,
        mo.tipo_movimiento,
        CASE mo.tipo_movimiento WHEN 'LLEGADA' THEN 'A' WHEN 'SALIDA' THEN 'D' END AS direccion,
        mo.numero_vuelo,
        mo.aerolinea_conciliacion_id,
        -- La vista ya resolvió el nombre contra el catálogo; el texto crudo
        -- queda como respaldo y como criterio de las reglas por texto.
        coalesce(NULLIF(btrim(v.aerolinea), ''), NULLIF(btrim(mo.aerolinea_origen), '')) AS aerolinea,
        mo.aerolinea_origen,
        coalesce(NULLIF(btrim(v.matricula), ''), NULLIF(btrim(mo.matricula_origen), ''))  AS matricula,
        mo.matricula_id,
        NULLIF(btrim(mo.tipo_aeronave_codigo), '')                                        AS tipo_aeronave,
        upper(NULLIF(btrim(coalesce(mo.tipo_servicio_codigo, mo.tipo_servicio_origen)), '')) AS tipo_servicio,
        mo.origen_iata, mo.destino_iata, mo.origen_origen, mo.destino_origen,
        mo.ruta_origen, mo.routing,

        -- PASAJEROS: se conserva NULL cuando no hay dato. NULL ("no se sabe")
        -- y 0 ("volaron cero") son cosas distintas y el indicador de cobertura
        -- depende de no confundirlas.
        coalesce(mo.pax_total, mo.pax_abordados)                                          AS pax,

        mo.carga_total_kg, mo.carga_nacional_kg, mo.carga_internacional_kg,
        mo.correo_kg, mo.equipaje_kg,
        mo.carga_descargada_kg, mo.carga_embarcada_kg, mo.carga_transito_kg,

        -- CANCELACIÓN. Dos señales reales, ninguna inventada:
        --   · estatus_vuelo  = "Status" del AODB. Mismo criterio, letra por
        --     letra, que _EXCLUDED_STATUS_RE en js/parte-ops-flights.js:1338.
        --     \y es el límite de palabra de Postgres (equivale a \b de JS).
        --   · estado_puntualidad = columna "PUNTUALIDAD / CANCELACIÓN" del
        --     manifiesto. Mismo criterio que js/analisis-operaciones.js:2639.
        (
            coalesce(mo.estatus_vuelo, '') ~* 'cancel|not.?oper|no.?opera|cnx|nop\y'
            OR public._estadistica_norm(mo.estado_puntualidad) IN ('CANCELADO', 'CANCELADA')
        )                                                                                  AS es_cancelada,

        mo.estado_puntualidad,
        mo.hora_programada,
        coalesce(mo.hora_real_bloque, mo.hora_real_pista)                                  AS hora_real,
        mo.minutos_demora,
        NULLIF(btrim(mo.codigo_demora_origen), '')                                         AS codigo_demora,
        NULLIF(btrim(v.causa_demora), '')                                                  AS causa_demora,
        (mo.hora_recepcion IS NOT NULL)                                                    AS capturado,
        v.fuente_principal,
        mo.aodb_legacy_id
    FROM public.vw_maestra_operaciones v
    JOIN public.maestra_operaciones mo ON mo.id = v.id
    WHERE mo.fecha_operacion IS NOT NULL
      AND mo.tipo_movimiento IN ('LLEGADA', 'SALIDA')
),
ubicada AS (
    SELECT
        b.*,
        -- El "otro extremo" del movimiento: el origen si es llegada, el destino
        -- si es salida. Se prefiere el IATA ya limpio que dejaron las
        -- migraciones 023/033; si no hay, se parsea la ruta con la misma
        -- función que usa todo el resto del sistema (_aifa_route_endpoint, 010).
        coalesce(
            CASE b.direccion WHEN 'A' THEN NULLIF(btrim(b.origen_iata), '')
                             WHEN 'D' THEN NULLIF(btrim(b.destino_iata), '') END,
            public._aifa_route_endpoint(
                coalesce(b.ruta_origen, b.routing,
                         CASE b.direccion WHEN 'A' THEN b.origen_origen ELSE b.destino_origen END),
                b.direccion
            )
        ) AS endpoint_codigo
    FROM base b
),
clasificada AS (
    SELECT
        u.*,
        ap.ciudad AS endpoint_ciudad,
        -- NACIONAL / INTERNACIONAL. Mismo criterio que
        -- v_informe_manifiestos_normalizado (027): un código OACI mexicano
        -- (MMxx) es nacional aunque el catálogo no lo tenga; si el catálogo no
        -- resuelve el país, se deja en NULL — no se supone "nacional".
        CASE
            WHEN u.endpoint_codigo IS NULL THEN NULL
            WHEN left(u.endpoint_codigo, 2) = 'MM' AND length(u.endpoint_codigo) = 4 THEN 'Nacional'
            WHEN ap.pais IS NULL THEN NULL
            WHEN lower(btrim(ap.pais)) IN ('mexico', 'méxico') THEN 'Nacional'
            ELSE 'Internacional'
        END AS nacional_internacional,

        -- CAPACIDAD: viene del modelo maestro (matriculas_manifiestos.pasajeros,
        -- migración 006), no de una tabla propia del módulo estadístico.
        -- Capacidad 0 o negativa se trata como desconocida.
        CASE WHEN mm.pasajeros IS NOT NULL AND mm.pasajeros > 0 THEN mm.pasajeros END AS capacidad_pasajeros,
        mm.tipo_de_aeronave AS tipo_aeronave_matricula,

        fst.descripcion AS tipo_servicio_descripcion,
        fst.categoria   AS tipo_servicio_categoria,

        cl.regla_id,
        cl.segmento_aviacion,
        cl.naturaleza_operacion,

        -- DEMORA. Se prefiere el minutaje capturado; si no hay, se calcula
        -- contra la hora programada. Se descarta lo que caiga fuera de un rango
        -- razonable (-12 h a +48 h): esos valores no son demoras sino fechas mal
        -- interpretadas, y uno solo bastaría para arruinar el promedio.
        CASE
            WHEN u.minutos_demora IS NOT NULL
                 AND u.minutos_demora BETWEEN -720 AND 2880 THEN u.minutos_demora
            WHEN u.hora_programada IS NOT NULL AND u.hora_real IS NOT NULL
                 AND extract(epoch FROM (u.hora_real - u.hora_programada)) / 60.0 BETWEEN -720 AND 2880
                 THEN round(extract(epoch FROM (u.hora_real - u.hora_programada)) / 60.0)
        END AS minutos_demora_calc
    FROM ubicada u
    LEFT JOIN public.catalogo_aeropuertos ap ON ap.iata = u.endpoint_codigo
    LEFT JOIN public.matriculas_manifiestos mm ON mm.id = u.matricula_id
    LEFT JOIN public.flight_service_type fst ON fst.codigo = u.tipo_servicio
    LEFT JOIN LATERAL public.estadistica_resolver_clasificacion(
        u.fecha_operacion,
        u.aerolinea_conciliacion_id,
        coalesce(u.aerolinea_origen, u.aerolinea),
        u.tipo_aeronave,
        u.tipo_servicio
    ) cl ON true
)
SELECT
    c.id,
    c.fecha_operacion,
    extract(year  FROM c.fecha_operacion)::int  AS anio,
    extract(month FROM c.fecha_operacion)::int  AS mes,
    extract(day   FROM c.fecha_operacion)::int  AS dia,
    extract(isodow FROM c.fecha_operacion)::int AS dia_semana,
    to_char(c.fecha_operacion, 'IYYY-"W"IW')    AS semana_iso,
    c.tipo_movimiento,
    c.direccion,
    c.numero_vuelo,
    coalesce(c.aerolinea, 'SIN AEROLÍNEA')      AS aerolinea,
    c.aerolinea_conciliacion_id,
    c.matricula,
    coalesce(c.tipo_aeronave, c.tipo_aeronave_matricula) AS tipo_aeronave,
    c.capacidad_pasajeros,
    c.tipo_servicio,
    c.tipo_servicio_descripcion,
    c.tipo_servicio_categoria,

    c.endpoint_codigo,
    coalesce(c.endpoint_ciudad, c.endpoint_codigo) AS endpoint_ciudad,
    -- AIFA como el extremo fijo del movimiento. 'NLU' es el código IATA del
    -- aeropuerto y ya está fijado así en el resto del sistema
    -- (FORCED_AIRPORT_MAIN_CODE en js/manifiestos.js:17).
    CASE c.direccion WHEN 'A' THEN c.endpoint_codigo ELSE 'NLU' END AS origen_codigo,
    CASE c.direccion WHEN 'D' THEN c.endpoint_codigo ELSE 'NLU' END AS destino_codigo,
    CASE c.direccion
        WHEN 'A' THEN coalesce(c.endpoint_codigo, '?') || ' → NLU'
        ELSE 'NLU → ' || coalesce(c.endpoint_codigo, '?')
    END AS ruta,
    c.nacional_internacional,

    c.es_cancelada,

    c.segmento_aviacion,
    c.naturaleza_operacion,
    c.regla_id,
    (c.segmento_aviacion IS NOT NULL AND c.naturaleza_operacion IS NOT NULL) AS clasificada,

    c.pax,
    -- La operación entra al factor de ocupación sólo si tiene LAS DOS cifras.
    -- Numerador y denominador se calculan sobre exactamente el mismo conjunto
    -- de filas: si no, el porcentaje no significa nada.
    (c.pax IS NOT NULL AND c.capacidad_pasajeros IS NOT NULL) AS ocupacion_evaluable,

    c.carga_total_kg,
    c.carga_nacional_kg,
    c.carga_internacional_kg,
    c.correo_kg,
    c.equipaje_kg,
    c.carga_transito_kg,

    -- DESCARGADA / EMBARCADA. Si el desglose se capturó, manda el dato. Si no,
    -- se deriva de la carga transportada restando el tránsito conocido: en una
    -- llegada, todo lo que no siguió a bordo se bajó aquí. Cuando tampoco hay
    -- tránsito capturado la resta es un no-op y el valor iguala a la carga
    -- transportada — por eso va acompañado de carga_desglose_capturado, para
    -- que la pantalla pueda decir cuánto de la cifra es dato y cuánto es
    -- deducción.
    CASE
        WHEN c.carga_descargada_kg IS NOT NULL THEN c.carga_descargada_kg
        WHEN c.direccion = 'A' AND c.carga_total_kg IS NOT NULL
            THEN greatest(c.carga_total_kg - coalesce(c.carga_transito_kg, 0), 0)
    END AS carga_descargada_kg,
    CASE
        WHEN c.carga_embarcada_kg IS NOT NULL THEN c.carga_embarcada_kg
        WHEN c.direccion = 'D' AND c.carga_total_kg IS NOT NULL
            THEN greatest(c.carga_total_kg - coalesce(c.carga_transito_kg, 0), 0)
    END AS carga_embarcada_kg,
    (c.carga_descargada_kg IS NOT NULL OR c.carga_embarcada_kg IS NOT NULL
        OR c.carga_transito_kg IS NOT NULL) AS carga_desglose_capturado,

    -- ROTACIÓN y ATRIBUCIÓN ÚNICA DEL TRÁNSITO.
    --
    -- aodb_legacy_id es la fila del AODB de la que salieron los dos
    -- movimientos: ES la rotación, y ya estaba en el modelo desde la migración
    -- 023. No se emparejan movimientos por matrícula + hora, que confunde dos
    -- rotaciones de la misma matrícula el mismo día.
    --
    -- Las mismas 30 toneladas que llegan a bordo y siguen a bordo aparecen en
    -- la llegada Y en la salida. Contarlas dos veces duplicaría la estadística
    -- de tránsito, así que se atribuyen a UN solo movimiento de la rotación:
    -- la llegada si la tiene capturada, y si no, el que la tenga. El otro lado
    -- recibe 0 — no NULL, para que se distinga "es el otro lado de una rotación
    -- ya contada" de "no se capturó".
    c.aodb_legacy_id AS rotacion_id,
    CASE WHEN c.aodb_legacy_id IS NOT NULL THEN 'aodb' ELSE 'sin_rotacion' END AS rotacion_origen,
    CASE
        WHEN c.carga_transito_kg IS NULL THEN NULL
        WHEN c.aodb_legacy_id IS NULL THEN c.carga_transito_kg
        WHEN row_number() OVER (
                PARTITION BY c.aodb_legacy_id
                ORDER BY (c.carga_transito_kg IS NOT NULL) DESC,
                         c.es_cancelada ASC,
                         (c.direccion = 'A') DESC,
                         c.id
             ) = 1 THEN c.carga_transito_kg
        ELSE 0
    END AS transito_contable_kg,

    c.minutos_demora_calc AS minutos_demora,
    c.codigo_demora,
    c.causa_demora,
    -- Puntualidad. Umbral institucional de 15 minutos: es el mismo que ya usa
    -- la columna "DEMORA +- 15 MIN." de Conciliación. Cuando no hay minutaje se
    -- cae al dictamen textual del manifiesto, y si tampoco lo hay la operación
    -- simplemente no es evaluable (ni puntual ni demorada).
    CASE
        WHEN c.minutos_demora_calc IS NOT NULL THEN c.minutos_demora_calc <= 15
        WHEN public._estadistica_norm(c.estado_puntualidad) LIKE 'PUNTUAL%' THEN true
        WHEN public._estadistica_norm(c.estado_puntualidad) LIKE 'DEMORAD%'
          OR public._estadistica_norm(c.estado_puntualidad) LIKE 'RETRASAD%' THEN false
    END AS es_puntual,

    c.hora_programada,
    c.hora_real,
    extract(hour FROM (c.hora_programada AT TIME ZONE 'America/Mexico_City'))::int AS hora_local,
    c.capturado,
    c.fuente_principal
FROM clasificada c;

-- Índices. El único de los cuatro que es obligatorio es el UNIQUE: sin él
-- REFRESH MATERIALIZED VIEW CONCURRENTLY no está permitido, y sin CONCURRENTLY
-- cada refresco bloquea la lectura del módulo entero.
CREATE UNIQUE INDEX idx_mv_estadistica_id
    ON public.mv_estadistica_operaciones (id);

CREATE INDEX idx_mv_estadistica_fecha
    ON public.mv_estadistica_operaciones (fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_periodo
    ON public.mv_estadistica_operaciones (anio, mes)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_aerolinea
    ON public.mv_estadistica_operaciones (aerolinea, fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_clasificacion
    ON public.mv_estadistica_operaciones (segmento_aviacion, naturaleza_operacion, fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_sin_clasificar
    ON public.mv_estadistica_operaciones (fecha_operacion)
    WHERE NOT clasificada AND NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_endpoint
    ON public.mv_estadistica_operaciones (endpoint_codigo, fecha_operacion)
    WHERE NOT es_cancelada;

COMMENT ON MATERIALIZED VIEW public.mv_estadistica_operaciones IS
    'Una fila por movimiento aeroportuario, ya resuelta: clasificación por '
    'reglas (036), nacional/internacional, capacidad, desglose y atribución '
    'única de carga en tránsito (037), y demora. Fuente: vw_maestra_operaciones '
    'unida a maestra_operaciones. Se refresca con refrescar_estadistica().';


-- =============================================================================
-- 2) Vista pública con nombre estable
--
--    El cliente y las funciones consultan SIEMPRE este nombre. Si algún día la
--    materialización cambia de forma, esta vista absorbe el cambio.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_estadistica_operaciones AS
SELECT * FROM public.mv_estadistica_operaciones;

COMMENT ON VIEW public.v_estadistica_operaciones IS
    'Nombre público y estable del detalle estadístico por movimiento.';

GRANT SELECT ON public.mv_estadistica_operaciones TO authenticated;
GRANT SELECT ON public.v_estadistica_operaciones  TO authenticated;


-- =============================================================================
-- 3) Control de frescura y refresco
--    Mismo patrón, ya probado, de la migración 028.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.estadistica_refresco (
    id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    refrescado_at timestamptz NOT NULL DEFAULT now(),
    refrescado_por uuid,
    duracion_ms   integer
);

INSERT INTO public.estadistica_refresco (id, refrescado_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.estadistica_refresco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estadistica_refresco_select ON public.estadistica_refresco;
CREATE POLICY estadistica_refresco_select
    ON public.estadistica_refresco
    FOR SELECT TO authenticated
    USING (public.estadistica_access_level(auth.uid()) <> 'none');

GRANT SELECT ON TABLE public.estadistica_refresco TO authenticated;

CREATE OR REPLACE FUNCTION public.refrescar_estadistica(p_forzar boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ultimo timestamptz;
    v_inicio timestamptz := clock_timestamp();
BEGIN
    -- La escritura es lo que se protege: cualquiera con lectura puede ver la
    -- estadística, pero rehacer la materialización es una operación cara y
    -- queda para quien administra.
    IF public.estadistica_access_level(auth.uid()) NOT IN ('admin', 'edit') THEN
        RAISE EXCEPTION 'Acceso denegado: se requiere nivel edit o admin para refrescar la estadística.'
            USING ERRCODE = '42501';
    END IF;

    SELECT refrescado_at INTO v_ultimo FROM public.estadistica_refresco WHERE id = 1;

    -- Freno de 2 minutos: evita que varias pestañas abiertas disparen
    -- refrescos encimados sobre la tabla entera.
    IF NOT p_forzar AND v_ultimo IS NOT NULL AND v_ultimo > now() - interval '2 minutes' THEN
        RETURN v_ultimo;
    END IF;

    -- Un solo refresco a la vez, aunque entren dos peticiones simultáneas.
    IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_estadistica')) THEN
        RETURN v_ultimo;
    END IF;

    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_estadistica_operaciones;
    EXCEPTION WHEN OTHERS THEN
        -- CONCURRENTLY puede ser rechazado dentro de una función (el cuerpo
        -- siempre corre en transacción) o si la vista nunca se ha poblado.
        -- Misma salvaguarda que en 028.
        REFRESH MATERIALIZED VIEW public.mv_estadistica_operaciones;
    END;

    UPDATE public.estadistica_refresco
       SET refrescado_at = now(),
           refrescado_por = auth.uid(),
           duracion_ms = (extract(epoch FROM (clock_timestamp() - v_inicio)) * 1000)::int
     WHERE id = 1
     RETURNING refrescado_at INTO v_ultimo;

    RETURN v_ultimo;
END;
$$;

REVOKE ALL ON FUNCTION public.refrescar_estadistica(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refrescar_estadistica(boolean) TO authenticated;

COMMENT ON FUNCTION public.refrescar_estadistica(boolean) IS
    'Recalcula mv_estadistica_operaciones. Requiere nivel edit o admin. Freno '
    'de 2 minutos salvo p_forzar, y lock para no encimar refrescos.';

-- Refresco automático cada 15 minutos, si pg_cron está disponible. El bloque va
-- con EXCEPTION para que la ausencia de la extensión no aborte la migración.
DO $cron$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('refrescar_estadistica')
          WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refrescar_estadistica');
        PERFORM cron.schedule(
            'refrescar_estadistica',
            '*/15 * * * *',
            $cmd$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_estadistica_operaciones$cmd$
        );
        RAISE NOTICE 'pg_cron: refresco programado cada 15 minutos.';
    ELSE
        RAISE NOTICE 'pg_cron no está instalado: el refresco queda manual (botón Actualizar).';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo programar el refresco con pg_cron: %', SQLERRM;
END;
$cron$;


-- =============================================================================
-- 4) Helper de filtros
--
--    Los VALORES nunca se interpolan en SQL dinámico: viajan siempre dentro del
--    parámetro jsonb y se comparan con esta función. Lo único dinámico del
--    motor son los nombres de las dimensiones, y ésos salen de una lista blanca.
-- =============================================================================
CREATE OR REPLACE FUNCTION public._estadistica_filtro_ok(p_valor text, p_lista jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_lista IS NULL OR jsonb_typeof(p_lista) = 'null' THEN true
        WHEN jsonb_typeof(p_lista) = 'string' THEN p_valor IS NOT DISTINCT FROM (p_lista #>> '{}')
        WHEN jsonb_typeof(p_lista) = 'array' THEN
            jsonb_array_length(p_lista) = 0
            OR p_valor = ANY (ARRAY(SELECT jsonb_array_elements_text(p_lista)))
        ELSE true
    END
$$;

COMMENT ON FUNCTION public._estadistica_filtro_ok(text, jsonb) IS
    'true si el valor pasa el filtro. Filtro ausente, nulo o lista vacía = no '
    'restringe. Un valor NULL nunca pasa un filtro con contenido.';


-- =============================================================================
-- 5) estadistica_agregado — el motor
--
--    UNA función para todo el módulo. Agrupa por hasta cuatro dimensiones de
--    una lista blanca y devuelve todas las métricas ya calculadas.
--
--    REGLA TRANSVERSAL: las operaciones CANCELADAS no cuentan en ninguna
--    métrica operacional. No se filtran de la consulta —se siguen contando
--    aparte en operaciones_canceladas, que es información útil— pero cada
--    agregado lleva su FILTER (WHERE NOT es_cancelada).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_agregado(
    p_desde       date,
    p_hasta       date,
    p_dimensiones text[] DEFAULT '{}'::text[],
    p_filtros     jsonb  DEFAULT '{}'::jsonb,
    p_limite      integer DEFAULT 5000
)
RETURNS TABLE (
    d1 text, d2 text, d3 text, d4 text,

    operaciones               bigint,
    operaciones_llegada       bigint,
    operaciones_salida        bigint,
    operaciones_canceladas    bigint,
    operaciones_nacional      bigint,
    operaciones_internacional bigint,

    pax_total          numeric,
    pax_llegada        numeric,
    pax_salida         numeric,
    pax_nacional       numeric,
    pax_internacional  numeric,
    operaciones_con_pax bigint,

    carga_total_kg          numeric,
    carga_nacional_kg       numeric,
    carga_internacional_kg  numeric,
    carga_descargada_kg     numeric,
    carga_embarcada_kg      numeric,
    carga_transito_kg       numeric,
    correo_kg               numeric,
    operaciones_con_carga   bigint,
    operaciones_con_desglose_carga bigint,

    ocupacion_pax        numeric,
    ocupacion_capacidad  numeric,
    factor_ocupacion     numeric,
    operaciones_con_ocupacion bigint,

    operaciones_puntuales  bigint,
    operaciones_demoradas  bigint,
    minutos_demora_total   numeric,
    demora_promedio        numeric,
    demora_maxima          numeric,
    demora_minima          numeric,
    operaciones_evaluables_puntualidad bigint,

    operaciones_clasificadas   bigint,
    operaciones_sin_clasificar bigint,
    operaciones_capturadas     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    -- Lista blanca de dimensiones. La clave es lo que manda el cliente; el
    -- valor es la expresión SQL. Nada fuera de este mapa llega al SQL.
    v_mapa   jsonb := jsonb_build_object(
        'anio',                   'm.anio::text',
        'mes',                    'lpad(m.mes::text, 2, ''0'')',
        'anio_mes',               'm.anio::text || ''-'' || lpad(m.mes::text, 2, ''0'')',
        'fecha',                  'm.fecha_operacion::text',
        'semana',                 'm.semana_iso',
        'dia_semana',             'm.dia_semana::text',
        'hora',                   'lpad(m.hora_local::text, 2, ''0'')',
        'direccion',              'm.direccion',
        'tipo_movimiento',        'm.tipo_movimiento',
        'aerolinea',              'm.aerolinea',
        'matricula',              'm.matricula',
        'tipo_aeronave',          'm.tipo_aeronave',
        'tipo_servicio',          'm.tipo_servicio',
        'segmento_aviacion',      'coalesce(m.segmento_aviacion, ''SIN CLASIFICAR'')',
        'naturaleza_operacion',   'coalesce(m.naturaleza_operacion, ''SIN CLASIFICAR'')',
        'nacional_internacional', 'coalesce(m.nacional_internacional, ''Sin determinar'')',
        'origen',                 'm.origen_codigo',
        'destino',                'm.destino_codigo',
        'endpoint',               'm.endpoint_codigo',
        'ciudad',                 'm.endpoint_ciudad',
        'ruta',                   'm.ruta',
        'codigo_demora',          'm.codigo_demora',
        'causa_demora',           'm.causa_demora'
    );
    v_dims   text[] := '{}';
    v_dim    text;
    v_select text;
    v_group  text;
    v_sql    text;
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    IF p_desde IS NULL OR p_hasta IS NULL THEN
        RAISE EXCEPTION 'estadistica_agregado requiere p_desde y p_hasta.' USING ERRCODE = '22004';
    END IF;
    IF p_hasta < p_desde THEN
        RAISE EXCEPTION 'El rango de fechas está invertido (% > %).', p_desde, p_hasta
            USING ERRCODE = '22007';
    END IF;

    FOREACH v_dim IN ARRAY coalesce(p_dimensiones, '{}'::text[]) LOOP
        IF NOT (v_mapa ? v_dim) THEN
            RAISE EXCEPTION 'Dimensión no reconocida: %. Válidas: %',
                v_dim, (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_mapa) k)
                USING ERRCODE = '22023';
        END IF;
        v_dims := v_dims || (v_mapa ->> v_dim);
        EXIT WHEN array_length(v_dims, 1) >= 4;
    END LOOP;

    -- d1..d4 siempre existen; las que no se pidieron van en NULL.
    v_select := concat_ws(', ',
        coalesce(v_dims[1], 'NULL::text') || ' AS d1',
        coalesce(v_dims[2], 'NULL::text') || ' AS d2',
        coalesce(v_dims[3], 'NULL::text') || ' AS d3',
        coalesce(v_dims[4], 'NULL::text') || ' AS d4'
    );
    v_group := CASE
        WHEN array_length(v_dims, 1) IS NULL THEN ''
        ELSE 'GROUP BY ' || (
            SELECT string_agg(i::text, ', ') FROM generate_series(1, array_length(v_dims, 1)) i
        )
    END;

    v_sql := format($q$
        SELECT %s,

            count(*) FILTER (WHERE NOT m.es_cancelada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D')::bigint,
            count(*) FILTER (WHERE m.es_cancelada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Nacional')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Internacional')::bigint,

            sum(m.pax) FILTER (WHERE NOT m.es_cancelada)::numeric,
            sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A')::numeric,
            sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D')::numeric,
            sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Nacional')::numeric,
            sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Internacional')::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.pax IS NOT NULL)::bigint,

            sum(m.carga_total_kg)         FILTER (WHERE NOT m.es_cancelada)::numeric,
            sum(m.carga_nacional_kg)      FILTER (WHERE NOT m.es_cancelada)::numeric,
            sum(m.carga_internacional_kg) FILTER (WHERE NOT m.es_cancelada)::numeric,
            sum(m.carga_descargada_kg)    FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A')::numeric,
            sum(m.carga_embarcada_kg)     FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D')::numeric,
            sum(m.transito_contable_kg)   FILTER (WHERE NOT m.es_cancelada)::numeric,
            sum(m.correo_kg)              FILTER (WHERE NOT m.es_cancelada)::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.carga_total_kg IS NOT NULL AND m.carga_total_kg > 0)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.carga_desglose_capturado)::bigint,

            sum(m.pax)                 FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable)::numeric,
            sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable)::numeric,
            CASE
                WHEN coalesce(sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable), 0) > 0
                -- El FILTER va pegado al agregado; el cast, DESPUÉS y entre
                -- paréntesis. Escribirlo como sum(x)::numeric FILTER (...) es
                -- error de sintaxis: FILTER sólo puede seguir a la llamada del
                -- agregado, no a una expresión ya casteada.
                THEN round(
                    100.0 * (sum(m.pax)                 FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric
                          / (sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric
                , 2)
            END::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.es_puntual IS TRUE)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.es_puntual IS FALSE)::bigint,
            sum(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada AND m.minutos_demora > 0)::numeric,
            round(avg(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada), 2)::numeric,
            max(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada)::numeric,
            min(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada)::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.es_puntual IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND NOT m.clasificada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.capturado)::bigint

        FROM public.mv_estadistica_operaciones m
        WHERE m.fecha_operacion >= $1
          AND m.fecha_operacion <= $2
          AND public._estadistica_filtro_ok(m.aerolinea,              $3 -> 'aerolinea')
          AND public._estadistica_filtro_ok(m.matricula,              $3 -> 'matricula')
          AND public._estadistica_filtro_ok(m.tipo_aeronave,          $3 -> 'tipo_aeronave')
          AND public._estadistica_filtro_ok(m.tipo_servicio,          $3 -> 'tipo_servicio')
          AND public._estadistica_filtro_ok(m.direccion,              $3 -> 'direccion')
          AND public._estadistica_filtro_ok(m.nacional_internacional, $3 -> 'nacional_internacional')
          AND public._estadistica_filtro_ok(m.segmento_aviacion,      $3 -> 'segmento_aviacion')
          AND public._estadistica_filtro_ok(m.naturaleza_operacion,   $3 -> 'naturaleza_operacion')
          AND public._estadistica_filtro_ok(m.origen_codigo,          $3 -> 'origen')
          AND public._estadistica_filtro_ok(m.destino_codigo,         $3 -> 'destino')
          AND public._estadistica_filtro_ok(m.endpoint_codigo,        $3 -> 'endpoint')
        %s
        ORDER BY 1, 2, 3, 4
        LIMIT $4
    $q$, v_select, v_group);

    RETURN QUERY EXECUTE v_sql USING p_desde, p_hasta, coalesce(p_filtros, '{}'::jsonb), greatest(coalesce(p_limite, 5000), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) IS
    'Motor único de agregación del módulo estadístico. Agrupa por hasta 4 '
    'dimensiones de lista blanca y devuelve operaciones, pasajeros, carga, '
    'factor de ocupación, puntualidad y cobertura de datos. Las canceladas se '
    'reportan aparte y no entran en ninguna otra métrica.';


-- =============================================================================
-- 6) estadistica_sin_clasificar — qué regla falta
--
--    No lista operación por operación (serían miles): agrupa por la
--    COMBINACIÓN de criterios que una regla necesitaría para resolverlas, con
--    su conteo. Cada renglón se traduce directo en una regla nueva.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_sin_clasificar(
    p_desde  date,
    p_hasta  date,
    p_limite integer DEFAULT 200
)
RETURNS TABLE (
    aerolinea       text,
    aerolinea_id    bigint,
    tipo_aeronave   text,
    tipo_servicio   text,
    tipo_servicio_descripcion text,
    operaciones     bigint,
    pax_total       numeric,
    carga_total_kg  numeric,
    primera_fecha   date,
    ultima_fecha    date,
    ejemplo_vuelo   text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        m.aerolinea,
        m.aerolinea_conciliacion_id,
        m.tipo_aeronave,
        m.tipo_servicio,
        max(m.tipo_servicio_descripcion),
        count(*)::bigint,
        sum(m.pax)::numeric,
        sum(m.carga_total_kg)::numeric,
        min(m.fecha_operacion),
        max(m.fecha_operacion),
        (array_agg(m.numero_vuelo ORDER BY m.fecha_operacion DESC) FILTER (WHERE m.numero_vuelo IS NOT NULL))[1]
    FROM public.mv_estadistica_operaciones m
    WHERE m.fecha_operacion >= p_desde
      AND m.fecha_operacion <= p_hasta
      AND NOT m.clasificada
      AND NOT m.es_cancelada
    GROUP BY m.aerolinea, m.aerolinea_conciliacion_id, m.tipo_aeronave, m.tipo_servicio
    ORDER BY count(*) DESC
    LIMIT greatest(coalesce(p_limite, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) TO authenticated;

COMMENT ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) IS
    'Operaciones que ninguna regla resolvió, agrupadas por la combinación de '
    'criterios que haría falta para clasificarlas. Cada renglón es una regla '
    'que falta crear.';


-- =============================================================================
-- 7) estadistica_detalle — filas para exportar
--
--    Lo usa el Centro de Descargas cuando el usuario pide el detalle filtrado.
--    Devuelve el RESULTADO COMPLETO de los filtros, no la página visible en
--    pantalla. El tope duro protege al navegador y a la base.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_detalle(
    p_desde   date,
    p_hasta   date,
    p_filtros jsonb   DEFAULT '{}'::jsonb,
    p_limite  integer DEFAULT 50000,
    p_offset  integer DEFAULT 0
)
RETURNS SETOF public.mv_estadistica_operaciones
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT m.*
    FROM public.mv_estadistica_operaciones m
    WHERE m.fecha_operacion >= p_desde
      AND m.fecha_operacion <= p_hasta
      AND public._estadistica_filtro_ok(m.aerolinea,              p_filtros -> 'aerolinea')
      AND public._estadistica_filtro_ok(m.matricula,              p_filtros -> 'matricula')
      AND public._estadistica_filtro_ok(m.tipo_aeronave,          p_filtros -> 'tipo_aeronave')
      AND public._estadistica_filtro_ok(m.tipo_servicio,          p_filtros -> 'tipo_servicio')
      AND public._estadistica_filtro_ok(m.direccion,              p_filtros -> 'direccion')
      AND public._estadistica_filtro_ok(m.nacional_internacional, p_filtros -> 'nacional_internacional')
      AND public._estadistica_filtro_ok(m.segmento_aviacion,      p_filtros -> 'segmento_aviacion')
      AND public._estadistica_filtro_ok(m.naturaleza_operacion,   p_filtros -> 'naturaleza_operacion')
      AND public._estadistica_filtro_ok(m.origen_codigo,          p_filtros -> 'origen')
      AND public._estadistica_filtro_ok(m.destino_codigo,         p_filtros -> 'destino')
      AND public._estadistica_filtro_ok(m.endpoint_codigo,        p_filtros -> 'endpoint')
    ORDER BY m.fecha_operacion, m.id
    LIMIT greatest(coalesce(p_limite, 50000), 1)
    OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_detalle(date, date, jsonb, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_detalle(date, date, jsonb, integer, integer) TO authenticated;


-- =============================================================================
-- 8) estadistica_opciones_filtro — alimenta los desplegables sin traer detalle
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_opciones_filtro(
    p_desde date,
    p_hasta date
)
RETURNS TABLE (campo text, valor text, etiqueta text, operaciones bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH v AS (
        SELECT * FROM public.mv_estadistica_operaciones
         WHERE fecha_operacion >= p_desde AND fecha_operacion <= p_hasta
           AND NOT es_cancelada
    )
    SELECT 'aerolinea'::text, aerolinea::text, aerolinea::text, count(*)::bigint FROM v WHERE aerolinea IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_aeronave'::text, tipo_aeronave::text, tipo_aeronave::text, count(*)::bigint FROM v WHERE tipo_aeronave IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'matricula'::text, matricula::text, matricula::text, count(*)::bigint FROM v WHERE matricula IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_servicio'::text, tipo_servicio::text,
           (tipo_servicio || coalesce(' — ' || max(tipo_servicio_descripcion), ''))::text,
           count(*)::bigint
      FROM v WHERE tipo_servicio IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'endpoint'::text, endpoint_codigo::text,
           (endpoint_codigo || coalesce(' — ' || max(endpoint_ciudad), ''))::text, count(*)::bigint
      FROM v WHERE endpoint_codigo IS NOT NULL GROUP BY 2
    ORDER BY 1, 4 DESC, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_opciones_filtro(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_opciones_filtro(date, date) TO authenticated;


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- 1) Cuántas filas quedaron y cuántas se pudieron clasificar. Sin reglas
--    cargadas, clasificadas = 0 y sin_clasificar = todas: es lo esperado.
SELECT count(*)                                        AS movimientos,
       count(*) FILTER (WHERE es_cancelada)            AS canceladas,
       count(*) FILTER (WHERE clasificada)             AS clasificadas,
       count(*) FILTER (WHERE NOT clasificada)         AS sin_clasificar,
       count(*) FILTER (WHERE pax IS NOT NULL)         AS con_pax,
       count(*) FILTER (WHERE capacidad_pasajeros IS NOT NULL) AS con_capacidad,
       count(*) FILTER (WHERE ocupacion_evaluable)     AS evaluables_ocupacion,
       count(*) FILTER (WHERE nacional_internacional IS NULL) AS sin_nac_int,
       min(fecha_operacion)                            AS desde,
       max(fecha_operacion)                            AS hasta
  FROM public.mv_estadistica_operaciones;

-- 2) El tránsito no se duplica: la suma de transito_contable_kg nunca puede
--    superar la suma de carga_transito_kg, y con rotaciones de dos lados debe
--    ser estrictamente menor.
SELECT coalesce(sum(carga_transito_kg), 0)    AS transito_capturado_bruto,
       coalesce(sum(transito_contable_kg), 0) AS transito_contable,
       count(*) FILTER (WHERE transito_contable_kg = 0 AND carga_transito_kg > 0) AS filas_espejo_neutralizadas
  FROM public.mv_estadistica_operaciones;

-- 3) Llegadas + salidas = operaciones (la validación aritmética básica).
--
--    OJO: estas consultas NO llaman a estadistica_agregado / estadistica_detalle
--    / estadistica_sin_clasificar. Esas funciones exigen
--    estadistica_access_level(auth.uid()) <> 'none', y en el editor SQL de
--    Supabase auth.uid() es NULL: la llamada abortaría la transacción entera con
--    un 42501 confuso. Aquí se reproduce la misma cuenta directamente sobre la
--    vista materializada, que es de donde esas funciones leen. Para probar los
--    RPC con un usuario de verdad, usar la pestaña Estadística de la aplicación.
SELECT
    count(*) FILTER (WHERE NOT es_cancelada)                        AS operaciones,
    count(*) FILTER (WHERE NOT es_cancelada AND direccion = 'A')    AS llegadas,
    count(*) FILTER (WHERE NOT es_cancelada AND direccion = 'D')    AS salidas,
    count(*) FILTER (WHERE NOT es_cancelada AND direccion = 'A')
  + count(*) FILTER (WHERE NOT es_cancelada AND direccion = 'D')
  = count(*) FILTER (WHERE NOT es_cancelada)                        AS cuadra
  FROM public.mv_estadistica_operaciones
 WHERE fecha_operacion >= current_date - 365;

-- 4) El corte por año, con las mismas definiciones que usa el motor.
SELECT
    anio,
    count(*) FILTER (WHERE NOT es_cancelada)                                   AS operaciones,
    count(*) FILTER (WHERE es_cancelada)                                       AS canceladas,
    sum(pax) FILTER (WHERE NOT es_cancelada)                                   AS pax_total,
    CASE WHEN coalesce(sum(capacidad_pasajeros) FILTER (WHERE NOT es_cancelada AND ocupacion_evaluable), 0) > 0
         THEN round(100.0 * (sum(pax)                 FILTER (WHERE NOT es_cancelada AND ocupacion_evaluable))::numeric
                          / (sum(capacidad_pasajeros) FILTER (WHERE NOT es_cancelada AND ocupacion_evaluable))::numeric, 2)
    END                                                                        AS factor_ocupacion,
    count(*) FILTER (WHERE NOT es_cancelada AND NOT clasificada)               AS sin_clasificar
  FROM public.mv_estadistica_operaciones
 GROUP BY anio
 ORDER BY anio;

-- 5) Qué reglas faltan. Sin la migración 039 aparece todo aquí, y está bien:
--    significa que nada se está clasificando por suposición.
SELECT aerolinea, tipo_aeronave, tipo_servicio,
       count(*)          AS operaciones,
       min(fecha_operacion) AS desde,
       max(fecha_operacion) AS hasta
  FROM public.mv_estadistica_operaciones
 WHERE NOT clasificada
   AND NOT es_cancelada
   AND fecha_operacion >= current_date - 90
 GROUP BY 1, 2, 3
 ORDER BY count(*) DESC
 LIMIT 15;

-- 6) Los objetos de 027/028 siguen intactos: el Informe Estadístico no se tocó.
SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen',
                     'v_informe_estadistico_aerolinea', 'mv_informe_estadistico_base',
                     'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea')
 ORDER BY 1;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT cuando la verificación se vea bien.
--
-- Para refrescar A MANO desde el editor SQL, NO usar refrescar_estadistica():
-- esa función exige un usuario con nivel edit/admin y en el editor auth.uid()
-- es NULL. Basta con la sentencia directa:
--
--     REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_estadistica_operaciones;
--     UPDATE public.estadistica_refresco SET refrescado_at = now() WHERE id = 1;
--
-- Desde la aplicación sí se usa el RPC: ahí el usuario está autenticado y el
-- botón "Actualizar" de la barra de filtros lo llama.
-- -----------------------------------------------------------------------------
ROLLBACK;
