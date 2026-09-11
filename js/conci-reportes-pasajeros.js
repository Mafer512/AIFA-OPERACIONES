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
                     Lleva dos columnas: el cierre del día pedido y el del día
                     anterior, que puede caer en el mes previo; cada una con
                     sus propios acumulados contados hasta su fecha de cierre.

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

    /**
     * Nombre comercial de la aerolínea. La columna guarda indistintamente el
     * código IATA o el nombre —"Y4" y "VOLARIS" son la misma aerolínea— y el
     * reporte se lee, así que se muestra el nombre. Resuelve contra el mismo
     * catálogo que usa la tabla de Manifiestos, de modo que ambas formas caen
     * en un solo renglón. Un código que no esté en el catálogo se queda tal
     * cual: es la señal de que hay que darlo de alta en Catálogo de aerolíneas.
     */
    function nombreAerolinea(valor) {
        const bruto = String(valor ?? '').trim();
        if (!bruto) return '';
        try {
            const meta = typeof window._conciResolveAirlineMeta === 'function'
                ? window._conciResolveAirlineMeta(bruto) : null;
            if (meta && meta.name) return String(meta.name).toUpperCase();
        } catch (_) { /* sin catálogo se queda el valor capturado */ }
        return bruto.toUpperCase();
    }

    function diasDelMes(anio, mes) { return new Date(anio, mes, 0).getDate(); }

    const dosDigitos = n => String(n).padStart(2, '0');

    /** AAAA-MM-DD del día anterior, cruzando mes y año. */
    function diaAnterior(iso) {
        const [a, m, d] = iso.split('-').map(Number);
        const f = new Date(a, m - 1, d - 1);
        return `${f.getFullYear()}-${dosDigitos(f.getMonth() + 1)}-${dosDigitos(f.getDate())}`;
    }

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

        // El oficio a la Subsecretaría compara dos cierres: el del día pedido y
        // el del día anterior, que puede caer en el mes previo (1 de septiembre
        // contra 31 de agosto). Cada columna trae sus acumulados hasta su fecha.
        const anioSub = anio;
        const mesSub = mes;
        const cierres = { anterior: diaAnterior(fechaIso), actual: fechaIso };

        // Subsecretaría: por columna, LLEGADA/SALIDA × NACIONAL/INTERNACIONAL
        // en cada alcance.
        const sub = {};
        for (const clave of ['anterior', 'actual']) {
            sub[clave] = {};
            for (const alcance of ['dia', 'mes', 'anio', 'historico']) {
                sub[clave][alcance] = {
                    LLEGADA: { NACIONAL: cubo(), INTERNACIONAL: cubo() },
                    SALIDA: { NACIONAL: cubo(), INTERNACIONAL: cubo() }
                };
            }
        }

        // Las plantillas llevan su propio acumulado del año, por FECHA y hasta
        // el día pedido: el promedio anual de la Plantilla 2 no depende de los
        // cierres de la Subsecretaría.
        const anioPlantillas = cubo();

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
            // Cada columna del oficio lleva sus propios acumulados, contados
            // hasta su fecha de cierre, no hasta la fecha pedida.
            const cierre = aIso(columnas.cierre ? fila[columnas.cierre] : '');
            if (cierre && (llegada || salida)) {
                const carril = llegada ? 'LLEGADA' : 'SALIDA';
                const columna = esInternacional(operacion) ? 'INTERNACIONAL' : 'NACIONAL';
                // El libro cuenta AEROLINEA, no filas.
                const cuentaOp = cuentaSiHay(columnas.aerolinea ? fila[columnas.aerolinea] : '');
                for (const clave of ['anterior', 'actual']) {
                    const corte = cierres[clave];
                    if (cierre > corte) continue;
                    const suma = alcance => {
                        const c = sub[clave][alcance][carril][columna];
                        c.pax += pax;
                        if (cuentaOp) c.ops++;
                    };
                    suma('historico');
                    if (cierre.slice(0, 4) === corte.slice(0, 4)) suma('anio');
                    if (cierre.slice(0, 7) === corte.slice(0, 7)) suma('mes');
                    if (cierre === corte) suma('dia');
                }
            }

            // ── Plantillas 1 y 2: se agrupan por FECHA ──
            const fecha = aIso(columnas.fecha ? fila[columnas.fecha] : '');
            if (!fecha || fecha > fechaIso) continue;

            if (fecha.startsWith(prefijoAnio)) {
                anioPlantillas.pax += pax;
                if (cuentaSiHay(tipo)) anioPlantillas.ops++;
            }

            if (fecha === fechaIso || fecha.startsWith(prefijoMes)) {
                const bruto = String(columnas.aerolinea ? fila[columnas.aerolinea] : '').trim();
                const aerolinea = nombreAerolinea(bruto);
                if (aerolinea) {
                    const anota = alcance => {
                        const mapa = porAerolinea[alcance];
                        const acc = mapa.get(aerolinea) || { pax: 0, ops: 0, codigos: new Set() };
                        acc.pax += pax;
                        // El libro cuenta TIPO DE OPERACIÓN en el bloque del día
                        // y AEROLINEA en el acumulado; aquí ambos existen.
                        if (alcance === 'dia' ? cuentaSiHay(operacion) : true) acc.ops++;
                        // El código capturado se guarda para el tooltip, igual
                        // que hace la celda de aerolínea en la tabla.
                        if (bruto && bruto.toUpperCase() !== aerolinea) acc.codigos.add(bruto.toUpperCase());
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

        return {
            sub, cierres, anioSub, mesSub,
            porAerolinea, porDia, anioPlantillas,
            anio, mes, fechaIso, descartadosCarga, totalFilas: filas.length
        };
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
    /**
     * `xl` solo lo llevan las plantillas que se descargan: ubica en el Excel el
     * título (A1), la fecha (A2) y la nota ({ nota: renglón }), para que lo que
     * se corrija a mano en pantalla llegue también al archivo.
     */
    function hoja(titulo, subtitulo, cuerpo, ancha, xl) {
        const en = (r, c) => (xl ? ` data-xl="${r},${c}"` : '');
        return `
        <div class="conci-rep-hoja${ancha ? ' conci-rep-hoja-ancha' : ''}" id="conci-rep-hoja">
            <div class="conci-rep-logo">
                <img src="images/aifa-logo.png" alt="Aeropuerto Internacional Felipe Ángeles">
            </div>
            <h1 class="conci-rep-h1"${en(0, 0)}>${escapar(titulo)}</h1>
            ${subtitulo ? `<p class="conci-rep-actualizacion"${en(1, 0)}>${subtitulo}</p>` : ''}
            ${cuerpo}
            <p class="conci-rep-nota"><strong>Nota:</strong> ${xl ? `<span data-xl="${xl.nota},0">${NOTA}</span>` : NOTA}</p>
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
        const { sub, cierres, anioSub, mesSub } = datos;
        const dia = sub.actual.dia;
        const totalDia = totalesSub(dia);
        // El acumulado del mes nombra un mes o los dos, según caigan las columnas.
        const corto = iso => { const m = MESES[Number(iso.slice(5, 7)) - 1]; return `${m.charAt(0)}${m.slice(1, 3).toLowerCase()}.`; };
        const mesesDelOficio = corto(cierres.anterior) === corto(cierres.actual)
            ? corto(cierres.actual) : `${corto(cierres.anterior)} / ${corto(cierres.actual)}`;
        const aniosDelOficio = cierres.anterior.slice(0, 4) === cierres.actual.slice(0, 4)
            ? cierres.actual.slice(0, 4) : `${cierres.anterior.slice(0, 4)} / ${cierres.actual.slice(0, 4)}`;

        // Las dos dinámicas de la izquierda reflejan el cierre del día pedido.
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

        // Cada apartado del oficio compara las dos columnas: el cierre del
        // último día del mes anterior y el del día 1 del mes pedido.
        const apartados = [
            ['', 'dia'],
            [`A. Acumulado del mes`, 'mes'],
            [`B. Acumulado en el año`, 'anio'],
            ['C. Acumulado desde el inicio de operaciones AIFA:', 'historico']
        ];

        const etiquetaApartado = (base, alcance) => {
            if (alcance === 'mes') return `${base} ${mesesDelOficio}:`;
            if (alcance === 'anio') return `${base} ${aniosDelOficio}:`;
            return base;
        };

        const bloque = (etiqueta, alcance) => {
            const a = totalesSub(sub.anterior[alcance]);
            const b = totalesSub(sub.actual[alcance]);
            const trio = (t, campo) => `
                <td class="num">${numero(t.total[campo])}</td>
                <td class="num">${numero(t.nacional[campo])}</td>
                <td class="num">${numero(t.internacional[campo])}</td>`;
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
                    <tr><td class="rot">a. Pasajeros:</td>${trio(a, 'pax')}${trio(b, 'pax')}</tr>
                    <tr><td class="rot">b. Operaciones:</td>${trio(a, 'ops')}${trio(b, 'ops')}</tr>
                </tbody>
            </table>`;
        };

        const aviso = totalDia.total.pax + totalDia.total.ops === 0
            ? `<p class="conci-rep-aviso">No hay manifiestos de pasajeros con CIERRE SUBSECRETARIA del
                 ${fechaLarga(cierres.actual)}. Revisa que la captura de ese día esté cerrada.</p>`
            : '';

        const cuerpo = `
            ${aviso}
            <div class="conci-rep-sub-rejilla">
                <div class="conci-rep-sub-izq">
                    <p class="conci-rep-filtro">CIERRE SUBSECRETARÍA <strong>${fechaLarga(cierres.actual)}</strong></p>
                    ${dinamica('Suma de TOTAL PAX', 'pax')}
                    ${dinamica('Cuenta de AEROLINEA', 'ops')}
                </div>
                <div class="conci-rep-sub-der">
                    <p class="conci-rep-sub-intro">Se envía la información correspondiente (carga y pasajeros) al:</p>
                    ${apartados.map(([base, alcance]) => bloque(etiquetaApartado(base, alcance), alcance)).join('')}
                </div>
            </div>`;

        return hoja(`REPORTE A LA SUBSECRETARÍA ${MESES[mesSub - 1]} ${anioSub}`, '', cuerpo, true);
    }

    /* ── Plantilla 1: numeralia por aerolínea ───────────────────────────── */

    /**
     * `inicio` es el renglón del Excel (filasPlantilla1) donde va el encabezado
     * de este bloque: debajo van los títulos, una fila por aerolínea y TOTAL.
     */
    function tablaAerolineas(mapa, inicio) {
        const xl = (r, c) => (inicio === undefined ? '' : ` data-xl="${r},${c}"`);
        const filas = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
        const totalPax = filas.reduce((a, [, v]) => a + v.pax, 0);
        const totalOps = filas.reduce((a, [, v]) => a + v.ops, 0);
        const cuerpo = filas.length
            ? filas.map(([aerolinea, v], i) => {
                const c = colorAerolinea(aerolinea);
                const estilo = c ? ` style="background:${c.fondo};color:${c.texto}"` : '';
                // Se conserva a la vista el código capturado, como en la tabla.
                const codigos = v.codigos && v.codigos.size ? [...v.codigos].sort().join(', ') : '';
                const titulo = codigos ? ` title="Capturado como ${escapar(codigos)}"` : '';
                return `
                <tr>
                    <td class="conci-rep-aero"${estilo}${titulo}${xl(inicio + 2 + i, 0)}>${escapar(aerolinea)}</td>
                    <td class="num"${xl(inicio + 2 + i, 1)}>${numero(v.pax)}</td>
                    <td class="num"${xl(inicio + 2 + i, 2)}>${numero(v.ops)}</td>
                </tr>`;
            }).join('')
            : '<tr><td colspan="3" class="conci-rep-vacia">Sin manifiestos de pasajeros en el periodo.</td></tr>';
        return `
            <table class="conci-rep-plantilla conci-rep-p1">
                <thead>
                    <tr><th${xl(inicio + 1, 0)}>AEROLÍNEA</th><th${xl(inicio + 1, 1)}>PAX TRANSPORTADOS</th><th${xl(inicio + 1, 2)}>NÚMERO DE OPERACIONES</th></tr>
                </thead>
                <tbody>${cuerpo}</tbody>
                <tfoot>
                    <tr class="conci-rep-fila-total">
                        <td${xl(inicio + 2 + filas.length, 0)}>TOTAL</td>
                        <td class="num"${xl(inicio + 2 + filas.length, 1)}><u>${numero(totalPax)}</u></td>
                        <td class="num"${xl(inicio + 2 + filas.length, 2)}><u>${numero(totalOps)}</u></td>
                    </tr>
                </tfoot>
            </table>`;
    }

    function renderPlantilla1(datos) {
        const { porAerolinea, fechaIso, anio, mes } = datos;
        const mesTitulo = MESES[mes - 1].charAt(0) + MESES[mes - 1].slice(1).toLowerCase();
        // Renglones del Excel: título, fecha y un blanco; luego cada bloque ocupa
        // encabezado, títulos, sus aerolíneas, TOTAL y otro blanco.
        const bloque2 = 7 + porAerolinea.dia.size;
        const cuerpo = `
            ${tablaAerolineas(porAerolinea.dia, 3)}
            <p class="conci-rep-acumuladas" data-xl="${bloque2},0">Cifras acumuladas: <strong><u>${escapar(mesTitulo)}</u></strong></p>
            ${tablaAerolineas(porAerolinea.mes, bloque2)}`;
        return hoja(
            `NUMERALIA AEROPORTUARIA ${MESES[mes - 1]} ${anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(fechaIso)}</u></strong>`,
            cuerpo,
            false,
            { nota: bloque2 + 4 + porAerolinea.mes.size }
        );
    }

    /* ── Plantilla 2: concentrado diario del mes ────────────────────────── */

    function renderPlantilla2(datos) {
        const { porDia, anioPlantillas, anio, mes, fechaIso } = datos;
        const conDatos = porDia.filter(d => d.hayDatos);
        // Renglones del Excel (filasPlantilla2): banda en el 3, títulos en el 4 y
        // los días desde el 5; operaciones va cinco columnas a la derecha.
        const D = porDia.length;
        const xl = (r, c) => ` data-xl="${r},${c}"`;

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
        const anual = anioPlantillas;

        // Las dos tablas —pasajeros y operaciones— son gemelas y van lado a lado.
        const tabla = (banda, llegada, salida, total, col) => `
            <table class="conci-rep-plantilla conci-rep-p2">
                <thead>
                    <tr><th class="conci-rep-banda" colspan="4"${xl(3, col)}>${banda}</th></tr>
                    <tr class="conci-rep-subcabecera"><th${xl(4, col)}>FECHA</th><th${xl(4, col + 1)}>LLEGADA</th><th${xl(4, col + 2)}>SALIDA</th><th${xl(4, col + 3)}>TOTAL</th></tr>
                </thead>
                <tbody>
                    ${porDia.map((d, i) => {
                        const fecha = `${String(i + 1).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
                        const celda = (v, j) => `<td class="num"${xl(5 + i, col + j)}>${d.hayDatos ? numero(v) : ''}</td>`;
                        return `<tr><td class="conci-rep-dia"${xl(5 + i, col)}>${fecha}</td>${celda(llegada(d), 1)}${celda(salida(d), 2)}${celda(total(d), 3)}</tr>`;
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr class="conci-rep-fila-total">
                        <td${xl(5 + D, col)}>TOTAL</td>
                        <td class="num"${xl(5 + D, col + 1)}><u>${numero(suma(llegada))}</u></td>
                        <td class="num"${xl(5 + D, col + 2)}><u>${numero(suma(salida))}</u></td>
                        <td class="num"${xl(5 + D, col + 3)}><u>${numero(suma(total))}</u></td>
                    </tr>
                    <tr class="conci-rep-fila-promedio">
                        <td${xl(6 + D, col)}>PROMEDIO</td>
                        <td class="num"${xl(6 + D, col + 1)}>${decimal(promedio(llegada))}</td>
                        <td class="num"${xl(6 + D, col + 2)}>${decimal(promedio(salida))}</td>
                        <td class="num"${xl(6 + D, col + 3)}>${decimal(promedio(total))}</td>
                    </tr>
                </tfoot>
            </table>`;

        const cuerpo = `
            <div class="conci-rep-p2-rejilla">
                ${tabla('PASAJEROS', d => d.pax.llegada, d => d.pax.salida, paxTotal, 0)}
                ${tabla('OPERACIONES', d => d.ops.llegada, d => d.ops.salida, opsTotal, 5)}
            </div>
            <div class="conci-rep-p2-pie">
                <table class="conci-rep-maximos">
                    <tbody>
                        <tr><td class="conci-rep-etiqueta-vino"${xl(8 + D, 0)}>Máximo PAX del mes</td><td class="num"${xl(8 + D, 1)}><u>${numero(maximo(paxTotal))}</u></td></tr>
                        <tr><td class="conci-rep-etiqueta-vino"${xl(9 + D, 0)}>Máximo OP del mes</td><td class="num"${xl(9 + D, 1)}><u>${numero(maximo(opsTotal))}</u></td></tr>
                    </tbody>
                </table>
                <table class="conci-rep-maximos">
                    <tbody>
                        <tr><td class="conci-rep-hueco"></td><td class="conci-rep-th-simple">PAX</td><td class="conci-rep-th-simple">OP</td></tr>
                        <tr>
                            <td class="conci-rep-etiqueta-vino"${xl(10 + D, 0)}>PROMEDIO ANUAL</td>
                            <td class="num"${xl(10 + D, 1)}><u>${decimal(anual.pax / diasTranscurridos)}</u></td>
                            <td class="num"${xl(10 + D, 2)}><u>${decimal(anual.ops / diasTranscurridos)}</u></td>
                        </tr>
                    </tbody>
                </table>
            </div>`;

        return hoja(
            `NUMERALIA AEROPORTUARIA ${MESES[mes - 1]} ${anio}`,
            `Fecha de actualización: <strong><u>${fechaLarga(fechaIso)}</u></strong>`,
            cuerpo,
            true,
            { nota: 12 + D }
        );
    }

    const RENDERS = {
        subsecretaria: renderSubsecretaria,
        plantilla1: renderPlantilla1,
        plantilla2: renderPlantilla2
    };

    /* ── orquestación ───────────────────────────────────────────────────── */

    let ultimo = null;
    // Edición y marcatextos (js/conci-reportes-edicion.js); null si no cargó.
    let edicion = null;

    function pintar() {
        const salida = el('conci-rep-pax-salida');
        if (!salida || !ultimo) return;
        const calcular = () => (RENDERS[reporteActivo] || renderSubsecretaria)(ultimo);
        // Si el reporte de esa fecha se editó y guardó, se ve la versión editada.
        if (edicion) edicion.pintar(reporteActivo, ultimo.fechaIso, calcular);
        else salida.innerHTML = calcular();
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
        if (edicion && !edicion.soltar()) return;
        const campo = el('conci-rep-pax-fecha');
        const fechaIso = campo && campo.value;
        if (!fechaIso) { error('Elige la fecha del reporte.'); return; }

        const boton = el('btn-conci-rep-pax-generar');
        if (boton) boton.disabled = true;
        error('');
        estado('Leyendo manifiestos…');

        try {
            // Sin el catálogo cargado, la Plantilla 1 saldría con los códigos
            // IATA en vez del nombre comercial. A Reportes se puede llegar sin
            // haber abierto antes la tabla, que es quien normalmente lo carga.
            if (typeof window._ensureConciAirlineCatalog === 'function') {
                try { await window._ensureConciAirlineCatalog(); } catch (_) {}
            }
            const datos = await descargar(fechaIso, n => estado(`Leyendo manifiestos… ${numero(n)}`));
            ultimo = agregar(datos, fechaIso);
            if (edicion) await edicion.cargar(fechaIso);
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
        if (edicion && !edicion.soltar()) return;
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
        const { porDia, anioPlantillas, anio, mes, fechaIso } = datos;
        const conDatos = porDia.filter(d => d.hayDatos);
        const suma = sel => porDia.reduce((a, d) => a + sel(d), 0);
        const prom = sel => conDatos.length ? Math.round(suma(sel) / conDatos.length) : 0;
        const paxTotal = d => d.pax.llegada + d.pax.salida;
        const opsTotal = d => d.ops.llegada + d.ops.salida;

        const inicio = new Date(anio, 0, 1);
        const corte = new Date(`${fechaIso}T12:00:00`);
        const dias = Math.max(1, Math.round((corte - inicio) / 86400000));
        const anual = anioPlantillas;

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
            ['PROMEDIO ANUAL', Math.round(anual.pax / dias), Math.round(anual.ops / dias)],
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
        // Lo que se ve es lo que se descarga: las celdas corregidas a mano y sus
        // colores de marcatextos pasan al Excel.
        const E = window.ConciReportesEdicion;
        const vista = el('conci-rep-pax-salida');
        let marcas = [];
        if (E && vista && vista.querySelector('[data-xl]')) {
            const calculado = document.createElement('div');
            calculado.innerHTML = RENDERS[reporteActivo](ultimo);
            marcas = E.aplicarAFilas(filas, vista, calculado);
        }
        const hojaExcel = XLSX.utils.aoa_to_sheet(filas);
        const libro = XLSX.utils.book_new();
        const etiqueta = esP1 ? 'Plantilla 1' : 'Plantilla 2';
        XLSX.utils.book_append_sheet(libro, hojaExcel, etiqueta);
        const archivo = nombreArchivo(
            `${etiqueta} - Numeralia ${MESES[ultimo.mes - 1]} ${ultimo.anio} - ${fechaLarga(ultimo.fechaIso)}.xlsx`
        );
        if (!marcas.length || !window.JSZip) { XLSX.writeFile(libro, archivo); return undefined; }
        const bytes = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
        return E.colorearXlsx(bytes, marcas, window.JSZip)
            .then(conColor => E.bajarArchivo(conColor, archivo,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
            .catch(e => {
                // Sin colores es mejor que sin archivo.
                console.error('[Reportes Pasajeros] colores del Excel', e);
                XLSX.writeFile(libro, archivo);
            });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const campo = el('conci-rep-pax-fecha');
        if (campo && !campo.value) {
            const hoy = new Date();
            campo.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        }
        // Se ve dd/mm/aaaa aunque el navegador esté en inglés. La máscara es
        // idempotente, así que no importa si la tabla de Manifiestos ya la montó.
        if (typeof window._conciInitCamposFecha === 'function') {
            window._conciInitCamposFecha(el('conci-rep-pax-fecha')?.parentElement || document);
        }
        el('btn-conci-rep-pax-generar')?.addEventListener('click', generar);
        el('btn-conci-rep-pax-imprimir')?.addEventListener('click', imprimir);
        el('btn-conci-rep-pax-descargar')?.addEventListener('click', descargar_);
        if (window.ConciReportesEdicion) {
            edicion = window.ConciReportesEdicion.crear({
                area: 'pasajeros', prefijo: 'pax', alCambiar: pintar, avisar: estado, error
            });
        }
        // Cambiar la fecha invalida lo descargado: el rango pedido es otro.
        campo?.addEventListener('change', () => { cache = null; });
        document.querySelectorAll('[data-conci-rep-pax]').forEach(boton => {
            boton.addEventListener('click', () => elegirReporte(boton.dataset.conciRepPax, boton));
        });
    });

    window.conciReportesPasajeros = {
        generar, agregar, mostrar, aIso, imprimir, nombreAerolinea,
        descargar: descargar_,
        filasPlantilla1, filasPlantilla2,
        _cache: () => cache,
        _edicion: () => edicion
    };
})();
