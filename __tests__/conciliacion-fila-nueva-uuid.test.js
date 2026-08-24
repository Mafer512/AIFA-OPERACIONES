/**
 * @jest-environment jsdom
 *
 * La fila la nombra quien la crea, no la base.
 *
 * Una fila recién agregada no existía en la base hasta que su INSERT terminaba,
 * así que hasta ese momento no tenía id — y sin id no había contra qué escribir.
 * Si la persona refrescaba antes (que es justo lo que hace cuando duda de si
 * guardó), lo capturado sólo alcanzaba a dejar una nota en la cola de rescate y
 * había que aplicarlo a mano.
 *
 * Ahora, igual que en una hoja de cálculo colaborativa, el navegador le pone un
 * uuid a la fila en el instante de crearla. Ese nombre viaja en cada escritura,
 * así que:
 *
 *   · se puede guardar de verdad desde el primer momento, sin esperar id;
 *   · reintentar no duplica la fila — el segundo intento cae sobre el mismo
 *     nombre en vez de crear una gemela.
 *
 * Requiere supabase/migrations/029_conciliacion_cliente_uuid.sql.
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

function cargar() {
    return new Function('document', 'window', 'fetch', `
    let _conciTokenSesion = 'token';
    const ${source.match(/const _CONCI_TABLA_MANIFIESTOS = .+;/)[0].replace('const ', '')}
    function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
    function _conciPrepareValueForDatabase(col, v) { return v; }
    ${extraer('_conciNuevoUuid')}
    ${extraer('_conciCeldasPendientesDeFila')}
    ${extraer('_conciEscribirFilaAlCerrar')}
    return { _conciNuevoUuid, _conciEscribirFilaAlCerrar };
  `)(document, window, fetch);
}

let peticiones;
beforeEach(() => {
    peticiones = [];
    global.fetch = jest.fn((url, opciones) => {
        peticiones.push({ url: String(url), ...opciones });
        return Promise.resolve({ ok: true });
    });
    document.body.innerHTML = '';
});

function fila({ id = '', uuid = '', celdas = {} }) {
    const attrs = [id ? `data-row-id="${id}"` : '', uuid ? `data-cliente-uuid="${uuid}"` : ''].join(' ');
    document.body.innerHTML = `<table><tbody><tr ${attrs}>${
        Object.entries(celdas).map(([col, val]) =>
            `<td data-col="${col}" data-dirty="1" data-raw="${val}">${val}</td>`).join('')
    }</tr></tbody></table>`;
    return document.querySelector('tr');
}

describe('el uuid de la fila', () => {
    test('tiene forma de uuid v4', () => {
        const uuid = cargar()._conciNuevoUuid();
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('no se repite', () => {
        const api = cargar();
        const vistos = new Set();
        for (let i = 0; i < 500; i++) vistos.add(api._conciNuevoUuid());
        expect(vistos.size).toBe(500);
    });

    test('hay respaldo donde crypto.randomUUID no existe', () => {
        const real = window.crypto;
        // Navegador viejo o fuera de contexto seguro: la fila no puede quedarse
        // sin nombre justo donde más falta hace.
        Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
        try {
            expect(cargar()._conciNuevoUuid()).toMatch(/^[0-9a-f-]{36}$/i);
        } finally {
            Object.defineProperty(window, 'crypto', { value: real, configurable: true });
        }
    });

    test('la fila nueva nace con su uuid puesto', () => {
        // Se lee del código: crear la fila real arrastraría media aplicación.
        const desde = source.indexOf("tr.dataset.conciNew = '1';");
        const bloque = source.slice(desde, desde + 1200);
        expect(bloque).toContain('tr.dataset.clienteUuid = _conciNuevoUuid()');
    });
});

describe('al refrescar, la fila nueva ya se puede escribir', () => {
    test('sin id, se crea por su nombre con upsert', () => {
        const tr = fila({ uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', celdas: { 'TOTAL PAX': '99' } });
        cargar()._conciEscribirFilaAlCerrar(tr, 'https://x.supabase.co', 'anon');

        expect(peticiones).toHaveLength(1);
        const req = peticiones[0];
        expect(req.method).toBe('POST');
        expect(req.url).toContain('on_conflict=cliente_uuid');
        expect(req.keepalive).toBe(true);
        // El nombre viaja con el dato: es lo que hace idempotente el reintento.
        expect(JSON.parse(req.body)).toEqual({
            'TOTAL PAX': '99',
            cliente_uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        });
        expect(req.headers.Prefer).toContain('resolution=merge-duplicates');
    });

    test('con id, sigue siendo una corrección de esa fila', () => {
        const tr = fila({ id: '42', uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', celdas: { KGS: '500' } });
        cargar()._conciEscribirFilaAlCerrar(tr, 'https://x.supabase.co', 'anon');

        const req = peticiones[0];
        expect(req.method).toBe('PATCH');
        expect(req.url).toContain('id=eq.42');
        // Ya existe: no hace falta volver a mandar su nombre.
        expect(JSON.parse(req.body)).toEqual({ KGS: '500' });
    });

    test('una fila de antes del mecanismo (sin id y sin uuid) no se inventa nada', () => {
        const tr = fila({ celdas: { KGS: '500' } });
        expect(cargar()._conciEscribirFilaAlCerrar(tr, 'https://x.supabase.co', 'anon')).toBe(false);
        expect(peticiones).toHaveLength(0);
    });
});

describe('crear la fila es idempotente', () => {
    test('el alta con nombre propio va por upsert, no por insert a ciegas', () => {
        const bloque = source.slice(
            source.indexOf('await req.update(currentPayload)'),
            source.indexOf('await req.update(currentPayload)') + 900
        );
        expect(bloque).toContain("upsert(currentPayload, { onConflict: 'cliente_uuid' })");
        // Sin uuid se comporta como siempre: filas viejas y migración sin aplicar.
        expect(bloque).toContain('insert(currentPayload)');
    });

    test('el uuid viaja en el alta de la fila', () => {
        const bloque = source.slice(
            source.indexOf('const writePayload = rowId ? {} : { ...payload };'),
            source.indexOf('const writePayload = rowId ? {} : { ...payload };') + 500
        );
        expect(bloque).toContain('writePayload.cliente_uuid = tr.dataset.clienteUuid');
    });
});
