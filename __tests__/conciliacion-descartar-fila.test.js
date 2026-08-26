/**
 * @jest-environment jsdom
 *
 * Descartar una fila nueva, y saber si una fila vacía es nueva o perdió datos.
 *
 * Síntoma reportado: se agregaba una fila, se pedía eliminarla y "no se
 * eliminaba" — reaparecía casi vacía y había que borrarla otra vez.
 *
 * La causa: el botón de una fila nueva solo hacía tr.remove(). En cuanto se
 * captura algo, el autoguardado queda armado a 400 ms; si se borraba antes de
 * que terminara, la fila desaparecía de la vista pero el guardado llegaba igual
 * y la creaba en la base. Ese es también el origen de las filas en blanco que
 * aparecían "solas".
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  let inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

function constante(nombre) {
  const i = source.indexOf(`const ${nombre}`);
  if (i === -1) throw new Error(`No se encontró ${nombre}`);
  const fin = source.indexOf('];', i);
  return source.slice(i, fin + 2);
}

const borrados = [];
const olvidados = [];
// Lo que la base responde al DELETE. Por omisión confirma que borró la fila
// (devuelve el id). `respuestaBorrado.filas = []` simula el caso silencioso:
// PostgREST responde sin error pero RLS no dejó borrar nada.
const respuestaBorrado = { filas: null, error: null };

const api = new Function('document', 'window', 'console', 'borrados', 'olvidados', 'respuestaBorrado', `
  function _conciBorradorOlvidarFila(tr) { olvidados.push(tr); }
  const _conciRenderCache = { clear() {} };
  let _conciRenderedKey = '';
  window.supabaseClient = {
    from: () => ({
      delete: () => ({
        eq: (_c, id) => ({
          select: () => {
            borrados.push(id);
            if (respuestaBorrado.error) return Promise.resolve({ data: null, error: respuestaBorrado.error });
            return Promise.resolve({ data: respuestaBorrado.filas ?? [{ id }], error: null });
          },
        }),
      }),
    }),
  };
  ${extraer('_conciEliminarRegistro')}
  ${extraer('_conciDescartarFilaNueva')}
  ${extraer('_conciNormalizeEditableCellText')}
  ${extraer('_conciSummaryColumnKey')}
  ${constante('_CONCI_COLUMNAS_IDENTIDAD')}
  ${extraer('_conciFilaSinCaptura')}
  ${extraer('_conciMarcarFilasSinCaptura')}
  return { _conciDescartarFilaNueva, _conciEliminarRegistro, _conciFilaSinCaptura, _conciMarcarFilasSinCaptura };
`)(document, window, console, borrados, olvidados, respuestaBorrado);

function filaNueva({ rowId = '', promesa = null, timer = null } = {}) {
  document.body.innerHTML = `
    <table id="table-conci-manifiestos"><tbody>
      <tr data-conci-new="1"><td data-col="AEROLINEA"></td><td data-col="TOTAL PAX"></td></tr>
    </tbody></table>`;
  const tr = document.querySelector('tr');
  tr.dataset.rowId = rowId;
  if (promesa) tr._conciAutoSavePromise = promesa;
  if (timer !== null) tr._conciAutoSaveTimer = timer;
  return tr;
}

beforeEach(() => {
  borrados.length = 0;
  olvidados.length = 0;
  respuestaBorrado.filas = null;
  respuestaBorrado.error = null;
  document.body.innerHTML = '';
});

describe('descartar una fila nueva', () => {
  test('se marca para que ningún guardado siga adelante', async () => {
    const tr = filaNueva();
    await api._conciDescartarFilaNueva(tr);
    expect(tr.dataset.conciDescartada).toBe('1');
  });

  test('cancela el guardado que estuviera en cola', async () => {
    jest.useFakeTimers();
    const guardado = jest.fn();
    const id = setTimeout(guardado, 400);
    const tr = filaNueva({ timer: id });

    await api._conciDescartarFilaNueva(tr);
    jest.advanceTimersByTime(1000);

    expect(guardado).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('olvida el borrador local, o la fila volvería al recargar', async () => {
    const tr = filaNueva();
    await api._conciDescartarFilaNueva(tr);
    expect(olvidados).toContain(tr);
  });

  test('desaparece de la pantalla', async () => {
    const tr = filaNueva();
    await api._conciDescartarFilaNueva(tr);
    expect(tr.isConnected).toBe(false);
  });

  test('si el guardado alcanzó a crearla, se borra de la base', async () => {
    // Es justo el caso que fallaba: la fila desaparecía y reaparecía.
    const tr = filaNueva({ rowId: '9876' });
    await api._conciDescartarFilaNueva(tr);
    expect(borrados).toEqual(['9876']);
  });

  test('espera al guardado en vuelo antes de decidir', async () => {
    let resolver;
    const enVuelo = new Promise(r => { resolver = r; });
    const tr = filaNueva({ promesa: enVuelo });

    const tarea = api._conciDescartarFilaNueva(tr);
    // El guardado termina y le asigna id: hay que borrarla de la base.
    tr.dataset.rowId = '555';
    resolver();
    await tarea;

    expect(borrados).toEqual(['555']);
  });

  test('si nunca llegó a guardarse, no se toca la base', async () => {
    const tr = filaNueva();
    await api._conciDescartarFilaNueva(tr);
    expect(borrados).toEqual([]);
  });

  test('un guardado que falló no impide descartarla', async () => {
    const tr = filaNueva({ promesa: Promise.reject(new Error('sin red')) });
    await expect(api._conciDescartarFilaNueva(tr)).resolves.toBe(true);
    expect(tr.isConnected).toBe(false);
  });

  // El segundo síntoma reportado: la fila se iba de la pantalla pero el
  // registro seguía en la base y volvía al recargar. Pasaba porque el DELETE
  // se daba por bueno sin comprobar que hubiera borrado algo.
  test('si la base no borró nada, la fila se queda en pantalla', async () => {
    respuestaBorrado.filas = [];
    const tr = filaNueva({ rowId: '9876' });

    await expect(api._conciDescartarFilaNueva(tr)).resolves.toBe(false);
    expect(tr.isConnected).toBe(true);
  });

  test('si el borrado falla, la fila se queda en pantalla', async () => {
    respuestaBorrado.error = new Error('permiso denegado');
    const tr = filaNueva({ rowId: '9876' });

    await expect(api._conciDescartarFilaNueva(tr)).resolves.toBe(false);
    expect(tr.isConnected).toBe(true);
  });

  // Si quedara marcada como descartada, el botón podría reintentar pero el
  // autoguardado ya no volvería a tocarla nunca.
  test('una fila que no se pudo borrar vuelve a ser una fila viva', async () => {
    respuestaBorrado.filas = [];
    const tr = filaNueva({ rowId: '9876' });

    await api._conciDescartarFilaNueva(tr);

    expect(tr.dataset.conciDescartada).toBeUndefined();
  });
});

describe('confirmar que la base borró de verdad', () => {
  test('un DELETE que devuelve la fila cuenta como borrado', async () => {
    await expect(api._conciEliminarRegistro('42')).resolves.toBe(true);
    expect(borrados).toEqual(['42']);
  });

  // PostgREST responde 204 sin error aunque RLS haya filtrado el registro y no
  // se haya borrado nada: sin pedir la fila de vuelta parecía un éxito.
  test('un DELETE que no tocó ninguna fila NO cuenta como borrado', async () => {
    respuestaBorrado.filas = [];
    await expect(api._conciEliminarRegistro('42')).resolves.toBe(false);
  });

  test('un error de la base se propaga', async () => {
    respuestaBorrado.error = new Error('permiso denegado');
    await expect(api._conciEliminarRegistro('42')).rejects.toThrow('permiso denegado');
  });

  test('se pide la fila de vuelta para poder comprobarlo', () => {
    const fn = source.slice(source.indexOf('async function _conciEliminarRegistro'));
    expect(fn.slice(0, 900)).toContain(".select('id')");
  });
});

describe('distinguir una fila sin capturar', () => {
  function pintarFila(valores) {
    document.body.innerHTML = `
      <table id="table-conci-manifiestos"><tbody><tr data-row-id="42"></tr></tbody></table>`;
    const tr = document.querySelector('tr');
    Object.entries(valores).forEach(([col, valor]) => {
      const td = document.createElement('td');
      td.dataset.col = col;
      td.dataset.raw = valor;
      td.textContent = valor;
      tr.appendChild(td);
    });
    return tr;
  }

  test('sin nada de lo que identifica un vuelo, se marca', () => {
    const tr = pintarFila({ 'AEROLINEA': '', '# DE VUELO': '', 'TOTAL PAX': '' });
    expect(api._conciFilaSinCaptura(tr)).toBe(true);
  });

  test('con la aerolínea puesta, ya no', () => {
    const tr = pintarFila({ 'AEROLINEA': 'VIVA AEROBUS', '# DE VUELO': '' });
    expect(api._conciFilaSinCaptura(tr)).toBe(false);
  });

  test('la fecha sola no cuenta: la pone el sistema al crear la fila', () => {
    const tr = pintarFila({ 'FECHA': '12/08/2026', 'MES': 'Agosto', 'AEROLINEA': '' });
    expect(api._conciFilaSinCaptura(tr)).toBe(true);
  });

  test('la marca explica dónde comprobar qué pasó', () => {
    pintarFila({ 'AEROLINEA': '', '# DE VUELO': '' });
    const cuantas = api._conciMarcarFilasSinCaptura();
    const tr = document.querySelector('tr');

    expect(cuantas).toBe(1);
    expect(tr.classList.contains('conci-fila-sin-captura')).toBe(true);
    expect(tr.title).toContain('historial');
  });

  test('una fila con datos no se marca', () => {
    pintarFila({ 'AEROLINEA': 'CARGOLUX', '# DE VUELO': 'CV 5933' });
    expect(api._conciMarcarFilasSinCaptura()).toBe(0);
    expect(document.querySelector('tr').classList.contains('conci-fila-sin-captura')).toBe(false);
  });
});

describe('integración en el módulo', () => {
  test('el botón de fila nueva usa el descarte completo', () => {
    expect(source).toContain('await _conciDescartarFilaNueva(tr);');
    expect(source).not.toMatch(/conci-delete-new-row'\)\) \{\s*\n\s*tr\?\.remove\(\);/);
  });

  test('el autoguardado se detiene en una fila descartada', () => {
    const guardar = source.slice(source.indexOf('async function _conciAutoSaveRow'));
    expect(guardar.slice(0, 1600)).toContain("tr.dataset.conciDescartada === '1'");
    const encolar = source.slice(source.indexOf('function _conciQueueAutoSave'));
    expect(encolar.slice(0, 400)).toContain("tr.dataset.conciDescartada === '1'");
  });

  test('las filas sin captura se marcan tras cada render', () => {
    expect(source).toContain('_conciMarcarFilasSinCaptura();');
    expect(html).toContain('conci-fila-sin-captura');
  });

  // Los dos caminos de borrado (fila nueva y fila ya guardada) deben pasar por
  // la misma comprobación; si alguno vuelve a hacer su propio .delete() sin
  // .select(), regresa el borrado que parecía funcionar y no funcionaba.
  test('ningún borrado da por bueno un DELETE sin confirmar', () => {
    const sueltos = source.match(/from\('Conciliación Manifiestos'\)\s*\n?\s*\.?delete\(\)/g) || [];
    expect(sueltos).toHaveLength(1); // sólo el de _conciEliminarRegistro
    expect(source).toContain('const borrada = await _conciEliminarRegistro(rowId);');
  });

  test('la papelera avisa cuando el usuario no tiene permiso de borrado', () => {
    const manejador = source.slice(source.indexOf('function _conciBindRowActions'));
    const bloque = manejador.slice(0, manejador.indexOf('\n}\n'));
    expect(bloque).toContain('Solo usuarios editor o admin pueden eliminar filas');
  });
});
