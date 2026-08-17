/**
 * @jest-environment jsdom
 *
 * La fila nueva en blanco: no se apila, no se pierde, y no se disfraza de
 * registro fantasma.
 *
 * Historia de este archivo — importa, porque el segundo intento fue peor que
 * el problema:
 *
 * 1. Al agregar una fila, el sistema le pintaba "NO IDENTIFICADA" en ESTATUS
 *    MATRÍCULA (no hay matrícula que identificar). La fila que el usuario
 *    estaba capturando se veía idéntica a un registro fantasma.
 * 2. Se intentó retirarla de la pantalla al salir de ella (focusout). Fue un
 *    error: entre el blur y el click hay una carrera y, si el temporizador
 *    corría antes de que el foco aterrizara en la celda destino, la fila
 *    desaparecía CON LO QUE LLEVARA DENTRO. En un módulo de captura eso es
 *    perder trabajo.
 * 3. Regla actual: ninguna fila se quita sola. "Agregar fila" reutiliza la que
 *    ya esté en blanco en vez de apilar otra, y el estatus se queda vacío
 *    hasta que haya una matrícula escrita.
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

const api = new Function(`
  ${extraer('_conciNormalizeEditableCellText')}
  ${extraer('_conciFilaNuevaSinCapturar')}
  ${extraer('_conciBuscarFilaNuevaEnBlanco')}
  return { _conciFilaNuevaSinCapturar, _conciBuscarFilaNuevaEnBlanco };
`)();

const COLUMNAS = ['FECHA', 'AEROLINEA', 'MATRÍCULA', 'ESTATUS MATRÍCULA'];

function pintarTabla() {
  document.body.innerHTML = `<table id="table-conci-manifiestos"><tbody></tbody></table>`;
  return document.querySelector('tbody');
}

function filaNueva(tbody, { rowId = '', capturado = null } = {}) {
  const tr = document.createElement('tr');
  tr.dataset.conciNew = '1';
  tr.dataset.rowId = rowId;
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    td.dataset.raw = '';
    td.dataset.pendingRaw = '';
    if (capturado && capturado.col === col) {
      td.dataset.pendingRaw = capturado.valor;
      td.dataset.raw = capturado.valor;
      td.textContent = capturado.valor;
      td.dataset.dirty = '1';
    }
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('reconocer una fila nueva sin capturar', () => {
  test('recién creada, está sin capturar', () => {
    expect(api._conciFilaNuevaSinCapturar(filaNueva(pintarTabla()))).toBe(true);
  });

  test('con un dato escrito, ya no está sin capturar', () => {
    const tr = filaNueva(pintarTabla(), { capturado: { col: 'AEROLINEA', valor: 'VOLARIS' } });
    expect(api._conciFilaNuevaSinCapturar(tr)).toBe(false);
  });

  test('una fila ya guardada nunca se considera en blanco', () => {
    expect(api._conciFilaNuevaSinCapturar(filaNueva(pintarTabla(), { rowId: '1000' }))).toBe(false);
  });

  test('una fila normal de la tabla no se toca', () => {
    const tr = filaNueva(pintarTabla());
    delete tr.dataset.conciNew;
    expect(api._conciFilaNuevaSinCapturar(tr)).toBe(false);
  });
});

describe('"Agregar fila" reutiliza en vez de apilar', () => {
  test('encuentra la fila en blanco que ya estaba', () => {
    const tbody = pintarTabla();
    const tr = filaNueva(tbody);
    expect(api._conciBuscarFilaNuevaEnBlanco(tbody)).toBe(tr);
  });

  test('si la fila ya tiene datos, no la reutiliza: hay que crear otra', () => {
    const tbody = pintarTabla();
    filaNueva(tbody, { capturado: { col: 'MATRÍCULA', valor: 'XAVBP' } });
    expect(api._conciBuscarFilaNuevaEnBlanco(tbody)).toBeNull();
  });

  test('sin filas nuevas, no hay nada que reutilizar', () => {
    expect(api._conciBuscarFilaNuevaEnBlanco(pintarTabla())).toBeNull();
  });

  // Lo esencial: buscar no destruye. La fila sigue en la tabla intacta.
  test('buscar no quita ninguna fila de la tabla', () => {
    const tbody = pintarTabla();
    const tr = filaNueva(tbody);

    api._conciBuscarFilaNuevaEnBlanco(tbody);

    expect(tr.isConnected).toBe(true);
    expect(tbody.querySelectorAll('tr')).toHaveLength(1);
  });
});

describe('nada desaparece solo mientras se captura', () => {
  // Ésta es la regla que no se puede volver a romper.
  test('no hay ningún borrado automático por foco', () => {
    expect(source).not.toContain("tbody.addEventListener('focusout'");
    expect(source).not.toContain('_conciLimpiarFilasNuevasVacias');
  });

  test('la única fila que se retira sola es la que el usuario manda borrar', () => {
    const agregar = source.slice(source.indexOf('function _conciAddBlankRow'));
    const bloque = agregar.slice(0, agregar.indexOf('\n}\n'));
    expect(bloque).not.toContain('.remove()');
  });

  test('"Agregar fila" reutiliza la fila en blanco en vez de crear otra', () => {
    const agregar = source.slice(source.indexOf('function _conciAddBlankRow'));
    const bloque = agregar.slice(0, agregar.indexOf('\n}\n'));
    const reutiliza = bloque.indexOf('_conciBuscarFilaNuevaEnBlanco(tbody)');
    const crea = bloque.indexOf("const tr = document.createElement('tr');");

    expect(reutiliza).toBeGreaterThan(-1);
    expect(reutiliza).toBeLessThan(crea);
  });
});

describe('el estatus de matrícula no delata una fila que apenas empieza', () => {
  test('una fila nueva sin matrícula no se pinta "NO IDENTIFICADA"', () => {
    const validar = source.slice(source.indexOf('function _conciRefreshMatriculaValidationForRow'));
    const bloque = validar.slice(0, validar.indexOf('\n}\n'));

    expect(bloque).toContain('esFilaNuevaSinMatricula');
    // Se sale antes de pintar el estatus.
    const salida = bloque.indexOf('if (esFilaNuevaSinMatricula)');
    const pintado = bloque.indexOf('_conciRenderMatriculaStatusCell');
    expect(salida).toBeLessThan(pintado);
  });
});
