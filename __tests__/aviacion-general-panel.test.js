/**
 * @jest-environment jsdom
 */

/**
 * Armazón y pantallas del módulo de Aviación General / FBO.
 *
 * Esto no vuelve a probar las reglas del núcleo ni la lectura del Layout —de
 * eso se ocupan aviacion-general-core.test.js y aviacion-general-layout-fbo.test.js—
 * sino el cableado, que es donde un módulo partido en nueve archivos se rompe:
 *
 *   · que el panel se monte SOLO al entrar a la sección;
 *   · que las pantallas se registren solas y Captura quede oculta;
 *   · que Resumen y Movimientos pidan a las funciones fbo_* (064a), con los
 *     filtros del módulo, y pinten lo que suma PostgreSQL;
 *   · que la Importación lea el Layout real, muestre la vista previa contra
 *     lo guardado y mande a fbo_importar_operaciones sólo lo que no está
 *     bloqueado;
 *   · que Validación y Auditoría sigan en su fuente anterior, etiquetadas.
 *
 * El contenedor se recorta de index.html, no se escribe a mano: si alguien
 * renombra el id allá, esta prueba falla en vez de seguir pasando contra una
 * copia que ya no existe.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const raiz = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(raiz, 'docs', 'fbo', 'Lay-out.xlsx'));

const ARCHIVOS_MODULO = [
    'layout-fbo.js', 'datos.js', 'panel.js',
    'vista-resumen.js', 'vista-movimientos.js', 'vista-captura.js',
    'vista-importacion.js', 'vista-validacion.js', 'vista-auditoria.js'
];

function fuente(archivo) {
    return fs.readFileSync(path.join(raiz, 'js', 'aviacion-general', archivo), 'utf8');
}

function resumenDePrueba() {
    return {
        totales: {
            movimientos: 2234, llegadas: 1117, salidas: 1117,
            pax: 5400, pax_llegada: 2700, pax_salida: 2700, adultos: 5100, infantes: 300,
            nacionales: 1700, internacionales: 530, sin_ambito: 4,
            operaciones: 1117, operaciones_abiertas: 11, movimientos_historicos: 0,
            operadores: 210, matriculas: 380,
            fecha_min: '2026-01-01', fecha_max: '2026-10-05'
        },
        top_operadores: [{ clave: 'AEROLÍNEAS EJECUTIVAS', movimientos: 120, pax: 300 }],
        top_aeronaves: [{ clave: 'G650', movimientos: 90, pax: 210 }],
        top_aeropuertos: [{ clave: 'MMTO', movimientos: 75, pax: 180 }],
        top_matriculas: [{ clave: 'XA-MAM', movimientos: 40, operador: 'X', tipo_aeronave: 'G650' }]
    };
}

function porMesDePrueba() {
    return [
        { periodo: '2026-01', anio: 2026, mes: 1, movimientos: 200, llegadas: 100, salidas: 100, pax: 600, pax_llegada: 310, pax_salida: 290 },
        { periodo: '2026-02', anio: 2026, mes: 2, movimientos: 180, llegadas: 92, salidas: 88, pax: 540, pax_llegada: 280, pax_salida: 260 }
    ];
}

/** Un movimiento de v_fbo_movimientos de cada fuente. */
function movimientosDePrueba() {
    return [
        {
            fuente: 'FBO', movimiento_id: 1710, operacion_id: 855, registro: 'BASE2026-0855',
            tipo_movimiento: 'LLEGADA', fecha: '2026-03-15', fecha_real: '2026-03-15',
            hora: '19:44:00', hora_pista: '19:44:00', hora_posicion: '19:48:00',
            ambito: 'NAC', aeropuerto: 'MMTO', origen: 'MMTO', destino: 'MMQT',
            pax_adultos: 3, pax_infantes: 0, pax_total: 3,
            operador: 'AEROLÍNEAS EJECUTIVAS', matricula: 'XA-MAM', tipo_aeronave: 'G650',
            tipo_ala: 'FIJA', vuelo_operado_por: 'FBO', operacion_abierta: false
        },
        {
            fuente: 'HISTORICO', movimiento_id: -3701, operacion_id: null, registro: 'HIST-3701',
            tipo_movimiento: 'SALIDA', fecha: '2022-12-28', fecha_real: '2023-01-02',
            hora: '08:41:00', hora_pista: null, hora_posicion: null,
            ambito: 'INT', aeropuerto: 'BROWARD', origen: null, destino: 'BROWARD',
            pax_adultos: 0, pax_infantes: 0, pax_total: 15,
            operador: 'OTRO OPERADOR', matricula: 'N900MC', tipo_aeronave: 'C421',
            tipo_ala: null, vuelo_operado_por: null, operacion_abierta: null
        }
    ];
}

/** Fila de la fuente anterior (aviacion_general_operaciones), para Validación. */
function filaAnterior(id) {
    return {
        id, folio_rotacion: id, fecha_operacion: '2025-03-15',
        tipo_operacion: 'LLEGADA', ambito_operacion: 'NACIONAL',
        operador: 'AEROLÍNEAS EJECUTIVAS', matricula: 'XA-MAM', tipo_aeronave: 'G650',
        aeropuerto_origen_destino: 'MMTO', ciudad_origen_destino: null,
        hora_programada: '08:30:00', hora_real: '08:41:00',
        adultos: 3, infantes: 0, pax_total_reportado: null, pax_ag: 3,
        estado_validacion: 'PENDIENTE', estatus_registro: 'ACTIVO', tipo_fuente: 'IMPORTACION_EXCEL',
        archivo_origen: 'bitacora.xlsx', fila_origen: 7, version: 1
    };
}

/**
 * Cliente de mentiras con la misma forma encadenable que supabase-js. Registra
 * cada llamada para poder afirmar QUÉ se consultó, con qué argumentos y
 * cuántas veces.
 */
function clienteFalso({ previa = null } = {}) {
    const llamadas = { rpc: [], args: [], tablas: [] };

    const respuestasRpc = {
        fbo_patron: () => '%x%',
        fbo_resumen: () => resumenDePrueba(),
        fbo_movimientos_por_mes: () => porMesDePrueba(),
        fbo_opciones: () => ({
            operadores: ['AEROLÍNEAS EJECUTIVAS'], matriculas: ['XA-MAM'],
            tipos_aeronave: ['G650'], aeropuertos: ['MMTO']
        }),
        fbo_movimientos_filtrados: () => movimientosDePrueba(),
        fbo_previa_importacion: (args) => (previa ? previa(args) : { existentes: [], coincidencias: [] }),
        fbo_importar_operaciones: (args) => ({
            recibidas: args.p_filas.length, insertados: args.p_filas.length - 2,
            reemplazados: 1, reemplazados_por_coincidencia: 1
        }),
        aviacion_general_validar: () => 2,
        aviacion_general_enlazar_rotaciones: () => ({ movimientos_enlazados: 4, grupos_ambiguos: 1 }),
        aviacion_general_duplicados: () => ([
            { folio_rotacion: 512, tipo_operacion: 'SALIDA', fecha_operacion: '2024-06-04',
              matricula: 'N900MC', operador: 'X', veces: 2, ids: [3700, 3701], discrepan: true },
            { folio_rotacion: 95, tipo_operacion: 'LLEGADA', fecha_operacion: '2025-01-30',
              matricula: 'XC-FEZ', operador: 'Y', veces: 2, ids: [8558, 8606], discrepan: false }
        ])
    };

    function enlace(resolver) {
        const b = {};
        ['select', 'eq', 'gte', 'lte', 'ilike', 'or', 'order', 'range', 'limit', 'insert', 'update']
            .forEach((m) => { b[m] = () => b; });
        b.maybeSingle = async () => ({ data: filaAnterior(1), error: null });
        b.single = async () => ({ data: filaAnterior(1), error: null });
        b.then = (ok, ko) => Promise.resolve(resolver()).then(ok, ko);
        return b;
    }

    return {
        llamadas,
        from(tabla) {
            return enlace(() => {
                llamadas.tablas.push(tabla);
                const data = tabla.endsWith('_auditoria')
                    ? [{
                        id: 1, registro_id: 1, operacion: 'UPDATE',
                        datos_anteriores: { matricula: 'XA-MAM', version: 1 },
                        datos_nuevos: { matricula: 'XA-MAN', version: 2 },
                        realizado_por: '11111111-2222-3333-4444-555555555555',
                        fecha_evento: '2026-03-17T12:00:00Z'
                    }]
                    : tabla === 'operaciones_fbo' ? [{ id: 1 }] : [filaAnterior(1), filaAnterior(2)];
                return { data, error: null, count: data.length };
            });
        },
        rpc(nombre, args, opciones) {
            return enlace(() => {
                llamadas.rpc.push(nombre);
                llamadas.args.push({ nombre, args, opciones });
                const fn = respuestasRpc[nombre];
                if (!fn) return { data: null, error: { message: `RPC sin stub: ${nombre}` } };
                const data = fn(args);
                return { data, error: null, count: Array.isArray(data) ? data.length : null };
            });
        }
    };
}

/** Deja pasar las promesas encadenadas del montaje. */
const asentar = async (veces = 2) => {
    for (let i = 0; i < veces; i++) await new Promise((resolver) => setTimeout(resolver, 0));
};

function montarModulo({ nivel = 'admin', cliente = clienteFalso() } = {}) {
    jest.resetModules();
    ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore', 'AviacionGeneralLayoutFbo',
     'AviacionGeneralResumen', 'AviacionGeneralMovimientos', 'AviacionGeneralImportacion']
        .forEach((k) => { delete window[k]; });

    const marcado = indexSource.match(/<div id="aviacion-general-section" class="content-section"><\/div>/);
    if (!marcado) throw new Error('No se encontró #aviacion-general-section en index.html');
    document.body.innerHTML = marcado[0];

    window.supabaseClient = cliente;
    window.ensureSupabaseClient = async () => cliente;
    window.sectionLevel = () => nivel;
    window.showNotification = jest.fn();
    window.XLSX = XLSX;
    // Chart.js no está en jsdom y no hace falta: se prueba el cableado.
    window.Chart = function () { return { destroy() {}, resize() {} }; };
    window.HTMLCanvasElement.prototype.getContext = () => ({});

    window.AviacionGeneralCore = require('../js/aviacion-general/core.js');
    ARCHIVOS_MODULO.forEach((archivo) => { new Function(fuente(archivo))(); });

    return cliente;
}

async function entrar(opciones) {
    const cliente = montarModulo(opciones);
    document.getElementById('aviacion-general-section').classList.add('active');
    await asentar(3);
    return cliente;
}

const pestanas = () => Array.from(document.querySelectorAll('#ag-tabs .nav-link')).map((b) => b.dataset.agVista);

async function aplicar(cambios) {
    Object.entries(cambios).forEach(([id, valor]) => { document.getElementById(id).value = valor; });
    document.getElementById('ag-btn-aplicar').click();
    await asentar(3);
}

describe('montaje de la sección', () => {
    test('no se monta al cargar el portal: sólo al entrar a la sección', async () => {
        const cliente = montarModulo();
        await asentar();
        expect(document.getElementById('aviacion-general-section').innerHTML.trim()).toBe('');
        expect(cliente.llamadas.rpc).toEqual([]);
    });

    test('arma encabezado, filtros y pestañas; Captura queda oculta', async () => {
        await entrar();
        expect(document.querySelector('.ag-header h2').textContent).toContain('Aviación General');
        ['ag-f-desde', 'ag-f-hasta', 'ag-f-tipo', 'ag-f-ambito', 'ag-f-operador', 'ag-f-matricula',
         'ag-f-aeronave', 'ag-f-aeropuerto', 'ag-f-texto'].forEach((id) => {
            expect(document.getElementById(id)).not.toBeNull();
        });
        // operaciones_fbo no tiene validación ni estatus: esos filtros no aplican.
        expect(document.getElementById('ag-f-validacion')).toBeNull();
        expect(document.getElementById('ag-f-estatus')).toBeNull();
        expect(pestanas()).toEqual(['resumen', 'movimientos', 'importacion', 'validacion', 'auditoria']);
    });

    test('el ámbito se filtra como NAC / INT, igual que en operaciones_fbo', async () => {
        await entrar();
        const valores = Array.from(document.querySelectorAll('#ag-f-ambito option')).map((o) => o.value);
        expect(valores).toEqual(['', 'NAC', 'INT']);
    });

    test('el rango por omisión es el año en curso', async () => {
        await entrar();
        const anio = new Date().getFullYear();
        expect(document.getElementById('ag-f-desde').value).toBe(`${anio}-01-01`);
        expect(document.getElementById('ag-f-hasta').value).toBe(`${anio}-12-31`);
    });

    test('si falta la 064a lo dice con el nombre del archivo', async () => {
        const cliente = clienteFalso();
        const original = cliente.rpc;
        cliente.rpc = (nombre, args, op) => (nombre === 'fbo_patron'
            ? { then: (ok) => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fbo_patron(p)' } }).then(ok) }
            : original(nombre, args, op));
        await entrar({ cliente });
        expect(document.getElementById('ag-diagnostico').textContent).toContain('064a_fbo_movimientos_vista_y_rpc.sql');
    });
});

describe('niveles de acceso', () => {
    test('sólo lectura no ve importación ni captura', async () => {
        await entrar({ nivel: 'read' });
        expect(pestanas()).not.toContain('captura');
        expect(pestanas()).not.toContain('importacion');
        expect(pestanas()).toContain('movimientos');
        expect(pestanas()).toContain('auditoria');
    });

    test('un capturista importa pero no valida', async () => {
        await entrar({ nivel: 'capture' });
        expect(pestanas()).toContain('importacion');
        expect(pestanas()).not.toContain('captura');

        window.AviacionGeneral.abrirVista('validacion');
        await asentar(3);
        expect(document.getElementById('ag-val-sin-permiso').classList.contains('d-none')).toBe(false);
        expect(document.getElementById('ag-val-validar').disabled).toBe(true);
    });
});

describe('resumen', () => {
    test('al entrar sólo consulta el resumen: ni la lista ni la auditoría', async () => {
        const cliente = await entrar();
        expect(cliente.llamadas.rpc).toContain('fbo_resumen');
        expect(cliente.llamadas.rpc).toContain('fbo_movimientos_por_mes');
        expect(cliente.llamadas.rpc).not.toContain('fbo_movimientos_filtrados');
        expect(cliente.llamadas.rpc).not.toContain('aviacion_general_resumen');
        expect(cliente.llamadas.tablas).not.toContain('aviacion_general_operaciones_auditoria');
    });

    test('pinta las cifras que devuelve PostgreSQL, sin recalcularlas', async () => {
        await entrar();
        const kpis = document.getElementById('ag-res-kpis').textContent;
        expect(kpis).toContain('2,234');   // movimientos
        expect(kpis).toContain('1,117');   // llegadas / operaciones
        expect(kpis).toContain('5,400');   // pax
        expect(kpis).toContain('Operadores distintos');
        expect(kpis).toContain('Matrículas distintas');
        // operaciones_fbo no tiene validación: ese KPI ya no existe.
        expect(kpis).not.toContain('Por validar');
        expect(kpis).toContain('Operaciones');
        expect(kpis).toContain('11 abiertas (sin salida)');
        expect(document.getElementById('ag-res-nota').textContent).toContain('4 movimiento(s) sin ámbito');
    });

    test('manda los filtros del módulo con los nombres de fbo_movimientos_filtrados', async () => {
        const cliente = await entrar();
        await aplicar({ 'ag-f-matricula': 'XA-MAM', 'ag-f-ambito': 'INT', 'ag-f-tipo': 'SALIDA', 'ag-f-aeropuerto': 'KAEX' });
        const ultima = cliente.llamadas.args.filter((a) => a.nombre === 'fbo_resumen').pop();
        const anio = new Date().getFullYear();
        expect(ultima.args.p_filtros).toEqual({
            fecha_desde: `${anio}-01-01`, fecha_hasta: `${anio}-12-31`,
            tipo_movimiento: 'SALIDA', ambito: 'INT', matricula: 'XA-MAM', aeropuerto: 'KAEX'
        });
        const mensual = cliente.llamadas.args.filter((a) => a.nombre === 'fbo_movimientos_por_mes').pop();
        expect(mensual.args.p_filtros).toEqual(ultima.args.p_filtros);
    });

    test('si el periodo toca años anteriores a 2026 avisa que las operaciones son desde 2026', async () => {
        await entrar();
        await aplicar({ 'ag-f-desde': '2025-01-01' });
        expect(document.getElementById('ag-res-kpis').textContent).toContain('Operaciones disponibles desde 2026');

        await aplicar({ 'ag-f-desde': '2026-01-01' });
        expect(document.getElementById('ag-res-kpis').textContent).not.toContain('Operaciones disponibles desde 2026');
    });

    test('la tabla mensual separa pasajeros de llegada y de salida', async () => {
        await entrar();
        document.getElementById('ag-res-ver-tabla').click();
        const tabla = document.getElementById('ag-res-tabla-mes');
        expect(tabla.hidden).toBe(false);
        expect(document.getElementById('ag-res-caja-mes').hidden).toBe(true);
        expect(tabla.textContent).toContain('Ene 2026');
        expect(tabla.textContent).toContain('310');  // pax llegada de enero
        expect(tabla.textContent).toContain('290');  // pax salida de enero
        expect(tabla.textContent).toContain('590');  // 310 + 280
        expect(tabla.textContent).toContain('550');  // 290 + 260
        expect(tabla.textContent).toContain('380');  // 200 + 180 movimientos
    });

    test('los pasajeros tienen su propia gráfica y desglose de adultos e infantes', async () => {
        await entrar();
        expect(document.getElementById('ag-res-pax')).not.toBeNull();
        expect(document.getElementById('ag-res-pax-nota').textContent).toContain('5,400');
        const kpis = document.getElementById('ag-res-kpis').textContent;
        expect(kpis).toContain('5,100 adultos');
        expect(kpis).toContain('300 infantes');
        expect(kpis).not.toContain('sin desglose');
    });

    test('con histórico capturado como total, dice cuántos pasajeros no tienen desglose', async () => {
        const cliente = clienteFalso();
        const original = cliente.rpc;
        cliente.rpc = (nombre, args, op) => {
            if (nombre !== 'fbo_resumen') return original(nombre, args, op);
            const r = resumenDePrueba();
            r.totales.pax = 6785;    // 5,400 desglosados + 1,385 del histórico capturados como total
            return { then: (ok) => Promise.resolve({ data: r, error: null }).then(ok) };
        };
        await entrar({ cliente });
        expect(document.getElementById('ag-res-kpis').textContent).toContain('1,385 sin desglose (histórico)');
    });

    test('cambiar un filtro invalida lo pintado y vuelve a consultar', async () => {
        const cliente = await entrar();
        const antes = cliente.llamadas.rpc.filter((n) => n === 'fbo_resumen').length;
        await aplicar({ 'ag-f-matricula': 'XA-MAM' });
        expect(cliente.llamadas.rpc.filter((n) => n === 'fbo_resumen').length).toBeGreaterThan(antes);
        expect(window.AviacionGeneral.filtros.matricula).toBe('XA-MAM');
    });
});

describe('movimientos', () => {
    async function abrirMovimientos(opciones) {
        const cliente = await entrar(opciones);
        window.AviacionGeneral.abrirVista('movimientos');
        await asentar(3);
        return cliente;
    }

    test('pagina en el servidor con conteo exacto y la misma definición de filtros', async () => {
        const cliente = await abrirMovimientos();
        const llamada = cliente.llamadas.args.find((a) => a.nombre === 'fbo_movimientos_filtrados');
        expect(llamada.opciones).toEqual({ count: 'exact' });
        expect(document.getElementById('ag-mov-paginador').textContent).toMatch(/de\s+2\s+movimientos/);
        expect(document.getElementById('ag-mov-excel')).not.toBeNull();
        expect(document.getElementById('ag-mov-csv')).not.toBeNull();
    });

    test('lista las dos fuentes y distingue el histórico', async () => {
        await abrirMovimientos();
        const cuerpo = document.getElementById('ag-mov-tbody');
        expect(cuerpo.textContent).toContain('BASE2026-0855');
        expect(cuerpo.textContent).toContain('XA-MAM');
        expect(cuerpo.textContent).toContain('15 Mar 2026');
        expect(cuerpo.textContent).toContain('19:44');
        expect(cuerpo.textContent).toContain('BROWARD');
        const hist = Array.from(cuerpo.querySelectorAll('.ag-od-ciudad')).map((e) => e.textContent);
        expect(hist).toContain('HIST-3701');
        // Salida histórica anclada a su llegada: se ve la fecha real y se dice dónde cuenta.
        const fecha = Array.from(cuerpo.querySelectorAll('.ag-od-ciudad')).find((e) => e.textContent === '2 Ene 2023');
        expect(fecha.getAttribute('title')).toContain('28 Dic 2022');
    });

    test('las columnas son las del movimiento, sin validación ni acciones de edición', async () => {
        await abrirMovimientos();
        const enc = document.getElementById('ag-mov-thead').textContent;
        ['Registro', 'Fecha', 'Hora', 'Movimiento', 'Ámbito', 'Operador', 'Prestador',
         'Matrícula', 'Aeronave', 'Ala', 'Orig./Dest.', 'Pista', 'Posición', 'Ad.', 'Inf.', 'Pax']
            .forEach((t) => expect(enc).toContain(t));
        expect(enc).not.toContain('Validación');
        expect(document.querySelector('#ag-mov-tbody [data-ag-accion]')).toBeNull();
        expect(document.getElementById('ag-mov-nuevo')).toBeNull();
    });

    test('ordenar pide de nuevo a la base, no reordena en el navegador', async () => {
        const cliente = await abrirMovimientos();
        const antes = cliente.llamadas.rpc.filter((n) => n === 'fbo_movimientos_filtrados').length;
        document.querySelector('[data-ag-orden="matricula"]').click();
        await asentar(3);
        expect(cliente.llamadas.rpc.filter((n) => n === 'fbo_movimientos_filtrados').length).toBe(antes + 1);
    });
});

describe('importación del Layout', () => {
    /**
     * La base "ya tiene": AG-2026-000011 con su mismo registro; la BASE2026-0855
     * que coincide con AG-2026-000004 (una sola: se reemplaza); y dos
     * operaciones que coinciden con AG-2026-000005 (ambigua: se bloquea).
     */
    function previaDePrueba() {
        return {
            existentes: ['AG-2026-000011'],
            coincidencias: [
                { registro: 'AG-2026-000004', registro_existente: 'BASE2026-0855' },
                { registro: 'AG-2026-000005', registro_existente: 'BASE2026-0856' },
                { registro: 'AG-2026-000005', registro_existente: 'BASE2026-0857' }
            ]
        };
    }

    async function soltarLayout(opciones = {}) {
        const cliente = await entrar({ cliente: clienteFalso({ previa: previaDePrueba }), ...opciones });
        window.AviacionGeneral.abrirVista('importacion');
        await asentar(3);

        // Se copia a un ArrayBuffer del entorno de jsdom: un Buffer de Node es
        // de otro realm y SheetJS lo reconoce con instanceof.
        const archivo = {
            name: 'operaciones agosto.xlsx', size: FIXTURE.length,
            arrayBuffer: async () => new Uint8Array(FIXTURE).buffer
        };
        const evento = new window.Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(evento, 'dataTransfer', { value: { files: [archivo] } });
        document.getElementById('ag-imp-zona').dispatchEvent(evento);
        await asentar(6);
        return cliente;
    }

    test('lee el Layout sin importar el nombre del archivo y reporta hoja y encabezado', async () => {
        await soltarLayout();
        const info = document.getElementById('ag-imp-info').textContent;
        expect(info).toContain('operaciones agosto.xlsx');
        expect(info).toContain('Global');
        expect(info).toMatch(/fila 4/);
        expect(info).toContain('43 filas');
    });

    test('la vista previa cuenta nuevas, existentes, reemplazos y bloqueadas', async () => {
        const cliente = await soltarLayout();
        // La primera llamada es la del diagnóstico de instalación, con lote vacío.
        const previa = cliente.llamadas.args.filter((a) => a.nombre === 'fbo_previa_importacion').pop();
        expect(previa.args.p_filas).toHaveLength(43);
        expect(previa.args.p_filas[0]).toEqual({ registro: 'AG-2026-000002', matricula: 'N679VJ', fecha_aterrizaje: expect.any(String) });

        const resumen = document.getElementById('ag-imp-resumen-previa').textContent.replace(/\s+/g, ' ');
        expect(resumen).toContain('43 filas');
        expect(resumen).toContain('40 nuevas');
        expect(resumen).toContain('1 ya existen');
        expect(resumen).toContain('1 reemplazan una operación guardada');
        expect(resumen).toContain('1 bloqueadas');

        const tabla = document.getElementById('ag-imp-previa-body').textContent;
        expect(tabla).toContain('Reemplaza BASE2026-0855');
        expect(tabla).toContain('Bloqueada');
        expect(tabla).toContain('3974');
    });

    test('el reporte de validación trae la ambigua como error y se puede bajar en CSV', async () => {
        await soltarLayout();
        const val = document.getElementById('ag-imp-validacion').textContent;
        expect(val).toMatch(/AG-2026-000005[\s\S]*Coincide con 2 operaciones guardadas/);
        expect(val).toContain('Falta Fin desembarque');
        expect(document.getElementById('ag-imp-csv').classList.contains('d-none')).toBe(false);
    });

    test('confirmar manda sólo lo no bloqueado, con el reemplazo aprobado, y refresca el resto', async () => {
        const cliente = await soltarLayout();
        window.confirm = jest.fn(() => true);
        const boton = document.getElementById('ag-imp-confirmar');
        expect(boton.disabled).toBe(false);
        expect(boton.textContent).toContain('(42)');

        const resumenesAntes = cliente.llamadas.rpc.filter((n) => n === 'fbo_resumen').length;
        boton.click();
        await asentar(6);

        const envios = cliente.llamadas.args.filter((a) => a.nombre === 'fbo_importar_operaciones');
        expect(envios).toHaveLength(1);
        const filas = envios[0].args.p_filas;
        expect(filas).toHaveLength(42);
        expect(filas.map((f) => f.registro)).not.toContain('AG-2026-000005');
        expect(filas.find((f) => f.registro === 'AG-2026-000004').reemplaza_registro).toBe('BASE2026-0855');
        expect(filas.find((f) => f.registro === 'AG-2026-000011')).not.toHaveProperty('reemplaza_registro');

        const resultado = document.getElementById('ag-imp-resultado').textContent.replace(/\s+/g, ' ');
        expect(resultado).toContain('Importación completada');
        expect(resultado).toContain('40 insertadas');
        expect(resultado).toContain('1 omitidas por error');
        // No se puede volver a mandar el mismo archivo sin recargarlo.
        expect(boton.disabled).toBe(true);

        // El Resumen quedó viejo: al abrirlo vuelve a consultar.
        window.AviacionGeneral.abrirVista('resumen');
        await asentar(3);
        expect(cliente.llamadas.rpc.filter((n) => n === 'fbo_resumen').length).toBeGreaterThan(resumenesAntes);
    });

    test('si no se pudo comparar contra lo guardado, no deja importar', async () => {
        const cliente = clienteFalso();
        const original = cliente.rpc;
        cliente.rpc = (nombre, args, op) => (nombre === 'fbo_previa_importacion'
            ? { then: (ok) => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fbo_previa_importacion(p_filas)' } }).then(ok) }
            : original(nombre, args, op));
        await soltarLayout({ cliente });
        expect(document.getElementById('ag-imp-resumen-previa').textContent).toContain('064b_fbo_importar_operaciones.sql');
        expect(document.getElementById('ag-imp-confirmar').disabled).toBe(true);
    });
});

describe('validación y auditoría siguen en la fuente anterior', () => {
    test('validación lo dice, lee aviacion_general_operaciones y traduce los filtros', async () => {
        const cliente = await entrar();
        window.AviacionGeneral.abrirVista('validacion');
        await asentar(3);
        expect(document.getElementById('ag-pane-validacion').textContent).toContain('Fuente: histórico anterior');
        expect(cliente.llamadas.tablas).toContain('aviacion_general_operaciones');
        expect(document.getElementById('ag-val-estado').value).toBe('PENDIENTE');
    });

    test('lista los duplicados y distingue los que discrepan', async () => {
        await entrar();
        window.AviacionGeneral.abrirVista('validacion');
        await asentar(3);
        document.getElementById('ag-val-duplicados').click();
        await asentar(3);
        const caja = document.getElementById('ag-val-duplicados-resultado').textContent;
        expect(caja).toContain('N900MC');
        expect(caja).toContain('Discrepan');
        expect(caja).toContain('Idénticas');
    });

    test('el #id de un duplicado abre su historial al primer clic', async () => {
        await entrar();
        window.AviacionGeneral.abrirVista('validacion');
        await asentar(3);
        expect(document.getElementById('ag-pane-auditoria').dataset.montado).toBeUndefined();
        document.getElementById('ag-val-duplicados').click();
        await asentar(3);
        document.querySelector('#ag-val-duplicados-resultado [data-ag-dup-id]').click();
        await asentar(4);
        expect(document.getElementById('ag-aud-id').value).toBe('3700');
        expect(document.getElementById('ag-aud-detalle').textContent).toContain('Movimiento #3700');
    });

    test('auditoría lo dice y muestra qué cambió, no los dos JSON completos', async () => {
        await entrar();
        window.AviacionGeneral.abrirVista('auditoria');
        await asentar(3);
        expect(document.getElementById('ag-pane-auditoria').textContent).toContain('Fuente: histórico anterior');
        const reciente = document.getElementById('ag-aud-reciente').textContent;
        expect(reciente).toContain('Matrícula');
        expect(reciente).toContain('XA-MAM');
        expect(reciente).toContain('XA-MAN');
        expect(reciente).not.toContain('version');
    });
});

// Captura está oculta (decisión D4, 2026-10-09): escribe en la fuente anterior
// y lo capturado no aparecería en el Resumen. El archivo se conserva intacto;
// sus pruebas de formulario siguen en el historial de git
// (__tests__/aviacion-general-panel.test.js antes de este cambio) para
// reactivarlas junto con la pestaña.
describe('captura', () => {
    test('no se ofrece ni a un administrador', async () => {
        await entrar({ nivel: 'admin' });
        expect(pestanas()).not.toContain('captura');
        expect(document.getElementById('ag-pane-captura')).toBeNull();
    });
});
