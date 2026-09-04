/**
 * Rastro automático de escrituras.
 *
 * Cada pantalla tenía que acordarse de llamar a logHistory() al guardar, y la
 * mayoría no lo hacía: el Historial de Cambios enseñaba cuatro módulos y el
 * resto del sistema se movía sin dejar huella. El envoltorio del cliente de
 * Supabase cubre lo que quede fuera.
 *
 * Lo que más se cuida aquí: que auditar NUNCA estorbe al guardado. El
 * constructor de PostgREST es perezoso —solo se ejecuta cuando alguien lo
 * espera—, así que el envoltorio no puede dispararlo antes de tiempo ni
 * cambiar lo que el módulo recibe de vuelta.
 */

const auditoria = require('../js/audit-supabase.js');

/** Cliente de mentiras con el mismo comportamiento perezoso del de verdad. */
function clienteFalso({ resultado } = {}) {
    const escrituras = [];
    const ejecutadas = [];
    // Un insert sin .select() no devuelve filas: ese es el caso normal.
    const respuesta = resultado || { data: null, error: null };

    const cliente = {
        auth: {
            getSession: async () => ({
                data: { session: { user: { id: 'u-1', email: 'isaac@aifa.aero' } } },
            }),
        },
        from(tabla) {
            const constructor = {
                _ejecutado: false,
                select() { return this; },
                eq() { return this; },
                then(alResolver, alFallar) {
                    ejecutadas.push(tabla);
                    this._ejecutado = true;
                    return Promise.resolve(respuesta).then(alResolver, alFallar);
                },
            };
            ['insert', 'update', 'upsert', 'delete'].forEach(metodo => {
                constructor[metodo] = function (...args) {
                    escrituras.push({ tabla, metodo, args });
                    return constructor;
                };
            });
            return constructor;
        },
    };

    return { cliente, escrituras, ejecutadas };
}

/** Lo que quedó anotado en change_history. */
function anotaciones(escrituras) {
    return escrituras
        .filter(e => e.tabla === 'change_history' && e.metodo === 'insert')
        .map(e => e.args[0]);
}

describe('qué se audita y qué no', () => {
    test('las tablas de datos sí', () => {
        expect(auditoria.seAudita('wildlife_strikes')).toBe(true);
        expect(auditoria.seAudita('catalogo_vehiculos')).toBe(true);
        expect(auditoria.seAudita('colab_cursos')).toBe(true);
        expect(auditoria.seAudita('user_roles')).toBe(true);
    });

    test('el propio historial no, o se llamaría a sí mismo sin parar', () => {
        expect(auditoria.seAudita('change_history')).toBe(false);
        expect(auditoria.seAudita('colab_historial')).toBe(false);
    });

    test('lo técnico tampoco: sería ruido, no rastro', () => {
        expect(auditoria.seAudita('conci_presencia')).toBe(false);
        expect(auditoria.seAudita('push_subscriptions')).toBe(false);
    });

    test('los módulos que ya escriben su propio detalle se dejan en paz', () => {
        // Colaboradores, Agenda, Muebles y el Parte guardan el antes y el
        // después campo por campo: duplicarlo emborronaría el historial.
        expect(auditoria.seAudita('agenda_2026')).toBe(false);
        expect(auditoria.seAudita('agenda_reuniones')).toBe(false);
        expect(auditoria.seAudita('muebles_bienes')).toBe(false);
        expect(auditoria.seAudita('vuelos_parte_operaciones')).toBe(false);
    });

    test('cada tabla se nombra como la diría el área', () => {
        expect(auditoria.nombreDeTabla('wildlife_strikes')).toBe('Reportes de fauna');
        expect(auditoria.nombreDeTabla('ggen_consumo_gas')).toBe('Gestión energética — Gas');
        // Una tabla nueva que nadie bautizó todavía sale legible de todos modos.
        expect(auditoria.nombreDeTabla('tabla_recien_creada')).toBe('Tabla Recien Creada');
    });
});

describe('el envoltorio no estorba al guardado', () => {
    test('no dispara la petición antes de que el módulo termine de armarla', () => {
        const { cliente, ejecutadas } = clienteFalso();
        auditoria.instalar(cliente);

        const constructor = cliente.from('wildlife_strikes').insert({ id: 1 }).select().eq('id', 1);
        // Nadie lo ha esperado todavía: no debe haber salido nada.
        expect(ejecutadas).toEqual([]);
        expect(typeof constructor.then).toBe('function');
    });

    test('devuelve al módulo exactamente lo que respondió la base', async () => {
        const respuesta = { data: [{ id: 42, nombre: 'Halcón' }], error: null };
        const { cliente } = clienteFalso({ resultado: respuesta });
        auditoria.instalar(cliente);

        const recibido = await cliente.from('wildlife_strikes').insert({ nombre: 'Halcón' }).select();
        expect(recibido).toBe(respuesta);
    });

    test('un guardado con error no se anota', async () => {
        const { cliente, escrituras } = clienteFalso({ resultado: { data: null, error: { message: 'boom' } } });
        auditoria.instalar(cliente);

        await cliente.from('wildlife_strikes').insert({ nombre: 'Halcón' });
        await new Promise(r => setImmediate(r));
        expect(anotaciones(escrituras)).toHaveLength(0);
    });

    test('instalarlo dos veces no duplica los registros', async () => {
        const { cliente, escrituras } = clienteFalso();
        auditoria.instalar(cliente);
        auditoria.instalar(cliente);

        await cliente.from('catalogo_vehiculos').insert({ id: 3 });
        await new Promise(r => setImmediate(r));
        expect(anotaciones(escrituras)).toHaveLength(1);
    });
});

describe('lo que queda anotado', () => {
    async function anotar(tabla, metodo, ...args) {
        const { cliente, escrituras } = clienteFalso();
        auditoria.instalar(cliente);
        await cliente.from(tabla)[metodo](...args);
        await new Promise(r => setImmediate(r));
        return anotaciones(escrituras)[0];
    }

    test('un alta dice qué se agregó y dónde', async () => {
        const fila = await anotar('catalogo_vehiculos', 'insert', { placa: 'ABC-123', marca: 'Nissan' });
        expect(fila.action_type).toBe('CREAR');
        expect(fila.entity_type).toBe('Catálogo de vehículos');
        expect(fila.details.summary).toBe('Se agregó un registro en Catálogo de vehículos');
        expect(fila.details.campos).toEqual(['placa', 'marca']);
        expect(fila.user_email).toBe('isaac@aifa.aero');
    });

    test('un borrado se distingue de una edición', async () => {
        expect((await anotar('colab_cursos', 'delete')).action_type).toBe('ELIMINAR');
        expect((await anotar('colab_cursos', 'update', { nombre: 'x' })).action_type).toBe('EDITAR');
        expect((await anotar('colab_cursos', 'upsert', { nombre: 'x' })).action_type).toBe('GUARDAR');
    });

    test('una carga de varias filas se cuenta como una sola operación', async () => {
        const fila = await anotar('daily_operations', 'insert', [{ id: 1 }, { id: 2 }, { id: 3 }]);
        expect(fila.details.registros).toBe(3);
        expect(fila.details.summary).toContain('3 registros');
    });

    test('guarda con qué reconocer el registro tocado', async () => {
        const fila = await anotar('medical_attentions', 'insert', { num_empleado: '1344-2', nota: 'x' });
        expect(fila.record_id).toBe('1344-2');
    });
});
