-- Conciliación > Manifiestos: campo de captura "KGS. DE CARGA EN TRANSITO".
--
-- QUÉ AGREGA (estrictamente aditivo)
--
--   1) Columna "KGS. DE CARGA EN TRANSITO" numeric NULL, sin default, en
--      "Conciliación Manifiestos". Mismo tipo que sus hermanas de carga
--      ("KGS. DE CARGA NACIONAL" / "KGS. DE CARGA INTERNACIONAL" / "CORREO",
--      todas numeric, migración 021). NULL = "no se capturó", distinto de 0.
--      Los registros históricos quedan en NULL: no se inventa ningún dato.
--
--      El nombre va SIN acento a propósito (el módulo ya sufrió columnas
--      dañadas por codificación; ver _CONCI_OUTPUT_COLUMNS en script.js).
--
--   2) La columna entra a _conci_campos_editables_cierre() (la whitelist de
--      053) para que un manifiesto YA CERRADO pueda corregirla por el flujo de
--      corrección autorizada. Sin esto, cualquier cambio sobre una fila
--      cerrada exige el flujo de corrección y este campo nunca estaría entre
--      los corregibles. Al estar en esa lista, el trigger de 054 también la
--      cuenta como campo de NEGOCIO para el historial de "CAPTURÓ".
--
--      NO entra a _conci_campos_numericos_cierre(): esa lista es la de
--      campos que MUEVEN TOTALES de los informes (totales_fijo / ajustes) y
--      la carga en tránsito no alimenta ninguno. La corrección igualmente
--      genera su evento de ledger, como cualquier otra (ver 053).
--
-- QUÉ NO TOCA
--
--   · 053 y 054 (históricas). Aquí sólo se REDEFINE, con CREATE OR REPLACE, la
--     función inmutable de la whitelist, con exactamente la misma lista de 053
--     más el campo nuevo, en el mismo orden relativo.
--   · "KG DE CARGA TOTAL" sigue siendo nacional + internacional. La carga en
--     tránsito es una dimensión ortogonal (ver docs/modulo-estadistico.md §4):
--     NO se suma al total ni se deriva de él.
--   · maestra_operaciones (ya tiene carga_transito_kg, migración 037). Los
--     triggers de sincronización Conciliación → maestra NO se modifican aquí;
--     por lo tanto este dato todavía no viaja a la maestra. Ver informe.
--   · RLS, grants, índices, constraints y triggers existentes.
--
-- Idempotente. Un solo BEGIN/COMMIT; compatible con `supabase db push` y el
-- SQL Editor. ADD COLUMN sin default es de metadatos (instantáneo).

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public._conci_campos_editables_cierre()') IS NULL THEN
        RAISE EXCEPTION
            '055 requiere 053_conciliacion_cierre_subsecretaria.sql ya instalada (falta public._conci_campos_editables_cierre()).'
            USING ERRCODE = '42883';
    END IF;
END $$;

ALTER TABLE public."Conciliación Manifiestos"
    ADD COLUMN IF NOT EXISTS "KGS. DE CARGA EN TRANSITO" numeric;

COMMENT ON COLUMN public."Conciliación Manifiestos"."KGS. DE CARGA EN TRANSITO" IS
    'Kg de carga en tránsito del manifiesto (captura). Informativo: NO forma '
    'parte de "KG DE CARGA TOTAL" (= nacional + internacional) ni de ningún '
    'total de informe. NULL = no capturado.';

-- Whitelist de campos corregibles en un manifiesto cerrado: la de 053 + el
-- campo nuevo (tras "KG DE CARGA TOTAL", antes de "CORREO").
CREATE OR REPLACE FUNCTION public._conci_campos_editables_cierre()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT ARRAY[
        'MES','FECHA','TIPO DE MANIFIESTO','AEROLINEA',
        'TIPO DE OPERACIÓN','AERONAVE','MATRÍCULA','ESTATUS MATRÍCULA','# DE VUELO',
        'DESTINO / ORIGEN','RUTA','SLOT ASIGNADO','SLOT COORDINADO',
        'HR. DE INICIO O TERMINO DE PERNOCTA','HR. DE EMBARQUE O DESEMBARQUE',
        'HR. DE OPERACIÓN','HR. MÁXIMA DE ENTREGA','HR. DE RECEPCIÓN','HRS. CUMPLIDAS',
        'TOTAL PAX','DIPLOMATICOS','EN COMISION','INFANTES','TRANSITOS','CONEXIONES',
        'OTROS EXENTOS','TOTAL EXENTOS','PAX QUE PAGAN TUA','KGS. DE EQUIPAJE',
        'KGS. DE CARGA NACIONAL','KGS. DE CARGA INTERNACIONAL','KG DE CARGA TOTAL',
        'KGS. DE CARGA EN TRANSITO','CORREO',
        'PUNTUALIDAD / CANCELACIÓN','DEMORA +- 15 MIN.','CÓDIGO DEMORA','OBSERVACIONES',
        'CAPTURÓ','CAPACIDAD MÁXIMA','FACTOR DE OCUPACIÓN','EVIDENCIA','Hora y Fecha Generación'
    ]::text[];
$$;

REVOKE ALL ON FUNCTION public._conci_campos_editables_cierre() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
