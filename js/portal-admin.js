/**
 * portal-admin.js
 * Panel de revisión de manifiestos digitales — AIFA (vista admin)
 * Carga todos los manifiestos recibidos desde el portal de prestadores,
 * permite filtrar y revisar (aprobar / rechazar / en revisión) con notas.
 */
(function PortalAdmin() {
    'use strict';

    const TABLE = 'Conciliación Manifiestos';

    const $    = id  => document.getElementById(id);
    const setT = (id, v) => { const e = $(id); if (e) e.textContent = String(v); };
    const val  = id  => { const e = $(id); return e ? e.value : ''; };

    let allRows = [], filteredRows = [], reviewModal = null, reviewingId = null;
    let archiveModal = null, archiveCategory = 'pasajeros';
    let loaded  = false; // carga lazy: solo al primer acceso
    let currentUser = null, canAifa = true, canAfac = false; // AIFA staff por defecto aprueba AIFA

    /* ── estatus general derivado de las 2 aprobaciones ── */
    function deriveStatus(aifa, afac) {
        const a = aifa || 'pendiente', b = afac || 'pendiente';
        if (a === 'rechazado' || b === 'rechazado') return 'rechazado';
        if (a === 'aprobado' && b === 'aprobado')   return 'aprobado';
        if (a === 'aprobado' || b === 'aprobado')   return 'en_revision';
        return 'pendiente';
    }

    async function resolvePermissions() {
        try {
            const sb = window.supabaseClient;
            const { data } = await sb.auth.getUser();
            currentUser = data?.user || null;
            const meta  = currentUser?.user_metadata || {};
            const email = (currentUser?.email || '').toLowerCase();
            let role = String(meta.role || '').toLowerCase();
            if (!role) {
                if (email.includes('afac')) role = 'afac';
                else if (email.includes('admin')) role = 'admin';
                else role = 'aifa';
            }
            canAifa = role === 'admin' || role === 'aifa';
            canAfac = role === 'admin' || role === 'afac';
            // Si no coincide con ninguno (staff genérico AIFA), permitir AIFA
            if (!canAifa && !canAfac) canAifa = true;
        } catch { canAifa = true; canAfac = false; }
    }

    /* ================================================================
       INIT
       ================================================================ */
    function init() {
        // Modal de Bootstrap
        const modalEl = $('modal-revisar-manifest');
        if (modalEl && window.bootstrap) {
            reviewModal = new window.bootstrap.Modal(modalEl);
        }
        const archiveModalEl = $('modal-manifest-archive');
        if (archiveModalEl && window.bootstrap) {
            archiveModal = new window.bootstrap.Modal(archiveModalEl);
        }

        // Botones del panel
        $('btn-padmin-refresh')?.addEventListener('click', loadAll);
        $('btn-padmin-export') ?.addEventListener('click', exportExcel);
        $('btn-padmin-archive-passengers')?.addEventListener('click', () => openArchive('pasajeros'));
        $('btn-padmin-archive-cargo')?.addEventListener('click', () => openArchive('carga'));
        $('btn-manifest-archive-refresh')?.addEventListener('click', () => loadArchive(archiveCategory));

        // Link del portal para compartir con aerolíneas
        try {
            const portalUrl = new URL('portal.html', window.location.href).href;
            const urlInput = $('padmin-portal-url');
            if (urlInput) urlInput.value = portalUrl;
            const linkBtn = document.querySelector('#portal-digitalizacion-section a[href="portal.html"]');
            if (linkBtn) linkBtn.href = portalUrl;
            $('btn-padmin-copy-url')?.addEventListener('click', async () => {
                const btn = $('btn-padmin-copy-url');
                try {
                    await navigator.clipboard.writeText(portalUrl);
                } catch {
                    urlInput?.select();
                    document.execCommand('copy');
                }
                if (btn) {
                    const prev = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check me-1"></i>Copiado';
                    setTimeout(() => { btn.innerHTML = prev; }, 1800);
                }
            });
        } catch (e) { /* no-op */ }

        // Filtros
        ['padmin-flt-from','padmin-flt-to','padmin-flt-airline','padmin-flt-company','padmin-flt-tipo','padmin-flt-status']
            .forEach(id => {
                const el = $(id);
                if (el) { el.addEventListener('change', applyFilters); el.addEventListener('input', applyFilters); }
            });

        // Carga cuando el usuario navega a la sección (click en el menú lateral)
        document.addEventListener('click', e => {
            const mn = e.target.closest('[data-section="portal-digitalizacion"]');
            if (mn && !loaded) { setTimeout(loadAll, 120); }
        });

        // También detectar cuando la sección recibe la clase 'active'
        const section = $('portal-digitalizacion-section');
        if (section) {
            new MutationObserver(() => {
                if (section.classList.contains('active') && !loaded) {
                    loadAll();
                }
            }).observe(section, { attributes: true, attributeFilter: ['class'] });
        }
    }

    /* ================================================================
       CARGA DE DATOS
       ================================================================ */
    async function loadAll() {
        const sb = window.supabaseClient;
        if (!sb) { console.warn('portal-admin: supabaseClient not ready'); return; }

        await resolvePermissions();
        show('padmin-loading');
        $('padmin-table-wrap')?.classList.add('opacity-50');

        try {
            const { data, error } = await sb
                .from(TABLE)
                .select('*')
                .not('_portal_user_id', 'is', null)
                .order('_portal_created_at', { ascending: false });
            if (error) throw error;

            allRows = data || [];
            loaded  = true;
            applyFilters();
            updateStats();
        } catch (err) {
            console.error('portal-admin loadAll error', err);
            alert('Error al cargar manifiestos: ' + err.message);
        } finally {
            hide('padmin-loading');
            $('padmin-table-wrap')?.classList.remove('opacity-50');
        }
    }

    /* ================================================================
       CONSULTA DE RESGUARDO (llegadas y salidas)
       ================================================================ */
    function openArchive(category) {
        archiveCategory = category;
        const isPassengers = category === 'pasajeros';
        const title = $('modal-manifest-archive-label');
        const header = $('manifest-archive-header');
        if (title) title.innerHTML = `<i class="fas fa-${isPassengers ? 'users' : 'boxes-stacked'} me-2"></i>Manifiestos de ${isPassengers ? 'Pasajeros' : 'Carga'}`;
        if (header) header.style.background = isPassengers ? '#e6f9fd' : '#f1f3f5';
        archiveModal?.show();
        loadArchive(category);
    }

    async function loadArchive(category) {
        const sb = window.supabaseClient;
        const tbody = $('manifest-archive-tbody');
        const count = $('manifest-archive-count');
        if (!sb) return;
        if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Cargando manifiestos resguardados…</td></tr>';
        if (count) count.textContent = 'Consultando la base de datos…';

        try {
            const select = 'id,created_at,direccion,tipo_manifesto,fecha_vuelo,folio,aerolinea_codigo,aerolinea_nombre,numero_vuelo,aeronave,matricula,aeropuerto_referencia,total_pasajeros,total_carga_kg,empresa,estado';
            const table = category === 'pasajeros' ? 'manifiestos_pasajeros' : 'manifiestos_carga';
            const { data, error } = await sb.from(table).select(select).order('fecha_vuelo', { ascending: false });
            if (error) throw error;
            const categoryLabel = category === 'pasajeros' ? 'Pasajeros' : 'Carga';
            const rows = (data || []).map(row => ({ ...row, category: categoryLabel }))
                .sort((a, b) => String(b.fecha_vuelo || '').localeCompare(String(a.fecha_vuelo || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));

            if (count) count.textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'} de ${categoryLabel.toLowerCase()}`;
            if (!rows.length) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-5">Aún no hay manifiestos resguardados para esta operación.</td></tr>';
                return;
            }
            const fmtDate = v => v ? new Date(`${v}T12:00:00`).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }) : '—';
            const fmtTime = v => v ? new Date(v).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
            const fmtNum = v => Number(v || 0).toLocaleString('es-MX');
            const stateClass = { pendiente:'warning', en_revision:'primary', aprobado:'success', rechazado:'danger' };
            tbody.innerHTML = rows.map(r => `<tr>
                <td class="ps-3 text-nowrap">${fmtDate(r.fecha_vuelo)}</td>
                <td><span class="badge ${r.category === 'Carga' ? 'text-bg-secondary' : 'text-bg-info'}">${r.category}</span></td>
                <td><span class="badge ${r.direccion === 'llegada' ? 'text-bg-success' : 'text-bg-warning'}">${esc(r.direccion === 'llegada' ? 'Llegada' : 'Salida')}</span></td>
                <td class="fw-semibold">${esc(r.folio || '—')}</td>
                <td class="fw-bold text-primary">${esc(r.numero_vuelo || '—')}</td>
                <td>${esc(r.aerolinea_nombre || r.empresa || r.aerolinea_codigo || '—')}</td>
                <td>${esc(r.aeropuerto_referencia || '—')}</td>
                <td>${esc(r.aeronave || '—')}</td>
                <td>${esc(r.matricula || '—')}</td>
                <td class="text-end">${fmtNum(r.total_pasajeros)}</td>
                <td class="text-end">${fmtNum(r.total_carga_kg)}</td>
                <td><span class="badge text-bg-${stateClass[r.estado] || 'secondary'}">${esc(r.estado || 'pendiente')}</span></td>
                <td class="text-nowrap small text-muted">${fmtTime(r.created_at)}</td>
            </tr>`).join('');
        } catch (err) {
            console.error('portal-admin loadArchive error', err);
            if (count) count.textContent = 'No fue posible consultar los registros.';
            if (tbody) tbody.innerHTML = `<tr><td colspan="13" class="text-center text-danger py-5"><i class="fas fa-circle-exclamation me-2"></i>${esc(err.message || 'Error al cargar la base de datos.')}<div class="small text-muted mt-2">Verifica que se haya ejecutado la migración 004 de Supabase.</div></td></tr>`;
        }
    }

    /* ================================================================
       FILTROS Y RENDER
       ================================================================ */
    function applyFilters() {
        const from    = val('padmin-flt-from');
        const to      = val('padmin-flt-to');
        const airline = val('padmin-flt-airline').trim().toLowerCase();
        const company = val('padmin-flt-company').trim().toLowerCase();
        const tipo    = val('padmin-flt-tipo');
        const status  = val('padmin-flt-status');

        filteredRows = allRows.filter(r => {
            const fd = r['_portal_flight_date'] || '';
            if (from   && fd < from)  return false;
            if (to     && fd > to)    return false;
            const tipoRow = String(r['TIPO DE MANIFIESTO'] || '').toLowerCase();
            if (tipo   && !tipoRow.includes(tipo)) return false;
            if (status && r['_portal_status'] !== status) return false;
            if (airline && !(r['AEROLINEA'] || '').toLowerCase().includes(airline)
                        && !(r['# DE VUELO'] || '').toLowerCase().includes(airline)) return false;
            if (company && !(r['_portal_company'] || '').toLowerCase().includes(company)) return false;
            return true;
        });

        renderTable();
    }

    function updateStats() {
        const hoy = new Date().toISOString().slice(0, 10);
        setT('padmin-stat-total', allRows.length);
        setT('padmin-stat-pend',  allRows.filter(r => r['_portal_status'] === 'pendiente').length);
        setT('padmin-stat-rev',   allRows.filter(r => r['_portal_status'] === 'en_revision').length);
        setT('padmin-stat-apro',  allRows.filter(r => r['_portal_status'] === 'aprobado').length);
        setT('padmin-stat-rech',  allRows.filter(r => r['_portal_status'] === 'rechazado').length);
        setT('padmin-stat-hoy',   allRows.filter(r => (r['_portal_created_at'] || '').startsWith(hoy)).length);
    }

    function renderTable() {
        const tbody = $('padmin-tbody');
        const cnt   = $('padmin-count');
        if (cnt) cnt.textContent = `${filteredRows.length} registro${filteredRows.length !== 1 ? 's' : ''}`;
        if (!tbody) return;

        if (!filteredRows.length) {
            tbody.innerHTML = '<tr><td colspan="28" class="text-center text-muted py-5">No hay manifiestos que coincidan con los filtros.</td></tr>';
            return;
        }

        const statusBadge = {
            pendiente:   '<span class="badge" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa">Pendiente</span>',
            en_revision: '<span class="badge" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">En revisión</span>',
            aprobado:    '<span class="badge" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">Aprobado</span>',
            rechazado:   '<span class="badge" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca">Rechazado</span>',
        };

        const cel  = (v, cls='') => `<td class="text-center ${cls}" style="white-space:nowrap">${v !== null && v !== undefined && v !== '' ? esc(String(v)) : '<span class="text-muted">—</span>'}</td>`;
        const celL = (v, cls='') => `<td class="${cls}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${v !== null && v !== undefined ? esc(String(v)) : ''}">${v !== null && v !== undefined && v !== '' ? esc(String(v)) : '<span class="text-muted">—</span>'}</td>`;

        tbody.innerHTML = filteredRows.map(r => {
            const fd = r['_portal_flight_date']
                ? new Date(r['_portal_flight_date'] + 'T12:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'2-digit' })
                : '—';
            const sd = r['_portal_created_at']
                ? new Date(r['_portal_created_at']).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
                : '—';
            const tipo = String(r['TIPO DE MANIFIESTO'] || '').toLowerCase();
            const ico  = tipo.includes('llegada') ? '🛬' : '🛫';
            const st   = r['_portal_status'] || 'pendiente';
            const bdg  = statusBadge[st] || `<span class="badge bg-secondary">${st}</span>`;
            const pdfBtn = r['EVIDENCIA']
                ? `<a href="${esc(r['EVIDENCIA'])}" target="_blank" rel="noopener"
                       class="btn btn-sm btn-outline-danger py-0 px-2 border me-1" title="Abrir PDF adjunto">
                       <i class="fas fa-file-pdf"></i> PDF</a>`
                : '<span class="text-muted small">Sin PDF</span>';

            return `<tr>
                <td class="ps-3 fw-bold text-primary" style="white-space:nowrap">${esc(r['# DE VUELO'] || '—')}</td>
                <td class="text-center">${ico}</td>
                ${cel(r['AEROLINEA'])}
                <td class="text-center" style="white-space:nowrap">${fd}</td>
                ${celL(r['DESTINO / ORIGEN'])}
                ${cel(r['TIPO DE OPERACIÓN'])}
                ${cel(r['SLOT ASIGNADO'])}
                ${cel(r['SLOT COORDINADO'])}
                ${cel(r['HR. DE OPERACIÓN'])}
                ${cel(r['HR. DE EMBARQUE O DESEMBARQUE'])}
                ${cel(r['HR. DE INICIO O TERMINO DE PERNOCTA'])}
                ${cel(r['TOTAL PAX'])}
                ${cel(r['PAX QUE PAGAN TUA'])}
                ${cel(r['TRANSITOS'])}
                ${cel(r['CONEXIONES'])}
                ${cel(r['TOTAL EXENTOS'])}
                ${cel(r['AERONAVE'])}
                ${cel(r['MATRÍCULA'])}
                ${cel(r['KGS. DE CARGA'])}
                ${cel(r['KGS. DE EQUIPAJE'])}
                ${cel(r['CORREO'])}
                ${cel(r['DEMORA +- 15 MIN.'])}
                ${cel(r['CÓDIGO DEMORA'])}
                ${celL(r['OBSERVACIONES'], 'text-muted')}
                ${celL(r['_portal_company'], 'text-muted')}
                <td style="white-space:nowrap">${bdg}
                    <div style="margin-top:3px;display:flex;gap:3px;flex-wrap:wrap">
                        ${padminMiniBadge('AIFA', r['_portal_aprob_aifa'])}
                        ${padminMiniBadge('AFAC', r['_portal_aprob_afac'])}
                    </div>
                </td>
                <td class="text-muted" style="white-space:nowrap;font-size:.72rem">${sd}</td>
                <td class="pe-2" style="white-space:nowrap">
                    ${pdfBtn}
                    <button class="btn btn-sm btn-outline-primary py-0 px-2 border"
                            onclick="portalAdminOpenReview(${r.id})" title="Revisar manifiesto">
                        <i class="fas fa-clipboard-check"></i> Revisar
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    /* ================================================================
       MODAL DE REVISIÓN
       ================================================================ */
    window.portalAdminOpenReview = function(id) {
        const r = allRows.find(x => x.id === id);
        if (!r) return;
        reviewingId = id;

        const fd = r['_portal_flight_date']
            ? new Date(r['_portal_flight_date'] + 'T12:00').toLocaleDateString('es-MX', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
            : '—';
        const tipo = String(r['TIPO DE MANIFIESTO'] || '').toLowerCase();
        const isLlegada = tipo.includes('llegada');

        const row = (lbl, v) => v !== null && v !== undefined && v !== ''
            ? `<div class="row mb-1">
                   <div class="col-5 small text-muted">${lbl}</div>
                   <div class="col-7 small fw-semibold">${esc(String(v))}</div>
               </div>`
            : '';

        $('review-details').innerHTML = `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="p-3 rounded-3 bg-light">
                    <div class="fw-bold mb-2 d-flex align-items-center gap-2">
                        <span style="font-size:1.3rem">${isLlegada ? '🛬' : '🛫'}</span>
                        <span class="text-primary fs-6">${esc(r['# DE VUELO'] || '')} — ${esc(r['AEROLINEA'] || '')}</span>
                    </div>
                    ${row('Empresa / Prestador', r['_portal_company'])}
                    ${row('Tipo de manifiesto', r['TIPO DE MANIFIESTO'])}
                    ${row('Fecha de vuelo', fd)}
                    ${row(isLlegada ? 'Origen' : 'Destino', r['DESTINO / ORIGEN'])}
                    ${row('Slot asignado', r['SLOT ASIGNADO'])}
                    ${row('Slot coordinado', r['SLOT COORDINADO'])}
                    ${row('HR. de operación', r['HR. DE OPERACIÓN'])}
                    ${row('HR. Embarque/Desembarque', r['HR. DE EMBARQUE O DESEMBARQUE'])}
                    ${row('HR. de pernocta', r['HR. DE INICIO O TERMINO DE PERNOCTA'])}
                    ${row('Tipo de operación', r['TIPO DE OPERACIÓN'])}
                </div>
            </div>
            <div class="col-md-6">
                <div class="p-3 rounded-3 bg-light">
                    <div class="fw-bold small text-muted text-uppercase mb-2" style="letter-spacing:.06em">Pasajeros y Aeronave</div>
                    ${row('Total PAX', r['TOTAL PAX'])}
                    ${row('PAX que pagan TUA', r['PAX QUE PAGAN TUA'])}
                    ${row('Tránsitos', r['TRANSITOS'])}
                    ${row('Conexiones', r['CONEXIONES'])}
                    ${row('Total Exentos', r['TOTAL EXENTOS'])}
                    ${row('Equipaje (kg)', r['KGS. DE EQUIPAJE'])}
                    ${row('Carga (kg)', r['KGS. DE CARGA'])}
                    ${row('Correo (kg)', r['CORREO'])}
                    ${row('Matrícula', r['MATRÍCULA'])}
                    ${row('Tipo aeronave', r['AERONAVE'])}
                    ${row('Demora', r['DEMORA +- 15 MIN.'])}
                    ${row('Código demora', r['CÓDIGO DEMORA'])}
                </div>
                ${r['OBSERVACIONES']
                    ? `<div class="mt-2 p-2 rounded-2 bg-light border small"><strong>Observaciones:</strong><br>${esc(r['OBSERVACIONES'])}</div>`
                    : ''}
                ${r['EVIDENCIA']
                    ? `<div class="mt-2"><a href="${esc(r['EVIDENCIA'])}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary"><i class="fas fa-file-pdf me-1 text-danger"></i>Ver PDF adjunto</a></div>`
                    : ''}
            </div>
        </div>`;

        // Render de las 2 aprobaciones (AIFA + AFAC)
        $('review-alert')?.classList.add('d-none');
        renderApprovals(r);
        reviewModal?.show();
    };

    function apChip(v) {
        const s = v || 'pendiente';
        const map = {
            pendiente:  ['#c2410c','#fff7ed','#fed7aa','Pendiente'],
            aprobado:   ['#166534','#f0fdf4','#bbf7d0','Aprobado'],
            rechazado:  ['#991b1b','#fef2f2','#fecaca','Rechazado'],
        };
        const [c,bg,bd,lbl] = map[s] || map.pendiente;
        return `<span class="badge" style="color:${c};background:${bg};border:1px solid ${bd}">${lbl}</span>`;
    }

    function trackCard(r, entidad, titulo, colorClass, can) {
        const estado = r[`_portal_aprob_${entidad}`] || 'pendiente';
        const byName = r[`_portal_${entidad}_by_name`];
        const at     = r[`_portal_${entidad}_at`];
        const notes  = r[`_portal_${entidad}_notes`] || '';
        const at_s   = at ? new Date(at).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
        const actions = can ? `
            <textarea id="rev-notes-${entidad}" class="form-control form-control-sm mb-2" rows="2" placeholder="Notas de ${entidad.toUpperCase()}…">${esc(notes)}</textarea>
            <div class="d-flex gap-2 flex-wrap">
                <button class="btn btn-sm btn-outline-secondary" onclick="portalAdminSetApproval(${r.id},'${entidad}','pendiente')"><i class="fas fa-hourglass-half me-1"></i>Pendiente</button>
                <button class="btn btn-sm btn-success" onclick="portalAdminSetApproval(${r.id},'${entidad}','aprobado')"><i class="fas fa-check me-1"></i>Aprobar</button>
                <button class="btn btn-sm btn-danger" onclick="portalAdminSetApproval(${r.id},'${entidad}','rechazado')"><i class="fas fa-times me-1"></i>Rechazar</button>
            </div>`
            : `<div class="small text-muted fst-italic">No tienes permiso para aprobar en esta entidad.</div>
               ${notes ? `<div class="small mt-2 p-2 bg-light border rounded">${esc(notes)}</div>` : ''}`;
        return `
        <div class="col-md-6">
            <div class="p-3 rounded-3 border h-100" style="border-left:4px solid ${colorClass} !important">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <span class="fw-bold">${titulo}</span>
                    ${apChip(estado)}
                </div>
                <div class="small text-muted mb-2">${byName ? `Por: <strong>${esc(byName)}</strong> · ${at_s}` : 'Sin revisar aún'}</div>
                ${actions}
            </div>
        </div>`;
    }

    function renderApprovals(r) {
        const wrap = $('review-approvals');
        if (!wrap) return;
        wrap.innerHTML =
            trackCard(r, 'aifa', '🏢 AIFA · Aeropuerto', '#1565c0', canAifa) +
            trackCard(r, 'afac', '🛡️ AFAC · Autoridad', '#2e7d32', canAfac);
    }

    function reviewAlert(msg, ok) {
        const el = $('review-alert');
        if (!el) return;
        el.classList.remove('d-none');
        el.style.background = ok ? '#f0fdf4' : '#fef2f2';
        el.style.color      = ok ? '#166534' : '#991b1b';
        el.style.border     = `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`;
        el.textContent = msg;
    }

    window.portalAdminSetApproval = async function(id, entidad, decision) {
        const sb = window.supabaseClient;
        if (!sb) return;
        const r = allRows.find(x => x.id === id) || {};
        const notes = ($(`rev-notes-${entidad}`)?.value || '').trim();
        const revName = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'Revisor AIFA';

        const newAifa = entidad === 'aifa' ? decision : (r['_portal_aprob_aifa'] || 'pendiente');
        const newAfac = entidad === 'afac' ? decision : (r['_portal_aprob_afac'] || 'pendiente');
        const general = deriveStatus(newAifa, newAfac);

        const upd = {
            [`_portal_aprob_${entidad}`]:   decision,
            [`_portal_${entidad}_by`]:      currentUser?.id || null,
            [`_portal_${entidad}_by_name`]: revName,
            [`_portal_${entidad}_at`]:      new Date().toISOString(),
            [`_portal_${entidad}_notes`]:   notes || null,
            '_portal_status':               general,
            '_portal_reviewed_at':          new Date().toISOString(),
        };

        try {
            const { error } = await sb.from(TABLE).update(upd).eq('id', id);
            if (error) throw error;
            Object.assign(r, upd);
            renderApprovals(r);
            applyFilters();
            updateStats();
            reviewAlert(`✓ ${entidad.toUpperCase()}: ${decision} · Estado general: ${general}`, true);
        } catch (err) {
            reviewAlert('Error al guardar: ' + err.message, false);
        }
    };

    /* ================================================================
       EXPORT EXCEL
       ================================================================ */
    function exportExcel() {
        if (typeof XLSX === 'undefined') {
            alert('La biblioteca XLSX no está disponible en esta página.');
            return;
        }
        const headers = [
            'ID','# DE VUELO','TIPO DE MANIFIESTO','AEROLINEA','FECHA VUELO','DESTINO / ORIGEN',
            'TIPO DE OPERACIÓN','SLOT ASIGNADO','SLOT COORDINADO','HR. DE OPERACIÓN',
            'HR. EMBARQUE/DESEMBARQUE','HR. PERNOCTA',
            'TOTAL PAX','PAX QUE PAGAN TUA','TRANSITOS','CONEXIONES','TOTAL EXENTOS',
            'AERONAVE','MATRÍCULA','KGS. DE CARGA','KGS. DE EQUIPAJE','CORREO',
            'DEMORA','CÓDIGO DEMORA','OBSERVACIONES',
            'PRESTADOR','ESTADO','NOTAS AIFA','REVISADO','EVIDENCIA (PDF)','RECIBIDO'
        ];

        const rows = filteredRows.map(r => [
            r.id,
            r['# DE VUELO'],
            r['TIPO DE MANIFIESTO'],
            r['AEROLINEA'],
            r['_portal_flight_date'],
            r['DESTINO / ORIGEN'],
            r['TIPO DE OPERACIÓN'],
            r['SLOT ASIGNADO'],
            r['SLOT COORDINADO'],
            r['HR. DE OPERACIÓN'],
            r['HR. DE EMBARQUE O DESEMBARQUE'],
            r['HR. DE INICIO O TERMINO DE PERNOCTA'],
            r['TOTAL PAX'],
            r['PAX QUE PAGAN TUA'],
            r['TRANSITOS'],
            r['CONEXIONES'],
            r['TOTAL EXENTOS'],
            r['AERONAVE'],
            r['MATRÍCULA'],
            r['KGS. DE CARGA'],
            r['KGS. DE EQUIPAJE'],
            r['CORREO'],
            r['DEMORA +- 15 MIN.'],
            r['CÓDIGO DEMORA'],
            r['OBSERVACIONES'],
            r['_portal_company'],
            r['_portal_status'],
            r['_portal_review_notes'],
            r['_portal_reviewed_at'] ? new Date(r['_portal_reviewed_at']).toLocaleString('es-MX') : '',
            r['EVIDENCIA'],
            r['_portal_created_at'] ? new Date(r['_portal_created_at']).toLocaleString('es-MX') : '',
        ]);

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        // Auto-filter
        try {
            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
            ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
        } catch(_) { /* ignore */ }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Manifiestos Portal AIFA');
        XLSX.writeFile(wb, `manifiestos_portal_${new Date().toISOString().slice(0,10)}.xlsx`);
    }

    /* ================================================================
       UTILS
       ================================================================ */
    function show(id) { const e = $(id); if (e) e.classList.remove('d-none'); }
    function hide(id) { const e = $(id); if (e) e.classList.add('d-none'); }
    function padminMiniBadge(lbl, v) {
        const s = v || 'pendiente';
        const map = {
            pendiente:  ['#c2410c','#fff7ed','#fed7aa','◷'],
            aprobado:   ['#166534','#f0fdf4','#bbf7d0','✓'],
            rechazado:  ['#991b1b','#fef2f2','#fecaca','✕'],
        };
        const [c,bg,bd,ic] = map[s] || map.pendiente;
        return `<span title="${lbl}: ${s}" style="font-size:.6rem;font-weight:800;color:${c};background:${bg};border:1px solid ${bd};padding:0 .3rem;border-radius:999px;white-space:nowrap">${ic} ${lbl}</span>`;
    }
    function esc(t) {
        return String(t)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }

    /* ================================================================
       ARRANQUE
       ================================================================ */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
