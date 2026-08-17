/**
 * @jest-environment jsdom
 *
 * La fila que crea "+ Agregar fila" debe tener EXACTAMENTE las mismas celdas
 * que una fila de datos.
 *
 * Síntoma reportado: cada clic en "Agregar fila" dibujaba al final de la tabla
 * una fila corrida, más ancha que las demás, con su papelera suelta muy a la
 * derecha, fuera de la columna "Acciones".
 *
 * La causa: el thead tiene DOS filas — los encabezados y la fila de filtros
 * ("Filtrar…") — y la fila nueva se construía con
 * thead.querySelectorAll('th:not([data-conci-action])'), que barre las dos. Así
 * nacía con casi el doble de celdas: las de datos más una por cada campo de
 * filtro, sin nombre de columna.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  let inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const api = new Function('document', 'window', `
  let _conciEditMode = true;
  function _conciCanCurrentUserEdit() { return true; }
  function _conciEnterEditMode() {}
  function _conciBindRowActions() {}
  function _conciActivateCellEditor() {}
  function _conciAsegurarCeldaVisible() {}
  function _conciIsProtectedEditColumn(col) { return /^(MES|FECHA)$/i.test(col); }
  function _conciIsCalculatedColumn(col) { return /HRS\\. CUMPLIDAS/i.test(col); }
  ${extraer('_conciNormalizeEditableCellText')}
  ${extraer('_conciFilaNuevaSinCapturar')}
  ${extraer('_conciBuscarFilaNuevaEnBlanco')}
  ${extraer('_conciAddBlankRow')}
  return { _conciAddBlankRow };
`)(document, window);

const COLUMNAS = ['MES', 'FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'HRS. CUMPLIDAS'];

// Reproduce el thead real: fila de encabezados + fila de filtros, ambas con th.
function pintarTabla({ conAcciones = true } = {}) {
  document.body.innerHTML = `<table id="table-conci-manifiestos"><thead></thead><tbody></tbody></table>`;
  const thead = document.querySelector('thead');

  const trHead = document.createElement('tr');
  COLUMNAS.forEach(c => {
    const th = document.createElement('th');
    th.className = 'text-nowrap conci-th';
    th.dataset.conciColumnKey = c;
    // El encabezado real lleva dentro la etiqueta y el botón de filtro.
    th.innerHTML = `<div class="conci-th-inner"><span>${c}</span><button class="conci-ef-btn">filtro</button></div>`;
    trHead.appendChild(th);
  });
  const itTh = document.createElement('th');
  itTh.className = 'text-nowrap conci-th conci-it-val-col';
  itTh.textContent = 'Itinerario';
  trHead.appendChild(itTh);
  if (conAcciones) {
    const actionTh = document.createElement('th');
    actionTh.className = 'text-nowrap conci-th conci-row-action-col';
    actionTh.textContent = 'Acciones';
    actionTh.dataset.conciAction = '1';
    trHead.appendChild(actionTh);
  }
  thead.appendChild(trHead);

  // La fila de filtros: mismos th, sin data-conci-column-key ni data-conci-action.
  const trFilter = document.createElement('tr');
  trFilter.className = 'conci-filter-row';
  const cuantos = COLUMNAS.length + 1 + (conAcciones ? 1 : 0);
  for (let i = 0; i < cuantos; i++) {
    const thF = document.createElement('th');
    thF.className = 'conci-th-filter';
    thF.innerHTML = '<input class="conci-col-filter" placeholder="Filtrar…">';
    trFilter.appendChild(thF);
  }
  thead.appendChild(trFilter);

  return { thead, tbody: document.querySelector('tbody'), trHead };
}

// Una fila de datos tal como la dibuja el render: una td por columna, la de
// Itinerario y la de acciones.
function filaDeDatos(tbody, { conAcciones = true } = {}) {
  const tr = document.createElement('tr');
  tr.dataset.rowId = '77';
  COLUMNAS.forEach(c => {
    const td = document.createElement('td');
    td.className = 'conci-cell';
    td.dataset.col = c;
    tr.appendChild(td);
  });
  const itTd = document.createElement('td');
  itTd.className = 'conci-cell conci-it-val-cell text-center';
  tr.appendChild(itTd);
  if (conAcciones) {
    const actionTd = document.createElement('td');
    actionTd.className = 'conci-row-action-col text-center';
    tr.appendChild(actionTd);
  }
  tbody.appendChild(tr);
  return tr;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('la fila nueva calza con la tabla', () => {
  test('tiene el mismo número de celdas que una fila de datos', () => {
    const { tbody } = pintarTabla();
    const real = filaDeDatos(tbody);

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');

    expect(nueva.children).toHaveLength(real.children.length);
  });

  test('tiene el mismo número de celdas que columnas el encabezado', () => {
    const { tbody, trHead } = pintarTabla();

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');

    expect(nueva.children).toHaveLength(trHead.children.length);
  });

  // El síntoma exacto: la fila de filtros colaba celdas de más.
  test('no arrastra celdas de la fila de filtros', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');
    const sinColumna = [...nueva.querySelectorAll('td[data-col]')]
      .filter(td => !td.dataset.col.trim());

    expect(sinColumna).toHaveLength(0);
    expect(nueva.querySelector('input.conci-col-filter')).toBeNull();
  });

  test('las columnas van en el mismo orden y con el mismo nombre', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');
    const cols = [...nueva.querySelectorAll('td[data-col]')].map(td => td.dataset.col);

    expect(cols).toEqual(COLUMNAS);
  });

  // El nombre sale de data-conci-column-key, no del textContent del th, que
  // arrastra el texto del botón de filtro.
  test('el nombre de columna no se contamina con el botón de filtro', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');
    const cols = [...nueva.querySelectorAll('td[data-col]')].map(td => td.dataset.col);

    expect(cols.some(c => /filtro/i.test(c))).toBe(false);
  });

  test('lleva su celda de Itinerario, y no es editable', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');
    const itTd = nueva.querySelector('td.conci-it-val-cell');

    expect(itTd).not.toBeNull();
    expect(itTd.dataset.col).toBeUndefined();
  });

  test('la papelera queda en la última celda, la de acciones', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');
    const ultima = nueva.children[nueva.children.length - 1];

    expect(ultima.dataset.conciAction).toBe('1');
    expect(ultima.querySelector('.conci-delete-new-row')).not.toBeNull();
  });

  test('sin columna de acciones en el encabezado, la fila tampoco la lleva', () => {
    const { tbody, trHead } = pintarTabla({ conAcciones: false });

    api._conciAddBlankRow();
    const nueva = tbody.querySelector('tr[data-conci-new="1"]');

    expect(nueva.children).toHaveLength(trHead.children.length);
    expect(nueva.querySelector('.conci-delete-new-row')).toBeNull();
  });
});

describe('pulsar "Agregar fila" varias veces', () => {
  test('no apila filas en blanco', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    api._conciAddBlankRow();
    api._conciAddBlankRow();

    expect(tbody.querySelectorAll('tr[data-conci-new="1"]')).toHaveLength(1);
  });

  test('si la fila en blanco ya tiene datos, sí se crea otra', () => {
    const { tbody } = pintarTabla();

    api._conciAddBlankRow();
    const primera = tbody.querySelector('tr[data-conci-new="1"]');
    const celda = primera.querySelector('td[data-col="AEROLINEA"]');
    celda.dataset.pendingRaw = 'VOLARIS';
    celda.dataset.dirty = '1';

    api._conciAddBlankRow();

    expect(tbody.querySelectorAll('tr[data-conci-new="1"]')).toHaveLength(2);
    expect(primera.isConnected).toBe(true); // la primera nunca se destruye
  });
});
