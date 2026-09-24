-- =============================================================================
-- 042 — Motor estadístico v2 · vista materializada
--
-- Parte de la reescritura del motor estadístico (v2) contra el esquema real
-- de maestra_operaciones. El trabajo va REPARTIDO EN SEIS ARCHIVOS porque el
-- editor SQL de Supabase corta la petición HTTP si una sola tarda demasiado, y
-- al ir dentro de una transacción se deshace entera: "Failed to fetch" y ni un
-- objeto creado.
--
--   040  preparación: freno de locks, pausa del refresco automático,
--        contrato de columnas y demolición en orden de dependencia
--   041  criterio de aerolínea en las reglas + resolvedor de clasificación
--   042  vista materializada (vacía) + índices
--   043  estadistica_agregado — el motor
--   044  funciones de consulta y diagnóstico + verificación de catálogo
--   045  llenado, reanudación del refresco automático y verificación de datos
--
-- CORRERLOS EN ORDEN, cada uno con COMMIT antes de pasar al siguiente: el 042
-- necesita el resolvedor del 041, el 043 necesita la vista del 042.
--
-- ENTRE EL 040 Y EL 044 EL MÓDULO ESTADÍSTICO QUEDA ABAJO. Son minutos, y la
-- pestaña Estadística simplemente no encontrará sus funciones; el Informe
-- oficial y el resto de la aplicación siguen funcionando igual.
--
-- REQUISITO: 041 aplicada (con COMMIT). Este archivo usa el resolvedor de
-- clasificación que aquélla crea.
--
-- LA VISTA SE CREA VACÍA (WITH NO DATA) y los ocho índices se construyen sobre
-- una tabla vacía: todo esto tarda segundos. El llenado, que es lo caro, va en
-- el 045 como sentencia suelta.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';
SET LOCAL max_parallel_workers_per_gather = 0;

-- =============================================================================
-- 3) mv_estadistica_operaciones — una fila por MOVIMIENTO, ya resuelta
--    (La versión anterior ya se borró en el bloque 0b.)
-- =============================================================================
CREATE MATERIALIZED VIEW public.mv_estadistica_operaciones AS
WITH base AS (
    SELECT
        v.id,
        mo.fecha_operacion,
        mo.tipo_movimiento,
        CASE mo.tipo_movimiento WHEN 'LLEGADA' THEN 'A' WHEN 'SALIDA' THEN 'D' END AS direccion,
        mo.numero_vuelo,
        NULLIF(btrim(mo.folio), '')                                                AS folio,

        -- ── Identidad comercial ──────────────────────────────────────────────
        mo.aerolinea_id                                                            AS aerolinea_codigo,
        mo.aerolinea_conciliacion_id,
        coalesce(NULLIF(btrim(v.aerolinea), ''), NULLIF(btrim(mo.aerolinea_origen), '')) AS aerolinea,
        mo.aerolinea_origen,
        coalesce(NULLIF(btrim(v.matricula), ''), NULLIF(btrim(mo.matricula_origen), ''))  AS matricula,
        mo.matricula_id,
        NULLIF(btrim(mo.estatus_matricula), '')                                    AS estatus_matricula,
        NULLIF(btrim(mo.tipo_aeronave_codigo), '')                                 AS tipo_aeronave,
        upper(NULLIF(btrim(coalesce(mo.tipo_servicio_codigo, mo.tipo_servicio_origen)), '')) AS tipo_servicio,
        NULLIF(btrim(mo.tipo_operacion), '')                                       AS tipo_operacion,
        NULLIF(btrim(mo.tipo_manifiesto), '')                                      AS tipo_manifiesto,
        NULLIF(btrim(mo.codigo_afac_aifa), '')                                     AS codigo_afac,

        -- ── Geografía ────────────────────────────────────────────────────────
        mo.origen_iata, mo.escala_iata, mo.destino_iata,
        mo.origen_origen, mo.escala_origen, mo.destino_origen,
        mo.ruta_origen, mo.routing,

        -- ── Infraestructura ──────────────────────────────────────────────────
        NULLIF(btrim(mo.posicion), '')                                             AS posicion,
        NULLIF(btrim(mo.puertas), '')                                              AS puerta,
        NULLIF(btrim(mo.bandas_equipaje), '')                                      AS banda,

        -- ── CANCELACIÓN ──────────────────────────────────────────────────────
        -- La bandera manda. Los dos criterios de texto se conservan como
        -- respaldo porque la columna nace en false y las filas históricas
        -- pueden no haberse marcado nunca:
        --   · estatus_vuelo = "Status" del AODB, mismo patrón letra por letra
        --     que _EXCLUDED_STATUS_RE en js/parte-ops-flights.js:1338
        --     (\y es el límite de palabra de Postgres, \b el de JavaScript).
        --   · estado_puntualidad = columna "PUNTUALIDAD / CANCELACIÓN" del
        --     manifiesto, mismo criterio que js/analisis-operaciones.js:2639.
        (
            coalesce(mo.cancelado, false)
            OR coalesce(mo.estatus_vuelo, '') ~* 'cancel|not.?oper|no.?opera|cnx|nop\y'
            OR public._estadistica_norm(mo.estado_puntualidad) IN ('CANCELADO', 'CANCELADA')
        )                                                                           AS es_cancelada,
        CASE
            WHEN coalesce(mo.cancelado, false) THEN 'bandera'
            WHEN coalesce(mo.estatus_vuelo, '') ~* 'cancel|not.?oper|no.?opera|cnx|nop\y' THEN 'estatus_aodb'
            WHEN public._estadistica_norm(mo.estado_puntualidad) IN ('CANCELADO', 'CANCELADA') THEN 'puntualidad'
        END                                                                         AS cancelado_origen,

        -- ── PASAJEROS ────────────────────────────────────────────────────────
        -- NULL se conserva: "no se sabe" y "volaron cero" no son lo mismo, y de
        -- esa distinción dependen todos los indicadores de cobertura.
        coalesce(mo.pax_total, mo.pax_abordados)                                    AS pax,
        mo.pax_programados, mo.pax_no_abordados, mo.pax_inadmitidos, mo.pax_repatriados,
        mo.pax_transitos, mo.pax_conexiones, mo.pax_infantes,
        mo.pax_exentos_reportados, mo.pax_pagan_tua_reportados,

        -- ── CAPACIDAD ────────────────────────────────────────────────────────
        -- La del vuelo manda; la de la matrícula es el respaldo. Cero o
        -- negativa se trata como desconocida, nunca como cero asientos.
        CASE WHEN mo.capacidad_max_pax IS NOT NULL AND mo.capacidad_max_pax > 0
             THEN mo.capacidad_max_pax END                                          AS capacidad_operacion,
        mo.ocupacion                                                                AS ocupacion_reportada,

        -- ── CARGA ────────────────────────────────────────────────────────────
        mo.carga_total_kg, mo.carga_nacional_kg, mo.carga_internacional_kg,
        mo.carga_importacion_kg, mo.carga_exportacion_kg,
        mo.carga_descargada_kg, mo.carga_embarcada_kg, mo.carga_transito_kg,
        NULLIF(btrim(mo.indicador_importacion), '')                                 AS indicador_importacion,
        NULLIF(btrim(mo.indicador_exportacion), '')                                 AS indicador_exportacion,
        mo.correo_kg, mo.equipaje_kg,

        -- ── TIEMPOS ──────────────────────────────────────────────────────────
        mo.estado_puntualidad,
        NULLIF(btrim(mo.demora_15_min), '')                                         AS demora_15_min,
        mo.hora_programada,
        -- hora_operacion es la hora efectiva del movimiento y es la que manda
        -- para evaluar el slot. Las horas reales quedan de respaldo.
        coalesce(mo.hora_operacion, mo.hora_real_bloque, mo.hora_real_pista)        AS hora_operacion,
        coalesce(mo.hora_real_bloque, mo.hora_real_pista)                           AS hora_real,
        -- SLOT VIGENTE: el coordinado es un cambio posterior YA autorizado, así
        -- que en cuanto existe es la referencia válida; el asignado es el
        -- permiso inicial de la aerolínea.
        coalesce(mo.slot_coordinado, mo.slot_asignado)                              AS slot_vigente,
        mo.slot_asignado, mo.slot_coordinado,
        mo.hora_real_bloque, mo.hora_real_pista, mo.hora_attt,
        mo.hora_inicio_pernocta, mo.hora_termino_pernocta,
        mo.minutos_demora,
        NULLIF(btrim(mo.codigo_demora_origen), '')                                  AS codigo_demora,
        NULLIF(btrim(v.causa_demora), '')                                           AS causa_demora,
        NULLIF(btrim(mo.motivo_operativo), '')                                      AS motivo_operativo,

        -- ── ESTADO ───────────────────────────────────────────────────────────
        coalesce(mo.conciliado, false)                                              AS conciliado,
        coalesce(mo.validado, false)                                                AS validado,
        (mo.hora_recepcion IS NOT NULL)                                             AS capturado,
        v.fuente_principal,

        -- ── ROTACIÓN ─────────────────────────────────────────────────────────
        -- Tres niveles, en orden de confianza. rotacion_key es explícita;
        -- movimiento_relacionado_id apunta al otro lado por FK; aodb_legacy_id
        -- sólo empareja cuando los dos movimientos nacieron de la misma fila
        -- del AODB. Se normaliza a una clave de texto para poder particionar.
        NULLIF(btrim(mo.rotacion_key), '')                                          AS rotacion_key,
        mo.movimiento_relacionado_id,
        mo.aodb_legacy_id
    FROM public.vw_maestra_operaciones v
    JOIN public.maestra_operaciones mo ON mo.id = v.id
    WHERE mo.fecha_operacion IS NOT NULL
      AND mo.tipo_movimiento IN ('LLEGADA', 'SALIDA')
),
rotada AS (
    SELECT
        b.*,
        -- Con movimiento_relacionado_id la clave es el par ordenado {menor,
        -- mayor}, para que los dos lados caigan en la misma partición apunte
        -- quien apunte a quién.
        coalesce(
            b.rotacion_key,
            CASE WHEN b.movimiento_relacionado_id IS NOT NULL
                 THEN 'rel:' || least(b.id, b.movimiento_relacionado_id)::text
                          || '-' || greatest(b.id, b.movimiento_relacionado_id)::text END,
            CASE WHEN b.aodb_legacy_id IS NOT NULL THEN 'aodb:' || b.aodb_legacy_id::text END
        ) AS rotacion_clave,
        CASE
            WHEN b.rotacion_key IS NOT NULL              THEN 'rotacion_key'
            WHEN b.movimiento_relacionado_id IS NOT NULL THEN 'movimiento_relacionado'
            WHEN b.aodb_legacy_id IS NOT NULL            THEN 'aodb'
            ELSE 'sin_rotacion'
        END AS rotacion_origen
    FROM base b
),
ubicada AS (
    SELECT
        r.*,
        -- El "otro extremo" del movimiento: el origen si es llegada, el destino
        -- si es salida. Se prefiere el IATA ya resuelto por FK; si no hay, se
        -- parsea la ruta con la misma función que usa el resto del sistema
        -- (_aifa_route_endpoint, migración 010).
        coalesce(
            CASE r.direccion WHEN 'A' THEN NULLIF(btrim(r.origen_iata), '')
                             WHEN 'D' THEN NULLIF(btrim(r.destino_iata), '') END,
            public._aifa_route_endpoint(
                coalesce(r.ruta_origen, r.routing,
                         CASE r.direccion WHEN 'A' THEN r.origen_origen ELSE r.destino_origen END),
                r.direccion
            )
        ) AS endpoint_codigo,
        coalesce(NULLIF(btrim(r.escala_iata), ''), NULLIF(btrim(r.escala_origen), '')) AS escala_codigo
    FROM rotada r
),
clasificada AS (
    SELECT
        u.*,
        ap.ciudad AS endpoint_ciudad,
        -- NACIONAL / INTERNACIONAL.
        -- 1º lo DECLARADO en tipo_operacion, que es el campo que la fuente
        --    llena con NACIONAL / INTERNACIONAL.
        -- 2º si no viene, se deriva del catálogo de aeropuertos con el mismo
        --    criterio que v_informe_manifiestos_normalizado (027): un código
        --    OACI mexicano (MMxx) es nacional aunque el catálogo no lo tenga.
        -- Si ninguna de las dos resuelve se deja en NULL — no se supone
        -- "nacional".
        coalesce(
            CASE public._estadistica_norm(u.tipo_operacion)
                WHEN 'NACIONAL' THEN 'Nacional'
                WHEN 'INTERNACIONAL' THEN 'Internacional'
            END,
            CASE
                WHEN u.endpoint_codigo IS NULL THEN NULL
                WHEN left(u.endpoint_codigo, 2) = 'MM' AND length(u.endpoint_codigo) = 4 THEN 'Nacional'
                WHEN ap.pais IS NULL THEN NULL
                WHEN lower(btrim(ap.pais)) IN ('mexico', 'méxico') THEN 'Nacional'
                ELSE 'Internacional'
            END
        ) AS nacional_internacional,
        CASE
            WHEN public._estadistica_norm(u.tipo_operacion) IN ('NACIONAL', 'INTERNACIONAL') THEN 'declarado'
            WHEN u.endpoint_codigo IS NOT NULL AND
                 (left(u.endpoint_codigo, 2) = 'MM' OR ap.pais IS NOT NULL) THEN 'catalogo'
            ELSE 'sin_determinar'
        END AS nacint_origen,

        CASE WHEN mm.pasajeros IS NOT NULL AND mm.pasajeros > 0 THEN mm.pasajeros END AS capacidad_matricula,
        mm.tipo_de_aeronave AS tipo_aeronave_matricula,

        fst.descripcion AS tipo_servicio_descripcion,
        fst.categoria   AS tipo_servicio_categoria,

        cl.regla_id,
        cl.segmento_aviacion,
        cl.naturaleza_operacion,

        -- MINUTOS CONTRA EL SLOT VIGENTE. Ésta es la medición oficial:
        --     hora_operacion - slot_vigente
        -- hora_programada NO sustituye al slot para esto. Se descarta lo que
        -- caiga fuera de un rango razonable (-12 h a +48 h): esos valores no son
        -- desviaciones sino fechas mal interpretadas, y uno solo bastaría para
        -- arruinar el promedio.
        CASE
            WHEN u.slot_vigente IS NOT NULL AND u.hora_operacion IS NOT NULL
                 AND extract(epoch FROM (u.hora_operacion - u.slot_vigente)) / 60.0 BETWEEN -720 AND 2880
                 THEN round(extract(epoch FROM (u.hora_operacion - u.slot_vigente)) / 60.0)
        END AS minutos_vs_slot,

        -- DEMORA OPERACIONAL. Es OTRA cosa que la adherencia al slot: mide el
        -- retraso del vuelo, no el cumplimiento del permiso. Se conserva el
        -- minutaje capturado y, a falta de él, la diferencia contra la hora
        -- programada.
        CASE
            WHEN u.minutos_demora IS NOT NULL
                 AND u.minutos_demora BETWEEN -720 AND 2880 THEN u.minutos_demora::numeric
            WHEN u.hora_programada IS NOT NULL AND u.hora_real IS NOT NULL
                 AND extract(epoch FROM (u.hora_real - u.hora_programada)) / 60.0 BETWEEN -720 AND 2880
                 THEN round(extract(epoch FROM (u.hora_real - u.hora_programada)) / 60.0)
        END AS minutos_demora_calc,

        -- PERNOCTA: minutos que la aeronave estuvo estacionada de noche.
        -- Se acota a una semana; más que eso no es pernocta, es un dato mal
        -- capturado o una aeronave fuera de servicio.
        CASE
            WHEN u.hora_inicio_pernocta IS NOT NULL AND u.hora_termino_pernocta IS NOT NULL
                 AND u.hora_termino_pernocta > u.hora_inicio_pernocta
                 AND extract(epoch FROM (u.hora_termino_pernocta - u.hora_inicio_pernocta)) / 60.0 <= 10080
                 THEN round(extract(epoch FROM (u.hora_termino_pernocta - u.hora_inicio_pernocta)) / 60.0)
        END AS minutos_pernocta,

        -- TURNAROUND (tiempo en tierra). Antes no se podía calcular: hacía
        -- falta saber qué llegada y qué salida son la misma rotación.
        -- Se toma la llegada más tardía y la salida más temprana de la
        -- rotación, en horas de BLOQUE (calzos), que es como se mide.
        max(CASE WHEN u.direccion = 'A' THEN coalesce(u.hora_real_bloque, u.hora_programada) END)
            OVER (PARTITION BY u.rotacion_clave) AS rot_llegada,
        min(CASE WHEN u.direccion = 'D' THEN coalesce(u.hora_real_bloque, u.hora_programada) END)
            OVER (PARTITION BY u.rotacion_clave) AS rot_salida
    FROM ubicada u
    LEFT JOIN public.catalogo_aeropuertos ap ON ap.iata = u.endpoint_codigo
    LEFT JOIN public.matriculas_manifiestos mm ON mm.id = u.matricula_id
    LEFT JOIN public.flight_service_type fst ON fst.codigo = u.tipo_servicio
    LEFT JOIN LATERAL public.estadistica_resolver_clasificacion(
        u.fecha_operacion,
        u.aerolinea_conciliacion_id,
        u.aerolinea_codigo,
        coalesce(u.aerolinea_origen, u.aerolinea),
        u.tipo_aeronave,
        u.tipo_servicio
    ) cl ON true
)
SELECT
    c.id,
    c.fecha_operacion,
    extract(year   FROM c.fecha_operacion)::int AS anio,
    extract(month  FROM c.fecha_operacion)::int AS mes,
    extract(day    FROM c.fecha_operacion)::int AS dia,
    extract(isodow FROM c.fecha_operacion)::int AS dia_semana,
    to_char(c.fecha_operacion, 'IYYY-"W"IW')    AS semana_iso,
    to_char(c.fecha_operacion, 'YYYY-"T"Q')     AS trimestre,
    c.tipo_movimiento,
    c.direccion,
    c.numero_vuelo,
    c.folio,

    coalesce(c.aerolinea, 'SIN AEROLÍNEA')      AS aerolinea,
    c.aerolinea_codigo,
    c.aerolinea_conciliacion_id,
    c.matricula,
    c.estatus_matricula,
    coalesce(c.tipo_aeronave, c.tipo_aeronave_matricula) AS tipo_aeronave,
    c.tipo_servicio,
    c.tipo_servicio_descripcion,
    c.tipo_servicio_categoria,
    c.tipo_operacion,
    c.tipo_manifiesto,
    c.codigo_afac,

    c.endpoint_codigo,
    -- El nombre original NUNCA se pierde ni se reemplaza por el IATA: cuando
    -- el aeropuerto no se pudo identificar de forma inequívoca, endpoint_codigo
    -- queda NULL y el nombre tal como llegó de la fuente sigue disponible.
    CASE c.direccion WHEN 'A' THEN c.origen_origen ELSE c.destino_origen END AS endpoint_nombre,
    coalesce(c.endpoint_ciudad, c.endpoint_codigo,
             CASE c.direccion WHEN 'A' THEN c.origen_origen ELSE c.destino_origen END,
             'Sin identificar') AS endpoint_ciudad,
    c.escala_codigo,
    -- AIFA es el extremo fijo del movimiento. 'NLU' ya está fijado así en el
    -- resto del sistema (FORCED_AIRPORT_MAIN_CODE en js/manifiestos.js:17).
    CASE c.direccion WHEN 'A' THEN c.endpoint_codigo ELSE 'NLU' END AS origen_codigo,
    CASE c.direccion WHEN 'D' THEN c.endpoint_codigo ELSE 'NLU' END AS destino_codigo,
    CASE c.direccion
        WHEN 'A' THEN coalesce(c.endpoint_codigo, '?') || ' → NLU'
        ELSE 'NLU → ' || coalesce(c.endpoint_codigo, '?')
    END AS ruta,
    c.nacional_internacional,
    c.nacint_origen,

    c.posicion,
    c.puerta,
    c.banda,

    c.es_cancelada,
    c.cancelado_origen,

    c.segmento_aviacion,
    c.naturaleza_operacion,
    c.regla_id,
    (c.segmento_aviacion IS NOT NULL AND c.naturaleza_operacion IS NOT NULL) AS clasificada,

    -- ── Pasajeros ────────────────────────────────────────────────────────────
    c.pax,
    c.pax_programados,
    c.pax_no_abordados,
    c.pax_inadmitidos,
    c.pax_repatriados,
    c.pax_transitos,
    c.pax_conexiones,
    c.pax_infantes,
    c.pax_exentos_reportados,
    c.pax_pagan_tua_reportados,

    -- ── Capacidad y ocupación ────────────────────────────────────────────────
    coalesce(c.capacidad_operacion, c.capacidad_matricula) AS capacidad_pasajeros,
    CASE
        WHEN c.capacidad_operacion IS NOT NULL THEN 'operacion'
        WHEN c.capacidad_matricula IS NOT NULL THEN 'matricula'
        ELSE 'desconocida'
    END AS capacidad_origen,
    c.ocupacion_reportada,
    -- La operación entra al factor de ocupación sólo si tiene LAS DOS cifras:
    -- numerador y denominador se calculan sobre el mismo conjunto de filas, o
    -- el porcentaje no significa nada.
    (c.pax IS NOT NULL AND coalesce(c.capacidad_operacion, c.capacidad_matricula) IS NOT NULL) AS ocupacion_evaluable,

    -- ── Carga ────────────────────────────────────────────────────────────────
    c.carga_total_kg,
    c.carga_nacional_kg,
    c.carga_internacional_kg,
    c.carga_importacion_kg,
    c.carga_exportacion_kg,
    c.indicador_importacion,
    c.indicador_exportacion,
    c.correo_kg,
    c.equipaje_kg,
    c.carga_transito_kg,

    -- DESCARGADA / EMBARCADA. Si el desglose se capturó, manda el dato. Si no,
    -- se deriva de la carga transportada restando el tránsito conocido: en una
    -- llegada, todo lo que no siguió a bordo se bajó aquí. Cuando tampoco hay
    -- tránsito capturado la resta es un no-op y el valor iguala a la carga
    -- transportada — por eso va acompañado de carga_desglose_capturado, para
    -- que la pantalla pueda decir cuánto de la cifra es dato y cuánto deducción.
    CASE
        WHEN c.carga_descargada_kg IS NOT NULL THEN c.carga_descargada_kg
        WHEN c.direccion = 'A' AND c.carga_total_kg IS NOT NULL
            THEN greatest(c.carga_total_kg - coalesce(c.carga_transito_kg, 0), 0)
    END AS carga_descargada_kg,
    CASE
        WHEN c.carga_embarcada_kg IS NOT NULL THEN c.carga_embarcada_kg
        WHEN c.direccion = 'D' AND c.carga_total_kg IS NOT NULL
            THEN greatest(c.carga_total_kg - coalesce(c.carga_transito_kg, 0), 0)
    END AS carga_embarcada_kg,
    (c.carga_descargada_kg IS NOT NULL OR c.carga_embarcada_kg IS NOT NULL
        OR c.carga_transito_kg IS NOT NULL) AS carga_desglose_capturado,

    -- ── Rotación y atribución única del tránsito ─────────────────────────────
    --
    -- Las mismas 30 toneladas que llegan a bordo y siguen a bordo aparecen en
    -- la llegada Y en la salida. Contarlas dos veces duplicaría la estadística,
    -- así que se atribuyen a UN solo movimiento de la rotación: la llegada si
    -- la tiene capturada y, si no, el que la tenga. El otro lado recibe 0 —no
    -- NULL— para distinguir "es el otro lado de una rotación ya contada" de
    -- "no se capturó".
    c.rotacion_clave,
    c.rotacion_origen,
    CASE
        WHEN c.carga_transito_kg IS NULL THEN NULL
        WHEN c.rotacion_clave IS NULL THEN c.carga_transito_kg
        WHEN row_number() OVER (
                PARTITION BY c.rotacion_clave
                ORDER BY (c.carga_transito_kg IS NOT NULL) DESC,
                         c.es_cancelada ASC,
                         (c.direccion = 'A') DESC,
                         c.id
             ) = 1 THEN c.carga_transito_kg
        ELSE 0
    END AS transito_contable_kg,
    -- La rotación se cuenta una sola vez, en su primer movimiento, para poder
    -- reportar "cuántas rotaciones hubo" sin contar cada lado por separado.
    CASE
        WHEN c.rotacion_clave IS NULL THEN false
        ELSE row_number() OVER (PARTITION BY c.rotacion_clave ORDER BY c.direccion, c.id) = 1
    END AS es_cabeza_rotacion,

    -- TURNAROUND: se atribuye a la SALIDA, que es cuando el tiempo en tierra
    -- termina. Así nunca se cuenta dos veces por rotación.
    CASE
        WHEN c.direccion = 'D' AND c.rot_llegada IS NOT NULL AND c.rot_salida IS NOT NULL
             AND c.rot_salida > c.rot_llegada
             AND extract(epoch FROM (c.rot_salida - c.rot_llegada)) / 60.0 <= 2880
             THEN round(extract(epoch FROM (c.rot_salida - c.rot_llegada)) / 60.0)
    END AS turnaround_min,

    c.minutos_pernocta,

    -- ── Adherencia al SLOT (la medición oficial) ─────────────────────────────
    --
    --     diferencia = hora_operacion − slot_vigente
    --     slot_vigente = coalesce(slot_coordinado, slot_asignado)
    --
    --     < -15 min  ANTICIPADO   ─ fuera de ventana
    --     -15 a -1   ANTES        ┐
    --      0         EN TIEMPO    ├ cumple la ventana del slot
    --     +1 a +15   DESPUÉS      ┘
    --     > +15      DEMORA       ─ fuera de ventana
    --
    -- hora_programada NO sustituye al slot para esta clasificación. Cuando no
    -- hay slot o no hay hora de operación se toma el dictamen ya calculado en
    -- estado_puntualidad, que la fuente llena con este mismo vocabulario.
    c.slot_vigente,
    c.slot_asignado,
    c.slot_coordinado,
    CASE WHEN c.slot_coordinado IS NOT NULL THEN 'coordinado'
         WHEN c.slot_asignado IS NOT NULL THEN 'asignado' END AS slot_origen,
    c.minutos_vs_slot,
    coalesce(
        CASE
            WHEN c.minutos_vs_slot IS NULL THEN NULL
            WHEN c.minutos_vs_slot < -15 THEN 'ANTICIPADO'
            WHEN c.minutos_vs_slot <= -1 THEN 'ANTES'
            WHEN c.minutos_vs_slot = 0  THEN 'EN TIEMPO'
            WHEN c.minutos_vs_slot <= 15 THEN 'DESPUÉS'
            ELSE 'DEMORA'
        END,
        CASE public._estadistica_norm(c.estado_puntualidad)
            WHEN 'ANTICIPADO' THEN 'ANTICIPADO'
            WHEN 'ANTES'      THEN 'ANTES'
            WHEN 'ENTIEMPO'   THEN 'EN TIEMPO'
            WHEN 'DESPUES'    THEN 'DESPUÉS'
            WHEN 'DEMORA'     THEN 'DEMORA'
            WHEN 'DEMORADO'   THEN 'DEMORA'
        END
    ) AS clasificacion_slot,

    -- ── Demora operacional (concepto distinto del slot) ──────────────────────
    c.minutos_demora_calc AS minutos_demora,
    c.codigo_demora,
    c.causa_demora,
    c.motivo_operativo,
    c.demora_15_min,

    c.hora_programada,
    c.hora_operacion,
    c.hora_real,
    c.hora_attt,
    extract(hour FROM (c.hora_programada AT TIME ZONE 'America/Mexico_City'))::int AS hora_local,

    -- ── Estado del dato ──────────────────────────────────────────────────────
    c.conciliado,
    c.validado,
    c.capturado,
    c.fuente_principal
FROM clasificada c
-- WITH NO DATA: la vista se crea VACÍA y esta migración queda como puro
-- DDL, que corre en un par de segundos.
--
-- Poblarla aquí significaría resolver la clasificación por reglas una vez
-- por CADA fila de maestra_operaciones, más construir ocho índices, todo
-- dentro de la misma transacción y de la misma petición HTTP. El editor SQL
-- de Supabase corta esa petición mucho antes de que Postgres termine, y como
-- el trabajo iba dentro de una transacción, al cortarse el cliente se
-- deshace entero: "Failed to fetch" y ni un objeto creado.
--
-- El llenado va aparte, en 045_estadistica_v2_poblar.sql, como una sentencia
-- suelta que confirma sola. Si ahí el navegador se cansa, el servidor
-- termina de todos modos y el trabajo queda hecho.
WITH NO DATA;

-- Índices. El UNIQUE es obligatorio: sin él REFRESH MATERIALIZED VIEW
-- CONCURRENTLY no está permitido, y sin CONCURRENTLY cada refresco bloquea la
-- lectura del módulo entero.
CREATE UNIQUE INDEX idx_mv_estadistica_id
    ON public.mv_estadistica_operaciones (id);

CREATE INDEX idx_mv_estadistica_fecha
    ON public.mv_estadistica_operaciones (fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_periodo
    ON public.mv_estadistica_operaciones (anio, mes)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_aerolinea
    ON public.mv_estadistica_operaciones (aerolinea, fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_clasificacion
    ON public.mv_estadistica_operaciones (segmento_aviacion, naturaleza_operacion, fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_sin_clasificar
    ON public.mv_estadistica_operaciones (fecha_operacion)
    WHERE NOT clasificada AND NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_endpoint
    ON public.mv_estadistica_operaciones (endpoint_codigo, fecha_operacion)
    WHERE NOT es_cancelada;

CREATE INDEX idx_mv_estadistica_rotacion
    ON public.mv_estadistica_operaciones (rotacion_clave)
    WHERE rotacion_clave IS NOT NULL;

COMMENT ON MATERIALIZED VIEW public.mv_estadistica_operaciones IS
    'Una fila por movimiento aeroportuario, ya resuelta: clasificación por '
    'reglas (036), cancelación por bandera, nacional/internacional, capacidad, '
    'desglose y atribución única de carga en tránsito, turnaround por rotación, '
    'pernocta y demora. Fuente: vw_maestra_operaciones unida a '
    'maestra_operaciones. Se refresca con refrescar_estadistica().';

CREATE OR REPLACE VIEW public.v_estadistica_operaciones AS
SELECT * FROM public.mv_estadistica_operaciones;

COMMENT ON VIEW public.v_estadistica_operaciones IS
    'Nombre público y estable del detalle estadístico por movimiento.';

GRANT SELECT ON public.mv_estadistica_operaciones TO authenticated;
GRANT SELECT ON public.v_estadistica_operaciones  TO authenticated;


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- La vista existe y está SIN poblar: es lo esperado en este punto.
SELECT c.relname, c.relkind, c.relispopulated AS poblada
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('mv_estadistica_operaciones', 'v_estadistica_operaciones')
 ORDER BY 1;

-- Los ocho índices, con el UNIQUE que hace posible refrescar sin bloquear la
-- lectura.
SELECT indexname, indexdef LIKE 'CREATE UNIQUE%' AS es_unico
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'mv_estadistica_operaciones'
 ORDER BY 1;

-- Las columnas del esquema nuevo llegaron a la vista materializada.
-- IMPORTANTE: information_schema.columns no expone de forma fiable las columnas
-- de una MATERIALIZED VIEW en PostgreSQL. Se consulta pg_attribute directamente.
SELECT count(*) AS columnas_publicadas,
       count(*) FILTER (WHERE a.attname IN (
           'cancelado_origen', 'rotacion_clave', 'rotacion_origen', 'turnaround_min',
           'minutos_pernocta', 'capacidad_origen', 'ocupacion_reportada',
           'slot_vigente', 'slot_origen', 'minutos_vs_slot', 'clasificacion_slot',
           'nacint_origen', 'endpoint_nombre', 'carga_importacion_kg',
           'carga_exportacion_kg', 'pax_programados', 'pax_no_abordados')) AS del_esquema_nuevo
  FROM pg_attribute a
 WHERE a.attrelid = 'public.mv_estadistica_operaciones'::regclass
   AND a.attnum > 0
   AND NOT a.attisdropped;

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT y seguir con 043_estadistica_v2_agregado.sql.
-- -----------------------------------------------------------------------------
ROLLBACK;
