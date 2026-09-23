-- =============================================================================
-- Cierre de Subsecretaría (053) — PRUEBAS DE CONCURRENCIA (v2)
--
-- QUÉ ES ESTO
--   Seis escenarios (B1..B6) para reproducir a mano, con DOS O TRES sesiones
--   SQL independientes (pestañas del SQL Editor de Supabase, o `psql`), el
--   orden de locks que 053 documenta:
--     · captura/edición (INSERT/UPDATE/DELETE/UPSERT) toma
--       pg_advisory_xact_lock_shared(531953, 1) ANTES de sus locks de fila
--       (trigger BEFORE STATEMENT trg_conci_bloquear_escritura_stmt);
--     · cierre / corrección autorizada toma
--       pg_advisory_xact_lock(531953, 1) EXCLUSIVO (_conci_lock_contabilidad),
--       también antes de sus locks de fila.
--   Ese orden fijo (advisory -> fila, para los dos lados) es lo que el diseño
--   usa para EVITAR la inversión de locks que produce deadlocks (captura
--   esperando el exclusivo mientras sostiene una fila que el cierre necesita,
--   y viceversa). Esta prueba busca CONFIRMARLO EMPÍRICAMENTE, observando los
--   locks reales en pg_locks/pg_stat_activity — no es una demostración
--   matemática de que el deadlock es imposible en general, sólo evidencia de
--   que, en estos escenarios, el orden real coincide con el diseñado.
--
-- CORRECCIÓN DE METODOLOGÍA (v2) — LEER ANTES DE USAR v1
--   La versión anterior de este archivo, en B1/B2/B3, tomaba el
--   pg_advisory_xact_lock_shared(531953,1) A MANO antes del INSERT/UPDATE/
--   UPSERT real. Eso invalidaba la prueba: el guion ya había puesto el lock
--   que se suponía debía demostrar que el TRIGGER pone. Con eso, la prueba
--   habría "pasado" igual aunque el trigger real estuviera roto o desactivado.
--   v2 NO toma ningún advisory lock a mano en el lado de captura. Cada vez que
--   una sesión de captura (B) aparece sosteniendo el ShareLock en pg_locks, es
--   porque SU PROPIO INSERT/UPDATE/UPSERT real lo generó como efecto de su
--   trigger BEFORE STATEMENT — nunca porque el guion lo pidió aparte.
--
-- NO EJECUTAR TODAVÍA. Esto es el PROCEDIMIENTO. Ejecutar solo en un entorno
-- aislado (Supabase local o proyecto de prueba separado — nunca producción).
--
-- CÓMO SE LEE CADA ESCENARIO
--   Bloques "-- SESIÓN A" / "-- SESIÓN B" / "-- SESIÓN C". Se ejecutan EN EL
--   ORDEN NUMERADO de "-- PASO N", alternando de pestaña según se indica.
--   "-- ESPERAR AQUÍ" marca el punto exacto en el que esa sesión debe quedar
--   bloqueada (no debe devolver el prompt) hasta que otra sesión termine su
--   paso. Cada escenario cierra con "QUÉ PRUEBA" / "QUÉ NO PRUEBA" y su
--   criterio PASS/FAIL.
--
-- SEGURIDAD CONTRA UNA PRUEBA COLGADA
--   Fijar en CADA sesión, al conectar:
--     SET lock_timeout = '5s';
--     SET statement_timeout = '20s';
--   (statement_timeout no afecta la espera de un humano ENTRE comandos, sólo
--   la ejecución de un comando ya enviado; una sesión "ESPERAR AQUÍ" que de
--   verdad esté bloqueada en un lock cae por lock_timeout a los 5 s si algo no
--   encaja con lo esperado, en vez de colgarse indefinidamente.)
--   El deadlock_timeout de Postgres (1 s por defecto) es la red final: si de
--   verdad existiera una espera circular, el motor la rompe solo y una sesión
--   recibe SQLSTATE 40P01 (deadlock_detected). Ver esa señal es un FAIL de
--   diseño, no un resultado neutro.
--
-- SIMULAR UNA SESIÓN AUTENTICADA DESDE SQL (sólo para invocar los RPC
-- públicos: conciliacion_cerrar_subsecretaria, conciliacion_solicitar_correccion,
-- conciliacion_resolver_solicitud_correccion). Esto NO es "hacer trampa" en el
-- mismo sentido que el defecto corregido arriba: aquí no se sustituye el
-- mecanismo bajo prueba (los locks), sólo se satisface un requisito AJENO
-- (identidad/privilegio/reautenticación, que ya se valida por separado en la
-- sección A de la validación) para poder llegar al código que sí nos interesa
-- ejercitar. Los INSERT/UPDATE/UPSERT de captura de B1/B2/B3, en cambio, NO
-- usan este truco: corren tal cual los correría el cliente real.
--
--     SELECT set_config('request.jwt.claims', json_build_object(
--         'sub', '<uuid de un usuario REAL de auth.users con el privilegio a probar>',
--         'role', 'authenticated',
--         'amr', json_build_array(json_build_object(
--             'method', 'password',
--             'timestamp', extract(epoch FROM now())::bigint
--         ))
--     )::text, true);
--     SET LOCAL ROLE authenticated;
--
--   Sustituir el uuid por uno real de tu entorno de prueba con el flag de
--   privilegio ya asignado (conciliacion_manifiestos_set_privilegio). Sin
--   esto, los RPC fallan con 'Debes iniciar sesión.' antes de llegar a
--   ningún lock — eso confirma que el placeholder falta, no un defecto.
--
-- MARCADORES DE LIMPIEZA
--   Toda fila de prueba lleva "AEROLINEA" = 'PRUEBA-LOCK-<escenario>'. El
--   cliente_uuid de B3 es un UUID FIJO reservado (todo ceros salvo un dígito),
--   nunca gen_random_uuid(): así el mismo literal se puede pegar en el INSERT
--   ... ON CONFLICT sin tener que copiar un valor generado a mano.
--
-- OBSERVACIÓN RÁPIDA (usar en CUALQUIER escenario, desde una sesión aparte)
--   Quién está vivo y en qué está esperando ahora mismo:
--     SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
--       FROM pg_stat_activity
--      WHERE pid <> pg_backend_pid() ORDER BY pid;
--   Detalle de los locks de un pid concreto (sustituir <pid>):
--     SELECT locktype, mode, granted FROM pg_locks WHERE pid = <pid>
--      ORDER BY granted DESC, locktype;
-- =============================================================================


-- =============================================================================
-- ORDEN RECOMENDADO DE EJECUCIÓN Y PUNTOS DE RESET
--
--   1) B1, B2 (a y b), B3 (a y b)  — NINGUNO hace COMMIT de un cierre real.
--      Se pueden correr en cualquier orden entre sí, uno tras otro, SIN
--      `supabase db reset` entre ellos.
--
--   2) B6  — Es el ÚNICO escenario que necesita un COMMIT real de un cierre
--      (es indispensable para demostrar que el SEGUNDO cierre se rechaza).
--      Ese commit cierra "hoy" para el resto de la sesión de pruebas Y deja
--      una fila de prueba REALMENTE cerrada, que se reutiliza como
--      <id_fila_cerrada> en B4/B5. Por eso B6 va DESPUÉS de B1/B2/B3 (que
--      necesitan poder intentar un cierre válido) y ANTES de B4/B5 (que
--      necesitan una fila ya cerrada).
--
--   3) B4, B5  — No hacen ningún COMMIT de cierre (usan la fila que B6 ya
--      cerró). Se pueden correr cualquier número de veces sin reset.
--
--   REQUIERE `supabase db reset` (o recrear el proyecto de prueba) ANTES DE
--   VOLVER A CORRER:
--     · B6 una segunda vez (ya existe un cierre para "hoy": el segundo
--       intento se rechazaría por la razón equivocada — fecha duplicada,
--       no por la mecánica que B6 quiere mostrar por primera vez).
--     · B1, B2b o B3b una segunda vez EN EL MISMO DÍA después de haber
--       corrido B6 (sus sesiones "A" seguirían pudiendo tomar el exclusivo y
--       bloquear correctamente, pero la llamada a conciliacion_cerrar_
--       subsecretaria() fallaría por "ya se realizó el cierre de hoy" antes
--       de llegar al bloque de inclusión que esos escenarios quieren
--       enseñar). Si sólo importa la parte de bloqueo/orden, no hace falta
--       reset; si importa ver la inclusión completa, sí.
--   El resto de las combinaciones no requiere reset.
-- =============================================================================


-- =============================================================================
-- B1. INSERT (captura nueva) vs CIERRE
--
-- Reproduce: una captura que ya está EN VUELO (transacción abierta, con su
-- INSERT real ya ejecutado y su trigger ya corrido) obliga a un cierre
-- concurrente a esperar; al terminar la captura, el cierre continúa e
-- INCLUYE esa fila en su lote.
-- =============================================================================

-- (en cada sesión, al conectar)
SET lock_timeout = '5s';
SET statement_timeout = '20s';

-- SESIÓN B — PASO 1: INSERT real, SIN ningún lock manual. El trigger BEFORE
-- STATEMENT ya corrió como parte de esta sentencia y tomó el ShareLock; la
-- transacción se deja ABIERTA (sin COMMIT) para seguir sosteniéndolo.
BEGIN;
INSERT INTO public."Conciliación Manifiestos" ("AEROLINEA", "FECHA")
VALUES ('PRUEBA-LOCK-B1', to_char(current_date, 'DD/MM/YYYY'))
RETURNING id, cierre_id, cierre_capturado_en;
-- (si tu esquema exige otras columnas NOT NULL sin default, el INSERT falla
-- aquí mismo con un error de columna, antes de tomar ningún lock: añádelas y
-- repite. No afecta el objetivo de la prueba.)
-- Anotar el id devuelto: <id_b1>.

-- SESIÓN C (observador) — confirmar que B YA tiene el ShareLock, generado por
-- su propio trigger, no por nosotros:
SELECT locktype, mode, granted FROM pg_locks
 WHERE pid = (SELECT pid FROM pg_stat_activity
               WHERE query ILIKE '%PRUEBA-LOCK-B1%' LIMIT 1);
-- Esperado: locktype='advisory', classid=531953, objid=1, mode='ShareLock',
-- granted=true.

-- SESIÓN A — PASO 2: intenta el cierre real mientras B sigue abierta.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- ESPERAR AQUÍ: A debe quedarse esperando el exclusivo (531953,1) porque B ya
-- tiene el compartido. Si A NO espera, es FAIL: el orden de locks no está
-- serializando de verdad.

-- SESIÓN C (observador) — confirmar la espera de A:
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
  FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid;
-- Esperado: la sesión de A en wait_event_type='Lock', wait_event='advisory'.

-- SESIÓN B — PASO 3: termina su captura.
COMMIT;

-- SESIÓN A — PASO 4: al liberarse el compartido, A continúa SOLA y termina el
-- cierre. Verificar la inclusión DENTRO de esta misma transacción, antes de
-- decidir qué hacer con ella:
SELECT id, cierre_id, "CIERRE SUBSECRETARIA"
  FROM public."Conciliación Manifiestos" WHERE id = <id_b1>;
-- Esperado: cierre_id = el recién creado por A, "CIERRE SUBSECRETARIA" con la
-- fecha del corte de A.
ROLLBACK;
-- Se usa ROLLBACK y no COMMIT: la inclusión ya quedó demostrada DENTRO de la
-- transacción de A (MVCC no depende de si luego se confirma o no), y así este
-- escenario no consume el único cierre permitido para "hoy" en el entorno de
-- prueba. La fila de B1 queda igual que antes de la prueba (ROLLBACK deshace
-- también su cierre_id).

-- Limpieza opcional de la fila de B (quedó abierta, cierre_id NULL, se puede
-- borrar sin restricción del trigger):
-- DELETE FROM public."Conciliación Manifiestos" WHERE id = <id_b1>;

-- QUÉ PRUEBA: que una captura con su INSERT real ya ejecutado y en vuelo
-- (ShareLock genuino, tomado por su propio trigger) obliga a esperar a un
-- cierre concurrente, y que al liberarse, el cierre incluye correctamente esa
-- fila en su lote.
-- QUÉ NO PRUEBA: el caso simétrico (una captura que INTENTA insertar DESPUÉS
-- de que el cierre ya tiene el exclusivo). Ese caso usa la misma mecánica que
-- B4/B5/B6 (una sesión que ya sostiene el exclusivo bloquea a la otra), y no
-- se repite aquí para no duplicar el archivo.
-- PASS: A esperó en el PASO 2 (evidencia en pg_stat_activity), continuó sólo
-- tras el COMMIT de B, y la fila de B quedó con cierre_id asignado DENTRO de
-- la transacción de A. FAIL: A no esperó, la fila no quedó incluida, o
-- cualquiera de las dos sesiones recibió deadlock_detected (40P01).


-- =============================================================================
-- B2. UPDATE de manifiesto ABIERTO vs CIERRE
--
-- Dos sub-pruebas independientes:
--   B2a — ORDEN interno de la sentencia UPDATE (advisory ANTES que el lock de
--         fila), aislado de cualquier cierre, usando una tercera sesión que
--         bloquea la fila para poder "congelar" la ejecución justo después de
--         que el BEFORE STATEMENT ya corrió.
--   B2b — SERIALIZACIÓN real contra un cierre concurrente (mismo patrón que
--         B1, aplicado a UPDATE de una fila ya existente).
-- =============================================================================

-- Preparación (una vez, COMMIT real — fila ordinaria, no cierra nada):
INSERT INTO public."Conciliación Manifiestos" ("AEROLINEA", "FECHA")
VALUES ('PRUEBA-LOCK-B2', to_char(current_date, 'DD/MM/YYYY'))
RETURNING id;
-- Anotar <id_b2>. COMMIT esta preparación antes de seguir.

-- ── B2a — ORDEN (advisory antes que el lock de fila) ────────────────────────

-- SESIÓN C — PASO 1: toma el lock de fila primero y lo retiene.
BEGIN;
SELECT id FROM public."Conciliación Manifiestos" WHERE id = <id_b2> FOR UPDATE;
-- (se queda así, sin COMMIT)

-- SESIÓN B — PASO 2: UPDATE real, SIN ningún lock manual. Nadie sostiene el
-- exclusivo (531953,1) en este momento, así que el BEFORE STATEMENT de B
-- adquiere el ShareLock AL INSTANTE; lo que congela la sentencia es el lock
-- de fila que ya tiene C.
BEGIN;
UPDATE public."Conciliación Manifiestos" SET "TOTAL PAX" = 111 WHERE id = <id_b2>;
-- ESPERAR AQUÍ: bloqueada por C, DESPUÉS de que su propio trigger ya corrió.

-- SESIÓN OBSERVADORA — evidencia de ORDEN: localizar el pid de B y comprobar
-- que YA tiene el advisory concedido mientras espera el lock de fila:
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
  FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid;
-- (anotar <pid_b>, el que aparece con wait_event_type='Lock' ejecutando el UPDATE)
SELECT locktype, mode, granted FROM pg_locks WHERE pid = <pid_b>
 ORDER BY granted DESC, locktype;
-- Esperado: una fila locktype='advisory', classid=531953, objid=1,
-- mode='ShareLock', granted=TRUE (el trigger YA la obtuvo) y otra fila
-- (locktype='transactionid' o 'tuple', según versión) granted=FALSE — ese
-- segundo lock, no el advisory, es lo que realmente tiene a B esperando.

-- SESIÓN C — PASO 3: libera la fila.
ROLLBACK;

-- SESIÓN B — PASO 4: la sentencia se completa sola.
ROLLBACK; -- (o COMMIT; es un valor de prueba sin efecto contable, no hace falta reset ninguna de las dos formas)

-- QUÉ PRUEBA B2a: que DENTRO de una sola sentencia UPDATE, el advisory
-- ShareLock se adquiere ANTES de que Postgres intente el lock de fila — el
-- orden exacto que impide la inversión captura/cierre. No depende de que haya
-- ningún cierre corriendo a la vez.
-- QUÉ NO PRUEBA B2a: que ese orden efectivamente sirva para esperar a un
-- cierre real (eso es B2b).
-- PASS: en el momento de la espera, B ya tiene el advisory granted=true y
-- espera un lock distinto (de fila/transacción). FAIL: B aparece esperando el
-- advisory en vez del lock de fila (orden invertido), o no aparece sosteniendo
-- el advisory en absoluto (el trigger no corrió), o deadlock.

-- ── B2b — SERIALIZACIÓN contra un cierre real ────────────────────────────────

-- SESIÓN B — PASO 1: UPDATE real, sin lock manual, transacción abierta.
BEGIN;
UPDATE public."Conciliación Manifiestos" SET "TOTAL PAX" = 222 WHERE id = <id_b2>
RETURNING id;
-- (no COMMIT todavía: B sostiene el ShareLock real, tomado por su trigger)

-- SESIÓN A — PASO 2: intenta el cierre real.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- ESPERAR AQUÍ (A espera el exclusivo, igual razón que en B1).

-- SESIÓN B — PASO 3:
COMMIT;

-- SESIÓN A — PASO 4: verificar inclusión CON el valor actualizado, dentro de
-- la propia transacción de A, y luego deshacer el cierre de prueba:
SELECT id, "TOTAL PAX", cierre_id FROM public."Conciliación Manifiestos" WHERE id = <id_b2>;
-- Esperado: "TOTAL PAX" = 222 (el valor de B, no uno anterior) y cierre_id
-- asignado por A.
ROLLBACK;

-- QUÉ PRUEBA B2b: que editar una fila TODAVÍA ABIERTA mientras el corte está
-- en curso se serializa igual que un INSERT (B1), y que el cierre ve el valor
-- YA actualizado (nunca uno anterior).
-- QUÉ NO PRUEBA: el orden interno advisory-antes-que-fila (eso es B2a).
-- PASS/FAIL: igual criterio que B1.


-- =============================================================================
-- B3. UPSERT por cliente_uuid vs CIERRE — probando de verdad la rama
-- ON CONFLICT DO UPDATE (no sólo el camino de INSERT limpio)
--
-- Dos sub-pruebas, mismo patrón que B2: B3a (orden, vía tercera sesión) y
-- B3b (serialización real contra un cierre).
-- =============================================================================

-- Preparación (una vez, COMMIT real): fila abierta con un cliente_uuid FIJO y
-- conocido — NUNCA gen_random_uuid(), justamente para poder reutilizar el
-- MISMO literal después en el ON CONFLICT y forzar la rama DO UPDATE.
INSERT INTO public."Conciliación Manifiestos" ("AEROLINEA", "FECHA", cliente_uuid)
VALUES ('PRUEBA-LOCK-B3-INICIAL', to_char(current_date, 'DD/MM/YYYY'),
        '11111111-1111-1111-1111-111111111111')
RETURNING id;
-- Anotar <id_b3>. COMMIT esta preparación antes de seguir.

-- ── B3a — ORDEN, forzando la rama DO UPDATE ─────────────────────────────────

-- SESIÓN C — PASO 1: bloquea la fila del cliente_uuid conocido.
BEGIN;
SELECT id FROM public."Conciliación Manifiestos"
 WHERE cliente_uuid = '11111111-1111-1111-1111-111111111111' FOR UPDATE;
-- (se queda así, sin COMMIT)

-- SESIÓN B — PASO 2: UPSERT real usando EXACTAMENTE el mismo UUID — esto SÍ
-- entra por la rama ON CONFLICT DO UPDATE, porque la fila con ese cliente_uuid
-- ya existe (la creó la preparación de arriba). Sin lock manual.
BEGIN;
INSERT INTO public."Conciliación Manifiestos" ("AEROLINEA", "FECHA", cliente_uuid)
VALUES ('PRUEBA-LOCK-B3-NUEVO', to_char(current_date, 'DD/MM/YYYY'),
        '11111111-1111-1111-1111-111111111111')
ON CONFLICT (cliente_uuid) DO UPDATE SET "AEROLINEA" = excluded."AEROLINEA"
RETURNING id, cierre_id;
-- ESPERAR AQUÍ: bloqueada por C (el conflicto necesita el lock de la fila
-- existente), DESPUÉS de que el BEFORE STATEMENT de B ya corrió.

-- SESIÓN OBSERVADORA — misma evidencia que B2a: localizar <pid_b> y comprobar
-- advisory ShareLock granted=true + un segundo lock granted=false.
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
  FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid;
SELECT locktype, mode, granted FROM pg_locks WHERE pid = <pid_b>
 ORDER BY granted DESC, locktype;

-- SESIÓN C — PASO 3:
ROLLBACK;

-- SESIÓN B — PASO 4: la sentencia se completa. Verificar que fue la rama
-- DO UPDATE (mismo id que la fila preparada, no una fila nueva) y que el
-- valor cambió:
-- (el RETURNING del PASO 2 ya debería mostrar id = <id_b3>)
SELECT id, "AEROLINEA" FROM public."Conciliación Manifiestos" WHERE id = <id_b3>;
-- Esperado: id = <id_b3> (MISMA fila, no una nueva) y "AEROLINEA" =
-- 'PRUEBA-LOCK-B3-NUEVO'.
ROLLBACK; -- o COMMIT; valor de prueba sin efecto contable, no requiere reset.

-- QUÉ PRUEBA B3a: que la rama ON CONFLICT DO UPDATE, no sólo el INSERT limpio,
-- también respeta el orden advisory-antes-que-fila. Corrige el defecto de la
-- v1 (que sólo probaba INSERT porque usaba gen_random_uuid()).
-- QUÉ NO PRUEBA: la serialización contra un cierre real (eso es B3b).
-- PASS/FAIL: igual criterio que B2a, y además: FAIL si el id devuelto por el
-- UPSERT fuera distinto de <id_b3> (señal de que en realidad insertó una fila
-- nueva en vez de tomar la rama DO UPDATE — indicaría que el cliente_uuid no
-- se reusó correctamente en la prueba, no un defecto del sistema).

-- ── B3b — SERIALIZACIÓN contra un cierre real ───────────────────────────────

-- SESIÓN B — PASO 1: UPSERT real (rama DO UPDATE), transacción abierta.
BEGIN;
INSERT INTO public."Conciliación Manifiestos" ("AEROLINEA", "FECHA", cliente_uuid)
VALUES ('PRUEBA-LOCK-B3-SERIAL', to_char(current_date, 'DD/MM/YYYY'),
        '11111111-1111-1111-1111-111111111111')
ON CONFLICT (cliente_uuid) DO UPDATE SET "AEROLINEA" = excluded."AEROLINEA"
RETURNING id, cierre_id;
-- (no COMMIT: B sostiene el ShareLock real)

-- SESIÓN A — PASO 2:
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- ESPERAR AQUÍ.

-- SESIÓN B — PASO 3:
COMMIT;

-- SESIÓN A — PASO 4:
SELECT id, "AEROLINEA", cierre_id FROM public."Conciliación Manifiestos" WHERE id = <id_b3>;
-- Esperado: "AEROLINEA" = 'PRUEBA-LOCK-B3-SERIAL', cierre_id asignado por A.
ROLLBACK;

-- QUÉ PRUEBA B3b: que el camino de guardado MÁS USADO en producción (autosave
-- por celda vía UPSERT cliente_uuid) se serializa igual que un INSERT/UPDATE
-- ordinario frente a un cierre concurrente.
-- QUÉ NO PRUEBA: el orden interno (eso es B3a).
-- PASS/FAIL: igual criterio que B1/B2b.


-- =============================================================================
-- B4. CORRECCIÓN DIRECTA (usuario que YA puede autorizar) vs CIERRE
--
-- Alcance deliberadamente acotado: sólo la EXCLUSIÓN MUTUA entre una
-- corrección directa y un cierre (que nunca corren en paralelo, porque toman
-- el MISMO exclusivo). No repite la demostración de "inclusión en el
-- resultado", que B1/B2b/B3b ya cubren con el mismo mecanismo.
--
-- Requiere <id_fila_cerrada>: usar la fila que quedó cerrada al ejecutar B6
-- (ver el orden recomendado al inicio del archivo). Si B6 todavía no corrió,
-- este escenario no tiene una fila cerrada real que corregir.
-- =============================================================================

-- SESIÓN A — PASO 1: corrección directa real (usuario con
-- conciliacion_autoriza_correccion), se queda a mitad, sin COMMIT.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio autorizar_correccion>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_solicitar_correccion(
    <id_fila_cerrada>, 'TOTAL PAX', '180', 'Prueba de concurrencia B4'
);
-- (no COMMIT: A sostiene el exclusivo real, tomado por _conci_lock_contabilidad())

-- SESIÓN B — PASO 2: intenta el cierre mientras A retiene el exclusivo.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- ESPERAR AQUÍ: B debe esperar el exclusivo que ya tiene A (exclusivo vs
-- exclusivo: espera franca, no la espera "compartido esperando exclusivo" de
-- los escenarios anteriores).
--
-- NOTA: si ya corriste B6 antes en este mismo entorno, cuando B por fin
-- obtenga el lock recibirá el error "Ya se realizó el Cierre de Subsecretaría
-- del %" — eso es ESPERADO (hoy ya está cerrado por B6) y no invalida nada:
-- lo que este escenario demuestra es que B ESPERÓ, no si su cierre prospera.

-- SESIÓN OBSERVADORA — confirmar que B espera el advisory EXCLUSIVO mientras
-- A lo sostiene:
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
  FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid;

-- SESIÓN A — PASO 3:
ROLLBACK; -- deshace la corrección de prueba (append-only: no queda ledger falso)

-- SESIÓN B — PASO 4: se desbloquea; recibe éxito (si "hoy" seguía abierto) o
-- el error de fecha duplicada (si ya corriste B6 antes) — cualquiera de los
-- dos es consistente con lo que este escenario prueba.
ROLLBACK;

-- QUÉ PRUEBA: que una corrección directa y un cierre NUNCA corren en
-- paralelo: comparten el mismo exclusivo de contabilidad.
-- QUÉ NO PRUEBA: que el ajuste de la corrección quede efectivamente consumido
-- por un cierre posterior (eso exigiría un COMMIT real de A y, si además se
-- quisiera ver consumido por un cierre NUEVO, un `supabase db reset` primero
-- porque "hoy" ya estaría cerrado por B6; queda fuera de este archivo por no
-- ser indispensable para lo que B4 afirma).
-- PASS: B esperó todo el tiempo que A tuvo el exclusivo (evidencia en
-- pg_stat_activity). FAIL: B no esperó (corrió en paralelo), o deadlock.


-- =============================================================================
-- B5. CREAR una solicitud (usuario SIN privilegio) NO se bloquea contra un
-- cierre en curso; RESOLVERLA (usuario CON privilegio) SÍ.
--
-- Orden exacto (así se pidió corregir): el cierre arranca PRIMERO y se
-- mantiene abierto reteniendo el exclusivo; MIENTRAS sigue abierto, se crea la
-- solicitud (debe terminar de inmediato); DESPUÉS se intenta resolverla (debe
-- esperar); al terminar el cierre, la resolución continúa.
--
-- Requiere <id_fila_cerrada>: la misma de B4 (la que dejó cerrada B6).
-- =============================================================================

-- SESIÓN A — PASO 1: arranca el cierre PRIMERO y se queda reteniendo el
-- exclusivo (no hace falta que este cierre prospere: si "hoy" ya está cerrado
-- por B6, este PASO igual toma el lock y sólo al final —tras el PASO 4—
-- fallará con "ya se realizó"; eso no afecta lo que B5 demuestra).
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- (no COMMIT: A sostiene el exclusivo)

-- SESIÓN B — PASO 2: MIENTRAS A sigue abierta, un usuario SIN privilegio de
-- autorizar crea la solicitud. Esta rama NO llama a _conci_lock_contabilidad()
-- (ver el código de conciliacion_solicitar_correccion: la rama "no puede
-- autorizar" sólo hace un SELECT simple + un INSERT en conciliacion_
-- correcciones), así que debe devolver el prompt DE INMEDIATO, sin esperar
-- nada, pese a que A tiene el exclusivo tomado en ese mismo instante.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario capturista/editor SIN privilegios>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_solicitar_correccion(
    <id_fila_cerrada>, 'TOTAL PAX', '200', 'Prueba de concurrencia B5'
);
-- Debe responder al instante. Anotar el solicitud_id devuelto: <id_solicitud>.
COMMIT;
-- Este COMMIT SÍ es necesario (para que la sesión C, en el PASO 3, pueda ver
-- la solicitud desde otra transacción) pero es INOCUO: no toca cierres, no
-- toca contabilidad, no requiere reset.

-- SESIÓN C — PASO 3: un usuario CON privilegio de autorizar intenta RESOLVER
-- (aprobar) esa solicitud, todavía con A reteniendo el exclusivo.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio autorizar_correccion>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_resolver_solicitud_correccion(<id_solicitud>, true, 'Aprobada en prueba B5');
-- ESPERAR AQUÍ: a diferencia del PASO 2, resolver SÍ toma el exclusivo
-- (_conci_lock_contabilidad dentro de conciliacion_resolver_solicitud_correccion),
-- así que debe quedarse esperando a A.

-- SESIÓN OBSERVADORA — confirmar: C esperando el advisory EXCLUSIVO; el PASO 2
-- de B, en cambio, NUNCA debió aparecer aquí como "esperando" (ya había
-- terminado y hecho commit antes de que se tomara esta foto).
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
  FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid;

-- SESIÓN A — PASO 4: termina (ver nota del PASO 1 sobre el posible error de
-- fecha duplicada si ya corriste B6; en cualquier caso, ROLLBACK libera el
-- exclusivo).
ROLLBACK;

-- SESIÓN C — PASO 5: se desbloquea y completa la aprobación. Verificar, DENTRO
-- de esta misma transacción, que el ajuste resultante queda para el SIGUIENTE
-- cierre (no consumido por ninguno todavía):
SELECT id, estado, cierre_aplicacion_id, aprobado_en
  FROM public.conciliacion_ajustes
 WHERE manifiesto_id = <id_fila_cerrada> ORDER BY id DESC LIMIT 1;
-- Esperado: estado='pendiente' (default de la tabla), cierre_aplicacion_id
-- IS NULL: el instante lógico de esta aprobación es POSTERIOR al de
-- cualquier cierre ya hecho, así que espera al próximo.
ROLLBACK;

-- QUÉ PRUEBA: (1) crear una solicitud NUNCA se bloquea contra un cierre en
-- curso, aunque éste sostenga el exclusivo — es una operación que no toca la
-- contabilidad oficial; (2) resolver (aprobar) una solicitud SÍ se serializa
-- contra el cierre, con el mismo exclusivo; (3) el ajuste que resulta de una
-- aprobación posterior a un cierre queda correctamente pendiente para el
-- siguiente, nunca se cuela en uno que ya pasó.
-- QUÉ NO PRUEBA: el caso de RECHAZO (p_aprobar=false) — usa el mismo lock por
-- código, así que no se considera un camino adicional de riesgo, pero no se
-- ejercita aquí explícitamente.
-- PASS: el PASO 2 no esperó nada (no aparece en la foto de pg_stat_activity
-- como bloqueado); el PASO 3 SÍ esperó a A; el ajuste queda 'pendiente' con
-- cierre_aplicacion_id NULL. FAIL: crear la solicitud se bloqueó (violaría el
-- diseño), o resolver no esperó, o el ajuste apareciera ya con un
-- cierre_aplicacion_id asignado, o deadlock.


-- =============================================================================
-- B6. DOS CIERRES SIMULTÁNEOS
--
-- Único escenario de este archivo que termina con un COMMIT real de un
-- cierre — es indispensable: sin un cierre REALMENTE persistido no hay forma
-- de que el segundo intento lo vea y se rechace por fecha duplicada (un
-- ROLLBACK no deja nada que el otro pueda "ver"). Ese commit, además, deja la
-- fila de prueba de este escenario CERRADA de verdad, que se reutiliza como
-- <id_fila_cerrada> en B4 y B5.
--
-- No se fija fecha_corte a mano: el RPC la determina solo, como HOY en
-- America/Mexico_City. Por eso este escenario debe correrse UNA sola vez por
-- día de calendario del entorno de prueba sin un reset de por medio.
--
-- DEFECTO CORREGIDO — CONTAMINACIÓN DESDE B1/B2/B3
-- B1/B2/B3 terminan en ROLLBACK del lado del CIERRE, pero las filas de
-- CAPTURA que insertaron/actualizaron ('PRUEBA-LOCK-B1', 'PRUEBA-LOCK-B2', y
-- las tres variantes de 'PRUEBA-LOCK-B3-*' sobre el mismo cliente_uuid) sí
-- pueden quedar vivas y ABIERTAS (cierre_id IS NULL) después de esos
-- escenarios. Un cierre real como el de B6 no distingue "a qué escenario
-- pertenece" una fila abierta: cierra TODO lo que cumpla el criterio del
-- lote. Sin retirarlas antes, B6 cerraría también esas filas ajenas, y su
-- snapshot ya no contendría ÚNICAMENTE 'PRUEBA-LOCK-B6'. Los cuatro pasos de
-- abajo (limpieza → preparar B6 → ejecutar B6 → verificar el contenido)
-- existen exactamente para evitar eso.
-- =============================================================================

-- 1) LIMPIEZA — retirar TODAS las filas abiertas que pudieran haber dejado
-- B1/B2/B3, identificadas ÚNICAMENTE por los marcadores propios de este
-- archivo, y ÚNICAMENTE si siguen abiertas (cierre_id IS NULL). Nunca un
-- DELETE genérico: una fila con estos mismos marcadores que YA estuviera
-- cerrada (cierre_id NOT NULL, de una corrida anterior de B6) no la toca este
-- DELETE — el trigger tampoco lo permitiría.
DELETE FROM public."Conciliación Manifiestos"
 WHERE cierre_id IS NULL
   AND (
        "AEROLINEA" IN (
            'PRUEBA-LOCK-B1',
            'PRUEBA-LOCK-B2',
            'PRUEBA-LOCK-B3-INICIAL',
            'PRUEBA-LOCK-B3-NUEVO',
            'PRUEBA-LOCK-B3-SERIAL'
        )
        OR cliente_uuid = '11111111-1111-1111-1111-111111111111'
   );

-- Verificar que no quede NINGUNA fila abierta con marcadores de B1/B2/B3:
SELECT id, "AEROLINEA", cliente_uuid, cierre_id
  FROM public."Conciliación Manifiestos"
 WHERE "AEROLINEA" LIKE 'PRUEBA-LOCK-B1%'
    OR "AEROLINEA" LIKE 'PRUEBA-LOCK-B2%'
    OR "AEROLINEA" LIKE 'PRUEBA-LOCK-B3%'
    OR cliente_uuid = '11111111-1111-1111-1111-111111111111';
-- Esperado: 0 filas. Si aparece alguna CON cierre_id NOT NULL, no es un
-- residuo que este DELETE debiera haber tocado: es evidencia de que un cierre
-- (B6 u otro) ya corrió antes sobre estos marcadores en este entorno — hace
-- falta `supabase db reset` antes de continuar, no un DELETE adicional (las
-- tablas del mecanismo son inmutables desde el cliente una vez cerradas).

-- 2) CREAR 'PRUEBA-LOCK-B6' — única fila de prueba que debe llegar abierta a
-- este cierre. COMMIT real: fila abierta ordinaria, no cierra nada por sí
-- misma, sólo asegura que el cierre de A tenga algo que cerrar (evita el
-- rechazo "no se puede realizar un cierre vacío" por una razón ajena a lo que
-- B6 quiere mostrar).
INSERT INTO public."Conciliación Manifiestos" ("AEROLINEA", "FECHA")
VALUES ('PRUEBA-LOCK-B6', to_char(current_date, 'DD/MM/YYYY'))
RETURNING id;
-- Anotar <id_b6>. COMMIT esta preparación antes de seguir.

-- 3) HACER B6 — dos cierres reales concurrentes:

-- SESIÓN A — PASO 1: toma el exclusivo primero y se queda a mitad.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- (no COMMIT todavía)

-- SESIÓN B — PASO 2: el mismo intento, en paralelo (puede ser el mismo
-- usuario u otro con el mismo privilegio).
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', '<uuid usuario con privilegio cerrar>', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.conciliacion_cerrar_subsecretaria();
-- ESPERAR AQUÍ: B debe quedarse esperando el exclusivo de A.

-- SESIÓN OBSERVADORA:
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query
  FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid;

-- SESIÓN A — PASO 3: ESTE SÍ es un COMMIT real y deliberado.
COMMIT;
-- >>> A PARTIR DE AQUÍ, "hoy" queda cerrado de verdad en este entorno. <<<

-- SESIÓN B — PASO 4: al liberarse el lock, B relee el máximo fecha_corte (ya
-- actualizado por A) y debe RECHAZARSE con "Ya se realizó el Cierre de
-- Subsecretaría del %" (SQLSTATE 23505) — nunca un segundo cierre para la
-- misma fecha, nunca una espera indefinida.
ROLLBACK; -- obligatorio: la excepción deja la transacción de B abortada.

-- Confirmar que sólo existe UN cierre para la fecha de hoy:
SELECT fecha_corte, count(*) FROM public.conciliacion_cierres_subsecretaria
 GROUP BY fecha_corte HAVING count(*) > 1;
-- Esperado: 0 filas.

-- 4) VERIFICAR EL CONTENIDO DEL CIERRE — el snapshot de B6 debe contener
-- ÚNICAMENTE 'PRUEBA-LOCK-B6' entre las filas de prueba, nunca residuos de
-- B1/B2/B3 (que el paso 1 ya retiró antes de que este cierre pudiera verlas):
SELECT s.manifiesto_id, s.datos_snapshot ->> 'AEROLINEA' AS aerolinea
  FROM public.conciliacion_cierres_snapshot s
  JOIN public.conciliacion_cierres_subsecretaria c ON c.id = s.cierre_id
 WHERE c.fecha_corte = (now() AT TIME ZONE 'America/Mexico_City')::date
   AND s.datos_snapshot ->> 'AEROLINEA' LIKE 'PRUEBA-LOCK-%';
-- Esperado: EXACTAMENTE una fila, aerolinea = 'PRUEBA-LOCK-B6'. Si aparece
-- cualquier 'PRUEBA-LOCK-B1', 'PRUEBA-LOCK-B2' o 'PRUEBA-LOCK-B3-*', el paso 1
-- no se ejecutó o no alcanzó a esa fila (ejecutarlo antes de confiar en
-- <id_fila_cerrada> para B4/B5).

-- Anotar <id_fila_cerrada> := <id_b6> para reutilizar en B4 y B5.

-- QUÉ PRUEBA: que nunca pueden existir dos cortes con la misma fecha_corte;
-- el segundo intento espera y luego se rechaza con un mensaje legible, nunca
-- con una segunda fila ni con un deadlock.
-- QUÉ NO PRUEBA: la exclusión mutua entre cierre y CORRECCIÓN (eso es B4/B5);
-- aquí ambos lados son cierres.
-- PASS: B esperó, luego fue rechazado con el mensaje esperado; la consulta
-- final no devuelve ninguna fecha duplicada.
-- FAIL: se crearon dos cierres para la misma fecha (violaría incluso el
-- UNIQUE — grave si ocurre), o cualquiera de las dos sesiones recibió
-- deadlock_detected.
--
-- >>> REQUIERE `supabase db reset` ANTES DE VOLVER A CORRER B6, O ANTES DE
-- VOLVER A CORRER B1/B2b/B3b SI SE QUIERE VER SU PARTE DE "INCLUSIÓN" (la
-- parte de bloqueo/espera de esos tres NO depende de esto). B4 y B5 SÍ pueden
-- correr ahora mismo, usando <id_fila_cerrada>. <<<


-- =============================================================================
-- LIMPIEZA
-- =============================================================================

-- CASO A — llegaste hasta B6 (siguiendo el orden recomendado del archivo):
-- las filas de B1/B2/B3 YA NO EXISTEN. El paso 1 de B6 ("LIMPIEZA — retirar
-- TODAS las filas abiertas que pudieran haber dejado B1/B2/B3") las borró
-- ANTES de que B6 pudiera verlas, así que no queda nada de ellas que limpiar
-- aquí. Lo único que queda es la fila 'PRUEBA-LOCK-B6', que a esta altura ya
-- está REALMENTE CERRADA (cierre_id NOT NULL) por el COMMIT real de B6. El
-- trigger impide borrarla directamente y las tablas del mecanismo no aceptan
-- DELETE de ningún cliente; la limpieza correcta, en un entorno de prueba
-- aislado, es recrear la base:
--   supabase db reset
-- (o borrar/recrear el proyecto de prueba separado). No intentar deshacer un
-- cierre a mano: snapshot y ledger son inmutables por diseño.

-- CASO B — corriste sólo B1/B2/B3 (y sub-partes) y NO llegaste a B6 todavía:
-- sus filas de prueba pueden seguir abiertas (cierre_id NULL) y se pueden
-- borrar sin restricción del trigger con el MISMO DELETE que usa el paso 1 de
-- la preparación de B6 (reproducido aquí para poder limpiar sin tener que
-- llegar hasta B6):
-- DELETE FROM public."Conciliación Manifiestos"
--  WHERE cierre_id IS NULL
--    AND (
--         "AEROLINEA" IN ('PRUEBA-LOCK-B1','PRUEBA-LOCK-B2',
--                        'PRUEBA-LOCK-B3-INICIAL','PRUEBA-LOCK-B3-NUEVO',
--                        'PRUEBA-LOCK-B3-SERIAL')
--         OR cliente_uuid = '11111111-1111-1111-1111-111111111111'
--    );
-- =============================================================================
