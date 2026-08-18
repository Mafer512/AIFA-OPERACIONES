/**
 * @jest-environment node
 *
 * El sondeo de permisos no puede mover a nadie de pantalla.
 *
 * Cada 60 segundos la aplicación relee los permisos del usuario desde Supabase,
 * para que un cambio hecho por un administrador se note sin recargar. Esa
 * función terminaba, siempre, con:
 *
 *     const routeKey = String(location.hash || '').replace(/^#/, '').trim();
 *     if (routeKey) restoreSectionFromNavigation(routeKey);
 *
 * y eso no era una comprobación de permisos: era una navegación. Releía el
 * hash, llamaba a showSection y, 60 ms después, volvía a aplicar la última
 * sub-pestaña recordada.
 *
 * Bastaba con estar en una vista que el hash no refleja —el inicio, o una
 * sub-vista que no dispara shown.bs.tab— para que la pantalla saltara sola una
 * vez por minuto a donde uno ya no estaba. Con la mano puesta en el teclado.
 *
 * El único caso en que sí debe mover a alguien es que los permisos hayan
 * cambiado y la sección abierta haya dejado de estar permitida.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `async function ${nombre}(`;
  const inicio = fuente.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre}`);
  return fuente.slice(inicio, fuente.indexOf('\n}\n', inicio) + 2);
}

const cuerpo = extraer('refreshUserPermissionsFromServer');

describe('la navegación salió del sondeo', () => {
  test('ya no se navega leyendo el hash en cada pasada', () => {
    expect(cuerpo).not.toContain("location.hash || ''");
    expect(cuerpo).not.toMatch(/if \(routeKey\) restoreSectionFromNavigation\(routeKey\)/);
  });

  test('lo que quede de navegación está condicionado a que los permisos cambien', () => {
    // Si alguna vez se vuelve a navegar desde aquí, que sea dentro del if.
    const idx = cuerpo.indexOf('restoreSectionFromNavigation');
    if (idx === -1) return;                       // mejor todavía: no navega
    const antes = cuerpo.slice(0, idx);
    expect(antes).toContain('if (permisosCambiaron)');
  });

  test('se sigue re-aplicando los permisos cuando cambian', () => {
    expect(cuerpo).toContain('const permisosCambiaron = next !== prev;');
    expect(cuerpo).toContain('applySectionPermissions(');
  });
});

describe('cuando los permisos cambian de verdad', () => {
  test('solo se saca al usuario si la sección abierta dejó de estar permitida', () => {
    expect(cuerpo).toContain("document.querySelector('.content-section.active')");
    expect(cuerpo).toContain('isSectionAllowed(claveAbierta)');
    expect(cuerpo).toMatch(/if \(!sigueDentro\)/);
  });

  test('y se le dice por qué, en vez de moverlo sin explicación', () => {
    expect(cuerpo).toMatch(/showNotification\([^)]*permisos cambiaron/i);
  });

  test('Conciliación no se cierra por esta vía', () => {
    // Es una sección de acceso garantizado para quien captura; la comprobación
    // de secciones permitidas no aplica igual.
    expect(cuerpo).toContain("claveAbierta === 'conciliacion'");
  });
});

describe('lo que el sondeo sí debe seguir haciendo', () => {
  test('corre cada 60 s, solo con sesión y con la pestaña a la vista', () => {
    const arranque = fuente.slice(fuente.indexOf('function startPermissionsAutoRefresh'));
    expect(arranque.slice(0, 500)).toContain('60000');
    expect(arranque.slice(0, 500)).toContain('sessionStorage.getItem(SESSION_USER)');
    expect(arranque.slice(0, 500)).toContain('document.hidden');
  });

  test('la restauración al recargar la página sigue en su sitio, aparte', () => {
    // El arranque navega por su propio camino (mainWasHidden); esto no se tocó.
    expect(fuente).toContain('restoreSectionFromNavigation(requestedSectionKey)');
  });
});
