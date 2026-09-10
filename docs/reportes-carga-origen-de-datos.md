# Reportes de Carga: de dónde salen las cifras

Ingeniería inversa de `BASE DE CARGA 2026...xlsx` y `PRESENTACIÓN CARGA
30 AGOSTO 2026.pptx`, que es donde hasta ahora se armaban a mano los cuatro
reportes de carga y la presentación.

## La fuente

Las nueve tablas dinámicas del libro apuntan a la hoja `DATA`, una fila por
manifiesto de carga. **Los encabezados están en la fila 2**, no en la 1: la 1
lleva una fórmula auxiliar de duplicados.

La carga viene partida en cuatro campos, y esa partición es todo el reporte:

| Campo del libro | Qué es |
|---|---|
| `IMPORTACIÓN` | llegada internacional |
| `EXPORTACIÓN` | salida internacional |
| `KGS CARGA LLEGADA NLU` | llegada nacional |
| `KG. DE CARGA SALIDA NLU` | salida nacional |

### Cómo se traducen al sistema

La tabla `Conciliación Manifiestos` ya guarda `KGS. DE CARGA NACIONAL` y
`KGS. DE CARGA INTERNACIONAL`. Cruzándolas con `TIPO DE MANIFIESTO` salen los
cuatro campos exactos:

```
IMPORTACIÓN             = KGS. DE CARGA INTERNACIONAL  en LLEGADA
EXPORTACIÓN             = KGS. DE CARGA INTERNACIONAL  en SALIDA
KGS CARGA LLEGADA NLU   = KGS. DE CARGA NACIONAL       en LLEGADA
KG. DE CARGA SALIDA NLU = KGS. DE CARGA NACIONAL       en SALIDA
```

**No se derivan de `TIPO DE OPERACIÓN`**, aunque a primera vista lo parezca. En
el libro hay:

- **137 salidas internacionales** cuya carga está anotada en la columna
  nacional (`KG. DE CARGA SALIDA NLU`), 568,250 kg.
- **54 manifiestos** que llenan más de un campo a la vez: llevan carga nacional
  e internacional en el mismo vuelo.

Derivar por tipo de operación habría mandado esos kilos al lado equivocado.
Las **operaciones**, en cambio, sí se cuentan del lado que declara
`TIPO DE OPERACIÓN`: una salida internacional cuenta como operación
internacional aunque su carga sea nacional.

Cuando un manifiesto viejo solo trae `KG DE CARGA TOTAL`, se atribuye por
`TIPO DE OPERACIÓN`, que es lo único que hay para decidir.

## Reporte 1 — Subsecretaría

Mismas dos dinámicas que el oficio de pasajeros, filtradas por
`Cierre Subsecretaria`:

| | Ejes | Valor |
|---|---|---|
| `pivotTable6` (A3:D7) | `TIPO DE MANIFIESTO` × `TIPO DE OPERACIÓN` | `COUNT(AEROLINEA)` |
| `pivotTable7` (A13:D18) | `TIPO DE MANIFIESTO` | suma de los cuatro campos de carga |

Los kilos se agrupan en dos lados y se pasan a toneladas:

```
E15 =D15+D17        internacional en kg   (importación + exportación)
E16 =E15/1000       internacional en ton
E17 =D16+D18        nacional en kg        (llegada NLU + salida NLU)
E18 =E17/1000       nacional en ton
```

Y luego viene el detalle que importa: el oficio reporta **toneladas enteras**, y
la suma de las partes tiene que cuadrar con el total. El libro lo resuelve a
mano en un renglón llamado `REDONDEO`:

```
B24 =INT(E18)       entero nacional
C24 =E18-B24        decimal nacional
D24 =INT(E16)       entero internacional
E24 =E16-D24        decimal internacional
B27 = 1             ← ajuste escrito a mano
D27 = 0             ← ajuste escrito a mano
B29 =B24+B27        nacional final
D29 =D24+D27        internacional final
C34 =C31+C32        total
```

En el sistema el ajuste es automático: se toma la parte entera de cada lado y
el sobrante se le da al que arrastra la fracción mayor, de modo que
`nacional + internacional = round(total)` siempre.

Igual que el de pasajeros, el oficio **va por mes**: se pide con el día 1 y
lleva dos columnas, el cierre del último día del mes anterior y el del día 1 del
mes pedido.

## Reporte 2 — Hoja 1

`pivotTable5` (A5:F52) agrupa por `AEROLINEA` y suma los cuatro campos de carga
más la cuenta de aerolínea. Al lado, las columnas calculadas:

```
G  Real            =(B+C+D+E)/1000
H  Redondeo 2      =ROUND(G,2)
I                  =ROUND(H,2)
J  De Presentación =TRUNC(I,2)     ← lo que se publica
```

El cuadro visible no lee la dinámica: tiene una lista fija de 58 aerolíneas y va
a buscarlas.

```
N  OPERACIONES          =IFERROR(VLOOKUP(M,$A$4:$H$57,6,0)," ")   ← cuenta
O  CARGA EN TONELADAS   =IFERROR(VLOOKUP(M,$A$4:$J$67,10,0)," ")  ← columna J
N61/O61                 =SUM(...)                                  ← TOTAL
```

**Se trunca, no se redondea.** `TRUNC` a dos decimales evita que la suma de las
partes se pase del total real, que es lo que pasaría acumulando `ROUND`.

## Reporte 3 — Hoja 2

Una maqueta de tarjetas, dos renglones por aerolínea, que es lo que se pega en
la presentación:

```
No. de operaciones    ='Hoja 1'!N…
Total de carga en Tn. ='Hoja 1'!O…
```

## Reporte 4 — Reporte de Carga

Concentrado del año por mes, en dos bloques:

| | Ejes | Valor |
|---|---|---|
| `pivotTable9` (B5:F16) | `Meses (FECHA)` | suma de los cuatro campos |
| `pivotTable8` (B24:I36) | `Meses (FECHA)` × `TIPO DE MANIFIESTO` + `TIPO DE OPERACIÓN` | `COUNT(TIPO DE MANIFIESTO)` |

Los cuadros visibles son espejo de las dinámicas:

```
CARGA INTERNACIONAL KG        L6 =C7 (importación)   M6 =E7 (exportación)   N6 =SUM(L6:M6)
OPERACIONES INTERNACIONALES   L25=C27                M25=D27                N25=SUM(L25:M25)
```

Con la nota al pie: **No se consideran operaciones mixtas.**

## La presentación

Diez diapositivas. Solo cuatro llevan números:

| Diapositiva | Contenido | ¿De dónde? |
|---|---|---|
| 1 | Portada con mes y año | fecha del reporte |
| 2 | Resumen de la terminal | ver abajo |
| 3–6 | Tarjetas por modalidad | Hoja 2 (pegadas como imagen EMF) |
| 7 | Totales acumulados | acumulado |
| 8–9 | Catálogo de aerolíneas | fijo, no depende de los datos |
| 10 | GRACIAS | — |

La diapositiva 2 lleva la tabla `OPERACIONES / TONELADAS` con un renglón por
año, el del día y el acumulado:

```
S3:S5   CARGA 2023 / 2024 / 2025    ← constantes, años cerrados
S6      CARGA 2026                  =N61 (total de Hoja 1)
S7      Carga <hoy>                 el día
S8      ACUMULADO                   =SUM(S3:S7)
```

Los conteos de `OPERANDO ACTUALMENTE` —18 carga regular, 35 fletamento, 5 carga
mixta— **no salen de los manifiestos**: son el tamaño de los catálogos de las
diapositivas 8 y 9, que reflejan la situación contractual de cada aerolínea.

Los años 2023–2025 son línea base: preceden a la operación en este sistema y no
hay manifiestos capturados con los que calcularlos. Viven como constantes en
`BASE_HISTORICA` dentro del módulo.

Paleta de la baraja, tomada de su `ppt/theme`:

| Color | Uso |
|---|---|
| `#691B32` | vino institucional: títulos y encabezados |
| `#BC945A` | dorado: acentos |
| `#FFE699` | renglón del día |
| `#C6E0B4` | renglón del acumulado |

Tamaño de diapositiva: `9144000 × 6858000` EMU = 10 × 7.5 pulgadas, proporción
4:3.

## Resumen

| Reporte | Fecha que agrupa | Agrupación | Carga | Operaciones |
|---|---|---|---|---|
| Subsecretaría | `Cierre Subsecretaria`, por mes | manifiesto × operación | toneladas enteras con reparto | `COUNT(AEROLINEA)` |
| Hoja 1 | `FECHA`, año a la fecha | `AEROLINEA` | `TRUNC(kg/1000, 2)` | `COUNT(AEROLINEA)` |
| Hoja 2 | igual que Hoja 1 | `AEROLINEA` | igual | igual |
| Reporte de Carga | `FECHA`, por mes | mes × manifiesto | kg internacionales | `COUNT` internacionales |

La implementación vive en [`js/conci-reportes-carga.js`](../js/conci-reportes-carga.js)
y las reglas están fijadas en
[`__tests__/conciliacion-reportes-carga.test.js`](../__tests__/conciliacion-reportes-carga.test.js).

## La presentación sobre la plantilla original

La baraja tiene que salir igual que siempre y cambiar solo en los números, así
que la descarga no la dibuja desde cero: parte de la baraja original.

**La plantilla.** `plantillas/presentacion-carga.pptx` es la presentación de
agosto sin cifras. Conserva fondos, encabezado, logotipo de Defensa,
ilustración de portada, fuentes (Patria y Noto Sans), tablas con sus colores y
los catálogos de las diapositivas 8 y 9. Donde había un número quedó un
marcador `{{...}}`: 143 en total. Las tarjetas de las diapositivas 3 a 6 eran
una imagen EMF pegada desde Excel, con las cifras de agosto dentro; esas
imágenes se quitaron. Los metadatos traían nombres de personas (`Secretaría`,
`ComSocial2`) y quedaron a nombre de `AIFA`.

La plantilla se genera con
`node scripts/construye-plantilla-carga.js "<baraja original>.pptx"`, y solo
hace falta volver a correrlo si cambia el diseño.

**Las tarjetas.** El generador (`js/conci-presentacion-carga.js`) las vuelve a
dibujar con formas nativas —logotipo arriba, recuadro crema `#FFF2CC` con
operaciones y toneladas abajo— en la misma cuadrícula que tenían: columnas,
anchos y renglones salen de la posición de cada EMF y de sus recuadros crema.
Quedan editables en PowerPoint.

**Los logotipos.** Los 58 salieron de las propias tarjetas de la original:
cada EMF se dibujó sobre fondo transparente, se ubicaron sus recuadros crema
—18, 18, 17 y 5, justo los esperados— y se recortó lo que había encima de cada
uno. Viven en `images/presentacion-carga/logos/` y los usan tanto la baraja
como la Hoja 2. Una aerolínea que no esté en el catálogo usa el logotipo que ya
usa el resto de la aplicación.

**Qué se comprobó.** El `.pptx` generado se abrió con PowerPoint y se exportó
diapositiva por diapositiva: abre sin reparaciones, trae las 10 diapositivas y
el número de formas cuadra (diapositiva 3: 5 del diseño + 18 tarjetas × 3). A
la vista, las diapositivas 3 a 7 son indistinguibles de la original salvo por
las cifras.

**Un cambio de criterio.** En el libro, el renglón `Carga <fecha>` de la
diapositiva 2 era el incremento desde la presentación anterior: se tecleaba a
mano el total de la vez pasada y se restaba. Aquí es la carga de los vuelos
del día del corte, que no depende de cuándo se hizo la presentación anterior.
`CARGA <año>` va hasta el día previo y el acumulado suma ambos una sola vez.

## Qué falta validar

Las cifras se comprobaron corriendo la agregación del módulo sobre la hoja
`DATA` del libro. El total general cuadra exacto —**10,564 operaciones y 45
aerolíneas**, lo mismo que imprime `REPORTE CARGA`—, pero los desgloses por mes
salen entre 1 % y 2 % arriba de lo que muestran los cuadros de la hoja.

Dos causas posibles, y hay que descartarlas contra datos capturados de verdad
antes de mandar un oficio con estas cifras:

1. Los cuadros del libro leen **cachés de tabla dinámica**, que son una foto del
   momento en que se refrescaron por última vez y pueden ir por detrás de lo que
   hoy tiene `DATA`.
2. La reconstrucción de la prueba junta `IMPORTACIÓN + EXPORTACIÓN` en una sola
   columna internacional para simular la forma que tienen los datos en el
   sistema, y eso pierde el matiz de los 54 manifiestos mixtos.
