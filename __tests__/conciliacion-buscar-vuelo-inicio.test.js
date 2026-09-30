/**
 * Conciliación › "Buscar # de vuelo…": al dar Enter (o ↓) la tabla regresa su
 * barra horizontal al principio (CIERRE SUBSECRETARIA), aunque antes se
 * hubiera desplazado a la derecha.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8').replace(/\r\n/g, '\n');

function extraer(inicio, fin) {
  const a = js.indexOf(inicio);
  const b = js.indexOf(fin, a + inicio.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return js.slice(a, b);
}

function contexto(wrap) {
  const cuadros = [];
  const ctx = {
    document: {
      getElementById: (id) => (id === 'conci-manifiestos-scroll' ? wrap : null),
      querySelectorAll: () => [],
    },
    requestAnimationFrame: (fn) => cuadros.push(fn),
    _conciFlightColumnKey: () => '# DE VUELO',
    _conciColFilters: {},
    _conciApplyPillFilter: () => {},
    // El editor desplaza la tabla al abrirse, como hace el navegador al enfocar.
    _conciFocusFirstCaptureCell: () => { wrap.scrollLeft = 1500; },
  };
  vm.createContext(ctx);
  vm.runInContext(extraer('function _conciApplyQuickFlightSearch(', 'function _conciClearQuickFlightSearch('), ctx);
  const correrCuadros = () => { while (cuadros.length) cuadros.shift()(); };
  return { ctx, correrCuadros };
}

describe('Buscar # de vuelo: Enter regresa la tabla al inicio', () => {
  test('con Enter la barra horizontal queda al principio', () => {
    const wrap = { scrollLeft: 2400 };
    const { ctx, correrCuadros } = contexto(wrap);
    ctx._conciApplyQuickFlightSearch('XN 1761', { focusFirst: true });
    correrCuadros();
    expect(wrap.scrollLeft).toBe(0);
    expect(ctx._conciColFilters['# DE VUELO']).toBe('XN 1761');
  });

  test('al solo escribir (sin Enter) no se mueve la barra', () => {
    const wrap = { scrollLeft: 2400 };
    const { ctx, correrCuadros } = contexto(wrap);
    ctx._conciApplyQuickFlightSearch('XN');
    correrCuadros();
    expect(wrap.scrollLeft).toBe(2400);
  });

  test('Enter y ↓ del buscador piden saltar a la captura', () => {
    const init = extraer('function _conciInitQuickFlightSearch(', "} else if (ev.key === 'Escape')");
    expect(init).toMatch(/ev\.key === 'Enter' \|\| ev\.key === 'ArrowDown'/);
    expect(init).toMatch(/_conciApplyQuickFlightSearch\(input\.value, \{ focusFirst: true \}\)/);
  });
});
