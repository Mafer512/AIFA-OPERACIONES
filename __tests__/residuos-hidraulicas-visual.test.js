/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

describe('Residuos GOMIH · configuración visual de gráficas', () => {
    test('conserva los datos y aplica tema, formato y controles existentes', async () => {
        document.body.innerHTML = `
            <select id="residuos-year-select"></select>
            <select id="residuos-edit-month"></select>
            <div id="residuos-status"></div>
            <span id="residuos-kpi-especial"></span><span id="residuos-kpi-peligrosos"></span>
            <span id="residuos-kpi-valorizables"></span><span id="residuos-kpi-meses"></span>
            <table><tbody id="residuos-table-body"></tbody><tfoot id="residuos-table-foot"></tfoot></table>
            <canvas id="residuos-chart-mensual"></canvas><canvas id="residuos-chart-composicion"></canvas>
            <canvas id="residuos-chart-tendencia"></canvas>
            <input id="residuos-inorganicos"><input id="residuos-organicos"><input id="residuos-lodos">
            <input id="residuos-manejo-especial">
            <input id="residuos-peligrosos"><input id="residuos-valorizables"><input id="residuos-observaciones">
            <button id="residuos-refresh"></button><button id="residuos-export"></button>
            <button id="residuos-save"></button><button id="hidra-tabbtn-residuos"></button>
            <div id="residuos-capture-locked"></div><span id="residuos-edit-status"></span>`;

        const rows = [
            { anio: 2026, mes_num: 1, inorganicos_kg: 100.1, organicos_kg: 20.2, lodos_kg: 0.3, manejo_especial_kg: 5, peligrosos_kg: 1.25, valorizables_kg: 2.345 },
            { anio: 2026, mes_num: 2, inorganicos_kg: 200, organicos_kg: null, lodos_kg: null, manejo_especial_kg: null, peligrosos_kg: null, valorizables_kg: 10 },
            { anio: 2025, mes_num: 1, inorganicos_kg: 50, organicos_kg: 5, lodos_kg: 1, manejo_especial_kg: 4, peligrosos_kg: 2, valorizables_kg: 3 }
        ];
        const query = {
            select: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            then: resolve => Promise.resolve({ data: rows, error: null }).then(resolve)
        };
        window.supabaseClient = { from: jest.fn(() => query) };
        window.canCaptureSection = () => false;

        const chartInstances = [];
        class ChartMock {
            constructor(canvas, config) {
                this.canvas = canvas;
                this.config = config;
                this.destroy = jest.fn();
                chartInstances.push(this);
            }
        }
        ChartMock.register = jest.fn();
        ChartMock.defaults = {
            plugins: { legend: { labels: { generateLabels: chart => chart.data.labels.map((text, index) => ({ text, index })) } } }
        };
        window.Chart = ChartMock;
        window.ChartDataLabels = { id: 'datalabels' };

        const aoaToSheet = jest.fn(aoa => ({ aoa }));
        window.XLSX = {
            utils: { book_new: jest.fn(() => ({})), aoa_to_sheet: aoaToSheet, book_append_sheet: jest.fn() },
            writeFile: jest.fn()
        };

        const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'residuos-hidraulicas.js'), 'utf8');
        window.eval(source);
        await window.residuosHidraulicasModule.init();

        expect(chartInstances).toHaveLength(3);
        const [monthly, composition, trend] = chartInstances.map(instance => instance.config);
        expect(monthly.data.datasets.map(dataset => dataset.data)).toEqual([
            [125.6, 200],
            [1.25, null],
            [2.345, 10]
        ]);
        expect(trend.data.datasets[0].data).toEqual([129.195, 210]);
        expect(composition.data.datasets[0].data).toEqual([325.6, 1.25, 12.345]);

        expect(monthly.data.datasets.map(dataset => dataset.borderColor)).toEqual(['#169B62', '#E5484D', '#E9B000']);
        expect(composition.data.datasets[0].backgroundColor).toEqual(['#169B62', '#E5484D', '#E9B000']);
        expect(trend.data.datasets[0].borderColor).toBe('#2563EB');
        expect(trend.data.datasets[0].borderWidth).toBe(3);
        expect(monthly.options.scales.x.grid.display).toBe(false);
        expect(trend.options.scales.x.offset).toBe(true);
        expect(composition.options.cutout).toBe('56%');
        expect(composition.options.plugins.residuosDoughnutCenterText.label).toBe('Total generado');

        expect(monthly.options.plugins.datalabels.formatter(554921.0700000001)).toBe('554,921.07');
        expect(trend.options.plugins.datalabels.formatter(129.195)).toBe('129.2');
        const doughnutTooltip = composition.options.plugins.tooltip.callbacks.label({
            label: 'Valorizables', raw: 12.345, dataset: { data: composition.data.datasets[0].data }
        });
        expect(doughnutTooltip).toMatch(/^Valorizables: 12\.35 kg \([\d.]+ %\)$/);

        const year = document.getElementById('residuos-year-select');
        year.value = '2025';
        year.dispatchEvent(new Event('change'));
        expect(window.residuosHidraulicasModule.state.selectedYear).toBe(2025);
        expect(chartInstances.slice(-3).map(instance => instance.config.type)).toEqual(['bar', 'doughnut', 'line']);

        year.value = '2026';
        year.dispatchEvent(new Event('change'));
        document.getElementById('residuos-refresh').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(window.supabaseClient.from).toHaveBeenCalledTimes(2);

        document.getElementById('residuos-export').click();
        expect(window.XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), 'Residuos_GOMIH_2026.xlsx');
        expect(aoaToSheet.mock.calls[0][0][3]).toEqual([2026, 'Enero', 100.1, 20.2, 0.3, 5, 1.25, 2.345]);
    });
});
