/**
 * @jest-environment jsdom
 *
 * Validación del Director, vista por el admin de Seguimiento: ve cuántas
 * tareas entregadas esperan su visto bueno, las revisa (con las observaciones
 * y archivos de cada subtarea) y las valida o las regresa con observaciones.
 */
const fs = require('fs');
const path = require('path');
require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

function fakeSupabase(db) {
    const cliente = {
        rpc: async () => ({ data: 'admin', error: null }),
        from(tabla) {
            const q = { tabla, op: 'select', filtros: [], datos: null, uno: false };
            const correr = () => {
                const filas = db[tabla] || (db[tabla] = []);
                const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
                if (q.op === 'insert') {
                    const nueva = Object.assign({ id: 'n' + filas.length, creado_en: new Date().toISOString() }, q.datos);
                    filas.push(nueva);
                    return { data: Object.assign({}, nueva), error: null };
                }
                if (q.op === 'update') {
                    const hits = filas.filter(coincide);
                    hits.forEach(r => {
                        Object.assign(r, q.datos);
                        if (q.datos.estatus === 'completada') { r.completada_en = new Date().toISOString(); r.validada_en = r.completada_en; }
                        if (q.datos.estatus && !['por_validar', 'completada'].includes(q.datos.estatus)) Object.assign(r, { entregada_en: null, entregada_por: null });
                    });
                    return { data: q.uno ? (hits[0] ? Object.assign({}, hits[0]) : null) : hits, error: null };
                }
                const data = filas.filter(coincide).map(r => Object.assign({}, r));
                return { data: q.uno ? data[0] || null : data, error: null };
            };
            const api = {
                select() { return api; }, order() { return api; }, limit() { return api; },
                eq(c, v) { q.filtros.push([c, v]); return api; },
                insert(d) { q.op = 'insert'; q.datos = d; return api; },
                update(d) { q.op = 'update'; q.datos = d; return api; },
                single() { q.uno = true; return api; }, maybeSingle() { q.uno = true; return api; },
                then(ok, mal) { return Promise.resolve(correr()).then(ok, mal); },
            };
            return api;
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {},
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: 'gonzalo.sandoval@aifa.operaciones', user_metadata: {} } } } }) },
        storage: { from() { return { remove: async () => ({}), createSignedUrl: async () => ({ data: { signedUrl: 'x' } }) }; } },
    };
    return cliente;
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 20)); };
const tarea = o => Object.assign({ tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', aviso_dias: 7, recurrencia: 'ninguna',
    checklist: [], evidencias: [], etiquetas: [], subdireccion: 'SSO', entregada_en: null, entregada_por: null, validada_en: null, validada_por: null }, o);

let db;
beforeAll(async () => {
    document.body.innerHTML = `
        <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
        <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
    db = {
        seguimiento_acceso: [{ email: 'gonzalo.sandoval@aifa.operaciones', nombre: 'Gonzalo Sandoval', rol: 'admin' }],
        seguimiento_tareas: [
            tarea({ id: 'p1', folio: 1, titulo: 'Inspección de pista', estatus: 'por_validar', responsable: 'Luis García',
                    entregada_por: 'Luis García', entregada_en: new Date(Date.now() - 2 * 864e5).toISOString(), fecha_limite: '2026-12-01',
                    checklist: [{ id: 's1', texto: 'Levantamiento en sitio', hecho: true, obs: 'Recorrido con el supervisor.', archivos: [{ path: 'p1/abcdef12.docx', nombre: 'Minuta.docx', tipo: 'docx', tam: 2048 }] }] }),
            tarea({ id: 'p2', folio: 2, titulo: 'Plan de fauna', estatus: 'por_validar', entregada_por: 'Ana Ruiz', entregada_en: new Date().toISOString(),
                    recurrencia: 'anual', fecha_limite: '2026-11-30', tipo: 'renovacion' }),
            tarea({ id: 'a1', folio: 3, titulo: 'Abierta', fecha_limite: '2026-12-20' }),
        ],
        seguimiento_comentarios: [], seguimiento_actividad: [], agenda_2026: [],
    };
    window.supabaseClient = fakeSupabase(db);
    sessionStorage.setItem('user_fullname', 'Gonzalo Sandoval');
    window.showSection = jest.fn();
    new Function(leer('js/seguimiento.js'))();
    await esperar();
    document.getElementById('seguimiento-section').classList.add('active');
    await esperar();
});

const fila = id => document.querySelector('#seg-body .seg-row[data-id="' + id + '"]');

test('arriba ve cuántas tareas esperan su validación, y las filtra con un clic', async () => {
    const aviso = document.getElementById('seg-validar');
    expect(aviso.textContent).toContain('2 tareas entregadas esperan tu validación');
    expect(aviso.textContent).toContain('«Inspección de pista», de Luis García');   // la más antigua
    aviso.querySelector('[data-validar]').click();
    await esperar(2);
    expect([...document.querySelectorAll('#seg-body .seg-row')].map(r => r.dataset.id).sort()).toEqual(['p1', 'p2']);
    // La casilla de lo entregado es distinta y valida.
    expect(fila('p1').querySelector('.seg-hecho').getAttribute('aria-label')).toBe('Validar tarea');
});

test('en el detalle revisa cómo se hizo cada subtarea, con sus archivos', async () => {
    window.seguimientoModule.abrir('p1');
    await esperar(4);
    const barra = document.querySelector('#seg-drawer .seg-barra-hecho');
    expect(barra.textContent).toContain('Entregada · falta tu validación');
    expect(barra.textContent).toContain('La entregó Luis García');
    const s1 = document.querySelector('#seg-ck [data-ck="s1"]');
    expect(s1.querySelector('textarea[data-ck-accion="obs"]').value).toBe('Recorrido con el supervisor.');
    expect(s1.querySelector('.seg-ck-file').textContent).toContain('Minuta.docx');
});

test('«Regresar» pide qué falta, la devuelve a En proceso y lo deja como comentario', async () => {
    document.querySelector('#seg-drawer [data-dr="regresar"]').click();
    await esperar(2);
    const dialogo = document.getElementById('seg-confirm');
    // Sin escribir qué falta no se regresa.
    dialogo.querySelector('[data-cf="si"]').click();
    expect(dialogo.hidden).toBe(false);
    expect(document.getElementById('seg-cf-campo').classList.contains('is-falta')).toBe(true);
    document.getElementById('seg-cf-campo').value = 'Falta el informe firmado.';
    dialogo.querySelector('[data-cf="si"]').click();
    await esperar();
    const t = db.seguimiento_tareas.find(x => x.id === 'p1');
    expect(t.estatus).toBe('en_proceso');
    expect(db.seguimiento_comentarios.find(c => c.tarea_id === 'p1').texto).toBe('↩ Regresada para corrección: Falta el informe firmado.');
    expect(db.seguimiento_actividad.find(a => a.accion === 'regreso').detalle.motivo).toBe('Falta el informe firmado.');
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
    await esperar(2);
});

test('«Validar» la deja terminada con su nombre; si se repite, programa la siguiente', async () => {
    window.seguimientoModule.abrir('p2');
    await esperar(4);
    document.querySelector('#seg-drawer [data-dr="validar"]').click();
    await esperar(14);
    const t = db.seguimiento_tareas.find(x => x.id === 'p2');
    expect(t.estatus).toBe('completada');
    expect(t.validada_por).toBe('Gonzalo Sandoval');
    expect(db.seguimiento_actividad.some(a => a.tarea_id === 'p2' && a.accion === 'valido')).toBe(true);
    // La renovación anual dejó lista la siguiente al validarse, no al entregarse.
    expect(db.seguimiento_tareas.some(x => x.titulo === 'Plan de fauna' && x.fecha_limite === '2027-11-30')).toBe(true);
    expect(document.querySelector('#seg-drawer .seg-barra-hecho').textContent).toContain('Hecha y validada');
    expect(document.getElementById('seg-validar').textContent).toBe('');
});

test('el admin puede cerrar directo lo que él mismo palomea', async () => {
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
    window.seguimientoModule.abrir('a1');
    await esperar(4);
    document.querySelector('#seg-drawer button.seg-barra-hecho[data-dr="completar"]').click();
    await esperar();
    expect(db.seguimiento_tareas.find(x => x.id === 'a1').estatus).toBe('completada');
});
