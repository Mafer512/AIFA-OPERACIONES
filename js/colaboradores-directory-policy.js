(function (root, factory) {
    'use strict';

    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ColaboradoresDirectoryPolicy = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const REASONS = Object.freeze({
        VACANCY: 'vacante',
        TERMINATED: 'baja',
        COMMISSIONED_OUT: 'comisionado_fuera',
        DUPLICATE: 'duplicado',
        OTHER: 'otro',
    });

    const SEMANTIC_FIELDS = Object.freeze({
        employeeNumber: 'num',
        name: 'nombre',
        status: 'estatus',
        terminationDate: 'fecha_baja',
        curp: 'curp',
        rfc: 'rfc',
        gender: 'sexo',
        commissioned: 'comisionado',
        commissionedDirection: 'direccion_comisionado',
        commissionedSubdirection: 'subdireccion_comisionado',
        commissionedManagement: 'gerencia_comisionado',
        commissionedCoordination: 'coordinacion_comisionado',
    });

    function normalize(value) {
        return String(value == null ? '' : value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVacancyName(value) {
        const name = normalize(value).replace(/[._-]+/g, ' ');
        if (!name) return false;

        return /^(vacante|plaza vacante|plaza disponible|sin asignar|por contratar|pendiente de cubrir)(?:\s|$)/.test(name);
    }

    function isMissingPersonName(value) {
        const name = normalize(value);
        return !name || /^(n\/?a|na|sin nombre|pendiente|no aplica|-+)$/.test(name);
    }

    function toFourDigitYear(year) {
        if (year >= 100) return year;
        return year >= 70 ? 1900 + year : 2000 + year;
    }

    function makeUtcDate(year, month, day) {
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() !== year
            || date.getUTCMonth() !== month - 1
            || date.getUTCDate() !== day
        ) {
            return null;
        }
        return date;
    }

    function parseDate(value) {
        if (value == null || value === '') return null;

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return makeUtcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
        }

        const raw = String(value).trim();
        if (!raw) return null;

        // Serial de fecha de Excel (base 1899-12-30).
        if (/^\d{5}(?:\.\d+)?$/.test(raw)) {
            const serial = Number(raw);
            const milliseconds = Math.round((serial - 25569) * 86400000);
            const excelDate = new Date(milliseconds);
            return Number.isNaN(excelDate.getTime()) ? null : excelDate;
        }

        let match = raw.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)(?:[T\s].*)?$/);
        if (match) {
            return makeUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
        }

        match = raw.match(/^([0-3]?\d)[-/]([0-3]?\d)[-/](\d{2}|\d{4})$/);
        if (!match) return null;

        const first = Number(match[1]);
        const second = Number(match[2]);
        const year = toFourDigitYear(Number(match[3]));

        // agenda_2026 proviene de Excel y sus textos usan M/D/A. Cuando el
        // primer componente supera 12, se reconoce el caso inequívoco D/M/A.
        const day = first > 12 ? first : second;
        const month = first > 12 ? second : first;
        return makeUtcDate(year, month, day);
    }

    function isEffectiveTerminationDate(value, today) {
        const terminationDate = parseDate(value);
        if (!terminationDate) return false;

        const referenceDate = parseDate(today) || parseDate(new Date());
        return terminationDate.getTime() <= referenceDate.getTime();
    }

    function isMeaningfulAssignment(value) {
        const assignment = normalize(value).replace(/[.]+/g, '').trim();
        return Boolean(assignment) && !/^(?:0|no|n\/?a|na|-+)$/.test(assignment);
    }

    function isOperationalAreaDestination(value) {
        const destination = normalize(value)
            .replace(/[.]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        return /^(?:direccion (?:de )?operacion|dir opn|subdireccion general operativa|sgo|subdireccion (?:de )?(?:seguridad operacional|seguridad (?:de la )?aviacion|gestion energetica|ingenieria|servicios conexos)|sso|ssa|sge|si|ssc)$/.test(destination);
    }

    function isCommissionedOut(record, get) {
        const commissioned = normalize(get(record, SEMANTIC_FIELDS.commissioned));
        const destinationFields = [
            SEMANTIC_FIELDS.commissionedDirection,
            SEMANTIC_FIELDS.commissionedSubdirection,
            SEMANTIC_FIELDS.commissionedManagement,
            SEMANTIC_FIELDS.commissionedCoordination,
        ];
        const destinations = destinationFields
            .map(field => normalize(get(record, field)))
            .filter(isMeaningfulAssignment);
        const values = [commissioned, ...destinations].filter(Boolean);

        if (!values.length) return false;

        const joined = values.join(' | ');

        // Una persona externa comisionada hacia el área sí integra el total operativo.
        if (/(?:comisionad[oa]|extern[oa]).*(?:dentro|entrada|hacia (?:el )?area|hacia aifa|en apoyo al area)/.test(joined)) {
            return false;
        }

        const explicitlyOutside = values.some(value => (
            /^(?:fuera|salida|comisionad[oa] fuera|comision fuera)$/.test(value)
            || /(?:comisionad[oa]|comision)\s+(?:hacia\s+)?fuera/.test(value)
            || /fuera\s+(?:del|de la)\s+(?:area|directorio|aifa)/.test(value)
            || /comision\s+externa(?:\s+de\s+salida)?/.test(value)
        ));
        if (explicitlyOutside) return true;

        const hasCommission = /^(?:1|si|true|comisionad[oa])$/.test(commissioned)
            || /\bcomisionad[oa]\b/.test(commissioned);
        if (!hasCommission || !destinations.length) return false;

        // El primer nivel de destino disponible define la adscripción operativa
        // actual. Esto distingue salidas de Operación de entradas hacia Operación.
        return !isOperationalAreaDestination(destinations[0]);
    }

    /* Una "M" suelta no dice nada por sí sola: en unas capturas es Masculino y
       en otras Mujer, y darla por hombre metía mujeres en el conteo de hombres.
       Aquí solo se resuelve lo que no admite dos lecturas; la "M" se deja
       pendiente para que la decida el CURP (ver resolveGender). */
    function normalizeGender(value) {
        const gender = normalize(value);
        if (['masculino', 'hombre', 'varon', 'h'].includes(gender)) return 'H';
        if (['femenino', 'mujer', 'f'].includes(gender)) return 'M';
        return '?';
    }

    /* El CURP no tiene esa duda: su posición 11 es H de hombre o M de mujer. */
    function genderFromCurp(value) {
        const curp = normalize(value).replace(/[^a-z0-9]/g, '').toUpperCase();
        if (curp.length < 11) return '?';
        const letter = curp[10];
        if (letter === 'H') return 'H';
        if (letter === 'M') return 'M';
        return '?';
    }

    /** Sexo de un registro: manda lo capturado y el CURP resuelve lo ambiguo. */
    function resolveGender(record, get) {
        const written = normalizeGender(get(record, SEMANTIC_FIELDS.gender));
        if (written !== '?') return written;
        return genderFromCurp(get(record, SEMANTIC_FIELDS.curp));
    }

    /* Control de contratos numera las renovaciones con un sufijo: el 1551-2
       es el mismo 1551. Sin quitarlo, la misma persona entraba dos veces al
       directorio, a veces con datos distintos entre una fila y la otra. */
    function baseEmployeeNumber(value) {
        return String(value == null ? '' : value).replace(/[-/]\d{1,2}$/, '');
    }

    /* Número de renovación: el 1344-2 es el segundo contrato del 1344. */
    function renewalRank(value) {
        const match = String(value == null ? '' : value).match(/[-/](\d{1,2})$/);
        return match ? Number(match[1]) : 1;
    }

    /* Qué tan capturada está una fila, para desempatar entre dos renovaciones
       con el mismo número: la que trae los datos gana. */
    const COMPLETENESS_FIELDS = [
        SEMANTIC_FIELDS.gender, SEMANTIC_FIELDS.curp, SEMANTIC_FIELDS.rfc,
        SEMANTIC_FIELDS.name, SEMANTIC_FIELDS.status,
    ];

    function completeness(record, get) {
        return COMPLETENESS_FIELDS.reduce(
            (total, field) => total + (normalize(get(record, field)) ? 1 : 0), 0);
    }

    /** De dos filas de la misma persona, cuál debe quedarse en el directorio. */
    function preferRecord(candidate, current, get) {
        const rankCandidate = renewalRank(get(candidate, SEMANTIC_FIELDS.employeeNumber));
        const rankCurrent = renewalRank(get(current, SEMANTIC_FIELDS.employeeNumber));
        if (rankCandidate !== rankCurrent) return rankCandidate > rankCurrent ? candidate : current;
        return completeness(candidate, get) > completeness(current, get) ? candidate : current;
    }

    function strongIdentityKey(record, get) {
        const employeeNumber = normalize(get(record, SEMANTIC_FIELDS.employeeNumber))
            .replace(/[‐‑‒–—−]/g, '-')
            .replace(/[´`'’\s]/g, '');
        if (employeeNumber) return `num:${baseEmployeeNumber(employeeNumber)}`;

        const curp = normalize(get(record, SEMANTIC_FIELDS.curp)).replace(/[^a-z0-9]/g, '');
        if (curp) return `curp:${curp}`;

        const rfc = normalize(get(record, SEMANTIC_FIELDS.rfc)).replace(/[^a-z0-9]/g, '');
        if (rfc) return `rfc:${rfc}`;

        return null;
    }

    function classifyRecord(record, options) {
        const get = options.get;
        const name = get(record, SEMANTIC_FIELDS.name);

        if (isVacancyName(name)) {
            return { included: false, reason: REASONS.VACANCY, detail: 'registro de vacante' };
        }

        if (isMissingPersonName(name)) {
            return { included: false, reason: REASONS.OTHER, detail: 'registro sin persona identificable' };
        }

        const status = normalize(get(record, SEMANTIC_FIELDS.status));
        if (status === 'baja') {
            return { included: false, reason: REASONS.TERMINATED, detail: 'estatus Baja' };
        }

        if (status !== 'activo') {
            return {
                included: false,
                reason: REASONS.OTHER,
                detail: status ? `estatus no activo: ${status}` : 'registro sin estatus',
            };
        }

        if (isEffectiveTerminationDate(get(record, SEMANTIC_FIELDS.terminationDate), options.today)) {
            return { included: false, reason: REASONS.TERMINATED, detail: 'fecha de baja vigente' };
        }

        if (isCommissionedOut(record, get)) {
            return { included: false, reason: REASONS.COMMISSIONED_OUT, detail: 'comisión explícita fuera del área' };
        }

        return { included: true, reason: null, detail: 'persona activa' };
    }

    function buildUniverse(records, options) {
        const source = Array.isArray(records) ? records : [];
        const settings = options || {};
        const get = typeof settings.get === 'function'
            ? settings.get
            : (record, field) => record && record[field];
        const today = settings.today || new Date();
        const included = [];
        const excluded = [];
        const seen = new Map(); // identidad -> posición dentro de included

        source.forEach(record => {
            const result = classifyRecord(record, { get, today });
            if (!result.included) {
                excluded.push({ record, reason: result.reason, detail: result.detail });
                return;
            }

            const identityKey = strongIdentityKey(record, get);
            if (identityKey && seen.has(identityKey)) {
                // Entre dos filas de la misma persona no puede ganar la que
                // llegó primero por casualidad: se queda la del contrato
                // vigente, y en un empate la que trae más datos capturados.
                const position = seen.get(identityKey);
                const previous = included[position];
                const loser = preferRecord(record, previous, get) === record ? previous : record;
                const winner = loser === record ? previous : record;
                included[position] = winner;
                excluded.push({ record: loser, reason: REASONS.DUPLICATE, detail: `identidad repetida: ${identityKey}` });
                return;
            }

            if (identityKey) seen.set(identityKey, included.length);
            included.push(record);
        });

        const reasonCounts = excluded.reduce((counts, item) => {
            counts[item.reason] = (counts[item.reason] || 0) + 1;
            return counts;
        }, {});

        const genderCounts = included.reduce((counts, record) => {
            const gender = resolveGender(record, get);
            counts[gender] += 1;
            return counts;
        }, { H: 0, M: 0, '?': 0 });

        return {
            included,
            excluded,
            summary: {
                sourceTotal: source.length,
                total: included.length,
                men: genderCounts.H,
                women: genderCounts.M,
                genderOther: genderCounts['?'],
                excluded: {
                    total: excluded.length,
                    vacancy: reasonCounts[REASONS.VACANCY] || 0,
                    terminated: reasonCounts[REASONS.TERMINATED] || 0,
                    commissionedOut: reasonCounts[REASONS.COMMISSIONED_OUT] || 0,
                    duplicate: reasonCounts[REASONS.DUPLICATE] || 0,
                    other: reasonCounts[REASONS.OTHER] || 0,
                },
            },
        };
    }

    return Object.freeze({
        REASONS,
        SEMANTIC_FIELDS,
        normalize,
        parseDate,
        normalizeGender,
        renewalRank,
        preferRecord,
        genderFromCurp,
        resolveGender,
        baseEmployeeNumber,
        isVacancyName,
        isOperationalAreaDestination,
        isCommissionedOut,
        classifyRecord,
        buildUniverse,
    });
});
