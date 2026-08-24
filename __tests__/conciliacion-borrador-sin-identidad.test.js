/**
 * @jest-environment jsdom
 *
 * "¿Esas filas vacías se crean en la base de datos, o sólo se agregan al
 * DOM mediante JavaScript?"
 *
 * Respuesta, con evidencia: sólo en el DOM. Nunca tocan la base.
 *
 * El mecanismo: cada celda capturada se respalda en localStorage bajo una
 * clave "nueva:xxx" mientras la fila no tiene id. Dos correcciones anteriores,
 * hechas por separado, dejaban un hueco al combinarse:
 *
 *  - La guarda de _conciWriteRowSafe (ver _conciEsColumnaIdentidad) exige una
 *    columna de IDENTIDAD (aerolínea, matrícula, # de vuelo, tipo de
 *    manifiesto, aeronave, destino/origen, total de pasajeros) antes de crear
 *    una fila nueva. Tocar sólo FECHA, MES o CIERRE SUBSECRETARIA no basta.
 *
 *  - La limpieza de borradores huérfanos (ver _conciBorradorPuedeLlegarAGuardarse)
 *    sólo descartaba un borrador "nueva:" si TODAS sus celdas estaban vacías.
 *
 *  Un borrador con sólo FECHA no está vacío (así que la limpieza no lo tocaba)
 *  pero tampoco tiene identidad (así que nunca puede guardarse). Quedaba en
 *  una tierra de nadie: _conciRestaurarFilasNuevas lo repone en CADA render
 *  como una fila nueva, el autoguardado la rechaza de inmediato por falta de
 *  identidad, y el ciclo se repite para siempre — un fantasma que vive
 *  únicamente en el DOM, confirmado aquí con el _conciWriteRowSafe real: cero
 *  INSERTs llegan nunca a la base por esta vía.
 *
 *  La corrección: el criterio para "¿este borrador es papel muerto?" pasa a
 *  ser el mismo que usa la guarda de guardado — ¿tiene alguna columna de
 *  identidad con contenido? — no "¿tiene algún valor, cualquiera que sea?".
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
function constante(nombre) {
  const i = source.indexOf(`const ${nombre}`);
  if (i === -1) throw new Error(`No se encontró ${nombre}`);
  return source.slice(i, source.indexOf('\n', i) + 1);
}

const inserts = [];

function construirApi() {
  return new Function('document', 'localStorage', 'inserts', `
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
    function _conciFillRowActionCell() {}
    function _conciSaveVirtualAirlineOverride() {}
    function _conciEncolarPendientesDeFila() {}
    function _conciDesencolarPendientesDeFila() {}
    function _conciIsCalculatedColumn() { return false; }
    function _conciShouldPersistCalculatedColumn() { return false; }
    function _conciCalculadaDebeEnviarse() { return false; }
    function _conciAnotar() {}
    function _conciIsRoutingColumn() { return false; }
    function _conciPrepareValueForDatabase(col, value) { return value; }
    function _conciCoerceNumberCandidate() { return null; }
    function _conciNormalizedColumnName(c){ return String(c||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim(); }
    function _conciActualizarIndicadorBorradores() {}
    function _conciRefreshCalculatedCellsForRow() {}
    function _conciQueueAutoSave() {}
    function showNotification() {}

    // Postgres simulado: registra cada INSERT que de verdad llega a la base.
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

    ${constante('_CONCI_BORRADORES_KEY')}
    ${constante('_CONCI_BORRADORES_VIGENCIA_MS')}
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
    ${extraer('_conciSummaryColumnKey')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciBorradorPuedeLlegarAGuardarse')}
    ${extraer('_conciWriteRowSafe')}
    ${extraer('_conciAutoSaveRow')}
    ${extraer('_conciBorradoresLeer')}
    ${extraer('_conciBorradoresEscribir')}
    ${extraer('_conciBorradoresPurgar')}
    ${extraer('_conciBorradorGuardarCelda')}
    ${extraer('_conciBorradorClaveFila')}
    ${extraer('_conciBorradorTrasladarFilaNueva')}
    function _conciAddBlankRow() {
      const tbody = document.querySelector('#table-conci-manifiestos tbody');
      const tr = document.createElement('tr');
      tr.dataset.conciNew = '1';
      tr.dataset.rowId = '';
      ['MES', 'FECHA', 'CIERRE SUBSECRETARIA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'CAPTURÓ'].forEach(col => {
        const td = document.createElement('td');
        td.dataset.col = col;
        td.dataset.raw = ''; td.dataset.origRaw = ''; td.dataset.pendingRaw = '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      return tr;
    }
    ${extraer('_conciRestaurarFilasNuevas')}
    return {
      _conciAutoSaveRow, _conciAddBlankRow, _conciRestaurarFilasNuevas,
      _conciBorradoresLeer, _conciBorradorGuardarCelda, _conciBorradoresPurgar,
    };
  `)(document, window.localStorage, inserts);
}

function tocar(tr, api, col, valor) {
  const td = tr.querySelector('td[data-col="' + col + '"]');
  td.dataset.pendingRaw = valor;
  td.dataset.raw = valor;
  td.textContent = valor;
  td.dataset.dirty = '1';
  api._conciBorradorGuardarCelda(td, valor);
  return td;
}

let api;
beforeEach(() => {
  inserts.length = 0;
  window.localStorage.clear();
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  api = construirApi();
});

describe('un borrador sin identidad no resucita en el DOM ni toca la base', () => {
  test('sólo FECHA: la guarda rechaza el guardado y el borrador se purga', async () => {
    const tr = api._conciAddBlankRow();
    tocar(tr, api, 'FECHA', '17/08/2026');

    await api._conciAutoSaveRow(tr);
    expect(inserts).toEqual([]);   // nunca llegó a la base

    const vivos = api._conciBorradoresPurgar();
    expect(Object.keys(vivos).filter(c => c.startsWith('nueva:'))).toHaveLength(0);
  });

  test('sólo CIERRE SUBSECRETARIA: tampoco resucita', async () => {
    const tr = api._conciAddBlankRow();
    tocar(tr, api, 'CIERRE SUBSECRETARIA', '20/08/2026');

    await api._conciAutoSaveRow(tr);
    expect(inserts).toEqual([]);

    const vivos = api._conciBorradoresPurgar();
    expect(Object.keys(vivos).filter(c => c.startsWith('nueva:'))).toHaveLength(0);
  });

  test('el ciclo completo: agregar, tocar sólo FECHA, refrescar dos veces seguidas — nunca aparece una fila fantasma', async () => {
    const tr = api._conciAddBlankRow();
    tocar(tr, api, 'FECHA', '17/08/2026');
    await api._conciAutoSaveRow(tr);

    // "Refrescar" = tabla vacía + reponer lo que siga en el borrador local.
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
      const vivos = api._conciBorradoresPurgar();
      const repuestas = api._conciRestaurarFilasNuevas(vivos);
      expect(repuestas).toBe(0);
      expect(document.querySelectorAll('#table-conci-manifiestos tbody tr')).toHaveLength(0);
    }

    // En ningún momento del ciclo se insertó nada en la base.
    expect(inserts).toEqual([]);
  });
});

describe('un borrador CON identidad se sigue comportando igual que antes', () => {
  test('FECHA + AEROLINEA: se guarda y el borrador se purga tras confirmarse', async () => {
    const tr = api._conciAddBlankRow();
    tocar(tr, api, 'FECHA', '17/08/2026');
    tocar(tr, api, 'AEROLINEA', 'VIVA AEROBUS');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]['AEROLINEA']).toBe('VIVA AEROBUS');
  });

  test('sólo TOTAL PAX: sigue bastando para crear la fila', async () => {
    const tr = api._conciAddBlankRow();
    // TOTAL PAX no está entre las columnas de _conciAddBlankRow local; se
    // agrega a mano para esta prueba puntual.
    const td = document.createElement('td');
    td.dataset.col = 'TOTAL PAX';
    td.dataset.raw = ''; td.dataset.origRaw = ''; td.dataset.pendingRaw = '';
    tr.appendChild(td);
    tocar(tr, api, 'TOTAL PAX', '186');

    await api._conciAutoSaveRow(tr);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]['TOTAL PAX']).toBe('186');
  });
});
