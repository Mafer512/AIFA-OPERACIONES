/**
 * Pasada móvil para teléfonos.
 *
 * Lo que se cuida aquí es el encimamiento que se reportó: la barra HOY/MAÑANA
 * lleva z-index 1310 para ganarle al header, y el menú lateral quedaba por
 * debajo (1050), así que al abrirlo en el teléfono la barra se pintaba ENCIMA
 * del panel y tapaba las tarjetas mientras uno bajaba.
 *
 * Las medidas de tableta (≥ 576 px) no se tocan: la pasada nueva vive en
 * consultas de ≤ 575.98 px, salvo el bloque de capas.
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8').replace(/\r\n/g, '\n');

// La pasada vive en un par de @media y cada apartado se delimita con su
// comentario numerado, así que se lee por tajadas entre un "── n." y el
// siguiente.
const pasada = css.slice(css.indexOf('PASADA MÓVIL'));

function apartado(numero) {
    const from = pasada.indexOf('── ' + numero + '.');
    if (from < 0) throw new Error(`No se encontró el apartado ${numero}`);
    const next = pasada.indexOf('── ' + (numero + 1) + '.', from);
    return pasada.slice(from, next < 0 ? pasada.length : next);
}

function declaration(block, selector, prop) {
    const idx = block.indexOf(selector);
    if (idx < 0) return null;
    const body = block.slice(block.indexOf('{', idx) + 1, block.indexOf('}', idx));
    const match = body.match(new RegExp(prop + '\\s*:\\s*([^;]+)'));
    return match ? match[1].trim().replace(/\s*!important$/, '') : null;
}

describe('pasada móvil para teléfonos', () => {
    test('con el menú abierto, el menú queda por encima de la barra de agenda', () => {
        const bar = Number((css.match(/\.ag-today-bar\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
        expect(bar).toBeGreaterThan(0);

        const capas = apartado(1);
        const menuZ = Number((capas.match(/z-index:\s*(\d+)/) || [])[1]);
        expect(menuZ).toBeGreaterThan(bar);
        // Y por debajo de los modales, que van en 1650.
        expect(menuZ).toBeLessThan(1650);
        expect(capas).toContain('body.sidebar-open .ag-today-bar');
        expect(capas).toMatch(/body\.sidebar-open #_aga-fab[\s\S]*?display:\s*none/);
    });

    test('en el teléfono el deck de tarjetas es la pantalla de inicio', () => {
        const modelo = pasada.slice(pasada.indexOf('── 1 bis.'), pasada.indexOf('── 2.'));
        const deck = 'body.navdeck-mode:not(.navdeck-active) .sidebar.nav-deck';
        // Se ve completo al entrar: contenido normal de la página, no una hoja
        // desplegable escondida que además dejaba una franja muerta abajo.
        expect(declaration(modelo, deck, 'position')).toBe('static');
        expect(declaration(modelo, deck, 'max-height')).toBe('none');
        expect(declaration(modelo, deck, 'transform')).toBe('none');
        // Y mientras no hay módulo abierto, el área de contenido vacía no se ve.
        expect(modelo).toMatch(/:not\(\.navdeck-active\) \.main-content[\s\S]*?display:\s*none/);
        // Dentro de un módulo el deck desaparece, como en escritorio.
        expect(modelo).toMatch(/\.navdeck-active \.sidebar\.nav-deck \{\s*display:\s*none/);
        // Ya no queda ninguna hoja recortada al 92 % del alto.
        expect(pasada).not.toContain('92dvh');
    });

    test('el hero del banner deja de ser una fila apretada', () => {
        const block = apartado(3);
        expect(declaration(block, '.ndw-hero {', 'flex-wrap')).toBe('wrap');
        // El selector de vista se va a su propio renglón completo.
        expect(declaration(block, '.ndw-view-toggle {', 'flex')).toBe('1 0 100%');
        // Sin Ken Burns: es parte de lo que trababa el desplazamiento.
        expect(declaration(block, '.ndw-hero-media {', 'animation')).toBe('none');
    });

    test('la barra HOY/MAÑANA se queda en un solo renglón deslizable', () => {
        const block = apartado(5);
        expect(declaration(block, '.ag-tb-inner {', 'flex-wrap')).toBe('nowrap');
        expect(declaration(block, '.ag-tb-inner {', 'overflow-x')).toBe('auto');
    });

    test('las pestañas de módulo se deslizan en vez de apilarse', () => {
        const block = apartado(6);
        expect(declaration(block, '.nav-tabs,\n   .nav-pills {', 'overflow-x')).toBe('auto');
        expect(declaration(block, '.nav-tabs,\n   .nav-pills {', 'flex-wrap')).toBe('nowrap');
    });

    test('nada de la pasada nueva alcanza a las tabletas', () => {
        const queries = [...pasada.matchAll(/@media ([^{]+)\{/g)].map(m => m[1].trim());
        expect(queries.length).toBeGreaterThan(0);
        queries.forEach(q => {
            expect(q).toMatch(/max-width:\s*(991\.98px|575\.98px|360px)/);
        });
        // Los únicos ≤ 991.98 px son los dos que arreglan defectos que también
        // se daban en tableta: el encimamiento de capas y el modelo del deck.
        expect(queries.filter(q => q.includes('991.98px'))).toHaveLength(2);
    });
});
