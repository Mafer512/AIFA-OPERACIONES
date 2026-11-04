/**
 * @jest-environment jsdom
 *
 * Cambiar el número de empleado. El número es la llave de todo lo del
 * colaborador (ficha, cursos, expediente, historial, portal QR, Seguimiento y
 * archivos en Storage), así que no se cambia como un campo más: la base lo
 * mueve en una sola transacción y la aplicación renombra los archivos que se
 * buscan por número. Y el cambio queda en el historial.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(raiz, 'db', 'colab_cambiar_num_empleado.sql'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    if (j < 0) throw new Error('Sin cierre: ' + desde);
    return app.slice(i, j);
}

const CODIGO = trozo('const COLAB_NUM_VALIDO', '/* -- Abrir modal editor -- */');
const MARCADO = trozo('<!-- No. de empleado: se cambia aparte', '<div class="col-12 col-md-6"><label class="form-label fw-semibold small">Nombre</label>');

describe('la función de la base', () => {
    test('sólo un editor, y nunca a un número que ya es de alguien', () => {
        expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.colab_cambiar_num_empleado\(\s*p_anterior\s+text,\s*p_nuevo\s+text,\s*p_usuario_nombre\s+text DEFAULT NULL\s*\)/);
        expect(sql).toContain('SECURITY DEFINER');
        expect(sql).toContain('IF NOT public.is_colab_editor() THEN');
        expect(sql).toContain("RAISE EXCEPTION 'El número % ya pertenece a %.'");
        // Registros sueltos con el número nuevo (de alguien que ya no está) tampoco se mezclan.
        expect(sql).toContain('Ya hay registros guardados con el número');
        expect(sql).toContain('FOR UPDATE');
    });

    test('mueve todo lo que cuelga del número y lo deja en el historial', () => {
        ['colab_historial', 'colab_cursos', 'colab_expediente', 'colab_onboarding_links'].forEach(t =>
            expect(sql).toContain(`ARRAY['${t}',`));
        expect(sql).toContain("ARRAY['seguimiento_tareas',     'responsable_num']");
        expect(sql).toMatch(/INSERT INTO public\.colab_historial \(num_empleado, campo, valor_anterior, valor_nuevo, usuario_id, usuario_nombre, fecha\)\s*VALUES \(v_new, 'num_empleado', v_ant, v_new, auth\.uid\(\)/);
        // La columna puede ser numérica: se respeta su tipo.
        expect(sql).toContain("format('UPDATE public.agenda_2026 SET %I = $1::%s WHERE btrim(%I::text) = $2', v_col, v_tipo, v_col)");
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.colab_cambiar_num_empleado(text, text, text) TO authenticated;');
        expect(sql).not.toMatch(/TO anon/i);
    });
});

function montar({ rpc, archivos = {}, movimientos = [] } = {}) {
    document.body.innerHTML = '<div id="colabEditModal"><small id="colab-edit-num-label"></small>' + MARCADO + '</div>';
    const fila = { num_empleado: '1551', nombre: 'Isaac López', foto_url: 'https://x/storage/v1/object/public/employee-photos/1551.jpg', cv_url: 'https://x/storage/v1/object/public/employee-cvs/1551.pdf' };
    const otro = { num_empleado: '1552', nombre: 'Ana Robles' };
    const updates = [];
    const sb = {
        rpc: jest.fn(rpc || (async () => ({ data: { ok: true, movidos: { colab_cursos: 3, colab_historial: 7 } }, error: null }))),
        from: () => ({ update(p) { updates.push(p); return { eq: async () => ({ error: null }) }; } }),
        storage: {
            from: bucket => ({
                list: async carpeta => ({ data: (archivos[bucket + ':' + carpeta] || []).map(name => ({ name })), error: null }),
                move: async (desde, hacia) => { movimientos.push([bucket, desde, hacia]); return { error: null }; },
            }),
        },
    };
    const ctx = { alerts: [], historia: [], fichas: [], historiales: [] };
    const deps = {
        document, sessionStorage: { getItem: k => (k === 'user_fullname' ? 'Isaac Azhael López Cancino' : null) },
        window: { supabaseClient: sb, logHistory: (...a) => ctx.historia.push(a) },
        gc: (r, k) => (k === 'num' ? r.num_empleado : k === 'foto' ? r.foto_url : r[k]),
        val: v => (v == null ? '' : String(v)),
        confirm: () => true, alert: m => ctx.alerts.push(m),
        colabRequireEdit: () => true,
        renderFicha: r => ctx.fichas.push(r),
        colabCargarHistorial: n => ctx.historiales.push(n),
        colabCols: { num: 'num_empleado', foto: 'foto_url', cv_url: 'cv_url', nombre: 'nombre' },
        EMPLOYEE_DOCS_BUCKET: 'employee-cvs', EMPLOYEE_DOCS_PREFIX: 'amonest/', EMPLOYEE_COMENT_PREFIX: 'comentarios/',
        row: fila, cache: [fila, otro],
    };
    const api = new Function('deps', `
        const { document, sessionStorage, window, gc, val, confirm, alert, colabRequireEdit, renderFicha, colabCargarHistorial,
                colabCols, EMPLOYEE_DOCS_BUCKET, EMPLOYEE_DOCS_PREFIX, EMPLOYEE_COMENT_PREFIX } = deps;
        let colabCurrentRow = deps.row, colabCache = deps.cache, colabDirectoryUniverse = {}, _vacCurrentNumEmpl = null;
        ${CODIGO}
        return { abrir: window.colabNumAbrir, validar: window.colabNumValidar, aplicar: window.colabNumAplicar, vac: () => _vacCurrentNumEmpl };
    `)(deps);
    // Los onclick del marcado buscan las funciones en el window de jsdom.
    global.colabNumValidar = api.validar; global.colabNumAplicar = api.aplicar; global.colabNumCerrar = deps.window.colabNumCerrar;
    return { api, fila, sb, ctx, updates, movimientos };
}

const escribir = valor => {
    const input = document.getElementById('ce-num-nuevo');
    input.value = valor;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};
const mensaje = () => document.getElementById('ce-num-msg').textContent;
const aplicar = () => document.getElementById('ce-num-aplicar');

describe('en el editor', () => {
    test('avisa mientras se escribe: inválido, el mismo, o de otra persona', () => {
        const { api } = montar();
        api.abrir();
        expect(document.getElementById('ce-num-form').classList.contains('d-none')).toBe(false);
        escribir('15 52');
        expect(mensaje()).toContain('sin espacios');
        expect(aplicar().disabled).toBe(true);
        escribir('1551');
        expect(mensaje()).toContain('mismo número');
        escribir('1552');
        expect(mensaje()).toContain('ya pertenece a Ana Robles');
        expect(aplicar().disabled).toBe(true);
        escribir('2001');
        expect(mensaje()).toContain('1551');
        expect(mensaje()).toContain('2001');
        expect(aplicar().disabled).toBe(false);
    });

    test('cambia en la base, renombra sólo sus archivos y lo deja en el historial', async () => {
        const archivos = {
            'employee-photos:': ['1551.jpg', '15510.jpg'],
            'employee-cvs:': ['1551.pdf', 'amonest', 'comentarios'],
            'employee-cvs:amonest': ['1551_1.pdf', '1551_2.pdf', '15510_1.pdf'],
            'employee-cvs:comentarios': ['1551_1.pdf'],
        };
        const { api, fila, sb, ctx, updates, movimientos } = montar({ archivos });
        api.abrir();
        escribir('2001');
        await api.aplicar();

        expect(sb.rpc).toHaveBeenCalledWith('colab_cambiar_num_empleado', { p_anterior: '1551', p_nuevo: '2001', p_usuario_nombre: 'Isaac Azhael López Cancino' });
        // Sólo los archivos de 1551, no los de 15510.
        expect(movimientos).toEqual([
            ['employee-photos', '1551.jpg', '2001.jpg'],
            ['employee-cvs', '1551.pdf', '2001.pdf'],
            ['employee-cvs', 'amonest/1551_1.pdf', 'amonest/2001_1.pdf'],
            ['employee-cvs', 'amonest/1551_2.pdf', 'amonest/2001_2.pdf'],
            ['employee-cvs', 'comentarios/1551_1.pdf', 'comentarios/2001_1.pdf'],
        ]);
        // Las direcciones guardadas de foto y CV ya apuntan al nombre nuevo.
        expect(updates).toEqual([{
            foto_url: 'https://x/storage/v1/object/public/employee-photos/2001.jpg',
            cv_url: 'https://x/storage/v1/object/public/employee-cvs/2001.pdf',
        }]);
        expect(fila.num_empleado).toBe('2001');
        expect(api.vac()).toBe('2001');
        expect(document.getElementById('ce-num-actual').textContent).toBe('2001');
        expect(document.getElementById('colab-edit-num-label').textContent).toBe('No. 2001 — Isaac López');
        // Historial: el del colaborador lo escribe la base; aquí se recarga y va a Historia.
        expect(ctx.historiales).toEqual(['2001']);
        expect(ctx.historia[0][3].changes).toEqual([{ campo: 'num_empleado', anterior: '1551', nuevo: '2001' }]);
        expect(ctx.alerts.at(-1)).toContain('ahora es el No. 2001');
        expect(ctx.alerts.at(-1)).toContain('3 curso(s)');
    });

    test('si la base no tiene la función, dice qué SQL correr y no toca nada', async () => {
        const { api, fila, movimientos } = montar({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.colab_cambiar_num_empleado' } }) });
        api.abrir();
        escribir('2001');
        await api.aplicar();
        expect(mensaje()).toContain('db/colab_cambiar_num_empleado.sql');
        expect(movimientos).toHaveLength(0);
        expect(fila.num_empleado).toBe('1551');
        expect(aplicar().disabled).toBe(false);
    });

    test('el error de la base se muestra tal cual (p. ej. número ocupado)', async () => {
        const { api, fila } = montar({ rpc: async () => ({ data: null, error: { code: 'P0001', message: 'El número 2001 ya pertenece a Pedro Ruiz.' } }) });
        api.abrir();
        escribir('2001');
        await api.aplicar();
        expect(mensaje()).toContain('ya pertenece a Pedro Ruiz');
        expect(fila.num_empleado).toBe('1551');
    });

    test('el historial muestra el campo con su nombre', () => {
        expect(app).toContain("num_empleado:'No. de empleado'");
    });
});
