-- =============================================================================
-- 051 — Aviación General: conteo de 2025 por fecha real
--
-- FUENTE VERIFICADA EL 2026-09-15
--   Aviación General 2025 (1).xlsx, hojas Data, Ops y Pax A.G.
--   SHA256: 7cf0c5440f82b452891907ba68341899146c5537ce08e9ee73248a1b942761aa
--
--   Las fórmulas de Ops y Pax A.G. cuentan por fecha real. Data contiene
--   3,071 filas de 2025 y 27 de enero de 2026, excluidas del cierre 2025.
--   Se comprobaron los 12 meses y los 365 días de operaciones y pasajeros.
--
--   El reporte cierra con 1,541 salidas, 1,530 llegadas y 21,114 pasajeros.
--   La base anterior a 052 tenía 3,064 movimientos y 21,100 pasajeros:
--   faltaban siete filas repetidas del Excel (una en junio con cero pax y
--   seis en septiembre con 14 pax). La causa ya está identificada.
--
--   Por indicación del usuario se incluyen todas las filas del reporte,
--   aun repetidas, manteniéndolas PENDIENTES y documentadas. La migración
--   052 incorpora esas siete filas y concilia los dos totales contradictorios
--   de noviembre, once horas y un destino. Ver docs/modulo-aviacion-general.md.
--
-- QUÉ CAMBIA ESTA MIGRACIÓN
--   Únicamente la función de resumen: las salidas cuya fecha real o ancla
--   cae en 2024/2025 se cuentan por fecha real. Se protege también la
--   frontera con otros años; las llegadas mantienen siempre su fecha real.
--   Los datos de operaciones se concilian por separado en 052.
--
-- REQUISITO: 047_aviacion_general_conteo_oficial.sql aplicada.
-- MODO DE USO: ejecutar completo con ROLLBACK; revisar y cambiar a COMMIT
-- para aplicar. Tras 052 la verificación debe coincidir con el reporte.
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
-- 1) RESUMEN — 2024 y 2025 fuera del anclaje por rotación
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
               -- 2024 y 2025: los reportes oficiales de esos años cuentan por
               -- fecha real, no por rotación (ver 050 para 2024 y la cabecera
               -- de este archivo para 2025). Simétrico en ambas fronteras de
               -- año: tampoco se ancla HACIA 2024/2025 una salida de otro año.
               WHEN extract(year FROM ba.fecha_operacion)::int IN (2024, 2025)
                 OR extract(year FROM ba.ancla_bruta)::int     IN (2024, 2025)
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
'Cifras del tablero de Aviación General. p_modo=rotacion (por omisión): ancla cada salida a la fecha de su llegada, EXCEPTO en 2024 y 2025, donde cuenta por fecha real porque así lo prueban sus reportes oficiales (ver migraciones 050 y 051). p_modo=movimiento cuenta siempre por fecha real, todos los años.';


-- =============================================================================
-- VERIFICACIÓN — pasajeros mensuales contra Ops/Pax A.G. del Excel 2025.
-- Antes de 052 septiembre difiere en -9 salida / -5 llegada; después de 052
-- los 12 meses deben coincidir. 052 verifica también movimientos y ámbito.
-- =============================================================================
SELECT m->>'periodo'              AS periodo,
       (m->>'pax_salida')::int    AS pax_salida_base,
       esperado.pax_salida        AS pax_salida_reporte,
       (m->>'pax_llegada')::int   AS pax_llegada_base,
       esperado.pax_llegada       AS pax_llegada_reporte
FROM jsonb_array_elements(
        public.aviacion_general_resumen(
            '{"fecha_desde":"2025-01-01","fecha_hasta":"2025-12-31"}'::jsonb
        )->'por_mes'
     ) AS m
JOIN (VALUES
        ('2025-01',  298, 2055), ('2025-02',  555,  793), ('2025-03',  831,  770),
        ('2025-04', 1372,  468), ('2025-05', 1102,  474), ('2025-06', 1798, 1379),
        ('2025-07', 1063,  452), ('2025-08',  776, 2257), ('2025-09',  450,  498),
        ('2025-10',  801,  497), ('2025-11',  558,  531), ('2025-12',  921,  415)
     ) AS esperado(periodo, pax_salida, pax_llegada)
  ON esperado.periodo = m->>'periodo'
ORDER BY 1;

-- Total anual del reporte y objetivo tras 052: 10,525 / 10,589 / 21,114.
-- Antes de 052: 10,516 / 10,584 / 21,100 por las seis copias de septiembre.
SELECT (public.aviacion_general_resumen('{"fecha_desde":"2025-01-01","fecha_hasta":"2025-12-31"}'::jsonb)->'totales'->>'pax_salida')::int  AS pax_salida_2025,
       (public.aviacion_general_resumen('{"fecha_desde":"2025-01-01","fecha_hasta":"2025-12-31"}'::jsonb)->'totales'->>'pax_llegada')::int AS pax_llegada_2025,
       (public.aviacion_general_resumen('{"fecha_desde":"2025-01-01","fecha_hasta":"2025-12-31"}'::jsonb)->'totales'->>'pax')::int         AS pax_total_2025;

-- Y que 2024 no se haya movido: sigue dando los mismos totales que dejó 050.
SELECT (public.aviacion_general_resumen('{"fecha_desde":"2024-01-01","fecha_hasta":"2024-12-31"}'::jsonb)->'totales'->>'movimientos')::int AS movimientos_2024;

-- Cambiar por COMMIT cuando la verificación se vea bien.
ROLLBACK;
