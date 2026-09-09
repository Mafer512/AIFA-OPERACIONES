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

    function renderSubsecretaria(datos) {
        const { sub, fechaIso, anio, mes } = datos;
        const dia = sub.dia;
        const filaCruce = carril => `
            <tr>
                <td class="fw-semibold">${carril}</td>
                <td class="text-end">${numero(dia[carril].INTERNACIONAL.pax)}</td>
                <td class="text-end">${numero(dia[carril].NACIONAL.pax)}</td>
                <td class="text-end fw-semibold">${numero(dia[carril].INTERNACIONAL.pax + dia[carril].NACIONAL.pax)}</td>
                <td class="text-end">${numero(dia[carril].INTERNACIONAL.ops)}</td>
                <td class="text-end">${numero(dia[carril].NACIONAL.ops)}</td>
                <td class="text-end fw-semibold">${numero(dia[carril].INTERNACIONAL.ops + dia[carril].NACIONAL.ops)}</td>
            </tr>`;
        const tDia = totalesSub(dia);

        const bloques = [
            ['Del día', totalesSub(sub.dia)],
            [`A. Acumulado del mes de ${MESES[mes - 1].charAt(0) + MESES[mes - 1].slice(1).toLowerCase()} ${anio}`, totalesSub(sub.mes)],
            [`B. Acumulado en el año ${anio}`, totalesSub(sub.anio)],
            ['C. Acumulado desde el inicio de operaciones AIFA', totalesSub(sub.historico)]
        ];

        return `
        <div class="conci-rep-doc">
            <h5 class="conci-rep-titulo">Reporte a la Subsecretaría</h5>
            <p class="conci-rep-sub">Cierre Subsecretaría: <strong>${fechaLarga(fechaIso)}</strong></p>

            <div class="table-responsive mb-4">
                <table class="table table-sm table-bordered align-middle conci-rep-tabla mb-0">
                    <thead>
                        <tr>
                            <th rowspan="2" class="align-middle">Tipo de manifiesto</th>
                            <th colspan="3">Pasajeros (suma de TOTAL PAX)</th>
                            <th colspan="3">Operaciones (cuenta de AEROLÍNEA)</th>
                        </tr>
                        <tr>
                            <th>Internacional</th><th>Nacional</th><th>Total</th>
                            <th>Internacional</th><th>Nacional</th><th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filaCruce('LLEGADA')}
                        ${filaCruce('SALIDA')}
                    </tbody>
                    <tfoot>
                        <tr class="conci-rep-total">
                            <td>Total general</td>
                            <td class="text-end">${numero(tDia.internacional.pax)}</td>
                            <td class="text-end">${numero(tDia.nacional.pax)}</td>
                            <td class="text-end">${numero(tDia.total.pax)}</td>
                            <td class="text-end">${numero(tDia.internacional.ops)}</td>
                            <td class="text-end">${numero(tDia.nacional.ops)}</td>
                            <td class="text-end">${numero(tDia.total.ops)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <p class="fw-semibold mb-2" style="font-size:.85rem">Se envía la información correspondiente al:</p>
            <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle conci-rep-tabla mb-0">
                    <thead>
                        <tr>
                            <th rowspan="2" class="align-middle">Concepto</th>
                            <th colspan="3">Pasajeros</th>
                            <th colspan="3">Operaciones</th>
                        </tr>
                        <tr>
                            <th>Dato</th><th>Nacional</th><th>Internacional</th>
                            <th>Dato</th><th>Nacional</th><th>Internacional</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${bloques.map(([etiqueta, t]) => `
                            <tr>
                                <td class="fw-semibold">${escapar(etiqueta)}</td>
                                <td class="text-end fw-semibold">${numero(t.total.pax)}</td>
                                <td class="text-end">${numero(t.nacional.pax)}</td>
                                <td class="text-end">${numero(t.internacional.pax)}</td>
                                <td class="text-end fw-semibold">${numero(t.total.ops)}</td>
                                <td class="text-end">${numero(t.nacional.ops)}</td>
                                <td class="text-end">${numero(t.internacional.ops)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    function tablaAerolineas(mapa, titulo) {
        const filas = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
        const totalPax = filas.reduce((a, [, v]) => a + v.pax, 0);
        const totalOps = filas.reduce((a, [, v]) => a + v.ops, 0);
        const cuerpo = filas.length
            ? filas.map(([aerolinea, v]) => `
                <tr>
                    <td>${escapar(aerolinea)}</td>
                    <td class="text-end">${numero(v.pax)}</td>
                    <td class="text-end">${numero(v.ops)}</td>
                </tr>`).join('')
            : '<tr><td colspan="3" class="text-center text-muted py-3">Sin manifiestos de pasajeros en el periodo.</td></tr>';
        return `
            <p class="conci-rep-sub mb-2">${escapar(titulo)}</p>
            <div class="table-responsive mb-4">
                <table class="table table-sm table-bordered align-middle conci-rep-tabla mb-0">
                    <thead>
                        <tr><th>Aerolínea</th><th>Pax transportados</th><th>Número de operaciones</th></tr>
                    </thead>
                    <tbody>${cuerpo}</tbody>
                    <tfoot>
                        <tr class="conci-rep-total">
                            <td>TOTAL</td>
                            <td class="text-end">${numero(totalPax)}</td>
                            <td class="text-end">${numero(totalOps)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;
    }

    function renderPlantilla1(datos) {
        const { porAerolinea, fechaIso, anio, mes } = datos;
        return `
        <div class="conci-rep-doc">
            <h5 class="conci-rep-titulo">Numeralia aeroportuaria ${MESES[mes - 1]} ${anio}</h5>
            <p class="conci-rep-sub">Fecha de actualización: <strong>${fechaLarga(fechaIso)}</strong></p>
            ${tablaAerolineas(porAerolinea.dia, `Del día ${fechaLarga(fechaIso)}`)}
            ${tablaAerolineas(porAerolinea.mes, `Cifras acumuladas: ${MESES[mes - 1].charAt(0) + MESES[mes - 1].slice(1).toLowerCase()}`)}
        </div>`;
    }

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

        const filas = porDia.map((d, i) => {
            const fecha = `${String(i + 1).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
            const vacio = !d.hayDatos;
            const celda = v => vacio ? '<td class="text-end text-muted">—</td>' : `<td class="text-end">${numero(v)}</td>`;
            return `
                <tr${vacio ? ' class="conci-rep-sin-datos"' : ''}>
                    <td>${fecha}</td>
                    ${celda(d.pax.llegada)}${celda(d.pax.salida)}${celda(paxTotal(d))}
                    ${celda(d.ops.llegada)}${celda(d.ops.salida)}${celda(opsTotal(d))}
                </tr>`;
        }).join('');

        return `
        <div class="conci-rep-doc">
            <h5 class="conci-rep-titulo">Numeralia aeroportuaria ${MESES[mes - 1]} ${anio}</h5>
            <p class="conci-rep-sub">Fecha de actualización: <strong>${fechaLarga(fechaIso)}</strong></p>

            <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle conci-rep-tabla mb-0">
                    <thead>
                        <tr>
                            <th rowspan="2" class="align-middle">Fecha</th>
                            <th colspan="3">Pasajeros</th>
                            <th colspan="3">Operaciones</th>
                        </tr>
                        <tr>
                            <th>Llegada</th><th>Salida</th><th>Total</th>
                            <th>Llegada</th><th>Salida</th><th>Total</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                    <tfoot>
                        <tr class="conci-rep-total">
                            <td>TOTAL</td>
                            <td class="text-end">${numero(suma(d => d.pax.llegada))}</td>
                            <td class="text-end">${numero(suma(d => d.pax.salida))}</td>
                            <td class="text-end">${numero(suma(paxTotal))}</td>
                            <td class="text-end">${numero(suma(d => d.ops.llegada))}</td>
                            <td class="text-end">${numero(suma(d => d.ops.salida))}</td>
                            <td class="text-end">${numero(suma(opsTotal))}</td>
                        </tr>
                        <tr class="conci-rep-promedio">
                            <td>PROMEDIO</td>
                            <td class="text-end">${decimal(promedio(d => d.pax.llegada))}</td>
                            <td class="text-end">${decimal(promedio(d => d.pax.salida))}</td>
                            <td class="text-end">${decimal(promedio(paxTotal))}</td>
                            <td class="text-end">${decimal(promedio(d => d.ops.llegada))}</td>
                            <td class="text-end">${decimal(promedio(d => d.ops.salida))}</td>
                            <td class="text-end">${decimal(promedio(opsTotal))}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div class="d-flex gap-4 flex-wrap mt-3">
                <div class="conci-rep-dato"><span>Máximo PAX del mes</span><strong>${numero(maximo(paxTotal))}</strong></div>
                <div class="conci-rep-dato"><span>Máximo OP del mes</span><strong>${numero(maximo(opsTotal))}</strong></div>
                <div class="conci-rep-dato"><span>Promedio anual PAX</span><strong>${decimal(anual.total.pax / diasTranscurridos)}</strong></div>
                <div class="conci-rep-dato"><span>Promedio anual OP</span><strong>${decimal(anual.total.ops / diasTranscurridos)}</strong></div>
            </div>
        </div>`;
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
        pintar();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const campo = el('conci-rep-pax-fecha');
        if (campo && !campo.value) {
            const hoy = new Date();
            campo.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        }
        el('btn-conci-rep-pax-generar')?.addEventListener('click', generar);
        // Cambiar la fecha invalida lo descargado: el rango pedido es otro.
        campo?.addEventListener('change', () => { cache = null; });
        document.querySelectorAll('[data-conci-rep-pax]').forEach(boton => {
            boton.addEventListener('click', () => elegirReporte(boton.dataset.conciRepPax, boton));
        });
    });

    window.conciReportesPasajeros = { generar, agregar, aIso, _cache: () => cache };
})();
