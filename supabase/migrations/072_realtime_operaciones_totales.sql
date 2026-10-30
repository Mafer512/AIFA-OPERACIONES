-- =============================================================================
-- 072 · Tiempo real: deja la publicación como la usa la aplicación
--
-- Selecciona todo y Run. Es idempotente: se puede volver a correr.
--
-- QUÉ HACE
--   · Publica informe_estadistico_refresco. Operaciones Totales lo usa como
--     señal: es una sola fila que manifiestos_hechos_refrescar() actualiza en la
--     misma transacción que recalcula las cifras.
--   · Conserva "Conciliación Manifiestos" y daily_operations.
--   · Retira flights, fids_vuelos, seguimiento_tareas y seguimiento_comentarios:
--     el cliente ya no las escucha (js/realtime.js).
--
-- POR QUÉ NO SE PUBLICAN LAS TABLAS DE CIFRAS
--   Operaciones Totales lee v_cifras_oficiales_vigentes y
--   totales_detalle_por_dia(), y Realtime no funciona sobre vistas ni funciones.
--   manifiestos_resumen_dia se reescribe por lote en cada refresco: publicarla
--   mandaría una ráfaga de avisos cada 10 minutos para decir lo mismo que esta
--   fila. manifiestos_hechos_refresco tampoco sirve: no la puede leer
--   authenticated (058), y Realtime solo entrega lo que RLS permite leer.
--
-- REVERSA
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.informe_estadistico_refresco;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.flights, public.fids_vuelos,
--       public.seguimiento_tareas, public.seguimiento_comentarios;
--
-- No borra datos ni toca RLS, triggers o funciones. Solo cambia qué tablas
-- emiten avisos.
-- =============================================================================

DO $$
DECLARE
    _tabla text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'informe_estadistico_refresco'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.informe_estadistico_refresco;
    END IF;

    FOREACH _tabla IN ARRAY ARRAY['flights', 'fids_vuelos', 'seguimiento_tareas', 'seguimiento_comentarios']
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = _tabla
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', _tabla);
        END IF;
    END LOOP;
END $$;

-- Resultado esperado: Conciliación Manifiestos, daily_operations e
-- informe_estadistico_refresco.
SELECT tablename
  FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime'
 ORDER BY 1;
