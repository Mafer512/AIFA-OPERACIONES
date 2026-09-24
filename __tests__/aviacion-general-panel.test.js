/**
 * @jest-environment jsdom
 */

/**
 * Armazón y pantallas del módulo de Aviación General / FBO.
 *
 * Esto no vuelve a probar las reglas del núcleo —de eso se ocupa
 * aviacion-general-core.test.js— sino el cableado, que es donde un módulo
 * partido en siete archivos se rompe de verdad:
 *
 *   · que el panel se monte SOLO al entrar a la sección y no al cargar el
 *     portal (seis pestañas cargando de golpe son seis viajes a la base que
 *     nadie pidió);
 *   · que las pantallas se registren solas y aparezcan como pestañas;
 *   · que el nivel de acceso esconda de verdad lo que no se puede usar;
 *   · que cada pestaña consulte cuando se abre, no antes;
 *   · que cambiar un filtro invalide lo pintado en lugar de dejar cifras viejas
 *     con filtros nuevos, que es la forma silenciosa de mentirle al usuario.
 *
 * El contenedor se recorta de index.html, no se escribe a mano: si alguien
 * renombra el id allá, esta prueba falla en vez de seguir pasando contra una
 * copia que ya no existe.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const ARCHIVOS_MODULO = [
    'datos.js', 'panel.js',
    'vista-resumen.js', 'vista-movimientos.js', 'vista-captura.js',
    'vista-importacion.js', 'vista-validacion.js', 'vista-auditoria.js'
];

function fuente(archivo) {
    return fs.readFileSync(path.join(raiz, 'js', 'aviacion-general', archivo), 'utf8');
}

function resumenDePrueba() {
    return {
        totales: {
            movimientos: 1892, llegadas: 950, salidas: 942,
            nacionales: 1700, internacionales: 192,
            pax: 5400, adultos: 5100, infantes: 300,
            rotaciones: 940, operadores: 210, matriculas: 380,
            pendientes: 12, validados: 1870, observados: 10,
            fecha_min: '2026-01-02', fecha_max: '2026-09-10'
        },
        por_mes: [
            { periodo: '2026-01', anio: 2026, mes: 1, movimientos: 200, llegadas: 100, salidas: 100, pax: 600, pax_llegada: 310, pax_salida: 290 },
            { periodo: '2026-02', anio: 2026, mes: 2, movimientos: 180, llegadas: 92, salidas: 88, pax: 540, pax_llegada: 280, pax_salida: 260 }
        ],
        por_ambito: [{ clave: 'NACIONAL', movimientos: 1700, pax: 4900 }],
        por_tipo_operacion: [{ clave: 'LLEGADA', movimientos: 950, pax: 2700 }],
        top_operadores: [{ clave: 'AEROLÍNEAS EJECUTIVAS', movimientos: 120, pax: 300 }],
        top_aeronaves: [{ clave: 'G650', movimientos: 90, pax: 210 }],
        top_aeropuertos: [{ clave: 'MMTO', movimientos: 75, pax: 180 }],
        top_matriculas: [{ clave: 'XA-MAM', movimientos: 40, operador: 'X', tipo_aeronave: 'G650' }]
    };
}

/**
 * Dos filas que reproducen las DOS convenciones de captura del histórico:
 *   par  -> años 2025-2026: código de aeropuerto y desglose adultos/infantes.
 *   impar-> años 2022-2024: ciudad y sólo el total reportado.
 * Si la pantalla lee una sola de las dos, la mitad sale en blanco.
 */
function filaDePrueba(id) {
    const estiloViejo = id % 2 === 1;
    return {
        id, folio_rotacion: id, fecha_operacion: '2026-03-15',
        tipo_operacion: 'LLEGADA', ambito_operacion: 'NACIONAL',
        operador: 'AEROLÍNEAS EJECUTIVAS', matricula: 'XA-MAM', tipo_aeronave: 'G650',
        aeropuerto_origen_destino: estiloViejo ? null : 'MMTO',
        ciudad_origen_destino: estiloViejo ? 'BROWARD' : null,
        hora_programada: '08:30:00', hora_real: '08:41:00',
        hora_aterrizaje: estiloViejo ? null : '19:44:00',
        hora_entrada_posicion: estiloViejo ? null : '19:48:00',
        hora_salida_posicion: null, hora_despegue: null,
        adultos: estiloViejo ? null : 3,
        infantes: estiloViejo ? null : 0,
        pax_total_reportado: estiloViejo ? 15 : null,
        pax_ag: estiloViejo ? 15 : 3,
        pax_od: null, estado: null, pais: null,
        observaciones: null, movimiento_relacionado_id: null, tipo_fuente: 'IMPORTACION_EXCEL',
        archivo_origen: 'bitacora.xlsx', fila_origen: 7, estado_validacion: 'PENDIENTE',
        fecha_validacion: null, observacion_validacion: null, estatus_registro: 'ACTIVO',
        motivo_anulacion: null, version: 1,
        fecha_creacion: '2026-03-16T10:00:00Z', fecha_modificacion: '2026-03-16T10:00:00Z'
    };
}

/**
 * Cliente de mentiras con la misma forma encadenable que supabase-js. Registra
 * cada llamada para poder afirmar QUÉ se consultó y cuántas veces.
 */
function clienteFalso() {
    const llamadas = { rpc: [], tablas: [], modos: [] };

    const respuestasRpc = {
        aviacion_general_resumen: () => resumenDePrueba(),
        aviacion_general_opciones: () => ({
            operadores: ['AEROLÍNEAS EJECUTIVAS'], matriculas: ['XA-MAM'],
            tipos_aeronave: ['G650'], aeropuertos: ['MMTO'], anios: [2026], archivos: []
        }),
        aviacion_general_validar: () => 2,
        aviacion_general_baja: () => true,
        aviacion_general_enlazar_rotaciones: () => ({ movimientos_enlazados: 4, grupos_ambiguos: 1 }),
        aviacion_general_duplicados: () => ([
            { folio_rotacion: 512, tipo_operacion: 'SALIDA', fecha_operacion: '2024-06-04',
              matricula: 'N900MC', operador: 'X', veces: 2, ids: [3700, 3701], discrepan: true },
            { folio_rotacion: 95, tipo_operacion: 'LLEGADA', fecha_operacion: '2026-01-30',
              matricula: 'XC-FEZ', operador: 'Y', veces: 2, ids: [8558, 8606], discrepan: false }
        ]),
        aviacion_general_importar: () => ({
            simulacion: true, recibidas: 2, insertadas: 2, duplicadas: 0, rechazadas: 0,
            detalle_duplicadas: [], detalle_rechazadas: []
        })
    };

    function constructor(tabla) {
        const enlace = {
            select() { return enlace; },
            eq() { return enlace; },
            gte() { return enlace; },
            lte() { return enlace; },
            ilike() { return enlace; },
            or() { return enlace; },
            order() { return enlace; },
            range() { return enlace; },
            limit() { return enlace; },
            maybeSingle: async () => ({ data: filaDePrueba(1), error: null }),
            single: async () => ({ data: filaDePrueba(1), error: null }),
            insert() { return enlace; },
            update() { return enlace; },
            then(alResolver, alFallar) {
                llamadas.tablas.push(tabla);
                const data = tabla.endsWith('_auditoria')
                    ? [{
                        id: 1, registro_id: 1, operacion: 'UPDATE',
                        datos_anteriores: { matricula: 'XA-MAM', version: 1 },
                        datos_nuevos: { matricula: 'XA-MAN', version: 2 },
                        realizado_por: '11111111-2222-3333-4444-555555555555',
                        fecha_evento: '2026-03-17T12:00:00Z'
                    }]
                    : [filaDePrueba(1), filaDePrueba(2)];
                return Promise.resolve({ data, error: null, count: data.length })
                    .then(alResolver, alFallar);
            }
        };
        return enlace;
    }

    return {
        llamadas,
        from: constructor,
        rpc: async (nombre, args) => {
            llamadas.rpc.push(nombre);
            // Se guarda el modo con el que se pidió el resumen: de eso depende
            // que el tablero enseñe la cifra oficial y no otra.
            if (nombre === 'aviacion_general_resumen') llamadas.modos.push((args || {}).p_modo);
            const fn = respuestasRpc[nombre];
            return fn ? { data: fn(), error: null } : { data: null, error: { message: `RPC sin stub: ${nombre}` } };
        }
    };
}

/** Deja pasar las promesas encadenadas del montaje. */
const asentar = () => new Promise((resolver) => setTimeout(resolver, 0));

function montarModulo({ nivel = 'admin' } = {}) {
    // El contenedor tal como está en index.html.
    const marcado = indexSource.match(/<div id="aviacion-general-section" class="content-section"><\/div>/);
    if (!marcado) throw new Error('No se encontró #aviacion-general-section en index.html');
    document.body.innerHTML = marcado[0];

    const cliente = clienteFalso();
    window.supabaseClient = cliente;
    window.ensureSupabaseClient = async () => cliente;
    window.sectionLevel = () => nivel;
    window.showNotification = jest.fn();
    // Chart.js no está en jsdom y no hace falta: lo que se prueba es el
    // cableado, no el dibujo. Un doble con destroy/resize basta.
    window.Chart = function () { return { destroy() {}, resize() {} }; };
    // jsdom no implementa getContext y escupe un error por cada lienzo. No es
    // un fallo del módulo —en el navegador existe— así que se calla aquí en
    // lugar de ensuciar el código de producción con guardas para las pruebas.
    window.HTMLCanvasElement.prototype.getContext = () => ({});

    window.AviacionGeneralCore = require('../js/aviacion-general/core.js');
    ARCHIVOS_MODULO.forEach((archivo) => { new Function(fuente(archivo))(); });

    return cliente;
}

describe('montaje de la sección', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    test('no se monta al cargar el portal: sólo al entrar a la sección', async () => {
        const cliente = montarModulo();
        await asentar();

        const seccion = document.getElementById('aviacion-general-section');
        expect(seccion.innerHTML.trim()).toBe('');
        expect(cliente.llamadas.rpc).toEqual([]);
    });

    test('al activarse arma encabezado, filtros y pestañas', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        expect(document.querySelector('.ag-header h2').textContent).toContain('Aviación General');
        expect(document.getElementById('ag-f-desde')).not.toBeNull();
        expect(document.getElementById('ag-f-matricula')).not.toBeNull();

        const pestanas = Array.from(document.querySelectorAll('#ag-tabs .nav-link'))
            .map((b) => b.dataset.agVista);
        expect(pestanas).toEqual([
            'resumen', 'movimientos', 'captura', 'importacion', 'validacion', 'auditoria'
        ]);
    });

    test('el rango por omisión es el año en curso', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        const anio = new Date().getFullYear();
        expect(document.getElementById('ag-f-desde').value).toBe(`${anio}-01-01`);
        expect(document.getElementById('ag-f-hasta').value).toBe(`${anio}-12-31`);
    });
});

describe('niveles de acceso', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    test('sólo lectura no ve captura ni importación', async () => {
        montarModulo({ nivel: 'read' });
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        const pestanas = Array.from(document.querySelectorAll('#ag-tabs .nav-link'))
            .map((b) => b.dataset.agVista);
        expect(pestanas).not.toContain('captura');
        expect(pestanas).not.toContain('importacion');
        // Consultar y auditar sí: ver el histórico no es escribirlo.
        expect(pestanas).toContain('movimientos');
        expect(pestanas).toContain('auditoria');
    });

    test('un capturista ve captura pero no puede validar', async () => {
        montarModulo({ nivel: 'capture' });
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        const pestanas = Array.from(document.querySelectorAll('#ag-tabs .nav-link'))
            .map((b) => b.dataset.agVista);
        expect(pestanas).toContain('captura');

        window.AviacionGeneral.abrirVista('validacion');
        await asentar();
        await asentar();
        expect(document.getElementById('ag-val-sin-permiso').classList.contains('d-none')).toBe(false);
        expect(document.getElementById('ag-val-validar').disabled).toBe(true);
    });
});

describe('carga perezosa y frescura de los datos', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    test('al entrar sólo consulta la primera pestaña, no las seis', async () => {
        const cliente = montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        // Resumen (RPC) y el diagnóstico de instalación; la tabla de
        // movimientos todavía NO se consulta porque su pestaña está cerrada.
        expect(cliente.llamadas.rpc).toContain('aviacion_general_resumen');
        expect(cliente.llamadas.tablas).not.toContain('aviacion_general_operaciones_auditoria');
    });

    test('el resumen pinta las cifras que devuelve PostgreSQL, sin recalcularlas', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        const kpis = document.getElementById('ag-res-kpis').textContent;
        expect(kpis).toContain('1,892');   // movimientos
        expect(kpis).toContain('950');     // llegadas
        expect(kpis).toContain('5,400');   // pax
    });

    test('siempre pide el conteo OFICIAL, y no ofrece ningún otro en pantalla', async () => {
        // El reporte de GAG es la cifra auténtica. Tener dos conteos a la vista
        // invitaba a reportar el que no es, así que el módulo enseña uno solo.
        const cliente = montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        // El sondeo de instalación llama al RPC sin modo —le da igual, sólo
        // comprueba que la función responda— y la base resuelve eso al oficial.
        // Lo que se vigila es que NADA pida el otro conteo.
        expect(cliente.llamadas.modos).toContain('rotacion');
        expect(cliente.llamadas.modos).not.toContain('movimiento');
        expect(document.getElementById('ag-res-modo-rotacion')).toBeNull();
        expect(document.getElementById('ag-res-modo-movimiento')).toBeNull();
    });

    test('sigue pidiendo el conteo oficial al cambiar los filtros', async () => {
        const cliente = montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        document.getElementById('ag-f-matricula').value = 'XA-MAM';
        document.getElementById('ag-btn-aplicar').click();
        await asentar();
        await asentar();

        expect(cliente.llamadas.modos.filter((m) => m === 'rotacion').length).toBeGreaterThan(1);
        expect(cliente.llamadas.modos).not.toContain('movimiento');
    });

    test('la tabla mensual separa pasajeros de llegada y de salida, como el reporte', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        document.getElementById('ag-res-ver-tabla').click();
        const tabla = document.getElementById('ag-res-tabla-mes').textContent;
        expect(tabla).toContain('310');  // pax llegada de enero
        expect(tabla).toContain('290');  // pax salida de enero
        // Y los totales de las dos columnas.
        expect(tabla).toContain('590');  // 310 + 280
        expect(tabla).toContain('550');  // 290 + 260
    });

    test('los pasajeros tienen su propia gráfica, no una tercera línea en la de movimientos', async () => {
        // 455 movimientos contra 1,385 pasajeros: en un mismo lienzo harían
        // falta dos escalas, y dos ejes distintos hacen que dos series parezcan
        // cruzarse donde no se cruzan.
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        expect(document.getElementById('ag-res-pax')).not.toBeNull();
        expect(document.getElementById('ag-res-pax-nota').textContent).toContain('5,400');
    });

    test('cuando el año se capturó sin desglose, lo dice en vez de mostrar "0 adultos"', async () => {
        // Regresión: 2022 usa pax_total_reportado, así que adultos e infantes
        // suman 0 bajo un total de 1,385. El KPI decía "0 adultos · 0 infantes",
        // que no se lee como "se capturó de otra forma" sino como un error.
        const cliente = clienteFalso();
        window.supabaseClient = cliente;
        window.ensureSupabaseClient = async () => cliente;
        window.sectionLevel = () => 'admin';
        window.showNotification = jest.fn();
        window.Chart = function () { return { destroy() {}, resize() {} }; };
        window.HTMLCanvasElement.prototype.getContext = () => ({});

        const resumenSinDesglose = resumenDePrueba();
        resumenSinDesglose.totales.adultos = 0;
        resumenSinDesglose.totales.infantes = 0;
        resumenSinDesglose.totales.pax = 1385;
        cliente.rpc = async (nombre) => {
            if (nombre === 'aviacion_general_resumen') return { data: resumenSinDesglose, error: null };
            if (nombre === 'aviacion_general_opciones') return { data: {}, error: null };
            return { data: null, error: null };
        };

        const marcado = indexSource.match(/<div id="aviacion-general-section" class="content-section"><\/div>/);
        document.body.innerHTML = marcado[0];
        window.AviacionGeneralCore = require('../js/aviacion-general/core.js');
        ARCHIVOS_MODULO.forEach((archivo) => { new Function(fuente(archivo))(); });
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        const kpis = document.getElementById('ag-res-kpis').textContent;
        expect(kpis).toContain('1,385');
        expect(kpis).toContain('sin desglose');
        expect(kpis).not.toContain('0 adultos');
    });

    test('con desglose parcial reporta las tres partes', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();
        // El resumen de prueba trae pax 5,400 con 5,100 adultos y 300 infantes:
        // cuadra exacto, así que no debe inventar un "sin desglose".
        const kpis = document.getElementById('ag-res-kpis').textContent;
        expect(kpis).toContain('5,100 adultos');
        expect(kpis).toContain('300 infantes');
        expect(kpis).not.toContain('sin desglose');
    });

    test('la serie mensual ofrece tabla además de gráfica', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        document.getElementById('ag-res-ver-tabla').click();
        const tabla = document.getElementById('ag-res-tabla-mes');
        expect(tabla.hidden).toBe(false);
        expect(tabla.textContent).toContain('Ene 2026');
        expect(document.getElementById('ag-res-caja-mes').hidden).toBe(true);
    });

    test('cambiar un filtro invalida lo pintado y vuelve a consultar', async () => {
        const cliente = montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        const antes = cliente.llamadas.rpc.filter((n) => n === 'aviacion_general_resumen').length;

        document.getElementById('ag-f-matricula').value = 'XA-MAM';
        document.getElementById('ag-btn-aplicar').click();
        await asentar();
        await asentar();

        const despues = cliente.llamadas.rpc.filter((n) => n === 'aviacion_general_resumen').length;
        expect(despues).toBeGreaterThan(antes);
        expect(window.AviacionGeneral.filtros.matricula).toBe('XA-MAM');
    });
});

describe('pantalla de movimientos', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    test('lista las filas de la base y ofrece exportación', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        window.AviacionGeneral.abrirVista('movimientos');
        await asentar();
        await asentar();

        const cuerpo = document.getElementById('ag-mov-tbody').textContent;
        expect(cuerpo).toContain('XA-MAM');
        expect(cuerpo).toContain('15 Mar 2026');
        expect(document.getElementById('ag-mov-excel')).not.toBeNull();
        expect(document.getElementById('ag-mov-csv')).not.toBeNull();
    });

    test('muestra la ciudad cuando no hay código de aeropuerto', async () => {
        // Regresión: la tabla leía sólo aeropuerto_origen_destino, así que
        // 5,438 de los 10,396 movimientos salían con el origen en blanco.
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();
        window.AviacionGeneral.abrirVista('movimientos');
        await asentar();
        await asentar();

        const cuerpo = document.getElementById('ag-mov-tbody');
        expect(cuerpo.textContent).toContain('MMTO');     // fila con código
        expect(cuerpo.textContent).toContain('BROWARD');  // fila con ciudad
        // La procedencia del dato se distingue sin colorearlo como si fuera error.
        expect(cuerpo.querySelector('.ag-od-ciudad')).not.toBeNull();
    });

    test('las horas de plataforma y el pax reportado ya tienen columna', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();
        window.AviacionGeneral.abrirVista('movimientos');
        await asentar();
        await asentar();

        const encabezados = document.getElementById('ag-mov-thead').textContent;
        ['Aterr.', 'Ent. pos.', 'Sal. pos.', 'Despegue', 'Pax rep.']
            .forEach((t) => expect(encabezados).toContain(t));
        // Y el dato se pinta, no sólo la columna.
        expect(document.getElementById('ag-mov-tbody').textContent).toContain('19:44');
    });

    test('el botón de nuevo movimiento no existe para un lector', async () => {
        montarModulo({ nivel: 'read' });
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        window.AviacionGeneral.abrirVista('movimientos');
        await asentar();
        await asentar();

        expect(document.getElementById('ag-mov-nuevo').hidden).toBe(true);
    });
});

describe('formulario de captura', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    async function abrirCaptura() {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();
        window.AviacionGeneral.abrirVista('captura');
        await asentar();
        await asentar();
    }

    test('trae los campos del diccionario y la fecha de hoy puesta', async () => {
        await abrirCaptura();
        ['folio-rotacion', 'fecha-operacion', 'tipo-operacion', 'ambito-operacion',
         'operador', 'matricula', 'tipo-aeronave', 'aeropuerto-origen-destino',
         'hora-programada', 'hora-real', 'adultos', 'infantes', 'pax-od',
         'estado', 'pais', 'observaciones'].forEach((campo) => {
            expect(document.getElementById(`ag-cap-${campo}`)).not.toBeNull();
        });
        const hoy = new Date();
        const esperada = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        expect(document.getElementById('ag-cap-fecha-operacion').value).toBe(esperada);
    });

    test('cada campo cuelga directamente de la rejilla: ningún <div> de más', async () => {
        // Regresión: una edición dejó dos <div class="col-4 col-md-2"> seguidos.
        // El HTML seguía siendo válido y nada fallaba, pero todo lo que venía
        // después quedaba anidado dentro de esa columna estrecha y el formulario
        // se veía como una lista apretada contra el borde derecho.
        await abrirCaptura();
        const fila = document.querySelector('#ag-cap-form .row');
        expect(fila).not.toBeNull();

        ['ag-cap-folio-rotacion', 'ag-cap-operador', 'ag-cap-hora-real',
         'ag-cap-adultos', 'ag-cap-infantes', 'ag-cap-pax',
         'ag-cap-pax-od', 'ag-cap-estado', 'ag-cap-pais', 'ag-cap-observaciones']
            .forEach((campoId) => {
                const columna = document.getElementById(campoId).closest('[class*="col-"]');
                expect(columna).not.toBeNull();
                // El padre de la columna tiene que ser la rejilla, no otra columna.
                expect(columna.parentElement).toBe(fila);
            });
    });

    test('cada renglón de la rejilla cierra exactamente en 12 columnas', async () => {
        // Bootstrap acomoda igual aunque las anchuras no sumen 12, pero deja
        // huecos y saltos raros que se ven como un formulario desalineado. Esto
        // simula el acomodo y exige que cada renglón cierre justo.
        await abrirCaptura();
        const fila = document.querySelector('#ag-cap-form .row');
        const anchos = Array.from(fila.children).map((columna) => {
            const m = columna.className.match(/col-md-(\d+)/);
            return m ? Number(m[1]) : 12;
        });

        const renglones = [];
        let acumulado = 0;
        anchos.forEach((ancho) => {
            if (acumulado + ancho > 12) { renglones.push(acumulado); acumulado = 0; }
            acumulado += ancho;
        });
        renglones.push(acumulado);

        expect(renglones.length).toBeGreaterThan(0);
        renglones.forEach((suma) => expect(suma).toBe(12));
    });

    test('adultos e infantes arrancan VACÍOS, no en 0', async () => {
        // Pre-llenarlos con 0 convertía cada captura en "viajaron cero
        // pasajeros" aunque nadie hubiera tocado el campo.
        await abrirCaptura();
        expect(document.getElementById('ag-cap-adultos').value).toBe('');
        expect(document.getElementById('ag-cap-infantes').value).toBe('');
        expect(document.getElementById('ag-cap-pax').value).toBe('—');
    });

    test('Pax A.G. se calcula en pantalla en cuanto se teclea', async () => {
        await abrirCaptura();
        const teclear = (campo, valor) => {
            const el = document.getElementById(`ag-cap-${campo}`);
            el.value = valor;
            el.dispatchEvent(new window.Event('input', { bubbles: true }));
        };
        teclear('adultos', '3');
        expect(document.getElementById('ag-cap-pax').value).toBe('3');
        teclear('infantes', '2');
        expect(document.getElementById('ag-cap-pax').value).toBe('5');
        // El tercer sumando de la columna generada, que antes faltaba.
        teclear('pax-total-reportado', '10');
        expect(document.getElementById('ag-cap-pax').value).toBe('15');
    });

    test('se pueden capturar las seis columnas que el diccionario no declara', async () => {
        await abrirCaptura();
        ['ciudad-origen-destino', 'pax-total-reportado', 'hora-aterrizaje',
         'hora-entrada-posicion', 'hora-salida-posicion', 'hora-despegue']
            .forEach((campo) => expect(document.getElementById(`ag-cap-${campo}`)).not.toBeNull());
    });

    test('no guarda con campos obligatorios vacíos y señala cuáles', async () => {
        await abrirCaptura();
        document.getElementById('ag-cap-form').dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true }));
        await asentar();

        const errores = document.getElementById('ag-cap-errores').textContent;
        expect(errores).toContain('Revisa estos campos');
        expect(document.getElementById('ag-cap-matricula').classList.contains('is-invalid')).toBe(true);
        expect(document.getElementById('ag-cap-operador').classList.contains('is-invalid')).toBe(true);
        // El aeropuerto NO es obligatorio: falta en la mitad del histórico real.
        expect(document.getElementById('ag-cap-aeropuerto-origen-destino').classList.contains('is-invalid')).toBe(false);
    });

    test('la pista del aeropuerto cambia según llegada o salida', async () => {
        await abrirCaptura();
        const tipo = document.getElementById('ag-cap-tipo-operacion');
        tipo.value = 'LLEGADA';
        tipo.dispatchEvent(new window.Event('change', { bubbles: true }));
        expect(document.getElementById('ag-cap-pista-aeropuerto').textContent).toMatch(/ORIGEN/);

        tipo.value = 'SALIDA';
        tipo.dispatchEvent(new window.Event('change', { bubbles: true }));
        expect(document.getElementById('ag-cap-pista-aeropuerto').textContent).toMatch(/DESTINO/);
    });
});

describe('detección de capturas repetidas', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    test('lista los grupos y distingue los que discrepan de los idénticos', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        window.AviacionGeneral.abrirVista('validacion');
        await asentar();
        await asentar();

        document.getElementById('ag-val-duplicados').click();
        await asentar();
        await asentar();

        const caja = document.getElementById('ag-val-duplicados-resultado').textContent;
        expect(caja).toContain('N900MC');
        expect(caja).toContain('XC-FEZ');
        // La distinción importa: si las copias coinciden da igual cuál se anula;
        // si discrepan hay que abrir las dos y decidir.
        expect(caja).toContain('Discrepan');
        expect(caja).toContain('Idénticas');
    });

    test('no ofrece borrar: sólo lleva al historial de cada copia', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        window.AviacionGeneral.abrirVista('validacion');
        await asentar();
        await asentar();
        document.getElementById('ag-val-duplicados').click();
        await asentar();
        await asentar();

        const zona = document.getElementById('ag-val-duplicados-resultado');
        expect(zona.querySelector('[data-ag-accion="baja"]')).toBeNull();

        zona.querySelector('[data-ag-dup-id]').click();
        await asentar();
        await asentar();
        await asentar();
        expect(document.getElementById('ag-aud-id').value).toBe('3700');
    });
});

describe('auditoría', () => {
    beforeEach(() => {
        jest.resetModules();
        ['AviacionGeneral', 'AviacionGeneralDatos', 'AviacionGeneralCore',
         'AviacionGeneralResumen', 'AviacionGeneralMovimientos'].forEach((k) => { delete window[k]; });
    });

    test('el botón de historial funciona al PRIMER clic, sin haber abierto nunca la pestaña', async () => {
        // Regresión: el oyente vivía dentro de montar(), así que el primer clic
        // —el único que importa, porque es el que abre la pestaña— no hacía nada.
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        window.AviacionGeneral.abrirVista('movimientos');
        await asentar();
        await asentar();

        expect(document.getElementById('ag-pane-auditoria').dataset.montado).toBeUndefined();

        document.querySelector('#ag-mov-tbody [data-ag-accion="historial"]').click();
        await asentar();
        await asentar();
        await asentar();

        expect(document.getElementById('ag-aud-id').value).toBe('1');
        expect(document.getElementById('ag-aud-detalle').textContent).toContain('Movimiento #1');
    });

    test('muestra qué cambió, no los dos JSON completos', async () => {
        montarModulo();
        document.getElementById('aviacion-general-section').classList.add('active');
        await asentar();
        await asentar();

        window.AviacionGeneral.abrirVista('auditoria');
        await asentar();
        await asentar();

        const reciente = document.getElementById('ag-aud-reciente').textContent;
        expect(reciente).toContain('Matrícula');
        expect(reciente).toContain('XA-MAM');
        expect(reciente).toContain('XA-MAN');
        // La versión cambió también, pero es ruido de la propia auditoría.
        expect(reciente).not.toContain('version');
    });
});
