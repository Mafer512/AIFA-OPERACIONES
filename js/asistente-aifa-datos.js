/* =============================================================================
   AIFA OPERACIONES · Asistente — Capa de datos y herramientas (tool calling)
   js/asistente-aifa-datos.js

   POR QUÉ ESTE ARCHIVO EXISTE
   ---------------------------
   El asistente anterior metía filas de datos dentro del prompt y le pedía al
   modelo que dedujera la respuesta. Eso falla justo en las preguntas que más
   se hacen aquí ("¿cuántas rutas internacionales hay?"): un modelo de lenguaje
   no cuenta filas de forma confiable, y si el dato no cabía en el prompt,
   simplemente lo inventaba.

   Aquí se usa el enfoque estándar hoy: TOOL CALLING. Se le declaran al modelo
   funciones con su firma; el modelo decide cuál llamar y con qué argumentos;
   ESTE código ejecuta la consulta real contra Supabase y le devuelve el
   resultado exacto. El modelo sólo redacta. Los números nunca los inventa.

   IMPORTANTE — las consultas corren en el navegador a propósito: usan el
   cliente de Supabase del usuario que ya inició sesión, así que las políticas
   de seguridad por fila (RLS) aplican solas y nadie ve datos que no le tocan.
   ============================================================================= */

(function () {
    'use strict';

    /* ── Acceso a Supabase (mismo cliente que ya usa la app) ─────────────── */
    function _sb() {
        return window.supabaseClient || window.dataManager?.client || null;
    }

    const TABLAS_FREQ = {
        nacional:      'weekly_frequencies',
        internacional: 'weekly_frequencies_int',
        carga:         'weekly_frequencies_cargo',
    };

    const DIAS_SEMANA = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const DIAS_ES = {
        monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles',
        thursday: 'jueves', friday: 'viernes', saturday: 'sábado', sunday: 'domingo',
    };

    /* Caché por sesión: las frecuencias cambian por semana, no por minuto. */
    /* Leyenda que debe acompañar toda información de programación de vuelos.
       Va literal: es la misma que aparece en el módulo de Frecuencias. */
    const NOTA_PROGRAMACION =
        'Nota: Esta programación esta sujeta a cambios con base en las necesidades de las aerolíneas.';

    /* Enlace directo al detalle de un destino. Se arma absoluto a propósito:
       la gente copia la respuesta de AIFONSO y la reenvía por WhatsApp, así
       que el vínculo tiene que seguir funcionando fuera de la plataforma. */
    function _enlaceDestino(iata) {
        if (!iata) return null;
        try {
            const u = new URL(location.href);
            u.search = `?dest=${encodeURIComponent(String(iata).toUpperCase())}`;
            u.hash = '#frecuencias-semana';
            return u.toString();
        } catch (_) {
            return null;
        }
    }

    const _cache = new Map();
    function _cacheado(clave, fn) {
        if (_cache.has(clave)) return _cache.get(clave);
        const p = fn();
        _cache.set(clave, p);
        // Si la promesa falla no se guarda el error para siempre.
        p.catch(() => _cache.delete(clave));
        return p;
    }
    function _limpiarCache() { _cache.clear(); }

    function _normalizar(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /* ── Filas de la semana vigente ──────────────────────────────────────
       IMPORTANTE: se leen a través de window.dataManager, NO consultando las
       tablas directamente. Ahí viven reglas de negocio que no están en la
       base de datos y que, de saltarse, harían que el asistente contradijera
       a la propia aplicación. Por ejemplo: ZLO (Manzanillo) está guardado en
       la tabla internacional por un error de carga antiguo, pero es un
       destino NACIONAL; el gestor lo reasigna, y TRC (Torreón) se excluye de
       internacionales por lo mismo.

       Regla: si el módulo "Destinos y Frecuencias" muestra 40, el asistente
       debe decir 40. La fuente de verdad es la misma para los dos.          */
    function _gestor() {
        return window.dataManager || null;
    }

    async function _filasSemana(tipo) {
        return _cacheado(`filas:${tipo}`, async () => {
            const dm = _gestor();
            if (!dm) throw new Error('El gestor de datos de la plataforma aún no está listo.');

            const metodo = tipo === 'nacional'      ? 'getWeeklyFrequencies'
                         : tipo === 'internacional' ? 'getWeeklyFrequenciesInt'
                         :                            'getWeeklyFrequenciesCargo';
            if (typeof dm[metodo] !== 'function') {
                throw new Error(`El gestor de datos no expone ${metodo}.`);
            }

            const todas = (await dm[metodo]()) || [];
            if (!todas.length) return { semana: null, filas: [] };

            // Se agrupa por week_label y se elige la semana con valid_from más
            // reciente: es exactamente el criterio del módulo de Destinos y
            // Frecuencias (ver transformDBData en js/frecuencias_auto.js).
            const grupos = new Map();
            todas.forEach(fila => {
                const clave = fila.week_label;
                if (!grupos.has(clave)) grupos.set(clave, { validFrom: fila.valid_from, filas: [] });
                grupos.get(clave).filas.push(fila);
            });
            const elegida = [...grupos.values()]
                .sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')))[0];

            return { semana: elegida.validFrom, filas: elegida.filas };
        });
    }

    /* ── Nombre presentable de un destino ────────────────────────────────
       Algunas filas traen el código IATA en el campo de ciudad (por ejemplo
       CTG, cargado sin nombre). En esos casos se intenta resolver con el
       catálogo de aeropuertos y, si tampoco está ahí, se muestra el código
       una sola vez en lugar del redundante "CTG (CTG)".                    */
    async function _catalogoCiudades() {
        return _cacheado('catalogo:aeropuertos', async () => {
            const sb = _sb();
            if (!sb) return new Map();
            const { data } = await sb.from('aeropuertos').select('iata, ciudad, nombre');
            const mapa = new Map();
            (data || []).forEach(a => {
                const nombre = (a.ciudad || a.nombre || '').trim();
                if (a.iata && nombre) mapa.set(String(a.iata).toUpperCase(), nombre);
            });
            return mapa;
        });
    }

    /* Nombres correctos de los destinos.

       Las tablas de frecuencias guardan varias ciudades sin acentos ("Merida",
       "Torreon", "Bogota") y el catálogo de aeropuertos tampoco es confiable:
       en unos casos le faltan y en otros los tiene mal (trae "Ciudad Juarez"
       cuando las frecuencias sí traen "Ciudad Juárez"). Como esos catálogos se
       vuelven a cargar cada semana, corregirlos una vez no evitaría que el
       problema regrese; por eso la corrección vive aquí, indexada por código
       IATA, que sí es estable.

       Sólo se listan los que hay que corregir. Los que ya vienen bien
       ("Cancún", "Culiacán", "Bajío") no aparecen. */
    const NOMBRES_CORREGIDOS = {
        // Nacionales
        MID: 'Mérida',
        MZT: 'Mazatlán',
        SJD: 'San José del Cabo',
        SLP: 'San Luis Potosí',
        TGZ: 'Tuxtla Gutiérrez',
        TRC: 'Torreón',
        ZIH: 'Ixtapa-Zihuatanejo',
        // Internacionales y de carga
        BOG: 'Bogotá',
        CTG: 'Cartagena',
        MDE: 'Medellín',
        SJO: 'San José',
        LAX: 'Los Ángeles',
        CDG: 'París',
        PVG: 'Shanghái',
        PTY: 'Ciudad de Panamá',
        GUA: 'Ciudad de Guatemala',
    };

    /* Sólo el nombre de la ciudad. Los códigos IATA no se incluyen: al
       enumerar destinos no le dicen nada a quien lee, y leídos en voz alta
       ("ge de ele") entorpecen la frase. Si algún destino no tiene ciudad
       capturada ni en las frecuencias ni en el catálogo, se devuelve el
       código como último recurso (la advertencia de no adivinarlo va en la
       nota para el asistente, nunca en la etiqueta). */
    function _etiquetaDestino(iata, ciudad, catalogo) {
        const code = String(iata || '').trim().toUpperCase();
        if (NOMBRES_CORREGIDOS[code]) return NOMBRES_CORREGIDOS[code];
        const propio = String(ciudad || '').trim();
        if (propio && propio.toUpperCase() !== code) return propio;
        return catalogo.get(code) || code;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       HERRAMIENTAS — cada una devuelve un objeto que el modelo recibe como
       resultado verificado. Nunca devuelven texto ya redactado: el modelo
       redacta a partir de estos datos.
       ═══════════════════════════════════════════════════════════════════════ */

    const HERRAMIENTAS = {};

    /* ── 1. Conteo de rutas/destinos ─────────────────────────────────────
       En AIFA "ruta" y "destino" significan lo mismo: una ciudad servida.
       Se devuelven las mismas cifras que muestra el módulo "Destinos y
       Frecuencias" para que ambos nunca se contradigan.                    */
    HERRAMIENTAS.contar_rutas = async ({ tipo = 'todos' }) => {
        const tipos = tipo === 'todos' ? ['nacional', 'internacional', 'carga'] : [tipo];
        const resultado = { desglose: {} };
        let semanaRef = null;

        const catalogo = await _catalogoCiudades();

        for (const t of tipos) {
            const { semana, filas } = await _filasSemana(t);
            semanaRef = semana || semanaRef;

            // Se agrupa por destino para poder listar ciudad + código, no sólo contar.
            const porIata = new Map();
            filas.forEach(r => {
                if (!r.iata) return;
                if (!porIata.has(r.iata)) porIata.set(r.iata, { ciudad: r.city, vuelos: 0 });
                porIata.get(r.iata).vuelos += Number(r.weekly_total) || 0;
            });
            const ordenados = [...porIata.entries()].sort((a, b) => b[1].vuelos - a[1].vuelos);

            const aerolineas = new Set(filas.map(r => r.airline).filter(Boolean));
            const frecuencias = filas.reduce((s, r) => s + (Number(r.weekly_total) || 0), 0);

            resultado.desglose[t] = {
                // "rutas" y "destinos" son el mismo número, a propósito.
                rutas: porIata.size,
                destinos: porIata.size,
                aerolineas: aerolineas.size,
                frecuencias_programadas_semana: _cifra(frecuencias),
                // La lista viaja junto al conteo para poder responder completo
                // de una sola vez, sin obligar a preguntar "¿y cuáles son?".
                lista: ordenados.map(([iata, d]) => _etiquetaDestino(iata, d.ciudad, catalogo)),
            };
        }

        if (tipos.length > 1) {
            const todos = new Set();
            for (const t of tipos) {
                const { filas } = await _filasSemana(t);
                filas.forEach(r => { if (r.iata) todos.add(r.iata); });
            }
            resultado.total_destinos_sin_repetir = todos.size;
        }

        resultado.semana_vigente = semanaRef;
        resultado.nota_obligatoria = NOTA_PROGRAMACION;
        resultado.nota_para_el_asistente =
            'En AIFA "ruta" y "destino" son sinónimos: reporta UN SOLO número por tipo. ' +
            'Nunca inventes una distinción entre rutas y destinos. ' +
            'OBLIGATORIO: cada tipo trae su campo "lista" con TODOS sus destinos. ' +
            'Al responder debes enumerarlos TODOS, uno por uno, sin omitir ninguno y ' +
            'sin poner "entre otros" ni "etcétera". Si la lista trae 40, escribe los 40. ' +
            'La cantidad que enumeres tiene que coincidir exactamente con el número que ' +
            'reportas. Sólo en conversación hablada puedes decir el número, mencionar ' +
            'tres o cuatro y ofrecer el resto. ' +
            '"frecuencias_programadas_semana" son los vuelos de la semana: es otra cosa ' +
            'y sólo se menciona si la piden. ' +
            'Di a qué semana corresponden los datos y cierra con la frase de ' +
            '"nota_obligatoria", tal cual. ' +
            'Nombra los destinos SÓLO por su ciudad, nunca con códigos de tres letras. ' +
            'Sepáralos con comas y usa "y" únicamente antes del último; no los encadenes ' +
            'con "y" entre cada uno.';
        return resultado;
    };

    /* ── 2. Listado de destinos ──────────────────────────────────────────── */
    HERRAMIENTAS.listar_destinos = async ({ tipo, limite = 60 }) => {
        const { semana, filas } = await _filasSemana(tipo);
        const catalogo = await _catalogoCiudades();
        const porIata = new Map();
        filas.forEach(r => {
            if (!r.iata) return;
            if (!porIata.has(r.iata)) {
                porIata.set(r.iata, {
                    ciudad: _etiquetaDestino(r.iata, r.city, catalogo),
                    estado_o_pais: r.state || '',
                    aerolineas: [],
                    vuelos_por_semana: 0,
                });
            }
            const d = porIata.get(r.iata);
            if (r.airline && !d.aerolineas.includes(r.airline)) d.aerolineas.push(r.airline);
            d.vuelos_por_semana += Number(r.weekly_total) || 0;
        });
        const destinos = [...porIata.values()]
            .sort((a, b) => b.vuelos_por_semana - a.vuelos_por_semana)
            .slice(0, limite);
        return {
            tipo, semana_vigente: semana, total_destinos: porIata.size, destinos,
            nota_obligatoria: NOTA_PROGRAMACION,
            nota_para_el_asistente:
                'Menciona la semana de los datos y cierra con la frase de "nota_obligatoria", tal cual.',
        };
    };

    /* Los campos *_detail traen los vuelos del día como texto HTML, con las
       entradas REPETIDAS ("AM596 (Sal) 14:10<br>AM596 (Sal) 14:10"). El módulo
       de Frecuencias las depura por vuelo+hora antes de mostrarlas; aquí se
       hace igual para que los horarios que dicte AIFONSO coincidan con los
       que se ven en pantalla. */
    function _horariosDelDia(textoDetalle) {
        if (!textoDetalle) return [];
        const vistos = new Map();
        String(textoDetalle).split(/<br\s*\/?>/i).forEach(trozo => {
            const limpio = trozo.replace(/<[^>]*>/g, '').trim();
            if (!limpio) return;
            const m = limpio.match(/^(\S+)\s*\(([^)]*)\)\s*(\d{1,2}:\d{2})/);
            if (!m) return;
            const [, vuelo, tipoCrudo, hora] = m;
            const clave = `${vuelo}-${hora}`;
            if (vistos.has(clave)) return;
            // Formato compacto ("06:35 VB2281 sal") en vez de un objeto por
            // vuelo: un destino movido como Cancún tiene decenas de horarios y
            // en forma de objeto el resultado se pasaba del tamaño máximo, se
            // recortaba a media estructura y el modelo recibía datos rotos.
            vistos.set(clave, `${hora} ${vuelo} ${/lleg|arr/i.test(tipoCrudo) ? 'lleg' : 'sal'}`);
        });
        return [...vistos.values()].sort();
    }

    /* La mayoría de los días de la semana repiten exactamente el mismo
       itinerario, así que se agrupan: "lunes a viernes: 06:35 VB2281 sal…"
       en vez de repetir la lista siete veces. Reduce mucho el tamaño y de
       paso es como lo diría una persona. */
    function _agruparDiasIguales(fila) {
        const grupos = [];
        DIAS_SEMANA.forEach(dia => {
            const vuelos = Number(fila[dia]) || 0;
            const horarios = _horariosDelDia(fila[`${dia}_detail`]);
            const firma = `${vuelos}|${horarios.join(',')}`;
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && ultimo.firma === firma) ultimo.dias.push(DIAS_ES[dia]);
            else grupos.push({ firma, dias: [DIAS_ES[dia]], vuelos, horarios });
        });
        return grupos.map(({ dias, vuelos, horarios }) => ({
            dias: dias.length > 2 ? `${dias[0]} a ${dias[dias.length - 1]}` : dias.join(' y '),
            vuelos,
            horarios,
        }));
    }

    /* ── 3. Detalle de frecuencias de un destino ─────────────────────────── */
    HERRAMIENTAS.frecuencias_destino = async ({ destino }) => {
        const buscado = _normalizar(destino);
        const encontrados = [];
        let iataEncontrado = null;
        let etiquetaSemana = null;

        const catalogo = await _catalogoCiudades();

        for (const tipo of ['nacional', 'internacional', 'carga']) {
            const { semana, filas } = await _filasSemana(tipo);
            const coincidencias = filas.filter(r => {
                const nombreBueno = _normalizar(_etiquetaDestino(r.iata, r.city, catalogo));
                return _normalizar(r.iata) === buscado
                    // Se compara también contra el nombre corregido: así
                    // "Mérida" o "Merida" encuentran igual el destino.
                    || nombreBueno.includes(buscado)
                    || buscado.includes(nombreBueno)
                    || _normalizar(r.city).includes(buscado);
            });
            coincidencias.forEach(r => {
                iataEncontrado = iataEncontrado || r.iata;
                etiquetaSemana = etiquetaSemana || r.week_label;
                encontrados.push({
                    tipo,
                    semana_vigente: semana,
                    ciudad: _etiquetaDestino(r.iata, r.city, catalogo),
                    estado_o_pais: r.state,
                    aerolinea: r.airline,
                    vuelos_por_semana: Number(r.weekly_total) || 0,
                    horarios_por_dia: _agruparDiasIguales(r),
                });
            });
        }

        if (!encontrados.length) {
            return { encontrado: false, buscado: destino,
                     mensaje: 'No hay ese destino en la programación de la semana vigente.' };
        }

        const armar = (operaciones, horariosRecortados) => ({
            encontrado: true,
            destino: destino,
            iata: iataEncontrado,
            semana: etiquetaSemana,
            total_vuelos_por_semana: encontrados.reduce((s, e) => s + e.vuelos_por_semana, 0),
            operaciones,
            enlace_frecuencias: _enlaceDestino(iataEncontrado),
            nota_obligatoria: NOTA_PROGRAMACION,
            ...(horariosRecortados ? {
                horarios_omitidos: true,
                nota_para_el_asistente:
                    'Este destino tiene demasiados vuelos para dictar sus horarios uno por ' +
                    'uno. Da los totales por aerolínea y por día, y remite al enlace de ' +
                    '"enlace_frecuencias" para el horario completo. Menciona la semana y ' +
                    'cierra con la frase de "nota_obligatoria", tal cual.',
            } : {
                nota_para_el_asistente:
                    'Da los horarios por grupo de días (vuelo y hora). Incluye SIEMPRE el ' +
                    'enlace de "enlace_frecuencias" para ver el detalle completo, menciona ' +
                    'la semana, y cierra con la frase de "nota_obligatoria" tal cual.',
            }),
        });

        // Un destino muy movido (Guadalajara, con más de 170 vuelos) no cabe
        // con todos sus horarios. Antes que entregar datos recortados a la
        // mitad, se dan los conteos y se remite al enlace, que existe
        // precisamente para consultar el detalle completo.
        const completo = armar(encontrados, false);
        if (JSON.stringify(completo).length <= 5200) return completo;

        const sinHorarios = encontrados.map(o => ({
            ...o,
            horarios_por_dia: o.horarios_por_dia.map(({ dias, vuelos }) => ({ dias, vuelos })),
        }));
        return armar(sinHorarios, true);
    };

    /* ── 4. Operaciones diarias en un periodo (parte de operaciones) ─────── */
    HERRAMIENTAS.operaciones_periodo = async ({ desde, hasta }) => {
        const sb = _sb();
        if (!sb) throw new Error('Sin conexión a la base de datos.');
        const { data, error } = await sb
            .from('parte_operations')
            .select('*')
            .gte('fecha', desde)
            .lte('fecha', hasta)
            .order('fecha', { ascending: true });
        if (error) throw new Error(error.message);

        const filas = data || [];
        if (!filas.length) {
            return { desde, hasta, dias_con_registro: 0,
                     mensaje: 'No hay partes de operaciones capturados en ese rango.' };
        }

        const sumar = (campo) => filas.reduce((s, r) => s + (Number(r[campo]) || 0), 0);
        const comercial = sumar('comercial_llegada') + sumar('comercial_salida');
        const carga     = sumar('carga_llegada') + sumar('carga_salida');
        const general   = sumar('general_llegada') + sumar('general_salida');
        const total     = sumar('total_general') || (comercial + carga + general);

        const porDia = filas.map(r => ({
            fecha: r.fecha,
            total: Number(r.total_general) || 0,
            comercial: (Number(r.comercial_llegada) || 0) + (Number(r.comercial_salida) || 0),
            carga: (Number(r.carga_llegada) || 0) + (Number(r.carga_salida) || 0),
            general: (Number(r.general_llegada) || 0) + (Number(r.general_salida) || 0),
        }));
        const masMovido = porDia.reduce((a, b) => (b.total > a.total ? b : a), porDia[0]);

        return {
            desde, hasta,
            dias_con_registro: filas.length,
            totales: {
                operaciones_totales: _cifra(total),
                comercial: _cifra(comercial),
                carga: _cifra(carga),
                general: _cifra(general),
            },
            promedio_diario: _cifra(total / filas.length),
            dia_con_mas_operaciones: masMovido,
            detalle_por_dia: porDia.length <= 31 ? porDia : undefined,
            nota_para_el_asistente:
                'Los números ya traen separador de miles: cópialos tal cual. ' +
                'Esto son operaciones registradas, no programación de vuelos: no pongas ' +
                'la nota sobre cambios en la programación de las aerolíneas.',
        };
    };

    /* ── 5. Operaciones anuales ──────────────────────────────────────────
       OJO: NO se usa la tabla annual_operations. Es una foto que se actualiza
       de vez en cuando y se queda atrás: en agosto de 2026 reportaba 3.6
       millones de pasajeros cuando iban 4.4 millones — más de 800 mil de
       diferencia.

       La cifra viva es la misma que muestra el módulo "Comparativa
       Histórica" (js/comparativa-historica.js): meses ya cerrados salen de
       monthly_operations, y los que todavía no son oficiales se arman
       sumando daily_operations, que se captura a diario. Se replica aquí esa
       regla para que el asistente y esa pantalla nunca se contradigan.     */
    const CAMPOS_OPS = ['comercial_ops', 'comercial_pax', 'general_ops', 'general_pax', 'carga_ops', 'carga_tons'];

    /* Las cifras grandes se entregan YA con separador de miles ("4,423,940").
       Pedirle al modelo que las formatee no funciona: escribía "7058219" de
       corrido, ilegible. Si el número llega formateado, sólo tiene que
       copiarlo. */
    function _cifra(n) {
        const v = Math.round(Number(n) || 0);
        return v.toLocaleString('es-MX');
    }

    HERRAMIENTAS.operaciones_anuales = async ({ anio } = {}) => {
        const sb = _sb();
        if (!sb) throw new Error('Sin conexión a la base de datos.');

        const [rMensual, rDiario] = await Promise.all([
            sb.from('monthly_operations')
              .select('year, month, comercial_ops, comercial_pax, general_ops, general_pax, carga_ops, carga_tons, is_official')
              .order('year').order('month'),
            sb.from('daily_operations')
              .select('date, comercial_ops, comercial_pax, general_ops, general_pax, carga_ops, carga_tons')
              .order('date'),
        ]);
        if (rMensual.error) throw new Error(rMensual.error.message);

        // Suma de los días, agrupada por año y mes.
        const porMes = new Map();
        let ultimoDia = null;
        (rDiario.data || []).forEach(fila => {
            const d = new Date(fila.date + 'T00:00:00');
            const clave = `${d.getFullYear()}_${d.getMonth() + 1}`;
            if (!porMes.has(clave)) {
                porMes.set(clave, { year: d.getFullYear(), month: d.getMonth() + 1, is_official: false,
                                    ...Object.fromEntries(CAMPOS_OPS.map(c => [c, 0])) });
            }
            const acc = porMes.get(clave);
            CAMPOS_OPS.forEach(c => { acc[c] += Number(fila[c]) || 0; });
            if (!ultimoDia || fila.date > ultimoDia) ultimoDia = fila.date;
        });

        // Mezcla: lo oficial manda; lo no oficial (o inexistente) se toma del diario.
        const meses = [...(rMensual.data || [])];
        porMes.forEach((agg, clave) => {
            const i = meses.findIndex(m => `${m.year}_${m.month}` === clave);
            if (i === -1) meses.push(agg);
            else if (meses[i].is_official === false) meses[i] = { ...meses[i], ...agg, is_official: false };
        });

        const porAnio = new Map();
        meses.forEach(m => {
            if (anio && m.year !== Number(anio)) return;
            if (!porAnio.has(m.year)) {
                porAnio.set(m.year, { anio: m.year, meses_con_dato: 0, meses_preliminares: 0,
                                      ...Object.fromEntries(CAMPOS_OPS.map(c => [c, 0])) });
            }
            const a = porAnio.get(m.year);
            CAMPOS_OPS.forEach(c => { a[c] += Number(m[c]) || 0; });
            a.meses_con_dato++;
            if (m.is_official === false) a.meses_preliminares++;
        });

        const anios = [...porAnio.values()]
            .sort((a, b) => b.anio - a.anio)
            .map(a => ({
                anio: a.anio,
                comercial_operaciones: _cifra(a.comercial_ops),
                comercial_pasajeros  : _cifra(a.comercial_pax),
                general_operaciones  : _cifra(a.general_ops),
                general_pasajeros    : _cifra(a.general_pax),
                carga_operaciones    : _cifra(a.carga_ops),
                // Sin decimales: en una frase hablada "233,139.39" se lee mal
                // y se presta a que el modelo se coma un dígito. La fracción
                // de tonelada no aporta nada a la conversación.
                carga_toneladas      : _cifra(a.carga_tons),
                meses_con_dato       : a.meses_con_dato,
                meses_preliminares   : a.meses_preliminares,
            }));

        return {
            anios,
            datos_al_dia: ultimoDia,
            nota_para_el_asistente:
                'Cifras vivas, iguales a las del módulo Comparativa Histórica. Un año en ' +
                'curso lleva sólo los meses transcurridos (ver meses_con_dato), así que no ' +
                'lo compares de tú a tú contra un año completo sin advertirlo. Si hay ' +
                'meses_preliminares, aclara que esa parte aún puede ajustarse. Menciona ' +
                'hasta qué día están actualizados los datos (datos_al_dia). ' +
                'Los números ya vienen con separador de miles: cópialos tal cual. ' +
                'Esto NO es programación de vuelos: no pongas aquí la nota sobre cambios ' +
                'en la programación de las aerolíneas.',
        };
    };

    /* ── 6. Aerolíneas que operan en AIFA ────────────────────────────────── */
    HERRAMIENTAS.listar_aerolineas = async ({ tipo = 'todos', aerolinea } = {}) => {
        const tipos = tipo === 'todos' ? ['nacional', 'internacional', 'carga'] : [tipo];
        const catalogo = await _catalogoCiudades();
        const porAerolinea = new Map();
        let semanaRef = null;

        for (const t of tipos) {
            const { semana, filas } = await _filasSemana(t);
            semanaRef = semana || semanaRef;
            filas.forEach(r => {
                if (!r.airline) return;
                if (!porAerolinea.has(r.airline)) {
                    porAerolinea.set(r.airline, {
                        aerolinea: r.airline, vuelos_por_semana: 0,
                        // Se guardan por tipo para poder decir "31 nacionales y
                        // 8 internacionales" en vez de sólo un total suelto.
                        porTipo: { nacional: new Map(), internacional: new Map(), carga: new Map() },
                    });
                }
                const a = porAerolinea.get(r.airline);
                if (r.iata) a.porTipo[t].set(r.iata, _etiquetaDestino(r.iata, r.city, catalogo));
                a.vuelos_por_semana += Number(r.weekly_total) || 0;
            });
        }

        const buscada = aerolinea ? _normalizar(aerolinea) : null;
        let lista = [...porAerolinea.values()];
        if (buscada) lista = lista.filter(a => _normalizar(a.aerolinea).includes(buscada));
        lista.sort((a, b) => b.vuelos_por_semana - a.vuelos_por_semana);

        // Enumerar los destinos de las 26 aerolíneas de golpe no cabe en una
        // sola respuesta. Se detallan sólo las que se van a comentar: la que
        // se pidió por nombre, o las de mayor movimiento. Del resto van los
        // conteos, y si preguntan por una en concreto se vuelve a consultar.
        const CON_DETALLE = buscada ? lista.length : 3;

        const aerolineas = lista.map((a, i) => {
            const conteos = {};
            const listas = {};
            Object.entries(a.porTipo).forEach(([t, mapa]) => {
                if (!mapa.size) return;
                conteos[t] = mapa.size;
                if (i < CON_DETALLE) listas[t] = [...mapa.values()];
            });
            const total = Object.values(conteos).reduce((s, n) => s + n, 0);
            return {
                aerolinea: a.aerolinea,
                vuelos_por_semana: a.vuelos_por_semana,
                destinos: total,
                destinos_por_tipo: conteos,
                ...(i < CON_DETALLE ? { destinos_lista: listas } : {}),
            };
        });

        return {
            semana_vigente: semanaRef,
            total: aerolineas.length,
            aerolineas,
            nota_obligatoria: NOTA_PROGRAMACION,
            nota_para_el_asistente:
                'OBLIGATORIO al destacar una aerolínea (la que más vuela, la que te ' +
                'pregunten): di cuántos destinos tiene, el desglose de "destinos_por_tipo" ' +
                '(cuántos nacionales, internacionales y de carga) y ENUMERA los destinos ' +
                'de "destinos_lista", agrupados por tipo. Nunca des el número de destinos ' +
                'sin decir cuáles son. ' +
                'Las aerolíneas sin "destinos_lista" no traen el detalle: si preguntan por ' +
                'una de ellas, vuelve a consultar pasando su nombre en el parámetro ' +
                '"aerolinea". Menciona la semana y cierra con la frase exacta de ' +
                '"nota_obligatoria"; no escribas ninguna otra nota. ' +
                'Nombra los destinos SÓLO por su ciudad, nunca con códigos de tres letras. ' +
                'Sepáralos con comas y usa "y" únicamente antes del último.',
        };
    };

    /* ── 7. Vuelos del itinerario ────────────────────────────────────────── */
    HERRAMIENTAS.consultar_vuelos = async ({ fecha, aerolinea, destino, limite = 40 }) => {
        const sb = _sb();
        if (!sb) throw new Error('Sin conexión a la base de datos.');
        let q = sb.from('flights').select(
            'vuelo_llegada, vuelo_salida, aerolinea, origen, destino, fecha_llegada, ' +
            'fecha_salida, hora_llegada, hora_salida, posicion, equipo, estatus'
        );
        if (fecha) q = q.or(`fecha_llegada.eq.${fecha},fecha_salida.eq.${fecha}`);
        if (aerolinea) q = q.ilike('aerolinea', `%${aerolinea}%`);
        if (destino) q = q.or(`destino.ilike.%${destino}%,origen.ilike.%${destino}%`);

        const { data, error } = await q.limit(Math.min(limite, 100));
        if (error) throw new Error(error.message);
        return {
            filtros: { fecha, aerolinea, destino },
            total_encontrados: (data || []).length,
            vuelos: data || [],
        };
    };

    /* ── 8. Agenda de comités ────────────────────────────────────────────── */
    HERRAMIENTAS.agenda_sesiones = async ({ dias = 30 } = {}) => {
        const sb = _sb();
        if (!sb) throw new Error('Sin conexión a la base de datos.');
        const hoy = new Date();
        const fin = new Date(hoy.getTime() + dias * 86400000);
        const iso = (d) => d.toISOString().slice(0, 10);

        const [rSesiones, rComites] = await Promise.all([
            sb.from('agenda_reuniones')
              .select('id, comite_id, area, numero_sesion, fecha_sesion, hora_inicio, estatus')
              .gte('fecha_sesion', iso(hoy)).lte('fecha_sesion', iso(fin))
              .neq('estatus', 'Cancelada')
              .order('fecha_sesion', { ascending: true }),
            sb.from('agenda_comites').select('id, nombre, acronimo, area'),
        ]);
        if (rSesiones.error) throw new Error(rSesiones.error.message);

        const comites = {};
        (rComites.data || []).forEach(c => { comites[c.id] = c; });

        return {
            rango: { desde: iso(hoy), hasta: iso(fin) },
            total: (rSesiones.data || []).length,
            sesiones: (rSesiones.data || []).map(r => {
                const c = comites[r.comite_id] || {};
                return {
                    comite: c.nombre || `ID ${r.comite_id}`,
                    acronimo: c.acronimo || '',
                    area: r.area || c.area || '',
                    numero_sesion: r.numero_sesion,
                    fecha: r.fecha_sesion,
                    hora: r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : '',
                    estatus: r.estatus,
                };
            }),
        };
    };

    /* ── 9. Catálogo de aeropuertos ──────────────────────────────────────── */
    HERRAMIENTAS.buscar_aeropuerto = async ({ texto }) => {
        const sb = _sb();
        if (!sb) throw new Error('Sin conexión a la base de datos.');
        const { data, error } = await sb
            .from('aeropuertos')
            .select('iata, icao, nombre, ciudad, pais')
            .or(`iata.ilike.%${texto}%,ciudad.ilike.%${texto}%,nombre.ilike.%${texto}%`)
            .limit(15);
        if (error) throw new Error(error.message);
        return { buscado: texto, resultados: data || [] };
    };

    /* ═══════════════════════════════════════════════════════════════════════
       ESQUEMAS — lo que el modelo ve para decidir qué herramienta usar.

       Van deliberadamente ESCUETOS. Estas definiciones se reenvían al modelo
       en CADA llamada, así que cada palabra de más se paga varias veces por
       pregunta. Se conservan sólo las frases que de verdad ayudan a
       distinguir una herramienta de otra; los matices de negocio y cómo
       redactar viajan una sola vez, dentro del resultado o del prompt.
       ═══════════════════════════════════════════════════════════════════════ */

    const TIPO_ENUM = ['nacional', 'internacional', 'carga'];

    const herramienta = (name, description, properties, required) => ({
        type: 'function',
        function: {
            name, description,
            parameters: { type: 'object', properties, ...(required ? { required } : {}) },
        },
    });
    const txt = (enumerado) => enumerado ? { type: 'string', enum: enumerado } : { type: 'string' };
    const num = { type: 'integer' };

    const ESQUEMAS = [
        herramienta('contar_rutas',
            'Cuántas rutas/destinos opera AIFA y cuáles son. Para "cuántas rutas", "cuántos destinos", "qué destinos hay".',
            { tipo: txt([...TIPO_ENUM, 'todos']) }, ['tipo']),

        herramienta('listar_destinos',
            'Destinos con sus aerolíneas y vuelos por semana, ordenados por movimiento.',
            { tipo: txt(TIPO_ENUM), limite: num }, ['tipo']),

        herramienta('frecuencias_destino',
            'Un destino concreto: quién lo vuela y cuántos vuelos por semana y por día. Para "cuántos vuelos hay a Cancún", "quién vuela a Bogotá".',
            { destino: txt() }, ['destino']),

        herramienta('operaciones_periodo',
            'Operaciones reales del Parte de Operaciones entre dos fechas (AAAA-MM-DD): total, promedio diario y día más movido. Para "cuántas operaciones hubo ayer, esta semana o en marzo".',
            { desde: txt(), hasta: txt() }, ['desde', 'hasta']),

        herramienta('operaciones_anuales',
            'Cifras del año: operaciones y pasajeros comerciales, aviación general y carga en toneladas. Para "cómo vamos este año", "cómo va el año", "cuántos pasajeros llevamos", o comparar un año con otro.',
            { anio: num }),

        herramienta('listar_aerolineas',
            'Aerolíneas que operan en AIFA, con sus destinos y vuelos por semana. Pasa "aerolinea" para ver todos los destinos de una en concreto.',
            { tipo: txt([...TIPO_ENUM, 'todos']), aerolinea: txt() }),

        herramienta('consultar_vuelos',
            'Vuelos concretos del itinerario con número, horario y posición. Para "qué vuelos hay hoy", "vuelos de Volaris".',
            { fecha: txt(), aerolinea: txt(), destino: txt(), limite: num }),

        herramienta('agenda_sesiones',
            'Próximas sesiones de comités con fecha, hora y área.',
            { dias: num }),

        herramienta('buscar_aeropuerto',
            'A qué aeropuerto o ciudad corresponde un código. Para "qué significa MID", "qué es CUN", "dónde queda ese código".',
            { texto: txt() }, ['texto']),
    ];

    /* ── Ejecuta una herramienta por nombre, siempre devolviendo algo ─────── */
    async function ejecutar(nombre, argumentos) {
        const fn = HERRAMIENTAS[nombre];
        if (!fn) return { error: `La herramienta "${nombre}" no existe.` };
        try {
            return await fn(argumentos || {});
        } catch (err) {
            // El error se devuelve como dato para que el modelo pueda explicarlo
            // en lugar de romper la conversación.
            return { error: err?.message || 'Fallo al consultar los datos.' };
        }
    }

    window.AsistenteAifaDatos = {
        esquemas: ESQUEMAS,
        ejecutar,
        limpiarCache: _limpiarCache,
        _herramientas: HERRAMIENTAS, // expuesto para pruebas
    };
})();
