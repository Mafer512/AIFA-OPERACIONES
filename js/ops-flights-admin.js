/* ========================================================================
   Ops Flights Admin — administracion de vuelos del Parte de Operaciones (CSV).
   Extraido de index.html (inline, ~450 lineas) en v=20260616m.
   Expone window.opsFlightsAdmin con metodos invocados desde onclick inline.
   ======================================================================== */
window.opsFlightsAdmin = (function () {
    'use strict';

    var adminData = [];
    var adminFilters = {};

    // Un vuelo importado vive con el MISMO id en 3 tablas:
    //   vuelos_parte_operaciones_csv   (bitácora cruda de la importación)
    //   itinerario_vuelos_editable     (esta pestaña de administración)
    //   manifiestos_vuelos_editable    (lado "vuelos" del cruce en Conciliación)
    // Borrar solo de itinerario_vuelos_editable dejaba las otras dos
    // huérfanas: la cruda seguía teniendo la fila (así que reimportar el
    // mismo CSV la detectaba como "ya existe" por movement_key y no la
    // volvía a insertar), y manifiestos_vuelos_editable seguía mostrando el
    // vuelo fantasma del lado de Conciliación. Ahora cada eliminación borra
    // de las 3 a la vez.
    var FLIGHT_TABLES = ['vuelos_parte_operaciones_csv', 'itinerario_vuelos_editable', 'manifiestos_vuelos_editable'];

    async function deleteFromAllFlightTables(ids) {
        var sb = window.supabaseClient;
        if (!sb) throw new Error('Supabase no disponible');
        var results = await Promise.all(
            FLIGHT_TABLES.map(function (table) { return sb.from(table).delete().in('id', ids); })
        );
        var firstError = null;
        results.forEach(function (r, i) {
            if (r.error) {
                console.warn('[Conciliación Admin] error al eliminar de ' + FLIGHT_TABLES[i] + ':', r.error);
                if (!firstError) firstError = r.error;
            }
        });
        // itinerario_vuelos_editable es la tabla que este panel muestra: si
        // falla justo ahí, se lo reporta al usuario. Las otras dos son
        // best-effort (ya se advirtió en consola) para no bloquear el
        // borrado principal por un problema en una tabla secundaria.
        var mainIndex = FLIGHT_TABLES.indexOf('itinerario_vuelos_editable');
        if (results[mainIndex].error) throw results[mainIndex].error;
        return firstError;
    }

    function getEl(id) { return document.getElementById(id); }

    function updateBadge() {
        var badge = getEl('admin-flight-count-badge');
        if (!badge) return;
        badge.textContent = adminData.length + ' vuelo' + (adminData.length !== 1 ? 's' : '');
        badge.style.display = adminData.length > 0 ? '' : 'none';
    }

    function showStatus(msg, type) {
        var el = getEl('admin-status-msg');
        if (!el) return;
        el.className = 'alert alert-' + (type || 'info') + ' py-2 px-3 small mb-2';
        el.textContent = msg;
        el.classList.remove('d-none');
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(function () { el.classList.add('d-none'); }, 5000);
    }

    function updateDeleteBtn() {
        var checkboxes = document.querySelectorAll('.admin-row-chk:checked');
        var btn = getEl('btn-delete-admin-selected');
        var countEl = getEl('admin-selected-count');
        var count = checkboxes.length;
        if (!btn || !countEl) return;
        countEl.textContent = count;
        btn.classList.toggle('d-none', count === 0);
    }

    function toggleSelectAll(checked) {
        document.querySelectorAll('.admin-row-chk').forEach(function (chk) { chk.checked = checked; });
        updateDeleteBtn();
    }

    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderTable() {
        var tbody = getEl('tbody-admin-flights-csv');
        if (!tbody) return;

        var selAll = getEl('admin-select-all');
        if (selAll) selAll.checked = false;

        if (adminData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="25" class="text-muted py-4">No se encontraron vuelos para el rango seleccionado.</td></tr>';
            updateDeleteBtn();
            return;
        }

        var rows = adminData.map(function (row) {
            var id = row.id;
            var v = function (field) { return escHtml(row[field]); };
            return (
                '<tr data-admin-id="' + id + '">' +
                '<td style="background:#fff5f5"><input type="checkbox" class="form-check-input admin-row-chk" data-id="' + id + '" onchange="window.opsFlightsAdmin.updateDeleteBtn()"></td>' +
                '<td>' + v('Status') + '</td>' +
                '<td>' + v('[Arr] Airline code') + '</td>' +
                '<td>' + v('[Arr] Flight Designator') + '</td>' +
                '<td>' + v('[Arr] ALDT') + '</td>' +
                '<td>' + v('[Arr] SIBT') + '</td>' +
                '<td>' + v('[Arr] AIBT') + '</td>' +
                '<td>' + v('[Arr] Stand') + '</td>' +
                '<td>' + v('[Arr] Gates') + '</td>' +
                '<td>' + v('[Arr] Boarded') + '</td>' +
                '<td>' + v('[Arr] Service Type') + '</td>' +
                '<td>' + v('Routing') + '</td>' +
                '<td>' + v('[Dep] Service Type') + '</td>' +
                '<td>' + v('Aircraft type') + '</td>' +
                '<td>' + v('Registration') + '</td>' +
                '<td>' + v('[Dep] Airline code') + '</td>' +
                '<td>' + v('[Dep] Flight Designator') + '</td>' +
                '<td>' + v('[Dep] Stand') + '</td>' +
                '<td>' + v('[Dep] Gates') + '</td>' +
                '<td>' + v('[Dep] Boarded') + '</td>' +
                '<td>' + v('[Dep] SOBT') + '</td>' +
                '<td>' + v('[Dep] AOBT') + '</td>' +
                '<td>' + v('[Dep] ATOT') + '</td>' +
                '<td>' + v('[Dep] ATTT') + '</td>' +
                '<td style="background:#fff0f0;border-left:2px solid #f5c6c6">' +
                '<button class="btn btn-danger btn-sm py-0 px-2" onclick="window.opsFlightsAdmin.deleteById(' + id + ')" aria-label="Eliminar vuelo" title="Eliminar vuelo"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>' +
                '</td>' +
                '</tr>'
            );
        });
        tbody.innerHTML = rows.join('');

        document.querySelectorAll('#table-admin-flights-csv thead input[data-admin-field]').forEach(function (inp) {
            inp.oninput = function () {
                adminFilters[this.getAttribute('data-admin-field')] = this.value.trim().toLowerCase();
                applyAdminFilters();
            };
        });

        updateDeleteBtn();
        updateBadge();
        buildDaySummary();
    }

    function applyAdminFilters() {
        var dateEl = getEl('admin-delete-date');
        var dayPrefix = dateEl && dateEl.value ? isoToAirportDay(dateEl.value) : '';
        var rows = document.querySelectorAll('#tbody-admin-flights-csv tr[data-admin-id]');
        var visibleCount = 0;
        rows.forEach(function (tr) {
            var id = parseInt(tr.getAttribute('data-admin-id'), 10);
            var row = adminData.find(function (r) { return r.id === id; });
            if (!row) { tr.style.display = ''; return; }
            var pass = Object.keys(adminFilters).every(function (field) {
                var q = adminFilters[field];
                if (!q) return true;
                var val = row[field];
                return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
            });
            if (pass && dayPrefix) {
                pass = rowMatchesDay(row, dayPrefix);
            }
            tr.style.display = pass ? '' : 'none';
            if (pass) visibleCount++;
        });
        var badge = getEl('admin-flight-count-badge');
        if (badge) {
            badge.textContent = visibleCount + ' vuelo' + (visibleCount !== 1 ? 's' : '') + (dayPrefix ? ' (' + dayPrefix + ')' : '');
            badge.style.display = visibleCount > 0 ? '' : 'none';
        }
    }

    function filterByDeleteDate() {
        applyAdminFilters();
        buildDaySummary();
    }

    function dayPrefixToISO(prefix) {
        var MONTH_IDX = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
        var m = String(prefix).toUpperCase().match(/^(\d{2})([A-Z]{3})$/);
        if (!m) return '';
        var day = parseInt(m[1], 10);
        var month = MONTH_IDX[m[2]];
        if (!month) return '';
        var year = new Date().getFullYear();
        var candidate = new Date(year, month - 1, day);
        if ((candidate - new Date()) > 60 * 86400000) year--;
        return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }

    function collectDayPrefixes() {
        var FIELDS = ['[Arr] ALDT','[Arr] SIBT','[Arr] AIBT','[Dep] SOBT','[Dep] AOBT','[Dep] ATOT'];
        var set = new Set();
        adminData.forEach(function (row) {
            FIELDS.forEach(function (f) {
                var v = String(row[f] || '').trim().toUpperCase();
                var match = v.match(/^(\d{2}[A-Z]{3})/);
                if (match) set.add(match[1]);
            });
        });
        return Array.from(set).sort(function (a, b) {
            return (dayPrefixToISO(a) || a).localeCompare(dayPrefixToISO(b) || b);
        });
    }

    function buildDaySummary() {
        var grid = getEl('admin-days-grid');
        if (!grid) return;
        if (adminData.length === 0) {
            grid.innerHTML = '<p class="text-muted small mb-0">No hay datos cargados.</p>';
            return;
        }
        var days = collectDayPrefixes();
        var activeDateEl = getEl('admin-delete-date');
        var activeISO = activeDateEl ? activeDateEl.value : '';
        var html = '<div class="d-flex flex-wrap gap-2 align-items-start">';
        html += '<button class="btn btn-sm ' + (activeISO ? 'btn-outline-secondary' : 'btn-primary') + ' py-1" '
              + 'onclick="window.opsFlightsAdmin.clearDayFilter()" '
              + 'style="min-width:80px;text-align:center;border-radius:10px">'
              + '<div style="font-size:.68rem;opacity:.7;letter-spacing:.05em">TODOS</div>'
              + '<div style="font-size:1.15rem;font-weight:800;line-height:1.1">' + adminData.length + '</div>'
              + '<div style="font-size:.7rem">vuelos</div>'
              + '</button>';
        days.forEach(function (prefix) {
            var iso  = dayPrefixToISO(prefix);
            var isActive = iso && iso === activeISO;
            var day  = prefix.slice(0, 2);
            var mon  = prefix.slice(2);
            var count = adminData.filter(function (r) { return rowMatchesDay(r, prefix); }).length;
            html += '<button class="btn btn-sm ' + (isActive ? 'btn-primary shadow' : 'btn-outline-primary') + ' py-1" '
                  + 'onclick="window.opsFlightsAdmin.filterToDay(\'' + prefix + '\')" '
                  + 'style="min-width:90px;text-align:center;border-radius:10px" '
                  + 'title="' + count + ' vuelos el ' + prefix + '">'
                  + '<div style="font-size:.68rem;text-transform:uppercase;opacity:.7;letter-spacing:.05em">' + mon + '</div>'
                  + '<div style="font-size:1.4rem;font-weight:800;line-height:1.1">' + day + '</div>'
                  + '<div style="font-size:.75rem;font-weight:600">' + count + ' <i class=\'fas fa-plane\' style=\'font-size:.6rem\'></i></div>'
                  + '</button>';
        });
        html += '</div>';
        grid.innerHTML = html;
    }

    function filterToDay(prefix) {
        var iso = dayPrefixToISO(prefix);
        var dateEl = getEl('admin-delete-date');
        if (dateEl && iso) dateEl.value = iso;
        applyAdminFilters();
        buildDaySummary();
    }

    function clearDayFilter() {
        var dateEl = getEl('admin-delete-date');
        if (dateEl) dateEl.value = '';
        applyAdminFilters();
        buildDaySummary();
    }

    function isoToAirportDay(iso) {
        if (!iso) return '';
        var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        var d = new Date(iso + 'T00:00:00');
        return String(d.getDate()).padStart(2,'0') + MONTHS[d.getMonth()];
    }

    /**
     * AODB Turnaround Match — mismo contrato que rowInDateWindow en parte-ops-flights.js.
     * Regla 2 (lógica OR):
     *   (a) Cualquier campo de LLEGADA pertenece al día indicado.
     *   (b) Cualquier campo de SALIDA pertenece al día indicado.
     *   (c) La aeronave PERMANECIÓ EN TIERRA: llegó ANTES del día Y salió DESPUÉS.
     */
    function rowMatchesDay(row, dayPrefix) {
        var ARR_FIELDS = ['[Arr] ALDT', '[Arr] SIBT', '[Arr] AIBT'];
        var DEP_FIELDS = ['[Dep] SOBT', '[Dep] AOBT', '[Dep] ATOT', '[Dep] ATTT'];
        var prefix = (dayPrefix || '').toUpperCase();

        // (a) + (b): algún campo empieza con el prefijo del día (p.ej. "12JUL")
        var allFields = ARR_FIELDS.concat(DEP_FIELDS);
        if (allFields.some(function (f) {
            var v = row[f];
            return v && String(v).toUpperCase().startsWith(prefix);
        })) return true;

        // (c): avión estacionado — ningún campo toca el día, pero la aeronave
        //      llegó ANTES de ese día y salió DESPUÉS (overnight/multi-day stay)
        var dayISO = dayPrefixToISO(prefix);
        if (!dayISO) return false;

        var fieldToISO = function (f) {
            var v = String(row[f] || '').trim().toUpperCase();
            var m = v.match(/^(\d{2}[A-Z]{3})/);
            return m ? (dayPrefixToISO(m[1]) || '') : '';
        };

        var arrISOs = ARR_FIELDS.map(fieldToISO).filter(Boolean);
        var depISOs = DEP_FIELDS.map(fieldToISO).filter(Boolean);

        if (arrISOs.length > 0 && depISOs.length > 0) {
            var earliestArr = arrISOs.slice().sort()[0];
            var latestDep   = depISOs.slice().sort().reverse()[0];
            if (earliestArr < dayISO && latestDep > dayISO) return true;
        }

        return false;
    }

    async function loadData() {
        var tbody = getEl('tbody-admin-flights-csv');
        if (tbody) tbody.innerHTML = '<tr><td colspan="25" class="text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Cargando...</td></tr>';

        try {
            var sb = window.supabaseClient;
            if (!sb) throw new Error('Supabase no disponible');

            var result = await sb.from('itinerario_vuelos_editable').select('*').order('id', { ascending: true });
            if (result.error) throw result.error;

            adminData = result.data || [];
            adminFilters = {};
            document.querySelectorAll('#table-admin-flights-csv thead input[data-admin-field]').forEach(function (inp) { inp.value = ''; });

            renderTable();
            showStatus('Cargados ' + adminData.length + ' registro(s).', 'success');
        } catch (e) {
            adminData = [];
            updateBadge();
            if (tbody) tbody.innerHTML = '<tr><td colspan="25" class="text-danger py-3"><i class="fas fa-exclamation-triangle me-2"></i>Error al cargar: ' + escHtml(e.message || String(e)) + '</td></tr>';
        }
    }

    async function deleteByDate() {
        var dateEl = getEl('admin-delete-date');
        var date = dateEl ? dateEl.value : '';
        if (!date) {
            showStatus('Elige una fecha en el campo "Eliminar dia".', 'warning');
            return;
        }
        var dayPrefix = isoToAirportDay(date);
        var vuelos = adminData.filter(function (r) { return rowMatchesDay(r, dayPrefix); });
        if (vuelos.length === 0) {
            showStatus('No se encontraron vuelos del dia ' + date + ' (' + dayPrefix + ') en los datos cargados.', 'warning');
            return;
        }
        var ids = vuelos.map(function (r) { return r.id; });
        var ok = confirm('Eliminar TODOS los vuelos del dia ' + date + ' (' + dayPrefix + ')?\n' +
            vuelos.length + ' registro(s) seran eliminados.\n\nEsta accion NO se puede deshacer.');
        if (!ok) return;
        try {
            await deleteFromAllFlightTables(ids);
            showStatus('Vuelos del dia ' + dayPrefix + ' eliminados correctamente (' + ids.length + ' registros) de las 3 tablas.', 'success');
            adminData = adminData.filter(function (r) { return !ids.includes(r.id); });
            renderTable();
        } catch (e) {
            showStatus('Error al eliminar: ' + (e.message || e), 'danger');
        }
    }

    function rowsInRange(startISO, endISO) {
        var start = new Date(startISO + 'T00:00:00');
        var end   = new Date(endISO   + 'T23:59:59');
        var MONTHS = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
        var TIME_FIELDS = ['[Dep] SOBT','[Arr] SIBT','[Arr] ALDT','[Arr] AIBT','[Dep] AOBT','[Dep] ATOT'];
        var year = start.getFullYear();

        function parseField(val) {
            if (!val) return null;
            var m = String(val).trim().toUpperCase().match(/(\d{2})([A-Z]{3})\s+(\d{2}):(\d{2})/);
            if (!m) return null;
            var mon = MONTHS[m[2]];
            if (mon === undefined) return null;
            return new Date(year, mon, parseInt(m[1],10), parseInt(m[3],10), parseInt(m[4],10));
        }

        return adminData.filter(function (row) {
            return TIME_FIELDS.some(function (f) {
                var dt = parseField(row[f]);
                if (!dt) return false;
                return dt >= start && dt <= end;
            });
        });
    }

    function previewRange() {
        var s = getEl('admin-range-start');
        var e = getEl('admin-range-end');
        var badge = getEl('admin-range-preview');
        if (!s || !e || !badge) return;
        var startVal = s.value;
        var endVal   = e.value;
        if (!startVal || !endVal) {
            badge.classList.add('d-none');
            return;
        }
        if (endVal < startVal) {
            badge.textContent = 'Fin anterior al inicio';
            badge.className = 'badge bg-danger text-white';
            return;
        }
        var count = rowsInRange(startVal, endVal).length;
        badge.textContent = count + ' vuelo' + (count !== 1 ? 's' : '') + ' en rango';
        badge.className = 'badge ' + (count > 0 ? 'bg-warning text-dark' : 'bg-secondary text-white');
    }

    async function deleteByRange() {
        var startEl = getEl('admin-range-start');
        var endEl   = getEl('admin-range-end');
        var startVal = startEl ? startEl.value : '';
        var endVal   = endEl   ? endEl.value   : '';
        if (!startVal || !endVal) {
            showStatus('Selecciona fecha de inicio y fin del rango.', 'warning');
            return;
        }
        if (endVal < startVal) {
            showStatus('La fecha de fin debe ser igual o posterior a la de inicio.', 'warning');
            return;
        }
        var vuelos = rowsInRange(startVal, endVal);
        if (vuelos.length === 0) {
            showStatus('No se encontraron vuelos en el rango ' + startVal + ' - ' + endVal + '.', 'warning');
            return;
        }
        var startPfx = isoToAirportDay(startVal);
        var endPfx   = isoToAirportDay(endVal);
        var ok = confirm('Eliminar TODOS los vuelos del ' + startPfx + ' al ' + endPfx + '?\n' +
            vuelos.length + ' registro(s) seran eliminados.\n\nEsta accion NO se puede deshacer.');
        if (!ok) return;
        var ids = vuelos.map(function (r) { return r.id; });
        try {
            await deleteFromAllFlightTables(ids);
            showStatus('Eliminados ' + ids.length + ' vuelo(s) del rango ' + startPfx + ' - ' + endPfx + ' de las 3 tablas.', 'success');
            adminData = adminData.filter(function (r) { return !ids.includes(r.id); });
            var badge = getEl('admin-range-preview');
            if (badge) badge.classList.add('d-none');
            renderTable();
            buildDaySummary();
        } catch (e) {
            showStatus('Error al eliminar: ' + (e.message || e), 'danger');
        }
    }

    async function deleteById(id) {
        var ok = confirm('Eliminar este vuelo (ID: ' + id + ')?\n\nEsta accion NO se puede deshacer.');
        if (!ok) return;
        try {
            await deleteFromAllFlightTables([id]);
            adminData = adminData.filter(function (r) { return r.id !== id; });
            renderTable();
            showStatus('Vuelo eliminado de las 3 tablas.', 'success');
        } catch (e) {
            showStatus('Error al eliminar: ' + (e.message || e), 'danger');
        }
    }

    async function deleteSelected() {
        var checkboxes = document.querySelectorAll('.admin-row-chk:checked');
        if (checkboxes.length === 0) return;
        var ids = Array.from(checkboxes).map(function (chk) { return parseInt(chk.getAttribute('data-id'), 10); });
        var ok = confirm('Eliminar ' + ids.length + ' vuelo(s) seleccionado(s)?\n\nEsta accion NO se puede deshacer.');
        if (!ok) return;
        try {
            await deleteFromAllFlightTables(ids);
            adminData = adminData.filter(function (r) { return !ids.includes(r.id); });
            renderTable();
            showStatus('Se eliminaron ' + ids.length + ' vuelo(s) de las 3 tablas.', 'success');
        } catch (e) {
            showStatus('Error al eliminar: ' + (e.message || e), 'danger');
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var today = new Date();
        var fmt = function (d) { return d.toISOString().slice(0, 10); };

        var ddEl = getEl('admin-delete-date');
        if (ddEl) ddEl.value = fmt(today);

        var tabBtn = getEl('tab-conciliacion-admin');
        if (tabBtn) {
            var loaded = false;
            tabBtn.addEventListener('shown.bs.tab', function () {
                if (!loaded) { loaded = true; loadData(); }
            });
        }
    });

    return {
        loadData:           loadData,
        deleteByDate:       deleteByDate,
        deleteByRange:      deleteByRange,
        previewRange:       previewRange,
        deleteById:         deleteById,
        deleteSelected:     deleteSelected,
        toggleSelectAll:    toggleSelectAll,
        updateDeleteBtn:    updateDeleteBtn,
        filterToDay:        filterToDay,
        clearDayFilter:     clearDayFilter
    };
})();
