/**
 * @jest-environment jsdom
 *
 * Que no se pierda una captura, pase lo que pase.
 *
 * Quedaban dos huecos después del borrador local:
 *
 * 1. Un guardado que fallaba ESTANDO EN LÍNEA (error pasajero del servidor,
 *    tiempo de espera agotado, permisos que tardan en refrescar) no se
 *    reintentaba nunca. La fila quedaba en "Pendiente de guardar" esperando a
 *    que alguien la volviera a tocar. Solo se reintentaba al volver la red, al
 *    llegar otra edición de la misma fila, o al redibujar la tabla.
 *
 * 2. Las capturas sobre filas nuevas quedaban en el borrador local pero sin
 *    forma de volver a la pantalla: al recargar, la fila ya no existía y no
 *    había dónde reponerlas.
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

let pendientes = 0;
const encolados = [];
const avisos = [];

const api = new Function('document', 'setTimeout', 'clearTimeout', 'estado', 'encolados', 'avisos', `
  ${constante('_CONCI_REINTENTO_MIN_MS')}
  ${constante('_CONCI_REINTENTO_MAX_MS')}
  let _conciReintentoTimer = null;
  let _conciReintentoEspera = _CONCI_REINTENTO_MIN_MS;
  const MIN = _CONCI_REINTENTO_MIN_MS;
  const MAX = _CONCI_REINTENTO_MAX_MS;
  function _conciReintentarPendientes() { return estado.pendientes; }
  function _conciCanCurrentUserEdit() { return estado.puedeEditar; }
  function _conciRefreshCalculatedCellsForRow() {}
  function _conciQueueAutoSave(tr) { encolados.push(tr); }
  function showNotification(msg, tipo) { avisos.push({ msg, tipo }); }
  function _conciAddBlankRow() {
    const tbody = document.querySelector('#table-conci-manifiestos tbody');
    const tr = document.createElement('tr');
    tr.dataset.conciNew = '1';
    ['TOTAL PAX', 'OBSERVACIONES'].forEach(col => {
      const td = document.createElement('td');
      td.dataset.col = col;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  ${extraer('_conciProgramarReintento')}
  ${extraer('_conciReiniciarEsperaReintento')}
  ${extraer('_conciSummaryColumnKey')}
  const _CONCI_COLUMNAS_IDENTIDAD = ['AEROLINEA', 'MATRICULA', '# DE VUELO', 'TIPO DE MANIFIESTO', 'AERONAVE', 'DESTINO / ORIGEN', 'TOTAL PAX'];
  ${extraer('_conciEsColumnaIdentidad')}
  ${extraer('_conciBorradorPuedeLlegarAGuardarse')}
  ${extraer('_conciRestaurarFilasNuevas')}
  return {
    _conciProgramarReintento, _conciReiniciarEsperaReintento, _conciRestaurarFilasNuevas,
    MIN, MAX,
    espera: () => _conciReintentoEspera,
    hayTimer: () => _conciReintentoTimer !== null,
    // El temporizador vive en el modulo, no en cada prueba: hay que reiniciarlo
    // o el estado de una prueba se cuela en la siguiente.
    reiniciar: () => {
      if (_conciReintentoTimer) clearTimeout(_conciReintentoTimer);
      _conciReintentoTimer = null;
      _conciReintentoEspera = _CONCI_REINTENTO_MIN_MS;
    },
  };
`)(document,
  // Se delegan en vez de pasarse directo: jest.useFakeTimers() sustituye los
  // globales despues de construir este arnes, y una referencia capturada antes
  // seguiria apuntando a los de verdad.
  (fn, ms) => setTimeout(fn, ms), (id) => clearTimeout(id),
  { get pendientes() { return pendientes; }, puedeEditar: true },
  encolados, avisos);

beforeEach(() => {
  jest.useFakeTimers();
  pendientes = 0;
  encolados.length = 0;
  avisos.length = 0;
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  api.reiniciar();
});

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('insiste hasta que la base acepte', () => {
  test('con algo pendiente, reintenta solo', () => {
    pendientes = 1;
    api._conciProgramarReintento();
    expect(api.hayTimer()).toBe(true);

    jest.advanceTimersByTime(api.MIN);
    expect(api.hayTimer()).toBe(true); // sigue insistiendo
  });

  test('la espera crece para no castigar a un servidor que ya sufre', () => {
    pendientes = 1;
    api._conciProgramarReintento();

    expect(api.espera()).toBe(api.MIN);
    jest.advanceTimersByTime(api.MIN);
    expect(api.espera()).toBe(api.MIN * 2);
    jest.advanceTimersByTime(api.MIN * 2);
    expect(api.espera()).toBe(api.MIN * 4);
  });

  test('la espera tiene tope: no se va a horas', () => {
    pendientes = 1;
    api._conciProgramarReintento();
    for (let i = 0; i < 12; i++) jest.advanceTimersByTime(api.espera());
    expect(api.espera()).toBe(api.MAX);
  });

  test('cuando ya no queda nada pendiente, se apaga', () => {
    pendientes = 1;
    api._conciProgramarReintento();
    pendientes = 0;
    jest.advanceTimersByTime(api.MIN);
    expect(api.hayTimer()).toBe(false);
  });

  test('tras apagarse, la espera vuelve al intervalo corto', () => {
    pendientes = 1;
    api._conciProgramarReintento();
    jest.advanceTimersByTime(api.MIN);   // 15s -> espera 30s
    pendientes = 0;
    jest.advanceTimersByTime(api.MIN * 2);
    expect(api.espera()).toBe(api.MIN);
  });

  test('un guardado exitoso reinicia la espera', () => {
    pendientes = 1;
    api._conciProgramarReintento();
    jest.advanceTimersByTime(api.MIN);
    expect(api.espera()).toBe(api.MIN * 2);

    api._conciReiniciarEsperaReintento();
    expect(api.espera()).toBe(api.MIN);
  });

  test('no se programan dos reintentos a la vez', () => {
    pendientes = 1;
    api._conciProgramarReintento();
    api._conciProgramarReintento();
    api._conciProgramarReintento();
    jest.advanceTimersByTime(api.MIN);
    // Un solo ciclo: la espera se duplicó una vez, no tres.
    expect(api.espera()).toBe(api.MIN * 2);
  });
});

describe('filas nuevas que nunca llegaron a guardarse', () => {
  const borrador = (celdas) => ({ 'nueva:abc': { ts: Date.now(), celdas } });

  test('la fila vuelve a la pantalla con sus datos', () => {
    const n = api._conciRestaurarFilasNuevas(borrador({ 'TOTAL PAX': '178' }));
    expect(n).toBe(1);

    const td = document.querySelector('td[data-col="TOTAL PAX"]');
    expect(td.textContent).toBe('178');
    expect(td.dataset.dirty).toBe('1');
    expect(td.classList.contains('conci-cell-borrador')).toBe(true);
  });

  test('se vuelve a encolar para guardarse', () => {
    api._conciRestaurarFilasNuevas(borrador({ 'TOTAL PAX': '178' }));
    expect(encolados).toHaveLength(1);
  });

  test('se avisa: una fila que reaparece sola desconcierta', () => {
    api._conciRestaurarFilasNuevas(borrador({ 'TOTAL PAX': '178' }));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].msg).toContain('1 fila');
  });

  test('no se duplica si ya está en pantalla', () => {
    const datos = borrador({ 'TOTAL PAX': '178' });
    api._conciRestaurarFilasNuevas(datos);
    api._conciRestaurarFilasNuevas(datos);
    expect(document.querySelectorAll('tr[data-conci-new="1"]')).toHaveLength(1);
  });

  test('un borrador vacío no crea filas fantasma', () => {
    expect(api._conciRestaurarFilasNuevas(borrador({}))).toBe(0);
    expect(document.querySelectorAll('tr')).toHaveLength(0);
  });

  test('las filas ya existentes no pasan por aquí', () => {
    const n = api._conciRestaurarFilasNuevas({ 'id:42': { celdas: { 'TOTAL PAX': '1' } } });
    expect(n).toBe(0);
  });
});

describe('integración en el módulo', () => {
  test('los tres caminos de fallo encienden el reintento', () => {
    const guardado = source.slice(source.indexOf('async function _conciAutoSaveRow'));
    const cuerpo = guardado.slice(0, guardado.indexOf('\nfunction '));
    const veces = (cuerpo.match(/_conciProgramarReintento\(\)/g) || []).length;
    expect(veces).toBe(3);
  });

  test('un guardado exitoso reinicia la espera', () => {
    expect(source).toContain('_conciReiniciarEsperaReintento();');
  });

  test('al restaurar borradores se recuperan las filas nuevas', () => {
    const fn = source.slice(source.indexOf('function _conciRestaurarBorradores'));
    expect(fn.slice(0, 3000)).toContain('_conciRestaurarFilasNuevas(datos)');
  });
});
