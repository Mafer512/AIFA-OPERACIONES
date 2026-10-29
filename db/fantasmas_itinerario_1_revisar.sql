-- =============================================================================
-- Vuelos fantasma del itinerario · PASO 1: REVISAR (solo lectura)
--
-- Un vuelo programado (p. ej. CZ 2521 el 10/10 a las 17:05) que se retrasó y
-- operó pasada la medianoche llega en la siguiente importación con OTRA fecha
-- programada (11/10 02:05). La importación no lo reconoce como el mismo, lo
-- da de alta aparte con su matrícula y el registro viejo se queda: sin
-- matrícula y sin manifiesto, saliendo en Conciliación como "Sin capturar".
--
-- Un sentido (llegada o salida) de un renglón del itinerario es FANTASMA si:
--   · no está cancelado ni "not operating";
--   · no tiene matrícula y no operó (sin ALDT/AIBT o sin AOBT/ATOT);
--   · su hora programada ya pasó (hace más de 3 horas);
--   · y además, una de dos:
--       reprogramado: el MISMO vuelo (aerolínea, número y sentido) sí operó o
--         trae matrícula en otro renglón programado hasta 24 horas después;
--       su otra mitad está cancelada: el mismo vuelo, el mismo día, tiene la
--         otra mitad Cancelled / Not operating (el AODB canceló el vuelo y
--         dejó de mandar esta mitad: p. ej. VB 7314 del 10/10).
--
-- accion:
--   ELIMINAR   todos los sentidos del renglón son fantasma y NADIE lo tocó.
--   CONSERVAR  alguien lo tocó (motivo): un manifiesto capturado de ese vuelo
--              en esa fecha (por FECHA o por SLOT ASIGNADO; dice quién lo
--              capturó), validado en el Itinerario, con observaciones o con un
--              ajuste de aerolínea en Conciliación; o sólo una mitad del
--              renglón es fantasma.
-- El PASO 2 (fantasmas_itinerario_2_eliminar.sql) elimina sólo los ELIMINAR.
-- =============================================================================
CREATE OR REPLACE FUNCTION pg_temp.fecha_txt(p text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE m text[]; a int;
BEGIN
    m := regexp_match(btrim(coalesce(p, '')), '^([0-9]{4})-([0-9]{2})-([0-9]{2})');
    IF m IS NOT NULL THEN RETURN make_date(m[1]::int, m[2]::int, m[3]::int); END IF;
    m := regexp_match(btrim(coalesce(p, '')), '^([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{2,4})');
    IF m IS NOT NULL THEN
        a := m[3]::int; IF a < 100 THEN a := 2000 + a; END IF;
        RETURN make_date(a, m[2]::int, m[1]::int);
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $f$;

WITH sentidos AS (
    SELECT v.id, 'A'::text AS dir, v."Status" AS status, v."[Arr] Flight Designator" AS vuelo,
           split_part(v.arr_movement_key, '|', 1) AS aerolinea, split_part(v.arr_movement_key, '|', 2) AS numero,
           v.arr_scheduled_date AS fecha, substring(v."[Arr] SIBT" FROM '([0-9]{1,2}:[0-9]{2})') AS hora,
           nullif(btrim(v."Registration"), '') AS matricula,
           (nullif(btrim(v."[Arr] ALDT"), '') IS NOT NULL OR nullif(btrim(v."[Arr] AIBT"), '') IS NOT NULL) AS opero,
           v."Aircraft type" AS aeronave, v."Routing" AS ruta
      FROM public.manifiestos_vuelos_editable v
     WHERE v.arr_movement_key IS NOT NULL AND v.arr_scheduled_date IS NOT NULL
    UNION ALL
    SELECT v.id, 'D', v."Status", v."[Dep] Flight Designator",
           split_part(v.dep_movement_key, '|', 1), split_part(v.dep_movement_key, '|', 2),
           v.dep_scheduled_date, substring(v."[Dep] SOBT" FROM '([0-9]{1,2}:[0-9]{2})'),
           nullif(btrim(v."Registration"), ''),
           (nullif(btrim(v."[Dep] AOBT"), '') IS NOT NULL OR nullif(btrim(v."[Dep] ATOT"), '') IS NOT NULL),
           v."Aircraft type", v."Routing"
      FROM public.manifiestos_vuelos_editable v
     WHERE v.dep_movement_key IS NOT NULL AND v.dep_scheduled_date IS NOT NULL
), s AS (
    SELECT *, fecha + coalesce(hora, '00:00')::time AS programado,
           status ~* '(cancel|not.?oper|no.?opera|cnx|nop\M)' AS excluido
      FROM sentidos
), fantasmas AS (
    SELECT g.*,
           CASE WHEN r.id IS NOT NULL THEN 'reprogramado: operó después' ELSE 'su otra mitad está cancelada' END AS tipo,
           coalesce(r.id, c.id) AS real_id, coalesce(r.programado, c.programado) AS real_programado,
           r.matricula AS real_matricula, coalesce(r.status, c.status) AS real_status,
           (SELECT string_agg(DISTINCT coalesce(nullif(btrim(m."CAPTURÓ"), ''), 'sin nombre'), ', ')
              FROM public."Conciliación Manifiestos" m
             WHERE split_part(m.movement_key, '|', 1) = g.aerolinea
               AND split_part(m.movement_key, '|', 2) = g.numero
               AND split_part(m.movement_key, '|', 4) = g.dir
               AND (split_part(m.movement_key, '|', 3) = g.fecha::text
                    OR pg_temp.fecha_txt(m."SLOT ASIGNADO") = g.fecha)) AS capturado_por
      FROM s g
     LEFT JOIN LATERAL (
           SELECT r.* FROM s r
            WHERE r.id <> g.id AND r.dir = g.dir AND r.aerolinea = g.aerolinea AND r.numero = g.numero
              AND NOT r.excluido
              AND r.programado > g.programado AND r.programado <= g.programado + interval '24 hours'
              AND (r.opero OR r.matricula IS NOT NULL)
            ORDER BY r.programado
            LIMIT 1
     ) r ON true
     -- La otra mitad del mismo vuelo, el mismo día, cancelada o no operada:
     -- el AODB canceló el vuelo y dejó de mandar esta mitad.
     LEFT JOIN LATERAL (
           SELECT x.* FROM s x
            WHERE x.id <> g.id AND x.aerolinea = g.aerolinea AND x.numero = g.numero
              AND x.fecha = g.fecha AND x.excluido
            ORDER BY x.id
            LIMIT 1
     ) c ON true
     WHERE NOT g.excluido AND g.matricula IS NULL AND NOT g.opero
       AND g.programado < (now() AT TIME ZONE 'America/Mexico_City') - interval '3 hours'
       AND (r.id IS NOT NULL OR c.id IS NOT NULL)
), por_renglon AS (
    SELECT s.id,
           count(*) FILTER (WHERE NOT s.excluido) AS sentidos,
           count(f.id) AS sentidos_fantasma
      FROM s LEFT JOIN fantasmas f ON f.id = s.id AND f.dir = s.dir
     GROUP BY s.id
), tocado AS (
    -- ¿Alguien tocó el renglón? Itinerario validado u observado, o ajuste de
    -- aerolínea en Conciliación.
    SELECT p.id,
           concat_ws('; ',
               CASE WHEN coalesce(m.validado, false) OR nullif(btrim(m.validado_por), '') IS NOT NULL
                      OR coalesce(i.validado, false) OR nullif(btrim(i.validado_por), '') IS NOT NULL
                    THEN 'validado por ' || coalesce(nullif(btrim(i.validado_por), ''), nullif(btrim(m.validado_por), ''), 'alguien') END,
               CASE WHEN nullif(btrim(i.observaciones), '') IS NOT NULL THEN 'con observaciones en el Itinerario' END,
               CASE WHEN EXISTS (SELECT 1 FROM public.conciliacion_vuelo_overrides o WHERE o.vuelo_id = p.id)
                    THEN 'ajuste de aerolínea en Conciliación' END) AS motivo
      FROM por_renglon p
      JOIN public.manifiestos_vuelos_editable m ON m.id = p.id
      LEFT JOIN public.itinerario_vuelos_editable i ON i.id = p.id
     WHERE p.sentidos_fantasma > 0
), decision AS (
    SELECT f.*,
           nullif(concat_ws('; ',
               CASE WHEN f.capturado_por IS NOT NULL THEN 'manifiesto capturado por ' || f.capturado_por END,
               nullif(t.motivo, ''),
               CASE WHEN p.sentidos_fantasma < p.sentidos THEN 'sólo una mitad del renglón es fantasma' END), '') AS conservar_por
      FROM fantasmas f
      JOIN por_renglon p ON p.id = f.id
      JOIN tocado t ON t.id = f.id
), por_id AS (
    -- La acción es por renglón: si un sentido se conserva, se conserva todo.
    SELECT d.id, string_agg(DISTINCT d.conservar_por, '; ') AS conservar_por
      FROM decision d
     GROUP BY d.id
)
SELECT CASE WHEN pi.conservar_por IS NULL THEN 'ELIMINAR' ELSE 'CONSERVAR' END AS accion,
       pi.conservar_por AS motivo,
       d.tipo,
       d.id, d.status,
       CASE d.dir WHEN 'A' THEN 'LLEGADA' ELSE 'SALIDA' END AS sentido,
       d.vuelo, to_char(d.programado, 'DD/MM/YYYY HH24:MI') AS programado_fantasma,
       d.aeronave, d.ruta,
       d.real_id AS id_relacionado, to_char(d.real_programado, 'DD/MM/YYYY HH24:MI') AS programado_relacionado,
       d.real_matricula AS matricula_real, d.real_status AS status_relacionado
  FROM decision d
  JOIN por_id pi ON pi.id = d.id
 ORDER BY accion DESC, d.programado DESC, d.vuelo, d.dir;
