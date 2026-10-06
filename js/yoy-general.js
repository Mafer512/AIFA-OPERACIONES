/**
 * YOY Comparativa — Aviación General
 * Uses: general_ops, general_pax from monthly_operations.
 */
(function () {
    let chart = null;
    let dataLoaded = false;
    let cache = [];
    let monthStatusCache = {}; // { 'year_month': 'oficial'|'preliminar' }
    let activeYears = new Set();
    let currentMetric = 'operaciones';
    let currentGranularity = 'mensual';
    let activeMonths = new Set([1,2,3,4,5,6,7,8,9,10,11,12]);

    const yearColors = {
        2022: '#06b3e8', 2023: '#ff9800', 2024: '#4caf50',
        2025: '#2196f3', 2026: '#e91e63', 'default': '#78909c'
    };

    const GRANULARITY_CONFIG = {
        mensual: { groups: [
            {label:'Ene',months:[1]},{label:'Feb',months:[2]},{label:'Mar',months:[3]},
            {label:'Abr',months:[4]},{label:'May',months:[5]},{label:'Jun',months:[6]},
            {label:'Jul',months:[7]},{label:'Ago',months:[8]},{label:'Sep',months:[9]},
            {label:'Oct',months:[10]},{label:'Nov',months:[11]},{label:'Dic',months:[12]}
        ]},
        bimestral: { groups: [
            {label:'Ene-Feb',months:[1,2]},{label:'Mar-Abr',months:[3,4]},
            {label:'May-Jun',months:[5,6]},{label:'Jul-Ago',months:[7,8]},
            {label:'Sep-Oct',months:[9,10]},{label:'Nov-Dic',months:[11,12]}
        ]},
        trimestral: { groups: [
            {label:'T1 (Ene-Mar)',months:[1,2,3]},{label:'T2 (Abr-Jun)',months:[4,5,6]},
            {label:'T3 (Jul-Sep)',months:[7,8,9]},{label:'T4 (Oct-Dic)',months:[10,11,12]}
        ]},
        semestral: { groups: [
            {label:'S1 (Ene-Jun)',months:[1,2,3,4,5,6]},{label:'S2 (Jul-Dic)',months:[7,8,9,10,11,12]}
        ]}
    };

    function getVal(yr, month) {
        const row = cache.find(function(d){ return d.year === yr && d.month === month; });
        if (!row) return null;
        return currentMetric === 'operaciones' ? (row.general_ops || 0) : (row.general_pax || 0);
    }
    function sumGroup(yr, months) {
        let t = 0, has = false;
        months.forEach(function(m){ const v = getVal(yr,m); if (v !== null){ t += v; has = true; } });
        return has ? t : null;
    }
    function isGroupComplete(yr, months) {
        return months.every(function(m){ return getVal(yr,m) !== null; });
    }
    function pctBadge(cur, prev, prevYr, sm) {
        if (!prev) return '';
        const g = ((cur - prev) / prev) * 100;
        const pos = g >= 0;
        const cls = pos ? 'text-success' : 'text-danger';
        const ic = pos ? '<i class="fas fa-caret-up"></i>' : '<i class="fas fa-caret-down"></i>';
        const sz = sm ? '0.75em' : '0.8em';
        return '<span class="small ms-2 ' + cls + '" style="font-size:' + sz + ';" title="vs ' + prevYr + '">' + ic + ' ' + Math.abs(g).toFixed(1) + '%</span>';
    }

    function buildYearsFilter(years) {
        const c = document.getElementById('gen-yoy-years');
        if (!c) return;
        c.innerHTML = '';
        years.forEach(function(yr){
            const w = document.createElement('div'); w.className = 'form-check form-switch';
            const inp = document.createElement('input');
            inp.className = 'form-check-input'; inp.type = 'checkbox';
            inp.id = 'gen-yoy-sw-' + yr; inp.value = yr; inp.checked = true;
            inp.addEventListener('change', function(e){
                if (e.target.checked) activeYears.add(parseInt(yr));
                else activeYears.delete(parseInt(yr));
                renderChart(); renderTable();
            });
            const lbl = document.createElement('label');
            lbl.className = 'form-check-label'; lbl.htmlFor = inp.id; lbl.textContent = yr;
            w.appendChild(inp); w.appendChild(lbl); c.appendChild(w);
        });
    }

    function updateTitle() {
        const el = document.getElementById('gen-yoy-chart-title');
        if (!el) return;
        el.innerHTML = currentMetric === 'operaciones'
            ? '<i class="fas fa-paper-plane me-2"></i>Comparativa de Operaciones — Aviación General'
            : '<i class="fas fa-user me-2"></i>Comparativa de Pasajeros — Aviación General';
    }

    function renderChart() {
        const canvas = document.getElementById('gen-yoy-chart');
        if (!canvas) return;
        if (chart) { chart.destroy(); chart = null; }
        if (!activeYears.size) return;
        const ctx = canvas.getContext('2d');
        const sorted = Array.from(activeYears).sort();
        const groups = GRANULARITY_CONFIG[currentGranularity].groups.filter(function(g){
            return g.months.every(function(m){ return activeMonths.has(m); });
        });
        if (!groups.length) return;
        var _chartTodayYear  = new Date().getFullYear();
        var _chartTodayMonth = new Date().getMonth() + 1;
        // Diferir si el contenedor aún no tiene dimensiones (tab oculto)
        var _parent = canvas.parentElement;
        if (_parent && (_parent.offsetWidth === 0 || _parent.offsetHeight === 0)) {
            setTimeout(renderChart, 120); return;
        }
        const datasets = sorted.map(function(yr, idx){
            const col = yearColors[yr] || yearColors['default'];
            const last = idx === sorted.length - 1;
            let bg = col + '20';
            if (last) { const g = ctx.createLinearGradient(0,0,0,400); g.addColorStop(0,col+'60'); g.addColorStop(1,col+'05'); bg=g; }
            return {
                label:'Año '+yr, data: groups.map(function(g){
                    if (yr === _chartTodayYear && g.months.some(function(m){ return m >= _chartTodayMonth; })) return null;
                    return sumGroup(yr, g.months);
                }),
                borderColor:col, backgroundColor:bg, borderWidth:last?3:2,
                pointRadius:last?4:0, pointBackgroundColor:'#fff', pointBorderColor:col,
                pointBorderWidth:2, pointHoverRadius:6, pointHoverBackgroundColor:col,
                pointHoverBorderColor:'#fff', pointHoverBorderWidth:3,
                fill:last, tension:0.4, order:last?0:1
            };
        });
        chart = new Chart(canvas, {
            type:'line',
            data:{ labels: groups.map(function(g){ return g.label; }), datasets:datasets },
            options:{
                responsive:true, maintainAspectRatio:false,
                animation:{duration:750,easing:'easeInOutQuart'},
                interaction:{mode:'index',intersect:false},
                plugins:{
                    datalabels:{ display:false },
                    legend:{ position:'top', align:'end', labels:{ usePointStyle:true, boxWidth:12, padding:15, font:{family:"'Inter','Segoe UI',sans-serif",size:13,weight:'600'}, color: (document.body.classList.contains('dark-mode') ? '#e8eaed' : '#334155') } },
                    tooltip:{
                        itemSort:function(a,b){ return b.datasetIndex-a.datasetIndex; },
                        backgroundColor:'rgba(30,41,59,0.95)', titleColor:'#f1f5f9', bodyColor:'#e2e8f0',
                        borderColor:'#475569', borderWidth:2, padding:14, boxPadding:8,
                        usePointStyle:true, cornerRadius:8,
                        titleFont:{size:14,weight:'bold',family:"'Inter',sans-serif"},
                        bodyFont:{size:13,family:"'Inter',sans-serif"},
                        callbacks:{
                            title:function(c){ return '📅 '+c[0].label; },
                            label:function(c){ return (c.dataset.label?c.dataset.label+': ':'')+( c.parsed.y!==null?'📊 '+new Intl.NumberFormat('es-MX').format(c.parsed.y):''); },
                            footer:function(c){ if(c.length>1){ const t=c.reduce(function(a,x){return a+(x.parsed.y||0);},0); return '📈 Total: '+new Intl.NumberFormat('es-MX').format(t); } return ''; }
                        }
                    }
                },
                scales:{
                    x:{ grid:{display:false,drawBorder:false}, ticks:{color:'#94a3b8',font:{family:"'Inter','Segoe UI',sans-serif",size:12}} },
                    y:{ beginAtZero:true, border:{display:false}, grid:{display:false,drawBorder:false},
                        ticks:{color:'#94a3b8',padding:10,font:{family:"'Inter','Segoe UI',sans-serif",size:11},
                        callback:function(v){ return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1000?(v/1000).toFixed(0)+'k':v; }} }
                }
            }
        });
        // Resize post-render: corrige tamaño si canvas se creó durante transición de tab
        setTimeout(function(){ try { if (chart) chart.resize(); } catch(_){} }, 160);
    }

    function renderTable() {
        const thead = document.querySelector('#gen-yoy-table > thead');
        const tbody = document.querySelector('#gen-yoy-table > tbody');
        if (!thead || !tbody) return;
        thead.innerHTML = ''; tbody.innerHTML = '';
        const yrs = Array.from(activeYears).sort();
        if (!yrs.length) { tbody.innerHTML = '<tr><td class="text-muted">No hay años seleccionados</td></tr>'; return; }
        const groups = GRANULARITY_CONFIG[currentGranularity].groups.filter(function(g){
            return g.months.every(function(m){ return activeMonths.has(m); });
        });
        if (!groups.length) { tbody.innerHTML = '<tr><td class="text-muted" colspan="10">Selecciona al menos un mes completo para el periodo elegido.</td></tr>'; return; }
        const hRow = document.createElement('tr');
        hRow.innerHTML = '<th>Periodo</th>' + yrs.map(function(y){ return '<th>'+y+'</th>'; }).join('');
        thead.appendChild(hRow);
        const grand = new Array(yrs.length).fill(0);
        const prevTot = new Array(yrs.length).fill(0);
        const curTot = new Array(yrs.length).fill(0);
        var _tblTodayYear  = new Date().getFullYear();
        var _tblTodayMonth = new Date().getMonth() + 1;
        groups.forEach(function(grp){
            const tr = document.createElement('tr');
            let html = '<td><strong>'+grp.label+'</strong></td>';
            let rowTotal = 0;
            var grpIsOpen = grp.months.some(function(m){ return m >= _tblTodayMonth; });
            yrs.forEach(function(yr, idx){
                const val = sumGroup(yr, grp.months);
                if (val === null) { html += '<td class="text-muted">–</td>'; return; }
                grand[idx] += val;
                rowTotal += val;
                const done = isGroupComplete(yr, grp.months);
                let pct = '';
                if (idx > 0 && done && !(yr === _tblTodayYear && grpIsOpen)) {
                    const pv = sumGroup(yrs[idx-1], grp.months);
                    if (pv !== null) { prevTot[idx] += pv; curTot[idx] += val; pct = pctBadge(val, pv, yrs[idx-1], true); }
                } else if (idx === 0 && done) { curTot[idx] += val; }
                html += '<td>'+new Intl.NumberFormat('es-MX').format(val)+pct+'</td>';
            });
            tr.innerHTML = html; tbody.appendChild(tr);
        });
        const tfRow = document.createElement('tr');
        tfRow.className = 'table-light fw-bold';
        let tot = '<td>TOTAL POR AÑO</td>';
        grand.forEach(function(t, idx){
            let pct = '';
            if (idx > 0 && prevTot[idx] > 0) {
                const g = ((curTot[idx] - prevTot[idx]) / prevTot[idx]) * 100;
                const pos = g >= 0;
                const cls = pos ? 'text-success' : 'text-danger';
                const arrow = pos ? '<i class="fas fa-arrow-up"></i>' : '<i class="fas fa-arrow-down"></i>';
                pct = '<br><span class="small '+cls+'" style="font-size:0.8em;" title="vs '+yrs[idx-1]+' (periodos cerrados)">'+arrow+' '+Math.abs(g).toFixed(1)+'%</span>';
            }
            tot += '<td>'+new Intl.NumberFormat('es-MX').format(t)+pct+'</td>';
        });
        const grandSum = grand.reduce(function(s,t){ return s+t; }, 0);
        tfRow.innerHTML = tot; tbody.appendChild(tfRow);

        // ACUMULADO row — single spanning cell
        var acumRow = document.createElement('tr');
        acumRow.className = 'table-secondary fw-bold';
        var acumSuffix = currentMetric === 'operaciones' ? 'Operaciones' : 'Pasajeros';
        acumRow.innerHTML = '<td class="fw-bold" style="background:#e2e8f0;">ACUMULADO HISTÓRICO</td><td colspan="'+yrs.length+'" class="text-center" style="background:#e2e8f0;font-size:1.05em;letter-spacing:0.3px;">'+new Intl.NumberFormat('es-MX').format(grandSum)+' <span class="fw-normal text-muted" style="font-size:0.8em;">'+acumSuffix+'</span></td>';
        tbody.appendChild(acumRow);
    }

    function renderNotes() {
        var MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        var today = new Date();
        var curYear = today.getFullYear();
        var officialMonths = [], prelimMonths = [];
        for (var m = 1; m <= 12; m++) {
            var st = monthStatusCache[curYear + '_' + m];
            if (st === 'oficial')    officialMonths.push(m);
            if (st === 'preliminar') prelimMonths.push(m);
        }
        var tableEl = document.getElementById('gen-yoy-table');
        if (!tableEl) return;
        var wrapper = tableEl.closest('.table-responsive') || tableEl.parentNode;
        var bar = document.getElementById('gen-yoy-notes-bar');
        if (!bar) { bar = document.createElement('div'); bar.id = 'gen-yoy-notes-bar'; wrapper.insertAdjacentElement('beforebegin', bar); }
        if (!officialMonths.length && !prelimMonths.length) { bar.innerHTML = ''; return; }
        var pills = '';
        if (officialMonths.length) {
            var first = MONTH_NAMES[officialMonths[0] - 1];
            var last  = MONTH_NAMES[officialMonths[officialMonths.length - 1] - 1];
            var range = officialMonths.length === 1 ? first : first + ' a ' + last;
            pills += '<span style="display:inline-flex;align-items:center;gap:6px;background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:20px;padding:5px 14px;font-size:0.8rem;font-weight:600;"><svg style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>Cifras oficiales &mdash; ' + range + ' ' + curYear + '</span>';
        }
        if (prelimMonths.length) {
            var pNames = prelimMonths.map(function(m){ return MONTH_NAMES[m - 1]; }).join(', ');
            pills += '<span style="display:inline-flex;align-items:center;gap:6px;background:#fef9c3;color:#a16207;border:1px solid #fde047;border-radius:20px;padding:5px 14px;font-size:0.8rem;font-weight:600;"><svg style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>Cifras preliminares &mdash; ' + pNames + ' ' + curYear + ' <span style="font-weight:400;opacity:0.75;margin-left:2px;">\u00b7 suma acumulada de registros diarios</span></span>';
        }
        bar.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 4px 8px;">' + pills + '</div>';
    }

    document.addEventListener('DOMContentLoaded', function () {
        const triggers = document.querySelectorAll('button[data-bs-target="#yoy-sub-general"]');
        triggers.forEach(function(btn){
            btn.addEventListener('shown.bs.tab', function(){
                const client = window.supabaseClient;
                if (!client) return;
                if (!dataLoaded) {
                    // Totales de la capa unificada (js/totales-service.js):
                    // oficial hasta el corte, Conciliación después.
                    window.TotalesService.filasMensuales().then(function(rows) {
                        monthStatusCache = {};
                        rows.forEach(function(row) {
                            monthStatusCache[row.year + '_' + row.month] = row.is_official ? 'oficial' : 'preliminar';
                        });
                        var merged = rows.slice();

                        cache = merged;
                        dataLoaded = true;
                        var years = Array.from(new Set(cache.map(function(d){ return d.year; }))).sort();
                        activeYears = new Set(years);
                        buildYearsFilter(years);
                        updateTitle();
                        renderChart();
                        renderTable();
                        renderNotes();
                        wireGranularity();
                        wireMetric();
                    });
                } else {
                    renderChart();
                    renderTable();
                    renderNotes();
                }
            });
        });

        function wireGranularity() {
            document.querySelectorAll('input[name="gen-yoy-granularity"]').forEach(function(r){
                r.addEventListener('change', function(e){
                    currentGranularity = e.target.value;
                    renderChart(); renderTable();
                });
            });
        }
        function wireMetric() {
            const sel = document.getElementById('gen-yoy-metric-select');
            if (sel) {
                sel.addEventListener('change', function(e){
                    currentMetric = e.target.value;
                    updateTitle(); renderChart(); renderTable();
                });
            }
        }
    });

    window.genYoyToggleMonth = function(mon, btn) {
        if (activeMonths.has(mon)) {
            if (activeMonths.size === 1) return;
            activeMonths.delete(mon);
            btn.classList.remove('active');
        } else {
            activeMonths.add(mon);
            btn.classList.add('active');
        }
        renderChart(); renderTable();
    };

    window.genYoyMonthPreset = function(preset) {
        const now = new Date();
        if (preset === 'ytd') {
            activeMonths = new Set(Array.from({length: now.getMonth() + 1}, function(_, i){ return i + 1; }));
        } else if (preset === 'h1') {
            activeMonths = new Set([1,2,3,4,5,6]);
        } else if (preset === 'h2') {
            activeMonths = new Set([7,8,9,10,11,12]);
        } else {
            activeMonths = new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
        }
        document.querySelectorAll('.gen-yoy-mon-btn').forEach(function(b) {
            if (activeMonths.has(parseInt(b.dataset.mon))) b.classList.add('active');
            else b.classList.remove('active');
        });
        renderChart(); renderTable();
    };

    /** Fuerza recarga de datos desde Supabase — llamado por realtime.js */
    window.genYoyReload = function() {
        dataLoaded = false;
        cache = [];
        monthStatusCache = {};
        var btn = document.querySelector('button[data-bs-target="#yoy-sub-general"][aria-selected="true"], button[data-bs-target="#yoy-sub-general"].active');
        if (btn) btn.dispatchEvent(new Event('shown.bs.tab'));
    };
})();
