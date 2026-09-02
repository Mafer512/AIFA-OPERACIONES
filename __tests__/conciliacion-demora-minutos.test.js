/**
 * @jest-environment jsdom
 *
 * CÓDIGO DEMORA: repartir los minutos entre las causas.
 *
 * Un vuelo con 60 minutos de demora rara vez los debe a una sola cosa: pueden
 * ser 40 por ROF y 20 por AAA. Y a veces la demora viene arrastrada de una
 * causa anterior, lo que en el catálogo se marca con una R al frente.
 *
 * Lo que se captura ahora es un token: R-ROF-40. Lo que ya estaba capturado
 * —códigos sueltos separados por coma— tiene que seguir leyéndose igual, que
 * es lo que más se cuida aquí.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

function entre(desde, hasta) {
    const i = source.indexOf(desde);
    const j = source.indexOf(hasta, i);
    if (i === -1 || j === -1) throw new Error('No se encontró el bloque: ' + desde);
    return source.slice(i, j);
}

/** Los ayudantes reales del token, tal como viven en script.js. */
const helpers = new Function(`
    ${entre('function _conciNormalizedColumnName', 'function _conciNormalizeManifestType')}
    return {
        _conciParseDemoraToken,
        _conciFormatDemoraToken,
        _conciParseDemoraTokens,
        _conciParseDemoraCodes,
        _conciDemoraTotalMinutos,
        _conciDemoraResumenReparto,
        _conciDemoraDescriptionsForCodes,
    };
`)();

const EDITOR = entre('function _conciActivateDemoraCodeEditor', 'function _conciIsOperationTypeColumn');

/** Los avisos de la captura, que cuelgan de la pestaña de manifiestos. */
const avisoEl = new Function(`
    ${entre('function _conciAviso', '/** El renglón que dice')}
    function _conciEnsureEditStyles() {}
    return _conciAviso;
`)();

/** La tira flotante donde se reparten los minutos. */
const tiraEl = new Function(`
    ${entre('function _conciDemoraMinutosEl', '// Editor multiselecci')}
    return _conciDemoraMinutosEl;
`)();

describe('lo que ya estaba capturado se sigue leyendo igual', () => {
    test('un código suelto no cambia en nada', () => {
        expect(helpers._conciParseDemoraToken('ROF')).toEqual({ prefijo: '', codigo: 'ROF', minutos: null });
        expect(helpers._conciFormatDemoraToken({ prefijo: '', codigo: 'ROF', minutos: null })).toBe('ROF');
    });

    test('la lista separada por comas de siempre', () => {
        const tokens = helpers._conciParseDemoraTokens('AAA, ROF');
        expect(tokens.map(t => t.codigo)).toEqual(['AAA', 'ROF']);
        expect(tokens.every(t => t.minutos === null && t.prefijo === '')).toBe(true);
        expect(tokens.map(helpers._conciFormatDemoraToken).join(', ')).toBe('AAA, ROF');
    });

    test('las variantes pegadas del catálogo (RCTB) siguen siendo un código', () => {
        // No es "R" + "CTB" partido: es el código tal cual está en el catálogo.
        expect(helpers._conciParseDemoraToken('RCTB')).toEqual({ prefijo: '', codigo: 'RCTB', minutos: null });
    });

    test('_conciParseDemoraCodes no se tocó', () => {
        expect(helpers._conciParseDemoraCodes('01, 02; 01 | 03\n04, 05'))
            .toEqual(['01', '02', '03', '04', '05']);
    });
});

describe('el reparto de minutos', () => {
    test('un código con sus minutos', () => {
        expect(helpers._conciParseDemoraToken('ROF-40')).toEqual({ prefijo: '', codigo: 'ROF', minutos: 40 });
        expect(helpers._conciFormatDemoraToken({ codigo: 'ROF', minutos: 40 })).toBe('ROF-40');
    });

    test('la letra va al frente, y puede ser cualquiera', () => {
        expect(helpers._conciParseDemoraToken('R-ROF-40')).toEqual({ prefijo: 'R', codigo: 'ROF', minutos: 40 });
        expect(helpers._conciFormatDemoraToken({ prefijo: 'R', codigo: 'ROF', minutos: 40 })).toBe('R-ROF-40');
        // La R de repercusión es la de siempre, pero no es la única.
        expect(helpers._conciParseDemoraToken('T-AAA-25')).toEqual({ prefijo: 'T', codigo: 'AAA', minutos: 25 });
        expect(helpers._conciFormatDemoraToken({ prefijo: 'M', codigo: 'CPX', minutos: 12 })).toBe('M-CPX-12');
    });

    test('60 minutos repartidos entre dos causas', () => {
        const tokens = helpers._conciParseDemoraTokens('R-ROF-40, AAA-20');
        expect(tokens).toEqual([
            { prefijo: 'R', codigo: 'ROF', minutos: 40 },
            { prefijo: '', codigo: 'AAA', minutos: 20 },
        ]);
        const suma = tokens.reduce((t, k) => t + (k.minutos || 0), 0);
        expect(suma).toBe(60);
    });

    test('minúsculas y espacios se aceptan al escribirlo a mano', () => {
        expect(helpers._conciParseDemoraToken('r rof 40')).toEqual({ prefijo: 'R', codigo: 'ROF', minutos: 40 });
        expect(helpers._conciParseDemoraToken(' rof-40 ')).toEqual({ prefijo: '', codigo: 'ROF', minutos: 40 });
    });

    test('cero minutos no se guarda: es lo mismo que no repartir', () => {
        expect(helpers._conciFormatDemoraToken({ codigo: 'ROF', minutos: 0 })).toBe('ROF');
    });

    test('no se repite un código ni se pasan los cinco', () => {
        const tokens = helpers._conciParseDemoraTokens('A-10, A-20, B, C, D, E, F');
        expect(tokens.map(t => t.codigo)).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(tokens[0].minutos).toBe(10);
    });
});

describe('la demora del vuelo, para saber cuánto falta por repartir', () => {
    function fila(valorDemora) {
        document.body.innerHTML = `<table><tr>
            <td data-col="DEMORA +- 15 MIN." data-raw="${valorDemora}">${valorDemora}</td>
            <td data-col="CÓDIGO DEMORA" id="celda"></td>
        </tr></table>`;
        return document.getElementById('celda');
    }

    test('toma los minutos de la columna de demora de esa misma fila', () => {
        expect(helpers._conciDemoraTotalMinutos(fila('60'))).toBe(60);
    });

    test('adelantarse también es demora: cuenta la distancia al slot', () => {
        // Salirse del slot 35 minutos antes es tan demora como salirse 35
        // después; la columna solo guarda de qué lado quedó.
        expect(helpers._conciDemoraTotalMinutos(fila('-35'))).toBe(35);
        expect(helpers._conciDemoraTotalMinutos(fila('-16'))).toBe(16);
    });

    test('sin demora calculada no inventa un total', () => {
        expect(helpers._conciDemoraTotalMinutos(fila(''))).toBeNull();
    });
});

describe('el resumen del reparto', () => {
    test('cuadra, falta o sobra', () => {
        expect(helpers._conciDemoraResumenReparto(35, 35).clase).toBe('conci-demora-min-ok');
        const falta = helpers._conciDemoraResumenReparto(35, 20);
        expect(falta.clase).toBe('conci-demora-min-falta');
        expect(falta.html).toContain('Faltan 15 de 35 min por asignar a un código');
        expect(helpers._conciDemoraResumenReparto(35, 40).clase).toBe('conci-demora-min-sobra');
    });

    test('sin demora en la fila no se pide repartir nada', () => {
        expect(helpers._conciDemoraResumenReparto(null, 0).clase).toBe('conci-demora-min-nota');
        expect(helpers._conciDemoraResumenReparto(0, 0).clase).toBe('conci-demora-min-nota');
    });
});

describe('la causa se sigue encontrando aunque el código lleve minutos', () => {
    const catalogo = [
        { codigo: 'ROF', titulo: 'Rampa: falta de operador' },
        { codigo: 'AAA', titulo: 'Autoridad aeronáutica' },
    ];

    test('R-ROF-40 escribe la misma observación que ROF', () => {
        expect(helpers._conciDemoraDescriptionsForCodes(['R-ROF-40'], catalogo))
            .toBe('Rampa: falta de operador');
        expect(helpers._conciDemoraDescriptionsForCodes(['ROF-40', 'AAA-20'], catalogo))
            .toBe('Rampa: falta de operador; Autoridad aeronáutica');
    });
});

describe('los avisos no persiguen al capturista fuera de manifiestos', () => {
    test('el aviso se cuelga de la pestaña, no del body', () => {
        document.body.innerHTML = '<div id="pane-conci-comercial"></div>';
        avisoEl({ titulo: 'Faltan minutos por asignar', texto: 'De los 35 min, 15 sin asignar.' });

        const pane = document.getElementById('pane-conci-comercial');
        const aviso = pane.querySelector('.conci-aviso');
        expect(aviso).not.toBeNull();
        // Colgado de la pestaña: si ésta se oculta, el aviso se va con ella.
        expect(aviso.closest('#pane-conci-comercial')).toBe(pane);
        expect(aviso.querySelector('.conci-aviso-titulo').textContent).toBe('Faltan minutos por asignar');
        expect(aviso.querySelector('.conci-aviso-texto').textContent).toContain('15 sin asignar');
    });

    test('sin la pestaña de manifiestos no se avisa en ningún lado', () => {
        document.body.innerHTML = '<div id="otro-modulo"></div>';
        expect(avisoEl({ titulo: 'Faltan minutos' })).toBeNull();
        expect(document.querySelector('.conci-aviso')).toBeNull();
    });

    test('no se amontonan: solo los tres últimos', () => {
        document.body.innerHTML = '<div id="pane-conci-comercial"></div>';
        for (const titulo of ['uno', 'dos', 'tres', 'cuatro']) avisoEl({ titulo });
        const titulos = [...document.querySelectorAll('.conci-aviso-titulo')].map(el => el.textContent);
        expect(titulos).toEqual(['dos', 'tres', 'cuatro']);
    });
});

describe('la tira de minutos no se arrastra de una celda a otra', () => {
    test('cada captura estrena tira: la anterior no queda escuchando', () => {
        document.body.innerHTML = '';
        const primera = tiraEl();
        let avisos = 0;
        primera.addEventListener('input', () => { avisos += 1; });

        const segunda = tiraEl();
        expect(document.querySelectorAll('#conci-demora-minutos')).toHaveLength(1);
        expect(segunda).not.toBe(primera);

        segunda.dispatchEvent(new Event('input', { bubbles: true }));
        expect(avisos).toBe(0);
    });
});

describe('el editor', () => {
    test('las flechas recorren la lista de códigos', () => {
        expect(EDITOR).toContain("const listaAbierta = !suggest.classList.contains('d-none') && currentMatches.length > 0;");
        expect(EDITOR).toContain('setActive(siguiente);');
    });

    test('y siguen sirviendo para cambiar de celda cuando la lista está cerrada', () => {
        // Escape cierra primero la lista; el segundo Escape ya cancela.
        expect(EDITOR).toMatch(/if \(!suggest\.classList\.contains\('d-none'\)\) \{\s*[\r\n]+\s*closeSuggest\(\);/);
        expect(EDITOR).toContain("closeEditor(true, event.key === 'ArrowUp' ? 'up' : 'down');");
    });

    test('Enter marca la sugerencia resaltada sin cerrar la captura', () => {
        expect(EDITOR).toMatch(/if \(activeIndex >= 0 && currentMatches\[activeIndex\]\) \{[\s\S]{0,80}pickMatch\(currentMatches\[activeIndex\]\);/);
    });

    test('escribir los minutos no da por terminada la captura', () => {
        expect(EDITOR).toContain('const destino = event.relatedTarget;');
        expect(EDITOR).toContain('if (destino && (minutosEl.contains(destino) || suggest.contains(destino))) return;');
    });

    test('lo que se guarda en la celda lleva letra y minutos', () => {
        expect(EDITOR).toContain('const joinedCodes = rawSeleccion();');
        expect(EDITOR).toContain('_conciFormatDemoraToken({ codigo, ...(extras.get(codigo) || {}) })');
    });

    test('el recuadro de texto sigue mostrando solo los códigos', () => {
        expect(EDITOR).toContain("input.value = selectedCodes.join(', ');");
    });

    test('quitar un código se lleva su reparto', () => {
        expect(EDITOR).toContain('extras.delete(option.codigo);');
    });

    test('la letra se escribe, y puede ser cualquiera', () => {
        expect(EDITOR).toContain('class="conci-demora-min-letra"');
        expect(EDITOR).toContain("const limpio = campo.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 1);");
    });

    test('marcar un código deja el cursor en su letra: no hace falta el mouse', () => {
        expect(EDITOR).toContain('if (agregado) enfocarChip(option.codigo);');
        expect(EDITOR).toContain('if (!enfocarCampo(campoDe(codigo, true))) enfocarCampo(campoDe(codigo, false));');
    });

    test('la letra no detiene a nadie: Enter o → pasan a los minutos', () => {
        expect(EDITOR).toContain("if (esLetra && (event.key === 'Enter' || event.key === 'ArrowRight')) {");
        // Y escribirla también adelanta, que es una tecla menos.
        expect(EDITOR).toContain('if (limpio) enfocarCampo(campoDe(codigo, false));');
        // Tab recorre la tira y regresa al recuadro en vez de irse de la tabla.
        expect(EDITOR).toContain('const destino = campos[posicion + (event.shiftKey ? -1 : 1)];');
        expect(EDITOR).toContain('else input.focus();');
    });

    test('desde el recuadro se sube a la tira a corregir lo ya capturado', () => {
        // Lo capturado queda arriba de la lista: con la flecha de subir se
        // vuelve a la letra y a los minutos sin soltar el teclado.
        expect(EDITOR).toContain('const enfocarTira = () => {');
        expect(EDITOR).toContain('const ultimo = selectedCodes[selectedCodes.length - 1];');
        expect(EDITOR).toContain("if (event.key === 'ArrowUp' && activeIndex <= 0 && enfocarTira()) return;");
    });

    test('y de la tira se baja derecho al catálogo', () => {
        expect(EDITOR).toContain('if (currentMatches.length) setActive(0);');
    });

    test('← y → recorren los chips desde la orilla del campo', () => {
        expect(EDITOR).toContain("if (event.key === 'ArrowLeft' && alPrincipio && campos[posicion - 1]) {");
        expect(EDITOR).toContain("if (event.key === 'ArrowRight' && alFinal && campos[posicion + 1]) {");
    });

    test('borrar el código del recuadro lo desmarca del catálogo', () => {
        // Si no, el catálogo lo seguiría creyendo puesto y el siguiente Enter
        // lo quitaría en vez de volverlo a poner (y no pediría los minutos).
        expect(EDITOR).toContain('const sincronizarSeleccionConTexto = () => {');
        expect(EDITOR).toContain('selectedCodes = previos.filter(codigo => escritos.has(codigo));');
        expect(EDITOR).toContain('previos.forEach(codigo => { if (!escritos.has(codigo)) extras.delete(codigo); });');
        expect(EDITOR).toContain('sincronizarSeleccionConTexto();');
    });

    test('repintar la tira no da por terminada la captura', () => {
        expect(EDITOR).toContain('if (repintandoMinutos) return;');
    });

    test('al guardar avisa si los minutos no cuadran con la demora', () => {
        expect(EDITOR).toContain('repartidos !== totalFila');
        expect(EDITOR).toContain("titulo: 'Faltan minutos por asignar',");
        // Pero solo si se capturó algo: pasar de largo con Tab no avisa nada.
        expect(EDITOR).toContain('if (joinedCodes !== code && Number.isFinite(totalFila) && totalFila > 0');
        // Y ese aviso es de la pestaña, no un toast que siga al capturista
        // hasta otro módulo.
        expect(EDITOR).not.toContain('showNotification');
    });
});
