/** @jest-environment jsdom */
// Conciliación · Oficial vs Detalle: por mes y categoría, cifra oficial contra
// detalle, sólo meses completos hasta el corte oficial.
const { construirFilas } = require('../js/conci-oficial-vs-detalle.js');

const oficial = new Map([
  ['2026-07', { comercial: { operaciones: 5054, pasajeros: 712027 }, carga: { operaciones: 1098, toneladas: 36089.41 }, general: { operaciones: 245, pasajeros: 3015 } }],
  ['2026-08', { comercial: { operaciones: 5147, pasajeros: 730001 }, carga: { operaciones: 1196, toneladas: 38197.59 }, general: { operaciones: 201, pasajeros: 505 } }]
]);
const dia = (com, pax, car, ton, gen, paxGen) => ({
  comercial: { operaciones: com, pasajeros: pax }, carga: { operaciones: car, toneladas: ton }, general: { operaciones: gen, pasajeros: paxGen }
});
const detalle = new Map([
  ['2026-08-01', dia(3000, 400000, 600, 20000.004, 100, 300)],
  ['2026-08-20', dia(2161, 332291, 590, 18000.001, 101, 205)],
  ['2026-09-02', dia(100, 15000, 40, 1200.5, 5, 12)]
]);

test('sólo meses completos hasta el corte, con diferencia absoluta y porcentaje sobre lo oficial', () => {
  const filas = construirFilas(2026, '2026-08-31', oficial, detalle);
  expect(new Set(filas.map((f) => f.clave))).toEqual(new Set(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']));
  const agoCom = filas.find((f) => f.clave === '2026-08' && f.categoria === 'Comercial');
  expect(agoCom).toMatchObject({ opsOficial: 5147, opsDetalle: 5161, segOficial: 730001, segDetalle: 732291 });
  expect(agoCom.ops.abs).toBe(14);
  expect(agoCom.ops.pct).toBeCloseTo(14 / 5147 * 100, 6);
  const agoCarga = filas.find((f) => f.clave === '2026-08' && f.categoria === 'Carga');
  expect(agoCarga.segDetalle).toBe(38000.01);           // toneladas con 2 decimales
  expect(agoCarga.decimales).toBe(2);
  // Septiembre es posterior al corte: no se compara.
  expect(filas.some((f) => f.clave === '2026-09')).toBe(false);
  // Un mes sin cifra oficial queda sin diferencia, no con cero.
  const ene = filas.find((f) => f.clave === '2026-01' && f.categoria === 'Comercial');
  expect(ene.ops).toEqual({ abs: null, pct: null });
});

describe('sólo el super admin ve la pestaña', () => {
  const { aplicarVisibilidad, esSuperAdmin, cargar } = require('../js/conci-oficial-vs-detalle.js');
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

  function montar(activa) {
    document.body.innerHTML = `
      <ul id="conciliacion-tabs">
        <li><button id="tab-conci-itinerario" class="nav-link${activa ? '' : ' active'}"></button></li>
        <li class="d-none"><button id="tab-conci-oficial-detalle" class="nav-link${activa ? ' active' : ''}"></button></li>
      </ul>
      <div id="pane-conci-itinerario" class="tab-pane${activa ? '' : ' active show'}"></div>
      <div id="pane-conci-oficial-detalle" class="tab-pane d-none${activa ? ' active show' : ''}"></div>`;
  }
  const li = () => document.getElementById('tab-conci-oficial-detalle').closest('li');
  afterEach(() => { sessionStorage.clear(); delete window.TotalesService; });

  test('en index.html la pestaña y su panel nacen ocultos', () => {
    expect(html).toMatch(/<li class="nav-item d-none"[^>]*>(<!--[^>]*-->)?\s*<button[^>]*id="tab-conci-oficial-detalle"/);
    expect(html).toContain('<div class="tab-pane fade p-4 d-none" id="pane-conci-oficial-detalle"');
  });

  test.each(['superadmin', 'Super Admin', 'SUPER_ADMIN'])('rol "%s": la ve', (rol) => {
    montar(false);
    sessionStorage.setItem('user_role', rol);
    expect(esSuperAdmin()).toBe(true);
    expect(aplicarVisibilidad()).toBe(true);
    expect(li().classList.contains('d-none')).toBe(false);
    expect(document.getElementById('pane-conci-oficial-detalle').classList.contains('d-none')).toBe(false);
  });

  test.each(['admin', 'editor', 'capturista', 'viewer', 'lector', ''])('rol "%s": no la ve ni consulta', async (rol) => {
    montar(false);
    if (rol) sessionStorage.setItem('user_role', rol);
    expect(aplicarVisibilidad()).toBe(false);
    expect(li().classList.contains('d-none')).toBe(true);
    window.TotalesService = { getCorteOficial: jest.fn() };
    await cargar();
    expect(window.TotalesService.getCorteOficial).not.toHaveBeenCalled();
  });

  test('si estaba abierta y entra otro rol, regresa al Itinerario', () => {
    montar(true);
    sessionStorage.setItem('user_role', 'admin');
    aplicarVisibilidad();
    expect(document.getElementById('tab-conci-itinerario').classList.contains('active')).toBe(true);
    expect(document.getElementById('pane-conci-oficial-detalle').classList.contains('active')).toBe(false);
  });
});
