const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'Agenda 2026actu.xlsx');
const SQL_OUTPUT = path.join(ROOT, 'agenda_2026_corrige_fechas_nacimiento_20260728.sql');
const AUDIT_OUTPUT = path.join(ROOT, 'agenda_2026_corrige_fechas_nacimiento_20260728_auditoria.json');
const SHEET = 'Activos';
const MIN_YEAR = 1900;
const MAX_YEAR = 2010;

function normalizeHeader(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeEmployee(value) {
    return String(value ?? '').replace(/[’´`'Â]/g, '').replace(/\s+/g, '').trim();
}

function escapeSql(value) {
    return String(value).replace(/'/g, "''");
}

function isoDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateParts(value) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
    }
    if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        return parsed ? { year: parsed.y, month: parsed.m, day: parsed.d } : null;
    }
    const text = String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!text) return null;
    const monthNames = { ene: 1, enero: 1, jan: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, apr: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, aug: 8, sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12, dec: 12 };
    const named = text.match(/^(\d{1,2})\s*(?:de\s*)?([a-z]+)/);
    if (named && monthNames[named[2]]) return { year: null, month: monthNames[named[2]], day: Number(named[1]) };
    return null;
}

function isValidFullDate(parts) {
    return parts && parts.year >= MIN_YEAR && parts.year <= MAX_YEAR && Boolean(isoDate(parts.year, parts.month, parts.day));
}

function resolveBirthDate(row, columns) {
    const birthday = dateParts(row[columns.birthday]);
    if (isValidFullDate(birthday)) {
        return { iso: isoDate(birthday.year, birthday.month, birthday.day), method: 'cumpleanos_completo' };
    }
    const rawBirthday = String(row[columns.birthday] ?? '').trim();
    return {
        iso: 'Sin información',
        method: 'sin_fecha_inequivoca',
        reason: rawBirthday
            ? 'La columna Cumpleaños contiene un valor incompleto, inválido o con año no confiable'
            : 'La columna Cumpleaños está vacía'
    };
}

const workbook = XLSX.readFile(INPUT, { cellDates: true, raw: true });
const worksheet = workbook.Sheets[SHEET];
if (!worksheet) throw new Error(`No existe la hoja ${SHEET}`);
const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: true });
const headers = rows[1].map(normalizeHeader);
const findColumn = expected => {
    const index = headers.indexOf(normalizeHeader(expected));
    if (index < 0) throw new Error(`No se encontro la columna ${expected}`);
    return index;
};
const columns = {
    employee: findColumn('No. Empleado'),
    name: findColumn('Nombre'),
    birthday: findColumn('Cumpleaños'),
};

const auditRows = [];
for (let index = 2; index < rows.length; index++) {
    const row = rows[index];
    const employee = normalizeEmployee(row[columns.employee]);
    if (!employee) continue;
    const resolution = resolveBirthDate(row, columns);
    auditRows.push({
        excelRow: index + 3,
        employee,
        name: String(row[columns.name] ?? '').trim(),
        birthDate: resolution.iso,
        method: resolution.method,
        reason: resolution.reason || null
    });
}

const duplicateEmployees = [...new Set(auditRows.map(row => row.employee).filter((employee, index, all) => all.indexOf(employee) !== index))];
const unresolved = auditRows.filter(row => row.birthDate === 'Sin información');
if (duplicateEmployees.length) throw new Error(`Numeros de empleado duplicados: ${duplicateEmployees.join(', ')}`);

const methodCounts = auditRows.reduce((counts, row) => {
    counts[row.method] = (counts[row.method] || 0) + 1;
    return counts;
}, {});
const audit = {
    source: path.basename(INPUT),
    sheet: SHEET,
    officialColumn: 'Cumpleaños',
    generatedAt: new Date().toISOString(),
    totalEmployees: auditRows.length,
    uniqueEmployees: new Set(auditRows.map(row => row.employee)).size,
    resolvedWithDate: auditRows.length - unresolved.length,
    markedWithoutDate: unresolved.length,
    unresolvedEmployees: unresolved.map(({ employee, name, reason }) => ({ employee, name, reason })),
    duplicateEmployees,
    methodCounts,
    onlyDatabaseFieldUpdated: 'Fecha de nacimiento',
    rows: auditRows
};
fs.writeFileSync(AUDIT_OUTPUT, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

const values = auditRows.map(row => `  ('${escapeSql(row.employee)}', '${escapeSql(row.name)}', '${row.birthDate}')`).join(',\n');
const sql = `-- Correccion masiva de fechas de nacimiento en public.agenda_2026\n-- Fuente unica: ${path.basename(INPUT)}, hoja ${SHEET}, columna Cumpleaños.\n-- Generado: ${new Date().toISOString()}\n-- Alcance estricto: solo actualiza \"Fecha de nacimiento\"; no inserta ni elimina registros.\n\nBEGIN;\n\nCREATE TEMP TABLE _fechas_nacimiento_fuente (\n  no_empleado text PRIMARY KEY,\n  nombre_excel text NOT NULL,\n  fecha_nacimiento text NOT NULL CHECK (fecha_nacimiento ~ '^\\d{4}-\\d{2}-\\d{2}$')\n) ON COMMIT DROP;\n\nINSERT INTO _fechas_nacimiento_fuente (no_empleado, nombre_excel, fecha_nacimiento) VALUES\n${values};\n\nDO $verify$\nDECLARE\n  fuente_count integer;\n  matched_count integer;\nBEGIN\n  SELECT count(*) INTO fuente_count FROM _fechas_nacimiento_fuente;\n  SELECT count(*) INTO matched_count\n  FROM _fechas_nacimiento_fuente f\n  JOIN public.agenda_2026 a\n    ON replace(replace(replace(btrim(a.\"No. Empleado\"::text), '´', ''''), '’', ''''), ' ', '') = f.no_empleado;\n  IF fuente_count <> ${auditRows.length} OR matched_count <> fuente_count THEN\n    RAISE EXCEPTION 'Cobertura incompleta: fuente %, coincidencias %', fuente_count, matched_count;\n  END IF;\nEND\n$verify$;\n\nUPDATE public.agenda_2026 AS a\nSET \"Fecha de nacimiento\" = f.fecha_nacimiento\nFROM _fechas_nacimiento_fuente AS f\nWHERE replace(replace(replace(btrim(a.\"No. Empleado\"::text), '´', ''''), '’', ''''), ' ', '') = f.no_empleado\n  AND a.\"Fecha de nacimiento\" IS DISTINCT FROM f.fecha_nacimiento;\n\nDO $verify$\nDECLARE\n  mismatch_count integer;\n  invalid_count integer;\nBEGIN\n  SELECT count(*) INTO mismatch_count\n  FROM _fechas_nacimiento_fuente f\n  JOIN public.agenda_2026 a\n    ON replace(replace(replace(btrim(a.\"No. Empleado\"::text), '´', ''''), '’', ''''), ' ', '') = f.no_empleado\n  WHERE a.\"Fecha de nacimiento\" IS DISTINCT FROM f.fecha_nacimiento;\n\n  SELECT count(*) INTO invalid_count\n  FROM _fechas_nacimiento_fuente f\n  JOIN public.agenda_2026 a\n    ON replace(replace(replace(btrim(a.\"No. Empleado\"::text), '´', ''''), '’', ''''), ' ', '') = f.no_empleado\n  WHERE a.\"Fecha de nacimiento\" !~ '^\\d{4}-\\d{2}-\\d{2}$'\n     OR substring(a.\"Fecha de nacimiento\" from 1 for 4)::integer NOT BETWEEN ${MIN_YEAR} AND ${MAX_YEAR};\n\n  IF mismatch_count <> 0 OR invalid_count <> 0 THEN\n    RAISE EXCEPTION 'Validacion fallida: diferencias %, invalidas %', mismatch_count, invalid_count;\n  END IF;\nEND\n$verify$;\n\nCOMMIT;\n`;
const normalizedEmployeeSql = `replace(replace(replace(replace(replace(btrim(a."No. Empleado"::text), '´', ''), '’', ''), '''', ''), 'Â', ''), ' ', '')`;
const finalSql = sql
    .replace(
        `fecha_nacimiento text NOT NULL CHECK (fecha_nacimiento ~ '^\\d{4}-\\d{2}-\\d{2}$')`,
        () => `fecha_nacimiento text NOT NULL CHECK (fecha_nacimiento = 'Sin información' OR fecha_nacimiento ~ '^\\d{4}-\\d{2}-\\d{2}$')`
    )
    .replaceAll(`replace(replace(replace(btrim(a."No. Empleado"::text), '´', ''''), '’', ''''), ' ', '')`, () => normalizedEmployeeSql)
    .replace(
        `WHERE a."Fecha de nacimiento" !~ '^\\d{4}-\\d{2}-\\d{2}$'\n     OR substring(a."Fecha de nacimiento" from 1 for 4)::integer NOT BETWEEN ${MIN_YEAR} AND ${MAX_YEAR};`,
        () => `WHERE a."Fecha de nacimiento" <> 'Sin información'\n    AND (a."Fecha de nacimiento" !~ '^\\d{4}-\\d{2}-\\d{2}$'\n     OR substring(a."Fecha de nacimiento" from 1 for 4)::integer NOT BETWEEN ${MIN_YEAR} AND ${MAX_YEAR});`
    );
fs.writeFileSync(SQL_OUTPUT, finalSql, 'utf8');

console.log(JSON.stringify({ sql: path.basename(SQL_OUTPUT), audit: path.basename(AUDIT_OUTPUT), ...audit, rows: undefined }, null, 2));
