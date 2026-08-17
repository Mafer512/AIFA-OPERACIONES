/**
 * @jest-environment jsdom
 *
 * Filas fantasma al usar "+ Agregar fila" en Conciliación Manifiestos.
 *
 * Síntoma reportado: se agregaba una fila y, al bajar al final de la tabla,
 * aparecían filas en blanco con ESTATUS MATRÍCULA "NO IDENTIFICADA" que nadie
 * había capturado. El contador de arriba las sumaba (218 → 219), así que no
 * eran un espejismo del render: eran registros reales.
 *
 * La causa: "+ Agregar fila" deja el cursor abierto en la primera celda
 * editable. Al hacer clic en otra parte ese editor se cierra y
 * _conciCommitCellRaw llama a _conciAutoSaveRow SIEMPRE, aunque no se haya
 * escrito nada. El payload salía vacío, pero justo después la fila nueva
 * heredaba la fecha del filtro y se le ponía el nombre de quien estaba en
 * sesión — con eso dejaba de estar vacío y se insertaba igual. Quedaba un
 * registro con fecha y capturista y nada más: en blanco, y con la matrícula
 * "NO IDENTIFICADA" porque no había matrícula que identificar.
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
  ${extraer('_conciFilaNuevaListaParaGuardar')}
  return { _conciFilaNuevaListaParaGuardar };
`)();

function fila({ nueva = false, rowId = '' } = {}) {
  const tr = document.createElement('tr');
  if (nueva) tr.dataset.conciNew = '1';
  tr.dataset.rowId = rowId;
  return tr;
}

describe('una fila nueva no se crea sola', () => {
  test('sin captura del usuario, no se guarda', () => {
    expect(api._conciFilaNuevaListaParaGuardar(fila({ nueva: true }), false)).toBe(false);
  });

  test('en cuanto el usuario captura algo, sí se guarda', () => {
    expect(api._conciFilaNuevaListaParaGuardar(fila({ nueva: true }), true)).toBe(true);
  });

  // Una fila ya guardada se sigue escribiendo aunque en esta pasada no haya
  // captura nueva: es el camino de los rellenos automáticos y de las columnas
  // calculadas, que más adelante se filtran por columnas realmente modificadas.
  test('una fila ya existente no se ve afectada', () => {
    expect(api._conciFilaNuevaListaParaGuardar(fila(), false)).toBe(true);
  });

  // Tras el primer guardado la fila conserva un momento data-conci-new pero ya
  // tiene id: a partir de ahí es una fila normal y debe poder actualizarse.
  test('una fila nueva que ya recibió su id se trata como existente', () => {
    expect(api._conciFilaNuevaListaParaGuardar(fila({ nueva: true, rowId: '4321' }), false)).toBe(true);
  });
});

describe('integración en el autoguardado', () => {
  const guardado = source.slice(source.indexOf('async function _conciAutoSaveRow'));

  test('la comprobación corre antes de heredar la fecha del filtro', () => {
    const guarda = guardado.indexOf('_conciFilaNuevaListaParaGuardar(tr, hasUserCapture)');
    const herenciaFecha = guardado.indexOf('_conciFechaUnicaDelFiltro()');

    expect(guarda).toBeGreaterThan(-1);
    expect(herenciaFecha).toBeGreaterThan(-1);
    // Si corriera después, la fecha heredada volvería a llenar el payload y la
    // fila vacía se insertaría igual: es exactamente el bug original.
    expect(guarda).toBeLessThan(herenciaFecha);
  });

  test('sólo cuenta como captura una celda tocada y con contenido', () => {
    expect(guardado).toContain("if (isDirty && raw) hasUserCapture = true;");
  });

  // "Guardar todo" (Ctrl+G) recorre TODAS las filas nuevas, incluidas las que
  // siguen en blanco. Debe escribir a través del autoguardado para heredar esta
  // comprobación; si algún día se le diera su propio insert, la fila fantasma
  // volvería por esa puerta.
  test('"Guardar todo" escribe a través del autoguardado, no por su cuenta', () => {
    const manual = source.slice(source.indexOf('async function _conciGuardarTodoAhora'));
    const bloque = manual.slice(0, manual.indexOf('\n}\n'));

    expect(bloque).toContain('_conciAutoSaveRow(tr, { keepEditorsOpen: true })');
    expect(bloque).not.toContain('_conciWriteRowSafe');
    expect(bloque).not.toContain('.insert(');
  });
});
