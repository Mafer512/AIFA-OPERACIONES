/**
 * Nombre completo de quien captura.
 *
 * En los avatares aparecía "IS", tomado de "isaac.lopez@aifa.operaciones". El
 * nombre se resolvía en dos sitios con reglas distintas:
 *
 *   - Al iniciar sesión: metadata → tabla profiles → correo.
 *   - Al restaurar la sesión (recargar la página): metadata → correo,
 *     saltándose profiles.
 *
 * Así que a quien no tuviera el nombre en su metadata le quedaba el correo
 * guardado en sesión. Y eso no solo afectaba al avatar: la columna CAPTURÓ usa
 * la misma función, o sea que el correo se estaba escribiendo en la base en
 * cada fila que esa persona tocara.
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

const iniciales = new Function(`${extraer('_conciInitialsFromName')}; return _conciInitialsFromName;`)();

describe('iniciales a partir del nombre completo', () => {
  test('una inicial por cada palabra', () => {
    expect(iniciales('Isaac Azhael López Cancino')).toBe('IALC');
    expect(iniciales('Ana Ruiz')).toBe('AR');
  });

  test('un nombre corto se conserva entero', () => {
    expect(iniciales('Ana')).toBe('ANA');
  });

  test('un nombre largo de una sola palabra se recorta', () => {
    expect(iniciales('Bartolomé')).toBe('BA');
  });

  test('no se va de largo con nombres muy compuestos', () => {
    expect(iniciales('Juan Carlos de la Rosa Méndez Iturbide').length).toBeLessThanOrEqual(5);
  });
});

describe('cuando solo hay correo (no debería, pero pasa)', () => {
  test('una inicial por cada parte del buzón, no las dos primeras letras', () => {
    // Este era el síntoma: "isaac.lopez@..." daba "IS".
    expect(iniciales('isaac.lopez@aifa.operaciones')).toBe('IL');
  });

  test('funciona con tres partes', () => {
    expect(iniciales('maria.fernanda.ruiz@aifa.operaciones')).toBe('MFR');
  });

  test('un buzón de una sola palabra cae a dos letras', () => {
    expect(iniciales('soporte@aifa.operaciones')).toBe('SO');
  });

  test('también con guiones y guiones bajos', () => {
    expect(iniciales('ana-ruiz@aifa.operaciones')).toBe('AR');
    expect(iniciales('luis_perez@aifa.operaciones')).toBe('LP');
  });
});

describe('una sola resolución del nombre', () => {
  test('existe la función compartida', () => {
    expect(source).toContain('async function _resolverNombreCompleto(user)');
  });

  test('consulta la metadata y luego la tabla profiles', () => {
    const fn = source.slice(
      source.indexOf('async function _resolverNombreCompleto'),
      source.indexOf('\n}\n', source.indexOf('async function _resolverNombreCompleto'))
    );
    expect(fn).toContain('user_metadata?.full_name');
    expect(fn).toContain("from('profiles')");
  });

  test('la ruta de recargar la página ya la usa', () => {
    // Era la que se saltaba profiles y guardaba el correo.
    expect(source).toContain('const nombre = await _resolverNombreCompleto(session.user);');
  });

  test('la ruta de iniciar sesión también', () => {
    expect(source).toContain('const fullName = await _resolverNombreCompleto(data.user);');
  });

  test('ya no queda una segunda consulta suelta a profiles para el nombre', () => {
    const consultas = (source.match(/\.select\('full_name'\)/g) || []).length;
    expect(consultas).toBe(1);
  });

  test('un correo ya guardado en sesión se vuelve a resolver', () => {
    // Sin esto, quien ya tenía el correo guardado se quedaba con él para
    // siempre, porque la comprobación era solo "¿hay algo guardado?".
    expect(source).toContain("!guardado || guardado.includes('@')");
  });
});
