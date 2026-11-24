(function () {
  'use strict';
  /**
   * charts.js — Gráficas con Chart.js (vendorizado) usando los tokens CSS.
   * Reglas: una sola serie = un solo color; categorías en orden fijo;
   * estados con su color reservado; sin doble eje; tooltip siempre activo.
   */
  const { html } = SIGEC.use('core/dom');
  const { num } = SIGEC.use('core/format');
  const Chart = window.Chart;

  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const color = (t) => (t.startsWith('#') || t.startsWith('rgb') ? t : tok(t.startsWith('--') ? t : `--${t}`));

  function alpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function applyChartTheme() {
    if (!Chart) return;
    const d = Chart.defaults;
    d.font.family = tok('--font') || 'Montserrat, system-ui, sans-serif';
    d.font.size = 12;
    d.color = tok('--chart-axis');
    d.borderColor = tok('--chart-grid');
    d.maintainAspectRatio = false;
    d.responsive = true;
    d.animation.duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
    d.plugins.legend.display = false;
    const tt = d.plugins.tooltip;
    tt.backgroundColor = tok('--surface');
    tt.titleColor = tok('--ink');
    tt.bodyColor = tok('--ink-2');
    tt.borderColor = tok('--border-strong');
    tt.borderWidth = 1;
    tt.padding = 10;
    tt.cornerRadius = 8;
    tt.titleFont = { weight: '700', size: 12.5 };
    tt.bodyFont = { size: 12.5 };
    tt.boxPadding = 4;
    tt.usePointStyle = true;
  }

  /** Registro por vista: destruye todo al salir de la vista o re-renderizar. */
  class ChartSet {
    constructor() { this.items = []; }
    add(c) { if (c) this.items.push(c); return c; }
    destroy() { this.items.forEach((c) => c.destroy()); this.items = []; }
  }

  // Etiquetas de valor al extremo de la barra (selectivas, en tinta de texto)
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts?.enabled) return;
      const { ctx } = chart;
      const horizontal = chart.options.indexAxis === 'y';
      ctx.save();
      ctx.font = `600 11.5px ${tok('--font')}`;
      ctx.fillStyle = tok('--ink-2');
      chart.data.datasets.forEach((ds, di) => {
        chart.getDatasetMeta(di).data.forEach((bar, i) => {
          const v = ds.data[i];
          if (v == null) return;
          const label = opts.format ? opts.format(v) : num(v);
          if (horizontal) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, bar.x + 6, bar.y); }
          else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(label, bar.x, bar.y - 4); }
        });
      });
      ctx.restore();
    },
  };

  // Línea vertical guía al pasar el cursor (series de tiempo)
  const crosshair = {
    id: 'crosshair',
    afterDraw(chart) {
      const act = chart.tooltip?.getActiveElements?.();
      if (!act?.length) return;
      const x = act[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = tok('--border-strong');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.restore();
    },
  };

  const gridColor = () => tok('--chart-grid');

  function barChart(canvas, { labels, values, horizontal = false, tone = 'c1', format, max, label = 'Valor', suggestedMax }) {
    const c = color(tone);
    return new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label, data: values, backgroundColor: c, hoverBackgroundColor: alpha(c, .82), borderRadius: 4, borderSkipped: 'start', maxBarThickness: horizontal ? 18 : 44, barPercentage: .72, categoryPercentage: .8 }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        layout: { padding: horizontal ? { right: 34 } : { top: 18 } },
        scales: {
          x: horizontal
            ? { beginAtZero: true, max, suggestedMax, grid: { color: gridColor() }, border: { display: false }, ticks: { callback: (v) => (format ? format(v) : num(v)), maxTicksLimit: 6 } }
            : { grid: { display: false }, border: { color: tok('--border-strong') }, ticks: { autoSkip: false, maxRotation: 0, callback(v) { return wrap(this.getLabelForValue(v), 14); } } },
          y: horizontal
            ? { grid: { display: false }, border: { display: false }, ticks: { color: tok('--ink-2'), font: { weight: '500' } } }
            : { beginAtZero: true, max, suggestedMax, grid: { color: gridColor() }, border: { display: false }, ticks: { maxTicksLimit: 6, callback: (v) => (format ? format(v) : num(v)) } },
        },
        plugins: {
          valueLabels: { enabled: true, format },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${format ? format(ctx.parsed[horizontal ? 'x' : 'y']) : num(ctx.parsed[horizontal ? 'x' : 'y'])}` } },
        },
      },
      plugins: [valueLabels],
    });
  }

  function lineChart(canvas, { labels, series, format, min, max, suggestedMin }) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: series.map((s) => {
          const c = color(s.tone || 'c1');
          return {
            label: s.label,
            data: s.data,
            borderColor: c,
            backgroundColor: s.fill ? alpha(c, .10) : c,
            fill: !!s.fill,
            borderWidth: 2,
            borderDash: s.dashed ? [5, 4] : [],
            tension: .3,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: tok('--surface'),
            pointBackgroundColor: c,
            spanGaps: true,
            order: s.dashed ? 2 : 1,
          };
        }),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { color: tok('--border-strong') }, ticks: { maxRotation: 0, autoSkipPadding: 18 } },
          y: { beginAtZero: min == null && suggestedMin == null, min, max, suggestedMin, grid: { color: gridColor() }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => (format ? format(v) : num(v)) } },
        },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y == null ? '—' : format ? format(ctx.parsed.y) : num(ctx.parsed.y)}` } },
        },
      },
      plugins: [crosshair],
    });
  }

  function donutChart(canvas, { labels, values, tones, format }) {
    return new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: tones.map(color), borderColor: tok('--surface'), borderWidth: 2, hoverOffset: 5, borderRadius: 3 }] },
      options: {
        cutout: '70%',
        plugins: {
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${format ? format(ctx.parsed) : num(ctx.parsed)}` } },
        },
      },
    });
  }

  function wrap(text, max) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    words.forEach((w) => {
      if ((line + ' ' + w).trim().length > max && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
    });
    if (line) lines.push(line);
    return lines;
  }

  // ------------------------------------------------------- Tarjeta de gráfica
  /**
   * Tarjeta con botón "ver como tabla" (accesibilidad: identidad nunca solo por color).
   * Al montarse, usar bindChartTable(cardEl, columns, rows).
   */
  function chartCard({ id, title, sub, legend, size = '', banded = true, body }) {
    return html`<section class="card-x ${banded ? 'card-x--banded' : ''}" id="${id}" aria-labelledby="${id}-t">
      <div class="card-x__head">
        <h3 id="${id}-t">${title}</h3>${sub ? html`<span class="sub">${sub}</span>` : ''}
        <div class="card-x__actions">
          ${legend || ''}
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-table aria-pressed="false" title="Ver como tabla" aria-label="Ver datos de ${title} como tabla"><i class="bi bi-table" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="card-x__body">
        <div data-chart-area>${body || html`<div class="chart-box ${size}"><canvas role="img" aria-label="Gráfica: ${title}"></canvas></div>`}</div>
        <div data-table-area hidden></div>
      </div>
    </section>`;
  }

  function bindChartTable(card, columns, rows) {
    const btn = card.querySelector('[data-toggle-table]');
    const chartArea = card.querySelector('[data-chart-area]');
    const tableArea = card.querySelector('[data-table-area]');
    const t = document.createElement('table');
    t.className = 'chart-table';
    const thead = t.createTHead().insertRow();
    columns.forEach((c) => { const th = document.createElement('th'); th.textContent = c.label; if (c.num) th.className = 'num'; thead.appendChild(th); });
    const tb = t.createTBody();
    rows.forEach((r) => {
      const tr = tb.insertRow();
      columns.forEach((c) => { const td = tr.insertCell(); td.textContent = c.value(r); if (c.num) td.className = 'num'; });
    });
    tableArea.replaceChildren(t);
    btn.addEventListener('click', () => {
      const show = tableArea.hidden;
      tableArea.hidden = !show;
      chartArea.hidden = show;
      btn.setAttribute('aria-pressed', String(show));
    });
  }

  SIGEC.define('core/charts', { tok, applyChartTheme, ChartSet, barChart, lineChart, donutChart, chartCard, bindChartTable });
})();
