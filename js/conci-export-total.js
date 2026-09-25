/* Formato de Exportar Excel > Total, tomado de 2026GENERAL.xlsx (DATA).
 * Sólo proyecta las filas recibidas: no consulta, filtra, ordena ni escribe datos.
 */
(function (root) {
    'use strict';

    // Anchos almacenados por Excel, sin redondearlos a los dos decimales de su UI.
    const columns = [
        ['Cierre Subsecretaria', 25.140625, 'CIERRE SUBSECRETARIA', 'date'],
        ['FECHA', 15.7109375, 'FECHA', 'date'],
        ['TIPO DE MANIFIESTO', 20, 'TIPO DE MANIFIESTO'],
        ['TIPO DE OPERACIÓN', 27.5703125, 'TIPO DE OPERACIÓN'],
        ['AEROLINEA', 30.42578125, 'AEROLINEA'],
        ['AERONAVE', 16.7109375, 'AERONAVE'],
        ['MATRÍCULA', 17.42578125, 'MATRÍCULA'],
        ['# DE VUELO', 17.42578125, '# DE VUELO'],
        ['ORIGEN', 14, 'ORIGEN'],
        ['ESCALA', 17.42578125, 'ESCALA'],
        ['DESTINO', 14.85546875, 'DESTINO'],
        ['SLOT ASIGNADO', 22, 'SLOT ASIGNADO', 'datetime'],
        ['SLOT COORDINADO', 25.5703125, 'SLOT COORDINADO', 'datetime'],
        ['HR. DE INICIO O TERMINO DE PERNOCTA', 21.7109375, 'HR. DE INICIO O TERMINO DE PERNOCTA', 'datetime'],
        ['HR. DE EMBARQUE O DESEMBARQUE', 20.5703125, 'HR. DE EMBARQUE O DESEMBARQUE', 'datetime'],
        ['HR. DE OPERACIÓN', 24.7109375, 'HR. DE OPERACIÓN', 'datetime'],
        ['HR MÁXIMA DE ENTREGA', 20.42578125, null, 'datetime'],
        ['HR. DE RECEPCIÓN', 24.28515625, 'HR. DE RECEPCIÓN', 'datetime'],
        ['HR. CUMPLIDAS', 24.28515625],
        ['PUNTUALIDAD', 24.28515625],
        ['IMPORTACIÓN', 24.28515625, 'IMPORTACIÓN'],
        ['KGS CARGA LLEGADA NLU', 24, 'KGS CARGA LLEGADA NLU'],
        [' EXPORTACIÓN', 24.140625, 'EXPORTACIÓN'],
        ['KG. DE CARGA SALIDA NLU', 21.7109375, 'KG. DE CARGA SALIDA NLU'],
        ['TRANSITO', 17.5703125, 'KGS. DE CARGA EN TRANSITO'],
        ['CORREO', 17.5703125, 'CORREO'],
        ['DEMORA +-15 MIN', 19.85546875, 'DEMORA +- 15 MIN.'],
        ['MOTIVO', 59.5703125, 'OBSERVACIONES'],
        ['CODIGO', 17, 'CÓDIGO DEMORA'],
        ['CAPTURÓ', 14.5703125, 'CAPTURÓ'],
        ['Origen', 24.5703125],
        ['Destino', 36],
        ['escala', 11.42578125],
        ['Prueba Lógica', 20],
    ];

    // Los nombres son deliberadamente exactos: Origen/Destino/escala son
    // columnas auxiliares distintas de ORIGEN/DESTINO/ESCALA. TRANSITOS es PAX.
    const field = (row, key) => key ? (row[key] ?? null) : null;

    function excelDate(raw, rowDate, parseDateParts, year) {
        if (raw === '' || raw === null || raw === undefined) return null;
        if (raw instanceof Date) return new Date(raw.getTime());
        if (typeof raw === 'number') return raw; // Serial Excel ya existente.
        const text = String(raw).trim();
        const time = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
        const parts = parseDateParts(time ? rowDate : text, year);
        if (!parts) return raw; // Un valor no interpretable nunca se sustituye.
        const seconds = text.match(/:\d{2}:(\d{2})(?:\.(\d{1,3}))?/);
        const hour = time ? Number(time[1]) : (parts.hour ?? 0);
        const minute = time ? Number(time[2]) : (parts.minute ?? 0);
        const second = seconds ? Number(seconds[1]) : 0;
        const millis = seconds?.[2] ? Number(seconds[2].padEnd(3, '0')) : 0;
        // UTC conserva los componentes capturados al serializar con ExcelJS;
        // construir una fecha local desplazaría las horas según el navegador.
        const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second, millis));
        if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1
            || date.getUTCDate() !== parts.day || date.getUTCHours() !== hour
            || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return raw;
        return date;
    }

    function createWorkbook(ExcelJS, rows, { parseDateParts, year, resolveAirlineMeta = () => null }) {
        const wb = new ExcelJS.Workbook();
        wb.calcProperties.fullCalcOnLoad = true;
        const ws = wb.addWorksheet('DATA', {
            properties: { defaultRowHeight: 20.1 },
            views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2',
                showGridLines: false, zoomScale: 80, zoomScaleNormal: 80 }],
        });
        const center = { horizontal: 'center', vertical: 'middle' };
        const font = { name: 'Noto Sans', family: 2, size: 10, color: { theme: 1 } };
        const solid = color => ({ type: 'pattern', pattern: 'solid', fgColor: color, bgColor: { indexed: 64 } });
        const white = solid({ theme: 0 });
        const gray = solid({ theme: 0, tint: -0.1499984740745262 });
        const noFill = { type: 'pattern', pattern: 'none' };
        const thin = { style: 'thin', color: { indexed: 64 } };
        const hair = { style: 'hair', color: { indexed: 64 } };
        const grayColumns = new Set([1, 3, 7, 9, 11, 13, 15, 17, 21, 23, 25, 27, 29]);
        const boldColumns = new Set([1, 5, 19, 21, 22, 23, 24, 25, 30]);

        columns.forEach(([header, width], index) => {
            const col = index + 1;
            ws.getColumn(col).width = width;
            ws.getColumn(col).hidden = col >= 31 && col <= 33;
            const cell = ws.getCell(1, col);
            cell.value = header;
            cell.font = { ...font, bold: true, color: { theme: 0 } };
            cell.fill = solid({ argb: 'FF0A202D' });
            cell.alignment = { ...center, wrapText: true };
            cell.border = { left: thin, right: thin };
        });
        // AI carece de encabezado/datos en GENERAL pero pertenece al autofiltro.
        ws.getColumn(35).width = 11.42578125;
        ws.getRow(1).height = 48;

        rows.forEach((source, index) => {
            const n = index + 2;
            ws.getRow(n).height = 20.1;
            columns.forEach(([, , key, type], index) => {
                const col = index + 1;
                const cell = ws.getCell(n, col);
                const raw = field(source, key);
                cell.value = type ? excelDate(raw, source.FECHA, parseDateParts, year) : raw;
                cell.font = { ...font, ...(boldColumns.has(col) ? { bold: true } : {}) };
                cell.alignment = { ...center, ...(col === 28 ? { wrapText: true } : {}) };
                cell.fill = col >= 31 ? noFill : (grayColumns.has(col) ? gray : white);
                cell.numFmt = col === 1 ? 'mm-dd-yy' : col === 2 ? 'dd/mm/yyyy;@'
                    : type === 'datetime' ? 'm/d/yy h:mm' : col === 19 ? '0.00' : 'General';
                if (col === 5) {
                    const airline = resolveAirlineMeta(raw);
                    if (airline?.name) cell.value = String(airline.name).toUpperCase();
                    cell.font = { ...cell.font, color: { theme: 0 } };
                    cell.fill = solid({ argb: 'FF245C4F' });
                }
                // Bordes del bloque inicial DATA; no hay bordes horizontales.
                if (col === 21) cell.border = { right: hair };
                if ([22, 23, 24, 25, 29].includes(col)) cell.border = { left: hair, right: hair };
                if ([27, 28].includes(col)) cell.border = { left: hair };
            });
            ws.getCell(`Q${n}`).value = { formula: `IFERROR(P${n}+30/24,"-")` };
            // Excel interpreta una celda vacía como cero al restar fechas. Sólo
            // calcular cuando recepción y operación contienen fechas de Excel.
            ws.getCell(`S${n}`).value = { formula: `IF(AND(ISNUMBER(R${n}),R${n}>=1,ISNUMBER(P${n}),P${n}>=1),IFERROR((R${n}-P${n})*24,""),"")` };
            // La fila de control se eliminó por petición del usuario. Se mantiene
            // su tolerancia de 16 minutos sin referirse al nuevo encabezado A1.
            ws.getCell(`T${n}`).value = { formula: `IFERROR(IF((P${n}-L${n})>=(16/1440),"DEMORA",IF(L${n}=P${n},"EN TIEMPO",IF(P${n}>L${n},"DESPUÉS",IF((L${n}-P${n})>=(16/1440),"ANTICIPADO","ANTES")))),"-")` };
            ws.getCell(`AH${n}`).value = { formula: `_xlfn.IFS(C${n}="LLEGADA",O${n}>P${n},C${n}="SALIDA",O${n}<P${n})`, shareType: 'array', ref: `AH${n}` };
        });
        const last = rows.length + 1;
        ws.autoFilter = `A1:AI${last}`;
        if (rows.length) ws.addConditionalFormatting({
            ref: `S2:S${last}`,
            rules: [
                { type: 'cellIs', operator: 'lessThan', priority: 1, formulae: [30], style: {
                    font: { color: { argb: 'FF006100' } },
                    fill: { type: 'pattern', bgColor: { argb: 'FFC6EFCE' } },
                } },
                { type: 'cellIs', operator: 'greaterThan', priority: 2, formulae: [30], style: {
                    font: { color: { argb: 'FF9C0006' } },
                    fill: { type: 'pattern', bgColor: { argb: 'FFFFC7CE' } },
                } },
            ],
        });
        return wb;
    }

    const api = { createWorkbook };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ConciExportTotal = api;
})(typeof window === 'undefined' ? globalThis : window);
