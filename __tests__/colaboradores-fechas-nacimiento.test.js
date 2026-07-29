const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const audit = JSON.parse(fs.readFileSync(path.join(root, 'agenda_2026_corrige_fechas_nacimiento_20260728_auditoria.json'), 'utf8'));
const sql = fs.readFileSync(path.join(root, 'agenda_2026_corrige_fechas_nacimiento_20260728.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

describe('correccion masiva de fechas de nacimiento', () => {
    test('cubre los 459 empleados del Excel sin duplicados', () => {
        expect(audit.totalEmployees).toBe(459);
        expect(audit.uniqueEmployees).toBe(459);
        expect(audit.duplicateEmployees).toEqual([]);
    });

    test('contiene 398 fechas oficiales y 61 casos sin informacion', () => {
        expect(audit.resolvedWithDate).toBe(398);
        expect(audit.markedWithoutDate).toBe(61);
        expect(audit.unresolvedEmployees).toHaveLength(61);
        expect(audit.rows.filter(row => row.birthDate === 'Sin información')).toHaveLength(61);
    });

    test('no introduce fechas ficticias ni formatos invalidos', () => {
        const forbidden = new Set(['00/01/1900', '01/01/1900', '1899-12-30', '1/0/00']);
        for (const row of audit.rows) {
            expect(forbidden.has(row.birthDate)).toBe(false);
            expect(row.birthDate === 'Sin información' || /^\d{4}-\d{2}-\d{2}$/.test(row.birthDate)).toBe(true);
        }
    });

    test('el SQL solamente actualiza Fecha de nacimiento', () => {
        const update = sql.match(/UPDATE public\.agenda_2026 AS a[\s\S]*?;/)?.[0] || '';
        expect(update).toContain('SET "Fecha de nacimiento" = f.fecha_nacimiento');
        expect(update.match(/\bSET\b/g)).toHaveLength(1);
        expect(update).not.toMatch(/\bINSERT INTO public\.agenda_2026|\bDELETE FROM public\.agenda_2026/);
    });

    test('el modulo muestra y edita la misma columna de fecha', () => {
        expect(html).toContain("onomastico:      find('^fecha\\\\s+de\\\\s+nacimiento$'");
        expect(html).toContain("fillField('cf-onomastico', colabFormatBirthDateDisplay(rawOnom))");
        expect(html).toContain("'ce-onomastico':'onomastico'");
        expect(html).toContain("'onomastico':'Onomástico'");
    });

    test('presenta fechas uniformes y los faltantes como Sin información', () => {
        expect(html).toContain('function colabFormatBirthDateDisplay(raw)');
        expect(html).toContain("? esc(colabFormatBirthDateDisplay(v))");
        expect(html).toContain("? colabFormatBirthDateDisplay(gc(c, colKey))");
        expect(sql).not.toContain('Sin fecha de nacimiento');
        expect(sql).toContain("'Sin información'");
    });
});
