/* Capa única de totales (js/totales-service.js).
 *
 * Regla: meses COMPLETOS con fin <= corte oficial salen de
 * v_cifras_oficiales_vigentes; lo posterior al corte y los días sueltos de un
 * rango libre, del detalle (totales_detalle_por_dia). Con filtros
 * dimensionales no hay cifra oficial.
 *
 * Los datos de prueba reproducen las cifras oficiales que dio la Dirección
 * (2025 completo, ene–ago 2026 y el histórico al 31/08/2026).
 */
const Totales = require('../js/totales-service.js');
const { crearTotalesFake } = require('../test-utils/totales-fake');

const HOY = '2026-10-06';
const CORTE = '2026-08-31';
const fila = (anio, mes, categoria, operaciones, segundo) => (categoria === 'carga'
  ? { anio, mes, categoria, operaciones, toneladas: segundo }
  : { anio, mes, categoria, operaciones, pasajeros: segundo });

// Reparte un total en N meses (en centésimas, para que las toneladas cuadren).
function repartir(total, meses, decimales = 0) {
  const factor = 10 ** decimales;
  const entero = Math.round(total * factor);
  const base = Math.floor(entero / meses);
  return Array.from({ length: meses }, (_, i) => (i === meses - 1 ? entero - base * (meses - 1) : base) / factor);
}

function oficialAnual(anio, meses, { com, pax, car, ton, ag, agPax }) {
  const filas = [];
  const r = { com: repartir(com, meses.length), pax: repartir(pax, meses.length), car: repartir(car, meses.length),
    ton: repartir(ton, meses.length, 2), ag: repartir(ag, meses.length), agPax: repartir(agPax, meses.length) };
  meses.forEach((mes, i) => {
    filas.push(fila(anio, mes, 'comercial', r.com[i], r.pax[i]));
    filas.push(fila(anio, mes, 'carga', r.car[i], r.ton[i]));
    filas.push(fila(anio, mes, 'general', r.ag[i], r.agPax[i]));
  });
  return filas;
}

const OFICIAL = [
  // 2022-2024: el informe oficial por año (aquí, todo en junio de cada año).
  ...oficialAnual(2022, [6], { com: 8996, pax: 912415, car: 8, ton: 5.19, ag: 458, agPax: 1385 }),
  ...oficialAnual(2023, [6], { com: 23211, pax: 2631261, car: 5578, ton: 186319.83, ag: 2212, agPax: 8160 }),
  ...oficialAnual(2024, [6], { com: 51734, pax: 6318454, car: 13219, ton: 447341.17, ag: 2777, agPax: 29637 }),
  // 2025 completo, mes por mes.
  ...oficialAnual(2025, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    { com: 52597, pax: 7058219, car: 12041, ton: 406192.74, ag: 3071, agPax: 21114 }),
  // 2026 ene–jul (lo que falta para llegar a ene–ago) y agosto oficial.
  ...oficialAnual(2026, [1, 2, 3, 4, 5, 6, 7],
    { com: 37699 - 5147, pax: 5054241 - 730001, car: 8660 - 1196, ton: 276756.39 - 38197.59, ag: 1892 - 201, agPax: 14928 - 505 }),
  fila(2026, 8, 'comercial', 5147, 730001), fila(2026, 8, 'carga', 1196, 38197.59), fila(2026, 8, 'general', 201, 505)
];

const det = (fecha, categoria, operaciones, segundo) => (categoria === 'carga'
  ? { fecha, categoria, operaciones, pasajeros: 0, toneladas: segundo }
  : { fecha, categoria, operaciones, pasajeros: segundo, toneladas: null });

// Detalle (Conciliación por FECHA y directorio de AG).
const DETALLE = [
  // Agosto 2026: se ve en el diario, pero su total mensual es el oficial.
  det('2026-08-10', 'comercial', 170, 24000), det('2026-08-10', 'carga', 39, 1250.25), det('2026-08-10', 'general', 7, 15),
  // Un día de julio para el rango libre.
  det('2026-07-20', 'comercial', 160, 22000), det('2026-07-20', 'carga', 35, 1100.1), det('2026-07-20', 'general', 6, 10),
  // Después del corte.
  det('2026-09-02', 'comercial', 100, 15000), det('2026-09-02', 'carga', 40, 1200.5), det('2026-09-02', 'general', 5, 12),
  det('2026-10-01', 'comercial', 90, 14000), det('2026-10-01', 'carga', 30, 900.255), det('2026-10-01', 'general', 4, 8)
];

const POST = { com: 190, pax: 29000, car: 70, ton: 2100.755, ag: 9, agPax: 20 };

const nuevo = () => crearTotalesFake({ corte: CORTE, corteMaestra: '2026-07-31', oficial: OFICIAL, detalle: DETALLE, hoy: HOY });

describe('totales sin filtros', () => {
  test('año 2025 completo: sólo la cifra oficial', async () => {
    const r = await nuevo().getTotales({ desde: '2025-01-01', hasta: '2025-12-31' });
    expect(r.total.fuente).toBe('oficial');
    expect(r.total.comercial).toEqual({ operaciones: 52597, pasajeros: 7058219 });
    expect(r.total.carga).toEqual({ operaciones: 12041, toneladas: 406192.74 });
    expect(r.total.general).toEqual({ operaciones: 3071, pasajeros: 21114 });
  });

  test('agosto 2026: el diario sale de Conciliación, el total mensual es el oficial', async () => {
    const s = nuevo();
    const dia = (await s.getDetalleDiario('2026-08-10', '2026-08-10')).get('2026-08-10');
    expect(dia.comercial).toEqual({ operaciones: 170, pasajeros: 24000 });
    const r = await s.getTotales({ desde: '2026-08-01', hasta: '2026-08-31', granularidad: 'mes' });
    expect(r.periodos).toHaveLength(1);
    expect(r.periodos[0]).toMatchObject({
      clave: '2026-08', fuente: 'oficial',
      comercial: { operaciones: 5147, pasajeros: 730001 },
      carga: { operaciones: 1196, toneladas: 38197.59 },
      general: { operaciones: 201, pasajeros: 505 }
    });
  });

  test('año 2026: oficial hasta agosto + Conciliación del 1 de septiembre a hoy', async () => {
    const r = await nuevo().getTotales({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(r.total.fuente).toBe('mixta');
    expect(r.combinaFuentes).toBe(true);
    expect(r.total.comercial).toEqual({ operaciones: 37699 + POST.com, pasajeros: 5054241 + POST.pax });
    expect(r.total.carga.operaciones).toBe(8660 + POST.car);
    expect(r.total.carga.toneladas).toBe(Math.round((276756.39 + POST.ton) * 100) / 100);
    expect(r.total.general).toEqual({ operaciones: 1892 + POST.ag, pasajeros: 14928 + POST.agPax });
    expect(r.leyenda).toBe('Cifras oficiales hasta agosto 2026 · posteriores: conciliación de manifiestos');
  });

  test('histórico total: todo el oficial al 31/08/2026 + Conciliación posterior', async () => {
    const meses = await nuevo().historiaMensual();
    const suma = (cat, k) => meses.reduce((a, m) => a + m[cat][k], 0);
    expect(suma('comercial', 'operaciones')).toBe(174237 + POST.com);
    expect(suma('comercial', 'pasajeros')).toBe(21974590 + POST.pax);
    expect(suma('carga', 'operaciones')).toBe(39506 + POST.car);
    expect(Math.round(suma('carga', 'toneladas') * 100) / 100).toBe(Math.round((1316615.32 + POST.ton) * 100) / 100);
    expect(suma('general', 'operaciones')).toBe(10410 + POST.ag);
    expect(suma('general', 'pasajeros')).toBe(75224 + POST.agPax);
    // Septiembre y octubre (mes en curso) salen del detalle.
    expect(meses.filter((m) => m.fuente === 'detalle').map((m) => m.clave)).toEqual(['2026-09', '2026-10']);
  });

  test('rango libre: los días sueltos salen del detalle y los meses completos del oficial', async () => {
    const r = await nuevo().getTotales({ desde: '2026-07-15', hasta: '2026-08-31', granularidad: 'mes' });
    expect(r.periodos.map((p) => [p.clave, p.fuente])).toEqual([['2026-07', 'detalle'], ['2026-08', 'oficial']]);
    expect(r.periodos[0].comercial).toEqual({ operaciones: 160, pasajeros: 22000 });
    expect(r.total.comercial.operaciones).toBe(160 + 5147);
    expect(r.combinaFuentes).toBe(true);
  });

  test('por año: cada año es la suma de sus meses, con su fuente', async () => {
    const r = await nuevo().getTotales({ desde: '2025-01-01', hasta: '2026-12-31', granularidad: 'anio' });
    expect(r.periodos.map((p) => [p.clave, p.fuente])).toEqual([['2025', 'oficial'], ['2026', 'mixta']]);
    expect(r.periodos[0].comercial.operaciones).toBe(52597);
  });

  test('toneladas con dos decimales', async () => {
    const r = await nuevo().getTotales({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(r.total.carga.toneladas).toBe(900.26);
  });
});

describe('con filtros dimensionales', () => {
  test('no hay cifra oficial: quien llama usa su detalle y muestra el aviso', async () => {
    const s = nuevo();
    const r = await s.getTotales({ desde: '2025-01-01', hasta: '2025-12-31', filtros: { aerolinea: ['VIVA AEROBUS'] } });
    expect(r).toMatchObject({ filtrado: true, total: null, aviso: 'Cifras de detalle operativo; pueden diferir de la cifra oficial' });
    expect(s.hayFiltros({ fecha_inicio: '2025-01-01', aerolinea: [] })).toBe(false);
    expect(s.hayFiltros({ matricula: 'XA-VBA' })).toBe(true);
  });
});

describe('formas de las tablas viejas', () => {
  test('filasMensuales y filasAnuales salen de lo mismo, con la marca de oficial', async () => {
    const s = nuevo();
    const meses = await s.filasMensuales();
    const ago = meses.find((m) => m.year === 2026 && m.month === 8);
    expect(ago).toMatchObject({ comercial_ops: 5147, comercial_pax: 730001, carga_ops: 1196, carga_tons: 38197.59, general_ops: 201, general_pax: 505, is_official: true });
    expect(meses.find((m) => m.year === 2026 && m.month === 9).is_official).toBe(false);
    const anios = await s.filasAnuales();
    expect(anios[0].year).toBe(2026);
    expect(anios.find((a) => a.year === 2025)).toMatchObject({
      comercial_ops_total: 52597, comercial_pax_total: 7058219, carga_ops_total: 12041,
      carga_tons_total: 406192.74, general_ops_total: 3071, general_pax_total: 21114, is_official: true
    });
  });
});

describe('caché', () => {
  function clienteContado(cortes) {
    const conteo = { oficial: 0, corte: 0 };
    const respuesta = (r) => { const p = Promise.resolve(r); p.range = () => Promise.resolve(r); return p; };
    const cliente = {
      rpc(nombre) {
        if (nombre === 'fn_fecha_corte_oficial') { conteo.corte += 1; return respuesta({ data: cortes.shift() || CORTE, error: null }); }
        return respuesta({ data: [], error: null });
      },
      from() {
        const q = { select: () => q, order: () => q, range: () => { conteo.oficial += 1; return Promise.resolve({ data: OFICIAL, error: null }); } };
        return q;
      }
    };
    return { cliente, conteo };
  }

  test('reutiliza lo consultado durante 5 minutos y luego vuelve a pedir', async () => {
    let ahora = 0;
    const { cliente, conteo } = clienteContado([]);
    const s = Totales.crear({ cliente: () => cliente, ahora: () => ahora, hoy: () => HOY });
    await s.getTotales({ desde: '2025-01-01', hasta: '2025-12-31' });
    await s.getTotales({ desde: '2025-01-01', hasta: '2025-12-31' });
    expect(conteo.oficial).toBe(1);
    ahora += 5 * 60 * 1000 + 1;
    await s.getTotales({ desde: '2025-01-01', hasta: '2025-12-31' });
    expect(conteo.oficial).toBe(2);
  });

  test('si el corte oficial cambia, se tira lo calculado con el anterior', async () => {
    let ahora = 0;
    const { cliente, conteo } = clienteContado(['2026-07-31', '2026-08-31']);
    const s = Totales.crear({ cliente: () => cliente, ahora: () => ahora, hoy: () => HOY });
    expect(await s.getCorteOficial()).toBe('2026-07-31');   // t = 0
    ahora = 4 * 60 * 1000;
    await s.getOficialMensual();                             // t = 4 min (vale hasta t = 9)
    await s.getOficialMensual();
    expect(conteo.oficial).toBe(1);
    ahora = 6 * 60 * 1000;                                   // vence sólo el corte; al releerlo cambió
    expect(await s.getCorteOficial()).toBe('2026-08-31');
    await s.getOficialMensual();                             // aún dentro de su TTL, pero se tiró
    expect(conteo.oficial).toBe(2);
    expect(conteo.corte).toBe(2);
  });
});
