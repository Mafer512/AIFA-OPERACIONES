/**
 * @jest-environment jsdom
 *
 * "Fila de más" reportada después de la corrección de la fila fantasma.
 *
 * Síntoma: seguía apareciendo una fila en blanco (FECHA puesta, todo lo demás
 * vacío, ESTATUS MATRÍCULA "NO IDENTIFICADA") y, al tocarla, saltaba la alarma
 * "No se pudo guardar la fila: Supabase no confirmó ninguna fila modificada.
 * Revisa los permisos de actualización."
 *
 * No es el mismo bug que el de la fila fantasma (esa fila SÍ tenía FECHA
 * editable, lo que sólo pasa en una fila ya persistida — una recién creada con
 * "+ Agregar fila" trae FECHA bloqueada hasta que se guarda). Es un problema
 * distinto: la tabla es colaborativa, cualquiera con permiso de administrar
 * puede borrar una fila (la papelera de la fila, o el script de limpieza de
 * filas fantasma), y ese borrado no se avisa en vivo a las demás pestañas.
 * Una pestaña que la seguía mostrando intenta actualizarla, el UPDATE afecta
 * cero filas porque el id ya no existe, y el código lo trataba como un posible
 * problema de permisos: reintentaba para siempre, la encolaba como pendiente,
 * y la dejaba en pantalla — la "fila de más" que se seguía viendo.
 *
 * La corrección: cuando un UPDATE no confirma ninguna fila, comprobar aparte
 * si el id sigue existiendo. Si de verdad ya no existe, se retira de la
 * pantalla sin reintentar ni encolar, con un aviso claro. Si esa comprobación
 * no es concluyente (por ejemplo, un problema real de permisos que también
 * bloquea la lectura), se sigue tratando como antes: no se asume borrada a la
 * ligera.
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

const actualizados = [];
const consultasExistencia = [];
const avisos = [];

function construirApi() {
  return new Function('document', 'window', 'console', 'actualizados', 'consultasExistencia', 'estado', 'avisos', `
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
    function _conciDesencolarPendientesDeFila() { estado.desencolados++; }
    function _conciBorradorOlvidarFila() { estado.borradorOlvidado++; }
    function _conciActualizarBotonGuardarTodo() {}
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

    // Postgres simulado: la fila con id "555" ya no existe (alguien la borró),
    // pero PostgREST no distingue "0 filas por id inexistente" de "0 filas por
    // RLS" -- ambos casos responden data:null sin error, tal como el real.
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
          if (st.op === 'update') {
            const existe = !estado.filasBorradas.includes(st.id);
            actualizados.push({ id: st.id, payload: { ...st.datos } });
            if (!existe) return { data: null, error: null };
            return { data: { id: st.id, ...st.datos }, error: null };
          }
          if (st.op === 'select') {
            consultasExistencia.push(st.id);
            const existe = !estado.filasBorradas.includes(st.id);
            return { data: existe ? { id: st.id } : null, error: estado.lecturaFalla ? { message: 'permiso denegado' } : null };
          }
          return { data: null, error: null };
        }
        // select() se usa también para la comprobación de existencia (sin
        // update/insert antes): marcarlo aquí en vez de en el método select().
        const origSelect = api.select;
        api.select = function () { st.op = st.op || 'select'; return origSelect(); };
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
    ${extraer('_conciFilaExisteEnBase')}
    ${extraer('_conciFindExistingMovementRowId')}
    ${extraer('_conciSummaryColumnKey')}
    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciWriteRowSafe')}
    ${extraer('_conciAutoSaveRow')}
    return { _conciAutoSaveRow, _conciWriteRowSafe, _conciFilaExisteEnBase };
  `)(document, window, console, actualizados, consultasExistencia, estado, avisos);
}

const COLUMNAS = ['MES', 'FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'TOTAL PAX', 'CAPTURÓ'];

let estado;

// La fila tal y como la muestra el render para un registro YA GUARDADO: trae
// id y FECHA editable (a diferencia de la fila que deja "+ Agregar fila",
// donde FECHA queda bloqueada). Así se ve la del reporte: en blanco salvo la
// fecha, con matrícula sin capturar.
function filaExistente({ rowId = '555' } = {}) {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  const tbody = document.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    const valor = col === 'FECHA' ? '17/08/2026' : '';
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
  return td;
}

let api;
beforeEach(() => {
  actualizados.length = 0;
  consultasExistencia.length = 0;
  avisos.length = 0;
  estado = {
    filasBorradas: [],
    lecturaFalla: false,
    reintentos: 0,
    encolados: 0,
    desencolados: 0,
    borradorOlvidado: 0,
  };
  document.body.innerHTML = '';
  api = construirApi();
});

describe('alguien más borró la fila mientras esta pantalla la seguía mostrando', () => {
  test('se retira de la tabla en vez de quedar marcada "pendiente de guardar" para siempre', async () => {
    estado.filasBorradas = ['555'];
    const tr = filaExistente();
    capturar(tr, 'FECHA', '18/08/2026');   // el usuario intenta corregirla

    await api._conciAutoSaveRow(tr);

    // Antes se quedaba en pantalla con table-secondary y reintentando cada vez
    // más espaciado, sin que el reintento pudiera arreglar nada nunca.
    expect(tr.isConnected).toBe(false);
  });

  test('no se reintenta: el mismo id nunca va a volver a existir', async () => {
    estado.filasBorradas = ['555'];
    const tr = filaExistente();
    capturar(tr, 'FECHA', '18/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(estado.reintentos).toBe(0);
    expect(estado.encolados).toBe(0);
  });

  test('se limpia lo que hubiera quedado en la cola de pendientes y el borrador local', async () => {
    estado.filasBorradas = ['555'];
    const tr = filaExistente();
    capturar(tr, 'FECHA', '18/08/2026');

    await api._conciAutoSaveRow(tr);

    expect(estado.desencolados).toBeGreaterThan(0);
    expect(estado.borradorOlvidado).toBeGreaterThan(0);
  });

  test('el aviso explica lo que pasó, no habla de permisos', async () => {
    estado.filasBorradas = ['555'];
    const tr = filaExistente();
    capturar(tr, 'FECHA', '18/08/2026');

    await api._conciAutoSaveRow(tr);

    const texto = avisos.map(a => a.texto).join(' | ');
    expect(texto).toMatch(/ya no existe/i);
    expect(texto).not.toMatch(/permiso/i);
  });
});

describe('cuando la fila SÍ sigue existiendo', () => {
  test('un update que no confirma valores pero la fila sigue ahí no se retira de pantalla', async () => {
    // Nada en estado.filasBorradas: la fila existe. Este caso simula un
    // desajuste de VALORES (columna que la base rechazó), no de existencia.
    const tr = filaExistente();
    capturar(tr, 'FECHA', '18/08/2026');

    await api._conciAutoSaveRow(tr);

    // Se guardó normalmente: no hay motivo para tocarla.
    expect(tr.isConnected).toBe(true);
    expect(estado.reintentos).toBe(0);
  });

  test('si la comprobación de existencia no es concluyente, no se asume borrada', async () => {
    estado.filasBorradas = ['555'];
    estado.lecturaFalla = true;   // la propia lectura de verificación también falla
    const tr = filaExistente();
    capturar(tr, 'FECHA', '18/08/2026');

    await api._conciAutoSaveRow(tr);

    // Sin una confirmación clara de que ya no existe, se conserva el
    // comportamiento previo: la fila se queda a la vista y se reintenta.
    expect(tr.isConnected).toBe(true);
    expect(estado.reintentos).toBeGreaterThan(0);
    const texto = avisos.map(a => a.texto).join(' | ');
    expect(texto).not.toMatch(/ya no existe/i);
  });
});

describe('una fila nueva de esta sesión no se borra por esta vía', () => {
  test('sin rowId previo, un choque de movement_key contra un registro ya borrado no se retira sola', async () => {
    // rowId vacío: es una fila que "+ Agregar fila" dejó en esta pantalla.
    // Aquí sí hay una captura propia que no conviene perder en silencio.
    document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
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
    capturar(tr, 'AEROLINEA', 'VIVA AEROBUS');

    // Sin choque de movement_key en este escenario: se guarda como un INSERT
    // normal y no pasa por el camino de "fila borrada" en absoluto.
    await api._conciAutoSaveRow(tr);

    expect(tr.isConnected).toBe(true);
  });
});
