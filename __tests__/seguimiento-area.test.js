/**
 * @jest-environment jsdom
 *
 * Seguimiento por áreas: cada cuenta ve, crea y responde sólo las tareas de su
 * área. Un subdirector, todo lo de su subdirección; un gerente, lo de su
 * gerencia y lo que es de toda su subdirección, nada de otras gerencias. La
 * regla es la misma que aplica la base (db/seguimiento_alcance_por_area.sql).
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

const GSO = 'Gerencia de Seguridad Operacional';
const MED = 'Gerencia de Servicios Médicos';

describe('la regla del área', () => {
    const gerente = C.alcanceDeAcceso({ rol: 'editor', subdireccion: 'SSO', gerencia: GSO });
    const subdirector = C.alcanceDeAcceso({ rol: 'editor', subdireccion: 'SSO', gerencia: null });

    test('cada cuenta tiene su alcance; admin o sin área, toda la Dirección', () => {
        expect(gerente).toEqual({ tipo: 'gerencia', subdireccion: 'SSO', gerencia: GSO });
        expect(subdirector).toEqual({ tipo: 'subdireccion', subdireccion: 'SSO', gerencia: null });
        expect(C.alcanceDeAcceso({ rol: 'admin', subdireccion: 'SSO', gerencia: GSO }).tipo).toBe('todo');
        expect(C.alcanceDeAcceso({ rol: 'lector' }).tipo).toBe('todo');
        expect(C.alcanceDeAcceso({ rol: 'editor', subdireccion: 'XX' }).tipo).toBe('todo');
    });

    test('el gerente: su gerencia y lo de toda la subdirección, nunca otra gerencia', () => {
        expect(C.dentroDeAlcance(gerente, 'SSO', GSO)).toBe(true);
        expect(C.dentroDeAlcance(gerente, 'SSO', 'gerencia de seguridad operacional ')).toBe(true);
        expect(C.dentroDeAlcance(gerente, 'SSO', '')).toBe(true);
        expect(C.dentroDeAlcance(gerente, 'SSO', null)).toBe(true);
        expect(C.dentroDeAlcance(gerente, 'SSO', MED)).toBe(false);
        expect(C.dentroDeAlcance(gerente, 'SI', '')).toBe(false);
    });

    test('el subdirector: todo lo de su subdirección', () => {
        expect(C.dentroDeAlcance(subdirector, 'SSO', MED)).toBe(true);
        expect(C.dentroDeAlcance(subdirector, 'SSO', '')).toBe(true);
        expect(C.dentroDeAlcance(subdirector, 'SSA', '')).toBe(false);
    });

    test('lo que puede elegir al crear o editar', () => {
        expect(C.subdireccionesPermitidas(gerente)).toEqual(['SSO']);
        expect(C.subdireccionesPermitidas(C.ALCANCE_DIRECCION)).toHaveLength(6);
        expect(C.gerenciasPermitidas(gerente, 'SSO')).toEqual({ opciones: ['', GSO], libre: false });
        expect(C.gerenciasPermitidas(subdirector, 'SSO').opciones).toEqual([''].concat(C.SUBDIR.SSO.gerencias));
        expect(C.gerenciasPermitidas(subdirector, 'SI').opciones).toEqual([]);
        expect(C.nombreAlcanceArea(gerente)).toBe(GSO);
        expect(C.nombreAlcanceArea(subdirector)).toBe('Subdirección de Seguridad Operacional');
    });

    test('la base usa la misma regla, para leer, crear, editar, comentar y subir evidencias', () => {
        const sql = leer('db/seguimiento_alcance_por_area.sql');
        expect(sql).toMatch(/seguimiento_tareas_select[\s\S]*?seguimiento_en_alcance\(subdireccion, gerencia\)/);
        expect(sql).toMatch(/seguimiento_tareas_insert[\s\S]*?WITH CHECK \(public\.seguimiento_puede_editar\(\) AND public\.seguimiento_en_alcance/);
        expect(sql).toMatch(/seguimiento_tareas_update[\s\S]*?USING[\s\S]*?seguimiento_en_alcance[\s\S]*?WITH CHECK[\s\S]*?seguimiento_en_alcance/);
        expect(sql).toMatch(/seguimiento_comentarios_insert[\s\S]*?seguimiento_tarea_en_alcance\(tarea_id\)/);
        expect(sql).toMatch(/seguimiento_evidencias_insert[\s\S]*?seguimiento_ruta_en_alcance\(name\)/);
    });
});

describe('el área sugerida desde Colaboradores', () => {
    const persona = o => Object.assign({
        'No. Empleado': '1', 'Nombre': 'Juan Pérez López', 'Puesto': 'Analista',
        'Subdirección': 'Subdirección de Seguridad Operacional', 'Gerencia': GSO,
        'Personal comisionado': '0', 'Subdirección comisionado': '', 'Gerencia comisionado': '', 'Estatus': 'Activo',
    }, o);

    test('por puesto: Director, subdirector, gerente o su gente', () => {
        expect(C.areaDeColaborador(persona({ Puesto: 'Director de Operación' }))).toMatchObject({ subdireccion: null, gerencia: null });
        expect(C.areaDeColaborador(persona({ Puesto: 'Subdirector de Seguridad Operacional' }))).toMatchObject({ subdireccion: 'SSO', gerencia: null });
        expect(C.areaDeColaborador(persona({ Puesto: 'Gerente de Seguridad Operacional' }))).toMatchObject({ subdireccion: 'SSO', gerencia: GSO, motivo: 'Gerente' });
        expect(C.areaDeColaborador(persona())).toMatchObject({ subdireccion: 'SSO', gerencia: GSO });
    });

    test('si está comisionado, cuenta donde trabaja', () => {
        const a = C.areaDeColaborador(persona({ 'Personal comisionado': 'Sí', 'Subdirección comisionado': 'Subdirección de Ingeniería', 'Gerencia comisionado': 'Gerencia de Ingeniería Civil' }));
        expect(a).toMatchObject({ subdireccion: 'SI', gerencia: 'Gerencia de Ingeniería Civil' });
        expect(a.motivo).toContain('comisionado');
    });

    test('no confunde gerencias parecidas ni inventa áreas', () => {
        // «Gerencia de Seguridad» es de Seguridad de la Aviación, no la «… Operacional».
        expect(C.areaDeColaborador(persona({ 'Subdirección': 'Subdirección de Seguridad de la Aviación', 'Gerencia': 'Gerencia de Seguridad' })))
            .toMatchObject({ subdireccion: 'SSA', gerencia: 'Gerencia de Seguridad' });
        // Gerencia fuera del catálogo: se queda en la subdirección.
        expect(C.areaDeColaborador(persona({ 'Gerencia': 'Gerencia inventada' }))).toMatchObject({ subdireccion: 'SSO', gerencia: null });
        expect(C.areaDeColaborador(persona({ 'Subdirección': '', 'Gerencia': '' }))).toBeNull();
        // Sólo la gerencia: de ahí sale la subdirección.
        expect(C.areaDeColaborador(persona({ 'Subdirección': '', 'Gerencia': 'Gerencia de Carga' }))).toMatchObject({ subdireccion: 'SSC', gerencia: 'Gerencia de Carga' });
    });

    test('encuentra a la persona de cada cuenta por nombre o por usuario, sin adivinar', () => {
        const filas = [persona(), persona({ 'Nombre': 'Ana Ruiz Soto' }), persona({ 'Nombre': 'Ana Ruiz Mena' }), persona({ 'Nombre': 'Pedro Gil', 'Estatus': 'Baja' })];
        expect(C.colaboradorDeCuenta({ email: 'x@aifa.operaciones', nombre: 'Juan Perez Lopez' }, filas)['Nombre']).toBe('Juan Pérez López');
        expect(C.colaboradorDeCuenta({ email: 'juan.perez@aifa.operaciones' }, filas)['Nombre']).toBe('Juan Pérez López');
        expect(C.colaboradorDeCuenta({ email: 'ana.ruiz@aifa.operaciones' }, filas)).toBeNull();   // hay dos
        expect(C.colaboradorDeCuenta({ email: 'pedro.gil@aifa.operaciones' }, filas)).toBeNull();  // de baja
    });
});

/* ---------- En la página, con la cuenta de un gerente ---------- */
function fakeSupabase(db, sesionEmail) {
    const llamadas = [];
    let folio = 100;
    function correr(q) {
        llamadas.push(q);
        const filas = db[q.tabla] || (db[q.tabla] = []);
        const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
        if (q.op === 'insert') {
            const nueva = Object.assign({ id: 'n' + (++folio), folio, estatus: 'pendiente', prioridad: 'normal', tipo: 'orden', recurrencia: 'ninguna', aviso_dias: 7, checklist: [], evidencias: [], etiquetas: [] }, q.datos);
            filas.push(nueva);
            return { data: Object.assign({}, nueva), error: null };
        }
        if (q.op === 'update') {
            const hits = filas.filter(coincide);
            hits.forEach(r => Object.assign(r, q.datos));
            return { data: q.uno ? (hits[0] ? Object.assign({}, hits[0]) : null) : hits, error: null };
        }
        const data = filas.filter(coincide).map(r => Object.assign({}, r));
        return { data: q.uno ? data[0] || null : data, error: null };
    }
    return {
        llamadas,
        rpc: async () => ({ data: 'editor', error: null }),
        from(tabla) {
            const q = { tabla, op: 'select', filtros: [], datos: null, uno: false };
            const api = {
                select() { return api; }, order() { return api; }, limit() { return api; },
                eq(c, v) { q.filtros.push([c, v]); return api; },
                insert(d) { q.op = 'insert'; q.datos = d; return api; },
                update(d) { q.op = 'update'; q.datos = d; return api; },
                single() { q.uno = true; return api; }, maybeSingle() { q.uno = true; return api; },
                then(ok, mal) { return Promise.resolve(correr(q)).then(ok, mal); },
            };
            return api;
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {},
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: sesionEmail, user_metadata: {} } } } }) },
        storage: { from() { return {}; } },
    };
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 20)); };
const tarea = o => Object.assign({ folio: 1, tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', aviso_dias: 7, recurrencia: 'ninguna', checklist: [], evidencias: [], etiquetas: [] }, o);

describe('un gerente en Seguimiento', () => {
    let db;
    let sb;
    beforeAll(async () => {
        document.body.innerHTML = `
            <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
            <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
        db = {
            seguimiento_acceso: [{ email: 'gerente.gso@aifa.operaciones', nombre: 'Gerente GSO', rol: 'editor', subdireccion: 'SSO', gerencia: GSO }],
            // Lo que entregaría la base; la página además lo filtra por si acaso.
            seguimiento_tareas: [
                tarea({ id: 'g1', folio: 1, titulo: 'Simulacro de pista', subdireccion: 'SSO', gerencia: GSO }),
                tarea({ id: 's1', folio: 2, titulo: 'Programa anual de la subdirección', subdireccion: 'SSO', gerencia: null }),
                tarea({ id: 'm1', folio: 3, titulo: 'Botiquines', subdireccion: 'SSO', gerencia: MED }),
                tarea({ id: 'i1', folio: 4, titulo: 'Bacheo', subdireccion: 'SI', gerencia: null }),
            ],
            seguimiento_comentarios: [], seguimiento_actividad: [], agenda_2026: [],
        };
        sb = fakeSupabase(db, 'gerente.gso@aifa.operaciones');
        window.supabaseClient = sb;
        window.showSection = jest.fn();
        new Function(leer('js/seguimiento.js'))();
        await esperar();
        document.getElementById('seguimiento-section').classList.add('active');
        await esperar();
    });

    const ids = () => [...document.querySelectorAll('#seg-body .seg-row[data-id]')].map(r => r.dataset.id);

    test('sólo ve lo de su gerencia y lo de toda su subdirección', () => {
        expect(ids().sort()).toEqual(['g1', 's1']);
        // Un solo grupo: su subdirección.
        expect([...document.querySelectorAll('#seg-body input[data-add]')].map(i => i.dataset.add)).toEqual(['SSO']);
    });

    test('en lugar de los chips de subdirecciones, la etiqueta de su área', () => {
        const chips = document.getElementById('seg-chips');
        expect(chips.querySelectorAll('[data-sd]')).toHaveLength(0);
        expect(chips.querySelector('.seg-area-tag').textContent).toContain(GSO);
        expect(chips.querySelector('.seg-area-tag').textContent).toContain('Seguridad Operacional');
    });

    test('lo que escribe en la captura rápida va a su gerencia', async () => {
        const input = document.querySelector('#seg-body input[data-add="SSO"]');
        input.value = 'Revisión de señalización';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await esperar();
        const nueva = db.seguimiento_tareas.find(t => t.titulo === 'Revisión de señalización');
        expect(nueva).toMatchObject({ subdireccion: 'SSO', gerencia: GSO });
    });

    test('una tarea nueva ya trae su subdirección y su gerencia, y sólo puede elegir esas', async () => {
        document.getElementById('seg-btn-nueva').click();
        await esperar(3);
        expect(document.querySelector('#seg-drawer [data-dr="subdireccion"]').textContent).toContain('Seguridad Operacional');
        expect(document.querySelector('#seg-drawer [data-dr="gerencia"]').textContent).toContain(GSO);

        document.querySelector('#seg-drawer [data-dr="subdireccion"]').click();
        expect([...document.querySelectorAll('#seg-menu .seg-menu-item[data-i]')].map(b => b.textContent.trim())).toEqual(['Subdirección de Seguridad Operacional']);
        document.querySelector('#seg-drawer [data-dr="gerencia"]').click();
        const opciones = [...document.querySelectorAll('#seg-menu .seg-menu-item[data-i]')].map(b => b.textContent.trim());
        expect(opciones).toEqual(['Sin gerencia (toda la subdirección)', GSO]);
        // No puede escribir otra gerencia a mano.
        expect(document.querySelector('#seg-menu .seg-menu-libre')).toBeNull();
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        await esperar(2);
    });

    test('detalles: la fecha de hoy en el encabezado y la tarea abierta se marca en la lista', async () => {
        expect(document.getElementById('seg-hoy').textContent).toContain(String(new Date().getFullYear()));
        expect(document.querySelector('#seg-btn-nueva .seg-kbd').textContent).toBe('N');
        const fila = () => document.querySelector('#seg-body .seg-row[data-id="g1"]');
        fila().querySelector('.seg-titulo').click();
        await esperar(3);
        expect(fila().classList.contains('is-abierta')).toBe(true);
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        await esperar(3);
        expect(fila().classList.contains('is-abierta')).toBe(false);
    });
});
