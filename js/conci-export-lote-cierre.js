/* ==========================================================================
   Conciliación › Manifiestos › Exportar Excel › Próximo cierre
   --------------------------------------------------------------------------
   Descarga SOLO los manifiestos que entrarán al próximo Cierre de
   Subsecretaría, como los contará el SWEAR de ese día: ni más ni menos.

   · El lote es el mismo que toma el botón del cierre
     (conciliacion_cerrar_subsecretaria, migración 053): todo manifiesto sin
     cierre_id con cierre_capturado_en desde baseline_en, sea cual sea su
     FECHA. Antes de entregar el archivo se compara con el conteo del
     servidor (conciliacion_resumen_lote_abierto) leído antes y después; si
     no coincide, se vuelve a leer y, si sigue sin coincidir, no se descarga.
   · Cada fila se clasifica en carga o pasajeros con la regla con la que el
     cierre escribe cierre_es_carga_reportado (_conci_clasificacion_reportable,
     migración 069) y lleva en CIERRE SUBSECRETARIA la fecha de ese corte.
   · Los ajustes autorizados pendientes entran a ese mismo corte (−como se
     reportó, +corregido), igual que en la vista reportable (070).
   · Las cifras de la hoja Resumen salen de las funciones del SWEAR
     (conciReportesPasajeros / conciReportesCarga .agregar) sobre esas filas.
   · Lo que entra al cierre pero el SWEAR no cuenta (INFORMATIVO, sin
     LLEGADA/SALIDA, cifras que no son número) no va en las hojas de datos:
     se enlista en el Resumen.
   ========================================================================== */
(function (root) {
    'use strict';

    const TABLA = 'Conciliación Manifiestos';
    // Se pide por id hasta recibir una página vacía: así no importa el tope de
    // filas por respuesta de la API (max_rows).
    const PAGINA = 1000;
    const INTENTOS = 3;

    const normaliza = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    const esLlegada = t => /LLEG|ARR/.test(normaliza(t));
    const esSalida = t => /SAL|DEP/.test(normaliza(t));
    const esInternacional = t => /INTERNACIONAL/.test(normaliza(t));
    const esInformativo = f => f.INFORMATIVO === true || f.INFORMATIVO === 'true';
    const vacio = v => String(v ?? '').trim() === '';
    // btrim de Postgres: sólo espacios.
    const btrim = v => String(v).replace(/^ +| +$/g, '');
    // jsonb ->> 'campo': el texto del valor, o null.
    const texto = v => (v === null || v === undefined) ? null : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    const dos = n => String(n).padStart(2, '0');
    const ddmmaaaa = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
    const uid = (prefijo, id, sufijo = '') => prefijo + String(id ?? '').padStart(18, '0') + sufijo;

    /** FECHA a AAAA-MM-DD, como los reportes (ISO o DD/MM/AAAA). */
    function aIso(valor) {
        const txt = String(valor ?? '').trim();
        const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const dmy = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
        if (!dmy) return '';
        const anio = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
        return `${anio}-${dos(dmy[2])}-${dos(dmy[1])}`;
    }

    /** public._aifa_safe_numeric: deja dígitos, punto y signo; si no es número, null. */
    function numeroSeguro(valor) {
        const t = texto(valor);
        if (t === null) return null;
        const limpio = t.replace(/[^0-9.-]/g, '');
        return /^-?(\d+\.?\d*|\.\d+)$/.test(limpio) ? Number(limpio) : null;
    }

    /** Como los reportes: vacío vale; si trae algo, debe ser número (sin espacios ni comas). */
    function esNumeroDelReporte(valor) {
        const t = String(valor ?? '').trim();
        return !t || Number.isFinite(Number(t.replace(/\s/g, '').replace(/,/g, '')));
    }

    function kilosDe(fila) {
        const total = numeroSeguro(fila['KG DE CARGA TOTAL']);
        if (total !== null && total !== 0) return total;
        return (numeroSeguro(fila['KGS. DE CARGA NACIONAL']) ?? 0) + (numeroSeguro(fila['KGS. DE CARGA INTERNACIONAL']) ?? 0);
    }

    /**
     * Carga o pasajeros, y la aerolínea a reportar, como los escribe el cierre
     * en una fila todavía abierta (public._conci_clasificacion_reportable, 069):
     *   · si la fila ya trae la marca (recargas del libro), ésa;
     *   · aerolínea del catálogo sólo de carga → carga;
     *   · si no: sin pasajeros y con kilos → carga; si no, pasajeros.
     * catalogo: filas activas de conciliacion_catalogo_aerolineas por id.
     */
    function clasificar(fila, catalogo) {
        let crudo = null;
        for (const k of ['AEROLINEA', 'aerolinea', 'AIRLINE', 'airline']) {
            if (fila[k] !== null && fila[k] !== undefined) { crudo = texto(fila[k]); break; }
        }
        const bruto = crudo === null ? null : (btrim(crudo) || null);

        const marca = texto(fila.cierre_es_carga_reportado);
        if (!texto(fila.cierre_id) && marca) {
            const reportada = btrim(texto(fila.cierre_aerolinea_reportada) ?? '');
            return { esCarga: marca === 'true', aerolinea: reportada || bruto };
        }

        const igual = (a, b) => a !== null && a !== undefined && btrim(String(a)).toLowerCase() === b.toLowerCase();
        const entrada = bruto === null ? null : (catalogo || []).find(c => c && c.active === true && (
            (c.iata !== null && c.iata !== undefined && btrim(String(c.iata)).toUpperCase() === bruto.toUpperCase())
            || igual(c.name, bruto)
            || (Array.isArray(c.aliases) && c.aliases.some(a => igual(a, bruto)))
        )) || null;
        const tipos = (entrada && Array.isArray(entrada.types) ? entrada.types : [])
            .filter(t => t !== null && t !== undefined)
            .map(t => btrim(String(t)).toLowerCase());
        const deCarga = tipos.some(t => t === 'carga' || t === 'cargo');
        const dePasajeros = tipos.some(t => t.includes('pasajeros'));
        const pax = numeroSeguro(fila['TOTAL PAX']) ?? 0;
        return {
            esCarga: (deCarga && !dePasajeros) || (pax === 0 && kilosDe(fila) > 0),
            aerolinea: entrada ? entrada.name : bruto
        };
    }

    /** Las filas del lote tal como quedarán al cerrarse. */
    function prepararLote(filas, catalogo, fechaCorteIso) {
        const cat = [...(catalogo || [])].sort((a, b) => Number(a.id) - Number(b.id));
        const corte = ddmmaaaa(fechaCorteIso);
        return (filas || []).map(fila => {
            const c = clasificar(fila, cat);
            return {
                ...fila,
                cierre_es_carga_reportado: c.esCarga,
                cierre_aerolinea_reportada: c.aerolinea,
                'CIERRE SUBSECRETARIA': corte,
                _es_ajuste: false,
                _signo: 1,
                _uid: uid('M', fila.id)
            };
        });
    }

    /** Ajustes pendientes como los sirve la vista reportable al aplicarse. */
    function filasDeAjustes(ajustes, fechaCorteIso) {
        const corte = ddmmaaaa(fechaCorteIso);
        const filas = [];
        for (const a of [...(ajustes || [])].sort((x, y) => Number(x.id) - Number(y.id))) {
            for (const [datos, signo, sufijo] of [[a.datos_antes, -1, 'A'], [a.datos_despues, 1, 'D']]) {
                const d = typeof datos === 'string' ? JSON.parse(datos) : datos;
                if (!d || typeof d !== 'object') continue;
                const fila = { ...d, 'CIERRE SUBSECRETARIA': corte, _es_ajuste: true, _signo: signo, _ajuste_id: a.id, _uid: uid('X', a.id, sufijo) };
                if (!esInformativo(fila)) filas.push(fila);
            }
        }
        return filas;
    }

    /** Por qué una fila del lote no suma en el SWEAR ('' si sí suma). */
    function motivoNoCuenta(fila) {
        if (esInformativo(fila)) return 'INFORMATIVO: se cierra, pero no suma';
        const tipo = fila['TIPO DE MANIFIESTO'];
        if (!esLlegada(tipo) && !esSalida(tipo)) return 'TIPO DE MANIFIESTO sin LLEGADA ni SALIDA: no suma';
        const campos = fila.cierre_es_carga_reportado
            ? ['KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL']
            : ['TOTAL PAX'];
        const malo = campos.find(c => !esNumeroDelReporte(fila[c]));
        return malo ? `${malo} no es un número: no suma` : '';
    }

    /**
     * Lo que conviene revisar antes de cerrar entre lo que sí suma.
     * rutaOperacion(fila) → 'Nacional' | 'Internacional' | '' según la ruta.
     */
    function revisar(filas, rutaOperacion) {
        const avisos = [];
        const grupos = new Map();
        for (const f of filas) {
            const op = f['TIPO DE OPERACIÓN'];
            const cuenta = esInternacional(op) ? 'Internacional' : 'Nacional';
            const reconocido = /^(NACIONAL|INTERNACIONAL)$/.test(normaliza(op));
            let ruta = '';
            try { ruta = rutaOperacion ? String(rutaOperacion(f) || '') : ''; } catch (_) { ruta = ''; }
            const rutaDistinta = ruta && normaliza(ruta) !== normaliza(cuenta);
            if (!reconocido && (rutaDistinta || !ruta)) {
                avisos.push({ fila: f, motivo: `TIPO DE OPERACIÓN ${vacio(op) ? 'vacío' : `«${String(op).trim()}»`}: el SWEAR lo cuenta ${cuenta.toLowerCase()}`
                    + (rutaDistinta ? `; la ruta indica ${ruta.toLowerCase()}` : '') });
            } else if (reconocido && rutaDistinta) {
                avisos.push({ fila: f, motivo: `TIPO DE OPERACIÓN dice ${cuenta.toLowerCase()} y la ruta indica ${ruta.toLowerCase()}` });
            }
            if (vacio(f['HR. DE RECEPCIÓN']) && !(numeroSeguro(f['TOTAL PAX']) ?? 0) && !kilosDe(f)) {
                avisos.push({ fila: f, motivo: 'Sin HR. DE RECEPCIÓN, sin pasajeros ni kilos: ¿es una captura real?' });
            }
            if (vacio(f.AEROLINEA)) {
                avisos.push({ fila: f, motivo: 'Sin AEROLINEA: sus cifras suman, pero no cuenta como operación' });
            }
            const num = (/([0-9]+)\s*$/.exec(String(f['# DE VUELO'] ?? '')) || [])[1];
            const fecha = aIso(f.FECHA);
            if (num && fecha) {
                const clave = [f.cierre_es_carga_reportado ? 'C' : 'P', normaliza(f.cierre_aerolinea_reportada || f.AEROLINEA),
                    num.replace(/^0+/, ''), fecha, esLlegada(f['TIPO DE MANIFIESTO']) ? 'L' : 'S'].join('|');
                if (!grupos.has(clave)) grupos.set(clave, []);
                grupos.get(clave).push(f);
            }
        }
        for (const grupo of grupos.values()) {
            if (grupo.length < 2) continue;
            const ids = grupo.map(g => g.id).join(', ');
            for (const f of grupo) avisos.push({ fila: f, motivo: `Mismo vuelo, fecha y sentido más de una vez en el lote (ids ${ids})` });
        }
        return avisos;
    }

    /** El bloque del día del SWEAR, con las funciones del SWEAR (js/conci-mensaje-envio.js). */
    function cifrasDelDia(filas, fechaIso, P, C) {
        const tercia = (b, campo) => {
            const nacional = b.LLEGADA.NACIONAL[campo] + b.SALIDA.NACIONAL[campo];
            const internacional = b.LLEGADA.INTERNACIONAL[campo] + b.SALIDA.INTERNACIONAL[campo];
            return { total: nacional + internacional, nacional, internacional };
        };
        const columnas = P.columnas(filas[0] || {});
        const pax = P.agregar({ filas, columnas, hasta: fechaIso }, fechaIso).sub.actual.dia;
        const carga = C.agregar({ filas, columnas: { ...C.columnas(filas[0] || {}), cierre: columnas.cierre } }, fechaIso).sub.actual.dia;
        const ton = C.toneladas(carga).enteras;
        const tot = C.totales(carga);
        return {
            pax: tercia(pax, 'pax'),
            opsPax: tercia(pax, 'ops'),
            toneladas: { total: ton.total, nacional: ton.nacional, internacional: ton.internacional },
            kilos: { total: tot.total.kg, nacional: tot.nacional.kg, internacional: tot.internacional.kg },
            opsCarga: { total: tot.total.ops, nacional: tot.nacional.ops, internacional: tot.internacional.ops }
        };
    }

    /**
     * Todo lo que va en el archivo. leido: { filas, ajustes, catalogo, fechaCorte }.
     */
    function analizar(leido, { P, C, rutaOperacion } = {}) {
        const fechaCorte = leido.fechaCorte;
        const lote = prepararLote(leido.filas, leido.catalogo, fechaCorte);
        const cuentan = [];
        const noCuentan = [];
        for (const fila of lote) {
            const motivo = motivoNoCuenta(fila);
            if (motivo) noCuentan.push({ fila, motivo });
            else cuentan.push(fila);
        }
        const filasAjuste = filasDeAjustes(leido.ajustes, fechaCorte);
        // Como la vista reportable: sin INFORMATIVOS en ningún bloque.
        const cifras = cifrasDelDia([...lote.filter(f => !esInformativo(f)), ...filasAjuste], fechaCorte, P, C);
        // Registros de carga que suman kilos pero no operación (aerolíneas mixtas).
        const cargaConAerolinea = cuentan.filter(f => f.cierre_es_carga_reportado && !vacio(f.AEROLINEA));
        const mixtas = cargaConAerolinea.length
            ? cargaConAerolinea.length - cifrasDelDia(cargaConAerolinea, fechaCorte, P, C).opsCarga.total
            : 0;
        return {
            fechaCorte,
            totalLote: lote.length,
            cuentan,
            noCuentan,
            pasajeros: cuentan.filter(f => !f.cierre_es_carga_reportado).length,
            carga: cuentan.filter(f => f.cierre_es_carga_reportado).length,
            ajustes: [...(leido.ajustes || [])].sort((x, y) => Number(x.id) - Number(y.id)),
            cifras,
            mixtas,
            revisar: revisar(cuentan, rutaOperacion)
        };
    }

    /* ── lectura ────────────────────────────────────────────────────────── */

    async function leerTodo(armar) {
        const filas = [];
        let ultimo = null;
        for (;;) {
            let q = armar();
            if (ultimo !== null) q = q.gt('id', ultimo);
            const { data, error } = await q.order('id', { ascending: true }).limit(PAGINA);
            if (error) throw error;
            const pagina = Array.isArray(data) ? data : [];
            if (!pagina.length) break;
            filas.push(...pagina);
            ultimo = pagina[pagina.length - 1].id;
        }
        return filas;
    }

    async function resumenServidor(client) {
        const { data, error } = await client.rpc('conciliacion_resumen_lote_abierto');
        if (error) throw error;
        return data || {};
    }

    /** El lote, los ajustes pendientes y el catálogo, cuadrados con el servidor. */
    async function leerLote(client) {
        for (let intento = 1; ; intento++) {
            const antes = await resumenServidor(client);
            if (!antes.baseline_en) throw new Error('Falta la configuración del Cierre de Subsecretaría (conciliacion_cierre_config).');
            const [filas, ajustes, catalogo] = await Promise.all([
                leerTodo(() => client.from(TABLA).select('*')
                    .is('cierre_id', null)
                    .not('cierre_capturado_en', 'is', null)
                    .gte('cierre_capturado_en', antes.baseline_en)),
                leerTodo(() => client.from('conciliacion_ajustes').select('*')
                    .eq('estado', 'pendiente')
                    .is('cierre_aplicacion_id', null)),
                leerTodo(() => client.from('conciliacion_catalogo_aerolineas')
                    .select('id,name,iata,aliases,types,active')
                    .eq('active', true))
            ]);
            const despues = await resumenServidor(client);
            const n = filas.length;
            const cuadra = Number(antes.total_manifiestos) === n && Number(despues.total_manifiestos) === n
                && Number(antes.ajustes_pendientes) === ajustes.length && Number(despues.ajustes_pendientes) === ajustes.length
                && String(antes.siguiente_fecha_corte) === String(despues.siguiente_fecha_corte);
            if (cuadra) {
                return { filas, ajustes, catalogo, fechaCorte: String(despues.siguiente_fecha_corte).slice(0, 10), servidor: despues };
            }
            if (intento >= INTENTOS) {
                throw new Error(`La base reporta ${despues.total_manifiestos} manifiestos en el lote y se leyeron ${n}`
                    + ` (ajustes: ${despues.ajustes_pendientes} y ${ajustes.length}). Puede que alguien esté capturando o cerrando;`
                    + ' no se descargó nada para no entregar un archivo incompleto. Vuelve a intentarlo.');
            }
        }
    }

    /* ── libro ──────────────────────────────────────────────────────────── */

    const VERDE = 'FF15683F';
    const borde = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const bordes = { top: borde, left: borde, bottom: borde, right: borde };
    const fuente = (extra = {}) => ({ name: 'Noto Sans', size: 10, ...extra });

    function escribirTabla(ws, fila, encabezados, renglones) {
        encabezados.forEach((h, i) => {
            const c = ws.getCell(fila, i + 1);
            c.value = h;
            c.font = fuente({ bold: true, color: { argb: 'FFFFFFFF' } });
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
            c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            c.border = bordes;
        });
        renglones.forEach((valores, r) => {
            valores.forEach((v, i) => {
                const c = ws.getCell(fila + 1 + r, i + 1);
                c.value = v ?? '';
                c.font = fuente(i === 0 ? { bold: true } : {});
                c.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : (i === 0 ? 'left' : 'center'), wrapText: i === 0 };
                c.border = bordes;
                if (typeof v === 'number') c.numFmt = '#,##0';
            });
        });
        return fila + renglones.length + 2;
    }

    function escribirResumen(ws, a, meta) {
        [56, 16, 16, 18, 14, 20, 16, 14, 26].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
        const fecha = ddmmaaaa(a.fechaCorte);
        let n = 1;
        const titulo = (txt, tam = 11) => {
            ws.mergeCells(n, 1, n, 9);
            const c = ws.getCell(n, 1);
            c.value = txt;
            c.font = fuente({ size: tam, bold: true, color: { argb: 'FFFFFFFF' } });
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
            c.alignment = { vertical: 'middle', horizontal: 'left' };
            n++;
        };
        const nota = txt => {
            ws.mergeCells(n, 1, n, 9);
            const c = ws.getCell(n, 1);
            c.value = txt;
            c.font = fuente({ size: 9, italic: true, color: { argb: 'FF555555' } });
            c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            n++;
        };

        titulo(`Próximo Cierre de Subsecretaría: ${fecha}`, 13);
        nota(`Descargado el ${meta.generado}. Es el lote en ese momento: lo que se capture después también entrará a este cierre.`);
        nota('En las hojas, CIERRE SUBSECRETARIA trae la fecha del cierre al que entrarán y TIPO DE OPERACIÓN va como lo cuenta el SWEAR.');
        n++;

        titulo(`Lo que contará el SWEAR del ${fecha} (el día)`);
        const c = a.cifras;
        n = escribirTabla(ws, n, ['', 'Total', 'Nacionales', 'Internacionales'], [
            ['a. Pasajeros', c.pax.total, c.pax.nacional, c.pax.internacional],
            ['b. Operaciones', c.opsPax.total, c.opsPax.nacional, c.opsPax.internacional],
            ['c. Carga (toneladas)', c.toneladas.total, c.toneladas.nacional, c.toneladas.internacional],
            ['d. Operaciones', c.opsCarga.total, c.opsCarga.nacional, c.opsCarga.internacional],
            ['Carga en kilos', c.kilos.total, c.kilos.nacional, c.kilos.internacional]
        ]);

        titulo('Manifiestos');
        const renglones = [
            ['Entran al cierre (según la base)', a.totalLote],
            ['En la hoja Pasajeros', a.pasajeros],
            ['En la hoja Carga', a.carga],
            ['Entran al cierre pero el SWEAR no los cuenta (lista abajo)', a.noCuentan.length]
        ];
        if (a.mixtas) renglones.push(['De la hoja Carga, aerolíneas mixtas: suman kilos, no cuentan como operación', a.mixtas]);
        if (a.ajustes.length) renglones.push(['Ajustes autorizados que se aplican en este cierre (hoja Ajustes)', a.ajustes.length]);
        n = escribirTabla(ws, n, ['', 'Cantidad'], renglones);

        const lista = (encabezado, items) => {
            if (!items.length) return;
            titulo(encabezado);
            n = escribirTabla(ws, n,
                ['Motivo', 'Id', 'Aerolínea', '# de vuelo', 'FECHA', 'Tipo de manifiesto', 'Destino / Origen', 'Segmento', 'Capturó'],
                items.map(({ fila: f, motivo }) => [
                    motivo, f.id ?? '', meta.aerolinea(f), String(f['# DE VUELO'] ?? ''),
                    aIso(f.FECHA) ? ddmmaaaa(aIso(f.FECHA)) : String(f.FECHA ?? ''),
                    String(f['TIPO DE MANIFIESTO'] ?? ''), String(f['DESTINO / ORIGEN'] ?? ''),
                    f.cierre_es_carga_reportado ? 'Carga' : 'Pasajeros', String(f['CAPTURÓ'] ?? '')
                ]));
        };
        lista('Entran al cierre pero el SWEAR no los cuenta (no van en las hojas)', a.noCuentan);
        lista('Revisar antes de cerrar (sí van en las hojas y sí cuentan)', a.revisar);
    }

    function escribirAjustes(ws, ajustes, meta) {
        const campos = ['TOTAL PAX', 'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL'];
        const renglones = [];
        for (const a of ajustes) {
            for (const [datos, efecto] of [[a.datos_antes, '− como se reportó'], [a.datos_despues, '+ corregido']]) {
                const d = (typeof datos === 'string' ? JSON.parse(datos) : datos) || {};
                const num = v => { const x = numeroSeguro(v); return x === null ? String(v ?? '') : x; };
                renglones.push([
                    a.id, a.manifiesto_id, esInformativo(d) ? `${efecto} (INFORMATIVO: no suma)` : efecto,
                    d.cierre_es_carga_reportado === true ? 'Carga' : 'Pasajeros',
                    aIso(d.FECHA) ? ddmmaaaa(aIso(d.FECHA)) : String(d.FECHA ?? ''),
                    String(d['TIPO DE MANIFIESTO'] ?? ''), String(d['TIPO DE OPERACIÓN'] ?? ''),
                    meta.aerolinea(d), String(d['# DE VUELO'] ?? ''),
                    ...campos.map(c => num(d[c])),
                    String(a.campo ?? ''), `${a.valor_anterior ?? ''} → ${a.valor_nuevo ?? ''}`
                ]);
            }
        }
        const encabezados = ['Ajuste', 'Manifiesto', 'Efecto', 'Segmento', 'FECHA', 'TIPO DE MANIFIESTO', 'TIPO DE OPERACIÓN',
            'AEROLINEA', '# DE VUELO', ...campos, 'Campo corregido', 'Antes → después'];
        encabezados.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(12, Math.min(34, h.length + 4)); });
        escribirTabla(ws, 1, encabezados, renglones);
    }

    /**
     * Arma el libro: Resumen, Pasajeros y Carga (formato de Exportar Excel),
     * y Ajustes si hay. exportarHoja = window.conciExportExcel.
     */
    async function armarLibro(ExcelJS, a, { exportarHoja, generado, aerolinea }) {
        const wb = new ExcelJS.Workbook();
        const resumen = wb.addWorksheet('Resumen');
        const meta = { generado, aerolinea: aerolinea || (f => String(f.cierre_aerolinea_reportada || f.AEROLINEA || '')) };
        if (a.cuentan.length) {
            // TIPO DE OPERACIÓN como lo cuenta el SWEAR: si no dice internacional, nacional.
            const rows = a.cuentan.map(f => ({ ...f, 'TIPO DE OPERACIÓN': esInternacional(f['TIPO DE OPERACIÓN']) ? 'Internacional' : 'Nacional' }));
            const base = { rows, soloRecibidos: false, sinHojaInformativos: true };
            if (a.pasajeros) await exportarHoja('pax', wb, { ...base, sheetName: 'Pasajeros' });
            if (a.carga) await exportarHoja('carga', wb, { ...base, sheetName: 'Carga' });
        }
        if (a.ajustes.length) escribirAjustes(wb.addWorksheet('Ajustes'), a.ajustes, meta);
        escribirResumen(resumen, a, meta);
        return wb;
    }

    /* ── botón ──────────────────────────────────────────────────────────── */

    let enCurso = false;

    async function exportarLoteCierre() {
        if (enCurso) return;
        const avisar = (msg, tipo) => { if (typeof root.showNotification === 'function') root.showNotification(msg, tipo); };
        const P = root.conciReportesPasajeros;
        const C = root.conciReportesCarga;
        if (typeof root.ExcelJS === 'undefined' || typeof root.saveAs === 'undefined') {
            alert('No se pudo cargar la librería de Excel. Verifica tu conexión e inténtalo de nuevo.');
            return;
        }
        if (!P || !C || typeof P.columnas !== 'function' || typeof C.columnas !== 'function' || typeof root.conciExportExcel !== 'function') {
            alert('No se cargaron los reportes de Conciliación: recarga la página.');
            return;
        }
        enCurso = true;
        try {
            avisar('Leyendo los manifiestos que entrarán al próximo cierre…', 'info');
            let client = root.supabaseClient;
            if (!client && typeof root.ensureSupabaseClient === 'function') client = await root.ensureSupabaseClient();
            if (!client) throw new Error('No hay conexión con la base de datos.');
            // Nombres y colores de aerolíneas, y cuáles son mixtas, como en el SWEAR.
            if (typeof root._ensureConciAirlineCatalog === 'function') {
                try { await root._ensureConciAirlineCatalog(); } catch (_) { /* se usa lo capturado */ }
            }
            const leido = await leerLote(client);
            if (!leido.filas.length && !leido.ajustes.length) {
                alert('No hay manifiestos por cerrar: el próximo Cierre de Subsecretaría está vacío.');
                return;
            }
            const rutaOperacion = typeof root._conciResolveOperationTypeFromRoute === 'function'
                ? f => root._conciResolveOperationTypeFromRoute(String(f['DESTINO / ORIGEN'] || f.RUTA || ''), String(f['TIPO DE MANIFIESTO'] || ''))
                : null;
            const a = analizar(leido, { P, C, rutaOperacion });
            const ahora = new Date();
            const wb = await armarLibro(root.ExcelJS, a, {
                exportarHoja: root.conciExportExcel,
                generado: `${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}/${ahora.getFullYear()} ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`,
                aerolinea: f => String(f.cierre_aerolinea_reportada || (typeof P.nombreAerolinea === 'function' ? P.nombreAerolinea(f.AEROLINEA) : f.AEROLINEA) || '')
            });
            const buf = await wb.xlsx.writeBuffer();
            root.saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                `Proximo_Cierre_Subsecretaria_${ddmmaaaa(a.fechaCorte).replace(/\//g, '-')}.xlsx`);
            avisar(`Cierre del ${ddmmaaaa(a.fechaCorte)}: ${a.totalLote} manifiestos descargados.`, 'success');
        } catch (err) {
            alert(`No se pudo descargar el lote del cierre: ${err && err.message ? err.message : err}`);
        } finally {
            enCurso = false;
        }
    }

    const api = {
        clasificar, numeroSeguro, prepararLote, filasDeAjustes, motivoNoCuenta, revisar,
        cifrasDelDia, analizar, leerLote, armarLibro, exportarLoteCierre
    };
    root.ConciExportLoteCierre = api;
    root.conciExportLoteCierre = exportarLoteCierre;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
