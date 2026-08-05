-- Conciliación > Manifiestos: desglose de carga (nacional / internacional) y ruta.
--
--  • "KGS. DE CARGA NACIONAL"      : carga en kg de tramos nacionales (captura).
--  • "KGS. DE CARGA INTERNACIONAL" : carga en kg de tramos internacionales (captura).
--  • "KG DE CARGA TOTAL"            : total = nacional + internacional (lo calcula
--                                     el cliente y se guarda; renombrada desde la
--                                     columna previa "KGS. DE CARGA" para no perder
--                                     el histórico).
--  • "RUTA"                        : pierna completa origen→destino (p.ej. "MEX-CUN"),
--                                     el valor crudo de DESTINO / ORIGEN sin maquillar.
--
-- Idempotente: se puede ejecutar varias veces sin error. No cambia RLS ni grants
-- (las columnas heredan los permisos de la tabla, ya otorgados a authenticated).

ALTER TABLE public."Conciliación Manifiestos"
    ADD COLUMN IF NOT EXISTS "KGS. DE CARGA NACIONAL" numeric,
    ADD COLUMN IF NOT EXISTS "KGS. DE CARGA INTERNACIONAL" numeric,
    ADD COLUMN IF NOT EXISTS "RUTA" text;

-- Renombra el total de carga a "KG DE CARGA TOTAL" conservando el histórico.
-- Idempotente: solo renombra si aún existe la columna previa y no existe la nueva.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Conciliación Manifiestos'
          AND column_name = 'KGS. DE CARGA'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Conciliación Manifiestos'
          AND column_name = 'KG DE CARGA TOTAL'
    ) THEN
        ALTER TABLE public."Conciliación Manifiestos"
            RENAME COLUMN "KGS. DE CARGA" TO "KG DE CARGA TOTAL";
    END IF;
END $$;

-- Si la tabla nunca tuvo la columna de total, la crea con el nuevo nombre.
ALTER TABLE public."Conciliación Manifiestos"
    ADD COLUMN IF NOT EXISTS "KG DE CARGA TOTAL" numeric;

-- Refresca la caché de esquema de PostgREST para que las nuevas columnas queden
-- disponibles de inmediato en la API REST.
NOTIFY pgrst, 'reload schema';
