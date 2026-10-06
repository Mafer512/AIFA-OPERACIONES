/** @jest-environment jsdom */
// Inicio: Día y Semana salen del DETALLE (TotalesService.getDetalleDiario →
// totales_detalle_por_dia, migración 062b); Mes, Año e Histórico de la capa
// unificada (TotalesService.historiaMensual). Ninguno lee las tablas viejas.
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.resolve(__dirname, '../script.js'), 'utf8').replace(/\r\n/g, '\n');
const segmento = source.slice(source.indexOf('const NDW_DETALLE_AYUDA'), source.indexOf('function renderNavdeckWeeklyBanner('));

function cargarModulo(render = jest.fn()) {
  return new Function('renderNavdeckWeeklyBanner', 'escapeHTML', `${segmento};
    return { ndwLoadCurrentManifestDay, ndwLoadDetalleAnio, ndwLoadTotales, ndwMonthBounds, ndwAvisosPeriodoHtml };`)(render, (s) => String(s));
}

const dia = (com, pax, car, ton, gen, paxGen) => ({
  comercial: { operaciones: com, pasajeros: pax }, carga: { operaciones: car, toneladas: ton }, general: { operaciones: gen, pasajeros: paxGen }
});

afterEach(() => {
  delete window.supabaseClient;
  delete window.TotalesService;
  delete window._ndwCurrentManifestDays;
  delete window._ndwDetalle;
  delete window._ndwTotales;
  delete window.ManifiestosAvisos;
});

test('el Día sale del detalle por FECHA, con las tres aviaciones, y no lee las vistas viejas', async () => {
  window.supabaseClient = { rpc: jest.fn(async () => ({ error: null })), from: jest.fn() };
  const getDetalleDiario = jest.fn(async () => new Map([['2026-09-15', dia(1000, 2000, 1, 3.5, 7, 12)]]));
  window.TotalesService = { getDetalleDiario };
  const { ndwLoadCurrentManifestDay } = cargarModulo();
  await ndwLoadCurrentManifestDay('2026-09-15');
  expect(window.supabaseClient.rpc).toHaveBeenCalledWith('refrescar_informe_estadistico', { p_forzar: false });
  expect(getDetalleDiario).toHaveBeenCalledWith('2026-09-15', '2026-09-15', { forzar: false });
  expect(window.supabaseClient.from).not.toHaveBeenCalled();
  expect(window._ndwCurrentManifestDays['2026-09-15']).toEqual({
    status: 'ready', count: 1001, totals: dia(1000, 2000, 1, 3.5, 7, 12)
  });
  // Sin forzar no se vuelve a consultar; con "Actualizar cifras", sí.
  await ndwLoadCurrentManifestDay('2026-09-15');
  expect(getDetalleDiario).toHaveBeenCalledTimes(1);
  await ndwLoadCurrentManifestDay('2026-09-15', true);
  expect(getDetalleDiario).toHaveBeenLastCalledWith('2026-09-15', '2026-09-15', { forzar: true });
});

test('un día sin manifiestos es cero y funciona aunque falte el RPC de refresco', async () => {
  window.supabaseClient = { rpc: jest.fn(async () => ({ error: { code: 'PGRST202' } })) };
  window.TotalesService = { getDetalleDiario: jest.fn(async () => new Map()) };
  const { ndwLoadCurrentManifestDay } = cargarModulo();
  await ndwLoadCurrentManifestDay('2026-09-15');
  expect(window._ndwCurrentManifestDays['2026-09-15']).toMatchObject({ status: 'ready', count: 0 });
  expect(window._ndwCurrentManifestDays['2026-09-15'].totals.general).toEqual({ operaciones: 0, pasajeros: 0 });
});

test('una consulta fallida muestra error y permite reintentar sin reutilizar cifras', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    window.supabaseClient = { rpc: jest.fn(async () => ({ error: null })) };
    const respuestas = [Promise.reject(new Error('Sin conexión')), Promise.resolve(new Map())];
    window.TotalesService = { getDetalleDiario: jest.fn(() => respuestas.shift()) };
    const render = jest.fn();
    const { ndwLoadCurrentManifestDay } = cargarModulo(render);
    await ndwLoadCurrentManifestDay('2026-09-15');
    expect(window._ndwCurrentManifestDays['2026-09-15']).toEqual({ status: 'error' });
    await ndwLoadCurrentManifestDay('2026-09-15', true);
    expect(window._ndwCurrentManifestDays['2026-09-15'].status).toBe('ready');
    expect(render).toHaveBeenCalledTimes(2);
  } finally { warning.mockRestore(); }
});

test('la Semana pide el detalle del año una sola vez', async () => {
  const porFecha = new Map([['2025-12-02', dia(1, 1, 1, 1, 1, 1)]]);
  const getDetalleDiario = jest.fn(async () => porFecha);
  window.TotalesService = { getDetalleDiario };
  const render = jest.fn();
  const { ndwLoadDetalleAnio } = cargarModulo(render);
  await ndwLoadDetalleAnio(2025);
  await ndwLoadDetalleAnio(2025);
  expect(getDetalleDiario).toHaveBeenCalledTimes(1);
  expect(getDetalleDiario).toHaveBeenCalledWith('2025-01-01', '2025-12-31');
  expect(window._ndwDetalle['2025']).toEqual({ status: 'ready', porFecha });
  expect(render).toHaveBeenCalledTimes(1);
});

test('Mes, Año e Histórico guardan los meses de la capa con su fuente y la leyenda', async () => {
  const meses = [
    { clave: '2026-08', anio: 2026, mes: 8, desde: '2026-08-01', hasta: '2026-08-31', fuente: 'oficial',
      fuentes: { comercial: 'oficial', carga: 'oficial', general: 'oficial' }, ...dia(5147, 730001, 1196, 38197.59, 201, 505) },
    { clave: '2026-09', anio: 2026, mes: 9, desde: '2026-09-01', hasta: '2026-09-30', fuente: 'detalle',
      fuentes: { comercial: 'detalle', carga: 'detalle', general: 'detalle' }, ...dia(10, 100, 2, 3.25, 1, 2) }
  ];
  window.TotalesService = {
    historiaMensual: jest.fn(async () => meses),
    getCorteOficial: jest.fn(async () => '2026-08-31'),
    leyendaFuente: (c) => `Cifras oficiales hasta ${c}`
  };
  const { ndwLoadTotales } = cargarModulo();
  await ndwLoadTotales();
  const t = window._ndwTotales;
  expect(t.status).toBe('ready');
  expect(t.leyenda).toBe('Cifras oficiales hasta 2026-08-31');
  expect(t.porMes.get('2026-08')).toMatchObject({ fuente: 'oficial', lastDate: null, comercial: { operaciones: 5147 } });
  expect(t.porMes.get('2026-09').fuente).toBe('detalle');
  expect(t.porMes.get('2026-09').lastDate).not.toBeNull();
});

test('los avisos de periodo se pintan discretos sólo si el periodo los toca', () => {
  const { ndwAvisosPeriodoHtml } = cargarModulo();
  expect(ndwAvisosPeriodoHtml('2026-03-01', '2026-03-31')).toBe('');
  const avisos = [{ clave: 'carga_2026_ene_ago', texto: 'Carga ene–ago 2026 incompleta', desde: '2026-01-01', hasta: '2026-08-31', ambitos: ['inicio', 'estadistica'], activo: true }];
  const api = require('../js/manifiestos-avisos.js');
  window.ManifiestosAvisos = { para: (ambito, d, h) => api.filtrar(avisos, ambito, d, h) };
  expect(ndwAvisosPeriodoHtml('2026-03-01', '2026-03-31')).toContain('ndw-aviso-periodo');
  expect(ndwAvisosPeriodoHtml('2026-09-01', '2026-09-30')).toBe('');
});
