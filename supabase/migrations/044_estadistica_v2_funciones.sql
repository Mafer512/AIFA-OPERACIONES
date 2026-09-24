-- =============================================================================
-- 044 — Motor estadístico v2 · funciones de consulta y diagnóstico
--
-- Parte de la reescritura del motor estadístico (v2) contra el esquema real
-- de maestra_operaciones. El trabajo va REPARTIDO EN SEIS ARCHIVOS porque el
-- editor SQL de Supabase corta la petición HTTP si una sola tarda demasiado, y
-- al ir dentro de una transacción se deshace entera: "Failed to fetch" y ni un
-- objeto creado.
--
--   040  preparación: freno de locks, pausa del refresco automático,
--        contrato de columnas y demolición en orden de dependencia
--   041  criterio de aerolínea en las reglas + resolvedor de clasificación
--   042  vista materializada (vacía) + índices
--   043  estadistica_agregado — el motor
--   044  funciones de consulta y diagnóstico + verificación de catálogo
--   045  llenado, reanudación del refresco automático y verificación de datos
--
-- CORRERLOS EN ORDEN, cada uno con COMMIT antes de pasar al siguiente: el 042
-- necesita el resolvedor del 041, el 043 necesita la vista del 042.
--
-- ENTRE EL 040 Y EL 044 EL MÓDULO ESTADÍSTICO QUEDA ABAJO. Son minutos, y la
-- pestaña Estadística simplemente no encontrará sus funciones; el Informe
-- oficial y el resto de la aplicación siguen funcionando igual.
--
-- REQUISITO: 043 aplicada (con COMMIT).
--
-- Con este archivo el módulo queda COMPLETO en cuanto a objetos. Lo único que
-- falta es llenar la vista, que va en el 045.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

-- =============================================================================
-- 5) estadistica_sin_clasificar — qué regla falta
--
--    Agrupa por la COMBINACIÓN de criterios que una regla necesitaría, con su
--    conteo. Cada renglón se traduce directo en una regla nueva. Ahora incluye
--    también el código de aerolínea del catálogo principal.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_sin_clasificar(
    p_desde  date,
    p_hasta  date,
    p_limite integer DEFAULT 200
)
RETURNS TABLE (
    aerolinea       text,
    aerolinea_id    bigint,
    aerolinea_codigo text,
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
        m.aerolinea_codigo,
        m.tipo_aeronave,
        m.tipo_servicio,
        max(m.tipo_servicio_descripcion),
        count(*)::bigint,
        (sum(m.pax))::numeric,
        (sum(m.carga_total_kg))::numeric,
        min(m.fecha_operacion),
        max(m.fecha_operacion),
        (array_agg(m.numero_vuelo ORDER BY m.fecha_operacion DESC) FILTER (WHERE m.numero_vuelo IS NOT NULL))[1]
    FROM public.mv_estadistica_operaciones m
    WHERE m.fecha_operacion >= p_desde
      AND m.fecha_operacion <= p_hasta
      AND NOT m.clasificada
      AND NOT m.es_cancelada
    GROUP BY m.aerolinea, m.aerolinea_conciliacion_id, m.aerolinea_codigo,
             m.tipo_aeronave, m.tipo_servicio
    ORDER BY count(*) DESC
    LIMIT greatest(coalesce(p_limite, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_sin_clasificar(date, date, integer) TO authenticated;


-- =============================================================================
-- 6) estadistica_detalle — filas para exportar
--
--    Devuelve el RESULTADO COMPLETO de los filtros, no la página visible en
--    pantalla. Se recrea porque el tipo de la vista materializada cambió.
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
      AND public._estadistica_filtro_ok(m.posicion,               p_filtros -> 'posicion')
      AND public._estadistica_filtro_ok(m.puerta,                 p_filtros -> 'puerta')
      AND public._estadistica_filtro_ok(m.banda,                  p_filtros -> 'banda')
      AND public._estadistica_filtro_ok(m.tipo_operacion,         p_filtros -> 'tipo_operacion')
      AND public._estadistica_filtro_ok(m.motivo_operativo,       p_filtros -> 'motivo_operativo')
      AND public._estadistica_filtro_ok(m.codigo_demora,          p_filtros -> 'codigo_demora')
      AND public._estadistica_filtro_ok(m.fuente_principal,       p_filtros -> 'fuente')
      AND public._estadistica_filtro_ok(m.clasificacion_slot,     p_filtros -> 'clasificacion_slot')
    ORDER BY m.fecha_operacion, m.id
    LIMIT greatest(coalesce(p_limite, 50000), 1)
    OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_detalle(date, date, jsonb, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_detalle(date, date, jsonb, integer, integer) TO authenticated;


-- =============================================================================
-- 7) estadistica_opciones_filtro — alimenta los desplegables sin traer detalle
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
    SELECT 'aerolinea'::text, aerolinea::text, aerolinea::text, count(*)::bigint
      FROM v WHERE aerolinea IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_aeronave'::text, tipo_aeronave::text, tipo_aeronave::text, count(*)::bigint
      FROM v WHERE tipo_aeronave IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'matricula'::text, matricula::text, matricula::text, count(*)::bigint
      FROM v WHERE matricula IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_servicio'::text, tipo_servicio::text,
           (tipo_servicio || coalesce(' — ' || max(tipo_servicio_descripcion), ''))::text,
           count(*)::bigint
      FROM v WHERE tipo_servicio IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'endpoint'::text, endpoint_codigo::text,
           (endpoint_codigo || coalesce(' — ' || max(endpoint_ciudad), ''))::text, count(*)::bigint
      FROM v WHERE endpoint_codigo IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'posicion'::text, posicion::text, posicion::text, count(*)::bigint
      FROM v WHERE posicion IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'puerta'::text, puerta::text, puerta::text, count(*)::bigint
      FROM v WHERE puerta IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'banda'::text, banda::text, banda::text, count(*)::bigint
      FROM v WHERE banda IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'tipo_operacion'::text, tipo_operacion::text, tipo_operacion::text, count(*)::bigint
      FROM v WHERE tipo_operacion IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'motivo_operativo'::text, motivo_operativo::text, motivo_operativo::text, count(*)::bigint
      FROM v WHERE motivo_operativo IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'codigo_demora'::text, codigo_demora::text,
           (codigo_demora || coalesce(' — ' || max(causa_demora), ''))::text, count(*)::bigint
      FROM v WHERE codigo_demora IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'fuente'::text, fuente_principal::text, fuente_principal::text, count(*)::bigint
      FROM v WHERE fuente_principal IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'clasificacion_slot'::text, clasificacion_slot::text, clasificacion_slot::text, count(*)::bigint
      FROM v WHERE clasificacion_slot IS NOT NULL GROUP BY 2
    ORDER BY 1, 4 DESC, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_opciones_filtro(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_opciones_filtro(date, date) TO authenticated;


-- =============================================================================
-- 8) estadistica_diagnostico — por qué una pantalla sale vacía
--
--    Cuando el módulo no muestra nada, la pregunta siempre es la misma: ¿no hay
--    datos, no hay datos EN ESE PERIODO, o la materialización está vieja? Esta
--    función lo contesta de una sola consulta y la pantalla la usa para escribir
--    un mensaje concreto en vez de un "sin datos" mudo.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_diagnostico()
RETURNS TABLE (
    movimientos          bigint,
    canceladas           bigint,
    clasificadas         bigint,
    sin_clasificar       bigint,
    con_pax              bigint,
    con_capacidad        bigint,
    con_carga            bigint,
    con_rotacion         bigint,
    conciliadas          bigint,
    primera_fecha        date,
    ultima_fecha         date,
    refrescado_at        timestamptz,
    reglas_activas       bigint,
    por_anio             jsonb,
    por_fuente           jsonb
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
        count(*)::bigint,
        count(*) FILTER (WHERE m.es_cancelada)::bigint,
        count(*) FILTER (WHERE m.clasificada)::bigint,
        count(*) FILTER (WHERE NOT m.clasificada)::bigint,
        count(*) FILTER (WHERE m.pax IS NOT NULL)::bigint,
        count(*) FILTER (WHERE m.capacidad_pasajeros IS NOT NULL)::bigint,
        count(*) FILTER (WHERE m.carga_total_kg IS NOT NULL AND m.carga_total_kg > 0)::bigint,
        count(*) FILTER (WHERE m.rotacion_clave IS NOT NULL)::bigint,
        count(*) FILTER (WHERE m.conciliado)::bigint,
        min(m.fecha_operacion),
        max(m.fecha_operacion),
        (SELECT r.refrescado_at FROM public.estadistica_refresco r WHERE r.id = 1),
        (SELECT count(*)::bigint FROM public.estadistica_reglas_clasificacion WHERE activo),
        (SELECT coalesce(jsonb_object_agg(t.anio, t.n), '{}'::jsonb)
           FROM (SELECT anio::text AS anio, count(*) AS n
                   FROM public.mv_estadistica_operaciones GROUP BY 1) t),
        (SELECT coalesce(jsonb_object_agg(t.fuente, t.n), '{}'::jsonb)
           FROM (SELECT coalesce(fuente_principal, 'sin fuente') AS fuente, count(*) AS n
                   FROM public.mv_estadistica_operaciones GROUP BY 1) t)
    FROM public.mv_estadistica_operaciones m;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_diagnostico() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_diagnostico() TO authenticated;

COMMENT ON FUNCTION public.estadistica_diagnostico() IS
    'Estado del módulo estadístico: cuántos movimientos hay, en qué rango de '
    'fechas, cuánto está clasificado y cuándo se refrescó. La pantalla lo usa '
    'para explicar una tabla vacía en vez de dejarla muda.';


-- =============================================================================
-- VERIFICACIÓN (de catálogo: la vista todavía está vacía)
--
-- Aquí no se consulta la materializada: se creó WITH NO DATA y hasta que no se
-- refresque no es consultable. Las verificaciones sobre los DATOS están en el
-- 045, después del llenado.
-- =============================================================================

-- 1) Todas las funciones del módulo, con su firma.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('estadistica_resolver_clasificacion', 'estadistica_agregado',
                     'estadistica_sin_clasificar', 'estadistica_detalle',
                     'estadistica_opciones_filtro', 'estadistica_diagnostico',
                     'estadistica_access_level', 'refrescar_estadistica')
 ORDER BY 1, 2;

-- 2) Los objetos del módulo, y la materializada aún sin poblar.
SELECT c.relname,
       CASE c.relkind WHEN 'm' THEN 'vista materializada'
                      WHEN 'v' THEN 'vista'
                      WHEN 'r' THEN 'tabla' ELSE c.relkind::text END AS tipo,
       c.relispopulated AS poblada
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('mv_estadistica_operaciones', 'v_estadistica_operaciones',
                     'estadistica_reglas_clasificacion', 'estadistica_refresco',
                     'estadistica_catalogo_clasificacion')
 ORDER BY 1;

-- 3) Los objetos de 027/028 siguen intactos: el Informe Estadístico no se tocó.
SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen',
                     'v_informe_estadistico_aerolinea', 'mv_informe_estadistico_base',
                     'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea')
 ORDER BY 1;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT y seguir con 045_estadistica_v2_poblar.sql, que es el que
-- llena la vista y reanuda el refresco automático.
-- -----------------------------------------------------------------------------
ROLLBACK;
