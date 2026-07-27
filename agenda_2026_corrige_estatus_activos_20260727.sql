-- =====================================================================
-- Corrección final de Estatus en agenda_2026
-- Fecha: 2026-07-27
-- Fuente de revisión: Agenda 2026.xlsx + validación manual en Supabase
--
-- Objetivo:
--   Corregir únicamente colaboradores que estaban marcados como "Baja"
--   aunque conservaban No. Empleado e información laboral vigente.
--
-- Alcance:
--   - Cambia a "Activo" solo los 30 colaboradores listados.
--   - Conserva como "Baja" las vacantes sin No. Empleado.
--   - No modifica nombres, plazas, niveles, sueldos, puestos ni adscripciones.
--   - No elimina registros.
--   - No modifica otras tablas.
-- =====================================================================

BEGIN;

UPDATE public.agenda_2026
SET "Estatus" = 'Activo'
WHERE "No. Empleado" IN (
  '1040',
  '1348-2',
  '1391-2',
  '1394-2',
  '1395-2',
  '1396-2',
  '1397-2',
  '1407',
  '1418-2',
  '1481',
  '1489-2',
  '1509-2',
  '1518',
  '1568',
  '1574-2',
  '1578',
  '1609',
  '1630',
  '1650',
  '1660',
  '1668',
  '1677',
  '1680',
  '223',
  '248',
  '317-2',
  '483',
  '782-2',
  '813',
  '998'
)
RETURNING
  "No. Empleado",
  "Nombre",
  "Estatus",
  "Plaza",
  "Nivel",
  "Puesto";

-- Validación 1: resumen esperado después de la corrección.
-- Resultado esperado: Activo = 508, Baja = 13.
SELECT "Estatus", COUNT(*) AS total
FROM public.agenda_2026
GROUP BY "Estatus"
ORDER BY "Estatus";

-- Validación 2: las bajas restantes deben ser únicamente vacantes.
SELECT
  "No. Empleado",
  "Nombre",
  "Estatus",
  "Plaza",
  "Nivel",
  "Puesto"
FROM public.agenda_2026
WHERE "Estatus" = 'Baja'
ORDER BY "Plaza";

-- Validación 3: no deben existir valores inválidos en Estatus.
SELECT "Estatus", COUNT(*) AS total
FROM public.agenda_2026
WHERE "Estatus" IS NULL
   OR "Estatus" NOT IN ('Activo', 'Baja')
GROUP BY "Estatus";

-- Validación 4: no deben existir números de empleado duplicados.
SELECT "No. Empleado", COUNT(*) AS total
FROM public.agenda_2026
WHERE "No. Empleado" IS NOT NULL
  AND btrim("No. Empleado"::text) <> ''
GROUP BY "No. Empleado"
HAVING COUNT(*) > 1;

COMMIT;
