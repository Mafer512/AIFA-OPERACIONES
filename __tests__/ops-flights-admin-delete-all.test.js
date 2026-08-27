/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const adminSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'ops-flights-admin.js'),
    'utf8'
);
const appSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'script.js'),
    'utf8'
);
const migrationSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'migrations', '031_conciliacion_eliminar_todos_los_vuelos.sql'),
    'utf8'
);

function renderFixture() {
    document.body.innerHTML = `
        <button id="btn-delete-admin-all"><i></i>Eliminar todo</button>
        <div id="admin-status-msg" class="d-none"></div>
        <span id="admin-flight-count-badge"></span>
        <span id="admin-selected-count"></span>
        <button id="btn-delete-admin-selected"></button>
        <input id="admin-select-all" type="checkbox">
        <div id="admin-days-grid"></div>
        <table><thead><tr></tr></thead><tbody id="tbody-admin-flights-csv"></tbody></table>
    `;
}

function loadAdmin(overrides = {}) {
    window.supabaseClient = overrides.supabaseClient;
    window.conciliacionBulkDelete = overrides.bulkDelete;
    window.prompt = jest.fn(() => 'BORRAR TODO');
    window.confirm = jest.fn(() => true);
    window.eval(adminSource);
    return window.opsFlightsAdmin;
}

beforeEach(() => {
    jest.useFakeTimers();
    renderFixture();
    localStorage.clear();
    delete window.opsFlightsAdmin;
    delete window.conciliacionBulkDelete;
    delete window.supabaseClient;
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

test('usa la RPC atómica, limpia borradores y refresca Manifiestos', async () => {
    const counts = {
        itinerario: 12,
        vuelos_manifiestos: 12,
        manifiestos_capturados: 5,
        bitacora_importacion: 12,
    };
    const rpc = jest.fn().mockResolvedValue({ data: counts, error: null });
    const afterDelete = jest.fn().mockResolvedValue(undefined);
    const api = loadAdmin({
        supabaseClient: { rpc },
        bulkDelete: {
            hasUnsavedCaptures: jest.fn(() => false),
            afterDelete,
        },
    });
    localStorage.setItem('aifa-conciliacion-borradores-v1', '{"fila":1}');

    await api.deleteAll();

    expect(rpc).toHaveBeenCalledWith('conciliacion_eliminar_todos_los_vuelos');
    expect(afterDelete).toHaveBeenCalledWith(counts);
    expect(localStorage.getItem('aifa-conciliacion-borradores-v1')).toBeNull();
    expect(document.getElementById('admin-status-msg').textContent).toContain('5 manifiestos capturados');
    expect(document.getElementById('btn-delete-admin-all').disabled).toBe(false);
});

test('no borra si hay capturas locales pendientes de guardar', async () => {
    const rpc = jest.fn();
    const api = loadAdmin({
        supabaseClient: { rpc },
        bulkDelete: {
            hasUnsavedCaptures: jest.fn(() => true),
            afterDelete: jest.fn(),
        },
    });

    await api.deleteAll();

    expect(window.prompt).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(document.getElementById('admin-status-msg').textContent).toContain('pendientes de guardar');
});

test('si la migración aún no está publicada, usa el respaldo RLS y verifica las tablas', async () => {
    const rows = {
        conciliacion_capturas_pendientes: 1,
        conciliacion_vuelo_overrides: 2,
        'Conciliación Manifiestos': 5,
        manifiestos_vuelos_editable: 12,
        itinerario_vuelos_editable: 12,
        vuelos_parte_operaciones_csv: 12,
    };
    const from = jest.fn(table => ({
        select: jest.fn(() => Promise.resolve({ count: rows[table], error: null })),
        delete: jest.fn(() => ({
            not: jest.fn(() => {
                rows[table] = 0;
                return Promise.resolve({ error: null });
            }),
        })),
    }));
    const rpc = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Function was not found in the schema cache' },
    });
    const afterDelete = jest.fn().mockResolvedValue(undefined);
    const api = loadAdmin({
        supabaseClient: { rpc, from },
        bulkDelete: {
            hasUnsavedCaptures: jest.fn(() => false),
            afterDelete,
        },
    });

    await api.deleteAll();

    expect(Object.values(rows)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(from).toHaveBeenCalledWith('Conciliación Manifiestos');
    expect(from).toHaveBeenCalledWith('itinerario_vuelos_editable');
    expect(afterDelete).toHaveBeenCalled();
});

test('script.js expone el puente que invalida caché y recarga Manifiestos', () => {
    expect(appSource).toContain('window.conciliacionBulkDelete = {');
    expect(appSource).toContain('hasUnsavedCaptures: _conciHasUnsavedCaptures');
    expect(appSource).toContain('allowLocalEditsReplace: true');
});

test('la RPC exige permisos de edición y elimina manifiestos capturados', () => {
    expect(migrationSource).toContain("NOT IN ('edit', 'admin')");
    expect(migrationSource).toContain('DELETE FROM public."Conciliación Manifiestos"');
    expect(migrationSource).toContain('DELETE FROM public.itinerario_vuelos_editable');
    expect(migrationSource).toContain('DELETE FROM public.manifiestos_vuelos_editable');
});
