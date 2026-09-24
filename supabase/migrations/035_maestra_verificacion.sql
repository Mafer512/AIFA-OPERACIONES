-- =============================================================================
-- 035 — Verificación de la migración hacia maestra_operaciones
--
-- SOLO LECTURA. No abre transacción, no modifica nada, no crea objetos
-- permanentes. Se puede correr las veces que haga falta, en producción, sin
-- riesgo. Es la herramienta para contestar "¿ya está bien?" antes de poner la
-- maestra en operación.
--
-- Devuelve nueve reportes. Los cuatro primeros son de COBERTURA (¿está todo?),
-- los cuatro siguientes de FIDELIDAD (¿dice lo mismo?), y el último es el
-- semáforo resumido.
--
-- USO: correr el archivo completo y leer los resultados de arriba abajo.
-- =============================================================================


-- Mismo motivo que en 033/034: las funciones auxiliares de 010 y 023 llevan
-- bloque EXCEPTION pero están marcadas PARALLEL SAFE, y en un plan paralelo eso
-- aborta con "25000: cannot start commands during a parallel operation".
SET max_parallel_workers_per_gather = 0;

-- =============================================================================
-- 1) COBERTURA — ¿cuántas filas de cada origen llegaron a la maestra?
-- =============================================================================
SELECT '=== 1. COBERTURA POR ORIGEN ===' AS reporte;

SELECT
    'itinerario_vuelos_editable'  AS origen,
    (SELECT count(*) FROM public.itinerario_vuelos_editable)                       AS filas_origen,
    -- Un vuelo-día puede producir 2 movimientos, así que el esperado se cuenta
    -- por lado con designator y fecha programada, no por fila.
    (SELECT count(*) FROM public.itinerario_vuelos_editable
      WHERE NULLIF(btrim(coalesce("[Arr] Flight Designator", '')), '') IS NOT NULL
        AND arr_scheduled_date IS NOT NULL)
    + (SELECT count(*) FROM public.itinerario_vuelos_editable
        WHERE NULLIF(btrim(coalesce("[Dep] Flight Designator", '')), '') IS NOT NULL
          AND dep_scheduled_date IS NOT NULL)                                      AS movimientos_esperados,
    (SELECT count(*) FROM public.maestra_operaciones WHERE aodb_legacy_id IS NOT NULL) AS en_maestra

UNION ALL SELECT
    '"Conciliación Manifiestos"',
    (SELECT count(*) FROM public."Conciliación Manifiestos"),
    (SELECT count(*) FROM public."Conciliación Manifiestos" cm
      WHERE public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO") IS NOT NULL
        AND coalesce(cm."_portal_flight_date",
                     public._aifa_parse_manifest_date(cm."FECHA")) IS NOT NULL),
    (SELECT count(*) FROM public.maestra_operaciones
      WHERE conciliacion_manifiesto_legacy_id IS NOT NULL)

UNION ALL SELECT
    'manifiestos_pasajeros',
    (SELECT count(*) FROM public.manifiestos_pasajeros),
    (SELECT count(*) FROM public.manifiestos_pasajeros WHERE legacy_manifest_id IS NOT NULL),
    (SELECT count(*) FROM public.maestra_operaciones
      WHERE portal_manifiesto_datos ? 'manifiesto_pasajeros')

UNION ALL SELECT
    'manifiestos_carga',
    (SELECT count(*) FROM public.manifiestos_carga),
    (SELECT count(*) FROM public.manifiestos_carga WHERE legacy_manifest_id IS NOT NULL),
    (SELECT count(*) FROM public.maestra_operaciones
      WHERE portal_manifiesto_datos ? 'manifiesto_carga');


-- =============================================================================
-- 2) COBERTURA — filas de origen que NO llegaron, con el motivo
-- =============================================================================
SELECT '=== 2. FILAS DE ORIGEN SIN CONTRAPARTE EN LA MAESTRA ===' AS reporte;

SELECT 'itinerario' AS origen, t.id::text AS id_origen,
       CASE
           WHEN NULLIF(btrim(coalesce(t."[Arr] Flight Designator", '')), '') IS NULL
            AND NULLIF(btrim(coalesce(t."[Dep] Flight Designator", '')), '') IS NULL
               THEN 'sin numero de vuelo en ningun lado'
           WHEN t.arr_scheduled_date IS NULL AND t.dep_scheduled_date IS NULL
               THEN 'sin fecha programada interpretable (SIBT/SOBT)'
           ELSE 'no sincronizada'
       END AS motivo,
       t."[Arr] Flight Designator" AS vuelo_llegada,
       t."[Dep] Flight Designator" AS vuelo_salida
  FROM public.itinerario_vuelos_editable t
 WHERE NOT EXISTS (SELECT 1 FROM public.maestra_operaciones m WHERE m.aodb_legacy_id = t.id)

UNION ALL

SELECT 'conciliacion', cm.id::text,
       CASE
           WHEN public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO") IS NULL
               THEN 'TIPO DE MANIFIESTO no dice llegada ni salida'
           WHEN coalesce(cm."_portal_flight_date",
                         public._aifa_parse_manifest_date(cm."FECHA")) IS NULL
               THEN 'FECHA no interpretable'
           ELSE 'no sincronizada'
       END,
       cm."# DE VUELO", cm."TIPO DE MANIFIESTO"
  FROM public."Conciliación Manifiestos" cm
 WHERE NOT EXISTS (SELECT 1 FROM public.maestra_operaciones m
                    WHERE m.conciliacion_manifiesto_legacy_id = cm.id)
 ORDER BY 1, 2
 LIMIT 300;


-- =============================================================================
-- 3) COBERTURA — filas huérfanas: están en la maestra pero su origen ya no
--
--    Mientras no existan triggers AFTER DELETE, cada borrado en una tabla
--    heredada deja una fila fantasma aquí. Estadística las está contando.
-- =============================================================================
SELECT '=== 3. FILAS HUERFANAS EN LA MAESTRA ===' AS reporte;

SELECT 'aodb_legacy_id sin itinerario' AS caso, count(*) AS filas
  FROM public.maestra_operaciones m
 WHERE m.aodb_legacy_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.itinerario_vuelos_editable t WHERE t.id = m.aodb_legacy_id)

UNION ALL

SELECT 'conciliacion_manifiesto_legacy_id sin manifiesto', count(*)
  FROM public.maestra_operaciones m
 WHERE m.conciliacion_manifiesto_legacy_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public."Conciliación Manifiestos" cm
                    WHERE cm.id = m.conciliacion_manifiesto_legacy_id);


-- =============================================================================
-- 4) COBERTURA — el modelo de propiedad, columna por columna
--
--    Comprueba que cada capa esté llenando lo suyo. Una columna del itinerario
--    con cero filas llenas significa que ese tramo del mapeo no está corriendo.
-- =============================================================================
SELECT '=== 4. LLENADO POR CAPA DE PROPIEDAD ===' AS reporte;

WITH base AS (
    SELECT count(*) FILTER (WHERE datos_origen ? 'itinerario_vuelos_editable') AS con_itinerario,
           count(*) FILTER (WHERE conciliacion_manifiesto_legacy_id IS NOT NULL) AS con_captura,
           count(*) AS total
      FROM public.maestra_operaciones
)
SELECT 'ITINERARIO' AS capa, 'datos_origen'      AS columna,
       (SELECT count(*) FROM public.maestra_operaciones WHERE datos_origen ? 'itinerario_vuelos_editable') AS llenas,
       (SELECT con_itinerario FROM base) AS esperadas
UNION ALL SELECT 'ITINERARIO', 'hora_programada',  count(*) FILTER (WHERE hora_programada IS NOT NULL),  (SELECT con_itinerario FROM base) FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'hora_real_pista',  count(*) FILTER (WHERE hora_real_pista IS NOT NULL),  NULL FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'hora_real_bloque', count(*) FILTER (WHERE hora_real_bloque IS NOT NULL), NULL FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'posicion',         count(*) FILTER (WHERE posicion IS NOT NULL),         NULL FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'puertas',          count(*) FILTER (WHERE puertas IS NOT NULL),          NULL FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'pax_abordados',    count(*) FILTER (WHERE pax_abordados IS NOT NULL),    NULL FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'estatus_vuelo',    count(*) FILTER (WHERE estatus_vuelo IS NOT NULL),    NULL FROM public.maestra_operaciones
UNION ALL SELECT 'ITINERARIO', 'movement_slot',    count(*) FILTER (WHERE movement_slot IS NOT NULL),    NULL FROM public.maestra_operaciones

UNION ALL SELECT 'MANIFIESTOS', 'hora_recepcion',       count(*) FILTER (WHERE hora_recepcion IS NOT NULL),       (SELECT con_captura FROM base) FROM public.maestra_operaciones
UNION ALL SELECT 'MANIFIESTOS', 'pax_total',            count(*) FILTER (WHERE pax_total IS NOT NULL),            NULL FROM public.maestra_operaciones
UNION ALL SELECT 'MANIFIESTOS', 'carga_total_kg',       count(*) FILTER (WHERE carga_total_kg IS NOT NULL),       NULL FROM public.maestra_operaciones
UNION ALL SELECT 'MANIFIESTOS', 'cierre_subsecretaria', count(*) FILTER (WHERE cierre_subsecretaria IS NOT NULL), NULL FROM public.maestra_operaciones
UNION ALL SELECT 'MANIFIESTOS', 'estatus_matricula',    count(*) FILTER (WHERE estatus_matricula IS NOT NULL),    NULL FROM public.maestra_operaciones
UNION ALL SELECT 'MANIFIESTOS', 'demora_15_min',        count(*) FILTER (WHERE demora_15_min IS NOT NULL),        NULL FROM public.maestra_operaciones
UNION ALL SELECT 'MANIFIESTOS', 'cliente_uuid',         count(*) FILTER (WHERE cliente_uuid IS NOT NULL),         NULL FROM public.maestra_operaciones

UNION ALL SELECT 'PORTAL', 'portal_manifiesto_datos', count(*) FILTER (WHERE portal_manifiesto_datos <> '{}'::jsonb), NULL FROM public.maestra_operaciones
UNION ALL SELECT 'PORTAL', 'folio',                   count(*) FILTER (WHERE folio IS NOT NULL),                     NULL FROM public.maestra_operaciones;


-- =============================================================================
-- 5) FIDELIDAD — divergencias campo a campo contra "Conciliación Manifiestos"
--
--    Esto es lo que delata el defecto del espejo actual: los triggers de la 025
--    escriben con coalesce(m.columna, valor_nuevo), o sea que retienen el PRIMER
--    valor que vieron. Cada fila que salga aquí es una corrección del capturista
--    que la maestra nunca recibió.
-- =============================================================================
SELECT '=== 5. DIVERGENCIAS CAMPO A CAMPO (Conciliacion vs maestra) ===' AS reporte;

WITH pares AS (
    SELECT m.id AS maestra_id, cm.id AS legacy_id, cm."# DE VUELO" AS vuelo, m.fecha_operacion,
           v.columna, v.en_legacy, v.en_maestra
      FROM public.maestra_operaciones m
      JOIN public."Conciliación Manifiestos" cm
        ON cm.id = m.conciliacion_manifiesto_legacy_id
     CROSS JOIN LATERAL (VALUES
        ('# DE VUELO',        NULLIF(btrim(cm."# DE VUELO"), ''),                    m.numero_vuelo),
        ('AEROLINEA',         NULLIF(btrim(cm."AEROLINEA"), ''),                     m.aerolinea_origen),
        ('MATRÍCULA',         NULLIF(btrim(cm."MATRÍCULA"), ''),                     m.matricula_origen),
        ('AERONAVE',          NULLIF(btrim(cm."AERONAVE"), ''),                      m.tipo_aeronave_codigo),
        ('TIPO DE MANIFIESTO',NULLIF(btrim(cm."TIPO DE MANIFIESTO"), ''),            m.tipo_manifiesto),
        ('TIPO DE OPERACIÓN', NULLIF(btrim(cm."TIPO DE OPERACIÓN"), ''),             m.tipo_operacion),
        ('ESTATUS MATRÍCULA', NULLIF(btrim(cm."ESTATUS MATRÍCULA"), ''),             m.estatus_matricula),
        ('RUTA',              NULLIF(btrim(cm."RUTA"), ''),                          m.ruta_origen),
        ('CIERRE SUBSECRETARIA', NULLIF(btrim(cm."CIERRE SUBSECRETARIA"), ''),       m.cierre_subsecretaria),
        ('DEMORA +- 15 MIN.', NULLIF(btrim(cm."DEMORA +- 15 MIN."), ''),             m.demora_15_min),
        ('CÓDIGO DEMORA',     NULLIF(btrim(cm."CÓDIGO DEMORA"), ''),                 m.codigo_demora_origen),
        ('PUNTUALIDAD / CANCELACIÓN', NULLIF(btrim(cm."PUNTUALIDAD / CANCELACIÓN"), ''), m.estado_puntualidad),
        ('OBSERVACIONES',     NULLIF(btrim(cm."OBSERVACIONES"), ''),                 m.observaciones),
        ('CAPTURÓ',           NULLIF(btrim(cm."CAPTURÓ"), ''),                       m.capturado_por),
        ('TOTAL PAX',         cm."TOTAL PAX"::text,                                  m.pax_total::text),
        ('TOTAL EXENTOS',     public._aifa_safe_bigint(cm."TOTAL EXENTOS")::text,    m.pax_exentos_reportados::text),
        ('PAX QUE PAGAN TUA', public._aifa_safe_bigint(cm."PAX QUE PAGAN TUA")::text,m.pax_pagan_tua_reportados::text),
        ('KGS. DE EQUIPAJE',  cm."KGS. DE EQUIPAJE"::text,                           m.equipaje_kg::text),
        ('KG DE CARGA TOTAL', public._aifa_safe_numeric(cm."KG DE CARGA TOTAL")::text, m.carga_total_kg::text),
        ('CORREO',            public._aifa_safe_numeric(cm."CORREO")::text,          m.correo_kg::text)
     ) AS v(columna, en_legacy, en_maestra)
)
SELECT columna, count(*) AS divergencias
  FROM pares
 WHERE en_legacy IS DISTINCT FROM en_maestra
   -- Un valor numérico "150" y "150.000" son el mismo dato con otro formato.
   AND NOT (en_legacy ~ '^-?[0-9.]+$' AND en_maestra ~ '^-?[0-9.]+$'
            AND en_legacy::numeric = en_maestra::numeric)
 GROUP BY columna
 ORDER BY divergencias DESC, columna;


-- =============================================================================
-- 6) FIDELIDAD — el detalle de las divergencias, para revisarlas
-- =============================================================================
SELECT '=== 6. DETALLE DE DIVERGENCIAS (primeras 300) ===' AS reporte;

WITH pares AS (
    SELECT m.id AS maestra_id, cm.id AS legacy_id, cm."# DE VUELO" AS vuelo, m.fecha_operacion,
           v.columna, v.en_legacy, v.en_maestra
      FROM public.maestra_operaciones m
      JOIN public."Conciliación Manifiestos" cm
        ON cm.id = m.conciliacion_manifiesto_legacy_id
     CROSS JOIN LATERAL (VALUES
        ('# DE VUELO',        NULLIF(btrim(cm."# DE VUELO"), ''),          m.numero_vuelo),
        ('AEROLINEA',         NULLIF(btrim(cm."AEROLINEA"), ''),           m.aerolinea_origen),
        ('MATRÍCULA',         NULLIF(btrim(cm."MATRÍCULA"), ''),           m.matricula_origen),
        ('TOTAL PAX',         cm."TOTAL PAX"::text,                        m.pax_total::text),
        ('KG DE CARGA TOTAL', public._aifa_safe_numeric(cm."KG DE CARGA TOTAL")::text, m.carga_total_kg::text),
        ('OBSERVACIONES',     NULLIF(btrim(cm."OBSERVACIONES"), ''),       m.observaciones)
     ) AS v(columna, en_legacy, en_maestra)
)
SELECT legacy_id, maestra_id, fecha_operacion, vuelo, columna,
       en_legacy AS valor_en_conciliacion, en_maestra AS valor_en_maestra
  FROM pares
 WHERE en_legacy IS DISTINCT FROM en_maestra
   AND NOT (en_legacy ~ '^-?[0-9.]+$' AND en_maestra ~ '^-?[0-9.]+$'
            AND en_legacy::numeric = en_maestra::numeric)
 ORDER BY fecha_operacion DESC, legacy_id, columna
 LIMIT 300;


-- =============================================================================
-- 7) FIDELIDAD — integridad de la identidad de movimiento
-- =============================================================================
SELECT '=== 7. IDENTIDAD DE MOVIMIENTO ===' AS reporte;

SELECT 'movement_key duplicado con distinto slot (lo que el indice viejo fusionaba)' AS caso,
       count(*) AS grupos
  FROM (SELECT movement_key FROM public.maestra_operaciones
         WHERE movement_key IS NOT NULL
         GROUP BY movement_key
        HAVING count(DISTINCT coalesce(movement_slot, '')) > 1) t

UNION ALL

SELECT 'filas vivas sin movement_key (no cruzan con vuelos)',
       count(*)
  FROM public.maestra_operaciones
 WHERE movement_key IS NULL
   AND fuente_principal NOT LIKE 'HISTORICO%'

UNION ALL

SELECT 'filas historicas con movement_key (deberian ser 0)',
       count(*)
  FROM public.maestra_operaciones
 WHERE movement_key IS NOT NULL
   AND fuente_principal LIKE 'HISTORICO%'

UNION ALL

SELECT 'manifiestos sin vuelo del itinerario asociado',
       count(*)
  FROM public.maestra_operaciones
 WHERE conciliacion_manifiesto_legacy_id IS NOT NULL
   AND aodb_legacy_id IS NULL;


-- =============================================================================
-- 8) FIDELIDAD — el Informe Estadístico contra la maestra
--
--    Compara lo que reporta la vista con lo que hay en la tabla. Si no cuadra,
--    las vistas materializadas están rezagadas: correr
--    SELECT public.refrescar_informe_estadistico(true);
-- =============================================================================
SELECT '=== 8. INFORME ESTADISTICO VS MAESTRA (ultimos 60 dias) ===' AS reporte;

SELECT
    (SELECT refrescado_at FROM public.informe_estadistico_refresco LIMIT 1) AS ultimo_refresco,
    (SELECT count(*) FROM public.maestra_operaciones
      WHERE hora_recepcion IS NOT NULL
        AND fecha_operacion >= current_date - 60)                           AS capturados_en_maestra,
    (SELECT count(*) FROM public.v_informe_manifiestos_normalizado
      WHERE fecha_operacion >= current_date - 60)                           AS filas_en_el_informe;


-- =============================================================================
-- 8b) FIDELIDAD — coherencia de los dos ejes de carga
--
--     maestra_operaciones guarda la carga en dos ejes independientes:
--       nacional / internacional   (eje del tramo, de "TIPO DE OPERACIÓN")
--       importación / exportación  (eje aduanal)
--     carga_total_kg es la suma del PRIMER eje, no de los cuatro valores.
--     Confundirlos es el error más fácil de cometer aquí, así que se comprueba.
-- =============================================================================
SELECT '=== 8b. COHERENCIA DE CARGA ===' AS reporte;

SELECT 'Con desglose nac/int pero sin total (deberia ser 0)' AS prueba,
       count(*) AS filas
  FROM public.maestra_operaciones
 WHERE carga_total_kg IS NULL
   AND (carga_nacional_kg IS NOT NULL OR carga_internacional_kg IS NOT NULL)

UNION ALL

SELECT 'Total distinto de nacional + internacional',
       count(*)
  FROM public.maestra_operaciones
 WHERE carga_total_kg IS NOT NULL
   AND (carga_nacional_kg IS NOT NULL OR carga_internacional_kg IS NOT NULL)
   AND carga_total_kg <> coalesce(carga_nacional_kg, 0) + coalesce(carga_internacional_kg, 0)

UNION ALL

SELECT 'Carga en AMBAS columnas nac e int (un vuelo es una u otra)',
       count(*)
  FROM public.maestra_operaciones
 WHERE carga_nacional_kg IS NOT NULL
   AND carga_internacional_kg IS NOT NULL

UNION ALL

SELECT 'Con importacion/exportacion pero sin total (eje aduanal huerfano)',
       count(*)
  FROM public.maestra_operaciones
 WHERE carga_total_kg IS NULL
   AND (carga_importacion_kg IS NOT NULL OR carga_exportacion_kg IS NOT NULL);

-- Cómo quedó repartida la carga por fuente, para verla de un vistazo.
SELECT fuente_principal,
       count(*) FILTER (WHERE carga_total_kg IS NOT NULL)         AS con_total,
       count(*) FILTER (WHERE carga_nacional_kg IS NOT NULL)      AS con_nacional,
       count(*) FILTER (WHERE carga_internacional_kg IS NOT NULL) AS con_internacional,
       count(*) FILTER (WHERE carga_importacion_kg IS NOT NULL)   AS con_importacion,
       count(*) FILTER (WHERE carga_exportacion_kg IS NOT NULL)   AS con_exportacion,
       round(coalesce(sum(carga_total_kg), 0), 1)                 AS kg_totales
  FROM public.maestra_operaciones
 GROUP BY fuente_principal
 ORDER BY fuente_principal;


-- =============================================================================
-- 9) SEMÁFORO
-- =============================================================================
SELECT '=== 9. SEMAFORO ===' AS reporte;

WITH chk AS (
    SELECT
        (SELECT count(*) FROM public.itinerario_vuelos_editable t
          WHERE NOT EXISTS (SELECT 1 FROM public.maestra_operaciones m WHERE m.aodb_legacy_id = t.id)
            AND (NULLIF(btrim(coalesce(t."[Arr] Flight Designator", '')), '') IS NOT NULL
              OR NULLIF(btrim(coalesce(t."[Dep] Flight Designator", '')), '') IS NOT NULL)
        ) AS itinerario_sin_migrar,
        (SELECT count(*) FROM public."Conciliación Manifiestos" cm
          WHERE NOT EXISTS (SELECT 1 FROM public.maestra_operaciones m
                             WHERE m.conciliacion_manifiesto_legacy_id = cm.id)
            AND public._aifa_manifest_direction(cm."TIPO DE MANIFIESTO") IS NOT NULL
            AND coalesce(cm."_portal_flight_date", public._aifa_parse_manifest_date(cm."FECHA")) IS NOT NULL
        ) AS conciliacion_sin_migrar,
        (SELECT count(*) FROM public.maestra_operaciones m
          WHERE m.aodb_legacy_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.itinerario_vuelos_editable t WHERE t.id = m.aodb_legacy_id)
        ) AS huerfanas_itinerario,
        (SELECT count(*) FROM public.maestra_operaciones m
          WHERE m.conciliacion_manifiesto_legacy_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public."Conciliación Manifiestos" cm
                             WHERE cm.id = m.conciliacion_manifiesto_legacy_id)
        ) AS huerfanas_conciliacion,
        (SELECT count(*) FROM (SELECT movement_key FROM public.maestra_operaciones
                                WHERE movement_key IS NOT NULL
                                GROUP BY movement_key
                               HAVING count(DISTINCT coalesce(movement_slot, '')) > 1) t
        ) AS colisiones_slot,
        (SELECT count(*) FROM public.maestra_operaciones
          WHERE carga_total_kg IS NULL
            AND (carga_nacional_kg IS NOT NULL OR carga_internacional_kg IS NOT NULL)
        ) AS carga_sin_total
)
SELECT prueba, valor,
       CASE WHEN valor = 0 THEN 'OK' ELSE 'REVISAR' END AS estado
  FROM chk,
       LATERAL (VALUES
         ('Vuelos del itinerario sin migrar',      itinerario_sin_migrar),
         ('Manifiestos de Conciliación sin migrar', conciliacion_sin_migrar),
         ('Huérfanas: sin vuelo de origen',        huerfanas_itinerario),
         ('Huérfanas: sin manifiesto de origen',   huerfanas_conciliacion),
         ('movement_key con más de un slot',       colisiones_slot),
         ('Carga con desglose pero sin total',     carga_sin_total)
       ) AS t(prueba, valor)
 ORDER BY valor DESC, prueba;
