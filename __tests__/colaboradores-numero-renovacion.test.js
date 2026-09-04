/**
 * @jest-environment jsdom
 *
 * Control de contratos le agrega un sufijo al número de empleado cuando alguien
 * renueva: el 1551-2 es el MISMO 1551, y el 1348-3 su tercera renovación. El
 * alta comparaba los números tal cual se escriben, así que esa segunda alta
 * pasaba limpia y la persona quedaba dos veces en el directorio.
 *
 * En los 458 registros de agenda_2026 no hay una sola base repetida: la
 * renovación cambia el número del expediente, no crea otro.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function codigo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    if (j < 0) throw new Error('Sin cierre: ' + desde);
    return app.slice(i, j);
}

const BLOQUE = codigo('function colabNumBase(num)', '/** Abrir modal de nuevo colaborador */');

/** Las funciones reales del alta, con un directorio de mentiras detrás. */
function montar(registros) {
    document.body.innerHTML = `
        <input id="cn-num" class="form-control">
        <div class="cn-num-aviso d-none" id="cn-num-aviso"></div>
        <div class="cn-dup-alert d-none" id="cn-dup-alert"></div>`;

    const ctx = {
        document,
        colabCache: registros,
        gc: (registro, clave) => registro[clave],
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(BLOQUE, ctx);
    return ctx;
}

const DIRECTORIO = [
    { num: '1551', nombre: 'Pérez López Juan' },
    { num: '1064-2', nombre: 'Ramírez Soto Ana' },
    { num: '320', nombre: 'Tovar Aguilar Ana Karen' },
];

describe('el número base de un colaborador', () => {
    const ctx = montar(DIRECTORIO);

    test.each([
        ['1551', '1551'],
        ['1551-2', '1551'],
        ['1348-3', '1348'],
        ['12-2', '12'],
        ['  1551 - 2 ', '1551'],
        ['1551/2', '1551'],
        ['', ''],
    ])('%s pertenece a la persona %s', (escrito, base) => {
        expect(ctx.colabNumBase(escrito)).toBe(base);
    });

    test('no se come dígitos de un número normal', () => {
        // 15512 es otra persona, no la renovación del 1551.
        expect(ctx.colabNumBase('15512')).toBe('15512');
    });
});

describe('al dar de alta a alguien que ya está', () => {
    test('reconoce la renovación de un número que ya existe', () => {
        const ctx = montar(DIRECTORIO);
        const previo = ctx.colabBuscarMismaPersona('1551-2');
        expect(previo).not.toBeNull();
        expect(previo.nombre).toBe('Pérez López Juan');
    });

    test('también al revés: el directorio ya trae el sufijo', () => {
        const ctx = montar(DIRECTORIO);
        expect(ctx.colabBuscarMismaPersona('1064').nombre).toBe('Ramírez Soto Ana');
        expect(ctx.colabBuscarMismaPersona('1064-3').nombre).toBe('Ramírez Soto Ana');
    });

    test('a quien de verdad es nuevo lo deja pasar', () => {
        const ctx = montar(DIRECTORIO);
        expect(ctx.colabBuscarMismaPersona('2050')).toBeNull();
        expect(ctx.colabBuscarMismaPersona('15512')).toBeNull();
    });

    test('avisa en cuanto se escribe el número, sin esperar a guardar', () => {
        const ctx = montar(DIRECTORIO);
        const input = document.getElementById('cn-num');
        const aviso = document.getElementById('cn-num-aviso');

        input.value = '1551-2';
        ctx.colabAvisarMismaPersona();
        expect(aviso.classList.contains('d-none')).toBe(false);
        expect(aviso.textContent).toContain('1551');
        expect(aviso.textContent).toContain('Pérez López Juan');
        expect(input.classList.contains('is-invalid')).toBe(true);

        input.value = '2050';
        ctx.colabAvisarMismaPersona();
        expect(aviso.classList.contains('d-none')).toBe(true);
        expect(input.classList.contains('is-invalid')).toBe(false);
    });

    test('la caja de confirmación dice de quién se trata y ofrece seguir', () => {
        const ctx = montar(DIRECTORIO);
        ctx.colabMostrarAvisoRenovacion(DIRECTORIO[0], '1551-2');

        const caja = document.getElementById('cn-dup-alert');
        expect(caja.classList.contains('d-none')).toBe(false);
        expect(caja.textContent).toContain('1551-2');
        expect(caja.textContent).toContain('Pérez López Juan');
        expect(caja.querySelector('#cn-dup-force')).not.toBeNull();
    });
});

describe('el guardado del alta', () => {
    const guardar = codigo('window.colabGuardarNuevo = async function()', 'Construir payload');

    test('consulta a la misma persona antes de insertar', () => {
        expect(guardar).toContain('colabBuscarMismaPersona(numVal)');
    });

    test('el número idéntico sigue siendo un no rotundo', () => {
        expect(guardar).toMatch(/if \(numPrevio === numVal\)[\s\S]*?throw new Error/);
    });

    test('la renovación se detiene hasta que alguien lo confirme', () => {
        expect(guardar).toMatch(/if \(!colabDupConfirmado\)[\s\S]*?colabMostrarAvisoRenovacion/);
    });
});
