/**
 * @jest-environment jsdom
 *
 * Fecha heredada por una fila nueva, y el año del selector heredado.
 *
 * A3 — Al agregar una fila en blanco sin escribir fecha, el sistema le ponía la
 * del filtro. Con un rango activo tomaba siempre el día de INICIO, sin importar
 * en qué parte de la tabla se estuviera trabajando: el manifiesto quedaba
 * archivado en una fecha que no era la suya, y el error es casi invisible
 * porque la fila se ve bien.
 *
 * A2 — El selector de año heredado trae sus opciones escritas a mano (2025 y
 * 2026). Un <select> al que se le asigna un valor inexistente se queda en
 * blanco, así que en enero de 2027 la fecha por defecto dejaba de calcularse.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const api = new Function('document', `
  ${extraer('_conciFechaUnicaDelFiltro')}
  ${extraer('_conciAsegurarAnioEnSelector')}
  return { _conciFechaUnicaDelFiltro, _conciAsegurarAnioEnSelector };
`)(document);

function pintarFiltros(desde, hasta) {
  document.body.innerHTML = `
    <input id="filter-conci-fecha-desde" value="${desde}">
    <input id="filter-conci-fecha-hasta" value="${hasta}">`;
}

describe('fecha heredada por una fila nueva', () => {
  test('con un solo día, la hereda', () => {
    pintarFiltros('2026-08-11', '');
    expect(api._conciFechaUnicaDelFiltro()).toBe('2026-08-11');
  });

  test('con un rango de un solo día repetido, también', () => {
    pintarFiltros('2026-08-11', '2026-08-11');
    expect(api._conciFechaUnicaDelFiltro()).toBe('2026-08-11');
  });

  test('con un rango de varios días, NO la hereda', () => {
    // Antes tomaba el 1 de agosto para toda fila nueva del rango.
    pintarFiltros('2026-08-01', '2026-08-15');
    expect(api._conciFechaUnicaDelFiltro()).toBe('');
  });

  test('sin fecha en el filtro, no inventa ninguna', () => {
    pintarFiltros('', '');
    expect(api._conciFechaUnicaDelFiltro()).toBe('');
  });

  test('con una fecha a medio escribir, no la usa', () => {
    pintarFiltros('2026-08', '');
    expect(api._conciFechaUnicaDelFiltro()).toBe('');
  });

  test('sin los campos en pantalla, no revienta', () => {
    document.body.innerHTML = '';
    expect(api._conciFechaUnicaDelFiltro()).toBe('');
  });
});

describe('año del selector heredado', () => {
  function pintarSelector(...anios) {
    document.body.innerHTML = `<select id="sel">${
      anios.map(a => `<option value="${a}">${a}</option>`).join('')
    }</select>`;
    return document.getElementById('sel');
  }

  test('un año que ya existe se respeta', () => {
    const sel = pintarSelector(2025, 2026);
    api._conciAsegurarAnioEnSelector(sel, 2026);
    expect(sel.options).toHaveLength(2);
    sel.value = '2026';
    expect(sel.value).toBe('2026');
  });

  test('2027 se agrega y el selector lo acepta', () => {
    const sel = pintarSelector(2025, 2026);
    api._conciAsegurarAnioEnSelector(sel, 2027);
    sel.value = '2027';
    expect(sel.value).toBe('2027');
  });

  test('sin el arreglo, asignar 2027 dejaba el selector en blanco', () => {
    // Reproduce el comportamiento anterior para dejar constancia del defecto.
    const sel = pintarSelector(2025, 2026);
    sel.value = '2027';
    expect(sel.value).toBe('');
  });

  test('no duplica una opción existente si se llama dos veces', () => {
    const sel = pintarSelector(2026);
    api._conciAsegurarAnioEnSelector(sel, 2027);
    api._conciAsegurarAnioEnSelector(sel, 2027);
    expect([...sel.options].filter(o => o.value === '2027')).toHaveLength(1);
  });

  test('tolera un selector ausente o un año inválido', () => {
    expect(() => api._conciAsegurarAnioEnSelector(null, 2027)).not.toThrow();
    const sel = pintarSelector(2026);
    api._conciAsegurarAnioEnSelector(sel, 'no es un año');
    expect(sel.options).toHaveLength(1);
  });
});

describe('regresión', () => {
  test('el autoguardado ya no lee los selectores heredados para la fecha', () => {
    const guardado = source.slice(source.indexOf('async function _conciAutoSaveRow'));
    const bloque = guardado.slice(0, guardado.indexOf('CAPTURÓ'));
    expect(bloque).toContain('_conciFechaUnicaDelFiltro()');
    expect(bloque).not.toContain('filter-conci-manifiestos-day');
  });
});
