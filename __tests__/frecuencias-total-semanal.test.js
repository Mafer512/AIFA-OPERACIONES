/**
 * El total de frecuencias semanales debe cuadrar con los días que se ven.
 *
 * Síntoma reportado: la tarjeta decía 4 frecuencias cuando en la tabla solo se
 * veían dos.
 *
 * Al generar los datos, cada día se cuenta convirtiendo la fecha a hora de
 * México:
 *
 *     COUNT(*) FILTER (WHERE EXTRACT(DOW FROM det.flight_date
 *                                    AT TIME ZONE 'America/Mexico_City') = 1)
 *
 * pero el total se calculaba aparte, sin esa conversión ni ese filtro:
 *
 *     COUNT(*) as weekly_total
 *
 * Una fila sin fecha válida no entra en ninguno de los siete conteos, pero sí
 * en el COUNT(*). El front-end además prefería esa columna sobre la suma de los
 * días, así que mostraba el número inflado.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const fuente = fs
  .readFileSync(path.join(raiz, 'js', 'frecuencias_auto.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = fuente.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre}`);
  return fuente.slice(inicio, fuente.indexOf('\n  }\n', inicio) + 4);
}

const api = new Function('console', `
  const DAY_CODES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  ${extraer('normalizeAirline')}
  return { normalizeAirline };
`)({ warn: () => {} });

const conDias = (dias, total) => ({
  name: 'VIVA AEROBUS',
  daily: { L: dias[0], M: dias[1], X: dias[2], J: dias[3], V: dias[4], S: dias[5], D: dias[6] },
  weeklyTotal: total,
});

describe('el total sale de los días', () => {
  test('el caso reportado: la base dice 4 y los días suman 2', () => {
    const air = api.normalizeAirline(conDias([1, 0, 1, 0, 0, 0, 0], 4));
    expect(air.weeklyTotal).toBe(2);
  });

  test('cuando cuadran, no cambia nada', () => {
    const air = api.normalizeAirline(conDias([1, 1, 1, 0, 0, 0, 0], 3));
    expect(air.weeklyTotal).toBe(3);
  });

  test('una semana completa se cuenta entera', () => {
    const air = api.normalizeAirline(conDias([2, 2, 2, 2, 2, 2, 2], 99));
    expect(air.weeklyTotal).toBe(14);
  });

  test('los días mandan aunque la base diga menos', () => {
    // El descuadre puede ir en las dos direcciones.
    const air = api.normalizeAirline(conDias([1, 1, 1, 1, 0, 0, 0], 2));
    expect(air.weeklyTotal).toBe(4);
  });
});

describe('cuando no hay días capturados', () => {
  test('se conserva el total guardado, para no perder el dato', () => {
    const air = api.normalizeAirline(conDias([0, 0, 0, 0, 0, 0, 0], 5));
    expect(air.weeklyTotal).toBe(5);
  });

  test('sin días ni total, queda en cero', () => {
    const air = api.normalizeAirline(conDias([0, 0, 0, 0, 0, 0, 0], null));
    expect(air.weeklyTotal).toBe(0);
  });

  test('un total no numérico no rompe nada', () => {
    const air = api.normalizeAirline(conDias([0, 0, 0, 0, 0, 0, 0], 'muchas'));
    expect(air.weeklyTotal).toBe(0);
  });
});

describe('valores sucios en los días', () => {
  test('días vacíos cuentan como cero', () => {
    const air = api.normalizeAirline({ name: 'X', daily: { L: 2, M: null, X: undefined }, weeklyTotal: 9 });
    expect(air.weeklyTotal).toBe(2);
  });

  test('días como texto se suman igual', () => {
    const air = api.normalizeAirline(conDias(['1', '2', 0, 0, 0, 0, 0], 7));
    expect(air.weeklyTotal).toBe(3);
  });
});

describe('el descuadre se avisa', () => {
  test('se advierte en consola cuando la base y los días no coinciden', () => {
    const avisos = [];
    const conAviso = new Function('console', `
      const DAY_CODES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
      function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
      ${extraer('normalizeAirline')}
      return { normalizeAirline };
    `)({ warn: (m) => avisos.push(m) });

    conAviso.normalizeAirline(conDias([1, 0, 1, 0, 0, 0, 0], 4));

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('4');
    expect(avisos[0]).toContain('2');
  });

  test('cuando cuadran no se avisa de nada', () => {
    const avisos = [];
    const conAviso = new Function('console', `
      const DAY_CODES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
      function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
      ${extraer('normalizeAirline')}
      return { normalizeAirline };
    `)({ warn: (m) => avisos.push(m) });

    conAviso.normalizeAirline(conDias([1, 1, 0, 0, 0, 0, 0], 2));
    expect(avisos).toHaveLength(0);
  });
});

describe('corrección de raíz en la base', () => {
  const sql = fs.readFileSync(path.join(raiz, 'db', 'fix_weekly_total_suma_de_dias.sql'), 'utf8');

  test('cuadra lo ya guardado', () => {
    expect(sql).toContain('UPDATE weekly_frequencies');
    expect(sql).toContain('SET weekly_total =');
  });

  test('y evita que vuelva a descuadrar', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public._freq_weekly_total_desde_dias');
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.weekly_frequencies');
  });

  test('cubre también las tablas de internacional y carga', () => {
    expect(sql).toContain('weekly_frequencies_int');
    expect(sql).toContain('weekly_frequencies_cargo');
  });
});
