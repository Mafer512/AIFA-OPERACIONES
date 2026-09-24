/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.resolve(__dirname, '../script.js'), 'utf8');
const loaderSource = source.slice(source.indexOf('async function ndwLoadCurrentManifestDay('), source.indexOf('function renderNavdeckWeeklyBanner('));

function fixture(pages, refreshError = null) {
  window._ndwCurrentManifestDays = {};
  const query = {};
  for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
  query.range = jest.fn(async () => pages.shift());
  window.supabaseClient = { from: jest.fn(() => query), rpc: jest.fn(async () => ({ error: refreshError })) };
  const render = jest.fn();
  const load = new Function('renderNavdeckWeeklyBanner', `${loaderSource}; return ndwLoadCurrentManifestDay;`)(render);
  return { load, query, render };
}

test('consulta solo capturados del día exacto, pagina y convierte kilogramos a toneladas', async () => {
  const { load, query } = fixture([
    { data: Array.from({ length: 1000 }, () => ({ es_carga: false, pax_total: 2 })) },
    { data: [{ es_carga: true, carga_kg: 3500 }] }
  ]);
  await load('2026-09-15');
  expect(query.eq.mock.calls).toContainEqual(['fecha_operacion', '2026-09-15']);
  expect(query.eq.mock.calls).toContainEqual(['capturado', true]);
  expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  expect(window._ndwCurrentManifestDays['2026-09-15'].totals).toEqual({
    comercial: { operaciones: 1000, pasajeros: 2000 }, carga: { operaciones: 1, toneladas: 3.5 }
  });
  await load('2026-09-15');
  expect(query.range).toHaveBeenCalledTimes(2);
});

test('un día vacío es cero y funciona con la vista en vivo anterior a la migración 028', async () => {
  const { load } = fixture([{ data: [] }], { code: 'PGRST202' });
  await load('2026-09-15');
  expect(window._ndwCurrentManifestDays['2026-09-15']).toMatchObject({ status: 'ready', count: 0 });
});

test('una consulta fallida muestra error y permite reintentar sin reutilizar cifras', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { load, render } = fixture([{ error: { message: 'Sin conexión' } }, { data: [] }]);
    await load('2026-09-15');
    expect(window._ndwCurrentManifestDays['2026-09-15']).toEqual({ status: 'error' });
    await load('2026-09-15', true);
    expect(window._ndwCurrentManifestDays['2026-09-15'].status).toBe('ready');
    expect(render).toHaveBeenCalledTimes(2);
  } finally { warning.mockRestore(); }
});
