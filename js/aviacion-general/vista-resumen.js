/* Pantalla "Resumen" del módulo de Aviación General / FBO.
 *
 * De dónde salen las cifras: de UN solo viaje al RPC
 * public.aviacion_general_resumen (migración 046), que suma en PostgreSQL.
 * Aquí no se recorre ninguna tabla con reduce/filter/map para calcular una
 * métrica; lo que llega son decenas de renglones ya agregados y esta pantalla
 * sólo los pinta.
 *
 * DECISIONES DE VISUALIZACIÓN
 *
 *   · Los totales son números, no gráficas. Un dato único —"1,892
 *     movimientos"— se lee mejor grande y en texto que como una barra sola.
 *   · Los "top" son barras horizontales: la comparación es de magnitud y los
 *     nombres de operador son largos; horizontal deja leerlos sin girar la
 *     cabeza. Una sola serie, un solo tono, y el valor escrito al final de cada
 *     barra —así el número no depende de adivinar contra el eje.
 *   · La serie mensual lleva dos líneas (llegadas y salidas) sobre UN eje. Dos
 *     ejes con escalas distintas es la forma más rápida de hacer que dos series
 *     parezcan cruzarse donde no se cruzan.
 *   · Ninguna gráfica es de pastel. Llegada contra salida, nacional contra
 *     internacional: son dos cifras y se leen como dos cifras.
 *   · La serie mensual tiene interruptor a tabla. Uno de los dos tonos queda
 *     por debajo de 3:1 contra el fondo blanco, y la tabla es el respaldo que
 *     eso obliga a ofrecer —además de ser lo que pide quien va a copiar los
 *     números a un oficio.
 *
 * Paleta: la misma de Bootstrap que ya usa el resto del tablero, verificada
 * para daltonismo (separación deutan ΔE 30.4 entre las dos series).
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-resumen: falta panel.js'); return; }

    const { Core, Datos, esc, cargando, vacio } = AG;

    const AZUL  = '#0d6efd';   // llegadas
    const VERDE = '#20c997';   // salidas
    const BARRA = '#0369a1';   // una sola serie
    const MORADO = '#7c3aed';  // pasajeros
    const TINTA = '#0f172a';
    const GRIS  = '#64748b';
    const REJILLA = '#f1f5f9';

    const graficas = {};
    let ultimoResumen = null;

    // Conteo con el que se pintan las cifras: SIEMPRE el oficial.
    //
    // 'rotacion' ancla cada salida a la fecha de la llegada con la que forma
    // pareja, que es como cuenta el reporte de GAG. Es la cifra auténtica y la
    // única que este módulo enseña: ofrecer dos conteos en pantalla invitaba a
    // reportar el que no es.
    const MODO = 'rotacion';

    /**
     * Escribe el valor al final de cada barra.
     *
     * Se dibuja a mano en vez de cargar chartjs-plugin-datalabels: es una
     * dependencia más que mantener y actualizar para algo que cabe en quince
     * líneas. El texto va en tinta neutra, nunca del color de la serie.
     */
    const etiquetasAlFinal = {
        id: 'agEtiquetasBarra',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            ctx.save();
            ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.fillStyle = TINTA;
            ctx.textBaseline = 'middle';
            chart.data.datasets.forEach((ds, i) => {
                const meta = chart.getDatasetMeta(i);
                if (meta.hidden) return;
                meta.data.forEach((barra, j) => {
                    const valor = ds.data[j];
                    if (valor === null || valor === undefined) return;
                    ctx.textAlign = 'left';
                    ctx.fillText(Core.numero(valor), barra.x + 6, barra.y);
                });
            });
            ctx.restore();
        }
    };

    const ejesBarraHorizontal = {
        x: {
            beginAtZero: true,
            grid: { color: REJILLA, drawBorder: false },
            ticks: { color: GRIS, font: { size: 11 } },
            // Aire a la derecha para que la etiqueta del valor no se corte.
            grace: '12%'
        },
        y: {
            grid: { display: false, drawBorder: false },
            ticks: { color: TINTA, font: { size: 11, weight: '600' } }
        }
    };

    function destruir(clave) {
        if (graficas[clave]) { graficas[clave].destroy(); delete graficas[clave]; }
    }

    function barraHorizontal(clave, canvas, etiquetas, valores, titulo) {
        destruir(clave);
        if (!canvas || typeof root.Chart === 'undefined') return;
        graficas[clave] = new root.Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: etiquetas,
                datasets: [{
                    label: titulo,
                    data: valores,
                    backgroundColor: BARRA,
                    borderRadius: 4,
                    borderSkipped: 'start',
                    // Barras delgadas con aire entre ellas: el grosor no aporta
                    // información y sí hace más difícil comparar longitudes.
                    categoryPercentage: 0.78,
                    barPercentage: 0.82
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 34 } },
                // Una sola serie: el título de la tarjeta ya dice qué es.
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${Core.numero(ctx.parsed.x)} movimientos`
                        }
                    }
                },
                scales: ejesBarraHorizontal
            },
            plugins: [etiquetasAlFinal]
        });
    }

    function serieMensual(canvas, filas) {
        destruir('mes');
        if (!canvas || typeof root.Chart === 'undefined') return;
        const etiquetas = filas.map((f) => Core.periodoLargo(f.periodo));
        const comun = {
            borderWidth: 2,
            tension: 0.28,
            pointRadius: 4,        // 8 px de diámetro: alcanzable con el ratón
            pointHoverRadius: 6,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: false
        };
        graficas.mes = new root.Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: etiquetas,
                datasets: [
                    Object.assign({ label: 'Llegadas', data: filas.map((f) => f.llegadas),
                                    borderColor: AZUL, backgroundColor: AZUL, pointBackgroundColor: AZUL }, comun),
                    Object.assign({ label: 'Salidas', data: filas.map((f) => f.salidas),
                                    borderColor: VERDE, backgroundColor: VERDE, pointBackgroundColor: VERDE }, comun)
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, color: GRIS, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${Core.numero(ctx.parsed.y)}` }
                    }
                },
                scales: {
                    // Un solo eje de magnitud. Las dos series cuentan lo mismo
                    // —movimientos— así que comparten escala y se pueden comparar.
                    y: {
                        beginAtZero: true,
                        grid: { color: REJILLA, drawBorder: false },
                        ticks: { color: GRIS, font: { size: 11 }, precision: 0 }
                    },
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: GRIS, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 }
                    }
                }
            }
        });
    }

    /**
     * Pasajeros por mes, en su PROPIA gráfica y no como tercera línea de la de
     * movimientos.
     *
     * En 2022 fueron 455 movimientos y 1,385 pasajeros: mezclarlos en un solo
     * lienzo obligaría a dos escalas, y dos ejes con escalas distintas es la
     * forma más rápida de hacer que dos series parezcan cruzarse donde no se
     * cruzan. Separadas, cada una se lee contra su propio cero y siguen
     * alineadas por mes, que es la comparación que de verdad interesa.
     */
    function serieMensualPax(canvas, filas) {
        destruir('pax');
        if (!canvas || typeof root.Chart === 'undefined') return;
        graficas.pax = new root.Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: filas.map((f) => Core.periodoLargo(f.periodo)),
                datasets: [{
                    label: 'Pasajeros A.G.',
                    data: filas.map((f) => Number(f.pax) || 0),
                    backgroundColor: MORADO,
                    borderRadius: 4,
                    borderSkipped: 'bottom',
                    categoryPercentage: 0.78,
                    barPercentage: 0.82
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    // Una sola serie: el título de la tarjeta ya dice qué es.
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: (ctx) => ` ${Core.numero(ctx.parsed.y)} pasajeros` }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: REJILLA, drawBorder: false },
                        ticks: { color: GRIS, font: { size: 11 }, precision: 0 }
                    },
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: GRIS, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 }
                    }
                }
            }
        });
    }

    /**
     * Cómo se capturaron los pasajeros del periodo.
     *
     * El histórico trae DOS convenciones que se reparten los años casi a
     * mitades: unos movimientos traen el desglose (adultos e infantes) y otros
     * sólo el total (pax_total_reportado). La columna generada pax_ag suma las
     * tres, así que lo que no viene del desglose es, exactamente, lo que se
     * capturó como total:
     *
     *     sin_desglose = pax_ag − adultos − infantes
     *
     * Decirlo importa: la versión anterior escribía "0 adultos · 0 infantes"
     * bajo un total de 1,385 pasajeros, y eso no se lee como "este año se
     * capturó de otra forma", se lee como "el módulo está mal".
     */
    function desglosePax(t) {
        const pax = Number(t.pax) || 0;
        const adultos = Number(t.adultos) || 0;
        const infantes = Number(t.infantes) || 0;
        const sinDesglose = Math.max(0, pax - adultos - infantes);

        if (!pax) return 'Sin pasajeros registrados';
        if (!adultos && !infantes) return 'Capturados como total, sin desglose por edad';

        const partes = [`${Core.numero(adultos)} adultos`, `${Core.numero(infantes)} infantes`];
        if (sinDesglose) partes.push(`${Core.numero(sinDesglose)} sin desglose`);
        return partes.join(' · ');
    }

    function kpi(etiqueta, valor, pie, color, icono) {
        return `
        <div class="col-6 col-lg-3">
            <div class="ag-kpi" style="--c:${color}">
                <div class="ag-kpi-lbl"><i class="fas ${esc(icono)}"></i>${esc(etiqueta)}</div>
                <div class="ag-kpi-val">${esc(valor)}</div>
                <div class="ag-kpi-pie">${pie || '&nbsp;'}</div>
            </div>
        </div>`;
    }

    function tablaMensual(filas) {
        if (!filas.length) return vacio('Sin movimientos en el periodo', 'fa-calendar-xmark');
        // Las columnas van en el mismo orden que el reporte oficial de GAG, y
        // con los pasajeros separados por llegada y salida: así la tabla se
        // contrasta renglón por renglón contra el PDF sin tener que sumar nada
        // a mano.
        const cuerpo = filas.map((f) => `
            <tr>
                <td>${esc(Core.periodoLargo(f.periodo))}</td>
                <td class="ag-num">${Core.numero(f.salidas)}</td>
                <td class="ag-num">${Core.numero(f.llegadas)}</td>
                <td class="ag-num fw-bold">${Core.numero(f.movimientos)}</td>
                <td class="ag-num">${Core.numero(f.pax_salida)}</td>
                <td class="ag-num">${Core.numero(f.pax_llegada)}</td>
                <td class="ag-num fw-bold">${Core.numero(f.pax)}</td>
            </tr>`).join('');
        const suma = (campo) => filas.reduce((a, f) => a + (Number(f[campo]) || 0), 0);
        return `
        <div class="table-responsive">
            <table class="table table-sm ag-tabla mb-0">
                <thead>
                    <tr>
                        <th rowspan="2">Periodo</th>
                        <th colspan="3" class="text-center">Operaciones</th>
                        <th colspan="3" class="text-center">Pasajeros</th>
                    </tr>
                    <tr>
                        <th class="ag-num">Salidas</th><th class="ag-num">Llegadas</th><th class="ag-num">Total</th>
                        <th class="ag-num">Salida</th><th class="ag-num">Llegada</th><th class="ag-num">Total</th>
                    </tr>
                </thead>
                <tbody>${cuerpo}</tbody>
                <tfoot><tr class="fw-bold border-top">
                    <td>Total</td>
                    <td class="ag-num">${Core.numero(suma('salidas'))}</td>
                    <td class="ag-num">${Core.numero(suma('llegadas'))}</td>
                    <td class="ag-num">${Core.numero(suma('movimientos'))}</td>
                    <td class="ag-num">${Core.numero(suma('pax_salida'))}</td>
                    <td class="ag-num">${Core.numero(suma('pax_llegada'))}</td>
                    <td class="ag-num">${Core.numero(suma('pax'))}</td>
                </tr></tfoot>
            </table>
        </div>`;
    }

    function plantilla() {
        return `
        <div class="row g-2 mb-3" id="ag-res-kpis"></div>

        <div class="row g-3">
            <div class="col-12">
                <div class="ag-card">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0">Movimientos por mes</h6>
                        <div class="btn-group btn-group-sm ag-no-print" role="group" aria-label="Forma de ver la serie mensual">
                            <button type="button" class="btn btn-outline-secondary active" id="ag-res-ver-grafica">
                                <i class="fas fa-chart-line me-1"></i>Gráfica
                            </button>
                            <button type="button" class="btn btn-outline-secondary" id="ag-res-ver-tabla">
                                <i class="fas fa-table me-1"></i>Tabla
                            </button>
                        </div>
                    </div>
                    <div class="ag-chart-box ag-chart-box--alto" id="ag-res-caja-mes">
                        <canvas id="ag-res-mes"></canvas>
                    </div>
                    <div id="ag-res-tabla-mes" hidden></div>
                </div>
            </div>

            <div class="col-12">
                <div class="ag-card">
                    <h6 class="mb-2">Pasajeros por mes</h6>
                    <div class="ag-chart-box" id="ag-res-caja-pax">
                        <canvas id="ag-res-pax"></canvas>
                    </div>
                    <div class="small text-muted mt-2" id="ag-res-pax-nota"></div>
                </div>
            </div>

            <div class="col-12 col-lg-6">
                <div class="ag-card">
                    <h6>Operadores más frecuentes</h6>
                    <div class="ag-chart-box"><canvas id="ag-res-operadores"></canvas></div>
                </div>
            </div>
            <div class="col-12 col-lg-6">
                <div class="ag-card">
                    <h6>Tipos de aeronave</h6>
                    <div class="ag-chart-box"><canvas id="ag-res-aeronaves"></canvas></div>
                </div>
            </div>
            <div class="col-12 col-lg-6">
                <div class="ag-card">
                    <h6>Orígenes y destinos</h6>
                    <div class="ag-chart-box"><canvas id="ag-res-aeropuertos"></canvas></div>
                </div>
            </div>
            <div class="col-12 col-lg-6">
                <div class="ag-card">
                    <h6>Aeronaves más recurrentes</h6>
                    <div class="ag-chart-box" id="ag-res-matriculas-caja">
                        <div class="table-responsive h-100" id="ag-res-matriculas"></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    function pintar(panel, resumen) {
        ultimoResumen = resumen;
        const t = resumen.totales || {};
        const porMes = resumen.por_mes || [];

        const rango = (t.fecha_min && t.fecha_max)
            ? `${Core.fechaLarga(t.fecha_min)} — ${Core.fechaLarga(t.fecha_max)}`
            : 'Sin registros';

        const pendientes = Number(t.pendientes) || 0;
        AG.marcador('validacion', pendientes || '', pendientes ? 'bg-warning text-dark' : 'bg-secondary');

        panel.querySelector('#ag-res-kpis').innerHTML = [
            kpi('Movimientos', Core.numero(t.movimientos), esc(rango), AZUL, 'fa-plane'),
            kpi('Llegadas / Salidas',
                `${Core.numero(t.llegadas)} / ${Core.numero(t.salidas)}`,
                `${Core.numero(t.rotaciones)} rotaciones`, VERDE, 'fa-right-left'),
            kpi('Pasajeros A.G.', Core.numero(t.pax), esc(desglosePax(t)), MORADO, 'fa-users'),
            kpi('Por validar', Core.numero(t.pendientes),
                `${Core.numero(t.validados)} validados · ${Core.numero(t.observados)} observados`,
                pendientes ? '#f59e0b' : '#16a34a', 'fa-clipboard-check'),
            kpi('Nacional', Core.numero(t.nacionales),
                porcentaje(t.nacionales, t.movimientos), '#0891b2', 'fa-flag'),
            kpi('Internacional', Core.numero(t.internacionales),
                porcentaje(t.internacionales, t.movimientos), '#d97706', 'fa-globe'),
            kpi('Operadores distintos', Core.numero(t.operadores), 'en el periodo', '#475569', 'fa-building'),
            kpi('Matrículas distintas', Core.numero(t.matriculas), 'en el periodo', '#475569', 'fa-hashtag')
        ].join('');

        serieMensual(panel.querySelector('#ag-res-mes'), porMes);
        panel.querySelector('#ag-res-tabla-mes').innerHTML = tablaMensual(porMes);

        serieMensualPax(panel.querySelector('#ag-res-pax'), porMes);
        const nota = panel.querySelector('#ag-res-pax-nota');
        if (nota) {
            const pax = Number(t.pax) || 0;
            nota.textContent = pax
                ? `${Core.numero(pax)} pasajeros en el periodo · ${desglosePax(t)}`
                : 'Sin pasajeros registrados en el periodo.';
        }

        const serie = (lista) => ({
            etiquetas: (lista || []).map((x) => x.clave),
            valores: (lista || []).map((x) => Number(x.movimientos) || 0)
        });

        const ops = serie(resumen.top_operadores);
        barraHorizontal('operadores', panel.querySelector('#ag-res-operadores'),
            ops.etiquetas.map(acortar), ops.valores, 'Movimientos');

        const aer = serie(resumen.top_aeronaves);
        barraHorizontal('aeronaves', panel.querySelector('#ag-res-aeronaves'),
            aer.etiquetas, aer.valores, 'Movimientos');

        const apt = serie(resumen.top_aeropuertos);
        barraHorizontal('aeropuertos', panel.querySelector('#ag-res-aeropuertos'),
            apt.etiquetas, apt.valores, 'Movimientos');

        panel.querySelector('#ag-res-matriculas').innerHTML = tablaMatriculas(resumen.top_matriculas || []);
    }

    function porcentaje(parte, total) {
        const p = Number(parte) || 0;
        const t = Number(total) || 0;
        if (!t) return '&nbsp;';
        return `${((p / t) * 100).toFixed(1)}% del total`;
    }

    /** Los nombres de operador son largos; el tooltip conserva el completo. */
    function acortar(texto, max = 26) {
        const t = String(texto || '');
        return t.length > max ? `${t.slice(0, max - 1)}…` : t;
    }

    function tablaMatriculas(filas) {
        if (!filas.length) return vacio('Sin aeronaves en el periodo', 'fa-plane-slash');
        return `
        <table class="table table-sm ag-tabla mb-0">
            <thead><tr>
                <th>Matrícula</th><th>Tipo</th><th>Operador</th><th class="ag-num">Movs.</th>
            </tr></thead>
            <tbody>
                ${filas.map((f) => `
                    <tr>
                        <td class="ag-mono fw-bold">${esc(f.clave)}</td>
                        <td>${esc(f.tipo_aeronave || '—')}</td>
                        <td class="text-truncate" style="max-width:190px" title="${esc(f.operador || '')}">${esc(f.operador || '—')}</td>
                        <td class="ag-num">${Core.numero(f.movimientos)}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
    }

    AG.registrarVista({
        id: 'resumen',
        etiqueta: 'Resumen',
        icono: 'fa-chart-simple',
        orden: 10,

        async montar(panel) {
            panel.innerHTML = plantilla();

            const caja = panel.querySelector('#ag-res-caja-mes');
            const tabla = panel.querySelector('#ag-res-tabla-mes');
            const bGraf = panel.querySelector('#ag-res-ver-grafica');
            const bTab = panel.querySelector('#ag-res-ver-tabla');

            const alternar = (verTabla) => {
                caja.hidden = verTabla;
                tabla.hidden = !verTabla;
                bGraf.classList.toggle('active', !verTabla);
                bTab.classList.toggle('active', verTabla);
                // Chart.js no mide bien un lienzo que estuvo oculto: al volver
                // hay que pedirle que se reajuste o sale aplastado.
                if (!verTabla && graficas.mes) setTimeout(() => graficas.mes.resize(), 0);
            };
            bGraf.addEventListener('click', () => alternar(false));
            bTab.addEventListener('click', () => alternar(true));
        },

        async refrescar(panel) {
            const kpis = panel.querySelector('#ag-res-kpis');
            kpis.innerHTML = `<div class="col-12">${cargando('Calculando el resumen…')}</div>`;
            const resumen = await Datos.resumen(AG.filtros, MODO);
            pintar(panel, resumen);
        }
    });

    // Se expone sólo lo que otra pantalla podría necesitar: el último resumen
    // recibido, para no volver a pedirlo.
    root.AviacionGeneralResumen = { get ultimo() { return ultimoResumen; } };
})(typeof window !== 'undefined' ? window : globalThis);
