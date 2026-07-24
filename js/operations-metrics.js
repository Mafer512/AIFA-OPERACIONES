(function attachOperationsMetrics(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AifaOperationsMetrics = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function createOperationsMetrics() {
    'use strict';

    const MONTHLY_FIELDS = Object.freeze([
        'comercial_ops',
        'comercial_pax',
        'general_ops',
        'general_pax',
        'carga_ops',
        'carga_tons'
    ]);

    function toFiniteNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function normalizeDateKey(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    }

    function getRowTimestamp(row) {
        const raw = row?.updated_at || row?.created_at;
        if (!raw) return Number.NEGATIVE_INFINITY;
        const timestamp = Date.parse(raw);
        return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    }

    function dedupeDailyRows(dailyRows) {
        const byDate = new Map();
        (Array.isArray(dailyRows) ? dailyRows : []).forEach((row, index) => {
            const date = normalizeDateKey(row?.date);
            if (!date) return;
            const existing = byDate.get(date);
            if (!existing) {
                byDate.set(date, { row, index });
                return;
            }
            const existingTimestamp = getRowTimestamp(existing.row);
            const candidateTimestamp = getRowTimestamp(row);
            if (candidateTimestamp > existingTimestamp
                || (candidateTimestamp === existingTimestamp && index > existing.index)) {
                byDate.set(date, { row, index });
            }
        });
        return Array.from(byDate.entries())
            .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
            .map(([, value]) => value.row);
    }

    function aggregateDailyRowsByMonth(dailyRows) {
        const byMonth = new Map();
        dedupeDailyRows(dailyRows).forEach((row) => {
            const date = normalizeDateKey(row?.date);
            if (!date) return;
            const year = Number(date.slice(0, 4));
            const month = Number(date.slice(5, 7));
            if (!Number.isFinite(year) || month < 1 || month > 12) return;
            const key = `${year}-${String(month).padStart(2, '0')}`;
            if (!byMonth.has(key)) {
                const initial = {
                    year,
                    month,
                    is_official: false,
                    _source: 'daily',
                    _daily_days: 0,
                    _last_daily_date: date,
                    _field_counts: Object.create(null)
                };
                MONTHLY_FIELDS.forEach((field) => {
                    initial[field] = 0;
                    initial._field_counts[field] = 0;
                });
                byMonth.set(key, initial);
            }

            const aggregate = byMonth.get(key);
            aggregate._daily_days += 1;
            if (date > aggregate._last_daily_date) aggregate._last_daily_date = date;
            MONTHLY_FIELDS.forEach((field) => {
                const numeric = toFiniteNumber(row?.[field]);
                if (numeric === null) return;
                aggregate[field] += numeric;
                aggregate._field_counts[field] += 1;
            });
        });
        return byMonth;
    }

    function isSameCalendarMonth(year, month, referenceDate) {
        const reference = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
            ? referenceDate
            : new Date();
        return Number(year) === reference.getFullYear()
            && Number(month) === reference.getMonth() + 1;
    }

    function shouldUseDailyAggregate(monthlyRow, dailyAggregate, referenceDate) {
        if (!dailyAggregate || Number(dailyAggregate._daily_days || 0) <= 0) return false;
        if (!monthlyRow) return true;
        if (isSameCalendarMonth(dailyAggregate.year, dailyAggregate.month, referenceDate)) return true;
        return monthlyRow.is_official === false;
    }

    function mergeDailyAggregate(monthlyRow, dailyAggregate) {
        const merged = {
            ...(monthlyRow || {}),
            year: Number(dailyAggregate.year),
            month: Number(dailyAggregate.month),
            is_official: false,
            _source: 'daily',
            _daily_days: Number(dailyAggregate._daily_days || 0),
            _last_daily_date: dailyAggregate._last_daily_date || null
        };
        MONTHLY_FIELDS.forEach((field) => {
            const capturedCount = Number(dailyAggregate?._field_counts?.[field] || 0);
            if (capturedCount > 0) {
                merged[field] = Number(dailyAggregate[field]) || 0;
            } else if (!Object.prototype.hasOwnProperty.call(merged, field)) {
                merged[field] = null;
            }
        });
        return merged;
    }

    function resolveMonthlyOperationsRows(monthlyRows, dailyRows, referenceDate = new Date()) {
        const mergedByMonth = new Map();
        (Array.isArray(monthlyRows) ? monthlyRows : []).forEach((row) => {
            const year = Number(row?.year);
            const month = Number(row?.month);
            if (!Number.isFinite(year) || month < 1 || month > 12) return;
            const key = `${year}-${String(month).padStart(2, '0')}`;
            mergedByMonth.set(key, { ...row, year, month, _source: 'monthly' });
        });

        const dailyByMonth = aggregateDailyRowsByMonth(dailyRows);
        dailyByMonth.forEach((dailyAggregate, key) => {
            const monthlyRow = mergedByMonth.get(key) || null;
            if (!shouldUseDailyAggregate(monthlyRow, dailyAggregate, referenceDate)) return;
            mergedByMonth.set(key, mergeDailyAggregate(monthlyRow, dailyAggregate));
        });

        return Array.from(mergedByMonth.values()).sort((a, b) => (
            Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month)
        ));
    }

    function summarizeMetricValues(values) {
        const normalized = (Array.isArray(values) ? values : []).map((value) => toFiniteNumber(value));
        const available = normalized
            .map((value, index) => ({ value, index }))
            .filter((entry) => entry.value !== null);
        const total = available.reduce((sum, entry) => sum + entry.value, 0);
        let peakIndex = -1;
        let peakValue = null;
        available.forEach((entry) => {
            if (peakValue === null || entry.value > peakValue) {
                peakValue = entry.value;
                peakIndex = entry.index;
            }
        });
        return {
            values: normalized,
            count: available.length,
            total,
            average: available.length ? total / available.length : 0,
            peakIndex,
            peakValue,
            percentages: normalized.map((value) => (
                value !== null && total !== 0 ? (value / total) * 100 : 0
            ))
        };
    }

    return Object.freeze({
        MONTHLY_FIELDS,
        aggregateDailyRowsByMonth,
        dedupeDailyRows,
        isSameCalendarMonth,
        normalizeDateKey,
        resolveMonthlyOperationsRows,
        shouldUseDailyAggregate,
        summarizeMetricValues,
        toFiniteNumber
    });
});
