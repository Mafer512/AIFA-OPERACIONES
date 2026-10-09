-- =============================================================================
-- 064 · REVERSA — Aviación General · FBO
--
-- Elimina SÓLO los objetos creados por 064a y 064b. NO toca datos:
-- operaciones_fbo y aviacion_general_operaciones quedan exactamente igual.
-- Después de correrla, el módulo FBO del portal avisará que falta la 064a.
--
-- Selecciona todo y Run. Se puede volver a correr.
-- =============================================================================

BEGIN;

-- 064b
DROP FUNCTION IF EXISTS public.fbo_importar_operaciones(jsonb);
DROP FUNCTION IF EXISTS public.fbo_previa_importacion(jsonb);

-- 064a (primero lo que depende de la vista)
DROP FUNCTION IF EXISTS public.fbo_movimientos_por_mes(jsonb);
DROP FUNCTION IF EXISTS public.fbo_resumen(jsonb);
DROP FUNCTION IF EXISTS public.fbo_movimientos_filtrados(jsonb);
DROP FUNCTION IF EXISTS public.fbo_opciones();
DROP FUNCTION IF EXISTS public.fbo_patron(text);
DROP VIEW IF EXISTS public.v_fbo_movimientos;

COMMIT;

SELECT count(*) AS objetos_064_restantes
  FROM (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('fbo_patron', 'fbo_movimientos_filtrados', 'fbo_resumen',
                             'fbo_movimientos_por_mes', 'fbo_opciones',
                             'fbo_previa_importacion', 'fbo_importar_operaciones')
        UNION ALL
        SELECT 1 WHERE to_regclass('public.v_fbo_movimientos') IS NOT NULL
       ) s;
