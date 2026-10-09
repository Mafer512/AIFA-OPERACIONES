/**
 * @jest-environment jsdom
 *
 * Seguimiento en la página (js/seguimiento.js) con un Supabase de mentiras:
 * quién lo ve, que pinte las tareas por subdirección, que la captura rápida
 * guarde en su subdirección, que completar una renovación programe la
 * siguiente y que el recordatorio abra WhatsApp con el mensaje.
 */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

function hoyISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function enDias(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------- Supabase falso: lo justo para el módulo ---------- */
function fakeSupabase(db, opciones) {
    const llamadas = [];
    let folio = 100;
    let n = 0;
    const uuid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
    function correr(q) {
        llamadas.push(q);
        const filas = db[q.tabla] || (db[q.tabla] = []);
        const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
        if (q.op === 'insert') {
            const nuevas = [].concat(q.datos).map(p => Object.assign({
                id: uuid(), folio: ++folio, creado_en: new Date().toISOString(), estatus: 'pendiente', prioridad: 'normal', tipo: 'orden',
                recurrencia: 'ninguna', aviso_dias: 7, checklist: [], evidencias: [], etiquetas: [],
            }, p));
            filas.push(...nuevas);
            return { data: q.uno ? Object.assign({}, nuevas[0]) : nuevas.map(x => Object.assign({}, x)), error: null };
        }
        if (q.op === 'update') {
            const hits = filas.filter(coincide);
            hits.forEach(r => {
                Object.assign(r, q.datos);
                if (q.datos.estatus === 'completada') r.completada_en = new Date().toISOString();
            });
            return { data: q.uno ? (hits[0] ? Object.assign({}, hits[0]) : null) : hits, error: null };
        }
        if (q.op === 'delete') {
            db[q.tabla] = filas.filter(r => !coincide(r));
            return { data: null, error: null };
        }
        const data = filas.filter(coincide).map(r => Object.assign({}, r));
        return { data: q.uno ? data[0] || null : data, error: null };
    }
    const cliente = {
        llamadas,
        rpc: jest.fn(async () => ({ data: opciones.rol(), error: null })),
        from(tabla) {
            const q = { tabla, op: 'select', filtros: [], datos: null, uno: false };
            const api = {
                select() { return api; }, order() { return api; }, limit() { return api; },
                eq(c, v) { q.filtros.push([c, v]); return api; },
                insert(d) { q.op = 'insert'; q.datos = d; return api; },
                update(d) { q.op = 'update'; q.datos = d; return api; },
                delete() { q.op = 'delete'; return api; },
                single() { q.uno = true; return api; },
                maybeSingle() { q.uno = true; return api; },
                then(ok, mal) { return Promise.resolve(correr(q)).then(ok, mal); },
            };
            return api;
        },
        channel() {
            const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; } };
            return ch;
        },
        removeChannel() {},
        auth: {
            onAuthStateChange() {},
            getSession: async () => ({ data: { session: opciones.sesion() } }),
        },
        subidos: [],
        storage: { from() { return {
            upload: async (ruta, archivo) => { cliente.subidos.push({ ruta, nombre: archivo.name }); return { error: null }; },
            remove: async () => ({}), createSignedUrl: async () => ({ data: { signedUrl: 'x' } }),
        }; } },
    };
    return cliente;
}

const esperar = async (veces = 8) => { for (let i = 0; i < veces; i++) await new Promise(r => setTimeout(r, 20)); };

let rol = 'admin';
let sesion = { user: { email: 'isaac.lopez@aifa.operaciones', user_metadata: {} } };
let db;
let sb;

beforeAll(async () => {
    document.body.innerHTML = `
        <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;" aria-hidden="true">Seguimiento</a></nav>
        <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
    db = {
        seguimiento_tareas: [
            { id: 'a1', folio: 1, titulo: 'ANTENA SENEAM', tipo: 'orden', subdireccion: 'SSO', estatus: 'pendiente', prioridad: 'alta',
              responsable: 'Luis García', responsable_tel: '55 1234 5678', fecha_limite: enDias(-3), aviso_dias: 7, recurrencia: 'ninguna',
              checklist: [], evidencias: [], etiquetas: [] },
            { id: 'a2', folio: 2, titulo: 'Certificado de aeródromo', tipo: 'certificado', subdireccion: 'SI', estatus: 'en_proceso', prioridad: 'urgente',
              fecha_inicio: enDias(-20), fecha_limite: enDias(10), aviso_dias: 30, recurrencia: 'anual',
              checklist: [{ id: 'c1', texto: 'Pago de derechos', hecho: false }], evidencias: [], etiquetas: [] },
        ],
        seguimiento_comentarios: [{ id: 'k1', tarea_id: 'a1', texto: 'Ya se pidió cotización', autor: 'Isaac' }],
        seguimiento_actividad: [],
        agenda_2026: [{ 'No. Empleado': '1020', 'Nombre': 'Gonzalo Sandoval González', 'Puesto': 'Director de Operación', 'No. telefónico': '3338448450', 'Estatus': 'Activo' }],
    };
    sb = fakeSupabase(db, { rol: () => rol, sesion: () => sesion });
    window.supabaseClient = sb;
    // Como la guarda la aplicación al iniciar sesión (script.js), no en 'user'.
    sessionStorage.setItem('currentUser', 'isaac.lopez@aifa.operaciones');
    sessionStorage.setItem('user_fullname', 'Isaac Azhael López Cancino');
    window.showSection = jest.fn(key => {
        document.querySelectorAll('.content-section').forEach(s => s.classList.toggle('active', s.id === key + '-section'));
    });
    window.getDefaultAllowedSection = () => 'coord-auditoria';
    window.open = jest.fn(() => null);
    // jsdom no trae XLSX ni print; no se usan aquí.
    require('../js/seguimiento-core');
    new Function(leer('js/seguimiento.js'))();
    await esperar();
});

const seccion = () => document.getElementById('seguimiento-section');
async function entrar() {
    seccion().classList.add('active');
    await esperar();
}
const fila = id => document.querySelector('#seg-body .seg-row[data-id="' + id + '"]');

test('crea su propia sección junto a las demás', () => {
    expect(seccion()).not.toBeNull();
    expect(seccion().parentElement.querySelector('#coord-auditoria-section')).not.toBeNull();
});

test('con acceso, aparece en el menú de Operación', () => {
    expect(sb.rpc).toHaveBeenCalledWith('seguimiento_mi_rol');
    expect(document.getElementById('menu-seguimiento').style.display).toBe('');
});

test('pinta las tareas agrupadas por subdirección', async () => {
    await entrar();
    const grupos = [...document.querySelectorAll('#seg-body .seg-group-pill')].map(g => g.textContent.trim());
    expect(grupos).toEqual([
        'Subdirección de Seguridad Operacional', 'Subdirección de Seguridad de la Aviación', 'Subdirección de Servicios Conexos',
        'Subdirección de Ingeniería', 'Subdirección de Gestión Energética', 'Dirección de Operación',
    ]);
    expect(fila('a1').textContent).toContain('ANTENA SENEAM');
    expect(fila('a1').classList.contains('is-vencida')).toBe(true);
    // Columnas de la vista de lista.
    const cab = [...document.querySelector('#seg-body .seg-th').children].map(c => c.textContent.trim());
    expect(cab).toEqual(['Hecha', 'Nombre', 'Comentarios', 'Recordatorio', 'Responsable', 'Fecha límite', 'Prioridad', 'Estatus']);
    // La casilla para palomear va en su propia columna, al principio.
    const casilla = fila('a1').firstElementChild.querySelector('button.seg-hecho');
    expect(casilla.dataset.accion).toBe('completar');
    expect(casilla.getAttribute('aria-pressed')).toBe('false');
    // El conteo de comentarios viene de la base.
    expect(fila('a1').querySelector('[data-accion="comentarios"]').textContent.trim()).toBe('1');
});

test('avisa lo vencido arriba y en los indicadores', () => {
    expect(document.getElementById('seg-alerta').textContent).toContain('1 tarea vencida');
    const kpi = document.querySelector('[data-kpi="vencidas"] .seg-kpi-val');
    expect(kpi.textContent).toBe('1');
});

test('la captura rápida guarda la tarea en la subdirección del grupo', async () => {
    const input = document.querySelector('#seg-body input[data-add="SSA"]');
    input.value = 'Revisar programa de seguridad';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await esperar();
    const insert = sb.llamadas.find(q => q.op === 'insert' && q.tabla === 'seguimiento_tareas');
    expect(insert.datos).toMatchObject({ titulo: 'Revisar programa de seguridad', subdireccion: 'SSA', creado_por: 'Isaac Azhael López Cancino' });
    const nueva = db.seguimiento_tareas.find(t => t.titulo === 'Revisar programa de seguridad');
    expect(fila(nueva.id)).not.toBeNull();
    // Y deja constancia en la bitácora.
    expect(db.seguimiento_actividad.some(a => a.tarea_id === nueva.id && a.accion === 'creo')).toBe(true);
});

test('completar una renovación anual programa la siguiente', async () => {
    fila('a2').querySelector('[data-accion="completar"]').click();
    await esperar(12);
    const original = db.seguimiento_tareas.find(t => t.id === 'a2');
    expect(original.estatus).toBe('completada');
    const siguiente = db.seguimiento_tareas.find(t => t.tarea_origen === 'a2');
    expect(siguiente).toBeDefined();
    const esperado = new Date(); esperado.setDate(esperado.getDate() + 10);
    expect(siguiente.fecha_limite.slice(5)).toBe(enDias(10).slice(5));
    expect(+siguiente.fecha_limite.slice(0, 4)).toBe(+enDias(10).slice(0, 4) + 1);
    expect(siguiente.estatus).toBe('pendiente');
    expect(siguiente.checklist).toEqual([{ id: 'c1', texto: 'Pago de derechos', hecho: false }]);
    expect(original.siguiente_id).toBe(siguiente.id);
});

test('el recordatorio abre WhatsApp con el número y el mensaje', async () => {
    window.open.mockClear();
    fila('a1').querySelector('[data-accion="whatsapp"]').click();
    expect(window.open).toHaveBeenCalledTimes(1);
    const url = window.open.mock.calls[0][0];
    expect(url.startsWith('https://wa.me/525512345678?text=')).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1])).toContain('ANTENA SENEAM');
    await esperar();
    expect(db.seguimiento_tareas.find(t => t.id === 'a1').ultimo_recordatorio).toBeTruthy();
    expect(db.seguimiento_actividad.some(a => a.tarea_id === 'a1' && a.accion === 'whatsapp')).toBe(true);
});

test('cambiar el estatus desde la lista', async () => {
    fila('a1').querySelector('[data-accion="estatus"]').click();
    const opcion = [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('En revisión'));
    opcion.click();
    await esperar();
    expect(db.seguimiento_tareas.find(t => t.id === 'a1').estatus).toBe('en_revision');
    const act = db.seguimiento_actividad.find(a => a.tarea_id === 'a1' && a.accion === 'cambio');
    expect(act.detalle.cambios).toEqual([{ campo: 'estatus', de: 'pendiente', a: 'en_revision' }]);
});

test('el panel de detalle abre con sus comentarios', async () => {
    fila('a1').click();
    await esperar();
    const panel = document.getElementById('seg-drawer');
    expect(panel.classList.contains('is-open')).toBe(true);
    expect(document.getElementById('seg-dr-titulo').value).toBe('ANTENA SENEAM');
    expect(panel.textContent).toContain('Ya se pidió cotización');
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
    expect(panel.classList.contains('is-open')).toBe(false);
});

test('crear desde el panel exige subdirección', async () => {
    document.getElementById('seg-btn-nueva').click();
    const ti = document.getElementById('seg-dr-titulo');
    ti.value = 'Orden sin área';
    ti.dispatchEvent(new Event('input', { bubbles: true }));
    const antes = db.seguimiento_tareas.length;
    document.querySelector('#seg-drawer [data-dr="crear"]').click();
    await esperar();
    expect(db.seguimiento_tareas.length).toBe(antes);
    expect(document.getElementById('seg-toasts').textContent).toContain('subdirección');
    // Se elige del menú y ya se crea.
    [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('Ingeniería')).click();
    document.querySelector('#seg-drawer [data-dr="crear"]').click();
    await esperar();
    const creada = db.seguimiento_tareas.find(t => t.titulo === 'Orden sin área');
    expect(creada).toMatchObject({ subdireccion: 'SI', estatus: 'pendiente' });
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
});

test('repetir con un tiempo personalizado: cada 18 meses', async () => {
    window.seguimientoModule.abrir('a1');
    await esperar();
    document.querySelector('#seg-drawer [data-dr="recurrencia"]').click();
    [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('Personalizado')).click();
    expect(document.getElementById('seg-drawer').classList.contains('is-open')).toBe(true);
    const n = document.querySelector('#seg-menu .seg-rep-n');
    const u = document.querySelector('#seg-menu .seg-rep-u');
    n.value = '18'; u.value = 'meses';
    n.dispatchEvent(new Event('input'));
    expect(document.querySelector('#seg-menu .seg-rep-prev').textContent).toContain('Cada 18 meses');
    document.querySelector('#seg-menu [data-rep="ok"]').click();
    await esperar();
    expect(db.seguimiento_tareas.find(t => t.id === 'a1')).toMatchObject({ recurrencia: 'personalizada', recurrencia_meses: 18 });
    expect(document.querySelector('#seg-drawer [data-dr="recurrencia"]').textContent).toContain('Cada 18 meses');
    // 3 años se guarda como personalizada de 36; 2 años usa la opción fija.
    document.querySelector('#seg-drawer [data-dr="recurrencia"]').click();
    [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('personalizado')).click();
    document.querySelector('#seg-menu .seg-rep-n').value = '2';
    document.querySelector('#seg-menu .seg-rep-u').value = 'anios';
    document.querySelector('#seg-menu [data-rep="ok"]').click();
    await esperar();
    expect(db.seguimiento_tareas.find(t => t.id === 'a1')).toMatchObject({ recurrencia: 'bienal', recurrencia_meses: null });
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
});

test('al crear se pueden adjuntar PDF o fotos y se suben con la tarea', async () => {
    document.getElementById('seg-btn-nueva').click();
    const ti = document.getElementById('seg-dr-titulo');
    ti.value = 'Renovar póliza de seguro';
    ti.dispatchEvent(new Event('input', { bubbles: true }));
    const entrada = document.getElementById('seg-file');
    const pdf = new File(['%PDF-1.4'], 'poliza.pdf', { type: 'application/pdf' });
    const exe = new File(['MZ'], 'virus.exe', { type: 'application/octet-stream' });
    Object.defineProperty(entrada, 'files', { value: [pdf, exe], configurable: true });
    entrada.dispatchEvent(new Event('change'));
    expect(document.querySelector('#seg-evid').textContent).toContain('poliza.pdf');
    expect(document.querySelector('#seg-evid').textContent).not.toContain('virus.exe');
    expect(document.getElementById('seg-toasts').textContent).toContain('sólo se aceptan PDF, JPG o PNG');
    [...document.querySelectorAll('#seg-drawer [data-dr="subdireccion"]')][0].click();
    [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('Servicios Conexos')).click();
    document.querySelector('#seg-drawer [data-dr="crear"]').click();
    await esperar(12);
    const creada = db.seguimiento_tareas.find(t => t.titulo === 'Renovar póliza de seguro');
    expect(sb.subidos.some(x => x.nombre === 'poliza.pdf' && x.ruta.startsWith(creada.id + '/'))).toBe(true);
    expect(creada.evidencias.map(e => e.nombre)).toEqual(['poliza.pdf']);
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
});

test('en el detalle se palomea con un botón grande', async () => {
    const nueva = db.seguimiento_tareas.find(t => t.titulo === 'Renovar póliza de seguro');
    window.seguimientoModule.abrir(nueva.id);
    await esperar();
    const barra = document.querySelector('#seg-drawer button.seg-barra-hecho');
    expect(barra.textContent).toContain('Marcar como hecha');
    barra.click();
    await esperar();
    expect(db.seguimiento_tareas.find(t => t.id === nueva.id).estatus).toBe('completada');
    expect(document.querySelector('#seg-drawer .seg-barra-hecho.is-done').textContent).toContain('Hecha');
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
});

test('reabrir una renovación ofrece quitar la siguiente que ya se programó', async () => {
    window.confirm = jest.fn(() => true);
    const original = db.seguimiento_tareas.find(t => t.id === 'a2');
    const siguiente = db.seguimiento_tareas.find(t => t.id === original.siguiente_id);
    expect(siguiente.estatus).toBe('pendiente');
    window.seguimientoModule.abrir('a2');
    await esperar();
    document.querySelector('#seg-drawer .seg-barra-hecho [data-dr="completar"]').click();
    await esperar(12);
    expect(window.confirm).toHaveBeenCalled();
    expect(db.seguimiento_tareas.find(t => t.id === 'a2').estatus).toBe('pendiente');
    expect(db.seguimiento_tareas.find(t => t.id === siguiente.id).estatus).toBe('cancelada');
    expect(db.seguimiento_tareas.find(t => t.id === 'a2').siguiente_id).toBeNull();
    document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
});

test('tablero y calendario se pintan con las mismas tareas', async () => {
    document.querySelector('#seg-views [data-vista="tablero"]').click();
    await esperar();
    const cols = [...document.querySelectorAll('#seg-body .seg-col-head .seg-pill')].map(p => p.textContent.trim());
    expect(cols).toEqual(['Pendiente', 'En proceso', 'En revisión', 'Detenida', 'Completada']);
    expect(document.querySelector('#seg-body .seg-card[data-id="a1"]')).not.toBeNull();
    // Las tarjetas también se pueden palomear.
    expect(document.querySelector('#seg-body .seg-card[data-id="a1"] .seg-hecho[data-accion="completar"]')).not.toBeNull();

    document.querySelector('#seg-views [data-vista="calendario"]').click();
    await esperar();
    expect(document.querySelectorAll('#seg-body .seg-cal-day').length % 7).toBe(0);

    document.querySelector('#seg-views [data-vista="resumen"]').click();
    await esperar();
    expect(document.querySelectorAll('#seg-body .seg-sd-card')).toHaveLength(6);

    document.querySelector('#seg-views [data-vista="lista"]').click();
    await esperar();
});

test('los tooltips son propios del módulo, no los del navegador', async () => {
    // Ningún title nativo en el módulo: todos pasan por data-tip.
    expect(document.querySelectorAll('#seguimiento-section [title], #seg-portal [title]')).toHaveLength(0);
    const casilla = document.querySelector('#seg-body .seg-row .seg-hecho');
    casilla.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 450));
    const tipEl = document.getElementById('seg-tip');
    expect(tipEl.hidden).toBe(false);
    expect(tipEl.querySelector('.seg-tip-h').textContent).toContain('Marcar como hecha');
    expect(tipEl.querySelector('.seg-tip-sub')).not.toBeNull();
    // Al salir del elemento se va.
    casilla.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(tipEl.hidden).toBe(true);
    // El botón de nueva tarea enseña su atajo.
    expect(document.getElementById('seg-btn-nueva').dataset.tipKbd).toBe('N');
});

test('quien no tiene acceso no ve mensaje: regresa a su sección de inicio', async () => {
    rol = null;
    window.dispatchEvent(new CustomEvent('aifa:login'));
    await esperar();
    expect(document.getElementById('menu-seguimiento').style.display).toBe('none');
    expect(document.getElementById('seg-body')).toBeNull();
    expect(seccion().textContent.trim()).toBe('');
    expect(window.showSection).toHaveBeenCalledWith('coord-auditoria');
    expect(seccion().classList.contains('active')).toBe(false);
});

test('sin sesión no se mueve nada: manda la pantalla de inicio de sesión', async () => {
    window.showSection.mockClear();
    sesion = null;
    rol = 'admin';
    seccion().classList.add('active');
    window.dispatchEvent(new CustomEvent('aifa:login'));
    await esperar();
    expect(document.getElementById('menu-seguimiento').style.display).toBe('none');
    expect(window.showSection).not.toHaveBeenCalled();
    seccion().classList.remove('active');
});

test('al volver a tener acceso, reaparece', async () => {
    sesion = { user: { email: 'isaac.lopez@aifa.operaciones', user_metadata: {} } };
    rol = 'admin';
    window.dispatchEvent(new CustomEvent('aifa:login'));
    await esperar();
    expect(document.getElementById('menu-seguimiento').style.display).toBe('');
});

test('index.html sólo agrega el botón oculto y los archivos del módulo', () => {
    const html = leer('index.html');
    expect(html).toMatch(/<a class="menu-item si-link si-link--l1" href="#" data-section="seguimiento" id="menu-seguimiento" style="display:none;" aria-hidden="true">/);
    // Va dentro de la tarjeta de Operación, al final: después de Archivo.
    const op = html.indexOf('id="sg-operacion"');
    const archivo = html.indexOf('id="sg-archivo"');
    const sso = html.indexOf('<!-- SSO -->');
    const link = html.indexOf('id="menu-seguimiento"');
    expect(link).toBeGreaterThan(op);
    expect(link).toBeGreaterThan(archivo);
    expect(link).toBeLessThan(sso);
    expect(html).toContain('<script src="js/seguimiento-core.js');
    expect(html).toContain('<script src="js/seguimiento.js');
});
