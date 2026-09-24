/**
 * manifiestos-analisis.js
 * Analisis exhaustivo de manifiestos - Tabla: "Base de datos Manifiestos 2025"
 * Sub-pestañas: Resumen | Pasajeros | Aerolíneas | Rutas | Equipaje | Datos
 * v2.1 · Logos de aerolíneas + porcentajes en gráficas
 */
(function () {
  'use strict';

  /* Un botón por AÑO, no por mes.
   *
   * Antes eran cinco: 2025, Febrero 2026, Abril 2026, Junio 2026 y "Mayo 2026
   * en adelante". Cuatro de ellos eran 2026 partido en pedazos, cada uno en su
   * propia tabla, y no había forma de ver el año completo ni de comparar un mes
   * contra otro sin cambiar de botón y perder el contexto. Ahora 2026 es uno
   * solo y los meses salen del filtro "Mes", que es donde se esperan.
   *
   * 2026 se lee de maestra_operaciones, que se llena sola con lo que se captura
   * en Conciliación, el itinerario del AODB y el portal. Los Excel mensuales que
   * se importaron antes de que existiera la maestra siguen listados en
   * respaldoMensual: si a la maestra le falta alguno de esos meses, se rellena
   * con ellos en vez de dejar el hueco (ver rellenaMesesFaltantes). */
  const TABLES = {
    '2025': { name: 'Base de datos Manifiestos 2025', label: '2025 — Año completo' },
    '2026': {
      name: 'maestra_operaciones',
      label: '2026 — Año completo',
      fuente: 'maestra',
      desde: '2026-01-01',
      hasta: '2026-12-31',
      respaldoMensual: {
        2: 'Base de Datos Manifiestos Febrero 2026',
        4: 'Manifiestos',
        6: 'Manifiestos Junio 2026'
      }
    }
  };
  let _activeTableKey = '2026';
  const getTableName  = () => TABLES[_activeTableKey].name;
  const getTableLabel = () => TABLES[_activeTableKey].label;
  const PAGE_SIZE = 50;
  // Cache per table so switching back doesn't re-fetch
  const _dataCache = {};
  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const PAL_12    = ['#0d6efd','#198754','#ffc107','#dc3545','#0dcaf0','#6610f2','#fd7e14','#20c997','#6c757d','#d63384','#0d3b86','#155724'];
  const PAL_7     = ['#0d6efd','#fd7e14','#20c997','#0dcaf0','#d63384','#ffc107','#6c757d'];

  /* -------------------------------------------------------
     LOGOS DE AEROLÍNEAS
     Mapeo nombre → código IATA para obtener logos de Google
  ------------------------------------------------------- */
  const AIRLINE_IATA = {
    'aerom\u00e9xico': 'AM', 'aeromexico': 'AM', 'aeroméxico connect': 'AM',
    'aerolitoral': 'AM', 'aerovias': 'AM', 'aerov\u00edas': 'AM', 'aerovias de mexico': 'AM', 'aerovías de méxico': 'AM',
    'mexicana': 'XN', 'mexicana de aviacion': 'XN', 'mexicana de aviación': 'XN',
    'volaris': 'Y4', 'vuela': 'Y4',
    'vivaaerobus': 'VB', 'viva aerobus': 'VB', 'viva aerob\u00fas': 'VB',
    'arajet': 'DM',
    'aerus': '5A',
    'aeromar': 'VW',
    'american airlines': 'AA', 'american': 'AA',
    'united airlines': 'UA', 'united': 'UA',
    'delta air lines': 'DL', 'delta': 'DL',
    'southwest airlines': 'WN', 'southwest': 'WN',
    'spirit airlines': 'NK', 'spirit': 'NK',
    'frontier airlines': 'F9', 'frontier': 'F9',
    'alaska airlines': 'AS', 'alaska': 'AS',
    'jetblue': 'B6', 'jet blue': 'B6',
    'copa airlines': 'CM', 'copa': 'CM',
    'avianca': 'AV',
    'latam airlines': 'LA', 'latam': 'LA',
    'iberia': 'IB',
    'lufthansa': 'LH',
    'air france': 'AF',
    'klm': 'KL',
    'british airways': 'BA',
    'qatar airways': 'QR', 'qatar': 'QR',
    'emirates': 'EK',
    'turkish airlines': 'TK', 'turkish': 'TK',
    'air canada': 'AC',
    'westjet': 'WJ',
    'sunwing': 'WG',
    'aerol\u00edneas argentinas': 'AR', 'aerolineas argentinas': 'AR',
    'gol': 'G3',
    'azul': 'AD',
    'insel air': '7I',
    'conviasa': 'V0',
    'caribbean airlines': 'BW',
    'interjet': '4O',
    'magnicharters': 'GM', 'magni charters': 'GM',
    'aerocali': 'QA',
    'transportes a\u00e9reos regionales': 'TAR', 'tar aerol\u00edneas': 'TAR', 'tar': 'TAR',
    'abb': 'ABB', 'aerobahn': 'ABB',
    'air transat': 'TS', 'airtransat': 'TS',
    'sunclass airlines': 'DK',
    'condor': 'DE',
    'tui': 'BY', 'tui airways': 'BY',
    'finnair': 'AY',
    'edelweiss air': 'WK',
    'belair': 'BHP',
    'aerob\u00fas': 'BUS',
    'transportes a\u00e9reos guatemaltecos': 'GU', 'tag airlines': 'GU',
  };

  const LOCAL_AIRLINE_LOGOS = {
    'viva aerobus': 'images/airlines/logo_viva.png',
    'vivaaerobus': 'images/airlines/logo_viva.png',
    'volaris': 'images/airlines/logo_volaris.png',
    'mexicana': 'images/airlines/logo_mexicana.png',
    'mexicana de aviacion': 'images/airlines/logo_mexicana.png',
    'mexicana de aviación': 'images/airlines/logo_mexicana.png',
    'aeromexico': 'images/airlines/logo_aeromexico.png',
    'aeromexico connect': 'images/airlines/logo_aeromexico.png',
    'aerolitoral': 'images/airlines/logo_aeromexico.png',
    'aerovias': 'images/airlines/logo_aeromexico.png',
    'aerovias de mexico': 'images/airlines/logo_aeromexico.png',
    'arajet': 'images/airlines/logo_arajet.png',
    'aerus': 'images/airlines/logo_aerus.png'
  };

  const _logoCache = {};  // IATA ? HTMLImageElement

  function normalizeAirlineKey(airlineName) {
    return (airlineName || '')
      .toString()
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  /* Aerolíneas que son la misma empresa con otra razón social.
   *
   * En el manifiesto el capturista escribe lo que dice el documento, y lo que
   * dice es la razón social: los vuelos de Aeroméxico entran como "AEROVÍAS"
   * (Aerovías de México) y como "AEROLITORAL" (Aeroméxico Connect). Contados
   * aparte, la aerolínea más grande del aeropuerto salía partida en pedazos y
   * ninguno decía lo que opera de verdad.
   *
   * El catálogo administrable (tabla airlines, Gestión de Datos → Aerolíneas)
   * ya resuelve aerolitoral y los "connect" por sus alias. Esta tabla cubre lo
   * que al catálogo le falta y sirve de respaldo mientras carga, que es
   * asíncrono: sin ella, el primer dibujado mostraría los nombres sin agrupar.
   */
  const AEROLINEAS_MISMA_EMPRESA = {
    'aerovias': 'Aeroméxico',
    'aerovias de mexico': 'Aeroméxico',
    'aerovias de mexico sa de cv': 'Aeroméxico',
  };

  const _nombreAerolineaCache = new Map();

  /* El nombre bueno de una aerolínea. getAirline lo llama una vez por renglón y
     por gráfica —decenas de miles de veces—, así que se memoiza. */
  function nombreCanonicoAerolinea(valor) {
    const bruto = String(valor === null || valor === undefined ? '' : valor).trim();
    if (!bruto) return '(Sin nombre)';
    const enCache = _nombreAerolineaCache.get(bruto);
    if (enCache) return enCache;

    const desdeTabla = AEROLINEAS_MISMA_EMPRESA[normalizeAirlineKey(bruto)];
    if (desdeTabla) { _nombreAerolineaCache.set(bruto, desdeTabla); return desdeTabla; }

    const catalogo = window.AifaAerolineas;
    // Sin catálogo todavía se devuelve el nombre crudo y NO se guarda: en
    // cuanto cargue hay que poder resolverlo bien.
    if (!catalogo || !catalogo.cargado) return bruto;
    const bueno = catalogo.canonico(bruto) || bruto;
    _nombreAerolineaCache.set(bruto, bueno);
    return bueno;
  }

  // El catálogo llega por su cuenta; cuando llega, se rehace la agrupación.
  window.addEventListener('aifa:catalogo-aerolineas', () => {
    _nombreAerolineaCache.clear();
    if (_loaded && _allData.length) { poblarAerolineas(_allData); applyFilters(); }
  });

  function getIATA(airlineName) {
    const k = normalizeAirlineKey(airlineName);
    return AIRLINE_IATA[k] || null;
  }

  function getLocalLogoPath(airlineName) {
    const k = normalizeAirlineKey(airlineName);
    return LOCAL_AIRLINE_LOGOS[k] || null;
  }

  function logoUrl(iata) {
    return 'https://www.gstatic.com/flights/airline_logos/70px/' + iata + '.png';
  }

  function preloadLogo(iata) {
    if (!iata || _logoCache[iata]) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = logoUrl(iata);
    _logoCache[iata] = img;
  }

  function preloadAirlineLogos(data) {
    const seen = new Set();
    data.forEach(r => {
      const iata = getIATA(getAirline(r));
      if (iata && !seen.has(iata)) { seen.add(iata); preloadLogo(iata); }
    });
  }

  function airlineLogoHTML(name, size) {
    const localLogo = getLocalLogoPath(name);
    if (localLogo) {
      const s = size || 22;
      return '<img src="' + localLogo + '" alt="' + escHtml(name || 'logo') + '"'
        + ' style="width:' + s + 'px;height:' + s + 'px;object-fit:contain;border-radius:4px;margin-right:5px;vertical-align:middle;background:#f8f9fa;"'
        + ' onerror="this.style.display=\'none\'">';
    }
    const iata = getIATA(name);
    if (!iata) return '';
    const s = size || 22;
    return '<img src="' + logoUrl(iata) + '" alt="' + iata + '"'
      + ' style="width:' + s + 'px;height:' + s + 'px;object-fit:contain;border-radius:4px;margin-right:5px;vertical-align:middle;background:#f8f9fa;"'
      + ' onerror="this.style.display=\'none\'">';
  }

  /* Custom Chart.js plugin: dibuja logos en eje Y de gráficas horizontales */
  const airlineLogoPlugin = {
    id: 'airlineLogos',
    afterDraw(chart, args, opts) {
      if (!opts || !opts.enabled) return;
      const ctx = chart.ctx;
      const yAxis = chart.scales.y;
      if (!yAxis) return;
      yAxis.ticks.forEach((tick, i) => {
        const label = Array.isArray(tick.label) ? tick.label.join(' ') : (tick.label || '');
        const iata = getIATA(label);
        if (!iata) return;
        const img = _logoCache[iata];
        if (!img || !img.complete || img.naturalWidth === 0) return;
        const y = yAxis.getPixelForTick(i);
        const size = opts.size || 20;
        const x = yAxis.left - size - (opts.gap || 6);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x, y - size / 2, size, size);
        ctx.restore();
      });
    }
  };
  // Registrar el plugin globalmente
  if (window.Chart) { Chart.register(airlineLogoPlugin); aplicaTemaCharts(); }
  else document.addEventListener('DOMContentLoaded', () => {
    if (window.Chart) { Chart.register(airlineLogoPlugin); aplicaTemaCharts(); }
  });

  /* -------------------------------------------------------
     UN SOLO AIRE PARA TODAS LAS GRÁFICAS

     Eran veinte gráficas y cada una repetía sus propias opciones, así que ni
     las rejillas ni los tooltips ni las tipografías coincidían entre pestañas.
     Esto se toca una vez y las alcanza a todas; lo que una gráfica necesite
     distinto lo sigue pudiendo pedir en sus propias opciones.
  ------------------------------------------------------- */
  function aplicaTemaCharts() {
    if (!window.Chart || !Chart.defaults || !Chart.defaults.font) return;
    const C = Chart.defaults;

    C.font.family = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
    C.font.size = 11;
    C.color = '#667085';
    C.borderColor = 'rgba(16,24,40,.07)';
    C.maintainAspectRatio = false;

    // Entrada corta: lo justo para que se sienta viva sin hacer esperar.
    C.animation.duration = 650;
    C.animation.easing = 'easeOutQuart';

    // Leyendas de puntitos en vez de rectángulos: pesan menos en pantalla.
    Object.assign(C.plugins.legend.labels, {
      usePointStyle: true, pointStyle: 'circle',
      boxWidth: 8, boxHeight: 8, padding: 14,
      font: { size: 11, weight: '600' }
    });

    // Tooltip oscuro flotante: se lee sobre cualquier color de barra.
    Object.assign(C.plugins.tooltip, {
      backgroundColor: 'rgba(16,24,40,.93)',
      titleColor: '#ffffff',
      titleFont: { size: 12, weight: '700' },
      bodyColor: '#e4e7ec',
      bodyFont: { size: 11.5 },
      footerColor: '#98a2b3',
      footerFont: { size: 10.5, weight: '600' },
      padding: 11,
      cornerRadius: 9,
      boxPadding: 5,
      usePointStyle: true,
      borderColor: 'rgba(255,255,255,.09)',
      borderWidth: 1
    });

    C.elements.bar.borderRadius = 6;
    C.elements.bar.borderSkipped = false;
    C.elements.line.tension = 0.35;
    C.elements.line.borderWidth = 2.5;
    C.elements.point.radius = 3;
    C.elements.point.hoverRadius = 6;
    C.elements.point.hoverBorderWidth = 2;

    // Rejilla apenas insinuada y sin el marco del eje: la referencia se
    // agradece, el encierro no.
    if (C.scale) {
      if (C.scale.grid) {
        C.scale.grid.color = 'rgba(16,24,40,.055)';
        C.scale.grid.drawTicks = false;
      }
      if (C.scale.border) C.scale.border.display = false;
      if (C.scale.ticks) C.scale.ticks.padding = 8;
    }
  }

  /* Degradado para las barras: el color plano se ve chato, y con el relleno
     más intenso arriba la barra "pesa" hacia donde está el dato.
     Se usa como función porque en el primer dibujado todavía no hay área. */
  function conAlfa(hex, alfa) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alfa + ')';
  }

  function degradado(chart, hex, horizontal) {
    const area = chart && chart.chartArea;
    if (!area) return conAlfa(hex, .85);
    const g = horizontal
      ? chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
      : chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, conAlfa(hex, horizontal ? .60 : .98));
    g.addColorStop(1, conAlfa(hex, horizontal ? .98 : .58));
    return g;
  }

  /* backgroundColor listo para pasarle a un dataset. */
  const relleno    = (hex) => (c) => degradado(c.chart, hex, false);
  const rellenoH   = (hex) => (c) => degradado(c.chart, hex, true);
  const rellenoPal = (pal) => (c) => degradado(c.chart, pal[c.dataIndex % pal.length], true);


  /* -------------------------------------------------------
     COLUMNAS REALES
  ------------------------------------------------------- */
  const col = (r, ...keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

  const getDir      = r => col(r, 'TIPO DE MANIFIESTO') || '';
  const getAirline  = r => nombreCanonicoAerolinea(col(r, 'AEROLINEA', 'aerolinea'));
  const getOpType   = r => col(r, 'TIPO DE OPERACION', 'TIPO DE OPERACION ') || col(r, 'TIPO DE OPERACI\u00d3N') || col(r, 'TIPO DE OPERACI\u00f3N') || '';
  const getFlight   = r => col(r, '# DE VUELO') || '';
  const getRoute    = r => col(r, 'DESTINO / ORIGEN') || '';
  const getFecha    = r => col(r, 'FECHA', 'fecha') || '';
  const getMes      = r => col(r, 'MES', 'mes') || '';

  /* Extrae la hora (0-23) preferentemente de la columna HR. DE OPERACIÓN */
  function getHour(r) {
    // Columna principal: HR. DE OPERACIÓN (y variantes de escritura)
    const raw = col(r, 'HR. DE OPERACI\u00d3N', 'HR. DE OPERACION', 'HR DE OPERACION', 'HR DE OPERACI\u00d3N',
                       'HORA DE OPERACI\u00d3N', 'HORA DE OPERACION', 'HORA OPERACION',
                       'HR. OPERACI\u00d3N', 'HR. OPERACION',
                       'SLOT ASIGNADO', 'SLOT COORDINADO',
                       'HORA DE INICIO O TERMINO DE PERNOCTA', 'HORA DE RECEPCI\u00d3N', 'HORA DE RECEPCION');
    if (raw) {
      const s = String(raw).trim();
      // HH:MM o HH:MM:SS
      const m1 = s.match(/^(\d{1,2}):(\d{2})/);
      if (m1) return parseInt(m1[1], 10);
      // HHMM numérico (e.g. "0830")
      const m2 = s.match(/^(\d{3,4})$/);
      if (m2) return parseInt(s.length === 3 ? s[0] : s.substring(0, 2), 10);
      // Datetime con T o espacio: "2025-12-20T14:30" / "2025-12-20 14:30"
      const m3 = s.match(/[T ](\d{1,2}):(\d{2})/);
      if (m3) return parseInt(m3[1], 10);
    }
    // Fallback: si FECHA contiene hora
    const fecha = getFecha(r);
    if (fecha) {
      const m = String(fecha).match(/[T ](\d{1,2}):(\d{2})/);
      if (m) return parseInt(m[1], 10);
    }
    return -1; // sin dato
  }

  /* Extrae minuto del día (0..1439) para análisis de simultaneidad */
  function getMinuteOfDay(r) {
    const raw = col(r, 'HR. DE OPERACIÓN', 'HR. DE OPERACION', 'HR DE OPERACION', 'HR DE OPERACIÓN',
                       'HORA DE OPERACIÓN', 'HORA DE OPERACION', 'HORA OPERACION',
                       'HR. OPERACIÓN', 'HR. OPERACION',
                       'SLOT ASIGNADO', 'SLOT COORDINADO',
                       'HORA DE INICIO O TERMINO DE PERNOCTA', 'HORA DE RECEPCIÓN', 'HORA DE RECEPCION');
    const parseToMinute = (val) => {
      if (!val) return -1;
      const s = String(val).trim();
      // HH:MM o HH:MM:SS
      const m1 = s.match(/^(\d{1,2}):(\d{2})/);
      if (m1) {
        const hh = parseInt(m1[1], 10), mm = parseInt(m1[2], 10);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return (hh * 60) + mm;
      }
      // HHMM numérico (e.g. 0830)
      const m2 = s.match(/^(\d{3,4})$/);
      if (m2) {
        const hh = parseInt(s.length === 3 ? s[0] : s.substring(0, 2), 10);
        const mm = parseInt(s.length === 3 ? s.substring(1, 3) : s.substring(2, 4), 10);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return (hh * 60) + mm;
      }
      // Datetime con T o espacio: YYYY-MM-DDTHH:MM
      const m3 = s.match(/[T ](\d{1,2}):(\d{2})/);
      if (m3) {
        const hh = parseInt(m3[1], 10), mm = parseInt(m3[2], 10);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return (hh * 60) + mm;
      }
      return -1;
    };

    const fromRaw = parseToMinute(raw);
    if (fromRaw >= 0) return fromRaw;

    // Fallback: FECHA con hora
    const fromFecha = parseToMinute(getFecha(r));
    return fromFecha;
  }

  const ni = v => parseInt(v, 10) || 0;
  const getPaxTotal   = r => ni(col(r, 'TOTAL PAX', 'TOTALPAX', 'total_pax'));
  const getPaxTUA     = r => ni(col(r, 'PAX QUE PAGAN TUA', 'PAX. QUE PAGAN TUA', 'PAXQUEPAGANTUA', 'pax_que_pagan_tua'));
  const getPaxInf     = r => ni(col(r, 'INFANTES', 'infantes'));
  const getPaxTrans   = r => ni(col(r, 'TRANSITOS', 'transitos'));
  const getPaxConex   = r => ni(col(r, 'CONEXIONES', 'conexiones'));
  const getPaxDip     = r => ni(col(r, 'DIPLOMATICOS', 'diplomaticos'));
  const getPaxEnCom   = r => ni(col(r, 'EN COMISION', 'ENCOMISION', 'en_comision'));
  const getPaxOtros   = r => ni(col(r, 'OTROS EXENTOS', 'OTROSEXENTOS', 'otros_exentos'));
  const getPaxExent   = r => ni(col(r, 'TOTAL EXENTOS', 'TOTALEXENTOS', 'total_exentos'));
  const getKgs        = r => ni(col(r, 'KGS DE EQUIPAJE', 'KGS. DE EQUIPAJE', 'KGS.DEEQUIPAJE', 'kgs_de_equipaje'));
  const getPuntual    = r => col(r, 'PUNTUALIDAD CANCELACION', 'PUNTUALIDAD / CANCELACIÓN', 'PUNTUALIDAD / CANCELACION', 'puntualidad_cancelacion') || '';
  const getMatricula  = r => col(r, 'MATRICULA', 'matricula') || '';
  const getAeronave   = r => col(r, 'AERONAVE', 'aeronave') || '';
  const getEstatus    = r => col(r, 'ESTATUS MATRICULA', 'ESTATUS MATRÍCULA', 'estatus_matricula') || '';

  const isArr = r => getDir(r).toLowerCase().includes('llegada');
  const isDep = r => getDir(r).toLowerCase().includes('salida');
  const isDom = r => { const ot = getOpType(r).toLowerCase(); return ot.includes('dom') || (ot.includes('nac') && !ot.includes('int')); };
  const isInt = r => getOpType(r).toLowerCase().includes('int');

  function parseFecha(r) {
    const raw = getFecha(r); if (!raw) return { year: '', monthIdx: -1 };
    const p = raw.split(/[-\/]/);
    if (p.length < 3) return { year: '', monthIdx: -1 };
    const year = p[0].length === 4 ? p[0] : p[2];
    const mon  = parseInt(p[0].length === 4 ? p[1] : p[1], 10);
    return { year, monthIdx: mon - 1 };
  }
  function mesIdxFromName(name) {
    return MONTHS_ES.findIndex(m => m.toLowerCase() === (name || '').toLowerCase().trim());
  }
  function getMonthIdx(r) {
    const mesName = getMes(r);
    let idx = mesName ? mesIdxFromName(mesName) : -1;
    if (idx < 0) idx = parseFecha(r).monthIdx;
    return idx;
  }

  const fmt     = n => (n != null ? Number(n).toLocaleString('es-MX') : '-');
  const pct     = (a, b) => b ? ((a / b) * 100).toFixed(1) + '%' : '-';
  const pctNum  = (a, b) => b ? (a / b) * 100 : 0;
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tickK   = v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'k' : v;

  /* Opciones de datalabels para pies — etiquetas externas con nombre y % */
  function datalabelsPiePct(total) {
    return {
      display: true,
      anchor: 'end',
      align: 'end',
      offset: 6,
      clip: false,
      color: (ctx) => {
        const bg = ctx.dataset.backgroundColor;
        return Array.isArray(bg) ? (bg[ctx.dataIndex] || '#495057') : '#495057';
      },
      font: { weight: 'bold', size: 11 },
      textStrokeColor: '#fff',
      textStrokeWidth: 3,
      formatter: (value, ctx) => {
        const p = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
        if (parseFloat(p) < 2) return null;
        const label = (ctx.chart.data.labels || [])[ctx.dataIndex] || '';
        return label + ' (' + p + '%)';
      }
    };
  }

  /* Datalabels para barras horizontales mostrando % del total */
  function datalabelsBarPct(total) {
    return {
      display: true,
      anchor: 'end',
      align: 'end',
      color: '#495057',
      font: { size: 10 },
      formatter: (value) => {
        const p = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
        return parseFloat(p) > 0.3 ? p + '%' : '';
      }
    };
  }

  /* -------------------------------------------------------
     ESTADO
  ------------------------------------------------------- */
  let _allData = [], _filtered = [], _tableData = [];
  let _currentPage = 1, _charts = {}, _loaded = false;

  function switchMdbPeriod(tableKey) {
    if (_activeTableKey === tableKey) return;
    _activeTableKey = tableKey;
    // Save current data to cache, restore if already fetched
    _loaded = false;
    _allData = [];
    if (_dataCache[tableKey]) {
      _allData = _dataCache[tableKey];
      _loaded  = true;
    }
    // Update UI buttons
    document.querySelectorAll('.mdb-period-btn').forEach(b => {
      const isActive = b.dataset.table === TABLES[tableKey].name;
      b.className = b.className
        .replace('btn-primary','btn-outline-primary')
        .replace('btn-outline-primary btn-outline-primary','btn-outline-primary'); // dedup
      if (isActive) b.className = b.className.replace('btn-outline-primary','btn-primary');
    });
    const lbl = document.getElementById('mdb-period-label');
    if (lbl) lbl.textContent = getTableLabel();
    limpiarAerolineas();
    syncOrigenFilter(_allData);
    // Reload
    load();
  }

  /* -------------------------------------------------------
     INIT
  ------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    // Desactivar datalabels globalmente por defecto (sólo activar donde queremos)
    if (window.Chart && window.ChartDataLabels) {
      Chart.unregister(ChartDataLabels);
    }

    // El botón "Aplicar" ya no existe; el listener se queda por si alguna
    // pantalla vieja todavía lo trae.
    document.getElementById('mdb-btn-apply-filters')?.addEventListener('click', applyFilters);
    document.getElementById('mdb-btn-clear-filters')?.addEventListener('click', clearFilters);
    // Año, mes, dirección, tipo de operación y registros: al cambiarlos se
    // filtra solo. Dirección y tipo son botones que escriben en un <select>
    // oculto, por eso avisan con un evento "change" desde index.html.
    ['mdb-filter-year', 'mdb-filter-month', 'mdb-filter-direction', 'mdb-filter-optype', 'mdb-filter-origen']
      .forEach(id => document.getElementById(id)?.addEventListener('change', applyFiltersPronto));
    document.getElementById('mdb-btn-export')?.addEventListener('click', exportExcel);
    document.getElementById('mdb-btn-reload')?.addEventListener('click', () => {
      _loaded = false; _allData = [];
      delete _dataCache[_activeTableKey];
      limpiarAerolineas();
      load();
    });
    document.querySelectorAll('.mdb-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tableKey = Object.keys(TABLES).find(k => TABLES[k].name === btn.dataset.table);
        if (tableKey) switchMdbPeriod(tableKey);
      });
    });
    let _st;
    document.getElementById('mdb-search-input')?.addEventListener('input', e => {
      clearTimeout(_st); _st = setTimeout(() => filterTable(e.target.value), 250);
    });
    const tabBtn = document.getElementById('aops-tab-manifiestos');
    if (tabBtn) {
      tabBtn.addEventListener('shown.bs.tab', () => { if (!_loaded) load(); });
      tabBtn.addEventListener('click', () => { setTimeout(() => { if (!_loaded) load(); }, 400); });
    }
    document.querySelectorAll('#mdb-sub-tabs button[data-bs-toggle="tab"]').forEach(btn => {
      btn.addEventListener('shown.bs.tab', () => { if (_loaded && _filtered.length > 0) renderActiveSubTab(); });
    });
    initAerolineasPicker();
    setTimeout(tryPreload, 100);
  });

  function tryPreload() {
    if (window.supabaseClient) { load(); return; }
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (window.supabaseClient) { clearInterval(iv); load(); }
      else if (tries >= 30)      { clearInterval(iv); }
    }, 500);
  }

  /* -------------------------------------------------------
     CARGA
  ------------------------------------------------------- */
  async function load() {
    if (_loaded) { applyFilters(); return; }
    hideBanner();
    showOverlay('Cargando manifiestos...');
    try {
      const client = window.supabaseClient;
      if (!client) throw new Error('Supabase no disponible — inicia sesión primero');
      const periodo = TABLES[_activeTableKey];

      const all = periodo.fuente === 'maestra'
        ? await fetchMaestra(client, periodo)
        : await fetchTablaImportada(client, periodo.name);

      _allData = all; _loaded = true;
      _dataCache[_activeTableKey] = all;
      if (all.length > 0) {
        console.log('[ManifiestosBD] Columnas del período "' + periodo.label + '":', Object.keys(all[0]));
        console.log('[ManifiestosBD] Primera fila de muestra:', all[0]);
      }
      syncOrigenFilter(all);
      if (all.length === 0) { showBanner('info', 'No hay registros para este período, o RLS bloquea la lectura.'); hideOverlay(); return; }
      preloadAirlineLogos(all);
      poblarAerolineas(all);
      applyFilters();
    } catch (err) {
      console.error('[ManifiestosBD]', err);
      showBanner('danger', 'Error al cargar: <strong>' + escHtml(err.message || String(err)) + '</strong>');
    } finally { hideOverlay(); }
  }

  /* Las tablas que se importaron de Excel: se leen enteras, tal cual. */
  async function fetchTablaImportada(client, tableName) {
    const BS = 1000;
    // 1. Obtener el total de registros con una sola petición HEAD
    setOverlayText('Consultando registros...');
    const { count, error: countErr } = await client.from(tableName).select('*', { count: 'exact', head: true });
    if (countErr) throw countErr;
    const total = Math.min(count || 0, 200000);

    // 2. Descargar todas las páginas en paralelo
    const pages = Math.ceil(total / BS);
    setOverlayText('Descargando ' + total.toLocaleString() + ' registros en ' + pages + ' lotes...');
    const requests = Array.from({ length: pages }, (_, i) =>
      client.from(tableName).select('*').range(i * BS, (i + 1) * BS - 1)
    );
    const results = await Promise.all(requests);
    const errors = results.filter(r => r.error);
    if (errors.length) throw errors[0].error;
    return results.flatMap(r => r.data || []);
  }

  /* maestra_operaciones, de una fecha en adelante.
   *
   * Es la tabla viva: consolida Conciliación Manifiestos, el itinerario del
   * AODB y los manifiestos del portal en un renglón por operación. No se lee
   * entera —son todos los años— sino del corte del período hacia adelante, y
   * sólo las columnas que las gráficas usan (ver ManifiestosMaestra.COLUMNAS:
   * pedir "*" arrastraría datos_origen, el renglón completo del AODB en jsonb).
   * Los renglones salen traducidos al vocabulario de los manifiestos, así que
   * las ocho sub-pestañas no se enteran de que cambió la fuente. */
  async function fetchMaestra(client, periodo) {
    const BS = 1000;
    setOverlayText('Consultando operaciones de ' + periodo.label + '...');
    // El período es un año cerrado: sin el tope de arriba, "2026" arrastraría
    // también lo que ya se haya capturado de 2027.
    const acota = (q) => {
      q = q.gte('fecha_operacion', periodo.desde);
      return periodo.hasta ? q.lte('fecha_operacion', periodo.hasta) : q;
    };
    const { count, error: countErr } = await acota(
      client.from(periodo.name).select('id', { count: 'exact', head: true })
    );
    if (countErr) throw countErr;
    const total = Math.min(count || 0, 200000);
    if (!total) return [];

    const pages = Math.ceil(total / BS);
    setOverlayText('Descargando ' + total.toLocaleString() + ' operaciones en ' + pages + ' lotes...');
    const columnas = ManifiestosMaestra.COLUMNAS.join(',');
    const requests = Array.from({ length: pages }, (_, i) =>
      acota(client.from(periodo.name).select(columnas))
        // El orden tiene que ser total y estable: los lotes se piden en
        // paralelo y sin un desempate (el id) dos de ellos pueden traer el
        // mismo renglón y dejar otro fuera.
        .order('fecha_operacion', { ascending: true })
        .order('id', { ascending: true })
        .range(i * BS, (i + 1) * BS - 1)
    );
    const results = await Promise.all(requests);
    const errors = results.filter(r => r.error);
    if (errors.length) throw errors[0].error;
    const crudas = results.flatMap(r => r.data || []);

    setOverlayText('Preparando ' + crudas.length.toLocaleString() + ' operaciones...');
    const paisesPorIata = await fetchPaisesPorIata(client);
    const catalogo = window.AifaAerolineas;
    if (catalogo && typeof catalogo.cargar === 'function') {
      try { await catalogo.cargar(client); } catch (_) { /* el catálogo ayuda, no bloquea */ }
    }
    const filas = ManifiestosMaestra.mapearFilas(crudas, {
      nombreAerolinea: catalogo ? (n => catalogo.canonico(n)) : null,
      paisesPorIata
    });
    return rellenaMesesFaltantes(client, periodo, filas);
  }

  /* Los meses que la maestra no tiene, traídos de su Excel de entonces.
   *
   * La maestra empezó a llenarse a media 2026; los meses anteriores viven en
   * las tablas que se importaron una por una. En vez de obligar a cambiar de
   * botón para verlos, se rellenan los huecos: sólo se pide la tabla del mes
   * si la maestra no trajo NI UN renglón de ese mes, así que no hay forma de
   * contar un vuelo dos veces. */
  async function rellenaMesesFaltantes(client, periodo, filas) {
    const respaldo = periodo.respaldoMensual;
    if (!respaldo) return filas;

    const conDatos = new Set(filas.map(r => (r['FECHA'] || '').slice(0, 7)).filter(Boolean));
    const anio = periodo.desde.slice(0, 4);
    const faltantes = Object.keys(respaldo)
      .map(Number)
      .filter(mes => !conDatos.has(anio + '-' + String(mes).padStart(2, '0')));
    if (!faltantes.length) return filas;

    setOverlayText('Completando ' + faltantes.length + ' mes(es) desde los Excel importados...');
    const extra = await Promise.all(faltantes.map(async (mes) => {
      try {
        const datos = await fetchTablaImportada(client, respaldo[mes]);
        console.info('[ManifiestosBD] La maestra no tiene ' + MONTHS_ES[mes - 1] + ' ' + anio
          + '; se completó con "' + respaldo[mes] + '" (' + datos.length + ' registros).');
        return datos;
      } catch (err) {
        // Que falte un respaldo no puede tumbar el año entero.
        console.warn('[ManifiestosBD] No se pudo leer el respaldo de ' + MONTHS_ES[mes - 1] + ':', err.message || err);
        return [];
      }
    }));
    return filas.concat(...extra);
  }

  /* IATA → país, para saber si una operación fue nacional o internacional
     cuando el manifiesto no trae capturado el tipo. */
  let _paisesPorIata = null;
  async function fetchPaisesPorIata(client) {
    if (_paisesPorIata) return _paisesPorIata;
    const mapa = new Map();
    try {
      const { data, error } = await client.from('catalogo_aeropuertos').select('iata,pais').limit(20000);
      if (!error) (data || []).forEach(r => {
        const iata = String((r && r.iata) || '').trim().toUpperCase();
        const pais = String((r && r.pais) || '').trim();
        if (iata && pais) mapa.set(iata, pais);
      });
    } catch (_) { /* sin catálogo el tipo de operación se queda en blanco, no se inventa */ }
    _paisesPorIata = mapa;
    return mapa;
  }

  /* El filtro de "Registros" sólo tiene sentido en la maestra, donde conviven
     los manifiestos capturados con los vuelos que el itinerario ya programó
     pero nadie ha conciliado. Se muestra con el conteo de cada grupo para que
     se vea de dónde salen las cifras. */
  function syncOrigenFilter(rows) {
    const wrap = document.getElementById('mdb-filter-origen-wrap');
    const sel = document.getElementById('mdb-filter-origen');
    if (!wrap || !sel) return;
    const esMaestra = TABLES[_activeTableKey].fuente === 'maestra';
    wrap.classList.toggle('d-none', !esMaestra);
    if (!esMaestra) { sel.value = ''; return; }

    const conManifiesto = (rows || []).filter(r => !r._origen || r._origen === 'manifiesto').length;
    const programados = (rows || []).length - conManifiesto;
    const etiqueta = (base, n) => base + ' (' + fmt(n) + ')';
    [...sel.options].forEach(o => {
      if (o.value === 'manifiesto') o.textContent = etiqueta('Con manifiesto', conManifiesto);
      else if (o.value === 'itinerario') o.textContent = etiqueta('Sólo programados', programados);
      else o.textContent = etiqueta('Todos los registros', (rows || []).length);
    });
    if (!sel.value) sel.value = 'manifiesto';
  }

  /* -------------------------------------------------------
     FILTRADO
  ------------------------------------------------------- */
  function applyFilters() {
    const year    = document.getElementById('mdb-filter-year')?.value    || '';
    const monthN  = document.getElementById('mdb-filter-month')?.value   || '';
    const dir     = document.getElementById('mdb-filter-direction')?.value || '';
    const optype  = document.getElementById('mdb-filter-optype')?.value  || '';
    // Las marcadas viajan en el input oculto separadas por "|": así el badge
    // de filtros activos las sigue contando sin saber nada de este selector.
    const aerolineas = (document.getElementById('mdb-filter-airline')?.value || '')
      .split('|').filter(Boolean);
    const origen  = document.getElementById('mdb-filter-origen')?.value  || '';
    const monthName = monthN ? MONTHS_ES[parseInt(monthN, 10) - 1] : '';

    _filtered = _allData.filter(r => {
      if (year) { const { year: ry } = parseFecha(r); if (String(ry) !== String(year)) return false; }
      if (monthName) {
        const mesCol = getMes(r);
        if (mesCol) { if (!mesCol.toLowerCase().includes(monthName.toLowerCase())) return false; }
        else { if (parseFecha(r).monthIdx !== parseInt(monthN, 10) - 1) return false; }
      }
      if (dir    && !getDir(r).toLowerCase().includes(dir.toLowerCase()))       return false;
      // Con includes() a secas, "Nacional" dejaba pasar también a las
      // internacionales: "internacional" contiene "nacional". isDom/isInt ya
      // distinguen las dos, y son las mismas reglas que cuentan los KPIs.
      if (optype) {
        const quiereInt = optype.toLowerCase().includes('int');
        if (quiereInt ? !isInt(r) : !isDom(r)) return false;
      }
      if (aerolineas.length && aerolineas.indexOf(getAirline(r)) === -1) return false;
      // _origen sólo lo traen los renglones de la maestra; en las tablas
      // importadas viene indefinido y el filtro no les aplica.
      if (origen && r._origen && r._origen !== origen) return false;
      return true;
    });
    _currentPage = 1;
    renderAll();
  }

  let _tFiltros = null;

  /* Los filtros ya no necesitan botón: se aplican al moverlos.
     Se agrupan con un respiro corto para no redibujar todas las gráficas dos
     veces cuando alguien cambia dos selectores seguidos, que sobre cincuenta
     mil renglones se nota. */
  function applyFiltersPronto() {
    clearTimeout(_tFiltros);
    _tFiltros = setTimeout(applyFilters, 60);
  }

  function clearFilters() {
    ['mdb-filter-year','mdb-filter-month','mdb-filter-direction','mdb-filter-optype']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    limpiarAerolineas();
    const s = document.getElementById('mdb-search-input'); if (s) s.value = '';
    const origen = document.getElementById('mdb-filter-origen');
    if (origen) origen.value = TABLES[_activeTableKey].fuente === 'maestra' ? 'manifiesto' : '';
    applyFilters();
  }

  /* -------------------------------------------------------
     SELECTOR DE AEROLÍNEAS (varias a la vez)

     Antes era un <select> de una sola opción: para comparar Volaris contra
     Viva Aerobús había que mirar dos veces y sumar a mano. Ahora se marcan las
     que se quieran y todas las gráficas responden a esa selección.
  ------------------------------------------------------- */
  let _aerolineasSel = new Set();   // nombres canónicos marcados
  let _aerolineasDisp = [];         // [{ nombre, vuelos }] del período cargado
  let _aerolineasBusqueda = '';

  const elAerolineas = () => ({
    caja:    document.getElementById('mdb-airline-picker'),
    oculto:  document.getElementById('mdb-filter-airline'),
    boton:   document.getElementById('mdb-airline-trigger'),
    panel:   document.getElementById('mdb-airline-panel'),
    etiqueta:document.getElementById('mdb-airline-label'),
    logos:   document.getElementById('mdb-airline-logos'),
    lista:   document.getElementById('mdb-airline-list'),
    chips:   document.getElementById('mdb-airline-chips'),
    buscar:  document.getElementById('mdb-airline-search'),
    conteo:  document.getElementById('mdb-airline-count')
  });

  /* Logo de la aerolínea y, si no tiene, sus iniciales sobre el color de la
     marca: un renglón de puro texto se pierde entre los demás. */
  function aerolineaAvatarHTML(nombre, tam) {
    const logo = airlineLogoHTML(nombre, tam);
    if (logo) return logo;
    const catalogo = window.AifaAerolineas;
    const iniciales = catalogo ? catalogo.iniciales(nombre) : String(nombre || '?').slice(0, 3).toUpperCase();
    const color = (catalogo && catalogo.color(nombre)) || '#8a93b8';
    return '<span class="mdb-al-ini" style="width:' + tam + 'px;height:' + tam + 'px;background:' + escHtml(color) + '">'
      + escHtml(iniciales) + '</span>';
  }

  /* Arma la lista del período cargado, con cuántos vuelos trae cada una: el
     número es lo que dice de un vistazo a quién vale la pena mirar. */
  function poblarAerolineas(rows) {
    const conteo = new Map();
    (rows || []).forEach(r => {
      const nombre = getAirline(r);
      conteo.set(nombre, (conteo.get(nombre) || 0) + 1);
    });
    _aerolineasDisp = [...conteo.entries()]
      .map(([nombre, vuelos]) => ({ nombre, vuelos }))
      .sort((a, b) => b.vuelos - a.vuelos || a.nombre.localeCompare(b.nombre, 'es'));

    // Al cambiar de período puede desaparecer una aerolínea que estaba marcada.
    const existentes = new Set(_aerolineasDisp.map(a => a.nombre));
    _aerolineasSel = new Set([..._aerolineasSel].filter(n => existentes.has(n)));
    renderAerolineas();
  }

  function renderAerolineas() {
    const el = elAerolineas();
    if (!el.caja || !el.lista) return;

    const marcadas = [..._aerolineasSel];
    if (el.oculto) el.oculto.value = marcadas.join('|');

    // Botón: hasta dos logos encimados y el texto de la selección.
    if (el.logos) {
      el.logos.innerHTML = marcadas.slice(0, 3).map(n => aerolineaAvatarHTML(n, 18)).join('');
    }
    if (el.etiqueta) {
      el.etiqueta.textContent = marcadas.length === 0
        ? 'Todas las aerolíneas'
        : (marcadas.length === 1 ? marcadas[0] : marcadas.length + ' aerolíneas');
    }
    if (el.conteo) {
      el.conteo.textContent = marcadas.length
        ? marcadas.length + ' de ' + _aerolineasDisp.length
        : _aerolineasDisp.length + ' en el período';
    }

    // Chips: se ve cuáles son y se quitan de una sin abrir el panel.
    if (el.chips) {
      el.chips.innerHTML = marcadas.length < 2 ? '' : marcadas.map(n =>
        '<span class="mdb-al-chip">' + aerolineaAvatarHTML(n, 14)
        + '<span>' + escHtml(n) + '</span>'
        + '<button type="button" data-mdb-al-quitar="' + escHtml(n) + '" aria-label="Quitar ' + escHtml(n) + '">'
        + '<i class="fas fa-times"></i></button></span>'
      ).join('');
    }

    const q = normalizeAirlineKey(_aerolineasBusqueda);
    const visibles = q ? _aerolineasDisp.filter(a => normalizeAirlineKey(a.nombre).includes(q)) : _aerolineasDisp;
    el.lista.innerHTML = visibles.length ? visibles.map(a => {
      const on = _aerolineasSel.has(a.nombre);
      return '<button type="button" role="option" aria-selected="' + on + '"'
        + ' class="mdb-al-row' + (on ? ' is-on' : '') + '" data-mdb-al="' + escHtml(a.nombre) + '">'
        + '<span class="mdb-al-box">' + (on ? '<i class="fas fa-check"></i>' : '') + '</span>'
        + aerolineaAvatarHTML(a.nombre, 22)
        + '<span class="mdb-al-name">' + escHtml(a.nombre) + '</span>'
        + '<span class="mdb-al-n">' + fmt(a.vuelos) + '</span>'
        + '</button>';
    }).join('') : '<div class="mdb-al-empty">Ninguna aerolínea coincide con la búsqueda.</div>';
  }

  function abrirAerolineas(abrir) {
    const el = elAerolineas();
    if (!el.caja || !el.panel || !el.boton) return;
    el.caja.classList.toggle('is-open', abrir);
    el.panel.hidden = !abrir;
    el.boton.setAttribute('aria-expanded', String(abrir));
    if (abrir && el.buscar) setTimeout(() => el.buscar.focus(), 0);
  }

  function limpiarAerolineas() {
    _aerolineasSel = new Set();
    _aerolineasBusqueda = '';
    const el = elAerolineas();
    if (el.buscar) el.buscar.value = '';
    renderAerolineas();
  }

  function initAerolineasPicker() {
    const el = elAerolineas();
    if (!el.caja) return;

    el.boton?.addEventListener('click', () => abrirAerolineas(el.panel.hidden));

    // Marcar y desmarcar sin que se cierre el panel: la gracia es elegir varias.
    el.lista?.addEventListener('click', (ev) => {
      const fila = ev.target.closest('[data-mdb-al]');
      if (!fila) return;
      const nombre = fila.dataset.mdbAl;
      if (_aerolineasSel.has(nombre)) _aerolineasSel.delete(nombre);
      else _aerolineasSel.add(nombre);
      renderAerolineas();
      applyFiltersPronto();
    });

    el.chips?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-mdb-al-quitar]');
      if (!btn) return;
      _aerolineasSel.delete(btn.dataset.mdbAlQuitar);
      renderAerolineas();
      applyFiltersPronto();
    });

    el.panel?.querySelectorAll('[data-mdb-al-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mdbAlAct === 'todas') {
          // "Todas" marca lo que se está viendo, que con búsqueda activa es el
          // subconjunto filtrado; sin búsqueda, todas.
          const q = normalizeAirlineKey(_aerolineasBusqueda);
          _aerolineasDisp
            .filter(a => !q || normalizeAirlineKey(a.nombre).includes(q))
            .forEach(a => _aerolineasSel.add(a.nombre));
        } else {
          _aerolineasSel = new Set();
        }
        renderAerolineas();
        applyFiltersPronto();
      });
    });

    let _tb;
    el.buscar?.addEventListener('input', (ev) => {
      clearTimeout(_tb);
      _aerolineasBusqueda = ev.target.value;
      _tb = setTimeout(renderAerolineas, 120);
    });

    document.addEventListener('click', (ev) => {
      if (!el.caja.contains(ev.target)) abrirAerolineas(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el.panel.hidden) { abrirAerolineas(false); el.boton.focus(); }
    });

    renderAerolineas();
  }

  function filterTable(query) {
    if (!query) { renderTable(_filtered); return; }
    const q = query.toLowerCase();
    const res = _filtered.filter(r =>
      getAirline(r).toLowerCase().includes(q) ||
      String(col(r, 'AEROLINEA', 'aerolinea') || '').toLowerCase().includes(q) ||
      getFlight(r).toLowerCase().includes(q) ||
      getDir(r).toLowerCase().includes(q)     || getFecha(r).includes(q) ||
      getOpType(r).toLowerCase().includes(q)  || getRoute(r).toLowerCase().includes(q)
    );
    _currentPage = 1; renderTable(res);
  }

  /* -------------------------------------------------------
     RENDER ALL
  ------------------------------------------------------- */
  function renderAll() {
    renderKPIs();
    renderActiveSubTab();
  }

  function renderActiveSubTab() {
    const active = document.querySelector('#mdb-sub-tabs button.active');
    const target = active ? active.dataset.bsTarget : '#mdb-sub-resumen';
    switch (target) {
      case '#mdb-sub-resumen':    renderTabResumen();    break;
      case '#mdb-sub-pasajeros':  renderTabPasajeros();  break;
      case '#mdb-sub-aerolineas': renderTabAerolineas(); break;
      case '#mdb-sub-rutas':      renderTabRutas();      break;
      case '#mdb-sub-equipaje':      renderTabEquipaje();      break;
      case '#mdb-sub-operaciones':  renderTabOperaciones();   break;
      case '#mdb-sub-dia':           renderTabDia();           break;
      case '#mdb-sub-datos':         renderTabDatos();         break;
      default:                       renderTabResumen();
    }
  }

  /* -------------------------------------------------------
     KPIs
  ------------------------------------------------------- */
  function renderKPIs() {
    const d = _filtered, total = d.length;
    const totalPax = d.reduce((s, r) => s + getPaxTotal(r), 0);
    const allPax   = _allData.reduce((s, r) => s + getPaxTotal(r), 0);
    const avgPax   = total ? Math.round(totalPax / total) : 0;
    const arrRows  = d.filter(isArr), depRows = d.filter(isDep);
    const arrPax   = arrRows.reduce((s, r) => s + getPaxTotal(r), 0);
    const depPax   = depRows.reduce((s, r) => s + getPaxTotal(r), 0);
    const domPax   = d.filter(isDom).reduce((s, r) => s + getPaxTotal(r), 0);
    const intPax   = d.filter(isInt).reduce((s, r) => s + getPaxTotal(r), 0);
    const aMap = {};
    d.forEach(r => { const a = getAirline(r); aMap[a] = (aMap[a] || 0) + getPaxTotal(r); });
    const top = Object.entries(aMap).sort((a, b) => b[1] - a[1])[0];
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('mdb-kpi-total',          fmt(total));
    set('mdb-kpi-total-sub',      total === _allData.length ? 'registros en base de datos' : 'registros filtrados');
    set('mdb-kpi-pax',            fmt(totalPax));
    set('mdb-kpi-pax-sub',        pct(totalPax, allPax) + ' del total');
    set('mdb-kpi-avg-pax',        fmt(avgPax));
    set('mdb-kpi-top-airline',    top ? top[0] : '-');
    set('mdb-kpi-top-airline-pax',top ? fmt(top[1]) + ' pax (' + pct(top[1], totalPax) + ')' : '-');
    set('mdb-kpi-arr-pax',        fmt(arrPax));
    set('mdb-kpi-arr-count',      fmt(arrRows.length) + ' vuelos (' + pct(arrPax, totalPax) + ')');
    set('mdb-kpi-dep-pax',        fmt(depPax));
    set('mdb-kpi-dep-count',      fmt(depRows.length) + ' vuelos (' + pct(depPax, totalPax) + ')');
    set('mdb-kpi-dom-pax',        fmt(domPax));
    set('mdb-kpi-dom-pct',        pct(domPax, totalPax) + ' del total');
    set('mdb-kpi-int-pax',        fmt(intPax));
    set('mdb-kpi-int-pct',        pct(intPax, totalPax) + ' del total');
    set('mdb-record-count',       fmt(total) + ' reg.');
    // Logo aerolínea líder
    if (top) {
      const el = document.getElementById('mdb-kpi-top-airline');
      if (el) el.innerHTML = airlineLogoHTML(top[0], 20) + escHtml(top[0]);
    }
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: RESUMEN
  ------------------------------------------------------- */
  function renderTabResumen() {
    renderChartMonthly();
    renderChartDirDonut();
    renderChartAirlinePax();
    renderChartOptypeDonut();
  }

  function renderChartMonthly() {
    const ctx = document.getElementById('mdb-chart-monthly-pax'); if (!ctx) return;
    if (_charts.monthly) _charts.monthly.destroy();
    const arrM = new Array(12).fill(0), depM = new Array(12).fill(0);
    _filtered.forEach(r => {
      const idx = getMonthIdx(r); if (idx < 0 || idx > 11) return;
      const pax = getPaxTotal(r);
      if (isArr(r)) arrM[idx] += pax; else depM[idx] += pax;
    });
    const totals = arrM.map((v, i) => v + depM[i]);
    const grandTotal = totals.reduce((s, v) => s + v, 0);
    _charts.monthly = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: MONTHS_ES, datasets: [
        { label: 'Llegadas', data: arrM, backgroundColor: relleno('#d63384'), stack: 'S', borderRadius: { topLeft:0, topRight:0, bottomLeft:4, bottomRight:4 } },
        { label: 'Salidas',  data: depM, backgroundColor: relleno('#6610f2'), stack: 'S', borderRadius: { topLeft:4, topRight:4, bottomLeft:0, bottomRight:0 } }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, totals[c.dataIndex]) + ' del mes)',
            footer: items => 'Total: ' + fmt(items.reduce((s, i) => s + i.raw, 0)) + ' (' + pct(items.reduce((s, i) => s + i.raw, 0), grandTotal) + ' anual)'
          }}
        },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  function renderChartDirDonut() {
    const ctx = document.getElementById('mdb-chart-dir-donut'); if (!ctx) return;
    if (_charts.dirDonut) _charts.dirDonut.destroy();
    const arrPax = _filtered.filter(isArr).reduce((s, r) => s + getPaxTotal(r), 0);
    const depPax = _filtered.filter(isDep).reduce((s, r) => s + getPaxTotal(r), 0);
    const total  = arrPax + depPax;
    _charts.dirDonut = new Chart(ctx, {
      type: 'pie',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: ['Llegadas','Salidas'], datasets: [{ data: [arrPax, depPax], backgroundColor: ['#d63384','#6610f2'], borderWidth: 2, hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false,
        layout: { padding: 70 },
        plugins: {
          legend: { display: false },
          datalabels: datalabelsPiePct(total),
          tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + ' pax (' + pct(c.raw, total) + ')' } }
        }
      }
    });
  }

  function renderChartAirlinePax() {
    const ctx = document.getElementById('mdb-chart-airline-pax'); if (!ctx) return;
    if (_charts.airlinePax) _charts.airlinePax.destroy();
    const map = {};
    _filtered.forEach(r => { const a = getAirline(r); map[a] = (map[a] || 0) + getPaxTotal(r); });
    const sorted = Object.entries(map).filter(([,p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const totalPax = _filtered.reduce((s, r) => s + getPaxTotal(r), 0);
    // Preload logos
    sorted.forEach(([n]) => { const iata = getIATA(n); if (iata) preloadLogo(iata); });
    _charts.airlinePax = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: sorted.map(([n]) => n), datasets: [{ label: 'Pasajeros', data: sorted.map(([,p]) => p), backgroundColor: rellenoPal(PAL_12.concat(PAL_12)), borderRadius: 4, borderSkipped: false }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { left: sorted.some(([n]) => getIATA(n)) ? 32 : 4, right: 60 } },
        plugins: {
          legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', color: '#495057', font: { size: 10, weight: '600' },
            formatter: (v) => fmt(v) + ' (' + pct(v, totalPax) + ')' },
          tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' pax (' + pct(c.raw, totalPax) + ')' } },
          airlineLogos: { enabled: true, size: 22, gap: 6 }
        },
        scales: { x: { beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  function renderChartOptypeDonut() {
    const ctx = document.getElementById('mdb-chart-optype-donut'); if (!ctx) return;
    if (_charts.optypeDonut) _charts.optypeDonut.destroy();
    const map = {};
    _filtered.forEach(r => { const ot = getOpType(r) || 'No especificado'; map[ot] = (map[ot] || 0) + getPaxTotal(r); });
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [,v]) => s + v, 0);
    _charts.optypeDonut = new Chart(ctx, {
      type: 'pie',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([,v]) => v), backgroundColor: PAL_7.slice(0, entries.length), borderWidth: 2, hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false,
        layout: { padding: 70 },
        plugins: {
          legend: { display: false },
          datalabels: datalabelsPiePct(total),
          tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + ' pax (' + pct(c.raw, total) + ')' } }
        }
      }
    });
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: PASAJEROS
  ------------------------------------------------------- */
  function renderTabPasajeros() {
    const d = _filtered;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const totalPax = d.reduce((s, r) => s + getPaxTotal(r), 0);
    const tua   = d.reduce((s, r) => s + getPaxTUA(r),   0);
    const inf   = d.reduce((s, r) => s + getPaxInf(r),   0);
    const trans = d.reduce((s, r) => s + getPaxTrans(r), 0);
    const conex = d.reduce((s, r) => s + getPaxConex(r), 0);
    const dip   = d.reduce((s, r) => s + getPaxDip(r),   0);
    const exent = d.reduce((s, r) => s + getPaxExent(r), 0);
    set('pax-kpi-tua',   fmt(tua)   + ' (' + pct(tua, totalPax) + ')');
    set('pax-kpi-inf',   fmt(inf)   + ' (' + pct(inf, totalPax) + ')');
    set('pax-kpi-trans', fmt(trans) + ' (' + pct(trans, totalPax) + ')');
    set('pax-kpi-conex', fmt(conex) + ' (' + pct(conex, totalPax) + ')');
    set('pax-kpi-dip',   fmt(dip)   + ' (' + pct(dip, totalPax) + ')');
    set('pax-kpi-exent', fmt(exent) + ' (' + pct(exent, totalPax) + ')');
    renderChartPaxBreakdown();
    renderChartTuaExentDonut();
    renderChartTuaMonthly();
    renderChartInfTransMonthly();
  }

  function renderChartPaxBreakdown() {
    const ctx = document.getElementById('mdb-chart-pax-breakdown'); if (!ctx) return;
    if (_charts.paxBreak) _charts.paxBreak.destroy();
    const cats = {
      'Pagan TUA':     _filtered.reduce((s, r) => s + getPaxTUA(r),   0),
      'Infantes':      _filtered.reduce((s, r) => s + getPaxInf(r),   0),
      'Tr\u00e1nsitos':     _filtered.reduce((s, r) => s + getPaxTrans(r), 0),
      'Conexiones':    _filtered.reduce((s, r) => s + getPaxConex(r), 0),
      'Diplom\u00e1ticos':  _filtered.reduce((s, r) => s + getPaxDip(r),   0),
      'En Comisi\u00f3n':   _filtered.reduce((s, r) => s + getPaxEnCom(r), 0),
      'Otros Exentos': _filtered.reduce((s, r) => s + getPaxOtros(r), 0),
    };
    const total = Object.values(cats).reduce((s, v) => s + v, 0);
    _charts.paxBreak = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: Object.keys(cats), datasets: [{ label: 'Pasajeros', data: Object.values(cats), backgroundColor: PAL_7, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'top', color: '#495057', font: { size: 10, weight: '600' },
            formatter: (v) => fmt(v) + '\n' + pct(v, total) },
          tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' pax (' + pct(c.raw, total) + ')' } }
        },
        scales: { y: { beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  function renderChartTuaExentDonut() {
    const ctx = document.getElementById('mdb-chart-tua-exent-donut'); if (!ctx) return;
    if (_charts.tuaExent) _charts.tuaExent.destroy();
    const vals = [
      _filtered.reduce((s, r) => s + getPaxTUA(r),   0),
      _filtered.reduce((s, r) => s + getPaxInf(r),   0),
      _filtered.reduce((s, r) => s + getPaxTrans(r), 0),
      _filtered.reduce((s, r) => s + getPaxConex(r), 0),
      _filtered.reduce((s, r) => s + getPaxDip(r),   0),
      _filtered.reduce((s, r) => s + getPaxEnCom(r), 0),
      _filtered.reduce((s, r) => s + getPaxOtros(r), 0),
    ];
    const total = vals.reduce((s, v) => s + v, 0);
    _charts.tuaExent = new Chart(ctx, {
      type: 'pie',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: {
        labels: ['Pagan TUA','Infantes','Tr\u00e1nsitos','Conexiones','Diplom\u00e1ticos','En Comisi\u00f3n','Otros Exentos'],
        datasets: [{ data: vals, backgroundColor: PAL_7, borderWidth: 2, hoverOffset: 8 }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        layout: { padding: 80 },
        plugins: {
          legend: { display: false },
          datalabels: datalabelsPiePct(total),
          tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, total) + ')' } }
        }
      }
    });
  }

  function renderChartTuaMonthly() {
    const ctx = document.getElementById('mdb-chart-tua-monthly'); if (!ctx) return;
    if (_charts.tuaMonthly) _charts.tuaMonthly.destroy();
    const tuaM = new Array(12).fill(0), exentM = new Array(12).fill(0);
    _filtered.forEach(r => {
      const idx = getMonthIdx(r); if (idx < 0 || idx > 11) return;
      tuaM[idx]   += getPaxTUA(r);
      exentM[idx] += getPaxExent(r);
    });
    const combM = tuaM.map((v, i) => v + exentM[i]);
    _charts.tuaMonthly = new Chart(ctx, {
      type: 'line',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: MONTHS_ES, datasets: [
        { label: 'Pagan TUA',    data: tuaM,   borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.12)', fill: true, tension: 0.3, pointRadius: 4 },
        { label: 'Total Exentos',data: exentM, borderColor: '#fd7e14', backgroundColor: 'rgba(253,126,20,0.12)',  fill: true, tension: 0.3, pointRadius: 4 }
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw),
            footer: items => {
              const total = combM[items[0].dataIndex];
              return items.map(i => pct(i.raw, total) + ' del mes · ' + i.dataset.label).join('\n');
            }
          }}
        },
        scales: { y: { beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  function renderChartInfTransMonthly() {
    const ctx = document.getElementById('mdb-chart-inf-trans-monthly'); if (!ctx) return;
    if (_charts.infTrans) _charts.infTrans.destroy();
    const infM = new Array(12).fill(0), tranM = new Array(12).fill(0), cnxM = new Array(12).fill(0);
    _filtered.forEach(r => {
      const idx = getMonthIdx(r); if (idx < 0 || idx > 11) return;
      infM[idx]  += getPaxInf(r);
      tranM[idx] += getPaxTrans(r);
      cnxM[idx]  += getPaxConex(r);
    });
    const totM = infM.map((v, i) => v + tranM[i] + cnxM[i]);
    _charts.infTrans = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: MONTHS_ES, datasets: [
        { label: 'Infantes',   data: infM,  backgroundColor: relleno('#fd7e14'),  stack: 'S' },
        { label: 'Tr\u00e1nsitos',  data: tranM, backgroundColor: relleno('#20c997'),  stack: 'S' },
        { label: 'Conexiones', data: cnxM,  backgroundColor: relleno('#0dcaf0'), stack: 'S' }
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, totM[c.dataIndex]) + ')',
            footer: items => 'Total: ' + fmt(totM[items[0].dataIndex])
          }}
        },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: AEROLÍNEAS
  ------------------------------------------------------- */
  function renderTabAerolineas() {
    renderAirlineRanking();
    renderChartAirlineDomInt();
    renderChartAirlineTrend();
  }

  function renderAirlineRanking() {
    const tbody = document.getElementById('mdb-tbody-airline-ranking'); if (!tbody) return;
    const map = {};
    _filtered.forEach(r => {
      const a = getAirline(r);
      if (!map[a]) map[a] = { flights: 0, pax: 0, arrPax: 0, depPax: 0 };
      map[a].flights++; const p = getPaxTotal(r); map[a].pax += p;
      if (isArr(r)) map[a].arrPax += p; else map[a].depPax += p;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1].pax - a[1].pax);
    const totalPax = sorted.reduce((s, [,v]) => s + v.pax, 0);
    const medals = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
    const badge = document.getElementById('mdb-airline-count-badge');
    if (badge) badge.textContent = sorted.length + ' aerol\u00edneas';
    tbody.innerHTML = sorted.length
      ? sorted.map(([name, v], i) => {
          const logo = airlineLogoHTML(name, 24);
          const pctVal = pct(v.pax, totalPax);
          const barW = totalPax ? Math.max(2, Math.round((v.pax / totalPax) * 100)) : 0;
          return '<tr>' +
          '<td class="text-center fw-bold">' + (medals[i] || (i+1)) + '</td>' +
          '<td><div class="d-flex align-items-center gap-2">' + logo + '<span class="fw-semibold">' + escHtml(name) + '</span></div></td>' +
          '<td class="text-end">' + fmt(v.flights) + '</td>' +
          '<td class="text-end fw-bold">' + fmt(v.pax) + '</td>' +
          '<td class="text-end text-muted">' + (v.flights ? fmt(Math.round(v.pax/v.flights)) : '-') + '</td>' +
          '<td class="text-end">' + fmt(v.arrPax) + ' <small class="text-muted">(' + pct(v.arrPax, v.pax) + ')</small></td>' +
          '<td class="text-end">' + fmt(v.depPax) + ' <small class="text-muted">(' + pct(v.depPax, v.pax) + ')</small></td>' +
          '<td><div class="d-flex align-items-center gap-2"><div class="progress flex-grow-1" style="height:8px;min-width:60px;"><div class="progress-bar bg-primary" style="width:' + barW + '%"></div></div><span class="small fw-semibold text-primary">' + pctVal + '</span></div></td>' +
          '</tr>';
        }).join('') +
        '<tr class="table-light fw-bold border-top"><td colspan="3" class="text-end">TOTAL</td><td class="text-end">' + fmt(totalPax) + '</td><td colspan="4"></td></tr>'
      : '<tr><td colspan="8" class="text-center text-muted py-3">Sin datos</td></tr>';
  }

  function renderChartAirlineDomInt() {
    const ctx = document.getElementById('mdb-chart-airline-domint'); if (!ctx) return;
    if (_charts.airlineDomInt) _charts.airlineDomInt.destroy();
    const map = {};
    _filtered.forEach(r => {
      const a = getAirline(r);
      if (!map[a]) map[a] = { dom: 0, int: 0 };
      const p = getPaxTotal(r);
      if (isDom(r)) map[a].dom += p; else if (isInt(r)) map[a].int += p;
    });
    const sorted = Object.entries(map)
      .map(([n, v]) => ({ n, total: v.dom + v.int, dom: v.dom, int: v.int }))
      .filter(x => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 15);
    const grandTotal = sorted.reduce((s, x) => s + x.total, 0);
    sorted.forEach(x => { const iata = getIATA(x.n); if (iata) preloadLogo(iata); });
    _charts.airlineDomInt = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: sorted.map(x => x.n), datasets: [
        { label: 'Dom\u00e9stica',     data: sorted.map(x => x.dom), backgroundColor: relleno('#fd7e14'),  stack: 'S', borderRadius: 4 },
        { label: 'Internacional', data: sorted.map(x => x.int), backgroundColor: relleno('#20c997'), stack: 'S', borderRadius: 4 }
      ]},
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { left: sorted.some(x => getIATA(x.n)) ? 32 : 4, right: 50 } },
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: true, color: '#fff', font: { size: 10, weight: 'bold' },
            formatter: (v, ctx2) => {
              const tot = sorted[ctx2.dataIndex].total;
              if (!tot || v < (tot * 0.05)) return '';
              return pct(v, tot);
            }
          },
          tooltip: { callbacks: {
            label: c => {
              const tot = sorted[c.dataIndex].total;
              return ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, tot) + ' del total aerol\u00ednea)';
            },
            footer: items => 'Total aerol\u00ednea: ' + fmt(sorted[items[0].dataIndex].total) + ' (' + pct(sorted[items[0].dataIndex].total, grandTotal) + ' global)'
          }},
          airlineLogos: { enabled: true, size: 20, gap: 6 }
        },
        scales: { x: { stacked: true, beginAtZero: true, ticks: { callback: tickK } }, y: { stacked: true } }
      }
    });
  }

  function renderChartAirlineTrend() {
    const ctx = document.getElementById('mdb-chart-airline-trend'); if (!ctx) return;
    if (_charts.airlineTrend) _charts.airlineTrend.destroy();
    const totals = {};
    _filtered.forEach(r => { const a = getAirline(r); totals[a] = (totals[a] || 0) + getPaxTotal(r); });
    const top5 = Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0,5).map(([n]) => n);
    const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
    const byAirline = {};
    top5.forEach(a => { byAirline[a] = new Array(12).fill(0); });
    _filtered.forEach(r => {
      const a = getAirline(r); if (!byAirline[a]) return;
      const idx = getMonthIdx(r); if (idx < 0 || idx > 11) return;
      byAirline[a][idx] += getPaxTotal(r);
    });
    const TREND_COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6610f2'];
    _charts.airlineTrend = new Chart(ctx, {
      type: 'line',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: MONTHS_ES, datasets: top5.map((a, i) => ({
        label: a + ' (' + pct(totals[a], grandTotal) + ')',
        data: byAirline[a],
        borderColor: TREND_COLORS[i], backgroundColor: TREND_COLORS[i] + '22',
        fill: false, tension: 0.3, pointRadius: 4
      }))},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14 } },
          datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => {
              const a = top5[c.datasetIndex];
              return ' ' + a + ': ' + fmt(c.raw) + ' (' + pct(c.raw, totals[a]) + ' del total ' + a + ')';
            }
          }}
        },
        scales: { y: { beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: RUTAS
  ------------------------------------------------------- */
  function renderTabRutas() {
    renderChartRoutes();
    renderChartRouteOptype();
    renderTableRutas();
  }

  function renderChartRoutes() {
    const ctx = document.getElementById('mdb-chart-routes'); if (!ctx) return;
    if (_charts.routes) _charts.routes.destroy();
    const map = {};
    _filtered.forEach(r => { const route = getRoute(r); if (!route) return; map[route] = (map[route] || 0) + getPaxTotal(r); });
    const sorted = Object.entries(map).filter(([,p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const totalPax = sorted.reduce((s, [,p]) => s + p, 0);
    _charts.routes = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: sorted.map(([n]) => n), datasets: [{ label: 'Pasajeros', data: sorted.map(([,p]) => p), backgroundColor: rellenoPal(PAL_12.concat(PAL_12)), borderRadius: 4, borderSkipped: false }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 75 } },
        plugins: {
          legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', color: '#495057', font: { size: 10, weight: '600' },
            formatter: (v) => fmt(v) + ' (' + pct(v, totalPax) + ')' },
          tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' pax (' + pct(c.raw, totalPax) + ')' } }
        },
        scales: { x: { beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  function renderChartRouteOptype() {
    const ctx = document.getElementById('mdb-chart-route-optype'); if (!ctx) return;
    if (_charts.routeOptype) _charts.routeOptype.destroy();
    const dom = _filtered.filter(isDom).reduce((s, r) => s + getPaxTotal(r), 0);
    const int = _filtered.filter(isInt).reduce((s, r) => s + getPaxTotal(r), 0);
    const total = dom + int;
    _charts.routeOptype = new Chart(ctx, {
      type: 'pie',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: ['Dom\u00e9stica','Internacional'], datasets: [{ data: [dom, int], backgroundColor: ['#fd7e14','#20c997'], borderWidth: 2, hoverOffset: 10 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          datalabels: datalabelsPiePct(total),
          tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' pax (' + pct(c.raw, total) + ')' } }
        }
      }
    });
  }

  function renderTableRutas() {
    const tbody = document.getElementById('mdb-tbody-rutas'); if (!tbody) return;
    const map = {};
    _filtered.forEach(r => {
      const route = getRoute(r); if (!route) return;
      if (!map[route]) map[route] = { flights: 0, pax: 0, dom: 0, int: 0 };
      map[route].flights++;
      const p = getPaxTotal(r); map[route].pax += p;
      if (isDom(r)) map[route].dom += p; else if (isInt(r)) map[route].int += p;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1].pax - a[1].pax);
    const totalPax     = sorted.reduce((s, [,v]) => s + v.pax, 0);
    const totalFlights = sorted.reduce((s, [,v]) => s + v.flights, 0);
    const totalDom     = sorted.reduce((s, [,v]) => s + v.dom, 0);
    const totalInt     = sorted.reduce((s, [,v]) => s + v.int, 0);

    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Sin datos</td></tr>';
      return;
    }

    tbody.innerHTML = sorted.map(([name, v], i) => {
        const barW = totalPax ? Math.max(2, Math.round((v.pax / totalPax) * 100)) : 0;
        return '<tr>' +
        '<td>' + (i+1) + '</td>' +
        '<td class="fw-semibold">' + escHtml(name) + '</td>' +
        '<td class="text-end">' + fmt(v.flights) + '</td>' +
        '<td class="text-end fw-bold">' + fmt(v.pax) + '</td>' +
        '<td class="text-end text-muted">' + (v.flights ? fmt(Math.round(v.pax/v.flights)) : '-') + '</td>' +
        '<td class="text-end">' + fmt(v.dom) + ' <small class="text-muted">(' + pct(v.dom, v.pax) + ')</small></td>' +
        '<td class="text-end">' + fmt(v.int) + ' <small class="text-muted">(' + pct(v.int, v.pax) + ')</small></td>' +
        '<td><div class="d-flex align-items-center gap-2"><div class="progress flex-grow-1" style="height:8px;min-width:50px;"><div class="progress-bar bg-danger" style="width:' + barW + '%"></div></div><span class="small fw-semibold text-danger">' + pct(v.pax, totalPax) + '</span></div></td>' +
        '</tr>';
      }).join('') +
      // -- TOTAL row ----------------------------------------------------------
      '<tr style="background:#f1f5f9;border-top:2px solid #cbd5e1;">' +
      '<td></td>' +
      '<td class="fw-black text-uppercase" style="font-size:.82rem;letter-spacing:.5px;color:#374151;">TOTAL</td>' +
      '<td class="text-end fw-black" style="color:#374151;">' + fmt(totalFlights) + '</td>' +
      '<td class="text-end fw-black" style="color:#374151;">' + fmt(totalPax) + '</td>' +
      '<td class="text-end fw-bold text-muted">' + (totalFlights ? fmt(Math.round(totalPax/totalFlights)) : '-') + '</td>' +
      '<td class="text-end fw-bold">' + fmt(totalDom) + ' <small class="text-muted">(' + pct(totalDom, totalPax) + ')</small></td>' +
      '<td class="text-end fw-bold">' + fmt(totalInt) + ' <small class="text-muted">(' + pct(totalInt, totalPax) + ')</small></td>' +
      '<td><div class="d-flex align-items-center gap-2"><div class="progress flex-grow-1" style="height:8px;min-width:50px;"><div class="progress-bar bg-danger" style="width:100%"></div></div><span class="small fw-black text-danger">100%</span></div></td>' +
      '</tr>';
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: EQUIPAJE
  ------------------------------------------------------- */
  function renderTabEquipaje() {
    const d = _filtered;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const totalKgs = d.reduce((s, r) => s + getKgs(r), 0);
    const total    = d.length;
    const arrKgs   = d.filter(isArr).reduce((s, r) => s + getKgs(r), 0);
    const depKgs   = d.filter(isDep).reduce((s, r) => s + getKgs(r), 0);
    set('kgs-kpi-total', fmt(totalKgs) + ' Kgs');
    set('kgs-kpi-avg',   fmt(total ? Math.round(totalKgs / total) : 0) + ' Kgs/vuelo');
    set('kgs-kpi-arr',   fmt(arrKgs) + ' Kgs (' + pct(arrKgs, totalKgs) + ')');
    set('kgs-kpi-dep',   fmt(depKgs) + ' Kgs (' + pct(depKgs, totalKgs) + ')');
    renderChartKgsMonthly();
    renderChartKgsDirDonut();
    renderChartKgsAirline();
  }

  function renderChartKgsMonthly() {
    const ctx = document.getElementById('mdb-chart-kgs-monthly'); if (!ctx) return;
    if (_charts.kgsMonthly) _charts.kgsMonthly.destroy();
    const arrM = new Array(12).fill(0), depM = new Array(12).fill(0);
    _filtered.forEach(r => {
      const idx = getMonthIdx(r); if (idx < 0 || idx > 11) return;
      const k = getKgs(r);
      if (isArr(r)) arrM[idx] += k; else depM[idx] += k;
    });
    const totM = arrM.map((v, i) => v + depM[i]);
    const grandTotal = totM.reduce((s, v) => s + v, 0);
    _charts.kgsMonthly = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: MONTHS_ES, datasets: [
        { label: 'Llegadas', data: arrM, backgroundColor: relleno('#d63384'), stack: 'S' },
        { label: 'Salidas',  data: depM, backgroundColor: relleno('#6610f2'), stack: 'S' }
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' Kgs (' + pct(c.raw, totM[c.dataIndex]) + ')',
            footer: items => 'Total: ' + fmt(totM[items[0].dataIndex]) + ' Kgs (' + pct(totM[items[0].dataIndex], grandTotal) + ' anual)'
          }}
        },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  function renderChartKgsDirDonut() {
    const ctx = document.getElementById('mdb-chart-kgs-dir-donut'); if (!ctx) return;
    if (_charts.kgsDirDonut) _charts.kgsDirDonut.destroy();
    const arrKgs = _filtered.filter(isArr).reduce((s, r) => s + getKgs(r), 0);
    const depKgs = _filtered.filter(isDep).reduce((s, r) => s + getKgs(r), 0);
    const total  = arrKgs + depKgs;
    _charts.kgsDirDonut = new Chart(ctx, {
      type: 'doughnut',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: ['Llegadas','Salidas'], datasets: [{ data: [arrKgs, depKgs], backgroundColor: ['#d63384','#6610f2'], borderWidth: 2, hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          datalabels: datalabelsPiePct(total),
          tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + ' Kgs (' + pct(c.raw, total) + ')' } }
        }
      }
    });
  }

  function renderChartKgsAirline() {
    const ctx = document.getElementById('mdb-chart-kgs-airline'); if (!ctx) return;
    if (_charts.kgsAirline) _charts.kgsAirline.destroy();
    const map = {};
    _filtered.forEach(r => { const a = getAirline(r); map[a] = (map[a] || 0) + getKgs(r); });
    const sorted = Object.entries(map).filter(([,k]) => k > 0).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const totalKgs = sorted.reduce((s, [,k]) => s + k, 0);
    sorted.forEach(([n]) => { const iata = getIATA(n); if (iata) preloadLogo(iata); });
    _charts.kgsAirline = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels: sorted.map(([n]) => n), datasets: [{ label: 'Kgs Equipaje', data: sorted.map(([,k]) => k), backgroundColor: rellenoPal(PAL_12.concat(PAL_12)), borderRadius: 4, borderSkipped: false }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { left: sorted.some(([n]) => getIATA(n)) ? 32 : 4, right: 75 } },
        plugins: {
          legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', color: '#495057', font: { size: 10, weight: '600' },
            formatter: (v) => fmt(v) + ' Kgs (' + pct(v, totalKgs) + ')' },
          tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' Kgs (' + pct(c.raw, totalKgs) + ')' } },
          airlineLogos: { enabled: true, size: 20, gap: 6 }
        },
        scales: { x: { beginAtZero: true, ticks: { callback: tickK } } }
      }
    });
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: DATOS
  ------------------------------------------------------- */
  /* -------------------------------------------------------
     SUB-PESTAÑA: OPERACIONES
  ------------------------------------------------------- */
  function renderTabOperaciones() {
    const d = _filtered;
    const total = d.length;

    // Count by type
    const nacRows = d.filter(isDom);
    const intRows = d.filter(isInt);
    const nacTotal = nacRows.length;
    const intTotal = intRows.length;
    const activeMths = MONTHS_ES.filter((_, i) => d.some(r => getMonthIdx(r) === i));
    const avgPerMonth = activeMths.length > 0 ? Math.round(total / activeMths.length) : 0;

    // KPIs
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ops-kpi-total',    fmt(total));
    set('ops-kpi-total-sub', total === _allData.length ? 'vuelos registrados' : 'vuelos filtrados');
    set('ops-kpi-nac',      fmt(nacTotal));
    set('ops-kpi-nac-pct',  pct(nacTotal, total) + ' del total');
    set('ops-kpi-int',      fmt(intTotal));
    set('ops-kpi-int-pct',  pct(intTotal, total) + ' del total');
    set('ops-kpi-avg',      fmt(avgPerMonth));
    const badge = document.getElementById('ops-total-badge');
    if (badge) badge.textContent = fmt(total) + ' operaciones';

    // Monthly breakdown
    const nacByMonth = new Array(12).fill(0);
    const intByMonth = new Array(12).fill(0);
    const totByMonth = new Array(12).fill(0);
    d.forEach(r => {
      const idx = getMonthIdx(r);
      if (idx < 0 || idx > 11) return;
      if (isDom(r)) nacByMonth[idx]++;
      else if (isInt(r)) intByMonth[idx]++;
      totByMonth[idx]++;
    });

    // Render monthly table
    const tbody = document.getElementById('ops-tbody-monthly');
    if (tbody) {
      tbody.innerHTML = '';
      let hasAnyData = false;
      MONTHS_ES.forEach((mes, i) => {
        if (totByMonth[i] === 0) return;
        hasAnyData = true;
        const pNac = totByMonth[i] > 0 ? ((nacByMonth[i] / totByMonth[i]) * 100).toFixed(1) : '0.0';
        const pInt = totByMonth[i] > 0 ? ((intByMonth[i] / totByMonth[i]) * 100).toFixed(1) : '0.0';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="fw-semibold">${mes}</td>
          <td class="text-end" style="color:#fd7e14">${fmt(nacByMonth[i])}</td>
          <td class="text-end" style="color:#20c997">${fmt(intByMonth[i])}</td>
          <td class="text-end fw-bold">${fmt(totByMonth[i])}</td>
          <td class="text-end">${pNac}%</td>
          <td class="text-end">${pInt}%</td>
        `;
        tbody.appendChild(tr);
      });
      if (!hasAnyData) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Sin datos para el período seleccionado</td></tr>';
      }
    }

    // Totals footer
    const tfoot = document.getElementById('ops-tfoot-monthly');
    if (tfoot) {
      const pNacT = total > 0 ? ((nacTotal / total) * 100).toFixed(1) : '0.0';
      const pIntT = total > 0 ? ((intTotal / total) * 100).toFixed(1) : '0.0';
      tfoot.innerHTML = `<tr>
        <td>TOTAL</td>
        <td class="text-end">${fmt(nacTotal)}</td>
        <td class="text-end">${fmt(intTotal)}</td>
        <td class="text-end">${fmt(total)}</td>
        <td class="text-end">${pNacT}%</td>
        <td class="text-end">${pIntT}%</td>
      </tr>`;
    }

    // Bar chart: monthly operations
    const ctxBar = document.getElementById('ops-chart-monthly');
    if (ctxBar) {
      if (_charts.opsMonthly) _charts.opsMonthly.destroy();
      // Only show months with data
      const labels = MONTHS_ES.filter((_, i) => totByMonth[i] > 0);
      const nacData = nacByMonth.filter((_, i) => totByMonth[i] > 0);
      const intData = intByMonth.filter((_, i) => totByMonth[i] > 0);
      _charts.opsMonthly = new Chart(ctxBar, {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Nacional',       data: nacData, backgroundColor: relleno('#fd7e14'),   stack: 'S', borderRadius: { topLeft:0, topRight:0, bottomLeft:4, bottomRight:4 } },
          { label: 'Internacional', data: intData, backgroundColor: relleno('#20c997'),   stack: 'S', borderRadius: { topLeft:4, topRight:4, bottomLeft:0, bottomRight:0 } }
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            datalabels: { display: false },
            tooltip: { callbacks: {
              label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw),
              footer: items => 'Total: ' + fmt(items.reduce((s, i) => s + i.raw, 0))
            }}
          },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, callback: v => Number.isInteger(v) ? v : '' } } }
        }
      });
    }

    // Donut chart: nac vs int
    const ctxDonut = document.getElementById('ops-chart-donut');
    if (ctxDonut) {
      if (_charts.opsDonut) _charts.opsDonut.destroy();
      _charts.opsDonut = new Chart(ctxDonut, {
        type: 'doughnut',
        plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
        data: { labels: ['Nacional', 'Internacional'], datasets: [{ data: [nacTotal, intTotal], backgroundColor: ['#fd7e14', '#20c997'], borderWidth: 2, hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            datalabels: datalabelsPiePct(total),
            tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, total) + ')' } }
          }
        }
      });
    }

    // Heatmaps: pasajeros y operaciones por hora x día de semana (datos de manifiestos)
    renderOperacionesHeatmaps(d);
  }

  function renderOperacionesHeatmaps(rows) {
    const paxContainer = document.getElementById('mdb-ops-heatmap-pax');
    const opsContainer = document.getElementById('mdb-ops-heatmap-ops');
    if (!paxContainer || !opsContainer) return;

    const state = buildOperacionesHeatmapState(rows || []);
    drawOperacionesHeatmap(paxContainer, state, {
      metric: 'pax',
      unit: 'Pasajeros',
      tone: 'primary'
    });
    drawOperacionesHeatmap(opsContainer, state, {
      metric: 'ops',
      unit: 'Operaciones',
      tone: 'warning'
    });
  }

  function buildOperacionesHeatmapState(rows) {
    return ManifiestosMaestra.construirMapaCalor(rows || [], {
      hora: getHour,
      dia: getDayKey,
      pax: getPaxTotal,
      detalle: r => ({
        dayKey: getDayKey(r),
        fecha: getFecha(r) || getDayKey(r),
        hora: getOperacionesHeatmapHourLabel(r, getHour(r)),
        manifiesto: getDir(r) || '',
        aerolinea: getAirline(r) || '',
        vuelo: getFlight(r) || '',
        ruta: getRoute(r) || '',
        tipoOperacion: getOpType(r) || '',
        pax: getPaxTotal(r)
      })
    });
  }

  function getOperacionesHeatmapHourLabel(row, fallbackHour) {
    const raw = col(row,
      'HR. DE OPERACIÓN', 'HR. DE OPERACION', 'HR DE OPERACION', 'HR DE OPERACIÓN',
      'HORA DE OPERACIÓN', 'HORA DE OPERACION', 'HORA OPERACION',
      'HR. OPERACIÓN', 'HR. OPERACION',
      'SLOT ASIGNADO', 'SLOT COORDINADO',
      'HORA DE INICIO O TERMINO DE PERNOCTA', 'HORA DE RECEPCIÓN', 'HORA DE RECEPCION'
    );
    if (raw) {
      const s = String(raw).trim();
      const m = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (m) return m[1];
    }
    return String(fallbackHour).padStart(2, '0') + ':00';
  }

  /* Lo que el usuario eligió en cada mapa, para que un cambio de filtro no lo
     regrese a la vista inicial cuando la pestaña se vuelve a dibujar. */
  const _heatmapVista = {
    pax: { vista: 'semana', semana: '0', mes: '' },
    ops: { vista: 'semana', semana: '0', mes: '' }
  };

  /* Dibuja el mapa de calor. El mismo dato se puede leer de dos formas:
   *
   *   · Día de la semana — 24 x 7. El patrón que se repite: a qué horas de los
   *     martes se llena la terminal. Acumulado, o una semana a la vez.
   *   · Fecha por fecha  — 24 x los días del mes elegido. Lo que pasó el martes
   *     12 a las 07:00, que es lo que hace falta para revisar un día concreto y
   *     no un promedio de todos los martes.
   *
   * Cualquier celda con actividad se abre y muestra los vuelos que la formaron.
   */
  function drawOperacionesHeatmap(container, state, config) {
    const metric = config.metric;
    const unit = config.unit;
    const activa = config.tone === 'warning' ? 'btn-warning' : 'btn-primary';
    const inactiva = 'btn-outline-secondary';
    const diasCortos = ManifiestosMaestra.DIAS_CORTOS;
    const diasLargos = ManifiestosMaestra.DIAS_LARGOS;

    const pref = _heatmapVista[metric] || (_heatmapVista[metric] = { vista: 'semana', semana: '0', mes: '' });
    if (pref.semana !== '0' && !state.porSemana.has(pref.semana)) pref.semana = '0';
    // El mes recordado puede no existir en los datos nuevos; si no, el último.
    if (!state.porMes.has(pref.mes)) {
      pref.mes = state.clavesMes.length ? state.clavesMes[state.clavesMes.length - 1] : '';
    }

    const colorFor = (value, maxVal) => {
      if (!maxVal || value <= 0) return '#edf2f7';
      const t = Math.max(0, Math.min(1, value / maxVal));
      const light = config.tone === 'warning' ? [248, 229, 211] : [218, 230, 248];
      const dark = config.tone === 'warning' ? [245, 146, 49] : [67, 130, 221];
      const c = i => Math.round(light[i] + (dark[i] - light[i]) * t);
      return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
    };

    /* Las dos vistas, detrás de la misma interfaz: una lista de columnas y dos
       funciones que dicen qué hay en la celda (hora, columna). */
    const armarVista = () => {
      if (pref.vista === 'fecha') {
        const mes = state.porMes.get(pref.mes);
        const dias = mes ? mes.dias : [];
        return {
          modo: 'fecha',
          columnas: dias.map(clave => {
            const d = state.porDia.get(clave);
            return {
              titulo: d.etiqueta,
              subtitulo: d.diaSemana,
              resalta: d.finDeSemana,
              nombre: d.diaSemanaLargo + ' ' + d.etiqueta
            };
          }),
          valor: (h, i) => { const d = state.porDia.get(dias[i]); return d ? d[metric][h] : 0; },
          detalles: (h, i) => { const d = state.porDia.get(dias[i]); return d ? d.detalles[h] : []; },
          leyenda: mes ? mes.etiqueta : 'Sin datos'
        };
      }
      const base = (pref.semana !== '0' && state.porSemana.has(pref.semana))
        ? state.porSemana.get(pref.semana)
        : state.semana;
      return {
        modo: 'semana',
        columnas: diasCortos.map((d, i) => ({ titulo: d, subtitulo: '', resalta: i >= 5, nombre: diasLargos[i] })),
        valor: (h, i) => base[metric][h][i],
        detalles: (h, i) => base.detalles[h][i],
        leyenda: pref.semana === '0'
          ? 'Todas las semanas'
          : ((state.porSemana.get(pref.semana) || {}).etiqueta || 'Semana')
      };
    };

    const render = () => {
      const v = armarVista();
      const nCols = v.columnas.length;

      // Sólo las horas con actividad: veinticuatro renglones, la mitad en cero,
      // esconden los que sí tienen algo que decir.
      const conDatos = [];
      for (let h = 0; h < 24; h++) {
        let suma = 0;
        for (let i = 0; i < nCols; i++) suma += v.valor(h, i);
        if (suma > 0) conDatos.push(h);
      }
      const horas = conDatos.length ? conDatos : Array.from({ length: 24 }, (_, h) => h);

      let maxVal = 0;
      const totalesCol = Array(nCols).fill(0);
      const totalesFila = [];
      let granTotal = 0;
      horas.forEach(h => {
        let suma = 0;
        for (let i = 0; i < nCols; i++) {
          const x = v.valor(h, i);
          if (x > maxVal) maxVal = x;
          suma += x;
          totalesCol[i] += x;
        }
        totalesFila.push(suma);
        granTotal += suma;
      });

      const botonVista = (clave, etiqueta, icono) =>
        `<button type="button" class="btn btn-sm ${pref.vista === clave ? activa : inactiva}" data-mdbhm-vista="${clave}">`
        + `<i class="fas ${icono} me-1"></i>${etiqueta}</button>`;

      let html = '';
      html += '<div class="d-flex flex-wrap align-items-center gap-2 mb-2">';
      html += '<span class="small text-muted fw-semibold">Ver por:</span>';
      html += '<div class="btn-group btn-group-sm shadow-sm">'
        + botonVista('semana', 'Día de la semana', 'fa-calendar-week')
        + botonVista('fecha', 'Fecha por fecha', 'fa-calendar-day')
        + '</div>';
      html += '</div>';

      if (v.modo === 'fecha') {
        const chips = state.clavesMes.map(k => {
          const m = state.porMes.get(k);
          return `<button type="button" class="btn btn-sm ${pref.mes === k ? activa : inactiva}" data-mdbhm-mes="${k}">`
            + `${escHtml(m.etiqueta)} <span class="badge bg-light text-secondary border fw-normal">${m.dias.length} d</span></button>`;
        }).join('');
        html += '<div class="small text-muted mb-2">Elegir mes:</div>';
        html += '<div class="d-flex flex-wrap gap-2 mb-3">'
          + (chips || '<span class="text-muted small">Sin fechas con hora de operación en el filtro actual.</span>')
          + '</div>';
      } else {
        const chips = [
          `<button type="button" class="btn btn-sm ${pref.semana === '0' ? activa : inactiva}" data-mdbhm-semana="0">Todas</button>`,
          ...state.clavesSemana.map(k => {
            const s = state.porSemana.get(k);
            return `<button type="button" class="btn btn-sm ${pref.semana === k ? activa : inactiva}" data-mdbhm-semana="${k}">${escHtml(s.etiqueta)}</button>`;
          })
        ].join('');
        html += '<div class="small text-muted mb-2">Filtrar semana:</div>';
        html += `<div class="d-flex flex-wrap gap-2 mb-3">${chips}</div>`;
      }

      const eje = v.modo === 'fecha' ? 'día del mes' : 'día de la semana';
      html += `<p class="text-muted small mb-2">Muestra el total de <strong>${unit}</strong> por franja horaria y ${eje}`
        + ` (${escHtml(v.leyenda)}). Los colores más oscuros indican mayor actividad;`
        + ' haz clic en cualquier celda para ver los vuelos que la forman.</p>';

      if (!nCols) {
        container.innerHTML = html + '<p class="text-muted small mb-0">No hay nada que dibujar con la selección actual.</p>';
        cablear(container, v);
        return;
      }

      // La columna de la hora se queda fija: con un mes completo la tabla se
      // desplaza a lo ancho y sin esto se pierde la referencia del renglón.
      const fija = 'position:sticky;left:0;z-index:2;';
      const anchoCol = v.modo === 'fecha' ? 'min-width:54px;' : '';

      html += '<div class="table-responsive"><table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size:.8rem">';
      html += `<thead class="table-light"><tr><th class="text-center" style="${fija}background:#f8f9fa;">Hora</th>`;
      v.columnas.forEach(c => {
        const sub = c.subtitulo
          ? `<div class="text-muted fw-normal" style="font-size:.68rem">${escHtml(c.subtitulo)}</div>`
          : '';
        html += `<th class="text-center${c.resalta ? ' table-warning' : ''}" style="${anchoCol}">${escHtml(c.titulo)}${sub}</th>`;
      });
      html += '<th class="text-center">Total</th></tr></thead><tbody>';

      horas.forEach((h, idx) => {
        html += `<tr><th class="text-center text-nowrap" style="${fija}background:#fff;">${String(h).padStart(2, '0')}:00</th>`;
        for (let i = 0; i < nCols; i++) {
          const val = v.valor(h, i);
          const fondo = `background:${colorFor(val, maxVal)};font-weight:600;`;
          if (val > 0) {
            html += `<td data-mdbhm-hora="${h}" data-mdbhm-col="${i}" style="${fondo}cursor:pointer;" title="Ver vuelos de esta celda">${fmt(val)}</td>`;
          } else {
            html += `<td style="${fondo}">${fmt(val)}</td>`;
          }
        }
        html += `<td class="fw-bold bg-light">${fmt(totalesFila[idx])}</td></tr>`;
      });

      html += `<tr class="table-secondary fw-bold"><th style="${fija}background:#e2e3e5;">Total</th>`;
      totalesCol.forEach(t => { html += `<td>${fmt(t)}</td>`; });
      html += `<td>${fmt(granTotal)}</td></tr>`;
      html += '</tbody></table></div>';

      container.innerHTML = html;
      cablear(container, v);
    };

    const cablear = (raiz, v) => {
      raiz.querySelectorAll('button[data-mdbhm-vista]').forEach(btn => {
        btn.addEventListener('click', () => { pref.vista = btn.dataset.mdbhmVista || 'semana'; render(); });
      });
      raiz.querySelectorAll('button[data-mdbhm-semana]').forEach(btn => {
        btn.addEventListener('click', () => { pref.semana = btn.dataset.mdbhmSemana || '0'; render(); });
      });
      raiz.querySelectorAll('button[data-mdbhm-mes]').forEach(btn => {
        btn.addEventListener('click', () => { pref.mes = btn.dataset.mdbhmMes || ''; render(); });
      });
      raiz.querySelectorAll('td[data-mdbhm-hora]').forEach(td => {
        td.addEventListener('click', () => {
          const hour = parseInt(td.dataset.mdbhmHora, 10);
          const i = parseInt(td.dataset.mdbhmCol, 10);
          if (!Number.isFinite(hour) || !Number.isFinite(i) || !v.columnas[i]) return;
          showOperacionesHeatmapDrilldown({
            records: v.detalles(hour, i),
            metric,
            hour,
            unit,
            columna: v.columnas[i].nombre,
            periodo: v.leyenda
          });
        });
      });
    };

    render();
  }

  function showOperacionesHeatmapDrilldown(ctx) {
    const titleEl = document.getElementById('heatmap-drilldown-title');
    const bodyEl = document.getElementById('heatmap-drilldown-body');
    const modalEl = document.getElementById('heatmap-drilldown-modal');
    if (!titleEl || !bodyEl || !modalEl) return;

    const records = Array.isArray(ctx.records) ? ctx.records : [];
    const titleMetric = ctx.metric === 'ops' ? 'Operaciones' : 'Pasajeros';
    const badgeClass = ctx.metric === 'ops' ? 'bg-warning text-dark' : 'bg-primary';
    titleEl.innerHTML = `${titleMetric} · ${escHtml(ctx.columna || '')} ${String(ctx.hour).padStart(2, '0')}:00 <span class="badge ${badgeClass} fw-normal ms-2">${fmt(records.length)} registro${records.length === 1 ? '' : 's'}</span>`;

    if (!records.length) {
      bodyEl.innerHTML = '<p class="text-muted mb-0">Sin registros para esta celda.</p>';
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
      return;
    }

    const sorted = [...records].sort((a, b) => {
      const d = String(a.dayKey || '').localeCompare(String(b.dayKey || ''));
      if (d !== 0) return d;
      const h = String(a.hora || '').localeCompare(String(b.hora || ''));
      if (h !== 0) return h;
      return String(a.vuelo || '').localeCompare(String(b.vuelo || ''));
    });

    const totalPax = sorted.reduce((acc, r) => acc + (Number(r.pax) || 0), 0);
    let html = `<p class="text-muted small mb-3">Período: <strong>${escHtml(ctx.periodo || 'Todas las semanas')}</strong>. Total de registros: <strong>${fmt(sorted.length)}</strong>. Total de pasajeros: <strong>${fmt(totalPax)}</strong>.</p>`;
    html += '<div class="table-responsive"><table class="table table-sm table-hover table-bordered align-middle mb-0" style="font-size:0.82rem">';
    html += '<thead class="table-light"><tr><th>Fecha</th><th>Hora</th><th>Manifiesto</th><th>Aerolínea</th><th>Vuelo</th><th>Ruta</th><th>Tipo de operación</th><th class="text-end">Pax</th></tr></thead><tbody>';

    sorted.forEach(r => {
      html += '<tr>';
      html += `<td class="text-nowrap">${escHtml(r.fecha || '—')}</td>`;
      html += `<td class="text-nowrap fw-semibold">${escHtml(r.hora || '—')}</td>`;
      html += `<td>${escHtml(r.manifiesto || '—')}</td>`;
      html += `<td>${escHtml(r.aerolinea || '—')}</td>`;
      html += `<td class="fw-semibold">${escHtml(r.vuelo || '—')}</td>`;
      html += `<td>${escHtml(r.ruta || '—')}</td>`;
      html += `<td>${escHtml(r.tipoOperacion || '—')}</td>`;
      html += `<td class="text-end">${fmt(r.pax || 0)}</td>`;
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    bodyEl.innerHTML = html;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  /* -------------------------------------------------------
     HELPER: DÍA
  ------------------------------------------------------- */
  function getDayKey(r) {
    const raw = getFecha(r); if (!raw) return '';
    const clean = String(raw).split('T')[0];
    const p = clean.split(/[-\/]/);
    if (p.length < 3) return '';
    if (p[0].length === 4) return p[0] + '-' + p[1].padStart(2,'0') + '-' + p[2].padStart(2,'0'); // YYYY-MM-DD
    return p[2] + '-' + p[1].padStart(2,'0') + '-' + p[0].padStart(2,'0'); // DD/MM/YYYY ? YYYY-MM-DD
  }

  /* -------------------------------------------------------
     SUB-PESTAÑA: POR DÍA
  ------------------------------------------------------- */
  function renderTabDia() {
    const DIAS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

    // Aggregate per calendar day
    const map = {};
    _filtered.forEach(r => {
      const key = getDayKey(r); if (!key) return;
      if (!map[key]) map[key] = { flights: 0, pax: 0, arrPax: 0, depPax: 0, domPax: 0, intPax: 0 };
      const p = getPaxTotal(r);
      map[key].flights++;
      map[key].pax    += p;
      if (isArr(r)) map[key].arrPax += p;
      if (isDep(r)) map[key].depPax += p;
      if (isDom(r)) map[key].domPax += p;
      if (isInt(r)) map[key].intPax += p;
    });

    const sorted = Object.keys(map).sort();
    const badge = document.getElementById('mdb-dia-count-badge');
    if (badge) badge.textContent = sorted.length + ' días';

    // Bar chart
    const ctx = document.getElementById('mdb-chart-day-pax');
    if (ctx) {
      if (_charts.dayPax) _charts.dayPax.destroy();
      const arrData = sorted.map(k => map[k].arrPax);
      const depData = sorted.map(k => map[k].depPax);
      const totData = sorted.map(k => map[k].pax);
      const grandTotal = totData.reduce((s, v) => s + v, 0);
      const labels = sorted.map(k => {
        try {
          const d = new Date(k + 'T12:00:00');
          const [y, m, day] = k.split('-');
          return DIAS_ES[d.getDay()] + ' ' + day + '/' + m;
        } catch(_) { return k; }
      });
      _charts.dayPax = new Chart(ctx, {
        type: 'bar',
        plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
        data: { labels, datasets: [
          { label: 'Llegadas', data: arrData, backgroundColor: relleno('#d63384'), stack: 'S', borderRadius: { topLeft:0, topRight:0, bottomLeft:4, bottomRight:4 } },
          { label: 'Salidas',  data: depData, backgroundColor: relleno('#6610f2'), stack: 'S', borderRadius: { topLeft:4, topRight:4, bottomLeft:0, bottomRight:0 } }
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            datalabels: { display: false },
            tooltip: { callbacks: {
              title: items => {
                try { const d = new Date(sorted[items[0].dataIndex] + 'T12:00:00'); return DIAS_ES[d.getDay()] + ', ' + sorted[items[0].dataIndex]; } catch(_) { return sorted[items[0].dataIndex]; }
              },
              label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, totData[c.dataIndex]) + ')',
              footer: items => 'Total: ' + fmt(totData[items[0].dataIndex]) + ' (' + pct(totData[items[0].dataIndex], grandTotal) + ' del período)'
            }}
          },
          scales: {
            x: { stacked: true, ticks: { maxRotation: 45, font: { size: 10 } } },
            y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } }
          }
        }
      });
    }

    // Summary table
    const tbody = document.getElementById('mdb-tbody-dia');
    if (!tbody) return;
    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">Sin datos para el período seleccionado</td></tr>';
      return;
    }
    const totalPax      = sorted.reduce((s, k) => s + map[k].pax, 0);
    const totalFlights  = sorted.reduce((s, k) => s + map[k].flights, 0);
    const totalArr      = sorted.reduce((s, k) => s + map[k].arrPax, 0);
    const totalDep      = sorted.reduce((s, k) => s + map[k].depPax, 0);
    const totalDom      = sorted.reduce((s, k) => s + map[k].domPax, 0);
    const totalInt      = sorted.reduce((s, k) => s + map[k].intPax, 0);
    // Determine peak day
    const peakDay = sorted.reduce((best, k) => (!best || map[k].pax > map[best].pax) ? k : best, null);
    tbody.innerHTML = sorted.map(k => {
      const v = map[k];
      let dia = '', esFin = false;
      try {
        const d = new Date(k + 'T12:00:00');
        dia = DIAS_ES[d.getDay()];
        esFin = d.getDay() === 0 || d.getDay() === 6;
      } catch(_) {}
      const [y, m, day] = k.split('-');
      const isPeak = k === peakDay;
      const rowClass = isPeak ? 'class="table-info"' : (esFin ? 'class="table-warning"' : '');
      const badgeCls = esFin ? 'bg-warning text-dark' : 'bg-light text-secondary border';
      return '<tr ' + rowClass + ' data-day="' + k + '" style="cursor:pointer;" title="click para ver desglose por hora">' +
        '<td class="fw-semibold text-nowrap">' + day + '/' + m + '/' + y + (isPeak ? ' <span class="badge bg-info text-dark ms-1" style="font-size:0.65rem;">Mayor pax</span>' : '') + '</td>' +
        '<td class="text-center"><span class="badge ' + badgeCls + '">' + dia + '</span></td>' +
        '<td class="text-end">' + fmt(v.flights) + '</td>' +
        '<td class="text-end fw-bold">' + fmt(v.pax) + '</td>' +
        '<td class="text-end" style="color:#d63384">' + fmt(v.arrPax) + '</td>' +
        '<td class="text-end" style="color:#6610f2">' + fmt(v.depPax) + '</td>' +
        '<td class="text-end" style="color:#fd7e14">' + fmt(v.domPax) + '</td>' +
        '<td class="text-end" style="color:#20c997">' + fmt(v.intPax) + '</td>' +
        '<td class="text-end text-muted">' + (v.flights ? fmt(Math.round(v.pax / v.flights)) : '—') + '</td>' +
        '</tr>';
    }).join('') +
    '<tr class="table-dark fw-bold">' +
    '<td colspan="2">TOTAL</td>' +
    '<td class="text-end">' + fmt(totalFlights) + '</td>' +
    '<td class="text-end">' + fmt(totalPax) + '</td>' +
    '<td class="text-end">' + fmt(totalArr) + '</td>' +
    '<td class="text-end">' + fmt(totalDep) + '</td>' +
    '<td class="text-end">' + fmt(totalDom) + '</td>' +
    '<td class="text-end">' + fmt(totalInt) + '</td>' +
    '<td></td>' +
    '</tr>';

    // Row click ? drill-down
    tbody.querySelectorAll('tr[data-day]').forEach(tr => {
      tr.addEventListener('click', () => {
        tbody.querySelectorAll('tr[data-day]').forEach(r => r.style.outline = '');
        tr.style.outline = '2px solid #0d6efd';
        renderDiaDetail(tr.dataset.day);
        document.getElementById('mdb-card-dia-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Wire up date picker + button
    _initDiaDetailControls(sorted, peakDay);

    // Hourly breakdown
    renderDiaHourChart();

    // Simultaneous operations by 10-minute slots (±5 min window)
    renderDiaSimultaneousOps();

    // Airline breakdown
    renderDiaAirlineChart();
  }

  function _initDiaDetailControls(sorted, peakDay) {
    const btn  = document.getElementById('mdb-btn-dia-detail');
    const dinp = document.getElementById('mdb-dia-detail-date');
    if (!btn || !dinp) return;
    // Remove old listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      const v = dinp.value;
      if (!v) return;
      renderDiaDetail(v);
      document.getElementById('mdb-card-dia-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Default: Dec 19, 2025 if in data, else peak day
    const defaultDay = sorted.includes('2025-12-19') ? '2025-12-19' : peakDay;
    if (defaultDay && dinp.value !== defaultDay) dinp.value = defaultDay;
    if (defaultDay) { setTimeout(() => renderDiaDetail(defaultDay), 0); }
  }

  function renderDiaHourChart() {
    const ctx = document.getElementById('mdb-chart-hour-pax'); if (!ctx) return;
    if (_charts.hourPax) _charts.hourPax.destroy();

    const arrH = new Array(24).fill(0);
    const depH = new Array(24).fill(0);
    let hasHourData = false;

    _filtered.forEach(r => {
      const h = getHour(r);
      if (h < 0 || h > 23) return;
      hasHourData = true;
      const p = getPaxTotal(r);
      if (isArr(r)) arrH[h] += p;
      else depH[h] += p;
    });

    const noDataBadge = document.getElementById('mdb-hour-no-data');
    const card = document.getElementById('mdb-card-hour');
    if (!hasHourData) {
      if (noDataBadge) noDataBadge.style.display = '';
      if (card) card.querySelector('.card-body').innerHTML = '<div class="text-center text-muted py-4 small"><i class="fas fa-info-circle me-2"></i>No se detect\u00f3 columna de hora en esta tabla (HORA DE OPERACI\u00d3N / SLOT). La gr\u00e1fica no est\u00e1 disponible para este conjunto de datos.</div>';
      return;
    }
    if (noDataBadge) noDataBadge.style.display = 'none';

    const labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00 – ' + ((i + 1) % 24).toString().padStart(2, '0') + ':00');
    const totH   = arrH.map((v, i) => v + depH[i]);
    const grandTotal = totH.reduce((s, v) => s + v, 0);

    _charts.hourPax = new Chart(ctx, {
      type: 'bar',
      plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
      data: { labels, datasets: [
        { label: 'Llegadas', data: arrH, backgroundColor: relleno('#d63384'), stack: 'S', borderRadius: { topLeft:0, topRight:0, bottomLeft:3, bottomRight:3 } },
        { label: 'Salidas',  data: depH, backgroundColor: relleno('#6610f2'), stack: 'S', borderRadius: { topLeft:3, topRight:3, bottomLeft:0, bottomRight:0 } }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, totH[c.dataIndex]) + ')',
            footer: items => 'Total hora: ' + fmt(totH[items[0].dataIndex]) + ' (' + pct(totH[items[0].dataIndex], grandTotal) + ' del per\u00edodo)'
          }}
        },
        scales: {
          x: { stacked: true, ticks: { font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } }
        }
      }
    });
  }

  function renderDiaSimultaneousOps() {
    const ctx = document.getElementById('mdb-chart-hour-simult'); if (!ctx) return;
    if (_charts.hourSimult) _charts.hourSimult.destroy();

    const peakBadge = document.getElementById('mdb-hour-simult-peak');
    const noDataBadge = document.getElementById('mdb-hour-simult-no-data');
    const summaryEl = document.getElementById('mdb-hour-simult-summary');
    const topEl = document.getElementById('mdb-hour-simult-top');
    const chartWrap = document.getElementById('mdb-hour-simult-chart-wrap');

    const slots = new Map(); // minuteSlot -> total operations in period
    const dayKeys = new Set();
    let withHour = 0;

    _filtered.forEach(r => {
      const minuteOfDay = getMinuteOfDay(r);
      if (minuteOfDay < 0) return;
      withHour += 1;

      const dayKey = getDayKey(r);
      if (dayKey) dayKeys.add(dayKey);

      // ±5 min window modeled as nearest 10-minute center
      const centered = Math.round(minuteOfDay / 10) * 10;
      const slot = ((centered % 1440) + 1440) % 1440;
      slots.set(slot, (slots.get(slot) || 0) + 1);
    });

    if (withHour === 0) {
      if (noDataBadge) noDataBadge.style.display = '';
      if (peakBadge) peakBadge.textContent = 'Pico: —';
      if (summaryEl) {
        summaryEl.textContent = 'No se detectó columna de hora en esta tabla para calcular operaciones simultáneas.';
      }
      if (topEl) topEl.innerHTML = '';
      if (chartWrap) chartWrap.style.display = 'none';
      return;
    }
    if (noDataBadge) noDataBadge.style.display = 'none';
    if (chartWrap) chartWrap.style.display = '';

    const activeDays = dayKeys.size || 1;
    const ordered = Array.from(slots.entries()).sort((a, b) => a[0] - b[0]);
    const labels = ordered.map(([m]) => {
      const hh = Math.floor(m / 60);
      const mm = m % 60;
      return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    });
    const totals = ordered.map(([, c]) => c);
    const avgs = totals.map(c => Number((c / activeDays).toFixed(2)));

    let maxIdx = 0;
    for (let i = 1; i < avgs.length; i++) if (avgs[i] > avgs[maxIdx]) maxIdx = i;

    const peakLabel = labels[maxIdx];
    const peakAvg = avgs[maxIdx];

    if (peakBadge) peakBadge.textContent = 'Pico: ' + peakLabel + ' (' + peakAvg.toFixed(1) + ' ops/día)';
    if (summaryEl) {
      const hh = parseInt(peakLabel.substring(0, 2), 10);
      const mm = parseInt(peakLabel.substring(3, 5), 10);
      const ini = String(hh).padStart(2, '0') + ':' + String(Math.max(0, mm - 5)).padStart(2, '0');
      const fin = String(hh).padStart(2, '0') + ':' + String(Math.min(59, mm + 5)).padStart(2, '0');
      summaryEl.innerHTML =
        '<strong>Interpretación:</strong> En promedio, la mayor simultaneidad ocurre alrededor de <strong>' + peakLabel +
        '</strong> (' + ini + ' a ' + fin + '), con <strong>' + peakAvg.toFixed(1) +
        '</strong> operaciones al mismo tiempo por día activo.';
    }

    if (topEl) {
      const top = ordered
        .map(([m, c], idx) => ({ label: labels[idx], total: c, avg: Number((c / activeDays).toFixed(2)) }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 5);
      topEl.innerHTML = top.map((t, i) =>
        '<span class="badge rounded-pill ' + (i === 0 ? 'bg-danger' : 'bg-secondary') + '">'
        + '#' + (i + 1) + ' ' + t.label + ' · ' + t.avg.toFixed(1) + ' ops/día'
        + '</span>'
      ).join('');
    }

    _charts.hourSimult = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Ops simultáneas promedio por día',
          data: avgs,
          borderColor: '#dc3545',
          backgroundColor: 'rgba(220,53,69,0.14)',
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          pointHoverRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title: (items) => {
                const c = items[0].label;
                const hh = parseInt(c.substring(0, 2), 10);
                const mm = parseInt(c.substring(3, 5), 10);
                const ini = String(hh).padStart(2, '0') + ':' + String(Math.max(0, mm - 5)).padStart(2, '0');
                const fin = String(hh).padStart(2, '0') + ':' + String(Math.min(59, mm + 5)).padStart(2, '0');
                return c + ' (ventana ' + ini + ' - ' + fin + ')';
              },
              label: (ctx2) => {
                const idx = ctx2.dataIndex;
                return [
                  ' ' + Number(ctx2.raw).toFixed(2) + ' ops simultáneas prom/día',
                  ' Total período: ' + fmt(totals[idx]) + ' operaciones',
                  ' Días activos: ' + fmt(activeDays)
                ];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              callback: (val, idx) => {
                const lbl = labels[idx] || '';
                return lbl.endsWith(':00') ? lbl : '';
              },
              font: { size: 10 }
            },
            title: { display: true, text: 'Hora central (agrupación cada 10 min con ±5 min)' }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Operaciones simultáneas promedio por día' }
          }
        }
      }
    });
  }

  function renderDiaAirlineChart() {
    const map = {};
    _filtered.forEach(r => {
      const a = getAirline(r);
      if (!map[a]) map[a] = { flights: 0, pax: 0, arrPax: 0, depPax: 0 };
      const p = getPaxTotal(r);
      map[a].flights++;
      map[a].pax += p;
      if (isArr(r)) map[a].arrPax += p;
      if (isDep(r)) map[a].depPax += p;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1].pax - a[1].pax);
    const totalPax = sorted.reduce((s, [, v]) => s + v.pax, 0);
    const top15 = sorted.slice(0, 15);

    // Chart
    const ctx = document.getElementById('mdb-chart-dia-airline');
    if (ctx) {
      if (_charts.diaAirline) _charts.diaAirline.destroy();
      top15.forEach(([n]) => { const iata = getIATA(n); if (iata) preloadLogo(iata); });
      _charts.diaAirline = new Chart(ctx, {
        type: 'bar',
        plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
        data: { labels: top15.map(([n]) => n), datasets: [
          { label: 'Llegadas', data: top15.map(([, v]) => v.arrPax), backgroundColor: relleno('#d63384'), stack: 'S', borderRadius: { topLeft:0, topRight:0, bottomLeft:4, bottomRight:4 } },
          { label: 'Salidas',  data: top15.map(([, v]) => v.depPax), backgroundColor: relleno('#6610f2'), stack: 'S', borderRadius: { topLeft:4, topRight:4, bottomLeft:0, bottomRight:0 } }
        ]},
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          layout: { padding: { left: top15.some(([n]) => getIATA(n)) ? 32 : 4, right: 60 } },
          plugins: {
            legend: { position: 'top' },
            datalabels: { display: true, color: '#fff', font: { size: 9, weight: 'bold' },
              formatter: (v, c2) => {
                const tot = top15[c2.dataIndex][1].pax;
                return (!tot || v < tot * 0.06) ? '' : pct(v, tot);
              }
            },
            tooltip: { callbacks: {
              label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + ' (' + pct(c.raw, top15[c.dataIndex][1].pax) + ' aerol\u00ednea)',
              footer: items => 'Total: ' + fmt(top15[items[0].dataIndex][1].pax) + ' (' + pct(top15[items[0].dataIndex][1].pax, totalPax) + ' global)'
            }},
            airlineLogos: { enabled: true, size: 20, gap: 6 }
          },
          scales: { x: { stacked: true, beginAtZero: true, ticks: { callback: tickK } }, y: { stacked: true } }
        }
      });
    }

    // Ranking table
    const badge = document.getElementById('mdb-dia-airline-badge');
    if (badge) badge.textContent = sorted.length + ' aerol\u00edneas';
    const tbody = document.getElementById('mdb-tbody-dia-airline');
    if (!tbody) return;
    const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    tbody.innerHTML = sorted.map(([name, v], i) => {
      const logo = airlineLogoHTML(name, 22);
      const barW = totalPax ? Math.max(2, Math.round((v.pax / totalPax) * 100)) : 0;
      return '<tr>' +
        '<td class="text-center fw-bold">' + (medals[i] || (i + 1)) + '</td>' +
        '<td><div class="d-flex align-items-center gap-2">' + logo + '<span class="fw-semibold small">' + escHtml(name) + '</span></div></td>' +
        '<td class="text-end small">' + fmt(v.flights) + '</td>' +
        '<td class="text-end fw-bold small">' + fmt(v.pax) + '</td>' +
        '<td class="text-end small" style="color:#d63384">' + fmt(v.arrPax) + '</td>' +
        '<td class="text-end small" style="color:#6610f2">' + fmt(v.depPax) + '</td>' +
        '<td><div class="d-flex align-items-center gap-2"><div class="progress flex-grow-1" style="height:7px;min-width:40px;"><div class="progress-bar bg-primary" style="width:' + barW + '%"></div></div><span class="small fw-semibold text-primary">' + pct(v.pax, totalPax) + '</span></div></td>' +
        '</tr>';
    }).join('') + (sorted.length ? '<tr class="table-light fw-bold"><td colspan="3" class="text-end">TOTAL</td><td class="text-end">' + fmt(totalPax) + '</td><td colspan="3"></td></tr>' : '<tr><td colspan="7" class="text-center text-muted py-3">Sin datos</td></tr>');
  }

  function renderTabDatos() { renderTable(_filtered); }

  /* -------------------------------------------------------
     DETALLE POR HORA DE UN DÍA ESPECÍFICO
  ------------------------------------------------------- */
  function renderDiaDetail(dateKey) {
    const DIAS_ES2 = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const container = document.getElementById('mdb-dia-detail-content');
    if (!container || !dateKey) return;

    // Update date input to match selected day
    const dinp = document.getElementById('mdb-dia-detail-date');
    if (dinp) dinp.value = dateKey;

    // Filter all loaded data (not just _filtered) so even without month filter we get the day
    const dayRows = _allData.filter(r => getDayKey(r) === dateKey);

    if (!dayRows.length) {
      container.innerHTML = '<div class="alert alert-warning mb-0 py-2">No hay datos para <strong>' + escHtml(dateKey) + '</strong>. ' +
        'Verifica que los filtros de año/mes/aerolínea no excluyan este día, o que el dato exista en la base de datos.</div>';
      return;
    }

    // Format date label
    const [yy, mm, dd] = dateKey.split('-');
    let dayLabel = dd + '/' + mm + '/' + yy;
    try {
      const dt = new Date(dateKey + 'T12:00:00');
      dayLabel = DIAS_ES2[dt.getDay()] + ' ' + parseInt(dd, 10) + ' de ' + MONTHS_ES[parseInt(mm, 10) - 1] + ' de ' + yy;
    } catch (_) {}

    // KPIs
    const totalPax  = dayRows.reduce((s, r) => s + getPaxTotal(r), 0);
    const arrPax    = dayRows.filter(r => isArr(r)).reduce((s, r) => s + getPaxTotal(r), 0);
    const depPax    = dayRows.filter(r => isDep(r)).reduce((s, r) => s + getPaxTotal(r), 0);
    const domPax    = dayRows.filter(r => isDom(r)).reduce((s, r) => s + getPaxTotal(r), 0);
    const intPax    = dayRows.filter(r => isInt(r)).reduce((s, r) => s + getPaxTotal(r), 0);
    const airlines  = new Set(dayRows.map(r => getAirline(r))).size;
    const flights   = dayRows.length;

    // Hourly aggregation + per-airline breakdown
    const arrH    = new Array(24).fill(0);
    const depH    = new Array(24).fill(0);
    const fltsH   = new Array(24).fill(0);
    const hourAirMap = {}; // h ? { airlineName ? { arr, dep, flights } }
    dayRows.forEach(r => {
      const h = getHour(r); if (h < 0 || h > 23) return;
      const a = getAirline(r);
      const p = getPaxTotal(r);
      if (isArr(r)) arrH[h] += p; else depH[h] += p;
      fltsH[h]++;
      if (!hourAirMap[h]) hourAirMap[h] = {};
      if (!hourAirMap[h][a]) hourAirMap[h][a] = { arr: 0, dep: 0, flights: 0 };
      if (isArr(r)) hourAirMap[h][a].arr += p; else hourAirMap[h][a].dep += p;
      hourAirMap[h][a].flights++;
    });
    const totH    = arrH.map((v, i) => v + depH[i]);
    const hasHour = totH.some(v => v > 0);
    const peakH   = hasHour ? totH.indexOf(Math.max(...totH)) : -1;
    const grandH  = totH.reduce((s, v) => s + v, 0);
    const activeHours = Array.from({length: 24}, (_, h) => h).filter(h => totH[h] > 0 || fltsH[h] > 0);

    // Airline aggregation
    const airMap = {};
    dayRows.forEach(r => {
      const a = getAirline(r);
      if (!airMap[a]) airMap[a] = { flights: 0, pax: 0, arr: 0, dep: 0, hours: new Set() };
      const p = getPaxTotal(r);
      airMap[a].flights++;
      airMap[a].pax += p;
      if (isArr(r)) airMap[a].arr += p; else airMap[a].dep += p;
      const h = getHour(r); if (h >= 0) airMap[a].hours.add(h);
    });
    const airSorted = Object.entries(airMap).sort((a, b) => b[1].pax - a[1].pax);
    const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    const AIR_COLORS = ['#0d6efd','#198754','#ffc107','#dc3545','#0dcaf0','#6610f2','#fd7e14','#20c997','#d63384','#6c757d','#0d3b86','#adb5bd'];
    const TOP_CHART = Math.min(8, airSorted.length);
    const topAirlines = airSorted.slice(0, TOP_CHART).map(([n]) => n);
    const hlbl = h => h.toString().padStart(2, '0') + ':00–' + ((h + 1) % 24).toString().padStart(2, '0') + ':00';

    // Build hourly table rows (expandable per-airline sub-rows)
    const hourRows = activeHours.map(h => {
      const isPk = h === peakH && totH[h] > 0;
      const airEntries = Object.entries(hourAirMap[h] || {}).sort((a, b) => (b[1].arr + b[1].dep) - (a[1].arr + a[1].dep));
      const airStr = airEntries.map(([a]) =>
        '<span class="d-inline-flex align-items-center gap-1 me-1">' + airlineLogoHTML(a, 14) +
        '<span class="small text-truncate" style="max-width:100px;" title="' + escHtml(a) + '">' + escHtml(a) + '</span></span>'
      ).join('');
      const summaryRow = '<tr class="hour-summary-row' + (isPk ? ' table-warning fw-bold' : '') + '" data-h="' + h + '" style="cursor:pointer;">' +
        '<td class="text-nowrap fw-semibold small">' +
          '<i class="fas fa-chevron-right hour-chevron me-1" style="font-size:0.6rem;transition:transform 0.2s;"></i>' +
          h.toString().padStart(2, '0') + ':00 – ' + ((h + 1) % 24).toString().padStart(2, '0') + ':00' +
          (isPk ? ' <span class="badge bg-warning text-dark ms-1" style="font-size:0.6rem;">PICO</span>' : '') +
        '</td>' +
        '<td class="text-end small">' + fltsH[h] + '</td>' +
        '<td class="text-end fw-bold small">' + fmt(totH[h]) + '</td>' +
        '<td class="text-end small" style="color:#d63384">' + (arrH[h] ? fmt(arrH[h]) : '—') + '</td>' +
        '<td class="text-end small" style="color:#6610f2">' + (depH[h] ? fmt(depH[h]) : '—') + '</td>' +
        '<td class="text-end small text-muted">' + (totH[h] && grandH ? ((totH[h] / grandH * 100).toFixed(1) + '%') : '—') + '</td>' +
        '<td class="small">' + (airStr || '<span class="text-muted">—</span>') + '</td>' +
        '</tr>';
      const subRows = airEntries.map(([a, av]) => {
        const tot = av.arr + av.dep;
        return '<tr class="hour-airline-sub" data-h="' + h + '" style="display:none;background:#f8f9fa;">' +
          '<td class="small ps-4 text-muted">' +
            '<div class="d-flex align-items-center gap-1">' + airlineLogoHTML(a, 14) +
            '<span class="fw-semibold" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(a) + '">' + escHtml(a) + '</span></div>' +
          '</td>' +
          '<td class="text-end small text-muted">' + av.flights + '</td>' +
          '<td class="text-end fw-bold small">' + fmt(tot) + '</td>' +
          '<td class="text-end small" style="color:#d63384">' + (av.arr ? fmt(av.arr) : '—') + '</td>' +
          '<td class="text-end small" style="color:#6610f2">' + (av.dep ? fmt(av.dep) : '—') + '</td>' +
          '<td class="text-end small text-muted">' + (grandH ? ((tot / grandH * 100).toFixed(1) + '%') : '—') + '</td>' +
          '<td></td>' +
          '</tr>';
      }).join('');
      return summaryRow + subRows;
    }).join('');

    // Build airline table rows
    const airRows = airSorted.map(([name, v], i) => {
      const logo = airlineLogoHTML(name, 20);
      const barW = totalPax ? Math.max(2, Math.round((v.pax / totalPax) * 100)) : 0;
      const hList = [...v.hours].sort((a,b)=>a-b).map(h => h.toString().padStart(2,'0') + ':00').join(', ');
      return '<tr>' +
        '<td class="text-center fw-bold small">' + (medals[i] || (i + 1)) + '</td>' +
        '<td><div class="d-flex align-items-center gap-1">' + logo + '<span class="fw-semibold small">' + escHtml(name) + '</span></div></td>' +
        '<td class="text-end small">' + v.flights + '</td>' +
        '<td class="text-end fw-bold small">' + fmt(v.pax) + '</td>' +
        '<td class="text-end small" style="color:#d63384">' + (v.arr ? fmt(v.arr) : '—') + '</td>' +
        '<td class="text-end small" style="color:#6610f2">' + (v.dep ? fmt(v.dep) : '—') + '</td>' +
        '<td class="text-end small">' +
          '<div class="d-flex align-items-center gap-1 justify-content-end">' +
            '<div class="progress flex-grow-1" style="height:6px;min-width:30px;">' +
              '<div class="progress-bar bg-primary" style="width:' + barW + '%"></div></div>' +
            '<span class="fw-semibold text-primary">' + pct(v.pax, totalPax) + '</span>' +
          '</div>' +
        '</td>' +
        '<td class="small text-muted">' + escHtml(hList || '—') + '</td>' +
        '</tr>';
    }).join('') + (airSorted.length ? '<tr class="table-light fw-bold"><td colspan="3" class="text-end small">TOTAL</td><td class="text-end small">' + fmt(totalPax) + '</td><td colspan="4"></td></tr>' : '');

    // Matrix: Hora × Aerolínea (top 10)
    const matrixCols = airSorted.slice(0, Math.min(10, airSorted.length)).map(([n]) => n);
    const matrixHeader = '<th class="text-nowrap small fw-semibold" style="min-width:80px;">Hora</th><th class="text-end small fw-semibold">Total</th>' +
      matrixCols.map((a, i) => '<th class="text-center" style="font-size:0.65rem;min-width:72px;max-width:90px;background:' + AIR_COLORS[i % AIR_COLORS.length] + '22;">' +
        '<div class="d-flex flex-column align-items-center gap-1 py-1">' + airlineLogoHTML(a, 16) +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;display:block;" title="' + escHtml(a) + '">' + escHtml(a) + '</span></div></th>'
      ).join('');
    const matrixRows = activeHours.map(h => {
      const isPk = h === peakH;
      const cols = matrixCols.map((a, i) => {
        const v = (hourAirMap[h] || {})[a];
        if (!v || (!v.arr && !v.dep)) return '<td class="text-center text-muted" style="font-size:0.7rem;color:#ccc!important;">\u2014</td>';
        const tot = v.arr + v.dep;
        const bg = AIR_COLORS[i % AIR_COLORS.length] + '18';
        return '<td class="text-end" style="font-size:0.72rem;padding:3px 6px;line-height:1.4;background:' + bg + ';">' +
          '<span class="fw-bold d-block">' + fmt(tot) + '</span>' +
          (v.arr ? '<span style="color:#d63384;font-size:0.62rem;">\u25b2' + fmt(v.arr) + '</span> ' : '') +
          (v.dep ? '<span style="color:#6610f2;font-size:0.62rem;">\u25bc' + fmt(v.dep) + '</span>' : '') +
          '</td>';
      }).join('');
      return '<tr' + (isPk ? ' class="table-warning"' : '') + '>' +
        '<td class="text-nowrap fw-semibold" style="font-size:0.72rem;padding:3px 6px;">' + hlbl(h) + (isPk ? ' \u2605' : '') + '</td>' +
        '<td class="text-end fw-bold" style="font-size:0.72rem;padding:3px 6px;">' + fmt(totH[h]) + '</td>' +
        cols + '</tr>';
    }).join('');

    container.innerHTML =
      // Alert header
      '<div class="alert alert-dark d-flex align-items-center gap-3 mb-3 py-2 px-3">' +
        '<i class="fas fa-calendar-day fa-lg text-warning"></i>' +
        '<span class="fw-bold">' + escHtml(dayLabel) + '</span>' +
        '<span class="badge bg-warning text-dark ms-auto">' + fmt(totalPax) + ' pax totales</span>' +
      '</div>' +

      // KPI row
      '<div class="row g-2 mb-3">' +
        '<div class="col-6 col-md-2"><div class="card border-0 bg-light text-center py-2 h-100">' +
          '<div class="small text-muted mb-1"><i class="fas fa-users me-1"></i>Total Pax</div>' +
          '<div class="fs-5 fw-bold text-dark">' + fmt(totalPax) + '</div>' +
        '</div></div>' +
        '<div class="col-6 col-md-2"><div class="card border-0 text-center py-2 h-100" style="background:#fce4f3;">' +
          '<div class="small mb-1" style="color:#d63384;"><i class="fas fa-plane-arrival me-1"></i>Llegadas</div>' +
          '<div class="fs-5 fw-bold" style="color:#d63384;">' + fmt(arrPax) + '</div>' +
          '<div class="small text-muted">' + pct(arrPax, totalPax) + '</div>' +
        '</div></div>' +
        '<div class="col-6 col-md-2"><div class="card border-0 text-center py-2 h-100" style="background:#eef0fd;">' +
          '<div class="small mb-1" style="color:#6610f2;"><i class="fas fa-plane-departure me-1"></i>Salidas</div>' +
          '<div class="fs-5 fw-bold" style="color:#6610f2;">' + fmt(depPax) + '</div>' +
          '<div class="small text-muted">' + pct(depPax, totalPax) + '</div>' +
        '</div></div>' +
        '<div class="col-6 col-md-2"><div class="card border-0 bg-light text-center py-2 h-100">' +
          '<div class="small text-muted mb-1"><i class="fas fa-flag me-1 text-warning"></i>Nacional</div>' +
          '<div class="fs-5 fw-bold text-dark">' + fmt(domPax) + '</div>' +
          '<div class="small text-muted">' + pct(domPax, totalPax) + '</div>' +
        '</div></div>' +
        '<div class="col-6 col-md-2"><div class="card border-0 bg-light text-center py-2 h-100">' +
          '<div class="small text-muted mb-1"><i class="fas fa-globe me-1 text-success"></i>Intern.</div>' +
          '<div class="fs-5 fw-bold text-dark">' + fmt(intPax) + '</div>' +
          '<div class="small text-muted">' + pct(intPax, totalPax) + '</div>' +
        '</div></div>' +
        '<div class="col-6 col-md-1"><div class="card border-0 bg-light text-center py-2 h-100">' +
          '<div class="small text-muted mb-1"><i class="fas fa-plane me-1"></i>Vuelos</div>' +
          '<div class="fs-5 fw-bold text-dark">' + fmt(flights) + '</div>' +
        '</div></div>' +
        '<div class="col-6 col-md-1"><div class="card border-0 bg-light text-center py-2 h-100">' +
          '<div class="small text-muted mb-1"><i class="fas fa-building me-1"></i>Aerol.</div>' +
          '<div class="fs-5 fw-bold text-dark">' + airlines + '</div>' +
        '</div></div>' +
      '</div>' +

      // Hourly chart
      (hasHour ?
        '<div class="card border-0 shadow-sm mb-3">' +
          '<div class="card-header bg-white border-0 pb-0">' +
            '<span class="fw-bold small"><i class="fas fa-clock me-2 text-warning"></i>Pasajeros por Hora · ' + escHtml(dayLabel) + '</span>' +
          '</div>' +
          '<div class="card-body pt-2"><div style="position:relative;height:240px;"><canvas id="mdb-chart-hour-detail"></canvas></div></div>' +
        '</div>'
      : '<div class="alert alert-secondary small mb-3"><i class="fas fa-info-circle me-2"></i>No se detectó columna de hora (HORA DE OPERACIÓN / SLOT) · gráfica horaria no disponible.</div>') +

      // Chart 2: per-airline stacked (total)
      (hasHour && topAirlines.length ?
        '<div class="card border-0 shadow-sm mb-3">' +
          '<div class="card-header bg-white border-0 pb-0">' +
            '<span class="fw-bold small"><i class="fas fa-layer-group me-2 text-success"></i>Pasajeros por Hora y Aerolínea (Total) · ' + escHtml(dayLabel) + '</span>' +
          '</div>' +
          '<div class="card-body pt-2"><div style="position:relative;height:280px;"><canvas id="mdb-chart-hour-airline-total"></canvas></div></div>' +
        '</div>'
      : '') +

      // Charts 3 & 4: arrivals and departures side by side
      (hasHour && topAirlines.length ?
        '<div class="row g-3 mb-3">' +
          '<div class="col-md-6"><div class="card border-0 shadow-sm h-100">' +
            '<div class="card-header bg-white border-0 pb-0">' +
              '<span class="fw-bold small" style="color:#d63384;"><i class="fas fa-plane-arrival me-2"></i>Llegadas por Hora y Aerolínea</span>' +
            '</div>' +
            '<div class="card-body pt-2"><div style="position:relative;height:260px;"><canvas id="mdb-chart-hour-airline-arr"></canvas></div></div>' +
          '</div></div>' +
          '<div class="col-md-6"><div class="card border-0 shadow-sm h-100">' +
            '<div class="card-header bg-white border-0 pb-0">' +
              '<span class="fw-bold small" style="color:#6610f2;"><i class="fas fa-plane-departure me-2"></i>Salidas por Hora y Aerolínea</span>' +
            '</div>' +
            '<div class="card-body pt-2"><div style="position:relative;height:260px;"><canvas id="mdb-chart-hour-airline-dep"></canvas></div></div>' +
          '</div></div>' +
        '</div>'
      : '') +

      // Hourly table
      (hasHour ?
        '<div class="card border-0 shadow-sm mb-3">' +
          '<div class="card-header bg-white border-0">' +
            '<span class="fw-bold small"><i class="fas fa-table me-2 text-info"></i>Desglose Horario Detallado</span>' +
          '</div>' +
          '<div class="card-body p-0"><div class="table-responsive" style="max-height:380px;overflow-y:auto;">' +
            '<table id="mdb-tbl-hour-detail" class="table table-sm table-hover table-bordered mb-0">' +
              '<thead class="table-dark" style="position:sticky;top:0;z-index:1;"><tr>' +
                '<th class="text-nowrap small" style="cursor:pointer;">Hora <i class="fas fa-chevron-right" style="font-size:0.65rem;opacity:0.6;"></i></th>' +
                '<th class="text-end small">Vuelos</th>' +
                '<th class="text-end small fw-bold">Pax Total</th>' +
                '<th class="text-end small" style="color:#f472b6;"><i class="fas fa-plane-arrival"></i> Llegadas</th>' +
                '<th class="text-end small" style="color:#a78bfa;"><i class="fas fa-plane-departure"></i> Salidas</th>' +
                '<th class="text-end small">% Día</th>' +
                '<th class="small">Aerolíneas (click para expandir)</th>' +
              '</tr></thead>' +
              '<tbody>' + (hourRows || '<tr><td colspan="7" class="text-center text-muted py-3">Sin datos horarios disponibles</td></tr>') + '</tbody>' +
            '</table>' +
          '</div></div>' +
        '</div>'
      : '') +

      // Matrix: Hora x Aerolínea
      (hasHour && matrixRows ?
        '<div class="card border-0 shadow-sm mb-3">' +
          '<div class="card-header bg-white border-0 d-flex align-items-center justify-content-between">' +
            '<span class="fw-bold small"><i class="fas fa-th me-2 text-warning"></i>Matriz Hora x Aerolínea · ' + escHtml(dayLabel) + '</span>' +
            '<span class="badge bg-secondary">' + matrixCols.length + ' aerolíneas · ' + activeHours.length + ' horas activas</span>' +
          '</div>' +
          '<div class="card-body p-0"><div class="table-responsive">' +
            '<table class="table table-sm table-bordered mb-0" style="min-width:600px;">' +
              '<thead style="position:sticky;top:0;z-index:1;"><tr>' + matrixHeader + '</tr></thead>' +
              '<tbody>' + matrixRows + '</tbody>' +
            '</table>' +
          '</div></div>' +
        '</div>'
      : '') +

      // Airline breakdown table
      '<div class="card border-0 shadow-sm">' +
        '<div class="card-header bg-white border-0 d-flex align-items-center justify-content-between">' +
          '<span class="fw-bold small"><i class="fas fa-chess-queen me-2 text-primary"></i>Ranking por Aerolínea · ' + escHtml(dayLabel) + '</span>' +
          '<span class="badge bg-primary">' + airSorted.length + ' aerolíneas</span>' +
        '</div>' +
        '<div class="card-body p-0"><div class="table-responsive" style="max-height:400px;overflow-y:auto;">' +
          '<table class="table table-sm table-hover table-bordered mb-0">' +
            '<thead class="table-light" style="position:sticky;top:0;z-index:1;"><tr>' +
              '<th class="text-center small">#</th>' +
              '<th class="small">Aerolínea</th>' +
              '<th class="text-end small">Vuelos</th>' +
              '<th class="text-end small fw-bold">Pax Total</th>' +
              '<th class="text-end small" style="color:#d63384;">Llegadas</th>' +
              '<th class="text-end small" style="color:#6610f2;">Salidas</th>' +
              '<th class="text-end small">% Día</th>' +
              '<th class="small">Horas operadas</th>' +
            '</tr></thead>' +
            '<tbody>' + (airRows || '<tr><td colspan="8" class="text-center text-muted py-3">Sin datos</td></tr>') + '</tbody>' +
          '</table>' +
        '</div></div>' +
      '</div>';

    // Draw hourly charts after DOM is ready
    if (hasHour) {
      setTimeout(() => {
        // Chart 1: arrivals vs departures totals
        const ctx3 = document.getElementById('mdb-chart-hour-detail');
        if (ctx3) {
          if (_charts.hourDetail) { try { _charts.hourDetail.destroy(); } catch (_) {} }
          const labels3 = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00 – ' + ((i + 1) % 24).toString().padStart(2, '0') + ':00');
          _charts.hourDetail = new Chart(ctx3, {
            type: 'bar',
            plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
            data: {
              labels: labels3,
              datasets: [
                { label: 'Llegadas', data: arrH, backgroundColor: relleno('#d63384'), stack: 'S',
                  borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 3, bottomRight: 3 } },
                { label: 'Salidas',  data: depH, backgroundColor: relleno('#6610f2'), stack: 'S',
                  borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 } }
              ]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { position: 'top' },
                datalabels: { display: false },
                tooltip: { callbacks: {
                  title: items => labels3[items[0].dataIndex],
                  label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw) + (totH[c.dataIndex] ? ' (' + pct(c.raw, totH[c.dataIndex]) + ' hora)' : ''),
                  footer: items => 'Total hora: ' + fmt(totH[items[0].dataIndex]) + ' (' + (grandH ? pct(totH[items[0].dataIndex], grandH) : '—') + ' del día)'
                }}
              },
              scales: {
                x: { stacked: true, ticks: { font: { size: 10 } } },
                y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } }
              }
            }
          });
        }

        // Charts 2-4: per-airline breakdown
        if (topAirlines.length) {
          const hlbls = activeHours.map(h => hlbl(h));
          function buildAirDS(dir) {
            return topAirlines.map((airName, i) => ({
              label: airName,
              data: activeHours.map(h => {
                const v = (hourAirMap[h] || {})[airName];
                if (!v) return 0;
                return dir === 'arr' ? v.arr : dir === 'dep' ? v.dep : v.arr + v.dep;
              }),
              backgroundColor: AIR_COLORS[i % AIR_COLORS.length] + 'CC',
              stack: 'S'
            }));
          }
          const airOpts = () => ({
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 12 } },
              datalabels: { display: false },
              tooltip: { callbacks: {
                title: items => hlbls[items[0].dataIndex],
                label: c => ' ' + c.dataset.label + ': ' + fmt(c.raw)
              }}
            },
            scales: {
              x: { stacked: true, ticks: { font: { size: 9 } } },
              y: { stacked: true, beginAtZero: true, ticks: { callback: tickK } }
            }
          });

          const ctx2 = document.getElementById('mdb-chart-hour-airline-total');
          if (ctx2) {
            if (_charts.hourAirTotal) { try { _charts.hourAirTotal.destroy(); } catch (_) {} }
            _charts.hourAirTotal = new Chart(ctx2, {
              type: 'bar', plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
              data: { labels: hlbls, datasets: buildAirDS('total') },
              options: airOpts()
            });
          }
          const ctxArr = document.getElementById('mdb-chart-hour-airline-arr');
          if (ctxArr) {
            if (_charts.hourAirArr) { try { _charts.hourAirArr.destroy(); } catch (_) {} }
            _charts.hourAirArr = new Chart(ctxArr, {
              type: 'bar', plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
              data: { labels: hlbls, datasets: buildAirDS('arr') },
              options: airOpts()
            });
          }
          const ctxDep = document.getElementById('mdb-chart-hour-airline-dep');
          if (ctxDep) {
            if (_charts.hourAirDep) { try { _charts.hourAirDep.destroy(); } catch (_) {} }
            _charts.hourAirDep = new Chart(ctxDep, {
              type: 'bar', plugins: window.ChartDataLabels ? [ChartDataLabels] : [],
              data: { labels: hlbls, datasets: buildAirDS('dep') },
              options: airOpts()
            });
          }
        }

        // Wire expandable rows in hourly table
        const tbl = document.getElementById('mdb-tbl-hour-detail');
        if (tbl) {
          tbl.querySelectorAll('tr.hour-summary-row').forEach(tr => {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
              const h = tr.dataset.h;
              const subs = tbl.querySelectorAll('tr.hour-airline-sub[data-h="' + h + '"]');
              const chev = tr.querySelector('.hour-chevron');
              const isOpen = subs.length && subs[0].style.display !== 'none';
              subs.forEach(s => { s.style.display = isOpen ? 'none' : ''; });
              if (chev) chev.style.transform = isOpen ? '' : 'rotate(90deg)';
            });
          });
        }
      }, 0);
    }
  }

  const DISPLAY_COLS = [
    { label:'Mes',             key:'MES' },
    { label:'Fecha',           key:'FECHA' },
    { label:'Tipo Manifiesto', key:'TIPO DE MANIFIESTO' },
    { label:'Aerol\u00ednea', key:'AEROLINEA', logo: true },
    { label:'Tipo Op.',        key:'TIPO DE OPERACION', altKey:'TIPO DE OPERACI\u00d3N' },
    { label:'Equipo',          key:'EQUIPO', altKey:'AERONAVE' },
    { label:'Matr\u00edcula', key:'MATRICULA', altKey:'MAT\u00cdCULA' },
    { label:'# Vuelo',         key:'# DE VUELO' },
    { label:'Dest./Origen',    key:'DESTINO / ORIGEN' },
    { label:'Hora Op.',        key:'HR. DE OPERACIÓN', altKey:'HR. DE OPERACION' },
    { label:'Total Pax',       key:'TOTAL PAX',          num: true },
    { label:'TUA',             key:'PAX QUE PAGAN TUA', altKey:'PAX. QUE PAGAN TUA', num: true },
    { label:'Infantes',        key:'INFANTES',            num: true },
    { label:'Tr\u00e1nsitos', key:'TRANSITOS',           num: true },
    { label:'Conexiones',      key:'CONEXIONES',          num: true },
    { label:'Diplom\u00e1ticos', key:'DIPLOMATICOS',      num: true },
    { label:'En Comisi\u00f3n', key:'EN COMISION',        num: true },
    { label:'Total Exentos',   key:'TOTAL EXENTOS',       num: true },
    { label:'Kgs. Equipaje',   key:'KGS. DE EQUIPAJE',    num: true },
  ];

  function renderTable(data) { _tableData = data || _filtered; _currentPage = 1; drawPage(); }

  function drawPage() {
    const thead = document.getElementById('mdb-main-thead');
    const tbody = document.getElementById('mdb-main-tbody');
    const info  = document.getElementById('mdb-table-info');
    const pgDiv = document.getElementById('mdb-pagination');
    if (!thead || !tbody) return;
    if (!_tableData.length) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="18" class="text-center py-4 text-muted">No hay registros para los filtros seleccionados.</td></tr>';
      if (info) info.textContent = '0 registros'; if (pgDiv) pgDiv.innerHTML = ''; return;
    }
    const first = _tableData[0];
    const active = DISPLAY_COLS.filter(c => first[c.key] !== undefined || (c.altKey && first[c.altKey] !== undefined));
    thead.innerHTML = '<tr>' + active.map(c => '<th class="text-nowrap small">' + c.label + '</th>').join('') + '</tr>';
    const total = _tableData.length, pages = Math.ceil(total / PAGE_SIZE);
    const start = (_currentPage - 1) * PAGE_SIZE;
    const slice = _tableData.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = slice.map(r => '<tr>' + active.map(c => {
      const v = r[c.key] !== undefined ? r[c.key] : (c.altKey ? r[c.altKey] : undefined);
      const d = v !== undefined && v !== null ? String(v) : '';
      if (c.logo && d) {
        return '<td class="small"><div class="d-flex align-items-center">' + airlineLogoHTML(d, 18) + escHtml(d) + '</div></td>';
      }
      return c.num
        ? '<td class="text-end small">' + (d !== '' ? fmt(parseInt(d, 10) || 0) : '-') + '</td>'
        : '<td class="small">' + escHtml(d) + '</td>';
    }).join('') + '</tr>').join('');
    if (info) info.textContent = 'Mostrando ' + (start+1) + '-' + Math.min(start+PAGE_SIZE, total) + ' de ' + fmt(total) + ' registros';
    if (pgDiv) {
      const range = buildPagRange(_currentPage, pages);
      pgDiv.innerHTML = range.map(p => {
        if (p === '...') return '<span class="px-1 text-muted">...</span>';
        return '<button class="btn btn-sm ' + (p === _currentPage ? 'btn-primary' : 'btn-outline-secondary') + '" data-pg="' + p + '">' + p + '</button>';
      }).join('');
      pgDiv.querySelectorAll('button[data-pg]').forEach(btn => {
        btn.addEventListener('click', () => { _currentPage = parseInt(btn.dataset.pg, 10); drawPage(); });
      });
    }
  }

  function buildPagRange(cur, tot) {
    if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1);
    const r = [1];
    if (cur > 3) r.push('...');
    for (let p = Math.max(2, cur-1); p <= Math.min(tot-1, cur+1); p++) r.push(p);
    if (cur < tot-2) r.push('...');
    r.push(tot); return r;
  }

  function exportExcel() {
    if (!window.XLSX) { alert('Librer\u00eda XLSX no disponible.'); return; }
    const ws = XLSX.utils.json_to_sheet(_filtered);
    const wb = XLSX.utils.book_new();
    // El nombre sale del período que se está viendo: el archivo decía
    // "2025" aunque se exportara abril de 2026 o la maestra.
    XLSX.utils.book_append_sheet(wb, ws, 'Manifiestos');
    XLSX.writeFile(wb, 'manifiestos_' + _activeTableKey + '_export.xlsx');
  }

  function showOverlay(msg)    { const ov = document.getElementById('mdb-overlay'); if (ov) { ov.style.display='flex'; ov.classList.remove('d-none'); } setOverlayText(msg); }
  function setOverlayText(m)  { const t  = document.getElementById('mdb-overlay-text'); if (t) t.textContent = m; }
  function hideOverlay()       { const ov = document.getElementById('mdb-overlay'); if (ov) { ov.style.display='none'; ov.classList.add('d-none'); } }
  function showBanner(type, html) {
    let b = document.getElementById('mdb-banner');
    if (!b) {
      b = document.createElement('div'); b.id = 'mdb-banner'; b.style.cssText = 'margin:12px 16px 0;';
      const pane = document.getElementById('aops-pane-manifiestos');
      if (pane) pane.insertBefore(b, pane.firstChild);
    }
    b.innerHTML = '<div class="alert alert-' + type + ' alert-dismissible fade show mb-0" role="alert">' + html + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
  }
  function hideBanner() { const b = document.getElementById('mdb-banner'); if (b) b.innerHTML = ''; }

  /* -------------------------------------------------------
     API PÚBLICA — usada por manifiestos-upload.js
  ------------------------------------------------------- */
  /**
   * Registra un nuevo período en TABLES y añade su botón en la UI.
   * Llamado por manifiestos-upload.js tras importar un mes exitosamente.
   * @param {string} key        - Clave interna, p.ej. "abr2026"
   * @param {string} tableName  - Nombre real de la tabla en Supabase
   * @param {string} label      - Etiqueta visible, p.ej. "Abril 2026 — Datos mensuales"
   */
  /** Recarga forzada de los datos del período activo — llamado tras importar. */
  window.manifiestoReload = function () {
    _loaded = false; _allData = [];
    delete _dataCache[_activeTableKey];
    limpiarAerolineas();
    load();
  };

  window.manifiestoRegisterTable = function (key, tableName, label) {
    // No registrar si ya existe
    if (TABLES[key]) { switchMdbPeriod(key); return; }
    TABLES[key] = { name: tableName, label: label };

    // Añadir botón en el grupo de períodos
    const group = document.querySelector('.btn-group[aria-label="Seleccionar período"]');
    if (group) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-primary mdb-period-btn';
      btn.dataset.table = tableName;
      btn.id = 'mdb-period-' + key;
      // Inferir mes del label (primera palabra)
      const parts = label.split(' ');
      btn.innerHTML = '<i class="fas fa-calendar-day me-1"></i>' + parts[0] + (parts[1] ? ' ' + parts[1] : '');
      btn.addEventListener('click', function () { switchMdbPeriod(key); });
      group.appendChild(btn);
    }

    // Cambiar al nuevo período
    switchMdbPeriod(key);
  };

})();
