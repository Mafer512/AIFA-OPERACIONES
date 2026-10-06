-- =============================================================================
-- 058 · Manifiestos — tabla de hechos y resúmenes (SOLO ESTRUCTURA)
--
-- Selecciona todo y Run. Tarda segundos: crea tablas VACÍAS, índices y
-- funciones. No lee ni escribe manifiestos (el llenado es la 059) y no cambia
-- nada de lo que hoy consume la app (el cambio en producción es la 060).
--
-- Idempotente y "todo o nada": va en una sola transacción y puede volver a
-- correrse; CREATE ... IF NOT EXISTS / CREATE OR REPLACE en todo.
--
-- FUENTES (las ÚNICAS)
--   · public.maestra_manifiestos            → manifiestos con FECHA ≤ 31/12/2025
--   · public."Conciliación Manifiestos"     → manifiestos con FECHA ≥ 01/01/2026
--   La tabla de origen se decide por la FECHA de operación, así ningún
--   manifiesto se cuenta dos veces aunque su cierre caiga en el año siguiente.
--   Catálogos de apoyo (no son fuente de manifiestos): conciliacion_catalogo_
--   aerolineas, catalogo_aeropuertos y matriculas_manifiestos (capacidad de
--   asientos para el factor de ocupación).
--   datos_origen (jsonb de maestra_manifiestos) NUNCA se lee.
--
-- REGLAS DE NEGOCIO
--   1. Origen por FECHA: < 2026-01-01 maestra; ≥ 2026-01-01 Conciliación.
--   2. fecha_reporte = "CIERRE SUBSECRETARIA" válido (dd/mm/aaaa) o, si no hay,
--      la FECHA. Todos los manifiestos cuentan. fecha_operacion se guarda aparte.
--   3. Comercial o Carga:
--        maestra      → tipo_reporte (PASAJEROS → comercial, CARGA → carga).
--        Conciliación → public.aifa_regla_carga(): catálogo (solo 'carga' →
--                       carga; solo 'pasajeros' → comercial) y, si no se
--                       resuelve, la misma secuencia de _conciRowIsCargo() de
--                       script.js (cierre congelado, lista fija, Service Type).
--   4. Operación = fila con AEROLINEA. Pasajeros = "TOTAL PAX".
--      Carga = "KG DE CARGA TOTAL". Equipaje = "KGS. DE EQUIPAJE".
--   5. Aerolínea normalizada al catálogo (iata / name / aliases, sin acentos
--      ni mayúsculas); si no se resuelve se conserva el texto.
--   6. Destino normalizado a catalogo_aeropuertos (iata / ciudad); nacional o
--      internacional por "TIPO DE OPERACIÓN" si viene capturado, si no por el
--      país del catálogo.
--   7. Cancelado = "PUNTUALIDAD / CANCELACIÓN" contiene CANCEL.
--
-- NO toca maestra_manifiestos ni "Conciliación Manifiestos" (ni sus triggers,
-- RLS o índices), ni ningún objeto de maestra_operaciones*.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

-- -----------------------------------------------------------------------------
-- 0) Prerrequisitos. Falla temprano y con nombre si falta algo.
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
    v_faltan text[];
BEGIN
    SELECT array_agg(x) INTO v_faltan
      FROM (VALUES
            ('public.maestra_manifiestos'),
            ('public."Conciliación Manifiestos"'),
            ('public.conciliacion_catalogo_aerolineas'),
            ('public.catalogo_aeropuertos'),
            ('public.matriculas_manifiestos')
           ) t(x)
     WHERE to_regclass(x) IS NULL;
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION 'Faltan tablas: %', array_to_string(v_faltan, ', ');
    END IF;

    SELECT array_agg(x) INTO v_faltan
      FROM (VALUES
            ('public._aifa_parse_manifest_date(text)'),
            ('public._aifa_safe_numeric(text)'),
            ('public._aifa_manifest_direction(text)'),
            ('public._aifa_route_endpoint(text,text)'),
            ('public._estadistica_norm(text)')
           ) t(x)
     WHERE to_regprocedure(x) IS NULL;
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION 'Faltan funciones: %', array_to_string(v_faltan, ', ');
    END IF;

    SELECT array_agg(r.tabla || '.' || r.col) INTO v_faltan
      FROM (
        SELECT 'maestra_manifiestos' AS tabla, unnest(ARRAY[
            'id', 'FECHA', 'CIERRE SUBSECRETARIA', 'TIPO DE MANIFIESTO', 'AEROLINEA',
            'TIPO DE OPERACIÓN', 'AERONAVE', 'MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN',
            'SLOT ASIGNADO', 'HR. DE OPERACIÓN', 'HR. DE RECEPCIÓN', 'PUNTUALIDAD / CANCELACIÓN',
            'TOTAL PAX', 'INFANTES', 'TRANSITOS', 'CONEXIONES', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA',
            'KGS. DE EQUIPAJE', 'KG DE CARGA TOTAL', 'KGS. DE CARGA NACIONAL',
            'KGS. DE CARGA INTERNACIONAL', 'CORREO', 'DEMORA +- 15 MIN.', 'CÓDIGO DEMORA',
            'tipo_reporte']) AS col
        UNION ALL
        SELECT 'Conciliación Manifiestos', unnest(ARRAY[
            'id', 'FECHA', '_portal_flight_date', 'CIERRE SUBSECRETARIA', 'cierre_es_carga_reportado',
            'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN', 'AERONAVE', 'MATRÍCULA',
            '# DE VUELO', 'DESTINO / ORIGEN', 'SLOT ASIGNADO', 'HR. DE OPERACIÓN',
            'HR. DE RECEPCIÓN', 'PUNTUALIDAD / CANCELACIÓN', 'TOTAL PAX', 'INFANTES', 'TRANSITOS',
            'CONEXIONES', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'KGS. DE EQUIPAJE',
            'KG DE CARGA TOTAL', 'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL',
            'CORREO', 'DEMORA +- 15 MIN.', 'CÓDIGO DEMORA'])
      ) r
     WHERE NOT EXISTS (
        SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabla))
           AND a.attname = r.col AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION 'Faltan columnas: %', array_to_string(v_faltan, ', ');
    END IF;
END;
$pre$;

-- -----------------------------------------------------------------------------
-- 1) Bitácora de migraciones (misma estructura que las anteriores).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._mig_paso_log (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paso    text,
    inicio  timestamptz,
    fin     timestamptz,
    detalle text,
    error   text
);
REVOKE ALL ON public._mig_paso_log FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Auxiliares de texto y fecha
-- -----------------------------------------------------------------------------

-- Clave de comparación: sin acentos (también en mayúsculas acentuadas, que
-- lower() no siempre baja según la intercalación), minúsculas, sin signos y con
-- espacios simples. Es la misma normalización que usaba la 057c.
CREATE OR REPLACE FUNCTION public._aifa_norm_texto(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT nullif(btrim(regexp_replace(regexp_replace(
        lower(translate(coalesce(p_value, ''),
            'áéíóúüñàèìòùâêîôûäëïöÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖ',
            'aeiouunaeiouaeiouaeioaeiouunaeiouaeiouaeio')),
        '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

-- "dd/mm/aaaa hh:mm" (o "aaaa-mm-dd hh:mm") en hora local de México →
-- timestamptz. Con p_ref, también acepta solo "hh:mm" de ese día. Nunca
-- lanza error: lo que no se puede leer con certeza queda NULL.
CREATE OR REPLACE FUNCTION public._aifa_parse_manifest_ts(p_value text, p_ref date DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v text := btrim(coalesce(p_value, ''));
    m text[];
BEGIN
    IF v = '' THEN RETURN NULL; END IF;
    m := regexp_match(v, '^(\d{1,2})/(\d{1,2})/(\d{4})[ T]+(\d{1,2}):(\d{2})');
    IF m IS NOT NULL THEN
        RETURN make_timestamptz(m[3]::int, m[2]::int, m[1]::int, m[4]::int, m[5]::int, 0, 'America/Mexico_City');
    END IF;
    m := regexp_match(v, '^(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})');
    IF m IS NOT NULL THEN
        RETURN make_timestamptz(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, 0, 'America/Mexico_City');
    END IF;
    IF p_ref IS NOT NULL THEN
        m := regexp_match(v, '^(\d{1,2}):(\d{2})$');
        IF m IS NOT NULL THEN
            RETURN make_timestamptz(extract(year FROM p_ref)::int, extract(month FROM p_ref)::int,
                                    extract(day FROM p_ref)::int, m[1]::int, m[2]::int, 0, 'America/Mexico_City');
        END IF;
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Fecha válida de "CIERRE SUBSECRETARIA": solo dd/mm/aaaa completa (mismo
-- criterio que la 057c, ya validado contra los Excel).
CREATE OR REPLACE FUNCTION public._aifa_fecha_cierre(p_value text)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE WHEN btrim(coalesce(p_value, '')) ~ '^\d{1,2}/\d{1,2}/\d{4}$'
                THEN public._aifa_parse_manifest_date(btrim(p_value)) END
$$;

REVOKE ALL ON FUNCTION public._aifa_norm_texto(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._aifa_parse_manifest_ts(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._aifa_fecha_cierre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._aifa_norm_texto(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) LA regla Comercial / Carga (una sola definición para app y reportes)
--
--    Traducción de _conciRowIsCargo() (script.js), con el catálogo primero:
--      1. catálogo: solo 'carga' → carga; solo 'pasajeros' → comercial
--      2. cierre_es_carga_reportado (clasificación congelada al cerrar)
--      3. lista fija de aerolíneas de carga / de pasajeros (cargoAirlines /
--         passengerAirlines de script.js; la prueba Jest
--         manifiestos-hechos-sql.test.js comprueba que sigan iguales)
--      4. Service Type del vuelo: empieza con F o H → carga
--      5. si nada aplica → comercial
--    Devuelve el MOTIVO; aifa_regla_es_carga() lo convierte en booleano.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aifa_aerolineas_carga_fijas()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT ARRAY(SELECT public._aifa_norm_texto(x) FROM unnest(ARRAY[
        'MasAir', 'China Southerrn', 'Lufthansa', 'Kalitta Air', 'Aerounión', 'Emirates Airlines',
        'Atlas Air', 'Silk Way West Airlines', 'Cathay Pacific', 'United Parcel Service',
        'Turkish Airlines', 'Cargojet Airways', 'Air Canada', 'Cargolux'
    ]) x)
$$;

CREATE OR REPLACE FUNCTION public.aifa_aerolineas_pasajeros_fijas()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT ARRAY(SELECT public._aifa_norm_texto(x) FROM unnest(ARRAY[
        'Viva', 'Volaris', 'Aeromexico', 'Mexicana de Aviación', 'Aerus', 'Arajet',
        'Air France', 'Qatar Airways', 'KLM', 'British Airways'
    ]) x)
$$;

-- Nombre por omisión de los códigos que la app conoce aunque no estén en el
-- catálogo (_conciDefaultAirlineMeta de script.js).
CREATE OR REPLACE FUNCTION public._aifa_aerolinea_por_omision(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE upper(btrim(coalesce(p_codigo, '')))
        WHEN 'VB' THEN 'VIVA AEROBUS'
        WHEN 'Y4' THEN 'VOLARIS'
        WHEN 'AM' THEN 'AEROMEXICO'
        WHEN 'XN' THEN 'MEXICANA DE AVIACION'
    END
$$;

CREATE OR REPLACE FUNCTION public.aifa_regla_carga(
    p_types           text[],
    p_nombre          text,
    p_tipo_operacion  text DEFAULT NULL,
    p_cierre_es_carga boolean DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    WITH t AS (
        SELECT coalesce(bool_or(lower(btrim(x)) = 'carga'), false)     AS carga,
               coalesce(bool_or(lower(btrim(x)) = 'pasajeros'), false) AS pasajeros
          FROM unnest(coalesce(p_types, '{}'::text[])) x
    )
    SELECT CASE
        WHEN t.carga AND NOT t.pasajeros THEN 'catalogo_carga'
        WHEN t.pasajeros AND NOT t.carga THEN 'catalogo_pasajeros'
        WHEN p_cierre_es_carga IS TRUE   THEN 'cierre_carga'
        WHEN p_cierre_es_carga IS FALSE  THEN 'cierre_pasajeros'
        WHEN public._aifa_norm_texto(p_nombre) = ANY (public.aifa_aerolineas_carga_fijas())     THEN 'lista_carga'
        WHEN public._aifa_norm_texto(p_nombre) = ANY (public.aifa_aerolineas_pasajeros_fijas()) THEN 'lista_pasajeros'
        WHEN upper(left(btrim(coalesce(p_tipo_operacion, '')), 1)) IN ('F', 'H') THEN 'servicio_carga'
        ELSE 'omision_pasajeros'
    END
    FROM t
$$;

CREATE OR REPLACE FUNCTION public.aifa_regla_es_carga(
    p_types           text[],
    p_nombre          text,
    p_tipo_operacion  text DEFAULT NULL,
    p_cierre_es_carga boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT public.aifa_regla_carga(p_types, p_nombre, p_tipo_operacion, p_cierre_es_carga) LIKE '%\_carga'
$$;

COMMENT ON FUNCTION public.aifa_regla_carga(text[], text, text, boolean) IS
    'Regla única Comercial/Carga de los manifiestos de Conciliación. Devuelve el motivo '
    '(catalogo_*, cierre_*, lista_*, servicio_carga, omision_pasajeros). Mismo orden que '
    '_conciRowIsCargo() de script.js, con el catálogo primero.';

-- -----------------------------------------------------------------------------
-- 4) Catálogos: claves de búsqueda y resolutores
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_aifa_aerolineas_claves AS
SELECT ca.id, ca.name, nullif(upper(btrim(ca.iata)), '') AS iata, ca.types, ca.active,
       'iata'::text AS tipo_clave, upper(btrim(ca.iata)) AS clave
  FROM public.conciliacion_catalogo_aerolineas ca
 WHERE nullif(btrim(ca.iata), '') IS NOT NULL
UNION ALL
SELECT ca.id, ca.name, nullif(upper(btrim(ca.iata)), ''), ca.types, ca.active,
       'nombre', public._aifa_norm_texto(ca.name)
  FROM public.conciliacion_catalogo_aerolineas ca
 WHERE public._aifa_norm_texto(ca.name) IS NOT NULL
UNION ALL
SELECT ca.id, ca.name, nullif(upper(btrim(ca.iata)), ''), ca.types, ca.active,
       'nombre', public._aifa_norm_texto(al)
  FROM public.conciliacion_catalogo_aerolineas ca
 CROSS JOIN LATERAL unnest(coalesce(ca.aliases, '{}'::text[])) al
 WHERE public._aifa_norm_texto(al) IS NOT NULL;

CREATE OR REPLACE VIEW public.v_aifa_aeropuertos_claves AS
SELECT upper(btrim(ap.iata)) AS iata, ap.ciudad, ap.pais, 'iata'::text AS tipo_clave,
       upper(btrim(ap.iata)) AS clave
  FROM public.catalogo_aeropuertos ap
 WHERE nullif(btrim(ap.iata), '') IS NOT NULL
UNION ALL
SELECT upper(btrim(ap.iata)), ap.ciudad, ap.pais, 'ciudad', public._aifa_norm_texto(ap.ciudad)
  FROM public.catalogo_aeropuertos ap
 WHERE nullif(btrim(ap.iata), '') IS NOT NULL AND public._aifa_norm_texto(ap.ciudad) IS NOT NULL
UNION ALL
-- "Monterrey, N.L." también se encuentra como "MONTERREY".
SELECT upper(btrim(ap.iata)), ap.ciudad, ap.pais, 'ciudad', public._aifa_norm_texto(split_part(ap.ciudad, ',', 1))
  FROM public.catalogo_aeropuertos ap
 WHERE nullif(btrim(ap.iata), '') IS NOT NULL AND position(',' IN coalesce(ap.ciudad, '')) > 0
   AND public._aifa_norm_texto(split_part(ap.ciudad, ',', 1)) IS NOT NULL;

REVOKE ALL ON public.v_aifa_aerolineas_claves FROM anon, authenticated;
REVOKE ALL ON public.v_aifa_aeropuertos_claves FROM anon, authenticated;

-- Aerolínea del catálogo para un texto ("VB", "VIVA AEROBUS", un alias…).
-- El código IATA gana; en empate, el id menor (mismo orden que la 057c).
CREATE OR REPLACE FUNCTION public.aifa_resolver_aerolinea(p_texto text)
RETURNS TABLE (catalogo_id bigint, nombre text, iata text, types text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT k.id, k.name, k.iata, k.types
      FROM public.v_aifa_aerolineas_claves k
     WHERE (k.tipo_clave = 'iata'   AND k.clave = upper(btrim(p_texto)))
        OR (k.tipo_clave = 'nombre' AND k.clave = public._aifa_norm_texto(p_texto))
     ORDER BY (k.tipo_clave = 'iata') DESC, k.id
     LIMIT 1
$$;

-- Atajo para la app: ¿este manifiesto de Conciliación es de carga?
CREATE OR REPLACE FUNCTION public.aifa_es_carga_conciliacion(
    p_aerolinea       text,
    p_tipo_operacion  text DEFAULT NULL,
    p_cierre_es_carga boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT public.aifa_regla_es_carga(
               r.types,
               coalesce(r.nombre, public._aifa_aerolinea_por_omision(p_aerolinea), p_aerolinea),
               p_tipo_operacion,
               p_cierre_es_carga)
      FROM (SELECT 1) x
      LEFT JOIN LATERAL public.aifa_resolver_aerolinea(p_aerolinea) r ON true
$$;

-- Destino del catálogo para "DESTINO / ORIGEN" (código, ciudad o ruta).
CREATE OR REPLACE FUNCTION public.aifa_resolver_destino(p_texto text, p_direccion text DEFAULT NULL)
RETURNS TABLE (codigo text, ciudad text, pais text, resuelto boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    WITH v AS (
        SELECT nullif(upper(btrim(coalesce(p_texto, ''))), '') AS txt,
               public._aifa_norm_texto(p_texto) AS norm,
               CASE WHEN upper(btrim(coalesce(p_texto, ''))) ~ '[^A-Z0-9 ]'
                    THEN public._aifa_route_endpoint(p_texto, coalesce(p_direccion, 'D')) END AS ruta
    ), m AS (
        SELECT k.iata, k.ciudad, k.pais,
               CASE WHEN k.tipo_clave = 'iata' AND k.clave = v.txt THEN 1
                    WHEN k.tipo_clave = 'ciudad' AND k.clave = v.norm THEN 2
                    ELSE 3 END AS prioridad
          FROM v
          JOIN public.v_aifa_aeropuertos_claves k
            ON (k.tipo_clave = 'iata' AND k.clave IN (v.txt, v.ruta))
            OR (k.tipo_clave = 'ciudad' AND k.clave = v.norm)
         ORDER BY prioridad, k.iata
         LIMIT 1
    )
    SELECT coalesce(m.iata, v.txt), coalesce(m.ciudad, btrim(p_texto)), m.pais, (m.iata IS NOT NULL)
      FROM v LEFT JOIN m ON true
     WHERE v.txt IS NOT NULL
$$;

-- Nacional / Internacional: lo capturado en "TIPO DE OPERACIÓN" manda; si no,
-- el país del catálogo; un OACI mexicano (MMxx) es nacional.
CREATE OR REPLACE FUNCTION public._aifa_nacional_internacional(p_tipo_operacion text, p_codigo text, p_pais text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE
        WHEN public._aifa_norm_texto(p_tipo_operacion) LIKE 'nac%' THEN 'Nacional'
        WHEN public._aifa_norm_texto(p_tipo_operacion) LIKE 'int%' THEN 'Internacional'
        WHEN p_pais IS NOT NULL AND public._aifa_norm_texto(p_pais) = 'mexico' THEN 'Nacional'
        WHEN upper(coalesce(p_codigo, '')) ~ '^MM[A-Z]{2}$' THEN 'Nacional'
        WHEN p_pais IS NOT NULL THEN 'Internacional'
    END
$$;

REVOKE ALL ON FUNCTION public.aifa_aerolineas_carga_fijas() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aifa_aerolineas_pasajeros_fijas() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._aifa_aerolinea_por_omision(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aifa_regla_carga(text[], text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aifa_regla_es_carga(text[], text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aifa_resolver_aerolinea(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aifa_es_carga_conciliacion(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aifa_resolver_destino(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._aifa_nacional_internacional(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aifa_aerolineas_carga_fijas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aifa_aerolineas_pasajeros_fijas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aifa_regla_carga(text[], text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aifa_regla_es_carga(text[], text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aifa_resolver_aerolinea(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aifa_es_carga_conciliacion(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aifa_resolver_destino(text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) manifiestos_hechos — una fila por manifiesto de las dos fuentes, tipada.
--    Sin JSON. Los id de las dos tablas se repiten: la clave es (fuente, id_origen).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manifiestos_hechos (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fuente                  text    NOT NULL CHECK (fuente IN ('MAESTRA', 'CONCILIACION')),
    id_origen               bigint  NOT NULL,
    fecha_operacion         date    NOT NULL,   -- FECHA del manifiesto
    fecha_cierre            date,               -- "CIERRE SUBSECRETARIA" válido
    fecha_reporte           date    NOT NULL,   -- la que cuenta: cierre o FECHA
    anio                    smallint NOT NULL,  -- de fecha_reporte
    mes                     smallint NOT NULL,
    dia                     smallint NOT NULL,
    direccion               text,               -- 'A' llegada / 'D' salida
    tipo_manifiesto         text,
    aerolinea_texto         text,               -- AEROLINEA tal cual
    aerolinea               text,               -- normalizada (catálogo o texto)
    aerolinea_codigo        text,               -- IATA del catálogo
    aerolinea_catalogo_id   bigint,
    es_operacion            boolean NOT NULL,   -- tiene AEROLINEA
    es_carga                boolean NOT NULL,
    clasificacion_origen    text,               -- motivo de es_carga
    tipo_operacion          text,               -- "TIPO DE OPERACIÓN" tal cual
    destino_texto           text,               -- "DESTINO / ORIGEN" tal cual
    destino                 text,               -- IATA (o el texto si no se resolvió)
    destino_ciudad          text,
    destino_pais            text,
    destino_resuelto        boolean NOT NULL DEFAULT false,
    nacional_internacional  text,               -- 'Nacional' / 'Internacional' / NULL
    nacint_origen           text,               -- 'declarado' / 'catalogo' / 'sin_determinar'
    numero_vuelo            text,
    aeronave                text,
    matricula               text,
    capacidad_pax           integer,            -- matriculas_manifiestos.pasajeros
    slot_asignado           timestamptz,
    hora_operacion          timestamptz,
    hora_recepcion          timestamptz,
    minutos_vs_slot         numeric,
    clasificacion_slot      text,
    puntualidad             text,
    demora_15_min           text,
    codigo_demora           text,
    cancelado               boolean NOT NULL,
    capturado               boolean NOT NULL,   -- "HR. DE RECEPCIÓN" no vacía
    pax                     numeric,
    equipaje_kg             numeric,
    carga_kg                numeric,
    carga_nacional_kg       numeric,
    carga_internacional_kg  numeric,
    correo_kg               numeric,
    pax_infantes            numeric,
    pax_transitos           numeric,
    pax_conexiones          numeric,
    pax_exentos             numeric,
    pax_pagan_tua           numeric,
    firma                   text    NOT NULL,   -- md5 de la fila: evita reescribir lo que no cambió
    actualizado_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT manifiestos_hechos_fuente_id_origen_key UNIQUE (fuente, id_origen)
);

CREATE INDEX IF NOT EXISTS idx_manifiestos_hechos_fecha_reporte
    ON public.manifiestos_hechos (fecha_reporte);
CREATE INDEX IF NOT EXISTS idx_manifiestos_hechos_aerolinea_fecha
    ON public.manifiestos_hechos (aerolinea, fecha_reporte);
CREATE INDEX IF NOT EXISTS idx_manifiestos_hechos_destino_fecha
    ON public.manifiestos_hechos (destino, fecha_reporte);
CREATE INDEX IF NOT EXISTS idx_manifiestos_hechos_carga_fecha
    ON public.manifiestos_hechos (es_carga, fecha_reporte);
-- Para el refresco por ventana de fechas de operación.
CREATE INDEX IF NOT EXISTS idx_manifiestos_hechos_fuente_fecha_operacion
    ON public.manifiestos_hechos (fuente, fecha_operacion);

COMMENT ON TABLE public.manifiestos_hechos IS
    'Una fila por manifiesto: maestra_manifiestos (FECHA ≤ 2025) y "Conciliación Manifiestos" '
    '(FECHA ≥ 2026), ya tipada y normalizada. fecha_reporte = cierre de Subsecretaría o FECHA. '
    'La llenan _mh_cargar() / manifiestos_hechos_refrescar(); no se edita a mano.';

-- Solo la leen las vistas y funciones de reportes (que corren como dueño).
ALTER TABLE public.manifiestos_hechos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manifiestos_hechos FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) Resúmenes. Se recalculan por mes (de fecha_reporte) cuando algo cambia.
--    operaciones = filas con AEROLINEA; pax/kg suman todas las filas (como la
--    057c, que cuadró con los Excel). Las canceladas cuentan, y se separan en
--    operaciones_canceladas para quien las quiera restar.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manifiestos_resumen_dia (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha_reporte           date    NOT NULL,
    anio                    smallint NOT NULL,
    mes                     smallint NOT NULL,
    es_carga                boolean NOT NULL,
    direccion               text,
    nacional_internacional  text,
    manifiestos             bigint  NOT NULL,
    operaciones             bigint  NOT NULL,
    operaciones_canceladas  bigint  NOT NULL,
    operaciones_capturadas  bigint  NOT NULL,
    pax                     numeric NOT NULL,
    equipaje_kg             numeric NOT NULL,
    carga_kg                numeric NOT NULL,
    carga_nacional_kg       numeric NOT NULL,
    carga_internacional_kg  numeric NOT NULL,
    correo_kg               numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_dia_fecha ON public.manifiestos_resumen_dia (fecha_reporte);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_dia_periodo ON public.manifiestos_resumen_dia (anio, mes);

CREATE TABLE IF NOT EXISTS public.manifiestos_resumen_mes_aerolinea (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anio                    smallint NOT NULL,
    mes                     smallint NOT NULL,
    aerolinea               text,
    aerolinea_codigo        text,
    es_carga                boolean NOT NULL,
    direccion               text,
    manifiestos             bigint  NOT NULL,
    operaciones             bigint  NOT NULL,
    operaciones_canceladas  bigint  NOT NULL,
    operaciones_capturadas  bigint  NOT NULL,
    pax                     numeric NOT NULL,
    equipaje_kg             numeric NOT NULL,
    carga_kg                numeric NOT NULL,
    carga_nacional_kg       numeric NOT NULL,
    carga_internacional_kg  numeric NOT NULL,
    correo_kg               numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_mes_aerolinea_periodo ON public.manifiestos_resumen_mes_aerolinea (anio, mes);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_mes_aerolinea_aerolinea ON public.manifiestos_resumen_mes_aerolinea (aerolinea, anio, mes);

CREATE TABLE IF NOT EXISTS public.manifiestos_resumen_mes_destino (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anio                    smallint NOT NULL,
    mes                     smallint NOT NULL,
    destino                 text,
    destino_ciudad          text,
    nacional_internacional  text,
    es_carga                boolean NOT NULL,
    direccion               text,
    manifiestos             bigint  NOT NULL,
    operaciones             bigint  NOT NULL,
    operaciones_canceladas  bigint  NOT NULL,
    operaciones_capturadas  bigint  NOT NULL,
    pax                     numeric NOT NULL,
    equipaje_kg             numeric NOT NULL,
    carga_kg                numeric NOT NULL,
    carga_nacional_kg       numeric NOT NULL,
    carga_internacional_kg  numeric NOT NULL,
    correo_kg               numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_mes_destino_periodo ON public.manifiestos_resumen_mes_destino (anio, mes);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_mes_destino_destino ON public.manifiestos_resumen_mes_destino (destino, anio, mes);

CREATE TABLE IF NOT EXISTS public.manifiestos_resumen_mes_aerolinea_destino (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anio                    smallint NOT NULL,
    mes                     smallint NOT NULL,
    aerolinea               text,
    aerolinea_codigo        text,
    destino                 text,
    destino_ciudad          text,
    nacional_internacional  text,
    es_carga                boolean NOT NULL,
    direccion               text,
    manifiestos             bigint  NOT NULL,
    operaciones             bigint  NOT NULL,
    operaciones_canceladas  bigint  NOT NULL,
    operaciones_capturadas  bigint  NOT NULL,
    pax                     numeric NOT NULL,
    equipaje_kg             numeric NOT NULL,
    carga_kg                numeric NOT NULL,
    carga_nacional_kg       numeric NOT NULL,
    carga_internacional_kg  numeric NOT NULL,
    correo_kg               numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_mes_aer_des_periodo ON public.manifiestos_resumen_mes_aerolinea_destino (anio, mes);
CREATE INDEX IF NOT EXISTS idx_manifiestos_resumen_mes_aer_des_aerolinea ON public.manifiestos_resumen_mes_aerolinea_destino (aerolinea, destino, anio, mes);

DO $rls$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['manifiestos_resumen_dia', 'manifiestos_resumen_mes_aerolinea',
                             'manifiestos_resumen_mes_destino', 'manifiestos_resumen_mes_aerolinea_destino'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END LOOP;
END;
$rls$;

-- -----------------------------------------------------------------------------
-- 7) Hora del último refresco de los hechos (para seguimiento).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manifiestos_hechos_refresco (
    id            boolean PRIMARY KEY DEFAULT true CHECK (id),
    refrescado_at timestamptz NOT NULL DEFAULT now(),
    duracion_ms   integer,
    detalle       jsonb
);
ALTER TABLE public.manifiestos_hechos_refresco ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manifiestos_hechos_refresco FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) Avisos por periodo (configurables sin desplegar la app).
--    Hueco conocido: los manifiestos de CARGA de enero a agosto de 2026 no
--    están en ninguna de las dos tablas. Cuando se carguen:
--        UPDATE public.manifiestos_avisos_periodo SET activo = false
--         WHERE clave = 'carga_2026_ene_ago';
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manifiestos_avisos_periodo (
    clave          text PRIMARY KEY,
    texto          text NOT NULL,
    detalle        text,
    desde          date NOT NULL,
    hasta          date NOT NULL CHECK (hasta >= desde),
    categoria      text NOT NULL DEFAULT 'carga' CHECK (categoria IN ('carga', 'comercial', 'todas')),
    ambitos        text[] NOT NULL DEFAULT ARRAY['inicio', 'estadistica']::text[],
    activo         boolean NOT NULL DEFAULT true,
    actualizado_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.manifiestos_avisos_periodo (clave, texto, detalle, desde, hasta, categoria, ambitos, activo)
VALUES ('carga_2026_ene_ago',
        'Carga ene–ago 2026 incompleta',
        'Los manifiestos de carga de enero a agosto de 2026 aún no están cargados; la carga de esos meses sale baja.',
        DATE '2026-01-01', DATE '2026-08-31', 'carga', ARRAY['inicio', 'estadistica'], true)
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE public.manifiestos_avisos_periodo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manifiestos_avisos_periodo FROM anon, authenticated;
GRANT SELECT ON public.manifiestos_avisos_periodo TO authenticated;
DROP POLICY IF EXISTS manifiestos_avisos_periodo_select ON public.manifiestos_avisos_periodo;
CREATE POLICY manifiestos_avisos_periodo_select
    ON public.manifiestos_avisos_periodo
    FOR SELECT TO authenticated
    USING (true);

-- -----------------------------------------------------------------------------
-- 9) _mh_recalcular_resumenes(meses) — rehace los cuatro resúmenes de esos
--    meses (primer día de cada mes, por fecha_reporte). NULL = todo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mh_recalcular_resumenes(p_meses date[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_meses date[];
BEGIN
    IF p_meses IS NULL THEN
        TRUNCATE public.manifiestos_resumen_dia, public.manifiestos_resumen_mes_aerolinea,
                 public.manifiestos_resumen_mes_destino, public.manifiestos_resumen_mes_aerolinea_destino;
        SELECT array_agg(DISTINCT date_trunc('month', fecha_reporte)::date) INTO v_meses
          FROM public.manifiestos_hechos;
    ELSE
        SELECT array_agg(DISTINCT date_trunc('month', x)::date) INTO v_meses
          FROM unnest(p_meses) x WHERE x IS NOT NULL;
        DELETE FROM public.manifiestos_resumen_dia r
         WHERE date_trunc('month', r.fecha_reporte)::date = ANY (v_meses);
        DELETE FROM public.manifiestos_resumen_mes_aerolinea r
         WHERE make_date(r.anio, r.mes, 1) = ANY (v_meses);
        DELETE FROM public.manifiestos_resumen_mes_destino r
         WHERE make_date(r.anio, r.mes, 1) = ANY (v_meses);
        DELETE FROM public.manifiestos_resumen_mes_aerolinea_destino r
         WHERE make_date(r.anio, r.mes, 1) = ANY (v_meses);
    END IF;

    IF v_meses IS NULL OR cardinality(v_meses) = 0 THEN
        RETURN 0;
    END IF;

    DROP TABLE IF EXISTS pg_temp._mh_periodo;
    CREATE TEMP TABLE _mh_periodo ON COMMIT DROP AS
    SELECT h.*
      FROM public.manifiestos_hechos h
      JOIN unnest(v_meses) m(ini)
        ON h.fecha_reporte >= m.ini AND h.fecha_reporte < (m.ini + interval '1 month')::date;

    INSERT INTO public.manifiestos_resumen_dia (
        fecha_reporte, anio, mes, es_carga, direccion, nacional_internacional,
        manifiestos, operaciones, operaciones_canceladas, operaciones_capturadas,
        pax, equipaje_kg, carga_kg, carga_nacional_kg, carga_internacional_kg, correo_kg)
    SELECT fecha_reporte, anio, mes, es_carga, direccion, nacional_internacional,
           count(*), count(*) FILTER (WHERE es_operacion),
           count(*) FILTER (WHERE es_operacion AND cancelado),
           count(*) FILTER (WHERE es_operacion AND capturado),
           coalesce(sum(pax), 0), coalesce(sum(equipaje_kg), 0), coalesce(sum(carga_kg), 0),
           coalesce(sum(carga_nacional_kg), 0), coalesce(sum(carga_internacional_kg), 0),
           coalesce(sum(correo_kg), 0)
      FROM pg_temp._mh_periodo
     GROUP BY 1, 2, 3, 4, 5, 6;

    INSERT INTO public.manifiestos_resumen_mes_aerolinea (
        anio, mes, aerolinea, aerolinea_codigo, es_carga, direccion,
        manifiestos, operaciones, operaciones_canceladas, operaciones_capturadas,
        pax, equipaje_kg, carga_kg, carga_nacional_kg, carga_internacional_kg, correo_kg)
    SELECT anio, mes, aerolinea, aerolinea_codigo, es_carga, direccion,
           count(*), count(*) FILTER (WHERE es_operacion),
           count(*) FILTER (WHERE es_operacion AND cancelado),
           count(*) FILTER (WHERE es_operacion AND capturado),
           coalesce(sum(pax), 0), coalesce(sum(equipaje_kg), 0), coalesce(sum(carga_kg), 0),
           coalesce(sum(carga_nacional_kg), 0), coalesce(sum(carga_internacional_kg), 0),
           coalesce(sum(correo_kg), 0)
      FROM pg_temp._mh_periodo
     GROUP BY 1, 2, 3, 4, 5, 6;

    INSERT INTO public.manifiestos_resumen_mes_destino (
        anio, mes, destino, destino_ciudad, nacional_internacional, es_carga, direccion,
        manifiestos, operaciones, operaciones_canceladas, operaciones_capturadas,
        pax, equipaje_kg, carga_kg, carga_nacional_kg, carga_internacional_kg, correo_kg)
    SELECT anio, mes, destino, destino_ciudad, nacional_internacional, es_carga, direccion,
           count(*), count(*) FILTER (WHERE es_operacion),
           count(*) FILTER (WHERE es_operacion AND cancelado),
           count(*) FILTER (WHERE es_operacion AND capturado),
           coalesce(sum(pax), 0), coalesce(sum(equipaje_kg), 0), coalesce(sum(carga_kg), 0),
           coalesce(sum(carga_nacional_kg), 0), coalesce(sum(carga_internacional_kg), 0),
           coalesce(sum(correo_kg), 0)
      FROM pg_temp._mh_periodo
     GROUP BY 1, 2, 3, 4, 5, 6, 7;

    INSERT INTO public.manifiestos_resumen_mes_aerolinea_destino (
        anio, mes, aerolinea, aerolinea_codigo, destino, destino_ciudad, nacional_internacional,
        es_carga, direccion,
        manifiestos, operaciones, operaciones_canceladas, operaciones_capturadas,
        pax, equipaje_kg, carga_kg, carga_nacional_kg, carga_internacional_kg, correo_kg)
    SELECT anio, mes, aerolinea, aerolinea_codigo, destino, destino_ciudad, nacional_internacional,
           es_carga, direccion,
           count(*), count(*) FILTER (WHERE es_operacion),
           count(*) FILTER (WHERE es_operacion AND cancelado),
           count(*) FILTER (WHERE es_operacion AND capturado),
           coalesce(sum(pax), 0), coalesce(sum(equipaje_kg), 0), coalesce(sum(carga_kg), 0),
           coalesce(sum(carga_nacional_kg), 0), coalesce(sum(carga_internacional_kg), 0),
           coalesce(sum(correo_kg), 0)
      FROM pg_temp._mh_periodo
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

    DROP TABLE IF EXISTS pg_temp._mh_periodo;
    RETURN cardinality(v_meses);
END;
$$;

-- -----------------------------------------------------------------------------
-- 10) _mh_cargar(fuente, desde, hasta) — trae de UNA fuente los manifiestos
--     cuya FECHA cae en [desde, hasta] (hasta NULL = sin límite), los
--     normaliza y los guarda en manifiestos_hechos.
--
--     · También vuelve a leer las filas ya guardadas en esa ventana: si a un
--       manifiesto le cambiaron la FECHA, se actualiza en vez de quedarse
--       con la fecha vieja; si ya no existe (o ya no le toca a esta fuente),
--       se borra.
--     · Solo reescribe las filas cuya firma cambió, y solo rehace los
--       resúmenes de los meses que se tocaron.
--     · No toma el advisory lock: lo toman quienes la llaman.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mh_cargar(
    p_fuente     text,
    p_desde      date,
    p_hasta      date DEFAULT NULL,
    p_resumenes  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
-- Las auxiliares de 010/023 llevan bloque EXCEPTION y están marcadas
-- PARALLEL SAFE: en un plan paralelo abortan con "cannot start commands
-- during a parallel operation" (mismo motivo que en 033-045).
SET max_parallel_workers_per_gather = 0
-- La firma md5 incluye horas: con la zona fija sale igual desde pg_cron que
-- desde el editor SQL, y no se reescriben filas que no cambiaron.
SET TimeZone = 'UTC'
AS $$
DECLARE
    v_hasta     date := coalesce(p_hasta, DATE '9999-12-31');
    v_meses     date[];
    v_leidas    bigint;
    v_borradas  bigint;
    v_escritas  bigint;
    v_meses_n   integer := 0;
BEGIN
    IF p_fuente IS NULL OR p_fuente NOT IN ('MAESTRA', 'CONCILIACION') THEN
        RAISE EXCEPTION 'Fuente inválida: % (MAESTRA o CONCILIACION).', p_fuente;
    END IF;
    IF p_desde IS NULL OR v_hasta < p_desde THEN
        RAISE EXCEPTION 'Ventana inválida: % a %.', p_desde, p_hasta;
    END IF;

    DROP TABLE IF EXISTS pg_temp._mh_ids, pg_temp._mh_stage, pg_temp._mh_aer,
                         pg_temp._mh_des, pg_temp._mh_mat, pg_temp._mh_nuevo;

    -- Lo que ya está guardado en la ventana.
    CREATE TEMP TABLE _mh_ids ON COMMIT DROP AS
    SELECT h.id_origen, h.fecha_reporte, h.firma
      FROM public.manifiestos_hechos h
     WHERE h.fuente = p_fuente
       AND h.fecha_operacion BETWEEN p_desde AND v_hasta;
    CREATE UNIQUE INDEX ON pg_temp._mh_ids (id_origen);

    CREATE TEMP TABLE _mh_stage (
        id_origen bigint PRIMARY KEY, fecha_operacion date, fecha_cierre date, fecha_reporte date,
        direccion text, tipo_manifiesto text, aerolinea_texto text, tipo_reporte text,
        cierre_es_carga boolean, tipo_operacion text, destino_texto text, numero_vuelo text,
        aeronave text, matricula text, slot_asignado timestamptz, hora_operacion timestamptz,
        hora_recepcion timestamptz, capturado boolean, puntualidad text, demora_15_min text,
        codigo_demora text, pax numeric, equipaje_kg numeric, carga_kg numeric,
        carga_nacional_kg numeric, carga_internacional_kg numeric, correo_kg numeric,
        pax_infantes numeric, pax_transitos numeric, pax_conexiones numeric,
        pax_exentos numeric, pax_pagan_tua numeric
    ) ON COMMIT DROP;

    IF p_fuente = 'MAESTRA' THEN
        INSERT INTO pg_temp._mh_stage
        SELECT m.id, f.fecha_operacion, f.fecha_cierre, coalesce(f.fecha_cierre, f.fecha_operacion),
               public._aifa_manifest_direction(m."TIPO DE MANIFIESTO"),
               nullif(upper(btrim(m."TIPO DE MANIFIESTO")), ''),
               nullif(btrim(m."AEROLINEA"), ''),
               m.tipo_reporte,
               NULL::boolean,
               nullif(btrim(m."TIPO DE OPERACIÓN"), ''),
               nullif(btrim(m."DESTINO / ORIGEN"), ''),
               nullif(btrim(m."# DE VUELO"), ''),
               nullif(btrim(m."AERONAVE"), ''),
               nullif(upper(btrim(m."MATRÍCULA")), ''),
               public._aifa_parse_manifest_ts(m."SLOT ASIGNADO", f.fecha_operacion),
               public._aifa_parse_manifest_ts(m."HR. DE OPERACIÓN", f.fecha_operacion),
               public._aifa_parse_manifest_ts(m."HR. DE RECEPCIÓN", f.fecha_operacion),
               nullif(btrim(m."HR. DE RECEPCIÓN"), '') IS NOT NULL,
               nullif(btrim(m."PUNTUALIDAD / CANCELACIÓN"), ''),
               nullif(btrim(m."DEMORA +- 15 MIN."), ''),
               nullif(btrim(m."CÓDIGO DEMORA"), ''),
               public._aifa_safe_numeric(m."TOTAL PAX"::text),
               public._aifa_safe_numeric(m."KGS. DE EQUIPAJE"::text),
               public._aifa_safe_numeric(m."KG DE CARGA TOTAL"::text),
               public._aifa_safe_numeric(m."KGS. DE CARGA NACIONAL"::text),
               public._aifa_safe_numeric(m."KGS. DE CARGA INTERNACIONAL"::text),
               public._aifa_safe_numeric(m."CORREO"::text),
               public._aifa_safe_numeric(m."INFANTES"::text),
               public._aifa_safe_numeric(m."TRANSITOS"::text),
               public._aifa_safe_numeric(m."CONEXIONES"::text),
               public._aifa_safe_numeric(m."TOTAL EXENTOS"::text),
               public._aifa_safe_numeric(m."PAX QUE PAGAN TUA"::text)
          FROM public.maestra_manifiestos m
         CROSS JOIN LATERAL (
               SELECT public._aifa_parse_manifest_date(m."FECHA"::text)        AS fecha_operacion,
                      public._aifa_fecha_cierre(m."CIERRE SUBSECRETARIA"::text) AS fecha_cierre
         ) f
         WHERE f.fecha_operacion IS NOT NULL
           AND f.fecha_operacion < DATE '2026-01-01'
           AND (f.fecha_operacion BETWEEN p_desde AND v_hasta
                OR m.id IN (SELECT i.id_origen FROM pg_temp._mh_ids i));
    ELSE
        INSERT INTO pg_temp._mh_stage
        SELECT c.id, f.fecha_operacion, f.fecha_cierre, coalesce(f.fecha_cierre, f.fecha_operacion),
               public._aifa_manifest_direction(c."TIPO DE MANIFIESTO"::text),
               nullif(upper(btrim(c."TIPO DE MANIFIESTO"::text)), ''),
               nullif(btrim(c."AEROLINEA"::text), ''),
               NULL::text,
               c.cierre_es_carga_reportado,
               nullif(btrim(c."TIPO DE OPERACIÓN"::text), ''),
               nullif(btrim(c."DESTINO / ORIGEN"::text), ''),
               nullif(btrim(c."# DE VUELO"::text), ''),
               nullif(btrim(c."AERONAVE"::text), ''),
               nullif(upper(btrim(c."MATRÍCULA"::text)), ''),
               public._aifa_parse_manifest_ts(c."SLOT ASIGNADO"::text, f.fecha_operacion),
               public._aifa_parse_manifest_ts(c."HR. DE OPERACIÓN"::text, f.fecha_operacion),
               public._aifa_parse_manifest_ts(c."HR. DE RECEPCIÓN"::text, f.fecha_operacion),
               nullif(btrim(c."HR. DE RECEPCIÓN"::text), '') IS NOT NULL,
               nullif(btrim(c."PUNTUALIDAD / CANCELACIÓN"::text), ''),
               nullif(btrim(c."DEMORA +- 15 MIN."::text), ''),
               nullif(btrim(c."CÓDIGO DEMORA"::text), ''),
               public._aifa_safe_numeric(c."TOTAL PAX"::text),
               public._aifa_safe_numeric(c."KGS. DE EQUIPAJE"::text),
               public._aifa_safe_numeric(c."KG DE CARGA TOTAL"::text),
               public._aifa_safe_numeric(c."KGS. DE CARGA NACIONAL"::text),
               public._aifa_safe_numeric(c."KGS. DE CARGA INTERNACIONAL"::text),
               public._aifa_safe_numeric(c."CORREO"::text),
               public._aifa_safe_numeric(c."INFANTES"::text),
               public._aifa_safe_numeric(c."TRANSITOS"::text),
               public._aifa_safe_numeric(c."CONEXIONES"::text),
               public._aifa_safe_numeric(c."TOTAL EXENTOS"::text),
               public._aifa_safe_numeric(c."PAX QUE PAGAN TUA"::text)
          FROM public."Conciliación Manifiestos" c
         CROSS JOIN LATERAL (
               SELECT coalesce(c."_portal_flight_date"::date,
                               public._aifa_parse_manifest_date(c."FECHA"::text)) AS fecha_operacion,
                      public._aifa_fecha_cierre(c."CIERRE SUBSECRETARIA"::text) AS fecha_cierre
         ) f
         -- El primer renglón deja usar el índice de _portal_flight_date; el
         -- filtro exacto es el de abajo.
         WHERE (c."_portal_flight_date" BETWEEN p_desde AND v_hasta
                OR c."_portal_flight_date" IS NULL
                OR c.id IN (SELECT i.id_origen FROM pg_temp._mh_ids i))
           AND f.fecha_operacion IS NOT NULL
           AND f.fecha_operacion >= DATE '2026-01-01'
           AND (f.fecha_operacion BETWEEN p_desde AND v_hasta
                OR c.id IN (SELECT i.id_origen FROM pg_temp._mh_ids i));
    END IF;
    GET DIAGNOSTICS v_leidas = ROW_COUNT;

    -- Aerolíneas, destinos y matrículas: se resuelven UNA vez por valor
    -- distinto, con las mismas claves (y el mismo orden de desempate) que
    -- aifa_resolver_aerolinea() / aifa_resolver_destino(). Los catálogos se
    -- copian primero a tablas temporales para no recalcular sus claves en
    -- cada comparación, y cada criterio va en su propio join por igualdad.
    DROP TABLE IF EXISTS pg_temp._mh_cat_aer, pg_temp._mh_cat_ap;
    CREATE TEMP TABLE _mh_cat_aer ON COMMIT DROP AS SELECT * FROM public.v_aifa_aerolineas_claves;
    CREATE TEMP TABLE _mh_cat_ap  ON COMMIT DROP AS SELECT * FROM public.v_aifa_aeropuertos_claves;

    CREATE TEMP TABLE _mh_aer ON COMMIT DROP AS
    WITH t AS (
        SELECT DISTINCT s.aerolinea_texto AS txt,
               upper(s.aerolinea_texto) AS up,
               public._aifa_norm_texto(s.aerolinea_texto) AS norm
          FROM pg_temp._mh_stage s
         WHERE s.aerolinea_texto IS NOT NULL
    ), cand AS (
        SELECT t.txt, 1 AS prioridad, k.id, k.name, k.iata, k.types
          FROM t JOIN pg_temp._mh_cat_aer k ON k.tipo_clave = 'iata' AND k.clave = t.up
        UNION ALL
        SELECT t.txt, 2, k.id, k.name, k.iata, k.types
          FROM t JOIN pg_temp._mh_cat_aer k ON k.tipo_clave = 'nombre' AND k.clave = t.norm
    )
    SELECT DISTINCT ON (t.txt) t.txt, c.id AS catalogo_id, c.name AS nombre, c.iata, c.types
      FROM t LEFT JOIN cand c ON c.txt = t.txt
     ORDER BY t.txt, c.prioridad NULLS LAST, c.id;

    CREATE TEMP TABLE _mh_des ON COMMIT DROP AS
    WITH t AS (
        SELECT DISTINCT s.destino_texto AS txt, s.direccion AS dir,
               upper(s.destino_texto) AS up,
               public._aifa_norm_texto(s.destino_texto) AS norm,
               CASE WHEN upper(s.destino_texto) ~ '[^A-Z0-9 ]'
                    THEN public._aifa_route_endpoint(s.destino_texto, coalesce(s.direccion, 'D')) END AS ruta
          FROM pg_temp._mh_stage s
         WHERE s.destino_texto IS NOT NULL
    ), cand AS (
        SELECT t.txt, t.dir, 1 AS prioridad, k.iata, k.ciudad, k.pais
          FROM t JOIN pg_temp._mh_cat_ap k ON k.tipo_clave = 'iata' AND k.clave = t.up
        UNION ALL
        SELECT t.txt, t.dir, 2, k.iata, k.ciudad, k.pais
          FROM t JOIN pg_temp._mh_cat_ap k ON k.tipo_clave = 'ciudad' AND k.clave = t.norm
        UNION ALL
        SELECT t.txt, t.dir, 3, k.iata, k.ciudad, k.pais
          FROM t JOIN pg_temp._mh_cat_ap k ON k.tipo_clave = 'iata' AND k.clave = t.ruta
    )
    SELECT DISTINCT ON (t.txt, t.dir) t.txt, t.dir,
           coalesce(c.iata, t.up)    AS codigo,
           coalesce(c.ciudad, t.txt) AS ciudad,
           c.pais,
           (c.iata IS NOT NULL)      AS resuelto
      FROM t LEFT JOIN cand c ON c.txt = t.txt AND c.dir IS NOT DISTINCT FROM t.dir
     ORDER BY t.txt, t.dir, c.prioridad NULLS LAST, c.iata;

    CREATE TEMP TABLE _mh_mat ON COMMIT DROP AS
    SELECT DISTINCT ON (upper(btrim(mm.matricula))) upper(btrim(mm.matricula)) AS matricula, mm.pasajeros
      FROM public.matriculas_manifiestos mm
     WHERE mm.pasajeros > 0
       AND upper(btrim(mm.matricula)) IN (SELECT s.matricula FROM pg_temp._mh_stage s WHERE s.matricula IS NOT NULL)
     ORDER BY upper(btrim(mm.matricula)), mm.id DESC;

    -- Filas ya normalizadas, con su firma.
    CREATE TEMP TABLE _mh_nuevo ON COMMIT DROP AS
    SELECT x.*, md5(x::text) AS firma
      FROM (
        SELECT
            p_fuente                                             AS fuente,
            s.id_origen,
            s.fecha_operacion,
            s.fecha_cierre,
            s.fecha_reporte,
            extract(year  FROM s.fecha_reporte)::smallint        AS anio,
            extract(month FROM s.fecha_reporte)::smallint        AS mes,
            extract(day   FROM s.fecha_reporte)::smallint        AS dia,
            s.direccion,
            s.tipo_manifiesto,
            s.aerolinea_texto,
            coalesce(a.nombre, public._aifa_aerolinea_por_omision(s.aerolinea_texto), s.aerolinea_texto) AS aerolinea,
            coalesce(a.iata, CASE WHEN public._aifa_aerolinea_por_omision(s.aerolinea_texto) IS NOT NULL
                                  THEN upper(s.aerolinea_texto) END)  AS aerolinea_codigo,
            a.catalogo_id                                        AS aerolinea_catalogo_id,
            (s.aerolinea_texto IS NOT NULL)                      AS es_operacion,
            CASE WHEN p_fuente = 'MAESTRA' THEN upper(coalesce(s.tipo_reporte, '')) = 'CARGA'
                 ELSE cl.motivo LIKE '%\_carga' END              AS es_carga,
            CASE WHEN p_fuente = 'MAESTRA' THEN 'tipo_reporte_' || lower(coalesce(s.tipo_reporte, 'sin_dato'))
                 ELSE cl.motivo END                              AS clasificacion_origen,
            s.tipo_operacion,
            s.destino_texto,
            d.codigo                                             AS destino,
            d.ciudad                                             AS destino_ciudad,
            d.pais                                               AS destino_pais,
            coalesce(d.resuelto, false)                          AS destino_resuelto,
            public._aifa_nacional_internacional(s.tipo_operacion, d.codigo, d.pais) AS nacional_internacional,
            CASE
                WHEN public._aifa_norm_texto(s.tipo_operacion) LIKE 'nac%'
                  OR public._aifa_norm_texto(s.tipo_operacion) LIKE 'int%' THEN 'declarado'
                WHEN public._aifa_nacional_internacional(NULL, d.codigo, d.pais) IS NOT NULL THEN 'catalogo'
                ELSE 'sin_determinar'
            END                                                  AS nacint_origen,
            s.numero_vuelo,
            s.aeronave,
            s.matricula,
            mt.pasajeros                                         AS capacidad_pax,
            s.slot_asignado,
            s.hora_operacion,
            s.hora_recepcion,
            sl.minutos                                           AS minutos_vs_slot,
            coalesce(
                CASE
                    WHEN sl.minutos IS NULL THEN NULL
                    WHEN sl.minutos < -15 THEN 'ANTICIPADO'
                    WHEN sl.minutos <= -1 THEN 'ANTES'
                    WHEN sl.minutos = 0   THEN 'EN TIEMPO'
                    WHEN sl.minutos <= 15 THEN 'DESPUÉS'
                    ELSE 'DEMORA'
                END,
                CASE public._estadistica_norm(s.puntualidad)
                    WHEN 'ANTICIPADO' THEN 'ANTICIPADO'
                    WHEN 'ANTES'      THEN 'ANTES'
                    WHEN 'ENTIEMPO'   THEN 'EN TIEMPO'
                    WHEN 'DESPUES'    THEN 'DESPUÉS'
                    WHEN 'DEMORA'     THEN 'DEMORA'
                    WHEN 'DEMORADO'   THEN 'DEMORA'
                END)                                             AS clasificacion_slot,
            s.puntualidad,
            s.demora_15_min,
            s.codigo_demora,
            (upper(coalesce(s.puntualidad, '')) LIKE '%CANCEL%') AS cancelado,
            s.capturado,
            s.pax,
            s.equipaje_kg,
            s.carga_kg,
            s.carga_nacional_kg,
            s.carga_internacional_kg,
            s.correo_kg,
            s.pax_infantes,
            s.pax_transitos,
            s.pax_conexiones,
            s.pax_exentos,
            s.pax_pagan_tua
          FROM pg_temp._mh_stage s
          LEFT JOIN pg_temp._mh_aer a ON a.txt = s.aerolinea_texto
          LEFT JOIN pg_temp._mh_des d ON d.txt = s.destino_texto AND d.dir IS NOT DISTINCT FROM s.direccion
          LEFT JOIN pg_temp._mh_mat mt ON mt.matricula = s.matricula
          CROSS JOIN LATERAL (
              SELECT CASE WHEN p_fuente = 'CONCILIACION' THEN
                         public.aifa_regla_carga(
                             a.types,
                             coalesce(a.nombre, public._aifa_aerolinea_por_omision(s.aerolinea_texto), s.aerolinea_texto),
                             s.tipo_operacion,
                             s.cierre_es_carga)
                     END AS motivo
          ) cl
          CROSS JOIN LATERAL (
              SELECT CASE
                         WHEN s.slot_asignado IS NOT NULL AND s.hora_operacion IS NOT NULL
                          AND extract(epoch FROM (s.hora_operacion - s.slot_asignado)) / 60.0 BETWEEN -720 AND 2880
                         THEN round(extract(epoch FROM (s.hora_operacion - s.slot_asignado)) / 60.0)
                     END AS minutos
          ) sl
      ) x;

    -- Meses que cambian: los de la fecha vieja y los de la nueva de cada fila
    -- borrada, nueva o con firma distinta.
    SELECT array_agg(DISTINCT date_trunc('month', z.f)::date) INTO v_meses
      FROM (
        SELECT i.fecha_reporte AS f
          FROM pg_temp._mh_ids i
         WHERE NOT EXISTS (SELECT 1 FROM pg_temp._mh_nuevo n WHERE n.id_origen = i.id_origen)
        UNION
        SELECT h.fecha_reporte
          FROM pg_temp._mh_nuevo n
          JOIN public.manifiestos_hechos h ON h.fuente = p_fuente AND h.id_origen = n.id_origen
         WHERE h.firma IS DISTINCT FROM n.firma
        UNION
        SELECT n.fecha_reporte
          FROM pg_temp._mh_nuevo n
          LEFT JOIN public.manifiestos_hechos h ON h.fuente = p_fuente AND h.id_origen = n.id_origen
         WHERE h.firma IS DISTINCT FROM n.firma
      ) z;

    DELETE FROM public.manifiestos_hechos h
     USING pg_temp._mh_ids i
     WHERE h.fuente = p_fuente
       AND h.id_origen = i.id_origen
       AND NOT EXISTS (SELECT 1 FROM pg_temp._mh_nuevo n WHERE n.id_origen = i.id_origen);
    GET DIAGNOSTICS v_borradas = ROW_COUNT;

    INSERT INTO public.manifiestos_hechos AS h (
        fuente, id_origen, fecha_operacion, fecha_cierre, fecha_reporte, anio, mes, dia,
        direccion, tipo_manifiesto, aerolinea_texto, aerolinea, aerolinea_codigo,
        aerolinea_catalogo_id, es_operacion, es_carga, clasificacion_origen, tipo_operacion,
        destino_texto, destino, destino_ciudad, destino_pais, destino_resuelto,
        nacional_internacional, nacint_origen, numero_vuelo, aeronave, matricula, capacidad_pax,
        slot_asignado, hora_operacion, hora_recepcion, minutos_vs_slot, clasificacion_slot,
        puntualidad, demora_15_min, codigo_demora, cancelado, capturado, pax, equipaje_kg,
        carga_kg, carga_nacional_kg, carga_internacional_kg, correo_kg, pax_infantes,
        pax_transitos, pax_conexiones, pax_exentos, pax_pagan_tua, firma, actualizado_at)
    SELECT
        n.fuente, n.id_origen, n.fecha_operacion, n.fecha_cierre, n.fecha_reporte, n.anio, n.mes, n.dia,
        n.direccion, n.tipo_manifiesto, n.aerolinea_texto, n.aerolinea, n.aerolinea_codigo,
        n.aerolinea_catalogo_id, n.es_operacion, n.es_carga, n.clasificacion_origen, n.tipo_operacion,
        n.destino_texto, n.destino, n.destino_ciudad, n.destino_pais, n.destino_resuelto,
        n.nacional_internacional, n.nacint_origen, n.numero_vuelo, n.aeronave, n.matricula, n.capacidad_pax,
        n.slot_asignado, n.hora_operacion, n.hora_recepcion, n.minutos_vs_slot, n.clasificacion_slot,
        n.puntualidad, n.demora_15_min, n.codigo_demora, n.cancelado, n.capturado, n.pax, n.equipaje_kg,
        n.carga_kg, n.carga_nacional_kg, n.carga_internacional_kg, n.correo_kg, n.pax_infantes,
        n.pax_transitos, n.pax_conexiones, n.pax_exentos, n.pax_pagan_tua, n.firma, now()
      FROM pg_temp._mh_nuevo n
    ON CONFLICT (fuente, id_origen) DO UPDATE SET
        fecha_operacion = EXCLUDED.fecha_operacion, fecha_cierre = EXCLUDED.fecha_cierre,
        fecha_reporte = EXCLUDED.fecha_reporte, anio = EXCLUDED.anio, mes = EXCLUDED.mes, dia = EXCLUDED.dia,
        direccion = EXCLUDED.direccion, tipo_manifiesto = EXCLUDED.tipo_manifiesto,
        aerolinea_texto = EXCLUDED.aerolinea_texto, aerolinea = EXCLUDED.aerolinea,
        aerolinea_codigo = EXCLUDED.aerolinea_codigo, aerolinea_catalogo_id = EXCLUDED.aerolinea_catalogo_id,
        es_operacion = EXCLUDED.es_operacion, es_carga = EXCLUDED.es_carga,
        clasificacion_origen = EXCLUDED.clasificacion_origen, tipo_operacion = EXCLUDED.tipo_operacion,
        destino_texto = EXCLUDED.destino_texto, destino = EXCLUDED.destino,
        destino_ciudad = EXCLUDED.destino_ciudad, destino_pais = EXCLUDED.destino_pais,
        destino_resuelto = EXCLUDED.destino_resuelto, nacional_internacional = EXCLUDED.nacional_internacional,
        nacint_origen = EXCLUDED.nacint_origen, numero_vuelo = EXCLUDED.numero_vuelo,
        aeronave = EXCLUDED.aeronave, matricula = EXCLUDED.matricula, capacidad_pax = EXCLUDED.capacidad_pax,
        slot_asignado = EXCLUDED.slot_asignado, hora_operacion = EXCLUDED.hora_operacion,
        hora_recepcion = EXCLUDED.hora_recepcion, minutos_vs_slot = EXCLUDED.minutos_vs_slot,
        clasificacion_slot = EXCLUDED.clasificacion_slot, puntualidad = EXCLUDED.puntualidad,
        demora_15_min = EXCLUDED.demora_15_min, codigo_demora = EXCLUDED.codigo_demora,
        cancelado = EXCLUDED.cancelado, capturado = EXCLUDED.capturado, pax = EXCLUDED.pax,
        equipaje_kg = EXCLUDED.equipaje_kg, carga_kg = EXCLUDED.carga_kg,
        carga_nacional_kg = EXCLUDED.carga_nacional_kg, carga_internacional_kg = EXCLUDED.carga_internacional_kg,
        correo_kg = EXCLUDED.correo_kg, pax_infantes = EXCLUDED.pax_infantes,
        pax_transitos = EXCLUDED.pax_transitos, pax_conexiones = EXCLUDED.pax_conexiones,
        pax_exentos = EXCLUDED.pax_exentos, pax_pagan_tua = EXCLUDED.pax_pagan_tua,
        firma = EXCLUDED.firma, actualizado_at = now()
     WHERE h.firma IS DISTINCT FROM EXCLUDED.firma;
    GET DIAGNOSTICS v_escritas = ROW_COUNT;

    IF p_resumenes AND v_meses IS NOT NULL THEN
        v_meses_n := public._mh_recalcular_resumenes(v_meses);
    END IF;

    DROP TABLE IF EXISTS pg_temp._mh_ids, pg_temp._mh_stage, pg_temp._mh_aer,
                         pg_temp._mh_des, pg_temp._mh_mat, pg_temp._mh_nuevo,
                         pg_temp._mh_cat_aer, pg_temp._mh_cat_ap;

    RETURN jsonb_build_object(
        'fuente', p_fuente, 'desde', p_desde, 'hasta', p_hasta,
        'leidas', v_leidas, 'escritas', v_escritas, 'borradas', v_borradas,
        'meses_resumen', v_meses_n);
END;
$$;

-- -----------------------------------------------------------------------------
-- 11) Refresco programado: Conciliación, últimos N días (60 por omisión).
--     Lo agenda la 060 cada 10 minutos. Si otro refresco va corriendo, no se
--     encima: se sale y lo deja terminar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manifiestos_hechos_refrescar(p_dias integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET max_parallel_workers_per_gather = 0
AS $$
DECLARE
    v_inicio timestamptz := clock_timestamp();
    v_desde  date;
    v_r      jsonb;
    v_ms     integer;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('manifiestos_hechos')::bigint) THEN
        RETURN jsonb_build_object('omitido', 'otro refresco en curso');
    END IF;

    v_desde := greatest((now() AT TIME ZONE 'America/Mexico_City')::date - greatest(coalesce(p_dias, 60), 1),
                        DATE '2026-01-01');
    v_r := public._mh_cargar('CONCILIACION', v_desde, NULL, true);
    v_ms := (extract(epoch FROM clock_timestamp() - v_inicio) * 1000)::int;

    INSERT INTO public.manifiestos_hechos_refresco (id, refrescado_at, duracion_ms, detalle)
    VALUES (true, now(), v_ms, v_r)
    ON CONFLICT (id) DO UPDATE
        SET refrescado_at = excluded.refrescado_at, duracion_ms = excluded.duracion_ms,
            detalle = excluded.detalle;

    -- Las etiquetas "Datos al …" de Estadística y del Informe.
    IF to_regclass('public.estadistica_refresco') IS NOT NULL THEN
        UPDATE public.estadistica_refresco
           SET refrescado_at = now(), duracion_ms = v_ms
         WHERE id = 1;
    END IF;
    IF to_regclass('public.informe_estadistico_refresco') IS NOT NULL THEN
        INSERT INTO public.informe_estadistico_refresco (id, refrescado_at, duracion_ms)
        VALUES (true, now(), v_ms)
        ON CONFLICT (id) DO UPDATE
            SET refrescado_at = excluded.refrescado_at, duracion_ms = excluded.duracion_ms;
    END IF;

    RETURN v_r || jsonb_build_object('duracion_ms', v_ms);
END;
$$;

-- -----------------------------------------------------------------------------
-- 12) Rehacer un mes a mano (por FECHA de operación). Antes de 2026 lo toma de
--     maestra_manifiestos; desde 2026, de Conciliación. Espera su turno si hay
--     un refresco corriendo.
--         SELECT public.manifiestos_hechos_rehacer_mes(2026, 2);
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manifiestos_hechos_rehacer_mes(p_anio integer, p_mes integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET max_parallel_workers_per_gather = 0
AS $$
DECLARE
    v_ini date;
    v_fin date;
BEGIN
    IF p_anio IS NULL OR p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'Mes inválido: %-%', p_anio, p_mes;
    END IF;
    v_ini := make_date(p_anio, p_mes, 1);
    v_fin := (v_ini + interval '1 month - 1 day')::date;
    PERFORM pg_advisory_xact_lock(hashtext('manifiestos_hechos')::bigint);
    RETURN public._mh_cargar(CASE WHEN v_ini < DATE '2026-01-01' THEN 'MAESTRA' ELSE 'CONCILIACION' END,
                             v_ini, v_fin, true);
END;
$$;

REVOKE ALL ON FUNCTION public._mh_recalcular_resumenes(date[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mh_cargar(text, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manifiestos_hechos_refrescar(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manifiestos_hechos_rehacer_mes(integer, integer) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- Comprobación rápida (solo lectura): todo creado y vacío.
-- =============================================================================
SELECT 'manifiestos_hechos' AS objeto, count(*) AS filas FROM public.manifiestos_hechos
UNION ALL SELECT 'manifiestos_resumen_dia', count(*) FROM public.manifiestos_resumen_dia
UNION ALL SELECT 'avisos activos', count(*) FROM public.manifiestos_avisos_periodo WHERE activo
UNION ALL SELECT 'regla: VB pasajeros = ' || public.aifa_regla_carga('{pasajeros}', 'VIVA AEROBUS'), 1
UNION ALL SELECT 'regla: sin catálogo, Cargolux = ' || public.aifa_regla_carga(NULL, 'CARGOLUX'), 1;

-- Siguiente: 059_manifiestos_hechos_llenado.sql
