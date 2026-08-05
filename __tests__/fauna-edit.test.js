/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const readSource = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('Fauna · persistencia de edición', () => {
    beforeAll(() => {
        window.supabaseClient = {
            auth: { onAuthStateChange: jest.fn() }
        };
        window.eval(readSource('js/data-manager.js'));
    });

    test('envía PATCH lógico por id y exige exactamente una fila actualizada', async () => {
        const result = { id: 92, date: '2026-07-30', time: '05:51:00', remains_count: 1 };
        const updateQuery = {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue({ data: [result], error: null, status: 200, statusText: 'OK' })
        };
        window.supabaseClient = {
            auth: {
                onAuthStateChange: jest.fn(),
                getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'valid' } }, error: null })
            },
            from: jest.fn().mockReturnValue(updateQuery)
        };

        const payload = { date: '2026-07-30', time: '05:51', size: 'Pequeño', remains_count: 1 };
        const rows = await window.dataManager.updateWildlifeStrike(92, payload);

        expect(window.supabaseClient.from).toHaveBeenCalledWith('wildlife_strikes');
        expect(updateQuery.update).toHaveBeenCalledWith(payload);
        expect(updateQuery.eq).toHaveBeenCalledWith('id', '92');
        expect(updateQuery.select).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([result]);
    });

    test('distingue una fila existente bloqueada por RLS de una actualización exitosa', async () => {
        const updateQuery = {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue({ data: [], error: null, status: 200, statusText: 'OK' })
        };
        const lookupQuery = {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: { id: 92 }, error: null, status: 200 })
        };
        window.supabaseClient = {
            auth: {
                onAuthStateChange: jest.fn(),
                getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'valid' } }, error: null })
            },
            from: jest.fn()
                .mockReturnValueOnce(updateQuery)
                .mockReturnValueOnce(lookupQuery)
        };

        await expect(window.dataManager.updateWildlifeStrike(92, { airline: 'Viva Aerobus' }))
            .rejects.toMatchObject({ code: 'FAUNA_UPDATE_FORBIDDEN', httpStatus: 403 });
    });

    test('no envía la actualización si la sesión ya no existe', async () => {
        window.supabaseClient = {
            auth: {
                onAuthStateChange: jest.fn(),
                getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null })
            },
            from: jest.fn()
        };

        await expect(window.dataManager.updateWildlifeStrike(92, { location: '04L-22R' }))
            .rejects.toMatchObject({ code: 'FAUNA_AUTH_REQUIRED', httpStatus: 401 });
        expect(window.supabaseClient.from).not.toHaveBeenCalled();
    });

    test('rechaza un identificador vacío antes de construir la petición', async () => {
        window.supabaseClient = {
            auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() },
            from: jest.fn()
        };

        await expect(window.dataManager.updateWildlifeStrike('', { location: 'A6' }))
            .rejects.toMatchObject({ code: 'FAUNA_INVALID_ID', httpStatus: 400 });
        expect(window.supabaseClient.auth.getSession).not.toHaveBeenCalled();
    });
});

describe('Fauna · comportamiento del modal al guardar', () => {
    let adminUI;
    let modalInstance;

    beforeAll(() => {
        document.body.innerHTML = '';
        modalInstance = { show: jest.fn(), hide: jest.fn() };
        window.bootstrap = {
            Modal: jest.fn(() => modalInstance)
        };
        window.eval(readSource('js/admin-ui.js'));
        adminUI = window.adminUI;
    });

    beforeEach(() => {
        window.alert = jest.fn();
        window.logHistory = undefined;
        modalInstance.show.mockClear();
        modalInstance.hide.mockClear();
        adminUI.faunaSaveInProgress = false;
        adminUI.openEditModal('wildlife_strikes', {
            id: 92,
            date: '2026-07-30',
            time: '17:51:00',
            location: '04L-22R',
            remains_count: 1,
            size: 'Pequeño'
        }, [
            { name: 'date', label: 'Fecha del Evento', type: 'date' },
            { name: 'time', label: 'Hora del Evento', type: 'time' },
            { name: 'location', label: 'Ubicación General', type: 'text' },
            { name: 'remains_count', label: 'Cantidad de Restos', type: 'number' },
            { name: 'size', label: 'Tamaño de la Fauna', type: 'select', options: [
                { value: 'Pequeño', label: 'Pequeño' },
                { value: 'Mediano', label: 'Mediano' },
                { value: 'Grande', label: 'Grande' }
            ] }
        ]);
    });

    test('confirma, cierra y refresca sólo después de recibir la fila persistida', async () => {
        const updateWildlifeStrike = jest.fn().mockResolvedValue([{ id: 92 }]);
        window.dataManager = { updateWildlifeStrike };
        const onUpdated = jest.fn();
        window.addEventListener('data-updated', onUpdated, { once: true });

        document.getElementById('input-time').value = '05:51';
        document.getElementById('input-location').value = '04C-22C';
        await adminUI.saveChanges();

        expect(updateWildlifeStrike).toHaveBeenCalledWith(92, expect.objectContaining({
            date: '2026-07-30',
            time: '05:51',
            location: '04C-22C',
            remains_count: 1,
            size: 'Pequeño'
        }));
        expect(window.alert).toHaveBeenCalledWith('Datos actualizados correctamente.');
        expect(modalInstance.hide).toHaveBeenCalledTimes(1);
        expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ detail: { table: 'wildlife_strikes' } }));
    });

    test('mantiene abierto el modal y conserva los cambios si RLS rechaza la edición', async () => {
        const error = Object.assign(new Error('No rows updated'), {
            code: 'FAUNA_UPDATE_FORBIDDEN',
            httpStatus: 403
        });
        window.dataManager = { updateWildlifeStrike: jest.fn().mockRejectedValue(error) };
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        document.getElementById('input-location').value = 'A6 corregida';
        await adminUI.saveChanges();

        expect(modalInstance.hide).not.toHaveBeenCalled();
        expect(document.getElementById('input-location').value).toBe('A6 corregida');
        expect(window.alert).toHaveBeenCalledWith('No tienes permiso para editar este registro de Fauna.');
        expect(document.getElementById('admin-save-btn').disabled).toBe(false);
        consoleError.mockRestore();
    });

    test('normaliza fecha y hora opcionales vacías como null', async () => {
        const updateWildlifeStrike = jest.fn().mockResolvedValue([{ id: 92 }]);
        window.dataManager = { updateWildlifeStrike };
        document.getElementById('input-date').value = '';
        document.getElementById('input-time').value = '';

        await adminUI.saveChanges();

        expect(updateWildlifeStrike).toHaveBeenCalledWith(92, expect.objectContaining({ date: null, time: null }));
    });
});

describe('Fauna · migración RLS', () => {
    test('limita UPDATE al nivel edit/admin del módulo sin tocar otras operaciones', () => {
        const sql = readSource('supabase/migrations/021_fauna_update_policy.sql');
        expect(sql).toContain("USING (public.user_can_edit_section('fauna'))");
        expect(sql).toContain("WITH CHECK (public.user_can_edit_section('fauna'))");
        expect(sql).toContain('GRANT UPDATE ON TABLE public.wildlife_strikes TO authenticated');
        expect(sql).not.toMatch(/DROP POLICY[^;]+(?:insert|delete|select)/i);
    });
});
