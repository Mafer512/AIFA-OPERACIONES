# Reportes de Pasajeros: de dónde salen las cifras

Ingeniería inversa del libro `excel/TUA y REPORTE GENERAL ABRIL 2026 (1).xlsx`,
que es donde hasta ahora se armaban a mano los tres reportes de pasajeros.
Todas las reglas de aquí se verificaron reproduciendo abril 2026 contra la hoja
`DATA`, fila por fila, y coinciden al número.

## La fuente

Las nueve tablas dinámicas del libro apuntan al mismo sitio:

```xml
<worksheetSource ref="A1:AK1048576" sheet="DATA"/>
```

`DATA` es una fila por manifiesto, con las mismas columnas que hoy tiene
`Conciliación Manifiestos` en el sistema. Los seis campos que alimentan los
reportes son:

| Campo | Para qué sirve |
|---|---|
| `CIERRE SUBSECRETARIA` | Fecha de corte. **Solo** la usa el reporte de Subsecretaría |
| `FECHA` | Fecha de operación. La usan las plantillas 1 y 2 |
| `TIPO DE MANIFIESTO` | `LLEGADA` / `SALIDA` |
| `TIPO DE OPERACIÓN` | `NACIONAL` / `INTERNACIONAL` |
| `AEROLINEA` | Eje de la plantilla 1 |
| `TOTAL PAX` | Lo único que se suma |

**No hay un campo de "operaciones".** El número de operaciones es siempre la
*cuenta* de un campo, y Excel no cuenta celdas vacías: un manifiesto al que le
falte ese campo suma pasajeros pero no suma operación. Cada reporte cuenta un
campo distinto, y esa diferencia es real:

| Reporte | Campo que cuenta |
|---|---|
| Subsecretaría | `AEROLINEA` |
| Plantilla 1 (bloque del día) | `TIPO DE OPERACIÓN` |
| Plantilla 2 | `TIPO DE MANIFIESTO` |

`DATA` trae **solo aerolíneas de pasajeros** — VIVA AEROBUS, MEXICANA,
AEROLITORAL, VOLARIS, AERUS, ARAJET, AEROVÍAS, CONVIASA, MAGNICHARTERS. Ninguna
de carga. En el sistema web la tabla trae pasajeros y carga juntos, así que hay
que descartar la carga; se hace con `_conciRowIsCargo`, el mismo criterio de las
píldoras *Pasajeros / Carga* de la tabla de Manifiestos.

## Reporte 1 — SUBSECRETARÍA

### El oficio va por mes, no por día suelto

En el libro, `CIERRE SUBSECRETARIA` tiene un valor por cada día: la captura se
cierra a diario y cada cierre abarca dos o tres días de operación. En abril 2026
hay 32 cierres distintos, del `2026-04-01` al `2026-05-04`.

Pero el **oficio que se envía** no es cualquiera de esos días: es el del cierre
del mes. Por eso lleva dos columnas —el último día del mes anterior y el día 1
del mes que se reporta— como se ve en la hoja de septiembre, con `31/08/2026` y
`01/09/2026`.

En el sistema el reporte se pide con el día 1 del mes correspondiente, y de la
fecha pedida solo se toma **el mes**:

```
columna izquierda = último día del mes anterior     p. ej. 31/08/2026
columna derecha   = día 1 del mes pedido            p. ej. 01/09/2026
```

Cada columna trae sus propios acumulados, contados **hasta su fecha de cierre**,
no hasta la fecha que se pidió. Por eso el acumulado del mes de la columna
izquierda es el mes anterior completo, y el de la derecha es solo ese día 1.

Si el día 1 del mes pedido todavía no tiene cierre capturado, se retrocede un
mes y se avisa en pantalla, en vez de entregar un oficio en ceros.

### Las dinámicas

Dos tablas dinámicas sobre el mismo filtro, `CIERRE SUBSECRETARIA = <fecha>`:

| | Ejes | Valor |
|---|---|---|
| `pivotTable2` (A3:D7) | `TIPO DE MANIFIESTO` × `TIPO DE OPERACIÓN` | `SUM(TOTAL PAX)` |
| `pivotTable3` (A12:D16) | `TIPO DE MANIFIESTO` × `TIPO DE OPERACIÓN` | `COUNT(AEROLINEA)` |

El bloque de texto que se envía lee esas dos tablas:

```
I4  =B1          ← la fecha del reporte
CB5 =$D$7        ← pasajeros, total general
CC5 =$C$7        ← pasajeros, nacional
CD5 =$B$7        ← pasajeros, internacional
CB6 =$D$16       ← operaciones, total general
```

Los tres acumulados son una recurrencia: cada día toma el acumulado del día
anterior y le suma el de hoy.

```
N10 = K10 + N5     A. Acumulado del mes        (fila 10 = pax, 11 = ops)
N15 = K15 + N5     B. Acumulado del año        (fila 15 = pax, 16 = ops)
N20 = K20 + N5     C. Acumulado desde el inicio de operaciones AIFA
```

Traducido al sistema, esa recurrencia es simplemente la suma sobre el rango:
mes a la fecha, año a la fecha, y todo lo anterior a la fecha del reporte.

**Verificación** — cierre 01/05/2026, calculado desde `DATA`:

```
LLEGADA: pax int=351 nac=9,179 total=9,530 | ops 3 / 64 / 67
SALIDA:  pax int=338 nac=9,418 total=9,756 | ops 2 / 59 / 61
TOTAL:   pax int=689 nac=18,597 total=19,286 | ops 5 / 123 / 128
```

Idéntico a lo que muestra la hoja.

## Reporte 2 — PLANTILLA 1 (hoja `PLANTILLA PAX`)

Numeralia por aerolínea, en dos bloques:

| | Filtro | Ejes | Valores |
|---|---|---|---|
| `pivotTable7` (A4:C12) | `FECHA` = día | `AEROLINEA` | `SUM(TOTAL PAX)`, `COUNT(TIPO DE OPERACIÓN)` |
| `pivotTable6` (A23:C33) | `FECHA` = (Todas) | `AEROLINEA` | `SUM(TOTAL PAX)`, `COUNT(AEROLINEA)` |

El cuadro visible no lee la dinámica directamente: tiene una lista fija de
aerolíneas y va a buscar cada una.

```
H10 =IFERROR(VLOOKUP(G10,$A$4:$C$13,2,0),"")   ← pax
I10 =IFERROR(VLOOKUP(G10,$A$4:$C$13,3,0),"")   ← operaciones
H19 =SUM(H10:H18)                              ← TOTAL
```

Esa lista fija es la razón de que en el reporte aparezcan aerolíneas con la
celda en blanco: no volaron ese día. En el sistema se listan las aerolíneas que
sí tienen manifiestos, ordenadas alfabéticamente, para que una aerolínea nueva
no se caiga del reporte en silencio.

**Verificación** — `FECHA` = 30/04/2026: AEROLITORAL 1,549 pax / 19 ops ·
VIVA AEROBUS 17,761 / 98 · **TOTAL 24,560 / 166**. Acumulado del mes:
VIVA AEROBUS 461,506 / 2,846 · **TOTAL 639,049 / 4,786**. Coincide con la hoja.

## Reporte 3 — PLANTILLA 2

Concentrado diario del mes:

| | Ejes | Valor |
|---|---|---|
| `pivotTable8` (B2:E34) | `FECHA` × `TIPO DE MANIFIESTO` | `SUM(TOTAL PAX)` |
| `pivotTable9` (H2:K34) | `FECHA` × `TIPO DE MANIFIESTO` | `COUNT(TIPO DE MANIFIESTO)` |

El cuadro es un espejo de las dos dinámicas, un renglón por día:

```
O11 =D4    P11 =C4    Q11 =E4      ← pasajeros: llegada, salida, total
T11 =J4    U11 =I4    V11 =K4      ← operaciones
O41 =SUM(O11:O40)                  ← TOTAL
O43 =AVERAGE(O11:O40)              ← PROMEDIO
Q45 =MAX(Q11:Q40)                  ← Máximo PAX del mes
V47 =MAX(V11:V40)                  ← Máximo OP del mes
```

`AVERAGE` ignora los días sin datos, así que el promedio es sobre los días que
ya tienen captura, no sobre los 30 del mes.

El promedio anual viene de otra hoja:

```
U46 ='PLANTILLA 3'!E27    PAX
V46 ='PLANTILLA 3'!E46    OP
```

y allá es el acumulado del año entre los días transcurridos:

```
B26 = 01/01/2026
B27 = TODAY()
C27 = DAYS(B27,B26)
E27 = E25/C27            ← total del año ÷ días transcurridos
```

**Verificación** — `FECHA` = 01/04/2026: SALIDA 11,546 pax / LLEGADA 10,837 /
total 22,383; operaciones 78 / 78 / 156. Idéntico a la hoja.

## Resumen

| Reporte | Fecha que agrupa | Agrupación | Pasajeros | Operaciones |
|---|---|---|---|---|
| Subsecretaría | `CIERRE SUBSECRETARIA`, por mes: último día del anterior + día 1 del pedido | `TIPO DE MANIFIESTO` × `TIPO DE OPERACIÓN` | `SUM(TOTAL PAX)` | `COUNT(AEROLINEA)` |
| Plantilla 1 | `FECHA` | `AEROLINEA` | `SUM(TOTAL PAX)` | `COUNT(TIPO DE OPERACIÓN)` |
| Plantilla 2 | `FECHA` | día del mes × `TIPO DE MANIFIESTO` | `SUM(TOTAL PAX)` | `COUNT(TIPO DE MANIFIESTO)` |

La implementación vive en [`js/conci-reportes-pasajeros.js`](../js/conci-reportes-pasajeros.js)
y las reglas están fijadas en
[`__tests__/conciliacion-reportes-pasajeros.test.js`](../__tests__/conciliacion-reportes-pasajeros.test.js).
