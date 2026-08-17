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
--  CAUSA CONFIRMADA por el mensaje del log:
--
--      ON CONFLICT DO UPDATE command cannot affect row a second time   (21000)
--
--  El lote trae DOS filas con el mismo reporte_id. El upsert va en una sola
--  sentencia, así que Postgres tendría que insertar y actualizar la misma fila
--  dentro del mismo comando, y eso no lo hace: rechaza el LOTE ENTERO. Por eso
--  una sola fila duplicada en la hoja de cálculo tumba la sincronización
--  completa —unos días entraban registros y otros no entraba ninguno—.
--
--  El arreglo NO es de base de datos: está en el emisor,
--  scripts/appsheet_hvac_to_supabase.gs, que armaba el lote fila por fila sin
--  comprobar repetidos. Ahora deduplica por "Reporte ID" antes de enviar,
--  quedándose con la última —que es la que ganaría en el upsert de todas
--  formas— y deja en el log de Apps Script qué IDs venían repetidos para poder
--  limpiar la hoja. Hay también una función debugDuplicados() que los lista
--  sin mandar nada.
--
--  Hay que copiar el .gs actualizado a Extensiones → Apps Script en la hoja.
--
--  Los dos arreglos de abajo son independientes de ese error y se pueden
--  aplicar ya.
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
--  Activarlo NO rompe la sincronización: scripts/appsheet_hvac_to_supabase.gs
--  manda con la service_role key, que se salta RLS por diseño. Queda igualmente
--  comentado para que sea una decisión consciente y se pueda comprobar antes
--  que la copia instalada en Apps Script lleva de verdad la service_role y no
--  la anon (en el repo la constante está como marcador de posición):
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
