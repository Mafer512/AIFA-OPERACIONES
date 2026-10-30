// ================================================================
// AIFA OPERACIONES — Módulo FIDS (Flight Information Display System)
// Vista de respaldo para tablero de vuelos
// ================================================================
(function () {
  'use strict';

  // ── Datos de aerolíneas (cargados desde airlines.json) ───────────
  let _airlinesDb = [];

  async function loadAirlinesDb() {
    if (_airlinesDb.length) return;
    try {
      const r = await fetch('data/airlines.json');
      _airlinesDb = await r.json();
    } catch (_) { _airlinesDb = []; }
  }

  function findAirline(iata, nombre) {
    const normStr = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    const ni = normStr(iata);
    const nn = normStr(nombre);
    let m = null;
    if (ni) m = _airlinesDb.find(a => normStr(a.iata) === ni);
    if (!m && nn) m = _airlinesDb.find(a =>
      normStr(a.name) === nn ||
      (Array.isArray(a.aliases) && a.aliases.some(al => normStr(al) === nn))
    );
    if (!m && nn) m = _airlinesDb.find(a =>
      normStr(a.name).includes(nn) || nn.includes(normStr(a.name)) ||
      (Array.isArray(a.aliases) && a.aliases.some(al => nn.includes(normStr(al)) || normStr(al).includes(nn)))
    );
    return m || null;
  }

  function getAirlineStyle(iata, nombre) {
    const a = findAirline(iata, nombre);
    if (a) return {
      bg:       a.color     || '#1e3a8a',
      text:     a.textColor || '#fff',
      name:     a.name      || nombre || iata || '?',
      logo:     a.logo      ? `images/airlines/${a.logo}` : null,
      logoZoom: a.logoZoom  || null,
      rawLogo:  a.rawLogo   || false,
    };
    let hash = 0;
    const s = (nombre || iata || '?').toUpperCase();
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    return { bg: `hsl(${Math.abs(hash)%360},60%,30%)`, text: '#fff', name: nombre||iata||'?', logo: null, logoZoom: null, rawLogo: false };
  }

  const ESTADO_CLASES = {
    'A tiempo':   'fids-estado-ok',
    'Aterrizo':   'fids-estado-ok',
    'Aterrizó':   'fids-estado-ok',
    'Despegó':    'fids-estado-ok',
    'En puerta':  'fids-estado-puerta',
    'Abordando':  'fids-estado-puerta',
    'Embarcando': 'fids-estado-puerta',
    'Cancelado':  'fids-estado-cancelado',
    'Demorado':   'fids-estado-demorado',
    'En vuelo':   'fids-estado-vuelo',
  };

  // ── Estado del módulo ─────────────────────────────────────────────
  let _vuelos      = [];
  let _fecha       = new Date().toISOString().split('T')[0];
  let _tipo        = 'llegada';
  let _clockTimer  = null;
  let _editingId   = null;
  let _activeTab   = 'display';
  let _importing   = false;

  // ── Helpers ───────────────────────────────────────────────────────
  function formatTime(t) {
    if (!t) return '—';
    return String(t).slice(0, 5);
  }

  function formatFecha(d) {
    if (!d) return '';
    const [y, m, dd] = d.split('-');
    const meses = ['enero','febrero','marzo','abril','mayo','junio',
                   'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const dias  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const dt    = new Date(parseInt(y), parseInt(m)-1, parseInt(dd));
    return `${dias[dt.getDay()]}, ${dd} de ${meses[parseInt(m)-1]} de ${y}`;
  }

  function nowTimeStr() {
    return new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  }

  // ── Inicialización ────────────────────────────────────────────────
  async function init() {
    await loadAirlinesDb();
    renderShell();
    await loadVuelos();
    startClock();
  }

  function renderShell() {
    const sec = document.getElementById('fids-section');
    if (!sec) return;
    sec.innerHTML = `
    <div class="fids-wrapper">
      <!-- TABS ADMIN / DISPLAY -->
      <div class="fids-top-bar d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2 px-1">
        <div class="fids-tab-btns d-flex gap-2">
          <button class="btn fids-tab-btn active" id="fids-tab-display" onclick="window.fidsShowTab('display')">
            <i class="fas fa-tv me-1"></i> Pantalla FIDS
          </button>
          <button class="btn fids-tab-btn" id="fids-tab-admin" onclick="window.fidsShowTab('admin')">
            <i class="fas fa-table me-1"></i> Administrar vuelos
          </button>
        </div>
        <div class="d-flex gap-2 align-items-center flex-wrap">
          <input type="date" id="fids-fecha-picker" class="form-control form-control-sm fids-date-picker"
                 value="${_fecha}" onchange="window.fidsOnFechaChange(this.value)">
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn fids-tipo-btn ${_tipo==='llegada'?'active':''}" data-tipo="llegada"
                    onclick="window.fidsSetTipo('llegada')"><i class="fas fa-plane-arrival me-1"></i>Llegadas</button>
            <button class="btn fids-tipo-btn ${_tipo==='salida'?'active':''}" data-tipo="salida"
                    onclick="window.fidsSetTipo('salida')"><i class="fas fa-plane-departure me-1"></i>Salidas</button>
          </div>
        </div>
      </div>

      <!-- PANTALLA FIDS (DISPLAY) -->
      <div id="fids-display-pane" class="fids-pane">
        <div class="fids-screen">
          <div class="fids-screen-header">
            <div class="fids-screen-logo"><img src="images/aifa-logo.png" alt="AIFA" height="36" onerror="this.src='images/aifa-logo.jpg'"></div>
            <div class="fids-screen-title">
              <span class="fids-screen-tipo" id="fids-screen-tipo">LLEGADAS</span>
              <span class="fids-screen-fecha" id="fids-screen-fecha"></span>
            </div>
            <div class="fids-screen-clock" id="fids-clock">--:--:--</div>
          </div>
          <div class="fids-screen-cols">
            <div class="fids-col-aerolinea">AEROLÍNEA</div>
            <div class="fids-col-vuelo">VUELO</div>
            <div class="fids-col-ciudad" id="fids-hdr-ciudad">${_tipo==='llegada'?'ORIGEN':'DESTINO'}</div>
            <div class="fids-col-hora">HORA</div>
            <div class="fids-col-puerta">PUERTA</div>
            <div class="fids-col-estado">ESTADO</div>
          </div>
          <div class="fids-rows-container" id="fids-rows">
            <div class="fids-loading"><i class="fas fa-spinner fa-spin me-2"></i>Cargando vuelos…</div>
          </div>
          <div class="fids-screen-footer">
            <span>AEROPUERTO INTERNACIONAL FELIPE ÁNGELES — AIFA</span>
            <span id="fids-footer-count"></span>
          </div>
        </div>
      </div>

      <!-- PANEL ADMIN -->
      <div id="fids-admin-pane" class="fids-pane d-none">
        <div class="fids-admin-toolbar d-flex gap-2 align-items-center flex-wrap mb-3">
          <div class="alert alert-info mb-0 py-1 px-2 small flex-fill">
            <i class="fas fa-info-circle me-1"></i>
            Datos del <strong>itinerario diario</strong>. Para agregar o modificar vuelos, usa la sección <strong>Itinerario</strong>.
          </div>
          <button class="btn btn-sm btn-outline-secondary" onclick="window.fidsRefresh()">
            <i class="fas fa-sync-alt me-1"></i> Actualizar
          </button>
          <span id="fids-admin-count" class="badge bg-secondary"></span>
        </div>
        <div id="fids-import-log" class="d-none alert alert-success py-1 small mb-2"></div>
        <div class="table-responsive fids-admin-table-wrap">
          <table class="table table-sm table-hover fids-admin-table" id="fids-admin-table">
            <thead class="table-dark">
              <tr>
                <th>Vuelo</th>
                <th>Aerolínea</th>
                <th>IATA</th>
                <th id="fids-admin-hdr-ciudad">${_tipo==='llegada'?'Origen':'Destino'}</th>
                <th>Hora</th>
                <th>Posición</th>
                <th>Banda/Belt</th>
                <th>Aeronave</th>
              </tr>
            </thead>
            <tbody id="fids-admin-tbody">
              <tr><td colspan="10" class="text-center py-3">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
        <!-- MODAL EDICIÓN -->
        <div class="modal fade" id="fidsEditModal" tabindex="-1">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header bg-dark text-white">
                <h5 class="modal-title"><i class="fas fa-edit me-2"></i><span id="fids-modal-title">Editar vuelo</span></h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="row g-3">
                  <div class="col-md-4">
                    <label class="form-label small fw-bold">N° Vuelo *</label>
                    <input type="text" class="form-control" id="fids-edit-vuelo" placeholder="Ej. VB7417" maxlength="20">
                  </div>
                  <div class="col-md-4">
                    <label class="form-label small fw-bold">Aerolínea *</label>
                    <input type="text" class="form-control" id="fids-edit-aerolinea" placeholder="Ej. VivaAerobus">
                  </div>
                  <div class="col-md-4">
                    <label class="form-label small fw-bold">Código IATA</label>
                    <input type="text" class="form-control" id="fids-edit-iata" placeholder="VB" maxlength="5">
                  </div>
                  <div class="col-md-6">
                    <label class="form-label small fw-bold">${_tipo==='llegada'?'Ciudad origen':'Ciudad destino'} *</label>
                    <input type="text" class="form-control" id="fids-edit-ciudad" placeholder="Ej. Guadalajara">
                  </div>
                  <div class="col-md-3">
                    <label class="form-label small fw-bold">Hora programada *</label>
                    <input type="time" class="form-control" id="fids-edit-hora-prog">
                  </div>
                  <div class="col-md-3">
                    <label class="form-label small fw-bold">Hora estimada</label>
                    <input type="time" class="form-control" id="fids-edit-hora-est">
                  </div>
                  <div class="col-md-3">
                    <label class="form-label small fw-bold">Puerta</label>
                    <input type="text" class="form-control" id="fids-edit-puerta" placeholder="Ej. A3" maxlength="10">
                  </div>
                  <div class="col-md-5">
                    <label class="form-label small fw-bold">Estado</label>
                    <select class="form-select" id="fids-edit-estado">
                      <option>A tiempo</option>
                      <option>En puerta</option>
                      <option>Abordando</option>
                      <option>Embarcando</option>
                      <option>Aterrizó</option>
                      <option>Despegó</option>
                      <option>Demorado</option>
                      <option>Cancelado</option>
                      <option>En vuelo</option>
                    </select>
                  </div>
                  <div class="col-md-4">
                    <label class="form-label small fw-bold">Orden en pantalla</label>
                    <input type="number" class="form-control" id="fids-edit-orden" min="1" max="999">
                  </div>
                  <div class="col-12">
                    <label class="form-label small fw-bold">Notas</label>
                    <input type="text" class="form-control" id="fids-edit-notas" placeholder="Observaciones opcionales" maxlength="200">
                  </div>
                </div>
                <div id="fids-edit-status" class="mt-2"></div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" class="btn btn-primary" onclick="window.fidsSaveRow()">
                  <i class="fas fa-save me-1"></i> Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    document.getElementById('fids-screen-fecha').textContent = formatFecha(_fecha);
    document.getElementById('fids-screen-tipo').textContent  = _tipo === 'llegada' ? 'LLEGADAS' : 'SALIDAS';
  }

  function _updateCiudadLabels() {
    const lbl  = _tipo === 'llegada' ? 'ORIGEN' : 'DESTINO';
    const lbl2 = _tipo === 'llegada' ? 'Origen' : 'Destino';
    const hc = document.getElementById('fids-hdr-ciudad');
    const ha = document.getElementById('fids-admin-hdr-ciudad');
    if (hc) hc.textContent = lbl;
    if (ha) ha.textContent = lbl2;
  }

  // ── Tabs ─────────────────────────────────────────────────────────
  window.fidsShowTab = function (tab) {
    _activeTab = tab;
    document.getElementById('fids-display-pane').classList.toggle('d-none', tab !== 'display');
    document.getElementById('fids-admin-pane').classList.toggle('d-none',   tab !== 'admin');
    document.getElementById('fids-tab-display').classList.toggle('active', tab === 'display');
    document.getElementById('fids-tab-admin').classList.toggle('active',   tab === 'admin');
    if (tab === 'admin') renderAdminTable();
  };

  window.fidsOnFechaChange = function (v) {
    _fecha = v;
    document.getElementById('fids-screen-fecha').textContent = formatFecha(v);
    loadVuelos();
  };

  window.fidsSetTipo = function (t) {
    _tipo = t;
    document.querySelectorAll('.fids-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === t));
    const tipoEl = document.getElementById('fids-screen-tipo');
    if (tipoEl) tipoEl.textContent = t === 'llegada' ? 'LLEGADAS' : 'SALIDAS';
    _updateCiudadLabels();
    loadVuelos();
  };

  window.fidsRefresh = function () { loadVuelos(); };

  // ── Carga de datos desde tabla flights (itinerario diario) ──────
  async function loadVuelos() {
    setDisplayLoading(true);
    try {
      const sb = window.supabaseClient;
      if (!sb) throw new Error('Sin cliente Supabase');

      let data, error;
      if (_tipo === 'llegada') {
        ({ data, error } = await sb
          .from('flights')
          .select('aerolinea,vuelo_llegada,hora_llegada,origen,posicion,banda_reclamo,categoria')
          .eq('fecha_llegada', _fecha)
          .order('hora_llegada', { ascending: true }));
      } else {
        ({ data, error } = await sb
          .from('flights')
          .select('aerolinea,vuelo_salida,hora_salida,destino,posicion,categoria')
          .eq('fecha_salida', _fecha)
          .order('hora_salida', { ascending: true }));
      }
      if (error) throw error;

      if (data && data.length > 0) {
        // Mapear campos de flights → formato interno FIDS
        _vuelos = data.map(f => {
          const flightNum = _tipo === 'llegada' ? (f.vuelo_llegada || '') : (f.vuelo_salida || '');
          const hora      = _tipo === 'llegada' ? (f.hora_llegada  || '') : (f.hora_salida  || '');
          const ciudad    = _tipo === 'llegada' ? (f.origen        || '') : (f.destino      || '');
          const iata      = (f.aerolinea || '').toUpperCase().trim();
          const alData    = findAirline(iata, '');
          return {
            id:              flightNum + '_' + hora,
            numero_vuelo:    flightNum,
            aerolinea:       alData ? alData.name : iata,
            codigo_iata:     iata,
            origen_destino:  ciudad,
            hora_programada: hora,
            hora_estimada:   null,
            puerta:          f.posicion      || '',
            banda:           f.banda_reclamo || '',
            estado:          'A tiempo',
            notas:           '',
          };
        });
      } else {
        // Sin datos reales → cargar vuelos de demostración
        _vuelos = _buildDemoFlights();
      }

      renderDisplayRows();
      renderAdminTable();
    } catch (e) {
      console.error('[FIDS]', e);
      setDisplayLoading(false, `<div class="fids-error"><i class="fas fa-exclamation-circle me-2"></i>Error al cargar vuelos: ${e.message}</div>`);
    }
  }

  // ── Datos de demostración (sin vuelos reales en la fecha) ────────
  function _buildDemoFlights() {
    const llegadas = [
      { iata:'VB', vuelo:'VB 7417', ciudad:'Guadalajara',      hora:'06:00', puerta:'A03', banda:'1', estado:'Aterrizó'  },
      { iata:'Y4', vuelo:'Y4 3296', ciudad:'Tijuana',          hora:'06:35', puerta:'A05', banda:'2', estado:'Aterrizó'  },
      { iata:'AM', vuelo:'AM 0234', ciudad:'Cancún',           hora:'07:15', puerta:'C02', banda:'3', estado:'A tiempo'  },
      { iata:'VB', vuelo:'VB 9497', ciudad:'Los Cabos',        hora:'07:50', puerta:'B01', banda:'1', estado:'En puerta' },
      { iata:'AM', vuelo:'AM 0456', ciudad:'Monterrey',        hora:'08:20', puerta:'C04', banda:'4', estado:'En puerta' },
      { iata:'XN', vuelo:'XN 1765', ciudad:'Mérida',           hora:'08:55', puerta:'A07', banda:'2', estado:'A tiempo'  },
      { iata:'Y4', vuelo:'Y4 7171', ciudad:'La Paz',           hora:'09:30', puerta:'B03', banda:'2', estado:'Demorado'  },
      { iata:'AM', vuelo:'AM 0678', ciudad:'Puerto Vallarta',  hora:'10:00', puerta:'C06', banda:'5', estado:'A tiempo'  },
      { iata:'VB', vuelo:'VB 9313', ciudad:'Zihuatanejo',      hora:'10:35', puerta:'A09', banda:'1', estado:'A tiempo'  },
      { iata:'6R', vuelo:'6R 7085', ciudad:'Los Ángeles',      hora:'11:10', puerta:'607', banda:'—', estado:'En vuelo'  },
      { iata:'EK', vuelo:'EK 9915', ciudad:'Dubái',            hora:'11:45', puerta:'605', banda:'—', estado:'En vuelo'  },
      { iata:'CX', vuelo:'CX 0086', ciudad:'Anchorage',        hora:'12:20', puerta:'609', banda:'—', estado:'A tiempo'  },
    ];
    const salidas = [
      { iata:'VB', vuelo:'VB 7418', ciudad:'Guadalajara',      hora:'06:30', puerta:'A03', banda:'—', estado:'Despegó'   },
      { iata:'Y4', vuelo:'Y4 3297', ciudad:'Tijuana',          hora:'07:05', puerta:'A05', banda:'—', estado:'Despegó'   },
      { iata:'AM', vuelo:'AM 0235', ciudad:'Cancún',           hora:'07:50', puerta:'C02', banda:'—', estado:'A tiempo'  },
      { iata:'VB', vuelo:'VB 9520', ciudad:'Los Cabos',        hora:'08:25', puerta:'B01', banda:'—', estado:'Abordando' },
      { iata:'AM', vuelo:'AM 0457', ciudad:'Monterrey',        hora:'09:00', puerta:'C04', banda:'—', estado:'En puerta' },
      { iata:'XN', vuelo:'XN 1204', ciudad:'Tijuana',          hora:'09:35', puerta:'A07', banda:'—', estado:'A tiempo'  },
      { iata:'Y4', vuelo:'Y4 3960', ciudad:'Bogotá',           hora:'10:10', puerta:'B03', banda:'—', estado:'Demorado'  },
      { iata:'AM', vuelo:'AM 0679', ciudad:'Puerto Vallarta',  hora:'10:45', puerta:'C06', banda:'—', estado:'A tiempo'  },
      { iata:'VB', vuelo:'VB 9462', ciudad:'Chetumal',         hora:'11:20', puerta:'A09', banda:'—', estado:'A tiempo'  },
      { iata:'6R', vuelo:'6R 7084', ciudad:'Los Ángeles',      hora:'12:00', puerta:'608', banda:'—', estado:'A tiempo'  },
      { iata:'EK', vuelo:'EK 9916', ciudad:'Dubái',            hora:'12:30', puerta:'605', banda:'—', estado:'A tiempo'  },
      { iata:'M7', vuelo:'M7 6810', ciudad:'Los Ángeles',      hora:'13:00', puerta:'115', banda:'—', estado:'En vuelo'  },
    ];
    const list = _tipo === 'llegada' ? llegadas : salidas;
    return list.map((d, i) => {
      const al = findAirline(d.iata, '');
      return {
        id:              'demo_' + i,
        numero_vuelo:    d.vuelo,
        aerolinea:       al ? al.name : d.iata,
        codigo_iata:     d.iata,
        origen_destino:  d.ciudad,
        hora_programada: d.hora,
        hora_estimada:   d.estado === 'Demorado' ? (d.hora.slice(0,3) + String(parseInt(d.hora.slice(3,5)) + 20).padStart(2,'0')) : null,
        puerta:          d.puerta,
        banda:           d.banda,
        estado:          d.estado,
        notas:           'DEMO',
      };
    });
  }

  function setDisplayLoading(on, html) {
    const rows = document.getElementById('fids-rows');
    if (!rows) return;
    if (on) rows.innerHTML = '<div class="fids-loading"><i class="fas fa-spinner fa-spin me-2"></i>Cargando vuelos…</div>';
    else if (html) rows.innerHTML = html;
  }

  // ── RENDER pantalla FIDS ─────────────────────────────────────────
  function renderDisplayRows() {
    const rows = document.getElementById('fids-rows');
    if (!rows) return;

    // Actualizar columna header
    const colCiudad = document.querySelector('.fids-col-ciudad');
    if (colCiudad) colCiudad.textContent = _tipo === 'llegada' ? 'ORIGEN' : 'DESTINO';

    const footer = document.getElementById('fids-footer-count');
    if (footer) footer.textContent = `${_vuelos.length} vuelo${_vuelos.length !== 1 ? 's' : ''}`;

    if (!_vuelos.length) {
      rows.innerHTML = `<div class="fids-empty"><i class="fas fa-info-circle me-2"></i>No hay vuelos registrados para esta fecha.</div>`;
      return;
    }

    const isDemo = _vuelos.length && _vuelos[0].id.startsWith('demo_');
    if (isDemo) {
      rows.insertAdjacentHTML = rows.insertAdjacentHTML; // no-op placeholder
    }

    rows.innerHTML = (isDemo
      ? `<div style="background:#1e3a5f;color:#7ec8e3;font-size:.7rem;padding:.3rem 1rem;letter-spacing:.08em;border-bottom:1px solid #2d5a8e;">
           <i class="fas fa-eye me-1"></i> MODO VISTA PREVIA — datos de ejemplo (sin vuelos en el itinerario para esta fecha)
         </div>`
      : '') + _vuelos.map((v, i) => {
      const al      = getAirlineStyle(v.codigo_iata, v.aerolinea);
      const est     = v.estado || 'A tiempo';
      const cls     = ESTADO_CLASES[est] || 'fids-estado-ok';
      const hora    = v.hora_estimada && v.hora_estimada !== v.hora_programada
                      ? v.hora_estimada : v.hora_programada;
      const delayed = v.hora_estimada && v.hora_estimada !== v.hora_programada;
      const rowCls  = i % 2 === 0 ? 'fids-row fids-row-even fade-in-row' : 'fids-row fids-row-odd fade-in-row';

      const badgeBg = al.rawLogo ? '#ffffff' : al.bg;
      const _imgSt = [al.rawLogo ? 'filter:none' : '', al.logoZoom ? `transform:scale(${al.logoZoom})` : ''].filter(Boolean).join(';');
      const imgStyleAttr = _imgSt ? ` style="${_imgSt}"` : '';
      const logoInner = al.logo
        ? `<img src="${al.logo}" alt="${al.name}" class="fids-airline-logo"${imgStyleAttr}
               onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'">
           <span style="display:none">${(v.aerolinea||'').toUpperCase().slice(0,12)}</span>`
        : `<span>${(v.aerolinea||'').toUpperCase().slice(0,12)}</span>`;

      return `
      <div class="${rowCls}" style="--delay:${(i*0.06).toFixed(2)}s">
        <div class="fids-col-aerolinea">
          <span class="fids-airline-badge" style="background:${badgeBg};color:${al.text};">${logoInner}</span>
        </div>
        <div class="fids-col-vuelo">${v.numero_vuelo || '—'}</div>
        <div class="fids-col-ciudad">${v.origen_destino || '—'}</div>
        <div class="fids-col-hora">
          <span class="${delayed ? 'fids-hora-delayed' : ''}">${formatTime(hora)}</span>
          ${delayed ? `<span class="fids-hora-orig">${formatTime(v.hora_programada)}</span>` : ''}
        </div>
        <div class="fids-col-puerta">${v.puerta || '—'}</div>
        <div class="fids-col-estado"><span class="fids-estado-badge ${cls}">${est}</span></div>
      </div>`;
    }).join('');
  }

  // ── RENDER tabla Admin ────────────────────────────────────────────
  function renderAdminTable() {
    const tbody = document.getElementById('fids-admin-tbody');
    if (!tbody) return;

    const count = document.getElementById('fids-admin-count');
    if (count) count.textContent = `${_vuelos.length} vuelos`;

    if (!_vuelos.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No hay vuelos registrados para esta fecha en el itinerario.</td></tr>`;
      return;
    }

    tbody.innerHTML = _vuelos.map(v => {
      const al  = getAirlineStyle(v.codigo_iata, v.aerolinea);
      return `<tr>
        <td class="fw-bold">${v.numero_vuelo || '—'}</td>
        <td><span class="badge" style="background:${al.bg};color:${al.text};">${v.aerolinea || '—'}</span></td>
        <td>${v.codigo_iata || '—'}</td>
        <td>${v.origen_destino || '—'}</td>
        <td>${formatTime(v.hora_programada)}</td>
        <td>${v.puerta || '—'}</td>
        <td>${v.banda || '—'}</td>
        <td class="text-truncate" style="max-width:120px" title="${v.notas||''}">${v.notas || ''}</td>
      </tr>`;
    }).join('');
  }

  function badgeClass(estado) {
    const map = {
      'A tiempo': 'bg-success', 'En puerta': 'bg-primary', 'Abordando': 'bg-primary',
      'Embarcando': 'bg-primary', 'Aterrizó': 'bg-secondary', 'Despegó': 'bg-secondary',
      'Demorado': 'bg-warning text-dark', 'Cancelado': 'bg-danger', 'En vuelo': 'bg-info text-dark',
    };
    return map[estado] || 'bg-secondary';
  }

  // ── CRUD ──────────────────────────────────────────────────────────
  window.fidsAddRow = function () {
    _editingId = null;
    document.getElementById('fids-modal-title').textContent = 'Agregar vuelo';
    clearModal();
    const m = document.getElementById('fidsEditModal');
    if (m && bootstrap) bootstrap.Modal.getOrCreateInstance(m).show();
  };

  window.fidsEditRow = function (id) {
    const v = _vuelos.find(x => x.id === id);
    if (!v) return;
    _editingId = id;
    document.getElementById('fids-modal-title').textContent  = 'Editar vuelo';
    document.getElementById('fids-edit-vuelo').value         = v.numero_vuelo  || '';
    document.getElementById('fids-edit-aerolinea').value     = v.aerolinea     || '';
    document.getElementById('fids-edit-iata').value          = v.codigo_iata   || '';
    document.getElementById('fids-edit-ciudad').value        = v.origen_destino|| '';
    document.getElementById('fids-edit-hora-prog').value     = (v.hora_programada || '').slice(0, 5);
    document.getElementById('fids-edit-hora-est').value      = (v.hora_estimada  || '').slice(0, 5);
    document.getElementById('fids-edit-puerta').value        = v.puerta          || '';
    document.getElementById('fids-edit-estado').value        = v.estado          || 'A tiempo';
    document.getElementById('fids-edit-orden').value         = v.orden           || '';
    document.getElementById('fids-edit-notas').value         = v.notas           || '';
    document.getElementById('fids-edit-status').innerHTML    = '';
    const m = document.getElementById('fidsEditModal');
    if (m && bootstrap) bootstrap.Modal.getOrCreateInstance(m).show();
  };

  window.fidsSaveRow = async function () {
    const vuelo      = document.getElementById('fids-edit-vuelo').value.trim();
    const aerolinea  = document.getElementById('fids-edit-aerolinea').value.trim();
    const ciudad     = document.getElementById('fids-edit-ciudad').value.trim();
    const horaProg   = document.getElementById('fids-edit-hora-prog').value;
    if (!vuelo || !aerolinea || !ciudad || !horaProg) {
      showEditStatus('Por favor completa los campos requeridos (*)', true); return;
    }
    const payload = {
      fecha:           _fecha,
      tipo:            _tipo,
      numero_vuelo:    vuelo,
      aerolinea,
      codigo_iata:     document.getElementById('fids-edit-iata').value.trim().toUpperCase() || null,
      origen_destino:  ciudad,
      hora_programada: horaProg,
      hora_estimada:   document.getElementById('fids-edit-hora-est').value || null,
      puerta:          document.getElementById('fids-edit-puerta').value.trim() || null,
      estado:          document.getElementById('fids-edit-estado').value,
      orden:           parseInt(document.getElementById('fids-edit-orden').value) || null,
      notas:           document.getElementById('fids-edit-notas').value.trim() || null,
      activo:          true,
    };
    try {
      const sb = window.supabaseClient;
      if (!sb) throw new Error('Sin cliente Supabase');
      let error;
      if (_editingId) {
        ({ error } = await sb.from('fids_vuelos').update(payload).eq('id', _editingId));
      } else {
        ({ error } = await sb.from('fids_vuelos').insert(payload));
      }
      if (error) throw error;
      const m = document.getElementById('fidsEditModal');
      if (m && bootstrap) bootstrap.Modal.getOrCreateInstance(m).hide();
      await loadVuelos();
    } catch (e) {
      showEditStatus(`Error: ${e.message}`, true);
    }
  };

  window.fidsDeleteRow = async function (id) {
    if (!confirm('¿Eliminar este vuelo de la pantalla?')) return;
    try {
      const sb = window.supabaseClient;
      if (!sb) throw new Error('Sin cliente Supabase');
      const { error } = await sb.from('fids_vuelos').update({ activo: false }).eq('id', id);
      if (error) throw error;
      await loadVuelos();
    } catch (e) { alert('Error al eliminar: ' + e.message); }
  };

  window.fidsClearDay = async function () {
    const total = _vuelos.length;
    if (!total) { alert('No hay vuelos para limpiar.'); return; }
    if (!confirm(`¿Eliminar los ${total} vuelos del ${_fecha} (${_tipo}s) del tablero?\nEsta acción no se puede deshacer.`)) return;
    try {
      const sb = window.supabaseClient;
      if (!sb) throw new Error();
      const ids = _vuelos.map(v => v.id);
      const { error } = await sb.from('fids_vuelos').update({ activo: false }).in('id', ids);
      if (error) throw error;
      await loadVuelos();
    } catch (e) { alert('Error: ' + e.message); }
  };

  function clearModal() {
    ['fids-edit-vuelo','fids-edit-aerolinea','fids-edit-iata','fids-edit-ciudad',
     'fids-edit-hora-prog','fids-edit-hora-est','fids-edit-puerta','fids-edit-orden','fids-edit-notas']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const sel = document.getElementById('fids-edit-estado');
    if (sel) sel.value = 'A tiempo';
    const st = document.getElementById('fids-edit-status');
    if (st) st.innerHTML = '';
  }

  function showEditStatus(msg, isErr) {
    const el = document.getElementById('fids-edit-status');
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${isErr?'danger':'success'} py-1 small mt-1">${msg}</div>`;
  }

  // ── Importación Excel ─────────────────────────────────────────────
  window.fidsImportExcel = async function (e) {
    if (_importing) return;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    _importing = true;

    // Cargar SheetJS dinámicamente si no está disponible
    if (typeof XLSX === 'undefined') {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      } catch (_) {
        alert('No se pudo cargar la librería de Excel. Verifica tu conexión.');
        _importing = false; return;
      }
    }

    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];

      // Intentar con la primera fila como header
      let rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // Si hay pocas columnas con nombre real (demasiados __EMPTY), intentar con la fila 2
      const keys0 = rows.length ? Object.keys(rows[0]) : [];
      const realHdrs = keys0.filter(k => !k.startsWith('__EMPTY'));
      if (realHdrs.length < 2 || rows.length === 0) {
        const rawArr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (rawArr.length > 1) {
          const hdrs = rawArr[1].map((h, i) => h ? String(h).trim() : `__EMPTY_${i}`);
          rows = rawArr.slice(2).map(row => {
            const obj = {};
            hdrs.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
            return obj;
          });
        }
      }

      if (!rows.length) { alert('El archivo está vacío.'); _importing = false; return; }

      const allKeys  = Object.keys(rows[0]);
      const mappings = detectColumns(allKeys, rows);

      console.log('[FIDS] Columnas Excel:', allKeys);
      console.log('[FIDS] Mapeo detectado:', mappings);

      if (!mappings.vuelo) {
        alert(
          'No se encontró columna de número de vuelo.\n' +
          'Columnas detectadas: ' + allKeys.join(', ') + '\n\n' +
          'Asegúrate de que el Excel tenga una columna: Designador, Vuelo, CODE o Flight.'
        );
        _importing = false; return;
      }

      const records = rows
        .filter(r => String(r[mappings.vuelo] || '').trim())
        .map((r, i) => {
          const vueloRaw = String(r[mappings.vuelo]     || '').trim();
          const aerRaw   = String(r[mappings.aerolinea] || '').trim();
          const iataRaw  = String(r[mappings.iata]      || '').trim().toUpperCase();

          // Ciudad: para salidas usar el destino (segundo aeropuerto), para llegadas el origen
          let ciudadRaw = '';
          if (_tipo === 'salida' && mappings.ciudadDest) {
            ciudadRaw = String(r[mappings.ciudadDest] || '').trim();
          }
          if (!ciudadRaw && mappings.ciudad) {
            ciudadRaw = String(r[mappings.ciudad] || '').trim();
          }

          const horaProg = mappings.hora    ? parseExcelTime(r[mappings.hora])    : null;
          const horaEst  = mappings.horaEst ? parseExcelTime(r[mappings.horaEst]) : null;
          const estadoRaw= mappings.estado  ? String(r[mappings.estado] || '').trim() : '';

          // Extraer IATA del número de vuelo si no hay columna IATA
          let iataFinal = iataRaw;
          if (!iataFinal && vueloRaw) {
            const mx = vueloRaw.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d+/i);
            if (mx) iataFinal = mx[1].toUpperCase();
          }

          // Completar nombre de aerolínea desde IATA si está vacío
          let aerFinal = aerRaw;
          if (!aerFinal && iataFinal) {
            const al = findAirline(iataFinal, '');
            if (al) aerFinal = al.name;
          }

          return {
            fecha:           _fecha,
            tipo:            _tipo,
            numero_vuelo:    vueloRaw,
            aerolinea:       aerFinal || iataFinal || 'Sin aerolínea',
            codigo_iata:     iataFinal || null,
            origen_destino:  ciudadRaw || '—',
            hora_programada: horaProg,
            hora_estimada:   horaEst,
            estado:          mapEstado(estadoRaw),
            puerta:          mappings.puerta ? String(r[mappings.puerta] || '').trim() || null : null,
            activo:          true,
            orden:           i + 1,
          };
        })
        .filter(r => r.numero_vuelo);

      if (!records.length) { alert('No se encontraron filas válidas.'); _importing = false; return; }

      const sinHora = records.filter(r => !r.hora_programada).length;
      let msg = `Se importarán ${records.length} vuelo(s) para ${_tipo}s del ${_fecha}.`;
      if (sinHora > 0) msg += `\n⚠ ${sinHora} vuelos sin hora (puedes editarlos después).`;
      msg += '\n¿Continuar? (no elimina registros existentes)';

      if (!confirm(msg)) { _importing = false; return; }

      const sb = window.supabaseClient;
      if (!sb) throw new Error('Sin cliente Supabase');
      const { error } = await sb.from('fids_vuelos').insert(records);
      if (error) throw error;

      const logEl = document.getElementById('fids-import-log');
      if (logEl) {
        logEl.className = 'alert alert-success py-1 small mb-2';
        logEl.textContent = `✓ ${records.length} vuelos importados correctamente${sinHora ? ` (${sinHora} sin hora)` : ''}.`;
        logEl.classList.remove('d-none');
        setTimeout(() => logEl.classList.add('d-none'), 8000);
      }
      await loadVuelos();
      if (_activeTab !== 'admin') window.fidsShowTab('admin');
    } catch (err) {
      alert('Error al importar: ' + err.message);
      console.error('[FIDS Import]', err);
    }
    _importing = false;
  };

  /**
   * Detecta columnas del Excel de forma flexible.
   * Formato real conocido: CODE, NAME, __EMPTY, IATA, Aeropuerto origen,
   *   __EMPTY_1, IATA_1, Aeropuerto origen_1, __EMPTY_2, TYPE OF FLIGHT, Designador, __EMPTY_3
   */
  function detectColumns(keys, rows) {
    const norm = s => (s||'').toString().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();

    // Busca clave que coincida exactamente con alguna palabra
    const findExact = (...words) =>
      keys.find(k => words.some(w => norm(k) === norm(w)));

    // Busca clave que contenga alguna palabra
    const findIncludes = (...words) =>
      keys.find(k => words.some(w => norm(k).includes(norm(w))));

    // ── Número de vuelo ─────────────────────────────────────────────
    // "Designador" = designador OACI (ej. VB7417) — máxima prioridad
    const vuelo =
      findExact('designador') ||
      findIncludes('numero vuelo', 'num vuelo', 'n vuelo', 'flight number') ||
      findExact('vuelo', 'flight', 'code') ||
      findIncludes('vuelo', 'flight');

    // ── Aerolínea ────────────────────────────────────────────────────
    const aerolinea =
      findExact('name', 'nombre', 'aerolinea', 'airline') ||
      findIncludes('aerolinea', 'airline', 'carrier', 'compania', 'nombre');

    // ── Código IATA ──────────────────────────────────────────────────
    // Hay IATA e IATA_1: queremos el primero (de la aerolínea/origen)
    const iata =
      findExact('iata') ||
      findExact('codigo iata', 'iata code') ||
      findIncludes('codigo iata', 'iata code', 'siglas');

    // ── Ciudad de origen (llegadas) / primer aeropuerto ──────────────
    const ciudad =
      findExact('aeropuerto origen') ||
      findIncludes('aeropuerto origen', 'ciudad origen', 'origin airport', 'origen') ||
      findIncludes('aeropuerto', 'ciudad', 'city', 'ruta', 'route');

    // ── Ciudad de destino (salidas) / segundo aeropuerto ─────────────
    const ciudadDest =
      findExact('aeropuerto origen_1', 'aeropuerto destino', 'destino') ||
      findIncludes('aeropuerto destino', 'ciudad destino', 'destination airport') ||
      (keys.filter(k => norm(k).includes('aeropuerto origen'))[1] || null);

    // ── Hora programada ──────────────────────────────────────────────
    let hora =
      findExact('hora programada', 'hora salida', 'hora llegada', 'hora prog', 'hora') ||
      findIncludes('hora programada', 'programada', 'hora salida', 'hora llegada', 'scheduled', 'hora') ||
      findIncludes('time');

    // ── Hora estimada ────────────────────────────────────────────────
    let horaEst =
      findIncludes('hora estimada', 'estimada', 'estimated', 'eta', 'hora real');

    // ── Si no hay hora, escanear columnas __EMPTY buscando tiempos ───
    if (!hora) {
      const emptyKeys = keys.filter(k => /^__EMPTY/i.test(k));
      const samples   = rows.slice(0, Math.min(8, rows.length));
      for (const ek of emptyKeys) {
        const vals   = samples.map(r => r[ek]).filter(v => v !== '' && v != null);
        const isTime = vals.some(v => looksLikeTime(v));
        if (isTime) {
          if (!hora)    { hora    = ek; }
          else if (!horaEst) { horaEst = ek; break; }
        }
      }
    }

    // ── Estado y Puerta ──────────────────────────────────────────────
    const estado = findIncludes('estado', 'status', 'estatus', 'remark', 'observacion');
    const puerta = findIncludes('puerta', 'gate');

    return { vuelo, aerolinea, iata, ciudad, ciudadDest, hora, horaEst, estado, puerta };
  }

  function looksLikeTime(val) {
    if (typeof val === 'number') return val > 0 && val < 1;  // decimal de Excel
    if (typeof val === 'string') return /^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i.test(val.trim());
    return false;
  }

  function parseExcelTime(val) {
    if (val === '' || val === null || val === undefined) return null;
    if (typeof val === 'number') {
      if (val <= 0 || val >= 1) return null;
      const totalMin = Math.round(val * 24 * 60);
      const h = Math.floor(totalMin / 60) % 24;
      const m = totalMin % 60;
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    const s = String(val).trim();
    const m12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
    if (m12) {
      let h = parseInt(m12[1]);
      const mm = m12[2], ap = m12[3].toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2,'0')}:${mm}`;
    }
    const m24 = s.match(/^(\d{1,2}):(\d{2})/);
    if (m24) return `${m24[1].padStart(2,'0')}:${m24[2]}`;
    return null;
  }

  function mapEstado(raw) {
    const s = (raw||'').toLowerCase().trim();
    if (!s || s === 'a tiempo' || s === 'on time') return 'A tiempo';
    if (s.includes('puerta') || s.includes('gate')) return 'En puerta';
    if (s.includes('abord'))                        return 'Abordando';
    if (s.includes('embarc'))                       return 'Embarcando';
    if (s.includes('aterriz'))                      return 'Aterrizó';
    if (s.includes('despeg'))                       return 'Despegó';
    if (s.includes('demor') || s.includes('delay')) return 'Demorado';
    if (s.includes('cancel'))                       return 'Cancelado';
    if (s.includes('vuelo') || s.includes('flight'))return 'En vuelo';
    return 'A tiempo';
  }

  // ── Reloj en tiempo real ──────────────────────────────────────────
  function startClock() {
    clearInterval(_clockTimer);
    const update = () => { const el = document.getElementById('fids-clock'); if (el) el.textContent = nowTimeStr(); };
    update();
    _clockTimer = setInterval(update, 1000);
  }

  // ── Exportar init (singleton) ─────────────────────────────────────
  let _initialized = false;

  window.initFids = function () {
    if (_initialized) {
      // Ya inicializado: solo refresca los datos
      loadVuelos();
      return;
    }
    _initialized = true;
    init();
  };

})();
