/* ==========================================================================
   Reportes > Pasajeros
   --------------------------------------------------------------------------
   Los tres reportes de pasajeros que hasta ahora se armaban a mano en el libro
   "TUA y REPORTE GENERAL", reproducidos sobre lo capturado en Conciliación
   Manifiestos. Las fórmulas se sacaron de las tablas dinámicas del libro y se
   verificaron reproduciendo abril 2026 fila por fila:

     SUBSECRETARÍA   filtra por CIERRE SUBSECRETARIA; cruza TIPO DE MANIFIESTO
                     (LLEGADA/SALIDA) contra TIPO DE OPERACIÓN (NACIONAL/
                     INTERNACIONAL). Pasajeros = suma de TOTAL PAX;
                     operaciones = cuenta de AEROLINEA. Debajo, el acumulado
                     del mes, del año y desde el inicio de operaciones, que en
                     el libro son la recurrencia "acumulado previo + hoy".

     PLANTILLA 1     filtra por FECHA; agrupa por AEROLINEA. Pasajeros = suma
                     de TOTAL PAX; operaciones = cuenta de TIPO DE OPERACIÓN.
                     Lleva dos bloques: el del día y el acumulado del mes.

     PLANTILLA 2     agrupa por FECHA contra TIPO DE MANIFIESTO, un renglón por
                     día del mes. Pasajeros = suma de TOTAL PAX; operaciones =
                     cuenta de TIPO DE MANIFIESTO. Cierra con total, promedio,
                     máximos del mes y el promedio anual (acumulado del año
                     entre los días transcurridos).

   Cada reporte cuenta con el campo que el libro cuenta —AEROLINEA, TIPO DE
   OPERACIÓN o TIPO DE MANIFIESTO—, no con el número de filas: Excel ignora las
   celdas vacías y esa diferencia cambia el número de operaciones cuando un
   manifiesto llega incompleto.

   La única diferencia deliberada con el libro: allá DATA traía solo manifiestos
   de pasajeros, mientras que aquí la tabla trae pasajeros y carga juntos. Se
   descartan los de carga con el mismo criterio que usan las píldoras de la
   tabla (_conciRowIsCargo), que resuelve por catálogo de aerolíneas.
   ========================================================================== */
(function () {
    'use strict';

    const TABLA = 'Conciliación Manifiestos';
    const PAGINA = 1000;

    const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
        'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

    let cache = null;      // { hasta, filas, columnas }
    let reporteActivo = 'subsecretaria';

    /* ── utilidades ─────────────────────────────────────────────────────── */

    const el = id => document.getElementById(id);
    const numero = n => Number(n || 0).toLocaleString('es-MX');
    const decimal = n => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });

    function escapar(texto) {
        return String(texto ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    /**
     * Lleva a AAAA-MM-DD lo que traiga la celda de fecha. La tabla convive con
     * texto DD/MM/AAAA de las capturas viejas, ISO de las nuevas y fechas con
     * hora pegada, así que se normalizan las tres formas.
     */
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

    /** Cuenta como Excel: solo si la celda trae algo. */
    const cuentaSiHay = valor => String(valor ?? '').trim() !== '';

    function normaliza(texto) {
        return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    }

    function esLlegada(tipo) { return /LLEG|ARR/.test(normaliza(tipo)); }
    function esSalida(tipo) { return /SAL|DEP/.test(normaliza(tipo)); }
    function esInternacional(op) { return /INTERNACIONAL/.test(normaliza(op)); }

    function diasDelMes(anio, mes) { return new Date(anio, mes, 0).getDate(); }

    /* ── columnas ───────────────────────────────────────────────────────── */

    /** Resuelve los nombres reales de columna, que varían entre capturas. */
    function detectarColumnas(fila) {
        const claves = Object.keys(fila || {});
        const buscar = re => claves.find(c => re.test(normaliza(c))) || null;
        return {
            cierre: buscar(/^CIERRE\s+SUBSECRETARIA/),
            fecha: buscar(/^FECHA$/) || buscar(/(^|\s)FECHA(\s|$)/),
            tipo: buscar(/TIPO\s+DE\s+MANIF/),
            operacion: buscar(/TIPO\s+DE\s+OPERACION/),
            aerolinea: buscar(/AEROLINEA|AIRLINE/),
            pax: buscar(/^TOTAL\s+PAX$/) || buscar(/TOTAL\s+PAX/),
            portal: claves.find(c => c === '_portal_flight_date') || null
        };
    }

    /* ── datos ──────────────────────────────────────────────────────────── */

    function cliente() {
        const c = window.supabaseClient;
        if (!c) throw new Error('No hay conexión con la base de datos.');
        return c;
    }

    /**
     * Descarga los manifiestos hasta la fecha del reporte, en páginas. Se pide
     * una fila de muestra primero para saber qué columnas existen y bajar solo
     * esas: la tabla tiene más de treinta y traerlas todas multiplica el
     * tiempo de espera sin aportar nada al reporte.
     */
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

    const cubo = () => ({ pax: 0, ops: 0 });

    /**
     * Una sola pasada sobre los manifiestos llena los tres reportes. Recorrer
     * la lista una vez por reporte daría lo mismo pero triplicaría el trabajo
     * sobre un histórico que crece todos los días.
     */
    function agregar(datos, fechaIso) {
        const { filas, columnas } = datos;
        const [anio, mes] = fechaIso.split('-').map(Number);
        const prefijoMes = fechaIso.slice(0, 7);
        const prefijoAnio = fechaIso.slice(0, 4);

        // Subsecretaría: LLEGADA/SALIDA × NACIONAL/INTERNACIONAL, por alcance.
        const sub = {};
        for (const alcance of ['dia', 'mes', 'anio', 'historico']) {
            sub[alcance] = {
                LLEGADA: { NACIONAL: cubo(), INTERNACIONAL: cubo() },
                SALIDA: { NACIONAL: cubo(), INTERNACIONAL: cubo() }
            };
        }

        const porAerolinea = { dia: new Map(), mes: new Map() };

        // Plantilla 2: un renglón por día del mes.
        const totalDias = diasDelMes(anio, mes);
        const porDia = Array.from({ length: totalDias }, () => ({
            pax: { llegada: 0, salida: 0 }, ops: { llegada: 0, salida: 0 }, hayDatos: false
        }));

        let descartadosCarga = 0;

        for (const fila of filas) {
            // La tabla mezcla pasajeros y carga; estos reportes son de pasajeros.
            if (typeof window._conciRowIsCargo === 'function'
                && window._conciRowIsCargo(fila, columnas.operacion, columnas.aerolinea)) {
                descartadosCarga++;
                continue;
            }

            const pax = Number(columnas.pax ? fila[columnas.pax] : 0) || 0;
            const tipo = columnas.tipo ? fila[columnas.tipo] : '';
            const operacion = columnas.operacion ? fila[columnas.operacion] : '';
            const llegada = esLlegada(tipo);
            const salida = esSalida(tipo);

            // ── Subsecretaría: se agrupa por CIERRE SUBSECRETARIA ──
            const cierre = aIso(columnas.cierre ? fila[columnas.cierre] : '');
            if (cierre && cierre <= fechaIso && (llegada || salida)) {
                const carril = llegada ? 'LLEGADA' : 'SALIDA';
                const columna = esInternacional(operacion) ? 'INTERNACIONAL' : 'NACIONAL';
                const suma = alcance => {
                    const c = sub[alcance][carril][columna];
                    c.pax += pax;
                    // El libro cuenta AEROLINEA, no filas.
                    if (cuentaSiHay(columnas.aerolinea ? fila[columnas.aerolinea] : '')) c.ops++;
                };
                suma('historico');
                if (cierre.startsWith(prefijoAnio)) suma('anio');
                if (cierre.startsWith(prefijoMes)) suma('mes');
                if (cierre === fechaIso) suma('dia');
            }

            // ── Plantillas 1 y 2: se agrupan por FECHA ──
            const fecha = aIso(columnas.fecha ? fila[columnas.fecha] : '');
            if (!fecha || fecha > fechaIso) continue;

            if (fecha === fechaIso || fecha.startsWith(prefijoMes)) {
                const aerolinea = String(columnas.aerolinea ? fila[columnas.aerolinea] : '').trim();
                if (aerolinea) {
                    const anota = alcance => {
                        const mapa = porAerolinea[alcance];
                        const acc = mapa.get(aerolinea) || cubo();
                        acc.pax += pax;
                        // El libro cuenta TIPO DE OPERACIÓN en el bloque del día
                        // y AEROLINEA en el acumulado; aquí ambos existen.
                        if (alcance === 'dia' ? cuentaSiHay(operacion) : true) acc.ops++;
                        mapa.set(aerolinea, acc);
                    };
                    if (fecha.startsWith(prefijoMes)) anota('mes');
                    if (fecha === fechaIso) anota('dia');
                }
            }

            if (fecha.startsWith(prefijoMes) && (llegada || salida)) {
                const dia = Number(fecha.slice(8, 10));
                const casilla = porDia[dia - 1];
                if (casilla) {
                    const carril = llegada ? 'llegada' : 'salida';
                    casilla.pax[carril] += pax;
                    if (cuentaSiHay(tipo)) casilla.ops[carril]++;
                    casilla.hayDatos = true;
                }
            }
        }

        return { sub, porAerolinea, porDia, anio, mes, fechaIso, descartadosCarga, totalFilas: filas.length };
    }

    /* ── render ─────────────────────────────────────────────────────────── */

    function totalesSub(bloque) {
        const t = { nacional: cubo(), internacional: cubo(), total: cubo() };
        for (const carril of ['LLEGADA', 'SALIDA']) {
            t.nacional.pax += bloque[carril].NACIONAL.pax;
            t.nacional.ops += bloque[carril].NACIONAL.ops;
            t.internacional.pax += bloque[carril].INTERNACIONAL.pax;
            t.internacional.ops += bloque[carril].INTERNACIONAL.ops;
        }
        t.total.pax = t.nacional.pax + t.internacional.pax;
        t.total.ops = t.nacional.ops + t.internacional.ops;
        return t;
    }

    function fechaLarga(iso) {
        const [a, m, d] = iso.split('-').map(Number);
        return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
    }

    const NOTA = 'Los valores mostrados son el resultado de los registros de manifiestos recibidos '
        + 'por parte de los prestadores de servicios. Sin embargo, estos datos pueden variar de acuerdo '
        + 'al período de reporte y ajustes realizados por las aerolíneas.';

    /**
     * El marco imprimible: logo, título y nota, igual que las plantillas del
     * libro. Lo que va dentro cambia por reporte; el marco no.
     */
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

    /** Color de marca de la aerolínea: el mismo catálogo que pinta la tabla. */
    function colorAerolinea(nombre) {
        try {
            const meta = typeof window._conciResolveAirlineMeta === 'function'
                ? window._conciResolveAirlineMeta(nombre) : null;
            const fondo = meta && meta.color;
            if (!/^#[0-9a-f]{3,8}$/i.test(String(fondo || ''))) return null;
            const texto = String(meta.textColor || '#ffffff');
            return { fondo, texto: /^#[0-9a-f]{3,8}$/i.test(texto) ? texto : '#ffffff' };
        } catch (_) { return null; }
    }

    /* ── Reporte a la Subsecretaría ─────────────────────────────────────── */

    function renderSubsecretaria(datos) {
        const { sub, fechaIso, anio, mes } = datos;
        const dia = sub.dia;
        const totalDia = totalesSub(dia);
        const mesCorto = MESES[mes - 1].charAt(0) + MESES[mes - 1].slice(1, 3).toLowerCase();

        // Las dos dinámicas de la izquierda, tal como salen en la hoja.
        const dinamica = (titulo, campo) => `
            <table class="conci-rep-pivote">
                <thead>
                    <tr><th class="conci-rep-pivote-titulo" colspan="4">${escapar(titulo)}</th></tr>
                    <tr><th>Etiquetas de fila</th><th>INTERNACIONAL</th><th>NACIONAL</th><th>Total general</th></tr>
                </thead>
                <tbody>
                    ${['LLEGADA', 'SALIDA'].map(carril => `
                        <tr>
                            <td>${carril}</td>
                            <td class="num">${numero(dia[carril].INTERNACIONAL[campo])}</td>
                            <td class="num">${numero(dia[carril].NACIONAL[campo])}</td>
                            <td class="num">${numero(dia[carril].INTERNACIONAL[campo] + dia[carril].NACIONAL[campo])}</td>
                        </tr>`).join('')}
                    <tr class="conci-rep-pivote-total">
                        <td>Total general</td>
                        <td class="num">${numero(totalDia.internacional[campo])}</td>
                        <td class="num">${numero(totalDia.nacional[campo])}</td>
                        <td class="num">${numero(totalDia.total[campo])}</td>
                    </tr>
                </tbody>
            </table>`;

        const bloques = [
            ['', totalesSub(sub.dia)],
            [`A. Acumulado del mes ${mesCorto}. ${anio}:`, totalesSub(sub.mes)],
            [`B. Acumulado en el año ${anio}:`, totalesSub(sub.anio)],
            ['C. Acumulado desde el inicio de operaciones AIFA:', totalesSub(sub.historico)]
        ];

        const cuadro = (etiqueta, t, esDelDia) => `
            ${etiqueta ? `<p class="conci-rep-sub-apartado">${escapar(etiqueta)}</p>` : ''}
            <table class="conci-rep-oficio${esDelDia ? ' conci-rep-oficio-hoy' : ''}">
                <thead>
                    <tr><th class="conci-rep-oficio-fecha" colspan="4">${fechaLarga(fechaIso)}</th></tr>
                    <tr><th></th><th>Dato</th><th>Nacional</th><th>Internacional</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="rot">a. Pasajeros:</td>
                        <td class="num">${numero(t.total.pax)}</td>
                        <td class="num">${numero(t.nacional.pax)}</td>
                        <td class="num">${numero(t.internacional.pax)}</td>
                    </tr>
                    <tr>
                        <td class="rot">b. Operaciones:</td>
                        <td class="num">${numero(t.total.ops)}</td>
                        <td class="num">${numero(t.nacional.ops)}</td>
                        <td class="num">${numero(t.internacional.ops)}</td>
                    </tr>
                </tbody>
            </table>`;

        const cuerpo = `
            <div class="conci-rep-sub-rejilla">
                <div class="conci-rep-sub-izq">
                    <p class="conci-rep-filtro">CIERRE SUBSECRETARÍA <strong>${fechaLarga(fechaIso)}</strong></p>
                    ${dinamica('Suma de TOTAL PAX', 'pax')}
                    ${dinamica('Cuenta de AEROLINEA', 'ops')}
                </div>
                <div class="conci-rep-sub-der">
                    <p class="conci-rep-sub-intro">Se envía la información correspondiente (carga y pasajeros) al:</p>
                    ${bloques.map(([etiqueta, t], i) => cuadro(etiqueta, t, i === 0)).join('')}
                </div>
            </div>`;

        return hoja(`REPORTE A LA SUBSECRETARÍA ${MESES[mes - 1]} ${anio}`, '', cuerpo, true);
    }

    /* ── Plantilla 1: numeralia por aerolínea ───────────────────────────── */

    function tablaAerolineas(mapa) {
        const filas = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
        const totalPax = filas.reduce((a, [, v]) => a + v.pax, 0);
        const totalOps = filas.reduce((a, [, v]) => a + v.ops, 0);
        const cuerpo = filas.length
            ? filas.map(([aerolinea, v]) => {
                const c = colorAerolinea(aerolinea);
                const estilo = c ? ` style="background:${c.fondo};color:${c.texto}"` : '';
                return `
                <tr>
                    <td class="conci-rep-aero"${estilo}>${escapar(aerolinea)}</td>
                    <td class="num">${numero(v.pax)}</td>
                    <td class="num">${numero(v.ops)}</td>
                </tr>`;
            }).join('')
            : '<tr><td colspan="3" class="conci-rep-vacia">Sin manifiestos de pasajeros en el periodo.</td></tr>';
        return `
            <table class="conci-rep-plantilla conci-rep-p1">
                <thead>
                    <tr><th>AEROLÍNEA</th><th>PAX TRANSPORTADOS</th><th>NÚMERO DE OPERACIONES</th></tr>
                </thead>
                <tbody>${cuerpo}</tbody>
                <tfoot>
                    <tr class="conci-rep-fila-total">
                        <td>TOTAL</td>
                        <td class="num"><u>${numero(totalPax)}</u></td>
                        <td class="num"><u>${numero(totalOps)}</u></td>
                    </tr>
                </tfoot>
            </table>`;
    }

    function renderPlantilla1(datos) {
        const { porAerolinea, fechaIso, anio, mes } = datos;
        const mesTitulo = MESES[mes - 1].charAt(0) + MESES[mes - 1].slice(1).toLowerCase();
        const cuerpo = `
            ${tablaAerolineas(porAerolinea.dia)}
            <p class="conci-rep-acumuladas">Cifras acumuladas: <strong><u>${escapar(mesTitulo)}</u></strong></p>
            ${tablaAerolineas(porAerolinea.mes)}`;
        return hoja(
            `NUMERALIA AEROPORTUARIA ${MESES[mes - 1]} ${anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(fechaIso)}</u></strong>`,
            cuerpo
        );
    }

    /* ── Plantilla 2: concentrado diario del mes ────────────────────────── */

    function renderPlantilla2(datos) {
        const { porDia, sub, anio, mes, fechaIso } = datos;
        const conDatos = porDia.filter(d => d.hayDatos);

        const suma = sel => porDia.reduce((a, d) => a + sel(d), 0);
        const promedio = sel => conDatos.length ? suma(sel) / conDatos.length : 0;
        const maximo = sel => conDatos.length ? Math.max(...conDatos.map(sel)) : 0;

        const paxTotal = d => d.pax.llegada + d.pax.salida;
        const opsTotal = d => d.ops.llegada + d.ops.salida;

        // Promedio anual: acumulado del año entre los días transcurridos, igual
        // que =E25/DAYS(HOY; 1-ene) en el libro.
        const inicio = new Date(anio, 0, 1);
        const corte = new Date(`${fechaIso}T12:00:00`);
        const diasTranscurridos = Math.max(1, Math.round((corte - inicio) / 86400000));
        const anual = totalesSub(sub.anio);

        // Las dos tablas —pasajeros y operaciones— son gemelas y van lado a lado.
        const tabla = (banda, llegada, salida, total) => `
            <table class="conci-rep-plantilla conci-rep-p2">
                <thead>
                    <tr><th class="conci-rep-banda" colspan="4">${banda}</th></tr>
                    <tr class="conci-rep-subcabecera"><th>FECHA</th><th>LLEGADA</th><th>SALIDA</th><th>TOTAL</th></tr>
                </thead>
                <tbody>
                    ${porDia.map((d, i) => {
                        const fecha = `${String(i + 1).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
                        const celda = v => d.hayDatos ? `<td class="num">${numero(v)}</td>` : '<td class="num"></td>';
                        return `<tr><td class="conci-rep-dia">${fecha}</td>${celda(llegada(d))}${celda(salida(d))}${celda(total(d))}</tr>`;
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr class="conci-rep-fila-total">
                        <td>TOTAL</td>
                        <td class="num"><u>${numero(suma(llegada))}</u></td>
                        <td class="num"><u>${numero(suma(salida))}</u></td>
                        <td class="num"><u>${numero(suma(total))}</u></td>
                    </tr>
                    <tr class="conci-rep-fila-promedio">
                        <td>PROMEDIO</td>
                        <td class="num">${decimal(promedio(llegada))}</td>
                        <td class="num">${decimal(promedio(salida))}</td>
                        <td class="num">${decimal(promedio(total))}</td>
                    </tr>
                </tfoot>
            </table>`;

        const cuerpo = `
            <div class="conci-rep-p2-rejilla">
                ${tabla('PASAJEROS', d => d.pax.llegada, d => d.pax.salida, paxTotal)}
                ${tabla('OPERACIONES', d => d.ops.llegada, d => d.ops.salida, opsTotal)}
            </div>
            <div class="conci-rep-p2-pie">
                <table class="conci-rep-maximos">
                    <tbody>
                        <tr><td class="conci-rep-etiqueta-vino">Máximo PAX del mes</td><td class="num"><u>${numero(maximo(paxTotal))}</u></td></tr>
                        <tr><td class="conci-rep-etiqueta-vino">Máximo OP del mes</td><td class="num"><u>${numero(maximo(opsTotal))}</u></td></tr>
                    </tbody>
                </table>
                <table class="conci-rep-maximos">
                    <tbody>
                        <tr><td class="conci-rep-hueco"></td><td class="conci-rep-th-simple">PAX</td><td class="conci-rep-th-simple">OP</td></tr>
                        <tr>
                            <td class="conci-rep-etiqueta-vino">PROMEDIO ANUAL</td>
                            <td class="num"><u>${decimal(anual.total.pax / diasTranscurridos)}</u></td>
                            <td class="num"><u>${decimal(anual.total.ops / diasTranscurridos)}</u></td>
                        </tr>
                    </tbody>
                </table>
            </div>`;

        return hoja(
            `NUMERALIA AEROPORTUARIA ${MESES[mes - 1]} ${anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(fechaIso)}</u></strong>`,
            cuerpo,
            true
        );
    }

    const RENDERS = {
        subsecretaria: renderSubsecretaria,
        plantilla1: renderPlantilla1,
        plantilla2: renderPlantilla2
    };

    /* ── orquestación ───────────────────────────────────────────────────── */

    let ultimo = null;

    function pintar() {
        const salida = el('conci-rep-pax-salida');
        if (!salida || !ultimo) return;
        salida.innerHTML = (RENDERS[reporteActivo] || renderSubsecretaria)(ultimo);
    }

    /** Toma unos totales ya calculados y los dibuja. */
    function mostrar(datos) {
        ultimo = datos;
        pintar();
    }

    function estado(texto) {
        const e = el('conci-rep-pax-estado');
        if (e) e.textContent = texto || '';
    }

    function error(mensaje) {
        const e = el('conci-rep-pax-error');
        if (!e) return;
        e.classList.toggle('d-none', !mensaje);
        e.textContent = mensaje || '';
    }

    async function generar() {
        const campo = el('conci-rep-pax-fecha');
        const fechaIso = campo && campo.value;
        if (!fechaIso) { error('Elige la fecha del reporte.'); return; }

        const boton = el('btn-conci-rep-pax-generar');
        if (boton) boton.disabled = true;
        error('');
        estado('Leyendo manifiestos…');

        try {
            const datos = await descargar(fechaIso, n => estado(`Leyendo manifiestos… ${numero(n)}`));
            ultimo = agregar(datos, fechaIso);
            pintar();
            const carga = ultimo.descartadosCarga
                ? ` · ${numero(ultimo.descartadosCarga)} de carga descartados`
                : '';
            estado(`${numero(ultimo.totalFilas)} manifiestos leídos${carga}`);
        } catch (e) {
            console.error('[Reportes Pasajeros]', e);
            error(`No se pudieron calcular los reportes: ${e.message || e}`);
            estado('');
        } finally {
            if (boton) boton.disabled = false;
        }
    }

    function elegirReporte(clave, boton) {
        reporteActivo = clave;
        document.querySelectorAll('[data-conci-rep-pax]')
            .forEach(b => b.classList.toggle('active', b === boton));
        // Descargar solo aplica a las dos plantillas: el de Subsecretaría se
        // captura en el oficio, no se entrega como archivo.
        const descarga = el('btn-conci-rep-pax-descargar');
        if (descarga) descarga.classList.toggle('d-none', clave === 'subsecretaria');
        pintar();
    }

    /* ── imprimir y descargar ───────────────────────────────────────────── */

    /**
     * Imprime solo la hoja del reporte. La clase la lee @media print, que
     * esconde el resto de la aplicación: sin ella saldrían también la barra de
     * herramientas y los botones.
     */
    function imprimir() {
        if (!ultimo) { error('Genera el reporte antes de imprimirlo.'); return; }
        document.body.classList.add('conci-rep-imprimiendo');
        const limpiar = () => document.body.classList.remove('conci-rep-imprimiendo');
        window.addEventListener('afterprint', limpiar, { once: true });
        try { window.print(); } finally { setTimeout(limpiar, 1500); }
    }

    /** Nombre de archivo sin caracteres que Windows rechace. */
    function nombreArchivo(base) {
        return String(base).replace(/[\\/:*?"<>|]/g, '-');
    }

    function filasPlantilla1(datos) {
        const bloque = (mapa, encabezado) => {
            const filas = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
            return [
                [encabezado],
                ['AEROLÍNEA', 'PAX TRANSPORTADOS', 'NÚMERO DE OPERACIONES'],
                ...filas.map(([a, v]) => [a, v.pax, v.ops]),
                ['TOTAL',
                    filas.reduce((s, [, v]) => s + v.pax, 0),
                    filas.reduce((s, [, v]) => s + v.ops, 0)],
                []
            ];
        };
        const mesTitulo = MESES[datos.mes - 1].charAt(0) + MESES[datos.mes - 1].slice(1).toLowerCase();
        return [
            [`NUMERALIA AEROPORTUARIA ${MESES[datos.mes - 1]} ${datos.anio}`],
            [`Fecha de actualización: ${fechaLarga(datos.fechaIso)}`],
            [],
            ...bloque(datos.porAerolinea.dia, `Del día ${fechaLarga(datos.fechaIso)}`),
            ...bloque(datos.porAerolinea.mes, `Cifras acumuladas: ${mesTitulo}`),
            [NOTA]
        ];
    }

    function filasPlantilla2(datos) {
        const { porDia, sub, anio, mes, fechaIso } = datos;
        const conDatos = porDia.filter(d => d.hayDatos);
        const suma = sel => porDia.reduce((a, d) => a + sel(d), 0);
        const prom = sel => conDatos.length ? Math.round(suma(sel) / conDatos.length) : 0;
        const paxTotal = d => d.pax.llegada + d.pax.salida;
        const opsTotal = d => d.ops.llegada + d.ops.salida;

        const inicio = new Date(anio, 0, 1);
        const corte = new Date(`${fechaIso}T12:00:00`);
        const dias = Math.max(1, Math.round((corte - inicio) / 86400000));
        const anual = totalesSub(sub.anio);

        const cuerpo = porDia.map((d, i) => {
            const fecha = `${String(i + 1).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
            return d.hayDatos
                ? [fecha, d.pax.llegada, d.pax.salida, paxTotal(d), '', fecha, d.ops.llegada, d.ops.salida, opsTotal(d)]
                : [fecha, '', '', '', '', fecha, '', '', ''];
        });

        return [
            [`NUMERALIA AEROPORTUARIA ${MESES[mes - 1]} ${anio}`],
            [`Fecha de actualización: ${fechaLarga(fechaIso)}`],
            [],
            ['PASAJEROS', '', '', '', '', 'OPERACIONES'],
            ['FECHA', 'LLEGADA', 'SALIDA', 'TOTAL', '', 'FECHA', 'LLEGADA', 'SALIDA', 'TOTAL'],
            ...cuerpo,
            ['TOTAL', suma(d => d.pax.llegada), suma(d => d.pax.salida), suma(paxTotal), '',
                'TOTAL', suma(d => d.ops.llegada), suma(d => d.ops.salida), suma(opsTotal)],
            ['PROMEDIO', prom(d => d.pax.llegada), prom(d => d.pax.salida), prom(paxTotal), '',
                'PROMEDIO', prom(d => d.ops.llegada), prom(d => d.ops.salida), prom(opsTotal)],
            [],
            ['Máximo PAX del mes', conDatos.length ? Math.max(...conDatos.map(paxTotal)) : 0],
            ['Máximo OP del mes', conDatos.length ? Math.max(...conDatos.map(opsTotal)) : 0],
            ['PROMEDIO ANUAL', Math.round(anual.total.pax / dias), Math.round(anual.total.ops / dias)],
            [],
            [NOTA]
        ];
    }

    function descargar_() {
        if (!ultimo) { error('Genera el reporte antes de descargarlo.'); return; }
        if (typeof XLSX === 'undefined') { error('No se pudo cargar el generador de Excel.'); return; }
        const esP1 = reporteActivo === 'plantilla1';
        if (!esP1 && reporteActivo !== 'plantilla2') return;

        const filas = esP1 ? filasPlantilla1(ultimo) : filasPlantilla2(ultimo);
        const hojaExcel = XLSX.utils.aoa_to_sheet(filas);
        const libro = XLSX.utils.book_new();
        const etiqueta = esP1 ? 'Plantilla 1' : 'Plantilla 2';
        XLSX.utils.book_append_sheet(libro, hojaExcel, etiqueta);
        XLSX.writeFile(libro, nombreArchivo(
            `${etiqueta} - Numeralia ${MESES[ultimo.mes - 1]} ${ultimo.anio} - ${fechaLarga(ultimo.fechaIso)}.xlsx`
        ));
    }

    document.addEventListener('DOMContentLoaded', () => {
        const campo = el('conci-rep-pax-fecha');
        if (campo && !campo.value) {
            const hoy = new Date();
            campo.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        }
        el('btn-conci-rep-pax-generar')?.addEventListener('click', generar);
        el('btn-conci-rep-pax-imprimir')?.addEventListener('click', imprimir);
        el('btn-conci-rep-pax-descargar')?.addEventListener('click', descargar_);
        // Cambiar la fecha invalida lo descargado: el rango pedido es otro.
        campo?.addEventListener('change', () => { cache = null; });
        document.querySelectorAll('[data-conci-rep-pax]').forEach(boton => {
            boton.addEventListener('click', () => elegirReporte(boton.dataset.conciRepPax, boton));
        });
    });

    window.conciReportesPasajeros = {
        generar, agregar, mostrar, aIso, imprimir,
        descargar: descargar_,
        filasPlantilla1, filasPlantilla2,
        _cache: () => cache
    };
})();
