-- ================================================================
-- agenda_2026 - actualizaci?n controlada desde Agenda 2026.xlsx
-- Generado: 2026-07-24
-- No contiene DROP, DELETE ni TRUNCATE.
-- Mantiene los sufijos del No. Empleado (-2, -3, etc.) como parte del identificador.
-- Omitidas filas VACANTE o sin No. Empleado.
-- ================================================================


-- Revisi?n previa de tabla actual
SELECT COUNT(*) AS total_actual FROM public.agenda_2026;
SELECT "No. Empleado", COUNT(*) AS ocurrencias
FROM public.agenda_2026
WHERE "No. Empleado" IS NOT NULL AND "No. Empleado"::text <> ''
GROUP BY "No. Empleado"
HAVING COUNT(*) > 1;
