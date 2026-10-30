/**
 * @jest-environment jsdom
 *
 * Flechas Atrás / Adelante del navegador.
 *
 * Síntoma reportado: al usar la flecha Atrás del navegador la página no
 * regresaba a la vista anterior; se salía de la aplicación.
 *
 * Causa: showSection y exitSectionToMenu cambian la dirección con
 * history.replaceState, así que el navegador nunca tenía un paso anterior.
 *
 * js/historial-navegador.js apila una entrada cuando el cambio lo pide el
 * usuario (clic o tecla) y, en 'popstate', reabre la vista de la dirección.
 */

const fs = require('fs');
const path = require('path');

const esperarPopstate = () => new Promise(resolve =>
  window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true }));

const abiertas = [];
let permitidas = new Set(['colaboradores', 'agenda']);
let menusMostrados = 0;

window.restoreSectionFromNavigation = (clave, options) => {
  abiertas.push({ clave, options });
  if (!permitidas.has(clave)) return false;
  history.replaceState(null, '', `#${clave}`);
  return true;
};
window._navdeckShowMenu = () => {
  menusMostrados += 1;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
};

window.eval(fs.readFileSync(path.resolve(__dirname, '..', 'js', 'historial-navegador.js'), 'utf8'));

/** Simula el clic del usuario que termina en showSection / exitSectionToMenu. */
function clicQueNavegaA(url) {
  const boton = document.createElement('button');
  boton.addEventListener('click', () => history.replaceState(null, '', url));
  document.body.appendChild(boton);
  boton.click();
  boton.remove();
}

beforeEach(() => {
  abiertas.length = 0;
  menusMostrados = 0;
  permitidas = new Set(['colaboradores', 'agenda']);
  window.sessionStorage.setItem('currentUser', 'operador');
  document.body.className = 'navdeck-mode';
});

describe('qué cambios dejan un paso en el historial', () => {
  test('un clic que abre un módulo apila una entrada', () => {
    history.replaceState(null, '', '/');
    const antes = history.length;

    clicQueNavegaA('#colaboradores');

    expect(location.hash).toBe('#colaboradores');
    expect(history.length).toBe(antes + 1);
  });

  test('un clic que regresa al menú también apila', () => {
    history.replaceState(null, '', '/#agenda');
    const antes = history.length;

    clicQueNavegaA('/');

    expect(location.hash).toBe('');
    expect(history.length).toBe(antes + 1);
  });

  test('lo que hace la app por su cuenta sigue reemplazando', () => {
    history.replaceState(null, '', '/');
    const antes = history.length;

    history.replaceState(null, '', '#colaboradores');

    expect(location.hash).toBe('#colaboradores');
    expect(history.length).toBe(antes);
  });

  test('volver a pedir el módulo en el que ya se está no apila nada', () => {
    history.replaceState(null, '', '/#agenda');
    const antes = history.length;

    clicQueNavegaA('#agenda');

    expect(history.length).toBe(antes);
  });

  test('#recover no es una vista de la app', () => {
    history.replaceState(null, '', '/');
    const antes = history.length;

    clicQueNavegaA('#recover');

    expect(history.length).toBe(antes);
  });
});

describe('Atrás y Adelante reabren la vista', () => {
  test('Atrás desde un módulo regresa al menú y Adelante vuelve a entrar', async () => {
    history.replaceState(null, '', '/');
    clicQueNavegaA('#colaboradores');

    history.back();
    await esperarPopstate();
    expect(location.hash).toBe('');
    expect(menusMostrados).toBe(1);

    history.forward();
    await esperarPopstate();
    expect(location.hash).toBe('#colaboradores');
    expect(abiertas).toEqual([{ clave: 'colaboradores', options: { preserveActiveTab: true } }]);
  });

  test('Atrás entre dos módulos regresa al anterior', async () => {
    history.replaceState(null, '', '/');
    clicQueNavegaA('#agenda');
    clicQueNavegaA('#colaboradores');

    history.back();
    await esperarPopstate();

    expect(location.hash).toBe('#agenda');
    expect(abiertas.map(a => a.clave)).toEqual(['agenda']);
  });

  test('un módulo al que ya no se tiene acceso cae al menú', async () => {
    history.replaceState(null, '', '/');
    clicQueNavegaA('#colaboradores');
    clicQueNavegaA('/');
    permitidas.delete('colaboradores');

    history.back();
    await esperarPopstate();

    expect(menusMostrados).toBe(1);
    expect(location.hash).toBe('');
  });

  test('reabrir la vista no apila pasos nuevos', async () => {
    history.replaceState(null, '', '/');
    clicQueNavegaA('#agenda');
    clicQueNavegaA('/');
    const antes = history.length;

    history.back();
    await esperarPopstate();

    expect(history.length).toBe(antes);
  });

  test('suelta la pantalla completa de Conciliación al salir con Atrás', async () => {
    history.replaceState(null, '', '/');
    clicQueNavegaA('#agenda');
    document.body.classList.add('conci-manifest-workspace', 'conci-reportes-abierto');

    history.back();
    await esperarPopstate();

    expect(document.body.classList.contains('conci-manifest-workspace')).toBe(false);
    expect(document.body.classList.contains('conci-reportes-abierto')).toBe(false);
  });

  test('sin sesión no se abre nada', async () => {
    history.replaceState(null, '', '/');
    clicQueNavegaA('#agenda');
    window.sessionStorage.removeItem('currentUser');

    history.back();
    await esperarPopstate();

    expect(menusMostrados).toBe(0);
    expect(abiertas).toHaveLength(0);
  });
});
