-- =============================================================================
-- 059 · Catálogo de matrículas: una matrícula, un registro
--
-- SÍNTOMA
--   El índice único de 006 compara la matrícula sin espacios a los lados y en
--   mayúsculas, pero con guiones y espacios internos: "XA-VBZ", "XAVBZ" y
--   "XA VBZ" entran como tres aeronaves. La pantalla las compara sin guiones
--   (_conciNormalizeMatricula), así que al cargar el catálogo se quedaba con
--   cualquiera de ellas: aerolínea, estatus y capacidad (sobrecupo) al azar.
--   La carga inicial ya trae "HP1536 CMP" con un espacio interno.
--
-- QUÉ HACE
--   1) Corrige dos errores confirmados, sólo si el valor sigue siendo el de la
--      carga inicial (si alguien ya lo cambió desde la pantalla, no lo toca):
--        · "HP1536 CMP" -> "HP1536CMP" (espacio interno).
--        · N542VL y N543VL: modelo "A-320" -> "A321-271N". El registro FAA
--          (registry.faa.gov, 2026-10-06) los tiene como Airbus A321-271N, sn
--          8603 y 9070; su capacidad (230) y pesos ya eran los de A321neo.
--   2) Crea un índice único sobre la matrícula sin guiones ni espacios (la
--      misma llave que usa la pantalla). Si la tabla ya tiene repetidos con
--      otra escritura, NO lo crea: los lista en la verificación para decidir
--      cuál conservar; no se borra nada automáticamente.
--   Detalle y pendientes: docs/catalogo-matriculas-revision.md
--
-- REQUIERE
--   006/007 (tabla matriculas_manifiestos). No se pudo ejecutar contra la base
--   al prepararla: correrla primero con el ROLLBACK final.
--
-- MODO DE USO (igual que 036 y 058)
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK: no persiste
--      nada. Revisar el bloque de VERIFICACIÓN del final.
--   2) Si se ve bien, cambiar la última línea ROLLBACK por COMMIT y volver a
--      correr el archivo completo.
--
-- REVERSA
--   DROP INDEX IF EXISTS public.uq_matriculas_manifiestos_matricula_llave;
--   UPDATE public.matriculas_manifiestos SET matricula = 'HP1536 CMP'
--    WHERE matricula = 'HP1536CMP' AND fila_origen = 103;
--   UPDATE public.matriculas_manifiestos SET tipo_de_aeronave_2 = 'A-320'
--    WHERE matricula IN ('N542VL', 'N543VL') AND tipo_de_aeronave_2 = 'A321-271N';
-- =============================================================================

BEGIN;

-- 1) Correcciones confirmadas ---------------------------------------------------

UPDATE public.matriculas_manifiestos m
   SET matricula = 'HP1536CMP', updated_at = now()
 WHERE m.matricula = 'HP1536 CMP'
   AND NOT EXISTS (
        SELECT 1 FROM public.matriculas_manifiestos o
         WHERE o.id <> m.id
           AND regexp_replace(upper(o.matricula), '[^A-Z0-9]', '', 'g') = 'HP1536CMP');

UPDATE public.matriculas_manifiestos
   SET tipo_de_aeronave_2 = 'A321-271N', updated_at = now()
 WHERE matricula IN ('N542VL', 'N543VL')
   AND tipo_de_aeronave_2 = 'A-320';

-- 2) Unicidad con la misma llave que la pantalla --------------------------------

DO $$
DECLARE
    v_repetidas integer;
BEGIN
    SELECT count(*) INTO v_repetidas
      FROM (
            SELECT regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g') AS llave
              FROM public.matriculas_manifiestos
             GROUP BY 1
            HAVING count(*) > 1
      ) r;

    IF v_repetidas = 0 THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_matriculas_manifiestos_matricula_llave
            ON public.matriculas_manifiestos
            (regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g'));
    ELSE
        RAISE NOTICE 'No se creó el índice: % matrícula(s) repetidas con otra escritura (ver verificación 2).', v_repetidas;
    END IF;
END;
$$;

COMMENT ON TABLE public.matriculas_manifiestos IS
    'Catálogo de matrículas y características de aeronaves para manifiestos. '
    'Una matrícula por registro: la llave es la matrícula sin guiones ni espacios (059).';

-- =============================================================================
-- VERIFICACIÓN (leer antes de cambiar ROLLBACK por COMMIT)
-- =============================================================================

-- 1) Las correcciones: deben salir HP1536CMP, N542VL y N543VL con su valor nuevo.
SELECT 'correcciones' AS reporte, id, fila_origen, matricula, aerolinea, tipo_de_aeronave, tipo_de_aeronave_2, pasajeros
  FROM public.matriculas_manifiestos
 WHERE regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g') IN ('HP1536CMP', 'N542VL', 'N543VL')
 ORDER BY matricula;

-- 2) Repetidas con otra escritura (debe salir vacío para que exista el índice).
SELECT 'repetidas' AS reporte, regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g') AS llave,
       string_agg(format('%s · id %s · %s · %s pax', matricula, id, aerolinea, pasajeros), ' | ' ORDER BY updated_at DESC) AS registros
  FROM public.matriculas_manifiestos
 GROUP BY 2
HAVING count(*) > 1;

-- 3) El índice nuevo existe.
SELECT 'indice' AS reporte, indexname
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'uq_matriculas_manifiestos_matricula_llave';

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT cuando la verificación se vea bien.
-- -----------------------------------------------------------------------------
ROLLBACK;
