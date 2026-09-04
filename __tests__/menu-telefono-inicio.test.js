/**
 * @jest-environment jsdom
 *
 * En el teléfono, el menú de tarjetas (nav deck) ES la pantalla de inicio, no
 * un cajón lateral. Las reglas que hacen eso vivían solo en escritorio, así que
 * al entrar desde un teléfono uno se topaba con el área de contenido vacía, y
 * el botón de las tres líneas deslizaba una hoja que además solo cubría parte
 * de la pantalla.
 *
 * Aquí se ejercita el comportamiento del botón: dentro de un módulo devuelve el
 * inicio completo (sin dejar el estado de cajón abierto), y en el inicio no
 * tiene nada que desplegar.
 */

const fs = require('fs');
const path = require('path');

const source = fs
    .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
    .replace(/\r\n/g, '\n');

function extraerFuncion(firma) {
    const inicio = source.indexOf(firma);
    if (inicio < 0) throw new Error(`No se encontró: ${firma}`);
    const fin = source.indexOf('\n}\n', inicio);
    if (fin < 0) throw new Error(`No se encontró el cierre de: ${firma}`);
    return source.slice(inicio, fin + 2);
}

const toggleSidebar = new Function(
    `${extraerFuncion('function toggleSidebar() {')}; return toggleSidebar;`
)();

function montarPantalla({ ancho, clasesBody }) {
    document.body.className = clasesBody;
    document.body.innerHTML = `
        <aside id="sidebar" class="sidebar nav-deck"></aside>
        <div id="sidebar-overlay" class="sidebar-overlay"></div>`;
    Object.defineProperty(window, 'innerWidth', { value: ancho, configurable: true });
    window.scrollTo = jest.fn();
    window._navdeckShowMenu = jest.fn(() => document.body.classList.remove('navdeck-active'));
    return {
        sidebar: document.getElementById('sidebar'),
        overlay: document.getElementById('sidebar-overlay')
    };
}

describe('las tres líneas del menú en el teléfono', () => {
    test('dentro de un módulo devuelven el inicio, no una hoja a medias', () => {
        const { sidebar, overlay } = montarPantalla({
            ancho: 390,
            clasesBody: 'navdeck-mode navdeck-active'
        });

        toggleSidebar();

        expect(window._navdeckShowMenu).toHaveBeenCalledTimes(1);
        expect(document.body.classList.contains('navdeck-active')).toBe(false);
        // Nada de cajón abierto: ni panel deslizado, ni velo, ni scroll trabado.
        expect(sidebar.classList.contains('visible')).toBe(false);
        expect(overlay.classList.contains('active')).toBe(false);
        expect(document.body.classList.contains('sidebar-open')).toBe(false);
    });

    test('en el inicio no hay nada que desplegar', () => {
        const { sidebar, overlay } = montarPantalla({
            ancho: 390,
            clasesBody: 'navdeck-mode'
        });

        toggleSidebar();

        expect(window._navdeckShowMenu).not.toHaveBeenCalled();
        expect(sidebar.classList.contains('visible')).toBe(false);
        expect(overlay.classList.contains('active')).toBe(false);
        expect(document.body.classList.contains('sidebar-open')).toBe(false);
    });

    test('sin modo deck sigue funcionando el cajón de siempre', () => {
        const { sidebar, overlay } = montarPantalla({ ancho: 390, clasesBody: '' });

        toggleSidebar();

        expect(sidebar.classList.contains('visible')).toBe(true);
        expect(overlay.classList.contains('active')).toBe(true);
        expect(document.body.classList.contains('sidebar-open')).toBe(true);
    });

    test('en escritorio el botón no toca el estado del teléfono', () => {
        const { sidebar } = montarPantalla({ ancho: 1400, clasesBody: 'navdeck-mode' });

        toggleSidebar();

        expect(sidebar.classList.contains('visible')).toBe(false);
        expect(window._navdeckShowMenu).not.toHaveBeenCalled();
    });
});
