/**
 * @jest-environment jsdom
 *
 * La barra de avatares: sin parpadeo y con el vuelo en el que trabaja cada uno.
 *
 * Las burbujas parpadeaban porque la barra se rehacía entera con innerHTML en
 * cada evento: cada sync de presencia, cada movimiento de cursor ajeno y cada
 * latido —que con varias personas conectadas llega cada pocos segundos—.
 * Rehacer el HTML destruye y recrea los nodos, y eso reinicia las animaciones
 * CSS desde cero.
 *
 * Ahora se compara contra lo último pintado y, si nada cambió, no se toca el
 * DOM; y cuando cambia, se parchea solo lo que cambió.
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

let presenceState = {};

const api = new Function('document', 'presencia', 'estado', `
  function escapeHTML(s) { return String(s ?? ''); }
  let _conciLiveClientId = 'yo';
  let _conciFocoRemotoPorCliente = new Map();
  let _conciFirmaPresencia = '';
  const _conciLiveChannel = { presenceState: () => presencia.state };
  Object.defineProperty(globalThis, '_conciLiveReady', { get: () => estado.listo, configurable: true });
  function _conciColorForUser() { return '#3949ab'; }
  ${extraer('_conciInitialsFromName')}
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciNormalizeEditableCellText')}
  // La burbuja propia toma su celda de aquí, no del mapa de cursores ajenos.
  let _conciMiFocoActual = { rowId: '', col: '' };
  ${extraer('_conciPresenciaConectados')}
  ${extraer('_conciVueloDeFila')}
  ${extraer('_conciTextoPresencia')}
  ${extraer('_conciRenderBarraPresencia')}
  return {
    _conciRenderBarraPresencia, _conciVueloDeFila, _conciTextoPresencia,
    focos: () => _conciFocoRemotoPorCliente,
    miFoco: (f) => { _conciMiFocoActual = f; },
    olvidarFirma: () => { _conciFirmaPresencia = ''; },
  };
`)(document, { get state() { return presenceState; } }, { listo: true });

function pintar() {
  document.body.innerHTML = `
    <span id="conci-presencia" class="d-none"></span>
    <table id="table-conci-manifiestos"><tbody>
      <tr data-row-id="42">
        <td data-col="# DE VUELO" data-raw="VB 9501">VB 9501</td>
        <td data-col="TOTAL PAX"></td>
      </tr>
    </tbody></table>`;
}

const cont = () => document.getElementById('conci-presencia');
const avatares = () => [...cont().querySelectorAll('.conci-presencia-avatar')];

beforeEach(() => {
  presenceState = {};
  document.body.innerHTML = '';
  api.focos().clear();
  api.olvidarFirma();
  api.miFoco({ rowId: '', col: '' });
});

describe('sin parpadeo', () => {
  test('repintar sin cambios no toca el DOM', () => {
    pintar();
    presenceState = { otra: [{ user: 'María Fernanda', color: '#e53935' }] };
    api._conciRenderBarraPresencia();

    const punto = cont().querySelector('.conci-presencia-punto');
    const avatar = avatares()[0];

    // Es lo que hacía parpadear: los latidos repintaban cada pocos segundos.
    for (let i = 0; i < 10; i++) api._conciRenderBarraPresencia();

    // Los MISMOS nodos siguen ahí: la animación nunca se reinició.
    expect(cont().querySelector('.conci-presencia-punto')).toBe(punto);
    expect(avatares()[0]).toBe(avatar);
  });

  test('el punto se conserva aunque entre alguien nuevo', () => {
    pintar();
    presenceState = { a: [{ user: 'Ana' }] };
    api._conciRenderBarraPresencia();
    const punto = cont().querySelector('.conci-presencia-punto');

    presenceState = { a: [{ user: 'Ana' }], b: [{ user: 'Luis' }] };
    api._conciRenderBarraPresencia();

    expect(cont().querySelector('.conci-presencia-punto')).toBe(punto);
    expect(avatares()).toHaveLength(2);
  });

  test('quien se va desaparece de la barra', () => {
    pintar();
    presenceState = { a: [{ user: 'Ana' }], b: [{ user: 'Luis' }] };
    api._conciRenderBarraPresencia();
    expect(avatares()).toHaveLength(2);

    presenceState = { a: [{ user: 'Ana' }] };
    api._conciRenderBarraPresencia();
    expect(avatares()).toHaveLength(1);
    expect(avatares()[0].textContent).toBe('ANA');
  });

  test('cambiar de celda actualiza el aviso sin recrear el avatar', () => {
    pintar();
    presenceState = { otra: [{ user: 'Ana' }] };
    api.focos().set('otra', { rowId: '42', col: 'TOTAL PAX' });
    api._conciRenderBarraPresencia();
    const avatar = avatares()[0];

    api.focos().set('otra', { rowId: '42', col: 'OBSERVACIONES' });
    api._conciRenderBarraPresencia();

    expect(avatares()[0]).toBe(avatar);
    expect(avatar.title).toContain('OBSERVACIONES');
  });
});

describe('el vuelo en el que trabaja cada uno', () => {
  test('el aviso dice la columna y el número de vuelo', () => {
    pintar();
    presenceState = { otra: [{ user: 'María Fernanda' }] };
    api.focos().set('otra', { rowId: '42', col: 'TOTAL PAX' });
    api._conciRenderBarraPresencia();

    expect(avatares()[0].title).toBe('María Fernanda — capturando TOTAL PAX del vuelo VB 9501');
  });

  test('si la fila no está a la vista, se dice solo la columna', () => {
    pintar();
    presenceState = { otra: [{ user: 'Ana' }] };
    api.focos().set('otra', { rowId: '999', col: 'TOTAL PAX' });
    api._conciRenderBarraPresencia();

    expect(avatares()[0].title).toBe('Ana — capturando TOTAL PAX');
  });

  test('quien solo mira, lo dice', () => {
    pintar();
    presenceState = { otra: [{ user: 'Ana' }] };
    api._conciRenderBarraPresencia();
    expect(avatares()[0].title).toBe('Ana — viendo la tabla');
  });

  test('a uno mismo se le marca como (tú)', () => {
    pintar();
    presenceState = { yo: [{ user: 'Isaac Lopez' }] };
    api._conciRenderBarraPresencia();
    expect(avatares()[0].title).toContain('(tú)');
  });

  test('la burbuja propia también dice qué está capturando', () => {
    // Antes decía siempre "viendo la tabla": el aviso salía del mapa de
    // cursores ajenos, que a propósito nunca contiene el propio. Quien miraba
    // su propia burbuja para comprobar que esto servía, no veía nada.
    pintar();
    presenceState = { yo: [{ user: 'Isaac Lopez' }] };
    api.miFoco({ rowId: '42', col: 'TOTAL PAX' });
    api._conciRenderBarraPresencia();

    expect(avatares()[0].title).toBe('Isaac Lopez (tú) — capturando TOTAL PAX del vuelo VB 9501');
  });

  test('el número de vuelo se lee de la fila correcta', () => {
    pintar();
    expect(api._conciVueloDeFila('42')).toBe('VB 9501');
    expect(api._conciVueloDeFila('999')).toBe('');
    expect(api._conciVueloDeFila('')).toBe('');
  });
});

describe('lo que ya funcionaba sigue igual', () => {
  test('el anillo marca a quien está capturando', () => {
    pintar();
    presenceState = { a: [{ user: 'Ana' }], b: [{ user: 'Luis' }] };
    api.focos().set('b', { rowId: '42', col: 'TOTAL PAX' });
    api._conciRenderBarraPresencia();

    const [ana, luis] = avatares();
    expect(ana.classList.contains('conci-presencia-activo')).toBe(false);
    expect(luis.classList.contains('conci-presencia-activo')).toBe(true);
  });

  test('con más de seis personas resume el resto', () => {
    pintar();
    presenceState = {};
    'ABCDEFGH'.split('').forEach((l, i) => { presenceState[`c${i}`] = [{ user: `Persona ${l}` }]; });
    api._conciRenderBarraPresencia();

    const mas = cont().querySelector('.conci-presencia-mas');
    expect(mas.textContent).toBe('+2');
    expect(avatares()).toHaveLength(7);
  });

  test('al bajar de seis, el resumen desaparece', () => {
    pintar();
    presenceState = {};
    'ABCDEFGH'.split('').forEach((l, i) => { presenceState[`c${i}`] = [{ user: `Persona ${l}` }]; });
    api._conciRenderBarraPresencia();
    expect(cont().querySelector('.conci-presencia-mas')).not.toBeNull();

    presenceState = { c0: [{ user: 'Persona A' }] };
    api._conciRenderBarraPresencia();
    expect(cont().querySelector('.conci-presencia-mas')).toBeNull();
    expect(avatares()).toHaveLength(1);
  });

  test('sin nadie conectado la barra se esconde', () => {
    pintar();
    api._conciRenderBarraPresencia();
    expect(cont().classList.contains('d-none')).toBe(true);
  });

  test('un nombre con HTML no se inyecta', () => {
    pintar();
    presenceState = { otra: [{ user: '<img src=x onerror=alert(1)>' }] };
    api._conciRenderBarraPresencia();
    expect(cont().querySelector('img')).toBeNull();
  });
});
