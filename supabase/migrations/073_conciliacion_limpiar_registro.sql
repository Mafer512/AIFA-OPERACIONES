-- =============================================================================
-- 073 · Limpiar registro (Conciliación › Manifiestos › columna Acciones)
-- (selecciona todo y Run). Se puede volver a correr.
--
-- Quita de la base un manifiesto ABIERTO para que no entre al Cierre de
-- Subsecretaría. Si venía de un vuelo del itinerario, la fila vuelve a ser
-- "Solo Vuelos" con los datos del itinerario; si se agregó a mano, desaparece.
-- Es para cuando alguien escribió en una fila por error: aunque borre lo
-- escrito, el registro ya se creó y el botón del cierre lo tomaría.
--
-- Quién puede:
--   · editor, admin y superadmin: cualquier manifiesto abierto;
--   · capturista: sólo si TODO lo que el historial registra de esa fila (su
--     alta y cada cambio) lo hizo él mismo, comparando el usuario, no el
--     nombre escrito. Si otra persona capturó algo, o la fila no tiene
--     historial (importada o de un script), no puede;
--   · nadie: un manifiesto ya cerrado (para eso está "Corregir cerrado").
-- Lo quitado queda completo en conciliacion_registros_limpiados (la fila
-- entera, quién la limpió y cuándo); el historial registra además el DELETE.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.conciliacion_registros_limpiados (
    id                   bigserial PRIMARY KEY,
    manifiesto_id        bigint NOT NULL,
    datos                jsonb NOT NULL,
    capturistas          text,
    limpiado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    limpiado_por_nombre  text,
    limpiado_en          timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_conci_registros_limpiados_manifiesto
    ON public.conciliacion_registros_limpiados (manifiesto_id);

COMMENT ON TABLE public.conciliacion_registros_limpiados IS
    'Manifiestos abiertos quitados con "Limpiar registro" (073): la fila completa, '
    'quién la limpió y cuándo. Sólo la escribe conciliacion_limpiar_registro(). '
    'Para devolver una: INSERT INTO "Conciliación Manifiestos" SELECT * FROM '
    'jsonb_populate_record(NULL::"Conciliación Manifiestos", datos).';

ALTER TABLE public.conciliacion_registros_limpiados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conciliacion_registros_limpiados_select ON public.conciliacion_registros_limpiados;
CREATE POLICY conciliacion_registros_limpiados_select
    ON public.conciliacion_registros_limpiados FOR SELECT TO authenticated
    USING (public.conciliacion_manifiestos_access_level(auth.uid()) <> 'none');
REVOKE ALL ON public.conciliacion_registros_limpiados FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.conciliacion_registros_limpiados FROM authenticated;
GRANT SELECT ON public.conciliacion_registros_limpiados TO authenticated;

-- ¿Puede quien está en sesión limpiar este manifiesto? Y lo que se perdería.
-- Sólo lee: la interfaz lo usa para la confirmación, y la limpieza lo vuelve
-- a pedir con la fila ya bloqueada.
CREATE OR REPLACE FUNCTION public.conciliacion_revisar_limpieza(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_nivel   text := public.conciliacion_manifiestos_access_level(auth.uid());
    v_fila    jsonb;
    v_cerrado boolean;
    v_total   integer := 0;
    v_ajenos  integer := 0;
    v_otros   text;
    v_todos   text;
    v_puede   boolean;
    v_motivo  text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;

    SELECT to_jsonb(m), m.cierre_id IS NOT NULL
      INTO v_fila, v_cerrado
      FROM public."Conciliación Manifiestos" m
     WHERE m.id = p_id;
    IF v_fila IS NULL THEN
        RETURN jsonb_build_object('existe', false, 'puede', false, 'motivo', 'Este registro ya no existe: recarga la tabla.');
    END IF;

    -- Quién dio de alta la fila y quién cambió cada celda, por usuario.
    SELECT count(*),
           count(*) FILTER (WHERE h.usuario_id IS DISTINCT FROM auth.uid()),
           string_agg(DISTINCT CASE WHEN h.usuario_id IS DISTINCT FROM auth.uid()
                                    THEN coalesce(nullif(btrim(h.usuario_nombre), ''), 'Sistema') END, ', '),
           string_agg(DISTINCT coalesce(nullif(btrim(h.usuario_nombre), ''), 'Sistema'), ', ')
      INTO v_total, v_ajenos, v_otros, v_todos
      FROM public.conciliacion_manifiestos_historial h
     WHERE h.manifiesto_id = p_id
       AND h.operacion IN ('INSERT', 'UPDATE');

    IF v_cerrado THEN
        v_puede := false;
        v_motivo := 'Ya está cerrado por un Cierre de Subsecretaría: para cambiarlo usa «Corregir cerrado».';
    ELSIF v_nivel = 'none' THEN
        v_puede := false;
        v_motivo := 'No tienes permiso de captura en Conciliación › Manifiestos.';
    ELSIF v_nivel IN ('admin', 'edit') THEN
        v_puede := true;
    ELSIF v_total = 0 THEN
        v_puede := false;
        v_motivo := 'No hay registro de quién capturó esta fila: sólo un editor o administrador puede limpiarla.';
    ELSIF v_ajenos > 0 THEN
        v_puede := false;
        v_motivo := 'En esta fila también capturó: ' || v_otros
                 || '. Sólo puedes limpiar lo que capturaste tú; pídeselo a esa persona o a un editor.';
    ELSE
        v_puede := true;
    END IF;

    RETURN jsonb_build_object(
        'existe', true,
        'id', p_id,
        'puede', v_puede,
        'motivo', v_motivo,
        'nivel', v_nivel,
        'cerrado', v_cerrado,
        'capturistas', v_todos,
        'otros', v_otros,
        'fila', v_fila
    );
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_revisar_limpieza(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliacion_revisar_limpieza(bigint) TO authenticated;

-- Quita el manifiesto si la regla lo permite, con respaldo.
CREATE OR REPLACE FUNCTION public.conciliacion_limpiar_registro(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_fila     jsonb;
    v_revision jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '28000';
    END IF;

    -- La fila bloqueada: nadie la cierra, la captura ni la limpia a la vez.
    SELECT to_jsonb(m) INTO v_fila
      FROM public."Conciliación Manifiestos" m
     WHERE m.id = p_id
       FOR UPDATE;
    IF v_fila IS NULL THEN
        RAISE EXCEPTION 'Este registro ya no existe: recarga la tabla.' USING ERRCODE = 'P0002';
    END IF;

    v_revision := public.conciliacion_revisar_limpieza(p_id);
    IF NOT coalesce((v_revision ->> 'puede')::boolean, false) THEN
        RAISE EXCEPTION '%', v_revision ->> 'motivo' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.conciliacion_registros_limpiados
        (manifiesto_id, datos, capturistas, limpiado_por, limpiado_por_nombre)
    VALUES (p_id, v_fila, v_revision ->> 'capturistas', auth.uid(), public._conci_usuario_nombre());

    -- Pasa por los triggers de siempre: el de cierre rechaza una fila cerrada
    -- y el historial registra el DELETE con el usuario en sesión.
    DELETE FROM public."Conciliación Manifiestos" WHERE id = p_id;

    RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacion_limpiar_registro(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliacion_limpiar_registro(bigint) TO authenticated;

COMMIT;

-- Comprobación: las dos funciones y la tabla de respaldo existen.
SELECT 'conciliacion_revisar_limpieza' AS objeto, to_regprocedure('public.conciliacion_revisar_limpieza(bigint)') IS NOT NULL AS listo
UNION ALL
SELECT 'conciliacion_limpiar_registro', to_regprocedure('public.conciliacion_limpiar_registro(bigint)') IS NOT NULL
UNION ALL
SELECT 'conciliacion_registros_limpiados', to_regclass('public.conciliacion_registros_limpiados') IS NOT NULL;
