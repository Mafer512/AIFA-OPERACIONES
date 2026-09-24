-- =============================================================================
-- 054 · La sincronización a maestra_operaciones vuelve a funcionar
--
-- SÍNTOMA
--   El log de Postgres se llena de advertencias, una por cada guardado:
--
--     sync maestra_operaciones (Conciliación Manifiestos id=2106):
--     there is no unique or exclusion constraint matching the ON CONFLICT
--     specification                                              (SQLSTATE 42P10)
--
--   Nada falla en pantalla: el manifiesto se guarda en su tabla, pero NO se
--   copia a maestra_operaciones. Y de ahí come toda la Estadística
--   (vw_maestra_operaciones → mv_estadistica_operaciones → estadistica_agregado),
--   así que las cifras se han tenido que corregir a mano.
--
-- CAUSA
--   Los triggers de sincronización (024 y 025) insertan con:
--
--     ON CONFLICT (movement_key) WHERE movement_key IS NOT NULL DO UPDATE ...
--
--   Eso exige un índice único cuyas columnas Y cuyo predicado coincidan
--   EXACTAMENTE. La migración 032 cambió la identidad de un movimiento —dos
--   rotaciones del mismo vuelo el mismo día se pisaban— y dejó:
--
--     CREATE UNIQUE INDEX uq_maestra_operaciones_movement_identity
--         ON public.maestra_operaciones (movement_key, coalesce(movement_slot, ''))
--         WHERE movement_key IS NOT NULL;
--     DROP INDEX IF EXISTS public.uq_maestra_operaciones_movement_key;
--
--   Los triggers nunca se actualizaron a esa identidad nueva. Son anteriores a
--   la columna movement_slot y ni siquiera la mencionan.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Rellena movement_slot en cada alta o cambio de maestra_operaciones, con
--      el mismo criterio de la 032. Va como trigger de la tabla destino, así
--      cualquier ruta de escritura cumple, no sólo estas cuatro.
--   2. Corrige el ON CONFLICT de las cuatro funciones de sincronización.
--   3. Reprocesa lo que se quedó sin copiar, disparando los mismos triggers.
--   4. Refresca el motor estadístico para que las cifras cuadren enseguida.
--
-- QUÉ **NO** HACE
--   No reescribe la lógica de las funciones. El paso 2 toma la definición VIVA
--   de cada función (pg_get_functiondef) y sustituye únicamente esa cláusula:
--   ningún mapeo de columnas, ningún coalesce y ninguna regla de negocio puede
--   cambiar por una transcripción. Tampoco toca índices, políticas RLS,
--   catálogos ni datos ya copiados: el reproceso sólo alcanza filas que hoy no
--   existen en maestra_operaciones.
--
-- Idempotente: se puede ejecutar dos veces sin efectos distintos.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0) Comprobaciones previas. Si el terreno no es el que esta migración supone,
--    se detiene antes de tocar nada y dice qué encontró.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_indice_identidad boolean;
    v_indice_viejo     boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename  = 'maestra_operaciones'
          AND indexname  = 'uq_maestra_operaciones_movement_identity'
    ) INTO v_indice_identidad;

    SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename  = 'maestra_operaciones'
          AND indexname  = 'uq_maestra_operaciones_movement_key'
    ) INTO v_indice_viejo;

    IF NOT v_indice_identidad THEN
        RAISE EXCEPTION
            'Falta uq_maestra_operaciones_movement_identity: aplica antes la migración 032. Esta migración alinea los triggers con ESE índice.';
    END IF;

    IF v_indice_viejo THEN
        RAISE NOTICE 'Aviso: uq_maestra_operaciones_movement_key todavía existe; los triggers funcionarían con él, pero se alinean igual con la identidad de la 032.';
    END IF;

    IF to_regclass('public.maestra_operaciones') IS NULL THEN
        RAISE EXCEPTION 'No existe public.maestra_operaciones';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1) movement_slot siempre relleno en maestra_operaciones.
--
--    El índice de identidad compara coalesce(movement_slot, ''). Los triggers de
--    sincronización son anteriores a esa columna y la dejan en NULL, así que dos
--    rotaciones del mismo vuelo se verían iguales ('' = ''). Se calcula aquí,
--    en la tabla destino, con la MISMA expresión de la 032 — y sólo cuando
--    viene vacía: un valor ya puesto no se toca nunca.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aifa_maestra_rellena_movement_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.movement_slot IS NULL THEN
        NEW.movement_slot := coalesce(
            public._aifa_movement_slot(
                to_char(NEW.hora_programada AT TIME ZONE 'America/Mexico_City', 'HH24:MI')
            ),
            ''
        );
    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public._aifa_maestra_rellena_movement_slot() IS
    'Rellena movement_slot cuando llega vacío, con el criterio de la migración 032. Sin esto, lo que insertan los triggers de sincronización no entra en uq_maestra_operaciones_movement_identity con su hora real.';

DROP TRIGGER IF EXISTS trg_aifa_maestra_movement_slot ON public.maestra_operaciones;
CREATE TRIGGER trg_aifa_maestra_movement_slot
    BEFORE INSERT OR UPDATE ON public.maestra_operaciones
    FOR EACH ROW EXECUTE FUNCTION public._aifa_maestra_rellena_movement_slot();

-- -----------------------------------------------------------------------------
-- 2) El ON CONFLICT de las cuatro funciones, alineado con la identidad de la 032.
--
--    Se reescribe SOBRE la definición viva: se lee con pg_get_functiondef, se
--    sustituye sólo "ON CONFLICT (movement_key)" por
--    "ON CONFLICT (movement_key, coalesce(movement_slot, ''))" y se vuelve a
--    crear. El resto del cuerpo viaja intacto, carácter por carácter.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    f            record;
    v_definicion text;
    v_nueva      text;
    v_corregidas int := 0;
    v_pendientes int := 0;
BEGIN
    FOR f IN
        SELECT p.oid, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              '_aifa_sync_conciliacion_to_maestra',
              '_aifa_sync_itinerario_to_maestra',
              '_aifa_sync_manifiestos_carga_to_maestra',
              '_aifa_sync_manifiestos_pasajeros_to_maestra'
          )
        ORDER BY p.proname
    LOOP
        v_definicion := pg_get_functiondef(f.oid);

        -- La expresión tolera espacios distintos por si alguien reformateó la
        -- función desde el panel. Sólo alcanza al ON CONFLICT de una columna.
        v_nueva := regexp_replace(
            v_definicion,
            'ON CONFLICT\s*\(\s*movement_key\s*\)',
            'ON CONFLICT (movement_key, coalesce(movement_slot, ''''))',
            'g'
        );

        IF v_nueva IS DISTINCT FROM v_definicion THEN
            EXECUTE v_nueva;
            v_corregidas := v_corregidas + 1;
            RAISE NOTICE 'ON CONFLICT corregido en %()', f.proname;
        ELSE
            RAISE NOTICE '%() ya estaba alineada (o no usa ON CONFLICT de una columna)', f.proname;
        END IF;
    END LOOP;

    -- Nadie debe quedarse con la forma vieja.
    SELECT count(*) INTO v_pendientes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE '\_aifa\_sync\_%\_to\_maestra'
      AND pg_get_functiondef(p.oid) ~ 'ON CONFLICT\s*\(\s*movement_key\s*\)';

    IF v_pendientes > 0 THEN
        RAISE EXCEPTION 'Quedaron % funciones con el ON CONFLICT viejo', v_pendientes;
    END IF;

    RAISE NOTICE 'funciones corregidas ................ %', v_corregidas;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Reproceso de lo que se quedó sin copiar.
--
--    No se duplica la lógica: se toca la fila de origen sin cambiarle ningún
--    valor (columna = columna misma) para que vuelva a correr SU trigger, ahora
--    con el ON CONFLICT correcto. Sólo alcanza filas que hoy NO están en
--    maestra_operaciones, así que nada ya copiado se reescribe.
--
--    El trigger de identidad de la 010 también se dispara y recalcula la misma
--    movement_key: ninguna columna de origen cambia de valor.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_faltantes_conci int;
    v_faltantes_itin  int;
BEGIN
    SELECT count(*) INTO v_faltantes_conci
    FROM public."Conciliación Manifiestos" c
    WHERE NOT EXISTS (
        SELECT 1 FROM public.maestra_operaciones m
        WHERE m.conciliacion_manifiesto_legacy_id = c.id
    );

    SELECT count(*) INTO v_faltantes_itin
    FROM public.itinerario_vuelos_editable v
    WHERE NOT EXISTS (
        SELECT 1 FROM public.maestra_operaciones m
        WHERE m.aodb_legacy_id = v.id
    );

    RAISE NOTICE 'manifiestos sin copiar (antes) ...... %', v_faltantes_conci;
    RAISE NOTICE 'vuelos sin copiar (antes) ........... %', v_faltantes_itin;

    IF v_faltantes_conci > 0 THEN
        UPDATE public."Conciliación Manifiestos" c
        SET movement_key = c.movement_key
        WHERE NOT EXISTS (
            SELECT 1 FROM public.maestra_operaciones m
            WHERE m.conciliacion_manifiesto_legacy_id = c.id
        );
    END IF;

    IF v_faltantes_itin > 0 THEN
        UPDATE public.itinerario_vuelos_editable v
        SET arr_movement_key = v.arr_movement_key
        WHERE NOT EXISTS (
            SELECT 1 FROM public.maestra_operaciones m
            WHERE m.aodb_legacy_id = v.id
        );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4) Verificación: cuánto quedó fuera después del reproceso.
--
--    Una fila puede seguir sin copiarse por una razón legítima: sin fecha o sin
--    vuelo no hay movement_key que la identifique. Por eso se informa, no se
--    aborta: la migración ya hizo su trabajo.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_faltantes_conci int;
    v_faltantes_itin  int;
    v_sin_llave       int;
    v_sin_slot        int;
BEGIN
    SELECT count(*) INTO v_faltantes_conci
    FROM public."Conciliación Manifiestos" c
    WHERE NOT EXISTS (
        SELECT 1 FROM public.maestra_operaciones m
        WHERE m.conciliacion_manifiesto_legacy_id = c.id
    );

    SELECT count(*) INTO v_faltantes_itin
    FROM public.itinerario_vuelos_editable v
    WHERE NOT EXISTS (
        SELECT 1 FROM public.maestra_operaciones m
        WHERE m.aodb_legacy_id = v.id
    );

    SELECT count(*) INTO v_sin_llave
    FROM public."Conciliación Manifiestos" c
    WHERE c.movement_key IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.maestra_operaciones m
        WHERE m.conciliacion_manifiesto_legacy_id = c.id
      );

    SELECT count(*) INTO v_sin_slot
    FROM public.maestra_operaciones
    WHERE movement_slot IS NULL;

    RAISE NOTICE 'manifiestos sin copiar (después) .... %  (de ellos, % sin movement_key)', v_faltantes_conci, v_sin_llave;
    RAISE NOTICE 'vuelos sin copiar (después) ......... %', v_faltantes_itin;
    RAISE NOTICE 'filas con movement_slot NULL ........ %  (debe ser 0)', v_sin_slot;
END $$;

-- -----------------------------------------------------------------------------
-- 5) El motor estadístico ve lo recuperado sin esperar al refresco programado.
--
--    mv_estadistica_operaciones se refresca sola cada 15 minutos (038). Aquí se
--    fuerza una vez para que las cifras cuadren al terminar la migración. Si la
--    función no existe (base sin la 038), se avisa y no se interrumpe.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regprocedure('public.refrescar_estadistica(boolean)') IS NULL THEN
        RAISE NOTICE 'refrescar_estadistica(boolean) no existe; el refresco programado lo tomará después';
        RETURN;
    END IF;

    -- Esa función exige nivel admin o edit resuelto con auth.uid(), que en el
    -- editor SQL viene vacío. Si rechaza, NO debe tumbar la migración: el
    -- refresco es una comodidad —pg_cron lo hace solo cada 15 minutos, ver la
    -- 038—, no parte del arreglo. Por eso se atrapa cualquier error y sólo se
    -- informa.
    BEGIN
        PERFORM public.refrescar_estadistica(true);
        RAISE NOTICE 'motor estadístico refrescado';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'no se pudo refrescar el motor estadístico aquí (%); lo tomará el refresco programado o el botón Actualizar de Estadística', SQLERRM;
    END;
END $$;

COMMIT;

-- =============================================================================
-- DESPUÉS DE EJECUTARLA
--
--   1. Captura cualquier celda en Conciliación y revisa el log de Postgres: ya
--      no debe aparecer "there is no unique or exclusion constraint...".
--
--   2. Comprueba que lo capturado llega a la maestra:
--
--        SELECT count(*) FROM public."Conciliación Manifiestos" c
--        LEFT JOIN public.maestra_operaciones m
--               ON m.conciliacion_manifiesto_legacy_id = c.id
--        WHERE m.id IS NULL;
--
--   3. Compara Estadística contra el Informe oficial del mismo periodo. Si ya
--      cuadran, los valores oficiales forzados a mano
--      (js/estadistico-informe-overrides.js) dejan de hacer falta: quítalos en
--      un cambio aparte, con calma, y verificando periodo por periodo.
-- =============================================================================
