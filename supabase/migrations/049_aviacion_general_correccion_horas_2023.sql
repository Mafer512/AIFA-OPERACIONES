-- =============================================================================
-- 049 — Aviación General 2023: corrección de nueve horas interpretadas como
--       decimal HH.MM en vez de fracción horaria nativa de Excel
--
-- FUENTE AUTORIZADA
--   "Aviación General 2023 LA BUENA.xlsx"
--
-- ALCANCE ESTRICTO
--   El histórico ya cuadra con el reporte en sus 2,212 movimientos y en todos
--   los totales mensuales. Esta migración NO agrega ni elimina movimientos y
--   NO cambia pasajeros, ámbito, operador, matrícula, validación ni estatus.
--   Corrige únicamente nueve horas cuyo valor numérico fuente (0.35 o 0.45)
--   es una fracción de día de Excel:
--
--       0.35 = 08:24
--       0.45 = 10:48
--
-- PROTECCIONES
--   · Cada fila se identifica por archivo + tipo de operación + fila de origen
--     + fecha + matrícula.
--   · Debe existir exactamente una coincidencia ACTIVA y PENDIENTE.
--   · La hora actual sólo puede ser la equivocada conocida o la ya corregida.
--   · Es idempotente: una segunda ejecución no vuelve a modificar las filas.
--   · Termina en ROLLBACK para revisar el resultado antes de aplicarlo.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;


-- =============================================================================
-- 0) CONTRATO — las nueve filas deben seguir siendo exactamente las revisadas
-- =============================================================================
DO $contrato$
DECLARE
    v_objetivo record;
    v_coincidencias integer;
    v_hora_actual time;
    v_estatus text;
    v_validacion text;
BEGIN
    FOR v_objetivo IN
        SELECT *
          FROM (VALUES
            ('LLEGADA'::text,  67, DATE '2023-02-01', 'N578BB'::text, 'hora_entrada_posicion'::text, TIME '00:35', TIME '08:24'),
            ('LLEGADA'::text, 271, DATE '2023-04-26', 'XA-ETP'::text, 'hora_aterrizaje'::text,       TIME '00:45', TIME '10:48'),
            ('LLEGADA'::text, 487, DATE '2023-07-04', 'N690NG'::text, 'hora_entrada_posicion'::text, TIME '00:35', TIME '08:24'),
            ('LLEGADA'::text, 838, DATE '2023-10-25', 'XA-MRA'::text, 'hora_aterrizaje'::text,       TIME '00:35', TIME '08:24'),
            ('LLEGADA'::text, 938, DATE '2023-11-13', 'N582NT'::text, 'hora_entrada_posicion'::text, TIME '00:45', TIME '10:48'),
            ('SALIDA'::text,  162, DATE '2023-03-15', 'XB-GYM'::text, 'hora_salida_posicion'::text,  TIME '00:45', TIME '10:48'),
            ('SALIDA'::text,  726, DATE '2023-09-25', 'N826TG'::text, 'hora_salida_posicion'::text,  TIME '00:45', TIME '10:48'),
            ('SALIDA'::text,  963, DATE '2023-11-18', 'N390MA'::text, 'hora_salida_posicion'::text,  TIME '00:45', TIME '10:48'),
            ('SALIDA'::text, 1010, DATE '2023-12-01', 'N690NG'::text, 'hora_salida_posicion'::text,  TIME '00:45', TIME '10:48')
          ) AS c(tipo_operacion, fila_origen, fecha_operacion, matricula, campo, hora_anterior, hora_correcta)
    LOOP
        SELECT count(*),
               max(CASE v_objetivo.campo
                       WHEN 'hora_aterrizaje'       THEN o.hora_aterrizaje
                       WHEN 'hora_entrada_posicion' THEN o.hora_entrada_posicion
                       WHEN 'hora_salida_posicion'  THEN o.hora_salida_posicion
                   END),
               max(o.estatus_registro),
               max(o.estado_validacion)
          INTO v_coincidencias, v_hora_actual, v_estatus, v_validacion
          FROM public.aviacion_general_operaciones o
         WHERE o.archivo_origen  = '2023 FBO.xlsx'
           AND o.tipo_operacion  = v_objetivo.tipo_operacion
           AND o.fila_origen     = v_objetivo.fila_origen
           AND o.fecha_operacion = v_objetivo.fecha_operacion
           AND upper(o.matricula) = upper(v_objetivo.matricula);

        IF v_coincidencias <> 1 THEN
            RAISE EXCEPTION
                'Se esperaba una fila para % %, fila %, matrícula %, fecha %; se encontraron %.',
                v_objetivo.tipo_operacion, v_objetivo.campo, v_objetivo.fila_origen,
                v_objetivo.matricula, v_objetivo.fecha_operacion, v_coincidencias;
        END IF;

        IF v_estatus <> 'ACTIVO' OR v_validacion <> 'PENDIENTE' THEN
            RAISE EXCEPTION
                'La fila % % cambió de estado: estatus=%, validación=%. No se modifica.',
                v_objetivo.tipo_operacion, v_objetivo.fila_origen, v_estatus, v_validacion;
        END IF;

        IF v_hora_actual IS DISTINCT FROM v_objetivo.hora_anterior
           AND v_hora_actual IS DISTINCT FROM v_objetivo.hora_correcta THEN
            RAISE EXCEPTION
                'La fila % % ya no tiene la hora revisada: actual=%, esperada=% o %.',
                v_objetivo.tipo_operacion, v_objetivo.fila_origen, v_hora_actual,
                v_objetivo.hora_anterior, v_objetivo.hora_correcta;
        END IF;
    END LOOP;
END
$contrato$;


-- =============================================================================
-- 1) CORRECCIÓN — sólo las tres columnas horarias involucradas
-- =============================================================================
WITH correcciones(fila_origen, fecha_operacion, matricula, hora_anterior, hora_correcta) AS (
    VALUES
        ( 67, DATE '2023-02-01', 'N578BB', TIME '00:35', TIME '08:24'),
        (487, DATE '2023-07-04', 'N690NG', TIME '00:35', TIME '08:24'),
        (938, DATE '2023-11-13', 'N582NT', TIME '00:45', TIME '10:48')
)
UPDATE public.aviacion_general_operaciones o
   SET hora_entrada_posicion = c.hora_correcta,
       fecha_modificacion    = now()
  FROM correcciones c
 WHERE o.archivo_origen       = '2023 FBO.xlsx'
   AND o.tipo_operacion       = 'LLEGADA'
   AND o.fila_origen          = c.fila_origen
   AND o.fecha_operacion      = c.fecha_operacion
   AND upper(o.matricula)     = upper(c.matricula)
   AND o.estatus_registro     = 'ACTIVO'
   AND o.estado_validacion    = 'PENDIENTE'
   AND o.hora_entrada_posicion = c.hora_anterior;

WITH correcciones(fila_origen, fecha_operacion, matricula, hora_anterior, hora_correcta) AS (
    VALUES
        (271, DATE '2023-04-26', 'XA-ETP', TIME '00:45', TIME '10:48'),
        (838, DATE '2023-10-25', 'XA-MRA', TIME '00:35', TIME '08:24')
)
UPDATE public.aviacion_general_operaciones o
   SET hora_aterrizaje    = c.hora_correcta,
       fecha_modificacion = now()
  FROM correcciones c
 WHERE o.archivo_origen    = '2023 FBO.xlsx'
   AND o.tipo_operacion    = 'LLEGADA'
   AND o.fila_origen       = c.fila_origen
   AND o.fecha_operacion   = c.fecha_operacion
   AND upper(o.matricula)  = upper(c.matricula)
   AND o.estatus_registro  = 'ACTIVO'
   AND o.estado_validacion = 'PENDIENTE'
   AND o.hora_aterrizaje   = c.hora_anterior;

WITH correcciones(fila_origen, fecha_operacion, matricula, hora_anterior, hora_correcta) AS (
    VALUES
        ( 162, DATE '2023-03-15', 'XB-GYM', TIME '00:45', TIME '10:48'),
        ( 726, DATE '2023-09-25', 'N826TG', TIME '00:45', TIME '10:48'),
        ( 963, DATE '2023-11-18', 'N390MA', TIME '00:45', TIME '10:48'),
        (1010, DATE '2023-12-01', 'N690NG', TIME '00:45', TIME '10:48')
)
UPDATE public.aviacion_general_operaciones o
   SET hora_salida_posicion = c.hora_correcta,
       fecha_modificacion   = now()
  FROM correcciones c
 WHERE o.archivo_origen      = '2023 FBO.xlsx'
   AND o.tipo_operacion      = 'SALIDA'
   AND o.fila_origen         = c.fila_origen
   AND o.fecha_operacion     = c.fecha_operacion
   AND upper(o.matricula)    = upper(c.matricula)
   AND o.estatus_registro    = 'ACTIVO'
   AND o.estado_validacion   = 'PENDIENTE'
   AND o.hora_salida_posicion = c.hora_anterior;


-- =============================================================================
-- 2) VERIFICACIÓN — filas corregidas, universo intacto y cifras oficiales
-- =============================================================================
DO $verificacion$
DECLARE
    v_objetivo record;
    v_hora_actual time;
    v_coincidencias integer;
    v_resumen jsonb;
    v_filas integer;
    v_claves integer;
    v_meses_incorrectos integer;
BEGIN
    FOR v_objetivo IN
        SELECT *
          FROM (VALUES
            ('LLEGADA'::text,  67, DATE '2023-02-01', 'N578BB'::text, 'hora_entrada_posicion'::text, TIME '08:24'),
            ('LLEGADA'::text, 271, DATE '2023-04-26', 'XA-ETP'::text, 'hora_aterrizaje'::text,       TIME '10:48'),
            ('LLEGADA'::text, 487, DATE '2023-07-04', 'N690NG'::text, 'hora_entrada_posicion'::text, TIME '08:24'),
            ('LLEGADA'::text, 838, DATE '2023-10-25', 'XA-MRA'::text, 'hora_aterrizaje'::text,       TIME '08:24'),
            ('LLEGADA'::text, 938, DATE '2023-11-13', 'N582NT'::text, 'hora_entrada_posicion'::text, TIME '10:48'),
            ('SALIDA'::text,  162, DATE '2023-03-15', 'XB-GYM'::text, 'hora_salida_posicion'::text,  TIME '10:48'),
            ('SALIDA'::text,  726, DATE '2023-09-25', 'N826TG'::text, 'hora_salida_posicion'::text,  TIME '10:48'),
            ('SALIDA'::text,  963, DATE '2023-11-18', 'N390MA'::text, 'hora_salida_posicion'::text,  TIME '10:48'),
            ('SALIDA'::text, 1010, DATE '2023-12-01', 'N690NG'::text, 'hora_salida_posicion'::text,  TIME '10:48')
          ) AS c(tipo_operacion, fila_origen, fecha_operacion, matricula, campo, hora_correcta)
    LOOP
        SELECT count(*),
               max(CASE v_objetivo.campo
                       WHEN 'hora_aterrizaje'       THEN o.hora_aterrizaje
                       WHEN 'hora_entrada_posicion' THEN o.hora_entrada_posicion
                       WHEN 'hora_salida_posicion'  THEN o.hora_salida_posicion
                   END)
          INTO v_coincidencias, v_hora_actual
          FROM public.aviacion_general_operaciones o
         WHERE o.archivo_origen   = '2023 FBO.xlsx'
           AND o.tipo_operacion   = v_objetivo.tipo_operacion
           AND o.fila_origen      = v_objetivo.fila_origen
           AND o.fecha_operacion  = v_objetivo.fecha_operacion
           AND upper(o.matricula) = upper(v_objetivo.matricula)
           AND o.estatus_registro = 'ACTIVO'
           AND o.estado_validacion = 'PENDIENTE';

        IF v_coincidencias <> 1 OR v_hora_actual IS DISTINCT FROM v_objetivo.hora_correcta THEN
            RAISE EXCEPTION
                'Falló la corrección de % fila %: actual=%, esperada=%.',
                v_objetivo.tipo_operacion, v_objetivo.fila_origen,
                v_hora_actual, v_objetivo.hora_correcta;
        END IF;
    END LOOP;

    SELECT count(*),
           count(DISTINCT (tipo_operacion || '|' || fila_origen::text))
      INTO v_filas, v_claves
      FROM public.aviacion_general_operaciones
     WHERE archivo_origen      = '2023 FBO.xlsx'
       AND estatus_registro    = 'ACTIVO'
       AND estado_validacion   = 'PENDIENTE';

    IF v_filas <> 2212 OR v_claves <> 2212 THEN
        RAISE EXCEPTION
            'El universo 2023 cambió: filas=%, claves de origen=%, se esperaban 2212/2212.',
            v_filas, v_claves;
    END IF;

    v_resumen := public.aviacion_general_resumen(
        '{"fecha_desde":"2023-01-01","fecha_hasta":"2023-12-31"}'::jsonb,
        'rotacion'
    );

    IF (v_resumen->'totales'->>'movimientos')::int <> 2212
       OR (v_resumen->'totales'->>'llegadas')::int <> 1106
       OR (v_resumen->'totales'->>'salidas')::int <> 1106
       OR (v_resumen->'totales'->>'pax')::int <> 8160
       OR (v_resumen->'totales'->>'pax_llegada')::int <> 4101
       OR (v_resumen->'totales'->>'pax_salida')::int <> 4059
       OR (v_resumen->'totales'->>'nacionales')::int <> 1769
       OR (v_resumen->'totales'->>'internacionales')::int <> 443
       OR (v_resumen->'totales'->>'operadores')::int <> 256
       OR (v_resumen->'totales'->>'matriculas')::int <> 378
       OR v_resumen->'totales'->>'fecha_min' <> '2023-01-02'
       OR v_resumen->'totales'->>'fecha_max' <> '2023-12-30'
       OR (v_resumen->'totales'->>'pendientes')::int <> 2212 THEN
        RAISE EXCEPTION 'Los totales oficiales 2023 dejaron de cuadrar: %', v_resumen->'totales';
    END IF;

    WITH esperado(periodo, movimientos, llegadas, salidas, pax, pax_llegada, pax_salida) AS (
        VALUES
            ('2023-01', 120,  60,  60,  498, 291, 207),
            ('2023-02', 128,  64,  64,  402, 221, 181),
            ('2023-03', 158,  79,  79,  463, 216, 247),
            ('2023-04', 170,  85,  85, 1191, 585, 606),
            ('2023-05', 142,  71,  71,  513, 280, 233),
            ('2023-06', 226, 113, 113,  585, 294, 291),
            ('2023-07', 194,  97,  97,  452, 236, 216),
            ('2023-08', 170,  85,  85,  510, 359, 151),
            ('2023-09', 196,  98,  98,  427, 215, 212),
            ('2023-10', 270, 135, 135, 1109, 634, 475),
            ('2023-11', 230, 115, 115, 1167, 481, 686),
            ('2023-12', 208, 104, 104,  843, 289, 554)
    ), actual AS (
        SELECT m->>'periodo' AS periodo,
               (m->>'movimientos')::int AS movimientos,
               (m->>'llegadas')::int AS llegadas,
               (m->>'salidas')::int AS salidas,
               (m->>'pax')::int AS pax,
               (m->>'pax_llegada')::int AS pax_llegada,
               (m->>'pax_salida')::int AS pax_salida
          FROM jsonb_array_elements(v_resumen->'por_mes') m
    )
    SELECT count(*)
      INTO v_meses_incorrectos
      FROM esperado e
      FULL JOIN actual a USING (periodo)
     WHERE e.periodo IS NULL OR a.periodo IS NULL
        OR (e.movimientos, e.llegadas, e.salidas, e.pax, e.pax_llegada, e.pax_salida)
           IS DISTINCT FROM
           (a.movimientos, a.llegadas, a.salidas, a.pax, a.pax_llegada, a.pax_salida);

    IF v_meses_incorrectos <> 0 THEN
        RAISE EXCEPTION 'Hay % meses de 2023 que no cuadran con el Excel.', v_meses_incorrectos;
    END IF;

    RAISE NOTICE 'Aviación General 2023: las nueve horas quedaron corregidas.';
    RAISE NOTICE 'Filas y claves de origen ....... % / % (esperado 2212 / 2212)', v_filas, v_claves;
    RAISE NOTICE 'Totales oficiales .............. %', v_resumen->'totales';
    RAISE NOTICE 'Meses con diferencias .......... % (esperado 0)', v_meses_incorrectos;
END
$verificacion$;

-- Cambiar por COMMIT únicamente después de revisar todas las verificaciones.
ROLLBACK;
