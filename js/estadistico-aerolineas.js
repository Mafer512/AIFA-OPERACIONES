/* Estadístico por aerolínea — Comparativa Histórica.
 * Fuente: daily_flights_ops. Soporta registros atómicos (pasajeros + tipo_operacion)
 * y registros anchos (pasajeros_llegada / pasajeros_salida).
 */
(function () {
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const PALETTE = ['#6d28d9', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#475569'];
    const HISTORICAL_YEARS = ['2026', '2025', '2024', '2023', '2022'];
    const state = { rows: [], months: new Set(MONTHS.map((_, index) => index + 1)), metric: 'pasajeros', year: null, chart: null, totals: [] };
    const fmt = new Intl.NumberFormat('es-MX');

    function num(value) { return Number(value) || 0; }
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }
    function monthOf(value) {
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? null : date.getMonth() + 1;
    }

    async function load() {
        const client = window.supabaseClient;
        if (!client) return;
        // Fuente principal: itinerario editable. Contiene aerolínea y el campo
        // Boarded para llegadas/salidas, aun cuando no exista el Parte diario.
        const historicalRows = await loadHistoricalAirlineStats(client);
        const editableRows = await loadEditableItinerary(client);
        const officialYears = new Set(historicalRows.map(row => row.fecha.slice(0, 4)));
        // La fuente consolidada prevalece para todo el ejercicio para evitar
        // mezclar nombres oficiales con códigos de itinerario (VB, Y4, etc.).
        // El itinerario solo se utiliza cuando no existe un reporte oficial.
        state.rows = historicalRows.concat(editableRows.filter(row => !officialYears.has(String(row.fecha || '').slice(0, 4))));

        // La aplicación actual resguarda el Parte de Operaciones por fecha,
        // con sus vuelos dentro de la columna JSON `data`.
        let dailyBatches = null;
        let batchError = null;
        if (!state.rows.length) ({ data: dailyBatches, error: batchError } = await client
            .from('vuelos_parte_operaciones')
            .select('date,data')
            .order('date', { ascending: true }));
        if (!state.rows.length && !batchError && Array.isArray(dailyBatches)) {
            state.rows = dailyBatches.flatMap(batch => (Array.isArray(batch.data) ? batch.data : []).map(operation => ({
                fecha: batch.date,
                aerolinea: operation.aerolinea || operation.Aerolinea || operation['Aerolínea'] || operation.airline,
                pasajeros: operation.pasajeros || operation.Pasajeros,
                pasajeros_llegada: operation.pasajeros_llegada ?? operation['Pasajeros llegada'] ?? operation.PaxArr,
                pasajeros_salida: operation.pasajeros_salida ?? operation['Pasajeros salida'] ?? operation.PaxDep,
                tipo_operacion: operation.tipo_operacion || operation['Tipo de operación']
            })));
        }

        // Compatibilidad con la tabla atómica previa, si está instalada.
        let data = null;
        let error = batchError;
        if (!state.rows.length) ({ data, error } = await client
            .from('daily_flights_ops')
            .select('fecha,aerolinea,pasajeros,pasajeros_llegada,pasajeros_salida,tipo_operacion')
            .not('fecha', 'is', null)
            .order('fecha', { ascending: true }));
        // Compatibilidad con instalaciones que todavía solo cuentan con el
        // formato atómico original de daily_flights_ops.
        if (error) {
            ({ data, error } = await client
                .from('daily_flights_ops')
                .select('fecha,aerolinea,pasajeros,tipo_operacion')
                .not('fecha', 'is', null)
                .order('fecha', { ascending: true }));
        }
        if (!state.rows.length && error) {
            console.error('No se pudo cargar el estadístico por aerolínea:', error);
            renderEmpty('No hay una fuente de detalle por aerolínea disponible. Carga o conecta el Parte de Operaciones para generar este desglose.');
            return;
        }
        if (!state.rows.length) state.rows = data || [];
        buildYearOptions();
        selectAvailableMonths();
        buildMonths();
        render();
    }

    async function loadHistoricalAirlineStats(client) {
        const fields = 'year,month,airline_code,airline_name,arrivals_passengers,departures_passengers,arrivals_operations,departures_operations,total_passengers,total_operations';
        const rows = [];
        const batchSize = 1000;
        try {
            for (let from = 0; ; from += batchSize) {
                const { data, error } = await client.from('airline_monthly_statistics').select(fields).range(from, from + batchSize - 1);
                if (error) throw error;
                rows.push(...(data || []));
                if (!data || data.length < batchSize) break;
            }
        } catch (error) {
            // La migracion se instala por separado. El desglose reciente sigue
            // funcionando mientras se incorpora el historico oficial.
            console.info('Historico consolidado por aerolinea no disponible.', error.message);
            return [];
        }
        return rows.filter(row => HISTORICAL_YEARS.includes(String(row.year)) && Number(row.month) >= 1 && Number(row.month) <= 12)
            .map(row => ({
                fecha: `${row.year}-${String(row.month).padStart(2, '0')}-01`,
                aerolinea: row.airline_code || row.airline_name || 'Sin especificar',
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
                const { data, error } = await client.from('itinerario_vuelos_editable').select(fields).range(from, from + batchSize - 1);
                if (error) throw error;
                batches.push(...(data || []));
                if (!data || data.length < batchSize) break;
            }
        } catch (error) {
            console.info('Itinerario editable no disponible para estadístico por aerolínea.', error.message);
            return [];
        }
        return batches.flatMap(row => {
            // arr/dep_scheduled_date conserva el año del archivo histórico.
            // El valor visual SIBT/SOBT solo trae día y mes (p. ej. 01JAN 10:00).
            const arrivals = normalizeDate(row.arr_scheduled_date, row.import_reference_date) || normalizeDate(row['[Arr] SIBT'], row.import_reference_date);
            const departures = normalizeDate(row.dep_scheduled_date, row.import_reference_date) || normalizeDate(row['[Dep] SOBT'], row.import_reference_date);
            const result = [];
            if (arrivals) result.push({ fecha: arrivals, aerolinea: row['[Arr] Airline code'] || row['[Dep] Airline code'], pasajeros: row['[Arr] Boarded'], tipo_operacion: 'Llegada' });
            if (departures) result.push({ fecha: departures, aerolinea: row['[Dep] Airline code'] || row['[Arr] Airline code'], pasajeros: row['[Dep] Boarded'], tipo_operacion: 'Salida' });
            return result;
        });
    }

    function normalizeDate(value, referenceDate) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (iso) return iso[1];
        const dmy = raw.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        const monthMap = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
        const opsDate = raw.toUpperCase().match(/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
        const referenceYear = String(referenceDate || '').match(/^(20\d{2})-/)?.[1];
        if (opsDate && referenceYear) return `${referenceYear}-${monthMap[opsDate[2]]}-${opsDate[1].padStart(2, '0')}`;
        // No usar Date() para valores sin año: JavaScript los convierte a 2001.
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) || date.getFullYear() < 2020 ? '' : date.toISOString().slice(0, 10);
    }

    function buildYearOptions() {
        const select = document.getElementById('airline-stats-year');
        if (!select) return;
        // Solo se muestran ejercicios que realmente cuentan con detalle.
        const years = [...new Set(state.rows.map(row => String(row.fecha || '').slice(0, 4)))]
            .filter(year => HISTORICAL_YEARS.includes(year))
            .sort((a, b) => Number(b) - Number(a));
        state.year = years.includes(String(new Date().getFullYear())) ? String(new Date().getFullYear()) : (years[0] || null);
        select.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('') || '<option value="">Sin datos</option>';
        select.value = state.year || '';
        select.onchange = () => { state.year = select.value; selectAvailableMonths(); buildMonths(); render(); };
        const metric = document.getElementById('airline-stats-metric');
        if (metric) metric.onchange = () => { state.metric = metric.value; render(); };
        document.getElementById('airline-stats-export')?.addEventListener('click', exportCsv);
    }

    function selectAvailableMonths() {
        const available = state.rows
            .filter(row => String(row.fecha || '').slice(0, 4) === state.year)
            .map(row => monthOf(row.fecha))
            .filter(Boolean);
        const lastLoadedMonth = available.length ? Math.max(...available) : 0;
        // Al abrir o cambiar de año se toman todos los meses desde enero hasta
        // el último mes que tiene información; los posteriores quedan libres.
        state.months = new Set(Array.from({ length: lastLoadedMonth }, (_, index) => index + 1));
    }

    function buildMonths() {
        const container = document.getElementById('airline-stats-months');
        if (!container) return;
        const available = new Set(state.rows
            .filter(row => String(row.fecha || '').slice(0, 4) === state.year)
            .map(row => monthOf(row.fecha))
            .filter(Boolean));
        const lastLoadedMonth = available.size ? Math.max(...available) : 0;
        container.innerHTML = MONTHS.map((label, index) => {
            const month = index + 1;
            const enabled = month <= lastLoadedMonth;
            return `<button type="button" class="btn btn-xs btn-outline-primary airline-stats-month${state.months.has(month) ? ' active' : ''}" data-month="${month}"${enabled ? '' : ' disabled'}>${label}</button>`;
        }).join('');
        container.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
            const month = Number(button.dataset.month);
            state.months.has(month) ? state.months.delete(month) : state.months.add(month);
            button.classList.toggle('active', state.months.has(month));
            render();
        }));
    }

    function aggregate() {
        const result = new Map();
        state.rows.forEach(row => {
            if (String(row.fecha || '').slice(0, 4) !== state.year) return;
            const month = monthOf(row.fecha);
            if (!month || !state.months.has(month)) return;
            const airline = String(row.aerolinea || 'Sin especificar').trim() || 'Sin especificar';
            if (!result.has(airline)) result.set(airline, { airline, arrivals: 0, departures: 0, undivided: 0, total: 0, arrivalOps: 0, departureOps: 0, undividedOps: 0, operations: 0 });
            const item = result.get(airline);
            const direction = String(row.tipo_operacion || '').toLowerCase();
            const hasUndivided = row.pasajeros_total !== null && row.pasajeros_total !== undefined && num(row.pasajeros_total) > 0;
            const isWide = row.pasajeros_llegada !== null && row.pasajeros_llegada !== undefined || row.pasajeros_salida !== null && row.pasajeros_salida !== undefined;
            if (hasUndivided) {
                item.undivided += num(row.pasajeros_total);
                item.undividedOps += row.operaciones_total !== null && row.operaciones_total !== undefined ? num(row.operaciones_total) : 0;
            } else if (isWide) {
                const arrival = num(row.pasajeros_llegada);
                const departure = num(row.pasajeros_salida);
                item.arrivals += arrival;
                item.departures += departure;
                const arrivalOps = row.operaciones_llegada !== null && row.operaciones_llegada !== undefined ? num(row.operaciones_llegada) : (arrival ? 1 : 0);
                const departureOps = row.operaciones_salida !== null && row.operaciones_salida !== undefined ? num(row.operaciones_salida) : (departure ? 1 : 0);
                item.arrivalOps += arrivalOps;
                item.departureOps += departureOps;
            } else {
                const value = num(row.pasajeros);
                if (direction.includes('lleg')) { item.arrivals += value; item.arrivalOps += 1; }
                else { item.departures += value; item.departureOps += 1; }
            }
        });
        return [...result.values()].map(item => {
            item.total = item.arrivals + item.departures + item.undivided;
            item.operations = item.arrivalOps + item.departureOps + item.undividedOps;
            return item;
        }).filter(item => state.metric === 'pasajeros' ? item.total > 0 : item.operations > 0)
            .sort((a, b) => (state.metric === 'pasajeros' ? b.total - a.total : b.operations - a.operations));
    }

    function render() {
        state.totals = aggregate();
        const empty = document.getElementById('airline-stats-empty');
        const table = document.getElementById('airline-stats-table');
        if (!state.totals.length) {
            if (empty) empty.classList.remove('d-none');
            if (table) table.classList.add('d-none');
            document.getElementById('airline-stats-summary').innerHTML = '';
            destroyChart();
            return;
        }
        empty?.classList.add('d-none');
        table?.classList.remove('d-none');
        renderSummary();
        renderChart();
        renderTable();
    }

    function renderSummary() {
        const valueKey = state.metric === 'pasajeros' ? 'total' : 'operations';
        const total = state.totals.reduce((sum, item) => sum + item[valueKey], 0);
        const top = state.totals[0];
        document.getElementById('airline-stats-summary').innerHTML = `
            <div class="airline-stat-card"><span>Total ${state.metric} · ${state.months.size} mes${state.months.size === 1 ? '' : 'es'}</span><strong>${fmt.format(total)}</strong></div>
            <div class="airline-stat-card"><span>Aerolíneas activas</span><strong>${fmt.format(state.totals.length)}</strong></div>
            <div class="airline-stat-card"><span>Mayor participación</span><strong title="${escapeHtml(top.airline)}">${escapeHtml(top.airline)}</strong><small>${total ? ((top[valueKey] / total) * 100).toFixed(1) : '0.0'}%</small></div>`;
    }

    function destroyChart() { if (state.chart) { state.chart.destroy(); state.chart = null; } }
    function renderChart() {
        const canvas = document.getElementById('airline-stats-chart');
        if (!canvas || !window.Chart) return;
        destroyChart();
        // La tabla contiene el universo completo; la gráfica se limita a las
        // ocho participaciones principales para mantener etiquetas legibles.
        const values = state.totals.slice(0, 8);
        const key = state.metric === 'pasajeros' ? 'total' : 'operations';
        state.chart = new Chart(canvas, {
            type: 'bar',
            data: { labels: values.map(item => item.airline), datasets: [{ label: state.metric === 'pasajeros' ? 'Pasajeros' : 'Operaciones', data: values.map(item => item[key]), backgroundColor: values.map((_, index) => PALETTE[index % PALETTE.length]), borderRadius: 6, borderSkipped: false }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', layout: { padding: { left: 10, right: 18 } }, plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { callbacks: { label: context => ` ${fmt.format(context.raw || 0)} ${state.metric}` } } }, scales: { x: { beginAtZero: true, ticks: { callback: value => Number(value) >= 1000 ? `${Math.round(Number(value) / 1000)}k` : value } }, y: { ticks: { font: { size: 12 }, autoSkip: false } } } }
        });
    }

    function renderTable() {
        const key = state.metric === 'pasajeros' ? 'total' : 'operations';
        const sum = state.totals.reduce((total, item) => total + item[key], 0);
        const thead = document.querySelector('#airline-stats-table thead');
        const tbody = document.querySelector('#airline-stats-table tbody');
        if (!thead || !tbody) return;
        const consolidated = state.metric === 'pasajeros'
            ? state.totals.some(item => item.undivided > 0)
            : state.totals.some(item => item.undividedOps > 0);
        if (consolidated) {
            const label = state.metric === 'pasajeros' ? 'Pasajeros' : 'Operaciones';
            thead.innerHTML = `<tr><th>#</th><th>Aerolínea</th><th class="text-end">${label}</th><th class="text-end">Participación</th></tr>`;
            tbody.innerHTML = state.totals.map((item, index) => `<tr><td class="text-center">${index + 1}</td><td class="fw-semibold">${escapeHtml(item.airline)}</td><td class="text-end fw-bold">${fmt.format(item[key])}</td><td class="text-end">${sum ? ((item[key] / sum) * 100).toFixed(2) : '0.00'}%</td></tr>`).join('')
                + `<tr class="table-light fw-bold"><td colspan="2">TOTAL</td><td class="text-end">${fmt.format(sum)}</td><td class="text-end">100%</td></tr>`;
            return;
        }
        const labels = state.metric === 'pasajeros' ? ['Llegadas', 'Salidas', 'Total'] : ['Ops. llegada', 'Ops. salida', 'Total'];
        thead.innerHTML = `<tr><th>#</th><th>Aerolínea</th><th class="text-end">${labels[0]}</th><th class="text-end">${labels[1]}</th><th class="text-end">${labels[2]}</th><th class="text-end">Participación</th></tr>`;
        tbody.innerHTML = state.totals.map((item, index) => {
            const arrival = state.metric === 'pasajeros' ? item.arrivals : item.arrivalOps;
            const departure = state.metric === 'pasajeros' ? item.departures : item.departureOps;
            return `<tr><td class="text-center">${index + 1}</td><td class="fw-semibold">${escapeHtml(item.airline)}</td><td class="text-end">${fmt.format(arrival)}</td><td class="text-end">${fmt.format(departure)}</td><td class="text-end fw-bold">${fmt.format(item[key])}</td><td class="text-end">${sum ? ((item[key] / sum) * 100).toFixed(1) : '0.0'}%</td></tr>`;
        }).join('') + `<tr class="table-light fw-bold"><td colspan="2">TOTAL</td><td class="text-end">${fmt.format(state.totals.reduce((s, item) => s + (state.metric === 'pasajeros' ? item.arrivals : item.arrivalOps), 0))}</td><td class="text-end">${fmt.format(state.totals.reduce((s, item) => s + (state.metric === 'pasajeros' ? item.departures : item.departureOps), 0))}</td><td class="text-end">${fmt.format(sum)}</td><td class="text-end">100%</td></tr>`;
    }

    function exportCsv() {
        if (!state.totals.length) return;
        const key = state.metric === 'pasajeros' ? 'total' : 'operations';
        const consolidated = state.metric === 'pasajeros'
            ? state.totals.some(item => item.undivided > 0)
            : state.totals.some(item => item.undividedOps > 0);
        if (consolidated) {
            const sum = state.totals.reduce((total, item) => total + item[key], 0);
            const rows = [['Aerolínea', state.metric === 'pasajeros' ? 'Pasajeros' : 'Operaciones', 'Participación'], ...state.totals.map(item => [item.airline, item[key], `${sum ? ((item[key] / sum) * 100).toFixed(2) : '0.00'}%`])];
            const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
            link.download = `estadistico_aerolineas_${state.year || 'periodo'}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
            return;
        }
        const heading = state.metric === 'pasajeros' ? ['Aerolínea', 'Llegadas', 'Salidas', 'Total pasajeros'] : ['Aerolínea', 'Operaciones llegada', 'Operaciones salida', 'Total operaciones'];
        const csv = [heading, ...state.totals.map(item => [item.airline, state.metric === 'pasajeros' ? item.arrivals : item.arrivalOps, state.metric === 'pasajeros' ? item.departures : item.departureOps, item[key]])].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
        link.download = `estadistico_aerolineas_${state.year || 'periodo'}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function renderEmpty(message) { const empty = document.getElementById('airline-stats-empty'); if (empty) { empty.textContent = message; empty.classList.remove('d-none'); } }
    document.addEventListener('DOMContentLoaded', () => document.getElementById('acc-airline-body')?.addEventListener('shown.bs.collapse', () => { if (!state.rows.length) load(); else state.chart?.resize(); }, { once: false }));
})();
