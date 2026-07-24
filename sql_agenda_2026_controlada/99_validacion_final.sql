-- Consultas de verificaci?n despu?s del UPSERT, antes del COMMIT.
SELECT COUNT(*) AS total_registros FROM public.agenda_2026;
SELECT COUNT(*) AS colaboradores_con_num_empleado FROM public.agenda_2026 WHERE "No. Empleado" IS NOT NULL AND "No. Empleado"::text <> '';
SELECT "No. Empleado", COUNT(*) AS ocurrencias FROM public.agenda_2026 GROUP BY "No. Empleado" HAVING COUNT(*) > 1;
SELECT "No. Empleado", "Nombre", "Plaza", "Nivel", "Puesto" FROM public.agenda_2026 WHERE "No. Empleado" IN ('1151','1686','1723','1394-3','1544-2','986') ORDER BY "No. Empleado";

-- Si las verificaciones son correctas, deja COMMIT. Si no, cambia COMMIT por ROLLBACK antes de ejecutar.
