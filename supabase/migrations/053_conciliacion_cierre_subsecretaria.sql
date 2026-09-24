-- =============================================================================
-- Cierre de Subsecretaría — Conciliación > Manifiestos
-- Versión definitiva. 053 nunca se ha ejecutado en producción, así que este
-- archivo es la primera y única instalación del mecanismo.
--
-- QUÉ ES UN CIERRE DE SUBSECRETARÍA
-- Durante el día se capturan manifiestos. Aproximadamente a las 18:00 un
-- usuario autorizado realiza manualmente el CORTE. En ese momento, TODOS los
-- manifiestos del lote de captura vigente que todavía no han sido cerrados:
--   1. quedan asociados al corte mediante cierre_id;
--   2. reciben en "CIERRE SUBSECRETARIA" la FECHA DEL CORTE;
--   3. quedan congelados en un snapshot;
--   4. dejan de ser editables por la vía ordinaria.
--
-- DOS FECHAS DISTINTAS — ESTO ES EL CORAZÓN DEL MÓDULO
--   "FECHA"                → fecha de la OPERACIÓN / del vuelo.
--   "CIERRE SUBSECRETARIA" → fecha del CORTE en que ese manifiesto se reportó.
-- No son la misma cosa y el lote NUNCA se selecciona por "FECHA". Un vuelo del
-- 21/09 cuyo manifiesto se captura el 22/09 antes del corte pertenece al corte
-- del 22: queda con FECHA = 21/09 y CIERRE SUBSECRETARIA = 22/09. Si el lote se
-- eligiera por "FECHA", ese manifiesto quedaría huérfano para siempre.
--
-- A partir de este mecanismo "CIERRE SUBSECRETARIA" deja de ser captura libre
-- para las filas que administra el sistema: lo escribe
-- conciliacion_cerrar_subsecretaria() y NO está en la whitelist de corrección
-- ordinaria. Los valores históricos ya capturados NO se tocan ni se
-- reinterpretan: las filas legacy siguen funcionando exactamente como hoy.
--
-- FRONTERA LEGACY / NUEVO MECANISMO
-- La columna nueva cierre_capturado_en la escribe el trigger en cada INSERT y
-- es inmutable después. Las filas que ya existían cuando corrió esta migración
-- la tienen NULL: ésas son LEGACY y jamás entran a un corte. Todo lo capturado
-- a partir de la activación (conciliacion_cierre_config.baseline_en) es del
-- nuevo mecanismo. Así el primer corte no intenta cerrar años de historia.
--
-- CORRECCIÓN DE UN MANIFIESTO YA CERRADO
-- El histórico no se reescribe. La corrección autorizada:
--   · modifica la fila viva (verdad operativa vigente),
--   · deja intacto el snapshot (verdad oficial ya reportada),
--   · y registra en el ledger un EVENTO con la fila COMPLETA antes y después.
-- Al aplicarse en el siguiente corte, ese evento aporta al informe dos
-- contribuciones sintéticas: −1 × ANTES y +1 × DESPUÉS. De ahí salen por igual
-- las correcciones numéricas (150 → 180 ⇒ −150 +180 = +30 pax, 0 operaciones
-- netas) y las reclasificaciones (NACIONAL → INTERNACIONAL ⇒ −150 pax y −1 op
-- en NACIONAL, +150 pax y +1 op en INTERNACIONAL, 0 netos).
--
-- MÉTODO DE DESPLIEGUE (explícito y reproducible)
-- Todo el archivo es UNA sola transacción BEGIN … COMMIT y NO contiene
-- CREATE INDEX CONCURRENTLY. Es deliberado: la integración GitHub/Branching de
-- Supabase ejecuta cada migración dentro de una transacción, y ahí
-- CONCURRENTLY falla. Los índices nuevos son sobre columnas recién creadas
-- (100 % NULL en la primera ejecución), así que un CREATE INDEX normal es
-- cuestión de segundos. El mismo archivo corre igual con `supabase db push`,
-- con la integración GitHub y pegado en el SQL Editor.
--
-- REQUISITO: PostgreSQL 15+ (security_invoker en vistas). Se valida al inicio
-- y la migración ABORTA si no se cumple: no se degrada la seguridad en
-- silencio.
--
-- FUERA DE ALCANCE: maestra_operaciones / Informe Estadístico (pipeline
-- separado). Este mecanismo mantiene su propia integridad histórica y no
-- delega en maestra_operaciones.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0) REQUISITOS DEL SERVIDOR Y REINSTALACIÓN LIMPIA
-- =============================================================================

DO $$
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION
            'Cierre de Subsecretaría requiere PostgreSQL 15 o superior (la vista reportable usa security_invoker, sin el cual quedaría expuesta saltándose el RLS). Versión detectada: %.',
            current_setting('server_version')
            USING ERRCODE = '0A000';
    END IF;
END $$;

-- "CIERRE SUBSECRETARIA" es de tipo texto (dd/mm/aaaa) en esta base: el resto
-- del proyecto la trata así (btrim() en las migraciones 033/035, editor de
-- fecha con máscara en script.js). El cierre le escribe un texto, así que si
-- alguna vez cambiara de tipo es mejor fallar AQUÍ, al instalar, con un
-- mensaje claro, que a las 18:00 en medio de un corte.
DO $$
DECLARE
    v_tipo text;
BEGIN
    SELECT data_type INTO v_tipo
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'Conciliación Manifiestos'
       AND column_name = 'CIERRE SUBSECRETARIA';

    IF v_tipo IS NULL THEN
        RAISE EXCEPTION 'No existe la columna "CIERRE SUBSECRETARIA" en public."Conciliación Manifiestos".'
            USING ERRCODE = '42703';
    END IF;

    IF v_tipo NOT IN ('text', 'character varying', 'character') THEN
        RAISE EXCEPTION
            'La columna "CIERRE SUBSECRETARIA" es de tipo % y el cierre le escribe texto dd/mm/aaaa. Ajusta conciliacion_cerrar_subsecretaria() antes de instalar.',
            v_tipo
            USING ERRCODE = '42804';
    END IF;
END $$;

-- Reinstalación limpia SOLO si quedó el esquema de un borrador anterior de esta
-- misma migración (se reconoce por la columna fecha_operativa, que en la
-- versión definitiva se llama fecha_corte). Si ese esquema anterior tuviera
-- cierres registrados, NO se destruye nada: se aborta con un mensaje para que
-- alguien decida a mano. En producción este bloque no hace nada, porque 053
-- nunca se ejecutó ahí.
DO $$
BEGIN
    IF to_regclass('public.conciliacion_cierres_subsecretaria') IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'conciliacion_cierres_subsecretaria'
               AND column_name = 'fecha_operativa'
       ) THEN
        IF EXISTS (SELECT 1 FROM public.conciliacion_cierres_subsecretaria) THEN
            RAISE EXCEPTION
                'Existe un esquema previo de 053 CON cierres registrados. Esta versión cambia el modelo (fecha_corte, ledger before/after). Revisa y migra esos datos a mano antes de reinstalar.'
                USING ERRCODE = '55000';
        END IF;

        -- Sin datos: se puede reinstalar. Se sueltan los candados antes de
        -- borrar las tablas para que el FK vuelva a poder validarse.
        EXECUTE 'UPDATE public."Conciliación Manifiestos" SET cierre_id = NULL WHERE cierre_id IS NOT NULL';
        DROP TABLE IF EXISTS public.conciliacion_correcciones CASCADE;
        DROP TABLE IF EXISTS public.conciliacion_ajustes_pendientes CASCADE;
        DROP TABLE IF EXISTS public.conciliacion_ajustes CASCADE;
        DROP TABLE IF EXISTS public.conciliacion_cierres_snapshot CASCADE;
        DROP TABLE IF EXISTS public.conciliacion_cierres_subsecretaria CASCADE;
        DROP TABLE IF EXISTS public.conciliacion_cierre_config CASCADE;
        RAISE NOTICE 'Se reinstaló el Cierre de Subsecretaría desde cero (el esquema previo no tenía cierres).';
    END IF;
END $$;

-- Objetos del borrador anterior que ya no existen en esta versión.
DROP VIEW IF EXISTS public.v_conciliacion_manifiestos_historico;
DROP FUNCTION IF EXISTS public.conciliacion_resumen_periodo(date);
DROP FUNCTION IF EXISTS public._conci_siguiente_informe_fecha();
DROP FUNCTION IF EXISTS public.conciliacion_puede_cerrar_subsecretaria(uuid);
DROP FUNCTION IF EXISTS public.conciliacion_puede_autorizar_correccion(uuid);
-- El cierre ordinario ya no recibe fecha: la pone el servidor. La firma con
-- parámetro se elimina para que no quede colgando en la API de PostgREST y un
-- cliente pueda seguir llamándola desde DevTools.
DROP FUNCTION IF EXISTS public.conciliacion_cerrar_subsecretaria(date);

-- =============================================================================
-- 1) HELPERS PUROS
--
-- Ninguno se otorga a clientes: todos se llaman desde funciones SECURITY
-- DEFINER (que corren como el dueño) o desde el trigger, que los lleva
-- inlineados precisamente para no necesitar GRANT alguno.
--
-- search_path: todas las funciones fijan pg_temp AL FINAL. PostgreSQL busca
-- pg_temp PRIMERO cuando no se nombra explícitamente, así que ponerlo último es
-- lo que impide que un esquema temporal malicioso secuestre la resolución de
-- nombres. Además todos los objetos van calificados con su esquema.
-- =============================================================================

-- Columnas numéricas que participan en totales de informes. Revisado contra
-- los consumidores reales:
--   · js/conci-reportes-pasajeros.js → TOTAL PAX (oficio Subsecretaría y
--     plantillas) y la familia de exentos/TUA del libro original.
--   · js/conci-reportes-carga.js     → carga nacional/internacional/total.
--   · script.js (_updateManifiestosSummaryStrip) → TOTAL PAX y carga.
-- Se usan para las CIFRAS agregadas (totales_fijo, totales_ajustes, FIJO). NO
-- deciden qué genera evento: eso lo genera CUALQUIER corrección autorizada.
--
-- AVISO PARA QUIEN CONSUMA totales_fijo / totales_ajustes / totales_reportados:
-- cada columna es una CLAVE INDEPENDIENTE del jsonb. NO se deben sumar entre
-- sí. En particular "KG DE CARGA TOTAL" ya incluye a "KGS. DE CARGA NACIONAL"
-- + "KGS. DE CARGA INTERNACIONAL", y "TOTAL EXENTOS" ya incluye a
-- DIPLOMATICOS/EN COMISION/INFANTES/TRANSITOS/CONEXIONES/OTROS EXENTOS.
CREATE OR REPLACE FUNCTION public._conci_campos_numericos_cierre()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT ARRAY[
        'TOTAL PAX','DIPLOMATICOS','EN COMISION','INFANTES','TRANSITOS','CONEXIONES',
        'OTROS EXENTOS','TOTAL EXENTOS','PAX QUE PAGAN TUA','KGS. DE EQUIPAJE',
        'KGS. DE CARGA NACIONAL','KGS. DE CARGA INTERNACIONAL','KG DE CARGA TOTAL',
        'CORREO'
    ]::text[];
$$;

REVOKE ALL ON FUNCTION public._conci_campos_numericos_cierre() FROM PUBLIC;

-- Columnas que el flujo de corrección autorizada puede modificar en un
-- manifiesto cerrado. Es la whitelist que valida el SQL dinámico: nada fuera de
-- aquí llega jamás a un format(%I).
--
-- "CIERRE SUBSECRETARIA" NO está y no debe volver a estar: desde este
-- mecanismo la escribe el sistema (la fecha del corte). Un usuario no puede
-- mover una fila de un corte a otro editando una celda; corregir la fecha de un
-- corte COMPLETO sería otro proceso administrativo, no una corrección de fila.
CREATE OR REPLACE FUNCTION public._conci_campos_editables_cierre()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT ARRAY[
        'MES','FECHA','TIPO DE MANIFIESTO','AEROLINEA',
        'TIPO DE OPERACIÓN','AERONAVE','MATRÍCULA','ESTATUS MATRÍCULA','# DE VUELO',
        'DESTINO / ORIGEN','RUTA','SLOT ASIGNADO','SLOT COORDINADO',
        'HR. DE INICIO O TERMINO DE PERNOCTA','HR. DE EMBARQUE O DESEMBARQUE',
        'HR. DE OPERACIÓN','HR. MÁXIMA DE ENTREGA','HR. DE RECEPCIÓN','HRS. CUMPLIDAS',
        'TOTAL PAX','DIPLOMATICOS','EN COMISION','INFANTES','TRANSITOS','CONEXIONES',
        'OTROS EXENTOS','TOTAL EXENTOS','PAX QUE PAGAN TUA','KGS. DE EQUIPAJE',
        'KGS. DE CARGA NACIONAL','KGS. DE CARGA INTERNACIONAL','KG DE CARGA TOTAL','CORREO',
        'PUNTUALIDAD / CANCELACIÓN','DEMORA +- 15 MIN.','CÓDIGO DEMORA','OBSERVACIONES',
        'CAPTURÓ','CAPACIDAD MÁXIMA','FACTOR DE OCUPACIÓN','EVIDENCIA','Hora y Fecha Generación'
    ]::text[];
$$;

REVOKE ALL ON FUNCTION public._conci_campos_editables_cierre() FROM PUBLIC;

-- Suma dos jsonb "campo -> número" clave a clave (unión de claves).
CREATE OR REPLACE FUNCTION public._conci_jsonb_sum_numerico(p_a jsonb, p_b jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(jsonb_object_agg(clave, valor), '{}'::jsonb)
    FROM (
        SELECT clave, sum(valor) AS valor
        FROM (
            SELECT key AS clave, value::numeric AS valor FROM jsonb_each_text(coalesce(p_a, '{}'::jsonb))
            UNION ALL
            SELECT key AS clave, value::numeric AS valor FROM jsonb_each_text(coalesce(p_b, '{}'::jsonb))
        ) u
        GROUP BY clave
    ) agg;
$$;

REVOKE ALL ON FUNCTION public._conci_jsonb_sum_numerico(jsonb, jsonb) FROM PUBLIC;

-- Totales numéricos de UNA fila (su to_jsonb) según la lista de campos que
-- participan en informes.
CREATE OR REPLACE FUNCTION public._conci_totales_numericos(p_datos jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(jsonb_object_agg(t.campo, v.valor), '{}'::jsonb)
      FROM unnest(public._conci_campos_numericos_cierre()) AS t(campo)
      CROSS JOIN LATERAL (
            SELECT public._aifa_safe_numeric(p_datos ->> t.campo) AS valor
      ) v
     WHERE v.valor IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public._conci_totales_numericos(jsonb) FROM PUBLIC;

-- Clasificación que se congela junto con el snapshot.  La resolución ocurre
-- en el servidor, con el mismo catálogo que usa la tabla de Manifiestos; el
-- resultado se copia a la fila al cerrarla y ya no depende de cambios futuros
-- del catálogo.
CREATE OR REPLACE FUNCTION public._conci_clasificacion_reportable(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_bruto text := nullif(btrim(coalesce(
        p_datos ->> 'AEROLINEA', p_datos ->> 'aerolinea',
        p_datos ->> 'AIRLINE', p_datos ->> 'airline', ''
    )), '');
    v_name text;
    v_types text[];
BEGIN
    SELECT c.name, c.types
      INTO v_name, v_types
      FROM public.conciliacion_catalogo_aerolineas c
     WHERE c.active
       AND (upper(btrim(c.iata)) = upper(v_bruto)
            OR lower(btrim(c.name)) = lower(v_bruto)
            OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE lower(btrim(a)) = lower(v_bruto)))
     ORDER BY c.id
     LIMIT 1;
    RETURN jsonb_build_object(
        'es_carga', coalesce(EXISTS (
            SELECT 1 FROM unnest(coalesce(v_types, '{}'::text[])) t
             WHERE lower(btrim(t)) IN ('carga', 'cargo')
        ), false),
        'aerolinea', coalesce(v_name, v_bruto)
    );
END;
$$;

REVOKE ALL ON FUNCTION public._conci_clasificacion_reportable(jsonb) FROM PUBLIC;

-- Efecto numérico de un evento del ledger: DESPUÉS − ANTES, campo por campo.
-- Es EXACTAMENTE la misma aritmética que producen las dos contribuciones
-- sintéticas (−1 × ANTES, +1 × DESPUÉS) de la vista reportable. Una sola
-- verdad matemática: si esto suma +30, el informe suma +30.
CREATE OR REPLACE FUNCTION public._conci_delta_numerico(p_antes jsonb, p_despues jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(jsonb_object_agg(d.campo, d.delta), '{}'::jsonb)
      FROM (
            SELECT t.campo,
                   coalesce(public._aifa_safe_numeric(p_despues ->> t.campo), 0)
                 - coalesce(public._aifa_safe_numeric(p_antes    ->> t.campo), 0) AS delta
              FROM unnest(public._conci_campos_numericos_cierre()) AS t(campo)
      ) d
     WHERE d.delta <> 0;
$$;

REVOKE ALL ON FUNCTION public._conci_delta_numerico(jsonb, jsonb) FROM PUBLIC;

-- =============================================================================
-- 2) EL LOCK ÚNICO DE CONTABILIDAD OFICIAL
--
-- (531953, 1) — 53 = número de esta migración. Un solo par de enteros, un solo
-- candado, tres operaciones:
--   · conciliacion_cerrar_subsecretaria           → EXCLUSIVO
--   · conciliacion_solicitar_correccion (aplica)  → EXCLUSIVO
--   · conciliacion_resolver_solicitud_correccion  → EXCLUSIVO
--   · captura/edición de manifiestos (trigger)    → COMPARTIDO
--
-- El compartido es lo que vuelve determinística la frontera del corte sin
-- depender de la visibilidad MVCC de una transacción concurrente:
--   · Si una captura obtiene el compartido primero, el corte ESPERA a que esa
--     transacción haga commit. Cuando el corte arranca, esa fila ya es visible
--     y su cierre_capturado_en es anterior al instante lógico ⇒ ENTRA.
--   · Si el corte obtiene el exclusivo primero, la captura ESPERA. Su
--     cierre_capturado_en se sella DESPUÉS de conseguir el lock, o sea después
--     del instante lógico del corte ⇒ va al SIGUIENTE corte, nunca huérfana.
-- Los compartidos no se estorban entre sí: la captura normal no se serializa.
--
-- El orden es siempre: validar → lock → instante lógico → bloquear filas →
-- escribir → commit (que libera el lock). El instante lógico se captura
-- DESPUÉS del lock, nunca antes: si se capturara antes, una transacción que
-- esperó dos segundos en el lock estaría fechando su corte en el pasado.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._conci_lock_contabilidad()
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT pg_catalog.pg_advisory_xact_lock(531953, 1);
$$;

REVOKE ALL ON FUNCTION public._conci_lock_contabilidad() FROM PUBLIC;

COMMENT ON FUNCTION public._conci_lock_contabilidad() IS
    'Lock exclusivo de transacción (531953,1) que serializa TODA operación que '
    'cambia la contabilidad oficial: el corte y las dos vías de corrección '
    'autorizada. La captura ordinaria toma el mismo lock en modo COMPARTIDO '
    'desde el trigger.';

-- ¿Esta transacción tiene el lock exclusivo de contabilidad? Se consulta
-- pg_locks, no una bandera: el resultado no es falsificable por el cliente.
CREATE OR REPLACE FUNCTION public._conci_tiene_lock_contabilidad()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_locks l
         WHERE l.locktype = 'advisory'
           AND l.classid = 531953
           AND l.objid = 1
           AND l.objsubid = 2
           AND l.pid = pg_catalog.pg_backend_pid()
           AND l.granted
           AND l.mode = 'ExclusiveLock'
    );
$$;

REVOKE ALL ON FUNCTION public._conci_tiene_lock_contabilidad() FROM PUBLIC;

-- =============================================================================
-- 3) BYPASS INTERNO DEL CANDADO — explícito, no implícito
--
-- El trigger de bloqueo NO se abre por "current_user no es authenticated": eso
-- dejaría pasar a CUALQUIER función SECURITY DEFINER propiedad del dueño,
-- presente o futura, por el simple hecho de ejecutarse como owner.
--
-- Aquí el permiso hay que PEDIRLO, y sólo puede pedirlo un flujo que:
--   a) pueda ejecutar esta función (REVOKE ALL FROM PUBLIC y ningún GRANT:
--      ningún cliente REST puede invocarla, ni directa ni indirectamente), y
--   b) ya tenga el lock exclusivo de contabilidad.
-- La marca es un GUC de transacción (is_local) cuyo valor es el txid actual:
-- no sobrevive al commit, no se puede reutilizar desde otra transacción de una
-- conexión agrupada, y PostgREST no expone set_config ni permite fijar GUCs
-- arbitrarios (sólo los suyos bajo el prefijo request.*).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._conci_permitir_escritura_cerrada()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT public._conci_tiene_lock_contabilidad() THEN
        RAISE EXCEPTION 'Escritura sobre un manifiesto cerrado sin el lock de contabilidad. Es un error de programación del flujo llamador, no una condición de carrera.'
            USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.set_config('aifa_conci.escritura_cerrada', pg_catalog.txid_current()::text, true);
END;
$$;

REVOKE ALL ON FUNCTION public._conci_permitir_escritura_cerrada() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._conci_fin_escritura_cerrada()
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT pg_catalog.set_config('aifa_conci.escritura_cerrada', '', true);
$$;

REVOKE ALL ON FUNCTION public._conci_fin_escritura_cerrada() FROM PUBLIC;

-- =============================================================================
-- 4) REAUTENTICACIÓN RECIENTE
--
-- ADVERTENCIA — PENDIENTE DE VALIDAR CONTRA SUPABASE REAL:
-- Lee el claim "amr" (Authentication Methods Reference) del JWT de Supabase
-- Auth buscando una autenticación por CONTRASEÑA reciente. auth.jwt() lee los
-- claims que PostgREST fijó para esta petición ANTES de invocar cualquier
-- función (no lo afecta SECURITY DEFINER) y el cliente no puede fabricarlos
-- porque el JWT va firmado por Supabase.
--   1. El claim amr EXISTE oficialmente en los JWT de Supabase Auth. Lo que
--      NO está verificado es que una nueva llamada a signInWithPassword sobre
--      una sesión YA ACTIVA renueve el timestamp de la entrada "password" como
--      este control necesita, ni el formato exacto de ese timestamp (se asume
--      epoch en segundos).
--   2. NO se ha podido comprobar contra un proyecto Supabase real: no hay
--      Supabase local ni de prueba en este entorno. NO se declara validado.
--   3. Si el comportamiento real difiere, esta función devuelve false SIEMPRE
--      y el Cierre de Subsecretaría y las correcciones quedan BLOQUEADOS por
--      completo. Falla CERRADO, nunca abierto. Eso es deliberado.
-- Verificación manual antes de depender de esto: iniciar sesión, volver a
-- llamar signInWithPassword, y revisar `SELECT auth.jwt() -> 'amr';` con una
-- sesión de usuario real.
--
-- La doble confirmación del cliente (dos pasos + contraseña) NO se retira: este
-- control server-side y aquél son capas distintas del mismo requisito.
--
-- Ventana: 300 s (5 min). Suficiente para el flujo real (dos confirmaciones +
-- escribir la contraseña + red) sin volver tolerable el escenario que este
-- control ataca: una sesión abierta durante horas desde la que alguien llama
-- el RPC directo desde DevTools saltándose los modales.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._conci_reautenticacion_reciente(p_max_segundos integer DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_claims jsonb;
    v_amr jsonb;
    v_max_ts bigint := 0;
    v_entry jsonb;
    v_ts bigint;
BEGIN
    BEGIN
        v_claims := auth.jwt();
    EXCEPTION WHEN OTHERS THEN
        RETURN false;
    END;

    IF v_claims IS NULL THEN
        RETURN false;
    END IF;

    v_amr := v_claims -> 'amr';
    IF v_amr IS NULL OR jsonb_typeof(v_amr) <> 'array' THEN
        RETURN false;
    END IF;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_amr) LOOP
        IF (v_entry ->> 'method') = 'password' THEN
            BEGIN
                v_ts := (v_entry ->> 'timestamp')::bigint;
            EXCEPTION WHEN OTHERS THEN
                v_ts := 0;
            END;
            v_max_ts := greatest(v_max_ts, coalesce(v_ts, 0));
        END IF;
    END LOOP;

    IF v_max_ts = 0 THEN
        RETURN false;
    END IF;

    RETURN (extract(epoch FROM now())::bigint - v_max_ts) BETWEEN 0 AND p_max_segundos;
END;
$$;

REVOKE ALL ON FUNCTION public._conci_reautenticacion_reciente(integer) FROM PUBLIC;

COMMENT ON FUNCTION public._conci_reautenticacion_reciente(integer) IS
    'Busca en el claim amr del JWT una autenticación por contraseña dentro de '
    'los últimos p_max_segundos (300 por omisión). Falla CERRADO ante '
    'cualquier dato inesperado. NO validado contra Supabase real — leer el '
    'comentario completo arriba de la función antes de depender de esto.';

-- Nombre legible del usuario actual para la auditoría.
--
-- IMPORTANTE: _cm_historial_usuario_actual() —el helper que ya usa la
-- auditoría de Manifiestos— NO está creado por ninguna migración versionada:
-- vive en db/create_conciliacion_manifiestos_historial.sql, un script suelto.
-- Por eso la migración 017 lo invoca comprobando antes to_regprocedure(), y
-- por eso aquí se hace lo mismo: llamarlo a ciegas haría que TODO el cierre y
-- TODA corrección fallaran en cualquier base construida solo desde
-- supabase/migrations/.
CREATE OR REPLACE FUNCTION public._conci_usuario_nombre()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_nombre text;
    v_email text;
BEGIN
    BEGIN
        IF to_regprocedure('public._cm_historial_usuario_actual()') IS NOT NULL THEN
            EXECUTE 'SELECT nombre FROM public._cm_historial_usuario_actual()' INTO v_nombre;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_nombre := NULL;
    END;
    IF nullif(btrim(coalesce(v_nombre, '')), '') IS NOT NULL THEN
        RETURN btrim(v_nombre);
    END IF;

    BEGIN
        v_nombre := nullif(btrim(coalesce(
            auth.jwt() -> 'user_metadata' ->> 'full_name',
            auth.jwt() -> 'user_metadata' ->> 'name',
            ''
        )), '');
        v_email := nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
    EXCEPTION WHEN OTHERS THEN
        v_nombre := NULL;
        v_email := NULL;
    END;
    IF v_nombre IS NOT NULL THEN RETURN v_nombre; END IF;
    IF v_email IS NOT NULL THEN RETURN v_email; END IF;

    BEGIN
        SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_email := NULL;
    END;

    RETURN coalesce(nullif(btrim(coalesce(v_email, '')), ''), 'Sistema');
END;
$$;

REVOKE ALL ON FUNCTION public._conci_usuario_nombre() FROM PUBLIC;

COMMENT ON FUNCTION public._conci_usuario_nombre() IS
    'Nombre del usuario actual para la auditoría del cierre. Usa '
    '_cm_historial_usuario_actual() si existe (no lo crea ninguna migración '
    'versionada, de ahí la comprobación), y si no cae a los claims del JWT y '
    'al correo de auth.users. Nunca falla ni devuelve vacío.';

-- =============================================================================
-- 5) TABLAS
-- =============================================================================

-- Configuración de activación. Tabla de una sola fila, mismo patrón que
-- informe_estadistico_refresco (migración 028): id boolean PK CHECK (id).
--
-- baseline_en es la FRONTERA entre lo legacy y lo que administra el nuevo
-- mecanismo. Todo manifiesto capturado a partir de ese instante lleva
-- cierre_capturado_en y es candidato a entrar a un corte; todo lo anterior
-- tiene cierre_capturado_en NULL y JAMÁS se cierra ni se snapshotea.
CREATE TABLE IF NOT EXISTS public.conciliacion_cierre_config (
    id             boolean PRIMARY KEY DEFAULT true CHECK (id),
    baseline_en    timestamptz NOT NULL,
    actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- La FILA se siembra más abajo, no aquí: ver "SEMBRADO DEL BASELINE" al final
-- de la sección 6. Sembrarla en este punto abriría una ventana de activación
-- entre el baseline y la creación del trigger.

COMMENT ON TABLE public.conciliacion_cierre_config IS
    'Fila única de configuración. baseline_en = instante de activación del '
    'Cierre de Subsecretaría: los manifiestos capturados antes son legacy '
    '(cierre_capturado_en NULL) y nunca entran a un corte.';

-- Cabecera del corte: un informe histórico inmutable.
--
-- UN SOLO CORTE POR FECHA (ux_conciliacion_cierres_fecha). Es la regla
-- operativa: cada día se emite un oficio y sólo uno. Hecho el corte del día,
-- todo lo que llegue después —un manifiesto capturado a las 18:05, una
-- corrección autorizada a las 19:00— espera al SIGUIENTE corte cronológico,
-- aunque su FECHA de operación sea la de hoy o la de ayer. Eso no cambia el
-- criterio del lote (sigue siendo "lo que falta por cerrar", nunca una fecha
-- de operación): sólo fija cuándo puede emitirse el siguiente oficio.
--
-- El constraint es la red de seguridad; el rechazo con mensaje legible lo da
-- conciliacion_cerrar_subsecretaria() antes de escribir nada.
CREATE TABLE IF NOT EXISTS public.conciliacion_cierres_subsecretaria (
    id                  bigserial PRIMARY KEY,
    -- Fecha DEL CORTE / del informe. NO es la fecha de operación de los
    -- manifiestos que contiene. Es la que se escribe en "CIERRE SUBSECRETARIA".
    fecha_corte         date NOT NULL,
    cerrado_por         uuid NOT NULL REFERENCES auth.users(id),
    cerrado_por_nombre  text NOT NULL,
    -- Instante lógico del corte: clock_timestamp() capturado UNA sola vez,
    -- después de tomar el lock. Sin DEFAULT now() a propósito (now() sería el
    -- inicio de la transacción, no el instante real del corte).
    cerrado_en          timestamptz NOT NULL,
    total_manifiestos   integer NOT NULL,
    total_ajustes       integer NOT NULL DEFAULT 0,
    -- capturado del lote, sin ajustes.
    totales_fijo        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- efecto neto de los eventos de ajuste consumidos por ESTE corte.
    totales_ajustes     jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Número oficial del informe = totales_fijo + totales_ajustes. No se
    -- recalcula nunca después de creado.
    totales_reportados  jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Un corte sin manifiestos NUEVOS sigue siendo legítimo si lo que trae son
    -- ajustes de cortes anteriores (una corrección de ayer aplicada hoy debe
    -- poder reportarse hoy aunque hoy no se haya capturado nada). Lo que no se
    -- permite es un corte completamente vacío.
    CONSTRAINT ck_conciliacion_cierres_no_vacio
        CHECK (total_manifiestos >= 0 AND total_ajustes >= 0
               AND (total_manifiestos > 0 OR total_ajustes > 0)),
    CONSTRAINT ux_conciliacion_cierres_fecha UNIQUE (fecha_corte)
);

-- Para una base que ya tenga la tabla creada por una ejecución anterior de
-- este mismo archivo (CREATE TABLE IF NOT EXISTS no añadiría el constraint).
-- Si ahí hubiera dos cortes con la misma fecha, esto falla con el mensaje de
-- PostgreSQL diciendo cuál es la fecha duplicada, que es justo lo que alguien
-- necesitaría saber para resolverlo a mano.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ux_conciliacion_cierres_fecha'
    ) THEN
        ALTER TABLE public.conciliacion_cierres_subsecretaria
            ADD CONSTRAINT ux_conciliacion_cierres_fecha UNIQUE (fecha_corte);
    END IF;
END $$;

-- El UNIQUE ya crea su índice sobre (fecha_corte): no hace falta otro.

COMMENT ON TABLE public.conciliacion_cierres_subsecretaria IS
    'Cabecera del Cierre de Subsecretaría. fecha_corte es la fecha del INFORME '
    '(la que se escribe en "CIERRE SUBSECRETARIA"), no la fecha de operación '
    'de los manifiestos. totales_reportados es el informe histórico inmutable: '
    'no se recalcula aunque los manifiestos se corrijan después.';

-- Copia congelada de cada manifiesto en el instante del corte, tomada DESPUÉS
-- de escribirle cierre_id y "CIERRE SUBSECRETARIA": el snapshot es la fila
-- oficial completa, no necesita que nadie le reinyecte nada al leerla.
CREATE TABLE IF NOT EXISTS public.conciliacion_cierres_snapshot (
    id              bigserial PRIMARY KEY,
    cierre_id       bigint NOT NULL REFERENCES public.conciliacion_cierres_subsecretaria(id),
    -- Sin FK a "Conciliación Manifiestos" DELIBERADAMENTE: el snapshot debe
    -- sobrevivir intacto aunque la fila viva se corrija o desaparezca. Un FK
    -- con ON DELETE CASCADE destruiría el histórico; uno sin cascada impediría
    -- operaciones legítimas de mantenimiento. El vínculo es por id lógico,
    -- igual que en conciliacion_manifiestos_historial (migración 017).
    manifiesto_id   bigint NOT NULL,
    datos_snapshot  jsonb NOT NULL,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_conciliacion_cierres_snapshot UNIQUE (cierre_id, manifiesto_id)
);

CREATE INDEX IF NOT EXISTS idx_conciliacion_cierres_snapshot_manifiesto
    ON public.conciliacion_cierres_snapshot (manifiesto_id);

COMMENT ON TABLE public.conciliacion_cierres_snapshot IS
    'Fila completa (to_jsonb) de cada manifiesto tal como quedó al cerrarse, '
    'candado y fecha de corte incluidos. Inmutable: ningún cliente tiene '
    'INSERT/UPDATE/DELETE sobre esta tabla. TODA fila cerrada se sirve desde '
    'aquí en la vista reportable, sin excepciones.';

-- LEDGER APPEND-ONLY DE EVENTOS DE AJUSTE.
--
-- Cada corrección AUTORIZADA sobre un manifiesto cerrado inserta una fila
-- nueva con la fila COMPLETA antes y después. No es "campo → diferencia":
-- guardar sólo un número perdería las reclasificaciones (TIPO DE OPERACIÓN,
-- TIPO DE MANIFIESTO, AEROLINEA…), que cambian el informe sin cambiar ningún
-- total. Con datos_antes/datos_despues, cada evento se reproduce en el informe
-- como −1 × ANTES y +1 × DESPUÉS, y eso cubre los dos casos con la misma
-- mecánica.
--
-- Nunca se fusionan ni se reescriben: 150→180 y después 180→170 quedan como
-- dos eventos, no como uno de +20. Eso conserva la auditoría intermedia y hace
-- exacto el corte temporal: cada evento lleva SU propio aprobado_en inmutable.
CREATE TABLE IF NOT EXISTS public.conciliacion_ajustes (
    id                      bigserial PRIMARY KEY,
    manifiesto_id           bigint NOT NULL,
    -- Cierre en el que ese manifiesto quedó congelado (de dónde viene la
    -- discrepancia). FK real: el cierre origen sí debe existir siempre.
    cierre_origen_id        bigint NOT NULL REFERENCES public.conciliacion_cierres_subsecretaria(id),
    campo                   text NOT NULL,
    valor_anterior          text,
    valor_nuevo             text,
    -- Fila completa ANTES y DESPUÉS de la corrección. Son los dos "asientos"
    -- del evento; de aquí salen las contribuciones sintéticas del informe.
    datos_antes             jsonb NOT NULL,
    datos_despues           jsonb NOT NULL,
    -- Efecto numérico derivado (DESPUÉS − ANTES) para los KPI y los totales
    -- del cierre. Es una CACHÉ de lo que la vista reportable calcula sola; se
    -- fija en el INSERT y no se toca más.
    delta_numerico          jsonb NOT NULL DEFAULT '{}'::jsonb,
    estado                  text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aplicado')),
    cierre_aplicacion_id    bigint REFERENCES public.conciliacion_cierres_subsecretaria(id),
    aplicado_en             timestamptz,
    -- Bookkeeping de inserción (DEFAULT now() = inicio de la transacción).
    -- NUNCA decide elegibilidad.
    creado_en               timestamptz NOT NULL DEFAULT now(),
    -- Instante REAL de la autorización, siempre clock_timestamp() explícito y
    -- tomado con el lock de contabilidad ya en la mano. Inmutable tras el
    -- INSERT. Es el único timestamp que decide a qué corte pertenece.
    aprobado_en             timestamptz NOT NULL,
    -- Estados explícitos, sin equivalencias lógicas: cada estado enumera TODAS
    -- sus columnas de consumo, así que no existe el estado parcial
    -- "pendiente pero ya con cierre_aplicacion_id".
    CONSTRAINT ck_conciliacion_ajustes_estado CHECK (
        (estado = 'pendiente' AND cierre_aplicacion_id IS NULL     AND aplicado_en IS NULL)
        OR
        (estado = 'aplicado'  AND cierre_aplicacion_id IS NOT NULL AND aplicado_en IS NOT NULL)
    ),
    CONSTRAINT ck_conciliacion_ajustes_orden_temporal
        CHECK (aplicado_en IS NULL OR aplicado_en >= aprobado_en)
);

-- SIN índice único por (manifiesto_id, campo): bajo el ledger de eventos, dos
-- correcciones sucesivas del mismo campo coexisten legítimamente como dos
-- filas 'pendiente'. Índices por las consultas reales, sin sobreindexar:
CREATE INDEX IF NOT EXISTS idx_conciliacion_ajustes_estado_aprobado
    ON public.conciliacion_ajustes (estado, aprobado_en);

CREATE INDEX IF NOT EXISTS idx_conciliacion_ajustes_manifiesto
    ON public.conciliacion_ajustes (manifiesto_id, campo);

CREATE INDEX IF NOT EXISTS idx_conciliacion_ajustes_cierre_aplicacion
    ON public.conciliacion_ajustes (cierre_aplicacion_id)
    WHERE cierre_aplicacion_id IS NOT NULL;

COMMENT ON TABLE public.conciliacion_ajustes IS
    'Ledger APPEND-ONLY de eventos de corrección sobre manifiestos ya '
    'cerrados. Cada evento guarda la fila COMPLETA antes y después, de modo '
    'que el informe siguiente lo reproduce como −1 × ANTES y +1 × DESPUÉS: así '
    'funcionan por igual las correcciones numéricas y las reclasificaciones. '
    'Un evento se consume exactamente una vez.';

-- Correcciones y solicitudes sobre manifiestos cerrados. Es la auditoría
-- completa: quién pidió, quién autorizó, qué campo, qué valores, por qué.
CREATE TABLE IF NOT EXISTS public.conciliacion_correcciones (
    id                      bigserial PRIMARY KEY,
    manifiesto_id           bigint NOT NULL,
    cierre_original_id      bigint NOT NULL REFERENCES public.conciliacion_cierres_subsecretaria(id),
    -- Evento del ledger generado al aplicarse. TODA corrección aplicada genera
    -- uno, sea el campo numérico o descriptivo.
    ajuste_id               bigint REFERENCES public.conciliacion_ajustes(id),
    campo                   text NOT NULL,
    valor_anterior          text,
    valor_nuevo             text,
    -- Resumen numérico informativo (NULL si el campo no mueve ningún total).
    diferencia              numeric,
    motivo                  text NOT NULL,
    estado                  text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aplicada','rechazada')),
    usuario_modifica        uuid NOT NULL REFERENCES auth.users(id),
    usuario_modifica_nombre text NOT NULL,
    usuario_autoriza        uuid REFERENCES auth.users(id),
    usuario_autoriza_nombre text,
    comentario_resolucion   text,
    creado_en               timestamptz NOT NULL DEFAULT now(),
    resuelto_en             timestamptz,
    -- Estados explícitos, uno por rama, enumerando TODAS las columnas que
    -- deben (y no deben) estar presentes. Nada de equivalencias booleanas que
    -- dejen pasar estados parciales.
    CONSTRAINT ck_conciliacion_correcciones_estado CHECK (
        (estado = 'pendiente'
             AND usuario_autoriza IS NULL AND usuario_autoriza_nombre IS NULL
             AND resuelto_en IS NULL AND ajuste_id IS NULL
             AND comentario_resolucion IS NULL)
        OR
        (estado = 'aplicada'
             AND usuario_autoriza IS NOT NULL AND usuario_autoriza_nombre IS NOT NULL
             AND resuelto_en IS NOT NULL AND ajuste_id IS NOT NULL)
        OR
        (estado = 'rechazada'
             AND usuario_autoriza IS NOT NULL AND usuario_autoriza_nombre IS NOT NULL
             AND resuelto_en IS NOT NULL AND ajuste_id IS NULL
             AND diferencia IS NULL)
    ),
    CONSTRAINT ck_conciliacion_correcciones_orden_temporal
        CHECK (resuelto_en IS NULL OR resuelto_en >= creado_en)
);

CREATE INDEX IF NOT EXISTS idx_conciliacion_correcciones_manifiesto
    ON public.conciliacion_correcciones (manifiesto_id);
CREATE INDEX IF NOT EXISTS idx_conciliacion_correcciones_estado
    ON public.conciliacion_correcciones (estado);
CREATE INDEX IF NOT EXISTS idx_conciliacion_correcciones_solicitante
    ON public.conciliacion_correcciones (usuario_modifica);

-- A lo mucho una solicitud pendiente por manifiesto+campo: evita que se
-- acumulen peticiones duplicadas del mismo dato esperando revisión. (Esto NO
-- limita el ledger: son tablas distintas con propósitos distintos.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_conciliacion_correcciones_pendiente_unica
    ON public.conciliacion_correcciones (manifiesto_id, campo)
    WHERE estado = 'pendiente';

COMMENT ON TABLE public.conciliacion_correcciones IS
    'Auditoría de correcciones/solicitudes sobre manifiestos cerrados. '
    'usuario_modifica = quien pide o aplica; usuario_autoriza = quien '
    'resuelve. Solo transiciona de pendiente a aplicada/rechazada.';

-- =============================================================================
-- 6) COLUMNAS Y CANDADO EN LA TABLA DE CAPTURA
-- =============================================================================

ALTER TABLE public."Conciliación Manifiestos"
    ADD COLUMN IF NOT EXISTS cierre_id bigint,
    -- Instante en que la fila entró a la tabla, sellado por el trigger. Es la
    -- FUENTE DE VERDAD del lote de un corte y la frontera legacy/nuevo
    -- mecanismo. NULL = fila anterior a la activación. NO se rellena
    -- retroactivamente: eso es justo lo que protege el histórico.
    ADD COLUMN IF NOT EXISTS cierre_capturado_en timestamptz,
    -- Snapshot de clasificación: impide que un cambio de catálogo reescriba
    -- la historia de un informe ya reportado.
    ADD COLUMN IF NOT EXISTS cierre_es_carga_reportado boolean,
    ADD COLUMN IF NOT EXISTS cierre_aerolinea_reportada text;

-- FK dentro de la transacción principal: la columna es nueva y está 100% NULL
-- en su primera ejecución, así que validarla es un escaneo trivial.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_conciliacion_manifiestos_cierre'
    ) THEN
        ALTER TABLE public."Conciliación Manifiestos"
            ADD CONSTRAINT fk_conciliacion_manifiestos_cierre
            FOREIGN KEY (cierre_id) REFERENCES public.conciliacion_cierres_subsecretaria(id);
    END IF;
END $$;

COMMENT ON COLUMN public."Conciliación Manifiestos".cierre_id IS
    'Cierre de Subsecretaría al que quedó asociado este manifiesto (NULL = aún '
    'abierto, o fila legacy). El candado real; la columna "CIERRE '
    'SUBSECRETARIA" guarda la FECHA de ese mismo corte, que es lo que agrupan '
    'los informes.';

COMMENT ON COLUMN public."Conciliación Manifiestos".cierre_capturado_en IS
    'Instante de captura sellado por el trigger, inmutable. NULL = fila legacy '
    '(anterior a la activación del Cierre de Subsecretaría): nunca entra a un '
    'corte. Define el lote de cada corte, junto con cierre_id IS NULL.';

-- Trigger de bloqueo y de sellado.
--
-- NO usa "current_user NOT IN ('authenticated','anon')" como permiso: eso
-- abriría el candado a cualquier función SECURITY DEFINER del dueño por el mero
-- hecho de ejecutarse como owner. El permiso se PIDE explícitamente con
-- _conci_permitir_escritura_cerrada(), que no es ejecutable por ningún cliente
-- y que exige además el lock exclusivo de contabilidad.
--
-- La comprobación va inlineada (GUC + pg_locks + txid) y no en helpers
-- auxiliares a propósito: así el trigger no necesita que se otorgue EXECUTE de
-- nada a 'authenticated' para poder correr en una captura normal.
CREATE OR REPLACE FUNCTION public._conci_proteger_cierre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_marca text;
    v_autorizado boolean := false;
BEGIN
    v_marca := nullif(coalesce(current_setting('aifa_conci.escritura_cerrada', true), ''), '');
    IF v_marca IS NOT NULL AND v_marca = pg_catalog.txid_current()::text THEN
        v_autorizado := EXISTS (
            SELECT 1
              FROM pg_catalog.pg_locks l
             WHERE l.locktype = 'advisory'
               AND l.classid = 531953
               AND l.objid = 1
               AND l.objsubid = 2
               AND l.pid = pg_catalog.pg_backend_pid()
               AND l.granted
               AND l.mode = 'ExclusiveLock'
        );
    END IF;

    IF v_autorizado THEN
        -- Flujo interno autorizado (corte o corrección aprobada): pasa tal cual.
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    -- El trigger BEFORE STATEMENT ya tomó este lock antes de los locks de
    -- fila. La adquisición es reentrante y conserva la comprobación explícita
    -- para instalaciones que aún no hayan recargado ese trigger.
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(531953, 1);

    -- ── Escritura ordinaria (captura, edición, importación) ──────────────
    -- El lock compartido ya fue tomado por el trigger BEFORE STATEMENT. Eso
    -- fija el orden lock -> row-lock para INSERT/UPDATE/DELETE/UPSERT.
    IF TG_OP = 'INSERT' THEN
        -- Nadie inserta una fila ya "cerrada" desde el cliente, y el instante
        -- de captura lo sella el servidor: un cliente no puede antedatarse
        -- para colarse en un corte anterior.
        NEW.cierre_id := NULL;
        NEW.cierre_capturado_en := clock_timestamp();
        -- "CIERRE SUBSECRETARIA" nace VACÍA y la escribe el corte. Si se
        -- dejara capturar a mano, un manifiesto todavía ABIERTO con la fecha
        -- tecleada aparecería en el oficio de ese día sin haberse cerrado
        -- nunca: exactamente el descuadre que este mecanismo existe para
        -- impedir. (Las filas legacy no pasan por aquí: ya están insertadas.)
        NEW."CIERRE SUBSECRETARIA" := NULL;
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.cierre_id IS NOT NULL THEN
            -- Excepción estrecha y explícita: los metadatos de REVISIÓN del
            -- portal (aprobación AIFA/AFAC, notas, sellos) no participan en
            -- ningún informe, y el flujo de doble aprobación del portal puede
            -- ocurrir después del corte. Bloquearlos rompería esa función sin
            -- proteger ninguna cifra. Cualquier otra columna —una sola— exige
            -- el flujo de corrección autorizada.
            IF EXISTS (
                SELECT 1
                  FROM jsonb_each_text(to_jsonb(NEW)) n
                  FULL JOIN jsonb_each_text(to_jsonb(OLD)) o ON o.key = n.key
                 WHERE coalesce(n.key, o.key) <> ALL (ARRAY[
                           '_portal_status','_portal_review_notes','_portal_reviewed_by','_portal_reviewed_at',
                           '_portal_aprob_aifa','_portal_aifa_by','_portal_aifa_by_name','_portal_aifa_at','_portal_aifa_notes',
                           '_portal_aprob_afac','_portal_afac_by','_portal_afac_by_name','_portal_afac_at','_portal_afac_notes',
                           'movement_key','updated_at'
                       ])
                   AND n.value IS DISTINCT FROM o.value
            ) THEN
                RAISE EXCEPTION 'Manifiesto % cerrado por Cierre de Subsecretaría (cierre_id=%). Requiere autorización para corregirlo.', OLD.id, OLD.cierre_id
                    USING ERRCODE = '42501';
            END IF;

            NEW.cierre_id := OLD.cierre_id;
            NEW.cierre_capturado_en := OLD.cierre_capturado_en;
            RETURN NEW;
        END IF;
        -- Ni el candado ni el instante de captura se mueven a mano. Preservar
        -- cierre_capturado_en es también lo que mantiene legacy a una fila
        -- legacy por más que se edite.
        NEW.cierre_id := OLD.cierre_id;
        NEW.cierre_capturado_en := OLD.cierre_capturado_en;
        -- Fila ABIERTA del nuevo mecanismo: su "CIERRE SUBSECRETARIA" sigue
        -- siendo del sistema (vacía hasta que la escriba el corte). Una fila
        -- LEGACY —cierre_capturado_en NULL— conserva la columna como campo de
        -- captura libre, exactamente como funciona hoy.
        IF OLD.cierre_capturado_en IS NOT NULL THEN
            NEW."CIERRE SUBSECRETARIA" := OLD."CIERRE SUBSECRETARIA";
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.cierre_id IS NOT NULL THEN
            RAISE EXCEPTION 'No se puede eliminar el manifiesto %: está cerrado por Cierre de Subsecretaría (cierre_id=%).', OLD.id, OLD.cierre_id
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

-- Todo DML ordinario adquiere el lock compartido antes de que PostgreSQL
-- empiece a tomar locks de fila. Así no existe la inversión corte (advisory ->
-- row) / captura (row -> advisory) que provocaba deadlocks en UPDATE y UPSERT.
CREATE OR REPLACE FUNCTION public._conci_bloquear_escritura_stmt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_marca text;
BEGIN
    v_marca := nullif(coalesce(current_setting('aifa_conci.escritura_cerrada', true), ''), '');
    IF v_marca IS NULL OR v_marca <> pg_catalog.txid_current()::text THEN
        PERFORM pg_catalog.pg_advisory_xact_lock_shared(531953, 1);
    END IF;
    RETURN NULL;
END;
$$;

-- Función de trigger, no SECURITY DEFINER ni RPC. Conserva EXECUTE para que
-- PostgreSQL pueda dispararla en capturas ordinarias; no expone una operación
-- de negocio invocable desde la API.
COMMENT ON FUNCTION public._conci_proteger_cierre() IS
    'Trigger de Conciliación Manifiestos: sella cierre_capturado_en, deja '
    '"CIERRE SUBSECRETARIA" bajo control del sistema, impide tocar filas '
    'cerradas y serializa la captura contra el corte con el lock compartido '
    '(531953,1). Sólo se abre ante el bypass explícito de '
    '_conci_permitir_escritura_cerrada(), que exige el lock exclusivo.';

DROP TRIGGER IF EXISTS trg_conciliacion_manifiestos_proteger_cierre
    ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_conciliacion_manifiestos_proteger_cierre
    BEFORE INSERT OR UPDATE OR DELETE ON public."Conciliación Manifiestos"
    FOR EACH ROW EXECUTE FUNCTION public._conci_proteger_cierre();

DROP TRIGGER IF EXISTS trg_conci_bloquear_escritura_stmt
    ON public."Conciliación Manifiestos";
CREATE TRIGGER trg_conci_bloquear_escritura_stmt
    BEFORE INSERT OR UPDATE OR DELETE ON public."Conciliación Manifiestos"
    FOR EACH STATEMENT EXECUTE FUNCTION public._conci_bloquear_escritura_stmt();

-- ── SEMBRADO DEL BASELINE — sin ventana de activación ───────────────────
--
-- Va AQUÍ y no junto al CREATE TABLE de la configuración, y el sitio importa.
--
-- El ALTER TABLE de arriba tomó un ACCESS EXCLUSIVE sobre "Conciliación
-- Manifiestos" y lo retiene hasta el COMMIT. En este punto, por tanto:
--   · las columnas cierre_id y cierre_capturado_en ya existen;
--   · el trigger que sella cierre_capturado_en ya está creado;
--   · ninguna captura concurrente puede escribir en la tabla hasta el commit.
-- De modo que TODA fila insertada después de este instante pasa por el
-- trigger y lleva cierre_capturado_en, y toda fila anterior es legacy con la
-- columna NULL. No queda hueco en el que una captura acabe con
-- cierre_capturado_en NULL y una hora de inserción posterior al baseline, que
-- es como una fila nueva se volvería legacy por accidente.
--
-- Sembrarlo antes del ALTER dejaba abierta justo esa ventana: entre el
-- baseline y la creación del trigger nadie sostenía el lock.
--
-- En una reinstalación, ON CONFLICT DO NOTHING conserva el baseline original:
-- la frontera nunca se mueve sola, o filas ya administradas volverían a ser
-- legacy.
INSERT INTO public.conciliacion_cierre_config (id, baseline_en)
VALUES (true, clock_timestamp())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 7) PRIVILEGIOS — dos, no uno; y sin fuga de privilegios ajenos
--
-- No se crean roles nuevos: se usa la arquitectura de permisos JSONB que ya
-- existe (user_roles.permissions / usuarios_aplicaciones.permisos). Dos flags
-- separados porque son responsabilidades distintas: cerrar el día es rutina;
-- autorizar una corrección RETROACTIVA sobre un informe ya oficial es más
-- sensible y puede recaer en otra persona.
--
-- Las funciones públicas NO reciben p_user_id: resuelven auth.uid() del lado
-- servidor. Así un usuario autenticado no puede sondear el privilegio de otro.
-- El helper con p_user_id existe pero no es ejecutable por clientes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._conci_tiene_flag_permiso(p_user_id uuid, p_clave text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_flag_glob boolean := false;
BEGIN
    IF p_user_id IS NULL OR p_clave IS NULL THEN
        RETURN false;
    END IF;
    IF NOT public.has_operaciones_access(p_user_id) THEN
        RETURN false;
    END IF;

    SELECT (lower(coalesce(ur.permissions ->> p_clave, 'false')) = 'true')
      INTO v_flag_glob
      FROM public.user_roles ur
     WHERE ur.user_id = p_user_id
     LIMIT 1;

    RETURN coalesce(v_flag_glob, false);
END;
$$;

REVOKE ALL ON FUNCTION public._conci_tiene_flag_permiso(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.conciliacion_puede_cerrar_subsecretaria()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RETURN false; END IF;
    IF public.conciliacion_manifiestos_access_level(v_uid) = 'admin' THEN RETURN true; END IF;
    RETURN public._conci_tiene_flag_permiso(v_uid, 'conciliacion_cierra_subsecretaria');
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() IS
    'true si QUIEN LLAMA puede realizar el Cierre de Subsecretaría: '
    'admin/superadmin, o permissions.conciliacion_cierra_subsecretaria = true. '
    'Sin parámetro de usuario a propósito: nadie sondea privilegios ajenos.';

CREATE OR REPLACE FUNCTION public.conciliacion_puede_autorizar_correccion()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RETURN false; END IF;
    IF public.conciliacion_manifiestos_access_level(v_uid) = 'admin' THEN RETURN true; END IF;
    RETURN public._conci_tiene_flag_permiso(v_uid, 'conciliacion_autoriza_correccion');
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_puede_autorizar_correccion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_puede_autorizar_correccion() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_puede_autorizar_correccion() IS
    'true si QUIEN LLAMA puede aplicar/resolver correcciones sobre manifiestos '
    'cerrados: admin/superadmin, o '
    'permissions.conciliacion_autoriza_correccion = true.';

-- Alta/baja de cualquiera de los dos privilegios. Solo administradores,
-- verificado server-side en cada llamada.
CREATE OR REPLACE FUNCTION public.conciliacion_manifiestos_set_privilegio(
    p_user_id uuid,
    p_privilegio text,
    p_habilitado boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clave text;
BEGIN
    IF public.conciliacion_manifiestos_access_level(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar privilegios de Cierre de Subsecretaría.'
            USING ERRCODE = '42501';
    END IF;

    v_clave := CASE p_privilegio
        WHEN 'cerrar' THEN 'conciliacion_cierra_subsecretaria'
        WHEN 'autorizar_correccion' THEN 'conciliacion_autoriza_correccion'
        ELSE NULL
    END;
    IF v_clave IS NULL THEN
        RAISE EXCEPTION 'Privilegio desconocido: % (use ''cerrar'' o ''autorizar_correccion'').', p_privilegio
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.user_roles
       SET permissions = jsonb_set(
               coalesce(permissions, '{}'::jsonb),
               ARRAY[v_clave],
               to_jsonb(coalesce(p_habilitado, false)),
               true
           )
     WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El usuario % no tiene fila en user_roles; asígnale un rol primero.', p_user_id
            USING ERRCODE = 'P0002';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_manifiestos_set_privilegio(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_manifiestos_set_privilegio(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_manifiestos_set_privilegio(uuid, text, boolean) IS
    'Asigna/retira "cerrar" o "autorizar_correccion". Solo admin, verificado '
    'server-side; nunca confía en el rol que el cliente afirme tener.';

-- Consulta administrativa de los privilegios de OTRO usuario. Existe para que
-- un admin pueda verificar lo que acaba de otorgar; exige admin en cada
-- llamada, que es lo que hace aceptable el parámetro p_user_id.
CREATE OR REPLACE FUNCTION public.conciliacion_privilegios_de_usuario(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF public.conciliacion_manifiestos_access_level(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo un administrador puede consultar los privilegios de otro usuario.'
            USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'user_id', p_user_id,
        'access_level', public.conciliacion_manifiestos_access_level(p_user_id),
        'cerrar', public.conciliacion_manifiestos_access_level(p_user_id) = 'admin'
                  OR public._conci_tiene_flag_permiso(p_user_id, 'conciliacion_cierra_subsecretaria'),
        'autorizar_correccion', public.conciliacion_manifiestos_access_level(p_user_id) = 'admin'
                  OR public._conci_tiene_flag_permiso(p_user_id, 'conciliacion_autoriza_correccion')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_privilegios_de_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_privilegios_de_usuario(uuid) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_privilegios_de_usuario(uuid) IS
    'RPC administrativo: privilegios de cierre de otro usuario. Exige admin en '
    'cada llamada; por eso aquí sí es aceptable recibir p_user_id.';

-- =============================================================================
-- 8) RPC: realizar el Cierre de Subsecretaría
--
-- CRITERIO DEL LOTE — lo único que decide qué entra al corte:
--     cierre_id IS NULL                       (todavía no cerrado)
--     AND cierre_capturado_en IS NOT NULL     (no es legacy)
--     AND cierre_capturado_en >= baseline_en  (es del nuevo mecanismo)
--     AND cierre_capturado_en <= v_instante   (se capturó antes de la frontera)
-- La columna "FECHA" NO aparece. Un manifiesto de un vuelo del 21 capturado el
-- 22 entra al corte del 22. Uno capturado a las 18:05, después del corte de las
-- 18:00, espera al corte del DÍA SIGUIENTE —no a un segundo corte del mismo
-- día, que la regla operativa no permite—, aunque su FECHA de operación sea la
-- de hoy o la de ayer. Lo mismo vale para una corrección autorizada después del
-- corte. Nada queda huérfano: el criterio es "lo que falta por cerrar", y eso
-- siempre se acaba cerrando en el primer corte que se emita.
--
-- Orden de operaciones:
--   1. sesión válida
--   2. privilegio de cierre
--   3. reautenticación reciente
--   4. LOCK exclusivo de contabilidad
--   5. instante lógico (después del lock)
--   6. fecha del corte = el día en curso en México, SIEMPRE derivada de ese
--      instante lógico. El RPC no recibe fecha: no hay nada que un cliente
--      pueda enviar desde DevTools para fechar un corte en el pasado.
--  6b. un solo corte por fecha, y posterior al último (orden cronológico)
--   7. bloquear y recolectar el lote (FOR UPDATE)
--   8. bloquear y recolectar los eventos de ajuste elegibles
--   9. rechazar si no hay ni manifiestos ni ajustes
--  10. crear la cabecera YA con sus totales definitivos
--  11. consumir los eventos (una sola vez)
--  12. escribir cierre_id + "CIERRE SUBSECRETARIA" y snapshotear
-- Todas las validaciones que pueden rechazar van ANTES de la primera escritura.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conciliacion_cerrar_subsecretaria()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_instante timestamptz;
    v_hoy date;
    v_fecha_corte date;
    v_ultima_fecha date;
    v_baseline timestamptz;
    v_nombre text;
    v_cierre_id bigint;
    v_ids bigint[] := ARRAY[]::bigint[];
    v_ajuste_ids bigint[] := ARRAY[]::bigint[];
    v_total_manifiestos integer := 0;
    v_total_ajustes integer := 0;
    v_totales_fijo jsonb := '{}'::jsonb;
    v_totales_ajustes jsonb := '{}'::jsonb;
    v_totales_reportados jsonb := '{}'::jsonb;
    m record;
    a record;
BEGIN
    -- (1) (2) (3) Identidad, privilegio y contraseña reciente.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;

    IF NOT public.conciliacion_puede_cerrar_subsecretaria() THEN
        RAISE EXCEPTION 'No tienes privilegio para realizar el Cierre de Subsecretaría.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public._conci_reautenticacion_reciente(300) THEN
        RAISE EXCEPTION 'Se requiere confirmar tu contraseña recientemente para esta acción. Vuelve a intentarlo desde Manifiestos.'
            USING ERRCODE = '28000';
    END IF;

    -- (4) Lock único de contabilidad. A partir de aquí ninguna corrección
    -- autorizada ni ningún otro corte puede intercalarse, y toda captura en
    -- vuelo o ya terminó (y por tanto se ve) o esperará al commit.
    PERFORM public._conci_lock_contabilidad();

    -- (5) Instante lógico DESPUÉS del lock: es la frontera del corte.
    v_instante := clock_timestamp();
    v_hoy := (v_instante AT TIME ZONE 'America/Mexico_City')::date;

    -- (6) Fecha del INFORME: el día en curso en México, derivado del MISMO
    -- instante lógico. No hay parámetro que la altere. Un usuario con
    -- privilegio de cierre no puede fechar un corte en el pasado desde
    -- DevTools, porque no existe nada que enviar. Si algún día hiciera falta
    -- un cierre administrativo retroactivo, será otro RPC, admin-only y
    -- auditado, no una variante de éste.
    v_fecha_corte := v_hoy;

    -- (6b) UN SOLO CORTE POR FECHA, y en orden cronológico estricto. Se lee
    -- con el lock ya en la mano, así que dos cortes simultáneos no pueden
    -- llegar los dos hasta aquí: el segundo espera, relee el máximo ya
    -- actualizado y es rechazado. El constraint UNIQUE es la red de atrás.
    SELECT max(c.fecha_corte) INTO v_ultima_fecha
      FROM public.conciliacion_cierres_subsecretaria c;

    IF v_ultima_fecha IS NOT NULL AND v_fecha_corte <= v_ultima_fecha THEN
        IF v_fecha_corte = v_ultima_fecha THEN
            RAISE EXCEPTION 'Ya se realizó el Cierre de Subsecretaría del %. Lo capturado después de ese corte y las correcciones autorizadas después entrarán al siguiente cierre, el del %.',
                to_char(v_ultima_fecha, 'DD/MM/YYYY'),
                to_char(v_ultima_fecha + 1, 'DD/MM/YYYY')
                USING ERRCODE = '23505';
        END IF;
        RAISE EXCEPTION 'El último Cierre de Subsecretaría es del % y se intentó fechar uno el %. Los cortes van en orden cronológico y no se puede emitir uno anterior.',
            to_char(v_ultima_fecha, 'DD/MM/YYYY'), to_char(v_fecha_corte, 'DD/MM/YYYY')
            USING ERRCODE = '22023';
    END IF;

    SELECT c.baseline_en INTO v_baseline
      FROM public.conciliacion_cierre_config c
     WHERE c.id;

    IF v_baseline IS NULL THEN
        RAISE EXCEPTION 'Falta la configuración de activación del Cierre de Subsecretaría (conciliacion_cierre_config).'
            USING ERRCODE = 'P0002';
    END IF;

    -- (7) El lote: TODO lo del nuevo mecanismo que siga sin cerrar. Sin
    -- referencia alguna a la fecha de operación.
    FOR m IN
        SELECT *
          FROM public."Conciliación Manifiestos"
         WHERE cierre_id IS NULL
           AND cierre_capturado_en IS NOT NULL
           AND cierre_capturado_en >= v_baseline
           AND cierre_capturado_en <= v_instante
         ORDER BY id
           FOR UPDATE
    LOOP
        v_ids := array_append(v_ids, m.id);
        v_total_manifiestos := v_total_manifiestos + 1;
        v_totales_fijo := public._conci_jsonb_sum_numerico(
            v_totales_fijo, public._conci_totales_numericos(to_jsonb(m))
        );
    END LOOP;

    -- (8) Eventos de ajuste elegibles. Como las correcciones toman el MISMO
    -- lock exclusivo, o ya hicieron commit antes de que este corte lo tomara
    -- (y entonces son visibles y su aprobado_en es anterior al instante), o
    -- empezarán después del commit de este corte (y su aprobado_en será
    -- posterior). No hay ventana ambigua; el filtro por aprobado_en es la
    -- segunda red.
    FOR a IN
        SELECT *
          FROM public.conciliacion_ajustes
         WHERE estado = 'pendiente'
           AND cierre_aplicacion_id IS NULL
           AND aprobado_en <= v_instante
         ORDER BY id
           FOR UPDATE
    LOOP
        v_ajuste_ids := array_append(v_ajuste_ids, a.id);
        v_total_ajustes := v_total_ajustes + 1;
        v_totales_ajustes := public._conci_jsonb_sum_numerico(v_totales_ajustes, a.delta_numerico);
    END LOOP;

    -- (9) Ni manifiestos nuevos ni ajustes: no hay informe que congelar. Se
    -- rechaza antes de escribir nada.
    IF v_total_manifiestos = 0 AND v_total_ajustes = 0 THEN
        RAISE EXCEPTION 'No hay manifiestos por cerrar ni ajustes pendientes; no se puede realizar un cierre vacío.'
            USING ERRCODE = '22023';
    END IF;

    v_totales_reportados := public._conci_jsonb_sum_numerico(v_totales_fijo, v_totales_ajustes);
    v_nombre := public._conci_usuario_nombre();

    -- (10) Cabecera con los totales YA definitivos.
    INSERT INTO public.conciliacion_cierres_subsecretaria (
        fecha_corte, cerrado_por, cerrado_por_nombre, cerrado_en,
        total_manifiestos, total_ajustes, totales_fijo, totales_ajustes, totales_reportados
    ) VALUES (
        v_fecha_corte, auth.uid(), v_nombre, v_instante,
        v_total_manifiestos, v_total_ajustes, v_totales_fijo, v_totales_ajustes, v_totales_reportados
    )
    RETURNING id INTO v_cierre_id;

    -- (11) Consumo de los eventos: una sola vez, sobre las filas ya bloqueadas.
    IF cardinality(v_ajuste_ids) > 0 THEN
        UPDATE public.conciliacion_ajustes
           SET estado = 'aplicado',
               cierre_aplicacion_id = v_cierre_id,
               aplicado_en = v_instante
         WHERE id = ANY (v_ajuste_ids);
    END IF;

    -- (12) Candado, FECHA DEL CORTE y snapshot. El snapshot se toma DESPUÉS
    -- del UPDATE para que congele la fila oficial completa —cierre_id y
    -- "CIERRE SUBSECRETARIA" incluidos—, y no una versión a la que luego haya
    -- que reinyectarle columnas al leerla.
    IF cardinality(v_ids) > 0 THEN
        PERFORM public._conci_permitir_escritura_cerrada();

        UPDATE public."Conciliación Manifiestos"
           SET cierre_id = v_cierre_id,
               "CIERRE SUBSECRETARIA" = to_char(v_fecha_corte, 'DD/MM/YYYY'),
               cierre_es_carga_reportado = ((public._conci_clasificacion_reportable(to_jsonb("Conciliación Manifiestos")) ->> 'es_carga')::boolean),
               cierre_aerolinea_reportada = public._conci_clasificacion_reportable(to_jsonb("Conciliación Manifiestos")) ->> 'aerolinea'
         WHERE id = ANY (v_ids);

        INSERT INTO public.conciliacion_cierres_snapshot (cierre_id, manifiesto_id, datos_snapshot)
        SELECT v_cierre_id, mm.id, to_jsonb(mm)
          FROM public."Conciliación Manifiestos" mm
         WHERE mm.id = ANY (v_ids);

        PERFORM public._conci_fin_escritura_cerrada();
    END IF;

    RETURN jsonb_build_object(
        'cierre_id', v_cierre_id,
        'fecha_corte', v_fecha_corte,
        'instante_logico', v_instante,
        'total_manifiestos', v_total_manifiestos,
        'total_ajustes_consumidos', v_total_ajustes,
        'totales_fijo', v_totales_fijo,
        'totales_ajustes', v_totales_ajustes,
        'totales_reportados', v_totales_reportados,
        'cerrado_por_nombre', v_nombre,
        'cerrado_en', v_instante
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_cerrar_subsecretaria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_cerrar_subsecretaria() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_cerrar_subsecretaria() IS
    'Corte de Subsecretaría. Cierra TODOS los manifiestos del nuevo mecanismo '
    'que sigan sin cerrar (criterio: cierre_id IS NULL + cierre_capturado_en '
    'dentro de la frontera), NUNCA por fecha de operación, y les escribe la '
    'fecha del corte en "CIERRE SUBSECRETARIA". SIN parámetros: la fecha del '
    'corte es el día en curso en México y no se puede elegir. Exige '
    'privilegio, reautenticación reciente y el lock de contabilidad.';

-- =============================================================================
-- 9) RPC: corregir / solicitar corrección de un manifiesto cerrado
--
-- TODA corrección autorizada genera un EVENTO del ledger con la fila completa
-- antes y después, sea el campo numérico o descriptivo. Un campo irrelevante
-- para los informes produce un evento cuyo efecto neto reportable es cero —
-- preferible a perder la trazabilidad.
--
-- Si quien llama YA puede autorizar correcciones, se aplica de inmediato
-- (usuario_modifica = usuario_autoriza) y exige reautenticación reciente. Si
-- NO puede, queda como solicitud 'pendiente': no toca el manifiesto, no genera
-- evento, no toma el lock de contabilidad (no cambia nada contable) y no pide
-- contraseña.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conciliacion_solicitar_correccion(
    p_manifiesto_id bigint,
    p_campo text,
    p_valor_nuevo text,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_nivel text;
    v_puede_autorizar boolean;
    v_nombre text;
    v_instante timestamptz;
    v_manifiesto record;
    v_datos_antes jsonb;
    v_datos_despues jsonb;
    v_delta jsonb;
    v_valor_anterior_text text;
    v_diferencia numeric;
    v_ajuste_id bigint;
    v_solicitud_id bigint;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;

    v_nivel := public.conciliacion_manifiestos_access_level(auth.uid());
    IF v_nivel = 'none' THEN
        RAISE EXCEPTION 'No tienes acceso a Conciliación > Manifiestos.' USING ERRCODE = '42501';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Debes indicar el motivo de la corrección.' USING ERRCODE = '22004';
    END IF;

    -- Whitelist ANTES de cualquier SQL dinámico. "CIERRE SUBSECRETARIA" no
    -- está en ella: el corte al que pertenece una fila no se corrige a mano.
    IF NOT (p_campo = ANY (public._conci_campos_editables_cierre())) THEN
        RAISE EXCEPTION 'Campo no corregible: %', p_campo USING ERRCODE = '22023';
    END IF;

    v_puede_autorizar := public.conciliacion_puede_autorizar_correccion();
    v_nombre := public._conci_usuario_nombre();

    -- ── Rama SOLICITUD: no cambia nada contable ──────────────────────────
    IF NOT v_puede_autorizar THEN
        SELECT * INTO v_manifiesto
          FROM public."Conciliación Manifiestos"
         WHERE id = p_manifiesto_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Manifiesto % no encontrado.', p_manifiesto_id USING ERRCODE = 'P0002';
        END IF;
        IF v_manifiesto.cierre_id IS NULL THEN
            RAISE EXCEPTION 'El manifiesto % no está cerrado; edítalo directamente en la tabla.', p_manifiesto_id
                USING ERRCODE = '22023';
        END IF;
        -- El índice único parcial ya lo impediría; esto es sólo para dar un
        -- mensaje legible en vez de una violación de índice.
        IF EXISTS (
            SELECT 1 FROM public.conciliacion_correcciones
             WHERE manifiesto_id = p_manifiesto_id AND campo = p_campo AND estado = 'pendiente'
        ) THEN
            RAISE EXCEPTION 'Ya existe una solicitud pendiente para el campo % de este manifiesto.', p_campo
                USING ERRCODE = '23505';
        END IF;

        v_valor_anterior_text := to_jsonb(v_manifiesto) ->> p_campo;

        INSERT INTO public.conciliacion_correcciones (
            manifiesto_id, cierre_original_id, campo,
            valor_anterior, valor_nuevo, motivo, estado,
            usuario_modifica, usuario_modifica_nombre
        ) VALUES (
            p_manifiesto_id, v_manifiesto.cierre_id, p_campo,
            v_valor_anterior_text, p_valor_nuevo, btrim(p_motivo), 'pendiente',
            auth.uid(), v_nombre
        )
        RETURNING id INTO v_solicitud_id;

        RETURN jsonb_build_object(
            'solicitud_id', v_solicitud_id,
            'manifiesto_id', p_manifiesto_id,
            'campo', p_campo,
            'valor_anterior', v_valor_anterior_text,
            'valor_nuevo', p_valor_nuevo,
            'diferencia', NULL,
            'ajuste_id', NULL,
            'estado', 'pendiente'
        );
    END IF;

    -- ── Rama APLICACIÓN DIRECTA: sí cambia la contabilidad oficial ───────
    IF NOT public._conci_reautenticacion_reciente(300) THEN
        RAISE EXCEPTION 'Se requiere confirmar tu contraseña recientemente para aplicar esta corrección.'
            USING ERRCODE = '28000';
    END IF;

    -- Mismo lock que el corte, y el instante lógico después de tenerlo.
    PERFORM public._conci_lock_contabilidad();
    v_instante := clock_timestamp();

    SELECT * INTO v_manifiesto
      FROM public."Conciliación Manifiestos"
     WHERE id = p_manifiesto_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manifiesto % no encontrado.', p_manifiesto_id USING ERRCODE = 'P0002';
    END IF;
    IF v_manifiesto.cierre_id IS NULL THEN
        RAISE EXCEPTION 'El manifiesto % no está cerrado; edítalo directamente en la tabla.', p_manifiesto_id
            USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.conciliacion_correcciones
         WHERE manifiesto_id = p_manifiesto_id AND campo = p_campo AND estado = 'pendiente'
    ) THEN
        RAISE EXCEPTION 'Ya existe una solicitud pendiente para el campo % de este manifiesto.', p_campo
            USING ERRCODE = '23505';
    END IF;

    v_datos_antes := to_jsonb(v_manifiesto);
    v_valor_anterior_text := v_datos_antes ->> p_campo;

    -- El id va parametrizado con USING (tipo fijo bigint). El VALOR sigue con
    -- %L y no con USING porque las columnas de esta tabla son de tipos
    -- heterogéneos por historia (numeric y text): un parámetro USING ya tipado
    -- como text no se coacciona a numeric —PostgreSQL no tiene cast de
    -- asignación text→numeric—, mientras que un literal SQL (lo que produce
    -- %L) sí se convierte con la función de entrada del tipo destino.
    -- format() escapa %L igual que quote_literal(): no es concatenación
    -- insegura, y el identificador ya pasó por whitelist.
    PERFORM public._conci_permitir_escritura_cerrada();
    EXECUTE format('UPDATE public.%I SET %I = %L WHERE id = $1',
                   'Conciliación Manifiestos', p_campo, p_valor_nuevo)
      USING p_manifiesto_id;
    UPDATE public."Conciliación Manifiestos" AS mm
       SET cierre_es_carga_reportado = ((public._conci_clasificacion_reportable(to_jsonb(mm)) ->> 'es_carga')::boolean),
           cierre_aerolinea_reportada = public._conci_clasificacion_reportable(to_jsonb(mm)) ->> 'aerolinea'
     WHERE mm.id = p_manifiesto_id;
    PERFORM public._conci_fin_escritura_cerrada();

    SELECT to_jsonb(mm) INTO v_datos_despues
      FROM public."Conciliación Manifiestos" mm
     WHERE mm.id = p_manifiesto_id;

    v_delta := public._conci_delta_numerico(v_datos_antes, v_datos_despues);
    v_diferencia := (v_delta ->> p_campo)::numeric;

    -- Ledger append-only: SIEMPRE un evento nuevo, numérico o no.
    INSERT INTO public.conciliacion_ajustes (
        manifiesto_id, cierre_origen_id, campo, valor_anterior, valor_nuevo,
        datos_antes, datos_despues, delta_numerico, aprobado_en
    ) VALUES (
        p_manifiesto_id, v_manifiesto.cierre_id, p_campo, v_valor_anterior_text, p_valor_nuevo,
        v_datos_antes, v_datos_despues, v_delta, v_instante
    )
    RETURNING id INTO v_ajuste_id;

    INSERT INTO public.conciliacion_correcciones (
        manifiesto_id, cierre_original_id, ajuste_id, campo,
        valor_anterior, valor_nuevo, diferencia, motivo, estado,
        usuario_modifica, usuario_modifica_nombre,
        usuario_autoriza, usuario_autoriza_nombre, resuelto_en
    ) VALUES (
        p_manifiesto_id, v_manifiesto.cierre_id, v_ajuste_id, p_campo,
        v_valor_anterior_text, p_valor_nuevo, v_diferencia, btrim(p_motivo), 'aplicada',
        auth.uid(), v_nombre, auth.uid(), v_nombre, v_instante
    )
    RETURNING id INTO v_solicitud_id;

    RETURN jsonb_build_object(
        'solicitud_id', v_solicitud_id,
        'manifiesto_id', p_manifiesto_id,
        'campo', p_campo,
        'valor_anterior', v_valor_anterior_text,
        'valor_nuevo', p_valor_nuevo,
        'diferencia', v_diferencia,
        'delta', v_delta,
        'ajuste_id', v_ajuste_id,
        'estado', 'aplicada'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_solicitar_correccion(bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_solicitar_correccion(bigint, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_solicitar_correccion(bigint, text, text, text) IS
    'Corrige un campo de un manifiesto cerrado. Si el solicitante ya puede '
    'autorizar, se aplica de inmediato bajo el lock de contabilidad y genera '
    'un evento del ledger con la fila completa antes/después; si no, queda '
    '"pendiente" sin tocar nada.';

-- =============================================================================
-- 10) RPC: resolver (aprobar / rechazar) una solicitud pendiente
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conciliacion_resolver_solicitud_correccion(
    p_solicitud_id bigint,
    p_aprobar boolean,
    p_comentario text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_sol record;
    v_nombre text;
    v_instante timestamptz;
    v_manifiesto record;
    v_datos_antes jsonb;
    v_datos_despues jsonb;
    v_delta jsonb;
    v_valor_anterior_text text;
    v_diferencia numeric;
    v_ajuste_id bigint;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;

    IF NOT public.conciliacion_puede_autorizar_correccion() THEN
        RAISE EXCEPTION 'No tienes privilegio para resolver solicitudes de corrección.'
            USING ERRCODE = '42501';
    END IF;

    -- Resolver siempre escribe al menos la auditoría, y aprobar además escribe
    -- el manifiesto: se exige contraseña reciente en ambos casos.
    IF NOT public._conci_reautenticacion_reciente(300) THEN
        RAISE EXCEPTION 'Se requiere confirmar tu contraseña recientemente para resolver esta solicitud.'
            USING ERRCODE = '28000';
    END IF;

    -- Mismo lock que el corte (también al rechazar: es una sola puerta, y una
    -- resolución es un acto poco frecuente).
    PERFORM public._conci_lock_contabilidad();
    v_instante := clock_timestamp();

    SELECT * INTO v_sol
      FROM public.conciliacion_correcciones
     WHERE id = p_solicitud_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitud % no encontrada.', p_solicitud_id USING ERRCODE = 'P0002';
    END IF;

    IF v_sol.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'La solicitud % ya fue resuelta (estado=%).', p_solicitud_id, v_sol.estado
            USING ERRCODE = '22023';
    END IF;

    v_nombre := public._conci_usuario_nombre();

    IF NOT p_aprobar THEN
        -- Rechazo: cero efectos funcionales. No toca el manifiesto, no crea
        -- evento, no altera snapshots ni totales.
        UPDATE public.conciliacion_correcciones
           SET estado = 'rechazada',
               diferencia = NULL,
               usuario_autoriza = auth.uid(),
               usuario_autoriza_nombre = v_nombre,
               comentario_resolucion = p_comentario,
               resuelto_en = v_instante
         WHERE id = p_solicitud_id;

        RETURN jsonb_build_object('solicitud_id', p_solicitud_id, 'estado', 'rechazada');
    END IF;

    -- La corrección se aplica contra el valor VIGENTE al aprobar, no contra el
    -- que tenía al solicitarse (pudo cambiar mientras la solicitud esperaba).
    SELECT * INTO v_manifiesto
      FROM public."Conciliación Manifiestos"
     WHERE id = v_sol.manifiesto_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manifiesto % no encontrado.', v_sol.manifiesto_id USING ERRCODE = 'P0002';
    END IF;
    -- No debería poder ocurrir (cierre_id nunca vuelve a NULL), pero si
    -- ocurriera y se generara el evento, ese manifiesto contaría dos veces en
    -- el próximo corte: como fila del lote y como ajuste.
    IF v_manifiesto.cierre_id IS NULL THEN
        RAISE EXCEPTION 'El manifiesto % ya no está cerrado; esta solicitud no aplica.', v_sol.manifiesto_id
            USING ERRCODE = '22023';
    END IF;

    v_datos_antes := to_jsonb(v_manifiesto);
    v_valor_anterior_text := v_datos_antes ->> v_sol.campo;

    PERFORM public._conci_permitir_escritura_cerrada();
    EXECUTE format('UPDATE public.%I SET %I = %L WHERE id = $1',
                   'Conciliación Manifiestos', v_sol.campo, v_sol.valor_nuevo)
      USING v_sol.manifiesto_id;
    UPDATE public."Conciliación Manifiestos" AS mm
       SET cierre_es_carga_reportado = ((public._conci_clasificacion_reportable(to_jsonb(mm)) ->> 'es_carga')::boolean),
           cierre_aerolinea_reportada = public._conci_clasificacion_reportable(to_jsonb(mm)) ->> 'aerolinea'
     WHERE mm.id = v_sol.manifiesto_id;
    PERFORM public._conci_fin_escritura_cerrada();

    SELECT to_jsonb(mm) INTO v_datos_despues
      FROM public."Conciliación Manifiestos" mm
     WHERE mm.id = v_sol.manifiesto_id;

    v_delta := public._conci_delta_numerico(v_datos_antes, v_datos_despues);
    v_diferencia := (v_delta ->> v_sol.campo)::numeric;

    INSERT INTO public.conciliacion_ajustes (
        manifiesto_id, cierre_origen_id, campo, valor_anterior, valor_nuevo,
        datos_antes, datos_despues, delta_numerico, aprobado_en
    ) VALUES (
        v_sol.manifiesto_id, v_sol.cierre_original_id, v_sol.campo,
        v_valor_anterior_text, v_sol.valor_nuevo,
        v_datos_antes, v_datos_despues, v_delta, v_instante
    )
    RETURNING id INTO v_ajuste_id;

    UPDATE public.conciliacion_correcciones
       SET estado = 'aplicada',
           valor_anterior = v_valor_anterior_text,
           diferencia = v_diferencia,
           ajuste_id = v_ajuste_id,
           usuario_autoriza = auth.uid(),
           usuario_autoriza_nombre = v_nombre,
           comentario_resolucion = p_comentario,
           resuelto_en = v_instante
     WHERE id = p_solicitud_id;

    RETURN jsonb_build_object(
        'solicitud_id', p_solicitud_id,
        'estado', 'aplicada',
        'valor_anterior', v_valor_anterior_text,
        'valor_nuevo', v_sol.valor_nuevo,
        'diferencia', v_diferencia,
        'delta', v_delta,
        'ajuste_id', v_ajuste_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_resolver_solicitud_correccion(bigint, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_resolver_solicitud_correccion(bigint, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_resolver_solicitud_correccion(bigint, boolean, text) IS
    'Aprueba o rechaza una solicitud pendiente bajo el lock de contabilidad. '
    'Al aprobar aplica el cambio contra el valor vigente e inserta un evento '
    'del ledger con la fila completa antes/después; al rechazar no toca nada '
    'más que la auditoría.';

-- =============================================================================
-- 11) RPC de lectura: FIJO del lote abierto
--
-- FIJO  = lo capturado del LOTE VIGENTE (lo que entraría al próximo corte)
--         + el efecto neto de los ajustes pendientes, que entrarán a ese mismo
--         corte. Es la misma aritmética que producirá el informe después del
--         cierre: delta_numerico es, campo por campo, lo que la vista
--         reportable obtiene de −1 × ANTES y +1 × DESPUÉS.
-- PREVIO = responsabilidad del cliente, que ya cruza itinerario contra
--         manifiestos (_fuente === 'Solo Vuelos') y garantiza que un
--         movimiento nunca sea PREVIO y FIJO a la vez.
-- TOTAL  = FIJO + PREVIO, en el cliente.
--
-- Sin parámetro de fecha, a propósito: el lote no es un día, es "lo que falta
-- por cerrar". Sumar ajustes pendientes a un día concreto era justo la
-- aritmética que podía divergir del informe.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conciliacion_resumen_lote_abierto()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_baseline timestamptz;
    v_total integer := 0;
    v_totales_fijo jsonb := '{}'::jsonb;
    v_totales_ajustes jsonb := '{}'::jsonb;
    v_ajustes_pendientes integer := 0;
    v_ultimo jsonb := NULL;
    v_hoy date;
    v_ultima_fecha date;
    v_siguiente_fecha date;
    m record;
    a record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;
    IF public.conciliacion_manifiestos_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'No tienes acceso a Conciliación > Manifiestos.' USING ERRCODE = '42501';
    END IF;

    SELECT c.baseline_en INTO v_baseline FROM public.conciliacion_cierre_config c WHERE c.id;

    FOR m IN
        SELECT *
          FROM public."Conciliación Manifiestos"
         WHERE cierre_id IS NULL
           AND cierre_capturado_en IS NOT NULL
           AND cierre_capturado_en >= v_baseline
    LOOP
        v_total := v_total + 1;
        v_totales_fijo := public._conci_jsonb_sum_numerico(
            v_totales_fijo, public._conci_totales_numericos(to_jsonb(m))
        );
    END LOOP;

    FOR a IN
        SELECT delta_numerico
          FROM public.conciliacion_ajustes
         WHERE estado = 'pendiente'
    LOOP
        v_ajustes_pendientes := v_ajustes_pendientes + 1;
        v_totales_ajustes := public._conci_jsonb_sum_numerico(v_totales_ajustes, a.delta_numerico);
    END LOOP;

    SELECT jsonb_build_object(
               'cierre_id', c.id,
               'fecha_corte', c.fecha_corte,
               'cerrado_en', c.cerrado_en,
               'cerrado_por_nombre', c.cerrado_por_nombre,
               'total_manifiestos', c.total_manifiestos,
               'total_ajustes', c.total_ajustes,
               'totales_reportados', c.totales_reportados
           )
      INTO v_ultimo
      FROM public.conciliacion_cierres_subsecretaria c
     ORDER BY c.fecha_corte DESC, c.id DESC
     LIMIT 1;

    -- Fecha en la que podrá emitirse el siguiente corte: hoy, salvo que hoy ya
    -- se haya cerrado, en cuyo caso el día siguiente. Misma regla que aplica
    -- conciliacion_cerrar_subsecretaria(); se expone para que la interfaz
    -- pueda decir a quién captura a las 18:05 cuándo entrará su manifiesto, en
    -- vez de dejarle descubrirlo con un error.
    v_hoy := (now() AT TIME ZONE 'America/Mexico_City')::date;
    SELECT max(c.fecha_corte) INTO v_ultima_fecha
      FROM public.conciliacion_cierres_subsecretaria c;
    v_siguiente_fecha := greatest(v_hoy, coalesce(v_ultima_fecha + 1, v_hoy));

    RETURN jsonb_build_object(
        'baseline_en', v_baseline,
        'total_manifiestos', v_total,
        'ajustes_pendientes', v_ajustes_pendientes,
        'totales_fijo', v_totales_fijo,
        'totales_ajustes', v_totales_ajustes,
        'totales_reportados', public._conci_jsonb_sum_numerico(v_totales_fijo, v_totales_ajustes),
        'ultimo_cierre', v_ultimo,
        'cierre_de_hoy_realizado', (v_ultima_fecha IS NOT NULL AND v_ultima_fecha >= v_hoy),
        'siguiente_fecha_corte', v_siguiente_fecha
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_resumen_lote_abierto() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_resumen_lote_abierto() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_resumen_lote_abierto() IS
    'FIJO del lote que entraría al próximo corte: lo capturado y aún no '
    'cerrado más el efecto neto de los ajustes pendientes. Misma aritmética '
    'que verá el informe tras el cierre. Devuelve también en qué fecha podrá '
    'emitirse ese próximo corte (siguiente_fecha_corte), porque sólo se admite '
    'un cierre por fecha.';

-- =============================================================================
-- 12) RPC de lectura: detalle y bandeja
--
-- Los dos son SECURITY INVOKER a propósito: así la visibilidad la decide el
-- RLS de las tablas y no puede divergir de él. En particular
-- conciliacion_correcciones —donde viven los motivos y los nombres— sólo la ve
-- quien puede autorizar o quien la escribió, y esta ruta no da la vuelta a esa
-- política como sí lo haría un SECURITY DEFINER.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conciliacion_ajustes_detalle(p_manifiesto_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'ajustes', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', a.id,
                       'campo', a.campo,
                       'valor_anterior', a.valor_anterior,
                       'valor_nuevo', a.valor_nuevo,
                       'delta', a.delta_numerico,
                       'estado', a.estado,
                       'aprobado_en', a.aprobado_en,
                       'aplicado_en', a.aplicado_en,
                       'cierre_origen_id', a.cierre_origen_id,
                       'cierre_aplicacion_id', a.cierre_aplicacion_id
                   ) ORDER BY a.aprobado_en DESC)
              FROM public.conciliacion_ajustes a
             WHERE a.manifiesto_id = p_manifiesto_id
        ), '[]'::jsonb),
        'correcciones', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', c.id,
                       'campo', c.campo,
                       'valor_anterior', c.valor_anterior,
                       'valor_nuevo', c.valor_nuevo,
                       'diferencia', c.diferencia,
                       'motivo', c.motivo,
                       'estado', c.estado,
                       'usuario_modifica_nombre', c.usuario_modifica_nombre,
                       'usuario_autoriza_nombre', c.usuario_autoriza_nombre,
                       'creado_en', c.creado_en,
                       'resuelto_en', c.resuelto_en
                   ) ORDER BY c.creado_en DESC)
              FROM public.conciliacion_correcciones c
             WHERE c.manifiesto_id = p_manifiesto_id
        ), '[]'::jsonb)
    );
$$;

REVOKE ALL ON FUNCTION public.conciliacion_ajustes_detalle(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_ajustes_detalle(bigint) TO authenticated;

COMMENT ON FUNCTION public.conciliacion_ajustes_detalle(bigint) IS
    'Eventos y correcciones de un manifiesto. SECURITY INVOKER: la visibilidad '
    'la decide el RLS, no esta función. Quien no puede autorizar sólo ve sus '
    'propias solicitudes.';

CREATE OR REPLACE FUNCTION public.conciliacion_solicitudes_pendientes()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', c.id,
                   'manifiesto_id', c.manifiesto_id,
                   'campo', c.campo,
                   'valor_anterior', c.valor_anterior,
                   'valor_nuevo', c.valor_nuevo,
                   'diferencia', c.diferencia,
                   'motivo', c.motivo,
                   'usuario_modifica_nombre', c.usuario_modifica_nombre,
                   'creado_en', c.creado_en
               ) ORDER BY c.creado_en ASC)
          FROM public.conciliacion_correcciones c
         WHERE c.estado = 'pendiente'
    ), '[]'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.conciliacion_solicitudes_pendientes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_solicitudes_pendientes() TO authenticated;

COMMENT ON FUNCTION public.conciliacion_solicitudes_pendientes() IS
    'Bandeja de solicitudes pendientes. SECURITY INVOKER: el RLS de '
    'conciliacion_correcciones ya devuelve todas a quien puede autorizar y '
    'sólo las propias a cualquier otro.';

-- =============================================================================
-- 13) VISTA REPORTABLE — la única fuente de los informes oficiales
--
-- Cuatro bloques, uno por naturaleza de fila:
--
--   A) LEGACY y ABIERTOS  → la fila viva. Los legacy (cierre_capturado_en
--      NULL) salen exactamente como salen hoy: este mecanismo no los toca.
--
--   B) CERRADOS           → SIEMPRE el snapshot, tengan o no correcciones.
--      Es la regla, no una optimización: la tabla viva es el estado operativo
--      vigente y el snapshot es el estado oficialmente reportado. Son dos
--      conceptos distintos y el informe usa el segundo. Por eso el JOIN es
--      interno y no un coalesce con la fila viva: "cerrado ⇒ snapshot", sin
--      excepciones. (Ambas escrituras ocurren en la misma transacción del
--      corte, con UNIQUE (cierre_id, manifiesto_id): no puede haber huérfanos.)
--
--   C) y D) AJUSTES APLICADOS → dos contribuciones sintéticas por evento:
--      −1 × datos_antes y +1 × datos_despues. Ambas se reportan con la
--      "CIERRE SUBSECRETARIA" del corte QUE LAS CONSUMIÓ —no la del corte
--      original—, que es lo que hace que una corrección de ayer aparezca en el
--      informe de hoy. La "FECHA" de operación se conserva intacta, así que
--      los reportes que agrupan por FECHA (Plantillas 1 y 2) ven la corrección
--      en el día del vuelo, y los que agrupan por corte (Subsecretaría) la ven
--      en el corte que la aplicó. Cada uno correcto bajo su propia lógica.
--
-- _signo es lo que impide inventar operaciones: quien agregue esta vista debe
-- multiplicar por él tanto las cifras como el conteo de operaciones. Una
-- corrección numérica aporta −1 y +1 operaciones (neto 0) y −150 +180 pasajeros
-- (neto +30); una reclasificación aporta −1 op en el bucket viejo y +1 en el
-- nuevo.
--
-- _uid da un orden total estable para paginar (los informes descargan por
-- páginas con .range()): ordenar por "id" repetiría o saltaría filas en los
-- bordes de página, porque una fila sintética comparte id con su manifiesto.
--
-- security_invoker: el RLS de las tablas base se evalúa con el usuario que
-- consulta. Requiere PG15+, ya exigido al inicio de la migración — no hay
-- camino en el que esta vista se cree sin él.
-- =============================================================================

-- DROP + CREATE (no CREATE OR REPLACE): al reinstalar, OR REPLACE exigiría que
-- la lista de columnas fuera idéntica, y aquí puede cambiar si la tabla de
-- captura gana una columna. Nada depende de esta vista más que los informes.
DROP VIEW IF EXISTS public.v_conciliacion_manifiestos_reportable;

CREATE VIEW public.v_conciliacion_manifiestos_reportable
WITH (security_invoker = true) AS
    -- A) y C): legacy y abiertos → fila viva.
    SELECT m.*,
           false AS _es_ajuste,
           1::smallint AS _signo,
           NULL::bigint AS _ajuste_id,
           NULL::bigint AS _cierre_aplicacion_id,
           'M' || lpad(m.id::text, 18, '0') AS _uid
      FROM public."Conciliación Manifiestos" m
     WHERE m.cierre_id IS NULL

    UNION ALL

    -- B) cerrados → snapshot, siempre, y SIN pasar por la fila viva.
    --
    -- Parte de conciliacion_cierres_snapshot, no de "Conciliación Manifiestos":
    -- el informe histórico no puede depender de que la fila viva siga
    -- existiendo. Si mantenimiento administrativo borrara un manifiesto ya
    -- cerrado, con un JOIN a la tabla viva el oficio de ese día cambiaría al
    -- regenerarlo — justo lo que este mecanismo existe para impedir. El
    -- snapshot es autosuficiente: lo tomó el corte DESPUÉS de escribir
    -- cierre_id y "CIERRE SUBSECRETARIA", así que ya trae la fila oficial
    -- completa.
    --
    -- Sin duplicados frente al bloque A: A sirve sólo filas con cierre_id
    -- NULL, y una fila con snapshot tiene cierre_id NOT NULL siempre — se
    -- escriben en la misma transacción del corte, ningún cliente puede
    -- devolver cierre_id a NULL (trigger + FK), y el único sitio que lo hace
    -- es el bloque de reinstalación, que borra también los snapshots.
    --
    -- jsonb_populate_record va en un LATERAL y no como (…).* a propósito:
    -- (f(x)).* evalúa la función UNA VEZ POR COLUMNA de salida, o sea unas
    -- cuarenta veces por fila en esta tabla. En FROM se evalúa una sola vez.
    SELECT r.*,
           false,
           1::smallint,
           NULL::bigint,
           NULL::bigint,
           'M' || lpad(s.manifiesto_id::text, 18, '0')
      FROM public.conciliacion_cierres_snapshot s
      CROSS JOIN LATERAL jsonb_populate_record(
            NULL::public."Conciliación Manifiestos", s.datos_snapshot
      ) AS r

    UNION ALL

    -- D-) contribución negativa: la fila tal como se reportó antes.
    SELECT r.*,
           true,
           (-1)::smallint,
           a.id,
           a.cierre_aplicacion_id,
           'X' || lpad(a.id::text, 18, '0') || 'A'
      FROM public.conciliacion_ajustes a
      JOIN public.conciliacion_cierres_subsecretaria c
        ON c.id = a.cierre_aplicacion_id
      CROSS JOIN LATERAL jsonb_populate_record(
            NULL::public."Conciliación Manifiestos",
            a.datos_antes || jsonb_build_object(
                'CIERRE SUBSECRETARIA', to_char(c.fecha_corte, 'DD/MM/YYYY')
            )
      ) AS r
     WHERE a.estado = 'aplicado'

    UNION ALL

    -- D+) contribución positiva: la fila corregida.
    SELECT r.*,
           true,
           1::smallint,
           a.id,
           a.cierre_aplicacion_id,
           'X' || lpad(a.id::text, 18, '0') || 'D'
      FROM public.conciliacion_ajustes a
      JOIN public.conciliacion_cierres_subsecretaria c
        ON c.id = a.cierre_aplicacion_id
      CROSS JOIN LATERAL jsonb_populate_record(
            NULL::public."Conciliación Manifiestos",
            a.datos_despues || jsonb_build_object(
                'CIERRE SUBSECRETARIA', to_char(c.fecha_corte, 'DD/MM/YYYY')
            )
      ) AS r
     WHERE a.estado = 'aplicado';

COMMENT ON VIEW public.v_conciliacion_manifiestos_reportable IS
    'Única fuente server-side de los informes oficiales. Filas legacy y '
    'abiertas en vivo; TODA fila cerrada desde su snapshot; y dos '
    'contribuciones sintéticas (_signo −1/+1) por cada ajuste aplicado, '
    'fechadas en "CIERRE SUBSECRETARIA" con el corte que las consumió. Quien '
    'la agregue DEBE multiplicar cifras y conteo de operaciones por _signo.';

-- Lectura reportable en una sola consulta/snapshot. El corte se filtra por la
-- fecha de cierre cuando existe; sólo filas legacy o abiertas usan la fecha
-- operativa. Así las dos contribuciones de un ajuste siempre viajan juntas.
CREATE OR REPLACE FUNCTION public.conciliacion_reporte_reportable(p_hasta date)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT to_jsonb(v)
      FROM public.v_conciliacion_manifiestos_reportable v
     WHERE (
        public._aifa_parse_manifest_date(v."CIERRE SUBSECRETARIA") <= p_hasta
        OR (
            nullif(btrim(v."CIERRE SUBSECRETARIA"), '') IS NULL
            AND coalesce(v._portal_flight_date, public._aifa_parse_manifest_date(v."FECHA")) <= p_hasta
        )
     )
     ORDER BY v._uid;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_reporte_reportable(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliacion_reporte_reportable(date) TO authenticated;

-- =============================================================================
-- 14) RLS Y GRANTS — mínimo privilegio
--
-- ESCRITURA: ninguna. Las cinco tablas del mecanismo no tienen policy ni GRANT
-- de INSERT/UPDATE/DELETE para authenticated: la única vía de escritura son
-- las funciones SECURITY DEFINER de arriba. Desde DevTools o la API REST es
-- imposible marcar un ajuste como consumido, alterar un snapshot, insertar un
-- cierre o reescribir totales históricos.
--
-- LECTURA: acotada a quien tiene acceso al módulo. conciliacion_correcciones
-- además oculta las solicitudes ajenas a quien no puede autorizarlas: los
-- motivos y los nombres de otros usuarios no tienen por qué ser visibles para
-- todos.
-- =============================================================================

ALTER TABLE public.conciliacion_cierre_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacion_cierres_subsecretaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacion_cierres_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacion_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacion_correcciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conciliacion_cierre_config_select ON public.conciliacion_cierre_config;
CREATE POLICY conciliacion_cierre_config_select
    ON public.conciliacion_cierre_config FOR SELECT TO authenticated
    USING (public.conciliacion_manifiestos_access_level(auth.uid()) <> 'none');

-- Las TRES tablas que alimentan la vista reportable se leen con el MISMO
-- criterio que la tabla de captura (policy cm_select_authenticated:
-- auth.role() = 'authenticated'), y no con el de escritura del módulo.
--
-- Por qué, y es importante: la vista tiene security_invoker, así que sirve una
-- fila cerrada SOLO si quien consulta puede leer su snapshot. Con un criterio
-- más estrecho que el de la tabla base, un usuario con Conciliación en modo
-- lectura —que sí puede abrir Reportes, porque Reportes hereda el permiso de
-- Conciliación, pero cuyo conciliacion_manifiestos_access_level es 'none'—
-- generaría un oficio al que le faltarían EN SILENCIO todos los periodos
-- cerrados. Un informe oficial incompleto sin avisar es peor que cualquier
-- cosa que esto pudiera ocultar.
--
-- Y no expone nada nuevo: un snapshot es una copia de una fila que ese mismo
-- usuario ya puede leer entera en "Conciliación Manifiestos", y datos_antes /
-- datos_despues son dos versiones de esa misma fila. Lo verdaderamente
-- sensible —motivos y nombres de quién pidió qué— vive en
-- conciliacion_correcciones, que sí queda restringida abajo.
DROP POLICY IF EXISTS conciliacion_cierres_subsecretaria_select ON public.conciliacion_cierres_subsecretaria;
CREATE POLICY conciliacion_cierres_subsecretaria_select
    ON public.conciliacion_cierres_subsecretaria FOR SELECT TO authenticated
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS conciliacion_cierres_snapshot_select ON public.conciliacion_cierres_snapshot;
CREATE POLICY conciliacion_cierres_snapshot_select
    ON public.conciliacion_cierres_snapshot FOR SELECT TO authenticated
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS conciliacion_ajustes_select ON public.conciliacion_ajustes;
CREATE POLICY conciliacion_ajustes_select
    ON public.conciliacion_ajustes FOR SELECT TO authenticated
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS conciliacion_correcciones_select ON public.conciliacion_correcciones;
CREATE POLICY conciliacion_correcciones_select
    ON public.conciliacion_correcciones FOR SELECT TO authenticated
    USING (
        public.conciliacion_puede_autorizar_correccion()
        OR usuario_modifica = auth.uid()
    );

GRANT SELECT ON public.conciliacion_cierre_config TO authenticated;
GRANT SELECT ON public.conciliacion_cierres_subsecretaria TO authenticated;
GRANT SELECT ON public.conciliacion_cierres_snapshot TO authenticated;
GRANT SELECT ON public.conciliacion_ajustes TO authenticated;
GRANT SELECT ON public.conciliacion_correcciones TO authenticated;

-- La vista reportable hereda el RLS de las tablas base (security_invoker).
-- Sólo lectura, y nunca para anon.
GRANT SELECT ON public.v_conciliacion_manifiestos_reportable TO authenticated;
REVOKE ALL ON public.v_conciliacion_manifiestos_reportable FROM PUBLIC, anon;
GRANT SELECT ON public.v_conciliacion_manifiestos_reportable TO authenticated;

-- ACL final explícita: PUBLIC, anon y authenticated parten de cero para los
-- helpers internos y sólo las RPC de negocio quedan ejecutables por usuarios
-- autenticados. Esto evita que un GRANT heredado de una instalación previa
-- sobreviva a la migración.
REVOKE ALL ON FUNCTION public._conci_campos_numericos_cierre() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_campos_editables_cierre() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_jsonb_sum_numerico(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_totales_numericos(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_delta_numerico(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_clasificacion_reportable(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_lock_contabilidad() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_tiene_lock_contabilidad() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_permitir_escritura_cerrada() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_fin_escritura_cerrada() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_reautenticacion_reciente(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_usuario_nombre() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conci_tiene_flag_permiso(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.conciliacion_cerrar_subsecretaria() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_solicitar_correccion(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_resolver_solicitud_correccion(bigint, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_manifiestos_set_privilegio(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_privilegios_de_usuario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_puede_autorizar_correccion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_resumen_lote_abierto() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_ajustes_detalle(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_solicitudes_pendientes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliacion_reporte_reportable(date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.conciliacion_cerrar_subsecretaria() TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_solicitar_correccion(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_resolver_solicitud_correccion(bigint, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_manifiestos_set_privilegio(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_privilegios_de_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_puede_cerrar_subsecretaria() TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_puede_autorizar_correccion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_resumen_lote_abierto() TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_ajustes_detalle(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_solicitudes_pendientes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliacion_reporte_reportable(date) TO authenticated;

-- =============================================================================
-- 15) ÍNDICES SOBRE "Conciliación Manifiestos"
--
-- Sin CONCURRENTLY (ver MÉTODO DE DESPLIEGUE al inicio): ambos son sobre
-- columnas creadas en esta misma transacción y por tanto 100 % NULL, así que
-- construirlos es inmediato y el SHARE lock no se nota. A cambio, el archivo
-- entero corre dentro de una transacción bajo cualquier runner, incluida la
-- integración GitHub de Supabase.
-- =============================================================================

-- "Manifiestos aún abiertos" y resolución del FK del candado.
CREATE INDEX IF NOT EXISTS idx_conciliacion_manifiestos_cierre_id
    ON public."Conciliación Manifiestos" (cierre_id);

-- El lote de cada corte: índice parcial sobre exactamente las filas que la
-- consulta recorre (abiertas y del nuevo mecanismo).
CREATE INDEX IF NOT EXISTS idx_conciliacion_manifiestos_lote_abierto
    ON public."Conciliación Manifiestos" (cierre_capturado_en)
    WHERE cierre_id IS NULL AND cierre_capturado_en IS NOT NULL;

-- Refresca la caché de esquema de PostgREST para que las funciones, la vista y
-- las columnas nuevas queden disponibles de inmediato en la API REST.
NOTIFY pgrst, 'reload schema';

COMMIT;
