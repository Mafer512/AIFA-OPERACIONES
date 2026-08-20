/* ============================================================
 * GOMIH | Residuos de manejo especial, peligrosos y valorizables
 * Dashboard mensual con captura, totales, graficas y exportacion.
 * ============================================================ */
;(function () {
    'use strict';

    const TABLE = 'hidra_residuos_manejo_especial';
    const MONTHS = [
        { n: 1, long: 'Enero', short: 'Ene' }, { n: 2, long: 'Febrero', short: 'Feb' },
        { n: 3, long: 'Marzo', short: 'Mar' }, { n: 4, long: 'Abril', short: 'Abr' },
        { n: 5, long: 'Mayo', short: 'May' }, { n: 6, long: 'Junio', short: 'Jun' },
        { n: 7, long: 'Julio', short: 'Jul' }, { n: 8, long: 'Agosto', short: 'Ago' },
        { n: 9, long: 'Septiembre', short: 'Sep' }, { n: 10, long: 'Octubre', short: 'Oct' },
        { n: 11, long: 'Noviembre', short: 'Nov' }, { n: 12, long: 'Diciembre', short: 'Dic' }
    ];
    const CHART_THEME = Object.freeze({
        colors: Object.freeze({
            special: '#169B62',
            danger: '#E5484D',
            value: '#E9B000',
            trend: '#2563EB'
        }),
        text: '#475569',
        textStrong: '#0F172A',
        grid: '#E2E8F0',
        white: '#FFFFFF',
        valueText: '#4A3600'
    });
    const COLORS = CHART_THEME.colors;
    const CHART_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const state = { rows: [], years: [], selectedYear: null, editMonth: 1, loaded: false, loading: false, bound: false };
    const charts = { monthly: null, composition: null, trend: null };
    let dataLabelsRegistered = false;

    const $ = id => document.getElementById(id);
    const monthByNumber = n => MONTHS.find(m => m.n === Number(n)) || MONTHS[0];
    const num = value => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };
    const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtChart = value => {
        const n = Number(value);
        return Number.isFinite(n) ? n.toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '—';
    };
    const fmtPercent = value => {
        const n = Number(value);
        return Number.isFinite(n) ? n.toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '0';
    };
    const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);
    const hasData = row => ['inorganicos_kg', 'organicos_kg', 'lodos_kg', 'manejo_especial_kg', 'peligrosos_kg', 'valorizables_kg'].some(k => row && row[k] !== null && row[k] !== undefined);
    const specialOf = row => sum([row?.inorganicos_kg, row?.organicos_kg, row?.lodos_kg, row?.manejo_especial_kg]);
    const withAlpha = (hex, alpha) => {
        const value = String(hex).replace('#', '');
        const red = parseInt(value.slice(0, 2), 16);
        const green = parseInt(value.slice(2, 4), 16);
        const blue = parseInt(value.slice(4, 6), 16);
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    };

    async function client() {
        if (window.supabaseClient) return window.supabaseClient;
        if (typeof window.ensureSupabaseClient === 'function') return await window.ensureSupabaseClient();
        throw new Error('Cliente de Supabase no disponible.');
    }

    function canEdit() {
        try {
            if (typeof window.canCaptureSection === 'function') return !!window.canCaptureSection('hidraulicas');
            if (typeof window.canCapture === 'function') return !!window.canCapture();
        } catch (_) {}
        return true;
    }

    function setStatus(message, type = 'info') {
        const el = $('residuos-status');
        if (!el) return;
        if (!message) { el.className = 'alert alert-info py-2 small d-none'; el.textContent = ''; return; }
        el.className = `alert alert-${type} py-2 small`;
        el.textContent = message;
    }

    function normalizeRows(rows) {
        return (rows || []).map(row => ({
            ...row,
            anio: Number(row.anio), mes_num: Number(row.mes_num),
            inorganicos_kg: num(row.inorganicos_kg), organicos_kg: num(row.organicos_kg),
            lodos_kg: num(row.lodos_kg), manejo_especial_kg: num(row.manejo_especial_kg),
            peligrosos_kg: num(row.peligrosos_kg),
            valorizables_kg: num(row.valorizables_kg)
        }));
    }

    function rowForMonth(month) {
        return state.rows.find(row => row.anio === Number(state.selectedYear) && row.mes_num === Number(month)) || null;
    }

    async function load(force = false) {
        if (state.loading || (state.loaded && !force)) return;
        state.loading = true;
        setStatus('Cargando información de residuos…', 'info');
        try {
            const sb = await client();
            const result = await sb.from(TABLE).select('*').order('anio', { ascending: false }).order('mes_num');
            if (result.error) throw result.error;
            state.rows = normalizeRows(result.data);
            const yearSet = new Set(state.rows.map(row => row.anio).filter(Number.isFinite));
            yearSet.add(new Date().getFullYear());
            state.years = [...yearSet].sort((a, b) => b - a);
            if (!state.years.includes(state.selectedYear)) state.selectedYear = state.years[0];
            populateYear();
            populateEditMonth();
            renderAll();
            state.loaded = true;
            setStatus('', 'info');
        } catch (error) {
            console.error('[residuos-hidraulicas] load error:', error);
            setStatus(`No se pudo cargar el módulo: ${error.message || error}`, 'danger');
        } finally {
            state.loading = false;
        }
    }

    function populateYear() {
        const select = $('residuos-year-select');
        if (!select) return;
        select.innerHTML = state.years.map(year => `<option value="${year}">${year}</option>`).join('');
        select.value = String(state.selectedYear || state.years[0] || new Date().getFullYear());
    }

    function populateEditMonth() {
        const select = $('residuos-edit-month');
        if (!select) return;
        select.innerHTML = MONTHS.map(month => `<option value="${month.n}">${month.long}</option>`).join('');
        select.value = String(state.editMonth);
        loadEditorValues();
    }

    function renderKpis() {
        const rows = state.rows.filter(row => row.anio === Number(state.selectedYear));
        const special = sum(rows.map(specialOf));
        const danger = sum(rows.map(row => row.peligrosos_kg));
        const value = sum(rows.map(row => row.valorizables_kg));
        const months = rows.filter(hasData).length;
        const set = (id, text) => { if ($(id)) $(id).textContent = text; };
        set('residuos-kpi-especial', fmt(special));
        set('residuos-kpi-peligrosos', fmt(danger));
        set('residuos-kpi-valorizables', fmt(value));
        set('residuos-kpi-meses', `${months} / 12`);
    }

    function renderTable() {
        const body = $('residuos-table-body');
        const foot = $('residuos-table-foot');
        if (!body || !foot) return;
        const rows = MONTHS.map(month => rowForMonth(month.n));
        body.innerHTML = rows.map((row, index) => {
            const empty = !hasData(row);
            return `<tr class="${empty ? 'residuos-no-data' : ''}">
                <td>${state.selectedYear}</td><td>${MONTHS[index].long}</td>
                <td>${fmt(row?.inorganicos_kg)}</td><td>${fmt(row?.organicos_kg)}</td><td>${fmt(row?.lodos_kg)}</td><td>${fmt(row?.manejo_especial_kg)}</td>
                <td>${fmt(row?.peligrosos_kg)}</td><td>${fmt(row?.valorizables_kg)}</td>
                <td class="text-center"><button type="button" class="btn btn-outline-primary btn-sm residuos-edit-row" data-month="${MONTHS[index].n}" title="Editar ${MONTHS[index].long}"><i class="fas fa-pen"></i></button></td>
            </tr>`;
        }).join('');
        const totals = {
            inorganicos_kg: sum(rows.map(row => row?.inorganicos_kg)),
            organicos_kg: sum(rows.map(row => row?.organicos_kg)),
            lodos_kg: sum(rows.map(row => row?.lodos_kg)),
            manejo_especial_kg: sum(rows.map(row => row?.manejo_especial_kg)),
            peligrosos_kg: sum(rows.map(row => row?.peligrosos_kg)),
            valorizables_kg: sum(rows.map(row => row?.valorizables_kg))
        };
        const special = totals.inorganicos_kg + totals.organicos_kg + totals.lodos_kg + totals.manejo_especial_kg;
        foot.innerHTML = `<tr>
            <td colspan="2">Subtotal (kg)</td><td>${fmt(totals.inorganicos_kg)}</td><td>${fmt(totals.organicos_kg)}</td><td>${fmt(totals.lodos_kg)}</td><td>${fmt(totals.manejo_especial_kg)}</td><td rowspan="2" class="residuos-total-danger">${fmt(totals.peligrosos_kg)}</td><td rowspan="2" class="residuos-total-value">${fmt(totals.valorizables_kg)}</td><td rowspan="2"></td>
        </tr><tr>
            <td colspan="2">Total generado</td><td colspan="4" class="residuos-total-special text-center">${fmt(special)} kg</td>
        </tr>`;
    }

    function ensureChartPlugins() {
        if (dataLabelsRegistered || !window.ChartDataLabels || typeof Chart?.register !== 'function') return;
        try {
            Chart.register(window.ChartDataLabels);
            dataLabelsRegistered = true;
        } catch (_) {}
    }

    function legendOptions(extraLabels = {}) {
        return {
            position: 'bottom',
            align: 'center',
            labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                boxWidth: 8,
                boxHeight: 8,
                padding: 18,
                color: CHART_THEME.text,
                font: { family: CHART_FONT, size: 11, weight: '500' },
                ...extraLabels
            }
        };
    }

    function tooltipOptions(labelCallback) {
        return {
            backgroundColor: withAlpha(CHART_THEME.textStrong, .94),
            titleColor: CHART_THEME.white,
            bodyColor: CHART_THEME.white,
            borderColor: withAlpha(CHART_THEME.white, .14),
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            displayColors: true,
            usePointStyle: true,
            titleFont: { family: CHART_FONT, size: 11, weight: '700' },
            bodyFont: { family: CHART_FONT, size: 11, weight: '500' },
            callbacks: { label: labelCallback }
        };
    }

    function axisOptions({ stacked = false, offset = false } = {}) {
        return {
            x: {
                stacked,
                offset,
                grid: { display: false, drawBorder: false },
                border: { display: false },
                ticks: { color: CHART_THEME.text, font: { family: CHART_FONT, size: 11 }, maxRotation: 0, autoSkip: true }
            },
            y: {
                stacked,
                beginAtZero: true,
                grace: '10%',
                grid: { color: CHART_THEME.grid, lineWidth: 1, drawTicks: false },
                border: { display: false },
                title: { display: true, text: 'Kilogramos', color: CHART_THEME.text, font: { family: CHART_FONT, size: 11, weight: '600' }, padding: { bottom: 8 } },
                ticks: { color: CHART_THEME.text, padding: 8, font: { family: CHART_FONT, size: 11 }, callback: value => fmtChart(value) }
            }
        };
    }

    function chartOptions({ stacked = false, offset = false, tooltipLabel, padding = {} } = {}) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            layout: { padding: { top: 12, right: 14, bottom: 6, left: 4, ...padding } },
            plugins: {
                datalabels: { display: false },
                legend: legendOptions(),
                tooltip: tooltipOptions(tooltipLabel || (context => `${context.dataset.label}: ${fmtChart(context.parsed.y ?? context.parsed)} kg`))
            },
            scales: axisOptions({ stacked, offset })
        };
    }

    const doughnutCenterText = {
        id: 'residuosDoughnutCenterText',
        afterDatasetsDraw(chart, _args, options) {
            if (!options?.display || !chart.chartArea) return;
            const values = chart.data.datasets[0]?.data || [];
            const total = sum(values);
            const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
            const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
            const compact = chart.width < 420;
            const valueText = `${fmt(total)} kg`;
            const ctx = chart.ctx;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = CHART_THEME.text;
            ctx.font = `600 ${compact ? 10 : 11}px ${CHART_FONT}`;
            ctx.fillText(options.label || 'Total generado', centerX, centerY - 12);
            ctx.fillStyle = CHART_THEME.textStrong;
            ctx.font = `800 ${compact ? 14 : 17}px ${CHART_FONT}`;
            ctx.fillText(valueText, centerX, centerY + 12);
            ctx.restore();
        }
    };

    function doughnutLegendLabels(chart) {
        const defaultGenerator = Chart.overrides?.doughnut?.plugins?.legend?.labels?.generateLabels
            || Chart.defaults?.plugins?.legend?.labels?.generateLabels;
        const fallback = chart.data.labels.map((text, index) => ({ text, index }));
        const labels = typeof defaultGenerator === 'function' ? defaultGenerator(chart) : fallback;
        const values = chart.data.datasets[0]?.data || [];
        const total = sum(values);
        const showPercent = chart.width >= 460;
        return labels.map((item, index) => {
            const percentage = total > 0 ? (Number(values[index]) || 0) / total * 100 : 0;
            return {
                ...item,
                text: showPercent ? `${item.text} · ${fmtPercent(percentage)} %` : item.text,
                fillStyle: [COLORS.special, COLORS.danger, COLORS.value][index],
                strokeStyle: CHART_THEME.white,
                lineWidth: 1
            };
        });
    }

    function stackedBarRadius(context) {
        const dataIndex = context.dataIndex;
        const datasets = context.chart.data.datasets;
        let topDatasetIndex = -1;
        for (let index = datasets.length - 1; index >= 0; index -= 1) {
            if (Number(datasets[index].data[dataIndex]) > 0) { topDatasetIndex = index; break; }
        }
        return context.datasetIndex === topDatasetIndex ? { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 } : 0;
    }

    function trendGradient(context) {
        const { chart } = context;
        if (!chart.chartArea) return withAlpha(COLORS.trend, .14);
        const gradient = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
        gradient.addColorStop(0, withAlpha(COLORS.trend, .22));
        gradient.addColorStop(1, withAlpha(COLORS.trend, 0));
        return gradient;
    }

    function visibleTrendLabelIndexes(context) {
        const { chart, dataset } = context;
        const validIndexes = dataset.data.reduce((indexes, item, index) => {
            if (item !== null && Number.isFinite(Number(item))) indexes.push(index);
            return indexes;
        }, []);
        if (chart.width >= 720) return new Set(validIndexes);

        const points = chart.getDatasetMeta(context.datasetIndex)?.data || [];
        if (!validIndexes.every(index => Number.isFinite(points[index]?.x) && Number.isFinite(points[index]?.y))) {
            const step = chart.width < 480 ? 3 : 2;
            return new Set(validIndexes.filter((index, position) => position % step === 0 || position === validIndexes.length - 1));
        }

        const fontSize = chart.width < 480 ? 8 : 10;
        const labelHeight = fontSize + 5;
        const firstIndex = validIndexes[0];
        const lastIndex = validIndexes[validIndexes.length - 1];
        const boxFor = index => {
            const point = points[index];
            const offset = chart.width < 640 && index % 2 ? 15 : 6;
            chart.ctx.save();
            chart.ctx.font = `700 ${fontSize}px ${CHART_FONT}`;
            const width = chart.ctx.measureText(fmtChart(dataset.data[index])).width + 6;
            chart.ctx.restore();
            if (chart.width < 480 && index === firstIndex) {
                return { left: point.x + offset, right: point.x + offset + width, top: point.y - labelHeight / 2, bottom: point.y + labelHeight / 2 };
            }
            return { left: point.x - width / 2, right: point.x + width / 2, top: point.y - offset - labelHeight, bottom: point.y - offset };
        };
        const overlaps = (a, b) => a.left < b.right + 3 && a.right + 3 > b.left && a.top < b.bottom + 3 && a.bottom + 3 > b.top;
        const selected = [];
        validIndexes.forEach(index => {
            const box = boxFor(index);
            if (!selected.some(item => overlaps(item.box, box))) selected.push({ index, box });
        });
        if (!selected.some(item => item.index === lastIndex)) {
            const lastBox = boxFor(lastIndex);
            for (let index = selected.length - 1; index >= 0; index -= 1) {
                if (overlaps(selected[index].box, lastBox)) selected.splice(index, 1);
            }
            selected.push({ index: lastIndex, box: lastBox });
        }
        return new Set(selected.map(item => item.index));
    }

    function destroyChart(key) { if (charts[key]) { try { charts[key].destroy(); } catch (_) {} charts[key] = null; } }

    function renderCharts() {
        if (typeof Chart === 'undefined') return;
        ensureChartPlugins();
        const rows = MONTHS.map(month => rowForMonth(month.n));
        const lastDataIndex = rows.reduce((last, row, index) => hasData(row) ? index : last, -1);
        const visibleRows = rows.slice(0, Math.max(lastDataIndex + 1, 1));
        const visibleMonths = MONTHS.slice(0, Math.max(lastDataIndex + 1, 1));
        const labels = visibleMonths.map(month => month.short);
        const special = visibleRows.map(row => hasData(row) ? specialOf(row) : null);
        const danger = visibleRows.map(row => hasData(row) ? row.peligrosos_kg : null);
        const value = visibleRows.map(row => hasData(row) ? row.valorizables_kg : null);
        const total = visibleRows.map((row, i) => hasData(row) ? special[i] + (danger[i] || 0) + (value[i] || 0) : null);
        destroyChart('monthly'); destroyChart('composition'); destroyChart('trend');

        const monthlyCanvas = $('residuos-chart-mensual');
        const monthlyOptions = chartOptions({ stacked: true, offset: true });
        monthlyOptions.plugins.datalabels = {
            display: context => {
                const valueToShow = Number(context.dataset.data[context.dataIndex]);
                const bar = context.chart.getDatasetMeta(context.datasetIndex)?.data?.[context.dataIndex];
                const canvasContext = context.chart.ctx;
                canvasContext.save();
                canvasContext.font = `700 9px ${CHART_FONT}`;
                const labelWidth = canvasContext.measureText(fmtChart(valueToShow)).width;
                canvasContext.restore();
                return context.chart.width >= 620 && valueToShow > 0
                    && Math.abs(Number(bar?.height) || 0) >= 24
                    && Math.abs(Number(bar?.width) || 0) >= labelWidth + 6;
            },
            formatter: valueToShow => fmtChart(valueToShow),
            color: context => context.datasetIndex === 2 ? CHART_THEME.valueText : CHART_THEME.white,
            anchor: 'center',
            align: 'center',
            clamp: true,
            clip: true,
            font: { family: CHART_FONT, size: 9, weight: '700' }
        };
        const barDataset = (label, data, color) => ({
            label,
            data,
            backgroundColor: withAlpha(color, .88),
            hoverBackgroundColor: color,
            borderColor: color,
            borderWidth: 1,
            borderRadius: stackedBarRadius,
            borderSkipped: false,
            categoryPercentage: .74,
            barPercentage: .88,
            maxBarThickness: 68,
            stack: 'residuos'
        });
        if (monthlyCanvas) charts.monthly = new Chart(monthlyCanvas, {
            type: 'bar',
            data: { labels, datasets: [
                barDataset('Manejo especial y sólidos urbanos', special, COLORS.special),
                barDataset('Peligrosos', danger, COLORS.danger),
                barDataset('Valorizables', value, COLORS.value)
            ] },
            options: monthlyOptions
        });

        const compCanvas = $('residuos-chart-composicion');
        const compositionData = [sum(rows.map(specialOf)), sum(rows.map(row => row?.peligrosos_kg)), sum(rows.map(row => row?.valorizables_kg))];
        if (compCanvas) charts.composition = new Chart(compCanvas, {
            type: 'doughnut',
            plugins: [doughnutCenterText],
            data: {
                labels: ['Manejo especial y sólidos urbanos', 'Peligrosos', 'Valorizables'],
                datasets: [{
                    data: compositionData,
                    backgroundColor: [COLORS.special, COLORS.danger, COLORS.value],
                    hoverBackgroundColor: [COLORS.special, COLORS.danger, COLORS.value],
                    borderColor: CHART_THEME.white,
                    borderWidth: 2,
                    spacing: 1,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '56%',
                layout: { padding: { top: 4, right: 8, bottom: 4, left: 8 } },
                plugins: {
                    residuosDoughnutCenterText: { display: true, label: 'Total generado' },
                    datalabels: { display: false },
                    legend: legendOptions({ generateLabels: doughnutLegendLabels }),
                    tooltip: tooltipOptions(context => {
                        const raw = Number(context.raw) || 0;
                        const totalGenerated = sum(context.dataset.data);
                        const percentage = totalGenerated > 0 ? raw / totalGenerated * 100 : 0;
                        return `${context.label}: ${fmtChart(raw)} kg (${fmtPercent(percentage)} %)`;
                    })
                }
            }
        });

        const trendCanvas = $('residuos-chart-tendencia');
        const trendOptions = chartOptions({ offset: true, padding: { top: 28, right: 34, left: 30 } });
        trendOptions.plugins.datalabels = {
            display: context => visibleTrendLabelIndexes(context).has(context.dataIndex),
            formatter: valueToShow => fmtChart(valueToShow),
            color: COLORS.trend,
            backgroundColor: withAlpha(CHART_THEME.white, .88),
            borderRadius: 3,
            padding: { top: 2, right: 3, bottom: 2, left: 3 },
            anchor: 'end',
            align: context => context.chart.width < 480 && context.dataIndex === 0 ? 'right' : 'top',
            offset: context => context.chart.width < 640 && context.dataIndex % 2 ? 15 : 6,
            clamp: true,
            clip: false,
            font: context => ({ family: CHART_FONT, size: context.chart.width < 480 ? 8 : 10, weight: '700' })
        };
        if (trendCanvas) charts.trend = new Chart(trendCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Total generado',
                    data: total,
                    borderColor: COLORS.trend,
                    backgroundColor: trendGradient,
                    fill: true,
                    tension: .28,
                    borderWidth: 3,
                    pointRadius: 3.5,
                    pointHoverRadius: 5.5,
                    pointHitRadius: 12,
                    pointBackgroundColor: CHART_THEME.white,
                    pointBorderColor: COLORS.trend,
                    pointBorderWidth: 2,
                    spanGaps: false
                }]
            },
            options: trendOptions
        });
    }

    function renderAll() { renderKpis(); renderTable(); renderCharts(); applyAccess(); }

    function loadEditorValues() {
        const row = rowForMonth(state.editMonth) || {};
        const set = (id, value) => { if ($(id)) $(id).value = value === null || value === undefined ? '' : value; };
        set('residuos-inorganicos', row.inorganicos_kg); set('residuos-organicos', row.organicos_kg); set('residuos-lodos', row.lodos_kg); set('residuos-manejo-especial', row.manejo_especial_kg); set('residuos-peligrosos', row.peligrosos_kg); set('residuos-valorizables', row.valorizables_kg); set('residuos-observaciones', row.observaciones || '');
    }

    function applyAccess() {
        const editable = canEdit();
        const locked = $('residuos-capture-locked');
        if (locked) locked.classList.toggle('d-none', editable);
        ['residuos-edit-month', 'residuos-inorganicos', 'residuos-organicos', 'residuos-lodos', 'residuos-manejo-especial', 'residuos-peligrosos', 'residuos-valorizables', 'residuos-observaciones', 'residuos-save'].forEach(id => { if ($(id)) $(id).disabled = !editable; });
    }

    async function saveMonth() {
        if (!canEdit()) { setStatus('No tienes permiso para capturar en Hidráulicas.', 'warning'); return; }
        const month = monthByNumber(state.editMonth);
        const payload = {
            anio: Number(state.selectedYear), mes_num: month.n, mes_nombre: month.long,
            inorganicos_kg: num($('residuos-inorganicos')?.value), organicos_kg: num($('residuos-organicos')?.value),
            lodos_kg: num($('residuos-lodos')?.value), manejo_especial_kg: num($('residuos-manejo-especial')?.value),
            peligrosos_kg: num($('residuos-peligrosos')?.value),
            valorizables_kg: num($('residuos-valorizables')?.value), observaciones: $('residuos-observaciones')?.value.trim() || null
        };
        const status = $('residuos-edit-status');
        if (status) status.textContent = 'Guardando…';
        try {
            const sb = await client();
            const result = await sb.from(TABLE).upsert(payload, { onConflict: 'anio,mes_num' }).select().single();
            if (result.error) throw result.error;
            state.loaded = false;
            await load(true);
            if (status) status.textContent = `Guardado · ${month.long} ${state.selectedYear}`;
        } catch (error) {
            console.error('[residuos-hidraulicas] save error:', error);
            if (status) status.textContent = `Error: ${error.message || error}`;
            setStatus('No se pudo guardar el registro mensual.', 'danger');
        }
    }

    function exportExcel() {
        if (typeof XLSX === 'undefined') { setStatus('La librería de Excel no está disponible.', 'warning'); return; }
        const rows = MONTHS.map(month => { const row = rowForMonth(month.n) || {}; return [state.selectedYear, month.long, row.inorganicos_kg, row.organicos_kg, row.lodos_kg, row.manejo_especial_kg, row.peligrosos_kg, row.valorizables_kg]; });
        const totals = [state.selectedYear, 'Subtotal (kg)', sum(rows.map(r => r[2])), sum(rows.map(r => r[3])), sum(rows.map(r => r[4])), sum(rows.map(r => r[5])), sum(rows.map(r => r[6])), sum(rows.map(r => r[7]))];
        const aoa = [['Residuos de manejo especial y sólidos urbanos, peligrosos y valorizables', state.selectedYear], [], ['Año', 'Mes', 'Inorgánico (kg)', 'Orgánico (kg)', 'Lodos (kg)', 'Residuos de Manejo Especial (kg)', 'Peligrosos (kg)', 'Valorizables (kg)'], ...rows, totals, [], ['Notas'], ['Los datos presentados son proporcionados por ASECA, S.A. de C.V., a través de la Gerencia de Servicios Generales.'], ['Las cantidades mensuales son preliminares y podrán actualizarse cuando se reciban los manifiestos oficiales.']];
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Residuos'); XLSX.writeFile(wb, `Residuos_GOMIH_${state.selectedYear}.xlsx`);
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;
        document.addEventListener('click', event => {
            const link = event.target.closest('[data-hidra-tab="residuos"]');
            if (!link) return;
            // showSection cambia primero a Hidráulicas; después activamos la
            // pestaña específica para que el acceso del menú sea directo.
            setTimeout(() => {
                const tabButton = $('hidra-tabbtn-residuos');
                if (!tabButton) return;
                try {
                    if (window.bootstrap?.Tab) new window.bootstrap.Tab(tabButton).show();
                    else tabButton.click();
                } catch (_) { tabButton.click(); }
            }, 100);
        });
        $('residuos-year-select')?.addEventListener('change', () => { state.selectedYear = Number($('residuos-year-select').value); loadEditorValues(); renderAll(); });
        $('residuos-edit-month')?.addEventListener('change', () => { state.editMonth = Number($('residuos-edit-month').value) || 1; loadEditorValues(); });
        $('residuos-refresh')?.addEventListener('click', () => { state.loaded = false; load(true); });
        $('residuos-export')?.addEventListener('click', exportExcel);
        $('residuos-save')?.addEventListener('click', saveMonth);
        $('hidra-tabbtn-residuos')?.addEventListener('shown.bs.tab', () => { if (state.loaded) renderCharts(); });
        $('residuos-table-body')?.addEventListener('click', event => { const button = event.target.closest('.residuos-edit-row'); if (!button) return; state.editMonth = Number(button.dataset.month); const select = $('residuos-edit-month'); if (select) select.value = String(state.editMonth); loadEditorValues(); document.getElementById('residuos-save')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    }

    async function init() {
        bind();
        if (state.selectedYear === null) state.selectedYear = new Date().getFullYear();
        if (!state.editMonth) state.editMonth = new Date().getMonth() + 1;
        await load(false);
    }

    // Se enlaza desde que carga el script para que el acceso directo del menú
    // funcione incluso cuando el usuario entra por primera vez a Hidráulicas.
    bind();
    window.addEventListener('hidraulicas:visible', () => init().catch(error => console.error('[residuos-hidraulicas] init error:', error)));
    window.residuosHidraulicasModule = { init, load, state };
})();
