/**
 * @jest-environment jsdom
 *
 * La caché de Reportes no puede sobrevivir a una modificación de los datos.
 *
 * Los dos módulos de Reportes cachean la descarga comparando SÓLO la fecha
 * pedida (`cache.hasta === hastaIso`). Por sí sola, esa caché devolvería las
 * filas de antes después de un cierre, de una corrección o de cualquier
 * captura: el oficio regenerado mostraría cifras viejas sin avisar.
 *
 * La invalidación es un evento común, `conciliacion:manifiestos-cambiaron`,
 * que emite quien escribe (script.js tras confirmar la escritura o el borrado,
 * y js/conci-cierre-subsecretaria.js tras cierre / corrección aplicada /
 * solicitud resuelta) y que escuchan los dos módulos de Reportes.
 *
 * Aquí se comprueba el comportamiento REAL: que la segunda descarga vuelve a
 * pedir datos a Supabase después del evento, y que sin el evento sigue
 * usando la caché (no se trata de dejar de cachear).
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');

const modPax = leer('js/conci-reportes-pasajeros.js');
const MODS_CARGA = ['js/conci-carga-catalogo.js', 'js/conci-presentacion-carga.js', 'js/conci-reportes-carga.js'].map(leer);
const scriptJs = leer('script.js');
const modCierre = leer('js/conci-cierre-subsecretaria.js');

const EVENTO = 'conciliacion:manifiestos-cambiaron';

function cargar(fuentes) {
  const arranques = [];
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener')
    .mockImplementation((tipo, fn, opciones) => {
      if (tipo === 'DOMContentLoaded') { arranques.push(fn); return; }
      registrar(tipo, fn, opciones);
    });
  for (const src of fuentes) new Function(src)();
  espia.mockRestore();
  arranques.forEach(fn => fn());
}

/**
 * Cliente falso que cuenta cuántas veces se le pidieron datos, para distinguir
 * "salió de la caché" de "volvió a descargar".
 */
function clienteFalso(filas) {
  const conteo = { descargas: 0 };
  // Constructor encadenable y "thenable", como el de supabase-js: los módulos
  // llaman .range() y DESPUÉS .lte(), así que ningún eslabón puede devolver ya
  // una promesa.
  const consulta = () => {
    let datos = filas;
    const q = {
      select: () => q,
      order: () => q,
      range: () => q,
      lte: () => q,
      limit: (n) => { datos = filas.slice(0, n); return q; },
      then: (res, rej) => Promise.resolve({ data: datos, error: null }).then(res, rej),
    };
    return q;
  };
  return {
    conteo,
    cliente: {
      from: () => { conteo.descargas++; return consulta(); },
    },
  };
}

const FILA = {
  'CIERRE SUBSECRETARIA': '2026-09-01',
  'FECHA': '2026-09-01',
  'TIPO DE MANIFIESTO': 'LLEGADA',
  'TIPO DE OPERACIÓN': 'NACIONAL',
  'AEROLINEA': 'VIVA AEROBUS',
  'TOTAL PAX': 150,
  'KGS. DE CARGA NACIONAL': 0,
  'KGS. DE CARGA INTERNACIONAL': 500,
  'KG DE CARGA TOTAL': 500,
  '_portal_flight_date': '2026-09-01',
  '_es_ajuste': false,
  '_signo': 1,
  '_uid': 'M000001',
};

describe('Reportes > Pasajeros: la caché se tira con el evento', () => {
  let api;
  let falso;

  beforeEach(() => {
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha" value="2026-09-01">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    delete window._conciRowIsCargo;
    delete window.ConciReportesEdicion;
    falso = clienteFalso([FILA]);
    window.supabaseClient = falso.cliente;
    cargar([modPax]);
    api = window.conciReportesPasajeros;
  });

  test('sin modificaciones, la segunda generación reutiliza la caché (no se deja de cachear)', async () => {
    await api.generar();
    const tras1 = falso.conteo.descargas;
    expect(tras1).toBeGreaterThan(0);

    await api.generar();
    expect(falso.conteo.descargas).toBe(tras1);
    expect(api._cache()).not.toBeNull();
  });

  test('tras el evento, la caché queda vacía y se vuelve a descargar', async () => {
    await api.generar();
    const tras1 = falso.conteo.descargas;
    expect(api._cache()).not.toBeNull();

    window.dispatchEvent(new CustomEvent(EVENTO));
    expect(api._cache()).toBeNull();

    await api.generar();
    expect(falso.conteo.descargas).toBeGreaterThan(tras1);
  });
});

describe('Reportes > Carga: la caché se tira con el evento', () => {
  let api;
  let falso;

  beforeEach(() => {
    document.body.innerHTML = `
      <input type="date" id="conci-rep-carga-fecha" value="2026-09-01">
      <button id="btn-conci-rep-carga-generar"></button>
      <div id="conci-rep-carga-estado"></div>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>`;
    window._conciRowIsCargo = () => true;
    falso = clienteFalso([FILA]);
    window.supabaseClient = falso.cliente;
    cargar(MODS_CARGA);
    api = window.conciReportesCarga;
  });

  afterEach(() => { delete window._conciRowIsCargo; });

  test('sin modificaciones, la segunda generación reutiliza la caché', async () => {
    await api.generar();
    const tras1 = falso.conteo.descargas;
    expect(tras1).toBeGreaterThan(0);

    await api.generar();
    expect(falso.conteo.descargas).toBe(tras1);
  });

  test('tras el evento se vuelve a descargar', async () => {
    await api.generar();
    const tras1 = falso.conteo.descargas;

    window.dispatchEvent(new CustomEvent(EVENTO));
    await api.generar();
    expect(falso.conteo.descargas).toBeGreaterThan(tras1);
  });
});

/**
 * El listener REAL de Supabase Realtime para "Conciliación Manifiestos" está
 * registrado en js/realtime.js:
 *   rm.watch(['Conciliación Manifiestos'], _lazy('_conciHandleRemoteTableChange'));
 * y ese callback vive en script.js. Se extrae tal cual del archivo (no se
 * reimplementa) para probar el comportamiento real ante un cambio remoto,
 * sin tener que evaluar script.js completo (tiene demasiadas dependencias de
 * DOM/globals para correr aislado en jsdom).
 */
function extraerFuncion(nombre) {
  const inicio = scriptJs.indexOf(`function ${nombre}(`);
  if (inicio === -1) throw new Error(`No se encontró function ${nombre}( en script.js`);
  const llaveApertura = scriptJs.indexOf('{', inicio);
  let profundidad = 0;
  for (let i = llaveApertura; i < scriptJs.length; i++) {
    if (scriptJs[i] === '{') profundidad++;
    else if (scriptJs[i] === '}') {
      profundidad--;
      if (profundidad === 0) return scriptJs.slice(inicio, i + 1);
    }
  }
  throw new Error(`No se encontró el cierre de function ${nombre} en script.js`);
}

const SRC_NOTIFICAR = extraerFuncion('_conciNotificarManifiestosCambiaron');
const SRC_REMOTE_CHANGE = extraerFuncion('_conciHandleRemoteTableChange');

describe('Realtime remoto (otro cliente) también invalida los Reportes', () => {
  function instalarListenerRemoto() {
    // eslint-disable-next-line no-new-func
    new Function(`${SRC_NOTIFICAR}\n${SRC_REMOTE_CHANGE}\nwindow._conciHandleRemoteTableChange = _conciHandleRemoteTableChange;`)();
  }

  beforeEach(() => {
    // Nadie tiene la tabla de Conciliación Manifiestos en pantalla: el cliente
    // A está viendo Reportes. Así se reproduce el defecto: antes del fix,
    // _conciHandleRemoteTableChange salía por el early-return del DOM sin
    // avisarle a los Reportes.
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha" value="2026-09-01">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>
      <input type="date" id="conci-rep-carga-fecha" value="2026-09-01">
      <button id="btn-conci-rep-carga-generar"></button>
      <div id="conci-rep-carga-estado"></div>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>`;
    expect(document.getElementById('table-conci-manifiestos')).toBeNull();
  });

  test('Pasajeros: A genera, B escribe por Realtime, A regenera la MISMA fecha y vuelve a pedir datos', async () => {
    delete window._conciRowIsCargo;
    delete window.ConciReportesEdicion;
    const falso = clienteFalso([FILA]);
    window.supabaseClient = falso.cliente;
    cargar([modPax]);
    instalarListenerRemoto();
    const api = window.conciReportesPasajeros;

    await api.generar();
    const tras1 = falso.conteo.descargas;
    expect(tras1).toBeGreaterThan(0);
    expect(api._cache()).not.toBeNull();

    // Cambio confirmado que llega por Realtime desde OTRO cliente (cliente B).
    // rtManager invoca este callback sin argumentos, igual que aquí.
    window._conciHandleRemoteTableChange();

    expect(api._cache()).toBeNull();
    await api.generar();
    expect(falso.conteo.descargas).toBeGreaterThan(tras1);
  });

  test('Carga: A genera, B escribe por Realtime, A regenera la MISMA fecha y vuelve a pedir datos', async () => {
    window._conciRowIsCargo = () => true;
    const falso = clienteFalso([FILA]);
    window.supabaseClient = falso.cliente;
    cargar(MODS_CARGA);
    instalarListenerRemoto();
    const api = window.conciReportesCarga;

    await api.generar();
    const tras1 = falso.conteo.descargas;
    expect(tras1).toBeGreaterThan(0);

    window._conciHandleRemoteTableChange();

    await api.generar();
    expect(falso.conteo.descargas).toBeGreaterThan(tras1);
    delete window._conciRowIsCargo;
  });

  test('sigue viva la protección epoch: una descarga vieja que llega tarde no revive como caché válida', async () => {
    delete window._conciRowIsCargo;
    delete window.ConciReportesEdicion;
    const falso = clienteFalso([FILA]);
    window.supabaseClient = falso.cliente;
    cargar([modPax]);
    instalarListenerRemoto();
    const api = window.conciReportesPasajeros;

    // Descarga A empieza pero se queda "en vuelo" (no resuelve todavía).
    let liberar;
    const enVuelo = new Promise((r) => { liberar = r; });
    const consultaLenta = () => {
      const q = {
        select: () => q, order: () => q, range: () => q, lte: () => q, limit: () => q,
        then: (res, rej) => enVuelo.then(() => Promise.resolve({ data: [FILA], error: null })).then(res, rej),
      };
      return q;
    };
    window.supabaseClient = { from: () => consultaLenta() };
    const p1 = api.generar();

    // Mientras tanto llega el cambio remoto: invalida (sube el epoch).
    window._conciHandleRemoteTableChange();

    // La descarga A por fin resuelve, tarde.
    liberar();
    await p1;

    // Esa respuesta vieja no debe haberse instalado como caché válida.
    expect(api._cache()).toBeNull();
  });
});

describe('Quién emite el evento', () => {
  test('los dos módulos de Reportes lo escuchan y ponen su caché a null', () => {
    [modPax, ...MODS_CARGA].join('\n');
    [modPax, MODS_CARGA[2]].forEach((src) => {
      expect(src).toMatch(
        new RegExp(`addEventListener\\('${EVENTO}', \\(\\) => \\{ cache = null; \\}\\)`)
      );
    });
  });

  test('script.js lo emite tras una ESCRITURA confirmada, no en cualquier refresco', () => {
    expect(scriptJs).toMatch(/function _conciNotificarManifiestosCambiaron\(\)/);
    expect(scriptJs).toMatch(new RegExp(`dispatchEvent\\(new CustomEvent\\('${EVENTO}'\\)\\)`));
    // Se llama desde el punto en que _conciWriteRowSafe da la escritura por
    // confirmada (ya comparó los valores devueltos por la base).
    const escritura = scriptJs.match(/async function _conciWriteRowSafe[\s\S]*?\n\}/)[0];
    expect(escritura).toMatch(/if \(typeof _conciNotificarManifiestosCambiaron === 'function'\) \{\s*\n\s*_conciNotificarManifiestosCambiaron\(\);/);
    // Y desde el borrado, sólo cuando la base confirmó que borró algo.
    const borrado = scriptJs.match(/async function _conciEliminarRegistro[\s\S]*?\n\}/)[0];
    expect(borrado).toMatch(/if \(!eliminadas\) return false;[\s\S]*?_conciNotificarManifiestosCambiaron\(\);/);
  });

  test('el módulo de cierre lo emite tras cierre, corrección aplicada y solicitud resuelta', () => {
    expect(modCierre).toMatch(/function notificarManifiestosCambiaron\(\)/);
    // Una llamada por cada una de las tres recargas causadas por escritura.
    expect((modCierre.match(/notificarManifiestosCambiaron\(\);/g) || []).length).toBe(3);
    // Y cada una va inmediatamente después de recargar Manifiestos.
    const bloques = modCierre.match(
      /window\.loadConciliacionManifiestos\(\{ forceRefresh: true, allowLocalEditsReplace: true \}\);\s*\n\s*\}\s*\n\s*notificarManifiestosCambiaron\(\);/g
    ) || [];
    expect(bloques.length).toBe(3);
  });

  test('el emisor nunca puede tumbar el guardado que acaba de funcionar', () => {
    expect(scriptJs).toMatch(/_conciNotificarManifiestosCambiaron\(\) \{\s*\n\s*try \{/);
    expect(modCierre).toMatch(/function notificarManifiestosCambiaron\(\) \{\s*\n\s*try \{/);
  });
});
