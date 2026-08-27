/* ============================================================
 * GOMIH | Residuos de manejo especial, peligrosos y valorizables
 * Dashboard historico/mensual con captura, totales, graficas y exportacion.
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
    // Respaldo de lectura para que el historico sea visible aun antes de aplicar
    // la migracion. Si una fila ya existe en Supabase, siempre prevalece la BD.
    const HISTORICAL_SOURCE_ROWS = [
        { anio: 2022, mes_num: 3, mes_nombre: 'Marzo', inorganicos_kg: 5280, organicos_kg: 0, peligrosos_kg: null, observaciones: 'Sin generación' },
        { anio: 2022, mes_num: 4, mes_nombre: 'Abril', inorganicos_kg: 22640, organicos_kg: 0, peligrosos_kg: null, observaciones: 'Sin generación' },
        { anio: 2022, mes_num: 5, mes_nombre: 'Mayo', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin generación' },
        { anio: 2022, mes_num: 6, mes_nombre: 'Junio', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin disposición' },
        { anio: 2022, mes_num: 7, mes_nombre: 'Julio', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin disposición' },
        { anio: 2022, mes_num: 8, mes_nombre: 'Agosto', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin disposición' },
        { anio: 2022, mes_num: 9, mes_nombre: 'Septiembre', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin disposición' },
        { anio: 2022, mes_num: 10, mes_nombre: 'Octubre', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin disposición' },
        { anio: 2022, mes_num: 11, mes_nombre: 'Noviembre', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: null, observaciones: 'Sin disposición' },
        { anio: 2022, mes_num: 12, mes_nombre: 'Diciembre', inorganicos_kg: null, organicos_kg: null, peligrosos_kg: 403.6, observaciones: null },
        { anio: 2023, mes_num: 1, mes_nombre: 'Enero', inorganicos_kg: 41420, organicos_kg: 82860, peligrosos_kg: 476.6, observaciones: null },
        { anio: 2023, mes_num: 2, mes_nombre: 'Febrero', inorganicos_kg: 29650, organicos_kg: 108120, peligrosos_kg: 0, observaciones: null },
        { anio: 2024, mes_num: 1, mes_nombre: 'Enero', inorganicos_kg: 52180, organicos_kg: 12830, peligrosos_kg: 172.2, observaciones: null },
        { anio: 2024, mes_num: 2, mes_nombre: 'Febrero', inorganicos_kg: 68840, organicos_kg: 3640, peligrosos_kg: 575, observaciones: null },
        { anio: 2025, mes_num: 1, mes_nombre: 'Enero', inorganicos_kg: 91836, organicos_kg: 2950, peligrosos_kg: 173, observaciones: null },
        { anio: 2025, mes_num: 2, mes_nombre: 'Febrero', inorganicos_kg: 17710, organicos_kg: 86390, peligrosos_kg: 1624.4, observaciones: null }
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
    const HISTORICAL_FIRST_YEAR = 2022;
    const HISTORICAL_LAST_YEAR = 2025;
    const state = { rows: [], years: [], selectedYear: null, editMonth: 1, loaded: false, loading: false, bound: false };
    const charts = { monthly: null, composition: null, trend: null, annual: null };
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
    const numericFields = ['inorganicos_kg', 'organicos_kg', 'lodos_kg', 'manejo_especial_kg', 'peligrosos_kg', 'valorizables_kg'];
    const isHistoricalYear = year => Number(year) >= HISTORICAL_FIRST_YEAR && Number(year) <= HISTORICAL_LAST_YEAR;
    const hasNumericData = row => (isHistoricalYear(row?.anio)
        ? ['inorganicos_kg', 'organicos_kg', 'peligrosos_kg']
        : numericFields).some(k => row && row[k] !== null && row[k] !== undefined);
    const hasData = row => hasNumericData(row) || !!String(row?.observaciones || '').trim();
    const specialOf = row => sum(isHistoricalYear(row?.anio)
        ? [row?.inorganicos_kg, row?.organicos_kg]
        : [row?.inorganicos_kg, row?.organicos_kg, row?.lodos_kg, row?.manejo_especial_kg]);
    const monthsForYear = year => Number(year) === HISTORICAL_FIRST_YEAR ? MONTHS.filter(month => month.n >= 3) : MONTHS;
    const hazardStatus = row => {
        if (!row || row.peligrosos_kg !== null && row.peligrosos_kg !== undefined) return '';
        const observation = String(row.observaciones || '').trim();
        if (/^sin generaci[oó]n\.?$/i.test(observation)) return 'Sin generación';
        if (/^sin disposici[oó]n\.?$/i.test(observation)) return 'Sin disposición';
        return '';
    };
    const hazardDisplay = row => row?.peligrosos_kg !== null && row?.peligrosos_kg !== undefined
        ? fmt(row.peligrosos_kg)
        : hazardStatus(row) || '—';
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
            const databaseRows = normalizeRows(result.data);
            const databaseKeys = new Set(databaseRows.map(row => `${row.anio}-${row.mes_num}`));
            const fallbackRows = normalizeRows(HISTORICAL_SOURCE_ROWS)
                .filter(row => !databaseKeys.has(`${row.anio}-${row.mes_num}`));
            state.rows = [...databaseRows, ...fallbackRows];
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
        const availableMonths = monthsForYear(state.selectedYear);
        if (!availableMonths.some(month => month.n === Number(state.editMonth))) state.editMonth = availableMonths[0].n;
        select.innerHTML = availableMonths.map(month => `<option value="${month.n}">${month.long}</option>`).join('');
        select.value = String(state.editMonth);
        loadEditorValues();
    }

    function renderKpis() {
        const rows = state.rows.filter(row => row.anio === Number(state.selectedYear));
        const special = sum(rows.map(specialOf));
        const danger = sum(rows.map(row => row.peligrosos_kg));
        const value = sum(rows.map(row => row.valorizables_kg));
        const months = rows.filter(hasData).length;
        const availableMonths = monthsForYear(state.selectedYear);
        const set = (id, text) => { if ($(id)) $(id).textContent = text; };
        set('residuos-kpi-especial', fmt(special));
        set('residuos-kpi-peligrosos', fmt(danger));
        set('residuos-kpi-valorizables', fmt(value));
        set('residuos-kpi-meses', `${months} / ${availableMonths.length}`);
    }

    function renderTable() {
        const head = $('residuos-table-head');
        const body = $('residuos-table-body');
        const foot = $('residuos-table-foot');
        if (!body || !foot) return;
        const historical = isHistoricalYear(state.selectedYear);
        const availableMonths = monthsForYear(state.selectedYear);
        const rows = availableMonths.map(month => rowForMonth(month.n));
        if (head) head.innerHTML = historical
            ? '<tr><th rowspan="2" class="res-th-base">Año</th><th rowspan="2" class="res-th-base">Mes</th><th colspan="2" class="res-th-especial">Residuos de manejo especial y sólidos urbanos</th><th rowspan="2" class="res-th-peligrosos">Residuos<br>peligrosos<br>(kg)</th><th rowspan="2" class="res-th-base">Acciones</th></tr><tr><th class="res-th-sub">Inorgánico<br>(kg)</th><th class="res-th-sub">Orgánico<br>(kg)</th></tr>'
            : '<tr><th rowspan="2" class="res-th-base">Año</th><th rowspan="2" class="res-th-base">Mes</th><th colspan="4" class="res-th-especial">Residuos de manejo especial y sólidos urbanos</th><th rowspan="2" class="res-th-peligrosos">Residuos<br>peligrosos<br>(kg)</th><th rowspan="2" class="res-th-valorizables">Residuos<br>valorizables<br>(kg)</th><th rowspan="2" class="res-th-base">Acciones</th></tr><tr><th class="res-th-sub">Inorgánico<br>(kg)</th><th class="res-th-sub">Orgánico<br>(kg)</th><th class="res-th-sub">Lodos<br>(kg)</th><th class="res-th-sub">Residuos de<br>Manejo Especial<br>(kg)</th></tr>';
        body.innerHTML = rows.map((row, index) => {
            const empty = !hasData(row);
            const hazard = hazardDisplay(row);
            const hazardClass = hazardStatus(row) ? ' class="text-center residuos-hazard-status"' : '';
            const month = availableMonths[index];
            if (historical) return `<tr class="${empty ? 'residuos-no-data' : ''}">
                <td>${state.selectedYear}</td><td>${month.long}</td>
                <td>${fmt(row?.inorganicos_kg)}</td><td>${fmt(row?.organicos_kg)}</td>
                <td${hazardClass}>${hazard}</td>
                <td class="text-center"><button type="button" class="btn btn-outline-primary btn-sm residuos-edit-row" data-month="${month.n}" title="Editar ${month.long}"><i class="fas fa-pen"></i></button></td>
            </tr>`;
            return `<tr class="${empty ? 'residuos-no-data' : ''}">
                <td>${state.selectedYear}</td><td>${month.long}</td>
                <td>${fmt(row?.inorganicos_kg)}</td><td>${fmt(row?.organicos_kg)}</td><td>${fmt(row?.lodos_kg)}</td><td>${fmt(row?.manejo_especial_kg)}</td>
                <td${hazardClass}>${hazard}</td><td>${fmt(row?.valorizables_kg)}</td>
                <td class="text-center"><button type="button" class="btn btn-outline-primary btn-sm residuos-edit-row" data-month="${month.n}" title="Editar ${month.long}"><i class="fas fa-pen"></i></button></td>
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
        const special = totals.inorganicos_kg + totals.organicos_kg
            + (historical ? 0 : totals.lodos_kg + totals.manejo_especial_kg);
        foot.innerHTML = historical ? `<tr>
            <td colspan="2">Subtotal (kg)</td><td>${fmt(totals.inorganicos_kg)}</td><td>${fmt(totals.organicos_kg)}</td><td rowspan="2" class="residuos-total-danger">${fmt(totals.peligrosos_kg)}</td><td rowspan="2"></td>
        </tr><tr>
            <td colspan="2">Total manejo especial y sólidos urbanos</td><td colspan="2" class="residuos-total-special text-center">${fmt(special)} kg</td>
        </tr>` : `<tr>
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
        const historical = isHistoricalYear(state.selectedYear);
        const availableMonths = monthsForYear(state.selectedYear);
        const rows = availableMonths.map(month => rowForMonth(month.n));
        const lastDataIndex = rows.reduce((last, row, index) => hasNumericData(row) ? index : last, -1);
        const visibleRows = rows.slice(0, Math.max(lastDataIndex + 1, 1));
        const visibleMonths = availableMonths.slice(0, Math.max(lastDataIndex + 1, 1));
        const labels = visibleMonths.map(month => month.short);
        const special = visibleRows.map(row => hasNumericData(row) ? specialOf(row) : null);
        const danger = visibleRows.map(row => hasNumericData(row) ? row.peligrosos_kg : null);
        const value = visibleRows.map(row => hasNumericData(row) ? row.valorizables_kg : null);
        const total = visibleRows.map((row, i) => hasNumericData(row) ? special[i] + (danger[i] || 0) + (historical ? 0 : value[i] || 0) : null);
        destroyChart('monthly'); destroyChart('composition'); destroyChart('trend'); destroyChart('annual');

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
        const monthlyDatasets = [
            barDataset('Manejo especial y sólidos urbanos', special, COLORS.special),
            barDataset('Peligrosos', danger, COLORS.danger)
        ];
        if (!historical) monthlyDatasets.push(barDataset('Valorizables', value, COLORS.value));
        if (monthlyCanvas) charts.monthly = new Chart(monthlyCanvas, {
            type: 'bar',
            data: { labels, datasets: monthlyDatasets },
            options: monthlyOptions
        });

        const compCanvas = $('residuos-chart-composicion');
        const compositionLabels = ['Manejo especial y sólidos urbanos', 'Peligrosos'];
        const compositionData = [sum(rows.map(specialOf)), sum(rows.map(row => row?.peligrosos_kg))];
        const compositionColors = [COLORS.special, COLORS.danger];
        if (!historical) {
            compositionLabels.push('Valorizables');
            compositionData.push(sum(rows.map(row => row?.valorizables_kg)));
            compositionColors.push(COLORS.value);
        }
        if (compCanvas) charts.composition = new Chart(compCanvas, {
            type: 'doughnut',
            plugins: [doughnutCenterText],
            data: {
                labels: compositionLabels,
                datasets: [{
                    data: compositionData,
                    backgroundColor: compositionColors,
                    hoverBackgroundColor: compositionColors,
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

        const annualCanvas = $('residuos-chart-anual');
        const annualYears = state.years.filter(Number.isFinite).sort((a, b) => a - b);
        const annualRows = annualYears.map(year => state.rows.filter(row => row.anio === year));
        const annualSpecial = annualRows.map(yearRows => sum(yearRows.map(specialOf)));
        const annualDanger = annualRows.map(yearRows => sum(yearRows.map(row => row.peligrosos_kg)));
        const annualValue = annualRows.map((yearRows, index) => isHistoricalYear(annualYears[index])
            ? null
            : sum(yearRows.map(row => row.valorizables_kg)));
        const annualOptions = chartOptions({ stacked: true, offset: true, padding: { top: 20, right: 24, left: 16 } });
        annualOptions.plugins.datalabels = { display: false };
        const annualDatasets = [
            barDataset('Manejo especial y sólidos urbanos', annualSpecial, COLORS.special),
            barDataset('Peligrosos', annualDanger, COLORS.danger)
        ];
        if (annualValue.some(valueToShow => valueToShow > 0)) annualDatasets.push(barDataset('Valorizables', annualValue, COLORS.value));
        if (annualCanvas) charts.annual = new Chart(annualCanvas, {
            type: 'bar',
            data: { labels: annualYears.map(String), datasets: annualDatasets },
            options: annualOptions
        });
    }

    function updateYearPresentation() {
        const historical = isHistoricalYear(state.selectedYear);
        const setText = (id, text) => { if ($(id)) $(id).textContent = text; };
        setText('residuos-hero-subtitle', historical
            ? 'Manejo especial y sólidos urbanos (orgánicos e inorgánicos) · Residuos peligrosos · GOMIH'
            : 'Residuos de manejo especial, peligrosos y valorizables · GOMIH');
        setText('residuos-kpi-especial-unit', historical ? 'kg · inorgánico + orgánico' : 'kg · inorgánico + orgánico + lodos + manejo especial');
        setText('residuos-kpi-meses-unit', `de ${monthsForYear(state.selectedYear).length} meses del periodo`);
        setText('residuos-table-help', historical
            ? 'Los guiones representan valores que no aparecen desglosados en el archivo histórico proporcionado.'
            : 'Los guiones representan meses sin información capturada.');
        setText('residuos-table-source', historical ? 'Fuente: archivo histórico 2022–2025' : 'Fuente: ASECA · datos preliminares');
        $('residuos-note-historical')?.classList.toggle('d-none', !historical);
        $('residuos-note-current')?.classList.toggle('d-none', historical);
        $('residuos-note-preliminary')?.classList.toggle('d-none', historical);
        $('residuos-kpi-card-valorizables')?.classList.toggle('d-none', historical);
        document.querySelectorAll('.residuos-kpi-col').forEach(element => {
            element.classList.toggle('col-xl-3', !historical);
            element.classList.toggle('col-xl-4', historical);
        });
        ['residuos-editor-lodos', 'residuos-editor-manejo-especial', 'residuos-editor-valorizables'].forEach(id => {
            $(id)?.classList.toggle('d-none', historical);
        });
    }

    function renderAll() { updateYearPresentation(); renderKpis(); renderTable(); renderCharts(); applyAccess(); }

    function loadEditorValues() {
        const row = rowForMonth(state.editMonth) || {};
        const set = (id, value) => { if ($(id)) $(id).value = value === null || value === undefined ? '' : value; };
        set('residuos-inorganicos', row.inorganicos_kg); set('residuos-organicos', row.organicos_kg); set('residuos-lodos', row.lodos_kg); set('residuos-manejo-especial', row.manejo_especial_kg); set('residuos-peligrosos', row.peligrosos_kg); set('residuos-valorizables', row.valorizables_kg); set('residuos-observaciones', row.observaciones || '');
    }

    function applyAccess() {
        const editable = canEdit();
        const historical = isHistoricalYear(state.selectedYear);
        const locked = $('residuos-capture-locked');
        if (locked) locked.classList.toggle('d-none', editable);
        ['residuos-edit-month', 'residuos-inorganicos', 'residuos-organicos', 'residuos-peligrosos', 'residuos-observaciones', 'residuos-save'].forEach(id => { if ($(id)) $(id).disabled = !editable; });
        ['residuos-lodos', 'residuos-manejo-especial', 'residuos-valorizables'].forEach(id => { if ($(id)) $(id).disabled = !editable || historical; });
    }

    async function saveMonth() {
        if (!canEdit()) { setStatus('No tienes permiso para capturar en Hidráulicas.', 'warning'); return; }
        const month = monthByNumber(state.editMonth);
        const historical = isHistoricalYear(state.selectedYear);
        const payload = {
            anio: Number(state.selectedYear), mes_num: month.n, mes_nombre: month.long,
            inorganicos_kg: num($('residuos-inorganicos')?.value), organicos_kg: num($('residuos-organicos')?.value),
            lodos_kg: historical ? null : num($('residuos-lodos')?.value), manejo_especial_kg: historical ? null : num($('residuos-manejo-especial')?.value),
            peligrosos_kg: num($('residuos-peligrosos')?.value),
            valorizables_kg: historical ? null : num($('residuos-valorizables')?.value), observaciones: $('residuos-observaciones')?.value.trim() || null
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
        const historical = isHistoricalYear(state.selectedYear);
        const months = monthsForYear(state.selectedYear);
        const rows = months.map(month => {
            const row = rowForMonth(month.n) || {};
            if (historical) return [state.selectedYear, month.long, row.inorganicos_kg, row.organicos_kg, row.peligrosos_kg ?? (hazardStatus(row) || null)];
            return [state.selectedYear, month.long, row.inorganicos_kg, row.organicos_kg, row.lodos_kg, row.manejo_especial_kg, row.peligrosos_kg, row.valorizables_kg];
        });
        const totals = historical
            ? [state.selectedYear, 'Subtotal (kg)', sum(rows.map(r => r[2])), sum(rows.map(r => r[3])), sum(months.map(month => rowForMonth(month.n)?.peligrosos_kg))]
            : [state.selectedYear, 'Subtotal (kg)', sum(rows.map(r => r[2])), sum(rows.map(r => r[3])), sum(rows.map(r => r[4])), sum(rows.map(r => r[5])), sum(rows.map(r => r[6])), sum(rows.map(r => r[7]))];
        const aoa = historical
            ? [['Residuos de manejo especial y sólidos urbanos y residuos peligrosos', state.selectedYear], [], ['Año', 'Mes', 'Inorgánico (kg)', 'Orgánico (kg)', 'Peligrosos (kg)'], ...rows, totals, [], ['Notas'], ['Fuente: Registros de residuos 2022-2025.xlsx.'], ['Los campos vacíos no se convierten en cero; se conservan como información no desglosada en el archivo histórico.']]
            : [['Residuos de manejo especial y sólidos urbanos, peligrosos y valorizables', state.selectedYear], [], ['Año', 'Mes', 'Inorgánico (kg)', 'Orgánico (kg)', 'Lodos (kg)', 'Residuos de Manejo Especial (kg)', 'Peligrosos (kg)', 'Valorizables (kg)'], ...rows, totals, [], ['Notas'], ['Los datos presentados son proporcionados por ASECA, S.A. de C.V., a través de la Gerencia de Servicios Generales.'], ['Las cantidades mensuales son preliminares y podrán actualizarse cuando se reciban los manifiestos oficiales.']];
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
        $('residuos-year-select')?.addEventListener('change', () => { state.selectedYear = Number($('residuos-year-select').value); populateEditMonth(); renderAll(); });
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
