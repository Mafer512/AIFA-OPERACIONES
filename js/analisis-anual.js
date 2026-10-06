/**
 * Análisis Anual - Dashboard Module
 * Fetches data from:
 *   - parte_operations  → promedios mensuales por tipo de aviación
 *   - annual_operations → KPIs anuales consolidados
 *   - daily_flights_ops → pasajeros por aerolínea
 */
(function() {
    let annualChart = null;
    let airlinePaxChart = null;

    document.addEventListener('DOMContentLoaded', () => {
        const triggerBtn = document.querySelector('button[data-bs-target="#analisis-anual-pane"]');

        let lastLoadedYear = null;

        const loadHandler = () => {
            const year = getSelectedYear();
            if (lastLoadedYear === year && window._annualDataLoaded) return; // Prevenir re-fething lag
            lastLoadedYear = year;
            window._annualDataLoaded = true;
            // Usamos requestAnimationFrame en vez de setTimeout para que la UI no se congele durante el cambio de pestaña
            requestAnimationFrame(() => requestAnimationFrame(runAnnualAnalysis));
        };

        if (triggerBtn) triggerBtn.addEventListener('shown.bs.tab', loadHandler);

        const refreshBtn = document.getElementById('btn-refresh-annual');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { lastLoadedYear = null; runAnnualAnalysis(); });

        // Year selector change triggers full reload
        const yearSel = document.getElementById('annual-year-select');
        if (yearSel) yearSel.addEventListener('change', () => { lastLoadedYear = null; runAnnualAnalysis(); });
    });

    function getSelectedYear() {
        const sel = document.getElementById('annual-year-select');
        return sel ? parseInt(sel.value, 10) : 2025;
    }

    async function runAnnualAnalysis() {
        const year = getSelectedYear();
        // Update badge
        const badge = document.getElementById('airline-pax-year-badge');
        if (badge) badge.textContent = year;

        if (!window.supabaseClient) {
            console.error('Supabase client not available.');
            return;
        }

        const chartCanvas = document.getElementById('ops-annual-averages-chart');
        if (chartCanvas) chartCanvas.style.opacity = '0.5';

        // Launch KPI cards in parallel (non-blocking)
        runAnnualKPICards(year);
        // runAirlinePaxRanking(year); // Removing per user request

        try {
            const { data, error } = await window.supabaseClient
                .from('parte_operations')
                .select('*')
                .order('fecha', { ascending: true });

            if (chartCanvas) chartCanvas.style.opacity = '1';

            if (error) throw error;

            if (!data || data.length === 0) {
                renderEmpty();
                return;
            }

            processAnnualData(data, year);

        } catch (error) {
            console.error('Error fetching annual data:', error);
            if (chartCanvas) chartCanvas.style.opacity = '1';
        }
    }

    function processAnnualData(data, selectedYear) {
        if (data.length === 0) return;

        // Use selected year or fall back to latest year in data
        let latestYear = selectedYear;
        if (!latestYear) {
            const lastDate = data[data.length - 1].fecha;
            latestYear = parseInt(lastDate.split('-')[0], 10);
        }

        // Filter for selected year
        const yearData = data.filter(d => parseInt(d.fecha.split('-')[0], 10) === latestYear);

        // 1. Calculate Monthly Totals for Chart/Table
        const montlyTotals = new Array(12).fill(0);
        const commercialTotals = new Array(12).fill(0);
        const generalTotals = new Array(12).fill(0);
        const cargoTotals = new Array(12).fill(0);

        // 2. Metrics for Cards
        let totalCommercial = 0;
        let totalCargo = 0;
        let totalGeneral = 0;
        let totalOps = 0;
        
        let maxDailyOps = 0;
        let maxDailyDate = '';
        let maxDailyBreakdown = { com:0, car:0, gen:0 };
        
        let maxComDailyOps = 0;
        let maxComDailyDate = '';
        let maxComDailyBreakdown = { com:0, car:0, gen:0 };

        yearData.forEach(row => {
            const parts = row.fecha.split('-');
            const monthIndex = parseInt(parts[1], 10) - 1; // 0-11
            
            // Safe parsing
            const com = (row.comercial_llegada||0) + (row.comercial_salida||0);
            const car = (row.carga_llegada||0) + (row.carga_salida||0);
            const gen = (row.general_llegada||0) + (row.general_salida||0);
            const total = (row.total_general !== undefined && row.total_general !== null) ? row.total_general : (com + car + gen);

            // Chart/Table Accumulators
            montlyTotals[monthIndex] += total;
            commercialTotals[monthIndex] += com;
            cargoTotals[monthIndex] += car;
            generalTotals[monthIndex] += gen;

            // Global Accumulators
            totalCommercial += com;
            totalCargo += car;
            totalGeneral += gen;
            totalOps += total;

            // Peak Day Logic
            if (total > maxDailyOps) {
                maxDailyOps = total;
                maxDailyDate = row.fecha;
                maxDailyBreakdown = { com, car, gen };
            }

            // Peak Commercial Logic
            if (com > maxComDailyOps) {
                maxComDailyOps = com;
                maxComDailyDate = row.fecha;
                maxComDailyBreakdown = { com, car, gen };
            }
        });

        // Determine months count (current month index + 1 if current year, else 12)
        const now = new Date();
        const monthsCount = (latestYear === now.getFullYear()) ? (now.getMonth() + 1) : 12;

        const avgs = {
            com: Math.round(totalCommercial / monthsCount),
            car: Math.round(totalCargo / monthsCount),
            gen: Math.round(totalGeneral / monthsCount),
            total: Math.round(totalOps / monthsCount),
            monthsCaught: monthsCount
        };

        const peaks = {
            general: {
                val: maxDailyOps,
                date: maxDailyDate,
                breakdown: maxDailyBreakdown
            },
            commercial: {
                val: maxComDailyOps,
                date: maxComDailyDate,
                breakdown: maxComDailyBreakdown
            }
        };

        renderCards(avgs, peaks, latestYear);
        renderChart(montlyTotals, commercialTotals, cargoTotals, generalTotals, latestYear);
        renderTable(montlyTotals, commercialTotals, cargoTotals, generalTotals, latestYear);
    }

    function renderCards(avgs, peaks, year) {
        const container = document.getElementById('ops-annual-averages-cards');
        if (!container) return;

        const monthsLabel = `${avgs.monthsCaught} meses`;

        // Format Date Helper
        const formatDate = (dateStr) => {
            if(!dateStr) return '';
            const [y, m, d] = dateStr.split('-');
            const date = new Date(y, m-1, d);
            return date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        };
        const formatShortDate = (dateStr) => {
             if(!dateStr) return '';
            const [y, m, d] = dateStr.split('-');
            const date = new Date(y, m-1, d);
            return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        }
        
        // Uppercase first letter
        const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

        const peakGenDate = capitalize(formatDate(peaks.general.date));
        const peakComDate = capitalize(formatDate(peaks.commercial.date));

        const peakComPct = Math.round((peaks.commercial.val / (peaks.commercial.breakdown.com + peaks.commercial.breakdown.car + peaks.commercial.breakdown.gen)) * 100) || 0;

        container.style.display = 'block';
        container.innerHTML = `
            <div class="alert alert-secondary border-0 d-flex align-items-center mb-4 py-2" role="alert">
                <i class="fas fa-chart-line fs-4 me-3 text-primary"></i>
                <div>
                   <div class="fw-bold">Promedios mensuales por tipo de aviación</div>
                   <div class="small">Calculados con todas las capturas disponibles durante el año seleccionado (${year}).</div>
                </div>
            </div>

            <div class="d-flex flex-nowrap overflow-auto pb-3 gap-3" style="scroll-behavior: smooth;">
                <!-- Aviación Comercial -->
                <div class="card border-0 shadow-sm flex-shrink-0" style="min-width: 260px; background-color: #f8f9fa;">
                    <div class="card-body">
                         <h6 class="text-uppercase text-muted small fw-bold mb-3"><i class="fas fa-users me-1"></i> AVIACIÓN COMERCIAL</h6>
                         <h1 class="display-5 fw-bold text-dark mb-3">${avgs.com}</h1>
                         <div class="d-flex align-items-center">
                            <span class="badge bg-primary bg-opacity-10 text-primary me-2"><i class="fas fa-calendar-alt me-1"></i> ${monthsLabel}</span>
                            <span class="text-muted small">Promedio mensual</span>
                         </div>
                    </div>
                </div>

                <!-- Aviación Carga -->
                <div class="card border-0 shadow-sm flex-shrink-0" style="min-width: 260px; background-color: #f8f9fa;">
                    <div class="card-body">
                         <h6 class="text-uppercase text-muted small fw-bold mb-3"><i class="fas fa-box-open me-1"></i> AVIACIÓN DE CARGA</h6>
                         <h1 class="display-5 fw-bold text-dark mb-3">${avgs.car}</h1>
                         <div class="d-flex align-items-center">
                            <span class="badge bg-warning bg-opacity-10 text-warning me-2"><i class="fas fa-calendar-alt me-1"></i> ${monthsLabel}</span>
                            <span class="text-muted small">Promedio mensual</span>
                         </div>
                    </div>
                </div>

                 <!-- Aviación General -->
                <div class="card border-0 shadow-sm flex-shrink-0" style="min-width: 260px; background-color: #f8f9fa;">
                    <div class="card-body">
                         <h6 class="text-uppercase text-muted small fw-bold mb-3"><i class="fas fa-plane me-1"></i> AVIACIÓN GENERAL</h6>
                         <h1 class="display-5 fw-bold text-dark mb-3">${avgs.gen}</h1>
                         <div class="d-flex align-items-center">
                            <span class="badge bg-success bg-opacity-10 text-success me-2"><i class="fas fa-calendar-alt me-1"></i> ${monthsLabel}</span>
                            <span class="text-muted small">Promedio mensual</span>
                         </div>
                    </div>
                </div>
                
                 <!-- Promedio General -->
                <div class="card border-0 shadow-sm flex-shrink-0" style="min-width: 260px; background-color: #f8f9fa;">
                    <div class="card-body">
                         <h6 class="text-uppercase text-muted small fw-bold mb-3"><i class="fas fa-chart-area me-1"></i> PROMEDIO GENERAL</h6>
                         <h1 class="display-5 fw-bold text-dark mb-3">${avgs.total}</h1>
                         <div class="d-flex align-items-center">
                            <span class="badge bg-secondary bg-opacity-10 text-secondary me-2"><i class="fas fa-calendar-alt me-1"></i> ${monthsLabel}</span>
                            <span class="text-muted small">Promedio mensual</span>
                         </div>
                    </div>
                </div>

                 <!-- Peak Day -->
                <div class="card border-0 shadow-sm flex-shrink-0" style="min-width: 320px; background-color: #f8f9fa;">
                    <div class="card-body">
                         <h6 class="text-uppercase text-muted small fw-bold mb-3"><i class="fas fa-calendar-day me-1"></i> DÍA CON MÁS OPERACIONES</h6>
                         <h1 class="display-5 fw-bold text-dark mb-2">${peaks.general.val}</h1>
                         <div class="d-flex align-items-center mb-2">
                            <span class="badge bg-warning bg-opacity-25 text-dark me-2 text-wrap text-start" style="font-weight:normal; line-height:1.2;">
                                <i class="fas fa-calendar me-1"></i> ${peakGenDate}
                            </span>
                            <span class="small text-muted">Pico anual</span>
                         </div>
                         <div class="small text-muted">
                            Comercial ${peaks.general.breakdown.com} · Carga ${peaks.general.breakdown.car} · Gral ${peaks.general.breakdown.gen}
                         </div>
                    </div>
                </div>
                
                 <!-- Peak Commercial Day -->
                <div class="card border-0 shadow-sm flex-shrink-0" style="min-width: 320px; background-color: #f8f9fa;">
                    <div class="card-body">
                         <h6 class="text-uppercase text-muted small fw-bold mb-3"><i class="fas fa-users me-1"></i> DÍA CON MÁS OPS COMERCIALES</h6>
                         <h1 class="display-5 fw-bold text-dark mb-2">${peaks.commercial.val}</h1>
                          <div class="d-flex align-items-center mb-2">
                            <span class="badge bg-primary bg-opacity-25 text-primary me-2 text-wrap text-start" style="font-weight:normal; line-height:1.2;">
                                <i class="fas fa-calendar me-1"></i> ${peakComDate}
                            </span>
                         </div>
                         <div class="small text-muted">
                            Total diario ${peaks.commercial.breakdown.com + peaks.commercial.breakdown.car + peaks.commercial.breakdown.gen} ops · ${peakComPct}% comercial
                         </div>
                    </div>
                </div>

            </div>
        `;
    }

    function renderChart(totals, com, cargo, gen, year) {
        const ctx = document.getElementById('ops-annual-averages-chart');
        if (!ctx) return;

        if (annualChart) annualChart.destroy();

        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        annualChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthNames,
                datasets: [
                    {
                        label: 'Comercial',
                        data: com,
                        backgroundColor: '#0d6efd',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Carga',
                        data: cargo,
                        backgroundColor: '#ffc107',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Aviación Gral.',
                        data: gen,
                        backgroundColor: '#198754',
                        stack: 'Stack 0'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, // Important so it fits container
                plugins: {
                    title: {
                        display: true,
                        text: `Distribución Mensual de Operaciones - ${year}`
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: { stacked: true },
                    y: { 
                        stacked: true,
                        beginAtZero: true 
                    }
                }
            }
        });
    }

    function renderTable(totals, com, cargo, gen, year) {
        const container = document.getElementById('ops-annual-averages-table');
        if (!container) return;

        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        let rows = '';
        let tCom = 0, tCar = 0, tGen = 0, tTot = 0;

        monthNames.forEach((m, i) => {
            if (totals[i] === 0 && i > new Date().getMonth() && year === new Date().getFullYear()) {
                return;
            }
            
            tCom += com[i];
            tCar += cargo[i];
            tGen += gen[i];
            tTot += totals[i];

            rows += `
                <tr>
                    <td>${m}</td>
                    <td class="text-end">${com[i].toLocaleString()}</td>
                    <td class="text-end">${cargo[i].toLocaleString()}</td>
                    <td class="text-end">${gen[i].toLocaleString()}</td>
                    <td class="text-end fw-bold">${totals[i].toLocaleString()}</td>
                </tr>
            `;
        });

        rows += `
            <tr class="table-light fw-bold">
                <td>TOTAL</td>
                <td class="text-end">${tCom.toLocaleString()}</td>
                <td class="text-end">${tCar.toLocaleString()}</td>
                <td class="text-end">${tGen.toLocaleString()}</td>
                <td class="text-end">${tTot.toLocaleString()}</td>
            </tr>
        `;

        container.innerHTML = `
            <table class="table table-sm table-hover table-bordered">
                <thead class="table-light">
                    <tr>
                        <th>Mes</th>
                        <th class="text-end">Comercial</th>
                        <th class="text-end">Carga</th>
                        <th class="text-end">General</th>
                        <th class="text-end">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    function renderEmpty() {
        const container = document.getElementById('ops-annual-averages-cards');
        if (container) container.innerHTML = '<div class="alert alert-info">No hay datos disponibles en parte_operations.</div>';
    }

    // ═══════════════════════════════════════════════════════
    // KPI Cards from annual_operations table
    // ═══════════════════════════════════════════════════════

    async function runAnnualKPICards(year) {
        const container = document.getElementById('annual-kpi-cards');
        if (!container) return;

        container.innerHTML = `<div class="text-center py-3 text-muted small"><div class="spinner-border spinner-border-sm me-2"></div>Cargando datos clave...</div>`;

        try {
            // Mismo total anual que el Inicio (js/totales-service.js).
            const filas = await window.TotalesService.filasAnuales();
            const data = filas.find((r) => Number(r.year) === Number(year)) || null;

            if (!data) {
                container.innerHTML = `<div class="alert alert-secondary py-2">No hay datos anuales consolidados para ${year}.</div>`;
                return;
            }

            renderAnnualKPICards(data);
        } catch (err) {
            console.error('Error fetching annual KPIs:', err);
            container.innerHTML = '<div class="alert alert-warning py-2">No se pudieron cargar los datos clave anuales.</div>';
        }
    }

    function renderAnnualKPICards(data) {
        const container = document.getElementById('annual-kpi-cards');
        if (!container) return;

        const fmt = n => (n != null ? Number(n).toLocaleString('es-MX') : '—');
        const fmtDec = n => (n != null ? Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

        const totalOps = (data.comercial_ops_total || 0) + (data.carga_ops_total || 0) + (data.general_ops_total || 0);
        const totalPax = (data.comercial_pax_total || 0) + (data.general_pax_total || 0);

        container.innerHTML = `
            <div class="alert alert-secondary border-0 d-flex align-items-center mb-3 py-2" role="note">
                <i class="fas fa-star fs-5 me-3 text-warning"></i>
                <div>
                    <div class="fw-bold">Datos clave del año ${data.year}</div>
                    <div class="small text-muted">Cifras consolidadas de operaciones en AIFA.</div>
                </div>
            </div>
            <div class="row g-3">
                <div class="col-6 col-md-3">
                    <div class="card border-0 shadow-sm h-100" style="border-left: 4px solid #0d6efd !important;">
                        <div class="card-body py-3 ps-3">
                            <div class="text-muted small text-uppercase fw-semibold mb-1">
                                <i class="fas fa-users me-1 text-primary"></i>Pasajeros Comerciales
                            </div>
                            <div class="fs-2 fw-bold text-primary lh-1 mb-1">${fmt(data.comercial_pax_total)}</div>
                            <div class="text-muted small">${fmt(data.comercial_ops_total)} vuelos com.</div>
                        </div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card border-0 shadow-sm h-100" style="border-left: 4px solid #ffc107 !important;">
                        <div class="card-body py-3 ps-3">
                            <div class="text-muted small text-uppercase fw-semibold mb-1">
                                <i class="fas fa-box-open me-1 text-warning"></i>Carga (Toneladas)
                            </div>
                            <div class="fs-2 fw-bold text-warning lh-1 mb-1">${fmtDec(data.carga_tons_total)}</div>
                            <div class="text-muted small">${fmt(data.carga_ops_total)} ops. de carga</div>
                        </div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card border-0 shadow-sm h-100" style="border-left: 4px solid #198754 !important;">
                        <div class="card-body py-3 ps-3">
                            <div class="text-muted small text-uppercase fw-semibold mb-1">
                                <i class="fas fa-plane me-1 text-success"></i>Aviación General
                            </div>
                            <div class="fs-2 fw-bold text-success lh-1 mb-1">${fmt(data.general_ops_total)}</div>
                            <div class="text-muted small">${fmt(data.general_pax_total)} pax. gral.</div>
                        </div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card border-0 shadow-sm h-100" style="border-left: 4px solid #0dcaf0 !important;">
                        <div class="card-body py-3 ps-3">
                            <div class="text-muted small text-uppercase fw-semibold mb-1">
                                <i class="fas fa-calculator me-1 text-info"></i>Total Operaciones
                            </div>
                            <div class="fs-2 fw-bold text-info lh-1 mb-1">${fmt(totalOps)}</div>
                            <div class="text-muted small">${fmt(totalPax)} pax. totales</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════
    // Pasajeros por Aerolínea from daily_flights_ops
    // ═══════════════════════════════════════════════════════

    async function runAirlinePaxRanking(year) {
        const loading = document.getElementById('airline-pax-loading');
        const content = document.getElementById('airline-pax-content');
        const empty   = document.getElementById('airline-pax-empty');

        if (loading) loading.classList.remove('d-none');
        if (content) content.classList.add('d-none');
        if (empty)   empty.classList.add('d-none');

        try {
            const client = window.supabaseClient;
            if (!client) throw new Error('Supabase client not available');

            const startDate = `${year}-01-01`;
            const endDate   = `${year}-12-31`;

            let allRows = [];
            let from = 0;
            const batchSize = 1000;
            let moreData = true;

            while (moreData) {
                const { data, error } = await client
                    .from('daily_flights_ops')
                    .select('aerolinea, pasajeros')
                    .gte('fecha', startDate)
                    .lte('fecha', endDate)
                    .range(from, from + batchSize - 1);

                if (error) throw error;

                if (data && data.length > 0) {
                    allRows = allRows.concat(data);
                    from += batchSize;
                    if (data.length < batchSize) moreData = false;
                } else {
                    moreData = false;
                }

                if (allRows.length > 150000) { moreData = false; }
            }

            if (loading) loading.classList.add('d-none');

            if (!allRows.length) {
                if (empty) empty.classList.remove('d-none');
                return;
            }

            // Aggregate by airline, summing pasajeros
            const airlineMap = {};
            allRows.forEach(row => {
                const airline = (row.aerolinea || 'Sin especificar').trim();
                const pax = parseInt(row.pasajeros, 10) || 0;
                airlineMap[airline] = (airlineMap[airline] || 0) + pax;
            });

            const sorted = Object.entries(airlineMap)
                .filter(([, pax]) => pax > 0)
                .sort((a, b) => b[1] - a[1]);

            if (!sorted.length) {
                if (empty) empty.classList.remove('d-none');
                return;
            }

            const totalPax = sorted.reduce((s, [, p]) => s + p, 0);

            renderAirlinePaxChart(sorted.slice(0, 15), totalPax);
            renderAirlinePaxTable(sorted, totalPax);

            if (content) content.classList.remove('d-none');

        } catch (err) {
            console.error('Error fetching airline pax ranking:', err);
            if (loading) loading.classList.add('d-none');
            if (empty) {
                empty.textContent = 'Error al cargar datos de aerolíneas. Verifica que la tabla daily_flights_ops exista y tenga datos.';
                empty.classList.remove('d-none');
            }
        }
    }

    function renderAirlinePaxChart(sortedTop, totalPax) {
        const ctx = document.getElementById('chart-airline-annual-pax');
        if (!ctx) return;

        if (airlinePaxChart) airlinePaxChart.destroy();

        const labels = sortedTop.map(([name]) => name);
        const values = sortedTop.map(([, pax]) => pax);

        const palette = [
            '#0d6efd','#198754','#ffc107','#dc3545','#0dcaf0',
            '#6610f2','#fd7e14','#20c997','#6c757d','#d63384',
            '#0d3b86','#155724','#856404','#721c24','#055160'
        ];

        airlinePaxChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Pasajeros',
                    data: values,
                    backgroundColor: palette.slice(0, labels.length),
                    borderRadius: 4,
                    borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pax = ctx.raw;
                                const pct = ((pax / totalPax) * 100).toFixed(1);
                                return ` ${pax.toLocaleString('es-MX')} pax (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            callback: val =>
                                val >= 1000000 ? (val / 1000000).toFixed(1) + 'M' :
                                val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val
                        }
                    },
                    y: { ticks: { font: { size: 11 } } }
                }
            }
        });
    }

    function renderAirlinePaxTable(sorted, totalPax) {
        const tbody = document.getElementById('tbody-airline-pax');
        if (!tbody) return;

        const fmt = n => n.toLocaleString('es-MX');
        const maxPax = sorted[0][1];

        const rows = sorted.map(([name, pax], i) => {
            const pct = ((pax / totalPax) * 100).toFixed(1);
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
            return `
                <tr>
                    <td class="text-center fw-bold">${medal}</td>
                    <td>${name}</td>
                    <td class="text-end fw-bold">${fmt(pax)}</td>
                    <td class="text-end text-muted small">${pct}%</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rows + `
            <tr class="table-light fw-bold border-top">
                <td colspan="2">TOTAL</td>
                <td class="text-end">${fmt(totalPax)}</td>
                <td class="text-end">100%</td>
            </tr>
        `;
    }

})();
