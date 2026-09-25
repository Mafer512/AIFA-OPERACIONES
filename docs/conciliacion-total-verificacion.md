# Verificación de Exportar Excel → Total

Fecha: 24 de septiembre de 2026. Entorno local: `http://localhost:3000/#conciliacion`.

## Ajuste del 25 de septiembre: recepción pendiente

HR. CUMPLIDAS (S) queda vacía si recepción (R) u operación (P) no contienen
fechas válidas de Excel. La fórmula verifica ambas celdas antes de restarlas,
evitando que Excel interprete la recepción vacía como cero y produzca cantidades
enormes de horas. Se conservan los resultados cuando existen ambas fechas,
incluidas operaciones a medianoche y cruces de día.

La modificación se limita a la fórmula del Excel Total y a la versión de su
archivo JavaScript. `script.js` coincide exactamente con el estado anterior a
este ajuste: captura, guardado y cálculos de pantalla permanecen intactos.

Verificación con los 188 registros reales: 81 resultados vacíos y 107 cálculos
conservados; otras 6,238 celdas y los 6,426 estilos no cambiaron. Se verificaron
12 casos de recepción ausente, valores inválidos, medianoche y diferencias de
cero o varias horas, además de serializar y reabrir el libro con ExcelJS.
Pasajeros y Carga produjeron los mismos modelos de hoja que antes. Build y
15 pruebas de origen de datos de exportación aprobados.

Evidencia local: `.tmp/verify-total-reception.cjs`,
`.tmp/total-verification/reception.json` y
`.tmp/total-verification/Conciliacion_Total_2026-09-25.xlsx`.

## Ajustes solicitados después de la primera entrega

Se eliminó la fila de control: encabezados en la fila 1 y datos desde la fila 2.
El autofiltro ahora es `A1:AI189`, el formato condicional `S2:S189` y sólo queda
congelada la primera fila. Se actualizaron las referencias de Q/S/T/AH. La
tolerancia de puntualidad sigue siendo 16 minutos, expresada como `(16/1440)`
en lugar de `$A$1`, porque A1 ahora contiene el encabezado.

AEROLINEA toma el nombre completo del mismo catálogo en memoria que usa la
pantalla y lo presenta en mayúsculas, como la imagen solicitada. Por ejemplo:
CZ → CHINA SOUTHERN AIRLINES, CV → CARGOLUX, Y4 → VOLARIS,
6R → AEROUNIÓN, E7 → ESTAFETA y A7 → AWESOME CARGO. Si no hay una
coincidencia, se conserva el valor original. No se agregaron consultas ni se
modificaron los registros.

Se conservaron los colores de Total: aerolíneas con fondo #245C4F y texto blanco;
encabezados #0A202D y el resto de rellenos originales.

Verificación del ajuste: 188 registros, 6,426 estilos idénticos tras desplazar
las filas, 752 fórmulas con referencias correctas, nombres completos comprobados
al serializar/reabrir con ExcelJS, build correcto y 84 pruebas aprobadas.
Pasajeros y Carga volvieron a producir modelos de hoja idénticos a los previos.
Evidencia: `.tmp/verify-total-revision.cjs` y
`.tmp/total-verification/revision.json`.

**Las siguientes secciones documentan la primera entrega, anterior a estos dos
ajustes autorizados.** Sus posiciones de filas y el criterio original de copiar
AEROLINEA literalmente han sido sustituidos por lo indicado arriba.

El formato está implementado y verificado. Sigue pendiente la decisión sobre la
derivación de RUTA; I–K sólo reciben campos separados si existen. La página también
tiene errores de arranque anteriores a este cambio, detallados abajo.

## Alcance y archivos

- `js/conci-export-total.js`: construcción exclusiva de la hoja DATA con ExcelJS 4.3.0, ya utilizado por la aplicación.
- `script.js`: desvío de `kind === 'total'` hacia ese generador, después de obtener las filas mediante `_conciGetExportRows()`.
- `index.html`: carga del nuevo módulo antes de `script.js`.
- Este informe.

Se conservan el día completo, las filas ocultas por filtros, el orden recibido y
el nombre `Conciliacion_Total_AAAA-MM-DD.xlsx`. No se modificaron consultas, API,
base de datos ni cálculos de la aplicación. Las fórmulas Q/S/T/AH se escriben
exclusivamente en el libro, tal como se solicitaron. Los textos se copian sin
traducir ciudades, resolver nombres de aeronaves, cambiar mayúsculas ni recortar
espacios. Las fechas se serializan conservando sus componentes, sin desplazarlas
por la zona horaria del navegador.

Los cambios que ya existían al comenzar en `script.js`, cierre de Subsecretaría,
pruebas y migraciones se preservaron. La comparación de regresión utiliza una
copia del estado de trabajo inicial, incluyendo esos cambios previos.

## Archivos examinados antes de modificar

Se abrieron con openpyxl 3.1.5 los adjuntos de
`C:\Users\GSD_OPN2\Downloads`:

- `2026GENERAL.....xlsx`, hoja DATA.
- `Conciliacion_Total_2026-09-24...xlsx`, hoja Total: 188 registros reales, correspondientes al 23/09/2026.

El segundo archivo alimentó tanto la generación con Node/ExcelJS como la descarga
desde Chrome en localhost. No se inventaron registros ni se consultó producción.
Las pruebas adicionales de casos límite se ejecutaron separadamente.

## Detalles en los que prevaleció GENERAL

- Hay **34 encabezados**, A–AH; AI está vacía y pertenece al autofiltro. No se reproducen las celdas residuales fuera de la tabla que inflan la dimensión física del modelo.
- Se copiaron los anchos almacenados, sin redondear; por ejemplo A = 25.140625.
- A usa el formato integrado 14 (`mm-dd-yy`, localizado por Excel); B usa `dd/mm/yyyy;@`.
- L–R usan el formato integrado 22 (`m/d/yy h:mm`); S usa `0.00`.
- El estilo base de X en GENERAL es blanco y `General`, con negrita y bordes hair a ambos lados. No es gris con `#,##0`.
- Bordes de datos: U, derecho; V–Y, ambos lados; Z, ninguno; AA–AB, izquierdo; AC, ambos lados. Son `hair`, sin bordes horizontales.
- Los colores del tema de GENERAL se conservan: blanco, negro y blanco con tinte −0.1499984740745262 para el gris #D9D9D9.
- GENERAL tiene variaciones históricas de estilo entre sus miles de filas. Se utiliza el estilo del bloque inicial, resolviendo el estilo de columna cuando una celda vacía no tiene estilo explícito. La comprobación es contra ese formato base uniforme.
- El desplazamiento guardado del modelo apunta a A7327. El archivo nuevo abre en A3, con las dos primeras filas congeladas.
- Autofiltro y formato condicional abarcan todas las filas exportadas: `A2:AI190` y `S3:S190`. No se copia el rango histórico incompleto `S3:S20360` del modelo.
- AE–AG quedan vacías por instrucción expresa, aunque el modelo contiene búsquedas a otro libro.

## Resultado de la comparación por código

Archivo descargado por Chrome: `.tmp/total-verification/browser-Conciliacion_Total_2026-09-24.xlsx`.

| Comprobación | Comprobaciones | Diferencias |
| --- | ---: | ---: |
| Estructura, hoja y registros | 4 | 0 |
| Altos de filas | 190 | 0 |
| Anchos | 35 | 0 |
| Columnas ocultas | 35 | 0 |
| Texto y orden de encabezados | 34 | 0 |
| Estilo de encabezados | 170 | 0 |
| Fuentes de datos | 6,392 | 0 |
| Rellenos de datos | 6,392 | 0 |
| Bordes de datos | 6,392 | 0 |
| Alineación de datos | 6,392 | 0 |
| Formatos numéricos | 6,392 | 0 |
| A1 y G1 | 12 | 0 |
| Vista y paneles congelados | 6 | 0 |
| Autofiltro | 1 | 0 |
| Formato condicional | 2 | 0 |
| Fórmulas | 752 | 0 |
| Fechas/horas reales de Excel | 800 | 0 |
| Celdas vacías previstas | 1,504 | 0 |
| Valores y orden contra el Excel de referencia | 3,572 | 0 |
| **Total** | **39,077** | **0** |

Evidencia local, excluida de Git porque contiene datos operativos:

- `.tmp/inspect-total.py`: inspección inicial con openpyxl.
- `.tmp/verify-total.cjs`: generación, conservación de datos y comparación antes/después de Pasajeros y Carga.
- `.tmp/compare-total.py` y `.tmp/total-verification/comparison.json`: comparación del archivo descargado con el modelo.
- `.tmp/browser-total.cjs` y `.tmp/total-verification/browser*.json`: prueba en Chrome y contraste con la versión inicial.

## Pasajeros, Carga, build y consola

- El modelo completo de las hojas generadas por Pasajeros y Carga fue idéntico antes y después: valores, columnas, estilos y configuración. Se utilizaron los mismos registros y los mismos catálogos deterministas en ambas ejecuciones aisladas.
- Pasaron 84 pruebas de exportación, carga en tránsito y reportes de Pasajeros/Carga.
- Pasaron 10 pruebas de carga y navegación de la página con jsdom.
- `npm.cmd run build`, `node --check script.js` y `node --check js/conci-export-total.js`: correctos.
- El servidor y el nuevo módulo respondieron HTTP 200 en localhost.
- Chrome descargó los 188 registros con el nombre esperado y sin errores propios de la exportación.
- **La consola global no está limpia**: se reprodujeron tanto antes como después `colabAvatarFallback is not defined` y tres rechazos MIME por los archivos ausentes `js/asistente-aifa-datos.js`, `js/asistente-aifa.js` y `js/asistente-aifa-ui.js`. No se corrigieron porque pertenecen a otras funcionalidades, fuera del alcance autorizado.

## Columnas sin dato y decisión pendiente

| Columnas | Estado |
| --- | --- |
| I–K: ORIGEN, ESCALA, DESTINO | La fuente de Conciliación tiene RUTA y DESTINO / ORIGEN, no tres campos separados. Se dejan vacías mientras se decide la derivación. Si existen campos separados con esos nombres exactos, se copian sin transformación. |
| U: IMPORTACIÓN | Sin equivalente claro; vacía. |
| V: KGS CARGA LLEGADA NLU | Sin equivalente claro; vacía. |
| W: EXPORTACIÓN | Sin equivalente claro; vacía. |
| X: KG. DE CARGA SALIDA NLU | Sin equivalente claro; vacía. |
| Y: TRANSITO | Se vincula exclusivamente a KGS. DE CARGA EN TRANSITO. El adjunto antiguo no contiene ese campo, por eso la muestra queda vacía. Nunca se utiliza TRANSITOS de pasajeros. |
| AE–AG | Ocultas y vacías, como se solicitó. |

No se reutilizó carga nacional/internacional para U–X.

Propuesta enviada al usuario y todavía pendiente: tomar el tramo que llega o sale
de NLU. Para `GDL-NLU-LUX`, llegada = `GDL | GDL | NLU` y salida =
`NLU | LUX | LUX`. Si NLU no aparece o la ruta es ambigua, dejar I–K vacías.
Esta derivación **no se ha implementado**.
