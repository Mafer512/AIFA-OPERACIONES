/**
 * @jest-environment jsdom
 *
 * Una fila no puede quedarse sin guardar en silencio.
 *
 * El autoguardado tiene varios puntos donde ABANDONA una fila y no dice nada:
 * la fila ya no está en el DOM, se apagó el modo captura, cambió el permiso, la
 * fila se descartó. Cada guarda es razonable por separado; el problema es que
 * juntas permiten que una captura desaparezca sin error, sin quedar en la cola
 * de pendientes y sin nada que revisar después. Eso es lo que se veía como
 * "capturé 16 filas y sólo se guardaron 8".
 *
 * La bitácora no cambia el comportamiento: deja constancia del abandono con el
 * vuelo y el motivo, avisa en pantalla cuando había algo que perder, y se
 * consulta con conciBitacora().
 */

const fs = require('fs');
const path = require('path');

const source = fs
    .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
    .replace(/\r\n/g, '\n');

function extraer(nombre) {
    const marca = `function ${nombre}(`;
    let inicio = source.indexOf(marca);
    if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
    if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
    return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

function cargar(avisos) {
    return new Function('document', 'window', 'console', 'showNotification', `
    ${source.match(/const _CONCI_BITACORA_MAX = \d+;/)[0]}
    const _conciBitacora = [];
    let _conciAvisoOmitidaAt = 0;
    function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
    function _conciNormalizedColumnName(c) { return String(c || '').toLowerCase(); }
    function _conciVueloDeFilaElemento(tr) {
        const td = tr.querySelector('td[data-col="# DE VUELO"]');
        return td ? String(td.dataset.raw || '') : '';
    }
    ${extraer('_conciCeldasPendientesDeFila')}
    ${extraer('_conciAnotar')}
    return { _conciAnotar, bitacora: () => _conciBitacora };
  `)(document, window, console, (msg, tipo) => avisos.push({ msg, tipo }));
}

function fila({ vuelo = 'AM 593', sucias = {} } = {}) {
    document.body.innerHTML = `<table><tbody><tr data-row-id="7">
        <td data-col="# DE VUELO" data-raw="${vuelo}">${vuelo}</td>
        ${Object.entries(sucias).map(([col, val]) =>
            `<td data-col="${col}" data-dirty="1" data-raw="${val}">${val}</td>`).join('')}
    </tr></tbody></table>`;
    return document.querySelector('tr');
}

let avisos;
beforeEach(() => {
    avisos = [];
    document.body.innerHTML = '';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { console.warn.mockRestore(); });

describe('qué se anota', () => {
    test('un abandono con captura encima queda registrado, con vuelo y motivo', () => {
        const api = cargar(avisos);
        api._conciAnotar(fila({ sucias: { 'TOTAL PAX': '150' } }), 'omitida', 'el modo captura estaba apagado');

        const [reg] = api.bitacora();
        expect(reg.evento).toBe('omitida');
        expect(reg.vuelo).toBe('AM 593');
        expect(reg.detalle).toBe('el modo captura estaba apagado');
        expect(reg.celdas).toBe('TOTAL PAX');
        expect(reg.fila).toBe('7');
    });

    test('un abandono sin nada capturado no ensucia la bitácora', () => {
        // Salir de una fila intacta es lo normal, no una incidencia.
        const api = cargar(avisos);
        api._conciAnotar(fila(), 'omitida', 'la fila ya no estaba en la tabla');
        expect(api.bitacora()).toHaveLength(0);
        expect(avisos).toHaveLength(0);
    });

    test('un error de escritura se anota aunque las celdas ya estén confirmadas', () => {
        const api = cargar(avisos);
        api._conciAnotar(fila(), 'error', 'timeout');
        expect(api.bitacora()).toHaveLength(1);
        expect(api.bitacora()[0].evento).toBe('error');
    });
});

describe('cuándo se avisa en pantalla', () => {
    test('avisa en el momento, no horas después', () => {
        const api = cargar(avisos);
        api._conciAnotar(fila({ sucias: { KGS: '500' } }), 'omitida', 'sin permiso de captura');
        expect(avisos).toHaveLength(1);
        expect(avisos[0].tipo).toBe('error');
        expect(avisos[0].msg).toContain('AM 593');
        expect(avisos[0].msg).toContain('sin permiso de captura');
        expect(avisos[0].msg).toContain('conciBitacora()');
    });

    test('varias filas seguidas no disparan un aviso por cada una', () => {
        // Suelen ser la misma causa; un aviso por fila se vuelve ruido que se
        // aprende a ignorar, y entonces deja de servir.
        const api = cargar(avisos);
        for (let i = 0; i < 5; i++) {
            api._conciAnotar(fila({ sucias: { KGS: String(i) } }), 'omitida', 'el modo captura estaba apagado');
        }
        expect(api.bitacora()).toHaveLength(5);
        expect(avisos).toHaveLength(1);
    });

    test('un error de escritura no dispara el aviso: ése ya se reporta aparte', () => {
        const api = cargar(avisos);
        api._conciAnotar(fila({ sucias: { KGS: '1' } }), 'error', 'timeout');
        expect(avisos).toHaveLength(0);
    });
});

describe('las guardas del autoguardado dejan constancia', () => {
    const bloque = source.slice(
        source.indexOf('async function _conciAutoSaveRow(tr, options = {})'),
        source.indexOf('async function _conciAutoSaveRow(tr, options = {})') + 900
    );

    test.each([
        ['la fila ya no estaba en la tabla', 'isConnected'],
        ['el modo captura estaba apagado', '_conciEditMode'],
        ['sin permiso de captura', '_conciCanCurrentUserEdit'],
        ['la fila se descartó', 'conciDescartada'],
    ])('%s', (motivo, guarda) => {
        expect(bloque).toContain(guarda);
        expect(bloque).toContain(motivo);
    });

    test('la bitácora se puede consultar desde la consola', () => {
        expect(source).toContain('window.conciBitacora = function ()');
    });
});
