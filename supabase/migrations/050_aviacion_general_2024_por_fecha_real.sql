-- =============================================================================
-- 050 — Aviación General: 2024 se cuenta por fecha real, no por rotación
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--
--   047 hizo que aviacion_general_resumen, en modo 'rotacion' (el que usan por
--   omisión tanto la pestaña Resumen de FBO como el módulo de Estadística),
--   ancle cada salida a la fecha de su llegada. Eso reprodujo al dígito el
--   reporte oficial de 2022.
--
--   El reporte oficial de 2024 ("Aviación General 2024PDFff.pdf", con tabla
--   resumen mensual y serie diaria completa) NO sigue esa misma convención.
--   Comparado mes por mes contra la base:
--
--     · Anclando por rotación:     salidas 1,379 / llegadas 1,398 — no cuadra.
--     · Contando por fecha real:   ENERO a DICIEMBRE, LOS 12 MESES, coinciden
--                                  al dígito contra el PDF, salvo dos huecos
--                                  ya identificados y explicados por completo:
--
--         JUNIO   — el PDF trae 88 salidas, la base 87. La diferencia es la
--                   fila 512|SALIDA|04/06/2024|N900MC, duplicada 2 veces en
--                   el Excel de origen (ya resuelta: id 3701 anulado).
--         OCTUBRE — el PDF trae 180 llegadas, la base 174. La diferencia son
--                   las filas 1137|LLEGADA|31/10/2024|XA-GIU y
--                   1138|LLEGADA|31/10/2024|XB-MXK, cada una repetida 4 veces
--                   en el Excel de origen (el antiduplicados de la
--                   importación ya las dejó en una sola fila cada una).
--
--     Contando por fecha real y sumando esas 7 filas duplicadas que el PDF
--     nunca filtró, se reproducen exactos los 1,373/1,404/2,777 del reporte.
--
--   Verificado contra el Excel maestro completo de 2024 (2,777 filas), no
--   sólo contra el PDF: descontando esas mismas 3 filas repetidas, coincide
--   perfecto con las 2,770 filas activas de la base, folio por folio.
--
-- QUÉ CAMBIA
--
--   aviacion_general_resumen, en modo 'rotacion', deja de anclar las SALIDAS
--   cuando su fecha real cae en 2024 O cuando la llegada a la que anclarían
--   cae en 2024: en cualquiera de los dos casos, fecha_conteo = fecha_operacion.
--
--   La segunda condición no es cosmética: sin ella, una salida de enero de
--   2025 cuya llegada fue en diciembre de 2024 seguiría colándose en el total
--   de 2024 por la puerta de atrás, y diciembre dejaría de cuadrar con el PDF
--   (que cierra 2024 en 142 salidas ese mes; verificado que no hay ninguna
--   salida de enero 2025 sumada ahí). Comprobado que no existe el caso
--   simétrico en la frontera 2023→2024 (ninguna salida de enero de 2024 ancla
--   hacia diciembre de 2023), así que 2023 no se mueve ni un movimiento con
--   este cambio.
--
--   Los demás años (2022, 2023, 2025, 2026...) siguen anclando exactamente
--   como antes, salvo por esa frontera con 2024. Las LLEGADAS nunca se
--   anclan, en ningún año: eso no cambia.
--
--   Esto es EL AJUSTE URGENTE que pidió la Gerencia para que Estadística y el
--   Resumen de FBO cuadren con el reporte de 2024 ya. Es una excepción por
--   año, escrita adentro de la función para que ninguna pantalla tenga que
--   cambiar: ambas ya llaman a esta función sin pasar p_modo, así que las dos
--   quedan corregidas con esta sola migración.
--
--   Que 2022 se cuente por rotación y 2024 por fecha real —dos convenciones
--   distintas en la misma tabla— no es un capricho de este SQL: es lo que
--   prueban, cada uno por su lado, los dos reportes oficiales. Mientras GAG no
--   unifique su forma de armar el reporte, la base tiene que poder reproducir
--   ambas. Queda pendiente decidir con más calma qué hacer con 2025 y 2026
--   (ninguno de los dos tiene todavía un reporte anual completo que permita
--   probarlo de la misma manera) — por ahora conservan el comportamiento de
--   'rotacion' que ya tenían.
--
-- REQUISITO: 047_aviacion_general_conteo_oficial.sql aplicado.
--
-- MODO DE USO
--   1) Correr el archivo completo. Termina en ROLLBACK.
--   2) Leer la VERIFICACIÓN del final: debe reproducir el reporte de 2024.
--   3) Si se ve bien, cambiar ROLLBACK por COMMIT y volver a correrlo.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;


-- =============================================================================
-- 0) CONTRATO
-- =============================================================================
DO $contrato$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'aviacion_general_ancla'
    ) THEN
        RAISE EXCEPTION 'Falta aplicar 047_aviacion_general_conteo_oficial.sql antes que ésta.';
    END IF;
END
$contrato$;


-- =============================================================================
-- 1) RESUMEN — excepción de 2024 dentro del modo 'rotacion'
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_resumen(
    p_filtros jsonb DEFAULT '{}'::jsonb,
    p_modo    text  DEFAULT 'rotacion'
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH base_ancla AS (
    -- El ancla se calcula una sola vez por fila aquí; para las LLEGADAS es un
    -- cálculo de sobra (la línea de abajo ya las resuelve a su propia fecha),
    -- pero separarlo en su propio CTE evita llamarlo tres veces por fila.
    SELECT o.*,
           public.aviacion_general_ancla(o.folio_rotacion, o.matricula, o.fecha_operacion) AS ancla_bruta
    FROM public.aviacion_general_operaciones o
    WHERE public.aviacion_general_filtro_ok(o, (p_filtros - 'fecha_desde') - 'fecha_hasta')
),
marcadas AS (
    SELECT ba.*,
           CASE
               WHEN COALESCE(p_modo, 'rotacion') <> 'rotacion' THEN ba.fecha_operacion
               WHEN ba.tipo_operacion = 'LLEGADA'                THEN ba.fecha_operacion
               -- 2024: el reporte oficial cuenta por fecha real, no por
               -- rotación. Verificado mes por mes contra
               -- "Aviación General 2024PDFff.pdf" — ver cabecera del archivo.
               -- Simétrico: también se evita anclar HACIA 2024 una salida de
               -- otro año (ver nota de enero 2025 → diciembre 2024 arriba).
               WHEN extract(year FROM ba.fecha_operacion)::int = 2024
                 OR extract(year FROM ba.ancla_bruta)::int = 2024
                    THEN ba.fecha_operacion
               ELSE ba.ancla_bruta
           END AS fecha_conteo
    FROM base_ancla ba
),
base AS (
    SELECT * FROM marcadas
     WHERE (COALESCE(p_filtros->>'fecha_desde', '') = ''
            OR fecha_conteo >= (p_filtros->>'fecha_desde')::date)
       AND (COALESCE(p_filtros->>'fecha_hasta', '') = ''
            OR fecha_conteo <= (p_filtros->>'fecha_hasta')::date)
)
SELECT jsonb_build_object(
    'modo', COALESCE(p_modo, 'rotacion'),
    'totales', (
        SELECT jsonb_build_object(
            'movimientos',      count(*),
            'llegadas',         count(*) FILTER (WHERE tipo_operacion = 'LLEGADA'),
            'salidas',          count(*) FILTER (WHERE tipo_operacion = 'SALIDA'),
            'nacionales',       count(*) FILTER (WHERE ambito_operacion = 'NACIONAL'),
            'internacionales',  count(*) FILTER (WHERE ambito_operacion = 'INTERNACIONAL'),
            'pax',              COALESCE(sum(pax_ag), 0),
            'pax_llegada',      COALESCE(sum(pax_ag) FILTER (WHERE tipo_operacion = 'LLEGADA'), 0),
            'pax_salida',       COALESCE(sum(pax_ag) FILTER (WHERE tipo_operacion = 'SALIDA'), 0),
            'adultos',          COALESCE(sum(adultos), 0),
            'infantes',         COALESCE(sum(infantes), 0),
            'rotaciones',       count(DISTINCT (folio_rotacion::text || '|' || fecha_conteo::text)),
            'operadores',       count(DISTINCT upper(operador)),
            'matriculas',       count(DISTINCT upper(matricula)),
            'pendientes',       count(*) FILTER (WHERE estado_validacion = 'PENDIENTE'),
            'validados',        count(*) FILTER (WHERE estado_validacion = 'VALIDADO'),
            'observados',       count(*) FILTER (WHERE estado_validacion = 'OBSERVADO'),
            'fecha_min',        min(fecha_conteo),
            'fecha_max',        max(fecha_conteo)
        ) FROM base
    ),
    'por_mes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'periodo', periodo, 'anio', anio, 'mes', mes,
                   'movimientos', movimientos, 'llegadas', llegadas,
                   'salidas', salidas, 'pax', pax,
                   'pax_llegada', pax_llegada, 'pax_salida', pax_salida
               ) ORDER BY periodo), '[]'::jsonb)
        FROM (
            SELECT to_char(fecha_conteo, 'YYYY-MM')      AS periodo,
                   extract(year  FROM fecha_conteo)::int AS anio,
                   extract(month FROM fecha_conteo)::int AS mes,
                   count(*)                              AS movimientos,
                   count(*) FILTER (WHERE tipo_operacion = 'LLEGADA') AS llegadas,
                   count(*) FILTER (WHERE tipo_operacion = 'SALIDA')  AS salidas,
                   COALESCE(sum(pax_ag), 0)              AS pax,
                   COALESCE(sum(pax_ag) FILTER (WHERE tipo_operacion = 'LLEGADA'), 0) AS pax_llegada,
                   COALESCE(sum(pax_ag) FILTER (WHERE tipo_operacion = 'SALIDA'), 0)  AS pax_salida
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
            SELECT upper(COALESCE(NULLIF(aeropuerto_origen_destino, ''),
                                  NULLIF(ciudad_origen_destino, ''), '(sin dato)')) AS clave,
                   count(*) AS movimientos, COALESCE(sum(pax_ag), 0) AS pax
            FROM base
            GROUP BY 1
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

COMMENT ON FUNCTION public.aviacion_general_resumen(jsonb, text) IS
'Cifras del tablero de Aviación General. p_modo=rotacion (por omisión): ancla cada salida a la fecha de su llegada, EXCEPTO en 2024, donde cuenta por fecha real porque así arma su reporte GAG ese año (ver migración 050). p_modo=movimiento cuenta siempre por fecha real, todos los años.';


-- =============================================================================
-- VERIFICACIÓN — debe reproducir el reporte oficial de 2024, mes por mes
--
-- Se esperan diferencias de EXACTAMENTE +1 salida en junio y +6 llegadas en
-- octubre frente al PDF: son las 3 filas duplicadas por accidente en el Excel
-- de origen (N900MC x2, XA-GIU x4, XB-MXK x4) que el reporte de GAG nunca
-- filtró y la base sí. Cualquier otra diferencia sí sería un problema real.
-- =============================================================================
SELECT m->>'periodo'            AS periodo,
       (m->>'salidas')::int     AS salidas_base,
       esperado.salidas         AS salidas_pdf,
       (m->>'llegadas')::int    AS llegadas_base,
       esperado.llegadas        AS llegadas_pdf
FROM jsonb_array_elements(
        public.aviacion_general_resumen(
            '{"fecha_desde":"2024-01-01","fecha_hasta":"2024-12-31"}'::jsonb
        )->'por_mes'
     ) AS m
JOIN (VALUES
        ('2024-01', 87, 91), ('2024-02', 110, 113), ('2024-03', 96, 96),
        ('2024-04', 110, 108), ('2024-05', 130, 131), ('2024-06', 88, 86),
        ('2024-07', 101, 98), ('2024-08', 91, 94), ('2024-09', 127, 144),
        ('2024-10', 168, 180), ('2024-11', 123, 119), ('2024-12', 142, 144)
     ) AS esperado(periodo, salidas, llegadas)
  ON esperado.periodo = m->>'periodo'
ORDER BY 1;

-- Y el total anual, para contraste con el reporte: 1,373 / 1,404 / 2,777
-- (la base dará 1,372 / 1,398 / 2,770 — la diferencia son las 7 filas
-- duplicadas explicadas arriba, no un dato faltante).
SELECT (public.aviacion_general_resumen('{"fecha_desde":"2024-01-01","fecha_hasta":"2024-12-31"}'::jsonb)->'totales'->>'salidas')::int      AS salidas_2024,
       (public.aviacion_general_resumen('{"fecha_desde":"2024-01-01","fecha_hasta":"2024-12-31"}'::jsonb)->'totales'->>'llegadas')::int     AS llegadas_2024,
       (public.aviacion_general_resumen('{"fecha_desde":"2024-01-01","fecha_hasta":"2024-12-31"}'::jsonb)->'totales'->>'movimientos')::int  AS movimientos_2024;

-- Y que 2022 no se haya movido: sigue dando 457 (458 del reporte, menos el
-- GN-106 sin confirmar — ver 047 y 048).
SELECT (public.aviacion_general_resumen('{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb)->'totales'->>'movimientos')::int AS movimientos_2022_debe_dar_457;

-- Cambiar por COMMIT cuando la verificación se vea bien.
ROLLBACK;
