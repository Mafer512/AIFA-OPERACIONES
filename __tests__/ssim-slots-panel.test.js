/**
 * @jest-environment jsdom
 */

/**
 * Cableado de la pantalla "Solicitud de Slots → SSIM".
 *
 * Las reglas de conversión las prueba ssim-slots-core.test.js. Aquí se cuida
 * lo que sólo falla con el DOM de verdad:
 *
 *   · que la sección se monte al entrar y no antes;
 *   · que pegar renglones de Excel sobre la tabla los agregue;
 *   · que el botón de descarga sólo se habilite cuando la revisión no tiene
 *     errores (un SSIM a medias cargado en un sistema es peor que ninguno);
 *   · que el tiempo de bloque capturado se recuerde para la siguiente solicitud.
 *
 * El contenedor se recorta de index.html: si alguien renombra el id allá, la
 * prueba falla en vez de pasar contra una copia.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const fuente = (archivo) => fs.readFileSync(path.join(raiz, 'js', 'ssim-slots', archivo), 'utf8');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const PEGADO = [
    'C\tVB\t\t9212\tA320\t\t0313\t\tOAX\t_\t_\t_\t_\t5\t_\t_\t16/10/26\t23/10/26\t\tJ\t\t',
    'R\tVB\t\t9212\tA320\t\t2257\t\tOAX\t_\t_\t_\t4\t_\t_\t_\t15/10/26\t22/10/26\t\tJ\t\t',
    'C\tVB\t9213\t\tA320\t0602\t\tOAX\t\t_\t_\t_\t_\t5\t_\t_\t16/10/26\t23/10/26\tJ\t\t\t',
    'R\tVB\t9213\t\tA320\t0157\t\tOAX\t\t_\t_\t_\t_\t5\t_\t_\t16/10/26\t23/10/26\tJ\t\t\t'
].join('\r\n');

function montarDocumento() {
    const m = /<div id="ssim-slots-section" class="content-section"><\/div>/.exec(indexSource);
    if (!m) throw new Error('index.html ya no tiene #ssim-slots-section');
    document.body.innerHTML = m[0];
    localStorage.clear();
    window.showNotification = jest.fn();
    window.fetch = jest.fn(() => Promise.reject(new Error('sin red en la prueba')));
    window.eval(fuente('core.js'));
    window.eval(fuente('panel.js'));
}

function pegarEnTabla(texto) {
    const celda = document.querySelector('#ss-tbody [data-campo="mov"]');
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: () => texto };
    celda.dispatchEvent(ev);
}

function capturarBloque(ruta, minutos) {
    const input = document.querySelector(`[data-bloque="${ruta}"]`);
    input.value = String(minutos);
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    montarDocumento();
});
afterEach(() => jest.restoreAllMocks());

test('la sección se arma la primera vez que se entra, no al cargar', async () => {
    const seccion = document.getElementById('ssim-slots-section');
    expect(seccion.innerHTML).toBe('');
    seccion.classList.add('active');
    await tick();
    expect(document.getElementById('ss-tabla')).not.toBeNull();
    expect(document.querySelectorAll('#ss-tbody tr')).toHaveLength(1);
});

test('pegar de Excel agrega los renglones y la descarga espera los tiempos de bloque', async () => {
    document.getElementById('ssim-slots-section').classList.add('active');
    await tick();

    pegarEnTabla(PEGADO);
    await tick(10);
    expect(document.querySelectorAll('#ss-tbody tr')).toHaveLength(4);
    expect(document.getElementById('ss-h-iata').value).toBe('VB');
    expect(document.getElementById('ss-btn-descargar').disabled).toBe(true);
    expect(document.getElementById('ss-hallazgos').textContent).toMatch(/Falta el tiempo de bloque de la ruta NLU-OAX/);

    capturarBloque('NLU-OAX', 70);
    await tick(10);
    capturarBloque('OAX-NLU', 70);
    await tick(10);

    expect(document.getElementById('ss-btn-descargar').disabled).toBe(false);
    expect(document.getElementById('ss-resumen-resultado').textContent).toMatch(/^VB_NLU_SOLICITUD_\d{8}\.ssim · 2 tramo\(s\)/);
    expect(document.getElementById('ss-badge-salen').textContent).toBe('2');
    expect(document.getElementById('ss-panel-archivo').textContent).toMatch(/3 VB 92120101J15OCT2622OCT26/);
});

test('el tiempo de bloque se recuerda para la siguiente solicitud', async () => {
    document.getElementById('ssim-slots-section').classList.add('active');
    await tick();
    pegarEnTabla(PEGADO);
    await tick(10);
    capturarBloque('NLU-OAX', 72);
    await tick(10);

    document.getElementById('ss-btn-nueva').click();
    await tick(10);
    pegarEnTabla(PEGADO);
    await tick(10);

    const recordado = document.querySelector('[data-bloque="NLU-OAX"]');
    expect(recordado.value).toBe('72');
    expect(recordado.closest('tr').textContent).toMatch(/recordado/);

    const guardado = JSON.parse(localStorage.getItem('aifa.ssimSlots.v1'));
    expect(Object.keys(guardado.solicitudes)).toHaveLength(2);
    expect(guardado.bloques['NLU-OAX']).toBe(72);
});

test('clic en los días cambia la frecuencia del renglón', async () => {
    document.getElementById('ssim-slots-section').classList.add('active');
    await tick();
    pegarEnTabla(PEGADO);
    await tick(10);
    const lunes = document.querySelector('#ss-tbody tr[data-fila="1"] .ss-dia[data-dia="1"]');
    lunes.click();
    await tick(10);
    expect(lunes.classList.contains('on')).toBe(true);
    expect(window.SsimSlots.estado.almacen.solicitudes[window.SsimSlots.estado.almacen.activa].filas[1].dias).toBe('14');
});
