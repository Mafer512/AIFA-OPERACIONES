const {
  dedupeDailyRows,
  resolveMonthlyOperationsRows,
  summarizeMetricValues,
} = require('../js/operations-metrics');

const julyMonthlyRow = {
  year: 2026,
  month: 7,
  comercial_ops: 3052,
  comercial_pax: 360038,
  general_ops: 164,
  general_pax: 2450,
  carga_ops: 499,
  carga_tons: 15366.76,
  is_official: true,
};

const dailyThroughJuly22 = [
  {
    date: '2026-07-01',
    comercial_ops: 3388,
    comercial_pax: 401058,
    general_ops: 176,
    general_pax: 2497,
    carga_ops: 721,
    carga_tons: 21156,
  },
  {
    date: '2026-07-22',
    comercial_ops: 153,
    comercial_pax: 14038,
    general_ops: 4,
    general_pax: 4,
    carga_ops: 16,
    carga_tons: null,
  },
];

describe('operations monthly metric reconciliation', () => {
  test('the current month uses daily captures for all six cards even if the stale monthly row says official', () => {
    const resolved = resolveMonthlyOperationsRows(
      [julyMonthlyRow],
      dailyThroughJuly22,
      new Date('2026-07-24T12:00:00-06:00'),
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      year: 2026,
      month: 7,
      comercial_ops: 3541,
      comercial_pax: 415096,
      general_ops: 180,
      general_pax: 2501,
      carga_ops: 737,
      carga_tons: 21156,
      is_official: false,
      _source: 'daily',
      _last_daily_date: '2026-07-22',
    });
  });

  test('a newly captured day is included automatically without hardcoded card values', () => {
    const july23 = {
      date: '2026-07-23',
      comercial_ops: 175,
      comercial_pax: 25553,
      general_ops: 5,
      general_pax: 14,
      carga_ops: 43,
      carga_tons: 1082,
    };
    const [resolved] = resolveMonthlyOperationsRows(
      [julyMonthlyRow],
      [...dailyThroughJuly22, july23],
      new Date('2026-07-24T12:00:00-06:00'),
    );

    expect(resolved).toMatchObject({
      comercial_ops: 3716,
      comercial_pax: 440649,
      general_ops: 185,
      general_pax: 2515,
      carga_ops: 780,
      carga_tons: 22238,
      _last_daily_date: '2026-07-23',
    });
  });

  test('current-month reconciliation ignores daily rows from adjacent months', () => {
    const resolved = resolveMonthlyOperationsRows(
      [julyMonthlyRow],
      [
        {
          date: '2026-06-30',
          comercial_ops: 999,
          comercial_pax: 999999,
          general_ops: 999,
          general_pax: 999999,
          carga_ops: 999,
          carga_tons: 999999,
        },
        ...dailyThroughJuly22,
        {
          date: '2026-08-01',
          comercial_ops: 888,
          comercial_pax: 888888,
          general_ops: 888,
          general_pax: 888888,
          carga_ops: 888,
          carga_tons: 888888,
        },
      ],
      new Date('2026-07-24T12:00:00-06:00'),
    );

    const july = resolved.find((row) => row.year === 2026 && row.month === 7);
    expect(july).toMatchObject({
      comercial_ops: 3541,
      comercial_pax: 415096,
      general_ops: 180,
      general_pax: 2501,
      carga_ops: 737,
      carga_tons: 21156,
    });
  });

  test('a closed official month keeps its monthly consolidation', () => {
    const officialJune = { ...julyMonthlyRow, month: 6, comercial_pax: 593921 };
    const dailyJune = [{ ...dailyThroughJuly22[0], date: '2026-06-30', comercial_pax: 999999 }];
    const [resolved] = resolveMonthlyOperationsRows(
      [officialJune],
      dailyJune,
      new Date('2026-07-24T12:00:00-06:00'),
    );

    expect(resolved.comercial_pax).toBe(593921);
    expect(resolved.is_official).toBe(true);
    expect(resolved._source).toBe('monthly');
  });

  test('a preliminary closed month is rebuilt from daily captures', () => {
    const preliminaryJune = { ...julyMonthlyRow, month: 6, is_official: false };
    const dailyJune = [{ ...dailyThroughJuly22[0], date: '2026-06-30', comercial_pax: 600000 }];
    const [resolved] = resolveMonthlyOperationsRows(
      [preliminaryJune],
      dailyJune,
      new Date('2026-07-24T12:00:00-06:00'),
    );

    expect(resolved.comercial_pax).toBe(600000);
    expect(resolved._source).toBe('daily');
  });

  test('duplicate dates use the most recently created row and are never double-counted', () => {
    const rows = [
      { date: '2026-07-22', comercial_pax: 100, created_at: '2026-07-23T10:00:00Z' },
      { date: '2026-07-22', comercial_pax: 150, created_at: '2026-07-23T12:00:00Z' },
    ];

    expect(dedupeDailyRows(rows)).toEqual([rows[1]]);
    const [resolved] = resolveMonthlyOperationsRows([], rows, new Date('2026-07-24T12:00:00-06:00'));
    expect(resolved.comercial_pax).toBe(150);
    expect(resolved._daily_days).toBe(1);
  });
});

describe('derived card fields', () => {
  test('total, average, peak and percentages all use the corrected July series', () => {
    const values = [601184, 514583, 593095, 639049, 670381, 593921, 415096];
    const summary = summarizeMetricValues(values);

    expect(summary.total).toBe(4027309);
    expect(summary.average).toBeCloseTo(575329.8571428572, 6);
    expect(summary.peakIndex).toBe(4);
    expect(summary.peakValue).toBe(670381);
    expect(summary.percentages.map((value) => Number(value.toFixed(1))))
      .toEqual([14.9, 12.8, 14.7, 15.9, 16.6, 14.7, 10.3]);
  });

  test('zero is a valid captured month when calculating the average', () => {
    const summary = summarizeMetricValues([10, 0, null]);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(5);
  });
});
