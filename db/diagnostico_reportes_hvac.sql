-- =============================================================================
--  reportes_hvac — diagnóstico del upsert que falla, y dos arreglos
--
--  El error viene del upsert que manda la sincronización de AppSheet:
--
--      INSERT INTO public.reportes_hvac (...)
--      SELECT ... FROM json_to_recordset($1) AS _(..., "fecha" date, ...)
--      ON CONFLICT ("reporte_id") DO UPDATE SET ...
--
--  Lo que YA se comprobó contra la base en producción (17-ago-2026):
--
--    · La tabla existe y responde.
--    · 369 filas, CERO reporte_id duplicados y CERO vacíos: la restricción
--      unique sobre reporte_id existe y está haciendo su trabajo. Eso descarta
--      el error 42P10 ("no unique or exclusion constraint matching the ON
--      CONFLICT specification"), que es el sospechoso habitual.
--    · La sincronización NO está caída: 9 filas nuevas entraron el mismo 17 de
--      agosto. Fallan lotes concretos, no todos.
--
--  Quedan dos causas posibles, las dos por datos del lote que llega, no por el
--  esquema. Se distinguen por el código de error del log:
--
--  ── 21000 · "ON CONFLICT DO UPDATE command cannot affect row a second time"
--     El mismo lote trae DOS filas con el mismo reporte_id. Postgres no puede
--     insertar y actualizar la misma fila en una sola sentencia, así que
--     rechaza el lote entero —por eso se pierde todo, no solo la fila mala—.
--     Causa típica: una fila duplicada en la hoja de cálculo de origen.
--     Se arregla en el origen: quitar el duplicado, o que el Apps Script haga
--     de-duplicado por "Reporte ID" antes de enviar, quedándose con el último.
--
--  ── 22007 · "invalid input syntax for type date"
--     ó 22008 · "date/time field value out of range"
--     El lote trae una fecha que no convierte. json_to_recordset la declara
--     como date, así que una celda vacía llega como "" y revienta —no como
--     NULL—, y una fecha en formato dd/mm/aaaa se rompe en cuanto el día pasa
--     de 12. Se arregla en el origen: mandar null en vez de "" cuando la celda
--     esté vacía, y las fechas en formato ISO (aaaa-mm-dd).
--
--  Los dos arreglos de abajo son independientes del error y se pueden aplicar
--  ya.
-- =============================================================================


-- ── 1. Confirmar de qué lado está el problema ────────────────────────────────
-- Debe devolver una fila. Si NO devuelve nada, el error sí es 42P10 y falta la
-- restricción; en ese caso ejecutar el bloque 2.
SELECT con.conname AS restriccion,
       pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'reportes_hvac'
  AND con.contype IN ('p', 'u')
  AND pg_get_constraintdef(con.oid) ILIKE '%reporte_id%';

-- Y esto debe devolver cero filas (si devuelve alguna, hay duplicados ya
-- guardados y entonces la restricción NO existe):
SELECT reporte_id, count(*)
FROM public.reportes_hvac
GROUP BY reporte_id
HAVING count(*) > 1;


-- ── 2. Solo si el bloque 1 no encontró la restricción ────────────────────────
-- (Primero hay que borrar los duplicados que hubiera; esto falla si los hay.)
-- ALTER TABLE public.reportes_hvac
--     ADD CONSTRAINT reportes_hvac_reporte_id_key UNIQUE (reporte_id);


-- ── 3. Arreglo: updated_at nunca se refrescaba ───────────────────────────────
-- El upsert actualiza 18 columnas y updated_at NO está entre ellas, así que el
-- "default now()" solo corre al INSERTAR. Una fila que se sincroniza cien veces
-- conserva para siempre la hora de la primera vez: la columna dice cuándo se
-- creó, no cuándo cambió, que es justo lo contrario de lo que aparenta.
CREATE OR REPLACE FUNCTION public._hvac_marcar_actualizacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hvac_updated_at ON public.reportes_hvac;
CREATE TRIGGER trg_hvac_updated_at
    BEFORE UPDATE ON public.reportes_hvac
    FOR EACH ROW EXECUTE FUNCTION public._hvac_marcar_actualizacion();


-- ── 4. Exposición: la tabla se lee entera con la clave pública ───────────────
--
--  Comprobado el 17-ago-2026: una petición con la anon key —la que va escrita
--  en el bundle del navegador, visible para cualquiera— devuelve las 369 filas
--  de reportes_hvac. La política del repo dice
--
--      create policy "hvac_select_auth" ... for select to authenticated
--
--  y db/rls_hardening_2026.sql mete la tabla en la lista auth_only, pero
--  ninguna de las dos cosas está surtiendo efecto en producción: RLS no está
--  activo sobre esta tabla. A modo de comparación, profiles devuelve 0 filas a
--  un anónimo, así que ahí sí está funcionando.
--
--  NO se activa aquí sin más, a propósito: si el Apps Script que sincroniza usa
--  la anon key en vez de la service_role, activar RLS le corta la escritura y
--  la sincronización deja de funcionar. Confirmar primero con qué clave manda
--  el Apps Script, y entonces descomentar:
--
-- ALTER TABLE public.reportes_hvac ENABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS "hvac_select_auth" ON public.reportes_hvac;
-- CREATE POLICY "hvac_select_auth" ON public.reportes_hvac
--     FOR SELECT TO authenticated USING (true);
--
-- DROP POLICY IF EXISTS "hvac_write_auth" ON public.reportes_hvac;
-- CREATE POLICY "hvac_write_auth" ON public.reportes_hvac
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
--
--  Para comprobar después que quedó cerrada, desde una terminal:
--
--    curl -s -I "https://<proyecto>.supabase.co/rest/v1/reportes_hvac?select=*" \
--         -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
--         -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range
--
--  Debe decir 0 filas, no 369.
--
--  Conviene revisar de paso el resto de la lista auth_only de
--  db/rls_hardening_2026.sql: si esta tabla se quedó fuera, es probable que
--  otras también.
