-- =============================================================================
-- Diagnóstico del catálogo de aeronaves contra los manifiestos reales
--
-- SÓLO LECTURA: todas son consultas SELECT; no crean ni cambian nada.
-- El editor SQL de Supabase muestra sólo el último resultado: correr cada
-- consulta por separado (seleccionarla y Run).
--
-- Tabla: public.maestra_manifiestos (no está definida en el repositorio; se
-- verifica su esquema en la consulta 0 antes de todo lo demás). Si alguna
-- columna esperada no existe o se llama distinto, ajustar los nombres antes
-- de correr el resto.
--
-- El catálogo de modelos vive en data/master/aircraft type.csv; las consultas
-- 3, 8 y 9 lo traen embebido (versión corregida del 2026-10-06, 100 filas). Si el
-- CSV cambia, regenerar esa lista.
-- Las consultas 7 y 8 requieren la migración 058 aplicada (COMMIT).
--
-- Contexto y resultados de la muestra de junio 2026:
-- docs/catalogo-aeronaves-revision.md
-- =============================================================================


-- 0) Esquema real de la tabla -------------------------------------------------
SELECT ordinal_position, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'maestra_manifiestos'
 ORDER BY ordinal_position;

-- 0b) ¿Están las columnas que usan estas consultas, con su nombre exacto?
SELECT esperada,
       EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'public' AND c.table_name = 'maestra_manifiestos'
                  AND c.column_name = esperada) AS existe
  FROM unnest(ARRAY['id', 'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA', 'AEROLINEA', 'FECHA',
                    'TIPO DE MANIFIESTO', 'TIPO DE OPERACIÓN', 'OBSERVACIONES',
                    'tipo_reporte', 'datos_origen']) AS esperada;


-- 1) FECHA es texto: formatos presentes y valores que no se pueden convertir --
--    _aifa_parse_manifest_date (migración 010) entiende DD/MM/AAAA y AAAA-MM-DD
--    y regresa NULL en lugar de fallar.
SELECT regexp_replace(coalesce("FECHA", '<NULL>'), '[0-9]', '9', 'g') AS formato,
       count(*) AS registros,
       count(*) FILTER (WHERE public._aifa_parse_manifest_date("FECHA") IS NULL) AS no_convertibles,
       -- DD/MM con día <= 12 también se leería como MM/DD: el orden no se puede
       -- comprobar con el valor solo.
       -- (CASE para que el ::int sólo se evalúe sobre texto ya validado.)
       count(*) FILTER (WHERE CASE WHEN "FECHA" ~ '^\s*[0-9]{1,2}/[0-9]{1,2}/'
                                   THEN split_part(btrim("FECHA"), '/', 1)::int <= 12
                              ELSE false END) AS dia_mes_intercambiables,
       min("FECHA") AS ejemplo
  FROM public.maestra_manifiestos
 GROUP BY 1
 ORDER BY 2 DESC;

-- 1b) Los valores de FECHA que no se pueden convertir con seguridad.
SELECT "FECHA", count(*) AS registros
  FROM public.maestra_manifiestos
 WHERE public._aifa_parse_manifest_date("FECHA") IS NULL
 GROUP BY 1
 ORDER BY 2 DESC
 LIMIT 200;


-- 2) Estructura real de datos_origen (no se presuponen sus claves) ------------
SELECT jsonb_typeof(datos_origen) AS tipo, count(*) AS registros
  FROM public.maestra_manifiestos
 GROUP BY 1;

-- 2b) Claves de primer nivel.
SELECT k AS clave, count(*) AS registros
  FROM public.maestra_manifiestos m,
       LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(m.datos_origen) = 'object'
                                      THEN m.datos_origen ELSE '{}'::jsonb END) AS k
 GROUP BY 1
 ORDER BY 2 DESC;

-- 2c) Claves de segundo nivel (cuando el valor es un objeto), marcando las que
--     parecen de aeronave o matrícula.
SELECT e.key AS clave, k2 AS subclave, count(*) AS registros,
       k2 ~* '(aeronave|aircraft|equipo|ac.?type|registration|matr[ií]cula|avi[oó]n)' AS parece_aeronave
  FROM public.maestra_manifiestos m,
       LATERAL jsonb_each(CASE WHEN jsonb_typeof(m.datos_origen) = 'object'
                               THEN m.datos_origen ELSE '{}'::jsonb END) AS e,
       LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(e.value) = 'object'
                                      THEN e.value ELSE '{}'::jsonb END) AS k2
 GROUP BY 1, 2
 ORDER BY parece_aeronave DESC, registros DESC
 LIMIT 300;


-- 3) Valores distintos de AERONAVE, frecuencia y clasificación ----------------
WITH catalogo(iata, icao, nombre) AS (
    VALUES
        ('E95', 'E195', 'ERJ-195'), ('ER4', 'E145', 'RJ145'), ('E7W', 'E75L', 'ERJ-175W'),
        ('E90', 'E190', 'ERJ-190'), ('E70', 'E170', 'E170'), ('E75', 'E75L', 'ERJ-175'),
        ('73S', 'B737', 'B737-700 Freighter (winglets)'), ('CRJ', NULL::text, 'CRJ'), ('73K', 'B738', 'B737-800 Freighter'),
        ('CRK', 'CRJX', 'CRJ-1000'), ('7M8', 'B38M', 'B737 MAX 8'), ('M80', 'MD81', 'McDonnell Douglas MD-80'),
        ('73C', 'B733', 'B737-300W'), ('CRA', 'CRJ9', 'CRJ-700'), ('73W', 'B737', 'B737-700 (winglets)'),
        ('7M7', 'B37M', '737 MAX 7'), ('73J', 'B739', 'B737-900 (winglets)'), ('73M', 'B732', 'B737-200 Combi'),
        ('73G', 'B737', 'B737-700'), ('CNF', 'C208', 'CESSNA 208B'), ('73H', 'B738', 'B737-800 (winglets)'),
        ('CR7', 'CRJ7', 'CRJ-700'), ('LOH', 'C130', 'C-130'), ('CR9', 'CRJ9', 'CRJ-900'),
        ('CR1', 'CRJ1', 'CRJ-100'), ('CR2', 'CRJ2', 'CRJ-200'), ('7M9', 'B39M', '737 MAX 9'),
        ('AT7', 'AT72', 'ATR-72'), ('76F', 'B763', 'B767 All Freighter'), ('739', 'B739', 'B737-900ER'),
        ('789', 'B789', 'B787-9'), ('7M1', 'B3XM', '737 MAX 10'), ('737', 'B737', 'B737-700'),
        ('781', 'B78X', 'B787-10'), ('738', 'B738', 'B737-800'), ('788', 'B788', 'B787-8'),
        ('735', 'B735', 'B737-500'), ('AB3', 'A306', 'Airbus A300B4-605R'), ('736', 'B736', 'B737-600'),
        ('CES', 'C208', 'CESSNA'), ('733', 'B733', 'B737-300'), ('734', 'B734', 'B737-400'),
        ('731', 'B731', 'B737-100'), ('732', 'B732', 'B737-200'), ('722', 'B722', 'B727-200'),
        ('77F', 'B77L', 'B777-200F'), ('77L', 'B77L', 'B777-200LR'), ('77W', 'B77W', 'B777-300ER'),
        ('773', 'B773', 'B777-300'), ('772', 'B772', 'B777-200ER'), ('764', 'B764', 'B767-400ER'),
        ('76W', 'B763', 'B767-300 (winglets)'), ('727', 'B722', 'B727-200'), ('762', 'B762', 'B767-200'),
        ('721', 'B721', 'B727-100'), ('763', 'B763', 'B767-300ER'), ('359', 'A359', 'A350-900'),
        ('380', 'A388', 'A380-800'), ('75F', 'B752', 'B757-200PF'), ('346', 'A346', 'A340-600'),
        ('351', 'A35K', 'A350-1000'), ('SF3', 'SF34', 'Saab 340'), ('343', 'A343', 'A340-300'),
        ('345', 'A345', 'A340-500'), ('333', 'A333', 'A330-300'), ('342', 'A342', 'A340-200'),
        ('SW4', NULL::text, 'Swearingen Metroliner'), ('DC9', 'DC93', 'McDonnell-Douglas DC-9-33F'), ('75W', 'B752', 'B757-200 (winglets)'),
        ('752', 'B752', 'B757-200'), ('74Y', 'B744', 'B747-400F'), ('753', 'B753', 'B757-300'),
        ('748', 'B748', 'B747-8I'), ('74N', 'B748', 'B747-8F'), ('339', 'A339', 'Airbus A330-900'),
        ('332', 'A332', 'A330-200'), ('744', 'B744', 'B747-400'), ('747', 'B741', 'B747-100'),
        ('319', 'A319', 'A319'), ('742', 'B742', 'B747-200'), ('32Q', 'A21N', 'A321neo'),
        ('743', 'B743', 'B747-300'), ('321', 'A321', 'A321-100/200'), ('77X', 'B77L', 'B777-200F'),
        ('318', 'A318', 'A318'), ('SW3', NULL::text, 'Swearingen Aircraft'), ('312', 'A310', 'A310-200'),
        ('320', 'A320', 'A320-100/200'), ('EM2', 'E120', 'Embraer EMB 120 Brasilia'), ('310', 'A310', 'A310'),
        ('313', 'A310', 'A310-300'), ('F20', 'FA20', 'Falcon 20'), ('ANF', 'AN12', 'Antonov An-12'),
        ('76X', 'B762', 'B767-200 Freighter'), ('32A', 'A320', 'Airbus A320-200 Ceo'), ('M83', 'MD83', 'McDonnell Douglas 83'),
        ('7S8', 'B738', 'Boeing 737-800 (Scimitar wl)'), ('76Y', 'B763', 'B767-300F'), ('M11', 'MD11', 'McDonnell Douglas MD-11'),
        ('32N', 'A20N', 'A320neo')
),
icao AS (
    SELECT icao, min(iata) AS iata, count(DISTINCT iata) AS variantes
      FROM catalogo WHERE icao IS NOT NULL GROUP BY icao
),
nombres AS (
    SELECT upper(nombre) AS nombre, min(iata) AS iata, count(*) AS entradas
      FROM catalogo GROUP BY 1
),
obs AS (
    SELECT "AERONAVE" AS valor,
           upper(btrim(regexp_replace(coalesce("AERONAVE", ''), '\s+', ' ', 'g'))) AS clave,
           count(*) AS registros,
           count(DISTINCT "MATRÍCULA") AS matriculas,
           count(DISTINCT "AEROLINEA") AS aerolineas,
           min(public._aifa_parse_manifest_date("FECHA")) AS desde,
           max(public._aifa_parse_manifest_date("FECHA")) AS hasta
      FROM public.maestra_manifiestos
     GROUP BY 1
)
SELECT o.valor, o.registros, o.matriculas, o.aerolineas, o.desde, o.hasta,
       CASE
           WHEN o.clave = '' THEN 'vacío'
           WHEN c.iata IS NOT NULL THEN 'código IATA del catálogo: ' || c.nombre
           WHEN i.variantes = 1 THEN 'ICAO inequívoco → ' || i.iata
           WHEN i.variantes > 1 THEN 'ICAO ambiguo: ' || i.variantes || ' variantes IATA'
           WHEN n.entradas = 1 THEN 'nombre del catálogo → ' || n.iata
           WHEN n.entradas > 1 THEN 'nombre repetido en el catálogo'
           ELSE 'fuera del catálogo'
       END AS clasificacion,
       o.valor IS DISTINCT FROM btrim(o.valor) OR o.valor ~ '\s{2,}' AS espacios_sobrantes,
       o.valor IS DISTINCT FROM upper(o.valor) AS minusculas
  FROM obs o
  LEFT JOIN catalogo c ON c.iata = o.clave
  LEFT JOIN icao i ON i.icao = o.clave
  LEFT JOIN nombres n ON n.nombre = o.clave
 ORDER BY o.registros DESC;


-- 4) Escrituras distintas del mismo valor (espacios, guiones, mayúsculas) -----
--    Sólo agrupa por escritura; NO dice que sean el mismo modelo.
SELECT regexp_replace(upper(coalesce("AERONAVE", '')), '[\s_.-]', '', 'g') AS compacto,
       array_agg(DISTINCT "AERONAVE") AS escrituras,
       count(*) AS registros
  FROM public.maestra_manifiestos
 GROUP BY 1
HAVING count(DISTINCT "AERONAVE") > 1
 ORDER BY 3 DESC;


-- 5) Una matrícula con varios modelos en el mismo mes -------------------------
--    Se comparan escrituras compactas ("A320" = "A-320"), así que sólo salen
--    diferencias de modelo (A320 contra A321, E-190 contra E-195…). Una
--    matrícula puede cambiar de aerolínea con el tiempo, no de modelo en un mes.
WITH m AS (
    SELECT upper(regexp_replace("MATRÍCULA", '[\s.-]', '', 'g')) AS matricula,
           date_trunc('month', public._aifa_parse_manifest_date("FECHA"))::date AS mes,
           regexp_replace(upper(coalesce("AERONAVE", '')), '[\s_.-]', '', 'g') AS modelo,
           "AERONAVE" AS valor,
           "AEROLINEA" AS aerolinea
      FROM public.maestra_manifiestos
     WHERE nullif(btrim("MATRÍCULA"), '') IS NOT NULL
)
SELECT matricula, mes, count(*) AS registros,
       count(DISTINCT modelo) AS modelos_distintos,
       string_agg(DISTINCT coalesce(valor, '<vacío>'), ' | ') AS valores,
       string_agg(DISTINCT aerolinea, ' | ') AS aerolineas
  FROM m
 GROUP BY matricula, mes
HAVING count(DISTINCT modelo) > 1
 ORDER BY registros DESC;


-- 6) Valores vacíos, genéricos o en el campo equivocado -----------------------
SELECT count(*) FILTER (WHERE nullif(btrim("AERONAVE"), '') IS NULL) AS aeronave_vacia,
       count(*) FILTER (WHERE upper(btrim("AERONAVE")) IN
           ('-', '.', '0', 'NA', 'N/A', 'S/D', 'SD', 'SIN DATO', 'PENDIENTE', 'TBD', 'TBA', 'XXX', 'AVION', 'AERONAVE'))
           AS aeronave_generica,
       count(*) FILTER (WHERE nullif(btrim("MATRÍCULA"), '') IS NULL) AS matricula_vacia
  FROM public.maestra_manifiestos;

-- 6b) AERONAVE que en realidad es una matrícula (aparece como MATRÍCULA en
--     otro manifiesto o en el catálogo de matrículas).
WITH mats AS (
    SELECT upper(regexp_replace("MATRÍCULA", '[\s.-]', '', 'g')) AS m FROM public.maestra_manifiestos
    UNION
    SELECT upper(regexp_replace(matricula, '[\s.-]', '', 'g')) FROM public.matriculas_manifiestos
)
SELECT "AERONAVE", count(*) AS registros
  FROM public.maestra_manifiestos
 WHERE upper(regexp_replace("AERONAVE", '[\s.-]', '', 'g')) IN (SELECT m FROM mats WHERE m <> '')
 GROUP BY 1
 ORDER BY 2 DESC;

-- 6c) MATRÍCULA con forma de modelo o código de aeronave.
SELECT "MATRÍCULA", "AERONAVE", count(*) AS registros
  FROM public.maestra_manifiestos
 WHERE upper(btrim("MATRÍCULA")) ~ '^(A3[0-9]{2}|B7[0-9]{2}|E-?1[79][05]|ERJ|CRJ|ATR|C208|MD-?[0-9]{2}|[0-9]{3})([ -].*)?$'
 GROUP BY 1, 2
 ORDER BY 3 DESC;

-- 6d) Matrículas de los manifiestos que no están en el catálogo de matrículas.
SELECT upper(regexp_replace(m."MATRÍCULA", '[\s.-]', '', 'g')) AS matricula,
       string_agg(DISTINCT m."AEROLINEA", ' | ') AS aerolineas,
       string_agg(DISTINCT m."AERONAVE", ' | ') AS aeronaves,
       count(*) AS registros
  FROM public.maestra_manifiestos m
 WHERE nullif(btrim(m."MATRÍCULA"), '') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM public.matriculas_manifiestos c
         WHERE upper(regexp_replace(c.matricula, '[\s.-]', '', 'g'))
             = upper(regexp_replace(m."MATRÍCULA", '[\s.-]', '', 'g')))
 GROUP BY 1
 ORDER BY 4 DESC;


-- 7) Cobertura de la tabla de equivalencias (requiere 058) --------------------
WITH m AS (
    SELECT upper(btrim(regexp_replace(coalesce("AERONAVE", ''), '\s+', ' ', 'g'))) AS clave,
           upper(regexp_replace(coalesce("MATRÍCULA", ''), '[\s.-]', '', 'g')) AS matricula
      FROM public.maestra_manifiestos
)
SELECT coalesce(e.estado, 'sin equivalencia') AS estado,
       coalesce(e.nivel, '—') AS nivel,
       count(*) AS registros
  FROM m
  LEFT JOIN LATERAL (
        SELECT q.estado, q.nivel
          FROM public.catalogo_aeronaves_equivalencias q
         WHERE q.valor_clave = m.clave
           AND (q.matricula IS NULL OR q.matricula = m.matricula)
         ORDER BY q.matricula NULLS LAST
         LIMIT 1
  ) e ON true
 GROUP BY 1, 2
 ORDER BY 3 DESC;

-- 8) Valores nuevos: ni código del catálogo ni equivalencia registrada --------
--    (requiere 058). Es la lista de trabajo para seguir completando 058.
WITH catalogo(iata, icao) AS (
    VALUES
        ('E95', 'E195'), ('ER4', 'E145'), ('E7W', 'E75L'), ('E90', 'E190'), ('E70', 'E170'), ('E75', 'E75L'),
        ('73S', 'B737'), ('CRJ', NULL::text), ('73K', 'B738'), ('CRK', 'CRJX'), ('7M8', 'B38M'), ('M80', 'MD81'),
        ('73C', 'B733'), ('CRA', 'CRJ9'), ('73W', 'B737'), ('7M7', 'B37M'), ('73J', 'B739'), ('73M', 'B732'),
        ('73G', 'B737'), ('CNF', 'C208'), ('73H', 'B738'), ('CR7', 'CRJ7'), ('LOH', 'C130'), ('CR9', 'CRJ9'),
        ('CR1', 'CRJ1'), ('CR2', 'CRJ2'), ('7M9', 'B39M'), ('AT7', 'AT72'), ('76F', 'B763'), ('739', 'B739'),
        ('789', 'B789'), ('7M1', 'B3XM'), ('737', 'B737'), ('781', 'B78X'), ('738', 'B738'), ('788', 'B788'),
        ('735', 'B735'), ('AB3', 'A306'), ('736', 'B736'), ('CES', 'C208'), ('733', 'B733'), ('734', 'B734'),
        ('731', 'B731'), ('732', 'B732'), ('722', 'B722'), ('77F', 'B77L'), ('77L', 'B77L'), ('77W', 'B77W'),
        ('773', 'B773'), ('772', 'B772'), ('764', 'B764'), ('76W', 'B763'), ('727', 'B722'), ('762', 'B762'),
        ('721', 'B721'), ('763', 'B763'), ('359', 'A359'), ('380', 'A388'), ('75F', 'B752'), ('346', 'A346'),
        ('351', 'A35K'), ('SF3', 'SF34'), ('343', 'A343'), ('345', 'A345'), ('333', 'A333'), ('342', 'A342'),
        ('SW4', NULL::text), ('DC9', 'DC93'), ('75W', 'B752'), ('752', 'B752'), ('74Y', 'B744'), ('753', 'B753'),
        ('748', 'B748'), ('74N', 'B748'), ('339', 'A339'), ('332', 'A332'), ('744', 'B744'), ('747', 'B741'),
        ('319', 'A319'), ('742', 'B742'), ('32Q', 'A21N'), ('743', 'B743'), ('321', 'A321'), ('77X', 'B77L'),
        ('318', 'A318'), ('SW3', NULL::text), ('312', 'A310'), ('320', 'A320'), ('EM2', 'E120'), ('310', 'A310'),
        ('313', 'A310'), ('F20', 'FA20'), ('ANF', 'AN12'), ('76X', 'B762'), ('32A', 'A320'), ('M83', 'MD83'),
        ('7S8', 'B738'), ('76Y', 'B763'), ('M11', 'MD11'), ('32N', 'A20N')
)
SELECT m."AERONAVE", count(*) AS registros,
       count(DISTINCT m."MATRÍCULA") AS matriculas,
       string_agg(DISTINCT m."AEROLINEA", ' | ') AS aerolineas
  FROM public.maestra_manifiestos m
 WHERE nullif(btrim(m."AERONAVE"), '') IS NOT NULL
   AND upper(btrim(m."AERONAVE")) NOT IN (SELECT iata FROM catalogo)
   AND NOT EXISTS (
        SELECT 1 FROM public.catalogo_aeronaves_equivalencias q
         WHERE q.valor_clave = upper(btrim(regexp_replace(m."AERONAVE", '\s+', ' ', 'g'))))
 GROUP BY 1
 ORDER BY 2 DESC;


-- 9) Entradas del catálogo sin respaldo en los manifiestos --------------------
--    Informativo: que no aparezcan NO las hace inválidas.
WITH catalogo(iata, icao, nombre) AS (
    VALUES
        ('E95', 'E195', 'ERJ-195'), ('ER4', 'E145', 'RJ145'), ('E7W', 'E75L', 'ERJ-175W'),
        ('E90', 'E190', 'ERJ-190'), ('E70', 'E170', 'E170'), ('E75', 'E75L', 'ERJ-175'),
        ('73S', 'B737', 'B737-700 Freighter (winglets)'), ('CRJ', NULL::text, 'CRJ'), ('73K', 'B738', 'B737-800 Freighter'),
        ('CRK', 'CRJX', 'CRJ-1000'), ('7M8', 'B38M', 'B737 MAX 8'), ('M80', 'MD81', 'McDonnell Douglas MD-80'),
        ('73C', 'B733', 'B737-300W'), ('CRA', 'CRJ9', 'CRJ-700'), ('73W', 'B737', 'B737-700 (winglets)'),
        ('7M7', 'B37M', '737 MAX 7'), ('73J', 'B739', 'B737-900 (winglets)'), ('73M', 'B732', 'B737-200 Combi'),
        ('73G', 'B737', 'B737-700'), ('CNF', 'C208', 'CESSNA 208B'), ('73H', 'B738', 'B737-800 (winglets)'),
        ('CR7', 'CRJ7', 'CRJ-700'), ('LOH', 'C130', 'C-130'), ('CR9', 'CRJ9', 'CRJ-900'),
        ('CR1', 'CRJ1', 'CRJ-100'), ('CR2', 'CRJ2', 'CRJ-200'), ('7M9', 'B39M', '737 MAX 9'),
        ('AT7', 'AT72', 'ATR-72'), ('76F', 'B763', 'B767 All Freighter'), ('739', 'B739', 'B737-900ER'),
        ('789', 'B789', 'B787-9'), ('7M1', 'B3XM', '737 MAX 10'), ('737', 'B737', 'B737-700'),
        ('781', 'B78X', 'B787-10'), ('738', 'B738', 'B737-800'), ('788', 'B788', 'B787-8'),
        ('735', 'B735', 'B737-500'), ('AB3', 'A306', 'Airbus A300B4-605R'), ('736', 'B736', 'B737-600'),
        ('CES', 'C208', 'CESSNA'), ('733', 'B733', 'B737-300'), ('734', 'B734', 'B737-400'),
        ('731', 'B731', 'B737-100'), ('732', 'B732', 'B737-200'), ('722', 'B722', 'B727-200'),
        ('77F', 'B77L', 'B777-200F'), ('77L', 'B77L', 'B777-200LR'), ('77W', 'B77W', 'B777-300ER'),
        ('773', 'B773', 'B777-300'), ('772', 'B772', 'B777-200ER'), ('764', 'B764', 'B767-400ER'),
        ('76W', 'B763', 'B767-300 (winglets)'), ('727', 'B722', 'B727-200'), ('762', 'B762', 'B767-200'),
        ('721', 'B721', 'B727-100'), ('763', 'B763', 'B767-300ER'), ('359', 'A359', 'A350-900'),
        ('380', 'A388', 'A380-800'), ('75F', 'B752', 'B757-200PF'), ('346', 'A346', 'A340-600'),
        ('351', 'A35K', 'A350-1000'), ('SF3', 'SF34', 'Saab 340'), ('343', 'A343', 'A340-300'),
        ('345', 'A345', 'A340-500'), ('333', 'A333', 'A330-300'), ('342', 'A342', 'A340-200'),
        ('SW4', NULL::text, 'Swearingen Metroliner'), ('DC9', 'DC93', 'McDonnell-Douglas DC-9-33F'), ('75W', 'B752', 'B757-200 (winglets)'),
        ('752', 'B752', 'B757-200'), ('74Y', 'B744', 'B747-400F'), ('753', 'B753', 'B757-300'),
        ('748', 'B748', 'B747-8I'), ('74N', 'B748', 'B747-8F'), ('339', 'A339', 'Airbus A330-900'),
        ('332', 'A332', 'A330-200'), ('744', 'B744', 'B747-400'), ('747', 'B741', 'B747-100'),
        ('319', 'A319', 'A319'), ('742', 'B742', 'B747-200'), ('32Q', 'A21N', 'A321neo'),
        ('743', 'B743', 'B747-300'), ('321', 'A321', 'A321-100/200'), ('77X', 'B77L', 'B777-200F'),
        ('318', 'A318', 'A318'), ('SW3', NULL::text, 'Swearingen Aircraft'), ('312', 'A310', 'A310-200'),
        ('320', 'A320', 'A320-100/200'), ('EM2', 'E120', 'Embraer EMB 120 Brasilia'), ('310', 'A310', 'A310'),
        ('313', 'A310', 'A310-300'), ('F20', 'FA20', 'Falcon 20'), ('ANF', 'AN12', 'Antonov An-12'),
        ('76X', 'B762', 'B767-200 Freighter'), ('32A', 'A320', 'Airbus A320-200 Ceo'), ('M83', 'MD83', 'McDonnell Douglas 83'),
        ('7S8', 'B738', 'Boeing 737-800 (Scimitar wl)'), ('76Y', 'B763', 'B767-300F'), ('M11', 'MD11', 'McDonnell Douglas MD-11'),
        ('32N', 'A20N', 'A320neo')
),
usados AS (
    -- Sin NULL: un NULL dentro de NOT IN dejaría la consulta sin filas.
    SELECT DISTINCT upper(btrim("AERONAVE")) AS v FROM public.maestra_manifiestos
     WHERE "AERONAVE" IS NOT NULL
)
SELECT c.iata, c.icao, c.nombre
  FROM catalogo c
 WHERE c.iata NOT IN (SELECT v FROM usados)
   AND coalesce(c.icao, '') NOT IN (SELECT v FROM usados)
 ORDER BY c.nombre;


-- 10) Catálogo de matrículas: modelo mal capturado ----------------------------
--     En la carga inicial (db/seed_matriculas_manifiestos.sql) el modelo trae
--     números de serie (19000557, 208B5799), el MSN entre paréntesis, modelos
--     que no existen (A320-271NX) o el modelo en la columna del fabricante.
--     Esto revisa la tabla viva, que pudo editarse desde la pantalla.
SELECT id, matricula, aerolinea, tipo_de_aeronave, tipo_de_aeronave_2,
       CASE
           WHEN tipo_de_aeronave_2 IS NULL THEN 'modelo vacío'
           WHEN tipo_de_aeronave_2 ~ '^[0-9]{6,}$' THEN 'número de serie en lugar de modelo'
           WHEN tipo_de_aeronave_2 ~ '^208B[0-9]+$' THEN 'número de serie (Cessna 208B) en lugar de modelo'
           WHEN tipo_de_aeronave_2 ~ '\(?[0-9]{4,5}\)?\s*$' AND tipo_de_aeronave_2 ~ '[A-Z]' THEN 'MSN pegado al modelo'
           WHEN upper(tipo_de_aeronave_2) ~ 'A320-2[0-9]{2}NX' THEN 'modelo inexistente (NX sólo existe en A321)'
           WHEN tipo_de_aeronave IS NOT DISTINCT FROM tipo_de_aeronave_2 THEN 'modelo en la columna del fabricante'
       END AS problema
  FROM public.matriculas_manifiestos
 WHERE tipo_de_aeronave_2 IS NULL
    OR tipo_de_aeronave_2 ~ '^[0-9]{6,}$'
    OR tipo_de_aeronave_2 ~ '^208B[0-9]+$'
    OR (tipo_de_aeronave_2 ~ '\(?[0-9]{4,5}\)?\s*$' AND tipo_de_aeronave_2 ~ '[A-Z]')
    OR upper(tipo_de_aeronave_2) ~ 'A320-2[0-9]{2}NX'
    OR tipo_de_aeronave IS NOT DISTINCT FROM tipo_de_aeronave_2
 ORDER BY problema, matricula;


-- 11) Clasificación por tipo_reporte ------------------------------------------
SELECT coalesce(tipo_reporte, '<NULL>') AS tipo_reporte,
       count(*) AS registros,
       count(*) FILTER (WHERE nullif(btrim("AERONAVE"), '') IS NULL) AS sin_aeronave,
       count(DISTINCT "AERONAVE") AS valores_distintos
  FROM public.maestra_manifiestos
 GROUP BY 1
 ORDER BY 2 DESC;
