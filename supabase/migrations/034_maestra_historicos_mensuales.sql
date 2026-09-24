-- =============================================================================
-- 034 — Históricos mensuales de manifiestos → maestra_operaciones
--
-- REQUISITO: correr antes 032 y 033 (con COMMIT).
--
-- QUÉ MIGRA
--   "Base de datos Manifiestos 2025"          → HISTORICO_MANIFIESTOS_2025
--   "Base de Datos Manifiestos Febrero 2026"  → HISTORICO_MANIFIESTOS_2026
--   "Manifiestos Junio 2026"                  → HISTORICO_MANIFIESTOS_2026
--   "Base de Manifiestos Carga Febrero 2026"  → HISTORICO_CARGA_2026
--
-- QUÉ NO MIGRA
--   La tabla "Manifiestos" (a secas). Ningún archivo .js la referencia: es un
--   remanente. Si resulta que alguien la usa fuera de este repositorio, se
--   agrega después con el mismo patrón de este archivo.
--
-- LAS TABLAS DE ORIGEN NO SE TOCAN. Los módulos que las consumen hoy
-- (js/manifiestos-analisis.js, js/manifiestos-carga.js, js/manifiestos-upload.js)
-- siguen leyéndolas igual: esta migración solo COPIA hacia maestra_operaciones.
--
-- TRES DECISIONES QUE CONVIENE CONOCER
--
-- 1) movement_key se deja en NULL a propósito.
--    Estas filas son archivo histórico, no operación viva. Si se les calculara
--    movement_key entrarían a competir por el índice único
--    uq_maestra_operaciones_movement_identity con las filas reales de
--    Conciliación y del Itinerario, y en los periodos que se traslapan (junio
--    2026) una pisaría a la otra. La identidad calculada se guarda de todas
--    formas en origenes->clave, para poder cruzarlas a mano cuando haga falta.
--    El bloque de VERIFICACIÓN reporta cuántas se traslapan.
--
-- 2) La idempotencia va por origenes.
--    "Base de Datos Manifiestos Febrero 2026" no tiene columna id ni ninguna
--    llave primaria, y la de 2025 solo trae pgrst_rownum. Para poder recorrer
--    este archivo varias veces sin duplicar, cada fila se marca en origenes con
--    su tabla de procedencia y una clave natural determinista; antes de insertar
--    se comprueba que esa marca no exista ya. El índice GIN sobre origenes ya
--    existe (idx_maestra_operaciones_origenes_gin), así que la comprobación es
--    barata.
--
-- 3) La fila cruda va a datos_origen, bajo la llave 'historico_mensual'.
--    La regla acordada es que solo el Itinerario escribe datos_origen, para que
--    Manifiestos no pise nunca el respaldo del AODB. Estas filas no tienen ni
--    tendrán contraparte en el Itinerario —son meses ya cerrados—, así que no
--    hay nada que pisar: datos_origen sigue significando "así llegó el dato".
--
-- MODO DE USO
--   1) Correr el archivo completo tal cual. Termina en ROLLBACK.
--   2) Si los conteos cuadran, cambiar ROLLBACK por COMMIT y volver a correrlo.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;

-- Sin paralelismo en esta transacción, y es obligatorio, no una optimización.
--
-- Las funciones auxiliares de las migraciones 010 y 023
-- (_aifa_parse_manifest_date, _aifa_safe_numeric, _aifa_safe_timestamptz,
-- _aifa_date_near_reference) están declaradas PARALLEL SAFE, pero todas llevan
-- un bloque EXCEPTION. En PL/pgSQL un EXCEPTION abre una subtransacción interna,
-- y un worker paralelo no puede abrir subtransacciones: Postgres aborta con
--     25000: cannot start commands during a parallel operation
-- El error solo se dispara cuando el planificador elige un plan paralelo, que es
-- justo lo que hace al escanear estas tablas completas. Por eso no se había visto
-- antes: las consultas normales de la app son pequeñas y nunca paralelizan.
--
-- Se apaga aquí, acotado a esta transacción, en vez de tocar esas funciones:
-- las usan otras partes del sistema y reetiquetarlas es un cambio aparte, con su
-- propia prueba: la corrección definitiva es reetiquetarlas como PARALLEL
-- UNSAFE, o quitarles el EXCEPTION, en una migración dedicada.
SET LOCAL max_parallel_workers_per_gather = 0;

-- -----------------------------------------------------------------------------
-- Helper local: marca de procedencia de una fila histórica.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp._mig_marca(p_tabla text, p_clave text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_array(jsonb_build_object('tabla', p_tabla, 'clave', p_clave))
$$;

-- =============================================================================
-- 1) "Base de datos Manifiestos 2025"
--
--    Esquema más pobre que el resto: usa "EQUIPO" en vez de "AERONAVE", trae
--    "PAX. QUE PAGAN TUA" (con punto) y le faltan por completo ESTATUS
--    MATRÍCULA, HR. DE EMBARQUE O DESEMBARQUE, PUNTUALIDAD, carga, correo,
--    demoras, observaciones y CAPTURÓ. Lo que no existe queda NULL: no se
--    inventa nada.
-- =============================================================================
CREATE TEMP TABLE _mig_h2025 ON COMMIT DROP AS
SELECT
    h.pgrst_rownum                                               AS rownum,
    concat_ws('|', h."FECHA", h."# DE VUELO", h."TIPO DE MANIFIESTO",
                   h."AEROLINEA", h.pgrst_rownum::text)          AS clave,
    public._aifa_parse_manifest_date(h."FECHA")                  AS fecha_operacion,
    CASE public._aifa_manifest_direction(h."TIPO DE MANIFIESTO")
        WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
    END                                                          AS tipo_movimiento,
    to_jsonb(h)                                                  AS crudo
FROM public."Base de datos Manifiestos 2025" h;

INSERT INTO public.maestra_operaciones (
    fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto, tipo_operacion,
    tipo_aeronave_codigo, matricula_id, matricula_origen, aerolinea_conciliacion_id,
    aerolinea_origen, origen_origen, destino_origen,
    slot_asignado, slot_coordinado, hora_pernocta, hora_operacion,
    hora_maxima_entrega, hora_recepcion, horas_cumplidas,
    pax_total, pax_diplomaticos, pax_comision, pax_infantes, pax_transitos,
    pax_conexiones, pax_otros_exentos, pax_exentos_reportados, pax_pagan_tua_reportados,
    equipaje_kg, conciliado, fuente_principal, origenes, datos_origen
)
SELECT
    s.fecha_operacion, s.tipo_movimiento,
    NULLIF(btrim(h."# DE VUELO"), ''),
    NULLIF(btrim(h."TIPO DE MANIFIESTO"), ''),
    NULLIF(btrim(h."TIPO DE OPERACIÓN"), ''),
    NULLIF(btrim(h."EQUIPO"), ''),
    (SELECT mm.id FROM public.matriculas_manifiestos mm
      WHERE public._aifa_normalize_identity_part(mm.matricula)
          = public._aifa_normalize_identity_part(h."MATRÍCULA") LIMIT 1),
    NULLIF(btrim(h."MATRÍCULA"), ''),
    (SELECT c.id FROM public.conciliacion_catalogo_aerolineas c
      WHERE lower(btrim(c.name)) = lower(btrim(h."AEROLINEA"))
         OR upper(btrim(coalesce(c.iata, ''))) = upper(btrim(h."AEROLINEA"))
         OR lower(btrim(h."AEROLINEA")) = ANY (SELECT lower(btrim(a)) FROM unnest(c.aliases) a)
      ORDER BY (lower(btrim(c.name)) = lower(btrim(h."AEROLINEA"))) DESC LIMIT 1),
    NULLIF(btrim(h."AEROLINEA"), ''),
    CASE WHEN s.tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(h."DESTINO / ORIGEN"), '') END,
    CASE WHEN s.tipo_movimiento = 'SALIDA'  THEN NULLIF(btrim(h."DESTINO / ORIGEN"), '') END,
    public._aifa_safe_timestamptz(h."SLOT ASIGNADO",                       s.fecha_operacion),
    public._aifa_safe_timestamptz(h."SLOT COORDINADO",                     s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE INICIO O TERMINO DE PERNOCTA", s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE OPERACIÓN",                    s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. MÁXIMA DE ENTREGA",               s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE RECEPCIÓN",                    s.fecha_operacion),
    h."HRS. CUMPLIDAS"::numeric(12,3),
    h."TOTAL PAX",
    public._aifa_safe_bigint(h."DIPLOMATICOS"),
    public._aifa_safe_bigint(h."EN COMISION"),
    public._aifa_safe_bigint(h."INFANTES"),
    public._aifa_safe_bigint(h."TRANSITOS"),
    public._aifa_safe_bigint(h."CONEXIONES"),
    public._aifa_safe_bigint(h."OTROS EXENTOS"),
    public._aifa_safe_bigint(h."TOTAL EXENTOS"),
    public._aifa_safe_bigint(h."PAX. QUE PAGAN TUA"),
    public._aifa_safe_numeric(h."KGS. DE EQUIPAJE"),
    true,
    'HISTORICO_MANIFIESTOS_2025',
    pg_temp._mig_marca('Base de datos Manifiestos 2025', s.clave),
    jsonb_build_object('historico_mensual', s.crudo)
FROM _mig_h2025 s
JOIN public."Base de datos Manifiestos 2025" h ON h.pgrst_rownum = s.rownum
WHERE s.fecha_operacion IS NOT NULL
  AND s.tipo_movimiento IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.maestra_operaciones m
       WHERE m.origenes @> pg_temp._mig_marca('Base de datos Manifiestos 2025', s.clave)
  );

-- =============================================================================
-- 2) "Base de Datos Manifiestos Febrero 2026"
--
--    Sin id ni pgrst_rownum: la clave natural se arma con las columnas que
--    identifican el movimiento más un número de fila estable calculado con
--    row_number() sobre un orden determinista.
-- =============================================================================
CREATE TEMP TABLE _mig_h2026feb ON COMMIT DROP AS
SELECT
    row_number() OVER (ORDER BY h."FECHA", h."# DE VUELO", h."TIPO DE MANIFIESTO",
                                h."AEROLINEA", h."MATRÍCULA", h."TOTAL PAX") AS n,
    h."FECHA"                AS f_fecha,
    h."# DE VUELO"           AS f_vuelo,
    h."TIPO DE MANIFIESTO"   AS f_tipo,
    h."AEROLINEA"            AS f_aerolinea,
    h."MATRÍCULA"            AS f_matricula,
    h."TOTAL PAX"            AS f_pax,
    public._aifa_parse_manifest_date(h."FECHA")  AS fecha_operacion,
    CASE public._aifa_manifest_direction(h."TIPO DE MANIFIESTO")
        WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
    END                                          AS tipo_movimiento,
    to_jsonb(h)                                  AS crudo
FROM public."Base de Datos Manifiestos Febrero 2026" h;

ALTER TABLE _mig_h2026feb ADD COLUMN clave text;
UPDATE _mig_h2026feb
SET clave = concat_ws('|', f_fecha, f_vuelo, f_tipo, f_aerolinea, f_matricula, n::text);

INSERT INTO public.maestra_operaciones (
    fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto, tipo_operacion,
    tipo_aeronave_codigo, matricula_id, matricula_origen, estatus_matricula,
    aerolinea_conciliacion_id, aerolinea_origen, origen_origen, destino_origen,
    slot_asignado, slot_coordinado, hora_pernocta, hora_embarque_desembarque,
    hora_operacion, hora_maxima_entrega, hora_recepcion, horas_cumplidas,
    estado_puntualidad, pax_total, pax_diplomaticos, pax_comision, pax_infantes,
    pax_transitos, pax_conexiones, pax_otros_exentos, pax_exentos_reportados,
    pax_pagan_tua_reportados, equipaje_kg, conciliado,
    fuente_principal, origenes, datos_origen
)
SELECT
    s.fecha_operacion, s.tipo_movimiento,
    NULLIF(btrim(s.f_vuelo), ''),
    NULLIF(btrim(s.f_tipo), ''),
    NULLIF(btrim(s.crudo->>'TIPO DE OPERACIÓN'), ''),
    NULLIF(btrim(s.crudo->>'AERONAVE'), ''),
    (SELECT mm.id FROM public.matriculas_manifiestos mm
      WHERE public._aifa_normalize_identity_part(mm.matricula)
          = public._aifa_normalize_identity_part(s.f_matricula) LIMIT 1),
    NULLIF(btrim(s.f_matricula), ''),
    NULLIF(btrim(s.crudo->>'ESTATUS MATRÍCULA'), ''),
    (SELECT c.id FROM public.conciliacion_catalogo_aerolineas c
      WHERE lower(btrim(c.name)) = lower(btrim(s.f_aerolinea))
         OR upper(btrim(coalesce(c.iata, ''))) = upper(btrim(s.f_aerolinea))
         OR lower(btrim(s.f_aerolinea)) = ANY (SELECT lower(btrim(a)) FROM unnest(c.aliases) a)
      ORDER BY (lower(btrim(c.name)) = lower(btrim(s.f_aerolinea))) DESC LIMIT 1),
    NULLIF(btrim(s.f_aerolinea), ''),
    CASE WHEN s.tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(s.crudo->>'DESTINO / ORIGEN'), '') END,
    CASE WHEN s.tipo_movimiento = 'SALIDA'  THEN NULLIF(btrim(s.crudo->>'DESTINO / ORIGEN'), '') END,
    public._aifa_safe_timestamptz(s.crudo->>'SLOT ASIGNADO',                       s.fecha_operacion),
    public._aifa_safe_timestamptz(s.crudo->>'SLOT COORDINADO',                     s.fecha_operacion),
    public._aifa_safe_timestamptz(s.crudo->>'HR. DE INICIO O TERMINO DE PERNOCTA', s.fecha_operacion),
    public._aifa_safe_timestamptz(s.crudo->>'HR. DE EMBARQUE O DESEMBARQUE',       s.fecha_operacion),
    public._aifa_safe_timestamptz(s.crudo->>'HR. DE OPERACIÓN',                    s.fecha_operacion),
    public._aifa_safe_timestamptz(s.crudo->>'HR. MÁXIMA DE ENTREGA',               s.fecha_operacion),
    public._aifa_safe_timestamptz(s.crudo->>'HR. DE RECEPCIÓN',                    s.fecha_operacion),
    public._aifa_safe_numeric(s.crudo->>'HRS. CUMPLIDAS')::numeric(12,3),
    NULLIF(btrim(s.crudo->>'PUNTUALIDAD / CANCELACIÓN'), ''),
    s.f_pax,
    public._aifa_safe_bigint(s.crudo->>'DIPLOMATICOS'),
    public._aifa_safe_bigint(s.crudo->>'EN COMISION'),
    public._aifa_safe_bigint(s.crudo->>'INFANTES'),
    public._aifa_safe_bigint(s.crudo->>'TRANSITOS'),
    public._aifa_safe_bigint(s.crudo->>'CONEXIONES'),
    public._aifa_safe_bigint(s.crudo->>'OTROS EXENTOS'),
    public._aifa_safe_bigint(s.crudo->>'TOTAL EXENTOS'),
    public._aifa_safe_bigint(s.crudo->>'PAX QUE PAGAN TUA'),
    public._aifa_safe_numeric(s.crudo->>'KGS. DE EQUIPAJE'),
    true,
    'HISTORICO_MANIFIESTOS_2026',
    pg_temp._mig_marca('Base de Datos Manifiestos Febrero 2026', s.clave),
    jsonb_build_object('historico_mensual', s.crudo)
FROM _mig_h2026feb s
WHERE s.fecha_operacion IS NOT NULL
  AND s.tipo_movimiento IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.maestra_operaciones m
       WHERE m.origenes @> pg_temp._mig_marca('Base de Datos Manifiestos Febrero 2026', s.clave)
  );

-- =============================================================================
-- 3) "Manifiestos Junio 2026"
--
--    La única de las tres de pasajeros con id propio, así que su clave natural
--    es directamente ese id. Ojo: aquí la columna es "MATRICULA" sin acento.
-- =============================================================================
CREATE TEMP TABLE _mig_h2026jun ON COMMIT DROP AS
SELECT
    h.id,
    h.id::text                                   AS clave,
    public._aifa_parse_manifest_date(h."FECHA")  AS fecha_operacion,
    CASE public._aifa_manifest_direction(h."TIPO DE MANIFIESTO")
        WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
    END                                          AS tipo_movimiento,
    to_jsonb(h)                                  AS crudo
FROM public."Manifiestos Junio 2026" h;

INSERT INTO public.maestra_operaciones (
    fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto, tipo_operacion,
    tipo_aeronave_codigo, matricula_id, matricula_origen, estatus_matricula,
    aerolinea_conciliacion_id, aerolinea_origen, origen_origen, destino_origen,
    slot_asignado, slot_coordinado, hora_pernocta, hora_embarque_desembarque,
    hora_operacion, hora_maxima_entrega, hora_recepcion, horas_cumplidas,
    estado_puntualidad, pax_total, pax_diplomaticos, pax_comision, pax_infantes,
    pax_transitos, pax_conexiones, pax_otros_exentos, pax_exentos_reportados,
    pax_pagan_tua_reportados, equipaje_kg, conciliado,
    fuente_principal, origenes, datos_origen
)
SELECT
    s.fecha_operacion, s.tipo_movimiento,
    NULLIF(btrim(h."# DE VUELO"), ''),
    NULLIF(btrim(h."TIPO DE MANIFIESTO"), ''),
    NULLIF(btrim(h."TIPO DE OPERACIÓN"), ''),
    NULLIF(btrim(h."AERONAVE"), ''),
    (SELECT mm.id FROM public.matriculas_manifiestos mm
      WHERE public._aifa_normalize_identity_part(mm.matricula)
          = public._aifa_normalize_identity_part(h."MATRICULA") LIMIT 1),
    NULLIF(btrim(h."MATRICULA"), ''),
    NULLIF(btrim(h."ESTATUS MATRÍCULA"), ''),
    (SELECT c.id FROM public.conciliacion_catalogo_aerolineas c
      WHERE lower(btrim(c.name)) = lower(btrim(h."AEROLINEA"))
         OR upper(btrim(coalesce(c.iata, ''))) = upper(btrim(h."AEROLINEA"))
         OR lower(btrim(h."AEROLINEA")) = ANY (SELECT lower(btrim(a)) FROM unnest(c.aliases) a)
      ORDER BY (lower(btrim(c.name)) = lower(btrim(h."AEROLINEA"))) DESC LIMIT 1),
    NULLIF(btrim(h."AEROLINEA"), ''),
    CASE WHEN s.tipo_movimiento = 'LLEGADA' THEN NULLIF(btrim(h."DESTINO / ORIGEN"), '') END,
    CASE WHEN s.tipo_movimiento = 'SALIDA'  THEN NULLIF(btrim(h."DESTINO / ORIGEN"), '') END,
    public._aifa_safe_timestamptz(h."SLOT ASIGNADO",                       s.fecha_operacion),
    public._aifa_safe_timestamptz(h."SLOT COORDINADO",                     s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE INICIO O TERMINO DE PERNOCTA", s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE EMBARQUE O DESEMBARQUE",       s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE OPERACIÓN",                    s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. MÁXIMA DE ENTREGA",               s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE RECEPCIÓN",                    s.fecha_operacion),
    h."HRS. CUMPLIDAS"::numeric(12,3),
    NULLIF(btrim(h."PUNTUALIDAD / CANCELACIÓN"), ''),
    round(h."TOTAL PAX")::bigint,
    round(h."DIPLOMATICOS")::bigint,
    round(h."EN COMISION")::bigint,
    round(h."INFANTES")::bigint,
    round(h."TRANSITOS")::bigint,
    round(h."CONEXIONES")::bigint,
    round(h."OTROS EXENTOS")::bigint,
    round(h."TOTAL EXENTOS")::bigint,
    round(h."PAX QUE PAGAN TUA")::bigint,
    h."KGS. DE EQUIPAJE",
    true,
    'HISTORICO_MANIFIESTOS_2026',
    pg_temp._mig_marca('Manifiestos Junio 2026', s.clave),
    jsonb_build_object('historico_mensual', s.crudo)
FROM _mig_h2026jun s
JOIN public."Manifiestos Junio 2026" h ON h.id = s.id
WHERE s.fecha_operacion IS NOT NULL
  AND s.tipo_movimiento IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.maestra_operaciones m
       WHERE m.origenes @> pg_temp._mig_marca('Manifiestos Junio 2026', s.clave)
  );

-- =============================================================================
-- 4) "Base de Manifiestos Carga Febrero 2026"
--
--    Es la única fuente que trae ORIGEN / ESCALA / DESTINO por separado y el
--    desglose aduanal: de ahí salen carga_importacion_kg, carga_exportacion_kg,
--    origen_iata, escala_iata y destino_iata, que hasta hoy ningún proceso
--    llenaba.
--
--    LAS CUATRO COLUMNAS DE CARGA SON DOS EJES DISTINTOS, no dos versiones del
--    mismo dato. Así las usa hoy js/manifiestos-carga.js:
--
--      "KGS CARGA LLEGADA NLU" / "KG. DE CARGA SALIDA NLU"
--          El kilaje del movimiento, partido por DIRECCIÓN. Por fila solo una de
--          las dos trae valor — lo dice el comentario del propio módulo en la
--          línea 123: "sólo una tendrá valor por fila". De aquí sale
--          carga_total_kg.
--
--      "IMPORTACIÓN" / "EXPORTACIÓN"
--          El eje ADUANAL. El módulo las detecta (_cols.importac / .exportac)
--          pero no las usa en ningún cálculo ni gráfica. Van a
--          carga_importacion_kg / carga_exportacion_kg, sin mezclarse con el
--          total.
--
--    Y nacional / internacional NO sale de importación/exportación: sale de
--    "TIPO DE OPERACIÓN", que es lo que leen isDom/isInt (líneas 147-148) para
--    pintar la dona "Nacional vs Internacional". El kilaje del movimiento cae
--    entero en carga_nacional_kg o en carga_internacional_kg según esa
--    clasificación, mediante _aifa_carga_es_internacional (032).
--
--    Los códigos de aeropuerto solo se guardan como IATA si existen en
--    catalogo_aeropuertos; si no, la FK rechazaría la fila. El valor crudo queda
--    en origen_origen / escala_origen / destino_origen pase lo que pase.
--
--    Nombres de columna propios de esta tabla, distintos al resto:
--    "HR MÁXIMA DE ENTREGA" (sin punto tras HR), "HR. CUMPLIDAS" (no "HRS.") y
--    "PUNTUALIDAD" (no "PUNTUALIDAD / CANCELACIÓN"). Se respetan tal cual.
-- =============================================================================
CREATE TEMP TABLE _mig_hcarga ON COMMIT DROP AS
SELECT
    h.id,
    h.id::text                                   AS clave,
    public._aifa_parse_manifest_date(h."FECHA")  AS fecha_operacion,
    CASE public._aifa_manifest_direction(h."TIPO DE MANIFIESTO")
        WHEN 'A' THEN 'LLEGADA' WHEN 'D' THEN 'SALIDA' ELSE NULL
    END                                          AS tipo_movimiento,
    -- Kilaje del movimiento: cada dirección tiene su columna y solo una trae
    -- valor por fila. Mismo criterio que getKgsArr/getKgsDep del módulo de carga.
    CASE public._aifa_manifest_direction(h."TIPO DE MANIFIESTO")
        WHEN 'A' THEN public._aifa_safe_numeric(h."KGS CARGA LLEGADA NLU")
        WHEN 'D' THEN public._aifa_safe_numeric(h."KG. DE CARGA SALIDA NLU")
    END::numeric(18,3)                           AS carga_kg,
    public._aifa_carga_es_internacional(h."TIPO DE OPERACIÓN") AS es_internacional,
    to_jsonb(h)                                  AS crudo
FROM public."Base de Manifiestos Carga Febrero 2026" h;

INSERT INTO public.maestra_operaciones (
    fecha_operacion, tipo_movimiento, numero_vuelo, tipo_manifiesto, tipo_operacion,
    tipo_aeronave_codigo, matricula_id, matricula_origen,
    aerolinea_conciliacion_id, aerolinea_origen,
    origen_iata, escala_iata, destino_iata,
    origen_origen, escala_origen, destino_origen,
    slot_asignado, slot_coordinado, hora_pernocta, hora_embarque_desembarque,
    hora_operacion, hora_maxima_entrega, hora_recepcion, horas_cumplidas,
    estado_puntualidad,
    carga_total_kg, carga_nacional_kg, carga_internacional_kg,
    carga_importacion_kg, carga_exportacion_kg,
    conciliado, fuente_principal, origenes, datos_origen
)
SELECT
    s.fecha_operacion, s.tipo_movimiento,
    NULLIF(btrim(h."# DE VUELO"::text), ''),
    NULLIF(btrim(h."TIPO DE MANIFIESTO"), ''),
    NULLIF(btrim(h."TIPO DE OPERACIÓN"), ''),
    NULLIF(btrim(h."AERONAVE"), ''),
    (SELECT mm.id FROM public.matriculas_manifiestos mm
      WHERE public._aifa_normalize_identity_part(mm.matricula)
          = public._aifa_normalize_identity_part(h."MATRÍCULA") LIMIT 1),
    NULLIF(btrim(h."MATRÍCULA"), ''),
    (SELECT c.id FROM public.conciliacion_catalogo_aerolineas c
      WHERE lower(btrim(c.name)) = lower(btrim(h."AEROLINEA"))
         OR upper(btrim(coalesce(c.iata, ''))) = upper(btrim(h."AEROLINEA"))
         OR lower(btrim(h."AEROLINEA")) = ANY (SELECT lower(btrim(a)) FROM unnest(c.aliases) a)
      ORDER BY (lower(btrim(c.name)) = lower(btrim(h."AEROLINEA"))) DESC LIMIT 1),
    NULLIF(btrim(h."AEROLINEA"), ''),
    (SELECT ap.iata FROM public.catalogo_aeropuertos ap WHERE ap.iata = upper(btrim(h."ORIGEN"))  LIMIT 1),
    (SELECT ap.iata FROM public.catalogo_aeropuertos ap WHERE ap.iata = upper(btrim(h."ESCALA"))  LIMIT 1),
    (SELECT ap.iata FROM public.catalogo_aeropuertos ap WHERE ap.iata = upper(btrim(h."DESTINO")) LIMIT 1),
    NULLIF(btrim(h."ORIGEN"), ''),
    NULLIF(btrim(h."ESCALA"), ''),
    NULLIF(btrim(h."DESTINO"), ''),
    public._aifa_safe_timestamptz(h."SLOT ASIGNADO",                       s.fecha_operacion),
    public._aifa_safe_timestamptz(h."SLOT COORDINADO",                     s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE INICIO O TERMINO DE PERNOCTA", s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE EMBARQUE O DESEMBARQUE",       s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE OPERACIÓN",                    s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR MÁXIMA DE ENTREGA",                s.fecha_operacion),
    public._aifa_safe_timestamptz(h."HR. DE RECEPCIÓN",                    s.fecha_operacion),
    h."HR. CUMPLIDAS"::numeric(12,3),
    NULLIF(btrim(h."PUNTUALIDAD"), ''),
    -- carga_total_kg — el kilaje del movimiento, según su dirección.
    s.carga_kg,
    -- carga_nacional_kg / carga_internacional_kg — el MISMO kilaje, colocado en
    -- la columna que le toca según "TIPO DE OPERACIÓN". No se parte: un vuelo de
    -- carga es nacional o internacional, entero. Si el tipo de operación viene
    -- vacío, las dos quedan en NULL en vez de adivinar.
    CASE WHEN s.es_internacional IS FALSE THEN s.carga_kg END,
    CASE WHEN s.es_internacional IS TRUE  THEN s.carga_kg END,
    -- Eje aduanal, independiente del anterior. No suma al total.
    h."IMPORTACIÓN"::numeric(18,3),
    public._aifa_safe_numeric(h."EXPORTACIÓN")::numeric(18,3),
    true,
    'HISTORICO_CARGA_2026',
    pg_temp._mig_marca('Base de Manifiestos Carga Febrero 2026', s.clave),
    jsonb_build_object('historico_mensual', s.crudo)
FROM _mig_hcarga s
JOIN public."Base de Manifiestos Carga Febrero 2026" h ON h.id = s.id
WHERE s.fecha_operacion IS NOT NULL
  AND s.tipo_movimiento IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.maestra_operaciones m
       WHERE m.origenes @> pg_temp._mig_marca('Base de Manifiestos Carga Febrero 2026', s.clave)
  );

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
SELECT 'Base de datos Manifiestos 2025'         AS tabla,
       (SELECT count(*) FROM public."Base de datos Manifiestos 2025")            AS filas_origen,
       (SELECT count(*) FROM _mig_h2025 WHERE fecha_operacion IS NULL
                                            OR tipo_movimiento IS NULL)          AS descartadas,
       (SELECT count(*) FROM public.maestra_operaciones
         WHERE fuente_principal = 'HISTORICO_MANIFIESTOS_2025')                  AS en_maestra
UNION ALL
SELECT 'Base de Datos Manifiestos Febrero 2026',
       (SELECT count(*) FROM public."Base de Datos Manifiestos Febrero 2026"),
       (SELECT count(*) FROM _mig_h2026feb WHERE fecha_operacion IS NULL
                                              OR tipo_movimiento IS NULL),
       (SELECT count(*) FROM public.maestra_operaciones m
         WHERE m.origenes @> '[{"tabla":"Base de Datos Manifiestos Febrero 2026"}]'::jsonb)
UNION ALL
SELECT 'Manifiestos Junio 2026',
       (SELECT count(*) FROM public."Manifiestos Junio 2026"),
       (SELECT count(*) FROM _mig_h2026jun WHERE fecha_operacion IS NULL
                                              OR tipo_movimiento IS NULL),
       (SELECT count(*) FROM public.maestra_operaciones m
         WHERE m.origenes @> '[{"tabla":"Manifiestos Junio 2026"}]'::jsonb)
UNION ALL
SELECT 'Base de Manifiestos Carga Febrero 2026',
       (SELECT count(*) FROM public."Base de Manifiestos Carga Febrero 2026"),
       (SELECT count(*) FROM _mig_hcarga WHERE fecha_operacion IS NULL
                                            OR tipo_movimiento IS NULL),
       (SELECT count(*) FROM public.maestra_operaciones
         WHERE fuente_principal = 'HISTORICO_CARGA_2026');

-- Traslape con la operación viva: días en los que un histórico y una fila real
-- de Conciliación cubren la misma fecha. No es un error —son dos registros del
-- mismo día por vías distintas— pero Estadística los sumaría dos veces si algún
-- reporte mezclara las fuentes sin filtrar por fuente_principal.
SELECT h.fecha_operacion,
       count(*) FILTER (WHERE h.fuente_principal LIKE 'HISTORICO%')      AS filas_historicas,
       count(*) FILTER (WHERE h.fuente_principal NOT LIKE 'HISTORICO%')  AS filas_vivas
  FROM public.maestra_operaciones h
 GROUP BY h.fecha_operacion
HAVING count(*) FILTER (WHERE h.fuente_principal LIKE 'HISTORICO%') > 0
   AND count(*) FILTER (WHERE h.fuente_principal NOT LIKE 'HISTORICO%') > 0
 ORDER BY h.fecha_operacion
 LIMIT 200;

-- Ninguna fila histórica debe haberse quedado con movement_key: competiría por
-- el índice único con la operación viva.
DO $$
DECLARE v_con_key bigint;
BEGIN
    SELECT count(*) INTO v_con_key
      FROM public.maestra_operaciones
     WHERE fuente_principal LIKE 'HISTORICO%'
       AND movement_key IS NOT NULL;
    IF v_con_key > 0 THEN
        RAISE EXCEPTION 'Hay % filas históricas con movement_key; colisionarían con la operación viva', v_con_key;
    END IF;
    RAISE NOTICE '--- 034 históricos: sin colisión de movement_key ---';
END $$;

-- =============================================================================
-- Revisar los conteos y el traslape. Si cuadran, cambiar la siguiente línea de
-- ROLLBACK a COMMIT y volver a correr el archivo completo.
-- =============================================================================
ROLLBACK;
