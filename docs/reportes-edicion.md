# Reportes: edición y marcatextos

En **Conciliación → Reportes** (Carga y Pasajeros) cualquier reporte se puede
corregir a mano y marcar con colores antes de imprimirlo o descargarlo.

## Cómo se usa

1. Elegir la fecha y pulsar **Generar**.
2. Pulsar **Editar**. Aparece la barra *Modo edición*:
   - **Escribir**: clic en una celda y cambiar su contenido. Enter o Esc terminan.
   - **Marcatextos** (rojo, verde, amarillo, azul, morado): elegir el color y hacer
     clic —o arrastrar— sobre las celdas. Volver a pasar el mismo color lo quita.
   - **Quitar color**: limpia las celdas por las que se pasa.
3. **Guardar** deja la versión editada; **Cancelar** deshace lo no guardado.

Al abrir otra vez ese reporte en esa fecha se ve la versión editada, con un aviso
de quién la guardó y cuándo. **Ver calculado** muestra las cifras del momento y
**Descartar edición** borra la versión editada.

## Qué se guarda y dónde

- Se guarda una versión por **apartado + reporte + fecha** en la tabla
  `conci_reportes_ediciones` de Supabase
  (`migrations/20260911_conci_reportes_ediciones.sql`). **No modifica
  "Conciliación Manifiestos"**: los reportes calculados siguen saliendo de lo
  capturado.
- Mientras la tabla no exista, la edición se guarda solo en el navegador de
  quien la hizo y el aviso lo dice ("solo en este navegador").
- Una versión editada ya no se recalcula: si después se corrigen manifiestos de
  esa fecha, hay que descartarla (o volver a editarla) para ver las cifras nuevas.
- Los roles de consulta (`viewer`, `lector`, `colab_viewer`) ven las versiones
  editadas pero no el botón Editar.
- Lo guardado se limpia antes de mostrarse (sin scripts, manejadores de eventos
  ni URLs `javascript:`), porque es HTML que llega de la base.

## Impresión y descargas

- **Imprimir** sale tal como se ve: textos corregidos y colores.
- **Plantilla 1 y 2 (Excel)**: cada celda de la hoja lleva `data-xl="renglón,columna"`
  con su lugar en el archivo. Lo que difiere de lo calculado pasa al Excel (los
  números tecleados vuelven a ser números) y cada celda marcada lleva su relleno.
- **Presentación (PowerPoint)**: cada cifra de la vista previa lleva el marcador
  de la plantilla (`data-ph`) o su tarjeta (`data-tj`). Lo corregido sustituye al
  marcador solo en esa diapositiva; en tablas se pinta la celda, en cuadros de
  texto se resalta la cifra y las tarjetas marcadas cambian el crema por el color.
  Los textos fijos de la plantilla (títulos, nombres de aerolíneas) no tienen
  marcador: esos se ajustan ya en PowerPoint.
