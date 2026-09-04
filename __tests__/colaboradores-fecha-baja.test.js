/**
 * @jest-environment jsdom
 *
 * La política del directorio ya sabía leer la fecha de baja —quien la tiene
 * cumplida deja de contar en el Resumen—, pero no había dónde capturarla: se
 * quedaba en la hoja de Excel o en la base a mano. Aquí se cubre el camino
 * completo: la columna, el campo del editor y lo que muestra la ficha.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(raiz, 'db/agregar_fecha_baja.sql'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    return app.slice(i, j);
}

describe('la columna de baja', () => {
    test('el script de Supabase la crea sin romper nada si ya existe', () => {
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "Fecha de baja"\s+text/);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "Motivos de baja" text/);
        // Nada que borre o reescriba datos.
        expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
    });

    test('la aplicación detecta las dos columnas de la baja', () => {
        expect(app).toMatch(/fecha_baja:\s+find\('\^fecha/);
        expect(app).toMatch(/motivo_baja:\s+find\('\^motivos\?/);
    });
});

describe('el editor del colaborador', () => {
    test('tiene el campo de fecha y el de motivo', () => {
        document.body.innerHTML = trozo('<!-- TAB: Estatus -->', '<!-- TAB: Foto -->');
        const fecha = document.getElementById('ce-fecha-baja');
        const motivo = document.getElementById('ce-motivo-baja');
        expect(fecha).not.toBeNull();
        expect(fecha.getAttribute('type')).toBe('date');
        expect(motivo).not.toBeNull();
        // Y quedan junto al estatus, que es donde se decide la baja.
        expect(document.getElementById('ce-estatus')).not.toBeNull();
    });

    test('avisa si la columna todavía no existe en la base, en vez de tragarse el dato', () => {
        document.body.innerHTML = trozo('<!-- TAB: Estatus -->', '<!-- TAB: Foto -->');
        const aviso = document.getElementById('cedit-baja-sin-columna');
        expect(aviso).not.toBeNull();
        expect(aviso.className).toContain('d-none');
        expect(aviso.textContent).toContain('agregar_fecha_baja.sql');
        // Y el editor lo enciende al abrirse cuando falta la columna.
        expect(app).toContain("const hayColumna = Boolean(colabCols && colabCols.fecha_baja);");
    });

    test('la pestaña dice lo que trae dentro', () => {
        expect(app).toMatch(/id="cedit-tab-estatus"[^>]*>[\s\S]{0,120}Estatus y baja/);
    });

    test('si la columna no existe, el guardado avisa en vez de perder la captura', () => {
        const guardar = trozo('window.colabGuardarCambios = async function()', 'const cambioEstatus');
        expect(guardar).toContain("['ce-fecha-baja', 'fecha_baja', 'Fecha de baja']");
        expect(guardar).toMatch(/throw new Error\(/);
        expect(guardar).toContain('agregar_fecha_baja.sql');
    });

    test('hay un diagnóstico de consola para saber si la columna está', () => {
        expect(app).toContain('window.colabDiagnosticoBaja = function()');
        expect(app).toContain('columnasDeLaTablaQueHablanDeBaja');
    });

    test('comprueba en la base que la baja quedó escrita, no confía en el update', () => {
        const guardar = trozo('// Actualizar registro en agenda_2026', 'for (const oldDocument');
        expect(guardar).toContain("const colsBaja = ['fecha_baja', 'motivo_baja']");
        expect(guardar).toMatch(/select\('\*'\)\.eq\(safeNumCol, numEmpl\)/);
        expect(guardar).toContain('no tiene la columna');
        expect(guardar).toContain('La base no guardó');
        expect(guardar).toContain('fix_rls_colaboradores_edicion.sql');
    });

    test('una fecha con hora pegada (columna date o timestamp) también se lee', () => {
        const ctx = {};
        vm.createContext(ctx);
        vm.runInContext(trozo('function colabFechaISO(valor)', 'function colabEstatusChipHtml'), ctx);
        expect(ctx.colabFechaISO('2026-03-15T00:00:00+00:00')).toBe('2026-03-15');
        expect(ctx.colabFechaLarga('2026-03-15T06:00:00Z')).toBe('15 de marzo de 2026');
    });

    test('los guarda con el resto de la ficha', () => {
        const mapa = trozo('const COLAB_EDIT_FIELD_MAP = {', '};');
        expect(mapa).toContain("'ce-fecha-baja':'fecha_baja'");
        expect(mapa).toContain("'ce-motivo-baja':'motivo_baja'");
    });
});

describe('la ficha', () => {
    test('encabeza el expediente con el aviso de baja, oculto mientras no haga falta', () => {
        document.body.innerHTML = trozo('<section class="colab-baja-aviso"', '</section>') + '</section>';
        const aviso = document.getElementById('colab-baja-aviso');
        expect(aviso).not.toBeNull();
        expect(aviso.style.display).toBe('none');
        expect(aviso.querySelector('.colab-baja-titulo').textContent).toBe('Baja del personal');
        expect(document.getElementById('colab-baja-fecha')).not.toBeNull();
        // El motivo va aparte y solo se enciende cuando está capturado.
        expect(document.getElementById('colab-baja-motivo').hidden).toBe(true);
        expect(document.getElementById('colab-baja-motivo-txt')).not.toBeNull();
    });

    test('el aviso se enciende con la baja y se apaga con quien está activo', () => {
        const render = trozo('/* Aviso de baja. Encabeza el expediente', 'buildChips(c);');
        // Se lee del estatus y de lo capturado, no de una bandera aparte.
        expect(render).toContain("colabNormalizarEstatus(gc(c, 'estatus')) === 'Baja'");
        expect(render).toContain("gc(c, 'fecha_baja')");
        expect(render).toContain("val(gc(c, 'motivo_baja'))");
        expect(render).toMatch(/avisoBaja\.style\.display = visible \? '' : 'none'/);
        // El motivo lo escribe el usuario: va como texto, nunca como HTML.
        expect(render).toContain('motivoTxt.textContent = motivoBaja;');
    });

    test('las fechas van y vienen entre la base y el campo del navegador', () => {
        const ctx = {};
        vm.createContext(ctx);
        vm.runInContext(trozo('function colabFechaISO(valor)', 'function colabEstatusChipHtml'), ctx);

        // De la base a la pantalla.
        expect(ctx.colabFechaCorta('2026-03-15')).toBe('15/03/2026');
        expect(ctx.colabFechaCorta('')).toBe('');
        // Lo que no es una fecha reconocible se respeta tal cual.
        expect(ctx.colabFechaCorta('Pendiente')).toBe('Pendiente');

        // De la pantalla al campo <input type="date">.
        expect(ctx.colabFechaISO('15/03/2026')).toBe('2026-03-15');
        expect(ctx.colabFechaISO('2026-03-15')).toBe('2026-03-15');
        expect(ctx.colabFechaISO('Pendiente')).toBe('');
    });

    test('la fecha del aviso se lee en palabras y dice cuánto hace', () => {
        const ctx = {};
        vm.createContext(ctx);
        vm.runInContext(trozo('function colabFechaISO(valor)', 'function colabEstatusChipHtml'), ctx);

        expect(ctx.colabFechaLarga('2026-03-15')).toBe('15 de marzo de 2026');
        expect(ctx.colabFechaLarga('01/12/2025')).toBe('1 de diciembre de 2025');
        expect(ctx.colabFechaLarga('Pendiente')).toBe('');

        // Con la hora local, no en UTC: la función compara contra la medianoche
        // local, y de tarde en México toISOString() ya devuelve el día siguiente.
        const haceDias = dias => {
            const d = new Date();
            d.setDate(d.getDate() - dias);
            const dosDigitos = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
        };
        expect(ctx.colabHaceCuanto(haceDias(0))).toBe('hoy');
        expect(ctx.colabHaceCuanto(haceDias(1))).toBe('ayer');
        expect(ctx.colabHaceCuanto(haceDias(10))).toBe('hace 10 días');
        expect(ctx.colabHaceCuanto(haceDias(70))).toBe('hace 2 meses');
        expect(ctx.colabHaceCuanto(haceDias(800))).toBe('hace 2 años');
        // Una fecha futura no dice "hace"; simplemente no se comenta.
        expect(ctx.colabHaceCuanto('2099-01-01')).toBe('');
    });
});
