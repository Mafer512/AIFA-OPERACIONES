-- =============================================================================
-- 043 — Motor estadístico v2 · estadistica_agregado
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
-- REQUISITO: 042 aplicada (con COMMIT).
--
-- Va en su propio archivo porque es la función más grande del módulo: 66
-- columnas de salida y la plantilla de SQL dinámico. Crearla es instantáneo;
-- separarla es sólo para que ninguna petición cargue con demasiado.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

-- =============================================================================
-- 4) estadistica_agregado v2 — el motor
--
--    Cambia la lista de columnas devueltas, así que hay que borrar la anterior.
--    REGLA TRANSVERSAL: las operaciones CANCELADAS no cuentan en ninguna
--    métrica operacional. No se filtran de la consulta —se siguen contando
--    aparte en operaciones_canceladas, que es información útil— pero cada
--    agregado lleva su FILTER (WHERE NOT es_cancelada).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estadistica_agregado(
    p_desde       date,
    p_hasta       date,
    p_dimensiones text[] DEFAULT '{}'::text[],
    p_filtros     jsonb  DEFAULT '{}'::jsonb,
    p_limite      integer DEFAULT 5000
)
RETURNS TABLE (
    d1 text, d2 text, d3 text, d4 text,

    operaciones               bigint,
    operaciones_llegada       bigint,
    operaciones_salida        bigint,
    operaciones_canceladas    bigint,
    operaciones_nacional      bigint,
    operaciones_internacional bigint,

    pax_total          numeric,
    pax_llegada        numeric,
    pax_salida         numeric,
    pax_nacional       numeric,
    pax_internacional  numeric,
    operaciones_con_pax bigint,

    carga_total_kg          numeric,
    carga_nacional_kg       numeric,
    carga_internacional_kg  numeric,
    carga_descargada_kg     numeric,
    carga_embarcada_kg      numeric,
    carga_transito_kg       numeric,
    correo_kg               numeric,
    operaciones_con_carga   bigint,
    operaciones_con_desglose_carga bigint,

    ocupacion_pax        numeric,
    ocupacion_capacidad  numeric,
    factor_ocupacion     numeric,
    operaciones_con_ocupacion bigint,

    operaciones_puntuales  bigint,
    operaciones_demoradas  bigint,
    minutos_demora_total   numeric,
    demora_promedio        numeric,
    demora_maxima          numeric,
    demora_minima          numeric,
    operaciones_evaluables_puntualidad bigint,

    operaciones_clasificadas   bigint,
    operaciones_sin_clasificar bigint,
    operaciones_capturadas     bigint,

    -- ── v2: columnas nuevas, siempre AL FINAL ────────────────────────────────
    -- Se agregan al final a propósito: el cliente mapea por nombre, pero
    -- cualquier consumidor que lea por posición sigue viendo lo mismo que antes.
    carga_importacion_kg   numeric,
    carga_exportacion_kg   numeric,
    equipaje_kg            numeric,

    pax_programados        numeric,
    pax_no_abordados       numeric,
    pax_inadmitidos        numeric,
    pax_repatriados        numeric,
    pax_transitos          numeric,
    pax_conexiones         numeric,
    pax_exentos            numeric,
    pax_pagan_tua          numeric,
    operaciones_con_pax_programados bigint,

    operaciones_pernocta   bigint,
    minutos_pernocta_total numeric,

    turnaround_promedio_min numeric,
    turnaround_minimo_min   numeric,
    turnaround_maximo_min   numeric,
    operaciones_con_turnaround bigint,

    rotaciones             bigint,
    operaciones_conciliadas bigint,
    operaciones_validadas   bigint,

    -- Adherencia al slot, con el vocabulario oficial completo.
    operaciones_anticipadas   bigint,
    operaciones_antes         bigint,
    operaciones_en_tiempo     bigint,
    operaciones_despues       bigint,
    operaciones_con_slot      bigint,
    minutos_vs_slot_promedio  numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    -- Lista blanca de dimensiones. La clave es lo que manda el cliente; el
    -- valor es la expresión SQL. Nada fuera de este mapa llega al SQL: lo único
    -- dinámico de esta función son estos nombres, ya validados. Los VALORES
    -- viajan siempre como parámetros ($1..$4), nunca interpolados.
    v_mapa   jsonb := jsonb_build_object(
        'anio',                   'm.anio::text',
        'mes',                    'lpad(m.mes::text, 2, ''0'')',
        'anio_mes',               'm.anio::text || ''-'' || lpad(m.mes::text, 2, ''0'')',
        'trimestre',              'm.trimestre',
        'fecha',                  'm.fecha_operacion::text',
        'semana',                 'm.semana_iso',
        'dia_semana',             'm.dia_semana::text',
        'hora',                   'lpad(m.hora_local::text, 2, ''0'')',
        'direccion',              'm.direccion',
        'tipo_movimiento',        'm.tipo_movimiento',
        'aerolinea',              'm.aerolinea',
        'aerolinea_codigo',       'm.aerolinea_codigo',
        'matricula',              'm.matricula',
        'estatus_matricula',      'm.estatus_matricula',
        'tipo_aeronave',          'm.tipo_aeronave',
        'tipo_servicio',          'm.tipo_servicio',
        'tipo_operacion',         'm.tipo_operacion',
        'codigo_afac',            'm.codigo_afac',
        'segmento_aviacion',      'coalesce(m.segmento_aviacion, ''SIN CLASIFICAR'')',
        'naturaleza_operacion',   'coalesce(m.naturaleza_operacion, ''SIN CLASIFICAR'')',
        'nacional_internacional', 'coalesce(m.nacional_internacional, ''Sin determinar'')',
        'origen',                 'm.origen_codigo',
        'destino',                'm.destino_codigo',
        'endpoint',               'm.endpoint_codigo',
        'ciudad',                 'm.endpoint_ciudad',
        'escala',                 'm.escala_codigo',
        'ruta',                   'm.ruta',
        'posicion',               'm.posicion',
        'puerta',                 'm.puerta',
        'banda',                  'm.banda',
        'codigo_demora',          'm.codigo_demora',
        'causa_demora',           'm.causa_demora',
        'motivo_operativo',       'm.motivo_operativo',
        'fuente',                 'm.fuente_principal',
        'capacidad_origen',       'm.capacidad_origen',
        'rotacion_origen',        'm.rotacion_origen',
        'clasificacion_slot',     'coalesce(m.clasificacion_slot, ''SIN SLOT'')',
        'slot_origen',            'coalesce(m.slot_origen, ''sin slot'')',
        'nacint_origen',          'm.nacint_origen',
        'conciliado',             'CASE WHEN m.conciliado THEN ''Conciliada'' ELSE ''Sin conciliar'' END',
        'cancelado_origen',       'coalesce(m.cancelado_origen, ''No cancelada'')'
    );
    v_dims   text[] := '{}';
    v_dim    text;
    v_select text;
    v_group  text;
    v_sql    text;
BEGIN
    IF public.estadistica_access_level(auth.uid()) = 'none' THEN
        RAISE EXCEPTION 'Acceso denegado al módulo estadístico.' USING ERRCODE = '42501';
    END IF;

    IF p_desde IS NULL OR p_hasta IS NULL THEN
        RAISE EXCEPTION 'estadistica_agregado requiere p_desde y p_hasta.' USING ERRCODE = '22004';
    END IF;
    IF p_hasta < p_desde THEN
        RAISE EXCEPTION 'El rango de fechas está invertido (% > %).', p_desde, p_hasta
            USING ERRCODE = '22007';
    END IF;

    FOREACH v_dim IN ARRAY coalesce(p_dimensiones, '{}'::text[]) LOOP
        IF NOT (v_mapa ? v_dim) THEN
            RAISE EXCEPTION 'Dimensión no reconocida: %. Válidas: %',
                v_dim, (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_mapa) k)
                USING ERRCODE = '22023';
        END IF;
        v_dims := v_dims || (v_mapa ->> v_dim);
        EXIT WHEN array_length(v_dims, 1) >= 4;
    END LOOP;

    v_select := concat_ws(', ',
        coalesce(v_dims[1], 'NULL::text') || ' AS d1',
        coalesce(v_dims[2], 'NULL::text') || ' AS d2',
        coalesce(v_dims[3], 'NULL::text') || ' AS d3',
        coalesce(v_dims[4], 'NULL::text') || ' AS d4'
    );
    v_group := CASE
        WHEN array_length(v_dims, 1) IS NULL THEN ''
        ELSE 'GROUP BY ' || (
            SELECT string_agg(i::text, ', ') FROM generate_series(1, array_length(v_dims, 1)) i
        )
    END;

    v_sql := format($q$
        SELECT %s,

            count(*) FILTER (WHERE NOT m.es_cancelada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D')::bigint,
            count(*) FILTER (WHERE m.es_cancelada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Nacional')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Internacional')::bigint,

            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A'))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D'))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Nacional'))::numeric,
            (sum(m.pax) FILTER (WHERE NOT m.es_cancelada AND m.nacional_internacional = 'Internacional'))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.pax IS NOT NULL)::bigint,

            (sum(m.carga_total_kg)         FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_nacional_kg)      FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_internacional_kg) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_descargada_kg)    FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'A'))::numeric,
            (sum(m.carga_embarcada_kg)     FILTER (WHERE NOT m.es_cancelada AND m.direccion = 'D'))::numeric,
            (sum(m.transito_contable_kg)   FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.correo_kg)              FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.carga_total_kg IS NOT NULL AND m.carga_total_kg > 0)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.carga_desglose_capturado)::bigint,

            (sum(m.pax)                 FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric,
            (sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric,
            -- Factor de ocupación: SUM(pax)/SUM(capacidad), NO el promedio de
            -- los cocientes por fila. El cast va DESPUÉS del FILTER y entre
            -- paréntesis: sum(x)::numeric FILTER (...) es error de sintaxis.
            CASE
                WHEN coalesce(sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable), 0) > 0
                THEN round(
                    100.0 * (sum(m.pax)                 FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric
                          / (sum(m.capacidad_pasajeros) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable))::numeric
                , 2)
            END::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.ocupacion_evaluable)::bigint,

            -- "Puntual" = CUMPLE LA VENTANA DEL SLOT: ANTES, EN TIEMPO o
            -- DESPUÉS. ANTICIPADO también queda fuera de ventana, aunque el
            -- vuelo se haya adelantado: el permiso es una ventana, no un techo.
            count(*) FILTER (WHERE NOT m.es_cancelada
                             AND m.clasificacion_slot IN ('ANTES', 'EN TIEMPO', 'DESPUÉS'))::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'DEMORA')::bigint,
            (sum(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada AND m.minutos_demora > 0))::numeric,
            round(avg(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada), 2)::numeric,
            (max(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (min(m.minutos_demora) FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND NOT m.clasificada)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.capturado)::bigint,

            (sum(m.carga_importacion_kg) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.carga_exportacion_kg) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.equipaje_kg)          FILTER (WHERE NOT m.es_cancelada))::numeric,

            (sum(m.pax_programados)          FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_no_abordados)         FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_inadmitidos)          FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_repatriados)          FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_transitos)            FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_conexiones)           FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_exentos_reportados)   FILTER (WHERE NOT m.es_cancelada))::numeric,
            (sum(m.pax_pagan_tua_reportados) FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.pax_programados IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.minutos_pernocta IS NOT NULL)::bigint,
            (sum(m.minutos_pernocta) FILTER (WHERE NOT m.es_cancelada))::numeric,

            round(avg(m.turnaround_min) FILTER (WHERE NOT m.es_cancelada), 2)::numeric,
            (min(m.turnaround_min) FILTER (WHERE NOT m.es_cancelada))::numeric,
            (max(m.turnaround_min) FILTER (WHERE NOT m.es_cancelada))::numeric,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.turnaround_min IS NOT NULL)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.es_cabeza_rotacion)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.conciliado)::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.validado)::bigint,

            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'ANTICIPADO')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'ANTES')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'EN TIEMPO')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.clasificacion_slot = 'DESPUÉS')::bigint,
            count(*) FILTER (WHERE NOT m.es_cancelada AND m.slot_vigente IS NOT NULL)::bigint,
            round(avg(m.minutos_vs_slot) FILTER (WHERE NOT m.es_cancelada), 2)::numeric

        FROM public.mv_estadistica_operaciones m
        WHERE m.fecha_operacion >= $1
          AND m.fecha_operacion <= $2
          AND public._estadistica_filtro_ok(m.aerolinea,              $3 -> 'aerolinea')
          AND public._estadistica_filtro_ok(m.matricula,              $3 -> 'matricula')
          AND public._estadistica_filtro_ok(m.tipo_aeronave,          $3 -> 'tipo_aeronave')
          AND public._estadistica_filtro_ok(m.tipo_servicio,          $3 -> 'tipo_servicio')
          AND public._estadistica_filtro_ok(m.direccion,              $3 -> 'direccion')
          AND public._estadistica_filtro_ok(m.nacional_internacional, $3 -> 'nacional_internacional')
          AND public._estadistica_filtro_ok(m.segmento_aviacion,      $3 -> 'segmento_aviacion')
          AND public._estadistica_filtro_ok(m.naturaleza_operacion,   $3 -> 'naturaleza_operacion')
          AND public._estadistica_filtro_ok(m.origen_codigo,          $3 -> 'origen')
          AND public._estadistica_filtro_ok(m.destino_codigo,         $3 -> 'destino')
          AND public._estadistica_filtro_ok(m.endpoint_codigo,        $3 -> 'endpoint')
          AND public._estadistica_filtro_ok(m.posicion,               $3 -> 'posicion')
          AND public._estadistica_filtro_ok(m.puerta,                 $3 -> 'puerta')
          AND public._estadistica_filtro_ok(m.banda,                  $3 -> 'banda')
          AND public._estadistica_filtro_ok(m.tipo_operacion,         $3 -> 'tipo_operacion')
          AND public._estadistica_filtro_ok(m.motivo_operativo,       $3 -> 'motivo_operativo')
          AND public._estadistica_filtro_ok(m.codigo_demora,          $3 -> 'codigo_demora')
          AND public._estadistica_filtro_ok(m.fuente_principal,       $3 -> 'fuente')
          AND public._estadistica_filtro_ok(m.clasificacion_slot,     $3 -> 'clasificacion_slot')
        %s
        ORDER BY 1, 2, 3, 4
        LIMIT $4
    $q$, v_select, v_group);

    RETURN QUERY EXECUTE v_sql
        USING p_desde, p_hasta, coalesce(p_filtros, '{}'::jsonb), greatest(coalesce(p_limite, 5000), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.estadistica_agregado(date, date, text[], jsonb, integer) IS
    'Motor único de agregación del módulo estadístico (v2). Agrupa por hasta 4 '
    'dimensiones de lista blanca y devuelve operaciones, pasajeros, carga, '
    'ocupación, puntualidad, turnaround, pernocta y cobertura de datos. Las '
    'canceladas se reportan aparte y no entran en ninguna otra métrica.';


-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- La función existe con su firma, y declara las 66 columnas del motor.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       array_length(p.proallargtypes, 1) - p.pronargs AS columnas_devueltas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'estadistica_agregado';

-- -----------------------------------------------------------------------------
-- Cambiar por COMMIT y seguir con 044_estadistica_v2_funciones.sql.
-- -----------------------------------------------------------------------------
ROLLBACK;
