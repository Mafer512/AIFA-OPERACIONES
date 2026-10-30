/**
 * @jest-environment jsdom
 *
 * Tiempo real solo para quien está dentro del módulo.
 *
 * Antes había un canal único sobre todo public.* abierto para cualquiera con la
 * página abierta. Cada guardado en Conciliación hacía recargar a todas las
 * sesiones, trabajaran o no ahí, y esas recargas encimadas eran las lecturas
 * lentas de producción.
 *
 * Aquí corre js/realtime.js real contra un cliente de Supabase falso.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'realtime.js'), 'utf8');
const TABLA = 'Conciliación Manifiestos';

const DOM = `
  <div id="main-app" class="main-app hidden">
    <section id="dg-operaciones" hidden></section>
    <div id="operaciones-totales-section" class="content-section"></div>
    <div id="agenda-section" class="content-section"></div>
    <div id="hvac-reportes-section" class="content-section"></div>
    <div id="conci-reportes-section" class="content-section"></div>
    <div id="colaboradores-section" class="content-section active"></div>
    <div id="conciliacion-section" class="content-section">
      <div id="pane-conci-itinerario" class="tab-pane active"></div>
      <div id="pane-conci-comercial" class="tab-pane"></div>
    </div>
  </div>`;

function clienteFalso(opciones = {}) {
  const cliente = {
    canales: [],
    rechazadas: new Set(opciones.rechazadas || []),
    responderSolo: opciones.responderSolo !== false,
    channel(nombre) {
      const existente = cliente.canales.find(c => c.nombre === nombre && c.estado !== 'cerrado');
      if (existente) { existente.reutilizado = true; return existente; }
      const canal = {
        nombre, estado: 'nuevo', tabla: null, alCambio: null, avisar: null,
        on(tipo, filtro, cb) { canal.tabla = filtro.table; canal.alCambio = cb; return canal; },
        subscribe(cb) {
          canal.avisar = cb;
          canal.estado = 'abierto';
          if (cliente.rechazadas.has(canal.tabla)) cb('CHANNEL_ERROR');
          else if (cliente.responderSolo) cb('SUBSCRIBED');
          return canal;
        },
      };
      cliente.canales.push(canal);
      return canal;
    },
    removeChannel: jest.fn(async (canal) => {
      canal.estado = 'cerrado';
      if (canal.avisar) canal.avisar('CLOSED');
    }),
    abiertos: () => cliente.canales.filter(c => c.estado === 'abierto'),
    tablasAbiertas: () => cliente.abiertos().map(c => c.tabla).sort(),
  };
  return cliente;
}

const avanzar = (ms = 0) => jest.advanceTimersByTimeAsync(ms);

async function arrancar(cliente) {
  document.body.className = '';
  document.body.innerHTML = DOM;
  window.supabaseClient = cliente;
  window.eval(fuente);
  await avanzar(0);
}

async function iniciarSesion() {
  document.getElementById('main-app').classList.remove('hidden');
  await avanzar(0);
}

// El motor no depende de qué tablas lleve la aplicación: esto prueba módulos
// cualesquiera, aparte de los dos que hoy tienen tiempo real.
function registrarHvac() {
  window.rtManager.registrarModulo({
    clave: 'hvac', secciones: ['hvac-reportes'], tablas: ['reportes_hvac'],
    alCambiar: () => window.hvacReload(),
  });
}

async function irA(seccion) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`${seccion}-section`).classList.add('active');
  await avanzar(0);
}

async function abrirPestana(panel) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(panel).classList.add('active');
  document.dispatchEvent(new Event('shown.bs.tab'));
  await avanzar(0);
}

async function entrarAManifiestos() {
  await irA('conciliacion');
  await abrirPestana('pane-conci-comercial');
}

function simularVisibilidad(oculta) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculta });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => (oculta ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

// Cada carga de realtime.js deja escuchas en document y window: se retiran para
// que una prueba no siga viva durante la siguiente.
const escuchas = [];
const observadores = [];
const ObservadorReal = window.MutationObserver;
const agregarDoc = document.addEventListener.bind(document);
const agregarWin = window.addEventListener.bind(window);

beforeEach(() => {
  jest.useFakeTimers();
  window.MutationObserver = class extends ObservadorReal {
    constructor(cb) { super(cb); observadores.push(this); }
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(document, 'addEventListener').mockImplementation((t, f, o) => {
    escuchas.push([document, t, f]);
    agregarDoc(t, f, o);
  });
  jest.spyOn(window, 'addEventListener').mockImplementation((t, f, o) => {
    escuchas.push([window, t, f]);
    agregarWin(t, f, o);
  });
  window._conciHandleRemoteTableChange = jest.fn();
  window._conciNotificarManifiestosCambiaron = jest.fn();
  window._conciEntrarModuloManifiestos = jest.fn();
  window._conciSalirModuloManifiestos = jest.fn();
  window.hvacReload = jest.fn();
  window.agBarRefresh = jest.fn();
  window.genYoyReload = jest.fn();
  window.cargoYoyReload = jest.fn();
  window.comHistReload = jest.fn();
  window.refreshOperationsCardsData = jest.fn();
});

afterEach(() => {
  escuchas.splice(0).forEach(([obj, t, f]) => obj.removeEventListener(t, f));
  observadores.splice(0).forEach(o => o.disconnect());
  window.MutationObserver = ObservadorReal;
  delete document.hidden;
  delete document.visibilityState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('quién recibe cambios', () => {
  test('la pantalla de acceso no abre ningún canal', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await avanzar(5000);
    expect(cliente.canales).toHaveLength(0);
  });

  test('solo Conciliación Manifiestos y daily_operations abren canal', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    const secciones = ['operaciones-totales', 'agenda', 'hvac-reportes', 'conci-reportes', 'colaboradores', 'conciliacion'];
    for (const seccion of secciones) await irA(seccion);
    await abrirPestana('pane-conci-comercial');

    const tablas = [...new Set(cliente.canales.map(c => c.tabla))].sort();
    expect(tablas).toEqual([TABLA, 'daily_operations'].sort());
  });

  test('ya no existe la escucha sobre todo public.*', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    cliente.canales.forEach(c => expect(c.tabla).toBeTruthy());
    expect(fuente).not.toMatch(/event:\s*'\*',\s*schema:\s*'public'\s*\}/);
  });

  test('entrar suscribe; salir cancela y no queda nada abierto', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    expect(cliente.abiertos()).toHaveLength(0);

    await entrarAManifiestos();
    expect(cliente.tablasAbiertas()).toEqual([TABLA]);
    expect(window._conciEntrarModuloManifiestos).toHaveBeenCalledTimes(1);

    await irA('colaboradores');
    expect(cliente.abiertos()).toHaveLength(0);
    expect(window._conciSalirModuloManifiestos).toHaveBeenCalledTimes(1);
  });

  test('otra pestaña de Conciliación no es el módulo de Manifiestos', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await irA('conciliacion');
    expect(cliente.tablasAbiertas()).toEqual([]);
    await abrirPestana('pane-conci-comercial');
    expect(cliente.tablasAbiertas()).toEqual([TABLA]);
    await abrirPestana('pane-conci-itinerario');
    expect(cliente.tablasAbiertas()).toEqual([]);
  });

  test('el lanzador del menú deja la sección marcada activa, pero no está dentro', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    document.body.classList.add('navdeck-mode');
    await avanzar(0);
    expect(cliente.abiertos()).toHaveLength(0);
    document.body.classList.add('navdeck-active');
    await avanzar(0);
    expect(cliente.tablasAbiertas()).toEqual([TABLA]);
  });

  test('Dirección General ve Operaciones Totales en su Inicio: sí está dentro', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    document.getElementById('dg-operaciones').hidden = false;
    document.body.classList.add('navdeck-mode');
    await avanzar(0);
    expect(cliente.tablasAbiertas()).toEqual(['daily_operations']);
    await avanzar(3 * 60 * 1000);
    expect(window.genYoyReload).toHaveBeenCalled();
  });

  test('cerrar sesión cancela la suscripción', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    document.getElementById('main-app').classList.add('hidden');
    await avanzar(0);
    expect(cliente.abiertos()).toHaveLength(0);
  });
});

describe('dentro del módulo', () => {
  test('un cambio de otra persona llega sin recargar la página', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(700);
    window._conciHandleRemoteTableChange.mockClear();

    cliente.abiertos()[0].alCambio({ eventType: 'UPDATE' });
    await avanzar(700);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });

  test('una ráfaga de guardados es una sola recarga', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(700);
    window._conciHandleRemoteTableChange.mockClear();

    for (let i = 0; i < 20; i++) cliente.abiertos()[0].alCambio({ eventType: 'UPDATE' });
    await avanzar(700);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });

  test('un módulo no se entera de los cambios de otro', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    registrarHvac();
    await irA('hvac-reportes');
    expect(cliente.tablasAbiertas()).toEqual(['reportes_hvac']);

    cliente.abiertos()[0].alCambio({ eventType: 'INSERT' });
    await avanzar(700);
    expect(window.hvacReload).toHaveBeenCalledTimes(1);
    expect(window._conciHandleRemoteTableChange).not.toHaveBeenCalled();
    expect(window.genYoyReload).not.toHaveBeenCalled();
  });

  test('un aviso a medio camino se descarta al salir', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    registrarHvac();
    await irA('hvac-reportes');
    cliente.abiertos()[0].alCambio({ eventType: 'INSERT' });
    await irA('colaboradores');
    await avanzar(5000);
    expect(window.hvacReload).not.toHaveBeenCalled();
  });

  test('Reportes solo tira su caché: no pasa por la recarga de la tabla', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await irA('conci-reportes');
    await avanzar(700);
    expect(window._conciNotificarManifiestosCambiaron).toHaveBeenCalledTimes(1);
    expect(window._conciHandleRemoteTableChange).not.toHaveBeenCalled();
  });
});

describe('información al entrar', () => {
  test('Manifiestos sincroniza al quedar suscrito: cubre lo guardado durante la conexión', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(700);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });

  test('otro módulo no repite su primera carga, pero al volver sí se pone al día', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    registrarHvac();
    await irA('hvac-reportes');
    await avanzar(700);
    expect(window.hvacReload).not.toHaveBeenCalled();

    await irA('colaboradores');
    await irA('hvac-reportes');
    await avanzar(700);
    expect(window.hvacReload).toHaveBeenCalledTimes(1);
  });

  test('si el canal no contesta, la sincronización no se queda esperando', async () => {
    const cliente = clienteFalso({ responderSolo: false });
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(4700);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });
});

describe('pestaña oculta', () => {
  test('oculta un momento: conserva el canal y recarga una vez al volver', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(700);
    window._conciHandleRemoteTableChange.mockClear();

    simularVisibilidad(true);
    for (let i = 0; i < 50; i++) cliente.abiertos()[0].alCambio({ eventType: 'UPDATE' });
    await avanzar(10000);
    expect(window._conciHandleRemoteTableChange).not.toHaveBeenCalled();
    expect(cliente.abiertos()).toHaveLength(1);

    simularVisibilidad(false);
    await avanzar(700);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });

  test('pasado el minuto cuenta como fuera del módulo; al volver se reincorpora', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(700);
    window._conciHandleRemoteTableChange.mockClear();

    simularVisibilidad(true);
    await avanzar(61000);
    expect(cliente.abiertos()).toHaveLength(0);
    expect(window._conciSalirModuloManifiestos).toHaveBeenCalledTimes(1);

    simularVisibilidad(false);
    await avanzar(700);
    expect(cliente.tablasAbiertas()).toEqual([TABLA]);
    expect(window._conciEntrarModuloManifiestos).toHaveBeenCalledTimes(2);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });
});

describe('robustez de los canales', () => {
  test('una tabla fuera de la publicación no tumba a las demás', async () => {
    const cliente = clienteFalso({ rechazadas: ['tabla_c'] });
    await arrancar(cliente);
    await iniciarSesion();
    window.rtManager.registrarModulo({
      clave: 'varias', secciones: ['agenda'], tablas: ['tabla_a', 'tabla_b', 'tabla_c'], alCambiar: () => {},
    });
    await irA('agenda');
    expect(cliente.abiertos().filter(c => c.tabla === 'tabla_a')).toHaveLength(1);
    expect(cliente.abiertos().filter(c => c.tabla === 'tabla_b')).toHaveLength(1);
  });

  test('deja de insistir con una tabla que siempre rechaza el canal', async () => {
    const cliente = clienteFalso({ rechazadas: ['reportes_hvac'] });
    await arrancar(cliente);
    await iniciarSesion();
    registrarHvac();
    await irA('hvac-reportes');
    await avanzar(120000);
    const intentos = cliente.canales.length;
    expect(intentos).toBe(6);
    await avanzar(600000);
    expect(cliente.canales.length).toBe(intentos);
  });

  test('tras un corte se reconecta y se pone al día', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await avanzar(700);
    window._conciHandleRemoteTableChange.mockClear();

    cliente.abiertos()[0].avisar('CHANNEL_ERROR');
    await avanzar(2700);
    expect(cliente.removeChannel).toHaveBeenCalledTimes(1);
    expect(cliente.tablasAbiertas()).toEqual([TABLA]);
    expect(window._conciHandleRemoteTableChange).toHaveBeenCalledTimes(1);
  });

  test('un canal retirado no provoca reconexión con su aviso de CLOSED', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await entrarAManifiestos();
    await irA('colaboradores');
    const creados = cliente.canales.length;
    await avanzar(120000);
    expect(cliente.canales.length).toBe(creados);
  });

  test('con la red caída, un cierre que no termina no frena ni se reutiliza', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    // Así se ve removeChannel sin red: no contesta y el canal sigue registrado.
    cliente.removeChannel.mockImplementationOnce(() => new Promise(() => {}));
    await entrarAManifiestos();
    await irA('colaboradores');
    await entrarAManifiestos();
    await avanzar(1600);

    expect(cliente.canales).toHaveLength(2);
    expect(cliente.canales.some(c => c.reutilizado)).toBe(false);
    expect(cliente.canales[1].estado).toBe('abierto');
  });
});

describe('red de seguridad periódica', () => {
  test('solo refresca el módulo abierto', async () => {
    const cliente = clienteFalso();
    await arrancar(cliente);
    await iniciarSesion();
    await irA('colaboradores');
    await avanzar(3 * 60 * 1000);
    expect(window.genYoyReload).not.toHaveBeenCalled();

    await irA('operaciones-totales');
    window.genYoyReload.mockClear();
    await avanzar(3 * 60 * 1000);
    expect(window.genYoyReload).toHaveBeenCalledTimes(1);
  });
});
