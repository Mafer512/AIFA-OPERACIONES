-- =============================================================================
--  Filas fantasma - Conciliación Manifiestos
--
--  Qué son: registros reales en la base a los que nadie capturó nada. Traen la
--  FECHA (heredada del filtro), a veces el MES y el nombre de quien estaba en
--  sesión, y todo lo demás vacío. La tabla las dibuja en blanco, con ESTATUS
--  MATRÍCULA en "NO IDENTIFICADA" porque no hay matrícula que identificar, y el
--  contador de arriba las suma porque existir, existen.
--
--  De dónde salían: "Agregar fila" deja el cursor abierto en la primera celda.
--  Al hacer clic en otra parte ese editor se cerraba y disparaba el guardado
--  aunque no se hubiera escrito nada. El envío venía vacío, pero justo después
--  la fila heredaba la fecha del filtro y el nombre del capturista, así que
--  dejaba de estar vacío y se insertaba igual.
--
--  Eso YA NO PASA: la comprobación se movió delante de esos dos rellenos
--  automáticos (ver _conciFilaNuevaListaParaGuardar en script.js). Este script
--  no arregla el origen -- sirve para retirar las que se crearon ANTES de ese
--  arreglo y que siguen ocupando sitio en la tabla.
--
--  Ejecutar en: Supabase -> SQL Editor -> Run
--
--  IMPORTANTE: los pasos 1 y 2 solo consultan. El paso 3 borra y está comentado
--  a propósito: revisa antes lo que devuelven los dos primeros.
-- =============================================================================


-- ─── Paso 1: cuántas hay y de qué fechas ────────────────────────────────────
--
-- Se considera fantasma la fila en la que NINGUNA columna de captura tiene
-- valor. La comprobación no enumera columnas a mano: convierte la fila a JSON y
-- descarta las que rellena el sistema, así sigue valiendo aunque el día de
-- mañana se añadan columnas nuevas a la tabla.

WITH capturas AS (
    SELECT t.id,
           t."FECHA" AS fecha,
           count(*) FILTER (
               WHERE kv.key NOT IN (
                         'id', 'FECHA', 'MES', 'CAPTURÓ',
                         'ESTATUS MATRÍCULA', 'movement_key',
                         'created_at', 'updated_at'
                     )
                 AND kv.value IS NOT NULL
                 AND btrim(kv.value) <> ''
           ) AS campos_con_dato
      FROM public."Conciliación Manifiestos" t
      CROSS JOIN LATERAL jsonb_each_text(to_jsonb(t)) AS kv(key, value)
     GROUP BY t.id, t."FECHA"
)
SELECT fecha,
       count(*) AS filas_fantasma,
       min(id)  AS id_menor,
       max(id)  AS id_mayor
  FROM capturas
 WHERE campos_con_dato = 0
 GROUP BY fecha
 ORDER BY fecha;


-- ─── Paso 2: verlas una por una antes de borrar nada ────────────────────────
--
-- Conviene mirar esta lista con calma. Si alguna trae algo en una columna que
-- no esperabas, NO es fantasma y hay que sacarla del borrado del paso 3.

WITH capturas AS (
    SELECT t.id,
           t."FECHA" AS fecha,
           count(*) FILTER (
               WHERE kv.key NOT IN (
                         'id', 'FECHA', 'MES', 'CAPTURÓ',
                         'ESTATUS MATRÍCULA', 'movement_key',
                         'created_at', 'updated_at'
                     )
                 AND kv.value IS NOT NULL
                 AND btrim(kv.value) <> ''
           ) AS campos_con_dato
      FROM public."Conciliación Manifiestos" t
      CROSS JOIN LATERAL jsonb_each_text(to_jsonb(t)) AS kv(key, value)
     GROUP BY t.id, t."FECHA"
)
SELECT c.id,
       c.fecha,
       t."MES",
       t."CAPTURÓ",
       t."ESTATUS MATRÍCULA"
  FROM capturas c
  JOIN public."Conciliación Manifiestos" t ON t.id = c.id
 WHERE c.campos_con_dato = 0
 ORDER BY c.fecha, c.id;


-- ─── Paso 3: el borrado ──────────────────────────────────────────────────────
--
-- Descomenta el bloque SOLO después de revisar el paso 2.
--
-- Va dentro de una transacción con el conteo delante: si el número no cuadra
-- con lo que viste, haz ROLLBACK en vez de COMMIT.
--
-- Si prefieres ir sobre seguro, sustituye la condición final por una lista
-- explícita de ids sacada del paso 2:
--     DELETE FROM public."Conciliación Manifiestos" WHERE id IN (123, 124, 125);

/*
BEGIN;

WITH capturas AS (
    SELECT t.id,
           count(*) FILTER (
               WHERE kv.key NOT IN (
                         'id', 'FECHA', 'MES', 'CAPTURÓ',
                         'ESTATUS MATRÍCULA', 'movement_key',
                         'created_at', 'updated_at'
                     )
                 AND kv.value IS NOT NULL
                 AND btrim(kv.value) <> ''
           ) AS campos_con_dato
      FROM public."Conciliación Manifiestos" t
      CROSS JOIN LATERAL jsonb_each_text(to_jsonb(t)) AS kv(key, value)
     GROUP BY t.id
)
DELETE FROM public."Conciliación Manifiestos" t
 USING capturas c
 WHERE c.id = t.id
   AND c.campos_con_dato = 0;

-- Revisa el número de filas borradas que reporta el editor.
-- Si cuadra:   COMMIT;
-- Si no:       ROLLBACK;

COMMIT;
*/
