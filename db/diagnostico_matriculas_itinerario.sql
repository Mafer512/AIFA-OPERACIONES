-- =============================================================================
-- Diagnóstico (solo lectura): ¿por qué faltan matrículas en Conciliación?
--
-- Los renglones de Conciliación que aún no tienen manifiesto salen del
-- itinerario: la MATRÍCULA es la columna "Registration" de
-- manifiestos_vuelos_editable. Cada importación escribe tres tablas:
--   vuelos_parte_operaciones_csv   (la cruda, con la que se compara)
--   itinerario_vuelos_editable     (pestaña Itinerario de Vuelos)
--   manifiestos_vuelos_editable    (lo que lee Conciliación)
-- Si la copia a las dos últimas falla, el error sólo queda en la consola y
-- la siguiente importación ve "sin cambios" contra la cruda: la matrícula
-- nunca llega a Conciliación.
--
-- Resultado: una fila por caso, de más a menos.
-- =============================================================================
WITH t AS (
    SELECT c.id,
           nullif(btrim(c."Registration"), '') AS cruda,
           nullif(btrim(i."Registration"), '') AS itinerario,
           nullif(btrim(m."Registration"), '') AS manifiestos,
           (i.id IS NOT NULL) AS hay_itinerario,
           (m.id IS NOT NULL) AS hay_manifiestos
      FROM public.vuelos_parte_operaciones_csv c
      LEFT JOIN public.itinerario_vuelos_editable i ON i.id = c.id
      LEFT JOIN public.manifiestos_vuelos_editable m ON m.id = c.id
)
SELECT caso, count(*) AS vuelos, string_agg(id::text, ', ' ORDER BY id DESC) FILTER (WHERE rn <= 15) AS ejemplos_id
  FROM (
    SELECT t.*,
           CASE
               WHEN NOT hay_manifiestos                         THEN '1. El vuelo no se copió a Manifiestos'
               WHEN cruda IS NOT NULL AND manifiestos IS NULL   THEN '2. La cruda tiene matrícula y Manifiestos no'
               WHEN cruda IS NOT NULL AND manifiestos <> cruda  THEN '3. Manifiestos tiene otra matrícula que la cruda'
               WHEN cruda IS NULL AND manifiestos IS NULL       THEN '4. El archivo importado no trae matrícula'
               WHEN cruda IS NULL AND manifiestos IS NOT NULL   THEN '5. Sólo Manifiestos tiene matrícula (editada a mano)'
               ELSE '6. Igual en las tablas'
           END AS caso,
           row_number() OVER (PARTITION BY
               CASE
                   WHEN NOT hay_manifiestos THEN 1
                   WHEN cruda IS NOT NULL AND manifiestos IS NULL THEN 2
                   WHEN cruda IS NOT NULL AND manifiestos <> cruda THEN 3
                   WHEN cruda IS NULL AND manifiestos IS NULL THEN 4
                   WHEN cruda IS NULL AND manifiestos IS NOT NULL THEN 5
                   ELSE 6 END
               ORDER BY id DESC) AS rn
      FROM t
  ) x
 GROUP BY caso
 ORDER BY caso;
