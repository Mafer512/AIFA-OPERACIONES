/**
 * Catálogo de aerolíneas: un solo nombre para cada una, en todo el sistema.
 *
 * Los datos operativos traen el nombre como lo escribió quien capturó: "VIVA",
 * "viva", "Viva Aerobus", "VIVA AEROBUS S.A. DE C.V.". Cada variante se contaba
 * aparte, así que en los resúmenes salían dos tarjetas de la misma aerolínea —
 * una con 40 impactos y otra con 1— y la del nombre raro se quedaba sin logo.
 *
 * La tabla `airlines` (Gestión de Datos → Aerolíneas) ya guarda el nombre
 * bueno, sus alias, el logo y el color. Este módulo la carga una vez y ofrece
 * la respuesta a las tres preguntas que se hacen todas las pantallas:
 *
 *      canonico('viva aerobus')  → 'VIVA Aerobus'   (como está en el catálogo)
 *      logo('viva aerobus')      → la URL de su logo
 *      color('viva aerobus')     → su color de marca
 *
 * Si una aerolínea todavía no está en el catálogo, se devuelve el nombre tal
 * como vino: nada se pierde, y en cuanto alguien la dé de alta con su alias, se
 * homologa sola en todas las vistas.
 */
(function (global) {
    'use strict';

    const registros = [];          // filas del catálogo
    const porClave = new Map();    // nombre o alias normalizado -> fila
    let cargado = false;
    let cargando = null;

    /** Sin acentos, sin mayúsculas y sin adornos de razón social. */
    function normalizar(nombre) {
        return String(nombre == null ? '' : nombre)
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/\b(s\.?a\.?\s*de\s*c\.?v\.?|s\.?a\.?p\.?i\.?|s\.?a\.?|inc\.?|ltd\.?|llc\.?|co\.?)\b/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    /** La misma clave sin espacios: "aero union" encuentra a "aerounion". */
    function compacta(nombre) {
        return normalizar(nombre).replace(/\s+/g, '');
    }

    function indexar(fila) {
        const nombres = [fila.name, ...(Array.isArray(fila.aliases) ? fila.aliases : [])];
        nombres.forEach(nombre => {
            const clave = normalizar(nombre);
            if (!clave) return;
            if (!porClave.has(clave)) porClave.set(clave, fila);
            const sinEspacios = compacta(nombre);
            if (sinEspacios && !porClave.has(sinEspacios)) porClave.set(sinEspacios, fila);
        });
        // El código IATA también identifica: "Y4" es Volaris.
        const iata = String(fila.iata || '').trim().toLowerCase();
        if (iata && !porClave.has(iata)) porClave.set(iata, fila);
    }

    /** La fila del catálogo que corresponde a ese nombre, si alguna. */
    function buscar(nombre) {
        const clave = normalizar(nombre);
        if (!clave) return null;
        return porClave.get(clave)
            || porClave.get(compacta(nombre))
            || null;
    }

    /** El nombre bueno. Si no está catalogada, el que vino, limpio de espacios. */
    function canonico(nombre) {
        const fila = buscar(nombre);
        if (fila && fila.name) return fila.name;
        return String(nombre == null ? '' : nombre).trim();
    }

    function logo(nombre) {
        const fila = buscar(nombre);
        return (fila && fila.logo_url) || null;
    }

    function color(nombre) {
        const fila = buscar(nombre);
        return (fila && fila.color) || null;
    }

    function iata(nombre) {
        const fila = buscar(nombre);
        return (fila && fila.iata) || null;
    }

    /** Iniciales para cuando no hay logo: mejor una marca que un renglón de texto. */
    function iniciales(nombre) {
        const limpio = String(nombre == null ? '' : nombre).trim();
        if (!limpio) return 'N/D';
        const codigo = iata(limpio);
        if (codigo) return String(codigo).toUpperCase();
        const palabras = limpio.split(/\s+/).filter(Boolean);
        if (palabras.length === 1) return palabras[0].slice(0, 3).toUpperCase();
        return palabras.slice(0, 3).map(p => p[0]).join('').toUpperCase();
    }

    /** Agrupa cuentas por nombre canónico: dos variantes suman una sola vez. */
    function agrupar(conteos) {
        const total = new Map();
        const entradas = conteos instanceof Map ? [...conteos.entries()] : Object.entries(conteos || {});
        entradas.forEach(([nombre, valor]) => {
            const clave = canonico(nombre) || nombre;
            total.set(clave, (total.get(clave) || 0) + (Number(valor) || 0));
        });
        return total;
    }

    async function cargar(cliente) {
        if (cargado) return registros;
        if (cargando) return cargando;

        cargando = (async () => {
            try {
                const sb = cliente
                    || global.supabaseClient
                    || (typeof global.ensureSupabaseClient === 'function' ? await global.ensureSupabaseClient() : null);
                if (!sb) return registros;

                const { data, error } = await sb
                    .from('airlines')
                    .select('name, aliases, logo_url, color, iata, icao, types')
                    .limit(1000);
                if (error || !Array.isArray(data)) return registros;

                registros.length = 0;
                porClave.clear();
                data.forEach(fila => {
                    if (!fila || !fila.name) return;
                    registros.push(fila);
                    indexar(fila);
                });
                cargado = true;

                // Las vistas ya pintadas se enteran y se redibujan con el nombre
                // bueno y el logo, sin que nadie tenga que recargar la página.
                try {
                    global.dispatchEvent(new CustomEvent('aifa:catalogo-aerolineas', {
                        detail: { total: registros.length },
                    }));
                } catch (_) { /* entornos sin CustomEvent */ }
            } catch (_) { /* el catálogo es una ayuda, nunca un bloqueo */ }
            finally { cargando = null; }
            return registros;
        })();

        return cargando;
    }

    const api = {
        cargar,
        normalizar,
        buscar,
        canonico,
        logo,
        color,
        iata,
        iniciales,
        agrupar,
        get registros() { return registros.slice(); },
        get cargado() { return cargado; },
        /** Solo para pruebas: siembra el catálogo sin tocar la base. */
        _sembrar(filas) {
            registros.length = 0;
            porClave.clear();
            (filas || []).forEach(fila => { registros.push(fila); indexar(fila); });
            cargado = true;
        },
    };

    if (typeof module === 'object' && module.exports) module.exports = api;
    if (global) {
        global.AifaAerolineas = api;
        if (typeof global.document !== 'undefined' && global.document.addEventListener) {
            global.document.addEventListener('DOMContentLoaded', () => { cargar(); });
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
