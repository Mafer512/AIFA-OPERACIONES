/* ==========================================================================
   Reportes > Carga
   --------------------------------------------------------------------------
   Los cuatro reportes de carga y la presentación que hasta ahora se armaban a
   mano en "BASE DE CARGA 2026" y "PRESENTACIÓN CARGA", reproducidos sobre lo
   capturado en Conciliación Manifiestos. Las fórmulas salieron de las nueve
   tablas dinámicas del libro.

   El libro parte la carga en cuatro campos:

       IMPORTACIÓN              llegada internacional
       EXPORTACIÓN              salida internacional
       KGS CARGA LLEGADA NLU    llegada nacional
       KG. DE CARGA SALIDA NLU  salida nacional

   Aquí no hace falta inventarlos: la tabla ya guarda KGS. DE CARGA NACIONAL y
   KGS. DE CARGA INTERNACIONAL, así que cruzándolos con TIPO DE MANIFIESTO se
   obtienen los cuatro exactos. Derivarlos de TIPO DE OPERACIÓN habría sido un
   error: en el libro hay 137 salidas internacionales cuya carga está anotada
   como nacional y 54 manifiestos que llevan las dos cosas a la vez.

   Los reportes:

     SUBSECRETARÍA  filtra por Cierre Subsecretaria, igual que el de pasajeros:
                    la columna del día pedido y la del día anterior, que puede
                    caer en el mes previo. Operaciones = cuenta de
                    AEROLINEA cruzando LLEGADA/SALIDA contra NACIONAL/
                    INTERNACIONAL. Toneladas = kilos entre mil, y el entero se
                    reparte de modo que nacional + internacional cuadre con el
                    total redondeado, que es lo que el libro hace a mano en su
                    renglón "REDONDEO".

     HOJA 1         por AEROLINEA: operaciones y carga en toneladas. El libro
                    trunca a dos decimales —TRUNC, no ROUND— para que la suma
                    de las partes nunca pase del total real.

     HOJA 2         las mismas cifras en tarjetas, que es la maqueta de la
                    presentación.

     REPORTE CARGA  concentrado del año por mes: carga internacional en kilos
                    (llegada, salida, subtotal) y operaciones internacionales.
                    No considera operaciones mixtas.

     PRESENTACIÓN   réplica de la baraja: portada, resumen de la terminal,
                    tarjetas por modalidad, totales y los catálogos.
   ========================================================================== */
(function () {
    'use strict';

    const TABLA = 'Conciliación Manifiestos';
    const PAGINA = 1000;

    const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
        'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const MES_CORTO = ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.',
        'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.'];

    /* El catálogo de aerolíneas de la presentación —su orden, modalidad y
       logotipo—, el arrendamiento húmedo y la línea base histórica viven en
       js/conci-carga-catalogo.js; el armado del .pptx, en
       js/conci-presentacion-carga.js. */
    const CAT = () => window.ConciCargaCatalogo;

    let cache = null;
    let reporteActivo = 'subsecretaria';
    let ultimo = null;

    /* ── utilidades ─────────────────────────────────────────────────────── */

    const el = id => document.getElementById(id);
    const entero = n => Math.round(Number(n) || 0).toLocaleString('es-MX');
    const dosDec = n => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function escapar(texto) {
        return String(texto ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function aIso(valor) {
        if (valor === null || valor === undefined) return '';
        if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
            return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
        }
        const txt = String(valor).trim();
        if (!txt) return '';
        const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const dmy = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
        if (dmy) {
            let [, d, m, a] = dmy;
            if (a.length === 2) a = '20' + a;
            return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        return '';
    }

    const cuentaSiHay = valor => String(valor ?? '').trim() !== '';

    function normaliza(texto) {
        return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    }

    const esLlegada = t => /LLEG|ARR/.test(normaliza(t));
    const esSalida = t => /SAL|DEP/.test(normaliza(t));
    const esInternacional = o => /INTERNACIONAL/.test(normaliza(o));

    const dosDigitos = n => String(n).padStart(2, '0');
    const diasDelMes = (a, m) => new Date(a, m, 0).getDate();
    /** AAAA-MM-DD del día anterior, cruzando mes y año. */
    function diaAnterior(iso) {
        const [a, m, d] = iso.split('-').map(Number);
        const f = new Date(a, m - 1, d - 1);
        return `${f.getFullYear()}-${dosDigitos(f.getMonth() + 1)}-${dosDigitos(f.getDate())}`;
    }

    function fechaLarga(iso) {
        const [a, m, d] = iso.split('-').map(Number);
        return `${dosDigitos(d)}/${dosDigitos(m)}/${a}`;
    }

    /** Nombre comercial, del mismo catálogo que pinta la tabla de Manifiestos. */
    function nombreAerolinea(valor) {
        const bruto = String(valor ?? '').trim();
        if (!bruto) return '';
        try {
            const meta = typeof window._conciResolveAirlineMeta === 'function'
                ? window._conciResolveAirlineMeta(bruto) : null;
            if (meta && meta.name) return String(meta.name).toUpperCase();
        } catch (_) { /* sin catálogo se queda lo capturado */ }
        return bruto.toUpperCase();
    }

    /** Código IATA que el catálogo de la tabla le conoce a lo capturado. */
    function iataDe(valor) {
        try {
            const meta = typeof window._conciResolveAirlineMeta === 'function'
                ? window._conciResolveAirlineMeta(String(valor ?? '').trim()) : null;
            return meta && meta.iata ? String(meta.iata).toUpperCase() : '';
        } catch (_) { return ''; }
    }

    /**
     * Reparte un total de toneladas en dos enteros que sumen el total
     * redondeado. El libro lo hace a mano en su renglón "REDONDEO": toma la
     * parte entera de cada lado y suma 1 al que arrastra el decimal mayor.
     */
    function repartirEnteros(nacional, internacional) {
        const total = Math.round(nacional + internacional);
        const baseNac = Math.floor(nacional);
        const baseInt = Math.floor(internacional);
        let sobra = total - baseNac - baseInt;
        const nac = { valor: baseNac, frac: nacional - baseNac };
        const int = { valor: baseInt, frac: internacional - baseInt };
        // Se reparte de mayor a menor fracción; con dos lados basta una vuelta.
        const orden = nac.frac >= int.frac ? [nac, int] : [int, nac];
        for (const lado of orden) {
            if (sobra <= 0) break;
            lado.valor++;
            sobra--;
        }
        return { nacional: nac.valor, internacional: int.valor, total };
    }

    /* ── columnas ───────────────────────────────────────────────────────── */

    function detectarColumnas(fila) {
        const claves = Object.keys(fila || {});
        const buscar = re => claves.find(c => re.test(normaliza(c))) || null;
        return {
            cierre: buscar(/^CIERRE\s+SUBSECRETARIA/),
            fecha: buscar(/^FECHA$/) || buscar(/(^|\s)FECHA(\s|$)/),
            tipo: buscar(/TIPO\s+DE\s+MANIF/),
            operacion: buscar(/TIPO\s+DE\s+OPERACION/),
            aerolinea: buscar(/AEROLINEA|AIRLINE/),
            cargaNac: buscar(/CARGA\s+NACIONAL/),
            cargaInt: buscar(/CARGA\s+INTERNACIONAL/),
            cargaTotal: buscar(/CARGA\s+TOTAL/) || buscar(/^KGS\.?\s+DE\s+CARGA$/),
            portal: claves.find(c => c === '_portal_flight_date') || null
        };
    }

    /* ── datos ──────────────────────────────────────────────────────────── */

    function cliente() {
        const c = window.supabaseClient;
        if (!c) throw new Error('No hay conexión con la base de datos.');
        return c;
    }

    async function descargar(hastaIso, avisar) {
        if (cache && cache.hasta === hastaIso) return cache;
        const client = cliente();
        const muestra = await client.from(TABLA).select('*').limit(1);
        if (muestra.error) throw muestra.error;
        if (!muestra.data || !muestra.data.length) {
            return (cache = { hasta: hastaIso, filas: [], columnas: detectarColumnas({}) });
        }
        const columnas = detectarColumnas(muestra.data[0]);
        const pedidas = [...new Set(Object.values(columnas).filter(Boolean))];
        const select = pedidas.map(c => `"${c}"`).join(',');

        const filas = [];
        for (let desde = 0; ; desde += PAGINA) {
            let q = client.from(TABLA).select(select).order('id', { ascending: true })
                .range(desde, desde + PAGINA - 1);
            if (columnas.portal) q = q.lte(columnas.portal, hastaIso);
            const { data, error } = await q;
            if (error) throw error;
            filas.push(...(data || []));
            if (avisar) avisar(filas.length);
            if (!data || data.length < PAGINA) break;
        }
        return (cache = { hasta: hastaIso, filas, columnas });
    }

    /* ── agregación ─────────────────────────────────────────────────────── */

    const cubo = () => ({ kg: 0, ops: 0 });
    const cuadro = () => ({
        LLEGADA: { NACIONAL: cubo(), INTERNACIONAL: cubo() },
        SALIDA: { NACIONAL: cubo(), INTERNACIONAL: cubo() }
    });

    /**
     * Una pasada llena los cuatro reportes y la presentación. Cada fila aporta
     * sus kilos al carril que le toca —llegada o salida, nacional o
     * internacional— y una operación si trae aerolínea.
     */
    function agregar(datos, fechaIso) {
        const { filas, columnas } = datos;
        const [anio, mes] = fechaIso.split('-').map(Number);
        const prefijoAnio = fechaIso.slice(0, 4);

        // Dos cierres, como el de pasajeros: el del día pedido y el del día
        // anterior, que puede caer en el mes previo.
        const anioSub = anio;
        const mesSub = mes;
        const cierres = { anterior: diaAnterior(fechaIso), actual: fechaIso };

        const sub = {};
        for (const clave of ['anterior', 'actual']) {
            sub[clave] = {};
            for (const alcance of ['dia', 'mes', 'anio', 'historico']) sub[clave][alcance] = cuadro();
        }

        const porAerolinea = new Map();               // Hoja 1 y Hoja 2
        const porMes = Array.from({ length: 12 }, () => ({
            impKg: 0, expKg: 0, opsIntLlegada: 0, opsIntSalida: 0
        }));                                           // REPORTE CARGA
        const anioActual = { ops: 0, kg: 0 };          // presentación
        const delDia = { ops: 0, kg: 0 };
        let descartadosPax = 0;

        for (const fila of filas) {
            // Estos son los reportes de carga: los de pasajeros no entran.
            if (typeof window._conciRowIsCargo === 'function'
                && !window._conciRowIsCargo(fila, columnas.operacion, columnas.aerolinea)) {
                descartadosPax++;
                continue;
            }

            const tipo = columnas.tipo ? fila[columnas.tipo] : '';
            const llegada = esLlegada(tipo);
            const salida = esSalida(tipo);
            if (!llegada && !salida) continue;

            const operacion = columnas.operacion ? fila[columnas.operacion] : '';
            const bruto = String(columnas.aerolinea ? fila[columnas.aerolinea] : '').trim();
            const cuentaOp = cuentaSiHay(bruto);

            let nacKg = Number(columnas.cargaNac ? fila[columnas.cargaNac] : 0) || 0;
            let intKg = Number(columnas.cargaInt ? fila[columnas.cargaInt] : 0) || 0;
            // Captura vieja: solo el total. Se atribuye por tipo de operación,
            // que es lo único que hay para decidir de qué lado va.
            if (!nacKg && !intKg && columnas.cargaTotal) {
                const total = Number(fila[columnas.cargaTotal]) || 0;
                if (esInternacional(operacion)) intKg = total; else nacKg = total;
            }
            const kg = nacKg + intKg;

            // ── Subsecretaría: por Cierre Subsecretaria ──
            const cierre = aIso(columnas.cierre ? fila[columnas.cierre] : '');
            if (cierre) {
                const carril = llegada ? 'LLEGADA' : 'SALIDA';
                for (const clave of ['anterior', 'actual']) {
                    const corte = cierres[clave];
                    if (cierre > corte) continue;
                    const suma = alcance => {
                        const c = sub[clave][alcance][carril];
                        c.NACIONAL.kg += nacKg;
                        c.INTERNACIONAL.kg += intKg;
                        // El libro cuenta AEROLINEA, y la operación cae del
                        // lado que diga TIPO DE OPERACIÓN, no de los kilos.
                        if (cuentaOp) {
                            if (esInternacional(operacion)) c.INTERNACIONAL.ops++;
                            else c.NACIONAL.ops++;
                        }
                    };
                    suma('historico');
                    if (cierre.slice(0, 4) === corte.slice(0, 4)) suma('anio');
                    if (cierre.slice(0, 7) === corte.slice(0, 7)) suma('mes');
                    if (cierre === corte) suma('dia');
                }
            }

            // ── Hoja 1, Hoja 2, Reporte de Carga y presentación: por FECHA ──
            const fecha = aIso(columnas.fecha ? fila[columnas.fecha] : '');
            if (!fecha || fecha > fechaIso) continue;

            if (fecha.startsWith(prefijoAnio)) {
                const aerolinea = nombreAerolinea(bruto);
                if (aerolinea) {
                    const acc = porAerolinea.get(aerolinea) || { kg: 0, ops: 0, iata: iataDe(bruto) };
                    acc.kg += kg;
                    if (cuentaOp) acc.ops++;
                    porAerolinea.set(aerolinea, acc);
                }
                anioActual.kg += kg;
                if (cuentaOp) anioActual.ops++;

                const casilla = porMes[Number(fecha.slice(5, 7)) - 1];
                if (casilla) {
                    if (llegada) casilla.impKg += intKg; else casilla.expKg += intKg;
                    // El reporte no considera operaciones mixtas: solo cuenta
                    // las que el manifiesto declara internacionales.
                    if (esInternacional(operacion) && cuentaOp) {
                        if (llegada) casilla.opsIntLlegada++; else casilla.opsIntSalida++;
                    }
                }
            }

            if (fecha === fechaIso) {
                delDia.kg += kg;
                if (cuentaOp) delDia.ops++;
            }
        }

        return {
            sub, cierres, anioSub, mesSub,
            porAerolinea, porMes, anioActual, delDia,
            anio, mes, fechaIso, descartadosPax, totalFilas: filas.length
        };
    }

    /* ── totales derivados ──────────────────────────────────────────────── */

    /** Kilos y operaciones de un cuadro, por lado y en total. */
    function totales(bloque) {
        const t = {
            nacional: cubo(), internacional: cubo(), total: cubo(),
            llegada: cubo(), salida: cubo()
        };
        for (const carril of ['LLEGADA', 'SALIDA']) {
            for (const lado of ['NACIONAL', 'INTERNACIONAL']) {
                const c = bloque[carril][lado];
                const destino = lado === 'NACIONAL' ? t.nacional : t.internacional;
                destino.kg += c.kg; destino.ops += c.ops;
                const carrilT = carril === 'LLEGADA' ? t.llegada : t.salida;
                carrilT.kg += c.kg; carrilT.ops += c.ops;
            }
        }
        t.total.kg = t.nacional.kg + t.internacional.kg;
        t.total.ops = t.nacional.ops + t.internacional.ops;
        return t;
    }

    /** Toneladas del bloque, con el entero repartido como en el libro. */
    function toneladas(bloque) {
        const t = totales(bloque);
        const nac = t.nacional.kg / 1000;
        const int = t.internacional.kg / 1000;
        return { exactas: { nacional: nac, internacional: int, total: nac + int }, enteras: repartirEnteros(nac, int) };
    }

    /** Filas de la Hoja 1: aerolínea, operaciones y toneladas de presentación. */
    function filasHoja1(datos) {
        return [...datos.porAerolinea.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], 'es'))
            .map(([aerolinea, v]) => ({
                aerolinea,
                ops: v.ops,
                // TRUNC a dos decimales, como el libro: nunca pasarse del real.
                ton: Math.trunc((v.kg / 1000) * 100) / 100
            }));
    }


    /* ── render: marco común ────────────────────────────────────────────── */

    const NOTA = 'Los valores mostrados son el resultado de los registros de manifiestos recibidos '
        + 'por parte de los prestadores de servicios. Sin embargo, estos datos pueden variar de acuerdo '
        + 'al período de reporte y ajustes realizados por las aerolíneas.';

    function hoja(titulo, subtitulo, cuerpo, ancha) {
        return `
        <div class="conci-rep-hoja${ancha ? ' conci-rep-hoja-ancha' : ''}" id="conci-rep-hoja">
            <div class="conci-rep-logo">
                <img src="images/aifa-logo.png" alt="Aeropuerto Internacional Felipe Ángeles">
            </div>
            <h1 class="conci-rep-h1">${escapar(titulo)}</h1>
            ${subtitulo ? `<p class="conci-rep-actualizacion">${subtitulo}</p>` : ''}
            ${cuerpo}
            <p class="conci-rep-nota"><strong>Nota:</strong> ${NOTA}</p>
        </div>`;
    }

    /* ── Reporte 1: Subsecretaría (carga) ───────────────────────────────── */

    function renderSubsecretaria(datos) {
        const { sub, cierres, anioSub, mesSub } = datos;
        // El acumulado del mes nombra un mes o los dos, según caigan las columnas.
        const corto = iso => MES_CORTO[Number(iso.slice(5, 7)) - 1];
        const mesesDelOficio = corto(cierres.anterior) === corto(cierres.actual)
            ? corto(cierres.actual) : `${corto(cierres.anterior)} / ${corto(cierres.actual)}`;
        const aniosDelOficio = cierres.anterior.slice(0, 4) === cierres.actual.slice(0, 4)
            ? cierres.actual.slice(0, 4) : `${cierres.anterior.slice(0, 4)} / ${cierres.actual.slice(0, 4)}`;

        const dia = sub.actual.dia;
        const tDia = totales(dia);

        const dinamica = `
            <table class="conci-rep-pivote">
                <thead>
                    <tr><th class="conci-rep-pivote-titulo" colspan="4">Cuenta de AEROLINEA</th></tr>
                    <tr><th>Etiquetas de fila</th><th>INTERNACIONAL</th><th>NACIONAL</th><th>Total general</th></tr>
                </thead>
                <tbody>
                    ${['LLEGADA', 'SALIDA'].map(carril => `
                        <tr>
                            <td>${carril}</td>
                            <td class="num">${entero(dia[carril].INTERNACIONAL.ops)}</td>
                            <td class="num">${entero(dia[carril].NACIONAL.ops)}</td>
                            <td class="num">${entero(dia[carril].INTERNACIONAL.ops + dia[carril].NACIONAL.ops)}</td>
                        </tr>`).join('')}
                    <tr class="conci-rep-pivote-total">
                        <td>Total general</td>
                        <td class="num">${entero(tDia.internacional.ops)}</td>
                        <td class="num">${entero(tDia.nacional.ops)}</td>
                        <td class="num">${entero(tDia.total.ops)}</td>
                    </tr>
                </tbody>
            </table>`;

        const kilos = `
            <table class="conci-rep-pivote">
                <thead>
                    <tr><th class="conci-rep-pivote-titulo" colspan="4">Kilogramos del cierre</th></tr>
                    <tr><th>Concepto</th><th>LLEGADA</th><th>SALIDA</th><th>Total general</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Importación / Exportación</td>
                        <td class="num">${entero(dia.LLEGADA.INTERNACIONAL.kg)}</td>
                        <td class="num">${entero(dia.SALIDA.INTERNACIONAL.kg)}</td>
                        <td class="num">${entero(tDia.internacional.kg)}</td>
                    </tr>
                    <tr>
                        <td>Carga nacional NLU</td>
                        <td class="num">${entero(dia.LLEGADA.NACIONAL.kg)}</td>
                        <td class="num">${entero(dia.SALIDA.NACIONAL.kg)}</td>
                        <td class="num">${entero(tDia.nacional.kg)}</td>
                    </tr>
                    <tr class="conci-rep-pivote-total">
                        <td>Total general</td>
                        <td class="num">${entero(tDia.llegada.kg)}</td>
                        <td class="num">${entero(tDia.salida.kg)}</td>
                        <td class="num">${entero(tDia.total.kg)}</td>
                    </tr>
                </tbody>
            </table>`;

        const apartados = [
            ['', 'dia'],
            [`A. Acumulado del mes ${mesesDelOficio}:`, 'mes'],
            [`B. Acumulado en el año ${aniosDelOficio}:`, 'anio'],
            ['C. Acumulado desde el inicio de operaciones AIFA:', 'historico']
        ];

        const bloque = (etiqueta, alcance) => {
            const lados = ['anterior', 'actual'].map(clave => {
                const t = totales(sub[clave][alcance]);
                const ton = toneladas(sub[clave][alcance]);
                return { t, ton };
            });
            const trio = (d, campo) => campo === 'ton'
                ? `<td class="num">${entero(d.ton.enteras.total)}</td>
                   <td class="num">${entero(d.ton.enteras.nacional)}</td>
                   <td class="num">${entero(d.ton.enteras.internacional)}</td>`
                : `<td class="num">${entero(d.t.total.ops)}</td>
                   <td class="num">${entero(d.t.nacional.ops)}</td>
                   <td class="num">${entero(d.t.internacional.ops)}</td>`;
            return `
            ${etiqueta ? `<p class="conci-rep-sub-apartado">${escapar(etiqueta)}</p>` : ''}
            <table class="conci-rep-oficio${alcance === 'dia' ? ' conci-rep-oficio-hoy' : ''}">
                <thead>
                    <tr>
                        <th></th>
                        <th class="conci-rep-oficio-fecha" colspan="3">${fechaLarga(cierres.anterior)}</th>
                        <th class="conci-rep-oficio-fecha" colspan="3">${fechaLarga(cierres.actual)}</th>
                    </tr>
                    <tr>
                        <th></th>
                        <th>Dato</th><th>Nacional</th><th>Internacional</th>
                        <th>Dato</th><th>Nacional</th><th>Internacional</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td class="rot">a. Carga (ton):</td>${trio(lados[0], 'ton')}${trio(lados[1], 'ton')}</tr>
                    <tr><td class="rot">b. Operaciones:</td>${trio(lados[0], 'ops')}${trio(lados[1], 'ops')}</tr>
                </tbody>
            </table>`;
        };

        const aviso = tDia.total.kg + tDia.total.ops === 0
            ? `<p class="conci-rep-aviso">No hay manifiestos de carga con CIERRE SUBSECRETARIA del
                 ${fechaLarga(cierres.actual)}. Revisa que la captura de ese día esté cerrada.</p>`
            : '';

        const cuerpo = `
            ${aviso}
            <div class="conci-rep-sub-rejilla">
                <div class="conci-rep-sub-izq">
                    <p class="conci-rep-filtro">CIERRE SUBSECRETARÍA <strong>${fechaLarga(cierres.actual)}</strong></p>
                    ${dinamica}
                    ${kilos}
                </div>
                <div class="conci-rep-sub-der">
                    <p class="conci-rep-sub-intro">Se envía la información correspondiente (carga) al:</p>
                    ${apartados.map(([e, a]) => bloque(e, a)).join('')}
                </div>
            </div>`;

        return hoja(`REPORTE DE CARGA A LA SUBSECRETARÍA ${MESES[mesSub - 1]} ${anioSub}`, '', cuerpo, true);
    }

    /* ── Reporte 2: Hoja 1 — numeralia por aerolínea ────────────────────── */

    function renderHoja1(datos) {
        const filas = filasHoja1(datos);
        const totOps = filas.reduce((a, f) => a + f.ops, 0);
        const totTon = filas.reduce((a, f) => a + f.ton, 0);
        const cuerpo = filas.length
            ? filas.map(f => `
                <tr>
                    <td class="conci-rep-aero">${escapar(f.aerolinea)}</td>
                    <td class="num">${entero(f.ops)}</td>
                    <td class="num">${dosDec(f.ton)}</td>
                </tr>`).join('')
            : '<tr><td colspan="3" class="conci-rep-vacia">Sin manifiestos de carga en el periodo.</td></tr>';

        return hoja(
            `CARGA POR AEROLÍNEA ${datos.anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(datos.fechaIso)}</u></strong>`,
            `<table class="conci-rep-plantilla conci-rep-p1">
                <thead><tr><th>AEROLÍNEA</th><th>OPERACIONES</th><th>CARGA EN TONELADAS</th></tr></thead>
                <tbody>${cuerpo}</tbody>
                <tfoot>
                    <tr class="conci-rep-fila-total">
                        <td>TOTAL</td>
                        <td class="num"><u>${entero(totOps)}</u></td>
                        <td class="num"><u>${dosDec(totTon)}</u></td>
                    </tr>
                </tfoot>
            </table>`
        );
    }

    /* ── Reporte 3: Hoja 2 — tarjetas con logotipo ─────────────────────── */

    /** Logotipo de una aerolínea fuera del catálogo: el mismo que usa el resto de la app. */
    function logosDeLaApp(nombre) {
        try {
            return typeof window.getAirlineLogoCandidates === 'function'
                ? (window.getAirlineLogoCandidates(nombre) || []) : [];
        } catch (_) { return []; }
    }

    function tarjetaHtml({ nombre, logos, ops, ton }) {
        const [primero, ...resto] = logos || [];
        const logo = primero
            ? `<img src="${escapar(primero)}" alt="${escapar(nombre)}" loading="lazy"${resto.length
                ? ` data-cands="${escapar(logos.join('|'))}" data-cand-idx="0" onerror="window.handleLogoError && window.handleLogoError(this)"`
                : ''}>`
            : `<span>${escapar(nombre)}</span>`;
        return `<div class="cc-tarjeta" title="${escapar(nombre)}">
                <div class="cc-logo">${logo}</div>
                <dl class="cc-cifras">
                    <dt>No. de operaciones</dt><dd>${escapar(ops)}</dd>
                    <dt>Total de carga en Tn.</dt><dd>${escapar(ton)}</dd>
                </dl>
            </div>`;
    }

    /**
     * La Hoja 2 del libro es la maqueta de las diapositivas 3 a 6: las mismas
     * tarjetas, en los mismos grupos y con el mismo logotipo. Una aerolínea sin
     * operaciones en el periodo lleva la tarjeta en blanco, como en la original.
     */
    function renderHoja2(datos) {
        const modelo = modeloPresentacion(datos);
        const grupos = [3, 4, 5, 6].map(n => `
            <section class="cc-grupo">
                <h2 class="cc-grupo-titulo">${escapar(CAT().TARJETAS[n].titulo)}</h2>
                <div class="cc-tarjetas">${modelo.tarjetas[n].map(t => tarjetaHtml({ ...t, logos: [t.logo] })).join('')}</div>
            </section>`).join('');
        const otras = modelo.sinCatalogo.length ? `
            <section class="cc-grupo">
                <h2 class="cc-grupo-titulo">Otras aerolíneas con manifiestos de carga</h2>
                <p class="conci-rep-aviso">No están en el catálogo de la presentación, así que sus cifras no salen
                    en ninguna tarjeta de la baraja; sí cuentan en los totales.</p>
                <div class="cc-tarjetas">${modelo.sinCatalogo.map(s => tarjetaHtml({
                    nombre: s.nombre, logos: logosDeLaApp(s.nombre),
                    ops: entero(s.ops), ton: dosDec(CAT().trunc2(s.kg))
                })).join('')}</div>
            </section>` : '';
        return hoja(
            `TARJETAS POR AEROLÍNEA ${datos.anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(datos.fechaIso)}</u></strong>`,
            grupos + otras,
            true
        );
    }

    /* ── Reporte 4: Reporte de Carga — concentrado del año ──────────────── */

    function renderReporteCarga(datos) {
        const { porMes, anio, fechaIso } = datos;

        const tabla = (titulo, llegada, salida) => {
            const filas = porMes.map((m, i) => {
                const l = llegada(m), s = salida(m);
                const hay = l || s;
                return `<tr${hay ? '' : ' class="conci-rep-sin-datos"'}>
                    <td>${MESES[i]}</td>
                    <td class="num">${hay ? entero(l) : '—'}</td>
                    <td class="num">${hay ? entero(s) : '—'}</td>
                    <td class="num">${hay ? entero(l + s) : '—'}</td>
                </tr>`;
            }).join('');
            const tl = porMes.reduce((a, m) => a + llegada(m), 0);
            const ts = porMes.reduce((a, m) => a + salida(m), 0);
            return `
            <table class="conci-rep-plantilla conci-rep-p2">
                <thead>
                    <tr><th class="conci-rep-banda" colspan="4">${titulo}</th></tr>
                    <tr class="conci-rep-subcabecera"><th>MES</th><th>LLEGADA</th><th>SALIDA</th><th>SUBTOTAL</th></tr>
                </thead>
                <tbody>${filas}</tbody>
                <tfoot>
                    <tr class="conci-rep-fila-total">
                        <td>TOTAL</td>
                        <td class="num"><u>${entero(tl)}</u></td>
                        <td class="num"><u>${entero(ts)}</u></td>
                        <td class="num"><u>${entero(tl + ts)}</u></td>
                    </tr>
                </tfoot>
            </table>`;
        };

        const cuerpo = `
            <div class="conci-rep-p2-rejilla">
                ${tabla('CARGA INTERNACIONAL KG', m => m.impKg, m => m.expKg)}
                ${tabla('OPERACIONES INTERNACIONALES', m => m.opsIntLlegada, m => m.opsIntSalida)}
            </div>
            <p class="conci-rep-aclaracion"><strong>NOTA:</strong> No se consideran operaciones mixtas.</p>`;

        return hoja(
            `REPORTE DE CARGA ${anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(fechaIso)}</u></strong>`,
            cuerpo,
            true
        );
    }

    /* ── Reporte 5: la presentación ─────────────────────────────────────── */

    const capital = s => s.charAt(0) + s.slice(1).toLowerCase();

    /**
     * Todo lo que lleva la baraja, ya con formato. La misma pieza alimenta la
     * vista en pantalla, la Hoja 2 y el .pptx, así que los tres dicen lo mismo.
     *
     * CARGA <año> va hasta el día anterior al corte y el renglón "Carga <fecha>"
     * es ese día: así los suma el libro (10,471 + 51 = 10,522). Las toneladas
     * por aerolínea se truncan a dos decimales y el total es la suma de las
     * truncadas, como la columna O de la Hoja 1.
     */
    function modeloPresentacion(datos) {
        const C = CAT();
        const { anio, mes, fechaIso, anioActual, delDia } = datos;
        const { catalogo, sinCatalogo } = C.cifras(datos.porAerolinea);
        const ton = kg => C.trunc2(kg);
        const total = {
            ops: anioActual.ops,
            ton: [...catalogo.values()].reduce((a, v) => a + ton(v.kg), 0) + sinCatalogo.reduce((a, v) => a + ton(v.kg), 0)
        };
        const dia = { ops: delDia.ops, ton: Math.round(delDia.kg / 10) / 100 };

        const anios = C.BASE_HISTORICA.filter(b => b.anio < anio)
            .map(b => ({ etiqueta: `CARGA ${b.anio}`, ops: b.ops, ton: b.ton }));
        anios.push({ etiqueta: `CARGA ${anio}`, ops: total.ops - dia.ops, ton: total.ton - dia.ton });
        const acumulado = {
            ops: anios.reduce((a, x) => a + x.ops, 0) + dia.ops,
            ton: anios.reduce((a, x) => a + x.ton, 0) + dia.ton
        };

        const conteos = C.conteos();
        const texto = {
            MES_ANIO: `${capital(MESES[mes - 1])} ${anio}`,
            DIA: fechaIso.slice(8, 10),
            MES_CORTO_ANIO: `${MES_CORTO[mes - 1]} ${anio}`,
            N_REGULAR: String(conteos.regular),
            N_FLETAMENTO: String(conteos.fletamento),
            N_MIXTA: String(conteos.mixta),
            DIA_FECHA: fechaLarga(fechaIso), DIA_OPS: entero(dia.ops), DIA_TON: dosDec(dia.ton),
            ACUM_OPS: entero(acumulado.ops), ACUM_TON: dosDec(acumulado.ton),
            H1_OPS_TOTAL: entero(total.ops), H1_TON_TOTAL: dosDec(total.ton)
        };
        anios.forEach((x, i) => {
            texto[`ANIO_${i + 1}_ETQ`] = x.etiqueta;
            texto[`ANIO_${i + 1}_OPS`] = entero(x.ops);
            texto[`ANIO_${i + 1}_TON`] = dosDec(x.ton);
        });
        const cifrasDe = nombre => {
            const v = catalogo.get(nombre);
            return v && v.hay ? { ops: entero(v.ops), ton: dosDec(ton(v.kg)) } : { ops: '', ton: '' };
        };
        const filas = C.AEROLINEAS.map((a, i) => {
            const c = cifrasDe(a.nombre);
            texto[`H1_OPS_${i + 1}`] = c.ops;
            texto[`H1_TON_${i + 1}`] = c.ton;
            return { nombre: a.nombre, grupo: a.grupo, ...c };
        });
        const tarjetas = {};
        for (const n of [3, 4, 5, 6]) {
            tarjetas[n] = C.TARJETAS[n].nombres.map(nombre => ({ nombre, logo: C.logoDe(nombre), ...cifrasDe(nombre) }));
        }
        return { texto, anios: anios.length, filas, tarjetas, sinCatalogo, resumen: { anios, dia, acumulado, total } };
    }

    /* Vista en pantalla: cada diapositiva es un lienzo de 10 × 7.5 pulgadas y
       cada pieza se coloca con las coordenadas que tiene en la baraja. Los
       tamaños de letra van en cqw para que escalen con el ancho del lienzo. */
    const RECURSOS = 'images/presentacion-carga/';
    const caja = (x, y, w, h) => `left:${(x * 10).toFixed(3)}%;top:${(y / 7.5 * 100).toFixed(3)}%;`
        + `width:${(w * 10).toFixed(3)}%;height:${(h / 7.5 * 100).toFixed(3)}%`;
    const pt = n => `font-size:${(n * 100 / 720).toFixed(3)}cqw`;
    const img = (src, x, y, w, h) => `<img class="cp-img" src="${RECURSOS}${src}" alt="" style="${caja(x, y, w, h)}">`;
    // Un solo hijo: si el texto, sus <b> y sus <br> quedaran sueltos, cada uno
    // sería un renglón del contenedor flexible y los <br> abrirían líneas en blanco.
    const txt = (x, y, w, h, html, estilo = '') => `<div class="cp-txt" style="${caja(x, y, w, h)};${estilo}">`
        + `<div class="cp-txt-in">${html}</div></div>`;
    const lamina = (n, html) => `<section class="cp-slide" aria-label="Diapositiva ${n}">${html}</section>`;
    const COLOR_ANIO = ['#BC945A', '#691B32', '#245C4F'];
    const COLOR_GRUPO = { regular: '#B4C6E7', mixta: '#C6E0B4', fletamento: '#FFE699' };

    function renderPresentacion(datos) {
        const m = modeloPresentacion(datos);
        const t = m.texto;
        const C = CAT();
        const P = window.ConciPresentacionCarga;

        const cabecera = `${img('fondo.svg', 0, 0, 10.04, 7.5)}${img('encabezado.svg', -0.02, 0, 10.04, 1.76)}`
            + `${img('avion.jpg', 4.90, 0.92, 5.10, 1.34)}${img('logo-defensa.svg', 7.18, 0.33, 2.29, 0.57)}`;

        const tarjetas = n => {
            const cuad = P.CUADRICULAS[n];
            return m.tarjetas[n].map((c, i) => {
                const { renglon, columna } = P.posicion(cuad, i);
                const x = cuad.columnas[columna];
                const y = cuad.tops[renglon];
                return `<div class="cp-logo" style="${caja(x, y - cuad.logoAlto - 0.02, cuad.ancho, cuad.logoAlto)}">`
                    + `<img src="${escapar(c.logo)}" alt="${escapar(c.nombre)}" loading="lazy"></div>`
                    + `<div class="cp-card" style="${caja(x, y, cuad.ancho, cuad.alto)};${pt(cuad.puntos)}">`
                    + `<span>No. de operaciones</span><b>${escapar(c.ops)}</b>`
                    + `<span>Total de carga en Tn.</span><b>${escapar(c.ton)}</b></div>`;
            }).join('');
        };
        const laminaTarjetas = n => lamina(n, cabecera
            + txt(0.30, 0.30, 6.10, 0.95, `<b>${escapar(C.TARJETAS[n].titulo)}</b>`, `${pt(24)};text-align:center`)
            + tarjetas(n));

        const tablaCatalogo = (lista, tipo, puntos) => `
            <table class="cp-tabla cp-catalogo" style="${pt(puntos)}"><colgroup><col style="width:5%"><col style="width:44%"><col style="width:25.5%"><col style="width:25.5%"></colgroup>
                <thead><tr><th>No.</th><th>Aerolínea</th><th>Tipo de operación</th><th>Situación actual</th></tr></thead>
                <tbody>${lista.map((n, i) => `<tr><td>${i + 1}</td><td>${escapar(n)}</td>${i === 0
                    ? `<td rowspan="${lista.length}">${tipo}</td><td rowspan="${lista.length}">Operando</td>` : ''}</tr>`).join('')}
                </tbody>
            </table>`;

        const slides = [
            lamina(1, img('fondo-portada.svg', -0.02, -1.27, 10.02, 10.02)
                + img('franja-vino.svg', -0.02, 7.35, 10.04, 0.15)
                + img('ilustracion.png', 0, 1.33, 5.00, 6.05)
                + img('alas-aifa.png', 6.70, 1.33, 2.06, 1.26)
                + txt(5.73, 2.47, 4.05, 0.91, 'Aeropuerto Internacional<br><b>“Felipe Ángeles”</b>', `${pt(24)};text-align:center`)
                + img('linea-dorada.png', 5.50, 3.74, 4.52, 0.05)
                + img('logo-defensa.svg', 6.18, 4.67, 3.10, 0.77)
                + img('recuadro-fecha.svg', 6.14, 6.30, 3.87, 0.68)
                + txt(7.08, 6.42, 2.63, 0.44, escapar(t.MES_ANIO), `${pt(20)};text-align:right`)),

            lamina(2, img('fondo.svg', 0, 0.02, 10, 7.5)
                + txt(0.28, 0.17, 4.50, 0.67, `<b>Operaciones en la Terminal de Carga</b><br>01 Ene. al ${escapar(t.DIA)} ${escapar(t.MES_CORTO_ANIO)}`,
                    `${pt(17)};text-align:center`)
                + img('linea-dorada.png', 0.42, 0.81, 4.20, 0.06)
                + `<div class="cp-abs" style="${caja(1.55, 1.17, 2.27, 0.92)}"><table class="cp-tabla cp-t1" style="${pt(12)}"><colgroup><col style="width:40%"><col style="width:60%"></colgroup>
                    <tr><th colspan="2">OPERANDO ACTUALMENTE</th></tr>
                    <tr><td style="background:${COLOR_GRUPO.regular}">${t.N_REGULAR}</td><td><b>CARGA REGULAR</b></td></tr>
                    <tr><td style="background:${COLOR_GRUPO.fletamento}">${t.N_FLETAMENTO}</td><td><b>FLETAMENTO</b></td></tr>
                    <tr><td style="background:${COLOR_GRUPO.mixta}">${t.N_MIXTA}</td><td><b>CARGA MIXTA</b></td></tr>
                </table></div>`
                + `<div class="cp-abs" style="${caja(0.70, 2.35, 4.36, 1.40)}"><table class="cp-tabla cp-t9" style="${pt(12)}"><colgroup><col style="width:36.5%"><col style="width:39.5%"><col style="width:24%"></colgroup>
                    <tr><th></th><th>OPERACIONES</th><th>TONELADAS</th></tr>
                    ${m.resumen.anios.map((x, i) => `<tr><td class="cp-etq" style="background:${COLOR_ANIO[i % 3]}">${escapar(x.etiqueta)}</td>
                        <td>${entero(x.ops)}</td><td>${dosDec(x.ton)}</td></tr>`).join('')}
                    <tr><td class="cp-etq" style="background:#305496">Carga ${escapar(t.DIA_FECHA)}</td><td>${t.DIA_OPS}</td><td>${t.DIA_TON}</td></tr>
                    <tr class="cp-acum"><td>ACUMULADO</td><td>${t.ACUM_OPS}</td><td>${t.ACUM_TON}</td></tr>
                </table></div>`
                + `<div class="cp-abs" style="${caja(0.83, 4.23, 3.90, 1.11)}"><table class="cp-tabla cp-t19" style="${pt(12)}"><colgroup><col style="width:52.3%"><col style="width:47.7%"></colgroup>
                    <tr><th colspan="2" class="cp-titulo-tabla">AEROLÍNEAS QUE OPERAN AERONAVES BAJO LA FIGURA DE ARRENDAMIENTO HÚMEDO <b>(WET LEASE)</b></th></tr>
                    <tr><th>AEROLÍNEA</th><th>ARRENDADOR</th></tr>
                    ${C.WET_LEASE.map(([a, b]) => `<tr><td>${escapar(a)}</td><td>${escapar(b)}</td></tr>`).join('')}
                </table></div>`
                + img('avion-frente.jpg', -0.03, 5.50, 5.43, 1.84)
                + `<div class="cp-abs" style="${caja(5.40, 0.29, 4.33, 7.00)}"><table class="cp-tabla cp-t3" style="${pt(7)}"><colgroup><col style="width:39.8%"><col style="width:24.8%"><col style="width:35.4%"></colgroup>
                    <tr><th>AEROLÍNEA</th><th>OPERACIONES</th><th>CARGA EN TONELADAS</th></tr>
                    ${m.filas.map(f => `<tr><td style="background:${COLOR_GRUPO[f.grupo]}">${escapar(f.nombre)}</td>
                        <td>${escapar(f.ops)}</td><td>${escapar(f.ton)}</td></tr>`).join('')}
                    <tr class="cp-acum"><td>TOTAL</td><td>${t.H1_OPS_TOTAL}</td><td>${t.H1_TON_TOTAL}</td></tr>
                </table></div>`),

            laminaTarjetas(3), laminaTarjetas(4), laminaTarjetas(5), laminaTarjetas(6),

            lamina(7, img('fondo.svg', 0.02, 0.18, 10, 7.5) + img('encabezado.svg', -0.02, 0, 10.04, 1.76)
                + img('logo-defensa.svg', 7.18, 0.33, 2.29, 0.57)
                + img('avion-frente.jpg', 1.04, 4.84, 7.91, 2.68)
                + `<div class="cp-marco" style="${caja(0.87, 1.53, 3.10, 4.16)}"></div>`
                + `<div class="cp-marco" style="${caja(6.03, 1.53, 3.10, 4.16)}"></div>`
                + img('icono-avion.png', 1.91, 1.94, 1.02, 1.02)
                + img('icono-carga.png', 7.11, 1.83, 1.02, 1.02)
                + txt(0.87, 3.05, 3.10, 0.75, '<b>Total de operaciones</b>', `${pt(24)};text-align:center;color:#6F7271`)
                + txt(6.03, 2.85, 3.10, 1.00, '<b>Total de carga transportada (tons.)</b>', `${pt(24)};text-align:center;color:#6F7271`)
                + `<div class="cp-cifra" style="${caja(1.04, 3.93, 2.67, 0.79)};${pt(32)}">${t.ACUM_OPS}</div>`
                + `<div class="cp-cifra" style="${caja(6.28, 3.93, 2.67, 0.79)};${pt(32)}">${t.ACUM_TON}</div>`
                + txt(0.80, 0.22, 6.13, 0.91, '<b>Cifras acumuladas desde el inicio de operaciones de la Terminal de Carga:</b>', pt(24))),

            lamina(8, img('fondo.svg', 0, 0.02, 10, 7.5) + img('logo-defensa.svg', 7.18, 0.33, 2.29, 0.57)
                + txt(0.52, 0.28, 5.24, 1.04, '<b>Aerolíneas de carga que operan en el AIFA</b>', pt(28))
                + `<div class="cp-abs" style="${caja(0.57, 1.59, 8.87, 4.46)}">${tablaCatalogo(C.RAZONES.regular,
                    '<b>Regular</b> con contrato de Servicios Aeroportuarios', 12)}</div>`
                + txt(0.52, 6.10, 8.87, 0.57, 'Las aerolíneas <b>Volaris, Conviasa, Mexicana, Viva Aerobús y Aeroméxico</b> '
                    + 'realizan operaciones mixtas <b>(pasajeros y carga)</b>.', `${pt(14)};color:#000;text-align:justify`)),

            lamina(9, img('fondo.svg', 0, 0.02, 10, 7.5) + img('logo-defensa.svg', 7.18, 0.18, 2.29, 0.57)
                + txt(0.20, 0.27, 6.89, 0.50, '<b>Aerolíneas de carga que operan en el AIFA</b>', pt(24))
                + `<div class="cp-abs" style="${caja(0.20, 0.79, 9.61, 6.31)}">${tablaCatalogo(C.RAZONES.fletamento,
                    '<b>Fletamento de Carga,</b><br>(no necesitan contrato)', 9.5)}</div>`),

            lamina(10, img('recuadro-fecha.svg', 0, 2.69, 6.13, 1.49) + img('fondo.svg', 0, 0.02, 10, 7.5)
                + txt(0.80, 2.99, 4.91, 0.67, 'GRACIAS', pt(34))
                + img('logo-defensa.svg', 0.48, 5.59, 2.93, 0.73)
                + img('ilustracion.png', 3.81, 1.07, 5.92, 6.27))
        ];

        const aviso = m.sinCatalogo.length
            ? `<p class="conci-rep-aviso">Hay aerolíneas con manifiestos de carga que no están en el catálogo de la
                presentación: ${m.sinCatalogo.map(s => `${escapar(s.nombre)} (${entero(s.ops)} op.)`).join(', ')}.
                Cuentan en los totales, pero no tienen renglón ni tarjeta propios.</p>`
            : '';
        return `${aviso}<div class="cp-baraja" id="conci-rep-hoja">${slides.join('')}</div>`;
    }

    const RENDERS = {
        subsecretaria: renderSubsecretaria,
        hoja1: renderHoja1,
        hoja2: renderHoja2,
        reportecarga: renderReporteCarga,
        presentacion: renderPresentacion
    };

    /* ── orquestación ───────────────────────────────────────────────────── */

    function pintar() {
        const salida = el('conci-rep-carga-salida');
        if (!salida || !ultimo) return;
        salida.innerHTML = (RENDERS[reporteActivo] || renderSubsecretaria)(ultimo);
    }

    function mostrar(datos) { ultimo = datos; pintar(); }

    const estado = t => { const e = el('conci-rep-carga-estado'); if (e) e.textContent = t || ''; };

    function error(mensaje) {
        const e = el('conci-rep-carga-error');
        if (!e) return;
        e.classList.toggle('d-none', !mensaje);
        e.textContent = mensaje || '';
    }

    async function generar() {
        const campo = el('conci-rep-carga-fecha');
        const fechaIso = campo && campo.value;
        if (!fechaIso) { error('Elige la fecha del reporte.'); return; }
        const boton = el('btn-conci-rep-carga-generar');
        if (boton) boton.disabled = true;
        error('');
        estado('Leyendo manifiestos…');
        try {
            if (typeof window._ensureConciAirlineCatalog === 'function') {
                try { await window._ensureConciAirlineCatalog(); } catch (_) {}
            }
            const datos = await descargar(fechaIso, n => estado(`Leyendo manifiestos… ${entero(n)}`));
            ultimo = agregar(datos, fechaIso);
            pintar();
            const pax = ultimo.descartadosPax ? ` · ${entero(ultimo.descartadosPax)} de pasajeros descartados` : '';
            estado(`${entero(ultimo.totalFilas)} manifiestos leídos${pax}`);
        } catch (e) {
            console.error('[Reportes Carga]', e);
            error(`No se pudieron calcular los reportes: ${e.message || e}`);
            estado('');
        } finally {
            if (boton) boton.disabled = false;
        }
    }

    function elegirReporte(clave, boton) {
        reporteActivo = clave;
        document.querySelectorAll('[data-conci-rep-carga]')
            .forEach(b => b.classList.toggle('active', b === boton));
        // Solo la presentación se imprime y se descarga.
        const esPresentacion = clave === 'presentacion';
        el('btn-conci-rep-carga-imprimir')?.classList.toggle('d-none', !esPresentacion);
        el('btn-conci-rep-carga-descargar')?.classList.toggle('d-none', !esPresentacion);
        pintar();
    }

    /* ── imprimir y descargar (solo la presentación) ────────────────────── */

    function imprimir() {
        if (!ultimo) { error('Genera la presentación antes de imprimirla.'); return; }
        document.body.classList.add('conci-rep-imprimiendo');
        const limpiar = () => document.body.classList.remove('conci-rep-imprimiendo');
        window.addEventListener('afterprint', limpiar, { once: true });
        try { window.print(); } finally { setTimeout(limpiar, 1500); }
    }

    const nombreArchivo = base => String(base).replace(/[\\/:*?"<>|]/g, '-');

    /** Lee un archivo del sitio: la plantilla y los logotipos. */
    async function leerDelSitio(ruta) {
        const r = await fetch(ruta, { cache: 'force-cache' });
        if (!r.ok) throw new Error(`No se pudo leer ${ruta} (${r.status})`);
        return r.arrayBuffer();
    }

    /**
     * Descarga la baraja armada sobre la plantilla original: los mismos fondos,
     * fuentes y logotipos, con las cifras del periodo en su lugar.
     */
    async function descargarPptx() {
        if (!ultimo) { error('Genera la presentación antes de descargarla.'); return; }
        const P = window.ConciPresentacionCarga;
        if (!P || !window.JSZip) { error('No se pudo cargar el generador de la presentación.'); return; }
        const boton = el('btn-conci-rep-carga-descargar');
        if (boton) boton.disabled = true;
        try {
            estado('Armando la presentación…');
            const modelo = modeloPresentacion(ultimo);
            const bytes = await P.construir({ JSZip: window.JSZip, cargar: leerDelSitio }, modelo);
            const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const { anio, mes, fechaIso } = ultimo;
            a.href = url;
            a.download = nombreArchivo(`PRESENTACION CARGA ${fechaIso.slice(8, 10)} ${MESES[mes - 1]} ${anio}.pptx`);
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            estado(modelo.sinCatalogo.length
                ? `Presentación descargada · ${modelo.sinCatalogo.length} aerolínea(s) fuera del catálogo`
                : 'Presentación descargada.');
        } catch (e) {
            console.error('[Reportes Carga] descarga', e);
            error(`No se pudo generar la presentación: ${e.message || e}`);
        } finally {
            if (boton) boton.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const campo = el('conci-rep-carga-fecha');
        if (campo && !campo.value) {
            const hoy = new Date();
            campo.value = `${hoy.getFullYear()}-${dosDigitos(hoy.getMonth() + 1)}-${dosDigitos(hoy.getDate())}`;
        }
        el('btn-conci-rep-carga-generar')?.addEventListener('click', generar);
        el('btn-conci-rep-carga-imprimir')?.addEventListener('click', imprimir);
        el('btn-conci-rep-carga-descargar')?.addEventListener('click', descargarPptx);
        campo?.addEventListener('change', () => { cache = null; });
        document.querySelectorAll('[data-conci-rep-carga]').forEach(boton => {
            boton.addEventListener('click', () => elegirReporte(boton.dataset.conciRepCarga, boton));
        });
    });

    window.conciReportesCarga = {
        generar, agregar, mostrar, imprimir,
        descargar: descargarPptx,
        filasHoja1, totales, toneladas, repartirEnteros, modeloPresentacion,
        aIso, nombreAerolinea
    };
})();