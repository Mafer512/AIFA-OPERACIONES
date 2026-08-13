/**
 * @jest-environment jsdom
 *
 * Columnas fijas al desplazar en horizontal.
 *
 * La tabla tiene más de cuarenta columnas. Al desplazarse a la derecha para
 * capturar pasajeros o kilos se perdían de vista la fecha, la aerolínea y el
 * número de vuelo — la identidad de la fila — y se capturaba a ciegas. El
 * encabezado ya se quedaba fijo en vertical; esto hace lo mismo en horizontal.
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

const constante = source.slice(
  source.indexOf('const _CONCI_COLUMNAS_FIJAS'),
  source.indexOf('\n', source.indexOf('const _CONCI_COLUMNAS_FIJAS')) + 1
);

const api = new Function('document', `
  ${extraer('_conciNormalizedColumnName')}
  ${constante}
  ${extraer('_conciEsColumnaFija')}
  ${extraer('_conciSyncColumnasFijas')}
  return { _conciEsColumnaFija, _conciSyncColumnasFijas };
`)(document);

const COLUMNAS = [
  'CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA',
  'TIPO DE OPERACIÓN', 'AERONAVE', 'MATRÍCULA', '# DE VUELO', 'TOTAL PAX',
];

const ANCHOS = {
  'CIERRE SUBSECRETARIA': 120, 'MES': 60, 'FECHA': 90, 'TIPO DE MANIFIESTO': 110,
  'AEROLINEA': 130, 'TIPO DE OPERACIÓN': 100, 'AERONAVE': 100, 'MATRÍCULA': 90,
  '# DE VUELO': 80, 'TOTAL PAX': 70,
};

/** Dibuja la tabla y simula el ancho real de cada encabezado. */
function render({ ocultas = [] } = {}) {
  document.body.innerHTML = `
    <div id="conci-manifiestos-scroll">
      <table id="table-conci-manifiestos">
        <thead><tr class="cabecera"></tr><tr class="conci-filter-row"></tr></thead>
        <tbody><tr class="fila"></tr></tbody>
      </table>
    </div>`;
  const tabla = document.getElementById('table-conci-manifiestos');
  // offsetParent es null en jsdom; la función lo usa para saltarse la pestaña
  // oculta, así que se simula visible.
  Object.defineProperty(tabla, 'offsetParent', { value: document.body, configurable: true });

  const cabecera = tabla.querySelector('tr.cabecera');
  const filtros = tabla.querySelector('tr.conci-filter-row');
  const fila = tabla.querySelector('tr.fila');

  COLUMNAS.forEach(col => {
    const oculta = ocultas.includes(col);
    const th = document.createElement('th');
    th.dataset.conciColumnKey = col;
    th.getBoundingClientRect = () => ({ width: oculta ? 0 : ANCHOS[col] });
    cabecera.appendChild(th);

    const thF = document.createElement('th');
    thF.dataset.conciColumnKey = col;
    filtros.appendChild(thF);

    const td = document.createElement('td');
    td.dataset.conciColumnKey = col;
    td.dataset.col = col;
    fila.appendChild(td);
  });
  return tabla;
}

const celdas = (col) =>
  [...document.querySelectorAll(`[data-conci-column-key="${col}"]`)];

describe('qué columnas se fijan', () => {
  test('fecha, aerolínea y número de vuelo se desplazan con la tabla', () => {
    expect(api._conciEsColumnaFija('FECHA')).toBe(false);
    expect(api._conciEsColumnaFija('AEROLINEA')).toBe(false);
    expect(api._conciEsColumnaFija('# DE VUELO')).toBe(false);
  });

  test('ninguna otra', () => {
    ['MES', 'TOTAL PAX', 'MATRÍCULA', 'OBSERVACIONES', 'TIPO DE MANIFIESTO']
      .forEach(col => expect(api._conciEsColumnaFija(col)).toBe(false));
  });

  test('no le afectan acentos ni mayúsculas', () => {
    expect(api._conciEsColumnaFija('Fecha')).toBe(false);
    expect(api._conciEsColumnaFija('AEROLÍNEA')).toBe(false);
  });
});

describe('desplazamiento horizontal uniforme', () => {
  beforeEach(() => { render(); api._conciSyncColumnasFijas(); });

  test('títulos, filtros y datos no reciben posición fija', () => {
    ['FECHA', 'AEROLINEA', '# DE VUELO', 'MATRÍCULA'].forEach(col => {
      celdas(col).forEach(c => {
        expect(c.classList.contains('conci-col-fija')).toBe(false);
        expect(c.classList.contains('conci-col-fija-ultima')).toBe(false);
        expect(c.style.left).toBe('');
      });
    });
  });
});

describe('recálculo', () => {
  test('al cambiar anchos no se agregan posiciones fijas', () => {
    render();
    api._conciSyncColumnasFijas();
    document.querySelector('tr.cabecera [data-conci-column-key="FECHA"]')
      .getBoundingClientRect = () => ({ width: 150 });
    api._conciSyncColumnasFijas();
    expect(celdas('AEROLINEA')[0].style.left).toBe('');
    expect(celdas('# DE VUELO')[0].style.left).toBe('');
  });

  test('sin tabla en pantalla no revienta', () => {
    document.body.innerHTML = '';
    expect(() => api._conciSyncColumnasFijas()).not.toThrow();
  });
});
