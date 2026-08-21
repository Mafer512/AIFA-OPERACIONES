/* Resumen Estadístico — segundo documento oficial de la pestaña "Estadística".
 *
 * Es OTRO documento, no una variante del Informe Estadístico: hoja CARTA (el
 * Informe es oficio), lenguaje visual propio (cajas beige, resaltados amarillos,
 * barras verde/roja de máximos y mínimos) y 17 hojas que abarcan mucho más que
 * la operación aérea.
 *
 * De esas 17 hojas, el sistema hoy tiene fuente para seis:
 *   · aviación comercial / general / carga  -> monthly_operations + manifiestos
 *   · desglose mensual                      -> monthly_operations
 *   · participación por aerolínea           -> airline_monthly_statistics
 *   · factor de ocupación                   -> manifiestos conciliados
 *   · puntos de conexión                    -> dato estático transcrito
 *   · control de fauna                      -> rescued_wildlife
 * Las demás (Aduana No. 50, ingresos, recintos fiscalizados, locales y espacios
 * comerciales, encuesta de satisfacción, boletas de infracción, punto de
 * equilibrio, rutas comerciales) NO tienen tabla en la base. Se arma su
 * estructura y se marca con la banda "PENDIENTE DE CAPTURA", a petición del
 * área: una tabla en blanco sin marca se confunde con datos en cero.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ResumenEstadistico = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    // Hoja CARTA vertical (215.9 × 279.4 mm). El Informe Estadístico usa oficio;
    // son documentos distintos y cada uno conserva el tamaño de su original.
    const PAGINA = { formato: 'letter', margenX: 9, margenSup: 8, margenInf: 8 };

    // Ancho del "papel" en px: fija la densidad, no el tamaño impreso.
    const HOJA_W = 660;

    // Paleta muestreada del PDF de referencia ("Resumen Estadístico 12 08 2026").
    const C = {
        vino:     '#6E152E', // títulos de sección y números grandes
        vinoLinea:'#81344A', // filetes a los lados del título de sección
        beige:    '#E7DCC7', // cajas de acumulado y banda OPERACIONES
        beigeFte: '#C7AC7B', // banda con el nombre de la aviación
        resalte:  '#D0BB90', // fecha resaltada dentro del texto
        azul:     '#DEEBF7', // banda PASAJEROS / TONELADAS
        gris:     '#D9D9D9', // encabezado de años y celda "CIFRA AL"
        rojo:     '#FB2925', // "operaciones aéreas." / "pasajeros transportados."
        verde:    '#00B050', // barra de máximo histórico
        rojoBarra:'#C00000', // barra de mínimo histórico
        amarillo: '#FFFF00', // resaltado de las aperturas Comercial/General
        tinta:    '#0D1F2D', // texto oscuro
        naranja:  '#C55A11', // borde de "Cifras registradas al:"
        verdeBorde:'#548235' // borde de "Promedio del mes de:"
    };

    const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const MESES_CORTO = ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.',
        'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.'];

    const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
    const tons = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmt = (v) => numero.format(Number.isFinite(Number(v)) ? Number(v) : 0);
    const fmtTons = (v) => tons.format(Number.isFinite(Number(v)) ? Number(v) : 0);
    const pct = (v) => Number.isFinite(v) ? `${v.toFixed(2)}%` : '—';
    const escapeHtml = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[c]);

    // "11 Ago. 2026" — el formato corto que usa este documento en los títulos.
    const fechaCorta = (d) => `${String(d.dia).padStart(2, '0')} ${MESES_CORTO[d.mes - 1]} ${d.anio}`;
    // "12 Agosto 2026" — el de los encabezados de hoja.
    const fechaLarga = (d) => `${String(d.dia).padStart(2, '0')} ${MESES[d.mes - 1]} ${d.anio}`;
    // "11/08/2026" — el de la columna "CIFRA AL".
    const fechaNum = (d) => `${String(d.dia).padStart(2, '0')}/${String(d.mes).padStart(2, '0')}/${d.anio}`;

    const hoyPartes = () => {
        const n = new Date();
        return { anio: n.getFullYear(), mes: n.getMonth() + 1, dia: n.getDate() };
    };

    // ── Piezas comunes ──────────────────────────────────────────────────────
    const celda = (extra) => `font-size:6.4px;line-height:1.3;padding:1.5px 3px;border:1px solid #000;${extra || ''}`;
    const th = (t, x) => `<th style="${celda(x)}">${t}</th>`;
    const td = (t, x) => `<td style="${celda(x)}">${t}</td>`;

    function encabezadoHoja(elaboracion, fechaDatos) {
        return `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
                <div style="flex:0 0 22%;font-size:5.5px;color:#555;line-height:1.3;">
                    <div style="font-weight:700;letter-spacing:.3px;">SECRETARÍA DE LA<br>DEFENSA NACIONAL</div>
                    <div style="margin-top:3px;font-weight:700;color:${C.vino};">AEROPUERTO INTERNACIONAL<br>FELIPE ÁNGELES</div>
                </div>
                <h1 style="flex:1;font-size:14px;margin:0;text-align:center;color:${C.tinta};font-weight:700;letter-spacing:.3px;">RESUMEN ESTADÍSTICO</h1>
                <div style="flex:0 0 22%;text-align:right;font-size:6.8px;font-weight:700;color:${C.tinta};line-height:1.6;">
                    <div>Elaboración: ${escapeHtml(elaboracion)}</div>
                    ${fechaDatos ? `<div>Fecha de los datos: <u>${escapeHtml(fechaDatos)}</u></div>` : ''}
                </div>
            </div>`;
    }

    // Título de sección: filete vino — TEXTO — filete vino.
    function tituloSeccion(texto) {
        const linea = `flex:1;height:1.5px;background:${C.vinoLinea};`;
        return `
            <div style="display:flex;align-items:center;gap:10px;margin:7px 0 5px;">
                <div style="${linea}"></div>
                <div style="font-size:10px;font-weight:700;color:${C.vino};letter-spacing:.3px;white-space:nowrap;">${escapeHtml(texto)}</div>
                <div style="${linea}"></div>
            </div>`;
    }

    // Marca de las secciones que todavía no tienen de dónde salir. Va visible a
    // propósito: el área prefirió estructura vacía a que falte la hoja, pero una
    // tabla en blanco sin aviso se lee como "cero operaciones".
    function bandaPendiente(fuente) {
        return `
            <div style="border:1.5px dashed ${C.rojoBarra};background:#FDF2F2;color:${C.rojoBarra};
                        font-size:6.5px;font-weight:700;text-align:center;padding:4px 6px;margin:4px 0 6px;line-height:1.5;">
                PENDIENTE DE CAPTURA — esta sección no tiene todavía origen de datos en el sistema.
                ${fuente ? `<div style="font-weight:400;margin-top:2px;">Requiere: ${escapeHtml(fuente)}</div>` : ''}
            </div>`;
    }

    // Celda de valor faltante: "—", nunca 0, para que no se confunda con un dato.
    const SD = `<span style="color:#999;">—</span>`;

    // ── Hoja 1 — Aviación comercial, general y carga ────────────────────────

    // Tabla "TOTAL POR AÑO / ACUMULADO" con una columna por año cerrado más la
    // columna "CIFRA AL <fecha>" del año en curso. El acumulado es CORRIDO
    // (cada año suma los anteriores), no el gran total repetido.
    function tablaAnual(datos, tipo, unidad, titulo, corte) {
        const anios = datos.anios.slice().sort((a, b) => a - b);
        if (!anios.length) return '';
        const anioCurso = corte.anio;
        const cerrados = anios.filter((a) => a < anioCurso);
        const columnas = cerrados.concat([anioCurso]);
        const esKg = unidad === 'kg';
        const etiqueta2 = esKg ? 'TONELADAS' : 'PASAJEROS';
        const total = (anio) => {
            const c = datos.aggregated?.porAnio?.get(anio)?.[tipo];
            return { ops: c?.ops || 0, pax: c?.pax || 0, kg: c?.kg || 0 };
        };
        const val2 = (t) => esKg ? fmtTons((t.kg || 0) / 1000) : fmt(t.pax);

        let acOps = 0, acSec = 0;
        const corrido = columnas.map((anio) => {
            const t = total(anio);
            acOps += t.ops;
            acSec += esKg ? (t.kg || 0) : t.pax;
            return { anio, ops: acOps, sec: esKg ? fmtTons(acSec / 1000) : fmt(acSec) };
        });

        const n = columnas.length;
        const hdrAnios = (fondo) => columnas.map((anio, i) =>
            th(i === n - 1 ? `CIFRA AL<br>${fechaNum(corte)}` : anio,
                `background:${C.gris};text-align:center;font-weight:700;`)).join('');
        const filaTotal = (render) => columnas.map((anio) =>
            td(render(total(anio)), 'text-align:center;font-weight:700;')).join('');
        const filaAcum = (campo) => corrido.map((c, i) =>
            td(campo === 'ops' ? fmt(c.ops) : c.sec,
                `text-align:center;font-weight:700;${i === n - 1 ? `background:${C.gris};` : ''}`)).join('');

        const etiqueta = `ACUMULADO DEL 21 DE MARZO DE 2022 AL<br>${fechaLarga(corte).toUpperCase()}`;
        return `
            <table style="border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:7px;">
                <colgroup><col style="width:22%">${columnas.map(() => `<col style="width:${(78 / (n * 2)).toFixed(2)}%">`).join('')}${columnas.map(() => `<col style="width:${(78 / (n * 2)).toFixed(2)}%">`).join('')}</colgroup>
                <tr>
                    ${th('', `background:${C.beigeFte};border-color:${C.beigeFte};`)}
                    <th style="${celda(`background:${C.beigeFte};text-align:center;font-weight:700;color:#000;`)}" colspan="${n * 2}">${escapeHtml(titulo)}</th>
                </tr>
                <tr>
                    ${th('', `background:${C.beigeFte};border-color:${C.beigeFte};`)}
                    <th style="${celda(`background:${C.beige};text-align:center;font-weight:700;`)}" colspan="${n}">OPERACIONES</th>
                    <th style="${celda(`background:${C.azul};text-align:center;font-weight:700;`)}" colspan="${n}">${etiqueta2}</th>
                </tr>
                <tr>
                    ${th('', `background:${C.beigeFte};border-color:${C.beigeFte};`)}
                    ${hdrAnios()}
                    ${hdrAnios()}
                </tr>
                <tr>
                    ${td('TOTAL POR AÑO', `background:${C.beige};text-align:center;font-weight:700;`)}
                    ${filaTotal((t) => fmt(t.ops))}
                    ${filaTotal(val2)}
                </tr>
                <tr>
                    ${td(etiqueta, `background:${C.beige};text-align:center;font-weight:700;font-size:5.6px;`)}
                    ${filaAcum('ops')}
                    ${filaAcum('sec')}
                </tr>
            </table>`;
    }

    function cajaAcumulado(valor, etiqueta, aperturas) {
        return `
            <div style="flex:1;">
                <div style="background:${C.beige};text-align:center;padding:6px 4px;">
                    <div style="font-size:17px;font-weight:700;color:${C.vino};line-height:1.15;">${escapeHtml(valor)}</div>
                    <div style="font-size:8.5px;font-weight:700;color:${C.rojo};line-height:1.4;">${escapeHtml(etiqueta)}</div>
                </div>
                <div style="margin-top:3px;font-size:7px;line-height:1.9;color:${C.tinta};">
                    ${aperturas.map((a) => `<div><strong style="background:${C.amarillo};padding:0 2px;">${escapeHtml(a.valor)}</strong> ${escapeHtml(a.texto)}</div>`).join('')}
                </div>
            </div>`;
    }

    function miniTabla(titulo, subtitulo, col1, col2, val1, val2, colorBorde, encabezadoOscuro) {
        const borde = `border:1.5px solid ${colorBorde};`;
        const hdr = encabezadoOscuro
            ? `background:${C.vino};color:#fff;`
            : `background:${C.beige};color:${C.tinta};`;
        return `
            <table style="border-collapse:collapse;${borde}font-size:6.8px;">
                <tr>
                    <td style="${celda(`${hdr}font-weight:700;text-align:center;border-color:${colorBorde};`)}">${escapeHtml(titulo)}</td>
                    <td style="${celda(`${hdr}font-weight:700;text-align:center;border-color:${colorBorde};min-width:26px;`)}">${escapeHtml(col1)}</td>
                    <td style="${celda(`${hdr}font-weight:700;text-align:center;border-color:${colorBorde};min-width:34px;`)}">${escapeHtml(col2)}</td>
                </tr>
                <tr>
                    <td style="${celda(`font-weight:700;text-align:center;color:${C.vino};border-color:${colorBorde};`)}">${escapeHtml(subtitulo)}</td>
                    <td style="${celda(`font-weight:700;text-align:center;border-color:${colorBorde};`)}">${val1}</td>
                    <td style="${celda(`font-weight:700;text-align:center;border-color:${colorBorde};`)}">${val2}</td>
                </tr>
            </table>`;
    }

    function barraExtremo(tipo, etiqueta, valor, fecha) {
        const fondo = tipo === 'max' ? C.verde : C.rojoBarra;
        return `<div style="background:${fondo};color:#fff;font-size:7.5px;padding:2.5px 8px;margin-bottom:3px;">
            ${escapeHtml(etiqueta)}: <strong style="font-size:9px;">${valor}</strong> ${fecha ? escapeHtml(fecha) : ''}
        </div>`;
    }

    function hojaAviacion(datos) {
        const corte = datos.corte;
        const a = datos.acumulado;
        const prom = datos.promedioMes || {};
        const d = datos.diaCorte || {};
        const opsDia = (d.comercial?.ops || 0) + (d.general?.ops || 0);
        const paxDia = (d.comercial?.pax || 0) + (d.general?.pax || 0);
        const mesNombre = MESES[corte.mes - 1];

        // Los máximos y mínimos históricos por día necesitan una serie diaria de
        // pasajeros que el sistema no guarda (daily_operations sólo lleva
        // operaciones). Se dejan marcados en vez de inventarlos.
        const extremos = `
            <div style="display:flex;gap:12px;margin:6px 0 8px;">
                <div style="flex:1;">
                    ${barraExtremo('max', 'Máximo histórico', SD, '')}
                    ${barraExtremo('min', 'Mínimo histórico', SD, '')}
                </div>
                <div style="flex:1;">
                    ${barraExtremo('max', 'Máximo histórico', SD, '')}
                    ${barraExtremo('min', 'Mínimo histórico', SD, '')}
                </div>
            </div>`;

        const comercial = tablaAnual(datos, 'comercial', 'pax', 'AVIACIÓN COMERCIAL', corte);
        const general = tablaAnual(datos, 'general', 'pax', 'AVIACIÓN GENERAL', corte);
        const carga = tablaAnual(datos, 'carga', 'kg', 'AVIACIÓN CARGA', corte);

        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(corte))}
                ${tituloSeccion('AVIACIÓN COMERCIAL Y GENERAL')}
                <p style="font-size:8.5px;font-weight:700;margin:4px 0 5px;color:${C.tinta};">
                    Del 21 Mar. 2022 al <span style="background:${C.resalte};padding:0 4px;">${escapeHtml(fechaCorta(corte))}</span> se acumulan:
                </p>
                <div style="display:flex;gap:12px;align-items:flex-start;">
                    ${cajaAcumulado(fmt(a.totalOperaciones), 'operaciones aéreas.', [
                        { valor: fmt(a.comercial.ops), texto: 'de Aviación Comercial.' },
                        { valor: fmt(a.general.ops), texto: 'de Aviación General.' }
                    ])}
                    <div style="flex:0 0 26%;display:flex;flex-direction:column;gap:5px;align-items:center;">
                        ${miniTabla('Cifras registradas al:', `${corte.dia} ${MESES_CORTO[corte.mes - 1].toLowerCase()} ${corte.anio}`, 'OPS.', 'PAX.', fmt(opsDia), fmt(paxDia), C.naranja, false)}
                        ${miniTabla('Promedio del mes de:', mesNombre, 'OPS.', 'PAX.', prom.ops != null ? fmt(prom.ops) : SD, prom.pax != null ? fmt(prom.pax) : SD, C.verdeBorde, true)}
                    </div>
                    ${cajaAcumulado(fmt(a.totalPasajeros), 'pasajeros transportados.', [
                        { valor: fmt(a.comercial.pax), texto: 'de Aviación Comercial.' },
                        { valor: fmt(a.general.pax), texto: 'de Aviación General.' }
                    ])}
                </div>
                ${extremos}
                ${comercial}
                ${general}
                ${tituloSeccion('AVIACIÓN CARGA')}
                <p style="font-size:8.5px;font-weight:700;margin:4px 0 5px;color:${C.tinta};">
                    Del 21 Mar. 2022 al <span style="background:${C.resalte};padding:0 4px;">${escapeHtml(fechaCorta(corte))}</span> se acumulan:
                </p>
                <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:6px;">
                    <div style="flex:1;">
                        <div style="background:${C.beige};text-align:center;padding:6px 4px;">
                            <div style="font-size:17px;font-weight:700;color:${C.vino};line-height:1.15;">${fmt(a.carga.ops)}</div>
                            <div style="font-size:8.5px;font-weight:700;color:${C.rojo};line-height:1.4;">operaciones de carga.</div>
                        </div>
                        <table style="border-collapse:collapse;width:100%;margin-top:4px;">
                            <tr>${th('AEROLÍNEAS DE CARGA', `background:${C.vino};color:#fff;text-align:center;`, '')}</tr>
                        </table>
                        <table style="border-collapse:collapse;width:100%;">
                            <tr>
                                ${th('REGULAR', `background:${C.beige};text-align:center;`)}
                                ${th('FLETAMENTO', `background:${C.beige};text-align:center;`)}
                                ${th('TOTAL', `background:${C.beige};text-align:center;`)}
                            </tr>
                            <tr>${td(SD, 'text-align:center;font-weight:700;')}${td(SD, 'text-align:center;font-weight:700;')}${td(SD, 'text-align:center;font-weight:700;')}</tr>
                        </table>
                    </div>
                    <div style="flex:0 0 26%;display:flex;flex-direction:column;gap:5px;align-items:center;">
                        ${miniTabla('Cifras registradas al:', `${corte.dia} ${MESES_CORTO[corte.mes - 1].toLowerCase()} ${corte.anio}`, 'OPS.', 'TONS.', fmt(d.carga?.ops || 0), fmtTons((d.carga?.kg || 0) / 1000), C.naranja, false)}
                        ${miniTabla('Promedio del mes de:', mesNombre, 'OPS.', 'TONS.', prom.cargaOps != null ? fmt(prom.cargaOps) : SD, prom.cargaTons != null ? fmtTons(prom.cargaTons) : SD, C.verdeBorde, true)}
                    </div>
                    <div style="flex:1;">
                        <div style="background:${C.beige};text-align:center;padding:6px 4px;">
                            <div style="font-size:15px;font-weight:700;color:${C.vino};line-height:1.15;">${fmtTons((a.carga.kg || 0) / 1000)}</div>
                            <div style="font-size:8.5px;font-weight:700;color:${C.rojo};line-height:1.4;">Toneladas transportadas.</div>
                        </div>
                        <div style="margin-top:3px;font-size:7px;line-height:1.9;color:${C.tinta};">
                            <div><strong style="background:${C.amarillo};padding:0 2px;">${datos.cargaNacional != null ? fmtTons(datos.cargaNacional / 1000) : '—'}</strong> Tons. nacionales</div>
                            <div><strong style="background:${C.amarillo};padding:0 2px;">${datos.cargaInternacional != null ? fmtTons(datos.cargaInternacional / 1000) : '—'}</strong> Tons. internacionales</div>
                        </div>
                    </div>
                </div>
                ${carga}
                ${tituloSeccion('ADUANA No. 50')}
                ${bandaPendiente('recaudación mensual de la Aduana No. 50 (virtual, carga y pasajeros), pedimentos y operaciones aduanales.')}
                <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
                    <tr>
                        ${th('AÑO', `background:${C.beigeFte};text-align:center;width:22%;`)}
                        ${[2022, 2023, 2024, 2025, 2026].map((y) => th(y, `background:${C.beigeFte};text-align:center;`)).join('')}
                    </tr>
                    <tr>${td('TOTAL POR AÑO', `background:${C.beige};text-align:center;font-weight:700;`)}${[0, 0, 0, 0, 0].map(() => td(SD, 'text-align:center;')).join('')}</tr>
                    <tr>${td('ACUMULADO', `background:${C.gris};text-align:center;font-weight:700;`)}${[0, 0, 0, 0, 0].map(() => td(SD, 'text-align:center;')).join('')}</tr>
                </table>
            </div>`;
    }

    // ── Hoja 2 — desglose mensual por año ───────────────────────────────────
    // El original abre cada año en Nacional / Internacional / Total. La cifra
    // mensual oficial (monthly_operations) sólo guarda el total, así que las dos
    // primeras columnas van marcadas y sólo Total lleva dato.
    function tablaMensualDetalle(datos, tipo, unidad, titulo) {
        const anios = datos.anios.slice().sort((a, b) => a - b);
        const esKg = unidad === 'kg';
        const valor = (anio, mes, campo) => {
            const c = datos.aggregated?.porAnioMes?.get(`${anio}-${mes}`)?.[tipo];
            if (!c) return 0;
            if (campo === 'ops') return c.ops || 0;
            return esKg ? (c.kg || 0) / 1000 : (c.pax || 0);
        };
        const pinta = (v, campo) => campo === 'ops' ? fmt(v) : (esKg ? fmtTons(v) : fmt(v));

        // 31 columnas en una hoja carta: letra propia y anchos explícitos. Nac.
        // e Int. van angostas a propósito — hoy no llevan dato — para que la
        // columna Total tenga el espacio que necesitan cifras de siete dígitos.
        const mini = (extra) => `font-size:4.6px;line-height:1.25;padding:0.5px 1px;border:1px solid #000;${extra || ''}`;
        const thm = (t, x) => `<th style="${mini(x)}">${t}</th>`;
        const tdm = (t, x) => `<td style="${mini(x)}">${t}</td>`;
        const anchoGrupo = (100 - 8) / (anios.length * 2);
        const cols = anios.map(() =>
            `<col style="width:${(anchoGrupo * 0.21).toFixed(3)}%"><col style="width:${(anchoGrupo * 0.21).toFixed(3)}%"><col style="width:${(anchoGrupo * 0.58).toFixed(3)}%">`).join('');

        const grupoAnios = () => anios.map((anio) =>
            `<th style="${mini(`background:${C.gris};text-align:center;font-weight:700;`)}" colspan="3">${anio}</th>`).join('');
        const subCols = () => anios.map(() =>
            `${thm('Nac.', `background:${C.beige};text-align:center;`)}${thm('Int.', `background:${C.beige};text-align:center;`)}${thm('Total', `background:${C.beige};text-align:center;font-weight:700;`)}`).join('');

        const filas = MESES.map((mes, i) => {
            const grupo = (campo) => anios.map((anio) =>
                `${tdm(SD, 'text-align:center;')}${tdm(SD, 'text-align:center;')}${tdm(pinta(valor(anio, i + 1, campo), campo), 'text-align:center;font-weight:700;')}`).join('');
            return `<tr>${tdm(mes.toUpperCase(), `background:${C.beige};font-weight:700;`)}${grupo('ops')}${grupo('sec')}</tr>`;
        }).join('');

        const totales = (campo) => anios.map((anio) => {
            const t = datos.aggregated?.porAnio?.get(anio)?.[tipo];
            const v = campo === 'ops' ? (t?.ops || 0) : (esKg ? (t?.kg || 0) / 1000 : (t?.pax || 0));
            return `${tdm(SD, 'text-align:center;')}${tdm(SD, 'text-align:center;')}${tdm(pinta(v, campo), `text-align:center;font-weight:700;background:${C.gris};`)}`;
        }).join('');

        return `
            <div style="font-size:6.5px;font-weight:700;color:${C.vino};margin:4px 0 1px;">${escapeHtml(titulo)}</div>
            <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
                <colgroup><col style="width:8%">${cols}${cols}</colgroup>
                <tr>
                    ${thm('AÑO', `background:${C.beigeFte};text-align:center;`)}
                    <th style="${mini(`background:${C.beige};text-align:center;font-weight:700;font-size:5.5px;`)}" colspan="${anios.length * 3}">OPERACIONES</th>
                    <th style="${mini(`background:${C.azul};text-align:center;font-weight:700;font-size:5.5px;`)}" colspan="${anios.length * 3}">${esKg ? 'TONS. TRANSPORTADAS' : 'PASAJEROS'}</th>
                </tr>
                <tr>${thm('TIPO DE OPERACIÓN', `background:${C.beigeFte};text-align:center;`)}${grupoAnios()}${grupoAnios()}</tr>
                <tr>${thm('', `background:${C.beigeFte};`)}${subCols()}${subCols()}</tr>
                ${filas}
                <tr>${tdm('TOTAL POR AÑO', `background:${C.gris};text-align:center;font-weight:700;`)}${totales('ops')}${totales('sec')}</tr>
            </table>`;
    }

    function hojaMensual(datos) {
        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(datos.corte))}
                ${tituloSeccion('DESGLOSE MENSUAL POR AÑO')}
                <div style="font-size:6px;color:#555;margin-bottom:3px;">
                    Las columnas <strong>Nac.</strong> e <strong>Int.</strong> van marcadas porque la cifra mensual oficial
                    (monthly_operations) sólo guarda el total del mes; ese desglose no se captura ahí.
                </div>
                ${tablaMensualDetalle(datos, 'comercial', 'pax', 'AVIACIÓN COMERCIAL')}
                ${tablaMensualDetalle(datos, 'general', 'pax', 'AVIACIÓN GENERAL')}
                ${tablaMensualDetalle(datos, 'carga', 'kg', 'AVIACIÓN CARGA')}
                <div style="font-size:5.6px;color:#333;margin-top:5px;">
                    <strong>Nota:</strong> Todas las cifras presentadas son preliminares, susceptibles a cambios hasta cierre de mes.
                </div>
            </div>`;
    }

    // ── Hoja 3 — participación por aerolínea ────────────────────────────────
    function tablaAerolineas(anio, filas) {
        if (!filas || !filas.length) {
            return `
                <div>
                    <div style="background:${C.beigeFte};text-align:center;font-size:7px;font-weight:700;padding:2px;border:1px solid #000;">${anio}</div>
                    <div style="font-size:6px;color:#777;padding:6px;text-align:center;border:1px solid #000;border-top:0;">Sin datos capturados para este año.</div>
                </div>`;
        }
        const totalOps = filas.reduce((s, f) => s + f.ops, 0);
        const totalPax = filas.reduce((s, f) => s + f.pax, 0);
        const cuerpo = filas.map((f, i) => `<tr style="background:${i % 2 === 0 ? '#FFFFFF' : '#F5F1E8'};">
            ${td(escapeHtml(f.aerolinea), 'font-weight:700;font-size:5.8px;')}
            ${td(pct(totalOps ? (f.ops / totalOps) * 100 : null), 'text-align:center;font-weight:700;')}
            ${td(fmt(f.ops), 'text-align:center;')}
            ${td(pct(totalPax ? (f.pax / totalPax) * 100 : null), 'text-align:center;font-weight:700;')}
            ${td(fmt(f.pax), 'text-align:center;')}
        </tr>`).join('');
        return `
            <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
                <colgroup><col style="width:34%"><col style="width:16%"><col style="width:17%"><col style="width:16%"><col style="width:17%"></colgroup>
                <tr><th style="${celda(`background:${C.beigeFte};text-align:center;font-weight:700;font-size:7.5px;`)}" colspan="5">${anio}</th></tr>
                <tr>
                    ${th('AEROLÍNEA', `background:${C.gris};text-align:center;`)}
                    <th style="${celda(`background:${C.beige};text-align:center;font-weight:700;`)}" colspan="2">OPS</th>
                    <th style="${celda(`background:${C.azul};text-align:center;font-weight:700;`)}" colspan="2">PAX</th>
                </tr>
                ${cuerpo}
                <tr>
                    ${td('TOTAL', `background:${C.gris};text-align:center;font-weight:700;`)}
                    ${td('100.00%', `background:${C.gris};text-align:center;font-weight:700;`)}
                    ${td(fmt(totalOps), `background:${C.gris};text-align:center;font-weight:700;`)}
                    ${td('100.00%', `background:${C.gris};text-align:center;font-weight:700;`)}
                    ${td(fmt(totalPax), `background:${C.gris};text-align:center;font-weight:700;`)}
                </tr>
            </table>`;
    }

    function hojaAerolineas(datos) {
        const porAnio = datos.aerolineasPorAnio || new Map();
        const anios = [...porAnio.keys()].sort((a, b) => a - b);
        const pares = [];
        for (let i = 0; i < anios.length; i += 2) pares.push(anios.slice(i, i + 2));
        const bloques = pares.map((par) => `
            <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:8px;">
                <div style="flex:1;">${tablaAerolineas(par[0], porAnio.get(par[0]))}</div>
                <div style="flex:1;">${par[1] ? tablaAerolineas(par[1], porAnio.get(par[1])) : ''}</div>
            </div>`).join('');
        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(datos.corte))}
                ${tituloSeccion('PORCENTAJE DE PARTICIPACIÓN POR AEROLÍNEA.')}
                ${anios.length ? bloques : bandaPendiente('airline_monthly_statistics (histórico oficial por aerolínea).')}
            </div>`;
    }

    // ── Hoja de factor de ocupación ─────────────────────────────────────────
    const OCUPACION_COLORES = {
        AEROMEXICO: '#EAF3FA', 'AEROMEXICO CONNECT': '#EAF3FA', VOLARIS: '#EDE2F6',
        'VIVA AEROBUS': '#E2EFDA', VIVAAEROBUS: '#E2EFDA', 'AEROLINEA EM': '#A9D08E',
        CONVIASA: '#FCE4D6', ARAJET: '#CC99FF', AERUS: '#D0CECE', 'MEXICANA DE AVIACION': '#D0CECE'
    };
    const normaliza = (n) => String(n || '').toUpperCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

    function hojaOcupacion(datos) {
        const ocup = datos.ocupacion || { rows: [], promedioGeneral: null };
        // Renglón compacto: son ~70 pares aerolínea/destino y en el original
        // caben todos en una hoja. Con el alto normal se desbordaban a una
        // segunda página.
        const fila = (extra) => `font-size:5.4px;line-height:1.25;padding:0.4px 3px;border:1px solid #000;${extra || ''}`;
        const thf = (t, x) => `<th style="${fila(x)}">${t}</th>`;
        const tdf = (t, x) => `<td style="${fila(x)}">${t}</td>`;
        const grupos = [];
        ocup.rows.forEach((item) => {
            const last = grupos[grupos.length - 1];
            if (last && last.aerolinea === item.aerolinea) last.destinos.push(item);
            else grupos.push({ aerolinea: item.aerolinea, destinos: [item] });
        });
        const cuerpo = grupos.map((g) => {
            const bg = OCUPACION_COLORES[normaliza(g.aerolinea)] || '#FFFFFF';
            return g.destinos.map((item, i) => `<tr>
                ${i === 0 ? `<td style="${fila(`background:${bg};font-weight:700;text-align:center;vertical-align:middle;`)}" rowspan="${g.destinos.length}">${escapeHtml(g.aerolinea).toUpperCase()}</td>` : ''}
                ${tdf(escapeHtml(item.destino).toUpperCase(), 'background:#F2F2F2;')}
                ${tdf(pct(item.factorSalida), 'text-align:center;')}
                ${tdf(pct(item.factorLlegada), 'text-align:center;')}
                ${tdf(pct(item.factorTotal), 'text-align:center;font-weight:700;')}
            </tr>`).join('');
        }).join('');
        const hd = `background:${C.tinta};color:#fff;text-align:center;font-weight:700;`;
        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(datos.corte))}
                ${tituloSeccion('FACTOR DE OCUPACIÓN PROMEDIO')}
                <p style="font-size:7px;margin:2px 0 6px;text-align:center;color:${C.tinta};">
                    Promedios calculados para las operaciones registradas
                    <span style="background:${C.resalte};padding:0 3px;">del ${escapeHtml(datos.ocupacionDesdeTexto || '')} al ${escapeHtml(datos.ocupacionHastaTexto || '')}</span>
                    <strong>(15 días más recientes)</strong>
                </p>
                ${ocup.rows.length ? `
                <table style="border-collapse:collapse;width:64%;margin:0 auto;table-layout:fixed;">
                    <colgroup><col style="width:26%"><col style="width:26%"><col style="width:16%"><col style="width:16%"><col style="width:16%"></colgroup>
                    <tr>${thf('AEROLÍNEA', hd)}${thf('DESTINO', hd)}${thf('DE SALIDA', hd)}${thf('DE LLEGADA', hd)}${thf('TOTAL', hd)}</tr>
                    ${cuerpo}
                </table>
                <div style="width:64%;margin:3px auto 0;text-align:right;font-size:7px;">Promedio General: <strong>${pct(ocup.promedioGeneral)}</strong></div>
                ` : '<p style="font-size:6.5px;color:#777;text-align:center;">Sin datos de ocupación en el periodo.</p>'}
                <div style="font-size:5.4px;color:#333;margin-top:6px;line-height:1.5;">
                    <strong>Nota:</strong> Todas las cifras que se presentan se realizan con los últimos 15 días anteriores al corte, son de carácter preliminar y susceptibles a ajustes, derivado de la conciliación de datos entre los registros de la Dirección de Operación y los Manifiestos de las Aerolíneas, realizada en tiempo vencido, ya que, de conformidad con su contrato, las líneas aéreas cuentan con un periodo de 30 horas para hacer entrega de su Manifiesto. Por lo anterior, los datos presentados no son definitivos y pueden variar en el futuro.
                    <br>*Los destinos pueden añadirse, mantenerse o eliminarse, derivado que se basan en las operaciones registradas en esta entidad, ya que se encuentran sujetas a disponibilidad de la aerolínea.
                </div>
            </div>`;
    }

    // ── Hoja de control de fauna ────────────────────────────────────────────
    function hojaFauna(datos) {
        const fauna = datos.fauna;
        const anio = datos.corte.anio;
        const filas = MESES.map((mes, i) => {
            const m = fauna?.porMes?.[i] || null;
            return `<tr>
                ${td(mes.toUpperCase(), `background:${C.beige};font-weight:700;`)}
                ${td(m ? fmt(m.mamifero) : SD, 'text-align:center;')}
                ${td(m ? fmt(m.reptil) : SD, 'text-align:center;')}
                ${td(m ? fmt(m.ave) : SD, 'text-align:center;')}
            </tr>`;
        }).join('');
        const t = fauna?.totales || null;
        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(datos.corte))}
                ${tituloSeccion('CONTROL DE FAUNA')}
                <table style="border-collapse:collapse;width:52%;margin:0 auto;table-layout:fixed;">
                    <tr><th style="${celda(`background:${C.vino};color:#fff;text-align:center;font-weight:700;`)}" colspan="4">CAPTURAS CONTROL DE FAUNA</th></tr>
                    <tr>
                        ${th('MES', `background:${C.gris};text-align:center;`)}
                        <th style="${celda(`background:${C.gris};text-align:center;font-weight:700;`)}" colspan="3">${anio}</th>
                    </tr>
                    <tr>
                        ${th('', `background:${C.beige};`)}
                        ${th('MAMÍFERO', `background:${C.beige};text-align:center;`)}
                        ${th('REPTIL', `background:${C.beige};text-align:center;`)}
                        ${th('AVE', `background:${C.beige};text-align:center;`)}
                    </tr>
                    ${filas}
                    <tr>
                        ${td('TOTAL CAPTURAS', `background:${C.vino};color:#fff;font-weight:700;`)}
                        ${td(t ? fmt(t.mamifero) : SD, `background:${C.gris};text-align:center;font-weight:700;`)}
                        ${td(t ? fmt(t.reptil) : SD, `background:${C.gris};text-align:center;font-weight:700;`)}
                        ${td(t ? fmt(t.ave) : SD, `background:${C.gris};text-align:center;font-weight:700;`)}
                    </tr>
                    <tr>
                        ${td('TOTAL POR AÑO', `background:${C.vino};color:#fff;font-weight:700;`)}
                        <td style="${celda(`background:${C.gris};text-align:center;font-weight:700;`)}" colspan="3">${t ? fmt(t.mamifero + t.reptil + t.ave) : SD}</td>
                    </tr>
                    <tr>
                        ${td('ACUMULADO', `background:${C.vino};color:#fff;font-weight:700;`)}
                        <td style="${celda(`background:${C.gris};text-align:center;font-weight:700;`)}" colspan="3">${fauna?.acumulado != null ? fmt(fauna.acumulado) : SD}</td>
                    </tr>
                </table>
                ${tituloSeccion('INFORME DE INGRESOS')}
                ${bandaPendiente('ingresos facturados, cobrado y por cobrar por concepto (TUA, aeroportuarios, comerciales, complementarios).')}
                <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
                    <tr>
                        ${th('Servicios', `background:${C.vino};color:#fff;text-align:center;width:28%;`)}
                        ${th('%', `background:${C.vino};color:#fff;text-align:center;width:10%;`)}
                        ${th('Ingresos Facturados', `background:${C.vino};color:#fff;text-align:center;`)}
                        ${th('Cobrado', `background:${C.vino};color:#fff;text-align:center;`)}
                        ${th('Por Cobrar', `background:${C.vino};color:#fff;text-align:center;`)}
                    </tr>
                    ${['TUA', 'Aeroportuarios', 'Complementarios', 'Comerciales', 'Otros Ingresos'].map((s) => `<tr>
                        ${td(escapeHtml(s), `background:${C.beige};font-weight:700;`)}
                        ${td(SD, 'text-align:center;')}${td(SD, 'text-align:center;')}${td(SD, 'text-align:center;')}${td(SD, 'text-align:center;')}
                    </tr>`).join('')}
                </table>
            </div>`;
    }

    // ── Hojas sin fuente de datos ───────────────────────────────────────────
    // Se conserva su lugar y su estructura para que el documento mantenga las 17
    // hojas del original, pero cada una queda marcada.
    function hojaEsqueleto(datos, titulo, fuente, columnas, renglones) {
        const filas = (renglones || []).map((r) => `<tr>
            ${td(escapeHtml(r), `background:${C.beige};font-weight:700;`)}
            ${columnas.slice(1).map(() => td(SD, 'text-align:center;')).join('')}
        </tr>`).join('');
        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(datos.corte))}
                ${tituloSeccion(titulo)}
                ${bandaPendiente(fuente)}
                <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
                    <tr>${columnas.map((c, i) => th(escapeHtml(c), `background:${C.vino};color:#fff;text-align:center;${i === 0 ? 'width:30%;' : ''}`)).join('')}</tr>
                    ${filas}
                </table>
            </div>`;
    }

    // ── Puntos de conexión (dato estático, se recibe ya armado) ─────────────
    function hojaPuntosConexion(datos) {
        return `
            <div class="resumen-hoja">
                ${encabezadoHoja(fechaLarga(hoyPartes()), fechaLarga(datos.corte))}
                ${tituloSeccion('PUNTOS DE CONEXIÓN AIFA - CDMX')}
                ${datos.puntosConexionHtml || bandaPendiente('catálogo de transporte terrestre.')}
            </div>`;
    }

    function buildHtml(datos) {
        const hojas = [
            hojaAviacion(datos),
            hojaMensual(datos),
            hojaAerolineas(datos),
            hojaEsqueleto(datos, 'ADUANA No. 50', 'recaudación mensual por concepto (virtual, carga, pasajeros), pedimentos modulados y operaciones aduanales.',
                ['MES', 'VIRTUAL', 'CARGA', 'PASAJEROS', 'MONTO'], MESES),
            hojaEsqueleto(datos, 'AEROLÍNEAS DE CARGA', 'catálogo de aerolíneas de carga con tipo de servicio, países y frecuencias.',
                ['No.', 'AEROLÍNEA', 'PAÍSES', 'FRECUENCIA'], ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']),
            hojaOcupacion(datos),
            hojaEsqueleto(datos, 'INSTITUCIONES BANCARIAS Y LOCALES COMERCIALES', 'sucursales y cajeros por institución, clasificación IATA de locales y resultados de la encuesta de satisfacción.',
                ['INSTITUCIÓN', 'SUCURSALES OPERANDO', 'SUCURSALES EN ADAPTACIÓN', 'CAJEROS OPERANDO', 'CAJEROS EN ADAPTACIÓN'],
                ['HSBC México, S.A.', 'BBVA México, S.A.', 'Banca Mifel, S.A.', 'Banjército', 'Banorte, S.A.', 'Banamex, S.A.', 'Scotiabank Inverlat, S.A.', 'Santander México, S.A.']),
            hojaEsqueleto(datos, 'RUTAS COMERCIALES DE PASAJEROS', 'catálogo de rutas nacionales e internacionales con la aerolínea que las opera.',
                ['TIPO', 'DESTINO', 'AEROLÍNEA'], ['Nacionales', 'Internacionales']),
            hojaEsqueleto(datos, 'RUTAS COMERCIALES DE CARGA', 'frecuencias semanales por aerolínea de carga y destino.',
                ['AEROLÍNEA', 'DESTINO', 'FRECUENCIAS', 'NUM. OP. SEMANALES'], ['Regular de carga', 'Fletamento de carga']),
            hojaPuntosConexion(datos),
            hojaEsqueleto(datos, 'DISTRIBUCIÓN DE RECINTOS', 'plano de distribución de recintos fiscalizados (imagen), hoy fuera del sistema.',
                ['RECINTO', 'ESTATUS'], ['Recintos fiscalizados autorizados', 'Patio fiscal', 'Disponible']),
            hojaEsqueleto(datos, 'BOLETAS DE INFRACCIÓN Y PUNTO DE EQUILIBRIO', 'boletas emitidas por mes con monto, y los escenarios de ingresos/egresos del punto de equilibrio.',
                ['MES', 'No. DE BOLETAS', 'MONTO'], MESES),
            hojaEsqueleto(datos, 'EVOLUCIÓN DE LOCALES Y ESPACIOS COMERCIALES', 'locales y espacios por zona con arrendados, en proceso de asignación y disponibles.',
                ['ZONA', 'No. LOCALES', 'ARRENDADOS', 'EN PROCESO', 'DISPONIBLES'], ['Edificio Terminal de Pasajeros']),
            hojaEsqueleto(datos, 'EVOLUCIÓN DE LOCALES — DETALLE POR ZONA', 'desglose por giro de cada zona (Parque Santa Lucía, TITT, Edificio de Servicios, ETP, etc.).',
                ['GIRO', 'ESPACIOS', 'ARRENDADOS', 'OPERANDO', 'EN ADAPTACIÓN', 'DISPONIBLES'],
                ['Venta de alimentos', 'Venta de artículos', 'Venta de servicios', 'Máquinas de autoservicio', 'Bodegas', 'Oficinas']),
            hojaFauna(datos),
            hojaEsqueleto(datos, 'RECINTOS FISCALIZADOS', 'contratos por cliente con IMG, participación, ingreso aeroportuario, cobrado y por cobrar.',
                ['CLIENTE', 'CONTRATO', 'IMG', 'INGRESO AEROPORTUARIO', 'COBRADO', 'POR COBRAR'],
                ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']),
            hojaEsqueleto(datos, 'INFORME DE INGRESOS — AVANCE Y PROYECCIÓN', 'ingresos propios y egresos ejercidos por corte, con la proyección al cierre del ejercicio.',
                ['CONCEPTO', 'AL CIERRE DEL MES ANTERIOR', 'AVANCE AL CORTE', 'PROYECTADO AL CIERRE'],
                ['Ingresos de la gestión', 'Gasto corriente (ejercido)', 'Resultado'])
        ];

        return `
        <div style="font-family:'Montserrat','Segoe UI',Calibri,Arial,sans-serif;color:${C.tinta};width:${HOJA_W}px;background:#fff;">
            ${hojas.join('')}
        </div>`;
    }

    return Object.freeze({ PAGINA, HOJA_W, buildHtml, C, MESES });
});
