/**
 * @jest-environment jsdom
 *
 * Estatus de matrícula: activo por defecto en carga, y corregible a mano.
 *
 * El estatus salía siempre del catálogo: si la matrícula no estaba ahí, la
 * celda decía NO IDENTIFICADA en rojo y no había forma de cambiarlo. Las
 * matrículas de las cargueras casi nunca están en el catálogo, así que la
 * columna aparecía en rojo en casi todas sus filas — y cuando el rojo es lo
 * normal deja de significar algo.
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

const api = new Function(`
  ${constante('_CONCI_ESTATUS_MATRICULA')}
  ${extraer('_conciNormalizeEditableCellText')}
  // La clasificación de carga tiene su propia suite; aquí basta el criterio.
  function _conciRowIsCargo(row, optypeCol, airlineCol) {
    return /carga|cargo|freight/i.test(String(row?.[optypeCol] || '') + ' ' + String(row?.[airlineCol] || ''));
  }
  ${extraer('_conciEstatusMatricula')}
  return { _conciEstatusMatricula, _CONCI_ESTATUS_MATRICULA };
`)();

const COLS = { statusCol: 'ESTATUS MATRÍCULA', optypeCol: 'TIPO DE OPERACIÓN', airlineCol: 'AEROLINEA' };
const estatus = (row, catalogEntry = null) =>
  api._conciEstatusMatricula(row, { ...COLS, catalogEntry });

describe('el catálogo manda cuando conoce la matrícula', () => {
  test('una matrícula del catálogo queda ACTIVA', () => {
    expect(estatus({ 'AEROLINEA': 'VIVA AEROBUS' }, { aerolinea: 'VIVA AEROBUS' })).toBe('ACTIVA');
  });

  test('y gana sobre lo que hubiera capturado a mano', () => {
    // Si alguien la dio de alta en el catálogo, esa es la verdad.
    const row = { 'AEROLINEA': 'VIVA AEROBUS', 'ESTATUS MATRÍCULA': 'NO IDENTIFICADA' };
    expect(estatus(row, { aerolinea: 'VIVA AEROBUS' })).toBe('ACTIVA');
  });
});

describe('sin catálogo: la carga arranca activa', () => {
  test('una aerolínea de carga queda ACTIVA por defecto', () => {
    expect(estatus({ 'AEROLINEA': 'CARGOLUX', 'TIPO DE OPERACIÓN': 'Carga' })).toBe('ACTIVA');
  });

  test('un vuelo de pasajeros sigue como NO IDENTIFICADA', () => {
    expect(estatus({ 'AEROLINEA': 'VIVA AEROBUS', 'TIPO DE OPERACIÓN': 'Nacional' }))
      .toBe('NO IDENTIFICADA');
  });
});

describe('lo capturado a mano se respeta', () => {
  test('un NO IDENTIFICADA puesto a mano en una carguera no se pisa', () => {
    const row = {
      'AEROLINEA': 'CARGOLUX', 'TIPO DE OPERACIÓN': 'Carga',
      'ESTATUS MATRÍCULA': 'NO IDENTIFICADA',
    };
    expect(estatus(row)).toBe('NO IDENTIFICADA');
  });

  test('en pasajeros NO se respeta: ahí manda solo el catálogo', () => {
    // La columna está bloqueada en pasajeros, así que un valor capturado ahí
    // solo puede venir de antes o de una importación, y no debe ganarle al
    // catálogo: taparía un alta que falta hacer donde toca.
    const row = {
      'AEROLINEA': 'VIVA AEROBUS', 'TIPO DE OPERACIÓN': 'Nacional',
      'ESTATUS MATRÍCULA': 'ACTIVA',
    };
    expect(estatus(row)).toBe('NO IDENTIFICADA');
  });

  test('acepta minúsculas y espacios de sobra', () => {
    const row = {
      'AEROLINEA': 'CARGOLUX', 'TIPO DE OPERACIÓN': 'Carga',
      'ESTATUS MATRÍCULA': '  no identificada  ',
    };
    expect(estatus(row)).toBe('NO IDENTIFICADA');
  });

  test('un valor que no es de la lista no cuenta como captura', () => {
    const row = {
      'AEROLINEA': 'CARGOLUX', 'TIPO DE OPERACIÓN': 'Carga',
      'ESTATUS MATRÍCULA': 'cualquier cosa',
    };
    expect(estatus(row)).toBe('ACTIVA');   // vuelve al valor por defecto
  });

  test('una celda vacía no cuenta como captura', () => {
    const row = { 'AEROLINEA': 'CARGOLUX', 'TIPO DE OPERACIÓN': 'Carga', 'ESTATUS MATRÍCULA': '' };
    expect(estatus(row)).toBe('ACTIVA');
  });
});

describe('solo la carga se puede corregir', () => {
  test('en pasajeros el combo ni se abre', () => {
    const activar = source.slice(source.indexOf('function _conciActivateCellEditor'));
    const guarda = activar.slice(
      activar.indexOf('_conciIsMatriculaStatusColumn(col)'),
      activar.indexOf('_conciIsOperationTypeColumn')
    );
    expect(guarda).toContain('if (!_conciRowElementIsCargo(td)) return;');
  });

  test('el repintado por fila usa la misma regla, no solo el catálogo', () => {
    // Era la causa de que el cambio "tardara": se escribía el valor elegido y
    // acto seguido se repintaba la celda recalculando solo desde el catálogo.
    const fn = source.slice(
      source.indexOf('function _conciRefreshMatriculaValidationForRow'),
      source.indexOf('\n}\n', source.indexOf('function _conciRefreshMatriculaValidationForRow'))
    );
    expect(fn).toContain('_conciEstatusMatricula(');
    expect(fn).not.toContain("const status = catalogEntry ? 'ACTIVA' : 'NO IDENTIFICADA';");
  });
});

describe('el combo', () => {
  test('ofrece exactamente las dos opciones', () => {
    expect(api._CONCI_ESTATUS_MATRICULA).toEqual(['ACTIVA', 'NO IDENTIFICADA']);
  });

  test('existe su editor', () => {
    expect(source).toContain('function _conciActivateMatriculaStatusEditor(td, currentRaw)');
  });

  test('la celda ya no está bloqueada', () => {
    const activar = source.slice(source.indexOf('function _conciActivateCellEditor'));
    // Hasta el primer editor especializado: ahí está toda la cadena de guardas.
    const cabeza = activar.slice(0, activar.indexOf('_conciIsOperationTypeColumn'));
    // Antes salía por aquí sin abrir nada.
    expect(cabeza).not.toMatch(/if \(_conciIsMatriculaStatusColumn\(col\) \|\| _conciIsProtectedEditColumn/);
    expect(cabeza).toContain('_conciActivateMatriculaStatusEditor(td, currentRaw)');
  });

  test('el renderizado ya no la marca de solo lectura', () => {
    const fn = source.slice(
      source.indexOf('function _conciRenderMatriculaStatusCell'),
      source.indexOf('\n}\n', source.indexOf('function _conciRenderMatriculaStatusCell'))
    );
    expect(fn).not.toContain("td.dataset.conciReadonly = '1'");
    expect(fn).toContain('delete td.dataset.conciReadonly');
  });
});
