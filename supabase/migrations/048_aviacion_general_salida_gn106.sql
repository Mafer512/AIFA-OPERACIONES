-- =============================================================================
-- 048 — Aviación General: la salida faltante del GN-106 (03/11/2022)
--
-- ESTA MIGRACIÓN INSERTA UN DATO. Es la única del módulo que lo hace, y por eso
-- conviene leer el porqué antes de correrla.
--
-- EL CASO
--
--   El reporte oficial de GAG "Operaciones de Aviación General 2022 LA BUENA"
--   cierra noviembre de 2022 con 54 salidas. El histórico cargado tiene 53.
--   La diferencia es una sola aeronave:
--
--     GN-106 · GUARDIA NACIONAL · UH60L
--     Llegada 03/11/2022 14:21 — entrada a posición 14:25
--     folio de rotación 202200195, fila 198 de "2022 FBO.xlsx"
--
--   Esa llegada es su ÚNICO movimiento en los 10,396 registros del histórico, y
--   la propia fila lo dice: su campo de observaciones trae, escrito por el
--   proceso que cargó los datos, "La fila de origen no contiene movimiento de
--   SALIDA." También quedaron vacías su hora de salida de posición y su hora de
--   despegue. El Excel, simplemente, no registró la salida.
--
--   La Gerencia confirma que la aeronave sí salió y pide dejarla contemplada
--   para que el año cuadre con su reporte. Eso es lo que hace este archivo.
--
-- LO QUE NO SE SABE, Y POR ESO SE MARCA
--
--   No consta la FECHA ni la HORA reales de esa salida. Se registra el mismo
--   03/11/2022 porque es lo que menos supone —no afirma cuántos días estuvo en
--   plataforma— y porque en los dos conteos del módulo cae en noviembre, que es
--   donde el reporte la cuenta.
--
--   Por eso el registro entra con estado_validacion = 'OBSERVADO' y no
--   'PENDIENTE': queda contado, pero visible en la bandeja de validación con la
--   explicación de qué falta confirmarle. Y con tipo_fuente = 'MIGRACION', que
--   lo distingue de lo capturado a mano y de lo importado del Excel.
--
--   Los pasajeros van en 0, y eso NO es una suposición: el reporte cierra
--   noviembre con 237 pasajeros de salida y el histórico ya tiene 237 con 53
--   salidas. Si esta salida hubiera llevado gente, esa cifra no cuadraría.
--
-- IDEMPOTENTE. Si el movimiento ya existe, no inserta nada y lo dice.
--
-- REQUISITO: 046 y 047 aplicadas.
--
-- MODO DE USO
--   1) Correr el archivo completo. Termina en ROLLBACK.
--   2) La VERIFICACIÓN debe mostrar 2022 cerrando en 458 operaciones y 229
--      salidas, con los 1,385 pasajeros intactos.
--   3) Si se ve bien, cambiar ROLLBACK por COMMIT y volver a correrlo.
--
-- PARA DESHACERLO (si GAG se retracta):
--   DELETE FROM public.aviacion_general_operaciones
--    WHERE matricula = 'GN-106' AND tipo_operacion = 'SALIDA'
--      AND tipo_fuente = 'MIGRACION';
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;


-- =============================================================================
-- 0) CONTRATO — que esté el módulo y que la llegada siga siendo la que creemos
-- =============================================================================
DO $contrato$
DECLARE
    v_llegada record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'aviacion_general_ancla'
    ) THEN
        RAISE EXCEPTION 'Falta aplicar 047_aviacion_general_conteo_oficial.sql antes que ésta.';
    END IF;

    SELECT * INTO v_llegada
      FROM public.aviacion_general_operaciones
     WHERE matricula = 'GN-106'
       AND tipo_operacion = 'LLEGADA'
       AND fecha_operacion = DATE '2022-11-03'
       AND estatus_registro = 'ACTIVO';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'No se encontró la llegada de GN-106 del 03/11/2022. Esta migración se escribió para ESE caso concreto: si la llegada cambió, hay que revisar el supuesto antes de insertar nada.';
    END IF;

    IF v_llegada.folio_rotacion <> 202200195 THEN
        RAISE EXCEPTION
            'La llegada de GN-106 ya no tiene el folio 202200195 sino %. Revisar antes de continuar.',
            v_llegada.folio_rotacion;
    END IF;

    RAISE NOTICE 'Llegada localizada: id=%, folio=%, operador=%',
                 v_llegada.id, v_llegada.folio_rotacion, v_llegada.operador;
END
$contrato$;


-- =============================================================================
-- 1) LA SALIDA
--
-- Se copian de la llegada los datos que son de la AERONAVE y de la rotación
-- —operador, matrícula, tipo, ámbito, ciudad, estado, país— y se dejan vacíos
-- los que son del MOVIMIENTO y no constan: las horas.
-- =============================================================================
INSERT INTO public.aviacion_general_operaciones (
    folio_rotacion, fecha_operacion, tipo_operacion, ambito_operacion,
    operador, matricula, tipo_aeronave,
    aeropuerto_origen_destino, ciudad_origen_destino,
    hora_programada, hora_real,
    adultos, infantes, pax_total_reportado,
    estado, pais, observaciones,
    tipo_fuente, estado_validacion, observacion_validacion
)
SELECT
    l.folio_rotacion,
    DATE '2022-11-03',
    'SALIDA',
    l.ambito_operacion,
    l.operador,
    l.matricula,
    l.tipo_aeronave,
    l.aeropuerto_origen_destino,
    l.ciudad_origen_destino,
    NULL,                      -- hora programada: no consta
    NULL,                      -- hora real: no consta
    NULL, NULL,                -- adultos / infantes: no se desglosaron
    0,                         -- pax total: 0, y cuadra con el reporte
    l.estado,
    l.pais,
    'Salida reconstruida a partir del reporte oficial de GAG 2022. El Excel de origen '
    || '("2022 FBO.xlsx", fila 198) registró la llegada pero no la salida; el reporte cuenta '
    || 'las dos. No consta la fecha ni la hora reales de la salida: se registra el mismo día de '
    || 'la llegada. Ver migración 048.',
    'MIGRACION',
    'OBSERVADO',
    'Movimiento contemplado para cuadrar con el reporte oficial de 2022. Falta confirmar con '
    || 'GAG la fecha y la hora reales de salida; los pasajeros (0) sí están confirmados porque '
    || 'el total de noviembre del reporte cuadra sin ellos.'
FROM public.aviacion_general_operaciones l
WHERE l.matricula        = 'GN-106'
  AND l.tipo_operacion   = 'LLEGADA'
  AND l.fecha_operacion  = DATE '2022-11-03'
  AND l.estatus_registro = 'ACTIVO'
  -- Idempotencia: si la salida ya está, no se inserta otra.
  AND NOT EXISTS (
        SELECT 1 FROM public.aviacion_general_operaciones s
         WHERE s.matricula        = 'GN-106'
           AND s.tipo_operacion   = 'SALIDA'
           AND s.estatus_registro <> 'ELIMINADO'
  );


-- =============================================================================
-- 2) ENLACE llegada <-> salida
--
-- Se hace aquí y no con aviacion_general_enlazar_rotaciones() porque esa
-- función recorre todo el periodo; para una pareja conocida es más claro y más
-- barato escribirlo directo.
-- =============================================================================
UPDATE public.aviacion_general_operaciones o
   SET movimiento_relacionado_id = p.otro,
       fecha_modificacion        = now()
  FROM (
        SELECT l.id AS uno, s.id AS otro
          FROM public.aviacion_general_operaciones l
          JOIN public.aviacion_general_operaciones s
            ON s.matricula = l.matricula
           AND s.tipo_operacion = 'SALIDA'
           AND s.estatus_registro = 'ACTIVO'
         WHERE l.matricula = 'GN-106'
           AND l.tipo_operacion = 'LLEGADA'
           AND l.estatus_registro = 'ACTIVO'
        UNION ALL
        SELECT s.id AS uno, l.id AS otro
          FROM public.aviacion_general_operaciones l
          JOIN public.aviacion_general_operaciones s
            ON s.matricula = l.matricula
           AND s.tipo_operacion = 'SALIDA'
           AND s.estatus_registro = 'ACTIVO'
         WHERE l.matricula = 'GN-106'
           AND l.tipo_operacion = 'LLEGADA'
           AND l.estatus_registro = 'ACTIVO'
       ) p
 WHERE o.id = p.uno
   AND o.movimiento_relacionado_id IS DISTINCT FROM p.otro;


-- =============================================================================
-- VERIFICACIÓN — 2022 debe cerrar como el reporte oficial
-- =============================================================================
SELECT * FROM (
    VALUES
        (1, 'Movimientos de GN-106 en el histórico',
            (SELECT count(*)::text FROM public.aviacion_general_operaciones
              WHERE matricula = 'GN-106' AND estatus_registro = 'ACTIVO'),
            'se esperan 2: la llegada y la salida reconstruida'),
        (2, 'Operaciones 2022 (oficial, por rotación)',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'movimientos'),
            'el reporte dice 458'),
        (3, 'Salidas 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'salidas'),
            'el reporte dice 229'),
        (4, 'Llegadas 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'llegadas'),
            'el reporte dice 229'),
        (5, 'Pasajeros 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'pax'),
            'el reporte dice 1,385 — NO debe moverse'),
        (6, 'Pax salida noviembre 2022',
            (SELECT m->>'pax_salida' FROM jsonb_array_elements(
                public.aviacion_general_resumen(
                    '{"fecha_desde":"2022-11-01","fecha_hasta":"2022-11-30"}'::jsonb, 'rotacion'
                )->'por_mes') m LIMIT 1),
            'el reporte dice 237 — NO debe moverse'),
        (7, 'Salidas noviembre 2022',
            (SELECT m->>'salidas' FROM jsonb_array_elements(
                public.aviacion_general_resumen(
                    '{"fecha_desde":"2022-11-01","fecha_hasta":"2022-11-30"}'::jsonb, 'rotacion'
                )->'por_mes') m LIMIT 1),
            'el reporte dice 54'),
        (8, 'Total de filas en la tabla',
            (SELECT count(*)::text FROM public.aviacion_general_operaciones),
            'eran 10,396; se espera 10,397')
) AS v(orden, concepto, valor, nota)
ORDER BY orden;

-- Cambiar por COMMIT cuando la verificación se vea bien.
ROLLBACK;
