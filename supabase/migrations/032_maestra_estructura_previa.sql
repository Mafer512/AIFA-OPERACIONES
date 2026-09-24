-- =============================================================================
-- 032 — Estructura previa a la migración de datos hacia maestra_operaciones
--
-- Este archivo NO migra datos. Solo deja maestra_operaciones en condiciones de
-- recibirlos sin perder ninguna fila ni ninguna columna capturable. Es requisito
-- de 033 y 034.
--
-- QUÉ AGREGA Y POR QUÉ
--
-- 1) movement_slot + índice único corregido.
--    Las tres tablas de vuelos (vuelos_parte_operaciones_csv,
--    itinerario_vuelos_editable, manifiestos_vuelos_editable) identifican un
--    movimiento por (movement_key, coalesce(movement_slot, '')) desde la
--    migración 022. maestra_operaciones se quedó con el índice único de la 023,
--    que solo mira movement_key.
--
--    Consecuencia hoy: una rotación doble —el mismo vuelo, el mismo día, la
--    misma dirección y el mismo destino, pero en dos horarios— produce el MISMO
--    movement_key. En las tablas de vuelos son dos filas distintas porque el
--    slot las separa; en maestra_operaciones la segunda pisaría a la primera.
--    El caso está documentado y cubierto por
--    __tests__/itinerario-import-rotacion-doble.test.js (XN1107 a las 01:55 y a
--    las 23:05 del mismo día).
--
-- 2) cliente_uuid.
--    Es la llave con la que el navegador NOMBRA una fila de Conciliación antes
--    de que exista en la base (migración 029). Sin ella el alta deja de ser
--    idempotente: dos capturistas sobre el mismo vuelo crean filas gemelas, y
--    un reintento cuya respuesta se perdió inserta dos veces.
--
-- 3) estatus_matricula, demora_15_min, folio.
--    Las dos primeras son columnas EDITABLES de la tabla de Conciliación
--    ("ESTATUS MATRÍCULA", "DEMORA +- 15 MIN."). Hoy la 023 las guarda dentro de
--    datos_origen, pero datos_origen pasa a ser territorio exclusivo del
--    Itinerario, así que necesitan casa propia o la captura las pierde.
--    folio viene del formato oficial (manifiestos_pasajeros / manifiestos_carga)
--    y es identidad del documento, no dato de presentación.
--
--    El resto de los campos del formato oficial AFAC (comandante, num_licencia,
--    tripulacion_ps, oaci_*, fbo, firma_elaboro, pdf_url, desglose nac/int de
--    pasajeros, pasajeros_primera/turista/menores/tercera_edad/discapacitados)
--    va a portal_manifiesto_datos, según lo acordado: son datos que se imprimen
--    en el manifiesto, no dimensiones de reporte.
--
-- 4) _aifa_aodb_timestamptz — helper para promover las horas del AODB
--    ('10AUG 23:05') a timestamptz. Reutiliza sin redefinir
--    _aifa_date_near_reference (010) y _aifa_movement_slot (022).
--
-- CATÁLOGOS: SOLO LECTURA. Ni un ALTER, INSERT, UPDATE ni DELETE sobre
-- airlines, catalogo_demoras, catalogo_aeropuertos, matriculas_manifiestos,
-- flight_service_type ni conciliacion_catalogo_aerolineas.
--
-- MODO DE USO
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK: no persiste
--      nada. Revisar el bloque de VERIFICACIÓN del final.
--   2) Si se ve bien, cambiar la última línea ROLLBACK por COMMIT y volver a
--      correr el archivo completo.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Columnas nuevas
-- -----------------------------------------------------------------------------
ALTER TABLE public.maestra_operaciones
    ADD COLUMN IF NOT EXISTS movement_slot     text,
    ADD COLUMN IF NOT EXISTS cliente_uuid      uuid,
    ADD COLUMN IF NOT EXISTS estatus_matricula text,
    ADD COLUMN IF NOT EXISTS demora_15_min     text,
    ADD COLUMN IF NOT EXISTS folio             text;

COMMENT ON COLUMN public.maestra_operaciones.movement_slot IS
    'Hora programada normalizada (HH:MM) del movimiento. Junto con movement_key distingue dos rotaciones del mismo vuelo el mismo día. Mismo criterio y misma función (_aifa_movement_slot) que las tres tablas de vuelos desde la migración 022.';

COMMENT ON COLUMN public.maestra_operaciones.cliente_uuid IS
    'Identificador que genera el navegador al crear la fila en Conciliación, antes de que exista en la base. Destino del UPSERT: hace que reintentar una escritura no duplique la fila. NULL en filas que no nacieron de una captura manual.';

COMMENT ON COLUMN public.maestra_operaciones.estatus_matricula IS
    'Columna "ESTATUS MATRÍCULA" de Conciliación. Es capturable y editable en la cuadrícula, por eso es columna y no JSON. No confundir con matriculas_manifiestos.estatus (ACTIVO/CHARTEROS), que vw_maestra_operaciones expone aparte como matricula_estatus.';

COMMENT ON COLUMN public.maestra_operaciones.demora_15_min IS
    'Columna "DEMORA +- 15 MIN." de Conciliación. Texto libre capturable, distinto de minutos_demora (numérico) y de codigo_demora_origen.';

COMMENT ON COLUMN public.maestra_operaciones.folio IS
    'Folio del manifiesto oficial (manifiestos_pasajeros / manifiestos_carga). Identidad del documento.';

-- -----------------------------------------------------------------------------
-- 2) Índice único por identidad de movimiento
--
--    Se crea el nuevo ANTES de borrar el viejo. Si hubiera filas que ya
--    colisionan bajo el criterio nuevo, la creación falla aquí y la transacción
--    se deshace entera, dejando la tabla como estaba: es preferible eso a
--    quedarse sin ningún índice de unicidad.
--
--    movement_slot se rellena primero desde la hora programada que ya tenga la
--    fila; si no hay ninguna, queda en cadena vacía (no NULL) para que el índice
--    sí compare esas filas entre sí, igual que en la 022.
-- -----------------------------------------------------------------------------
UPDATE public.maestra_operaciones
SET movement_slot = coalesce(
        public._aifa_movement_slot(to_char(hora_programada AT TIME ZONE 'America/Mexico_City', 'HH24:MI')),
        ''
    )
WHERE movement_slot IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maestra_operaciones_movement_identity
    ON public.maestra_operaciones (movement_key, coalesce(movement_slot, ''))
    WHERE movement_key IS NOT NULL;

DROP INDEX IF EXISTS public.uq_maestra_operaciones_movement_key;

-- cliente_uuid: único admitiendo NULL, y NO parcial — ON CONFLICT (cliente_uuid)
-- necesita exactamente esta forma. Idéntico al de la migración 029.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maestra_operaciones_cliente_uuid
    ON public.maestra_operaciones (cliente_uuid);

-- -----------------------------------------------------------------------------
-- 3) Helper: hora del AODB ('10AUG 23:05') → timestamptz
--
--    El AODB entrega las horas como texto con día y mes pero sin año. La fecha
--    se resuelve con _aifa_date_near_reference contra la fecha de la operación
--    (misma regla que ya usa la 010 para calcular arr/dep_scheduled_date), y la
--    hora con _aifa_movement_slot. Las horas del AODB son locales de la Ciudad
--    de México; el AT TIME ZONE las ancla antes de guardarlas como timestamptz.
--
--    Nunca lanza error: si no se puede interpretar con certeza devuelve NULL, y
--    el valor crudo queda de todas formas respaldado en datos_origen.
-- -----------------------------------------------------------------------------
--    PARALLEL UNSAFE a propósito, y no es una errata: el bloque EXCEPTION de
--    abajo abre una subtransacción interna, y un worker paralelo no puede
--    abrirlas. Marcarla SAFE haría que Postgres la metiera en planes paralelos y
--    reventara con "25000: cannot start commands during a parallel operation".
--    Las funciones equivalentes de las migraciones 010 y 023
--    (_aifa_parse_manifest_date, _aifa_safe_numeric, _aifa_safe_timestamptz,
--    _aifa_date_near_reference) arrastran ese mismo error de etiquetado; ver la
--    nota al inicio de 033 sobre cómo se sortea mientras se corrige aparte.
CREATE OR REPLACE FUNCTION public._aifa_aodb_timestamptz(p_value text, p_reference date)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SET search_path = ''
AS $$
DECLARE
    v_fecha date;
    v_hora  text;
BEGIN
    IF NULLIF(btrim(coalesce(p_value, '')), '') IS NULL THEN RETURN NULL; END IF;

    v_hora := public._aifa_movement_slot(p_value);
    IF v_hora = '' THEN RETURN NULL; END IF;

    -- Si el texto no trae día/mes (solo "23:05"), se usa la fecha de referencia.
    v_fecha := coalesce(public._aifa_date_near_reference(p_value, p_reference), p_reference);
    IF v_fecha IS NULL THEN RETURN NULL; END IF;

    RETURN (v_fecha::text || ' ' || v_hora || ':00')::timestamp
           AT TIME ZONE 'America/Mexico_City';
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._aifa_aodb_timestamptz(text, date) IS
    'Convierte una hora del AODB en texto ("10AUG 23:05", "23:05") a timestamptz, anclada a la zona de la Ciudad de México. Devuelve NULL en vez de fallar si el valor no es interpretable.';

-- -----------------------------------------------------------------------------
-- 3b) Helper: ¿este movimiento es internacional?
--
--     maestra_operaciones guarda la carga en DOS EJES INDEPENDIENTES, y es fácil
--     confundirlos porque los cuatro valores están en kilogramos:
--
--       EJE 1 · nacional / internacional  → carga_nacional_kg, carga_internacional_kg
--               Lo decide "TIPO DE OPERACIÓN" (el tramo que vuela la aeronave).
--
--       EJE 2 · importación / exportación → carga_importacion_kg, carga_exportacion_kg
--               Lo decide la aduana. Un mismo vuelo internacional puede traer
--               carga de importación y llevar de exportación.
--
--     carga_total_kg es el kilaje del movimiento y NO es la suma de los cuatro:
--     es la suma del eje 1 (nacional + internacional), que es como lo calcula
--     hoy _conciSummaryCargoKgs en script.js.
--
--     Esta función reproduce EXACTAMENTE la regla de js/manifiestos-carga.js
--     (isDom / isInt, líneas 147-148):
--       · contiene "INT"                        → internacional (true)
--       · no vacío y sin "INT"                  → nacional      (false)
--       · vacío                                 → indeterminado (NULL)
--     El NULL importa: sin tipo de operación no se puede afirmar ninguna de las
--     dos, y meter el kilaje en la columna equivocada falsearía el reporte.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_carga_es_internacional(p_tipo_operacion text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN NULLIF(btrim(coalesce(p_tipo_operacion, '')), '') IS NULL THEN NULL
        WHEN upper(p_tipo_operacion) LIKE '%INT%' THEN true
        ELSE false
    END
$$;

COMMENT ON FUNCTION public._aifa_carga_es_internacional(text) IS
    'Clasifica un movimiento como internacional (true), nacional (false) o indeterminado (NULL) a partir de TIPO DE OPERACIÓN. Misma regla que isDom/isInt de js/manifiestos-carga.js. No confundir con el eje importación/exportación, que es aduanal e independiente.';

-- -----------------------------------------------------------------------------
-- 4) Índices de apoyo para la migración y para el cruce posterior
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_maestra_operaciones_cliente_uuid
    ON public.maestra_operaciones (cliente_uuid)
    WHERE cliente_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maestra_operaciones_fuente
    ON public.maestra_operaciones (fuente_principal, fecha_operacion);

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
DO $$
DECLARE
    v_total          bigint;
    v_sin_slot       bigint;
    v_colisiones     bigint;
    v_col_faltantes  text;
BEGIN
    SELECT count(*) INTO v_total FROM public.maestra_operaciones;

    SELECT count(*) INTO v_sin_slot
      FROM public.maestra_operaciones
     WHERE movement_slot IS NULL;

    -- Cuántos grupos habrían colapsado con el índice viejo (solo movement_key).
    SELECT count(*) INTO v_colisiones
      FROM (
        SELECT movement_key
          FROM public.maestra_operaciones
         WHERE movement_key IS NOT NULL
         GROUP BY movement_key
        HAVING count(DISTINCT coalesce(movement_slot, '')) > 1
      ) t;

    SELECT string_agg(c, ', ') INTO v_col_faltantes
      FROM unnest(ARRAY['movement_slot','cliente_uuid','estatus_matricula','demora_15_min','folio']) AS c
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'maestra_operaciones'
           AND column_name  = c
     );

    RAISE NOTICE '--- 032 estructura previa ---';
    RAISE NOTICE 'filas en maestra_operaciones ........ %', v_total;
    RAISE NOTICE 'filas sin movement_slot ............. % (debe ser 0)', v_sin_slot;
    RAISE NOTICE 'columnas nuevas faltantes ........... %', coalesce(v_col_faltantes, 'ninguna');
    -- Aquí este número SIEMPRE es 0, y eso no significa que no haya rotaciones
    -- dobles: significa que todavía no se han migrado. El índice único viejo
    -- impedía que existieran, y el respaldo de arriba dejó a todas las filas con
    -- el mismo slot (cadena vacía) porque hora_programada aún está sin llenar.
    -- Las rotaciones dobles reales aparecen cuando 033 trae los slots del
    -- itinerario; para verlas hay que mirar el reporte 7 de 035.
    RAISE NOTICE 'movement_key con más de un slot ..... % (informativo: será 0 hasta que corra 033)', v_colisiones;

    IF v_col_faltantes IS NOT NULL THEN
        RAISE EXCEPTION 'No se crearon todas las columnas nuevas: %', v_col_faltantes;
    END IF;
    IF v_sin_slot > 0 THEN
        RAISE EXCEPTION 'Quedaron % filas con movement_slot NULL', v_sin_slot;
    END IF;
END $$;

-- Los dos índices únicos que deben quedar vivos.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename  = 'maestra_operaciones'
   AND indexname IN (
        'uq_maestra_operaciones_movement_identity',
        'uq_maestra_operaciones_cliente_uuid',
        'uq_maestra_operaciones_aodb_movimiento',
        'uq_maestra_operaciones_conciliacion_legacy'
   )
 ORDER BY indexname;

-- =============================================================================
-- Revisar el NOTICE y el listado de índices de arriba. Si todo cuadra, cambiar
-- la siguiente línea de ROLLBACK a COMMIT y volver a correr el archivo completo.
-- =============================================================================
ROLLBACK;
