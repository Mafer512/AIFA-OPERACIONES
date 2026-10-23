/* Núcleo del módulo "Solicitud de Slots → SSIM".
 *
 * Convierte la hoja "Solicitud de Horarios (Slots)" del Comité de Operación y
 * Horarios en un archivo IATA SSIM Capítulo 7 (registros fijos de 200
 * caracteres). No toca el DOM ni guarda nada: recibe la solicitud como objeto
 * y devuelve texto, tramos y hallazgos. Se prueba sin navegador en
 * __tests__/ssim-slots-core.test.js.
 *
 * LO QUE HAY QUE SABER DE LA HOJA
 *
 *   · Cada renglón describe lo que pasa EN NLU: la hora de llegada o la de
 *     salida, la frecuencia y la vigencia, todo en UTC. El otro extremo del
 *     vuelo no viene. Un tramo SSIM sí necesita las dos horas, así que la del
 *     otro aeropuerto se calcula con el tiempo de bloque de la ruta.
 *   · Tipo de movimiento: N alta, D baja, C horario actual que cambia y R el
 *     horario revisado (los C y R van en pareja, C arriba y R abajo).
 *     El SSIM Cap. 7 es una foto del itinerario, no una lista de cambios: sólo
 *     N y R generan tramos. C y D se reportan como "salen del itinerario".
 *   · Los días de la frecuencia son días UTC del evento en NLU. En SSIM el
 *     periodo y los días son los de la SALIDA del primer tramo, en el horario
 *     del archivo (UTC o local). Por eso un renglón de llegada a las 00:47 UTC
 *     puede salir del origen el día anterior: se recorren periodo y días, y la
 *     llegada se marca con variación de fecha.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SsimSlotsCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MOVIMIENTOS = Object.freeze(['N', 'D', 'C', 'R']);
    const GENERAN_TRAMO = Object.freeze(['N', 'R']);
    const MESES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const DIA_MS = 86400000;

    // ── Catálogos de respaldo ───────────────────────────────────────────────
    // El panel los complementa con data/master/*.csv. Aquí sólo va lo
    // indispensable para que la conversión funcione sin red.

    /** ICAO → IATA de los equipos que más se ven en AIFA. */
    const EQUIPOS_ICAO_IATA = Object.freeze({
        A319: '319', A320: '320', A20N: '32N', A321: '321', A21N: '32Q', A318: '318',
        B737: '73G', B738: '738', B739: '739', B38M: '7M8', B39M: '7M9', B763: '763', B764: '764',
        B772: '772', B77W: '77W', B77L: '77L', B788: '788', B789: '789', B744: '744', B748: '74H',
        A332: '332', A333: '333', A339: '339', A359: '359', A35K: '351', A306: 'AB6',
        E170: 'E70', E175: 'E75', E75L: 'E7W', E190: 'E90', E195: 'E95', E290: '290', E295: '295',
        AT72: 'AT7', AT76: 'AT7', AT75: 'AT7', CRJ9: 'CR9', CRJ7: 'CR7', DH8D: 'DH4', SU95: 'SU9'
    });

    // Diferencia UTC por estación. Una función cuando la estación cambia de
    // horario en el año. México no tiene horario de verano desde oct-2022,
    // salvo la franja fronteriza norte, que sigue el calendario de EUA.
    const FIJO = (v) => () => v;
    const EUA = (invierno, verano) => (fecha) => (horarioVeranoEua(fecha) ? verano : invierno);
    const UE = (invierno, verano) => (fecha) => (horarioVeranoUe(fecha) ? verano : invierno);
    const HUSOS = {
        // México, centro (UTC-6 todo el año)
        NLU: FIJO('-0600'), MEX: FIJO('-0600'), TLC: FIJO('-0600'), PBC: FIJO('-0600'), QRO: FIJO('-0600'),
        GDL: FIJO('-0600'), MTY: FIJO('-0600'), BJX: FIJO('-0600'), AGU: FIJO('-0600'), SLP: FIJO('-0600'),
        ZCL: FIJO('-0600'), MLM: FIJO('-0600'), UPN: FIJO('-0600'), PVR: FIJO('-0600'), ZLO: FIJO('-0600'),
        CLQ: FIJO('-0600'), ACA: FIJO('-0600'), ZIH: FIJO('-0600'), OAX: FIJO('-0600'), HUX: FIJO('-0600'),
        PXM: FIJO('-0600'), VER: FIJO('-0600'), MTT: FIJO('-0600'), PAZ: FIJO('-0600'), VSA: FIJO('-0600'),
        CME: FIJO('-0600'), CPE: FIJO('-0600'), MID: FIJO('-0600'), TGZ: FIJO('-0600'), TAP: FIJO('-0600'),
        PQM: FIJO('-0600'), TAM: FIJO('-0600'), CVM: FIJO('-0600'), TRC: FIJO('-0600'), DGO: FIJO('-0600'),
        CUU: FIJO('-0600'), CTM: FIJO('-0500'), CUN: FIJO('-0500'), CZM: FIJO('-0500'), TQO: FIJO('-0500'),
        // México, frontera norte con horario de verano de EUA
        TIJ: EUA('-0800', '-0700'), MXL: EUA('-0800', '-0700'), CJS: EUA('-0700', '-0600'),
        REX: EUA('-0600', '-0500'), MAM: EUA('-0600', '-0500'), NLD: EUA('-0600', '-0500'), PDS: EUA('-0600', '-0500'),
        // México, pacífico (UTC-7 todo el año)
        SJD: FIJO('-0700'), LAP: FIJO('-0700'), LTO: FIJO('-0700'), HMO: FIJO('-0700'), GYM: FIJO('-0700'),
        CEN: FIJO('-0700'), CUL: FIJO('-0700'), MZT: FIJO('-0700'), LMM: FIJO('-0700'), TPQ: FIJO('-0700'),
        // Centro y Sudamérica, Caribe
        BOG: FIJO('-0500'), MDE: FIJO('-0500'), CTG: FIJO('-0500'), PTY: FIJO('-0500'), LIM: FIJO('-0500'),
        UIO: FIJO('-0500'), GYE: FIJO('-0500'), GUA: FIJO('-0600'), SAL: FIJO('-0600'), TGU: FIJO('-0600'),
        SAP: FIJO('-0600'), MGA: FIJO('-0600'), SJO: FIJO('-0600'), BZE: FIJO('-0600'), SDQ: FIJO('-0400'),
        PUJ: FIJO('-0400'), STI: FIJO('-0400'), CCS: FIJO('-0400'), SJU: FIJO('-0400'), HAV: EUA('-0500', '-0400'),
        SCL: FIJO('-0400'), EZE: FIJO('-0300'), GRU: FIJO('-0300'),
        // Estados Unidos y Canadá
        LAX: EUA('-0800', '-0700'), SFO: EUA('-0800', '-0700'), SAN: EUA('-0800', '-0700'), LAS: EUA('-0800', '-0700'),
        ONT: EUA('-0800', '-0700'), OAK: EUA('-0800', '-0700'), SJC: EUA('-0800', '-0700'), SEA: EUA('-0800', '-0700'),
        YVR: EUA('-0800', '-0700'), PHX: FIJO('-0700'), DEN: EUA('-0700', '-0600'), ELP: EUA('-0700', '-0600'),
        DFW: EUA('-0600', '-0500'), IAH: EUA('-0600', '-0500'), HOU: EUA('-0600', '-0500'), AUS: EUA('-0600', '-0500'),
        SAT: EUA('-0600', '-0500'), ORD: EUA('-0600', '-0500'), MDW: EUA('-0600', '-0500'), MSP: EUA('-0600', '-0500'),
        MCI: EUA('-0600', '-0500'), MFE: EUA('-0600', '-0500'), LRD: EUA('-0600', '-0500'), MIA: EUA('-0500', '-0400'),
        FLL: EUA('-0500', '-0400'), MCO: EUA('-0500', '-0400'), ATL: EUA('-0500', '-0400'), JFK: EUA('-0500', '-0400'),
        EWR: EUA('-0500', '-0400'), LGA: EUA('-0500', '-0400'), IAD: EUA('-0500', '-0400'), BOS: EUA('-0500', '-0400'),
        YYZ: EUA('-0500', '-0400'), YUL: EUA('-0500', '-0400'),
        // Europa
        MAD: UE('+0100', '+0200'), BCN: UE('+0100', '+0200'), CDG: UE('+0100', '+0200'), AMS: UE('+0100', '+0200'),
        FRA: UE('+0100', '+0200')
    };

    /** Estaciones de México (para el estatus MCT doméstico/internacional). */
    const ESTACIONES_MX = new Set(['NLU', 'MEX', 'TLC', 'PBC', 'QRO', 'GDL', 'MTY', 'BJX', 'AGU', 'SLP', 'ZCL', 'MLM',
        'UPN', 'PVR', 'ZLO', 'CLQ', 'ACA', 'ZIH', 'OAX', 'HUX', 'PXM', 'VER', 'MTT', 'PAZ', 'VSA', 'CME', 'CPE', 'MID',
        'TGZ', 'TAP', 'PQM', 'TAM', 'CVM', 'TRC', 'DGO', 'CUU', 'CTM', 'CUN', 'CZM', 'TQO', 'TIJ', 'MXL', 'CJS', 'REX',
        'MAM', 'NLD', 'PDS', 'SJD', 'LAP', 'LTO', 'HMO', 'GYM', 'CEN', 'CUL', 'MZT', 'LMM', 'TPQ']);

    /** Tiempos de bloque de referencia (min), tomados del itinerario Volaris oct-2026 en NLU. */
    const BLOQUES_REFERENCIA = Object.freeze({
        'GDL-NLU': 75, 'NLU-GDL': 74, 'CUN-NLU': 134, 'NLU-CUN': 135, 'MID-NLU': 110, 'NLU-MID': 107,
        'SJD-NLU': 120, 'NLU-SJD': 126, 'LAP-NLU': 127, 'NLU-LAP': 133, 'TIJ-NLU': 200, 'NLU-TIJ': 200,
        'BOG-NLU': 293, 'NLU-BOG': 277
    });

    // ── Fechas ──────────────────────────────────────────────────────────────

    function nthDomingo(anio, mes, n) {
        const primero = new Date(Date.UTC(anio, mes, 1));
        return new Date(Date.UTC(anio, mes, 1 + ((7 - primero.getUTCDay()) % 7) + 7 * (n - 1)));
    }
    function ultimoDomingo(anio, mes) {
        const ultimo = new Date(Date.UTC(anio, mes + 1, 0));
        return new Date(ultimo.getTime() - ultimo.getUTCDay() * DIA_MS);
    }
    /** 2o domingo de marzo al 1er domingo de noviembre. */
    function horarioVeranoEua(iso) {
        const f = isoADate(iso);
        const a = f.getUTCFullYear();
        return f >= nthDomingo(a, 2, 2) && f < nthDomingo(a, 10, 1);
    }
    /** Último domingo de marzo al último domingo de octubre. */
    function horarioVeranoUe(iso) {
        const f = isoADate(iso);
        const a = f.getUTCFullYear();
        return f >= ultimoDomingo(a, 2) && f < ultimoDomingo(a, 9);
    }

    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const isoADate = (iso) => new Date(`${iso}T00:00:00Z`);
    const dateAIso = (d) => d.toISOString().slice(0, 10);
    const sumarDias = (iso, n) => dateAIso(new Date(isoADate(iso).getTime() + n * DIA_MS));
    /** 1 = lunes … 7 = domingo, como en SSIM. */
    const diaSsim = (iso) => ((isoADate(iso).getUTCDay() + 6) % 7) + 1;
    const fechaSsim = (iso) => {
        const d = isoADate(iso);
        return `${pad(d.getUTCDate())}${MESES[d.getUTCMonth()]}${pad(d.getUTCFullYear() % 100)}`;
    };
    const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');

    /**
     * Acepta lo que llega de una captura o de Excel: 16/10/26, 16/10/2026,
     * 2026-10-16, 16OCT26, un número de serie de Excel o un Date. Devuelve
     * aaaa-mm-dd o '' si no es una fecha real. Nunca usa la zona del equipo:
     * armar la fecha con hora local corre un día en México después de las 18:00.
     */
    function normalizarFecha(valor) {
        if (valor === null || valor === undefined || valor === '') return '';
        if (valor instanceof Date && !isNaN(valor)) {
            return `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`;
        }
        if (typeof valor === 'number' && valor > 20000 && valor < 80000) {
            return dateAIso(new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * DIA_MS));
        }
        const s = String(valor).trim().toUpperCase();
        let a, m, d;
        let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
        if (r) { a = +r[1]; m = +r[2]; d = +r[3]; }
        else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
            d = +r[1]; m = +r[2]; a = r[3].length === 2 ? 2000 + +r[3] : +r[3];
        } else if ((r = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(s)) && MESES.includes(r[2])) {
            d = +r[1]; m = MESES.indexOf(r[2]) + 1; a = 2000 + +r[3];
        } else if ((r = /^(\d{2})(\d{2})(\d{2})$/.exec(s))) {
            d = +r[1]; m = +r[2]; a = 2000 + +r[3];
        } else return '';
        if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(a, m, 0)).getUTCDate()) return '';
        return `${a}-${pad(m)}-${pad(d)}`;
    }

    /** "2257", "22:57", "2:5"→'', 0.95625 (Excel) → "2257". Devuelve HHMM o ''. */
    function normalizarHora(valor) {
        if (valor === null || valor === undefined || valor === '') return '';
        if (typeof valor === 'number' && valor >= 0 && valor < 1) {
            const min = Math.round(valor * 1440) % 1440;
            return pad(Math.floor(min / 60)) + pad(min % 60);
        }
        const s = String(valor).trim();
        let r = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
        if (!r) r = /^(\d{1,2})(\d{2})$/.exec(s.padStart(3, '0'));
        if (!r) return '';
        const h = +r[1], m = +r[2];
        if (h > 23 || m > 59) return '';
        return pad(h) + pad(m);
    }

    /** "1 3 5 7", "1.3.5.7", "_ _ _ _ 5 _ _", ["", "", 3] → "1357". */
    function normalizarDias(valor) {
        const texto = Array.isArray(valor) ? valor.join(' ') : String(valor === null || valor === undefined ? '' : valor);
        const set = new Set(texto.replace(/[^1-7]/g, '').split(''));
        return [1, 2, 3, 4, 5, 6, 7].filter((d) => set.has(String(d))).join('');
    }
    const diasSsim = (dias) => [1, 2, 3, 4, 5, 6, 7].map((d) => (dias.includes(String(d)) ? String(d) : ' ')).join('');

    const minutosHora = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(2, 4);
    const horaMinutos = (min) => pad(Math.floor(min / 60)) + pad(min % 60);
    const minutosHuso = (h) => (h[0] === '-' ? -1 : 1) * (+h.slice(1, 3) * 60 + +h.slice(3, 5));
    const husoValido = (h) => /^[+-](0\d|1[0-4])[0-5]\d$/.test(String(h || ''));

    /** "-600", "-6", "+0530" → "-0600" / "+0530", o '' si no se entiende. */
    function normalizarHuso(valor) {
        const s = String(valor === null || valor === undefined ? '' : valor).trim().replace(':', '');
        const r = /^([+-]?)(\d{1,4})$/.exec(s);
        if (!r) return '';
        const n = r[2].length <= 2 ? r[2].padStart(2, '0') + '00' : r[2].padStart(4, '0');
        const h = (r[1] || '+') + n;
        return husoValido(h) ? h : '';
    }

    /** Temporada IATA de una fecha: verano desde el último domingo de marzo, invierno desde el último de octubre. */
    function temporadaIata(iso) {
        const f = isoADate(iso);
        const a = f.getUTCFullYear();
        const yy = (n) => pad(n % 100);
        if (f >= ultimoDomingo(a, 9)) return `W${yy(a)}`;
        if (f >= ultimoDomingo(a, 2)) return `S${yy(a)}`;
        return `W${yy(a - 1)}`;
    }

    // ── Modelo ──────────────────────────────────────────────────────────────

    function filaVacia() {
        return {
            mov: '', linea: '', vueloLlega: '', vueloSale: '', equipo: '', horaLlega: '', horaSale: '',
            origen: '', destino: '', dias: '', desde: '', hasta: '', tipoLlega: '', tipoSale: '', slot: '', obs: ''
        };
    }

    function nuevaSolicitud() {
        const hoy = new Date();
        return {
            id: `sol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            encabezado: {
                aerolinea: '', iata: '', representante: '', telOficina: '', telCelular: '',
                fecha: `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`,
                pagina: '', revision: '', control: ''
            },
            opciones: { estacion: 'NLU', modoHora: 'U', estatus: 'P' },
            filas: [filaVacia()],
            bloques: {},
            husos: {}
        };
    }

    const texto = (v) => String(v === null || v === undefined ? '' : v).trim();
    const mayus = (v) => texto(v).toUpperCase();

    /** Deja un renglón en la forma canónica que usa el resto del núcleo. */
    function normalizarFila(f) {
        const v = Object.assign(filaVacia(), f || {});
        return {
            mov: mayus(v.mov).slice(0, 1),
            linea: mayus(v.linea).replace(/[^A-Z0-9]/g, ''),
            vueloLlega: mayus(v.vueloLlega).replace(/\s+/g, ''),
            vueloSale: mayus(v.vueloSale).replace(/\s+/g, ''),
            equipo: mayus(v.equipo).replace(/[\s-]+/g, ''),
            horaLlega: normalizarHora(v.horaLlega) || texto(v.horaLlega),
            horaSale: normalizarHora(v.horaSale) || texto(v.horaSale),
            origen: mayus(v.origen),
            destino: mayus(v.destino),
            dias: normalizarDias(v.dias),
            desde: normalizarFecha(v.desde) || texto(v.desde),
            hasta: normalizarFecha(v.hasta) || texto(v.hasta),
            tipoLlega: mayus(v.tipoLlega).slice(0, 1),
            tipoSale: mayus(v.tipoSale).slice(0, 1),
            slot: texto(v.slot),
            obs: texto(v.obs)
        };
    }

    const filaEnBlanco = (f) => !Object.values(normalizarFila(f)).some((x) => x !== '');

    // ── Lectura de Excel / portapapeles ─────────────────────────────────────

    /**
     * Renglones de la hoja en el orden de columnas del formato del COyH:
     * Mov, Línea, Vuelo llega, Vuelo sale, Equipo, Hora llega, Hora sale,
     * Origen, Destino, 7 columnas de frecuencia, Desde, Hasta, Tipo llega,
     * Tipo sale, No. slot, Observaciones. Si la frecuencia viene en una sola
     * celda ("_ _ _ _ 5 _ _"), se acepta igual.
     */
    function filaDesdeCeldas(c) {
        const celdas = c.map((x) => (x === null || x === undefined ? '' : x));
        while (celdas.length && texto(celdas[celdas.length - 1]) === '') celdas.pop();
        if (celdas.length < 11) return null;
        const pasaDias = celdas.length >= 19 ? 7 : 1;
        const base = 9 + pasaDias;
        return normalizarFila({
            mov: celdas[0], linea: celdas[1], vueloLlega: celdas[2], vueloSale: celdas[3], equipo: celdas[4],
            horaLlega: celdas[5], horaSale: celdas[6], origen: celdas[7], destino: celdas[8],
            dias: celdas.slice(9, base),
            desde: celdas[base], hasta: celdas[base + 1], tipoLlega: celdas[base + 2], tipoSale: celdas[base + 3],
            slot: celdas[base + 4], obs: celdas.slice(base + 5).filter((x) => texto(x)).join(' ')
        });
    }

    /** Texto copiado de Excel/Sheets (tabuladores y saltos de línea) → renglones. */
    function parsearPegado(textoPegado) {
        return String(textoPegado || '')
            .replace(/\r/g, '')
            .split('\n')
            .map((l) => l.split('\t'))
            .filter((c) => c.some((x) => texto(x)))
            .map(filaDesdeCeldas)
            .filter((f) => f && MOVIMIENTOS.includes(f.mov));
    }

    const sinAcentos = (s) => texto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    /**
     * Hoja completa (matriz de celdas, p. ej. XLSX.utils.sheet_to_json con
     * header:1) → { encabezado, filas }. Los renglones de datos son los que
     * empiezan con N, D, C o R; el encabezado se busca por sus etiquetas.
     */
    function leerHoja(matriz) {
        const encabezado = {};
        const filas = [];
        const etiquetas = [
            [/^l[ií]?n\w*\s*a[eé]?r\w*\s*:?$|^linea aerea:?$/, 'aerolinea'],
            [/^represent/, 'representante'],
            [/^tel\w*\s*ofic/, 'telOficina'],
            [/^tel\w*\s*cel/, 'telCelular'],
            [/^fecha\s*:?$/, 'fecha'],
            [/^pagina\s*:?$/, 'pagina'],
            [/^revision\s*:?$/, 'revision'],
            [/^no\.?\s*(de\s*)?control\s*:?$/, 'control']
        ];
        (matriz || []).forEach((renglon) => {
            const celdas = (renglon || []).map((x) => (x === null || x === undefined ? '' : x));
            const primera = celdas.findIndex((x) => texto(x) !== '');
            if (primera < 0) return;
            if (MOVIMIENTOS.includes(mayus(celdas[primera])) && celdas.slice(primera).filter((x) => texto(x)).length >= 6) {
                // Las hojas suelen traer las 7 casillas de frecuencia; si alguna
                // celda combinada se perdió, se reconstruye por posición.
                const f = filaDesdeCeldas(celdas.slice(primera));
                if (f) filas.push(f);
                return;
            }
            celdas.forEach((c, i) => {
                const etiqueta = sinAcentos(c).replace(/\s+/g, ' ');
                const hallada = etiquetas.find(([re]) => re.test(etiqueta));
                if (!hallada || encabezado[hallada[1]]) return;
                const valor = celdas.slice(i + 1).find((x) => texto(x) !== '');
                if (valor !== undefined) encabezado[hallada[1]] = hallada[1] === 'fecha' ? normalizarFecha(valor) : texto(valor);
            });
        });
        return { encabezado, filas };
    }

    // ── Conversión ──────────────────────────────────────────────────────────

    /** Equipo capturado (A320, A20N, 320, 32N…) → código IATA de 3 caracteres. */
    function equipoIata(codigo, catalogo) {
        const c = mayus(codigo).replace(/[\s-]+/g, '');
        if (!c) return '';
        const cat = catalogo || {};
        if (cat.icaoAIata && cat.icaoAIata[c]) return cat.icaoAIata[c];
        if (EQUIPOS_ICAO_IATA[c]) return EQUIPOS_ICAO_IATA[c];
        if (c.length === 3 && (!cat.iata || cat.iata.has(c))) return c;
        return '';
    }

    /** Diferencia UTC de una estación en una fecha. La captura del usuario manda. */
    function husoEstacion(estacion, iso, husosCapturados) {
        const propio = husosCapturados && normalizarHuso(husosCapturados[estacion]);
        if (propio) return propio;
        const regla = HUSOS[estacion];
        return regla ? regla(iso) : '';
    }

    const esMexicana = (estacion, catalogo) => {
        const paises = catalogo && catalogo.paises;
        if (paises && paises[estacion]) return /mexic|méxic/i.test(paises[estacion]);
        return ESTACIONES_MX.has(estacion);
    };

    function bloqueRuta(ruta, bloquesCapturados) {
        const propio = bloquesCapturados && Number(bloquesCapturados[ruta]);
        if (propio > 0) return Math.round(propio);
        return BLOQUES_REFERENCIA[ruta] || 0;
    }

    /** "9212" → { numero: '9212', sufijo: '' }; "9212A" → sufijo A. */
    function partirVuelo(v) {
        // El prefijo de aerolínea sólo cuenta si tiene letra ("VB9212", "Y41290"): "9212" es un número de vuelo.
        const r = /^([A-Z]{2}[A-Z]?|[A-Z]\d|\d[A-Z])?(\d{1,4})([A-Z]?)$/.exec(mayus(v).replace(/\s+/g, ''));
        if (!r) return null;
        return { linea: r[1] || '', numero: String(+r[2]), sufijo: r[3] || '' };
    }

    /**
     * Los movimientos de un renglón. Un renglón puede traer sólo llegada, sólo
     * salida, o las dos (escala). Si llegada y salida tienen el mismo número
     * de vuelo es un vuelo directo con escala en NLU: un itinerario de dos
     * tramos. Si los números son distintos, son dos itinerarios separados.
     */
    function movimientosDeFila(f, ctx) {
        const est = ctx.estacion;
        const out = [];
        const llega = f.vueloLlega ? partirVuelo(f.vueloLlega) : null;
        const sale = f.vueloSale ? partirVuelo(f.vueloSale) : null;
        const tLlega = f.horaLlega ? minutosHora(f.horaLlega) : null;
        let tSale = f.horaSale ? minutosHora(f.horaSale) : null;
        const tramoLlegada = llega && {
            tipo: 'LLEGA', vuelo: llega, origen: f.origen, destino: est, servicio: f.tipoLlega || 'J',
            arrAbs: tLlega, depAbs: tLlega - bloqueRuta(`${f.origen}-${est}`, ctx.bloques), ruta: `${f.origen}-${est}`
        };
        if (llega && sale && tLlega !== null && tSale !== null && tSale < tLlega) tSale += 1440;
        const tramoSalida = sale && {
            tipo: 'SALE', vuelo: sale, origen: est, destino: f.destino, servicio: f.tipoSale || 'J',
            depAbs: tSale, arrAbs: tSale + bloqueRuta(`${est}-${f.destino}`, ctx.bloques), ruta: `${est}-${f.destino}`
        };
        const mismoVuelo = llega && sale && llega.numero === sale.numero && llega.sufijo === sale.sufijo &&
            (llega.linea || f.linea) === (sale.linea || f.linea);
        if (mismoVuelo) out.push([tramoLlegada, tramoSalida]);
        else {
            if (tramoLlegada) out.push([tramoLlegada]);
            if (tramoSalida) out.push([tramoSalida]);
        }
        return out;
    }

    /** Lleva un itinerario (1 o 2 tramos, en minutos UTC desde el día del renglón) al horario del archivo. */
    function convertirItinerario(tramos, f, ctx) {
        const huso = (est) => husoEstacion(est, f.desde, ctx.husos);
        const enArchivo = (est) => (ctx.modoHora === 'L' ? minutosHuso(huso(est) || '+0000') : 0);
        const primero = tramos[0];
        const corrimiento = Math.floor((primero.depAbs + enArchivo(primero.origen)) / 1440);
        const desde = sumarDias(f.desde, corrimiento);
        const hasta = sumarDias(f.hasta, corrimiento);
        const dias = normalizarDias(f.dias.split('').map((d) => ((+d - 1 + corrimiento) % 7 + 7) % 7 + 1).join(''));
        return tramos.map((t, i) => {
            const dep = t.depAbs + enArchivo(t.origen) - corrimiento * 1440;
            const arr = t.arrAbs + enArchivo(t.destino) - corrimiento * 1440;
            const varSal = Math.floor(dep / 1440);
            const varLle = Math.floor(arr / 1440);
            return Object.assign({}, t, {
                leg: pad(i + 1),
                desde, hasta, dias,
                std: horaMinutos(dep - varSal * 1440),
                sta: horaMinutos(arr - varLle * 1440),
                varSalida: varSal, varLlegada: varLle,
                husoOrigen: huso(t.origen), husoDestino: huso(t.destino),
                bloque: t.arrAbs - t.depAbs, corrimiento
            });
        });
    }

    const varFecha = (n) => (n === 0 ? '0' : n < 0 ? 'A' : String(n));

    /**
     * Revisa la solicitud y arma los tramos. Devuelve todo lo que el panel
     * necesita para pintar: hallazgos por renglón, tramos SSIM y movimientos
     * que salen del itinerario (C y D).
     */
    function analizar(solicitud, catalogo) {
        const sol = solicitud || nuevaSolicitud();
        const enc = sol.encabezado || {};
        const op = Object.assign({ estacion: 'NLU', modoHora: 'U', estatus: 'P' }, sol.opciones || {});
        const ctx = { estacion: mayus(op.estacion) || 'NLU', modoHora: op.modoHora === 'L' ? 'L' : 'U', bloques: sol.bloques || {}, husos: sol.husos || {} };
        const errores = [];
        const avisos = [];
        const err = (fila, msg) => errores.push({ fila, msg });
        const aviso = (fila, msg) => avisos.push({ fila, msg });
        const rutasFaltantes = new Set();
        const husosFaltantes = new Set();
        const rutas = new Map();
        const estaciones = new Set([ctx.estacion]);
        const itinerarios = [];
        const salen = [];

        const filas = (sol.filas || []).map(normalizarFila);
        const iataEnc = mayus(enc.iata).replace(/[^A-Z0-9]/g, '');
        if (!filas.some((f) => !filaEnBlanco(f))) err(null, 'La solicitud no tiene renglones.');
        if (iataEnc && !/^[A-Z0-9]{2}[A-Z]?$/.test(iataEnc)) err(null, `Código IATA de aerolínea inválido: "${iataEnc}".`);

        filas.forEach((f, i) => {
            const n = i + 1;
            if (filaEnBlanco(f)) return;
            if (!MOVIMIENTOS.includes(f.mov)) err(n, 'Tipo de movimiento debe ser N, D, C o R.');
            const linea = f.linea || iataEnc;
            if (!/^[A-Z0-9]{2}[A-Z]?$/.test(linea)) err(n, 'Falta la línea aérea (código IATA de 2 caracteres).');
            if (!f.vueloLlega && !f.vueloSale) err(n, 'Falta el número de vuelo (llega o sale).');
            if (f.vueloLlega && !partirVuelo(f.vueloLlega)) err(n, `Número de vuelo de llegada inválido: "${f.vueloLlega}".`);
            if (f.vueloSale && !partirVuelo(f.vueloSale)) err(n, `Número de vuelo de salida inválido: "${f.vueloSale}".`);
            if (f.vueloLlega) {
                if (!/^\d{4}$/.test(f.horaLlega)) err(n, 'Falta o es inválida la hora de llegada (HHMM UTC).');
                if (!/^[A-Z]{3}$/.test(f.origen)) err(n, 'Falta el origen (código IATA de 3 letras).');
                if (f.origen === ctx.estacion) err(n, `El origen de una llegada no puede ser ${ctx.estacion}.`);
            } else if (f.horaLlega || f.origen) aviso(n, 'Hay hora u origen de llegada pero no número de vuelo de llegada.');
            if (f.vueloSale) {
                if (!/^\d{4}$/.test(f.horaSale)) err(n, 'Falta o es inválida la hora de salida (HHMM UTC).');
                if (!/^[A-Z]{3}$/.test(f.destino)) err(n, 'Falta el destino (código IATA de 3 letras).');
                if (f.destino === ctx.estacion) err(n, `El destino de una salida no puede ser ${ctx.estacion}.`);
            } else if (f.horaSale || f.destino) aviso(n, 'Hay hora o destino de salida pero no número de vuelo de salida.');
            if (!f.dias) err(n, 'Falta la frecuencia (días 1 a 7).');
            const fechasOk = /^\d{4}-\d{2}-\d{2}$/.test(f.desde) && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta);
            if (!fechasOk) err(n, 'Vigencia inválida (dd/mm/aa).');
            else if (f.desde > f.hasta) err(n, 'La vigencia "desde" es posterior a "hasta".');
            if (!f.equipo) err(n, 'Falta el equipo de vuelo.');
            else if (!equipoIata(f.equipo, catalogo)) err(n, `Equipo "${f.equipo}" sin equivalencia IATA (usa p. ej. A320, A20N, B738 o el código IATA 320, 32N, 738).`);
            [['tipoLlega', f.vueloLlega], ['tipoSale', f.vueloSale]].forEach(([k, hay]) => {
                if (hay && f[k] && !/^[A-Z]$/.test(f[k])) err(n, 'Tipo de servicio inválido (J, C, F, H, G…).');
            });
            if (catalogo && catalogo.iata && f.equipo && equipoIata(f.equipo, catalogo) && !catalogo.iata.has(equipoIata(f.equipo, catalogo))) {
                aviso(n, `El equipo ${equipoIata(f.equipo, catalogo)} no está en el catálogo de aeronaves.`);
            }
            [f.origen, f.destino].forEach((e) => {
                if (e && catalogo && catalogo.paises && !catalogo.paises[e] && /^[A-Z]{3}$/.test(e)) aviso(n, `La estación ${e} no está en el catálogo de aeropuertos.`);
            });

            // Pareja C → R
            if (f.mov === 'C') {
                const sig = filas[i + 1];
                if (!sig || sig.mov !== 'R') aviso(n, 'Un cambio (C) debe ir seguido de su revisión (R).');
                else {
                    const vC = f.vueloLlega || f.vueloSale, vR = sig.vueloLlega || sig.vueloSale;
                    if (vC && vR && vC !== vR && !/vlo|vuelo|n[uú]m/i.test(f.obs + ' ' + sig.obs)) {
                        aviso(n + 1, `La revisión cambia el número de vuelo ${vC} → ${vR} sin observación que lo explique.`);
                    }
                }
            }
            if (f.mov === 'R' && (!filas[i - 1] || filas[i - 1].mov !== 'C')) aviso(n, 'Una revisión (R) debe ir debajo del cambio (C) que modifica.');

            if (!fechasOk || !f.dias) return;
            // Primer y último día de la vigencia deben ser días de operación.
            const primeroOpera = f.dias.includes(String(diaSsim(f.desde)));
            const ultimoOpera = f.dias.includes(String(diaSsim(f.hasta)));
            let fd = f.desde, fh = f.hasta;
            while (fd <= fh && !f.dias.includes(String(diaSsim(fd)))) fd = sumarDias(fd, 1);
            while (fh >= fd && !f.dias.includes(String(diaSsim(fh)))) fh = sumarDias(fh, -1);
            if (fd > fh) { err(n, 'La frecuencia no cae en ningún día de la vigencia.'); return; }
            if (!primeroOpera || !ultimoOpera) {
                aviso(n, `La vigencia ${fechaCorta(f.desde)}–${fechaCorta(f.hasta)} no empieza/termina en día de operación; se ajusta a ${fechaCorta(fd)}–${fechaCorta(fh)}.`);
            }
            if (errores.some((e) => e.fila === n)) return;

            const fAjustada = Object.assign({}, f, { desde: fd, hasta: fh, linea });
            movimientosDeFila(fAjustada, ctx).forEach((tramos) => {
                let completo = true;
                tramos.forEach((t) => {
                    estaciones.add(t.origen); estaciones.add(t.destino);
                    if (!rutas.has(t.ruta)) rutas.set(t.ruta, { ruta: t.ruta, bloque: bloqueRuta(t.ruta, ctx.bloques), filas: [] });
                    rutas.get(t.ruta).filas.push(n);
                    if (!bloqueRuta(t.ruta, ctx.bloques)) { rutasFaltantes.add(t.ruta); completo = false; }
                    [t.origen, t.destino].forEach((e) => {
                        if (!husoEstacion(e, fd, ctx.husos)) { husosFaltantes.add(e); completo = false; }
                    });
                });
                const convertido = completo ? convertirItinerario(tramos, fAjustada, ctx) : null;
                const registro = {
                    fila: n, mov: f.mov, linea: (tramos[0].vuelo.linea || linea), vuelo: tramos[0].vuelo.numero, sufijo: tramos[0].vuelo.sufijo,
                    equipo: equipoIata(f.equipo, catalogo), tramos: convertido, slot: f.slot, obs: f.obs,
                    desdeUtc: fd, hastaUtc: fh, diasUtc: f.dias, tramosUtc: tramos
                };
                if (GENERAN_TRAMO.includes(f.mov)) itinerarios.push(registro);
                else salen.push(registro);
            });
        });

        [...rutasFaltantes].sort().forEach((r) => err(null, `Falta el tiempo de bloque de la ruta ${r} (minutos).`));
        [...husosFaltantes].sort().forEach((e) => err(null, `Falta la diferencia UTC de ${e} (p. ej. -0600).`));

        // Diferencia UTC que cambia dentro de la vigencia (frontera norte, EUA, Europa).
        itinerarios.concat(salen).forEach((it) => {
            (it.tramos || []).forEach((t) => {
                [[t.origen, t.husoOrigen], [t.destino, t.husoDestino]].forEach(([e, h]) => {
                    const alFinal = husoEstacion(e, it.hastaUtc, ctx.husos);
                    if (h && alFinal && h !== alFinal) {
                        aviso(it.fila, `${e} cambia de UTC${h} a UTC${alFinal} dentro de la vigencia; conviene partir el renglón en la fecha del cambio de horario.`);
                    }
                });
            });
        });

        // IVI: cada itinerario del mismo vuelo es una variación (01, 02…), en orden de fecha.
        const porVuelo = new Map();
        itinerarios.filter((it) => it.tramos).sort((a, b) =>
            (a.linea + a.vuelo + a.sufijo).localeCompare(b.linea + b.vuelo + b.sufijo) ||
            a.tramos[0].desde.localeCompare(b.tramos[0].desde) || a.tramos[0].std.localeCompare(b.tramos[0].std) || a.fila - b.fila
        ).forEach((it) => {
            const k = it.linea + it.vuelo + it.sufijo;
            const nIvi = (porVuelo.get(k) || 0) + 1;
            porVuelo.set(k, nIvi);
            it.ivi = pad(nIvi);
            if (nIvi > 99) err(it.fila, `El vuelo ${k} tiene más de 99 variaciones.`);
        });

        // Operaciones duplicadas: el mismo vuelo saliendo de la misma estación el mismo día.
        const vistos = new Map();
        itinerarios.filter((it) => it.tramos).forEach((it) => {
            expandirItinerario(it).forEach((o) => {
                const k = `${o.linea}${o.vuelo}${o.sufijo}|${o.origen}|${o.fechaSalida}`;
                if (vistos.has(k) && vistos.get(k) !== it.fila) {
                    err(it.fila, `${o.linea}${o.vuelo} sale de ${o.origen} el ${fechaCorta(o.fechaSalida)} también en el renglón ${vistos.get(k)}.`);
                } else vistos.set(k, it.fila);
            });
        });

        return {
            errores: dedupe(errores), avisos: dedupe(avisos), itinerarios, salen,
            rutas: [...rutas.values()].map((r) => Object.assign(r, { bloque: bloqueRuta(r.ruta, ctx.bloques), referencia: !(Number(ctx.bloques[r.ruta]) > 0) && !!BLOQUES_REFERENCIA[r.ruta] })),
            estaciones: [...estaciones].sort().map((e) => ({ estacion: e, huso: husoEstacion(e, filas.find((f) => /^\d{4}-/.test(f.desde))?.desde || dateAIso(new Date()), ctx.husos), capturado: !!normalizarHuso(ctx.husos[e]) })),
            opciones: Object.assign({}, op, { estacion: ctx.estacion, modoHora: ctx.modoHora })
        };
    }

    function dedupe(lista) {
        const vistos = new Set();
        return lista.filter((x) => {
            const k = `${x.fila}|${x.msg}`;
            if (vistos.has(k)) return false;
            vistos.add(k);
            return true;
        });
    }

    /** Operaciones con fecha (fecha de salida de cada tramo, en el horario del archivo). */
    function expandirItinerario(it) {
        const out = [];
        if (!it.tramos) return out;
        const t0 = it.tramos[0];
        for (let d = t0.desde; d <= t0.hasta; d = sumarDias(d, 1)) {
            if (!t0.dias.includes(String(diaSsim(d)))) continue;
            it.tramos.forEach((t) => out.push({
                fila: it.fila, linea: it.linea, vuelo: it.vuelo, sufijo: it.sufijo, origen: t.origen, destino: t.destino,
                fechaSalida: sumarDias(d, t.varSalida), fechaLlegada: sumarDias(d, t.varLlegada), std: t.std, sta: t.sta
            }));
        }
        return out;
    }

    /**
     * Cuántos movimientos en la estación entran (N/R) y salen (C/D) del
     * itinerario por fecha UTC. Sirve para revisar de un vistazo que la
     * solicitud dice lo que la aerolínea quiso decir.
     */
    function resumenPorFecha(analisis) {
        const porFecha = new Map();
        const sumar = (fecha, campo) => {
            if (!porFecha.has(fecha)) porFecha.set(fecha, { fecha, entran: 0, salen: 0 });
            porFecha.get(fecha)[campo]++;
        };
        const recorrer = (lista, campo) => lista.forEach((it) => {
            for (let d = it.desdeUtc; d <= it.hastaUtc; d = sumarDias(d, 1)) {
                if (it.diasUtc.includes(String(diaSsim(d)))) it.tramosUtc.forEach(() => sumar(d, campo));
            }
        });
        recorrer(analisis.itinerarios, 'entran');
        recorrer(analisis.salen, 'salen');
        return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
            .map((r) => Object.assign(r, { dia: diaSsim(r.fecha), neto: r.entran - r.salen }));
    }

    // ── Escritura del archivo ───────────────────────────────────────────────

    function registro() { return Array(200).fill(' '); }
    function poner(reg, desde, hasta, valor, derecha) {
        const largo = hasta - desde + 1;
        let s = String(valor === null || valor === undefined ? '' : valor).toUpperCase();
        if (s.length > largo) s = s.slice(0, largo);
        s = derecha ? s.padStart(largo, ' ') : s.padEnd(largo, ' ');
        for (let i = 0; i < largo; i++) reg[desde - 1 + i] = s[i];
    }
    const sinAcentosMayus = (s) => texto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').toUpperCase();

    /**
     * Genera el SSIM. Si la solicitud tiene errores, no genera nada: un
     * archivo a medias que se carga en un sistema es peor que ningún archivo.
     */
    function generarSsim(solicitud, catalogo, ahora) {
        const a = analizar(solicitud, catalogo);
        if (a.errores.length) return { ok: false, analisis: a, texto: '', nombre: '' };
        const enc = solicitud.encabezado || {};
        const op = a.opciones;
        const fechaHoy = ahora instanceof Date ? ahora : new Date();
        const hoyIso = `${fechaHoy.getFullYear()}-${pad(fechaHoy.getMonth() + 1)}-${pad(fechaHoy.getDate())}`;
        const horaHoy = pad(fechaHoy.getHours()) + pad(fechaHoy.getMinutes());
        const ceros = '0'.repeat(200);
        const lineas = [];
        let serie = 0;
        const emitir = (reg) => { serie++; poner(reg, 195, 200, pad(serie, 6)); lineas.push(reg.join('')); };

        let r = registro();
        poner(r, 1, 1, '1'); poner(r, 2, 35, 'AIRLINE STANDARD SCHEDULE DATA SET'); poner(r, 192, 194, '001');
        emitir(r);
        for (let i = 0; i < 4; i++) lineas.push(ceros);

        const porLinea = new Map();
        a.itinerarios.forEach((it) => {
            if (!porLinea.has(it.linea)) porLinea.set(it.linea, []);
            porLinea.get(it.linea).push(it);
        });
        const lineasAereas = [...porLinea.keys()].sort();
        const creador = sinAcentosMayus(`AIFA COYH${enc.control ? ' CTRL ' + enc.control : ''}${enc.revision ? ' REV ' + enc.revision : ''}`);

        lineasAereas.forEach((linea, idx) => {
            const its = porLinea.get(linea).sort((x, y) =>
                (+x.vuelo - +y.vuelo) || x.sufijo.localeCompare(y.sufijo) || x.ivi.localeCompare(y.ivi));
            const desde = its.map((it) => it.tramos[0].desde).sort()[0];
            const hasta = its.map((it) => it.tramos[0].hasta).sort().slice(-1)[0];
            const tDesde = temporadaIata(desde), tHasta = temporadaIata(hasta);

            r = registro();
            poner(r, 1, 1, '2'); poner(r, 2, 2, op.modoHora); poner(r, 3, 5, linea);
            poner(r, 11, 13, tDesde === tHasta ? tDesde : '');
            poner(r, 15, 21, fechaSsim(desde)); poner(r, 22, 28, fechaSsim(hasta)); poner(r, 29, 35, fechaSsim(hoyIso));
            poner(r, 36, 64, sinAcentosMayus(`SOLICITUD SLOTS ${op.estacion}`));
            poner(r, 72, 72, op.estatus === 'C' ? 'C' : 'P');
            poner(r, 73, 107, creador);
            poner(r, 109, 169, sinAcentosMayus(enc.aerolinea));
            poner(r, 191, 194, horaHoy);
            emitir(r);
            for (let i = 0; i < 4; i++) lineas.push(ceros);

            its.forEach((it) => {
                it.tramos.forEach((t) => {
                    r = registro();
                    poner(r, 1, 1, '3'); poner(r, 2, 2, it.sufijo); poner(r, 3, 5, linea); poner(r, 6, 9, it.vuelo, true);
                    poner(r, 10, 11, it.ivi); poner(r, 12, 13, t.leg); poner(r, 14, 14, t.servicio);
                    poner(r, 15, 21, fechaSsim(t.desde)); poner(r, 22, 28, fechaSsim(t.hasta)); poner(r, 29, 35, diasSsim(t.dias));
                    poner(r, 37, 39, t.origen); poner(r, 40, 43, t.std); poner(r, 44, 47, t.std); poner(r, 48, 52, t.husoOrigen);
                    poner(r, 55, 57, t.destino); poner(r, 58, 61, t.sta); poner(r, 62, 65, t.sta); poner(r, 66, 70, t.husoDestino);
                    poner(r, 73, 75, it.equipo);
                    const dom = (e) => (esMexicana(e, catalogo) ? 'D' : 'I');
                    poner(r, 120, 121, dom(t.origen) === 'D' && dom(t.destino) === 'D' ? 'DD' : 'II');
                    if (t.varSalida !== 0 || t.varLlegada !== 0) poner(r, 193, 194, varFecha(t.varSalida) + varFecha(t.varLlegada));
                    emitir(r);
                });
            });

            r = registro();
            poner(r, 1, 1, '5'); poner(r, 3, 5, linea); poner(r, 6, 12, fechaSsim(hoyIso));
            poner(r, 188, 193, pad(serie, 6)); poner(r, 194, 194, idx === lineasAereas.length - 1 ? 'E' : 'C');
            emitir(r);
            while (lineas.length % 5) lineas.push(ceros);
        });

        const iata = lineasAereas.join('-') || 'XX';
        const ctrl = texto(enc.control).replace(/[^A-Za-z0-9]+/g, '');
        const nombre = `${iata}_${op.estacion}_SOLICITUD_${hoyIso.replace(/-/g, '')}${ctrl ? '_' + ctrl : ''}.ssim`;
        return { ok: true, analisis: a, texto: lineas.join('\r\n') + '\r\n', nombre, registros: serie, tramos: a.itinerarios.reduce((n, it) => n + it.tramos.length, 0) };
    }

    // ── Lectura de un SSIM (para revisar lo generado o un archivo recibido) ─

    function leerSsim(textoSsim) {
        const tramos = [];
        String(textoSsim || '').split(/\r?\n/).forEach((l) => {
            if (l[0] !== '3' || l.length < 194) return;
            const c = (a, b) => l.substring(a - 1, b);
            tramos.push({
                linea: c(3, 5).trim(), vuelo: c(6, 9).trim(), sufijo: c(2, 2).trim(), ivi: c(10, 11), leg: c(12, 13),
                servicio: c(14, 14), desde: c(15, 21), hasta: c(22, 28), dias: c(29, 35), origen: c(37, 39), std: c(44, 47),
                husoOrigen: c(48, 52), destino: c(55, 57), sta: c(58, 61), husoDestino: c(66, 70), equipo: c(73, 75).trim(),
                mct: c(120, 121), varFecha: c(193, 194)
            });
        });
        return tramos;
    }

    return {
        MOVIMIENTOS, GENERAN_TRAMO, EQUIPOS_ICAO_IATA, BLOQUES_REFERENCIA,
        filaVacia, nuevaSolicitud, normalizarFila, filaEnBlanco,
        normalizarFecha, normalizarHora, normalizarDias, normalizarHuso, fechaCorta, fechaSsim, diaSsim, sumarDias,
        temporadaIata, horarioVeranoEua, husoEstacion, equipoIata, bloqueRuta,
        parsearPegado, leerHoja, analizar, expandirItinerario, resumenPorFecha, generarSsim, leerSsim
    };
});
