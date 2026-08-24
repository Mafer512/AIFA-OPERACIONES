/**
 * @jest-environment jsdom
 *
 * "No se guarda nada en Conciliación > Manifiestos."
 *
 * Eran dos fallos encadenados en la misma comprobación.
 *
 * 1) Tras escribir, el módulo relee la fila que devuelve Supabase y compara
 *    valor por valor contra lo que mandó. La celda manda SIEMPRE texto
 *    ("1.50", "07", "+15"); una columna numérica devuelve el número ya
 *    normalizado (1.5, 7, 15). Comparados como cadenas no coincidían, así que
 *    un guardado que SÍ se escribió se reportaba como fallido: la celda se
 *    quedaba marcada, la fila en "Pendiente de guardar", y el reintento
 *    automático repetía lo mismo indefinidamente.
 *
 * 2) En una fila NUEVA ese falso fallo era peor: el INSERT había creado el
 *    registro, pero como el resultado decía "no ok" la fila nunca adoptaba su
 *    id — seguía creyéndose nueva. El siguiente guardado la volvía a insertar.
 *    Una fila duplicada por cada intento, que es el "se crean filas nuevas"
 *    que se reportó.
 *
 * Y un tercer problema, propio de que varias personas capturen a la vez: cada
 * UPDATE reenviaba SIEMPRE las columnas calculadas que sí se guardan (TOTAL
 * EXENTOS, PAX QUE PAGAN TUA, KG DE CARGA TOTAL, DEMORA +- 15 MIN.) con el
 * valor que tuviera ESTA pantalla. Quien guardaba último reponía en la base los
 * totales viejos de su pantalla aunque no los hubiera tocado: los datos de las
 * dos sesiones se cruzaban. Ahora una columna calculada sólo viaja cuando la
 * captura actual tocó alguno de sus insumos.
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

function extraerConstante(nombre) {
  const inicio = source.indexOf(`const ${nombre}`);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('];', inicio) + 2);
}

// Tipos reales de "Conciliación Manifiestos": estas columnas son numéricas y
// Postgres devuelve el número normalizado, no el texto que se le mandó.
const NUMERICAS = new Set([
  'HRS. CUMPLIDAS', 'TOTAL PAX', 'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS',
  'CONEXIONES', 'OTROS EXENTOS', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'KGS. DE EQUIPAJE',
  'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL', 'CORREO',
]);

const registro = { escrituras: [], avisos: [] };

// Una sesión de captura: su propio DOM comparte la misma fila de base de datos
// que las demás, igual que dos navegadores contra la misma tabla.
function construirSesion(filaEnBase) {
  return new Function('document', 'window', 'console', 'registro', 'NUMERICAS', 'filaEnBase', `
    let _conciEditMode = true;
    let _conciPendingAutoSaveCount = 0;
    let _conciEditFallbackYear = 2026;
    const _conciRenderCache = { clear() {} };
    let _conciRenderedKey = '';

    function _conciFechaUnicaDelFiltro() { return ''; }
    function _conciCurrentUserDisplayName() { return 'MJ'; }
    function _conciCanCurrentUserEdit() { return true; }
    function _conciRenderCapturoCell(td, v) { td.dataset.raw = v; td.dataset.pendingRaw = v; td.textContent = v; }
    function _conciBroadcastCambioGuardado() {}
    function _conciProgramarReintento() { registro.escrituras.push({ tipo: 'REINTENTO' }); }
    function _conciReiniciarEsperaReintento() {}
    function _conciMaybeApplyDeferredRemoteRefresh() {}
    function _conciBorradorTrasladarFilaNueva() {}
    function _conciBorradorOlvidarFila() {}
    function _conciBorradorQuitarCelda() {}
    function _conciFillRowActionCell() {}
    function _conciEncolarPendientesDeFila() { registro.escrituras.push({ tipo: 'ENCOLADO' }); }
    function _conciDesencolarPendientesDeFila() {}
    function _conciActualizarBotonGuardarTodo() {}
    function _conciSaveVirtualAirlineOverride() {}
    function showNotification(texto, tipo) { registro.avisos.push({ texto: texto, tipo: tipo }); }

    // Postgres normaliza lo que recibe: "1.50" se guarda y se devuelve como 1.5.
    function coerce(col, val) {
      if (val === null || val === undefined) return null;
      if (NUMERICAS.has(col)) {
        const n = Number(String(val).trim());
        if (!Number.isFinite(n)) {
          const e = new Error('invalid input syntax for type numeric: "' + val + '"');
          e.code = '22P02';
          throw e;
        }
        return n;
      }
      return String(val);
    }

    window.supabaseClient = {
      from() {
        const st = { op: null, datos: null, id: null };
        const api = {
          select() { return api; },
          eq(c, v) { st.id = v; return api; },
          maybeSingle() { return api; },
          insert(d) { st.op = 'insert'; st.datos = d; return api; },
          update(d) { st.op = 'update'; st.datos = d; return api; },
          then(res, rej) { return run().then(res, rej); },
        };
        async function run() {
          registro.escrituras.push({
            tipo: st.op ? st.op.toUpperCase() : 'SELECT',
            id: st.id,
            columnas: st.datos ? Object.keys(st.datos) : null,
          });
          if (!st.op) return { data: filaEnBase, error: null };
          try {
            const fila = st.op === 'insert' ? { id: 9999 } : Object.assign({}, filaEnBase);
            Object.keys(st.datos).forEach(c => { fila[c] = coerce(c, st.datos[c]); });
            Object.assign(filaEnBase, fila);
            return { data: fila, error: null };
          } catch (e) {
            return { data: null, error: { message: e.message, code: e.code } };
          }
        }
        return api;
      }
    };

    ${extraer('_conciNormalizedColumnName')}
    ${extraer('_conciNormalizeEditableCellText')}
    ${extraer('_conciSummaryColumnKey')}
    ${extraer('_conciIsRoutingColumn')}
    ${extraer('_conciIsCalculatedColumn')}
    ${extraer('_conciShouldPersistCalculatedColumn')}
    ${extraerConstante('_CONCI_INSUMOS_CALCULADAS')}
    ${extraer('_conciCalculadaDebeEnviarse')}
    ${extraer('_conciNumeroComparable')}
    ${extraer('_conciAdoptarFilaPersistida')}
    ${extraer('_conciPrepareValueForDatabase')}
    ${extraer('_conciCoerceNumberCandidate')}
    ${extraer('_conciAirlinePayloadEntry')}
    ${extraer('_conciFilaNuevaListaParaGuardar')}
    ${extraer('_conciErrorEsperaCorreccion')}
    ${extraer('_conciDatabaseValueEquals')}
    ${extraer('_conciPersistenceMismatch')}
    ${extraer('_conciPayloadIdentityValue')}
    ${extraer('_conciMovementKeyFromPayload')}
    ${extraer('_conciMovementKeyFromDuplicateError')}
    ${extraer('_conciIsMovementKeyDuplicate')}
    ${extraer('_conciFindExistingMovementRowId')}
    ${extraer('_conciFilaExisteEnBase')}
    ${extraer('_conciSettleSavedCells')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciWriteRowSafe')}
    ${extraer('_conciAutoSaveRow')}
    return { _conciAutoSaveRow: _conciAutoSaveRow };
  `)(document, window, console, registro, NUMERICAS, filaEnBase);
}

const COLUMNAS = [
  'CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'TIPO DE OPERACIÓN',
  'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA', '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA',
  'SLOT ASIGNADO', 'SLOT COORDINADO', 'HR. DE OPERACIÓN', 'HR. DE RECEPCIÓN', 'HRS. CUMPLIDAS',
  'TOTAL PAX', 'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS', 'CONEXIONES', 'OTROS EXENTOS',
  'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'KGS. DE EQUIPAJE', 'KGS. DE CARGA NACIONAL',
  'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL', 'CORREO', 'PUNTUALIDAD / CANCELACIÓN',
  'DEMORA +- 15 MIN.', 'CÓDIGO DEMORA', 'OBSERVACIONES', 'CAPTURÓ',
];

function construirFila(valores, opciones = {}) {
  const tbody = document.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = opciones.nueva ? '' : '123';
  if (opciones.nueva) tr.dataset.conciNew = '1';
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    const v = valores[col] !== undefined ? String(valores[col]) : '';
    td.dataset.raw = v; td.dataset.origRaw = v; td.dataset.pendingRaw = v; td.textContent = v;
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

function editar(tr, col, valor) {
  const td = [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);
  td.dataset.pendingRaw = valor; td.dataset.raw = valor; td.textContent = valor;
  td.dataset.dirty = '1';
  return td;
}

function celda(tr, col) {
  return [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);
}

const escrituras = (tipo) => registro.escrituras.filter(e => e.tipo === tipo);

beforeEach(() => {
  registro.escrituras.length = 0;
  registro.avisos.length = 0;
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
});

describe('un valor que Postgres normaliza cuenta como guardado', () => {
  test('"1.50" en una columna numérica se da por guardado, no por fallido', async () => {
    const enBase = { id: 123, 'KGS. DE EQUIPAJE': 0 };
    const api = construirSesion(enBase);
    const tr = construirFila({ AEROLINEA: 'VB', '# DE VUELO': '1234' });
    editar(tr, 'KGS. DE EQUIPAJE', '1.50');

    await api._conciAutoSaveRow(tr);

    expect(enBase['KGS. DE EQUIPAJE']).toBe(1.5);
    expect(registro.avisos).toEqual([]);
    expect(tr.getAttribute('title')).toBeNull();
    expect(tr.classList.contains('table-secondary')).toBe(false);
    // La celda deja de estar marcada: lo capturado ya está a salvo.
    expect(celda(tr, 'KGS. DE EQUIPAJE').dataset.dirty).toBeUndefined();
    expect(escrituras('REINTENTO')).toHaveLength(0);
    expect(escrituras('ENCOLADO')).toHaveLength(0);
  });

  test('un cero a la izquierda tampoco invalida el guardado', async () => {
    const enBase = { id: 123, 'TOTAL PAX': 0 };
    const api = construirSesion(enBase);
    const tr = construirFila({ AEROLINEA: 'VB' });
    editar(tr, 'TOTAL PAX', '007');

    await api._conciAutoSaveRow(tr);

    expect(enBase['TOTAL PAX']).toBe(7);
    expect(registro.avisos).toEqual([]);
    expect(celda(tr, 'TOTAL PAX').dataset.dirty).toBeUndefined();
  });

  test('un valor de texto que de verdad no se escribió sí se sigue detectando', async () => {
    const api = construirSesion({ id: 123 });
    const helpers = new Function(`
      ${extraer('_conciNumeroComparable')}
      ${extraer('_conciDatabaseValueEquals')}
      ${extraer('_conciPersistenceMismatch')}
      return _conciPersistenceMismatch;
    `)();
    expect(helpers({ id: 1, OBSERVACIONES: 'lo viejo' }, { OBSERVACIONES: 'lo nuevo' }))
      .toEqual(['OBSERVACIONES']);
    expect(api).toBeTruthy();
  });
});

describe('una fila nueva se crea UNA vez y después se actualiza', () => {
  test('el id se adopta aunque la comprobación de valores no cuadre', async () => {
    const enBase = {};
    const api = construirSesion(enBase);
    const tr = construirFila({}, { nueva: true });
    editar(tr, 'AEROLINEA', 'VB');
    editar(tr, '# DE VUELO', '1234');
    editar(tr, 'KGS. DE EQUIPAJE', '1.50');

    await api._conciAutoSaveRow(tr);
    expect(tr.dataset.rowId).toBe('9999');
    expect(escrituras('INSERT')).toHaveLength(1);

    // Sigue capturando en la misma fila: no puede nacer un segundo registro.
    editar(tr, 'OBSERVACIONES', 'algo más');
    await api._conciAutoSaveRow(tr);

    expect(escrituras('INSERT')).toHaveLength(1);
    expect(escrituras('UPDATE')).toHaveLength(1);
    expect(tr.dataset.rowId).toBe('9999');
    expect(tr.dataset.conciNew).toBeUndefined();
  });
});

describe('varias sesiones capturando a la vez', () => {
  test('cada UPDATE lleva sólo lo que esa persona cambió', async () => {
    const enBase = { id: 123, OBSERVACIONES: null };
    const api = construirSesion(enBase);
    const tr = construirFila({
      AEROLINEA: 'VB', 'TOTAL PAX': '180', 'TOTAL EXENTOS': '4', 'PAX QUE PAGAN TUA': '176',
    });
    editar(tr, 'OBSERVACIONES', 'nota');

    await api._conciAutoSaveRow(tr);

    const columnas = escrituras('UPDATE')[0].columnas;
    expect(columnas).toContain('OBSERVACIONES');
    // Los totales calculados NO viajan: nadie tocó sus insumos en esta captura.
    expect(columnas).not.toContain('TOTAL EXENTOS');
    expect(columnas).not.toContain('PAX QUE PAGAN TUA');
  });

  test('al tocar un exento, el total calculado sí se recalcula y se guarda', async () => {
    const enBase = { id: 123, INFANTES: 0, 'TOTAL EXENTOS': 0, 'PAX QUE PAGAN TUA': 0 };
    const api = construirSesion(enBase);
    const tr = construirFila({ AEROLINEA: 'VB', 'TOTAL PAX': '100', 'TOTAL EXENTOS': '3', 'PAX QUE PAGAN TUA': '97' });
    editar(tr, 'INFANTES', '3');

    await api._conciAutoSaveRow(tr);

    const columnas = escrituras('UPDATE')[0].columnas;
    expect(columnas).toContain('INFANTES');
    expect(columnas).toContain('TOTAL EXENTOS');
    expect(columnas).toContain('PAX QUE PAGAN TUA');
    expect(enBase['TOTAL EXENTOS']).toBe(3);
    expect(enBase['PAX QUE PAGAN TUA']).toBe(97);
  });

  test('una pantalla vieja no repone los totales que otra sesión acaba de capturar', async () => {
    const enBase = { id: 123, OBSERVACIONES: null, 'TOTAL PAX': 0, 'TOTAL EXENTOS': 0, 'PAX QUE PAGAN TUA': 0 };

    // Sesión 1 captura los pasajeros del vuelo.
    const sesion1 = construirSesion(enBase);
    const fila1 = construirFila({ AEROLINEA: 'VB', 'TOTAL PAX': '0', 'TOTAL EXENTOS': '0', 'PAX QUE PAGAN TUA': '0' });
    editar(fila1, 'TOTAL PAX', '180');
    editar(fila1, 'INFANTES', '4');
    // Lo que la fórmula deja en pantalla al recalcular esos insumos.
    celda(fila1, 'TOTAL EXENTOS').dataset.raw = '4';
    celda(fila1, 'TOTAL EXENTOS').dataset.pendingRaw = '4';
    celda(fila1, 'PAX QUE PAGAN TUA').dataset.raw = '176';
    celda(fila1, 'PAX QUE PAGAN TUA').dataset.pendingRaw = '176';
    await sesion1._conciAutoSaveRow(fila1);

    expect(enBase['TOTAL EXENTOS']).toBe(4);
    expect(enBase['PAX QUE PAGAN TUA']).toBe(176);

    // Sesión 2 tenía la pantalla anterior (todo en cero) y sólo escribe una nota.
    const sesion2 = construirSesion(enBase);
    const fila2 = construirFila({ AEROLINEA: 'VB', 'TOTAL PAX': '0', 'TOTAL EXENTOS': '0', 'PAX QUE PAGAN TUA': '0' });
    editar(fila2, 'OBSERVACIONES', 'nota de la otra sesión');
    await sesion2._conciAutoSaveRow(fila2);

    expect(enBase.OBSERVACIONES).toBe('nota de la otra sesión');
    // Lo capturado por la sesión 1 sigue intacto: los datos no se cruzaron.
    expect(enBase['TOTAL PAX']).toBe(180);
    expect(enBase.INFANTES).toBe(4);
    expect(enBase['TOTAL EXENTOS']).toBe(4);
    expect(enBase['PAX QUE PAGAN TUA']).toBe(176);
  });
});
