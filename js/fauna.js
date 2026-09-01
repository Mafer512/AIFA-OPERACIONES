// Fauna module: renders a full table from data/fauna.json, adds filters by date range and month, and charts
(function(){
  const state = {
    raw: [],
    filtered: [],
    columns: [],
    columnFilters: {}, // Added for column search
    charts: { byMonth: null, bySpecies: null, byHour: null, byWeather: null, heatmap: null },
    paging: { page: 1, perPage: 50, totalPages: 1 },
    eventsBound: false,
    isAdding: false,
    isLoading: false
  };

  const DB_MAPPING_IMPACTOS = {
    "Fecha": "date",
    "Hora": "time",
    "Ubicación": "location",
    "Zona de impacto": "impact_zone",
    "Fase de la operación": "operation_phase",
    "Aerolínea": "airline",
    "Aerolineas": "airline",
    "Aeronave": "aircraft",
    "Matrícula": "registration",
    "Matricula": "registration",
    "Zona de impacto resto": "impact_zone_remains",
    "Cantidad de restos": "remains_count",
    "Tamaño": "size",
    "Especie": "species",
    "Nombre común": "common_name",
    "Personal que reporta": "reporter",
    "Medidas proactivas": "proactive_measures",
    "Condiciones meteorológicas": "weather_conditions",
    "Resultados de las medidas": "measure_results"
  };


  const monthNames = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const monthNamesEs = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  function monthKeyToAbbr(ym){
    // ym = 'YYYY-MM'
    if (!ym || typeof ym !== 'string') return ym;
    const m = ym.split('-')[1];
    const idx = Math.max(0, Math.min(11, (parseInt(m,10)||1)-1));
    return monthNamesEs[idx];
  }
  function normalizeEs(str){
    return String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function parseDMY(str){
    // Expected DD/MM/YYYY
    if (!str || typeof str !== 'string') return null;
    const m = str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]) - 1, y = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo, d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  async function loadFauna(){
      try {
          const supabase = await window.ensureSupabaseClient();
          const { data, error } = await supabase
              .from('wildlife_strikes')
              .select('*')
              .order('id', { ascending: false });
          
          if (error) {
              console.warn('Error fetching wildlife_strikes, falling back to JSON or empty.', error);
              throw error; 
          }

          // Map snake_case DB fields to the Keys expected by the existing UI logic (Spanish, as in fauna.json)
          // Also format Date YYYY-MM-DD to DD/MM/YYYY
          return (data || []).map(item => {
              let fDate = '';
              if (item.date) {
                  let dateOnly = String(item.date);
                  if (dateOnly.includes('T')) dateOnly = dateOnly.split('T')[0];
                  const parts = dateOnly.split('-'); // YYYY-MM-DD
                  if (parts.length === 3) {
                      fDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                  } else {
                     // Check if it's already DD/MM/YYYY ?
                     if (/\d{2}\/\d{2}\/\d{4}/.test(dateOnly)) fDate = dateOnly;
                  }
              }
              
              let fTime = '';
              if (item.time) {
                  // HH:MM:SS -> HH:MM
                  fTime = item.time.substring(0, 5);
              }

              return {
                  "No.": String(item.id || ''),
                  "Fecha": fDate,
                  "Hora": fTime,
                  "Ubicación": item.location || '',
                  "Zona de impacto": item.impact_zone || '',
                  "Fase de la operación": item.operation_phase || '',
                  "Aerolineas": item.airline || '',       // Note: logic below normalizes "Aerolineas" -> "Aerolínea"
                  "Aeronave": item.aircraft || '',
                  "Matricula": item.registration || '',
                  "Zona de impacto resto": item.impact_zone_remains || '',
                  "Cantidad de restos": item.remains_count || '',
                  "Tamaño": item.size || '',
                  "Especie": item.species || '',
                  "Nombre común": item.common_name || '',
                  "Personal que reporta": item.reporter || '',
                  "Medidas proactivas": item.proactive_measures || '',
                  "Condiciones meteorológicas": item.weather_conditions || '',
                  "Resultados de las medidas": item.measure_results || '',
                  "_raw": item
              };
          });

      } catch(err) {
          // Fallback to local JSON if DB fails (e.g. table not created yet)
          // console.log('Falling back to local fauna.json');
          if (location.protocol === 'file:') return Promise.resolve([]);
          return fetch('data/fauna.json').then(r => r.json()).catch(()=>[]);
      }
  }

  // Normalizar claves de fauna.json con guiones bajos y variaciones a formato de UI
  function normalizeFaunaRow(row){
    const map = Object.create(null);
    // Mapeos específicos conocidos
    const special = {
      'Fase_de_la_operación': 'Fase de la operación',
      'Condiciones_meteorológicas': 'Condiciones meteorológicas',
      'Zona_de_impacto': 'Zona de impacto',
      'Personal_que_reporta': 'Personal que reporta',
      'Medidas_proactivas': 'Medidas proactivas',
      'Resultados_de_las_medidas': 'Resultados de las medidas',
      'Aerolineas': 'Aerolínea',
      'Matricula': 'Matrícula'
    };
    for (const [k, v] of Object.entries(row || {})){
      if (k === '_raw') { map['_raw'] = v; continue; }
      let nk = special[k];
      if (!nk){
        // Reemplazar guiones bajos por espacios y capitalizar acentos comunes si aplica
        nk = k.replace(/_/g, ' ');
      }
      map[nk] = v;
    }
    return map;
  }

  function buildColumns(rows){
    // Union of keys, preserving first appearance order
    const set = new Set();
    // Start with "Acciones" if admin mode might be active, but we can just append it at the end in renderTable
    rows.forEach(r => Object.keys(r).forEach(k => {
        if (k !== '_raw') set.add(k);
    }));
    return Array.from(set);
  }

  function uniqueSorted(arr){
    return Array.from(new Set(arr.filter(Boolean).map(s => String(s).trim()))).sort((a,b)=>a.localeCompare(b));
  }

  function updateBadges(){
    const total = state.filtered.length;
    const b1 = document.getElementById('fauna-total-badge');
    if (b1){
      const formatted = total.toLocaleString('es-MX');
      b1.innerHTML = `<span class="fauna-total-label">Total</span><span class="fauna-total-value">${formatted}</span>`;
      b1.setAttribute('aria-label', `Total de impactos ${formatted}`);
    }
    const from = document.getElementById('fauna-date-from')?.value || '';
    const to = document.getElementById('fauna-date-to')?.value || '';
    const month = document.getElementById('fauna-month')?.value || 'all';
    const period = month !== 'all' ? `Mes ${monthNamesEs[Math.max(0, Math.min(11, (parseInt(month,10)||1)-1))]}` : (from || to ? `${from||'?'} a ${to||'?'}` : 'Todos');
    const b2 = document.getElementById('fauna-period-badge'); if (b2) b2.textContent = `Periodo: ${period}`;
  }

  function renderTable(){
    const container = document.getElementById('fauna-table-container');
    if (!container) return;
    
    // Allow empty table to show toolbar so user can add first row
    const dm = window.dataManager;
    const isAdmin = dm && dm.isAdmin && (dm.userRole === 'control_fauna' || dm.userRole === 'superadmin' || dm.userRole === 'admin');
    if (!state.columns.length && !isAdmin && !state.isAdding){ container.innerHTML = '<div class="text-muted">Sin datos</div>'; return; }

    // Fallback columns if adding to empty table
    if (state.columns.length === 0) {
        state.columns = ["Fecha", "Hora", "Ubicación", "Especie", "Aerolínea", "Aeronave"];
    }

    let finalColumns = [...state.columns];
    if (isAdmin) {
        if (!finalColumns.includes('Acciones')) finalColumns.push('Acciones');
    }

    let toolbar = '';
    if (isAdmin) {
       // If isAdding is true, hide the Add button? Or just leave it.
       // User wants to add row. Button calls startAdd.
       if (!state.isAdding) {
           toolbar = `<div class="d-flex justify-content-end mb-2">
                <button class="btn btn-sm btn-primary" onclick="window.faunaStartAdd()">
                    <i class="fas fa-plus"></i> Agregar Fila
                </button>
           </div>`;
       }
    }

    // Add row HTML
    let addRowHtml = '';
    if (state.isAdding) {
        addRowHtml = '<tr class="table-primary">';
        addRowHtml += finalColumns.map(col => {
            if (col === 'Acciones') {
                return `<td>
                    <div class="d-flex gap-1">
                        <button class="btn btn-sm btn-success" onclick="window.faunaSaveNew()" title="Guardar"><i class="fas fa-save"></i></button>
                        <button class="btn btn-sm btn-secondary" onclick="window.faunaCancelAdd()" title="Cancelar"><i class="fas fa-times"></i></button>
                    </div>
                </td>`;
            }
            if (col === 'No.' || col === '_raw') return '<td>-</td>';
            
            const dbField = DB_MAPPING_IMPACTOS[col];
            let type = 'text';
            if (dbField === 'date') type = 'date';
            if (dbField === 'time') type = 'time';
            if (dbField === 'remains_count') type = 'number';
            
            return `<td><input type="${type}" class="form-control form-control-sm" data-new-col="${col}" placeholder="${col}"></td>`;
        }).join('');
        addRowHtml += '</tr>';
    }

    let filterRow = '<tr class="filter-row">';
    filterRow += finalColumns.map(c => {
        if (c === 'Acciones' || c === 'No.' || c === '_raw') return '<th></th>';
        const val = (state.columnFilters && state.columnFilters[c]) || '';
        return `<th><input type="text" class="form-control form-control-sm" placeholder="Filtrar..." value="${escapeHtml(val)}" onkeyup="window.faunaFilterColumn('${escapeHtml(c)}', this.value)"></th>`;
    }).join('');
    filterRow += '</tr>';

    const rowsWin = state.filtered;
    const thead = '<thead><tr>' + finalColumns.map(c => `<th class="text-nowrap">${escapeHtml(c)}</th>`).join('') + '</tr>' + filterRow + '</thead>';
    const tbodyBox = `${addRowHtml}` + rowsWin.map(row => {
      return '<tr>' + finalColumns.map(col => {
        if (col === 'Acciones') {
            if (!isAdmin) return '<td></td>';
            let id = row['No.'] || (row._raw && row._raw.id);
            if (!id) return '<td></td>';
            return `<td>
                <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-primary" onclick="window.faunaEdit('${id}')" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="window.faunaDelete('${id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </td>`;
        }
        let v = row[col];
        if (v === null || v === undefined) v = '';
        return `<td>${escapeHtml(String(v))}</td>`;
      }).join('') + '</tr>';
    }).join('');

    const existingTable = container.querySelector('table.fauna-table');
    if (existingTable && !state.isAddingToggleChanged) {
        // If table exists, just update tbody to preserve header inputs focus
        // We use a specific ID or class for tbody if possible, or just queryselector
        const tBodyEl = existingTable.querySelector('tbody');
        if (tBodyEl) {
            tBodyEl.innerHTML = tbodyBox;
            return;
        }
    }
    // Clear flag if set
    state.isAddingToggleChanged = false;

    const tbody = `<tbody>${tbodyBox}</tbody>`;
    const tableHtml = `<div class="table-container-tech h-scroll-area"><table class="table table-striped table-hover table-sm align-middle fauna-table">${thead}${tbody}</table></div>`;
    container.innerHTML = toolbar + tableHtml;
  }

  window.faunaFilterColumn = function(col, val) {
      if (!state.columnFilters) state.columnFilters = {};
      state.columnFilters[col] = val;
      applyFilters(); // Re-runs filtering and re-renders table
  };

  window.faunaStartAdd = function() {
      state.isAdding = true;
      state.isAddingToggleChanged = true; // Force full re-render to show input row in correct place or structure change
      renderTable();
  };

  window.faunaCancelAdd = function() {
      state.isAdding = false;
      state.isAddingToggleChanged = true;
      renderTable();
  };

  function canCaptureFauna() {
      if (typeof window.canCaptureSection === 'function') return window.canCaptureSection('fauna');
      return true; // el RLS de Supabase es la barrera final
  }
  function canEditFauna() {
      if (typeof window.canEditSection === 'function') return window.canEditSection('fauna');
      return true;
  }

  window.faunaSaveNew = async function() {
      if (!window.dataManager || !window.dataManager.client) return;
      if (!canCaptureFauna()) { alert('Modo solo lectura: no tienes permiso para capturar en Control de Fauna.'); return; }
      
      const inputs = document.querySelectorAll('#fauna-table-container input[data-new-col]');
      const data = {};
      let hasData = false;
      
      inputs.forEach(input => {
          const col = input.getAttribute('data-new-col');
          const val = input.value.trim();
          const dbField = DB_MAPPING_IMPACTOS[col];
          if (dbField && val) {
              data[dbField] = val;
              hasData = true;
          }
      });
      
      if (!hasData) {
          alert('Ingresa al menos un dato');
          return;
      }
      
      try {
          const { error } = await window.dataManager.client
              .from('wildlife_strikes')
              .insert([data]);
          
          if (error) throw error;
          
          state.isAdding = false;
          window.dispatchEvent(new CustomEvent('data-updated', { detail: { table: 'wildlife_strikes' } }));
      } catch(e) {
          console.error("Error saving wildlife strike", e);
          alert('Error al guardar: ' + e.message);
      }
  };
  
  // Expose these for inline onclick handlers
  window.faunaEdit = function(id) {
      if (!window.dataManagement) return;
      if (!canEditFauna()) { alert('Modo solo lectura: no tienes permiso para editar en Control de Fauna.'); return; }
      // Find item in state.raw using ._raw.id or No.
      const found = state.raw.find(r => String(r['No.']) === String(id));
      if (found && found._raw) {
          window.dataManagement.editItem('wildlife_strikes', found._raw);
      } else {
        console.warn('Registro no encontrado en memoria local:', id);
      }
  };

  window.faunaDelete = function(id) {
    if (!window.dataManagement) return;
    if (!canEditFauna()) { alert('Modo solo lectura: no tienes permiso para eliminar en Control de Fauna.'); return; }
    if (!id) {
        alert('Error: Identificador de registro inválido.');
        return;
    }
    window.dataManagement.deleteItem('wildlife_strikes', id);
  };
  
  // Listen for updates to refresh
  window.addEventListener('data-updated', (e) => {
      if (e.detail && e.detail.table === 'wildlife_strikes') {
          init(); // Reload
      }
  });

  function escapeHtml(str){
    return str.replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]));
  }

  /* Una misma aerolínea se captura de varias formas: "VIVA", "viva",
     "Viva Aerobus". El catálogo (Gestión de Datos → Aerolíneas) dice cuál
     es su nombre bueno, y con él se cuenta, se filtra y se busca su logo.
     Si no está catalogada, se respeta el nombre tal como se capturó. */
  function aerolineaCanonica(valor) {
      const bruto = String(valor == null ? '' : valor).trim();
      if (!bruto) return '';
      const cat = window.AifaAerolineas;
      if (cat && typeof cat.canonico === 'function') return cat.canonico(bruto) || bruto;
      return bruto;
  }

  /* Iniciales sobre el color de la marca, para las que aún no tienen logo. */
  function distintivoAerolinea(nombre, claseExtra) {
      const cat = window.AifaAerolineas;
      const iniciales = (cat && typeof cat.iniciales === 'function')
          ? cat.iniciales(nombre)
          : String(nombre || '').slice(0, 3).toUpperCase();
      const color = (cat && typeof cat.color === 'function' && cat.color(nombre)) || '#64748b';
      return `<span class="al-inicial ${claseExtra || ''}" style="--al-color:${color}" 
          title="${escapeHtml(nombre)}">${escapeHtml(iniciales)}</span>`;
  }

  function applyFilters(){
    const year  = (document.getElementById('fauna-year')?.value  || 'all');
    const month = (document.getElementById('fauna-month')?.value || 'all');
    const fromStr = (document.getElementById('fauna-date-from')?.value || '');
    const toStr = (document.getElementById('fauna-date-to')?.value || '');
    const species = (document.getElementById('fauna-species')?.value || 'all');
    const size = (document.getElementById('fauna-size')?.value || 'all');
    const phase = (document.getElementById('fauna-phase')?.value || 'all');
    const airline = (document.getElementById('fauna-airline')?.value || 'all');
    let from = fromStr ? new Date(fromStr + 'T00:00:00Z') : null;
    let to = toStr ? new Date(toStr + 'T23:59:59Z') : null;

    state.filtered = state.raw.filter(r => {
      const d = parseDMY(r['Fecha']);
      if (!d) return false; // omit invalid date rows to keep consistency
      if (year !== 'all' && String(d.getUTCFullYear()) !== year) return false;
      if (month !== 'all') {
        const mm = String((d.getUTCMonth()+1)).padStart(2,'0');
        if (mm !== month) return false;
      }
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (species !== 'all') {
        if (String(r['Especie']||'').trim() !== species) return false;
      }
      if (size !== 'all') {
        if (String(r['Tamaño']||'').trim() !== size) return false;
      }
      if (phase !== 'all') {
        if (String(r['Fase de la operación']||'').trim() !== phase) return false;
      }
      if (airline !== 'all') {
        if (aerolineaCanonica(r['Aerolínea']) !== airline) return false;
      }

      // Column Filters (Text Search)
      if (state.columnFilters && Object.keys(state.columnFilters).length > 0) {
          for (const [col, val] of Object.entries(state.columnFilters)) {
              if (!val) continue;
              const cellVal = String(r[col] || '').toLowerCase();
              if (cellVal.indexOf(val.toLowerCase()) === -1) return false;
          }
      }

      return true;
    });
  state.paging.page = 1; // reset page when filters change
    updateBadges();
    renderTable();
    renderCharts();
    renderAirlineSummary(state.filtered);
    // Actualizar disponibilidad de meses según filtros actuales (excluyendo el propio mes)
    try {
      const rowsForMonth = state.raw.filter(r => {
        const d = parseDMY(r['Fecha']); if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (species !== 'all' && String(r['Especie']||'').trim() !== species) return false;
        if (size !== 'all' && String(r['Tamaño']||'').trim() !== size) return false;
        if (phase !== 'all' && String(r['Fase de la operación']||'').trim() !== phase) return false;
        if (airline !== 'all' && String(r['Aerolínea']||'').trim() !== airline) return false;
        return true;
      });
      updateMonthFilterAvailability(rowsForMonth);
    } catch(_) {}
  }

  function toIntSafe(v){
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Math.floor(v);
    const s = String(v).trim();
    if (!s) return 0;
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  function groupByMonth(rows){
    const counts = new Map();
    rows.forEach(r => {
      const d = parseDMY(r['Fecha']); if (!d) return;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      counts.set(key, (counts.get(key)||0) + 1);
    });
    const keys = Array.from(counts.keys()).sort();
    return { labels: keys, data: keys.map(k => counts.get(k)) };
  }

  function groupBySpecies(rows){
    const counts = new Map();
    rows.forEach(r => {
      const common = String(r['Nombre común'] || r['Nombre comun'] || '').trim();
      const scientific = String(r['Especie'] || '').trim();
      const key = common || scientific;
      if (!key) return;
      counts.set(key, (counts.get(key)||0) + 1);
    });
    // Take top 10 species, bucket rest as "Otros"
    const entries = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
    const top = entries.slice(0, 10);
    const rest = entries.slice(10);
    const restSum = rest.reduce((a,[,v])=>a+v,0);
    const labels = top.map(([k])=>k).concat(restSum>0?['Otros']:[]);
    const data = top.map(([,v])=>v).concat(restSum>0?[restSum]:[]);
    return { labels, data };
  }

  function groupByHour(rows){
    const hours = new Array(24).fill(0);
    rows.forEach(r => {
      const h = String(r['Hora']||'').trim();
      // Match HH:MM or HH:MM:SS
      const m = h.match(/^([01]?\d|2[0-3])\:(\d{2})(?::\d{2})?$/);
      if (!m) return;
      const hh = Math.max(0, Math.min(23, parseInt(m[1],10)));
      hours[hh] += 1;
    });
    return { labels: hours.map((_,i)=> String(i).padStart(2,'0')+':00'), data: hours };
  }

  function destroyChart(ref){
    try {
      if (ref && typeof ref.dispose === 'function') { ref.dispose(); }
    } catch(_) {}
  }

  function renderCharts(){
    const byMonth = groupByMonth(state.filtered);
    const bySpecies = groupBySpecies(state.filtered);
    const byHour = groupByHour(state.filtered);
  const byWeather = groupByWeather(state.filtered);

    // Dispose existing
    destroyChart(state.charts.byMonth);
    destroyChart(state.charts.bySpecies);
    destroyChart(state.charts.byHour);
  destroyChart(state.charts.byWeather);
    destroyChart(state.charts.heatmap);

    // ECharts builders
  const monthLabelsPretty = byMonth.labels.map(ym => {
    // If data spans >1 year, show "Ene 25", "Ene 26" etc.
    const allYears = new Set(byMonth.labels.map(k => k.split('-')[0]));
    const [y, m] = ym.split('-');
    const abbr = monthNamesEs[Math.max(0, Math.min(11, (parseInt(m,10)||1)-1))];
    return allYears.size > 1 ? `${abbr} ${String(y).slice(2)}` : abbr;
  });
  state.charts.byMonth = makeEBar('fauna-by-month', monthLabelsPretty, byMonth.data, { orientation: 'v', color: '#1565c0', xTitle: 'Mes' });
  state.charts.bySpecies = makeEBar('fauna-by-species', bySpecies.labels, bySpecies.data, { orientation: 'h', color: '#2e7d32' });
    state.charts.byHour = makeEBar('fauna-by-hour', byHour.labels, byHour.data, { orientation: 'v', color: '#fb8c00' });

  const heat = groupHeatMonthWeather(state.filtered);
  state.charts.heatmap = makeHeatmap('fauna-heatmap', heat.months, heat.weathers, heat.matrix);

    // Top hours badges
    const topEl = document.getElementById('fauna-top-hours');
    if (topEl){
      const pairs = byHour.labels.map((lab, i) => ({ lab, v: byHour.data[i] }));
      pairs.sort((a,b)=> b.v - a.v);
      const top = pairs.filter(p=>p.v>0).slice(0,5);
      topEl.innerHTML = top.map(p => `<span class="badge rounded-pill text-bg-warning text-dark">${p.lab} · ${p.v}</span>`).join('');
      if (top.length === 0) topEl.innerHTML = '<span class="text-muted small">Sin datos para el periodo/criterios seleccionados.</span>';
    }
    // Resumen por fase (Despegue/Aterrizaje)
    renderPhaseSummary(state.filtered);
    // Resumen por Aerolínea (logos y conteos)
    renderAirlineSummary(state.filtered);
  }

  function ensureEContainer(id){
    const el = document.getElementById(id); if (!el) return null;
    if (el.tagName && el.tagName.toLowerCase() === 'canvas'){
      const div = document.createElement('div');
      // Preserve ID and relevant attributes when replacing canvas
      try { div.id = el.id; } catch(_) {}
      if (el.className) div.className = el.className;
      div.style.width = '100%'; div.style.height = '100%';
      el.parentNode.replaceChild(div, el);
      return div;
    }
    return el;
  }

  function makeEBar(id, labels, values, opts){
    if (!window.echarts) return null;
    const el = ensureEContainer(id); if (!el) return null;
    let chart = window.echarts.getInstanceByDom(el);
    if (!chart) chart = window.echarts.init(el);
    const orientation = (opts && opts.orientation) || 'v';
    const color = (opts && opts.color) || '#1565c0';
    const isSmall = window.matchMedia && window.matchMedia('(max-width: 576px)').matches;
    const numericValues = (Array.isArray(values) ? values : []).map(v => Number(v) || 0);
    const maxValue = numericValues.length ? Math.max(...numericValues) : 0;
    const digitEstimate = Math.max(1, String(Math.round(maxValue)).length);
    const labelConfig = {
      show: true,
      position: orientation === 'v' ? 'top' : 'right',
      distance: 4,
      color: '#1f2937',
      align: orientation === 'v' ? 'center' : 'left',
      fontWeight: 600,
      fontSize: isSmall ? 10 : 12,
      formatter: ({ value }) => {
        const v = Number(value || 0);
        return v > 0 ? v : '';
      }
    };
    const paddingForDigits = digitEstimate * (isSmall ? 8 : 10) + 16;
    const grid = {
      left: isSmall ? 54 : 80,
      right: orientation === 'v' ? 28 : Math.max(isSmall ? 72 : 96, paddingForDigits),
      top: orientation === 'v' ? Math.max(32, (isSmall ? 20 : 24) + digitEstimate * (isSmall ? 4 : 5)) : 16,
      bottom: orientation === 'v' ? (isSmall ? 54 : 48) : (isSmall ? 36 : 40),
      containLabel: true
    };
    const option = {
      grid,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: orientation==='v' ? { type: 'category', data: labels, axisLabel: { color: '#334155' } } : { type: 'value', axisLabel: { color: '#334155' } },
      yAxis: orientation==='v' ? { type: 'value', axisLabel: { color: '#334155' } } : { type: 'category', data: labels, inverse: true, axisLabel: { color: '#334155' } },
      series: [{ type: 'bar', data: values, itemStyle: { color }, label: labelConfig }]
    };
    if (opts && opts.xTitle) {
      option.xAxis.name = opts.xTitle;
      option.xAxis.nameLocation = 'middle';
      option.xAxis.nameGap = 30;
      option.xAxis.nameTextStyle = { color: '#334155', fontWeight: 600 };
    }
    chart.setOption(option, true);
    return chart;
  }

  function groupHeatMonthWeather(rows){
    // months in YYYY-MM order
    const monthSet = new Set();
    const weatherSet = new Set();
    rows.forEach(r => {
      const d = parseDMY(r['Fecha']); if (!d) return;
      const mkey = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      monthSet.add(mkey);
      const w = String(r['Condiciones meteorológicas']||'').trim();
      if (w) weatherSet.add(w);
    });
    const months = Array.from(monthSet).sort();
    const weathers = Array.from(weatherSet).sort((a,b)=>a.localeCompare(b));
    const indexM = new Map(months.map((m,i)=>[m,i]));
    const indexW = new Map(weathers.map((w,i)=>[w,i]));
    const matrix = Array.from({length: months.length}, ()=> Array.from({length: weathers.length}, ()=>0));
    rows.forEach(r => {
      const d = parseDMY(r['Fecha']); if (!d) return;
      const mkey = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      const w = String(r['Condiciones meteorológicas']||'').trim();
      if (!indexM.has(mkey) || !indexW.has(w)) return;
      matrix[indexM.get(mkey)][indexW.get(w)]++;
    });
    return { months, weathers, matrix };
  }

  function makeHeatmap(id, months, weathers, matrix){
    if (!window.echarts) return null;
    const el = ensureEContainer(id); if (!el) return null;
    let chart = window.echarts.getInstanceByDom(el);
    if (!chart) chart = window.echarts.init(el);
    const data = [];
    for (let i=0;i<months.length;i++){
      for (let j=0;j<weathers.length;j++){
        data.push([i, j, matrix[i][j]||0]);
      }
    }
    const displayMonths = months.map(monthKeyToAbbr);
    const isSmall = window.matchMedia && window.matchMedia('(max-width: 576px)').matches;
    const option = {
      tooltip: { position: 'top' },
      grid: { left: isSmall ? 76 : 100, right: 16, top: 8, bottom: isSmall ? 58 : 50, containLabel: true },
      xAxis: {
        type: 'category',
        data: displayMonths,
        splitArea: { show: true },
        axisLabel: {
          color: '#334155',
          rotate: months.length > (isSmall ? 6 : 8) ? 45 : 0,
          fontSize: isSmall ? 10 : 12
        }
      },
      yAxis: {
        type: 'category',
        data: weathers,
        splitArea: { show: true },
        axisLabel: {
          color: '#334155',
          fontSize: isSmall ? 10 : 12,
          formatter: function(value){
            const s = String(value || '');
            const max = isSmall ? 12 : 18;
            return s.length > max ? s.slice(0, max-1) + '…' : s;
          }
        }
      },
      visualMap: {
        min: 0,
        max: Math.max(1, ...data.map(d=>d[2])),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 2,
        textStyle: { fontSize: isSmall ? 10 : 12 }
      },
      series: [{
        name: 'Eventos', type: 'heatmap', data,
        label: { show: !isSmall, color: '#222', fontSize: 10 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.25)' } }
      }],
      dataZoom: (isSmall && months.length > 6) ? [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', xAxisIndex: 0, height: 12, bottom: 0 }
      ] : []
    };
    chart.setOption(option, true);
    return chart;
  }

  function groupByWeather(rows){
    // Mantener por compatibilidad pero no se grafica ya en UI
    const counts = new Map();
    rows.forEach(r => {
      const w = String(r['Condiciones meteorológicas']||'').trim();
      if (!w) return;
      counts.set(w, (counts.get(w)||0) + 1);
    });
    const entries = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
    const labels = entries.map(([k])=>k);
    const data = entries.map(([,v])=>v);
    return { labels, data };
  }

  function updateMonthFilterAvailability(rows){
    const sel = document.getElementById('fauna-month'); if (!sel) return;
    // compute months present in provided rows
    const present = new Set();
    rows.forEach(r => { const d = parseDMY(r['Fecha']); if (!d) return; const mm = String(d.getUTCMonth()+1).padStart(2,'0'); present.add(mm); });
    Array.from(sel.options).forEach(opt => {
      if (!opt || opt.value === 'all') return;
      opt.disabled = !present.has(opt.value);
    });
  }

  function renderPhaseSummary(rows){
    const el = document.getElementById('fauna-phase-summary'); if (!el) return;
    let dep = 0, arr = 0, otros = 0;
    rows.forEach(r => {
      const f = normalizeEs(r['Fase de la operación']);
      if (!f) { otros++; return; }
      if (f.includes('despeg')) dep++; else if (f.includes('aterriz')) arr++; else otros++;
    });
    const parts = [];
    parts.push(`<span class="badge rounded-pill text-bg-primary">🛫 Despegues · ${dep}</span>`);
    parts.push(`<span class="badge rounded-pill text-bg-success">🛬 Aterrizajes · ${arr}</span>`);
    if (otros>0) parts.push(`<span class="badge rounded-pill text-bg-secondary">Otros · ${otros}</span>`);
    el.innerHTML = parts.join(' ');
  }

  // Removed Chart.js chart builders; using ECharts above

  function renderImpactosYearSwitch(){
    const container = document.getElementById('fauna-impactos-year-switch');
    if (!container) return;
    const years = Array.isArray(state.impactosYears) ? state.impactosYears : [];
    const yearSel = document.getElementById('fauna-year');
    const current = (yearSel && yearSel.value) ? yearSel.value : 'all';
    const options = ['all'].concat(years);
    container.innerHTML = options.map(year => {
      const active = String(current) === String(year);
      const label = year === 'all' ? 'Todos' : year;
      const btnClass = active ? 'btn btn-primary active' : 'btn btn-outline-primary';
      return `<button type="button" class="${btnClass}" data-year="${escapeHtml(year)}">${escapeHtml(label)}</button>`;
    }).join('');
  }

  function updateImpactosYearLabel(){
    const el = document.getElementById('fauna-impactos-year-label');
    if (!el) return;
    const yearSel = document.getElementById('fauna-year');
    const current = (yearSel && yearSel.value) ? yearSel.value : 'all';
    el.textContent = current === 'all' ? '' : current;
  }

  function populateFilters(){
    const selMonth = document.getElementById('fauna-month');
    if (selMonth){ /* keep predefined months */ }
    // Populate year filter dynamically
    const yearSel = document.getElementById('fauna-year');
    const years = Array.from(new Set(state.raw.map(r => {
      const d = parseDMY(r['Fecha']); return d ? String(d.getUTCFullYear()) : null;
    }).filter(Boolean))).sort();
    if (yearSel) {
      const prev = yearSel.value || 'all';
      yearSel.innerHTML = '<option value="all" selected>Todos</option>' +
        years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
      if (prev === 'all' || years.includes(prev)) yearSel.value = prev;
    }
    state.impactosYears = years;
    renderImpactosYearSwitch();
    updateImpactosYearLabel();
    const speciesSel = document.getElementById('fauna-species');
    const sizeSel = document.getElementById('fauna-size');
    const phaseSel = document.getElementById('fauna-phase');
    const airlineSel = document.getElementById('fauna-airline');
    const species = uniqueSorted(state.raw.map(r => r['Especie']));
    const sizes = uniqueSorted(state.raw.map(r => r['Tamaño']));
    const phases = uniqueSorted(state.raw.map(r => r['Fase de la operación']));
    const airlines = uniqueSorted(state.raw.map(r => aerolineaCanonica(r['Aerolínea'])));
    if (speciesSel){ speciesSel.innerHTML = '<option value="all" selected>Todas</option>' + species.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); }
    if (sizeSel){ sizeSel.innerHTML = '<option value="all" selected>Todos</option>' + sizes.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); }
    if (phaseSel){ phaseSel.innerHTML = '<option value="all" selected>Todas</option>' + phases.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); }
    if (airlineSel){ airlineSel.innerHTML = '<option value="all" selected>Todas</option>' + airlines.map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join(''); }
  }

  function bindEvents(){
    if (state.eventsBound) return;
    state.eventsBound = true;

    // Listen for admin mode changes to update add button visibility
    window.addEventListener('admin-mode-changed', () => {
        renderTable();
    });

    document.getElementById('fauna-year')?.addEventListener('change', () => {
      renderImpactosYearSwitch();
      updateImpactosYearLabel();
      applyFilters();
    });
    document.getElementById('fauna-impactos-year-switch')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-year]');
      if (!btn) return;
      const targetYear = btn.getAttribute('data-year') || 'all';
      const yearSel = document.getElementById('fauna-year');
      if (yearSel) {
        if (yearSel.value === targetYear) return;
        yearSel.value = targetYear;
        yearSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    document.getElementById('fauna-month')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-date-from')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-date-to')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-species')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-size')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-phase')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-airline')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-clear')?.addEventListener('click', () => {
      const mf = document.getElementById('fauna-month'); if (mf) mf.value='all';
      const yf = document.getElementById('fauna-year');  if (yf) yf.value='all';
      const df = document.getElementById('fauna-date-from'); if (df) df.value='';
      const dt = document.getElementById('fauna-date-to'); if (dt) dt.value='';
      const sp = document.getElementById('fauna-species'); if (sp) sp.value='all';
      const sz = document.getElementById('fauna-size'); if (sz) sz.value='all';
      const ph = document.getElementById('fauna-phase'); if (ph) ph.value='all';
      const al = document.getElementById('fauna-airline'); if (al) al.value='all';
      renderImpactosYearSwitch();
      updateImpactosYearLabel();
      applyFilters();
    });
    document.getElementById('fauna-export-csv')?.addEventListener('click', exportCSV);
    // paginación eliminada
    // Debounced resize for ECharts
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          ['fauna-by-month','fauna-by-species','fauna-by-hour','fauna-heatmap'].forEach(id => {
            const el = document.getElementById(id);
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el.tagName.toLowerCase()==='canvas' ? null : el);
            if (inst && inst.resize) inst.resize();
          });
        } catch(_) {}
      }, 120);
    });

    // Re-render when section becomes visible to avoid zero-size canvas issues
    window.addEventListener('fauna:visible', () => {
      try { renderCharts(); } catch(_) {}
    });
  }

  async function init(){
    if (state.isLoading) return;
    state.isLoading = true;

    if (!document.getElementById('fauna-section')) { state.isLoading = false; return; }
    
    try {
        const rows = await loadFauna();
        state.raw = (rows || []).map(normalizeFaunaRow);
        state.columns = buildColumns(state.raw);
        state.filtered = state.raw.slice();
        populateFilters();
        updateMonthFilterAvailability(state.raw);
        updateBadges();
        renderTable();
        renderCharts();
        renderAirlineSummary(state.filtered);
        bindEvents();
        /* El catálogo de aerolíneas llega por red. Cuando termina de cargar,
           se vuelve a pintar con los nombres ya homologados y sus logos, sin
           que nadie tenga que recargar la página. */
        window.addEventListener('aifa:catalogo-aerolineas', () => {
            try { populateFilters(); applyFilters(); } catch (_) {}
        }, { once: true });
    } catch(err) {
      console.warn('fauna load error:', err);
      const c = document.getElementById('fauna-table-container');
      if (c) c.innerHTML = '<div class="text-danger">No se pudo cargar fauna.json</div>';
    } finally {
        state.isLoading = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  function exportCSV(){
    if (!state.columns.length) return;
    const sep = ',';
    const header = state.columns.map(csvEscape).join(sep);
    const rows = state.filtered.map(r => state.columns.map(c => csvEscape(r[c])).join(sep));
    const csv = '\ufeff' + [header].concat(rows).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fauna.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(v){
    if (v === null || v === undefined) v = '';
    let s = String(v);
    if (/[",\n\r]/.test(s)){
      s = '"' + s.replace(/"/g,'""') + '"';
    }
    return s;
  }

  // Resumen por Aerolínea (con logos) similar al inicio
  function renderAirlineSummary(rows){
    const container = document.getElementById('fauna-summary-container');
    if (!container) return;
    const airlineSelect = document.getElementById('fauna-airline');
    const activeAirlineValue = airlineSelect ? airlineSelect.value : 'all';
    const filteredByAirline = !!(activeAirlineValue && activeAirlineValue !== 'all');
    const activeAirlineLabel = filteredByAirline
      ? (airlineSelect?.options?.[airlineSelect.selectedIndex]?.text || activeAirlineValue)
      : '';
    const counts = new Map();
    rows.forEach(r => {
      const a = aerolineaCanonica(r['Aerolínea']) || 'Sin aerolínea';
      counts.set(a, (counts.get(a)||0)+1);
    });
    const items = Array.from(counts.entries()).sort((a,b)=> b[1]-a[1]);
    if (!items.length){ container.innerHTML = '<div class="text-muted">Sin datos.</div>'; return; }
    let html = '<div class="row g-2">';
    if (filteredByAirline) {
        const activeTotal = rows.length.toLocaleString('es-MX');
        html += `
        <div class="fauna-active-filter">
          <div class="fauna-active-filter-label">
            <i class="fas fa-filter"></i>
            <span>Mostrando <strong>${escapeHtml(activeAirlineLabel)}</strong></span>
            <span class="fauna-active-filter-total">${activeTotal} impactos</span>
          </div>
          <button type="button" class="btn btn-outline-primary btn-sm" id="fauna-summary-reset">
            Ver todas las aerolíneas
          </button>
        </div>`;
    }
    items.forEach(([airline, n]) => {
      const cands = (window.getAirlineLogoCandidates ? window.getAirlineLogoCandidates(airline) : []);
      const logoPath = cands && cands.length ? cands[0] : '';
      const dataCands = (cands||[]).join('|');
      const sizeClass = (window.getLogoSizeClass ? window.getLogoSizeClass(airline,'summary') : 'lg');
      const logoHtml = logoPath
          ? `<img class="airline-logo ${sizeClass} me-2" src="${logoPath}" alt="Logo ${escapeHtml(airline)}" data-cands="${escapeHtml(dataCands)}" data-cand-idx="0" onerror="handleLogoError(this)" onload="logoLoaded(this)">`
          : distintivoAerolinea(airline) + ' ';
      html += `
      <div class="col-12 col-sm-6 col-md-4 col-lg-3">
        <div class="card h-100">
          <div class="card-body d-flex align-items-center justify-content-between">
            <div class="airline-header d-flex align-items-center">
              <a href="#" class="fauna-airline-link d-flex align-items-center text-decoration-none" title="Ver eventos de ${escapeHtml(airline)}" data-airline="${escapeHtml(airline)}">
                ${logoHtml}<strong class="airline-name ms-1">${escapeHtml(airline)}</strong>
              </a>
            </div>
            <span class="badge text-bg-primary">${n}</span>
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
    if (filteredByAirline) {
      const resetBtn = document.getElementById('fauna-summary-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', (ev)=>{
          ev.preventDefault();
          const sel = document.getElementById('fauna-airline');
          if (sel) {
            sel.value = 'all';
            applyFilters();
          }
        });
      }
    }
    // Click -> aplicar filtro por aerolínea y desplazar a la tabla
    try {
      container.querySelectorAll('.fauna-airline-link').forEach(a => {
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          const airline = a.getAttribute('data-airline') || '';
          viewFaunaForAirline(airline);
        });
      });
    } catch(_) {}
  }

  // Aplicar filtro por aerolínea en Fauna y desplazar a la tabla
  function viewFaunaForAirline(airline){
    try {
      const sel = document.getElementById('fauna-airline');
      if (!sel) return;
      // asegurar opción existente
      let option = Array.from(sel.options).find(o => (o.value||'') === airline);
      if (!option && airline) {
        const opt = document.createElement('option');
        opt.value = airline; opt.textContent = airline; sel.appendChild(opt);
      }
      sel.value = airline || 'all';
      applyFilters();
    } catch(_) {}
  }
})();

// Fauna Rescatada module: mirrors Impactos with tailored filters/charts for rescue operations
(function(){
  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const MONTH_ABBRS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const TABLE_COLUMNS = ['Año','No. captura','Fecha','Hora','Mes','Clase','Nombre común','Nombre científico','No. individuos','Método de captura','Cuadrante','Disposición final'];
  
  const DB_MAPPING_RESCATES = {
    "No. captura": "capture_number",
    "Fecha": "date",
    "Hora": "time",
    "Mes": "month",
    "Clase": "class",
    "Nombre común": "common_name",
    "Nombre científico": "scientific_name",
    "No. individuos": "quantity",
    "Método de captura": "capture_method",
    "Cuadrante": "quadrant",
    "Disposición final": "final_disposition"
  };
  
  const state = {
    raw: [],
    filtered: [],
    columnFilters: {}, // Added for column search
    charts: { month: null, class: null, relocation: null, hour: null, method: null },
    year: 'all',
    years: [],
    eventsBound: false,
    isLoading: false,
    isAdding: false
  };


  function normalizeYearValue(row){
    const year = row && (row['Año'] ?? row.Año);
    if (year !== undefined && year !== null && String(year).trim()) {
      return String(year);
    }
    const fecha = row && row['Fecha'];
    if (typeof fecha === 'string') {
      const match = fecha.trim().match(/(\d{4})$/);
      if (match) return match[1];
    }
    return '';
  }

  function deriveYears(rows){
    const set = new Set();
    rows.forEach(r => {
      const year = normalizeYearValue(r);
      if (year) set.add(year);
    });
    return Array.from(set).sort();
  }

  function formatYearList(years){
    if (!Array.isArray(years) || !years.length) return '';
    if (years.length === 1) return years[0];
    const head = years.slice(0, -1);
    const tail = years[years.length - 1];
    if (!head.length) return tail;
    const headText = head.join(', ');
    return `${headText}${head.length > 1 ? ',' : ''} y ${tail}`;
  }

  function updateYearLabel(){
    const el = document.getElementById('fauna-rescate-year-label');
    if (!el) return;
    if (state.year === 'all') {
      const label = formatYearList(state.years);
      el.textContent = label || '';
      return;
    }
    el.textContent = state.year;
  }

  function renderYearSwitch(){
    const container = document.getElementById('fauna-rescate-year-switch');
    if (!container) return;
    const options = ['all'].concat(state.years);
    container.innerHTML = options.map(year => {
      const active = String(state.year) === String(year);
      const label = year === 'all' ? 'Todos' : year;
      const btnClass = active ? 'btn btn-primary active' : 'btn btn-outline-primary';
      return `<button type="button" class="${btnClass}" data-year="${escapeHtml(year)}">${escapeHtml(label)}</button>`;
    }).join('');
    Array.from(container.querySelectorAll('button[data-year]')).forEach(btn => {
      btn.addEventListener('click', () => {
        const targetYear = btn.getAttribute('data-year') || 'all';
        if (targetYear === state.year) return;
        state.year = targetYear;
        updateYearLabel();
        applyFilters();
        renderYearSwitch();
      });
    });
  }

  function flattenDatasetPayload(payload){
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      const rows = [];
      Object.keys(payload).sort().forEach(yearKey => {
        const records = payload[yearKey];
        if (!Array.isArray(records)) return;
        records.forEach(entry => {
          if (!entry || typeof entry !== 'object') return;
          const copy = { ...entry };
          if (copy['Año'] === undefined) {
            const maybeYear = Number(yearKey);
            copy['Año'] = Number.isFinite(maybeYear) ? maybeYear : yearKey;
          }
          rows.push(copy);
        });
      });
      return rows;
    }
    return [];
  }

  async function loadDataset(){
    try {
      const supabase = await window.ensureSupabaseClient();
      const { data, error } = await supabase
        .from('rescued_wildlife')
        .select('*')
        .order('id', { ascending: false });

      if (error) {
        console.warn('fauna-rescate: error al cargar de supabase', error);
        throw error;
      }

      // Map Supabase fields to the keys expected by fauna.js
      return (data || []).map(item => {
        let fDate = '';
        let yearVal = '';
        let derivedMonth = '';

        if (item.date) {
            // item.date is YYYY-MM-DD or ISO
            let dStr = String(item.date);
            if (dStr.includes('T')) dStr = dStr.split('T')[0];
            
            const parts = dStr.split('-');
            if (parts.length === 3) {
              const [y, m, d] = parts;
              fDate = `${d}/${m}/${y}`;
              yearVal = y;
              derivedMonth = MONTH_NAMES[parseInt(m,10)-1] || '';
            } else if (/\d{2}\/\d{2}\/\d{4}/.test(dStr)) {
               fDate = dStr;
               // Try to extract year/month
               const [d, m, y] = dStr.split('/');
               yearVal = y;
               derivedMonth = MONTH_NAMES[parseInt(m,10)-1] || '';
            }
        }
        
        let monthVal = item.month || derivedMonth || '';

        let fTime = item.time || '';
        // If time is HH:MM:SS, just keep it, the regex handles it now OR trim it for display consistency
        if (fTime.length > 5 && fTime.indexOf(':') > -1) {
             fTime = fTime.substring(0, 5); 
        }

        return {
          'No. captura': item.capture_number,
          'Fecha': fDate,
          'Hora': fTime,
          'Año': yearVal,
          'Mes': monthVal,
          'Clase': item.class || '',
          'Nombre común': item.common_name || '',
          'Nombre científico': item.scientific_name || '',
          'No. individuos': item.quantity,
          'Método de captura': item.capture_method || '',
          'Cuadrante': item.quadrant || '',
          'Disposición final': item.final_disposition || '',
          '_raw': item
        };
      });

    } catch (e) {
      console.warn('fauna-rescate: error loading data, falling back to JSON if available', e);
      // Fallback
      const sources = ['data/fauna_rescatada.json', 'data/fauna_rescatada'];
      const trySource = (index)=>{
        if (index >= sources.length) {
          return Promise.resolve([]);
        }
        const url = sources[index];
        return fetch(url).then(resp => {
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          return resp.json();
        }).then(flattenDatasetPayload).catch(err => {
          return trySource(index + 1);
        });
      };
      return trySource(0);
    }
  }

  function parseDMY(str){
    if (!str || typeof str !== 'string') return null;
    const match = str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function escapeHtml(str){
    return String(str ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
  }

  function normalizeRow(row){
    const normalized = {};
    const dm = window.dataManager;
    const isAdmin = dm && dm.isAdmin && (dm.userRole === 'control_fauna' || dm.userRole === 'superadmin' || dm.userRole === 'admin');
    
    // Use _raw storage for actions
    normalized._raw = row._raw || row; // Ensure we have reference to raw object
    
    TABLE_COLUMNS.forEach(col => {
      if (col === 'Año') {
        normalized[col] = normalizeYearValue(row);
      } else {
        normalized[col] = row[col] ?? '';
      }
    });

    if (isAdmin) {
       normalized['Acciones'] = 'actions_placeholder';
    }
    return normalized;
  }

  function uniqueValues(rows, key, sorter){
    const values = new Set();
    rows.forEach(r => { const val = String(r[key] ?? '').trim(); if (val) values.add(val); });
    const list = Array.from(values);
    return typeof sorter === 'function' ? list.sort(sorter) : list.sort((a,b)=>a.localeCompare(b));
  }

  function populateFilters(){
    const monthSel = document.getElementById('fauna-rescate-month');
    const classSel = document.getElementById('fauna-rescate-class');
    const methodSel = document.getElementById('fauna-rescate-method');
    const quadrantSel = document.getElementById('fauna-rescate-quadrant');
    const disposalSel = document.getElementById('fauna-rescate-disposal');

    if (monthSel){
      const months = uniqueValues(state.raw, 'Mes', (a,b)=>MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b));
      const options = months.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
      if (!monthSel._populated){
        monthSel.insertAdjacentHTML('beforeend', options);
        monthSel._populated = true;
      } else {
        monthSel.innerHTML = '<option value="all">Todos</option>' + options;
      }
    }
    if (classSel){
      const classes = uniqueValues(state.raw, 'Clase');
      classSel.innerHTML = '<option value="all">Todas</option>' + classes.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');
    }
    if (methodSel){
      const methods = uniqueValues(state.raw, 'Método de captura');
      methodSel.innerHTML = '<option value="all">Todos</option>' + methods.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');
    }
    if (quadrantSel){
      const quadrants = uniqueValues(state.raw, 'Cuadrante');
      quadrantSel.innerHTML = '<option value="all">Todos</option>' + quadrants.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');
    }
    if (disposalSel){
      const disposals = uniqueValues(state.raw, 'Disposición final');
      disposalSel.innerHTML = '<option value="all">Todas</option>' + disposals.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');
    }
  }

  function readFilters(){
    const month = document.getElementById('fauna-rescate-month')?.value || 'all';
    const classVal = document.getElementById('fauna-rescate-class')?.value || 'all';
    const method = document.getElementById('fauna-rescate-method')?.value || 'all';
    const quadrant = document.getElementById('fauna-rescate-quadrant')?.value || 'all';
    const disposal = document.getElementById('fauna-rescate-disposal')?.value || 'all';
    const fromDate = document.getElementById('fauna-rescate-date-from')?.value || '';
    const toDate = document.getElementById('fauna-rescate-date-to')?.value || '';
    return { month, classVal, method, quadrant, disposal, fromDate, toDate };
  }

  function applyFilters(){
    const filters = readFilters();
    const from = filters.fromDate ? new Date(filters.fromDate + 'T00:00:00Z') : null;
    const to = filters.toDate ? new Date(filters.toDate + 'T23:59:59Z') : null;
    state.filtered = state.raw.filter(row => {
      if (state.year !== 'all') {
        const rowYear = String(row['Año'] || '').trim();
        if (rowYear !== state.year) return false;
      }
      const date = parseDMY(row['Fecha']);
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (filters.month !== 'all' && String(row['Mes'] || '').trim() !== filters.month) return false;
      if (filters.classVal !== 'all' && String(row['Clase'] || '').trim() !== filters.classVal) return false;
      if (filters.method !== 'all' && String(row['Método de captura'] || '').trim() !== filters.method) return false;
      if (filters.quadrant !== 'all' && String(row['Cuadrante'] || '').trim() !== filters.quadrant) return false;
      if (filters.disposal !== 'all' && String(row['Disposición final'] || '').trim() !== filters.disposal) return false;

      // Column Filters (Text Search)
      if (state.columnFilters && Object.keys(state.columnFilters).length > 0) {
          for (const [col, val] of Object.entries(state.columnFilters)) {
              if (!val) continue;
              const cellVal = String(row[col] || '').toLowerCase();
              if (cellVal.indexOf(val.toLowerCase()) === -1) return false;
          }
      }

      return true;
    });
    updateBadges();
    renderActiveFilter();
    renderCharts();
    renderSpecies();
    renderTable();
  }

  function updateBadges(){
    const totalBadge = document.getElementById('fauna-rescate-total-badge');
    const individualsBadge = document.getElementById('fauna-rescate-individuals-badge');
    const totalRescues = state.filtered.length;
    if (totalBadge){
      const labelEl = totalBadge.querySelector('.fauna-rescate-label');
      const valueEl = totalBadge.querySelector('.fauna-rescate-value');
      if (labelEl) labelEl.textContent = 'Total rescates';
      if (valueEl) valueEl.textContent = totalRescues.toLocaleString('es-MX');
      totalBadge.setAttribute('aria-label', `Total de rescates ${totalRescues.toLocaleString('es-MX')}`);
    }
    if (individualsBadge){
      const totalIndividuals = state.filtered.reduce((sum, row) => sum + Number(row['No. individuos'] || 0), 0);
      const labelEl = individualsBadge.querySelector('.fauna-rescate-label');
      const valueEl = individualsBadge.querySelector('.fauna-rescate-value');
      if (labelEl) labelEl.textContent = 'Total de rescates';
      if (valueEl) valueEl.textContent = totalIndividuals.toLocaleString('es-MX');
      individualsBadge.setAttribute('aria-label', `Total de rescates ${totalIndividuals.toLocaleString('es-MX')}`);
    }
  }

  function renderActiveFilter(){
    const el = document.getElementById('fauna-rescate-active-filter');
    if (!el) return;
    const defaults = {
      month: 'all', classVal: 'all', method: 'all', quadrant: 'all', disposal: 'all', fromDate: '', toDate: ''
    };
    const filters = readFilters();
    const applied = [];
    if (state.year !== 'all') applied.push(`Año: ${state.year}`);
    if (filters.month !== defaults.month) applied.push(`Mes: ${filters.month}`);
    if (filters.classVal !== defaults.classVal) applied.push(`Clase: ${filters.classVal}`);
    if (filters.method !== defaults.method) applied.push(`Método: ${filters.method}`);
    if (filters.quadrant !== defaults.quadrant) applied.push(`Cuadrante: ${filters.quadrant}`);
    if (filters.disposal !== defaults.disposal) applied.push(`Disposición: ${filters.disposal}`);
    if (filters.fromDate) applied.push(`Desde: ${filters.fromDate}`);
    if (filters.toDate) applied.push(`Hasta: ${filters.toDate}`);
    if (!applied.length){
      el.classList.add('d-none');
      el.textContent = '';
      return;
    }
    el.classList.remove('d-none');
    el.textContent = `Filtros aplicados · ${applied.join(' · ')}`;
  }

  function disposeChart(ref){
    try { if (ref && typeof ref.dispose === 'function') ref.dispose(); } catch(_) {}
  }

  function renderCharts(){
    disposeChart(state.charts.month);
    disposeChart(state.charts.class);
    disposeChart(state.charts.relocation);
    disposeChart(state.charts.hour);
    disposeChart(state.charts.method);
    const monthData = aggregateByMonth(state.filtered);
    const classData = aggregateByClase(state.filtered);
    const relocationData = aggregateByKey(state.filtered, 'Disposición final');
    const hourData = aggregateByHour(state.filtered);
    const methodData = aggregateByKey(state.filtered, 'Método de captura');
    state.charts.month = renderBarChart('fauna-rescate-by-month', monthData.labels, monthData.values, { color: '#1565c0' });
    state.charts.class = renderPieChart('fauna-rescate-by-class', classData.labels, classData.values);
    state.charts.relocation = renderRelocationChart('fauna-rescate-by-relocation', relocationData.labels, relocationData.values);
    state.charts.hour = renderBarChart('fauna-rescate-by-hour', hourData.labels, hourData.values, { color: '#fb8c00' });
    state.charts.method = renderBarChart('fauna-rescate-by-method', methodData.labels, methodData.values, { color: '#6366f1', orientation: 'h' });
  }

  function normalizeClase(raw){
    const s = String(raw || '').trim();
    if (!s) return 'Sin clasificar';
    const norm = s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if (/^aves?$/.test(norm) || norm.startsWith('ave ')) return 'Ave';
    if (/^mamifer/.test(norm)) return 'Mamífero';
    if (/^reptil/.test(norm)) return 'Reptil';
    if (/^anfibi/.test(norm)) return 'Anfibio';
    if (/^pe[sc]/.test(norm)) return 'Pez';
    if (/^insect/.test(norm) || /^artropod/.test(norm)) return 'Insecto';
    return s;
  }

  function rowIndividuals(row){
    const n = Number(row && row['No. individuos']);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function aggregateByClase(rows){
    const counts = new Map();
    rows.forEach(row => {
      const inc = rowIndividuals(row);
      if (!inc) return;
      const key = normalizeClase(row['Clase']);
      counts.set(key, (counts.get(key) || 0) + inc);
    });
    const ordered = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
    return {
      labels: ordered.map(([label]) => label),
      values: ordered.map(([,value]) => value)
    };
  }


  function aggregateByMonth(rows){
    const counts = new Map();
    rows.forEach(row => {
      const month = String(row['Mes'] || '').trim();
      if (!month) return;
      const inc = rowIndividuals(row);
      if (!inc) return;
      const idx = MONTH_NAMES.indexOf(month);
      const key = idx >= 0 ? `${String(idx).padStart(2,'0')}-${month}` : `99-${month}`;
      counts.set(key, (counts.get(key) || 0) + inc);
    });
    const ordered = Array.from(counts.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
    return {
      labels: ordered.map(([key]) => {
        const parts = key.split('-');
        const idx = Number(parts[0]);
        return idx >= 0 && idx < MONTH_ABBRS.length ? MONTH_ABBRS[idx] : parts.slice(1).join('-');
      }),
      values: ordered.map(([,value]) => value)
    };
  }

  function aggregateByKey(rows, key){
    const counts = new Map();
    rows.forEach(row => {
      const val = String(row[key] || '').trim();
      if (!val) return;
      const inc = rowIndividuals(row);
      if (!inc) return;
      counts.set(val, (counts.get(val) || 0) + inc);
    });
    const ordered = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
    return {
      labels: ordered.map(([label]) => label),
      values: ordered.map(([,value]) => value)
    };
  }

  function aggregateByHour(rows){
    const buckets = new Array(24).fill(0);
    rows.forEach(row => {
      const raw = String(row['Hora'] || '').trim();
      // Match HH:MM or HH:MM:SS
      const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
      if (!match) return;
      const inc = rowIndividuals(row);
      if (!inc) return;
      const hour = Number(match[1]);
      buckets[hour] += inc;
    });
    return {
      labels: buckets.map((_, idx) => `${String(idx).padStart(2,'0')}:00`),
      values: buckets
    };
  }

  function renderBarChart(id, labels, values, opts){
    if (!window.echarts) return null;
    const host = document.getElementById(id);
    if (!host) return null;
    if (!host.classList.contains('fauna-relocation-chart')) {
      host.classList.add('fauna-relocation-chart');
    }
    let chart = window.echarts.getInstanceByDom(host);
    if (!chart) {
      chart = window.echarts.init(host);
    }
    const orientation = opts?.orientation === 'h' ? 'h' : 'v';
    const isSmall = window.matchMedia && window.matchMedia('(max-width: 576px)').matches;
    const option = {
      grid: {
        left: orientation === 'v' ? (isSmall ? 48 : 60) : (isSmall ? 60 : 90),
        right: orientation === 'v' ? 16 : (isSmall ? 24 : 48),
        top: isSmall ? 32 : 40,
        bottom: orientation === 'v' ? (isSmall ? 48 : 52) : (isSmall ? 20 : 24),
        containLabel: true
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: orientation === 'v'
        ? { type: 'category', data: labels, axisLabel: { color: '#334155' } }
        : { type: 'value', axisLabel: { color: '#334155' } },
      yAxis: orientation === 'v'
        ? { type: 'value', axisLabel: { color: '#334155' } }
        : { type: 'category', data: labels, inverse: true, axisLabel: { color: '#334155' } },
      series: [{
        type: 'bar',
        data: values,
        itemStyle: { color: opts?.color || '#1565c0' },
        label: {
          show: true,
          position: orientation === 'v' ? 'top' : 'right',
          color: '#1f2937',
          fontSize: isSmall ? 10 : 12,
          fontWeight: 600,
          formatter: ({ value }) => (value ? value : '')
        }
      }]
    };
    chart.setOption(option, true);
    return chart;
  }

  function renderPieChart(id, labels, values){
    if (!window.echarts) return null;
    const host = document.getElementById(id);
    if (!host) return null;
    let chart = window.echarts.getInstanceByDom(host);
    if (!chart) {
      chart = window.echarts.init(host);
    }
    const data = labels.map((name, idx) => ({ name, value: values[idx] ?? 0 })).filter(item => item.value > 0);
    const option = {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { orient: 'vertical', left: 'left', textStyle: { color: '#334155' } },
      series: [{
        name: 'Clase',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['55%', '55%'],
        data,
        label: { formatter: '{b}\n{c}', fontWeight: 600 },
        labelLine: { smooth: true, length: 16, length2: 10 },
        itemStyle: {
          shadowBlur: 12,
          shadowColor: 'rgba(15, 23, 42, 0.2)'
        }
      }]
    };
    chart.setOption(option, true);
    return chart;
  }

  function renderRelocationChart(id, labels, values){
    if (!window.echarts) return null;
    const host = document.getElementById(id);
    if (!host) return null;

    const isSmall = window.matchMedia && window.matchMedia('(max-width: 576px)').matches;
    const pairs = labels.map((label, idx) => ({
      label,
      value: Number(values[idx]) || 0
    }));

    // Auto-adjust container height to prevent overlap with multi-line names
    const itemHeight = isSmall ? 55 : 65; 
    const calculatedHeight = Math.max(320, pairs.length * itemHeight + 60);
    host.style.height = `${calculatedHeight}px`;
    
    if (host.parentElement && host.parentElement.classList.contains('chart-container')) {
       host.parentElement.style.height = 'auto'; // allow expanding beyond 320px
       host.parentElement.style.minHeight = '320px';
    }

    let chart = window.echarts.getInstanceByDom(host);
    if (!chart) {
      chart = window.echarts.init(host);
    } else {
      chart.resize();
    }

    const isDark = !!(document.body && document.body.classList && document.body.classList.contains('dark-mode'));
    const leftPadding = '2%';
    const maxValue = pairs.reduce((max, item) => Math.max(max, item.value), 0);
    const rightPadding = Math.max(isSmall ? 32 : 48, String(Math.max(maxValue, 0)).length * (isSmall ? 8 : 11) + 28);
    const axisLabelColor = isDark ? '#e2e8f0' : '#1f2937';
    const axisSecondaryColor = isDark ? '#cbd5f5' : '#6b7280';
    const splitLineColor = isDark ? 'rgba(148,163,184,0.35)' : '#d9dde3';
    const valueColor = isDark ? '#f8fafc' : '#111827';
    const barGradient = new window.echarts.graphic.LinearGradient(0, 0, 1, 0, [
      { offset: 0, color: isDark ? '#22c55e' : '#bbf7d0' },
      { offset: 1, color: isDark ? '#16a34a' : '#4ade80' }
    ]);
    const option = {
      grid: {
        left: leftPadding,
        right: rightPadding,
        top: isSmall ? 26 : 34,
        bottom: isSmall ? 18 : 26,
        containLabel: true
      },
      animationDuration: 400,
      tooltip: {
        trigger: 'item',
        formatter: ({ dataIndex, value }) => {
          const original = pairs[dataIndex]?.label || '';
          return `${original}<br/><strong>${value}</strong> rescates`;
        }
      },
      xAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisSecondaryColor, fontWeight: 600 },
        splitLine: { show: true, lineStyle: { color: splitLineColor } }
      },
      yAxis: {
        type: 'category',
        data: pairs.map(item => item.label),
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisLabelColor,
          fontWeight: 600,
          fontSize: isSmall ? 10 : 12,
          lineHeight: isSmall ? 14 : 16,
          margin: isSmall ? 10 : 14,
          width: isSmall ? 130 : 250,
          overflow: 'break'
        }
      },
      series: [{
        type: 'bar',
        data: pairs.map(item => item.value),
        barWidth: isSmall ? 18 : 24,
        itemStyle: {
          color: barGradient,
          borderRadius: [4, 14, 14, 4],
          shadowColor: isDark ? 'rgba(34,197,94,0.48)' : 'rgba(34,197,94,0.28)',
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowOffsetY: 4
        },
        label: {
          show: true,
          position: 'right',
          color: valueColor,
          fontWeight: 700,
          fontSize: isSmall ? 11 : 13,
          formatter: ({ value }) => (value ? value : '')
        },
        emphasis: {
          itemStyle: {
            shadowColor: isDark ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.4)',
            shadowBlur: 14,
            shadowOffsetX: 0,
            shadowOffsetY: 4
          }
        }
      }]
    };
    chart.setOption(option, true);
    return chart;
  }

  function renderSpecies(){
    const container = document.getElementById('fauna-rescate-top-species');
    if (!container) return;
    const counts = new Map();
    state.filtered.forEach(row => {
      const common = String(row['Nombre común'] || '').trim();
      const scientific = String(row['Nombre científico'] || '').trim();
      const key = common || scientific;
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + Number(row['No. individuos'] || 1));
    });
    const ordered = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
    if (!ordered.length){
      container.innerHTML = '<span class="text-muted small">Sin datos para los filtros actuales.</span>';
      return;
    }
    const limit = Math.min(ordered.length, 8);
    const chips = [];
    for (let i = 0; i < limit; i++){
      const [label, count] = ordered[i];
      chips.push(`<span class="badge">${escapeHtml(label)} · ${count}</span>`);
    }
    container.innerHTML = chips.join('');
  }

  function renderTable(){
    const container = document.getElementById('fauna-rescate-table');
    if (!container) return;
    
    const columns = [...TABLE_COLUMNS];
    const dm = window.dataManager;
    const isAdmin = dm && dm.isAdmin && (dm.userRole === 'control_fauna' || dm.userRole === 'superadmin' || dm.userRole === 'admin');
    
    // Ensure Acciones column
    if (isAdmin && !columns.includes('Acciones')) {
        columns.push('Acciones');
    }

    if (!state.filtered.length && !state.isAdding){
       if (!isAdmin) {
          container.innerHTML = '<div class="text-muted">Sin registros para los filtros seleccionados.</div>';
          return;
       }
    }
    
    let toolbarHtml = '';
    if (isAdmin) {
       if (!state.isAdding) {
            toolbarHtml = `<div class="d-flex justify-content-end mb-2">
                    <button class="btn btn-sm btn-primary" onclick="window.faunaRescateStartAdd()">
                        <i class="fas fa-plus"></i> Agregar Fila
                    </button>
            </div>`;
       }
    }

    let addRowHtml = '';
    if (state.isAdding) {
        addRowHtml = '<tr class="table-primary">';
        addRowHtml += columns.map(col => {
            if (col === 'Acciones') {
                return `<td>
                    <div class="d-flex gap-1">
                        <button class="btn btn-sm btn-success" onclick="window.faunaRescateSaveNew()" title="Guardar"><i class="fas fa-save"></i></button>
                        <button class="btn btn-sm btn-secondary" onclick="window.faunaRescateCancelAdd()" title="Cancelar"><i class="fas fa-times"></i></button>
                    </div>
                </td>`;
            }
            if (col === 'Año' || col === 'Mes') return '<td>-</td>';
            const dbField = DB_MAPPING_RESCATES[col];
            let type = 'text';
            if (dbField === 'date') type = 'date';
            if (dbField === 'time') type = 'time';
            if (dbField === 'quantity' || dbField === 'capture_number') type = 'number';
            
            return `<td><input type="${type}" class="form-control form-control-sm" data-new-col="${col}" placeholder="${col}"></td>`;
        }).join('');
        addRowHtml += '</tr>';
    }

    let filterRow = '<tr class="filter-row">';
    filterRow += columns.map(c => {
        if (c === 'Acciones' || c === 'Mes' || c === 'Año' || c === '_raw') return '<th></th>';
        const val = (state.columnFilters && state.columnFilters[c]) || '';
        return `<th><input type="text" class="form-control form-control-sm" placeholder="Filtrar..." value="${escapeHtml(val)}" onkeyup="window.faunaRescateFilterColumn('${escapeHtml(c)}', this.value)"></th>`;
    }).join('');
    filterRow += '</tr>';

    const thead = '<thead><tr>' + columns.map(col => `<th class="text-nowrap">${escapeHtml(col)}</th>`).join('') + '</tr>' + filterRow + '</thead>';
    const rowsHtml = state.filtered.map(row => {
      return '<tr>' + columns.map(col => {
          if (col === 'Acciones') {
             let id = (row._raw && row._raw.id) || row['No. captura'];
             if (!id) return '<td></td>';
             return `<td>
                <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-primary" onclick="window.faunaRescateEdit('${id}')" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="window.faunaRescateDelete('${id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </td>`;
          }
          return `<td>${escapeHtml(row[col])}</td>`;
      }).join('') + '</tr>';
    }).join('');
    
    const existingTable = container.querySelector('table');
    
    // Partial Update
    if (existingTable && !state.isAddingToggleChanged) {
        const tBodyEl = existingTable.querySelector('tbody');
        if (tBodyEl) {
            tBodyEl.innerHTML = `${addRowHtml}${rowsHtml}`;
            return;
        }
    }
    state.isAddingToggleChanged = false;
    
    // Use toolbarHtml variable, fixed the bug where toolbar was injected into div tag
    const table = `${toolbarHtml}<div class="table-container-tech h-scroll-area"><table class="table table-striped table-hover table-sm align-middle">${thead}<tbody>${addRowHtml}${rowsHtml}</tbody></table></div>`;
    container.innerHTML = table;
  }

  window.faunaRescateFilterColumn = function(col, val) {
      if (!state.columnFilters) state.columnFilters = {};
      state.columnFilters[col] = val;
      applyFilters();
  };

  window.faunaRescateStartAdd = function() {
      state.isAdding = true;
      state.isAddingToggleChanged = true;
      renderTable();
  };

  window.faunaRescateCancelAdd = function() {
      state.isAdding = false;
      state.isAddingToggleChanged = true;
      renderTable();
  };

  window.faunaRescateSaveNew = async function() {
      if (!window.dataManager || !window.dataManager.client) return;

      const inputs = document.querySelectorAll('#fauna-rescate-table input[data-new-col]');
      const data = {};
      let hasData = false;

      inputs.forEach(input => {
          const col = input.getAttribute('data-new-col');
          const val = input.value.trim();
          const dbField = DB_MAPPING_RESCATES[col];
          if (dbField && val) {
              data[dbField] = val;
              hasData = true;
          }
      });

      if (!hasData) {
          alert('Ingresa al menos un dato');
          return;
      }

      try {
          // Auto fields like id are handled by DB
          const { error } = await window.dataManager.client
              .from('rescued_wildlife')
              .insert([data]);
          
          if (error) throw error;
          
          state.isAdding = false;
          // init();
          // Rely on data-updated event
          window.dispatchEvent(new CustomEvent('data-updated', { detail: { table: 'rescued_wildlife' } }));
      } catch(e) {
          console.error("Error saving rescued wildlife", e);
          alert('Error al guardar: ' + e.message);
      }
  };

  // Expose handlers closing over state
  window.faunaRescateEdit = function(id) {
        if (!window.dataManagement) return;
        // Search in state.raw
        const found = state.raw.find(r => {
            const rid = (r._raw && r._raw.id) || r['No. captura'];
            return String(rid) === String(id);
        });
        
        if (found && found._raw) {
             window.dataManagement.editItem('rescued_wildlife', found._raw);
        } else {
             // Fallback: maybe just pass what we have if _raw isn't there (should be though)
             console.warn('Registro rescate no encontrado:', id);
        }
  };

  window.faunaRescateDelete = function(id) {
       if (!window.dataManagement) return;
       window.dataManagement.deleteItem('rescued_wildlife', id);
  };

  function exportCSV(){
    if (!state.filtered.length) return;
    const header = TABLE_COLUMNS.map(csvEscape).join(',');
    const rows = state.filtered.map(row => TABLE_COLUMNS.map(col => csvEscape(row[col])).join(','));
    const csv = '\ufeff' + [header].concat(rows).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fauna_rescatada.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(value){
    if (value === null || value === undefined) value = '';
    let str = String(value);
    if (/["\n\r,]/.test(str)){
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function clearFilters(){
    const monthSel = document.getElementById('fauna-rescate-month'); if (monthSel) monthSel.value = 'all';
    const classSel = document.getElementById('fauna-rescate-class'); if (classSel) classSel.value = 'all';
    const methodSel = document.getElementById('fauna-rescate-method'); if (methodSel) methodSel.value = 'all';
    const quadrantSel = document.getElementById('fauna-rescate-quadrant'); if (quadrantSel) quadrantSel.value = 'all';
    const disposalSel = document.getElementById('fauna-rescate-disposal'); if (disposalSel) disposalSel.value = 'all';
    const from = document.getElementById('fauna-rescate-date-from'); if (from) from.value = '';
    const to = document.getElementById('fauna-rescate-date-to'); if (to) to.value = '';
    applyFilters();
  }

  function bindEvents(){
    if (state.eventsBound) return;
    state.eventsBound = true;
    
    window.addEventListener('admin-mode-changed', () => {
       renderTable();
    });

    document.getElementById('fauna-rescate-month')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-class')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-method')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-quadrant')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-disposal')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-date-from')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-date-to')?.addEventListener('change', applyFilters);
    document.getElementById('fauna-rescate-clear')?.addEventListener('click', (ev)=>{ ev.preventDefault(); clearFilters(); });
    document.getElementById('fauna-rescate-export')?.addEventListener('click', (ev)=>{ ev.preventDefault(); exportCSV(); });
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          Object.values(state.charts).forEach(chart => { if (chart && typeof chart.resize === 'function') chart.resize(); });
        } catch(_) {}
      }, 120);
    });
    window.addEventListener('fauna:visible', () => {
      const pane = document.getElementById('gso-fauna-rescate-pane');
      if (!pane) return;
      if (pane.classList.contains('show') || pane.classList.contains('active')){
        setTimeout(() => {
          try {
            Object.values(state.charts).forEach(chart => { if (chart && typeof chart.resize === 'function') chart.resize(); });
          } catch(_) {}
        }, 60);
      }
    });

    // Listen for updates
    window.addEventListener('data-updated', (e) => {
      if (e.detail && e.detail.table === 'rescued_wildlife') {
          init(); 
      }
    });
  }

  async function init(){
    if (state.isLoading) return;
    state.isLoading = true;
    const pane = document.getElementById('gso-fauna-rescate-pane');
    if (!pane) { state.isLoading = false; return; }
    
    try {
      const rows = await loadDataset();
      state.raw = (rows || []).map(normalizeRow);
      state.years = deriveYears(state.raw);
      if (!state.years.length) {
        state.year = 'all';
      } else if (!state.year || state.year === 'all' || !state.years.includes(state.year)) {
        state.year = state.years[state.years.length - 1];
      }
      renderYearSwitch();
      updateYearLabel();
      populateFilters();
      bindEvents();
      applyFilters();
    } catch(err) {
      console.warn('fauna-rescate: init error', err);
      const table = document.getElementById('fauna-rescate-table');
      if (table) table.innerHTML = '<div class="text-danger">No se pudo cargar fauna_rescatada.</div>';
    } finally {
      state.isLoading = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
