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

### La tabla tiene 43 columnas, no 37

El diccionario documenta 37. La tabla real tiene **seis más**, y no son decorativas:

| Columna | Filas con dato | Qué es |
|---|---|---|
| `pax_total_reportado` | 2,669 | Pasajeros capturados como total, sin separar por edad |
| `ciudad_origen_destino` | 5,438 | El origen/destino escrito como ciudad (BROWARD) en vez de código |
| `hora_aterrizaje` | 1,331 | Toma de pista |
| `hora_entrada_posicion` | 1,333 | Llegada a posición |
| `hora_salida_posicion` | 1,334 | Salida de posición |
| `hora_despegue` | 1,333 | Despegue |

### Dos convenciones de captura conviviendo

Los pares se reparten el histórico **casi exactamente a mitades, y son excluyentes**:

- `adultos`/`infantes` (7,726 filas) **o** `pax_total_reportado` (2,669) → 10,395 de 10,396.
- `aeropuerto_origen_destino` (4,956) **o** `ciudad_origen_destino` (5,438) → 10,394.

Es decir: unos años se capturó de una forma y otros de otra. Cualquier pantalla que lea sólo
una de las dos enseña la mitad del histórico vacío.

`pax_ag` es columna generada y las reconcilia:

```
pax_ag = COALESCE(adultos,0) + COALESCE(infantes,0) + COALESCE(pax_total_reportado,0)
```

Comprobado fila por fila contra los datos. De ahí sale, sin tocar la base, cuántos pasajeros
del periodo vienen sin desglose: `pax_ag − adultos − infantes`. El KPI de pasajeros lo usa para
decir «capturados como total, sin desglose por edad» en vez de mostrar un «0 adultos» que se
lee como error.

### Cómo las trata el módulo

Las seis se leen, se muestran, se capturan, se importan y se exportan:

| Dónde | Qué hace |
|---|---|
| **Movimientos** | La columna *Orig./Dest.* cae en la ciudad cuando no hay código, con subrayado punteado para distinguir la procedencia del dato. Cuatro columnas nuevas para el paso por plataforma y una para *Pax rep.* |
| **Filtro de origen** | Buscar `MMTO` o `TOLUCA` encuentra lo mismo: consulta las dos columnas. Quien busca no tiene por qué saber en qué año cambió la convención |
| **Captura** | Campos para la ciudad, el total reportado y las cuatro horas. *Pax A.G.* suma los tres sumandos en pantalla |
| **Importación** | Alias de encabezado para las seis. `TOTAL PAX` sigue **ignorada** a propósito: `pax_ag` ya suma `pax_total_reportado`, y mapearla ahí contaría los pasajeros dos veces |
| **Exportación** | Las seis van en el Excel. Antes se descargaba un archivo con 5,438 orígenes y 5,331 horas en blanco |

La columna *Orig./Dest.* **dejó de ser ordenable**, a propósito: ordenar por una sola de las dos
columnas dejaría fuera del criterio a la mitad del histórico, y eso es peor que no ofrecer el
orden.

### El conteo OFICIAL es por rotación (migración 047)

El reporte de GAG *«Operaciones de Aviación General 2022 LA BUENA»* cierra 2022 con **458
operaciones y 1,385 pasajeros**. El módulo, contando cada movimiento en la fecha en que
ocurrió, daba 455. No faltaban datos: **son dos formas de contar, y reconcilian exacto.**

El reporte cuenta por **rotación**: ancla la salida a la fecha de la llegada con la que forma
pareja. Si una aeronave llega el 25 de diciembre y despega el 2 de enero, las dos operaciones
cuentan en diciembre.

Verificado contra los datos antes de escribir el SQL: anclando cada salida a su llegada,
**nueve de los diez meses de 2022 cuadran al dígito** en las cuatro cifras del reporte.

| | Reporte | Módulo (rotación) |
|---|---|---|
| Pasajeros | 1,385 | 1,385 ✓ |
| Pax llegada / salida | 698 / 687 | 698 / 687 ✓ |
| Llegadas | 229 | 229 ✓ |
| Salidas | 229 | **228** |

`aviacion_general_resumen(p_filtros, p_modo)` — `p_modo` por omisión es `'rotacion'`.

**El módulo enseña ese conteo y ningún otro.** Llegó a tener un interruptor en el Resumen para
ver también la fecha real del movimiento, y se quitó: el reporte de GAG es la cifra auténtica, y
tener dos conteos a la vista invitaba a reportar el que no es.

El parámetro `'movimiento'` sigue existiendo en la función para quien necesite consultarla
directamente desde SQL, pero ninguna pantalla lo pide. El listado de Movimientos sí muestra la
fecha real de cada operación, porque ahí se consulta el movimiento, no el reporte.

La ventana de anclaje es de **60 días** y no es decorativa: el folio de rotación **se reinicia
cada año** (2022 usaba `202200046`; 2026 usa `977`, `95`), así que sin acotar por fecha una
salida de 2026 podría engancharse a una llegada de 2025 con el mismo folio.

#### La salida del GN-106 (migración 048)

**GN-106 · GUARDIA NACIONAL · UH60L** llegó el 03/11/2022 y esa llegada era su **único
movimiento en todo el histórico**. No fue un descuido de la carga: la propia fila lo dice en su
campo de observaciones —*«La fila de origen no contiene movimiento de SALIDA.»*— y tiene vacías
la hora de salida de posición y la de despegue. El Excel no registró la salida.

GAG confirmó que la aeronave sí salió y pidió dejarla contemplada. La migración **048** la
inserta, y es **la única del módulo que escribe un dato**. Entra marcada como lo que es:

| Campo | Valor | Por qué |
|---|---|---|
| `tipo_fuente` | `MIGRACION` | No se capturó ni se importó: se reconstruyó del reporte |
| `estado_validacion` | `OBSERVADO` | Queda contada **y** visible en la bandeja, con el motivo escrito |
| `hora_programada` / `hora_real` | `NULL` | No constan. No se inventan |
| `fecha_operacion` | 03/11/2022 | El mismo día de la llegada: es lo que menos supone |
| `pax_total_reportado` | `0` | **Confirmado, no supuesto**: el reporte cierra noviembre con 237 pax de salida y el histórico ya los tenía con 53 salidas |

Con eso 2022 cierra en **458 operaciones, 229 llegadas y 229 salidas**, idéntico al reporte, y
los 1,385 pasajeros no se mueven.

La migración es idempotente, aborta si la llegada dejó de ser la que se documentó, y trae
escrito el `DELETE` para deshacerla.

#### 2024 no se cuenta por rotación: se cuenta por fecha real (migración 050)

El reporte oficial de 2024 (*«Aviación General 2024PDFff.pdf»*, con tabla resumen mensual y
serie diaria completa del año) **no sigue la misma convención que 2022**. Comparado mes por mes
contra la base:

| | Anclando por rotación | Contando por fecha real |
|---|---|---|
| Salidas 2024 | 1,379 — no cuadra | **1,372** |
| Llegadas 2024 | 1,398 — no cuadra | **1,398** |

Contando por fecha real, **los 12 meses de 2024 coinciden al dígito** contra el reporte, salvo
dos huecos, ambos explicados por completo al conseguir el Excel maestro del año (2,777 filas,
detalle vuelo por vuelo):

| Mes | Hueco | Causa |
|---|---|---|
| Junio | el reporte trae 88 salidas, la base 87 | `512\|SALIDA\|04/06/2024\|N900MC`, capturada **2 veces** en el Excel de origen. Es el mismo caso que el id 3701, ya anulado por duplicado accidental confirmado por Gerencia |
| Octubre | el reporte trae 180 llegadas, la base 174 | `1137\|LLEGADA\|31/10/2024\|XA-GIU` y `1138\|LLEGADA\|31/10/2024\|XB-MXK`, cada una capturada **4 veces** en el Excel de origen |

Descontando esas 7 filas repetidas —las únicas de las 2,777 en todo el año—, el Excel maestro
deduplicado coincide **perfecto, folio por folio**, con las 2,770 filas activas de la base. El
reporte de GAG suma las filas del Excel tal cual, sin filtrar los duplicados; la base, con su
antiduplicados por llave natural, ya los tenía fuera.

`aviacion_general_resumen`, en modo `'rotacion'` (el que usan por omisión tanto el Resumen de
FBO como Estadística), deja de anclar una salida cuando su fecha real cae en 2024 **o** cuando la
llegada a la que ancharía cae en 2024 — la segunda condición evita que una salida de enero de
2025 se cuele por atrás en el total de diciembre de 2024 (se comprobó que existen 3 así; sin la
condición simétrica, diciembre habría dejado de cuadrar). Se comprobó que la frontera equivalente
2023→2024 no existe en los datos reales, así que 2022 y 2023 no se mueven ni un movimiento.

Es una excepción por año, escrita adentro de la función: ninguna pantalla necesitó cambiar,
porque ambas ya la llamaban sin pasar `p_modo`. Que 2022 se cuente por rotación y 2024 por fecha
real —dos convenciones distintas en la misma tabla— no es un capricho de este SQL: es lo que
prueban, cada uno por su lado, los dos reportes oficiales. 2025 quedó verificado con su Excel completo y se cuenta también por fecha real
(051 y 052, descritas abajo). 2026 conserva su criterio actual.

#### 2025: conciliación completa con el Excel (migraciones 051 y 052)

Fuente: **Aviación General 2025 (1).xlsx**, hoja `Data`; SHA256
`7cf0c5440f82b452891907ba68341899146c5537ce08e9ee73248a1b942761aa`. Revisión del **15/09/2026**.

Se compararon las **3,071 filas de 2025**, todos los campos operativos disponibles,
los **12 meses y 365 días** de `Ops` y `Pax A.G.`, y los registros de Supabase.
Las 27 filas de enero de 2026 del mismo libro quedan fuera del cierre de 2025.
Los encabezados antiguos no definen el año: las fechas y fórmulas de estas dos
hojas corresponden a 2025.

| Mes | Salidas | Llegadas | Operaciones | Pax salida | Pax llegada | Pasajeros |
|---|---:|---:|---:|---:|---:|---:|
| 2025-01 | 127 | 124 | 251 | 298 | 2055 | 2353 |
| 2025-02 | 121 | 121 | 242 | 555 | 793 | 1348 |
| 2025-03 | 134 | 138 | 272 | 831 | 770 | 1601 |
| 2025-04 | 127 | 122 | 249 | 1372 | 468 | 1840 |
| 2025-05 | 112 | 114 | 226 | 1102 | 474 | 1576 |
| 2025-06 | 104 | 105 | 209 | 1798 | 1379 | 3177 |
| 2025-07 | 117 | 117 | 234 | 1063 | 452 | 1515 |
| 2025-08 | 139 | 143 | 282 | 776 | 2257 | 3033 |
| 2025-09 | 126 | 123 | 249 | 450 | 498 | 948 |
| 2025-10 | 159 | 156 | 315 | 801 | 497 | 1298 |
| 2025-11 | 145 | 140 | 285 | 558 | 531 | 1089 |
| 2025-12 | 130 | 127 | 257 | 921 | 415 | 1336 |
| **Total** | **1,541** | **1,530** | **3,071** | **10,525** | **10,589** | **21,114** |

Ámbito: **2,350 nacionales / 721 internacionales**; pasajeros:
**6,878 nacionales / 14,236 internacionales**.

**Criterio solicitado por el usuario:** incluir todas las filas que cuenta el
reporte, incluso las repetidas, y mantener los casos sin confirmar como
`PENDIENTE`, con su motivo en observaciones y en la observación de validación.
Estas cifras reproducen el reporte; no certifican que cada fila repetida
represente un movimiento distinto.

- **Siete filas incorporadas:** Data 1443, 2000, 2083, 2103, 2104, 2169 y 2184.
  La primera agrega una llegada de junio sin pasajeros; las otras seis agregan
  tres llegadas y tres salidas de septiembre, con 5 y 9 pasajeros respectivamente.
  Explican por completo la diferencia anterior de 7 operaciones y 14 pasajeros.
- **Nueve grupos repetidos (18 registros):** todos permanecen pendientes.
  N652CV, salida 29/06, filas 1444/1445, difiere en 2 adultos + 1 infante frente a
  3 adultos. N19SG, salida 29/09, filas 2196/2203, difiere en 2 adultos frente a
  1 adulto + 1 infante. Se conservan ambas versiones conforme a lo solicitado.
- **Dos totales contradictorios:** Data 2758 (N210ER, 24/11) reporta 4 pasajeros
  pero desglosa 3 adultos; Data 2762 (N960T, 25/11) reporta 1 pasajero pero desglosa
  2 adultos. Se cuenta `pax_total_reportado=4/1` y se dejan adultos/infantes
  sin asignar; el desglose original se conserva en observaciones. Así coincide
  también cada día de noviembre. Los cinco pasajeros quedan sin desglose confirmado.
- **Once horas corregidas:** Data M46, L76, M184, L226, M380, L952, M1657, M1964,
  L2010, L2081 y M2976. Las fracciones Excel 0.45/0.35 son 10:48/08:24, no
  00:45/00:35. La hora ambigua M1300 (15.55) conserva 15:55, pendiente de confirmar.
- **Destino recuperado:** Data K2363, HUAYACOCOTLA VERACRUZ, pasa a
  `ciudad_origen_destino`; no se inventa un código de aeropuerto.
- **Normalizaciones conservadas:** folio `621-2024` como `20240621`,
  tipos de aeronave vacíos como `SIN_DATO`, hora textual `12.:01` como 12:01
  y fracciones horarias con componente entero que ya estaban bien interpretadas.

Las hojas auxiliares `GRFICOS 1` y `Tablas Res.` tienen referencias/valores
antiguos (por ejemplo, agosto muestra 2,543 pasajeros en una gráfica y cero en
una tabla, frente a 3,033 en Data y Pax A.G.). El libro original se conserva.
El tablero se concilia con Data y con las series completas de Ops/Pax A.G.

**051** define el conteo por fecha real. **052** contiene exclusivamente las
correcciones anteriores, comprobación de estado previo, reejecución segura y
verificación mensual; finaliza en `ROLLBACK` para revisar antes de aplicar.
La aplicación conserva la auditoría mediante el mecanismo existente de la tabla.

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

Los reportes oficiales también la usan: la sección **AVIACIÓN GENERAL** del *Informe
Estadístico* y del *Resumen Estadístico* (y su exportación a Excel) toma los meses y el
corte del día de `aviacion_general_resumen()`, en lugar de `monthly_operations`. Si la
función no responde, el informe se queda con la tabla mensual como respaldo.

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
__tests__/aviacion-general-core.test.js    45 pruebas — las reglas de normalización
__tests__/aviacion-general-panel.test.js   31 pruebas — el cableado de las siete piezas
__tests__/aviacion-general-sql.test.js     45 pruebas — las invariantes de las migraciones
```

`aviacion-general-sql.test.js` existe porque **no hay PostgreSQL en la batería**: no ejecuta el
SQL, vigila lo que sólo se descubriría en producción y con datos de por medio — que el INSERT
no mencione `pax_ag`, que el archivo siga siendo aditivo, que RLS siga comentado, que termine
en `ROLLBACK` y que el contrato liste exactamente las 37 columnas del diccionario.

El marcado del contenedor se recorta de `index.html` en la prueba del panel, no se reescribe a
mano: si alguien renombra el id allá, la prueba falla en vez de seguir pasando contra una copia
que ya no existe.

---

## 9. Migraciones del módulo

Todas aplicadas, en orden:

- **046** — índices y las ocho funciones de servicio. *Aplicada.*
- **047** — conteo oficial por rotación. *Aplicada.*
- **048** — la salida reconstruida del GN-106 (2022). *Aplicada.*
- **049** — corrección de nueve horas de plataforma de 2023 (fracción de Excel leída como
  decimal). *Aplicada el 12/09/2026 16:43 — confirmado por auditoría: las nueve filas pasaron a
  `version=2` en la misma transacción.*
- **050** — 2024 se cuenta por fecha real, no por rotación, dentro de `aviacion_general_resumen`.
  *Aplicada. Verificado en vivo: 2024 da 1,372/1,398/2,770; 2022 sigue en 458.*

Todas siguen la misma mecánica, por si en el futuro se agrega una nueva:

1. Correr el archivo completo tal cual. Termina en `ROLLBACK`.
2. Leer el bloque `VERIFICACIÓN` (cuenta índices, funciones y filas, o —en 049— usa
   `RAISE NOTICE`/`RAISE EXCEPTION`: si Supabase no muestra avisos y tampoco hay error, la
   migración pasó).
3. Si se ve bien, cambiar `ROLLBACK` por `COMMIT` y volver a correrlo.

Si algún día `046` no estuviera aplicada, el módulo lo dice con todas sus letras al abrir:
muestra un aviso con el nombre del archivo que falta correr, en lugar de dejar la pantalla en
blanco con un error de consola que nadie va a leer.

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
