/**
 * @jest-environment jsdom
 *
 * Las gráficas de Operaciones Totales (Comercial, General y Carga) esperan a
 * que su sección se vea para dibujarse. Mientras está cerrada, cada recarga
 * (la automática de cada 3 minutos, un cambio de meses…) dejaba OTRO reintento
 * cada 120 ms sin cancelar el anterior, y se iban acumulando. Ahora queda uno
 * solo por gráfica.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = leer('index.html');
const FIN = '</div><!-- /accordion -->';
const acordeon = html.slice(html.indexOf('<div class="accordion accordion-flush" id="yoy-accordion">'), html.indexOf(FIN) + FIN.length);

const filas = [];
[2025, 2026].forEach((year) => {
    for (let month = 1; month <= 12; month++) {
        filas.push({ year, month, comercial_ops: 9000, comercial_pax: 1e6, carga_ops: 600, carga_tons: 15000, general_ops: 300, general_pax: 900, is_official: true });
    }
});

const vaciar = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const avisarPestana = (destino) => document.querySelector(`button[data-bs-target="${destino}"]`)
    .dispatchEvent(new Event('shown.bs.tab'));

beforeAll(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
        <button data-bs-target="#analisis-yoy-pane"></button>
        <button data-bs-target="#yoy-sub-general"></button>
        <button data-bs-target="#yoy-sub-carga"></button>
        ${acordeon}`;
    // jsdom no dibuja ni mide: offsetWidth es 0, como una sección cerrada.
    HTMLCanvasElement.prototype.getContext = () => ({ createLinearGradient: () => ({ addColorStop() {} }) });
    window.Chart = jest.fn();
    window.supabaseClient = {};
    window.TotalesService = { filasMensuales: () => Promise.resolve(filas) };
    ['comparativa-historica.js', 'yoy-general.js', 'yoy-cargo.js'].forEach((f) => window.eval(leer('js', f)));
    document.dispatchEvent(new Event('DOMContentLoaded'));
});

afterEach(() => jest.clearAllTimers());
afterAll(() => jest.useRealTimers());

test.each([
    ['Comercial', '#analisis-yoy-pane', () => window._comYoyRender()],
    ['General', '#yoy-sub-general', () => window.genYoyMonthPreset('all')],
    ['Carga', '#yoy-sub-carga', () => window.cargoYoyMonthPreset('all')],
])('%s: con la sección cerrada queda un solo reintento pendiente', async (_nombre, destino, redibujar) => {
    avisarPestana(destino);
    await vaciar();
    expect(jest.getTimerCount()).toBe(1);

    for (let i = 0; i < 5; i++) redibujar();
    jest.advanceTimersByTime(600);
    expect(jest.getTimerCount()).toBe(1);
    expect(window.Chart).not.toHaveBeenCalled();
});
