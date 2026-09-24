-- =============================================================================
-- 046 — Módulo de Aviación General / FBO (GAG · Subdirección de Servicios Conexos)
--
-- QUÉ ES
--
--   La capa de servicio del módulo de captura y consulta del histórico de
--   Aviación General. Las DOS tablas del diccionario de datos —
--   public.aviacion_general_operaciones y su gemela de auditoría— YA EXISTEN
--   en la base (se crearon fuera de este repositorio) y esta migración NO las
--   vuelve a crear ni les cambia una sola columna.
--
--   Lo que agrega es lo que faltaba para poder operarlas desde el portal:
--   índices de búsqueda, y ocho funciones que concentran en PostgreSQL las
--   reglas que de otro modo acabarían repetidas —y divergiendo— en cada
--   pantalla del navegador.
--
-- POR QUÉ FUNCIONES Y NO CONSULTAS SUELTAS
--
--   Misma lección que dejó el módulo estadístico (migraciones 038 y 040): si
--   "cuántas operaciones hubo en marzo" se calcula en JavaScript, cada pantalla
--   termina con su propia definición y ninguna coincide. Aquí el resumen, el
--   catálogo de filtros, la importación, la validación, la baja lógica, la
--   detección de capturas repetidas y el enlace llegada↔salida son UNA función
--   cada uno. El navegador recibe renglones ya agregados —decenas, no miles— y
--   sólo los pinta.
--
--   El listado paginado de movimientos es la excepción deliberada: ése sí va
--   por PostgREST directo (select + range + count), porque es exactamente para
--   lo que PostgREST sirve y así aprovecha los índices de abajo sin una capa
--   intermedia que mantener.
--
-- ESTADO DE LA BASE VERIFICADO CONTRA LA BASE EN VIVO (2026-09-11)
--
--   Nada de esto se dio por supuesto ni se tomó del diccionario: se consultó.
--
--     · Las 37 columnas del diccionario existen tal cual.
--     · aviacion_general_operaciones_auditoria existe.
--     · pax_ag es COLUMNA GENERADA: no se puede insertar ni actualizar. El
--       cliente jamás debe enviarla.
--     · Restricciones CHECK vigentes: chk_ag_tipo_operacion,
--       chk_ag_ambito_operacion, chk_ag_tipo_fuente, chk_ag_estado_validacion,
--       chk_ag_estatus_registro, chk_ag_adultos.
--     · Valores por omisión: tipo_fuente=CAPTURA_MANUAL,
--       estado_validacion=PENDIENTE, estatus_registro=ACTIVO, version=1.
--
--   EL HISTÓRICO YA ESTÁ CARGADO: 10,396 filas, del 2022-03-20 al 2026-08-31,
--   importadas desde "2022 FBO.xlsx" y archivos hermanos. Todas ACTIVO y todas
--   PENDIENTE de validación. 5,209 llegadas y 5,187 salidas; 7,786 nacionales
--   y 2,610 internacionales. 456 movimientos ya traen enlazada su pareja.
--
--   TRES HALLAZGOS DE ESOS DATOS QUE CONTRADICEN AL DICCIONARIO, y que esta
--   migración obedece —manda la tabla, no el documento—:
--
--     1. hash_origen trae SHA-256 (64 caracteres) calculado por el proceso que
--        cargó el histórico, con una receta que este repositorio no conoce. Por
--        eso el antiduplicados de aviacion_general_importar() NO compara
--        hashes: compara la llave natural. Ver el comentario del bloque 5.
--     2. aeropuerto_origen_destino es NULO en 5,440 de las 10,396 filas (52%),
--        aunque el diccionario lo marcaba obligatorio. No se exige al importar.
--     3. adultos es NULO en 2,670 filas e infantes en 3,080. Tampoco se
--        rellenan con 0 al importar: vacío significa "no se anotó".
--
-- RLS
--
--   Sigue DESACTIVADO, por decisión explícita. El bloque del final deja las
--   políticas ya redactadas y COMENTADAS para el día en que se definan los
--   perfiles de GAG. Mientras tanto el control es de interfaz
--   (window.sectionLevel('aviacion-general')), que oculta botones pero no
--   protege la tabla: cualquiera con la llave anon puede escribir. Está
--   asumido y es la razón de que las funciones se creen SECURITY INVOKER —
--   el día que se encienda RLS empiezan a respetarlo sin tocar una línea.
--
-- 100% ADITIVO. No altera tablas, columnas, triggers ni datos existentes.
--
-- MODO DE USO
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK.
--   2) Revisar el bloque VERIFICACIÓN del final y, si se ve bien, cambiar
--      ROLLBACK por COMMIT y volver a correrlo.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;


-- =============================================================================
-- 0) CONTRATO — falla temprano y con nombre y apellido
--
-- Preferible abortar aquí que crear funciones que se rompan en producción
-- contra una columna que no existe.
-- =============================================================================
DO $contrato$
DECLARE
    v_faltan text[] := '{}';
    v_col    text;
    v_esperadas text[] := ARRAY[
        'id','folio_rotacion','fecha_operacion','tipo_operacion','ambito_operacion',
        'operador','matricula','tipo_aeronave','aeropuerto_origen_destino',
        'hora_programada','hora_real','adultos','infantes','pax_ag','pax_od',
        'estado','pais','observaciones','movimiento_relacionado_id','tipo_fuente',
        'archivo_origen','hoja_origen','fila_origen','hash_origen',
        'estado_validacion','validado_por','fecha_validacion','observacion_validacion',
        'creado_por','fecha_creacion','modificado_por','fecha_modificacion','version',
        'estatus_registro','motivo_anulacion','eliminado_por','fecha_eliminacion'
    ];
BEGIN
    IF to_regclass('public.aviacion_general_operaciones') IS NULL THEN
        RAISE EXCEPTION
            'No existe public.aviacion_general_operaciones. Esta migración NO crea la tabla: se aplica sobre la que ya generó el diccionario de datos.';
    END IF;

    IF to_regclass('public.aviacion_general_operaciones_auditoria') IS NULL THEN
        RAISE EXCEPTION
            'No existe public.aviacion_general_operaciones_auditoria. El historial de cambios es parte del contrato del módulo.';
    END IF;

    FOREACH v_col IN ARRAY v_esperadas LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'aviacion_general_operaciones'
              AND column_name  = v_col
        ) THEN
            v_faltan := v_faltan || v_col;
        END IF;
    END LOOP;

    IF array_length(v_faltan, 1) > 0 THEN
        RAISE EXCEPTION
            'Faltan columnas en public.aviacion_general_operaciones: %. Revisar el diccionario de datos antes de continuar.',
            array_to_string(v_faltan, ', ');
    END IF;

    RAISE NOTICE 'Contrato verificado: las 37 columnas del diccionario están presentes.';
END
$contrato$;


-- =============================================================================
-- 1) ÍNDICES
--
-- IF NOT EXISTS en todos: el diccionario dice que ya se crearon índices por
-- fecha, matrícula, operador, rotación y aeropuerto, pero no consta su nombre
-- exacto en este repositorio. Si ya existen con otro nombre, éstos quedan como
-- duplicados baratos sobre una tabla de ~10 mil filas; si no existían, el módulo
-- los necesita. Lo que NO se hace es suponer que están y quedarse sin ellos.
-- =============================================================================

-- El filtro por rango de fechas es el de toda pantalla del módulo.
CREATE INDEX IF NOT EXISTS ix_ag_ops_fecha
    ON public.aviacion_general_operaciones (fecha_operacion DESC);

-- Listado por omisión: activos, del más reciente al más viejo.
CREATE INDEX IF NOT EXISTS ix_ag_ops_estatus_fecha
    ON public.aviacion_general_operaciones (estatus_registro, fecha_operacion DESC);

-- Búsquedas por aeronave y por operador (se comparan en mayúsculas).
CREATE INDEX IF NOT EXISTS ix_ag_ops_matricula
    ON public.aviacion_general_operaciones (upper(matricula));
CREATE INDEX IF NOT EXISTS ix_ag_ops_operador
    ON public.aviacion_general_operaciones (upper(operador));
CREATE INDEX IF NOT EXISTS ix_ag_ops_tipo_aeronave
    ON public.aviacion_general_operaciones (upper(tipo_aeronave));
CREATE INDEX IF NOT EXISTS ix_ag_ops_aeropuerto
    ON public.aviacion_general_operaciones (upper(aeropuerto_origen_destino));

-- Enlace llegada↔salida: el folio NO es único, se repite por rotación.
CREATE INDEX IF NOT EXISTS ix_ag_ops_folio_fecha
    ON public.aviacion_general_operaciones (folio_rotacion, fecha_operacion);

-- Bandeja de validación.
CREATE INDEX IF NOT EXISTS ix_ag_ops_estado_validacion
    ON public.aviacion_general_operaciones (estado_validacion)
    WHERE estatus_registro = 'ACTIVO';

-- Antiduplicados de la importación. A PROPÓSITO no es UNIQUE: si el Excel de
-- origen trae dos renglones legítimamente idénticos, un índice único abortaría
-- el lote entero. La decisión de qué hacer con un repetido se toma en
-- aviacion_general_importar(), que lo reporta y lo omite en vez de reventar.
CREATE INDEX IF NOT EXISTS ix_ag_ops_hash_origen
    ON public.aviacion_general_operaciones (hash_origen)
    WHERE hash_origen IS NOT NULL;

-- Trazabilidad de una importación concreta ("¿qué entró con este archivo?").
CREATE INDEX IF NOT EXISTS ix_ag_ops_archivo_origen
    ON public.aviacion_general_operaciones (archivo_origen)
    WHERE archivo_origen IS NOT NULL;


-- =============================================================================
-- 2) FILTROS — una sola definición de "qué filas entran"
--
-- Todas las funciones de abajo interpretan el MISMO objeto jsonb de filtros.
-- Claves reconocidas:
--   fecha_desde, fecha_hasta   (date en ISO)
--   tipo_operacion             ('LLEGADA' | 'SALIDA')
--   ambito_operacion           ('NACIONAL' | 'INTERNACIONAL')
--   operador, matricula,
--   tipo_aeronave, aeropuerto  (coincidencia parcial, sin distinguir mayúsculas)
--   estado_validacion          ('PENDIENTE' | 'VALIDADO' | 'OBSERVADO')
--   estatus_registro           (por omisión 'ACTIVO'; 'TODOS' incluye anulados)
--   texto                      (búsqueda libre sobre operador, matrícula,
--                               aeronave, aeropuerto y observaciones)
--
-- Una clave ausente, nula o vacía NO filtra. Así el cliente manda siempre el
-- objeto completo, sin armar condicionales.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_filtro_ok(
    p_fila    public.aviacion_general_operaciones,
    p_filtros jsonb
) RETURNS boolean
LANGUAGE sql
-- STABLE y no IMMUTABLE: el cuerpo convierte texto a date, y esa conversión
-- depende de DateStyle, así que no es inmutable en el sentido estricto de
-- Postgres. Prometerle IMMUTABLE sería mentirle al planificador; con STABLE
-- igual se puede alinear dentro de la consulta, que es lo que interesa.
STABLE
PARALLEL SAFE
AS $fn$
    SELECT
        (
            COALESCE(NULLIF(p_filtros->>'estatus_registro', ''), 'ACTIVO') = 'TODOS'
            OR p_fila.estatus_registro = COALESCE(NULLIF(p_filtros->>'estatus_registro', ''), 'ACTIVO')
        )
        AND (COALESCE(p_filtros->>'fecha_desde', '') = ''
             OR p_fila.fecha_operacion >= (p_filtros->>'fecha_desde')::date)
        AND (COALESCE(p_filtros->>'fecha_hasta', '') = ''
             OR p_fila.fecha_operacion <= (p_filtros->>'fecha_hasta')::date)
        AND (COALESCE(p_filtros->>'tipo_operacion', '') = ''
             OR p_fila.tipo_operacion = upper(p_filtros->>'tipo_operacion'))
        AND (COALESCE(p_filtros->>'ambito_operacion', '') = ''
             OR p_fila.ambito_operacion = upper(p_filtros->>'ambito_operacion'))
        AND (COALESCE(p_filtros->>'operador', '') = ''
             OR upper(p_fila.operador) LIKE '%' || upper(p_filtros->>'operador') || '%')
        AND (COALESCE(p_filtros->>'matricula', '') = ''
             OR upper(p_fila.matricula) LIKE '%' || upper(p_filtros->>'matricula') || '%')
        AND (COALESCE(p_filtros->>'tipo_aeronave', '') = ''
             OR upper(p_fila.tipo_aeronave) LIKE '%' || upper(p_filtros->>'tipo_aeronave') || '%')
        AND (COALESCE(p_filtros->>'aeropuerto', '') = ''
             OR upper(p_fila.aeropuerto_origen_destino) LIKE '%' || upper(p_filtros->>'aeropuerto') || '%')
        AND (COALESCE(p_filtros->>'estado_validacion', '') = ''
             OR p_fila.estado_validacion = upper(p_filtros->>'estado_validacion'))
        AND (COALESCE(p_filtros->>'texto', '') = ''
             OR upper(concat_ws(' ',
                    p_fila.operador, p_fila.matricula, p_fila.tipo_aeronave,
                    p_fila.aeropuerto_origen_destino, p_fila.observaciones))
                LIKE '%' || upper(p_filtros->>'texto') || '%');
$fn$;

COMMENT ON FUNCTION public.aviacion_general_filtro_ok(public.aviacion_general_operaciones, jsonb) IS
'Definición única de los filtros del módulo de Aviación General. La comparten el resumen, el catálogo de opciones y la validación masiva, para que todas las pantallas vean exactamente el mismo conjunto de filas.';


-- =============================================================================
-- 3) RESUMEN — todas las cifras del tablero, en un viaje
--
-- Devuelve un solo jsonb con los totales y las series ya agregadas. El
-- navegador NO descarga movimientos para sumarlos: ésta es la única definición
-- de cada métrica del módulo.
--
-- "Operaciones" = renglones que pasan el filtro. En Aviación General cada
-- movimiento (una llegada, una salida) es una operación, a diferencia del
-- módulo comercial donde una rotación son dos. Por eso el resumen reporta
-- además el conteo de rotaciones distintas (folio + fecha), que es lo que la
-- gerencia suele llamar "vuelos atendidos".
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_resumen(
    p_filtros jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH base AS (
    SELECT o.*
    FROM public.aviacion_general_operaciones o
    WHERE public.aviacion_general_filtro_ok(o, p_filtros)
)
SELECT jsonb_build_object(
    'totales', (
        SELECT jsonb_build_object(
            'movimientos',      count(*),
            'llegadas',         count(*) FILTER (WHERE tipo_operacion = 'LLEGADA'),
            'salidas',          count(*) FILTER (WHERE tipo_operacion = 'SALIDA'),
            'nacionales',       count(*) FILTER (WHERE ambito_operacion = 'NACIONAL'),
            'internacionales',  count(*) FILTER (WHERE ambito_operacion = 'INTERNACIONAL'),
            'pax',              COALESCE(sum(pax_ag), 0),
            'adultos',          COALESCE(sum(adultos), 0),
            'infantes',         COALESCE(sum(infantes), 0),
            'rotaciones',       count(DISTINCT (folio_rotacion::text || '|' || fecha_operacion::text)),
            'operadores',       count(DISTINCT upper(operador)),
            'matriculas',       count(DISTINCT upper(matricula)),
            'pendientes',       count(*) FILTER (WHERE estado_validacion = 'PENDIENTE'),
            'validados',        count(*) FILTER (WHERE estado_validacion = 'VALIDADO'),
            'observados',       count(*) FILTER (WHERE estado_validacion = 'OBSERVADO'),
            'fecha_min',        min(fecha_operacion),
            'fecha_max',        max(fecha_operacion)
        ) FROM base
    ),
    -- ── Una sola forma para todos los desgloses ─────────────────────────────
    --
    -- Primero se AGREGA en una subconsulta con columnas con nombre, y sólo
    -- después se arma el JSON con esas columnas ya calculadas.
    --
    -- La forma contraria —construir el jsonb_build_object dentro del SELECT que
    -- agrupa— parece más corta y es una trampa: la consulta queda con UNA sola
    -- columna de salida (el objeto entero), así que un GROUP BY por ordinal
    -- apunta a ese objeto, que contiene agregados, y Postgres aborta con
    -- "42803: aggregate functions are not allowed in GROUP BY". Agregando
    -- primero, el GROUP BY 1,2,3 señala columnas reales y no hay ambigüedad.
    --
    -- De paso el ORDER BY opera sobre un bigint de verdad y no sobre
    -- (x->>'movimientos')::bigint, que ordenaba bien pero a costa de convertir
    -- a texto y de vuelta en cada comparación.
    'por_mes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'periodo', periodo, 'anio', anio, 'mes', mes,
                   'movimientos', movimientos, 'llegadas', llegadas,
                   'salidas', salidas, 'pax', pax
               ) ORDER BY periodo), '[]'::jsonb)
        FROM (
            SELECT to_char(fecha_operacion, 'YYYY-MM')      AS periodo,
                   extract(year  FROM fecha_operacion)::int AS anio,
                   extract(month FROM fecha_operacion)::int AS mes,
                   count(*)                                 AS movimientos,
                   count(*) FILTER (WHERE tipo_operacion = 'LLEGADA') AS llegadas,
                   count(*) FILTER (WHERE tipo_operacion = 'SALIDA')  AS salidas,
                   COALESCE(sum(pax_ag), 0)                 AS pax
            FROM base
            GROUP BY 1, 2, 3
        ) t
    ),
    'por_ambito', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'clave', clave, 'movimientos', movimientos, 'pax', pax
               ) ORDER BY movimientos DESC), '[]'::jsonb)
        FROM (
            SELECT ambito_operacion AS clave, count(*) AS movimientos,
                   COALESCE(sum(pax_ag), 0) AS pax
            FROM base GROUP BY ambito_operacion
        ) t
    ),
    'por_tipo_operacion', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'clave', clave, 'movimientos', movimientos, 'pax', pax
               ) ORDER BY movimientos DESC), '[]'::jsonb)
        FROM (
            SELECT tipo_operacion AS clave, count(*) AS movimientos,
                   COALESCE(sum(pax_ag), 0) AS pax
            FROM base GROUP BY tipo_operacion
        ) t
    ),
    'top_operadores', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'clave', clave, 'movimientos', movimientos, 'pax', pax
               ) ORDER BY movimientos DESC), '[]'::jsonb)
        FROM (
            SELECT upper(operador) AS clave, count(*) AS movimientos,
                   COALESCE(sum(pax_ag), 0) AS pax
            FROM base GROUP BY upper(operador)
            ORDER BY count(*) DESC LIMIT 15
        ) t
    ),
    'top_aeronaves', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'clave', clave, 'movimientos', movimientos, 'pax', pax
               ) ORDER BY movimientos DESC), '[]'::jsonb)
        FROM (
            SELECT upper(tipo_aeronave) AS clave, count(*) AS movimientos,
                   COALESCE(sum(pax_ag), 0) AS pax
            FROM base GROUP BY upper(tipo_aeronave)
            ORDER BY count(*) DESC LIMIT 15
        ) t
    ),
    'top_aeropuertos', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'clave', clave, 'movimientos', movimientos, 'pax', pax
               ) ORDER BY movimientos DESC), '[]'::jsonb)
        FROM (
            SELECT upper(aeropuerto_origen_destino) AS clave, count(*) AS movimientos,
                   COALESCE(sum(pax_ag), 0) AS pax
            FROM base GROUP BY upper(aeropuerto_origen_destino)
            ORDER BY count(*) DESC LIMIT 15
        ) t
    ),
    'top_matriculas', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'clave', clave, 'movimientos', movimientos,
                   'operador', operador, 'tipo_aeronave', tipo_aeronave
               ) ORDER BY movimientos DESC), '[]'::jsonb)
        FROM (
            SELECT upper(matricula) AS clave, count(*) AS movimientos,
                   max(operador) AS operador, max(tipo_aeronave) AS tipo_aeronave
            FROM base GROUP BY upper(matricula)
            ORDER BY count(*) DESC LIMIT 15
        ) t
    )
);
$fn$;

COMMENT ON FUNCTION public.aviacion_general_resumen(jsonb) IS
'Todas las cifras del tablero de Aviación General en un solo viaje y ya agregadas en PostgreSQL. Ninguna métrica del módulo se recalcula en el navegador.';


-- =============================================================================
-- 4) OPCIONES — qué ofrecer en los desplegables de filtro
--
-- Devuelve los valores realmente presentes en la tabla, no un catálogo fijo:
-- un operador que nunca ha volado aquí no debe aparecer como opción.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_opciones()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH activos AS (
    SELECT * FROM public.aviacion_general_operaciones WHERE estatus_registro = 'ACTIVO'
)
SELECT jsonb_build_object(
    'operadores', (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM (SELECT DISTINCT upper(operador) AS v FROM activos WHERE operador <> '') t
    ),
    'matriculas', (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM (SELECT DISTINCT upper(matricula) AS v FROM activos WHERE matricula <> '') t
    ),
    'tipos_aeronave', (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM (SELECT DISTINCT upper(tipo_aeronave) AS v FROM activos WHERE tipo_aeronave <> '') t
    ),
    'aeropuertos', (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM (SELECT DISTINCT upper(aeropuerto_origen_destino) AS v FROM activos WHERE aeropuerto_origen_destino <> '') t
    ),
    'anios', (
        SELECT COALESCE(jsonb_agg(v ORDER BY v DESC), '[]'::jsonb)
        FROM (SELECT DISTINCT extract(year FROM fecha_operacion)::int AS v FROM activos) t
    ),
    'archivos', (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM (SELECT DISTINCT archivo_origen AS v FROM activos WHERE archivo_origen IS NOT NULL) t
    )
);
$fn$;

COMMENT ON FUNCTION public.aviacion_general_opciones() IS
'Valores realmente presentes en la tabla, para poblar los filtros del módulo de Aviación General.';


-- =============================================================================
-- 5) IMPORTAR — carga por lotes del histórico, transaccional y sin sorpresas
--
-- Recibe filas YA NORMALIZADAS por el cliente (js/aviacion-general/core.js:
-- mayúsculas, horas inválidas convertidas a NULL, pax_ag jamás enviado) y:
--
--   · rechaza, con número de fila y motivo, lo que no cumpla el contrato;
--   · omite lo que ya existe, comparando hash_origen —así reimportar el mismo
--     archivo dos veces no duplica nada—;
--   · inserta el resto.
--
-- Devuelve el recuento y el detalle de lo rechazado y lo omitido. Si algo
-- truena a media inserción, la transacción entera se deshace: no quedan
-- importaciones a medias que nadie sepa dónde empezaron.
--
-- p_simulacion = true hace todo el trabajo de validación y detección de
-- duplicados SIN insertar: es lo que alimenta la vista previa de la pantalla
-- de importación antes de que el usuario confirme.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_importar(
    p_filas      jsonb,
    p_archivo    text    DEFAULT NULL,
    p_hoja       text    DEFAULT NULL,
    p_simulacion boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_fila        jsonb;
    v_indice      int := 0;
    v_insertados  int := 0;
    v_duplicados  jsonb := '[]'::jsonb;
    v_rechazados  jsonb := '[]'::jsonb;
    v_hash        text;
    v_llave       text;
    v_motivo      text;
    v_fila_origen int;
    v_vistos      text[] := '{}';
BEGIN
    IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' THEN
        RAISE EXCEPTION 'aviacion_general_importar espera un arreglo JSON de filas.';
    END IF;

    FOR v_fila IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
        v_indice := v_indice + 1;
        v_motivo := NULL;
        v_fila_origen := NULLIF(v_fila->>'fila_origen', '')::int;

        -- ── Contrato mínimo. Se revisa aquí y no sólo con los CHECK de la
        --    tabla para poder decir QUÉ fila y POR QUÉ, en vez de abortar el
        --    lote con un error de Postgres que no señala el renglón.
        IF COALESCE(v_fila->>'fecha_operacion', '') = '' THEN
            v_motivo := 'Falta la fecha de operación';
        ELSIF COALESCE(v_fila->>'tipo_operacion', '') NOT IN ('LLEGADA', 'SALIDA') THEN
            v_motivo := 'Tipo de operación inválido (se espera LLEGADA o SALIDA)';
        ELSIF COALESCE(v_fila->>'ambito_operacion', '') NOT IN ('NACIONAL', 'INTERNACIONAL') THEN
            v_motivo := 'Ámbito inválido (se espera NACIONAL o INTERNACIONAL)';
        ELSIF COALESCE(v_fila->>'operador', '') = '' THEN
            v_motivo := 'Falta el nombre del operador';
        ELSIF COALESCE(v_fila->>'matricula', '') = '' THEN
            v_motivo := 'Falta la matrícula';
        ELSIF COALESCE(v_fila->>'tipo_aeronave', '') = '' THEN
            v_motivo := 'Falta el tipo de aeronave';
        -- aeropuerto_origen_destino NO se exige: está vacío en más de la mitad
        -- del histórico ya cargado (5,440 de 10,396 filas). El diccionario lo
        -- daba por obligatorio, la tabla real dice lo contrario, y manda la
        -- tabla: exigirlo rechazaría media bitácora de cada año.
        ELSIF NULLIF(v_fila->>'folio_rotacion', '') IS NULL THEN
            v_motivo := 'Falta el folio de rotación (columna "No." del Excel)';
        ELSIF COALESCE((v_fila->>'adultos')::int, 0) < 0
           OR COALESCE((v_fila->>'infantes')::int, 0) < 0 THEN
            v_motivo := 'Los pasajeros no pueden ser negativos';
        END IF;

        IF v_motivo IS NOT NULL THEN
            v_rechazados := v_rechazados || jsonb_build_object(
                'indice', v_indice, 'fila_origen', v_fila_origen, 'motivo', v_motivo
            );
            CONTINUE;
        END IF;

        v_hash := NULLIF(v_fila->>'hash_origen', '');

        -- ── Antiduplicados por LLAVE NATURAL, no por hash_origen ────────────
        --
        -- El histórico ya cargado (10,396 filas) trae hash_origen de 64
        -- caracteres, un SHA-256 calculado por el proceso que lo subió, con una
        -- receta que este repositorio no conoce. Comparar contra el hash que
        -- calcula el navegador —otro algoritmo, otra longitud— nunca daría una
        -- coincidencia, y reimportar un archivo ya cargado duplicaría el
        -- histórico entero sin avisar.
        --
        -- La llave natural no depende de quién calculó qué: folio de rotación +
        -- tipo de movimiento + fecha + matrícula. Está comprobado que identifica
        -- un movimiento (el folio 202200046 son exactamente dos filas, la
        -- llegada y la salida de XA-SAV).
        --
        -- Ventaja adicional sobre el hash: si alguien corrige una hora en el
        -- Excel y lo vuelve a subir, la llave natural lo reconoce como el mismo
        -- movimiento —que es lo que es— mientras que un hash del contenido lo
        -- habría insertado como uno nuevo.
        --
        -- hash_origen se sigue guardando, para trazabilidad e integridad; lo que
        -- ya no hace es decidir qué es un duplicado.
        v_llave := concat_ws('|',
            v_fila->>'folio_rotacion',
            v_fila->>'tipo_operacion',
            v_fila->>'fecha_operacion',
            upper(COALESCE(v_fila->>'matricula', ''))
        );

        -- Duplicado dentro del propio archivo que se está subiendo.
        IF v_llave = ANY(v_vistos) THEN
            v_duplicados := v_duplicados || jsonb_build_object(
                'indice', v_indice, 'fila_origen', v_fila_origen,
                'motivo', 'Repetido dentro del mismo archivo'
            );
            CONTINUE;
        END IF;

        -- Duplicado contra lo ya cargado en la base.
        IF EXISTS (
            SELECT 1 FROM public.aviacion_general_operaciones
             WHERE folio_rotacion   = (v_fila->>'folio_rotacion')::int
               AND tipo_operacion   = v_fila->>'tipo_operacion'
               AND fecha_operacion  = (v_fila->>'fecha_operacion')::date
               AND upper(matricula) = upper(COALESCE(v_fila->>'matricula', ''))
               AND estatus_registro <> 'ELIMINADO'
        ) THEN
            v_duplicados := v_duplicados || jsonb_build_object(
                'indice', v_indice, 'fila_origen', v_fila_origen,
                'motivo', 'Ya existe en la base'
            );
            CONTINUE;
        END IF;

        v_vistos := v_vistos || v_llave;

        v_insertados := v_insertados + 1;

        CONTINUE WHEN p_simulacion;

        -- pax_ag NO aparece: es columna generada y Postgres rechaza el INSERT
        -- si se la manda, aunque el valor sea el correcto.
        INSERT INTO public.aviacion_general_operaciones (
            folio_rotacion, fecha_operacion, tipo_operacion, ambito_operacion,
            operador, matricula, tipo_aeronave, aeropuerto_origen_destino,
            hora_programada, hora_real, adultos, infantes, pax_od,
            estado, pais, observaciones,
            tipo_fuente, archivo_origen, hoja_origen, fila_origen, hash_origen,
            estado_validacion, creado_por
        ) VALUES (
            (v_fila->>'folio_rotacion')::int,
            (v_fila->>'fecha_operacion')::date,
            v_fila->>'tipo_operacion',
            v_fila->>'ambito_operacion',
            v_fila->>'operador',
            v_fila->>'matricula',
            v_fila->>'tipo_aeronave',
            NULLIF(v_fila->>'aeropuerto_origen_destino', ''),
            NULLIF(v_fila->>'hora_programada', '')::time,
            NULLIF(v_fila->>'hora_real', '')::time,
            -- NULL, no 0, cuando la celda venía vacía: "no se anotaron
            -- pasajeros" y "viajaron cero pasajeros" son cosas distintas, y así
            -- es como están las 10,396 filas ya cargadas (2,670 con adultos en
            -- NULL). Inventar ceros aquí ensuciaría cualquier promedio que se
            -- calcule después.
            NULLIF(v_fila->>'adultos', '')::int,
            NULLIF(v_fila->>'infantes', '')::int,
            NULLIF(v_fila->>'pax_od', '')::int,
            NULLIF(v_fila->>'estado', ''),
            NULLIF(v_fila->>'pais', ''),
            NULLIF(v_fila->>'observaciones', ''),
            'IMPORTACION_EXCEL',
            p_archivo,
            p_hoja,
            v_fila_origen,
            v_hash,
            'PENDIENTE',
            auth.uid()
        );
    END LOOP;

    RETURN jsonb_build_object(
        'simulacion',  p_simulacion,
        'recibidas',   v_indice,
        'insertadas',  v_insertados,
        'duplicadas',  jsonb_array_length(v_duplicados),
        'rechazadas',  jsonb_array_length(v_rechazados),
        'detalle_duplicadas', v_duplicados,
        'detalle_rechazadas', v_rechazados
    );
END
$fn$;

COMMENT ON FUNCTION public.aviacion_general_importar(jsonb, text, text, boolean) IS
'Carga por lotes del histórico de Aviación General. Valida fila por fila, omite duplicados por hash_origen y devuelve el detalle de lo rechazado. Con p_simulacion=true no inserta: alimenta la vista previa.';


-- =============================================================================
-- 6) VALIDAR — el flujo PENDIENTE → VALIDADO / OBSERVADO
--
-- Se hace con función y no con un UPDATE desde el cliente porque quién validó
-- y cuándo NO puede depender de que el navegador se acuerde de mandarlo.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_validar(
    p_ids        bigint[],
    p_estado     text,
    p_comentario text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_afectados int;
BEGIN
    IF p_estado NOT IN ('PENDIENTE', 'VALIDADO', 'OBSERVADO') THEN
        RAISE EXCEPTION 'Estado de validación inválido: %. Se espera PENDIENTE, VALIDADO u OBSERVADO.', p_estado;
    END IF;

    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN 0;
    END IF;

    -- OBSERVADO sin decir qué se observó no le sirve a nadie: el que lo lea
    -- mañana no va a saber qué corregir.
    IF p_estado = 'OBSERVADO' AND COALESCE(btrim(p_comentario), '') = '' THEN
        RAISE EXCEPTION 'Observar un registro exige un comentario que explique qué hay que corregir.';
    END IF;

    UPDATE public.aviacion_general_operaciones
       SET estado_validacion      = p_estado,
           validado_por           = CASE WHEN p_estado = 'PENDIENTE' THEN NULL ELSE auth.uid() END,
           fecha_validacion       = CASE WHEN p_estado = 'PENDIENTE' THEN NULL ELSE now() END,
           observacion_validacion = NULLIF(btrim(COALESCE(p_comentario, '')), ''),
           modificado_por         = auth.uid(),
           fecha_modificacion     = now()
     WHERE id = ANY(p_ids)
       AND estatus_registro = 'ACTIVO';

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
    RETURN v_afectados;
END
$fn$;

COMMENT ON FUNCTION public.aviacion_general_validar(bigint[], text, text) IS
'Cambia el estado de validación de uno o varios movimientos, sellando quién y cuándo del lado del servidor.';


-- =============================================================================
-- 7) BAJA LÓGICA — nada se borra de verdad
--
-- El diccionario contempla borrado lógico y motivo de anulación. Aquí se
-- respeta: un movimiento anulado desaparece de las pantallas pero sigue en la
-- tabla, con su motivo, su responsable y su fecha.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_baja(
    p_id     bigint,
    p_motivo text,
    p_modo   text DEFAULT 'ANULADO'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_afectados int;
BEGIN
    IF p_modo NOT IN ('ANULADO', 'ELIMINADO') THEN
        RAISE EXCEPTION 'Modo de baja inválido: %. Se espera ANULADO o ELIMINADO.', p_modo;
    END IF;

    IF COALESCE(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Dar de baja un movimiento exige un motivo.';
    END IF;

    UPDATE public.aviacion_general_operaciones
       SET estatus_registro   = p_modo,
           motivo_anulacion   = btrim(p_motivo),
           eliminado_por      = auth.uid(),
           fecha_eliminacion  = now(),
           modificado_por     = auth.uid(),
           fecha_modificacion = now()
     WHERE id = p_id
       AND estatus_registro = 'ACTIVO';

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
    RETURN v_afectados > 0;
END
$fn$;

COMMENT ON FUNCTION public.aviacion_general_baja(bigint, text, text) IS
'Baja lógica de un movimiento de Aviación General. No borra la fila: cambia su estatus y registra motivo, responsable y fecha.';


-- =============================================================================
-- 8) ENLAZAR ROTACIONES — unir la llegada con su salida
--
-- El Excel relaciona los dos movimientos de una misma aeronave por el folio de
-- la columna "No.". movimiento_relacionado_id convierte esa convención en un
-- enlace real, que es lo que permite después preguntar cuánto estuvo en
-- plataforma o si una llegada se quedó sin salida.
--
-- Sólo enlaza parejas INEQUÍVOCAS: exactamente una llegada y exactamente una
-- salida con el mismo folio y la misma matrícula dentro de la ventana de días
-- indicada. Si hay tres movimientos con el mismo folio, se deja sin enlazar y
-- se reporta: adivinar aquí es peor que no hacer nada.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_enlazar_rotaciones(
    p_fecha_desde date DEFAULT NULL,
    p_fecha_hasta date DEFAULT NULL,
    p_dias_ventana int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_enlazadas int := 0;
    v_ambiguas  int := 0;
BEGIN
    WITH candidatos AS (
        SELECT
            folio_rotacion,
            -- Alias distinto del nombre de la columna a propósito: llamarle
            -- también "matricula" deja una consulta donde el mismo nombre
            -- significa dos cosas según dónde se lea.
            upper(matricula) AS matricula_norm,
            count(*) FILTER (WHERE tipo_operacion = 'LLEGADA') AS n_llegadas,
            count(*) FILTER (WHERE tipo_operacion = 'SALIDA')  AS n_salidas,
            min(id)  FILTER (WHERE tipo_operacion = 'LLEGADA') AS id_llegada,
            min(id)  FILTER (WHERE tipo_operacion = 'SALIDA')  AS id_salida,
            min(fecha_operacion) AS f_min,
            max(fecha_operacion) AS f_max
        FROM public.aviacion_general_operaciones
        WHERE estatus_registro = 'ACTIVO'
          AND (p_fecha_desde IS NULL OR fecha_operacion >= p_fecha_desde)
          AND (p_fecha_hasta IS NULL OR fecha_operacion <= p_fecha_hasta)
        GROUP BY folio_rotacion, upper(matricula)
    ),
    parejas AS (
        SELECT id_llegada, id_salida
        FROM candidatos
        WHERE n_llegadas = 1
          AND n_salidas  = 1
          AND (f_max - f_min) <= p_dias_ventana
    )
    -- El UPDATE es la sentencia principal, no un CTE colgado de un SELECT.
    -- Envolverlo en `WITH aplicado AS (UPDATE … RETURNING) SELECT count(*) INTO …`
    -- también cuenta las filas, pero mete una construcción que PL/pgSQL analiza
    -- de forma distinta a SQL puro y que no aporta nada aquí: ROW_COUNT da el
    -- mismo número sin ese rodeo.
    UPDATE public.aviacion_general_operaciones o
       SET movimiento_relacionado_id = CASE
               WHEN o.id = p.id_llegada THEN p.id_salida
               ELSE p.id_llegada
           END,
           modificado_por     = auth.uid(),
           fecha_modificacion = now()
      FROM parejas p
     WHERE (o.id = p.id_llegada OR o.id = p.id_salida)
       -- Sin esto, volver a correrlo reescribiría el mismo valor en cada fila
       -- y dejaría una modificación en la auditoría por cada pasada.
       AND o.movimiento_relacionado_id IS DISTINCT FROM
           (CASE WHEN o.id = p.id_llegada THEN p.id_salida ELSE p.id_llegada END);

    GET DIAGNOSTICS v_enlazadas = ROW_COUNT;

    SELECT count(*) INTO v_ambiguas
    FROM (
        SELECT folio_rotacion, upper(matricula) AS m,
               count(*) FILTER (WHERE tipo_operacion = 'LLEGADA') AS nl,
               count(*) FILTER (WHERE tipo_operacion = 'SALIDA')  AS ns
        FROM public.aviacion_general_operaciones
        WHERE estatus_registro = 'ACTIVO'
          AND (p_fecha_desde IS NULL OR fecha_operacion >= p_fecha_desde)
          AND (p_fecha_hasta IS NULL OR fecha_operacion <= p_fecha_hasta)
        GROUP BY folio_rotacion, upper(matricula)
    ) g
    WHERE NOT (nl = 1 AND ns = 1);

    RETURN jsonb_build_object(
        'movimientos_enlazados', v_enlazadas,
        'grupos_ambiguos',       v_ambiguas
    );
END
$fn$;

COMMENT ON FUNCTION public.aviacion_general_enlazar_rotaciones(date, date, int) IS
'Enlaza llegada con salida por folio de rotación y matrícula. Sólo toca parejas inequívocas (una llegada y una salida); lo ambiguo lo reporta sin tocarlo.';


-- =============================================================================
-- 8 bis) POSIBLES DUPLICADOS — la misma operación capturada dos veces
--
-- No es una hipótesis: el histórico cargado trae 5 grupos así. Dos ejemplos,
-- verificados:
--
--   · N900MC, 2024-06-04, folio 512, SALIDA — dos filas con la MISMA hora
--     programada (15:58) y la MISMA hora real (16:06), en los renglones 1026 y
--     1027 del Excel, uno seguido del otro. Una trae 3 adultos; la otra, nada.
--   · XC-FEZ, 2026-01-30, folio 95 — el día entero capturado dos veces
--     (renglones 49/97 y 148/192), con el aeropuerto distinto entre una copia y
--     otra (MMMX contra MMSM) y una hora real que difiere en una hora exacta.
--
-- Son capturas repetidas, no dos vuelos: coinciden en folio, matrícula, fecha,
-- tipo de movimiento Y horas. Lo que discrepa son los datos que alguien tecleó
-- distinto la segunda vez, que es justamente por qué hay que revisarlos a mano
-- en vez de borrar el segundo automáticamente: no siempre el bueno es el
-- primero.
--
-- Esta función los SEÑALA. No toca nada. Quien decide cuál se queda es la
-- Gerencia, desde la pantalla de Validación, anulando el sobrante con su motivo.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_duplicados(
    p_filtros jsonb DEFAULT '{}'::jsonb,
    p_limite  int   DEFAULT 200
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH base AS (
    SELECT o.*
    FROM public.aviacion_general_operaciones o
    WHERE public.aviacion_general_filtro_ok(o, p_filtros)
),
grupos AS (
    -- La misma llave natural con la que aviacion_general_importar() decide si
    -- una fila ya existe. Si aquí aparece un grupo, es que el histórico ya
    -- traía repetido algo que hoy la importación rechazaría.
    SELECT folio_rotacion,
           tipo_operacion,
           fecha_operacion,
           upper(matricula)                  AS matricula,
           count(*)                          AS veces,
           array_agg(id ORDER BY id)         AS ids,
           max(operador)                     AS operador,
           count(DISTINCT hora_real)         AS horas_distintas,
           count(DISTINCT COALESCE(aeropuerto_origen_destino, '')) AS aeropuertos_distintos,
           count(DISTINCT COALESCE(adultos, -1) + COALESCE(infantes, -1)) AS pax_distintos
    FROM base
    GROUP BY folio_rotacion, tipo_operacion, fecha_operacion, upper(matricula)
    HAVING count(*) > 1
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'folio_rotacion',  folio_rotacion,
           'tipo_operacion',  tipo_operacion,
           'fecha_operacion', fecha_operacion,
           'matricula',       matricula,
           'operador',        operador,
           'veces',           veces,
           'ids',             to_jsonb(ids),
           -- Pistas para decidir rápido: si todo coincide, es copia limpia y da
           -- igual cuál se anula; si discrepan, hay que abrir los dos.
           'discrepan',       (horas_distintas > 1 OR aeropuertos_distintos > 1 OR pax_distintos > 1)
       ) ORDER BY fecha_operacion DESC), '[]'::jsonb)
FROM (SELECT * FROM grupos ORDER BY fecha_operacion DESC LIMIT p_limite) g;
$fn$;

COMMENT ON FUNCTION public.aviacion_general_duplicados(jsonb, int) IS
'Señala movimientos capturados dos veces (misma llave natural: folio, tipo, fecha y matrícula). No modifica nada: la decisión de cuál se queda es de quien valida.';


-- =============================================================================
-- 9) PERMISOS DE EJECUCIÓN
--
-- Mismos que ya tiene la tabla hoy: el portal opera con la llave anon más la
-- sesión del usuario. Cuando se encienda RLS estas funciones no cambian —son
-- SECURITY INVOKER, así que a partir de ese día ven lo que el usuario pueda ver.
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.aviacion_general_filtro_ok(public.aviacion_general_operaciones, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_resumen(jsonb)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_opciones()                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_importar(jsonb, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_validar(bigint[], text, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_baja(bigint, text, text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_enlazar_rotaciones(date, date, int)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_duplicados(jsonb, int)               TO anon, authenticated;


-- =============================================================================
-- 10) RLS — REDACTADO Y APAGADO, A PROPÓSITO
--
-- Encender RLS hoy, sin haber definido qué perfil de GAG puede consultar,
-- capturar, validar o dar de baja, dejaría el módulo inservible desde el primer
-- minuto. Cuando esos perfiles existan, descomentar este bloque completo y
-- correrlo. No hace falta tocar nada más: las funciones de arriba ya son
-- SECURITY INVOKER.
--
-- El modelo que sigue reusa el RBAC del portal (misma idea que Conciliación y
-- Estadística): el nivel lo dicta la tabla user_roles / permissions del
-- sistema, no el navegador.
--
--   ALTER TABLE public.aviacion_general_operaciones           ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.aviacion_general_operaciones_auditoria ENABLE ROW LEVEL SECURITY;
--
--   -- Nivel efectivo del usuario en el módulo: admin | edit | capture | read | none
--   CREATE OR REPLACE FUNCTION public.aviacion_general_nivel()
--   RETURNS text
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
--   AS $nivel$
--       SELECT COALESCE(
--           (SELECT CASE
--                     WHEN ur.role IN ('admin','superadmin') THEN 'admin'
--                     ELSE COALESCE(
--                        ur.permissions -> 'section_levels' ->> 'aviacion-general',
--                        CASE WHEN ur.permissions -> 'allowed_sections' ? 'aviacion-general'
--                             THEN 'read' ELSE 'none' END)
--                   END
--              FROM public.user_roles ur
--             WHERE ur.user_id = auth.uid()
--             LIMIT 1),
--           'none');
--   $nivel$;
--
--   -- Leer: cualquiera con nivel en el módulo.
--   CREATE POLICY ag_ops_select ON public.aviacion_general_operaciones
--       FOR SELECT TO authenticated
--       USING (public.aviacion_general_nivel() <> 'none');
--
--   -- Capturar: capture y arriba.
--   CREATE POLICY ag_ops_insert ON public.aviacion_general_operaciones
--       FOR INSERT TO authenticated
--       WITH CHECK (public.aviacion_general_nivel() IN ('capture','edit','admin'));
--
--   -- Corregir: edit y arriba. Un capturista sólo endereza lo que él capturó
--   -- y mientras nadie lo haya validado todavía.
--   CREATE POLICY ag_ops_update ON public.aviacion_general_operaciones
--       FOR UPDATE TO authenticated
--       USING (
--           public.aviacion_general_nivel() IN ('edit','admin')
--           OR (public.aviacion_general_nivel() = 'capture'
--               AND creado_por = auth.uid()
--               AND estado_validacion = 'PENDIENTE')
--       )
--       WITH CHECK (public.aviacion_general_nivel() <> 'none');
--
--   -- Nadie borra físicamente: la baja es lógica y va por UPDATE. Por eso NO
--   -- se crea política de DELETE y se revoca el privilegio.
--   REVOKE DELETE ON public.aviacion_general_operaciones FROM anon, authenticated;
--
--   -- La auditoría se lee, no se escribe: la llena el trigger.
--   CREATE POLICY ag_aud_select ON public.aviacion_general_operaciones_auditoria
--       FOR SELECT TO authenticated
--       USING (public.aviacion_general_nivel() <> 'none');
--   REVOKE INSERT, UPDATE, DELETE ON public.aviacion_general_operaciones_auditoria FROM anon, authenticated;
-- =============================================================================


-- =============================================================================
-- VERIFICACIÓN — leer esto antes de cambiar ROLLBACK por COMMIT
-- =============================================================================
DO $verif$
DECLARE
    v_filas    bigint;
    v_indices  int;
    v_funcs    int;
    v_resumen  jsonb;
BEGIN
    SELECT count(*) INTO v_filas FROM public.aviacion_general_operaciones;

    SELECT count(*) INTO v_indices
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'aviacion_general_operaciones'
       AND indexname LIKE 'ix_ag_ops_%';

    SELECT count(*) INTO v_funcs
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'aviacion_general_%';

    v_resumen := public.aviacion_general_resumen('{}'::jsonb);

    RAISE NOTICE '--------------------------------------------------------------';
    RAISE NOTICE 'Módulo Aviación General / FBO — verificación';
    RAISE NOTICE '  Filas en la tabla ............ %', v_filas;
    RAISE NOTICE '  Índices ix_ag_ops_* .......... %  (se esperan 10)', v_indices;
    RAISE NOTICE '  Funciones aviacion_general_* . %  (se esperan 8)', v_funcs;
    RAISE NOTICE '  Resumen responde ............. % movimientos',
                 v_resumen->'totales'->>'movimientos';
    RAISE NOTICE '  Opciones responde ............ %',
                 CASE WHEN public.aviacion_general_opciones() IS NOT NULL THEN 'sí' ELSE 'NO' END;
    RAISE NOTICE '--------------------------------------------------------------';
    RAISE NOTICE 'El histórico 2022-2026 ya está cargado: se esperan ~10,396 filas.';
    RAISE NOTICE 'La pantalla de Importación sirve para los archivos que falten.';
    RAISE NOTICE '--------------------------------------------------------------';
END
$verif$;

-- La misma verificación, pero como TABLA.
--
-- El bloque de arriba usa RAISE NOTICE, que se ve en psql pero NO en el editor
-- SQL de Supabase: ahí los avisos se pierden y la pantalla queda en "Success,
-- no rows returned", que no dice nada. Esta consulta devuelve filas, que el
-- editor sí pinta. Es lo que hay que leer antes de cambiar ROLLBACK por COMMIT.
SELECT * FROM (
    VALUES
        (1, 'Filas en la tabla',
            (SELECT count(*)::text FROM public.aviacion_general_operaciones),
            'se esperan 10,396 al escribir esto (histórico 2022-2026 ya cargado)'),
        (2, 'Índices ix_ag_ops_*',
            (SELECT count(*)::text FROM pg_indexes
              WHERE schemaname = 'public'
                AND tablename  = 'aviacion_general_operaciones'
                AND indexname LIKE 'ix_ag_ops_%'),
            'se esperan 10'),
        (3, 'Funciones aviacion_general_*',
            (SELECT count(*)::text FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'aviacion_general_%'),
            'se esperan 8'),
        (4, 'RPC resumen responde',
            (public.aviacion_general_resumen('{}'::jsonb)->'totales'->>'movimientos'),
            'movimientos con los filtros vacíos'),
        (5, 'RPC opciones responde',
            (CASE WHEN public.aviacion_general_opciones() IS NOT NULL THEN 'sí' ELSE 'NO' END),
            'catálogos de los desplegables'),
        (6, 'RLS en la tabla',
            (SELECT CASE WHEN relrowsecurity THEN 'ENCENDIDO' ELSE 'apagado' END
               FROM pg_class WHERE oid = 'public.aviacion_general_operaciones'::regclass),
            'apagado es lo esperado en esta etapa')
) AS v(orden, concepto, valor, nota)
ORDER BY orden;

-- Cambiar por COMMIT cuando la verificación se vea bien.
ROLLBACK;
