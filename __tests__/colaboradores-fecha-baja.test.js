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

    test('los guarda con el resto de la ficha', () => {
        const mapa = trozo('const COLAB_EDIT_FIELD_MAP = {', '};');
        expect(mapa).toContain("'ce-fecha-baja':'fecha_baja'");
        expect(mapa).toContain("'ce-motivo-baja':'motivo_baja'");
    });
});

describe('la ficha', () => {
    test('trae la fila de baja, oculta mientras no haya nada que mostrar', () => {
        document.body.innerHTML = '<table>' + trozo('<tr id="cf-row-baja"', '</tr>') + '</tr></table>';
        const fila = document.getElementById('cf-row-baja');
        expect(fila).not.toBeNull();
        expect(fila.style.display).toBe('none');
        expect(document.getElementById('cf-fecha-baja')).not.toBeNull();
        expect(document.getElementById('cf-motivo-baja')).not.toBeNull();
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
});
