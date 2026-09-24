/* ==========================================================================
   Catálogo de aerolíneas de carga de la presentación
   --------------------------------------------------------------------------
   Las 58 aerolíneas de la Hoja 1 del libro "BASE DE CARGA", en el orden de la
   tabla de la diapositiva 2, con su modalidad y su logotipo. Los logotipos se
   recortaron de las tarjetas de la presentación original (diapositivas 3 a 6),
   así que son exactamente los que ya se imprimen.

   Los manifiestos no traen el nombre de la Hoja 1: traen lo que resuelve el
   catálogo de aerolíneas de la tabla ("MAS AIR", "AWESOME CARGO", "LA NUEVA
   AEROLÍNEA"...). Cada entrada lleva sus alias, y además se compara por código
   IATA cuando el catálogo de la tabla lo conoce.
   ========================================================================== */
(function () {
    'use strict';

    const A = (nombre, grupo, alias = []) => ({ nombre, grupo, alias });

    /** Orden de la tabla de la diapositiva 2 (Hoja 1 del libro). */
    const AEROLINEAS = [
        A('AERONAVES TSM', 'regular', ['TSM', 'TSM AIRLINES', 'AERONAVES T S M']),
        A('AEROUNIÓN', 'regular', ['AEROUNION', 'AERO UNION', 'AEROTRANSPORTE DE CARGA UNION', 'AERO TRANSPORTES DE CARGA UNION']),
        A('AIR CANADA', 'regular', ['AIR CANADA CARGO']),
        A('AIR FRANCE CARGO', 'regular', ['AIR FRANCE', 'SOCIETE AIR FRANCE']),
        A('AMERIJET', 'regular', ['AMERIJET INTERNATIONAL']),
        A('CARGOJET', 'regular', ['CARGOJET AIRWAYS', 'DHL EXPRESS MEXICO']),
        A('CARGOLUX', 'regular', ['CARGOLUX AIRLINES INTERNATIONAL']),
        A('CATHAY PACIFIC', 'regular', ['CATHAY PACIFIC CARGO', 'CATHAY CARGO', 'CATHAY PACIFIC AIRWAYS']),
        A('COPA CARGO', 'regular', ['LA NUEVA AEROLINEA', 'COPA AIRLINES CARGO']),
        A('DHL GUATEMALA', 'regular', ['DHL AVIATION', 'DHL']),
        A('EMIRATES', 'regular', ['EMIRATES SKYCARGO', 'EMIRATES AIRLINES']),
        A('ESTAFETA', 'regular', ['ESTAFETA CARGA AEREA']),
        A('LUFTHANSA CARGO', 'regular', ['LUFTHANSA']),
        A('MAS DE CARGA', 'regular', ['MAS AIR', 'MASAIR', 'AEROTRANSPORTES MAS DE CARGA']),
        A('QATAR', 'regular', ['QATAR AIRWAYS', 'QATAR AIRWAYS CARGO', 'QATAR CARGO']),
        A('TM AEROLINEAS', 'regular', ['AWESOME CARGO', 'TM AEROLINEAS AWESOME CARGO']),
        A('TURKISH CARGO', 'regular', ['TURKISH AIRLINES', 'TURKISH']),
        A('UPS', 'regular', ['UPS AIRLINES', 'UNITED PARCEL SERVICE']),
        A('AEROMÉXICO', 'mixta', ['AEROMEXICO', 'AEROMEXICO CONNECT', 'AEROLITORAL']),
        A('CONVIASA', 'mixta'),
        A('MEXICANA', 'mixta', ['MEXICANA DE AVIACION']),
        A('VIVA AEROBUS', 'mixta', ['VIVA']),
        A('VOLARIS', 'mixta'),
        A('ABSA', 'fletamento', ['ABSA AEROLINHAS BRASILEIRAS', 'ABSA CARGO']),
        A('ABX AIR', 'fletamento'),
        A('AERO SUCRE', 'fletamento', ['AEROSUCRE']),
        A('AEROLINEAS ARGENTINAS CARGO', 'fletamento', ['AEROLINEAS ARGENTINAS']),
        A('AIR CHINA CARGO', 'fletamento', ['AIR CHINA']),
        A('AIR EXPRESS', 'fletamento', ['AIR EXPRESS CARGO']),
        A('ATLAS AIR INC', 'fletamento', ['ATLAS AIR', 'ATLAS AIR WORLDWIDE']),
        A('BERRY AVIATION INC', 'fletamento', ['BERRY AVIATION']),
        A('CHINA SOUTHERN CARGO', 'fletamento', ['CHINA SOUTHERN AIRLINES', 'CHINA SOUTHERN']),
        A('ETHIOPIAN CARGO', 'fletamento', ['ETHIOPIAN AIRLINES', 'ETHIOPIAN']),
        A('EVERST AIR CARGO', 'fletamento', ['EVERTS AIR CARGO', 'EVERTS']),
        A('FEDEX', 'fletamento', ['FEDEX EXPRESS', 'FEDERAL EXPRESS', 'FEDERAL EXPRESS CORPORATION']),
        A('GALISTAIR', 'fletamento', ['GALISTAIR TRADING LIMITED']),
        A('GLOBAL CROSSING AIRLINES', 'fletamento', ['GLOBALX', 'GLOBAL X']),
        A('IFL GROUP', 'fletamento'),
        A('KALITTA AIR', 'fletamento'),
        A('KALITTA CHARTERS', 'fletamento', ['KALITTA CHARTERS II']),
        A('LAN CARGO', 'fletamento'),
        A('LATAM CARGO', 'fletamento', ['LATAM AIRLINES CARGO']),
        A('LYNDEN AIR CARGO', 'fletamento', ['LYNDEN']),
        A('MCNEELY CHARTER', 'fletamento', ['MCNEELY CHARTER SERVICE', 'MC NEELY CHARTER', 'MCNELLY CHARTER']),
        A('NATIONAL AIR CARGO GROUP', 'fletamento', ['NATIONAL AIRLINES CARGO', 'NATIONAL AIR CARGO', 'NATIONAL AIRLINES']),
        A('SAUDI CARGO', 'fletamento', ['SAUDIA CARGO', 'SAUDIA']),
        A('SILKWAY WEST', 'fletamento', ['SILK WAY WEST AIRLINES', 'SILK WAY WEST', 'SILKWAY WEST AIRLINES']),
        A('SKY LEASE CARGO', 'fletamento', ['SKY LEASE']),
        A('SUPARNA AIRLINES', 'fletamento', ['SUPARNA']),
        A('UKRAINE', 'fletamento', ['UKRAINE AIR ALLIANCE', 'UKRAINE INTERNATIONAL AIRLINES']),
        A('UNIWORLD AIR CARGO', 'fletamento', ['UNIWORLD CARGO', 'UNIWORLD']),
        A('WESTERN GLOBAL', 'fletamento', ['WESTERN GLOBAL AIRLINES']),
        A('USAJET', 'fletamento', ['USA JET', 'USA JET AIRLINES']),
        A('LEGENDS AIRWAYS', 'fletamento', ['LEGENDS']),
        A('CAVOK AIR', 'fletamento', ['CAVOK', 'CAVOK AIRLINES']),
        A('CHINA CARGO AIRLINES', 'fletamento', ['CHINA CARGO']),
        A('AIR ATLANTA EUROPE', 'fletamento', ['AIR ATLANTA']),
        A('AMERISTAR AIR CARGO', 'fletamento', ['AMERISTAR'])
    ];

    /** Qué tarjetas lleva cada diapositiva, en orden (la Hoja 2 del libro). */
    const TARJETAS = {
        3: {
            titulo: 'Aerolíneas que operan con un contrato de Servicios Aeroportuarios:',
            nombres: ['AERONAVES TSM', 'AEROUNIÓN', 'AIR CANADA', 'AIR FRANCE CARGO', 'AMERIJET', 'CARGOJET',
                'CARGOLUX', 'CATHAY PACIFIC', 'DHL GUATEMALA', 'EMIRATES', 'ESTAFETA', 'LUFTHANSA CARGO',
                'MAS DE CARGA', 'QATAR', 'TM AEROLINEAS', 'TURKISH CARGO', 'UPS', 'COPA CARGO']
        },
        4: {
            titulo: 'Aerolíneas que operan en la modalidad de fletamento de carga:',
            nombres: ['ATLAS AIR INC', 'CHINA SOUTHERN CARGO', 'KALITTA AIR', 'ETHIOPIAN CARGO', 'AIR CHINA CARGO',
                'NATIONAL AIR CARGO GROUP', 'SILKWAY WEST', 'USAJET', 'FEDEX', 'BERRY AVIATION INC', 'CAVOK AIR',
                'MCNEELY CHARTER', 'UNIWORLD AIR CARGO', 'UKRAINE', 'LYNDEN AIR CARGO', 'GALISTAIR',
                'SUPARNA AIRLINES', 'KALITTA CHARTERS']
        },
        5: {
            titulo: 'Aerolíneas que operan en la modalidad de carga:',
            nombres: ['CHINA CARGO AIRLINES', 'AIR ATLANTA EUROPE', 'AEROLINEAS ARGENTINAS CARGO', 'LATAM CARGO',
                'WESTERN GLOBAL', 'LEGENDS AIRWAYS', 'LAN CARGO', 'AIR EXPRESS', 'EVERST AIR CARGO', 'IFL GROUP',
                'ABX AIR', 'GLOBAL CROSSING AIRLINES', 'SKY LEASE CARGO', 'AERO SUCRE', 'ABSA', 'SAUDI CARGO',
                'AMERISTAR AIR CARGO']
        },
        6: {
            titulo: 'Aerolíneas que realizan operaciones mixtas (carga y pasajeros):',
            nombres: ['VOLARIS', 'AEROMÉXICO', 'MEXICANA', 'CONVIASA', 'VIVA AEROBUS']
        }
    };

    /** Razones sociales de las diapositivas 8 y 9, tal como están en la baraja. */
    const RAZONES = {
        regular: [
            'Cathay Pacific Airways Limited', 'Turk Hava YOralli., A.O. (Turkish)', 'DHL Guatemala, S.A.',
            'Estafeta Carga Aérea, S.A. de C.V.', 'Societe Air France', 'Cargolux Airlines International, S.A.',
            'DHL Express México, S.A. de C.V. (Cargojet)', 'Emirates',
            'Aerotransportes Mas de Carga S.A. de C.V. (Mas Air)', 'Lufthansa Cargo Aktiengesellschaft',
            'Aero Transportes de Carga Unión, S.A. de C.V.', 'Amerijet International Inc.',
            'Qatar Airways Company Q.C.S.C.', 'United Parcel Service CO.',
            'TM Aerolíneas, S.A. de C.V. (Awesome Cargo)', 'Air Canadá', 'Aeronaves T S M, S.A. de C.V.',
            'La Nueva Aerolínea, S.A. (Copa Cargo)'
        ],
        fletamento: [
            'Absa Aerolinhas Brasileiras', 'ABX Air', 'Air China', 'Atlas Air Inc', 'Berry Aviation',
            'China Southern Airlines', 'Kalitta Air', 'Ethiopian Cargo', 'Federal Express Corporation',
            'Galistair Trading Limited', 'National Air Cargo', 'Silway West Airlines', 'Sky Lease Cargo',
            'Ukraine Air Alliance', 'Western Global Airlines', 'Lan Cargo', 'Mcnelly Charter', 'Usa Jet',
            'Lynden Air Cargo', 'Air Express', 'Everts Air Cargo', 'Kalitta Charters', 'Aero Sucre, S.A.',
            'Uniworld Air Cargo', 'Latam Cargo', 'Aerolíneas Argentinas Cargo', 'Global Crossing Airlines',
            'Saudía Cargo', 'IFL Group', 'Suparna Airlines', 'Legends Airways', 'Cavok Air',
            'China Cargo Airlines', 'Air Atlanta Europe', 'Ameristar Air Cargo'
        ]
    };

    /** Arrendamiento húmedo (wet lease), diapositiva 2. */
    const WET_LEASE = [['AEROUNION', 'AVIANCA CARGO'], ['MAS AIR', 'GALISTAIR']];

    /**
     * Años cerrados antes de que la operación viviera en este sistema. No hay
     * manifiestos capturados de esos años con los que calcularlos.
     */
    const BASE_HISTORICA = [
        { anio: 2023, ops: 6661, ton: 186634.24 },
        { anio: 2024, ops: 15719, ton: 447455.68 },
        { anio: 2025, ops: 14830, ton: 406192.76 }
    ];

    /* ── utilidades ─────────────────────────────────────────────────────── */

    const normaliza = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

    const slug = nombre => normaliza(nombre).toLowerCase().replace(/ /g, '-');

    const logoDe = nombre => `images/presentacion-carga/logos/${slug(nombre)}.png`;

    /** Kilos a toneladas truncadas a dos decimales, como la columna J del libro. */
    const trunc2 = kg => Math.trunc((Number(kg) || 0) / 10 + 1e-7) / 100;

    const porNombre = new Map(AEROLINEAS.map(a => [a.nombre, a]));

    function iataDe(nombre) {
        try {
            const meta = typeof window._conciResolveAirlineMeta === 'function'
                ? window._conciResolveAirlineMeta(nombre) : null;
            return meta && meta.iata ? String(meta.iata).toUpperCase() : '';
        } catch (_) { return ''; }
    }

    let indice = null;

    /**
     * Índice de claves → entrada. Se arma la primera vez que se usa, cuando el
     * catálogo de aerolíneas de la tabla ya cargó y los IATA se pueden resolver.
     */
    function construirIndice() {
        const nombres = new Map();
        const iatas = new Map();
        for (const a of AEROLINEAS) {
            for (const clave of [a.nombre, ...a.alias]) {
                nombres.set(normaliza(clave), a);
                const iata = iataDe(clave);
                if (iata && !iatas.has(iata)) iatas.set(iata, a);
            }
        }
        return { nombres, iatas };
    }

    /** La entrada del catálogo que corresponde a un nombre capturado, o null. */
    function entradaDe(nombre, iata) {
        if (!indice) indice = construirIndice();
        const directa = indice.nombres.get(normaliza(nombre));
        if (directa) return directa;
        const codigo = String(iata || iataDe(nombre) || '').toUpperCase();
        return (codigo && indice.iatas.get(codigo)) || null;
    }

    /**
     * Reparte lo capturado por aerolínea entre las entradas del catálogo.
     * Lo que no casa con ninguna se devuelve aparte, para no esconderlo.
     */
    function cifras(porAerolinea) {
        const catalogo = new Map(AEROLINEAS.map(a => [a.nombre, { ops: 0, kg: 0, hay: false }]));
        const sinCatalogo = [];
        for (const [nombre, v] of porAerolinea || []) {
            const e = entradaDe(nombre, v && v.iata);
            if (!e) { sinCatalogo.push({ nombre, ops: v.ops, kg: v.kg }); continue; }
            const acc = catalogo.get(e.nombre);
            acc.ops += v.ops; acc.kg += v.kg; acc.hay = true;
        }
        return { catalogo, sinCatalogo };
    }

    const conteos = () => ({
        regular: RAZONES.regular.length,
        fletamento: RAZONES.fletamento.length,
        mixta: AEROLINEAS.filter(a => a.grupo === 'mixta').length
    });

    window.ConciCargaCatalogo = {
        AEROLINEAS, TARJETAS, RAZONES, WET_LEASE, BASE_HISTORICA,
        porNombre, normaliza, slug, logoDe, trunc2, entradaDe, cifras, conteos,
        _reiniciar: () => { indice = null; }
    };
})();
