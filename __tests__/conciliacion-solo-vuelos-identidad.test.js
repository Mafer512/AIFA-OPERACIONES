/**
 * @jest-environment jsdom
 *
 * Capturar sobre un vuelo del Itinerario no puede pedir que reescribas el vuelo.
 *
 * Síntoma reportado desde captura: al llenar manifiestos salía una y otra vez
 *
 *   "No se pudo guardar la fila: Falta capturar algo que identifique el vuelo
 *    (aerolínea, matrícula, # de vuelo, tipo de manifiesto, aeronave,
 *    destino/origen o total de pasajeros) antes de que esta fila pueda
 *    guardarse como un registro nuevo."
 *
 * ...sobre filas que SÍ tenían todo eso a la vista.
 *
 * La guarda que produce ese mensaje existe por una razón buena: una fila nueva
 * con sólo la FECHA puesta nacía en la base como registro en blanco (ver
 * conciliacion-solo-fecha-no-crea-fila). Pero preguntaba lo que no era: exigía
 * que una de las columnas TECLEADAS EN ESA SESIÓN fuera de identidad.
 *
 * Y el caso más común del módulo no funciona así. Una fila "Solo Vuelos" es el
 * espejo de un vuelo del Itinerario: ya trae aerolínea, # de vuelo, tipo de
 * manifiesto y destino/origen en pantalla, y todo eso viaja en el payload. El
 * capturista sólo añade lo que falta del manifiesto —slot coordinado, kgs,
 * observaciones, código de demora—, y nada de eso es identidad. La captura se
 * rechazaba aunque el registro a crear estuviera perfectamente identificado.
 *
 * La pregunta correcta es sobre la FILA que queda en la base, no sobre lo que
 * se acaba de teclear.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  let inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const insertados = [];
const actualizados = [];
const avisos = [];

function construirApi() {
  return new Function('document', 'window', 'console', 'insertados', 'actualizados', 'estado', 'avisos', `
    let _conciEditMode = true;
    let _conciPendingAutoSaveCount = 0;
    const _conciRenderCache = { clear() {} };
    let _conciRenderedKey = '';

    function _conciFechaUnicaDelFiltro() { return '19/08/2026'; }
    function _conciCurrentUserDisplayName() { return 'MJ'; }
    function _conciCanCurrentUserEdit() { return true; }
    function _conciRenderCapturoCell() {}
    function _conciSettleSavedCells() {}
    function _conciBroadcastCambioGuardado() {}
    function _conciProgramarReintento() { estado.reintentos++; }
    function _conciReiniciarEsperaReintento() {}
    function _conciMaybeApplyDeferredRemoteRefresh() {}
    function _conciBorradorTrasladarFilaNueva() {}
    function _conciFillRowActionCell() {}
    function _conciSaveVirtualAirlineOverride() { estado.overrides++; }
    function _conciEncolarPendientesDeFila() { estado.encolados++; }
    function _conciIsCalculatedColumn() { return false; }
    function _conciShouldPersistCalculatedColumn() { return false; }
    function _conciCalculadaDebeEnviarse() { return false; }
    function _conciIsRoutingColumn() { return false; }
    function _conciPrepareValueForDatabase(col, value) { return value; }
    function _conciCoerceNumberCandidate(v) {
      const t = String(v).trim();
      if (!t || !/^[0-9.,\\s-]+$/.test(t)) return null;
      const n = Number(t.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    function _conciNormalizedColumnName(c) {
      return String(c || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();
    }
    function showNotification(texto, tipo) { avisos.push({ texto, tipo }); }

    window.supabaseClient = {
      from() {
        const st = { op: null, datos: null, id: null };
        const api = {
          select() { return api; },
          eq(col, val) { if (col === 'id') st.id = String(val); return api; },
          maybeSingle() { return api; },
          insert(d) { st.op = 'insert'; st.datos = d; return api; },
          upsert(d) { st.op = 'insert'; st.datos = d; return api; },
          update(d) { st.op = 'update'; st.datos = d; return api; },
          then(res, rej) { return correr().then(res, rej); },
        };
        async function correr() {
          const mala = estado.rechaza.find(c => st.datos && st.datos[c] !== undefined);
          if (mala) {
            return { data: null, error: { message: 'invalid input syntax for type bigint: "' + st.datos[mala] + '"' } };
          }
          if (st.op === 'insert') {
            const fila = { id: ++estado.siguienteId, ...st.datos };
            insertados.push({ ...st.datos });
            return { data: fila, error: null };
          }
          if (st.op === 'update') {
            actualizados.push({ id: st.id, payload: { ...st.datos } });
            return { data: { id: st.id, ...st.datos }, error: null };
          }
          return { data: null, error: null };
        }
        return api;
      }
    };

    ${extraer('_conciNormalizeEditableCellText')}
    ${extraer('_conciAirlinePayloadEntry')}
    ${extraer('_conciFilaNuevaListaParaGuardar')}
    ${extraer('_conciErrorEsperaCorreccion')}
    ${extraer('_conciNumeroComparable')}
    ${extraer('_conciAdoptarFilaPersistida')}
    ${extraer('_conciDatabaseValueEquals')}
    ${extraer('_conciPersistenceMismatch')}
    ${extraer('_conciMovementKeyFromDuplicateError')}
    ${extraer('_conciIsMovementKeyDuplicate')}
    ${extraer('_conciSummaryColumnKey')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciWriteRowSafe')}
    ${extraer('_conciNuevoUuid')}
    ${extraer('_conciUuidDeterminista')}
    ${extraer('_conciAsegurarClienteUuid')}
    ${extraer('_conciClaveEscrituraDeFila')}
    ${extraer('_conciValorSeguroEnSelector')}
    ${extraer('_conciFilaVivaParaClave')}
    ${extraer('_conciPropagarIdPorNombre')}
    const _conciEscriturasEnVuelo = new Map();
    ${extraer('_conciAutoSaveRow')}
    return { _conciAutoSaveRow, _conciWriteRowSafe };
  `)(document, window, console, insertados, actualizados, estado, avisos);
}

const COLUMNAS = [
  'MES', 'FECHA', 'AEROLINEA', 'TIPO DE MANIFIESTO', 'MATRÍCULA', '# DE VUELO',
  'DESTINO / ORIGEN', 'SLOT COORDINADO', 'KGS. DE EQUIPAJE', 'CÓDIGO DEMORA',
  'OBSERVACIONES', 'TOTAL PAX', 'CAPTURÓ',
];

/**
 * Fila "Solo Vuelos": el espejo de un vuelo del Itinerario. No tiene id propio
 * en "Conciliación Manifiestos" —todavía no existe ahí— pero sí trae en
 * pantalla los datos del vuelo, que nadie tecleó en esta sesión.
 */
function filaDeItinerario(datosDelVuelo) {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  const tbody = document.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = '';
  tr.dataset.rowFuente = 'Solo Vuelos';
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    const valor = datosDelVuelo[col] || '';
    // Viene del Itinerario, no de la captura: tiene valor pero NO está dirty.
    td.dataset.raw = valor;
    td.dataset.origRaw = valor;
    td.dataset.pendingRaw = valor;
    td.textContent = valor;
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

function capturar(tr, col, valor) {
  const td = [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);
  td.dataset.pendingRaw = valor;
  td.dataset.raw = valor;
  td.textContent = valor;
  if (valor !== td.dataset.origRaw) td.dataset.dirty = '1';
  else td.removeAttribute('data-dirty');
  return td;
}

const VUELO = {
  'AEROLINEA': 'VIVA AEROBUS',
  'TIPO DE MANIFIESTO': 'SALIDA',
  '# DE VUELO': '4103',
  'DESTINO / ORIGEN': 'NLU-CUN',
  'FECHA': '19/08/2026',
};

let estado;
let api;
beforeEach(() => {
  insertados.length = 0;
  actualizados.length = 0;
  avisos.length = 0;
  estado = { rechaza: [], siguienteId: 5000, reintentos: 0, encolados: 0, overrides: 0 };
  document.body.innerHTML = '';
  api = construirApi();
});

describe('el vuelo ya está identificado: lo que se capture encima se guarda', () => {
  test('sólo observaciones — el caso que devolvía el error', async () => {
    const tr = filaDeItinerario(VUELO);
    capturar(tr, 'OBSERVACIONES', 'Salió con demora por posición');

    await api._conciAutoSaveRow(tr);

    expect(avisos).toEqual([]);
    expect(insertados).toHaveLength(1);
    expect(insertados[0]['OBSERVACIONES']).toBe('Salió con demora por posición');
    // Y el registro nace identificado, que es lo que la guarda protege.
    expect(insertados[0]['AEROLINEA']).toBe('VIVA AEROBUS');
    expect(insertados[0]['# DE VUELO']).toBe('4103');
  });

  test('sólo el código de demora', async () => {
    const tr = filaDeItinerario(VUELO);
    capturar(tr, 'CÓDIGO DEMORA', '89');

    await api._conciAutoSaveRow(tr);

    expect(avisos).toEqual([]);
    expect(insertados).toHaveLength(1);
    expect(insertados[0]['CÓDIGO DEMORA']).toBe('89');
  });

  test('sólo el slot coordinado y los kgs de equipaje', async () => {
    const tr = filaDeItinerario(VUELO);
    capturar(tr, 'SLOT COORDINADO', '14:35');
    capturar(tr, 'KGS. DE EQUIPAJE', '1240');

    await api._conciAutoSaveRow(tr);

    expect(avisos).toEqual([]);
    expect(insertados).toHaveLength(1);
    expect(insertados[0]['SLOT COORDINADO']).toBe('14:35');
    expect(insertados[0]['KGS. DE EQUIPAJE']).toBe('1240');
  });

  test('no se encola como pendiente ni se programa reintento: se guardó y ya', async () => {
    const tr = filaDeItinerario(VUELO);
    capturar(tr, 'OBSERVACIONES', 'Sin novedad');

    await api._conciAutoSaveRow(tr);

    expect(estado.encolados).toBe(0);
    expect(estado.reintentos).toBe(0);
  });
});

describe('la guarda sigue haciendo su trabajo', () => {
  // El motivo por el que existe: una fila nueva en blanco a la que sólo se le
  // puso una fecha nacía en la base como registro vacío.
  test('una fila nueva sin nada del vuelo sigue sin crearse', async () => {
    const tr = filaDeItinerario({});
    tr.dataset.conciNew = '1';
    delete tr.dataset.rowFuente;
    capturar(tr, 'FECHA', '19/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toEqual([]);
    expect(avisos.some(a => /identifique el vuelo/.test(a.texto))).toBe(true);
  });

  test('una fila nueva sin nada del vuelo tampoco se crea por las observaciones', async () => {
    const tr = filaDeItinerario({});
    tr.dataset.conciNew = '1';
    delete tr.dataset.rowFuente;
    capturar(tr, 'OBSERVACIONES', 'pendiente de revisar');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toEqual([]);
  });

  test('en cuanto se teclea algo del vuelo, la fila nueva sí nace', async () => {
    const tr = filaDeItinerario({});
    tr.dataset.conciNew = '1';
    delete tr.dataset.rowFuente;
    capturar(tr, 'MATRÍCULA', 'XA-VMB');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toHaveLength(1);
    expect(insertados[0]['MATRÍCULA']).toBe('XA-VMB');
  });

  // La otra mitad de la guarda: si la base RECHAZA por tipo la única columna de
  // identidad que traía la fila, ésta se queda sin identidad en el payload y no
  // debe crearse. Por eso la comprobación vive dentro del bucle de reintentos.
  test('si la base poda la única identidad, la fila no se crea', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = filaDeItinerario({});
    tr.dataset.conciNew = '1';
    delete tr.dataset.rowFuente;
    capturar(tr, '# DE VUELO', 'VB 7305');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toEqual([]);
    expect(avisos.some(a => /no aceptó|no acept/i.test(a.texto))).toBe(true);
  });

  // Pero si la fila lleva OTRA identidad además de la podada, sí nace: se
  // pierde esa columna (y se avisa), no la captura entera.
  //
  // El valor tiene que ser uno que la auto-corrección no pueda rescatar: con
  // "4103" lo convierte a número y reintenta, con "VB 7305" no le queda más
  // que descartar la columna, que es el camino que aquí importa.
  test('podada una identidad, otra distinta basta para crear la fila', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = filaDeItinerario(VUELO);
    capturar(tr, '# DE VUELO', 'VB 7305');
    capturar(tr, 'OBSERVACIONES', 'Manifiesto entregado');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toHaveLength(1);
    expect(insertados[0]['AEROLINEA']).toBe('VIVA AEROBUS');
    expect(insertados[0]['OBSERVACIONES']).toBe('Manifiesto entregado');
    expect(insertados[0]['# DE VUELO']).toBeUndefined();
    // Y se dice cuál se quedó fuera: un "ok" no puede significar que todo entró.
    expect(avisos.some(a => /# DE VUELO/.test(a.texto))).toBe(true);
  });
});

describe('el criterio es el payload, no lo que se tecleó', () => {
  test('un valor de identidad vacío no cuenta como identidad', async () => {
    const tr = filaDeItinerario({ 'AEROLINEA': '   ', 'FECHA': '19/08/2026' });
    tr.dataset.conciNew = '1';
    delete tr.dataset.rowFuente;
    capturar(tr, 'OBSERVACIONES', 'algo');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toEqual([]);
  });

  test('el "-" de una columna calculada tampoco identifica nada', async () => {
    const res = await api._conciWriteRowSafe(
      window.supabaseClient,
      { 'TOTAL PAX': '-', 'OBSERVACIONES': 'x' },
      null,
      { columnasDeCaptura: [] }
    );

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('CONCI_CAPTURA_NO_ACEPTADA');
  });

  test('la importación, que no pide la comprobación, sigue sin sujetarse a ella', async () => {
    const res = await api._conciWriteRowSafe(
      window.supabaseClient, { 'OBSERVACIONES': 'importado' }, null
    );

    expect(res.ok).toBe(true);
    expect(insertados).toHaveLength(1);
  });
});
