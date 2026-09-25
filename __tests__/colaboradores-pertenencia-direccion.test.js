/**
 * @jest-environment jsdom
 *
 * La palomita de "pertenece a la Dirección de Operación".
 *
 * La columna Dirección dice dónde está adscrita la plaza, no quién integra el
 * área de verdad: había gente contada en el Resumen del Directorio que
 * orgánicamente no forma parte de la Dirección de Operación, y el total —y con
 * él todas las tarjetas— salía inflado. Ahora la pertenencia se marca a mano en
 * la Tabla Completa y es ese dato el que manda.
 *
 * Aquí se ejercitan las funciones reales de index.html: que la casilla se pinte
 * como está guardada, que despalomear se guarde en agenda_2026 y saque a la
 * persona de los conteos, y que un error de la base no deje la casilla mintiendo.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const policy = require('../js/colaboradores-directory-policy');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    if (j < 0) throw new Error('Sin cierre: ' + desde);
    return app.slice(i, j);
}

const CODIGO_HELPERS = trozo('function ctblPerteneceCol() {', 'function ctblFindColByCanon(canonName) {');
const CODIGO_FILA    = trozo('function ctblConstruirFilaHtml(r, dataIndex) {', 'function ctblPrepararRenderCache() {');
const CODIGO_TOGGLE  = trozo('window.ctblTogglePertenece = async function', '/** Click en fila: cerrar modal y mostrar ficha */');
const CODIGO_FUERA   = trozo('async function colabNumerosFueraDelArea() {', '/* Auditoría del sexo, bajo demanda desde la consola.');

const COL_PERT = 'pertenece_direccion_operacion';

/* El directorio de prueba usa los nombres de columna reales de agenda_2026:
   el número trae punto y espacio, que es justo lo que obliga a entrecomillar. */
const fila = (num, nombre, pertenece) => ({
    'No. Empleado': num,
    'Nombre': nombre,
    'Estatus': 'Activo',
    [COL_PERT]: pertenece,
});

function montar({ actualizaFalla = false, puedeEditar = true } = {}) {
    document.body.innerHTML = '<span class="ctbl-pert-badge d-none" id="ctbl-pert-badge"></span>'
        + '<table><tbody id="tb"></tbody></table>';

    const registros = [
        fila('1001', 'Ana Robles', true),
        fila('1002', 'Beto Cruz', true),
        fila('1003', 'Carla Díaz', false),
    ];

    const updates = [];
    const eq = jest.fn(() => ({
        error: actualizaFalla ? { message: 'permiso denegado' } : null,
    }));

    const ctx = {
        document,
        console,
        // Se resuelven al llamarlos, no al montar, para que los timers falsos
        // de jest alcancen al repintado agrupado del Resumen.
        setTimeout: (...a) => setTimeout(...a),
        clearTimeout: (...a) => clearTimeout(...a),
        // Mapeo semántico → columna real, tal como lo arma colabDetectarColumnas.
        colabCols: { num: 'No. Empleado', nombre: 'Nombre', estatus: 'Estatus', pertenece_direccion: COL_PERT },
        ctblAllData: registros,
        ctblCols: ['No. Empleado', 'Nombre', COL_PERT],
        CTBL_WRAP_COLS: new Set(),
        ctblRowHtmlCache: new WeakMap(),
        ctblRowNodeCache: new WeakMap(),
        colabDirectoryUniverse: { included: registros },
        colabCanEdit: () => puedeEditar,
        colabRequireEdit: () => puedeEditar,
        colabRenderDashboard: jest.fn(),
        colabSemaforoHtml: () => '',
        semClassify: () => ({ cls: '' }),
        colabFormatBirthDateDisplay: v => v,
        alert: jest.fn(),
        supabaseClient: {
            from: jest.fn(() => ({
                update: payload => { updates.push(payload); return { eq }; },
            })),
        },
        logHistory: jest.fn(),
    };
    // El contador cuenta sobre el universo del Resumen, no sobre los renglones.
    ctx.colabObtenerUniversoDirectorio = () =>
        policy.buildUniverse(registros, { get: ctx.gc, today: '2026-09-24' });
    ctx.gc = (registro, clave) => {
        const real = ctx.colabCols[clave];
        return real ? (registro[real] ?? null) : null;
    };
    ctx.window = ctx;
    ctx.ColaboradoresDirectoryPolicy = policy;
    vm.createContext(ctx);
    vm.runInContext([CODIGO_HELPERS, CODIGO_FILA, CODIGO_TOGGLE].join('\n'), ctx);

    return { ctx, registros, updates, eq };
}

/** Pinta los renglones y devuelve las casillas, como las ve quien depura. */
function pintar(ctx, registros) {
    const tb = document.getElementById('tb');
    tb.innerHTML = registros.map((r, i) => ctx.ctblConstruirFilaHtml(r, i)).join('');
    return [...tb.querySelectorAll('input[type=checkbox]')];
}

describe('palomita de pertenencia a la Dirección de Operación', () => {
    test('la casilla se pinta como está guardada', () => {
        const { ctx, registros } = montar();
        const casillas = pintar(ctx, registros);
        expect(casillas.map(c => c.checked)).toEqual([true, true, false]);
    });

    test('a quien no cuenta se le apaga el renglón', () => {
        const { ctx, registros } = montar();
        pintar(ctx, registros);
        const filas = [...document.querySelectorAll('#tb tr')];
        expect(filas.map(f => f.classList.contains('ctbl-fuera'))).toEqual([false, false, true]);
    });

    test('la casilla no abre la ficha: el clic se queda en ella', () => {
        // El renglón entero lleva onclick para abrir la ficha; sin detener la
        // propagación, palomear a alguien te sacaba de la tabla en cada clic.
        const { ctx, registros } = montar();
        pintar(ctx, registros);
        const label = document.querySelector('#tb .ctbl-pert');
        expect(label.getAttribute('onclick')).toContain('stopPropagation');
    });

    test('despalomear guarda en agenda_2026 y saca a la persona del conteo', async () => {
        const { ctx, registros, updates, eq } = montar();
        const casillas = pintar(ctx, registros);

        casillas[0].checked = false;
        await ctx.ctblTogglePertenece(casillas[0], 0);

        expect(updates).toEqual([{ [COL_PERT]: false }]);
        // El número de empleado trae punto y espacio: va entrecomillado o no filtra.
        expect(eq).toHaveBeenCalledWith('"No. Empleado"', '1001');
        expect(registros[0][COL_PERT]).toBe(false);

        // Y el Resumen ya no la cuenta.
        const universo = policy.buildUniverse(registros, { get: ctx.gc, today: '2026-09-24' });
        expect(universo.summary.total).toBe(1);
        expect(universo.summary.excluded.outsideDirection).toBe(2);
    });

    test('volver a palomear la reincorpora', async () => {
        const { ctx, registros, updates } = montar();
        const casillas = pintar(ctx, registros);

        casillas[2].checked = true;
        await ctx.ctblTogglePertenece(casillas[2], 2);

        expect(updates).toEqual([{ [COL_PERT]: true }]);
        expect(registros[2][COL_PERT]).toBe(true);
    });

    test('guardar obliga a rehacer el universo y a repintar el Resumen', async () => {
        jest.useFakeTimers();
        try {
            const { ctx, registros } = montar();
            const casillas = pintar(ctx, registros);

            casillas[1].checked = false;
            await ctx.ctblTogglePertenece(casillas[1], 1);

            expect(ctx.colabDirectoryUniverse).toBeNull();
            jest.advanceTimersByTime(500);
            expect(ctx.colabRenderDashboard).toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    test('una ráfaga de palomitas repinta el Resumen una sola vez', async () => {
        // Depurar el padrón son cientos de clics seguidos y el Resumen ni
        // siquiera se ve: repintar sus veinte gráficas en cada uno se sentía.
        jest.useFakeTimers();
        try {
            const { ctx, registros } = montar();
            const casillas = pintar(ctx, registros);

            casillas[0].checked = false;
            await ctx.ctblTogglePertenece(casillas[0], 0);
            casillas[1].checked = false;
            await ctx.ctblTogglePertenece(casillas[1], 1);
            casillas[2].checked = true;
            await ctx.ctblTogglePertenece(casillas[2], 2);

            expect(ctx.colabRenderDashboard).not.toHaveBeenCalled();
            jest.advanceTimersByTime(500);
            expect(ctx.colabRenderDashboard).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('si la base rechaza el cambio, la casilla vuelve a como estaba', async () => {
        // Lo contrario dejaría la pantalla diciendo algo que no se guardó.
        const { ctx, registros } = montar({ actualizaFalla: true });
        const casillas = pintar(ctx, registros);

        casillas[0].checked = false;
        await ctx.ctblTogglePertenece(casillas[0], 0);

        expect(casillas[0].checked).toBe(true);
        expect(registros[0][COL_PERT]).toBe(true);
        expect(ctx.alert).toHaveBeenCalled();
    });

    test('sin permisos de edición la casilla está bloqueada y no guarda', async () => {
        const { ctx, registros, updates } = montar({ puedeEditar: false });
        const casillas = pintar(ctx, registros);
        expect(casillas.every(c => c.disabled)).toBe(true);

        casillas[0].checked = false;
        await ctx.ctblTogglePertenece(casillas[0], 0);
        expect(updates).toEqual([]);
        expect(casillas[0].checked).toBe(true);
    });

    test('sin la columna en la tabla, avisa qué SQL correr y no inventa el guardado', async () => {
        const { ctx, updates } = montar();
        ctx.colabCols.pertenece_direccion = null;
        const casilla = Object.assign(document.createElement('input'), { type: 'checkbox', checked: false });

        await ctx.ctblTogglePertenece(casilla, 0);

        expect(updates).toEqual([]);
        expect(ctx.alert.mock.calls[0][0]).toContain('db/add_pertenece_direccion_operacion.sql');
        expect(casilla.checked).toBe(true);
    });

    test('el contador del encabezado dice cuántos cuentan y cuántos no', () => {
        const { ctx } = montar();
        ctx.ctblActualizarResumenPertenencia();
        const badge = document.getElementById('ctbl-pert-badge');
        expect(badge.classList.contains('d-none')).toBe(false);
        expect(badge.textContent).toBe('2 en la Dirección de Operación · 1 despalomeado');
    });

    test('con todos palomeados el contador no habla de gente fuera', () => {
        const { ctx, registros } = montar();
        registros[2][COL_PERT] = true;
        ctx.ctblActualizarResumenPertenencia();
        expect(document.getElementById('ctbl-pert-badge').textContent)
            .toBe('3 en la Dirección de Operación');
    });

    test('el contador NO suma vacantes ni bajas, aunque la tabla las muestre', () => {
        // La tabla enseña los 546 renglones crudos; la tarjeta "Total
        // Colaboradores" dice 420. Si el contador sumara los renglones, daría
        // un número que no coincide con ninguna tarjeta.
        const { ctx, registros } = montar();
        registros.push(fila('1004', 'VACANTE', true));
        registros.push({ ...fila('1005', 'Dani Soto', true), 'Estatus': 'Baja' });

        ctx.ctblActualizarResumenPertenencia();

        const badge = document.getElementById('ctbl-pert-badge');
        // Siguen siendo 2: la vacante y la baja nunca contaron.
        expect(badge.textContent).toBe('2 en la Dirección de Operación · 1 despalomeado');
        // Y el tooltip explica de dónde sale la diferencia con la tabla.
        expect(badge.title).toContain('De los 5 renglones de esta tabla, 2 cuentan');
        expect(badge.title).toContain('bajas, vacantes');
    });
});

describe('el SQL que crea la columna', () => {
    const sql = fs.readFileSync(
        path.resolve(__dirname, '..', 'db', 'add_pertenece_direccion_operacion.sql'), 'utf8');

    test('nace en true para que ningún número se mueva el día que se corre', () => {
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS pertenece_direccion_operacion boolean NOT NULL DEFAULT true/i);
    });

    test('se puede correr dos veces sin romper nada', () => {
        expect(sql).toMatch(/IF NOT EXISTS/i);
    });
});

/* Vencimientos, Agenda de Cursos y Vacaciones consultan agenda_2026 cada uno
   por su cuenta. Para que la palomita mande igual en los tres, todos filtran
   contra el mismo conjunto en vez de repetir la regla. */
describe('el conjunto que comparten Vencimientos, Cursos y Vacaciones', () => {
    function montarHelper({ conColumna = true } = {}) {
        const registros = [
            fila('1001', 'Ana Robles', true),
            fila('1002', 'Beto Cruz', false),
            fila('1003', 'Carla Díaz', false),
        ];
        const ctx = {
            console,
            colabCols: {
                num: 'No. Empleado',
                nombre: 'Nombre',
                estatus: 'Estatus',
                pertenece_direccion: conColumna ? COL_PERT : null,
            },
            colabCache: registros,
            colabCargarTodos: async () => registros,
        };
        ctx.gc = (registro, clave) => {
            const real = ctx.colabCols[clave];
            return real ? (registro[real] ?? null) : null;
        };
        ctx.window = ctx;
        ctx.ColaboradoresDirectoryPolicy = policy;
        vm.createContext(ctx);
        vm.runInContext(CODIGO_FUERA, ctx);
        return ctx;
    }

    test('junta a los despalomeados por su No. de Empleado', async () => {
        const ctx = montarHelper();
        const fuera = await ctx.colabNumerosFueraDelArea();
        expect([...fuera].sort()).toEqual(['1002', '1003']);
    });

    test('sin la columna en la tabla no filtra a nadie', async () => {
        // Mientras el SQL no se corra, los tres módulos siguen como estaban.
        const ctx = montarHelper({ conColumna: false });
        expect((await ctx.colabNumerosFueraDelArea()).size).toBe(0);
    });
});

/* El menú de la columna ofrece unos textos y el filtro compara otros. Si los
   dos no salen del MISMO sitio, marcas una opción y la tabla se queda vacía. */
describe('filtrar por la columna de pertenencia', () => {
    test('la palomita se lee como Sí/No, no como true/false', () => {
        const { ctx, registros } = montar();
        expect(ctx.ctblValorFiltro(registros[0], COL_PERT)).toBe('Sí');
        expect(ctx.ctblValorFiltro(registros[2], COL_PERT)).toBe('No');
    });

    test('las demás columnas se siguen filtrando por su texto tal cual', () => {
        const { ctx, registros } = montar();
        expect(ctx.ctblValorFiltro(registros[0], 'Nombre')).toBe('Ana Robles');
    });

    test('una celda vacía sigue agrupándose bajo la raya', () => {
        const { ctx } = montar();
        expect(ctx.ctblValorFiltro({ Nombre: '   ' }, 'Nombre')).toBe('—');
    });

    test('sin la columna en la tabla no inventa Sí/No', () => {
        const { ctx, registros } = montar();
        ctx.colabCols.pertenece_direccion = null;
        expect(ctx.ctblValorFiltro(registros[0], COL_PERT)).toBe('true');
    });

    test('el menú y la comparación leen el mismo valor', () => {
        // El invariante que evita el filtro que no encuentra nada: las dos
        // llamadas de index.html tienen que pasar por ctblValorFiltro.
        expect(app).toContain('const allVals = [...new Set(ctblAllData.map(r => ctblValorFiltro(r, col)))]');
        expect(app).toContain('const cell = ctblValorFiltro(r, col);');
    });

    test('buscar dentro del menú ignora los acentos', () => {
        // Sin esto, teclear "si" no encontraba "Sí" en su propia columna.
        expect(app).toContain('const shown = q ? _ctblCFP.allVals.filter(v => norm(v).includes(q)) : _ctblCFP.allVals;');
    });
});
