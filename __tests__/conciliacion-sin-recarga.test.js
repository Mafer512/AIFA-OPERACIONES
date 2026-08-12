/**
 * @jest-environment jsdom
 *
 * Sincronización sin recargar la tabla.
 *
 * Antes, CUALQUIER guardado de cualquier persona disparaba una recarga
 * completa: se volvía a consultar la base, se mostraba "Cargando
 * manifiestos..." y se reconstruía el tbody entero. Con varias personas
 * capturando a la vez, la pantalla se bloqueaba cada pocos segundos encima de
 * lo que uno estaba escribiendo.
 *
 * Ahora el cambio que llega se aplica en las celdas que cambiaron, sin volver a
 * pedir nada. La recarga completa queda para lo que de verdad la necesita.
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

const recalculadas = [];
const enviados = [];

const api = new Function('document', 'recalculadas', 'enviados', `
  ${constante('_CONCI_VENTANA_PARCHE_MS')}
  let _conciUltimoParcheTs = 0;
  let _conciEditFechaCol = 'FECHA';
  let _conciEditFallbackYear = 2026;
  let _conciLiveReady = true;
  let _conciLiveDisplayName = 'Ana';
  let _conciLiveColor = '#00897b';
  let _conciLiveClientId = 'yo';
  let _conciFocoRemotoPorCliente = new Map();
  let _conciRemotePresenceByCell = new Map();
  const _conciLiveChannel = { send: (m) => enviados.push(m) };
  function _conciFormatDisplayValue(col, valor) { return String(valor ?? ''); }
  function _conciReadLiveTableRow() { return {}; }
  function _conciRefreshCalculatedCellsForRow(tr) { recalculadas.push(tr); }
  function _conciRefreshMatriculaValidationForRow() {}
  function _conciCellStillClaimed() { return false; }
  ${extraer('_conciFindLiveCell')}
  ${extraer('_conciAplicarCambioRemoto')}
  ${extraer('_conciRecargaYaCubierta')}
  ${extraer('_conciBroadcastFoco')}
  ${extraer('_conciPintarFocoRemoto')}
  ${extraer('_conciQuitarFocoRemoto')}
  ${extraer('_conciHandleRemoteFoco')}
  return {
    _conciAplicarCambioRemoto, _conciRecargaYaCubierta, _conciBroadcastFoco,
    _conciHandleRemoteFoco,
    marcarParche: () => { _conciUltimoParcheTs = Date.now(); },
    envejecerParche: () => { _conciUltimoParcheTs = Date.now() - 10000; },
  };
`)(document, recalculadas, enviados);

function pintarTabla() {
  document.body.innerHTML = `
    <table id="table-conci-manifiestos"><tbody>
      <tr data-row-id="42">
        <td data-col="TOTAL PAX" data-raw="150">150</td>
        <td data-col="OBSERVACIONES" data-raw="">​</td>
      </tr>
    </tbody></table>`;
}

const celda = (col) => document.querySelector(`tr[data-row-id="42"] td[data-col="${col}"]`);

beforeEach(() => {
  recalculadas.length = 0;
  enviados.length = 0;
  document.body.innerHTML = '';
});

describe('aplicar el cambio en su celda', () => {
  test('actualiza el valor sin recargar nada', () => {
    pintarTabla();
    expect(api._conciAplicarCambioRemoto('42', 'TOTAL PAX', '178')).toBe(true);
    const td = celda('TOTAL PAX');
    expect(td.textContent).toBe('178');
    expect(td.dataset.raw).toBe('178');
    expect(td.dataset.origRaw).toBe('178');
  });

  test('recalcula las fórmulas de esa fila', () => {
    pintarTabla();
    api._conciAplicarCambioRemoto('42', 'TOTAL PAX', '178');
    expect(recalculadas).toHaveLength(1);
  });

  test('no toca una celda que esta persona tiene abierta', () => {
    pintarTabla();
    celda('TOTAL PAX').classList.add('conci-cell-active');
    api._conciAplicarCambioRemoto('42', 'TOTAL PAX', '999');
    expect(celda('TOTAL PAX').textContent).toBe('150');
  });

  test('no pisa una captura propia sin guardar', () => {
    pintarTabla();
    celda('TOTAL PAX').dataset.dirty = '1';
    api._conciAplicarCambioRemoto('42', 'TOTAL PAX', '999');
    expect(celda('TOTAL PAX').textContent).toBe('150');
  });

  test('una fila que no está a la vista pide la recarga de siempre', () => {
    pintarTabla();
    expect(api._conciAplicarCambioRemoto('99', 'TOTAL PAX', '178')).toBe(false);
  });

  test('conserva la etiqueta de autoría si ya estaba puesta', () => {
    pintarTabla();
    const chip = document.createElement('span');
    chip.className = 'conci-estela-autor';
    chip.textContent = 'María';
    celda('TOTAL PAX').appendChild(chip);

    api._conciAplicarCambioRemoto('42', 'TOTAL PAX', '178');

    expect(celda('TOTAL PAX').querySelector('.conci-estela-autor')).not.toBeNull();
    expect(celda('TOTAL PAX').textContent).toContain('178');
  });
});

describe('la recarga completa se evita', () => {
  test('tras aplicar un cambio, la recarga que anuncia Postgres sobra', () => {
    api.marcarParche();
    expect(api._conciRecargaYaCubierta()).toBe(true);
  });

  test('pasada la ventana, la recarga vuelve a hacer falta', () => {
    api.envejecerParche();
    expect(api._conciRecargaYaCubierta()).toBe(false);
  });
});

describe('foco inmediato', () => {
  test('abrir una celda se anuncia al instante por broadcast', () => {
    api._conciBroadcastFoco('42', 'TOTAL PAX');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      event: 'cell-focus',
      payload: { rowId: '42', col: 'TOTAL PAX', user: 'Ana' },
    });
  });

  test('cerrarla anuncia que quedó libre', () => {
    api._conciBroadcastFoco(null, null);
    expect(enviados[0].payload).toMatchObject({ rowId: '', col: '' });
  });

  test('el resaltado ajeno aparece de inmediato', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({
      clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María', color: '#e53935',
    });
    const td = celda('TOTAL PAX');
    expect(td.classList.contains('conci-cell-remote-editing')).toBe(true);
    expect(td.style.getPropertyValue('--conci-remote-color')).toBe('#e53935');
    expect(td.querySelector('.conci-remote-badge').textContent).toBe('María');
  });

  test('al moverse de celda, la anterior se apaga sola', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'TOTAL PAX', user: 'María' });
    api._conciHandleRemoteFoco({ clientId: 'otro', rowId: '42', col: 'OBSERVACIONES', user: 'María' });

    expect(celda('TOTAL PAX').classList.contains('conci-cell-remote-editing')).toBe(false);
    expect(celda('OBSERVACIONES').classList.contains('conci-cell-remote-editing')).toBe(true);
  });

  test('el aviso propio se ignora: uno no se resalta a sí mismo', () => {
    pintarTabla();
    api._conciHandleRemoteFoco({ clientId: 'yo', rowId: '42', col: 'TOTAL PAX', user: 'Ana' });
    expect(celda('TOTAL PAX').classList.contains('conci-cell-remote-editing')).toBe(false);
  });
});

describe('integración en el módulo', () => {
  test('el indicador de carga no se muestra en una sincronización remota', () => {
    expect(source).toContain('const cargaSilenciosa = config.fromRemoteSync === true;');
    expect(source).toContain('if (loading && !cargaSilenciosa)');
  });

  test('el refresco diferido se salta cuando el cambio ya se aplicó', () => {
    const fn = source.slice(source.indexOf('function _conciMaybeApplyDeferredRemoteRefresh'));
    expect(fn.slice(0, 600)).toContain('_conciRecargaYaCubierta()');
  });

  test('el aviso de guardado viaja con los valores', () => {
    expect(source).toContain('valores: valores || {}');
    expect(source).toContain('_conciBroadcastCambioGuardado(tr.dataset.rowId, [...confirmedColumns], valoresConfirmados)');
  });

  test('el foco se anuncia por broadcast además de por presencia', () => {
    const fn = source.slice(source.indexOf('function _conciBeginCellPresence'));
    expect(fn.slice(0, 600)).toContain('_conciBroadcastFoco(');
  });

  test('el canal escucha el foco ajeno', () => {
    expect(source).toContain("channel.on('broadcast', { event: 'cell-focus' }");
  });
});
