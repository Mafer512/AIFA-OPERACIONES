/**
 * @jest-environment jsdom
 *
 * Informe Estadístico y Resumen Estadístico: la sección de AVIACIÓN GENERAL
 * sale del directorio de la Gerencia de Aviación General
 * (aviacion_general_operaciones), la misma fuente del tablero FBO, vía
 * aviacion_general_resumen() — migración 046. Si la función no está o falla,
 * el informe se queda con la cifra mensual de monthly_operations.
 */

const fs = require('fs');
const path = require('path');

const Core = require('../js/estadistico-informe-core');

const uiSource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'estadistico-informe.js'), 'utf8');

describe('núcleo: Aviación General desde el directorio', () => {
  function agregadoBase() {
    const resumen = [
      { anio: 2025, mes: 1, tipo_aviacion: 'comercial', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 10, pax_total: 1000, carga_kg_total: 0 },
    ];
    const mensual = [
      { year: 2025, month: 1, general_ops: 2, general_pax: 6 },
      { year: 2025, month: 2, general_ops: 7, general_pax: 21 },
    ];
    return Core.mergeOficiales(Core.aggregateResumen(resumen), mensual, []);
  }

  test('reemplaza General mes por mes y rehace el total del año; Comercial no se toca', () => {
    const agregado = agregadoBase();
    const aplicado = Core.aplicarAviacionGeneral(agregado, [
      { periodo: '2025-01', anio: 2025, mes: 1, movimientos: 40, pax: 120 },
      { periodo: '2024-12', anio: 2024, mes: 12, movimientos: 10, pax: 30 },
    ]);
    expect(aplicado).toBe(true);
    expect(agregado.porAnioMes.get('2025-1').general.ops).toBe(40);
    expect(agregado.porAnioMes.get('2025-1').general.pax).toBe(120);
    // Febrero no tiene movimientos en el directorio: vale cero, no la cifra vieja.
    expect(agregado.porAnioMes.get('2025-2').general.ops).toBe(0);
    expect(agregado.porAnioMes.get('2024-12').general.ops).toBe(10);
    expect(agregado.porAnio.get(2025).general.ops).toBe(40);
    expect(agregado.porAnio.get(2024).general.pax).toBe(30);
    expect(agregado.porAnioMes.get('2025-1').comercial.ops).toBe(10);
    expect(agregado.anios).toEqual([2024, 2025]);
    const acumulado = Core.buildAcumulado(agregado);
    expect(acumulado.general.ops).toBe(50);
    expect(acumulado.totalOperaciones).toBe(60);
  });

  test('sin datos del directorio no cambia nada', () => {
    const agregado = agregadoBase();
    expect(Core.aplicarAviacionGeneral(agregado, [])).toBe(false);
    expect(Core.aplicarAviacionGeneral(agregado, null)).toBe(false);
    expect(agregado.porAnioMes.get('2025-2').general.ops).toBe(7);
  });

  test('el corte del día sale de los totales del directorio', () => {
    const dia = Core.contadorAviacionGeneral({ movimientos: 3, pax: 9, llegadas: 2, salidas: 1 });
    expect(dia).toMatchObject({ ops: 3, pax: 9, kg: 0, opsLlegada: 2, opsSalida: 1 });
    expect(Core.contadorAviacionGeneral(null)).toBeNull();
  });
});

describe('Informe Estadístico con el directorio de Aviación General', () => {
  const resumenRows = [
    { anio: 2025, mes: 1, tipo_aviacion: 'comercial', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 10, pax_total: 1000, carga_kg_total: 0 },
  ];
  const monthlyOpsRows = [{ year: 2025, month: 1, general_ops: 2, general_pax: 6 }];

  function makeQuery(data) {
    const promise = Promise.resolve({ data, error: null });
    const chain = {
      select: () => makeQuery(data), eq: () => makeQuery(data), gte: () => makeQuery(data),
      lte: () => makeQuery(data), range: () => makeQuery(data), order: () => makeQuery(data),
      limit: () => makeQuery(data), in: () => makeQuery(data),
      maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? (data[0] || null) : data, error: null }),
      then: (...args) => promise.then(...args),
      catch: (...args) => promise.catch(...args),
      finally: (...args) => promise.finally(...args),
    };
    return chain;
  }

  function stub(respuestaAg) {
    const fixtures = {
      v_informe_estadistico_resumen: resumenRows,
      v_informe_estadistico_aerolinea: [],
      monthly_operations: monthlyOpsRows,
      annual_operations: [],
      v_informe_manifiestos_normalizado: [],
      catalogo_aeropuertos: [],
      informe_estadistico_aprobaciones: [],
    };
    const llamadasAg = [];
    return {
      llamadasAg,
      from: jest.fn((tabla) => ({ select: () => makeQuery(fixtures[tabla] ?? []) })),
      rpc: jest.fn(async (nombre, params) => {
        if (nombre !== 'aviacion_general_resumen') return { data: null, error: null };
        llamadasAg.push(params.p_filtros);
        return respuestaAg(params.p_filtros);
      }),
    };
  }

  function domMarkup() {
    return `
      <button id="tab-conci-estadistica" class="active"></button>
      <select id="informe-est-anio"></select>
      <select id="informe-est-anio-comparar"></select>
      <div class="alert d-none" id="informe-est-error"></div>
      <div class="alert d-none" id="informe-est-alertas"></div>
      <div id="informe-est-root">
        <div id="informe-est-acumulado"></div>
        <div id="informe-est-dia"></div>
        <table id="informe-est-tabla-mensual"><thead></thead><tbody></tbody></table>
        <table id="informe-est-tabla-aerolinea"><thead></thead><tbody></tbody></table>
        <table id="informe-est-tabla-ocupacion"><thead></thead><tbody></tbody></table>
      </div>`;
  }

  // Cada montaje evalúa el módulo de nuevo en el MISMO documento: se arranca
  // sólo la instancia recién evaluada, como en estadistica-panel.test.js.
  async function montar(respuestaAg) {
    document.body.innerHTML = domMarkup();
    window.InformeEstadisticoCore = Core;
    window.sectionLevel = () => 'admin';
    const client = stub(respuestaAg);
    window.supabaseClient = client;
    const registrar = document.addEventListener.bind(document);
    const arranques = [];
    document.addEventListener = (tipo, fn, ...resto) => {
      if (tipo === 'DOMContentLoaded') { arranques.push(fn); return undefined; }
      return registrar(tipo, fn, ...resto);
    };
    try { window.eval(uiSource); } finally { document.addEventListener = registrar; }
    arranques.forEach((fn) => fn());
    for (let i = 0; i < 60; i += 1) {
      const dia = document.getElementById('informe-est-dia').textContent;
      if (dia && !dia.includes('Calculando')) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    return client;
  }

  afterEach(() => {
    delete window.supabaseClient;
    delete window.sectionLevel;
  });

  test('las cifras de General y el corte del día vienen del directorio', async () => {
    const client = await montar((filtros) => (filtros.fecha_desde
      ? { data: { totales: { movimientos: 3, pax: 9, llegadas: 2, salidas: 1 } }, error: null }
      : { data: { totales: { movimientos: 50 }, por_mes: [
        { periodo: '2025-01', anio: 2025, mes: 1, movimientos: 40, pax: 120 },
        { periodo: '2024-12', anio: 2024, mes: 12, movimientos: 10, pax: 30 },
      ] }, error: null }));

    // Todo el histórico, y el día de corte solo.
    expect(client.llamadasAg[0]).toEqual({});
    const dia = client.llamadasAg.find((f) => f.fecha_desde);
    expect(dia.fecha_desde).toBe(dia.fecha_hasta);

    const acumulado = document.getElementById('informe-est-acumulado').textContent;
    expect(acumulado).toContain('Comercial 10 · General 50');
    expect(acumulado).toContain('Comercial 1,000 · General 150');
    const tarjetaDia = document.getElementById('informe-est-dia').textContent;
    expect(tarjetaDia).toContain('General 3');
    expect(tarjetaDia).not.toContain('sin corte diario');
  });

  test('si la función del directorio no responde, General se queda con la tabla mensual', async () => {
    await montar(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    const acumulado = document.getElementById('informe-est-acumulado').textContent;
    expect(acumulado).toContain('Comercial 10 · General 2');
    expect(document.getElementById('informe-est-dia').textContent).toContain('sin corte diario');
  });
});
