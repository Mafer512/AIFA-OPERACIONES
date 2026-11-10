(function () {
    'use strict';

    // ============================================================
    // SETP · Catálogo para capturar hallazgos
    //  - Módulos y locales de cada nivel (según los PDF del Edificio Terminal).
    //  - Etiquetas (tipo de hallazgo), sus items y las condiciones de cada una.
    //  - componer(): arma la "Descripción de incidencia" que sale en el oficio
    //    (ej. "Butaca rota (2 piezas). Respaldo roto en la fila 3.").
    // Lo usan js/setp-recorridos.js (ventana "Descripción del hallazgo") y
    // js/setp-formato.js (Reporte de hallazgos).
    // ============================================================

    // Módulos que se ofrecen según el nivel (piso) del recorrido. Cada módulo
    // lleva sus locales (claves de ubicación exacta).
    const MODULOS_POR_NIVEL = {
        '0.00': [
            { nombre: 'Módulo A', zona: 'Llegadas', locales: 'LLENA-01, LLENA-02A, LLENA-02B, LLENA-MA01'.split(', ') },
            { nombre: 'Módulo B', zona: 'Llegadas', locales: 'LLENB-01, LLEIE4-01, LLEIE4-MA01'.split(', ') },
            { nombre: 'Módulo H', zona: 'Llegadas', locales: 'LLEIH-01, LLEIH-02, LLEIH-03, LLEIH-04, LLEIH-07, LLEIH-MA01, LLEIH-MA02, LLEIH-06, LLEIH-05'.split(', ') },
            { nombre: 'Módulo I', zona: 'Llegadas', locales: 'LLENI-01, LLENI-02, LLENI-MA01'.split(', ') },
            { nombre: 'Módulo J', zona: 'Llegadas', locales: ['LLENJ-01'] },
            { nombre: 'Módulo K', zona: 'Llegadas', locales: 'LLEIK-MA01, LLEIK-01, LLEIK-02'.split(', ') },
            { nombre: 'Módulo L', zona: 'Llegadas', locales: ('LLANL-01A, LLANL-01B, LLANL-02, LLANL-03, LLANL-04, LLANL-11, LLANL-12, LLANL-13, LLANL-20, LLANL-21, LLANL-14, LLANL-15, ' +
                'LLANL-22, LLANL-23, LLANL-24, LLANL-25, LLANL-26, LLANL-27, LLANL-28, LLANL-29, LLANL-30, LLANL-31, LLANL-32, LLANL-33, LLANL-34, LLANL-35, ' +
                'LLANL-36, LLANL-37, LLANL-38, LLANL-39, LLANL-40, LLANL-41, LLANL-42A, LLANL-42B, LLANL-43, LLANL-43B, LLANL-45, LLANL-46, LLANL-C4, LLANL-MA01').split(', ') },
            { nombre: 'Módulo M', zona: 'Llegadas', locales: ('LLANM-01, LLANM-02, LLANM-03, LLAIM-04, LLANM-05, LLANM-07, LLANM-08, LLANM-09, LLANM-10, LLANM-11, LLAIM-12, ' +
                'LLANM-13, LLAIM-14, LLAIM-15, LLAIM-16, LLAIM-17, LLAIM-18, LLAIM-19, LLAIM-20, LLANM-21, LLANM-22, LLANM-23, LLANM-23B, LLANM-24, LLANM-25A, ' +
                'LLANM-25B, LLANM-25C, LLANM-26, LLANM-27, LLANM-MA2').split(', ') },
            { nombre: 'Módulo N', zona: 'Llegadas', locales: 'LLAIN-03, LLAIN-04, LLAIN-05, LLAIN-06, LLAIN-07, LLAIN-08, LLAIN-09, LLAIN-10, LLAIN-11, LLAIN-12, LLAIN-15, LLAIN-18, LLAIN-20, LLAIN-MA01, LLAIN-C16'.split(', ') }
        ],
        '5.25': [
            { nombre: 'Módulo C', locales: ['MENC-01'] },
            { nombre: 'Módulo F', locales: ['MEIF-01', 'MEIF-02'] },
            { nombre: 'Módulo G1', locales: ['MEIGI-01'] },
            { nombre: 'Módulo H', locales: ['MEIH-01'] },
            { nombre: 'Módulo K', locales: ['MEIK-01'] }
        ],
        '10.50': [
            { nombre: 'Módulo A', locales: 'SENA-01, SENA-02, SENA-03, SENA-04, SENA-05, SENA-06, SENA-07, SENA-08, SENA-09, SENA-10, SENA-11, SENA-12, SENA-13, SENA-14, SENA-MA01'.split(', ') },
            { nombre: 'Módulo B', locales: 'SENB-01, SENB-02, SENB-03, SENB-04, SENB-05, SENB-06, SENB-07, SENB-08, SENB-09, SENB-10, SENB-11, SENB-MA01'.split(', ') },
            { nombre: 'Módulo C', locales: 'SENC-01, SENC-02, SENC-03, SENC-04, SENC-05, SENC-06, SENC-07, SENC-09, SENC-10A, SENC-10B, SENC-MA02, SENC-MA01'.split(', ') },
            { nombre: 'Módulo D', locales: ('SEND-01, SEND-02, SEND-03A, SEND-03B, SEND-04A, SEND-04B, SEND-05, SEND-06, SEND-06B, SEND-07, SEND-0, SEND-09, SEND-10A, SEND-10B, ' +
                'SEND-10C, SEND-10D, SEND-11, SEND-12, SEND-13, SEND-14, SEND-15A, SEND-15B, SEND-MA01').split(', ') },
            { nombre: 'Módulo E1', locales: 'SENE1-01, SENE1-02, SENE1-03, SENE1-04A, SENE1-04B, SENE1-05, SENE1-06, SENE1-07, SENE1-08, SENE1-09, SENE1-10, SENE1-11, SENE1-12, SENE1-13'.split(', ') },
            { nombre: 'Módulo E2', locales: 'SENE2-01, SENE2-02, SEIE2-03, SENE2-04, SEIE2-05, SENE2-06, SENE2-07'.split(', ') },
            { nombre: 'Módulo E3', locales: 'SEIE3-01, SEIE3-02, SEIE3-03, SEIE3-04, SEIE3-05, SEIE3-06A, SEIE3-06B, SEIE3-07B, SEIE3-07A, SEIE3-08, SEIE3-09, SEIE3-10, SEIE3-11, SEIE3-12, SEIE3-14'.split(', ') },
            { nombre: 'Módulo E4', locales: ('SEIE4-01, SEIE4-02, SEIE4-03, SEIE4-04, SEIE4-05, SEIE4-06, SEIE4-07, SEIE4-32, SEIE4-08, SEIE4-09, SEIE4-10, SEIE4-11, SEIE4-12, ' +
                'SEIE4-13, SEIE4-14, SEIE4-15, SEIE4-16, SEIE4-33, SEIE4-17, SEIE4-18, SEIE4-19, SEIE4-20, SEIE4-21, SEIE4-22A, SEIE4-22B, SEIE4-23, SEIE4-24, ' +
                'SEIE4-25, SEIE4-26, SEIE4-27A, SEIE4-27B, SEIE4-29, SEIE4-30, SEIE4-31').split(', ') },
            { nombre: 'Sala de espera', locales: 'SEIF-01, SEIF-02, SEIF-03, SEIF-04, SEIF-05, SEIF-10'.split(', ') },
            { nombre: 'Módulo G1', locales: 'SEIG1-01, SEIG1-02, SEIG1-03, SEIG1-04, SEIG1-05, SEIG1-06, SEIGI-MA01'.split(', ') },
            { nombre: 'Módulo G2', locales: 'SEIG2-01, SEIG2-02, SEIG2-03, SEIG2-04, SEIG2-05'.split(', ') },
            { nombre: 'Módulo H', locales: ['SEIH-01', 'SEIH-MA01'] },
            { nombre: 'Módulo I', locales: 'SENI-01, SENI-02, SENI-03, SENI-04, SENI-05, SENI-06, SENI-07, SENI-08, SENI-09, SENI-10, SENI-11, SENI-12, SENI-13, SENI-14'.split(', ') },
            { nombre: 'Módulo K', locales: 'SEIK-01, SEIK-02, SEIK-03, SEIK-04, SEIK-05, SEIK-06, SEIK-07, SEIK-08, SEIK-09, SEIK-10, SEIK-11'.split(', ') },
            { nombre: 'Módulo L', locales: ('SANL-01, SANL-01B, SANL-02, SANL-03, SANL-03B, SANL-04, SANL-05, SANL-06, SANL-12, SANL-13, SANL-14 Y 15, SANL-19, SANL-20, SANL-21, ' +
                'SANL-22, SANL-23, SANL-24, SANL-25, SANL-MP01, SANL-MA01, SANL-C1, SANL-C12, SANL-C13, SANL-C9, SANL-C5, SANL-C2, SANL-27, SANL-28, SANL-29, SANL-30').split(', ') },
            { nombre: 'Módulo M', locales: 'SAIM-01, SAIM-01B, SANM-02, SANM-03, SAIM-04, SAIM-05A, SAIM-05B, SAIM-MA02'.split(', ') },
            { nombre: 'Módulo N', locales: 'SAIN-01, SAIN-02, SAIN-MA02, SAIN-02B, SAIN-03, SAIN-07, SAIN-08, SAIN-09, SAIN-10, SAIN-11, SAIN-12, SAIN-13A, SAIN-13B'.split(', ') }
        ]
    };

    // Condiciones: [masculino, femenino] (o un solo texto si no cambia).
    const C = {
        danado: ['Dañado', 'Dañada'], roto: ['Roto', 'Rota'], faltante: 'Faltante', sucio: ['Sucio', 'Sucia'],
        flojo: ['Flojo', 'Floja'], fuera: 'Fuera de servicio', fuga: 'Con fuga', obstruido: ['Obstruido', 'Obstruida'],
        mojado: ['Mojado', 'Mojada'], basura: 'Con basura', olor: 'Con mal olor', fundido: ['Fundido', 'Fundida'],
        parpadea: 'Parpadea', insumos: 'Sin insumos', desact: ['Desactualizado', 'Desactualizada'], ilegible: 'Ilegible',
        noEnfria: 'No enfría', gotea: 'Gotea', ruido: 'Hace ruido', encharcado: ['Encharcado', 'Encharcada'],
        humedad: 'Con humedad', manchado: ['Manchado', 'Manchada'], noAbre: 'No abre', noCierra: 'No cierra',
        atorado: ['Atorado', 'Atorada'], detenido: ['Detenido', 'Detenida'], sinEnergia: 'Sin energía',
        expuesto: ['Expuesto', 'Expuesta'], abandonado: ['Abandonado', 'Abandonada'], olvidado: ['Olvidado', 'Olvidada'],
        otro: 'Otro'
    };

    // Items: [nombre, género ('m' | 'f'), icono Font Awesome]. "Otro" siempre al final.
    // mov: objetos que se mueven (maleta, carrito…): los duplicados se buscan en
    // todo el nivel durante 24 h, aunque el local sea distinto.
    const ETIQUETAS = [
        { key: 'MOBILIARIO', nombre: 'Mobiliario', icono: 'fa-chair', color: '#2563eb',
            items: [['Butaca', 'f', 'fa-couch'], ['Banca', 'f', 'fa-chair'], ['Mesa', 'f', 'fa-table'], ['Bote de basura', 'm', 'fa-trash-can'],
                ['Barandal', 'm', 'fa-grip-lines'], ['Mostrador', 'm', 'fa-cash-register'], ['Estación de carga', 'f', 'fa-charging-station']],
            condiciones: ['danado', 'roto', 'faltante', 'sucio', 'flojo'] },
        { key: 'LIMPIEZA', nombre: 'Limpieza', icono: 'fa-broom', color: '#059669',
            items: [['Piso', 'm', 'fa-border-all'], ['Bote de basura', 'm', 'fa-trash-can'], ['Sanitario', 'm', 'fa-toilet'],
                ['Vidrio', 'm', 'fa-window-maximize'], ['Mobiliario', 'm', 'fa-chair']],
            condiciones: ['sucio', 'mojado', 'basura', 'olor'] },
        { key: 'ILUMINACION', nombre: 'Iluminación', icono: 'fa-lightbulb', color: '#d97706',
            items: [['Luminaria', 'f', 'fa-lightbulb'], ['Lámpara', 'f', 'fa-lightbulb'], ['Anuncio luminoso', 'm', 'fa-rectangle-ad'], ['Reflector', 'm', 'fa-sun']],
            condiciones: ['fundido', 'parpadea', 'danado', 'faltante'] },
        { key: 'SANITARIOS', nombre: 'Sanitarios', icono: 'fa-restroom', color: '#0891b2',
            items: [['Inodoro', 'm', 'fa-toilet'], ['Mingitorio', 'm', 'fa-toilet'], ['Lavabo', 'm', 'fa-sink'], ['Llave', 'f', 'fa-faucet'],
                ['Secador de manos', 'm', 'fa-wind'], ['Dispensador', 'm', 'fa-pump-soap'], ['Puerta de cubículo', 'f', 'fa-door-closed']],
            condiciones: ['fuera', 'fuga', 'obstruido', 'sucio', 'insumos', 'danado'] },
        { key: 'SENALETICA', nombre: 'Señalética', icono: 'fa-signs-post', color: '#db2777',
            items: [['Letrero', 'm', 'fa-signs-post'], ['Pantalla de vuelos', 'f', 'fa-tv'], ['Señal de emergencia', 'f', 'fa-person-running'], ['Vinil', 'm', 'fa-note-sticky']],
            condiciones: ['danado', 'flojo', 'faltante', 'desact', 'ilegible', 'fuera'] },
        { key: 'CLIMA', nombre: 'Clima / A.A.', icono: 'fa-snowflake', color: '#0284c7',
            items: [['Aire acondicionado', 'm', 'fa-snowflake'], ['Rejilla', 'f', 'fa-fan'], ['Difusor', 'm', 'fa-wind'], ['Termostato', 'm', 'fa-temperature-half']],
            condiciones: ['fuera', 'noEnfria', 'gotea', 'ruido', 'fuga'] },
        { key: 'FILTRACION', nombre: 'Filtración / agua', icono: 'fa-droplet', color: '#0369a1',
            items: [['Techo', 'm', 'fa-cloud-rain'], ['Plafón', 'm', 'fa-square'], ['Muro', 'm', 'fa-border-all'], ['Piso', 'm', 'fa-border-all'], ['Tubería', 'f', 'fa-faucet-drip']],
            condiciones: ['fuga', 'gotea', 'encharcado', 'humedad'] },
        { key: 'PISOS_MUROS', nombre: 'Pisos y muros', icono: 'fa-border-all', color: '#7c3aed',
            items: [['Piso', 'm', 'fa-border-all'], ['Loseta', 'f', 'fa-table-cells'], ['Muro', 'm', 'fa-square'], ['Plafón', 'm', 'fa-square'],
                ['Zoclo', 'm', 'fa-ruler-horizontal'], ['Cristal', 'm', 'fa-window-maximize']],
            condiciones: ['danado', 'roto', 'flojo', 'mojado', 'humedad', 'manchado'] },
        { key: 'PUERTAS', nombre: 'Puertas y accesos', icono: 'fa-door-open', color: '#ea580c',
            items: [['Puerta', 'f', 'fa-door-open'], ['Puerta automática', 'f', 'fa-door-closed'], ['Cerradura', 'f', 'fa-lock'],
                ['Torniquete', 'm', 'fa-person-walking-arrow-right'], ['Cortina', 'f', 'fa-bars']],
            condiciones: ['danado', 'noAbre', 'noCierra', 'atorado', 'fuera'] },
        { key: 'ELEVADORES', nombre: 'Elevadores / escaleras', icono: 'fa-elevator', color: '#9333ea',
            items: [['Elevador', 'm', 'fa-elevator'], ['Escalera eléctrica', 'f', 'fa-stairs'], ['Banda transportadora', 'f', 'fa-arrows-left-right'], ['Pasillo móvil', 'm', 'fa-person-walking']],
            condiciones: ['fuera', 'detenido', 'ruido', 'danado'] },
        { key: 'ELECTRICO', nombre: 'Eléctrico', icono: 'fa-plug', color: '#ca8a04',
            items: [['Contacto', 'm', 'fa-plug'], ['Tablero', 'm', 'fa-bolt'], ['Cableado', 'm', 'fa-network-wired'], ['Apagador', 'm', 'fa-toggle-on']],
            condiciones: ['sinEnergia', 'expuesto', 'danado', 'fuera'] },
        { key: 'EQUIPAJE', nombre: 'Objetos y equipaje', icono: 'fa-suitcase-rolling', color: '#c2410c',
            items: [['Maleta', 'f', 'fa-suitcase-rolling', true], ['Mochila', 'f', 'fa-briefcase', true], ['Bolsa', 'f', 'fa-bag-shopping', true],
                ['Carrito portaequipaje', 'm', 'fa-cart-flatbed-suitcase', true], ['Objeto olvidado', 'm', 'fa-box-open', true]],
            condiciones: ['abandonado', 'olvidado'] },
        { key: 'OTRO', nombre: 'Otro', icono: 'fa-tag', color: '#64748b', items: [], condiciones: ['danado', 'fuera', 'otro'] }
    ];

    const OTRO = 'Otro';

    function etiqueta(key) {
        return ETIQUETAS.find(function (e) { return e.key === key; }) || null;
    }

    // Items de la etiqueta como objetos { nombre, genero, icono, mov }; "Otro" al final.
    function items(key) {
        var e = etiqueta(key);
        if (!e) return [];
        var lista = e.items.map(function (i) { return { nombre: i[0], genero: i[1], icono: i[2], mov: !!i[3] }; });
        lista.push({ nombre: OTRO, genero: 'm', icono: 'fa-ellipsis', mov: key === 'EQUIPAJE' });
        return lista;
    }

    function item(key, nombre) {
        return items(key).find(function (i) { return i.nombre === nombre; }) || null;
    }

    // Condiciones de la etiqueta como { key, texto } (texto en masculino, para los botones).
    function condiciones(key) {
        var e = etiqueta(key);
        return e ? e.condiciones.map(function (c) { return { key: c, texto: Array.isArray(C[c]) ? C[c][0] : C[c] }; }) : [];
    }

    function condicionTexto(c, genero) {
        var t = C[c];
        if (!t) return c || '';
        return Array.isArray(t) ? t[genero === 'f' ? 1 : 0] : t;
    }

    function oracion(s) {
        s = String(s || '').trim().replace(/\s+/g, ' ');
        if (!s) return '';
        s = s.charAt(0).toUpperCase() + s.slice(1);
        return /[.!?]$/.test(s) ? s : s + '.';
    }

    // Descripción de incidencia del oficio a partir de la captura:
    //   { etiqueta, item, condicion, cantidad, detalle }
    //   → "Butaca rota (2 piezas). Respaldo roto en la fila 3."
    // Item "Otro": el detalle escrito es la descripción ("Cartel del evento (dañado).").
    function componer(d) {
        var it = item(d.etiqueta, d.item);
        if (!it) return oracion(d.detalle);
        var cond = condicionTexto(d.condicion, it.genero);
        var cant = Number(d.cantidad) > 1 ? ' (' + Number(d.cantidad) + ' piezas)' : '';
        if (it.nombre === OTRO) {
            var det = String(d.detalle || '').trim().replace(/[.\s]+$/, '');
            if (!det) return '';
            var extra = [cond && d.condicion !== 'otro' ? cond.toLowerCase() : '', Number(d.cantidad) > 1 ? Number(d.cantidad) + ' piezas' : ''].filter(Boolean).join(', ');
            return oracion(det + (extra ? ' (' + extra + ')' : ''));
        }
        var base = it.nombre + (cond && d.condicion !== 'otro' ? ' ' + cond.toLowerCase() : '') + cant + '.';
        return base + (d.detalle ? ' ' + oracion(d.detalle) : '');
    }

    function esMovible(etq, nombre) {
        var it = item(etq, nombre);
        return !!(it && it.mov);
    }

    // '00' y '0' se toman como '0.00'.
    function nivel(n) {
        n = String(n || '').trim().replace(/^nivel\s*/i, '').replace(/\.$/, '');
        return /^0+(\.0+)?$/.test(n) ? '0.00' : n;
    }

    function modulos(n) {
        return MODULOS_POR_NIVEL[nivel(n)] || [];
    }

    window.setpCatalogo = {
        OTRO: OTRO,
        etiquetas: ETIQUETAS,
        etiqueta: etiqueta,
        items: items,
        item: item,
        condiciones: condiciones,
        condicionTexto: condicionTexto,
        componer: componer,
        esMovible: esMovible,
        nivel: nivel,
        modulos: modulos,
        modulosPorNivel: MODULOS_POR_NIVEL
    };
})();
