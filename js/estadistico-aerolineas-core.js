/* Núcleo puro del Estadístico por Aerolínea.
 * Normaliza una sola vez y produce una agregación compartida por tarjetas,
 * gráfica, tabla y CSV. No depende del DOM ni modifica los datos de origen.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AirlineStatsCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MONTHS = Object.freeze([
        { number: 1, short: 'Ene', name: 'Enero' },
        { number: 2, short: 'Feb', name: 'Febrero' },
        { number: 3, short: 'Mar', name: 'Marzo' },
        { number: 4, short: 'Abr', name: 'Abril' },
        { number: 5, short: 'May', name: 'Mayo' },
        { number: 6, short: 'Jun', name: 'Junio' },
        { number: 7, short: 'Jul', name: 'Julio' },
        { number: 8, short: 'Ago', name: 'Agosto' },
        { number: 9, short: 'Sep', name: 'Septiembre' },
        { number: 10, short: 'Oct', name: 'Octubre' },
        { number: 11, short: 'Nov', name: 'Noviembre' },
        { number: 12, short: 'Dic', name: 'Diciembre' }
    ]);

    const METRICS = Object.freeze({
        pasajeros: Object.freeze({
            id: 'pasajeros',
            label: 'Pasajeros transportados',
            totalLabel: 'Total pasajeros',
            unit: 'pasajeros',
            valueKey: 'total',
            arrivalKey: 'arrivals',
            departureKey: 'departures'
        }),
        operaciones: Object.freeze({
            id: 'operaciones',
            label: 'Operaciones',
            totalLabel: 'Total operaciones',
            unit: 'operaciones',
            valueKey: 'operations',
            arrivalKey: 'arrivalOps',
            departureKey: 'departureOps'
        })
    });

    const DEFAULT_AIRLINE_COLOR = '#64748B';
    const AIRLINE_COLORS = Object.freeze({
        'VIVA AEROBUS': '#16A34A',
        VIVA: '#16A34A',
        VOLARIS: '#9C27B0',
        MEXICANA: '#C62828',
        AEROLITORAL: '#163A70',
        'AEROMEXICO CONNECT': '#163A70',
        ARAJET: '#6D28D9',
        AEROVIAS: '#0B2D5C',
        CONVIASA: '#E46C24',
        AERUS: '#A8D82E',
        MAGNICHARTERS: '#D71920',
        'GRIDIRON AIR': '#1F2937',
        'GLOBAL CROSSING AIRLINES': '#22CBD0',
        GLOBALX: '#22CBD0',
        'GLOBALX AIR': '#22CBD0',
        AEROREGIONAL: '#1B95D2'
    });
    const unknownAirlineWarnings = new Set();

    function parseNumber(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return { value: 0, valid: true, empty: true };
        }
        if (typeof value === 'number') {
            return Number.isFinite(value)
                ? { value, valid: true, empty: false }
                : { value: 0, valid: false, empty: false };
        }

        let normalized = String(value).trim().replace(/[\s\u00A0]/g, '');
        if (!/^[-+]?\d[\d.,]*$/.test(normalized)) {
            return { value: 0, valid: false, empty: false };
        }

        const comma = normalized.lastIndexOf(',');
        const dot = normalized.lastIndexOf('.');
        if (comma !== -1 && dot !== -1) {
            const decimalSeparator = comma > dot ? ',' : '.';
            const thousandsSeparator = decimalSeparator === ',' ? /\./g : /,/g;
            normalized = normalized.replace(thousandsSeparator, '');
            if (decimalSeparator === ',') normalized = normalized.replace(',', '.');
        } else if (comma !== -1) {
            normalized = /^[-+]?\d{1,3}(,\d{3})+$/.test(normalized)
                ? normalized.replace(/,/g, '')
                : normalized.replace(',', '.');
        } else if (dot !== -1 && /^[-+]?\d{1,3}(\.\d{3})+$/.test(normalized)) {
            normalized = normalized.replace(/\./g, '');
        }

        const number = Number(normalized);
        return Number.isFinite(number)
            ? { value: number, valid: true, empty: false }
            : { value: 0, valid: false, empty: false };
    }

    function normalizeAirlineLabel(value) {
        const label = String(value ?? '').trim().replace(/\s+/g, ' ');
        return label || 'Sin especificar';
    }

    function normalizeAirlineName(value) {
        return String(value ?? '')
            .trim()
            .toLocaleUpperCase('es-MX')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ');
    }

    function normalizeAirlineKey(value) {
        return normalizeAirlineName(value);
    }

    function getAirlineColor(airlineName) {
        const normalizedName = normalizeAirlineName(airlineName);
        const color = AIRLINE_COLORS[normalizedName];
        if (color) return color;

        if (!unknownAirlineWarnings.has(normalizedName)) {
            unknownAirlineWarnings.add(normalizedName);
            console.warn(
                `[Estadístico por Aerolínea] Color no configurado para "${normalizedName || 'SIN NOMBRE'}"; se utilizará el color neutro.`
            );
        }
        return DEFAULT_AIRLINE_COLOR;
    }

    function extractPeriod(row) {
        const explicitYear = Number(row?.year);
        const explicitMonth = Number(row?.month);
        if (Number.isInteger(explicitYear) && explicitYear >= 1900 && explicitYear <= 9999
            && Number.isInteger(explicitMonth) && explicitMonth >= 1 && explicitMonth <= 12) {
            return { year: String(explicitYear), month: explicitMonth };
        }

        if (row?.fecha instanceof Date && Number.isFinite(row.fecha.getTime())) {
            return { year: String(row.fecha.getFullYear()), month: row.fecha.getMonth() + 1 };
        }

        const match = String(row?.fecha ?? '').trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (!Number.isInteger(year) || year < 1900 || year > 9999 || month < 1 || month > 12) return null;
        return { year: match[1], month };
    }

    function createReport() {
        return {
            inputRows: 0,
            validRows: 0,
            invalidRows: 0,
            invalidValues: 0,
            negativeValues: 0,
            emptyAirlines: 0,
            exactDuplicates: 0,
            nameVariants: [],
            samples: []
        };
    }

    function reportIssue(report, type, detail) {
        report[type] += 1;
        if (report.samples.length < 20) report.samples.push({ type, ...detail });
    }

    function safeQuantity(value, field, rowIndex, report) {
        const parsed = parseNumber(value);
        if (!parsed.valid) {
            reportIssue(report, 'invalidValues', { row: rowIndex + 1, field });
            return 0;
        }
        if (parsed.value < 0) {
            reportIssue(report, 'negativeValues', { row: rowIndex + 1, field });
            return 0;
        }
        return parsed.value;
    }

    function normalizeRows(inputRows) {
        const report = createReport();
        const normalizedRows = [];
        const consolidatedFingerprints = new Set();
        const labelsByKey = new Map();
        const rows = Array.isArray(inputRows) ? inputRows : [];
        report.inputRows = rows.length;

        rows.forEach((row, rowIndex) => {
            if (!row || typeof row !== 'object') {
                reportIssue(report, 'invalidRows', { row: rowIndex + 1, reason: 'fila vacía' });
                return;
            }
            const period = extractPeriod(row);
            if (!period) {
                reportIssue(report, 'invalidRows', { row: rowIndex + 1, reason: 'año o mes inválido' });
                return;
            }

            const originalAirline = row.aerolinea ?? row.airline_name ?? row.airline_code;
            const airline = normalizeAirlineLabel(originalAirline);
            const airlineKey = normalizeAirlineKey(originalAirline);
            if (!String(originalAirline ?? '').trim()) reportIssue(report, 'emptyAirlines', { row: rowIndex + 1 });
            if (!labelsByKey.has(airlineKey)) labelsByKey.set(airlineKey, new Set());
            labelsByKey.get(airlineKey).add(airline);

            const hasConsolidatedTotals = row.pasajeros_total !== null && row.pasajeros_total !== undefined
                || row.operaciones_total !== null && row.operaciones_total !== undefined
                || String(row.tipo_operacion || '').toLocaleLowerCase('es-MX').includes('consolidado');
            const hasWideValues = row.pasajeros_llegada !== null && row.pasajeros_llegada !== undefined
                || row.pasajeros_salida !== null && row.pasajeros_salida !== undefined
                || row.operaciones_llegada !== null && row.operaciones_llegada !== undefined
                || row.operaciones_salida !== null && row.operaciones_salida !== undefined;

            const item = {
                year: period.year,
                month: period.month,
                airline,
                airlineKey,
                arrivals: 0,
                departures: 0,
                undivided: 0,
                arrivalOps: 0,
                departureOps: 0,
                undividedOps: 0,
                consolidated: hasConsolidatedTotals
            };

            if (hasConsolidatedTotals) {
                item.undivided = safeQuantity(row.pasajeros_total, 'pasajeros_total', rowIndex, report);
                item.undividedOps = safeQuantity(row.operaciones_total, 'operaciones_total', rowIndex, report);
            } else if (hasWideValues) {
                item.arrivals = safeQuantity(row.pasajeros_llegada, 'pasajeros_llegada', rowIndex, report);
                item.departures = safeQuantity(row.pasajeros_salida, 'pasajeros_salida', rowIndex, report);
                item.arrivalOps = row.operaciones_llegada !== null && row.operaciones_llegada !== undefined
                    ? safeQuantity(row.operaciones_llegada, 'operaciones_llegada', rowIndex, report)
                    : (item.arrivals > 0 ? 1 : 0);
                item.departureOps = row.operaciones_salida !== null && row.operaciones_salida !== undefined
                    ? safeQuantity(row.operaciones_salida, 'operaciones_salida', rowIndex, report)
                    : (item.departures > 0 ? 1 : 0);
            } else {
                const passengers = safeQuantity(row.pasajeros, 'pasajeros', rowIndex, report);
                const operations = row.operaciones !== null && row.operaciones !== undefined
                    ? safeQuantity(row.operaciones, 'operaciones', rowIndex, report)
                    : 1;
                const direction = String(row.tipo_operacion || '').toLocaleLowerCase('es-MX');
                if (direction.includes('lleg')) {
                    item.arrivals = passengers;
                    item.arrivalOps = operations;
                } else {
                    item.departures = passengers;
                    item.departureOps = operations;
                }
            }

            item.total = item.arrivals + item.departures + item.undivided;
            item.operations = item.arrivalOps + item.departureOps + item.undividedOps;

            if (item.consolidated) {
                const fingerprint = [
                    item.year, item.month, item.airlineKey, item.arrivals, item.departures,
                    item.undivided, item.arrivalOps, item.departureOps, item.undividedOps
                ].join('|');
                if (consolidatedFingerprints.has(fingerprint)) {
                    reportIssue(report, 'exactDuplicates', { row: rowIndex + 1, airline: item.airline, year: item.year, month: item.month });
                    return;
                }
                consolidatedFingerprints.add(fingerprint);
            }

            normalizedRows.push(item);
            report.validRows += 1;
        });

        report.nameVariants = [...labelsByKey.entries()]
            .map(([key, labels]) => ({ key, labels: [...labels].sort((a, b) => a.localeCompare(b, 'es')) }))
            .filter(entry => entry.labels.length > 1);

        return { rows: normalizedRows, report };
    }

    function getYears(rows) {
        return [...new Set((rows || []).map(row => String(row.year || '')).filter(year => /^\d{4}$/.test(year)))]
            .sort((a, b) => Number(b) - Number(a));
    }

    function getAvailableMetrics(rows) {
        const available = [];
        if ((rows || []).some(row => Number(row.total) > 0)) available.push('pasajeros');
        if ((rows || []).some(row => Number(row.operations) > 0)) available.push('operaciones');
        return available;
    }

    function metricValue(row, metric) {
        return metric === 'operaciones' ? Number(row.operations) || 0 : Number(row.total) || 0;
    }

    function getAvailableMonths(rows, year, metric) {
        return [...new Set((rows || [])
            .filter(row => row.year === String(year) && metricValue(row, metric) > 0)
            .map(row => row.month))]
            .filter(month => Number.isInteger(month) && month >= 1 && month <= 12)
            .sort((a, b) => a - b);
    }

    function aggregate(rows, filters = {}) {
        const metric = METRICS[filters.metric] ? filters.metric : 'pasajeros';
        const definition = METRICS[metric];
        const year = String(filters.year || '');
        const selectedMonths = [...new Set(Array.from(filters.months || []).map(Number))]
            .filter(month => Number.isInteger(month) && month >= 1 && month <= 12)
            .sort((a, b) => a - b);
        const selected = new Set(selectedMonths);
        const monthsWithData = new Set();
        const byAirline = new Map();
        let consolidated = false;

        (rows || []).forEach(row => {
            if (row.year !== year || !selected.has(row.month)) return;
            const value = metricValue(row, metric);
            if (value > 0) monthsWithData.add(row.month);
            if (!byAirline.has(row.airlineKey)) {
                byAirline.set(row.airlineKey, {
                    airline: row.airline,
                    airlineKey: row.airlineKey,
                    arrivals: 0,
                    departures: 0,
                    undivided: 0,
                    total: 0,
                    arrivalOps: 0,
                    departureOps: 0,
                    undividedOps: 0,
                    operations: 0
                });
            }
            const item = byAirline.get(row.airlineKey);
            item.arrivals += row.arrivals;
            item.departures += row.departures;
            item.undivided += row.undivided;
            item.total += row.total;
            item.arrivalOps += row.arrivalOps;
            item.departureOps += row.departureOps;
            item.undividedOps += row.undividedOps;
            item.operations += row.operations;
            if (row.consolidated && value > 0) consolidated = true;
        });

        const resultRows = [...byAirline.values()]
            .filter(item => Number(item[definition.valueKey]) > 0)
            .sort((a, b) => {
                const difference = b[definition.valueKey] - a[definition.valueKey];
                return difference || a.airline.localeCompare(b.airline, 'es', { sensitivity: 'base' });
            });
        const total = resultRows.reduce((sum, item) => sum + item[definition.valueKey], 0);
        const arrivalTotal = resultRows.reduce((sum, item) => sum + item[definition.arrivalKey], 0);
        const departureTotal = resultRows.reduce((sum, item) => sum + item[definition.departureKey], 0);
        resultRows.forEach((item, index) => {
            item.position = index + 1;
            item.value = item[definition.valueKey];
            item.participation = total > 0 ? (item.value / total) * 100 : 0;
            item.color = getAirlineColor(item.airline);
        });

        return {
            year,
            metric,
            definition,
            selectedMonths,
            monthsWithData: [...monthsWithData].sort((a, b) => a - b),
            rows: resultRows,
            total,
            arrivalTotal,
            departureTotal,
            activeAirlines: resultRows.length,
            top: resultRows[0] || null,
            consolidated
        };
    }

    function buildCsvRows(aggregation) {
        const result = aggregation || aggregate([], {});
        const monthLabels = result.selectedMonths.map(month => MONTHS[month - 1]?.short).filter(Boolean).join(' | ');
        const common = [result.year, result.definition.label, monthLabels];
        const percent = value => `${Number.isFinite(value) ? value.toFixed(2) : '0.00'}%`;

        if (result.consolidated) {
            return [
                ['Año', 'Indicador', 'Meses seleccionados', 'Posición', 'Aerolínea', 'Total', 'Participación'],
                ...result.rows.map(item => [...common, item.position, item.airline, item.value, percent(item.participation)]),
                [...common, '', 'TOTAL', result.total, result.total > 0 ? '100.00%' : '0.00%']
            ];
        }

        const arrivalLabel = result.metric === 'pasajeros' ? 'Llegadas' : 'Operaciones llegada';
        const departureLabel = result.metric === 'pasajeros' ? 'Salidas' : 'Operaciones salida';
        return [
            ['Año', 'Indicador', 'Meses seleccionados', 'Posición', 'Aerolínea', arrivalLabel, departureLabel, 'Total', 'Participación'],
            ...result.rows.map(item => [
                ...common,
                item.position,
                item.airline,
                item[result.definition.arrivalKey],
                item[result.definition.departureKey],
                item.value,
                percent(item.participation)
            ]),
            [...common, '', 'TOTAL', result.arrivalTotal, result.departureTotal, result.total, result.total > 0 ? '100.00%' : '0.00%']
        ];
    }

    return Object.freeze({
        MONTHS,
        METRICS,
        AIRLINE_COLORS,
        DEFAULT_AIRLINE_COLOR,
        parseNumber,
        normalizeAirlineLabel,
        normalizeAirlineName,
        normalizeAirlineKey,
        extractPeriod,
        normalizeRows,
        getYears,
        getAvailableMetrics,
        getAvailableMonths,
        getAirlineColor,
        aggregate,
        buildCsvRows
    });
});
