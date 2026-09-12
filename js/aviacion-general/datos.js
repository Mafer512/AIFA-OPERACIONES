/* Capa de datos del módulo de Aviación General / FBO.
 *
 * Único punto del módulo que habla con Supabase. No toca el DOM ni sabe que
 * existe una pantalla: recibe parámetros, devuelve datos o lanza un Error con
 * un mensaje que se le puede enseñar a un operador.
 *
 * POR QUÉ UNA CAPA APARTE
 *
 *   Para que el día que cambie el backend —o se encienda RLS, o se mueva una
 *   consulta a una función de PostgreSQL— haya UN archivo que tocar y no cinco
 *   pantallas. Las vistas de arriba no saben si algo viene de PostgREST o de un
 *   RPC, y no deben saberlo.
 *
 * REPARTO DE TRABAJO CON LA BASE
 *
 *   · El listado paginado va por PostgREST (select + range + count exacto):
 *     es su terreno y aprovecha los índices de la migración 046.
 *   · Todo lo demás —resumen, catálogos, importación, validación, baja,
 *     enlace de rotaciones— va por RPC, porque son reglas de negocio y viven
 *     en la base, no aquí.
 *
 * Columnas de auditoría verificadas contra la base en vivo:
 *   id, registro_id, operacion, datos_anteriores, datos_nuevos,
 *   realizado_por, fecha_evento.
 */
(function (root) {
    'use strict';

    const TABLA     = 'aviacion_general_operaciones';
    const TABLA_AUD = 'aviacion_general_operaciones_auditoria';

    // Lo que pide el listado. Se enumeran las columnas en vez de usar '*' para
    // no arrastrar por la red campos que la tabla pueda ganar después y que
    // ninguna pantalla use.
    const COLUMNAS_LISTA = [
        'id', 'folio_rotacion', 'fecha_operacion', 'tipo_operacion', 'ambito_operacion',
        'operador', 'matricula', 'tipo_aeronave',
        // Las dos del origen/destino: el histórico usa una u otra según el año.
        'aeropuerto_origen_destino', 'ciudad_origen_destino',
        'hora_programada', 'hora_real',
        // El paso por plataforma, que antes no se pedía y por tanto no se veía.
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

    /**
     * Traduce los errores de Postgres a algo que un capturista pueda accionar.
     *
     * Un "violates check constraint chk_ag_tipo_operacion" en pantalla no le
     * dice nada a nadie; "El tipo de operación debe ser LLEGADA o SALIDA" sí.
     * Los códigos salen de los CHECK verificados contra la base.
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
        if (error.code === 'PGRST202' || /Could not find the function/i.test(msg)) {
            return new Error('El módulo no está instalado completo en la base: falta aplicar la migración 046_aviacion_general_fbo.sql.');
        }
        return new Error(`${contexto}: ${msg || 'error desconocido'}`);
    }

    /** Aplica el objeto de filtros del núcleo sobre una consulta de PostgREST. */
    function aplicarFiltros(consulta, filtros) {
        const f = filtros || {};
        const estatus = f.estatus_registro || 'ACTIVO';

        if (estatus !== 'TODOS') consulta = consulta.eq('estatus_registro', estatus);
        if (f.fecha_desde)       consulta = consulta.gte('fecha_operacion', f.fecha_desde);
        if (f.fecha_hasta)       consulta = consulta.lte('fecha_operacion', f.fecha_hasta);
        if (f.tipo_operacion)    consulta = consulta.eq('tipo_operacion', f.tipo_operacion);
        if (f.ambito_operacion)  consulta = consulta.eq('ambito_operacion', f.ambito_operacion);
        if (f.estado_validacion) consulta = consulta.eq('estado_validacion', f.estado_validacion);

        // ilike con comodines: coincidencia parcial sin distinguir mayúsculas,
        // que es como la gente busca ("gulf" debe encontrar "GULFSTREAM").
        if (f.operador)      consulta = consulta.ilike('operador', `%${f.operador}%`);
        if (f.matricula)     consulta = consulta.ilike('matricula', `%${f.matricula}%`);
        if (f.tipo_aeronave) consulta = consulta.ilike('tipo_aeronave', `%${f.tipo_aeronave}%`);

        // Buscar "MMTO" o "TOLUCA" tiene que encontrar lo mismo: hasta 2024 el
        // origen se anotó como ciudad y desde 2025 como código, y quien busca no
        // tiene por qué saber en qué año cambió la convención.
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

    const api = {
        TABLA,
        TABLA_AUD,

        /**
         * Página de movimientos + total exacto.
         *
         * El total viene con count:'exact' porque el paginador necesita saber
         * cuántas páginas hay; sobre miles de filas con los índices de la 046
         * el costo es despreciable, y sin él no se puede decir "1–50 de 1,892".
         */
        async listar({ filtros = {}, pagina = 1, porPagina = 50, orden = 'fecha_operacion', ascendente = false } = {}) {
            const c = await cliente();
            const desde = (Math.max(1, pagina) - 1) * porPagina;

            let consulta = c.from(TABLA).select(COLUMNAS_LISTA, { count: 'exact' });
            consulta = aplicarFiltros(consulta, filtros);
            consulta = consulta
                .order(orden, { ascending: ascendente, nullsFirst: false })
                // Desempate estable: sin esto, dos movimientos del mismo día
                // pueden intercambiarse entre páginas y aparecer repetidos o
                // desaparecer al paginar.
                .order('id', { ascending: ascendente })
                .range(desde, desde + porPagina - 1);

            const { data, error, count } = await consulta;
            if (error) throw traducirError(error, 'No se pudo consultar el histórico');
            return { filas: data || [], total: count || 0, pagina, porPagina };
        },

        /**
         * Todas las filas que cumplen el filtro, para exportar.
         * Se pide por páginas de 1000 porque PostgREST corta las respuestas y
         * una exportación silenciosamente truncada es peor que no exportar.
         */
        async listarTodo({ filtros = {}, limite = 20000 } = {}) {
            const filas = [];
            const tam = 1000;
            for (let pagina = 1; filas.length < limite; pagina++) {
                const r = await api.listar({ filtros, pagina, porPagina: tam });
                filas.push(...r.filas);
                if (filas.length >= r.total || r.filas.length < tam) break;
            }
            return filas;
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

        /**
         * Actualiza y deja constancia de quién lo hizo.
         *
         * El trigger de la tabla se encarga de la versión y de escribir la
         * auditoría; aquí sólo se sella fecha_modificacion para que no dependa
         * de que el trigger exista.
         */
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

        /** Baja lógica. Nada se borra: cambia el estatus y queda el motivo. */
        async baja(id, motivo, modo) {
            const c = await cliente();
            const { data, error } = await c.rpc('aviacion_general_baja', {
                p_id: id, p_motivo: motivo, p_modo: modo || 'ANULADO'
            });
            if (error) throw traducirError(error, 'No se pudo dar de baja el movimiento');
            return data === true;
        },

        /** Reactiva un movimiento anulado. */
        async reactivar(id) {
            const c = await cliente();
            const { data, error } = await c.from(TABLA)
                .update({
                    estatus_registro: 'ACTIVO',
                    motivo_anulacion: null,
                    eliminado_por: null,
                    fecha_eliminacion: null,
                    fecha_modificacion: new Date().toISOString()
                })
                .eq('id', id)
                .select(COLUMNAS_LISTA)
                .single();
            if (error) throw traducirError(error, 'No se pudo reactivar el movimiento');
            return data;
        },

        /**
         * Todas las cifras del tablero, ya sumadas por PostgreSQL.
         *
         * modo 'rotacion' (por omisión) es el conteo OFICIAL: el del reporte de
         * GAG, que ancla cada salida a la fecha de su llegada. 'movimiento'
         * cuenta cada operación en la fecha en que ocurrió.
         */
        async resumen(filtros, modo) {
            const c = await cliente();
            const { data, error } = await c.rpc('aviacion_general_resumen', {
                p_filtros: filtros || {},
                p_modo: modo || 'rotacion'
            });
            if (error) throw traducirError(error, 'No se pudo calcular el resumen');
            return data || {};
        },

        /** Valores presentes en la tabla, para poblar los desplegables. */
        async opciones() {
            const c = await cliente();
            const { data, error } = await c.rpc('aviacion_general_opciones', {});
            if (error) throw traducirError(error, 'No se pudieron cargar los catálogos');
            return data || {};
        },

        /**
         * Importación por lotes.
         *
         * Se parte en tandas porque un solo jsonb con miles de filas es una
         * petición enorme que puede toparse con el límite del gateway, y porque
         * un error a la mitad de 2,000 filas no dice nada útil mientras que uno
         * en la tanda 3 de 8 acota el problema. Cada tanda es transaccional por
         * sí sola.
         *
         * onProgreso recibe {tanda, tandas, acumulado} para que la pantalla
         * pueda mover una barra sin que esta capa sepa qué es una barra.
         */
        async importar({ filas, archivo, hoja, simulacion = false, tamanoTanda = 250, onProgreso = null }) {
            const c = await cliente();
            const total = {
                simulacion, recibidas: 0, insertadas: 0, duplicadas: 0, rechazadas: 0,
                detalle_duplicadas: [], detalle_rechazadas: []
            };
            const tandas = Math.max(1, Math.ceil(filas.length / tamanoTanda));

            for (let i = 0; i < tandas; i++) {
                const trozo = filas.slice(i * tamanoTanda, (i + 1) * tamanoTanda);
                const { data, error } = await c.rpc('aviacion_general_importar', {
                    p_filas: trozo,
                    p_archivo: archivo || null,
                    p_hoja: hoja || null,
                    p_simulacion: simulacion
                });
                if (error) throw traducirError(error, `No se pudo importar la tanda ${i + 1} de ${tandas}`);

                const r = data || {};
                total.recibidas  += Number(r.recibidas)  || 0;
                total.insertadas += Number(r.insertadas) || 0;
                total.duplicadas += Number(r.duplicadas) || 0;
                total.rechazadas += Number(r.rechazadas) || 0;

                // Los índices que devuelve la base son relativos a su tanda:
                // se corrigen aquí para que el reporte señale la fila real.
                const corrimiento = i * tamanoTanda;
                (r.detalle_duplicadas || []).forEach((d) => {
                    total.detalle_duplicadas.push(Object.assign({}, d, { indice: (d.indice || 0) + corrimiento }));
                });
                (r.detalle_rechazadas || []).forEach((d) => {
                    total.detalle_rechazadas.push(Object.assign({}, d, { indice: (d.indice || 0) + corrimiento }));
                });

                if (typeof onProgreso === 'function') {
                    onProgreso({ tanda: i + 1, tandas, acumulado: Math.min((i + 1) * tamanoTanda, filas.length) });
                }
            }
            return total;
        },

        /**
         * Movimientos capturados dos veces.
         *
         * Misma llave natural con la que la importación decide si algo ya
         * existe, así que lo que aparece aquí es exactamente lo que una
         * reimportación rechazaría. No modifica nada: señala.
         */
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
        },

        /**
         * ¿Está el módulo instalado en la base?
         *
         * Se pregunta una vez al arrancar para poder decir "falta correr la
         * migración 046" en lugar de dejar la pantalla en blanco con un error
         * de consola que nadie va a leer.
         */
        async diagnostico() {
            const salida = { tabla: false, funciones: false, mensaje: '' };
            try {
                const c = await cliente();
                const { error: e1 } = await c.from(TABLA).select('id').limit(1);
                salida.tabla = !e1;
                if (e1) { salida.mensaje = traducirError(e1, 'Tabla').message; return salida; }

                const { error: e2 } = await c.rpc('aviacion_general_resumen', { p_filtros: {} });
                salida.funciones = !e2;
                if (e2) salida.mensaje = traducirError(e2, 'Funciones').message;
            } catch (err) {
                salida.mensaje = err.message || String(err);
            }
            return salida;
        }
    };

    root.AviacionGeneralDatos = api;
})(typeof window !== 'undefined' ? window : globalThis);
