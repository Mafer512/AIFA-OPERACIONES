(function(){
  const pane = document.getElementById('frecuencias-auto-pane');
  if (!pane) return;

  const DATA_URL = 'data/frecuencias_semanales.json';
  const DAY_CODES = ['L','M','X','J','V','S','D'];
  const DAY_LABELS = { L: 'Lunes', M: 'Martes', X: 'Miércoles', J: 'Jueves', V: 'Viernes', S: 'Sábado', D: 'Domingo' };
  const intlNumber = new Intl.NumberFormat('es-MX');
  const intlDate = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  const AIRLINE_CONFIG = {
    'aeromexico': { logo: 'logo_aeromexico.png', color: '#0b2161', text: '#ffffff' },
    'aeromexico-connect': { logo: 'logo_aeromexico.png', color: '#0b2161', text: '#ffffff' },
    'aerolitoral': { logo: 'logo_aeromexico.png', color: '#0b2161', text: '#ffffff' },
    'volaris': { logo: 'logo_volaris.png', color: '#a300e6', text: '#ffffff' },
    'viva-aerobus': { logo: 'logo_viva.png', color: '#00a850', text: '#ffffff' },
    'viva': { logo: 'logo_viva.png', color: '#00a850', text: '#ffffff' },
    'vivaaerobus': { logo: 'logo_viva.png', color: '#00a850', text: '#ffffff' },
    'mexicana': { logo: 'logo_mexicana.png', color: '#008375', text: '#ffffff' },
    'copa-airlines': { logo: 'logo_copa.png', color: '#00529b', text: '#ffffff' },
    'copa': { logo: 'logo_copa.png', color: '#00529b', text: '#ffffff' },
    'arajet': { logo: 'logo_arajet.png', color: '#632683', text: '#ffffff' },
    'conviasa': { logo: 'logo_conviasa.png', color: '#e65300', text: '#ffffff' },
    'magnicharters': { logo: 'logo_magnicharters.png', color: '#1d3c6e', text: '#ffffff' },
    'magni': { logo: 'logo_magnicharters.png', color: '#1d3c6e', text: '#ffffff' },
    'aerus': { logo: 'logo_aerus.png', color: '#bed62f', text: '#000000' },
    'default': { logo: null, color: '#ffffff', text: '#212529' }
  };

  const AIFA_COORDS = { lat: 19.7456, lng: -99.0086 };

  // --- DESTINATION IMAGES (LOCAL FOLDER MAPPING) ---
  // Maps IATA codes to local file paths in images/destinos/ folder.
  // Filenames include accents and proper capitalization as requested.
  const DESTINATION_IMAGES = {
     'ACA': 'images/destinos/Acapulco.jpg',
     'BJX': 'images/destinos/León.jpg',
     'CEN': 'images/destinos/Ciudad Obregón.jpg',
     'CJS': 'images/destinos/Ciudad Juárez.jpg',
     'CLQ': 'images/destinos/Colima.jpg',
     'CPE': 'images/destinos/Campeche.jpg',
     'CTM': 'images/destinos/Chetumal.jpg',
     'CUL': 'images/destinos/Culiacán.jpg',
     'CUN': 'images/destinos/Cancún.jpg',
     'CUU': 'images/destinos/Chihuahua.jpg',
     'CVM': 'images/destinos/Ciudad Victoria.jpg',
     'DGO': 'images/destinos/Durango.jpg',
     'GDL': 'images/destinos/Guadalajara.jpg',
     'HMO': 'images/destinos/Hermosillo.jpg',
     'HUX': 'images/destinos/Huatulco.jpg',
     'IZT': 'images/destinos/Ixtepec.jpg',
     'LAP': 'images/destinos/La Paz.jpg',
     'MAM': 'images/destinos/Matamoros.jpg',
     'MID': 'images/destinos/Mérida.jpg',
     'MTY': 'images/destinos/Monterrey.jpg',
     'MZT': 'images/destinos/Mazatlán.jpg',
     'NLD': 'images/destinos/Nuevo Laredo.jpg',
     'OAX': 'images/destinos/Oaxaca.jpg',
     'PQM': 'images/destinos/Palenque.jpg',
     'PVR': 'images/destinos/Puerto Vallarta.jpg',
     'PXM': 'images/destinos/Puerto Escondido.jpg',
     'REX': 'images/destinos/Reynosa.jpg',
     'SJD': 'images/destinos/Los Cabos.jpg',
     'SLP': 'images/destinos/San Luis Potosí.jpg',
     'SLW': 'images/destinos/Saltillo.jpg',
     'TAM': 'images/destinos/Tampico.jpg',
     'TGZ': 'images/destinos/Tuxtla Gutiérrez.jpg',
     'TIJ': 'images/destinos/Tijuana.jpg',
     'TPQ': 'images/destinos/Tepic.jpg',
     'TQO': 'images/destinos/Tulum.jpg',
     'VER': 'images/destinos/Veracruz.jpg',
     'VSA': 'images/destinos/Villahermosa.jpg',
     'ZIH': 'images/destinos/Zihuatanejo.jpg'
  };

  // --- CITY NAME CORRECTIONS (ACCENTS) ---
  // Overrides raw data from JSON/CSV for display purposes.
  const CITY_DISPLAY_NAMES = {
    'ACA': 'Acapulco',
    'BJX': 'León',
    'CEN': 'Ciudad Obregón',
    'CJS': 'Ciudad Juárez',
    'CLQ': 'Colima',
    'CPE': 'Campeche',
    'CTM': 'Chetumal',
    'CUL': 'Culiacán',
    'CUN': 'Cancún',
    'CUU': 'Chihuahua',
    'CVM': 'Ciudad Victoria',
    'DGO': 'Durango',
    'GDL': 'Guadalajara',
    'HMO': 'Hermosillo',
    'HUX': 'Huatulco',
    'IZT': 'Ixtepec',
    'LAP': 'La Paz',
    'MAM': 'Matamoros',
    'MID': 'Mérida',
    'MTY': 'Monterrey',
    'MZT': 'Mazatlán',
    'NLD': 'Nuevo Laredo',
    'OAX': 'Oaxaca',
    'PQM': 'Palenque',
    'PVR': 'Puerto Vallarta',
    'PXM': 'Puerto Escondido',
    'QRO': 'Querétaro',
    'REX': 'Reynosa',
    'SJD': 'San José del Cabo',
    'SLP': 'San Luis Potosí',
    'SLW': 'Saltillo',
    'TAM': 'Tampico',
    'TGZ': 'Tuxtla Gutiérrez',
    'TIJ': 'Tijuana',
    'TPQ': 'Tepic',
    'TQO': 'Tulum',
    'TRC': 'Torreón',
    'VER': 'Veracruz',
    'VSA': 'Villahermosa',
    'ZIH': 'Zihuatanejo'
};

  const AIRPORT_COORDS = {
    ACA: { lat: 16.7571, lng: -99.7534 },
    BJX: { lat: 20.9935, lng: -101.4809 },
    CEN: { lat: 27.3926, lng: -109.8330 },
    CJS: { lat: 31.6361, lng: -106.4280 },
    CLQ: { lat: 19.2770, lng: -103.5770 },
    CPE: { lat: 19.8168, lng: -90.5003 },
    CTM: { lat: 18.5047, lng: -88.3268 },
    CUL: { lat: 24.7650, lng: -107.4747 },
    CUN: { lat: 21.0365, lng: -86.8769 },
    CUU: { lat: 28.7029, lng: -105.9646 },
    CVM: { lat: 23.7033, lng: -98.9565 },
    DGO: { lat: 24.1242, lng: -104.5280 },
    GDL: { lat: 20.5218, lng: -103.3103 },
    HMO: { lat: 29.0959, lng: -111.0480 },
    HUX: { lat: 15.7753, lng: -96.2626 },
    IZT: { lat: 16.4493, lng: -95.0937 },
    LAP: { lat: 24.0731, lng: -110.3610 },
    MAM: { lat: 25.7699, lng: -97.5253 },
    MID: { lat: 20.9348, lng: -89.6636 },
    MTY: { lat: 25.7785, lng: -100.1070 },
    MZT: { lat: 23.1614, lng: -106.2660 },
    NLD: { lat: 27.4439, lng: -99.5705 },
    OAX: { lat: 16.9990, lng: -96.7266 },
    PQM: { lat: 17.5332, lng: -92.0155 },
    PVR: { lat: 20.6801, lng: -105.2542 },
    PXM: { lat: 15.8769, lng: -97.0891 },
    REX: { lat: 26.0089, lng: -98.2285 },
    SJD: { lat: 23.1517, lng: -109.7210 },
    SLP: { lat: 22.2543, lng: -100.9305 },
    SLW: { lat: 25.5495, lng: -100.9280 },
    TAM: { lat: 22.2964, lng: -97.8659 },
    TGZ: { lat: 16.5618, lng: -93.0216 },
    TIJ: { lat: 32.5411, lng: -116.9719 },
    TPQ: { lat: 21.4195, lng: -104.8420 },
    TQO: { lat: 20.6173, lng: -87.0822 },
    TRC: { lat: 25.5683, lng: -103.4100 },
    VER: { lat: 19.1450, lng: -96.1873 },
    VSA: { lat: 17.9960, lng: -92.8174 },
    ZIH: { lat: 17.6016, lng: -101.4605 }
  };

  const dom = {
    loading: pane.querySelector('#frecuencias-loading'),
    content: pane.querySelector('#frecuencias-content'),
    error: pane.querySelector('#frecuencias-error'),
    weekLabel: pane.querySelector('[data-week-label]'),
    weekRange: pane.querySelector('[data-week-range]'),
    lastUpdated: pane.querySelector('[data-last-updated]'),
    kpis: {
      flights: pane.querySelector('[data-kpi="flights"]'),
      destinations: pane.querySelector('[data-kpi="destinations"]'),
      airlines: pane.querySelector('[data-kpi="airlines"]')
    },
    kpiNotes: {
      flights: pane.querySelector('[data-kpi-note="flights"]'),
      destinations: pane.querySelector('[data-kpi-note="destinations"]'),
      airlines: pane.querySelector('[data-kpi-note="airlines"]')
    },
    filters: {
      airline: pane.querySelector('#frecuencias-airline-filter'),
      destination: pane.querySelector('#frecuencias-destination-filter'),
      day: pane.querySelector('#frecuencias-day-filter'),
      search: pane.querySelector('#frecuencias-search')
    },
    resetFilters: pane.querySelector('#frecuencias-reset-filters'),
    excelButton: pane.querySelector('#frecuencias-download-excel'),
    scheduleButton: pane.querySelector('#frecuencias-download-horarios'),
    activeFilters: pane.querySelector('#frecuencias-active-filters'),
    dowList: pane.querySelector('#frecuencias-dow-list'),
    insights: pane.querySelector('#frecuencias-insights'),
    mapContainer: pane.querySelector('#frecuencias-map'),
    mapEmpty: pane.querySelector('#frecuencias-map-empty'),
    fitButton: pane.querySelector('#frecuencias-fit-map'),
    tableBody: pane.querySelector('#frecuencias-destinos-table tbody'),
    tableCount: pane.querySelector('#frecuencias-table-count'),
    tableEmpty: pane.querySelector('#frecuencias-empty'),
    mapCol: pane.querySelector('#frecuencias-map-col'),
    detailsCol: pane.querySelector('#frecuencias-details-col'),
    detailsTitle: pane.querySelector('#frecuencias-details-title'),
    detailsBody: pane.querySelector('#frecuencias-details-body'),
    detailsClose: pane.querySelector('#frecuencias-details-close'),
    detailsCopy: pane.querySelector('#frecuencias-copy-whatsapp')
  };

  const state = {
    raw: null,
    destinations: [],
    filtered: [],
    filters: { airline: 'all', destination: 'all', day: 'all', search: '' },
    uniqueAirlines: [],
    map: null,
    markerLayer: null,
    planeLayer: null,
    animationFrameId: null,
    animationTimeoutId: null,
    currentDetailDest: null
  };

  document.addEventListener('DOMContentLoaded', init);

  // Expose for global refresh
  window.reloadFrecuenciasNational = init;

    document.addEventListener('shown.bs.tab', evt => {
    if (evt.target && evt.target.id === 'frecuencias-auto-tab') {
      // Force immediate resize with no delay for better perceived performance
      requestAnimationFrame(() => {
         state.map?.invalidateSize();
         fitMapToData();
         // Ensure animation restarts/continues
         if (state.filtered && state.filtered.length > 0) {
             animatePlanes(state.filtered);
         }
      });
    }
  });

  // Carga coordenadas desde la tabla aeropuertos y las fusiona con AIRPORT_COORDS.
  // Los valores hardcoded tienen prioridad; los registros de la BD llenan los huecos.
  async function loadDBCoords() {
    try {
      const sb = window.supabaseClient;
      if (!sb) return;
      const { data } = await sb
        .from('aeropuertos')
        .select('iata,lat,lng')
        .not('lat', 'is', null);
      if (!data) return;
      data.forEach(r => {
        if (r.iata && r.lat != null && r.lng != null && !AIRPORT_COORDS[r.iata]) {
          AIRPORT_COORDS[r.iata] = { lat: r.lat, lng: r.lng };
        }
      });
    } catch (e) {
      console.warn('loadDBCoords (nacional) error:', e);
    }
  }

  async function init(){
    prepareFilterSkeletons();
    showLoading(true);
    try {
      // const data = await fetchJson(DATA_URL);
      let data;
      try {
        const dbData = await window.dataManager.getWeeklyFrequencies();
        data = transformDBData(dbData);
      } catch (e) {
        console.warn('Database fetch failed, falling back to JSON', e);
        data = await fetchJson(DATA_URL);
      }

      await loadDBCoords();
      state.raw = data;
      state.destinations = normalizeDestinations(data?.destinations || []);
      state.uniqueAirlines = collectAirlines(state.destinations);
      populateFilters();
      updateMeta(data);
      renderKPIs();
      renderEstadosCoberturaMap();
      applyFilters();
      await ensureLeaflet();
      initMap();
      renderMap();
      
      showLoading(false);
      dom.content?.classList.remove('d-none');
      
      // Force map to recognize its container size using ResizeObserver
      // This is the most robust way to handle "display: none" to "display: block" transitions
      // and dynamic layout changes.
      if (dom.mapContainer) {
          const resizeObserver = new ResizeObserver(() => {
              if (state.map) {
                  state.map.invalidateSize();
                  // Only fit bounds if we haven't done it successfully yet or on major resizes?
                  // Just invalidating size is usually enough if fitBounds was called, 
                  // but re-fitting ensures the view is correct.
                  // We debounce it slightly to avoid thrashing during animations.
                  if (state.resizeTimeout) clearTimeout(state.resizeTimeout);
                  state.resizeTimeout = setTimeout(() => {
                      fitMapToData();
                  }, 100);
              }
          });
          resizeObserver.observe(dom.mapContainer);
          // Keep reference to disconnect later if needed (though module stays alive)
          state.resizeObserver = resizeObserver;
      }
      
      // Also trigger once immediately just in case observer takes a tick
      requestAnimationFrame(() => {
          state.map?.invalidateSize();
          fitMapToData();
      });
      dom.content?.classList.remove('d-none');
    } catch (err) {
      console.error('Frecuencias automation error:', err);
      showError('No se pudo cargar la información de frecuencias. Verifique la conexión a la base de datos.');
      showLoading(false);
    }
    wireInteractions();
  }

  function transformDBData(rows) {
      if (!rows || rows.length === 0) return { weekLabel: '', validFrom: '', validTo: '', destinations: [] };
      
      // Group by week_label (assuming it uniquely identifies a dataset)
      const groups = {};
      rows.forEach(row => {
          const key = row.week_label;
          if (!groups[key]) {
              groups[key] = {
                  rows: [],
                  validFrom: new Date(row.valid_from + 'T00:00:00'),
                  // Force validTo to be 6 days after validFrom to ensure title coherence
                  // validTo: new Date(row.valid_to || row.valid_from) 
              };
              // Calculate validTo
              const vTo = new Date(groups[key].validFrom);
              vTo.setDate(vTo.getDate() + 6);
              groups[key].validTo = vTo;
          }
          groups[key].rows.push(row);
      });

      const today = new Date();
      // today.setHours(0,0,0,0); // Normalize today - ALREADY DONE by Date object if we compare timestamps? 
      // safer:
      today.setHours(0,0,0,0);

      // FORCE LATEST WEEK LOGIC (AS PER USER REQUEST)
      // Instead of finding the "closest" week, we strictly find the week with the LATEST validFrom date.
      // This ensures that as soon as a new week is uploaded (even if it's future), it becomes the default view.
      
      const sortedKeys = Object.keys(groups).sort((a, b) => {
          return groups[b].validFrom - groups[a].validFrom; // Descending date
      });

      let selectedKey = sortedKeys[0];

      // If no valid week found? Should not happen if rows exist.
      if (!selectedKey) selectedKey = Object.keys(groups)[0];

      const selectedGroup = groups[selectedKey];
      const selectedRows = selectedGroup.rows;
      const first = selectedRows[0]; // metadata is same for all rows in group

      const weekLabel = first.week_label;
      const validFrom = first.valid_from;
      
      // Force validTo calculation related to validFrom + 6 days
      // Avoid relying on DB valid_to which might be incorrect
      const dFrom = new Date(validFrom + 'T00:00:00');
      const dTo = new Date(dFrom);
      dTo.setDate(dFrom.getDate() + 6);
      
      const year = dTo.getFullYear();
      const month = String(dTo.getMonth() + 1).padStart(2, '0');
      const day = String(dTo.getDate()).padStart(2, '0');
      const validTo = `${year}-${month}-${day}`;
      
      // Group by route_id or iata
      const destinationsMap = {};
      
      selectedRows.forEach(row => {
          if (!destinationsMap[row.iata]) {
              destinationsMap[row.iata] = {
                  routeId: row.route_id,
                  city: row.city,
                  state: row.state,
                  iata: row.iata,
                  airports: [row.iata],
                  airlines: []
              };
          }
          
          destinationsMap[row.iata].airlines.push({
              name: row.airline,
              logo: row.logo,   // NUEVO
              color: row.color, // NUEVO
              daily: {
                  L: row.monday,
                  M: row.tuesday,
                  X: row.wednesday,
                  J: row.thursday,
                  V: row.friday,
                  S: row.saturday,
                  D: row.sunday
              },
              dailyDetails: { // NUEVO
                  L: row.monday_detail,
                  M: row.tuesday_detail,
                  X: row.wednesday_detail,
                  J: row.thursday_detail,
                  V: row.friday_detail,
                  S: row.saturday_detail,
                  D: row.sunday_detail
              },
              weeklyTotal: row.weekly_total
          });
      });
      
      return {
          weekLabel,
          validFrom,
          validTo,
          destinations: Object.values(destinationsMap)
      };
  }

  function prepareFilterSkeletons(){
    if (dom.filters.airline) dom.filters.airline.innerHTML = '<option value="all">Todas las aerolíneas</option>';
    if (dom.filters.destination) dom.filters.destination.innerHTML = '<option value="all">Todos los destinos</option>';
    if (dom.filters.day) {
      dom.filters.day.innerHTML = '<option value="all">Todos los días</option>';
      DAY_CODES.forEach(code => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = DAY_LABELS[code];
        dom.filters.day.appendChild(opt);
      });
    }
  }

  function wireInteractions(){
    // Listen for tab shown event to restart animation instantly
    const tabEl = document.getElementById('frecuencias-auto-tab');
    if (tabEl) {
        tabEl.addEventListener('shown.bs.tab', () => {
            if (state.map) {
                state.map.invalidateSize();
                fitMapToData();
            }
            animatePlanes(state.filtered);
        });
    }

    if (dom.filters.airline) dom.filters.airline.addEventListener('change', evt => {
      state.filters.airline = evt.target.value || 'all';
      applyFilters();
    });
    if (dom.filters.destination) dom.filters.destination.addEventListener('change', evt => {
      state.filters.destination = evt.target.value || 'all';
      applyFilters();
    });
    if (dom.filters.day) dom.filters.day.addEventListener('change', evt => {
      state.filters.day = evt.target.value || 'all';
      applyFilters();
    });
    if (dom.filters.search) {
      const onSearch = debounce(evt => {
        state.filters.search = (evt.target.value || '').trim().toLowerCase();
        applyFilters();
      }, 220);
      dom.filters.search.addEventListener('input', onSearch);
    }
    if (dom.resetFilters) dom.resetFilters.addEventListener('click', () => {
      state.filters = { airline: 'all', destination: 'all', day: 'all', search: '' };
      if (dom.filters.airline) dom.filters.airline.value = 'all';
      if (dom.filters.destination) dom.filters.destination.value = 'all';
      if (dom.filters.day) dom.filters.day.value = 'all';
      if (dom.filters.search) dom.filters.search.value = '';
      applyFilters();
    });
    if (dom.excelButton) dom.excelButton.addEventListener('click', downloadExcel);
    if (dom.scheduleButton) dom.scheduleButton.addEventListener('click', downloadScheduleExcel);
    if (dom.fitButton) {
      // Agrupar botones en un contenedor para mantener el layout
      const header = dom.fitButton.parentNode;
      const wrapper = document.createElement('div');
      wrapper.className = 'd-flex gap-2';
      
      // Mover el botón existente al wrapper
      header.insertBefore(wrapper, dom.fitButton);
      wrapper.appendChild(dom.fitButton);

      dom.fitButton.addEventListener('click', () => fitMapToData());
      
      // Botón para limpiar filtro de mapa
      const resetMapBtn = document.createElement('button');
      resetMapBtn.className = 'btn btn-outline-secondary btn-sm d-none';
      resetMapBtn.innerHTML = '<i class="fas fa-undo me-1"></i>Mostrar todos';
      resetMapBtn.addEventListener('click', () => {
        state.filters.destination = 'all';
        if (dom.filters.destination) dom.filters.destination.value = 'all';
        applyFilters();
      });
      wrapper.appendChild(resetMapBtn);
      dom.resetMapBtn = resetMapBtn;
    }

    if (dom.detailsClose) {
      dom.detailsClose.addEventListener('click', () => {
        state.filters.destination = 'all';
        if (dom.filters.destination) dom.filters.destination.value = 'all';
        applyFilters();
      });
    }

    if (dom.detailsCopy) {
        dom.detailsCopy.addEventListener('click', copyToWhatsApp);
    }
  }

  function applyFilters() {
    // Restablecer el orden original basado en routeId
    state.destinations.sort((a, b) => {
        const idA = parseInt(a.routeId) || 9999;
        const idB = parseInt(b.routeId) || 9999;
        if (idA !== idB) return idA - idB;
        return a.city.localeCompare(b.city, 'es-MX');
    });
    const list = state.destinations
      .map(dest => projectDestination(dest))
      .filter(Boolean)
      .filter(dest => {
        if (state.filters.destination !== 'all' && dest.iata !== state.filters.destination) return false;
        if (state.filters.day !== 'all') {
          const idx = DAY_CODES.indexOf(state.filters.day);
          if (idx !== -1 && (dest.viewDailyTotals[idx] || 0) === 0) return false;
        }
        if (state.filters.search) {
          if (!dest.searchText.includes(state.filters.search)) return false;
        }
        return true;
      });

    state.filtered = list;
    
    if (dom.resetMapBtn) {
      dom.resetMapBtn.classList.toggle('d-none', state.filters.destination === 'all');
    }

    // Toggle Side Panel
    const isSingleDest = state.filters.destination !== 'all';
    if (dom.mapCol && dom.detailsCol) {
        if (isSingleDest) {
            // Dar más espacio a los días para que no haya scroll horizontal
            dom.mapCol.className = 'col-12 col-xl-3 col-lg-4 transition-all';
            dom.detailsCol.className = 'col-12 col-xl-9 col-lg-8';
            dom.detailsCol.classList.remove('d-none');
            // Render details
            const dest = state.destinations.find(d => d.iata === state.filters.destination);
            if (dest) renderDestinationDetails(dest);
        } else {
            dom.mapCol.className = 'col-12 transition-all';
            dom.detailsCol.classList.add('d-none');
        }
        // Trigger map resize after transition
        setTimeout(() => state.map?.invalidateSize(), 300);
    }

    updateActiveFiltersText();
    renderDowSummary();
    renderInsights();
    renderTable();
    renderMap();
  }

  function renderKPIs(){
    const totalFlights = state.destinations.reduce((sum, dest) => sum + dest.weeklyTotal, 0);
    const totalDestinations = state.destinations.length;
    const totalAirlines = state.uniqueAirlines.length;
    if (dom.kpis.flights) dom.kpis.flights.textContent = intlNumber.format(totalFlights);
    if (dom.kpis.destinations) dom.kpis.destinations.textContent = intlNumber.format(totalDestinations);
    if (dom.kpis.airlines) dom.kpis.airlines.textContent = intlNumber.format(totalAirlines);

    const busiestDest = [...state.destinations].sort((a, b) => b.weeklyTotal - a.weeklyTotal)[0];
    if (busiestDest && dom.kpiNotes.flights) {
      dom.kpiNotes.flights.textContent = `${busiestDest.city} (${busiestDest.iata}) lidera con ${intlNumber.format(busiestDest.weeklyTotal)} frecuencias.`;
    }
    if (dom.kpiNotes.destinations) dom.kpiNotes.destinations.textContent = 'Cobertura basada en rutas activas durante la semana.';
    if (dom.kpiNotes.airlines && state.uniqueAirlines[0]) {
       const top = state.uniqueAirlines[0];
       const legacyConfig = AIRLINE_CONFIG[top.slug] || AIRLINE_CONFIG['default'];
       const config = {
          logo: top.logo || legacyConfig.logo,
          color: top.color || legacyConfig.color
       };
       
       if (config.logo) {
         // Diseño más grande y estilizado tipo badge/tarjeta
         const logoHtml = `
            <div class="d-inline-flex align-items-center justify-content-center bg-white border rounded-3 px-3 py-1 ms-2 shadow-sm" style="height: 45px; vertical-align: middle;">
                <img src="images/airlines/${config.logo}" alt="${top.name}" title="${top.name}" style="height: 100%; width: auto; max-width: 110px; object-fit: contain;">
            </div>
         `;
         // Usamos flexbox center para alinear el texto "Top:" con la tarjeta del logo
         dom.kpiNotes.airlines.innerHTML = `<div class="d-flex align-items-center justify-content-center mt-2"><span class="fw-bold text-muted me-1">Top:</span> ${logoHtml}</div>`;
       } else {
         dom.kpiNotes.airlines.textContent = `Top: ${top.name}`;
       }
    }
  }

  function renderDowSummary(){
    if (!dom.dowList) return;
    const dataset = state.filtered.length ? state.filtered : state.destinations;
    dom.dowList.innerHTML = '';
    DAY_CODES.forEach((code, idx) => {
      const total = dataset.reduce((sum, dest) => sum + (dest.viewDailyTotals?.[idx] ?? dest.dailyTotals?.[idx] ?? 0), 0);
      const card = document.createElement('div');
      
      // Improved card design
      card.className = 'frecuencias-dow-card';
      card.style.cssText = `
        display: flex; 
        flex-direction: column; 
        align-items: flex-start; 
        justify-content: center;
        background: #fff; 
        border: 1px solid #e9ecef; 
        border-radius: 8px; 
        padding: 12px 16px; 
        min-width: 140px; 
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        transition: transform 0.2s, box-shadow 0.2s;
        flex: 1;
      `;
      card.onmouseover = () => {
          card.style.transform = 'translateY(-2px)';
          card.style.boxShadow = '0 6px 12px rgba(0,0,0,0.06)';
          card.style.borderColor = '#dee2e6';
      };
      card.onmouseout = () => {
          card.style.transform = 'translateY(0)';
          card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';
          card.style.borderColor = '#e9ecef';
      };

      const dayLabel = DAY_LABELS[code].toUpperCase(); // LUNES, MARTES...
      
      card.innerHTML = `
        <div style="font-size: 0.7rem; font-weight: 700; color: #6c757d; margin-bottom: 4px; letter-spacing: 0.5px;">${dayLabel}</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #212529; line-height: 1;">${intlNumber.format(total)}</div>
      `;
      dom.dowList.appendChild(card);
    });
  }

  function renderInsights(){
    if (!dom.insights) return;
    const dataset = state.filtered.length ? state.filtered : state.destinations;
    dom.insights.innerHTML = '';
    if (!dataset.length) return;

    const topDestination = [...dataset].sort((a, b) => (b.viewWeeklyTotal ?? b.weeklyTotal) - (a.viewWeeklyTotal ?? a.weeklyTotal))[0];
    if (topDestination) {
      dom.insights.appendChild(buildInsight('fa-location-dot', `${topDestination.city} (${topDestination.iata}) concentra ${intlNumber.format(topDestination.viewWeeklyTotal ?? topDestination.weeklyTotal)} frecuencias.`));
    }

    const airlineTotals = new Map();
    dataset.forEach((dest, destIndex) => {
      const source = dest.viewAirlines?.length ? dest.viewAirlines : dest.airlines;
      source.forEach(air => {
        if (!airlineTotals.has(air.name)) {
            airlineTotals.set(air.name, { total: 0, slug: air.slug, logo: air.logo, color: air.color });
        }
        airlineTotals.get(air.name).total += air.weeklyTotal;
      });
    });
    const topAirlineEntry = [...airlineTotals.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    
    if (topAirlineEntry) {
      const [name, data] = topAirlineEntry;
      const legacyConfig = AIRLINE_CONFIG[data.slug] || AIRLINE_CONFIG['default'];
      const config = {
          logo: data.logo || legacyConfig.logo,
          color: data.color || legacyConfig.color
      };
      let airlineDisplay = name;
      
      if (config.logo) {
          let logoStyle = 'height: 24px; width: auto; vertical-align: middle; margin-right: 4px;';
          if (['mexicana', 'volaris', 'aeromexico'].includes(data.slug)) {
              logoStyle = 'height: 40px; width: auto; vertical-align: middle; margin-right: 4px;';
          }
          airlineDisplay = `<img src="images/airlines/${config.logo}" alt="${name}" title="${name}" style="${logoStyle}">`;
      }
      
      dom.insights.appendChild(buildInsight('fa-plane', `${airlineDisplay} aporta ${intlNumber.format(data.total)} frecuencias semanales.`));
    }

    const dayTotals = DAY_CODES.map((code, idx) => ({ code, value: dataset.reduce((sum, dest) => sum + (dest.viewDailyTotals?.[idx] ?? dest.dailyTotals?.[idx] ?? 0), 0) }));
    const hottestDay = dayTotals.sort((a, b) => b.value - a.value)[0];
    if (hottestDay) {
      dom.insights.appendChild(buildInsight('fa-calendar-day', `${DAY_LABELS[hottestDay.code]} es el día con más frecuencias (${intlNumber.format(hottestDay.value)}).`));
    }
  }

  // ─── Cobertura por Estado ────────────────────────────────────────────────
  const _STATE_BY_IATA_MAP = {
    'AGU':'Aguascalientes',
    'TIJ':'Baja California','MXL':'Baja California','SNQ':'Baja California',
    'SJD':'Baja California Sur','LAP':'Baja California Sur','LTO':'Baja California Sur',
    'CPE':'Campeche','CME':'Campeche',
    'TGZ':'Chiapas','TUX':'Chiapas','PAL':'Chiapas',
    'CUU':'Chihuahua','CJT':'Chihuahua','JUZ':'Chihuahua',
    'MEX':'Ciudad de México',
    'SLW':'Coahuila','TRC':'Coahuila',
    'CLQ':'Colima',
    'DGO':'Durango',
    'BJX':'Guanajuato',
    'ACA':'Guerrero','ACN':'Guerrero','ZIH':'Guerrero',
    'GDL':'Jalisco','PVR':'Jalisco',
    'TLC':'Estado de México',
    'MLM':'Michoacán',
    'TPQ':'Nayarit',
    'MTY':'Nuevo León','NLD':'Nuevo León',
    'OAX':'Oaxaca','HUX':'Oaxaca','PXM':'Oaxaca','IXE':'Oaxaca',
    'PBC':'Puebla',
    'QRO':'Querétaro',
    'CUN':'Quintana Roo','CTM':'Quintana Roo','TKM':'Quintana Roo',
    'SLP':'San Luis Potosí',
    'MZT':'Sinaloa','CUL':'Sinaloa','LMM':'Sinaloa',
    'HMO':'Sonora','CEN':'Sonora','GYM':'Sonora',
    'VSA':'Tabasco',
    'TAM':'Tamaulipas','REX':'Tamaulipas','MAM':'Tamaulipas','VIC':'Tamaulipas',
    'VER':'Veracruz','MIE':'Veracruz','XAL':'Veracruz',
    'MID':'Yucatán',
    'ZCL':'Zacatecas',
  };
  const _ALL_32 = [
    'Aguascalientes','Baja California','Baja California Sur','Campeche',
    'Chiapas','Chihuahua','Ciudad de México','Coahuila','Colima','Durango',
    'Estado de México','Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán',
    'Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro',
    'Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco',
    'Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas'
  ];

  function renderEstadosCoberturaMap() {
    const el = document.getElementById('frec-estados-cobertura');
    if (!el) return;
    const dests = state.destinations; // already loaded national routes
    if (!dests || !dests.length) { el.innerHTML = '<p class="text-muted text-center py-3">Sin datos disponibles.</p>'; return; }

    const stateMap = {};
    dests.forEach(d => {
      const iata  = (d.iata || '').toUpperCase();
      const state_ = _STATE_BY_IATA_MAP[iata];
      if (!state_) return;
      if (!stateMap[state_]) stateMap[state_] = { routes: new Set(), freqs: 0 };
      stateMap[state_].routes.add(iata + ' – ' + (d.city || iata));
      stateMap[state_].freqs += (d.weeklyTotal || 0);
    });

    const covered   = Object.keys(stateMap).sort();
    const uncovered = _ALL_32.filter(s => !stateMap[s]);
    const pct       = Math.round((covered.length / 32) * 100);

    const cardsHtml = covered.map(st => {
      const d = stateMap[st];
      const routePills = [...d.routes].sort().map(r =>
        `<span class="badge me-1 mb-1" style="background:#dbeafe;color:#1d4ed8;font-size:.7rem;">${r}</span>`
      ).join('');
      return `<div class="col-md-6 col-lg-4 col-xl-3">
<div class="card border-0 h-100" style="border-left:4px solid #2563eb!important;box-shadow:0 1px 6px rgba(0,0,0,.07);">
  <div class="card-body py-2 px-3">
    <div class="d-flex justify-content-between align-items-center mb-1">
      <span class="fw-bold" style="font-size:.85rem;">${st}</span>
      <span class="badge rounded-pill bg-primary">${d.routes.size} ruta${d.routes.size!==1?'s':''}</span>
    </div>
    <div class="text-muted mb-1" style="font-size:.72rem;">${d.freqs.toLocaleString('en-US')} frecuencias</div>
    <div class="d-flex flex-wrap">${routePills}</div>
  </div>
</div></div>`;
    }).join('');

    const uncovPills = uncovered.map(s =>
      `<span class="badge me-1 mb-1" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;font-size:.75rem;">${s}</span>`
    ).join('');

    el.innerHTML = `
<div class="mb-3 p-3 rounded-3" style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);color:#fff;">
  <div class="d-flex align-items-center gap-3 flex-wrap">
    <div>
      <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.8px;opacity:.8;">ESTADOS CON VUELOS</div>
      <div style="font-size:2.2rem;font-weight:900;line-height:1;">${covered.length}<span style="font-size:1rem;font-weight:400;opacity:.7;margin-left:4px">/ 32</span></div>
    </div>
    <div class="flex-grow-1" style="min-width:160px;">
      <div class="d-flex justify-content-between mb-1" style="font-size:.73rem;opacity:.85;">
        <span>${pct}% cobertura nacional</span><span>${uncovered.length} sin vuelos</span>
      </div>
      <div style="background:rgba(255,255,255,.25);border-radius:6px;height:9px;">
        <div style="background:#fff;width:${pct}%;height:100%;border-radius:6px;"></div>
      </div>
    </div>
  </div>
</div>
<div class="row g-2 mb-3">${cardsHtml}</div>
${uncovered.length ? `<div class="p-3 rounded-3" style="background:#f8fafc;border:1px solid #e2e8f0;">
  <div class="fw-semibold text-muted mb-2" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;">
    <i class="fas fa-map-marker-alt me-1 text-danger opacity-50"></i>Estados sin vuelos esta semana (${uncovered.length})
  </div>
  <div class="d-flex flex-wrap">${uncovPills}</div>
</div>` : `<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i>¡Cobertura total — vuelos a los 32 estados!</div>`}`;
  }

  function buildInsight(icon, htmlContent){
    const div = document.createElement('div');
    div.className = 'frecuencias-insight-card';
    div.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        background: #f8f9fa;
        border-radius: 8px;
        padding: 10px 16px;
        margin-bottom: 8px;
        border-left: 4px solid #0d6efd;
    `;
    div.innerHTML = `<i class="fas ${icon} text-primary" aria-hidden="true"></i><span style="font-weight: 500; font-size: 0.9rem; color: #495057; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">${htmlContent}</span>`;
    return div;

  }

  function renderTable(){
    if (!dom.tableBody) return;
    dom.tableBody.innerHTML = '';
    const dataset = state.filtered;
    if (!dataset.length) {
      dom.tableCount.textContent = '0 destinos listados';
      dom.tableEmpty?.classList.remove('d-none');
      return;
    }
    dom.tableEmpty?.classList.add('d-none');
    dom.tableCount.textContent = `${dataset.length} destinos listados`;

    dataset.forEach((dest, destIndex) => {
      const base = (dest.viewAirlines?.length ? dest.viewAirlines : dest.airlines) || [];
      const airlines = base.length ? base : [{ name: 'Sin datos', daily: Array(DAY_CODES.length).fill(0), weeklyTotal: 0 }];
      airlines.forEach((airline, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.destinationRow = dest.iata;
        
        // Configuración de aerolínea (logo y color) - Prioridad a DB
        const legacyConfig = AIRLINE_CONFIG[airline.slug] || AIRLINE_CONFIG['default'];
        const config = {
            logo: airline.logo || legacyConfig.logo,
            color: airline.color || legacyConfig.color,
            text: airline.color ? '#ffffff' : legacyConfig.text
        };
        
        // Estilo de fila según aerolínea (fondo completo)
        tr.style.backgroundColor = config.color;
        tr.style.color = config.text;
        // Fix para Bootstrap: asegurar que el fondo se vea
        tr.style.setProperty('--bs-table-bg', 'transparent');
        tr.style.setProperty('--bs-table-accent-bg', 'transparent');

        tr.addEventListener('click', () => {
          focusDestination(dest.iata);
          if (dest.coords && state.map) {
            state.map.flyTo([dest.coords.lat, dest.coords.lng], Math.max(state.map.getZoom(), 6), { duration: 0.6 });
          }
        });

        if (idx === 0) {
          const tdId = document.createElement('td');
          tdId.rowSpan = airlines.length;
          tdId.style.backgroundColor = '#ffffff';
          tdId.style.color = '#212529';
          tdId.textContent = destIndex + 1;
          tr.appendChild(tdId);

          const tdDest = document.createElement('td');
          tdDest.rowSpan = airlines.length;
          // Mantener la celda de destino legible (fondo blanco)
          tdDest.style.backgroundColor = '#ffffff';
          tdDest.style.color = '#212529';
          
          const total = dest.viewWeeklyTotal ?? dest.weeklyTotal;
          
          // Eliminado el código IATA, solo ciudad y estado
          tdDest.innerHTML = `
            <div class="frecuencias-dest-info">
                <strong>${dest.city}</strong>
                <span>${dest.state}</span>
                <div class="badge bg-light text-dark border mt-1" style="font-weight: normal;">${total} frec/sem</div>
            </div>`;
          tr.appendChild(tdDest);
        }

        const tdAirline = document.createElement('td');
        // Asegurar color en celdas individuales por si Bootstrap lo sobreescribe
        // Fondo blanco para que el logo se vea limpio
        tdAirline.style.backgroundColor = '#ffffff';
        tdAirline.style.color = config.color;
        // Borde izquierdo grueso con el color de la aerolínea para identificarla visualmente
        tdAirline.style.borderLeft = `12px solid ${config.color}`;
        
        if (config.logo) {
            let logoStyle = '';
            if (['mexicana', 'volaris', 'aeromexico'].includes(airline.slug)) {
                logoStyle = 'style="height: 50px; max-width: 140px;"';
            }
            // Clase específica para personalizar tamaño por aerolínea
            tdAirline.innerHTML = `<img src="images/airlines/${config.logo}" alt="${airline.name}" title="${airline.name}" class="frecuencias-airline-logo airline-${airline.slug}" ${logoStyle}>`;
        } else {
            tdAirline.textContent = airline.name;
        }
        tr.appendChild(tdAirline);

        DAY_CODES.forEach((code, dayIdx) => {
          const tdDay = document.createElement('td');
          const count = airline.daily?.[dayIdx] ?? 0;
          const detail = airline.dailyDetails?.[dayIdx];
          
          // Default: Show Count
          tdDay.textContent = count > 0 ? count : '-';
          
          tdDay.style.backgroundColor = config.color;
          tdDay.style.color = '#ffffff';
          
          // Interaction Logic
          if (detail && count > 0) {
              tdDay.style.cursor = 'pointer';
              tdDay.title = 'click para ver horarios y números de vuelo';
              // Add visual hint (small dotted underline)
              tdDay.style.textDecoration = 'underline dotted rgba(255,255,255,0.7)';
              
              tdDay.addEventListener('click', (e) => {
                  e.stopPropagation(); // Prevent row click (map zoom)
                  toggleFlightDetailsInCell(tdDay, count, detail);
              });
          }

          tr.appendChild(tdDay);
        });
        const tdTotal = document.createElement('td');
        tdTotal.textContent = intlNumber.format(airline.weeklyTotal);
        tdTotal.style.backgroundColor = config.color;
        tdTotal.style.color = '#ffffff';
        tr.appendChild(tdTotal);
        dom.tableBody.appendChild(tr);
      });
    });
  }

  function toggleFlightDetailsInCell(cell, count, detailHtml) {
      if (cell.dataset.view === 'detail') {
          // Revert to count view
          cell.textContent = count;
          cell.dataset.view = 'count';
          cell.style.fontSize = '';
          cell.style.whiteSpace = '';
          cell.style.padding = '';
      } else {
          // Switch to detail view
          // detailHtml is raw string like "VB102 14:00<br>VB405 19:30"
          const flightsRaw = detailHtml.split('<br>');
          
          // Smart Deduplication & Parsing
          const uniqueFlights = new Map();

          flightsRaw.forEach(f => {
              const raw = f.trim();
              if (!raw) return;

              const parts = raw.split(' ');
              let flightNum = '';
              let type = '';
              let time = '';
              let isLegacy = false;

              // Detect new format tags
              const arrivalIdx = parts.findIndex(p => p.includes('(Lleg)'));
              const departureIdx = parts.findIndex(p => p.includes('(Sal)'));

              if (arrivalIdx !== -1) {
                  type = 'Arr';
                  flightNum = parts.slice(0, arrivalIdx).join(' '); 
                  time = parts.slice(arrivalIdx + 1).join(' '); 
              } else if (departureIdx !== -1) {
                  type = 'Dep';
                  flightNum = parts.slice(0, departureIdx).join(' ');
                  time = parts.slice(departureIdx + 1).join(' ');
              } else {
                  // Legacy parsing attempt: "XN 1204 21:55 (Dep)" or "VB102 14:00"
                  isLegacy = true;
                  // Heuristic: Last part is usually time (maybe with (Dep))
                  // flight is everything before.
                  // Or: Flight is First part(s), Time is Last part(s).
                  // Clean approach: Text matching.
                  time = parts[parts.length - 1]; // "21:55" or "(Dep)"
                  if (time.includes('(') && parts.length > 2) {
                       // "21:55 (Dep)" -> time is prev
                       time = parts[parts.length - 2];
                  }
                  // Clean time
                  flightNum = raw.replace(time, '').replace('(Dep)', '').replace('(Arr)', '').trim();
              }

              // Normalize for key
              const timeClean = time.replace(/\(Dep\)|\(Arr\)/gi, '').trim();
              const flightClean = flightNum.replace(/\s+/g, '');
              const key = `${flightClean}-${timeClean}`;

              const entry = {
                  flightNum: flightClean, // Use normalized for display if legacy, or nice parts if new
                  rawFlightNum: flightNum,
                  time: timeClean,
                  type: type || (raw.includes('(Dep)') || raw.includes('Sal') ? 'Dep' : (raw.includes('(Arr)') || raw.includes('Lleg') ? 'Arr' : '')), 
                  isLegacy
              };

              // Prefer Non-Legacy entries
              if (uniqueFlights.has(key)) {
                  if (!entry.isLegacy && uniqueFlights.get(key).isLegacy) {
                      uniqueFlights.set(key, entry);
                  }
              } else {
                  uniqueFlights.set(key, entry);
              }
          });

          const sortedFlights = Array.from(uniqueFlights.values()).sort((a,b) => a.time.localeCompare(b.time));
          
          let html = '<div class="d-flex flex-column gap-1 text-start" style="min-width: 120px;">';
          sortedFlights.forEach(item => {
             const isArr = item.type === 'Arr';
             const iconClass = isArr ? 'fa-plane-arrival' : 'fa-plane-departure';
             // Using bg-primary (Blue) for Arr, bg-success (Green) for Dep to match panels
             const badgeClass = isArr ? 'bg-primary' : 'bg-success';
             
             const iconHtml = `<span class="badge ${badgeClass} me-2" style="font-size: 0.75rem; padding: 0.3em 0.4em;"><i class="fas ${iconClass} text-white"></i></span>`;
             
             html += `
                <div class="px-2 py-1 rounded d-flex justify-content-between align-items-center bg-white bg-opacity-50 mb-1" style="font-size: 0.85rem; color: #212529;">
                    <div class="d-flex align-items-center">
                        ${iconHtml}
                        <span class="fw-bold me-1">${item.rawFlightNum}</span>
                    </div>
                    <span class="font-monospace fw-bold small">${item.time}</span>
                </div>
             `;
          });
          html += '</div>';

          cell.innerHTML = html;
          cell.dataset.view = 'detail';
          // Adjust cell for better content fit
          cell.style.fontSize = '0.75rem';
          cell.style.whiteSpace = 'normal';
          cell.style.padding = '4px 6px';
      }
  }

  function renderDestinationDetails(dest) {
    if (!dom.detailsTitle || !dom.detailsBody) return;
    
    // Clear previous details to avoid stacking
    dom.detailsBody.innerHTML = '';

    const projected = projectDestination(dest);
    if (!projected) {
        dom.detailsTitle.textContent = `${dest.city} (${dest.iata})`;
        dom.detailsBody.innerHTML = '<div class="p-3 text-muted">No hay vuelos con los filtros actuales.</div>';
        state.currentDetailDest = null;
        return;
    }
    // Store for Copy
    state.currentDetailDest = projected;
    
    // --- DESTINATION HERO IMAGE LOGIC ---
    let heroImage = DESTINATION_IMAGES[dest.iata];
    
    // Correction for City Name (Accents)
    const displayCity = CITY_DISPLAY_NAMES[dest.iata] || dest.city;

    // Simple fallback logic if not in map but file exists (optimistic)
    // Or use a generic placeholder
    if (!heroImage) {
        // Fallback to a placeholder service or a generic local image if available
        // For now, use a nice gradient pattern if no image
        heroImage = null; 
    }

    // Custom Header with Image
    const heroContainer = document.createElement('div');
    heroContainer.style.position = 'relative';
    heroContainer.style.height = '280px';
    heroContainer.style.background = '#0a1f44'; // Fallback color
    heroContainer.style.overflow = 'hidden';
    heroContainer.style.borderBottom = '1px solid rgba(0,0,0,0.1)';

    if (heroImage) {
        heroContainer.innerHTML = `
            <div style="
                position: absolute;
                inset: 0;
                background-image: url('${heroImage}');
                background-size: cover;
                background-position: center;
                filter: brightness(0.65);
            "></div>
            <div style="
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                padding: 1rem;
                background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
                color: white;
            ">
                <h4 class="mb-0 fw-bold text-white text-shadow" style="font-size: 1.8rem;">${displayCity}</h4>
                <div class="d-flex align-items-center gap-2 mt-1">
                    <span class="badge bg-white text-dark shadow-sm" style="font-size: 0.9em; border-radius: 6px;">${dest.iata}</span>
                    <span class="text-white text-shadow fw-light" style="font-size: 1rem; opacity: 0.9;">${dest.state}</span>
                </div>
            </div>
        `;
        // Hide default title since we have a hero
         dom.detailsTitle.style.display = 'none';
        // Adjust copy button position or style?
        // Actually, the copy button assumes the default title is visible.
        // Let's keep the default title hidden for this view, or update the textContent to empty.
        // Better: We insert this hero AT THE TOP of the details BODY, and keep the Header for controls.
        
        // Wait, replacing the title logic is cleaner visually.
        // Resetting title visibility logic:
        dom.detailsTitle.parentElement.style.display = 'none'; // Hide the whole title/copy row? No, we need the Close button.
        
        // Let's just update the content inside dom.detailsBody to include this hero at the top.
        // And keep the standard header for "Detalles" or just reuse it.
    } else {
        // No image? Standard header
         dom.detailsTitle.parentElement.style.display = 'flex';
    }

    // Refined approach:
    // If image exists:
    // 1. Insert Hero Image at top of detailsBody.
    // 2. Set detailsTitle to just "Detalles del vuelo" or keep hidden to avoid redundancy.
    
    if (heroImage) {
        dom.detailsTitle.textContent = `${dest.city} (${dest.iata})`; // Keep for context references
        // We will stick the hero image INSIDE the body, at the top.
        // And we can make it look like a seamless header.
        heroContainer.className = 'mb-3 rounded-top'; // Add margin
        
        // Use inline style for image to support the variable
        heroContainer.innerHTML = `
            <div style="
                position: absolute;
                inset: 0;
                background-image: url('${heroImage}');
                background-size: cover;
                background-position: center;
            "></div>
            <div style="
                position: absolute;
                inset: 0;
                background: linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.6));
            "></div>
            <div style="
                position: absolute;
                bottom: 12px;
                left: 16px;
                color: white;
                text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            ">
                <h3 class="m-0 fw-bold">${dest.city}</h3>
                <span class="badge bg-white text-dark border-0 mt-1">${dest.iata}</span>
                <span class="small ms-2 opacity-75 text-white">${dest.state}</span>
            </div>
        `;
        dom.detailsBody.appendChild(heroContainer);
    } else {
        dom.detailsTitle.textContent = `${dest.city} (${dest.iata})`;
    }
    
    // --- END HERO IMAGE LOGIC ---

    const abbrs = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
    
    // Calcular fechas específicas si existen
    const dateLabels = abbrs.map((d, i) => {
        if (state.raw?.validFrom) {
            const date = new Date(state.raw.validFrom + 'T00:00:00');
            date.setDate(date.getDate() + i);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = String(date.getFullYear()).slice(-2);
            return `${d}<br><span style="font-size: 0.65rem; font-weight: normal; opacity: 0.8;">${day}/${month}/${year}</span>`;
        }
        return d;
    });

    projected.viewAirlines.forEach(air => {
        const legacyConfig = AIRLINE_CONFIG[air.slug] || AIRLINE_CONFIG['default'];
        const config = {
            logo: air.logo || legacyConfig.logo,
            color: air.color || legacyConfig.color,
            text: air.color ? '#ffffff' : legacyConfig.text
        };
        
        let logoStyle = 'height: 32px; width: auto;';
        if (['mexicana', 'volaris', 'aeromexico'].includes(air.slug)) {
            logoStyle = 'height: 65px; width: auto;';
        }

        const headerContent = config.logo 
            ? `<img src="images/airlines/${config.logo}" alt="${air.name}" style="${logoStyle}" title="${air.name}">`
            : `<strong style="color: #212529; font-size: 1.1rem;">${air.name}</strong>`;
        
        const card = document.createElement('div');
        card.className = 'list-group-item p-3';

        // Header Section
        const header = document.createElement('div');
        header.className = 'd-flex align-items-center justify-content-between mb-3';
        header.innerHTML = `
            <div>${headerContent}</div>
            <div class="text-end">
                <div class="badge bg-primary rounded-pill px-3 py-2" style="font-size: 0.9rem; font-weight: 500;">
                    ${air.weeklyTotal} <span style="opacity: 0.8; font-weight: 400;">frecuencias/semana</span>
                </div>
            </div>`;
        card.appendChild(header);

        // Days Grid
        const grid = document.createElement('div');
        // Usar overflow-auto para permitir scroll horizontal si hay muchos datos
        grid.className = 'd-flex gap-2 pb-2 overflow-auto'; 
        // Estilo par scrollbar más sutil si se desea
        // grid.style.scrollbarWidth = 'thin';

        DAY_CODES.forEach((code, idx) => {
            const count = air.daily[idx];
            const detail = air.dailyDetails?.[idx]; // Access by index, not code key
            const isActive = count > 0;
            
            const cell = document.createElement('div');
            // Base styles
            cell.className = `text-center rounded p-2 flex-shrink-0 ${isActive ? 'bg-primary-subtle border border-primary-subtle shadow-sm' : 'bg-light border border-light'}`;
            // Permitir que se distribuyan equitativamente
            cell.style.flex = '1 1 0px';
            cell.style.minWidth = '0';
            cell.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            if (isActive) {
                cell.onmouseenter = () => {
                    if (contentDiv.dataset.view !== 'detail') cell.style.transform = 'translateY(-2px)';
                };
                cell.onmouseleave = () => cell.style.transform = 'none';
            }
            
            // Date Label
            const dateDiv = document.createElement('div');
            dateDiv.className = `small ${isActive ? 'text-primary fw-bold' : 'text-muted opacity-50'}`;
            // Aumentar un poco el tamaño de letra de la fecha
            dateDiv.style.fontSize = '0.8rem'; 
            dateDiv.style.marginBottom = '6px';
            dateDiv.style.lineHeight = '1.2';
            dateDiv.innerHTML = dateLabels[idx];
            cell.appendChild(dateDiv);

            // Value/Content Div
            const contentDiv = document.createElement('div');
            contentDiv.className = isActive ? 'text-primary fw-bold' : 'text-muted opacity-25';
            contentDiv.style.fontSize = '1.5rem'; // Large number by default
            contentDiv.style.lineHeight = '1.2';
            contentDiv.textContent = isActive ? count : '0';
            cell.appendChild(contentDiv);

            if (isActive && detail) {
                cell.style.cursor = 'pointer';
                cell.title = 'Ver vuelos y horarios';
                
                // Toggle Logic handled inline here for closure access
                cell.onclick = (e) => {
                    e.stopPropagation();
                    const isExpanded = contentDiv.dataset.view === 'detail';
                    
                    if (isExpanded) {
                        // Collapse
                        contentDiv.textContent = count;
                        contentDiv.dataset.view = 'count';
                        contentDiv.style.fontSize = '1.5rem';
                        contentDiv.style.textAlign = 'center';
                        cell.style.flex = '1 1 0px';
                        cell.style.minWidth = '0';
                    } else {
                        // Expand
                        cell.style.flex = '4 1 0px';
                        cell.style.minWidth = '0';

                        const flightsRaw = detail.split('<br>');
                        // Deduplicate: trim spaces and use Set
                        const flights = [...new Set(flightsRaw.map(f => f.trim()))].filter(Boolean);

                        let listHtml = '<div class="d-flex flex-column gap-2 text-start mt-2">';
                        flights.forEach(f => {
                            // Improved parsing
                            const raw = f.trim();
                            if (!raw) return;
                            const parts = raw.split(' ');
                            
                            let flightNum = '';
                            let type = '';
                            let time = '';

                            const arrivalIdx = parts.findIndex(p => p.includes('(Lleg)') || p.includes('Lleg'));
                            const departureIdx = parts.findIndex(p => p.includes('(Sal)') || p.includes('Sal'));

                            if (arrivalIdx !== -1) {
                                type = 'Arr';
                                flightNum = parts.slice(0, arrivalIdx).join(' ');
                                time = parts.slice(arrivalIdx + 1).join(' ');
                            } else if (departureIdx !== -1) {
                                type = 'Dep';
                                flightNum = parts.slice(0, departureIdx).join(' ');
                                time = parts.slice(departureIdx + 1).join(' ');
                            } else {
                                // Fallback
                                const possibleTime = parts[parts.length - 1];
                                if (possibleTime.includes(':')) {
                                    time = possibleTime;
                                    flightNum = parts.slice(0, parts.length - 1).join(' ');
                                } else {
                                    flightNum = raw; // ?
                                }
                            }
                            
                            // Clean up
                            flightNum = flightNum.replace(/\(Dep\)|\(Arr\)/gi, '').trim();
                            time = time.replace(/\(Dep\)|\(Arr\)/gi, '').trim();

                            // New Logic: More representative colors (Blue for Arrival, Green for Departure)
                            const isArr = type === 'Arr';
                            const iconClass = isArr ? 'fa-plane-arrival' : 'fa-plane-departure';
                            const badgeClass = isArr ? 'bg-primary' : 'bg-success';
                            
                            // Badge más grande para el icono
                            const iconHtml = `<div class="rounded-circle ${badgeClass} d-flex align-items-center justify-content-center flex-shrink-0 shadow-sm" style="width: 32px; height: 32px;"><i class="fas ${iconClass} text-white" style="font-size: 0.9rem;"></i></div>`;

                            listHtml += `
                                <div class="p-2 rounded bg-white border shadow-sm d-flex align-items-center justify-content-between mb-1" style="font-size: 0.95rem; border-color: #dee2e6 !important;">
                                    <div class="d-flex align-items-center gap-2">
                                        ${iconHtml}
                                        <span class="fw-bold text-dark text-nowrap" style="font-size: 1rem;">${flightNum}</span>
                                    </div>
                                    <span class="font-monospace fw-bold text-secondary text-nowrap ms-2" style="font-size: 1.1rem;">${time}</span>
                                </div>`;
                        });
                        listHtml += '</div>';
                        
                        contentDiv.innerHTML = listHtml;
                        contentDiv.dataset.view = 'detail';
                        contentDiv.style.fontSize = '1rem'; // Reset font size for container text
                        contentDiv.style.textAlign = 'left';
                    }
                };
            }

            grid.appendChild(cell);
        });

        card.appendChild(grid);
        dom.detailsBody.appendChild(card);
    });

    const notes = document.createElement('div');
    notes.className = 'p-3 mt-2 bg-light border-top small text-muted';
    notes.innerHTML = `
        <div class="fw-bold mb-1">Notas:</div>
        <ul class="mb-0 ps-3" style="list-style-type: disc;">
            <li>Esta programación esta sujeta a cambios con base en las necesidades de las aerolíneas.</li>
        </ul>`;
    dom.detailsBody.appendChild(notes);
  }

  function renderMap(){
    if (!state.map || !state.markerLayer) return;
    state.markerLayer.clearLayers();
    
    // Agregar marcador fijo del AIFA
    const aifaIcon = L.divIcon({
        className: 'frecuencia-aifa-marker',
        html: '<div class="aifa-pin"><img src="images/logo_aifa.jpg" alt="AIFA" class="aifa-logo-pin"></div>',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    // AIFA zIndex 3000 para estar siempre arriba del avión (2000)
    L.marker([AIFA_COORDS.lat, AIFA_COORDS.lng], { icon: aifaIcon, zIndexOffset: 3000 }).addTo(state.markerLayer)
     .bindTooltip('AIFA (NLU)', { permanent: false, direction: 'top' });

    const dataset = state.filtered;
    if (!dataset.length) {
      dom.mapEmpty?.classList.remove('d-none');
      return;
    }
    dom.mapEmpty?.classList.add('d-none');
    
    // Usar todos los destinos para calcular los límites del mapa, 
    // así la vista se mantiene en "Enfocar país" incluso al filtrar.
    const bounds = [[AIFA_COORDS.lat, AIFA_COORDS.lng]]; 
    state.destinations.forEach(d => {
        if (d.coords) bounds.push([d.coords.lat, d.coords.lng]);
    });

    let idx = 0;
    dataset.forEach((dest, destIndex) => {
      if (!dest.coords) return;
      const total = dest.viewWeeklyTotal ?? dest.weeklyTotal;
      const icon = buildMarkerIcon(total, dest.iata, dest.state);
      const marker = L.marker([dest.coords.lat, dest.coords.lng], { icon }).addTo(state.markerLayer);
      marker.bindTooltip(`${dest.city} (${dest.iata})\n${intlNumber.format(total)} frecuencias/semana`);
      marker.on('click', () => filterByDestination(dest.iata));
    });

    if (bounds.length) {
      const leafletBounds = L.latLngBounds(bounds);
      // Ajuste de padding para asegurar que se vean todos los destinos
      state.map.fitBounds(leafletBounds, { padding: [50, 50], maxZoom: 8 });
    }
    animatePlanes(dataset);
  }

  function animatePlanes(dataset){
    if (!state.map || !state.planeLayer) return;
    state.planeLayer.clearLayers();
    if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
    if (state.animationTimeoutId) clearTimeout(state.animationTimeoutId);

    // Filtrar destinos válidos
    const validDestinations = dataset.filter(d => d.coords && (d.viewWeeklyTotal ?? d.weeklyTotal) > 0);
    if (!validDestinations.length) return;

    let currentIndex = 0;
    let currentPlane = null;
    let currentLine = null;
    let startTime = 0;
    const duration = 5000; // 5 segundos por vuelo

    function startNextFlight(){
        if (currentIndex >= validDestinations.length) {
            currentIndex = 0; // Loop infinito
        }
        const dest = validDestinations[currentIndex];
        const start = L.latLng(AIFA_COORDS.lat, AIFA_COORDS.lng);
        const end = L.latLng(dest.coords.lat, dest.coords.lng);

        const pathPoints = getGeodesicPath(start, end);

        // Dibujar línea (trayectoria)
        if (currentLine) state.planeLayer.removeLayer(currentLine);
        currentLine = L.polyline(pathPoints, {
            color: '#0d6efd',
            weight: 2,
            opacity: 0.4,
            dashArray: '5, 10'
        }).addTo(state.planeLayer);

        // Crear avión con SVG de silueta más realista (apunta hacia ARRIBA por defecto)
        // Icono: Material Design 'flight' modificado o similar
        const planeSvg = `
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:100%;height:100%;display:block;">
             <path d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z" />
        </svg>`;

        const icon = L.divIcon({
            className: 'frecuencia-plane-icon',
            html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#0d6efd;">
                    ${planeSvg}
                   </div>`,
            iconSize: [28, 28], // Un poco más grande para que se aprecie la forma
            iconAnchor: [14, 14]
        });
        
        if (currentPlane) state.planeLayer.removeLayer(currentPlane);
        // Aumentado zIndexOffset a 2000 para asegurar que el avión se vea sobre los marcadores
        currentPlane = L.marker(start, { icon, zIndexOffset: 2000, interactive: false }).addTo(state.planeLayer);

        // Estado para suavizado de rotación
        let lastAngle = null;

        startTime = performance.now();
        requestAnimationFrame((now) => animate(now, pathPoints, lastAngle));
    }

    function animate(now, pathPoints, prevAngle){
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        const totalSegments = pathPoints.length - 1;
        const segmentFloat = t * totalSegments;
        const segmentIndex = Math.floor(segmentFloat);
        const segmentT = segmentFloat - segmentIndex;

        let lat, lng;

        if (segmentIndex >= totalSegments) {
             const last = pathPoints[totalSegments];
             lat = last.lat;
             lng = last.lng;
        } else {
             const p1 = pathPoints[segmentIndex];
             const p2 = pathPoints[segmentIndex + 1];
             lat = p1.lat + (p2.lat - p1.lat) * segmentT;
             lng = p1.lng + (p2.lng - p1.lng) * segmentT;
        }
        
        currentPlane.setLatLng([lat, lng]);

        // Rotación Visual usando píxeles de pantalla
        let currentVisualAngle = prevAngle; // Mantener ángulo anterior por defecto

        if (segmentIndex < totalSegments) {
            const p1 = pathPoints[segmentIndex];
            const p2 = pathPoints[segmentIndex + 1];
            
            let targetAngle = null;

            // FIXED: Stable rotation using Geocoordinates instead of Screen Pixels
            // This prevents "wobbling" caused by pixel quantization or projection noise on small segments
            const dLat = p2.lat - p1.lat;
            const dLng = p2.lng - p1.lng;
            
            // On screen: y is inverted relative to lat.
            // Math.atan2(y, x). y = -dLat, x = dLng
            let theta = Math.atan2(-dLat, dLng) * 180 / Math.PI;
            
            // Adjust for icon orientation (Icon points UP at 0deg)
            // atan2(0, 1) = 0 (East). We want 90deg.
            // atan2(-1, 0) = -90 (North). We want 0deg.
            targetAngle = theta + 90;

            if (targetAngle !== null) {
                if (currentVisualAngle === null || currentVisualAngle === undefined) {
                    currentVisualAngle = targetAngle;
                } else {
                    // Interpolación suave (Lerp) para evitar temblores
                    let diff = targetAngle - currentVisualAngle;
                    while (diff < -180) diff += 360;
                    while (diff > 180) diff -= 360;
                    // Factor de suavizado (0.1)
                    currentVisualAngle += diff * 0.1;
                }
            }
        }
        
        const iconContainer = currentPlane.getElement()?.querySelector('div');
        const svgEl = iconContainer?.querySelector('svg');
        
        if (svgEl && currentVisualAngle !== null) {
            svgEl.style.transform = `rotate(${currentVisualAngle}deg)`;
        }

        if (t < 1) {
            state.animationFrameId = requestAnimationFrame((nextNow) => animate(nextNow, pathPoints, currentVisualAngle));
        } else {
            state.animationTimeoutId = setTimeout(() => {
                if (currentPlane) state.planeLayer.removeLayer(currentPlane);
                if (currentLine) state.planeLayer.removeLayer(currentLine);
                currentIndex++;
                startNextFlight();
            }, 500);
        }
    }

    // Helper for Great Circle Approximation
    function getGeodesicPath(start, end, numPoints = 100) {
        const lat1 = start.lat * Math.PI / 180;
        const lon1 = start.lng * Math.PI / 180;
        const lat2 = end.lat * Math.PI / 180;
        const lon2 = end.lng * Math.PI / 180;
        
        const d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon2 - lon1) / 2), 2)));
        
        const path = [];
        for (let i = 0; i <= numPoints; i++) {
            const f = i / numPoints;
            const A = Math.sin((1 - f) * d) / Math.sin(d);
            const B = Math.sin(f * d) / Math.sin(d);
            const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
            const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
            const z = A * Math.sin(lat1) + B * Math.sin(lat2);
            const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
            const lon = Math.atan2(y, x);
            path.push(L.latLng(lat * 180 / Math.PI, lon * 180 / Math.PI));
        }
        return path;
    }

    startNextFlight();
  }

  const MARKER_PALETTE = ['#D32F2F', '#C2185B', '#7B1FA2', '#512DA8', '#303F9F', '#1976D2', '#0288D1', '#0097A7', '#00796B', '#388E3C', '#689F38', '#AFB42B', '#FBC02D', '#FFA000', '#F57C00', '#E64A19', '#5D4037', '#616161', '#455A64']; // Full palette restored for stateColorMap function usage to work but logic will always return 0 if we override getMarkerColor

  // Override to return blue (Air Force Blue / Bootstrap Primary)
  function getMarkerColor(stateName) {
      return '#0d6efd';
  }

  function buildMarkerIcon(total, label, stateName){
    const color = getMarkerColor(stateName);
    
    return L.divIcon({
      className: 'frecuencia-pin-marker',
      // Text color matches pin color (Blue) because CSS adds a white background bubble
      html: `<div class="pin-content"><i class="fas fa-location-dot" style="color: ${color};"></i><span style="color: ${color} !important;">${total}</span></div>`,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      tooltipAnchor: [0, -35]
    });
  }

  function filterByDestination(iata){
    state.filters.destination = iata;
    if (dom.filters.destination) dom.filters.destination.value = iata;
    applyFilters();
  }

  function focusDestination(iata){
    const row = dom.tableBody?.querySelector(`[data-destination-row="${iata}"]`);
    if (!row) return;
    dom.tableBody.querySelectorAll('.frecuencias-row-highlight').forEach(r => r.classList.remove('frecuencias-row-highlight'));
    row.classList.add('frecuencias-row-highlight');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Also filter the map to show only this destination's plane
    // We don't want to change the global filter state (which would hide the table rows),
    // just the map visualization.
    const dest = state.destinations.find(d => d.iata === iata);
    if (dest) {
        animatePlanes([dest]);
    }
  }

  function fitMapToData(){
    if (!state.map || !state.destinations.length) return;
    
    // Check if map container has size. If not, fitBounds won't work correctly.
    const container = state.map.getContainer();
    if (container.clientWidth === 0 || container.clientHeight === 0) return;

    // Calcular bounds basados en TODOS los destinos, no solo los visibles
    const bounds = [[AIFA_COORDS.lat, AIFA_COORDS.lng]];
    state.destinations.forEach(d => {
        if (d.coords) bounds.push([d.coords.lat, d.coords.lng]);
    });
    const leafletBounds = L.latLngBounds(bounds);
    state.map.fitBounds(leafletBounds, { padding: [30, 30], maxZoom: 8 });
  }

  function updateActiveFiltersText(){
    if (!dom.activeFilters) return;
    const active = [];
    if (state.filters.airline !== 'all') {
      const found = state.uniqueAirlines.find(a => a.slug === state.filters.airline);
      active.push(`Aerolínea: ${found?.name || state.filters.airline}`);
    }
    if (state.filters.destination !== 'all') active.push(`Destino: ${state.filters.destination}`);
    if (state.filters.day !== 'all') active.push(`Día: ${DAY_LABELS[state.filters.day]}`);
    if (state.filters.search) active.push(`Búsqueda: "${state.filters.search}"`);
    dom.activeFilters.textContent = active.length ? `Filtros activos ? ${active.join(' · ')}` : 'Mostrando todos los destinos.';
  }

  function normalizeDestinations(list){
    const CARGO_SLUGS = [ 'aerotransporte-de-carga-union', 'cargolux', 'estafeta', 'masair', 'air-canada', 'air-france', 'cathay-pacific', 'lufthansa', 'awesome-cargo', 'cargojet', 'lan-cargo', 'lan-cargo-sa', 'national-airlines', 'national-airlines-cargo', 'sky-lease', 'saudi-arabian', 'saudi-arabian-airlines-cargo', 'latam-cargo', 'lynden-air-cargo', 'dhl', 'sf-airlines', 'suparna', 'china-cargo', 'china-southern-cargo', 'abx-air', 'fedex', 'ups', 'kalitta-air', 'aero-union', 'aerotransporte-de-carga-union-sa-de-cv', 'emirates-skycargo', 'qatar-airways', 'qatar-airways-cargo', 'qatar-cargo', 'ameriflight', 'uniworld-air-cargo', 'air-china', 'amerijet-international', 'dhl-guatemala', 'ethiopian-airlines', 'turkish-airlines', 'united-parcel-service', 'china-southerrn', 'china-southern', 'china-airlines', 'suparna-airlines', 'saudi-arabian-airlines', 'abx-air', 'tap-portugal', 'tap-air-portugal',
      // adicionales que no deben aparecer en pasajeros nacionales
      'atlas-air', 'silk-way-west-airlines', 'silk-way', 'tsm-airline', 'tsm', 'unk', 'unknown', 'sin-aerolinea', 'galistair-trading-limited', 'omni-air', 'omni-air-international', 'sun-country-airlines', 'world-2-fly', 'world-to-fly', 'ifl-group' ];

    return list
      .filter(dest => dest.iata !== 'NLU' && dest.iata !== 'GUA')
      .map(dest => {
      const airlines = (dest.airlines || [])
        .map(air => normalizeAirline(air))
        .filter(Boolean)
        .filter(air => !CARGO_SLUGS.includes(air.slug));
      
      // Do not include destinations that ended up with no airlines (because all were cargo)
      if (airlines.length === 0 && dest.airlines && dest.airlines.length > 0) {
          return null;
      }

      const weeklyTotal = airlines.reduce((sum, air) => sum + air.weeklyTotal, 0);
      const dailyTotals = DAY_CODES.map((_, idx) => airlines.reduce((sum, air) => sum + (air.daily[idx] || 0), 0));
      const searchText = `${dest.city || ''} ${dest.state || ''} ${dest.iata || ''} ${airlines.map(a => a.name).join(' ')}`.toLowerCase();
      
      // Use explicit display name if available, otherwise title case the raw city
      const finalCity = CITY_DISPLAY_NAMES[dest.iata] || toTitleCase(dest.city) || 'Sin ciudad';

      return {
        routeId: dest.routeId,
        city: finalCity,
        state: toTitleCase(dest.state) || '',
        iata: dest.iata || '',
        airports: Array.isArray(dest.airports) ? dest.airports : [],
        airlines,
        weeklyTotal,
        dailyTotals,
        coords: AIRPORT_COORDS[dest.iata] || null,
        searchText
      };
    }).filter(Boolean);
  }

  function toTitleCase(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
  }

  function groupByRoute(destinations){
    // Flatten logic assumes specific data shape from JSON/DB.
    // Logic updated to accommodate DB raw entries if needed, but current fetch maps to 'destinations'
    return destinations.map(dest => {
       const groupRows = {
           route_id: dest.iata, // or logic from ord
           iata: dest.iata,
           city: dest.city,
           state: dest.state,
           week_label: dom.weekLabel.textContent, // from global or first item
           airlines: dest.viewAirlines.map(air => ({
               ...air, // Pass through all props including daily & details
               week_label: dom.weekLabel.textContent,
               route_id: dest.iata,
               iata: dest.iata,
               city: dest.city,
               state: dest.state,
               airline: air.name,
               slug: air.slug
           }))
       };
       return groupRows; 
    });
  }

  function normalizeAirline(air){
    const daily = DAY_CODES.map(code => Number(air?.daily?.[code] ?? 0));
    const dailyDetails = DAY_CODES.map(code => air?.dailyDetails?.[code] || ''); // Capture details
    const weeklyTotal = Number(air?.weeklyTotal) || daily.reduce((sum, val) => sum + val, 0);
    return {
      name: air?.name || 'Sin aerolínea',
      slug: slugify(air?.name || 'sin-aerolinea'),
      logo: air?.logo,
      color: air?.color,
      daily,
      dailyDetails, // Store details
      weeklyTotal
    };
  }

  function projectDestination(dest){
    const airlines = state.filters.airline === 'all'
      ? dest.airlines
      : dest.airlines.filter(air => air.slug === state.filters.airline);
    if (!airlines.length && state.filters.airline !== 'all') return null;
    const viewWeekly = airlines.reduce((sum, air) => sum + air.weeklyTotal, 0);
    const viewDaily = DAY_CODES.map((_, idx) => airlines.reduce((sum, air) => sum + (air.daily[idx] || 0), 0));
    return { ...dest, viewAirlines: airlines, viewWeeklyTotal: viewWeekly, viewDailyTotals: viewDaily };
  }

  function collectAirlines(destinations){
    const map = new Map();
    destinations.forEach(dest => {
      dest.airlines.forEach(air => {
        if (!map.has(air.slug)) {
          map.set(air.slug, { 
            name: air.name, 
            total: 0,
            logo: air.logo,
            color: air.color 
          });
        }
        const entry = map.get(air.slug);
        entry.total += (air.weeklyTotal || 0);
      });
    });
    return [...map.entries()]
      .map(([slug, data]) => ({ 
        slug, 
        name: data.name, 
        total: data.total,
        logo: data.logo,
        color: data.color 
      }))
      .sort((a, b) => {
        // Sort by Total Descending, then Alphabetical
        const diff = b.total - a.total;
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'es-MX');
      });
  }

  function populateFilters(){
    // Airline Options -> Logo Grid
    if (dom.filters.airline) {
        dom.filters.airline.style.display = 'none'; // ocultar select original
        
        let logoContainer = pane.querySelector('#frecuencias-airline-logos');
        if (!logoContainer) {
            logoContainer = document.createElement('div');
            logoContainer.id = 'frecuencias-airline-logos';
            logoContainer.className = 'airline-filter-toolbar mb-3'; // New Class
            // Insertar después del label si existe, o reemplazar el select en posición visual
            dom.filters.airline.parentNode.insertBefore(logoContainer, dom.filters.airline.nextSibling);
        }
        logoContainer.innerHTML = '';

        // Botón "Todas"
        const btnAll = document.createElement('button');
        btnAll.className = 'airline-filter-btn active'; // New Class
        btnAll.textContent = 'Todas';
        btnAll.dataset.airline = 'all';
        btnAll.onclick = () => selectAirlineFilter('all', btnAll);
        logoContainer.appendChild(btnAll);

        const sortedAirlines = [...state.uniqueAirlines].sort((a,b) => a.name.localeCompare(b.name));
        sortedAirlines.forEach(air => {
            const legacyConfig = AIRLINE_CONFIG[air.slug] || AIRLINE_CONFIG['default'];
            const config = {
                logo: air.logo || legacyConfig.logo,
                color: air.color || legacyConfig.color
            };

            const btn = document.createElement('button');
            btn.className = 'airline-filter-btn'; // New Class
            btn.dataset.airline = air.slug;
            btn.title = air.name;
            
            if (config.logo) {
                let logoStyle = 'height: 20px; width: auto; object-fit: contain;';
                if (['mexicana', 'volaris', 'aeromexico'].includes(air.slug)) {
                    logoStyle = 'height: 28px; width: auto; object-fit: contain;';
                }
                 btn.innerHTML = `<img src="images/airlines/${config.logo}" alt="${air.name}" style="${logoStyle}">`;
            } else {
                btn.textContent = air.name;
            }

            btn.onclick = () => selectAirlineFilter(air.slug, btn);
            logoContainer.appendChild(btn);
        });
    }

    if (dom.filters.destination) {
      dom.filters.destination.innerHTML = '<option value="all">Todos los destinos</option>';
      [...state.destinations]
        .sort((a, b) => a.city.localeCompare(b.city, 'es-MX'))
        .forEach(dest => {
          const opt = document.createElement('option');
          opt.value = dest.iata;
          opt.textContent = `${dest.city} (${dest.iata})`;
          dom.filters.destination.appendChild(opt);
        });
    }
  }

  function selectAirlineFilter(slug, btnElement) {
      state.filters.airline = slug;
      if (dom.filters.airline) dom.filters.airline.value = slug; // sync select just in case
      
      // Actualizar UI
      const container = pane.querySelector('#frecuencias-airline-logos');
      if (container) {
          const buttons = container.querySelectorAll('.airline-filter-btn');
          buttons.forEach(b => b.classList.remove('active'));

          // Activar el seleccionado
          btnElement.classList.add('active');
      }
      applyFilters();
  }

  function updateMeta(data){
    if (dom.weekLabel) dom.weekLabel.textContent = data?.weekLabel ? data.weekLabel : 'Semana sin etiqueta';
    
    if (dom.weekRange) {
      if (data?.validFrom && data?.validTo) {
        dom.weekRange.textContent = formatDateRangeDetailed(data.validFrom, data.validTo);
      } else {
        dom.weekRange.textContent = 'Vigencia no disponible';
      }
    }
    if (dom.lastUpdated) dom.lastUpdated.textContent = `Generado el ${intlDate.format(new Date())}`;
    
    if (data?.validFrom) {
        updateTableHeaders(data.validFrom);
    }
  }

  function formatDateRangeDetailed(startStr, endStr) {
      // Helper to parse "YYYY-MM-DD" parts
      const parseDateParts = (str) => {
          const d = new Date(str + 'T00:00:00');
          return {
              day: d.getDate().toString().padStart(2, '0'),
              month: d.toLocaleString('es-MX', { month: 'long' }), // e.g., "enero"
              monthShort: d.toLocaleString('es-MX', { month: 'short' }),
              year: d.getFullYear()
          };
      };

      const start = parseDateParts(startStr);
      const end = parseDateParts(endStr);
      
      // Capitalize first letter of month? usually lowercase in Spanish dates mid-sentence.
      // But user example "Ene" was in badge. Text "enero" is preferred for full description.
      
      // Logic for concise range
      if (start.year === end.year) {
          if (start.month === end.month) {
              return `Del ${start.day} al ${end.day} de ${start.month} de ${start.year}`;
          } else {
              return `Del ${start.day} de ${start.month} al ${end.day} de ${end.month} de ${start.year}`;
          }
      } else {
          return `Del ${start.day} de ${start.month} de ${start.year} al ${end.day} de ${end.month} de ${end.year}`;
      }
  }

  function updateTableHeaders(startDateInput) {
      if (!startDateInput) return;

      let startDate;
      if (typeof startDateInput === 'string') {
          startDate = new Date(startDateInput + 'T00:00:00');
      } else if (startDateInput instanceof Date) {
          startDate = new Date(startDateInput);
      } else {
          return;
      }

      if (isNaN(startDate.getTime())) return;

      const headers = dom.tableBody.closest('table').querySelectorAll('thead th');
      
      // Set widths for fixed columns
      if (headers[0]) headers[0].style.width = '8%'; // Id
      if (headers[1]) headers[1].style.width = '15%'; // Destino
      if (headers[2]) headers[2].style.width = '15%'; // Aerolínea
      if (headers[10]) headers[10].style.width = '7%';  // Total

      DAY_CODES.forEach((code, i) => {
          const colIndex = i + 3; // Shift by 1
          if (headers[colIndex]) {
              const current = new Date(startDate);
              current.setDate(current.getDate() + i); // Add days

              // Format
              const day = current.getDate().toString().padStart(2, '0');
              const month = (current.getMonth() + 1).toString().padStart(2, '0');
              const year = current.getFullYear().toString().slice(-2);
              const dateStr = `${day}/${month}/${year}`;

              const label = DAY_LABELS[code];
              headers[colIndex].innerHTML = `<div class="d-flex flex-column align-items-center" style="line-height:1.1;">
                <span>${label}</span>
                <span class="text-muted fw-normal mt-1" style="font-size: 0.75rem;">${dateStr}</span>
              </div>`;
          }
      });
  }

  function formatDate(input){
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return input;
    return intlDate.format(date);
  }

  function showLoading(isLoading){
    if (!dom.loading) return;
    dom.loading.classList.toggle('d-none', !isLoading);
  }

  function showError(message){
    if (!dom.error) return;
    dom.error.textContent = message;
    dom.error.classList.remove('d-none');
  }

  async function fetchJson(url){
    const res = await fetch(`${url}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function ensureLeaflet(){
    if (window.L && document.getElementById('leaflet-css')) return;
    if (window.__leafletLoading) return window.__leafletLoading;
    window.__leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.id = 'leaflet-css';
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve();
      script.onerror = reject;
      document.body.appendChild(script);
    });
    return window.__leafletLoading;
  }

  function initMap(){
    if (!dom.mapContainer || state.map) return;
    state.map = L.map(dom.mapContainer, { attributionControl: false }).setView([23.5, -101.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(state.map);
    state.markerLayer = L.layerGroup().addTo(state.map);
    state.planeLayer = L.layerGroup().addTo(state.map);

    // Watch for visibility changes to fix grey map issues
    const resizeObserver = new ResizeObserver(() => {
        if (state.map) {
            state.map.invalidateSize();
            if (state.destinations && state.destinations.length > 0) {
                 // Use a small timeout to ensure container has layout
                 setTimeout(() => fitMapToData(), 100);
            }
        }
    });
    resizeObserver.observe(dom.mapContainer);
  }


  async function downloadExcel() {
    if (!state.filtered || state.filtered.length === 0) {
      alert('No hay datos para exportar.');
      return;
    }
    
    // Headers
    let headers = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
    if (state.raw && state.raw.validFrom) {
        const start = new Date(state.raw.validFrom + 'T00:00:00');
        headers = headers.map((day, idx) => {
            const d = new Date(start);
            d.setDate(d.getDate() + idx);
            const span = `${d.getDate()}/${d.getMonth()+1}`;
            return `${day} ${span}`;
        });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Frecuencias Nacionales');

    // Define columns
    worksheet.columns = [
        { header: 'Id Ruta', key: 'id', width: 12 },
        { header: 'Destino', key: 'dest', width: 25 },
        { header: 'Aerolínea', key: 'airline', width: 10 }, // MUCH wider to allow logos to scale up
        { header: headers[0], key: 'd1', width: 12 },
        { header: headers[1], key: 'd2', width: 12 },
        { header: headers[2], key: 'd3', width: 12 },
        { header: headers[3], key: 'd4', width: 12 },
        { header: headers[4], key: 'd5', width: 12 },
        { header: headers[5], key: 'd6', width: 12 },
        { header: headers[6], key: 'd7', width: 12 },
        { header: 'Total', key: 'total', width: 12 }
    ];

    // Style Header Row
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0A1F44' }
        };
        cell.font = {
            color: { argb: 'FFFFFFFF' },
            bold: true
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 30;

    // Helper to fetch image
    const imageCache = {};
    const fetchImage = async (url) => {
        if (imageCache[url]) return imageCache[url];
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            imageCache[url] = buffer;
            return buffer;
        } catch (e) {
            console.warn('Could not load image', url, e);
            return null;
        }
    };

    // Iterate Data
    for (const dest of state.filtered) {
        const airlines = (dest.viewAirlines?.length ? dest.viewAirlines : dest.airlines) || [];
        const usedAirlines = airlines.length ? airlines : [{ name: 'Sin datos', daily: Array(7).fill(0), weeklyTotal: 0 }];
        
        // Track start row for merging later
        const startRow = worksheet.rowCount + 1;

        for (const airline of usedAirlines) {
            const slug = airline.slug || slugify(airline.name || 'default');
            const legacyConfig = AIRLINE_CONFIG[slug] || AIRLINE_CONFIG['default'];
            const config = {
                logo: airline.logo || legacyConfig.logo,
                color: airline.color || legacyConfig.color,
                text: airline.color ? '#ffffff' : legacyConfig.text
            };
            
            const rowValues = {
                id: dest.routeId || dest.iata || '',
                dest: dest.city || dest.name,
                airline: config.logo ? '' : airline.name, // Leave empty if logo exists
                d1: formatVal(airline.daily?.[0]),
                d2: formatVal(airline.daily?.[1]),
                d3: formatVal(airline.daily?.[2]),
                d4: formatVal(airline.daily?.[3]),
                d5: formatVal(airline.daily?.[4]),
                d6: formatVal(airline.daily?.[5]),
                d7: formatVal(airline.daily?.[6]),
                total: airline.weeklyTotal
            };

            const row = worksheet.addRow(rowValues);
            row.height = 60; // Slightly adjusted height, but width is the key factor

            // Styling for this row
            // Apply borders and alignment to all cells
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                 cell.border = {
                     top: { style: 'thin' },
                     left: { style: 'thin' },
                     bottom: { style: 'thin' },
                     right: { style: 'thin' }
                 };
                 cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });

            // Specific overrides
            const airlineColorHex = 'FF' + config.color.replace('#', '');
            const airlineTextHex = 'FF' + config.text.replace('#', '');

             // 1 (Id), 2 (Dest), 3 (Airline) -> White Background, Black Text
            [1, 2, 3].forEach(c => {
                const cell = row.getCell(c);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                cell.font = { color: { argb: 'FF000000' }, bold: c === 1 }; // Bold ID
                cell.alignment = { 
                    horizontal: c === 2 ? 'left' : 'center', 
                    vertical: 'middle', 
                    wrapText: true 
                };
            });

            // 4 to 10: Days (Airline Color)
            for (let c = 4; c <= 10; c++) {
                const cell = row.getCell(c);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: airlineColorHex } };
                cell.font = { color: { argb: airlineTextHex }, bold: false };
            }

            // 11: Total (Light Gray for contrast)
            const totalCell = row.getCell(11);
            totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            totalCell.font = { color: { argb: 'FF000000' }, bold: true };

            // Insert Image Logo if exists
            if (config.logo) {
                const imageUrl = `images/airlines/${config.logo}`;
                const imgBuffer = await fetchImage(imageUrl);
                if (imgBuffer) {
                    const imageId = workbook.addImage({
                        buffer: imgBuffer,
                        extension: 'png',
                    });
                    
                    // Default padding for nice centering (20% W, 15% H padding)
                    let tlCol = 2.20; 
                    let brCol = 2.80;
                    let tlRow = row.number - 0.85; 
                    let brRow = row.number - 0.15;

                    // Special case: Make specific airlines larger
                    if (['aeromexico', 'aeromexico-connect', 'mexicana', 'volaris'].some(s => slug.includes(s))) {
                        tlCol = 2.05; // Only 5% padding
                        brCol = 2.95;
                        tlRow = row.number - 0.95; // Only 5% vertical padding
                        brRow = row.number - 0.05;
                    }

                    worksheet.addImage(imageId, {
                        tl: { col: tlCol, row: tlRow }, 
                        br: { col: brCol, row: brRow },
                        editAs: 'oneCell'
                    });
                } else {
                     row.getCell(3).value = airline.name;
                }
            }
        }

        // Merge ID and Dest columns if multiple airlines
        if (usedAirlines.length > 1) {
            const endRow = worksheet.rowCount;
            worksheet.mergeCells(`A${startRow}:A${endRow}`);
            worksheet.mergeCells(`B${startRow}:B${endRow}`);
        }
    }
    
    function formatVal(v) { return (v && v > 0) ? v : '-'; }

    // Save
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, 'Frecuencias_Nacionales_AIFA.xlsx');
  }

  function copyToWhatsApp() {
      if (!state.currentDetailDest) return;

      const dest = state.currentDetailDest;
      const lines = [`✈️ *${dest.city} (${dest.iata})*`];
      
      const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

      dest.viewAirlines.forEach(air => {
          lines.push('');
          lines.push(`*${air.name}* (${air.weeklyTotal} frec/sem)`);
          
          dayNames.forEach((dayName, idx) => {
              const detail = air.dailyDetails?.[idx];
              if (!detail) return;
              
              // Parse detail string
              const flightsRaw = detail.split('<br>');
              // Deduplicate
              const flights = [...new Set(flightsRaw.map(f => f.trim()))].filter(Boolean);
              
              if (flights.length > 0) {
                 lines.push(`_${dayName}:_`);
                 flights.forEach(f => {
                     // Clean up string like "VB5069 08:00 (Sal)"
                     // Remove (Sal)/(Lleg) text but keep meaning if possible or just raw
                     // "VB5069 08:00 (Sal)" -> "VB5069 08:00"
                     let clean = f.replace(/\(Dep\)|\(Arr\)|\(Sal\)|\(Lleg\)/gi, '').trim();
                     
                     // Add direction emoji
                     if (f.toLowerCase().includes('lleg') || f.toLowerCase().includes('arr')) {
                         clean = `🛬 LLEG ${clean}`;
                     } else {
                         clean = `🛫 SAL ${clean}`;
                     }
                     lines.push(`  ${clean}`);
                 });
              }
          });
      });
      
      const text = lines.join('\n');
      
      navigator.clipboard.writeText(text).then(() => {
          // Show tooltip or visual feedback
          const btn = dom.detailsCopy;
          const original = btn.innerHTML;
          btn.innerHTML = '<i class="fas fa-check me-1"></i> Copiado';
          btn.classList.remove('btn-outline-success');
          btn.classList.add('btn-success', 'text-white');
          
          setTimeout(() => {
              btn.innerHTML = original;
              btn.classList.add('btn-outline-success');
              btn.classList.remove('btn-success', 'text-white');
          }, 2000);
      }).catch(err => {
          console.error('Copy failed', err);
          alert('No se pudo copiar al portapapeles');
      });
  }

  // ─── Exportar Horarios Detallados ────────────────────────────────────────
  async function downloadScheduleExcel() {
    if (!state.filtered || state.filtered.length === 0) {
      alert('No hay datos para exportar.');
      return;
    }

    // Helper: parse a dailyDetail string into an array of {flightNum, type, time}
    function parseDetailFlights(detailStr) {
      if (!detailStr) return [];
      const results = [];
      detailStr.split('<br>').forEach(raw => {
        const f = raw.trim();
        if (!f) return;
        const parts = f.split(' ');
        let flightNum = '', type = '', time = '';
        const arrIdx = parts.findIndex(p => p.includes('(Lleg)'));
        const depIdx = parts.findIndex(p => p.includes('(Sal)'));
        if (arrIdx !== -1) {
          type = 'Llegada';
          flightNum = parts.slice(0, arrIdx).join(' ');
          time = parts.slice(arrIdx + 1).join(' ');
        } else if (depIdx !== -1) {
          type = 'Salida';
          flightNum = parts.slice(0, depIdx).join(' ');
          time = parts.slice(depIdx + 1).join(' ');
        } else {
          // Legacy: "VB102 14:00" or "VB102 14:00 (Dep)"
          const lastDepTag = parts.findIndex(p => /\(dep\)/i.test(p));
          const lastArrTag = parts.findIndex(p => /\(arr\)/i.test(p));
          const timeIdx = parts.findIndex(p => /^\d{1,2}:\d{2}$/.test(p));
          if (lastDepTag !== -1) {
            type = 'Salida';
            flightNum = parts.slice(0, Math.min(timeIdx !== -1 ? timeIdx : lastDepTag, lastDepTag)).join(' ').replace(/\(dep\)/i,'').trim();
            time = timeIdx !== -1 ? parts[timeIdx] : '';
          } else if (lastArrTag !== -1) {
            type = 'Llegada';
            flightNum = parts.slice(0, Math.min(timeIdx !== -1 ? timeIdx : lastArrTag, lastArrTag)).join(' ').replace(/\(arr\)/i,'').trim();
            time = timeIdx !== -1 ? parts[timeIdx] : '';
          } else if (timeIdx !== -1) {
            flightNum = parts.slice(0, timeIdx).join(' ');
            type = 'Salida';
            time = parts[timeIdx];
          } else {
            flightNum = f;
            type = '';
            time = '';
          }
        }
        if (flightNum || time) results.push({ flightNum: flightNum.trim(), type, time: time.trim() });
      });
      return results;
    }

    // Build a flat rows array: one row per unique flight per day
    // Flight key = routeId + airline + flightNum + type
    // Columns: days with time (or '-' if not operating that day)
    const DAY_LABELS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
    const flightMap = new Map(); // key -> { routeId, dest, state_, airline, flightNum, type, days:[7 times] }

    state.filtered.forEach(dest => {
      const airlines = (dest.viewAirlines?.length ? dest.viewAirlines : dest.airlines) || [];
      airlines.forEach(air => {
        (air.dailyDetails || []).forEach((detailStr, dayIdx) => {
          parseDetailFlights(detailStr).forEach(({ flightNum, type, time }) => {
            const key = `${dest.routeId||dest.iata}||${air.name}||${flightNum}||${type}`;
            if (!flightMap.has(key)) {
              flightMap.set(key, {
                routeId: dest.routeId || dest.iata || '',
                city: dest.city || dest.name || '',
                state_: dest.state || '',
                airline: air.name,
                flightNum,
                type,
                days: ['-','-','-','-','-','-','-']
              });
            }
            flightMap.get(key).days[dayIdx] = time || '✓';
          });
        });
      });
    });

    if (flightMap.size === 0) {
      alert('No hay detalle de horarios disponibles en los datos actuales.');
      return;
    }

    // Build ExcelJS workbook
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Horarios Nacionales');

    ws.columns = [
      { header: 'Id Ruta',    key: 'routeId',  width: 12 },
      { header: 'Destino',    key: 'city',     width: 22 },
      { header: 'Estado',     key: 'state_',   width: 18 },
      { header: 'Aerolínea',  key: 'airline',  width: 20 },
      { header: 'Vuelo',      key: 'flightNum',width: 14 },
      { header: 'Tipo',       key: 'type',     width: 12 },
      { header: DAY_LABELS_SHORT[0], key: 'd0', width: 10 },
      { header: DAY_LABELS_SHORT[1], key: 'd1', width: 10 },
      { header: DAY_LABELS_SHORT[2], key: 'd2', width: 10 },
      { header: DAY_LABELS_SHORT[3], key: 'd3', width: 10 },
      { header: DAY_LABELS_SHORT[4], key: 'd4', width: 10 },
      { header: DAY_LABELS_SHORT[5], key: 'd5', width: 10 },
      { header: DAY_LABELS_SHORT[6], key: 'd6', width: 10 },
    ];

    // Header style
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1F44' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 25;

    // Data rows
    let rowNum = 2;
    for (const entry of flightMap.values()) {
      const row = ws.addRow({
        routeId:  entry.routeId,
        city:     entry.city,
        state_:   entry.state_,
        airline:  entry.airline,
        flightNum:entry.flightNum,
        type:     entry.type,
        d0: entry.days[0], d1: entry.days[1], d2: entry.days[2],
        d3: entry.days[3], d4: entry.days[4], d5: entry.days[5], d6: entry.days[6],
      });

      const isSalida = entry.type === 'Salida';
      const accentArgb = isSalida ? 'FF0D6EFD' : 'FF198754'; // blue / green

      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' },
          bottom: { style: 'thin' }, right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (colNum <= 6) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
          cell.font = { color: { argb: 'FF000000' } };
          if (colNum === 2) cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          const hasTime = cell.value && cell.value !== '-';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hasTime ? accentArgb : 'FFF5F5F5' } };
          cell.font = { color: { argb: hasTime ? 'FFFFFFFF' : 'FFAAAAAA' }, bold: hasTime };
        }
      });
      rowNum++;
    }

    // Zebra stripe: alternate white/light-gray for first 6 info columns
    ws.eachRow((row, rn) => {
      if (rn < 2) return;
      const bg = rn % 2 === 0 ? 'FFF8F9FA' : 'FFFFFFFF';
      for (let c = 1; c <= 6; c++) {
        const cell = row.getCell(c);
        // Only set if not already overridden
        if (!cell.fill || cell.fill.fgColor?.argb === 'FFFFFFFF') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        }
      }
    });

    // Save
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, 'Horarios_Nacionales_AIFA.xlsx');
  }

  function debounce(fn, wait){
    let timeout;
    return function(...args){
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function slugify(str){
    return String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
})();




