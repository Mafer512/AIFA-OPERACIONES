-- =============================================================================
-- 040 — Motor estadístico v2 · preparación
--
-- Parte de la reescritura del motor estadístico (v2) contra el esquema real
-- de maestra_operaciones. El trabajo va REPARTIDO EN SEIS ARCHIVOS porque el
-- editor SQL de Supabase corta la petición HTTP si una sola tarda demasiado, y
-- al ir dentro de una transacción se deshace entera: "Failed to fetch" y ni un
-- objeto creado.
--
--   040  preparación: diagnóstico de bloqueos, pausa del refresco automático,
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
-- =============================================================================
-- ESTE ARCHIVO NO SE CORRE DE UN TIRÓN. Son cuatro pasos, y los tres primeros
-- van SUELTOS, fuera de transacción, a propósito.
--
--   PASO 1  ¿quién tiene tomado el candado?      (sólo lectura, instantáneo)
--   PASO 2  pausar el refresco automático        (confirma solo)
--   PASO 3  soltar sesiones colgadas             (OPCIONAL — sólo si el 1 las muestra)
--   PASO 4  contrato de columnas + demolición    (una transacción, revisable)
--
-- CORRER CADA PASO SELECCIONÁNDOLO. El editor de Supabase manda lo que se
-- ejecuta junto en UN solo mensaje, y Postgres corre un mensaje con varias
-- sentencias como UNA transacción implícita. (Si aun así se corre completo,
-- el COMMIT que va antes del paso 4 cierra ese bloque y deja confirmada la
-- pausa del cron.)
--
-- POR QUÉ LOS TRES PRIMEROS VAN FUERA DE LA TRANSACCIÓN
--
--   La versión anterior de este archivo metía la pausa del refresco DENTRO del
--   BEGIN...ROLLBACK. Al terminar en ROLLBACK, la pausa se deshacía con todo lo
--   demás: nunca llegaba a ocurrir. Y aunque hubiera confirmado, desprogramar un
--   job de pg_cron NO detiene una corrida que ya está en marcha.
--
--   Por eso el paso 2 va suelto: confirma en el acto. Y por eso existe el paso
--   1: antes de intentar demoler hay que SABER quién tiene el candado, en vez de
--   suponerlo. Es lo que faltó las dos veces anteriores.
-- =============================================================================


-- =============================================================================
-- PASO 1 — ¿Quién tiene tomado el candado?
--
-- Correr estas dos consultas ANTES que nada. Son de sólo lectura e
-- instantáneas.
--
-- El error 55P03 (canceling statement due to lock timeout) significa que otra
-- sesión tiene tomados los objetos que hay que borrar. Los dos sospechosos:
--
--   · El refresco de pg_cron que dejó la 038, corriendo en este momento.
--     Se reconoce por la consulta REFRESH MATERIALIZED VIEW CONCURRENTLY.
--
--   · Una sesión HUÉRFANA de un intento anterior. Las dos primeras corridas de
--     esta migración llevaban statement_timeout = 0: el navegador se rindió con
--     "Failed to fetch", pero el servidor NO se enteró y siguió trabajando. Ese
--     backend puede llevar horas poblando la vista y reteniendo el candado.
--     Se reconoce por una duración larga y una consulta que empieza con
--     CREATE MATERIALIZED VIEW.
-- =============================================================================

-- 1a) Todo lo que está corriendo ahora mismo en esta base.
SELECT a.pid,
       a.state,
       now() - a.query_start                                      AS lleva_corriendo,
       a.wait_event_type || ' / ' || coalesce(a.wait_event, '—')  AS esperando,
       a.usename,
       a.application_name,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 140)        AS consulta
  FROM pg_stat_activity a
 WHERE a.datname = current_database()
   AND a.pid <> pg_backend_pid()
   AND a.state IS DISTINCT FROM 'idle'
 ORDER BY a.query_start NULLS LAST;

-- 1b) Quién tiene tomados, en concreto, los objetos del módulo estadístico.
--     Si esto devuelve renglones, ésos son los pid que estorban.
SELECT l.pid,
       c.relname                                           AS objeto,
       l.mode                                              AS candado,
       l.granted                                           AS concedido,
       now() - a.query_start                               AS lleva_corriendo,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 120) AS consulta
  FROM pg_locks l
  JOIN pg_class c      ON c.oid = l.relation
  JOIN pg_namespace n  ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
 WHERE ((n.nspname = 'public'
         AND (c.relname LIKE '%estadistica%' OR c.relname = 'maestra_operaciones'))
        -- También las tablas de pg_cron: desprogramar un job escribe en
        -- cron.job, y ahí también puede haber espera.
        OR n.nspname = 'cron')
   AND l.pid <> pg_backend_pid()
 ORDER BY l.granted, c.relname;

-- 1c) Quién espera a quién. Si alguna sesión está bloqueada, aquí aparece
--     junto con el pid que la bloquea. Vacío = nadie espera a nadie.
SELECT a.pid,
       pg_blocking_pids(a.pid)                             AS bloqueada_por,
       now() - a.query_start                               AS esperando_desde,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 120) AS consulta
  FROM pg_stat_activity a
 WHERE cardinality(pg_blocking_pids(a.pid)) > 0;


-- =============================================================================
-- PASO 2 — Pausar el refresco automático
--
-- Va SUELTO, sin BEGIN: confirma en el acto. Si fuera dentro de la transacción
-- del paso 4, el ROLLBACK de la primera pasada lo desharía y el job seguiría
-- despertando cada 15 minutos justo encima de la migración. Eso es exactamente
-- lo que pasaba antes.
--
-- El 045 lo vuelve a programar, ya con la vista nueva poblada.
--
-- OJO: esto evita que el job VUELVA a arrancar, pero no detiene el que ya esté
-- corriendo. Para ése, el paso 3.
-- =============================================================================
DO $cron$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
       AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refrescar_estadistica') THEN
        PERFORM cron.unschedule('refrescar_estadistica');
        RAISE NOTICE 'Refresco automático pausado. El 045 lo reanuda.';
    ELSE
        RAISE NOTICE 'No había refresco automático programado: nada que pausar.';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo pausar el refresco automático (%). Continúa.', SQLERRM;
END;
$cron$;

-- 2b) Confirmación VISIBLE. El editor de Supabase no muestra los RAISE
--     NOTICE, así que "Success. No rows returned" del paso 2 no dice si se
--     pausó o no había nada que pausar. Esto sí:
--       · CERO renglones  → el refresco automático quedó pausado. Seguir.
--       · un renglón      → sigue programado; volver a correr el paso 2.
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'refrescar_estadistica';


-- =============================================================================
-- PASO 3 — Soltar las sesiones que tienen el candado   (OPCIONAL)
--
-- CORRER SÓLO SI EL PASO 1 MOSTRÓ SESIONES COLGADAS, y sólo después de mirar
-- qué son. Esto CANCELA trabajo en curso: hay que saber lo que se está
-- deteniendo.
--
-- Para lo que aquí importa es seguro —un REFRESH interrumpido no corrompe nada,
-- la vista se queda como estaba, y este mismo lote la reconstruye entera— pero
-- no es una operación para lanzar a ciegas sobre una base productiva.
--
-- Las consultas van DELIBERADAMENTE comentadas. Descomentarlas sólo cuando ya
-- se haya visto en el paso 1 qué sesiones son.
-- =============================================================================

-- Primero lo suave: pedirle a la sesión que cancele la consulta (no la mata).
-- SELECT a.pid,
--        left(regexp_replace(a.query, '\s+', ' ', 'g'), 100) AS consulta_cancelada,
--        pg_cancel_backend(a.pid)                            AS cancelada
--   FROM pg_stat_activity a
--  WHERE a.datname = current_database()
--    AND a.pid <> pg_backend_pid()
--    AND a.state IS DISTINCT FROM 'idle'
--    AND (a.query ILIKE '%mv_estadistica_operaciones%'
--         OR a.query ILIKE '%REFRESH MATERIALIZED VIEW%');

-- Si con cancelar no basta (la sesión quedó "idle in transaction" reteniendo el
-- candado), lo siguiente la termina.
-- SELECT a.pid,
--        a.state,
--        left(regexp_replace(a.query, '\s+', ' ', 'g'), 100) AS ultima_consulta,
--        pg_terminate_backend(a.pid)                         AS terminada
--   FROM pg_stat_activity a
--  WHERE a.datname = current_database()
--    AND a.pid <> pg_backend_pid()
--    AND (a.query ILIKE '%mv_estadistica_operaciones%'
--         OR a.query ILIKE '%REFRESH MATERIALIZED VIEW%');

-- Después de cortar, volver a correr el PASO 1b: no debe quedar ningún renglón.


-- =============================================================================
-- PASO 4 — Contrato de columnas y demolición
--
-- Esto sí va en transacción. Termina en ROLLBACK: correrlo, revisar la
-- verificación del final y, si se ve bien, cambiar ROLLBACK por COMMIT y volver
-- a correr DESDE ESTE PASO (los tres anteriores no hay que repetirlos).
-- =============================================================================

-- Cierre explícito de lo anterior. Si este archivo se corre COMPLETO de un
-- tirón, Postgres ejecuta todo como una transacción implícita y el BEGIN de
-- abajo absorbería RETROACTIVAMENTE los pasos 1 a 3: el ROLLBACK final
-- desharía la pausa del cron. Este COMMIT cierra antes ese bloque. Corrido
-- paso por paso sólo produce un aviso inofensivo (no hay transacción en curso).
COMMIT;

BEGIN;

-- Freno de espera por bloqueos, y es la lección de las corridas fallidas.
--
-- Con statement_timeout = 0 un DROP bloqueado espera indefinidamente, hasta que
-- el navegador se rinde con un "Failed to fetch" que no dice nada — y peor, deja
-- el backend trabajando del lado del servidor.
--
-- Con lock_timeout, si algo tiene tomada la vista Postgres devuelve en 15
-- segundos un 55P03 legible y se sabe exactamente qué pasó. Es preferible fallar
-- rápido y claro que colgarse en silencio. Si sale 55P03: volver al paso 1.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

-- Mismo motivo que en 033/034/035/038: las funciones auxiliares de 010 y 023
-- llevan bloque EXCEPTION pero están marcadas PARALLEL SAFE, y en un plan
-- paralelo eso aborta con "25000: cannot start commands during a parallel
-- operation".
SET LOCAL max_parallel_workers_per_gather = 0;


-- -----------------------------------------------------------------------------
-- 4a) CONTRATO DE COLUMNAS — falla temprano y con nombre y apellido
--
--     En UNA sola consulta sobre pg_attribute. La versión anterior lanzaba 84
--     consultas separadas contra information_schema.columns, que es una vista
--     con varios joins y comprobación de permisos: ochenta y cuatro veces eso
--     es una parte considerable de por qué la migración no llegaba a terminar.
-- -----------------------------------------------------------------------------
DO $contrato$
DECLARE
    v_faltan text[];
BEGIN
    IF to_regclass('public.vw_maestra_operaciones') IS NULL THEN
        RAISE EXCEPTION
            'No existe public.vw_maestra_operaciones. Es la fuente principal del módulo estadístico.';
    END IF;
    IF to_regclass('public.maestra_operaciones') IS NULL THEN
        RAISE EXCEPTION 'No existe public.maestra_operaciones.';
    END IF;

    SELECT array_agg(r.tabla || '.' || r.col ORDER BY r.tabla, r.col)
      INTO v_faltan
      FROM (
        -- De la vista sólo se exigen los campos que el repositorio documenta
        -- que resuelve (023, bloque de verificación; 032, comentario de columna).
        SELECT 'vw_maestra_operaciones' AS tabla, unnest(ARRAY[
            'id', 'aerolinea', 'matricula', 'causa_demora', 'fuente_principal'
        ]) AS col
        UNION ALL
        -- De la tabla, las columnas operacionales que usa el motor.
        SELECT 'maestra_operaciones', unnest(ARRAY[
            -- identidad y periodo
            'id', 'fecha_operacion', 'tipo_movimiento', 'numero_vuelo', 'folio',
            'cancelado', 'estatus_vuelo', 'estado_puntualidad',
            -- rotación
            'rotacion_key', 'movimiento_relacionado_id', 'aodb_legacy_id',
            -- identidad comercial
            'aerolinea_id', 'aerolinea_conciliacion_id', 'aerolinea_origen',
            'matricula_id', 'matricula_origen', 'estatus_matricula',
            'tipo_aeronave_codigo', 'tipo_servicio_codigo', 'tipo_servicio_origen',
            'tipo_operacion', 'tipo_manifiesto', 'codigo_afac_aifa',
            -- geografía
            'origen_iata', 'escala_iata', 'destino_iata',
            'origen_origen', 'escala_origen', 'destino_origen', 'ruta_origen', 'routing',
            -- infraestructura
            'posicion', 'puertas', 'bandas_equipaje',
            -- tiempos
            'hora_programada', 'hora_real_pista', 'hora_real_bloque', 'hora_attt',
            'hora_recepcion', 'hora_inicio_pernocta', 'hora_termino_pernocta',
            'hora_operacion', 'slot_asignado', 'slot_coordinado',
            'minutos_demora', 'codigo_demora_origen', 'motivo_operativo', 'demora_15_min',
            -- pasajeros
            'pax_total', 'pax_abordados', 'pax_programados', 'pax_no_abordados',
            'pax_inadmitidos', 'pax_repatriados', 'pax_transitos', 'pax_conexiones',
            'pax_infantes', 'pax_exentos_reportados', 'pax_pagan_tua_reportados',
            'capacidad_max_pax', 'ocupacion',
            -- carga
            'carga_total_kg', 'carga_nacional_kg', 'carga_internacional_kg',
            'carga_importacion_kg', 'carga_exportacion_kg',
            'carga_descargada_kg', 'carga_embarcada_kg', 'carga_transito_kg',
            'indicador_importacion', 'indicador_exportacion', 'correo_kg', 'equipaje_kg',
            -- estado
            'conciliado', 'validado', 'fuente_principal'
        ])
      ) r
     WHERE NOT EXISTS (
        SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.' || r.tabla)
           AND a.attname = r.col
           AND a.attnum > 0
           AND NOT a.attisdropped
     );

    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION E'Faltan columnas requeridas por el motor estadístico v2:\n  %\n\nRevisar que 037 esté aplicada y que maestra_operaciones tenga el esquema vigente.',
            array_to_string(v_faltan, E'\n  ');
    END IF;

    RAISE NOTICE 'Contrato de columnas verificado (v2): 81 columnas.';
END;
$contrato$;


-- -----------------------------------------------------------------------------
-- 4b) DEMOLICIÓN EN ORDEN DE DEPENDENCIA
--
--     Postgres no deja borrar una función de la que cuelga una vista
--     materializada, ni una vista materializada de cuyo TIPO cuelga una
--     función. La cadena real es:
--
--         estadistica_detalle  ──depende del TIPO──▶  mv_estadistica_operaciones
--         v_estadistica_operaciones ──depende de──▶   mv_estadistica_operaciones
--         mv_estadistica_operaciones ──depende de──▶  estadistica_resolver_clasificacion
--
--     Así que hay que ir de arriba hacia abajo: primero las funciones que usan
--     el tipo de la materializada, luego la vista, luego la materializada y
--     hasta el final el resolvedor. Hacerlo al revés aborta con 2BP01 y la
--     sugerencia de usar CASCADE, que aquí sería peor: un CASCADE sobre el
--     resolvedor se llevaría la materializada por delante sin decir cuál era el
--     orden correcto.
--
--     Se borran LAS DOS firmas del resolvedor: la de cinco argumentos que dejó
--     la 038 y la de seis de esta migración, para que volver a correr este
--     archivo funcione igual la segunda vez que la primera.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.estadistica_detalle(date, date, jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.estadistica_agregado(date, date, text[], jsonb, integer);
DROP FUNCTION IF EXISTS public.estadistica_sin_clasificar(date, date, integer);
DROP FUNCTION IF EXISTS public.estadistica_opciones_filtro(date, date);
DROP FUNCTION IF EXISTS public.estadistica_diagnostico();

DROP VIEW IF EXISTS public.v_estadistica_operaciones;
DROP MATERIALIZED VIEW IF EXISTS public.mv_estadistica_operaciones;

DROP FUNCTION IF EXISTS public.estadistica_resolver_clasificacion(date, bigint, text, text, text);
DROP FUNCTION IF EXISTS public.estadistica_resolver_clasificacion(date, bigint, text, text, text, text);


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- Los objetos de la versión anterior ya no están. La tabla de reglas y sus
-- datos SÍ siguen: la demolición no toca lo que se administra a mano.
SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('mv_estadistica_operaciones', 'v_estadistica_operaciones')
 ORDER BY 1;

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'estadistica_%'
 ORDER BY 1, 2;

SELECT count(*) AS reglas_conservadas,
       count(*) FILTER (WHERE activo) AS activas
  FROM public.estadistica_reglas_clasificacion;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT y seguir con 041_estadistica_v2_reglas.sql.
--
-- Si aquí sale 55P03 (lock timeout): volver al PASO 1. Alguien sigue teniendo el
-- candado, y el paso 3 es el que lo suelta.
-- -----------------------------------------------------------------------------
ROLLBACK;
