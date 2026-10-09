-- =====================================================================
-- 063c · REVERSA (selecciona todo y Run). Quita la capa ajustada.
-- No toca manifiestos_hechos, AG, cifras_oficiales_mensuales ni el
-- Informe oficial. cifras_oficiales (063b) se conserva; para quitarla
-- también, descomenta la última línea.
-- =====================================================================
DO $r$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'estadistica_ajustada_refresco') THEN
        PERFORM cron.unschedule('estadistica_ajustada_refresco');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mig_063c_ajustada') THEN
        PERFORM cron.unschedule('mig_063c_ajustada');
    END IF;
END;
$r$;

BEGIN;
DROP FUNCTION IF EXISTS public.estadistica_ajustada_refrescar();
DROP FUNCTION IF EXISTS public.estadistica_ajustada_rehacer(date, date);
DROP FUNCTION IF EXISTS public._ea_firma_historia();
DROP TABLE IF EXISTS public.estadistica_ajustada;
DROP TABLE IF EXISTS public.estadistica_ajustada_mes;
DROP TABLE IF EXISTS public.estadistica_ajustada_control;
-- DROP TABLE IF EXISTS public.cifras_oficiales;
COMMIT;

SELECT jobname FROM cron.job WHERE jobname LIKE '%ajustada%';  -- debe salir vacío
