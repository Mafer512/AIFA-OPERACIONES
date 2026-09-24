-- =============================================================================
-- 037 — Desglose de carga: descargada, embarcada y en tránsito
--
-- REQUISITO: correr antes 036_estadistica_clasificacion_reglas.sql (con COMMIT).
-- REQUISITO de: 038_estadistica_motor.sql, que ya lee estas tres columnas.
--
-- QUÉ HAY HOY (revisado antes de proponer nada)
--
--   maestra_operaciones ya distingue la carga por NATURALEZA TERRITORIAL:
--     carga_total_kg, carga_nacional_kg, carga_internacional_kg, correo_kg,
--     equipaje_kg  (migraciones 023/024/025/033)
--   y también, sólo para el histórico importado:
--     carga_importacion_kg, carga_exportacion_kg  (migración 033/034)
--
--   Lo que NO existe en ninguna parte del modelo —se buscó en las cuatro tablas
--   de manifiestos, en "Conciliación Manifiestos", en manifiestos_carga /
--   manifiestos_pasajeros y en el JSON de portal_manifiesto_datos— es el
--   TRATAMIENTO de la carga respecto al aeropuerto: cuánta se bajó aquí,
--   cuánta se subió aquí y cuánta siguió a bordo hacia otro destino.
--   La única aparición de la palabra "tránsito" en el modelo es pax_transitos
--   (PASAJEROS en tránsito) y bhs.tras (MALETAS en tránsito): ninguna sirve.
--
-- POR QUÉ COLUMNAS Y NO UNA TABLA APARTE
--
--   Las tres cifras son atributos del MOVIMIENTO, con exactamente el mismo
--   grano que carga_total_kg, que ya vive en la misma fila. Una tabla
--   normalizada 1:1 no agrega ninguna cardinalidad nueva: agregaría un JOIN
--   obligatorio a la consulta más caliente del módulo (la vista materializada
--   recorre la maestra entera) a cambio de nada. Se descartó por eso, no por
--   comodidad.
--
-- DIMENSIONES INDEPENDIENTES, NO EXCLUYENTES
--
--   NACIONAL / INTERNACIONAL  →  naturaleza territorial del movimiento
--   DESCARGADA / EMBARCADA / EN TRÁNSITO  →  tratamiento en AIFA
--
--   Son ortogonales: una carga en tránsito puede ser internacional. Por eso el
--   tránsito NO se guarda como un valor más de carga_nacional/internacional
--   sino en su propia columna, y las estadísticas las cruzan libremente.
--
-- IDENTIDAD CONTABLE
--
--   transportada = descargada + tránsito           (en una LLEGADA)
--   transportada = embarcada  + tránsito           (en una SALIDA)
--
--   El CHECK de abajo la exige sólo cuando las tres cifras están capturadas,
--   con una tolerancia de 1 kg por redondeos del manifiesto. Filas sin captura
--   (lo normal hasta que alguien empiece a capturar) no se bloquean.
--
-- ESTA MIGRACIÓN NO INVENTA DATOS. Agrega las columnas en NULL y no deriva
-- ningún valor. NULL aquí significa "no se capturó el desglose", que es
-- distinto de 0 ("se capturó y no hubo tránsito"). La migración 038 respeta esa
-- diferencia y publica un indicador de cobertura para que se vea de inmediato
-- qué tan representativa es la cifra.
--
-- LAS TABLAS DE ORIGEN NO SE TOCAN. Sólo se agregan columnas a
-- maestra_operaciones, que es tabla nueva de este proyecto (no la auditada).
--
-- MODO DE USO
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK.
--   2) Revisar la VERIFICACIÓN y, si se ve bien, cambiar ROLLBACK por COMMIT.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Las tres columnas nuevas
-- -----------------------------------------------------------------------------
ALTER TABLE public.maestra_operaciones
    ADD COLUMN IF NOT EXISTS carga_descargada_kg numeric,
    ADD COLUMN IF NOT EXISTS carga_embarcada_kg  numeric,
    ADD COLUMN IF NOT EXISTS carga_transito_kg   numeric;

COMMENT ON COLUMN public.maestra_operaciones.carga_descargada_kg IS
    'Kilogramos de carga que efectivamente se BAJARON en AIFA en este '
    'movimiento. Sólo tiene sentido en LLEGADA. NULL = desglose no capturado '
    '(distinto de 0 = se capturó y no se descargó nada).';

COMMENT ON COLUMN public.maestra_operaciones.carga_embarcada_kg IS
    'Kilogramos de carga que se SUBIERON en AIFA en este movimiento. Sólo '
    'tiene sentido en SALIDA. NULL = desglose no capturado.';

COMMENT ON COLUMN public.maestra_operaciones.carga_transito_kg IS
    'Kilogramos que venían a bordo y siguieron hacia otro destino SIN bajarse '
    'en AIFA. Se captura en la LLEGADA de la rotación. La salida de la misma '
    'rotación NO debe volver a capturarla: la migración 038 atribuye el '
    'tránsito una sola vez por rotación (columna transito_contable_kg) '
    'justamente para que capturarlo dos veces no duplique la estadística.';

-- -----------------------------------------------------------------------------
-- 2) Integridad
--
--    NOT VALID a propósito: la restricción rige de aquí en adelante sin obligar
--    a un escaneo completo de la tabla al aplicarla, y sin arriesgar que una
--    fila histórica inconsistente aborte la migración. Se puede validar después,
--    cuando convenga, con:
--        ALTER TABLE public.maestra_operaciones
--          VALIDATE CONSTRAINT maestra_operaciones_carga_desglose_ck;
-- -----------------------------------------------------------------------------
ALTER TABLE public.maestra_operaciones
    DROP CONSTRAINT IF EXISTS maestra_operaciones_carga_no_negativa_ck;
ALTER TABLE public.maestra_operaciones
    ADD CONSTRAINT maestra_operaciones_carga_no_negativa_ck
    CHECK (
        (carga_descargada_kg IS NULL OR carga_descargada_kg >= 0)
        AND (carga_embarcada_kg IS NULL OR carga_embarcada_kg >= 0)
        AND (carga_transito_kg  IS NULL OR carga_transito_kg  >= 0)
    ) NOT VALID;

ALTER TABLE public.maestra_operaciones
    DROP CONSTRAINT IF EXISTS maestra_operaciones_carga_desglose_ck;
ALTER TABLE public.maestra_operaciones
    ADD CONSTRAINT maestra_operaciones_carga_desglose_ck
    CHECK (
        carga_total_kg IS NULL
        OR carga_transito_kg IS NULL
        OR (
            -- LLEGADA: transportada = descargada + tránsito
            (tipo_movimiento = 'LLEGADA' AND (
                carga_descargada_kg IS NULL
                OR abs(carga_total_kg - (carga_descargada_kg + carga_transito_kg)) <= 1
            ))
            -- SALIDA: transportada = embarcada + tránsito
            OR (tipo_movimiento = 'SALIDA' AND (
                carga_embarcada_kg IS NULL
                OR abs(carga_total_kg - (carga_embarcada_kg + carga_transito_kg)) <= 1
            ))
            OR tipo_movimiento NOT IN ('LLEGADA', 'SALIDA')
        )
    ) NOT VALID;

-- -----------------------------------------------------------------------------
-- 3) Índice de apoyo para la estadística de carga
--
--    Parcial: sólo las filas que SÍ traen carga. En un aeropuerto de pasajeros
--    la mayoría de los movimientos no lleva carga, así que el índice completo
--    sería en su mayor parte inútil y caro de mantener.
--
--    Se revisaron los índices existentes antes de proponerlo (023/027/032):
--    ninguno cubre carga, todos son por fecha, movement_key, cliente_uuid,
--    fuente u origenes. No hay redundancia.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_maestra_operaciones_carga
    ON public.maestra_operaciones (fecha_operacion, tipo_movimiento)
    WHERE carga_total_kg IS NOT NULL AND carga_total_kg > 0;

-- -----------------------------------------------------------------------------
-- 4) Rotación: índice sobre el vínculo que YA existe
--
--    aodb_legacy_id es el id de la fila del AODB (itinerario_vuelos_editable),
--    que es un vuelo-día ANCHO con lado de llegada y lado de salida. Los dos
--    movimientos que salen de esa fila comparten aodb_legacy_id: eso ES la
--    rotación, y ya está en el modelo desde la migración 023. No hace falta
--    inventar un emparejamiento por matrícula + hora, que es frágil (dos
--    rotaciones de la misma matrícula el mismo día se confunden).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_maestra_operaciones_rotacion
    ON public.maestra_operaciones (aodb_legacy_id)
    WHERE aodb_legacy_id IS NOT NULL;


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- 1) Las tres columnas existen y son nullable.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'maestra_operaciones'
   AND column_name IN ('carga_descargada_kg', 'carga_embarcada_kg', 'carga_transito_kg')
 ORDER BY column_name;

-- 2) Ninguna fila recibió valor: se agregan vacías a propósito.
SELECT count(*) FILTER (WHERE carga_descargada_kg IS NOT NULL) AS con_descargada,
       count(*) FILTER (WHERE carga_embarcada_kg  IS NOT NULL) AS con_embarcada,
       count(*) FILTER (WHERE carga_transito_kg   IS NOT NULL) AS con_transito,
       count(*)                                                AS filas_totales
  FROM public.maestra_operaciones;

-- 3) Cuántas rotaciones se pueden reconstruir hoy (sirve para saber qué tan
--    confiable será la atribución de tránsito antes de empezar a capturar).
SELECT count(*)                                              AS movimientos,
       count(*) FILTER (WHERE aodb_legacy_id IS NOT NULL)    AS con_rotacion_aodb,
       count(DISTINCT aodb_legacy_id)                        AS rotaciones_distintas
  FROM public.maestra_operaciones;

-- 4) Rotaciones que tienen los DOS lados (llegada y salida) — el caso en que la
--    regla de "contar el tránsito una sola vez" realmente hace falta.
SELECT count(*) AS rotaciones_con_ambos_lados
  FROM (
      SELECT aodb_legacy_id
        FROM public.maestra_operaciones
       WHERE aodb_legacy_id IS NOT NULL
       GROUP BY aodb_legacy_id
      HAVING count(*) FILTER (WHERE tipo_movimiento = 'LLEGADA') > 0
         AND count(*) FILTER (WHERE tipo_movimiento = 'SALIDA')  > 0
  ) t;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT cuando la verificación se vea bien.
-- -----------------------------------------------------------------------------
ROLLBACK;
