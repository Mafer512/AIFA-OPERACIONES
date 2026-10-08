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
    const NDW_CARD_DEFS = [
      { cat: 'comercial', metric: 'operaciones' }, { cat: 'comercial', metric: 'pasajeros' },
      { cat: 'carga', metric: 'operaciones' }, { cat: 'carga', metric: 'toneladas' },
      { cat: 'general', metric: 'operaciones' }, { cat: 'general', metric: 'pasajeros' }
    ];
    return { ndwRefreshOnEntry, ndwLoadCurrentManifestDay, ndwPreviousDay, ndwLoadDetalleAnio, ndwLoadTotales, ndwMonthBounds, ndwAvisosPeriodoHtml };`)(render, (s) => String(s));
}

const dia = (com, pax, car, ton, gen, paxGen) => ({
  comercial: { operaciones: com, pasajeros: pax }, carga: { operaciones: car, toneladas: ton }, general: { operaciones: gen, pasajeros: paxGen }
});

const pendientes = () => new Promise((resolve) => setTimeout(resolve, 0));

test('al entrar con sesión se refresca una vez y se sustituyen automáticamente las cifras guardadas', async () => {
  const fecha = '2026-10-06';
  document.body.innerHTML = `<div id="navdeck-weekly-banner"><input data-ndw-date value="${fecha}"></div>`;
  window._ndwCurrentManifestDays = { [fecha]: { status: 'ready', loadedAt: Date.now(), totals: dia(1, 1, 1, 1, 1, 1) } };
  let terminar;
  window.supabaseClient = { rpc: jest.fn(() => new Promise((resolve) => { terminar = resolve; })) };
  window.TotalesService = {
    invalidar: jest.fn(),
    getDetalleDiario: jest.fn(async () => new Map([[fecha, dia(10, 1150, 13, 317.57, 0, 0)]]))
  };
  const { ndwRefreshOnEntry } = cargarModulo();
  const entrada = ndwRefreshOnEntry('usuario-a');
  expect(ndwRefreshOnEntry('usuario-a')).toBe(entrada);
  expect(window.supabaseClient.rpc).toHaveBeenCalledTimes(1);
  expect(window.supabaseClient.rpc).toHaveBeenCalledWith('refrescar_informe_estadistico', { p_forzar: true });
  expect(window.TotalesService.getDetalleDiario).not.toHaveBeenCalled();
  terminar({ error: null });
  await entrada;
  expect(window.TotalesService.invalidar).toHaveBeenCalledTimes(1);
  expect(window.TotalesService.getDetalleDiario).toHaveBeenCalledWith(fecha, fecha, { forzar: true });
  expect(window._ndwCurrentManifestDays[fecha].totals.comercial.operaciones).toBe(10);
  expect(window.supabaseClient.rpc).toHaveBeenCalledTimes(1);
});

test('la actualización al entrar recibe el resultado después de 15 segundos y respeta la fecha elegida mientras espera', async () => {
  jest.useFakeTimers();
  try {
    document.body.innerHTML = '<div id="navdeck-weekly-banner"><input data-ndw-date value="2026-10-06"></div>';
    let terminar;
    window.supabaseClient = { rpc: jest.fn(() => new Promise((resolve) => { terminar = resolve; })) };
    window.TotalesService = { getDetalleDiario: jest.fn(async () => new Map()) };
    const entrada = cargarModulo().ndwRefreshOnEntry('usuario-a');
    await jest.advanceTimersByTimeAsync(20000);
    document.querySelector('[data-ndw-date]').value = '2026-10-05';
    terminar({ error: null });
    await entrada;
    expect(window.TotalesService.getDetalleDiario).toHaveBeenCalledWith('2026-10-05', '2026-10-05', { forzar: true });
  } finally { jest.useRealTimers(); }
});

test('un refresco que termina después de cerrar sesión no vuelve a consultar las tarjetas', async () => {
  let terminar;
  window.supabaseClient = { rpc: jest.fn(() => new Promise((resolve) => { terminar = resolve; })) };
  window.TotalesService = { getDetalleDiario: jest.fn() };
  const entrada = cargarModulo().ndwRefreshOnEntry('usuario-a');
  window._ndwEntryRefresh = null;
  terminar({ error: null });
  await entrada;
  expect(window.TotalesService.getDetalleDiario).not.toHaveBeenCalled();
});

test('la entrada autenticada actualiza también cuando el primer intento de lectura falló', async () => {
  const fecha = '2026-10-06';
  document.body.innerHTML = `<div id="navdeck-weekly-banner"><input data-ndw-date value="${fecha}"></div>`;
  window._ndwCurrentManifestDays = { [fecha]: { status: 'error' } };
  window.supabaseClient = { rpc: jest.fn(async () => ({ error: null })) };
  window.TotalesService = { getDetalleDiario: jest.fn(async () => new Map()) };
  await cargarModulo().ndwRefreshOnEntry('usuario-a');
  expect(window._ndwCurrentManifestDays[fecha]).toMatchObject({ status: 'ready', refreshing: false, count: 0 });
});

test.each([
  ['2026-10-07T17:00:00-06:00', '2026-10-06'],
  ['2026-10-07T02:00:00Z', '2026-10-05'],
  ['2026-01-01T00:01:00-06:00', '2025-12-31'],
  ['2024-03-01T00:01:00-06:00', '2024-02-29']
])('ayer se calcula en México: %s → %s', (ahora, esperado) => {
  expect(cargarModulo().ndwPreviousDay(new Date(ahora))).toBe(esperado);
});

test('pinta antes del refresco lento y sustituye las cifras cuando termina', async () => {
  let terminar;
  window.supabaseClient = { rpc: jest.fn(() => new Promise((resolve) => { terminar = resolve; })) };
  const fecha = '2026-10-06';
  const inicial = dia(10, 1150, 13, 317.57, 0, 0);
  const nuevo = dia(11, 1200, 13, 317.57, 0, 0);
  window.TotalesService = { getDetalleDiario: jest.fn()
    .mockResolvedValueOnce(new Map([[fecha, inicial]]))
    .mockResolvedValueOnce(new Map([[fecha, nuevo]])) };
  const render = jest.fn();
  await cargarModulo(render).ndwLoadCurrentManifestDay(fecha);
  expect(render).toHaveBeenCalled();
  expect(window._ndwCurrentManifestDays[fecha].totals).toEqual(inicial);
  terminar({ error: null });
  await pendientes();
  expect(window._ndwCurrentManifestDays[fecha].totals).toEqual(nuevo);
  expect(window.TotalesService.getDetalleDiario).toHaveBeenLastCalledWith(fecha, fecha, { forzar: true });
});

test('una recarga recupera la fecha guardada inmediatamente y la verifica en segundo plano', async () => {
  sessionStorage.setItem('currentUser', 'usuario-a');
  const fecha = '2026-10-06';
  const valores = dia(10, 1150, 13, 317.57, 0, 0);
  window.supabaseClient = { rpc: jest.fn(async () => ({ error: { code: 'PGRST202' } })) };
  window.TotalesService = { getDetalleDiario: jest.fn(async () => new Map([[fecha, valores]])) };
  const { ndwLoadCurrentManifestDay } = cargarModulo();
  await ndwLoadCurrentManifestDay(fecha);
  await pendientes();
  delete window._ndwCurrentManifestDays;
  let terminar;
  window.TotalesService.getDetalleDiario.mockImplementation(() => new Promise((resolve) => { terminar = resolve; }));
  const consulta = ndwLoadCurrentManifestDay(fecha);
  expect(window._ndwCurrentManifestDays[fecha]).toMatchObject({ status: 'ready', totals: valores, refreshing: true });
  terminar(new Map([[fecha, valores]]));
  await consulta;
  // Un usuario distinto no recibe la copia guardada del anterior.
  sessionStorage.setItem('currentUser', 'usuario-b');
  delete window._ndwCurrentManifestDays;
  const otra = ndwLoadCurrentManifestDay(fecha);
  expect(window._ndwCurrentManifestDays[fecha].status).toBe('loading');
  terminar(new Map());
  await otra;
});

test('las búsquedas simultáneas comparten consulta por fecha y no cruzan resultados', async () => {
  const respuestas = {};
  window.supabaseClient = { rpc: jest.fn(async () => ({ error: { code: 'PGRST202' } })) };
  window.TotalesService = { getDetalleDiario: jest.fn((fecha) => new Promise((resolve) => { respuestas[fecha] = resolve; })) };
  const { ndwLoadCurrentManifestDay } = cargarModulo();
  const primera = ndwLoadCurrentManifestDay('2026-10-05');
  const segunda = ndwLoadCurrentManifestDay('2026-10-06');
  await ndwLoadCurrentManifestDay('2026-10-06');
  expect(window.TotalesService.getDetalleDiario).toHaveBeenCalledTimes(2);
  respuestas['2026-10-06'](new Map([['2026-10-06', dia(6, 60, 6, 6, 6, 6)]]));
  await segunda;
  respuestas['2026-10-05'](new Map([['2026-10-05', dia(5, 50, 5, 5, 5, 5)]]));
  await primera;
  expect(window._ndwCurrentManifestDays['2026-10-06'].totals.comercial.operaciones).toBe(6);
  expect(window._ndwCurrentManifestDays['2026-10-05'].totals.comercial.operaciones).toBe(5);
  await pendientes();
  expect(window.supabaseClient.rpc).toHaveBeenCalledTimes(1);
});

test('actualizar conserva las cifras visibles y avisa si la red falla', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    window.supabaseClient = { rpc: jest.fn(async () => ({ error: { code: 'PGRST202' } })) };
    const fecha = '2026-10-06';
    window.TotalesService = { getDetalleDiario: jest.fn(async () => new Map([[fecha, dia(10, 100, 1, 2, 3, 4)]])) };
    const { ndwLoadCurrentManifestDay } = cargarModulo();
    await ndwLoadCurrentManifestDay(fecha);
    await pendientes();
    let fallar;
    window.TotalesService.getDetalleDiario.mockImplementation(() => new Promise((_, reject) => { fallar = reject; }));
    const refresh = ndwLoadCurrentManifestDay(fecha, true);
    expect(window._ndwCurrentManifestDays[fecha].totals.comercial.operaciones).toBe(10);
    fallar(new Error('Sin red'));
    await refresh;
    expect(window._ndwCurrentManifestDays[fecha]).toMatchObject({ status: 'ready', refreshError: true, refreshing: false });
  } finally { warning.mockRestore(); }
});

afterEach(() => {
  delete window.supabaseClient;
  delete window.TotalesService;
  delete window._ndwCurrentManifestDays;
  delete window._ndwDetalle;
  delete window._ndwTotales;
  delete window.ManifiestosAvisos;
  delete window._ndwSummaryRefresh;
  delete window._ndwEntryRefresh;
  document.body.innerHTML = '';
  sessionStorage.clear();
});

test('el Día sale del detalle por FECHA, con las tres aviaciones, y no lee las vistas viejas', async () => {
  window.supabaseClient = { rpc: jest.fn(async () => ({ error: { code: 'PGRST202' } })), from: jest.fn() };
  const getDetalleDiario = jest.fn(async () => new Map([['2026-09-15', dia(1000, 2000, 1, 3.5, 7, 12)]]));
  window.TotalesService = { getDetalleDiario };
  const { ndwLoadCurrentManifestDay } = cargarModulo();
  await ndwLoadCurrentManifestDay('2026-09-15');
  expect(window.supabaseClient.rpc).toHaveBeenCalledWith('refrescar_informe_estadistico', { p_forzar: false });
  expect(getDetalleDiario).toHaveBeenCalledWith('2026-09-15', '2026-09-15', { forzar: false });
  expect(window.supabaseClient.from).not.toHaveBeenCalled();
  expect(window._ndwCurrentManifestDays['2026-09-15']).toMatchObject({
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
    window.supabaseClient = { rpc: jest.fn(async () => ({ error: { code: 'PGRST202' } })) };
    const respuestas = [Promise.reject(new Error('Sin conexión')), Promise.resolve(new Map())];
    window.TotalesService = { getDetalleDiario: jest.fn(() => respuestas.shift()) };
    const render = jest.fn();
    const { ndwLoadCurrentManifestDay } = cargarModulo(render);
    await ndwLoadCurrentManifestDay('2026-09-15');
    expect(window._ndwCurrentManifestDays['2026-09-15']).toMatchObject({ status: 'error' });
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
