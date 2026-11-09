/**
 * @jest-environment jsdom
 *
 * La barra HOY / MAÑANA es del Inicio: dentro de un módulo sólo quitaba
 * espacio. Se oculta mientras hay una sección abierta, vuelve con el Mapa
 * Interactivo (ahí está su botón para cerrarlo) y, mientras está oculta, el
 * mapa se abre desde un botón del encabezado. Nada deja de poder hacerse.
 */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n');
const css = leer('style.css');
const html = leer('index.html');

describe('reglas de la barra', () => {
    test('se oculta dentro de un módulo, salvo con el mapa abierto', () => {
        expect(css).toMatch(/body\.navdeck-mode\.navdeck-active:not\(\.mapa-abierto\) #ag-today-bar \{\s*display: none !important;/);
    });

    test('el botón del mapa en el encabezado sólo aparece cuando la barra no está', () => {
        expect(css).toMatch(/#btn-mapa-header \{\s*display: none !important;/);
        expect(css).toMatch(/body\.navdeck-mode\.navdeck-active:not\(\.mapa-abierto\) #btn-mapa-header \{\s*display: inline-flex !important;/);
        const boton = html.slice(html.indexOf('<button id="btn-mapa-header"'), html.indexOf('<button id="btn-global-refresh"'));
        expect(boton).toContain('onclick="toggleMapaInteractivo()"');
        // Va en el encabezado, no en la barra que se oculta.
        expect(html.indexOf('<button id="btn-mapa-header"')).toBeLessThan(html.indexOf('<div id="ag-today-bar"'));
    });

    test('la barra conserva su botón original del mapa y su agenda', () => {
        const barra = html.slice(html.indexOf('<div id="ag-today-bar"'), html.indexOf('<!-- Contenedor de Alertas del Sistema'));
        expect(barra).toContain('id="btn-mapa-interactivo"');
        expect(barra).toContain('onclick="_goToAgenda()"');
    });
});

describe('espacio arriba de los módulos', () => {
    test('el encabezado y <main> se aprietan dentro de un módulo', () => {
        expect(css).toMatch(/body\.navdeck-mode\.navdeck-active \.header \{\s*margin-bottom: \.5rem !important;/);
        expect(css).toMatch(/body\.navdeck-mode\.navdeck-active \.main-content \{\s*padding-top: \.5rem !important;/);
    });

    test('si el módulo abierto vive fuera de <main>, <main> vacío no ocupa lugar', () => {
        expect(css).toMatch(/body\.navdeck-mode\.navdeck-active \.main-content:not\(:has\(\.content-section\.active\)\) \{\s*padding-top: 0 !important;\s*padding-bottom: 0 !important;/);
    });
});

describe('el mapa marca cuándo está abierto', () => {
    beforeAll(() => {
        document.body.className = 'navdeck-mode navdeck-active';
        document.body.innerHTML = `
            <div id="ag-today-bar"><button id="btn-mapa-interactivo"></button></div>
            <nav><a class="menu-item" href="#" data-section="conciliacion" id="ir-conci">Conciliación</a></nav>
            <div class="content-section active" id="conciliacion-section"></div>
            <div class="content-section" id="mapa-interactivo-section"><iframe id="mapa-interactivo-iframe"></iframe></div>`;
        window.showSection = jest.fn();
        new Function(leer('js/mapa-interactivo.js'))();
    });
    const espera = () => new Promise(r => setTimeout(r, 300));   // la guardia de doble clic es de 250 ms

    test('al abrirlo vuelve la barra; al cerrarlo se va de nuevo', async () => {
        window.toggleMapaInteractivo();
        expect(document.body.classList.contains('mapa-abierto')).toBe(true);
        expect(document.getElementById('mapa-interactivo-section').classList.contains('active')).toBe(true);
        await espera();
        window.toggleMapaInteractivo();
        expect(document.body.classList.contains('mapa-abierto')).toBe(false);
        expect(document.getElementById('conciliacion-section').classList.contains('active')).toBe(true);
    });

    test('si se sale del mapa por el menú, la barra vuelve a su regla normal', async () => {
        await espera();
        window.toggleMapaInteractivo();
        expect(document.body.classList.contains('mapa-abierto')).toBe(true);
        document.getElementById('ir-conci').click();
        expect(document.body.classList.contains('mapa-abierto')).toBe(false);
    });

    test('y también si la sección del mapa deja de estar activa por otro camino', async () => {
        await espera();
        window.toggleMapaInteractivo();
        expect(document.body.classList.contains('mapa-abierto')).toBe(true);
        document.getElementById('mapa-interactivo-section').classList.remove('active');
        await new Promise(r => setTimeout(r, 0));
        expect(document.body.classList.contains('mapa-abierto')).toBe(false);
    });
});
