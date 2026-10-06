/**
 * @jest-environment jsdom
 *
 * Importar Excel en Conciliación Manifiestos.
 *
 * Lo que se fija aquí es el criterio, que es lo delicado de una importación:
 * sobre un manifiesto que ya existe SÓLO se rellenan las celdas vacías, los
 * cerrados por Subsecretaría no se tocan, y las columnas que calcula el
 * sistema nunca se escriben aunque el archivo las traiga.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'conci-importar-excel.js'), 'utf8'
);

const COLUMNAS = {
    fecha: 'FECHA',
    tipo: 'TIPO DE MANIFIESTO',
    vuelo: '# DE VUELO',
    aerolinea: 'AEROLINEA'
};

let api;

beforeAll(() => {
    // Lo que el módulo toma prestado de la aplicación.
    window._conciParseDateTimeParts = (valor) => {
        const m = String(valor || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!m) return null;
        return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
    };
    window._conciIsCalculatedColumn = () => false;
    window.eval(fuente);
    api = window.ConciImportarExcel;
});

describe('la llave del manifiesto', () => {
    test('se arma con fecha, número de vuelo y tipo', () => {
        const llave = api.llaveDeFila({
            FECHA: '22/09/2026', 'TIPO DE MANIFIESTO': 'LLEGADA',
            '# DE VUELO': 'VB 9501', AEROLINEA: 'VIVA AEROBUS'
        }, COLUMNAS, 2026);
        expect(llave.id).toBe('2026-09-22|9501|LLEGADA');
    });

    test('da igual cómo venga escrito el vuelo', () => {
        const solo = api.numeroDeVuelo('9501', '');
        expect(api.numeroDeVuelo('VB 9501', 'VB')).toBe(solo);
        expect(api.numeroDeVuelo('VB9501', 'VB')).toBe(solo);
    });

    test('la fecha entra en cualquiera de sus tres formas', () => {
        expect(api.fechaIso('22/09/2026', 2026)).toBe('2026-09-22');
        expect(api.fechaIso('2026-09-22', 2026)).toBe('2026-09-22');
        // Serial de Excel: así llega una celda de fecha sin formato.
        expect(api.fechaIso('46287', 2026)).toBe('2026-09-22');
    });

    test('sin fecha, sin vuelo o sin tipo no hay llave', () => {
        const base = { FECHA: '22/09/2026', 'TIPO DE MANIFIESTO': 'LLEGADA', '# DE VUELO': '9501' };
        expect(api.llaveDeFila({ ...base, FECHA: '' }, COLUMNAS, 2026)).toBeNull();
        expect(api.llaveDeFila({ ...base, '# DE VUELO': '' }, COLUMNAS, 2026)).toBeNull();
        expect(api.llaveDeFila({ ...base, 'TIPO DE MANIFIESTO': 'X' }, COLUMNAS, 2026)).toBeNull();
    });
});

describe('carga o pasajeros', () => {
    test('manda lo que declare el archivo', () => {
        expect(api.clasificaFila({}, 'CARGA')).toBe('CARGA');
        expect(api.clasificaFila({}, 'PASAJEROS')).toBe('PASAJEROS');
    });

    test('si el archivo sólo dice LLEGADA/SALIDA, decide por los campos con valor', () => {
        expect(api.clasificaFila({ 'TOTAL PAX': '150' }, 'LLEGADA')).toBe('PASAJEROS');
        expect(api.clasificaFila({ 'KGS. DE CARGA NACIONAL': '9645' }, 'SALIDA')).toBe('CARGA');
        expect(api.clasificaFila({ 'TOTAL PAX': '150', 'KG DE CARGA TOTAL': '800' }, 'LLEGADA')).toBe('MIXTA');
        expect(api.clasificaFila({ RUTA: 'NLU-CUN' }, 'LLEGADA')).toBe('SIN DATOS');
    });
});

describe('sobre un manifiesto que ya existe', () => {
    test('sólo se rellenan las celdas vacías', () => {
        const existente = { 'TOTAL PAX': '150', 'KGS. DE EQUIPAJE': '', OBSERVACIONES: null };
        const archivo = { 'TOTAL PAX': '188', 'KGS. DE EQUIPAJE': '1200', OBSERVACIONES: 'Sin novedad' };

        const { relleno } = api.combinar(existente, archivo);

        expect(relleno).toEqual({ 'KGS. DE EQUIPAJE': '1200', OBSERVACIONES: 'Sin novedad' });
        expect(relleno['TOTAL PAX']).toBeUndefined();
    });

    test('lo que difiere se reporta, pero no se toca', () => {
        const { conflictos } = api.combinar({ 'TOTAL PAX': '150' }, { 'TOTAL PAX': '188' });
        expect(conflictos).toEqual([{ columna: 'TOTAL PAX', actual: '150', nuevo: '188' }]);
    });

    test('las columnas del sistema no se escriben aunque vengan en el archivo', () => {
        const { relleno } = api.combinar(
            { 'CAPTURÓ': '', EVIDENCIA: '', 'FACTOR DE OCUPACIÓN': '' },
            { 'CAPTURÓ': 'OTRA PERSONA', EVIDENCIA: 'foto.jpg', 'FACTOR DE OCUPACIÓN': '90' }
        );
        expect(relleno).toEqual({});
    });
});

describe('el plan de importación', () => {
    const fila = (renglon, payload, extra = {}) => Object.assign({
        renglon,
        payload,
        familia: 'PASAJEROS',
        llave: api.llaveDeFila(payload, COLUMNAS, 2026)
    }, extra);

    const PAX = (vuelo, extra = {}) => Object.assign({
        FECHA: '22/09/2026', 'TIPO DE MANIFIESTO': 'Llegada',
        '# DE VUELO': vuelo, AEROLINEA: 'VIVA AEROBUS', 'TOTAL PAX': '150'
    }, extra);

    test('lo que no existe se inserta y lo que existe se completa', () => {
        const existentes = new Map([
            // Como en la base: la fila viene COMPLETA, no solo con la llave.
            ['2026-09-22|9501|LLEGADA', [{
                id: 7, FECHA: '22/09/2026', 'TIPO DE MANIFIESTO': 'Llegada',
                '# DE VUELO': '9501', AEROLINEA: 'VIVA AEROBUS',
                'TOTAL PAX': '150', 'KGS. DE EQUIPAJE': ''
            }]]
        ]);

        const plan = api.planificar([
            fila(2, PAX('9501', { 'KGS. DE EQUIPAJE': '1200' })),
            fila(3, PAX('9502'))
        ], existentes);

        expect(plan.actualizar).toHaveLength(1);
        expect(plan.actualizar[0].id).toBe(7);
        expect(plan.actualizar[0].payload).toEqual({ 'KGS. DE EQUIPAJE': '1200' });
        expect(plan.insertar).toHaveLength(1);
        expect(plan.insertar[0].payload['# DE VUELO']).toBe('9502');
    });

    test('un manifiesto cerrado por Subsecretaría se omite, no se modifica', () => {
        const existentes = new Map([
            ['2026-09-22|9501|LLEGADA', [{ id: 7, __cerrado: true, 'KGS. DE EQUIPAJE': '' }]]
        ]);

        const plan = api.planificar([fila(2, PAX('9501', { 'KGS. DE EQUIPAJE': '1200' }))], existentes);

        expect(plan.actualizar).toHaveLength(0);
        expect(plan.omitidas[0].motivo).toMatch(/cerrado por Subsecretaría/);
    });

    test('dos filas iguales en el mismo archivo: entra la primera', () => {
        const plan = api.planificar([
            fila(2, PAX('9501')),
            fila(3, PAX('9501'))
        ], new Map());

        expect(plan.insertar).toHaveLength(1);
        expect(plan.omitidas[0].motivo).toMatch(/repetida en el archivo/);
    });

    test('con dos manifiestos distintos para la misma llave no se adivina', () => {
        const existentes = new Map([
            ['2026-09-22|9501|LLEGADA', [
                { id: 7, __aerolinea: 'AEROMEXICO' },
                { id: 8, __aerolinea: 'COPA' }
            ]]
        ]);

        const plan = api.planificar([fila(2, PAX('9501', { 'KGS. DE EQUIPAJE': '1200' }))], existentes);

        expect(plan.actualizar).toHaveLength(0);
        expect(plan.omitidas[0].motivo).toMatch(/coinciden/);
    });

    test('la aerolínea desempata cuando la hay', () => {
        const existentes = new Map([
            ['2026-09-22|9501|LLEGADA', [
                { id: 7, __aerolinea: 'VIVA AEROBUS', 'KGS. DE EQUIPAJE': '' },
                { id: 8, __aerolinea: 'COPA', 'KGS. DE EQUIPAJE': '' }
            ]]
        ]);

        const plan = api.planificar([fila(2, PAX('9501', { 'KGS. DE EQUIPAJE': '1200' }))], existentes);

        expect(plan.actualizar).toHaveLength(1);
        expect(plan.actualizar[0].id).toBe(7);
    });

    test('una fila sin llave o sin datos se omite con su motivo', () => {
        const sinLlave = { renglon: 2, payload: { OBSERVACIONES: 'algo' }, familia: 'PASAJEROS', llave: null };
        const sinDatos = fila(3, PAX('9502'), { familia: 'SIN DATOS' });

        const plan = api.planificar([sinLlave, sinDatos], new Map());

        expect(plan.insertar).toHaveLength(0);
        expect(plan.omitidas.map(o => o.motivo)).toEqual([
            'sin fecha, número de vuelo o tipo de manifiesto',
            'no trae datos de pasajeros ni de carga'
        ]);
    });
});

describe('al escribir', () => {
    test('cuenta insertados y actualizados, y no se detiene con un error suelto', async () => {
        const escritas = [];
        window._conciWriteRowSafe = jest.fn(async (client, payload, id) => {
            escritas.push({ payload, id });
            if (payload.falla) return { ok: false, error: { message: 'columna inválida' } };
            return { ok: true };
        });

        const plan = {
            actualizar: [{ renglon: 2, id: 7, payload: { 'TOTAL PAX': '150' } }],
            insertar: [
                { renglon: 3, payload: { '# DE VUELO': '9502' } },
                { renglon: 4, payload: { falla: true } }
            ]
        };

        const r = await api.aplicar({}, plan);

        expect(r.actualizados).toBe(1);
        expect(r.insertados).toBe(1);
        expect(r.fallidos).toEqual([{ renglon: 4, motivo: 'columna inválida' }]);
        // Primero se completa lo existente: si algo truena, lo capturado ya quedó.
        expect(escritas[0].id).toBe(7);
    });
});

/* ── Lo que el libro real del área obligó a resolver ──────────────────────── */

describe('encontrar la hoja y la fila de encabezados', () => {
    // En el libro del área, la fila 1 de DATA lleva una fórmula auxiliar y los
    // nombres de columna están en la fila 2. Dar por hecho "primera hoja,
    // primera fila" hacía que se leyera INFORMATIVOS y no se importara nada.
    const DATA = [
        ['0:16', '', '', '', '', 'CONTAR.SI.CONJUNTO'],
        ['MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', '# DE VUELO', 'DESTINO / ORIGEN'],
        ['SEPTIEMBRE', '01/09/2026', 'SALIDA', 'VIVA AEROBUS', '842', 'LA HABANA']
    ];
    const INFORMATIVOS = [
        ['FECHA', 'AEROLINEA', '# DE VUELO'],
        ['01/09/2026', 'VIVA AEROBUS', '842'],
        ['02/09/2026', 'VIVA AEROBUS', '843']
    ];

    test('se salta la fila de fórmulas y toma la de abajo', () => {
        expect(api.encabezadoDeMatriz(DATA)).toEqual({ indice: 1, puntos: 6 });
    });

    test('gana la hoja que reconoce más columnas, no la primera', () => {
        const elegida = api.elegirHoja([
            { nombre: 'DATA', matriz: DATA },
            { nombre: 'INFORMATIVOS', matriz: INFORMATIVOS }
        ]);
        expect(elegida.nombre).toBe('DATA');
        expect(elegida.indice).toBe(1);
    });

    test('con el mismo encabezado, la hoja con más registros', () => {
        const elegida = api.elegirHoja([
            { nombre: 'CANCELADOS', matriz: INFORMATIVOS.slice(0, 2) },
            { nombre: 'BASE', matriz: INFORMATIVOS }
        ]);
        expect(elegida.nombre).toBe('BASE');
    });

    test('sin ninguna hoja de manifiestos no se inventa una', () => {
        const dinamica = [['Etiquetas de fila', 'Suma de PAX'], ['VIVA AEROBUS', '120']];
        expect(api.elegirHoja([{ nombre: 'ACUMULADO', matriz: dinamica }])).toBeNull();
    });
});

describe('el valor de la celda, no su apariencia', () => {
    // El libro guarda FECHA como número de serie y la muestra con formato de
    // Estados Unidos: el 1 de septiembre se ve "9/1/26". Leer ese texto lo
    // convertía en 9 de enero, y habría importado el mes con la fecha
    // equivocada.
    //
    // La cuenta se hace sobre el serial y no sobre el objeto de fecha de la
    // librería porque cada versión lo arma en una zona distinta: la 0.18.5 que
    // carga el sitio lo pone en hora local y otras en UTC, y esas horas mueven
    // el manifiesto de día.
    beforeAll(() => {
        // Sin el ayudante de la librería, para probar también el camino de
        // reserva que decide por el formato.
        window.XLSX = undefined;
    });

    test('una fecha se lee del serial, aunque Excel la dibuje al revés', () => {
        // 46266 es el 1 de septiembre de 2026; Excel lo muestra "9/1/26".
        expect(api.valorDeCelda({ t: 'n', v: 46266, z: 'm/d/yy', w: '9/1/26' })).toBe('01/09/2026');
    });

    test('una fecha con hora conserva la hora', () => {
        const serial = 46267 + (12 * 60 + 15) / 1440;
        expect(api.valorDeCelda({ t: 'n', v: serial, z: 'm/d/yy h:mm', w: '9/2/26 12:15' }))
            .toBe('02/09/2026 12:15');
    });

    test('una celda de sólo hora da la hora suelta', () => {
        expect(api.valorDeCelda({ t: 'n', v: 0.25, z: 'h:mm', w: '6:00' })).toBe('06:00');
    });

    test('un número con formato normal no se confunde con una fecha', () => {
        expect(api.valorDeCelda({ t: 'n', v: 46266, z: '0.00', w: '46266.00' })).toBe('46266.00');
        expect(api.valorDeCelda({ t: 'n', v: 3.2500000001, z: '0.00', w: '3.25' })).toBe('3.25');
    });

    test('lo que no es número se lee como lo muestra la hoja', () => {
        expect(api.valorDeCelda({ t: 's', v: 'VIVA AEROBUS', w: 'VIVA AEROBUS' })).toBe('VIVA AEROBUS');
        expect(api.valorDeCelda(undefined)).toBe('');
    });
});

describe('dos rotaciones del mismo vuelo', () => {
    // Pasa de verdad en el cierre: el mismo número de vuelo opera dos veces el
    // mismo día y en el mismo sentido, con distinto destino y distintos
    // pasajeros. La llave no las distingue, y descartar la segunda perdía un
    // manifiesto real.
    const COLS = Object.assign({}, COLUMNAS, { ruta: 'DESTINO / ORIGEN' });
    const fila = (renglon, payload) => ({
        renglon, payload, familia: 'PASAJEROS', llave: api.llaveDeFila(payload, COLS, 2026)
    });
    const VUELO = (destino, pax) => ({
        FECHA: '08/09/2026', 'TIPO DE MANIFIESTO': 'Llegada', '# DE VUELO': '875',
        AEROLINEA: 'AEROLITORAL', 'DESTINO / ORIGEN': destino, 'TOTAL PAX': pax
    });

    test('las dos entran: no se descarta la segunda', () => {
        const plan = api.planificar([
            fila(2, VUELO('MERIDA', '82')),
            fila(3, VUELO('MERIDA', '67'))
        ], new Map());

        expect(plan.insertar).toHaveLength(2);
        expect(plan.omitidas).toHaveLength(0);
    });

    test('si la base ya tiene una, la otra se inserta', () => {
        const existentes = new Map([['2026-09-08|875|LLEGADA', [{
            id: 7, __aerolinea: 'AEROLITORAL', __ruta: 'MERIDA',
            FECHA: '08/09/2026', 'TOTAL PAX': '82', 'KGS. DE EQUIPAJE': ''
        }]]]);

        const plan = api.planificar([
            fila(2, Object.assign(VUELO('MERIDA', '82'), { 'KGS. DE EQUIPAJE': '900' })),
            fila(3, VUELO('MERIDA', '67'))
        ], existentes);

        expect(plan.actualizar).toHaveLength(1);
        expect(plan.actualizar[0].id).toBe(7);
        expect(plan.insertar).toHaveLength(1);
        expect(plan.insertar[0].payload['TOTAL PAX']).toBe('67');
    });

    test('el destino desempata cuál es cuál', () => {
        const existentes = new Map([['2026-09-13|7351|LLEGADA', [
            { id: 7, __aerolinea: 'VIVA AEROBUS', __ruta: 'PUERTO VALLARTA', 'KGS. DE EQUIPAJE': '' },
            { id: 8, __aerolinea: 'VIVA AEROBUS', __ruta: 'SANTA LUCIA', 'KGS. DE EQUIPAJE': '' }
        ]]]);
        const conRuta = (destino) => fila(2, {
            FECHA: '13/09/2026', 'TIPO DE MANIFIESTO': 'Llegada', '# DE VUELO': '7351',
            AEROLINEA: 'VIVA AEROBUS', 'DESTINO / ORIGEN': destino,
            'TOTAL PAX': '180', 'KGS. DE EQUIPAJE': '900'
        });

        expect(api.planificar([conRuta('SANTA LUCIA')], existentes).actualizar[0].id).toBe(8);
        expect(api.planificar([conRuta('PUERTO VALLARTA')], existentes).actualizar[0].id).toBe(7);
    });

    test('la misma captura escrita dos veces sí se descarta', () => {
        const plan = api.planificar([
            fila(2, VUELO('MERIDA', '82')),
            fila(3, VUELO('MERIDA', '82'))
        ], new Map());

        expect(plan.insertar).toHaveLength(1);
        expect(plan.omitidas[0].motivo).toMatch(/repetida en el archivo/);
    });
});

describe('los renglones de relleno del libro', () => {
    // El libro arrastra sus fórmulas miles de renglones hacia abajo: debajo del
    // último manifiesto quedan filas con sólo columnas calculadas. No son
    // manifiestos incompletos y no tienen que salir en el informe.
    const ESQUEMA = ['MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', '# DE VUELO',
        'DESTINO / ORIGEN', 'TOTAL PAX', 'HRS. CUMPLIDAS'];

    const norm = (v) => String(v || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    beforeAll(() => {
        window._conciImportBuildColumnMap = (encabezados, esquema) => (encabezados || [])
            .map((h, index) => ({ index, target: (esquema || []).find(c => norm(c) === norm(h)) || null }))
            .filter(i => i.target);
        window._conciImportFindColumn = (columnas, tipo) => {
            const patrones = {
                fecha: /^fecha$/, tipo: /tipo_de_manifiesto/, vuelo: /de_vuelo/,
                aerolinea: /aerolinea/, ruta: /destino/
            };
            return (columnas || []).find(c => patrones[tipo] && patrones[tipo].test(norm(c))) || null;
        };
        window._conciImportValue = (v) => String(v == null ? '' : v).trim();
        window._conciPrepareValueForDatabase = (col, v) => v;
    });

    test('se descartan en silencio y sólo quedan los manifiestos', async () => {
        const csv = [
            '0:16,,,,,,,CONTAR.SI.CONJUNTO',
            'MES,FECHA,TIPO DE MANIFIESTO,AEROLINEA,# DE VUELO,DESTINO / ORIGEN,TOTAL PAX,HRS. CUMPLIDAS',
            'SEPTIEMBRE,01/09/2026,SALIDA,VIVA AEROBUS,842,LA HABANA,95,1.50',
            ',,,,,,,0.00',
            ',,,,,,,0.00'
        ].join('\n');

        const leido = await api.leerArchivo({ name: 'cierre.csv', text: async () => csv }, ESQUEMA, 2026);

        expect(leido.filaEncabezado).toBe(2);
        expect(leido.relleno).toBe(2);
        expect(leido.filas).toHaveLength(1);
        // El renglón informado es el que se ve en Excel, contando el encabezado.
        expect(leido.filas[0].renglon).toBe(3);
        expect(leido.filas[0].llave.id).toBe('2026-09-01|842|SALIDA');
    });
});
