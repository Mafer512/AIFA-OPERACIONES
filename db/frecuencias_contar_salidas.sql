-- =============================================================================
-- FRECUENCIAS SEMANALES · Contar frecuencias (salidas), no operaciones
--
-- Síntoma: el módulo no cuadraba con el Excel de frecuencias aunque los dos
-- salen del mismo archivo de Visits. Ejemplo, Acapulco – Mexicana el jueves:
--     Excel: 1      Módulo: 2  (XN1942 salida 16:00 + XN1943 llegada 18:40)
--
-- Causa: el cargador toma de cada visita la llegada y la salida, y la función
-- que arma la tabla contaba las dos. El módulo mostraba OPERACIONES (llegadas
-- más salidas) donde el Excel y el resto del sistema hablan de FRECUENCIAS
-- (una por cada salida). Semana del 16 al 22 de noviembre de 2026:
--     Excel 493 frecuencias · módulo 748 = 372 salidas + 376 llegadas.
-- En las 50 rutas con datos completos, el Excel es exactamente el número de
-- salidas del módulo.
--
-- Corrección: cada día cuenta sólo las salidas «(Sal)». El detalle de la
-- celda sigue mostrando la salida y la llegada, cada una con su hora.
-- Se hace con un disparador que cuenta las salidas en el detalle que guarda la
-- propia fila: así funciona con la versión de generate_weekly_frequencies que
-- esté instalada, sin reescribirla. Las filas capturadas a mano (sin detalle
-- de vuelos) no se tocan, y una edición manual posterior se respeta.
--
-- Aplica a nacionales (weekly_frequencies) e internacionales
-- (weekly_frequencies_int). Carga no se toca.
--
-- Es idempotente. Supabase → SQL Editor → pegar → Run.
-- =============================================================================

-- ── 0. (Opcional) Ver el cambio antes de aplicarlo ───────────────────────────
-- SELECT week_label, sum(weekly_total) AS hoy_operaciones,
--        sum((length(coalesce(monday_detail,'')||coalesce(tuesday_detail,'')||coalesce(wednesday_detail,'')
--             ||coalesce(thursday_detail,'')||coalesce(friday_detail,'')||coalesce(saturday_detail,'')
--             ||coalesce(sunday_detail,''))
--           - length(replace(coalesce(monday_detail,'')||coalesce(tuesday_detail,'')||coalesce(wednesday_detail,'')
--             ||coalesce(thursday_detail,'')||coalesce(friday_detail,'')||coalesce(saturday_detail,'')
--             ||coalesce(sunday_detail,''), '(Sal)', ''))) / 5) AS frecuencias
--   FROM weekly_frequencies GROUP BY week_label ORDER BY min(valid_from) DESC;

BEGIN;

-- ── 1. Cuántas salidas trae el detalle de un día ─────────────────────────────
-- El detalle es «XN1942 (Sal) 16:00<br>XN1943 (Lleg) 18:40».
CREATE OR REPLACE FUNCTION public._freq_salidas(p_detalle text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_detalle IS NULL THEN 0
              ELSE (length(p_detalle) - length(replace(p_detalle, '(Sal)', ''))) / 5 END;
$$;

-- ¿La fila viene del archivo de Visits? (su detalle marca cada vuelo)
CREATE OR REPLACE FUNCTION public._freq_de_visits(VARIADIC p_detalles text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(array_to_string(p_detalles, ' '), '') ~ '\((Sal|Lleg)\)';
$$;

-- ── 2. Al generar una semana, cada día cuenta sus salidas ────────────────────
CREATE OR REPLACE FUNCTION public._freq_contar_salidas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF public._freq_de_visits(NEW.monday_detail, NEW.tuesday_detail, NEW.wednesday_detail, NEW.thursday_detail,
                            NEW.friday_detail, NEW.saturday_detail, NEW.sunday_detail) THEN
    NEW.monday    := public._freq_salidas(NEW.monday_detail);
    NEW.tuesday   := public._freq_salidas(NEW.tuesday_detail);
    NEW.wednesday := public._freq_salidas(NEW.wednesday_detail);
    NEW.thursday  := public._freq_salidas(NEW.thursday_detail);
    NEW.friday    := public._freq_salidas(NEW.friday_detail);
    NEW.saturday  := public._freq_salidas(NEW.saturday_detail);
    NEW.sunday    := public._freq_salidas(NEW.sunday_detail);
    NEW.weekly_total := NEW.monday + NEW.tuesday + NEW.wednesday + NEW.thursday
                      + NEW.friday + NEW.saturday + NEW.sunday;
  END IF;
  RETURN NEW;
END;
$$;

-- Sólo al insertar (así es como se genera cada semana). Corre antes que
-- trg_freq_weekly_total, que vuelve a sumar los siete días.
DROP TRIGGER IF EXISTS trg_freq_contar_salidas ON public.weekly_frequencies;
CREATE TRIGGER trg_freq_contar_salidas
  BEFORE INSERT ON public.weekly_frequencies
  FOR EACH ROW EXECUTE FUNCTION public._freq_contar_salidas();

DROP TRIGGER IF EXISTS trg_freq_contar_salidas_int ON public.weekly_frequencies_int;
CREATE TRIGGER trg_freq_contar_salidas_int
  BEFORE INSERT ON public.weekly_frequencies_int
  FOR EACH ROW EXECUTE FUNCTION public._freq_contar_salidas();

-- ── 3. Corregir las semanas ya cargadas ──────────────────────────────────────
-- Sólo las que vienen del archivo de Visits; las capturadas a mano se quedan.
UPDATE public.weekly_frequencies
   SET monday    = public._freq_salidas(monday_detail),
       tuesday   = public._freq_salidas(tuesday_detail),
       wednesday = public._freq_salidas(wednesday_detail),
       thursday  = public._freq_salidas(thursday_detail),
       friday    = public._freq_salidas(friday_detail),
       saturday  = public._freq_salidas(saturday_detail),
       sunday    = public._freq_salidas(sunday_detail),
       weekly_total = public._freq_salidas(monday_detail) + public._freq_salidas(tuesday_detail)
                    + public._freq_salidas(wednesday_detail) + public._freq_salidas(thursday_detail)
                    + public._freq_salidas(friday_detail) + public._freq_salidas(saturday_detail)
                    + public._freq_salidas(sunday_detail)
 WHERE public._freq_de_visits(monday_detail, tuesday_detail, wednesday_detail, thursday_detail,
                              friday_detail, saturday_detail, sunday_detail);

UPDATE public.weekly_frequencies_int
   SET monday    = public._freq_salidas(monday_detail),
       tuesday   = public._freq_salidas(tuesday_detail),
       wednesday = public._freq_salidas(wednesday_detail),
       thursday  = public._freq_salidas(thursday_detail),
       friday    = public._freq_salidas(friday_detail),
       saturday  = public._freq_salidas(saturday_detail),
       sunday    = public._freq_salidas(sunday_detail),
       weekly_total = public._freq_salidas(monday_detail) + public._freq_salidas(tuesday_detail)
                    + public._freq_salidas(wednesday_detail) + public._freq_salidas(thursday_detail)
                    + public._freq_salidas(friday_detail) + public._freq_salidas(saturday_detail)
                    + public._freq_salidas(sunday_detail)
 WHERE public._freq_de_visits(monday_detail, tuesday_detail, wednesday_detail, thursday_detail,
                              friday_detail, saturday_detail, sunday_detail);

COMMIT;

-- ── Verificación ─────────────────────────────────────────────────────────────
-- Semana del 16 al 22 de noviembre de 2026: nacionales 339 (antes 685) e
-- internacionales 33 (antes 63).
-- SELECT sum(weekly_total) FROM weekly_frequencies     WHERE valid_from = '2026-11-16';
-- SELECT sum(weekly_total) FROM weekly_frequencies_int WHERE valid_from = '2026-11-16';
--
-- Acapulco – Mexicana debe decir 0,0,0,1,1,0,1 (como el Excel):
-- SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday, weekly_total
--   FROM weekly_frequencies WHERE valid_from = '2026-11-16' AND iata = 'ACA' AND airline ILIKE 'Mexicana%';
