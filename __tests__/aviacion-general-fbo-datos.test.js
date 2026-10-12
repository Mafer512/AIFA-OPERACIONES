/**
 * Capa de datos del módulo FBO (js/aviacion-general/datos.js) contra un
 * servidor falso que se comporta como PostgREST en lo que importa aquí:
 *
 *   · cualquier respuesta de filas se corta en 1000 (max-rows);
 *   · las funciones que devuelven un jsonb (fbo_resumen) o una fila por mes
 *     suman en el "servidor" sobre TODOS los movimientos, como PostgreSQL.
 *
 * La regla de las 1000 filas: con 1,500 operaciones (3,000 movimientos) un
 * select directo trae 1000, pero los KPIs del módulo dicen 3,000, porque se
 * piden ya sumados. La comprobación contra la base real está en
 * supabase/migrations/064c_fbo_validacion.sql (chequeos 1-3).
 *
 * Las agregaciones (mes de cada movimiento, filtros combinados) viven en SQL,
 * no en JavaScript: sus pruebas son los chequeos 50-60 de la 064c.
 */

require('../js/aviacion-general/datos.js');
const Datos = globalThis.AviacionGeneralDatos;

const MAX_FILAS = 1000;

/** n operaciones: llegada el día 28 de cada mes y salida 5 días después (cruza de mes). */
function movimientosDe(nOperaciones) {
    const movs = [];
    for (let i = 1; i <= nOperaciones; i++) {
        const mes = String(((i - 1) % 7) + 1).padStart(2, '0');
        const mesSalida = String(((i - 1) % 7) + 2).padStart(2, '0');
        movs.push({ movimiento_id: i * 2, operacion_id: i, fuente: 'FBO', tipo_movimiento: 'LLEGADA',
                    fecha: `2026-${mes}-28`, ambito: i % 3 ? 'NAC' : 'INT', pax_total: 2 });
        movs.push({ movimiento_id: i * 2 + 1, operacion_id: i, fuente: 'FBO', tipo_movimiento: 'SALIDA',
                    fecha: `2026-${mesSalida}-02`, ambito: i % 3 ? 'NAC' : 'INT', pax_total: 3 });
    }
    return movs;
}

function servidorFalso(movimientos) {
    const llamadas = { rpc: [], from: [], opciones: [], bloques: [], previa: [] };
    let fallarEnBloque = null;

    function respuestaFilas(filas, opciones, rango) {
        const [desde, hasta] = rango || [0, filas.length - 1];
        const pagina = filas.slice(desde, Math.min(hasta + 1, desde + MAX_FILAS));
        return { data: pagina, error: null, count: opciones && opciones.count ? filas.length : null };
    }

    function constructor(resolver) {
        let rango = null;
        const b = {
            order() { return b; },
            range(desde, hasta) { rango = [desde, hasta]; return b; },
            select() { return b; },
            limit() { return b; },
            then(ok, ko) { return Promise.resolve(resolver(rango)).then(ok, ko); }
        };
        return b;
    }

    const rpcs = {
        fbo_resumen: () => ({
            data: {
                totales: {
                    movimientos: movimientos.length,
                    llegadas: movimientos.filter((m) => m.tipo_movimiento === 'LLEGADA').length,
                    salidas: movimientos.filter((m) => m.tipo_movimiento === 'SALIDA').length,
                    pax: movimientos.reduce((a, m) => a + m.pax_total, 0),
                    operaciones: new Set(movimientos.map((m) => m.operacion_id)).size
                }
            },
            error: null
        }),
        fbo_movimientos_por_mes: () => {
            const meses = {};
            movimientos.forEach((m) => {
                const p = m.fecha.slice(0, 7);
                meses[p] = meses[p] || { periodo: p, llegadas: 0, salidas: 0, movimientos: 0 };
                meses[p].movimientos += 1;
                meses[p][m.tipo_movimiento === 'LLEGADA' ? 'llegadas' : 'salidas'] += 1;
            });
            return { data: Object.values(meses).sort((a, b) => a.periodo.localeCompare(b.periodo)), error: null };
        },
        fbo_previa_importacion: (args) => {
            llamadas.previa.push(args.p_filas.length);
            return { data: { existentes: [args.p_filas[0].registro], coincidencias: [] }, error: null };
        },
        fbo_importar_operaciones: (args) => {
            llamadas.bloques.push(args.p_filas.length);
            if (fallarEnBloque === llamadas.bloques.length) {
                return { data: null, error: { message: 'canceling statement due to statement timeout' } };
            }
            return { data: { recibidas: args.p_filas.length, insertados: args.p_filas.length - 1,
                             reemplazados: 1, reemplazados_por_coincidencia: 0 }, error: null };
        }
    };

    return {
        llamadas,
        fallarEnBloque(n) { fallarEnBloque = n; },
        from(tabla) {
            llamadas.from.push(tabla);
            return constructor((rango) => respuestaFilas(movimientos, null, rango));
        },
        rpc(nombre, args, opciones) {
            llamadas.rpc.push(nombre);
            llamadas.opciones.push({ nombre, args, opciones });
            if (nombre === 'fbo_movimientos_filtrados') {
                return constructor((rango) => respuestaFilas(movimientos, opciones, rango));
            }
            const fn = rpcs[nombre];
            return constructor(() => (fn ? fn(args) : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nombre}` } }));
        }
    };
}

function conServidor(movimientos) {
    const s = servidorFalso(movimientos);
    globalThis.supabaseClient = s;
    return s;
}

afterEach(() => { delete globalThis.supabaseClient; });

describe('regla de las 1000 filas', () => {
    test('con 1,500 operaciones los KPIs dicen 3,000 movimientos, no 1000', async () => {
        const s = conServidor(movimientosDe(1500));

        // Lo que pasaría descargando la tabla: PostgREST corta en 1000.
        const ingenuo = await s.from('operaciones_fbo').select('*');
        expect(ingenuo.data).toHaveLength(1000);

        s.llamadas.from.length = 0;
        const r = await Datos.resumen({ fecha_desde: '2026-01-01', fecha_hasta: '2026-12-31' });
        expect(r.totales.movimientos).toBe(3000);
        expect(r.totales.llegadas).toBe(1500);
        expect(r.totales.salidas).toBe(1500);
        expect(r.totales.operaciones).toBe(1500);
        expect(r.totales.pax).toBe(1500 * 5);
        // Y el resumen no descargó ninguna tabla para calcularlo.
        expect(s.llamadas.from).toEqual([]);
        expect(s.llamadas.rpc).toContain('fbo_resumen');
    });

    test('la serie mensual cuadra con el total aunque haya más de 1000 movimientos', async () => {
        conServidor(movimientosDe(1500));
        const meses = await Datos.porMes({});
        expect(meses.reduce((a, m) => a + m.movimientos, 0)).toBe(3000);
        // Cada operación cruza de mes: la llegada cuenta en un mes y la salida en el siguiente.
        expect(meses.find((m) => m.periodo === '2026-01')).toMatchObject({ llegadas: expect.any(Number), salidas: 0 });
        expect(meses.find((m) => m.periodo === '2026-08')).toMatchObject({ llegadas: 0 });
    });

    test('la lista pagina en el servidor y conoce el total exacto', async () => {
        const s = conServidor(movimientosDe(1500));
        const r = await Datos.movimientos({ filtros: { matricula: 'XA', ambito: '' }, pagina: 3, porPagina: 50 });
        expect(r.total).toBe(3000);
        expect(r.filas).toHaveLength(50);
        expect(r.filas[0].movimiento_id).toBe(movimientosDe(1500)[100].movimiento_id);

        const llamada = s.llamadas.opciones.find((o) => o.nombre === 'fbo_movimientos_filtrados');
        expect(llamada.opciones).toEqual({ count: 'exact' });
        // Los vacíos no viajan: una clave ausente no filtra.
        expect(llamada.args).toEqual({ p_filtros: { matricula: 'XA' } });
    });

    test('exportar trae TODOS los movimientos en páginas de 1000', async () => {
        const s = conServidor(movimientosDe(1173)); // 2,346 movimientos
        const r = await Datos.movimientosTodos({ filtros: {} });
        expect(r.total).toBe(2346);
        expect(r.filas).toHaveLength(2346);
        expect(s.llamadas.rpc.filter((n) => n === 'fbo_movimientos_filtrados')).toHaveLength(3);
        expect(new Set(r.filas.map((f) => f.movimiento_id)).size).toBe(2346);
    });
});

describe('importación por bloques', () => {
    const filas = (n) => Array.from({ length: n }, (_, i) => ({ registro: `AG-2026-${String(i + 1).padStart(6, '0')}` }));

    test('1,234 filas viajan en bloques de 500, 500 y 234, y se suman los resultados', async () => {
        const s = conServidor([]);
        const progreso = [];
        const r = await Datos.importarOperaciones({ filas: filas(1234), onProgreso: (p) => progreso.push(p.acumulado) });
        expect(s.llamadas.bloques).toEqual([500, 500, 234]);
        expect(r).toMatchObject({ recibidas: 1234, insertados: 1231, reemplazados: 3, bloques: 3, bloquesGuardados: 3 });
        expect(progreso).toEqual([500, 1000, 1234]);
    });

    test('si un bloque falla se detiene y dice cuántos bloques quedaron guardados', async () => {
        const s = conServidor([]);
        s.fallarEnBloque(2);
        let error = null;
        try {
            await Datos.importarOperaciones({ filas: filas(1234) });
        } catch (e) {
            error = e;
        }
        expect(error).not.toBeNull();
        expect(error.message).toMatch(/bloque 2 de 3/);
        expect(error.parcial).toMatchObject({ bloquesGuardados: 1, recibidas: 500 });
        // El tercero nunca se mandó.
        expect(s.llamadas.bloques).toEqual([500, 500]);
    });

    test('la vista previa también va en bloques de 500 y junta las respuestas', async () => {
        const s = conServidor([]);
        const r = await Datos.previaImportacion(filas(1100));
        expect(s.llamadas.previa).toEqual([500, 500, 100]);
        expect(r.existentes).toEqual(['AG-2026-000001', 'AG-2026-000501', 'AG-2026-001001']);
    });
});

describe('mensajes de instalación', () => {
    test('si falta una función dice qué migración correr', async () => {
        const s = conServidor([]);
        s.rpc = (nombre) => ({
            then: (ok) => Promise.resolve({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nombre}(p_filas)` } }).then(ok)
        });
        await expect(Datos.previaImportacion([{ registro: 'X' }])).rejects.toThrow(/064b_fbo_importar_operaciones\.sql/);
        await expect(Datos.resumen({})).rejects.toThrow(/064a_fbo_movimientos_vista_y_rpc\.sql/);
    });

    test('filtrosRpc sólo deja las claves conocidas y con valor', () => {
        expect(Datos.filtrosRpc({
            fecha_desde: '2026-01-01', fecha_hasta: '', tipo_movimiento: 'SALIDA', ambito: ' ',
            estatus_registro: 'ACTIVO', texto: ' gulf '
        })).toEqual({ fecha_desde: '2026-01-01', tipo_movimiento: 'SALIDA', texto: 'gulf' });
    });
});
