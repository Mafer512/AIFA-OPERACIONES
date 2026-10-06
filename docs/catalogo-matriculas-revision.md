# Revisión de los catálogos de matrículas

Fecha: 6 de octubre de 2026. Complementa
[catalogo-aeronaves-revision.md](catalogo-aeronaves-revision.md).

## Qué se revisó

| Fuente | Registros | Qué es |
|---|---:|---|
| `data/master/aircraft.csv` | 1,186 | Matrícula → tipo IATA, operador y aerolínea (análisis y manifiestos) |
| `db/seed_matriculas_manifiestos.sql` | 575 | Carga inicial de `public.matriculas_manifiestos`: la tabla que usa Conciliación para ESTATUS MATRÍCULA y la capacidad del sobrecupo |
| Manifiestos de junio 2026 (`supabase/migrations/jun2026_parts`) | 4,589 (226 matrículas) | Columna MATRÍCULA real |
| [Registro FAA](https://registry.faa.gov/AircraftInquiry), 2026-10-06 | 396 matrículas N | Estado vigente, fabricante, modelo y número de serie |

La tabla viva `matriculas_manifiestos` no se pudo leer (la clave pública no
tiene permiso), así que se revisó su carga inicial. Pudo editarse después desde
la pantalla; `scripts/diagnostico-matriculas.sql` repite estas revisiones sobre
la tabla real.

Revisiones aplicadas a cada fuente:

- **Repetidas**: misma matrícula con otra escritura (`XA-VBZ` / `XAVBZ` /
  `XA VBZ`). Se usa la misma llave que la pantalla: sin guiones, puntos ni
  espacios.
- **Escritura**: espacios, minúsculas y caracteres raros.
- **Formato**: según la marca de nacionalidad (XA + 3 letras, N + hasta 5
  caracteres sin I ni O, HP, HI, YV, C-F/C-G, B-H/K/L…).
- **Coherencia**: entre los dos catálogos (aerolínea, tipo y capacidad) y contra
  el registro FAA.

## Resultado

**Repetidas**

- `aircraft.csv` tiene una: EI-MAE aparece dos veces, con distinto operador (GH
  y M7) y distinto MTOW. Queda pendiente.
- La carga inicial de `matriculas_manifiestos` no tiene ninguna.
- La base sí permitía repetidas. El índice único de la migración 006 compara
  con guiones y espacios, y la pantalla sin ellos. Además, al cargar el catálogo
  no había orden, así que con una repetida la aerolínea y la capacidad del
  sobrecupo salían al azar. Se corrigió (ver abajo).

**Escritura y formato**

- `HP1536 CMP` trae un espacio interno.
- Todas las demás matrículas de los dos catálogos tienen un formato válido para
  su país.

**Contra el registro FAA (396 matrículas N)**

- 383 están vigentes.
- 11 de `aircraft.csv` ya no corresponden a ningún avión: N203CM, N342AM,
  N501VL, N502VL (dada de baja), N503VL, N504VL, N517VL, N532LA, N667DN, N680BR
  y N815SY. N517VL también está en el catálogo de matrículas. No se borraron,
  porque vuelos anteriores pueden usarlas.
- 36 tenían el tipo equivocado en `aircraft.csv`. Se corrigieron 33; quedan 3.

## Correcciones aplicadas

### `data/master/aircraft.csv` (37 filas)

Sólo cambia la columna indicada; pesos y capacidades no se tocan.

| Matrícula | Columna | Antes → ahora | Evidencia |
|---|---|---|---|
| N188AM, N368AM, N479AM, N759AM, N27260 | Tipo | 73K → 7M8 | FAA: 737-8 (737 MAX 8) |
| N852GT, N863GT, N864GT | Tipo | 74Y / 748 → 74N | FAA: 747-87UF, 747-8F, 747-83QF |
| N416MC, N430GT, N431GT, N569CA, N706CK, N767CK | Tipo | 744 / 747 / 74N → 74Y | FAA: 747-4xxF |
| N708CK, N741CK | Tipo | 74N → 74Y | FAA: 747-4B5 / 747-4H6 (serie 400, no 747-8). La fila tiene capacidad 0 y la flota de carga de Kalitta está en 74Y |
| N415UP | Tipo | 753 → 75F | FAA: 757-24APF (package freighter) |
| N546VL | Tipo | 320 → 32N | FAA: A320-271N |
| N337QT | Tipo | 332 → 333 | FAA: A330-343 |
| N332QT, N335QT | Tipo | 333 → 332 | FAA: A330-243F (el catálogo no tiene código de A330 carguero) |
| N234AX | Tipo | 764 → 762 | FAA: 767-224; Omni Air vuela pasajeros |
| N344UP | Tipo | 764 → 76F | FAA: 767-34AF (carguero de fábrica); flota UPS de carga en 76F |
| N347CM, N432AX, N378CX, N396CM | Tipo | 76X / 764 → 76F | FAA: 767-323 (serie 300); Amerijet sólo opera cargueros y su flota está en 76F |
| N538LA | Tipo | 764 → 76F | FAA: 767-316; LATAM Cargo sólo carga, su flota en 76F |
| N710GT, N878FD | Tipo | 77W / 77L → 77F | FAA: 777F; los 777 de Atlas y FedEx están en 77F |
| N211RH | Tipo | M11 → SW4 | FAA: Fairchild SA227-AC (Metro III), registrado como MD-11; Doc 8643 SW4 |
| N2699Y, N611RH | Tipo | SW3 → SW4 | FAA: SA227-AC / SA227-AT; Doc 8643 SW4 |
| N538VL | Uso | MILITARY → CIVILIAN | FAA: A320-271N de Volaris con registro civil vigente |
| HI1098 | Aerolínea | Copa Airlines → Arajet | Su código de operador (DM) es Arajet en las otras 9 filas, HI es República Dominicana y el catálogo de matrículas dice ARAJET |
| XAVUQ | Aerolínea | Copa Airlines → Volaris | Código Y4 = Volaris en 166 filas; XA es México; catálogo de matrículas: VOLARIS |
| CGPAJ | Aerolínea | Cargolux → Cargojet Airways | Código W8 = Cargojet en 40 filas; C-G es Canadá (Cargolux registra en Luxemburgo) |

Con las 8 de la revisión anterior suman 45 filas corregidas.

### Pantalla "Catálogo de matrículas" (`script.js`)

- Al guardar se quitan los espacios internos, con lo que ya no puede entrar
  otra `HP1536 CMP`. El guion se conserva.
- Si la matrícula ya existe escrita de otra forma, no se da de alta y el
  mensaje dice cuál registro editar.
- Al cargar el catálogo, si la tabla tiene repetidas, manda la editada más
  recientemente y queda un aviso en consola. Antes era al azar.

### Base de datos (preparado, sin aplicar)

`supabase/migrations/059_matriculas_manifiestos_unicidad.sql`, que termina en
ROLLBACK:

- `HP1536 CMP` → `HP1536CMP`.
- N542VL y N543VL: modelo "A-320" → "A321-271N" (FAA, series 8603 y 9070). Su
  capacidad, 230, ya era la de un A321neo.
- Índice único sobre la matrícula sin guiones ni espacios. Si la tabla ya tiene
  repetidas, no lo crea y las lista; no borra nada.

Cada corrección sólo se aplica si el valor sigue como en la carga inicial.

## Manifiestos de junio 2026

**20 matrículas usadas en 228 manifiestos no están en ningún catálogo.** Para
esas, Conciliación marca "NO ACTIVA" y no calcula el sobrecupo.

| Matrícula | Registros | Aerolínea | Lectura |
|---|---:|---|---|
| XA-VMI | 68 | Viva Aerobus | Aeronave real faltante en los catálogos |
| XA-VXY | 63 | Viva Aerobus | Aeronave real faltante |
| XA-VCG | 48 | Viva Aerobus | Aeronave real faltante |
| HI1134, HI1140, HI1118, HI1133, HI1126 | 14, 6, 4, 3, 1 | Arajet | Flota nueva de Arajet faltante |
| XA-AMZ, XA-SRK, XA-AMT | 3, 2, 2 | Aeroméxico | Por confirmar |
| XA-ANC | 2 | Aeroméxico Connect | Por confirmar |
| N291GX, N530FL | 2, 2 | Global Crossing | Vigentes en FAA (A320-214, A321-231); faltan en los catálogos |
| HC-CXU | 2 | Aeroregional | Por confirmar; aircraft.csv tiene HC-CHU |
| **N8752AM** | 1 | Aeroméxico | **Formato inválido** (N admite hasta 5 caracteres). Probable N875AM |
| **N358VL** | 2 | Volaris | **No asignada en FAA**. Probable N538VL (dígitos invertidos) |
| **XA-XVY** | 1 | Viva Aerobus | Probable XA-VXY (letras invertidas) |
| **XA-CDJ**, **XA-CDB** | 1, 1 | Viva Aerobus | Probables XA-VDJ y XA-VDB (Viva usa XA-V…) |

**Otros hallazgos**

- XA-VXB y XA-VXS (Viva Aerobus) aparecen una vez cada una con AEROLINEA =
  VOLARIS. Error de captura en uno de los dos campos.
- 13 matrículas con escrituras distintas (`HI1104` / `HI-1104`, `XA.MXB`, `XA–MXC`
  con raya larga). La pantalla las compara sin signos, así que no afecta los
  cálculos.
- No se corrigió ningún manifiesto.

## Datos reales: base de producción, 6 de octubre

Consultas de `scripts/diagnostico-pendiente.sql`.

**`public.matriculas_manifiestos`, la tabla viva**

- Sin repetidas, sin escritura rara y sin formatos inválidos. La 059 ya está
  aplicada, con su índice de unicidad.
- Tiene 80 filas con el modelo mal capturado, exactamente las mismas que la
  carga inicial. Las capacidades dispersas también coinciden con lo visto en la
  carga inicial.

**`public.maestra_manifiestos`**

- 9,633 manifiestos de pasajeros, del 21-mar al 31-dic de 2022. FECHA tiene un
  solo formato (`AAAA-MM-DD`) y todas se pueden convertir.
- `datos_origen` guarda el renglón del Excel (22 claves, entre ellas
  `MATRÍCULA`, `TIPO DE AERONAVE`, `archivo` y `fila_excel`), así que el dato
  original nunca se pierde.
- La app no usa esta tabla en ninguna parte del código.

**Matrículas de 2022 que no están en el catálogo: 34**

*Corregidas en la migración 060 (8 manifiestos).* La original queda en
`datos_origen`.

| Capturada | Corregida | Evidencia |
|---|---|---|
| HB1730CMP (2) | HP1730CMP | HB es Suiza; CMP es el sufijo de Copa; HP1730CMP es el 737-800 de Copa del catálogo |
| VY-3507 | YV-3507 | VY no es marca de nacionalidad; YV-3507 es el A340-300 de Conviasa y el manifiesto dice A-340-313X |
| VA-VBR | XA-VBR | VA no es marca de nacionalidad; XA-VBR es el A321neo de Viva (manifiesto: A-321) |
| VA-VSZ | XA-VSZ | Ídem; A320 de Volaris (manifiesto: A-320) |
| ZA-DRA | XA-DRA | ZA es Albania; XA-DRA es el 737-800 de Aeroméxico |
| N515CL | N515VL | FAA: N515CL es una Cessna 182G privada; N515VL es el A320-233 de Volaris |
| N218GX | N281GX | FAA: N218GX está registrada a una oficina de la propia FAA; N281GX es el A320-214 de Global X |

*Probables errores, pendientes.* Tienen formato válido, así que podrían existir.
Se confirman revisando el vuelo de ida o vuelta del mismo día.

- Volaris: XA-RVW → XA-VRW, XA-VHS → XA-VSH, XA-CRH → XA-VRH.
- Viva Aerobus: XA-VCX → XA-VXC.
- Aeroméxico (E-190): XA-EAM → XA-AEM, XA-IAX → XA-IAC, XA-MAX → XA-MAC.
- N570VL no existe en la FAA.
- N5232VL tiene formato inválido. Puede ser N523VL, N532VL o N522VL.
- Sin candidata única: XA-AIC (5), XA-AAE, XA-AFF, XA-ALX y XA-AXX.

*Aeronaves reales que faltan en el catálogo de matrículas.* Sí están en
aircraft.csv:

- YV-3533 (28), YV-2911 y 9H-TJC.
- XA-SFH, XA-NFP, XA-AFH y XA-RUV (ERJ-145).
- N281GX.
- N808SY (FAA: 737-800) y N311GT (FAA: 737-400).
- N815SY: ya no tiene avión en la FAA.

**Otros errores de captura en 2022 (no se corrigieron)**

- **AERONAVE que contradice a la matrícula:**
  - Los E190 de Aeroméxico Connect aparecen como A-320. Por ejemplo XA-ALL, que
    en sep-2022 suma 106 manifiestos entre A-320 y E-190; también XA-FAC, XA-ALZ,
    XA-ACM, XA-MAC, XA-AEM, XA-ALU y XA-AEI.
  - Los 737-800 XA-OCB, XA-OCC, XA-OCA y XA-OOO aparecen como E-190.
  - YV-3507 (A340-300) aparece como A-340-600.
  - XA-NFP (ERJ-145) aparece como E-190.
  - Varios A320 y A321 de Viva aparecen mezclados.

  No se puede saber cuáles registros son los malos sin revisarlos uno por uno.
- XA-VAQ (Viva) aparece con aerolínea VOLARIS en julio 2022.
- 643 manifiestos no tienen AERONAVE ni matrícula.

## Pendientes

**`aircraft.csv`**

- EI-MAE repetida (GH/187,000 contra M7/242,000). Hay que decidir cuál queda.
- Falta saber si son de pasajeros o de carga; la serie está confirmada por FAA:
  - N663GT: Atlas, 767-324, ¿763 o 76F?
  - N808SY: Sun Country, 737-8BK, hoy `737`.
  - N849SY: Sun Country, 737-8JP, hoy `73S`.
- Las 11 matrículas N sin avión vigente (ver "Resultado").
- Códigos de operador que no cuadran con la aerolínea:
  - N330QT y N337QT llevan AV, pero sus hermanos QT llevan 6R; la FAA los tiene
    a nombre de fiduciarios.
  - EC-OAQ: G2 con Plus Ultra.
  - EC-NZF, EC-NOI y CS-WFP llevan W2.
  - CC-CXE: matrícula chilena con M3.
  - N389UP y ET-APU no tienen código.
  - AERUS aparece con tres nombres distintos.
- MTOW con un cero de menos: 9H-VDC (18,700) y CS-WFP (21,200).
- Los desacuerdos de modelo con el catálogo de matrículas en matrículas XA, HI,
  HP y EI. Están listados en la revisión del catálogo de aeronaves, sección 6.

**`matriculas_manifiestos`**

- N517VL: la FAA la tiene reservada y sin avión desde el 16-12-2025.
- XA-ADD (787-9): MLW 58.06 y MTOW 70.08 son los de un 737-700. Sólo se
  muestran; no entran en cálculos.
- HP1526CMP: capacidad 124 en un 737-800 (las otras de Copa tienen 160 o 188).
  Afecta el sobrecupo.
- Altas: las 20 matrículas de los manifiestos que faltan, sobre todo XA-VMI,
  XA-VXY, XA-VCG y la flota nueva de Arajet.

## Comprobaciones

- `__tests__/conciliacion-catalogo-matriculas.test.js`: 9 de 9.
  - Sin repetidas salvo EI-MAE.
  - Sin espacios ni minúsculas.
  - Tipos y aerolíneas verificados.
  - Formato al guardar, rechazo de repetidas y orden al cargar.
- Contra el código y los datos anteriores fallan 5. Las 4 que pasan describen
  cosas que ya estaban bien y no deben romperse.
- Suite completa: 2,430 aprobadas. Las 4 fallas son las mismas 2 suites ajenas a
  este cambio (ver la revisión del catálogo de aeronaves).
- La migración 059 y `scripts/diagnostico-matriculas.sql` no se pudieron
  ejecutar porque no hay acceso a la base. Se revisaron a mano.
