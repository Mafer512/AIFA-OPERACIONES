/**
 * @jest-environment jsdom
 *
 * El guardado masivo no puede dejar filas fuera y luego borrarlas.
 *
 * Caso real: se capturaron 16 filas de una aerolínea y sólo se guardaron 8.
 *
 * La captura ensucia CELDAS —cada td capturado lleva data-dirty="1"—, pero el
 * guardado masivo recogía las filas a guardar mirando sólo la marca de FILA
 * (tr[data-dirty]) y las filas nuevas. Una fila cuyas celdas seguían pendientes
 * pero que había perdido su marca de fila no entraba en el guardado.
 *
 * Y lo que lo volvía pérdida de datos en vez de una molestia: justo después se
 * recargaba la tabla con allowLocalEditsReplace, que reemplaza el tbody
 * saltándose la protección de capturas pendientes. Lo que no entró al guardado
 * se borraba de la pantalla sin avisar.
 */

const fs = require('fs');
const path = require('path');

const source = fs
    .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
    .replace(/\r\n/g, '\n');

/** El bloque que decide qué filas se guardan. */
const bloqueDirtyRows = (() => {
    const desde = source.indexOf('const dirtyRows = Array.from(new Set([');
    if (desde === -1) throw new Error('No se encontró la recolección de filas a guardar');
    return source.slice(desde, source.indexOf(']));', desde) + 4);
})();

describe('qué filas entran al guardado masivo', () => {
    test('entra la fila que tiene celdas sucias, aunque la fila haya perdido su marca', () => {
        expect(bloqueDirtyRows).toContain("tbody.querySelectorAll('td[data-dirty=\"1\"]')");
        expect(bloqueDirtyRows).toContain(".map(td => td.closest('tr'))");
    });

    test('siguen entrando las que ya entraban', () => {
        expect(bloqueDirtyRows).toContain("tr[data-dirty=\"1\"]");
        expect(bloqueDirtyRows).toContain("tr[data-conci-new=\"1\"]");
    });

    test('la selección se comporta como se espera sobre una tabla real', () => {
        // Se reproduce la expresión tal cual está en el código, sobre una tabla
        // con los tres casos: marca de fila, fila nueva, y sólo celdas sucias.
        document.body.innerHTML = `<table><tbody>
            <tr id="a" data-dirty="1"><td data-col="X"></td></tr>
            <tr id="b" data-conci-new="1"><td data-col="X"></td></tr>
            <tr id="c"><td data-col="X" data-dirty="1">150</td></tr>
            <tr id="d"><td data-col="X">sin tocar</td></tr>
        </tbody></table>`;
        const tbody = document.querySelector('tbody');
        const dirtyRows = Array.from(new Set([
            ...tbody.querySelectorAll('tr[data-dirty="1"]'),
            ...tbody.querySelectorAll('tr[data-conci-new="1"]'),
            ...[...tbody.querySelectorAll('td[data-dirty="1"]')]
                .map(td => td.closest('tr'))
                .filter(Boolean),
        ]));
        // "c" es la que antes se quedaba fuera y luego se borraba.
        expect(dirtyRows.map(tr => tr.id).sort()).toEqual(['a', 'b', 'c']);
        // La fila intacta no se toca.
        expect(dirtyRows.map(tr => tr.id)).not.toContain('d');
    });
});

describe('recargar no puede llevarse una captura por delante', () => {
    test('tras guardar, el reemplazo del tbody se condiciona a que no quede nada pendiente', () => {
        const desde = source.indexOf('async function _conciSaveBulkEdits()');
        expect(desde).toBeGreaterThan(-1);
        const bloque = source.slice(desde, source.indexOf('\n}\n', desde));
        expect(bloque).toContain('allowLocalEditsReplace: !_conciHasUnsavedCaptures()');
        // Ya no se fuerza el reemplazo a ciegas al terminar de guardar.
        expect(bloque).not.toContain('forceRefresh: true, allowLocalEditsReplace: true');
    });

    test('cancelar avisa antes de descartar lo capturado', () => {
        const desde = source.indexOf('async function _conciCancelBulkEdits()');
        const bloque = source.slice(desde, source.indexOf('\n}\n', desde));
        expect(bloque).toContain('_conciHasUnsavedCaptures()');
        expect(bloque).toContain('confirm(');
        // Y si dicen que no, no se cancela nada.
        expect(bloque).toMatch(/\)\)\s*\{\s*\n\s*return;/);
    });
});
