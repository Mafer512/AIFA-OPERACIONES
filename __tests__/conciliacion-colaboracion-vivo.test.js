/**
 * @jest-environment jsdom
 *
 * Colaboración en vivo en Conciliación > Manifiestos.
 *
 * El módulo ya resaltaba la celda que otra persona tiene abierta y mostraba en
 * vivo lo que iba tecleando. Faltaban las dos mitades que hacen que se sienta
 * como trabajar en una hoja compartida:
 *
 *   1. Saber quién está en la pestaña ahora mismo.
 *   2. Ver el rastro de lo que acaba de cambiar y de quién fue. Antes, cuando
 *      un compañero guardaba, la tabla se refrescaba en silencio: el dato
 *      cambiaba delante de los ojos sin decir quién ni dónde.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

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

let presenceState = {};
const enviados = [];

const api = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'presencia', 'enviados', `
  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  ${extraer('_conciInitialsFromName')}
  ${extraer('_conciColorForUser')}
  ${extraer('_conciFindLiveCell')}
  ${constante('_CONCI_LIVE_COLORS')}
  ${constante('_CONCI_ESTELA_MS')}
  ${constante('_conciEstelaPorCelda')}
  let _conciLiveClientId = 'yo';
  let _conciLiveDisplayName = 'Isaac Lopez';
  let _conciLiveColor = '#3949ab';
  let _conciLiveReady = true;
  // El detalle "capturando X" ya no viaja en la presencia (reanunciarla en cada
  // celda era la operación más cara del canal): sale del mapa de cursores.
  let _conciFocoRemotoPorCliente = new Map();
  const _conciLiveChannel = {
    presenceState: () => presencia.state,
    send: (m) => enviados.push(m),
  };
  ${extraer('_conciPresenciaConectados')}
  ${extraer('_conciRenderBarraPresencia')}
  ${extraer('_conciBroadcastCambioGuardado')}
  ${extraer('_conciHandleRemoteCellSaved')}
  ${extraer('_conciMarcarEstela')}
  ${extraer('_conciPintarEstela')}
  ${extraer('_conciRepintarEstelas')}
  return {
    _conciPresenciaConectados, _conciRenderBarraPresencia,
    _conciBroadcastCambioGuardado, _conciHandleRemoteCellSaved,
    _conciRepintarEstelas, _conciEstelaPorCelda,
  };
`)(document, window, setTimeout, clearTimeout, { get state() { return presenceState; } }, enviados);

function pintarTabla() {
  document.body.innerHTML = `
    <span id="conci-presencia" class="d-none"></span>
    <table id="table-conci-manifiestos"><tbody>
      <tr data-row-id="42"><td data-col="TOTAL PAX"></td><td data-col="OBSERVACIONES"></td></tr>
    </tbody></table>`;
}

const celda = (col) => document.querySelector(`tr[data-row-id="42"] td[data-col="${col}"]`);

beforeEach(() => {
  presenceState = {};
  enviados.length = 0;
  api._conciEstelaPorCelda.clear();
  document.body.innerHTML = '';
});

describe('quién está conectado', () => {
  test('se lista a uno mismo y a los demás', () => {
    presenceState = {
      yo: [{ user: 'Isaac Lopez', color: '#3949ab' }],
      otra: [{ user: 'María Fernanda', color: '#e53935', rowId: '42', col: 'TOTAL PAX' }],
    };
    const gente = api._conciPresenciaConectados();
    expect(gente).toHaveLength(2);
    expect(gente[0]).toMatchObject({ nombre: 'Isaac Lopez', esYo: true });
    expect(gente[1]).toMatchObject({ nombre: 'María Fernanda', editando: 'TOTAL PAX' });
  });

  test('uno mismo va primero para que el orden no baile', () => {
    presenceState = {
      otra: [{ user: 'Ana' }],
      yo: [{ user: 'Isaac Lopez' }],
    };
    expect(api._conciPresenciaConectados()[0].esYo).toBe(true);
  });

  test('una persona con dos pestañas aparece una sola vez, con la que captura', () => {
    presenceState = {
      a: [{ user: 'Ana' }],
      b: [{ user: 'Ana', rowId: '42', col: 'INFANTES' }],
    };
    const gente = api._conciPresenciaConectados();
    expect(gente).toHaveLength(1);
    expect(gente[0].editando).toBe('INFANTES');
  });

  test('dibuja un avatar por persona con sus iniciales', () => {
    pintarTabla();
    presenceState = {
      yo: [{ user: 'Isaac Lopez', color: '#3949ab' }],
      otra: [{ user: 'María Fernanda', color: '#e53935', rowId: '42', col: 'TOTAL PAX' }],
    };
    api._conciRenderBarraPresencia();

    const cont = document.getElementById('conci-presencia');
    expect(cont.classList.contains('d-none')).toBe(false);
    const avatares = cont.querySelectorAll('.conci-presencia-avatar');
    expect(avatares).toHaveLength(2);
    expect(avatares[1].textContent).toBe('MF');
    expect(avatares[1].getAttribute('title')).toContain('capturando TOTAL PAX');
  });

  test('marca con un anillo a quien está capturando', () => {
    pintarTabla();
    presenceState = {
      yo: [{ user: 'Isaac Lopez' }],
      otra: [{ user: 'Ana', rowId: '42', col: 'TOTAL PAX' }],
    };
    api._conciRenderBarraPresencia();
    const avatares = document.querySelectorAll('.conci-presencia-avatar');
    expect(avatares[0].classList.contains('conci-presencia-activo')).toBe(false);
    expect(avatares[1].classList.contains('conci-presencia-activo')).toBe(true);
  });

  test('con más de seis personas resume el resto', () => {
    pintarTabla();
    presenceState = {};
    'ABCDEFGH'.split('').forEach((letra, i) => {
      presenceState[`c${i}`] = [{ user: `Persona ${letra}` }];
    });
    api._conciRenderBarraPresencia();
    const mas = document.querySelector('.conci-presencia-mas');
    expect(mas).not.toBeNull();
    expect(mas.textContent).toBe('+2');
  });

  test('sin nadie conectado la barra se esconde', () => {
    pintarTabla();
    api._conciRenderBarraPresencia();
    expect(document.getElementById('conci-presencia').classList.contains('d-none')).toBe(true);
  });

  test('un nombre con caracteres especiales no se inyecta como HTML', () => {
    pintarTabla();
    presenceState = { otra: [{ user: '<img src=x onerror=alert(1)>' }] };
    api._conciRenderBarraPresencia();
    expect(document.querySelector('#conci-presencia img')).toBeNull();
  });
});

describe('aviso de lo que se guardó', () => {
  test('anuncia fila, columnas y autor', () => {
    api._conciBroadcastCambioGuardado('42', ['TOTAL PAX', 'OBSERVACIONES']);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      type: 'broadcast',
      event: 'cell-saved',
      payload: { rowId: '42', cols: ['TOTAL PAX', 'OBSERVACIONES'], user: 'Isaac Lopez' },
    });
  });

  test('no repite una columna listada dos veces', () => {
    api._conciBroadcastCambioGuardado('42', ['TOTAL PAX', 'TOTAL PAX']);
    expect(enviados[0].payload.cols).toEqual(['TOTAL PAX']);
  });

  test('sin columnas no manda nada', () => {
    api._conciBroadcastCambioGuardado('42', []);
    expect(enviados).toHaveLength(0);
  });
});

describe('rastro de un cambio ajeno', () => {
  test('tiñe la celda con el color de quien la cambió y pone su nombre', () => {
    pintarTabla();
    api._conciHandleRemoteCellSaved({
      rowId: '42', cols: ['TOTAL PAX'], user: 'María Fernanda', color: '#e53935',
    });
    const td = celda('TOTAL PAX');
    expect(td.classList.contains('conci-cell-estela')).toBe(true);
    expect(td.style.getPropertyValue('--conci-estela-color')).toBe('#e53935');
    expect(td.querySelector('.conci-estela-autor').textContent).toBe('María');
    expect(td.title).toContain('acaba de cambiar');
  });

  test('marca todas las columnas del mismo guardado', () => {
    pintarTabla();
    api._conciHandleRemoteCellSaved({
      rowId: '42', cols: ['TOTAL PAX', 'OBSERVACIONES'], user: 'Ana', color: '#00897b',
    });
    expect(celda('TOTAL PAX').classList.contains('conci-cell-estela')).toBe(true);
    expect(celda('OBSERVACIONES').classList.contains('conci-cell-estela')).toBe(true);
  });

  test('no pisa una celda que uno tiene abierta', () => {
    pintarTabla();
    celda('TOTAL PAX').classList.add('conci-cell-active');
    api._conciHandleRemoteCellSaved({ rowId: '42', cols: ['TOTAL PAX'], user: 'Ana' });
    expect(celda('TOTAL PAX').classList.contains('conci-cell-estela')).toBe(false);
  });

  test('el rastro sobrevive a que la tabla se vuelva a dibujar', () => {
    // Un refresco remoto reconstruye el tbody entero.
    pintarTabla();
    api._conciHandleRemoteCellSaved({ rowId: '42', cols: ['TOTAL PAX'], user: 'Ana', color: '#00897b' });
    pintarTabla();
    expect(celda('TOTAL PAX').classList.contains('conci-cell-estela')).toBe(false);

    api._conciRepintarEstelas();
    expect(celda('TOTAL PAX').classList.contains('conci-cell-estela')).toBe(true);
  });

  test('un aviso sin columnas no hace nada', () => {
    pintarTabla();
    expect(() => api._conciHandleRemoteCellSaved({ rowId: '42' })).not.toThrow();
    expect(document.querySelectorAll('.conci-cell-estela')).toHaveLength(0);
  });
});

describe('integración en el módulo', () => {
  test('el canal escucha los cambios guardados', () => {
    expect(source).toContain("channel.on('broadcast', { event: 'cell-saved' }");
  });

  test('se avisa después de que la base confirma, no antes', () => {
    const guardado = source.slice(source.indexOf('async function _conciAutoSaveRow'));
    const i = guardado.indexOf('_conciBroadcastCambioGuardado');
    expect(i).toBeGreaterThan(-1);
    // La llamada va después de settleSavedCells(confirmedColumns).
    expect(guardado.lastIndexOf('settleSavedCells(confirmedColumns)', i)).toBeGreaterThan(-1);
  });

  test('la barra se redibuja al sincronizar presencia', () => {
    const sync = source.slice(source.indexOf('function _conciHandlePresenceSync'));
    expect(sync.slice(0, 900)).toContain('_conciRenderBarraPresencia()');
  });

  test('la página tiene el contenedor de la barra', () => {
    expect(html).toContain('id="conci-presencia"');
  });

  test('se respeta a quien pidió menos movimiento en pantalla', () => {
    expect(html).toContain('prefers-reduced-motion');
  });
});
