/**
 * @jest-environment jsdom
 *
 * "Al terminar de capturar y refrescar, sigue saliendo una fila en blanco."
 *
 * El fix de la fila fantasma (557ef41) y el de la fila borrada por otro
 * (37c3029) no cubrían este caso: FECHA y MES resultaron NO estar bloqueadas
 * en una fila nueva (_conciIsProtectedEditColumn siempre devuelve false), así
 * que tocar sólo FECHA -o CIERRE SUBSECRETARIA, como al probar algo a mano-
 * contaba como "el usuario capturó algo" y la fila se creaba igual: en blanco,
 * con ESTATUS MATRÍCULA "NO IDENTIFICADA", indistinguible de la fila fantasma
 * original para quien la ve en pantalla.
 *
 * La regla correcta: sólo lo que identifica un vuelo (aerolínea, matrícula, #
 * de vuelo, tipo de manifiesto, aeronave, destino/origen, total de pasajeros)
 * justifica crear un registro nuevo. FECHA, MES y CIERRE SUBSECRETARIA son
 * organización, no identidad.
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

const inserts = [];
const avisos = [];

function construirApi() {
  return new Function('document', 'window', 'console', 'inserts', 'avisos', `
    let _conciEditMode = true;
    let _conciPendingAutoSaveCount = 0;
    const _conciRenderCache = { clear() {} };
    let _conciRenderedKey = '';

    function _conciFechaUnicaDelFiltro() { return ''; }
    function _conciCurrentUserDisplayName() { return 'MJ'; }
    function _conciCanCurrentUserEdit() { return true; }
    function _conciRenderCapturoCell() {}
    function _conciSettleSavedCells() {}
    function _conciBroadcastCambioGuardado() {}
    function _conciProgramarReintento() {}
    function _conciReiniciarEsperaReintento() {}
    function _conciMaybeApplyDeferredRemoteRefresh() {}
    function _conciBorradorTrasladarFilaNueva() {}
    function _conciFillRowActionCell() {}
    function _conciSaveVirtualAirlineOverride() {}
    function _conciEncolarPendientesDeFila() {}
    function _conciIsCalculatedColumn() { return false; }
    function _conciShouldPersistCalculatedColumn() { return false; }
    function _conciCalculadaDebeEnviarse() { return false; }
    function _conciIsRoutingColumn() { return false; }
    function _conciPrepareValueForDatabase(col, value) { return value; }
    function _conciCoerceNumberCandidate() { return null; }
    function _conciNormalizedColumnName(c){ return String(c||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim(); }
    function showNotification(texto, tipo) { avisos.push({ texto, tipo }); }

    window.supabaseClient = {
      from() {
        const st = { op: null, datos: null };
        const api = {
          select(){ return api; }, eq(){ return api; }, maybeSingle(){ return api; },
          insert(d){ st.op='insert'; st.datos=d; return api; },
          update(d){ st.op='update'; st.datos=d; return api; },
          then(res, rej){ return run().then(res, rej); },
        };
        async function run() {
          if (st.op === 'insert') {
            inserts.push({ ...st.datos });
            return { data: { id: 9999, ...st.datos }, error: null };
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
    ${extraer('_conciFilaExisteEnBase')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciSummaryColumnKey')}
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciWriteRowSafe')}
    ${extraer('_conciAutoSaveRow')}
    return { _conciAutoSaveRow };
  `)(document, window, console, inserts, avisos);
}

const COLUMNAS = ['CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'TOTAL PAX', 'CAPTURÓ'];

function agregarFila() {
  document.body.innerHTML = `<table id="table-conci-manifiestos"><tbody></tbody></table>`;
  const tbody = document.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = '';
  tr.dataset.conciNew = '1';
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    td.dataset.raw = ''; td.dataset.origRaw = ''; td.dataset.pendingRaw = '';
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

function capturar(tr, col, valor) {
  const td = [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);
  td.dataset.pendingRaw = valor; td.dataset.raw = valor; td.textContent = valor;
  if (valor !== td.dataset.origRaw) td.dataset.dirty = '1';
  return td;
}

let api;
beforeEach(() => {
  inserts.length = 0;
  avisos.length = 0;
  document.body.innerHTML = '';
  api = construirApi();
});

describe('tocar sólo un campo de organización no crea la fila', () => {
  test('sólo FECHA: no se crea ningún registro', async () => {
    const tr = agregarFila();
    capturar(tr, 'FECHA', '17/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toEqual([]);
    expect(tr.dataset.rowId).toBe('');
  });

  test('sólo MES: no se crea ningún registro', async () => {
    const tr = agregarFila();
    capturar(tr, 'MES', 'Agosto');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toEqual([]);
  });

  test('sólo CIERRE SUBSECRETARIA (ej. una prueba a mano): no se crea ningún registro', async () => {
    const tr = agregarFila();
    capturar(tr, 'CIERRE SUBSECRETARIA', '20/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toEqual([]);
  });

  test('FECHA + MES + CIERRE SUBSECRETARIA juntos, sin nada de identidad: tampoco', async () => {
    const tr = agregarFila();
    capturar(tr, 'FECHA', '17/08/2026');
    capturar(tr, 'MES', 'Agosto');
    capturar(tr, 'CIERRE SUBSECRETARIA', '20/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toEqual([]);
  });

  test('el aviso explica qué hace falta, en vez de fallar en silencio', async () => {
    const tr = agregarFila();
    capturar(tr, 'FECHA', '17/08/2026');

    await api._conciAutoSaveRow(tr);

    const texto = avisos.map(a => a.texto).join(' | ');
    expect(texto).toMatch(/aerol[ií]nea/i);
    expect(texto).toMatch(/matr[ií]cula/i);
  });

  test('nada se pierde: el dato tecleado sigue a la vista y marcado como pendiente', async () => {
    const tr = agregarFila();
    const td = capturar(tr, 'FECHA', '17/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(td.textContent).toBe('17/08/2026');
    expect(td.dataset.dirty).toBe('1');
  });
});

describe('en cuanto llega algo que identifica el vuelo, sí se crea', () => {
  test('FECHA + AEROLINEA: la fila nace con ambos datos', async () => {
    const tr = agregarFila();
    capturar(tr, 'FECHA', '17/08/2026');
    capturar(tr, 'AEROLINEA', 'VIVA AEROBUS');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]['FECHA']).toBe('17/08/2026');
    expect(inserts[0]['AEROLINEA']).toBe('VIVA AEROBUS');
  });

  test('sólo TOTAL PAX (identidad, aunque numérica) basta', async () => {
    const tr = agregarFila();
    capturar(tr, 'TOTAL PAX', '186');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]['TOTAL PAX']).toBe('186');
  });
});
