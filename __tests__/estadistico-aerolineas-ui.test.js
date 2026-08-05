/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const Core = require('../js/estadistico-aerolineas-core');

const uiSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'estadistico-aerolineas.js'),
  'utf8'
);
const seedSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '012_seed_airline_monthly_statistics_2026.sql'),
  'utf8'
);

function officialRows() {
  return [...seedSql.matchAll(/\(2026,\s*(\d+),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*'Excel/g)]
    .map(match => ({
      year: 2026,
      month: Number(match[1]),
      airline_code: match[2],
      airline_name: null,
      arrivals_passengers: 0,
      departures_passengers: 0,
      arrivals_operations: 0,
      departures_operations: 0,
      total_passengers: Number(match[3]),
      total_operations: Number(match[4]),
    }));
}

function queryResult(data) {
  return {
    select: jest.fn(() => ({
      range: jest.fn(async () => ({ data, error: null })),
    })),
  };
}

async function waitForRender() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.querySelectorAll('#airline-stats-table tbody tr').length === 13) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('El Estadístico por Aerolínea no terminó de renderizar.');
}

describe('interfaz del Estadístico por Aerolínea', () => {
  let chartConfigs;
  let consoleError;

  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="acc-airline-body" class="show">
        <select id="airline-stats-year"></select>
        <select id="airline-stats-metric"></select>
        <div id="airline-stats-months"></div>
        <button id="airline-stats-export"></button>
        <div id="airline-stats-summary"></div>
        <div id="airline-stats-chart-canvas"><canvas id="airline-stats-chart"></canvas></div>
        <table id="airline-stats-table"><thead></thead><tbody></tbody></table>
        <div id="airline-stats-empty" class="d-none"></div>
      </div>`;

    chartConfigs = [];
    window.Chart = class ChartStub {
      constructor(_canvas, config) {
        this.config = config;
        chartConfigs.push(config);
      }
      destroy() {}
      resize() {}
    };
    window.AirlineStatsCore = Core;
    window.supabaseClient = {
      from: jest.fn(table => {
        if (table === 'airline_monthly_statistics') return queryResult(officialRows());
        if (table === 'itinerario_vuelos_editable') return queryResult([]);
        throw new Error(`Consulta inesperada a ${table}`);
      }),
    };
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    window.eval(uiSource);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await waitForRender();
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    delete window.Chart;
    delete window.AirlineStatsCore;
    delete window.supabaseClient;
  });

  test('tarjetas, gráfica y tabla muestran el mismo universo del Excel', () => {
    const summary = document.getElementById('airline-stats-summary').textContent;
    const tableRows = [...document.querySelectorAll('#airline-stats-table tbody tr:not(.airline-stats-total-row)')];
    const chart = chartConfigs.at(-1);

    expect(summary).toContain('4,324,002');
    expect(summary).toContain('7 meses con información');
    expect(summary).toContain('VIVA AEROBUS');
    expect(summary).toContain('72.78%');
    expect(tableRows).toHaveLength(12);
    expect(chart.data.labels).toHaveLength(12);
    expect(chart.data.labels).toEqual(tableRows.map(row => row.children[1].textContent.trim()));
    expect(chart.data.datasets[0].data).toEqual(
      tableRows.map(row => Number(row.children[2].textContent.replace(/,/g, '')))
    );
    const vivaIndex = chart.data.labels.indexOf('VIVA AEROBUS');
    expect(chart.data.datasets[0].backgroundColor[vivaIndex]).toBe('#16A34A');
    expect(document.querySelector('.airline-stat-card--top').style.getPropertyValue('--airline-color')).toBe('#16A34A');
  });

  test('años, indicadores y meses provienen de los datos disponibles', () => {
    expect([...document.querySelectorAll('#airline-stats-year option')].map(option => option.value)).toEqual(['2026']);
    expect([...document.querySelectorAll('#airline-stats-metric option')].map(option => option.value)).toEqual([
      'pasajeros', 'operaciones',
    ]);
    const monthButtons = [...document.querySelectorAll('.airline-stats-month')];
    expect(monthButtons).toHaveLength(12);
    expect(monthButtons.slice(0, 7).every(button => !button.disabled && button.classList.contains('active'))).toBe(true);
    expect(monthButtons.slice(7).every(button => button.disabled)).toBe(true);
  });

  test('cambiar indicador y meses actualiza todos los resultados sin duplicar filas', () => {
    const initialColors = Object.fromEntries(
      chartConfigs.at(-1).data.labels.map((airline, index) => [
        airline, chartConfigs.at(-1).data.datasets[0].backgroundColor[index],
      ])
    );
    const metric = document.getElementById('airline-stats-metric');
    metric.value = 'operaciones';
    metric.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(document.getElementById('airline-stats-summary').textContent).toContain('32,551');
    expect(document.querySelectorAll('#airline-stats-table tbody tr')).toHaveLength(13);
    expect(chartConfigs.at(-1).data.datasets[0].data[0]).toBe(19328);
    chartConfigs.at(-1).data.labels.forEach((airline, index) => {
      expect(chartConfigs.at(-1).data.datasets[0].backgroundColor[index]).toBe(initialColors[airline]);
    });

    document.querySelector('.airline-stats-month[data-month="7"]').click();
    expect(document.getElementById('airline-stats-summary').textContent).toContain('27,497');
    expect(document.getElementById('airline-stats-summary').textContent).toContain('6 meses con información');
    expect(document.querySelectorAll('#airline-stats-table tbody tr')).toHaveLength(13);
  });
});
