/**
 * Vuelos (Parte de Operaciones) - CSV import
 * Estructura: tabla ancha con encabezados del CSV del software de aeropuerto.
 */
(function () {
    const TABLE_NAME = 'vuelos_parte_operaciones_csv';
    // Copia editable independiente que respalda esta pestaña de aquí en
    // adelante (lectura, observaciones, validado, y edición de celda por
    // celda). TABLE_NAME sigue siendo solo la bitácora cruda de importación
    // — no se lee ni se edita directamente aquí, salvo al importar.
    const EDIT_TABLE_NAME = 'itinerario_vuelos_editable';
    // Copia hermana que usa Conciliación Manifiestos para el lado "vuelos"
    // de su cruce. Solo se escribe aquí cuando algo debe seguir viéndose
    // reflejado en ambas pestañas (por ahora: validado/validado_por/validado_at).
    const MANIFIESTOS_MIRROR_TABLE_NAME = 'manifiestos_vuelos_editable';
    const HEADERS = [
        'Status',
        '[Arr] Airline code',
        '[Arr] Flight Designator',
        '[Arr] ALDT',
        '[Arr] SIBT',
        '[Arr] AIBT',
        '[Arr] Stand',
        '[Arr] Gates',
        '[Arr] Boarded',
        '[Arr] Baggage Belts',
        '[Arr] Service Type',
        'Routing',
        '[Dep] Service Type',
        'Aircraft type',
        'Registration',
        '[Dep] Airline code',
        '[Dep] Flight Designator',
        '[Dep] Stand',
        '[Dep] Gates',
        '[Dep] Boarded',
        '[Dep] SOBT',
        '[Dep] AOBT',
        '[Dep] ATOT',
        '[Dep] ATTT'
    ];
    const ARR_TIME_FIELDS = ['[Arr] SIBT', '[Arr] AIBT', '[Arr] ALDT'];
    const DEP_TIME_FIELDS = ['[Dep] SOBT', '[Dep] AOBT', '[Dep] ATOT', '[Dep] ATTT'];
    const DATE_FIELDS = [...ARR_TIME_FIELDS, ...DEP_TIME_FIELDS];
    const MONTHS = {
        JAN: 0,
        FEB: 1,
        MAR: 2,
        APR: 3,
        MAY: 4,
        JUN: 5,
        JUL: 6,
        AUG: 7,
        SEP: 8,
        OCT: 9,
        NOV: 10,
        DEC: 11
    };
    const LOCAL_AIRPORT_CODES = new Set(['NLU', 'MMSM']);
    const FLIGHT_IDENTITY_COLUMNS = 'id,arr_movement_key,arr_movement_slot,dep_movement_key,dep_movement_slot';
    const FLIGHT_FULL_SELECT = [
        'id',
        ...HEADERS.map(header => `"${header.replace(/"/g, '""')}"`)
    ].join(',');

    const HEADER_CLASSES = {
        'Status': 'col-cvs-status',
        '[Arr] Airline code': 'col-cvs-arr-airline',
        '[Arr] Flight Designator': 'col-cvs-arr-flight',
        '[Arr] ALDT': 'col-cvs-arr-aldt',
        '[Arr] SIBT': 'col-cvs-arr-sibt',
        '[Arr] AIBT': 'col-cvs-arr-aibt',
        '[Arr] Stand': 'col-cvs-arr-stand',
        '[Arr] Gates': 'col-cvs-arr-gates',
        '[Arr] Boarded': 'col-cvs-arr-boarded',
        '[Arr] Baggage Belts': 'col-cvs-arr-belts',
        '[Arr] Service Type': 'col-cvs-arr-type',
        'Routing': 'col-cvs-routing',
        '[Dep] Service Type': 'col-cvs-dep-type',
        'Aircraft type': 'col-cvs-aircraft',
        'Registration': 'col-cvs-reg',
        '[Dep] Airline code': 'col-cvs-dep-airline',
        '[Dep] Flight Designator': 'col-cvs-dep-flight',
        '[Dep] Stand': 'col-cvs-dep-stand',
        '[Dep] Gates': 'col-cvs-dep-gates',
        '[Dep] Boarded': 'col-cvs-dep-boarded',
        '[Dep] SOBT': 'col-cvs-dep-sobt',
        '[Dep] AOBT': 'col-cvs-dep-aobt',
        '[Dep] ATOT': 'col-cvs-dep-atot',
        '[Dep] ATTT': 'col-cvs-dep-attt'
    };

    let currentData = [];
    let columnFilters = {};
    let csvExcelFilters = {}; // field -> Set<string> of allowed values; absent key = no filter
    let dateMode = 'relative';
    let relStart = -4;
    let relEnd = 0;
    // When false (default), the date window is NOT applied and ALL imported rows are shown.
    // Set to true only when the user explicitly interacts with the date filter controls.
    let _dateWindowUserActivated = false;
    let _renderDebounceTimer = null;

    // Lightweight probe cache: stores id→date mapping for all rows so we only
    // download 3 columns once per session instead of all 24 columns every time.
    let _flightProbeCache = null; // { dayIdMap: Map<dateKey, id[]>, totalCount, ts }
    const _FLIGHT_PROBE_TTL_MS = 15 * 60 * 1000; // 15 minutes
    let _flightTotalCount = 0; // total rows across all days (shown in badge)
    let _stickySyncRaf = 0;

    // Schedule a debounced applyAndRender. Labels update instantly; the heavy
    // DOM work fires only once the user stops clicking (after 'delay' ms).
    function debouncedRender(delay) {
        clearTimeout(_renderDebounceTimer);
        updateRelativeLabels();          // instant feedback in the panel
        _renderDebounceTimer = setTimeout(applyAndRender, delay || 220);
    }

    function scheduleStickySync() {
        if (_stickySyncRaf) return;
        _stickySyncRaf = window.requestAnimationFrame(() => {
            _stickySyncRaf = 0;
            syncConciliacionStickyOffsets();
        });
    }

    function syncConciliacionStickyOffsets() {
        const csvTable = document.getElementById('table-ops-flights-csv');
        const csvRow1 = csvTable ? csvTable.querySelector('thead tr:first-child') : null;
        if (csvTable && csvRow1) {
            csvTable.style.setProperty('--csv-head-row1-height', `${Math.ceil(csvRow1.getBoundingClientRect().height)}px`);
        }

        ['table-board-arrivals', 'table-board-departures'].forEach(tableId => {
            const table = document.getElementById(tableId);
            const row1 = table ? table.querySelector('thead tr:first-child') : null;
            if (table && row1) {
                table.style.setProperty('--board-head-row1-height', `${Math.ceil(row1.getBoundingClientRect().height)}px`);
            }
        });
    }
    let absStart = '';
    let absEnd = '';
    let lastImportYear = new Date().getFullYear();
    let latestDataDate = null;
    let peakChart = null;

    document.addEventListener('DOMContentLoaded', () => {
        init();
        window.opsFlights = {
            loadFlights,
            // Force-refresh clears the probe cache so the next loadFlights re-probes Supabase.
            refreshFlights: () => { _flightProbeCache = null; return loadFlights(); },
            // Reset date picker filter — reload using latest available day.
            resetDateFilter: () => loadFlights(),
            resetModuleState,
            importCsvFromFile,
            toggleColumn,
            toggleValidacion,
            saveObservacion,
            editObservacion,
            getData: () => currentData,
            getHeaders: () => HEADERS,
            getDateFields: () => DATE_FIELDS,
            getLastImportYear: () => lastImportYear,
            clearAllFilters: clearAllCsvFilters,
            enterEditMode: () => itinEnterEditMode(),
            saveBulkEdits: () => itinSaveBulkEdits(),
            cancelBulkEdits: () => itinCancelBulkEdits()
        };
    });

    function init() {
        // Create style tag for column visibility
        if (!document.getElementById('csv-cols-style')) {
            const style = document.createElement('style');
            style.id = 'csv-cols-style';
            document.head.appendChild(style);
        }

        initColumnVisibility();

        // Listen on the Conciliación → Itinerario tab so switching back reloads data
        const conciTabEl = document.getElementById('tab-conci-itinerario');
        if (conciTabEl) {
            conciTabEl.addEventListener('shown.bs.tab', () => loadFlights());
        }

        // Re-load data whenever the date picker changes (load that specific day from DB)
        const conciPickerEl = document.getElementById('conci-date-picker');
        if (conciPickerEl) {
            conciPickerEl.addEventListener('change', () => loadFlights());
        }

        // Re-load data when the end-date picker changes (range mode)
        const conciEndPickerEl = document.getElementById('conci-date-end');
        if (conciEndPickerEl) {
            conciEndPickerEl.addEventListener('change', () => loadFlights());
        }

        // Legacy hook (element may not exist, kept for safety)
        const tabEl = document.getElementById('tab-vuelos-ops');
        if (tabEl) {
            tabEl.addEventListener('shown.bs.tab', () => loadFlights());
            if (tabEl.classList.contains('active')) {
                setTimeout(loadFlights, 300);
            }
        }

        const dateInput = document.getElementById('vuelos-ops-date');
        if (dateInput) dateInput.addEventListener('change', () => {
            updateRelativeLabels();
            loadFlights();
        });

        const btnRel = document.getElementById('btn-date-mode-relative');
        const btnAbs = document.getElementById('btn-date-mode-absolute');
        const relWrap = document.getElementById('ops-date-relative');
        const absWrap = document.getElementById('ops-date-absolute');
        const relStartInput = document.getElementById('rel-start');
        const relEndInput = document.getElementById('rel-end');
        const relStartLabel = document.getElementById('rel-start-label');
        const relEndLabel = document.getElementById('rel-end-label');
        const absStartInput = document.getElementById('ops-date-start');
        const absEndInput = document.getElementById('ops-date-end');

        const toggleDateMode = (mode) => {
            dateMode = mode;
            if (btnRel && btnAbs) {
                btnRel.classList.toggle('active', mode === 'relative');
                btnAbs.classList.toggle('active', mode === 'absolute');
            }
            if (relWrap && absWrap) {
                relWrap.classList.toggle('d-none', mode !== 'relative');
                absWrap.classList.toggle('d-none', mode !== 'absolute');
            }
            applyAndRender();
        };

        if (btnRel) btnRel.addEventListener('click', () => { _dateWindowUserActivated = true; toggleDateMode('relative'); });
        if (btnAbs) btnAbs.addEventListener('click', () => { _dateWindowUserActivated = true; toggleDateMode('absolute'); });

        const syncRelative = () => {
            _dateWindowUserActivated = true;
            relStart = parseInt(relStartInput ? relStartInput.value : relStart, 10);
            relEnd = parseInt(relEndInput ? relEndInput.value : relEnd, 10);
            if (isNaN(relStart)) relStart = -4;
            if (isNaN(relEnd)) relEnd = 0;
            updateRelativeLabels();
            applyAndRender();
        };

        if (relStartInput) relStartInput.addEventListener('input', syncRelative);
        if (relEndInput) relEndInput.addEventListener('input', syncRelative);

        const relStartDec = document.getElementById('rel-start-dec');
        const relStartInc = document.getElementById('rel-start-inc');
        const relEndDec = document.getElementById('rel-end-dec');
        const relEndInc = document.getElementById('rel-end-inc');

        // +/- buttons: update value immediately but debounce the heavy re-render
        const stepRel = (inputEl, delta) => {
            _dateWindowUserActivated = true;
            inputEl.value = parseInt(inputEl.value || 0, 10) + delta;
            relStart = parseInt(relStartInput ? relStartInput.value : relStart, 10);
            relEnd = parseInt(relEndInput ? relEndInput.value : relEnd, 10);
            if (isNaN(relStart)) relStart = -4;
            if (isNaN(relEnd)) relEnd = 0;
            debouncedRender(200);
        };

        if (relStartDec) relStartDec.addEventListener('click', () => stepRel(relStartInput, -1));
        if (relStartInc) relStartInc.addEventListener('click', () => stepRel(relStartInput, 1));
        if (relEndDec) relEndDec.addEventListener('click', () => stepRel(relEndInput, -1));
        if (relEndInc) relEndInc.addEventListener('click', () => stepRel(relEndInput, 1));

        const syncAbsolute = () => {
            _dateWindowUserActivated = true;
            absStart = absStartInput ? absStartInput.value : '';
            absEnd = absEndInput ? absEndInput.value : '';
            applyAndRender();
        };

        if (absStartInput) absStartInput.addEventListener('change', syncAbsolute);
        if (absEndInput) absEndInput.addEventListener('change', syncAbsolute);

        updateRelativeLabels(relStartLabel, relEndLabel);

        const filterInputs = document.querySelectorAll('#table-ops-flights-csv .csv-filter-row input');
        let _filterDebounce;
        filterInputs.forEach(input => {
            input.addEventListener('input', () => {
                const field = input.dataset.field;
                if (field) {
                    columnFilters[field] = input.value.trim();
                }
                clearTimeout(_filterDebounce);
                _filterDebounce = setTimeout(applyAndRender, 250);
            });
        });

        const btnSave = document.getElementById('btn-save-ops-itinerary-csv');
        const fileInput = document.getElementById('ops-itinerary-csv-file');

        if (btnSave && fileInput) {
            btnSave.addEventListener('click', () => {
                if (!fileInput.files || fileInput.files.length === 0) {
                    alert('Selecciona un archivo CSV primero.');
                    return;
                }
                importCsvFromFile(fileInput.files[0]);
            });
        }

        // Excel-style dropdown filters on header row
        initCsvExcelFilterButtons();
        scheduleStickySync();
        window.addEventListener('resize', scheduleStickySync);
    }

    // Format 'YYYY-MM-DD' → 'DDMMM' (e.g. '2026-06-29' → '29JUN')
    function _formatDateKey(key) {
        if (!key) return '';
        const ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const p = key.split('-');
        if (p.length !== 3) return key;
        return `${parseInt(p[2], 10)}${ABBR[parseInt(p[1], 10) - 1] || ''}`;
    }

    async function _buildFlightProbeCache(supabase) {
        const probeFresh = _flightProbeCache && (Date.now() - _flightProbeCache.ts) < _FLIGHT_PROBE_TTL_MS;
        if (probeFresh) return _flightProbeCache;

        const year = lastImportYear || new Date().getFullYear();
        const todayKey = (() => {
            const t = new Date();
            return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        })();

        // Fetch only id + 2 date columns (much smaller than all 24 columns)
        const { data: probe, error } = await supabase
            .from(EDIT_TABLE_NAME)
            .select('id,"[Arr] SIBT","[Dep] SOBT"');
        if (error) throw error;

        const dayIdMap = new Map(); // 'YYYY-MM-DD' → [id, ...]
        (probe || []).forEach(row => {
            const key = deriveDateKeyFromValue(row['[Arr] SIBT'], year)
                || deriveDateKeyFromValue(row['[Dep] SOBT'], year);
            if (!key || key > todayKey) return;
            if (!dayIdMap.has(key)) dayIdMap.set(key, []);
            dayIdMap.get(key).push(row.id);
        });

        _flightProbeCache = { dayIdMap, totalCount: (probe || []).length, ts: Date.now() };
        return _flightProbeCache;
    }

    async function loadFlights() {
        const tbody = document.getElementById('tbody-ops-flights-csv');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="24" class="text-center py-4">Cargando...</td></tr>';
        }

        try {
            const supabase = window.supabaseClient;
            if (!supabase) throw new Error('Cliente Supabase no disponible');

            // Phase 1: lightweight probe (3 cols) to find latest date & per-day IDs
            const probe = await _buildFlightProbeCache(supabase);
            _flightTotalCount = probe.totalCount;

            const sortedKeys = [...probe.dayIdMap.keys()].sort();

            // Read start/end date pickers
            const pickerEl = document.getElementById('conci-date-picker');
            const endPickEl = document.getElementById('conci-date-end');
            const pickedDate = pickerEl && pickerEl.value ? pickerEl.value : null;
            const endDate = endPickEl && endPickEl.value ? endPickEl.value : null;

            let targetIds = [];
            let effectiveEndKey = null;

            if (pickedDate && endDate && endDate >= pickedDate) {
                // ── Range mode: collect all IDs for days within [pickedDate, endDate] ──
                for (const [key, ids] of probe.dayIdMap) {
                    if (key >= pickedDate && key <= endDate) {
                        targetIds.push(...ids);
                        effectiveEndKey = key;
                    }
                }
                latestDataDate = effectiveEndKey || pickedDate;
            } else {
                // ── Single-day mode: pick the specific date or the latest available ──
                const targetKey = (pickedDate && probe.dayIdMap.has(pickedDate))
                    ? pickedDate
                    : (sortedKeys.length ? sortedKeys[sortedKeys.length - 1] : null);

                if (!targetKey) {
                    currentData = [];
                    _dateWindowUserActivated = false;
                    computeLatestDataDate();
                    initCsvExcelFilterButtons();
                    applyAndRender();
                    return;
                }
                targetIds = probe.dayIdMap.get(targetKey) || [];
                latestDataDate = targetKey;
            }

            if (targetIds.length === 0) {
                currentData = [];
                _dateWindowUserActivated = false;
                computeLatestDataDate();
                initCsvExcelFilterButtons();
                applyAndRender();
                return;
            }

            // Phase 2: fetch full rows for all targeted day(s)
            const { data, error } = await supabase
                .from(EDIT_TABLE_NAME)
                .select('*')
                .in('id', targetIds);
            if (error) throw error;

            let rows = Array.isArray(data) ? data.map(normalizeRow) : [];
            currentData = rows;
            _dateWindowUserActivated = false;
            initCsvExcelFilterButtons();
            applyAndRender();
        } catch (err) {
            console.error(err);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="24" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`;
            }
        }
    }

    async function importCsvFromFile(file) {
        try {
            const content = await file.text();
            const rows = parseCsv(content);
            if (rows.length === 0) throw new Error('El archivo CSV está vacío.');

            const headers = rows.shift().map(h => h.trim());
            if (!headersMatch(headers)) {
                throw new Error('Los encabezados del CSV no coinciden con el formato requerido.');
            }

            const yearFromName = inferYearFromFilename(file.name);
            if (yearFromName) lastImportYear = yearFromName;

            const mapped = rows
                .filter(r => r.some(cell => String(cell || '').trim() !== ''))
                .map(r => mapRowToObject(headers, r));

            if (mapped.length === 0) throw new Error('No hay filas de datos válidas en el CSV.');

            // --- DUPLICATE DETECTION START ---
            const supabase = window.supabaseClient;
            if (!supabase) throw new Error('Cliente Supabase no disponible');

            const referenceDate = inferImportReferenceDate(file);
            lastImportYear = referenceDate.getFullYear();
            const preparedRows = mapped.map((row, index) => prepareFlightIdentity(row, referenceDate, index + 2));
            const invalidMovements = preparedRows.flatMap(item => item.invalidMovements);
            if (invalidMovements.length) {
                const sample = invalidMovements.slice(0, 8).join(', ');
                const extra = invalidMovements.length > 8 ? '…' : '';
                throw new Error(
                    `No se pudo construir la llave única de ${sample}${extra}. ` +
                    'Cada movimiento requiere aerolínea, número de vuelo, fecha programada y Routing.'
                );
            }

            const { data: existingIdentityRows, error: identityError } = await fetchAllFlightIdentityRows(supabase);
            if (identityError) {
                throw new Error(
                    'La protección de duplicados aún no está instalada en Supabase. ' +
                    'Ejecuta las migraciones 010_flight_movement_uniqueness.sql y ' +
                    '022_flight_movement_slot.sql antes de importar. ' +
                    `Detalle: ${identityError.message}`
                );
            }

            // Dos índices sobre lo ya guardado:
            //  • existingIdByMovement: identidad completa (llave + hora) -> ids.
            //    Es la unidad que la base protege con UNIQUE.
            //  • existingByBaseKey: llave sin hora -> movimientos guardados.
            //    Sirve para reconocer un movimiento al que el AODB le cambió la
            //    hora programada entre una exportación y otra.
            const existingIdByMovement = new Map();
            const existingByBaseKey = new Map();
            const existingKeysById = new Map();
            (existingIdentityRows || []).forEach(row => {
                const id = String(row.id);
                const arrIdentity = movementIdentity(row.arr_movement_key, row.arr_movement_slot);
                const depIdentity = movementIdentity(row.dep_movement_key, row.dep_movement_slot);
                existingKeysById.set(id, { arr: arrIdentity || null, dep: depIdentity || null });
                [
                    { key: row.arr_movement_key, slot: row.arr_movement_slot, identity: arrIdentity },
                    { key: row.dep_movement_key, slot: row.dep_movement_slot, identity: depIdentity }
                ].filter(entry => entry.identity).forEach(entry => {
                    if (!existingIdByMovement.has(entry.identity)) existingIdByMovement.set(entry.identity, new Set());
                    existingIdByMovement.get(entry.identity).add(id);
                    if (!existingByBaseKey.has(entry.key)) existingByBaseKey.set(entry.key, []);
                    existingByBaseKey.get(entry.key).push({ id, slot: entry.slot || '' });
                });
            });

            // El mismo software AODB a veces deja en el export dos registros
            // para el mismo movimiento (misma aerolínea+vuelo+fecha+dirección)
            // con un turnaround distinto enlazado — típicamente porque uno de
            // los dos ya fue cancelado/reemplazado y el otro es el vigente
            // (ej. un vuelo se reprograma con otra hora y queda un registro
            // "Cancelled" viejo junto al real). Cuando eso pasa, se conserva
            // la fila con estado activo y se descarta la cancelada/no-operando
            // en vez de abortar toda la importación.
            const isExcludedStatus = row => _EXCLUDED_STATUS_RE.test(String(row?.Status || '').trim());

            const uniquePrepared = [];
            const fileOwnerByMovement = new Map();
            let duplicatesInFile = 0;
            let resolvedCancelledInFile = 0;
            preparedRows.forEach(item => {
                const ownerIndexes = new Set(item.movementIdentities
                    .map(identity => fileOwnerByMovement.get(identity))
                    .filter(index => index !== undefined));
                if (ownerIndexes.size > 1) {
                    throw new Error(`La fila ${item.sourceRow} enlaza movimientos que pertenecen a turnarounds distintos dentro del archivo.`);
                }
                if (ownerIndexes.size === 1) {
                    const ownerIndex = [...ownerIndexes][0];
                    const previous = uniquePrepared[ownerIndex];
                    const sameTurnaround = previous.movementIdentities.length === item.movementIdentities.length
                        && previous.movementIdentities.every(identity => item.movementIdentities.includes(identity));
                    if (!sameTurnaround) {
                        const itemCancelled = isExcludedStatus(item.payload);
                        const previousCancelled = isExcludedStatus(previous.payload);
                        if (itemCancelled && !previousCancelled) {
                            // La fila nueva está cancelada/no-operando: se
                            // descarta y se conserva la ya vigente.
                            resolvedCancelledInFile++;
                            return;
                        }
                        if (previousCancelled && !itemCancelled) {
                            // La fila que ya estaba guardada era la
                            // cancelada/no-operando: la reemplaza la vigente.
                            uniquePrepared[ownerIndex] = item;
                            item.movementIdentities.forEach(identity => fileOwnerByMovement.set(identity, ownerIndex));
                            resolvedCancelledInFile++;
                            return;
                        }
                        const shared = item.movementIdentities.filter(identity => previous.movementIdentities.includes(identity));
                        throw new Error(
                            `La fila ${item.sourceRow} reutiliza un movimiento (${shared.join(', ')}) ` +
                            `con un enlace de llegada/salida diferente al de la fila ${previous.sourceRow}.`
                        );
                    }
                    uniquePrepared[ownerIndex] = item;
                    item.movementIdentities.forEach(identity => fileOwnerByMovement.set(identity, ownerIndex));
                    duplicatesInFile++;
                    return;
                }
                const newIndex = uniquePrepared.length;
                uniquePrepared.push(item);
                item.movementIdentities.forEach(identity => fileOwnerByMovement.set(identity, newIndex));
            });

            // A qué registro guardado corresponde cada movimiento del archivo.
            // Primero por identidad exacta (llave + hora programada) y, para lo
            // que sobre, emparejando por orden de hora dentro de la misma llave:
            // así un cambio de horario del AODB sigue actualizando el mismo
            // registro en vez de crear un duplicado, y la segunda rotación del
            // día del mismo vuelo se reconoce como un movimiento aparte.
            const arrMatchByItem = resolveMovementMatches(uniquePrepared, 'arr', existingByBaseKey);
            const depMatchByItem = resolveMovementMatches(uniquePrepared, 'dep', existingByBaseKey);

            const insertItems = [];
            const updateItems = [];
            const ambiguousItems = [];
            uniquePrepared.forEach(item => {
                const matchedIds = new Set(
                    [arrMatchByItem.get(item), depMatchByItem.get(item)].filter(Boolean)
                );
                if (matchedIds.size > 1) {
                    ambiguousItems.push({ item, matchedIds });
                    return;
                }
                if (matchedIds.size === 1) updateItems.push({ id: [...matchedIds][0], ...item });
                else insertItems.push(item);
            });

            // Igual que con los duplicados dentro del archivo: si una fila
            // enlaza con dos registros distintos ya en la base porque el
            // AODB reemplazó un movimiento cancelado por uno vigente en
            // importaciones separadas, se actualiza el vigente y se ignora
            // el cancelado en vez de abortar toda la importación. Solo se
            // sigue exigiendo revisión manual cuando ambos (o ninguno) de
            // los registros en conflicto están cancelados/no-operando.
            let resolvedCancelledInDb = 0;
            let resolvedTurnaroundReassignInDb = 0;
            if (ambiguousItems.length) {
                const ambiguousIds = [...new Set(ambiguousItems.flatMap(({ matchedIds }) => [...matchedIds]))];
                const statusById = new Map();
                for (const ids of chunkArray(ambiguousIds, 500)) {
                    const { data, error } = await supabase
                        .from(TABLE_NAME)
                        .select('id,"Status"')
                        .in('id', ids);
                    if (error) throw new Error(`No se pudieron revisar los registros en conflicto: ${error.message}`);
                    (data || []).forEach(row => statusById.set(String(row.id), row.Status));
                }
                ambiguousItems.forEach(({ item, matchedIds }) => {
                    const ids = [...matchedIds];
                    const activeIds = ids.filter(id => !_EXCLUDED_STATUS_RE.test(String(statusById.get(id) || '').trim()));
                    const cancelledIds = ids.filter(id => _EXCLUDED_STATUS_RE.test(String(statusById.get(id) || '').trim()));
                    if (activeIds.length === 1 && cancelledIds.length === ids.length - 1) {
                        updateItems.push({ id: activeIds[0], ...item });
                        resolvedCancelledInDb++;
                        return;
                    }
                    // El AODB a veces reasigna a qué salida continúa una
                    // llegada entre una exportación y otra (la aeronave de
                    // XN 1503 antes enlazaba con XN 1100 y ahora con
                    // XN 1106, por ejemplo). Cuando eso pasa, la llegada de
                    // esta fila y su salida coinciden, cada una, con un
                    // registro activo DISTINTO ya guardado. Se conserva el
                    // registro cuya llegada coincide -- es la identidad más
                    // estable del movimiento -- y se actualiza con el
                    // enlace nuevo; el enlace de salida obsoleto del otro
                    // registro se libera más abajo (ver liberación de
                    // llaves obsoletas) para que no choque con el nuevo.
                    const arrMatchedId = arrMatchByItem.get(item);
                    if (arrMatchedId && activeIds.includes(arrMatchedId)) {
                        updateItems.push({ id: arrMatchedId, ...item });
                        resolvedTurnaroundReassignInDb++;
                        return;
                    }
                    throw new Error(
                        `La fila ${item.sourceRow} coincide con más de un registro existente. ` +
                        'La base contiene un enlace de turnaround inconsistente que requiere revisión.'
                    );
                });
            }

            // Dos filas distintas del archivo pueden terminar apuntando al
            // MISMO registro existente: una coincide con su llegada actual
            // y otra con su salida actual, porque el AODB reasignó cada
            // mitad del turnaround a un movimiento distinto por separado
            // (ej. la llegada VB 9405 antes salía como VB 9222 y ahora sale
            // como VB 842; y la salida VB 9222 antes venía de VB 9405 y
            // ahora viene de VB 771). Solo una de las dos puede quedarse
            // con ese id -- se conserva la que coincide por llegada -- y la
            // otra pasa a ser un vuelo nuevo (insert) en vez de intentar
            // actualizar el mismo id dos veces, lo cual la base rechaza.
            let splitTurnaroundReassignments = 0;
            const updateItemsById = new Map();
            updateItems.forEach(entry => {
                if (!updateItemsById.has(entry.id)) updateItemsById.set(entry.id, []);
                updateItemsById.get(entry.id).push(entry);
            });
            const dedupedUpdateItems = [];
            updateItemsById.forEach(entries => {
                if (entries.length === 1) { dedupedUpdateItems.push(entries[0]); return; }
                const existingKeys = existingKeysById.get(entries[0].id) || {};
                const arrMatch = entries.find(e => e.arrIdentity && e.arrIdentity === existingKeys.arr);
                const winner = arrMatch || entries[0];
                dedupedUpdateItems.push(winner);
                entries.forEach(e => {
                    if (e === winner) return;
                    const { id, ...rest } = e;
                    insertItems.push(rest);
                    splitTurnaroundReassignments++;
                });
            });
            updateItems.length = 0;
            updateItems.push(...dedupedUpdateItems);

            // Un registro que ya no aparece en este archivo (su propia
            // llegada o salida cayó fuera de la ventana del CSV) puede
            // quedarse con una llave de llegada/salida que un registro
            // que SÍ estamos actualizando ahora necesita para sí mismo
            // (ver reasignación de rotación arriba). Si no se libera esa
            // llave obsoleta antes de guardar, la base rechaza el guardado
            // por violar la restricción de unicidad. Solo se detecta aquí
            // (de lectura); la limpieza real se hace más abajo, después de
            // que el usuario confirme la importación.
            const ARR_CLEAR_FIELDS = HEADERS.filter(h => h.startsWith('[Arr]'));
            const DEP_CLEAR_FIELDS = HEADERS.filter(h => h.startsWith('[Dep]'));
            const staleKeyClears = new Map(); // id -> Set('arr' | 'dep')
            const markStaleHolders = (identity, ownTargetId) => {
                if (!identity) return;
                const holders = existingIdByMovement.get(identity);
                if (!holders) return;
                const side = identity.split('|')[3] === 'A' ? 'arr' : 'dep';
                holders.forEach(holderId => {
                    if (holderId === ownTargetId) return;
                    if (!staleKeyClears.has(holderId)) staleKeyClears.set(holderId, new Set());
                    staleKeyClears.get(holderId).add(side);
                });
            };
            updateItems.forEach(entry => {
                markStaleHolders(entry.arrIdentity, entry.id);
                markStaleHolders(entry.depIdentity, entry.id);
            });

            const existingFullById = new Map();
            const matchedIds = [...new Set(updateItems.map(item => item.id))];
            for (const ids of chunkArray(matchedIds, 500)) {
                const { data, error } = await supabase
                    .from(TABLE_NAME)
                    .select(FLIGHT_FULL_SELECT)
                    .in('id', ids);
                if (error) throw new Error(`No se pudieron comparar los vuelos existentes: ${error.message}`);
                (data || []).forEach(row => existingFullById.set(String(row.id), row));
            }

            const rowsAreIdentical = (a, b) => HEADERS.every(header =>
                normalizeValue(a?.[header]) === normalizeValue(b?.[header])
            );
            const updateRows = [];
            let exactDuplicates = 0;
            updateItems.forEach(item => {
                const existing = existingFullById.get(String(item.id));
                if (existing && rowsAreIdentical(item.payload, existing)) {
                    exactDuplicates++;
                    return;
                }
                updateRows.push({ id: item.id, payload: item.payload });
            });
            const insertRows = insertItems.map(item => item.payload);
            const duplicatesCount = duplicatesInFile + exactDuplicates;

            if (insertRows.length === 0 && updateRows.length === 0) {
                alert(`Todos los ${mapped.length} registros del CSV ya existen en la base de datos. No se importará nada.`);
                return;
            }

            const parts = [
                `Se encontraron ${mapped.length} registros en el archivo.`,
                `Fecha de referencia: ${toLocalDateKey(referenceDate)}.`
            ];
            if (insertRows.length) parts.push(`- ${insertRows.length} son vuelos nuevos.`);
            if (updateRows.length) parts.push(`- ${updateRows.length} son vuelos existentes con datos actualizados (se actualizarán).`);
            if (duplicatesCount) parts.push(`- ${duplicatesCount} son duplicados exactos (se omiten).`);
            if (resolvedCancelledInFile) {
                parts.push(`- ${resolvedCancelledInFile} vuelo(s) tenían un registro cancelado/no-operando duplicado en el archivo (se omitió el cancelado, se conservó el vigente).`);
            }
            if (resolvedCancelledInDb) {
                parts.push(`- ${resolvedCancelledInDb} vuelo(s) coincidían con un registro cancelado/no-operando ya guardado en la base (se ignoró ese registro y se actualizó el vigente).`);
            }
            if (resolvedTurnaroundReassignInDb) {
                parts.push(`- ${resolvedTurnaroundReassignInDb} vuelo(s) tenían su rotación reasignada a otra salida en la base (se actualizó el registro de la llegada).`);
            }
            if (splitTurnaroundReassignments) {
                parts.push(`- ${splitTurnaroundReassignments} vuelo(s) formaban parte de un turnaround que se dividió en dos movimientos distintos (se actualizó el registro por su llegada y se creó un vuelo nuevo para la otra mitad).`);
            }
            if (staleKeyClears.size) {
                parts.push(`- ${staleKeyClears.size} registro(s) en la base tenían una llegada/salida que quedó obsoleta por una reasignación de rotación; se liberará ese enlace (no se borra el registro, solo esa mitad del turnaround).`);
            }
            const confirmMsg = parts.join('\n') + `\n\n¿Deseas continuar con la importación?`;

            if (!confirm(confirmMsg)) return;

            // Libera llaves obsoletas ANTES de escribir los datos nuevos,
            // para que no choquen con la restricción de unicidad.
            if (staleKeyClears.size) {
                const clearRows = [...staleKeyClears.entries()].map(([id, sides]) => {
                    const payload = { id };
                    if (sides.has('arr')) ARR_CLEAR_FIELDS.forEach(f => { payload[f] = null; });
                    if (sides.has('dep')) DEP_CLEAR_FIELDS.forEach(f => { payload[f] = null; });
                    return payload;
                });
                for (const batch of chunkArray(clearRows, 500)) {
                    const results = await Promise.all([
                        supabase.from(TABLE_NAME).upsert(batch, { onConflict: 'id' }),
                        supabase.from(EDIT_TABLE_NAME).upsert(batch, { onConflict: 'id' }),
                        supabase.from(MANIFIESTOS_MIRROR_TABLE_NAME).upsert(batch, { onConflict: 'id' })
                    ]);
                    if (results[0].error) throw new Error(`No se pudo liberar un enlace obsoleto: ${results[0].error.message}`);
                    results.slice(1).forEach((r, i) => {
                        if (r.error) console.warn(`[Itinerario] no se pudo liberar enlace obsoleto en tabla espejo ${i}:`, r.error);
                    });
                }
            }

            // Los updates van primero: cuando una fila "pierde" el id y pasa
            // a insertarse como vuelo nuevo (ver más arriba), su llave
            // solo queda libre después de que el registro ganador se
            // actualice con sus datos nuevos. Insertar antes chocaría con
            // la llave que ese id todavía tiene.
            await updateExistingFlights(updateRows);
            await saveToDatabase(insertRows, true);

            const modalEl = document.getElementById('uploadOpsCsvModal');
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }

            _flightProbeCache = null; // new/updated rows — invalidate probe cache
            await loadFlights();

            const resultParts = [];
            if (insertRows.length) resultParts.push(`${insertRows.length} vuelo(s) nuevo(s) agregado(s)`);
            if (updateRows.length) resultParts.push(`${updateRows.length} vuelo(s) existente(s) actualizado(s)`);
            alert(`CSV importado correctamente: ${resultParts.join(', ') || 'sin cambios'}.`);
        } catch (err) {
            console.error(err);
            alert(`Error al importar CSV: ${err.message}`);
        }
    }

    // Copia cada fila recién insertada (con su mismo id) hacia las tablas
    // editables independientes de Itinerario y Manifiestos. Nunca borra nada
    // ahí — solo agrega — para que ediciones ya hechas en esas pestañas nunca
    // se pierdan por una reimportación. Es best-effort: si esto falla, el
    // import a la tabla cruda (ya confirmado al usuario) NO se revierte.
    async function _mirrorRowsToEditableTables(supabase, rowsWithId) {
        if (!rowsWithId.length) return;
        try {
            const chunks = chunkArray(rowsWithId, 500);
            for (const chunk of chunks) {
                const [itinRes, manifRes] = await Promise.all([
                    supabase.from('itinerario_vuelos_editable').upsert(chunk, { onConflict: 'id' }),
                    supabase.from('manifiestos_vuelos_editable').upsert(chunk, { onConflict: 'id' })
                ]);
                if (itinRes.error) console.warn('[Itinerario] no se pudo copiar a itinerario_vuelos_editable:', itinRes.error);
                if (manifRes.error) console.warn('[Itinerario] no se pudo copiar a manifiestos_vuelos_editable:', manifRes.error);
            }
        } catch (err) {
            console.warn('[Itinerario] error copiando a tablas editables:', err);
        }
    }

    async function saveToDatabase(rows, append = false) {
        const supabase = window.supabaseClient;
        if (!supabase) throw new Error('Cliente Supabase no disponible');

        // Only delete if NOT appending
        if (!append) {
            const { error: delError } = await supabase
                .from(TABLE_NAME)
                .delete()
                .neq('Status', '__all__');
            if (delError) throw delError;
        }

        const chunks = chunkArray(rows, 500);
        const insertedWithId = [];
        for (const chunk of chunks) {
            const { data: insertedRows, error: insError } = await supabase.from(TABLE_NAME).insert(chunk).select('id');
            if (insError) throw insError;
            // PostgREST insert-returning preserva el orden de envío: se puede
            // emparejar cada fila del chunk con su id recién asignado por índice.
            (insertedRows || []).forEach((r, i) => {
                if (r?.id !== undefined && r?.id !== null && chunk[i]) {
                    insertedWithId.push({ ...chunk[i], id: r.id });
                }
            });
        }

        await _mirrorRowsToEditableTables(supabase, insertedWithId);
    }

    // Un vuelo ya existente (misma aerolínea+designador+día) reimportado con
    // datos distintos (horario, stand, aeronave, etc.) se actualiza por id
    // en las 3 tablas en vez de crear una fila duplicada. Sólo se escriben
    // las columnas que trae el CSV — validado/observaciones/validado_por
    // (que no vienen del CSV) se preservan intactas.
    async function updateExistingFlights(updateRows) {
        if (!updateRows.length) return;
        const supabase = window.supabaseClient;
        for (const batch of chunkArray(updateRows, 500)) {
            const payloads = batch.map(({ id, payload }) => ({ ...payload, id }));
            const results = await Promise.all([
                supabase.from(TABLE_NAME).upsert(payloads, { onConflict: 'id' }),
                supabase.from(EDIT_TABLE_NAME).upsert(payloads, { onConflict: 'id' }),
                supabase.from(MANIFIESTOS_MIRROR_TABLE_NAME).upsert(payloads, { onConflict: 'id' })
            ]);
            results.forEach((r, i) => {
                if (r.error) console.warn(`[Itinerario] no se pudo actualizar un lote de vuelos existentes (tabla ${i}):`, r.error);
            });
            if (results[0].error) throw results[0].error;
        }
    }

    function initColumnVisibility() {
        const saved = localStorage.getItem('dm-ops-csv-columns');
        const container = document.querySelector('#container-ops-flights-csv');
        if (!container) return;

        if (saved) {
            try {
                const hiddenCols = JSON.parse(saved);
                if (Array.isArray(hiddenCols)) {
                    hiddenCols.forEach(col => {
                        // Checkbox unchecked
                        const chk = document.querySelector(`.col-toggle-csv[data-col="${col}"]`);
                        if (chk) chk.checked = false;
                    });
                }
            } catch (e) {
                console.error("Error parsing saved columns", e);
            }
        }

        // Initial build of styles
        rebuildColumnStyles();
    }

    function toggleColumn(colName, isVisible) {
        let styleTag = document.getElementById('csv-cols-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'csv-cols-style';
            document.head.appendChild(styleTag);
        }

        // We manage a list of hidden columns based on checkboxes
        // instead of adding/removing single rules, we rebuild the style content
        // to be cleaner and more robust.

        saveColumnVisibility(); // Save current state to local storage
        rebuildColumnStyles();  // Apply styles based on all checkboxes
    }

    function getHiddenClasses() {
        const hidden = new Set();
        const checkboxes = document.querySelectorAll('.col-toggle-csv');
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                const col = cb.getAttribute('data-col');
                if (col) hidden.add(col);
            }
        });
        return hidden;
    }

    function toggleColumn(colName, isVisible) {
        saveColumnVisibility();
        // Force full consistency check
        updateAllVisibility();
    }

    function updateAllVisibility() {
        const hiddenSet = getHiddenClasses();
        const tableId = '#table-ops-flights-csv';

        // 1. Dynamic CSS (Style Tag) - Global Rule
        let cssRules = '';
        hiddenSet.forEach(colClass => {
            cssRules += `${tableId} .${colClass}, ${tableId} th.${colClass}, ${tableId} td.${colClass} { display: none !important; } `;
        });

        // Add nth-child rules for extra robustness
        // Determine indices based on HEADER_CLASSES
        hiddenSet.forEach(colClass => {
            const headerName = Object.keys(HEADER_CLASSES).find(key => HEADER_CLASSES[key] === colClass);
            if (headerName) {
                const index = HEADERS.indexOf(headerName);
                if (index !== -1) {
                    const n = index + 1;
                    cssRules += `${tableId} tr > *:nth-child(${n}) { display: none !important; } `;
                }
            }
        });

        let styleTag = document.getElementById('csv-cols-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'csv-cols-style';
            document.head.appendChild(styleTag);
        }
        styleTag.textContent = cssRules;
        scheduleStickySync();
    }

    // Alias for compatibility
    const rebuildColumnStyles = updateAllVisibility;

    function removeSingleClassLogic() {
        // Legacy cleanup if needed
    }

    function saveColumnVisibility() {
        const checkboxes = document.querySelectorAll('.col-toggle-csv');
        const hidden = [];
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                const col = cb.getAttribute('data-col');
                if (col) hidden.push(col);
            }
        });
        localStorage.setItem('dm-ops-csv-columns', JSON.stringify(hidden));
    }

    function updateFlightCountBadge(count) {
        const badge = document.getElementById('csv-flight-count-badge');
        if (!badge) return;
        if (count === 0) {
            badge.style.display = 'none';
        } else {
            badge.style.display = '';
            const dayLabel = latestDataDate ? ` (${_formatDateKey(latestDataDate)})` : '';
            const totalSuffix = _flightTotalCount > count ? ` · ${_flightTotalCount} total` : '';
            badge.textContent = count === 1 ? `1 vuelo${dayLabel}${totalSuffix}` : `${count} vuelos${dayLabel}${totalSuffix}`;
        }
    }

    function renderTable(rows) {
        const tbody = document.getElementById('tbody-ops-flights-csv');
        if (!tbody) return;

        if (!rows || rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="26" class="text-center text-muted py-4">No hay registros para mostrar.</td></tr>';
            updateFlightCountBadge(0);
            return;
        }
        updateFlightCountBadge(rows.length);

        const dataIndexMap = new Map(currentData.map((item, idx) => [item, idx]));

        const html = rows.map(row => {
            const statusClass = getStatusClass(row['Status']);
            // Stable index into currentData (survives filter changes)
            const dataIdx = dataIndexMap.has(row) ? dataIndexMap.get(row) : currentData.indexOf(row);
            const cells = HEADERS.map(h => {
                const raw = row[h] || '';
                const content = escapeHtml(raw);
                const colClass = HEADER_CLASSES[h] || '';
                const colAttr = `data-col="${escapeHtml(h)}" data-raw="${escapeHtml(raw)}"`;

                if (h === '[Arr] Flight Designator' || h === '[Dep] Flight Designator') {
                    return `<td class="fw-bold ${colClass}" ${colAttr}>${content}</td>`;
                }
                if (h === 'Status') {
                    return `<td class="csv-status ${statusClass} ${colClass}" ${colAttr}>${content}</td>`;
                }
                return `<td class="${colClass}" ${colAttr}>${content}</td>`;
            }).join('');

            // Validation cell — uses dataIdx to reference currentData
            const valido = row._validado === true;
            const valPor = escapeHtml(row._validadoPor || '');
            const valAt = row._validadoAt
                ? new Date(row._validadoAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                : '';
            const validCell = valido
                ? `<td class="col-cvs-validation text-center" style="border-left:2px solid #c8d9f8;">
                      <span class="text-success fw-semibold" style="font-size:.78rem;" title="Validado por ${valPor}${valAt ? ' — ' + valAt : ''}">
                          <i class="fas fa-check-circle me-1"></i>Validado
                      </span>
                      <div class="text-muted" style="font-size:.65rem;line-height:1.1">${valPor}</div>
                      <button class="btn btn-link p-0 text-danger" style="font-size:.6rem;" title="Quitar validación"
                          onclick="window.opsFlights.toggleValidacion(${dataIdx}, true)">
                          <i class="fas fa-times-circle"></i> deshacer
                      </button>
                   </td>`
                : `<td class="col-cvs-validation text-center" style="border-left:2px solid #c8d9f8;">
                      <button class="btn btn-sm btn-outline-primary" style="font-size:.72rem;padding:2px 10px;"
                          onclick="window.opsFlights.toggleValidacion(${dataIdx}, false)" title="Marcar como validado">
                          <i class="fas fa-check me-1"></i>Validar
                      </button>
                   </td>`;

            // Observations cell — locked by default, click to edit
            const obsText = escapeHtml(row._observaciones || '');
            const obsCell = `<td class="col-cvs-observaciones obs-td" style="min-width:190px;padding:4px 6px;background:#f0fff4;border-left:2px solid #b7dfca;">
                <div class="obs-display" onclick="window.opsFlights.editObservacion(this,${dataIdx})" title="click para editar observación">
                    ${obsText
                    ? `<span class="obs-text">${obsText}</span>`
                    : `<span class="obs-placeholder">Sin observación</span>`}
                    <i class="fas fa-pencil-alt obs-edit-icon"></i>
                </div>
            </td>`;

            return `<tr data-row-idx="${dataIdx}" data-row-id="${escapeHtml(row._id ?? '')}"${valido ? ' class="row-validated"' : ''}>${cells}${obsCell}${validCell}</tr>`;
        }).join('');

        tbody.innerHTML = html;
        attachRowSelection(tbody);

        // Dynamic CSS already controls column visibility; avoid full re-scan per render.
        scheduleStickySync();
    }

    function editObservacion(displayEl, dataIdx) {
        const td = displayEl.closest('td');
        if (td.querySelector('.obs-edit-wrap')) return; // already editing
        const row = currentData[dataIdx];
        const current = row ? (row._observaciones || '') : '';

        // Build edit UI
        const wrap = document.createElement('div');
        wrap.className = 'obs-edit-wrap';

        const ta = document.createElement('textarea');
        ta.className = 'form-control form-control-sm obs-textarea';
        ta.rows = 2;
        ta.placeholder = 'Escribe una observación…';
        ta.value = current;

        const btnRow = document.createElement('div');
        btnRow.className = 'obs-btn-row';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-success btn-xs obs-save-btn';
        saveBtn.innerHTML = '<i class="fas fa-check me-1"></i>Guardar';
        saveBtn.onclick = () => commitObservacion(td, displayEl, dataIdx, ta.value);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-outline-secondary btn-xs obs-cancel-btn';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
        cancelBtn.onclick = () => cancelObservacion(td, displayEl);

        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        wrap.appendChild(ta);
        wrap.appendChild(btnRow);

        displayEl.classList.add('d-none');
        td.appendChild(wrap);
        ta.focus();
        ta.selectionStart = ta.value.length;

        // Enter = save, Escape = cancel
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitObservacion(td, displayEl, dataIdx, ta.value); }
            if (e.key === 'Escape') cancelObservacion(td, displayEl);
        });
    }

    function cancelObservacion(td, displayEl) {
        const wrap = td.querySelector('.obs-edit-wrap');
        if (wrap) wrap.remove();
        displayEl.classList.remove('d-none');
    }

    async function commitObservacion(td, displayEl, dataIdx, value) {
        const saveBtn = td.querySelector('.obs-save-btn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        await saveObservacion(dataIdx, value);

        // Update display
        const row = currentData[dataIdx];
        const saved = row ? (row._observaciones || '') : '';
        const textEl = displayEl.querySelector('.obs-text, .obs-placeholder');
        if (textEl) {
            if (saved) {
                textEl.className = 'obs-text';
                textEl.textContent = saved;
            } else {
                textEl.className = 'obs-placeholder';
                textEl.textContent = 'Sin observación';
            }
        }

        // Exit edit mode
        cancelObservacion(td, displayEl);
    }

    async function saveObservacion(dataIdx, value) {
        const row = currentData[dataIdx];
        if (!row || !row._id) return;
        const trimmed = (value || '').trim();
        if (trimmed === (row._observaciones || '').trim()) return;
        try {
            const supabase = window.supabaseClient;
            const { error } = await supabase
                .from(EDIT_TABLE_NAME)
                .update({ observaciones: trimmed || null })
                .eq('id', row._id);
            if (error) throw error;
            row._observaciones = trimmed;
        } catch (err) {
            console.error('[saveObservacion]', err);
        }
    }

    async function toggleValidacion(dataIdx, currentState) {
        const row = currentData[dataIdx];
        if (!row) { console.warn('toggleValidacion: row not found at index', dataIdx); return; }

        const supabase = window.supabaseClient;
        if (!supabase) { alert('Supabase no disponible'); return; }

        const newState = !currentState;
        const userName = sessionStorage.getItem('user_fullname') || sessionStorage.getItem('currentUser') || 'Usuario';

        const updateData = {
            validado: newState,
            validado_por: newState ? userName : null,
            validado_at: newState ? new Date().toISOString() : null
        };

        try {
            let query = supabase.from(EDIT_TABLE_NAME).update(updateData);

            if (row._id) {
                // Preferred: update by primary key
                query = query.eq('id', row._id);
            } else {
                // Fallback: composite key (works before SQL migration adds id)
                query = query
                    .eq('[Arr] Flight Designator', row['[Arr] Flight Designator'] || '')
                    .eq('[Dep] Flight Designator', row['[Dep] Flight Designator'] || '')
                    .eq('[Dep] SOBT', row['[Dep] SOBT'] || '')
                    .eq('[Arr] SIBT', row['[Arr] SIBT'] || '');
            }

            const { error } = await query;
            if (error) throw error;

            // Mantiene sincronizado el badge "Itinerario validado" que ve
            // Conciliación Manifiestos (lee esta misma columna de su propia
            // copia). Best-effort: si falla, no revierte la validación
            // principal — solo se pierde el reflejo cruzado.
            if (row._id) {
                supabase.from(MANIFIESTOS_MIRROR_TABLE_NAME)
                    .update(updateData)
                    .eq('id', row._id)
                    .then(({ error: mirrorError }) => {
                        if (mirrorError) console.warn('[toggleValidacion] no se pudo reflejar en manifiestos_vuelos_editable:', mirrorError);
                    });
            }

            // Update local cache
            currentData[dataIdx]._validado = newState;
            currentData[dataIdx]._validadoPor = newState ? userName : '';
            currentData[dataIdx]._validadoAt = newState ? new Date().toISOString() : null;

            // Patch just the validation cell — no full re-render, no row color change
            const tr = document.querySelector(`#tbody-ops-flights-csv tr[data-row-idx="${dataIdx}"]`);
            if (!tr) return;
            const td = tr.querySelector('td.col-cvs-validation');
            if (!td) return;

            // Apply / remove validated row highlight
            if (newState) {
                tr.classList.add('row-validated');
            } else {
                tr.classList.remove('row-validated');
            }

            if (newState) {
                const dt = new Date().toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                const safeUser = escapeHtml(userName);
                td.innerHTML = `
                    <span class="text-success fw-semibold" style="font-size:.78rem;" title="Validado por ${safeUser} — ${dt}">
                        <i class="fas fa-check-circle me-1"></i>Validado
                    </span>
                    <div class="text-muted" style="font-size:.65rem;line-height:1.1">${safeUser}</div>
                    <button class="btn btn-link p-0 text-danger" style="font-size:.6rem;" title="Quitar validación"
                        onclick="window.opsFlights.toggleValidacion(${dataIdx}, true)">
                        <i class="fas fa-times-circle"></i> deshacer
                    </button>`;
            } else {
                td.innerHTML = `
                    <button class="btn btn-sm btn-outline-primary" style="font-size:.72rem;padding:2px 10px;"
                        onclick="window.opsFlights.toggleValidacion(${dataIdx}, false)" title="Marcar como validado">
                        <i class="fas fa-check me-1"></i>Validar
                    </button>`;
            }

            // Log to audit history
            if (typeof window.logHistory === 'function') {
                const flightId = row._id || `${row['[Dep] Flight Designator'] || ''}-${row['[Dep] SOBT'] || ''}`;
                const flightLabel = row['[Dep] Flight Designator'] || row['[Arr] Flight Designator'] || flightId;
                await window.logHistory(
                    newState ? 'VALIDAR' : 'DESVALIDAR',
                    'vuelos_itinerario',
                    String(flightId),
                    newState
                        ? `Vuelo ${flightLabel} validado en Conciliación`
                        : `Validación del vuelo ${flightLabel} deshecha en Conciliación`
                );
            }

            // Invalidar caché de Conciliación Manifiestos para que la pestaña refleje
            // el nuevo estado al recargar sin necesidad de acción manual del usuario.
            if (typeof window.invalidateConciVuelosCache === 'function') {
                window.invalidateConciVuelosCache();
            }
        } catch (err) {
            console.error('Error al actualizar validación:', err);
            alert('No se pudo guardar la validación: ' + err.message);
        }
    }

    function updateChart(rows, dateFilter) {
        // Chart removed as per request
        return;
    }

    // ── Resumen operativo del día ────────────────────────────────────────────
    const _EXCLUDED_STATUS_RE = /cancel|not.?oper|no.?opera|cnx|nop\b/i;
    const _CARGO_SVC_RE = /^F$/i; // Service Type 'F' = Full Freighter

    function computeItinerarioSummary(data) {
        let paxOps = 0, paxBoarded = 0, cargoOps = 0, cargoKg = 0;
        for (const row of data) {
            const status = String(row['Status'] || '').trim();
            if (_EXCLUDED_STATUS_RE.test(status)) continue; // skip cancelled / not operating

            const arrFlight = String(row['[Arr] Flight Designator'] || '').trim();
            const depFlight = String(row['[Dep] Flight Designator'] || '').trim();
            const arrSvc = String(row['[Arr] Service Type'] || '').trim();
            const depSvc = String(row['[Dep] Service Type'] || '').trim();
            const arrBoarded = Math.max(0, parseInt(row['[Arr] Boarded'] || '0', 10) || 0);
            const depBoarded = Math.max(0, parseInt(row['[Dep] Boarded'] || '0', 10) || 0);

            if (arrFlight) {
                if (_CARGO_SVC_RE.test(arrSvc)) { cargoOps++; cargoKg += arrBoarded; }
                else { paxOps++; paxBoarded += arrBoarded; }
            }
            if (depFlight) {
                if (_CARGO_SVC_RE.test(depSvc)) { cargoOps++; cargoKg += depBoarded; }
                else { paxOps++; paxBoarded += depBoarded; }
            }
        }
        return { paxOps, paxBoarded, cargoOps, cargoKg };
    }

    function updateSummaryStrip(data) {
        const strip = document.getElementById('itinerario-summary-strip');
        if (!strip) return;

        // El resumen por tarjetas no se muestra en la pestaña Itinerario.
        // Se conserva el bloque en el HTML para no romper referencias antiguas,
        // pero permanece oculto y no ocupa espacio.
        strip.classList.add('d-none');
    }

    // ── Indicador de filtros de columna activos ───────────────────────────
    function updateFilterIndicator() {
        const activeText   = Object.values(columnFilters).filter(v => v && v.trim()).length;
        const activeExcel  = Object.keys(csvExcelFilters).length;
        const total        = activeText + activeExcel;
        const badge        = document.getElementById('csv-col-filters-badge');
        const badgeText    = document.getElementById('csv-col-filters-text');
        if (!badge) return;
        if (total > 0) {
            badge.style.display = 'inline-flex';
            badge.disabled = false;
            badge.classList.add('csv-col-filters-active');
            const label = total === 1 ? 'Quitar 1 filtro' : `Quitar ${total} filtros`;
            if (badgeText) badgeText.textContent = label;
            badge.title = `${total === 1 ? 'Hay 1 filtro activo' : `Hay ${total} filtros activos`}. Haz clic para quitarlos.`;
        } else {
            badge.style.display = 'inline-flex';
            badge.disabled = true;
            badge.classList.remove('csv-col-filters-active');
            if (badgeText) badgeText.textContent = 'Sin filtros';
            badge.title = 'No hay filtros de columna activos.';
        }
    }

    function resetModuleState() {
        clearTimeout(_renderDebounceTimer);
        _renderDebounceTimer = null;
        _flightProbeCache = null;
        _flightTotalCount = 0;
        currentData = [];
        columnFilters = {};
        csvExcelFilters = {};
        dateMode = 'relative';
        relStart = -4;
        relEnd = 0;
        absStart = '';
        absEnd = '';
        latestDataDate = null;
        _dateWindowUserActivated = false;

        document.querySelectorAll('.csv-excel-dropdown').forEach(el => el.remove());
        document.querySelectorAll('#table-ops-flights-csv .csv-filter-row input').forEach(input => {
            input.value = '';
        });

        const values = {
            'rel-start': '-4',
            'rel-end': '0',
            'ops-date-start': '',
            'ops-date-end': '',
            'conci-date-end': '',
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
        document.getElementById('btn-date-mode-relative')?.classList.add('active');
        document.getElementById('btn-date-mode-absolute')?.classList.remove('active');
        document.getElementById('ops-date-relative')?.classList.remove('d-none');
        document.getElementById('ops-date-absolute')?.classList.add('d-none');

        updateCsvExcelFilterIcons();
        updateFilterIndicator();
        updateRelativeLabels();
        return loadFlights();
    }

    function clearAllCsvFilters() {
        document.querySelectorAll('.csv-excel-dropdown').forEach(el => el.remove());
        // Clear text filters
        columnFilters = {};
        document.querySelectorAll('#table-ops-flights-csv .csv-filter-row input').forEach(inp => { inp.value = ''; });
        // Clear Excel dropdown filters
        csvExcelFilters = {};
        updateCsvExcelFilterIcons();
        applyAndRender();
    }

    function applyAndRender() {
        const dateRef = getReferenceDate();
        const dateFiltered = applyDateWindow(currentData, dateRef);
        const filtered = applyFilters(dateFiltered);
        const sorted = sortRows(filtered, dateRef);
        renderTable(sorted);
        updateChart(sorted, dateRef);
        updateRelativeLabels();
        // Guard: ensure filter buttons are on all columns (handles caching / timing edge cases)
        initCsvExcelFilterButtons();
        updateCsvExcelFilterIcons();
        // Actualizar resumen operativo con los datos visibles
        updateSummaryStrip(filtered);
        // Actualizar indicador de filtros activos
        updateFilterIndicator();
    }

    function computeLatestDataDate() {
        const year = lastImportYear || new Date().getFullYear();
        // Cap at today: dates parsed as future (e.g. "31DEC" read back from Supabase
        // without a year gets stamped with the current year, making Dec 2025 data appear
        // as Dec 2026). We only want the most recent date that is today or in the past.
        const todayKey = (() => {
            const t = new Date();
            const y = t.getFullYear();
            const m = String(t.getMonth() + 1).padStart(2, '0');
            const d = String(t.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        })();
        let maxKey = '';
        currentData.forEach(row => {
            DATE_FIELDS.forEach(field => {
                const key = deriveDateKeyFromValue(row[field], year);
                if (key && key > maxKey && key <= todayKey) maxKey = key;
            });
        });
        latestDataDate = maxKey || null;
    }

    function getReferenceDate() {
        const dateInput = document.getElementById('vuelos-ops-date');
        if (dateInput && dateInput.value) return dateInput.value;
        // NOTE: operations-summary-date belongs to a different section (Parte Diario) and
        // must NOT be used here — it would make the date window point to a stale date and
        // hide all Conciliación data.
        if (latestDataDate) return latestDataDate;
        const today = new Date();
        return today.toISOString().slice(0, 10);
    }

    function updateRelativeLabels() {
        const relStartLabel = document.getElementById('rel-start-label');
        const relEndLabel = document.getElementById('rel-end-label');
        if (!relStartLabel || !relEndLabel) return;
        const dateRef = getReferenceDate();
        if (!dateRef) {
            relStartLabel.textContent = '—';
            relEndLabel.textContent = '—';
            return;
        }
        const base = new Date(dateRef + 'T12:00:00'); // noon avoids UTC midnight offset
        if (Number.isNaN(base.getTime())) {
            relStartLabel.textContent = '—';
            relEndLabel.textContent = '—';
            return;
        }
        const start = new Date(base);
        const end = new Date(base);
        start.setDate(start.getDate() + relStart);
        end.setDate(end.getDate() + relEnd);
        const formatter = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        relStartLabel.textContent = formatter.format(start);
        relEndLabel.textContent = formatter.format(end);
    }

    function normalizeRow(row) {
        const normalized = {};
        HEADERS.forEach(h => {
            const raw = row[h];
            normalized[h] = normalizeValue(raw);
        });
        // Preserve DB metadata needed for validation column
        normalized._id = row.id ?? null;
        normalized._validado = row.validado === true;
        normalized._validadoPor = row.validado_por || '';
        normalized._validadoAt = row.validado_at || null;
        normalized._observaciones = row.observaciones || '';
        return normalized;
    }

    function normalizeValue(value) {
        if (value === null || value === undefined) return '';
        const str = String(value).trim();
        if (str === '---') return '';
        return str;
    }

    // Orden de estatus tal como lo agrupa AODB (Amadeus) en su vista de
    // filtro de vuelos: sigue el ciclo de vida operativo real de un vuelo,
    // desde su programación hasta su cierre — con Cancelled/Not operating
    // siempre al final, sin importar la hora. Cualquier estatus que no esté
    // en esta lista (dato nuevo/no contemplado) se ordena junto a los
    // activos, justo antes de Cancelled/Not operating, para no perderlo de
    // vista entre los vuelos que sí importan operativamente.
    const STATUS_ORDER = [
        'flight scheduled',
        'flight activated',
        'departed from previous airport',
        'local radar update',
        'final approach',
        'landed',
        'ground return',
        'in block',
        'first bag',
        'last bag',
        'aircraft left previous stand',
        'gate occupied',
        'waiting for tobt',
        'tobt confirmation',
        'boarding starts',
        'off block',
        'take off',
        'closed',
        'billing validated',
        'cancelled',
        'not operating'
    ];
    const STATUS_ORDER_INDEX = new Map(STATUS_ORDER.map((s, i) => [s, i]));
    const STATUS_ORDER_UNKNOWN = STATUS_ORDER_INDEX.get('billing validated') + 0.5; // justo antes de Cancelled

    function statusGroup(row) {
        const s = String(row['Status'] || '').toLowerCase().trim();
        const idx = STATUS_ORDER_INDEX.get(s);
        return idx !== undefined ? idx : STATUS_ORDER_UNKNOWN;
    }

    function sortRows(rows, dateFilter) {
        const year = dateFilter
            ? parseInt(dateFilter.slice(0, 4), 10)
            : (lastImportYear || new Date().getFullYear());

        return [...rows].sort((a, b) => {
            // Level 1: agrupa por Status siguiendo el orden de ciclo de vida
            // de AODB (STATUS_ORDER) — Cancelled/Not operating siempre al final.
            const ga = statusGroup(a);
            const gb = statusGroup(b);
            if (ga !== gb) return ga - gb;

            // Level 2: sort by [Dep] SOBT (scheduled departure)
            const sobtA = parseOpsDateTime(a['[Dep] SOBT'], year);
            const sobtB = parseOpsDateTime(b['[Dep] SOBT'], year);

            // Flights without SOBT sink to the bottom of their group
            if (!sobtA && !sobtB) {
                // Level 3: fallback to [Arr] SIBT (scheduled arrival)
                const sibtA = parseOpsDateTime(a['[Arr] SIBT'], year);
                const sibtB = parseOpsDateTime(b['[Arr] SIBT'], year);
                if (!sibtA && !sibtB) return 0;
                if (!sibtA) return 1;
                if (!sibtB) return -1;
                return sibtA - sibtB;
            }
            if (!sobtA) return 1;
            if (!sobtB) return -1;
            return sobtA - sobtB;
        });
    }

    function deriveDateKey(row, dateFilter) {
        const yearOverride = dateFilter ? parseInt(dateFilter.slice(0, 4), 10) : null;
        const dt = getFirstDate(row, DATE_FIELDS, dateFilter, yearOverride);
        if (!dt) return '';
        // Use LOCAL date getters (not toISOString which is UTC) to avoid timezone
        // shifting evening flights into the next calendar day.
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getFirstDate(row, fields, dateFilter, yearOverride = null) {
        const year = yearOverride || (dateFilter ? parseInt(dateFilter.slice(0, 4), 10) : lastImportYear);
        for (const field of fields) {
            const val = row[field];
            const dt = parseOpsDateTime(val, year);
            if (dt) return dt;
        }
        return null;
    }

    function parseOpsDateTime(value, year) {
        if (!value) return null;
        const raw = String(value).trim().toUpperCase();
        const match = raw.match(/(\d{2})([A-Z]{3})\s+(\d{2}):(\d{2})/);
        if (!match) return null;
        const day = parseInt(match[1], 10);
        const month = MONTHS[match[2]];
        const hour = parseInt(match[3], 10);
        const minute = parseInt(match[4], 10);
        if (month === undefined) return null;
        return new Date(year, month, day, hour, minute);
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let value = '';
        let inQuotes = false;

        const data = text.replace(/^\uFEFF/, '');

        for (let i = 0; i < data.length; i++) {
            const char = data[i];
            const next = data[i + 1];

            if (char === '"') {
                if (inQuotes && next === '"') {
                    value += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === ',' && !inQuotes) {
                row.push(value);
                value = '';
                continue;
            }

            if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && next === '\n') i++;
                row.push(value);
                rows.push(row);
                row = [];
                value = '';
                continue;
            }

            value += char;
        }

        if (value.length > 0 || row.length > 0) {
            row.push(value);
            rows.push(row);
        }

        return rows;
    }

    function headersMatch(headers) {
        if (headers.length !== HEADERS.length) return false;
        for (let i = 0; i < HEADERS.length; i++) {
            if (headers[i] !== HEADERS[i]) return false;
        }
        return true;
    }

    function mapRowToObject(headers, row) {
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h] = normalizeValue(row[idx] || '');
        });
        return obj;
    }

    function inferYearFromFilename(filename) {
        const match = filename.toUpperCase().match(/(\d{2})([A-Z]{3})(\d{2})/);
        if (!match) return null;
        const year = parseInt(match[3], 10);
        return 2000 + year;
    }

    function toLocalDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function inferImportReferenceDate(file) {
        const filename = String(file?.name || '').toUpperCase();
        let match = filename.match(/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})/);
        if (match) {
            const rawYear = parseInt(match[3], 10);
            const year = rawYear < 100 ? 2000 + rawYear : rawYear;
            return new Date(year, MONTHS[match[2]], parseInt(match[1], 10), 12, 0, 0, 0);
        }
        match = filename.match(/(20\d{2})[-_. ](\d{1,2})[-_. ](\d{1,2})/);
        if (match) return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 12, 0, 0, 0);
        match = filename.match(/(\d{1,2})[-_. ](\d{1,2})[-_. ](20\d{2})/);
        if (match) return new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10), 12, 0, 0, 0);

        const modified = Number(file?.lastModified);
        const fallback = Number.isFinite(modified) && modified > 0 ? new Date(modified) : new Date();
        return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate(), 12, 0, 0, 0);
    }

    function scheduledDateKey(value, referenceDate) {
        const raw = String(value || '').trim().toUpperCase();
        const match = raw.match(/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
        if (!match) return '';
        const day = parseInt(match[1], 10);
        const month = MONTHS[match[2]];
        const reference = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
            ? referenceDate
            : new Date();
        const candidates = [reference.getFullYear() - 1, reference.getFullYear(), reference.getFullYear() + 1]
            .map(year => new Date(year, month, day, 12, 0, 0, 0))
            .filter(date => date.getMonth() === month && date.getDate() === day);
        candidates.sort((a, b) => Math.abs(a.getTime() - reference.getTime()) - Math.abs(b.getTime() - reference.getTime()));
        return candidates.length ? toLocalDateKey(candidates[0]) : '';
    }

    // Hora programada del movimiento ('10AUG 23:05' -> '23:05'). Replica
    // _aifa_movement_slot del lado de la base.
    function scheduledSlotKey(value) {
        const match = String(value || '').trim().match(/(\d{1,2}):(\d{2})/);
        if (!match) return '';
        return `${match[1].padStart(2, '0')}:${match[2]}`;
    }

    // Identidad completa de un movimiento: la llave de negocio más su hora
    // programada. Es lo que la base protege con UNIQUE (ver migración 022) y
    // por lo tanto lo que hay que comparar para decidir si dos filas son el
    // mismo movimiento. Sin la hora, dos rotaciones del mismo vuelo/ruta en el
    // mismo día (XN 1107 MTY-NLU a las 01:55 y a las 23:05 del 10AUG) se leen
    // como una sola y la importación aborta.
    function movementIdentity(key, slot) {
        return key ? `${key}@${slot || ''}` : '';
    }

    function normalizeIdentityToken(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '');
    }

    function normalizedFlightNumber(designator, carrierCode) {
        let designatorKey = normalizeIdentityToken(designator);
        const carrierKey = normalizeIdentityToken(carrierCode);
        if (carrierKey && designatorKey.startsWith(carrierKey)) designatorKey = designatorKey.slice(carrierKey.length);
        const numberMatch = designatorKey.match(/(\d+[A-Z]?)$/);
        return numberMatch ? numberMatch[1] : designatorKey;
    }

    function routeEndpoint(routing, direction) {
        const tokens = String(routing || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .split(/[^A-Z0-9]+/)
            .filter(Boolean);
        if (!tokens.length) return '';
        const isArrival = direction === 'A';
        if (isArrival) {
            const localIndex = tokens.findIndex(token => LOCAL_AIRPORT_CODES.has(token));
            return normalizeIdentityToken(localIndex > 0 ? tokens[localIndex - 1] : tokens[0]);
        }
        let localIndex = -1;
        tokens.forEach((token, index) => { if (LOCAL_AIRPORT_CODES.has(token)) localIndex = index; });
        return normalizeIdentityToken(localIndex >= 0 && localIndex < tokens.length - 1 ? tokens[localIndex + 1] : tokens[tokens.length - 1]);
    }

    function movementIdentityKey(row, direction, referenceDate) {
        const isArrival = direction === 'A';
        const carrier = normalizeIdentityToken(row[isArrival ? '[Arr] Airline code' : '[Dep] Airline code']);
        const designator = normalizeValue(row[isArrival ? '[Arr] Flight Designator' : '[Dep] Flight Designator']);
        if (!designator) return '';
        const flightNumber = normalizedFlightNumber(designator, carrier);
        const scheduledDate = scheduledDateKey(row[isArrival ? '[Arr] SIBT' : '[Dep] SOBT'], referenceDate);
        const endpoint = routeEndpoint(row.Routing, direction);
        if (!carrier || !flightNumber || !scheduledDate || !endpoint) return '';
        return `${carrier}|${flightNumber}|${scheduledDate}|${direction}|${endpoint}`;
    }

    function prepareFlightIdentity(row, referenceDate, sourceRow) {
        const arrDesignator = normalizeValue(row['[Arr] Flight Designator']);
        const depDesignator = normalizeValue(row['[Dep] Flight Designator']);
        const arrKey = movementIdentityKey(row, 'A', referenceDate);
        const depKey = movementIdentityKey(row, 'D', referenceDate);
        const arrSlot = scheduledSlotKey(row['[Arr] SIBT']);
        const depSlot = scheduledSlotKey(row['[Dep] SOBT']);
        const invalidMovements = [];
        if (arrDesignator && !arrKey) invalidMovements.push(`fila ${sourceRow} (llegada)`);
        if (depDesignator && !depKey) invalidMovements.push(`fila ${sourceRow} (salida)`);
        if (!arrDesignator && !depDesignator) invalidMovements.push(`fila ${sourceRow} (sin movimiento)`);
        const arrIdentity = movementIdentity(arrKey, arrSlot);
        const depIdentity = movementIdentity(depKey, depSlot);
        return {
            sourceRow,
            invalidMovements,
            arrKey,
            depKey,
            arrSlot,
            depSlot,
            arrIdentity,
            depIdentity,
            movementIdentities: [arrIdentity, depIdentity].filter(Boolean),
            payload: {
                ...row,
                import_reference_date: toLocalDateKey(referenceDate),
                arr_scheduled_date: arrKey ? scheduledDateKey(row['[Arr] SIBT'], referenceDate) : null,
                dep_scheduled_date: depKey ? scheduledDateKey(row['[Dep] SOBT'], referenceDate) : null,
                arr_movement_slot: arrSlot,
                dep_movement_slot: depSlot
            }
        };
    }

    // Empareja los movimientos de un lado (llegada o salida) del archivo con
    // los ya guardados en la base, agrupando por llave de negocio (sin hora):
    //
    //   1. Coincidencia exacta de identidad (misma llave y misma hora
    //      programada). Es la reimportación normal del mismo archivo.
    //   2. Lo que sobra se empareja por orden de hora. Así, si el AODB movió el
    //      horario programado de un vuelo entre dos exportaciones, se sigue
    //      actualizando ese mismo registro en vez de duplicarlo.
    //
    // Un movimiento del archivo sin pareja se queda sin id: es un vuelo nuevo.
    // Eso es justo lo que ocurre con la segunda rotación del día de un mismo
    // vuelo (XN 1107 MTY-NLU a las 01:55 y a las 23:05 del 10AUG): comparten
    // llave, pero cada una toma su propio registro en vez de chocar.
    function resolveMovementMatches(items, side, existingByBaseKey) {
        const keyProp = side === 'arr' ? 'arrKey' : 'depKey';
        const slotProp = side === 'arr' ? 'arrSlot' : 'depSlot';
        const bySlot = (a, b) => String(a).localeCompare(String(b));

        const itemsByBaseKey = new Map();
        items.forEach(item => {
            const baseKey = item[keyProp];
            if (!baseKey) return;
            if (!itemsByBaseKey.has(baseKey)) itemsByBaseKey.set(baseKey, []);
            itemsByBaseKey.get(baseKey).push(item);
        });

        const matches = new Map();
        itemsByBaseKey.forEach((fileItems, baseKey) => {
            const candidates = (existingByBaseKey.get(baseKey) || []).slice();
            const pending = [];
            fileItems.forEach(item => {
                const exactIndex = candidates.findIndex(candidate => candidate.slot === item[slotProp]);
                if (exactIndex >= 0) matches.set(item, candidates.splice(exactIndex, 1)[0].id);
                else pending.push(item);
            });
            pending.sort((a, b) => bySlot(a[slotProp], b[slotProp]));
            candidates.sort((a, b) => bySlot(a.slot, b.slot));
            pending.forEach((item, index) => {
                if (candidates[index]) matches.set(item, candidates[index].id);
            });
        });
        return matches;
    }

    function chunkArray(list, size) {
        const chunks = [];
        for (let i = 0; i < list.length; i += size) {
            chunks.push(list.slice(i, i + size));
        }
        return chunks;
    }

    async function fetchAllFlightIdentityRows(supabase) {
        const allRows = [];
        const batchSize = 5000;
        for (let from = 0; ; from += batchSize) {
            const { data, error } = await supabase
                .from(TABLE_NAME)
                .select(FLIGHT_IDENTITY_COLUMNS)
                .order('id', { ascending: true })
                .range(from, from + batchSize - 1);
            if (error) return { data: allRows, error };
            allRows.push(...(data || []));
            if (!data || data.length < batchSize) break;
        }
        return { data: allRows, error: null };
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function applyFilters(rows) {
        return rows.filter(row => {
            // Text-input filters (filter row)
            for (const [field, search] of Object.entries(columnFilters)) {
                if (!search) continue;
                const val = String(row[field] || '').toLowerCase();
                if (!val.includes(search.toLowerCase())) return false;
            }
            // Excel dropdown filters (header buttons)
            for (const [field, allowed] of Object.entries(csvExcelFilters)) {
                if (!allowed) continue;
                const val = String(row[field] || '');
                if (!allowed.has(val)) return false;
            }
            return true;
        });
    }

    function initCsvExcelFilterButtons() {
        // Buttons are embedded in HTML; just wire up click handlers (idempotent via dataset flag)
        document.querySelectorAll('#table-ops-flights-csv thead tr:first-child th[data-csv-filter-field]').forEach(th => {
            const field = th.dataset.csvFilterField;
            if (!field) return;
            const btn = th.querySelector('.csv-ef-btn');
            if (!btn) return;
            // Avoid attaching duplicate listeners
            if (btn.dataset.csvEfBound) return;
            btn.dataset.csvEfBound = '1';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                showCsvExcelFilter(field, btn);
            });
        });
    }

    function showCsvExcelFilter(field, triggerEl) {
        // Remove any existing dropdown
        document.querySelectorAll('.csv-excel-dropdown').forEach(el => el.remove());

        const rect = triggerEl.getBoundingClientRect();
        const container = document.getElementById('container-ops-flights-csv');
        const containerRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };

        const menu = document.createElement('div');
        menu.className = 'csv-excel-dropdown';
        document.body.appendChild(menu);

        // Position
        let left = rect.left;
        if (left + 240 > window.innerWidth) left = window.innerWidth - 250;
        menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${left}px;z-index:99999;` +
            `background:#fff;border:1px solid #ddd;box-shadow:0 4px 14px rgba(0,0,0,.18);` +
            `width:240px;border-radius:6px;padding:10px;font-size:.84rem;`;

        // Build value list from date-filtered data so only relevant options appear
        const dateRef = getReferenceDate();
        const visibleData = applyDateWindow(currentData, dateRef);
        const values = [...new Set(visibleData.map(r => String(r[field] || '')))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        const activeSet = csvExcelFilters[field] || null;

        menu.innerHTML = `
            <input type="text" class="form-control form-control-sm mb-2" placeholder="Buscar valor..." id="csv-ef-search">
            <div class="d-flex justify-content-between mb-2 small px-1">
                <a href="#" class="text-decoration-none text-primary" id="csv-ef-all">Seleccionar todo</a>
                <a href="#" class="text-decoration-none text-danger" id="csv-ef-none">Borrar filtro</a>
            </div>
            <div style="max-height:200px;overflow-y:auto;border:1px solid #eee;border-radius:4px;padding:4px;margin-bottom:10px;background:#f8f9fa;" id="csv-ef-list">
                ${values.map((v, i) => {
                    const checked = !activeSet || activeSet.has(v);
                    const label = v === '' ? '(Vac\u00edo)' : v;
                    return `<div class="csv-ef-item" data-value="${v.replace(/"/g, '&quot;')}">
                        <input class="form-check-input csv-ef-chk" type="checkbox" id="csv-ef-${i}" value="${v.replace(/"/g, '&quot;')}" ${checked ? 'checked' : ''}>
                        <label class="csv-ef-label" data-value="${v.replace(/"/g, '&quot;')}" title="click: solo este valor">${label}</label>
                    </div>`;
                }).join('')}
            </div>
            <div class="text-muted px-1 mb-2" style="font-size:.7rem;"><i class="fas fa-info-circle me-1"></i>click en el texto = solo ese valor &nbsp;·&nbsp; <i class="fas fa-check-square me-1"></i>= multi-selección</div>
            <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #eee;padding-top:8px;">
                <button class="btn btn-sm btn-light border" id="csv-ef-cancel">Cancelar</button>
                <button class="btn btn-sm btn-primary" id="csv-ef-apply">Aceptar</button>
            </div>`;

        menu.addEventListener('click', e => e.stopPropagation());

        const searchBox = menu.querySelector('#csv-ef-search');
        const listEl = menu.querySelector('#csv-ef-list');

        searchBox.addEventListener('input', () => {
            const txt = searchBox.value.toLowerCase();
            listEl.querySelectorAll('.csv-ef-item').forEach(item => {
                item.style.display = item.dataset.value.toLowerCase().includes(txt) ? 'flex' : 'none';
            });
        });

        // Clicking the label text = "solo este" → uncheck all, check only this one, apply immediately
        listEl.addEventListener('click', e => {
            const label = e.target.closest('.csv-ef-label');
            if (!label) return;
            e.preventDefault();
            const val = label.dataset.value;
            // Uncheck all, then check only the clicked one
            listEl.querySelectorAll('.csv-ef-chk').forEach(c => { c.checked = c.value === val; });
            // Apply immediately
            csvExcelFilters[field] = new Set([val]);
            menu.remove();
            updateCsvExcelFilterIcons();
            applyAndRender();
        });

        menu.querySelector('#csv-ef-all').addEventListener('click', e => {
            e.preventDefault();
            listEl.querySelectorAll('.csv-ef-chk').forEach(c => c.checked = true);
        });
        menu.querySelector('#csv-ef-none').addEventListener('click', e => {
            e.preventDefault();
            // "Borrar filtro" → remove the filter immediately and close
            delete csvExcelFilters[field];
            menu.remove();
            updateCsvExcelFilterIcons();
            applyAndRender();
        });
        menu.querySelector('#csv-ef-cancel').addEventListener('click', () => menu.remove());
        menu.querySelector('#csv-ef-apply').addEventListener('click', () => {
            const checked = [...listEl.querySelectorAll('.csv-ef-chk:checked')].map(c => c.value);
            // If all selected OR none selected → clear filter (show all)
            if (checked.length >= values.length || checked.length === 0) {
                delete csvExcelFilters[field];
            } else {
                csvExcelFilters[field] = new Set(checked);
            }
            menu.remove();
            updateCsvExcelFilterIcons();
            applyAndRender();
        });

        searchBox.focus();

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeFn(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeFn);
                }
            });
        }, 0);
    }

    function updateCsvExcelFilterIcons() {
        document.querySelectorAll('#table-ops-flights-csv thead tr:first-child th[data-csv-filter-field]').forEach(th => {
            const field = th.dataset.csvFilterField;
            const btn = th.querySelector('.csv-ef-btn');
            if (!btn) return;
            const isActive = !!csvExcelFilters[field];
            btn.classList.toggle('csv-ef-btn-active', isActive);
            th.classList.toggle('csv-filter-header-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            btn.title = isActive ? `Quitar filtro de ${field}` : `Filtrar ${field}`;
            // El embudo activo queda amarillo y cambia a icono de quitar filtro.
            btn.querySelector('i').className = isActive ? 'fas fa-filter-circle-xmark' : 'fas fa-filter';
        });
    }

    // Helper: given a raw time field value (e.g. "15FEB 07:30") and a year, return "YYYY-MM-DD" or ''
    function deriveDateKeyFromValue(value, year) {
        const dt = parseOpsDateTime(value, year);
        if (!dt) return '';
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // Returns true if ANY of the row's time fields falls within [startKey, endKey]
    function rowInDateWindow(row, startKey, endKey, year) {
        return DATE_FIELDS.some(field => {
            const key = deriveDateKeyFromValue(row[field], year);
            if (!key) return false;
            return key >= startKey && key <= endKey;
        });
    }

    function applyDateWindow(rows, dateRef) {
    // Date window only applies when the user has explicitly activated it via
    // the filter controls. By default ALL imported rows are shown.
        if (!_dateWindowUserActivated) return rows;

        // If we have data but couldn't determine any date from it, show everything.
        if (currentData.length > 0 && !latestDataDate && dateMode === 'relative') return rows;
        if (!dateRef && dateMode === 'absolute' && !absStart && !absEnd) return rows;

        // Use LOCAL date getters to avoid UTC offset shifting the boundary date
        const toLocalKey = d => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        if (dateMode === 'absolute') {
            const start = absStart || dateRef;
            const end = absEnd || dateRef;
            if (!start && !end) return rows;
            const year = parseInt((start || end).slice(0, 4), 10);
            return rows.filter(row => rowInDateWindow(row, start, end, year));
        }

        if (!dateRef) return rows;
        const base = new Date(dateRef + 'T12:00:00'); // use noon to avoid UTC edge at midnight
        if (Number.isNaN(base.getTime())) return rows;
        const start = new Date(base);
        const end = new Date(base);
        start.setDate(start.getDate() + relStart);
        end.setDate(end.getDate() + relEnd);
        if (start > end) {
            const temp = new Date(start);
            start.setTime(end.getTime());
            end.setTime(temp.getTime());
        }
        const startKey = toLocalKey(start);
        const endKey = toLocalKey(end);
        const year = parseInt(dateRef.slice(0, 4), 10);
        // A row is included if ANY of its time fields falls inside the date window.
        // This matches flights that cross midnight (e.g., SIBT on day-1 but AIBT on target day).
        return rows.filter(row => rowInDateWindow(row, startKey, endKey, year));
    }

    function getStatusClass(status) {
        const normalized = String(status || '').toLowerCase();
        if (normalized.includes('cancel')) return 'csv-status-red';
        if (normalized.includes('in block') || normalized.includes('flight activated')) return 'csv-status-green';
        return 'csv-status-blue';
    }

    function attachRowSelection(tbody) {
        if (tbody.dataset.rowSelectBound === 'true') return;
        tbody.dataset.rowSelectBound = 'true';

        tbody.addEventListener('click', (event) => {
            const interactiveTarget = event.target.closest('button, a, input, textarea, select, label');
            if (interactiveTarget) return;
            const row = event.target.closest('tr');
            if (!row) return;
            tbody.querySelectorAll('tr.csv-row-selected').forEach(r => {
                r.classList.remove('csv-row-selected');
                r.setAttribute('aria-selected', 'false');
            });
            row.classList.add('csv-row-selected');
            row.setAttribute('aria-selected', 'true');
        });
    }

    /* ════════════════════════════════════════════════════════════════════
     * Edición por celda de Itinerario de Vuelos.
     * Mismo patrón ya construido y probado en Conciliación Manifiestos
     * (script.js: _conciActivateCellEditor / _conciCommitCellRaw / Tab con
     * handler en fase de captura), adaptado a esta tabla: sin editor de
     * fecha especial (los 7 campos de fecha se editan como texto plano en
     * su formato original "DDMON HH:MM"), sin promoción de fila virtual
     * (todas las filas de aquí ya tienen id real desde el import).
     * ════════════════════════════════════════════════════════════════════ */
    let _itinEditMode = false;
    let _itinCellClickHandler = null;
    let _itinTabNavigationHandler = null;

    function _itinCanEdit() {
        return typeof window._conciCanCurrentUserEdit === 'function' ? window._conciCanCurrentUserEdit() : false;
    }

    function _itinRefreshToolbar() {
        const btnEdit = document.getElementById('btn-itin-edit-mode');
        const btnSave = document.getElementById('btn-itin-save-mode');
        const btnCancel = document.getElementById('btn-itin-cancel-mode');
        const canEdit = _itinCanEdit();
        if (btnEdit) { btnEdit.classList.toggle('d-none', !canEdit || _itinEditMode); btnEdit.disabled = !canEdit; }
        if (btnSave) { btnSave.classList.toggle('d-none', !canEdit || !_itinEditMode); btnSave.disabled = !canEdit; }
        if (btnCancel) { btnCancel.classList.toggle('d-none', !canEdit || !_itinEditMode); btnCancel.disabled = !canEdit; }
    }

    function _itinGetNextEditableCell(td) {
        if (!td) return null;
        const SEL = 'td[data-col]';
        let next = td.nextElementSibling;
        while (next && !next.matches(SEL)) next = next.nextElementSibling;
        if (next) return next;
        let row = td.parentElement ? td.parentElement.nextElementSibling : null;
        while (row) {
            const first = row.querySelector(SEL);
            if (first) return first;
            row = row.nextElementSibling;
        }
        return null;
    }

    function _itinGetPrevEditableCell(td) {
        if (!td) return null;
        const SEL = 'td[data-col]';
        let prev = td.previousElementSibling;
        while (prev && !prev.matches(SEL)) prev = prev.previousElementSibling;
        if (prev) return prev;
        let row = td.parentElement ? td.parentElement.previousElementSibling : null;
        while (row) {
            const cells = row.querySelectorAll(SEL);
            const last = cells.length ? cells[cells.length - 1] : null;
            if (last) return last;
            row = row.previousElementSibling;
        }
        return null;
    }

    function _itinActivateCellEditor(td) {
        if (!td || td.querySelector('.itin-cell-input')) return;
        const currentRaw = td.dataset.pendingRaw !== undefined ? td.dataset.pendingRaw : (td.dataset.raw || '');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm itin-cell-input';
        input.value = currentRaw;

        td.classList.add('itin-cell-active');
        td.textContent = '';
        td.appendChild(input);

        let closed = false;
        const closeEditor = (accept, move) => {
            if (closed) return;
            closed = true;
            td._itinCloseEditor = null;
            const fallbackRaw = td.dataset.pendingRaw !== undefined ? td.dataset.pendingRaw : (td.dataset.raw || '');
            const nextRaw = accept ? input.value : fallbackRaw;
            _itinCommitCellRaw(td, nextRaw, move);
        };
        td._itinCloseEditor = closeEditor;

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                closeEditor(true, 'next');
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeEditor(false, false);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                closeEditor(true, e.shiftKey ? 'prev' : 'next');
            }
        });
        input.addEventListener('blur', () => closeEditor(true, false));

        input.focus();
        input.select();
    }

    function _itinCommitCellRaw(td, nextRaw, move) {
        nextRaw = String(nextRaw ?? '').trim();
        td.dataset.pendingRaw = nextRaw;
        td.dataset.raw = nextRaw;

        const origRaw = td.dataset.origRaw || '';
        if (nextRaw !== origRaw) td.dataset.dirty = '1';
        else td.removeAttribute('data-dirty');

        const tr = td.closest('tr');
        if (tr) {
            const rowDirty = !!tr.querySelector('td[data-dirty="1"]');
            if (rowDirty) tr.dataset.dirty = '1';
            else tr.removeAttribute('data-dirty');
        }

        td.classList.remove('itin-cell-active');
        td.textContent = nextRaw;
        td.title = 'Clic para editar';

        if (tr && _itinEditMode) {
            clearTimeout(tr._itinAutoSaveTimer);
            tr._itinAutoSaveTimer = setTimeout(() => _itinAutoSaveRow(tr), 250);
        }

        if (move === 'next') {
            const nextCell = _itinGetNextEditableCell(td);
            if (nextCell) {
                nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                _itinActivateCellEditor(nextCell);
            }
        } else if (move === 'prev') {
            const prevCell = _itinGetPrevEditableCell(td);
            if (prevCell) {
                prevCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                _itinActivateCellEditor(prevCell);
            }
        }
    }

    async function _itinAutoSaveRow(tr) {
        if (!tr || !tr.isConnected || !_itinEditMode || !_itinCanEdit()) return;
        if (tr._itinAutoSavePromise) return tr._itinAutoSavePromise;
        const rowId = tr.dataset.rowId;
        if (!rowId) return; // todas las filas de esta tabla tienen id real desde el import
        const cells = Array.from(tr.querySelectorAll('td[data-col]'));
        const payload = {};
        cells.forEach(td => {
            const col = td.dataset.col;
            const raw = td.dataset.pendingRaw !== undefined ? td.dataset.pendingRaw : (td.dataset.raw || '');
            payload[col] = raw || null;
        });
        if (!Object.keys(payload).length) return;

        tr._itinAutoSavePromise = (async () => {
            try {
                const supabase = window.supabaseClient;
                if (!supabase) throw new Error('Supabase no disponible');
                const { error } = await supabase.from(EDIT_TABLE_NAME).update(payload).eq('id', rowId);
                if (error) {
                    tr.title = `Pendiente de guardar: ${error.message || 'error de base de datos'}`;
                    tr.classList.add('table-warning');
                    console.warn('[Itinerario] fila pendiente de guardar:', error);
                    return;
                }
                cells.forEach(td => {
                    td.dataset.origRaw = td.dataset.pendingRaw !== undefined ? td.dataset.pendingRaw : (td.dataset.raw || '');
                    td.removeAttribute('data-dirty');
                });
                tr.removeAttribute('data-dirty');
                tr.classList.remove('table-warning');
                tr.removeAttribute('title');
                // Mantiene currentData en memoria al día para que otros
                // renders (filtros, orden) no pisen la edición recién guardada.
                const dataIdx = Number(tr.dataset.rowIdx);
                if (Number.isFinite(dataIdx) && currentData[dataIdx]) {
                    Object.keys(payload).forEach(col => { currentData[dataIdx][col] = payload[col] || ''; });
                }
            } catch (err) {
                tr.title = `Pendiente de guardar: ${err.message || err}`;
                tr.classList.add('table-warning');
                console.warn('[Itinerario] error de guardado automático:', err);
            } finally {
                tr._itinAutoSavePromise = null;
            }
        })();
        return tr._itinAutoSavePromise;
    }

    function _itinSetTableEditableState(enabled) {
        const table = document.getElementById('table-ops-flights-csv');
        const tbody = table ? table.querySelector('tbody') : null;
        if (!table || !tbody) return;

        table.classList.toggle('itin-edit-mode', !!enabled);

        if (enabled) {
            if (!_itinCellClickHandler) {
                _itinCellClickHandler = (ev) => {
                    if (!_itinEditMode) return;
                    if (ev.target.closest('.itin-cell-input')) return;
                    const td = ev.target.closest('td[data-col]');
                    if (!td || !tbody.contains(td)) return;
                    _itinActivateCellEditor(td);
                };
            }
            tbody.addEventListener('click', _itinCellClickHandler);

            // Captura Tab antes de que el navegador saque el foco de la
            // tabla (mismo motivo que en Conciliación: sin esto, Tab se
            // sale del modo edición en vez de avanzar a la siguiente celda).
            if (!_itinTabNavigationHandler) {
                _itinTabNavigationHandler = (ev) => {
                    if (!_itinEditMode || ev.key !== 'Tab') return;
                    const input = ev.target.closest('.itin-cell-input');
                    const td = input ? input.closest('td[data-col]') : null;
                    if (!td || !tbody.contains(td)) return;
                    ev.preventDefault();
                    ev.stopImmediatePropagation();
                    if (typeof td._itinCloseEditor === 'function') {
                        td._itinCloseEditor(true, ev.shiftKey ? 'prev' : 'next');
                    }
                };
            }
            tbody.addEventListener('keydown', _itinTabNavigationHandler, true);

            tbody.querySelectorAll('td[data-col]').forEach(td => {
                td.dataset.origRaw = td.dataset.raw || '';
                td.dataset.pendingRaw = td.dataset.raw || '';
                td.removeAttribute('data-dirty');
                td.title = 'Clic para editar';
            });
        } else {
            if (_itinCellClickHandler) tbody.removeEventListener('click', _itinCellClickHandler);
            if (_itinTabNavigationHandler) tbody.removeEventListener('keydown', _itinTabNavigationHandler, true);
            tbody.querySelectorAll('td[data-col]').forEach(td => {
                if (typeof td._itinCloseEditor === 'function') td._itinCloseEditor(true, false);
                td.classList.remove('itin-cell-active');
                td.removeAttribute('data-dirty');
                td.title = '';
            });
            tbody.querySelectorAll('tr[data-dirty]').forEach(tr => tr.removeAttribute('data-dirty'));
        }
    }

    function itinEnterEditMode() {
        if (!_itinCanEdit()) { alert('Solo usuarios autorizados pueden editar esta tabla.'); return; }
        if (_itinEditMode) return;
        _itinEditMode = true;
        _itinSetTableEditableState(true);
        _itinRefreshToolbar();
    }

    function itinCancelBulkEdits() {
        if (!_itinEditMode) return;
        _itinEditMode = false;
        _itinSetTableEditableState(false);
        _itinRefreshToolbar();
        loadFlights();
    }

    async function itinSaveBulkEdits() {
        if (!_itinEditMode) return;
        const tbody = document.getElementById('tbody-ops-flights-csv');
        if (tbody) {
            const active = tbody.querySelector('td.itin-cell-active');
            if (active && typeof active._itinCloseEditor === 'function') active._itinCloseEditor(true, false);
            const pending = Array.from(tbody.querySelectorAll('tr[data-dirty="1"]'));
            await Promise.all(pending.map(tr => _itinAutoSaveRow(tr)));
        }
        _itinEditMode = false;
        _itinSetTableEditableState(false);
        _itinRefreshToolbar();
    }

    window.addEventListener('admin-mode-changed', _itinRefreshToolbar);
    setTimeout(_itinRefreshToolbar, 500);
})();/**
 * Logic for "Vuelos" tab (PDF Reader)
 * Structure: WIDE TABLE (13 Columns)
 * Matches DB Table 'daily_flights_ops' 1:1.
 */
(function () {
    let peakChart = null;
    let isEditMode = false;
    let currentData = [];
    let activeFilters = {
        arrival: {},
        departure: {}
    };
    let textFilters = {
        arrival: {},
        departure: {}
    };
    let filterMenu = null; // Container for the dropdown

    const getRowValue = (row, field) => {
        if (row[field] !== undefined && row[field] !== null) return String(row[field]);
        // Fallbacks for common case differences or aliases
        if (field === 'aerolinea' && row['Aerolinea'] !== undefined) return String(row['Aerolinea']);
        if (field === 'seq_no' && row['no'] !== undefined) return String(row['no']);
        if (field === 'vuelo_llegada' && row['vuelo'] !== undefined) return String(row['vuelo']);
        if (field === 'vuelo_salida' && row['vuelo'] !== undefined) return String(row['vuelo']);
        return '';
    };

    document.addEventListener('DOMContentLoaded', () => {
        init();
        // Prevent overwriting the main opsFlights object which handles CSV/Wide Table
        window.opsFlightsLegacy = { loadFlights, importJson, toggleEditMode, saveEditedData };
    });

    function init() {
        // Tab Show Event
        const tabEl = document.getElementById('tab-vuelos-ops');
        if (tabEl) {
            tabEl.addEventListener('shown.bs.tab', () => {
                // Sync date from main calendar if this one is empty
                const mainDate = document.getElementById('operations-summary-date');
                const myDate = document.getElementById('vuelos-ops-date');
                if (mainDate && myDate && !myDate.value) {
                    myDate.value = mainDate.value;
                }
                loadFlights();
            });

            // Check if active on load (since I just made it default)
            if (tabEl.classList.contains('active')) {
                // Small delay to allow main script to populate the initial date
                setTimeout(() => {
                    const mainDate = document.getElementById('operations-summary-date');
                    const myDate = document.getElementById('vuelos-ops-date');
                    if (mainDate && myDate && !myDate.value) {
                        myDate.value = mainDate.value;
                    }
                    loadFlights();
                }, 800);
            }
        }

        // Date Change Event for MAIN calendar
        const dateInputMain = document.getElementById('operations-summary-date');
        if (dateInputMain) {
            dateInputMain.addEventListener('change', () => {
                // If this tab is active, we might want to reload. 
                // But now we have a local date picker. 
                // Maybe we should sync local date if the tab is NOT active?
                // Or just ignore. Let's keep it simple: local controls local.
                const myDate = document.getElementById('vuelos-ops-date');
                if (myDate && dateInputMain.value) {
                    myDate.value = dateInputMain.value;
                }
                if (isTabActive()) loadFlights();
            });
        }

        // Date Change Event for LOCAL calendar
        const dateInputLocal = document.getElementById('vuelos-ops-date');
        if (dateInputLocal) {
            dateInputLocal.addEventListener('change', loadFlights);
        }

        // Save Button
        const btnSave = document.getElementById('btn-save-ops-itinerary-json');
        if (btnSave) btnSave.addEventListener('click', handleUpload);

        // JSON Process Button
        const btnProcessJson = document.getElementById('btn-process-ops-json');
        if (btnProcessJson) btnProcessJson.addEventListener('click', handleJsonPaste);
    }

    function isTabActive() {
        const pane = document.getElementById('vuelos-ops-pane');
        return pane && pane.classList.contains('active');
    }

    // --- CONCILIACION MODAL ---
    window.openConciliacionHistory = function (dateRef, seqNo, type, currentStatus, user, time, flightCode) {
        // Elements
        const modalEl = document.getElementById('modalConciliacionHistory');
        const iconEl = document.getElementById('conci-modal-icon');
        const statusEl = document.getElementById('conci-modal-status');
        const flightEl = document.getElementById('conci-modal-flight-info');
        const detailsEl = document.getElementById('conci-modal-details');
        const btnAction = document.getElementById('btn-conci-action');
        const warnEl = document.getElementById('conci-modal-action-warn');

        // Reset
        warnEl.classList.add('d-none');
        btnAction.disabled = false; // Reset disabled state from previous actions

        // Flight Info
        const flightInfo = `Vuelo: <strong>${flightCode}</strong> | Fecha: ${dateRef} | Secuencia: ${seqNo}`;
        flightEl.innerHTML = flightInfo;

        // Current Status UI
        if (currentStatus) {
            // Is Conciliated
            iconEl.innerHTML = '<i class="fas fa-check-circle text-success"></i>';
            statusEl.className = 'fw-bold mb-1 text-success';
            statusEl.innerText = 'CONCILIADO';

            // History Details
            if (user && user !== 'undefined' && user !== 'null') {
                detailsEl.innerHTML = `
                    <p class="mb-1"><strong>Realizado por:</strong> ${user}</p>
                    <p class="mb-0"><strong>Fecha/Hora:</strong> ${time}</p>
                `;
            } else {
                detailsEl.innerHTML = '<p class="text-muted fst-italic">Registro histórico sin detalles de usuario.</p>';
            }

            // Action Button -> Cancel
            btnAction.className = 'btn btn-danger';
            btnAction.innerHTML = '<i class="fas fa-times me-2"></i>Cancelar Conciliación';
            btnAction.onclick = () => {
                executeToggleConciliacion(dateRef, seqNo, type, true, modalEl);
            };

        } else {
            // Is NOT Conciliated
            iconEl.innerHTML = '<i class="fas fa-times-circle text-danger opacity-50"></i>';
            statusEl.className = 'fw-bold mb-1 text-danger';
            statusEl.innerText = 'NO CONCILIADO';

            detailsEl.innerHTML = '<p class="text-muted">Esperando validación por parte del área correspondiente.</p>';

            // Action Button -> Validate
            btnAction.className = 'btn btn-success';
            btnAction.innerHTML = '<i class="fas fa-check me-2"></i>Validar / Conciliar';
            btnAction.onclick = () => {
                executeToggleConciliacion(dateRef, seqNo, type, false, modalEl);
            };
        }

        // Show Modal
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) {
            modal.show();
        } else {
            modal = new bootstrap.Modal(modalEl);
            modal.show();
        }
    };

    async function executeToggleConciliacion(dateRef, seqNo, type, currentStatus, modalEl) {
        // Disable button immediately to show feedback
        const btn = document.getElementById('btn-conci-action');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Procesando...';
        }

        try {
            const supabase = window.supabaseClient;
            if (!supabase) throw new Error("Cliente Supabase no disponible");

            // Get Current User - Reliable Method (Supabase Auth)
            let userName = 'Usuario Sistema';
            try {
                // 1. Session Storage
                const userStr = sessionStorage.getItem('user');
                if (userStr) {
                    const u = JSON.parse(userStr);
                    userName = u.user_metadata?.full_name || u.email || userName;
                }

                // 2. Refresh from Auth if needed
                if (userName === 'Usuario Sistema' || userName.includes('Usuario (')) {
                    // Don't block purely on this if it fails
                    const { data, error } = await supabase.auth.getUser();
                    if (data && data.user) {
                        userName = data.user.user_metadata?.full_name || data.user.email || userName;
                        sessionStorage.setItem('user', JSON.stringify(data.user));
                    }
                }
            } catch (uErr) {
                console.warn("Error resolviendo usuario:", uErr);
            }

            // Fallback for manual role override
            if (userName === 'Usuario Sistema') {
                const role = sessionStorage.getItem('user_role');
                if (role) userName = `Usuario (${role})`;
            }

            const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: false });


            // 1. Fetch current JSON
            const { data: rowData, error: fetchError } = await supabase
                .from('vuelos_parte_operaciones')
                .select('data')
                .eq('date', dateRef)
                .single();

            if (fetchError) throw fetchError;

            let flights = rowData.data;
            if (!Array.isArray(flights)) throw new Error("Formato de datos inválido en DB");

            // 2. Find row
            const index = flights.findIndex(f => (f.seq_no || f.no) == seqNo);
            if (index === -1) throw new Error("No se encontró el vuelo");

            // 3. Update fields
            const field = type === 'arrival' ? 'conciliado_llegada' : 'conciliado_salida';
            const fieldBy = type === 'arrival' ? 'conciliado_llegada_by' : 'conciliado_salida_by';
            const fieldTime = type === 'arrival' ? 'conciliado_llegada_at' : 'conciliado_salida_at';

            const newState = !currentStatus;

            flights[index][field] = newState;

            if (newState) {
                flights[index][fieldBy] = userName;
                flights[index][fieldTime] = now;
            } else {
                delete flights[index][fieldBy];
                delete flights[index][fieldTime];
            }

            // 4. Save
            const { error: updateError } = await supabase
                .from('vuelos_parte_operaciones')
                .update({ data: flights })
                .eq('date', dateRef);

            if (updateError) throw updateError;

            // --- LOG HISTORY (Global History) ---
            if (window.logHistory) {
                const fRow = flights[index];
                const flightCode = type === 'arrival'
                    ? (fRow.vuelo_llegada || fRow['Vuelo de llegada'] || 'Vuelo Llegada')
                    : (fRow.vuelo_salida || fRow['Vuelo de salida'] || 'Vuelo Salida');

                const actionType = newState ? 'CONCILIACION' : 'CANCELACION';
                const actionVerb = newState ? 'concilió' : 'canceló la conciliación de';
                const direction = type === 'arrival' ? 'Llegada' : 'Salida';

                // Format Date from YYYY-MM-DD to DD-MM-YYYY
                let dateFormatted = dateRef;
                try {
                    const [y, m, d] = dateRef.split('-');
                    if (y && m && d) dateFormatted = `${d}-${m}-${y}`;
                } catch (e) { }

                const friendlyDetails = `El usuario <strong>${userName}</strong> ${actionVerb} el vuelo <strong>${flightCode}</strong> (${direction}) del día ${dateFormatted}.`;

                // Fire and forget log
                window.logHistory(actionType, 'Parte Operaciones', `${dateRef}-${seqNo}`, friendlyDetails);
            }

            // Hide Modal
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

            // Refresh Table
            loadFlights();

        } catch (err) {
            console.error("Error toggling conciliacion:", err);
            alert("Error: " + err.message);
            // Re-enable button
            const btn = document.getElementById('btn-conci-action');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Reintentar';
            }
        }
    }



    // --- EDIT MODE & FILTERS ---
    function toggleEditMode() {
        isEditMode = !isEditMode;
        const btnEdit = document.getElementById('btn-toggle-edit-mode');
        const btnSave = document.getElementById('btn-save-edit-mode');

        if (btnEdit) {
            if (isEditMode) {
                btnEdit.classList.remove('btn-outline-primary');
                btnEdit.classList.add('btn-primary');
                if (btnSave) btnSave.classList.remove('d-none');
            } else {
                btnEdit.classList.add('btn-outline-primary');
                btnEdit.classList.remove('btn-primary');
                if (btnSave) btnSave.classList.add('d-none');
            }
        }
        // applyFilters(); << This function didn't exist
        renderData(currentData);
    }

    async function saveEditedData() {
        if (!confirm("¿Estás seguro de guardar los cambios realizados?")) return;

        const inputs = document.querySelectorAll('.ops-input-edit');

        // Update internal data from inputs
        inputs.forEach(input => {
            const seqStr = String(input.dataset.seq);
            const field = input.dataset.field;
            const rowType = input.dataset.rowType;
            let val = input.value;

            if (input.type === 'number') {
                val = val ? parseInt(val) : 0;
            }

            const row = currentData.find(r => {
                const matchesSeq = String(r.seq_no || r.no) === seqStr;
                if (!matchesSeq) return false;

                // Disambiguate if seq is reused
                if (rowType === 'arrival') {
                    return (r.vuelo_llegada || r.fecha_hora_prog_llegada || r['Vuelo de llegada']);
                }
                if (rowType === 'departure') {
                    return (r.vuelo_salida || r.fecha_hora_prog_salida || r['Vuelo de salida']);
                }
                return true;
            });

            if (row) {
                row[field] = val;
                if (field === 'seq_no') row.no = val;

                // Sync Aliases
                if (field === 'vuelo_llegada') { row['Vuelo de llegada'] = val; row['vuelo_llegada'] = val; }
                if (field === 'vuelo_salida') { row['Vuelo de salida'] = val; row['vuelo_salida'] = val; }
                if (field === 'pasajeros_llegada') { row['Pasajeros llegada'] = val; row['pasajeros_llegada'] = val; }
                if (field === 'pasajeros_salida') { row['Pasajeros salida'] = val; row['pasajeros_salida'] = val; }
                if (field === 'matricula') { row['Matrícula'] = val; row['matricula'] = val; }
                if (field === 'origen') { row['Origen'] = val; row['origen'] = val; }
                if (field === 'destino') { row['Destino'] = val; row['destino'] = val; }
                if (field === 'aerolinea') { row['Aerolinea'] = val; row['aerolinea'] = val; }
                // Time fields
                if (field === 'fecha_hora_prog_llegada') { row['Hora programada_llegada'] = val; row['fecha_hora_prog_llegada'] = val; }
                if (field === 'fecha_hora_real_llegada') { row['Hora de salida_llegada'] = val; row['fecha_hora_real_llegada'] = val; }
                if (field === 'fecha_hora_prog_salida') { row['Hora programada_salida'] = val; row['fecha_hora_prog_salida'] = val; }
                if (field === 'fecha_hora_real_salida') { row['Hora de salida_salida'] = val; row['fecha_hora_real_salida'] = val; }
            }
        });

        try {
            await saveToDatabase(currentData);
            toggleEditMode(); // Exit edit mode
            await loadFlights();
        } catch (e) {
            alert("Error al guardar: " + e.message);
        }
    }

    function renderFilters() {
        const tables = [
            { id: 'table-ops-flights-arrivals', type: 'arrival' },
            { id: 'table-ops-flights-departures', type: 'departure' }
        ];

        tables.forEach(tbl => {
            const tableEl = document.getElementById(tbl.id);
            if (!tableEl) return;

            const thead = tableEl.querySelector('thead');
            if (!thead) return;

            const headerRow = thead.querySelector('tr');
            if (!headerRow) return;

            // Ensure a filter row exists for the column searchers
            let filterRow = thead.querySelector('.filter-row');
            if (!filterRow) {
                filterRow = document.createElement('tr');
                filterRow.className = 'filter-row text-center bg-light';
                thead.appendChild(filterRow);
            }
            filterRow.innerHTML = ''; // Rebuild it

            const cols = Array.from(headerRow.children);

            cols.forEach((th, idx) => {
                let field = null;
                if (tbl.type === 'arrival') {
                    if (idx === 0) field = 'seq_no';
                    else if (idx === 1) field = 'aerolinea';
                    else if (idx === 2) field = 'vuelo_llegada';
                    else if (idx === 3) field = 'origen';
                    else if (idx === 4) field = 'fecha_hora_prog_llegada';
                    else if (idx === 5) field = 'fecha_hora_real_llegada';
                    else if (idx === 6) field = 'pasajeros_llegada';
                } else {
                    if (idx === 0) field = 'aerolinea';
                    else if (idx === 1) field = 'vuelo_salida';
                    else if (idx === 2) field = 'destino';
                    else if (idx === 3) field = 'fecha_hora_prog_salida';
                    else if (idx === 4) field = 'fecha_hora_real_salida';
                    else if (idx === 5) field = 'pasajeros_salida';
                    else if (idx === 6) field = 'matricula';
                }

                // Add text input for this column (Buscador)
                const filterTd = document.createElement('td');
                if (field) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.placeholder = 'Buscar...';
                    input.value = textFilters[tbl.type][field] || '';
                    input.oninput = (e) => {
                        textFilters[tbl.type][field] = e.target.value;
                        renderData(currentData);
                    };
                    filterTd.appendChild(input);
                }
                filterRow.appendChild(filterTd);

                if (field) {
                    if (!th.classList.contains('excel-filter-header')) {
                        th.classList.add('excel-filter-header');
                        if (!th.querySelector('.filter-icon')) {
                            const icon = document.createElement('i');
                            icon.className = 'fas fa-chevron-down filter-icon';
                            th.appendChild(icon);
                        }
                        th.onclick = (e) => {
                            e.stopPropagation();
                            showExcelFilter(field, tbl.type, e);
                        };
                    }

                    const icon = th.querySelector('.filter-icon');
                    if (icon) {
                        const isActive = activeFilters[tbl.type][field] !== null && activeFilters[tbl.type][field] !== undefined;
                        if (isActive) {
                            icon.classList.add('active');
                            th.classList.add('filter-header-active');
                        } else {
                            icon.classList.remove('active');
                            th.classList.remove('filter-header-active');
                        }
                    }
                }
            });
        });

        if (!window._excelFilterInited) {
            document.addEventListener('click', (e) => {
                if (filterMenu && !filterMenu.contains(e.target)) {
                    filterMenu.style.display = 'none';
                }
            });
            window._excelFilterInited = true;
        }
    }

    function showExcelFilter(field, type, event) {
        if (!filterMenu) {
            filterMenu = document.createElement('div');
            filterMenu.className = 'excel-filter-menu';
            document.body.appendChild(filterMenu);
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const menuWidth = 220; // Matches CSS
        let left = rect.left;
        if (left + menuWidth > window.innerWidth) {
            left = window.innerWidth - menuWidth - 10;
        }

        filterMenu.style.top = rect.bottom + 'px';
        filterMenu.style.left = left + 'px';
        filterMenu.style.display = 'block';

        // Get unique values for this field from currentData
        const values = [...new Set(currentData.map(r => getRowValue(r, field)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        // Build HTML
        let html = `
            <div class="excel-filter-search">
                <input type="text" class="form-control form-control-sm" placeholder="Buscar..." id="filter-search-box">
            </div>
            <div class="excel-filter-list" id="filter-items-list">
                <div class="excel-filter-item">
                    <input type="checkbox" id="filter-select-all" checked>
                    <label for="filter-select-all">(Todas)</label>
                </div>
                <hr class="my-1">
        `;

        const selectedSet = activeFilters[type][field];

        values.forEach((v, i) => {
            const isChecked = !selectedSet || selectedSet.has(v);
            html += `
                <div class="excel-filter-item" data-value="${v}">
                    <input type="checkbox" class="filter-check-val" id="filter-item-${i}" ${isChecked ? 'checked' : ''} value="${v}">
                    <label for="filter-item-${i}">${v || '(Vacío)'}</label>
                </div>
            `;
        });

        html += `
            </div>
            <div class="excel-filter-footer">
                <button class="btn btn-sm btn-outline-secondary" id="btn-filter-cancel">Cancelar</button>
                <button class="btn btn-sm btn-primary" id="btn-filter-apply">Aceptar</button>
            </div>
        `;

        filterMenu.innerHTML = html;

        // Interaction logic
        const searchBox = document.getElementById('filter-search-box');
        const listItems = filterMenu.querySelectorAll('.excel-filter-item[data-value]');
        const selectAll = document.getElementById('filter-select-all');
        const checkVals = filterMenu.querySelectorAll('.filter-check-val');

        searchBox.oninput = () => {
            const txt = searchBox.value.toLowerCase();
            listItems.forEach(item => {
                const val = item.dataset.value.toLowerCase();
                item.style.display = val.includes(txt) ? 'flex' : 'none';
            });
        };

        selectAll.onchange = () => {
            checkVals.forEach(c => {
                if (c.parentElement.style.display !== 'none') {
                    c.checked = selectAll.checked;
                }
            });
        };

        document.getElementById('btn-filter-cancel').onclick = () => {
            filterMenu.style.display = 'none';
        };

        document.getElementById('btn-filter-apply').onclick = () => {
            const selected = new Set();
            let allChecked = true;
            let totalShowed = 0;
            let checkedShowed = 0;

            checkVals.forEach(c => {
                if (c.checked) selected.add(c.value);
                else {
                    allChecked = false;
                }
            });

            if (allChecked) {
                activeFilters[type][field] = null;
            } else {
                activeFilters[type][field] = selected;
            }

            filterMenu.style.display = 'none';
            renderFilters(); // Update icons active state
            renderData(currentData);
        };
    }


    // --- LOAD FROM DB ---
    async function loadFlights() {
        // Use local date input first, fall back to main
        const dateInput = document.getElementById('vuelos-ops-date') || document.getElementById('operations-summary-date');

        // If no date selected, default to today
        if (dateInput && !dateInput.value) {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            dateInput.value = `${yyyy}-${mm}-${dd}`;
        }

        if (!dateInput || !dateInput.value) return;

        const dateVal = dateInput.value;
        const tbodyArr = document.getElementById('tbody-ops-flights-arrivals');
        const tbodyDep = document.getElementById('tbody-ops-flights-departures');

        console.log(`[parte-ops] Loading flights for ${dateVal}...`);

        if (tbodyArr) tbodyArr.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border text-success spinner-border-sm"></div><div class="small mt-2">Buscando llegadas...</div></td></tr>';
        if (tbodyDep) tbodyDep.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm"></div><div class="small mt-2">Buscando salidas...</div></td></tr>';

        try {
            const supabase = window.supabaseClient;
            if (!supabase) throw new Error('Supabase client missing');

            // Fetch Single Row with JSON data
            const { data, error } = await supabase
                .from('vuelos_parte_operaciones')
                .select('data')
                .eq('date', dateVal)
                .maybeSingle();

            console.log(`[parte-ops] Result for ${dateVal}:`, data);

            let flights = [];
            // Handle different JSON structures returned by Supabase
            // Case 1: data column contains the array directly ([...])
            if (data && Array.isArray(data.data)) {
                flights = data.data;
            }
            // Case 2: data column contains an object wrapping the array ({ data: [...] })? Unlikely with Supabase JSONB but possible if nested.
            // Case 3: data is the top level object? No, select('data') returns { data: ... }

            console.log(`[parte-ops] Parsed ${flights.length} flights`);

            currentData = flights;
            renderFilters();

            if (!error && flights.length === 0) {
                // Fallback: Check for latest available date
                await suggestOtherDate(supabase, dateVal, 'No se encontró información');
                return;
            }
            // else if (flights.length > 0 && flights.length < 5) ... 

            renderData(flights, null, dateVal);

        } catch (err) {
            console.error(err);
            const errorMsg = `<div class="text-danger"><i class="fas fa-exclamation-triangle me-2"></i> Error al cargar datos: ${err.message}</div>`;
            renderData(null, errorMsg);
        }
    }

    async function suggestOtherDate(supabase, currentVal, msgPrefix) {
        const { data: latestData } = await supabase
            .from('vuelos_parte_operaciones')
            .select('date')
            .order('date', { ascending: false })
            .limit(1);

        if (latestData && latestData.length > 0) {
            const lastDate = latestData[0].date;
            if (lastDate !== currentVal) {
                const warningHtml = `<div class="alert alert-warning d-inline-block shadow-sm mb-0">
                        <h6 class="alert-heading"><i class="fas fa-search me-2"></i>${msgPrefix} para el ${currentVal}</h6>
                        <p class="mb-2 small">Es posible que los datos estén en otra fecha.</p>
                        <hr>
                        <p class="mb-0">
                            <span class="me-2">Última fecha con actividad: <strong>${lastDate}</strong></span>
                            <button class="btn btn-sm btn-dark" onclick="document.getElementById('operations-summary-date').value='${lastDate}'; document.getElementById('operations-summary-date').dispatchEvent(new Event('change'));">
                                <i class="fas fa-calendar-alt me-1"></i> Ir a ${lastDate}
                            </button>
                        </p>
                     </div>`;
                renderData(null, warningHtml);
            } else {
                renderData(null);
            }
        } else {
            renderData(null);
        }
    }

    // --- JSON IMPORT ---
    async function importJson(inputElement) {
        if (!inputElement.files || inputElement.files.length === 0) return;

        const file = inputElement.files[0];
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                if (!Array.isArray(json)) throw new Error("El archivo JSON debe ser una lista de vuelos.");
                if (json.length === 0) throw new Error("El archivo JSON está vacío.");

                if (!confirm(`Se encontraron ${json.length} registros. ¿Deseas importarlos a la base de datos?\nNota: Se reemplazarán los datos existentes para las fechas incluidas en el archivo.`)) {
                    inputElement.value = '';
                    return;
                }

                await saveToDatabase(json);
                inputElement.value = '';

                // Trigger reload
                if (window.dataManagement && typeof window.dataManagement.loadDailyFlightsOps === 'function') {
                    window.dataManagement.loadDailyFlightsOps();
                }
                await loadFlights();

            } catch (err) {
                alert("Error al importar JSON: " + err.message);
                console.error(err);
                inputElement.value = '';
            }
        };

        reader.readAsText(file);
    }

    // --- UPLOAD HANDLER ---
    async function handleUpload() {
        const fileInput = document.getElementById('ops-itinerary-pdf-file');
        const progressBar = document.getElementById('ops-itinerary-upload-progress');
        const btnSave = document.getElementById('btn-save-ops-itinerary-json');

        if (!fileInput || !fileInput.files[0]) {
            alert('Selecciona un PDF.');
            return;
        }

        if (progressBar) progressBar.classList.remove('d-none');
        btnSave.disabled = true;

        try {
            const rows = await parsePdf(fileInput.files[0]);
            if (rows.length === 0) throw new Error("No se encontraron datos en el PDF");

            // Save directly using the Wide format
            await saveToDatabase(rows);

            // Auto-switch date picker to the new data date
            const refRow = rows.find(r => r.fecha_hora_prog_llegada || r.fecha_hora_prog_salida);
            if (refRow) {
                const refDateStr = (refRow.fecha_hora_prog_llegada && refRow.fecha_hora_prog_llegada.includes('/'))
                    ? refRow.fecha_hora_prog_llegada
                    : refRow.fecha_hora_prog_salida;

                if (refDateStr) {
                    const parts = refDateStr.split(' ')[0].split('/'); // DD, MM, YYYY
                    if (parts.length === 3) {
                        const yyyy_mm_dd = `${parts[2]}-${parts[1]}-${parts[0]}`;
                        const dateInput = document.getElementById('operations-summary-date');
                        if (dateInput) {
                            dateInput.value = yyyy_mm_dd;
                            // Trigger change event so other listeners (e.g. labels) update
                            dateInput.dispatchEvent(new Event('change'));
                        }
                    }
                }
            }

            // Render what we just saved (re-uses DB render logic since structure matches)
            // But we can just reload from DB to be sure
            await loadFlights();

            // Close Modal
            const modalEl = document.getElementById('uploadOpsItineraryModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            fileInput.value = '';

        } catch (e) {
            alert("Error: " + e.message);
            console.error(e);
        } finally {
            if (progressBar) progressBar.classList.add('d-none');
            btnSave.disabled = false;
        }
    }

    // --- JSON PASTE HANDLER ---
    async function handleJsonPaste() {
        const textarea = document.getElementById('ops-json-textarea');
        if (!textarea || !textarea.value.trim()) {
            alert("Por favor pega el contenido JSON.");
            return;
        }

        try {
            const json = JSON.parse(textarea.value);
            if (!Array.isArray(json)) throw new Error("El JSON debe ser un arreglo de vuelos");
            if (json.length === 0) throw new Error("El JSON está vacío");

            if (!confirm(`Se encontraron ${json.length} registros. ¿Deseas importarlos a la base de datos?\nNota: Se reemplazarán los datos existentes para las fechas incluidas.`)) {
                return;
            }

            // Re-use saveToDatabase
            await saveToDatabase(json);

            // Auto-switch date if needed (similar to upload)
            if (json[0]) {
                // Try to find first date
                const r = json[0];
                const refDateStr = r.fecha || (r.fecha_hora_prog_llegada && r.fecha_hora_prog_llegada.includes('/')) ? r.fecha_hora_prog_llegada : r.fecha_hora_prog_salida;
                // If we have text date DD/MM/YYYY
                if (refDateStr && typeof refDateStr === 'string' && refDateStr.includes('/')) {
                    const parts = refDateStr.split(' ')[0].split('/');
                    if (parts.length === 3) {
                        const yyyy_mm_dd = `${parts[2]}-${parts[1]}-${parts[0]}`;
                        const dateInput = document.getElementById('operations-summary-date');
                        if (dateInput) {
                            dateInput.value = yyyy_mm_dd;
                            dateInput.dispatchEvent(new Event('change'));
                        }
                    }
                }
                // If we have ISO date YYYY-MM-DD
                else if (r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) {
                    const dateInput = document.getElementById('operations-summary-date');
                    if (dateInput) {
                        dateInput.value = r.fecha;
                        dateInput.dispatchEvent(new Event('change'));
                    }
                }
            }

            // Reload Main Table
            if (window.dataManagement && typeof window.dataManagement.loadDailyFlightsOps === 'function') {
                window.dataManagement.loadDailyFlightsOps();
            }
            // Reload current panel just in case
            await loadFlights();

            // Close Modal
            const modalEl = document.getElementById('loadOpsItineraryJsonModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            textarea.value = '';
            alert('Datos importados correctamente.');

        } catch (e) {
            alert("Error al procesar JSON: " + e.message);
            console.error(e);
        }
    }

    // --- PARSER ---
    async function parsePdf(file) {
        if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js no cargado');

        const ab = await file.arrayBuffer();

        // PDF.js Load
        let pdf = null;
        try {
            pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        } catch (e) {
            // Fallback for workers?
            if (pdfjsLib.default && pdfjsLib.default.getDocument) {
                pdf = await pdfjsLib.default.getDocument({ data: ab }).promise;
            } else {
                throw e;
            }
        }

        const extracted = [];
        let rowCounter = 1;

        console.log(`Scanning ${pdf.numPages} pages...`);

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // Group By Y
            const lines = {};
            textContent.items.forEach(item => {
                const y = Math.round(item.transform[5]);
                if (!lines[y]) lines[y] = [];
                lines[y].push(item);
            });

            // Iterate Rows
            const sortedYs = Object.keys(lines).sort((a, b) => b - a);

            for (const y of sortedYs) {
                // Join Text
                const items = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
                const fullStr = items.map(t => t.str).join(' ').trim();

                // Valid Row Check: Starts with number
                if (!/^\d+/.test(fullStr)) continue;

                // Extract Seq No immediately
                const noMatch = fullStr.match(/^(\d+)/);
                const seq = noMatch ? parseInt(noMatch[1]) : rowCounter++;

                // Find Timestamps: DD/MM/YYYY HH:MM
                const dateTimeRegex = /\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}/g;
                const matches = [...fullStr.matchAll(dateTimeRegex)];

                const isPernocta = fullStr.toLowerCase().includes('pernocta');

                // --- SMART ANCHOR STRATEGY ---
                let arrSched = '', arrReal = '', depSched = '', depReal = '';
                let limitLeft = -1;

                if (matches.length >= 2) {
                    // Try to map timestamps
                    // Scenario A: 4 timestamps (Standard Arrival & Departure)
                    // Scenario B: 2 timestamps (Pernocta + Departure)
                    // Scenario C: 3 timestamps (Pernocta + ArrReal + Dep ... ?)

                    if (matches.length >= 4) {
                        arrSched = matches[0][0];
                        arrReal = matches[1][0];
                        depSched = matches[2][0];
                        depReal = matches[3][0];
                        limitLeft = fullStr.indexOf(arrSched);
                    }
                    else if (isPernocta && matches.length >= 2) {
                        // Assuming Pernocta replaces ArrSched
                        // The anchor for Origin is "Pernocta" unless a timestamp appears before it?
                        // Actually, if date timestamp appears, it's safer to use that.
                        // BUT "Pernocta" is text.

                        // Check if "Pernocta" appears *before* the first timestamp?
                        const idxP = fullStr.toLowerCase().indexOf('pernocta');
                        const idxDT = fullStr.indexOf(matches[0][0]);

                        if (idxP < idxDT) {
                            // Pernocta is first (replaces ArrSched)
                            arrSched = "Pernocta";
                            depSched = matches[0][0];
                            depReal = matches[1][0];
                            limitLeft = idxP;
                        } else {
                            // Maybe ArrSched is present -> ArrReal is Pernocta? Unlikely.
                            // Or ArrSched is time, ArrReal is Pernocta?
                            // Let's assume matches[0] is DepSched if we are sure it's Pernocta.
                            arrSched = "Pernocta";
                            depSched = matches[0][0];
                            depReal = matches[1][0];
                            limitLeft = idxP;
                        }
                    } else {
                        // Just map what we have
                        if (matches.length >= 2) {
                            // Maybe incomplete row, but let's try to grab last two as Dep?
                            depSched = matches[matches.length - 2][0];
                            depReal = matches[matches.length - 1][0];

                            // If Pernocta present, use it as anchor
                            const idxP = fullStr.toLowerCase().indexOf('pernocta');
                            if (idxP !== -1) {
                                limitLeft = idxP;
                                arrSched = "Pernocta";
                            } else {
                                // Default anchor to first timestamp?
                                limitLeft = fullStr.indexOf(matches[0][0]);
                                arrSched = matches[0][0]; // Guess
                            }
                        }
                    }
                } else {
                    // Not enough timestamps? Skip
                    continue;
                }

                // If limitLeft is invalid, abort
                if (limitLeft === -1) continue;

                // --- 2. Left Side Extraction ---
                const leftText = fullStr.substring(0, limitLeft).trim().replace(/^(\d+)\s+/, '');

                // Airline | ArrFlight | Origin
                // Flight Code Regex: [A-Z0-9]{2,3} [0-9]+
                const flightRx = /([A-Z0-9]{2,3}\s+\d{3,4})/;
                const flightMatch = leftText.match(flightRx);

                let airline = '', arrFlight = '', origin = '';
                if (flightMatch) {
                    arrFlight = flightMatch[0];
                    const idx = leftText.lastIndexOf(arrFlight);
                    airline = leftText.substring(0, idx).trim();
                    origin = leftText.substring(idx + arrFlight.length).trim();
                }

                // 3. Middle/Right Side (ArrReal ... DepSched ... End)
                // We need Pax Arr, Dep Flight, Dest, Pax Dep, Matricula

                // Search zones based on known timestamps

                // Zone A: Between ArrReal/ArrSched and DepSched
                // Start after the ArrReal (or Pernocta/ArrSched boundary)
                // If Pernocta: (Pernocta + 8) or if space is weird, use text index
                let startMid = -1;
                if (arrReal) {
                    startMid = fullStr.indexOf(arrReal) + arrReal.length;
                    // If arrReal is matched but text repeats? indexOf finds first. 
                    // To be safe, look after limitLeft + arrSched.
                    const idxArrSched = fullStr.indexOf(arrSched);
                    startMid = fullStr.indexOf(arrReal, idxArrSched + arrSched.length) + arrReal.length;
                } else if (arrSched === 'Pernocta') {
                    startMid = fullStr.indexOf('Pernocta') + 8; // "Pernocta".length = 8
                } else {
                    startMid = limitLeft + arrSched.length;
                }

                const endMid = fullStr.indexOf(depSched);
                const midText = fullStr.substring(startMid, endMid).trim();

                // Expect: [Pax Arr]? [Dep Flight] [Dest]
                // Pax Arr is number at start
                const midTokens = midText.split(/\s+/);
                let arrPax = 0;
                if (/^\d+$/.test(midTokens[0])) {
                    arrPax = parseInt(midTokens.shift());
                }

                const midRem = midTokens.join(' ');
                // Dep Flight
                const depFlightMatch = midRem.match(flightRx);
                let depFlight = '', dest = '';
                if (depFlightMatch) {
                    depFlight = depFlightMatch[0];
                    dest = midRem.replace(depFlight, '').trim();
                } else {
                    dest = midRem;
                }

                // Zone B: After DepReal
                const startRight = fullStr.indexOf(depReal) + depReal.length;
                const rightText = fullStr.substring(startRight).trim();

                // Expect: [Pax Dep]? [Matricula] [Optional Garbage]
                const rightTokens = rightText.split(/\s+/);
                let depPax = 0, matricula = '';

                if (/^\d+$/.test(rightTokens[0])) {
                    depPax = parseInt(rightTokens[0]);
                    matricula = rightTokens[1] || '';
                } else {
                    matricula = rightTokens[0] || '';
                }

                // Cleanup Matricula: should be alphanumeric only, usually XA-... or N...
                // If it contains "demora", "observaciones", etc, ignore those
                // Just take the first token and strip non-alphanumeric chars if needed?
                // Actually some Matriculas are just "XA-VVD".
                // If the token is "00:53" (timestamp-like), that's not matricula.
                if (matricula.includes(':') || matricula.length > 10) {
                    // Suspicious. Maybe Matricula is missing and we grabbed "Demora"?
                    // Or Matricula is actually the previous token?
                    // In the screenshot: "... 0 5X 321 Louisville ... 0 00:53 de su demora."
                    // 5X 321 is Dep Flight. Dest is Louisville. Dep Time... Dep Real...
                    // Pax Dep 0.
                    // Matricula is missing?? Or maybe "5X 320" (Arr Flight) is the same aircraft?
                    // Usually yes.
                    // If matricula looks wrong, leave empty or try to clean.
                    // Let's assume alphanumeric + hyphen only for matricula.
                    if (!/^[A-Z0-9-]+$/.test(matricula)) {
                        // Clean it?
                        // If it starts with -, it's trash.
                        // If it's a time, it's trash.
                        if (matricula.match(/^\d{1,2}:\d{2}/)) matricula = '';
                        if (matricula.startsWith('-')) matricula = '';
                    }
                }

                extracted.push({
                    seq_no: seq,
                    aerolinea: airline,
                    vuelo_llegada: arrFlight,
                    origen: origin,
                    fecha_hora_prog_llegada: arrSched,
                    fecha_hora_real_llegada: arrReal,
                    pasajeros_llegada: arrPax,
                    vuelo_salida: depFlight,
                    destino: dest,
                    fecha_hora_prog_salida: depSched,
                    fecha_hora_real_salida: depReal,
                    pasajeros_salida: depPax,
                    matricula: matricula
                });
            }
        }

        console.log("Parsed Rows:", extracted);
        return extracted;
    }

    // --- DB SAVE ---
    async function saveToDatabase(rows) {
        const supabase = window.supabaseClient;
        console.log("Procesando " + rows.length + " filas para guardar...");

        // Prepare rows for DB: Group by 'date'
        const grouped = {};
        let skippedCount = 0;

        rows.forEach((r, index) => {
            // --- ROBUST FIELD NORMALIZATION (AUTO-DETECT KEYS) ---
            const normalizeKey = (k) => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

            for (const k of Object.keys(r)) {
                if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
                // Skip if key is already one of our target snake_case keys to avoid overwriting or redundancy if well-formed
                if (['fecha_hora_prog_llegada', 'fecha_hora_real_llegada', 'fecha_hora_prog_salida', 'fecha_hora_real_salida',
                    'vuelo_llegada', 'vuelo_salida', 'pasajeros_llegada', 'pasajeros_salida', 'matricula', 'origen', 'destino',
                    'aerolinea', 'categoria', 'seq_no'].includes(k)) continue;

                const val = r[k];
                const nk = normalizeKey(k);

                // --- FLIGHT INFO ---
                if (nk.includes('vuelo') && nk.includes('llegada')) r.vuelo_llegada = val;
                else if (nk.includes('vuelo') && nk.includes('salida')) r.vuelo_salida = val;

                // --- PAX ---
                else if (nk.includes('pasajero') && nk.includes('llegada')) r.pasajeros_llegada = val;
                else if (nk.includes('pasajero') && nk.includes('salida')) r.pasajeros_salida = val;

                // --- TIMES ARRIVAL ---
                else if (nk.includes('llegada')) {
                    if (nk.includes('programada') || nk.includes('prog')) r.fecha_hora_prog_llegada = val;
                    else if (nk.includes('real') || nk.includes('salida') || nk === 'horallegada') r.fecha_hora_real_llegada = val;
                }

                // --- TIMES DEPARTURE ---
                else if (nk.includes('salida')) {
                    if (nk.includes('llegada')) continue;
                    if (nk.includes('programada') || nk.includes('prog')) r.fecha_hora_prog_salida = val;
                    else if (nk.includes('real') || nk === 'horasalida' || nk.includes('salida')) r.fecha_hora_real_salida = val;
                }

                // --- GENERIC ---
                else if (nk === 'matricula') r.matricula = val;
                else if (nk === 'origen') r.origen = val;
                else if (nk === 'destino') r.destino = val;
                else if (nk === 'aerolinea') r.aerolinea = val;
                else if (nk === 'categoria') r.categoria = val;
                else if (nk === 'no' || nk === 'num' || nk === 'seq') r.seq_no = val;
            }

            // Normalize Data for Table Display
            if (!r.fecha_hora_real_llegada && r.fecha_llegada && r.hora_llegada) {
                r.fecha_hora_real_llegada = `${r.fecha_llegada} ${r.hora_llegada}`;
            }
            if (!r.fecha_hora_real_salida && r.fecha_salida && r.hora_salida) {
                r.fecha_hora_real_salida = `${r.fecha_salida} ${r.hora_salida}`;
            }
            // Map 'no' to 'seq_no' if missing
            if (r.seq_no === undefined && r.no !== undefined) {
                r.seq_no = r.no;
            }

            // Use real as prog if prog is missing
            if (!r.fecha_hora_prog_llegada) r.fecha_hora_prog_llegada = r.fecha_hora_real_llegada;
            if (!r.fecha_hora_prog_salida) r.fecha_hora_prog_salida = r.fecha_hora_real_salida;


            // Determine grouping date
            let dateVal = r.date || r.fecha || null;

            // Simple normalize for DD/MM/YYYY to YYYY-MM-DD
            if (dateVal && typeof dateVal === 'string' && dateVal.includes('/')) {
                const parts = dateVal.trim().split(' ')[0].split('/');
                if (parts.length === 3) {
                    // Start from end (Year) if standard DD/MM/YYYY or MM/DD/YYYY? 
                    // Usually DD/MM/YYYY in Mexico (User locale implied by Spanish keys)
                    dateVal = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
            }

            // Try explicit new fields with robust cleaning
            if (!dateVal) {
                const tryParse = (str) => {
                    if (!str || typeof str !== 'string') return null;
                    if (str.toLowerCase().includes('pernocta')) return null; // Skip pernocta text

                    const clean = str.trim().split(' ')[0]; // Drop time if present (e.g. "08/01/2026 10:30")
                    if (clean.includes('/')) {
                        const parts = clean.split('/');
                        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD/MM/YYYY -> YYYY-MM-DD
                    }
                    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean; // Already ISO
                    return null;
                };

                // Prioritize keys from the JSON
                dateVal = tryParse(r.fecha_hora_prog_llegada) ||
                    tryParse(r.fecha_hora_real_llegada) ||
                    tryParse(r.fecha_hora_prog_salida) ||
                    tryParse(r.fecha_hora_real_salida) ||
                    tryParse(r.fecha_llegada) ||
                    tryParse(r.fecha_salida);
            }

            // Fallback to old heuristic
            if (!dateVal) {
                const progLlegada = r.fecha_hora_prog_llegada || '';
                const refDateStr = (progLlegada.includes('/')) ? progLlegada : (r.fecha_hora_prog_salida || '');
                if (refDateStr && typeof refDateStr === 'string') {
                    const clean = refDateStr.trim().split(' ')[0];
                    const parts = clean.split('/');
                    if (parts.length === 3) dateVal = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
            }

            if (!dateVal) {
                skippedCount++;
                if (skippedCount <= 3) console.warn('Fila sin fecha (skip):', r);
                return;
            }

            if (!grouped[dateVal]) grouped[dateVal] = [];
            grouped[dateVal].push(r);
        });

        const datesToUpdate = Object.keys(grouped);
        console.log("Fechas encontradas:", datesToUpdate);

        if (datesToUpdate.length === 0) {
            // Debugging Alert
            const firstRow = rows[0] ? JSON.stringify(rows[0], null, 2) : "N/A";
            alert(`No se pudieron determinar fechas válidas.\nFilas totales: ${rows.length}\nFilas omitidas: ${skippedCount}\n\nEjemplo primera fila recibida:\n${firstRow}`);
            return;
        }

        // For each date, we perform a REPLACE operation (Delete then Insert)
        // This avoids issues with Primary Keys or ON CONFLICT requirements

        for (const d of datesToUpdate) {
            const flightArray = grouped[d];
            console.log(`Guardando fecha ${d}: Eliminando anterior e insertando ${flightArray.length} filas nuevas...`);

            // 1. Delete existing record for this date (if any)
            const { error: delError } = await supabase
                .from('vuelos_parte_operaciones')
                .delete()
                .eq('date', d);

            if (delError) {
                console.error(`Error deleting for ${d}:`, delError);
                // We continue even if delete fails (maybe it didn't exist, or specific RLS issue) 
                // but typically we want to warn. If delete fails significantly, insert might duplicate if there's no PK.
                // But user removed PK. So we MUST delete to avoid duplicates.
                if (delError.code !== 'PGRST116') { // PGRST116 is result mismatch, usually fine for delete? No, delete doesn't return data by default.
                    alert(`Advertencia al limpiar fecha ${d}: ${delError.message}`);
                }
            }

            // 2. Insert new record
            const { error: insError } = await supabase
                .from('vuelos_parte_operaciones')
                .insert({
                    date: d,
                    data: flightArray
                });

            if (insError) {
                console.error(`Error inserting for ${d}:`, insError);
                alert(`Error al guardar fecha ${d}:\n${insError.message}\n\nDetalle: ${insError.details || ''}`);
                return; // Stop on error
            }

            // Audit
            if (typeof window.logHistory === 'function') {
                window.logHistory('IMPORTAR', 'Parte Operativo', d, {
                    summary: `Importación masiva o reemplazo de día completo`,
                    count: flightArray.length,
                    activeTypes: [...new Set(flightArray.map(f => f.categoria || 'N/A'))].join(', ')
                });
            }
        }

        alert(`Información guardada correctamente para ${datesToUpdate.length} fecha(s): ${datesToUpdate.join(', ')}`);

        // Try to update view to the first date found
        if (datesToUpdate.length > 0) {
            const firstDate = datesToUpdate[0];
            const dateInput = document.getElementById('operations-summary-date');
            if (dateInput) {
                dateInput.value = firstDate;
                dateInput.dispatchEvent(new Event('change'));
            }
        }
    }

    // --- HELPER: LOGO MAPPING ---
    function getAirlineHtml(airlineName) {
        if (!airlineName) return '';
        const lower = airlineName.toLowerCase().trim();

        const logoMap = {
            'aeromexico': 'logo_aeromexico.png',
            'aeroméxico': 'logo_aeromexico.png',
            'volaris': 'logo_volaris.png',
            'viva': 'logo_viva.png',
            'viva aerobus': 'logo_viva.png',
            'mexicana': 'logo_mexicana.png',
            'mexicana de aviación': 'logo_mexicana.png',
            'copa': 'logo_copa.png',
            'copa airlines': 'logo_copa.png',
            'arajet': 'logo_arajet.png',
            'conviasa': 'logo_conviasa.png',
            'magnicharters': 'logo_magnicharters.png',
            'aerus': 'logo_aerus.png',
            'estafeta': 'logo_estafeta.jpg',
            'ups': 'logo_united_parcel_service.png',
            'united parcel service': 'logo_united_parcel_service.png',
            'fedex': 'logo_fedex_express.png',
            'dhl': 'logo_dhl_guatemala_.png',
            'mas': 'logo_mas.png',
            'mas air': 'logo_mas.png',
            'air canada': 'logo_air_canada_.png',
            'air france': 'logo_air_france_.png',
            'air china': 'logo_air_china.png',
            'china southern': 'logo_china_southern.png',
            'qatar': 'logo_qatar.png',
            'qatar airways': 'logo_qatar.png',
            'turkish': 'logo_turkish_airlines.png',
            'turkish airlines': 'logo_turkish_airlines.png',
            'lufthansa': 'logo_lufthansa.png',
            'emirates': 'logo_emirates_airlines.png',
            'cargojet': 'logo_cargojet.png',
            'atlas air': 'logo_atlas_air.png',
            'atlas': 'logo_atlas_air.png',
            'kalitta': 'logo_kalitta_air.jpg',
            'national': 'logo_national_airlines_cargo.png',
            'tsm': 'logo_tsm_airlines.png',
            'aerounion': 'logo_aero_union.png',
            'aerounión': 'logo_aero_union.png',
            'aero union': 'logo_aero_union.png',
            'aero unión': 'logo_aero_union.png',
            'cargolux': 'logo_cargolux.png',
            'cathay': 'logo_cathay_pacific.png',
            'cathay pacific': 'logo_cathay_pacific.png',
            'suparna': 'logo_suparna.png',
            'suparna airlines': 'logo_suparna.png',
            'awesome': 'logo_awesome_cargo.png',
            'awesome cargo': 'logo_awesome_cargo.png'
        };

        // Find match
        let logoFile = null;
        for (const [key, val] of Object.entries(logoMap)) {
            if (lower.includes(key) || lower === key) {
                logoFile = val;
            }
        }

        // Direct exact lookup first (safer)
        if (logoMap[lower]) logoFile = logoMap[lower];

        // Fallback: iterate and check includes if not found directly
        if (!logoFile) {
            for (const [key, val] of Object.entries(logoMap)) {
                if (lower.includes(key)) {
                    logoFile = val;
                    break;
                }
            }
        }

        if (logoFile) {
            // Logic to visually equalize logo sizes
            // Standard size
            let style = "max-height: 25px; max-width: 70px;";

            // Reduce size for notably bulky/square logos
            if (logoFile === 'logo_viva.png') {
                style = "max-height: 20px; max-width: 60px;";
            }

            // Boost size for logos that naturally look small (horizontal/text-heavy)
            const boostLogos = [
                'logo_aeromexico.png', 'logo_volaris.png', 'logo_mexicana.png',
                'logo_air_china.png', 'logo_tsm_airlines.png', 'logo_kalitta_air.jpg'
            ];

            // Mega size for specific cargo/wide logos requested to be bigger
            const megaLogos = [
                'logo_estafeta.jpg', 'logo_cargojet.png',
                'logo_cargolux.png',
                'logo_suparna.png', 'logo_awesome_cargo.png'
            ];

            // Gigantic size for specifically requested bigger logos
            const giganticLogos = [
                'logo_cathay_pacific.png'
            ];

            if (boostLogos.includes(logoFile)) {
                style = "max-height: 28px; max-width: 80px;";
            } else if (megaLogos.includes(logoFile)) {
                style = "max-height: 30px; max-width: 85px;";
            } else if (giganticLogos.includes(logoFile)) {
                style = "max-height: 32px; max-width: 90px;";
            } else if (logoFile === 'logo_atlas_air.png') {
                style = "max-height: 35px; max-width: 95px;";
            }

            return `<img src="images/airlines/${logoFile}" alt="${airlineName}" title="${airlineName}" class="img-fluid" style="${style}">`;
        }

        return `<span class="fw-bold">${airlineName}</span>`;
    }

    // --- RENDER TABLE ---
    function renderData(data, warningHtml = null, dateRef = null) {
        const tbodyArr = document.getElementById('tbody-ops-flights-arrivals');
        const tbodyDep = document.getElementById('tbody-ops-flights-departures');

        // Ensure dateRef matches current if possible
        if (!dateRef) {
            const dateInput = document.getElementById('vuelos-ops-date');
            if (dateInput) dateRef = dateInput.value;
        }

        const userRole = sessionStorage.getItem('user_role');
        // Force conciliation to be visible for everyone as requested
        const canConciliate = true; // ['admin', 'conciliacion', 'superadmin'].includes(userRole);

        document.querySelectorAll('.col-conciliacion').forEach(el => {
            el.classList.remove('d-none');
        });

        if (tbodyArr) tbodyArr.innerHTML = '';
        if (tbodyDep) tbodyDep.innerHTML = '';

        if (warningHtml) {
            if (tbodyArr) tbodyArr.innerHTML = `<tr><td colspan="8" class="text-center p-3">${warningHtml}</td></tr>`;
            if (tbodyDep && !tbodyArr) tbodyDep.innerHTML = `<tr><td colspan="8" class="text-center p-3">${warningHtml}</td></tr>`;
            return;
        }

        if (!data || data.length === 0) {
            const emptyMsg = '<tr><td colspan="8" class="text-center text-muted py-4">No hay registros (o filtro sin coincidencias)</td></tr>';
            if (tbodyArr) tbodyArr.innerHTML = emptyMsg;
            if (tbodyDep) tbodyDep.innerHTML = emptyMsg;
            updateChart([]);
            return;
        }

        // Helper: Conciliation Cell
        const getConciliacionCell = (type, status, user, time, flightCode, seq) => {
            if (!canConciliate) return '';

            let iconClass = status ? 'fas fa-check-circle text-success fa-lg hover-scale' : 'fas fa-times-circle text-danger opacity-75 fa-lg hover-scale';

            const escapeStr = (str) => (!str ? '' : str.replace(/'/g, "\\'").replace(/"/g, '&quot;'));
            const sUser = escapeStr(user);
            const sCode = escapeStr(flightCode);

            return `
                <td class="text-center align-middle" style="width: 40px; cursor: pointer;" 
                    onclick="window.openConciliacionHistory('${dateRef}', ${seq}, '${type}', ${status}, '${sUser}', '${time}', '${sCode}')">
                    <i class="${iconClass}"></i>
                </td>
             `;
        };

        const matchesFilter = (row, type) => {
            const filters = activeFilters[type];
            const tFilters = textFilters[type];

            // Excel-like Filter (Sets)
            for (const [key, selectedSet] of Object.entries(filters)) {
                if (!selectedSet) continue; // All selected
                const val = getRowValue(row, key);
                if (!selectedSet.has(val)) return false;
            }

            // Text Filter (Inputs)
            for (const [key, searchTxt] of Object.entries(tFilters)) {
                if (!searchTxt) continue;
                const val = getRowValue(row, key).toLowerCase();
                if (!val.includes(searchTxt.toLowerCase())) return false;
            }

            return true;
        };

        const getInput = (val, field, seq, type = 'text', width = '100%', rowType = '') => {
            // Always return raw value if not in edit mode
            if (!isEditMode) return val;

            // Ensure value is safe string
            let safeVal = (val !== undefined && val !== null) ? String(val) : '';
            safeVal = safeVal.replace(/"/g, '&quot;'); // Simple escape for quotes

            return `<input type="${type}" class="form-control form-control-sm p-1 ops-input-edit" 
                style="min-width: ${width}; font-size: 0.8rem; height: 30px;"
                data-seq="${seq}" data-field="${field}" data-row-type="${rowType}" value="${safeVal}">`;
        };

        let rowsArr = '';
        let rowsDep = '';

        data.forEach(r => {
            const seq = r.seq_no || r.no || '';
            const airlineName = r.aerolinea || r.Aerolinea || '';
            const airlineHtml = getAirlineHtml(airlineName);

            // --- ARRIVALS ---
            if (matchesFilter(r, 'arrival') && (r.vuelo_llegada || r.origen || r.fecha_hora_prog_llegada)) {
                const arrFlight = r.vuelo_llegada || '';
                const origin = r.origen || '';
                const progArr = r.fecha_hora_prog_llegada || '';
                const realArr = r.fecha_hora_real_llegada || '';
                const paxArr = r.pasajeros_llegada || 0;

                let displayFlight = getInput(arrFlight, 'vuelo_llegada', seq, 'text', '60px', 'arrival');
                let displayOrigin = getInput(origin, 'origen', seq, 'text', '80px', 'arrival');
                let displayProg = getInput(progArr, 'fecha_hora_prog_llegada', seq, 'text', '80px', 'arrival');
                let displayReal = getInput(realArr, 'fecha_hora_real_llegada', seq, 'text', '80px', 'arrival');
                let displayPax = getInput(paxArr, 'pasajeros_llegada', seq, 'number', '50px', 'arrival');

                if (!isEditMode) {
                    displayFlight = `<span class="text-success fw-bold text-nowrap">${arrFlight}</span>`;
                    displayOrigin = `<span class="text-truncate" style="display:block; max-width: 85px;" title="${origin}">${origin}</span>`;
                    displayProg = `<span class="small opacity-75 lh-1">${progArr.replace(' ', '<br>')}</span>`;
                    displayReal = `<span class="fw-bold lh-1">${realArr.replace(' ', '<br>')}</span>`;
                    displayPax = `<span class="fw-bold small lh-1">${paxArr}</span>`;
                }

                const concArr = r.conciliado_llegada === true;
                const concCell = getConciliacionCell('arrival', concArr, r.conciliado_llegada_by, r.conciliado_llegada_at, arrFlight, seq);

                rowsArr += `
                    <tr style="height: 48px;">
                        <td class="fw-bold text-secondary">${seq}</td>
                        <td class="text-center text-truncate" style="max-width: 75px;" title="${airlineName}">${airlineHtml}</td>
                        <td>${displayFlight}</td>
                        <td>${displayOrigin}</td>
                        <td>${displayProg}</td>
                        <td>${displayReal}</td>
                        <td>${displayPax}</td>
                        ${concCell}
                    </tr>
                 `;
            }

            // --- DEPARTURES ---
            if (matchesFilter(r, 'departure') && (r.vuelo_salida || r.destino || r.fecha_hora_prog_salida)) {
                const depFlight = r.vuelo_salida || '';
                const dest = r.destino || '';
                const progDep = r.fecha_hora_prog_salida || '';
                const realDep = r.fecha_hora_real_salida || '';
                const paxDep = r.pasajeros_salida || 0;
                const mat = r.matricula || '';

                let displayFlight = getInput(depFlight, 'vuelo_salida', seq, 'text', '60px', 'departure');
                let displayDest = getInput(dest, 'destino', seq, 'text', '80px', 'departure');
                let displayProg = getInput(progDep, 'fecha_hora_prog_salida', seq, 'text', '80px', 'departure');
                let displayReal = getInput(realDep, 'fecha_hora_real_salida', seq, 'text', '80px', 'departure');
                let displayPax = getInput(paxDep, 'pasajeros_salida', seq, 'number', '50px', 'departure');
                let displayMat = getInput(mat, 'matricula', seq, 'text', '60px', 'departure');

                if (!isEditMode) {
                    displayFlight = `<span class="text-primary fw-bold text-nowrap">${depFlight}</span>`;
                    displayDest = `<span class="text-truncate" style="display:block; max-width: 85px;" title="${dest}">${dest}</span>`;
                    displayProg = `<span class="small opacity-75 lh-1">${progDep.replace(' ', '<br>')}</span>`;
                    displayReal = `<span class="fw-bold lh-1">${realDep.replace(' ', '<br>')}</span>`;
                    displayPax = `<span class="fw-bold small lh-1">${paxDep}</span>`;
                    displayMat = `<span class="font-monospace small text-nowrap text-truncate" style="display:block; max-width: 75px;">${mat}</span>`;
                }

                const concDep = r.conciliado_salida === true;
                const concCell = getConciliacionCell('departure', concDep, r.conciliado_salida_by, r.conciliado_salida_at, depFlight, seq);

                rowsDep += `
                    <tr style="height: 48px;">
                        <td class="text-center text-truncate" style="max-width: 75px;" title="${airlineName}">${airlineHtml}</td>
                        <td>${displayFlight}</td>
                        <td>${displayDest}</td>
                        <td>${displayProg}</td>
                        <td>${displayReal}</td>
                        <td>${displayPax}</td>
                        <td>${displayMat}</td>
                        ${concCell}
                    </tr>
                 `;
            }
        });

        if (tbodyArr) {
            tbodyArr.innerHTML = rowsArr || '<tr><td colspan="8" class="text-center text-muted py-4">No se encontraron resultados</td></tr>';
        }

        if (tbodyDep) {
            tbodyDep.innerHTML = rowsDep || '<tr><td colspan="8" class="text-center text-muted py-4">No se encontraron resultados</td></tr>';
        }

        updateChart(data);
    }


    function updateChart(data) {
        // Chart removed as per request
        return;
    }

})();
