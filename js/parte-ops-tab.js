
// Logic for "Parte de Operaciones" tab in Data Management
document.addEventListener('DOMContentLoaded', () => {
    const tabParteOps = document.getElementById('tab-parte-ops');
    const btnRefresh = document.getElementById('btn-refresh-parte-ops');
    const btnNew = document.getElementById('btn-new-parte-ops');
    const dateFilter = document.getElementById('filter-parte-ops-date');
    const monthFilter = document.getElementById('filter-parte-ops-month');
    const yearFilter = document.getElementById('filter-parte-ops-year');
    const btnExport = document.getElementById('btn-export-parte-ops');
    const tbody = document.getElementById('tbody-parte-ops');
    
    // Edit Modal elements
    const editModalEl = document.getElementById('editParteOpsModal');
    const editForm = document.getElementById('form-parte-ops');
    const btnSaveParteOps = document.getElementById('btn-save-parte-ops');
    const btnCalcFromItinerary = document.getElementById('btn-calc-from-itinerary');
    
    let editModal = null;
    if (editModalEl) {
        editModal = new bootstrap.Modal(editModalEl);
    }

    // Helper for normalization
    const norm = (str) => (str || '').toString().trim().toLowerCase();
    
    // Helper to classify flight
    const classifyFlight = (f) => {
        const cat = norm(f.categoria);
        const airline = norm(f.aerolinea || f.aerolínea || f.airline);
        
        // Explicit categories
        if (cat === 'carga') return 'carga';
        if (cat === 'general' || cat === 'privada') return 'general';
        if (cat === 'pasajeros' || cat === 'comercial') return 'comercial';
        
        // Airline based heuristics (simplified from itinerario.js)
        const cargoAirlines = ['atlas air','aero union','aerounion','masair','mas','estafeta','dhl','cargolux','cathay pacific','ups','turkish','amerijet','air canada cargo','kalitta','ethiopian'];
        if (cargoAirlines.some(c => airline.includes(c))) return 'carga';
        
        // Default to comercial if it looks like an airline, or general if not? 
        // Let's assume comercial for now if not cargo.
        return 'comercial';
    };

    if (btnCalcFromItinerary) {
        btnCalcFromItinerary.addEventListener('click', async () => {
            const dateInput = document.getElementById('edit-parte-ops-date');
            const dateVal = dateInput.value;
            
            if (!dateVal) {
                alert('Por favor selecciona una fecha primero.');
                return;
            }

            if (!window.supabaseClient) {
                alert('Error: Cliente Supabase no disponible.');
                return;
            }

            // Show loading state on button
            const originalHtml = btnCalcFromItinerary.innerHTML;
            btnCalcFromItinerary.disabled = true;
            btnCalcFromItinerary.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                // Fetch flights for this date (arrivals or departures)
                const { data, error } = await window.supabaseClient
                    .from('flights')
                    .select('*')
                    .or(`fecha_llegada.eq.${dateVal},fecha_salida.eq.${dateVal}`);

                if (error) throw error;

                if (!data || data.length === 0) {
                    alert('No se encontraron vuelos en el Itinerario para esta fecha.');
                    return; // Keep existing values or reset? Let's keep.
                }

                let counts = {
                    comercial: { llegada: 0, salida: 0 },
                    carga: { llegada: 0, salida: 0 },
                    general: { llegada: 0, salida: 0 }
                };

                data.forEach(f => {
                    const type = classifyFlight(f);
                    
                    // Check Arrival
                    if (f.fecha_llegada === dateVal) {
                        if (counts[type]) counts[type].llegada++;
                    }
                    
                    // Check Departure
                    if (f.fecha_salida === dateVal) {
                        if (counts[type]) counts[type].salida++;
                    }
                });

                // Update inputs
                document.getElementById('edit-comercial-llegada').value = counts.comercial.llegada;
                document.getElementById('edit-comercial-salida').value = counts.comercial.salida;
                
                document.getElementById('edit-carga-llegada').value = counts.carga.llegada;
                document.getElementById('edit-carga-salida').value = counts.carga.salida;
                
                document.getElementById('edit-general-llegada').value = counts.general.llegada;
                document.getElementById('edit-general-salida').value = counts.general.salida;

                // Optional: Show a toast or small success message
                // alert('Datos calculados desde el Itinerario.');

            } catch (err) {
                console.error('Error calculating from itinerary:', err);
                alert('Error al calcular: ' + err.message);
            } finally {
                btnCalcFromItinerary.disabled = false;
                btnCalcFromItinerary.innerHTML = originalHtml;
            }
        });
    }

    const SPANISH_MONTHS = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const [year, month, day] = dateStr.split('-');
        const monthName = SPANISH_MONTHS[parseInt(month, 10) - 1];
        return `${day} de ${monthName} ${year}`;
    }

    async function loadParteOpsData() {
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Cargando...</td></tr>';

        if (!window.supabaseClient) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error: Cliente Supabase no inicializado</td></tr>';
            return;
        }

        let query = window.supabaseClient
            .from('parte_operations')
            .select('*')
            .order('fecha', { ascending: false });

        if (dateFilter && dateFilter.value) {
            query = query.eq('fecha', dateFilter.value);
        } else if (monthFilter && monthFilter.value) {
            // El año venía fijo en '2025'. Filtrar por mes devolvía entonces
            // registros de 2025 mientras la tabla mostraba 2026: parecía que el
            // filtro "no traía nada" o traía cosas de otra temporada. Ahora sale
            // del selector de año, que se llena con los años que existen.
            const year = anioSeleccionado();
            const month = monthFilter.value;
            const startDate = `${year}-${month}-01`;
            const nextMonth = parseInt(month, 10) + 1;
            let endDate;
            if (nextMonth > 12) {
                endDate = `${parseInt(year) + 1}-01-01`;
            } else {
                const nextMonthStr = nextMonth.toString().padStart(2, '0');
                endDate = `${year}-${nextMonthStr}-01`;
            }
            
            query = query.gte('fecha', startDate).lt('fecha', endDate);
        } else {
            query = query.limit(50);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error loading parte_operations:', error);
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${error.message}</td></tr>`;
            return;
        }

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No se encontraron registros</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        data.forEach(row => {
            const tr = document.createElement('tr');
            
            let pdfActionHtml = '';
            // Determine button grouping based on state
            if (row.pdf_url) {
                pdfActionHtml = `
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-outline-primary btn-preview-pdf" data-url="${row.pdf_url}" title="Ver PDF">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary btn-edit-row" data-id="${row.id}" title="Editar Datos y PDF">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger btn-delete-row" data-id="${row.id}" title="Eliminar Registro">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            } else {
                pdfActionHtml = `
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-outline-primary btn-edit-row" data-id="${row.id}" title="Editar Datos y PDF">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                        <button class="btn btn-sm btn-outline-danger btn-delete-row" data-id="${row.id}" title="Eliminar Registro">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            }

            tr.innerHTML = `
                <td class="text-center font-monospace text-nowrap align-middle">${formatDate(row.fecha)}</td>
                <td class="text-center align-middle">
                    <div class="d-flex justify-content-center align-items-center gap-3 text-primary">
                        <span class="fw-semibold"><i class="fas fa-plane-arrival small me-1 opacity-50"></i>${row.comercial_llegada}</span>
                        <span class="text-muted opacity-25">|</span>
                        <span class="fw-semibold"><i class="fas fa-plane-departure small me-1 opacity-50"></i>${row.comercial_salida}</span>
                    </div>
                </td>
                <td class="text-center align-middle">
                    <div class="d-flex justify-content-center align-items-center gap-3 text-warning">
                        <span class="fw-semibold"><i class="fas fa-plane-arrival small me-1 opacity-50"></i>${row.carga_llegada}</span>
                        <span class="text-muted opacity-25">|</span>
                        <span class="fw-semibold"><i class="fas fa-plane-departure small me-1 opacity-50"></i>${row.carga_salida}</span>
                    </div>
                </td>
                <td class="text-center align-middle">
                    <div class="d-flex justify-content-center align-items-center gap-3 text-success">
                        <span class="fw-semibold"><i class="fas fa-plane-arrival small me-1 opacity-50"></i>${row.general_llegada}</span>
                        <span class="text-muted opacity-25">|</span>
                        <span class="fw-semibold"><i class="fas fa-plane-departure small me-1 opacity-50"></i>${row.general_salida}</span>
                    </div>
                </td>
                <td class="text-center align-middle">
                    <span class="badge bg-light text-dark border fs-6">${row.total_general}</span>
                </td>
                <td class="text-center align-middle">${pdfActionHtml}</td>
            `;
            tbody.appendChild(tr);
        });

        // Edit Row Event
        document.querySelectorAll('.btn-edit-row').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const rowData = data.find(r => r.id == id);
                if (rowData) {
                    openEditModal(rowData);
                }
            });
        });

        // Delete Row Event
        document.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                if (confirm('¿Estás seguro de que deseas eliminar este registro permanentemente?')) {
                    try {
                        const { error } = await window.supabaseClient
                            .from('parte_operations')
                            .delete()
                            .eq('id', id);
                        
                        if (error) throw error;
                        
                        alert('Registro eliminado correctamente.');
                        loadParteOpsData();
                    } catch (err) {
                        console.error('Error al eliminar:', err);
                        alert('Error al eliminar registro: ' + err.message);
                    }
                }
            });
        });

        // Preview PDF
        document.querySelectorAll('.btn-preview-pdf').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.currentTarget.getAttribute('data-url');
                const modalEl = document.getElementById('pdfPreviewModal');
                const iframe = document.getElementById('pdf-preview-frame');
                const downloadBtn = document.getElementById('btn-download-pdf-modal');
                
                if (modalEl && iframe) {
                    iframe.src = url;
                    if (downloadBtn) downloadBtn.href = url;
                    const modal = new bootstrap.Modal(modalEl);
                    modal.show();
                }
            });
        });
    }

    function openEditModal(data) {
        if (!editModal) return;
        
        const isNew = !data;
        const modalTitle = document.getElementById('editParteOpsModalLabel');
        if (modalTitle) modalTitle.textContent = isNew ? 'Nuevo Parte de Operaciones' : 'Editar Parte de Operaciones';

        document.getElementById('edit-parte-ops-id').value = isNew ? '' : data.id;
        
        const dateInput = document.getElementById('edit-parte-ops-date');
        dateInput.value = isNew ? new Date().toISOString().split('T')[0] : data.fecha;
        dateInput.readOnly = false; // Always allow editing date

        document.getElementById('edit-comercial-llegada').value = isNew ? '' : data.comercial_llegada;
        document.getElementById('edit-comercial-salida').value = isNew ? '' : data.comercial_salida;
        
        document.getElementById('edit-carga-llegada').value = isNew ? '' : data.carga_llegada;
        document.getElementById('edit-carga-salida').value = isNew ? '' : data.carga_salida;
        
        document.getElementById('edit-general-llegada').value = isNew ? '' : data.general_llegada;
        document.getElementById('edit-general-salida').value = isNew ? '' : data.general_salida;
        
        const pdfInfo = document.getElementById('current-pdf-info');
        const fileInput = document.getElementById('edit-parte-ops-pdf');
        fileInput.dataset.deletePdf = 'false'; // Reset delete flag

        if (!isNew && data.pdf_url) {
            pdfInfo.innerHTML = `
                <div class="d-flex align-items-center gap-2">
                    <span class="text-success"><i class="fas fa-check-circle"></i> PDF disponible</span>
                    <a href="${data.pdf_url}" target="_blank" class="btn btn-sm btn-outline-primary">Ver</a>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="btn-delete-pdf-modal">Eliminar</button>
                </div>
            `;
            
            // Add listener to the dynamically created button
            const deleteBtn = document.getElementById('btn-delete-pdf-modal');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    if(confirm('¿Estás seguro de que quieres eliminar el PDF de este registro? (Se aplicará al guardar)')) {
                        fileInput.dataset.deletePdf = 'true';
                        pdfInfo.innerHTML = '<span class="text-danger"><i class="fas fa-trash-alt"></i> PDF marcado para eliminar al guardar.</span>';
                    }
                });
            }
        } else {
            pdfInfo.innerHTML = '<span class="text-muted">No hay PDF adjunto actualmente.</span>';
        }
        
        fileInput.value = ''; // Reset file input
        
        editModal.show();
    }

    if (btnSaveParteOps) {
        btnSaveParteOps.addEventListener('click', async () => {
            const id = document.getElementById('edit-parte-ops-id').value;
            const fecha = document.getElementById('edit-parte-ops-date').value;
            
            const comArr = parseInt(document.getElementById('edit-comercial-llegada').value) || 0;
            const comDep = parseInt(document.getElementById('edit-comercial-salida').value) || 0;
            
            const carArr = parseInt(document.getElementById('edit-carga-llegada').value) || 0;
            const carDep = parseInt(document.getElementById('edit-carga-salida').value) || 0;
            
            const genArr = parseInt(document.getElementById('edit-general-llegada').value) || 0;
            const genDep = parseInt(document.getElementById('edit-general-salida').value) || 0;
            
            const total = comArr + comDep + carArr + carDep + genArr + genDep;
            
            const fileInput = document.getElementById('edit-parte-ops-pdf');
            const file = fileInput.files[0];
            const deletePdf = fileInput.dataset.deletePdf === 'true';

            // Show loading
            const originalBtnText = btnSaveParteOps.innerHTML;
            btnSaveParteOps.disabled = true;
            btnSaveParteOps.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Guardando...';

            try {
                let updateData = {
                    comercial_llegada: comArr,
                    comercial_salida: comDep,
                    carga_llegada: carArr,
                    carga_salida: carDep,
                    general_llegada: genArr,
                    general_salida: genDep,
                    total_general: total
                };

                // Handle PDF Upload if selected
                if (file) {
                    const fileExt = file.name.split('.').pop();
                    const fileName = `parte_operaciones_${fecha}_${Date.now()}.${fileExt}`;
                    const filePath = `${fileName}`;

                    const { data: uploadData, error: uploadError } = await window.supabaseClient
                        .storage
                        .from('parte-operaciones')
                        .upload(filePath, file);

                    if (uploadError) throw uploadError;

                    const { data: { publicUrl } } = window.supabaseClient
                        .storage
                        .from('parte-operaciones')
                        .getPublicUrl(filePath);
                    
                    updateData.pdf_url = publicUrl;
                } else if (deletePdf) {
                    updateData.pdf_url = null;
                }

                let error;
                // Always include fecha in update data to support date editing
                updateData.fecha = fecha;

                if (id) {
                    // Update Record
                    const { error: updateError } = await window.supabaseClient
                        .from('parte_operations')
                        .update(updateData)
                        .eq('id', id);
                    error = updateError;
                } else {
                    // Create Record
                    updateData.fecha = fecha; // Add date for new record
                    const { error: insertError } = await window.supabaseClient
                        .from('parte_operations')
                        .insert([updateData]);
                    error = insertError;
                }

                if (error) throw error;

                alert(id ? 'Registro actualizado correctamente' : 'Registro creado correctamente');
                editModal.hide();
                loadParteOpsData();

            } catch (error) {
                console.error('Error saving parte_operations:', error);
                alert('Error al guardar: ' + error.message);
            } finally {
                btnSaveParteOps.innerHTML = originalBtnText;
                btnSaveParteOps.disabled = false;
            }
        });
    }

    // ── Año: se ofrece sólo lo que existe ────────────────────────────────
    //
    // Un rango inventado (2020-2030) llena el selector de años vacíos y hace
    // que "no hay datos" parezca una falla. Los años salen de la propia tabla.
    function anioSeleccionado() {
        const elegido = String(yearFilter?.value || '').trim();
        if (/^\d{4}$/.test(elegido)) return elegido;
        return String(new Date().getFullYear());
    }

    let aniosCargados = false;
    async function poblarAnios() {
        if (aniosCargados || !yearFilter || !window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('parte_operations')
                .select('fecha')
                .order('fecha', { ascending: false })
                .limit(3000);
            if (error) throw error;
            const anios = window.parteOpsExport
                ? window.parteOpsExport.aniosDisponibles(data)
                : [];
            // Si la tabla está vacía queda al menos el año en curso, para que el
            // selector no aparezca sin ninguna opción.
            const opciones = anios.length ? anios : [String(new Date().getFullYear())];
            yearFilter.innerHTML = opciones
                .map(a => `<option value="${a}">${a}</option>`)
                .join('');
            aniosCargados = true;
        } catch (err) {
            console.warn('No se pudieron cargar los años de Parte de Operaciones:', err);
        }
    }

    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            if (!window.parteOpsExport) {
                alert('No se pudo cargar el exportador. Recarga la página e inténtalo de nuevo.');
                return;
            }
            const anio = anioSeleccionado();
            const htmlPrevio = btnExport.innerHTML;
            btnExport.disabled = true;
            btnExport.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando…';
            try {
                const matriz = await window.parteOpsExport.exportarAnual(anio);
                if (typeof showNotification === 'function') {
                    showNotification(
                        `Exportados ${matriz.registros} partes de ${anio} en cuadrícula día × mes.`,
                        'success'
                    );
                }
            } catch (err) {
                console.error('Error al exportar Parte de Operaciones:', err);
                const mensaje = err?.message || String(err);
                if (typeof showNotification === 'function') showNotification(mensaje, 'error');
                else alert(mensaje);
            } finally {
                btnExport.disabled = false;
                btnExport.innerHTML = htmlPrevio;
            }
        });
    }

    if (tabParteOps) {
        tabParteOps.addEventListener('shown.bs.tab', () => {
            poblarAnios();
            loadParteOpsData();
        });
    }

    if (yearFilter) {
        yearFilter.addEventListener('change', loadParteOpsData);
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            // "Actualizar" tambien rellena el selector de anio: si se entro a la
            // pestana por un enlace directo, el evento shown.bs.tab no se dispara
            // y el selector se quedaria vacio sin forma de llenarlo.
            poblarAnios();
            loadParteOpsData();
        });
    }

    // Exponer para recarga en tiempo real
    window.parteOpsReload = loadParteOpsData;

    if (btnNew) {
        btnNew.addEventListener('click', () => openEditModal(null));
    }

    if (dateFilter) {
        dateFilter.addEventListener('change', () => {
            if (dateFilter.value && monthFilter) monthFilter.value = ''; // Clear month if date selected
            loadParteOpsData();
        });
    }

    if (monthFilter) {
        monthFilter.addEventListener('change', () => {
            if (monthFilter.value && dateFilter) dateFilter.value = ''; // Clear date if month selected
            loadParteOpsData();
        });
    }
});
