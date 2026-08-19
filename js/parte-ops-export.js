/* ==========================================================================
   Parte de Operaciones — exportación anual en cuadrícula día × mes
   ==========================================================================

   La tabla de la pantalla es un registro cronológico: una fila por día, con
   llegadas y salidas separadas. Para revisar el año de un vistazo —comparar el
   mismo día entre meses, ver de qué días falta el parte— hace falta lo
   contrario: una cuadrícula con los 31 días como renglones y los 12 meses como
   columnas.

   Ese es el formato que se usa fuera del sistema, así que la exportación lo
   reproduce tal cual:

              ┌─────ENE─────┐┌─────FEB─────┐   ...   ┌─────DIC─────┐
       DIA    PAX CARGA GRAL PAX CARGA GRAL         PAX CARGA GRAL
        1     142   21    2
        2     162   26    7
       ...

   Cada casilla suma llegadas y salidas de esa categoría, que es como se
   reporta hacia afuera:

       PAX   = comercial_llegada + comercial_salida
       CARGA = carga_llegada     + carga_salida
       GRAL  = general_llegada   + general_salida

   Un día sin parte capturado se deja EN BLANCO, no en cero: son cosas
   distintas y confundirlas es lo que hace que un hueco pase inadvertido.
   ========================================================================== */
(function () {
    'use strict';

    const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const MEDIDAS = ['PAX', 'CARGA', 'GRAL'];
    const DIAS_MAX = 31;

    function _num(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    }

    // La columna `fecha` es DATE y llega como "2026-07-30". Se lee del texto a
    // propósito: pasarla por new Date() la interpreta como UTC y, según la zona
    // horaria del equipo, el día 1 de un mes se dibuja en el 30 del anterior.
    // En una cuadrícula por día ese corrimiento no se nota a simple vista.
    function partesDeFecha(valor) {
        const texto = String(valor ?? '').trim();
        const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        const anio = m[1];
        const mes = Number(m[2]);
        const dia = Number(m[3]);
        if (mes < 1 || mes > 12 || dia < 1 || dia > DIAS_MAX) return null;
        return { anio, mes, dia };
    }

    /**
     * Años con al menos un parte capturado, del más reciente al más antiguo.
     * Sirve para ofrecer sólo lo que existe en vez de un rango inventado.
     */
    function aniosDisponibles(filas) {
        const vistos = new Set();
        (filas || []).forEach(fila => {
            const partes = partesDeFecha(fila && fila.fecha);
            if (partes) vistos.add(partes.anio);
        });
        return [...vistos].sort().reverse();
    }

    /**
     * Cuadrícula [día][mes] del año pedido. Cada casilla es null (sin parte
     * capturado) o { pax, carga, gral }.
     */
    function construirMatrizAnual(filas, anio) {
        const anioTexto = String(anio || '').trim();
        const celdas = Array.from({ length: DIAS_MAX }, () => Array.from({ length: 12 }, () => null));
        let registros = 0;

        (filas || []).forEach(fila => {
            const partes = partesDeFecha(fila && fila.fecha);
            if (!partes || partes.anio !== anioTexto) return;
            const d = partes.dia - 1;
            const m = partes.mes - 1;
            const valores = {
                pax: _num(fila.comercial_llegada) + _num(fila.comercial_salida),
                carga: _num(fila.carga_llegada) + _num(fila.carga_salida),
                gral: _num(fila.general_llegada) + _num(fila.general_salida),
            };
            // Dos partes para el mismo día no deberían existir, pero si los hay
            // se SUMAN en vez de que uno pise al otro: un total que se ve alto
            // se investiga, un registro perdido en silencio no.
            const previo = celdas[d][m];
            celdas[d][m] = previo
                ? {
                    pax: previo.pax + valores.pax,
                    carga: previo.carga + valores.carga,
                    gral: previo.gral + valores.gral,
                }
                : valores;
            registros++;
        });

        return { anio: anioTexto, celdas, registros };
    }

    /** Suma de cada medida por mes, para el renglón TOTAL del pie. */
    function totalesPorMes(matriz) {
        return Array.from({ length: 12 }, (_, m) => {
            let pax = 0, carga = 0, gral = 0, dias = 0;
            for (let d = 0; d < DIAS_MAX; d++) {
                const celda = matriz.celdas[d][m];
                if (!celda) continue;
                pax += celda.pax; carga += celda.carga; gral += celda.gral; dias++;
            }
            return dias ? { pax, carga, gral, dias } : null;
        });
    }

    // ── Escritura del archivo ────────────────────────────────────────────────

    const GRIS_CABECERA = 'FFD6DCE4';
    const AZUL_DATO = 'FFD6E9F5';
    const AZUL_TOTAL = 'FFB7D7EA';

    function _bordes(medioIzquierda) {
        const fino = { style: 'thin', color: { argb: 'FF7F7F7F' } };
        const medio = { style: 'medium', color: { argb: 'FF404040' } };
        return {
            top: fino,
            bottom: fino,
            right: fino,
            left: medioIzquierda ? medio : fino,
        };
    }

    function construirLibro(matriz) {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'AIFA Operaciones';
        const ws = wb.addWorksheet(`Parte ${matriz.anio}`, {
            // Al desplazarse hacia abajo o a la derecha, el día y los meses
            // tienen que seguir a la vista: si no, la cuadrícula no se puede leer.
            views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
        });

        ws.getColumn(1).width = 6;
        for (let m = 0; m < 12; m++) {
            for (let s = 0; s < 3; s++) ws.getColumn(2 + m * 3 + s).width = 8;
        }

        // Cabecera de dos pisos: el mes arriba, sus tres medidas abajo.
        const filaMes = ws.getRow(1);
        const filaMedida = ws.getRow(2);
        filaMes.height = 18;
        filaMedida.height = 18;

        ws.mergeCells(1, 1, 2, 1);
        const celdaDia = ws.getCell(1, 1);
        celdaDia.value = 'DIA';

        MESES.forEach((mes, m) => {
            const primera = 2 + m * 3;
            ws.mergeCells(1, primera, 1, primera + 2);
            ws.getCell(1, primera).value = mes;
            MEDIDAS.forEach((medida, s) => { ws.getCell(2, primera + s).value = medida; });
        });

        [1, 2].forEach(numeroFila => {
            const fila = ws.getRow(numeroFila);
            for (let c = 1; c <= 37; c++) {
                const celda = fila.getCell(c);
                celda.font = { name: 'Calibri', size: 10, bold: true };
                celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CABECERA } };
                celda.alignment = { vertical: 'middle', horizontal: 'center' };
                celda.border = _bordes(c > 1 && (c - 2) % 3 === 0);
            }
        });

        // Un renglón por día. La casilla vacía se deja vacía de verdad: un cero
        // diría que ese día no hubo operaciones, y lo que dice es que todavía
        // no se ha capturado el parte.
        for (let d = 0; d < DIAS_MAX; d++) {
            const fila = ws.getRow(3 + d);
            const celdaDiaFila = fila.getCell(1);
            celdaDiaFila.value = d + 1;
            celdaDiaFila.font = { name: 'Calibri', size: 10, bold: true };
            celdaDiaFila.alignment = { vertical: 'middle', horizontal: 'center' };
            celdaDiaFila.border = _bordes(false);

            for (let m = 0; m < 12; m++) {
                const datos = matriz.celdas[d][m];
                const valores = datos ? [datos.pax, datos.carga, datos.gral] : ['', '', ''];
                valores.forEach((valor, s) => {
                    const columna = 2 + m * 3 + s;
                    const celda = fila.getCell(columna);
                    celda.value = valor;
                    celda.font = { name: 'Calibri', size: 10 };
                    celda.alignment = { vertical: 'middle', horizontal: 'center' };
                    celda.border = _bordes(s === 0);
                    if (datos) {
                        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_DATO } };
                    }
                });
            }
        }

        // Pie con el acumulado del mes. No estorba a la cuadrícula y evita
        // tener que sumar a mano la columna para el reporte mensual.
        const totales = totalesPorMes(matriz);
        const filaTotal = ws.getRow(3 + DIAS_MAX);
        const celdaEtiqueta = filaTotal.getCell(1);
        celdaEtiqueta.value = 'TOTAL';
        celdaEtiqueta.font = { name: 'Calibri', size: 10, bold: true };
        celdaEtiqueta.alignment = { vertical: 'middle', horizontal: 'center' };
        celdaEtiqueta.border = _bordes(false);
        celdaEtiqueta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_TOTAL } };

        totales.forEach((total, m) => {
            const valores = total ? [total.pax, total.carga, total.gral] : ['', '', ''];
            valores.forEach((valor, s) => {
                const celda = filaTotal.getCell(2 + m * 3 + s);
                celda.value = valor;
                celda.font = { name: 'Calibri', size: 10, bold: true };
                celda.alignment = { vertical: 'middle', horizontal: 'center' };
                celda.border = _bordes(s === 0);
                celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_TOTAL } };
            });
        });

        return wb;
    }

    // ── Conexión con la pantalla ─────────────────────────────────────────────

    // Se pide el año COMPLETO, sin importar los filtros de la tabla: el archivo
    // es la cuadrícula del año, y traer sólo lo filtrado la dejaría llena de
    // huecos que parecerían partes sin capturar. `limit` alto a propósito: un
    // año son 366 renglones como mucho, pero el valor por defecto de PostgREST
    // (1000) recortaría sin avisar si alguna vez hubiera más de un parte al día.
    async function traerAnio(anio) {
        const client = window.supabaseClient
            || (window.ensureSupabaseClient ? await window.ensureSupabaseClient() : null);
        if (!client) throw new Error('No se pudo inicializar el cliente de Supabase.');
        const { data, error } = await client
            .from('parte_operations')
            .select('fecha, comercial_llegada, comercial_salida, carga_llegada, carga_salida, general_llegada, general_salida')
            .gte('fecha', `${anio}-01-01`)
            .lte('fecha', `${anio}-12-31`)
            .order('fecha', { ascending: true })
            .limit(2000);
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function exportarAnual(anio) {
        const anioTexto = String(anio || '').trim();
        if (!/^\d{4}$/.test(anioTexto)) throw new Error('Selecciona el año que quieres exportar.');
        if (typeof ExcelJS === 'undefined') throw new Error('No se pudo cargar la librería de Excel.');

        const filas = await traerAnio(anioTexto);
        const matriz = construirMatrizAnual(filas, anioTexto);
        // Un archivo con los 12 meses en blanco no es un archivo: es una
        // pregunta sin responder. Mejor decirlo antes de descargarlo.
        if (!matriz.registros) {
            throw new Error(`No hay partes de operaciones capturados en ${anioTexto}.`);
        }

        const wb = construirLibro(matriz);
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const nombre = `Parte_de_Operaciones_${anioTexto}.xlsx`;
        if (typeof saveAs === 'function') saveAs(blob, nombre);
        else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nombre;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return matriz;
    }

    window.parteOpsExport = {
        construirMatrizAnual,
        totalesPorMes,
        aniosDisponibles,
        partesDeFecha,
        construirLibro,
        exportarAnual,
    };
})();
