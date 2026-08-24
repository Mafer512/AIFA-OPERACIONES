/**
 * @jest-environment jsdom
 *
 * Refrescar la página no puede costar lo capturado.
 *
 * Lo que reportaron: "sí guarda si te esperas unos minutos, pero la gente
 * refresca y se pierde". Las dos mitades del problema:
 *
 *   1. Al cerrar o refrescar, lo pendiente sólo dejaba una NOTA en la cola de
 *      rescate. El dato no llegaba a la tabla real, así que al recargar la fila
 *      salía sin lo capturado — y refrescar es justo lo primero que hace
 *      alguien cuando duda de si guardó.
 *
 *   2. El reintento crecía hasta DOS MINUTOS. Si los primeros intentos fallaban
 *      —una fila a medio identificar, por ejemplo—, el guardado bueno se
 *      quedaba esperando ese temporizador.
 *
 * Ahora la fila que ya tiene id se escribe DE VERDAD con `keepalive`, que
 * sobrevive a que la página muera y no exige buena conexión; la cola queda como
 * respaldo para lo que no se puede escribir así (una fila nueva no tiene id
 * contra el que hacer PATCH). Y el tope del reintento bajó a 10 s.
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

function cargar(peticiones, colaDisponible = true) {
    return new Function('document', 'window', 'fetch', `
    let _conciTokenSesion = 'token-de-sesion';
    let _conciLiveClientId = 'pestana-1';
    let _conciColaDisponible = ${colaDisponible};
    const _CONCI_TABLA_PENDIENTES = 'conciliacion_capturas_pendientes';
    ${source.match(/const _CONCI_TABLA_MANIFIESTOS = .+;/)[0]}
    function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
    function _conciPrepareValueForDatabase(col, v) { return v; }
    function _conciCurrentUserDisplayName() { return 'Ana'; }
    function _conciDeviceId() { return 'equipo-1'; }
    function _conciFechaUnicaDelFiltro() { return '2026-08-24'; }
    function _conciVueloDeFila() { return 'VB 1000'; }
    ${extraer('_conciCeldasPendientesDeFila')}
    ${extraer('_conciEscribirFilaAlCerrar')}
    ${extraer('_conciEnviarPendientesAlCerrar')}
    return { _conciEnviarPendientesAlCerrar, _conciEscribirFilaAlCerrar };
  `)(document, window, fetch);
}

/** Una fila con celdas marcadas como pendientes (data-dirty). */
function pintar(filas) {
    document.body.innerHTML = `<table id="table-conci-manifiestos"><tbody>${filas.map(f => {
        const attrs = f.id ? `data-row-id="${f.id}"` : 'data-conci-new="1"';
        const celdas = Object.entries(f.celdas).map(([col, val]) =>
            `<td data-col="${col}" data-dirty="1" data-raw="${val}">${val}</td>`).join('');
        const limpias = Object.entries(f.limpias || {}).map(([col, val]) =>
            `<td data-col="${col}" data-raw="${val}">${val}</td>`).join('');
        return `<tr ${attrs}>${celdas}${limpias}</tr>`;
    }).join('')}</tbody></table>`;
}

let peticiones;

beforeEach(() => {
    peticiones = [];
    global.fetch = jest.fn((url, opciones) => {
        peticiones.push({ url: String(url), ...opciones });
        return Promise.resolve({ ok: true });
    });
    window.SUPABASE_URL = 'https://proyecto.supabase.co';
    window.SUPABASE_ANON_KEY = 'anon-key';
    document.body.innerHTML = '';
});

const patches = () => peticiones.filter(p => p.method === 'PATCH');
const colas = () => peticiones.filter(p => String(p.url).includes('capturas_pendientes'));

describe('al refrescar, lo capturado se escribe en la tabla real', () => {
    test('la fila con id se guarda de verdad, con sólo las celdas tocadas', () => {
        pintar([{ id: '42', celdas: { 'TOTAL PAX': '150' }, limpias: { KGS: '900' } }]);
        cargar(peticiones)._conciEnviarPendientesAlCerrar();

        expect(patches()).toHaveLength(1);
        const req = patches()[0];
        expect(req.url).toContain('/rest/v1/Conciliaci');
        expect(req.url).toContain('id=eq.42');
        expect(req.keepalive).toBe(true);
        // Sólo viaja lo que se tocó: KGS no estaba sucia y no se reescribe.
        expect(JSON.parse(req.body)).toEqual({ 'TOTAL PAX': '150' });
        expect(req.headers.Authorization).toBe('Bearer token-de-sesion');
    });

    test('una celda vaciada a propósito se guarda como null, no se omite', () => {
        pintar([{ id: '42', celdas: { OBSERVACIONES: '' } }]);
        cargar(peticiones)._conciEnviarPendientesAlCerrar();
        expect(JSON.parse(patches()[0].body)).toEqual({ OBSERVACIONES: null });
    });

    test('varias filas se escriben cada una por su lado', () => {
        pintar([
            { id: '1', celdas: { 'TOTAL PAX': '10' } },
            { id: '2', celdas: { 'TOTAL PAX': '20' } },
        ]);
        cargar(peticiones)._conciEnviarPendientesAlCerrar();
        expect(patches()).toHaveLength(2);
        expect(patches().map(p => JSON.parse(p.body)['TOTAL PAX'])).toEqual(['10', '20']);
    });

    test('una fila sin nada pendiente no manda nada', () => {
        pintar([{ id: '42', celdas: {}, limpias: { KGS: '900' } }]);
        cargar(peticiones)._conciEnviarPendientesAlCerrar();
        expect(patches()).toHaveLength(0);
    });

    test('la fila nueva no se puede escribir todavía, pero sí queda en la cola', () => {
        // Sin id no hay contra qué hacer PATCH: para eso sigue estando la cola.
        pintar([{ celdas: { 'TOTAL PAX': '77' } }]);
        cargar(peticiones)._conciEnviarPendientesAlCerrar();
        expect(patches()).toHaveLength(0);
        expect(colas()).toHaveLength(1);
        expect(JSON.parse(colas()[0].body)[0].valor).toBe('77');
    });

    test('sin cola de rescate disponible, la escritura real se intenta igual', () => {
        // Son mecanismos independientes: que falte la tabla de rescate no puede
        // impedir que el dato llegue a su sitio.
        pintar([{ id: '42', celdas: { 'TOTAL PAX': '150' } }]);
        cargar(peticiones, false)._conciEnviarPendientesAlCerrar();
        expect(patches()).toHaveLength(1);
        expect(colas()).toHaveLength(0);
    });
});

describe('el reintento no se estira a minutos', () => {
    test('el tope bajó de dos minutos a diez segundos', () => {
        expect(source).toMatch(/_CONCI_REINTENTO_MAX_MS\s*=\s*10000;/);
        expect(source).not.toMatch(/_CONCI_REINTENTO_MAX_MS\s*=\s*120000;/);
    });

    test('teclear otra vez estrena la espera en vez de arrastrar el castigo', () => {
        const fn = extraer('_conciQueueAutoSave');
        expect(fn).toContain('_conciReiniciarEsperaReintento()');
    });
});
