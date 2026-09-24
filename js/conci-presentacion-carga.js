/* ==========================================================================
   Presentación de carga: el .pptx a partir de la plantilla
   --------------------------------------------------------------------------
   plantillas/presentacion-carga.pptx es la baraja original sin cifras: mismos
   fondos, fuentes, tablas y logotipos institucionales, con marcadores {{...}}
   donde iban los números. Aquí se abre con JSZip, se sustituyen los marcadores
   y se dibujan las tarjetas de las diapositivas 3 a 6 —logotipo arriba,
   recuadro crema con operaciones y toneladas abajo— con formas nativas, en la
   misma cuadrícula que tenían en la original. El resultado es la presentación
   de siempre con los números del periodo, y se puede editar en PowerPoint.

   No depende del navegador: recibe JSZip y una función para leer archivos, de
   modo que las pruebas lo corren en Node con la plantilla real.
   ========================================================================== */
(function () {
    'use strict';

    const PLANTILLA = 'plantillas/presentacion-carga.pptx';
    const EMU = 914400;
    const emu = pulgadas => Math.round(pulgadas * EMU);

    /**
     * Cuadrícula de las tarjetas por diapositiva, en pulgadas. Sale de la
     * posición de cada EMF en la baraja y de los recuadros crema detectados en
     * ella: columnas, anchos, altos y el borde superior de cada renglón.
     */
    const CUADRICULAS = {
        3: { columnas: [0.346, 2.707, 5.070, 7.436], primerRenglon: 2, ancho: 2.114, alto: 0.507,
            tops: [1.968, 3.093, 4.218, 5.339, 6.464], logoAlto: 0.48, puntos: 9 },
        4: { columnas: [0.366, 2.742, 5.121, 7.502], primerRenglon: 2, ancho: 2.128, alto: 0.510,
            tops: [1.921, 3.053, 4.185, 5.314, 6.447], logoAlto: 0.48, puntos: 9 },
        5: { columnas: [0.336, 2.720, 5.106, 7.495], primerRenglon: 2, ancho: 2.135, alto: 0.509,
            tops: [1.966, 3.195, 4.327, 5.463, 6.599], logoAlto: 0.48, puntos: 9 },
        6: { columnas: [0.519, 3.622, 6.734], primerRenglon: 3, ancho: 2.787, alto: 0.667,
            tops: [3.238, 4.718], logoAlto: 0.60, puntos: 12 }
    };

    const CREMA = 'FFF2CC';

    const escaparXml = t => String(t ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
    ));

    const comoBytes = b => (b instanceof ArrayBuffer ? new Uint8Array(b)
        : new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength));

    /** Ancho y alto de un PNG o JPEG leyendo solo su encabezado. */
    function dimensionesImagen(datos) {
        const b = comoBytes(datos);
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
            const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
            return { ancho: u32(16), alto: u32(20), ext: 'png' };
        }
        if (b[0] === 0xFF && b[1] === 0xD8) {
            let i = 2;
            while (i + 9 < b.length) {
                if (b[i] !== 0xFF) { i++; continue; }
                const m = b[i + 1];
                const largo = (b[i + 2] << 8) | b[i + 3];
                if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
                    return { alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8], ext: 'jpeg' };
                }
                i += 2 + largo;
            }
        }
        return null;
    }

    /** Posición de la tarjeta i: el primer renglón lleva menos (el avión ocupa la derecha). */
    function posicion(cuad, i) {
        if (i < cuad.primerRenglon) return { renglon: 0, columna: i };
        const resto = i - cuad.primerRenglon;
        const porRenglon = cuad.columnas.length;
        return { renglon: 1 + Math.floor(resto / porRenglon), columna: resto % porRenglon };
    }

    const rPr = puntos => `<a:rPr lang="es-MX" sz="${puntos * 100}" b="1" dirty="0">`
        + '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>'
        + '<a:latin typeface="Noto Sans"/><a:cs typeface="Noto Sans"/></a:rPr>';

    const parrafo = (texto, puntos, alinear) => `<a:p><a:pPr${alinear ? ` algn="${alinear}"` : ''}>`
        + '<a:lnSpc><a:spcPct val="120000"/></a:lnSpc></a:pPr>'
        + `<a:r>${rPr(puntos)}<a:t>${escaparXml(texto)}</a:t></a:r>`
        + `<a:endParaRPr lang="es-MX" sz="${puntos * 100}" b="1" dirty="0"/></a:p>`;

    function forma({ id, nombre, x, y, w, h, relleno, texto, puntos, alinear, margen }) {
        return '<p:sp>'
            + `<p:nvSpPr><p:cNvPr id="${id}" name="${escaparXml(nombre)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
            + `<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`
            + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            + (relleno ? `<a:solidFill><a:srgbClr val="${relleno}"/></a:solidFill>` : '<a:noFill/>')
            + '<a:ln><a:noFill/></a:ln></p:spPr>'
            + `<p:txBody><a:bodyPr wrap="none" lIns="${emu(margen || 0)}" tIns="0" rIns="0" bIns="0" anchor="ctr">`
            + '<a:noAutofit/></a:bodyPr><a:lstStyle/>'
            + texto.map(t => parrafo(t, puntos, alinear)).join('')
            + '</p:txBody></p:sp>';
    }

    function imagen({ id, nombre, rid, x, y, w, h }) {
        return '<p:pic>'
            + `<p:nvPicPr><p:cNvPr id="${id}" name="Logo ${escaparXml(nombre)}" descr="${escaparXml(nombre)}"/>`
            + '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
            + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
            + `<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`
            + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    }

    /** Sustituye los {{MARCADORES}}; si alguno queda sin valor, avisa en vez de dejarlo impreso. */
    function sustituir(xml, valores, donde) {
        const faltan = new Set();
        const salida = xml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, clave) => {
            if (!(clave in valores)) { faltan.add(clave); return ''; }
            // Un tramo vacío pierde su tamaño de letra y PowerPoint le da el de
            // omisión: el renglón crece y la tabla se sale de la diapositiva. La
            // baraja original traía un espacio en las celdas sin dato.
            const valor = String(valores[clave] ?? '');
            return valor === '' ? ' ' : escaparXml(valor);
        });
        if (faltan.size) throw new Error(`Sin valor para ${[...faltan].join(', ')} en ${donde}`);
        return salida;
    }

    /* ── marcatextos de la vista previa ─────────────────────────────────── */

    const esHex = v => /^[0-9A-F]{6}$/i.test(String(v || ''));
    const LINEAS_CELDA = /^(?:\s*<a:(lnL|lnR|lnT|lnB|lnTlToBr|lnBlToTr)\b(?:[^>]*\/>|[\s\S]*?<\/a:\1>))*/;
    const RELLENO_CELDA = /^\s*<a:(noFill|solidFill|gradFill|blipFill|pattFill|grpFill)\b(?:[^>]*\/>|[\s\S]*?<\/a:\1>)/;

    /** Pinta el fondo de una celda de tabla (a:tc), respetando el orden del esquema. */
    function rellenarCelda(tc, hex) {
        const relleno = `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
        const m = tc.match(/<a:tcPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:tcPr>)/);
        if (!m) return tc.replace(/<\/a:tc>$/, () => `<a:tcPr>${relleno}</a:tcPr></a:tc>`);
        const contenido = m[2] || '';
        // tcPr: bordes, luego cell3D, luego el relleno. El relleno de antes se quita.
        const lineas = contenido.match(LINEAS_CELDA)[0];
        let resto = contenido.slice(lineas.length);
        const cell3D = (resto.match(/^\s*<a:cell3D\b(?:[^>]*\/>|[\s\S]*?<\/a:cell3D>)/) || [''])[0];
        resto = resto.slice(cell3D.length).replace(RELLENO_CELDA, '');
        return tc.replace(m[0], () => `<a:tcPr${m[1]}>${lineas}${cell3D}${relleno}${resto}</a:tcPr>`);
    }

    /** Resalta un tramo de texto (a:r) con el marcatextos de PowerPoint. */
    function resaltarTramo(tramo, hex) {
        const resaltado = `<a:highlight><a:srgbClr val="${hex}"/></a:highlight>`;
        const cerrado = tramo.match(/<a:rPr\b([^>]*?)\/>/);
        if (cerrado) return tramo.replace(cerrado[0], () => `<a:rPr${cerrado[1]}>${resaltado}</a:rPr>`);
        const m = tramo.match(/<a:rPr\b([^>]*)>([\s\S]*?)<\/a:rPr>/);
        if (!m) return tramo.replace('<a:r>', () => `<a:r><a:rPr>${resaltado}</a:rPr>`);
        let contenido = m[2].replace(/<a:highlight\b[\s\S]*?<\/a:highlight>/, '');
        // El esquema lo pide después de línea, relleno y efectos, y antes de las fuentes.
        const i = contenido.search(/<a:(uLnTx|uLn|uFillTx|uFill|latin|ea|cs|sym|hlinkClick|hlinkMouseOver|rtl|extLst)\b/);
        contenido = i < 0 ? contenido + resaltado : contenido.slice(0, i) + resaltado + contenido.slice(i);
        return tramo.replace(m[0], () => `<a:rPr${m[1]}>${contenido}</a:rPr>`);
    }

    /**
     * Aplica los marcatextos de la vista previa a una diapositiva, antes de
     * sustituir los marcadores: `marcas` es { MARCADOR: 'RRGGBB' }. En una tabla
     * se pinta la celda completa, como se ve en pantalla; en un cuadro de texto
     * se resalta la cifra.
     */
    function marcar(xml, marcas) {
        for (const [clave, hex] of Object.entries(marcas || {})) {
            if (!esHex(hex) || !/^[A-Z0-9_]+$/.test(clave)) continue;
            const color = hex.toUpperCase();
            const marcador = `{{${clave}}}`;
            let desde = 0;
            for (let i = xml.indexOf(marcador, desde); i >= 0; i = xml.indexOf(marcador, desde)) {
                const abreCelda = Math.max(xml.lastIndexOf('<a:tc>', i), xml.lastIndexOf('<a:tc ', i));
                if (abreCelda > xml.lastIndexOf('</a:tc>', i)) {
                    const fin = xml.indexOf('</a:tc>', i) + '</a:tc>'.length;
                    const nueva = rellenarCelda(xml.slice(abreCelda, fin), color);
                    xml = xml.slice(0, abreCelda) + nueva + xml.slice(fin);
                    desde = abreCelda + nueva.length;
                    continue;
                }
                const abre = xml.lastIndexOf('<a:r>', i);
                const cierre = xml.indexOf('</a:r>', i);
                if (abre < 0 || cierre < 0) { desde = i + marcador.length; continue; }
                const fin = cierre + '</a:r>'.length;
                const nuevo = resaltarTramo(xml.slice(abre, fin), color);
                xml = xml.slice(0, abre) + nuevo + xml.slice(fin);
                desde = abre + nuevo.length;
            }
        }
        return xml;
    }

    /**
     * La plantilla trae cuatro renglones de años (2023 a 2026). Si el periodo
     * pide más, se clona el último; si pide menos, se quitan los sobrantes.
     */
    function ajustarAnios(xml, anios) {
        const reRenglon = n => new RegExp(`<a:tr\\b[^>]*>(?:(?!<\\/a:tr>)[\\s\\S])*?\\{\\{ANIO_${n}_ETQ\\}\\}[\\s\\S]*?<\\/a:tr>`);
        const ultimo = xml.match(reRenglon(4));
        if (!ultimo) throw new Error('La plantilla no trae el renglón del año 4');
        if (anios > 4) {
            const clones = [];
            for (let n = 5; n <= anios; n++) clones.push(ultimo[0].replace(/ANIO_4_/g, `ANIO_${n}_`));
            return xml.replace(ultimo[0], ultimo[0] + clones.join(''));
        }
        for (let n = 4; n > anios; n--) xml = xml.replace(reRenglon(n), '');
        return xml;
    }

    /** Dibuja las tarjetas de una diapositiva y registra sus logotipos. */
    async function dibujarTarjetas(zip, n, tarjetas, cargar, medios) {
        const cuad = CUADRICULAS[n];
        const ruta = `ppt/slides/slide${n}.xml`;
        const rutaRels = `ppt/slides/_rels/slide${n}.xml.rels`;
        let xml = await zip.file(ruta).async('string');
        let rels = await zip.file(rutaRels).async('string');

        let id = Math.max(0, ...[...xml.matchAll(/<p:cNvPr[^>]*\bid="(\d+)"/g)].map(m => Number(m[1])));
        let rid = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])));
        const ridPorMedio = new Map();
        const formas = [];

        for (let i = 0; i < tarjetas.length; i++) {
            const t = tarjetas[i];
            const { renglon, columna } = posicion(cuad, i);
            const x = cuad.columnas[columna];
            const y = cuad.tops[renglon];
            if (y === undefined) throw new Error(`La diapositiva ${n} no tiene lugar para ${tarjetas.length} tarjetas`);

            if (t.logo) {
                if (!medios.has(t.logo)) {
                    const bytes = await cargar(t.logo);
                    const dim = dimensionesImagen(bytes);
                    const archivo = `logo-${String(t.logo).split('/').pop()}`;
                    zip.file(`ppt/media/${archivo}`, bytes);
                    medios.set(t.logo, { archivo, dim });
                }
                const medio = medios.get(t.logo);
                if (!ridPorMedio.has(medio.archivo)) {
                    rid += 1;
                    ridPorMedio.set(medio.archivo, `rId${rid}`);
                    rels = rels.replace('</Relationships>',
                        `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${medio.archivo}"/></Relationships>`);
                }
                // Cabe en el ancho del recuadro y en el alto del hueco de encima, sin deformarse.
                const proporcion = medio.dim ? medio.dim.ancho / medio.dim.alto : 3;
                let w = cuad.ancho;
                let h = w / proporcion;
                if (h > cuad.logoAlto) { h = cuad.logoAlto; w = h * proporcion; }
                formas.push(imagen({
                    id: ++id, nombre: t.nombre, rid: ridPorMedio.get(medio.archivo),
                    x: x + (cuad.ancho - w) / 2, y: y - h - 0.02, w, h
                }));
            }

            formas.push(forma({
                // Una tarjeta marcada con el marcatextos lleva ese color en vez del crema.
                id: ++id, nombre: `Tarjeta ${t.nombre}`, x, y, w: cuad.ancho, h: cuad.alto,
                relleno: esHex(t.marca) ? String(t.marca).toUpperCase() : CREMA,
                texto: ['No. de operaciones', 'Total de carga en Tn.'], puntos: cuad.puntos, margen: 0.1
            }));
            // Las cifras centradas en el último 38 % del recuadro, como en la original.
            formas.push(forma({
                id: ++id, nombre: `Cifras ${t.nombre}`, x: x + cuad.ancho * 0.62, y, w: cuad.ancho * 0.38, h: cuad.alto,
                texto: [t.ops, t.ton], puntos: cuad.puntos, alinear: 'ctr'
            }));
        }

        zip.file(ruta, xml.replace('</p:spTree>', formas.join('') + '</p:spTree>'));
        zip.file(rutaRels, rels);
    }

    /**
     * Arma la presentación. `modelo.texto` trae el valor, ya con formato, de
     * cada marcador; `modelo.anios` cuántos renglones de años lleva la tabla, y
     * `modelo.tarjetas` las tarjetas de las diapositivas 3 a 6.
     */
    async function construir({ JSZip, cargar }, modelo) {
        const zip = await JSZip.loadAsync(await cargar(PLANTILLA));

        for (const n of [1, 2, 7]) {
            const ruta = `ppt/slides/slide${n}.xml`;
            let xml = await zip.file(ruta).async('string');
            if (n === 2) xml = ajustarAnios(xml, modelo.anios);
            // Lo corregido a mano en la vista previa, diapositiva por diapositiva.
            const extra = modelo.porLamina || {};
            xml = marcar(xml, (extra.marcas && extra.marcas[n]) || {});
            const valores = { ...modelo.texto, ...((extra.texto && extra.texto[n]) || {}) };
            zip.file(ruta, sustituir(xml, valores, `la diapositiva ${n}`));
        }

        const medios = new Map();
        for (const n of [3, 4, 5, 6]) {
            await dibujarTarjetas(zip, n, modelo.tarjetas[n] || [], cargar, medios);
        }

        return zip.generateAsync({
            type: 'uint8array',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        });
    }

    window.ConciPresentacionCarga = { construir, marcar, CUADRICULAS, PLANTILLA, dimensionesImagen, posicion };
})();
