/**
 * @jest-environment jsdom
 *
 * Manifiestos › conteo discreto de filas mostradas, abajo a la derecha de la
 * tabla: "1,179 vuelos" sin filtros y "12 de 1,179 vuelos" con filtros. Cuenta
 * también las filas que la tabla aún no pinta (carga perezosa).
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const bloque = (inicio, fin) => {
  const a = source.indexOf(inicio);
  const b = source.indexOf(fin, a);
  if (a === -1 || b === -1) throw new Error('No se encontró el bloque.');
  return source.slice(a, b);
};

function preparar({ filas, hayFiltro = false, pasa = () => true }) {
  document.body.innerHTML = `
    <table id="table-conci-manifiestos"><tbody></tbody></table>
    <div id="conci-conteo-filas"></div>`;
  const ambiente = {
    _conciManifestosAllData: filas,
    _conciSummaryLiveOverrides: new Map(),
    _conciHasActiveTableFilter: () => hayFiltro,
    _conciPasaOtrosFiltros: () => pasa,
  };
  const nombres = Object.keys(ambiente);
  return new Function(...nombres,
    bloque('function _conciActualizarConteoFilas', '// Se recuenta cuando la tabla agrega')
    + '; return _conciActualizarConteoFilas;'
  )(...nombres.map(n => ambiente[n]));
}
const texto = () => document.getElementById('conci-conteo-filas').textContent;

describe('conteo de filas de Manifiestos', () => {
  test('el contenedor va debajo de la tabla', () => {
    const i = html.indexOf('id="table-conci-manifiestos"');
    expect(html.indexOf('id="conci-conteo-filas"')).toBeGreaterThan(i);
  });

  test('sin filtros: todas las filas cargadas', () => {
    preparar({ filas: Array.from({ length: 1179 }, () => ({})) })();
    expect(texto()).toBe('1,179 vuelos');
  });

  test('con filtros: las que pasan, de cuántas hay (aunque no estén pintadas)', () => {
    const filas = Array.from({ length: 1179 }, (_, i) => ({ i }));
    preparar({ filas, hayFiltro: true, pasa: f => f && f.i < 12 })();
    expect(texto()).toBe('12 de 1,179 vuelos');
  });

  test('una sola fila va en singular; sin filas no muestra nada', () => {
    preparar({ filas: [{}] })();
    expect(texto()).toBe('1 vuelo');
    preparar({ filas: [] })();
    expect(texto()).toBe('');
  });

  test('se recuenta al aplicar filtros', () => {
    expect(bloque('function _conciApplyPillFilter', '// ── Conteo de filas mostradas')).toMatch(/_conciProgramarConteoFilas\(\);\s*\}\s*$/);
  });
});

test('lleva un avión sólido a la izquierda del número', () => {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table><div id="conci-conteo-filas"></div>';
  const src = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'script.js'), 'utf8');
  expect(src).toMatch(/el\.innerHTML = `<i class="fas fa-plane conci-conteo-filas-avion" aria-hidden="true"><\/i><span>\$\{texto\}<\/span>`;/);
});
