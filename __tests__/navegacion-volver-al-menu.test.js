/**
 * @jest-environment jsdom
 *
 * Volver al menú tiene que ser SALIR del módulo, no taparlo.
 *
 * Síntoma reportado: "entré a Colaboradores, después me fui al inicio, y a los
 * pocos minutos me regresó solo a la vista de Colaboradores".
 *
 * Causa: el botón "Menú" del lanzador de tarjetas (showMenu, js/navigation.js)
 * quitaba UNA CLASE del <body> —'navdeck-active'— y nada más. Por debajo, el
 * módulo que acababas de dejar seguía siendo la .content-section activa, el
 * hash seguía apuntando a él y currentSectionKey también. La aplicación creía
 * que seguías dentro mientras tú veías el lanzador.
 *
 * Con ese estado a medias, cualquier cosa que volviera a poner 'navdeck-active'
 * —o que releyera el hash para "reafirmar la ruta"— te metía de golpe en el
 * módulo anterior. Y hay cosas que lo hacen solas: el sondeo de permisos corre
 * cada 60 s (ver navegacion-involuntaria), y restoreSectionFromNavigation
 * termina siempre con document.body.classList.add('navdeck-active').
 *
 * El arreglo no es quitarle el gatillo a cada una de esas cosas: es que salir
 * del módulo deje el estado limpio, para que no haya nada desde donde
 * reconstruir una vista que ya abandonaste.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const navigation = fs
  .readFileSync(path.resolve(__dirname, '..', 'js', 'navigation.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  let inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

let currentSectionKeyEspejo = '';

const api = new Function('window', 'document', 'sessionStorage', 'location', 'history', 'espejo', `
  const LAST_SECTION_STORAGE_KEY = 'aifa.navigation.last_section';
  let currentSectionKey = 'colaboradores';
  ${extraer('exitSectionToMenu')}
  return {
    exitSectionToMenu,
    seccionRecordada: () => currentSectionKey,
  };
`)(window, document, window.sessionStorage, window.location, window.history, currentSectionKeyEspejo);

/** Deja la app como queda tras entrar a un módulo desde el lanzador. */
function dentroDe(clave) {
  document.body.className = 'navdeck-mode navdeck-active';
  document.body.innerHTML = `
    <div id="${clave}-section" class="content-section active"></div>
    <div id="inicio-section" class="content-section"></div>`;
  window.history.replaceState(null, '', `/#${clave}`);
  window.sessionStorage.setItem('aifa.navigation.last_section', clave);
}

beforeEach(() => {
  window.sessionStorage.clear();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('salir al menú deja el estado limpio', () => {
  test('ninguna sección queda activa', () => {
    dentroDe('colaboradores');
    expect(document.querySelectorAll('.content-section.active')).toHaveLength(1);

    api.exitSectionToMenu();

    expect(document.querySelectorAll('.content-section.active')).toHaveLength(0);
  });

  test('el hash se limpia, que es el rastro desde el que se reconstruía la vista', () => {
    dentroDe('colaboradores');
    expect(window.location.hash).toBe('#colaboradores');

    api.exitSectionToMenu();

    expect(window.location.hash).toBe('');
  });

  test('se olvida cuál era la sección abierta', () => {
    dentroDe('colaboradores');

    api.exitSectionToMenu();

    expect(api.seccionRecordada()).toBe('');
    expect(window.sessionStorage.getItem('aifa.navigation.last_section')).toBeNull();
  });

  // La pestaña recordada de cada sección SÍ se conserva: sirve para volver
  // donde estabas cuando ENTRES otra vez, que es lo que uno espera. Lo que no
  // puede quedar es el rastro de la sección misma.
  test('la pestaña recordada de cada sección se conserva', () => {
    dentroDe('colaboradores');
    window.sessionStorage.setItem('aifa.navigation.last_tab.colaboradores', 'colab-tab-cursos');

    api.exitSectionToMenu();

    expect(window.sessionStorage.getItem('aifa.navigation.last_tab.colaboradores'))
      .toBe('colab-tab-cursos');
  });

  test('no rompe si ya se estaba en el lanzador', () => {
    document.body.className = 'navdeck-mode';
    document.body.innerHTML = '<div id="inicio-section" class="content-section"></div>';

    expect(() => api.exitSectionToMenu()).not.toThrow();
    expect(window.location.hash).toBe('');
  });
});

describe('el botón "Menú" usa esa salida', () => {
  const showMenu = navigation.slice(
    navigation.indexOf('function showMenu()'),
    navigation.indexOf('window._navdeckShowMenu')
  );

  test('quitar la clase del body ya no es todo lo que hace', () => {
    expect(showMenu).toContain("document.body.classList.remove('navdeck-active')");
    expect(showMenu).toContain('window.exitSectionToMenu()');
  });

  // navigation.js no lleva defer y script.js sí: showMenu tiene que seguir
  // sirviendo aunque exitSectionToMenu todavía no exista.
  test('tiene respaldo propio por si script.js aún no cargó', () => {
    expect(showMenu).toContain(".content-section.active");
    expect(showMenu).toContain('history.replaceState');
  });
});

describe('un refresco de permisos no mete a nadie en un módulo', () => {
  // Estar en el lanzador es un estado válido: no hay sección activa porque el
  // usuario no quiere ninguna abierta. Tratarlo como anomalía y "repararlo"
  // navegando a una sección permitida es exactamente la navegación que sobra.
  const cuerpo = source.slice(
    source.indexOf('function applySectionPermissions('),
    source.indexOf('// Guardia de hash:')
  );

  test('reconoce el lanzador antes de decidir que falta una sección activa', () => {
    expect(cuerpo).toContain('const enElLanzador = document.body.classList.contains(\'navdeck-mode\')');
    expect(cuerpo).toContain("&& !document.body.classList.contains('navdeck-active')");
  });

  test('no navega ni reescribe el hash mientras se está en el lanzador', () => {
    expect(cuerpo).toContain('if (!enElLanzador && (!activeSection || activeSection.classList.contains(\'perm-hidden\')))');
    expect(cuerpo).toContain('if (!enElLanzador && hashKey &&');
  });
});
