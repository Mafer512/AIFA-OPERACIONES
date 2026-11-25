/**
 * @jest-environment jsdom
 *
 * Filtros para no dañar la base: lo que no se puede subir se explica en un
 * aviso y no se sube (un archivo de 1 GB, un programa renombrado a .pdf,
 * demasiados a la vez, repetidos…), los textos no pasan del límite y la base
 * tiene los mismos topes. Y al agregar una subtarea el panel se queda donde
 * uno está, sin regresar hasta arriba.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

describe('reglas', () => {
    test('un archivo de 1 GB no pasa, y el mensaje lo dice claro', () => {
        expect(C.problemaArchivo({ name: 'video.pdf', size: 1024 ** 3 })).toBe('Pesa 1 GB; el máximo es 25 MB.');
        expect(C.problemaArchivo({ name: 'nada.pdf', size: 0 })).toBe('Está vacío (0 bytes).');
        expect(C.problemaArchivo({ name: 'setup.exe', size: 10 })).toContain('Tipo no permitido');
        expect(C.problemaArchivo({ name: 'ok.xlsx', size: 25 * 1024 * 1024 })).toBeNull();
        expect(C.problemaArchivo({ name: 'casi.xlsx', size: 25 * 1024 * 1024 + 1 })).toContain('el máximo es 25 MB');
    });

    test('el contenido tiene que ser del tipo que dice su extensión', () => {
        const b = t => [...Buffer.from(t, 'binary')];
        expect(C.firmaValida('pdf', b('%PDF-1.7'))).toBe(true);
        expect(C.firmaValida('pdf', b('\r\n%PDF-1.4'))).toBe(true);      // con basura al inicio, como permite la norma
        expect(C.firmaValida('pdf', b('MZ\x90\x00'))).toBe(false);       // un .exe renombrado
        expect(C.firmaValida('png', [0x89, 0x50, 0x4E, 0x47, 0x0D])).toBe(true);
        expect(C.firmaValida('jpg', [0xFF, 0xD8, 0xFF, 0xE0])).toBe(true);
        expect(C.firmaValida('jpg', b('GIF89a'))).toBe(false);
        expect(C.firmaValida('docx', b('PK\x03\x04'))).toBe(true);
        expect(C.firmaValida('xls', [0xD0, 0xCF, 0x11, 0xE0, 0xA1])).toBe(true);
        expect(C.firmaValida('xlsx', b('<html>'))).toBe(false);
    });

    test('los topes de la página caben en los de la base', () => {
        const sql = leer('db/seguimiento_validacion.sql');
        const tope = re => +sql.match(re)[1];
        expect(C.LIMITES.subtareas).toBeLessThanOrEqual(tope(/jsonb_array_length\(checklist\)\s+<=\s+(\d+)/));
        expect(C.LIMITES.evidenciasPorTarea).toBeLessThanOrEqual(tope(/jsonb_array_length\(evidencias\)\s+<=\s+(\d+)/));
        expect(C.LIMITES.descripcion).toBeLessThanOrEqual(tope(/length\(coalesce\(descripcion, ''\)\)\s+<=\s+(\d+)/));
        expect(C.LIMITES.referencia).toBeLessThanOrEqual(tope(/length\(coalesce\(referencia, ''\)\)\s+<=\s+(\d+)/));
        expect(C.LIMITES.comentario).toBeLessThanOrEqual(tope(/BETWEEN 1 AND (\d+)/));
        expect(C.LIMITES.archivoBytes).toBe(tope(/file_size_limit = (\d+)/));
        // Topes que no fallan por lo que ya existe.
        expect(sql).toMatch(/seguimiento_tareas_limites_chk CHECK \([\s\S]*?\) NOT VALID;/);
    });
});

/* ---------- En la página ---------- */
function fakeSupabase(db) {
    const cliente = {
        subidos: [],
        rpc: async () => ({ data: 'admin', error: null }),
        from(tabla) {
            const q = { op: 'select', filtros: [], datos: null, uno: false };
            const correr = () => {
                const filas = db[tabla] || (db[tabla] = []);
                const coincide = r => q.filtros.every(([c, v]) => r[c] === v);
                if (q.op === 'insert') { const n = Object.assign({ id: 'n' + filas.length, folio: 50 + filas.length }, q.datos); filas.push(n); return { data: Object.assign({}, n), error: null }; }
                if (q.op === 'update') { const hits = filas.filter(coincide); hits.forEach(r => Object.assign(r, q.datos)); return { data: q.uno ? (hits[0] ? Object.assign({}, hits[0]) : null) : hits, error: null }; }
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
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: 'isaac.lopez@aifa.operaciones', user_metadata: {} } } } }) },
        storage: { from() { return {
            upload: async (ruta, archivo) => { cliente.subidos.push(archivo.name); return { error: null }; },
            remove: async () => ({}), createSignedUrl: async () => ({ data: { signedUrl: 'x' } }),
        }; } },
    };
    return cliente;
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 20)); };
const pdf = (nombre, tam) => {
    const f = new File(['%PDF-1.4 ' + nombre], nombre, { type: 'application/pdf' });
    if (tam) Object.defineProperty(f, 'size', { value: tam });
    return f;
};

describe('en la página', () => {
    let db;
    let sb;
    beforeAll(async () => {
        document.body.innerHTML = `
            <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
            <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
        db = {
            seguimiento_acceso: [{ email: 'isaac.lopez@aifa.operaciones', rol: 'admin' }],
            seguimiento_tareas: [
                { id: 't1', folio: 1, titulo: 'Renovar licencia', tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', subdireccion: 'SSO', aviso_dias: 7,
                  recurrencia: 'ninguna', fecha_inicio: '2026-11-01', fecha_limite: '2026-12-15', etiquetas: [], evidencias: [], entregada_en: null,
                  checklist: [{ id: 'a', texto: 'Paso uno', hecho: false }, { id: 'b', texto: 'Paso dos', hecho: false }] },
                { id: 't2', folio: 2, titulo: 'Tarea llena', tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', subdireccion: 'SSO', aviso_dias: 7,
                  recurrencia: 'ninguna', etiquetas: [], evidencias: [], entregada_en: null,
                  checklist: Array.from({ length: C.LIMITES.subtareas }, (_, i) => ({ id: 'x' + i, texto: 'Paso ' + (i + 1), hecho: false })) },
            ],
            seguimiento_comentarios: [], seguimiento_actividad: [], agenda_2026: [],
        };
        sb = fakeSupabase(db);
        window.supabaseClient = sb;
        window.showSection = jest.fn();
        new Function(leer('js/seguimiento.js'))();
        await esperar();
        document.getElementById('seguimiento-section').classList.add('active');
        await esperar();
        window.seguimientoModule.abrir('t1');
        await esperar(4);
    });

    const elegir = async archivos => {
        const entrada = document.getElementById('seg-file');
        Object.defineProperty(entrada, 'files', { value: archivos, configurable: true });
        entrada.dispatchEvent(new Event('change'));
        await esperar(12);
    };
    const aviso = () => document.getElementById('seg-confirm');
    const cerrarAviso = () => aviso().querySelector('[data-cf="si"]')?.click();
    const evidencias = () => db.seguimiento_tareas.find(t => t.id === 't1').evidencias.map(e => e.nombre);

    test('un archivo de 1 GB no se sube: aviso y nada llega al almacenamiento', async () => {
        await elegir([pdf('video-del-simulacro.pdf', 1024 ** 3)]);
        expect(aviso().hidden).toBe(false);
        expect(aviso().textContent).toContain('No se adjuntó «video-del-simulacro.pdf»');
        expect(aviso().textContent).toContain('Pesa 1 GB; el máximo es 25 MB.');
        expect(aviso().querySelector('[data-cf="no"]')).toBeNull();   // es sólo un aviso
        expect(sb.subidos).toEqual([]);
        expect(evidencias()).toEqual([]);
        cerrarAviso();
    });

    test('un programa renombrado a .pdf tampoco', async () => {
        await elegir([new File(['MZ\x90\x00\x03'], 'factura.pdf', { type: 'application/pdf' })]);
        expect(aviso().textContent).toContain('Su contenido no es de un PDF');
        expect(sb.subidos).toEqual([]);
        cerrarAviso();
    });

    test('con varios: se suben los buenos y se listan los que no, con su motivo', async () => {
        await elegir([pdf('oficio.pdf'), new File(['x'], 'notas.txt', { type: 'text/plain' }), pdf('enorme.pdf', 30 * 1024 * 1024)]);
        expect(evidencias()).toEqual(['oficio.pdf']);
        expect(aviso().textContent).toContain('No se adjuntaron 2 archivos');
        expect(aviso().textContent).toContain('notas.txt');
        expect(aviso().textContent).toContain('enorme.pdf');
        expect(aviso().textContent).toContain('El otro archivo sí se adjunta.');
        cerrarAviso();
    });

    test('no se repite un archivo que ya está, ni van más de 10 a la vez', async () => {
        await elegir([pdf('oficio.pdf')]);
        expect(aviso().textContent).toContain('Ya está adjunto aquí.');
        cerrarAviso();
        sb.subidos.length = 0;
        await elegir(Array.from({ length: 12 }, (_, i) => pdf('hoja-' + (i + 1) + '.pdf')));
        expect(sb.subidos).toHaveLength(10);
        expect(aviso().textContent).toContain('hoja-11.pdf');
        expect(aviso().textContent).toContain('hasta 10 archivos a la vez');
        cerrarAviso();
    });

    test('al agregar una subtarea el panel se queda donde estaba y la nueva se ilumina', async () => {
        const cuerpo = () => document.querySelector('#seg-drawer .seg-dr-body');
        const antes = cuerpo();
        antes.scrollTop = 640;
        document.getElementById('seg-ck-nuevo').value = 'Paso tres';
        document.querySelector('#seg-drawer [data-ck-accion="agregar"]').click();
        await esperar();
        expect(cuerpo()).toBe(antes);                 // no se volvió a pintar todo el panel
        expect(cuerpo().scrollTop).toBe(640);
        const nueva = [...document.querySelectorAll('#seg-ck .seg-ck-item')].pop();
        expect(nueva.querySelector('input[data-ck-accion="texto"]').value).toBe('Paso tres');
        expect(nueva.classList.contains('is-nueva')).toBe(true);
        expect(document.activeElement.id).toBe('seg-ck-nuevo');   // listo para la siguiente
        expect(db.seguimiento_tareas.find(t => t.id === 't1').checklist.map(i => i.texto)).toEqual(['Paso uno', 'Paso dos', 'Paso tres']);
        // Palomear una subtarea tampoco lo mueve.
        const casilla = document.querySelector('#seg-ck [data-ck="a"] input[data-ck-accion="marcar"]');
        casilla.checked = true;
        casilla.dispatchEvent(new Event('change', { bubbles: true }));
        await esperar();
        expect(cuerpo().scrollTop).toBe(640);
    });

    test('y si algo sí repinta todo el panel, conserva el desplazamiento', async () => {
        document.querySelector('#seg-drawer .seg-dr-body').scrollTop = 420;
        document.querySelector('#seg-drawer [data-dr="prioridad"]').click();
        [...document.querySelectorAll('#seg-menu .seg-menu-item')].find(b => b.textContent.includes('Alta')).click();
        await esperar();
        expect(db.seguimiento_tareas.find(t => t.id === 't1').prioridad).toBe('alta');
        expect(document.querySelector('#seg-drawer .seg-dr-body').scrollTop).toBe(420);
        // Al cerrar y abrir otra vez, empieza arriba.
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        window.seguimientoModule.abrir('t1');
        await esperar(4);
        expect(document.querySelector('#seg-drawer .seg-dr-body').scrollTop).toBe(0);
    });

    test('una tarea no pasa del tope de subtareas', async () => {
        document.querySelector('#seg-drawer [data-dr="cerrar"]').click();
        window.seguimientoModule.abrir('t2');
        await esperar(4);
        document.getElementById('seg-ck-nuevo').value = 'Una más';
        document.querySelector('#seg-drawer [data-ck-accion="agregar"]').click();
        await esperar();
        expect(db.seguimiento_tareas.find(t => t.id === 't2').checklist).toHaveLength(C.LIMITES.subtareas);
        expect(document.getElementById('seg-toasts').textContent).toContain('hasta ' + C.LIMITES.subtareas + ' subtareas');
    });
});
