// AIFA Operations Analysis Module - 2026 Refactor
// Focus: Database View (Year > Month > Table) with Pivot Capabilities
// Encapsulado en IIFE. API pública: window.AnalisisOperacionesModule
// Inicialización perezosa vía evento 'analisis-operaciones:visible' (despachado desde script.js).
;(function () {
    'use strict';

const OPS_MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

let currentYearOps = 2025;
let currentMonthOps = 'Enero';
let opsDataTable = null;
let opsRawData = [];

// Filtros activos del pane Slots (aerolínea + tipo de tráfico carga/pasajeros)
let _opsFilters = { airline: '', traffic: '' };

// Orden personalizado de la tabla
let _opsSortCol = '';
let _opsSortDir = 'asc';

// Si el usuario no ha elegido orden, ordenar por Hora Programada asc por defecto.
function _ensureDefaultSort() {
    if (_opsSortCol || !opsRawData || !opsRawData.length) return;
    const k = Object.keys(opsRawData[0]).find(
        k => /hora.{0,10}programada|hora.{0,5}prog\b|\bstd\b|\bsobt\b/i.test(k)
    );
    if (k) { _opsSortCol = k; _opsSortDir = 'asc'; }
}

// Cache key prefix
const OPS_CACHE_KEY = 'aifa_ops_cache_';

const OPS_MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Inicialización idempotente del módulo (se ejecuta al hacerse visible la sección)
let _moduleInitDone = false;
function init() {
    if (_moduleInitDone) return;
    if (!document.getElementById('aops-filter-year')) return;
    _moduleInitDone = true;
    initOpsAnalysisTabs();
}

async function initOpsAnalysisTabs() {
    if (!document.getElementById('aops-filter-year')) return;
    // Determinar el periodo más reciente con datos antes de pintar los selectores
    try { await _opsSetLatestPeriod(); } catch (e) { console.warn('No se pudo detectar el periodo más reciente', e); }
    populateOpsYearSelect();
    populateOpsMonthSelect();
    bindOpsFilters();
    loadOpsMonthData(currentMonthOps);
}

// Busca en Demoras el año/mes más reciente que tenga registros y ajusta
// currentYearOps / currentMonthOps para que la vista cargue por defecto lo más nuevo.
async function _opsSetLatestPeriod() {
    let client = window.supabaseClient;
    if (!client && window.ensureSupabaseClient) {
        client = await window.ensureSupabaseClient();
    }
    if (!client) return;

    const { data, error } = await client
        .from('Demoras')
        .select('ANIO, MES')
        .not('ANIO', 'is', null)
        .not('MES', 'is', null)
        .order('ANIO', { ascending: false })
        .order('MES', { ascending: false })
        .limit(1);

    if (error) { console.warn('Demoras latest period error:', error); return; }
    if (data && data.length) {
        const anio = parseInt(data[0].ANIO, 10);
        const mes = parseInt(data[0].MES, 10);
        if (anio) currentYearOps = anio;
        if (mes >= 1 && mes <= 12) currentMonthOps = OPS_MONTHS[mes - 1];
        console.log(`Periodo más reciente con datos: ${currentMonthOps} ${currentYearOps}`);
    }
}

// ─── Selectores de Año / Mes ───────────────────────────────────────────────
function populateOpsYearSelect() {
    const sel = document.getElementById('aops-filter-year');
    if (!sel) return;
    const thisYear = Math.max(new Date().getFullYear(), currentYearOps);
    const startYear = 2024;
    sel.innerHTML = '';
    for (let y = thisYear; y >= startYear; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = y;
        if (y === currentYearOps) opt.selected = true;
        sel.appendChild(opt);
    }
}

function populateOpsMonthSelect() {
    const sel = document.getElementById('ops-filter-month');
    if (!sel) return;
    const today = new Date();
    sel.innerHTML = '';
    OPS_MONTHS.forEach((m, i) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        const isFuture = (currentYearOps === today.getFullYear()) && (i > today.getMonth());
        if (isFuture) opt.disabled = true;
        if (m === currentMonthOps) opt.selected = true;
        sel.appendChild(opt);
    });
}

function bindOpsFilters() {
    const yearSel = document.getElementById('aops-filter-year');
    const monthSel = document.getElementById('ops-filter-month');
    const refreshBtn = document.getElementById('ops-btn-refresh');

    if (yearSel && !yearSel.dataset.opsBound) {
        yearSel.dataset.opsBound = '1';
        yearSel.addEventListener('change', () => {
            currentYearOps = parseInt(yearSel.value, 10) || currentYearOps;
            populateOpsMonthSelect();
            // Si el mes activo quedó deshabilitado (futuro), usar el último mes válido
            const ms = document.getElementById('ops-filter-month');
            if (ms && ms.selectedOptions[0] && ms.selectedOptions[0].disabled) {
                const enabled = [...ms.options].filter(o => !o.disabled);
                if (enabled.length) {
                    currentMonthOps = enabled[enabled.length - 1].value;
                    ms.value = currentMonthOps;
                }
            }
            loadOpsMonthData(currentMonthOps);
        });
    }

    if (monthSel && !monthSel.dataset.opsBound) {
        monthSel.dataset.opsBound = '1';
        monthSel.addEventListener('change', () => {
            loadOpsMonthData(monthSel.value);
        });
    }

    if (refreshBtn && !refreshBtn.dataset.opsBound) {
        refreshBtn.dataset.opsBound = '1';
        refreshBtn.addEventListener('click', () => {
            loadOpsMonthData(currentMonthOps, true);
        });
    }

    const airlineSel = document.getElementById('ops-filter-airline');
    if (airlineSel && !airlineSel.dataset.opsBound) {
        airlineSel.dataset.opsBound = '1';
        airlineSel.addEventListener('change', () => {
            _opsFilters.airline = airlineSel.value.trim().toUpperCase();
            applyOpsFiltersAndRender();
        });
    }

    const trafficSel = document.getElementById('ops-filter-traffic');
    if (trafficSel && !trafficSel.dataset.opsBound) {
        trafficSel.dataset.opsBound = '1';
        trafficSel.addEventListener('change', () => {
            _opsFilters.traffic = trafficSel.value;
            applyOpsFiltersAndRender();
        });
    }
}

// ─── Detección de columnas / clasificación de tráfico ──────────────────────
function _opsNormalizeStr(s) {
    return String(s).normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\/\s]+/g, '_')
        .toLowerCase().trim();
}

function _opsDetectKey(sampleRow, terms) {
    if (!sampleRow) return null;
    const keys = Object.keys(sampleRow);
    for (const term of terms) {
        const t = _opsNormalizeStr(term);
        let k = keys.find(k => _opsNormalizeStr(k) === t);
        if (k) return k;
        k = keys.find(k => _opsNormalizeStr(k).includes(t));
        if (k) return k;
    }
    return null;
}

const _OPS_AIRLINE_TERMS = ['aerolinea', 'aerol', 'airline', 'carrier'];
const _OPS_SERVICE_TERMS = ['servicio', 'tipo_de_servicio', 'service', 'tipo_servicio', 'service_type'];

// Clasifica un registro como pasajeros / carga usando el código de servicio
// cruzado con el catálogo flightservicetype.csv (columna "Tipo de Operación").
// Los vuelos mixtos (p.ej. L, Q, R) cuentan para ambos.
function _classifyOpsTraffic(serviceRaw) {
    const code = String(serviceRaw || '').trim().toUpperCase().split(/[\s\/,;]+/)[0];
    const ref = _opsMasterCatalogCache && _opsMasterCatalogCache.serviceTypeMap
        ? _opsMasterCatalogCache.serviceTypeMap[code]
        : null;
    const hay = _opsNormalizeStr(ref ? ref.operationType : serviceRaw);
    return {
        pax:   /pasajero/.test(hay),
        cargo: /carga|correo|freight|cargo/.test(hay)
    };
}

// Devuelve opsRawData aplicando los filtros activos (aerolínea + tipo)
function getFilteredOpsData() {
    const data = opsRawData || [];
    if (!data.length) return data;
    const { airline, traffic } = _opsFilters;
    const sample = data[0];
    const kAir = airline ? _opsDetectKey(sample, _OPS_AIRLINE_TERMS) : null;
    const kSvc = traffic ? _opsDetectKey(sample, _OPS_SERVICE_TERMS) : null;
    let result = (!airline && !traffic) ? [...data] : data.filter(r => {
        if (airline && kAir && String(r[kAir] || '').trim().toUpperCase() !== airline) return false;
        if (traffic && kSvc) {
            const t = _classifyOpsTraffic(r[kSvc]);
            if (traffic === 'pasajeros' && !t.pax) return false;
            if (traffic === 'carga' && !t.cargo) return false;
        }
        return true;
    });

    // Orden personalizado
    if (_opsSortCol) {
        const _ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
        const _FMT_DATE = /^(\d{2})\/(\d{2})\/(\d{4})\s*(.*)/;
        result = result.slice().sort((a, b) => {
            const va = a[_opsSortCol], vb = b[_opsSortCol];
            let cmp;
            // 1. Números nativos (ej. Tiempo_Demora INTEGER)
            if (typeof va === 'number' && typeof vb === 'number') {
                cmp = va - vb;
            } else {
                const sa = va == null ? '' : String(va);
                const sb = vb == null ? '' : String(vb);
                // 2. Timestamps ISO — ordenables lexicográficamente tal cual
                if (_ISO_DATE.test(sa) && _ISO_DATE.test(sb)) {
                    cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
                } else {
                    // 3. Fechas formateadas DD/MM/YYYY HH:MM
                    const ma = sa.match(_FMT_DATE), mb = sb.match(_FMT_DATE);
                    if (ma && mb) {
                        const da = `${ma[3]}${ma[2]}${ma[1]} ${ma[4]}`;
                        const db = `${mb[3]}${mb[2]}${mb[1]} ${mb[4]}`;
                        cmp = da < db ? -1 : da > db ? 1 : 0;
                    } else {
                        // 4. Números como string
                        const na = parseFloat(sa), nb = parseFloat(sb);
                        if (!isNaN(na) && !isNaN(nb) && String(na) === sa.trim() && String(nb) === sb.trim()) {
                            cmp = na - nb;
                        } else {
                            // 5. Texto general
                            cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
                        }
                    }
                }
            }
            return _opsSortDir === 'desc' ? -cmp : cmp;
        });
    }

    return result;
}

// Rellena el select de aerolíneas con los códigos presentes en los datos del mes
function populateOpsAirlineFilter(data) {
    const sel = document.getElementById('ops-filter-airline');
    if (!sel) return;
    const sample = (data && data[0]) || null;
    const kAir = sample ? _opsDetectKey(sample, _OPS_AIRLINE_TERMS) : null;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Todas</option>';
    if (!kAir) return;
    const catMap = (_opsMasterCatalogCache && _opsMasterCatalogCache.airlinesMap) || {};
    const counts = {};
    data.forEach(r => {
        const code = String(r[kAir] || '').trim().toUpperCase();
        if (code) counts[code] = (counts[code] || 0) + 1;
    });
    Object.keys(counts)
        .sort((a, b) => (catMap[a] || a).localeCompare(catMap[b] || b))
        .forEach(code => {
            const name = catMap[code] || code;
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = (name === code)
                ? `${code} (${counts[code]})`
                : `${code} — ${name} (${counts[code]})`;
            sel.appendChild(opt);
        });
    if (prev && counts[prev]) {
        sel.value = prev;
    } else {
        sel.value = '';
        _opsFilters.airline = '';
    }
}

// Aplica los filtros activos y re-renderiza tabla (y gráficas si está activa)
async function applyOpsFiltersAndRender() {
    if (_opsFilters.traffic && !_opsMasterCatalogCache) {
        try { await _loadOpsMasterCatalogs(); } catch (_) { }
    }
    const total = (opsRawData || []).length;
    const filtered = getFilteredOpsData();
    const countBadge = document.getElementById('record-count-badge');
    if (countBadge) {
        countBadge.textContent = (filtered.length === total)
            ? `${total.toLocaleString()} registros`
            : `${filtered.length.toLocaleString()} de ${total.toLocaleString()} registros`;
    }

    if (!filtered.length) {
        if (opsDataTable) { opsDataTable.destroy(); opsDataTable = null; }
        $('#ops-datatable').html(`
            <tbody>
                <tr><td colspan="100%" class="text-center text-muted py-5">
                    No hay registros para los filtros seleccionados.
                </td></tr>
            </tbody>
        `);
        return;
    }

    renderOpsTable(filtered);
    const checked = document.querySelector('input[name="viewmode"]:checked');
    const activeMode = checked ? checked.id.replace('view-', '') : 'table';
    if (activeMode === 'charts') {
        setTimeout(renderOpsCharts, 100);
    } else if (activeMode === 'informes') {
        setTimeout(renderOpsInformes, 60);
    }
}

function renderMonthPills() {
    const container = document.getElementById('ops-month-pills');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date();
    OPS_MONTHS.forEach((m, i) => {
        const isFuture = (currentYearOps === today.getFullYear()) && (i > today.getMonth());
        const isActive = (m === currentMonthOps);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ops-month-pill' + (isActive ? ' active' : '');
        btn.textContent = OPS_MONTHS_SHORT[i];
        btn.title = `${m} ${currentYearOps}`;
        btn.setAttribute('data-month', m);
        btn.disabled = isFuture;
        if (!isFuture) btn.addEventListener('click', () => loadOpsMonthData(m));
        container.appendChild(btn);
    });
    const disp = document.getElementById('ops-year-display');
    if (disp) disp.textContent = currentYearOps;
    // Disable next-year button if already at or past current year
    const btnNext = document.getElementById('ops-year-next-btn');
    if (btnNext) btnNext.disabled = currentYearOps >= today.getFullYear();
}

async function loadOpsMonthData(month, force = false) {
    currentMonthOps = month;

    // El historial de "Deshacer" es por periodo: al cambiar de mes/año se limpia.
    _opsUndoStack = [];
    _opsUpdateUndoBtn();

    // Sincronizar selectores de Año / Mes
    const yearSel = document.getElementById('aops-filter-year');
    if (yearSel && yearSel.value !== String(currentYearOps)) yearSel.value = String(currentYearOps);
    const monthSel = document.getElementById('ops-filter-month');
    if (monthSel && monthSel.value !== month) monthSel.value = month;

    const badge = document.getElementById('current-month-badge');
    if (badge) badge.textContent = `${month} ${currentYearOps}`;

    const countBadge = document.getElementById('record-count-badge');
    if (countBadge) countBadge.textContent = 'Cargando datos...';

    if (opsDataTable) {
        opsDataTable.destroy();
        $('#ops-datatable').empty();
        opsDataTable = null;
    }

    $('#pivot-output').empty();

    // 🔥 MAPA DE MESES (clave del cambio)
    const monthMap = {
        'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4,
        'Mayo': 5, 'Junio': 6, 'Julio': 7, 'Agosto': 8,
        'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12
    };

    const mesNumero = monthMap[month];

    if (!mesNumero) {
        console.error("Mes inválido:", month);
        return;
    }

    const cacheKey = `${OPS_CACHE_KEY}${currentYearOps}_${mesNumero}`;
    if (force) { try { sessionStorage.removeItem(cacheKey); } catch (_) { } }
    const cached = force ? null : getFromCache(cacheKey);

    if (cached) {
        opsRawData = _applyEstatusLogic(cached);
        _ensureDefaultSort();
        try { await _loadOpsMasterCatalogs(); } catch (_) { }
        populateOpsAirlineFilter(cached);
        applyOpsFiltersAndRender();
        return;
    }

    if (document.getElementById('ops-datatable')) {
        $('#ops-datatable').html(`
            <tbody>
                <tr>
                    <td colspan="100%" class="text-center py-5">
                        <div class="spinner-border text-primary"></div>
                        <p class="mt-2 text-muted">Consultando Demoras...</p>
                    </td>
                </tr>
            </tbody>
        `);
    }

    try {
        let client = window.supabaseClient;
        if (!client && window.ensureSupabaseClient) {
            client = await window.ensureSupabaseClient();
        }

        if (!client) throw new Error("Supabase client failed.");

        console.log(`Consultando Demoras (MES=${mesNumero}, ANIO=${currentYearOps})`);

        let allData = [];
        let from = 0;
        const batchSize = 1000;
        let moreData = true;

        while (moreData) {

            if (countBadge) countBadge.textContent = `Cargando... (${allData.length})`;

            const { data, error } = await client
                .from('Demoras') // 🔥 YA NO CAMBIA
                .select('*')
                .eq('MES', mesNumero)
                .eq('ANIO', currentYearOps)
                .range(from, from + batchSize - 1);

            if (error) {
                console.error("Supabase error:", error);
                throw error;
            }

            if (data && data.length > 0) {
                allData = allData.concat(data);
                from += batchSize;

                if (data.length < batchSize) {
                    moreData = false;
                }
            } else {
                moreData = false;
            }

            if (allData.length > 20000) {
                console.warn("Safety break >20k registros");
                moreData = false;
            }
        }

        if (!allData.length) {
            if (countBadge) countBadge.textContent = '0 registros';

            $('#ops-datatable').html(`
                <tbody>
                    <tr>
                        <td colspan="100%" class="text-center text-muted py-5">
                            No se encontraron registros.
                        </td>
                    </tr>
                </tbody>
            `);

            opsRawData = [];
            return;
        }

        saveToCache(cacheKey, allData);
        opsRawData = _applyEstatusLogic(allData);
        _ensureDefaultSort();

        try { await _loadOpsMasterCatalogs(); } catch (_) { }
        populateOpsAirlineFilter(allData);
        applyOpsFiltersAndRender();

    } catch (err) {
        console.error("Error:", err);

        if (countBadge) countBadge.textContent = 'Error';

        $('#ops-datatable').html(`
            <tbody>
                <tr>
                    <td colspan="100%" class="text-center text-danger py-5">
                        Error al cargar datos: ${err.message}
                    </td>
                </tr>
            </tbody>
        `);
    }
}

// Helpers for Cache
function saveToCache(key, data) {
    try {
        const payload = {
            timestamp: Date.now(),
            data: data
        };
        sessionStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
        console.warn("Storage quota exceeded or error saving cache", e);
    }
}

function getFromCache(key) {
    try {
        const item = sessionStorage.getItem(key);
        if (!item) return null;
        
        const payload = JSON.parse(item);
        // Valid for session
        return payload.data;
    } catch (e) {
        console.error("Cache parse error", e);
        return null;
    }
}

// ── ISO timestamp display helpers ─────────────────────────────────────────
const _ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
function _fmtIsoDateTime(val) {
    if (!val) return '—';
    const m = String(val).match(_ISO_RE);
    if (!m) return val;
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}
function _fmtIsoTime(val) {
    if (!val) return '—';
    const m = String(val).match(_ISO_RE);
    if (!m) return val;
    return `${m[4]}:${m[5]}`;
}
/** Combina una fecha base (ISO YYYY-MM-DD o DD/MM/YYYY) con una hora parcial ("HH:MM").
 *  Si timeVal ya contiene fecha completa la retorna tal cual.
 *  Usado para reconstruir fechahora cuando la BD almacena sólo la hora en algunas columnas. */
function _joinDateAndTime(dateVal, timeVal) {
    const t = String(timeVal || '').trim();
    if (!t) return String(dateVal || '').trim();
    // Ya es fecha-hora completa
    if (/\d{4}-\d{2}-\d{2}T/.test(t)) return t;
    const tMatch = t.match(/(\d{1,2}):(\d{2})/);
    if (!tMatch) return t;
    const hh = tMatch[1].padStart(2, '0'), mm = tMatch[2];
    const d = String(dateVal || '').trim();
    const isoDate = d.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return `${isoDate[1]}T${hh}:${mm}:00`;
    const slashDate = d.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashDate) return `${slashDate[3]}-${slashDate[2]}-${slashDate[1]}T${hh}:${mm}:00`;
    return t;
}

/**
 * Deriva el campo Estatus de un registro según las reglas de negocio:
 *   Ruta MMSM / NLU-NLU  → "Regreso a posición"
 *   Tiempo_Demora ausente → "Cancelado"
 *   −15 ≤ demora ≤ 15 min  → "A Tiempo"
 *   Resto               → "Demora"
 * Se aplica client-side en cada carga para que la tabla refleje siempre
 * la lógica actual, independientemente de lo que esté almacenado en la BD.
 */
// ── Lógica de Estatus ──────────────────────────────────────────────────────
// Derivación client-side aplicada en cada carga de datos para que la tabla
// refleje las reglas de negocio sin depender de lo que esté almacenado en DB.

/** Calcula el Estatus de una fila usando las claves ya resueltas. */
function _calcEstatusWithKeys(row, rutaKey, tiempoKey) {
    const ruta = String(rutaKey ? row[rutaKey] : '').trim().toUpperCase();
    if (ruta === 'MMSM' || ruta === 'NLU-NLU') return 'Regreso a posición';

    const raw = tiempoKey !== undefined ? row[tiempoKey] : undefined;
    if (raw === null || raw === undefined || raw === '') return 'Cancelado';

    // Forzar número: puede llegar como number, "15", "-5", "3,5"
    const min = typeof raw === 'number'
        ? raw
        : parseFloat(String(raw).replace(',', '.').trim());

    if (!isFinite(min)) return 'Cancelado';
    if (min >= -15 && min <= 15) return 'A Tiempo';
    return 'Demora';
}

/** Deriva Llegada/Salida a partir del campo Ruta y el Estatus ya calculado:
 *  — Regreso a posición: Ruta='MMSM'   → 'Salida'
 *                         Ruta termina '-NLU' → 'Llegada'
 *  — Demás casos:        Ruta empieza 'MMSM' o 'NLU-' → 'Salida'
 *                         Ruta termina '-NLU'           → 'Llegada'
 *                         Otro caso                     → valor original */
function _calcLlegadaSalidaWithKeys(row, rutaKey, llegadaSalidaKey, estatus) {
    const ruta    = String(rutaKey ? row[rutaKey] : '').trim().toUpperCase();
    const original = llegadaSalidaKey ? String(row[llegadaSalidaKey] ?? '') : '';

    if (estatus === 'Regreso a posición') {
        if (ruta === 'MMSM')          return 'Salida';
        if (ruta.endsWith('-NLU'))    return 'Llegada';
        return original;
    }
    // Casos normales
    if (ruta.startsWith('MMSM') || ruta.startsWith('NLU-')) return 'Salida';
    if (ruta.endsWith('-NLU'))                               return 'Llegada';
    return original;
}

/** Detecta las columnas Ruta y Tiempo-de-Demora con regex (agnóstico al casing
 *  y a si el nombre tiene espacios, guiones o underscores), luego aplica
 *  _calcEstatusWithKeys a cada fila. Resuelve las claves UNA sola vez. */
function _applyEstatusLogic(rows) {
    if (!rows || !rows.length) return rows;

    const keys = Object.keys(rows[0]);

    // /^ruta$/ — coincidencia exacta, case-insensitive
    const rutaKey = keys.find(k => /^ruta$/i.test(k));

    // Busca cualquier columna cuyo nombre contenga "tiempo" Y "demora"
    const tiempoKey = keys.find(k => /tiempo.{0,10}demora/i.test(k));

    // Busca la columna Llegada/Salida (variantes: llegada_salida, LlegadaSalida, etc.)
    const llegadaSalidaKey = keys.find(k => /llegada.{0,5}salida|salida.{0,5}llegada/i.test(k));

    console.log(
        '[Estatus] Columnas detectadas →',
        'Ruta:', rutaKey  ?? 'NO ENCONTRADO',
        '| Tiempo demora:', tiempoKey ?? 'NO ENCONTRADO',
        '| Valor muestra:', tiempoKey ? rows[0][tiempoKey] : '–',
        '| Tipo:', tiempoKey ? typeof rows[0][tiempoKey] : '–',
        '| Llegada/Salida:', llegadaSalidaKey ?? 'NO ENCONTRADO'
    );

    return rows.map(r => {
        const estatus = _calcEstatusWithKeys(r, rutaKey, tiempoKey);
        return {
            ...r,
            Estatus: estatus,
            ...(llegadaSalidaKey
                ? { [llegadaSalidaKey]: _calcLlegadaSalidaWithKeys(r, rutaKey, llegadaSalidaKey, estatus) }
                : { Llegada_Salida:    _calcLlegadaSalidaWithKeys(r, rutaKey, null, estatus) })
        };
    });
}

function _puntualidadBadge(horaProg, horaActual) {
    if (!horaProg || !horaActual || horaProg === horaActual) return '';
    const toMin = v => {
        const si = String(v).match(/T(\d{2}):(\d{2})/);
        if (si) return parseInt(si[1]) * 60 + parseInt(si[2]);
        const sm = String(v).match(/^(\d{2}):(\d{2})/);
        if (sm) return parseInt(sm[1]) * 60 + parseInt(sm[2]);
        return null;
    };
    const mSched  = toMin(horaProg);
    const mActual = toMin(horaActual);
    if (mSched === null || mActual === null) return '';
    const diff = mActual - mSched;
    if (diff < 0)  return `<span class="badge bg-success fw-normal">${Math.abs(diff)} min antes</span>`;
    if (diff === 0) return `<span class="badge bg-success fw-normal">A tiempo</span>`;
    if (diff <= 15) return `<span class="badge bg-warning text-dark fw-normal">+${diff} min</span>`;
    return `<span class="badge bg-danger fw-normal">+${diff} min</span>`;
}

function renderOpsTable(data) {
    if (!data || !data.length) return;

    const getOpsColumnWidth = (key) => {
        const columnKey = String(key || '').toLowerCase();
        const idNorm = columnKey.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

        if (idNorm === 'no' || idNorm === 'n' || idNorm === 'num' || idNorm === '') return '52px';
        // Hora Programada / Hora Actual muestran fecha+hora completa → ancho mayor
        if (/hora.{0,10}programada|hora.{0,10}actual|hora.{0,10}real/i.test(columnKey)) return '180px';
        // Encabezados largos: dar espacio suficiente para el nombre completo
        if (/domestic|international/.test(idNorm)) return '210px';
        if (/puntualidad/.test(idNorm)) return '190px';
        if (/aterrizaje|despegue/.test(idNorm)) return '175px';
        if (/fecha|hora/.test(idNorm)) return '145px';
        if (/codigo|motivo|observacion|descripcion/.test(idNorm)) return '240px';
        if (/pasajeros/.test(idNorm)) return '155px';
        if (/ruta|matricula|vuelo|aerolinea|equipo|avion/.test(idNorm)) return '160px';
        if (/tiempo|demora|minimo|maximo|monto/.test(idNorm)) return '140px';
        return '140px';
    };

    // Format ISO timestamps into readable date/time strings.
    // Todos los campos datetime en Demoras son TIMESTAMPTZ: siempre DD/MM/YYYY HH:MM.
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

    function formatOpsValue(key, value) {
        if (value === null || value === undefined || value === '') return '';
        const str = String(value);
        if (!ISO_RE.test(str)) return str;
        // Parse parts directly from the string to avoid TZ shifts
        const [datePart, timePart] = str.split('T');
        const [y, m, d] = datePart.split('-');
        const hhmm = timePart ? timePart.substring(0, 5) : '';
        return `${d}/${m}/${y} ${hhmm}`;
    }

    // 1. Dynamic Headers — se omite la columna índice del origen ("No." / "N°" / "#")
    // y en su lugar se agrega un consecutivo automático estrecho.
    const _isIndexCol = (key) => {
        const norm = String(key || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');
        return norm === 'no' || norm === 'n' || norm === 'num' || norm === '';
    };
    const consecutiveColumn = {
        title: 'No.',
        data: null,
        orderable: false,
        searchable: false,
        defaultContent: '',
        className: 'text-center align-middle text-muted',
        width: '48px',
        render: function (d, type, row, meta) {
            return meta.row + 1 + meta.settings._iDisplayStart;
        }
    };
    // Columnas ocultas por defecto (el usuario las puede reactivar con "Campos").
    // Se comparan por título normalizado (sin acentos/espacios/símbolos).
    const _normTitle = (t) => String(t || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '');
    const HIDDEN_BY_DEFAULT = new Set([
        'codigodeafacaifa',   // Código de Afac/aifa
        'serviciollegada',    // Servicio Llegada
        'serviciodesalida',   // Servicio de Salida
        'puntualidad',        // Puntualidad (NO la "Puntualidad Conciliada")
        'mes',                // Mes
        'anio'                // Anio
    ]);

    // Todas las columnas que aparecen DESPUÉS de "Tiempo de Demora" son editables
    // con guardado inmediato en BD (excepto las claves de periodo Mes/Año).
    const _dataKeys = Object.keys(data[0]).filter(key => !_isIndexCol(key));
    const _tiempoIdx = _dataKeys.findIndex(k => _opsNormId(k) === 'tiempodedemora');
    const _NON_EDITABLE_AFTER = new Set(['mes', 'anio', 'ano']);

    const columns = [consecutiveColumn].concat(
        _dataKeys.map((key, idx) => {
            const title = formatHeader(key);
            const normId = _opsNormId(key);
            const specialType = _OPS_EDITABLE_TYPES[_normTitle(title)];
            const isAfterDemora = _tiempoIdx >= 0 && idx > _tiempoIdx && !_NON_EDITABLE_AFTER.has(normId);
            let editType = specialType || (isAfterDemora ? 'text' : null);
            // Combos restringidos para Domestic/International y Llegada/Salida.
            if (isAfterDemora && !specialType) {
                if (normId === 'domesticinternational') editType = 'domint';
                else if (normId === 'llegadasalida') editType = 'llegsal';
                else if (normId === 'tipodeservicio') editType = 'servicio';
            }
            const isDemorasCol = _normTitle(title) === 'demoras';
            const col = {
                title: title,
                data: function (row) {
                    const value = row ? row[key] : '';
                    return formatOpsValue(key, value);
                },
                defaultContent: '',
                className: 'text-center align-middle' + (editType ? ' ops-editable' : ''),
                width: getOpsColumnWidth(key),
                visible: !HIDDEN_BY_DEFAULT.has(_normTitle(title))
            };
            if (editType) {
                col.createdCell = function (td) {
                    td.setAttribute('data-ops-edit', editType);
                    td.setAttribute('data-ops-keyid', normId);
                    td.setAttribute('data-ops-key', key);
                    td.setAttribute('title', 'Clic para editar y guardar');
                    if (isDemorasCol) td.setAttribute('data-ops-col', 'demoras');
                };
            } else if (isDemorasCol) {
                col.createdCell = function (td) {
                    td.setAttribute('data-ops-col', 'demoras');
                };
            }
            return col;
        })
    );

    // 2. Initialize DataTable
    const tableElement = $('#ops-datatable');
    tableElement.css('width', ''); // dejar que el CSS controle el ancho (auto + min-width)
    tableElement.empty(); // Clear loading message

    // Explicitly destroy if it exists (safety)
    if ($.fn.DataTable.isDataTable('#ops-datatable')) {
        $('#ops-datatable').DataTable().destroy();
    }

    // Clear previous filter elements globally just in case
    $('.excel-filter-dropdown').remove();
    $('.excel-filter-btn').remove();

    opsDataTable = tableElement.DataTable({
        data: data,
        columns: columns,
        destroy: true,
        ordering: false, // Disable column sorting (removes arrows and click-to-sort)
        deferRender: true, // Optimizes rendering speed for large datasets
        processing: true,
        autoWidth: false,
        paging: true,
        stateSave: false, // Don't save state (like width) to avoid corruption
        pageLength: 50,
        lengthMenu: [[25, 50, 100, 500, -1], [25, 50, 100, 500, "Todos"]],
        // UNA sola tabla. DataTables envuelve SOLO la tabla ('t') en un div
        // '.ops-scroll' (vía la opción dom). Ese div tiene max-height + overflow
        // y el thead usa position:sticky → encabezado fijo vertical, móvil
        // horizontal. Al ser una única tabla, encabezado y datos comparten las
        // MISMAS columnas: es imposible que se desfasen.
        autoWidth: false,
        dom: "<'row mb-2 align-items-center'<'col-sm-6'l><'col-sm-6'f>>" +
             "r" +
             "<'ops-scroll't>" +
             "<'row mt-2'<'col-sm-5'i><'col-sm-7'p>>",
        language: {
            search: 'Buscar:',
            searchPlaceholder: 'Filtrar...',
            lengthMenu: 'Mostrar _MENU_ registros',
            info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
            infoEmpty: 'Sin registros disponibles',
            infoFiltered: '(filtrado de _MAX_ registros totales)',
            zeroRecords: 'No se encontraron registros',
            emptyTable: 'No hay datos disponibles',
            processing: 'Procesando...',
            loadingRecords: 'Cargando...',
            paginate: {
                first: 'Primero',
                last: 'Último',
                next: 'Siguiente',
                previous: 'Anterior'
            }
        },
        initComplete: function () {
            const api = this.api();
            setTimeout(() => _opsInitScrollTable(api), 50);
        }
    });

    // Al mostrar/ocultar columnas (ColVis "Campos"), re-aplicar filtros + manijas
    tableElement.off('column-visibility.dt.opsCV').on('column-visibility.dt.opsCV', function () {
        setTimeout(() => {
            if (opsDataTable) {
                try { applyExcelFilters(opsDataTable); } catch (e) { console.warn('Excel filters', e); }
                _opsAttachResizers();
            }
        }, 60);
    });

    // Edición en línea (Código de Demora, Motivo, Estatus, Tipo de Servicio) con guardado inmediato en BD.
    _opsBindCellEditors();
    _loadDemorasCatalog().catch(() => {});
    _loadServiceTypeCatalog().catch(() => {});
}

// ── Encabezado fijo (tabla única, thead sticky) + ColVis ("Campos") + resize ──
function _opsInitScrollTable(api) {
    // Botón "Campos" (ColVis) colocado en el toolbar, sobre "Exportar Excel"
    try {
        const host = document.getElementById('ops-colvis-container');
        if (host && $.fn.dataTable && $.fn.dataTable.Buttons) {
            host.innerHTML = '';
            const colvis = new $.fn.dataTable.Buttons(api, {
                dom: { button: { className: 'btn btn-sm' } },
                buttons: [{
                    extend: 'colvis',
                    text: '<i class="fas fa-check-square me-1"></i>Campos',
                    className: 'btn-outline-primary',
                    titleAttr: 'Seleccionar columnas a mostrar',
                    columns: ':gt(0)', // todas menos el consecutivo "No."
                    collectionLayout: 'two-column',
                    postfixButtons: ['colvisRestore']
                }]
            });
            $(colvis.container()).appendTo(host);
        }
    } catch (e) { console.warn('ColVis init', e); }

    // Botón "Deshacer" a un costado del cuadro de buscar (deshace hasta 10 cambios)
    try {
        const wrapper = api.table().container();
        const filterLabel = wrapper ? wrapper.querySelector('.dataTables_filter') : null;
        if (filterLabel && !filterLabel.querySelector('.ops-undo-btn')) {
            const undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.className = 'btn btn-sm btn-outline-secondary ops-undo-btn ms-2';
            undoBtn.innerHTML = '<i class="fas fa-rotate-left me-1"></i>Deshacer';
            undoBtn.title = 'Deshacer el último cambio guardado (hasta 10)';
            undoBtn.addEventListener('click', () => _opsUndoLast());
            filterLabel.appendChild(undoBtn);
            _opsUpdateUndoBtn();
        }
    } catch (e) { console.warn('Undo btn', e); }

    // Botón "Borrar filtros" a la derecha del buscador
    try {
        const wrapper = api.table().container();
        const filterLabel = wrapper ? wrapper.querySelector('.dataTables_filter') : null;
        if (filterLabel && !filterLabel.querySelector('.ops-clear-filters')) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm btn-outline-danger ops-clear-filters ms-2';
            btn.innerHTML = '<i class="fas fa-filter-circle-xmark me-1"></i>Borrar filtros';
            btn.title = 'Limpiar todos los filtros de los encabezados y la búsqueda';
            btn.addEventListener('click', () => _opsClearAllFilters(api));
            filterLabel.appendChild(btn);
        }
    } catch (e) { console.warn('Clear filters btn', e); }

    // Filtros tipo Excel en cada encabezado (embudo)
    try { applyExcelFilters(api); } catch (e) { console.warn('Excel filters', e); }

    // ── Controles "Ordenar por" ──────────────────────────────────────────────
    try {
        const wrapper = api.table().container();
        const lengthDiv = wrapper ? wrapper.querySelector('.dataTables_length') : null;
        if (lengthDiv && !wrapper.querySelector('.ops-sort-controls')) {
            // Opciones de columna a partir de las keys del primer registro
            const keys = opsRawData && opsRawData.length ? Object.keys(opsRawData[0]) : [];
            const _normKey = k => String(k || '').normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const skipIndex = new Set(['no', 'n', 'num', '']);
            const colOptions = keys
                .filter(k => !skipIndex.has(_normKey(k)))
                .map(k => `<option value="${k}">${typeof formatHeader === 'function' ? formatHeader(k) : k}</option>`)
                .join('');

            const sortCtrl = document.createElement('div');
            sortCtrl.className = 'ops-sort-controls d-inline-flex align-items-center ms-3 gap-2 flex-wrap';
            sortCtrl.innerHTML =
                `<label class="text-muted small mb-0 me-1">Ordenar por:</label>` +
                `<select id="ops-sort-col" class="form-select form-select-sm" style="width:auto">` +
                `<option value="">— Sin orden —</option>${colOptions}</select>` +
                `<select id="ops-sort-dir" class="form-select form-select-sm" style="width:auto">` +
                `<option value="asc">Ascendente</option>` +
                `<option value="desc">Descendente</option></select>`;

            lengthDiv.appendChild(sortCtrl);

            // Restaurar selección previa si existe
            const colSel = document.getElementById('ops-sort-col');
            const dirSel = document.getElementById('ops-sort-dir');
            if (colSel && _opsSortCol) colSel.value = _opsSortCol;
            if (dirSel) dirSel.value = _opsSortDir;

            const onSortChange = () => {
                _opsSortCol = colSel ? colSel.value : '';
                _opsSortDir = dirSel ? dirSel.value : 'asc';
                try { applyOpsFiltersAndRender(); } catch (e) { console.warn('Sort error', e); }
            };
            if (colSel) colSel.addEventListener('change', onSortChange);
            if (dirSel) dirSel.addEventListener('change', onSortChange);
        }
    } catch (e) { console.warn('Sort controls init', e); }

    // ── Ancho mínimo garantizado para columnas de fecha+hora completa ────────
    // Se aplica directo sobre el <th> para que table-layout:fixed lo respete.
    try {
        const _HORA_FULL_RE = /hora.{0,10}programada|hora.{0,10}actual|hora.{0,10}real/i;
        document.querySelectorAll('#ops-datatable thead th').forEach(th => {
            const txt = th.textContent.trim()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toLowerCase().replace(/[^a-z\s]/g, '').trim();
            if (_HORA_FULL_RE.test(txt.replace(/\s+/g, '_'))) {
                th.style.minWidth = '180px';
                th.style.width    = '180px';
            }
        });
    } catch (e) { console.warn('Hora col width', e); }

    // Manijas para ajustar manualmente el ancho de las columnas
    _opsAttachResizers();
}

// Limpia todos los filtros por columna (embudos) + búsqueda global y
// restablece el icono de cada encabezado a su estado inactivo.
function _opsClearAllFilters(api) {
    if (!api) return;
    api.columns().search('');
    api.search('');
    api.draw();
    document.querySelectorAll('#ops-datatable thead .excel-filter-btn i')
        .forEach(i => { i.classList.remove('text-primary'); i.classList.add('text-muted'); });
    $('.excel-filter-dropdown').remove();
    $('.excel-filter-btn').removeClass('active');
}

// Permite arrastrar el borde derecho de cada encabezado para cambiar su ancho.
// Con UNA sola tabla (table-layout:fixed) basta con fijar el ancho del <th>; la
// columna entera (encabezado + celdas) toma ese ancho porque es la misma tabla,
// así que NUNCA se pierde la alineación.
function _opsAttachResizers() {
    const table = document.getElementById('ops-datatable');
    if (!table) return;
    table.style.tableLayout = 'fixed';
    const ths = Array.from(table.querySelectorAll('thead th'));

    // Congelar el ancho actual de cada columna y el total de la tabla, para que
    // el ajuste sea preciso y no se reparta el espacio sobrante.
    function freeze() {
        let total = 0;
        ths.forEach(h => {
            const w = h.offsetWidth;
            const px = w + 'px';
            h.style.width = px; h.style.minWidth = px; h.style.maxWidth = px;
            total += w;
        });
        table.style.width = total + 'px';
        table.style.minWidth = total + 'px';
    }

    ths.forEach((th) => {
        // NO tocar th.style.position: el CSS lo fija en `sticky` (encabezado fijo)
        // y sticky ya es un contexto de posicionamiento, así que la manija
        // absolute se ancla correctamente sin necesidad de `relative`.
        const old = th.querySelector('.ops-col-resizer');
        if (old) old.remove();

        const handle = document.createElement('div');
        handle.className = 'ops-col-resizer';
        handle.title = 'Arrastra para ajustar el ancho';
        th.appendChild(handle);

        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            freeze();
            const startX = e.pageX;
            const startW = th.offsetWidth;
            document.body.classList.add('ops-col-resizing');

            function onMove(ev) {
                const w = Math.max(40, startW + (ev.pageX - startX));
                const px = w + 'px';
                th.style.width = px; th.style.minWidth = px; th.style.maxWidth = px;
                let total = 0;
                ths.forEach(h => { total += h.offsetWidth; });
                table.style.width = total + 'px';
                table.style.minWidth = total + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('ops-col-resizing');
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Evitar que un click en la manija haga algo inesperado
        handle.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
    });
}


function formatHeader(key) {
    if(!key) return '';

    const normalizeKey = (value) => String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const headerMap = {
        'aerolinea': 'Aerolínea',
        'numero_vuelo': 'Número de Vuelo',
        'no_vuelo': 'No. Vuelo',
        'matricula': 'Matrícula',
        'tipo_de_avion': 'Tipo de Avión',
        'equipo': 'Equipo',
        'origen': 'Origen',
        'destino': 'Destino',
        'ruta': 'Ruta',
        'fecha': 'Fecha',
        'hora_programada': 'Hora Programada',
        'hora_real': 'Hora Actual',
        'estatus': 'Estatus',
        'demora': 'Demora',
        'tiempo_de_demora': 'Tiempo de Demora',
        'codigo_de_demora': 'Código de Demora',
        'cod_demora': 'Cód. Demora',
        'tipo_operacion': 'Tipo de Operación',
        'pasajeros': 'Pasajeros',
        'domestic_intern': 'Domestic/Intern',
        'llegada_salida': 'Llegada/Salida',
        'nacionalidad': 'Nacionalidad',
        'posicion': 'Posición',
        'plataforma': 'Plataforma',
        'observaciones': 'Observaciones'
    };

    const canonical = normalizeKey(key);
    if (headerMap[canonical]) {
        return headerMap[canonical];
    }

    const minorWords = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'al', 'por', 'para']);
    const cleaned = String(key)
        .replace(/[_.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('es-MX');

    return cleaned
        .split(' ')
        .map((word, index) => {
            if (!word) return word;
            if (index > 0 && minorWords.has(word)) return word;
            return word.charAt(0).toLocaleUpperCase('es-MX') + word.slice(1);
        })
        .join(' ');
}

// ════════════════════════════════════════════════════════════════════════
//  EDICIÓN EN LÍNEA CON GUARDADO INMEDIATO A BD (tabla Demoras)
//  Campos editables: Código de Demora, Motivo, Estatus. Al cambiar el valor
//  se persiste de inmediato en Supabase (update por PK "No").
//  Código de Demora: multiselección desde catalogo_demoras filtrada por
//  Llegada/Salida; al elegir se llena el campo "Demoras" con los "motivo"
//  del catálogo. Varios códigos/motivos se concatenan con ', '.
// ════════════════════════════════════════════════════════════════════════

const _OPS_EDITABLE_TYPES = { codigodedemora: 'codigo', motivo: 'motivo', estatus: 'estatus' };
const _OPS_STATUS_OPTIONS = ['A Tiempo', 'Demora', 'Cancelado', 'Alterno', 'Regreso a posición'];
// Opciones fijas para las columnas con combo restringido.
const _OPS_DOMINT_OPTIONS = ['Domestic', 'International'];
const _OPS_LLEGSAL_OPTIONS = ['Llegada', 'Salida'];

// ── Historial de "Deshacer" (máximo 10 acciones, por periodo) ─────────────
const _OPS_UNDO_MAX = 10;
let _opsUndoStack = [];

// Registra un cambio para poder deshacerlo. `prev` = valores a restaurar,
// `cur` = valores que quedaron (se muestran como "valor anterior" al deshacer).
function _opsPushUndo(pkKey, pkValue, prev, cur) {
    _opsUndoStack.push({ pkKey, pkValue, prev, cur });
    if (_opsUndoStack.length > _OPS_UNDO_MAX) _opsUndoStack.shift();
    _opsUpdateUndoBtn();
}

// Refleja en el botón cuántas acciones quedan por deshacer.
function _opsUpdateUndoBtn() {
    const btn = document.querySelector('.ops-undo-btn');
    if (!btn) return;
    btn.disabled = _opsUndoStack.length === 0;
    btn.innerHTML = '<i class="fas fa-rotate-left me-1"></i>Deshacer';
}

// Localiza el índice de fila de la tabla a partir del valor de la PK.
function _opsRowIdxByPk(pkKey, pkValue) {
    let idx = -1;
    if (!opsDataTable) return idx;
    opsDataTable.rows().every(function () {
        if (idx < 0 && String(this.data()[pkKey]) === String(pkValue)) idx = this.index();
    });
    return idx;
}

// Deshace el último cambio guardado: revierte los valores en BD y anima la fila.
async function _opsUndoLast() {
    if (!_opsUndoStack.length || !opsDataTable) return;
    const entry = _opsUndoStack.pop();
    _opsUpdateUndoBtn();
    try {
        await _opsPersistEdit(entry.pkKey, entry.pkValue, entry.prev);
        _opsEditToast('Cambio deshecho.');
        const rowIdx = _opsRowIdxByPk(entry.pkKey, entry.pkValue);
        if (rowIdx >= 0) {
            const cols = Object.keys(entry.prev || {}).map(k => ({
                selector: `td[data-ops-keyid="${_opsNormId(k)}"]`,
                value: entry.cur ? entry.cur[k] : entry.prev[k]
            }));
            _opsFinishEdit(rowIdx, cols);
        }
    } catch (err) {
        _opsEditToast('Error al deshacer: ' + err.message, true);
        _opsUndoStack.push(entry); // devolver a la pila si falló
        _opsUpdateUndoBtn();
    }
}

let _demorasCatalogCache = null;
let _serviceTypeCatalogCache = null;

// Carga (y cachea) el catálogo de tipos de servicio de vuelo (flight_service_type).
async function _loadServiceTypeCatalog() {
    if (_serviceTypeCatalogCache) return _serviceTypeCatalogCache;
    let client = window.supabaseClient;
    if (!client && window.ensureSupabaseClient) client = await window.ensureSupabaseClient();
    if (!client) return [];
    const { data, error } = await client
        .from('flight_service_type')
        .select('codigo, tipo_operacion, descripcion, categoria')
        .order('codigo', { ascending: true });
    if (error) { console.warn('flight_service_type error:', error); return []; }
    _serviceTypeCatalogCache = data || [];
    return _serviceTypeCatalogCache;
}

function _opsNormId(k) {
    return String(k || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Resuelve las claves reales (con acentos/espacios) de las columnas de la BD.
function _opsColKeys() {
    const sample = (opsRawData && opsRawData[0]) || {};
    const keys = Object.keys(sample);
    const find = (norm) => keys.find(k => _opsNormId(k) === norm);
    return {
        pk: find('no') || 'No',
        codigo: find('codigodedemora'),
        motivo: find('motivo'),
        estatus: find('estatus'),
        demoras: find('demoras'),
        llegadaSalida: keys.find(k => /llegada.{0,5}salida|salida.{0,5}llegada/i.test(k))
    };
}

// Carga (y cachea) el catálogo de códigos de demora agrupado por tipo de movimiento.
async function _loadDemorasCatalog() {
    if (_demorasCatalogCache) return _demorasCatalogCache;
    let client = window.supabaseClient;
    if (!client && window.ensureSupabaseClient) client = await window.ensureSupabaseClient();
    const empty = { LLEGADAS: [], SALIDAS: [], GENERAL: [], all: [] };
    if (!client) return empty;
    const { data, error } = await client
        .from('catalogo_demoras')
        .select('codigo, causa, descripcion, motivo, tipo_movimiento, activo')
        .eq('activo', true)
        .order('codigo', { ascending: true });
    if (error) { console.warn('catalogo_demoras error:', error); return empty; }
    const groups = { LLEGADAS: [], SALIDAS: [], GENERAL: [], all: data || [] };
    (data || []).forEach(r => {
        const mov = String(r.tipo_movimiento || '').trim().toUpperCase();
        if (groups[mov]) groups[mov].push(r);
    });
    _demorasCatalogCache = groups;
    return _demorasCatalogCache;
}

// Devuelve las opciones del catálogo aplicables según Llegada/Salida de la fila.
function _demorasOptionsForDirection(catalog, llegadaSalida) {
    const ls = String(llegadaSalida || '').trim().toUpperCase();
    if (ls.startsWith('LLEG')) return (catalog.LLEGADAS || []).concat(catalog.GENERAL || []);
    if (ls.startsWith('SAL')) return (catalog.SALIDAS || []).concat(catalog.GENERAL || []);
    return catalog.all || [];
}

// Persiste en Supabase y, sólo si tiene éxito, refleja el cambio en memoria e
// invalida la caché de sesión. (Si falla, el registro en memoria queda intacto.)
async function _opsPersistEdit(pkKey, pkValue, updates) {
    let client = window.supabaseClient;
    if (!client && window.ensureSupabaseClient) client = await window.ensureSupabaseClient();
    if (!client) throw new Error('Sin conexión con la base de datos.');
    const { error } = await client.from('Demoras').update(updates).eq(pkKey, pkValue);
    if (error) throw error;
    const row = (opsRawData || []).find(r => String(r[pkKey]) === String(pkValue));
    if (row) Object.assign(row, updates);
    // Invalidar caché de sesión del periodo actual para evitar datos obsoletos.
    try {
        const mesNumero = OPS_MONTHS.indexOf(currentMonthOps) + 1;
        sessionStorage.removeItem(`${OPS_CACHE_KEY}${currentYearOps}_${mesNumero}`);
    } catch (_) { }
}

// ── Resaltado animado + tooltip de la celda modificada ─────────────────────
// Marca la(s) celda(s) recién modificada(s) con una animación azul→verde→azul.
// Mientras dura la animación, al pasar el mouse aparece un cuadro con el dato
// que se guardó; al terminar la animación se limpia todo (clase + atributo).
function _opsMarkCellChanged(cell, changedValue) {
    if (!cell) return;
    cell.classList.remove('ops-cell-changed');
    // Reiniciar la animación si la celda ya estaba marcada.
    void cell.offsetWidth;
    cell.setAttribute('data-ops-changed', changedValue == null ? '' : String(changedValue));
    cell.classList.add('ops-cell-changed');
    let fallback;
    const cleanup = () => {
        cell.classList.remove('ops-cell-changed');
        cell.removeAttribute('data-ops-changed');
        cell.removeEventListener('animationend', cleanup);
        clearTimeout(fallback);
        _opsHideChangeTip();
    };
    cell.addEventListener('animationend', cleanup);
    fallback = setTimeout(cleanup, 122000); // red de seguridad si no dispara animationend
}

function _opsHideChangeTip() {
    const tip = document.getElementById('ops-change-tip');
    if (tip) tip.style.display = 'none';
}

// Anima las celdas cambiadas y restaura su contenido renderizado SIN redibujar
// toda la tabla (así las animaciones de otras celdas en curso no se reinician).
// changedCols: [{ selector, value, key }] — selector CSS del td; value = valor
// anterior (para el tooltip); key = clave real de la columna (para re-render).
function _opsFinishEdit(rowIdx, changedCols) {
    if (!opsDataTable) return;
    // Actualiza el cache interno de DataTables (búsqueda/orden) sin tocar el DOM.
    try { opsDataTable.row(rowIdx).invalidate('data'); } catch (_) { }
    let trNode = null;
    try { trNode = opsDataTable.row(rowIdx).node(); } catch (_) { }
    if (!trNode) return;
    const rowData = (() => { try { return opsDataTable.row(rowIdx).data() || {}; } catch (_) { return {}; } })();
    (changedCols || []).forEach(c => {
        const cell = trNode.querySelector(c.selector);
        if (!cell) return;
        // Restaurar el contenido de la celda (elimina el editor y refleja el valor
        // nuevo). Las columnas editables nunca son fechas, así que basta String().
        if (c.key !== undefined && c.key !== null) {
            const v = rowData[c.key];
            cell.textContent = (v == null) ? '' : String(v);
        }
        _opsMarkCellChanged(cell, c.value);
    });
}

// Aviso breve tipo toast en la esquina inferior derecha.
function _opsEditToast(message, isError) {
    let host = document.getElementById('ops-edit-toast');
    if (!host) {
        host = document.createElement('div');
        host.id = 'ops-edit-toast';
        host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:20000;padding:10px 16px;border-radius:8px;color:#fff;font-size:.85rem;box-shadow:0 4px 12px rgba(0,0,0,.2);transition:opacity .3s;opacity:0;';
        document.body.appendChild(host);
    }
    host.style.background = isError ? '#dc3545' : '#198754';
    host.textContent = message;
    host.style.opacity = '1';
    clearTimeout(host._t);
    host._t = setTimeout(() => { host.style.opacity = '0'; }, 2200);
}

// Restaura el render normal de UNA celda (cierra el editor) sin redibujar la
// tabla, para no reiniciar las animaciones de otras celdas en curso.
function _opsRerenderRow(td) {
    if (!td || !opsDataTable) return;
    try {
        const rowData = opsDataTable.row(td).data() || {};
        const key = td.getAttribute('data-ops-key');
        if (key) {
            const v = rowData[key];
            td.textContent = (v == null) ? '' : String(v);
        } else {
            opsDataTable.cell(td).invalidate('data');
            const disp = opsDataTable.cell(td).render('display');
            if (disp != null) td.innerHTML = disp;
        }
    } catch (_) { }
}

// Editor de texto (Motivo).
function _openMotivoEditor(td) {
    const keys = _opsColKeys();
    const rowData = opsDataTable.row(td).data();
    if (!keys.motivo) return;
    const cur = rowData[keys.motivo] == null ? '' : String(rowData[keys.motivo]);
    const $inp = $('<textarea class="form-control form-control-sm ops-inline-editor" rows="2"></textarea>').val(cur);
    $(td).empty().append($inp);
    $inp.trigger('focus');
    let done = false;
    const commit = async () => {
        if (done) return; done = true;
        const val = $inp.val();
        if (val === cur) { _opsRerenderRow(td); return; }
        const rowIdx = opsDataTable.row(td).index();
        try {
            await _opsPersistEdit(keys.pk, rowData[keys.pk], { [keys.motivo]: val });
            _opsPushUndo(keys.pk, rowData[keys.pk], { [keys.motivo]: cur }, { [keys.motivo]: val });
            _opsEditToast('Motivo guardado.');
            _opsFinishEdit(rowIdx, [{ selector: 'td[data-ops-edit="motivo"]', value: cur, key: keys.motivo }]);
        } catch (err) {
            _opsEditToast('Error: ' + err.message, true);
            _opsRerenderRow(td);
        }
    };
    $inp.on('blur', commit);
    $inp.on('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $inp.trigger('blur'); }
        else if (e.key === 'Escape') { done = true; _opsRerenderRow(td); }
    });
}

// Editor de lista (Estatus).
function _openEstatusEditor(td) {
    const keys = _opsColKeys();
    const rowData = opsDataTable.row(td).data();
    if (!keys.estatus) return;
    const cur = rowData[keys.estatus] == null ? '' : String(rowData[keys.estatus]);
    const opts = _OPS_STATUS_OPTIONS.slice();
    if (cur && !opts.includes(cur)) opts.unshift(cur);
    const $sel = $('<select class="form-select form-select-sm ops-inline-editor"></select>');
    opts.forEach(o => $sel.append($('<option></option>').val(o).text(o).prop('selected', o === cur)));
    $(td).empty().append($sel);
    $sel.trigger('focus');
    let done = false;
    const commit = async () => {
        if (done) return; done = true;
        const val = $sel.val();
        if (val === cur) { _opsRerenderRow(td); return; }
        const rowIdx = opsDataTable.row(td).index();
        try {
            await _opsPersistEdit(keys.pk, rowData[keys.pk], { [keys.estatus]: val });
            _opsPushUndo(keys.pk, rowData[keys.pk], { [keys.estatus]: cur }, { [keys.estatus]: val });
            _opsEditToast('Estatus guardado.');
            _opsFinishEdit(rowIdx, [{ selector: 'td[data-ops-edit="estatus"]', value: cur, key: keys.estatus }]);
        } catch (err) {
            _opsEditToast('Error: ' + err.message, true);
            _opsRerenderRow(td);
        }
    };
    $sel.on('change', commit);
    $sel.on('blur', () => setTimeout(() => { if (!done) _opsRerenderRow(td); }, 150));
    $sel.on('keydown', e => { if (e.key === 'Escape') { done = true; _opsRerenderRow(td); } });
}

// Editor multiselección (Código de Demora) desde catalogo_demoras.
async function _openCodigoDemoraEditor(td) {
    const keys = _opsColKeys();
    if (!keys.codigo) return;
    const rowData = opsDataTable.row(td).data();
    $('.ops-codigo-dropdown').remove();

    const catalog = await _loadDemorasCatalog();
    const lsVal = keys.llegadaSalida ? String(rowData[keys.llegadaSalida] || '').trim() : '';
    const options = _demorasOptionsForDirection(catalog, lsVal);
    const currentCodes = String(rowData[keys.codigo] || '')
        .split(',').map(s => s.trim()).filter(Boolean);

    const rect = td.getBoundingClientRect();
    const menu = $('<div class="ops-codigo-dropdown bg-white shadow rounded border p-2"></div>').css({
        position: 'absolute',
        top: window.scrollY + rect.bottom + 4,
        left: Math.max(10, Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - 340)),
        zIndex: 20000, width: '330px', maxHeight: '380px', display: 'flex',
        flexDirection: 'column', fontSize: '.85rem'
    });

    menu.append(`<div class="fw-bold mb-1 small text-secondary">Código de Demora${lsVal ? ' · ' + lsVal : ''}</div>`);

    if (!options.length) {
        menu.append('<div class="text-muted small py-2">No hay códigos en el catálogo para esta dirección.</div>');
    }

    const search = $('<input type="text" class="form-control form-control-sm mb-2" placeholder="Buscar código, causa o motivo...">');
    if (options.length) menu.append(search);

    const list = $('<div class="overflow-auto border rounded p-1 mb-2 bg-light" style="max-height:230px;"></div>');
    menu.append(list);

    options.forEach((opt, i) => {
        const codigo = String(opt.codigo || '').trim();
        const causa = String(opt.causa || '').trim();
        const motivo = String(opt.motivo || '').trim();
        const desc = String(opt.descripcion || '').trim();
        const label = motivo || desc || causa;
        const item = $('<div class="form-check ms-1 mb-1 ops-cod-item"></div>');
        const chk = $('<input class="form-check-input ops-cod-chk" type="checkbox">')
            .attr('id', 'ops-cod-' + i)
            .prop('checked', currentCodes.includes(codigo))
            .data('opt', { codigo, motivo: motivo || label });
        const lbl = $('<label class="form-check-label" style="cursor:pointer;"></label>')
            .attr('for', 'ops-cod-' + i)
            .html(`<strong>${codigo}</strong>${causa ? ' · <span class="text-secondary">' + causa + '</span>' : ''}<br><span class="small text-muted">${label}</span>`);
        item.append(chk).append(lbl);
        list.append(item);
    });

    search.on('keyup', function () {
        const v = $(this).val().toLowerCase();
        list.find('.ops-cod-item').each(function () {
            $(this).toggle($(this).text().toLowerCase().indexOf(v) > -1);
        });
    });

    const footer = $('<div class="d-flex justify-content-end gap-2 pt-1 border-top"></div>');
    const cancelBtn = $('<button type="button" class="btn btn-sm btn-light border">Cancelar</button>');
    const okBtn = $('<button type="button" class="btn btn-sm btn-primary">Aceptar</button>');
    footer.append(cancelBtn).append(okBtn);
    menu.append(footer);

    cancelBtn.on('click', () => menu.remove());
    okBtn.on('click', async () => {
        const selected = [];
        list.find('.ops-cod-chk:checked').each(function () { selected.push($(this).data('opt')); });
        const codigoStr = selected.map(s => s.codigo).join(', ');
        const demorasStr = selected.map(s => s.motivo).filter(Boolean).join(', ');
        const updates = { [keys.codigo]: codigoStr };
        if (keys.demoras) updates[keys.demoras] = demorasStr;
        okBtn.prop('disabled', true).text('Guardando...');
        const rowIdx = opsDataTable.row(td).index();
        const oldCodigo = String(rowData[keys.codigo] || '');
        const oldDemoras = keys.demoras ? String(rowData[keys.demoras] || '') : '';
        try {
            await _opsPersistEdit(keys.pk, rowData[keys.pk], updates);
            const prev = { [keys.codigo]: oldCodigo };
            const cur = { [keys.codigo]: codigoStr };
            if (keys.demoras) { prev[keys.demoras] = oldDemoras; cur[keys.demoras] = demorasStr; }
            _opsPushUndo(keys.pk, rowData[keys.pk], prev, cur);
            _opsEditToast('Código de demora guardado.');
            menu.remove();
            const cols = [{ selector: 'td[data-ops-edit="codigo"]', value: oldCodigo, key: keys.codigo }];
            if (keys.demoras) cols.push({ selector: 'td[data-ops-col="demoras"]', value: oldDemoras, key: keys.demoras });
            _opsFinishEdit(rowIdx, cols);
        } catch (err) {
            _opsEditToast('Error: ' + err.message, true);
            menu.remove();
            _opsRerenderRow(td);
        }
    });

    $('body').append(menu);
    setTimeout(() => search.trigger('focus'), 30);
}

// Editor de texto genérico para las columnas posteriores a "Tiempo de Demora".
function _openGenericEditor(td) {
    const key = td.getAttribute('data-ops-key');
    if (!key) return;
    const keys = _opsColKeys();
    const rowData = opsDataTable.row(td).data();
    const cur = rowData[key] == null ? '' : String(rowData[key]);
    const $inp = $('<input type="text" class="form-control form-control-sm ops-inline-editor">').val(cur);
    $(td).empty().append($inp);
    $inp.trigger('focus').trigger('select');
    let done = false;
    const commit = async () => {
        if (done) return; done = true;
        const val = $inp.val();
        if (val === cur) { _opsRerenderRow(td); return; }
        const rowIdx = opsDataTable.row(td).index();
        const keyid = _opsNormId(key);
        try {
            await _opsPersistEdit(keys.pk, rowData[keys.pk], { [key]: val });
            _opsPushUndo(keys.pk, rowData[keys.pk], { [key]: cur }, { [key]: val });
            _opsEditToast('Cambio guardado.');
            _opsFinishEdit(rowIdx, [{ selector: `td[data-ops-keyid="${keyid}"]`, value: cur, key }]);
        } catch (err) {
            _opsEditToast('Error: ' + err.message, true);
            _opsRerenderRow(td);
        }
    };
    $inp.on('blur', commit);
    $inp.on('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); $inp.trigger('blur'); }
        else if (e.key === 'Escape') { done = true; _opsRerenderRow(td); }
    });
}

// Editor de lista con opciones fijas (Domestic/International, Llegada/Salida).
function _openFixedSelectEditor(td, options) {
    const key = td.getAttribute('data-ops-key');
    if (!key) return;
    const keys = _opsColKeys();
    const rowData = opsDataTable.row(td).data();
    const cur = rowData[key] == null ? '' : String(rowData[key]);
    const opts = options.slice();
    if (cur && !opts.some(o => o.toUpperCase() === cur.toUpperCase())) opts.unshift(cur);
    const $sel = $('<select class="form-select form-select-sm ops-inline-editor"></select>');
    opts.forEach(o => $sel.append(
        $('<option></option>').val(o).text(o).prop('selected', o.toUpperCase() === cur.toUpperCase())
    ));
    $(td).empty().append($sel);
    $sel.trigger('focus');
    let done = false;
    const commit = async () => {
        if (done) return; done = true;
        const val = $sel.val();
        if (val === cur) { _opsRerenderRow(td); return; }
        const rowIdx = opsDataTable.row(td).index();
        const keyid = _opsNormId(key);
        try {
            await _opsPersistEdit(keys.pk, rowData[keys.pk], { [key]: val });
            _opsPushUndo(keys.pk, rowData[keys.pk], { [key]: cur }, { [key]: val });
            _opsEditToast('Cambio guardado.');
            _opsFinishEdit(rowIdx, [{ selector: `td[data-ops-keyid="${keyid}"]`, value: cur, key }]);
        } catch (err) {
            _opsEditToast('Error: ' + err.message, true);
            _opsRerenderRow(td);
        }
    };
    $sel.on('change', commit);
    $sel.on('blur', () => setTimeout(() => { if (!done) _opsRerenderRow(td); }, 150));
    $sel.on('keydown', e => { if (e.key === 'Escape') { done = true; _opsRerenderRow(td); } });
}

// Editor de lista (Tipo de Servicio) alimentado por la tabla flight_service_type.
// El valor guardado es el "codigo"; al pasar el mouse sobre cada opción se muestra
// el "tipo_operacion" como leyenda (atributo title del <option>).
async function _openServicioEditor(td) {
    const key = td.getAttribute('data-ops-key');
    if (!key) return;
    const keys = _opsColKeys();
    const rowData = opsDataTable.row(td).data();
    const cur = rowData[key] == null ? '' : String(rowData[key]).trim();
    const keyid = _opsNormId(key);

    const $sel = $('<select class="form-select form-select-sm ops-inline-editor"></select>');
    $sel.append($('<option></option>').val('').text('— Cargando… —'));
    $(td).empty().append($sel);

    const catalog = await _loadServiceTypeCatalog();
    $sel.empty();
    $sel.append($('<option></option>').val('').text('— Sin especificar —'));
    let matched = false;
    catalog.forEach(c => {
        const codigo = String(c.codigo || '').trim();
        const tipo = String(c.tipo_operacion || '').trim();
        const desc = String(c.descripcion || '').trim();
        const isSel = codigo.toUpperCase() === cur.toUpperCase();
        if (isSel) matched = true;
        $sel.append($('<option></option>')
            .val(codigo)
            .text(desc ? `${codigo} · ${desc}` : codigo)
            .attr('title', tipo)
            .prop('selected', isSel));
    });
    // Conservar el valor actual aunque no esté en el catálogo.
    if (cur && !matched) {
        $sel.append($('<option></option>').val(cur).text(cur).prop('selected', true));
    }
    $sel.trigger('focus');

    let done = false;
    const commit = async () => {
        if (done) return; done = true;
        const val = $sel.val();
        if (val === cur) { _opsRerenderRow(td); return; }
        const rowIdx = opsDataTable.row(td).index();
        try {
            await _opsPersistEdit(keys.pk, rowData[keys.pk], { [key]: val });
            _opsPushUndo(keys.pk, rowData[keys.pk], { [key]: cur }, { [key]: val });
            _opsEditToast('Tipo de servicio guardado.');
            _opsFinishEdit(rowIdx, [{ selector: `td[data-ops-keyid="${keyid}"]`, value: cur, key }]);
        } catch (err) {
            _opsEditToast('Error: ' + err.message, true);
            _opsRerenderRow(td);
        }
    };
    $sel.on('change', commit);
    $sel.on('blur', () => setTimeout(() => { if (!done) _opsRerenderRow(td); }, 150));
    $sel.on('keydown', e => { if (e.key === 'Escape') { done = true; _opsRerenderRow(td); } });
}

// Vincula (una sola vez, vía delegación) la apertura de editores al hacer clic.
function _opsBindCellEditors() {
    $(document).off('click.opsCellEdit').on('click.opsCellEdit', '#ops-datatable tbody td.ops-editable', function (e) {
        const td = this;
        if ($(td).find('.ops-inline-editor').length) return; // editor ya abierto
        if ($(e.target).closest('.ops-inline-editor').length) return;
        if (!opsDataTable) return;
        const type = td.getAttribute('data-ops-edit');
        if (type === 'motivo') _openMotivoEditor(td);
        else if (type === 'estatus') _openEstatusEditor(td);
        else if (type === 'codigo') _openCodigoDemoraEditor(td);
        else if (type === 'domint') _openFixedSelectEditor(td, _OPS_DOMINT_OPTIONS);
        else if (type === 'llegsal') _openFixedSelectEditor(td, _OPS_LLEGSAL_OPTIONS);
        else if (type === 'servicio') _openServicioEditor(td);
        else _openGenericEditor(td);
    });
    // Cerrar el dropdown de código al hacer clic fuera de él y de su celda.
    $(document).off('click.opsCodigoClose').on('click.opsCodigoClose', function (e) {
        if (!$(e.target).closest('.ops-codigo-dropdown').length &&
            !$(e.target).closest('td.ops-editable[data-ops-edit="codigo"]').length) {
            $('.ops-codigo-dropdown').remove();
        }
    });
    // Tooltip con el dato modificado: SÓLO mientras la celda tiene la animación
    // activa (clase .ops-cell-changed). Al terminar la animación deja de mostrarse.
    $(document).off('mouseenter.opsChangeTip', '#ops-datatable tbody td.ops-cell-changed')
        .on('mouseenter.opsChangeTip', '#ops-datatable tbody td.ops-cell-changed', function () {
            const val = this.getAttribute('data-ops-changed');
            if (val == null) return;
            let tip = document.getElementById('ops-change-tip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'ops-change-tip';
                document.body.appendChild(tip);
            }
            tip.innerHTML = '';
            const title = document.createElement('div');
            title.className = 'ops-change-tip-title';
            title.textContent = 'Valor anterior';
            const body = document.createElement('div');
            body.className = 'ops-change-tip-body';
            body.textContent = val === '' ? '(vacío)' : val;
            tip.appendChild(title);
            tip.appendChild(body);
            const r = this.getBoundingClientRect();
            tip.style.display = 'block';
            const tw = tip.offsetWidth || 220;
            let left = r.left + (r.width / 2) - (tw / 2);
            left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
            let top = r.bottom + 6;
            if (top + (tip.offsetHeight || 60) > window.innerHeight) top = r.top - (tip.offsetHeight || 60) - 6;
            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
        })
        .off('mouseleave.opsChangeTip', '#ops-datatable tbody td.ops-cell-changed')
        .on('mouseleave.opsChangeTip', '#ops-datatable tbody td.ops-cell-changed', _opsHideChangeTip);
}

window.toggleViewMode = function(mode) {
    const tableWrap = document.getElementById('ops-table-wrapper');
    const chartsWrap = document.getElementById('ops-charts-wrapper');
    const informesWrap = document.getElementById('ops-informes-wrapper');

    // Hide all first
    if(tableWrap) tableWrap.classList.add('d-none');
    if(chartsWrap) chartsWrap.classList.add('d-none');
    if(informesWrap) informesWrap.classList.add('d-none');

    // Show selected
    if (mode === 'table') {
        if(tableWrap) tableWrap.classList.remove('d-none');
    } else if (mode === 'charts') {
        if(chartsWrap) chartsWrap.classList.remove('d-none');
        if (getFilteredOpsData().length > 0) {
            setTimeout(renderOpsCharts, 100); // Small delay to ensure container visible
        }
    } else if (mode === 'informes') {
        if(informesWrap) informesWrap.classList.remove('d-none');
        setTimeout(renderOpsInformes, 60);
    }
};

let _chartInstances = {};
let _opsMasterCatalogCache = null;

// ════════════════════════════════════════════════════════════════════════
//  INFORMES — réplica de las hojas del libro mensual de Demoras
//  (Totales, Pasajeros, Carga, Demoras, Puntualidad). Se calculan a partir
//  de los mismos registros de la tabla Demoras que alimentan este módulo,
//  reproduciendo los COUNTIFS/SUMPRODUCT de las hojas del Excel.
// ════════════════════════════════════════════════════════════════════════

// Normaliza texto (sin acentos, mayúsculas, sin espacios sobrantes) para comparar.
function _infNorm(v) {
    return String(v == null ? '' : v)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().toUpperCase();
}

// Detecta las columnas relevantes en los registros cargados.
function _infKeys(sample) {
    const keys = Object.keys(sample || {});
    const find = (re) => keys.find(k => re.test(k)) || null;
    return {
        aerolinea:     _opsDetectKey(sample, _OPS_AIRLINE_TERMS),
        servicio:      _opsDetectKey(sample, _OPS_SERVICE_TERMS),
        estatus:       find(/^estatus$/i) || find(/estatus/i),
        llegadaSalida: find(/llegada.{0,5}salida|salida.{0,5}llegada/i),
        domInt:        find(/domestic|internacional|domestico/i),
        causaDemora:   find(/^demoras$/i),
        puntualidad:   find(/^\s*puntualidad\s*$/i),
        puntCompania:  find(/puntualidad.*compa/i),
        pasajeros:     find(/^pasajeros$/i) || find(/pasajero|\bpax\b/i)
    };
}

function _infMonthLabel() {
    return `${currentMonthOps} ${currentYearOps}`;
}

const _INF_CAUSAS = {
    '1': 'Repercusión',
    '2': 'Compañía',
    '3': 'Autoridad',
    '4': 'Combustible',
    '5': 'Evento circunstancial',
    '6': 'Meteorología'
};

// ── Matriz A Tiempo / Demora / Cancelado × Llegada / Salida ────────────────
function _infMatrix(rows, keys, filterFn) {
    const res = { llegada: { a: 0, d: 0, c: 0 }, salida: { a: 0, d: 0, c: 0 } };
    rows.forEach(r => {
        if (filterFn && !filterFn(r)) return;
        const est = _infNorm(r[keys.estatus]);
        const ls = _infNorm(r[keys.llegadaSalida]);
        const bucket = ls.startsWith('LLEG') ? res.llegada
                     : ls.startsWith('SAL') ? res.salida : null;
        if (!bucket) return;
        if (est === 'A TIEMPO' || est === 'ALTERNO') bucket.a++;
        else if (est === 'DEMORA') bucket.d++;
        else if (est === 'CANCELADO') bucket.c++;
    });
    return res;
}

function _infMatrixTableHtml(title, m) {
    const row = (label, o) => {
        const total = o.a + o.d;
        const totalGen = total + o.c;
        return `<tr>
            <th class="table-light">${label}</th>
            <td class="text-end">${o.a.toLocaleString()}</td>
            <td class="text-end">${o.d.toLocaleString()}</td>
            <td class="text-end fw-semibold">${total.toLocaleString()}</td>
            <td class="text-end">${o.c.toLocaleString()}</td>
            <td class="text-end fw-bold">${totalGen.toLocaleString()}</td>
        </tr>`;
    };
    const tot = {
        a: m.llegada.a + m.salida.a,
        d: m.llegada.d + m.salida.d,
        c: m.llegada.c + m.salida.c
    };
    return `
    <div class="col-12 col-xl-6 mb-3">
        <div class="card border-0 shadow-sm h-100">
            <div class="card-header fw-bold py-2" style="background:linear-gradient(135deg,#1e3a8a,#2563eb) !important;color:#ffffff !important;font-size:.95rem;border-bottom:2px solid #16307a;">${title}</div>
            <div class="table-responsive">
                <table class="table table-sm table-bordered mb-0 align-middle text-center" style="font-size:.85rem">
                    <thead class="table-light">
                        <tr>
                            <th></th><th>A Tiempo</th><th>Demora</th><th>Total</th>
                            <th>Cancelados</th><th>Total general</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${row('Llegada', m.llegada)}
                        ${row('Salida', m.salida)}
                        <tr class="table-secondary fw-bold">
                            <th>Total</th>
                            <td class="text-end">${tot.a.toLocaleString()}</td>
                            <td class="text-end">${tot.d.toLocaleString()}</td>
                            <td class="text-end">${(tot.a + tot.d).toLocaleString()}</td>
                            <td class="text-end">${tot.c.toLocaleString()}</td>
                            <td class="text-end">${(tot.a + tot.d + tot.c).toLocaleString()}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

function _renderInformeTotales(rows, keys) {
    const el = document.getElementById('inf-totales-pane');
    if (!el) return;
    const general = _infMatrix(rows, keys);
    const domestic = keys.domInt ? _infMatrix(rows, keys, r => _infNorm(r[keys.domInt]).startsWith('DOM')) : null;
    const internal = keys.domInt ? _infMatrix(rows, keys, r => _infNorm(r[keys.domInt]).startsWith('INT')) : null;
    const pax = keys.servicio ? _infMatrix(rows, keys, r => _classifyOpsTraffic(r[keys.servicio]).pax) : null;
    const carga = keys.servicio ? _infMatrix(rows, keys, r => _classifyOpsTraffic(r[keys.servicio]).cargo) : null;

    let html = `<h5 class="fw-bold mb-1"><i class="fas fa-table-cells me-2 text-primary"></i>Totales de operaciones — ${_infMonthLabel()}</h5>
        <p class="text-muted small mb-3">Distribución de operaciones por estatus (A Tiempo / Demora / Cancelado) y sentido (Llegada / Salida).</p>
        <div class="row g-3">`;
    html += _infMatrixTableHtml('General', general);
    if (domestic) html += _infMatrixTableHtml('Nacional (Domestic)', domestic);
    if (internal) html += _infMatrixTableHtml('Internacional', internal);
    if (pax) html += _infMatrixTableHtml('Pasajeros', pax);
    if (carga) html += _infMatrixTableHtml('Carga', carga);
    html += '</div>';
    el.innerHTML = html;
}

// ── Slots por aerolínea (Pasajeros / Carga) ────────────────────────────────
function _infSlots(rows, keys, wantCargo) {
    const map = {};
    rows.forEach(r => {
        const est = _infNorm(r[keys.estatus]);
        if (est !== 'A TIEMPO' && est !== 'DEMORA') return;
        const t = _classifyOpsTraffic(r[keys.servicio]);
        if (wantCargo ? !t.cargo : !t.pax) return;
        const code = _infNorm(r[keys.aerolinea]);
        if (!code) return;
        const ls = _infNorm(r[keys.llegadaSalida]);
        const e = map[code] || (map[code] = { lleg: 0, sal: 0 });
        if (ls.startsWith('LLEG')) e.lleg++;
        else if (ls.startsWith('SAL')) e.sal++;
    });
    const catMap = (_opsMasterCatalogCache && _opsMasterCatalogCache.airlinesMap) || {};
    const arr = Object.keys(map).map(code => {
        const o = map[code];
        return { code, name: catMap[code] || code, lleg: o.lleg, sal: o.sal, total: o.lleg + o.sal };
    }).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
    const grand = arr.reduce((s, x) => s + x.total, 0);
    return { arr, grand };
}

function _renderInformeSlots(paneId, rows, keys, wantCargo) {
    const el = document.getElementById(paneId);
    if (!el) return;
    const tipo = wantCargo ? 'carga' : 'pasajeros';
    const { arr, grand } = _infSlots(rows, keys, wantCargo);
    const totLleg = arr.reduce((s, x) => s + x.lleg, 0);
    const totSal = arr.reduce((s, x) => s + x.sal, 0);

    let html = `<h5 class="fw-bold mb-1"><i class="fas fa-${wantCargo ? 'box' : 'users'} me-2 text-primary"></i>Slots asignados para ${tipo} — ${_infMonthLabel()}</h5>
        <p class="text-muted small mb-3">Operaciones realizadas (A Tiempo o Demora) por aerolínea de ${tipo}, separadas por sentido.</p>`;
    if (!arr.length) {
        html += '<div class="alert alert-secondary">No hay operaciones de este tipo en el periodo.</div>';
        el.innerHTML = html;
        return;
    }
    html += `<div class="table-responsive"><table class="table table-sm table-striped table-bordered align-middle mb-0" style="font-size:.85rem">
        <thead class="table-light"><tr>
            <th>Aerolínea</th>
            <th class="text-end">Slot de Llegada</th>
            <th class="text-end">Slot de Salida</th>
            <th class="text-end">Slots Totales</th>
            <th class="text-end">Porcentaje</th>
        </tr></thead><tbody>`;
    arr.forEach(x => {
        const pct = grand ? (x.total / grand * 100) : 0;
        html += `<tr>
            <td>${x.name === x.code ? x.code : `${x.name} <span class="text-muted">(${x.code})</span>`}</td>
            <td class="text-end">${x.lleg.toLocaleString()}</td>
            <td class="text-end">${x.sal.toLocaleString()}</td>
            <td class="text-end fw-semibold">${x.total.toLocaleString()}</td>
            <td class="text-end">${pct.toFixed(2)}%</td>
        </tr>`;
    });
    html += `<tr class="table-secondary fw-bold">
        <th>Total</th>
        <td class="text-end">${totLleg.toLocaleString()}</td>
        <td class="text-end">${totSal.toLocaleString()}</td>
        <td class="text-end">${grand.toLocaleString()}</td>
        <td class="text-end">100.00%</td>
    </tr></tbody></table></div>`;
    el.innerHTML = html;
}

// ── Demoras por causa ──────────────────────────────────────────────────────
function _renderInformeDemoras(rows, keys) {
    const el = document.getElementById('inf-demoras-pane');
    if (!el) return;
    const counts = {};
    let total = 0;
    rows.forEach(r => {
        if (_infNorm(r[keys.estatus]) !== 'DEMORA') return;
        const raw = String(r[keys.causaDemora] == null ? '' : r[keys.causaDemora]).trim();
        const code = raw.replace(/\..*$/, '').charAt(0) || '';
        const label = _INF_CAUSAS[code] || 'Sin clasificar';
        counts[label] = (counts[label] || 0) + 1;
        total++;
    });
    const order = ['Repercusión', 'Compañía', 'Meteorología', 'Combustible', 'Evento circunstancial', 'Autoridad', 'Sin clasificar'];
    const arr = Object.keys(counts)
        .sort((a, b) => (counts[b] - counts[a]) || (order.indexOf(a) - order.indexOf(b)));

    let html = `<h5 class="fw-bold mb-1"><i class="fas fa-clock me-2 text-primary"></i>Demoras por causa — ${_infMonthLabel()}</h5>
        <p class="text-muted small mb-3">Clasificación de las operaciones marcadas como <strong>Demora</strong> según su código de causa.</p>`;
    if (!total) {
        html += '<div class="alert alert-secondary">No hay demoras registradas en el periodo.</div>';
        el.innerHTML = html;
        return;
    }
    html += `<div class="table-responsive" style="max-width:640px"><table class="table table-sm table-striped table-bordered align-middle mb-0" style="font-size:.85rem">
        <thead class="table-light"><tr><th>Causa</th><th class="text-end">Demoras</th><th class="text-end">Porcentaje</th></tr></thead><tbody>`;
    arr.forEach(label => {
        const pct = (counts[label] / total * 100);
        html += `<tr><td>${label}</td><td class="text-end fw-semibold">${counts[label].toLocaleString()}</td><td class="text-end">${pct.toFixed(2)}%</td></tr>`;
    });
    html += `<tr class="table-secondary fw-bold"><th>Total</th><td class="text-end">${total.toLocaleString()}</td><td class="text-end">100.00%</td></tr>`;
    html += '</tbody></table></div>';
    el.innerHTML = html;
}

// ── Puntualidad por aerolínea ──────────────────────────────────────────────
function _renderInformePuntualidad(rows, keys) {
    const el = document.getElementById('inf-puntualidad-pane');
    if (!el) return;
    if (!keys.puntualidad) {
        el.innerHTML = `<h5 class="fw-bold mb-1"><i class="fas fa-bullseye me-2 text-primary"></i>Puntualidad — ${_infMonthLabel()}</h5>
            <div class="alert alert-warning">Los datos de este periodo no incluyen la columna <strong>Puntualidad</strong>.</div>`;
        return;
    }
    const map = {};
    rows.forEach(r => {
        const code = _infNorm(r[keys.aerolinea]);
        if (!code) return;
        const p = _infNorm(r[keys.puntualidad]);
        const pc = keys.puntCompania ? _infNorm(r[keys.puntCompania]) : '';
        const e = map[code] || (map[code] = { a: 0, d: 0, c: 0, imp: 0, cimp: 0, pax: 0, cargo: 0 });
        if (p === 'A TIEMPO') e.a++;
        else if (p === 'DEMORA') e.d++;
        else if (p === 'CANCELADO') e.c++;
        if (pc === 'COMPANIA') e.imp++;
        else if (pc === 'CANCELADO') e.cimp++;
        const t = _classifyOpsTraffic(r[keys.servicio]);
        if (t.cargo) e.cargo++; else if (t.pax) e.pax++;
    });
    const catMap = (_opsMasterCatalogCache && _opsMasterCatalogCache.airlinesMap) || {};
    const arr = Object.keys(map).map(code => {
        const o = map[code];
        const total = o.a + o.d + o.c;
        const totalImp = o.imp + o.cimp;
        const punt = total > 0 ? (1 - totalImp / total) * 100 : null;
        return {
            code, name: catMap[code] || code,
            categoria: o.cargo > o.pax ? 'Carga' : 'Pasajeros',
            a: o.a, d: o.d, c: o.c, total, imp: o.imp, cimp: o.cimp, totalImp, punt
        };
    }).filter(x => x.total > 0)
      .sort((a, b) => (b.punt == null ? -1 : b.punt) - (a.punt == null ? -1 : a.punt));

    let html = `<h5 class="fw-bold mb-1"><i class="fas fa-bullseye me-2 text-primary"></i>Puntualidad por aerolínea — ${_infMonthLabel()}</h5>
        <p class="text-muted small mb-3">Puntualidad = 100% − (Total imputables ÷ Total). Imputables = demoras/cancelaciones atribuibles a la compañía.</p>`;
    if (!arr.length) {
        html += '<div class="alert alert-secondary">No hay datos de puntualidad en el periodo.</div>';
        el.innerHTML = html;
        return;
    }
    html += `<div class="table-responsive"><table class="table table-sm table-striped table-bordered align-middle mb-0" style="font-size:.83rem">
        <thead class="table-light"><tr>
            <th>Categoría</th><th>Aerolínea</th>
            <th class="text-end">A tiempo</th><th class="text-end">Demora</th><th class="text-end">Cancelado</th>
            <th class="text-end">Total</th>
            <th class="text-end">Imputables</th><th class="text-end">Canc. imput.</th><th class="text-end">Total imput.</th>
            <th class="text-end">Puntualidad</th>
        </tr></thead><tbody>`;
    arr.forEach(x => {
        const puntTxt = x.punt == null ? '—' : `${x.punt.toFixed(1)}%`;
        const puntCls = x.punt == null ? '' : x.punt >= 85 ? 'text-success fw-bold' : x.punt >= 70 ? 'text-warning fw-bold' : 'text-danger fw-bold';
        html += `<tr>
            <td><span class="badge ${x.categoria === 'Carga' ? 'bg-info' : 'bg-primary'}">${x.categoria}</span></td>
            <td>${x.name === x.code ? x.code : `${x.name} <span class="text-muted">(${x.code})</span>`}</td>
            <td class="text-end">${x.a.toLocaleString()}</td>
            <td class="text-end">${x.d.toLocaleString()}</td>
            <td class="text-end">${x.c.toLocaleString()}</td>
            <td class="text-end fw-semibold">${x.total.toLocaleString()}</td>
            <td class="text-end">${x.imp.toLocaleString()}</td>
            <td class="text-end">${x.cimp.toLocaleString()}</td>
            <td class="text-end">${x.totalImp.toLocaleString()}</td>
            <td class="text-end ${puntCls}">${puntTxt}</td>
        </tr>`;
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
}

// Punto de entrada: renderiza todas las sub-pestañas de Informes.
async function renderOpsInformes() {
    const rows = getFilteredOpsData();
    const panes = ['inf-totales-pane', 'inf-pasajeros-pane', 'inf-carga-pane', 'inf-demoras-pane', 'inf-puntualidad-pane'];
    if (!rows || !rows.length) {
        panes.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="alert alert-secondary my-2">No hay registros para el periodo/filtros seleccionados.</div>';
        });
        return;
    }
    if (!_opsMasterCatalogCache) {
        try { await _loadOpsMasterCatalogs(); } catch (_) { }
    }
    const keys = _infKeys(rows[0]);
    _renderInformeTotales(rows, keys);
    _renderInformeSlots('inf-pasajeros-pane', rows, keys, false);
    _renderInformeSlots('inf-carga-pane', rows, keys, true);
    _renderInformeDemoras(rows, keys);
    _renderInformePuntualidad(rows, keys);
}

let _heatmapOpsHourDetails = null; // stores per-hour+day ops records for ops-hour heatmap drill-down
let _acMovFlights  = null; // { direction: { acType: [records] } } for aircraft-type bar drilldown
let _posFlights    = null; // { posName: [records] } for positions bar drilldown
let _peakHourFlightsStore = []; // flight records for the peak hour (used by modal drilldown)
let _peakHourLabel = '-';       // e.g. "12:00"

// Week-filter support for heatmaps
let _paxHeatWeeks     = {}; // { '0': all, 'YYYY-MM-DD': week starting that Monday, ... }
let _opsHourHeatWeeks = {}; // same for ops-hour heatmap
let _heatmapHasPax    = false;
const _HEATMAP_HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const _HEATMAP_DAY_LABELS  = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Returns a local date string (YYYY-MM-DD) of the Monday that starts the calendar week
// containing the given Date object.  Uses LOCAL date parts to avoid UTC timezone shifts.
function _isoMondayKey(date) {
    const d = new Date(date);
    const dow = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
    d.setDate(d.getDate() + diff);
    // Use local year/month/day — NOT toISOString() which converts to UTC
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Builds a human-readable date range label for a calendar week given its Monday key.
// E.g. "03–09 Feb" or "27 Ene–2 Feb" (cross-month).
function _calWeekLabel(mondayKey) {
    const MON = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const [y, m, d] = mondayKey.split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    const sun = new Date(y, m - 1, d + 6);
    const dd1 = String(mon.getDate()).padStart(2, '0');
    const dd2 = String(sun.getDate()).padStart(2, '0');
    if (mon.getMonth() === sun.getMonth()) {
        return `${dd1}–${dd2} ${MON[mon.getMonth()]}`;
    }
    return `${dd1} ${MON[mon.getMonth()]}–${dd2} ${MON[sun.getMonth()]}`;
}

// Returns array of 7 local day-of-month numbers [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
// for the calendar week whose Monday is given as "YYYY-MM-DD".
function _weekDayNumbers(mondayKey) {
    const [y, m, d] = mondayKey.split('-').map(Number);
    return Array.from({ length: 7 }, (_, i) => new Date(y, m - 1, d + i).getDate());
}

// ── Peak-hour drilldown modal ─────────────────────────────────────────────────
function _showPeakHourModal() {
    const flights = _peakHourFlightsStore;
    const hourLabel = _peakHourLabel;
    const nextH = hourLabel !== '-' ? String(Number(hourLabel.split(':')[0]) + 1).padStart(2,'0') + ':00' : '';
    const fmt = n => Number(n).toLocaleString('en-US');

    const isCargoFlight = f => /cargo|freight|carga|freighter/i.test(f.svcCat || f.servicio || '');
    const paxFlights   = flights.filter(f => !isCargoFlight(f));
    const cargoFlights = flights.filter(isCargoFlight);

    const MOV_BADGE = { 'Aterrizaje': 'bg-primary', 'Despegue': 'bg-success', 'Desconocido': 'bg-secondary' };

    const buildRows = list => list.map(f => {
        const movBadge = MOV_BADGE[f.movimiento] || 'bg-secondary';
        const movIcon  = f.movimiento === 'Aterrizaje' ? '&#9660;' : f.movimiento === 'Despegue' ? '&#9650;' : '&mdash;';
        return `<tr>
            <td class="fw-semibold">${f.vuelo || '&mdash;'}</td>
            <td>${f.aerolinea || '&mdash;'}</td>
            <td>${f.origen || '&mdash;'} &rarr; ${f.destino || '&mdash;'}</td>
            <td><span class="badge ${movBadge}" style="font-size:.7rem">${movIcon} ${f.movimiento || '?'}</span></td>
            <td>${f.aeronave || '&mdash;'}</td>
            <td class="text-end">${f.pax > 0 ? fmt(f.pax) : '&mdash;'}</td>
            <td><small class="text-muted">${f.hora || '&mdash;'}</small></td>
        </tr>`;
    }).join('');

    const tableHTML = (title, color, icon, list) => list.length === 0 ? '' : `
        <div class="mb-3">
            <div class="fw-semibold mb-1" style="color:${color};font-size:.85rem"><i class="fas ${icon} me-1"></i>${title} <span class="badge" style="background:${color};font-size:.7rem">${fmt(list.length)}</span></div>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0" style="font-size:.78rem">
                    <thead class="table-light"><tr>
                        <th>Vuelo</th><th>Aerolínea</th><th>Ruta</th><th>Mov.</th><th>Aeronave</th><th class="text-end">Pax</th><th>Hora</th>
                    </tr></thead>
                    <tbody>${buildRows(list)}</tbody>
                </table>
            </div>
        </div>`;

    const modalId = '_peak-hour-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.innerHTML = `
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header" style="background:linear-gradient(135deg,#fffbeb,#fef3c7)">
                        <div>
                            <h5 class="modal-title fw-bold mb-0"><i class="fas fa-clock text-warning me-2"></i>Vuelos en Hora Pico: <span id="_phm-title"></span></h5>
                            <div class="text-muted" style="font-size:.75rem" id="_phm-sub"></div>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="_phm-body"></div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    document.getElementById('_phm-title').textContent = `${hourLabel}–${nextH}`;
    document.getElementById('_phm-sub').textContent =
        `${fmt(flights.length)} operaciones totales · ${fmt(paxFlights.length)} pasajeros · ${fmt(cargoFlights.length)} carga`;
    document.getElementById('_phm-body').innerHTML =
        (paxFlights.length === 0 && cargoFlights.length === 0 ? tableHTML('Todas las operaciones', '#374151', 'fa-plane', flights) : '') +
        tableHTML('Vuelos de Pasajeros', '#2563eb', 'fa-users', paxFlights) +
        tableHTML('Vuelos de Carga', '#d97706', 'fa-boxes', cargoFlights);

    const bsModal = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    bsModal.show();
}


function _parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current.trim());
    return values;
}

function _parseCsvText(text) {
    const lines = String(text || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (!lines.length) return [];

    const headers = _parseCsvLine(lines[0]);
    return lines.slice(1).map(line => {
        const cols = _parseCsvLine(line);
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = cols[idx] ?? '';
        });
        return row;
    });
}

async function _loadOpsMasterCatalogs() {
    if (_opsMasterCatalogCache) return _opsMasterCatalogCache;

    const files = {
        airlines: 'data/master/airlines.csv',
        airports: 'data/master/airports.csv',
        aircraftTypes: 'data/master/aircraft type.csv',
        aircraftRegs: 'data/master/aircraft.csv',
        flightServiceType: 'data/master/flightservicetype.csv',
        delay: 'data/master/delay.csv',
        stands: 'data/master/stand.csv'
    };

    const fetchCsv = async (url) => {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`No se pudo cargar catálogo: ${url}`);
        return _parseCsvText(await response.text());
    };

    const [airlinesRows, airportsRows, aircraftRows, aircraftRegRows, serviceRows, delayRows, standsRows] = await Promise.all([
        fetchCsv(files.airlines),
        fetchCsv(files.airports),
        fetchCsv(files.aircraftTypes),
        fetchCsv(files.aircraftRegs).catch(() => []),
        fetchCsv(files.flightServiceType),
        fetchCsv(files.delay),
        fetchCsv(files.stands).catch(() => [])
    ]);

    const airlinesMap = {};
    airlinesRows.forEach(row => {
        const code = String(row.IATA || '').trim().toUpperCase();
        if (code) airlinesMap[code] = row.Name || code;
    });

    const airportsMap = {};
    airportsRows.forEach(row => {
        const iata = String(row.IATA || '').trim().toUpperCase();
        if (!iata) return;
        airportsMap[iata] = {
            name: row.Name || iata,
            country: (row.Country || '').trim(),
            city: (row.City || '').trim(),
            securityLevel: (row['Security level'] || '').trim()
        };
    });

    const aircraftMap = {};
    aircraftRows.forEach(row => {
        const iata = String(row['IATA code   '] || row['IATA code'] || '').trim().toUpperCase();
        if (!iata) return;
        aircraftMap[iata] = {
            name: row.Name || iata,
            group: row['Aircraft Type Groups'] || row['Design Group'] || ''
        };
    });

    // Registration → aircraft type code lookup (from aircraft.csv)
    // e.g. "XAVBZ" → "32Q", "N851GT" → "74N"
    const registrationMap = {};
    aircraftRegRows.forEach(row => {
        const reg  = String(row.Registration || '').trim().toUpperCase().replace(/[-\s]/g, '');
        const type = String(row['Aircraft Type'] || '').trim().toUpperCase();
        if (reg && type) registrationMap[reg] = type;
    });

    const serviceTypeMap = {};
    serviceRows.forEach(row => {
        // El CSV tiene encabezados en español ("Código,Categoria,Tipo de Operación,Descripción")
        // pero por compatibilidad aceptamos también variantes en inglés.
        const code = String(row['Código'] || row['Codigo'] || row.Code || '').trim().toUpperCase();
        if (!code) return;
        serviceTypeMap[code] = {
            category: row['Categoria'] || row['Categoría'] || row.Category || 'Otros',
            operationType: row['Tipo de Operación'] || row['Tipo de Operacion'] || row['Type of operation'] || 'No definido',
            description: row['Descripción'] || row['Descripcion'] || row.Description || ''
        };
    });

    const delayMap = {};
    delayRows.forEach(row => {
        const alpha   = String(row['Alpha code']   || '').trim().toUpperCase();
        const numeric = String(row['Numeric code'] || '').trim();
        const entry = {
            summary:     (row.Summary     || '').trim(),
            description: (row.Description || '').trim(),
            category:    (row.Category    || 'Otros').trim(),
            alpha, numeric
        };
        if (alpha)   delayMap[alpha]   = entry;
        if (numeric) delayMap[numeric] = entry;
    });

    const standsMap = {};
    standsRows.forEach(row => {
        const name = String(row.Name || '').trim();
        if (!name) return;
        const groups = String(row['Stand groups'] || '').toLowerCase();
        const type = String(row['Stand type'] || '').trim();
        let category;
        if (type === 'Hangar') category = 'Hangar';
        else if (type === 'Taxiway') category = 'Calle de Rodaje';
        else if (groups.includes('semi contact')) category = 'Semicontacto';
        else if (type === 'Contact' && groups.includes('international')) category = 'Contacto Internacional';
        else if (type === 'Contact') category = 'Contacto';
        else category = 'Remota';
        standsMap[name] = { type, category, groups: row['Stand groups'] || '' };
    });

    _opsMasterCatalogCache = {
        airlinesMap,
        airportsMap,
        aircraftMap,
        registrationMap,
        serviceTypeMap,
        delayMap,
        standsMap
    };

    return _opsMasterCatalogCache;
}

function _ensureOpsAdvancedStatsUi() {
    const wrap = document.getElementById('ops-charts-wrapper');
    if (!wrap) return;
    const row = wrap.querySelector('.row.g-3');
    if (!row) return;
    if (document.getElementById('ops-advanced-stats-anchor')) return;

    const anchor = document.createElement('div');
    anchor.id = 'ops-advanced-stats-anchor';
    anchor.className = 'col-12';
    anchor.innerHTML = `
        <hr class="my-1">
    `;
    row.appendChild(anchor);

    const kpiContainer = document.createElement('div');
    kpiContainer.className = 'col-12';
    kpiContainer.innerHTML = `
        <div class="row g-3">
            <div class="col-md-2">
                <div class="card h-100 border-0 shadow-sm p-3">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div style="width:32px;height:32px;border-radius:8px;background:#fef2f2;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="fas fa-hourglass-half text-danger" style="font-size:.8rem"></i>
                        </div>
                        <div style="font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:600">Demora promedio</div>
                    </div>
                    <div class="fw-bold text-danger" style="font-size:1.7rem" id="kpi-avg-delay">-</div>
                    <div class="text-muted" style="font-size:.71rem">minutos por vuelo demorado</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card h-100 border-0 shadow-sm p-3">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div style="width:32px;height:32px;border-radius:8px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="fas fa-check-circle text-success" style="font-size:.8rem"></i>
                        </div>
                        <div style="font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:600">% A tiempo (≤15 min)</div>
                    </div>
                    <div class="fw-bold text-success" style="font-size:1.7rem" id="kpi-on-time-rate">-</div>
                    <div class="text-muted" style="font-size:.71rem" id="kpi-on-time-detail">de vuelos con registro de demora</div>
                </div>
            </div>
            <div class="col-md-2">
                <div class="card h-100 border-0 shadow-sm p-3">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div style="width:32px;height:32px;border-radius:8px;background:#fffbeb;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="fas fa-exclamation-triangle text-warning" style="font-size:.8rem"></i>
                        </div>
                        <div style="font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:600">Causa de demora #1</div>
                    </div>
                    <div class="fw-bold text-warning" style="font-size:.85rem;line-height:1.3" id="kpi-top-delay-cause">-</div>
                    <div class="text-muted" style="font-size:.71rem" id="kpi-top-delay-count">— ocurrencias</div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-0 shadow-sm p-3">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div style="width:32px;height:32px;border-radius:8px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="fas fa-calendar-week text-primary" style="font-size:.8rem"></i>
                        </div>
                        <div style="font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:600">Semana pico (pax)</div>
                    </div>
                    <div class="fw-bold text-primary" style="font-size:.9rem;line-height:1.3" id="kpi-peak-week-passengers">-</div>
                    <div class="text-muted" style="font-size:.71rem">semana con más pasajeros del período</div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-0 shadow-sm p-3">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div style="width:32px;height:32px;border-radius:8px;background:#faf5ff;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="fas fa-route text-purple" style="font-size:.8rem;color:#7c3aed"></i>
                        </div>
                        <div style="font-size:.63rem;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:600">Ruta más operada</div>
                    </div>
                    <div class="fw-bold" style="font-size:.9rem;line-height:1.3;color:#7c3aed" id="kpi-top-route">-</div>
                    <div class="text-muted" style="font-size:.71rem" id="kpi-top-route-count">— vuelos en el período</div>
                </div>
            </div>
        </div>
    `;
    row.appendChild(kpiContainer);

    const chartsContainer = document.createElement('div');
    chartsContainer.className = 'col-12';
    chartsContainer.innerHTML = `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="card h-100 border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold">Demoras por Categoría</div>
                    <div class="card-body" id="delay-cat-body" style="position:relative;min-height:300px;">
                        <canvas id="chart-delay-categories"></canvas>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold">Aerolíneas (Top 10)</div>
                    <div class="card-body" style="position:relative;min-height:300px;">
                        <canvas id="chart-airline-share"></canvas>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold" data-chart-header="weekly-passengers">Pasajeros por Semana</div>
                    <div class="card-body" style="position:relative;min-height:300px;">
                        <canvas id="chart-weekly-passengers"></canvas>
                    </div>
                </div>
            </div>
            <div class="col-12">
                <div class="card h-100 border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold" data-chart-header="heatmap">Mapa de Calor de Pasajeros (Hora x Día)</div>
                    <div class="card-body" id="ops-passenger-heatmap"></div>
                </div>
            </div>
            <div class="col-12">
                <div class="card h-100 border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold">Mapa de Calor de Operaciones por Hora <small class="text-muted fw-normal">(excluye cancelados y no operativos)</small></div>
                    <div class="card-body" id="ops-hour-heatmap"></div>
                </div>
            </div>
            <div class="col-12" id="chart-ac-direction-col">
                <div class="card border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold">Aterrizajes y Despegues por Tipo de Aeronave</div>
                    <div class="card-body" id="ac-dir-body" style="position:relative;min-height:400px;">
                        <canvas id="chart-ac-direction"></canvas>
                    </div>
                </div>
            </div>
            <div class="col-12" id="chart-ac-airline-col">
                <div class="card border-0 shadow-sm">
                    <div class="card-header bg-white fw-bold">Tipos de Aeronave por Aerolínea</div>
                    <div class="card-body" id="ac-airline-body" style="position:relative;min-height:400px;">
                        <canvas id="chart-ac-airline"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;
    row.appendChild(chartsContainer);

    const summaryContainer = document.createElement('div');
    summaryContainer.className = 'col-12';
    summaryContainer.innerHTML = `
        <div class="card border-0 shadow-sm">
            <div class="card-header bg-white fw-bold">Resumen Interpretativo</div>
            <div class="card-body" id="ops-advanced-summary"></div>
        </div>
    `;
    row.appendChild(summaryContainer);
}

async function renderOpsCharts() {
    console.log("renderOpsCharts called");
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded');
        // Fallback for user
        const wrap = document.getElementById('ops-charts-wrapper');
        if(wrap) wrap.innerHTML = '<div class="alert alert-warning">Librería de Gráficos no cargada. Por favor recargue la página.</div>';
        return;
    }
    const data = getFilteredOpsData();
    if (!data || data.length === 0) {
        console.warn("No data for charts");
        return;
    }

    try {
        _ensureOpsAdvancedStatsUi();
        const catalogs = await _loadOpsMasterCatalogs();

        // Helper to extract keys safely — strips accents, normalizes / and spaces to _, case-insensitive, partial match
        const normalizeStr = (s) => String(s).normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\/\s]+/g, '_')
            .toLowerCase().trim();
        const getKey = (...terms) => {
            const keys = Object.keys(data[0]);
            for (const term of terms) {
                const t = normalizeStr(term);
                // Exact match (normalized)
                let k = keys.find(k => normalizeStr(k) === t);
                if (k) return k;
                // Partial match (normalized)
                k = keys.find(k => normalizeStr(k).includes(t));
                if (k) return k;
            }
            return undefined;
        };

        const allKeys = Object.keys(data[0]);
        console.log('[renderOpsCharts] Columnas de la tabla:', allKeys);

        // Date: try many possible column name patterns
        const kFecha = getKey('fecha', 'estatus_fecha', 'date', 'aterrizaje', 'despegue',
                              'programada', 'horario', 'std', 'sta', 'sobt', 'sibt',
                              'hora_programada', 'hora_real', 'created_at');
        // kHora: used for date/time extraction in parseDateFromRecord — keep original priority
        // so a full-datetime column (e.g. "Hora") is preferred over a time-only column
        let kHora = getKey('hora', 'time', 'hh', 'hora_prog', 'hora_real');
        if (kHora === kFecha) kHora = undefined; // avoid using same col twice

        // kHoraActual: dedicated column for the ACTUAL hour shown in the heatmap and hoursMap
        // This is separate so it can point to "Hora actual" (time-only) without breaking date parsing
        const kHoraActual = getKey('hora_actual', 'hora_real_local', 'hora_aterrizaje', 'hora_despegue');
        // kHoraProg: scheduled time column — used to show full datetime in drilldowns
        const kHoraProg = getKey('hora_programada', 'hora_prog', 'std', 'sobt');
        // If it turned out the same column as kFecha or kHora, ignore it (avoid duplicate use)
        // We want it to be a truly separate column

        const kPos = getKey('posicion', 'pos', 'platform', 'stand', 'plataforma');
        // Registration (matricula) vs aircraft type — intentionally kept separate
        const kMatricula = getKey('matricula', 'registro', 'equipo', 'equip', 'tail', 'aircraft_reg');
        const kTipoAc    = getKey('tipo_aeronave', 'tipo_avion', 'tipo_equipo', 'actype', 'aircraft_type',
                                   'tipo_eq', 'equipo_icao', 'icao_type', 'tipo_ac', 'tipo');
        // Keep kEquipo as the best guess for equipment (used by existing doughnut chart)
        const kEquipo = kTipoAc || kMatricula;
        const kAerolinea = getKey('aerolinea', 'aerol', 'airline', 'carrier');
        const kOrigen = getKey('origen', 'origin');
        const kDestino = getKey('destino', 'destination');
        const kDelayCode = getKey('codigo_de_demora', 'cod_demora', 'demora_codigo', 'delay_code', 'codigo');
        const kDelayMin = getKey('tiempo_de_demora', 'demora_min', 'minutos', 'delay_min', 'tiempo');
        const kServiceCode = getKey('servicio', 'tipo_de_servicio', 'service', 'tipo_servicio', 'service_type');
        const kPasajeros = getKey('pasajeros', 'pax', 'passengers');
        // Movement: 'llegada_salida' first — the slash-normalization in getKey converts
        // "Llegada/Salida" → "llegada_salida" so it matches exactly.
        const kMovimiento = getKey('llegada_salida', 'tipo_movimiento', 'tipo_vuelo',
                                   'movimiento', 'tipo_oper', 'tipo_op', 'movement',
                                   'direction', 'llegada', 'op_type');
        const kVuelo = getKey('vuelo', 'numero_vuelo', 'flight', 'flight_number',
                              'nro_vuelo', 'num_vuelo', 'nrovuelo', 'flight_no', 'flt_no');
        // Find the column that actually contains 'CANCELADO' by scanning all rows and columns.
        // This is more reliable than getKey() because the column name varies between tables.
        const allColKeys = Object.keys(data[0]);
        let kEstatus = getKey('demoras', 'estatus', 'status', 'estado', 'estatus_vuelo', 'flight_status');
        if (!kEstatus) {
            // Fallback: scan all rows to find whichever column has 'CANCELADO'
            kEstatus = allColKeys.find(col =>
                data.some(r => /^CANCELAD[AO]$/i.test(String(r[col] || '').trim()))
            );
        }

        const isCancelled = (r) => /^CANCELAD[AO]$/i.test(String(r[kEstatus] || '').trim());

        // Exclude cancelled flights from ALL analysis
        const activeData = kEstatus
            ? data.filter(r => !isCancelled(r))
            : data;
        const cancelledCount = data.length - activeData.length;
        console.log(`[renderOpsCharts] kEstatus="${kEstatus}" | Cancelados excluidos: ${cancelledCount} de ${data.length}`);

        // For the operations heatmap — also exclude non-operational flights
        const isNonOperational = (r) => /NO[\s._-]?OPERAT/i.test(String(r[kEstatus] || '').trim());
        const opsCleanData = activeData.filter(r => !isNonOperational(r));
        console.log(`[renderOpsCharts] opsCleanData (excl. cancel + no-op): ${opsCleanData.length}`);

        console.log('[renderOpsCharts] Keys detectadas:', {kFecha, kHora, kHoraActual, kPos, kMatricula, kTipoAc, kEquipo, kAerolinea, kMovimiento, kVuelo, kEstatus});

        // Stats
        let totalOps = activeData.length;
        let daysMap = {};
        let hoursMap = {};
        let hourPaxMap = {}; // { hourKey: totalPax } for peak-hour pax average
        let hourFlights = {}; // { hourKey: [records] } for peak-hour drilldown modal
        let posMap = {};
        let posTypeMap = {}; // { categoryLabel: totalCount }
        let simultMap  = {}; // { "HH:MM": count } — 10-min slot → total ops, all days
        let posFlights        = {};  // { posName: [records] } for position drilldown
        let acMovFlightsLocal = {};  // { direction: { acType: [records] } } for aircraft drilldown
        let eqMap = {};
        let airlineMap = {};
        let internationalOps = 0;
        let domesticOps = 0;
        let delayByCategory = {};
        let delayCodeCount = {};
        let serviceCategoryCount = {};
        let routeMap = {};
        let weeklyPassengers = {};
        let heatmapPassengers = {};
        let heatmapDetails    = {}; // { hourKey: { dayIndex: [flight records] } }
        let weeklyOps = {};       // fallback: ops per week when no pax
        let heatmapOps = {};      // fallback: ops per hour-day when no pax
        let heatmapOpsHour = {};        // ops-only heatmap (excl. cancelled + no-op): { hourKey: Array(7) }
        let heatmapOpsHourDetails = {}; // drill-down records for ops heatmap: { hourKey: { dayIndex: [records] } }
        // Per-week accumulators for filter buttons
        let heatmapPassengersByWeek = {}; // { weekNum: { hour: Array(7) } }
        let heatmapDetailsByWeek    = {}; // { weekNum: { hour: { dayIdx: [records] } } }
        let heatmapOpsByWeek        = {}; // fallback when no pax data
        let heatmapOpsHourByWeek        = {};
        let heatmapOpsHourDetailsByWeek = {};

        const parseDelayMinutes = (value) => {
            if (value === null || value === undefined) return null;
            const match = String(value).replace(',', '.').match(/-?\d+(\.\d+)?/);
            if (!match) return null;
            const parsed = Number(match[0]);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const parsePassengers = (value) => {
            if (value === null || value === undefined || value === '') return 0;
            const clean = String(value).replace(/[^\d.-]/g, '');
            const parsed = Number(clean);
            return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        };

        const parseDateFromRecord = (row) => {
            // Use kFecha first; use kHora as fallback if it contains a datetime
            const rawFecha = kFecha && row[kFecha] ? String(row[kFecha]).trim() : '';
            const rawHora  = kHora  && row[kHora]  ? String(row[kHora]).trim()  : '';
            // Pick the source that contains a 4-digit OR 2-digit year (e.g. DD/MM/YY)
            const has4DigitYear = (s) => /\d{4}/.test(s);
            const has2DigitSlash = (s) => /\d{2}\/\d{2}\/\d{2}(?!\d)/.test(s);
            let src;
            if (has4DigitYear(rawFecha)) {
                src = rawFecha;
            } else if (has4DigitYear(rawHora)) {
                src = rawHora;
            } else if (has2DigitSlash(rawFecha)) {
                src = rawFecha; // DD/MM/YY — handled below
            } else if (has2DigitSlash(rawHora)) {
                src = rawHora;
            } else {
                src = rawFecha;
            }

            let dateObj = null;
            let hourFromObj = null; // set when the Date object already carries correct local hour

            // DD/MM/YYYY or DD/MM/YYYY HH:mm — parse as local time, no timezone shift
            const slashMatch = src.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (slashMatch) {
                dateObj = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
            } else {
                // DD/MM/YY (2-digit year) — e.g. 01/02/25 → February 1, 2025
                const slashMatch2 = src.match(/(\d{2})\/(\d{2})\/(\d{2})(?!\d)/);
                if (slashMatch2) {
                    const yy = Number(slashMatch2[3]);
                    // Pivot: 00-49 → 2000s, 50-99 → 1900s (standard 2-digit year rule)
                    const yyyy = yy < 50 ? 2000 + yy : 1900 + yy;
                    dateObj = new Date(yyyy, Number(slashMatch2[2]) - 1, Number(slashMatch2[1]));
                }
            }
            if (!dateObj && src.includes('-')) {
                // ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm[Z|±HH:mm]
                const parsed = new Date(src);
                if (!Number.isNaN(parsed.getTime())) {
                    dateObj = parsed;
                    // If the raw string has an explicit timezone (Z or ±offset), the browser
                    // already converted to LOCAL time — use getHours() directly to avoid
                    // re-reading the UTC hour from the string (which would be wrong in UTC-6, etc.)
                    if (/Z$|[+-]\d{2}:\d{2}$/.test(src.trim())) {
                        hourFromObj = parsed.getHours();
                    }
                }
            } else if (src.match(/\d{1,2}[A-Za-z]{3}\d{2,4}/)) {
                // AIMS format: 01FEB26 or 01FEB2026
                const aimsParsed = new Date(src.replace(/(\d{1,2})([A-Za-z]{3})(\d{2,4})/, '$1 $2 $3'));
                if (!Number.isNaN(aimsParsed.getTime())) dateObj = aimsParsed;
            }

            if (!dateObj || Number.isNaN(dateObj.getTime())) return null;

            let hour;
            if (hourFromObj !== null) {
                // Timezone-aware ISO string — Date object already holds correct local hour
                hour = hourFromObj;
            } else {
                // Extract hour: prefer "Hora actual" column (time-only, most precise),
                // then fall back to finding HH:MM in the main date/time strings
                const rawHoraActual = kHoraActual && row[kHoraActual] ? String(row[kHoraActual]).trim() : '';
                const hhFromActual = (rawHoraActual.match(/(\d{1,2}):(\d{2})/) || [])[1];
                const hhFromFecha  = (src.match(/(\d{1,2}):(\d{2})/) || [])[1];
                const hhFromHora   = (rawHora.match(/(\d{1,2}):(\d{2})/) || [])[1];
                hour = Number(hhFromActual ?? hhFromHora ?? hhFromFecha ?? '0') || 0;
            }
            dateObj.setHours(Math.max(0, Math.min(23, hour)), 0, 0, 0);
            return dateObj;
        };

        let delayMinutesTotal = 0;
        let delayMinutesCount = 0;
        let onTimeCount = 0;
        let totalPassengers = 0;
        // Aircraft charts
        const aircraftByDirection = { 'Aterrizaje': {}, 'Despegue': {} };
        const aircraftByAirline   = {}; // airline label → { acType: count }
        // Per-direction, per-type, per-service breakdown (for two separate charts + filter)
        const acMovData   = {};  // { direction: { acType: { serviceLabel: count } } }
        const acServiceSet = new Set(); // all unique service labels seen

        activeData.forEach(r => {
            const pax = kPasajeros ? parsePassengers(r[kPasajeros]) : 0;
            totalPassengers += pax;

            const rowDate = parseDateFromRecord(r);
            if (rowDate) {
                // Calendar week key = ISO date of the Monday that starts this week (Mon–Sun)
                const weekKey = _isoMondayKey(rowDate);
                weeklyPassengers[weekKey] = (weeklyPassengers[weekKey] || 0) + pax;
                weeklyOps[weekKey] = (weeklyOps[weekKey] || 0) + 1;

                const day = rowDate.getDay(); // 0=Domingo ... 6=Sábado
                const dayIndex = day === 0 ? 6 : day - 1; // Lunes=0 ... Domingo=6
                const hourKey = String(rowDate.getHours()).padStart(2, '0');
                if (!heatmapPassengers[hourKey]) heatmapPassengers[hourKey] = Array(7).fill(0);
                heatmapPassengers[hourKey][dayIndex] += pax;
                // Accumulate flight details for cell drill-down
                if (!heatmapDetails[hourKey]) heatmapDetails[hourKey] = {};
                if (!heatmapDetails[hourKey][dayIndex]) heatmapDetails[hourKey][dayIndex] = [];
                const _hmRec = {
                    vuelo:      kVuelo       ? String(r[kVuelo]       || '').trim() : '',
                    aerolinea:  kAerolinea   ? String(r[kAerolinea]   || '').trim() : '',
                    origen:     kOrigen      ? String(r[kOrigen]      || '').trim() : '',
                    destino:    kDestino     ? String(r[kDestino]     || '').trim() : '',
                    movimiento: kMovimiento  ? String(r[kMovimiento]  || '').trim() : '',
                    servicio:   kServiceCode ? String(r[kServiceCode] || '').trim() : '',
                    aeronave:   kMatricula   ? String(r[kMatricula]   || '').trim() :
                                (kTipoAc    ? String(r[kTipoAc]      || '').trim() : ''),
                    fecha:      kFecha       ? String(r[kFecha]       || '').trim() : '',
                    hora:       _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                    kHoraActual ? String(r[kHoraActual] || '').trim() :
                                    (kHora      ? String(r[kHora]       || '').trim() : '')),
                    horaProg:   _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                    kHoraProg ? String(r[kHoraProg] || '').trim() :
                                    (kFecha   ? String(r[kFecha]    || '').trim() : '')),
                    pax
                };
                heatmapDetails[hourKey][dayIndex].push(_hmRec);
                // Per-week bucketing (passenger + ops fallback) — keyed by Monday ISO date
                if (!heatmapPassengersByWeek[weekKey]) heatmapPassengersByWeek[weekKey] = {};
                if (!heatmapPassengersByWeek[weekKey][hourKey]) heatmapPassengersByWeek[weekKey][hourKey] = Array(7).fill(0);
                heatmapPassengersByWeek[weekKey][hourKey][dayIndex] += pax;
                if (!heatmapDetailsByWeek[weekKey]) heatmapDetailsByWeek[weekKey] = {};
                if (!heatmapDetailsByWeek[weekKey][hourKey]) heatmapDetailsByWeek[weekKey][hourKey] = {};
                if (!heatmapDetailsByWeek[weekKey][hourKey][dayIndex]) heatmapDetailsByWeek[weekKey][hourKey][dayIndex] = [];
                heatmapDetailsByWeek[weekKey][hourKey][dayIndex].push(_hmRec);
                if (!heatmapOps[hourKey]) heatmapOps[hourKey] = Array(7).fill(0);
                heatmapOps[hourKey][dayIndex] += 1;
                if (!heatmapOpsByWeek[weekKey]) heatmapOpsByWeek[weekKey] = {};
                if (!heatmapOpsByWeek[weekKey][hourKey]) heatmapOpsByWeek[weekKey][hourKey] = Array(7).fill(0);
                heatmapOpsByWeek[weekKey][hourKey][dayIndex] += 1;
            }

            // Date — normalize to date-only key using parseDateFromRecord
            const rowDateForMap = parseDateFromRecord(r);
            if (rowDateForMap) {
                const d = rowDateForMap;
                const dateKey = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
                daysMap[dateKey] = (daysMap[dateKey] || 0) + 1;
            }
            // Hour (HH) — prefer kHoraActual ("Hora actual") for the hoursMap bucket
            const horaActualRaw = kHoraActual && r[kHoraActual] ? String(r[kHoraActual]).trim() : '';
            const horaFallbackRaw = kHora && r[kHora] ? String(r[kHora]).trim() : '';
            const horaSource = horaActualRaw || horaFallbackRaw;
            let _hourKey = null; // will be set below for use at end of loop
            if (horaSource) {
                let hStr = horaSource;
                // Si es ISO timestamp (2026-03-16T18:00:00Z) extraer solo la parte de tiempo
                if (hStr.includes('T')) hStr = hStr.split('T')[1] || hStr;
                let h = hStr.includes(':') ? hStr.split(':')[0] : hStr.substring(0, 2);
                h = h.trim();
                if (h.length === 1) h = '0' + h;
                if (!isNaN(parseInt(h))) {
                    hoursMap[h] = (hoursMap[h] || 0) + 1;
                    hourPaxMap[h] = (hourPaxMap[h] || 0) + pax;
                    _hourKey = h;
                }
                // 10-min slot for simultaneous ops analysis (±5 min window)
                const mMatch = horaSource.match(/(\d{1,2}):(\d{2})/);
                if (mMatch) {
                    const sH = parseInt(mMatch[1], 10);
                    const sM = Math.floor(parseInt(mMatch[2], 10) / 10) * 10;
                    const slotKey = `${String(sH).padStart(2,'0')}:${String(sM).padStart(2,'0')}`;
                    simultMap[slotKey] = (simultMap[slotKey] || 0) + 1;
                }
            }
            // Pos — skip empty/null/dash-only values (cancelled or unassigned flights)
            const _rawPos = kPos ? String(r[kPos] || '').trim() : '';
            if(_rawPos && !/^[-—–\s.]+$/.test(_rawPos)) {
                posMap[_rawPos] = (posMap[_rawPos] || 0) + 1;
                // Accumulate by position category
                const _sm = catalogs.standsMap || {};
                const _posCat = (_sm[_rawPos] && _sm[_rawPos].category) || 'Sin clasificar';
                posTypeMap[_posCat] = (posTypeMap[_posCat] || 0) + 1;
                if (!posFlights[_rawPos]) posFlights[_rawPos] = [];
                posFlights[_rawPos].push({
                    vuelo:      kVuelo       ? String(r[kVuelo]       || '').trim() : '',
                    aerolinea:  kAerolinea   ? String(r[kAerolinea]   || '').trim() : '',
                    origen:     kOrigen      ? String(r[kOrigen]      || '').trim() : '',
                    destino:    kDestino     ? String(r[kDestino]     || '').trim() : '',
                    movimiento: kMovimiento  ? String(r[kMovimiento]  || '').trim() : '',
                    servicio:   kServiceCode ? String(r[kServiceCode] || '').trim() : '',
                    aeronave:   kTipoAc      ? String(r[kTipoAc]     || '').trim() :
                                (kMatricula  ? String(r[kMatricula]   || '').trim() : ''),
                    fecha:      kFecha       ? String(r[kFecha]       || '').trim() : '',
                    hora:       _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                    kHoraActual ? String(r[kHoraActual] || '').trim() :
                                    (kHora      ? String(r[kHora]       || '').trim() : '')),
                    horaProg:   _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                    kHoraProg ? String(r[kHoraProg] || '').trim() :
                                    (kFecha   ? String(r[kFecha]    || '').trim() : '')),
                    pax:        kPasajeros   ? parsePassengers(r[kPasajeros]) : 0,
                    estatus:    kEstatus     ? String(r[kEstatus]     || '').trim() : ''
                });
            }
            // Registration & aircraft type — use separate columns when available
            const rawMatricula = kMatricula && r[kMatricula] ? String(r[kMatricula]).trim() : '';
            const rawTipoRaw   = kTipoAc   && r[kTipoAc]   ? String(r[kTipoAc]).trim()   : '';
            // Normalize registration (remove hyphens/spaces for catalog lookup)
            const regKey = rawMatricula.toUpperCase().replace(/[-\s]/g, '');

            // Resolve aircraft type code:
            // 1) Dedicated type column (kTipoAc)
            // 2) Look up registration in aircraft.csv catalog
            // 3) Try aircraftMap directly on the registration (some tables store type in equipment field)
            let resolvedTypeCode = '';
            if (rawTipoRaw) {
                resolvedTypeCode = rawTipoRaw.toUpperCase();
            } else if (regKey && catalogs.registrationMap[regKey]) {
                resolvedTypeCode = catalogs.registrationMap[regKey]; // e.g. "XAVBZ" → "32Q"
            } else if (rawMatricula && catalogs.aircraftMap[rawMatricula.toUpperCase()]) {
                resolvedTypeCode = rawMatricula.toUpperCase(); // raw value is already a type code
            }

            // Use the short IATA type code as label (e.g. "320", "73H", "E90")
            // Full name from catalog is used in tooltips
            const acTypeLabel    = resolvedTypeCode || '';
            const acTypeLongName = resolvedTypeCode
                ? (catalogs.aircraftMap[resolvedTypeCode]?.name || resolvedTypeCode)
                : '';

            // Legacy eqMap (used by existing doughnut chart)  — prefer type over registration
            const rawEq = resolvedTypeCode || rawMatricula;
            if (rawEq) {
                const eqLabel = catalogs.aircraftMap[rawEq.toUpperCase()]?.name || rawEq;
                eqMap[eqLabel] = (eqMap[eqLabel] || 0) + 1;
            }
            // Airline
            let airlineLabel = '';
            if(kAerolinea && r[kAerolinea]) {
                const airlineCode = String(r[kAerolinea]).trim().toUpperCase();
                airlineLabel = catalogs.airlinesMap[airlineCode] || airlineCode;
                airlineMap[airlineLabel] = (airlineMap[airlineLabel] || 0) + 1;
            }

            // ── Infer movement direction ──────────────────────────────────────
            // Priority 1: dedicated movement column
            // Priority 2: MMMX in origin (departure) or destination (arrival)
            // Priority 3: 'Desconocido'
            let movDirection = null;
            if (kMovimiento && r[kMovimiento]) {
                const mov = String(r[kMovimiento]).trim().toUpperCase();
                // Match common Spanish/English values and single-letter codes (L=Llegada, S=Salida)
                if (/^(L$|LL|LLD|ARR|ARRIV|ATERR|LLEGADA|ENTRADA|ARRIVAL|LAND)/.test(mov)) movDirection = 'Aterrizaje';
                else if (/^(S$|SAL|DEP|DES|DESP|SALIDA|DEPARTURE|TAKE)/.test(mov)) movDirection = 'Despegue';
                // Do NOT use raw value as direction — prevents aircraft type codes leaking in
            }
            if (!movDirection) {
                const origin = kOrigen && r[kOrigen] ? String(r[kOrigen]).trim().toUpperCase() : '';
                const dest   = kDestino && r[kDestino] ? String(r[kDestino]).trim().toUpperCase() : '';
                if (origin === 'MMMX' || origin === 'MMTO') movDirection = 'Despegue';
                else if (dest === 'MMMX' || dest === 'MMTO') movDirection = 'Aterrizaje';
            }
            const direction = movDirection || 'Desconocido';

            // Resolve service: keep raw code (e.g. "J", "F") for the aircraft filter
            // and also resolve category for serviceCategoryCount / summary
            let svcCode     = '';   // raw code: "J", "F", …
            let svcCategory = '';   // category: "Scheduled", "Others", …
            if (kServiceCode && r[kServiceCode]) {
                svcCode = String(r[kServiceCode]).trim().toUpperCase();
                if (svcCode) {
                    const sRef = catalogs.serviceTypeMap[svcCode];
                    svcCategory = sRef?.category || svcCode;
                }
            }

            // Aircraft by direction — Y axis = aircraft TYPE, datasets = Aterrizaje / Despegue
            if (acTypeLabel) {
                if (!aircraftByDirection[direction]) aircraftByDirection[direction] = {};
                aircraftByDirection[direction][acTypeLabel] = (aircraftByDirection[direction][acTypeLabel] || 0) + 1;

                // Also populate the per-service breakdown keyed by RAW CODE ("J", "F", …)
                const svcKey = svcCode || '(Sin servicio)';
                if (!acMovData[direction]) acMovData[direction] = {};
                if (!acMovData[direction][acTypeLabel]) acMovData[direction][acTypeLabel] = {};
                acMovData[direction][acTypeLabel][svcKey] = (acMovData[direction][acTypeLabel][svcKey] || 0) + 1;
                // Store individual records for bar drilldown
                if (!acMovFlightsLocal[direction]) acMovFlightsLocal[direction] = {};
                if (!acMovFlightsLocal[direction][acTypeLabel]) acMovFlightsLocal[direction][acTypeLabel] = [];
                acMovFlightsLocal[direction][acTypeLabel].push({
                    vuelo:      kVuelo       ? String(r[kVuelo]       || '').trim() : '',
                    aerolinea:  kAerolinea   ? String(r[kAerolinea]   || '').trim() : '',
                    origen:     kOrigen      ? String(r[kOrigen]      || '').trim() : '',
                    destino:    kDestino     ? String(r[kDestino]     || '').trim() : '',
                    movimiento: kMovimiento  ? String(r[kMovimiento]  || '').trim() : '',
                    servicio:   svcCode || '',
                    aeronave:   kMatricula   ? String(r[kMatricula]   || '').trim() : acTypeLabel,
                    posicion:   kPos         ? String(r[kPos]         || '').trim() : '',
                    fecha:      kFecha       ? String(r[kFecha]       || '').trim() : '',
                    hora:       _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                    kHoraActual ? String(r[kHoraActual] || '').trim() :
                                    (kHora      ? String(r[kHora]       || '').trim() : '')),
                    horaProg:   _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                    kHoraProg ? String(r[kHoraProg] || '').trim() :
                                    (kFecha   ? String(r[kFecha]    || '').trim() : '')),
                    pax:        kPasajeros   ? parsePassengers(r[kPasajeros]) : 0,
                    estatus:    kEstatus     ? String(r[kEstatus]     || '').trim() : ''
                });
                if (svcCode) acServiceSet.add(svcCode);
            }
            // Aircraft by airline — Y axis = airline, stacked by aircraft TYPE
            if (acTypeLabel && airlineLabel) {
                if (!aircraftByAirline[airlineLabel]) aircraftByAirline[airlineLabel] = {};
                aircraftByAirline[airlineLabel][acTypeLabel] = (aircraftByAirline[airlineLabel][acTypeLabel] || 0) + 1;
            }

            const origin = kOrigen && r[kOrigen] ? String(r[kOrigen]).trim().toUpperCase() : '';
            const destination = kDestino && r[kDestino] ? String(r[kDestino]).trim().toUpperCase() : '';
            if (origin && destination) {
                const routeLabel = `${origin}-${destination}`;
                routeMap[routeLabel] = (routeMap[routeLabel] || 0) + 1;

                const originCountry = (catalogs.airportsMap[origin]?.country || '').toLowerCase();
                const destinationCountry = (catalogs.airportsMap[destination]?.country || '').toLowerCase();
                const isDomestic = originCountry.includes('mexico') && destinationCountry.includes('mexico');
                if (isDomestic) domesticOps += 1;
                else internationalOps += 1;
            }

            if (kDelayCode && r[kDelayCode]) {
                const rawCode = String(r[kDelayCode]).trim();
                // Extract the first token (alpha or numeric code)
                const token = rawCode.split(/[\s\/,;]+/)[0].toUpperCase();
                // Look up by alpha code, then numeric, then try full raw string as category
                const delayRef = catalogs.delayMap[token]
                    || catalogs.delayMap[rawCode.toUpperCase()]
                    || null;
                let category, label;
                if (delayRef) {
                    category = delayRef.category || 'Sin categoría';
                    const summaryPart = delayRef.summary ? delayRef.summary : token;
                    label = `${token} - ${summaryPart}`;
                } else {
                    // Raw value is probably the category name itself (Spanish text in DB)
                    category = rawCode || 'Sin categoría';
                    label = rawCode || 'Sin categoría';
                }
                delayByCategory[category] = (delayByCategory[category] || 0) + 1;
                delayCodeCount[label]     = (delayCodeCount[label]     || 0) + 1;
            }

            if (kServiceCode && r[kServiceCode]) {
                // Use category for the summary section (separate from the aircraft filter)
                if (svcCategory) {
                    serviceCategoryCount[svcCategory] = (serviceCategoryCount[svcCategory] || 0) + 1;
                }
            }

            if (kDelayMin && r[kDelayMin] !== '') {
                const delayMin = parseDelayMinutes(r[kDelayMin]);
                if (delayMin !== null) {
                    delayMinutesTotal += delayMin;
                    delayMinutesCount += 1;
                    if (delayMin <= 15) onTimeCount += 1;
                }
            }

            // Accumulate per-hour flight records for the peak-hour drilldown modal
            if (_hourKey !== null) {
                if (!hourFlights[_hourKey]) hourFlights[_hourKey] = [];
                hourFlights[_hourKey].push({
                    vuelo:      kVuelo       ? String(r[kVuelo]       || '').trim() : '',
                    aerolinea:  kAerolinea   ? String(r[kAerolinea]   || '').trim() : '',
                    origen:     kOrigen      ? String(r[kOrigen]      || '').trim() : '',
                    destino:    kDestino     ? String(r[kDestino]     || '').trim() : '',
                    movimiento: direction,
                    servicio:   svcCode,
                    svcCat:     svcCategory,
                    aeronave:   acTypeLabel || (kMatricula ? String(r[kMatricula] || '').trim() : ''),
                    hora:       horaSource,
                    pax
                });
            }
        });

        // === Accumulate operations heatmap (excludes cancelled AND non-operational) ===
        opsCleanData.forEach(r => {
            const rowDate = parseDateFromRecord(r);
            if (!rowDate) return;
            const day = rowDate.getDay();
            const dayIndex = day === 0 ? 6 : day - 1; // Lun=0...Dom=6
            const hourKey = String(rowDate.getHours()).padStart(2, '0');
            const weekKey = _isoMondayKey(rowDate); // calendar week Mon–Sun
            if (!heatmapOpsHour[hourKey]) heatmapOpsHour[hourKey] = Array(7).fill(0);
            heatmapOpsHour[hourKey][dayIndex] += 1;
            if (!heatmapOpsHourDetails[hourKey]) heatmapOpsHourDetails[hourKey] = {};
            if (!heatmapOpsHourDetails[hourKey][dayIndex]) heatmapOpsHourDetails[hourKey][dayIndex] = [];
            const _ohRec = {
                vuelo:      kVuelo       ? String(r[kVuelo]       || '').trim() : '',
                aerolinea:  kAerolinea   ? String(r[kAerolinea]   || '').trim() : '',
                origen:     kOrigen      ? String(r[kOrigen]      || '').trim() : '',
                destino:    kDestino     ? String(r[kDestino]     || '').trim() : '',
                movimiento: kMovimiento  ? String(r[kMovimiento]  || '').trim() : '',
                servicio:   kServiceCode ? String(r[kServiceCode] || '').trim() : '',
                aeronave:   kMatricula   ? String(r[kMatricula]   || '').trim() :
                            (kTipoAc    ? String(r[kTipoAc]      || '').trim() : ''),
                fecha:      kFecha       ? String(r[kFecha]       || '').trim() : '',
                hora:       _joinDateAndTime(kFecha ? String(r[kFecha] || '').trim() : '',
                                kHoraActual ? String(r[kHoraActual] || '').trim() :
                                (kHora      ? String(r[kHora]       || '').trim() : '')),
                estatus:    kEstatus     ? String(r[kEstatus]     || '').trim() : ''
            };
            heatmapOpsHourDetails[hourKey][dayIndex].push(_ohRec);
            // Per-week bucketing — keyed by Monday ISO date
            if (!heatmapOpsHourByWeek[weekKey]) heatmapOpsHourByWeek[weekKey] = {};
            if (!heatmapOpsHourByWeek[weekKey][hourKey]) heatmapOpsHourByWeek[weekKey][hourKey] = Array(7).fill(0);
            heatmapOpsHourByWeek[weekKey][hourKey][dayIndex] += 1;
            if (!heatmapOpsHourDetailsByWeek[weekKey]) heatmapOpsHourDetailsByWeek[weekKey] = {};
            if (!heatmapOpsHourDetailsByWeek[weekKey][hourKey]) heatmapOpsHourDetailsByWeek[weekKey][hourKey] = {};
            if (!heatmapOpsHourDetailsByWeek[weekKey][hourKey][dayIndex]) heatmapOpsHourDetailsByWeek[weekKey][hourKey][dayIndex] = [];
            heatmapOpsHourDetailsByWeek[weekKey][hourKey][dayIndex].push(_ohRec);
        });

        // Debug: show sample delay codes and categories
        if (kDelayCode) {
            const sampleCodes = data.slice(0, 5).map(r => r[kDelayCode]).filter(Boolean);
            console.log('[renderOpsCharts] Sample delay codes:', sampleCodes);
            console.log('[renderOpsCharts] Delay categories found:', Object.keys(delayByCategory).slice(0, 10));
        }

        // ... KPI Logic ...
        const uniqueDays = Object.keys(daysMap).length || 1;
        const avg = Math.round(totalOps / uniqueDays);
        const avgPax = uniqueDays > 0 && totalPassengers > 0 ? Math.round(totalPassengers / uniqueDays) : 0;

        // Peak Hour — with count and range label
        let peakH = '-', maxH = 0;
        Object.entries(hoursMap).forEach(([h,c]) => { if(c > maxH) { maxH = c; peakH = String(h).padStart(2,'0')+':00'; } });
        const peakHLabel = peakH !== '-' ? `${peakH}–${String(Number(peakH.split(':')[0])+1).padStart(2,'0')}:00` : '-';

        // Busiest Day — with count
        let busyD = '-', maxD = 0;
        Object.entries(daysMap).forEach(([d,c]) => { if(c > maxD) { maxD = c; busyD = d; } });

        // Arrivals / Departures from aircraftByDirection totals
        const arrCount = Object.values(aircraftByDirection['Aterrizaje'] || {}).reduce((s,n) => s+n, 0);
        const depCount = Object.values(aircraftByDirection['Despegue']   || {}).reduce((s,n) => s+n, 0);
        const arrPct   = totalOps ? ((arrCount / totalOps)*100).toFixed(1) : 0;
        const depPct   = totalOps ? ((depCount / totalOps)*100).toFixed(1) : 0;

        // Top route
        const topRoute = Object.entries(routeMap).sort((a,b) => b[1]-a[1])[0];

        // Avg pax per flight
        const avgPaxPerFlight = totalPassengers > 0 && totalOps > 0 ? (totalPassengers / totalOps).toFixed(1) : null;

        // Peak hour pax & ops averages (per day at that hour)
        const peakHKey = peakH !== '-' ? String(Number(peakH.split(':')[0])).padStart(2,'0') : null;
        const peakHourTotalPax = peakHKey ? (hourPaxMap[peakHKey] || 0) : 0;
        const avgOpsAtPeakHour = peakHKey ? Math.round(maxH / uniqueDays) : 0;
        const avgPaxAtPeakHour = peakHKey && peakHourTotalPax > 0 ? Math.round(peakHourTotalPax / uniqueDays) : 0;

        // Peak hour pax vs cargo classification
        const _isCargoFlight = f => /cargo|freight|carga|freighter/i.test(f.svcCat || f.servicio || '');
        const peakHFlights   = peakHKey ? (hourFlights[peakHKey] || []) : [];
        const peakHCargoOps  = peakHFlights.filter(_isCargoFlight).length;
        const peakHPaxOps    = peakHFlights.filter(f => (f.servicio || f.svcCat) && !_isCargoFlight(f)).length;
        _peakHourFlightsStore = peakHFlights;
        _peakHourLabel = peakH;

        // Update DOM
        const setT  = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
        const setH  = (id, v) => { const el = document.getElementById(id); if(el) el.innerHTML  = v; };
        const fmt   = n => Number(n).toLocaleString('en-US');

        setT('kpi-total-ops', fmt(totalOps));
        setT('kpi-total-ops-sub', `${uniqueDays} días con operaciones`);
        setT('kpi-avg-daily', fmt(avg));
        setT('kpi-avg-daily-pax', avgPax > 0 ? `${fmt(avgPax)} pax/día` : 'sin datos de pax');
        setT('kpi-arrivals', arrCount > 0 ? fmt(arrCount) : (kMovimiento ? '0' : 'N/D'));
        setT('kpi-arrivals-pct', arrCount > 0 ? `${arrPct}% del total` : '');
        setT('kpi-departures', depCount > 0 ? fmt(depCount) : (kMovimiento ? '0' : 'N/D'));
        setT('kpi-departures-pct', depCount > 0 ? `${depPct}% del total` : '');
        setT('kpi-busiest-day', busyD);
        setT('kpi-busiest-day-count', maxD > 0 ? `${fmt(maxD)} operaciones ese día` : '');
        setT('kpi-peak-hour', peakH);
        (() => {
            const paxPart  = avgPaxAtPeakHour > 0 ? `~${fmt(avgPaxAtPeakHour)} pax/día` : 'sin pax';
            const splitPart = (peakHPaxOps + peakHCargoOps) > 0
                ? ` · ${fmt(peakHPaxOps)} pasajeros / ${fmt(peakHCargoOps)} carga`
                : '';
            setT('kpi-peak-hour-detail', maxH > 0
                ? `~${fmt(avgOpsAtPeakHour)} ops/día · ${paxPart}${splitPart}`
                : '— ops en esa franja');
        })();
        // Make the card clickable to show peak-hour flight list
        (() => {
            const card = document.getElementById('kpi-peak-hour')?.closest('.card');
            if (card && peakHFlights.length > 0) {
                card.style.cursor = 'pointer';
                card.style.transition = 'box-shadow .15s';
                card.onmouseenter = () => { card.style.boxShadow = '0 0 0 2px #f59e0b'; };
                card.onmouseleave = () => { card.style.boxShadow = ''; };
                card.onclick = () => _showPeakHourModal();
                // Add a small hint badge if not already there
                if (!document.getElementById('_peak-click-hint')) {
                    const hint = document.createElement('div');
                    hint.id = '_peak-click-hint';
                    hint.style.cssText = 'font-size:.63rem;color:#f59e0b;margin-top:4px;font-weight:600';
                    hint.innerHTML = '<i class="fas fa-table me-1"></i>Ver vuelos';
                    card.querySelector('[id="kpi-peak-hour"]')?.closest('.card').appendChild(hint);
                }
            }
        })();
        setT('kpi-total-passengers', totalPassengers > 0 ? fmt(totalPassengers) : 'Sin datos');
        setT('kpi-pax-avg-flight', avgPaxPerFlight ? `${avgPaxPerFlight} pax por vuelo` : '');
        setT('kpi-international-share', `${fmt(internationalOps)} intl`);
        setT('kpi-intl-detail', `${fmt(domesticOps)} domésticos · ${totalOps > 0 ? ((internationalOps/totalOps)*100).toFixed(1)+'% intl' : ''}`);
        setT('kpi-top-route', topRoute ? topRoute[0] : 'Sin datos de ruta');
        setT('kpi-top-route-count', topRoute ? `${fmt(topRoute[1])} vuelos en el período` : '');

        // Average daily ops per position type
        const posTypeOrder = ['Contacto','Contacto Internacional','Semicontacto','Remota','Hangar','Sin clasificar'];
        const posTypeMeta  = {
            'Contacto':              { color: '#198754', icon: 'fa-plane-arrival' },
            'Contacto Internacional':{ color: '#20c997', icon: 'fa-globe' },
            'Semicontacto':          { color: '#fd7e14', icon: 'fa-bus' },
            'Remota':                { color: '#0d6efd', icon: 'fa-road' },
            'Hangar':                { color: '#6c757d', icon: 'fa-warehouse' },
            'Sin clasificar':        { color: '#adb5bd', icon: 'fa-question-circle' },
        };
        const posTypePanel = document.getElementById('kpi-postype-panel');
        if (posTypePanel) {
            const hasAnyPos = Object.keys(posTypeMap).length > 0;
            posTypePanel.closest('.col-12').style.display = hasAnyPos ? '' : 'none';
            if (hasAnyPos) {
                posTypePanel.innerHTML = posTypeOrder
                    .filter(cat => posTypeMap[cat] > 0)
                    .map(cat => {
                        const total = posTypeMap[cat];
                        const dailyAvg = Math.round(total / uniqueDays);
                        const pct = totalOps ? ((total / totalOps) * 100).toFixed(1) : 0;
                        const meta = posTypeMeta[cat] || { color: '#adb5bd', icon: 'fa-question-circle' };
                        return `<div class="d-flex align-items-center gap-3 py-2 border-bottom">
                            <div style="width:36px;height:36px;border-radius:8px;background:${meta.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                                <i class="fas ${meta.icon} text-white" style="font-size:0.85rem"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="fw-semibold" style="font-size:0.88rem">${cat}</div>
                                <div class="progress mt-1" style="height:5px;border-radius:3px">
                                    <div class="progress-bar" style="width:${pct}%;background:${meta.color}"></div>
                                </div>
                            </div>
                            <div class="text-end" style="min-width:110px">
                                <span class="fw-bold fs-5" style="color:${meta.color}">${dailyAvg}</span>
                                <span class="text-muted" style="font-size:0.78rem"> ops/día</span>
                                <div class="text-muted" style="font-size:0.75rem">${Number(total).toLocaleString('en-US')} total &bull; ${pct}%</div>
                            </div>
                        </div>`;
                    }).join('');
            }
        }

        const intlShare = totalOps ? ((internationalOps / totalOps) * 100) : 0;
        const avgDelay = delayMinutesCount ? (delayMinutesTotal / delayMinutesCount) : 0;
        const onTimeRate = delayMinutesCount ? ((onTimeCount / delayMinutesCount) * 100) : 0;
        const topDelayCause = Object.entries(delayCodeCount).sort((a,b) => b[1] - a[1])[0];

        setT('kpi-avg-delay', avgDelay.toFixed(1));
        setT('kpi-on-time-rate', `${onTimeRate.toFixed(1)}%`);
        setT('kpi-on-time-detail', delayMinutesCount > 0 ? `de ${fmt(delayMinutesCount)} vuelos con registro` : 'sin datos de demora');
        setT('kpi-top-delay-cause', topDelayCause ? topDelayCause[0] : 'Sin datos');
        setT('kpi-top-delay-count', topDelayCause ? `${fmt(topDelayCause[1])} ocurrencias` : '');

        const peakWeekEntry = Object.entries(weeklyPassengers)
            .sort((a,b) => b[1] - a[1])[0];
        setT('kpi-peak-week-passengers', peakWeekEntry ? `Sem. ${_calWeekLabel(peakWeekEntry[0])} (${fmt(peakWeekEntry[1])} pax)` : 'Sin datos');

        // --- Charts ---
        console.log('[renderOpsCharts] daysMap sample:', Object.entries(daysMap).slice(0, 3));
        console.log('[renderOpsCharts] kFecha:', kFecha, '| daysMap keys:', Object.keys(daysMap).length);

        // 3. Positions (Horizontal Bar — all positions with %; hidden if no position column)
        const posCardCol = document.getElementById('chart-positions-wrapper')?.closest('.col-12');
        const allPos = Object.entries(posMap).sort((a,b) => b[1] - a[1]);
        if (!kPos || allPos.length === 0) {
            if (posCardCol) posCardCol.style.display = 'none';
        } else {
            if (posCardCol) posCardCol.style.display = '';
        }
        if (!kPos || allPos.length === 0) { /* skip positions chart */ } else {
        const totalPosOps = allPos.reduce((s, x) => s + x[1], 0) || 1;
        const standsMap = catalogs.standsMap || {};
        const standCategoryColors = {
            'Contacto':              '#198754',
            'Contacto Internacional':'#20c997',
            'Semicontacto':          '#fd7e14',
            'Remota':                '#0d6efd',
            'Hangar':                '#6c757d',
            'Calle de Rodaje':       '#dc3545',
            'Desconocida':           '#adb5bd'
        };
        const posBgColors = allPos.map(([name]) => {
            const cat = (standsMap[name] && standsMap[name].category) || 'Desconocida';
            return standCategoryColors[cat] || standCategoryColors['Desconocida'];
        });
        const posPercentages = allPos.map(x => parseFloat((x[1] / totalPosOps * 100).toFixed(2)));
        // Adjust canvas height dynamically so all bars are visible
        const posCanvas = document.getElementById('chart-positions');
        if (posCanvas) {
            const dynH = Math.max(350, allPos.length * 26);
            posCanvas.style.height = dynH + 'px';
            const posWrapper = document.getElementById('chart-positions-wrapper');
            if (posWrapper) posWrapper.style.height = dynH + 'px';
        }
        _renderChart('chart-positions', 'bar', {
            labels: allPos.map(x => x[0]),
            datasets: [{
                label: '% de Uso',
                data: posPercentages,
                backgroundColor: posBgColors,
                borderRadius: 3,
                indexAxis: 'y'
            }]
        }, {
            indexAxis: 'y',
            onClick: (evt, elements) => {
                if (!elements.length) return;
                const posName = allPos[elements[0].index][0];
                _showBarDrilldown(`Posición ${posName} — Vuelos`, _posFlights?.[posName] || []);
            },
            onHover: (evt, elements) => {
                if (evt.native?.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            const [name, count] = allPos[idx];
                            const pct = posPercentages[idx];
                            const cat = (standsMap[name] && standsMap[name].category) || 'Desconocida';
                            return [
                                ` ${pct}% de uso`,
                                ` ${count} operación(es)`,
                                ` Tipo: ${cat}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: '% del total de operaciones' },
                    ticks: { callback: v => v + '%' }
                }
            }
        }); // end positions else
        } // end if kPos

        // 3b. Simultaneous operations chart (10-min slots, averaged per active day)
        {
            const simultSlots = Object.keys(simultMap).sort();
            const simultCard  = document.getElementById('chart-simultaneous-wrapper')?.closest('.col-12');
            if (simultSlots.length === 0) {
                if (simultCard) simultCard.style.display = 'none';
            } else {
                if (simultCard) simultCard.style.display = '';
                const simultAvgs = simultSlots.map(k => parseFloat((simultMap[k] / uniqueDays).toFixed(2)));
                const simultMax  = Math.max(...simultAvgs) || 1;
                const simultBgColors = simultAvgs.map(v => {
                    const pct = v / simultMax;
                    if (pct > 0.80) return '#dc3545';
                    if (pct > 0.55) return '#fd7e14';
                    if (pct > 0.30) return '#ffc107';
                    return '#20c997';
                });
                // Resize canvas
                const sCanvas  = document.getElementById('chart-simultaneous');
                const sWrapper = document.getElementById('chart-simultaneous-wrapper');
                if (sCanvas && sWrapper) { sCanvas.style.height = '320px'; sWrapper.style.height = '320px'; }
                // Peak label for subtitle
                const peakSimultSlot = simultSlots[simultAvgs.indexOf(simultMax)];
                const peakSimultVal  = simultMax.toFixed(1);
                const sSubtitle = document.getElementById('simult-subtitle');
                if (sSubtitle) sSubtitle.textContent =
                    `Pico: ${peakSimultSlot} hrs — ${peakSimultVal} ops simultáneas (promedio/día)`;
                _renderChart('chart-simultaneous', 'bar', {
                    labels: simultSlots,
                    datasets: [{
                        label: 'Ops simultáneas',
                        data: simultAvgs,
                        backgroundColor: simultBgColors,
                        borderRadius: 2,
                        barPercentage: 1.0,
                        categoryPercentage: 0.95,
                    }]
                }, {
                    animation: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: ctx => `${ctx[0].label} – ${(() => {
                                    const [hh, mm] = ctx[0].label.split(':').map(Number);
                                    const end = mm + 9;
                                    return `${String(hh).padStart(2,'0')}:${String(end).padStart(2,'0')} hrs`;
                                })()}`,
                                label: ctx => [
                                    ` ${ctx.raw} ops simultáneas prom/día`,
                                    ` Total período: ${simultMap[simultSlots[ctx.dataIndex]]}`
                                ]
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Franja horaria (cada 10 min)' },
                            ticks: {
                                maxRotation: 90,
                                autoSkip: false,
                                callback: (_, idx) => {
                                    const lbl = simultSlots[idx] || '';
                                    return lbl.endsWith(':00') ? lbl : '';
                                },
                                font: { size: 10 }
                            },
                            grid: { display: false }
                        },
                        y: {
                            title: { display: true, text: 'Ops simultáneas (prom/día)' },
                            beginAtZero: true
                        }
                    }
                });
            }
        }

        // 4. Two separate aircraft charts (Aterrizajes + Despegues) with service filter
        const acChartCol = document.getElementById('chart-aircrafts-col');
        // Store data + catalogs for re-render when filter changes
        _acMovData     = acMovData;
        _acMovCatalogs = catalogs;
        _acMovFlights  = acMovFlightsLocal;
        _posFlights    = posFlights;

        // Populate service filter dropdown — show code + description (e.g. "J — Normal Service")
        const acSvcSelect = document.getElementById('ac-mov-service-filter');
        if (acSvcSelect) {
            while (acSvcSelect.options.length > 1) acSvcSelect.remove(1);
            Array.from(acServiceSet).sort().forEach(code => {
                const ref  = catalogs.serviceTypeMap[code];
                const desc = ref ? `${ref.category} — ${ref.description}` : code;
                const opt  = document.createElement('option');
                opt.value       = code;
                opt.textContent = `${code} — ${desc}`;
                acSvcSelect.appendChild(opt);
            });
            // Attach listener once (guard with a flag)
            if (!acSvcSelect._listenerAttached) {
                acSvcSelect.addEventListener('change', () => _renderAcMovCharts(acSvcSelect.value));
                acSvcSelect._listenerAttached = true;
            }
        }

        const hasAcData = Object.keys(acMovData).some(d => Object.keys(acMovData[d]).length > 0);
        if (!hasAcData) {
            if (acChartCol) acChartCol.style.display = 'none';
        } else {
            if (acChartCol) acChartCol.style.display = '';
            _renderAcMovCharts('');
        }

        const topDelayCategories = Object.entries(delayByCategory)
            .sort((a,b) => b[1] - a[1]);

        // Resize delay chart container based on number of categories
        const delayCatBody = document.getElementById('delay-cat-body');
        if (delayCatBody) {
            const dynH = Math.max(300, topDelayCategories.length * 44);
            delayCatBody.style.minHeight = dynH + 'px';
        }

        // Color palette for delay categories
        const DELAY_CAT_COLORS = [
            '#dc3545','#fd7e14','#ffc107','#198754','#0d6efd',
            '#6610f2','#20c997','#0dcaf0','#6f42c1','#adb5bd',
            '#e83e8c','#17a2b8','#6c757d','#28a745','#ff6b6b'
        ];
        const delayCatColors = topDelayCategories.map((_, i) => DELAY_CAT_COLORS[i % DELAY_CAT_COLORS.length]);

        _renderChart('chart-delay-categories', 'bar', {
            labels: topDelayCategories.map(item => item[0]),
            datasets: [{
                label: 'Eventos',
                data: topDelayCategories.map(item => item[1]),
                backgroundColor: delayCatColors,
                borderRadius: 6
            }]
        }, {
            indexAxis: 'y',
            scales: {
                y: {
                    ticks: {
                        autoSkip: false,
                        font: { size: 11 }
                    }
                },
                x: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            }
        });

        const topAirlines = Object.entries(airlineMap)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 10);

        _renderChart('chart-airline-share', 'doughnut', {
            labels: topAirlines.map(item => item[0]),
            datasets: [{
                label: 'Operaciones',
                data: topAirlines.map(item => item[1]),
                backgroundColor: [
                    '#0d6efd','#198754','#ffc107','#dc3545','#6610f2',
                    '#20c997','#fd7e14','#6f42c1','#0dcaf0','#adb5bd'
                ]
            }]
        });

        const hasPaxData = totalPassengers > 0;
        const weeklySource = hasPaxData ? weeklyPassengers : weeklyOps;
        const weeklyChartLabel = hasPaxData ? 'Pasajeros' : 'Operaciones';
        const weeklyChartColor = hasPaxData ? '#0dcaf0' : '#6610f2';

        // Keys are now ISO Monday dates ("YYYY-MM-DD") — sort lexicographically = chronologically
        const sortedWeeks = Object.keys(weeklySource).sort();
        const sortedWeekDisplayLabels = sortedWeeks.map(wk => `Sem. ${_calWeekLabel(wk)}`);

        _renderChart('chart-weekly-passengers', 'bar', {
            labels: sortedWeekDisplayLabels,
            datasets: [{
                label: weeklyChartLabel,
                data: sortedWeeks.map(week => weeklySource[week]),
                backgroundColor: weeklyChartColor,
                borderRadius: 6
            }]
        });

        // Update card header to reflect actual data type
        const weeklyHeader = document.querySelector('[data-chart-header="weekly-passengers"]');
        if (weeklyHeader) weeklyHeader.textContent = hasPaxData ? 'Pasajeros por Semana' : 'Operaciones por Semana';

        const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const hourLabels = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
        const heatSource = hasPaxData ? heatmapPassengers : heatmapOps;
        const heatTitle = hasPaxData ? 'Mapa de Calor de Pasajeros (Hora x Día)' : 'Mapa de Calor de Operaciones (Hora x Día)';
        const heatHeaderEl = document.querySelector('[data-chart-header="heatmap"]');
        if (heatHeaderEl) heatHeaderEl.textContent = heatTitle;
        const allHeatValues = hourLabels.flatMap(hour => (heatSource[hour] || Array(7).fill(0)));
        const maxHeat = Math.max(1, ...allHeatValues);
        const getHeatColor = (value) => {
            const ratio = Math.max(0, Math.min(1, value / maxHeat));
            const alpha = 0.08 + (ratio * 0.72);
            return `rgba(13, 110, 253, ${alpha})`;
        };

        // Store passenger heatmap week data — keys are ISO Monday date strings
        _heatmapHasPax = hasPaxData;
        const _paxHeatSrcByWeek = hasPaxData ? heatmapPassengersByWeek : heatmapOpsByWeek;
        _paxHeatWeeks = { '0': { data: heatSource, details: heatmapDetails } };
        Object.keys(_paxHeatSrcByWeek).sort().forEach(wk => {
            _paxHeatWeeks[wk] = { data: _paxHeatSrcByWeek[wk], details: heatmapDetailsByWeek[wk] || {} };
        });
        const heatmapEl = document.getElementById('ops-passenger-heatmap');
        if (heatmapEl) {
            _drawPassengerHeatmap('0');
        }

        // Store ops-hour heatmap week data — keys are ISO Monday date strings
        _opsHourHeatWeeks = { '0': { data: heatmapOpsHour, details: heatmapOpsHourDetails } };
        Object.keys(heatmapOpsHourByWeek).sort().forEach(wk => {
            _opsHourHeatWeeks[wk] = { data: heatmapOpsHourByWeek[wk], details: heatmapOpsHourDetailsByWeek[wk] || {} };
        });
        // === Render: Operations-per-hour heatmap (excl. cancelled + non-operational) ===
        const opsHourHeatEl = document.getElementById('ops-hour-heatmap');
        if (opsHourHeatEl) {
            _drawOpsHourHeatmap('0');
        }

        // chart-ac-direction is now replaced by chart-aircrafts above — hide the duplicate
        const acDirCol = document.getElementById('chart-ac-direction-col');
        if (acDirCol) acDirCol.style.display = 'none';

        // ── Chart: Aircraft types by airline (stacked horizontal bar) ────────
        const acAirlineCol = document.getElementById('chart-ac-airline-col');
        const airlinesWithAc = Object.keys(aircraftByAirline);
        if (!kEquipo || !kAerolinea || airlinesWithAc.length === 0) {
            if (acAirlineCol) acAirlineCol.style.display = 'none';
        } else {
            if (acAirlineCol) acAirlineCol.style.display = '';
            // Top 12 airlines by total ops
            const topAirlineList = Object.entries(aircraftByAirline)
                .sort((a, b) => {
                    const aTotal = Object.values(a[1]).reduce((s,v) => s+v, 0);
                    const bTotal = Object.values(b[1]).reduce((s,v) => s+v, 0);
                    return bTotal - aTotal;
                }).slice(0, 12).map(x => x[0]);

            // Collect unique aircraft types across these airlines
            const acTypeSet = new Set();
            topAirlineList.forEach(al => Object.keys(aircraftByAirline[al]).forEach(ac => acTypeSet.add(ac)));
            const uniqueAcTypes = Array.from(acTypeSet).sort();

            const PALETTE = [
                '#4dc9f6','#f67019','#f53794','#537bc4','#acc236',
                '#166a8f','#00a950','#58595b','#8549ba','#ffc107',
                '#20c997','#dc3545','#0d6efd','#fd7e14','#6f42c1'
            ];
            const acAirlineDatasets = uniqueAcTypes.map((ac, i) => ({
                label: ac,
                data: topAirlineList.map(al => (aircraftByAirline[al][ac] || 0)),
                backgroundColor: PALETTE[i % PALETTE.length],
                borderRadius: 3
            }));

            const acAirlineBody = document.getElementById('ac-airline-body');
            if (acAirlineBody) {
                const dynH = Math.max(320, topAirlineList.length * 36);
                acAirlineBody.style.minHeight = dynH + 'px';
            }

            _renderChart('chart-ac-airline', 'bar', {
                labels: topAirlineList,
                datasets: acAirlineDatasets
            }, {
                indexAxis: 'y',
                scales: {
                    x: { beginAtZero: true, stacked: true, ticks: { precision: 0 } },
                    y: { stacked: true, ticks: { autoSkip: false, font: { size: 11 } } }
                },
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: { mode: 'index', intersect: false }
                }
            });
        }

        const topRoutes = Object.entries(routeMap)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 5);

        const topServiceCategory = Object.entries(serviceCategoryCount)
            .sort((a,b) => b[1] - a[1])[0];

        const summaryEl = document.getElementById('ops-advanced-summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6 class="fw-bold mb-2">Lectura Operativa</h6>
                        <ul class="mb-0">
                            <li>Total internacional vs doméstico: <strong>${internationalOps.toLocaleString()}</strong> vs <strong>${domesticOps.toLocaleString()}</strong>.</li>
                            <li>Total de pasajeros transportados en el mes: <strong>${totalPassengers.toLocaleString()}</strong>.</li>
                            <li>Total de operaciones del mes: <strong>${totalOps.toLocaleString()}</strong>.</li>
                            <li>Demora promedio observada: <strong>${avgDelay.toFixed(1)} min</strong>.</li>
                            <li>Operaciones a tiempo (-15 a 15 min): <strong>${onTimeRate.toFixed(1)}%</strong>.</li>
                            <li>Categoría de servicio predominante: <strong>${topServiceCategory ? topServiceCategory[0] : 'Sin datos'}</strong>.</li>
                        </ul>
                    </div>
                    <div class="col-md-6">
                        <h6 class="fw-bold mb-2">Top 5 Rutas del mes</h6>
                        <ol class="mb-2">
                            ${topRoutes.map(route => `<li>${route[0]} — <strong>${route[1]}</strong> operaciones</li>`).join('') || '<li>Sin datos de ruta.</li>'}
                        </ol>
                        <h6 class="fw-bold mb-2">Pasajeros por semana</h6>
                        <ul class="mb-0">
                            ${sortedWeeks.map((week, idx) => `<li>S${idx + 1} ${_calWeekLabel(week)}: <strong>${(weeklyPassengers[week] || 0).toLocaleString()}</strong></li>`).join('') || '<li>Sin datos semanales.</li>'}
                        </ul>
                    </div>
                </div>
            `;
        }
    } catch(e) {
        console.error("Error rendering charts:", e);
    }
}

// ── Helper rendered by filter dropdown and initial load ────────────────────
function _showBarDrilldown(title, records) {
    const titleEl = document.getElementById('heatmap-drilldown-title');
    const bodyEl  = document.getElementById('heatmap-drilldown-body');
    if (!titleEl || !bodyEl) return;

    titleEl.innerHTML = `<i class="fas fa-table me-2 text-primary"></i>${title} &nbsp;<span class="badge bg-secondary fw-normal">${records.length} registro${records.length !== 1 ? 's' : ''}</span>`;

    if (records.length === 0) {
        bodyEl.innerHTML = '<p class="text-muted">Sin registros para esta selección.</p>';
    } else {
        const hasVuelo      = records.some(r => r.vuelo);
        const hasAerolinea  = records.some(r => r.aerolinea);
        const hasOrigen     = records.some(r => r.origen);
        const hasDestino    = records.some(r => r.destino);
        const hasMovimiento = records.some(r => r.movimiento);
        const hasServicio   = records.some(r => r.servicio);
        const hasAeronave   = records.some(r => r.aeronave);
        const hasPosicion   = records.some(r => r.posicion);
        const hasFecha      = records.some(r => r.fecha);
        const hasHora       = records.some(r => r.hora);
        const hasPax        = records.some(r => r.pax > 0);
        const hasEstatus    = records.some(r => r.estatus);

        const sorted   = [...records].sort((a, b) =>
            (a.fecha || '').localeCompare(b.fecha || '') || (a.hora || '').localeCompare(b.hora || ''));
        const totalPax = records.reduce((s, r) => s + (r.pax || 0), 0);

        let html = '';
        if (totalPax > 0) html += `<p class="text-muted small mb-3">Total pasajeros: <strong class="text-primary">${totalPax.toLocaleString()}</strong></p>`;
        html += '<div class="table-responsive"><table class="table table-sm table-hover table-bordered align-middle mb-0" style="font-size:0.82rem"><thead class="table-light"><tr>';
        if (hasVuelo)      html += '<th>Vuelo</th>';
        if (hasAerolinea)  html += '<th>Aerolínea</th>';
        if (hasMovimiento) html += '<th>Mvto.</th>';
        if (hasOrigen)     html += '<th>Origen</th>';
        if (hasDestino)    html += '<th>Destino</th>';
        if (hasServicio)   html += '<th>Servicio</th>';
        if (hasAeronave)   html += '<th>Aeronave</th>';
        if (hasPosicion)   html += '<th>Posición</th>';
        const hasPuntualidad = records.some(r => r.horaProg && r.hora && r.horaProg !== r.hora);
        if (hasFecha)         html += '<th>Hora Prog.</th>';
        if (hasHora)          html += '<th>Hora Actual</th>';
        if (hasPuntualidad)   html += '<th>Puntualidad</th>';
        if (hasPax)           html += '<th class="text-end">Pax</th>';
        html += '</tr></thead><tbody>';

        sorted.forEach(r => {
            html += '<tr>';
            if (hasVuelo)        html += `<td class="fw-semibold">${r.vuelo      || '—'}</td>`;
            if (hasAerolinea)    html += `<td>${r.aerolinea  || '—'}</td>`;
            if (hasMovimiento)   html += `<td>${r.movimiento || '—'}</td>`;
            if (hasOrigen)       html += `<td>${r.origen     || '—'}</td>`;
            if (hasDestino)      html += `<td>${r.destino    || '—'}</td>`;
            if (hasServicio)     html += `<td>${r.servicio   || '—'}</td>`;
            if (hasAeronave)     html += `<td>${r.aeronave   || '—'}</td>`;
            if (hasPosicion)     html += `<td class="fw-semibold">${r.posicion   || '—'}</td>`;
            if (hasFecha)        html += `<td class="text-nowrap">${_fmtIsoDateTime(r.horaProg)}</td>`;
            if (hasHora)         html += `<td class="text-nowrap fw-semibold text-primary">${_fmtIsoDateTime(r.hora)}</td>`;
            if (hasPuntualidad)  html += `<td class="text-center">${_puntualidadBadge(r.horaProg, r.hora) || '—'}</td>`;
            if (hasPax)          html += `<td class="text-end fw-bold">${(r.pax || 0) > 0 ? r.pax.toLocaleString() : '—'}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        bodyEl.innerHTML = html;
    }

    const modalEl = document.getElementById('heatmap-drilldown-modal');
    if (!modalEl) return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function _renderAcMovCharts(serviceFilter) {
    if (!_acMovData) return;

    // Build a readable label for the active filter
    const filterRef   = serviceFilter && _acMovCatalogs?.serviceTypeMap?.[serviceFilter];
    const filterLabel = serviceFilter
        ? `${serviceFilter} — ${filterRef ? filterRef.description + ' (' + filterRef.category + ')' : serviceFilter}`
        : '';

    ['Aterrizaje', 'Despegue'].forEach(dir => {
        const canvasId  = dir === 'Aterrizaje' ? 'chart-ac-arrivals'   : 'chart-ac-departures';
        const bodyId    = dir === 'Aterrizaje' ? 'chart-arr-body'      : 'chart-dep-body';
        const barColor  = dir === 'Aterrizaje' ? '#0d6efd'             : '#20c997';
        const dirLabel  = dir === 'Aterrizaje' ? 'Aterrizajes'          : 'Despegues';

        const bucket = _acMovData[dir] || {};

        // Aggregate counts, optionally filtered by service
        const typeCounts = {};
        Object.entries(bucket).forEach(([acType, services]) => {
            const cnt = serviceFilter
                ? (services[serviceFilter] || 0)
                : Object.values(services).reduce((s, v) => s + v, 0);
            if (cnt > 0) typeCounts[acType] = cnt;
        });

        const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

        const body = document.getElementById(bodyId);
        if (body) body.style.minHeight = Math.max(350, sorted.length * 26) + 'px';

        // Build short-code → full name lookup for tooltip
        const nameMap = {};
        sorted.forEach(([code]) => {
            const full = _acMovCatalogs?.aircraftMap?.[code]?.name;
            if (full && full !== code) nameMap[code] = full;
        });

        _renderChart(canvasId, 'bar', {
            labels: sorted.map(x => x[0]),
            datasets: [{
                label: dirLabel,
                data: sorted.map(x => x[1]),
                backgroundColor: barColor,
                borderRadius: 4
            }]
        }, {
            indexAxis: 'y',
            onClick: (evt, elements) => {
                if (!elements.length) return;
                const acType  = sorted[elements[0].index][0];
                const all     = _acMovFlights?.[dir]?.[acType] || [];
                const recs    = serviceFilter ? all.filter(r => r.servicio === serviceFilter) : all;
                const label   = nameMap[acType] ? `${acType} — ${nameMap[acType]}` : acType;
                _showBarDrilldown(`${dirLabel} · ${label}`, recs);
            },
            onHover: (evt, elements) => {
                if (evt.native?.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    title: { display: true, text: 'Operaciones' }
                },
                y: { ticks: { autoSkip: false, font: { size: 11 } } }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: !!filterLabel,
                    text: filterLabel ? `Servicio: ${filterLabel}` : '',
                    font: { size: 12 },
                    color: '#6c757d',
                    padding: { bottom: 8 }
                },
                tooltip: {
                    callbacks: {
                        title: items => {
                            const code = items[0]?.label || '';
                            const name = nameMap[code];
                            return name ? `${code}  —  ${name}` : code;
                        },
                        label: ctx => ` ${ctx.parsed.x.toLocaleString()} ${dirLabel.toLowerCase()}`
                    }
                }
            }
        });
    });
}

function _renderChart(id, type, data, extraOpts = {}) {
    const ctx = document.getElementById(id);
    if(!ctx) return;
    
    if(_chartInstances[id]) {
        _chartInstances[id].destroy();
        delete _chartInstances[id];
    }

    _chartInstances[id] = new Chart(ctx, {
        type: type,
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            ...extraOpts
        }
    });
}

function renderPivotTable() {
    if (!window.jQuery || !window.jQuery.pivotUtilities) {
        if(!window._pivotWarned) {
             console.warn("PivotTable.js not loaded");
             window._pivotWarned = true;
        }
        $('#pivot-output').html('<div class="alert alert-warning">Librer�a de Tablas Din�micas no cargada.</div>');
        return;
    }

    const renderers = $.pivotUtilities.locales.es.renderers;
    const aggregators = $.pivotUtilities.locales.es.aggregators;

    try {
        $('#pivot-output').pivotUI(opsRawData, {
            renderers: renderers,
            aggregators: aggregators,
            rows: [], 
            cols: [],
            rendererName: "Tabla",
            localeStrings: $.pivotUtilities.locales.es.localeStrings,
            unusedAttrsVertical: true
        });
    } catch(e) {
        console.error("Pivot error:", e);
        $('#pivot-output').html('<div class="alert alert-danger">Error al generar tabla din�mica.</div>');
    }
}

window.opsNavYear = function(delta) {
    const today = new Date();
    const next = currentYearOps + delta;
    if (next < 2024 || next > today.getFullYear()) return;
    window.loadOperationsYear(next);
};

window.loadOperationsYear = function(year) {
    currentYearOps = year;
    populateOpsYearSelect();
    populateOpsMonthSelect();
    loadOpsMonthData(currentMonthOps);
};

window.exportCurrentTable = function() {
    if (!opsDataTable) {
        alert('No hay una tabla cargada para exportar.');
        return;
    }
    if (typeof XLSX === 'undefined') {
        alert('La librería Excel aún no ha cargado. Espera un momento e intenta de nuevo.');
        return;
    }

    // Sólo las filas que pasan los filtros activos (búsqueda global + filtros de
    // encabezado tipo Excel). NO se exporta el total del dataset.
    const filteredRows = opsDataTable.rows({ search: 'applied' }).data().toArray();
    if (!filteredRows.length) {
        alert('No hay registros filtrados para exportar.');
        return;
    }

    // Reproducir las columnas visibles de la tabla (excluye el consecutivo "No.")
    const _isIndexKey = (key) => {
        const norm = String(key || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');
        return norm === 'no' || norm === 'n' || norm === 'num' || norm === '';
    };
    const keys = Object.keys(filteredRows[0]).filter(k => !_isIndexKey(k));
    const headers = keys.map(k => (typeof formatHeader === 'function' ? formatHeader(k) : k));

    const aoa = [headers].concat(
        filteredRows.map(row => keys.map(k => {
            const v = row ? row[k] : '';
            return (v === null || v === undefined) ? '' : v;
        }))
    );

    try {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        const sheetName = `${currentMonthOps || ''} ${currentYearOps || ''}`.trim().slice(0, 31) || 'Operaciones';
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const fileName = `Analisis_Operaciones_${currentMonthOps || ''}_${currentYearOps || ''}.xlsx`
            .replace(/\s+/g, '_').replace(/_+/g, '_');
        XLSX.writeFile(wb, fileName);
    } catch (e) {
        console.error('Error al exportar a Excel:', e);
        alert('Ocurrió un error al exportar a Excel.');
    }
};

function parseDate(dateStr) {
    if (!dateStr) return 0;
    const s = String(dateStr).trim();
    
    // ISO Date (YYYY-MM-DD...)
    if (s.includes('-')) { 
        // Handle T separator
        const datePart = s.split('T')[0]; 
        const parts = datePart.split('-');
        if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
        }
    }
    
    // DD/MM/YYYY
    if (s.includes('/')) {
        const parts = s.split('/');
        if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        }
    }
    
    // Excel integer date? Just in case
    if (!isNaN(s) && parseInt(s) > 20000) {
        // Excel base date 1900-01-01
        return new Date((s - 25569) * 86400 * 1000).getTime();
    }
    
    return 0;
}

// Helper for Excel-like filtering logic
function applyExcelFilters(api) {
    // 1. First Pass: Style Headers & Body
    api.columns().every(function () {
        const column = this;
        const header = $(column.header());

        // Remove existing custom elements
        header.find('.excel-filter-btn').remove();
        header.find('.excel-filter-dropdown').remove();

        // Style Body Cells (Center Content)
        $(column.nodes()).addClass('text-center align-middle');

        // Omitir columnas no buscables (p.ej. el consecutivo "No.")
        if (column.settings()[0].aoColumns[column.index()].bSearchable === false) {
            return;
        }

        // Omitir filtro en columnas de hora (Hora Programada / Hora Actual)
        const headerNorm = header.text().trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z]/g, '');
        if (headerNorm === 'horaprogramada' || headerNorm === 'horaactual') {
            return;
        }

        // Add Filter Button (Click to toggle menu)
        // Check if button already exists (FixedHeader might trigger redraws)
        if (header.find('.excel-filter-btn').length === 0) {
             $('<span class="excel-filter-btn" style="position:absolute; right:14px; top:50%; transform:translateY(-50%); cursor:pointer; z-index:15;"><i class="fas fa-filter text-muted" style="font-size:0.8em"></i></span>')
            .appendTo(header);
            header.addClass('has-filter'); // Ensure padding is applied via CSS
        } else {
             header.addClass('has-filter'); // Re-apply if lost
        }

        // Use delegated event handler for filter buttons to support FixedHeader clones
        $(document).off('click', '.excel-filter-btn').on('click', '.excel-filter-btn', function (e) {
                e.stopPropagation(); // Stop sorting
                e.preventDefault();

                // Check if this button is already active (menu open)
                if ($(this).hasClass('active')) {
                    $('.excel-filter-dropdown').remove();
                    $('.excel-filter-btn').removeClass('active');
                    return;
                }
                
                // Close other menus
                $('.excel-filter-dropdown').remove();
                $('.excel-filter-btn').removeClass('active');
                
                // Mark this button as active
                $(this).addClass('active');

                // Identify the column: 
                // We need to find the original header to get the column data.
                // The clicked button might be in a fixed header clone.
                const th = $(this).closest('th');
                const colIdx = th.index();
                
                // Get the API instance from the table visible in the document
                const tableApi = $('#ops-datatable').DataTable();
                
                // Use visible column index to get the correct data column
                // Note: accurate specifically for FixedHeader clones and colvis
                const column = tableApi.column(colIdx + ':visible');

                // Get unique sorted values (Natural Sort)
                const unique = [];
                column.data().unique().each(function (d) {
                    if (unique.indexOf(d) === -1) unique.push(d);
                });
                // Define btn as $(this) for subsequent code compatibility
                const btn = $(this);
                
                // Sort naturally (numeric strings aware)
                unique.sort((a, b) => {
                    if (a === b) return 0;
                    if (a === null || a === undefined) return 1;
                    if (b === null || b === undefined) return -1;
                    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
                });

                // Create Menu Container (Append to Body to avoid overflow clipping)
                const btnOffset = $(this).offset();
                const menu = $('<div class="excel-filter-dropdown arg-popover bg-white shadow rounded border p-2 text-start"></div>')
                    .css({
                        position: 'absolute',
                        top: btnOffset.top + $(this).outerHeight() + 5,
                        left: btnOffset.left - 200 > 10 ? btnOffset.left - 200 : 10, // Rudimentary constraint
                        zIndex: 9999, // High Z-Index
                        minWidth: '250px',
                        maxWidth: '300px',
                        width: 'max-content',
                        maxHeight: '400px',
                        display: 'flex',
                        flexDirection: 'column',
                        fontSize: '0.85rem',
                        textAlign: 'left'
                    })
                    .appendTo('body')
                    .on('click', e => e.stopPropagation());
                
                // Adjust position if off-screen
                const menuWidth = 250;
                if (btnOffset.left - menuWidth < 0) {
                     menu.css('left', btnOffset.left);
                }


                // Search Box
                const searchBox = $('<input type="text" class="form-control form-control-sm mb-2" placeholder="Buscar valor...">')
                    .appendTo(menu)
                    .on('keyup', function() {
                        const val = $(this).val().toLowerCase();
                        menu.find('.item-row').filter(function() { // Fixed selector to item-row
                            $(this).toggle($(this).text().toLowerCase().indexOf(val) > -1)
                        });
                    });

                // Select All / Clear Links
                const toolBar = $('<div class="d-flex justify-content-between mb-2 small px-1"></div>').appendTo(menu);
                $('<a href="#" class="text-decoration-none text-primary">Seleccionar todo</a>')
                    .appendTo(toolBar)
                    .on('click', (e) => {
                        e.preventDefault();
                        menu.find('.item-chk').prop('checked', true);
                    });
                
                $('<a href="#" class="text-decoration-none text-danger">Borrar filtro</a>')
                    .appendTo(toolBar)
                    .on('click', (e) => {
                        e.preventDefault();
                        menu.find('.item-chk').prop('checked', false);
                    });

                // List Container
                const list = $('<div class="overflow-auto border rounded p-1 mb-2 bg-light custom-scrollbar" style="max-height: 200px;"></div>').appendTo(menu);

                // Obtener el filtro activo de esta columna para restaurar el estado
                const currentSearch = column.search();
                let activeRegex = null;
                if (currentSearch) {
                    try { activeRegex = new RegExp(currentSearch); } catch (_) {}
                }

                unique.forEach(val => {
                        const safeVal = val === null || val === undefined ? '' : String(val);
                        const labelText = safeVal === '' ? '(Vacías)' : safeVal;

                        // Pre-marcar según el filtro actual de la columna
                        let isChecked = true;
                        if (activeRegex) {
                            // El valor está "seleccionado" si pasa el regex actual
                            isChecked = activeRegex.test(safeVal);
                        }

                        const row = $('<div class="form-check form-check-sm ms-1 mb-1 item-row"></div>').appendTo(list); // Added item-row class
                        const chk = $('<input class="form-check-input item-chk" type="checkbox">')
                        .prop('checked', isChecked)
                        .val(safeVal)
                        .appendTo(row);

                        $('<label class="form-check-label text-truncate w-100" style="cursor:pointer; padding-left: 4px;">')
                        .text(labelText)
                        .attr('title', labelText)
                        .on('click', (e) => {
                                e.stopPropagation();
                                chk.prop('checked', !chk.prop('checked'));
                        })
                        .appendTo(row);
                });

                        // Actions Footer
                        const actions = $('<div class="d-flex justify-content-end gap-2 pt-2 border-top bg-white sticky-bottom"></div>').appendTo(menu);
                        
                        $('<button class="btn btn-sm btn-light border px-3">Cancelar</button>')
                            .appendTo(actions)
                            .on('click', () => {
                                menu.remove();
                                btn.removeClass('active');
                            });
                            
                        $('<button class="btn btn-sm btn-primary px-3">Aceptar</button>')
                            .appendTo(actions)
                            .on('click', () => {
                                const selected = [];
                                list.find('.item-chk:checked').each(function() {
                                    selected.push($(this).val());
                                });

                                const escapeRegex = $.fn.dataTable.util.escapeRegex;
                                
                                if (selected.length === unique.length) {
                                    column.search('', true, false).draw();
                                    btn.find('i').removeClass('text-primary').addClass('text-muted');
                                } else if (selected.length === 0) {
                                    column.search('^$', true, false).draw();
                                    btn.find('i').removeClass('text-muted').addClass('text-primary');
                                } else {
                                    const searchStr = selected.map(v => {
                                        return v === '' ? '^$' : '^' + escapeRegex(v) + '$';
                                    }).join('|');
                                    column.search(searchStr, true, false).draw();
                                    btn.find('i').removeClass('text-muted').addClass('text-primary');
                                }
                                menu.remove();
                                btn.removeClass('active');
                            });
            }); // End of delegated click
    }); // End of columns().every()
    
    // Global click handler to close menus
    $(document).off('click.excelFilter').on('click.excelFilter', function(e) {
        if (!$(e.target).closest('.excel-filter-dropdown').length && !$(e.target).closest('.excel-filter-btn').length) {
            $('.excel-filter-dropdown').remove();
            $('.excel-filter-btn').removeClass('active');
        }
    });
}

// ── Heatmap drill-down: shows the list of flights behind a clicked cell ────
function _showHeatmapDrilldown(hour, dayIdx) {
    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const records  = (_heatmapDetails?.[hour]?.[dayIdx]) || [];

    const titleEl = document.getElementById('heatmap-drilldown-title');
    const bodyEl  = document.getElementById('heatmap-drilldown-body');
    if (!titleEl || !bodyEl) return;

    titleEl.innerHTML = `<i class="fas fa-table me-2 text-primary"></i>Vuelos — ${dayNames[dayIdx] || ''} ${hour}:00 &nbsp;<span class="badge bg-secondary fw-normal">${records.length} registro${records.length !== 1 ? 's' : ''}</span>`;

    if (records.length === 0) {
        bodyEl.innerHTML = '<p class="text-muted">Sin registros para esta celda.</p>';
    } else {
        const hasVuelo      = records.some(r => r.vuelo);
        const hasAerolinea  = records.some(r => r.aerolinea);
        const hasOrigen     = records.some(r => r.origen);
        const hasDestino    = records.some(r => r.destino);
        const hasMovimiento = records.some(r => r.movimiento);
        const hasServicio   = records.some(r => r.servicio);
        const hasAeronave   = records.some(r => r.aeronave);
        const hasFecha      = records.some(r => r.fecha);
        const hasHora       = records.some(r => r.hora);
        const hasPax        = records.some(r => r.pax > 0);

        const sorted   = [...records].sort((a, b) => b.pax - a.pax);
        const totalPax = records.reduce((s, r) => s + r.pax, 0);

        let html = `<p class="text-muted small mb-3">Total de pasajeros en esta franja: <strong class="text-primary">${totalPax.toLocaleString()}</strong></p>`;
        html += '<div class="table-responsive"><table class="table table-sm table-hover table-bordered align-middle mb-0" style="font-size:0.82rem"><thead class="table-light"><tr>';
        if (hasVuelo)      html += '<th>Vuelo</th>';
        if (hasAerolinea)  html += '<th>Aerolínea</th>';
        if (hasMovimiento) html += '<th>Mvto.</th>';
        if (hasOrigen)     html += '<th>Origen</th>';
        if (hasDestino)    html += '<th>Destino</th>';
        if (hasServicio)   html += '<th>Servicio</th>';
        if (hasAeronave)   html += '<th>Aeronave</th>';
        const hasPuntualidad = records.some(r => r.horaProg && r.hora && r.horaProg !== r.hora);
        if (hasFecha)         html += '<th>Hora Prog.</th>';
        if (hasHora)          html += '<th>Hora Actual</th>';
        if (hasPuntualidad)   html += '<th>Puntualidad</th>';
        if (hasPax)           html += '<th class="text-end">Pax</th>';
        html += '</tr></thead><tbody>';

        sorted.forEach(r => {
            html += '<tr>';
            if (hasVuelo)        html += `<td class="fw-semibold">${r.vuelo      || '—'}</td>`;
            if (hasAerolinea)    html += `<td>${r.aerolinea  || '—'}</td>`;
            if (hasMovimiento)   html += `<td>${r.movimiento || '—'}</td>`;
            if (hasOrigen)       html += `<td>${r.origen     || '—'}</td>`;
            if (hasDestino)      html += `<td>${r.destino    || '—'}</td>`;
            if (hasServicio)     html += `<td>${r.servicio   || '—'}</td>`;
            if (hasAeronave)     html += `<td>${r.aeronave   || '—'}</td>`;
            if (hasFecha)        html += `<td class="text-nowrap">${_fmtIsoDateTime(r.horaProg)}</td>`;
            if (hasHora)         html += `<td class="text-nowrap fw-semibold text-primary">${_fmtIsoDateTime(r.hora)}</td>`;
            if (hasPuntualidad)  html += `<td class="text-center">${_puntualidadBadge(r.horaProg, r.hora) || '—'}</td>`;
            if (hasPax)          html += `<td class="text-end fw-bold">${r.pax > 0 ? r.pax.toLocaleString() : '—'}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        bodyEl.innerHTML = html;
    }

    const modalEl = document.getElementById('heatmap-drilldown-modal');
    if (!modalEl) return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// ── Heatmap draw helpers (called on initial render and week filter changes) ─────

function _drawPassengerHeatmap(weekKey) {
    const heatmapEl = document.getElementById('ops-passenger-heatmap');
    if (!heatmapEl) return;
    const w = _paxHeatWeeks[weekKey] || _paxHeatWeeks['0'];
    const source  = w.data    || {};
    const details = w.details || {};
    const hasPaxData = _heatmapHasPax;
    const heatUnit   = hasPaxData ? 'Pasajeros' : 'Operaciones';
    const weekLabel  = weekKey === '0' ? 'Todas las semanas' : `Sem. ${_calWeekLabel(weekKey)}`;

    const allHeatValues = _HEATMAP_HOUR_LABELS.flatMap(h => (source[h] || Array(7).fill(0)));
    const maxHeat = Math.max(1, ...allHeatValues);
    const getHeatColor = (v) => {
        const ratio = Math.max(0, Math.min(1, v / maxHeat));
        return `rgba(13, 110, 253, ${0.08 + ratio * 0.72})`;
    };

    const colTotals = Array(7).fill(0);
    const hourTotals = {};
    _HEATMAP_HOUR_LABELS.forEach(hour => {
        const vals = source[hour] || Array(7).fill(0);
        hourTotals[hour] = vals.reduce((a, b) => a + b, 0);
        vals.forEach((v, i) => { colTotals[i] += v; });
    });
    const grandTotal = colTotals.reduce((a, b) => a + b, 0);

    // Week filter buttons — sorted calendar weeks with date-range labels
    const availWeeks = Object.keys(_paxHeatWeeks).filter(k => k !== '0').sort();
    let btnBar = '<div class="d-flex flex-wrap gap-1 mb-3 align-items-center"><span class="text-muted small me-1">Filtrar semana:</span>';
    btnBar += `<button class="btn btn-sm week-filter-btn ${weekKey === '0' ? 'btn-primary' : 'btn-outline-secondary'}" onclick="window._filterPassengerHeatmap('0')">Todas</button>`;
    availWeeks.forEach((wk, idx) => {
        const lbl = `S${idx + 1} ${_calWeekLabel(wk)}`;
        const active = weekKey === wk;
        btnBar += `<button class="btn btn-sm week-filter-btn ${active ? 'btn-primary' : 'btn-outline-secondary'}" onclick="window._filterPassengerHeatmap('${wk}')" title="${wk}">${lbl}</button>`;
    });
    btnBar += '</div>';

    let tableHtml = btnBar;
    tableHtml += `<p class="text-muted small mb-2">Muestra el total de <strong>${heatUnit}</strong> por franja horaria y día de la semana (${weekLabel}). Los colores más oscuros indican mayor actividad.</p>`;
    tableHtml += '<div class="table-responsive"><table class="table table-sm table-bordered align-middle text-center mb-0" style="font-size:0.78rem">';
    tableHtml += '<thead class="table-light"><tr><th>Hora</th>';
    const _paxDayNums = weekKey !== '0' ? _weekDayNumbers(weekKey) : null;
    _HEATMAP_DAY_LABELS.forEach((label, idx) => {
        tableHtml += _paxDayNums
            ? `<th>${label}<br><small class="fw-normal text-muted">${_paxDayNums[idx]}</small></th>`
            : `<th>${label}</th>`;
    });
    tableHtml += '<th class="table-secondary">Total</th></tr></thead><tbody>';

    _HEATMAP_HOUR_LABELS.forEach(hour => {
        const rowValues = source[hour] || Array(7).fill(0);
        const rowSum = hourTotals[hour];
        if (rowSum === 0) return;
        tableHtml += `<tr><th class="text-nowrap table-light">${hour}:00</th>`;
        rowValues.forEach((value, dayIdx) => {
            if (value > 0) {
                tableHtml += `<td data-hm-hour="${hour}" data-hm-day="${dayIdx}" style="background:${getHeatColor(value)};font-weight:600;cursor:pointer" title="Ver vuelos — ${hour}:00">${value.toLocaleString()}</td>`;
            } else {
                tableHtml += `<td style="background:${getHeatColor(0)}"></td>`;
            }
        });
        tableHtml += `<td class="table-secondary fw-bold">${rowSum.toLocaleString()}</td></tr>`;
    });

    tableHtml += '<tr class="table-secondary fw-bold"><th>Total</th>';
    colTotals.forEach(v => { tableHtml += `<td>${v.toLocaleString()}</td>`; });
    tableHtml += `<td>${grandTotal.toLocaleString()}</td></tr>`;
    tableHtml += '</tbody></table></div>';
    heatmapEl.innerHTML = tableHtml;

    _heatmapDetails = details;
    heatmapEl.querySelectorAll('td[data-hm-hour]').forEach(td => {
        td.addEventListener('click', () => {
            _showHeatmapDrilldown(td.dataset.hmHour, parseInt(td.dataset.hmDay, 10));
        });
    });
}

function _drawOpsHourHeatmap(weekKey) {
    const opsHourHeatEl = document.getElementById('ops-hour-heatmap');
    if (!opsHourHeatEl) return;
    const w = _opsHourHeatWeeks[weekKey] || _opsHourHeatWeeks['0'];
    const source  = w.data    || {};
    const details = w.details || {};
    const weekLabel = weekKey === '0' ? 'Todas las semanas' : `Sem. ${_calWeekLabel(weekKey)}`;

    const allOpsVals = _HEATMAP_HOUR_LABELS.flatMap(h => source[h] || Array(7).fill(0));
    const maxOps = Math.max(1, ...allOpsVals);
    const getOpsColor = (v) => {
        const ratio = Math.max(0, Math.min(1, v / maxOps));
        return `rgba(253, 126, 20, ${0.08 + ratio * 0.82})`;
    };

    const colTotalsOps = Array(7).fill(0);
    const hourTotalsOps = {};
    _HEATMAP_HOUR_LABELS.forEach(hour => {
        const vals = source[hour] || Array(7).fill(0);
        hourTotalsOps[hour] = vals.reduce((a, b) => a + b, 0);
        vals.forEach((v, i) => { colTotalsOps[i] += v; });
    });
    const grandTotalOps = colTotalsOps.reduce((a, b) => a + b, 0);

    // Week filter buttons — sorted calendar weeks with date-range labels
    const availWeeks = Object.keys(_opsHourHeatWeeks).filter(k => k !== '0').sort();
    let btnBar = '<div class="d-flex flex-wrap gap-1 mb-3 align-items-center"><span class="text-muted small me-1">Filtrar semana:</span>';
    btnBar += `<button class="btn btn-sm week-filter-btn ${weekKey === '0' ? 'btn-warning' : 'btn-outline-secondary'}" onclick="window._filterOpsHourHeatmap('0')">Todas</button>`;
    availWeeks.forEach((wk, idx) => {
        const lbl = `S${idx + 1} ${_calWeekLabel(wk)}`;
        const active = weekKey === wk;
        btnBar += `<button class="btn btn-sm week-filter-btn ${active ? 'btn-warning' : 'btn-outline-secondary'}" onclick="window._filterOpsHourHeatmap('${wk}')" title="${wk}">${lbl}</button>`;
    });
    btnBar += '</div>';

    let opsHtml = btnBar;
    opsHtml += `<p class="text-muted small mb-2">Muestra el total de <strong>Operaciones</strong> por franja horaria y día de la semana (${weekLabel}). <em>Excluye cancelados y no operativos.</em> Los colores más oscuros indican mayor actividad.</p>`;
    opsHtml += '<div class="table-responsive"><table class="table table-sm table-bordered align-middle text-center mb-0" style="font-size:0.78rem">';
    opsHtml += '<thead class="table-light"><tr><th>Hora</th>';
    const _opsDayNums = weekKey !== '0' ? _weekDayNumbers(weekKey) : null;
    _HEATMAP_DAY_LABELS.forEach((label, idx) => {
        opsHtml += _opsDayNums
            ? `<th>${label}<br><small class="fw-normal text-muted">${_opsDayNums[idx]}</small></th>`
            : `<th>${label}</th>`;
    });
    opsHtml += '<th class="table-secondary">Total</th></tr></thead><tbody>';

    _HEATMAP_HOUR_LABELS.forEach(hour => {
        const rowValues = source[hour] || Array(7).fill(0);
        const rowSum = hourTotalsOps[hour];
        if (rowSum === 0) return;
        opsHtml += `<tr><th class="text-nowrap table-light">${hour}:00</th>`;
        rowValues.forEach((value, dayIdx) => {
            if (value > 0) {
                opsHtml += `<td data-opshm-hour="${hour}" data-opshm-day="${dayIdx}" style="background:${getOpsColor(value)};font-weight:600;cursor:pointer" title="Ver vuelos — ${hour}:00">${value.toLocaleString()}</td>`;
            } else {
                opsHtml += `<td style="background:${getOpsColor(0)}"></td>`;
            }
        });
        opsHtml += `<td class="table-secondary fw-bold">${rowSum.toLocaleString()}</td></tr>`;
    });

    opsHtml += '<tr class="table-secondary fw-bold"><th>Total</th>';
    colTotalsOps.forEach(v => { opsHtml += `<td>${v.toLocaleString()}</td>`; });
    opsHtml += `<td>${grandTotalOps.toLocaleString()}</td></tr>`;
    opsHtml += '</tbody></table></div>';
    opsHourHeatEl.innerHTML = opsHtml;

    _heatmapOpsHourDetails = details;
    opsHourHeatEl.querySelectorAll('td[data-opshm-hour]').forEach(td => {
        td.addEventListener('click', () => {
            _showOpsHourDrilldown(td.dataset.opshmHour, parseInt(td.dataset.opshmDay, 10));
        });
    });
}

window._filterPassengerHeatmap = function(weekKey) {
    _drawPassengerHeatmap(String(weekKey));
};

window._filterOpsHourHeatmap = function(weekKey) {
    _drawOpsHourHeatmap(String(weekKey));
};

function _showOpsHourDrilldown(hour, dayIdx) {
    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const records  = (_heatmapOpsHourDetails?.[hour]?.[dayIdx]) || [];

    const titleEl = document.getElementById('heatmap-drilldown-title');
    const bodyEl  = document.getElementById('heatmap-drilldown-body');
    if (!titleEl || !bodyEl) return;

    titleEl.innerHTML = `<i class="fas fa-clock me-2 text-warning"></i>Operaciones — ${dayNames[dayIdx] || ''} ${hour}:00 &nbsp;<span class="badge bg-warning text-dark fw-normal">${records.length} operación${records.length !== 1 ? 'es' : ''}</span>`;

    if (records.length === 0) {
        bodyEl.innerHTML = '<p class="text-muted">Sin registros para esta celda.</p>';
    } else {
        const hasVuelo      = records.some(r => r.vuelo);
        const hasAerolinea  = records.some(r => r.aerolinea);
        const hasOrigen     = records.some(r => r.origen);
        const hasDestino    = records.some(r => r.destino);
        const hasMovimiento = records.some(r => r.movimiento);
        const hasServicio   = records.some(r => r.servicio);
        const hasAeronave   = records.some(r => r.aeronave);
        const hasFecha      = records.some(r => r.fecha);
        const hasHora       = records.some(r => r.hora);
        const hasEstatus    = records.some(r => r.estatus);

        const sorted = [...records].sort((a, b) => (a.vuelo || '').localeCompare(b.vuelo || ''));

        let html = `<p class="text-muted small mb-3">Total de operaciones en esta franja: <strong class="text-warning">${records.length.toLocaleString()}</strong> <em>(cancelados y no operativos excluidos)</em></p>`;
        html += '<div class="table-responsive"><table class="table table-sm table-hover table-bordered align-middle mb-0" style="font-size:0.82rem"><thead class="table-light"><tr>';
        if (hasVuelo)      html += '<th>Vuelo</th>';
        if (hasAerolinea)  html += '<th>Aerolínea</th>';
        if (hasMovimiento) html += '<th>Mvto.</th>';
        if (hasOrigen)     html += '<th>Origen</th>';
        if (hasDestino)    html += '<th>Destino</th>';
        if (hasServicio)   html += '<th>Servicio</th>';
        if (hasAeronave)   html += '<th>Aeronave</th>';
        const hasPuntualidad = records.some(r => r.horaProg && r.hora && r.horaProg !== r.hora);
        if (hasFecha)         html += '<th>Hora Prog.</th>';
        if (hasHora)          html += '<th>Hora Actual</th>';
        if (hasPuntualidad)   html += '<th>Puntualidad</th>';
        html += '</tr></thead><tbody>';

        sorted.forEach(r => {
            html += '<tr>';
            if (hasVuelo)        html += `<td class="fw-semibold">${r.vuelo      || '—'}</td>`;
            if (hasAerolinea)    html += `<td>${r.aerolinea  || '—'}</td>`;
            if (hasMovimiento)   html += `<td>${r.movimiento || '—'}</td>`;
            if (hasOrigen)       html += `<td>${r.origen     || '—'}</td>`;
            if (hasDestino)      html += `<td>${r.destino    || '—'}</td>`;
            if (hasServicio)     html += `<td>${r.servicio   || '—'}</td>`;
            if (hasAeronave)     html += `<td>${r.aeronave   || '—'}</td>`;
            if (hasFecha)        html += `<td class="text-nowrap">${_fmtIsoDateTime(r.horaProg)}</td>`;
            if (hasHora)         html += `<td class="text-nowrap fw-semibold text-warning">${_fmtIsoDateTime(r.hora)}</td>`;
            if (hasPuntualidad)  html += `<td class="text-center">${_puntualidadBadge(r.horaProg, r.hora) || '—'}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        bodyEl.innerHTML = html;
    }

    const modalEl = document.getElementById('heatmap-drilldown-modal');
    if (!modalEl) return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// ─── Init / API pública del módulo ─────────────────────────────────
window.addEventListener('analisis-operaciones:visible', () => {
    try { init(); } catch (e) { console.error('[analisis-operaciones] init error', e); }
});

// Init directo si la sección ya está activa al cargar (deep-link / refresh)
document.addEventListener('DOMContentLoaded', () => {
    const sec = document.getElementById('analisis-operaciones-section');
    if (sec && sec.classList.contains('active')) {
        try { init(); } catch (e) { console.error('[analisis-operaciones] init error', e); }
    }
});

window.AnalisisOperacionesModule = {
    init,
    loadMonth: loadOpsMonthData,
    renderCharts: renderOpsCharts,
    get state() {
        return {
            year: currentYearOps,
            month: currentMonthOps,
            rows: opsRawData,
            initialized: _moduleInitDone
        };
    }
};

// Punto de entrada para el sistema Realtime — invocado desde realtime.js
// cuando cambia la tabla Demoras en Supabase.
window.renderDemoras = function () {
    // Forzar recarga vaciando la caché del mes activo
    loadOpsMonthData(currentMonthOps, true);
};

})();
