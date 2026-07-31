-- Habilitar Supabase Realtime en Conciliación Manifiestos
-- Ejecutar una sola vez en el SQL Editor de Supabase
--
-- Sin esto, Supabase nunca transmite los INSERT/UPDATE/DELETE de esta tabla
-- a los clientes conectados: la colaboración en vivo (ver a un compañero
-- capturando y que su fila aparezca sola, sin refrescar) no funciona aunque
-- el código del front ya esté escuchando el canal.

-- REPLICA IDENTITY FULL: para que un UPDATE/DELETE incluya la fila completa
-- en el evento (no sólo el id), necesario para reconciliar la vista en vivo.
ALTER TABLE public."Conciliación Manifiestos" REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public."Conciliación Manifiestos";
    EXCEPTION WHEN duplicate_object THEN
        NULL; -- ya estaba en la publicación
    END;
END $$;
