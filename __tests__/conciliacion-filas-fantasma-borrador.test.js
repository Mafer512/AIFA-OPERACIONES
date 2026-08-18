/**
 * @jest-environment jsdom
 *
 * Las filas vacías que aparecían solas en la tabla de manifiestos.
 *
 * Al capturar, cada celda queda respaldada en localStorage bajo una clave por
 * fila: "id:N" si la fila ya existe en la base, "nueva:xxx" si todavía no. En
 * cada render, _conciRestaurarFilasNuevas repone en pantalla los borradores
 * "nueva:" — porque una fila que aún no existe en la base no tiene dónde
 * reponerse si no se vuelve a crear.
 *
 * Ese mecanismo estaba resucitando filas que nadie pidió:
 *
 *  1. Una fila que consigue id cambia de clave ("nueva:xxx" → "id:N"). Si la
 *     entrada vieja no se muda, queda huérfana: nadie vuelve a mirarla, y el
 *     siguiente render la convierte en una FILA NUEVA con las dos o tres celdas
 *     que llevara dentro. Esa fila casi vacía se autoguarda y acaba como un
 *     registro aparte en la base — con el código de demora, o lo último que se
 *     hubiera tecleado, y nada más.
 *
 *  2. Un borrador cuyas celdas están TODAS vacías (celdas que alguien vació en
 *     una fila que nunca llegó a existir) dibujaba una fila en blanco que
 *     además nunca se puede guardar — el autoguardado no crea una fila nueva
 *     sin captura real. Al no guardarse nunca, el borrador no se limpiaba, y la
 *     fila volvía a aparecer en cada render, para siempre.
 *
 *  3. Un borrador de OTRO día se reponía en el día que estuviera filtrado. Una
 *     fila nueva hereda la fecha del filtro al guardarse, así que ese manifiesto
 *     quedaba archivado en una fecha que no era la suya.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

function constante(nombre) {
  const i = source.indexOf(`const ${nombre}`);
  if (i === -1) throw new Error(`No se encontró ${nombre}`);
  return source.slice(i, source.indexOf('\n', i) + 1);
}

const estado = { fechaFiltro: '', puedeEditar: true };
const encolados = [];
const avisos = [];
const creadas = [];

const api = new Function('document', 'localStorage', 'estado', 'encolados', 'avisos', 'creadas', `
  ${constante('_CONCI_BORRADORES_KEY')}
  ${constante('_CONCI_BORRADORES_VIGENCIA_MS')}
  function _conciCanCurrentUserEdit() { return estado.puedeEditar; }
  function _conciFechaUnicaDelFiltro() { return estado.fechaFiltro; }
  function _conciRefreshCalculatedCellsForRow() {}
  function _conciQueueAutoSave(tr) { encolados.push(tr); }
  function showNotification(msg, tipo) { avisos.push({ msg, tipo }); }
  function _conciActualizarIndicadorBorradores() {}
  // Igual que el de verdad en lo que aquí importa: crea la fila al final, o
  // reutiliza una fila nueva que siga en blanco, y devuelve SIEMPRE la fila
  // con la que se queda.
  function _conciAddBlankRow() {
    const tbody = document.querySelector('#table-conci-manifiestos tbody');
    const reutilizable = [...tbody.querySelectorAll('tr[data-conci-new="1"]')]
      .find(tr => ![...tr.querySelectorAll('td[data-col]')].some(td => td.textContent.trim()));
    if (reutilizable) { creadas.push(reutilizable); return reutilizable; }
    const tr = document.createElement('tr');
    tr.dataset.conciNew = '1';
    ['CÓDIGO DE DEMORA', 'TOTAL PAX', 'OBSERVACIONES'].forEach(col => {
      const td = document.createElement('td');
      td.dataset.col = col;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    creadas.push(tr);
    return tr;
  }
  ${extraer('_conciBorradoresLeer')}
  ${extraer('_conciBorradoresEscribir')}
  ${extraer('_conciBorradoresPurgar')}
  ${extraer('_conciRestaurarFilasNuevas')}
  return { _conciRestaurarFilasNuevas, _conciBorradoresPurgar, _conciBorradoresLeer, _CONCI_BORRADORES_KEY };
`)(document, window.localStorage, estado, encolados, avisos, creadas);

const CLAVE = api._CONCI_BORRADORES_KEY;

function tabla() {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  return document.querySelector('#table-conci-manifiestos tbody');
}

const filas = () => document.querySelectorAll('#table-conci-manifiestos tbody tr');

beforeEach(() => {
  window.localStorage.clear();
  encolados.length = 0;
  avisos.length = 0;
  creadas.length = 0;
  estado.fechaFiltro = '';
  estado.puedeEditar = true;
  tabla();
});

describe('un borrador sin ningún valor no puede dibujar una fila', () => {
  test('no repone la fila y descarta el borrador para que no vuelva', () => {
    const datos = {
      'nueva:vacia': { celdas: { 'TOTAL PAX': '', 'OBSERVACIONES': '   ' }, ts: Date.now(), fecha: '' },
    };
    window.localStorage.setItem(CLAVE, JSON.stringify(datos));

    expect(api._conciRestaurarFilasNuevas(datos)).toBe(0);
    expect(filas()).toHaveLength(0);
    // Lo importante: no vuelve en el siguiente render.
    expect(api._conciBorradoresLeer()['nueva:vacia']).toBeUndefined();
  });

  test('la purga también las retira, sin tocar las de filas que sí existen', () => {
    const ahora = Date.now();
    window.localStorage.setItem(CLAVE, JSON.stringify({
      'nueva:vacia': { celdas: { 'TOTAL PAX': '' }, ts: ahora },
      'nueva:con-dato': { celdas: { 'TOTAL PAX': '120' }, ts: ahora },
      // En una fila que YA existe, un valor vacío sí significa algo: borrar esa
      // celda. Ese borrador no se puede tirar.
      'id:42': { celdas: { 'OBSERVACIONES': '' }, ts: ahora },
    }));

    const vivos = api._conciBorradoresPurgar();

    expect(Object.keys(vivos).sort()).toEqual(['id:42', 'nueva:con-dato']);
  });
});

describe('un borrador de otro día no se repone en el día filtrado', () => {
  test('se conserva y se avisa dónde está, en vez de archivarlo en la fecha equivocada', () => {
    estado.fechaFiltro = '2026-08-18';
    const datos = {
      'nueva:otroDia': { celdas: { 'TOTAL PAX': '150' }, ts: Date.now(), fecha: '2026-08-10' },
    };
    window.localStorage.setItem(CLAVE, JSON.stringify(datos));

    expect(api._conciRestaurarFilasNuevas(datos)).toBe(0);
    expect(filas()).toHaveLength(0);
    expect(api._conciBorradoresLeer()['nueva:otroDia']).toBeDefined();
    expect(avisos.some(a => /otro día|otros días/.test(a.msg))).toBe(true);
  });

  test('al filtrar su propio día sí se repone', () => {
    estado.fechaFiltro = '2026-08-10';
    const datos = {
      'nueva:suDia': { celdas: { 'TOTAL PAX': '150' }, ts: Date.now(), fecha: '2026-08-10' },
    };
    window.localStorage.setItem(CLAVE, JSON.stringify(datos));

    expect(api._conciRestaurarFilasNuevas(datos)).toBe(1);
    expect(filas()).toHaveLength(1);
    expect(encolados).toHaveLength(1);
  });
});

describe('la fila que se rellena es la que devuelve _conciAddBlankRow', () => {
  test('si se reutiliza una fila en blanco que no es la última, se rellena ESA', () => {
    const tbody = document.querySelector('#table-conci-manifiestos tbody');
    // Fila nueva en blanco, reutilizable, seguida de otra fila cualquiera: la
    // última del tbody NO es la que _conciAddBlankRow va a devolver.
    const enBlanco = document.createElement('tr');
    enBlanco.dataset.conciNew = '1';
    ['CÓDIGO DE DEMORA', 'TOTAL PAX', 'OBSERVACIONES'].forEach(col => {
      const td = document.createElement('td');
      td.dataset.col = col;
      enBlanco.appendChild(td);
    });
    tbody.appendChild(enBlanco);
    const otra = document.createElement('tr');
    otra.dataset.rowId = '99';
    tbody.appendChild(otra);

    const datos = { 'nueva:x': { celdas: { 'TOTAL PAX': '77' }, ts: Date.now(), fecha: '' } };
    window.localStorage.setItem(CLAVE, JSON.stringify(datos));

    expect(api._conciRestaurarFilasNuevas(datos)).toBe(1);
    expect(enBlanco.dataset.conciBorradorClave).toBe('nueva:x');
    expect(enBlanco.querySelector('td[data-col="TOTAL PAX"]').textContent).toBe('77');
    expect(otra.dataset.conciBorradorClave).toBeUndefined();
  });

  test('no se pisa la clave de una fila que ya carga otro borrador', () => {
    const datosA = { 'nueva:a': { celdas: { 'TOTAL PAX': '10' }, ts: Date.now(), fecha: '' } };
    window.localStorage.setItem(CLAVE, JSON.stringify(datosA));
    api._conciRestaurarFilasNuevas(datosA);
    const primera = creadas[0];
    expect(primera.dataset.conciBorradorClave).toBe('nueva:a');

    // Un segundo borrador no puede aterrizar encima del primero.
    const datosB = { 'nueva:b': { celdas: { 'TOTAL PAX': '20' }, ts: Date.now(), fecha: '' } };
    api._conciRestaurarFilasNuevas(datosB);
    expect(primera.dataset.conciBorradorClave).toBe('nueva:a');
    expect(primera.querySelector('td[data-col="TOTAL PAX"]').textContent).toBe('10');
  });

  test('un borrador ya repuesto no se duplica en el siguiente render', () => {
    const datos = { 'nueva:x': { celdas: { 'TOTAL PAX': '55' }, ts: Date.now(), fecha: '' } };
    window.localStorage.setItem(CLAVE, JSON.stringify(datos));

    expect(api._conciRestaurarFilasNuevas(datos)).toBe(1);
    expect(api._conciRestaurarFilasNuevas(datos)).toBe(0);
    expect(filas()).toHaveLength(1);
  });
});

describe('toda fila que consigue id suelta su clave "nueva:"', () => {
  // Contrato sobre el código: son las DOS ramas de _conciAutoSaveRow que pasan
  // de "sin id" a "con id". Si una de ellas se salta el traslado, su borrador
  // queda huérfano y vuelve como fila fantasma. Le faltaba a la rama
  // "Solo Vuelos", que es justo la que usa quien captura un manifiesto sobre un
  // vuelo del itinerario.
  const cuerpo = source.slice(
    source.indexOf('async function _conciAutoSaveRow(tr, options = {})'),
    source.indexOf('async function _conciDescartarFilaNueva')
  );

  test('las dos ramas que asignan rowId tras un INSERT trasladan el borrador', () => {
    const asignaciones = cuerpo.match(/tr\.dataset\.rowId = String\(inserted\.id\)/g) || [];
    const traslados = cuerpo.match(/_conciBorradorTrasladarFilaNueva\(tr, inserted\.id\)/g) || [];
    expect(asignaciones).toHaveLength(2);
    expect(traslados).toHaveLength(asignaciones.length);
  });

  test('el traslado va ANTES de asignar el id, no después', () => {
    cuerpo.split('_conciBorradorTrasladarFilaNueva(tr, inserted.id)').slice(1).forEach(tramo => {
      // Lo primero que aparece tras el traslado es la asignación del id.
      expect(tramo.replace(/^[;\s]+/, '').startsWith('tr.dataset.rowId = String(inserted.id)')).toBe(true);
    });
  });
});
