-- =============================================================================
-- Diagnóstico del catálogo de matrículas (public.matriculas_manifiestos) y de
-- la columna MATRÍCULA de los manifiestos.
--
-- SÓLO LECTURA: todas son consultas SELECT. El editor SQL de Supabase muestra
-- sólo el último resultado: correr cada consulta por separado.
-- La llave de comparación es la misma de la pantalla (_conciNormalizeMatricula):
-- mayúsculas, sin guiones, puntos ni espacios.
-- Contexto: docs/catalogo-matriculas-revision.md
-- =============================================================================


-- 1) Repetidas con otra escritura (XA-VBZ / XAVBZ / XA VBZ) ---------------------
SELECT regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g') AS llave,
       count(*) AS registros,
       string_agg(format('%s · id %s · %s · %s · %s pax', matricula, id, aerolinea, tipo_de_aeronave_2, pasajeros),
                  ' | ' ORDER BY updated_at DESC) AS detalle
  FROM public.matriculas_manifiestos
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY 2 DESC;


-- 2) Escritura rara: espacios, minúsculas, caracteres que no van -----------------
SELECT id, fila_origen, matricula, aerolinea,
       concat_ws(', ',
           CASE WHEN matricula <> btrim(matricula) THEN 'espacios al inicio/fin' END,
           CASE WHEN btrim(matricula) ~ '\s' THEN 'espacio interno' END,
           CASE WHEN matricula ~ chr(160) THEN 'espacio duro' END,
           CASE WHEN matricula ~ '[a-z]' THEN 'minúsculas' END,
           CASE WHEN matricula ~ '[^A-Za-z0-9 -]' THEN 'caracteres especiales' END,
           CASE WHEN matricula ~ '(^-|-$|--)' THEN 'guion mal puesto' END) AS problema
  FROM public.matriculas_manifiestos
 WHERE matricula <> btrim(matricula) OR btrim(matricula) ~ '\s' OR matricula ~ chr(160)
    OR matricula ~ '[a-z]' OR matricula ~ '[^A-Za-z0-9 -]' OR matricula ~ '(^-|-$|--)'
 ORDER BY matricula;


-- 3) Formato según la marca de nacionalidad ------------------------------------
--    Reglas de los países que aparecen en el catálogo. Una matrícula de un
--    país que no está aquí sale como "revisar país", no necesariamente mal.
WITH m AS (
    SELECT id, matricula, aerolinea, regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g') AS k
      FROM public.matriculas_manifiestos
)
SELECT id, matricula, aerolinea,
       CASE
           WHEN k ~ '^X[ABC]' THEN CASE WHEN k ~ '^X[ABC][A-Z]{3}$' THEN NULL ELSE 'México: XA/XB/XC + 3 letras' END
           WHEN k ~ '^N' THEN CASE WHEN k ~ '^N[1-9][0-9]{0,4}$|^N[1-9][0-9]{0,3}[A-HJ-NP-Z]$|^N[1-9][0-9]{0,2}[A-HJ-NP-Z]{2}$'
                                   THEN NULL ELSE 'EE.UU.: N + hasta 5 caracteres, sin I ni O' END
           WHEN k ~ '^HP' THEN CASE WHEN k ~ '^HP[0-9]{3,4}[A-Z]{0,3}$' THEN NULL ELSE 'Panamá: HP + 3-4 dígitos + letras' END
           WHEN k ~ '^HI' THEN CASE WHEN k ~ '^HI[0-9]{3,4}$' THEN NULL ELSE 'Rep. Dominicana: HI + 3-4 dígitos' END
           WHEN k ~ '^YV' THEN CASE WHEN k ~ '^YV[0-9]{3,4}[A-Z]?$' THEN NULL ELSE 'Venezuela: YV + 3-4 dígitos' END
           WHEN k ~ '^(CC|9H|EI|EC|HC|LX|TC|A6|A7|ET)' THEN CASE WHEN k ~ '^(CC|9H|EI|EC|HC|LX|TC|A6|A7|ET)[A-Z]{3}$' THEN NULL ELSE 'prefijo de 2 + 3 letras' END
           WHEN k ~ '^C[FGI]' THEN CASE WHEN k ~ '^C[FGI][A-Z]{3}$' THEN NULL ELSE 'Canadá: C-F/C-G + 3 letras' END
           ELSE 'revisar país'
       END AS problema
  FROM m
 WHERE CASE
           WHEN k ~ '^X[ABC]' THEN k !~ '^X[ABC][A-Z]{3}$'
           WHEN k ~ '^N' THEN k !~ '^N[1-9][0-9]{0,4}$|^N[1-9][0-9]{0,3}[A-HJ-NP-Z]$|^N[1-9][0-9]{0,2}[A-HJ-NP-Z]{2}$'
           WHEN k ~ '^HP' THEN k !~ '^HP[0-9]{3,4}[A-Z]{0,3}$'
           WHEN k ~ '^HI' THEN k !~ '^HI[0-9]{3,4}$'
           WHEN k ~ '^YV' THEN k !~ '^YV[0-9]{3,4}[A-Z]?$'
           WHEN k ~ '^(CC|9H|EI|EC|HC|LX|TC|A6|A7|ET)' THEN k !~ '^(CC|9H|EI|EC|HC|LX|TC|A6|A7|ET)[A-Z]{3}$'
           WHEN k ~ '^C[FGI]' THEN k !~ '^C[FGI][A-Z]{3}$'
           ELSE true
       END
 ORDER BY problema, matricula;


-- 4) Capacidad y pesos imposibles ----------------------------------------------
--    La capacidad (pasajeros) es la que usa el sobrecupo.
SELECT id, matricula, aerolinea, tipo_de_aeronave, tipo_de_aeronave_2, mlw_ton, mtow_ton, mzfw_ton, pasajeros,
       concat_ws(', ',
           CASE WHEN pasajeros IS NULL OR pasajeros = 0 THEN 'sin capacidad (no se calcula sobrecupo)' END,
           CASE WHEN pasajeros > 450 THEN 'capacidad mayor a 450' END,
           CASE WHEN mlw_ton > mtow_ton THEN 'MLW mayor que MTOW' END,
           CASE WHEN mzfw_ton > mlw_ton THEN 'MZFW mayor que MLW' END,
           CASE WHEN upper(coalesce(tipo_de_aeronave_2, '')) ~ '(787|777|767|A330|A340|A350)' AND mtow_ton < 150
                THEN 'MTOW muy bajo para un fuselaje ancho' END) AS problema
  FROM public.matriculas_manifiestos
 WHERE pasajeros IS NULL OR pasajeros = 0 OR pasajeros > 450
    OR mlw_ton > mtow_ton OR mzfw_ton > mlw_ton
    OR (upper(coalesce(tipo_de_aeronave_2, '')) ~ '(787|777|767|A330|A340|A350)' AND mtow_ton < 150)
 ORDER BY matricula;


-- 5) Misma aerolínea y modelo con capacidades muy distintas --------------------
--    Puede ser configuración distinta (válido) o una capacidad copiada de otro
--    modelo (afecta el sobrecupo).
SELECT aerolinea, tipo_de_aeronave_2, min(pasajeros) AS minimo, max(pasajeros) AS maximo, count(*) AS aeronaves,
       string_agg(format('%s=%s', matricula, pasajeros), ' ' ORDER BY pasajeros) AS detalle
  FROM public.matriculas_manifiestos
 GROUP BY 1, 2
HAVING max(pasajeros) - min(pasajeros) > 40
 ORDER BY 1, 2;


-- 6) Matrículas de los manifiestos con varias aerolíneas en el mismo mes ---------
--    Puede ser renta con tripulación o un error de captura de AEROLINEA o de
--    MATRÍCULA.
SELECT regexp_replace(upper("MATRÍCULA"), '[^A-Z0-9]', '', 'g') AS matricula,
       date_trunc('month', public._aifa_parse_manifest_date("FECHA"))::date AS mes,
       string_agg(DISTINCT "AEROLINEA", ' | ') AS aerolineas,
       count(*) AS registros
  FROM public.maestra_manifiestos
 WHERE nullif(btrim("MATRÍCULA"), '') IS NOT NULL
 GROUP BY 1, 2
HAVING count(DISTINCT "AEROLINEA") > 1
 ORDER BY 4 DESC;


-- 7) Escrituras distintas de la misma matrícula en los manifiestos -------------
SELECT regexp_replace(upper("MATRÍCULA"), '[^A-Z0-9]', '', 'g') AS matricula,
       array_agg(DISTINCT "MATRÍCULA") AS escrituras, count(*) AS registros
  FROM public.maestra_manifiestos
 WHERE nullif(btrim("MATRÍCULA"), '') IS NOT NULL
 GROUP BY 1
HAVING count(DISTINCT "MATRÍCULA") > 1
 ORDER BY 3 DESC;
