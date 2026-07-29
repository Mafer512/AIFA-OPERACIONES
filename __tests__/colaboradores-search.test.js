const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name, from = 0) {
    const marker = `function ${name}(`;
    const start = html.indexOf(marker, from);
    if (start < 0) throw new Error(`No se encontro ${name}`);
    const bodyStart = html.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
    }
    throw new Error(`Funcion incompleta: ${name}`);
}

const collaboratorsSection = html.indexOf('TABLA COMPLETA DE COLABORADORES');
const context = {};
vm.createContext(context);
vm.runInContext(extractFunction('norm', html.indexOf('/* -- Normalizar texto')), context);
vm.runInContext(extractFunction('ctblRelevanciaBusqueda', collaboratorsSection), context);

function indexRecord(numero, nombre, puesto) {
    const normalizedNumber = context.norm(numero);
    const normalizedName = context.norm(nombre);
    const normalizedPosition = context.norm(puesto);
    const nameParts = normalizedName.split(' ').filter(Boolean);
    return {
        numero: normalizedNumber,
        nombre: normalizedName,
        puesto: normalizedPosition,
        primerNombre: nameParts[0] || '',
        apellidos: nameParts.slice(1),
        texto: `${normalizedNumber} ${normalizedName} ${normalizedPosition}`.trim()
    };
}

describe('busqueda local de colaboradores', () => {
    test.each(['O', 'Om', 'Oma', 'Omar'])(
        'encuentra desde el primer caracter: %s',
        query => {
            const record = indexRecord('402', 'Omar Sandoval Flores', 'Operador de Aerocares');
            expect(record.texto.includes(context.norm(query))).toBe(true);
        }
    );

    test('ignora mayusculas, acentos y espacios adicionales', () => {
        const record = indexRecord('41', '  Omar   Lopez   Salinas ', 'Tecnico de Operacion');
        expect(record.texto.includes(context.norm('  LÓPEZ  '))).toBe(true);
        expect(record.texto.includes(context.norm('TECNICO'))).toBe(true);
    });

    test('busca fragmentos de numero y puesto', () => {
        const record = indexRecord('1541-2', 'Omar Fabrizio Pizano Jaramillo', 'Tecnico de BHS');
        expect(record.numero.includes(context.norm('541-'))).toBe(true);
        expect(record.puesto.includes(context.norm('BHS'))).toBe(true);
    });

    test('ordena por numero exacto, nombre, apellido, contenido y puesto', () => {
        const q = context.norm('omar');
        const records = [
            indexRecord('1', 'Ana Perez', 'Ayudante Omar'),
            indexRecord('2', 'Ana Omar Perez', 'Analista'),
            indexRecord('3', 'Omar Sandoval', 'Operador'),
            indexRecord('omar', 'Zoe Perez', 'Analista')
        ];
        const ranks = records.map(record => context.ctblRelevanciaBusqueda(record, q));
        expect(ranks).toEqual([5, 2, 1, 0]);
        expect([...ranks].sort((a, b) => a - b)).toEqual([0, 1, 2, 5]);
    });

    test('el control descarta temporizadores de busquedas anteriores', () => {
        expect(html).toContain('const runId = ++ctblSearchRunId;');
        expect(html).toContain('if (runId !== ctblSearchRunId) return;');
        expect(html).toContain('}, 100);');
    });

    test('la busqueda local no realiza consultas a Supabase', () => {
        const filterStart = html.indexOf('window.colabTablaFiltrar = function()', collaboratorsSection);
        const filterEnd = html.indexOf('/** Actualiza barra de filtros activos */', filterStart);
        const filterSource = html.slice(filterStart, filterEnd);
        expect(filterSource).not.toMatch(/\.from\s*\(|ensureSupabaseClient|await\s+/);
        expect(filterSource).toContain('supabaseQueries: 0');
    });

    test('mantiene la tabla original sin paginacion ni controles adicionales', () => {
        expect(html).not.toMatch(/ctbl-pagination|ctbl-page-size|ctblIrPagina|ctblCambiarTamanoPagina/);
        expect(html).toContain('const html = ctblData.map((r, i) => {');
        expect(html).not.toContain('ctblData.slice(startIdx');
    });
});
