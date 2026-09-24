-- =============================================================================
-- 045 — Motor estadístico v2 · llenado y verificación de datos
--
-- REQUISITO: 040 a 044 aplicadas, en orden y con COMMIT. El 042 crea la vista
-- materializada VACÍA (WITH NO DATA); éste la llena y reanuda el refresco
-- automático que el 040 pausó.
--
-- POR QUÉ VA APARTE Y SIN BEGIN/COMMIT
--
--   Llenar mv_estadistica_operaciones significa resolver la clasificación por
--   reglas una vez por cada fila de maestra_operaciones y construir ocho
--   índices. Es lo caro de todo el módulo.
--
--   Si eso va dentro de la misma transacción que el DDL, el editor SQL de
--   Supabase corta la petición HTTP antes de que Postgres termine, y como el
--   trabajo iba en una transacción, al cortarse el cliente se deshace entero:
--   "Failed to fetch" y ni un objeto creado. Ese es exactamente el error que
--   apareció al correr la 040 en un solo archivo.
--
--   Aquí no hay BEGIN, y cada paso termina con su propio COMMIT.
--
--   OJO con un detalle del editor de Supabase: manda lo que se ejecuta junto
--   en UN solo mensaje, y Postgres corre un mensaje con varias sentencias como
--   UNA transacción implícita. Sin los COMMIT, correr el archivo completo
--   metería el llenado y las verificaciones en la misma transacción, y un
--   fallo cualquiera abajo desharía el llenado. Con ellos, lo hecho hasta cada
--   COMMIT queda confirmado.
--
-- MODO DE USO
--   EJECUTAR EL PASO 2 SELECCIONÁNDOLO SOLO (la línea del REFRESH). Es el
--   único que tarda, y así no arrastra nada más consigo.
--
--   Si el editor devuelve "Failed to fetch" en el paso 2, NO relanzarlo: correr
--   el paso 3, que dice si ya quedó. Si dice poblada = false, usar el PLAN B,
--   que le encarga el llenado a pg_cron dentro del servidor.
--
--   Los demás pasos pueden correrse juntos o de uno en uno.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PASO 1 — Cuánto hay que procesar
--
-- Conviene mirarlo ANTES: da la escala del paso 2 y, si algún día el refresco
-- se vuelve insostenible, es el número con el que hay que decidir qué optimizar.
-- -----------------------------------------------------------------------------
SELECT count(*)                                                   AS filas_en_la_maestra,
       count(*) FILTER (WHERE tipo_movimiento IN ('LLEGADA', 'SALIDA')
                          AND fecha_operacion IS NOT NULL)        AS movimientos_a_procesar,
       min(fecha_operacion)                                       AS desde,
       max(fecha_operacion)                                       AS hasta,
       (SELECT count(*) FROM public.estadistica_reglas_clasificacion WHERE activo)
                                                                  AS reglas_activas
  FROM public.maestra_operaciones;


-- -----------------------------------------------------------------------------
-- PASO 2 — Llenar la vista (esto es lo que tarda)
--
-- La PRIMERA vez va sin CONCURRENTLY: la vista está vacía y CONCURRENTLY exige
-- que ya tenga datos. De aquí en adelante, el refresco normal del módulo sí usa
-- CONCURRENTLY (lo hace refrescar_estadistica desde el botón "Actualizar") para
-- no bloquear la lectura mientras recalcula.
-- -----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.mv_estadistica_operaciones;
COMMIT;


-- -----------------------------------------------------------------------------
-- PASO 3 — ¿Ya quedó?
--
-- Si el paso 2 pareció fallar por "Failed to fetch", esta consulta es la que lo
-- desmiente o lo confirma: poblada = true y un conteo mayor que cero significan
-- que el servidor terminó aunque el navegador se haya rendido.
-- -----------------------------------------------------------------------------
SELECT c.relispopulated                                  AS poblada,
       (SELECT count(*) FROM public.mv_estadistica_operaciones) AS movimientos,
       pg_size_pretty(pg_total_relation_size(c.oid))     AS tamano
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'mv_estadistica_operaciones';


-- -----------------------------------------------------------------------------
-- PLAN B — sólo si el paso 2 dio "Failed to fetch" Y el paso 3 dice
--          poblada = false
--
-- Se le encarga el llenado a pg_cron, que corre DENTRO del servidor: no hay
-- navegador ni petición HTTP que se pueda cortar. El job se borra solo al
-- terminar. Va comentado para que no se dispare sin querer al correr el archivo
-- completo.
-- -----------------------------------------------------------------------------
-- SELECT cron.schedule(
--     'poblar_estadistica_una_vez',
--     '* * * * *',
--     $cmd$REFRESH MATERIALIZED VIEW public.mv_estadistica_operaciones;
--          SELECT cron.unschedule('poblar_estadistica_una_vez');$cmd$
-- );
--
-- Esperar uno o dos minutos y volver al paso 3. Si algo falló, aquí sale el
-- motivo exacto:
-- SELECT status, return_message, start_time, end_time
--   FROM cron.job_run_details
--  WHERE command LIKE '%poblar_estadistica_una_vez%'
--  ORDER BY start_time DESC
--  LIMIT 5;


-- -----------------------------------------------------------------------------
-- PASO 4 — Dejar constancia de la hora del llenado
--
-- Es lo que alimenta la etiqueta "Datos al …" de la barra de filtros.
-- -----------------------------------------------------------------------------
UPDATE public.estadistica_refresco SET refrescado_at = now() WHERE id = 1;
COMMIT;


-- -----------------------------------------------------------------------------
-- PASO 5 — Reanudar el refresco automático
--
-- El 040 lo pausó para que no peleara por el bloqueo de la vista mientras se
-- reconstruía. Aquí se vuelve a programar, ya con la vista poblada — que es
-- justo lo que CONCURRENTLY necesita para poder trabajar sin bloquear la
-- lectura.
-- -----------------------------------------------------------------------------
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
        RAISE NOTICE 'Refresco automático reanudado: cada 15 minutos.';
    ELSE
        RAISE NOTICE 'pg_cron no está instalado: el refresco queda manual (botón Actualizar).';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo reanudar el refresco automático (%). Queda manual.', SQLERRM;
END;
$cron$;
COMMIT;


-- =============================================================================
-- VERIFICACIÓN DE LOS DATOS
--
-- Ninguna de estas consultas llama a los RPC del módulo: en el editor SQL
-- auth.uid() es NULL, estadistica_access_level devuelve 'none' y la llamada
-- abortaría con un 42501 desconcertante. Se reproduce la misma cuenta
-- directamente sobre la vista materializada, que es de donde ellos leen.
-- =============================================================================

-- 1) Panorama general y de dónde salen las cancelaciones.
--    Con el esquema nuevo la bandera `cancelado` debería llevarse la mayoría;
--    las que salgan por texto son filas históricas que nunca se marcaron.
SELECT count(*)                                                    AS movimientos,
       count(*) FILTER (WHERE es_cancelada)                        AS canceladas,
       count(*) FILTER (WHERE cancelado_origen = 'bandera')        AS cancel_por_bandera,
       count(*) FILTER (WHERE cancelado_origen = 'estatus_aodb')   AS cancel_por_estatus,
       count(*) FILTER (WHERE cancelado_origen = 'puntualidad')    AS cancel_por_puntualidad,
       count(*) FILTER (WHERE clasificada)                         AS clasificadas,
       count(*) FILTER (WHERE NOT clasificada)                     AS sin_clasificar,
       min(fecha_operacion)                                        AS desde,
       max(fecha_operacion)                                        AS hasta
  FROM public.mv_estadistica_operaciones;

-- 2) De dónde sale la capacidad y de dónde la rotación: dice cuánto ganó el
--    módulo con las columnas del esquema nuevo.
SELECT capacidad_origen, rotacion_origen, count(*) AS movimientos
  FROM public.mv_estadistica_operaciones
 GROUP BY 1, 2
 ORDER BY 3 DESC;

-- 3) El tránsito no se duplica: transito_contable nunca puede superar al bruto,
--    y con rotaciones de dos lados tiene que ser estrictamente menor.
SELECT coalesce(sum(carga_transito_kg), 0)    AS transito_capturado_bruto,
       coalesce(sum(transito_contable_kg), 0) AS transito_contable,
       count(*) FILTER (WHERE transito_contable_kg = 0 AND carga_transito_kg > 0) AS filas_espejo_neutralizadas
  FROM public.mv_estadistica_operaciones;

-- 4) Turnaround y pernocta: cuántas operaciones alcanzan a medirse.
SELECT count(*) FILTER (WHERE turnaround_min IS NOT NULL)   AS con_turnaround,
       round(avg(turnaround_min), 1)                        AS turnaround_promedio_min,
       min(turnaround_min)                                  AS turnaround_min_min,
       max(turnaround_min)                                  AS turnaround_max_min,
       count(*) FILTER (WHERE minutos_pernocta IS NOT NULL) AS con_pernocta,
       round(avg(minutos_pernocta), 1)                      AS pernocta_promedio_min
  FROM public.mv_estadistica_operaciones
 WHERE NOT es_cancelada;

-- 5) Llegadas + salidas = operaciones, y el corte por año.
SELECT anio,
       count(*) FILTER (WHERE NOT es_cancelada)                     AS operaciones,
       count(*) FILTER (WHERE NOT es_cancelada AND direccion = 'A') AS llegadas,
       count(*) FILTER (WHERE NOT es_cancelada AND direccion = 'D') AS salidas,
       count(*) FILTER (WHERE es_cancelada)                         AS canceladas,
       (sum(pax) FILTER (WHERE NOT es_cancelada))::numeric          AS pax_total,
       CASE WHEN coalesce(sum(capacidad_pasajeros) FILTER (WHERE NOT es_cancelada AND ocupacion_evaluable), 0) > 0
            THEN round(100.0 * (sum(pax)                 FILTER (WHERE NOT es_cancelada AND ocupacion_evaluable))::numeric
                             / (sum(capacidad_pasajeros) FILTER (WHERE NOT es_cancelada AND ocupacion_evaluable))::numeric, 2)
       END                                                          AS factor_ocupacion
  FROM public.mv_estadistica_operaciones
 GROUP BY anio
 ORDER BY anio;

-- 6) La ocupación que ya venía capturada contra la que calcula el módulo.
--    Una diferencia grande en muchas filas apunta a capturas incoherentes, no a
--    un error del motor: el módulo calcula SUM(pax)/SUM(capacidad), no el
--    promedio de los porcentajes por fila.
SELECT count(*)                                                          AS con_ambas,
       round(avg(abs(ocupacion_reportada * 100 - (pax::numeric / capacidad_pasajeros * 100))), 2) AS diferencia_promedio_pp
  FROM public.mv_estadistica_operaciones
 WHERE ocupacion_reportada IS NOT NULL
   AND ocupacion_evaluable
   AND capacidad_pasajeros > 0;

-- 7) Adherencia al slot con el vocabulario oficial. La suma de las tres del
--    centro es "cumple la ventana"; ANTICIPADO y DEMORA quedan fuera.
--    Un "SIN SLOT" muy grande no es un error del cálculo: es que falta capturar
--    slot_asignado / slot_coordinado / hora_operacion, y el módulo lo reporta
--    como cobertura en vez de inventar una puntualidad.
SELECT coalesce(clasificacion_slot, 'SIN SLOT')      AS clasificacion,
       count(*)                                      AS operaciones,
       round(avg(minutos_vs_slot), 1)                AS minutos_promedio_vs_slot,
       min(minutos_vs_slot)                          AS minimo,
       max(minutos_vs_slot)                          AS maximo
  FROM public.mv_estadistica_operaciones
 WHERE NOT es_cancelada
 GROUP BY 1
 ORDER BY 2 DESC;

-- 8) De dónde sale el slot vigente y de dónde nacional/internacional.
SELECT coalesce(slot_origen, 'sin slot') AS slot_origen,
       nacint_origen,
       count(*) AS operaciones
  FROM public.mv_estadistica_operaciones
 GROUP BY 1, 2
 ORDER BY 3 DESC;

-- 9) Qué reglas faltan. Sin la semilla de la 039 aparece todo aquí, y está
--    bien: significa que nada se está clasificando por suposición.
SELECT aerolinea, aerolinea_codigo, tipo_aeronave, tipo_servicio,
       count(*) AS operaciones
  FROM public.mv_estadistica_operaciones
 WHERE NOT clasificada AND NOT es_cancelada
 GROUP BY 1, 2, 3, 4
 ORDER BY count(*) DESC
 LIMIT 15;

-- 10) Los objetos de 027/028 siguen intactos: el Informe Estadístico no se tocó.
SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen',
                     'v_informe_estadistico_aerolinea', 'mv_informe_estadistico_base',
                     'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea')
 ORDER BY 1;


-- =============================================================================
-- DE AQUÍ EN ADELANTE
--
-- Este archivo se corre UNA vez, al montar el módulo. El refresco de todos los
-- días lo hace solo:
--   · pg_cron cada 15 minutos, si la extensión está disponible (migración 038);
--   · el botón "Actualizar" de la barra de filtros, que llama al RPC
--     refrescar_estadistica() con el usuario autenticado.
--
-- Volver a correr este archivo es inofensivo: el REFRESH recalcula desde cero.
-- =============================================================================
