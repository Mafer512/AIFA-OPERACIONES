/**
 * @jest-environment jsdom
 *
 * Reconexión del canal en vivo.
 *
 * Síntoma reportado: al principio se veía todo —los recuadros de quién estaba
 * capturando, las actualizaciones— y a los pocos minutos dejaba de verse dónde
 * modificaba el compañero.
 *
 * Un WebSocket se cae: un bache de red, el proxy de la oficina, la máquina que
 * se suspende. Eso era definitivo: al llegar CHANNEL_ERROR, TIMED_OUT o CLOSED
 * solo se marcaba _conciLiveReady = false y ahí se quedaba. Y como
 * _conciInitLiveCollab devuelve temprano si ya existe un canal, ni volviendo a
 * llamarla se recuperaba.
 *
 * Encima los cursores ajenos caducan a los 25 s sin latido, así que tras la
 * caída se apagaban solos y ya no volvía a encenderse ninguno.
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
  // Sin el "async" de delante, un await interno rompe al evaluar la función.
  if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const reconexiones = [];
const repintados = [];

const api = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'estado', 'reconexiones', 'repintados', `
  let _conciLiveReintentos = 0;
  let _conciReconexionTimer = null;
  let _conciVigilanciaLista = false;
  let _conciLiveChannel = null;
  let _conciLiveReady = estado.listo;
  let _conciFocoRemotoPorCliente = new Map();
  function _conciRepintarFocos() { repintados.push(1); }
  async function _conciInitLiveCollab() { reconexiones.push(Date.now()); }
  ${extraer('_conciProgramarReconexion')}
  ${extraer('_conciReconectarLive')}
  ${extraer('_conciVigilarConexionLive')}
  return {
    _conciProgramarReconexion, _conciReconectarLive, _conciVigilarConexionLive,
    intentos: () => _conciLiveReintentos,
    hayTimer: () => _conciReconexionTimer !== null,
    focos: () => _conciFocoRemotoPorCliente,
    reiniciar: () => {
      if (_conciReconexionTimer) clearTimeout(_conciReconexionTimer);
      _conciReconexionTimer = null;
      _conciLiveReintentos = 0;
      // _conciVigilanciaLista NO se reinicia: los escuchas ya registrados en
      // window siguen vivos entre pruebas, y volver a permitir el registro los
      // duplicaría. El guardián es justo lo que se quiere comprobar.
      _conciLiveChannel = null;
      _conciFocoRemotoPorCliente = new Map();
    },
  };
`)(document, window,
  (fn, ms) => setTimeout(fn, ms), (id) => clearTimeout(id),
  { listo: false }, reconexiones, repintados);

beforeEach(() => {
  jest.useFakeTimers();
  reconexiones.length = 0;
  repintados.length = 0;
  document.body.innerHTML = '<table id="table-conci-manifiestos"></table>';
  api.reiniciar();
});

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('el canal se levanta solo', () => {
  test('una caída programa un reintento', () => {
    api._conciProgramarReconexion();
    expect(api.hayTimer()).toBe(true);
  });

  test('reintenta de verdad al cumplirse la espera', () => {
    api._conciProgramarReconexion();
    jest.advanceTimersByTime(1000);
    expect(reconexiones).toHaveLength(1);
  });

  test('la espera crece si sigue sin conectar', () => {
    api._conciProgramarReconexion();          // 1 s
    jest.advanceTimersByTime(1000);
    api._conciProgramarReconexion();          // 2 s
    jest.advanceTimersByTime(1000);
    expect(reconexiones).toHaveLength(1);     // todavía no toca
    jest.advanceTimersByTime(1000);
    expect(reconexiones).toHaveLength(2);
  });

  test('la espera tiene tope de 30 segundos', () => {
    for (let i = 0; i < 12; i++) {
      api._conciProgramarReconexion();
      jest.advanceTimersByTime(30000);
    }
    expect(reconexiones.length).toBeGreaterThan(5);
  });

  test('no se apilan dos reintentos a la vez', () => {
    api._conciProgramarReconexion();
    api._conciProgramarReconexion();
    api._conciProgramarReconexion();
    jest.advanceTimersByTime(1000);
    expect(reconexiones).toHaveLength(1);
  });
});

describe('al reconectar', () => {
  test('se vuelve a levantar el canal', async () => {
    await api._conciReconectarLive();
    expect(reconexiones).toHaveLength(1);
  });

  test('se olvidan los cursores viejos', async () => {
    // Mientras estuvimos fuera pudieron moverse o irse: mostrar posiciones
    // viejas es peor que no mostrar ninguna.
    api.focos().set('otro', { rowId: '42', col: 'TOTAL PAX' });
    await api._conciReconectarLive();
    expect(api.focos().size).toBe(0);
    expect(repintados.length).toBeGreaterThan(0);
  });
});

describe('vigilancia', () => {
  test('volver a la pestaña dispara una comprobación', async () => {
    api._conciVigilarConexionLive();
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(reconexiones.length).toBeGreaterThan(0);
  });

  test('recuperar la red también', async () => {
    api._conciVigilarConexionLive();
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(reconexiones.length).toBeGreaterThan(0);
  });

  test('los escuchas se registran una sola vez', async () => {
    api._conciVigilarConexionLive();
    api._conciVigilarConexionLive();
    api._conciVigilarConexionLive();
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(reconexiones).toHaveLength(1);
  });

  test('sin la tabla en pantalla no se reconecta', async () => {
    document.body.innerHTML = '';
    api._conciVigilarConexionLive();
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(reconexiones).toHaveLength(0);
  });
});

// Cuerpo completo del callback de subscribe. Se corta en su cierre real y no a
// tantos caracteres: con un limite fijo, añadir un comentario dentro del
// callback empujaba el codigo fuera de la ventana y estas pruebas fallaban sin
// que nada se hubiera roto.
function cuerpoSubscribe() {
  const inicio = source.indexOf('channel.subscribe(async (status)');
  expect(inicio).toBeGreaterThan(-1);
  const fin = source.indexOf('\n    });\n', inicio);
  expect(fin).toBeGreaterThan(inicio);
  return source.slice(inicio, fin);
}

describe('integración en el módulo', () => {
  test('la caída del canal programa la reconexión', () => {
    const cuerpo = cuerpoSubscribe();
    expect(cuerpo).toContain("status === 'CHANNEL_ERROR'");
    expect(cuerpo).toContain('_conciProgramarReconexion();');
  });

  test('al reconectar se reanuncia el cursor propio', () => {
    expect(cuerpoSubscribe()).toContain('_conciEnviarFoco(_conciMiFocoActual.rowId');
  });

  test('el contador de intentos se reinicia al conectar', () => {
    expect(cuerpoSubscribe()).toContain('_conciLiveReintentos = 0;');
  });

  // El aviso tardio de un canal ya retirado reabria el ciclo de reconexion y
  // hacia parpadear la barra sin parar. Ver el comentario en script.js.
  test('un canal que ya no es el vigente no toca el estado de la conexión', () => {
    const cuerpo = cuerpoSubscribe();
    const guarda = cuerpo.indexOf('if (_conciLiveChannel !== channel) return;');
    expect(guarda).toBeGreaterThan(-1);
    // Antes de cualquier lectura del estado: si no, ya habria hecho daño.
    expect(guarda).toBeLessThan(cuerpo.indexOf("status === 'SUBSCRIBED'"));
  });

  test('el punto de la barra avisa cuando no hay conexión', () => {
    expect(source).toContain('conci-presencia-punto-caido');
    expect(source).toContain('Sin conexión en vivo');
    expect(html).toContain('.conci-presencia-punto.conci-presencia-punto-caido');
  });
});
