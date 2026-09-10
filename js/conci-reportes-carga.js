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
                    por mes, con la columna del último día del mes anterior y
                    la del día 1 del mes pedido. Operaciones = cuenta de
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

    /* Colores institucionales de la baraja original (ppt/theme + diapositiva 2). */
    const VINO = '#691B32';
    const DORADO = '#BC945A';

    /**
     * Catálogo de aerolíneas de carga tal como aparece en las diapositivas 8 y
     * 9. No sale de los manifiestos: es la situación contractual de cada una,
     * y de aquí salen los conteos de "OPERANDO ACTUALMENTE".
     */
    const CATALOGO = {
        regular: [
            'Cathay Pacific Airways Limited', 'Turk Hava YOralli., A.O. (Turkish)',
            'DHL Guatemala, S.A.', 'Estafeta Carga Aérea, S.A. de C.V.',
            'Societe Air France', 'Cargolux Airlines International, S.A.',
            'DHL Express México, S.A. de C.V. (Cargojet)', 'Emirates',
            'Aerotransportes Mas de Carga S.A. de C.V. (Mas Air)',
            'Lufthansa Cargo Aktiengesellschaft',
            'Aero Transportes de Carga Unión, S.A. de C.V.',
            'Amerijet International Inc.', 'Qatar Airways Company Q.C.S.C.',
            'United Parcel Service CO.', 'TM Aerolíneas, S.A. de C.V. (Awesome Cargo)',
            'Air Canadá', 'Aeronaves T S M, S.A. de C.V.',
            'La Nueva Aerolínea, S.A. (Copa Cargo)'
        ],
        fletamento: [
            'Absa Aerolinhas Brasileiras', 'ABX Air', 'Air China', 'Atlas Air Inc',
            'Berry Aviation', 'China Southern Airlines', 'Kalitta Air',
            'Ethiopian Cargo', 'Federal Express Corporation', 'Galistair Trading Limited',
            'National Air Cargo', 'Silway West Airlines', 'Sky Lease Cargo',
            'Ukraine Air Alliance', 'Western Global Airlines', 'Lan Cargo',
            'Mcnelly Charter', 'Usa Jet', 'Lynden Air Cargo', 'Air Express',
            'Everts Air Cargo', 'Kalitta Charters', 'Aero Sucre, S.A.',
            'Uniworld Air Cargo', 'Latam Cargo', 'Aerolíneas Argentinas Cargo',
            'Global Crossing Airlines', 'Saudía Cargo', 'IFL Group',
            'Suparna Airlines', 'Legends Airways', 'Cavok Air',
            'China Cargo Airlines', 'Air Atlanta Europe', 'Ameristar Air Cargo'
        ],
        mixtas: ['Aeroméxico', 'Conviasa', 'Mexicana', 'Viva Aerobus', 'Volaris']
    };

    /** Arrendamiento húmedo (wet lease), diapositiva 2. */
    const WET_LEASE = [['AEROUNION', 'AVIANCA CARGO'], ['MAS AIR', 'GALISTAIR']];

    /**
     * Años cerrados antes de que la operación viviera en este sistema. La
     * presentación los muestra como línea base y los suma al acumulado; no hay
     * manifiestos capturados de esos años con los que calcularlos.
     */
    const BASE_HISTORICA = [
        { anio: 2023, ops: 6661, ton: 186634.24 },
        { anio: 2024, ops: 15719, ton: 447455.68 },
        { anio: 2025, ops: 14830, ton: 406192.76 }
    ];

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
    const primerDia = (a, m) => `${a}-${dosDigitos(m)}-01`;
    const ultimoDiaMes = (a, m) => `${a}-${dosDigitos(m)}-${dosDigitos(diasDelMes(a, m))}`;
    const mesAnterior = (a, m) => (m === 1 ? { anio: a - 1, mes: 12 } : { anio: a, mes: m - 1 });

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

        // El oficio se arma por mes, igual que el de pasajeros.
        const cierresPresentes = new Set();
        if (columnas.cierre) {
            for (const f of filas) {
                const c = aIso(f[columnas.cierre]);
                if (c) cierresPresentes.add(c);
            }
        }
        let anioSub = anio, mesSub = mes, retrocedido = false;
        if (!cierresPresentes.has(primerDia(anioSub, mesSub))) {
            const previo = mesAnterior(anioSub, mesSub);
            anioSub = previo.anio; mesSub = previo.mes; retrocedido = true;
        }
        const previoASub = mesAnterior(anioSub, mesSub);
        const cierres = {
            anterior: ultimoDiaMes(previoASub.anio, previoASub.mes),
            actual: primerDia(anioSub, mesSub)
        };

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
                    const acc = porAerolinea.get(aerolinea) || { kg: 0, ops: 0 };
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
            sub, cierres, retrocedido, anioSub, mesSub,
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
        const { sub, cierres, retrocedido, anioSub, mesSub } = datos;
        const previo = mesAnterior(anioSub, mesSub);
        const corto = m => MES_CORTO[m - 1];

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
            [`A. Acumulado del mes ${corto(previo.mes)} / ${corto(mesSub)}:`, 'mes'],
            [`B. Acumulado en el año ${previo.anio === anioSub ? anioSub : `${previo.anio} / ${anioSub}`}:`, 'anio'],
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

        const aviso = retrocedido
            ? `<p class="conci-rep-aviso">El mes solicitado aún no tiene cierre capturado en el día 1.
                 Se entrega el mes anterior completo: ${escapar(MESES[mesSub - 1])} ${anioSub}.</p>`
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

    /* ── Reporte 3: Hoja 2 — tarjetas ───────────────────────────────────── */

    function tarjetas(filas) {
        if (!filas.length) return '<p class="conci-rep-vacia">Sin manifiestos de carga en el periodo.</p>';
        return `<div class="conci-carga-tarjetas">${filas.map(f => `
            <div class="conci-carga-tarjeta">
                <p class="conci-carga-tarjeta-nombre">${escapar(f.aerolinea)}</p>
                <dl>
                    <dt>No. de operaciones</dt><dd>${entero(f.ops)}</dd>
                    <dt>Total de carga en Tn.</dt><dd>${dosDec(f.ton)}</dd>
                </dl>
            </div>`).join('')}</div>`;
    }

    function renderHoja2(datos) {
        return hoja(
            `TARJETAS POR AEROLÍNEA ${datos.anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(datos.fechaIso)}</u></strong>`,
            tarjetas(filasHoja1(datos)),
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

    /** Las cifras de la diapositiva del resumen. */
    function resumenPresentacion(datos) {
        const anios = BASE_HISTORICA.map(b => ({ etiqueta: `CARGA ${b.anio}`, ops: b.ops, ton: b.ton }));
        anios.push({ etiqueta: `CARGA ${datos.anio}`, ops: datos.anioActual.ops, ton: datos.anioActual.kg / 1000 });
        const delDia = { etiqueta: `Carga ${fechaLarga(datos.fechaIso)}`, ops: datos.delDia.ops, ton: datos.delDia.kg / 1000 };
        const acumulado = {
            etiqueta: 'ACUMULADO',
            ops: anios.reduce((a, x) => a + x.ops, 0) + delDia.ops,
            ton: anios.reduce((a, x) => a + x.ton, 0) + delDia.ton
        };
        return { anios, delDia, acumulado };
    }

    function diapositiva(clase, contenido) {
        return `<section class="conci-ppt-slide ${clase}">${contenido}</section>`;
    }

    function renderPresentacion(datos) {
        const { anio, mes, fechaIso } = datos;
        const r = resumenPresentacion(datos);
        const filas = filasHoja1(datos);
        const porNombre = new Map(filas.map(f => [normaliza(f.aerolinea), f]));

        /** Busca las cifras de una aerolínea del catálogo entre lo capturado. */
        const cifras = nombre => {
            const clave = normaliza(nombreAerolinea(nombre));
            if (porNombre.has(clave)) return porNombre.get(clave);
            // El catálogo trae razones sociales; se intenta por la primera palabra.
            const corto = clave.split(/[ ,.(]/)[0];
            for (const [k, v] of porNombre) if (k.startsWith(corto) && corto.length > 3) return v;
            return { ops: 0, ton: 0 };
        };

        const tarjetasCatalogo = lista => `<div class="conci-carga-tarjetas conci-carga-tarjetas-ppt">${lista.map(nombre => {
            const c = cifras(nombre);
            return `<div class="conci-carga-tarjeta">
                <p class="conci-carga-tarjeta-nombre">${escapar(nombre)}</p>
                <dl>
                    <dt>No. de operaciones</dt><dd>${entero(c.ops)}</dd>
                    <dt>Total de carga en Tn.</dt><dd>${dosDec(c.ton)}</dd>
                </dl>
            </div>`;
        }).join('')}</div>`;

        const tablaCatalogo = (lista, tipo) => `
            <table class="conci-ppt-catalogo">
                <thead><tr><th>No.</th><th>Aerolínea</th><th>Tipo de operación</th><th>Situación actual</th></tr></thead>
                <tbody>${lista.map((n, i) => `
                    <tr>
                        <td class="num">${i + 1}</td>
                        <td>${escapar(n)}</td>
                        ${i === 0 ? `<td rowspan="${lista.length}">${escapar(tipo)}</td><td rowspan="${lista.length}">Operando</td>` : ''}
                    </tr>`).join('')}
                </tbody>
            </table>`;

        const slides = [
            diapositiva('conci-ppt-portada', `
                <img class="conci-ppt-logo" src="images/aifa-logo.png" alt="AIFA">
                <h2>Aeropuerto Internacional<br>“Felipe Ángeles”</h2>
                <p class="conci-ppt-fecha">${MESES[mes - 1].charAt(0)}${MESES[mes - 1].slice(1).toLowerCase()} ${anio}</p>`),

            diapositiva('conci-ppt-resumen', `
                <h3>Operaciones en la Terminal de Carga</h3>
                <p class="conci-ppt-periodo">01 Ene. al ${fechaLarga(fechaIso).slice(0, 2)} ${MES_CORTO[mes - 1]} ${anio}</p>
                <div class="conci-ppt-resumen-rejilla">
                    <div>
                        <p class="conci-ppt-etiqueta">OPERANDO ACTUALMENTE</p>
                        <table class="conci-ppt-mini">
                            <tbody>
                                <tr><td class="num">${CATALOGO.regular.length}</td><td>CARGA REGULAR</td></tr>
                                <tr><td class="num">${CATALOGO.fletamento.length}</td><td>FLETAMENTO</td></tr>
                                <tr><td class="num">${CATALOGO.mixtas.length}</td><td>CARGA MIXTA</td></tr>
                            </tbody>
                        </table>
                        <p class="conci-ppt-etiqueta">AEROLÍNEAS QUE OPERAN AERONAVES BAJO LA FIGURA DE ARRENDAMIENTO HÚMEDO (WET LEASE)</p>
                        <table class="conci-ppt-mini">
                            <thead><tr><th>AEROLÍNEA</th><th>ARRENDADOR</th></tr></thead>
                            <tbody>${WET_LEASE.map(([a, b]) => `<tr><td>${escapar(a)}</td><td>${escapar(b)}</td></tr>`).join('')}</tbody>
                        </table>
                    </div>
                    <div>
                        <table class="conci-ppt-cifras">
                            <thead><tr><th></th><th>OPERACIONES</th><th>TONELADAS</th></tr></thead>
                            <tbody>
                                ${r.anios.map(x => `<tr><td>${escapar(x.etiqueta)}</td><td class="num">${entero(x.ops)}</td><td class="num">${dosDec(x.ton)}</td></tr>`).join('')}
                                <tr class="conci-ppt-dia"><td>${escapar(r.delDia.etiqueta)}</td><td class="num">${entero(r.delDia.ops)}</td><td class="num">${dosDec(r.delDia.ton)}</td></tr>
                                <tr class="conci-ppt-acumulado"><td>${escapar(r.acumulado.etiqueta)}</td><td class="num">${entero(r.acumulado.ops)}</td><td class="num">${dosDec(r.acumulado.ton)}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>`),

            diapositiva('conci-ppt-tarjetas', `
                <h3>Aerolíneas que operan con un contrato de Servicios Aeroportuarios:</h3>
                ${tarjetasCatalogo(CATALOGO.regular)}`),

            diapositiva('conci-ppt-tarjetas', `
                <h3>Aerolíneas que operan en la modalidad de fletamento de carga:</h3>
                ${tarjetasCatalogo(CATALOGO.fletamento)}`),

            diapositiva('conci-ppt-tarjetas', `
                <h3>Aerolíneas que realizan operaciones mixtas (carga y pasajeros):</h3>
                ${tarjetasCatalogo(CATALOGO.mixtas)}`),

            diapositiva('conci-ppt-totales', `
                <h3>Cifras acumuladas desde el inicio de operaciones de la Terminal de Carga:</h3>
                <div class="conci-ppt-total-caja">
                    <p><span>Total de operaciones</span><strong>${entero(r.acumulado.ops)}</strong></p>
                    <p><span>Total de carga transportada (tons.)</span><strong>${dosDec(r.acumulado.ton)}</strong></p>
                </div>`),

            diapositiva('conci-ppt-catalogo-slide', `
                <h3>Aerolíneas de carga que operan en el AIFA</h3>
                ${tablaCatalogo(CATALOGO.regular, 'Regular con contrato de Servicios Aeroportuarios')}`),

            diapositiva('conci-ppt-catalogo-slide', `
                <h3>Aerolíneas de carga que operan en el AIFA</h3>
                ${tablaCatalogo(CATALOGO.fletamento, 'Fletamento de Carga, (no necesitan contrato)')}`),

            diapositiva('conci-ppt-gracias', '<h2>GRACIAS</h2>')
        ];

        return `<div class="conci-ppt" id="conci-rep-hoja">${slides.join('')}</div>`;
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

    const PPTX_CDN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';

    /** Carga el generador de PowerPoint la primera vez que se pide. */
    function cargarPptx() {
        if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = PPTX_CDN;
            s.onload = () => window.PptxGenJS ? resolve(window.PptxGenJS) : reject(new Error('PptxGenJS no quedó disponible'));
            s.onerror = () => reject(new Error('No se pudo descargar el generador de PowerPoint'));
            document.head.appendChild(s);
        });
    }

    const nombreArchivo = base => String(base).replace(/[\\/:*?"<>|]/g, '-');

    async function descargarPptx() {
        if (!ultimo) { error('Genera la presentación antes de descargarla.'); return; }
        const boton = el('btn-conci-rep-carga-descargar');
        if (boton) boton.disabled = true;
        try {
            estado('Preparando la presentación…');
            const Pptx = await cargarPptx();
            const pptx = new Pptx();
            pptx.layout = 'LAYOUT_4x3';           // 10 × 7.5 in, como la original
            const r = resumenPresentacion(ultimo);
            const filas = filasHoja1(ultimo);
            const { anio, mes, fechaIso } = ultimo;

            const portada = pptx.addSlide();
            portada.addText('Aeropuerto Internacional\n“Felipe Ángeles”',
                { x: 0.5, y: 2.4, w: 9, h: 1.6, align: 'center', fontSize: 30, bold: true, color: VINO });
            portada.addText(`${MESES[mes - 1].charAt(0)}${MESES[mes - 1].slice(1).toLowerCase()} ${anio}`,
                { x: 0.5, y: 4.1, w: 9, h: 0.5, align: 'center', fontSize: 18, color: DORADO });

            const resumen = pptx.addSlide();
            resumen.addText('Operaciones en la Terminal de Carga',
                { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 20, bold: true, color: VINO });
            resumen.addText(`01 Ene. al ${fechaLarga(fechaIso).slice(0, 2)} ${MES_CORTO[mes - 1]} ${anio}`,
                { x: 0.4, y: 0.8, w: 9.2, h: 0.35, fontSize: 13, color: '444444' });
            resumen.addTable([
                [{ text: '', options: { fill: VINO } },
                 { text: 'OPERACIONES', options: { bold: true, color: 'FFFFFF', fill: VINO } },
                 { text: 'TONELADAS', options: { bold: true, color: 'FFFFFF', fill: VINO } }],
                ...r.anios.map(x => [x.etiqueta, entero(x.ops), dosDec(x.ton)]),
                [r.delDia.etiqueta, entero(r.delDia.ops), dosDec(r.delDia.ton)],
                [{ text: r.acumulado.etiqueta, options: { bold: true } },
                 { text: entero(r.acumulado.ops), options: { bold: true } },
                 { text: dosDec(r.acumulado.ton), options: { bold: true } }]
            ], { x: 0.5, y: 1.5, w: 9, fontSize: 12, border: { pt: 1, color: 'BFBFBF' } });
            resumen.addText(
                `OPERANDO ACTUALMENTE · ${CATALOGO.regular.length} carga regular · `
                + `${CATALOGO.fletamento.length} fletamento · ${CATALOGO.mixtas.length} carga mixta`,
                { x: 0.5, y: 5.6, w: 9, h: 0.4, fontSize: 12, color: DORADO, bold: true });

            const modalidades = [
                ['Aerolíneas que operan con un contrato de Servicios Aeroportuarios:', CATALOGO.regular],
                ['Aerolíneas que operan en la modalidad de fletamento de carga:', CATALOGO.fletamento],
                ['Aerolíneas que realizan operaciones mixtas (carga y pasajeros):', CATALOGO.mixtas]
            ];
            const porNombre = new Map(filas.map(f => [normaliza(f.aerolinea), f]));
            const cifras = nombre => porNombre.get(normaliza(nombreAerolinea(nombre))) || { ops: 0, ton: 0 };

            for (const [titulo, lista] of modalidades) {
                const s = pptx.addSlide();
                s.addText(titulo, { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 16, bold: true, color: VINO });
                s.addTable([
                    [{ text: 'Aerolínea', options: { bold: true, color: 'FFFFFF', fill: VINO } },
                     { text: 'No. de operaciones', options: { bold: true, color: 'FFFFFF', fill: VINO } },
                     { text: 'Total de carga en Tn.', options: { bold: true, color: 'FFFFFF', fill: VINO } }],
                    ...lista.map(n => { const c = cifras(n); return [n, entero(c.ops), dosDec(c.ton)]; })
                ], { x: 0.4, y: 0.95, w: 9.2, fontSize: 9, border: { pt: 1, color: 'BFBFBF' } });
            }

            const totales_ = pptx.addSlide();
            totales_.addText('Cifras acumuladas desde el inicio de operaciones de la Terminal de Carga:',
                { x: 0.4, y: 0.5, w: 9.2, h: 0.6, fontSize: 16, bold: true, color: VINO });
            totales_.addTable([
                ['Total de operaciones', entero(r.acumulado.ops)],
                ['Total de carga transportada (tons.)', dosDec(r.acumulado.ton)]
            ], { x: 1.5, y: 2.2, w: 7, fontSize: 16, border: { pt: 1, color: 'BFBFBF' } });

            const gracias = pptx.addSlide();
            gracias.addText('GRACIAS', { x: 0.5, y: 3, w: 9, h: 1, align: 'center', fontSize: 40, bold: true, color: VINO });

            await pptx.writeFile({ fileName: nombreArchivo(`PRESENTACION CARGA ${fechaLarga(fechaIso)}.pptx`) });
            estado('Presentación descargada.');
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
        filasHoja1, totales, toneladas, repartirEnteros, resumenPresentacion,
        aIso, nombreAerolinea, CATALOGO, BASE_HISTORICA
    };
})();