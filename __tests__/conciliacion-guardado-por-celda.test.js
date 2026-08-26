/**
 * @jest-environment jsdom
 *
 * "No guarda todos los campos ni todas las filas que se capturan."
 *
 * Tres fallos distintos del núcleo de guardado, los tres invisibles: ninguno
 * daba error, ninguno dejaba la fila marcada como pendiente. Quien capturaba
 * sólo veía que, al volver al día siguiente, faltaban datos.
 *
 * 1) LA FILA QUE DEJA DE GUARDAR PARA SIEMPRE.
 *    _conciAutoSaveRow publicaba su promesa DESPUÉS de lanzarla:
 *
 *        tr._conciAutoSavePromise = (async () => { ... })();
 *
 *    El cuerpo de una función async corre de forma síncrona hasta el primer
 *    await, y ese cuerpo tiene salidas tempranas que se alcanzan antes de
 *    cualquier await — la más común, un UPDATE que se queda sin columnas que
 *    enviar porque no se modificó nada. En ese caso su propio `finally` corría
 *    ahí mismo y dejaba tr._conciAutoSavePromise en null... y la asignación de
 *    fuera lo volvía a poner justo después. La fila quedaba marcada como
 *    "escribiendo" para siempre, y la primera guarda de _conciAutoSaveRow la
 *    veía ocupada en cada intento posterior y devolvía sin escribir nada.
 *
 *    Bastaba con atravesar una celda sin cambiarla —Tab o flechas, el gesto más
 *    repetido de la captura— para que esa fila no volviera a guardar en toda la
 *    sesión.
 *
 * 2) EL REPINTADO QUE DUPLICA LA FILA.
 *    El candado colgaba del nodo <tr>, y el tbody se repinta entero por un
 *    refresco, un cambio remoto o una restauración de borradores. El <tr> nuevo
 *    nacía con el candado libre: si la fila todavía no tenía id, su segunda
 *    escritura era otro INSERT y la fila salía DUPLICADA.
 *
 * 3) EL ALTA SIN NOMBRE PROPIO.
 *    La rama más transitada del módulo —capturar un manifiesto sobre un vuelo
 *    del Itinerario que aún no lo tiene— daba de alta la fila con un insert a
 *    ciegas. Cualquier reintento, o dos capturistas sobre el mismo vuelo,
 *    creaban filas de más.
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
    function _conciBroadcastCambioGuardado() {}
    function _conciProgramarReintento() { estado.reintentos++; }
    function _conciReiniciarEsperaReintento() {}
    function _conciMaybeApplyDeferredRemoteRefresh() {}
    function _conciBorradorTrasladarFilaNueva() {}
    function _conciBorradorOlvidarFila() {}
    function _conciBorradorQuitarCelda() {}
    function _conciDesencolarPendientesDeFila() {}
    function _conciActualizarBotonGuardarTodo() {}
    function _conciFillRowActionCell() {}
    function _conciSaveVirtualAirlineOverride() {}
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
    function _conciAnotar(tr, evento, detalle) { estado.bitacora.push({ evento, detalle }); }
    function showNotification(texto, tipo) { avisos.push({ texto, tipo }); }

    // La base tarda: es justo el hueco en el que se sigue capturando y en el que
    // el tbody se puede repintar por debajo.
    window.supabaseClient = {
      from() {
        const st = { op: null, datos: null, id: null };
        const api = {
          select() { return api; },
          eq(col, val) { if (col === 'id') st.id = String(val); return api; },
          maybeSingle() { return api; },
          insert(d) { st.op = 'insert'; st.datos = d; return api; },
          upsert(d) { st.op = 'upsert'; st.datos = d; return api; },
          update(d) { st.op = 'update'; st.datos = d; return api; },
          then(res, rej) { return correr().then(res, rej); },
        };
        async function correr() {
          if (estado.latenciaMs) await new Promise(r => setTimeout(r, estado.latenciaMs));
          if (st.op === 'insert' || st.op === 'upsert') {
            // Un upsert sobre cliente_uuid cae en la fila que ya lleva ese
            // nombre en vez de crear otra: es lo que hace idempotente el alta.
            const nombre = st.datos && st.datos.cliente_uuid;
            const previa = nombre ? estado.filas.find(f => f.cliente_uuid === nombre) : null;
            if (previa && st.op === 'upsert') {
              Object.assign(previa, st.datos);
              actualizados.push({ id: String(previa.id), payload: { ...st.datos } });
              return { data: { ...previa }, error: null };
            }
            const fila = { id: ++estado.siguienteId, ...st.datos };
            estado.filas.push(fila);
            insertados.push({ ...st.datos });
            return { data: { ...fila }, error: null };
          }
          if (st.op === 'update') {
            const fila = estado.filas.find(f => String(f.id) === st.id) || { id: st.id };
            Object.assign(fila, st.datos);
            actualizados.push({ id: st.id, payload: { ...st.datos } });
            return { data: { ...fila }, error: null };
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
    ${extraer('_conciSettleSavedCells')}
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
    return {
      _conciAutoSaveRow,
      _conciAsegurarClienteUuid,
      _conciClaveEscrituraDeFila,
      _conciEscriturasEnVuelo,
    };
  `)(document, window, console, insertados, actualizados, estado, avisos);
}

const COLUMNAS = [
  'MES', 'FECHA', 'AEROLINEA', 'TIPO DE MANIFIESTO', 'MATRÍCULA', '# DE VUELO',
  'DESTINO / ORIGEN', 'SLOT COORDINADO', 'KGS. DE EQUIPAJE', 'TOTAL PAX',
  'OBSERVACIONES', 'CAPTURÓ',
];

const VUELO = {
  'AEROLINEA': 'VIVA AEROBUS',
  'TIPO DE MANIFIESTO': 'SALIDA',
  '# DE VUELO': '4103',
  'DESTINO / ORIGEN': 'NLU-CUN',
  'FECHA': '19/08/2026',
};

// Una fila que ya trae capturista: pasar por ella sin cambiar nada no deja
// NINGUNA columna que enviar, que es el caso que inutilizaba la fila.
const VUELO_YA_CAPTURADO = { ...VUELO, 'CAPTURÓ': 'MJ' };

function tabla() {
  if (!document.getElementById('table-conci-manifiestos')) {
    document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  }
  return document.querySelector('#table-conci-manifiestos tbody');
}

/** Pinta una fila como lo haría el render: valores a la vista, ninguno dirty. */
function pintarFila({ rowId = '', fuente = 'Solo Vuelos', vueloId = '', direccion = '', valores = {} }) {
  const tbody = tabla();
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  tr.dataset.rowFuente = fuente;
  if (vueloId) {
    tr.dataset.conciVueloId = vueloId;
    tr.dataset.conciVueloDireccion = direccion;
  }
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    const valor = valores[col] || '';
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

const celda = (tr, col) => [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);

let estado;
let api;
beforeEach(() => {
  insertados.length = 0;
  actualizados.length = 0;
  avisos.length = 0;
  estado = { siguienteId: 5000, reintentos: 0, encolados: 0, latenciaMs: 0, filas: [], bitacora: [] };
  document.body.innerHTML = '';
  api = construirApi();
});

describe('atravesar una celda sin cambiarla no inutiliza la fila', () => {
  test('la captura siguiente sí llega a la base', async () => {
    const tr = pintarFila({ rowId: '77', fuente: 'Manifiestos + Vuelos', valores: VUELO_YA_CAPTURADO });

    // Tab / flecha sobre una celda que no se modifica: el commit llama igual al
    // autoguardado, que se queda sin columnas que enviar y sale antes de la red.
    await api._conciAutoSaveRow(tr);
    expect(actualizados).toHaveLength(0);

    // Y ahora sí se captura algo. Antes esto no salía nunca de la pantalla.
    capturar(tr, 'TOTAL PAX', '162');
    await api._conciAutoSaveRow(tr);

    expect(actualizados).toHaveLength(1);
    expect(actualizados[0].payload['TOTAL PAX']).toBe('162');
    expect(celda(tr, 'TOTAL PAX').dataset.dirty).toBeUndefined();
  });

  test('ni siquiera tras diez pasadas en seco', async () => {
    const tr = pintarFila({ rowId: '77', fuente: 'Manifiestos + Vuelos', valores: VUELO_YA_CAPTURADO });
    for (let i = 0; i < 10; i++) await api._conciAutoSaveRow(tr);

    capturar(tr, 'KGS. DE EQUIPAJE', '980');
    await api._conciAutoSaveRow(tr);

    expect(actualizados).toHaveLength(1);
    expect(actualizados[0].payload['KGS. DE EQUIPAJE']).toBe('980');
  });

  test('el candado queda libre: no hay escrituras fantasma registradas', async () => {
    const tr = pintarFila({ rowId: '77', fuente: 'Manifiestos + Vuelos', valores: VUELO_YA_CAPTURADO });
    await api._conciAutoSaveRow(tr);
    expect(api._conciEscriturasEnVuelo.size).toBe(0);
    expect(tr._conciAutoSavePromise).toBeFalsy();
  });
});

describe('un repintado del tbody a media escritura no duplica la fila', () => {
  test('el <tr> de reemplazo no abre una segunda alta', async () => {
    estado.latenciaMs = 20;
    const tr = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(tr, 'TOTAL PAX', '150');

    const enVuelo = api._conciAutoSaveRow(tr);

    // El tbody se repinta mientras la escritura viaja: el nodo anterior se va y
    // otro ocupa su lugar, con los mismos datos del vuelo.
    tabla().innerHTML = '';
    const relevo = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(relevo, 'TOTAL PAX', '150');

    await Promise.all([enVuelo, api._conciAutoSaveRow(relevo)]);
    await new Promise(r => setTimeout(r, 60));

    // Una sola fila en la base, no dos.
    expect(insertados).toHaveLength(1);
    expect(estado.filas).toHaveLength(1);
  });

  test('lo capturado en el nodo de reemplazo termina en la base', async () => {
    estado.latenciaMs = 20;
    const tr = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(tr, 'TOTAL PAX', '150');
    const enVuelo = api._conciAutoSaveRow(tr);

    tabla().innerHTML = '';
    const relevo = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(relevo, 'KGS. DE EQUIPAJE', '1200');

    await Promise.all([enVuelo, api._conciAutoSaveRow(relevo)]);
    await new Promise(r => setTimeout(r, 80));

    const fila = estado.filas[0];
    expect(fila['TOTAL PAX']).toBe('150');
    expect(fila['KGS. DE EQUIPAJE']).toBe('1200');
  });

  test('una escritura lanzada desde un nodo ya retirado se aplica sobre el vivo', async () => {
    const tr = pintarFila({ rowId: '77', fuente: 'Manifiestos + Vuelos', valores: VUELO });
    capturar(tr, 'TOTAL PAX', '162');
    tr.remove();

    // El mismo registro, repintado.
    const relevo = pintarFila({ rowId: '77', fuente: 'Manifiestos + Vuelos', valores: VUELO });
    capturar(relevo, 'TOTAL PAX', '162');

    await api._conciAutoSaveRow(tr);

    expect(actualizados).toHaveLength(1);
    expect(actualizados[0].id).toBe('77');
    expect(celda(relevo, 'TOTAL PAX').dataset.dirty).toBeUndefined();
  });
});

describe('lo capturado mientras la base responde no se queda en pantalla', () => {
  test('se envía en cuanto termina la escritura anterior, sin tocar la fila otra vez', async () => {
    estado.latenciaMs = 25;
    const tr = pintarFila({ rowId: '77', fuente: 'Manifiestos + Vuelos', valores: VUELO });

    capturar(tr, 'TOTAL PAX', '162');
    const primera = api._conciAutoSaveRow(tr);

    // El capturista no espera a que la base conteste: sigue tecleando.
    capturar(tr, 'KGS. DE EQUIPAJE', '980');
    await api._conciAutoSaveRow(tr);
    await primera;
    await new Promise(r => setTimeout(r, 80));

    const enviado = Object.assign({}, ...actualizados.map(a => a.payload));
    expect(enviado['TOTAL PAX']).toBe('162');
    expect(enviado['KGS. DE EQUIPAJE']).toBe('980');
    expect(celda(tr, 'KGS. DE EQUIPAJE').dataset.dirty).toBeUndefined();
  });
});

describe('el alta lleva nombre propio: capturar el mismo vuelo desde dos pantallas no crea dos filas', () => {
  test('la fila espejo del Itinerario se da de alta con cliente_uuid', async () => {
    const tr = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(tr, 'TOTAL PAX', '150');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toHaveLength(1);
    expect(insertados[0].cliente_uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('el nombre sale del vuelo, así que es el mismo en cualquier pantalla', () => {
    const unaPantalla = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    document.body.innerHTML = '';
    const otraPantalla = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });

    expect(api._conciAsegurarClienteUuid(unaPantalla))
      .toBe(api._conciAsegurarClienteUuid(otraPantalla));
  });

  test('vuelos distintos —o direcciones distintas— nunca comparten nombre', () => {
    const salida = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    const llegada = pintarFila({ vueloId: '9001', direccion: 'LLEGADA', valores: VUELO });
    const otro = pintarFila({ vueloId: '9002', direccion: 'SALIDA', valores: VUELO });

    const nombres = [salida, llegada, otro].map(api._conciAsegurarClienteUuid);
    expect(new Set(nombres).size).toBe(3);
  });

  test('dos capturistas sobre el mismo vuelo llenan la MISMA fila', async () => {
    const pantallaA = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(pantallaA, 'TOTAL PAX', '150');
    await api._conciAutoSaveRow(pantallaA);

    // La otra pantalla sigue viendo el espejo del vuelo: no se ha enterado de
    // que ya existe el manifiesto.
    document.body.innerHTML = '';
    const apiB = construirApi();
    const pantallaB = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(pantallaB, 'KGS. DE EQUIPAJE', '1200');
    await apiB._conciAutoSaveRow(pantallaB);

    expect(estado.filas).toHaveLength(1);
    expect(estado.filas[0]['TOTAL PAX']).toBe('150');
    expect(estado.filas[0]['KGS. DE EQUIPAJE']).toBe('1200');
  });

  test('la fila adopta el id que le devolvió la base y deja de creerse nueva', async () => {
    const tr = pintarFila({ vueloId: '9001', direccion: 'SALIDA', valores: VUELO });
    capturar(tr, 'TOTAL PAX', '150');
    await api._conciAutoSaveRow(tr);

    expect(tr.dataset.rowId).toBe(String(estado.filas[0].id));
    expect(tr.dataset.rowFuente).toBe('Manifiestos + Vuelos');

    // Lo siguiente que se capture es un UPDATE sobre esa fila, no un alta nueva.
    capturar(tr, 'OBSERVACIONES', 'Cerró a tiempo');
    await api._conciAutoSaveRow(tr);
    expect(insertados).toHaveLength(1);
    expect(actualizados).toHaveLength(1);
  });
});

describe('el módulo protege lo capturado antes de repintar la tabla', () => {
  test('el render no reemplaza el tbody con capturas sin confirmar', () => {
    const carga = source.slice(
      source.indexOf('async function loadConciliacionManifiestos'),
      source.indexOf('function _conciIsReceptionColumn')
    );
    // La comprobación de entrada ocurre ANTES de consultar a Supabase; hace falta
    // otra justo antes de reemplazar el tbody, o lo tecleado durante la consulta
    // se pierde de la pantalla sin haberse guardado.
    const guardas = carga.match(/_conciDeferRefreshForLocalEdits\(/g) || [];
    expect(guardas.length).toBeGreaterThanOrEqual(2);
    expect(carga).toMatch(
      /_conciDeferRefreshForLocalEdits\(\{[\s\S]{0,200}?\}\)\) return;\s*_conciRenderedKey = cacheKey;\s*_renderConciManifiestosTable\(/
    );
  });

  test('toda celda confirmada queda en el borrador local, no sólo la que se teclea', () => {
    const commit = source.slice(
      source.indexOf('function _conciCommitCellRaw'),
      source.indexOf('function _conciRowFechaIso')
    );
    // Los editores de lista y de fecha no pasan por _conciStageCellDraft:
    // confirman su valor aquí. Sin esta línea vivían sólo en el DOM.
    expect(commit).toContain('_conciBorradorGuardarCelda(td, nextRaw)');
    expect(commit).toContain('_conciBorradorQuitarCelda(td)');
  });
});
