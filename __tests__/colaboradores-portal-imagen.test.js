/**
 * @jest-environment jsdom
 *
 * El portal del QR lo abre el colaborador desde su teléfono, y el alta la usa
 * el área de personal. Dos cosas se cuidan aquí:
 *
 *  · La palabra "token" no significa nada para quien llena el formulario: el
 *    código del enlace viaja escondido y en pantalla solo se habla del QR.
 *  · Los dos formularios llevan el logo del AIFA.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const portalHtml = fs.readFileSync(path.join(raiz, 'colaborador-registro.html'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

/** El portal montado en jsdom, sin ejecutar sus scripts. */
function montarPortal() {
    const sinScripts = portalHtml.replace(/<script[\s\S]*?<\/script>/g, '');
    document.documentElement.innerHTML = sinScripts;
    return document;
}

/** Todo lo que un ojo humano llega a leer en la página. */
function textoVisible(doc) {
    const partes = [doc.body.textContent];
    doc.querySelectorAll('[placeholder]').forEach(el => partes.push(el.getAttribute('placeholder')));
    doc.querySelectorAll('[title]').forEach(el => partes.push(el.getAttribute('title')));
    doc.querySelectorAll('[aria-label]').forEach(el => partes.push(el.getAttribute('aria-label')));
    return partes.join(' ');
}

describe('el portal de registro por QR', () => {
    test('no le habla al colaborador de tokens', () => {
        const doc = montarPortal();
        expect(textoVisible(doc)).not.toMatch(/token/i);
    });

    test('el código del enlace viaja oculto, no en un campo que se ve', () => {
        const doc = montarPortal();
        const campo = doc.getElementById('token-input');
        expect(campo).not.toBeNull();
        expect(campo.getAttribute('type')).toBe('hidden');
        // Y sigue siendo de donde lo lee el script al cargar por URL.
        expect(portalHtml).toContain("$('token-input').value = tokenFromUrl;");
    });

    test('lleva el logo del AIFA', () => {
        const doc = montarPortal();
        const logo = doc.querySelector('.appbar-logo');
        expect(logo).not.toBeNull();
        expect(logo.getAttribute('src')).toBe('images/aifa-logo.png');
        expect(logo.getAttribute('alt')).toMatch(/Felipe Ángeles/i);
    });

    test('la pantalla de apertura explica qué hacer sin tecnicismos', () => {
        const doc = montarPortal();
        const gate = doc.getElementById('gate');
        expect(gate).not.toBeNull();
        // El botón de reintentar es el mismo que engancha el script.
        expect(gate.querySelector('#btn-load')).not.toBeNull();
        expect(portalHtml).toMatch(/escaneó?|escanear el QR|código QR/i);
    });

    test('los botones de guardar quedan dentro del formulario', () => {
        const doc = montarPortal();
        const form = doc.getElementById('onboarding-form');
        expect(form.querySelector('.actionbar')).not.toBeNull();
        expect(form.querySelector('#btn-save-all').getAttribute('type')).toBe('submit');
        expect(form.querySelector('#btn-save-draft')).not.toBeNull();
    });
});

describe('el alta de colaborador', () => {
    /** Solo el modal, recortado por sus marcadores. */
    function montarAlta() {
        const desde = app.indexOf('<div class="modal fade" id="colabNuevoModal"');
        const hasta = app.indexOf('<!-- /colabNuevoModal -->');
        document.body.innerHTML = app.slice(desde, hasta);
        return document;
    }

    test('lleva el logo del AIFA en su encabezado', () => {
        const doc = montarAlta();
        const logo = doc.querySelector('#colabNuevoModal .modal-header .modal-aifa-mark img');
        expect(logo).not.toBeNull();
        expect(logo.getAttribute('src')).toBe('images/aifa-logo.png');
    });

    test('cada pestaña conserva su nombre exacto', () => {
        // colabSeccionDeTab usa este texto para decir dónde falta capturar algo.
        const doc = montarAlta();
        const nombres = [...doc.querySelectorAll('#colabNuevoTabs .nav-link')]
            .map(b => b.textContent.trim());
        expect(nombres).toEqual(['Generales', 'Clasificación', 'Organización', 'Documentos', 'Emergencias']);
    });

    test('cada pestaña presenta sus campos en una hoja', () => {
        const doc = montarAlta();
        for (const pane of ['cnuevo-gen', 'cnuevo-clas', 'cnuevo-org', 'cnuevo-docs', 'cnuevo-emerg']) {
            expect(doc.querySelector('#' + pane + ' > .cn-sheet > .row')).not.toBeNull();
        }
    });
});
