-- =============================================================================
-- weekly_total debe ser la suma de los siete días, no un COUNT(*) aparte
--
-- Al generar las frecuencias semanales, cada día se cuenta convirtiendo la
-- fecha a hora de México:
--
--     COUNT(*) FILTER (WHERE EXTRACT(DOW FROM det.flight_date
--                                    AT TIME ZONE 'America/Mexico_City') = 1)
--
-- pero el total se calculaba aparte, sin esa conversión ni ese filtro:
--
--     COUNT(*) as weekly_total
--
-- Una fila cuya flight_date sea NULL o no convierta a un día válido no entra en
-- ninguno de los siete conteos, pero sí en el COUNT(*). Resultado: el total
-- queda por encima de lo que se ve en la tabla — decía 4 frecuencias donde solo
-- se veían dos.
--
-- La corrección tiene dos partes: que lo ya guardado cuadre, y que lo que se
-- genere de aquí en adelante no vuelva a descuadrar.
-- =============================================================================

BEGIN;

-- ── 1. Ver el tamaño del problema antes de tocar nada ────────────────────────
-- (Ejecutar aparte si se quiere revisar primero.)
--
-- SELECT week_label, iata, airline, weekly_total,
--        (monday + tuesday + wednesday + thursday + friday + saturday + sunday)
--            AS suma_dias
-- FROM weekly_frequencies
-- WHERE weekly_total IS DISTINCT FROM
--       (monday + tuesday + wednesday + thursday + friday + saturday + sunday)
-- ORDER BY week_label DESC, iata;

-- ── 2. Cuadrar lo ya guardado ────────────────────────────────────────────────
UPDATE weekly_frequencies
SET weekly_total = COALESCE(monday, 0) + COALESCE(tuesday, 0) + COALESCE(wednesday, 0)
                 + COALESCE(thursday, 0) + COALESCE(friday, 0) + COALESCE(saturday, 0)
                 + COALESCE(sunday, 0)
WHERE weekly_total IS DISTINCT FROM
      (COALESCE(monday, 0) + COALESCE(tuesday, 0) + COALESCE(wednesday, 0)
     + COALESCE(thursday, 0) + COALESCE(friday, 0) + COALESCE(saturday, 0)
     + COALESCE(sunday, 0));

-- Las tablas hermanas comparten el mismo defecto, si existen.
DO $$
BEGIN
    IF to_regclass('public.weekly_frequencies_int') IS NOT NULL THEN
        UPDATE weekly_frequencies_int
        SET weekly_total = COALESCE(monday, 0) + COALESCE(tuesday, 0) + COALESCE(wednesday, 0)
                         + COALESCE(thursday, 0) + COALESCE(friday, 0) + COALESCE(saturday, 0)
                         + COALESCE(sunday, 0)
        WHERE weekly_total IS DISTINCT FROM
              (COALESCE(monday, 0) + COALESCE(tuesday, 0) + COALESCE(wednesday, 0)
             + COALESCE(thursday, 0) + COALESCE(friday, 0) + COALESCE(saturday, 0)
             + COALESCE(sunday, 0));
    END IF;

    IF to_regclass('public.weekly_frequencies_cargo') IS NOT NULL THEN
        UPDATE weekly_frequencies_cargo
        SET weekly_total = COALESCE(monday, 0) + COALESCE(tuesday, 0) + COALESCE(wednesday, 0)
                         + COALESCE(thursday, 0) + COALESCE(friday, 0) + COALESCE(saturday, 0)
                         + COALESCE(sunday, 0)
        WHERE weekly_total IS DISTINCT FROM
              (COALESCE(monday, 0) + COALESCE(tuesday, 0) + COALESCE(wednesday, 0)
             + COALESCE(thursday, 0) + COALESCE(friday, 0) + COALESCE(saturday, 0)
             + COALESCE(sunday, 0));
    END IF;
END;
$$;

-- ── 3. Que no vuelva a descuadrar ────────────────────────────────────────────
-- El total se recalcula desde los siete días en cada alta o cambio, sin
-- importar cómo lo haya calculado quien inserta.
CREATE OR REPLACE FUNCTION public._freq_weekly_total_desde_dias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.weekly_total := COALESCE(NEW.monday, 0) + COALESCE(NEW.tuesday, 0)
                      + COALESCE(NEW.wednesday, 0) + COALESCE(NEW.thursday, 0)
                      + COALESCE(NEW.friday, 0) + COALESCE(NEW.saturday, 0)
                      + COALESCE(NEW.sunday, 0);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freq_weekly_total ON public.weekly_frequencies;
CREATE TRIGGER trg_freq_weekly_total
    BEFORE INSERT OR UPDATE ON public.weekly_frequencies
    FOR EACH ROW EXECUTE FUNCTION public._freq_weekly_total_desde_dias();

DO $$
BEGIN
    IF to_regclass('public.weekly_frequencies_int') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_freq_weekly_total_int ON public.weekly_frequencies_int;
        CREATE TRIGGER trg_freq_weekly_total_int
            BEFORE INSERT OR UPDATE ON public.weekly_frequencies_int
            FOR EACH ROW EXECUTE FUNCTION public._freq_weekly_total_desde_dias();
    END IF;

    IF to_regclass('public.weekly_frequencies_cargo') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_freq_weekly_total_cargo ON public.weekly_frequencies_cargo;
        CREATE TRIGGER trg_freq_weekly_total_cargo
            BEFORE INSERT OR UPDATE ON public.weekly_frequencies_cargo
            FOR EACH ROW EXECUTE FUNCTION public._freq_weekly_total_desde_dias();
    END IF;
END;
$$;

COMMIT;

-- ── Verificación posterior ───────────────────────────────────────────────────
-- No debe devolver ninguna fila:
--
-- SELECT week_label, iata, airline, weekly_total
-- FROM weekly_frequencies
-- WHERE weekly_total IS DISTINCT FROM
--       (COALESCE(monday,0) + COALESCE(tuesday,0) + COALESCE(wednesday,0)
--      + COALESCE(thursday,0) + COALESCE(friday,0) + COALESCE(saturday,0)
--      + COALESCE(sunday,0));
--
-- Y conviene revisar de dónde salían esas filas de más:
--
-- SELECT COUNT(*) FROM weekly_flights_detailed WHERE flight_date IS NULL;
