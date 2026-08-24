-- =============================================================================
--  Capturas pendientes huérfanas — conciliacion_capturas_pendientes
--
--  Qué son: renglones de la cola del servidor que nadie puede aplicar ni quitar.
--
--  La cola guarda lo que se capturó y NO llegó a "Conciliación Manifiestos",
--  para que no dependa de que una computadora en concreto vuelva a encenderse.
--  Cada renglón se identifica por el id de la fila a la que pertenece. Pero una
--  captura sobre una fila que todavía no existía en la base no tenía id que
--  poner, así que se encolaba con uno temporal: "nueva:<equipo>:<algo>".
--
--  Ese id no vuelve a existir nunca. Si la fila acabó guardándose recibió un id
--  real y la cola siguió apuntando al temporal; si no se guardó, la fila ya no
--  está. En los dos casos el renglón se queda ahí para siempre: el panel de
--  rescate no encuentra su celda, y el contador de arriba lo sigue sumando como
--  "capturas pendientes de otro equipo".
--
--  Los "nueva:%" salieron de tres fallos, corregidos en script.js:
--    · la guarda de identidad rechazaba capturas sobre vuelos del Itinerario
--      que sí estaban identificados, y cada rechazo encolaba (ver
--      _conciWriteRowSafe / conservaAlgoCapturado);
--    · el id temporal se componía con tr.rowIndex, que cambia al reordenar o
--      redibujar la tabla, así que la misma captura se encolaba varias veces
--      bajo ids distintos;
--    · y sobre todo: se usaba un id INVENTADO donde debía ir una identidad.
--
--  Una fila sin id se encola ahora con la identidad real del movimiento
--  —"mov:AEROLINEA|VUELO|FECHA|A o D|OTRO EXTREMO", la misma llave que calcula
--  el trigger _aifa_movement_key—, idéntica antes y después de guardar y desde
--  cualquier computadora. Quien abra ese día vuelve a tener el vuelo en
--  pantalla y la captura se puede colocar donde va, con el botón "Aplicar" del
--  panel. Ver _conciIdColaDeFila / _conciBuscarFilaPorIdentidad.
--
--  ── AVISO: este archivo decía "YA NO SE GENERAN" y no era cierto ────────────
--
--  Los "nueva:%" dejaron de generarse, sí. Pero la cola siguió creciendo por
--  una CUARTA causa, distinta y encontrada después (119 renglones acumulados):
--
--    · el dueño de un renglón era el id de PESTAÑA (sessionStorage), que muere
--      al cerrarla, y retirar un renglón exigía ser su dueño. Al volver a
--      entrar, el mismo equipo tenía otro id: sus propios renglones le salían
--      como "de otro equipo" y ya nadie podía quitarlos nunca;
--    · y encima se encolaba en 'visibilitychange → hidden', que se dispara al
--      cambiar de pestaña o de aplicación —no sólo al cerrar—, así que bastaba
--      con salir de la pestaña dentro de los 400 ms del autoguardado.
--
--  Esos renglones NO son capturas perdidas: el dato sí se guardó. Son
--  contabilidad que se quedó atrás. Corregido en script.js: la cola se cuelga
--  del equipo (localStorage), un valor confirmado por la base retira el
--  pendiente lo haya encolado quien lo haya encolado, y al cargar se reconcilia
--  contra lo que ya está guardado. Ver _conciDeviceId,
--  _conciPurgarPendientesConfirmados y _conciReconciliarPendientesRemotos.
--
--  Por eso este script ya casi nunca hace falta: lo reconciliable se limpia
--  solo conforme se abren esas fechas. Lo que sí queda para siempre son los
--  "nueva:%", que no hay forma de saber a qué fila iban: ésos se copian a mano
--  o se descartan.
--
--  La aplicación ya permite descartarlos uno por uno desde el panel de
--  pendientes. Este script es para hacerlo de golpe cuando son muchos.
--
--  Ejecutar en: Supabase -> SQL Editor -> Run
--
--  IMPORTANTE: los pasos 1 y 2 sólo consultan. El paso 3 borra y está comentado
--  a propósito: son capturas de personas reales, revísalas antes.
-- =============================================================================


-- ─── Paso 1: cuántos hay, de quién y de cuándo ──────────────────────────────

SELECT usuario,
       count(*)          AS pendientes,
       min(creado_en)::date AS mas_antiguo,
       max(creado_en)::date AS mas_reciente
  FROM public.conciliacion_capturas_pendientes
 WHERE row_id LIKE 'nueva:%'
 GROUP BY usuario
 ORDER BY pendientes DESC;


-- ─── Paso 2: qué dicen, para no tirar nada sin mirarlo ──────────────────────
--
-- Si alguno corresponde a un vuelo que reconoces y el dato NO está ya en
-- Conciliación, cópialo a mano en la fila de ese vuelo antes de borrarlo.

SELECT id,
       usuario,
       vuelo,
       fecha_vuelo,
       columna,
       valor,
       ultimo_error,
       creado_en
  FROM public.conciliacion_capturas_pendientes
 WHERE row_id LIKE 'nueva:%'
 ORDER BY fecha_vuelo NULLS LAST, vuelo, creado_en;


-- ─── Paso 3: borrar ────────────────────────────────────────────────────────
--
-- Descomenta SÓLO después de revisar el paso 2. Preferible por ids concretos.
--
-- DELETE FROM public.conciliacion_capturas_pendientes
--  WHERE id IN (/* pega aquí los ids */);
--
-- Todos los huérfanos de una vez (sólo si ya revisaste que ninguno hace falta):
--
-- DELETE FROM public.conciliacion_capturas_pendientes
--  WHERE row_id LIKE 'nueva:%';


-- ─── Extra: pendientes que YA están guardados ───────────────────────────────
--
-- Un pendiente con id real cuya columna ya tiene ese mismo valor en
-- "Conciliación Manifiestos" cumplió su función y sobra. La aplicación los
-- retira sola al confirmar la escritura; esto alcanza a los que quedaron de
-- versiones anteriores, cuando el retiro no cubría todos los caminos.

SELECT p.id, p.usuario, p.vuelo, p.columna, p.valor, p.creado_en
  FROM public.conciliacion_capturas_pendientes p
  JOIN public."Conciliación Manifiestos" m
    ON m.id::text = p.row_id
 WHERE p.row_id ~ '^[0-9]+$'
   AND btrim(coalesce(to_jsonb(m) ->> p.columna, '')) = btrim(coalesce(p.valor, ''))
 ORDER BY p.creado_en;

-- DELETE FROM public.conciliacion_capturas_pendientes p
--  USING public."Conciliación Manifiestos" m
--  WHERE m.id::text = p.row_id
--    AND p.row_id ~ '^[0-9]+$'
--    AND btrim(coalesce(to_jsonb(m) ->> p.columna, '')) = btrim(coalesce(p.valor, ''));
