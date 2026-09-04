/**
 * @jest-environment jsdom
 *
 * El editor de la ficha se quedó atrás del alta: sin logo, con trece pestañas
 * repartidas en dos renglones desiguales y los campos sueltos sobre el fondo.
 * Aquí se fija el mismo lenguaje visual que el alta, y sobre todo que las
 * pestañas se deslicen en una sola línea en vez de quebrarse.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    if (j < 0) throw new Error('Sin cierre: ' + desde);
    return app.slice(i, j);
}

const MODAL = trozo('<div class="modal fade" id="colabEditModal"', '<!-- /colabEditModal -->');
const ESTILOS = trozo('#colabEditModal .modal-content', '/* --- MODAL NUEVO COLABORADOR --- */');

describe('el editor de colaborador', () => {
    beforeEach(() => { document.body.innerHTML = MODAL; });

    test('lleva el logo del AIFA en su encabezado', () => {
        const logo = document.querySelector('#colabEditModal .modal-header .modal-aifa-mark img');
        expect(logo).not.toBeNull();
        expect(logo.getAttribute('src')).toBe('images/aifa-logo.png');
        // Y sigue diciendo de quién es la ficha.
        expect(document.getElementById('colab-edit-num-label')).not.toBeNull();
    });

    test('las trece pestañas se deslizan en una sola línea', () => {
        const tabs = [...document.querySelectorAll('#colabEditTabs .nav-link')];
        expect(tabs.length).toBeGreaterThanOrEqual(13);
        // nav-fill repartía el ancho y las quebraba en dos renglones.
        expect(document.getElementById('colabEditTabs').className).not.toContain('nav-fill');
        expect(ESTILOS).toMatch(/#colabEditModal \.nav-tabs \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;/);
        expect(ESTILOS).toMatch(/#colabEditModal \.nav-tabs \.nav-link \{[\s\S]*?white-space: nowrap;/);
    });

    test('todas las pestañas tienen icono', () => {
        const tabs = [...document.querySelectorAll('#colabEditTabs .nav-link')];
        tabs.forEach(tab => expect(tab.querySelector('i.fas')).not.toBeNull());
    });

    test('los formularios van sobre una hoja, como en el alta', () => {
        for (const pane of ['cedit-gen', 'cedit-clas', 'cedit-org', 'cedit-emerg']) {
            expect(document.querySelector('#' + pane + ' > .ce-sheet > .row')).not.toBeNull();
        }
    });

    test('el estatus se ve del color de lo que dice', () => {
        const sel = document.getElementById('ce-estatus');
        expect(sel.className).toContain('ce-estatus');
        expect([...sel.options].map(o => o.value)).toEqual(['Activo', 'Baja']);
        // Verde para activo y rojo para baja, en el desplegable y en el campo.
        expect(app).toContain('.ce-estatus option[value="Activo"] { color: #15803d;');
        expect(app).toContain('.ce-estatus option[value="Baja"]   { color: #b91c1c;');
        expect(app).toContain('#colabEditModal .ce-estatus.es-activo {');
        expect(app).toContain('#colabEditModal .ce-estatus.es-baja {');
        // Y se repinta al elegir otra opción, no solo al abrir.
        expect(app).toContain("selEstatus.addEventListener('change', colabPintarEstatus);");
    });

    test('el semáforo queda al final, después de Vacaciones', () => {
        const ids = [...document.querySelectorAll('#colabEditTabs .nav-link')].map(b => b.id);
        expect(ids[ids.length - 1]).toBe('cedit-tab-semaforo');
        expect(ids[ids.length - 2]).toBe('cedit-tab-vac');
    });

    test('el pie no pone a competir borrar con guardar', () => {
        const borrar = document.getElementById('btn-colab-delete-from-modal');
        const guardar = document.getElementById('btn-colab-save');
        expect(borrar.className).toContain('btn-outline-danger');
        expect(borrar.className).not.toContain('btn-danger ');
        expect(guardar.className).toContain('btn-primary');
    });

    test('el aviso de dónde se editan amonestaciones y comentarios se lee como leyenda', () => {
        const leyenda = document.querySelector('#cedit-gen .ce-legend');
        expect(leyenda).not.toBeNull();
        expect(leyenda.textContent).toContain('Amonest.');
        expect(leyenda.textContent).toContain('Coment.');
    });
});
