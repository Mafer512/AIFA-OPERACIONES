/**
 * Un solo nombre por aerolínea en todo el sistema.
 *
 * Los datos operativos traen el nombre como lo escribió quien capturó: "VIVA",
 * "viva", "Viva Aerobus", "VIVA AEROBUS S.A. DE C.V.". Cada variante se contaba
 * aparte, así que en el resumen de impactos de fauna salían dos tarjetas de la
 * misma aerolínea —una con 40 y otra con 1— y la del nombre raro se quedaba sin
 * logo, como un renglón de texto suelto.
 *
 * El catálogo (tabla airlines, que se administra en Gestión de Datos) ya sabe
 * el nombre bueno, sus alias, su logo y su color: aquí se comprueba que sea él
 * quien mande.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const catalogo = require('../js/airline-catalog.js');
const fauna = fs.readFileSync(path.join(raiz, 'js/fauna.js'), 'utf8');
const script = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8');
const dataMgmt = fs.readFileSync(path.join(raiz, 'js/data-management.js'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const CATALOGO = [
    {
        name: 'VIVA Aerobus',
        aliases: ['viva', 'vivaaerobus', 'viva aerobus'],
        logo_url: 'https://storage/airline-logos/viva.png',
        color: '#00b140',
        iata: 'VB',
    },
    { name: 'Volaris', aliases: ['volaris'], logo_url: null, color: '#a020f0', iata: 'Y4' },
    { name: 'Aeroméxico', aliases: ['aeromexico', 'am'], logo_url: 'https://storage/am.png', iata: 'AM' },
];

beforeEach(() => catalogo._sembrar(CATALOGO));

describe('el nombre bueno de cada aerolínea', () => {
    test('todas las variantes capturadas llevan al mismo nombre', () => {
        for (const escrito of ['viva', 'VIVA', ' Viva Aerobus ', 'VIVA AEROBUS S.A. DE C.V.', 'vivaaerobus']) {
            expect(catalogo.canonico(escrito)).toBe('VIVA Aerobus');
        }
    });

    test('los acentos y las mayúsculas dan igual', () => {
        expect(catalogo.canonico('AEROMEXICO')).toBe('Aeroméxico');
        expect(catalogo.canonico('aeroméxico')).toBe('Aeroméxico');
    });

    test('el código IATA también identifica', () => {
        expect(catalogo.canonico('Y4')).toBe('Volaris');
    });

    test('una aerolínea que aún no está en el catálogo se respeta tal cual', () => {
        // Nada se pierde: aparece con su nombre hasta que alguien la dé de alta.
        expect(catalogo.canonico('Cathay Cargo')).toBe('Cathay Cargo');
        expect(catalogo.canonico('  MCS Air Cargo  ')).toBe('MCS Air Cargo');
    });
});

describe('lo que el catálogo le da a las vistas', () => {
    test('el logo que subió el área, buscándolo por cualquier alias', () => {
        expect(catalogo.logo('viva')).toBe('https://storage/airline-logos/viva.png');
        expect(catalogo.logo('VIVA AEROBUS')).toBe('https://storage/airline-logos/viva.png');
        expect(catalogo.logo('Cathay Cargo')).toBeNull();
    });

    test('el color de la marca', () => {
        expect(catalogo.color('viva')).toBe('#00b140');
    });

    test('iniciales para las que todavía no tienen logo', () => {
        // Con IATA se usa el código, que es como las nombran en operaciones.
        expect(catalogo.iniciales('Volaris')).toBe('Y4');
        // Sin catálogo, las iniciales del nombre.
        expect(catalogo.iniciales('Cathay Cargo')).toBe('CC');
        expect(catalogo.iniciales('Estafeta')).toBe('EST');
    });

    test('agrupar suma las variantes en un solo renglón', () => {
        const total = catalogo.agrupar({ VIVA: 40, viva: 1, 'Viva Aerobus': 3, Volaris: 8 });
        expect(total.get('VIVA Aerobus')).toBe(44);
        expect(total.get('Volaris')).toBe(8);
        expect(total.size).toBe(2);
    });
});

describe('el catálogo nunca estorba', () => {
    test('sin catálogo cargado, el nombre capturado sigue sirviendo', () => {
        catalogo._sembrar([]);
        expect(catalogo.canonico('viva')).toBe('viva');
        expect(catalogo.logo('viva')).toBeNull();
    });
});

describe('las vistas lo usan', () => {
    test('el resumen de fauna cuenta por aerolínea, no por variante escrita', () => {
        expect(fauna).toContain("const a = aerolineaCanonica(r['Aerolínea']) || 'Sin aerolínea';");
        expect(fauna).toContain("const airlines = uniqueSorted(state.raw.map(r => aerolineaCanonica(r['Aerolínea'])));");
        expect(fauna).toContain("if (aerolineaCanonica(r['Aerolínea']) !== airline) return false;");
    });

    test('sin logo se pinta el distintivo, no un renglón de texto suelto', () => {
        expect(fauna).toContain('function distintivoAerolinea(nombre, claseExtra)');
        expect(fauna).toContain(": distintivoAerolinea(airline) + ' ';");
        expect(app).toContain('.al-inicial {');
    });

    test('el buscador de logos de toda la app pregunta primero al catálogo', () => {
        expect(script).toContain('const catalogo = window.AifaAerolineas;');
        expect(script).toMatch(/catalogo\.logo\(airline\)/);
    });

    test('se carga junto al resto de la aplicación', () => {
        expect(app).toContain('js/airline-catalog.js');
    });

    test('el catálogo tiene una lista de a quiénes les falta el logo', () => {
        expect(app).toContain("onclick=\"alSetFilter('sin-logo', null)\"");
        expect(dataMgmt).toContain("if (alFilter === 'sin-logo') {");
    });
});
