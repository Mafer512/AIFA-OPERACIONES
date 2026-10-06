# Revisión del catálogo de aeronaves

Fecha: 6 de octubre de 2026. Alcance: el catálogo de modelos que usa Conciliación
Manifiestos para la columna AERONAVE, los dos catálogos de matrículas y los valores
reales de AERONAVE en los manifiestos.

## Resumen

- El catálogo de modelos (`data/master/aircraft type.csv`) tenía un código repetido,
  dos filas que no son aeronaves (una de prueba y un código de operador), cinco
  designadores ICAO que no existen en ICAO Doc 8643 y tres nombres equivocados. Se
  corrigieron 12 filas con evidencia.
- La pantalla traducía los códigos ICAO con la última fila del CSV que los usaba.
  `B738` se mostraba como "737-800 (Scimitar wl)" y `A320` como "A320-200 Ceo"
  aunque el avión fuera un neo. Ahora un ICAO que cubre varias variantes se muestra
  tal cual y queda marcado.
- `data/master/aircraft.csv` tenía siete Boeing 737 MAX registrados como 737 NG y
  un código de operador en lugar de tipo. Se corrigieron las 8 matrículas
  verificadas en el registro FAA. Hay unas 40 matrículas más con el mismo patrón,
  pendientes de validar.
- En los manifiestos de junio 2026 la columna AERONAVE es texto libre: 31
  escrituras distintas, ninguna es un código del catálogo. Se propone una tabla de
  equivalencias (migración 058) con 16 confirmadas y 17 pendientes. No se tocó
  ningún manifiesto.
- No hubo acceso de lectura a `public.maestra_manifiestos`. Las consultas para
  revisarla están en `scripts/diagnostico-catalogo-aeronaves.sql`.

## 1. Cómo funciona el catálogo

Hay tres catálogos que mezclan dos conceptos:

| Catálogo | Qué representa | Llave | Dónde vive | Quién lo usa |
|---|---|---|---|---|
| `data/master/aircraft type.csv` | Modelos (tipo/variante) | Código IATA de tipo; ICAO como dato secundario | CSV en el repositorio | Conciliación (nombre en AERONAVE, combo del editor, Excel), `js/manifiestos.js`, `js/analisis-operaciones.js`, datalist ICAO en `script.js` |
| `data/master/aircraft.csv` | Aeronaves individuales | Matrícula → código IATA de tipo | CSV en el repositorio | `js/analisis-operaciones.js`, `js/manifiestos.js` (tipo a partir de la matrícula) |
| `public.matriculas_manifiestos` | Aeronaves individuales | Matrícula → fabricante y modelo en texto, pesos, capacidad | Base de datos; carga inicial en `db/seed_matriculas_manifiestos.sql`; se edita desde "Catálogo de matrículas" | Conciliación: ESTATUS MATRÍCULA, capacidad, factor de ocupación y sobrecupo |

Todos los consumidores de `aircraft type.csv` leen sólo IATA, ICAO y nombre (y el
grupo de diseño en análisis). La capacidad para el sobrecupo sale de
`matriculas_manifiestos.pasajeros`, no de este CSV.

El estándar del catálogo de modelos es el código IATA de tipo (SSIM, Apéndice A).
Es lo que trae el itinerario y lo que guarda el editor. El ICAO (Doc 8643) agrupa
varias variantes IATA, porque no distingue pasajeros de carguero ni winglets.

Cómo entra un valor a AERONAVE:

1. Itinerario: el código IATA del vuelo.
2. Editor de la celda: valida contra el catálogo. Antes guardaba el ICAO tal como
   se tecleaba; ahora guarda IATA.
3. Importar Excel (`js/conci-importar-excel.js`): texto tal cual, sin validar.
4. Portal de aerolíneas (`portal.html`, campo EQUIPO): texto libre, sin validar.
5. `public.maestra_manifiestos`: no está definida en el repositorio. Existe en la
   base (la API responde 42501 "permission denied", no "no existe"), pero no se
   pudo leer su esquema ni sus datos.

## 2. Fuentes y alcance de los datos

| Fuente | Tipo | Qué se usó |
|---|---|---|
| Manifiestos de junio 2026 (`supabase/migrations/jun2026_parts`, 4,589 filas) | Datos reales del repositorio | AERONAVE, MATRÍCULA, AEROLINEA, FECHA |
| `aircraft type.csv` (103 filas), `aircraft.csv` (1,186), `seed_matriculas_manifiestos.sql` (575) | Catálogos del repositorio | Cruce entre sí y contra los manifiestos |
| [ICAO Doc 8643](https://doc8643.icao.int/external/aircrafttypes), 2,614 designadores, consultado el 2026-10-06 | Primaria | Validez de cada ICAO del catálogo y modelos que agrupa |
| [FAA Aircraft Registry](https://registry.faa.gov/AircraftInquiry), 78 matrículas N (75 encontradas), 2026-10-06 | Primaria | Modelo real por matrícula |
| [EASA, certificación A321neo](https://www.easa.europa.eu/en/newsroom-and-events/news/easa-certifies-airbus-a321neo) / TCDS A.064 | Primaria | Designaciones A320-271N, A321-271N y A321-271NX |
| [Wikipedia, List of aircraft type designators](https://en.wikipedia.org/wiki/List_of_aircraft_type_designators) | Secundaria (cita SSIM) | Sólo como apoyo para códigos IATA; nada se corrigió con esta fuente sola |
| [Aviacionline](https://www.aviacionline.com/conviasa-takes-delivery-of-a-second-airbus-a340-600-from-mahan-air-and-programs-regular-flights-to-iran) | Prensa | YV3535 es A340-600 |

Límites del análisis:

- No hubo acceso a `public.maestra_manifiestos`: la clave pública no tiene
  permiso y no hay credenciales de servicio en el equipo. Las conclusiones sobre
  manifiestos salen de la muestra de junio.
- La muestra de junio no trae `datos_origen` ni `tipo_reporte`. Su FECHA tiene un
  solo formato (`AAAA-MM-DD HH:MM`, 4,589 de 4,589). La tabla viva puede tener
  otros: la consulta 1 los inventaría y lista los que no se pueden convertir.
- SSIM (la fuente de los códigos IATA) es de pago. Las dudas sobre códigos IATA
  quedan pendientes.
- El registro mexicano (AFAC) no está disponible en línea. Las matrículas XA
  quedan pendientes salvo que otra fuente primaria las confirme.

## 3. Hallazgos en los datos (muestra de junio 2026)

- **31 escrituras distintas de AERONAVE**, todas nombres o modelos: `A320` (1,103),
  `A321` (743), `E-195` (635), `A-320` (634), `E-190` (508), `A-321` (443),
  `C208B` (147), `A320-271N` (124)… Ninguna es un código IATA del catálogo.
- **Diferencias de escritura**: 8 grupos que sólo cambian en espacios o guiones
  (`A320` / `A-320` / `"A320 "`, `E-195` / `E195`, `B737-8MAX` / `B-737-8MAX`…).
  Se agruparon como escritura, no como modelo.
- **Valores que coinciden con un ICAO sin serlo**: `A320`, `A321`, `B737`, `E195`
  y `E190` son también designadores ICAO, pero aquí se usan como nombre de
  familia. `A320` aparece en A320neo (FAA N529VL, A320-271N), aunque el ICAO
  `A320` sólo es el ceo. `B737` aparece en un 737-800 y en un MAX 8, aunque el ICAO
  `B737` es el 737-700.
- **Modelos que no existen**: `A340-800` (YV3535, un A340-600), `A320-271` (sin
  la N), `B37-800` y `B737-80`.
- **Matrículas con modelos distintos en el mismo mes**: 55 matrículas (1,811
  registros). Por ejemplo, XAVBN aparece como A321 ×140 y A320 ×1; XA-MXA como
  E-195 ×134 y E-190 ×2. Con FAA se confirmaron registros mal capturados:
  - N506VL (A320-233) capturado como `A321-271N` y `A-321`.
  - N524VL (A320-233) capturado como `A321`.
  - N542VL (A321-271N) capturado como `A320`.
  - N173AM (737-8, MAX 8) capturado como `B737-800`.

  Son errores de esos registros y no se corrigieron.
- **Sin vacíos ni valores en el campo equivocado**: no hay AERONAVE ni MATRÍCULA
  vacías, ni matrículas dentro de AERONAVE, ni modelos dentro de MATRÍCULA.
- **Matrículas sin catálogo**: 227 matrículas distintas; 25 no están en
  `matriculas_manifiestos` y 38 no están en `aircraft.csv`.

## 4. Correcciones aplicadas

### `data/master/aircraft type.csv`

| Fila original | Corrección | Problema | Evidencia | Estado |
|---|---|---|---|---|
| `7M7,B37M,Boeing 737 MAX7,…,1,1,1,138,54657` | Eliminada | Código IATA repetido; medidas de relleno (1/1/1) | Misma IATA e ICAO que `7M7,B37M,737 MAX 7`; la pantalla mostraba la última fila | Confirmado |
| `770,,Test 770,…,10,10,10,260,` | Eliminada | Registro de prueba | Nombre "Test", medidas 10/10/10, sin ICAO; no está en Doc 8643 ni en la lista IATA | Confirmado |
| `YA,,SAAB 340B,…` | Eliminada | Código de operador como tipo | `YA` es Berry Aviation (Aircraft Owner en aircraft.csv); los códigos IATA de tipo tienen 3 caracteres; su única aeronave, N3172, es SAAB 340B (FAA) y ya existe `SF3,SF34,Saab 340` | Confirmado |
| `74Y,B744,BB747-400F` | `B747-400F` | Error de escritura (se ve en pantalla) | Doc 8643 B744 = 747-400 | Confirmado |
| `76X,B762,B762-200 Freighter` | `B767-200 Freighter` | Nombre mezclado con el ICAO | Doc 8643 B762 = 767-200 | Confirmado |
| `76F,B763,B-767 All Freigthter` | `B767 All Freighter` | Error de escritura | — | Confirmado |
| `CR1,CRJ1,CRJ-1000,…,7.5,39.13,26.18,104,35000` | `CR1,CRJ1,CRJ-100,…` y especificaciones vacías | Modelo equivocado | Doc 8643 CRJ1 = CRJ-100; el CRJ-1000 es CRJX (fila CRK). Las medidas y la capacidad eran las del CRJ-1000 y no se usan en la app | Confirmado |
| `7M1,B31M,737 MAX 10` | ICAO `B3XM` | Designador inexistente | Doc 8643: B3XM = 737-10 / 737 MAX 10; B31M no existe | Confirmado |
| `781,B781,B787-10` | ICAO `B78X` | Designador inexistente | Doc 8643: B78X = 787-10 | Confirmado |
| `77X,B77F,B777-200F` | ICAO `B77L` | Designador inexistente | Doc 8643: el 777-F está en B77L | Confirmado |
| `DC9,DC9,McDonnell-Douglas DC-9-33F` | ICAO `DC93` | Designador inexistente | Doc 8643: DC93 = DC-9-30 (la fila es un -33F) | Confirmado |
| `SW3,LT2,Swearingen Aircraft` | ICAO vacío | Designador inexistente | LT2 no está en Doc 8643; no se pone otro sin saber qué representa SW3 | Confirmado (sólo se quita) |

Quedan 100 modelos (102 con los Embraer E2 de la sección 5c).

### `data/master/aircraft.csv`

Sólo cambia la columna Aircraft Type; pesos y capacidades no se tocan.

| Matrícula | Antes | Ahora | Evidencia (FAA, 2026-10-06) |
|---|---|---|---|
| N105JS, N109JS, N110JS, N868AM | 73H (737-800 winglets) | 7M8 | Modelo 737-8 (737 MAX 8; Doc 8643 lo lista en B38M) |
| N173AM | 73K (737-800 carguero) | 7M8 | Modelo 737-8 |
| N115AM, N891AM | 73J (737-900 winglets) | 7M9 | Modelo 737-9 (737 MAX 9, B39M) |
| N3172 | YA (código de operador) | SF3 | SAAB 340B, serie 340B172 |

Las otras 51 matrículas N de los manifiestos de junio que están en aircraft.csv
coinciden con el FAA. La revisión completa de las 396 matrículas N corrigió 37
filas más: ver [catalogo-matriculas-revision.md](catalogo-matriculas-revision.md).

### Pantalla de Conciliación (`script.js`)

- **Catálogo** (`_conciBuildAircraftTypeCatalog`): un ICAO se traduce sólo si le
  corresponde un único código IATA (`B38M` → 7M8). Los ambiguos (`B738`, `A320`,
  `B77L`, `B763`…) ya no se asignan a una variante al azar. Un código IATA repetido
  ya no duplica opciones ni cambia el nombre, y si un texto es IATA de una fila e
  ICAO de otra, manda el IATA.
- **Editor**: escribir un ICAO inequívoco guarda su IATA. Un ICAO o un nombre que
  corresponde a varios modelos (`B738`, `CRJ-700`) se rechaza con la lista de
  opciones. Abrir y cerrar la celda sin escribir deja el valor exactamente como
  estaba (antes lo pasaba a mayúsculas).
- **Valores fuera del catálogo** (texto libre, ICAO ambiguo): se muestran tal cual,
  subrayados en ámbar, con un título que explica por qué. Pasa al pintar la tabla,
  al editar y al recibir el cambio de otro capturista en vivo (antes ese camino
  mostraba el código crudo).
- **Importar Excel**: el resumen lista las AERONAVE que el catálogo no reconoce.
  Se importan sin cambios, sin perder el dato, y quedan marcadas.

### Base de datos (preparado, sin aplicar)

- `supabase/migrations/058_catalogo_aeronaves_equivalencias.sql`: tabla
  `catalogo_aeronaves_equivalencias` con la propuesta de la sección 5. Termina en
  ROLLBACK y trae un bloque de verificación y la instrucción para revertirla. No
  modifica manifiestos.
- `scripts/diagnostico-catalogo-aeronaves.sql`: consultas de sólo lectura para
  `maestra_manifiestos`. Cubren esquema real, formatos de FECHA, claves de
  `datos_origen`, frecuencia y clasificación de AERONAVE, escrituras, matrículas
  con varios modelos, valores en el campo equivocado, matrículas sin catálogo,
  cobertura de equivalencias y calidad del modelo en `matriculas_manifiestos`.

## 5. Propuesta de equivalencias de AERONAVE

Registros: manifiestos de la muestra de junio 2026. "Tipo" significa que se
confirma el ICAO pero no la variante IATA. En los pendientes, el canónico es sólo
una propuesta y no se aplica.

| Valor original | Canónico propuesto | Problema | Evidencia | Registros | Estado |
|---|---|---|---|---:|---|
| `A320-271N` | 32N / A20N | Modelo técnico | TCDS: A320neo; FAA N528VL–N552VL | 124 | Confirmado |
| `A321-271NX` | 32Q / A21N | Modelo técnico | TCDS: A321neo; Doc 8643 A21N | 10 | Confirmado |
| `A321-271N` | 32Q / A21N | Modelo técnico | TCDS; FAA N534VL–N537VL, N542VL, N543VL | 1 | Confirmado |
| `A340-600` | 346 / A346 | Nombre en lugar de código | Nombre idéntico al del catálogo | 6 | Confirmado |
| `A340-800` (sólo YV3535) | 346 / A346 | Modelo inexistente | No está en Doc 8643; YV3535 = A340-600 (aircraft.csv, prensa, 6 de 8 registros) | 2 | Confirmado |
| `B737-8MAX`, `B-737-8MAX`, `B737-MAX8` | 7M8 / B38M | Nombre en lugar de código | Doc 8643 B38M | 17 | Confirmado |
| `B737-9MAX`, `B-737-9MAX` | 7M9 / B39M | Nombre en lugar de código | Doc 8643 B39M | 22 | Confirmado |
| `YA` | SF3 / SF34 | Código de operador | FAA N3172 SAAB 340B | 0 | Confirmado |
| `A320-233` | tipo A320 | Modelo técnico | TCDS: A320ceo; FAA N505VL–N527VL. IATA 320 o 32A abierto | 51 | Confirmado (tipo) |
| `A321-231` | tipo A321 | Modelo técnico | TCDS: A321ceo; FAA N530FL | 2 | Confirmado (tipo) |
| `B737-800` | tipo B738 | Nombre en lugar de código | Doc 8643; FAA 737-86J. IATA 738/73H/7S8/73K abierto | 49 | Confirmado (tipo) |
| `C208B` | tipo C208 | Nombre en lugar de código | Doc 8643 (Grand Caravan). IATA CNF o CES sin validar | 147 | Confirmado (tipo) |
| `770` | — (inválido) | Registro de prueba | Ver sección 4 | 0 | Confirmado |
| `A320`, `"A320 "`, `A-320` | — | Familia sin ceo/neo | Se usa en A320ceo y A320neo (FAA) | 1,740 | Pendiente |
| `A321`, `"A321 "`, `A-321` | — | Familia sin ceo/neo | aircraft.csv: 321 y 32Q; FAA N524VL y N506VL mal capturados | 1,188 | Pendiente |
| `E-195`, `E195` | — | Sin generación E1/E2 | E195 (E1) contra E295 (E2); XA-MX* figuran como E2 en el catálogo de matrículas | 637 | Pendiente |
| `E-190`, `E190` | — | Sin generación E1/E2 | E190 contra E290; también capturado en aviones E-195 | 509 | Pendiente |
| `B737-8`, `B-737-8` | 7M8 / B38M | Designación ambigua | Oficialmente 737-8 es el MAX 8 (Doc 8643, FAA), pero se capturó también en 737-800 (XAOOO) | 75 | Pendiente |
| `B737-80` | — | Valor truncado | 737-800 o 737-8; HI1078 y HI1082 son 7M8 en aircraft.csv | 3 | Pendiente |
| `B37-800` | tipo B738 | Error de escritura | XAADT: sus otros 5 registros dicen B737-800 | 1 | Pendiente |
| `A320-271` | 32N / A20N | Modelo inexistente | No existe sin N; probable truncado (XATVB) | 1 | Pendiente |
| `B737`, `B-737` | — | Familia sin serie | Se usó en un 737-800 y en un MAX 8 (FAA) | 4 | Pendiente |

Total: 431 registros con equivalencia confirmada (182 con variante IATA exacta y
249 sólo con ICAO) y 4,158 pendientes. Los pendientes son casi todos `A320`,
`A321`, `E-195` y `E-190`, que no se pueden asignar por el valor solo. Hay que
resolverlos por matrícula una vez que el catálogo de matrículas sea confiable.

## 5c. Embraer E2 de Mexicana ("295" en Conciliación)

Corrección del 6 de octubre. En Conciliación, los vuelos de Mexicana mostraban
AERONAVE "295", "295/E90", "295/E95" o "E95/295" sin nombre. No era un error de
carga:

- **295 es el código IATA del Embraer E195-E2 y 290 el del E190-E2.** En ICAO
  Doc 8643 son E295 (ERJ-190-400 / E195-E2) y E290 (ERJ-190-300 / E190-E2).
  El catálogo de tipos no tenía los E2, y por eso se veía el código crudo.
- **Los Embraer de Mexicana son E2.**
  - XA-MXA es un E195-E2 de 132 asientos: lo recibió en julio de 2025 y voló
    por primera vez del AIFA a Tulum el 25-ago-2025 (prensa: Por Esto,
    Aviacionline).
  - El catálogo de matrículas ya los tenía como E2: MXA–MXD "E-195/E2", MXE
    "ERJ 190-400" y MXF "ERJ 190-300", con pesos de E2 (MTOW 62.5 t y 56.4 t;
    un E195 de primera generación pesa unas 52 t).

Cambios:

- `aircraft type.csv`: nuevas entradas `290,E290,E190-E2` y `295,E295,E195-E2`
  (grupo C, como los demás E-Jets; sin especificaciones inventadas).
- `aircraft.csv`:
  - XA-MXA, MXB y MXC pasan de E95 (E195 de primera generación, 124 asientos)
    a 295, con 132 asientos y MTOW 62,500.
  - Se agregan XA-MXD y MXE (295) y XA-MXF (290, 108 asientos), con los datos
    del catálogo de matrículas.
- Pantalla: un valor con dos equipos ("295/E95") muestra los dos nombres
  ("E195-E2 / ERJ-195") y queda marcado para revisión, porque el itinerario no
  dice cuál voló.

No se mapeó 295 al E195 de primera generación (E95): son variantes distintas,
con distinta capacidad y peso.

## 5b. Datos reales: `maestra_manifiestos` (2022)

Revisión hecha el 6 de octubre en la base de producción. La tabla tiene 9,633
manifiestos de pasajeros, del 21-mar al 31-dic de 2022. AERONAVE tiene 13
valores, todos nombres con guion y ninguno es código del catálogo, más 643
vacíos.

| Valor | Manifiestos | Equivalencia | Estado |
|---|---:|---|---|
| A-320 | 4,180 | — (ceo/neo) | Pendiente (058) |
| E-190 | 3,086 | — (E1/E2) | Pendiente (058) |
| B-737-8 | 1,282 | — | Pendiente (058) |
| A-321 | 215 | — (ceo/neo) | Pendiente (058) |
| B-737 | 149 | — | Pendiente (058) |
| A-340-600 | 50 | 346 | Confirmado (060) |
| E-145 | 13 | ER4 | Confirmado (060) |
| A-319 | 4 | 319 | Confirmado (060) |
| B-737-NG | 4 | — | Pendiente (060) |
| A-340-300 / A-340-313X | 2 / 2 | 343 | Confirmado (060) |
| B-737-4 | 2 | 734 (FAA N311GT: 737-400) | Confirmado (060) |
| B-757-2 | 1 | tipo B752 | Confirmado (060) |
| (vacío) | 643 | — | — |

Resultado: 74 manifiestos con equivalencia confirmada, 8,916 pendientes y 643
vacíos.

"B-737-8" se usó en 63 matrículas de 6 aerolíneas, y entre ellas hay 737-800
que no son MAX: HP1730CMP de Copa (según el catálogo), N808SY (737-8BK según
la FAA) y los XA-OC* y XA-OOO de Aeroméxico. Así se confirma que ese valor no se
puede traducir automáticamente a 737 MAX 8.

Los errores de registro (AERONAVE que contradice a su matrícula) y las
correcciones de matrícula están en
[catalogo-matriculas-revision.md](catalogo-matriculas-revision.md).

## 6. Pendientes de validación

**Catálogo de modelos** (requieren SSIM o ficha técnica; no se cambiaron):

- `CRA,CRJ9` se llama "CRJ-700", pero el ICAO CRJ9 cubre el CRJ-705 y el CRJ-900.
  Falta saber qué representa CRA en SSIM.
- `E75` lleva ICAO E75L (ala larga); según la fuente secundaria, IATA E75 es el
  E175 de ala corta (E75S).
- `380` como IATA del A380-800: la fuente secundaria da 388.
- `737`, `727`, `747` y `M80` son códigos IATA de familia nombrados como una
  variante concreta.
- Códigos IATA que no se pudieron verificar: 73S, 73M, CNF, CES, AB3, 77F, 748,
  7S8, 731, 310 y F20. `B731` (737-100) ya no está en Doc 8643.
- Siguen habiendo nombres repetidos: "CRJ-700" (CRA, CR7), "B737-700" (73G, 737),
  "B727-200" (722, 727) y "B777-200F" (77F, 77X). El editor ya no elige uno solo.
- Especificaciones, que la app no usa: el MTOW mezcla kg y lb (77F 766,800;
  346/345 840,000). El MTOW del A380 (126,800) no corresponde a ninguna unidad.
  CNF trae el MTOW en la columna de altura, y SF3 tiene la altura y la longitud
  mal tecleadas (69.7 y 79.73).

**`aircraft.csv`, por matrícula.** Hay contradicción con el catálogo de
matrículas. El patrón está confirmado con FAA en matrículas N, pero estas no son
N:

- 737-8 (MAX 8) registrados como 73H (29): XA-MAG, XA-MAK, XA-MAO, XA-MAQ,
  XA-MAT, XA-SSR, XA-MAY, XA-CCC, XA-CCM, XA-DAP, XA-DAE, EI-GZA, EI-GZC, EI-GZB,
  XA-MJI, XA-MFM, XA-GNS, EI-GZE, XA-DAH, XA-DAI, XA-CCN, XA-CCO, XA-MLI, XA-DAL,
  XA-DAJ, XA-MFN, XA-DAO, XA-DAQ, XA-DAT.
- 737-9 (MAX 9) registrados como 73J (11): XA-MAZ, XA-IMH, XA-HSB, XA-BBB,
  XA-NNN, XA-JGQ, XA-JSO, XA-MJJ, XA-MKJ, XA-MIJ, XA-MFO.
- Pasajeros registrados como carguero:
  - Arajet HI1104 y HI1098 (737-8) como 73K.
  - Copa HP1533CMP (737-8V3) y HP1823CMP (737-86N) como 73K.
  - HP1525CMP y HP1530CMP (737-7V3) como 73S.
  - XA-AMU (737-800) como 73S, que además es 737-700.
- Otros desacuerdos de modelo:
  - XA-VOC, XA-VOE, XA-VOI: A320 contra 319.
  - XA-VCN, XA-VDM, XA-VDD: 737-300 contra 737-700.
  - XA-VXO, XA-VXL, XA-VUM: A320neo contra 32Q.
  - XA-VSI: A321 contra 32N.
  - XA-VUG, XA-VXT, XA-VXU: A321-271NX contra 321.
  - XA-VUP y CC-DBP: A320neo contra 320.
  - ~~XA-MXA, XA-MXB, XA-MXC: E-195/E2 contra E95.~~ Resuelto (sección 5c).

**`matriculas_manifiestos`.** Según la carga inicial; la tabla viva pudo
cambiar, y la consulta 10 la revisa.

- El modelo trae números de serie en lugar de modelo: 42 E-190 (`19000557`) y 7
  Cessna (`208B5799`).
- Hay MSN pegados al modelo (`A320-271N (8416)`).
- `A320-271NX` no existe (6 filas: XA-VXL, XA-VUT, XA-VUV, XA-VUX, XA-TVC,
  XA-VUZ). La única que está en aircraft.csv, XA-VXL, figura como A321neo.
- 3 filas tienen el modelo en la columna del fabricante, y 2 no tienen modelo
  (YV-3535, YV-3507).
- N542VL y N543VL dicen "A-320" pero son A321-271N (FAA). Su capacidad (230) ya
  es la de A321neo, así que el sobrecupo no se ve afectado.

**Manifiestos históricos**: los registros mal capturados de la sección 3 y las 55
matrículas con modelos distintos en un mismo mes. No se sobrescribieron.

## 7. Archivos

| Archivo | Cambio |
|---|---|
| `data/master/aircraft type.csv` | 9 filas corregidas y 3 eliminadas |
| `data/master/aircraft.csv` | 8 matrículas con tipo corregido |
| `script.js` | Traducción ICAO sólo inequívoca, editor, marca de valores fuera del catálogo, cambio remoto, estilo |
| `js/conci-importar-excel.js` | Aviso de AERONAVE fuera del catálogo en el resumen |
| `supabase/migrations/058_catalogo_aeronaves_equivalencias.sql` | Nuevo (sin aplicar) |
| `scripts/diagnostico-catalogo-aeronaves.sql` | Nuevo (sólo lectura) |
| `__tests__/conciliacion-catalogo-aeronaves.test.js` | Nuevo |
| `__tests__/conciliacion-sin-recarga.test.js` | Stubs de las funciones nuevas que usa el cambio remoto |

## 8. Comprobaciones

- `__tests__/conciliacion-catalogo-aeronaves.test.js`: 19 de 19.
  - Integridad de los CSV: códigos únicos, sin filas de prueba, sin ICAO
    inexistentes, aircraft.csv sólo con tipos del catálogo y matrículas FAA con su
    tipo.
  - Traducción: ICAO inequívoco contra ambiguo, IATA sobre ICAO y código repetido.
  - Editor: guarda IATA, rechaza lo ambiguo y no cambia un valor heredado al
    abrir y cerrar.
  - Pantalla: valores marcados y dato original conservado.
  - Aviso de la importación.
- La misma prueba contra el código anterior: fallan 16 de 19, así que sí detecta
  los problemas. Las 3 que pasan son las que ya se cumplían antes, o que protegen
  contra un error que este mismo cambio habría introducido.
- Suite completa (`npm test`): 2,421 aprobadas y 4 fallidas en 2 suites, ninguna
  relacionada con este cambio.
  - `estadistica-sql.test.js` busca `042_estadistica_v2_vista.sql`, que no existe
    en el repositorio (sólo existe `…_CORREGIDO.sql`).
  - `conciliacion-fecha-dia-seleccionado.test.js` es una prueba nueva aún sin
    versionar; falla igual sin este cambio.
- La migración 058 y las consultas de diagnóstico no se pudieron ejecutar: no hay
  PostgreSQL local ni acceso a la base. Se revisaron a mano. La migración termina
  en ROLLBACK para correrla primero en seco.

## Cómo aplicar lo de base de datos

1. Correr las consultas 0 y 0b de `scripts/diagnostico-catalogo-aeronaves.sql`
   para confirmar el esquema real de `maestra_manifiestos`. Ajustar los nombres si
   difieren.
2. Correr `058_catalogo_aeronaves_equivalencias.sql` tal cual. Si la verificación
   da 33 filas (16 confirmadas, 17 pendientes) y 4,589 manifiestos en la muestra,
   cambiar ROLLBACK por COMMIT.
3. Correr el resto del diagnóstico. La consulta 8 da la lista de valores nuevos
   para seguir completando la tabla de equivalencias.
