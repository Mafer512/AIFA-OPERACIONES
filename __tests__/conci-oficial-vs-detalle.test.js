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
