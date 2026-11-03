/**
 * @jest-environment jsdom
 *
 * Autoguardado contra un manifiesto ya cerrado por Cierre de Subsecretaría.
 *
 * El trigger de la migración 053 rechaza cualquier UPDATE directo sobre una
 * fila con cierre_id (42501, "Manifiesto N cerrado por Cierre de Subsecretaría
 * (cierre_id=M). Requiere autorización para corregirlo."). El autoguardado lo
 * trataba como un error pasajero: reintento cada pocos segundos, cola del
 * servidor y borrador local que se volvía a mandar en cada carga — la base
 * recibía el mismo rechazo para siempre (incidente del manifiesto 100043).
 *
 * Ahora ese rechazo es definitivo: un intento, sin reintento ni cola, la fila
 * queda en solo lectura y lo capturado se descarta con un aviso que lleva a la
 * corrección autorizada. Un manifiesto ABIERTO se sigue guardando igual.
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

const MENSAJE_TRIGGER = (id) =>
  `Manifiesto ${id} cerrado por Cierre de Subsecretaría (cierre_id=1). Requiere autorización para corregirlo.`;

const escrituras = [];
const avisos = [];
let estado;

function construirApi() {
  return new Function('document', 'window', 'console', 'escrituras', 'estado', 'avisos', `
    let _conciEditMode = true;
    let _conciPendingAutoSaveCount = 0;
    const _conciRenderCache = { clear() {} };
    let _conciRenderedKey = '';

    function _conciFechaUnicaDelFiltro() { return '28/10/2026'; }
    function _conciCurrentUserDisplayName() { return 'MJ'; }
    function _conciCanCurrentUserEdit() { return true; }
    function _conciRenderCapturoCell() {}
    function _conciSettleSavedCells(tr, cells) {
      cells.forEach(td => td.removeAttribute('data-dirty'));
      estado.confirmadas++;
    }
    function _conciBroadcastCambioGuardado() {}
    function _conciProgramarReintento() { estado.reintentos++; }
    function _conciReiniciarEsperaReintento() {}
    function _conciMaybeApplyDeferredRemoteRefresh() {}
    function _conciBorradorTrasladarFilaNueva() {}
    function _conciMarcarVueloMaterializado() {}
    function _conciFillRowActionCell() {}
    function _conciSaveVirtualAirlineOverride() {}
    function _conciEncolarPendientesDeFila() { estado.encolados++; }
    function _conciDesencolarPendientesDeFila() { estado.desencolados++; }
    function _conciBorradorOlvidarFila() { estado.borradorOlvidado++; }
    function _conciActualizarBotonGuardarTodo() {}
    function _conciAnotar() {}
    function _conciIsCalculatedColumn() { return false; }
    function _conciShouldPersistCalculatedColumn() { return false; }
    function _conciCalculadaDebeEnviarse() { return false; }
    function _conciIsRoutingColumn() { return false; }
    function _conciPrepareValueForDatabase(col, value) { return value; }
    function _conciCoerceNumberCandidate() { return null; }
    function _conciNormalizedColumnName(c) {
      return String(c || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();
    }
    function showNotification(texto, tipo) { avisos.push({ texto, tipo }); }

    // Postgres simulado con el trigger de la migración 053: un UPDATE sobre una
    // fila cerrada, o un upsert cuyo cliente_uuid cae sobre una fila cerrada,
    // responde 42501. Lo demás se guarda normal.
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
          escrituras.push({ op: st.op, id: st.id, payload: { ...st.datos } });
          if (st.op === 'update') {
            if (estado.cerrados.includes(st.id)) {
              return { data: null, error: { code: '42501', message: ${JSON.stringify(MENSAJE_TRIGGER('__ID__'))}.replace('__ID__', st.id) } };
            }
            if (estado.errorRls) {
              return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "Conciliación Manifiestos"' } };
            }
            return { data: { id: st.id, ...st.datos }, error: null };
          }
          const uuid = st.datos && st.datos.cliente_uuid;
          if (st.op === 'upsert' && uuid && estado.uuidCerrados[uuid]) {
            const id = estado.uuidCerrados[uuid];
            return { data: null, error: { code: '42501', message: ${JSON.stringify(MENSAJE_TRIGGER('__ID__'))}.replace('__ID__', id) } };
          }
          return { data: { id: 900, ...st.datos }, error: null };
        }
        return api;
      }
    };

    ${extraer('_conciNormalizeEditableCellText')}
    ${extraer('_conciAirlinePayloadEntry')}
    ${extraer('_conciFilaNuevaListaParaGuardar')}
    ${extraer('_conciErrorEsperaCorreccion')}
    ${extraer('_conciErrorManifiestoCerrado')}
    const _conciFilasCerradas = new Set();
    ${extraer('_conciFilaEstaCerrada')}
    ${extraer('_conciBloquearFilaCerrada')}
    ${extraer('_conciNumeroComparable')}
    ${extraer('_conciAdoptarFilaPersistida')}
    ${extraer('_conciDatabaseValueEquals')}
    ${extraer('_conciPersistenceMismatch')}
    ${extraer('_conciMovementKeyFromDuplicateError')}
    ${extraer('_conciIsMovementKeyDuplicate')}
    ${extraer('_conciFilaExisteEnBase')}
    ${extraer('_conciFindExistingMovementRowId')}
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
    return { _conciAutoSaveRow, _conciErrorManifiestoCerrado, _conciFilaEstaCerrada };
  `)(document, window, console, escrituras, estado, avisos);
}

const COLUMNAS = ['FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'TOTAL PAX', 'CAPTURÓ'];

function montarFila({ rowId = '', fuente = '', vueloId = '', valores = {} } = {}) {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  if (fuente) tr.dataset.rowFuente = fuente;
  if (vueloId) {
    tr.dataset.conciVueloId = vueloId;
    tr.dataset.conciVueloDireccion = 'A';
  }
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    const valor = valores[col] ?? '';
    td.dataset.raw = valor;
    td.dataset.origRaw = valor;
    td.textContent = valor;
    tr.appendChild(td);
  });
  document.querySelector('tbody').appendChild(tr);
  return tr;
}

const VALORES = { FECHA: '27/10/2026', AEROLINEA: 'VIVA AEROBUS', 'MATRÍCULA': 'XA-VBA', '# DE VUELO': '1234', 'TOTAL PAX': '150', 'CAPTURÓ': 'MJ' };

function capturar(tr, col, valor) {
  const td = [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);
  td.dataset.pendingRaw = valor;
  td.dataset.raw = valor;
  td.textContent = valor;
  if (valor !== td.dataset.origRaw) td.dataset.dirty = '1';
  return td;
}

let api;
beforeEach(() => {
  escrituras.length = 0;
  avisos.length = 0;
  estado = {
    cerrados: [],
    uuidCerrados: {},
    errorRls: false,
    reintentos: 0,
    encolados: 0,
    desencolados: 0,
    borradorOlvidado: 0,
    confirmadas: 0,
  };
  document.body.innerHTML = '';
  api = construirApi();
});

describe('reconocer el rechazo del trigger de cierre', () => {
  test('el 42501 con el texto del trigger es un manifiesto cerrado', () => {
    expect(api._conciErrorManifiestoCerrado({ code: '42501', message: MENSAJE_TRIGGER(100043) })).toBe(true);
  });

  test('un 42501 de RLS NO lo es: ése sí puede resolverse solo y se reintenta', () => {
    expect(api._conciErrorManifiestoCerrado({ code: '42501', message: 'permission denied for table x' })).toBe(false);
    expect(api._conciErrorManifiestoCerrado({ code: '23505', message: MENSAJE_TRIGGER(1) })).toBe(false);
    expect(api._conciErrorManifiestoCerrado(null)).toBe(false);
  });
});

describe('manifiesto ABIERTO: el autoguardado sigue funcionando', () => {
  test('actualiza por id con UPDATE (no upsert), sin reintentos ni cola', async () => {
    const tr = montarFila({ rowId: '200', valores: VALORES });
    capturar(tr, 'TOTAL PAX', '160');

    await api._conciAutoSaveRow(tr);

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toMatchObject({ op: 'update', id: '200', payload: { 'TOTAL PAX': '160' } });
    expect(estado.confirmadas).toBe(1);
    expect(estado.reintentos).toBe(0);
    expect(estado.encolados).toBe(0);
    expect(api._conciFilaEstaCerrada(tr)).toBe(false);
  });

  test('un 42501 que no viene del cierre conserva el reintento de siempre', async () => {
    estado.errorRls = true;
    const tr = montarFila({ rowId: '200', valores: VALORES });
    capturar(tr, 'TOTAL PAX', '160');

    await api._conciAutoSaveRow(tr);

    expect(estado.reintentos).toBe(1);
    expect(api._conciFilaEstaCerrada(tr)).toBe(false);
  });
});

describe('manifiesto CERRADO: rechazo definitivo', () => {
  test('un solo intento: sin reintento, sin cola del servidor', async () => {
    estado.cerrados = ['100043'];
    const tr = montarFila({ rowId: '100043', valores: VALORES });
    capturar(tr, 'TOTAL PAX', '');

    await api._conciAutoSaveRow(tr);

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].op).toBe('update');
    expect(estado.reintentos).toBe(0);
    expect(estado.encolados).toBe(0);
  });

  test('la fila queda en solo lectura y lo capturado sale de pantalla, borrador y cola', async () => {
    estado.cerrados = ['100043'];
    const tr = montarFila({ rowId: '100043', valores: VALORES });
    const td = capturar(tr, 'TOTAL PAX', '');

    await api._conciAutoSaveRow(tr);

    expect(tr.dataset.conciCerrado).toBe('1');
    expect(tr.querySelector('td[data-dirty="1"]')).toBeNull();
    expect(td.dataset.raw).toBe('150');
    expect(td.textContent).toBe('150');
    expect(estado.borradorOlvidado).toBeGreaterThan(0);
    expect(estado.desencolados).toBeGreaterThan(0);
  });

  test('el aviso dice que está cerrado y lleva a la corrección autorizada', async () => {
    estado.cerrados = ['100043'];
    const tr = montarFila({ rowId: '100043', valores: VALORES });
    capturar(tr, 'TOTAL PAX', '');

    await api._conciAutoSaveRow(tr);

    const aviso = avisos.find(a => /cerrado por Cierre de Subsecretar/i.test(a.texto));
    expect(aviso).toBeDefined();
    expect(aviso.tipo).toBe('warning');
    expect(aviso.texto).toMatch(/100043/);
    expect(aviso.texto).toMatch(/TOTAL PAX/);
    expect(aviso.texto).toMatch(/candado|solicitar corrección/i);
  });

  test('capturas posteriores en la misma fila ya no llegan a la base', async () => {
    estado.cerrados = ['100043'];
    const tr = montarFila({ rowId: '100043', valores: VALORES });
    capturar(tr, 'TOTAL PAX', '');
    await api._conciAutoSaveRow(tr);

    capturar(tr, 'MATRÍCULA', 'XA-ZZZ');
    await api._conciAutoSaveRow(tr);
    await api._conciAutoSaveRow(tr);

    expect(escrituras).toHaveLength(1);
    expect(estado.reintentos).toBe(0);
  });

  test('un nodo nuevo tras un repintado hereda el bloqueo por su id', async () => {
    estado.cerrados = ['100043'];
    const tr = montarFila({ rowId: '100043', valores: VALORES });
    capturar(tr, 'TOTAL PAX', '');
    await api._conciAutoSaveRow(tr);

    const repintada = montarFila({ rowId: '100043', valores: VALORES });
    capturar(repintada, 'TOTAL PAX', '170');
    await api._conciAutoSaveRow(repintada);

    expect(escrituras).toHaveLength(1);
  });

  test('una fila que el render ya marcó como cerrada no intenta escribir nunca', async () => {
    const tr = montarFila({ rowId: '100043', valores: VALORES });
    tr.dataset.conciCerrado = '1';
    capturar(tr, 'TOTAL PAX', '170');

    await api._conciAutoSaveRow(tr);

    expect(escrituras).toHaveLength(0);
    expect(estado.reintentos).toBe(0);
    expect(tr.querySelector('td[data-dirty="1"]')).toBeNull();
  });

  test('vuelo sin id cuyo manifiesto ya está cerrado: no se reinserta ni se reintenta', async () => {
    const tr = montarFila({ fuente: 'Solo Vuelos', vueloId: '777', valores: VALORES });
    // El nombre propio del vuelo es determinista: es el mismo con el que se
    // creó el manifiesto que hoy está cerrado.
    capturar(tr, 'TOTAL PAX', '170');
    await api._conciAutoSaveRow(tr);
    // La primera vez no hay cierre: se crea. Simulamos que después lo cerraron
    // y que esta pantalla sigue viendo el vuelo como "Solo Vuelos".
    escrituras.length = 0;
    estado.uuidCerrados[tr.dataset.clienteUuid] = '100043';

    const otra = montarFila({ fuente: 'Solo Vuelos', vueloId: '777', valores: VALORES });
    capturar(otra, 'TOTAL PAX', '180');
    await api._conciAutoSaveRow(otra);
    capturar(otra, 'TOTAL PAX', '190');
    await api._conciAutoSaveRow(otra);

    expect(escrituras).toHaveLength(1);
    expect(escrituras.every(e => e.op !== 'insert')).toBe(true);
    expect(estado.reintentos).toBe(0);
    expect(estado.encolados).toBe(0);
  });
});
