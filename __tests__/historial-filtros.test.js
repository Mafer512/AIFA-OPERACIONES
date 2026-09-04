/**
 * @jest-environment jsdom
 *
 * El Historial de Cambios era una lista de cien renglones sin manera de
 * preguntarle nada: quién tocó esto, qué se borró ayer, qué pasó en Fauna. Y un
 * alta con diecisiete campos se comía la pantalla entera.
 *
 * Aquí se comprueba la barra de filtros y que las listas largas se plieguen.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8');

function trozo(texto, desde, hasta) {
    const i = texto.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = texto.indexOf(hasta, i + desde.length);
    return texto.slice(i, j);
}

describe('la barra de filtros del historial', () => {
    beforeEach(() => {
        // Hasta el contador, que es el último elemento de la barra.
        document.body.innerHTML =
            trozo(app, '<div class="hist-toolbar" id="hist-toolbar">', '<span class="hist-conteo"')
            + '<span class="hist-conteo" id="hist-conteo"></span></div>';
    });

    test('deja preguntar por texto, acción, módulo y usuario', () => {
        for (const id of ['hist-buscar', 'hist-accion', 'hist-entidad', 'hist-usuario', 'hist-limite', 'hist-limpiar']) {
            expect(document.getElementById(id)).not.toBeNull();
        }
    });

    test('las acciones se agrupan en altas, ediciones y bajas', () => {
        const valores = [...document.querySelectorAll('#hist-accion option')].map(o => o.value);
        expect(valores).toEqual(['', 'alta', 'edicion', 'baja']);
    });

    test('se puede pedir más historia de la que cabe en cien renglones', () => {
        const valores = [...document.querySelectorAll('#hist-limite option')].map(o => o.value);
        expect(valores).toEqual(['100', '300', '1000']);
    });
});

describe('el pintado del historial', () => {
    const cuerpo = trozo(script, 'async function loadHistory()', '\n}\n');

    test('trae tantos movimientos como pida el selector', () => {
        expect(cuerpo).toContain("const limite = Number(document.getElementById('hist-limite')?.value) || 100;");
        expect(cuerpo).toContain('.limit(limite)');
    });

    test('filtra sobre lo ya traído, sin volver a la base en cada tecla', () => {
        expect(cuerpo).toContain('window._histPintar = function ()');
        expect(cuerpo).toMatch(/const visibles = data\.filter\(log => \{/);
        // La búsqueda mira también el detalle guardado, no solo el encabezado.
        expect(cuerpo).toContain("JSON.stringify(log.details || '')");
    });

    test('dice cuántos movimientos se están viendo y cuántos son de hoy', () => {
        expect(cuerpo).toContain("const conteo = document.getElementById('hist-conteo');");
        expect(cuerpo).toMatch(/movimientos · \$\{deHoy\} hoy/);
    });

    test('cada renglón se colorea según lo que pasó', () => {
        expect(cuerpo).toContain('<tr class="hist-${claseFila}"');
        expect(cuerpo).toMatch(/const clasifica = \(accion\) => \{/);
        expect(app).toContain('#history-table > tbody > tr.hist-baja    { border-left-color: #dc2626; }');
    });

    test('una lista larga se pliega en vez de comerse la pantalla', () => {
        expect(cuerpo).toContain('const CAMPOS_A_LA_VISTA = 6;');
        expect(cuerpo).toContain('function plegarLista(filas)');
        expect(cuerpo).toMatch(/Ver \$\{faltan\} campo\(s\) más/);
        // Y el botón se despliega solo, sin recargar nada.
        expect(cuerpo).toContain("const boton = ev.target.closest('[data-hist-mas]');");
    });

    test('lo anotado por el rastro automático se distingue a simple vista', () => {
        expect(cuerpo).toContain("details.origen === 'automatico'");
        expect(app).toContain('.hist-auto {');
    });
});

describe('el rastro automático queda enganchado en la aplicación', () => {
    test('se carga junto al cliente de Supabase', () => {
        expect(app).toMatch(/<script src="js\/supabase-client\.js"><\/script>[\s\S]{0,220}js\/audit-supabase\.js/);
    });
});
