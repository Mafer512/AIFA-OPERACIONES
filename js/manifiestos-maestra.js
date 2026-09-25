/* maestra_operaciones vista como manifiestos, y el armado de los mapas de calor.
 *
 * El módulo de Manifiestos (js/manifiestos-analisis.js) nació leyendo las tablas
 * que se importaban de Excel: una tabla por período y columnas en mayúsculas
 * ("TOTAL PAX", "HR. DE OPERACIÓN", "TIPO DE MANIFIESTO"...). De mayo de 2026 en
 * adelante el dato bueno ya no vive ahí: vive en maestra_operaciones, que junta
 * en un solo renglón por operación lo de Conciliación Manifiestos, el itinerario
 * del AODB y los manifiestos del portal.
 *
 * Aquí se traduce ese renglón al vocabulario que las ocho sub-pestañas ya
 * entienden, para que sigan funcionando sin reescribirlas, y se arma el estado
 * de los mapas de calor, que ahora se pueden ver por día de la semana o fecha
 * por fecha.
 *
 * Puro: ni DOM ni Supabase. Lo que necesita de afuera (el nombre bueno de la
 * aerolínea, el país de cada aeropuerto) llega como parámetro.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ManifiestosMaestra = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MESES = Object.freeze([
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ]);
    const MESES_CORTOS = Object.freeze(['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']);
    // Lunes primero: es como se lee un cuadro de turnos, y como ya venía el mapa.
    const DIAS_CORTOS = Object.freeze(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
    const DIAS_LARGOS = Object.freeze(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);

    /* Las columnas que se le piden a maestra_operaciones. Se enumeran a propósito
     * en vez de pedir "*": la tabla arrastra datos_origen (el renglón completo
     * del AODB en jsonb) y traerlo multiplicaría por diez lo que viaja por la
     * red sin que ninguna gráfica lo use. */
    const COLUMNAS = Object.freeze([
        'id', 'fecha_operacion', 'tipo_movimiento', 'tipo_manifiesto', 'numero_vuelo',
        'tipo_operacion', 'tipo_aeronave_codigo', 'matricula_origen', 'aerolinea_origen',
        'slot_asignado', 'slot_coordinado', 'hora_operacion', 'hora_recepcion',
        'hora_embarque_desembarque', 'estado_puntualidad',
        'pax_total', 'pax_diplomaticos', 'pax_comision', 'pax_infantes', 'pax_transitos',
        'pax_conexiones', 'pax_otros_exentos', 'pax_exentos_reportados', 'pax_pagan_tua_reportados',
        'equipaje_kg', 'carga_total_kg', 'correo_kg',
        'ruta_origen', 'origen_origen', 'destino_origen', 'routing',
        'estatus_vuelo', 'posicion', 'fuente_principal'
    ]);

    /* Las fuentes que significan "alguien capturó un manifiesto". El resto de
     * los renglones de maestra_operaciones son vuelos programados que vinieron
     * del itinerario y todavía no tienen manifiesto: cuentan como operación,
     * pero no traen pasajeros ni equipaje. */
    const FUENTES_MANIFIESTO = Object.freeze([
        'CONCILIACION_MANIFIESTOS', 'MANIFIESTOS_PASAJEROS', 'MANIFIESTOS_CARGA'
    ]);

    /* -------------------------------------------------------------------
       Lecturas defensivas
    ------------------------------------------------------------------- */

    /* La hora tal como se capturó, en texto.
     *
     * hora_operacion es timestamptz y PostgREST lo entrega en UTC
     * ("2026-05-14T14:30:00+00:00"). Pasarlo por Date() y pedirle getHours()
     * lo correría al huso del navegador: en México, seis horas antes, y el
     * mapa de calor pintaría como vuelos de madrugada los de la tarde. La hora
     * que se capturó es literalmente la que va después de la T, así que se lee
     * del texto y no se convierte nada. */
    function textoHora(valor) {
        if (valor === null || valor === undefined) return '';
        const texto = String(valor).trim();
        if (!texto) return '';
        const conFecha = texto.match(/[T ](\d{1,2}):(\d{2})/);
        if (conFecha) return conFecha[1].padStart(2, '0') + ':' + conFecha[2];
        const soloHora = texto.match(/^(\d{1,2}):(\d{2})/);
        if (soloHora) return soloHora[1].padStart(2, '0') + ':' + soloHora[2];
        return '';
    }

    /* "2026-05-14" a partir de una fecha o de un timestamp, sin convertir husos. */
    function textoFecha(valor) {
        if (valor === null || valor === undefined) return '';
        const texto = String(valor).trim();
        const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
    }

    function numeroOVacio(valor) {
        if (valor === null || valor === undefined || valor === '') return '';
        const n = Number(valor);
        return Number.isFinite(n) ? n : '';
    }

    function sinAcentos(texto) {
        return String(texto === null || texto === undefined ? '' : texto)
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim()
            .toLowerCase();
    }

    /* El otro extremo de la ruta: a dónde fue o de dónde vino.
     *
     * Misma regla que _aifa_route_endpoint en la base (migración 010): se parte
     * la ruta en tokens y se toma el vecino de NLU/MMSM, que es el AIFA. */
    function extremoDeRuta(ruta, movimiento) {
        const limpio = String(ruta === null || ruta === undefined ? '' : ruta)
            .toUpperCase()
            .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
        if (!limpio) return '';
        const tokens = limpio.split(/[^A-Z0-9]+/).filter(Boolean);
        if (!tokens.length) return '';
        const esLocal = t => t === 'NLU' || t === 'MMSM';
        if (String(movimiento || '').toUpperCase() === 'LLEGADA') {
            const i = tokens.findIndex(esLocal);
            return i > 0 ? tokens[i - 1] : tokens[0];
        }
        let ultimo = -1;
        tokens.forEach((t, i) => { if (esLocal(t)) ultimo = i; });
        if (ultimo >= 0 && ultimo < tokens.length - 1) return tokens[ultimo + 1];
        return tokens[tokens.length - 1];
    }

    function extremoDeFila(fila) {
        const movimiento = String(fila.tipo_movimiento || '').toUpperCase();
        const directo = movimiento === 'LLEGADA' ? fila.origen_origen : fila.destino_origen;
        const texto = String(directo || fila.destino_origen || fila.origen_origen || '').trim();
        if (texto) return texto;
        return extremoDeRuta(fila.ruta_origen || fila.routing, movimiento);
    }

    /* Nacional o Internacional. Manda lo que se capturó; si no hay nada
     * capturado se deduce del aeropuerto del otro extremo. Cuando ninguno de
     * los dos alcanza se devuelve vacío: la fila sigue contando como operación,
     * simplemente no se le inventa un tipo. */
    function clasificaOperacion(fila, paisesPorIata) {
        const declarado = String(fila.tipo_operacion || '').trim();
        if (declarado) return declarado;
        const codigo = String(extremoDeFila(fila) || '').trim().toUpperCase();
        if (!codigo) return '';
        if (codigo.length === 4 && codigo.startsWith('MM')) return 'Nacional';
        let pais = '';
        if (paisesPorIata) {
            pais = typeof paisesPorIata.get === 'function'
                ? (paisesPorIata.get(codigo) || '')
                : (paisesPorIata[codigo] || '');
        }
        if (!pais) return '';
        return sinAcentos(pais) === 'mexico' ? 'Nacional' : 'Internacional';
    }

    /* De dónde salió el renglón, para el filtro de "Registros".
     *
     * hora_recepcion sólo la escribe el trigger de Conciliación Manifiestos
     * (migraciones 024/025), así que basta para reconocer lo que pasó por el
     * worksheet aunque el renglón lo haya creado antes el itinerario y por eso
     * fuente_principal siga diciendo ITINERARIO_VUELOS_EDITABLE. */
    function origenDeFila(fila) {
        if (fila.hora_recepcion) return 'manifiesto';
        if (FUENTES_MANIFIESTO.indexOf(String(fila.fuente_principal || '')) >= 0) return 'manifiesto';
        return 'itinerario';
    }

    /* -------------------------------------------------------------------
       Traducción al vocabulario de las gráficas
    ------------------------------------------------------------------- */

    /* Un renglón de maestra_operaciones con los nombres de columna que usan
     * los accesores de manifiestos-analisis.js.
     *
     * opciones.nombreAerolinea — homologa el nombre (AifaAerolineas.canonico).
     * opciones.paisesPorIata   — Map u objeto IATA → país, para Nacional/Internacional.
     */
    function mapearFila(fila, opciones) {
        const op = opciones || {};
        const fecha = textoFecha(fila.fecha_operacion);
        const mesIdx = fecha ? Number(fecha.slice(5, 7)) - 1 : -1;
        const movimiento = String(fila.tipo_movimiento || '').toUpperCase();

        const crudo = fila.aerolinea_origen;
        const aerolinea = crudo
            ? String(op.nombreAerolinea ? (op.nombreAerolinea(crudo) || crudo) : crudo).trim()
            : '';

        // El slot sirve de respaldo: un vuelo programado que todavía no tiene
        // manifiesto no trae hora_operacion, pero sí la hora a la que estaba
        // previsto, y con ella ya cae en la franja correcta del mapa de calor.
        const hora = textoHora(fila.hora_operacion)
            || textoHora(fila.slot_asignado)
            || textoHora(fila.slot_coordinado)
            || textoHora(fila.hora_embarque_desembarque);

        return {
            'MES': mesIdx >= 0 && mesIdx <= 11 ? MESES[mesIdx] : '',
            'FECHA': fecha,
            // tipo_movimiento es NOT NULL y sólo vale LLEGADA o SALIDA, así que
            // es más confiable que tipo_manifiesto (texto libre) para decidir si
            // el vuelo llegó o salió.
            'TIPO DE MANIFIESTO': movimiento === 'LLEGADA' ? 'Llegada'
                : (movimiento === 'SALIDA' ? 'Salida' : String(fila.tipo_manifiesto || '')),
            'AEROLINEA': aerolinea,
            'TIPO DE OPERACIÓN': clasificaOperacion(fila, op.paisesPorIata),
            'AERONAVE': String(fila.tipo_aeronave_codigo || ''),
            'MATRICULA': String(fila.matricula_origen || ''),
            '# DE VUELO': String(fila.numero_vuelo || ''),
            'DESTINO / ORIGEN': extremoDeFila(fila),
            'RUTA': String(fila.ruta_origen || fila.routing || ''),
            'HR. DE OPERACIÓN': hora,
            'TOTAL PAX': numeroOVacio(fila.pax_total),
            'PAX QUE PAGAN TUA': numeroOVacio(fila.pax_pagan_tua_reportados),
            'INFANTES': numeroOVacio(fila.pax_infantes),
            'TRANSITOS': numeroOVacio(fila.pax_transitos),
            'CONEXIONES': numeroOVacio(fila.pax_conexiones),
            'DIPLOMATICOS': numeroOVacio(fila.pax_diplomaticos),
            'EN COMISION': numeroOVacio(fila.pax_comision),
            'OTROS EXENTOS': numeroOVacio(fila.pax_otros_exentos),
            'TOTAL EXENTOS': numeroOVacio(fila.pax_exentos_reportados),
            'KGS. DE EQUIPAJE': numeroOVacio(fila.equipaje_kg),
            'KG DE CARGA TOTAL': numeroOVacio(fila.carga_total_kg),
            'CORREO': numeroOVacio(fila.correo_kg),
            'PUNTUALIDAD / CANCELACIÓN': String(fila.estado_puntualidad || ''),
            'ESTATUS': String(fila.estatus_vuelo || ''),
            'POSICION': String(fila.posicion || ''),
            // Con guión bajo para que no se confundan con columnas capturadas:
            // son marcas de esta traducción, no dato del manifiesto.
            '_origen': origenDeFila(fila),
            '_id': fila.id
        };
    }

    function mapearFilas(filas, opciones) {
        return (Array.isArray(filas) ? filas : []).map(f => mapearFila(f, opciones));
    }

    /* -------------------------------------------------------------------
       Mapas de calor
    ------------------------------------------------------------------- */

    function matriz24x7() { return Array.from({ length: 24 }, () => Array(7).fill(0)); }
    function detalles24x7() { return Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => [])); }
    function vector24() { return Array(24).fill(0); }
    function detalles24() { return Array.from({ length: 24 }, () => []); }

    /* Índice de día con lunes en 0, sin pasar por el constructor local de Date:
     * "2026-05-14" es una fecha civil, no un instante, y armarla como hora local
     * la corre de día en los husos negativos. */
    function indiceDiaSemana(claveDia) {
        const p = String(claveDia || '').split('-');
        if (p.length !== 3) return -1;
        const utc = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        if (Number.isNaN(utc)) return -1;
        return (new Date(utc).getUTCDay() + 6) % 7;
    }

    function sumaDias(claveDia, dias) {
        const p = String(claveDia).split('-');
        const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + dias));
        return d.toISOString().slice(0, 10);
    }

    function etiquetaDia(claveDia) {
        const p = String(claveDia || '').split('-');
        if (p.length !== 3) return String(claveDia || '');
        return p[2] + ' ' + MESES_CORTOS[Number(p[1]) - 1];
    }

    function etiquetaMes(claveMes) {
        const p = String(claveMes || '').split('-');
        if (p.length !== 2) return String(claveMes || '');
        return MESES[Number(p[1]) - 1] + ' ' + p[0];
    }

    function etiquetaSemana(claveLunes, indice) {
        const domingo = sumaDias(claveLunes, 6);
        return 'S' + indice + ' ' + etiquetaDia(claveLunes) + '–' + etiquetaDia(domingo);
    }

    /* El estado completo de un mapa de calor, en sus dos lecturas:
     *
     *   · por día de la semana — 24 x 7, para ver el patrón que se repite.
     *     Acumulado, o una semana a la vez.
     *   · por fecha            — 24 x (días del mes elegido), para ver qué pasó
     *     el martes 12 a las 7 de la mañana y no "los martes" en general.
     *
     * Las dos leen los mismos renglones, así que se arman en una sola pasada.
     * lector = { hora, dia, pax, detalle }, cada uno una función del renglón.
     */
    function construirMapaCalor(filas, lector) {
        const leer = lector || {};
        const horaDe = leer.hora || (() => -1);
        const diaDe = leer.dia || (() => '');
        const paxDe = leer.pax || (() => 0);
        const detalleDe = leer.detalle || (() => ({}));

        const semanaPax = matriz24x7();
        const semanaOps = matriz24x7();
        const semanaDetalles = detalles24x7();
        const porSemana = new Map();
        const porDia = new Map();
        const porMes = new Map();

        (Array.isArray(filas) ? filas : []).forEach(fila => {
            const h = horaDe(fila);
            if (!Number.isFinite(h) || h < 0 || h > 23) return;
            const claveDia = diaDe(fila);
            if (!claveDia) return;
            const idxDia = indiceDiaSemana(claveDia);
            if (idxDia < 0) return;

            const pax = Number(paxDe(fila)) || 0;
            const detalle = detalleDe(fila);

            semanaPax[h][idxDia] += pax;
            semanaOps[h][idxDia] += 1;
            semanaDetalles[h][idxDia].push(detalle);

            const claveLunes = sumaDias(claveDia, -idxDia);
            if (!porSemana.has(claveLunes)) {
                porSemana.set(claveLunes, {
                    clave: claveLunes, indice: 0, etiqueta: '',
                    pax: matriz24x7(), ops: matriz24x7(), detalles: detalles24x7()
                });
            }
            const semana = porSemana.get(claveLunes);
            semana.pax[h][idxDia] += pax;
            semana.ops[h][idxDia] += 1;
            semana.detalles[h][idxDia].push(detalle);

            if (!porDia.has(claveDia)) {
                porDia.set(claveDia, {
                    clave: claveDia,
                    etiqueta: etiquetaDia(claveDia),
                    diaSemana: DIAS_CORTOS[idxDia],
                    diaSemanaLargo: DIAS_LARGOS[idxDia],
                    finDeSemana: idxDia >= 5,
                    mes: claveDia.slice(0, 7),
                    pax: vector24(), ops: vector24(), detalles: detalles24()
                });
            }
            const dia = porDia.get(claveDia);
            dia.pax[h] += pax;
            dia.ops[h] += 1;
            dia.detalles[h].push(detalle);

            const claveMes = claveDia.slice(0, 7);
            if (!porMes.has(claveMes)) porMes.set(claveMes, { clave: claveMes, etiqueta: etiquetaMes(claveMes), dias: [] });
        });

        const clavesSemana = [...porSemana.keys()].sort();
        clavesSemana.forEach((clave, i) => {
            const semana = porSemana.get(clave);
            semana.indice = i + 1;
            semana.etiqueta = etiquetaSemana(clave, i + 1);
        });

        const clavesDia = [...porDia.keys()].sort();
        clavesDia.forEach(clave => { porMes.get(clave.slice(0, 7)).dias.push(clave); });

        const clavesMes = [...porMes.keys()].sort();

        return {
            semana: { pax: semanaPax, ops: semanaOps, detalles: semanaDetalles },
            porSemana, clavesSemana,
            porDia, clavesDia,
            porMes, clavesMes
        };
    }

    return Object.freeze({
        MESES,
        MESES_CORTOS,
        DIAS_CORTOS,
        DIAS_LARGOS,
        COLUMNAS,
        FUENTES_MANIFIESTO,
        textoHora,
        textoFecha,
        extremoDeRuta,
        extremoDeFila,
        clasificaOperacion,
        origenDeFila,
        mapearFila,
        mapearFilas,
        indiceDiaSemana,
        etiquetaDia,
        etiquetaMes,
        etiquetaSemana,
        construirMapaCalor
    });
});
