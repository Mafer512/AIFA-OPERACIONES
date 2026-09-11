-- =============================================================================
-- 039 — Semilla de reglas de clasificación  (OPCIONAL, pero recomendada)
--
-- REQUISITO: 036, 037 y el motor v2 (040 a 044) aplicados, con COMMIT.
--
-- CORRERLA ANTES DE LA 045. Así el único llenado de la vista ya sale
-- clasificado y no hace falta refrescar dos veces. Es idempotente: si ya se
-- había aplicado antes, volver a correrla no duplica nada.
--
-- POR QUÉ ES OPCIONAL
--
--   Sin reglas, TODAS las operaciones salen SIN CLASIFICAR. Eso es correcto
--   —el sistema no adivina— pero deja el módulo sin nada que mostrar el primer
--   día. Este archivo carga un punto de partida REVISABLE: reglas normales, que
--   se ven, se editan y se apagan desde la pantalla de Clasificación, no
--   heurísticas escondidas en el código.
--
-- DE DÓNDE SALE CADA REGLA (nada es invento)
--
--   Bloque A — 24 reglas por TIPO DE SERVICIO, copiadas del catálogo oficial
--   public.flight_service_type (db/create_flight_service_type.sql, a su vez
--   cargado de data/master/flightservicetype.csv). La traducción es directa:
--       categoria 'Regular' | 'Fletamento' | 'Vuelos adicionales' → COMERCIAL
--       categoria 'Otros'                                         → GENERAL
--       tipo_operacion 'Pasajeros'                → PASAJEROS
--       tipo_operacion con 'Carga' y/o 'Correo'   → CARGA
--       tipo_operacion con 'Pasajeros' Y 'Carga'  → MIXTA
--       tipo_operacion 'Sin especificar' / 'Manejo Especial' → OTRA
--   No se inventa ninguna categoría: se lee la que el catálogo ya declara.
--
--   Bloque B — reglas por AEROLÍNEA, copiadas de
--   conciliacion_catalogo_aerolineas.types, que es EXACTAMENTE la clasificación
--   que el sistema usa hoy (script.js _conciRowIsCargo y la vista
--   v_informe_manifiestos_normalizado de la 027). Sirven de respaldo cuando el
--   movimiento no trae tipo de servicio.
--
-- PRIORIDADES
--
--   300  tipo de servicio  → describe ESE vuelo
--   500  aerolínea         → describe al operador en general
--   Menor número gana, así que un vuelo de una aerolínea de carga que salga
--   como ferry (servicio P) se clasifica GENERAL/OTRA y no COMERCIAL/CARGA.
--   Cualquier regla que se cree a mano con prioridad < 300 le gana a las dos.
--
-- VIGENCIA
--
--   Se cargan con vigente_desde y vigente_hasta en NULL: cubren toda la
--   historia. Es lo que se quiere de un punto de partida. Cuando haya que
--   cambiar un criterio A PARTIR DE cierta fecha, la forma correcta NO es
--   editar la regla: es cerrarla (vigente_hasta = el día anterior) y crear la
--   nueva desde el día siguiente. Así el histórico se sigue reproduciendo igual.
--   La pantalla de Clasificación hace exactamente eso con el botón "Reemplazar
--   desde una fecha".
--
-- IDEMPOTENTE: se puede correr las veces que haga falta. Las reglas sembradas
-- se marcan en observaciones con la etiqueta [semilla-039] y se reconocen por
-- ella; una regla que alguien haya editado a mano NO se pisa.
--
-- MODO DE USO
--   1) Correr completo (termina en ROLLBACK) y revisar la VERIFICACIÓN.
--   2) Cambiar ROLLBACK por COMMIT y volver a correr.
--   3) Seguir con la 045, que llena la vista ya con estas reglas.
--      Si esta semilla se aplica DESPUÉS de la 045, las reglas no se ven hasta
--      refrescar: botón "Actualizar" de la barra de filtros, o desde el editor
--      SQL, seleccionada sola:
--        REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_estadistica_operaciones;
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- BLOQUE A — una regla por cada código de tipo de servicio del catálogo
-- -----------------------------------------------------------------------------
WITH traducido AS (
    SELECT
        fst.codigo,
        fst.categoria,
        fst.tipo_operacion,
        fst.descripcion,
        CASE
            WHEN lower(btrim(fst.categoria)) IN ('regular', 'fletamento', 'vuelos adicionales')
                THEN 'COMERCIAL'
            ELSE 'GENERAL'
        END AS segmento,
        CASE
            WHEN fst.tipo_operacion ILIKE '%pasajero%' AND fst.tipo_operacion ILIKE '%carga%'
                THEN 'MIXTA'
            WHEN fst.tipo_operacion ILIKE '%pasajero%'
                THEN 'PASAJEROS'
            WHEN fst.tipo_operacion ILIKE '%carga%' OR fst.tipo_operacion ILIKE '%correo%'
                THEN 'CARGA'
            ELSE 'OTRA'
        END AS naturaleza
    FROM public.flight_service_type fst
)
INSERT INTO public.estadistica_reglas_clasificacion (
    activo, prioridad, tipo_servicio, segmento_aviacion, naturaleza_operacion,
    vigente_desde, vigente_hasta, observaciones
)
SELECT
    true,
    300,
    t.codigo,
    t.segmento,
    t.naturaleza,
    NULL,
    NULL,
    format('[semilla-039] Tipo de servicio %s — %s (%s / %s del catálogo flight_service_type).',
           t.codigo, t.descripcion, t.categoria, t.tipo_operacion)
FROM traducido t
WHERE NOT EXISTS (
    SELECT 1
      FROM public.estadistica_reglas_clasificacion r
     WHERE r.tipo_servicio = t.codigo
       AND r.aerolinea_id IS NULL
       AND r.aerolinea_codigo IS NULL
       AND r.aerolinea_texto IS NULL
       AND r.tipo_aeronave IS NULL
);

-- -----------------------------------------------------------------------------
-- BLOQUE B — respaldo por aerolínea, con la clasificación vigente hoy
--
--   types = {'carga'}                → COMERCIAL / CARGA
--   types = {'pasajeros'}            → COMERCIAL / PASAJEROS
--   types con las dos               → COMERCIAL / MIXTA
--   Aerolíneas sin types NO generan regla: no hay de dónde deducirla, y
--   deducirla a la fuerza sería exactamente lo que este módulo evita.
-- -----------------------------------------------------------------------------
INSERT INTO public.estadistica_reglas_clasificacion (
    activo, prioridad, aerolinea_id, segmento_aviacion, naturaleza_operacion,
    vigente_desde, vigente_hasta, observaciones
)
SELECT
    true,
    500,
    ca.id,
    'COMERCIAL',
    CASE
        WHEN 'carga' = ANY (ca.types) AND 'pasajeros' = ANY (ca.types) THEN 'MIXTA'
        WHEN 'carga' = ANY (ca.types) THEN 'CARGA'
        ELSE 'PASAJEROS'
    END,
    NULL,
    NULL,
    format('[semilla-039] Aerolínea %s — copiado de conciliacion_catalogo_aerolineas.types = %s. Respaldo cuando el movimiento no trae tipo de servicio.',
           ca.name, ca.types::text)
FROM public.conciliacion_catalogo_aerolineas ca
WHERE ca.active
  AND ca.types IS NOT NULL
  AND array_length(ca.types, 1) > 0
  AND ('carga' = ANY (ca.types) OR 'pasajeros' = ANY (ca.types))
  AND NOT EXISTS (
      SELECT 1
        FROM public.estadistica_reglas_clasificacion r
       WHERE r.aerolinea_id = ca.id
         AND r.tipo_servicio IS NULL
         AND r.tipo_aeronave IS NULL
         AND r.aerolinea_texto IS NULL
         AND r.aerolinea_codigo IS NULL
  );


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- 1) Cuántas reglas quedaron, por origen y por resultado.
SELECT
    CASE WHEN observaciones LIKE '[semilla-039] Tipo de servicio%' THEN 'A · tipo de servicio'
         WHEN observaciones LIKE '[semilla-039] Aerolínea%'        THEN 'B · aerolínea'
         ELSE 'creada a mano' END                                  AS origen,
    segmento_aviacion,
    naturaleza_operacion,
    count(*) AS reglas
  FROM public.estadistica_reglas_clasificacion
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

-- 2) La traducción del catálogo, código por código, para revisarla a ojo.
--    Vale la pena mirar en particular O (Manejo Especial) y X (Escala Técnica):
--    el catálogo los pone en categorías que no todos los aeropuertos usan igual.
SELECT r.tipo_servicio, f.categoria, f.tipo_operacion, f.descripcion,
       r.segmento_aviacion, r.naturaleza_operacion
  FROM public.estadistica_reglas_clasificacion r
  JOIN public.flight_service_type f ON f.codigo = r.tipo_servicio
 WHERE r.observaciones LIKE '[semilla-039]%'
 ORDER BY r.tipo_servicio;

-- 3) Efecto sobre la clasificación, con el resolvedor en vivo sobre una
--    muestra de la maestra.
--
--    NO se lee la vista materializada: antes de la 045 está vacía y
--    consultarla aborta con 55000. Y se usa la firma de SEIS argumentos del
--    motor v2 (con el código de aerolínea del catálogo principal); la de
--    cinco ya no existe.
SELECT
    count(*)                                          AS muestra,
    count(*) FILTER (WHERE cl.regla_id IS NOT NULL)   AS se_clasificarian,
    count(*) FILTER (WHERE cl.regla_id IS NULL)       AS seguirian_sin_clasificar
  FROM (
      SELECT mo.fecha_operacion,
             mo.aerolinea_conciliacion_id,
             mo.aerolinea_id,
             mo.aerolinea_origen,
             NULLIF(btrim(mo.tipo_aeronave_codigo), '') AS tipo_aeronave,
             upper(NULLIF(btrim(coalesce(mo.tipo_servicio_codigo, mo.tipo_servicio_origen)), '')) AS tipo_servicio
        FROM public.maestra_operaciones mo
       WHERE NOT coalesce(mo.cancelado, false)
       ORDER BY mo.fecha_operacion DESC
       LIMIT 5000
  ) m
  LEFT JOIN LATERAL public.estadistica_resolver_clasificacion(
      m.fecha_operacion, m.aerolinea_conciliacion_id, m.aerolinea_id,
      m.aerolinea_origen, m.tipo_aeronave, m.tipo_servicio
  ) cl ON true;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT cuando la verificación se vea bien. Después seguir con
-- 045_estadistica_v2_poblar.sql, que llena la vista ya con estas reglas.
-- -----------------------------------------------------------------------------
ROLLBACK;
