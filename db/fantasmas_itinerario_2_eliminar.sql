-- =============================================================================
-- Vuelos fantasma del itinerario · PASO 2: ELIMINAR
-- Corre ANTES fantasmas_itinerario_1_revisar.sql y revisa la lista.
--
-- Con la misma regla del PASO 1, elimina SÓLO los renglones con
-- accion = ELIMINAR (reprogramados o con su otra mitad cancelada): todos sus
-- sentidos son fantasma y nadie los tocó (sin
-- manifiesto capturado, sin validar, sin observaciones y sin ajuste de
-- aerolínea). Los CONSERVAR no se tocan.
--
-- Se eliminan de las tres tablas del itinerario (la cruda
-- vuelos_parte_operaciones_csv, itinerario_vuelos_editable y
-- manifiestos_vuelos_editable) para que no vuelvan a aparecer. Antes, cada
-- renglón completo queda en respaldo_itinerario_fantasmas_eliminados (tabla,
-- id, fila): con eso se puede regresar cualquiera.
-- Si al terminar no cuadra lo eliminado, se cancela todo y no se guarda nada.
-- =============================================================================
BEGIN;

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

CREATE TEMP TABLE _eliminar ON COMMIT DROP AS
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
SELECT d.id,
       string_agg(DISTINCT d.vuelo, ' / ') AS vuelos,
       min(d.programado) AS programado,
       min(d.real_id) AS id_del_que_opero
  FROM decision d
  JOIN por_id pi ON pi.id = d.id
 WHERE pi.conservar_por IS NULL
 GROUP BY d.id;

CREATE TABLE IF NOT EXISTS public.respaldo_itinerario_fantasmas_eliminados (
    tabla        text        NOT NULL,
    id           bigint      NOT NULL,
    fila         jsonb       NOT NULL,
    eliminado_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tabla, id)
);
ALTER TABLE public.respaldo_itinerario_fantasmas_eliminados ENABLE ROW LEVEL SECURITY;

INSERT INTO public.respaldo_itinerario_fantasmas_eliminados (tabla, id, fila)
SELECT 'manifiestos_vuelos_editable', t.id, to_jsonb(t) FROM public.manifiestos_vuelos_editable t WHERE t.id IN (SELECT id FROM _eliminar)
UNION ALL
SELECT 'itinerario_vuelos_editable', t.id, to_jsonb(t) FROM public.itinerario_vuelos_editable t WHERE t.id IN (SELECT id FROM _eliminar)
UNION ALL
SELECT 'vuelos_parte_operaciones_csv', t.id, to_jsonb(t) FROM public.vuelos_parte_operaciones_csv t WHERE t.id IN (SELECT id FROM _eliminar)
ON CONFLICT (tabla, id) DO NOTHING;

DELETE FROM public.manifiestos_vuelos_editable WHERE id IN (SELECT id FROM _eliminar);
DELETE FROM public.itinerario_vuelos_editable WHERE id IN (SELECT id FROM _eliminar);
DELETE FROM public.vuelos_parte_operaciones_csv WHERE id IN (SELECT id FROM _eliminar);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.manifiestos_vuelos_editable WHERE id IN (SELECT id FROM _eliminar))
       OR EXISTS (SELECT 1 FROM public.itinerario_vuelos_editable WHERE id IN (SELECT id FROM _eliminar))
       OR EXISTS (SELECT 1 FROM public.vuelos_parte_operaciones_csv WHERE id IN (SELECT id FROM _eliminar)) THEN
        RAISE EXCEPTION 'Quedaron vuelos fantasma sin eliminar. No se guardó nada.';
    END IF;
    IF (SELECT count(*) FROM public.respaldo_itinerario_fantasmas_eliminados r
         WHERE r.tabla = 'manifiestos_vuelos_editable' AND r.id IN (SELECT id FROM _eliminar))
       <> (SELECT count(*) FROM _eliminar) THEN
        RAISE EXCEPTION 'No todos los vuelos quedaron respaldados. No se guardó nada.';
    END IF;
END $$;

-- Resultado: lo eliminado.
SELECT count(*) AS vuelos_fantasma_eliminados,
       string_agg(vuelos || ' ' || to_char(programado, 'DD/MM HH24:MI'), ', ' ORDER BY programado) AS detalle
  FROM _eliminar;

COMMIT;

-- -----------------------------------------------------------------------------
-- Para regresar un vuelo (cambia 12345 por su id), en las tres tablas:
--   INSERT INTO public.manifiestos_vuelos_editable
--   SELECT * FROM jsonb_populate_record(NULL::public.manifiestos_vuelos_editable,
--          (SELECT fila FROM public.respaldo_itinerario_fantasmas_eliminados
--            WHERE tabla = 'manifiestos_vuelos_editable' AND id = 12345));
-- -----------------------------------------------------------------------------
