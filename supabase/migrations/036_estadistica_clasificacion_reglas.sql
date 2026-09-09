-- =============================================================================
-- 036 — Clasificación operacional configurable + permiso del módulo estadístico
--
-- NO EJECUTA NADA SOBRE DATOS PRODUCTIVOS FUERA DE LO QUE CREA AQUÍ.
-- Crea objetos NUEVOS únicamente. Ni un ALTER, INSERT, UPDATE o DELETE sobre
-- maestra_operaciones, "Conciliación Manifiestos", itinerario_vuelos_editable,
-- manifiestos_*, ni sobre ningún catálogo (airlines, catalogo_demoras,
-- catalogo_aeropuertos, matriculas_manifiestos, flight_service_type,
-- conciliacion_catalogo_aerolineas). Solo se LEEN.
--
-- QUÉ RESUELVE
--
-- Hoy la única clasificación del sistema es de UNA dimensión y excluyente:
--   · conciliacion_catalogo_aerolineas.types  → 'carga' vs 'pasajeros' (por
--     aerolínea completa; ver _conciRowIsCargo en script.js y la vista
--     v_informe_manifiestos_normalizado de la migración 027).
--   · _aifa_tipo_aviacion_service_type (027)  → 'comercial'/'general'/'carga'
--     a partir del Service Type del AODB.
-- Ninguna de las dos distingue "comercial de carga" de "aviación general de
-- carga", ni admite operaciones MIXTAS, ni tiene vigencia temporal, ni se puede
-- administrar sin tocar código.
--
-- Esta migración las sustituye por DOS dimensiones independientes, resueltas
-- por reglas administrables:
--
--   SEGMENTO DE AVIACIÓN     COMERCIAL | GENERAL
--   NATURALEZA DE OPERACIÓN  PASAJEROS | CARGA | MIXTA | OTRA
--
-- Una operación que no case con ninguna regla NO se adivina: queda como
-- SIN CLASIFICAR (segmento y naturaleza en NULL) y aparece en la pantalla
-- "Operaciones sin clasificar" para que alguien cree la regla que falta.
--
-- REPRODUCIBILIDAD HISTÓRICA (el punto que más importa)
--
-- Las reglas llevan vigencia (vigente_desde / vigente_hasta) y se casan contra
-- la FECHA DE OPERACIÓN, no contra "hoy". Cambiar cómo se clasifica a partir de
-- mañana se hace CERRANDO la regla vigente (vigente_hasta = hoy) y creando otra
-- que empiece mañana: las estadísticas de los meses anteriores siguen saliendo
-- exactamente igual, porque la regla que las gobernaba sigue existiendo y sigue
-- cubriendo ese rango de fechas.
--
-- Se evaluó la alternativa de CONGELAR la clasificación en una columna de
-- maestra_operaciones al momento de capturar. Se descartó: congela también los
-- errores (una aerolínea mal clasificada durante seis meses quedaría mal para
-- siempre, y corregirla obligaría a un reproceso masivo de la tabla auditada).
-- El costo de rendimiento de resolver por reglas se paga una sola vez en la
-- vista materializada de la migración 037, no en cada consulta.
--
-- DEPENDENCIAS
--   · 016_conciliacion_manifiestos_rbac.sql  → conciliacion_manifiestos_access_level()
--   · 008_catalogos_conciliacion_manifiestos.sql → conciliacion_catalogo_aerolineas
--   · db/create_flight_service_type.sql       → flight_service_type, tg_set_updated_at()
--
-- MODO DE USO (igual que 023/024/032/033)
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK: no persiste
--      nada. Revisar el bloque de VERIFICACIÓN del final.
--   2) Si se ve bien, cambiar la última línea ROLLBACK por COMMIT y volver a
--      correr el archivo completo.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Nivel de acceso del módulo estadístico
--
--    NO se crea un sistema de permisos paralelo. Esta función se apoya en el
--    que ya existe (conciliacion_manifiestos_access_level, migración 016, que a
--    su vez lee usuarios_aplicaciones / user_roles / permissions.section_levels)
--    y solo agrega encima un override OPCIONAL por sección 'estadistica', para
--    poder dar a alguien lectura de estadísticas sin darle Conciliación entera,
--    o quitarle la administración de reglas sin tocar su rol global.
--
--    Devuelve, de mayor a menor:
--      'admin'    → puede administrar reglas de clasificación y refrescar
--      'edit'     → puede generar/descargar documentos oficiales
--      'capture'  → puede consultar y exportar datos tabulares
--      'read'     → puede consultar
--      'none'     → sin acceso
--
--    Se mantiene la equivalencia con el helper del navegador
--    window.sectionLevel('conciliacion') (js/data-manager.js), para que lo que
--    se oculta en pantalla y lo que bloquea la base digan lo mismo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estadistica_access_level(
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conci       text;
    v_base        text;
    v_permissions jsonb := '{}'::jsonb;
    v_override    text;
    v_tiene_rol   boolean := false;
    v_rank        int;
    v_rank_ovr    int;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 'none';
    END IF;

    -- Punto de partida: el mismo gate de ESCRITURA que ya rige Conciliación.
    -- Devuelve admin | edit | capture | none.
    v_conci := public.conciliacion_manifiestos_access_level(p_user_id);

    SELECT true, coalesce(ur.permissions, '{}'::jsonb)
      INTO v_tiene_rol, v_permissions
      FROM public.user_roles ur
     WHERE ur.user_id = p_user_id
     LIMIT 1;

    -- 'none' en ese gate NO significa "no puede ver estadísticas": significa
    -- "no puede escribir en manifiestos". La sección Conciliación es visible
    -- para cualquier usuario autenticado (js/permissions.js la lista en
    -- alwaysVisible), así que quien tenga un rol conserva LECTURA.
    v_base := CASE
        WHEN v_conci IN ('admin', 'edit', 'capture') THEN v_conci
        WHEN coalesce(v_tiene_rol, false) THEN 'read'
        ELSE 'none'
    END;

    IF v_base = 'none' THEN
        RETURN 'none';
    END IF;

    -- Override OPCIONAL por sección 'estadistica', en el mismo lugar y con la
    -- misma forma que usa el resto de la aplicación
    -- (permissions.section_levels, ver js/data-manager.js sectionLevel).
    v_override := lower(coalesce(v_permissions -> 'section_levels' ->> 'estadistica', ''));
    IF v_override NOT IN ('none', 'read', 'capture', 'edit', 'admin') THEN
        RETURN v_base;
    END IF;

    -- El override solo puede RECORTAR, nunca elevar: se toma el menor de los
    -- dos niveles. Así no existe una ruta de escalada de privilegios por esta
    -- función.
    v_rank := CASE v_base
        WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'capture' THEN 2
        WHEN 'read' THEN 1 ELSE 0 END;
    v_rank_ovr := CASE v_override
        WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'capture' THEN 2
        WHEN 'read' THEN 1 ELSE 0 END;

    RETURN CASE least(v_rank, v_rank_ovr)
        WHEN 4 THEN 'admin' WHEN 3 THEN 'edit' WHEN 2 THEN 'capture'
        WHEN 1 THEN 'read' ELSE 'none' END;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_access_level(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_access_level(uuid) TO authenticated;

COMMENT ON FUNCTION public.estadistica_access_level(uuid) IS
    'Nivel de acceso al módulo estadístico: admin|edit|capture|read|none. Parte '
    'de conciliacion_manifiestos_access_level (016); quien no puede escribir en '
    'manifiestos pero tiene rol conserva LECTURA, igual que hoy en la pestaña. '
    'El override permissions.section_levels->>''estadistica'' solo puede recortar.';


-- -----------------------------------------------------------------------------
-- 2) Catálogo de valores válidos de las dos dimensiones
--
--    Tabla y no ENUM a propósito: el usuario pidió que los valores iniciales
--    puedan crecer ("valores iniciales"), y agregar un valor a un ENUM en
--    Postgres no se puede deshacer ni hacer dentro de una transacción con otros
--    usos del tipo. Una tabla de catálogo se administra igual que el resto de
--    los catálogos del proyecto.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estadistica_catalogo_clasificacion (
    dimension   text    NOT NULL CHECK (dimension IN ('segmento_aviacion', 'naturaleza_operacion')),
    valor       text    NOT NULL,
    etiqueta    text    NOT NULL,
    descripcion text,
    orden       smallint NOT NULL DEFAULT 100,
    activo      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dimension, valor)
);

INSERT INTO public.estadistica_catalogo_clasificacion (dimension, valor, etiqueta, descripcion, orden) VALUES
    ('segmento_aviacion',    'COMERCIAL', 'Comercial',  'Servicio aéreo comercial: regular, fletamento y vuelos adicionales.', 10),
    ('segmento_aviacion',    'GENERAL',   'General',    'Aviación general: privada, ejecutiva, oficial, escuela, prueba, militar.', 20),
    ('naturaleza_operacion', 'PASAJEROS', 'Pasajeros',  'La operación transporta pasajeros.', 10),
    ('naturaleza_operacion', 'CARGA',     'Carga',      'La operación transporta carga y/o correo, sin pasajeros de pago.', 20),
    ('naturaleza_operacion', 'MIXTA',     'Mixta',      'Transporta pasajeros y carga a la vez. Participa en AMBAS estadísticas.', 30),
    ('naturaleza_operacion', 'OTRA',      'Otra',       'Ni pasajeros ni carga comercial: ferry, posicionamiento, prueba, entrenamiento.', 40)
ON CONFLICT (dimension, valor) DO UPDATE
   SET etiqueta = EXCLUDED.etiqueta,
       descripcion = EXCLUDED.descripcion,
       orden = EXCLUDED.orden;

ALTER TABLE public.estadistica_catalogo_clasificacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estadistica_catalogo_clasificacion_select ON public.estadistica_catalogo_clasificacion;
CREATE POLICY estadistica_catalogo_clasificacion_select
    ON public.estadistica_catalogo_clasificacion
    FOR SELECT TO authenticated
    USING (public.estadistica_access_level(auth.uid()) <> 'none');

DROP POLICY IF EXISTS estadistica_catalogo_clasificacion_write ON public.estadistica_catalogo_clasificacion;
CREATE POLICY estadistica_catalogo_clasificacion_write
    ON public.estadistica_catalogo_clasificacion
    FOR ALL TO authenticated
    USING (public.estadistica_access_level(auth.uid()) = 'admin')
    WITH CHECK (public.estadistica_access_level(auth.uid()) = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estadistica_catalogo_clasificacion TO authenticated;

COMMENT ON TABLE public.estadistica_catalogo_clasificacion IS
    'Valores válidos de las dos dimensiones de clasificación operacional. '
    'Tabla y no ENUM para poder crecer sin migración de tipo.';


-- -----------------------------------------------------------------------------
-- 3) estadistica_reglas_clasificacion — las reglas administrables
--
--    IDENTIDAD: bigint identity, no UUID. Es la convención de las tablas
--    hermanas de este mismo dominio —conciliacion_catalogo_aerolineas (008),
--    matriculas_manifiestos (006), informe_estadistico_aprobaciones (027)—.
--    Las tablas con UUID del proyecto son las que reciben identidad desde el
--    navegador (weekly_flights_detailed, maestra_operaciones.cliente_uuid); no
--    es el caso de un catálogo administrado desde una pantalla.
--
--    CRITERIOS: los tres son OPCIONALES. NULL significa "no restringe".
--    Una regla sin ningún criterio es el comodín global y solo tiene sentido
--    con prioridad alta (número grande), como red de seguridad al final.
--
--    aerolinea_id apunta a conciliacion_catalogo_aerolineas, que es el catálogo
--    que YA usa Conciliación y del que cuelga aerolinea_conciliacion_id en
--    maestra_operaciones. No se duplica ningún catálogo.
--    aerolinea_texto existe para los casos en que la operación trae el código
--    crudo del AODB y todavía no resolvió FK (aerolinea_origen); se compara
--    normalizado contra nombre, IATA y alias.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estadistica_reglas_clasificacion (
    id                    bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,

    activo                boolean NOT NULL DEFAULT true,
    -- Menor número = mayor prioridad. Se deja hueco entre valores para poder
    -- intercalar una regla sin renumerar todas las demás.
    prioridad             integer NOT NULL DEFAULT 100,

    -- Criterios (todos opcionales)
    aerolinea_id          bigint REFERENCES public.conciliacion_catalogo_aerolineas(id) ON DELETE SET NULL,
    aerolinea_texto       text,
    tipo_aeronave         text,
    tipo_servicio         text REFERENCES public.flight_service_type(codigo) ON DELETE SET NULL,

    -- Resultado
    segmento_aviacion     text NOT NULL,
    naturaleza_operacion  text NOT NULL,

    -- Vigencia. NULL abierto por ese lado.
    vigente_desde         date,
    vigente_hasta         date,

    observaciones         text,

    -- Auditoría
    creado_por            uuid DEFAULT auth.uid(),
    creado_por_email      text,
    actualizado_por       uuid,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT estadistica_reglas_vigencia_ck
        CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    CONSTRAINT estadistica_reglas_prioridad_ck
        CHECK (prioridad >= 0),
    -- Al menos un criterio, salvo que se marque explícitamente como comodín
    -- poniendo prioridad >= 9000. Evita crear sin querer una regla que
    -- clasifique el aeropuerto entero.
    CONSTRAINT estadistica_reglas_criterio_ck
        CHECK (
            aerolinea_id IS NOT NULL
            OR NULLIF(btrim(coalesce(aerolinea_texto, '')), '') IS NOT NULL
            OR NULLIF(btrim(coalesce(tipo_aeronave, '')), '') IS NOT NULL
            OR NULLIF(btrim(coalesce(tipo_servicio, '')), '') IS NOT NULL
            OR prioridad >= 9000
        )
);

-- Los valores permitidos se validan contra el catálogo, no con un CHECK fijo,
-- para que agregar un valor nuevo al catálogo no requiera otra migración.
CREATE OR REPLACE FUNCTION public.estadistica_reglas_validar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.estadistica_catalogo_clasificacion c
         WHERE c.dimension = 'segmento_aviacion'
           AND c.valor = NEW.segmento_aviacion
           AND c.activo
    ) THEN
        RAISE EXCEPTION 'segmento_aviacion inválido: %', NEW.segmento_aviacion
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.estadistica_catalogo_clasificacion c
         WHERE c.dimension = 'naturaleza_operacion'
           AND c.valor = NEW.naturaleza_operacion
           AND c.activo
    ) THEN
        RAISE EXCEPTION 'naturaleza_operacion inválida: %', NEW.naturaleza_operacion
            USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := now();
    IF TG_OP = 'UPDATE' THEN
        NEW.actualizado_por := auth.uid();
        -- creado_por/created_at no se reescriben nunca desde un UPDATE.
        NEW.creado_por := OLD.creado_por;
        NEW.created_at := OLD.created_at;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estadistica_reglas_validar_tg ON public.estadistica_reglas_clasificacion;
CREATE TRIGGER estadistica_reglas_validar_tg
    BEFORE INSERT OR UPDATE ON public.estadistica_reglas_clasificacion
    FOR EACH ROW EXECUTE FUNCTION public.estadistica_reglas_validar();

-- Índices de apoyo. El de resolución cubre la consulta que hace la vista
-- materializada de 037: filtrar activas y ordenar por prioridad.
CREATE INDEX IF NOT EXISTS idx_estadistica_reglas_resolucion
    ON public.estadistica_reglas_clasificacion (prioridad, id)
    WHERE activo;

CREATE INDEX IF NOT EXISTS idx_estadistica_reglas_aerolinea
    ON public.estadistica_reglas_clasificacion (aerolinea_id)
    WHERE activo AND aerolinea_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_estadistica_reglas_vigencia
    ON public.estadistica_reglas_clasificacion (vigente_desde, vigente_hasta)
    WHERE activo;

ALTER TABLE public.estadistica_reglas_clasificacion ENABLE ROW LEVEL SECURITY;

-- LECTURA: cualquiera que pueda ver el módulo. Necesario para que la pantalla
-- de clasificación muestre por qué una operación quedó como quedó.
DROP POLICY IF EXISTS estadistica_reglas_select ON public.estadistica_reglas_clasificacion;
CREATE POLICY estadistica_reglas_select
    ON public.estadistica_reglas_clasificacion
    FOR SELECT TO authenticated
    USING (public.estadistica_access_level(auth.uid()) <> 'none');

-- ESCRITURA: solo administración. Ésta es la diferencia real entre "consultar
-- estadísticas" y "administrar reglas" que pidió el requerimiento, y vive en la
-- base — ocultar el botón en JavaScript no basta.
DROP POLICY IF EXISTS estadistica_reglas_write ON public.estadistica_reglas_clasificacion;
CREATE POLICY estadistica_reglas_write
    ON public.estadistica_reglas_clasificacion
    FOR ALL TO authenticated
    USING (public.estadistica_access_level(auth.uid()) = 'admin')
    WITH CHECK (public.estadistica_access_level(auth.uid()) = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estadistica_reglas_clasificacion TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.estadistica_reglas_clasificacion_id_seq TO authenticated;

COMMENT ON TABLE public.estadistica_reglas_clasificacion IS
    'Reglas administrables que resuelven segmento de aviación (COMERCIAL/GENERAL) '
    'y naturaleza de operación (PASAJEROS/CARGA/MIXTA/OTRA) por aerolínea, tipo '
    'de aeronave y/o tipo de servicio, con prioridad y vigencia temporal. Una '
    'operación sin regla que la cubra queda SIN CLASIFICAR: no se adivina.';

COMMENT ON COLUMN public.estadistica_reglas_clasificacion.prioridad IS
    'Menor número gana. Ante empate gana la regla MÁS ESPECÍFICA (más criterios '
    'no nulos) y, si persiste el empate, la de id mayor (la más reciente).';

COMMENT ON COLUMN public.estadistica_reglas_clasificacion.vigente_desde IS
    'Se compara contra la FECHA DE OPERACIÓN, no contra la fecha actual. NULL = '
    'sin límite inferior. Es lo que hace reproducible el histórico.';

COMMENT ON COLUMN public.estadistica_reglas_clasificacion.aerolinea_texto IS
    'Criterio por texto crudo (código IATA/OACI o nombre) para operaciones que '
    'aún no resolvieron aerolinea_conciliacion_id. Se compara normalizado '
    'contra name, iata y aliases del catálogo.';


-- -----------------------------------------------------------------------------
-- 4) Normalizador de texto de aerolínea
--
--    Misma idea que _aifa_normalize_identity_part (migración 010) pero sin
--    recortar a un largo fijo: aquí se comparan nombres completos.
-- -----------------------------------------------------------------------------
-- unaccent puede no estar instalado en el proyecto, así que se traduce a mano.
-- Se define ANTES de _estadistica_norm: Postgres valida el cuerpo de una
-- función SQL al crearla, y si la llamada apuntara a algo inexistente la
-- migración fallaría aquí.
CREATE OR REPLACE FUNCTION public._estadistica_sin_acentos(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT translate(
        coalesce(p_value, ''),
        'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'
    )
$$;

CREATE OR REPLACE FUNCTION public._estadistica_norm(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT NULLIF(
        regexp_replace(
            upper(public._estadistica_sin_acentos(btrim(coalesce(p_value, '')))),
            '[^A-Z0-9]', '', 'g'
        ),
        ''
    )
$$;

COMMENT ON FUNCTION public._estadistica_norm(text) IS
    'Normaliza texto para comparar aerolíneas/aeronaves: sin acentos, sin '
    'espacios ni signos, en mayúsculas. No se reutilizó '
    '_aifa_normalize_identity_part porque ésa recorta a longitud fija para '
    'construir movement_key.';


-- -----------------------------------------------------------------------------
-- 5) estadistica_resolver_clasificacion — la definición CANÓNICA del criterio
--
--    Una sola implementación del "qué regla gana", usada por:
--      · la vista materializada mv_estadistica_operaciones (migración 037)
--      · el probador de reglas de la pantalla de administración
--    Si algún día cambia el criterio de desempate, cambia aquí y en ningún
--    otro lado.
--
--    ESPECIFICIDAD = número de criterios no nulos de la regla (0 a 4). Una
--    regla "aerolínea X + tipo aeronave A320 + servicio J" (3) le gana a
--    "aerolínea X" (1) aunque compartan prioridad.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estadistica_resolver_clasificacion(
    p_fecha            date,
    p_aerolinea_id     bigint,
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
       -- Vigencia contra la fecha de operación
       AND (r.vigente_desde IS NULL OR p_fecha IS NULL OR p_fecha >= r.vigente_desde)
       AND (r.vigente_hasta IS NULL OR p_fecha IS NULL OR p_fecha <= r.vigente_hasta)
       -- Criterio aerolínea: por FK, o por texto contra nombre/iata/alias
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
       AND (
            NULLIF(btrim(coalesce(r.aerolinea_texto, '')), '') IS NULL
            OR public._estadistica_norm(r.aerolinea_texto) = public._estadistica_norm(p_aerolinea_texto)
       )
       -- Criterio tipo de aeronave
       AND (
            NULLIF(btrim(coalesce(r.tipo_aeronave, '')), '') IS NULL
            OR public._estadistica_norm(r.tipo_aeronave) = public._estadistica_norm(p_tipo_aeronave)
       )
       -- Criterio tipo de servicio (código de una letra de flight_service_type)
       AND (
            NULLIF(btrim(coalesce(r.tipo_servicio, '')), '') IS NULL
            OR upper(btrim(r.tipo_servicio)) = upper(btrim(coalesce(p_tipo_servicio, '')))
       )
     ORDER BY
        r.prioridad ASC,
        (
            (r.aerolinea_id IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.aerolinea_texto, '')), '') IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.tipo_aeronave, '')), '') IS NOT NULL)::int
          + (NULLIF(btrim(coalesce(r.tipo_servicio, '')), '') IS NOT NULL)::int
        ) DESC,
        r.id DESC
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.estadistica_resolver_clasificacion(date, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_resolver_clasificacion(date, bigint, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.estadistica_resolver_clasificacion(date, bigint, text, text, text) IS
    'Definición canónica de qué regla gana. Devuelve 0 filas cuando ninguna '
    'regla cubre la operación: eso es SIN CLASIFICAR y es un resultado válido, '
    'no un error.';


-- =============================================================================
-- VERIFICACIÓN (leer antes de cambiar ROLLBACK por COMMIT)
-- =============================================================================

-- 1) Los objetos nuevos existen y ninguno pisó algo previo.
SELECT 'objetos creados' AS reporte, c.relname, c.relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('estadistica_reglas_clasificacion', 'estadistica_catalogo_clasificacion')
 ORDER BY 1, 2;

-- 2) Catálogo cargado con los seis valores iniciales.
SELECT dimension, valor, etiqueta, orden
  FROM public.estadistica_catalogo_clasificacion
 ORDER BY dimension, orden;

-- 3) Arranca vacía a propósito: sin reglas, TODAS las operaciones salen
--    SIN CLASIFICAR. Ése es el estado correcto de partida — la migración 038
--    trae una semilla opcional y revisable.
SELECT 'reglas cargadas' AS reporte, count(*) AS total
  FROM public.estadistica_reglas_clasificacion;

-- 4) El resolvedor no truena y devuelve 0 filas sin reglas.
SELECT 'resolver sin reglas' AS reporte,
       count(*) AS filas_devueltas
  FROM public.estadistica_resolver_clasificacion(current_date, NULL, 'VOLARIS', 'A320', 'J');

-- 5) Los catálogos y la maestra NO cambiaron.
SELECT 'conciliacion_catalogo_aerolineas' AS tabla, count(*) FROM public.conciliacion_catalogo_aerolineas
UNION ALL SELECT 'flight_service_type', count(*) FROM public.flight_service_type
UNION ALL SELECT 'maestra_operaciones', count(*) FROM public.maestra_operaciones;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT cuando la verificación se vea bien.
-- -----------------------------------------------------------------------------
ROLLBACK;
