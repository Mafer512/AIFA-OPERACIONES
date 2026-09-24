-- =============================================================================
-- 041 — Motor estadístico v2 · criterio de aerolínea y resolvedor
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
-- REQUISITO: 040 aplicada (con COMMIT).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

-- =============================================================================
-- 1) Criterio de regla por CÓDIGO DE AEROLÍNEA
--
--    maestra_operaciones tiene DOS referencias de aerolínea:
--      aerolinea_id              text  → airlines(id)                    (catálogo principal)
--      aerolinea_conciliacion_id bigint → conciliacion_catalogo_aerolineas(id)
--    La 036 sólo contemplaba la segunda. Una regla que apunte a la primera
--    alcanza a los movimientos que resolvieron el catálogo principal (los del
--    AODB) sin depender de que además tengan el de Conciliación.
-- =============================================================================
ALTER TABLE public.estadistica_reglas_clasificacion
    ADD COLUMN IF NOT EXISTS aerolinea_codigo text;

DO $fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'estadistica_reglas_aerolinea_codigo_fk'
    ) AND to_regclass('public.airlines') IS NOT NULL THEN
        ALTER TABLE public.estadistica_reglas_clasificacion
            ADD CONSTRAINT estadistica_reglas_aerolinea_codigo_fk
            FOREIGN KEY (aerolinea_codigo) REFERENCES public.airlines(id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo crear la FK hacia airlines (%). La columna queda sin FK.', SQLERRM;
END;
$fk$;

COMMENT ON COLUMN public.estadistica_reglas_clasificacion.aerolinea_codigo IS
    'Criterio por aerolínea del catálogo principal (airlines.id), que es a lo '
    'que apunta maestra_operaciones.aerolinea_id. Complementa a aerolinea_id '
    'de esta misma tabla, que apunta al catálogo de Conciliación.';

-- El CHECK de "al menos un criterio" tiene que contemplar el criterio nuevo, o
-- una regla que sólo use aerolinea_codigo sería rechazada.
ALTER TABLE public.estadistica_reglas_clasificacion
    DROP CONSTRAINT IF EXISTS estadistica_reglas_criterio_ck;
ALTER TABLE public.estadistica_reglas_clasificacion
    ADD CONSTRAINT estadistica_reglas_criterio_ck CHECK (
        aerolinea_id IS NOT NULL
        OR NULLIF(btrim(coalesce(aerolinea_codigo, '')), '') IS NOT NULL
        OR NULLIF(btrim(coalesce(aerolinea_texto, '')), '') IS NOT NULL
        OR NULLIF(btrim(coalesce(tipo_aeronave, '')), '') IS NOT NULL
        OR NULLIF(btrim(coalesce(tipo_servicio, '')), '') IS NOT NULL
        OR prioridad >= 9000
    );


-- =============================================================================
-- 2) estadistica_resolver_clasificacion — ahora con el código de aerolínea
--
--    Cambia la firma (un parámetro más), así que CREATE OR REPLACE no basta:
--    no puede cambiar la lista de argumentos. La versión anterior ya se
--    borró en el bloque 0b, que es donde está el orden de dependencia.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_resolver_clasificacion(
    p_fecha            date,
    p_aerolinea_id     bigint,
    p_aerolinea_codigo text,
    p_aerolinea_texto  text,
    p_tipo_aeronave    text,
    p_tipo_servicio    text
)
RETURNS TABLE (
    regla_id             bigint,
    segmento_aviacion    text,
    naturaleza_operacion text
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT r.id, r.segmento_aviacion, r.naturaleza_operacion
      FROM public.estadistica_reglas_clasificacion r
      LEFT JOIN public.conciliacion_catalogo_aerolineas ca ON ca.id = r.aerolinea_id
     WHERE r.activo
       -- Vigencia contra la FECHA DE OPERACIÓN, no contra hoy.
       AND (r.vigente_desde IS NULL OR p_fecha IS NULL OR p_fecha >= r.vigente_desde)
       AND (r.vigente_hasta IS NULL OR p_fecha IS NULL OR p_fecha <= r.vigente_hasta)
       -- Aerolínea por el catálogo de Conciliación (FK) o por su nombre/iata/alias
       AND (
            r.aerolinea_id IS NULL
            OR r.aerolinea_id = p_aerolinea_id
            OR (
                ca.id IS NOT NULL
                AND public._estadistica_norm(p_aerolinea_texto) IS NOT NULL
                AND (
                     public._estadistica_norm(ca.name) = public._estadistica_norm(p_aerolinea_texto)
                  OR public._estadistica_norm(ca.iata) = public._estadistica_norm(p_aerolinea_texto)
                  OR EXISTS (
                        SELECT 1 FROM unnest(coalesce(ca.aliases, '{}'::text[])) a
                         WHERE public._estadistica_norm(a) = public._estadistica_norm(p_aerolinea_texto)
                     )
                )
            )
       )
       -- Aerolínea por el catálogo principal (airlines.id)
       AND (
            NULLIF(btrim(coalesce(r.aerolinea_codigo, '')), '') IS NULL
            OR public._estadistica_norm(r.aerolinea_codigo) = public._estadistica_norm(p_aerolinea_codigo)
       )
       -- Aerolínea por texto crudo
       AND (
            NULLIF(btrim(coalesce(r.aerolinea_texto, '')), '') IS NULL
            OR public._estadistica_norm(r.aerolinea_texto) = public._estadistica_norm(p_aerolinea_texto)
            OR public._estadistica_norm(r.aerolinea_texto) = public._estadistica_norm(p_aerolinea_codigo)
       )
       AND (
            NULLIF(btrim(coalesce(r.tipo_aeronave, '')), '') IS NULL
            OR public._estadistica_norm(r.tipo_aeronave) = public._estadistica_norm(p_tipo_aeronave)
       )
       AND (
            NULLIF(btrim(coalesce(r.tipo_servicio, '')), '') IS NULL
            OR upper(btrim(r.tipo_servicio)) = upper(btrim(coalesce(p_tipo_servicio, '')))
       )
     ORDER BY
        r.prioridad ASC,
        -- Especificidad: cuántos criterios no nulos tiene la regla.
        (
            (r.aerolinea_id IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.aerolinea_codigo, '')), '') IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.aerolinea_texto, '')), '') IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.tipo_aeronave, '')), '') IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.tipo_servicio, '')), '') IS NOT NULL)::int
        ) DESC,
        r.id DESC
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.estadistica_resolver_clasificacion(date, bigint, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_resolver_clasificacion(date, bigint, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.estadistica_resolver_clasificacion(date, bigint, text, text, text, text) IS
    'Definición canónica de qué regla gana. Devuelve 0 filas cuando ninguna '
    'regla cubre la operación: eso es SIN CLASIFICAR y es un resultado válido, '
    'no un error.';


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- El resolvedor debe aparecer UNA sola vez y con seis argumentos.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'estadistica_resolver_clasificacion';

-- El criterio nuevo quedó en la tabla de reglas.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'estadistica_reglas_clasificacion'
   AND column_name IN ('aerolinea_id', 'aerolinea_codigo', 'aerolinea_texto',
                       'tipo_aeronave', 'tipo_servicio')
 ORDER BY 1;

-- El resolvedor contesta sin tronar. Sin reglas que apliquen devuelve 0 filas,
-- que es SIN CLASIFICAR y es un resultado válido.
SELECT count(*) AS filas_devueltas
  FROM public.estadistica_resolver_clasificacion(current_date, NULL, 'Y4', 'VOLARIS', 'A320', 'J');

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT y seguir con 042_estadistica_v2_vista.sql.
-- -----------------------------------------------------------------------------
ROLLBACK;
