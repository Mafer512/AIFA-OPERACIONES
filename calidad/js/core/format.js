(function () {
  'use strict';
  /** format.js — Formatos es-MX y utilidades de fecha. */

  const LOCALE = 'es-MX';
  const TZ = 'America/Mexico_City';

  const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dfDate = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
  const dfTime = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  const dfShort = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', timeZone: TZ });
  const dfLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

  const num = (n) => nf0.format(n ?? 0);
  const dec = (n) => nf1.format(n ?? 0);
  const pct = (n, digits = 0) => `${(n ?? 0).toFixed(digits).replace('.', '.')}%`;
  const date = (d) => dfDate.format(new Date(d));
  const time = (d) => dfTime.format(new Date(d));
  const dateTime = (d) => `${date(d)} ${time(d)}`;
  const dayMonth = (d) => dfShort.format(new Date(d));
  const longDate = (d) => dfLong.format(new Date(d));

  function minutes(m) {
    if (m == null || Number.isNaN(m)) return '—';
    if (m < 60) return `${Math.round(m)} min`;
    return `${dec(m / 60)} h`;
  }

  function relative(d) {
    const diff = (Date.now() - new Date(d).getTime()) / 60000;
    if (diff < 1) return 'hace un momento';
    if (diff < 60) return `hace ${Math.round(diff)} min`;
    if (diff < 1440) return `hace ${Math.round(diff / 60)} h`;
    const days = Math.round(diff / 1440);
    return days === 1 ? 'ayer' : `hace ${days} días`;
  }

  /** yyyy-mm-dd para inputs type=date */
  function isoDay(d) {
    const x = new Date(d);
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  }

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  }

  SIGEC.define('core/format', { num, dec, pct, date, time, dateTime, dayMonth, longDate, minutes, relative, isoDay, startOfDay, endOfDay, addDays, initials });
})();
