-- Corrige "permission denied for function _conci_campos_editables_cierre".
--
-- CAUSA
--   El trigger de 054 (_conci_capturo_historial) corre como SECURITY INVOKER,
--   es decir, con el rol de quien guarda (authenticated). Adentro llama a dos
--   helpers PRIVADOS de 053 a los que 053 les quitó EXECUTE a propósito
--   (REVOKE ... FROM PUBLIC, anon, authenticated):
--     · _conci_campos_editables_cierre()  → en cada UPDATE
--     · _conci_usuario_nombre()           → en cada INSERT y en cada UPDATE que
--                                            cambie un campo de negocio
--   Por eso guardar una fila fallaba. No tiene relación con RLS ni con la
--   columna nueva de 055: el UPDATE ya fallaba con 054 aplicada.
--
-- CORRECCIÓN (mínima; los helpers siguen privados)
--   Sólo la función-trigger pasa a SECURITY DEFINER. Ya trae un search_path
--   fijo (pg_catalog, public, pg_temp) y sus llamadas van cualificadas por
--   esquema. No se otorga EXECUTE a authenticated/anon sobre ningún helper y
--   no se toca RLS.
--   La identidad no cambia: _conci_usuario_nombre() lee auth.uid()/auth.jwt(),
--   que salen de la sesión y no del rol que ejecuta la función.

BEGIN;

ALTER FUNCTION public._conci_capturo_historial() SECURITY DEFINER;

COMMENT ON FUNCTION public._conci_capturo_historial() IS
    'Trigger de "Conciliación Manifiestos": concatena en "CAPTURÓ" a cada '
    'persona que modifica un campo de NEGOCIO (whitelist de '
    '_conci_campos_editables_cierre() menos "CAPTURÓ"), una sola vez cada una. '
    'SECURITY DEFINER (056) porque usa helpers privados sin EXECUTE para '
    'authenticated; search_path fijo. Si "CAPTURÓ" se fija explícitamente en el '
    'mismo UPDATE, se respeta sin concatenar.';

NOTIFY pgrst, 'reload schema';

COMMIT;
