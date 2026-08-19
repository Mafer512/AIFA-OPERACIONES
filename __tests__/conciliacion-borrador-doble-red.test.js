/**
 * @jest-environment jsdom
 *
 * Segunda red de seguridad, independiente de la primera.
 *
 * _conciRestaurarFilasNuevas ya descarta un borrador "nueva:" que no tenga
 * ninguna columna de identidad ANTES de crear la fila (ver
 * _conciBorradorPuedeLlegarAGuardarse, conciliacion-borrador-sin-identidad).
 * Esta prueba cubre la comprobación aparte que corre DESPUÉS, sobre lo que de
 * verdad quedó puesto en el DOM celda por celda -- para que, si el primer
 * descarte alguna vez tuviera un hueco (una columna renombrada, un caso no
 * previsto), ninguna fila sin identidad se quede visible en pantalla de todos
 * modos. Nunca debe verse una fila en blanco, la ponga quien la ponga.
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

const encolados = [];
const creadas = [];

function construirApi({ primeraRedActiva = true } = {}) {
  return new Function('document', 'encolados', 'creadas', `
    function _conciCanCurrentUserEdit() { return true; }
    function _conciFechaUnicaDelFiltro() { return ''; }
    function _conciRefreshCalculatedCellsForRow() {}
    function _conciQueueAutoSave(tr) { encolados.push(tr); }
    function showNotification() {}
    function _conciBorradoresEscribir() {}

    const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
    ${extraer('_conciSummaryColumnKey')}
    ${extraer('_conciEsColumnaIdentidad')}
    ${extraer('_conciNormalizeEditableCellText')}

    // Simula el hueco que esta prueba quiere descartar: la primera red
    // (_conciBorradorPuedeLlegarAGuardarse) desactivada a propósito, para
    // comprobar que la SEGUNDA, la que corre después de rellenar la fila,
    // atrapa igual el caso sin identidad por su cuenta.
    function _conciBorradorPuedeLlegarAGuardarse(celdas) {
      return ${primeraRedActiva} ? Object.entries(celdas || {}).some(
        ([col, valor]) => _conciEsColumnaIdentidad(col) && String(valor ?? '').trim() !== ''
      ) : true;
    }

    function _conciAddBlankRow() {
      const tbody = document.querySelector('#table-conci-manifiestos tbody');
      const tr = document.createElement('tr');
      tr.dataset.conciNew = '1';
      ['MES', 'FECHA', 'AEROLINEA', 'MATRÍCULA', '# DE VUELO', 'TOTAL PAX'].forEach(col => {
        const td = document.createElement('td');
        td.dataset.col = col;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      creadas.push(tr);
      return tr;
    }

    ${extraer('_conciRestaurarFilasNuevas')}
    return { _conciRestaurarFilasNuevas };
  `)(document, encolados, creadas);
}

function tabla() {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  return document.querySelector('#table-conci-manifiestos tbody');
}
const filas = () => document.querySelectorAll('#table-conci-manifiestos tbody tr');

beforeEach(() => {
  encolados.length = 0;
  creadas.length = 0;
  tabla();
});

test('con la primera red desactivada, la segunda igual retira la fila sin identidad', () => {
  const api = construirApi({ primeraRedActiva: false });
  const datos = { 'nueva:x': { celdas: { 'FECHA': '17/08/2026' }, ts: Date.now(), fecha: '' } };

  const repuestas = api._conciRestaurarFilasNuevas(datos);

  // La fila SÍ llegó a crearse (la primera red estaba apagada a propósito),
  // pero la segunda la detecta sin identidad tras rellenarla y la retira.
  expect(creadas).toHaveLength(1);
  expect(filas()).toHaveLength(0);
  expect(repuestas).toBe(0);
  expect(encolados).toHaveLength(0);   // nunca se encoló autoguardado para ella
});

test('con identidad real, la segunda red no interfiere: la fila se queda', () => {
  const api = construirApi({ primeraRedActiva: false });
  const datos = { 'nueva:x': { celdas: { 'FECHA': '17/08/2026', 'AEROLINEA': 'VIVA AEROBUS' }, ts: Date.now(), fecha: '' } };

  const repuestas = api._conciRestaurarFilasNuevas(datos);

  expect(filas()).toHaveLength(1);
  expect(repuestas).toBe(1);
  expect(encolados).toHaveLength(1);
});

test('con las dos redes activas (comportamiento real), tampoco aparece nunca', () => {
  const api = construirApi({ primeraRedActiva: true });
  const datos = { 'nueva:x': { celdas: { 'FECHA': '20/08/2026' }, ts: Date.now(), fecha: '' } };

  api._conciRestaurarFilasNuevas(datos);

  expect(filas()).toHaveLength(0);
});
