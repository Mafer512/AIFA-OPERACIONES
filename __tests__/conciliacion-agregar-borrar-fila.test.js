/**
 * @jest-environment jsdom
 *
 * El ciclo completo agregar → capturar → borrar, ejecutando el autoguardado
 * real de Conciliación Manifiestos contra una base simulada.
 *
 * Reproduce el escenario reportado: se agrega una fila con "+ Agregar fila",
 * el cursor queda abierto en la primera celda editable y el usuario hace clic
 * en otra parte sin escribir nada. Antes eso insertaba un registro con sólo la
 * fecha del filtro y el capturista — la "fila fantasma" en blanco con ESTATUS
 * MATRÍCULA "NO IDENTIFICADA" que además subía el contador de registros.
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

// Lo que la base recibió. Cada elemento es { payload, rowId }.
const escrituras = [];
let siguienteId = 1000;

// Se reconstruye por test: el autoguardado real lleva estado propio
// (_conciPendingAutoSaveCount) que no debe arrastrarse de un caso a otro.
function construirApi() {
  return new Function('document', 'window', 'console', 'escrituras', 'siguienteId', `
    let _conciEditMode = true;
    const _conciRenderCache = { clear() {} };
    let _conciRenderedKey = '';
    let _conciPendingAutoSaveCount = 0;
    // El autoguardado exige un cliente antes de escribir; quien registra las
    // escrituras es el _conciWriteRowSafe simulado de más abajo.
    window.supabaseClient = {};

    function _conciFechaUnicaDelFiltro() { return '2026-08-12'; }
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
    function _conciIsCalculatedColumn() { return false; }
    function _conciShouldPersistCalculatedColumn() { return false; }
    function _conciIsRoutingColumn() { return false; }
    function _conciPrepareValueForDatabase(col, value) { return value; }

    async function _conciWriteRowSafe(client, payload, rowId) {
      escrituras.push({ payload: { ...payload }, rowId: rowId || null });
      return { ok: true, data: { id: rowId || siguienteId }, payload, droppedColumns: [] };
    }

    // La bitácora sólo deja constancia; aquí basta con que exista.
    function _conciAnotar() { }
    ${extraer('_conciNormalizeEditableCellText')}
    ${extraer('_conciAirlinePayloadEntry')}
    ${extraer('_conciFilaNuevaListaParaGuardar')}
    ${extraer('_conciSummaryColumnKey')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciNuevoUuid')}
    ${extraer('_conciUuidDeterminista')}
    ${extraer('_conciAsegurarClienteUuid')}
    ${extraer('_conciClaveEscrituraDeFila')}
    ${extraer('_conciValorSeguroEnSelector')}
    ${extraer('_conciFilaVivaParaClave')}
    ${extraer('_conciPropagarIdPorNombre')}
    const _conciEscriturasEnVuelo = new Map();
    ${extraer('_conciAutoSaveRow')}
    return { _conciAutoSaveRow };
  `)(document, window, console, escrituras, 1000);
}

const COLUMNAS = ['MES', 'FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'CAPTURÓ'];

// Reproduce la fila que deja "+ Agregar fila": todas las celdas vacías,
// data-conci-new="1" y sin id todavía.
function agregarFila() {
  document.body.innerHTML = `<table id="table-conci-manifiestos"><tbody></tbody></table>`;
  const tbody = document.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = '';
  tr.dataset.conciNew = '1';
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    td.dataset.raw = '';
    td.dataset.origRaw = '';
    td.dataset.pendingRaw = '';
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

// Lo que hace _conciCommitCellRaw al cerrarse un editor con un valor escrito.
function capturar(tr, col, valor) {
  const td = [...tr.querySelectorAll('td[data-col]')].find(c => c.dataset.col === col);
  td.dataset.pendingRaw = valor;
  td.dataset.raw = valor;
  td.textContent = valor;
  if (valor !== td.dataset.origRaw) td.dataset.dirty = '1';
  else td.removeAttribute('data-dirty');
  return td;
}

let api2;
beforeEach(() => {
  escrituras.length = 0;
  document.body.innerHTML = '';
  api2 = construirApi();
});

describe('agregar una fila sin capturar nada', () => {
  test('cerrar el editor sin escribir no crea ningún registro', async () => {
    const tr = agregarFila();

    // Exactamente lo que pasa al hacer clic fuera: el editor se cierra y
    // _conciCommitCellRaw llama al autoguardado aunque no haya nada escrito.
    await api2._conciAutoSaveRow(tr);

    expect(escrituras).toEqual([]);
  });

  test('la fila no se queda con un id: nunca llegó a la base', async () => {
    const tr = agregarFila();
    await api2._conciAutoSaveRow(tr);
    expect(tr.dataset.rowId).toBe('');
  });

  test('repetir el ciclo varias veces no deja residuos', async () => {
    for (let i = 0; i < 5; i++) {
      const tr = agregarFila();
      await api2._conciAutoSaveRow(tr);
    }
    expect(escrituras).toEqual([]);
  });

  // Tocar una celda y dejarla vacía tampoco es capturar: sigue siendo la fila
  // en blanco que el usuario acabó por no llenar.
  test('entrar y salir de una celda sin dejar valor tampoco la crea', async () => {
    const tr = agregarFila();
    const td = capturar(tr, 'AEROLINEA', '');
    expect(td.dataset.dirty).toBeUndefined();

    await api2._conciAutoSaveRow(tr);

    expect(escrituras).toEqual([]);
  });
});

describe('agregar una fila y capturar datos', () => {
  test('en cuanto hay un dato real, la fila sí se crea', async () => {
    const tr = agregarFila();
    capturar(tr, 'AEROLINEA', 'VIVA AEROBUS');

    await api2._conciAutoSaveRow(tr);

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].rowId).toBeNull(); // INSERT, no UPDATE
    expect(escrituras[0].payload.AEROLINEA).toBe('VIVA AEROBUS');
  });

  test('la fila creada conserva la fecha heredada del filtro y el capturista', async () => {
    const tr = agregarFila();
    capturar(tr, 'MATRÍCULA', 'XAVBP');

    await api2._conciAutoSaveRow(tr);

    expect(escrituras[0].payload.FECHA).toBe('2026-08-12');
    expect(escrituras[0].payload['CAPTURÓ']).toBe('MJ');
  });

  test('tras crearse queda con id y deja de ser una fila nueva', async () => {
    const tr = agregarFila();
    capturar(tr, 'AEROLINEA', 'CARGOLUX');

    await api2._conciAutoSaveRow(tr);

    expect(tr.dataset.rowId).toBe('1000');
    expect(tr.dataset.conciNew).toBeUndefined();
  });

  // Una vez guardada, seguir editándola actualiza ese mismo registro en vez de
  // insertar otro: es lo que evita los duplicados al agregar y borrar en ciclo.
  test('editarla después actualiza, no duplica', async () => {
    const tr = agregarFila();
    capturar(tr, 'AEROLINEA', 'CARGOLUX');
    await api2._conciAutoSaveRow(tr);

    capturar(tr, '# DE VUELO', 'CV 5933');
    await api2._conciAutoSaveRow(tr);

    expect(escrituras).toHaveLength(2);
    expect(escrituras[1].rowId).toBe('1000');
  });
});

describe('una fila descartada no vuelve por el autoguardado', () => {
  test('marcada como descartada, ya no se escribe nada', async () => {
    const tr = agregarFila();
    capturar(tr, 'AEROLINEA', 'VOLARIS');
    tr.dataset.conciDescartada = '1';

    await api2._conciAutoSaveRow(tr);

    expect(escrituras).toEqual([]);
  });
});
