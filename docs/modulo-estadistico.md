# Módulo estadístico de operaciones

Vive dentro de **Conciliación → Estadística**, repartido en sub-pestañas. La última,
*Informe oficial*, es el módulo que ya existía y **no se tocó**: sigue generando sus dos PDF
institucionales exactamente igual que antes.

---

## 1. Fuente de datos

```
public.vw_maestra_operaciones          ← fuente principal (manda el conjunto de filas)
        └─ JOIN public.maestra_operaciones mo ON mo.id = v.id
                                       ← columnas operacionales crudas
                    ↓
public.mv_estadistica_operaciones      ← una fila por MOVIMIENTO, ya resuelta (040)
                    ↓
public.estadistica_agregado(...)       ← el único motor de métricas
                    ↓
js/estadistica-motor.js                ← formato, comparaciones y validaciones
js/estadistica-panel.js                ← pantallas
```

**Por qué se leen las dos y no sólo la vista.** `vw_maestra_operaciones` fue creada
directamente en Supabase y no está versionada en este repositorio, así que su lista exacta de
columnas no se puede dar por conocida; las de `maestra_operaciones`, en cambio, están
documentadas por las migraciones 023, 024, 025, 032, 033 y 034. De la vista se toma sólo lo que
el repositorio documenta que resuelve: `id`, `aerolinea`, `matricula`, `causa_demora` y
`fuente_principal` (bloque de verificación de la 023) y `matricula_estatus` (comentario de la
032). Además, las columnas que agrega la migración 037 no aparecerían en la vista aunque se
hubiera definido como `SELECT mo.*`: Postgres expande el asterisco al crearla y no lo vuelve a
expandir después.

La migración 038 abre con un **contrato de columnas**: si falta alguna, aborta diciendo cuál,
antes de crear nada.

---

## 2. Definiciones canónicas de las métricas

Todas viven en `public.estadistica_agregado` (migración 040). Ninguna se vuelve a escribir en
JavaScript: Resumen, Explorador, Comparador, Descargas y cada área piden lo mismo a la misma
función.

| Métrica | Definición |
|---|---|
| Operación | `count(*) FILTER (WHERE NOT es_cancelada)` |
| Operaciones canceladas | `count(*) FILTER (WHERE es_cancelada)` — se reportan, no se cuentan |
| PAX total | `sum(pax)` sobre no canceladas = pax de llegada + pax de salida |
| Carga transportada | `sum(carga_total_kg)` |
| Carga descargada / embarcada | columna capturada si existe; si no, transportada − tránsito |
| Carga en tránsito | `sum(transito_contable_kg)` — atribuida **una vez por rotación** |
| Factor de ocupación | `100 · sum(pax) / sum(capacidad)` sobre las filas con **ambas** cifras |
| Cumple ventana de slot | ANTES + EN TIEMPO + DESPUÉS ÷ operaciones evaluables |
| Desviación contra slot | `hora_operacion − slot_vigente`, en minutos |
| Demora operacional | `minutos_demora` capturado, o `hora_real − hora_programada` |
| Tiempo en tierra | salida − llegada de la misma rotación, atribuido a la salida |
| Pernocta | `hora_termino_pernocta − hora_inicio_pernocta` |

### Cancelaciones

Se excluyen de **toda** métrica operacional. La bandera `cancelado` de la operación es la
señal principal; los dos criterios de texto quedan como respaldo, porque la columna nace en
`false` y las filas históricas pueden no haberse marcado nunca. La columna
`cancelado_origen` dice de cuál de las tres salió cada cancelación.

- `estatus_vuelo` (el `Status` del AODB) contra `cancel|not.?oper|no.?opera|cnx|nop\y` —
  el mismo patrón, letra por letra, que `_EXCLUDED_STATUS_RE` en
  `js/parte-ops-flights.js:1338` (`\y` es el límite de palabra de Postgres, `\b` el de JS).
- `estado_puntualidad` (columna «PUNTUALIDAD / CANCELACIÓN» del manifiesto) igual a
  `CANCELADO`/`CANCELADA` — mismo criterio que `js/analisis-operaciones.js:2639`.

Se implementan como `FILTER (WHERE NOT m.es_cancelada)` en cada agregado, no como un `WHERE`
global, para poder seguir informando cuántas hubo.

### Puntualidad: se mide contra el SLOT, no contra la hora programada

```
slot_vigente = coalesce(slot_coordinado, slot_asignado)
diferencia   = hora_operacion − slot_vigente

  < -15 min   ANTICIPADO   ─ fuera de ventana
  -15 a -1    ANTES        ┐
   0          EN TIEMPO    ├ cumple la ventana del slot
  +1 a +15    DESPUÉS      ┘
  > +15       DEMORA       ─ fuera de ventana
```

`slot_coordinado` es un cambio posterior **ya autorizado**: en cuanto existe, es la
referencia válida; `slot_asignado` es el permiso inicial de la aerolínea. `hora_programada`
**no** sustituye al slot para esta clasificación.

ANTICIPADO queda **fuera de ventana** igual que DEMORA: el slot es una ventana, no un techo.

La **demora operacional** (`minutos_demora`) es un concepto distinto y se conserva aparte:
mide el retraso del vuelo, no el cumplimiento del permiso. Confundirlas sería el error de
fondo. Cuando no hay slot o no hay hora de operación, se toma el dictamen ya calculado en
`estado_puntualidad`, que la fuente llena con este mismo vocabulario.

### Nacional / Internacional: manda lo declarado

`tipo_operacion` es el campo que la fuente llena con NACIONAL / INTERNACIONAL, así que es la
declaración oficial y tiene prioridad. Sólo si no viene se deriva del catálogo de aeropuertos
(un código OACI mexicano `MMxx` es nacional aunque el catálogo no lo tenga). Si ninguna de las
dos resuelve, queda en `NULL` — no se supone «nacional». `nacint_origen` dice cuál de las dos
se usó.

### El nombre del origen/destino no se pierde

El IATA **no reemplaza** al nombre: `destino_origen = "CANCÚN"` convive con
`destino_iata = "CUN"`. Cuando el aeropuerto no se pudo identificar de forma inequívoca,
`endpoint_codigo` queda `NULL` y `endpoint_nombre` conserva lo que entregó la fuente.

### Factor de ocupación

Es `SUM(pax) / SUM(capacidad)`, **no** `AVG(pax/capacidad)`: con dos vuelos de 180/180 y 20/200
el promedio de cocientes da 55 % y la definición correcta 52.63 %.

Numerador y denominador se calculan sobre **el mismo conjunto de filas** (`ocupacion_evaluable`
= tiene pax **y** capacidad). Capacidad `NULL`, `0` o negativa se trata como desconocida y la
operación sale del cálculo, no entra con cero. La pantalla acompaña el indicador con su
**cobertura** (`1,245 de 1,310 · 95.0 %`) para que se vea qué tan representativo es.

La capacidad viene de `maestra_operaciones.capacidad_max_pax` — la configuración real de ese
vuelo — y, a falta de ella, de `matriculas_manifiestos.pasajeros` (migración 006), que es por
matrícula, es decir por aeronave concreta y no por modelo. `capacidad_origen` dice cuál de las
dos se usó. El módulo estadístico **no** mantiene una capacidad propia.

La columna `ocupacion` de la operación (ya calculada por fila) **no** se usa para el
indicador: promediar porcentajes por fila da otro número. Se publica como
`ocupacion_reportada` para poder contrastarla y detectar capturas incoherentes.

---

## 3. Clasificación operacional

Dos dimensiones **independientes**, no una sola excluyente:

- **Segmento de aviación**: `COMERCIAL` | `GENERAL`
- **Naturaleza de la operación**: `PASAJEROS` | `CARGA` | `MIXTA` | `OTRA`

Una operación `MIXTA` participa en las estadísticas de pasajeros **y** en las de carga: los
filtros del módulo la incluyen en ambas (`NATURALEZA_PASAJEROS` y `NATURALEZA_CARGA` en
`js/estadistica-motor.js`).

### Cómo gana una regla

`public.estadistica_resolver_clasificacion(fecha, aerolinea_id, aerolinea_texto, tipo_aeronave,
tipo_servicio)` es la definición canónica. De todas las reglas activas cuya vigencia cubre la
**fecha de operación** y cuyos criterios no nulos coinciden:

1. menor `prioridad` gana;
2. a igual prioridad, la **más específica** (más criterios no nulos);
3. a igual especificidad, la de `id` mayor (la más reciente).

**Si ninguna regla la cubre, la operación queda SIN CLASIFICAR.** No se adivina. Aparece en
*Clasificación → Operaciones sin clasificar*, agrupada por la combinación de criterios que haría
falta, con un botón que crea la regla con esos criterios ya cargados.

### Reproducibilidad histórica

Las reglas llevan `vigente_desde` / `vigente_hasta` y se comparan contra la fecha de operación,
nunca contra `current_date`. Para cambiar un criterio **a partir de** cierta fecha no se edita la
regla: el botón *Reemplazar desde una fecha* cierra la vigente el día anterior y crea la nueva.
Las estadísticas ya publicadas se siguen reproduciendo igual.

Se evaluó **congelar** la clasificación en una columna de `maestra_operaciones` al capturar. Se
descartó: congela también los errores, y corregir seis meses mal clasificados obligaría a un
reproceso masivo de la tabla auditada. El costo de resolver por reglas se paga una sola vez, en
la vista materializada.

### Semilla

La migración 039 (opcional) carga un punto de partida revisable: 24 reglas por tipo de servicio
traducidas del catálogo `flight_service_type` (prioridad 300) y reglas por aerolínea copiadas de
`conciliacion_catalogo_aerolineas.types` (prioridad 500), que es la clasificación que el sistema
usa hoy. El tipo de servicio gana sobre la aerolínea porque describe *ese* vuelo. Se reconocen
por la etiqueta `[semilla-039]` en observaciones.

---

## 4. Carga: transportada, manejada y en tránsito

Tres conceptos distintos, y **dos dimensiones ortogonales**:

- **Nacional / Internacional** → naturaleza territorial del movimiento.
- **Descargada / Embarcada / En tránsito** → tratamiento de la carga en AIFA.

No son excluyentes: una carga en tránsito puede ser internacional.

### Identidad contable

```
LLEGADA:  transportada = descargada + tránsito
SALIDA:   transportada = embarcada  + tránsito
```

La migración 037 agrega `carga_descargada_kg`, `carga_embarcada_kg` y `carga_transito_kg` a
`maestra_operaciones`. Son **columnas** y no una tabla aparte porque tienen el mismo grano que
`carga_total_kg`, que ya vive en esa fila: una tabla 1:1 sólo agregaría un JOIN obligatorio a la
consulta más caliente del módulo. Arrancan en `NULL` y no se deriva ningún valor: `NULL` es «no
se capturó», distinto de `0` («se capturó y no hubo»).

### Doble conteo del tránsito

Las mismas 30 toneladas que llegan a bordo y siguen a bordo aparecen en la llegada **y** en la
salida. Contarlas dos veces duplicaría la estadística.

**Rotación.** Tres niveles, en orden de confianza: `rotacion_key` (la clave explícita),
`movimiento_relacionado_id` (el vuelo relacionado por FK a la propia tabla) y, como último
recurso, `aodb_legacy_id`. Con `movimiento_relacionado_id` la clave es el par ordenado
`{menor, mayor}`, para que los dos lados caigan en la misma partición apunte quien apunte a
quién. Poder emparejar la rotación es además lo que hace medible el **tiempo en tierra**
(turnaround), que se atribuye a la **salida** para no contarlo dos veces.

El respaldo `aodb_legacy_id` ya estaba en el modelo desde la migración 023: una fila
del AODB (`itinerario_vuelos_editable`) es un vuelo-día ancho con lado de llegada y lado de
salida, y los dos movimientos que produce comparten ese id. Eso *es* la rotación. No se emparejan
movimientos por matrícula + hora, que confunde dos rotaciones de la misma matrícula el mismo día.

**Atribución.** La columna `transito_contable_kg` de la vista materializada asigna el tránsito a
**un solo** movimiento de la rotación —la llegada si lo tiene capturado, y si no, el que lo
tenga— y deja el otro lado en `0` (no `NULL`, para distinguir «es el otro lado de una rotación ya
contada» de «no se capturó»). Las canceladas nunca ganan el desempate. El agregado suma
`transito_contable_kg`, jamás `carga_transito_kg` en bruto.

Sin rotación conocida (`aodb_legacy_id IS NULL`) el valor se cuenta tal cual: es una sola fila,
no hay nada que duplicar.

---

## 5. Permisos

No hay sistema paralelo. `public.estadistica_access_level(uuid)` parte de
`conciliacion_manifiestos_access_level` (migración 016) y devuelve
`admin | edit | capture | read | none`.

Quien no puede **escribir** en manifiestos pero tiene rol conserva **lectura**, igual que hoy
conserva la pestaña (Conciliación está en `alwaysVisible` de `js/permissions.js`). El override
opcional `permissions.section_levels->>'estadistica'` sólo puede **recortar**, nunca elevar: se
toma el menor de los dos niveles, así que no existe ruta de escalada.

| Acción | Nivel mínimo | Dónde se aplica |
|---|---|---|
| Consultar estadísticas y exportar agregados | `read` | RPC comprueba `<> 'none'` |
| Exportar el detalle por movimiento | `capture` | UI + RPC `estadistica_detalle` |
| Refrescar la materialización | `edit` | `refrescar_estadistica` lanza 42501 |
| Generar los documentos oficiales (PDF) | `edit` | UI del Centro de Descargas |
| Administrar reglas de clasificación | `admin` | **RLS** de `estadistica_reglas_clasificacion` |

La diferencia entre consultar y administrar vive en la **base**, no en el JavaScript: ocultar el
botón es comodidad; la política de RLS es la que manda.

---

## 6. Objetos SQL creados

**036 — clasificación y permisos**
- `estadistica_access_level(uuid)`
- `estadistica_catalogo_clasificacion` (valores válidos de las dos dimensiones)
- `estadistica_reglas_clasificacion` + índices + RLS
- `_estadistica_sin_acentos(text)`, `_estadistica_norm(text)`
- `estadistica_resolver_clasificacion(date, bigint, text, text, text)`

**037 — carga**
- Columnas `carga_descargada_kg`, `carga_embarcada_kg`, `carga_transito_kg` en
  `maestra_operaciones`
- `maestra_operaciones_carga_no_negativa_ck`, `maestra_operaciones_carga_desglose_ck`
  (ambas `NOT VALID`)
- `idx_maestra_operaciones_carga`, `idx_maestra_operaciones_rotacion`

**038 — motor**
- `mv_estadistica_operaciones` + 7 índices (uno `UNIQUE`, obligatorio para refrescar
  `CONCURRENTLY` sin bloquear la lectura)
- `v_estadistica_operaciones` (nombre público estable)
- `estadistica_refresco` + `refrescar_estadistica(boolean)` + pg_cron cada 15 min
- `_estadistica_filtro_ok(text, jsonb)`
- `estadistica_agregado`, `estadistica_sin_clasificar`, `estadistica_detalle`,
  `estadistica_opciones_filtro`

**039 — semilla opcional de reglas**

Ninguna toca los objetos de las migraciones 027 y 028: el Informe Estadístico sigue sobre sus
propias vistas.

---

## 7. Qué se calcula dónde

**En PostgreSQL** (todo lo pesado): clasificación por reglas, nacional/internacional,
capacidad, cancelación, atribución de tránsito, minutos de demora, y **todas** las sumas,
conteos, promedios, máximos, mínimos y el factor de ocupación. El navegador recibe decenas de
renglones ya agregados, nunca miles de filas de detalle para sumarlas.

**En el navegador** (`js/estadistica-motor.js`), y sólo lo que no tiene sentido pedirle al
servidor:

- **Variación entre dos agregados ya recibidos.** Son dos restas sobre dos renglones; hacerlas
  en SQL obligaría a mantener una función más sincronizada con cada métrica.
- **Recomposición al sumar renglones de agregado** (doce meses en un año): el factor de ocupación
  y la puntualidad se **recalculan de las bases acumuladas**, no se promedian promedios.
- **Formato, unidades y validaciones** que se muestran al usuario.

La única excepción a «no traer detalle» es la exportación *Detalle de operaciones*, que es
justamente eso: bajar las filas. Va paginada de 10 000 en 10 000 con tope de 200 000.

---

## 8. Filtros, fechas y nulos

Un **solo estado** de filtros para todo el módulo (`filtrosVacios()` en el motor), con los
mismos nombres que entiende el RPC para que no haya traducción intermedia que desincronizar:
`fecha_inicio`, `fecha_fin`, `aerolinea`, `matricula`, `tipo_aeronave`, `tipo_servicio`,
`direccion`, `nacional_internacional`, `segmento_aviacion`, `naturaleza_operacion`, `origen`,
`destino`, `endpoint`. Los desplegables se llenan con lo que realmente existe en el periodo
(`estadistica_opciones_filtro`), no con el catálogo completo.

**Fechas.** `fecha_operacion` es un `DATE` (fecha operacional), no un timestamp: no hay
conversión de zona horaria que pueda mover una operación de día. Los rangos son **inclusivos en
los dos extremos** (`>= p_desde AND <= p_hasta`), así que pedir un solo día trae ese día
completo. En JavaScript las fechas se manipulan como texto ISO anclado al mediodía, nunca con
`new Date(iso)` a secas, que se interpreta como UTC y en México devuelve el día anterior.

**Nulos.** `toNumero()` devuelve `null` cuando no hay dato, jamás `0`. Una capacidad desconocida
no es una capacidad de cero asientos. Esto se sostiene en pasajeros, capacidad, carga, demora y
factor de ocupación, y es la base de los indicadores de cobertura.

---

## 9. Centro de Descargas

Sección *L*. Un solo lugar; agregar un documento es agregar una entrada a `DOCUMENTOS` en
`js/estadistica-panel.js`, sin tocar ninguna pantalla. Cada documento respeta el periodo y los
filtros vigentes, y exporta el **resultado completo de la consulta**, no la página visible.

Los dos PDF institucionales aparecen listados pero **no se regeneran aquí**: su botón lleva a la
sub-pestaña *Informe oficial*, que es la que los produce, sin cambios.

---

## 10. Los dos PDF existentes

`js/estadistico-informe.js` (Informe Estadístico, oficio, 2 hojas, con visto bueno) y
`js/resumen-estadistico.js` (Resumen Estadístico, carta, 17 hojas) **no se modificaron**. Su
marcado se movió íntegro dentro de la sub-pestaña *Informe oficial*, sin renombrar ni quitar un
solo id, y `js/estadistico-informe-core.js` no se tocó.

La integración de sus cifras con el nuevo motor **queda pendiente a propósito**: hoy el Informe
combina `monthly_operations` / `annual_operations` (la cifra oficial ratificada) con los
manifiestos conciliados, y el motor nuevo lee la maestra completa. Son universos distintos y
sustituir la fuente cambiaría las cifras impresas. Cuando la maestra esté auditada y cuadre con
la tabla mensual oficial, la sustitución es un cambio acotado en `Core.mergeOficiales()`; hasta
entonces, tocarlo sería arriesgar un documento autorizado.

---

## 10 bis. Cuando una pantalla sale vacía

Un «sin datos» mudo no dice nada: puede ser que no haya operaciones en ese periodo, que la
materialización esté vieja o que el filtro no alcance nada. `estadistica_diagnostico()`
devuelve cuántos movimientos hay, entre qué fechas, cuánto está clasificado y cuándo se
refrescó, y el panel lo usa para escribir un aviso concreto en lugar de dejar la tabla en
blanco.

Los avisos del periodo —este, las operaciones sin clasificar, las canceladas y los de
consistencia— van al **pie de la página**, como texto sobre el fondo blanco: informan sin
empujar el contenido hacia abajo. Mientras un área carga, lo que ya tenía queda detrás del
aviso de avance, difuminado.

---

## 10 ter. FBO · Aviación General

Primera ventana con la visualización nueva, pensada para leerse sin instructivo: una frase que
cuenta el periodo, seis tarjetas (las de conteo, con su variación contra el periodo anterior de
la misma duración), destacados —mes pico, operador principal, aeronave más usada, origen/destino
más frecuente—, la tendencia mensual con selector *Movimientos / Pasajeros* y su promedio,
barras de composición, tres rankings y las matrículas más recurrentes.

**De dónde salen las cifras.** De `aviacion_general_resumen()` (migración 046), la misma función
que usa el módulo de Aviación General: las dos pantallas dan las mismas cifras y aquí no se
recalcula ninguna métrica. El navegador sólo saca proporciones y el promedio mensual para
pintar. El periodo anterior es un segundo viaje al mismo RPC; si falla, el tablero sale sin
variaciones.

**Filtros.** Se aplican el periodo, *Movimiento* (A → `LLEGADA`, D → `SALIDA`) y *Territorial*
(→ `NACIONAL` / `INTERNACIONAL`). Los demás filtros de la barra toman sus opciones de la
operación de las otras ventanas: en FBO no se aplican, y el tablero lo avisa.

**Filtrar tocando.** Una barra de operadores, tipos de aeronave u orígenes/destinos, un destacado
o una matrícula filtran todo el tablero por ese valor, uno a la vez. El chip de arriba lo quita,
igual que *Limpiar*. El RPC compara por coincidencia parcial, como en el módulo de Aviación
General.

**Calidad del dato, a la vista.** Buena parte del histórico no trae origen/destino. Esa parte no
entra a la gráfica, porque aplastaría a las demás barras: debajo se dice cuántos movimientos son
y qué porcentaje, y un destacado lo anuncia arriba. Los nombres largos se abrevian en el eje y
salen completos en el globo.

**Lo que no aplica, fuera.** Los avisos de la operación del itinerario (operaciones sin
clasificar, canceladas) se ocultan mientras FBO está abierta. Ejes y leyendas toman los colores
del tema claro u oscuro, y las gráficas se repintan solas al cambiarlo, sin volver a consultar.

**Periodo sin movimientos.** Lo dice con las fechas del histórico cargado y ofrece un botón para
verlo completo. Si la base no tiene la función, el error nombra la migración 046.

---

## 11. Pruebas

- `__tests__/estadistica-motor.test.js` — núcleo puro: nulos, unidades, factor de ocupación,
  PAX total, comparaciones con base cero, fechas, filtros, exportación, validaciones.
- `__tests__/estadistica-panel.test.js` — pantallas en jsdom con cliente simulado: origen de los
  datos, filtros centralizados, permisos por nivel, carga perezosa, comparador, descargas, el
  tablero FBO y convivencia con el Informe. El marcado se **recorta de `index.html`**, no se reescribe.
- `__tests__/estadistica-sql.test.js` — invariantes del SQL: canceladas fuera de toda métrica,
  tránsito atribuido una sola vez, clasificación que no adivina, sin interpolación de valores en
  SQL dinámico, RLS de administración, y que no se toque nada de 027/028.

Las migraciones no se ejecutan desde las pruebas: el proyecto no tiene base de pruebas. Los
bloques de **VERIFICACIÓN** al final de cada archivo `.sql` cumplen ese papel al aplicarlas.

---

## 12. SQL pendiente de ejecutar

En este orden, cada uno primero con `ROLLBACK` para revisar la verificación y después con
`COMMIT`:

1. `supabase/migrations/036_estadistica_clasificacion_reglas.sql`
2. `supabase/migrations/037_estadistica_carga_transito.sql`
3. `supabase/migrations/038_estadistica_motor.sql`
4. `supabase/migrations/039_estadistica_reglas_semilla.sql` *(opcional pero recomendada)*
5. El motor v2 va **repartido en seis archivos**, en orden y cada uno con `COMMIT` antes de
   pasar al siguiente:

   | Archivo | Qué hace |
   |---|---|
   | `040_estadistica_v2_preparacion.sql` | Freno de bloqueos, pausa del refresco automático, contrato de columnas y demolición |
   | `041_estadistica_v2_reglas.sql` | Criterio de aerolínea en las reglas + resolvedor de clasificación |
   | `042_estadistica_v2_vista.sql` | Vista materializada **vacía** + los ocho índices |
   | `043_estadistica_v2_agregado.sql` | `estadistica_agregado`, el motor |
   | `044_estadistica_v2_funciones.sql` | Consulta, exportación y diagnóstico |
   | `045_estadistica_v2_poblar.sql` | Llenado, reanudación del refresco y verificación de datos |

   **Por qué seis y no uno.** El editor SQL de Supabase corta la petición HTTP si una sola
   tarda demasiado, y como el trabajo va dentro de una transacción, al cortarse el cliente se
   deshace entera: `Failed to fetch` y ni un objeto creado. Dos causas concretas lo
   provocaban: el contrato de columnas lanzaba **84 consultas separadas** contra
   `information_schema.columns` (ahora es una sola sobre `pg_attribute`), y el job de pg_cron
   de la 038 refrescaba la vista cada 15 minutos, de modo que el `DROP` se quedaba esperando
   el bloqueo — con `statement_timeout = 0`, para siempre. Ahora el 040 **pausa** ese job y
   pone `lock_timeout`, así que un bloqueo devuelve un error legible en 15 segundos en lugar
   de colgarse.

   **Entre el 040 y el 044 el módulo queda abajo.** Son minutos; el Informe oficial y el
   resto de la aplicación siguen funcionando.

6. El paso 3 del 045 (`¿Ya quedó?`) es el que desmiente un `Failed to fetch` durante el
   llenado: si dice `poblada = true`, el servidor terminó aunque el navegador se rindiera.
   **No relances el REFRESH sin mirar eso primero.**

Las migraciones 032–035 (estructura, migración de datos, históricos y verificación de la
maestra) son **anteriores a este módulo** y no forman parte de esta entrega; si todavía no se
han aplicado, van antes que las cuatro de arriba.
