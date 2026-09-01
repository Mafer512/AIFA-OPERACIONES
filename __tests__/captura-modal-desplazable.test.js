/**
 * @jest-environment jsdom
 *
 * El formulario de captura de Datos —el que usan Impactos de fauna, Fauna
 * rescatada, Atenciones médicas, Frecuencias…— se abría centrado y sin cuerpo
 * desplazable. Con dieciocho campos, como el de fauna, el diálogo crece más que
 * la pantalla y al ir centrado se sale por arriba y por abajo a partes iguales:
 * lo que queda sobre el borde superior no hay forma de alcanzarlo. Se bajaba a
 * capturar y ya no se podía volver a los primeros campos.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const adminUi = fs.readFileSync(path.join(raiz, 'js/admin-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8');

/** El HTML del modal tal como lo arma initModal(). */
function marcado() {
    const i = adminUi.indexOf('<div id="admin-modal"');
    const j = adminUi.indexOf('`;', i);
    return adminUi.slice(i, j);
}

describe('el formulario de captura de Datos', () => {
    beforeEach(() => { document.body.innerHTML = marcado(); });

    test('el cuerpo se desplaza: se puede volver a los primeros campos', () => {
        const dialogo = document.querySelector('#admin-modal .modal-dialog');
        expect(dialogo.className).toContain('modal-dialog-scrollable');
        // Centrado sigue estando; es la combinación de los dos lo que hace falta.
        expect(dialogo.className).toContain('modal-dialog-centered');
    });

    test('el encabezado y los botones quedan a la vista mientras se captura', () => {
        // Con el cuerpo desplazable, header y footer son hermanos del body y no
        // se van con el desplazamiento.
        const contenido = document.querySelector('#admin-modal .modal-content');
        const hijos = [...contenido.children].map(el => el.className.split(' ')[0]);
        expect(hijos).toEqual(['modal-header', 'modal-body', 'modal-footer']);
        expect(document.getElementById('admin-save-btn')).not.toBeNull();
    });

    test('los campos van sobre una hoja, no sueltos en el fondo', () => {
        const hoja = document.querySelector('#admin-modal .admin-form-sheet > #admin-form');
        expect(hoja).not.toBeNull();
        // El formulario conserva su rejilla de dos columnas.
        expect(hoja.className).toContain('row');
    });

    test('la hoja y los campos tienen su estilo definido', () => {
        expect(css).toContain('.admin-form-sheet {');
        expect(css).toMatch(/#admin-modal \.form-control:focus,[\s\S]*?border-color: #1565c0;/);
        expect(css).toContain('#admin-modal textarea.form-control { min-height: 84px; }');
    });
});
