/**
 * @jest-environment jsdom
 *
 * Aviso al salir de la página con capturas sin guardar.
 *
 * El autoguardado por celda escribe a Supabase sin esperar, para que capturar
 * se sienta como Excel. El guard de beforeunload solo miraba las escrituras en
 * vuelo (_conciPendingAutoSaveCount), y ahí estaba el hueco: una fila cuyo
 * guardado FALLÓ queda marcada como "Pendiente de guardar" con su valor
 * viviendo únicamente en la pantalla, y puede quedarse así indefinidamente.
 * Esas eran las capturas que se perdían en silencio al recargar.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`No se encontró ${name} en script.js`);
  const end = source.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`No se encontró el cierre de ${name}`);
  return source.slice(start, end + 2);
}

const api = new Function(`
  let _conciPendingAutoSaveCount = 0;
  ${extractFunction('_conciHasUnsavedCaptures')}
  ${extractFunction('_conciHasPendingLocalEdits')}
  return {
    _conciHasUnsavedCaptures,
    _conciHasPendingLocalEdits,
    setInFlight: (n) => { _conciPendingAutoSaveCount = n; },
  };
`)();

/**
 * Dibuja una fila de captura.
 * @param {object} options
 *   dirtyCells   celdas con un valor tecleado distinto al guardado
 *   rowDirty     la fila marcada como sucia (una fila nueva nace así)
 *   saving       guardado en curso
 *   editorOpen   editor abierto en una celda
 *   failed       fila cuyo guardado falló ("Pendiente de guardar")
 */
function renderRow(options = {}) {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  const tbody = document.querySelector('#table-conci-manifiestos tbody');
  const tr = document.createElement('tr');
  if (options.rowDirty) tr.dataset.dirty = '1';
  if (options.saving) tr.classList.add('conci-row-saving');
  if (options.failed) {
    tr.classList.add('table-secondary');
    tr.title = 'Pendiente de guardar: network error';
  }
  ['FECHA', 'TOTAL PAX', 'OBSERVACIONES'].forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    if ((options.dirtyCells || []).includes(col)) td.dataset.dirty = '1';
    if (options.editorOpen === col) {
      const input = document.createElement('input');
      input.className = 'conci-cell-input';
      td.classList.add('conci-cell-active');
      td.appendChild(input);
    }
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

beforeEach(() => {
  api.setInFlight(0);
  document.body.innerHTML = '';
});

describe('avisa antes de salir', () => {
  test('con una escritura todavía en vuelo', () => {
    api.setInFlight(1);
    expect(api._conciHasUnsavedCaptures()).toBe(true);
  });

  test('con una celda capturada que aún no se envía', () => {
    renderRow({ dirtyCells: ['TOTAL PAX'], rowDirty: true });
    expect(api._conciHasUnsavedCaptures()).toBe(true);
  });

  test('con una fila cuyo guardado falló — el hueco que se cerró', () => {
    // Un guardado fallido no marca las celdas como guardadas: siguen sucias.
    renderRow({ dirtyCells: ['TOTAL PAX'], rowDirty: true, failed: true });
    expect(api._conciHasUnsavedCaptures()).toBe(true);
  });

  test('con un guardado en curso sobre la fila', () => {
    renderRow({ saving: true });
    expect(api._conciHasUnsavedCaptures()).toBe(true);
  });

  test('la escritura en vuelo cuenta aunque la tabla ya no esté en pantalla', () => {
    api.setInFlight(2);
    document.body.innerHTML = '';
    expect(api._conciHasUnsavedCaptures()).toBe(true);
  });
});

describe('no molesta sin motivo', () => {
  test('con todo guardado', () => {
    renderRow({});
    expect(api._conciHasUnsavedCaptures()).toBe(false);
  });

  test('con una celda abierta en la que nadie escribió', () => {
    renderRow({ editorOpen: 'TOTAL PAX' });
    expect(api._conciHasUnsavedCaptures()).toBe(false);
  });

  test('con una fila en blanco recién agregada y sin capturar nada', () => {
    // _conciAddBlankRow marca la fila como sucia al nacer, pero no hay dato
    // que rescatar mientras sus celdas sigan vacías.
    renderRow({ rowDirty: true });
    expect(api._conciHasUnsavedCaptures()).toBe(false);
  });

  test('sin tabla en pantalla y sin escrituras en vuelo', () => {
    expect(api._conciHasUnsavedCaptures()).toBe(false);
  });
});

describe('separación de responsabilidades con el guard de refrescos', () => {
  test('una celda abierta sí bloquea un refresco remoto, pero no el aviso de salida', () => {
    renderRow({ editorOpen: 'TOTAL PAX' });
    // Reemplazar el tbody a media captura borraría lo que se está escribiendo.
    expect(api._conciHasPendingLocalEdits()).toBe(true);
    // Pero no hay nada capturado que se pueda perder al recargar.
    expect(api._conciHasUnsavedCaptures()).toBe(false);
  });

  test('una captura sin guardar bloquea las dos cosas', () => {
    renderRow({ dirtyCells: ['OBSERVACIONES'], rowDirty: true });
    expect(api._conciHasPendingLocalEdits()).toBe(true);
    expect(api._conciHasUnsavedCaptures()).toBe(true);
  });
});

describe('regresión', () => {
  test('el guard de beforeunload ya no mira solo las escrituras en vuelo', () => {
    const guard = source.slice(
      source.indexOf("window.addEventListener('beforeunload'"),
      source.indexOf("window.addEventListener('beforeunload'") + 260
    );
    expect(guard).toContain('_conciHasUnsavedCaptures()');
    expect(guard).not.toContain('_conciPendingAutoSaveCount > 0');
  });
});
