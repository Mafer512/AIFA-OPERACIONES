/**
 * @jest-environment jsdom
 *
 * Validación del Director, vista por quien NO es admin de Seguimiento:
 * al palomear una tarea la entrega (queda «Por validar»), no puede ponerla
 * como Completada ni reabrir lo que el Director ya validó. Y en cada subtarea
 * anota cómo se hizo y adjunta su respaldo (Word, Excel, PDF o imagen).
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

/* ---------- Lo que decide el núcleo ---------- */
describe('reglas', () => {
    const HOY = '2026-11-09';
    test('una tarea entregada sigue abierta, pero ya no cuenta como vencida', () => {
        const t = { estatus: 'por_validar', fecha_limite: '2026-11-01', entregada_en: '2026-10-30T10:00:00' };
        expect(C.estaAbierta(t)).toBe(true);
        expect(C.situacion(t, HOY)).toBe('por_validar');
        const s = C.estadisticas([t, { estatus: 'pendiente', fecha_limite: '2026-11-01' }], HOY);
        expect(s).toMatchObject({ abiertas: 2, por_validar: 1, vencidas: 1, en_proceso: 0, completadas: 0 });
    });

    test('«a tiempo» se mide con la entrega, no con lo que tardó el visto bueno', () => {
        const base = { estatus: 'completada', fecha_limite: '2026-10-08', completada_en: '2026-10-20T10:00:00' };
        expect(C.completadaATiempo(Object.assign({ entregada_en: '2026-10-07T18:00:00' }, base))).toBe(true);
        expect(C.completadaATiempo(Object.assign({ entregada_en: '2026-10-10T18:00:00' }, base))).toBe(false);
        expect(C.completadaATiempo(base)).toBe(false);   // sin entrega: cuenta el cierre
    });

    test('archivos aceptados: PDF, Word, Excel e imágenes; la extensión manda', () => {
        expect(['a.pdf', 'b.DOCX', 'c.doc', 'd.xlsx', 'e.xls', 'f.jpeg', 'g.png'].map(n => C.extensionArchivo(n))).toEqual(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'jpg', 'png']);
        expect(C.extensionArchivo('datos.csv', 'application/vnd.ms-excel')).toBeNull();
        expect(C.problemaArchivo({ name: 'x.exe', size: 10 })).toContain('sólo se aceptan');
        expect(C.problemaArchivo({ name: 'grande.pdf', size: 26 * 1024 * 1024 })).toContain('25 MB');
        expect(C.problemaArchivo({ name: 'ok.docx', size: 2048 })).toBeNull();
        expect(C.rutasDeArchivos({ evidencias: [{ path: 'a/1.pdf' }], checklist: [{ archivos: [{ path: 'a/2.docx' }] }, {}] })).toEqual(['a/1.pdf', 'a/2.docx']);
    });

    test('la base aplica la misma regla (db/seguimiento_validacion.sql)', () => {
        const sql = leer('db/seguimiento_validacion.sql');
        expect(sql).toContain("'por_validar'");
        expect(sql).toMatch(/NEW\.estatus = 'completada' AND v_antes IS DISTINCT FROM 'completada' AND NOT v_admin THEN\s+NEW\.estatus := 'por_validar'/);
        expect(sql).toMatch(/v_antes = 'completada' AND NEW\.estatus <> 'completada' AND NOT v_admin THEN\s+RAISE EXCEPTION/);
        expect(sql).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(sql).toContain('26214400');
        // Corre antes que la que pone la fecha de cierre.
        expect('trg_seguimiento_validacion' < 'trg_touch_seguimiento').toBe(true);
    });
});

/* ---------- En la página, con la cuenta de un editor ---------- */
function fakeSupabase(db, opciones) {
    const llamadas = [];
    let folio = 100;
    const cliente = {
        llamadas, subidos: [], borrados: [], firmados: [],
        rpc: async () => ({ data: opciones.rol, error: null }),
        from(tabla) {
            const q = { tabla, op: 'select', filtros: [], datos: null, uno: false };
            const correr = () => {
                llamadas.push(q);
                const filas = db[tabla] || (db[tabla] = []);
                const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
                if (q.op === 'insert') {
                    const nueva = Object.assign({ id: 'n' + (++folio), folio, creado_en: new Date().toISOString() }, q.datos);
                    filas.push(nueva);
                    return { data: Object.assign({}, nueva), error: null };
                }
                if (q.op === 'update') {
                    const hits = filas.filter(coincide);
                    hits.forEach(r => {
                        const d = Object.assign({}, q.datos);
                        // Lo que hace el disparador de la base.
                        if (d.estatus === 'completada' && opciones.rol !== 'admin') d.estatus = 'por_validar';
                        if (r.estatus === 'completada' && d.estatus && d.estatus !== 'completada' && opciones.rol !== 'admin') {
                            throw Object.assign(new Error('Esta tarea ya fue validada'), { code: '42501' });
                        }
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
                then(ok, mal) {
                    let r;
                    try { r = correr(); } catch (e) { r = { data: null, error: e }; }
                    return Promise.resolve(r).then(ok, mal);
                },
            };
            return api;
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {},
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: opciones.email, user_metadata: {} } } } }) },
        storage: { from() { return {
            upload: async (ruta, archivo, o) => { cliente.subidos.push({ ruta, nombre: archivo.name, tipo: o && o.contentType }); return { error: null }; },
            remove: async rutas => { cliente.borrados.push(...rutas); return {}; },
            createSignedUrl: async (ruta, seg, o) => { cliente.firmados.push({ ruta, o }); return { data: { signedUrl: 'https://x/' + ruta }, error: null }; },
        }; } },
    };
    return cliente;
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 20)); };
const tarea = o => Object.assign({ folio: 1, tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', aviso_dias: 7, recurrencia: 'ninguna',
    checklist: [], evidencias: [], etiquetas: [], subdireccion: 'SSO', entregada_en: null, entregada_por: null, validada_en: null, validada_por: null }, o);

describe('un editor entrega; el Director valida', () => {
    let db;
    let sb;
    beforeAll(async () => {
        document.body.innerHTML = `
            <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
            <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
        db = {
            seguimiento_acceso: [{ email: 'luis.garcia@aifa.operaciones', nombre: 'Luis García', rol: 'editor' }],
            seguimiento_tareas: [
                tarea({ id: 'e1', folio: 1, titulo: 'Inspección de pista', fecha_limite: '2026-12-01',
                        checklist: [{ id: 's1', texto: 'Levantamiento en sitio', hecho: true }, { id: 's2', texto: 'Informe', hecho: false }] }),
                tarea({ id: 'v1', folio: 2, titulo: 'Plan de fauna validado', estatus: 'completada', validada_por: 'Gonzalo Sandoval', validada_en: '2026-11-02T10:00:00', completada_en: '2026-11-02T10:00:00' }),
            ],
            seguimiento_comentarios: [], seguimiento_actividad: [], agenda_2026: [],
        };
        sb = fakeSupabase(db, { rol: 'editor', email: 'luis.garcia@aifa.operaciones' });
        window.supabaseClient = sb;
        sessionStorage.setItem('user_fullname', 'Luis García');
        window.showSection = jest.fn();
        window.open = jest.fn(() => ({ close() {}, location: {} }));
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        new Function(leer('js/seguimiento.js'))();
        await esperar();
        document.getElementById('seguimiento-section').classList.add('active');
        await esperar();
    });

    const fila = id => document.querySelector('#seg-body .seg-row[data-id="' + id + '"]');
    const toasts = () => document.getElementById('seg-toasts').textContent;

    test('al palomear la entrega: queda «Por validar», con su nombre', async () => {
        fila('e1').querySelector('[data-accion="completar"]').click();
        await esperar();
        const t = db.seguimiento_tareas.find(x => x.id === 'e1');
        expect(t.estatus).toBe('por_validar');
        expect(t.entregada_por).toBe('Luis García');
        expect(toasts()).toContain('Queda «Por validar» hasta que el Director la revise');
        expect(fila('e1').querySelector('.seg-hecho').classList.contains('is-validar')).toBe(true);
        expect(fila('e1').classList.contains('is-por_validar')).toBe(true);
        // Ya no aparece como vencida ni la cuenta así el aviso de arriba.
        expect(document.getElementById('seg-validar').textContent).toBe('');   // ese aviso es sólo del Director
        expect(db.seguimiento_actividad.some(a => a.tarea_id === 'e1' && a.accion === 'entrego')).toBe(true);
    });

    test('en el menú de estatus no puede poner «Completada»: entrega', () => {
        fila('e1').querySelector('[data-accion="estatus"]').click();
        const ops = [...document.querySelectorAll('#seg-menu .seg-menu-item[data-i]')].map(b => b.textContent.trim());
        expect(ops).not.toContain('Completada');
        expect(ops).toContain('Por validar');
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    test('en el detalle ve que espera la validación y puede retirar la entrega', async () => {
        window.seguimientoModule.abrir('e1');
        await esperar(4);
        const barra = document.querySelector('#seg-drawer .seg-barra-hecho');
        expect(barra.classList.contains('is-validar')).toBe(true);
        expect(barra.textContent).toContain('espera la validación del Director');
        expect(barra.querySelector('[data-dr="validar"]')).toBeNull();
        barra.querySelector('[data-dr="retirar"]').click();
        await esperar(2);
        document.querySelector('#seg-confirm [data-cf="si"]').click();
        await esperar();
        expect(db.seguimiento_tareas.find(x => x.id === 'e1').estatus).toBe('en_proceso');
    });

    test('en cada subtarea anota cómo se hizo', async () => {
        const item = () => document.querySelector('#seg-ck [data-ck="s1"]');
        item().querySelector('[data-ck-accion="obs-abrir"]').click();
        await esperar(2);
        const ta = item().querySelector('textarea[data-ck-accion="obs"]');
        expect(document.activeElement).toBe(ta);
        ta.value = 'Se recorrió la pista con el supervisor de turno; sin hallazgos mayores.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await esperar();
        const s1 = db.seguimiento_tareas.find(x => x.id === 'e1').checklist.find(i => i.id === 's1');
        expect(s1.obs).toBe('Se recorrió la pista con el supervisor de turno; sin hallazgos mayores.');
    });

    test('y adjunta su respaldo: Word, Excel, PDF o imagen, en la carpeta de la tarea', async () => {
        const item = () => document.querySelector('#seg-ck [data-ck="s1"]');
        item().querySelector('[data-ck-accion="adjuntar"]').click();
        const entrada = document.getElementById('seg-file');
        const docx = new File(['PK'], 'Minuta de recorrido.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const xlsx = new File(['PK'], 'Hallazgos.xlsx', { type: '' });
        const exe = new File(['MZ'], 'programa.exe', { type: 'application/octet-stream' });
        Object.defineProperty(entrada, 'files', { value: [docx, xlsx, exe], configurable: true });
        entrada.dispatchEvent(new Event('change'));
        await esperar(14);
        const s1 = db.seguimiento_tareas.find(x => x.id === 'e1').checklist.find(i => i.id === 's1');
        expect(s1.archivos.map(a => a.nombre)).toEqual(['Minuta de recorrido.docx', 'Hallazgos.xlsx']);
        expect(s1.archivos.map(a => a.tipo)).toEqual(['docx', 'xlsx']);
        expect(sb.subidos.every(x => /^e1\/[A-Za-z0-9_-]{6,64}\.(docx|xlsx)$/.test(x.ruta))).toBe(true);
        expect(sb.subidos[1].tipo).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const aviso = document.getElementById('seg-confirm');
        expect(aviso.textContent).toContain('No se adjuntó «programa.exe»');
        expect(aviso.textContent).toContain('Tipo no permitido');
        expect(aviso.textContent).toContain('Los otros 2 sí se adjuntan');
        aviso.querySelector('[data-cf="si"]').click();
        // No se fue a las evidencias de la tarea.
        expect(db.seguimiento_tareas.find(x => x.id === 'e1').evidencias).toEqual([]);
        expect(item().querySelectorAll('.seg-ck-file')).toHaveLength(2);
        expect(db.seguimiento_actividad.some(a => a.accion === 'archivo_subtarea' && a.detalle.subtarea === 'Levantamiento en sitio')).toBe(true);
        // En la lista, la tarea cuenta sus archivos.
        expect(fila('e1').textContent).toContain('2');
    });

    test('Word y Excel se descargan con su nombre; se pueden quitar', async () => {
        const item = () => document.querySelector('#seg-ck [data-ck="s1"]');
        item().querySelector('[data-ck-file="0"]').click();
        await esperar(3);
        expect(sb.firmados.pop()).toMatchObject({ o: { download: 'Minuta de recorrido.docx' } });
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

        item().querySelector('[data-ck-file="1"] [data-ck-accion="archivo-quitar"]').click();
        await esperar(2);
        document.querySelector('#seg-confirm [data-cf="si"]').click();
        await esperar();
        const s1 = db.seguimiento_tareas.find(x => x.id === 'e1').checklist.find(i => i.id === 's1');
        expect(s1.archivos.map(a => a.nombre)).toEqual(['Minuta de recorrido.docx']);
        expect(sb.borrados).toHaveLength(1);
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        await esperar(2);
    });

    test('lo que el Director ya validó no lo puede reabrir', async () => {
        // Las validadas están entre las cerradas.
        document.getElementById('seg-btn-cerradas').click();
        await esperar(2);
        const c = fila('v1').querySelector('.seg-hecho');
        expect(c.classList.contains('is-done')).toBe(true);
        expect(c.disabled).toBe(true);
        window.seguimientoModule.abrir('v1');
        await esperar(4);
        const barra = document.querySelector('#seg-drawer .seg-barra-hecho');
        expect(barra.textContent).toContain('Hecha y validada');
        expect(barra.textContent).toContain('La validó Gonzalo Sandoval');
        expect(barra.querySelector('[data-dr="completar"]')).toBeNull();
    });
});
