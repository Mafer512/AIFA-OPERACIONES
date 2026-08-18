/**
 * @jest-environment jsdom
 *
 * Fila fantasma cuando la base RECHAZA lo que se capturó.
 *
 * Síntoma reportado: durante la captura aparecían filas nuevas que nadie pidió,
 * intercaladas en medio de la tabla — en blanco, con sólo la fecha puesta y
 * ESTATUS MATRÍCULA "NO IDENTIFICADA". El contador de arriba las sumaba, así
 * que eran registros reales en la base, no un espejismo del render.
 *
 * La causa NO era la comprobación de "¿el usuario capturó algo?" (esa ya
 * existía y funciona: ver conciliacion-fila-fantasma.test.js). Era lo que pasa
 * DESPUÉS: _conciWriteRowSafe se auto-corrige quitando del payload las columnas
 * que Postgres rechaza —"# DE VUELO" es bigint y el operador escribe "VB 7305",
 * o una columna que ya no existe en el esquema— y vuelve a intentarlo. Cuando
 * esa poda se llevaba TODO lo que el usuario había escrito, lo único que
 * quedaba del INSERT eran los dos rellenos que pone el propio código: la FECHA
 * heredada del filtro y el nombre de quien está en sesión. La fila se creaba
 * igual, vacía, y con la fecha del filtro es justo donde el orden cronológico
 * la deja: en medio de la tabla.
 *
 * Aquí corre el _conciWriteRowSafe de verdad contra un Postgres simulado que
 * rechaza por tipo, como el real.
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

// Todo lo que la base llegó a aceptar. Cada elemento es una fila creada.
const insertados = [];
// Filas ya existentes que se actualizaron.
const actualizados = [];
// Avisos mostrados al usuario.
const avisos = [];

function construirApi() {
  return new Function('document', 'window', 'console', 'insertados', 'actualizados', 'estado', 'avisos', `
    let _conciEditMode = true;
    let _conciPendingAutoSaveCount = 0;
    const _conciRenderCache = { clear() {} };
    let _conciRenderedKey = '';

    function _conciFechaUnicaDelFiltro() { return '17/08/2026'; }
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
    function _conciSaveVirtualAirlineOverride() {}
    function _conciEncolarPendientesDeFila() { estado.encolados++; }
    function _conciIsCalculatedColumn() { return false; }
    function _conciShouldPersistCalculatedColumn() { return false; }
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

    // Postgres simulado: las columnas de estado.rechaza son numéricas y no
    // aceptan texto, igual que "# DE VUELO" (bigint) en la base real.
    window.supabaseClient = {
      from() {
        const st = { op: null, datos: null, id: null };
        const api = {
          select() { return api; },
          eq(col, val) { if (col === 'id') st.id = String(val); return api; },
          maybeSingle() { return api; },
          insert(d) { st.op = 'insert'; st.datos = d; return api; },
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
    ${extraer('_conciDatabaseValueEquals')}
    ${extraer('_conciPersistenceMismatch')}
    ${extraer('_conciMovementKeyFromDuplicateError')}
    ${extraer('_conciIsMovementKeyDuplicate')}
    ${extraer('_conciSummaryColumnKey')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciWriteRowSafe')}
    ${extraer('_conciAutoSaveRow')}
    return { _conciAutoSaveRow, _conciWriteRowSafe };
  `)(document, window, console, insertados, actualizados, estado, avisos);
}

const COLUMNAS = ['MES', 'FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'TOTAL PAX', 'CAPTURÓ'];

let estado;

// La fila que deja "+ Agregar fila": todas las celdas vacías, sin id todavía.
function agregarFila({ rowId = '' } = {}) {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  const tbody = document.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  if (!rowId) tr.dataset.conciNew = '1';
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

let api;
beforeEach(() => {
  insertados.length = 0;
  actualizados.length = 0;
  avisos.length = 0;
  estado = { rechaza: [], siguienteId: 4000, reintentos: 0, encolados: 0 };
  document.body.innerHTML = '';
  api = construirApi();
});

describe('la base rechaza lo único que se capturó', () => {
  test('no se crea ninguna fila', async () => {
    estado.rechaza = ['# DE VUELO'];   // bigint, y el operador escribe "VB 7305"
    const tr = agregarFila();
    capturar(tr, '# DE VUELO', 'VB 7305');

    await api._conciAutoSaveRow(tr);

    // Antes aquí quedaba { FECHA: '17/08/2026', CAPTURÓ: 'MJ' }: la fila en
    // blanco que aparecía sola en medio de la tabla.
    expect(insertados).toEqual([]);
  });

  test('lo capturado sigue en pantalla y marcado como pendiente', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = agregarFila();
    const td = capturar(tr, '# DE VUELO', 'VB 7305');

    await api._conciAutoSaveRow(tr);

    // Nada se borra nunca: el dato se queda a la vista para corregirlo.
    expect(td.textContent).toBe('VB 7305');
    expect(td.dataset.dirty).toBe('1');
    expect(tr.dataset.rowId).toBe('');
    expect(tr.title).toMatch(/Pendiente de guardar/);
    expect(estado.encolados).toBe(1);
  });

  test('se dice por qué no se guardó, nombrando la columna', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = agregarFila();
    capturar(tr, '# DE VUELO', 'VB 7305');

    await api._conciAutoSaveRow(tr);

    const texto = avisos.map(a => a.texto).join(' | ');
    expect(texto).toContain('# DE VUELO');
    expect(texto).toMatch(/no se cre[oó]/i);
  });

  test('no se reintenta en bucle: el mismo valor daría el mismo rechazo', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = agregarFila();
    capturar(tr, '# DE VUELO', 'VB 7305');

    await api._conciAutoSaveRow(tr);

    expect(estado.reintentos).toBe(0);
  });
});

describe('cuando sí sobrevive algo de lo capturado', () => {
  test('la fila se crea, y no por los rellenos automáticos', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = agregarFila();
    capturar(tr, '# DE VUELO', 'VB 7305');   // esta la rechaza la base
    capturar(tr, 'MATRÍCULA', 'XA-VMB');     // ésta no

    await api._conciAutoSaveRow(tr);

    expect(insertados).toHaveLength(1);
    expect(insertados[0]['MATRÍCULA']).toBe('XA-VMB');
    expect(insertados[0]['# DE VUELO']).toBeUndefined();
    // Y se avisa de la columna que no entró, para que nadie la dé por guardada.
    expect(avisos.map(a => a.texto).join(' | ')).toContain('# DE VUELO');
  });

  test('sin ningún rechazo, la captura se guarda entera', async () => {
    const tr = agregarFila();
    capturar(tr, 'AEROLINEA', 'VIVA AEROBUS');
    capturar(tr, 'MATRÍCULA', 'XA-VMB');
    capturar(tr, 'TOTAL PAX', '186');

    await api._conciAutoSaveRow(tr);

    expect(insertados).toHaveLength(1);
    expect(insertados[0]['AEROLINEA']).toBe('VIVA AEROBUS');
    expect(insertados[0]['TOTAL PAX']).toBe('186');
    expect(insertados[0]['MATRÍCULA']).toBe('XA-VMB');
  });
});

describe('la guarda no estorba al resto', () => {
  test('una fila ya guardada se sigue actualizando aunque se le pode una columna', async () => {
    estado.rechaza = ['# DE VUELO'];
    const tr = agregarFila({ rowId: '777' });
    capturar(tr, '# DE VUELO', 'VB 7305');
    capturar(tr, 'TOTAL PAX', '186');

    await api._conciAutoSaveRow(tr);

    // Es un UPDATE sobre una fila que ya existe: no crea nada y no se bloquea.
    expect(insertados).toEqual([]);
    expect(actualizados).toHaveLength(1);
    expect(actualizados[0].id).toBe('777');
    expect(actualizados[0].payload['TOTAL PAX']).toBe('186');
  });

  test('sin la opción columnasDeCaptura, la escritura se comporta igual que antes', async () => {
    // Es el caso de la importación: sus filas no vienen de la captura celda a
    // celda y no deben quedar sujetas a esta comprobación.
    const res = await api._conciWriteRowSafe(window.supabaseClient, { AEROLINEA: 'EMIRATES' }, null);
    expect(res.ok).toBe(true);
    expect(insertados).toHaveLength(1);
  });
});
