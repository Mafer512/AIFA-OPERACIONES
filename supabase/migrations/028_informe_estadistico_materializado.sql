-- =============================================================================
-- Informe Estadístico — materialización de las vistas (arreglo de lentitud)
--
-- PROBLEMA
-- 027 dejó tres VISTAS normales encadenadas:
--
--     maestra_operaciones
--        └─ v_informe_manifiestos_normalizado   (normaliza: 2 LATERAL por fila,
--           │                                     join a matrículas y a
--           │                                     catálogo de aeropuertos)
--           ├─ v_informe_estadistico_resumen    (GROUP BY sobre lo anterior)
--           └─ v_informe_estadistico_aerolinea  (GROUP BY sobre lo anterior)
--
-- Una vista normal no guarda nada: se vuelve a calcular ENTERA en cada
-- consulta. Como la pestaña pide las tres, cada vez que alguien la abre el
-- servidor normaliza toda maestra_operaciones tres veces.
--
-- Y hay un multiplicador que lo empeora: PostgREST devuelve como máximo 1,000
-- renglones por respuesta, así que el cliente pagina. v_informe_estadistico_
-- aerolinea agrupa por (año, mes, aerolínea, tipo, dirección) y da varios
-- miles de renglones => ~7 páginas => la normalización completa se ejecuta 7
-- veces seguidas para armar una sola tabla. Eso es el grueso de la espera.
--
-- SOLUCIÓN
-- Se calcula UNA vez y se guarda, en tres vistas MATERIALIZADAS:
--
--     mv_informe_estadistico_base       (normalización, ~1 fila por operación)
--       ├─ mv_informe_estadistico_resumen     (agregado mensual)
--       └─ mv_informe_estadistico_aerolinea   (agregado por aerolínea)
--
-- Las tres vistas que ya consumía la app se redefinen para leer de ahí, así
-- que NO cambian de nombre, de columnas ni de permisos: el resto del código
-- sigue funcionando igual, sólo que ahora lee de datos guardados en vez de
-- recalcularlos. Consultar la ventana de 15 días pasa de recorrer toda la
-- tabla a un índice sobre fecha_operacion.
--
-- FRESCURA
-- Una vista materializada no se actualiza sola. Aquí se refresca:
--   · cada 10 minutos con pg_cron (si la extensión está disponible), y
--   · a mano desde la app: el botón "Actualizar" llama a
--     refrescar_informe_estadistico(), con freno de 2 minutos para que nadie
--     pueda martillar el servidor a fuerza de clicks.
-- informe_estadistico_refresco.refrescado_at guarda cuándo fue la última, y
-- la pestaña la muestra para que se vea a qué hora están los datos.
--
-- El informe es preliminar por definición (las aerolíneas tienen 30 horas para
-- entregar su manifiesto), así que un rezago de minutos no cambia nada de lo
-- que se reporta.
--
-- 100% ADITIVO sobre maestra_operaciones y sus catálogos: no toca ninguna
-- tabla, columna, trigger ni política existente. maestra_operaciones tiene RLS
-- con USING (true) para authenticated (024), o sea que no filtra renglones por
-- usuario: materializarla no expone nada que la vista de 027 no expusiera ya.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) mv_informe_estadistico_base — la normalización de 027, ya calculada.
--    El cuerpo es EXACTAMENTE el de v_informe_manifiestos_normalizado; si algún
--    día cambia esa lógica, hay que cambiarla aquí (es la única copia: la vista
--    de abajo ya sólo lee de esta).
-- -----------------------------------------------------------------------------
-- Se limpia en orden de dependencia, y las VISTAS antes que las MATERIALIZADAS:
-- si esto se vuelve a correr, las vistas ya cuelgan de las materializadas y
-- soltarlas primero es la única forma de poder recrearlas. Todo va dentro de la
-- misma transacción, así que si algo falla a media migración las vistas viejas
-- siguen en pie.
DROP VIEW IF EXISTS public.v_informe_estadistico_aerolinea;
DROP VIEW IF EXISTS public.v_informe_estadistico_resumen;
DROP VIEW IF EXISTS public.v_informe_manifiestos_normalizado;

DROP MATERIALIZED VIEW IF EXISTS public.mv_informe_estadistico_aerolinea;
DROP MATERIALIZED VIEW IF EXISTS public.mv_informe_estadistico_resumen;
DROP MATERIALIZED VIEW IF EXISTS public.mv_informe_estadistico_base;

CREATE MATERIALIZED VIEW public.mv_informe_estadistico_base AS
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

COMMENT ON MATERIALIZED VIEW public.mv_informe_estadistico_base IS
    'Normalización del Informe Estadístico YA CALCULADA (antes se recalculaba '
    'en cada consulta desde v_informe_manifiestos_normalizado). Se refresca con '
    'refrescar_informe_estadistico(); ver informe_estadistico_refresco para '
    'saber de cuándo son los datos.';

-- manifiesto_id es el id de maestra_operaciones (llave primaria) y los joins de
-- arriba no lo duplican: los dos LATERAL traen a lo más un renglón (LIMIT 1 /
-- subconsulta escalar) y los dos LEFT JOIN son contra llaves primarias
-- (matriculas_manifiestos.id, catalogo_aeropuertos.iata). El índice ÚNICO no es
-- sólo higiene: REFRESH ... CONCURRENTLY lo exige.
CREATE UNIQUE INDEX ux_mv_informe_base_manifiesto
    ON public.mv_informe_estadistico_base (manifiesto_id);

-- El factor de ocupación y las cifras del día piden una ventana de 15 días.
-- Con este índice esa consulta deja de recorrer la tabla entera.
CREATE INDEX idx_mv_informe_base_fecha
    ON public.mv_informe_estadistico_base (fecha_operacion);

-- -----------------------------------------------------------------------------
-- 2) Los dos agregados, también materializados. Son chicos (miles de renglones
--    contra cientos de miles), así que su refresco es casi instantáneo una vez
--    que la base ya está calculada.
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.mv_informe_estadistico_resumen AS
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
    count(*) FILTER (WHERE capturado)::bigint AS operaciones_conciliadas,
    count(*) FILTER (WHERE NOT capturado)::bigint AS operaciones_respaldo_itinerario
FROM public.mv_informe_estadistico_base
WHERE fecha_operacion IS NOT NULL AND direccion IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;

CREATE INDEX idx_mv_informe_resumen_anio
    ON public.mv_informe_estadistico_resumen (anio, mes);

CREATE MATERIALIZED VIEW public.mv_informe_estadistico_aerolinea AS
SELECT
    extract(year FROM fecha_operacion)::int AS anio,
    extract(month FROM fecha_operacion)::int AS mes,
    coalesce(aerolinea, 'SIN AEROLÍNEA') AS aerolinea,
    CASE WHEN es_carga THEN 'carga' ELSE 'comercial' END AS tipo_aviacion,
    direccion,
    count(*)::bigint AS operaciones,
    coalesce(sum(pax_total), 0) AS pax_total,
    coalesce(sum(carga_kg), 0) AS carga_kg_total
FROM public.mv_informe_estadistico_base
WHERE fecha_operacion IS NOT NULL AND direccion IS NOT NULL
GROUP BY 1, 2, 3, 4, 5;

-- La app pide esta tabla filtrada por año (antes traía todos los años y
-- paginaba siete veces).
CREATE INDEX idx_mv_informe_aerolinea_anio
    ON public.mv_informe_estadistico_aerolinea (anio);

-- -----------------------------------------------------------------------------
-- 3) Las tres vistas de 027 se redefinen sobre lo materializado. Mismos
--    nombres, mismas columnas, mismos permisos: la app no se entera.
--    Se recrean (ya se soltaron al principio) en vez de usar CREATE OR REPLACE,
--    porque ese falla con 42P16 ante cualquier diferencia de tipo y aquí no
--    aporta nada.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_informe_manifiestos_normalizado AS
    SELECT * FROM public.mv_informe_estadistico_base;

COMMENT ON VIEW public.v_informe_manifiestos_normalizado IS
    'Base normalizada del Informe Estadístico. capturado=true: manifiesto ya '
    'conciliado (hora_recepcion no nulo). capturado=false: RESPALDO TEMPORAL '
    'desde datos_origen->itinerario_vuelos_editable (AODB) mientras avanza la '
    'auditoría de "Conciliación Manifiestos". Desde 028 lee de '
    'mv_informe_estadistico_base (datos guardados, no recalculados): puede ir '
    'hasta ~10 minutos atrás de maestra_operaciones.';

CREATE VIEW public.v_informe_estadistico_resumen AS
    SELECT * FROM public.mv_informe_estadistico_resumen;

COMMENT ON VIEW public.v_informe_estadistico_resumen IS
    'Agregado mensual (año/mes/tipo de aviación/dirección/nac-int) para el '
    'Informe Estadístico. Solo Comercial y Carga — Aviación General viene de '
    'monthly_operations/annual_operations, no de manifiestos.';

CREATE VIEW public.v_informe_estadistico_aerolinea AS
    SELECT * FROM public.mv_informe_estadistico_aerolinea;

COMMENT ON VIEW public.v_informe_estadistico_aerolinea IS
    'Agregado mensual por aerolínea (año/mes/aerolínea/tipo/dirección) para '
    'la tabla de participación por aerolínea del Informe Estadístico.';

GRANT SELECT ON public.v_informe_manifiestos_normalizado TO authenticated;
GRANT SELECT ON public.v_informe_estadistico_resumen TO authenticated;
GRANT SELECT ON public.v_informe_estadistico_aerolinea TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) Control de frescura: una sola fila con la hora del último refresco.
--    La pestaña la lee para mostrar "Datos al ..." y para no pedir refrescos
--    innecesarios.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.informe_estadistico_refresco (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),  -- fuerza una única fila
    refrescado_at timestamptz NOT NULL DEFAULT now(),
    duracion_ms integer
);

-- Por si la tabla quedó de una corrida anterior: CREATE TABLE IF NOT EXISTS no
-- agrega columnas nuevas a una tabla que ya existía.
ALTER TABLE public.informe_estadistico_refresco
    ADD COLUMN IF NOT EXISTS duracion_ms integer;

INSERT INTO public.informe_estadistico_refresco (id, refrescado_at)
VALUES (true, now())
ON CONFLICT (id) DO UPDATE SET refrescado_at = now();

ALTER TABLE public.informe_estadistico_refresco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS informe_estadistico_refresco_select ON public.informe_estadistico_refresco;
CREATE POLICY informe_estadistico_refresco_select
    ON public.informe_estadistico_refresco
    FOR SELECT TO authenticated
    USING (true);

GRANT SELECT ON TABLE public.informe_estadistico_refresco TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) refrescar_informe_estadistico() — recalcula las tres vistas materializadas.
--
--    SECURITY DEFINER porque REFRESH exige ser dueño del objeto y quien aprieta
--    "Actualizar" es un usuario normal. Para que eso no se convierta en un
--    botón de "tirar la base", lleva dos frenos:
--      · p_forzar = false (lo que manda la app) no hace nada si el último
--        refresco tiene menos de 2 minutos;
--      · un advisory lock evita que dos refrescos corran encimados.
--    Devuelve la hora de los datos vigentes, refresque o no.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refrescar_informe_estadistico(p_forzar boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ultimo timestamptz;
    v_inicio timestamptz := clock_timestamp();
BEGIN
    SELECT refrescado_at INTO v_ultimo
    FROM public.informe_estadistico_refresco WHERE id;

    IF NOT p_forzar AND v_ultimo IS NOT NULL AND v_ultimo > now() - interval '2 minutes' THEN
        RETURN v_ultimo;  -- suficientemente fresco, no vale la pena recalcular
    END IF;

    -- Si ya hay otro refresco en curso, este se sale en vez de formarse: el que
    -- va corriendo va a dejar los datos igual de frescos.
    IF NOT pg_try_advisory_xact_lock(hashtext('informe_estadistico_refresco')::bigint) THEN
        RETURN v_ultimo;
    END IF;

    -- CONCURRENTLY deja seguir leyendo mientras se recalcula, pero PostgreSQL
    -- puede rechazarlo dentro de una transacción, y el cuerpo de una función
    -- siempre lo está (más aún dentro de un bloque con EXCEPTION, que abre una
    -- subtransacción). Si lo rechaza se cae al refresco normal: bloquea las
    -- lecturas los segundos que tarde, pero nunca deja de funcionar. Por eso el
    -- refresco automático va cada 10 minutos y no cada minuto.
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_informe_estadistico_base;
    EXCEPTION WHEN active_sql_transaction OR feature_not_supported THEN
        REFRESH MATERIALIZED VIEW public.mv_informe_estadistico_base;
    END;

    -- Los agregados son chicos: refresco normal, milisegundos.
    REFRESH MATERIALIZED VIEW public.mv_informe_estadistico_resumen;
    REFRESH MATERIALIZED VIEW public.mv_informe_estadistico_aerolinea;

    INSERT INTO public.informe_estadistico_refresco (id, refrescado_at, duracion_ms)
    VALUES (true, now(), (extract(epoch FROM clock_timestamp() - v_inicio) * 1000)::int)
    ON CONFLICT (id) DO UPDATE
        SET refrescado_at = excluded.refrescado_at,
            duracion_ms = excluded.duracion_ms;

    RETURN now();
END;
$$;

COMMENT ON FUNCTION public.refrescar_informe_estadistico(boolean) IS
    'Recalcula las vistas materializadas del Informe Estadístico. p_forzar=false '
    '(lo que usa la app) no hace nada si el último refresco tiene menos de 2 '
    'minutos. Devuelve la hora de los datos vigentes.';

REVOKE ALL ON FUNCTION public.refrescar_informe_estadistico(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.refrescar_informe_estadistico(boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) Refresco automático cada 10 minutos con pg_cron.
--    Va dentro de un bloque con manejo de excepciones a propósito: si la
--    extensión no está habilitada en este proyecto, la migración NO debe
--    fallar — el módulo sigue sirviendo con el botón "Actualizar", nada más
--    que los datos avanzan cuando alguien lo aprieta.
-- -----------------------------------------------------------------------------
-- Cada paso en su propio bloque: una excepción sólo revierte el bloque donde
-- ocurre. Juntos, un fallo al desprogramar el job viejo también revertiría el
-- CREATE EXTENSION y el schedule de abajo se quedaría sin extensión.
DO $cron$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN others THEN
    RAISE WARNING 'Informe Estadístico: pg_cron no disponible (%).', SQLERRM;
END;
$cron$;

DO $cron$
BEGIN
    PERFORM cron.unschedule('refrescar_informe_estadistico');
EXCEPTION WHEN others THEN
    NULL;  -- no había job previo, o no hay pg_cron: nada que desprogramar
END;
$cron$;

DO $cron$
BEGIN
    PERFORM cron.schedule(
        'refrescar_informe_estadistico',
        '*/10 * * * *',
        $sql$SELECT public.refrescar_informe_estadistico(true)$sql$
    );
    RAISE NOTICE 'Informe Estadístico: refresco automático programado cada 10 minutos.';
EXCEPTION WHEN others THEN
    RAISE WARNING 'Informe Estadístico: no se pudo programar el refresco con pg_cron (%). Los datos se actualizarán con el botón "Actualizar" de la pestaña.', SQLERRM;
END;
$cron$;

COMMIT;

-- =============================================================================
-- Verificación rápida después de correr esto:
--
--   SELECT count(*) FROM public.mv_informe_estadistico_base;
--   SELECT * FROM public.informe_estadistico_refresco;
--   EXPLAIN ANALYZE SELECT * FROM public.v_informe_estadistico_resumen;
--     -> debe ser un Seq Scan de unos miles de renglones, en milisegundos,
--        sin rastro de maestra_operaciones ni de los LATERAL.
--   SELECT public.refrescar_informe_estadistico(true);
--     -> devuelve la hora; el tiempo que tarde es lo que ANTES costaba cada
--        carga de la pestaña (y ahora sólo se paga cada 10 minutos, en segundo
--        plano).
--
-- Si más adelante se quiere que el informe sea EN VIVO (sin rezago), el
-- siguiente paso natural es sustituir estas vistas materializadas por tablas
-- resumen mantenidas por trigger sobre maestra_operaciones. Se dejó fuera a
-- propósito: esa tabla ya carga 4 triggers de sincronización y está en
-- auditoría, así que agregarle más escritura ahora es riesgo innecesario para
-- un informe que de todos modos es preliminar.
-- =============================================================================
