/**
 * @jest-environment jsdom
 *
 * Cursores de los demás: una sola fuente y un solo pintor.
 *
 * Había dos mecanismos peleándose. El broadcast pintaba el recuadro al instante
 * y el barrido de presencia lo borraba, porque empezaba con
 *
 *     if (!_conciRemotePresenceByCell.size || !_conciCellStillClaimed(td))
 *
 * y ese "||" corta antes de preguntar: con el mapa de presencia vacío —que es
 * lo normal, porque presence tarda en propagarse— limpiaba TODAS las celdas sin
 * llegar a comprobar si alguien las tenía tomadas. El resultado era que el
 * resaltado no aparecía casi nunca.
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

const enviados = [];

const api = new Function('document', 'enviados', `
  let _conciRemotePresenceByCell = new Map();
  let _conciFocoRemotoPorCliente = new Map();
  let _conciMiFocoActual = { rowId: '', col: '' };
  let _conciLiveClientId = 'yo';
  let _conciLiveDisplayName = 'Ana';
  let _conciLiveColor = '#00897b';
  let _conciLiveReady = true;
  const _conciLiveChannel = { send: (m) => enviados.push(m) };
  function _conciColorForUser() { return '#1976d2'; }
  function _conciRenderBarraPresencia() {}
  ${constante('_CONCI_CURSOR_VENCE_MS')}
  ${extraer('_conciFindLiveCell')}
  ${extraer('_conciCursoresVigentes')}
  ${extraer('_conciRepintarFocos')}
  ${extraer('_conciApplyRemotePresenceHighlights')}
  ${extraer('_conciCellStillClaimed')}
  ${extraer('_conciBroadcastFoco')}
  ${extraer('_conciHandleRemoteFoco')}
  return {
    _conciRepintarFocos, _conciApplyRemotePresenceHighlights, _conciHandleRemoteFoco,
    _conciCellStillClaimed, _conciBroadcastFoco,
    presencia: (m) => { _conciRemotePresenceByCell = m; },
    focos: () => _conciFocoRemotoPorCliente,
    miFoco: () => _conciMiFocoActual,
  };
`)(document, enviados);

function pintarTabla() {
  document.body.innerHTML = `
    <table id="table-conci-manifiestos"><tbody>
      <tr data-row-id="42"><td data-col="TOTAL PAX"></td><td data-col="OBSERVACIONES"></td></tr>
      <tr data-row-id="43"><td data-col="TOTAL PAX"></td><td data-col="OBSERVACIONES"></td></tr>
    </tbody></table>`;
}

const celda = (rowId, col) =>
  document.querySelector(`tr[data-row-id="${rowId}"] td[data-col="${col}"]`);
const resaltada = (rowId, col) =>
  celda(rowId, col).classList.contains('conci-cell-remote-editing');

beforeEach(() => {
  enviados.length = 0;
  api.presencia(new Map());
  api.focos().clear();
  document.body.innerHTML = '';
});

describe('el bug que hacía invisible el resaltado', () => {
  test('el barrido de presencia NO borra lo que el broadcast acaba de pintar', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María' });
    expect(resaltada('42', 'TOTAL PAX')).toBe(true);

    // Llega el sync de presencia con el mapa vacío: es el momento exacto en que
    // antes se apagaba todo.
    api.presencia(new Map());
    api._conciApplyRemotePresenceHighlights();

    expect(resaltada('42', 'TOTAL PAX')).toBe(true);
  });

  test('repintar muchas veces no lo apaga', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María' });
    for (let i = 0; i < 5; i++) api._conciRepintarFocos();
    expect(resaltada('42', 'TOTAL PAX')).toBe(true);
  });
});

describe('pintado', () => {
  test('marca la celda con el color y el nombre de quien está ahí', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({
      clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María Fernanda', color: '#e53935',
    });
    const td = celda('42', 'TOTAL PAX');
    expect(td.style.getPropertyValue('--conci-remote-color')).toBe('#e53935');
    expect(td.querySelector('.conci-remote-badge').textContent).toBe('María');
    expect(td.title).toContain('María Fernanda');
  });

  test('al moverse, la celda anterior se apaga y se enciende la nueva', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María' });
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '43', col: 'OBSERVACIONES', user: 'María' });

    expect(resaltada('42', 'TOTAL PAX')).toBe(false);
    expect(resaltada('43', 'OBSERVACIONES')).toBe(true);
  });

  test('dos personas en celdas distintas se ven las dos', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'a', rowId: '42', col: 'TOTAL PAX', user: 'Ana' });
    api._conciHandleRemoteFoco({ clientId: 'b', rowId: '43', col: 'OBSERVACIONES', user: 'Luis' });

    expect(resaltada('42', 'TOTAL PAX')).toBe(true);
    expect(resaltada('43', 'OBSERVACIONES')).toBe(true);
  });

  test('la presencia sirve de refuerzo cuando se perdió el broadcast', () => {
    pintarTabla();
    api.presencia(new Map([['42|OBSERVACIONES', [{ user: 'Luis', color: '#8e24aa' }]]]));
    api._conciRepintarFocos();
    expect(resaltada('42', 'OBSERVACIONES')).toBe(true);
  });

  test('no se pinta encima de la celda que uno tiene abierta', () => {
    pintarTabla();
    celda('42', 'TOTAL PAX').classList.add('conci-cell-active');
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María' });
    expect(resaltada('42', 'TOTAL PAX')).toBe(false);
  });

  test('cuando alguien suelta la celda, se apaga', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María' });
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '', col: '' });
    expect(resaltada('42', 'TOTAL PAX')).toBe(false);
  });
});

describe('un cursor que deja de latir se da por ido', () => {
  test('una pestaña cerrada de golpe no deja el recuadro encendido', () => {
    pintarTabla();
    api.focos().set('fantasma', {
      rowId: '42', col: 'TOTAL PAX', user: 'Se fue', color: '#111',
      ts: Date.now() - 60000,   // un minuto sin latir
    });
    api._conciRepintarFocos();

    expect(resaltada('42', 'TOTAL PAX')).toBe(false);
    expect(api.focos().has('fantasma')).toBe(false);
  });

  test('un cursor reciente se conserva', () => {
    pintarTabla();
    api.focos().set('vivo', {
      rowId: '42', col: 'TOTAL PAX', user: 'Ana', color: '#111', ts: Date.now(),
    });
    api._conciRepintarFocos();
    expect(resaltada('42', 'TOTAL PAX')).toBe(true);
  });
});

describe('el cursor propio', () => {
  test('se recuerda para poder reanunciarlo en cada latido', () => {
    api._conciBroadcastFoco('42', 'TOTAL PAX');
    expect(api.miFoco()).toEqual({ rowId: '42', col: 'TOTAL PAX' });
  });

  test('al soltar la celda se recuerda que no hay cursor', () => {
    api._conciBroadcastFoco('42', 'TOTAL PAX');
    api._conciBroadcastFoco(null, null);
    expect(api.miFoco()).toEqual({ rowId: '', col: '' });
  });

  test('el aviso propio se ignora al recibirlo', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'yo', rowId: '42', col: 'TOTAL PAX', user: 'Ana' });
    expect(resaltada('42', 'TOTAL PAX')).toBe(false);
  });
});

describe('integración en el módulo', () => {
  test('hay un solo pintor de cursores', () => {
    expect((source.match(/function _conciRepintarFocos\(/g) || [])).toHaveLength(1);
  });

  test('ya no existe el corto circuito que apagaba todo', () => {
    // Sin comentarios: el bloque nuevo cita esa línea a propósito para explicar
    // qué estaba mal, y eso no debe hacer fallar la comprobación.
    const codigo = source
      .split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(codigo).not.toContain('!_conciRemotePresenceByCell.size || !_conciCellStillClaimed');
  });

  test('el latido se enciende al conectar el canal', () => {
    expect(source).toContain('_conciIniciarLatidoFoco();');
    expect(source).toContain('const _CONCI_LATIDO_MS');
  });

  test('la posición se anuncia aunque la celda no abra editor', () => {
    const activar = source.slice(source.indexOf('function _conciActivateCellEditor'));
    const cabeza = activar.slice(0, activar.indexOf('_conciBeginCellPresence'));
    expect(cabeza).toContain('_conciBroadcastFoco(rowIdFoco');
  });
});
