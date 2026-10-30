/**
 * @jest-environment jsdom
 *
 * Conciliación Manifiestos con tiempo real por módulo.
 *
 * El síntoma de producción: cada guardado hacía recargar a todas las sesiones
 * abiertas. La tabla es HTML estático, así que "existe en el DOM" era siempre
 * cierto; y quien nunca abrió el módulo tiene los filtros en blanco, por lo que
 * su recarga se traía todos los vuelos y el año completo de manifiestos.
 *
 * Las funciones se toman de script.js tal cual. Lo demás del módulo se sustituye
 * por funciones vacías: aquí importa qué se lee y qué se conserva.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `\nfunction ${nombre}(`;
  const marcaAsync = `\nasync function ${nombre}(`;
  let inicio = source.indexOf(marcaAsync);
  if (inicio === -1) inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio + 1, source.indexOf('\n}\n', inicio) + 2);
}

const DOM = `
  <div id="conciliacion-section" class="content-section">
    <div id="pane-conci-comercial" class="tab-pane">
      <input id="filter-conci-fecha-desde"><input id="filter-conci-fecha-hasta">
      <select id="filter-conci-manifiestos-year"><option value="2026" selected>2026</option></select>
      <select id="filter-conci-manifiestos-month"><option value="" selected></option><option value="10">10</option></select>
      <select id="filter-conci-manifiestos-day"><option value="" selected></option><option value="29">29</option></select>
      <table id="table-conci-manifiestos"><thead></thead><tbody></tbody></table>
    </div>
  </div>
  <div id="inicio-section" class="content-section active"></div>`;

// Cliente que anota cada lectura y solo termina cuando se le indica, para poder
// comprobar lo que pasa con una carga todavía en camino.
function clienteFalso() {
  const cliente = {
    lecturas: [],
    escrituras: [],
    enEspera: [],
    manual: false,
    from(tabla) {
      const q = { tabla, filtros: 0, rango: null };
      const api = {
        select: () => api,
        order: () => api,
        limit: () => api,
        gte: () => { q.filtros++; return api; },
        lte: () => { q.filtros++; return api; },
        or: () => { q.filtros++; return api; },
        eq: () => { q.filtros++; return api; },
        range: (a, b) => { q.rango = [a, b]; return api; },
        update: (p) => { cliente.escrituras.push(p); return api; },
        insert: (p) => { cliente.escrituras.push(p); return api; },
        upsert: (p) => { cliente.escrituras.push(p); return api; },
        then(ok, ko) {
          cliente.lecturas.push(q);
          const data = [{ id: 1, FECHA: '2026-10-29', _portal_flight_date: '2026-10-29' }];
          const respuesta = new Promise((resolve) => {
            if (cliente.manual) cliente.enEspera.push(() => resolve({ data, error: null }));
            else resolve({ data, error: null });
          });
          return respuesta.then(ok, ko);
        },
      };
      return api;
    },
    removeChannel: jest.fn(async () => {}),
  };
  return cliente;
}

const LOCALES = [
  '_conciHandleRemoteTableChange', '_conciMaybeApplyDeferredRemoteRefresh', '_conciRecargaYaCubierta',
  '_conciManifiestosEnPantalla', 'loadConciliacionManifiestos', '_conciHasPendingLocalEdits',
  '_conciDeferRefreshForLocalEdits', '_concifetchAllRows', '_conciGetManifestColInfo', '_conciIsoDateKey',
  '_conciShiftIsoDate', '_conciFetchVuelosForWindow', '_conciFetchManifestsForDate', '_conciVentanaDelFiltro',
  '_conciIsoDesplazado', '_conciAsegurarAnioEnSelector', '_conciApplyTodayFilters',
  '_conciEntrarModuloManifiestos', '_conciSalirModuloManifiestos', '_conciInitLiveCollab', '_conciQueueAutoSave',
];

function construir() {
  document.body.className = '';
  document.body.innerHTML = DOM;
  const cliente = clienteFalso();
  window.supabaseClient = cliente;
  window.ensureSupabaseClient = async () => cliente;
  const registro = { renders: 0, autosaves: [], canalesAbiertos: 0, conflictos: 0 };

  const propios = new Set(['document', 'window', 'registro', 'console', 'Promise', 'Date', 'Math', 'Object', 'Array',
    'String', 'Number', 'Map', 'Set', 'JSON', 'parseInt', 'Event', 'RegExp', 'Boolean', 'Error', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval', 'undefined', 'NaN', 'Infinity', 'Symbol', 'sessionStorage']);
  const vacios = new Proxy({}, {
    has: (_, k) => typeof k === 'string' && !propios.has(k),
    get: (_, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k === '_renderConciManifiestosTable') return () => { registro.renders++; };
      if (k === '_conciBuildEnriched') return () => ({ rows: [], columns: [] });
      if (k === '_conciAutoSaveRow') return (tr) => { registro.autosaves.push(tr); };
      if (k === '_conciCanCurrentUserEdit') return () => true;
      if (k === '_conciIdClienteVivo') return () => 'cliente-prueba';
      return () => undefined;
    },
  });

  const api = new Function('document', 'window', 'vacios', 'registro', `
    with (vacios) {
      let _conciPendingAutoSaveCount = 0, _conciPendingRemoteRefresh = false, _conciDeferredRefreshNoticeAt = 0;
      let _conciLoadRequestSeq = 0, _conciRenderedKey = '', _conciManifestColInfo = null, _conciVuelosCache = null;
      let _conciUltimoParcheTs = 0, _conciCargasEnCurso = 0, _conciEditMode = true;
      let _conciLiveHabilitado = false, _conciCierreLive = null, _conciLiveChannel = null, _conciLiveReady = false, _conciLiveClientId = '';
      let _conciLiveReintentos = 0, _conciReconexionTimer = null, _conciLatidoTimer = null, _conciFocoThrottleTimer = null;
      let _conciRemotePresenceByCell = new Map(), _conciFocoRemotoPorCliente = new Map();
      const _CONCI_VENTANA_PARCHE_MS = 6000, _CONCI_VUELOS_TTL_MS = 900000, _CONCI_VUELOS_RECIENTES_MS = 30000;
      const _CONCI_AUTOSAVE_INPUT_DELAY_MS = 400;
      const _conciRenderCache = new Map();
      ${LOCALES.map(extraer).join('\n')}
      return {
        _conciHandleRemoteTableChange, _conciMaybeApplyDeferredRemoteRefresh, _conciManifiestosEnPantalla,
        _conciApplyTodayFilters, loadConciliacionManifiestos, _conciEntrarModuloManifiestos,
        _conciSalirModuloManifiestos, _conciInitLiveCollab, _conciQueueAutoSave,
        pendiente: () => _conciPendingRemoteRefresh,
        canalVivo: () => _conciLiveChannel,
        fijarCanalVivo: (c) => { _conciLiveChannel = c; _conciLiveReady = true; },
        temporizadores: () => ({ reconexion: _conciReconexionTimer, latido: _conciLatidoTimer }),
        fijarTemporizadores: (a, b) => { _conciReconexionTimer = a; _conciLatidoTimer = b; },
      };
    }
  `)(document, window, vacios, registro);
  return { api, cliente, registro };
}

function verManifiestos() {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.getElementById('conciliacion-section').classList.add('active');
  document.getElementById('pane-conci-comercial').classList.add('active');
}

const reposar = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

describe('quien no está viendo Manifiestos no consulta nada', () => {
  test('sesión que nunca abrió el módulo: cero lecturas', async () => {
    const { api, cliente, registro } = construir();
    api._conciHandleRemoteTableChange();
    await reposar();
    expect(cliente.lecturas).toHaveLength(0);
    expect(registro.renders).toBe(0);
  });

  test('el aviso sigue invalidando los reportes, sin consultar', async () => {
    const { api, cliente } = construir();
    const avisado = jest.fn();
    window.addEventListener('conciliacion:manifiestos-cambiaron', avisado);
    const previa = window._conciNotificarManifiestosCambiaron;
    api._conciHandleRemoteTableChange();
    await reposar();
    window.removeEventListener('conciliacion:manifiestos-cambiaron', avisado);
    window._conciNotificarManifiestosCambiaron = previa;
    expect(cliente.lecturas).toHaveLength(0);
  });

  test('con la pantalla correcta pero sin fecha tampoco se lee el año completo', async () => {
    const { api, cliente } = construir();
    verManifiestos();
    expect(api._conciManifiestosEnPantalla()).toBe(false);
    api._conciHandleRemoteTableChange();
    await reposar();
    expect(cliente.lecturas).toHaveLength(0);
  });

  test('en otra pestaña de Conciliación no se consulta', async () => {
    const { api, cliente } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    document.getElementById('pane-conci-comercial').classList.remove('active');
    api._conciHandleRemoteTableChange();
    await reposar();
    expect(cliente.lecturas).toHaveLength(0);
    expect(api.pendiente()).toBe(true);
  });

  test('el lanzador del menú no cuenta como estar en pantalla', () => {
    const { api } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    expect(api._conciManifiestosEnPantalla()).toBe(true);
    document.body.classList.add('navdeck-mode');
    expect(api._conciManifiestosEnPantalla()).toBe(false);
    document.body.classList.add('navdeck-active');
    expect(api._conciManifiestosEnPantalla()).toBe(true);
  });
});

describe('quien sí está en Manifiestos ve los cambios', () => {
  test('un aviso lee solo la ventana de fechas, nunca sin filtro', async () => {
    const { api, cliente, registro } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    api._conciHandleRemoteTableChange();
    await reposar();
    expect(cliente.lecturas.length).toBeGreaterThan(0);
    cliente.lecturas
      .filter(q => q.tabla === 'manifiestos_vuelos_editable')
      .forEach(q => expect(q.filtros).toBeGreaterThan(0));
    expect(registro.renders).toBe(1);
  });

  test('una ráfaga de avisos no reparte vuelos en cada recarga', async () => {
    const { api, cliente } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    await api.loadConciliacionManifiestos({ forceRefresh: true });
    await reposar();
    const vuelosIniciales = cliente.lecturas.filter(q => q.tabla === 'manifiestos_vuelos_editable').length;

    for (let i = 0; i < 3; i++) {
      api._conciHandleRemoteTableChange();
      await reposar();
    }
    expect(cliente.lecturas.filter(q => q.tabla === 'manifiestos_vuelos_editable')).toHaveLength(vuelosIniciales);
  });

  test('avisos con una lectura en camino: una sola recarga al terminar', async () => {
    const { api, cliente } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    cliente.manual = true;
    const carga = api.loadConciliacionManifiestos({ forceRefresh: true });
    await reposar();

    for (let i = 0; i < 5; i++) api._conciHandleRemoteTableChange();
    await reposar();

    let vueltas = 0;
    while (cliente.enEspera.length && vueltas++ < 60) {
      cliente.enEspera.splice(0).forEach(soltar => soltar());
      await reposar();
    }
    await carga;
    const iniciales = cliente.lecturas.filter(q => q.tabla === 'Conciliación Manifiestos' && q.filtros > 0);
    expect(iniciales).toHaveLength(2);
    expect(api.pendiente()).toBe(false);
  });
});

describe('las capturas y las filas nuevas mandan sobre la sincronización', () => {
  function filaNuevaEnBlanco() {
    const tbody = document.querySelector('#table-conci-manifiestos tbody');
    tbody.innerHTML = '<tr data-dirty="1" data-conci-new="1"><td data-col="AEROLINEA"></td></tr>';
    return tbody.firstElementChild;
  }

  test('con una fila en blanco recién agregada no se recarga ni se escribe', async () => {
    const { api, cliente, registro } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    const fila = filaNuevaEnBlanco();

    api._conciHandleRemoteTableChange();
    await reposar();

    expect(cliente.lecturas).toHaveLength(0);
    expect(cliente.escrituras).toHaveLength(0);
    expect(registro.renders).toBe(0);
    expect(fila.isConnected).toBe(true);
    expect(api.pendiente()).toBe(true);
  });

  test('una celda capturada sin confirmar frena la recarga', async () => {
    const { api, cliente } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    document.querySelector('#table-conci-manifiestos tbody').innerHTML =
      '<tr data-row-id="7"><td data-col="TOTAL PAX" data-dirty="1">120</td></tr>';
    api._conciHandleRemoteTableChange();
    await reposar();
    expect(cliente.lecturas).toHaveLength(0);
    expect(cliente.escrituras).toHaveLength(0);
  });

  test('una captura que aparece durante la lectura no se pisa al terminar', async () => {
    const { api, cliente, registro } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    cliente.manual = true;
    const carga = api.loadConciliacionManifiestos({ forceRefresh: true, fromRemoteSync: true });
    await reposar();

    document.querySelector('#table-conci-manifiestos tbody').innerHTML =
      '<tr data-row-id="7"><td data-col="TOTAL PAX" data-dirty="1">120</td></tr>';

    let vueltas = 0;
    while (cliente.enEspera.length && vueltas++ < 60) {
      cliente.enEspera.splice(0).forEach(soltar => soltar());
      await reposar();
    }
    await carga;
    expect(registro.renders).toBe(0);
    expect(document.querySelector('td[data-dirty="1"]').textContent).toBe('120');
    expect(api.pendiente()).toBe(true);
  });

  test('una recarga en el módulo no crea filas ni escribe', async () => {
    const { api, cliente } = construir();
    verManifiestos();
    api._conciApplyTodayFilters();
    api._conciHandleRemoteTableChange();
    await reposar();
    expect(cliente.escrituras).toHaveLength(0);
  });
});

describe('salir del módulo no apaga el autoguardado', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('lo capturado antes de salir se guarda a los 400 ms con el canal cerrado', async () => {
    const { api, registro } = construir();
    const tbody = document.querySelector('#table-conci-manifiestos tbody');
    tbody.innerHTML = '<tr data-row-id="7"><td data-col="TOTAL PAX" data-dirty="1">120</td></tr>';
    const fila = tbody.firstElementChild;

    api._conciQueueAutoSave(fila);
    await api._conciSalirModuloManifiestos();

    jest.advanceTimersByTime(399);
    expect(registro.autosaves).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(registro.autosaves).toEqual([fila]);
  });
});

describe('canal en vivo: presencia y cursores', () => {
  test('al salir se cierra y suelta lo que lo revive solo', async () => {
    const { api, cliente } = construir();
    const canal = { nombre: 'conci-manifiestos-live' };
    api.fijarCanalVivo(canal);
    api.fijarTemporizadores(setTimeout(() => {}, 100000), setInterval(() => {}, 100000));

    await api._conciSalirModuloManifiestos();

    expect(cliente.removeChannel).toHaveBeenCalledWith(canal);
    expect(api.canalVivo()).toBeNull();
    expect(api.temporizadores()).toEqual({ reconexion: null, latido: null });
  });

  test('fuera del módulo nadie puede volver a abrirlo', async () => {
    const { api } = construir();
    window.supabaseClient.channel = jest.fn();
    await api._conciSalirModuloManifiestos();
    await api._conciInitLiveCollab();
    expect(window.supabaseClient.channel).not.toHaveBeenCalled();
  });

  test('volver antes de que termine el cierre espera: su nombre es compartido', async () => {
    const { api, cliente } = construir();
    let terminarCierre;
    cliente.removeChannel.mockImplementationOnce(() => new Promise((resolve) => { terminarCierre = resolve; }));
    const canal = { on: () => canal, subscribe: jest.fn() };
    window.supabaseClient.channel = jest.fn(() => canal);
    api.fijarCanalVivo({ nombre: 'conci-manifiestos-live' });

    api._conciSalirModuloManifiestos();
    const entrada = api._conciEntrarModuloManifiestos();
    await reposar();
    expect(window.supabaseClient.channel).not.toHaveBeenCalled();

    terminarCierre();
    await entrada;
    expect(window.supabaseClient.channel).toHaveBeenCalledTimes(1);
  });

  test('al entrar sí se abre', async () => {
    const { api } = construir();
    const canal = { on: () => canal, subscribe: jest.fn() };
    window.supabaseClient.channel = jest.fn(() => canal);
    await api._conciEntrarModuloManifiestos();
    expect(window.supabaseClient.channel).toHaveBeenCalledTimes(1);
    expect(canal.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('el camino de escritura no cambió', () => {
  test('el autoguardado conserva su espera de 400 ms', () => {
    expect(source).toMatch(/const _CONCI_AUTOSAVE_INPUT_DELAY_MS = 400;/);
    expect(extraer('_conciQueueAutoSave')).not.toMatch(/_conciManifiestosEnPantalla|_conciLiveHabilitado/);
    expect(extraer('_conciAutoSaveRow')).not.toMatch(/_conciManifiestosEnPantalla|_conciLiveHabilitado/);
    expect(extraer('_conciWriteRowSafe')).not.toMatch(/_conciManifiestosEnPantalla|_conciLiveHabilitado/);
  });
});
