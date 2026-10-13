-- =============================================================================
-- AEROLITORAL y AEROVÍAS son Aeroméxico en TODOS los meses (09/10/2026)
--
-- La carga de septiembre (00-preparacion.sql) separó Aerolitoral como 5D y
-- desde entonces se guardó así. Aquí todo vuelve a Aeroméxico:
--
--   1. Catálogo: "aerolitoral" y "aerovías" son alias de AM; la 5D queda
--      sin alias (sólo como histórico).
--   2. "Conciliación Manifiestos": AEROLINEA 5D / AEROLITORAL / AEROVÍAS → AM,
--      "# DE VUELO" "5D 123" → "AM 123", y la aerolínea reportada del libro
--      (cierre_aerolinea_reportada) AEROLITORAL / AEROVÍAS → AEROMÉXICO.
--   3. Lo mismo dentro de las copias congeladas de los cierres (snapshots) y
--      de los ajustes, porque los reportes de los días cerrados se leen de
--      ahí. Sólo cambia la aerolínea y el número de vuelo; ningún número de
--      pasajeros ni de operaciones se mueve.
--
-- Antes de cambiar nada revisa que ningún vuelo choque con otro de Aeroméxico
-- ya existente (mismo vuelo, fecha, sentido, destino y hora de slot). Si choca,
-- se detiene, dice cuáles y no guarda nada.
-- Correr DESPUÉS de la recarga de septiembre (carga-septiembre/recarga-3ed-*):
-- antes de ella septiembre trae cada vuelo de Aerolitoral dos veces (uno como
-- AM y otro como 5D) y aquí chocarían.
-- Respaldo de cada fila cambiada: respaldo_unificacion_aeromexico.
-- Se puede volver a correr (la segunda vez no encuentra nada que cambiar).
-- Desactiva el traductor del navegador.
-- =============================================================================
BEGIN;

SELECT public._conci_lock_contabilidad();
SELECT public._conci_permitir_escritura_cerrada();

-- 1) Catálogo.
UPDATE public.airlines
   SET aliases = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(coalesce(aliases, '{}'::text[])
                    || ARRAY['aerolitoral', 'aerovias', 'aerovías', 'aerovias de mexico', 'aerovías de méxico']) x)
 WHERE upper(btrim(coalesce(iata, ''))) = 'AM';
UPDATE public.airlines
   SET aliases = '{}'::text[], name = 'Aerolitoral (histórico, usar Aeroméxico)'
 WHERE upper(btrim(coalesce(iata, ''))) = '5D';

-- Reglas de cambio, iguales para filas vivas, snapshots y ajustes.
CREATE OR REPLACE FUNCTION pg_temp.es_de_aeromexico(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $f$
    SELECT upper(btrim(coalesce(p, ''))) IN ('5D', 'AEROLITORAL', 'AEROVÍAS', 'AEROVIAS')
$f$;
CREATE OR REPLACE FUNCTION pg_temp.aerolinea_nueva(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
    SELECT CASE WHEN pg_temp.es_de_aeromexico(p) THEN 'AM' ELSE p END
$f$;
CREATE OR REPLACE FUNCTION pg_temp.vuelo_nuevo(p_aerolinea text, p_vuelo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
    SELECT CASE WHEN pg_temp.es_de_aeromexico(p_aerolinea) AND p_vuelo ~* '^\s*5D[\s-]*[0-9]'
                THEN regexp_replace(p_vuelo, '^\s*5D[\s-]*', 'AM ', 'i')
                ELSE p_vuelo END
$f$;
CREATE OR REPLACE FUNCTION pg_temp.reportada_nueva(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
    SELECT CASE WHEN upper(btrim(coalesce(p, ''))) IN ('AEROLITORAL', 'AEROVÍAS', 'AEROVIAS', 'AEROMEXICO')
                THEN 'AEROMÉXICO' ELSE p END
$f$;
-- Un registro (fila viva, snapshot o ajuste) en jsonb con los tres campos cambiados.
CREATE OR REPLACE FUNCTION pg_temp.json_nuevo(d jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $f$
    SELECT d || jsonb_build_object(
                  'AEROLINEA', pg_temp.aerolinea_nueva(d->>'AEROLINEA'),
                  'cierre_aerolinea_reportada', pg_temp.reportada_nueva(d->>'cierre_aerolinea_reportada'))
             || CASE WHEN d ? '# DE VUELO'
                     THEN jsonb_build_object('# DE VUELO', pg_temp.vuelo_nuevo(d->>'AEROLINEA', d->>'# DE VUELO'))
                     ELSE '{}'::jsonb END
$f$;
CREATE OR REPLACE FUNCTION pg_temp.hay_cambio(d jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $f$
    SELECT d IS NOT NULL AND (pg_temp.es_de_aeromexico(d->>'AEROLINEA')
        OR pg_temp.reportada_nueva(d->>'cierre_aerolinea_reportada') IS DISTINCT FROM (d->>'cierre_aerolinea_reportada'))
$f$;

-- 2) Filas vivas que cambian.
CREATE TEMP TABLE _filas ON COMMIT DROP AS
SELECT m.id,
       pg_temp.aerolinea_nueva(m."AEROLINEA")                  AS aerolinea,
       pg_temp.vuelo_nuevo(m."AEROLINEA", m."# DE VUELO")      AS vuelo,
       pg_temp.reportada_nueva(m.cierre_aerolinea_reportada)   AS reportada
  FROM public."Conciliación Manifiestos" m
 WHERE pg_temp.hay_cambio(to_jsonb(m));

-- ¿Alguna chocaría con la regla de duplicados (llave del movimiento + hora de slot)?
DO $$
DECLARE v_choques text;
BEGIN
    WITH nuevas AS (
        SELECT f.id,
               public._aifa_movement_key(f.aerolinea, f.vuelo,
                   coalesce(public._aifa_parse_manifest_date(m."FECHA"), m._portal_flight_date),
                   public._aifa_manifest_direction(m."TIPO DE MANIFIESTO"), m."DESTINO / ORIGEN") AS llave,
               public._aifa_movement_slot(m."SLOT ASIGNADO") AS slot
          FROM _filas f
          JOIN public."Conciliación Manifiestos" m ON m.id = f.id
    ), todas AS (
        SELECT id, llave, slot, true AS cambia FROM nuevas
        UNION ALL
        SELECT m.id, m.movement_key, public._aifa_movement_slot(m."SLOT ASIGNADO"), false
          FROM public."Conciliación Manifiestos" m
         WHERE m.movement_key IS NOT NULL
           AND m.id NOT IN (SELECT id FROM _filas)
    )
    SELECT string_agg(format('%s (ids %s)', llave || ' ' || slot, ids), '; ')
      INTO v_choques
      FROM (SELECT llave, slot, string_agg(id::text, ', ' ORDER BY id) AS ids
              FROM todas
             WHERE llave IS NOT NULL
             GROUP BY llave, slot
            HAVING count(*) > 1 AND bool_or(cambia)) x;
    IF v_choques IS NOT NULL THEN
        RAISE EXCEPTION 'Estos vuelos chocarían con otro de Aeroméxico: %. No se guardó nada. '
                        'Si son de septiembre 2026, son los duplicados de ese mes: corre primero la recarga '
                        '(carga-septiembre/recarga-3ed-*.sql) y después este script.', v_choques;
    END IF;
END $$;

-- 3) Snapshots y ajustes que cambian.
CREATE TEMP TABLE _snaps ON COMMIT DROP AS
SELECT s.id FROM public.conciliacion_cierres_snapshot s WHERE pg_temp.hay_cambio(s.datos_snapshot);
CREATE TEMP TABLE _ajustes ON COMMIT DROP AS
SELECT a.id FROM public.conciliacion_ajustes a
 WHERE pg_temp.hay_cambio(a.datos_antes) OR pg_temp.hay_cambio(a.datos_despues);

-- Respaldo de lo que se va a cambiar (una corrida anterior se conserva).
CREATE TABLE IF NOT EXISTS public.respaldo_unificacion_aeromexico (
    tabla       text   NOT NULL,
    id          bigint NOT NULL,
    antes       jsonb  NOT NULL,
    cambiado_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tabla, id)
);
ALTER TABLE public.respaldo_unificacion_aeromexico ENABLE ROW LEVEL SECURITY;
INSERT INTO public.respaldo_unificacion_aeromexico (tabla, id, antes)
SELECT 'Conciliación Manifiestos', m.id, to_jsonb(m)
  FROM public."Conciliación Manifiestos" m WHERE m.id IN (SELECT id FROM _filas)
UNION ALL
SELECT 'conciliacion_cierres_snapshot', s.id, to_jsonb(s)
  FROM public.conciliacion_cierres_snapshot s WHERE s.id IN (SELECT id FROM _snaps)
UNION ALL
SELECT 'conciliacion_ajustes', a.id, to_jsonb(a)
  FROM public.conciliacion_ajustes a WHERE a.id IN (SELECT id FROM _ajustes)
ON CONFLICT (tabla, id) DO NOTHING;

-- Cambios.
UPDATE public."Conciliación Manifiestos" m
   SET "AEROLINEA" = f.aerolinea,
       "# DE VUELO" = f.vuelo,
       cierre_aerolinea_reportada = f.reportada
  FROM _filas f
 WHERE m.id = f.id;

UPDATE public.conciliacion_cierres_snapshot
   SET datos_snapshot = pg_temp.json_nuevo(datos_snapshot)
 WHERE id IN (SELECT id FROM _snaps);

UPDATE public.conciliacion_ajustes
   SET datos_antes   = CASE WHEN pg_temp.hay_cambio(datos_antes)   THEN pg_temp.json_nuevo(datos_antes)   ELSE datos_antes END,
       datos_despues = CASE WHEN pg_temp.hay_cambio(datos_despues) THEN pg_temp.json_nuevo(datos_despues) ELSE datos_despues END
 WHERE id IN (SELECT id FROM _ajustes);

SELECT public._conci_fin_escritura_cerrada();

-- Verificación: ya no queda nada como Aerolitoral / Aerovías / 5D.
DO $$
DECLARE v_n int;
BEGIN
    SELECT (SELECT count(*) FROM public."Conciliación Manifiestos" m WHERE pg_temp.hay_cambio(to_jsonb(m)))
         + (SELECT count(*) FROM public.conciliacion_cierres_snapshot s WHERE pg_temp.hay_cambio(s.datos_snapshot))
         + (SELECT count(*) FROM public.conciliacion_ajustes a
             WHERE pg_temp.hay_cambio(a.datos_antes) OR pg_temp.hay_cambio(a.datos_despues))
      INTO v_n;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'Quedaron % registros como Aerolitoral / Aerovías / 5D. No se guardó nada.', v_n;
    END IF;
END $$;

-- Resultado: lo que cambió, por mes de FECHA.
SELECT to_char(coalesce(public._aifa_parse_manifest_date(m."FECHA"), m._portal_flight_date), 'YYYY-MM') AS mes,
       count(*)                                                      AS manifiestos_ahora_aeromexico,
       count(*) FILTER (WHERE r.antes->>'AEROLINEA' ILIKE '5D')      AS antes_5d,
       count(*) FILTER (WHERE upper(r.antes->>'cierre_aerolinea_reportada') = 'AEROLITORAL') AS antes_aerolitoral,
       count(*) FILTER (WHERE upper(r.antes->>'cierre_aerolinea_reportada') IN ('AEROVÍAS', 'AEROVIAS')) AS antes_aerovias,
       (SELECT count(*) FROM _snaps)   AS snapshots_cambiados,
       (SELECT count(*) FROM _ajustes) AS ajustes_cambiados
  FROM _filas f
  JOIN public."Conciliación Manifiestos" m ON m.id = f.id
  JOIN public.respaldo_unificacion_aeromexico r ON r.tabla = 'Conciliación Manifiestos' AND r.id = f.id
 GROUP BY 1
 ORDER BY 1;

COMMIT;

-- -----------------------------------------------------------------------------
-- DESPUÉS del COMMIT (aparte): recalcula los resúmenes de los meses que
-- cambiaron (el pg_cron sólo rehace los últimos 60 días). Uno por mes, p. ej.:
--   SELECT public.manifiestos_hechos_rehacer_mes(2026, 8);
--   SELECT public.manifiestos_hechos_rehacer_mes(2026, 10);
--   SELECT public.refrescar_informe_estadistico(true);
-- -----------------------------------------------------------------------------
