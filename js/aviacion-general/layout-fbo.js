/* Lectura del Layout del sistema FBO (hoja "Global") → filas de operaciones_fbo.
 *
 * Núcleo puro: no toca el DOM, no habla con Supabase y no depende de SheetJS.
 * Recibe las hojas ya convertidas a matrices (una celda por posición, tal como
 * las entrega XLSX.utils.sheet_to_json con header:1, raw:true) y devuelve las
 * operaciones transformadas con su reporte de validación. Así se prueba en
 * Node con el propio docs/fbo/Lay-out.xlsx: __tests__/aviacion-general-layout-fbo.test.js
 *
 * EL MAPEO es el de docs/fbo/carga_layout_fbo_operaciones_fbo.sql, con dos
 * precisiones pedidas para la importación desde pantalla:
 *   · tiempo_permanencia_min es null si sale negativo;
 *   · los enteros vacíos son 0, pero un texto que no es número BLOQUEA la fila
 *     (convertirlo en 0 sería inventar un dato).
 *
 * FECHAS Y HORAS: hora local de México, sin zona horaria. Una celda de fecha de
 * Excel es un número de serie (días desde 1899-12-30, la fracción es la hora);
 * se convierte con aritmética entera a componentes Y-M-D h:m:s. No se usa
 * new Date(serie), ni toISOString(), ni nada que pase por UTC: eso corre la
 * hora 6 horas y cambia de día las operaciones de la tarde.
 *
 * No se lee NADA de cobranza (importes, IVA, TUA en pesos, folios, estado).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AviacionGeneralLayoutFbo = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    /**
     * @typedef {null|undefined|string|number|boolean|Date} Celda
     *
     * @typedef {Object} HojaCruda
     * @property {string}   nombre
     * @property {Celda[][]} filas        Matriz de la hoja (header:1).
     * @property {number}   [filaInicial] Fila (base 0) de Excel de filas[0]; por omisión 0.
     *
     * @typedef {Object} Instante
     * @property {string}      fecha     'YYYY-MM-DD'
     * @property {string|null} hora      'HH:MM:SS' (null si el texto sólo traía fecha)
     * @property {number|null} segundos  Segundos desde 1970-01-01 en hora local; null sin hora.
     *
     * @typedef {Object} Incidencia
     * @property {number}      filaExcel
     * @property {string|null} registro
     * @property {'ERROR'|'ADVERTENCIA'} tipo
     * @property {string}      campo
     * @property {string}      motivo
     *
     * @typedef {Object} OperacionFbo   Una fila de public.operaciones_fbo (sin id).
     * @property {string|null} registro
     * @property {string|null} operador
     * @property {string|null} vuelo_operado_por
     * @property {string|null} matricula
     * @property {string|null} tipo_aeronave
     * @property {string|null} tipo_ala
     * @property {string|null} origen
     * @property {string|null} nac_int_llegada
     * @property {string|null} fecha_aterrizaje
     * @property {string|null} hora_aterrizaje
     * @property {string|null} hora_llegada_posicion
     * @property {string|null} hora_desembarque
     * @property {string|null} tiempo_desembarque
     * @property {number}      pax_llegada_adultos
     * @property {number}      pax_llegada_infantes
     * @property {number}      pax_llegada_totales
     * @property {string|null} destino
     * @property {string|null} nac_int_salida
     * @property {string|null} fecha_salida_posicion
     * @property {string|null} hora_embarque
     * @property {string|null} hora_salida_posicion
     * @property {string|null} hora_despegue
     * @property {number}      pax_salida_adultos
     * @property {number}      pax_salida_infantes
     * @property {number}      pax_salida_totales
     * @property {number}      pax_pagan_tua
     * @property {string|null} tiempo_embarque
     * @property {number|null} tiempo_permanencia_min
     * @property {number}      uds_traslado_pax
     * @property {number}      uds_acarreo_equipaje
     * @property {number|null} mtow
     * @property {number|null} mzfw
     * @property {string|null} oficial_operaciones
     *
     * @typedef {Object} FilaLayout
     * @property {number}       filaExcel
     * @property {string|null}  registro
     * @property {OperacionFbo} operacion
     * @property {Incidencia[]} errores       Bloquean la fila.
     * @property {Incidencia[]} advertencias  No bloquean.
     *
     * @typedef {Object} ResultadoLayout
     * @property {string|null}  hoja
     * @property {number|null}  filaEncabezado   Fila de Excel (base 1) de los encabezados.
     * @property {string[]}     columnasFaltantes
     * @property {FilaLayout[]} filas
     * @property {string|null}  error            Problema que impide leer el archivo.
     */

    // ── Encabezados del Layout ──────────────────────────────────────────────
    // Se comparan normalizados (sin acentos, sin mayúsculas, espacios
    // colapsados), así "Matrícula", "MATRICULA" y " matricula " son la misma.

    const COLUMNAS = Object.freeze({
        registro:          'Registro',
        matricula:         'Matrícula',
        operador:          'Operador',
        prestador:         'Prestador',
        aeronave:          'Aeronave',
        tipoAla:           'Tipo de ala',
        mtow:              'MTOW t',
        mzfw:              'MZFW t',
        nacIntLlegada:     'Llegada nacional/internacional',
        nacIntSalida:      'Salida nacional/internacional',
        aterrizaje:        'Aterrizaje',
        llegadaPlataforma: 'Llegada a plataforma',
        finDesembarque:    'Fin desembarque',
        inicioEmbarque:    'Inicio embarque',
        salidaPosicion:    'Salida posición',
        despegue:          'Despegue',
        adultosLlegada:    'Adultos llegada',
        menoresLlegada:    'Menores llegada',
        infantesLlegada:   'Infantes llegada',
        valido:            'Validó',
        origenIata:        'Origen IATA',
        origenOaci:        'Origen OACI',
        origenLocal:       'Origen Local',
        destinoIata:       'Destino IATA',
        destinoOaci:       'Destino OACI',
        destinoLocal:      'Destino Local',
        udsTraslado:       'Unidades traslado pasajeros',
        udsAcarreo:        'Unidades acarreo equipaje',
        salNacTua:         'Salida nacional Pagan TUA',
        salNacInfantes:    'Salida nacional Infantes',
        salNacTotal:       'Salida nacional Total salida',
        salIntTua:         'Salida internacional Pagan TUA',
        salIntInfantes:    'Salida internacional Infantes',
        salIntTotal:       'Salida internacional Total salida'
    });

    // Sin éstas la hoja no es un Layout: se usan para elegir la hoja. Las
    // demás, si faltan, se reportan y se leen como vacías.
    const REQUERIDAS = Object.freeze(['registro', 'matricula', 'operador', 'aeronave', 'aterrizaje', 'salidaPosicion']);

    const HOJA_PREFERIDA = 'global';
    const FILAS_BUSQUEDA_ENCABEZADO = 50;

    /** @param {Celda} valor */
    function normalizarEncabezado(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    const CLAVES_NORMALIZADAS = Object.freeze(Object.fromEntries(
        Object.entries(COLUMNAS).map(([clave, titulo]) => [clave, normalizarEncabezado(titulo)])
    ));

    /**
     * Índice (base 0, dentro de `filas`) de la fila de encabezados: la primera
     * que contenga "Registro" y "Matrícula". El archivo trae título, subtítulo
     * y una fila vacía antes, pero no se asume cuántas.
     * @param {Celda[][]} filas
     * @returns {number} -1 si no la encuentra.
     */
    function detectarFilaEncabezado(filas) {
        const limite = Math.min((filas || []).length, FILAS_BUSQUEDA_ENCABEZADO);
        for (let i = 0; i < limite; i++) {
            const celdas = (filas[i] || []).map(normalizarEncabezado);
            if (celdas.includes(CLAVES_NORMALIZADAS.registro) && celdas.includes(CLAVES_NORMALIZADAS.matricula)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Posición de cada columna conocida en la fila de encabezados.
     * @param {Celda[]} encabezados
     * @returns {Object<string, number>}
     */
    function indicesDeColumnas(encabezados) {
        const normal = (encabezados || []).map(normalizarEncabezado);
        /** @type {Object<string, number>} */
        const indices = {};
        Object.entries(CLAVES_NORMALIZADAS).forEach(([clave, titulo]) => {
            const i = normal.indexOf(titulo);
            if (i >= 0) indices[clave] = i;
        });
        return indices;
    }

    /**
     * La hoja "Global"; si no existe o no trae los encabezados, la primera hoja
     * que sí los tenga. Las hojas de resumen (AIFA, FBO, Commander) no tienen
     * esos encabezados y quedan fuera solas.
     * @param {HojaCruda[]} hojas
     */
    function elegirHoja(hojas) {
        const candidatas = (hojas || []).map((hoja) => {
            const i = detectarFilaEncabezado(hoja.filas);
            if (i < 0) return null;
            const indices = indicesDeColumnas(hoja.filas[i]);
            const completa = REQUERIDAS.every((c) => c in indices);
            return completa ? { hoja, filaEncabezado: i, indices } : null;
        });
        const preferida = candidatas.find((c, k) => c && normalizarEncabezado(hojas[k].nombre) === HOJA_PREFERIDA);
        return preferida || candidatas.find(Boolean) || null;
    }

    // ── Calendario sin zona horaria ─────────────────────────────────────────
    // days_from_civil / civil_from_days (H. Hinnant): aritmética entera sobre
    // el calendario gregoriano, sin objetos Date.

    function diasDesdeCivil(anio, mes, dia) {
        const y = mes <= 2 ? anio - 1 : anio;
        const era = Math.floor(y / 400);
        const yoe = y - era * 400;
        const mp = (mes + 9) % 12;
        const doy = Math.floor((153 * mp + 2) / 5) + dia - 1;
        const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
        return era * 146097 + doe - 719468;
    }

    function civilDesdeDias(dias) {
        const z = dias + 719468;
        const era = Math.floor(z / 146097);
        const doe = z - era * 146097;
        const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
        const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
        const mp = Math.floor((5 * doy + 2) / 153);
        const dia = doy - Math.floor((153 * mp + 2) / 5) + 1;
        const mes = mp < 10 ? mp + 3 : mp - 9;
        return { anio: yoe + era * 400 + (mes <= 2 ? 1 : 0), mes, dia };
    }

    const dos = (n) => String(n).padStart(2, '0');

    function textoFecha(anio, mes, dia) {
        return `${String(anio).padStart(4, '0')}-${dos(mes)}-${dos(dia)}`;
    }

    function fechaValida(anio, mes, dia) {
        if (!(anio >= 1990 && anio <= 2100) || !(mes >= 1 && mes <= 12) || !(dia >= 1)) return false;
        const c = civilDesdeDias(diasDesdeCivil(anio, mes, dia));
        return c.anio === anio && c.mes === mes && c.dia === dia;
    }

    function armarInstante(anio, mes, dia, h, mi, s) {
        const fecha = textoFecha(anio, mes, dia);
        if (h === null) return { fecha, hora: null, segundos: null };
        return {
            fecha,
            hora: `${dos(h)}:${dos(mi)}:${dos(s)}`,
            segundos: diasDesdeCivil(anio, mes, dia) * 86400 + h * 3600 + mi * 60 + s
        };
    }

    // Día 25569 de Excel = 1970-01-01. Rango aceptado: 1990-01-01 (32874) a
    // 2100-12-31 (73415); fuera de ahí es otra cosa mal tecleada.
    const SERIE_1970 = 25569;
    const SERIE_MIN = 32874;
    const SERIE_MAX = 73416;

    const RE_FECHA_HORA = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

    /**
     * Fecha y hora de una celda: serie de Excel, texto 'YYYY-MM-DD HH:mm[:ss]'
     * o Date (si alguien leyó el libro con cellDates; se toman sus componentes
     * locales, nunca UTC).
     * @param {Celda} valor
     * @returns {{ok: true, valor: Instante|null} | {ok: false}}
     */
    function leerInstante(valor) {
        if (valor === null || valor === undefined) return { ok: true, valor: null };

        if (valor instanceof Date) {
            if (isNaN(valor.getTime())) return { ok: false };
            const a = valor.getFullYear(); const m = valor.getMonth() + 1; const d = valor.getDate();
            if (!fechaValida(a, m, d)) return { ok: false };
            return { ok: true, valor: armarInstante(a, m, d, valor.getHours(), valor.getMinutes(), valor.getSeconds()) };
        }

        if (typeof valor === 'number') return leerSerie(valor);

        const t = String(valor).trim();
        if (!t) return { ok: true, valor: null };
        if (/^\d+(\.\d+)?$/.test(t)) return leerSerie(Number(t));

        const m = t.match(RE_FECHA_HORA);
        if (!m) return { ok: false };
        const anio = +m[1]; const mes = +m[2]; const dia = +m[3];
        if (!fechaValida(anio, mes, dia)) return { ok: false };
        if (m[4] === undefined) return { ok: true, valor: armarInstante(anio, mes, dia, null) };
        const h = +m[4]; const mi = +m[5]; const s = m[6] === undefined ? 0 : +m[6];
        if (h > 23 || mi > 59 || s > 59) return { ok: false };
        return { ok: true, valor: armarInstante(anio, mes, dia, h, mi, s) };
    }

    /** @param {number} serie */
    function leerSerie(serie) {
        if (!isFinite(serie) || serie < SERIE_MIN || serie >= SERIE_MAX) return { ok: false };
        // Se redondea al segundo: 46235.927083333343 son las 22:15:00 exactas,
        // no las 22:14:59.999.
        const totalSeg = Math.round(serie * 86400);
        const dia = Math.floor(totalSeg / 86400);
        const enDia = totalSeg - dia * 86400;
        const c = civilDesdeDias(dia - SERIE_1970);
        return {
            ok: true,
            valor: armarInstante(c.anio, c.mes, c.dia,
                Math.floor(enDia / 3600), Math.floor((enDia % 3600) / 60), enDia % 60)
        };
    }

    /**
     * Diferencia como intervalo de Postgres 'HH:MM:SS' (las horas pueden pasar
     * de 24). null si falta cualquiera de los dos instantes o su hora.
     * @param {Instante|null} desde
     * @param {Instante|null} hasta
     */
    function intervalo(desde, hasta) {
        if (!desde || !hasta || desde.segundos === null || hasta.segundos === null) return null;
        const diff = hasta.segundos - desde.segundos;
        const abs = Math.abs(diff);
        const h = Math.floor(abs / 3600);
        const m = Math.floor((abs % 3600) / 60);
        const s = abs % 60;
        return `${diff < 0 ? '-' : ''}${dos(h)}:${dos(m)}:${dos(s)}`;
    }

    // ── Números y texto ─────────────────────────────────────────────────────

    /**
     * Entero >= 0. Vacío = 0. Texto que no es número → error (no se inventa).
     * @param {Celda} valor
     * @returns {{ok: true, valor: number} | {ok: false}}
     */
    function leerEntero(valor) {
        if (valor === null || valor === undefined) return { ok: true, valor: 0 };
        let n;
        if (typeof valor === 'number') {
            n = valor;
        } else {
            const t = String(valor).trim();
            if (!t) return { ok: true, valor: 0 };
            if (!/^-?\d+(\.0+)?$/.test(t)) return { ok: false };
            n = Number(t);
        }
        const r = Math.round(n);
        if (!isFinite(n) || Math.abs(n - r) > 1e-6 || r < 0) return { ok: false };
        return { ok: true, valor: r };
    }

    /**
     * Toneladas: vienen como texto ("4.10"). Número con 2 decimales, o null.
     * @param {Celda} valor
     * @returns {{ok: boolean, valor: number|null}}
     */
    function leerToneladas(valor) {
        if (valor === null || valor === undefined) return { ok: true, valor: null };
        const t = String(valor).trim().replace(',', '.');
        if (!t) return { ok: true, valor: null };
        const n = Number(t);
        if (!isFinite(n) || !/^-?\d*\.?\d+$/.test(t)) return { ok: false, valor: null };
        return { ok: true, valor: Math.round(n * 100) / 100 };
    }

    /** @param {Celda} valor @returns {string|null} */
    function texto(valor) {
        if (valor === null || valor === undefined) return null;
        const t = String(valor).trim();
        return t || null;
    }

    /** @param {...Celda} valores @returns {string|null} */
    function primeroNoVacio(...valores) {
        for (const v of valores) {
            const t = texto(v);
            if (t) return t;
        }
        return null;
    }

    /** FIXED_WING → FIJA, ROTARY_WING → ROTATIVA; otro valor, tal cual. */
    function mapearTipoAla(valor) {
        const t = texto(valor);
        if (!t) return null;
        const u = t.toUpperCase();
        if (u === 'FIXED_WING') return 'FIJA';
        if (u === 'ROTARY_WING') return 'ROTATIVA';
        return t;
    }

    /** NATIONAL → NAC, INTERNATIONAL → INT; NAC/INT se respetan; otro, tal cual. */
    function mapearAmbito(valor) {
        const t = texto(valor);
        if (!t) return null;
        const u = t.toUpperCase();
        if (u === 'NATIONAL' || u === 'NAC') return 'NAC';
        if (u === 'INTERNATIONAL' || u === 'INT') return 'INT';
        return t;
    }

    function filaVacia(fila) {
        return !(fila || []).some((c) => texto(c instanceof Date ? 'x' : c) !== null);
    }

    // ── Una fila ────────────────────────────────────────────────────────────

    /**
     * Convierte una fila del Layout en una operación de operaciones_fbo, con
     * sus errores (bloquean) y advertencias (no bloquean). No lanza.
     * @param {Celda[]} fila
     * @param {Object<string, number>} indices
     * @param {number} filaExcel
     * @returns {FilaLayout}
     */
    function mapearFila(fila, indices, filaExcel) {
        const celda = (clave) => (clave in indices ? fila[indices[clave]] : null);
        const registro = texto(celda('registro'));

        /** @type {Incidencia[]} */ const errores = [];
        /** @type {Incidencia[]} */ const advertencias = [];
        const error = (campo, motivo) => errores.push({ filaExcel, registro, tipo: 'ERROR', campo, motivo });
        const advertencia = (campo, motivo) => advertencias.push({ filaExcel, registro, tipo: 'ADVERTENCIA', campo, motivo });

        const instante = (clave) => {
            const crudo = celda(clave);
            const r = leerInstante(crudo);
            if (!r.ok) {
                error(COLUMNAS[clave], `No se pudo interpretar la fecha/hora "${String(crudo).trim()}"`);
                return null;
            }
            return r.valor;
        };
        const entero = (clave) => {
            const crudo = celda(clave);
            const r = leerEntero(crudo);
            if (!r.ok) {
                error(COLUMNAS[clave], `"${String(crudo).trim()}" no es un número entero válido`);
                return 0;
            }
            return r.valor;
        };
        const toneladas = (clave) => {
            const crudo = celda(clave);
            const r = leerToneladas(crudo);
            if (!r.ok) advertencia(COLUMNAS[clave], `"${String(crudo).trim()}" no es un número; se guarda vacío`);
            return r.valor;
        };

        if (!registro) error(COLUMNAS.registro, 'Sin Registro');

        const aterrizaje = instante('aterrizaje');
        const llegadaPlataforma = instante('llegadaPlataforma');
        const finDesembarque = instante('finDesembarque');
        const inicioEmbarque = instante('inicioEmbarque');
        const salidaPosicion = instante('salidaPosicion');
        const despegue = instante('despegue');

        const adultosLlegada = entero('adultosLlegada') + entero('menoresLlegada');
        const infantesLlegada = entero('infantesLlegada');
        const totalSalida = entero('salNacTotal') + entero('salIntTotal');
        const infantesSalida = entero('salNacInfantes') + entero('salIntInfantes');
        const paganTua = entero('salNacTua') + entero('salIntTua');

        let permanencia = null;
        if (llegadaPlataforma && salidaPosicion && llegadaPlataforma.segundos !== null && salidaPosicion.segundos !== null) {
            const min = Math.round((salidaPosicion.segundos - llegadaPlataforma.segundos) / 60);
            permanencia = min >= 0 ? min : null;
        }

        /** @type {OperacionFbo} */
        const operacion = {
            registro,
            operador:               texto(celda('operador')),
            vuelo_operado_por:      texto(celda('prestador')),
            matricula:              texto(celda('matricula')) ? texto(celda('matricula')).toUpperCase() : null,
            tipo_aeronave:          texto(celda('aeronave')),
            tipo_ala:               mapearTipoAla(celda('tipoAla')),
            origen:                 primeroNoVacio(celda('origenOaci'), celda('origenLocal'), celda('origenIata')),
            nac_int_llegada:        mapearAmbito(celda('nacIntLlegada')),
            fecha_aterrizaje:       aterrizaje ? aterrizaje.fecha : null,
            hora_aterrizaje:        aterrizaje ? aterrizaje.hora : null,
            hora_llegada_posicion:  llegadaPlataforma ? llegadaPlataforma.hora : null,
            hora_desembarque:       finDesembarque ? finDesembarque.hora : null,
            tiempo_desembarque:     intervalo(llegadaPlataforma, finDesembarque),
            pax_llegada_adultos:    adultosLlegada,
            pax_llegada_infantes:   infantesLlegada,
            pax_llegada_totales:    adultosLlegada + infantesLlegada,
            destino:                primeroNoVacio(celda('destinoOaci'), celda('destinoLocal'), celda('destinoIata')),
            nac_int_salida:         mapearAmbito(celda('nacIntSalida')),
            fecha_salida_posicion:  salidaPosicion ? salidaPosicion.fecha : null,
            hora_embarque:          inicioEmbarque ? inicioEmbarque.hora : null,
            hora_salida_posicion:   salidaPosicion ? salidaPosicion.hora : null,
            hora_despegue:          despegue ? despegue.hora : null,
            pax_salida_adultos:     Math.max(totalSalida - infantesSalida, 0),
            pax_salida_infantes:    infantesSalida,
            pax_salida_totales:     totalSalida,
            pax_pagan_tua:          paganTua,
            tiempo_embarque:        intervalo(inicioEmbarque, salidaPosicion),
            tiempo_permanencia_min: permanencia,
            uds_traslado_pax:       entero('udsTraslado'),
            uds_acarreo_equipaje:   entero('udsAcarreo'),
            mtow:                   toneladas('mtow'),
            mzfw:                   toneladas('mzfw'),
            oficial_operaciones:    texto(celda('valido'))
        };

        // Salida anterior a la llegada: con hora se comparan instantes; si
        // alguno trae sólo fecha, se comparan fechas.
        const llegada = aterrizaje || llegadaPlataforma;
        if (llegada && salidaPosicion) {
            const antes = (llegada.segundos !== null && salidaPosicion.segundos !== null)
                ? salidaPosicion.segundos < llegada.segundos
                : salidaPosicion.fecha < llegada.fecha;
            if (antes) {
                const fmt = (i) => `${i.fecha}${i.hora ? ` ${i.hora.slice(0, 5)}` : ''}`;
                error(COLUMNAS.salidaPosicion,
                    `La salida (${fmt(salidaPosicion)}) es anterior a la llegada (${fmt(llegada)})`);
            }
        }

        if (!operacion.matricula) advertencia(COLUMNAS.matricula, 'Matrícula vacía');
        if (!aterrizaje) advertencia(COLUMNAS.aterrizaje, 'Sin Aterrizaje: la operación no genera llegada');
        if ((aterrizaje || llegadaPlataforma) && !finDesembarque) advertencia(COLUMNAS.finDesembarque, 'Falta Fin desembarque');
        if (salidaPosicion && !inicioEmbarque) advertencia(COLUMNAS.inicioEmbarque, 'Falta Inicio embarque');
        if (!salidaPosicion) advertencia(COLUMNAS.salidaPosicion, 'Operación abierta (sin Salida posición)');
        if (aterrizaje && !['NAC', 'INT'].includes(operacion.nac_int_llegada)) {
            advertencia(COLUMNAS.nacIntLlegada, `Ámbito de llegada desconocido (${operacion.nac_int_llegada || 'vacío'})`);
        }
        if (salidaPosicion && !['NAC', 'INT'].includes(operacion.nac_int_salida)) {
            advertencia(COLUMNAS.nacIntSalida, `Ámbito de salida desconocido (${operacion.nac_int_salida || 'vacío'})`);
        }

        return { filaExcel, registro, operacion, errores, advertencias };
    }

    // ── El archivo completo ─────────────────────────────────────────────────

    /**
     * Cada hoja de un libro de SheetJS como matriz. SheetJS se recibe como
     * parámetro para que este archivo no dependa de él (en el navegador es
     * window.XLSX; en las pruebas, require('xlsx')).
     *
     * El libro debe leerse SIN cellDates: así las fechas llegan como número
     * de serie y se convierten aquí sin pasar por Date ni por UTC.
     * @param {{SheetNames: string[], Sheets: Object<string, any>}} libro
     * @param {{utils: {sheet_to_json: Function, decode_range: Function}}} XLSX
     * @returns {HojaCruda[]}
     */
    function hojasDesdeLibro(libro, XLSX) {
        return (libro.SheetNames || []).map((nombre) => {
            const hoja = libro.Sheets[nombre];
            const ref = hoja && hoja['!ref'];
            return {
                nombre,
                filas: ref ? XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null, blankrows: true }) : [],
                filaInicial: ref ? XLSX.utils.decode_range(ref).s.r : 0
            };
        });
    }

    /**
     * Lee el Layout. Las filas completamente vacías se ignoran; también las
     * que no traen Registro ni nada que parezca una operación (matrícula o
     * alguna fecha). Una fila con datos de operación pero sin Registro sí se
     * reporta, como error.
     * @param {HojaCruda[]} hojas
     * @returns {ResultadoLayout}
     */
    function parsearLayout(hojas) {
        const eleccion = elegirHoja(hojas);
        if (!eleccion) {
            return {
                hoja: null, filaEncabezado: null, columnasFaltantes: [], filas: [],
                error: 'No se encontró una hoja con los encabezados del Layout '
                     + `(${REQUERIDAS.map((c) => COLUMNAS[c]).join(', ')}).`
            };
        }

        const { hoja, filaEncabezado, indices } = eleccion;
        const base = hoja.filaInicial || 0;
        const columnasFaltantes = Object.keys(COLUMNAS).filter((c) => !(c in indices)).map((c) => COLUMNAS[c]);

        const celdaDe = (fila, clave) => (clave in indices ? fila[indices[clave]] : null);
        const pareceOperacion = (fila) => ['matricula', 'aterrizaje', 'salidaPosicion', 'llegadaPlataforma']
            .some((c) => texto(celdaDe(fila, c) instanceof Date ? 'x' : celdaDe(fila, c)) !== null);

        /** @type {FilaLayout[]} */
        const filas = [];
        hoja.filas.slice(filaEncabezado + 1).forEach((fila, k) => {
            if (filaVacia(fila)) return;
            if (!texto(celdaDe(fila, 'registro')) && !pareceOperacion(fila)) return;
            filas.push(mapearFila(fila, indices, base + filaEncabezado + 2 + k));
        });

        // Registro duplicado dentro del archivo: se bloquean TODAS las
        // ocurrencias, porque no hay forma de saber cuál es la buena.
        /** @type {Map<string, number[]>} */
        const porRegistro = new Map();
        filas.forEach((f) => {
            if (!f.registro) return;
            const lista = porRegistro.get(f.registro) || [];
            lista.push(f.filaExcel);
            porRegistro.set(f.registro, lista);
        });
        filas.forEach((f) => {
            const lista = f.registro ? porRegistro.get(f.registro) : null;
            if (lista && lista.length > 1) {
                f.errores.push({
                    filaExcel: f.filaExcel, registro: f.registro, tipo: 'ERROR', campo: COLUMNAS.registro,
                    motivo: `Registro duplicado en el archivo (filas ${lista.join(', ')})`
                });
            }
        });

        return {
            hoja: hoja.nombre,
            filaEncabezado: base + filaEncabezado + 1,
            columnasFaltantes,
            filas,
            error: null
        };
    }

    // ── Contra lo que ya está guardado ──────────────────────────────────────

    /**
     * @typedef {Object} Coincidencia
     * @property {string} registro            Registro del archivo.
     * @property {string} registro_existente  Operación guardada con otro registro.
     *
     * @typedef {Object} Clasificacion
     * @property {string}      registro
     * @property {boolean}     existe              El registro ya está en la tabla (se reemplaza).
     * @property {string|null} reemplazaRegistro   Operación guardada con otro registro que se reemplaza.
     * @property {string|null} error               Coincidencia ambigua: bloquea la fila.
     */

    /**
     * Decide, para cada fila válida, si es nueva, si reemplaza su mismo
     * registro y si reemplaza una operación guardada con otro registro
     * (misma matrícula + fecha de aterrizaje):
     *   · exactamente una coincidencia → se reemplaza;
     *   · varias → la fila se bloquea por ambigua;
     *   · dos filas del archivo que apuntan a la MISMA operación guardada →
     *     las dos se bloquean (no se puede saber cuál la sustituye).
     * @param {string[]} registros  Registros de las filas válidas.
     * @param {{existentes?: string[], coincidencias?: Coincidencia[]}} previa
     * @returns {Clasificacion[]}
     */
    function clasificarContraBase(registros, previa) {
        const delArchivo = new Set(registros);
        const existentes = new Set((previa && previa.existentes) || []);
        /** @type {Map<string, string[]>} */
        const porRegistro = new Map();
        ((previa && previa.coincidencias) || []).forEach((c) => {
            if (!c || delArchivo.has(c.registro_existente)) return;
            const lista = porRegistro.get(c.registro) || [];
            if (!lista.includes(c.registro_existente)) lista.push(c.registro_existente);
            porRegistro.set(c.registro, lista);
        });

        /** @type {Map<string, string[]>} */
        const reclamadas = new Map();
        porRegistro.forEach((lista, registro) => {
            if (lista.length !== 1) return;
            const quien = reclamadas.get(lista[0]) || [];
            quien.push(registro);
            reclamadas.set(lista[0], quien);
        });

        return registros.map((registro) => {
            const lista = porRegistro.get(registro) || [];
            /** @type {Clasificacion} */
            const r = { registro, existe: existentes.has(registro), reemplazaRegistro: null, error: null };
            if (lista.length > 1) {
                r.error = `Coincide con ${lista.length} operaciones guardadas por matrícula y fecha de aterrizaje `
                        + `(${lista.join(', ')}): ambigua`;
            } else if (lista.length === 1) {
                const otras = (reclamadas.get(lista[0]) || []).filter((x) => x !== registro);
                if (otras.length) {
                    r.error = `La operación guardada ${lista[0]} coincide también con ${otras.join(', ')} del archivo: ambigua`;
                } else {
                    r.reemplazaRegistro = lista[0];
                }
            }
            return r;
        });
    }

    /**
     * Lo que viaja a fbo_importar_operaciones: las columnas de la tabla más
     * `reemplaza_registro` cuando aplica.
     * @param {OperacionFbo} operacion
     * @param {string|null} reemplazaRegistro
     */
    function aPayload(operacion, reemplazaRegistro) {
        const salida = Object.assign({}, operacion);
        if (reemplazaRegistro) salida.reemplaza_registro = reemplazaRegistro;
        return salida;
    }

    // ── Reporte ─────────────────────────────────────────────────────────────

    function celdaCsv(valor) {
        const t = valor === null || valor === undefined ? '' : String(valor);
        return /[",\r\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    }

    /**
     * Reporte de validación en CSV: fila de Excel, registro, tipo, campo y
     * motivo. Sin BOM: lo agrega quien descarga.
     * @param {Incidencia[]} incidencias
     * @returns {string}
     */
    function reporteCsv(incidencias) {
        const encabezado = ['Fila de Excel', 'Registro', 'Tipo', 'Campo', 'Motivo'];
        const lineas = (incidencias || [])
            .slice()
            .sort((a, b) => a.filaExcel - b.filaExcel || (a.tipo === b.tipo ? 0 : a.tipo === 'ERROR' ? -1 : 1))
            .map((i) => [i.filaExcel, i.registro, i.tipo, i.campo, i.motivo].map(celdaCsv).join(','));
        return [encabezado.join(','), ...lineas].join('\r\n');
    }

    /** @param {FilaLayout[]} filas @returns {Incidencia[]} */
    function incidencias(filas) {
        return (filas || []).reduce((acc, f) => acc.concat(f.errores, f.advertencias), []);
    }

    return {
        COLUMNAS, REQUERIDAS,
        normalizarEncabezado, detectarFilaEncabezado, indicesDeColumnas, elegirHoja,
        leerInstante, leerEntero, leerToneladas, intervalo, mapearTipoAla, mapearAmbito,
        mapearFila, hojasDesdeLibro, parsearLayout,
        clasificarContraBase, aPayload,
        incidencias, reporteCsv
    };
});
