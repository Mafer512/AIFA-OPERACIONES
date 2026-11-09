/**
 * @jest-environment jsdom
 *
 * Seguimiento → Acceso: el admin le asigna a cada cuenta su área (toda la
 * Dirección, una subdirección completa o una gerencia) y el módulo le sugiere
 * cuál, según Colaboradores (subdirección, gerencia, comisión y puesto).
 */
const fs = require('fs');
const path = require('path');
require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const GSO = 'Gerencia de Seguridad Operacional';

function fakeSupabase(db) {
    const llamadas = [];
    function correr(q) {
        llamadas.push(q);
        const filas = db[q.tabla] || (db[q.tabla] = []);
        const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
        if (q.op === 'insert') { filas.push(Object.assign({ creado_en: new Date().toISOString() }, q.datos)); return { data: null, error: null }; }
        if (q.op === 'update') { filas.filter(coincide).forEach(r => Object.assign(r, q.datos)); return { data: null, error: null }; }
        return { data: filas.filter(coincide).map(r => Object.assign({}, r)), error: null };
    }
    return {
        llamadas,
        rpc: async nombre => (nombre === 'seguimiento_cuentas' ? { data: db.cuentas, error: null } : { data: 'admin', error: null }),
        from(tabla) {
            const q = { tabla, op: 'select', filtros: [], datos: null };
            const api = {
                select() { return api; }, order() { return api; }, limit() { return api; },
                eq(c, v) { q.filtros.push([c, v]); return api; },
                insert(d) { q.op = 'insert'; q.datos = d; return api; },
                update(d) { q.op = 'update'; q.datos = d; return api; },
                then(ok, mal) { return Promise.resolve(correr(q)).then(ok, mal); },
            };
            return api;
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {},
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: 'isaac.lopez@aifa.operaciones', user_metadata: {} } } } }) },
        storage: { from() { return {}; } },
    };
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 20)); };
const colab = o => Object.assign({ 'Puesto': 'Analista', 'Subdirección': '', 'Gerencia': '', 'Personal comisionado': '0', 'Estatus': 'Activo' }, o);

let db;
let sb;
beforeAll(async () => {
    document.body.innerHTML = `
        <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
        <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
    db = {
        seguimiento_acceso: [
            { email: 'isaac.lopez@aifa.operaciones', nombre: 'Isaac López', rol: 'admin', subdireccion: null, gerencia: null, creado_en: '1' },
            { email: 'maria.torres@aifa.operaciones', nombre: 'María Torres Vega', rol: 'editor', subdireccion: null, gerencia: null, creado_en: '2' },
            { email: 'carlos.mena@aifa.operaciones', nombre: null, rol: 'editor', subdireccion: null, gerencia: null, creado_en: '3' },
            { email: 'luis.rey@aifa.operaciones', nombre: 'Luis Rey', rol: 'lector', subdireccion: 'SI', gerencia: null, creado_en: '4' },
        ],
        seguimiento_tareas: [], seguimiento_comentarios: [], seguimiento_actividad: [],
        // Cuentas de la plataforma (seguimiento_cuentas).
        cuentas: [
            { email: 'andrea.rios@aifa.operaciones', nombre: 'Andrea Ríos Campos' },
            { email: 'andres.vela@aifa.operaciones', nombre: 'Andrés Vela Soto' },
            { email: 'maria.torres@aifa.operaciones', nombre: 'María Torres Vega' },
            { email: 'jefe.gonzalo@aifa.operaciones', nombre: null },
        ],
        agenda_2026: [
            colab({ 'Nombre': 'María Torres Vega', 'Puesto': 'Gerente de Seguridad Operacional', 'Subdirección': 'Subdirección de Seguridad Operacional', 'Gerencia': GSO }),
            colab({ 'Nombre': 'Carlos Mena Ruiz', 'Puesto': 'Subdirector de Servicios Conexos', 'Subdirección': 'Subdirección de Servicios Conexos', 'Gerencia': 'Gerencia de Carga' }),
            colab({ 'Nombre': 'Andrés Vela Soto', 'Puesto': 'Gerente de Carga', 'Subdirección': 'Subdirección de Servicios Conexos', 'Gerencia': 'Gerencia de Carga' }),
            colab({ 'Nombre': 'Rosa Díaz Paz', 'Puesto': 'Jefa de oficina', 'Subdirección': 'Subdirección de Ingeniería', 'Gerencia': 'Gerencia de Ingeniería Civil' }),
        ],
    };
    sb = fakeSupabase(db);
    window.supabaseClient = sb;
    window.showSection = jest.fn();
    new Function(leer('js/seguimiento.js'))();
    await esperar();
    document.getElementById('seguimiento-section').classList.add('active');
    await esperar();
    document.getElementById('seg-btn-acceso').click();
    await esperar();
});

const fila = email => document.querySelector('[data-acc-area="' + email + '"]')?.closest('.seg-acc-row');
const acceso = email => db.seguimiento_acceso.find(a => a.email === email);

test('cada cuenta tiene su área; el admin ve todo y no se limita', () => {
    expect(document.querySelectorAll('.seg-acc-row')).toHaveLength(4);
    expect(document.querySelector('[data-acc-area="isaac.lopez@aifa.operaciones"]')).toBeNull();
    expect(document.querySelector('[data-acc-area="luis.rey@aifa.operaciones"]').value).toBe('SI|');
    const ops = [...document.querySelector('[data-acc-area="maria.torres@aifa.operaciones"]').options].map(o => o.textContent);
    expect(ops[0]).toBe('Toda la Dirección');
    expect(ops).toContain('Seguridad Operacional · toda la subdirección');
    expect(ops).toContain(GSO);
});

test('sugiere el área de cada cuenta sin área según Colaboradores', () => {
    expect(fila('maria.torres@aifa.operaciones').querySelector('.seg-acc-sug').textContent).toContain(GSO);
    // Sin nombre en el acceso: se encuentra por el usuario (carlos.mena).
    expect(fila('carlos.mena@aifa.operaciones').querySelector('.seg-acc-sug').textContent).toContain('Subdirección de Servicios Conexos');
    // Ya tiene área: no se le sugiere nada.
    expect(fila('luis.rey@aifa.operaciones').querySelector('.seg-acc-sug')).toBeNull();
    expect(document.querySelector('.seg-acc-bar').textContent).toContain('2 cuentas sin área');
});

test('cambiar el área en la lista la guarda', async () => {
    const sel = document.querySelector('[data-acc-area="luis.rey@aifa.operaciones"]');
    sel.value = 'SI|Gerencia de Ingeniería Civil';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar();
    expect(acceso('luis.rey@aifa.operaciones')).toMatchObject({ subdireccion: 'SI', gerencia: 'Gerencia de Ingeniería Civil' });
    const sel2 = document.querySelector('[data-acc-area="luis.rey@aifa.operaciones"]');
    sel2.value = '';
    sel2.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar();
    expect(acceso('luis.rey@aifa.operaciones')).toMatchObject({ subdireccion: null, gerencia: null });
});

test('«Asignar» aplica las sugerencias, tras confirmar', async () => {
    document.querySelector('[data-m="completar"]').click();
    await esperar(2);
    const dialogo = document.getElementById('seg-confirm');
    expect(dialogo.hidden).toBe(false);
    expect(dialogo.textContent).toContain('María Torres Vega');
    dialogo.querySelector('[data-cf="si"]').click();
    await esperar();
    expect(acceso('maria.torres@aifa.operaciones')).toMatchObject({ subdireccion: 'SSO', gerencia: GSO });
    expect(acceso('carlos.mena@aifa.operaciones')).toMatchObject({ subdireccion: 'SSC', gerencia: null });
    expect(document.querySelector('.seg-acc-bar')).toBeNull();
});

test('al dar acceso a alguien nuevo se propone su área y se guarda con ella', async () => {
    document.getElementById('seg-acc-user').value = 'rosa.diaz';
    document.getElementById('seg-acc-user').dispatchEvent(new Event('input', { bubbles: true }));
    await esperar(16);
    expect(document.getElementById('seg-acc-hint').hidden).toBe(false);
    expect(document.getElementById('seg-acc-area').value).toBe('SI|Gerencia de Ingeniería Civil');
    document.querySelector('[data-m="agregar"]').click();
    await esperar();
    expect(acceso('rosa.diaz@aifa.operaciones')).toMatchObject({ rol: 'editor', subdireccion: 'SI', gerencia: 'Gerencia de Ingeniería Civil' });
});

test('al escribir aparecen las cuentas de la plataforma; elegir una llena usuario, nombre y área', async () => {
    const user = document.getElementById('seg-acc-user');
    const escribir = async v => { user.value = v; user.dispatchEvent(new Event('input', { bubbles: true })); await esperar(3); };
    await escribir('andre');
    const ops = () => [...document.querySelectorAll('#seg-acc-sugs [data-acc-cuenta]')];
    expect(document.getElementById('seg-acc-sugs').hidden).toBe(false);
    expect(ops().map(o => o.querySelector('b').textContent)).toEqual(['Andrea Ríos Campos', 'Andrés Vela Soto']);
    // Con su puesto y el área que le toca según Colaboradores.
    expect(ops()[1].textContent).toContain('Gerente de Carga');
    expect(ops()[1].textContent).toContain('Gerencia de Carga');
    // Teclado: flecha abajo y Enter.
    user.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(ops()[1].classList.contains('is-on')).toBe(true);
    user.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await esperar(16);
    expect(user.value).toBe('andres.vela');
    expect(document.getElementById('seg-acc-nombre').value).toBe('Andrés Vela Soto');
    expect(document.getElementById('seg-acc-area').value).toBe('SSC|Gerencia de Carga');
    expect(document.getElementById('seg-acc-sugs').hidden).toBe(true);

    // Por apellido o por usuario también; quien ya tiene acceso sale marcado y no se puede elegir.
    await escribir('torres');
    expect(ops()).toHaveLength(1);
    expect(ops()[0].disabled).toBe(true);
    expect(ops()[0].textContent).toContain('Ya tiene acceso');
    await escribir('jefe.gon');
    expect(ops()[0].textContent).toContain('jefe.gonzalo@aifa.operaciones');
    ops()[0].click();
    await esperar(2);
    expect(user.value).toBe('jefe.gonzalo');
    await escribir('zzz');
    expect(document.getElementById('seg-acc-sugs').textContent).toContain('Ninguna cuenta');
    user.value = ''; user.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('seg-acc-nombre').value = '';
});

test('si la base todavía no tiene las columnas, lo dice y no se rompe', async () => {
    db.seguimiento_acceso.forEach(a => { delete a.subdireccion; delete a.gerencia; });
    document.querySelector('[data-m="cerrar"]').click();
    document.getElementById('seg-btn-acceso').click();
    await esperar();
    expect(document.querySelector('.seg-acc-aviso').textContent).toContain('db/seguimiento_alcance_por_area.sql');
    expect(document.querySelectorAll('[data-acc-area]')).toHaveLength(0);
    expect(document.getElementById('seg-acc-area').disabled).toBe(true);
});
