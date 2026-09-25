/**
 * @jest-environment jsdom
 *
 * Plazas vacantes.
 *
 * Una vacante no es una persona: es una plaza con presupuesto y sin nadie. En
 * el directorio vive como un renglón más —nombre "VACANTE", número de empleado
 * en blanco— pero con su plaza, su nivel, su sueldo y su lugar en el
 * organigrama bien capturados. El Resumen ya las descartaba del total (por eso
 * la tabla tiene más renglones que personas cuenta la tarjeta), pero no había
 * dónde verlas, y saber qué está vacío es justo lo que hace falta para pedir
 * personal.
 *
 * Aquí se comprueba que la lista salga de la MISMA regla que ya las descarta
 * —no una nueva—, que se agrupe por el nivel que se elija y que el buscador
 * encuentre por plaza, puesto o área.
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

const _bruto = trozo('const PLZ_NIVELES_AREA', 'TABLA COMPLETA DE COLABORADORES');
// El trozo termina en el banner de la siguiente sección: se corta ese /* suelto,
// que si no dejaría un comentario sin cerrar y se comería todo el bloque.
const CODIGO = _bruto.slice(0, _bruto.lastIndexOf('/*'));

/* Una persona de verdad y una plaza vacía, con las columnas como vienen. */
const persona = (num, nombre, sub) => ({
    num, nombre, estatus: 'Activo',
    subdireccion: sub, direccion: 'Dirección de Operación',
    gerencia: '', coordinacion: '', plaza: '', nivel: 'N4', puesto: 'Inspector', sueldo: '',
});

const vacante = (plaza, sub, extra = {}) => ({
    num: '', nombre: 'VACANTE', estatus: 'Activo',
    subdireccion: sub, direccion: 'Dirección de Operación',
    gerencia: '', coordinacion: '',
    plaza, nivel: 'N4', puesto: 'Inspector de seguridad',
    sueldo: '$29,958.98',
    ...extra,
});

const SSO = 'Subdirección de Seguridad Operacional';
const ING = 'Subdirección de Ingeniería';

function montar(registros) {
    document.body.innerHTML = `
        <span id="vacp-badge"></span>
        <b id="vacp-total"></b><b id="vacp-areas"></b>
        <span id="vacp-areas-lbl"></span><b id="vacp-sueldo"></b>
        <select id="vacp-agrupar"></select>
        <div id="vacp-body"></div>`;

    const ctx = {
        document,
        console,
        norm: s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/\s+/g, ' ').trim(),
        gc: (r, clave) => (r ? (r[clave] ?? null) : null),
    };
    ctx.colabObtenerUniversoDirectorio = () =>
        policy.buildUniverse(registros, { get: ctx.gc, today: '2026-09-24' });
    ctx.window = ctx;
    ctx.ColaboradoresDirectoryPolicy = policy;
    vm.createContext(ctx);
    vm.runInContext(CODIGO, ctx);
    return ctx;
}

const grupos = () => [...document.querySelectorAll('#vacp-body .vacp-grupo-head')]
    .map(h => h.querySelector('span').textContent);
const plazas = () => [...document.querySelectorAll('#vacp-body .vacp-plaza')]
    .map(e => e.textContent);
const texto = id => document.getElementById(id).textContent;

describe('qué cuenta como plaza vacante', () => {
    test('salen de la misma regla que ya las descuenta del total', () => {
        const registros = [
            persona('1', 'Ana Robles', SSO),
            vacante('53', SSO),
            vacante('78', ING),
        ];
        const ctx = montar(registros);

        expect(ctx.colabPlazasVacantes()).toHaveLength(2);
        // Y son exactamente las que el Resumen resta.
        const universo = ctx.colabObtenerUniversoDirectorio();
        expect(universo.summary.excluded.vacancy).toBe(2);
        expect(universo.summary.total).toBe(1);
    });

    test('una baja no es una vacante', () => {
        // La plaza sigue ocupada hasta que alguien la marque como vacante.
        const ctx = montar([
            { ...persona('2', 'Beto Cruz', SSO), estatus: 'Baja' },
            vacante('53', SSO),
        ]);
        expect(ctx.colabPlazasVacantes()).toHaveLength(1);
    });

    test('el sueldo se lee aunque venga con pesos y comas', () => {
        const ctx = montar([vacante('53', SSO)]);
        expect(ctx._plzSueldo({ sueldo: '$29,958.98' })).toBeCloseTo(29958.98, 2);
        expect(ctx._plzSueldo({ sueldo: '' })).toBe(0);
        expect(ctx._plzSueldo({ sueldo: 'N/D' })).toBe(0);
    });
});

describe('cómo se agrupan', () => {
    const registros = () => [
        persona('1', 'Ana Robles', SSO),
        vacante('53', SSO),
        vacante('12', SSO),
        vacante('78', ING),
    ];

    test('donde más falta gente aparece primero', () => {
        const ctx = montar(registros());
        ctx.colabVacantesRender();
        expect(grupos()).toEqual([SSO, ING]);
    });

    test('dentro de un área las plazas van en orden numérico', () => {
        // "12" antes que "53", no como texto ("12" < "53" por casualidad, pero
        // "9" tendría que ir antes que "12" y como texto no lo haría).
        const ctx = montar([vacante('53', SSO), vacante('9', SSO), vacante('12', SSO)]);
        ctx.colabVacantesRender();
        expect(plazas()).toEqual(['Plaza 9', 'Plaza 12', 'Plaza 53']);
    });

    test('se puede cambiar el nivel del organigrama', () => {
        const ctx = montar([
            vacante('53', SSO, { gerencia: 'Gerencia de Seguridad Operacional' }),
            vacante('78', ING, { gerencia: 'Gerencia de Ingeniería Civil' }),
        ]);
        ctx.colabVacantesAgrupar('gerencia');
        expect(grupos()).toEqual(['Gerencia de Ingeniería Civil', 'Gerencia de Seguridad Operacional']);
        expect(texto('vacp-areas-lbl')).toBe('Gerencias con vacantes');
    });

    test('un área sin capturar se ve, no se tapa con la de arriba', () => {
        // Si rellenáramos con la dirección, el hueco de captura quedaría oculto.
        const ctx = montar([vacante('53', '')]);
        ctx.colabVacantesRender();
        expect(grupos()).toEqual(['Sin subdirección capturada']);
    });
});

describe('el resumen de arriba', () => {
    test('dice cuántas plazas, en cuántas áreas y cuánto sueldo', () => {
        const ctx = montar([
            persona('1', 'Ana Robles', SSO),
            vacante('53', SSO),
            vacante('12', SSO),
            vacante('78', ING),
        ]);
        ctx.colabVacantesRender();

        expect(texto('vacp-total')).toBe('3');
        expect(texto('vacp-areas')).toBe('2');
        expect(texto('vacp-areas-lbl')).toBe('Subdirecciones con vacantes');
        // 3 × 29,958.98 = 89,876.94
        expect(texto('vacp-sueldo')).toContain('89,876.94');
    });

    test('sin sueldo capturado no inventa un total', () => {
        const ctx = montar([vacante('53', SSO, { sueldo: '' })]);
        ctx.colabVacantesRender();
        expect(texto('vacp-sueldo')).toBe('—');
    });
});

describe('buscar', () => {
    const registros = () => [
        vacante('53', SSO, { puesto: 'Inspector de seguridad' }),
        vacante('78', ING, { puesto: 'Ingeniero civil' }),
    ];

    test('encuentra por número de plaza', () => {
        const ctx = montar(registros());
        ctx.colabVacantesBuscar('78');
        expect(plazas()).toEqual(['Plaza 78']);
    });

    test('encuentra por puesto', () => {
        const ctx = montar(registros());
        ctx.colabVacantesBuscar('ingeniero');
        expect(plazas()).toEqual(['Plaza 78']);
    });

    test('encuentra por área e ignora los acentos', () => {
        // "ingenieria" sin acento tiene que encontrar "Ingeniería".
        const ctx = montar(registros());
        ctx.colabVacantesBuscar('ingenieria');
        expect(plazas()).toEqual(['Plaza 78']);
    });

    test('sin coincidencias lo dice, y el conteo del encabezado no miente', () => {
        const ctx = montar(registros());
        ctx.colabVacantesBuscar('zzz');
        expect(document.querySelector('#vacp-body .vacp-vacio')).not.toBeNull();
        expect(texto('vacp-total')).toBe('0');
        // El badge sigue contando TODAS, no solo las que pasan el filtro.
        expect(texto('vacp-badge')).toBe('2');
    });
});

describe('sin vacantes', () => {
    test('lo dice en vez de dejar el hueco vacío', () => {
        const ctx = montar([persona('1', 'Ana Robles', SSO)]);
        ctx.colabVacantesRender();
        expect(document.querySelector('#vacp-body .vacp-vacio').textContent)
            .toContain('No hay plazas vacantes');
        expect(texto('vacp-total')).toBe('0');
    });
});

describe('la tarjeta del Resumen', () => {
    test('el número sale del universo, no de un conteo aparte', () => {
        expect(app).toContain('const vacantes = universe.summary.excluded.vacancy || 0;');
        expect(app).toContain("setKpi('cd-kpi-vacantes', vacantes);");
    });

    test('la tarjeta abre la lista de vacantes', () => {
        expect(app).toContain('data-kpi="vacantes"');
        expect(app).toContain('window.colabAbrirVacantes();');
    });
});
