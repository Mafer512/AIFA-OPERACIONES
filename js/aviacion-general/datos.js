/* Capa de datos del módulo de Aviación General / FBO.
 *
 * Único punto del módulo que habla con Supabase. No toca el DOM ni sabe que
 * existe una pantalla: recibe parámetros, devuelve datos o lanza un Error con
 * un mensaje que se le puede enseñar a un operador.
 *
 * DOS FUENTES
 *
 *   · Resumen, Movimientos e Importación leen y escriben la fuente FBO
 *     (migraciones 064a/064b): la vista v_fbo_movimientos —operaciones_fbo
 *     desde 2026 más el histórico 2022-2025 de aviacion_general_operaciones,
 *     sólo lectura— y sus funciones fbo_*. Todo se suma en PostgreSQL: el
 *     navegador nunca descarga la tabla para calcular un KPI, porque PostgREST
 *     corta cada respuesta en 1000 filas y la cifra saldría truncada en
 *     silencio.
 *   · Validación, Auditoría y Captura (oculta) siguen en su fuente anterior,
 *     aviacion_general_operaciones (migración 046), sin cambios.
 *
 * Columnas de auditoría verificadas contra la base en vivo:
 *   id, registro_id, operacion, datos_anteriores, datos_nuevos,
 *   realizado_por, fecha_evento.
 */
(function (root) {
    'use strict';

    const TABLA     = 'aviacion_general_operaciones';
    const TABLA_AUD = 'aviacion_general_operaciones_auditoria';
    const TABLA_FBO = 'operaciones_fbo';

    // PostgREST devuelve como máximo 1000 filas por respuesta: las descargas
    // completas (exportar) se piden en páginas de este tamaño.
    const PAGINA_MAXIMA = 1000;
    // Cada bloque de importación es una transacción de fbo_importar_operaciones.
    const BLOQUE_IMPORTACION = 500;

    /**
     * @typedef {Object} FiltrosFbo
     * @property {string} [fecha_desde]      'YYYY-MM-DD'
     * @property {string} [fecha_hasta]      'YYYY-MM-DD'
     * @property {string} [tipo_movimiento]  '' | 'LLEGADA' | 'SALIDA'
     * @property {string} [ambito]           '' | 'NAC' | 'INT'
     * @property {string} [operador]
     * @property {string} [matricula]
     * @property {string} [tipo_aeronave]
     * @property {string} [aeropuerto]       Origen en llegadas, destino en salidas.
     * @property {string} [texto]            Búsqueda libre.
     */

    const CLAVES_FILTRO_FBO = [
        'fecha_desde', 'fecha_hasta', 'tipo_movimiento', 'ambito',
        'operador', 'matricula', 'tipo_aeronave', 'aeropuerto', 'texto'
    ];

    // Lo que pide la lista de la fuente anterior (Validación). Se enumeran las
    // columnas en vez de usar '*' para no arrastrar campos que nadie usa.
    const COLUMNAS_LISTA = [
        'id', 'folio_rotacion', 'fecha_operacion', 'tipo_operacion', 'ambito_operacion',
        'operador', 'matricula', 'tipo_aeronave',
        'aeropuerto_origen_destino', 'ciudad_origen_destino',
        'hora_programada', 'hora_real',
        'hora_aterrizaje', 'hora_entrada_posicion', 'hora_salida_posicion', 'hora_despegue',
        'adultos', 'infantes', 'pax_total_reportado', 'pax_ag', 'pax_od',
        'estado', 'pais', 'observaciones', 'movimiento_relacionado_id',
        'tipo_fuente', 'archivo_origen', 'fila_origen',
        'estado_validacion', 'fecha_validacion', 'observacion_validacion',
        'estatus_registro', 'motivo_anulacion', 'version',
        'fecha_creacion', 'fecha_modificacion'
    ].join(',');

    async function cliente() {
        const c = root.supabaseClient
            || (typeof root.ensureSupabaseClient === 'function' && await root.ensureSupabaseClient());
        if (!c) throw new Error('No se pudo inicializar el cliente de Supabase.');
        return c;
    }

    /** Qué migración falta, según el objeto que no se encontró. */
    function migracionDe(msg) {
        if (/fbo_(importar_operaciones|previa_importacion)/.test(msg)) return '064b_fbo_importar_operaciones.sql';
        if (/fbo_|v_fbo_movimientos/.test(msg)) return '064a_fbo_movimientos_vista_y_rpc.sql';
        return '046_aviacion_general_fbo.sql';
    }

    /**
     * Traduce los errores de Postgres a algo que un capturista pueda accionar.
     * Los códigos chk_* salen de los CHECK de la fuente anterior.
     */
    function traducirError(error, contexto) {
        if (!error) return null;
        const msg = String(error.message || error.details || '');
        const mapa = {
            chk_ag_tipo_operacion:    'El tipo de operación debe ser LLEGADA o SALIDA.',
            chk_ag_ambito_operacion:  'El ámbito debe ser NACIONAL o INTERNACIONAL.',
            chk_ag_estado_validacion: 'El estado de validación debe ser PENDIENTE, VALIDADO u OBSERVADO.',
            chk_ag_estatus_registro:  'El estatus del registro debe ser ACTIVO, ANULADO o ELIMINADO.',
            chk_ag_tipo_fuente:       'El origen del dato no es válido.',
            chk_ag_adultos:           'Los pasajeros no pueden ser un número negativo.'
        };
        const clave = Object.keys(mapa).find((k) => msg.includes(k));
        if (clave) return new Error(mapa[clave]);

        if (msg.includes('generated column') || msg.includes('non-DEFAULT value into column "pax_ag"')) {
            return new Error('PAX A.G. lo calcula la base automáticamente: no se puede capturar a mano.');
        }
        if (/violates not-null constraint/.test(msg)) {
            const campo = (msg.match(/column "([^"]+)"/) || [])[1] || 'un campo obligatorio';
            return new Error(`Falta ${campo.replace(/_/g, ' ')}.`);
        }
        if (error.code === '42501' || /permission denied/i.test(msg)) {
            return new Error('No tienes permiso para realizar esta operación.');
        }
        if (error.code === 'PGRST202' || error.code === '42P01' || error.code === '42883'
            || /Could not find the function|does not exist/i.test(msg)) {
            return new Error(`El módulo no está instalado completo en la base: falta aplicar la migración ${migracionDe(msg)}.`);
        }
        return new Error(`${contexto}: ${msg || 'error desconocido'}`);
    }

    /**
     * Filtros tal como los espera fbo_movimientos_filtrados: sólo las claves
     * conocidas y sin vacíos (una clave ausente no filtra).
     * @param {FiltrosFbo} filtros
     */
    function filtrosRpc(filtros) {
        const f = filtros || {};
        /** @type {Object<string, string>} */
        const salida = {};
        CLAVES_FILTRO_FBO.forEach((k) => {
            const v = f[k] === null || f[k] === undefined ? '' : String(f[k]).trim();
            if (v) salida[k] = v;
        });
        return salida;
    }

    /** Aplica los filtros de la fuente anterior sobre una consulta de PostgREST. */
    function aplicarFiltros(consulta, filtros) {
        const f = filtros || {};
        const estatus = f.estatus_registro || 'ACTIVO';

        if (estatus !== 'TODOS') consulta = consulta.eq('estatus_registro', estatus);
        if (f.fecha_desde)       consulta = consulta.gte('fecha_operacion', f.fecha_desde);
        if (f.fecha_hasta)       consulta = consulta.lte('fecha_operacion', f.fecha_hasta);
        if (f.tipo_operacion)    consulta = consulta.eq('tipo_operacion', f.tipo_operacion);
        if (f.ambito_operacion)  consulta = consulta.eq('ambito_operacion', f.ambito_operacion);
        if (f.estado_validacion) consulta = consulta.eq('estado_validacion', f.estado_validacion);

        if (f.operador)      consulta = consulta.ilike('operador', `%${f.operador}%`);
        if (f.matricula)     consulta = consulta.ilike('matricula', `%${f.matricula}%`);
        if (f.tipo_aeronave) consulta = consulta.ilike('tipo_aeronave', `%${f.tipo_aeronave}%`);

        // Hasta 2024 el origen se anotó como ciudad y desde 2025 como código.
        if (f.aeropuerto) {
            const a = String(f.aeropuerto).replace(/[(),]/g, ' ').trim();
            if (a) {
                consulta = consulta.or(
                    `aeropuerto_origen_destino.ilike.%${a}%,ciudad_origen_destino.ilike.%${a}%`
                );
            }
        }

        if (f.texto) {
            const t = String(f.texto).replace(/[(),]/g, ' ').trim();
            if (t) {
                consulta = consulta.or(
                    ['operador', 'matricula', 'tipo_aeronave',
                     'aeropuerto_origen_destino', 'ciudad_origen_destino', 'observaciones']
                        .map((c) => `${c}.ilike.%${t}%`).join(',')
                );
            }
        }
        return consulta;
    }

    /** Parte un arreglo en trozos de `tam`. */
    function enBloques(lista, tam) {
        const bloques = [];
        for (let i = 0; i < lista.length; i += tam) bloques.push(lista.slice(i, i + tam));
        return bloques;
    }

    const api = {
        TABLA,
        TABLA_AUD,
        TABLA_FBO,
        PAGINA_MAXIMA,
        BLOQUE_IMPORTACION,
        filtrosRpc,

        // ── Fuente FBO (064a/064b) ──────────────────────────────────────────

        /**
         * KPIs y tops del periodo, ya sumados por PostgreSQL (fbo_resumen).
         * @param {FiltrosFbo} filtros
         */
        async resumen(filtros) {
            const c = await cliente();
            const { data, error } = await c.rpc('fbo_resumen', { p_filtros: filtrosRpc(filtros) });
            if (error) throw traducirError(error, 'No se pudo calcular el resumen');
            return data || {};
        },

        /**
         * Llegadas, salidas y pasajeros por mes (fbo_movimientos_por_mes).
         * Una fila por mes: nunca se acerca al tope de 1000 filas.
         * @param {FiltrosFbo} filtros
         */
        async porMes(filtros) {
            const c = await cliente();
            const { data, error } = await c.rpc('fbo_movimientos_por_mes', { p_filtros: filtrosRpc(filtros) });
            if (error) throw traducirError(error, 'No se pudo calcular la serie mensual');
            return data || [];
        },

        /**
         * Una página de movimientos y el total exacto. Filtra, ordena y pagina
         * PostgreSQL (fbo_movimientos_filtrados + range), así la pantalla no
         * crece en costo aunque la tabla sí.
         */
        async movimientos({ filtros = {}, pagina = 1, porPagina = 50, orden = 'fecha', ascendente = false } = {}) {
            const c = await cliente();
            const desde = (Math.max(1, pagina) - 1) * porPagina;
            const consulta = c.rpc('fbo_movimientos_filtrados', { p_filtros: filtrosRpc(filtros) }, { count: 'exact' })
                .order(orden, { ascending: ascendente, nullsFirst: false })
                // Desempates estables: sin ellos, dos movimientos iguales en el
                // criterio pueden cambiar de página y verse repetidos o perderse.
                .order('hora', { ascending: ascendente, nullsFirst: false })
                .order('movimiento_id', { ascending: ascendente })
                .range(desde, desde + porPagina - 1);
            const { data, error, count } = await consulta;
            if (error) throw traducirError(error, 'No se pudieron consultar los movimientos');
            return { filas: data || [], total: count || 0, pagina, porPagina };
        },

        /**
         * Todos los movimientos filtrados, para exportar. Por páginas de 1000
         * porque PostgREST corta las respuestas, y una exportación truncada en
         * silencio es peor que no exportar.
         */
        async movimientosTodos({ filtros = {}, limite = 50000 } = {}) {
            const filas = [];
            let total = 0;
            for (let pagina = 1; filas.length < limite; pagina++) {
                const r = await api.movimientos({ filtros, pagina, porPagina: PAGINA_MAXIMA, orden: 'fecha', ascendente: true });
                total = r.total;
                filas.push(...r.filas);
                if (filas.length >= r.total || r.filas.length < PAGINA_MAXIMA) break;
            }
            return { filas: filas.slice(0, limite), total };
        },

        /** Valores presentes, para los desplegables de los filtros. */
        async opciones() {
            const c = await cliente();
            const { data, error } = await c.rpc('fbo_opciones', {});
            if (error) throw traducirError(error, 'No se pudieron cargar los catálogos');
            return data || {};
        },

        /**
         * Para la vista previa: qué registros ya existen y qué operaciones
         * guardadas con otro registro coinciden por matrícula + fecha de
         * aterrizaje. En bloques de 500 para no mandar un cuerpo enorme.
         * @param {{registro: string, matricula: string|null, fecha_aterrizaje: string|null}[]} filas
         */
        async previaImportacion(filas) {
            const c = await cliente();
            const salida = { existentes: [], coincidencias: [] };
            for (const bloque of enBloques(filas || [], BLOQUE_IMPORTACION)) {
                const { data, error } = await c.rpc('fbo_previa_importacion', { p_filas: bloque });
                if (error) throw traducirError(error, 'No se pudo preparar la vista previa');
                salida.existentes.push(...((data && data.existentes) || []));
                salida.coincidencias.push(...((data && data.coincidencias) || []));
            }
            return salida;
        },

        /**
         * Importa en bloques de 500. Cada bloque es UNA transacción en la base
         * (fbo_importar_operaciones): o entra completo o no entra nada de él.
         * Si un bloque falla se detiene; el Error lleva `parcial` con lo que
         * ya quedó guardado en los bloques anteriores.
         */
        async importarOperaciones({ filas, tamanoBloque = BLOQUE_IMPORTACION, onProgreso = null }) {
            const c = await cliente();
            const bloques = enBloques(filas || [], tamanoBloque);
            const total = {
                recibidas: 0, insertados: 0, reemplazados: 0,
                reemplazados_por_coincidencia: 0, bloques: bloques.length, bloquesGuardados: 0
            };

            for (let i = 0; i < bloques.length; i++) {
                const { data, error } = await c.rpc('fbo_importar_operaciones', { p_filas: bloques[i] });
                if (error) {
                    const e = traducirError(error, `No se pudo importar el bloque ${i + 1} de ${bloques.length}`);
                    e.parcial = Object.assign({}, total);
                    throw e;
                }
                const r = data || {};
                total.recibidas += Number(r.recibidas) || 0;
                total.insertados += Number(r.insertados) || 0;
                total.reemplazados += Number(r.reemplazados) || 0;
                total.reemplazados_por_coincidencia += Number(r.reemplazados_por_coincidencia) || 0;
                total.bloquesGuardados = i + 1;
                if (typeof onProgreso === 'function') {
                    onProgreso({ bloque: i + 1, bloques: bloques.length, acumulado: Math.min((i + 1) * tamanoBloque, filas.length) });
                }
            }
            return total;
        },

        /**
         * ¿Están aplicadas 064a y 064b? Se pregunta una vez al arrancar para
         * poder decir qué archivo falta correr en lugar de dejar la pantalla en
         * blanco. Se usan las funciones más baratas de cada migración.
         */
        async diagnostico() {
            const salida = { tabla: false, funciones: false, importacion: false, mensaje: '' };
            try {
                const c = await cliente();
                const { error: e1 } = await c.from(TABLA_FBO).select('id').limit(1);
                salida.tabla = !e1;
                if (e1) { salida.mensaje = traducirError(e1, 'Tabla').message; return salida; }

                const { error: e2 } = await c.rpc('fbo_patron', { p: 'x' });
                salida.funciones = !e2;
                if (e2) { salida.mensaje = traducirError(e2, 'Funciones').message; return salida; }

                const { error: e3 } = await c.rpc('fbo_previa_importacion', { p_filas: [] });
                salida.importacion = !e3;
                if (e3) salida.mensaje = traducirError(e3, 'Importación').message;
            } catch (err) {
                salida.mensaje = err.message || String(err);
            }
            return salida;
        },

        // ── Fuente anterior: aviacion_general_operaciones (Validación,
        //    Auditoría y Captura) ─────────────────────────────────────────────

        /** Página de la fuente anterior + total exacto. */
        async listar({ filtros = {}, pagina = 1, porPagina = 50, orden = 'fecha_operacion', ascendente = false } = {}) {
            const c = await cliente();
            const desde = (Math.max(1, pagina) - 1) * porPagina;

            let consulta = c.from(TABLA).select(COLUMNAS_LISTA, { count: 'exact' });
            consulta = aplicarFiltros(consulta, filtros);
            consulta = consulta
                .order(orden, { ascending: ascendente, nullsFirst: false })
                .order('id', { ascending: ascendente })
                .range(desde, desde + porPagina - 1);

            const { data, error, count } = await consulta;
            if (error) throw traducirError(error, 'No se pudo consultar el histórico');
            return { filas: data || [], total: count || 0, pagina, porPagina };
        },

        async obtener(id) {
            const c = await cliente();
            const { data, error } = await c.from(TABLA).select('*').eq('id', id).maybeSingle();
            if (error) throw traducirError(error, 'No se pudo leer el movimiento');
            return data;
        },

        async crear(payload) {
            const c = await cliente();
            const { data, error } = await c.from(TABLA)
                .insert([Object.assign({ tipo_fuente: 'CAPTURA_MANUAL' }, payload)])
                .select(COLUMNAS_LISTA)
                .single();
            if (error) throw traducirError(error, 'No se pudo guardar el movimiento');
            return data;
        },

        /** El trigger de la tabla lleva la versión y la auditoría. */
        async actualizar(id, payload) {
            const c = await cliente();
            const { data, error } = await c.from(TABLA)
                .update(Object.assign({}, payload, { fecha_modificacion: new Date().toISOString() }))
                .eq('id', id)
                .select(COLUMNAS_LISTA)
                .single();
            if (error) throw traducirError(error, 'No se pudo actualizar el movimiento');
            return data;
        },

        /** Cambia el estado de validación de uno o varios movimientos. */
        async validar(ids, estado, comentario) {
            const c = await cliente();
            const { data, error } = await c.rpc('aviacion_general_validar', {
                p_ids: ids, p_estado: estado, p_comentario: comentario || null
            });
            if (error) throw traducirError(error, 'No se pudo actualizar la validación');
            return Number(data) || 0;
        },

        /** Movimientos capturados dos veces (misma llave natural). Sólo señala. */
        async duplicados(filtros, limite) {
            const c = await cliente();
            const { data, error } = await c.rpc('aviacion_general_duplicados', {
                p_filtros: filtros || {}, p_limite: limite || 200
            });
            if (error) throw traducirError(error, 'No se pudieron buscar los duplicados');
            return data || [];
        },

        /** Enlaza llegada con salida por folio de rotación y matrícula. */
        async enlazarRotaciones(fechaDesde, fechaHasta, diasVentana) {
            const c = await cliente();
            const { data, error } = await c.rpc('aviacion_general_enlazar_rotaciones', {
                p_fecha_desde: fechaDesde || null,
                p_fecha_hasta: fechaHasta || null,
                p_dias_ventana: diasVentana || 3
            });
            if (error) throw traducirError(error, 'No se pudieron enlazar las rotaciones');
            return data || {};
        },

        /** Historial de cambios de un movimiento, del más reciente al más viejo. */
        async auditoriaDe(registroId, limite = 100) {
            const c = await cliente();
            const { data, error } = await c.from(TABLA_AUD)
                .select('id,registro_id,operacion,datos_anteriores,datos_nuevos,realizado_por,fecha_evento')
                .eq('registro_id', registroId)
                .order('fecha_evento', { ascending: false })
                .limit(limite);
            if (error) throw traducirError(error, 'No se pudo leer el historial de cambios');
            return data || [];
        },

        /** Últimos movimientos de auditoría del módulo completo. */
        async auditoriaReciente(limite = 200) {
            const c = await cliente();
            const { data, error } = await c.from(TABLA_AUD)
                .select('id,registro_id,operacion,datos_anteriores,datos_nuevos,realizado_por,fecha_evento')
                .order('fecha_evento', { ascending: false })
                .limit(limite);
            if (error) throw traducirError(error, 'No se pudo leer la auditoría');
            return data || [];
        }
    };

    root.AviacionGeneralDatos = api;
})(typeof window !== 'undefined' ? window : globalThis);
