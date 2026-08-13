/**
 * @jest-environment jsdom
 *
 * Una persona, una burbuja.
 *
 * Aparecían hasta tres burbujas del mismo usuario: una con su nombre completo,
 * otra con su correo y otra que decía "Usuario". Tres causas distintas:
 *
 *   1. El id de cliente se generaba nuevo en cada carga de la página. Al
 *      recargar, la presencia anterior seguía viva en el servidor hasta que
 *      caducaba, así que uno se veía a sí mismo dos veces.
 *
 *   2. La barra agrupaba por NOMBRE. Si una conexión se anunció con el correo
 *      —porque el perfil aún no había llegado— y otra con el nombre completo,
 *      salían como dos personas distintas.
 *
 *   3. El nombre se leía una sola vez al conectar y, si todavía no estaba
 *      resuelto, se quedaba en "Usuario" para siempre.
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

let presenceState = {};

const api = new Function('presencia', 'sessionStorage', `
  const SESSION_USER = 'currentUser';
  let _conciLiveClientId = 'yo';
  let _conciMiFocoActual = { rowId: '', col: '' };
  let _conciFocoRemotoPorCliente = new Map();
  const _conciLiveChannel = { presenceState: () => presencia.state };
  function _conciColorForUser() { return '#3949ab'; }
  ${extraer('_conciCorreoUsuario')}
  ${extraer('_conciNombreDefinitivo')}
  ${extraer('_conciPresenciaConectados')}
  return { _conciPresenciaConectados, _conciNombreDefinitivo, _conciCorreoUsuario };
`)({ get state() { return presenceState; } }, window.sessionStorage);

beforeEach(() => {
  presenceState = {};
  window.sessionStorage.clear();
});

describe('qué cuenta como nombre de verdad', () => {
  test('un nombre completo sí', () => {
    expect(api._conciNombreDefinitivo('Isaac Azhael López Cancino')).toBe(true);
  });

  test('un correo no: significa que el perfil no llegó', () => {
    expect(api._conciNombreDefinitivo('isaac.lopez@aifa.operaciones')).toBe(false);
  });

  test('"Usuario" tampoco: es el relleno', () => {
    expect(api._conciNombreDefinitivo('Usuario')).toBe(false);
  });

  test('vacío tampoco', () => {
    expect(api._conciNombreDefinitivo('')).toBe(false);
    expect(api._conciNombreDefinitivo(null)).toBe(false);
  });
});

describe('una sola burbuja por persona', () => {
  test('dos conexiones del mismo correo son una sola persona', () => {
    // Es lo que pasaba al recargar: la presencia vieja seguía viva.
    presenceState = {
      viejo: [{ user: 'isaac.lopez@aifa.operaciones', email: 'isaac.lopez@aifa.operaciones' }],
      nuevo: [{ user: 'Isaac Azhael López Cancino', email: 'isaac.lopez@aifa.operaciones' }],
    };
    expect(api._conciPresenciaConectados()).toHaveLength(1);
  });

  test('y se queda con el nombre completo, no con el correo', () => {
    presenceState = {
      viejo: [{ user: 'isaac.lopez@aifa.operaciones', email: 'isaac.lopez@aifa.operaciones' }],
      nuevo: [{ user: 'Isaac Azhael López Cancino', email: 'isaac.lopez@aifa.operaciones' }],
    };
    expect(api._conciPresenciaConectados()[0].nombre).toBe('Isaac Azhael López Cancino');
  });

  test('el orden de llegada no importa', () => {
    presenceState = {
      nuevo: [{ user: 'Isaac Azhael López Cancino', email: 'isaac.lopez@aifa.operaciones' }],
      viejo: [{ user: 'isaac.lopez@aifa.operaciones', email: 'isaac.lopez@aifa.operaciones' }],
    };
    const gente = api._conciPresenciaConectados();
    expect(gente).toHaveLength(1);
    expect(gente[0].nombre).toBe('Isaac Azhael López Cancino');
  });

  test('una conexión que aún dice "Usuario" no crea otra burbuja', () => {
    presenceState = {
      a: [{ user: 'Usuario', email: 'isaac.lopez@aifa.operaciones' }],
      b: [{ user: 'Isaac Azhael López Cancino', email: 'isaac.lopez@aifa.operaciones' }],
    };
    const gente = api._conciPresenciaConectados();
    expect(gente).toHaveLength(1);
    expect(gente[0].nombre).toBe('Isaac Azhael López Cancino');
  });

  test('dos personas distintas siguen siendo dos', () => {
    presenceState = {
      a: [{ user: 'Isaac Azhael López Cancino', email: 'isaac.lopez@aifa.operaciones' }],
      b: [{ user: 'María Fernanda Ruiz', email: 'maria.ruiz@aifa.operaciones' }],
    };
    expect(api._conciPresenciaConectados()).toHaveLength(2);
  });

  test('sin correo se sigue agrupando por nombre', () => {
    // Conexiones anteriores al cambio no traen el correo en la presencia.
    presenceState = {
      a: [{ user: 'Ana Ruiz' }],
      b: [{ user: 'Ana Ruiz' }],
    };
    expect(api._conciPresenciaConectados()).toHaveLength(1);
  });

  test('quien está capturando gana sobre quien solo mira', () => {
    presenceState = {
      a: [{ user: 'Ana Ruiz', email: 'ana@aifa.operaciones' }],
      b: [{ user: 'Ana Ruiz', email: 'ana@aifa.operaciones', col: 'TOTAL PAX' }],
    };
    const gente = api._conciPresenciaConectados();
    expect(gente).toHaveLength(1);
    expect(gente[0].editando).toBe('TOTAL PAX');
  });
});

describe('la identidad viaja con la presencia', () => {
  test('el correo sale de la sesión', () => {
    window.sessionStorage.setItem('currentUser', '  Isaac.Lopez@AIFA.Operaciones  ');
    expect(api._conciCorreoUsuario()).toBe('isaac.lopez@aifa.operaciones');
  });

  test('sin sesión devuelve vacío, no revienta', () => {
    expect(api._conciCorreoUsuario()).toBe('');
  });
});

describe('integración en el módulo', () => {
  test('el id de cliente se conserva entre recargas', () => {
    expect(source).toContain("sessionStorage.getItem('aifa-conci-live-client-id')");
    expect(source).toContain("sessionStorage.setItem('aifa-conci-live-client-id'");
  });

  test('el correo se anuncia junto al nombre', () => {
    const sub = source.slice(source.indexOf('channel.subscribe(async (status)'));
    expect(sub.slice(0, 2200)).toContain('email: _conciCorreoUsuario()');
  });

  test('el nombre se vuelve a intentar si llegó incompleto', () => {
    expect(source).toContain('function _conciRevisarIdentidadVivo()');
    const latido = source.slice(source.indexOf('function _conciIniciarLatidoFoco'));
    expect(latido.slice(0, 900)).toContain('_conciRevisarIdentidadVivo()');
  });

  test('ya no se fija el nombre una sola vez al conectar', () => {
    expect(source).not.toContain("_conciLiveDisplayName = _conciCurrentUserDisplayName() || 'Usuario';");
  });
});
