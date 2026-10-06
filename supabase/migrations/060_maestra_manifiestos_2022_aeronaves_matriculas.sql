-- =============================================================================
-- 060 · Manifiestos 2022 (public.maestra_manifiestos): AERONAVE y MATRÍCULA
--
-- CONTEXTO
--   public.maestra_manifiestos tiene 9,633 manifiestos de pasajeros del
--   21-mar al 31-dic de 2022 (revisado el 2026-10-06 con
--   scripts/diagnostico-pendiente.sql). Cada fila guarda el renglón original
--   del Excel en datos_origen (claves "TIPO DE AERONAVE", "MATRÍCULA",
--   "archivo", "fila_excel"…), así que el dato tal como llegó no se pierde.
--
-- QUÉ HACE
--   1) Agrega a catalogo_aeronaves_equivalencias (058) la columna
--      registros_maestra_2022 y la llena contando la tabla real.
--   2) Registra las 8 escrituras de AERONAVE que sólo aparecen en 2022
--      ("A-340-600", "E-145", "B-737-4"…): 7 confirmadas y 1 pendiente.
--   3) Corrige 7 matrículas mal capturadas (8 manifiestos), sólo las que
--      tienen error demostrado. La original queda en datos_origen->>'MATRÍCULA':
--        · HB1730CMP -> HP1730CMP  HB es Suiza; CMP es el sufijo de Copa;
--                                   HP1730CMP es el 737-800 de Copa del catálogo.
--        · VY3507    -> YV-3507    VY no es marca de nacionalidad; YV-3507 es el
--                                   A340-300 de Conviasa y el manifiesto dice
--                                   A-340-313X (un A340-300).
--        · VA-VBR    -> XA-VBR     VA no es marca de nacionalidad; XA-VBR es el
--                                   A321neo de Viva y el manifiesto dice A-321.
--        · VA-VSZ    -> XA-VSZ     Ídem; XA-VSZ es el A320 de Volaris (A-320).
--        · ZA-DRA    -> XA-DRA     ZA es Albania; XA-DRA es el 737-800 de
--                                   Aeroméxico y el manifiesto es de Aeroméxico.
--        · N515CL    -> N515VL     FAA: N515CL es una Cessna 182G privada;
--                                   N515VL es el A320-233 de Volaris.
--        · N218GX    -> N281GX     FAA: N218GX está registrada a una oficina de
--                                   la propia FAA; N281GX es el A320-214 de
--                                   Global X (dígitos invertidos).
--      Cada corrección exige que la aerolínea del manifiesto coincida y que el
--      renglón original esté en datos_origen. No toca AERONAVE ni ningún otro
--      campo, ni otros errores que no se pudieron demostrar (ver
--      docs/catalogo-matriculas-revision.md, "Manifiestos 2022").
--
-- REQUIERE
--   058 aplicada (COMMIT). Si maestra_manifiestos tiene triggers, se disparan
--   con el UPDATE del punto 3: el resultado final los lista para revisarlos
--   antes del COMMIT.
--
-- MODO DE USO (igual que 058 y 059)
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK: no guarda
--      nada. El editor muestra la tabla de verificación del final.
--   2) Si se ve bien, cambiar la última línea ROLLBACK por COMMIT y volver a
--      correrlo.
--
-- REVERSA
--   UPDATE public.maestra_manifiestos SET "MATRÍCULA" = datos_origen->>'MATRÍCULA'
--    WHERE regexp_replace(upper(datos_origen->>'MATRÍCULA'), '[^A-Z0-9]', '', 'g')
--          IN ('HB1730CMP', 'VY3507', 'VAVBR', 'VAVSZ', 'ZADRA', 'N515CL', 'N218GX');
--   DELETE FROM public.catalogo_aeronaves_equivalencias
--    WHERE valor_original IN ('A-340-600', 'A-340-300', 'A-340-313X', 'E-145',
--                             'A-319', 'B-737-4', 'B-757-2', 'B-737-NG');
--   ALTER TABLE public.catalogo_aeronaves_equivalencias DROP COLUMN registros_maestra_2022;
-- =============================================================================

BEGIN;

-- 1) Conteo real de 2022 en la tabla de equivalencias ---------------------------

ALTER TABLE public.catalogo_aeronaves_equivalencias
    ADD COLUMN IF NOT EXISTS registros_maestra_2022 integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.catalogo_aeronaves_equivalencias.registros_maestra_2022 IS
    'Manifiestos con ese valor exacto en public.maestra_manifiestos (mar-dic 2022).';

-- 2) Escrituras que sólo aparecen en 2022 ---------------------------------------

INSERT INTO public.catalogo_aeronaves_equivalencias
    (valor_original, matricula, codigo_iata, codigo_icao, nivel, tipo_problema, estado, evidencia, fuentes, registros_muestra_jun2026)
VALUES
    ('A-340-600', NULL, '346', 'A346', 'variante', 'nombre_en_lugar_de_codigo', 'confirmado',
     'Igual que A340-600 con guion. Se usa en YV-3535 y YV-3533 (346 en aircraft.csv). También aparece en YV-3507, que es A340-300: error de esos manifiestos, no del valor.',
     'DOC8643; aircraft.csv', 0),
    ('A-340-300', NULL, '343', 'A343', 'variante', 'nombre_en_lugar_de_codigo', 'confirmado',
     'A340-300: entrada 343 del catálogo; DOC8643 A343. Usado en YV-3507 (343 en aircraft.csv).',
     'DOC8643; aircraft.csv', 0),
    ('A-340-313X', NULL, '343', 'A343', 'variante', 'modelo_tecnico_en_lugar_de_codigo', 'confirmado',
     'A340-313X es un modelo de la serie A340-300 (los A340-3xx son la serie 300). Usado en YV-3507, A340-300 en aircraft.csv.',
     'DOC8643; aircraft.csv', 0),
    ('E-145', NULL, 'ER4', 'E145', 'variante', 'nombre_en_lugar_de_codigo', 'confirmado',
     'Embraer ERJ-145: DOC8643 E145; única entrada E145 del catálogo (ER4). XA-SFH, XA-NFP, XA-AFH y XA-RUV son ER4 en aircraft.csv.',
     'DOC8643; aircraft.csv', 0),
    ('A-319', NULL, '319', 'A319', 'variante', 'nombre_en_lugar_de_codigo', 'confirmado',
     'Airbus A319: entrada 319 del catálogo; DOC8643 A319.', 'DOC8643', 0),
    ('B-737-4', NULL, '734', 'B734', 'variante', 'nombre_en_lugar_de_codigo', 'confirmado',
     '737-400: FAA N311GT (la matrícula con este valor) es un Boeing 737-400; DOC8643 B734.',
     'FAA; DOC8643', 0),
    ('B-757-2', NULL, NULL, 'B752', 'tipo', 'nombre_en_lugar_de_codigo', 'confirmado',
     '757-200: DOC8643 B752. IATA abierto: 752, 75W (winglets) o 75F (carguero).', 'DOC8643', 0),
    ('B-737-NG', NULL, NULL, NULL, 'ninguno', 'familia_sin_serie', 'pendiente',
     '737 Next Generation abarca -600, -700, -800 y -900. Resolver por matrícula.', 'DOC8643', 0)
ON CONFLICT (valor_original, coalesce(matricula, '')) DO NOTHING;

UPDATE public.catalogo_aeronaves_equivalencias e
   SET registros_maestra_2022 = (
           SELECT count(*) FROM public.maestra_manifiestos m
            WHERE m."AERONAVE" = e.valor_original
              AND (e.matricula IS NULL
                   OR regexp_replace(upper(m."MATRÍCULA"), '[^A-Z0-9]', '', 'g') = e.matricula)),
       updated_at = now();

-- 3) Matrículas con error demostrado ------------------------------------------

WITH correcciones(erronea, correcta, aerolinea) AS (
    VALUES
        ('HB1730CMP', 'HP1730CMP', 'COPA AIRLINES'),
        ('VY3507',    'YV-3507',   'CONVIASA'),
        ('VAVBR',     'XA-VBR',    'VIVA AEROBUS'),
        ('VAVSZ',     'XA-VSZ',    'VOLARIS'),
        ('ZADRA',     'XA-DRA',    'AEROMEXICO'),
        ('N515CL',    'N515VL',    'VOLARIS'),
        ('N218GX',    'N281GX',    'GLOBAL')
)
UPDATE public.maestra_manifiestos m
   SET "MATRÍCULA" = c.correcta
  FROM correcciones c
 WHERE regexp_replace(upper(m."MATRÍCULA"), '[^A-Z0-9]', '', 'g') = c.erronea
   AND upper(btrim(m."AEROLINEA")) = c.aerolinea
   AND m.datos_origen ? 'MATRÍCULA';

-- =============================================================================
-- VERIFICACIÓN: una sola tabla (el editor muestra el último resultado).
--   · equivalencia: valores con manifiestos en 2022 y su destino.
--   · matrícula corregida: deben ser 8 filas; "valor" es la original
--     (datos_origen) y "resultado" la nueva.
--   · trigger: si sale alguno, revisar qué hace antes del COMMIT.
-- =============================================================================
SELECT 'equivalencia' AS parte, valor_original AS valor,
       coalesce(codigo_iata, codigo_icao, '—') AS resultado,
       format('%s · %s manifiestos 2022', estado, registros_maestra_2022) AS detalle
  FROM public.catalogo_aeronaves_equivalencias
 WHERE registros_maestra_2022 > 0
UNION ALL
SELECT 'matrícula corregida', m.datos_origen->>'MATRÍCULA', m."MATRÍCULA",
       format('id %s · %s · %s · %s', m.id, m."FECHA", m."AEROLINEA", m."AERONAVE")
  FROM public.maestra_manifiestos m
 WHERE regexp_replace(upper(m.datos_origen->>'MATRÍCULA'), '[^A-Z0-9]', '', 'g')
       IN ('HB1730CMP', 'VY3507', 'VAVBR', 'VAVSZ', 'ZADRA', 'N515CL', 'N218GX')
UNION ALL
SELECT 'trigger en maestra_manifiestos', t.tgname,
       CASE WHEN t.tgenabled = 'D' THEN 'deshabilitado' ELSE 'activo' END,
       pg_get_triggerdef(t.oid)
  FROM pg_trigger t
 WHERE t.tgrelid = 'public.maestra_manifiestos'::regclass
   AND NOT t.tgisinternal
 ORDER BY 1, 2;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT cuando la verificación se vea bien.
-- -----------------------------------------------------------------------------
ROLLBACK;
