/**
 * @jest-environment jsdom
 *
 * La vista global de vacaciones tenía un solo calendario anual con cada día
 * pintado y una alerta de "8475 pares solapados": con 2,000+ períodos no se
 * leía nada. Ahora hay tres vistas sobre los mismos filtros (por mes, lista y
 * año) y cuatro indicadores. Aquí se pintan las tres con datos chicos y se
 * revisa lo que el usuario ve.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    if (j < 0) throw new Error('No se encontró: ' + hasta);
    return app.slice(i, j);
}

const HOY = new Date();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ANIO = HOY.getFullYear();
const MES = HOY.getMonth();
const mm = String(MES + 1).padStart(2, '0');

const EMPLEADOS = [
    {
        num: '101', nombre: 'Ana Pérez', subdireccion: 'Subdirección de Ingeniería',
        vacaciones: [
            // Hoy y los dos días siguientes (sin importar fin de semana: lista explícita)
            { id: 'a1', anio: ANIO, fecha_inicio: iso(HOY), fecha_fin: iso(new Date(HOY.getTime() + 2 * 864e5)),
              dias: [0, 1, 2].map(n => iso(new Date(HOY.getTime() + n * 864e5))), dias_totales: 3, estado: 'programado', tipo: 'vacaciones', computa: true },
        ],
    },
    {
        num: '202', nombre: 'Luis <Gómez>', subdireccion: 'Subdirección de Seguridad Operacional',
        vacaciones: [
            { id: 'b1', anio: ANIO, fecha_inicio: `${ANIO}-${mm}-01`, fecha_fin: `${ANIO}-${mm}-02`, dias_totales: 2, estado: 'disfrutado', tipo: 'medio_militar', computa: false,
              agenda: { no_oficio: '1234', periodo: '1 y 2' } },
            { id: 'b2', anio: ANIO, fecha_inicio: `${ANIO}-${mm}-05`, fecha_fin: `${ANIO}-${mm}-05`, dias_totales: 1, estado: 'cancelado', tipo: 'vacaciones' },
        ],
    },
    { num: '303', nombre: 'Sin vacaciones', subdireccion: 'Subdirección de Ingeniería', vacaciones: [] },
];

function montar() {
    document.body.innerHTML = '<div id="colabVacCalModal">'
        + '<div class="modal-body">' + trozo('<!-- Indicadores: quién falta hoy', '<!-- Vista activa -->')
        + '<div id="vac-cal-grid"></div></div></div>'
        + '<div id="vac-day-tip"></div><div id="vac-day-popup"><div id="vdp-title"></div><div id="vdp-body"></div></div>';

    const codigo = [
        trozo('const VAC_ANIO_MIN', '/** Lee el array vacaciones'),
        trozo('function _vacFmt(s)', '/** Abre el modal para agregar un período */'),
        trozo('const VAC_MESES =', '/** Abre el popup de detalle de un día del calendario global */'),
        trozo('function vacCalPopupOpen(key, anchorEl, lista)', 'function _vacCalPopupOutside'),
    ].join('\n');
    const abiertos = [];
    const entorno = {
        colabCols: { num: 'num', nombre: 'nombre' },
        gc: (r, k) => r[k],
        colabCargarTodos: async () => EMPLEADOS,
        vacCalAbrirColab: n => abiertos.push(decodeURIComponent(n)),
        _vacCalPopupOutside: () => {},
        bootstrap: { Modal: function () { return { show() {} }; } },
    };
    // eslint-disable-next-line no-new-func
    const api = new Function(...Object.keys(entorno), `let _vacCalDayMap = {};\n${codigo}\nreturn { vacCalCargar, vacCalFiltrar, vacCalModo, vacCalMover, vacCalAgrupar, _vacVista, _vacTramos, _vacNivel, _vacLlenarAnios };`)(...Object.values(entorno));
    api._vacLlenarAnios(document.getElementById('vac-cal-anio-filter'));
    return { api, abiertos };
}

describe('vista global de vacaciones', () => {
    let api; let abiertos;
    beforeEach(async () => {
        ({ api, abiertos } = montar());
        api._vacVista.modo = 'mes';
        api._vacVista.mes = MES;
        await api.vacCalCargar();
    });

    test('los indicadores cuentan a quien está fuera hoy y no suman cancelados', () => {
        const resumen = document.getElementById('vac-cal-resumen').textContent.replace(/\s+/g, ' ');
        expect(resumen).toMatch(/1\s*persona De vacaciones hoy/);
        // Cancelado fuera; medio militar cuenta como período pero no descuenta días
        expect(resumen).toMatch(/2\s*períodos Registrados en \d{4} 2 personas · 3 días a cuenta/);
    });

    test('el filtro de área ofrece las subdirecciones con cuántas personas tienen registros', () => {
        const opciones = [...document.querySelectorAll('#vac-cal-area-filter option')].map(o => o.textContent);
        expect(opciones).toContain('Subdirección de Ingeniería (1)');
        expect(opciones).toContain('Subdirección de Seguridad Operacional (1)');
    });

    test('por mes: una fila por persona, sin cancelados, nombres escapados', () => {
        const grid = document.getElementById('vac-cal-grid');
        const filas = grid.querySelectorAll('.vtl-persona');
        expect(filas).toHaveLength(2);
        expect(grid.innerHTML).toContain('Luis &lt;Gómez&gt;');
        expect(grid.querySelector('.vtl-bar.e-cancelado')).toBeNull();
        expect(grid.querySelector('.vtl-bar.t-permiso')).not.toBeNull();   // medio militar en morado
        expect(document.getElementById('vac-cal-count').textContent).toMatch(/2 períodos · 2 personas/);
    });

    test('clic en el nombre abre la ficha del colaborador', () => {
        document.querySelector('.vtl-name[data-num="202"]').click();
        expect(abiertos).toEqual(['202']);
    });

    test('gantt: agrupa por área, con su conteo, y se puede plegar', () => {
        const grid = document.getElementById('vac-cal-grid');
        const grupos = [...grid.querySelectorAll('.vtl-grupo')];
        expect(grupos.map(g => g.querySelector('.vtl-grupo-nom').textContent)).toEqual(
            expect.arrayContaining(['Ingeniería', 'Seguridad Operacional']));
        const ing = grupos.find(g => g.textContent.includes('Ingeniería'));
        expect(ing.querySelector('.vtl-grupo-n').textContent).toBe('1');
        ing.click();
        expect(grid.querySelectorAll('.vtl-persona')).toHaveLength(1);
        expect(grid.querySelector('.vtl-grupo.plegado')).not.toBeNull();
        api.vacCalAgrupar();
        expect(grid.querySelector('.vtl-grupo')).toBeNull();
        expect(grid.querySelectorAll('.vtl-persona')).toHaveLength(2);
        api.vacCalAgrupar();
    });

    test('gantt: una barra por período; los días que no cuentan van rayados', () => {
        const barra = document.querySelector('.vtl-bar.t-permiso');
        // Período del 1 al 2 sin lista de días: los dos cuentan
        expect(barra.querySelectorAll('.vtl-segs .on')).toHaveLength(2);
        expect(barra.dataset.a).toBe('0');
        expect(barra.dataset.n).toBe('2');
    });

    test('clic en una barra abre quién falta ese día', () => {
        const barra = document.querySelector('.vtl-bar.t-permiso');
        barra.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0 }));
        expect(document.getElementById('vdp-title').textContent).toMatch(/persona/);
    });

    test('el estado "Cancelados" muestra solo los cancelados', () => {
        document.getElementById('vac-cal-estado-filter').value = 'cancelado';
        api.vacCalFiltrar();
        const grid = document.getElementById('vac-cal-grid');
        expect(grid.querySelectorAll('.vtl-bar').length).toBe(1);
        expect(grid.querySelector('.vtl-bar.e-cancelado')).not.toBeNull();
    });

    test('lista: agrupada por mes, con días, estado y oficio', () => {
        api.vacCalModo('lista');
        const tabla = document.querySelector('#vac-cal-grid table');
        expect(tabla).not.toBeNull();
        expect(tabla.querySelector('.vls-mes').textContent).toMatch(/2 períodos · 2 personas/);
        expect(tabla.textContent).toContain('Medio militar');
        expect(tabla.textContent).toContain('1234');
    });

    test('año: mapa de calor con días clicables', () => {
        api.vacCalModo('anio');
        const dias = document.querySelectorAll('#vac-cal-grid .vac-day.heat[data-key]');
        expect(dias.length).toBeGreaterThanOrEqual(3);
        expect(document.getElementById('vac-cal-mesnav').style.display).toBe('none');
    });

    test('las flechas pasan de diciembre a enero cambiando el año', () => {
        const sel = document.getElementById('vac-cal-anio-filter');
        sel.value = String(ANIO - 1);
        api._vacVista.mes = 11;
        api.vacCalMover(1);
        expect(sel.value).toBe(String(ANIO));
        expect(api._vacVista.mes).toBe(0);
    });
});

describe('ayudas de la vista', () => {
    const { api } = montar();

    test('un fin de semana o un festivo no corta un tramo; un día hábil sí', () => {
        // 30 Oct 2026 es viernes; 2 Nov lunes
        expect(api._vacTramos(['2026-10-29', '2026-10-30', '2026-11-02'])).toEqual(['29 Oct – 2 Nov']);
        // 16 Sep 2026 es festivo (miércoles)
        expect(api._vacTramos(['2026-09-15', '2026-09-17'])).toEqual(['15 Sep – 17 Sep']);
        expect(api._vacTramos(['2026-04-23', '2026-04-28'])).toEqual(['23 Abr', '28 Abr']);
    });

    test('la intensidad es relativa al día más cargado', () => {
        expect(api._vacNivel(0, 20)).toBe(0);
        expect(api._vacNivel(1, 20)).toBe(1);
        expect(api._vacNivel(10, 20)).toBe(2);
        expect(api._vacNivel(20, 20)).toBe(4);
        expect(api._vacNivel(1, 1)).toBe(4);
    });
});
