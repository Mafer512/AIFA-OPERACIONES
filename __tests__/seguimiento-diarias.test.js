/**
 * @jest-environment jsdom
 *
 * Dos espacios en Seguimiento: Diarias (el día a día y las rutinas) y Agenda
 * (órdenes, compromisos y renovaciones con seguimiento formal). Las dos pasan
 * por la validación del Director; en las rutinas, la siguiente se programa al
 * entregar la de hoy.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return C.aISO(d); };

describe('reglas', () => {
    const HOY = '2026-11-09';   // lunes

    test('cada tarea es de Diarias o de Agenda; lo que no dice, es de Agenda', () => {
        expect(C.CLASES.map(c => c.clave)).toEqual(['diaria', 'agenda']);
        expect(C.claseDe({ clase: 'diaria' })).toBe('diaria');
        expect(C.claseDe({})).toBe('agenda');
        expect(C.etiquetaValor('clase', 'diaria')).toBe('Diarias');
    });

    test('rutinas: cada día, de lunes a viernes y cada semana', () => {
        const t = o => Object.assign({ fecha_limite: HOY }, o);
        expect(C.fechaSiguiente(t({ recurrencia: 'diaria' }), HOY)).toBe('2026-11-10');
        expect(C.fechaSiguiente(t({ recurrencia: 'laborable', fecha_limite: '2026-11-13' }), '2026-11-13')).toBe('2026-11-16');   // viernes → lunes
        expect(C.fechaSiguiente(t({ recurrencia: 'semanal' }), HOY)).toBe('2026-11-16');
        // Hecha tarde: la siguiente es mañana, no una fila de días atrasados.
        expect(C.fechaSiguiente(t({ recurrencia: 'diaria', fecha_limite: '2026-11-03' }), HOY)).toBe('2026-11-10');
        expect(C.fechaSiguiente(t({ recurrencia: 'semanal', fecha_limite: '2026-10-26' }), HOY)).toBe('2026-11-16');
        // Las de meses conservan su ciclo.
        expect(C.fechaSiguiente(t({ recurrencia: 'anual', fecha_limite: '2026-10-01' }), HOY)).toBe('2027-10-01');
        expect(C.seRepite({ recurrencia: 'laborable' })).toBe(true);
        expect(C.nombreRecurrencia({ recurrencia: 'laborable' })).toBe('Lunes a viernes');
        expect(C.seRepite({ recurrencia: 'ninguna' })).toBe(false);
    });

    test('la siguiente de una rutina sigue en Diarias', () => {
        const sig = C.siguienteOcurrencia({ id: 'r1', titulo: 'Revisar el parte', clase: 'diaria', recurrencia: 'diaria', fecha_limite: HOY, subdireccion: 'DO' }, HOY);
        expect(sig).toMatchObject({ clase: 'diaria', fecha_limite: '2026-11-10', recurrencia: 'diaria', estatus: 'pendiente', tarea_origen: 'r1' });
        // Sin la columna en la base, no se manda.
        expect('clase' in C.siguienteOcurrencia({ titulo: 'x', recurrencia: 'anual', fecha_limite: HOY }, HOY)).toBe(false);
    });

    test('Diarias se acomoda como una agenda personal', () => {
        const t = (id, o) => Object.assign({ id, titulo: id, estatus: 'pendiente', prioridad: 'normal' }, o);
        const d = C.agendaDelDia([
            t('atrasada', { fecha_limite: '2026-11-06' }), t('hoy-b', { fecha_limite: HOY }), t('hoy-a', { fecha_limite: HOY, prioridad: 'urgente' }),
            t('manana', { fecha_limite: '2026-11-10' }), t('jueves', { fecha_limite: '2026-11-12' }), t('mes', { fecha_limite: '2026-12-20' }),
            t('sin'), t('entregada', { estatus: 'por_validar' }), t('hecha', { estatus: 'completada', completada_en: HOY + 'T10:00:00' }),
            t('vieja', { estatus: 'completada', completada_en: '2026-11-01T10:00:00' }), t('cancelada', { estatus: 'cancelada' }),
        ], HOY);
        const ids = k => d[k].map(x => x.id);
        expect(ids('atrasadas')).toEqual(['atrasada']);
        expect(ids('hoy')).toEqual(['hoy-a', 'hoy-b']);   // la urgente primero
        expect(ids('manana')).toEqual(['manana']);
        expect(ids('semana')).toEqual(['jueves']);
        expect(ids('despues')).toEqual(['mes']);
        expect(ids('sinFecha')).toEqual(['sin']);
        expect(ids('entregadas')).toEqual(['entregada']);
        expect(ids('hechas')).toEqual(['hecha']);
    });

    test('la base: columna del espacio y las nuevas repeticiones (todos los scripts dicen lo mismo)', () => {
        const sql = leer('db/seguimiento_diarias.sql');
        expect(sql).toContain("ADD COLUMN IF NOT EXISTS clase text NOT NULL DEFAULT 'agenda'");
        expect(sql).toContain("CHECK (clase IN ('agenda', 'diaria'))");
        ['db/seguimiento_diarias.sql', 'db/create_seguimiento.sql', 'db/seguimiento_recurrencia_personalizada.sql']
            .forEach(f => expect(leer(f)).toContain("'ninguna', 'diaria', 'laborable', 'semanal'"));
    });
});

/* ---------- En la página, con la cuenta de un editor ---------- */
function fakeSupabase(db) {
    let n = 0;
    const cliente = {
        rpc: async () => ({ data: 'editor', error: null }),
        from(tabla) {
            const q = { op: 'select', filtros: [], datos: null, uno: false };
            const correr = () => {
                const filas = db[tabla] || (db[tabla] = []);
                const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
                if (q.op === 'insert') {
                    const nueva = Object.assign({ id: 'n' + (++n), folio: 100 + n, clase: 'agenda', evidencias: [], checklist: [], etiquetas: [], entregada_en: null }, q.datos);
                    filas.push(nueva);
                    return { data: Object.assign({}, nueva), error: null };
                }
                if (q.op === 'update') {
                    const hits = filas.filter(coincide);
                    hits.forEach(r => {
                        const d = Object.assign({}, q.datos);
                        if (d.estatus === 'completada') d.estatus = 'por_validar';   // lo que hace la base con quien no es admin
                        if (d.estatus === 'por_validar' && r.estatus !== 'por_validar') d.entregada_en = new Date().toISOString();
                        Object.assign(r, d);
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
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: 'ana.ruiz@aifa.operaciones', user_metadata: {} } } } }) },
        storage: { from() { return {}; } },
    };
    return cliente;
}
const esperar = async (k = 10) => { for (let i = 0; i < k; i++) await new Promise(r => setTimeout(r, 20)); };
const tarea = o => Object.assign({ tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', aviso_dias: 7, recurrencia: 'ninguna', subdireccion: 'SSO',
    checklist: [], evidencias: [], etiquetas: [], clase: 'agenda', entregada_en: null }, o);

describe('Diarias y Agenda en la página', () => {
    let db;
    beforeAll(async () => {
        localStorage.clear();
        document.body.innerHTML = `
            <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
            <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
        db = {
            seguimiento_acceso: [{ email: 'ana.ruiz@aifa.operaciones', nombre: 'Ana Ruiz', rol: 'editor' }],
            seguimiento_tareas: [
                tarea({ id: 'o1', folio: 1, titulo: 'Orden de la Dirección', fecha_limite: iso(10) }),
                tarea({ id: 'd1', folio: 2, titulo: 'Llamar a SENEAM', clase: 'diaria', tipo: 'tarea', fecha_limite: iso(0), aviso_dias: 0, subdireccion: 'DO' }),
                tarea({ id: 'd2', folio: 3, titulo: 'Enviar oficio a AFAC', clase: 'diaria', tipo: 'tarea', fecha_limite: iso(-2), aviso_dias: 0, subdireccion: 'DO' }),
            ],
            seguimiento_comentarios: [], seguimiento_actividad: [], agenda_2026: [],
        };
        window.supabaseClient = fakeSupabase(db);
        sessionStorage.setItem('user_fullname', 'Ana Ruiz');
        window.showSection = jest.fn();
        new Function(leer('js/seguimiento.js'))();
        await esperar();
        document.getElementById('seguimiento-section').classList.add('active');
        await esperar();
    });

    const espacios = () => [...document.querySelectorAll('#seg-espacios .seg-esp')];
    const ids = () => [...document.querySelectorAll('#seg-body [data-id]')].map(x => x.dataset.id);

    test('arriba, los dos espacios con lo suyo; Agenda no muestra lo diario', () => {
        expect(espacios().map(b => b.querySelector('b').textContent)).toEqual(['Diarias', 'Agenda']);
        expect(espacios()[0].textContent).toContain('1 para hoy · 1 atrasada');
        expect(espacios()[1].classList.contains('is-on')).toBe(true);
        expect(ids()).toEqual(['o1']);
    });

    test('Diarias se ve como agenda del día: atrasadas, hoy…', async () => {
        espacios()[0].click();
        await esperar(2);
        expect(document.querySelector('#seg-dia-atrasadas').textContent).toContain('Enviar oficio a AFAC');
        expect(document.querySelector('#seg-dia-hoy').textContent).toContain('Llamar a SENEAM');
        expect(ids()).not.toContain('o1');
        expect(document.getElementById('seg-views').hidden).toBe(true);   // sin Tablero, Calendario…
        expect(document.querySelector('#seg-kpis [data-kpi="dia:hoy"] .seg-kpi-val').textContent).toBe('1');
        expect(JSON.parse(localStorage.getItem('aifa_seguimiento_prefs_v1')).espacio).toBe('diaria');
    });

    test('se captura rápido una rutina: va a Diarias, con fecha de hoy y repetición', async () => {
        document.querySelector('#seg-body [data-dia="rutina"]').click();
        [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('Cada día')).click();
        await esperar(2);
        const input = document.getElementById('seg-dia-nueva');
        input.value = 'Revisar el parte de operaciones';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await esperar();
        const r = db.seguimiento_tareas.find(t => t.titulo === 'Revisar el parte de operaciones');
        expect(r).toMatchObject({ clase: 'diaria', tipo: 'tarea', fecha_limite: iso(0), recurrencia: 'diaria', aviso_dias: 0, subdireccion: 'DO' });
        expect(document.querySelector('#seg-dia-hoy').textContent).toContain('Revisar el parte de operaciones');
        expect(document.getElementById('seg-dia-nueva').value).toBe('');
    });

    test('al entregar la rutina queda por validar y la de mañana ya está programada', async () => {
        const r = db.seguimiento_tareas.find(t => t.titulo === 'Revisar el parte de operaciones');
        document.querySelector('#seg-body [data-id="' + r.id + '"] [data-accion="completar"]').click();
        await esperar(14);
        expect(db.seguimiento_tareas.find(t => t.id === r.id).estatus).toBe('por_validar');
        const sig = db.seguimiento_tareas.find(t => t.titulo === 'Revisar el parte de operaciones' && t.id !== r.id);
        expect(sig).toMatchObject({ clase: 'diaria', fecha_limite: iso(1), estatus: 'pendiente', recurrencia: 'diaria' });
        expect(document.querySelector('#seg-dia-entregadas').textContent).toContain('Revisar el parte de operaciones');
        expect(document.querySelector('#seg-dia-manana').textContent).toContain('Revisar el parte de operaciones');
        expect(document.getElementById('seg-toasts').textContent).toContain('La siguiente quedó para el');
    });

    test('una tarea nueva desde Diarias ya trae su espacio y la fecha de hoy; se puede mover a Agenda', async () => {
        document.getElementById('seg-btn-nueva').click();
        await esperar(3);
        expect(document.querySelector('#seg-drawer [data-dr="clase"]').textContent).toContain('Diarias');
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        await esperar(2);

        window.seguimientoModule.abrir('d1');
        await esperar(4);
        document.querySelector('#seg-drawer [data-dr="clase"]').click();
        [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('Agenda')).click();
        await esperar();
        expect(db.seguimiento_tareas.find(t => t.id === 'd1').clase).toBe('agenda');
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        await esperar(2);
        expect(ids()).not.toContain('d1');
        espacios()[1].click();
        await esperar(2);
        expect(ids()).toContain('d1');
    });
});
