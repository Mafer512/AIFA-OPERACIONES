/**
 * @jest-environment jsdom
 *
 * Tablero de mando en el Inicio: directores, subdirectores y gerentes ven, sin
 * entrar al módulo, lo vencido, lo que vence pronto, lo detenido y dónde está,
 * sólo de su parte de la Dirección (y pueden ampliar la vista).
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

function iso(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const HOY = iso(0);
const t = (o) => Object.assign({ id: o.titulo, folio: 1, tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', aviso_dias: 7, recurrencia: 'ninguna', checklist: [], evidencias: [], etiquetas: [] }, o);

const TAREAS = [
    t({ id: 'v1', folio: 1, titulo: 'Antena VHF', subdireccion: 'SSO', gerencia: 'Gerencia de Seguridad Operacional', responsable: 'Luis García', fecha_limite: iso(-3) }),
    t({ id: 'v2', folio: 2, titulo: 'Plan de fauna', subdireccion: 'SSO', gerencia: 'Gerencia de Operaciones Parte Aeronáutica', fecha_limite: iso(-1), prioridad: 'urgente' }),
    t({ id: 'h1', folio: 3, titulo: 'Oficio hoy', subdireccion: 'SI', fecha_limite: HOY }),
    t({ id: 'd1', folio: 4, titulo: 'Licitación', subdireccion: 'SSO', gerencia: 'Gerencia de Seguridad Operacional', estatus: 'detenida', fecha_limite: iso(40) }),
    t({ id: 'p1', folio: 5, titulo: 'Licencia IFT', subdireccion: 'SSO', gerencia: 'Gerencia de Seguridad Operacional', tipo: 'certificado', fecha_limite: iso(4) }),
    t({ id: 'r1', folio: 6, titulo: 'Certificado de aeródromo', subdireccion: 'SI', tipo: 'renovacion', fecha_limite: iso(60) }),
    t({ id: 'ok', folio: 7, titulo: 'A tiempo', subdireccion: 'SSA', fecha_limite: iso(30) }),
    t({ id: 'c1', folio: 8, titulo: 'Cerrada', subdireccion: 'SSO', estatus: 'completada', fecha_limite: iso(-10), completada_en: iso(-12) + 'T10:00:00' }),
];

describe('a quién le toca qué', () => {
    test('el área del usuario define su vista', () => {
        expect(C.alcanceDeArea({ clave: 'SD-SO', nombre: 'Subdirección de Seguridad Operacional' }, 'editor')).toEqual({ tipo: 'subdireccion', subdireccion: 'SSO', gerencia: null });
        expect(C.alcanceDeArea({ clave: 'GSO', nombre: 'Gerencia de Seguridad Operacional' }, 'lector'))
            .toEqual({ tipo: 'gerencia', subdireccion: 'SSO', gerencia: 'Gerencia de Seguridad Operacional' });
        // Gerencia fuera del catálogo: toma la subdirección de arriba.
        expect(C.alcanceDeArea({ clave: 'GX', nombre: 'Gerencia nueva', padre: { clave: 'SD-ING', nombre: 'Subdirección de Ingeniería' } }, 'editor').subdireccion).toBe('SI');
        // Dirección, Director General y administradores: todo.
        expect(C.alcanceDeArea({ clave: 'DO', nombre: 'Dirección de Operación' }, 'editor').tipo).toBe('todo');
        expect(C.alcanceDeArea({ clave: 'GSO', nombre: 'Gerencia de Seguridad Operacional' }, 'director_general').tipo).toBe('todo');
        expect(C.alcanceDeArea(null, 'editor').tipo).toBe('todo');
    });

    test('un gerente puede ampliar a su subdirección y a toda la Dirección', () => {
        const g = C.alcanceDeArea({ clave: 'GSO', nombre: 'Gerencia de Seguridad Operacional' }, '');
        expect(C.alcancesPosibles(g).map(a => a.tipo)).toEqual(['gerencia', 'subdireccion', 'todo']);
        expect(C.filtrarAlcance(TAREAS, g).map(x => x.id)).toEqual(['v1', 'd1', 'p1']);
        expect(C.filtrarAlcance(TAREAS, C.alcancesPosibles(g)[1]).map(x => x.id)).toEqual(['v1', 'v2', 'd1', 'p1', 'c1']);
    });
});

describe('lo que se lee en el tablero', () => {
    test('primero lo vencido (el más atrasado arriba), luego hoy, detenidas y por vencer', () => {
        const r = C.resumenMando(TAREAS, HOY);
        expect(r.atencion.map(x => x.tarea.id)).toEqual(['v1', 'v2', 'h1', 'd1', 'p1']);
        expect(r).toMatchObject({ vencidas: 2, detenidas: 1, abiertas: 7 });
        expect(r.semana).toBe(2);   // hoy y en 4 días
        expect(r.renovaciones.map(x => x.tarea.id)).toEqual(['p1', 'r1']);
        expect(r.cumplimiento).toBe(100);
    });

    test('semáforo por subdirección, por gerencia o por responsable según la vista', () => {
        const todo = C.desgloseMando(TAREAS, { tipo: 'todo' }, HOY);
        expect(todo.find(d => d.clave === 'SSO')).toMatchObject({ abiertas: 4, vencidas: 2, porVencer: 1, nivel: 'rojo' });
        expect(todo.find(d => d.clave === 'SSA')).toMatchObject({ abiertas: 1, nivel: 'verde' });
        expect(todo.find(d => d.clave === 'SGE')).toMatchObject({ abiertas: 0, nivel: 'vacio' });
        const sub = C.desgloseMando(TAREAS, { tipo: 'subdireccion', subdireccion: 'SI' }, HOY);
        expect(sub.find(d => d.nombre === 'Toda la subdirección')).toMatchObject({ abiertas: 2, porVencer: 1, nivel: 'ambar' });
        const ger = C.desgloseMando(TAREAS, { tipo: 'gerencia', subdireccion: 'SSO', gerencia: 'Gerencia de Seguridad Operacional' }, HOY);
        expect(ger.map(d => d.nombre)).toEqual(['Luis García', 'Sin responsable']);
    });
});

/* ---------- En el Inicio ---------- */
function fakeSupabase(db) {
    return {
        rpc: async () => ({ data: 'editor', error: null }),
        from(tabla) {
            const filtros = [];
            const api = {
                select() { return api; }, order() { return api; }, limit() { return api; },
                eq(c, v) { filtros.push([c, v]); return api; },
                then(ok) { return Promise.resolve({ data: (db[tabla] || []).filter(r => filtros.every(([c, v]) => r[c] === v)), error: null }).then(ok); },
            };
            return api;
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {},
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: 'gerente@aifa.operaciones', user_metadata: {} } } } }) },
        storage: { from() { return {}; } },
    };
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 20)); };

describe('el panel en el Inicio', () => {
    beforeAll(async () => {
        document.body.className = 'navdeck-mode';
        document.body.innerHTML = `
            <nav id="sidebar-nav">
              <a class="menu-item" href="#" data-section="conciliacion">Conciliación</a>
              <div class="si-sep"></div>
              <a class="menu-item" href="#" data-section="seguimiento" id="menu-seguimiento" style="display:none;">Seguimiento</a>
            </nav>
            <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
        sessionStorage.setItem('user_area', 'GSO');
        sessionStorage.setItem('user_role', 'editor');
        window.supabaseClient = fakeSupabase({
            seguimiento_tareas: TAREAS, seguimiento_comentarios: [],
            areas: [{ id: 'a9', clave: 'GSO', nombre: 'Gerencia de Seguridad Operacional', nivel: 3, parent_area_id: 'a2' },
                    { id: 'a2', clave: 'SD-SO', nombre: 'Subdirección de Seguridad Operacional', nivel: 2 }],
        });
        window.showSection = jest.fn();
        new Function(leer('js/seguimiento.js'))();
        await esperar(20);
    });

    const panel = () => document.getElementById('seg-mando');

    const area = () => panel().querySelector('.seg-mando-titulo small').textContent;

    test('es una barra compacta en el Inicio, antes de las Subdirecciones; el detalle va cerrado', () => {
        expect(panel()).not.toBeNull();
        expect(panel().hidden).toBe(false);
        expect(panel().nextElementSibling.classList.contains('si-sep')).toBe(true);
        expect(panel().querySelector('#seg-mando-t').textContent).toBe('Pendientes');
        expect(area()).toBe('Gerencia de Seguridad Operacional');
        // En la barra sólo van las cifras que importan, como chips.
        const chips = [...panel().querySelectorAll('.seg-mando-chip')].map(c => c.textContent);
        expect(chips).toEqual(['1vencida', '1vence esta semana', '1detenida']);
        expect(panel().querySelector('#seg-mando-pop').hidden).toBe(true);
    });

    test('«Ver detalle» despliega lo que requiere atención', async () => {
        panel().querySelector('.seg-mando-toggle').click();
        await esperar(2);
        expect(panel().querySelector('#seg-mando-pop').hidden).toBe(false);
        expect(panel().querySelector('.seg-mando-toggle').textContent).toContain('Ocultar');
        const filas = [...panel().querySelectorAll('.seg-mando-fila .seg-mando-nom')].map(f => f.textContent);
        expect(filas).toEqual(['SEG-0001Antena VHF', 'SEG-0004Licitación', 'SEG-0005Licencia IFT']);
        expect(panel().querySelector('.seg-mando-fila .seg-mando-estado').textContent).toBe('3 días de atraso');
        // El globo del menú cuenta las vencidas de su área.
        expect(document.querySelector('#menu-seguimiento .seg-insignia').textContent).toBe('1');
    });

    test('puede ampliar la vista a su subdirección o a toda la Dirección', async () => {
        const botones = [...panel().querySelectorAll('[data-mando="alcance"]')];
        expect(botones.map(b => b.textContent)).toEqual(['Mi gerencia', 'Mi subdirección', 'Toda la Dirección']);
        botones[2].click();
        await esperar(2);
        expect(area()).toBe('Dirección de Operación');
        expect(panel().querySelectorAll('.seg-mando-sem')).toHaveLength(6);   // semáforo por subdirección
        expect(panel().querySelectorAll('.seg-mando-luz-btn')).toHaveLength(6);  // y en luces dentro de la barra
        expect(panel().querySelector('[data-filtro="vencida"] b').textContent).toBe('2');
        // El detalle sigue abierto al cambiar de vista.
        expect(panel().querySelector('#seg-mando-pop').hidden).toBe(false);
    });

    test('«Ver» abre la tarea encima del Inicio y los indicadores llevan a Seguimiento filtrado', async () => {
        panel().querySelector('[data-mando="ver"]').click();
        await esperar(4);
        expect(document.getElementById('seg-drawer').classList.contains('is-open')).toBe(true);
        expect(document.getElementById('seg-dr-titulo').value).toBe('Antena VHF');
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();

        const clic = jest.fn(e => e.preventDefault());
        document.getElementById('menu-seguimiento').addEventListener('click', clic);
        panel().querySelector('[data-filtro="vencida"]').click();
        expect(clic).toHaveBeenCalled();
    });

    test('se esconde al abrir cualquier sección (sólo vive en el Inicio)', () => {
        const css = leer('seguimiento.css');
        expect(css).toContain('body.navdeck-active #seg-mando');
        expect(css).toContain('body:not(.navdeck-mode) #seg-mando');
    });
});
