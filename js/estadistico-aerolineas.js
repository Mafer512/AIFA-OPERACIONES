/* Estadístico por Aerolínea — comparativa histórica.
 * La fuente principal es airline_monthly_statistics; las demás consultas son
 * compatibilidad. Toda la interfaz consume una única agregación compartida.
 */
(function () {
    'use strict';

    const Core = window.AirlineStatsCore;
    if (!Core) {
        console.error('No se cargó la configuración del Estadístico por Aerolínea.');
        return;
    }

    const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
    const compactFormat = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
    const state = {
        rows: [],
        months: new Set(),
        metric: 'pasajeros',
        year: null,
        chart: null,
        aggregation: Core.aggregate([], {}),
        normalizationReport: null,
        loaded: false,
        loadingPromise: null
    };

    function formatNumber(value) {
        return numberFormat.format(Number.isFinite(Number(value)) ? Number(value) : 0);
    }

    function formatPercent(value) {
        return `${Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00'}%`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[char]);
    }

    function normalizeDate(value, referenceDate) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (iso) return iso[1];
        const dmy = raw.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        const monthMap = {
            JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
            JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
        };
        const opsDate = raw.toUpperCase().match(/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
        const referenceYear = String(referenceDate || '').match(/^(20\d{2})-/)?.[1];
        if (opsDate && referenceYear) {
            return `${referenceYear}-${monthMap[opsDate[2]]}-${opsDate[1].padStart(2, '0')}`;
        }
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) || date.getFullYear() < 2020 ? '' : date.toISOString().slice(0, 10);
    }

    async function loadHistoricalAirlineStats(client) {
        const fields = 'year,month,airline_code,airline_name,arrivals_passengers,departures_passengers,arrivals_operations,departures_operations,total_passengers,total_operations';
        const rows = [];
        const batchSize = 1000;
        try {
            for (let from = 0; ; from += batchSize) {
                const { data, error } = await client
                    .from('airline_monthly_statistics')
                    .select(fields)
                    .range(from, from + batchSize - 1);
                if (error) throw error;
                rows.push(...(data || []));
                if (!data || data.length < batchSize) break;
            }
        } catch (error) {
            console.info('Histórico consolidado por aerolínea no disponible.', error.message);
            return [];
        }

        return rows.map(row => ({
            year: row.year,
            month: row.month,
            aerolinea: row.airline_name || row.airline_code,
            pasajeros_llegada: row.arrivals_passengers,
            pasajeros_salida: row.departures_passengers,
            operaciones_llegada: row.arrivals_operations,
            operaciones_salida: row.departures_operations,
            pasajeros_total: row.total_passengers,
            operaciones_total: row.total_operations,
            tipo_operacion: 'Consolidado'
        }));
    }

    async function loadEditableItinerary(client) {
        const fields = '"[Arr] Airline code","[Arr] Boarded","[Arr] SIBT","[Dep] Airline code","[Dep] Boarded","[Dep] SOBT",arr_scheduled_date,dep_scheduled_date,import_reference_date';
        const batches = [];
        const batchSize = 1000;
        try {
            for (let from = 0; ; from += batchSize) {
                const { data, error } = await client
                    .from('itinerario_vuelos_editable')
                    .select(fields)
                    .range(from, from + batchSize - 1);
                if (error) throw error;
                batches.push(...(data || []));
                if (!data || data.length < batchSize) break;
            }
        } catch (error) {
            console.info('Itinerario editable no disponible para Estadístico por Aerolínea.', error.message);
            return [];
        }

        return batches.flatMap(row => {
            const arrivals = normalizeDate(row.arr_scheduled_date, row.import_reference_date)
                || normalizeDate(row['[Arr] SIBT'], row.import_reference_date);
            const departures = normalizeDate(row.dep_scheduled_date, row.import_reference_date)
                || normalizeDate(row['[Dep] SOBT'], row.import_reference_date);
            const result = [];
            if (arrivals) {
                result.push({
                    fecha: arrivals,
                    aerolinea: row['[Arr] Airline code'] || row['[Dep] Airline code'],
                    pasajeros: row['[Arr] Boarded'],
                    tipo_operacion: 'Llegada'
                });
            }
            if (departures) {
                result.push({
                    fecha: departures,
                    aerolinea: row['[Dep] Airline code'] || row['[Arr] Airline code'],
                    pasajeros: row['[Dep] Boarded'],
                    tipo_operacion: 'Salida'
                });
            }
            return result;
        });
    }

    async function loadCompatibilityRows(client) {
        let dailyBatches = null;
        let batchError = null;
        ({ data: dailyBatches, error: batchError } = await client
            .from('vuelos_parte_operaciones')
            .select('date,data')
            .order('date', { ascending: true }));

        if (!batchError && Array.isArray(dailyBatches) && dailyBatches.length) {
            return dailyBatches.flatMap(batch => (Array.isArray(batch.data) ? batch.data : []).map(operation => ({
                fecha: batch.date,
                aerolinea: operation.aerolinea || operation.Aerolinea || operation['Aerolínea'] || operation.airline,
                pasajeros: operation.pasajeros ?? operation.Pasajeros,
                pasajeros_llegada: operation.pasajeros_llegada ?? operation['Pasajeros llegada'] ?? operation.PaxArr,
                pasajeros_salida: operation.pasajeros_salida ?? operation['Pasajeros salida'] ?? operation.PaxDep,
                tipo_operacion: operation.tipo_operacion || operation['Tipo de operación']
            })));
        }

        let response = await client
            .from('daily_flights_ops')
            .select('fecha,aerolinea,pasajeros,pasajeros_llegada,pasajeros_salida,tipo_operacion')
            .not('fecha', 'is', null)
            .order('fecha', { ascending: true });
        if (response.error) {
            response = await client
                .from('daily_flights_ops')
                .select('fecha,aerolinea,pasajeros,tipo_operacion')
                .not('fecha', 'is', null)
                .order('fecha', { ascending: true });
        }
        if (response.error) throw response.error;
        return response.data || [];
    }

    function logNormalizationReport(report) {
        const hasAnomalies = report.invalidRows || report.invalidValues || report.negativeValues
            || report.emptyAirlines || report.exactDuplicates || report.nameVariants.length;
        if (!hasAnomalies) return;
        console.warn('[Estadístico por Aerolínea] Anomalías de normalización', {
            inputRows: report.inputRows,
            validRows: report.validRows,
            invalidRows: report.invalidRows,
            invalidValues: report.invalidValues,
            negativeValues: report.negativeValues,
            emptyAirlines: report.emptyAirlines,
            exactDuplicates: report.exactDuplicates,
            nameVariants: report.nameVariants,
            samples: report.samples
        });
    }

    async function loadData() {
        const client = window.supabaseClient;
        if (!client) {
            renderEmpty('No fue posible conectar la fuente de datos del Estadístico por Aerolínea.');
            return;
        }

        const [historicalRows, editableRows] = await Promise.all([
            loadHistoricalAirlineStats(client),
            loadEditableItinerary(client)
        ]);
        const officialYears = new Set(historicalRows.map(row => String(row.year || '')));
        let sourceRows = historicalRows.concat(editableRows.filter(row => {
            const year = String(row.fecha || '').slice(0, 4);
            return !officialYears.has(year);
        }));

        if (!sourceRows.length) sourceRows = await loadCompatibilityRows(client);
        const normalized = Core.normalizeRows(sourceRows);
        state.rows = normalized.rows;
        state.normalizationReport = normalized.report;
        logNormalizationReport(normalized.report);
        configureControls();
        render();
    }

    function load() {
        if (state.loaded) {
            state.chart?.resize();
            return Promise.resolve();
        }
        if (state.loadingPromise) return state.loadingPromise;

        state.loadingPromise = loadData()
            .catch(error => {
                console.error('No se pudo cargar el Estadístico por Aerolínea:', error);
                renderEmpty('No hay una fuente de detalle por aerolínea disponible para este periodo.');
            })
            .finally(() => {
                state.loaded = true;
                state.loadingPromise = null;
            });
        return state.loadingPromise;
    }

    function reconcileSelectedMonths() {
        const available = Core.getAvailableMonths(state.rows, state.year, state.metric);
        const availableSet = new Set(available);
        const preserved = [...state.months].filter(month => availableSet.has(month));
        state.months = new Set(preserved.length ? preserved : available);
    }

    function configureControls() {
        const years = Core.getYears(state.rows);
        const yearSelect = document.getElementById('airline-stats-year');
        const currentYear = String(new Date().getFullYear());
        state.year = years.includes(state.year) ? state.year
            : (years.includes(currentYear) ? currentYear : (years[0] || null));
        if (yearSelect) {
            yearSelect.innerHTML = years.length
                ? years.map(year => `<option value="${year}">${year}</option>`).join('')
                : '<option value="">Sin datos</option>';
            yearSelect.value = state.year || '';
            yearSelect.onchange = () => {
                state.year = yearSelect.value;
                reconcileSelectedMonths();
                buildMonths();
                render();
            };
        }

        const availableMetrics = Core.getAvailableMetrics(state.rows);
        if (!availableMetrics.includes(state.metric)) state.metric = availableMetrics[0] || 'pasajeros';
        const metricSelect = document.getElementById('airline-stats-metric');
        if (metricSelect) {
            metricSelect.innerHTML = availableMetrics.length
                ? availableMetrics.map(metric => `<option value="${metric}">${Core.METRICS[metric].label}</option>`).join('')
                : '<option value="pasajeros">Pasajeros transportados</option>';
            metricSelect.value = state.metric;
            metricSelect.onchange = () => {
                state.metric = metricSelect.value;
                reconcileSelectedMonths();
                buildMonths();
                render();
            };
        }

        const exportButton = document.getElementById('airline-stats-export');
        if (exportButton) exportButton.onclick = exportCsv;
        reconcileSelectedMonths();
        buildMonths();
    }

    function buildMonths() {
        const container = document.getElementById('airline-stats-months');
        if (!container) return;
        const available = new Set(Core.getAvailableMonths(state.rows, state.year, state.metric));
        container.innerHTML = Core.MONTHS.map(month => {
            const enabled = available.has(month.number);
            const selected = enabled && state.months.has(month.number);
            const title = enabled ? month.name : `${month.name}: sin información para el indicador seleccionado`;
            return `<button type="button" class="btn btn-xs btn-outline-primary airline-stats-month${selected ? ' active' : ''}${enabled ? '' : ' airline-stats-month--empty'}" data-month="${month.number}" title="${title}" aria-pressed="${selected}"${enabled ? '' : ' disabled'}>${month.short}</button>`;
        }).join('');
        container.querySelectorAll('button:not(:disabled)').forEach(button => {
            button.onclick = () => {
                const month = Number(button.dataset.month);
                if (state.months.has(month)) state.months.delete(month);
                else state.months.add(month);
                button.classList.toggle('active', state.months.has(month));
                button.setAttribute('aria-pressed', String(state.months.has(month)));
                render();
            };
        });
    }

    function render() {
        state.aggregation = Core.aggregate(state.rows, {
            year: state.year,
            months: state.months,
            metric: state.metric
        });
        const result = state.aggregation;
        const empty = document.getElementById('airline-stats-empty');
        const table = document.getElementById('airline-stats-table');
        const exportButton = document.getElementById('airline-stats-export');
        if (exportButton) exportButton.disabled = !result.rows.length;

        if (!result.rows.length) {
            if (empty) {
                empty.textContent = state.months.size
                    ? 'No hay datos de aerolíneas para el periodo seleccionado.'
                    : 'Selecciona al menos un mes con información para consultar resultados.';
                empty.classList.remove('d-none');
            }
            table?.classList.add('d-none');
            const summary = document.getElementById('airline-stats-summary');
            if (summary) summary.innerHTML = '';
            destroyChart();
            return;
        }

        empty?.classList.add('d-none');
        table?.classList.remove('d-none');
        renderSummary(result);
        renderChart(result);
        renderTable(result);
    }

    function renderSummary(result) {
        const summary = document.getElementById('airline-stats-summary');
        if (!summary) return;
        const monthCount = result.monthsWithData.length;
        const top = result.top;
        summary.innerHTML = `
            <div class="airline-stat-card">
                <span>${escapeHtml(result.definition.totalLabel)} · ${monthCount} mes${monthCount === 1 ? '' : 'es'} con información</span>
                <strong>${formatNumber(result.total)}</strong>
            </div>
            <div class="airline-stat-card">
                <span>Aerolíneas activas</span>
                <strong>${formatNumber(result.activeAirlines)}</strong>
            </div>
            <div class="airline-stat-card airline-stat-card--top" style="--airline-color:${top.color}">
                <span>Mayor participación</span>
                <strong title="${escapeHtml(top.airline)}">${escapeHtml(top.airline)}</strong>
                <small>${formatPercent(top.participation)}</small>
            </div>`;
    }

    function destroyChart() {
        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
    }

    function renderChart(result) {
        const canvas = document.getElementById('airline-stats-chart');
        const chartCanvas = document.getElementById('airline-stats-chart-canvas');
        if (!canvas || !chartCanvas || !window.Chart) return;
        destroyChart();

        chartCanvas.style.height = `${Math.max(300, result.rows.length * 46 + 58)}px`;
        state.chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: result.rows.map(item => item.airline),
                datasets: [{
                    label: result.definition.label,
                    data: result.rows.map(item => item.value),
                    backgroundColor: result.rows.map(item => item.color),
                    borderColor: result.rows.map(item => item.color),
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false,
                    barPercentage: 0.72,
                    categoryPercentage: 0.82
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                animation: { duration: 250 },
                layout: { padding: { top: 6, right: 24, bottom: 4, left: 8 } },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        display: context => {
                            const bar = context.chart.getDatasetMeta(context.datasetIndex).data[context.dataIndex];
                            return !!bar && Math.abs(Number(bar.x) - Number(bar.base)) >= 64;
                        },
                        anchor: 'end',
                        align: 'start',
                        clamp: true,
                        color: '#ffffff',
                        font: { size: 10, weight: '700' },
                        formatter: value => formatNumber(value)
                    },
                    tooltip: {
                        displayColors: true,
                        callbacks: {
                            title: items => items[0]?.label || '',
                            labelColor: context => {
                                const color = result.rows[context.dataIndex]?.color || Core.DEFAULT_AIRLINE_COLOR;
                                return { backgroundColor: color, borderColor: color };
                            },
                            label: context => {
                                const row = result.rows[context.dataIndex];
                                return [
                                    ` ${result.definition.label}: ${formatNumber(row?.value)}`,
                                    ` Participación: ${formatPercent(row?.participation)}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: 'rgba(148, 163, 184, 0.24)', lineWidth: 1 },
                        border: { display: false },
                        ticks: {
                            color: '#475569',
                            callback: value => compactFormat.format(Number(value) || 0)
                        }
                    },
                    y: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { color: '#334155', font: { size: 11 }, autoSkip: false }
                    }
                }
            }
        });
    }

    function renderTable(result) {
        const thead = document.querySelector('#airline-stats-table thead');
        const tbody = document.querySelector('#airline-stats-table tbody');
        if (!thead || !tbody) return;
        const rowClass = index => index === 0 ? ' class="airline-stats-top-row"' : '';

        if (result.consolidated) {
            thead.innerHTML = `<tr><th class="text-center">#</th><th>Aerolínea</th><th class="text-end">${escapeHtml(result.definition.label)}</th><th class="text-end">Participación</th></tr>`;
            tbody.innerHTML = result.rows.map((item, index) => `
                <tr${rowClass(index)}>
                    <td class="text-center">${item.position}</td>
                    <td class="fw-semibold">${escapeHtml(item.airline)}</td>
                    <td class="text-end fw-bold">${formatNumber(item.value)}</td>
                    <td class="text-end">${formatPercent(item.participation)}</td>
                </tr>`).join('') + `
                <tr class="table-light fw-bold airline-stats-total-row">
                    <td colspan="2">TOTAL</td>
                    <td class="text-end">${formatNumber(result.total)}</td>
                    <td class="text-end">${result.total > 0 ? '100.00%' : '0.00%'}</td>
                </tr>`;
            return;
        }

        const arrivalLabel = result.metric === 'pasajeros' ? 'Llegadas' : 'Ops. llegada';
        const departureLabel = result.metric === 'pasajeros' ? 'Salidas' : 'Ops. salida';
        thead.innerHTML = `<tr><th class="text-center">#</th><th>Aerolínea</th><th class="text-end">${arrivalLabel}</th><th class="text-end">${departureLabel}</th><th class="text-end">Total</th><th class="text-end">Participación</th></tr>`;
        tbody.innerHTML = result.rows.map((item, index) => `
            <tr${rowClass(index)}>
                <td class="text-center">${item.position}</td>
                <td class="fw-semibold">${escapeHtml(item.airline)}</td>
                <td class="text-end">${formatNumber(item[result.definition.arrivalKey])}</td>
                <td class="text-end">${formatNumber(item[result.definition.departureKey])}</td>
                <td class="text-end fw-bold">${formatNumber(item.value)}</td>
                <td class="text-end">${formatPercent(item.participation)}</td>
            </tr>`).join('') + `
            <tr class="table-light fw-bold airline-stats-total-row">
                <td colspan="2">TOTAL</td>
                <td class="text-end">${formatNumber(result.arrivalTotal)}</td>
                <td class="text-end">${formatNumber(result.departureTotal)}</td>
                <td class="text-end">${formatNumber(result.total)}</td>
                <td class="text-end">${result.total > 0 ? '100.00%' : '0.00%'}</td>
            </tr>`;
    }

    function csvCell(value) {
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    function exportCsv() {
        const result = state.aggregation;
        if (!result.rows.length) return;
        const csv = Core.buildCsvRows(result)
            .map(row => row.map(csvCell).join(','))
            .join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        const monthKey = result.selectedMonths.map(month => String(month).padStart(2, '0')).join('-') || 'sin-meses';
        link.href = url;
        link.download = `estadistico_aerolineas_${result.metric}_${result.year || 'periodo'}_${monthKey}.csv`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function renderEmpty(message) {
        const empty = document.getElementById('airline-stats-empty');
        const exportButton = document.getElementById('airline-stats-export');
        if (empty) {
            empty.textContent = message;
            empty.classList.remove('d-none');
        }
        if (exportButton) exportButton.disabled = true;
        destroyChart();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const collapse = document.getElementById('acc-airline-body');
        if (!collapse) return;
        collapse.addEventListener('shown.bs.collapse', () => {
            if (!state.loaded) load();
            else state.chart?.resize();
        });
        if (collapse.classList.contains('show')) load();
    });
})();
