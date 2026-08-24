/**
 * @jest-environment jsdom
 *
 * La cola de pendientes se identifica por el movimiento, no por un id inventado.
 *
 * La cola del servidor guarda lo que se capturó y NO llegó a "Conciliación
 * Manifiestos", para que no dependa de que una computadora en concreto vuelva a
 * encenderse. Cada renglón se identifica por la fila a la que pertenece.
 *
 * El problema: una captura sobre una fila que todavía no existía en la base no
 * tenía id que poner, así que se encolaba con uno inventado
 * ("nueva:<equipo>:<algo>"). Ese id no vuelve a existir NUNCA — si la fila
 * acabó guardándose recibió un id real, y si no, la fila ya no está. Lo
 * encolado quedaba imposible de encontrar, de aplicar y de retirar: se
 * acumulaba en el contador de "capturas pendientes de otro equipo" para
 * siempre, y era justo lo que se veía en pantalla (104 de ellas).
 *
 * Ahora se usa la identidad REAL del movimiento — la misma llave que calcula el
 * trigger _aifa_movement_key en la base: aerolínea, número de vuelo, fecha,
 * llegada/salida y el otro extremo de la ruta. Esa llave es la misma antes y
 * después de guardar, y desde cualquier computadora: quien abra ese día vuelve
 * a tener el vuelo en pantalla y la captura se puede colocar donde va.
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

const api = new Function('document', 'window', `
  let _conciLiveClientId = 'equipo-a';
  // La cola se cuelga del equipo, no de la pestaña.
  function _conciDeviceId() { return 'equipo-a'; }
  function _conciIsRoutingColumn(col) { return /destino|origen|routing/i.test(String(col || '')); }
  function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciPayloadIdentityValue')}
  ${extraer('_conciMovementKeyFromPayload')}
  ${extraer('_conciIdTemporalDeFila')}
  ${extraer('_conciValoresDeFila')}
  ${extraer('_conciIdentidadDeFila')}
  ${extraer('_conciIdColaDeFila')}
  ${extraer('_conciIdsColaDeFila')}
  ${extraer('_conciBuscarFilaPorIdentidad')}
  ${extraer('_conciVueloDeFilaElemento')}
  ${extraer('_conciFechaIsoDeFila')}
  ${extraer('_conciPendienteEsHuerfano')}
  ${extraer('_conciPendienteEsIdentidad')}
  return {
    _conciValoresDeFila, _conciIdentidadDeFila, _conciIdColaDeFila, _conciIdsColaDeFila,
    _conciBuscarFilaPorIdentidad, _conciVueloDeFilaElemento, _conciFechaIsoDeFila,
    _conciPendienteEsHuerfano, _conciPendienteEsIdentidad,
  };
`)(document, window);

const COLUMNAS = [
  'FECHA', 'AEROLINEA', 'TIPO DE MANIFIESTO', '# DE VUELO',
  'DESTINO / ORIGEN', 'MATRÍCULA', 'OBSERVACIONES',
];

function tabla() {
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
  return document.querySelector('#table-conci-manifiestos');
}

/** Añade una fila a la tabla con los valores dados. */
function fila(valores, { rowId = '', routeRaw = '' } = {}) {
  const tbody = document.querySelector('#table-conci-manifiestos tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  COLUMNAS.forEach(col => {
    const td = document.createElement('td');
    td.dataset.col = col;
    const valor = valores[col] || '';
    td.dataset.raw = valor;
    td.textContent = valor;
    if (col === 'DESTINO / ORIGEN' && routeRaw) td.dataset.routeRaw = routeRaw;
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  return tr;
}

const VUELO = {
  'FECHA': '19/08/2026',
  'AEROLINEA': 'VB',
  'TIPO DE MANIFIESTO': 'SALIDA',
  '# DE VUELO': '4103',
  'DESTINO / ORIGEN': 'NLU-CUN',
};

beforeEach(() => { tabla(); });

describe('una fila sin id en la base ya no se encola con un id inventado', () => {
  test('se encola con la identidad del movimiento', () => {
    const tr = fila(VUELO);

    expect(api._conciIdColaDeFila(tr)).toBe('mov:VB|4103|2026-08-19|D|CUN');
  });

  test('esa identidad es la MISMA que tendrá la fila después de guardarse', () => {
    const antes = api._conciIdentidadDeFila(fila(VUELO));
    tabla();
    const despues = api._conciIdentidadDeFila(fila(VUELO, { rowId: '9001' }));

    expect(antes).toBe(despues);
    expect(antes).not.toBe('');
  });

  test('una fila que ya existe en la base sigue usando su id real', () => {
    const tr = fila(VUELO, { rowId: '9001' });

    expect(api._conciIdColaDeFila(tr)).toBe('9001');
  });

  // Sin aerolínea, número de vuelo, fecha, tipo o ruta no hay con qué
  // identificarla todavía. Ahí no queda más remedio que el id temporal — pero
  // ya es el caso raro, no el normal.
  test('sólo cuando no hay con qué identificarla se recurre al id temporal', () => {
    const tr = fila({ 'OBSERVACIONES': 'algo suelto' });

    expect(api._conciIdentidadDeFila(tr)).toBe('');
    expect(api._conciIdColaDeFila(tr)).toMatch(/^nueva:equipo-a:/);
  });

  test('en cuanto se completa el vuelo, deja de ser temporal', () => {
    const tr = fila({ 'FECHA': '19/08/2026', 'AEROLINEA': 'VB' });
    expect(api._conciIdColaDeFila(tr)).toMatch(/^nueva:/);

    const celda = [...tr.querySelectorAll('td[data-col]')]
      .find(c => c.dataset.col === '# DE VUELO');
    celda.dataset.raw = '4103';
    [...tr.querySelectorAll('td[data-col]')].forEach(c => {
      if (c.dataset.col === 'TIPO DE MANIFIESTO') c.dataset.raw = 'SALIDA';
      if (c.dataset.col === 'DESTINO / ORIGEN') c.dataset.raw = 'NLU-CUN';
    });

    expect(api._conciIdColaDeFila(tr)).toBe('mov:VB|4103|2026-08-19|D|CUN');
  });
});

describe('el pendiente se puede volver a colocar donde va', () => {
  test('la fila se encuentra por su identidad, siga siendo espejo o ya tenga id', () => {
    const raiz = document.getElementById('table-conci-manifiestos');
    fila({ ...VUELO, '# DE VUELO': '4101' });
    const buscada = fila(VUELO);
    fila({ ...VUELO, '# DE VUELO': '4109' });

    expect(api._conciBuscarFilaPorIdentidad(raiz, 'mov:VB|4103|2026-08-19|D|CUN'))
      .toBe(buscada);
  });

  test('la misma identidad encuentra la fila aunque ya se haya guardado', () => {
    const raiz = document.getElementById('table-conci-manifiestos');
    const guardada = fila(VUELO, { rowId: '9001' });

    expect(api._conciBuscarFilaPorIdentidad(raiz, 'mov:VB|4103|2026-08-19|D|CUN'))
      .toBe(guardada);
  });

  test('si ese vuelo no está en la tabla, no devuelve una fila cualquiera', () => {
    const raiz = document.getElementById('table-conci-manifiestos');
    fila({ ...VUELO, '# DE VUELO': '4101' });

    expect(api._conciBuscarFilaPorIdentidad(raiz, 'mov:VB|4103|2026-08-19|D|CUN')).toBeNull();
    expect(api._conciBuscarFilaPorIdentidad(raiz, '')).toBeNull();
  });

  test('un pendiente por identidad se distingue de uno huérfano y de uno con id', () => {
    expect(api._conciPendienteEsIdentidad({ row_id: 'mov:VB|4103|2026-08-19|D|CUN' })).toBe(true);
    expect(api._conciPendienteEsHuerfano({ row_id: 'mov:VB|4103|2026-08-19|D|CUN' })).toBe(false);

    // Los que quedaron de antes: ésos sí siguen sin poder colocarse solos.
    expect(api._conciPendienteEsHuerfano({ row_id: 'nueva:equipo-b:abc' })).toBe(true);
    expect(api._conciPendienteEsIdentidad({ row_id: 'nueva:equipo-b:abc' })).toBe(false);

    expect(api._conciPendienteEsHuerfano({ row_id: '9001' })).toBe(false);
    expect(api._conciPendienteEsIdentidad({ row_id: '9001' })).toBe(false);
  });
});

describe('retirar alcanza a todo lo que la fila pudo encolar', () => {
  // La identidad CAMBIA mientras se captura: al teclear el número de vuelo, o
  // al corregir la ruta. Lo encolado bajo la anterior tiene que salir también,
  // o el mismo dato se queda duplicado en la lista de pendientes.
  test('incluye el id real, el anterior, la identidad actual y el temporal', () => {
    const tr = fila(VUELO, { rowId: '9001' });
    tr.dataset.conciColaId = 'mov:VB|4101|2026-08-19|D|CUN';
    tr.dataset.conciTempId = 'nueva:equipo-a:xyz';

    const ids = api._conciIdsColaDeFila(tr);

    expect(ids).toContain('9001');
    expect(ids).toContain('mov:VB|4101|2026-08-19|D|CUN');
    expect(ids).toContain('mov:VB|4103|2026-08-19|D|CUN');
    expect(ids).toContain('nueva:equipo-a:xyz');
  });

  test('sin repetidos y sin vacíos', () => {
    const tr = fila(VUELO);
    tr.dataset.conciColaId = 'mov:VB|4103|2026-08-19|D|CUN';

    expect(api._conciIdsColaDeFila(tr)).toEqual(['mov:VB|4103|2026-08-19|D|CUN']);
  });

  test('el encolado guarda con qué id lo hizo, para poder retirarlo luego', () => {
    const bloque = source.slice(
      source.indexOf('async function _conciEncolarPendientesDeFila'),
      source.indexOf('async function _conciDesencolarPendientesDeFila')
    );
    expect(bloque).toContain('const rowId = _conciIdColaDeFila(tr);');
    expect(bloque).toContain('tr.dataset.conciColaId = rowId;');
    // Y borra lo que quedó bajo el id anterior cuando la identidad cambia.
    expect(bloque).toContain("if (idPrevio && idPrevio !== rowId)");
  });
});

describe('el pendiente se archiva en el día de SU vuelo', () => {
  // Antes se tomaba siempre la fecha del filtro: con un rango activo eso
  // archivaba el pendiente en el primer día del rango, que no tiene por qué ser
  // el suyo, y luego no había forma de saber qué día filtrar para rescatarlo.
  test('la fecha sale de la propia fila, en ISO', () => {
    expect(api._conciFechaIsoDeFila(fila(VUELO))).toBe('2026-08-19');
  });

  test('sin vuelo identificable no inventa una fecha', () => {
    expect(api._conciFechaIsoDeFila(fila({ 'OBSERVACIONES': 'x' }))).toBe('');
  });

  test('el número de vuelo se lee del elemento, no por id', () => {
    expect(api._conciVueloDeFilaElemento(fila(VUELO))).toBe('4103');
    expect(api._conciVueloDeFilaElemento(fila({}))).toBe('');
  });
});

describe('la identidad se calcula con el routing real, no con el nombre de ciudad', () => {
  // En DESTINO / ORIGEN, dataset.raw guarda la ciudad ya resuelta para mostrar
  // ("QUITO") y el valor real vive en dataset.routeRaw ("NLU-UIO"). Calcular la
  // identidad con el nombre de la ciudad daría una llave distinta a la que
  // calcula la base, y el pendiente no volvería a encontrar su fila.
  test('usa routeRaw cuando existe', () => {
    const tr = fila({ ...VUELO, 'DESTINO / ORIGEN': 'QUITO' }, { routeRaw: 'NLU-UIO' });

    expect(api._conciValoresDeFila(tr)['DESTINO / ORIGEN']).toBe('NLU-UIO');
    expect(api._conciIdentidadDeFila(tr)).toBe('mov:VB|4103|2026-08-19|D|UIO');
  });
});
