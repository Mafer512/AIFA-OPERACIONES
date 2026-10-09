-- =============================================================================
-- 063c · estadistica_ajustada: totales oficiales exactos, desglose real
--
-- REQUISITOS: 062b con "FIN: OK"; 063b aplicada (cifras_oficiales llena).
-- REVERSA:    063c_reversa_estadistica_ajustada.sql
-- SEGUIMIENTO (solo lectura): 063c_seguimiento.sql
--
-- Selecciona todo y Run. Las tablas y funciones se crean al instante; el
-- primer reparto y su verificación los hace pg_cron en UNA transacción
-- (bloque DO con EXCEPTION): o queda todo, o nada, y _mig_paso_log dice el
-- paso y el error. Termina en "FIN: OK". Sólo si termina bien se agenda el
-- refresco cada 10 minutos. Se puede volver a correr.
--
-- QUÉ HACE
--   Una fila por operación (grano por fila):
--     · manifiestos_hechos con AEROLINEA → segmento COMERCIAL o CARGA (es_carga)
--     · aviacion_general_operaciones ACTIVO → segmento GENERAL, en su fecha de
--       conteo por rotación (la misma regla que totales_detalle_por_dia / FBO).
--   Medidas reales de la operación NO cancelada:
--     ops_real = 1 · pax_real = pasajeros (COMERCIAL, GENERAL) · ton_real =
--     toneladas (CARGA). Lo que no tiene cifra oficial queda aparte y no se
--     escala: pax_sin_oficial (pasajeros en vuelos de carga) y
--     ton_sin_oficial (carga en vuelos de pasajeros). Canceladas: todo en 0;
--     se siguen contando reales desde manifiestos_hechos.
--   Por cada (mes, segmento) con cifra oficial y mes completo <= corte
--   oficial (fn_fecha_corte_oficial):
--     factor = oficial / Σ real   (operaciones, pasajeros y toneladas, cada
--     uno con el suyo) y *_ajustad* = real × factor, en numeric SIN redondear.
--     Se redondea sólo al presentar. Σ ajustado por mes/segmento = oficial
--     (tolerancia < 0.001).
--   Casos borde:
--     · oficial > 0 y Σ real = 0 → NO se inventa: ajustado 0 y aviso
--       'SIN DATOS (…)' en estadistica_ajustada_mes.
--     · oficial = 0 con datos → factor 0 (queda en 0).
--     · meses sin cifra oficial o posteriores al corte → factor 1 (real).
--   Ocupación y puntualidad NO están aquí: se calculan con datos reales.
--
-- REFRESCO (estadistica_ajustada_refrescar, cada 10 min, minutos 5,15,…):
--   rehace los meses posteriores a fn_fecha_corte_maestra() (Conciliación y
--   AG reciente). Si cambia la historia (maestra, AG anterior al corte,
--   cifras_oficiales o los cortes de config_fuentes) rehace todo.
--
-- No modifica manifiestos_hechos, maestra_manifiestos, "Conciliación
-- Manifiestos", aviacion_general_operaciones, cifras_oficiales_mensuales ni
-- nada del Informe oficial: sólo los lee.
-- =============================================================================

DO $pre$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron no está habilitado.';
    END IF;
    IF to_regclass('public.cifras_oficiales') IS NULL OR NOT EXISTS (SELECT 1 FROM public.cifras_oficiales) THEN
        RAISE EXCEPTION 'Falta la 063b (cifras_oficiales vacía o inexistente).';
    END IF;
    IF to_regclass('public.manifiestos_hechos') IS NULL
       OR to_regprocedure('public.fn_fecha_corte_maestra()') IS NULL
       OR to_regprocedure('public.fn_fecha_corte_oficial()') IS NULL
       OR to_regprocedure('public.aviacion_general_ancla(integer, text, date)') IS NULL THEN
        RAISE EXCEPTION 'Faltan manifiestos_hechos, los cortes (062b) o aviacion_general_ancla (047).';
    END IF;
    IF public.fn_fecha_corte_oficial() IS NULL OR public.fn_fecha_corte_maestra() IS NULL THEN
        RAISE EXCEPTION 'config_fuentes debe tener fecha_corte_oficial y fecha_corte_maestra.';
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job
                WHERE jobname IN ('mig_062b_frontera', 'mig_062b_reversa', 'mig_manifiestos_hechos', 'mig_063c_ajustada')) THEN
        RAISE EXCEPTION 'Ya hay una migración en la agenda de pg_cron; espera a que termine.';
    END IF;
END;
$pre$;

BEGIN;
SET LOCAL lock_timeout = '15s';

-- ── Tablas ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estadistica_ajustada (
    origen           text        NOT NULL CHECK (origen IN ('MANIFIESTO', 'AG')),
    id_origen        bigint      NOT NULL,   -- manifiestos_hechos.id | aviacion_general_operaciones.id
    segmento         text        NOT NULL CHECK (segmento IN ('COMERCIAL', 'CARGA', 'GENERAL')),
    fecha            date        NOT NULL,   -- fecha en que cuenta (fecha_reporte / conteo AG)
    anio             smallint    NOT NULL,
    mes              smallint    NOT NULL,
    cancelado        boolean     NOT NULL,
    ops_real         numeric     NOT NULL,
    pax_real         numeric     NOT NULL,
    ton_real         numeric     NOT NULL,
    pax_sin_oficial  numeric     NOT NULL,   -- pasajeros en vuelos de carga (real, sin cifra oficial)
    ton_sin_oficial  numeric     NOT NULL,   -- carga en vuelos de pasajeros (real, sin cifra oficial)
    factor_ops       numeric     NOT NULL,
    factor_pax       numeric     NOT NULL,
    factor_ton       numeric     NOT NULL,
    ops_ajustadas    numeric     NOT NULL,
    pax_ajustados    numeric     NOT NULL,
    ton_ajustadas    numeric     NOT NULL,
    regla            text        NOT NULL CHECK (regla IN ('OFICIAL', 'REAL')),
    calculado_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origen, id_origen)
);
CREATE INDEX IF NOT EXISTS idx_estadistica_ajustada_fecha ON public.estadistica_ajustada (fecha);
CREATE INDEX IF NOT EXISTS idx_estadistica_ajustada_mes   ON public.estadistica_ajustada (anio, mes, segmento);

COMMENT ON TABLE public.estadistica_ajustada IS
    'Una fila por operación (manifiestos_hechos con AEROLINEA y aviacion_general_operaciones ACTIVO). '
    '*_ajustad* = real × factor del (mes, segmento): suman exacto cifras_oficiales en meses oficiales; '
    'factor 1 fuera de ellos. numeric sin redondear: se redondea al presentar (063c).';

CREATE TABLE IF NOT EXISTS public.estadistica_ajustada_mes (
    anio             smallint    NOT NULL,
    mes              smallint    NOT NULL,
    segmento         text        NOT NULL,
    regla            text        NOT NULL,
    oficial_ops      numeric,
    oficial_pax      numeric,
    oficial_ton      numeric,
    real_ops         numeric     NOT NULL,
    real_pax         numeric     NOT NULL,
    real_ton         numeric     NOT NULL,
    pax_sin_oficial  numeric     NOT NULL,
    ton_sin_oficial  numeric     NOT NULL,
    filas            bigint      NOT NULL,
    factor_ops       numeric     NOT NULL,
    factor_pax       numeric     NOT NULL,
    factor_ton       numeric     NOT NULL,
    aviso            text,
    calculado_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (anio, mes, segmento)
);
COMMENT ON TABLE public.estadistica_ajustada_mes IS
    'Por (mes, segmento): oficial, Σ real, factores y aviso (SIN DATOS cuando hay oficial > 0 sin detalle) (063c).';

CREATE TABLE IF NOT EXISTS public.estadistica_ajustada_control (
    id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
    pendiente_completo  boolean NOT NULL DEFAULT true,
    firma_historia      text,
    refrescado_at       timestamptz,
    duracion_ms         integer,
    detalle             jsonb
);
INSERT INTO public.estadistica_ajustada_control (id, pendiente_completo) VALUES (true, true)
ON CONFLICT (id) DO UPDATE SET pendiente_completo = true;

ALTER TABLE public.estadistica_ajustada         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estadistica_ajustada_mes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estadistica_ajustada_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.estadistica_ajustada, public.estadistica_ajustada_mes, public.estadistica_ajustada_control
    FROM anon, authenticated;

-- ── Firma de la historia: si cambia, el refresco rehace todo ─────────────
CREATE OR REPLACE FUNCTION public._ea_firma_historia()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
    SELECT md5(concat_ws('|',
        (SELECT count(*)::text || ':' || coalesce(max(h.actualizado_at)::text, '')
           FROM public.manifiestos_hechos h
          WHERE h.fecha_reporte <= public.fn_fecha_corte_maestra()),
        (SELECT md5(coalesce(string_agg(concat_ws(',', o.id, o.fecha_operacion, o.folio_rotacion, o.matricula,
                                                  o.tipo_operacion, o.pax_ag, o.estatus_registro), ';' ORDER BY o.id), ''))
           FROM public.aviacion_general_operaciones o
          WHERE o.fecha_operacion <= public.fn_fecha_corte_maestra()),
        (SELECT md5(coalesce(string_agg(concat_ws(',', c.anio, c.mes, c.segmento, c.operaciones, c.pasajeros, c.toneladas),
                                        ';' ORDER BY c.anio, c.mes, c.segmento), ''))
           FROM public.cifras_oficiales c),
        public.fn_fecha_corte_oficial()::text,
        public.fn_fecha_corte_maestra()::text))
$fn$;

-- ── Reparto de un rango de meses (NULL, NULL = todo) ─────────────────────
CREATE OR REPLACE FUNCTION public.estadistica_ajustada_rehacer(p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET max_parallel_workers_per_gather = 0
AS $fn$
DECLARE
    v_ini     date := date_trunc('month', coalesce(p_desde, DATE '2000-01-01'))::date;
    v_fin     date := (date_trunc('month', coalesce(p_hasta, DATE '2100-12-01')) + interval '1 month - 1 day')::date;
    v_corte   date := public.fn_fecha_corte_oficial();
    v_movidas bigint;
    v_filas   bigint;
    v_avisos  text;
BEGIN
    IF v_corte IS NULL THEN
        RAISE EXCEPTION 'Falta fecha_corte_oficial en config_fuentes.';
    END IF;
    IF v_fin < v_ini THEN
        RAISE EXCEPTION 'Rango inválido: % a %.', p_desde, p_hasta;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('estadistica_ajustada')::bigint);

    DROP TABLE IF EXISTS pg_temp._ea_base, pg_temp._ea_mes;

    -- Una fila por operación del rango, con sus medidas reales.
    CREATE TEMP TABLE _ea_base ON COMMIT DROP AS
    SELECT 'MANIFIESTO'::text                                            AS origen,
           h.id                                                          AS id_origen,
           CASE WHEN h.es_carga THEN 'CARGA' ELSE 'COMERCIAL' END        AS segmento,
           h.fecha_reporte                                               AS fecha,
           h.cancelado,
           (CASE WHEN h.cancelado THEN 0 ELSE 1 END)::numeric            AS ops_real,
           (CASE WHEN h.cancelado OR h.es_carga THEN 0
                 ELSE coalesce(h.pax, 0) END)::numeric                   AS pax_real,
           (CASE WHEN h.cancelado OR NOT h.es_carga THEN 0
                 ELSE coalesce(h.carga_kg, 0) / 1000 END)::numeric       AS ton_real,
           (CASE WHEN NOT h.cancelado AND h.es_carga
                 THEN coalesce(h.pax, 0) ELSE 0 END)::numeric            AS pax_sin_oficial,
           (CASE WHEN NOT h.cancelado AND NOT h.es_carga
                 THEN coalesce(h.carga_kg, 0) / 1000 ELSE 0 END)::numeric AS ton_sin_oficial
      FROM public.manifiestos_hechos h
     WHERE h.es_operacion
       AND h.fecha_reporte BETWEEN v_ini AND v_fin
    UNION ALL
    SELECT 'AG', g.id, 'GENERAL', g.fecha_conteo, false,
           1::numeric, coalesce(g.pax_ag, 0)::numeric, 0::numeric, 0::numeric, 0::numeric
      FROM (
        -- Misma regla que totales_detalle_por_dia (062b) y aviacion_general_resumen.
        SELECT o.id, o.pax_ag,
               CASE
                   WHEN o.tipo_operacion = 'LLEGADA' THEN o.fecha_operacion
                   WHEN extract(year FROM o.fecha_operacion)::int IN (2024, 2025)
                     OR extract(year FROM a.ancla)::int IN (2024, 2025) THEN o.fecha_operacion
                   ELSE a.ancla
               END AS fecha_conteo
          FROM public.aviacion_general_operaciones o
         CROSS JOIN LATERAL (
               SELECT public.aviacion_general_ancla(o.folio_rotacion, o.matricula, o.fecha_operacion) AS ancla
         ) a
         WHERE o.estatus_registro = 'ACTIVO'
           AND o.fecha_operacion BETWEEN v_ini AND v_fin + 60
      ) g
     WHERE g.fecha_conteo BETWEEN v_ini AND v_fin;

    -- Por (mes, segmento): Σ real contra la cifra oficial y el factor. FULL
    -- JOIN: también salen los meses con oficial y sin ningún detalle.
    CREATE TEMP TABLE _ea_mes ON COMMIT DROP AS
    SELECT x.*,
           CASE WHEN x.regla = 'REAL' THEN 1::numeric
                WHEN x.real_ops > 0 THEN x.oficial_ops::numeric(38,20) / x.real_ops
                ELSE 0::numeric END                                      AS factor_ops,
           CASE WHEN x.regla = 'REAL' OR x.oficial_pax IS NULL THEN 1::numeric
                WHEN x.real_pax > 0 THEN x.oficial_pax::numeric(38,20) / x.real_pax
                ELSE 0::numeric END                                      AS factor_pax,
           CASE WHEN x.regla = 'REAL' OR x.oficial_ton IS NULL THEN 1::numeric
                WHEN x.real_ton > 0 THEN x.oficial_ton::numeric(38,20) / x.real_ton
                ELSE 0::numeric END                                      AS factor_ton,
           nullif(concat_ws(' · ',
               CASE WHEN x.regla = 'OFICIAL' AND x.oficial_ops > 0 AND x.real_ops = 0 THEN 'SIN DATOS (ops)' END,
               CASE WHEN x.regla = 'OFICIAL' AND x.oficial_pax > 0 AND x.real_pax = 0 THEN 'SIN DATOS (pax)' END,
               CASE WHEN x.regla = 'OFICIAL' AND x.oficial_ton > 0 AND x.real_ton = 0 THEN 'SIN DATOS (ton)' END),
               '')                                                       AS aviso
      FROM (
        SELECT coalesce(r.anio, o.anio)                       AS anio,
               coalesce(r.mes, o.mes)                         AS mes,
               coalesce(r.segmento, o.segmento)               AS segmento,
               CASE WHEN o.segmento IS NOT NULL THEN 'OFICIAL' ELSE 'REAL' END AS regla,
               o.operaciones::numeric                         AS oficial_ops,
               o.pasajeros::numeric                           AS oficial_pax,
               o.toneladas::numeric                           AS oficial_ton,
               coalesce(r.ops, 0)                             AS real_ops,
               coalesce(r.pax, 0)                             AS real_pax,
               coalesce(r.ton, 0)                             AS real_ton,
               coalesce(r.pax_so, 0)                          AS pax_sin_oficial,
               coalesce(r.ton_so, 0)                          AS ton_sin_oficial,
               coalesce(r.filas, 0)                           AS filas
          FROM (
            SELECT extract(year FROM b.fecha)::smallint  AS anio,
                   extract(month FROM b.fecha)::smallint AS mes,
                   b.segmento,
                   sum(b.ops_real) AS ops, sum(b.pax_real) AS pax, sum(b.ton_real) AS ton,
                   sum(b.pax_sin_oficial) AS pax_so, sum(b.ton_sin_oficial) AS ton_so, count(*) AS filas
              FROM pg_temp._ea_base b
             GROUP BY 1, 2, 3
          ) r
          FULL JOIN (
            SELECT c.*
              FROM public.cifras_oficiales c
             WHERE make_date(c.anio, c.mes, 1) BETWEEN v_ini AND v_fin
               AND (make_date(c.anio, c.mes, 1) + interval '1 month - 1 day')::date <= v_corte
          ) o ON o.anio = r.anio AND o.mes = r.mes AND o.segmento = r.segmento
      ) x;

    -- Lo del rango se reescribe completo. Una operación que antes contaba en
    -- un mes FUERA del rango y ahora cae dentro deja desajustado aquel mes:
    -- se marca para que el próximo refresco rehaga todo.
    DELETE FROM public.estadistica_ajustada e
     USING pg_temp._ea_base b
     WHERE e.origen = b.origen AND e.id_origen = b.id_origen
       AND e.fecha NOT BETWEEN v_ini AND v_fin;
    GET DIAGNOSTICS v_movidas = ROW_COUNT;
    IF v_movidas > 0 THEN
        UPDATE public.estadistica_ajustada_control SET pendiente_completo = true WHERE id;
    END IF;

    DELETE FROM public.estadistica_ajustada e WHERE e.fecha BETWEEN v_ini AND v_fin;

    INSERT INTO public.estadistica_ajustada (
        origen, id_origen, segmento, fecha, anio, mes, cancelado,
        ops_real, pax_real, ton_real, pax_sin_oficial, ton_sin_oficial,
        factor_ops, factor_pax, factor_ton, ops_ajustadas, pax_ajustados, ton_ajustadas,
        regla, calculado_at)
    SELECT b.origen, b.id_origen, b.segmento, b.fecha, m.anio, m.mes, b.cancelado,
           b.ops_real, b.pax_real, b.ton_real, b.pax_sin_oficial, b.ton_sin_oficial,
           m.factor_ops, m.factor_pax, m.factor_ton,
           b.ops_real * m.factor_ops, b.pax_real * m.factor_pax, b.ton_real * m.factor_ton,
           m.regla, now()
      FROM pg_temp._ea_base b
      JOIN pg_temp._ea_mes m
        ON m.anio = extract(year FROM b.fecha)::smallint
       AND m.mes = extract(month FROM b.fecha)::smallint
       AND m.segmento = b.segmento;
    GET DIAGNOSTICS v_filas = ROW_COUNT;

    DELETE FROM public.estadistica_ajustada_mes m WHERE make_date(m.anio, m.mes, 1) BETWEEN v_ini AND v_fin;
    INSERT INTO public.estadistica_ajustada_mes (
        anio, mes, segmento, regla, oficial_ops, oficial_pax, oficial_ton, real_ops, real_pax, real_ton,
        pax_sin_oficial, ton_sin_oficial, filas, factor_ops, factor_pax, factor_ton, aviso, calculado_at)
    SELECT anio, mes, segmento, regla, oficial_ops, oficial_pax, oficial_ton, real_ops, real_pax, real_ton,
           pax_sin_oficial, ton_sin_oficial, filas, factor_ops, factor_pax, factor_ton, aviso, now()
      FROM pg_temp._ea_mes;

    SELECT string_agg(format('%s-%s %s: %s', m.anio, lpad(m.mes::text, 2, '0'), m.segmento, m.aviso), ' · '
                      ORDER BY m.anio, m.mes, m.segmento)
      INTO v_avisos
      FROM pg_temp._ea_mes m
     WHERE m.aviso IS NOT NULL;

    DROP TABLE IF EXISTS pg_temp._ea_base, pg_temp._ea_mes;

    RETURN jsonb_build_object(
        'desde', v_ini, 'hasta', v_fin, 'corte_oficial', v_corte,
        'filas', v_filas, 'movidas_de_mes', v_movidas, 'avisos', v_avisos);
END;
$fn$;

COMMENT ON FUNCTION public.estadistica_ajustada_rehacer(date, date) IS
    'Rehace estadistica_ajustada y estadistica_ajustada_mes en los meses del rango (NULL, NULL = todo). '
    'Factor por (mes, segmento) = oficial / Σ real en meses oficiales; 1 en los demás (063c).';

-- ── Refresco (pg_cron) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.estadistica_ajustada_refrescar()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET max_parallel_workers_per_gather = 0
AS $fn$
DECLARE
    v_inicio   timestamptz := clock_timestamp();
    v_firma    text;
    v_ctl      record;
    v_completo boolean;
    v_r        jsonb;
    v_ms       integer;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('estadistica_ajustada')::bigint) THEN
        RETURN jsonb_build_object('omitido', 'otro reparto en curso');
    END IF;

    v_firma := public._ea_firma_historia();
    SELECT * INTO v_ctl FROM public.estadistica_ajustada_control WHERE id;
    v_completo := coalesce(v_ctl.pendiente_completo, true) OR v_ctl.firma_historia IS DISTINCT FROM v_firma;

    IF v_completo THEN
        v_r := public.estadistica_ajustada_rehacer(NULL, NULL);
    ELSE
        v_r := public.estadistica_ajustada_rehacer(public.fn_fecha_corte_maestra() + 1, NULL);
    END IF;
    v_ms := (extract(epoch FROM clock_timestamp() - v_inicio) * 1000)::int;

    UPDATE public.estadistica_ajustada_control
       SET refrescado_at      = now(),
           duracion_ms        = v_ms,
           detalle            = v_r || jsonb_build_object('completo', v_completo),
           firma_historia     = CASE WHEN v_completo THEN v_firma ELSE firma_historia END,
           pendiente_completo = CASE WHEN v_completo THEN false ELSE pendiente_completo END
     WHERE id;

    RETURN v_r || jsonb_build_object('completo', v_completo, 'duracion_ms', v_ms);
END;
$fn$;

COMMENT ON FUNCTION public.estadistica_ajustada_refrescar() IS
    'pg_cron cada 10 min: rehace los meses posteriores a fn_fecha_corte_maestra(); todo si cambió la '
    'historia, cifras_oficiales o los cortes (063c).';

REVOKE ALL ON FUNCTION public._ea_firma_historia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.estadistica_ajustada_rehacer(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.estadistica_ajustada_refrescar() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── Primer reparto + verificación (pg_cron, todo o nada) ─────────────────
DELETE FROM public._mig_paso_log;

SELECT cron.schedule(
    'mig_063c_ajustada',
    '* * * * *',
    $job$
SELECT cron.unschedule('mig_063c_ajustada');
SET statement_timeout = 0;
SET lock_timeout = '120s';
SET max_parallel_workers_per_gather = 0;
DO $do$
DECLARE
    _paso text := 'E63 0 inicio';
    _ini  timestamptz := clock_timestamp();
    _r    jsonb;
    _n    bigint;
    _n2   bigint;
    _txt  text;
BEGIN
    _paso := 'E63 1 reparto completo';
    _ini := clock_timestamp();
    UPDATE public.estadistica_ajustada_control SET pendiente_completo = true WHERE id;
    _r := public.estadistica_ajustada_refrescar();
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle) VALUES (_paso, _ini, clock_timestamp(), _r::text);

    _paso := 'E63 2 verificación';
    _ini := clock_timestamp();

    -- Toda operación de manifiestos_hechos está, una sola vez.
    SELECT count(*) INTO _n  FROM public.manifiestos_hechos WHERE es_operacion;
    SELECT count(*) INTO _n2 FROM public.estadistica_ajustada WHERE origen = 'MANIFIESTO';
    IF _n <> _n2 THEN
        RAISE EXCEPTION 'manifiestos_hechos tiene % operaciones y estadistica_ajustada % filas de manifiesto.', _n, _n2;
    END IF;

    -- Σ ajustado = oficial (< 0.001) en cada (mes, segmento) oficial, salvo
    -- la medida marcada SIN DATOS (no se inventa).
    SELECT string_agg(format('%s-%s %s: ops %s/%s pax %s/%s ton %s/%s',
                             x.anio, x.mes, x.segmento, round(x.ops, 4), x.oficial_ops,
                             round(x.pax, 4), x.oficial_pax, round(x.ton, 4), x.oficial_ton), ' · ')
      INTO _txt
      FROM (
        SELECT m.anio, m.mes, m.segmento, m.oficial_ops, m.oficial_pax, m.oficial_ton,
               coalesce(m.aviso, '') AS aviso,
               coalesce(s.ops, 0) AS ops, coalesce(s.pax, 0) AS pax, coalesce(s.ton, 0) AS ton
          FROM public.estadistica_ajustada_mes m
          LEFT JOIN (SELECT anio, mes, segmento, sum(ops_ajustadas) AS ops,
                            sum(pax_ajustados) AS pax, sum(ton_ajustadas) AS ton
                       FROM public.estadistica_ajustada GROUP BY 1, 2, 3) s
            ON s.anio = m.anio AND s.mes = m.mes AND s.segmento = m.segmento
         WHERE m.regla = 'OFICIAL'
      ) x
     WHERE (abs(x.ops - x.oficial_ops) >= 0.001 AND x.aviso NOT LIKE '%(ops)%')
        OR (x.oficial_pax IS NOT NULL AND abs(x.pax - x.oficial_pax) >= 0.001 AND x.aviso NOT LIKE '%(pax)%')
        OR (x.oficial_ton IS NOT NULL AND abs(x.ton - x.oficial_ton) >= 0.001 AND x.aviso NOT LIKE '%(ton)%');
    IF _txt IS NOT NULL THEN
        RAISE EXCEPTION 'Σ ajustado no iguala lo oficial: %', _txt;
    END IF;

    -- Informativo (no aborta): meses con oficial y sin detalle.
    SELECT string_agg(format('%s-%s %s: %s', anio, lpad(mes::text, 2, '0'), segmento, aviso), ' · '
                      ORDER BY anio, mes, segmento)
      INTO _txt
      FROM public.estadistica_ajustada_mes WHERE aviso IS NOT NULL;
    SELECT count(*) INTO _n FROM public.estadistica_ajustada WHERE origen = 'AG';
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(),
            'OK · filas AG ' || _n || ' · avisos: ' || coalesce(_txt, 'ninguno'));

    _paso := 'E63 3 agenda refresco';
    _ini := clock_timestamp();
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'estadistica_ajustada_refresco') THEN
        PERFORM cron.unschedule('estadistica_ajustada_refresco');
    END IF;
    PERFORM cron.schedule('estadistica_ajustada_refresco', '5-59/10 * * * *',
                          'SELECT public.estadistica_ajustada_refrescar();');
    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES (_paso, _ini, clock_timestamp(), 'cada 10 minutos (5, 15, 25, …)');

    BEGIN
        ANALYZE public.estadistica_ajustada;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    INSERT INTO public._mig_paso_log (paso, inicio, fin, detalle)
    VALUES ('FIN', clock_timestamp(), clock_timestamp(), 'OK');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._mig_paso_log (paso, inicio, fin, error)
    VALUES (_paso, _ini, clock_timestamp(), SQLSTATE || ': ' || SQLERRM);
END
$do$;
$job$
);

-- Confirmación visible: un renglón = agendada; en <= 1 minuto arranca y
-- desaparece de aquí. Sigue con 063c_seguimiento.sql.
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mig_063c_ajustada';
