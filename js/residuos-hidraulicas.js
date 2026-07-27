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
    const COLORS = { special: '#17658a', danger: '#c00000', value: '#e0a800', green: '#047857' };
    const state = { rows: [], years: [], selectedYear: null, editMonth: 1, loaded: false, loading: false, bound: false };
    const charts = { monthly: null, composition: null, trend: null };

    const $ = id => document.getElementById(id);
    const monthByNumber = n => MONTHS.find(m => m.n === Number(n)) || MONTHS[0];
    const num = value => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };
    const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);
    const hasData = row => ['inorganicos_kg', 'organicos_kg', 'lodos_kg', 'peligrosos_kg', 'valorizables_kg'].some(k => row && row[k] !== null && row[k] !== undefined);
    const specialOf = row => sum([row?.inorganicos_kg, row?.organicos_kg, row?.lodos_kg]);

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
            lodos_kg: num(row.lodos_kg), peligrosos_kg: num(row.peligrosos_kg),
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
                <td>${fmt(row?.inorganicos_kg)}</td><td>${fmt(row?.organicos_kg)}</td><td>${fmt(row?.lodos_kg)}</td>
                <td>${fmt(row?.peligrosos_kg)}</td><td>${fmt(row?.valorizables_kg)}</td>
                <td class="text-center"><button type="button" class="btn btn-outline-primary btn-sm residuos-edit-row" data-month="${MONTHS[index].n}" title="Editar ${MONTHS[index].long}"><i class="fas fa-pen"></i></button></td>
            </tr>`;
        }).join('');
        const totals = {
            inorganicos_kg: sum(rows.map(row => row?.inorganicos_kg)),
            organicos_kg: sum(rows.map(row => row?.organicos_kg)),
            lodos_kg: sum(rows.map(row => row?.lodos_kg)),
            peligrosos_kg: sum(rows.map(row => row?.peligrosos_kg)),
            valorizables_kg: sum(rows.map(row => row?.valorizables_kg))
        };
        const special = totals.inorganicos_kg + totals.organicos_kg + totals.lodos_kg;
        foot.innerHTML = `<tr>
            <td colspan="2">Subtotal (kg)</td><td>${fmt(totals.inorganicos_kg)}</td><td>${fmt(totals.organicos_kg)}</td><td>${fmt(totals.lodos_kg)}</td><td>${fmt(totals.peligrosos_kg)}</td><td>${fmt(totals.valorizables_kg)}</td><td></td>
        </tr><tr>
            <td colspan="2">Total generado</td><td colspan="3" class="residuos-total-special text-center">${fmt(special)} kg</td><td class="residuos-total-danger">${fmt(totals.peligrosos_kg)}</td><td class="residuos-total-value">${fmt(totals.valorizables_kg)}</td><td></td>
        </tr>`;
    }

    function chartOptions(yTitle) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                // Los valores se consultan en tooltip; evita etiquetas encimadas
                // en barras apiladas y puntos cercanos.
                datalabels: { display: false },
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 9, padding: 14 } },
                tooltip: { callbacks: { label: context => `${context.dataset.label}: ${fmt(context.parsed.y ?? context.parsed) } kg` } }
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: yTitle }, ticks: { callback: value => Number(value).toLocaleString('es-MX') } }, x: { grid: { display: false } } }
        };
    }

    function destroyChart(key) { if (charts[key]) { try { charts[key].destroy(); } catch (_) {} charts[key] = null; } }

    function renderCharts() {
        if (typeof Chart === 'undefined') return;
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
        const monthlyOptions = chartOptions('Kilogramos');
        monthlyOptions.plugins = { ...monthlyOptions.plugins, datalabels: {
            display: context => Number(context.dataset.data[context.dataIndex] || 0) >= 1000,
            formatter: valueToShow => Number(valueToShow).toLocaleString('es-MX', { maximumFractionDigits: 0 }),
            color: context => context.datasetIndex === 2 ? '#111827' : '#fff', anchor: 'center', align: 'center', clamp: true,
            font: { size: 9, weight: '700' }
        } };
        if (monthlyCanvas) charts.monthly = new Chart(monthlyCanvas, { type: 'bar', data: { labels, datasets: [
            { label: 'Manejo especial', data: special, backgroundColor: COLORS.special, borderRadius: 4 },
            { label: 'Peligrosos', data: danger, backgroundColor: COLORS.danger, borderRadius: 4 },
            { label: 'Valorizables', data: value, backgroundColor: COLORS.value, borderRadius: 4 }
        ] }, options: { ...monthlyOptions, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Kilogramos' }, ticks: { callback: v => Number(v).toLocaleString('es-MX') } } } } });
        const compCanvas = $('residuos-chart-composicion');
        if (compCanvas) charts.composition = new Chart(compCanvas, { type: 'doughnut', data: { labels: ['Manejo especial', 'Peligrosos', 'Valorizables'], datasets: [{ data: [sum(rows.map(specialOf)), sum(rows.map(row => row?.peligrosos_kg)), sum(rows.map(row => row?.valorizables_kg))], backgroundColor: [COLORS.special, COLORS.danger, COLORS.value], borderColor: '#fff', borderWidth: 3 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { datalabels: { display: false }, legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 9, padding: 14 } }, tooltip: { callbacks: { label: context => `${context.label}: ${fmt(context.raw)} kg` } } } } });
        const trendCanvas = $('residuos-chart-tendencia');
        const trendOptions = chartOptions('Kilogramos');
        trendOptions.plugins = { ...trendOptions.plugins, datalabels: {
            display: context => context.dataIndex === context.dataset.data.length - 1 && Number(context.dataset.data[context.dataIndex] || 0) > 0,
            formatter: valueToShow => Number(valueToShow).toLocaleString('es-MX', { maximumFractionDigits: 0 }),
            color: COLORS.green, anchor: 'end', align: 'top', offset: 5, clamp: true,
            font: { size: 10, weight: '700' }
        } };
        if (trendCanvas) charts.trend = new Chart(trendCanvas, { type: 'line', data: { labels, datasets: [{ label: 'Total generado', data: total, borderColor: COLORS.green, backgroundColor: 'rgba(4,120,87,.12)', fill: true, tension: .32, pointRadius: 4, pointBackgroundColor: COLORS.green }] }, options: trendOptions });
    }

    function renderAll() { renderKpis(); renderTable(); renderCharts(); applyAccess(); }

    function loadEditorValues() {
        const row = rowForMonth(state.editMonth) || {};
        const set = (id, value) => { if ($(id)) $(id).value = value === null || value === undefined ? '' : value; };
        set('residuos-inorganicos', row.inorganicos_kg); set('residuos-organicos', row.organicos_kg); set('residuos-lodos', row.lodos_kg); set('residuos-peligrosos', row.peligrosos_kg); set('residuos-valorizables', row.valorizables_kg); set('residuos-observaciones', row.observaciones || '');
    }

    function applyAccess() {
        const editable = canEdit();
        const locked = $('residuos-capture-locked');
        if (locked) locked.classList.toggle('d-none', editable);
        ['residuos-edit-month', 'residuos-inorganicos', 'residuos-organicos', 'residuos-lodos', 'residuos-peligrosos', 'residuos-valorizables', 'residuos-observaciones', 'residuos-save'].forEach(id => { if ($(id)) $(id).disabled = !editable; });
    }

    async function saveMonth() {
        if (!canEdit()) { setStatus('No tienes permiso para capturar en Hidráulicas.', 'warning'); return; }
        const month = monthByNumber(state.editMonth);
        const payload = {
            anio: Number(state.selectedYear), mes_num: month.n, mes_nombre: month.long,
            inorganicos_kg: num($('residuos-inorganicos')?.value), organicos_kg: num($('residuos-organicos')?.value),
            lodos_kg: num($('residuos-lodos')?.value), peligrosos_kg: num($('residuos-peligrosos')?.value),
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
        const rows = MONTHS.map(month => { const row = rowForMonth(month.n) || {}; return [state.selectedYear, month.long, row.inorganicos_kg, row.organicos_kg, row.lodos_kg, row.peligrosos_kg, row.valorizables_kg]; });
        const totals = [state.selectedYear, 'Subtotal (kg)', sum(rows.map(r => r[2])), sum(rows.map(r => r[3])), sum(rows.map(r => r[4])), sum(rows.map(r => r[5])), sum(rows.map(r => r[6]))];
        const aoa = [['Residuos de manejo especial, peligrosos y valorizables', state.selectedYear], [], ['Año', 'Mes', 'Inorgánico (kg)', 'Orgánico (kg)', 'Lodos (kg)', 'Peligrosos (kg)', 'Valorizables (kg)'], ...rows, totals, [], ['Notas'], ['Los datos presentados son proporcionados por ASECA, S.A. de C.V., a través de la Gerencia de Servicios Generales.'], ['Las cantidades mensuales son preliminares y podrán actualizarse cuando se reciban los manifiestos oficiales.']];
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
