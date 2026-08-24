-- ============================================================================
-- Conciliación Manifiestos | Llave generada por el cliente (cliente_uuid)
--
-- PROBLEMA QUE RESUELVE
--   Una fila recien agregada no existe en la base hasta que su INSERT termina,
--   asi que hasta ese momento no tiene id. Si la persona refresca o cierra la
--   pestana antes, no hay contra que escribir: lo capturado sale hacia la cola
--   de rescate y hay que aplicarlo a mano desde el panel. Para quien captura,
--   eso se ve como "se perdio".
--
--   Ademas, sin una llave estable un reintento puede insertar la MISMA fila dos
--   veces: la primera peticion si llego pero su respuesta se perdio.
--
-- MODELO
--   Lo mismo que hacen las hojas de calculo colaborativas: el registro lo NOMBRA
--   quien lo crea, no la base. En cuanto se agrega una fila en pantalla, el
--   navegador le genera un UUID y ese UUID viaja en cada escritura.
--
--   Con eso, toda escritura de esa fila es un UPSERT sobre cliente_uuid:
--     · la primera la crea;
--     · las siguientes la actualizan;
--     · un reintento que se repita no duplica nada — es idempotente;
--     · y al refrescar se puede escribir de verdad, sin esperar a tener id.
--
--   El id bigint sigue siendo la llave primaria y no se toca. cliente_uuid es
--   solo un nombre estable acordado de antemano entre cliente y base.
--
-- Ejecutar en: Supabase -> SQL Editor -> Run
-- ============================================================================

ALTER TABLE public."Conciliación Manifiestos"
    ADD COLUMN IF NOT EXISTS cliente_uuid uuid;

COMMENT ON COLUMN public."Conciliación Manifiestos".cliente_uuid IS
    'Identificador que genera el navegador al crear la fila, antes de que exista en la base. Destino del UPSERT: hace que reintentar una escritura no duplique la fila. NULL en las filas anteriores a este mecanismo.';

-- Unico, pero admitiendo NULL: en Postgres varios NULL no chocan entre si, asi
-- que las filas historicas conviven sin tener que rellenarlas. Es un indice
-- unico normal (no parcial) a proposito: ON CONFLICT (cliente_uuid) necesita
-- exactamente esta forma para poder usarlo.
CREATE UNIQUE INDEX IF NOT EXISTS conci_manifiestos_cliente_uuid_key
    ON public."Conciliación Manifiestos" (cliente_uuid);

-- Verificacion:
-- SELECT count(*) FILTER (WHERE cliente_uuid IS NOT NULL) AS con_uuid,
--        count(*)                                        AS total
-- FROM public."Conciliación Manifiestos";
-- Las filas viejas se quedan en NULL; las nuevas nacen con su uuid.
