/**
 * @jest-environment jsdom
 *
 * Borrador local de capturas sin guardar.
 *
 * El autoguardado por celda escribe a Supabase sin esperar. Cuando esa escritura
 * falla (red caída, permisos, tipo incompatible) la fila queda marcada como
 * "Pendiente de guardar" y su valor vive únicamente en el DOM: una recarga o un
 * vencimiento de sesión se lo llevaba sin dejar rastro. El aviso al salir avisa,
 * pero no rescata nada si el usuario acepta salir.
 *
 * Ahora cada celda capturada queda en localStorage desde el primer tecleo y solo
 * se borra cuando Supabase confirma ese valor exacto.
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

function constante(nombre) {
  const i = source.indexOf(`const ${nombre}`);
  if (i === -1) throw new Error(`No se encontró ${nombre}`);
  return source.slice(i, source.indexOf('\n', i) + 1);
}

const encolados = [];
const recalculadas = [];

const api = new Function('document', 'localStorage', 'CSS', 'console', 'encolados', 'recalculadas', `
  function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
  function _conciFechaUnicaDelFiltro() { return '2026-08-11'; }
  function _conciQueueAutoSave(tr) { encolados.push(tr); }
  function _conciRefreshCalculatedCellsForRow(tr) { recalculadas.push(tr); }
  // Recrear filas nuevas y reintentar tienen su propia suite
  // (conciliacion-nunca-perder); aquí solo hacen falta como dependencias.
  function _conciRestaurarFilasNuevas() { return 0; }
  function _conciProgramarReintento() {}
  ${constante('_CONCI_BORRADORES_KEY')}
  ${constante('_CONCI_BORRADORES_VIGENCIA_MS')}
  ${extraer('_conciBorradoresLeer')}
  ${extraer('_conciBorradoresEscribir')}
  ${extraer('_conciBorradoresPurgar')}
  ${extraer('_conciBorradorClaveFila')}
  ${extraer('_conciBorradorGuardarCelda')}
  ${extraer('_conciBorradorQuitarCelda')}
  ${extraer('_conciBorradorTrasladarFilaNueva')}
  ${extraer('_conciBorradoresPendientes')}
  ${extraer('_conciRestaurarBorradores')}
  ${extraer('_conciReintentarPendientes')}
  ${extraer('_conciActualizarIndicadorBorradores')}
  return {
    _conciBorradoresLeer, _conciBorradorGuardarCelda, _conciBorradorQuitarCelda,
    _conciBorradorTrasladarFilaNueva, _conciBorradoresPendientes,
    _conciRestaurarBorradores, _conciReintentarPendientes,
    _conciActualizarIndicadorBorradores, _CONCI_BORRADORES_KEY,
  };
`)(document, window.localStorage, window.CSS, console, encolados, recalculadas);

const CLAVE = api._CONCI_BORRADORES_KEY;

/** Dibuja una tabla con una fila y devuelve sus celdas por columna. */
function pintarFila({ rowId = '', nueva = false, valores = {} } = {}) {
  document.body.innerHTML = `
    <span id="conci-pendientes-indicador" class="d-none"></span>
    <table id="table-conci-manifiestos"><tbody></tbody></table>`;
  const tbody = document.querySelector('#table-conci-manifiestos tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  if (nueva) tr.dataset.conciNew = '1';
  ['TOTAL PAX', 'OBSERVACIONES'].forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    td.dataset.raw = valores[col] ?? '';
    td.textContent = valores[col] ?? '';
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return { tr, td: (col) => [...tr.querySelectorAll('td')].find(c => c.dataset.col === col) };
}

beforeEach(() => {
  window.localStorage.clear();
  encolados.length = 0;
  recalculadas.length = 0;
  document.body.innerHTML = '';
});

describe('guarda desde el primer tecleo', () => {
  test('una celda capturada queda en el almacenamiento local', () => {
    const { td } = pintarFila({ rowId: '42' });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '178');

    const datos = api._conciBorradoresLeer();
    expect(datos['id:42'].celdas['TOTAL PAX']).toBe('178');
  });

  test('agrupa varias celdas de la misma fila', () => {
    const { td } = pintarFila({ rowId: '42' });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '178');
    api._conciBorradorGuardarCelda(td('OBSERVACIONES'), 'demora por clima');

    expect(api._conciBorradoresLeer()['id:42'].celdas).toEqual({
      'TOTAL PAX': '178',
      'OBSERVACIONES': 'demora por clima',
    });
  });

  test('una fila sin id recibe su propia clave estable', () => {
    const { tr, td } = pintarFila({ nueva: true });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '90');
    const clave = tr.dataset.conciBorradorClave;

    expect(clave).toMatch(/^nueva:/);
    api._conciBorradorGuardarCelda(td('OBSERVACIONES'), 'x');
    expect(tr.dataset.conciBorradorClave).toBe(clave);
    expect(Object.keys(api._conciBorradoresLeer())).toEqual([clave]);
  });
});

describe('se retira cuando la base confirma', () => {
  test('quitar una celda deja las demás', () => {
    const { td } = pintarFila({ rowId: '42' });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '178');
    api._conciBorradorGuardarCelda(td('OBSERVACIONES'), 'nota');

    api._conciBorradorQuitarCelda(td('TOTAL PAX'));

    expect(api._conciBorradoresLeer()['id:42'].celdas).toEqual({ 'OBSERVACIONES': 'nota' });
  });

  test('al quitar la última celda desaparece la fila del borrador', () => {
    const { td } = pintarFila({ rowId: '42' });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '178');
    api._conciBorradorQuitarCelda(td('TOTAL PAX'));

    expect(api._conciBorradoresLeer()).toEqual({});
  });

  test('una fila nueva que obtiene id suelta su borrador anterior', () => {
    const { tr, td } = pintarFila({ nueva: true });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '90');
    expect(Object.keys(api._conciBorradoresLeer())).toHaveLength(1);

    api._conciBorradorTrasladarFilaNueva(tr, 77);

    expect(api._conciBorradoresLeer()).toEqual({});
    expect(tr.dataset.rowId).toBe('77');
    expect(tr.dataset.conciBorradorClave).toBeUndefined();
  });
});

describe('vigencia', () => {
  test('un borrador de hace tres días se descarta', () => {
    const viejo = Date.now() - 72 * 60 * 60 * 1000;
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'id:42': { ts: viejo, celdas: { 'TOTAL PAX': '178' } },
    }));

    expect(api._conciBorradoresPendientes().celdas).toBe(0);
    expect(api._conciBorradoresLeer()).toEqual({});
  });

  test('uno de hace una hora se conserva', () => {
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'id:42': { ts: Date.now() - 3600 * 1000, celdas: { 'TOTAL PAX': '178' } },
    }));

    expect(api._conciBorradoresPendientes().celdas).toBe(1);
  });

  test('una entrada corrupta no rompe nada', () => {
    window.localStorage.setItem(CLAVE, 'esto no es json');
    expect(api._conciBorradoresLeer()).toEqual({});
    expect(() => api._conciBorradoresPendientes()).not.toThrow();
  });
});

describe('restaura al volver a entrar', () => {
  test('repone el valor en su celda y lo vuelve a encolar', () => {
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'id:42': { ts: Date.now(), celdas: { 'TOTAL PAX': '178' } },
    }));
    const { tr, td } = pintarFila({ rowId: '42', valores: { 'TOTAL PAX': '150' } });

    const repuestas = api._conciRestaurarBorradores();

    expect(repuestas).toBe(1);
    expect(td('TOTAL PAX').textContent).toBe('178');
    expect(td('TOTAL PAX').dataset.dirty).toBe('1');
    expect(td('TOTAL PAX').classList.contains('conci-cell-borrador')).toBe(true);
    expect(tr.dataset.dirty).toBe('1');
    expect(encolados).toContain(tr);
  });

  test('si la base ya tiene ese valor, el borrador sobra y se descarta', () => {
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'id:42': { ts: Date.now(), celdas: { 'TOTAL PAX': '178' } },
    }));
    pintarFila({ rowId: '42', valores: { 'TOTAL PAX': '178' } });

    expect(api._conciRestaurarBorradores()).toBe(0);
    expect(api._conciBorradoresLeer()).toEqual({});
    expect(encolados).toHaveLength(0);
  });

  test('un borrador de otra fecha se conserva para cuando se abra ese día', () => {
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'id:99': { ts: Date.now(), celdas: { 'TOTAL PAX': '200' } },
    }));
    pintarFila({ rowId: '42' });

    expect(api._conciRestaurarBorradores()).toBe(0);
    expect(api._conciBorradoresLeer()['id:99']).toBeDefined();
  });

  test('el borrador de una fila nueva se conserva para poder recuperarla', () => {
    // Recrear la fila corre por cuenta de _conciRestaurarFilasNuevas (ver la
    // suite conciliacion-nunca-perder). Lo que importa aquí es que este paso no
    // la descarte por el camino.
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'nueva:abc': { ts: Date.now(), celdas: { 'TOTAL PAX': '80' } },
    }));
    pintarFila({ rowId: '42' });

    api._conciRestaurarBorradores();
    expect(api._conciBorradoresPendientes().celdas).toBe(1);
    expect(api._conciBorradoresLeer()['nueva:abc']).toBeDefined();
  });
});

describe('reintento', () => {
  test('vuelve a encolar todas las filas con celdas sucias', () => {
    const { tr, td } = pintarFila({ rowId: '42' });
    td('TOTAL PAX').dataset.dirty = '1';

    expect(api._conciReintentarPendientes()).toBe(1);
    expect(encolados).toContain(tr);
  });

  test('sin nada sucio no encola nada', () => {
    pintarFila({ rowId: '42' });
    expect(api._conciReintentarPendientes()).toBe(0);
    expect(encolados).toHaveLength(0);
  });
});

describe('indicador', () => {
  test('se oculta cuando no hay nada pendiente', () => {
    pintarFila({ rowId: '42' });
    api._conciActualizarIndicadorBorradores();
    expect(document.getElementById('conci-pendientes-indicador').classList.contains('d-none')).toBe(true);
  });

  test('muestra cuántas capturas faltan por guardar', () => {
    const { td } = pintarFila({ rowId: '42' });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '178');
    api._conciBorradorGuardarCelda(td('OBSERVACIONES'), 'nota');

    const el = document.getElementById('conci-pendientes-indicador');
    expect(el.classList.contains('d-none')).toBe(false);
    expect(el.textContent).toBe('2 capturas sin guardar');
    expect(el.title).toContain('1 fila');
  });

  test('usa el singular con una sola', () => {
    const { td } = pintarFila({ rowId: '42' });
    api._conciBorradorGuardarCelda(td('TOTAL PAX'), '178');
    expect(document.getElementById('conci-pendientes-indicador').textContent)
      .toBe('1 captura sin guardar');
  });
});

describe('integración en el módulo', () => {
  test('se guarda el borrador al teclear', () => {
    const stage = source.slice(source.indexOf('function _conciStageCellDraft'));
    expect(stage.slice(0, 900)).toContain('_conciBorradorGuardarCelda(td, nextRaw)');
  });

  test('se retira solo cuando la base confirma ese valor', () => {
    const settle = source.slice(source.indexOf('function _conciSettleSavedCells'));
    expect(settle.slice(0, 900)).toContain('_conciBorradorQuitarCelda(td)');
  });

  test('se reintenta al recuperar la conexión', () => {
    expect(source).toContain("window.addEventListener('online'");
    expect(source).toContain('_conciReintentarPendientes()');
  });
});
