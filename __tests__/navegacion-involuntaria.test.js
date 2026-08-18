/**
 * @jest-environment jsdom
 *
 * Navegación involuntaria entre módulos y pestañas.
 *
 * Sintoma reportado: tras un rato con el dashboard abierto, el sistema cambia
 * solo de modulo o de sub-pestana, sin que el usuario toque nada. Intermitente.
 *
 * Causa: refreshUserPermissionsFromServer se ejecuta CADA 60 s
 * (startPermissionsAutoRefresh) y, al terminar, re-navegaba a la seccion del
 * hash SIEMPRE, hubiera cambiado algo o no. Y lo hacia por showSection pasandole
 * el elemento del menu, o sea por el mismo camino que un clic deliberado:
 * showSection honra el data-sub-tab de ese elemento y reimpone la sub-pestana de
 * arranque de la seccion. Quien estuviera en otra sub-pestana era devuelto a la
 * primera cada minuto.
 *
 * Amplificador: el "¿cambiaron los permisos?" comparaba el JSON en crudo, asi
 * que un simple reordenamiento de la lista del servidor (la consulta no lleva
 * ORDER BY) contaba como cambio y disparaba applySectionPermissions, que tiene
 * dos caminos que navegan a la seccion por defecto.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  let inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

// Se EJECUTA el sondeo real contra un servidor simulado. Es la unica forma de
// pinar esto: comprobar el texto del archivo no basta, porque la funcion ya
// tiene otro "if (permisosCambiaron)" antes y cualquier comprobacion por
// posicion pasa aunque la guarda de la re-navegacion se haya quitado.
describe('el sondeo de permisos no re-navega si nada cambió', () => {
  const navegaciones = [];
  const permisosAplicados = [];
  const avisos = [];
  let respuestaDelServidor = { role: 'editor', permissions: { allowed_sections: ['conciliacion', 'inicio'] } };

  const api = new Function('window', 'document', 'sessionStorage', 'location', 'navegaciones', 'permisosAplicados', 'avisos', 'servidor', `
    const SESSION_USER = 'currentUser';
    // Las dos listas de las que dependen isSectionAllowed y
    // getDefaultAllowedSection. Cada prueba las fija con setPermisos.
    let userSectionWhitelist = [];
    let userDefaultSectionKey = '';
    function applySectionPermissions(nombre) { permisosAplicados.push(nombre); }
    function restoreSectionFromNavigation(key, options) { navegaciones.push({ key, options }); return true; }
    function showNotification(mensaje, tipo) { avisos.push({ mensaje, tipo }); }
    window.supabaseClient = {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: servidor.actual }) }) }) }),
    };
    ${extraer('_seccionesPermitidasCambiaron')}
    ${extraer('isSectionAllowed')}
    ${extraer('getDefaultAllowedSection')}
    ${extraer('refreshUserPermissionsFromServer')}
    return {
      refreshUserPermissionsFromServer,
      setPermisos: (lista, porDefecto) => {
        userSectionWhitelist = lista || [];
        userDefaultSectionKey = porDefecto || '';
      },
    };
  `)(window, document, window.sessionStorage, window.location, navegaciones, permisosAplicados, avisos,
     { get actual() { return respuestaDelServidor; } });

  beforeEach(() => {
    navegaciones.length = 0;
    permisosAplicados.length = 0;
    avisos.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = '';
    window.location.hash = '#conciliacion';
    api.setPermisos([], '');
    respuestaDelServidor = { role: 'editor', permissions: { allowed_sections: ['conciliacion', 'inicio'] } };
  });

  /** Deja al usuario "parado" en una seccion, como la ve el sondeo. */
  function abierta(clave) {
    document.body.innerHTML = `<div id="${clave}-section" class="content-section active"></div>`;
  }

  test('la primera vuelta asienta los permisos', async () => {
    await api.refreshUserPermissionsFromServer();
    expect(window.sessionStorage.getItem('user_allowed_sections')).toBe('["conciliacion","inicio"]');
  });

  // El corazon del bug: cada 60 s se re-navegaba pasara lo que pasara.
  test('vueltas sucesivas sin cambios NO navegan', async () => {
    await api.refreshUserPermissionsFromServer();
    navegaciones.length = 0;

    await api.refreshUserPermissionsFromServer();
    await api.refreshUserPermissionsFromServer();
    await api.refreshUserPermissionsFromServer();

    expect(navegaciones).toEqual([]);
  });

  // La consulta no lleva ORDER BY: el mismo conjunto puede volver en otro orden.
  test('la misma lista en otro orden NO navega ni re-aplica permisos', async () => {
    await api.refreshUserPermissionsFromServer();
    navegaciones.length = 0;
    permisosAplicados.length = 0;

    respuestaDelServidor = { role: 'editor', permissions: { allowed_sections: ['inicio', 'conciliacion'] } };
    await api.refreshUserPermissionsFromServer();

    expect(navegaciones).toEqual([]);
    expect(permisosAplicados).toEqual([]);
  });

  // Un cambio real SI re-aplica los permisos —applySectionPermissions puede
  // tener que ocultar o mostrar modulos en el menu—, pero eso no es motivo para
  // mover a nadie de pantalla si sigue teniendo acceso a donde esta.
  test('un cambio real re-aplica los permisos pero no mueve a quien sigue dentro', async () => {
    await api.refreshUserPermissionsFromServer();
    navegaciones.length = 0;
    permisosAplicados.length = 0;

    abierta('hvac');
    api.setPermisos(['hvac', 'inicio'], 'inicio');
    respuestaDelServidor = { role: 'editor', permissions: { allowed_sections: ['hvac', 'inicio'] } };
    await api.refreshUserPermissionsFromServer();

    expect(permisosAplicados).toHaveLength(1);
    expect(navegaciones).toEqual([]);
  });

  // El unico caso en que el sondeo si debe mover a alguien: le quitaron el
  // acceso a la seccion que tenia abierta. Y se le dice por que.
  test('si pierde el acceso a la sección abierta, se le saca y se le avisa', async () => {
    await api.refreshUserPermissionsFromServer();
    navegaciones.length = 0;
    avisos.length = 0;

    abierta('hvac');
    api.setPermisos(['inicio'], 'inicio');
    respuestaDelServidor = { role: 'editor', permissions: { allowed_sections: ['inicio'] } };
    await api.refreshUserPermissionsFromServer();

    expect(navegaciones).toHaveLength(1);
    expect(navegaciones[0].key).toBe('inicio');
    expect(avisos).toHaveLength(1);
    expect(avisos[0].mensaje).toMatch(/permisos cambiaron/i);
  });

  // Conciliacion es modulo base de toda sesion valida: no sale en la lista
  // blanca y aun asi nadie puede ser sacado de ella.
  test('a nadie se le saca de Conciliación', async () => {
    await api.refreshUserPermissionsFromServer();
    navegaciones.length = 0;

    abierta('conciliacion');
    api.setPermisos(['inicio'], 'inicio');
    respuestaDelServidor = { role: 'editor', permissions: { allowed_sections: ['inicio'] } };
    await api.refreshUserPermissionsFromServer();

    expect(navegaciones).toEqual([]);
  });

  test('el sondeo sigue siendo cada 60 s y solo con la app visible', () => {
    const auto = source.slice(source.indexOf('function startPermissionsAutoRefresh'));
    const cuerpo = auto.slice(0, auto.indexOf('\n}\n'));
    expect(cuerpo).toContain('document.hidden');
    expect(cuerpo).toContain('60000');
  });
});

describe('reordenar la lista de secciones no es un cambio de permisos', () => {
  const api = new Function(`
    ${extraer('_seccionesPermitidasCambiaron')}
    return { _seccionesPermitidasCambiaron };
  `)();
  const cambio = api._seccionesPermitidasCambiaron;

  // El corazon del falso positivo: la consulta no lleva ORDER BY.
  test('mismo conjunto en otro orden: no hay cambio', () => {
    expect(cambio('["a","b","c"]', '["c","a","b"]')).toBe(false);
  });

  test('texto identico: no hay cambio', () => {
    expect(cambio('["a","b"]', '["a","b"]')).toBe(false);
  });

  test('duplicados no inventan un cambio', () => {
    expect(cambio('["a","b"]', '["a","b","b"]')).toBe(false);
  });

  test('una seccion agregada SI es un cambio', () => {
    expect(cambio('["a","b"]', '["a","b","c"]')).toBe(true);
  });

  test('una seccion retirada SI es un cambio', () => {
    expect(cambio('["a","b","c"]', '["a","b"]')).toBe(true);
  });

  test('una seccion sustituida por otra SI es un cambio', () => {
    expect(cambio('["a","b"]', '["a","z"]')).toBe(true);
  });

  // null (sin restriccion = acceso total) y [] (sin modulos) son estados
  // distintos entre si y distintos de cualquier lista.
  test('pasar de sin-restriccion a una lista SI es un cambio', () => {
    expect(cambio(null, '["a"]')).toBe(true);
  });

  test('pasar de una lista a sin-restriccion SI es un cambio', () => {
    expect(cambio('["a"]', null)).toBe(true);
  });

  test('sin-restriccion en ambos lados: no hay cambio', () => {
    expect(cambio(null, null)).toBe(false);
  });

  test('lista vacia y sin-restriccion no son lo mismo', () => {
    expect(cambio(null, '[]')).toBe(true);
  });

  test('un JSON corrupto no revienta', () => {
    expect(() => cambio('no es json', '["a"]')).not.toThrow();
  });
});

describe('showSection distingue un clic del usuario de una re-navegación', () => {
  const mostrar = source.slice(source.indexOf('function showSection'));
  const bloque = mostrar.slice(0, mostrar.indexOf('\n}\n'));

  test('con preserveActiveTab no se impone el data-sub-tab del menú', () => {
    expect(bloque).toContain('options.preserveActiveTab === true');
    const guarda = bloque.indexOf('options.preserveActiveTab === true');
    const uso = bloque.indexOf('subTabSolicitada');
    expect(guarda).toBeLessThan(bloque.indexOf('if (subTabSolicitada)'));
    expect(uso).toBeGreaterThan(-1);
  });

  // Sin la opcion, un clic real en el menu debe seguir mandando: hay entradas
  // distintas que apuntan a la misma seccion y solo se distinguen por su
  // data-sub-tab (Resumen General y Comparativa Historica, por ejemplo).
  test('sin la opción, el clic del menú sigue mandando sobre la memoria', () => {
    expect(bloque).toContain("String(linkEl?.dataset?.subTab || '').trim()");
    const restaurar = bloque.indexOf('restoreActiveTab(targetKey, target)');
    const forzar = bloque.indexOf('if (subTabSolicitada)');
    expect(forzar).toBeLessThan(restaurar);
  });

  test('restoreSectionFromNavigation propaga la opción a showSection', () => {
    const restaurar = source.slice(source.indexOf('function restoreSectionFromNavigation'));
    const cuerpo = restaurar.slice(0, restaurar.indexOf('\n}\n'));
    expect(cuerpo).toContain('function restoreSectionFromNavigation(sectionKey, options = {})');
    expect(cuerpo).toContain('showSection(key, link, options)');
  });

  // Las entradas de menu que tienen data-sub-tab son las que sufrian el tiron.
  test('existen entradas de menú con data-sub-tab (el caso que fallaba)', () => {
    expect(html).toContain('data-sub-tab="comparativa-yoy-tab"');
    expect(html).toContain('data-sub-tab="ops-resumen-tab"');
  });
});

describe('la pestaña recordada se busca donde se guardó', () => {
  const api = new Function('document', 'sessionStorage', `
    const SECTION_HOST_OVERRIDES = { itinerario: 'inicio' };
    const LAST_TAB_STORAGE_PREFIX = 'aifa.navigation.last_tab.';
    ${extraer('resolveSectionHostKey')}
    ${extraer('rememberActiveTab')}
    ${extraer('restoreActiveTab')}
    return { rememberActiveTab, restoreActiveTab };
  `)(document, window.sessionStorage);

  function pintarSeccion(idSeccion, idsTabs) {
    document.body.innerHTML = `
      <div id="${idSeccion}" class="content-section">
        <ul role="tablist">
          ${idsTabs.map((id, i) =>
            `<button id="${id}" class="nav-link${i === 0 ? ' active' : ''}"></button>`).join('')}
        </ul>
      </div>`;
    return document.getElementById(idSeccion);
  }

  beforeEach(() => {
    window.sessionStorage.clear();
    document.body.innerHTML = '';
  });

  // La ruta "itinerario" se aloja en "inicio-section": rememberActiveTab guarda
  // bajo "inicio" (el id del contenedor) y restoreActiveTab leia bajo
  // "itinerario". Nunca coincidian.
  test('una ruta con anfitrión distinto encuentra su pestaña', () => {
    const seccion = pintarSeccion('inicio-section', ['tab-uno', 'tab-dos']);
    api.rememberActiveTab(document.getElementById('tab-dos'));

    expect(api.restoreActiveTab('itinerario', seccion)).toBe(true);
  });

  test('la ruta normal sigue funcionando', () => {
    const seccion = pintarSeccion('conciliacion-section', ['tab-conci-itinerario', 'tab-conci-comercial']);
    api.rememberActiveTab(document.getElementById('tab-conci-comercial'));

    expect(api.restoreActiveTab('conciliacion', seccion)).toBe(true);
  });

  test('sin nada recordado no se inventa una pestaña', () => {
    const seccion = pintarSeccion('conciliacion-section', ['tab-conci-itinerario']);
    expect(api.restoreActiveTab('conciliacion', seccion)).toBe(false);
  });

  test('una pestaña recordada que ya no existe no rompe', () => {
    const seccion = pintarSeccion('conciliacion-section', ['tab-conci-itinerario']);
    window.sessionStorage.setItem('aifa.navigation.last_tab.conciliacion', 'tab-que-ya-no-existe');

    expect(api.restoreActiveTab('conciliacion', seccion)).toBe(false);
  });
});
