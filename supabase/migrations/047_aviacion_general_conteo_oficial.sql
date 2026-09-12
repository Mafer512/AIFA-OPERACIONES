-- =============================================================================
-- 047 — Aviación General: conteo OFICIAL por rotación
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--
--   El reporte oficial de GAG ("Operaciones de Aviación General 2022 LA BUENA")
--   cierra 2022 con 458 operaciones y 1,385 pasajeros. El módulo, contando cada
--   movimiento en la fecha en que ocurrió, daba 455. Durante días eso pareció
--   un faltante de datos. No lo era: son DOS FORMAS DE CONTAR, y se reconcilian
--   exactamente.
--
--   El reporte cuenta por ROTACIÓN: ancla la salida a la fecha de la llegada
--   con la que forma pareja. Si una aeronave llega el 25 de diciembre y despega
--   el 2 de enero, el reporte cuenta las dos operaciones en diciembre. La base,
--   en cambio, guarda la fecha real de cada movimiento —que es más preciso y no
--   se toca—, así que esa salida caía en enero del año siguiente.
--
--   Verificado contra los datos reales antes de escribir una línea de SQL:
--   anclando cada salida a su llegada, NUEVE DE LOS DIEZ MESES de 2022 cuadran
--   al dígito en las cuatro cifras del reporte (operaciones de salida y de
--   llegada, pasajeros de salida y de llegada).
--
-- LA ÚNICA DIFERENCIA QUE QUEDA, Y NO LA INVENTA ESTE SQL
--
--   Noviembre 2022: el reporte dice 54 salidas, los datos tienen 53.
--   Corresponde a GN-106 (GUARDIA NACIONAL), que llegó el 03/11/2022 y cuyo
--   ÚNICO movimiento en todo el histórico es esa llegada: el Excel de origen no
--   trae su salida. El reporte le asigna una porque su tabla diaria fuerza
--   "salidas = llegadas" todos los días.
--
--   Mientras GAG no confirme si esa aeronave salió, el módulo reportará 457 y
--   no 458. Fabricar aquí el movimiento que falta sería inventar un dato.
--
-- QUÉ CAMBIA
--
--   aviacion_general_resumen gana un segundo parámetro, p_modo:
--     'rotacion'   (por omisión) — conteo OFICIAL, el del reporte de GAG.
--     'movimiento'                — fecha real de cada movimiento.
--
--   Se agrega aviacion_general_ancla(), que resuelve a qué fecha pertenece
--   cada movimiento, y dos índices que la sostienen.
--
--   Nada más se toca: ni tablas, ni datos, ni las otras siete funciones. El
--   listado de Movimientos sigue mostrando la fecha real de cada operación,
--   porque ahí lo que se consulta es el movimiento, no el reporte.
--
-- REQUISITO: 046_aviacion_general_fbo.sql aplicado.
--
-- MODO DE USO
--   1) Correr el archivo completo. Termina en ROLLBACK.
--   2) Leer la VERIFICACIÓN del final: debe reproducir el reporte de 2022.
--   3) Si se ve bien, cambiar ROLLBACK por COMMIT y volver a correrlo.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;


-- =============================================================================
-- 0) CONTRATO
-- =============================================================================
DO $contrato$
BEGIN
    IF to_regclass('public.aviacion_general_operaciones') IS NULL THEN
        RAISE EXCEPTION 'No existe public.aviacion_general_operaciones.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'aviacion_general_filtro_ok'
    ) THEN
        RAISE EXCEPTION 'Falta aplicar 046_aviacion_general_fbo.sql antes que ésta.';
    END IF;
END
$contrato$;


-- =============================================================================
-- 1) ÍNDICES QUE SOSTIENEN EL ANCLAJE
--
-- El anclaje busca, para cada salida, la llegada de su misma rotación. Sin
-- estos índices eso es un recorrido completo de la tabla por cada salida.
-- =============================================================================
CREATE INDEX IF NOT EXISTS ix_ag_ops_rotacion
    ON public.aviacion_general_operaciones (folio_rotacion, upper(matricula), fecha_operacion)
    WHERE estatus_registro = 'ACTIVO';

CREATE INDEX IF NOT EXISTS ix_ag_ops_llegadas_rotacion
    ON public.aviacion_general_operaciones (folio_rotacion, upper(matricula), fecha_operacion)
    WHERE estatus_registro = 'ACTIVO' AND tipo_operacion = 'LLEGADA';


-- =============================================================================
-- 2) ANCLA — ¿a qué fecha pertenece este movimiento en el reporte oficial?
--
-- Devuelve la fecha de la LLEGADA de su rotación; si no la encuentra, su propia
-- fecha.
--
-- LA VENTANA DE 60 DÍAS NO ES DECORATIVA. El folio de rotación se REINICIA cada
-- año: en 2022 eran 202200046 y en 2026 son 977, 976, 95. Sin acotar por fecha,
-- una salida de 2026 con folio 95 podría engancharse a una llegada de 2025 con
-- el mismo folio. Sesenta días cubre de sobra una estancia en plataforma —la
-- más larga del histórico cruza nueve días— y deja fuera cualquier reutilización
-- de folio entre años.
--
-- A las LLEGADAS no se les calcula nada: son su propia ancla. Además de ser
-- cierto, evita la mitad del trabajo.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aviacion_general_ancla(
    p_folio     integer,
    p_matricula text,
    p_fecha     date
) RETURNS date
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
    SELECT COALESCE(
        (SELECT max(l.fecha_operacion)
           FROM public.aviacion_general_operaciones l
          WHERE l.tipo_operacion   = 'LLEGADA'
            AND l.estatus_registro = 'ACTIVO'
            AND l.folio_rotacion   = p_folio
            AND upper(l.matricula) = upper(p_matricula)
            AND l.fecha_operacion <= p_fecha
            AND l.fecha_operacion >= p_fecha - 60),
        p_fecha);
$fn$;

COMMENT ON FUNCTION public.aviacion_general_ancla(integer, text, date) IS
'Fecha a la que pertenece un movimiento en el conteo oficial por rotación: la de la llegada de su misma rotación (folio + matrícula, dentro de 60 días), o la suya propia si no la tiene.';


-- =============================================================================
-- 3) RESUMEN — ahora con modo de conteo
--
-- En modo 'rotacion' el rango de fechas del filtro se aplica sobre la fecha
-- ANCLA, no sobre la del movimiento. Es lo que hace que la salida del 2 de
-- enero de 2023 aparezca al pedir diciembre de 2022, que es justo lo que hace
-- el reporte oficial.
-- =============================================================================
DROP FUNCTION IF EXISTS public.aviacion_general_resumen(jsonb);

CREATE OR REPLACE FUNCTION public.aviacion_general_resumen(
    p_filtros jsonb DEFAULT '{}'::jsonb,
    p_modo    text  DEFAULT 'rotacion'
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH marcadas AS (
    SELECT o.*,
           CASE
               WHEN COALESCE(p_modo, 'rotacion') <> 'rotacion' THEN o.fecha_operacion
               WHEN o.tipo_operacion = 'LLEGADA'               THEN o.fecha_operacion
               ELSE public.aviacion_general_ancla(o.folio_rotacion, o.matricula, o.fecha_operacion)
           END AS fecha_conteo
    FROM public.aviacion_general_operaciones o
    -- Se le quitan las fechas al filtro: aquí sólo se aplican las condiciones
    -- que no dependen de en qué fecha se decida contar el movimiento.
    WHERE public.aviacion_general_filtro_ok(o, (p_filtros - 'fecha_desde') - 'fecha_hasta')
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
            -- Se lee el código y, si no lo hay, la ciudad: hasta 2024 el origen
            -- se anotó como ciudad y leer sólo una columna dejaba media tabla
            -- fuera del desglose.
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
'Cifras del tablero de Aviación General. p_modo=rotacion (por omisión) reproduce el conteo del reporte oficial de GAG, anclando cada salida a la fecha de su llegada; p_modo=movimiento cuenta cada operación en la fecha en que ocurrió.';


-- =============================================================================
-- 4) PERMISOS
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.aviacion_general_ancla(integer, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviacion_general_resumen(jsonb, text)       TO anon, authenticated;


-- =============================================================================
-- VERIFICACIÓN — debe reproducir el reporte oficial de 2022
-- =============================================================================
SELECT * FROM (
    VALUES
        (1, 'Operaciones 2022 (oficial, por rotación)',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'movimientos'),
            'el reporte dice 458; se esperan 457 mientras no se aclare GN-106'),
        (2, 'Pasajeros 2022 (oficial)',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'pax'),
            'el reporte dice 1,385'),
        (3, 'Pax llegada 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'pax_llegada'),
            'el reporte dice 698'),
        (4, 'Pax salida 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'pax_salida'),
            'el reporte dice 687'),
        (5, 'Llegadas 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'llegadas'),
            'el reporte dice 229'),
        (6, 'Salidas 2022',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
             )->'totales'->>'salidas'),
            'el reporte dice 229; faltará 1 por GN-106'),
        (7, 'Operaciones 2022 (por fecha de movimiento)',
            (public.aviacion_general_resumen(
                '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'movimiento'
             )->'totales'->>'movimientos'),
            'el otro conteo, para contraste: 455'),
        (8, 'Funciones aviacion_general_*',
            (SELECT count(*)::text FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'aviacion_general_%'),
            'se esperan 9')
) AS v(orden, concepto, valor, nota)
ORDER BY orden;

-- Y el desglose mensual de 2022, para contrastarlo renglón por renglón con el
-- reporte: MAR 17/17 · ABR 12/12 · MAY 24/24 · JUN 12/12 · JUL 12/12 ·
-- AGO 10/10 · SEP 19/19 · OCT 38/38 · NOV 54/54 · DIC 31/31 (salidas/llegadas).
SELECT m->>'periodo'                AS periodo,
       (m->>'salidas')::int         AS salidas,
       (m->>'llegadas')::int        AS llegadas,
       (m->>'pax_salida')::int      AS pax_salida,
       (m->>'pax_llegada')::int     AS pax_llegada,
       (m->>'movimientos')::int     AS operaciones
FROM jsonb_array_elements(
        public.aviacion_general_resumen(
            '{"fecha_desde":"2022-01-01","fecha_hasta":"2022-12-31"}'::jsonb, 'rotacion'
        )->'por_mes'
     ) AS m
ORDER BY 1;

-- Cambiar por COMMIT cuando la verificación se vea bien.
ROLLBACK;
