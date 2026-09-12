# Módulo de Aviación General · FBO

Captura, consulta y resguardo del histórico de movimientos de aviación general de la
**Gerencia de Aviación General (GAG)**, Subdirección de Servicios Conexos.

Entra por el acceso directo del menú principal, **junto a Conciliación**.

> **No confundir con la página informativa.** En el menú, bajo *SSC → GAG*, ya existía
> «Terminal de Aviación General · FBO» (`#aviacion-general-fbo-section`): infraestructura,
> video, m², posiciones. Es una página de difusión y **no se tocó**. Este módulo es el
> operativo y vive en su propia sección, `#aviacion-general-section`.

---

## 1. Fuente de datos

```
public.aviacion_general_operaciones            ← el histórico (creada fuera de este repo)
public.aviacion_general_operaciones_auditoria  ← estado anterior y posterior de cada cambio
                    ↓
migración 046: índices + 8 funciones           ← las reglas de negocio, en PostgreSQL
                    ↓
js/aviacion-general/core.js                    ← normalización y validación (puro, sin DOM)
js/aviacion-general/datos.js                   ← único punto que habla con Supabase
js/aviacion-general/panel.js                   ← armazón: filtros, pestañas, permisos
js/aviacion-general/vista-*.js                 ← una pantalla por archivo
```

Las dos tablas **ya existían** cuando se construyó el módulo: se generaron a partir del
diccionario de datos, fuera de este repositorio. La migración 046 **no las crea ni las
modifica**; se apoya en ellas y aborta si no cumplen el contrato.

### Estado verificado contra la base en vivo (2026-09-11)

No se dio nada por supuesto: se comprobó contra Supabase antes de escribir una línea.

| Hecho | Cómo afecta al módulo |
|---|---|
| Las 37 columnas del diccionario existen tal cual | El contrato de la 046 las enumera una por una |
| **10,396 filas ya cargadas**, del 2022-03-20 al 2026-08-31 | El módulo nace con histórico; Importación es para los archivos que falten |
| 5,209 llegadas · 5,187 salidas · 7,786 nacionales · 2,610 internacionales | Todas `ACTIVO` y todas `PENDIENTE` de validación |
| 456 movimientos ya traen su pareja enlazada | `enlazar_rotaciones` completa el resto |
| `pax_ag` es **columna generada** | El cliente jamás la envía: si lo hiciera, Postgres rechaza el INSERT completo |
| CHECK vigentes | `chk_ag_tipo_operacion`, `chk_ag_ambito_operacion`, `chk_ag_tipo_fuente`, `chk_ag_estado_validacion`, `chk_ag_estatus_registro`, `chk_ag_adultos` |
| Valores por omisión | `tipo_fuente=CAPTURA_MANUAL`, `estado_validacion=PENDIENTE`, `estatus_registro=ACTIVO`, `version=1` |
| Columnas de auditoría | `id`, `registro_id`, `operacion`, `datos_anteriores`, `datos_nuevos`, `realizado_por`, `fecha_evento` |

### Tres cosas en que los datos reales desmintieron al diccionario

Manda la tabla, no el documento. Las tres estaban mal implementadas en la
primera versión del módulo y se corrigieron al revisar los datos ya cargados.

| El diccionario decía | La tabla dice | Qué se hizo |
|---|---|---|
| `hash_origen` es una huella opcional | Trae **SHA-256 de 64 caracteres** puesto por el proceso que cargó el histórico | El antiduplicados **ya no compara hashes**: compara la llave natural |
| `aeropuerto_origen_destino` es obligatorio | **Nulo en 5,440 de 10,396 filas (52%)** | No se exige al importar ni al capturar |
| `adultos` / `infantes` son NOT NULL | Nulos en 2,670 y 3,080 filas | Se conserva el nulo; no se rellena con 0 |

---

## 2. Qué se calcula dónde

La regla es la misma que ordena al módulo estadístico: **ninguna métrica se recalcula en el
navegador**.

| Trabajo | Dónde vive | Por qué ahí |
|---|---|---|
| Totales, series por mes, tops | `aviacion_general_resumen()` | Una sola definición de cada cifra; el navegador recibe decenas de renglones ya sumados, no miles por sumar |
| Listado paginado | PostgREST directo (`select` + `range` + `count`) | Es para lo que sirve; aprovecha los índices sin una capa intermedia que mantener |
| Catálogos de los filtros | `aviacion_general_opciones()` | Ofrece lo que existe en la tabla, no un catálogo fijo |
| Validar filas, detectar duplicados, insertar | `aviacion_general_importar()` | Transaccional por tanda; un fallo no deja importaciones a medias |
| Estado de validación | `aviacion_general_validar()` | Quién validó y cuándo lo sella el servidor, no el navegador |
| Baja lógica | `aviacion_general_baja()` | Exige motivo; nunca borra la fila |
| Enlazar llegada↔salida | `aviacion_general_enlazar_rotaciones()` | Sólo parejas inequívocas; lo ambiguo lo reporta sin tocarlo |
| Detectar capturas repetidas | `aviacion_general_duplicados()` | Misma llave que usa la importación, para que ambas señalen lo mismo |
| Normalizar horas, fechas, matrículas | `core.js` | Son reglas de lectura del Excel, no de negocio; se prueban sin navegador |

El tablero **FBO** del módulo estadístico (*Estadística → FBO*) lee este mismo
`aviacion_general_resumen()` con los mismos nombres de filtro, así que da las mismas cifras que
el *Resumen* de este módulo. Ver `docs/modulo-estadistico.md`, sección 10 ter.

---

## 3. Normalización: las decisiones que importan

Viven en `js/aviacion-general/core.js` y están cubiertas por pruebas.

### `NA` es ausencia de dato, no medianoche

El diccionario lo pide explícitamente: «los valores NA, `-` u otros inválidos deberán migrarse
como NULL». Si se colaran como `00:00`, cualquier análisis de puntualidad que se haga después
sobre este histórico mostraría un pico de vuelos a medianoche que nadie sabría explicar.

Se reconocen como vacío: `NA`, `N/A`, `-`, `--`, `NULL`, `S/D`, `SIN DATO`, `#N/A`, `.`, `X`.
Medianoche escrita de verdad (`00:00`) **sí se conserva**.

### Las fechas nunca pasan por `toISOString()`

Convierte a UTC, y en México eso adelanta la fecha un día entero a partir de las 18:00. El
error es invisible —las fechas siguen pareciendo fechas— y sólo aparece meses después al
cuadrar un mes contra un oficio. Todo se arma componente a componente en horario local.

Se aceptan: `Date`, serie de Excel, ISO, `d/m/aaaa` y `d-m-aaaa` (**día primero**, que es como
se capturan las bitácoras). Una fecha imposible como `31/02` se rechaza; no se ajusta al mes
siguiente.

### Horas de Excel

Cuatro orígenes soportados: `Date` (lo que entrega SheetJS con `cellDates`), fracción `0..1`
(la representación nativa de Excel: `0.354166…` = 08:30), `HH:MM[:SS]` con o sin am/pm, y
`HHMM` pegado, como se anota en torre.

### Matrícula

Se guarda como texto aunque el Excel la traiga numérica, tal como advierte el diccionario. Se
quitan espacios internos —`XA MAM` y `XA-MAM` son la misma aeronave escrita con prisa— pero
**no se inventa el guion** si no venía.

### Duplicados: la llave natural, **no** el hash

Reimportar un archivo ya cargado no debe duplicar nada. Quien decide eso es
`aviacion_general_importar()`, comparando **folio de rotación + tipo de movimiento + fecha +
matrícula**.

No compara `hash_origen`, y esa fue una corrección importante. Las 10,396 filas ya cargadas
traen un SHA-256 de 64 caracteres calculado por el proceso que las subió, con una receta que
este repositorio no conoce. El hash que calcula el navegador es de otro algoritmo y otra
longitud: **nunca coincidiría**, y la primera reimportación habría duplicado el histórico
entero sin avisar.

La llave natural no depende de quién calculó qué. Está comprobada contra los datos: el folio
`202200046` son exactamente dos filas, la llegada y la salida de XA-SAV. Y tiene una ventaja
sobre el hash: si alguien corrige una hora en el Excel y lo vuelve a subir, la llave natural lo
reconoce como el mismo movimiento —que es lo que es—, mientras que un hash del contenido lo
habría insertado como uno nuevo.

`core.hashOrigen()` sigue existiendo y `hash_origen` se sigue guardando, para trazabilidad e
integridad. Lo que ya no hace es decidir qué es un duplicado.

---

## 4. Las seis pantallas

Cada una es un archivo que **se registra solo** en el panel. Agregar una pantalla es agregar un
archivo y su `<script>`; no se toca el armazón ni `index.html` más allá de esa línea.

| Pestaña | Archivo | Qué hace | Nivel mínimo |
|---|---|---|---|
| Resumen | `vista-resumen.js` | Cifras del periodo y series, en un viaje al RPC | lectura |
| Movimientos | `vista-movimientos.js` | Histórico paginado, ordenable, exportable a Excel/CSV | lectura |
| Captura | `vista-captura.js` | Alta y corrección de movimientos | captura |
| Importación | `vista-importacion.js` | Carga del Excel histórico en cuatro pasos | captura |
| Validación | `vista-validacion.js` | Bandeja PENDIENTE → VALIDADO/OBSERVADO + enlace de rotaciones | lectura (validar: edición) |
| Auditoría | `vista-auditoria.js` | Historial de cambios, mostrando sólo lo que cambió | lectura |

**Carga perezosa.** Cada pestaña consulta cuando se abre, no al entrar al módulo: seis pestañas
cargando de golpe son seis viajes a la base de los que el usuario normalmente mira uno. Cambiar
un filtro invalida lo pintado; la pestaña abierta se recarga al instante y las demás cuando
alguien las abra. Así nunca se ven cifras viejas bajo filtros nuevos.

### Importación: nada se sube a ciegas

Cuatro pasos y ninguno se puede saltar:

1. **Leer** — el archivo se abre en el navegador con SheetJS. No sale de ahí.
2. **Mapear** — se enseña qué columna del Excel cayó en qué campo, cuáles no se reconocieron y
   cuáles se ignoran a propósito (`PAX. A.G.`, que la base calcula).
3. **Ensayar** — se manda en modo simulación: la base valida y detecta duplicados **sin
   escribir una sola fila**.
4. **Confirmar** — hasta aquí no se ha insertado nada.

Al final se descarga el detalle de lo rechazado, **con su número de fila del Excel**, para
corregir el archivo y volver a subirlo. Lo que ya entró no se duplica.

Una importación que «salió bien» y dejó cuarenta renglones fuera sin decirlo es una bomba de
tiempo: el faltante se descubre meses después cuadrando cifras, y para entonces ya nadie sabe
qué archivo se subió.

### Auditoría: el diff, no los dos JSON

La tabla guarda el estado completo anterior y posterior en cada evento. Puestos uno junto a
otro son cuarenta campos de los que cambió uno. La pantalla los compara y muestra **sólo lo que
cambió**, con el valor anterior tachado y el nuevo resaltado — que es la pregunta real:
«XA-MAM pasó a XA-MAN, ¿quién y cuándo?».

`realizado_por` guarda el UUID de auth. Mientras no exista un catálogo de usuarios legible para
este módulo se muestra abreviado, en lugar de inventar un nombre que podría no corresponder.

---

## 5. Permisos y RLS

**RLS está apagado, por decisión explícita**, y el bloque de políticas queda redactado y
comentado al final de la migración 046.

Encenderlo sin haber definido qué perfil de GAG puede consultar, capturar, validar o dar de
baja dejaría el módulo inservible desde el primer minuto.

**Lo que esto implica hoy, dicho sin rodeos:** el control es de interfaz
(`window.sectionLevel('aviacion-general')`), que **oculta botones pero no protege la tabla**.
Cualquiera con la llave anon puede escribir en ella. Está asumido y documentado; no es un
descuido.

Las siete funciones se crearon `SECURITY INVOKER` justamente por esto: el día que se encienda
RLS empiezan a respetarlo **sin tocar una línea de código**.

### Para encenderlo cuando se definan los perfiles

Descomentar el bloque final de la 046 y correrlo. El modelo que propone reusa el RBAC del
portal:

| Nivel | Puede |
|---|---|
| `read` | Consultar y auditar |
| `capture` | Lo anterior + capturar e importar; corregir **sólo lo suyo** y **sólo mientras esté PENDIENTE** |
| `edit` | Lo anterior + corregir cualquier registro, validar y dar de baja |
| `admin` | Todo |

Nadie borra físicamente: el `DELETE` se revoca y la baja es lógica, por `UPDATE`.

El módulo ya está dado de alta en el catálogo de permisos del portal
(`AU_SECTIONS` y la subdirección `SSC` en `script.js`), así que un administrador puede
concederlo o negarlo desde Administración de Usuarios.

---

## 6. Objetos SQL creados (migración 046)

**100% aditivo.** No crea, altera ni borra ninguna tabla, columna, trigger o dato existente.

### Índices (todos `IF NOT EXISTS`)

`ix_ag_ops_fecha`, `ix_ag_ops_estatus_fecha`, `ix_ag_ops_matricula`, `ix_ag_ops_operador`,
`ix_ag_ops_tipo_aeronave`, `ix_ag_ops_aeropuerto`, `ix_ag_ops_folio_fecha`,
`ix_ag_ops_estado_validacion`, `ix_ag_ops_hash_origen`, `ix_ag_ops_archivo_origen`.

El diccionario dice que ya se crearon índices por fecha, matrícula, operador, rotación y
aeropuerto, pero su nombre exacto no consta en este repositorio. Si ya existen con otro nombre,
éstos quedan como duplicados baratos sobre una tabla de ~2 mil filas; si no existían, el módulo
los necesita. Lo que no se hace es suponer que están y quedarse sin ellos.

`ix_ag_ops_hash_origen` **no es UNIQUE a propósito**: si el Excel de origen trae dos renglones
legítimamente idénticos, un índice único abortaría el lote entero. Qué hacer con un repetido lo
decide `aviacion_general_importar()`, que lo reporta y lo omite.

### Funciones

| Función | Devuelve |
|---|---|
| `aviacion_general_filtro_ok(fila, jsonb)` | La definición única de los filtros del módulo |
| `aviacion_general_resumen(jsonb)` | Todas las cifras del tablero, agregadas |
| `aviacion_general_opciones()` | Valores presentes, para los desplegables |
| `aviacion_general_importar(jsonb, text, text, boolean)` | `{insertadas, duplicadas, rechazadas, detalle…}` |
| `aviacion_general_validar(bigint[], text, text)` | Movimientos afectados |
| `aviacion_general_baja(bigint, text, text)` | `boolean` |
| `aviacion_general_enlazar_rotaciones(date, date, int)` | `{movimientos_enlazados, grupos_ambiguos}` |
| `aviacion_general_duplicados(jsonb, int)` | Grupos con la misma llave natural, y si sus copias discrepan |

### Capturas repetidas en el histórico

Al revisar los datos cargados aparecieron **5 grupos de movimientos capturados dos veces** en
los Excel de origen. No son dos vuelos: coinciden en folio, matrícula, fecha, tipo **y horas**.

| Caso | Evidencia |
|---|---|
| N900MC · 2024-06-04 · folio 512 | Misma hora programada (15:58) y real (16:06); renglones 1026 y 1027, consecutivos. Una copia trae 3 adultos, la otra vacío |
| N652CV · 2025-06-29 · folio 720 | Idénticas; pax repartidos 2+1 contra 3+0 — mismo total |
| XC-FEZ · 2026-01-30 · folio 95 | El día entero capturado dos veces (renglones 49/97 y 148/192); discrepan en aeropuerto (MMMX vs MMSM) y una hora real difiere en una hora exacta |
| N19SG · 2025-09-29 · folio 1042 | Idénticas; pax 2+0 contra 1+1 — mismo total |

`aviacion_general_duplicados()` los señala desde la pestaña **Validación**. **No borra nada, a
propósito**: cuando las dos copias discrepan no siempre la buena es la primera, y esa decisión
es de quien conoce la operación. La pantalla marca cuáles discrepan y lleva al historial de
cada copia; anular la sobrante se hace con el botón de baja, que exige motivo.

De paso: el folio de rotación **se reinicia cada año** (en 2022 eran `202200046`, en 2026 son
`977`). Por eso la llave natural incluye la fecha y no depende sólo del folio.

### Filtros que entienden todas

`fecha_desde`, `fecha_hasta`, `tipo_operacion`, `ambito_operacion`, `operador`, `matricula`,
`tipo_aeronave`, `aeropuerto`, `estado_validacion`, `estatus_registro` (por omisión `ACTIVO`;
`TODOS` incluye anulados), `texto` (búsqueda libre).

Una clave ausente, nula o vacía **no filtra**: así el cliente manda siempre el objeto completo
sin armar condicionales.

---

## 7. Reglas que se aplican en los dos lados

No por desconfianza del navegador, sino porque un RPC se puede llamar por fuera de él.

| Regla | Cliente | Servidor |
|---|---|---|
| Observar exige comentario | `vista-validacion.js` | `aviacion_general_validar()` |
| Dar de baja exige motivo | `vista-movimientos.js` | `aviacion_general_baja()` |
| `pax_ag` nunca se envía | `core.aPayload()` | Columna generada (Postgres lo rechaza) |
| Campos obligatorios | `core.validarMovimiento()` | `NOT NULL` + CHECK + `aviacion_general_importar()` |

El cliente **avisa**; la base **autoriza**.

---

## 8. Pruebas

```
__tests__/aviacion-general-core.test.js    37 pruebas — las reglas de normalización
__tests__/aviacion-general-panel.test.js   22 pruebas — el cableado de las siete piezas
__tests__/aviacion-general-sql.test.js     29 pruebas — las invariantes de la migración
```

`aviacion-general-sql.test.js` existe porque **no hay PostgreSQL en la batería**: no ejecuta el
SQL, vigila lo que sólo se descubriría en producción y con datos de por medio — que el INSERT
no mencione `pax_ag`, que el archivo siga siendo aditivo, que RLS siga comentado, que termine
en `ROLLBACK` y que el contrato liste exactamente las 37 columnas del diccionario.

El marcado del contenedor se recorta de `index.html` en la prueba del panel, no se reescribe a
mano: si alguien renombra el id allá, la prueba falla en vez de seguir pasando contra una copia
que ya no existe.

---

## 9. SQL pendiente de ejecutar

`supabase/migrations/046_aviacion_general_fbo.sql` — **aún no aplicado**.

1. Correr el archivo completo tal cual. Termina en `ROLLBACK`.
2. Leer el bloque `VERIFICACIÓN` (cuenta índices, funciones y filas).
3. Si se ve bien, cambiar `ROLLBACK` por `COMMIT` y volver a correrlo.

Mientras no se aplique, el módulo abre y lo dice con todas sus letras: muestra un aviso con el
nombre del archivo que falta correr, en lugar de dejar la pantalla en blanco con un error de
consola que nadie va a leer.

---

## 10. Cuando algo sale vacío

| Síntoma | Causa probable |
|---|---|
| Aviso «el módulo no está instalado completo» | Falta aplicar la migración 046 |
| Tablero en ceros | La tabla está vacía: el histórico se carga por **Importación** |
| «Faltan columnas obligatorias» al importar | Hoja equivocada, o los encabezados no están en la primera fila |
| Filas rechazadas con «Tipo de operación inválido» | El Excel usa una palabra que no está entre los sinónimos de `core.js`; agregarla ahí |
| No aparece la pestaña Captura | Nivel de acceso de sólo lectura en este módulo |
| Un movimiento no se puede editar | Está `ANULADO`; hay que reactivarlo primero |
