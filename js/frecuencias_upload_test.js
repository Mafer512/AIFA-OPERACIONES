
/* ==========================================================================
   Lectura del archivo de Visits (export del sistema del aeropuerto)

   Cada fila es una visita: la llegada [Arr] y la salida [Dep] de un avión.
   De cada visita salen hasta dos tramos (la llegada y la salida). En la tabla
   de frecuencias cada día cuenta las SALIDAS (frecuencias) y el detalle guarda
   los dos tramos (db/frecuencias_contar_salidas.sql).

   Además de leer, lleva la cuenta de lo que no entró y por qué, para poder
   cuadrar contra el Excel: tramos de otras fechas, sin ruta/vuelo/hora, con
   hora ilegible o repetidos.
   ========================================================================== */
(function () {
    const AIFA = ['NLU', 'MMSM'];
    const MESES = {
        JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
        ENE: 0, ABR: 3, AGO: 7, DIC: 11,
    };

    /** El separador del archivo: coma, o punto y coma si se volvió a guardar desde Excel en español. */
    function separador(texto) {
        const primera = String(texto || '').split(/\r?\n/, 1)[0] || '';
        const sinComillas = primera.replace(/"[^"]*"/g, '');
        return (sinComillas.match(/;/g) || []).length > (sinComillas.match(/,/g) || []).length ? ';' : ',';
    }

    /** CSV completo → filas. Respeta comillas, comillas dobles ("") y saltos de línea dentro de un campo. */
    function parsearCSV(texto) {
        const t = String(texto || '').replace(/^﻿/, '');
        const sep = separador(t);
        const filas = [];
        let fila = [];
        let campo = '';
        let enComillas = false;
        for (let i = 0; i < t.length; i++) {
            const c = t[i];
            if (enComillas) {
                if (c === '"') {
                    if (t[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
                } else campo += c;
                continue;
            }
            if (c === '"') { enComillas = true; continue; }
            if (c === sep) { fila.push(campo.trim()); campo = ''; continue; }
            if (c === '\n' || c === '\r') {
                if (c === '\r' && t[i + 1] === '\n') i++;
                fila.push(campo.trim());
                campo = '';
                if (fila.some(x => x !== '')) filas.push(fila);
                fila = [];
                continue;
            }
            campo += c;
        }
        fila.push(campo.trim());
        if (fila.some(x => x !== '')) filas.push(fila);
        return filas;
    }

    /** «19JAN 08:24», «19JAN 08:24 (Dep)» o «19/01/2026 08:24» → { fecha, conAnio } o null. */
    function leerHora(texto, anio) {
        const limpio = String(texto || '').split('(')[0].trim();
        let m = /^(\d{1,2})\s*([A-Za-z]{3})\s+(\d{1,2}):(\d{2})/.exec(limpio);
        if (m) {
            const mes = MESES[m[2].toUpperCase()];
            if (mes === undefined) return null;
            return { fecha: new Date(anio, mes, +m[1], +m[3], +m[4], 0), conAnio: false };
        }
        m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(limpio);
        if (m) return { fecha: new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], 0), conAnio: true };
        return null;
    }

    /** Del Routing, la otra punta: en la salida, a dónde va; en la llegada, de dónde viene. */
    function otraPunta(routing, tipo) {
        const partes = String(routing || '').split('-').map(x => x.trim().toUpperCase()).filter(Boolean);
        if (!partes.length) return '';
        const i = partes.findIndex(x => AIFA.includes(x));
        if (i === -1) return tipo === 'DEP' ? (partes[1] || partes[0]) : partes[0];
        return tipo === 'DEP' ? (partes[i + 1] || '') : (partes[i - 1] || '');
    }

    /**
     * Lee el archivo y junta los tramos de la semana [inicio, fin] por ruta y
     * aerolínea. Devuelve { mapa, resumen, total } o { error }.
     */
    function leerVisits(texto, inicio, fin) {
        const filas = parsearCSV(texto);
        if (filas.length < 2) return { error: 'El archivo parece estar vacío o inválido.' };
        const h = filas[0].map(x => String(x).trim());
        const col = {
            depRouting: h.findIndex(x => x.includes('[Dep] Routing')),
            arrRouting: h.findIndex(x => x.includes('[Arr] Routing')),
            routing: h.findIndex(x => x === 'Routing'),
            depAirline: h.findIndex(x => x.includes('[Dep] Airline code')),
            arrAirline: h.findIndex(x => x.includes('[Arr] Airline code')),
            depFlight: h.findIndex(x => x.includes('[Dep] Flight Designator')),
            arrFlight: h.findIndex(x => x.includes('[Arr] Flight Designator')),
            sobt: h.findIndex(x => x.includes('[Dep] SOBT')),
            sibt: h.findIndex(x => x.includes('[Arr] SIBT')),
        };
        if (col.depRouting === -1 && col.arrRouting === -1 && col.routing === -1) {
            return { error: 'No se encontraron columnas de Routing ([Dep] Routing, [Arr] Routing o Routing).' };
        }
        if (col.sobt === -1 && col.sibt === -1) return { error: 'No se encontraron las columnas de hora ([Dep] SOBT o [Arr] SIBT).' };

        const resumen = { visitas: 0, salidas: 0, llegadas: 0, fueraDeSemana: 0, sinDatos: 0, horaIlegible: 0, repetidos: 0, ejemplos: [] };
        const mapa = new Map();
        const tramo = (routing, aerolineaRaw, vueloRaw, horaRaw, tipo) => {
            const vuelo = String(vueloRaw || '').trim();
            const hora = String(horaRaw || '').trim();
            if (!vuelo && !hora) return;                         // la visita no trae este tramo
            const ruta = otraPunta(routing, tipo);
            if (!vuelo || !hora || !ruta || AIFA.includes(ruta)) { resumen.sinDatos++; return; }
            const leida = leerHora(hora, inicio.getFullYear());
            if (!leida) {
                resumen.horaIlegible++;
                if (resumen.ejemplos.length < 3) resumen.ejemplos.push(hora);
                return;
            }
            let fecha = leida.fecha;
            const enSemana = f => f >= inicio && f <= fin;
            if (!enSemana(fecha) && !leida.conAnio) {
                // «19JAN» no trae año: una semana que cruza el año puede ser del siguiente o del anterior.
                const otra = [1, -1].map(d => { const f = new Date(fecha); f.setFullYear(fecha.getFullYear() + d); return f; }).find(enSemana);
                if (otra) fecha = otra;
            }
            if (!enSemana(fecha)) { resumen.fueraDeSemana++; return; }
            const aerolinea = String(aerolineaRaw || '').trim() || 'UNK';
            const clave = ruta + '-' + aerolinea;
            if (!mapa.has(clave)) mapa.set(clave, { route: ruta, airline: aerolinea, count: 0, salidas: 0, llegadas: 0, flights: [] });
            const e = mapa.get(clave);
            const vueloDir = vuelo.replace(/\s+/g, '') + ' (' + (tipo === 'DEP' ? 'Sal' : 'Lleg') + ')';
            if (e.flights.some(f => f.flight === vueloDir && f.fullDate.getTime() === fecha.getTime())) { resumen.repetidos++; return; }
            e.flights.push({ fullDate: fecha, sobt: hora.split('(')[0].trim(), flight: vueloDir });
            e.count++;
            if (tipo === 'DEP') { e.salidas++; resumen.salidas++; } else { e.llegadas++; resumen.llegadas++; }
        };
        const depVuelo = col.depFlight !== -1 ? col.depFlight : col.depAirline;
        const arrVuelo = col.arrFlight !== -1 ? col.arrFlight : col.arrAirline;
        for (let i = 1; i < filas.length; i++) {
            const c = filas[i];
            const v = k => (k >= 0 && k < c.length ? c[k] : '');   // filas cortas: lo que falta, vacío
            resumen.visitas++;
            if (col.sobt !== -1) tramo(col.depRouting !== -1 ? v(col.depRouting) : v(col.routing), v(col.depAirline), v(depVuelo), v(col.sobt), 'DEP');
            if (col.sibt !== -1) tramo(col.arrRouting !== -1 ? v(col.arrRouting) : v(col.routing), v(col.arrAirline), v(arrVuelo), v(col.sibt), 'ARR');
        }
        return { mapa, resumen, total: resumen.salidas + resumen.llegadas };
    }

    /** El resumen en palabras, para cuadrar contra el Excel. */
    function textoResumen(r) {
        const partes = [r.visitas + ' visitas leídas: ' + r.salidas + ' salidas (frecuencias) y ' + r.llegadas + ' llegadas de la semana.'];
        if (r.fueraDeSemana) partes.push(r.fueraDeSemana + ' tramos eran de otras fechas.');
        if (r.sinDatos) partes.push(r.sinDatos + ' tramos sin ruta, vuelo u hora.');
        if (r.horaIlegible) partes.push(r.horaIlegible + ' tramos con una hora que no se entendió (ej. «' + r.ejemplos.join('», «') + '»).');
        if (r.repetidos) partes.push(r.repetidos + ' tramos repetidos no se contaron dos veces.');
        return partes.join(' ');
    }

    const api = { separador, parsearCSV, leerHora, otraPunta, leerVisits, textoResumen };
    if (typeof window !== 'undefined') window.FrecuenciasVisits = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const btnProcess = document.getElementById('btn-process-frecuencias');
    if (!btnProcess) return;
    const inputDate = document.getElementById('frecuencias-week-start');
    const typeSelect = document.getElementById('frecuencias-type-select');
    const labelWeek = document.getElementById('frecuencias-week-display');
    const modalDetalle = new bootstrap.Modal(document.getElementById('modalFrecuenciasDetalle'));

    // Init Date Picker with Today
    const today = new Date();
    // Set to previous Monday technically preferred, but let's just use today for now or empty
    inputDate.valueAsDate = today; 
    updateWeekLabel();

    inputDate.addEventListener('change', updateWeekLabel);

    async function enforceTorreonNationalForWeek(supabase, weekLabel) {
        // Defensive fix: if TRC is generated in weekly_frequencies_int, move it
        // into weekly_frequencies for the same week.
        const { data: trcIntRows, error: trcIntError } = await supabase
            .from('weekly_frequencies_int')
            .select('id,week_label,valid_from,valid_to,route_id,city,state,iata,airline,logo,color,monday,monday_detail,tuesday,tuesday_detail,wednesday,wednesday_detail,thursday,thursday_detail,friday,friday_detail,saturday,saturday_detail,sunday,sunday_detail,weekly_total')
            .eq('week_label', weekLabel)
            .or('iata.eq.TRC,city.ilike.%torreon%,city.ilike.%torreón%');

        if (trcIntError) throw new Error('Error leyendo TRC de internacionales: ' + trcIntError.message);
        if (!Array.isArray(trcIntRows) || trcIntRows.length === 0) return { moved: 0, deleted: 0 };

        const { data: trcNacRows, error: trcNacError } = await supabase
            .from('weekly_frequencies')
            .select('week_label,valid_from,iata,airline')
            .eq('week_label', weekLabel)
            .eq('iata', 'TRC');

        if (trcNacError) throw new Error('Error leyendo TRC de nacionales: ' + trcNacError.message);

        const existing = new Set((trcNacRows || []).map(r => {
            return `${r.week_label}|${r.valid_from}|${(r.iata || '').toUpperCase()}|${(r.airline || '').toLowerCase()}`;
        }));

        const toInsert = trcIntRows
            .map(r => ({
                week_label: r.week_label,
                valid_from: r.valid_from,
                valid_to: r.valid_to,
                route_id: r.route_id,
                city: r.city,
                state: (!r.state || String(r.state).trim().toLowerCase() === 'mexico') ? 'Coahuila' : r.state,
                iata: 'TRC',
                airline: r.airline,
                logo: r.logo,
                color: r.color,
                monday: r.monday,
                monday_detail: r.monday_detail,
                tuesday: r.tuesday,
                tuesday_detail: r.tuesday_detail,
                wednesday: r.wednesday,
                wednesday_detail: r.wednesday_detail,
                thursday: r.thursday,
                thursday_detail: r.thursday_detail,
                friday: r.friday,
                friday_detail: r.friday_detail,
                saturday: r.saturday,
                saturday_detail: r.saturday_detail,
                sunday: r.sunday,
                sunday_detail: r.sunday_detail,
                weekly_total: r.weekly_total
            }))
            .filter(r => {
                const key = `${r.week_label}|${r.valid_from}|${(r.iata || '').toUpperCase()}|${(r.airline || '').toLowerCase()}`;
                return !existing.has(key);
            });

        if (toInsert.length > 0) {
            const { error: insertError } = await supabase.from('weekly_frequencies').insert(toInsert);
            if (insertError) throw new Error('Error insertando TRC en nacionales: ' + insertError.message);
        }

        const idsToDelete = trcIntRows.map(r => r.id).filter(Boolean);
        if (idsToDelete.length > 0) {
            const { error: deleteError } = await supabase
                .from('weekly_frequencies_int')
                .delete()
                .in('id', idsToDelete);
            if (deleteError) throw new Error('Error eliminando TRC de internacionales: ' + deleteError.message);
        }

        return { moved: toInsert.length, deleted: idsToDelete.length };
    }

    function updateWeekLabel() {
        if (!inputDate.value) {
            labelWeek.textContent = '-';
            return;
        }
        const start = new Date(inputDate.value + 'T00:00:00'); // Fix TZ issues
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        
        const format = (d) => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
        labelWeek.textContent = `${format(start)} al ${format(end)}`;
    }

    btnProcess.addEventListener('click', async () => {
        const fileInput = document.getElementById('frecuencias-csv-file');
        const errorDiv = document.getElementById('frecuencias-upload-error');
        const resultsDiv = document.getElementById('frecuencias-upload-results');
        const tbody = document.getElementById('tbody-frecuencias-upload');
        const totalBadge = document.getElementById('total-ops-badge');
        
        // Disable button while processing
        btnProcess.disabled = true;
        btnProcess.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Procesando...';

        errorDiv.classList.add('d-none');
        resultsDiv.classList.add('d-none');
        tbody.innerHTML = '';
        totalBadge.textContent = '0 Operaciones';

        if (!fileInput.files.length) {
            showError('Por favor selecciona un archivo CSV.');
            resetButton();
            return;
        }
        if (!inputDate.value) {
            showError('Por favor selecciona la fecha de inicio de la semana.');
            resetButton();
            return;
        }

        const supabase = window.supabaseClient;
        if (!supabase) {
             showError('Error: Cliente Supabase no inicializado. Recarga la página.');
             resetButton();
             return;
        }

        try {
            const file = fileInput.files[0];
        const text = await file.text();

        const startDate = new Date(inputDate.value + 'T00:00:00');
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);

        const lectura = window.FrecuenciasVisits.leerVisits(text, startDate, endDate);
        if (lectura.error) {
            showError(lectura.error);
            resetButton();
            return;
        }
        const dataMap = lectura.mapa;       // Ruta|Aerolínea -> { route, airline, salidas, llegadas, flights }
        const totalCount = lectura.total;
        const resumenLectura = lectura.resumen;
        pintarResumenLectura(resumenLectura);

        // --- SUPABASE INTEGRATION START ---
        
        // 1. Prepare Data for Insertion
        const dbRows = [];
        // Format Week Label: "DD Month YYYY" to match existing style roughly, or use our helper
        // The SQL function takes p_week_label which we should construct consistently.
        // Let's use the format displayed in the UI: "08-14 Enero 2026"
        const weekLabel = labelWeek.textContent; 
        
        // Flatten the map to flights
        for (const item of dataMap.values()) {
            for (const f of item.flights) {
                dbRows.push({
                    week_label: weekLabel,
                    route_code: item.route,
                    airline_code: item.airline,
                    flight_number: f.flight,
                    flight_date: f.fullDate.toISOString() // UTC format
                });
            }
        }

        if (dbRows.length > 0) {
            // 2. Delete existing detailed records for this WEEK RANGE and TYPE to avoid duplication/stale data
            // We use Date Range delete instead of just Label to ensure we clean up any overlapping mess
            const isoStart = startDate.toISOString();
            const isoEnd = endDate.toISOString();
            
            // Determine type code ('P' for passenger/default, 'C' for cargo)
            let typeCode = 'P';
            if (typeSelect.value === 'cargo') typeCode = 'C';

            // Delete overlap for this specific type
            const { error: deleteError } = await supabase
                .from('weekly_flights_detailed')
                .delete()
                .gte('flight_date', isoStart)
                .lte('flight_date', isoEnd)
                .eq('operation_type', typeCode); // Only clean relevant type

            if (deleteError) {
                console.error('Delete error', deleteError);
                throw new Error('Error limpiando datos anteriores: ' + deleteError.message);
            }

            // 3. Insert new records (Batched if necessary, Supabase handles fairly large batches usually)
            // Add type code to rows
            dbRows.forEach(row => row.operation_type = typeCode);

            const { error: insertError } = await supabase
                .from('weekly_flights_detailed')
                .insert(dbRows);

            if (insertError) {
                console.error('Insert error', insertError);
                throw new Error('Error guardando vuelos detallados: ' + insertError.message);
            }

            if (typeSelect.value === 'cargo') {
                // 4. Call RPC Cargo
                const { error: rpcCargoError } = await supabase.rpc('generate_weekly_frequencies_cargo', {
                    p_week_label: weekLabel,
                    p_start_date: startDate.toISOString().split('T')[0],
                    p_end_date: endDate.toISOString().split('T')[0]
                });
                
                if (rpcCargoError) {
                    console.error('RPC Cargo error', rpcCargoError);
                    throw new Error('Error generando reporte de frecuencias (Carga): ' + rpcCargoError.message);
                }
                showSuccess(`Se guardaron ${resumenLectura.salidas} frecuencias (${totalCount} operaciones). Se actualizaron frecuencias de Carga.`);
            } else {
                // 4. Call RPC to regenerate summary (NATIONAL)
                const { error: rpcError } = await supabase.rpc('generate_weekly_frequencies', {
                    p_week_label: weekLabel,
                    p_start_date: startDate.toISOString().split('T')[0],
                    p_end_date: endDate.toISOString().split('T')[0]
                });

                if (rpcError) {
                    console.error('RPC error', rpcError);
                    throw new Error('Error generando reporte de frecuencias (Nacional): ' + rpcError.message);
                }

                // 5. Call RPC to regenerate summary (INTERNATIONAL)
                const { error: rpcIntError } = await supabase.rpc('generate_weekly_frequencies_int', {
                    p_week_label: weekLabel,
                    p_start_date: startDate.toISOString().split('T')[0],
                    p_end_date: endDate.toISOString().split('T')[0]
                });

                if (rpcIntError) {
                    console.error('RPC Int error', rpcIntError);
                    throw new Error('Error generando reporte de frecuencias (Internacional): ' + rpcIntError.message);
                }

                // Final safeguard: TRC/Torreón must remain in national routes.
                const trcFix = await enforceTorreonNationalForWeek(supabase, weekLabel);
                
                let fixMsg = '';
                if (trcFix && (trcFix.moved > 0 || trcFix.deleted > 0)) {
                    fixMsg = ` Ajuste aplicado: TRC movido a nacionales (${trcFix.moved} insertados, ${trcFix.deleted} eliminados de internacionales).`;
                }
                showSuccess(`Se guardaron ${resumenLectura.salidas} frecuencias (${totalCount} operaciones). Se actualizaron frecuencias Nacionales e Internacionales.${fixMsg}`);
            }
        } else {
            showSuccess('No se encontraron vuelos válidos en el rango de fechas seleccionado.');
        }

        // --- SUPABASE INTEGRATION END ---

        // Render Local Preview (Still keep this for immediate feedback)
        const sortedKeys = Array.from(dataMap.keys()).sort();

        
        // Helper to get airline logo and color
        const getAirlineStyle = (airlineCode) => {
             // Map code to key in standard config
             const code = airlineCode.toUpperCase();
             let key = 'default';
             if (code === 'VB') key = 'viva';
             if (code === 'AM') key = 'aeromexico';
             if (code === 'Y4') key = 'volaris';
             if (code === 'XN') key = 'mexicana';
             if (code === 'G3') key = 'gol'; // If exists?
             if (code === 'CM') key = 'copa';
             if (code === 'AV') key = 'avianca';
             if (code === 'V0') key = 'conviasa';
             if (code === 'DM') key = 'arajet';
             if (code === 'UJ') key = 'magnicharters';
             if (code === 'ZV') key = 'aerus';

             // Fallback config if not using the full global config object yet
             const config = {
                'aeromexico': { logo: 'logo_aeromexico.png', color: '#0b2161', bg: '#0b2161', text: '#ffffff' },
                'volaris': { logo: 'logo_volaris.png', color: '#a300e6', bg: '#a300e6', text: '#ffffff' },
                'viva': { logo: 'logo_viva.png', color: '#00a850', bg: '#ffffff', text: '#00a850', border: '1px solid #00a850' }, // Viva often white bg with green text/logo
                'mexicana': { logo: 'logo_mexicana.png', color: '#008375', bg: '#008375', text: '#ffffff' },
                'copa': { logo: 'logo_copa.png', color: '#00529b', bg: '#00529b', text: '#ffffff' },
                'arajet': { logo: 'logo_arajet.png', color: '#632683', bg: '#632683', text: '#ffffff' },
                'conviasa': { logo: 'logo_conviasa.png', color: '#e65300', bg: '#e65300', text: '#ffffff' },
                'magnicharters': { logo: 'logo_magnicharters.png', color: '#1d3c6e', bg: '#1d3c6e', text: '#ffffff' },
                'aerus': { logo: 'logo_aerus.png', color: '#bed62f', bg: '#bed62f', text: '#000000' },
                'default': { logo: null, color: '#6c757d', bg: '#f8f9fa', text: '#212529' }
             };
             
             return config[key] || config['default'];
        };

        sortedKeys.forEach(key => {
            const item = dataMap.get(key);
            // Sort flights by date
            item.flights.sort((a,b) => a.fullDate - b.fullDate);
            
            // Resolve City Name via rudimentary map or assume Code is acceptable for preview
            // Ideally we fetch from DB, but for this preview we use a small static map or just the code if missing
            // User requested: "escribas ya el nombre Tijuana... columna City"
            // Since this is client-side preview, I will add a small map here. 
            // The DB Automation I wrote DOES do this correctly for the final table.
            const cityMap = {
                'TIJ': 'Tijuana', 'HMO': 'Hermosillo', 'CJS': 'Ciudad Juárez', 'CEN': 'Ciudad Obregón',
                'CUU': 'Chihuahua', 'NLD': 'Nuevo Laredo', 'REX': 'Reynosa', 'LAP': 'La Paz',
                'CUL': 'Culiacán', 'DGO': 'Durango', 'MZT': 'Mazatlán', 'PVR': 'Puerto Vallarta',
                'GDL': 'Guadalajara', 'MTY': 'Monterrey', 'CUN': 'Cancún', 'MID': 'Mérida',
                'VER': 'Veracruz', 'ACA': 'Acapulco', 'OAX': 'Oaxaca', 'HUX': 'Huatulco',
                'PXM': 'Puerto Escondido', 'SJD': 'San José del Cabo', 'ZCL': 'Zacatecas',
                'TAM': 'Tampico', 'VSA': 'Villahermosa', 'TGZ': 'Tuxtla Gutiérrez', 'CPE': 'Campeche',
                'CTM': 'Chetumal', 'TLC': 'Toluca', 'BJX': 'León/Bajío', 'AGU': 'Aguascalientes',
                'SLP': 'San Luis Potosí', 'QRO': 'Querétaro', 'MLM': 'Morelia', 'ZIH': 'Ixtapa Zihuatanejo',
                'TAP': 'Tapachula', 'MXL': 'Mexicali', 'TPQ': 'Tepic', 'UPN': 'Uruapan', 'PQM': 'Palenque'
            };
            const cityName = cityMap[item.route] || item.route;

            const style = getAirlineStyle(item.airline);
            const logoHtml = style.logo 
                ? `<img src="images/airlines/${style.logo}" alt="${item.airline}" style="height: 24px; object-fit: contain; margin-right: 8px;">` 
                : `<i class="fas fa-plane me-2"></i>`;
            
            // Badge Style
            const badgeStyle = `background-color: ${style.bg}; color: ${style.text}; ${style.border ? 'border:'+style.border : ''}`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="fw-bold">${cityName}</div>
                    <div class="small text-muted">${item.route}</div>
                </td>
                <td>
                    <div class="d-flex align-items-center p-2 rounded" style="${badgeStyle}">
                        <div class="bg-white rounded px-1 me-2" style="height:28px; display:flex; align-items:center;">
                           ${logoHtml} 
                        </div>
                        <span class="fw-bold">${item.airline}</span>
                    </div>
                </td>
                <td class="text-center"><div class="fw-bold fs-5">${item.salidas}</div><div class="small text-muted">${item.llegadas} llegadas</div></td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary btn-details" data-key="${key}">
                        <i class="fas fa-list me-1"></i> Ver Vuelos
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        totalBadge.textContent = `${resumenLectura.salidas} frecuencias · ${totalCount} operaciones`;
        resultsDiv.classList.remove('d-none');

        // Wiring buttons
        document.querySelectorAll('.btn-details').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.key;
                const item = dataMap.get(key);
                showModal(item);
            });
        });
        
        resetButton();
        } catch (err) {
            console.error(err);
            showError(err.message || 'Error desconocido al procesar el archivo.');
            resetButton();
        }
    });

    function pintarResumenLectura(resumen) {
        const results = document.getElementById('frecuencias-upload-results');
        if (!results) return;
        let caja = document.getElementById('frecuencias-upload-resumen');
        if (!caja) {
            caja = document.createElement('div');
            caja.id = 'frecuencias-upload-resumen';
            caja.className = 'alert alert-light border small mb-3';
            results.insertBefore(caja, results.firstChild);
        }
        const hayFaltantes = resumen.fueraDeSemana || resumen.sinDatos || resumen.horaIlegible;
        caja.className = 'alert small mb-3 border ' + (resumen.sinDatos || resumen.horaIlegible ? 'alert-warning' : 'alert-light');
        caja.innerHTML = '<i class="fas fa-clipboard-check me-2"></i><b>Para cuadrar con el Excel:</b> ' +
            window.FrecuenciasVisits.textoResumen(resumen).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
            (hayFaltantes ? '' : ' Todo lo del archivo entró.') +
            '<div class="text-muted mt-1">Cada día cuenta las salidas (frecuencias); el detalle de cada celda muestra la salida y la llegada.</div>';
    }

    function resetButton() {
        const btnProcess = document.getElementById('btn-process-frecuencias');
        btnProcess.disabled = false;
        btnProcess.innerHTML = '<i class="fas fa-cog me-1"></i> Procesar';
    }

    function showSuccess(msg) {
         const errorDiv = document.getElementById('frecuencias-upload-error');
         errorDiv.textContent = msg;
         errorDiv.classList.remove('d-none', 'alert-danger');
         errorDiv.classList.add('alert-success');
         // Auto hide after 5s
         setTimeout(() => {
             errorDiv.classList.add('d-none');
             errorDiv.classList.remove('alert-success');
             errorDiv.classList.add('alert-danger'); // Reset for next error
         }, 5000);
    }

    function showError(msg) {
        const errorDiv = document.getElementById('frecuencias-upload-error');
        errorDiv.textContent = msg;
        errorDiv.classList.remove('d-none');
    }

    function showModal(item) {
        document.getElementById('modal-route-title').textContent = `${item.route} - ${item.airline}`;
        const tbody = document.getElementById('tbody-frecuencias-detalle');
        tbody.innerHTML = '';
        item.flights.forEach(f => {
            const tr = document.createElement('tr');
            // Format nice date
            const niceDate = f.fullDate.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
            const niceTime = f.fullDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute:'2-digit' });
            
            tr.innerHTML = `
                <td>${niceDate}</td>
                <td>${niceTime}</td>
                <td>${f.flight}</td>
                <td>${item.airline}</td> 
            `;
            tbody.appendChild(tr);
        });
        modalDetalle.show();
    }
});
