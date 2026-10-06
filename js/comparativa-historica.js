/**
 * Comparativa YOY (Year-Over-Year) - Dashboard Module
 * Fetches data from monthly_operations.
 */
(function() {
    let yoyChart = null;
    let dataLoaded = false;
    let opsDataCache = [];
    let monthStatusCache = {}; // { 'year_month': 'oficial'|'preliminar' }
    let activeYears = new Set();
    let currentMetric = 'operaciones'; // 'operaciones' | 'pasajeros'
    let currentGranularity = 'mensual'; // 'mensual' | 'bimestral' | 'trimestral' | 'semestral'
    let activeMonths = new Set([1,2,3,4,5,6,7,8,9,10,11,12]);

    // Period groups per granularity
    const GRANULARITY_CONFIG = {
        mensual: {
            groups: [
                { label: 'Ene',  months: [1] },
                { label: 'Feb',  months: [2] },
                { label: 'Mar',  months: [3] },
                { label: 'Abr',  months: [4] },
                { label: 'May',  months: [5] },
                { label: 'Jun',  months: [6] },
                { label: 'Jul',  months: [7] },
                { label: 'Ago',  months: [8] },
                { label: 'Sep',  months: [9] },
                { label: 'Oct',  months: [10] },
                { label: 'Nov',  months: [11] },
                { label: 'Dic',  months: [12] },
            ]
        },
        bimestral: {
            groups: [
                { label: 'Ene-Feb', months: [1, 2] },
                { label: 'Mar-Abr', months: [3, 4] },
                { label: 'May-Jun', months: [5, 6] },
                { label: 'Jul-Ago', months: [7, 8] },
                { label: 'Sep-Oct', months: [9, 10] },
                { label: 'Nov-Dic', months: [11, 12] },
            ]
        },
        trimestral: {
            groups: [
                { label: 'T1 (Ene-Mar)', months: [1, 2, 3] },
                { label: 'T2 (Abr-Jun)', months: [4, 5, 6] },
                { label: 'T3 (Jul-Sep)', months: [7, 8, 9] },
                { label: 'T4 (Oct-Dic)', months: [10, 11, 12] },
            ]
        },
        semestral: {
            groups: [
                { label: 'S1 (Ene-Jun)', months: [1, 2, 3, 4, 5, 6] },
                { label: 'S2 (Jul-Dic)', months: [7, 8, 9, 10, 11, 12] },
            ]
        }
    };

    // Colores mejorados para cada año - con mayor saturación y contraste
    const yearColors = {
        '2022': '#06b3e8',  // Cyan mejorado - más saturado
        '2023': '#ff9800',  // Naranja más vibrante
        '2024': '#4caf50',  // Verde más saturado
        '2025': '#2196f3',  // Azul más vibrante
        '2026': '#e91e63',  // Magenta para año adicional
        'default': '#78909c' // Gris mejorado
    };

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // Expose shared state so external month-filter globals can interact
    window._comYoyActiveMonths = activeMonths;
    window._comYoyRender = function() { renderYoYChart(); renderYoYTable(); };

    document.addEventListener('DOMContentLoaded', () => {
        const triggers = document.querySelectorAll('button[data-bs-target="#analisis-yoy-pane"]');

        triggers.forEach(btn => {
            btn.addEventListener('shown.bs.tab', () => {
                const client = window.supabaseClient;
                if (!client) {
                    console.warn("Supabase client no disponible para YOY.");
                    return;
                }
                if (!dataLoaded) {
                    loadYoYData(client);
                } else {
                    renderYoYChart();
                    // Forzar resize después de la transición del tab (Bootstrap: ~300ms)
                    setTimeout(() => { try { if (yoyChart) yoyChart.resize(); } catch(_){} }, 320);
                }
            });
        });

        // Si el pane ya es activo en la carga inicial (tab por defecto),
        // Bootstrap no dispara shown.bs.tab — inicializar directamente.
        const pane = document.getElementById('analisis-yoy-pane');
        if (pane && pane.classList.contains('active')) {
            // Esperar a que supabaseClient esté disponible
            const tryInit = (attempts) => {
                const client = window.supabaseClient;
                if (client) {
                    if (!dataLoaded) loadYoYData(client);
                } else if (attempts > 0) {
                    setTimeout(() => tryInit(attempts - 1), 300);
                }
            };
            setTimeout(() => tryInit(15), 200);
        }

        const metricSelect = document.getElementById('yoy-metric-select');
        if (metricSelect) {
            metricSelect.addEventListener('change', (e) => {
                currentMetric = e.target.value;
                updateChartTitle();
                renderYoYChart();
                renderYoYTable();
            });
        }

        const exportBtn = document.getElementById('yoy-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportYOYtoCSV);
        }

        // Granularity toggle buttons
        document.querySelectorAll('input[name="yoy-granularity"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                currentGranularity = e.target.value;
                renderYoYChart();
                renderYoYTable();
            });
        });
    });

    function updateChartTitle() {
        const titleEl = document.getElementById('yoy-chart-title');
        if (titleEl) {
            // Se usa innerHTML para incluir el icono
            titleEl.innerHTML = currentMetric === 'operaciones' 
                ? '<i class="fas fa-plane me-2"></i>Comparativa Mensual de Operaciones Comerciales' 
                : '<i class="fas fa-user me-2"></i>Comparativa Mensual de Pasajeros Comerciales';
        }
    }

    async function loadYoYData(client) {
        try {
            // Totales de la capa unificada (js/totales-service.js): cifras
            // oficiales hasta el corte y Conciliación después — los mismos que
            // las tarjetas del Inicio. "preliminar" = mes posterior al corte.
            const data = await window.TotalesService.filasMensuales();
            monthStatusCache = {};
            data.forEach(row => {
                monthStatusCache[`${row.year}_${row.month}`] = row.is_official ? 'oficial' : 'preliminar';
            });
            const merged = data.slice();

            opsDataCache = merged;

            const years = [...new Set(merged.map(d => d.year))].sort();
            activeYears = new Set(years);

            buildYearsFilter(years);
            updateChartTitle();
            renderYoYChart();
            renderYoYTable();
            renderYoYNotes();
            dataLoaded = true;

        } catch(error) {
            console.error("Error cargando datos YOY:", error);
        }
    }

    function buildYearsFilter(years) {
        const container = document.getElementById('yoy-years-container');
        if (!container) return;

        container.innerHTML = '';
        
        years.forEach(yr => {
            const wrapper = document.createElement('div');
            wrapper.className = 'form-check form-switch';
            
            const input = document.createElement('input');
            input.className = 'form-check-input yoy-year-switch';
            input.type = 'checkbox';
            input.id = `yoy-year-switch-${yr}`;
            input.value = yr;
            input.checked = true; // Activos por defecto
            
            // Cuando un switch cambia, redibujamos tabla y grï¿½fica
            input.addEventListener('change', (e) => {
                if (e.target.checked) activeYears.add(parseInt(yr));
                else activeYears.delete(parseInt(yr));
                renderYoYChart();
                renderYoYTable();
            });

            const label = document.createElement('label');
            label.className = 'form-check-label';
            label.htmlFor = `yoy-year-switch-${yr}`;
            label.textContent = yr;

            wrapper.appendChild(input);
            wrapper.appendChild(label);
            container.appendChild(wrapper);
        });
    }

    /** Get value for a given year+month from cache */
    function getVal(yr, month) {
        const match = opsDataCache.find(d => d.year === yr && d.month === month);
        if (!match) return null;
        let val = currentMetric === 'operaciones' ? (match.comercial_ops || 0) : (match.comercial_pax || 0);
        return val;
    }

    /** Sum values for a year across a group of months; null if no data */
    function sumGroup(yr, months) {
        let total = 0, hasData = false;
        months.forEach(m => { const v = getVal(yr, m); if (v !== null) { total += v; hasData = true; } });
        return hasData ? total : null;
    }

    /** Returns true only if ALL months in the group have data for the given year */
    function isGroupComplete(yr, months) {
        return months.every(m => getVal(yr, m) !== null);
    }

    /** Render a % variation badge HTML */
    function renderPctBadge(current, prev, prevYr, small) {
        if (prev === null || prev === 0) return '';
        const growth = ((current - prev) / prev) * 100;
        const isPos = growth >= 0;
        const color = isPos ? 'text-success' : 'text-danger';
        const icon = isPos ? '<i class="fas fa-caret-up"></i>' : '<i class="fas fa-caret-down"></i>';
        const sz = small ? '0.75em' : '0.8em';
        return `<span class="small ms-2 ${color}" style="font-size:${sz};" title="vs ${prevYr}">${icon} ${Math.abs(growth).toFixed(1)}%</span>`;
    }

    function renderYoYChart() {
        const canvas = document.getElementById('yoyCompChart');
        if (!canvas) return;

        if (yoyChart) yoyChart.destroy();
        if (activeYears.size === 0) return;

        const ctx = canvas.getContext('2d');
        const sortedYears = Array.from(activeYears).sort();
        const groups = GRANULARITY_CONFIG[currentGranularity].groups.filter(g =>
            g.months.every(m => activeMonths.has(m))
        );
        if (!groups.length) return;
        const datasets = [];

        const _chartTodayYear  = new Date().getFullYear();
        const _chartTodayMonth = new Date().getMonth() + 1; // 1-based

        sortedYears.forEach((year, idx) => {
            const dataArr = groups.map(g => {
                // Do not plot the current or future months of the current year (month not yet closed)
                if (year === _chartTodayYear && g.months.some(m => m >= _chartTodayMonth)) return null;
                return sumGroup(year, g.months);
            });
            const yColor = yearColors[year] || yearColors['default'];
            const isLast = idx === sortedYears.length - 1;

            let backgroundColor = yColor + '20';
            if (isLast) {
                const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                gradient.addColorStop(0, yColor + '60');
                gradient.addColorStop(1, yColor + '05');
                backgroundColor = gradient;
            }

            datasets.push({
                label: `Año ${year}`,
                data: dataArr,
                borderColor: yColor,
                backgroundColor: backgroundColor,
                borderWidth: isLast ? 3 : 2,
                pointRadius: isLast ? 4 : 0,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: yColor,
                pointBorderWidth: 2,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: yColor,
                pointHoverBorderColor: '#ffffff',
                pointHoverBorderWidth: 3,
                fill: isLast,
                tension: 0.4,
                order: isLast ? 0 : 1
            });
        });

        // Asegurarse de que el canvas tenga dimensiones válidas antes de renderizar
        // (puede ser 0×0 si el tab todavía estaba oculto al llamar esta función)
        const canvasParent = canvas.parentElement;
        if (canvasParent && (canvasParent.offsetWidth === 0 || canvasParent.offsetHeight === 0)) {
            // Diferir hasta que el contenedor sea visible
            setTimeout(() => renderYoYChart(), 120);
            return;
        }

        yoyChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: groups.map(g => g.label),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750,
                    easing: 'easeInOutQuart'
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    // Deshabilitar datalabels globales — evita números encimados
                    datalabels: { display: false },
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 12,
                            padding: 15,
                            margin: 10,
                            font: {
                                family: "'Inter', 'Segoe UI', sans-serif",
                                size: 13,
                                weight: '600'
                            },
                            color: (document.body.classList.contains('dark-mode') ? '#e8eaed' : '#334155')
                        }
                    },
                    tooltip: {
                        itemSort: function(a, b){ return b.datasetIndex - a.datasetIndex; },
                        backgroundColor: 'rgba(30, 41, 59, 0.95)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#e2e8f0',
                        borderColor: '#475569',
                        borderWidth: 2,
                        padding: 14,
                        boxPadding: 8,
                        usePointStyle: true,
                        cornerRadius: 8,
                        titleFont: { size: 14, weight: 'bold', family: "'Inter', sans-serif" },
                        bodyFont: { size: 13, family: "'Inter', sans-serif" },
                        callbacks: {
                            title: function(context) {
                                return `📅 ${context[0].label}`;
                            },
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += '📊 ' + new Intl.NumberFormat('es-MX').format(context.parsed.y);
                                }
                                return label;
                            },
                            footer: function(context) {
                                if (context.length > 1) {
                                    const values = context.map(c => c.parsed.y || 0);
                                    const total = values.reduce((a, b) => a + b, 0);
                                    return `📈 Total: ${new Intl.NumberFormat('es-MX').format(total)}`;
                                }
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: {
                                family: "'Inter', 'Segoe UI', sans-serif",
                                size: 12
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        border: { display: false },
                        grid: {
                            display: false,
                            drawBorder: false,
                        },
                        ticks: {
                            color: '#94a3b8',
                            padding: 10,
                            font: {
                                family: "'Inter', 'Segoe UI', sans-serif",
                                size: 11
                            },
                            callback: function(value) {
                                if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                                if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
                                return value;
                            }
                        }
                    }
                }
            }
        });

        // Resize post-render: corrige tamaño si el canvas se creó mientras
        // el contenedor estaba en transición CSS (Bootstrap tab animation)
        setTimeout(() => { try { if (yoyChart) yoyChart.resize(); } catch(_){} }, 160);
    }

    function renderYoYTable() {
        const thead = document.querySelector('#yoy-data-table > thead');
        const tbody = document.querySelector('#yoy-data-table > tbody');
        if (!thead || !tbody) return;

        thead.innerHTML = '';
        tbody.innerHTML = '';

        const yearsList = Array.from(activeYears).sort();

        if (yearsList.length === 0) {
            tbody.innerHTML = '<tr><td class="text-muted">No hay años seleccionados</td></tr>';
            return;
        }

        const groups = GRANULARITY_CONFIG[currentGranularity].groups.filter(g =>
            g.months.every(m => activeMonths.has(m))
        );
        if (!groups.length) {
            tbody.innerHTML = '<tr><td class="text-muted" colspan="10">Selecciona al menos un mes completo para el periodo elegido.</td></tr>';
            return;
        }

        // Header row
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `<th>Periodo</th>` + yearsList.map(y => `<th>${y}</th>`).join('');
        thead.appendChild(headerRow);

        const grandTotals = new Array(yearsList.length).fill(0);
        const comparablePrevTotals = new Array(yearsList.length).fill(0);
        // For TOTAL %: only sum periods that are complete in the current year
        const completeCurrentTotals = new Array(yearsList.length).fill(0);
        const _tblTodayYear  = new Date().getFullYear();
        const _tblTodayMonth = new Date().getMonth() + 1;

        // Period rows
        groups.forEach(group => {
            const tr = document.createElement('tr');
            let cellsHTML = `<td><strong>${group.label}</strong></td>`;
            let rowTotal = 0;

            yearsList.forEach((yr, idx) => {
                const val = sumGroup(yr, group.months);

                if (val === null) {
                    cellsHTML += `<td class="text-muted">–</td>`;
                    return;
                }

                grandTotals[idx] += val;
                rowTotal += val;

                // Only show % and include in proportional total if the period is fully closed
                const complete = isGroupComplete(yr, group.months);

                let percentHtml = '';
                // Suppress variation badge for open (current) month
                const groupIsOpen = group.months.some(m => m >= _tblTodayMonth);
                if (idx > 0 && complete && !(yr === _tblTodayYear && groupIsOpen)) {
                    const prevYr = yearsList[idx - 1];
                    const prevVal = sumGroup(prevYr, group.months);
                    if (prevVal !== null) {
                        comparablePrevTotals[idx] += prevVal;
                        completeCurrentTotals[idx] += val;
                        percentHtml = renderPctBadge(val, prevVal, prevYr, true);
                    }
                } else if (idx === 0 && complete) {
                    completeCurrentTotals[idx] += val;
                }

                cellsHTML += `<td>${new Intl.NumberFormat('es-MX').format(val)}${percentHtml}</td>`;
            });

            tr.innerHTML = cellsHTML;
            tbody.appendChild(tr);
        });

        // TOTAL POR AÑO row
        const tfRow = document.createElement('tr');
        tfRow.className = 'table-light fw-bold';
        let totalsHTML = `<td>TOTAL POR AÑO</td>`;
        grandTotals.forEach((t, idx) => {
            let percentHtml = '';
            if (idx > 0) {
                const prevComparable = comparablePrevTotals[idx];
                const curComparable = completeCurrentTotals[idx];
                if (prevComparable > 0) {
                    const growth = ((curComparable - prevComparable) / prevComparable) * 100;
                    const isPos = growth >= 0;
                    const color = isPos ? 'text-success' : 'text-danger';
                    const icon = isPos ? '<i class="fas fa-arrow-up"></i>' : '<i class="fas fa-arrow-down"></i>';
                    percentHtml = `<br><span class="small ${color}" style="font-size:0.8em;" title="vs ${yearsList[idx - 1]} (periodos cerrados)">${icon} ${Math.abs(growth).toFixed(1)}%</span>`;
                }
            }
            totalsHTML += `<td>${new Intl.NumberFormat('es-MX').format(t)}${percentHtml}</td>`;
        });
        const grandSum = grandTotals.reduce((s, t) => s + t, 0);
        tfRow.innerHTML = totalsHTML;
        tbody.appendChild(tfRow);

        // ACUMULADO row — single spanning cell
        const acumRow = document.createElement('tr');
        acumRow.className = 'table-secondary fw-bold';
        const acumSuffix = currentMetric === 'operaciones' ? 'Operaciones' : 'Pasajeros';
        acumRow.innerHTML = `<td class="fw-bold" style="background:#e2e8f0;">ACUMULADO HISTÓRICO</td><td colspan="${yearsList.length}" class="text-center" style="background:#e2e8f0;font-size:1.05em;letter-spacing:0.3px;">${new Intl.NumberFormat('es-MX').format(grandSum)} <span class="fw-normal text-muted" style="font-size:0.8em;">${acumSuffix}</span></td>`;
        tbody.appendChild(acumRow);
    }

    function renderYoYNotes() {
        const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const today = new Date();
        const curYear = today.getFullYear();
        const officialMonths = [], prelimMonths = [];
        for (let m = 1; m <= 12; m++) {
            const st = monthStatusCache[`${curYear}_${m}`];
            if (st === 'oficial')    officialMonths.push(m);
            if (st === 'preliminar') prelimMonths.push(m);
        }
        const tableEl = document.getElementById('yoy-data-table');
        if (!tableEl) return;
        const wrapper = tableEl.closest('.table-responsive') || tableEl.parentNode;
        let bar = document.getElementById('yoy-com-notes-bar');
        if (!bar) { bar = document.createElement('div'); bar.id = 'yoy-com-notes-bar'; wrapper.insertAdjacentElement('beforebegin', bar); }
        if (!officialMonths.length && !prelimMonths.length) { bar.innerHTML = ''; return; }
        let pills = '';
        if (officialMonths.length) {
            const first = MONTH_NAMES[officialMonths[0] - 1];
            const last  = MONTH_NAMES[officialMonths[officialMonths.length - 1] - 1];
            const range = officialMonths.length === 1 ? first : `${first} a ${last}`;
            pills += `<span style="display:inline-flex;align-items:center;gap:6px;background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:20px;padding:5px 14px;font-size:0.8rem;font-weight:600;"><svg style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>Cifras oficiales &mdash; ${range} ${curYear}</span>`;
        }
        if (prelimMonths.length) {
            const pNames = prelimMonths.map(m => MONTH_NAMES[m - 1]).join(', ');
            pills += `<span style="display:inline-flex;align-items:center;gap:6px;background:#fef9c3;color:#a16207;border:1px solid #fde047;border-radius:20px;padding:5px 14px;font-size:0.8rem;font-weight:600;"><svg style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>Cifras preliminares &mdash; ${pNames} ${curYear} <span style="font-weight:400;opacity:0.75;margin-left:2px;">· suma acumulada de registros diarios</span></span>`;
        }
        bar.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 4px 8px;">${pills}</div>`;
    }

    function exportYOYtoCSV() {
        if (!opsDataCache || opsDataCache.length === 0) {
            alert('No hay datos cargados para exportar.');
            return;
        }

        let csvContent = "";
        
        // Determinar quï¿½ metricas exportar, exportemos todo crudo para que sea mas util
        const keys = ['year', 'month', 'comercial_ops', 'comercial_pax', 'general_ops', 'general_pax', 'carga_ops'];
        
        // Header
        csvContent += keys.join(",") + "\n";
        
        // Data filtrada por aï¿½os activos si se desea, o toda la cache
        opsDataCache.forEach(row => {
            const rowValues = keys.map(k => row[k] !== null && row[k] !== undefined ? row[k] : "");
            csvContent += rowValues.join(",") + "\n";
        });

        // Blob y descarga
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);

        const ts = new Date().toISOString().slice(0,10);
        link.setAttribute("download", `comparativa_yoy_${ts}.csv`);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /** Fuerza recarga de datos desde Supabase — llamado por realtime.js */
    window.comHistReload = function() {
        dataLoaded = false;
        opsDataCache = [];
        monthStatusCache = {};
        const client = window.supabaseClient;
        if (client) loadYoYData(client);
    };
})();

// ── Month filter globals for Comercial YoY ──────────────────────────────────

window.comYoyToggleMonth = function(mon, btn) {
    const s = window._comYoyActiveMonths;
    if (!s) return;
    if (s.has(mon)) { s.delete(mon); btn.classList.remove('active'); }
    else            { s.add(mon);    btn.classList.add('active');    }
    window._comYoyRender && window._comYoyRender();
};

window.comYoyMonthPreset = function(preset) {
    const s = window._comYoyActiveMonths;
    if (!s) return;
    const now = new Date();
    const curMon = now.getMonth() + 1;
    let months;
    if (preset === 'ytd')      months = Array.from({length: curMon}, (_, i) => i + 1);
    else if (preset === 'h1')  months = [1,2,3,4,5,6];
    else if (preset === 'h2')  months = [7,8,9,10,11,12];
    else                       months = [1,2,3,4,5,6,7,8,9,10,11,12];
    s.clear();
    months.forEach(m => s.add(m));
    document.querySelectorAll('.com-yoy-mon-btn').forEach(btn => {
        const m = parseInt(btn.dataset.month, 10);
        btn.classList.toggle('active', s.has(m));
    });
    window._comYoyRender && window._comYoyRender();
};
