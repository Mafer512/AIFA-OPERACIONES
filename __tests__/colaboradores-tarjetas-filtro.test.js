/**
 * @jest-environment jsdom
 *
 * Las tarjetas del Resumen del Directorio dejaron de ser un número quieto: cada
 * una abre justo lo que cuenta. Las de personas (total, hombres, mujeres) listan
 * a esas personas; las de categorías (direcciones, subdirecciones, profesiones,
 * gerencias) listan las categorías con su gente, y desde ahí se entra a
 * cualquiera y se puede volver.
 *
 * Se ejercitan las funciones reales de index.html sobre un directorio de prueba.
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

// El modal (estado, aperturas y pintado) y el cableado de las tarjetas.
const CODIGO_MODAL = trozo('let _grupoModalRecords = [];', '}   /* -- fin colabRenderDashboard -- */');
const CODIGO_TARJETAS = trozo('const _policy = window.ColaboradoresDirectoryPolicy;', 'const _kpiRow =');
const MARCADO_KPIS = trozo('<div class="cd-kpi-row">', '<!-- Fila de gráficas -->');
const MARCADO_MODAL = trozo('<div id="colab-grupo-modal-backdrop"', '<!-- -- MODAL EDITAR COLABORADOR -- -->');

const DIRECTORIO = [
    { num: '1', nombre: 'Ana Robles', sexo: 'Femenino', direccion: 'Dirección de Operación', gerencia: 'GOPA', profesion: 'Ing. Aeronáutica' },
    { num: '2', nombre: 'Beto Cruz', sexo: 'Masculino', direccion: 'Dirección de Operación', gerencia: 'GOPA', profesion: 'Ing. Industrial' },
    { num: '3', nombre: 'Carla Díaz', sexo: 'Femenino', direccion: 'Dirección de Operación', gerencia: 'GSO', profesion: 'Ing. Industrial' },
    { num: '4', nombre: 'Dario Luna', sexo: 'Masculino', direccion: 'Dirección de Administración', gerencia: 'GA', profesion: '' },
    { num: '5', nombre: 'Elsa Mora', sexo: '', direccion: '', gerencia: 'GA', profesion: 'Contaduría' },
];

function montar() {
    document.body.innerHTML = MARCADO_KPIS + '</div>' + MARCADO_MODAL + '</div>';

    const ctx = {
        document,
        gc: (registro, clave) => registro[clave],
        val: v => (v == null ? '' : String(v)),
        colabCache: DIRECTORIO,
        colabDirectoryUniverse: { included: DIRECTORIO },
        colabObtenerUniversoDirectorio: () => ({ included: DIRECTORIO }),
        data: DIRECTORIO,
    };
    ctx.window = ctx;
    ctx.ColaboradoresDirectoryPolicy = policy;
    vm.createContext(ctx);
    vm.runInContext(CODIGO_MODAL + '\n' + CODIGO_TARJETAS, ctx);

    // Los onclick del marcado real se resuelven contra el window de jsdom, no
    // contra el contexto del vm: ahí se publican las funciones que necesitan.
    ['colabGrupoModalClose', 'colabGrupoModalVolver', 'colabGrupoModalFiltrar',
     'colabAbrirGrupoModal', 'colabAbrirCategoriasModal', 'colabAbrirDesdeGrupoModal',
     'colabKpiFiltro'].forEach(nombre => {
        if (typeof ctx[nombre] === 'function') global[nombre] = ctx[nombre];
    });
    return ctx;
}

const titulo = () => document.getElementById('colab-grupo-modal-title').textContent;
const filas = () => [...document.querySelectorAll('#colab-grupo-modal-list .colab-grupo-item')];
const abierto = () => document.getElementById('colab-grupo-modal-backdrop').classList.contains('open');

describe('las tarjetas del resumen abren lo que cuentan', () => {
    test('las siete son botones de verdad, no números quietos', () => {
        montar();
        const tarjetas = [...document.querySelectorAll('.cd-kpi-row .cd-kpi[data-kpi]')];
        expect(tarjetas.map(t => t.dataset.kpi)).toEqual([
            'total', 'hombres', 'mujeres', 'direccion', 'subdireccion', 'profesion', 'gerencia',
        ]);
        tarjetas.forEach(t => {
            expect(t.getAttribute('role')).toBe('button');
            expect(t.getAttribute('tabindex')).toBe('0');
        });
    });

    test('Total abre a todo el personal del resumen', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('total');
        expect(abierto()).toBe(true);
        expect(titulo()).toBe('Total de colaboradores (5)');
        expect(filas()).toHaveLength(5);
    });

    test('Hombres y Mujeres reparten con el mismo criterio que el conteo', () => {
        const ctx = montar();

        ctx.colabKpiFiltro('hombres');
        expect(titulo()).toBe('Hombres (2)');
        expect(filas().map(f => f.textContent)).toEqual(
            expect.arrayContaining([expect.stringContaining('Beto Cruz')]));

        ctx.colabKpiFiltro('mujeres');
        expect(titulo()).toBe('Mujeres (2)');

        // Y quien no tiene sexo capturado no se cuela en ninguna de las dos.
        ctx.colabKpiFiltro('sin-sexo');
        expect(titulo()).toBe('Sin sexo capturado (1)');
        expect(filas()[0].textContent).toContain('Elsa Mora');
    });

    test('la lista se recalcula al abrirla, no al pintar el resumen', () => {
        // Si alguien corrige el sexo en la ficha, la tarjeta no puede seguir
        // mostrando a esa persona en la lista de antes.
        const ctx = montar();
        ctx.colabKpiFiltro('hombres');
        expect(titulo()).toBe('Hombres (2)');

        const original = DIRECTORIO[1].sexo;
        try {
            DIRECTORIO[1].sexo = 'Femenino';
            ctx.colabKpiFiltro('hombres');
            expect(titulo()).toBe('Hombres (1)');
            ctx.colabKpiFiltro('mujeres');
            expect(titulo()).toBe('Mujeres (3)');
        } finally {
            DIRECTORIO[1].sexo = original;
        }
    });

    test('la lista sale ordenada por nombre', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('total');
        const nombres = filas().map(f => f.querySelector('.colab-grupo-item-name').textContent);
        expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
    });
});

describe('las tarjetas de categorías', () => {
    test('listan cada categoría con su gente, de mayor a menor', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('direccion');

        expect(titulo()).toBe('Direcciones (2)');
        const textos = filas().map(f => f.textContent.replace(/\s+/g, ' ').trim());
        expect(textos[0]).toContain('Dirección de Operación');
        expect(textos[0]).toContain('3');
        expect(textos[1]).toContain('Dirección de Administración');
    });

    test('quien no tiene el dato capturado aparece aparte, sin inflar el conteo', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('direccion');

        const sinDato = document.querySelector('#colab-grupo-modal-list .colab-grupo-item.sin-dato');
        expect(sinDato).not.toBeNull();
        expect(sinDato.textContent).toContain('Sin dirección registrada');
        // El título sigue diciendo 2: las direcciones reales.
        expect(titulo()).toBe('Direcciones (2)');
    });

    test('al entrar a una categoría se ve su gente y queda el camino de vuelta', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('gerencia');
        expect(titulo()).toBe('Gerencias (3)');
        expect(document.getElementById('colab-grupo-modal-back').classList.contains('d-none')).toBe(true);

        filas().find(f => f.dataset.cat === 'GOPA').click();
        expect(titulo()).toBe('GOPA (2)');
        expect(document.getElementById('colab-grupo-modal-back').classList.contains('d-none')).toBe(false);

        ctx.colabGrupoModalVolver();
        expect(titulo()).toBe('Gerencias (3)');
    });

    test('el buscador del modal filtra categorías, no colaboradores', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('profesion');
        expect(filas().length).toBeGreaterThan(1);

        ctx.colabGrupoModalFiltrar('industrial');
        const textos = filas().map(f => f.textContent);
        expect(textos.filter(t => t.includes('Ing. Industrial'))).toHaveLength(1);
        expect(textos.some(t => t.includes('Contaduría'))).toBe(false);
    });

    test('cerrar el modal no deja pendiente el camino de vuelta', () => {
        const ctx = montar();
        ctx.colabKpiFiltro('gerencia');
        filas().find(f => f.dataset.cat === 'GA').click();
        expect(document.getElementById('colab-grupo-modal-back').classList.contains('d-none')).toBe(false);

        ctx.colabGrupoModalClose();
        expect(abierto()).toBe(false);
        expect(document.getElementById('colab-grupo-modal-back').classList.contains('d-none')).toBe(true);
    });
});
