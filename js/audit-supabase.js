/**
 * Rastro automático de todo lo que se escribe en la base.
 *
 * Hasta ahora cada pantalla tenía que acordarse de llamar a window.logHistory()
 * después de guardar, y la mayoría no lo hacía: de todas las escrituras del
 * sistema, 63 combinaciones de tabla y acción no dejaban ningún rastro. Quien
 * abría el Historial de Cambios veía Colaboradores, Agenda, Muebles y el Parte
 * de Operaciones, y creía que eso era todo lo que había pasado.
 *
 * Aquí se envuelve el cliente de Supabase: cada insert / update / upsert /
 * delete que termina bien queda anotado en change_history con su tabla, su
 * acción, cuántas filas movió y un resumen legible. No hace falta tocar los
 * módulos: el que escriba, queda registrado.
 *
 * Reglas:
 *   · Las tablas técnicas (presencia en vivo, suscripciones del navegador, el
 *     propio historial) no se auditan: serían ruido, no rastro.
 *   · Las tablas cuyo módulo YA registra su propio detalle —con el antes y el
 *     después campo por campo— se dejan a su registro, para no duplicar.
 *   · Si algo falla al anotar, la escritura original sigue su curso: la
 *     auditoría nunca puede tumbar un guardado.
 */
(function (global) {
    'use strict';

    const ACCIONES = Object.freeze({
        insert: 'CREAR',
        upsert: 'GUARDAR',
        update: 'EDITAR',
        delete: 'ELIMINAR',
    });

    /* Ruido, no rastro: nada que auditar aquí. */
    const SIN_AUDITORIA = new Set([
        'change_history',            // el propio historial
        'colab_historial',           // historial dedicado de Colaboradores
        'push_subscriptions',        // suscripción del navegador a notificaciones
        'conci_presencia',           // cursores y presencia en vivo
        'conci_manifiestos_presencia',
        'document_watermarks',       // marca de agua técnica de un PDF
    ]);

    /* Módulos que ya escriben su propio registro, campo por campo. */
    const CON_REGISTRO_PROPIO = new Set([
        'agenda_2026',
        'agenda_comites',
        'agenda_reuniones',
        'agenda_acuerdos',
        'muebles_bienes',
        'muebles_bienes_documentos',
        'muebles_bienes_documentos_archivos',
        'vuelos_parte_operaciones',
        'vuelos_parte_operaciones_csv',
        'parte_operations',
    ]);

    /* Nombre de cada tabla como lo diría una persona del área. */
    const NOMBRES = Object.freeze({
        aeropuertos: 'Catálogo de aeropuertos',
        areas: 'Áreas y adscripciones',
        atencion_derrames: 'Atención de derrames',
        catalogo_vehiculos: 'Catálogo de vehículos',
        colab_cursos: 'Cursos de colaboradores',
        colab_vacaciones: 'Vacaciones de colaboradores',
        conciliacion_catalogo_aerolineas: 'Catálogo de aerolíneas',
        coyh_asistencia: 'COYH — Asistencia',
        coyh_confirmaciones: 'COYH — Confirmaciones',
        coyh_participantes: 'COYH — Participantes',
        custom_parte_operaciones: 'Parte de operaciones (personalizado)',
        daily_flights_ops: 'Vuelos del día',
        daily_operations: 'Operaciones diarias',
        demoras: 'Demoras',
        fids_vuelos: 'FIDS — Vuelos',
        flights: 'Vuelos',
        ggen_consumo_gas: 'Gestión energética — Gas',
        ggen_energia_electrica: 'Gestión energética — Energía eléctrica',
        ggen_energia_termica: 'Gestión energética — Energía térmica',
        gtrans_mantenimientos_bt: 'Transformación — Mantenimientos',
        gtrans_meta_anual: 'Transformación — Meta anual',
        gtrans_preventivo_mensual: 'Transformación — Preventivo mensual',
        itinerario_vuelos_editable: 'Itinerario de vuelos',
        manifiestos_pasajeros: 'Manifiestos de pasajeros',
        manifiestos_pdfs: 'Manifiestos en PDF',
        manifiestos_vuelos_editable: 'Conciliación — Manifiestos',
        matriculas_manifiestos: 'Catálogo de matrículas',
        medical_attentions: 'Atenciones médicas',
        medical_directory: 'Directorio médico',
        monthly_operations: 'Operaciones mensuales',
        operations_summary: 'Resumen de operaciones',
        perfiles: 'Perfiles de usuario',
        personal_capacitado: 'Personal capacitado',
        punctuality_stats: 'Puntualidad',
        rescued_wildlife: 'Fauna rescatada',
        route_launch_calendar: 'Calendario de nuevas rutas',
        tv_notas: 'Notas de pantallas',
        user_roles: 'Roles de usuario',
        valoraciones_medicas: 'Valoraciones médicas',
        vehiculo_mantenimientos: 'Mantenimiento de vehículos',
        weekly_frequencies: 'Frecuencias semanales',
        weekly_frequencies_cargo: 'Frecuencias semanales — Carga',
        weekly_frequencies_int: 'Frecuencias semanales — Internacional',
        whatsapp_alertas: 'Alertas de WhatsApp',
        wildlife_strikes: 'Reportes de fauna',
    });

    function nombreDeTabla(tabla) {
        if (NOMBRES[tabla]) return NOMBRES[tabla];
        return String(tabla || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    function seAudita(tabla) {
        if (!tabla) return false;
        if (SIN_AUDITORIA.has(tabla)) return false;
        if (CON_REGISTRO_PROPIO.has(tabla)) return false;
        return true;
    }

    /** Cuántas filas movió la operación, cuando se puede saber. */
    function contarFilas(argumentos, resultado) {
        if (resultado && Array.isArray(resultado.data)) return resultado.data.length;
        const primero = argumentos && argumentos[0];
        if (Array.isArray(primero)) return primero.length;
        if (primero && typeof primero === 'object') return 1;
        return null;
    }

    /** Un puñado de campos reconocibles para saber de qué registro se habla. */
    const CLAVES_IDENTIDAD = [
        'id', 'num_empleado', 'no_empleado', 'numero_empleado', 'clave', 'codigo',
        'fecha', 'date', 'nombre', 'name', 'matricula', 'vuelo', 'token',
    ];

    function identificar(argumentos, resultado) {
        const candidatos = [];
        if (resultado && Array.isArray(resultado.data) && resultado.data.length) candidatos.push(resultado.data[0]);
        const primero = argumentos && argumentos[0];
        if (Array.isArray(primero) && primero.length) candidatos.push(primero[0]);
        else if (primero && typeof primero === 'object') candidatos.push(primero);

        for (const fila of candidatos) {
            for (const clave of CLAVES_IDENTIDAD) {
                const valor = fila && (fila[clave] !== undefined ? fila[clave] : fila[clave.toUpperCase()]);
                if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
                    return String(valor).slice(0, 80);
                }
            }
        }
        return null;
    }

    /** Los campos tocados, sin arrastrar archivos ni textos enormes. */
    function camposTocados(argumentos) {
        const primero = argumentos && argumentos[0];
        const fila = Array.isArray(primero) ? primero[0] : primero;
        if (!fila || typeof fila !== 'object') return [];
        return Object.keys(fila).slice(0, 40);
    }

    function resumen(accion, tabla, filas) {
        const nombre = nombreDeTabla(tabla);
        const cuantas = filas && filas > 1 ? `${filas} registros` : 'un registro';
        if (accion === 'CREAR') return `Se agregó ${cuantas} en ${nombre}`;
        if (accion === 'ELIMINAR') return `Se eliminó ${cuantas} de ${nombre}`;
        if (accion === 'GUARDAR') return `Se guardó ${cuantas} en ${nombre}`;
        return `Se modificó ${cuantas} en ${nombre}`;
    }

    async function anotar(cliente, tabla, metodo, argumentos, resultado) {
        const accion = ACCIONES[metodo];
        if (!accion) return;

        const filas = contarFilas(argumentos, resultado);
        const detalles = {
            tabla,
            operacion: metodo,
            summary: resumen(accion, tabla, filas),
            registros: filas,
            campos: metodo === 'delete' ? [] : camposTocados(argumentos),
            origen: 'automatico',
        };

        let usuario = null;
        try {
            const { data } = await cliente.auth.getSession();
            usuario = data && data.session ? data.session.user : null;
        } catch (_) { /* sin sesión no se puede firmar el registro */ }
        if (!usuario) return;

        await cliente.from('change_history').insert({
            user_id: usuario.id,
            user_email: usuario.email || 'Usuario',
            action_type: accion,
            entity_type: nombreDeTabla(tabla),
            record_id: identificar(argumentos, resultado),
            details: detalles,
        });
    }

    /**
     * Envuelve un cliente de Supabase. Devuelve el mismo cliente: lo que se
     * cambia es su método from(), que a su vez envuelve las escrituras.
     */
    function instalar(cliente) {
        if (!cliente || typeof cliente.from !== 'function') return cliente;
        if (cliente.__auditoriaInstalada) return cliente;

        const fromOriginal = cliente.from.bind(cliente);

        cliente.from = function (tabla) {
            const consulta = fromOriginal(tabla);
            if (!seAudita(tabla)) return consulta;

            Object.keys(ACCIONES).forEach(metodo => {
                const original = consulta[metodo];
                if (typeof original !== 'function') return;

                consulta[metodo] = function (...argumentos) {
                    const constructor = original.apply(consulta, argumentos);
                    if (!constructor || typeof constructor.then !== 'function') return constructor;

                    // El constructor de PostgREST es perezoso: solo se ejecuta
                    // cuando alguien lo espera. Por eso se envuelve su then y no
                    // se le encadena uno nuevo, que dispararía la petición antes
                    // de que el módulo terminara de armarla.
                    const thenOriginal = constructor.then.bind(constructor);
                    constructor.then = function (alResolver, alFallar) {
                        return thenOriginal(function (resultado) {
                            if (!resultado || !resultado.error) {
                                Promise.resolve()
                                    .then(() => anotar(cliente, tabla, metodo, argumentos, resultado))
                                    .catch(err => console.warn('[Auditoría] no se pudo anotar el cambio:', err?.message || err));
                            }
                            return alResolver ? alResolver(resultado) : resultado;
                        }, alFallar);
                    };
                    return constructor;
                };
            });

            return consulta;
        };

        cliente.__auditoriaInstalada = true;
        return cliente;
    }

    const api = Object.freeze({
        instalar,
        seAudita,
        nombreDeTabla,
        resumen,
        identificar,
        contarFilas,
        ACCIONES,
        SIN_AUDITORIA,
        CON_REGISTRO_PROPIO,
        NOMBRES,
    });

    if (typeof module === 'object' && module.exports) module.exports = api;
    if (global) {
        global.AifaAuditoria = api;
        // El cliente puede existir ya (supabase-client.js corre antes) o crearse
        // más tarde con ensureSupabaseClient: se cubren los dos casos.
        if (global.supabaseClient) instalar(global.supabaseClient);
        if (global.supabase && typeof global.supabase.createClient === 'function' && !global.supabase.__auditoriaEnvuelta) {
            const crearOriginal = global.supabase.createClient.bind(global.supabase);
            global.supabase.createClient = function (...args) {
                return instalar(crearOriginal(...args));
            };
            global.supabase.__auditoriaEnvuelta = true;
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
