/**
 * Estacionamiento del AIFA: pegar un QR en cada columna y volver al coche.
 *
 * Son tres páginas sueltas, sin servidor ni base de datos:
 *
 *   parking-admin.html  el área da de alta las columnas y saca los QR a imprimir
 *   parking.html        lo que abre el pasajero al escanear: guarda su lugar y
 *                       después lo lleva de regreso
 *   parking-demo.html   la presentación con la que se explica el proyecto
 *
 * Todo vive en el navegador (localStorage), así que lo que se prueba aquí es el
 * viaje completo: alta de columna → URL del QR → escaneo → guardado → regreso.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const archivo = nombre => path.join(raiz, nombre);

/** QRCode viene de un CDN: aquí se suple con un doble que anota lo que le piden. */
function dobleDeQR(window) {
    const generados = [];
    function QRCode(el, opciones) {
        generados.push(opciones);
        const lienzo = window.document.createElement('canvas');
        el.appendChild(lienzo);
    }
    QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
    window.QRCode = QRCode;
    window.__qrGenerados = generados;
}

function abrir(nombre, { url = 'https://aifa.test/' + nombre, conQR = false } = {}) {
    const dom = new JSDOM(fs.readFileSync(archivo(nombre), 'utf8'), {
        url,
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse(window) {
            // jsdom no hace scroll ni pinta: se suplen para no ensuciar la salida.
            window.scrollTo = () => {};
            if (conQR) dobleDeQR(window);
        },
    });
    return dom;
}

describe('el generador de QR de las columnas', () => {
    let dom;
    let window;

    beforeEach(() => {
        dom = abrir('parking-admin.html', { conQR: true });
        window = dom.window;
    });

    afterEach(() => dom.window.close());

    test('arranca sin reclamar nada', () => {
        expect(window.document.getElementById('qr-grid').textContent)
            .toContain('Los QR aparecerán aquí');
        // Con la librería cargada no debe salir el aviso de que no cargó.
        expect(window.document.getElementById('qr-grid').textContent).not.toContain('no pudo cargar');
    });

    test('dar de alta una columna la deja lista para imprimir', () => {
        window.document.getElementById('f-sec').value = 'b';
        window.document.getElementById('f-num').value = '14';
        window.document.getElementById('f-nivel').value = 'N1';
        window.document.getElementById('f-color').value = 'amarillo';
        window.addColumn();

        // La tarjeta con su QR queda en la cuadrícula, que sigue en pie.
        const grid = window.document.getElementById('qr-grid');
        expect(grid).not.toBeNull();
        expect(grid.isConnected).toBe(true);
        expect(grid.querySelectorAll('.qr-card')).toHaveLength(1);
        expect(grid.textContent).toContain('Columna 14');
        // Y en la lista lateral, para poder borrarla.
        expect(window.document.getElementById('col-count').textContent).toBe('1');
        expect(window.document.getElementById('col-list').textContent).toContain('Col. B14');
    });

    test('la segunda columna se agrega junto a la primera', () => {
        window.document.getElementById('f-sec').value = 'B';
        window.document.getElementById('f-num').value = '1';
        window.addColumn();
        window.document.getElementById('f-num').value = '2';
        window.addColumn();

        expect(window.document.getElementById('qr-grid').querySelectorAll('.qr-card')).toHaveLength(2);
        expect(window.document.getElementById('col-count').textContent).toBe('2');
    });

    test('lo dado de alta se guarda para la próxima vez', () => {
        window.document.getElementById('f-sec').value = 'C';
        window.document.getElementById('f-num').value = '7';
        window.addColumn();

        const guardado = JSON.parse(window.localStorage.getItem('aifa_parking_admin_v1'));
        expect(guardado).toHaveLength(1);
        expect(guardado[0]).toMatchObject({ col: 'C', num: '7' });
    });

    test('el QR lleva la dirección de la página del pasajero con su columna', () => {
        window.document.getElementById('base-url').value = 'https://aifa.test/parking.html';
        window.document.getElementById('f-sec').value = 'B';
        window.document.getElementById('f-num').value = '14';
        window.document.getElementById('f-nivel').value = 'N1';
        window.document.getElementById('f-lat').value = '19.754000';
        window.document.getElementById('f-lng').value = '-99.076200';
        window.addColumn();

        const url = new URL(window.buildURL(window.columns[0]));
        expect(url.origin + url.pathname).toBe('https://aifa.test/parking.html');
        expect(url.searchParams.get('col')).toBe('B');
        expect(url.searchParams.get('num')).toBe('14');
        expect(url.searchParams.get('nivel')).toBe('N1');
        expect(url.searchParams.get('lat')).toBe('19.754000');
    });

    test('la sección elige sola su color, que es como se señaliza el patio', () => {
        window.document.getElementById('f-sec').value = 'C';
        window.autoColor();
        expect(window.document.getElementById('f-color').value).toBe('verde');
    });

    test('los avisos y las preguntas salen en español, no en códigos HTML', () => {
        const fuente = fs.readFileSync(archivo('parking-admin.html'), 'utf8');
        const dialogos = fuente.match(/(?:confirm|prompt|alert)\((['"])[\s\S]*?\1/g) || [];
        expect(dialogos.length).toBeGreaterThan(0);
        dialogos.forEach(dialogo => expect(dialogo).not.toMatch(/&#x[0-9A-Fa-f]+;/));
    });
});

describe('la página que abre el pasajero al escanear', () => {
    const conQR = 'https://aifa.test/parking.html?col=B&num=14&nivel=N1&color=amarillo&lat=19.754&lng=-99.0762';

    test('el QR de la columna la muestra lista para guardar', () => {
        const dom = abrir('parking.html', { url: conQR });
        const { document } = dom.window;

        expect(document.getElementById('sc-save').classList.contains('d-none')).toBe(false);
        expect(document.getElementById('sv-sec').textContent).toBe('B');
        expect(document.getElementById('sv-num').textContent).toBe('14');
        expect(document.getElementById('sv-nivel').textContent).toBe('N1');
        expect(document.getElementById('sv-gps').textContent).toBe('19.75400, -99.07620');
        dom.window.close();
    });

    test('guardar el lugar lo deja anotado y confirma en pantalla', () => {
        const dom = abrir('parking.html', { url: conQR });
        const { window } = dom;
        window.saveSpot();

        const guardado = JSON.parse(window.localStorage.getItem('aifa_parking_v1'));
        expect(guardado).toMatchObject({ col: 'B', num: '14', nivel: 'N1', color: 'amarillo' });
        expect(typeof guardado.savedAt).toBe('number');
        expect(window.document.getElementById('sc-saved').classList.contains('d-none')).toBe(false);
        dom.window.close();
    });

    test('sin QR y sin nada guardado, invita a escanear', () => {
        const dom = abrir('parking.html', { url: 'https://aifa.test/parking.html' });
        expect(dom.window.document.getElementById('sc-empty').classList.contains('d-none')).toBe(false);
        dom.window.close();
    });

    test('al volver, la página lleva de regreso al coche', () => {
        // Primero se escanea y se guarda...
        const escaneo = abrir('parking.html', { url: conQR });
        escaneo.window.saveSpot();
        const memoria = escaneo.window.localStorage.getItem('aifa_parking_v1');
        escaneo.window.close();

        // ...y después se abre la página sin QR, como quien regresa del vuelo.
        const regreso = new JSDOM(fs.readFileSync(archivo('parking.html'), 'utf8'), {
            url: 'https://aifa.test/parking.html',
            runScripts: 'dangerously',
            pretendToBeVisual: true,
            beforeParse(window) {
                window.scrollTo = () => {};
                window.localStorage.setItem('aifa_parking_v1', memoria);
            },
        });
        const { document } = regreso.window;

        expect(document.getElementById('sc-find').classList.contains('d-none')).toBe(false);
        expect(document.getElementById('fd-card').textContent).toContain('14');
        // Con las coordenadas de la columna, el mapa apunta al lugar exacto.
        const maps = document.querySelector('#nav-grid a[href*="google.com/maps"]');
        expect(maps.href).toContain('destination=19.754,-99.0762');
        expect(maps.href).toContain('travelmode=walking');
        regreso.window.close();
    });

    test('las preguntas al pasajero salen en español', () => {
        const fuente = fs.readFileSync(archivo('parking.html'), 'utf8');
        const dialogos = fuente.match(/(?:confirm|prompt|alert)\((['"])[\s\S]*?\1/g) || [];
        dialogos.forEach(dialogo => expect(dialogo).not.toMatch(/&#x[0-9A-Fa-f]+;/));
    });
});

describe('las tres páginas se sostienen solas', () => {
    const paginas = ['parking.html', 'parking-admin.html', 'parking-demo.html'];

    test('no dependen de nada del sistema de operaciones', () => {
        for (const pagina of paginas) {
            const fuente = fs.readFileSync(archivo(pagina), 'utf8');
            expect(fuente).not.toMatch(/supabase/i);
            // Lo único local que ocupan es el logo.
            const locales = (fuente.match(/(?:src|href)="(?!https?:|#|mailto:)([^"]+)"/g) || [])
                .map(cita => cita.replace(/^(?:src|href)="/, '').replace(/"$/, ''))
                // Sólo rutas de verdad: las armadas en JS ('+url+') no cuentan.
                .filter(ruta => /^[\w./-]+$/.test(ruta) && !ruta.startsWith('parking'));
            locales.forEach(ruta => {
                expect(fs.existsSync(archivo(ruta))).toBe(true);
            });
        }
    });

    test('la demo enlaza a las dos páginas de verdad', () => {
        const demo = fs.readFileSync(archivo('parking-demo.html'), 'utf8');
        expect(demo).toContain('href="parking-admin.html"');
        expect(demo).toContain('href="parking.html"');
    });
});
