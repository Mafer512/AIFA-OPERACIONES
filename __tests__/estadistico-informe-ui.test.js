/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const Core = require('../js/estadistico-informe-core');

const uiSource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'estadistico-informe.js'), 'utf8');

const resumenRows = [
  { anio: 2024, mes: 12, tipo_aviacion: 'comercial', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 10, pax_total: 1000, carga_kg_total: 0 },
  { anio: 2024, mes: 12, tipo_aviacion: 'comercial', direccion: 'D', nacional_internacional: 'Internacional', operaciones: 5, pax_total: 600, carga_kg_total: 0 },
  { anio: 2025, mes: 1, tipo_aviacion: 'carga', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 4, pax_total: 0, carga_kg_total: 8000 },
  { anio: 2025, mes: 1, tipo_aviacion: 'carga', direccion: 'D', nacional_internacional: 'Internacional', operaciones: 2, pax_total: 0, carga_kg_total: 5000 },
];

const aerolineaRows = [
  { anio: 2025, mes: 1, aerolinea: 'VOLARIS', tipo_aviacion: 'comercial', direccion: 'A', operaciones: 6, pax_total: 600, carga_kg_total: 0 },
  { anio: 2025, mes: 1, aerolinea: 'VOLARIS', tipo_aviacion: 'comercial', direccion: 'D', operaciones: 6, pax_total: 590, carga_kg_total: 0 },
  { anio: 2025, mes: 2, aerolinea: 'VIVA AEROBUS', tipo_aviacion: 'comercial', direccion: 'A', operaciones: 20, pax_total: 2000, carga_kg_total: 0 },
  { anio: 2025, mes: 2, aerolinea: 'VIVA AEROBUS', tipo_aviacion: 'comercial', direccion: 'D', operaciones: 20, pax_total: 1980, carga_kg_total: 0 },
];

const monthlyOpsRows = [
  { year: 2024, month: 12, general_ops: 3, general_pax: 9 },
  { year: 2025, month: 1, general_ops: 2, general_pax: 6 },
];

const annualOpsRows = [
  { year: 2024, general_ops_total: 40, general_pax_total: 120 },
  { year: 2025, general_ops_total: 2, general_pax_total: 6 },
];

// Reutilizada para "cifras del día" y "factor de ocupación": ambas consultas
// caen sobre la misma tabla (v_informe_manifiestos_normalizado) con distintos
// filtros; el stub no filtra, así que una sola fixture cubre las dos.
// capacidad_matricula ya viene resuelta en la vista SQL (join por matricula_id).
const normalizadoRows = [
  { fecha_operacion: '2026-01-15', direccion: 'A', es_carga: false, pax_total: 150, carga_kg: 0, aerolinea: 'VOLARIS', endpoint_code: 'CUN', nacional_internacional: 'Nacional', capacidad_matricula: 180 },
  { fecha_operacion: '2026-01-15', direccion: 'D', es_carga: false, pax_total: 140, carga_kg: 0, aerolinea: 'VOLARIS', endpoint_code: 'CUN', nacional_internacional: 'Nacional', capacidad_matricula: 180 },
];

// `filtros` acumula los .eq() que se aplicaron, para poder comprobar que las
// consultas caras van acotadas del lado del servidor y no se traen todo.
function makeQuery(data, error = null, filtros = []) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const chain = {
    filtros,
    select: () => makeQuery(data, error, filtros),
    // Empuja sobre el MISMO arreglo que ve quien registró la consulta, para
    // que los .eq() encadenados después queden visibles ahí.
    eq: (columna, valor) => { filtros.push([columna, valor]); return makeQuery(data, error, filtros); },
    gte: () => makeQuery(data, error, filtros),
    lte: () => makeQuery(data, error, filtros),
    range: () => makeQuery(data, error, filtros),
    maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? (data[0] || null) : (data ?? null), error }),
    then: (...args) => promise.then(...args),
    catch: (...args) => promise.catch(...args),
    finally: (...args) => promise.finally(...args),
  };
  return chain;
}

function buildSupabaseStub() {
  const fixtures = {
    v_informe_estadistico_resumen: resumenRows,
    v_informe_estadistico_aerolinea: aerolineaRows,
    monthly_operations: monthlyOpsRows,
    annual_operations: annualOpsRows,
    v_informe_manifiestos_normalizado: normalizadoRows,
    catalogo_aeropuertos: [{ iata: 'CUN', ciudad: 'Cancún' }],
    informe_estadistico_aprobaciones: [],
    // Hora de los datos que sirve la vista materializada (migración 028).
    informe_estadistico_refresco: [{ refrescado_at: '2026-08-20T15:30:00.000Z' }],
  };
  const consultas = [];
  return {
    consultas,
    from: jest.fn(table => ({
      select: () => {
        const q = makeQuery(fixtures[table] ?? [], null);
        consultas.push({ table, query: q });
        return q;
      },
    })),
    rpc: jest.fn(async () => ({ data: null, error: null })),
  };
}

function domMarkup() {
  return `
    <button id="tab-conci-estadistica" class="active"></button>
    <select id="informe-est-anio"></select>
    <select id="informe-est-anio-comparar"></select>
    <span id="informe-est-visto-bueno-badge"></span>
    <span class="d-none" id="informe-est-cargando"></span>
    <span class="d-none" id="informe-est-frescura"></span>
    <button id="informe-est-btn-refresh"></button>
    <button id="informe-est-btn-excel"></button>
    <button id="informe-est-btn-csv"></button>
    <button id="informe-est-btn-visto-bueno" class="d-none"></button>
    <div class="alert d-none" id="informe-est-error"></div>
    <div class="alert d-none" id="informe-est-alertas"></div>
    <div id="informe-est-root">
      <div id="informe-est-acumulado"></div>
      <div id="informe-est-dia"></div>
      <div class="d-none" id="informe-est-proyeccion"></div>
      <canvas id="informe-est-chart-mensual"></canvas>
      <table id="informe-est-tabla-mensual"><thead></thead><tbody></tbody></table>
      <div class="d-none" id="informe-est-comparativa">
        <table id="informe-est-tabla-comparativa"><thead></thead><tbody></tbody></table>
      </div>
      <table id="informe-est-tabla-aerolinea"><thead></thead><tbody></tbody></table>
      <table id="informe-est-tabla-ocupacion"><thead></thead><tbody></tbody></table>
      <span id="informe-est-ocupacion-promedio"></span>
    </div>`;
}

async function waitForRender() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.querySelectorAll('#informe-est-tabla-aerolinea tbody tr').length >= 1) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('El Informe Estadístico no terminó de renderizar.');
}

let chartConfigs;

async function mount(role) {
  document.body.innerHTML = domMarkup();
  chartConfigs = [];
  window.InformeEstadisticoCore = Core;
  window.supabaseClient = buildSupabaseStub();
  window.sectionLevel = () => role;
  window.Chart = class ChartStub {
    constructor(_canvas, config) { this.config = config; chartConfigs.push(config); }
    destroy() {}
  };
  window.eval(uiSource);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await waitForRender();
}

describe('interfaz del Informe Estadístico', () => {
  describe('con rol de lectura', () => {
    let consoleError;

    beforeEach(async () => {
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      await mount('lector');
    });

    afterEach(() => {
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
      delete window.InformeEstadisticoCore;
      delete window.supabaseClient;
      delete window.sectionLevel;
      delete window.Chart;
    });

    test('el selector de año lista los años del agregado, año más reciente primero', () => {
      expect([...document.querySelectorAll('#informe-est-anio option')].map(o => o.value)).toEqual(['2025', '2024']);
    });

    test('la gráfica mensual recibe 12 meses con las 3 series de operaciones', () => {
      const chart = chartConfigs.at(-1);
      expect(chart.data.labels).toHaveLength(12);
      expect(chart.data.datasets.map(d => d.label)).toEqual(['Comercial', 'General', 'Carga']);
      expect(chart.data.datasets[2].data[0]).toBe(6); // Carga, Enero 2025
    });

    test('elegir un año para comparar muestra la tabla de comparativa año contra año', () => {
      const host = document.getElementById('informe-est-comparativa');
      expect(host.classList.contains('d-none')).toBe(true);

      const select = document.getElementById('informe-est-anio-comparar');
      select.value = '2024';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));

      expect(host.classList.contains('d-none')).toBe(false);
      const rows = [...document.querySelectorAll('#informe-est-tabla-comparativa tbody tr')];
      const cargaRow = rows.find(row => row.children[0].textContent.trim() === 'Operaciones Carga');
      expect(cargaRow.children[1].textContent.trim()).toBe('6');
      expect(cargaRow.children[2].textContent.trim()).toBe('0');
    });

    test('la alerta de días sin captura aparece cuando hay huecos en los últimos 15 días', () => {
      const banner = document.getElementById('informe-est-alertas');
      expect(banner.classList.contains('d-none')).toBe(false);
      expect(banner.textContent).toContain('sin ningún manifiesto capturado');
    });

    test('las tarjetas de acumulados suman Comercial + General y muestran Carga aparte', () => {
      // General sale de monthly_operations (3 en dic-2024 + 2 en ene-2025) y
      // Comercial/Carga de manifiestos, porque en esta fixture la tabla mensual
      // no trae columnas de esos dos tipos.
      const text = document.getElementById('informe-est-acumulado').textContent;
      expect(text).toContain('20');
      expect(text).toContain('1,615');
      expect(text).toContain('Comercial 15 · General 5');
      expect(text).toContain('Comercial 1,600 · General 15');
      expect(text).toContain('6');
      expect(text).toContain('13');
    });

    test('la tabla mensual del año seleccionado muestra General y Carga de enero 2025', () => {
      const rows = [...document.querySelectorAll('#informe-est-tabla-mensual tbody tr')];
      expect(rows).toHaveLength(2);
      const tipos = rows.map(row => row.children[1].textContent.trim());
      expect(tipos.sort()).toEqual(['carga', 'general']);
      const cargaRow = rows.find(row => row.children[1].textContent.trim() === 'carga');
      expect(cargaRow.children[4].textContent.trim()).toBe('6');
    });

    test('la tabla de participación por aerolínea ordena por operaciones descendente', () => {
      const rows = [...document.querySelectorAll('#informe-est-tabla-aerolinea tbody tr')];
      expect(rows.map(row => row.children[0].textContent.trim())).toEqual(['VIVA AEROBUS', 'VOLARIS']);
      expect(rows[0].children[2].textContent.trim()).toBe('40');
    });

    test('el factor de ocupación solo incluye matrículas con capacidad conocida', () => {
      const rows = [...document.querySelectorAll('#informe-est-tabla-ocupacion tbody tr')];
      expect(rows).toHaveLength(1);
      expect(rows[0].children[0].textContent.trim()).toBe('VOLARIS');
      expect(rows[0].children[1].textContent.trim()).toBe('CANCÚN');
    });

    // Regresión de rendimiento: la pestaña tardaba muchísimo en pintar porque
    // consultaba DOS veces v_informe_manifiestos_normalizado (cifras del día
    // por un lado, factor de ocupación por otro). Esa vista recorre toda
    // maestra_operaciones con joins laterales por renglón, así que la segunda
    // pasada duplicaba el trabajo del servidor para las mismas filas.
    test('la vista pesada de manifiestos se consulta una sola vez por carga', () => {
      const tablas = window.supabaseClient.from.mock.calls.map(([tabla]) => tabla);
      expect(tablas.filter(t => t === 'v_informe_manifiestos_normalizado')).toHaveLength(1);
    });

    // La otra mitad del mismo problema: v_informe_estadistico_aerolinea agrupa
    // por año/mes/aerolínea/tipo/dirección, así que sin filtro son varios miles
    // de renglones = ~7 páginas de PostgREST, cada una una consulta completa a
    // la vista. La tabla sólo usa el año seleccionado.
    test('la participación por aerolínea se pide acotada al año seleccionado', () => {
      const consulta = window.supabaseClient.consultas.find(c => c.table === 'v_informe_estadistico_aerolinea');
      expect(consulta).toBeDefined();
      expect(consulta.query.filtros).toEqual([['anio', 2025]]);
    });

    test('se muestra la hora de los datos que sirve la vista materializada', () => {
      const el = document.getElementById('informe-est-frescura');
      expect(el.classList.contains('d-none')).toBe(false);
      expect(el.textContent).toMatch(/^Datos al /);
    });

    test('"Actualizar" le pide al servidor recalcular antes de releer', async () => {
      window.supabaseClient.rpc.mockClear();
      document.getElementById('informe-est-btn-refresh').click();
      for (let i = 0; i < 40 && !window.supabaseClient.rpc.mock.calls.length; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(window.supabaseClient.rpc).toHaveBeenCalledWith('refrescar_informe_estadistico', { p_forzar: false });
    });

    test('sin visto bueno previo, la insignia muestra pendiente y el botón queda oculto', () => {
      expect(document.getElementById('informe-est-visto-bueno-badge').textContent).toContain('Pendiente de visto bueno');
      expect(document.getElementById('informe-est-btn-visto-bueno').classList.contains('d-none')).toBe(true);
    });
  });

  describe('con rol admin', () => {
    let consoleError;

    beforeEach(async () => {
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      await mount('admin');
    });

    afterEach(() => {
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
      delete window.InformeEstadisticoCore;
      delete window.supabaseClient;
      delete window.sectionLevel;
      delete window.Chart;
    });

    test('el botón de dar visto bueno solo se muestra para sectionLevel === "admin"', () => {
      expect(document.getElementById('informe-est-btn-visto-bueno').classList.contains('d-none')).toBe(false);
    });
  });
});
