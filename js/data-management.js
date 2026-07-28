class DataManagement {
    constructor() {
        this.client = window.supabaseClient; // Initialize Supabase Client
        this.airlineConfig = {
            'aeromexico': { logo: 'logo_aeromexico.png', color: '#0b2161', text: '#ffffff' },
            'volaris': { logo: 'logo_volaris.png', color: '#a300e6', text: '#ffffff' },
            'viva-aerobus': { logo: 'logo_viva.png', color: '#00a850', text: '#ffffff' },
            'viva': { logo: 'logo_viva.png', color: '#00a850', text: '#ffffff' },
            'mexicana': { logo: 'logo_mexicana.png', color: '#008375', text: '#ffffff' },
            'copa-airlines': { logo: 'logo_copa.png', color: '#00529b', text: '#ffffff' },
            'arajet': { logo: 'logo_arajet.png', color: '#632683', text: '#ffffff' },
            'conviasa': { logo: 'logo_conviasa.png', color: '#e65300', text: '#ffffff' },
            'magnicharters': { logo: 'logo_magnicharters.png', color: '#1d3c6e', text: '#ffffff' },
            'aerus': { logo: 'logo_aerus.png', color: '#bed62f', text: '#000000' },

            // Cargo & International
            'estafeta': { logo: 'logo_estafeta.jpg', color: '#c41230', text: '#ffffff' },
            'ups': { logo: 'logo_united_parcel_service.png', color: '#351c15', text: '#ffffff' },
            'united-parcel-service': { logo: 'logo_united_parcel_service.png', color: '#351c15', text: '#ffffff' },
            'fedex': { logo: 'logo_fedex_express.png', color: '#4d148c', text: '#ffffff' },
            'dhl': { logo: 'logo_dhl_guatemala_.png', color: '#d40511', text: '#ffffff' },
            'mas': { logo: 'logo_mas.png', color: '#00a550', text: '#ffffff' },
            'mas-air': { logo: 'logo_mas.png', color: '#00a550', text: '#ffffff' },
            'air-canada': { logo: 'logo_air_canada_.png', color: '#ef3340', text: '#ffffff' },
            'air-france': { logo: 'logo_air_france_.png', color: '#00266e', text: '#ffffff' },
            'air-china': { logo: 'logo_air_china.png', color: '#ff0000', text: '#ffffff' },
            'china-southern': { logo: 'logo_china_southern.png', color: '#002a5c', text: '#ffffff' },
            'qatar': { logo: 'logo_qatar.png', color: '#5b0e2d', text: '#ffffff' },
            'turkish': { logo: 'logo_turkish_airlines.png', color: '#c8102e', text: '#ffffff' },
            'lufthansa': { logo: 'logo_lufthansa.png', color: '#05164d', text: '#ffffff' },
            'emirates': { logo: 'logo_emirates_airlines.png', color: '#d71920', text: '#ffffff' },
            'cargojet': { logo: 'logo_cargojet.png', color: '#000000', text: '#ffffff' },
            'atlas': { logo: 'logo_atlas_air.png', color: '#003366', text: '#ffffff' },
            'atlas-air': { logo: 'logo_atlas_air.png', color: '#003366', text: '#ffffff' },
            'kalitta': { logo: 'logo_kalitta_air.jpg', color: '#cf0a2c', text: '#ffffff' },
            'national': { logo: 'logo_national_airlines_cargo.png', color: '#001f3f', text: '#ffffff' },
            'tsm': { logo: 'logo_tsm_airlines.png', color: '#000000', text: '#ffffff' },
            'aerounion': { logo: 'logo_aero_union.png', color: '#00529b', text: '#ffffff' },
            'aero-union': { logo: 'logo_aero_union.png', color: '#00529b', text: '#ffffff' },
            'cargolux': { logo: 'logo_cargolux.png', color: '#00a0dc', text: '#ffffff' },
            'cathay': { logo: 'logo_cathay_pacific.png', color: '#006564', text: '#ffffff' },
            'cathay-pacific': { logo: 'logo_cathay_pacific.png', color: '#006564', text: '#ffffff' },
            'suparna': { logo: 'logo_suparna.png', color: '#b22222', text: '#ffffff' },
            'awesome': { logo: 'logo_awesome_cargo.png', color: '#000000', text: '#ffffff' },

            'default': { logo: null, color: '#ffffff', text: '#212529' }
        };
        this.isEditMode = false;
        this.currentDailyData = []; // Store raw data for edits
        // Date-filter state for the main-page Llegadas / Salidas tables
        this.dailyDateState = {
            arrival:   { mode: 'rel', active: false, dateFrom: null, dateTo: null },
            departure: { mode: 'rel', active: false, dateFrom: null, dateTo: null }
        };
        this.routeLaunchEvents = [];
        this.routeLaunchModal = null;

        this.schemas = {
            operations_summary: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: 'Enero', label: 'Enero' }, { value: 'Febrero', label: 'Febrero' }, { value: 'Marzo', label: 'Marzo' },
                        { value: 'Abril', label: 'Abril' }, { value: 'Mayo', label: 'Mayo' }, { value: 'Junio', label: 'Junio' },
                        { value: 'Julio', label: 'Julio' }, { value: 'Agosto', label: 'Agosto' }, { value: 'Septiembre', label: 'Septiembre' },
                        { value: 'Octubre', label: 'Octubre' }, { value: 'Noviembre', label: 'Noviembre' }, { value: 'Diciembre', label: 'Diciembre' }
                    ]
                },
                {
                    name: 'category', label: 'Categoría', type: 'select', options: [
                        { value: 'Pasajeros', label: 'Pasajeros' },
                        { value: 'Operaciones', label: 'Operaciones' },
                        { value: 'Carga', label: 'Carga' }
                    ]
                },
                { name: 'metric', label: 'Métrica', type: 'text' },
                { name: 'value', label: 'Valor', type: 'number' }
            ],
            daily_operations: [
                { name: 'date', label: 'Fecha', type: 'date' },
                { name: 'comercial_ops', label: 'Comercial - Operaciones', type: 'number' },
                { name: 'comercial_pax', label: 'Comercial - Pasajeros', type: 'number' },
                { name: 'general_ops', label: 'General - Operaciones', type: 'number' },
                { name: 'general_pax', label: 'General - Pasajeros', type: 'number' },
                { name: 'carga_ops', label: 'Carga - Operaciones', type: 'number' },
                { name: 'carga_tons', label: 'Carga - Toneladas', type: 'number', step: '0.01' }
            ],

            // Monthly operations (per month per year)
            monthly_operations: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: '01', label: 'Enero' }, { value: '02', label: 'Febrero' }, { value: '03', label: 'Marzo' },
                        { value: '04', label: 'Abril' }, { value: '05', label: 'Mayo' }, { value: '06', label: 'Junio' },
                        { value: '07', label: 'Julio' }, { value: '08', label: 'Agosto' }, { value: '09', label: 'Septiembre' },
                        { value: '10', label: 'Octubre' }, { value: '11', label: 'Noviembre' }, { value: '12', label: 'Diciembre' }
                    ]
                },
                { name: 'comercial_ops', label: 'Comercial - Operaciones', type: 'number' },
                { name: 'comercial_pax', label: 'Comercial - Pasajeros', type: 'number' },
                { name: 'general_ops', label: 'General - Operaciones', type: 'number' },
                { name: 'general_pax', label: 'General - Pasajeros', type: 'number' },
                { name: 'carga_ops', label: 'Carga - Operaciones', type: 'number' },
                { name: 'carga_tons', label: 'Carga - Toneladas', type: 'number', step: '0.01' },
                { name: 'is_official', label: 'Cifras Oficiales (desmarcar si son preliminares)', type: 'checkbox' }
            ],
            // Annual aggregated operations (calculated from monthly)
            annual_operations: [
                { name: 'year', label: 'Año', type: 'number' },
                { name: 'comercial_ops_total', label: 'Comercial - Operaciones (Total)', type: 'number' },
                { name: 'comercial_pax_total', label: 'Comercial - Pasajeros (Total)', type: 'number' },
                { name: 'general_ops_total', label: 'General - Operaciones (Total)', type: 'number' },
                { name: 'general_pax_total', label: 'General - Pasajeros (Total)', type: 'number' },
                { name: 'carga_ops_total', label: 'Carga - Operaciones (Total)', type: 'number' },
                { name: 'carga_tons_total', label: 'Carga - Toneladas (Total)', type: 'number', step: '0.01' }
            ],
            punctuality_stats: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: '1', label: 'Enero' }, { value: '2', label: 'Febrero' }, { value: '3', label: 'Marzo' },
                        { value: '4', label: 'Abril' }, { value: '5', label: 'Mayo' }, { value: '6', label: 'Junio' },
                        { value: '7', label: 'Julio' }, { value: '8', label: 'Agosto' }, { value: '9', label: 'Septiembre' },
                        { value: '10', label: 'Octubre' }, { value: '11', label: 'Noviembre' }, { value: '12', label: 'Diciembre' }
                    ]
                },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                {
                    name: 'category', label: 'Categoría', type: 'select', options: [
                        { value: 'Pasajeros', label: 'Pasajeros' },
                        { value: 'Carga', label: 'Carga' }
                    ]
                },
                { name: 'on_time', label: 'A Tiempo', type: 'number' },
                { name: 'delayed', label: 'Demorados', type: 'number' },
                { name: 'cancelled', label: 'Cancelados', type: 'number' },
                { name: 'total_flights', label: 'Total Vuelos', type: 'number' }
            ],
            flight_itinerary: [
                { name: 'flight_number', label: 'No. Vuelo', type: 'text' },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                { name: 'origin_destination', label: 'Origen/Destino', type: 'text' },
                { name: 'arrival_date', label: 'Fecha', type: 'date' },
                { name: 'arrival_time', label: 'Hora', type: 'time' },
                {
                    name: 'status', label: 'Estado', type: 'select', options: [
                        { value: 'Programado', label: 'Programado' },
                        { value: 'Aterrizó', label: 'Aterrizó' },
                        { value: 'Demorado', label: 'Demorado' },
                        { value: 'Cancelado', label: 'Cancelado' }
                    ]
                },
                { name: 'gate', label: 'Puerta', type: 'text' },
                { name: 'terminal', label: 'Terminal', type: 'text' }
            ],
            wildlife_strikes: [
                { name: 'date', label: 'Fecha del Evento', type: 'date' },
                { name: 'time', label: 'Hora del Evento', type: 'time' },
                { name: 'location', label: 'Ubicación General', type: 'text', placeholder: 'Ej. Aproximación Pista 04C' },
                { name: 'impact_zone', label: 'Zona de Impacto (Aeronave)', type: 'text', placeholder: 'Ej. Radomo, Motor 1, Ala derecha' },
                { name: 'operation_phase', label: 'Fase de la Operación', type: 'text', placeholder: 'Ej. Aterrizaje, Despegue, Rodaje' },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                { name: 'aircraft', label: 'Tipo de Aeronave', type: 'text', placeholder: 'Ej. B737-800' },
                { name: 'registration', label: 'Matrícula', type: 'text' },
                { name: 'impact_zone_remains', label: 'Zona de Hallazgo de Restos', type: 'text', placeholder: 'Ej. Pista 04C cerca de calle Bravo' },
                { name: 'remains_count', label: 'Cantidad de Restos', type: 'number' },
                {
                    name: 'size', label: 'Tamaño de la Fauna', type: 'select', options: [
                        { value: 'Pequeño', label: 'Pequeño' },
                        { value: 'Mediano', label: 'Mediano' },
                        { value: 'Grande', label: 'Grande' }
                    ]
                },
                { name: 'species', label: 'Especie (Científico)', type: 'text', placeholder: 'Ej. Quiscalus mexicanus' },
                { name: 'common_name', label: 'Nombre Común', type: 'text', placeholder: 'Ej. Zanate' },
                { name: 'reporter', label: 'Personal que reporta', type: 'text' },
                { name: 'proactive_measures', label: 'Medidas Proactivas Previas', type: 'textarea', placeholder: 'Descripción de medidas tomadas antes del evento' },
                { name: 'weather_conditions', label: 'Condiciones Meteorológicas', type: 'text', placeholder: 'Ej. Nublado, Lluvia ligera' },
                { name: 'measure_results', label: 'Resultados de las Medidas', type: 'textarea' }
            ],
            rescued_wildlife: [
                { name: 'date', label: 'Fecha de Captura', type: 'date' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: 'Enero', label: 'Enero' }, { value: 'Febrero', label: 'Febrero' }, { value: 'Marzo', label: 'Marzo' },
                        { value: 'Abril', label: 'Abril' }, { value: 'Mayo', label: 'Mayo' }, { value: 'Junio', label: 'Junio' },
                        { value: 'Julio', label: 'Julio' }, { value: 'Agosto', label: 'Agosto' }, { value: 'Septiembre', label: 'Septiembre' },
                        { value: 'Octubre', label: 'Octubre' }, { value: 'Noviembre', label: 'Noviembre' }, { value: 'Diciembre', label: 'Diciembre' }
                    ]
                },
                { name: 'time', label: 'Hora', type: 'time' },
                { name: 'capture_number', label: 'No. Captura', type: 'text', placeholder: 'Ej. GSO-2025-001' },
                { name: 'common_name', label: 'Nombre Común', type: 'text', placeholder: 'Ej. Tlacuache' },
                { name: 'scientific_name', label: 'Nombre Científico', type: 'text', placeholder: 'Ej. Didelphis marsupialis' },
                { 
                    name: 'class', label: 'Clase', type: 'select', 
                    options: [
                        { value: 'Aves', label: 'Aves' },
                        { value: 'Mamíferos', label: 'Mamíferos' },
                        { value: 'Reptiles', label: 'Reptiles' },
                        { value: 'Anfibios', label: 'Anfibios' },
                        { value: 'Insectos', label: 'Insectos' }
                    ]
                },
                { name: 'quantity', label: 'No. Individuos', type: 'number' },
                { name: 'capture_method', label: 'Método de Captura', type: 'text', placeholder: 'Ej. Trampa Tomahawk, Manual, Red' },
                { name: 'quadrant', label: 'Cuadrante', type: 'text', placeholder: 'Ej. 14A' },
                { 
                    name: 'final_disposition', label: 'Disposición Final', type: 'select',
                    options: [
                        { value: 'Liberación', label: 'Liberación' },
                        { value: 'Traslado', label: 'Traslado' },
                        { value: 'Eutanasia', label: 'Eutanasia' },
                        { value: 'Muerto', label: 'Encontrado Muerto' }
                    ] 
                }
            ],
            medical_attentions: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: 'Enero', label: 'Enero' }, { value: 'Febrero', label: 'Febrero' }, { value: 'Marzo', label: 'Marzo' },
                        { value: 'Abril', label: 'Abril' }, { value: 'Mayo', label: 'Mayo' }, { value: 'Junio', label: 'Junio' },
                        { value: 'Julio', label: 'Julio' }, { value: 'Agosto', label: 'Agosto' }, { value: 'Septiembre', label: 'Septiembre' },
                        { value: 'Octubre', label: 'Octubre' }, { value: 'Noviembre', label: 'Noviembre' }, { value: 'Diciembre', label: 'Diciembre' }
                    ]
                },
                { name: 'aifa_personnel', label: 'Personal AIFA', type: 'number', placeholder: 'Ej. 15', help: 'Número de atenciones a personal militar o civil del AIFA' },
                { name: 'other_companies', label: 'Otras Empresas', type: 'number', placeholder: 'Ej. 8', help: 'Atenciones a personal de aerolíneas, comercios, etc.' },
                { name: 'passengers', label: 'Pasajeros', type: 'number', placeholder: 'Ej. 45', help: 'Atenciones a usuarios/viajeros del aeropuerto' },
                { name: 'visitors', label: 'Visitantes', type: 'number', placeholder: 'Ej. 3', help: 'Atenciones a público general o visitantes externos' },
                { name: 'total', label: 'Total', type: 'number', readonly: true, help: 'Calculado automáticamente: Personal + Otros + Pasajeros + Visitantes' } 
            ],
            medical_types: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: 'Enero', label: 'Enero' }, { value: 'Febrero', label: 'Febrero' }, { value: 'Marzo', label: 'Marzo' },
                        { value: 'Abril', label: 'Abril' }, { value: 'Mayo', label: 'Mayo' }, { value: 'Junio', label: 'Junio' },
                        { value: 'Julio', label: 'Julio' }, { value: 'Agosto', label: 'Agosto' }, { value: 'Septiembre', label: 'Septiembre' },
                        { value: 'Octubre', label: 'Octubre' }, { value: 'Noviembre', label: 'Noviembre' }, { value: 'Diciembre', label: 'Diciembre' }
                    ]
                },
                { name: 'traslado', label: 'Traslado', type: 'number', placeholder: 'Ej. 5', help: 'Número de traslados a hospitales' },
                { name: 'ambulatorio', label: 'Ambulatorio', type: 'number', placeholder: 'Ej. 12', help: 'Atenciones en consultorio o sitio' },
                { name: 'total', label: 'Total', type: 'number', readonly: true, help: 'Calculado automáticamente: Traslado + Ambulatorio' }
            ],
            medical_directory: [
                { name: 'asunto', label: 'Asunto', type: 'text' },
                { name: 'responsable', label: 'Responsable', type: 'text' },
                { name: 'estado', label: 'Estado', type: 'number' },
                { name: 'documentos', label: 'Documentos', type: 'file', multiple: true }
            ],
            delays: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: 'Enero', label: 'Enero' }, { value: 'Febrero', label: 'Febrero' }, { value: 'Marzo', label: 'Marzo' },
                        { value: 'Abril', label: 'Abril' }, { value: 'Mayo', label: 'Mayo' }, { value: 'Junio', label: 'Junio' },
                        { value: 'Julio', label: 'Julio' }, { value: 'Agosto', label: 'Agosto' }, { value: 'Septiembre', label: 'Septiembre' },
                        { value: 'Octubre', label: 'Octubre' }, { value: 'Noviembre', label: 'Noviembre' }, { value: 'Diciembre', label: 'Diciembre' }
                    ]
                },
                { name: 'cause', label: 'Causa', type: 'text' },
                { name: 'count', label: 'Cantidad', type: 'number' },
                { name: 'description', label: 'Descripción', type: 'textarea' },
                { name: 'observations', label: 'Observaciones', type: 'textarea' }
            ],
            weekly_frequencies: [
                { name: 'week_label', label: 'Etiqueta Semana (ej. 08-14 Dic 2025)', type: 'text' },
                { name: 'valid_from', label: 'Válido Desde', type: 'date' },
                { name: 'valid_to', label: 'Válido Hasta', type: 'date' },
                { name: 'route_id', label: 'ID Ruta', type: 'number' },
                { name: 'city', label: 'Ciudad', type: 'text' },
                { name: 'state', label: 'Estado', type: 'text' },
                { name: 'iata', label: 'Código IATA', type: 'text' },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                { name: 'monday', label: 'Lunes', type: 'number' },
                { name: 'tuesday', label: 'Martes', type: 'number' },
                { name: 'wednesday', label: 'Miércoles', type: 'number' },
                { name: 'thursday', label: 'Jueves', type: 'number' },
                { name: 'friday', label: 'Viernes', type: 'number' },
                { name: 'saturday', label: 'Sábado', type: 'number' },
                { name: 'sunday', label: 'Domingo', type: 'number' },
                { name: 'weekly_total', label: 'Total Semanal', type: 'number', readonly: true }
            ],
            weekly_frequencies_int: [
                { name: 'week_label', label: 'Etiqueta Semana (ej. 08-14 Dic 2025)', type: 'text' },
                { name: 'valid_from', label: 'Válido Desde', type: 'date' },
                { name: 'valid_to', label: 'Válido Hasta', type: 'date' },
                { name: 'route_id', label: 'ID Ruta', type: 'number' },
                { name: 'city', label: 'Ciudad / País', type: 'text' },
                { name: 'state', label: 'Región', type: 'text' },
                { name: 'iata', label: 'Código IATA', type: 'text' },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                { name: 'monday', label: 'Lunes', type: 'number' },
                { name: 'tuesday', label: 'Martes', type: 'number' },
                { name: 'wednesday', label: 'Miércoles', type: 'number' },
                { name: 'thursday', label: 'Jueves', type: 'number' },
                { name: 'friday', label: 'Viernes', type: 'number' },
                { name: 'saturday', label: 'Sábado', type: 'number' },
                { name: 'sunday', label: 'Domingo', type: 'number' },
                { name: 'weekly_total', label: 'Total Semanal', type: 'number', readonly: true }
            ],
            weekly_frequencies_cargo: [
                { name: 'week_label', label: 'Etiqueta Semana (ej. 08-14 Dic 2025)', type: 'text' },
                { name: 'valid_from', label: 'Válido Desde', type: 'date' },
                { name: 'valid_to', label: 'Válido Hasta', type: 'date' },
                { name: 'route_id', label: 'ID Ruta', type: 'number' },
                { name: 'city', label: 'Ciudad / País', type: 'text' },
                { name: 'state', label: 'Región', type: 'text' },
                { name: 'iata', label: 'Código IATA', type: 'text' },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                { name: 'monday', label: 'Lunes', type: 'number' },
                { name: 'tuesday', label: 'Martes', type: 'number' },
                { name: 'wednesday', label: 'Miércoles', type: 'number' },
                { name: 'thursday', label: 'Jueves', type: 'number' },
                { name: 'friday', label: 'Viernes', type: 'number' },
                { name: 'saturday', label: 'Sábado', type: 'number' },
                { name: 'sunday', label: 'Domingo', type: 'number' },
                { name: 'weekly_total', label: 'Total Semanal', type: 'number', readonly: true }
            ],
            punctuality_stats: [
                { name: 'year', label: 'Año', type: 'number' },
                {
                    name: 'month', label: 'Mes', type: 'select', options: [
                        { value: '1', label: 'Enero' }, { value: '2', label: 'Febrero' }, { value: '3', label: 'Marzo' },
                        { value: '4', label: 'Abril' }, { value: '5', label: 'Mayo' }, { value: '6', label: 'Junio' },
                        { value: '7', label: 'Julio' }, { value: '8', label: 'Agosto' }, { value: '9', label: 'Septiembre' },
                        { value: '10', label: 'Octubre' }, { value: '11', label: 'Noviembre' }, { value: '12', label: 'Diciembre' }
                    ]
                },
                { name: 'airline', label: 'Aerolínea', type: 'select', options: [] }, // Populated dynamically
                {
                    name: 'category', label: 'Categoría', type: 'select', options: [
                        { value: 'Pasajeros', label: 'Pasajeros' },
                        { value: 'Carga', label: 'Carga' }
                    ]
                },
                { name: 'on_time', label: 'A Tiempo', type: 'number' },
                { name: 'delayed', label: 'Demorados', type: 'number' },
                { name: 'cancelled', label: 'Cancelados', type: 'number' },
                { name: 'total_flights', label: 'Total Vuelos', type: 'number', readonly: true }
            ],
            flight_itinerary: [
                { name: 'flight_number', label: 'No. Vuelo', type: 'text' },
                { name: 'airline', label: 'Aerolínea', type: 'text' },
                { name: 'origin_destination', label: 'Origen/Destino', type: 'text' },
                { name: 'arrival_date', label: 'Fecha', type: 'date' },
                { name: 'arrival_time', label: 'Hora', type: 'time' },
                {
                    name: 'status', label: 'Estado', type: 'select', options: [
                        { value: 'Programado', label: 'Programado' },
                        { value: 'Aterrizó', label: 'Aterrizó' },
                        { value: 'Demorado', label: 'Demorado' },
                        { value: 'Cancelado', label: 'Cancelado' }
                    ]
                },
                { name: 'gate', label: 'Puerta', type: 'text' },
                { name: 'terminal', label: 'Terminal', type: 'text' }
            ],
            rescued_wildlife: [
                { name: 'date', label: 'Fecha', type: 'date' },
                { name: 'time', label: 'Hora', type: 'time' },
                { name: 'capture_number', label: 'No. Captura', type: 'number' },
                { name: 'class', label: 'Clase', type: 'text' },
                { name: 'common_name', label: 'Nombre común', type: 'text' },
                { name: 'scientific_name', label: 'Nombre científico', type: 'text' },
                { name: 'quantity', label: 'No. Individuos', type: 'number' },
                { name: 'capture_method', label: 'Método de captura', type: 'text' },
                { name: 'quadrant', label: 'Cuadrante', type: 'text' },
                { name: 'final_disposition', label: 'Disposición final', type: 'text' }
            ],
            daily_flights_ops: [
                { name: 'fecha', label: 'Fecha', type: 'date' },
                { name: 'seq_no', label: 'No.', type: 'number' },
                { name: 'aerolinea', label: 'Aerolínea', type: 'text' },
                { name: 'vuelo_llegada', label: 'Vuelo Arr', type: 'text' },
                { name: 'origen', label: 'Origen', type: 'text' },
                { name: 'fecha_hora_prog_llegada', label: 'H. Prog Arr', type: 'text' },
                { name: 'fecha_hora_real_llegada', label: 'H. Real Arr', type: 'text' },
                { name: 'pasajeros_llegada', label: 'Pax Arr', type: 'number' },
                { name: 'vuelo_salida', label: 'Vuelo Dep', type: 'text' },
                { name: 'destino', label: 'Destino', type: 'text' },
                { name: 'fecha_hora_prog_salida', label: 'H. Prog Dep', type: 'text' },
                { name: 'fecha_hora_real_salida', label: 'H. Real Dep', type: 'text' },
                { name: 'pasajeros_salida', label: 'Pax Dep', type: 'number' },
                { name: 'matricula', label: 'Matrícula', type: 'text' }
            ],
            library_categories: [
                { name: 'title', label: 'Título del Cuadro', type: 'text' },
                { name: 'description', label: 'Descripción', type: 'textarea' },
                { name: 'icon', label: 'Icono (Visual)', type: 'icon', placeholder: 'fas fa-book' },
                { name: 'order_index', label: 'Orden', type: 'number' }
            ],
            library_items: [
                { name: 'category_id', label: 'Cuadro / Categoría', type: 'select', options: [] },
                { name: 'title', label: 'Título del ítem', type: 'text' },
                {
                    name: 'type', label: 'Tipo', type: 'select', options: [
                        { value: 'pdf', label: 'Archivo PDF' },
                        { value: 'excel', label: 'Excel' },
                        { value: 'word', label: 'Word' },
                        { value: 'link', label: 'Enlace Externo' },
                        { value: 'info', label: 'Informativo (Texto)' }
                    ]
                },
                { name: 'url', label: 'URL / Enlace (Manual)', type: 'text' },
                { name: 'documentos', label: 'Archivos Adjuntos', type: 'file', multiple: true },
                { name: 'description', label: 'Contenido / Info', type: 'textarea' },
                { name: 'order_index', label: 'Orden', type: 'number' }
            ],
            system_alerts: [
                { name: 'title', label: 'Título del Aviso', type: 'text', placeholder: 'Ej. Cierre de Pista' },
                { name: 'message', label: 'Mensaje Detallado', type: 'textarea', placeholder: 'Detalles del aviso o alerta...' },
                {
                    name: 'level', label: 'Nivel (Semáforo)', type: 'select', options: [
                        { value: 'info', label: 'Informativo (Verde)' },
                        { value: 'warning', label: 'Precaución (Amarillo)' },
                        { value: 'critical', label: 'Crítico (Rojo)' }
                    ]
                },
                { name: 'active', label: 'Activo', type: 'select', options: [{ value: true, label: 'Sí' }, { value: false, label: 'No' }] },
                { name: 'expires_at', label: 'Expira (Opcional)', type: 'date' }
            ],
        };

        this.airlineCatalog = [];
        this.loadAirlineCatalog();
        this.init();
    }

    async loadAirlineCatalog() {
        try {
            const response = await fetch('data/master/airlines.csv');
            const text = await response.text();
            // Parse CSV: IATA,ICAO,Name
            const lines = text.split('\n').slice(1); // Skip header
            this.airlineCatalog = lines
                .map(line => {
                    // Simple CSV split (assuming no commas in fields for now)
                    const parts = line.split(',');
                    if (parts.length >= 3) {
                        return {
                            iata: parts[0].trim(),
                            icao: parts[1].trim(),
                            name: parts[2].trim()
                        };
                    }
                    return null;
                })
                .filter(item => item && item.name)
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) {
            console.error('Failed to load airline catalog:', e);
        }
    }

    // Formatea fechas ISO (YYYY-MM-DD) a formato largo (27 de Diciembre de 2025)
    formatDisplayDate(value) {
        if (!value) return '';
        const s = String(value).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (m) {
            const [, yyyy, mm, dd] = m;
            const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            const monthName = months[parseInt(mm, 10) - 1];
            return `${parseInt(dd, 10)} de ${monthName} de ${yyyy}`;
        }
        return s;
    }

    slugify(text) {
        return text.toString().toLowerCase()
            .replace(/\s+/g, '-')           // Replace spaces with -
            .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
            .replace(/\-\-+/g, '-')         // Replace multiple - with single -
            .replace(/^-+/, '')             // Trim - from start
            .replace(/-+$/, '');            // Trim - from end
    }

    // Formatea números con separadores de miles (ej. 21323 -> 21,323)
    formatNumber(value, colName) {
        if (value == null || value === '') value = 0;
        const n = Number(value);
        if (!Number.isFinite(n)) return String(value);

        // Decide decimales según la columna
        let options = {};
        if (colName === 'carga_tons') {
            options = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
        }
        // Use en-US to produce commas as thousands separators
        try {
            return n.toLocaleString('en-US', options);
        } catch (e) {
            return String(value);
        }
    }

    init() {
        // Listen for tab changes to load data
        const tabEls = document.querySelectorAll('button[data-bs-toggle="tab"], button[data-bs-toggle="pill"]');
        tabEls.forEach(tabEl => {
            tabEl.addEventListener('shown.bs.tab', event => {
                const targetId = event.target.getAttribute('data-bs-target');
                this.loadTabContent(targetId);

                // Hide sidebar on selection if screen is not extra large (or always as requested)
                hideDmSidebar();
            });
        });

        // Listen for filter changes
        // document.getElementById('filter-ops-year').addEventListener('change', () => this.loadOperationsSummary());
        document.getElementById('filter-daily-ops-date').addEventListener('change', () => this.loadDailyOperations());
        const monthEl = document.getElementById('filter-daily-ops-month');
        if (monthEl) monthEl.addEventListener('change', () => this.loadDailyOperations());
        // Category filter removed — no listener required
        document.getElementById('filter-itinerary-date').addEventListener('change', () => this.loadItinerary());

        // Medical Filters
        const medYear = document.getElementById('filter-medical-year');
        if (medYear) medYear.addEventListener('change', () => this.loadMedicalAttentions());

        const medTypeYear = document.getElementById('filter-medical-types-year');
        if (medTypeYear) medTypeYear.addEventListener('change', () => this.loadMedicalTypes());

        document.getElementById('filter-delays-year').addEventListener('change', () => this.loadDelays());
        document.getElementById('filter-delays-month').addEventListener('change', () => this.loadDelays());

        const puncYear = document.getElementById('filter-punctuality-year');
        if (puncYear) puncYear.addEventListener('change', () => this.loadPunctualityStats());

        const puncMonth = document.getElementById('filter-punctuality-month');
        if (puncMonth) puncMonth.addEventListener('change', () => this.loadPunctualityStats());

        const weeklyFreqLabel = document.getElementById('filter-weekly-freq-label');
        if (weeklyFreqLabel) weeklyFreqLabel.addEventListener('change', () => this.loadWeeklyFrequencies());

        const weeklyFreqIntLabel = document.getElementById('filter-weekly-freq-int-label');
        if (weeklyFreqIntLabel) weeklyFreqIntLabel.addEventListener('change', () => this.loadWeeklyFrequenciesInt());
        const weeklyFreqIntAirline = document.getElementById('filter-weekly-freq-int-airline');
        if (weeklyFreqIntAirline) weeklyFreqIntAirline.addEventListener('change', () => this.loadWeeklyFrequenciesInt());

        const weeklyFreqCargoLabel = document.getElementById('filter-weekly-freq-cargo-label');
        if (weeklyFreqCargoLabel) weeklyFreqCargoLabel.addEventListener('change', () => this.loadWeeklyFrequenciesCargo());
        const weeklyFreqCargoAirline = document.getElementById('filter-weekly-freq-cargo-airline');
        if (weeklyFreqCargoAirline) weeklyFreqCargoAirline.addEventListener('change', () => this.loadWeeklyFrequenciesCargo());

        // Monthly / Annual UI listeners
        const monthlyYearSel = document.getElementById('monthly-ops-year');
        if (monthlyYearSel) monthlyYearSel.addEventListener('change', () => this.loadMonthlyOperations());
        const monthlyAddBtn = document.getElementById('monthly-ops-add');
        if (monthlyAddBtn) monthlyAddBtn.addEventListener('click', () => this.addItem('monthly_operations'));
        const annualRefreshBtn = document.getElementById('annual-ops-refresh');
        if (annualRefreshBtn) annualRefreshBtn.addEventListener('click', () => this.loadAnnualOperations());

        // Listen for data updates to refresh tables
        window.addEventListener('data-updated', (e) => {
            // Refresh the current active tab or specific table
            // For simplicity, reload the relevant table based on the table name
            const table = e.detail.table;
            if (table === 'operations_summary') this.loadOperationsSummary();
            if (table === 'daily_operations') this.loadDailyOperations();
            if (table === 'flight_itinerary') this.loadItinerary();
            if (table === 'wildlife_strikes') this.loadWildlifeStrikes();
            if (table === 'rescued_wildlife') this.loadRescuedWildlife();
            if (table === 'daily_flights_ops') this.loadDailyFlightsOps();
            if (table === 'medical_attentions') this.loadMedicalAttentions();
            if (table === 'medical_types') this.loadMedicalTypes();
            if (table === 'medical_directory') this.loadMedicalDirectory();
            if (table === 'delays') this.loadDelays();
            if (table === 'punctuality_stats') this.loadPunctualityStats();
            if (table === 'weekly_frequencies') this.loadWeeklyFrequencies();
            if (table === 'weekly_frequencies_int') this.loadWeeklyFrequenciesInt();
            if (table === 'weekly_frequencies_cargo') this.loadWeeklyFrequenciesCargo();

            if (table === 'monthly_operations') {
                this.loadMonthlyOperations();
                this.updateAnnualDataAndCharts();
            }
            if (table === 'annual_operations') {
                this.loadAnnualOperations();
                this.syncChartsData();
            }
            if (table === 'library_categories' || table === 'library_items') {
                this.loadLibraryCategories();
                this.loadLibraryItems();
            }
            if (table === 'system_alerts') {
                this.loadSystemAlertsTable();
            }
        });

        // Initial load if section is active (or just load the first tab)
        // this.loadOperationsSummary();
        this.loadMonthlyOperations();
        this.loadAnnualOperations();
        this.syncChartsData();
        this.setupGlobalRefresh();
        this.initColumnVisibility();

        if (document.getElementById('route-launch-month')) {
            this.loadRouteLaunchCalendar();
        }
    }

    setupGlobalRefresh() {
        const btn = document.getElementById('btn-global-refresh');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            // Animation
            const icon = btn.querySelector('i');
            if (icon) icon.classList.add('fa-spin');

            try {
                // 1. Refresh Data Management Tab if active
                const activeTab = document.querySelector('.tab-pane.active');
                if (activeTab) {
                    const tabId = '#' + activeTab.id;
                    console.log('Refreshing tab:', tabId);
                    await this.loadTabContent(tabId);
                }

                const refreshPromises = [];

                // 2. Refresh Main Dashboard Data (if functions are available)
                if (typeof window.refreshOperationsCardsData === 'function') {
                    refreshPromises.push(window.refreshOperationsCardsData());
                } else if (typeof window.loadWeeklyOperationsFromDB === 'function') {
                    refreshPromises.push(window.loadWeeklyOperationsFromDB());
                }

                // Refresh Frequencies (National & International)
                if (typeof window.reloadFrecuenciasNational === 'function') {
                    console.log('Reloading National Frequencies...');
                    refreshPromises.push(window.reloadFrecuenciasNational());
                }
                if (typeof window.reloadFrecuenciasInt === 'function') {
                    console.log('Reloading International Frequencies...');
                    refreshPromises.push(window.reloadFrecuenciasInt());
                }
                
                await Promise.all(refreshPromises);

                // Refresh Demoras if active
                if (typeof window.ensureDemorasState === 'function') {
                    // Force re-fetch? demoras module might need a 'force' flag
                    // We can try dispatching an event that demoras.js listens to?
                    // Or access the internal loader if exposed. 
                    // Actually, let's just use the data-updated event which triggers most loaders
                    window.dispatchEvent(new CustomEvent('data-updated', { detail: { table: 'all' } }));
                }

            } catch (err) {
                console.error('Error refreshing data:', err);
            } finally {
                // Stop animation
                setTimeout(() => {
                    if (icon) icon.classList.remove('fa-spin');
                }, 800);
            }
        });
    }

    loadTabContent(targetId) {
        if (targetId === '#pane-ops-summary') {
            this.loadOperationsSummary();
            // Load the monthly/annual tables when showing the summary pane
            this.loadMonthlyOperations();
            this.loadAnnualOperations();
        }
        if (targetId === '#pane-daily-ops') {
            // Daily operations only
            this.loadDailyOperations();
        }
        if (targetId === '#pane-itinerary') this.loadItinerary();
        if (targetId === '#pane-wildlife') this.loadWildlifeStrikes();
        if (targetId === '#pane-rescued-wildlife') this.loadRescuedWildlife();
        if (targetId === '#pane-daily-flights-ops') this.loadDailyFlightsOps();
        if (targetId === '#pane-medical') {
            this.loadMedicalAttentions();
            this.loadMedicalTypes();
            this.loadMedicalDirectory();
        }
        if (targetId === '#pane-medical-attentions') this.loadMedicalAttentions();
        if (targetId === '#pane-medical-types') this.loadMedicalTypes();
        if (targetId === '#pane-medical-directory') this.loadMedicalDirectory();

        if (targetId === '#pane-delays') this.loadDelays();
        if (targetId === '#pane-punctuality-table') this.loadPunctualityStats();
        if (targetId === '#pane-weekly-frequencies') {
            this.loadWeeklyFrequencies();
            this.loadRouteLaunchCalendar();
        }
        if (targetId === '#pane-weekly-frequencies-int') this.loadWeeklyFrequenciesInt();
        if (targetId === '#pane-weekly-frequencies-cargo') this.loadWeeklyFrequenciesCargo();
        if (targetId === '#pane-weekly-frequencies-playas') this.loadWeeklyFrequenciesPlayas();
        if (targetId === '#pane-library') {
            this.loadLibraryCategories();
            this.loadLibraryItems();
        }
        if (targetId === '#pane-alerts') {
            this.loadSystemAlertsTable();
        }
        if (targetId === '#pane-aerolineas') {
            alLoad();
        }
    }



    async loadOperationsSummary() {
        // const year = document.getElementById('filter-ops-year').value;
        try {
            const data = await window.dataManager.getOperationsSummary();
            this.renderTable('table-ops-summary', data, ['year', 'month', 'category', 'metric', 'value'], 'operations_summary');
        } catch (error) {
            console.error('Error loading operations summary:', error);
        }
    }

    async loadDailyOperations() {
        try {
            const data = await window.dataManager.getDailyOperations();
            const dateFilter = document.getElementById('filter-daily-ops-date').value;
            const monthFilter = (document.getElementById('filter-daily-ops-month') || {}).value || '';
            let filteredData = data;
            if (dateFilter) {
                // Exact date selected (YYYY-MM-DD)
                filteredData = data.filter(item => item.date === dateFilter);
            } else if (monthFilter) {
                // Filter by month (MM)
                filteredData = data.filter(item => {
                    if (!item || !item.date) return false;
                    const m = String(item.date).slice(5, 7);
                    return m === monthFilter;
                });
            }
            // Category filtering removed — show all rows matching date/month filters

            // Custom render for complex columns
            const tbody = document.querySelector('#table-daily-ops tbody');
            tbody.innerHTML = '';

            filteredData.forEach(item => {
                const tr = document.createElement('tr');

                // Date
                const tdDate = document.createElement('td');
                tdDate.className = 'text-center';
                tdDate.textContent = this.formatDisplayDate(item.date);
                tr.appendChild(tdDate);

                // Commercial
                const tdCom = document.createElement('td');
                tdCom.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-primary fw-bold">Ops:</span> ${this.formatNumber(item.comercial_ops, 'comercial_ops')}<br><small class="text-muted"><span class="text-primary">Pax:</span> ${this.formatNumber(item.comercial_pax, 'comercial_pax')}</small></div></div>`;
                tr.appendChild(tdCom);

                // General
                const tdGen = document.createElement('td');
                tdGen.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-success fw-bold">Ops:</span> ${this.formatNumber(item.general_ops, 'general_ops')}<br><small class="text-muted"><span class="text-success">Pax:</span> ${this.formatNumber(item.general_pax, 'general_pax')}</small></div></div>`;
                tr.appendChild(tdGen);

                // Cargo
                const tdCargo = document.createElement('td');
                tdCargo.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-warning fw-bold">Ops:</span> ${this.formatNumber(item.carga_ops, 'carga_ops')}<br><small class="text-muted"><span class="text-warning">Ton:</span> ${this.formatNumber(item.carga_tons, 'carga_tons')}</small></div></div>`;
                tr.appendChild(tdCargo);

                // Actions
                const tdActions = document.createElement('td');
                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                btnEdit.onclick = () => this.editItem('daily_operations', item);
                tdActions.appendChild(btnEdit);

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn btn-sm btn-outline-danger';
                btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                btnDelete.onclick = () => this.deleteItem('daily_operations', item.date);
                tdActions.appendChild(btnDelete);

                tr.appendChild(tdActions);
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error('Error loading daily operations:', error);
        }
    }

    async loadItinerary() {
        // Note: getFlightItinerary currently fetches all, might need date filter in DataManager
        // For now, we'll filter client side or update DataManager later
        try {
            const data = await window.dataManager.getFlightItinerary();
            const dateFilter = document.getElementById('filter-itinerary-date').value;
            let filteredData = data;
            if (dateFilter) {
                filteredData = data.filter(item => item.arrival_date === dateFilter);
            }
            
            // --- Deduplication Logic (User Request) ---
            // "si un numero de vuelo es el mismo, tiene la misma hora programada... y el origen o el destino igual, no repitas esos vuelos"
            // We use a Set to track seen combinations of Flight Number + Time + Location
            const seenFlights = new Set();
            const uniqueData = [];

            filteredData.forEach(item => {
                // Handle potential different property names (view vs table)
                const fNum = item.flight_number || item.arrival_flight || item.departure_flight || item.vuelo || '';
                const time = item.arrival_time || item.departure_time || item.hora || '';
                // For location, we might have origin_destination or separated fields
                const loc = item.origin_destination || item.origin || item.destination || '';
                
                // Create unique key
                const key = `${fNum}|${time}|${loc}`;
                
                if (!seenFlights.has(key)) {
                    seenFlights.add(key);
                    uniqueData.push(item);
                }
            });
            filteredData = uniqueData;

            this.renderTable('table-itinerary', filteredData, ['flight_number', 'airline', 'origin_destination', 'arrival_time', 'status'], 'flight_itinerary');
            this._buildItineraryDaySummary(data);
        } catch (error) {
            console.error('Error loading itinerary:', error);
        }
    }

    _buildItineraryDaySummary(allData) {
        const grid = document.getElementById('itinerary-days-grid');
        if (!grid) return;
        if (!allData || allData.length === 0) {
            grid.innerHTML = '<p class="text-muted small mb-0">No hay datos cargados.</p>';
            return;
        }
        const activeDate = (document.getElementById('filter-itinerary-date') || {}).value || '';
        const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        // Group by arrival_date
        const counts = {};
        allData.forEach(row => {
            const d = row.arrival_date || '';
            if (d) counts[d] = (counts[d] || 0) + 1;
        });
        const sortedDates = Object.keys(counts).sort();
        let html = '<div class="d-flex flex-wrap gap-2 align-items-start">';
        // TODOS chip
        html += `<button class="btn btn-sm ${activeDate ? 'btn-outline-secondary' : 'btn-primary'} py-1 it-day-chip"
            data-date="" style="min-width:80px;text-align:center;border-radius:10px">
            <div style="font-size:.68rem;opacity:.7;letter-spacing:.05em">TODOS</div>
            <div style="font-size:1.15rem;font-weight:800;line-height:1.1">${allData.length}</div>
            <div style="font-size:.7rem">vuelos</div></button>`;
        sortedDates.forEach(iso => {
            const d = new Date(iso + 'T00:00:00');
            const day = String(d.getDate()).padStart(2, '0');
            const mon = MONTHS[d.getMonth()];
            const cnt = counts[iso];
            const isActive = iso === activeDate;
            html += `<button class="btn btn-sm ${isActive ? 'btn-primary shadow' : 'btn-outline-primary'} py-1 it-day-chip"
                data-date="${iso}" style="min-width:90px;text-align:center;border-radius:10px"
                title="${cnt} vuelos el ${iso}">
                <div style="font-size:.68rem;text-transform:uppercase;opacity:.7;letter-spacing:.05em">${mon}</div>
                <div style="font-size:1.4rem;font-weight:800;line-height:1.1">${day}</div>
                <div style="font-size:.75rem;font-weight:600">${cnt} <i class='fas fa-plane' style='font-size:.6rem'></i></div></button>`;
        });
        html += '</div>';
        grid.innerHTML = html;
        grid.querySelectorAll('.it-day-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const dateEl = document.getElementById('filter-itinerary-date');
                if (dateEl) dateEl.value = btn.dataset.date;
                this.loadItinerary();
            });
        });
    }

    async loadMonthlyOperations() {
        try {
            // 1. Get current selection
            const yearSel = document.getElementById('monthly-ops-year');
            const selectedYear = yearSel ? yearSel.value : '';

            // 2. Fetch ALL data to ensure we have all years for the dropdown
            const allData = await window.dataManager.getMonthlyOperations();

            // 3. Populate year select with available years from ALL data
            const years = Array.from(new Set((allData || []).map(r => String(r.year)))).sort((a, b) => Number(b) - Number(a));

            if (yearSel) {
                // Rebuild options
                yearSel.innerHTML = '';
                const optAll = document.createElement('option'); optAll.value = ''; optAll.innerText = 'Todos'; yearSel.appendChild(optAll);

                years.forEach(y => {
                    const opt = document.createElement('option');
                    opt.value = y;
                    opt.innerText = y;
                    yearSel.appendChild(opt);
                });

                // Restore selection if it still exists in the new list (or if it was empty/Todos)
                if (selectedYear && years.includes(selectedYear)) {
                    yearSel.value = selectedYear;
                } else if (selectedYear === '') {
                    yearSel.value = '';
                }
            }

            // 4. Filter data for display based on selection
            let displayData = allData;
            if (selectedYear) {
                displayData = allData.filter(d => String(d.year) === selectedYear);
            }

            // Sort by Year Descending, then Month Ascending (Jan -> Dec)
            displayData.sort((a, b) => {
                const yearDiff = Number(b.year) - Number(a.year);
                if (yearDiff !== 0) return yearDiff;
                return Number(a.month) - Number(b.month);
            });

            // 5. Render table
            const tbody = document.querySelector('#table-monthly-ops tbody');
            tbody.innerHTML = '';

            displayData.forEach(item => {
                const tr = document.createElement('tr');

                // Year
                const tdYear = document.createElement('td');
                tdYear.className = 'text-center';
                tdYear.textContent = item.year;
                tr.appendChild(tdYear);

                // Month
                const tdMonth = document.createElement('td');
                tdMonth.className = 'text-center';
                // Map numeric month to name
                let displayMonth = item.month;
                // Ensure two-digit string for mapping
                const monthKey = String(displayMonth).padStart(2, '0');
                const map = { '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre' };
                if (map[monthKey]) displayMonth = map[monthKey];
                tdMonth.textContent = displayMonth;
                tr.appendChild(tdMonth);

                // Comercial
                const tdCom = document.createElement('td');
                tdCom.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-primary fw-bold">Ops:</span> ${this.formatNumber(item.comercial_ops, 'comercial_ops')}<br><small class="text-muted"><span class="text-primary">Pax:</span> ${this.formatNumber(item.comercial_pax, 'comercial_pax')}</small></div></div>`;
                tr.appendChild(tdCom);

                // General
                const tdGen = document.createElement('td');
                tdGen.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-success fw-bold">Ops:</span> ${this.formatNumber(item.general_ops, 'general_ops')}<br><small class="text-muted"><span class="text-success">Pax:</span> ${this.formatNumber(item.general_pax, 'general_pax')}</small></div></div>`;
                tr.appendChild(tdGen);

                // Cargo
                const tdCargo = document.createElement('td');
                tdCargo.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-warning fw-bold">Ops:</span> ${this.formatNumber(item.carga_ops, 'carga_ops')}<br><small class="text-muted"><span class="text-warning">Ton:</span> ${this.formatNumber(item.carga_tons, 'carga_tons')}</small></div></div>`;
                tr.appendChild(tdCargo);

                // Actions
                const tdActions = document.createElement('td');
                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                btnEdit.onclick = () => this.editItem('monthly_operations', item);
                tdActions.appendChild(btnEdit);

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn btn-sm btn-outline-danger';
                btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                // Pass the whole item so we can determine ID or fallback to keys
                btnDelete.onclick = () => this.deleteItem('monthly_operations', item);
                tdActions.appendChild(btnDelete);

                tr.appendChild(tdActions);
                tbody.appendChild(tr);
            });

        } catch (err) {
            console.error('Error loading monthly operations:', err);
        }
    }

    async loadAnnualOperations() {
        try {
            // Prefer stored annual aggregates but also include aggregated monthly years
            const [monthly, annualRows] = await Promise.all([
                window.dataManager.getMonthlyOperations(),
                window.dataManager.getAnnualOperations()
            ]);

            const byYear = {};
            // Start from monthly aggregation (works if annual table missing years)
            (monthly || []).forEach(row => {
                const y = String(row.year || '');
                if (!byYear[y]) byYear[y] = { year: y, comercial_ops_total: 0, comercial_pax_total: 0, general_ops_total: 0, general_pax_total: 0, carga_ops_total: 0, carga_tons_total: 0 };
                byYear[y].comercial_ops_total += Number(row.comercial_ops) || 0;
                byYear[y].comercial_pax_total += Number(row.comercial_pax) || 0;
                byYear[y].general_ops_total += Number(row.general_ops) || 0;
                byYear[y].general_pax_total += Number(row.general_pax) || 0;
                byYear[y].carga_ops_total += Number(row.carga_ops) || 0;
                byYear[y].carga_tons_total += Number(row.carga_tons) || 0;
            });

            // Merge/override with explicit annual rows if present (these may be authoritative)
            (annualRows || []).forEach(r => {
                const y = String(r.year || '');
                byYear[y] = {
                    year: y,
                    comercial_ops_total: Number(r.comercial_ops_total) || 0,
                    comercial_pax_total: Number(r.comercial_pax_total) || 0,
                    general_ops_total: Number(r.general_ops_total) || 0,
                    general_pax_total: Number(r.general_pax_total) || 0,
                    carga_ops_total: Number(r.carga_ops_total) || 0,
                    carga_tons_total: Number(r.carga_tons_total) || 0
                };
            });

            const annualData = Object.values(byYear).sort((a, b) => Number(b.year) - Number(a.year));
            this.renderAnnualTableFromData(annualData);
        } catch (err) {
            console.error('Error loading annual operations:', err);
        }
    }

    renderAnnualTableFromData(annualData) {
        const tbody = document.querySelector('#table-annual-ops tbody');
        tbody.innerHTML = '';

        annualData.forEach(item => {
            const tr = document.createElement('tr');

            // Year
            const tdYear = document.createElement('td');
            tdYear.className = 'text-center';
            tdYear.textContent = item.year;
            tr.appendChild(tdYear);

            // Commercial
            const tdCom = document.createElement('td');
            tdCom.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-primary fw-bold">Ops:</span> ${this.formatNumber(item.comercial_ops_total, 'comercial_ops_total')}<br><small class="text-muted"><span class="text-primary">Pax:</span> ${this.formatNumber(item.comercial_pax_total, 'comercial_pax_total')}</small></div></div>`;
            tr.appendChild(tdCom);

            // General
            const tdGen = document.createElement('td');
            tdGen.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-success fw-bold">Ops:</span> ${this.formatNumber(item.general_ops_total, 'general_ops_total')}<br><small class="text-muted"><span class="text-success">Pax:</span> ${this.formatNumber(item.general_pax_total, 'general_pax_total')}</small></div></div>`;
            tr.appendChild(tdGen);

            // Cargo
            const tdCargo = document.createElement('td');
            tdCargo.innerHTML = `<div class="d-flex align-items-center justify-content-center gap-2"><div><span class="text-warning fw-bold">Ops:</span> ${this.formatNumber(item.carga_ops_total, 'carga_ops_total')}<br><small class="text-muted"><span class="text-warning">Ton:</span> ${this.formatNumber(item.carga_tons_total, 'carga_tons_total')}</small></div></div>`;
            tr.appendChild(tdCargo);

            // Actions
            const tdActions = document.createElement('td');
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
            btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
            btnEdit.onclick = () => this.editItem('annual_operations', item);
            tdActions.appendChild(btnEdit);

            const btnDelete = document.createElement('button');
            btnDelete.className = 'btn btn-sm btn-outline-danger';
            btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
            btnDelete.onclick = () => this.deleteItem('annual_operations', item.id);
            tdActions.appendChild(btnDelete);

            tr.appendChild(tdActions);
            tbody.appendChild(tr);
        });
    }

    async loadWildlifeStrikes() {
        try {
            // Standard loading for Data Management Tab
            const data = await window.dataManager.getWildlifeStrikes();
            this.wildlifeData = data || []; // Cache data for filtering
            this.filterWildlifeStrikes();
        } catch (error) {
            console.error('Error loading wildlife strikes:', error);
        }
    }

    filterWildlifeStrikes() {
        if (!this.wildlifeData) return;

        const inputs = document.querySelectorAll('#table-wildlife .filter-row input');
        
        const filtered = this.wildlifeData.filter(item => {
            let pass = true;
            inputs.forEach(input => {
                if (!pass) return;
                const searchVal = (input.value || '').toLowerCase();
                if (!searchVal) return; // ignore empty filter inputs

                const col = input.getAttribute('data-column');
                let itemVal = (item[col] || '');
                
                // Mapear campos si es necesario
                // La tabla usa columnas: date, time, species, location
                // item keys deberian coincidir, pero si no, ajustar aqui
                
                if (itemVal.toString().toLowerCase().indexOf(searchVal) === -1) {
                    pass = false;
                }
            });
            return pass;
        });

        this.renderTable('table-wildlife', filtered, ['date', 'time', 'species', 'location', 'common_name', 'action_taken'], 'wildlife_strikes');
    }

    async loadRescuedWildlife() {
        try {
            const data = await window.dataManager.getRescuedWildlife();
            this.rescuedData = data || []; // Cache data for filtering
            this.filterRescuedWildlife();
        } catch (error) {
            console.error('Error loading rescued wildlife:', error);
        }
    }

    filterRescuedWildlife() {
        if (!this.rescuedData) return;
        
        const inputs = document.querySelectorAll('#table-rescued-wildlife .filter-row input');

        const filtered = this.rescuedData.filter(item => {
            let pass = true;
            inputs.forEach(input => {
                if (!pass) return;
                const searchVal = (input.value || '').toLowerCase();
                if (!searchVal) return;

                const col = input.getAttribute('data-column');
                let itemVal = (item[col] || '');

                if (itemVal.toString().toLowerCase().indexOf(searchVal) === -1) {
                    pass = false;
                }
            });
            return pass;
        });

        this.renderTable('table-rescued-wildlife', filtered, ['date', 'time', 'common_name', 'class', 'final_disposition'], 'rescued_wildlife');
    }

    async loadDailyFlightsOps() {
        const tbodyArr = document.querySelector('#table-daily-flights-arrivals tbody');
        const tbodyDep = document.querySelector('#table-daily-flights-departures tbody');

        if (tbodyArr) tbodyArr.innerHTML = '<tr><td colspan="9" class="text-center py-4">Cargando...</td></tr>';
        if (tbodyDep) tbodyDep.innerHTML = '<tr><td colspan="9" class="text-center py-4">Cargando...</td></tr>';

        const filterDateEl = document.getElementById('filter-daily-flights-date');
        const filterDate = filterDateEl ? filterDateEl.value : null;

        try {
            const supabase = this.client || window.supabaseClient;
            if (!supabase) throw new Error("Cliente Supabase no inicializado");

            let query = supabase
                .from('vuelos_parte_operaciones')
                .select('*')
                .order('date', { ascending: false });

            if (filterDate) {
                query = query.eq('date', filterDate);
            } else {
                query = query.limit(20);
            }

            const { data: rows, error } = await query;
            if (error) throw error;

            let arrivals = [];
            let departures = [];

            if (rows && rows.length > 0) {
                rows.forEach(row => {
                    const dateStr = row.date;
                    if (Array.isArray(row.data)) {
                        row.data.forEach(op => {
                            const normalized = { ...op };

                            // Normalization
                            if (op['Hora programada_llegada']) normalized.fecha_hora_prog_llegada = op['Hora programada_llegada'];
                            if (op['Hora de salida_llegada']) normalized.fecha_hora_real_llegada = op['Hora de salida_llegada'];
                            if (op['Hora programada_salida']) normalized.fecha_hora_prog_salida = op['Hora programada_salida'];
                            if (op['Hora de salida_salida']) normalized.fecha_hora_real_salida = op['Hora de salida_salida'];

                            if (op['Vuelo de llegada']) normalized.vuelo_llegada = op['Vuelo de llegada'];
                            if (op['Vuelo de salida']) normalized.vuelo_salida = op['Vuelo de salida'];
                            if (op['Pasajeros llegada']) normalized.pasajeros_llegada = op['Pasajeros llegada'];
                            if (op['Pasajeros salida']) normalized.pasajeros_salida = op['Pasajeros salida'];
                            if (op['Matrícula']) normalized.matricula = op['Matrícula'];
                            if (op['Origen']) normalized.origen = op['Origen'];
                            if (op['Destino']) normalized.destino = op['Destino'];
                            if (op['aerolinea']) normalized.aerolinea = op['aerolinea'];

                            if (normalized.seq_no === undefined && normalized.no !== undefined) normalized.seq_no = normalized.no;

                            const baseOp = { ...normalized, fecha: dateStr };

                            if (baseOp.vuelo_llegada || baseOp.fecha_hora_prog_llegada) arrivals.push(baseOp);
                            if (baseOp.vuelo_salida || baseOp.fecha_hora_prog_salida) departures.push(baseOp);
                        });
                    }
                });
            }

            // Mantener el orden original del JSON (suele ser Pasajeros -> Carga -> General)
            // No ordenar por SEQ_NO porque reinicia en cada sección.
            // arrivals.sort(sorter);
            // departures.sort(sorter);

            this.renderDailyOpsFancy(arrivals, 'arrival', '#table-daily-flights-arrivals');
            this.renderDailyOpsFancy(departures, 'departure', '#table-daily-flights-departures');

        } catch (error) {
            console.error('Error loading daily flights ops:', error);
            if (tbodyArr) tbodyArr.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Error: ' + error.message + '</td></tr>';
            if (tbodyDep) tbodyDep.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Error: ' + error.message + '</td></tr>';
        }
    }

    toggleEditMode() {
        this.isEditMode = !this.isEditMode;

        const btnEdit = document.getElementById('btn-dm-toggle-edit');
        const btnSave = document.getElementById('btn-dm-save-edit');

        if (this.isEditMode) {
            if (btnEdit) {
                btnEdit.classList.remove('btn-outline-primary');
                btnEdit.classList.add('btn-primary');
                btnEdit.innerHTML = '<i class="fas fa-edit me-1"></i> Cancelar';
            }
            if (btnSave) btnSave.classList.remove('d-none');
        } else {
            if (btnEdit) {
                btnEdit.classList.add('btn-outline-primary');
                btnEdit.classList.remove('btn-primary');
                btnEdit.innerHTML = '<i class="fas fa-edit me-1"></i> Editar';
            }
            if (btnSave) btnSave.classList.add('d-none');
        }

        this.loadDailyFlightsOps();
    }

    async saveEditedData() {
        if (!confirm("¿Guardar cambios en Gestión de Datos?")) return;

        const inputs = document.querySelectorAll('.dm-input-edit');
        if (inputs.length === 0) {
            this.toggleEditMode();
            return;
        }

        // We need to group updates by Date because Supabase stores data per day row
        // Structure needed: Map<Date, ArrayOfFlights>

        // However, we don't have the full original array in memory easily unless we stored it.
        // We can fetch the specific days involved.

        try {
            const supabase = this.client || window.supabaseClient;

            // 1. Identify distinct dates being edited
            const distinctDates = new Set();
            inputs.forEach(input => {
                if (input.dataset.date) distinctDates.add(input.dataset.date);
            });

            for (const dateStr of distinctDates) {
                // Fetch current state from DB (to avoid overwriting concurrent changes or missing items)
                const { data: rowData, error: fetchErr } = await supabase
                    .from('vuelos_parte_operaciones')
                    .select('data')
                    .eq('date', dateStr)
                    .single();

                if (fetchErr) throw fetchErr;

                let flights = rowData.data || [];
                let modified = false;

                // Apply changes for this date
                const dateInputs = document.querySelectorAll(`.dm-input-edit[data-date="${dateStr}"]`);

                dateInputs.forEach(input => {
                    const seq = input.dataset.seq; // this is actually seq_no or 'no'
                    const field = input.dataset.field;
                    const rowType = input.dataset.rowType; // 'arrival' or 'departure'
                    // Handle numbers
                    let newVal = input.value;
                    if (input.type === 'number') newVal = newVal ? parseFloat(newVal) : 0;

                    // Find flight in array with Robust Logic (Seq + Type Check)
                    const fIndex = flights.findIndex(f => {
                        const matchesSeq = String(f.seq_no || f.no) === String(seq);
                        if (!matchesSeq) return false;

                        // If we have a rowType, try to disambiguate
                        if (rowType === 'arrival') {
                            // Valid if it looks like an arrival (has arrival flight or arrival time)
                            if (f.vuelo_llegada || f['Vuelo de llegada'] || f.fecha_hora_prog_llegada || f['Hora programada_llegada']) return true;
                            // Fallback: if it has NO departure info, assume it's arrival? Risk.
                            return false;
                        }
                        if (rowType === 'departure') {
                            if (f.vuelo_salida || f['Vuelo de salida'] || f.fecha_hora_prog_salida || f['Hora programada_salida']) return true;
                            return false;
                        }
                        return true; // No type info? match purely on seq
                    });

                    if (fIndex > -1) {
                        // Found flight
                        const oldFlightState = { ...flights[fIndex] }; // Clone for audit
                        flights[fIndex][field] = newVal;

                        // Special Handling: Synchronize redundant fields
                        // Ensure we update both "Normalized" and "Original" keys to handle casing/legacy quirks

                        // ARRIVAL ALIASES
                        if (field === 'vuelo_llegada') { flights[fIndex]['Vuelo de llegada'] = newVal; flights[fIndex]['vuelo_llegada'] = newVal; }
                        if (field === 'pasajeros_llegada') { flights[fIndex]['Pasajeros llegada'] = newVal; flights[fIndex]['pasajeros_llegada'] = newVal; }
                        if (field === 'fecha_hora_prog_llegada') { flights[fIndex]['Hora programada_llegada'] = newVal; flights[fIndex]['fecha_hora_prog_llegada'] = newVal; }
                        if (field === 'fecha_hora_real_llegada') { flights[fIndex]['Hora de salida_llegada'] = newVal; flights[fIndex]['fecha_hora_real_llegada'] = newVal; }
                        if (field === 'origen') { flights[fIndex]['Origen'] = newVal; flights[fIndex]['origen'] = newVal; }

                        // DEPARTURE ALIASES
                        if (field === 'vuelo_salida') { flights[fIndex]['Vuelo de salida'] = newVal; flights[fIndex]['vuelo_salida'] = newVal; }
                        if (field === 'pasajeros_salida') { flights[fIndex]['Pasajeros salida'] = newVal; flights[fIndex]['pasajeros_salida'] = newVal; }
                        if (field === 'matricula') { flights[fIndex]['Matrícula'] = newVal; flights[fIndex]['matricula'] = newVal; }
                        if (field === 'fecha_hora_prog_salida') { flights[fIndex]['Hora programada_salida'] = newVal; flights[fIndex]['fecha_hora_prog_salida'] = newVal; }
                        if (field === 'fecha_hora_real_salida') { flights[fIndex]['Hora de salida_salida'] = newVal; flights[fIndex]['fecha_hora_real_salida'] = newVal; }
                        if (field === 'destino') { flights[fIndex]['Destino'] = newVal; flights[fIndex]['destino'] = newVal; }

                        // Common
                        if (field === 'aerolinea') { flights[fIndex]['aerolinea'] = newVal; flights[fIndex]['Aerolinea'] = newVal; }

                        modified = true;

                        // Security Audit Log
                        if (typeof window.logHistory === 'function') {
                            window.logHistory('EDITAR', 'Vuelo Diario', `${dateStr} #${seq}`, {
                                old: oldFlightState,
                                new: flights[fIndex],
                                summary: `Edición de campo '${field}' en vuelo ${oldFlightState.vuelo_llegada || oldFlightState.vuelo_salida}`
                            });
                        }
                    } else {
                        console.warn(`Could not find flight for update: Date=${dateStr}, Seq=${seq}, Type=${rowType}`);
                    }
                });

                if (modified) {
                    const { error: updateErr } = await supabase
                        .from('vuelos_parte_operaciones')
                        .update({ data: flights })
                        .eq('date', dateStr);

                    if (updateErr) throw updateErr;
                }
            }

            // Success
            this.toggleEditMode(); // Exit edit mode
            alert('Cambios guardados correctamente.');
            // loadDailyFlightsOps handles re-render inside toggleEditMode if needed, but we called toggle which calls load.

        } catch (e) {
            console.error(e);
            alert('Error al guardar: ' + e.message);
        }
    }

    getAirlineConfigByName(name) {
        if (!name) return this.airlineConfig['default'];
        const slug = this.slugify(name);
        for (const key in this.airlineConfig) {
            if (slug.includes(key) || key.includes(slug)) return this.airlineConfig[key];
        }
        return this.airlineConfig['default'];
    }

    renderDailyOpsFancy(data, type, tableSelector) {
        const table = document.querySelector(tableSelector);
        if (!table) return;
        const tbody = table.querySelector('tbody');
        const thead = table.querySelector('thead');

        // Inject Filter Row ---------------------------------------------
        let filterRow = thead.querySelector('.filter-row');
        if (!filterRow) {
            filterRow = document.createElement('tr');
            filterRow.className = 'filter-row text-center';
            const headers = thead.querySelectorAll('tr:not(.filter-row) th');

            // Helper: apply all column filters + global search for this table
            const applyAllFilters = () => {
                const filterInputs = filterRow.querySelectorAll('.flights-col-filter');
                const globalInput = document.getElementById('search-flights-global');
                const globalTerm = globalInput ? globalInput.value.trim().toLowerCase() : '';
                let visible = 0;

                tbody.querySelectorAll('tr').forEach(r => {
                    // Global search: check entire row text
                    if (globalTerm && !r.textContent.toLowerCase().includes(globalTerm)) {
                        r.style.display = 'none';
                        return;
                    }
                    // Column-level cooperative filters
                    let show = true;
                    filterInputs.forEach((inp, i) => {
                        const term = inp.value.trim().toLowerCase();
                        if (!term) return;
                        const cell = r.cells[i];
                        if (cell && !cell.textContent.toLowerCase().includes(term)) {
                            show = false;
                        }
                    });
                    // Date filter
                    if (show) {
                        const ds = this.dailyDateState[type];
                        if (ds && ds.active) {
                            const fecha = r.getAttribute('data-fecha');
                            const rowDate = fecha ? new Date(fecha + 'T12:00:00') : null;
                            if (!rowDate || isNaN(rowDate)) { show = false; }
                            else {
                                if (ds.dateFrom && rowDate < ds.dateFrom) show = false;
                                if (ds.dateTo   && rowDate > ds.dateTo)   show = false;
                            }
                        }
                    }
                    r.style.display = show ? '' : 'none';
                    if (show) visible++;
                });

                // Update count badge with filtered count
                const badgeId = type === 'arrival' ? 'arrivals-count-badge' : 'departures-count-badge';
                const badge = document.getElementById(badgeId);
                if (badge) {
                    const total = tbody.querySelectorAll('tr').length;
                    const dateActive = this.dailyDateState[type] && this.dailyDateState[type].active;
                    badge.textContent = (globalTerm || filterRow.querySelector('.active-filter') || dateActive)
                        ? `${visible} / ${total} vuelos`
                        : `${total} vuelos`;
                }
            };

            headers.forEach((th, idx) => {
                const td = document.createElement('td');
                td.className = 'p-1';

                // Skip pure-icon or action headers (empty text, last two cols)
                const headerText = th.textContent.trim();
                const isActionCol = idx >= headers.length - 2 && !headerText;

                if (!isActionCol) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'flights-col-filter w-100';
                    input.placeholder = headerText ? 'Filtrar…' : '';
                    input.title = headerText ? `Filtrar por ${headerText}` : '';

                    input.addEventListener('input', function () {
                        this.classList.toggle('active-filter', this.value.trim().length > 0);
                        applyAllFilters();
                    });

                    td.appendChild(input);
                } else {
                    td.innerHTML = '<span class="text-muted small">—</span>';
                }

                filterRow.appendChild(td);
            });
            thead.appendChild(filterRow);

            // Expose applyAllFilters so global search can re-use it
            table._applyAllFilters = applyAllFilters;
        }

        // Render Data ----------------------------------------------------
        tbody.innerHTML = '';

        // Update count badge
        const badgeId = type === 'arrival' ? 'arrivals-count-badge' : 'departures-count-badge';
        const badge = document.getElementById(badgeId);

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Sin registros</td></tr>`;
            if (badge) badge.textContent = '0 vuelos';
            return;
        }

        if (badge) badge.textContent = `${data.length} vuelos`;

        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-fecha', row.fecha || '');

            const airlineName = row.aerolinea || 'N/A';
            const config = this.getAirlineConfigByName(airlineName);

            let logoHtml = `<span class="small fw-bold">${airlineName}</span>`;

            if (config.logo) {
                const logoFile = config.logo;

                // Logic to visually equalize logo sizes (Ported from parte-ops-flights.js)
                // Standard size
                let style = "max-height: 25px; max-width: 70px;";

                // Reduce size for notably bulky/square logos
                if (logoFile.includes('viva')) {
                    style = "max-height: 20px; max-width: 60px;";
                }

                // Boost size for logos that naturally look small (horizontal/text-heavy)
                const boostLogos = [
                    'logo_aeromexico.png', 'logo_volaris.png', 'logo_mexicana.png',
                    'logo_air_china.png', 'logo_tsm_airlines.png', 'logo_kalitta_air.jpg',
                    'logo_conviasa.png', 'logo_mas.png'
                ];

                // Mega size for specific cargo/wide logos requested to be bigger
                const megaLogos = [
                    'logo_estafeta.jpg', 'logo_cargojet.png',
                    'logo_cargolux.png',
                    'logo_suparna.png', 'logo_awesome_cargo.png',
                    'logo_atlas_air.png', 'logo_fedex_express.png', 'logo_dhl_guatemala_.png'
                ];

                // Specific Overrides for User reported issues (Viva, Conviasa, Mas Air)
                if (logoFile === 'logo_conviasa.png') {
                    // Conviasa is long, needs height restriction but allow width
                    style = "max-height: 25px; max-width: 75px;";
                }
                if (logoFile === 'logo_mas.png') {
                    style = "max-height: 25px; max-width: 70px;";
                }
                if (logoFile.includes('viva')) { // Redirect Viva strictly
                    style = "max-height: 18px; max-width: 60px;";
                }

                if (megaLogos.includes(logoFile)) {
                    style = "max-height: 28px; max-width: 85px;";
                }

                logoHtml = `<div class="d-flex align-items-center justify-content-center gap-2" title="${airlineName}">
                     <img src="images/airlines/${config.logo}" alt="${airlineName}" class="img-fluid" style="${style} width: auto; object-fit: contain;">
                   </div>`;
            }

            const airlineHtml = logoHtml;

            const flightNum = type === 'arrival' ? (row.vuelo_llegada || '') : (row.vuelo_salida || '');
            const timeProg = type === 'arrival' ? (row.fecha_hora_prog_llegada || '') : (row.fecha_hora_prog_salida || '');
            const timeReal = type === 'arrival' ? (row.fecha_hora_real_llegada || '') : (row.fecha_hora_real_salida || '');
            const loc = type === 'arrival' ? (row.origen || '') : (row.destino || '');
            const pax = type === 'arrival' ? (row.pasajeros_llegada || '') : (row.pasajeros_salida || '');
            const mat = row.matricula || '';

            const fmtTime = (t) => {
                if (!t) return '';
                if (t.includes('T')) return t.split('T')[1].substring(0, 5);
                return t.substring(0, 5);
            };

            const getInput = (val, field, width = '100%', inputType = 'text') => {
                if (!this.isEditMode) return null;

                let safeVal = (val !== undefined && val !== null) ? String(val) : '';
                safeVal = safeVal.replace(/"/g, '&quot;');

                return `<input type="${inputType}" class="form-control form-control-sm p-1 text-center dm-input-edit" 
                   style="min-width: ${width}; font-size: 0.75rem; height: 30px;" 
                   value="${safeVal}"
                   data-date="${row.fecha}"
                   data-seq="${row.seq_no || row.no}"
                   data-row-type="${type}"
                   data-field="${field}">`;
            };

            // Display Values
            let displayFlight = `<span class="fw-bold text-primary">${flightNum}</span>`;
            let displayLoc = `<span class="text-truncate" style="max-width: 100px; display: block;">${loc}</span>`;
            let displayProg = `<span class="small">${fmtTime(timeProg)}</span>`;
            let displayReal = `<span class="small fw-bold">${fmtTime(timeReal)}</span>`;
            let displayPax = `<span class="fw-bold text-dark">${pax}</span>`;
            let displayMat = `<span class="small font-monospace">${mat}</span>`;

            // Edit Inputs overrides
            if (this.isEditMode) {
                displayFlight = getInput(flightNum, type === 'arrival' ? 'vuelo_llegada' : 'vuelo_salida', '60px');
                displayLoc = getInput(loc, type === 'arrival' ? 'origen' : 'destino', '60px');
                displayProg = getInput(timeProg, type === 'arrival' ? 'fecha_hora_prog_llegada' : 'fecha_hora_prog_salida', '60px');
                displayReal = getInput(timeReal, type === 'arrival' ? 'fecha_hora_real_llegada' : 'fecha_hora_real_salida', '60px');
                displayPax = getInput(pax, type === 'arrival' ? 'pasajeros_llegada' : 'pasajeros_salida', '40px', 'number');
                displayMat = getInput(mat, 'matricula', '60px');
            }

            // Delete Action
            const deleteBtn = `<button class="btn btn-sm btn-link text-danger opacity-75 p-0" title="Eliminar vuelo" onclick="dataManagement.deleteSingleFlight('${row.fecha}', '${row.seq_no}', '${type}')">
                <i class="fas fa-times-circle"></i>
            </button>`;

            // Columns matching index.html structure
            if (type === 'arrival') {
                // No, Aerolinea, Vuelo, Origen, Prog, Real, Pax, Conci(empty), Action
                tr.innerHTML = `
                    <td class="fw-bold text-muted small col-no">${row.seq_no || '-'}</td>
                    <td class="text-start ps-3 align-middle col-aerolinea">${airlineHtml}</td>
                    <td class="align-middle col-vuelo">${displayFlight}</td>
                    <td class="align-middle col-route">${displayLoc}</td>
                    <td class="align-middle col-prog">${displayProg}</td>
                    <td class="align-middle col-real">${displayReal}</td>
                    <td class="align-middle col-pax">${displayPax}</td>
                    <td class="col-conciliacion"></td>
                    <td class="align-middle col-actions">${deleteBtn}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td class="text-start ps-3 align-middle col-aerolinea">${airlineHtml}</td>
                    <td class="align-middle col-vuelo">${displayFlight}</td>
                    <td class="align-middle col-route">${displayLoc}</td>
                    <td class="align-middle col-prog">${displayProg}</td>
                    <td class="align-middle col-real">${displayReal}</td>
                    <td class="align-middle col-pax">${displayPax}</td>
                    <td class="align-middle col-matricula">${displayMat}</td>
                    <td class="col-conciliacion"></td>
                    <td class="align-middle col-actions">${deleteBtn}</td>
                `;
            }
            tbody.appendChild(tr);
        });
    }

    /**
     * Global search across both flight tables (Llegadas + Salidas).
     * Respects any active column-level filters already set.
     */
    filterFlightsGlobal(term) {
        const tables = [
            document.querySelector('#table-daily-flights-arrivals'),
            document.querySelector('#table-daily-flights-departures')
        ];
        tables.forEach(table => {
            if (!table) return;
            if (typeof table._applyAllFilters === 'function') {
                // Reuse the cooperative filter already wired inside renderDailyOpsFancy
                table._applyAllFilters();
            } else {
                // Fallback: simple global text filter
                const rows = table.querySelectorAll('tbody tr');
                const t = term.trim().toLowerCase();
                rows.forEach(r => {
                    r.style.display = (!t || r.textContent.toLowerCase().includes(t)) ? '' : 'none';
                });
            }
        });
    }

    /** Clear global search input and reset visibility in both flight tables. */
    clearFlightsSearch() {
        const input = document.getElementById('search-flights-global');
        if (input) input.value = '';
        this.filterFlightsGlobal('');
    }

    // -- Daily-ops date filter helpers -----------------------------------

    /** Toggle the date-filter panel open/closed for 'arrival' or 'departure'. */
    toggleDailyDatePanel(type) {
        const panelId = type === 'arrival' ? 'daily-date-panel-arr' : 'daily-date-panel-dep';
        const panel = document.getElementById(panelId);
        if (!panel) return;
        panel.classList.toggle('d-none');
        // On open: refresh labels and apply the filter immediately
        if (!panel.classList.contains('d-none')) {
            this._updateDailyDateLabels(type);
            this.applyDailyDateFilter(type);
        }
    }

    /** Switch between 'rel' (relative) and 'abs' (absolute) date-filter modes. */
    setDailyDateMode(type, mode) {
        this.dailyDateState[type].mode = mode;
        const prefix = type === 'arrival' ? 'daily-arr' : 'daily-dep';
        const relPanel = document.getElementById(`${prefix}-rel-mode`);
        const absPanel = document.getElementById(`${prefix}-abs-mode`);
        const btnRel   = document.getElementById(`${prefix}-mode-rel`);
        const btnAbs   = document.getElementById(`${prefix}-mode-abs`);
        if (relPanel) relPanel.classList.toggle('d-none', mode !== 'rel');
        if (absPanel) absPanel.classList.toggle('d-none', mode !== 'abs');
        if (btnRel) btnRel.classList.toggle('active', mode === 'rel');
        if (btnAbs) btnAbs.classList.toggle('active', mode === 'abs');
        this.applyDailyDateFilter(type);
    }

    /** Increment or decrement a relative offset input and re-apply the filter. */
    stepDailyOffset(type, which, delta) {
        const prefix = type === 'arrival' ? 'daily-arr' : 'daily-dep';
        const inputId = which === 'start' ? `${prefix}-rel-start` : `${prefix}-rel-end`;
        const input = document.getElementById(inputId);
        if (!input) return;
        input.value = (parseInt(input.value, 10) || 0) + delta;
        this.applyDailyDateFilter(type);
    }

    /** Update the human-readable date label spans for relative mode. */
    _updateDailyDateLabels(type) {
        const prefix = type === 'arrival' ? 'daily-arr' : 'daily-dep';
        const startOffset = parseInt((document.getElementById(`${prefix}-rel-start`) || {}).value ?? '-4', 10);
        const endOffset   = parseInt((document.getElementById(`${prefix}-rel-end`)   || {}).value ?? '0',  10);
        const today = new Date();
        const fmt = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
        const startDate = new Date(today); startDate.setDate(today.getDate() + startOffset);
        const endDate   = new Date(today); endDate.setDate(today.getDate() + endOffset);
        const startLabel = document.getElementById(`${prefix}-rel-start-label`);
        const endLabel   = document.getElementById(`${prefix}-rel-end-label`);
        if (startLabel) startLabel.textContent = fmt(startDate);
        if (endLabel)   endLabel.textContent   = fmt(endDate);
    }

    /** Compute [start, end] Date window for the given type from current inputs. Returns null if inactive. */
    _getDailyDateWindow(type) {
        const ds = this.dailyDateState[type];
        const prefix = type === 'arrival' ? 'daily-arr' : 'daily-dep';
        if (ds.mode === 'rel') {
            const startOffset = parseInt((document.getElementById(`${prefix}-rel-start`) || {}).value ?? '-4', 10);
            const endOffset   = parseInt((document.getElementById(`${prefix}-rel-end`)   || {}).value ?? '0',  10);
            const today = new Date();
            const start = new Date(today); start.setDate(today.getDate() + startOffset); start.setHours(0, 0, 0, 0);
            const end   = new Date(today); end.setDate(today.getDate() + endOffset);     end.setHours(23, 59, 59, 999);
            return [start, end];
        } else {
            const fromVal = (document.getElementById(`${prefix}-abs-from`) || {}).value || '';
            const toVal   = (document.getElementById(`${prefix}-abs-to`)   || {}).value || '';
            if (!fromVal && !toVal) return null;
            const start = fromVal ? new Date(fromVal + 'T00:00:00') : new Date('2000-01-01');
            const end   = toVal   ? new Date(toVal   + 'T23:59:59') : new Date('2099-12-31');
            return [start, end];
        }
    }

    /** Called on every date input change; updates state and re-triggers the table filter. */
    applyDailyDateFilter(type) {
        const win = this._getDailyDateWindow(type);
        const ds  = this.dailyDateState[type];
        ds.active   = win !== null;
        ds.dateFrom = win ? win[0] : null;
        ds.dateTo   = win ? win[1] : null;
        // Update date labels for relative mode
        if (ds.mode === 'rel') this._updateDailyDateLabels(type);
        // Highlight funnel button
        const btnId = type === 'arrival' ? 'btn-date-daily-arr' : 'btn-date-daily-dep';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.toggle('active-date-filter', ds.active);
        // Re-run the cooperative filter on the right table
        const tableSelector = type === 'arrival'
            ? '#table-daily-flights-arrivals'
            : '#table-daily-flights-departures';
        const table = document.querySelector(tableSelector);
        if (table && typeof table._applyAllFilters === 'function') {
            table._applyAllFilters();
        }
    }

    /** Remove date filter for a given table type. */
    clearDailyDateFilter(type) {
        const ds = this.dailyDateState[type];
        ds.active = false; ds.dateFrom = null; ds.dateTo = null;
        const btnId = type === 'arrival' ? 'btn-date-daily-arr' : 'btn-date-daily-dep';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.remove('active-date-filter');
        const prefix = type === 'arrival' ? 'daily-arr' : 'daily-dep';
        // Reset relative offsets to defaults (-4 to 0)
        const startEl = document.getElementById(`${prefix}-rel-start`);
        const endEl   = document.getElementById(`${prefix}-rel-end`);
        if (startEl) startEl.value = '-4';
        if (endEl)   endEl.value   = '0';
        // Reset absolute range
        const fromEl = document.getElementById(`${prefix}-abs-from`);
        const toEl   = document.getElementById(`${prefix}-abs-to`);
        if (fromEl) fromEl.value = '';
        if (toEl)   toEl.value   = '';
        // Refresh labels
        this._updateDailyDateLabels(type);
        const tableSelector = type === 'arrival'
            ? '#table-daily-flights-arrivals'
            : '#table-daily-flights-departures';
        const table = document.querySelector(tableSelector);
        if (table && typeof table._applyAllFilters === 'function') {
            table._applyAllFilters();
        }
    }

    initColumnVisibility() {
        const saved = localStorage.getItem('dm-daily-flights-columns');
        const container = document.querySelector('#pane-daily-flights-ops');
        if (!container) return;

        if (saved) {
            try {
                const hiddenCols = JSON.parse(saved);
                if (Array.isArray(hiddenCols)) {
                    hiddenCols.forEach(col => {
                        // Checkbox unchecked
                        const chk = document.querySelector(`.col-toggle[data-col="${col}"]`);
                        if (chk) chk.checked = false;
                        
                        // Apply class
                        this.toggleColumn(col, false);
                    });
                }
            } catch (e) {
                console.error("Error parsing saved columns", e);
            }
        }
    }

    toggleColumn(colName, isVisible) {
        const container = document.querySelector('#pane-daily-flights-ops');
        if (!container) return;

        const className = `hide-${colName}`;
        if (isVisible) {
            container.classList.remove(className);
        } else {
            container.classList.add(className);
        }
        this.saveColumnVisibility();
    }

    saveColumnVisibility() {
        const checkboxes = document.querySelectorAll('.col-toggle');
        const hidden = [];
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                const col = cb.getAttribute('data-col');
                if (col) hidden.push(col);
            }
        });
        localStorage.setItem('dm-daily-flights-columns', JSON.stringify(hidden));
    }

    async deleteSingleFlight(dateStr, seqNo, type) {
        if (!confirm('¿Eliminar este vuelo?')) return;
const loadingMsg = document.createElement('div'); loadingMsg.id = 'deleting-single-overlay'; loadingMsg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);color:white;display:flex;align-items:center;justify-content:center;font-size:24px;z-index:9999;flex-direction:column;'; loadingMsg.innerHTML = 'Espera, eliminando...'; document.body.appendChild(loadingMsg); 
        try {
            const { data, error } = await this.client
                .from('vuelos_parte_operaciones')
                .select('data')
                .eq('date', dateStr)
                .single();

            if (error || !data) throw new Error('No se encontró el registro del día.');

            let flights = data.data || [];

            // Audit: Find the flight before deleting
            const flightToDelete = flights.find(f => {
                const fSeq = (f.seq_no !== undefined) ? f.seq_no : f.no;
                return String(fSeq) === String(seqNo);
            });

            const initialLen = flights.length;

            // Filter by sequence number primarily
            flights = flights.filter(f => {
                const fSeq = (f.seq_no !== undefined) ? f.seq_no : f.no;
                return String(fSeq) !== String(seqNo);
            });

            if (flights.length === initialLen) {
                alert('No se pudo localizar el vuelo específico para eliminar (ID no coincide).');
                return;
            }

            const { error: updateErr } = await this.client
                .from('vuelos_parte_operaciones')
                .update({ data: flights })
                .eq('date', dateStr);

            if (updateErr) throw updateErr;

            // Security Audit Log
            if (typeof window.logHistory === 'function' && flightToDelete) {
                const flightLabel = flightToDelete.vuelo_llegada || flightToDelete.vuelo_salida || 'Desc.';
                window.logHistory('ELIMINAR', 'Vuelo Diario', `${dateStr} #${seqNo}`, {
                    old: flightToDelete,
                    new: null, // Deletion
                    summary: `Se eliminó el vuelo ${flightLabel} de ${flightToDelete.aerolinea || 'N/A'}`
                });
            }

            this.loadDailyFlightsOps(); if (document.getElementById('deleting-single-overlay')) document.body.removeChild(document.getElementById('deleting-single-overlay'));

        } catch (e) { if (document.getElementById('deleting-single-overlay')) document.body.removeChild(document.getElementById('deleting-single-overlay'));
            console.error(e);
            alert('Error al eliminar: ' + e.message);
        }
    }

    async deleteDailyOpsByDate() {
        const filterDateEl = document.getElementById('filter-daily-flights-date');
        const filterDate = filterDateEl ? filterDateEl.value : null;

        if (!filterDate) {
            alert('Por favor selecciona una fecha específica para eliminar.');
            return;
        }

        if (!confirm(`¿Estás SEGURO de que deseas ELIMINAR TODOS los vuelos del día ${filterDate}?\n\nEsta acción borrará el itinerario completo de esa fecha y no se puede deshacer.`)) {
            return;
        }

        try {
            const supabase = this.client || window.supabaseClient;
            if (!supabase) throw new Error("Cliente Supabase no inicializado");

            // Check count first
            const { count, error: countErr } = await supabase
                .from('vuelos_parte_operaciones')
                .select('*', { count: 'exact', head: true })
                .eq('date', filterDate);

            if (countErr) throw countErr;

            if (count === 0) {
                alert('No hay registros para borrar en esa fecha.');
                return;
            }

            const { error } = await supabase
                .from('vuelos_parte_operaciones')
                .delete()
                .eq('date', filterDate);

            if (error) throw error;

            alert(`Se eliminaron los registros correctamente.`);
            this.loadDailyFlightsOps();

        } catch (error) {
            console.error('Error deleting daily flights:', error);
            alert('Error al eliminar: ' + error.message);
        }
    }

    async loadMedicalAttentions() {
        // Dynamic Year Loading
        const yearSel = document.getElementById('filter-medical-year');
        const currentYearSelection = yearSel ? yearSel.value : '';

        try {
            // Fetch ALL data to find available years
            const allData = await window.dataManager.getMedicalAttentions();
            
            // Extract distinct years
            const years = [...new Set(allData.map(item => item.year))].sort((a, b) => b - a);

            // Populate Dropdown
            if (yearSel) {
                yearSel.innerHTML = '';
                if (years.length === 0) {
                     // Fallback
                     const opt = document.createElement('option'); opt.value = new Date().getFullYear(); opt.innerText = new Date().getFullYear();
                     yearSel.appendChild(opt);
                } else {
                    years.forEach(y => {
                        const opt = document.createElement('option');
                        opt.value = y;
                        opt.innerText = y;
                        yearSel.appendChild(opt);
                    });
                }
                
                // Restore selection or select newest
                if (years.includes(Number(currentYearSelection))) {
                    yearSel.value = currentYearSelection;
                } else if (!currentYearSelection && years.length > 0) {
                    yearSel.value = years[0];
                }
            }

            // Filter data for the currently selected year
            const selectedYear = yearSel ? yearSel.value : (years[0] || '');
            const data = allData.filter(item => String(item.year) === String(selectedYear));
            
            // Sort by month
            const monthOrder = {
                'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4, 'Mayo': 5, 'Junio': 6,
                'Julio': 7, 'Agosto': 8, 'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12
            };
            data.sort((a, b) => (monthOrder[a.month] || 99) - (monthOrder[b.month] || 99));

            this.medicalData = data;
            this.filterMedicalAttentions();
        } catch (error) {
            console.error('Error loading medical attentions:', error);
        }
    }

    filterMedicalAttentions() {
        if (!this.medicalData) return;
        const columns = ['month', 'aifa_personnel', 'other_companies', 'passengers', 'visitors', 'total'];
        const inputs = document.querySelectorAll('#table-medical .filter-row input');

        const filtered = this.medicalData.filter(item => {
            let pass = true;
            inputs.forEach((input, index) => {
                if (!pass) return;
                const searchVal = (input.value || '').toLowerCase();
                if (!searchVal) return;

                const col = columns[index];
                if (!col) return;

                let itemVal = item[col];
                if (itemVal === null || itemVal === undefined) itemVal = '';
                
                 if (String(itemVal).toLowerCase().indexOf(searchVal) === -1) {
                    pass = false;
                }
            });
            return pass;
        });

        this.renderTable('table-medical', filtered, columns, 'medical_attentions');
    }

    async loadMedicalTypes() {
        // Dynamic Year Loading
        const yearSel = document.getElementById('filter-medical-types-year');
        const currentYearSelection = yearSel ? yearSel.value : '';

        try {
            // Fetch ALL data to find available years
            const allData = await window.dataManager.getMedicalTypes();

            // Extract distinct years
            const years = [...new Set(allData.map(item => item.year))].sort((a, b) => b - a);

            // Populate Dropdown
            if (yearSel) {
                yearSel.innerHTML = '';
                if (years.length === 0) {
                     // Fallback
                     const opt = document.createElement('option'); opt.value = new Date().getFullYear(); opt.innerText = new Date().getFullYear();
                     yearSel.appendChild(opt);
                } else {
                    years.forEach(y => {
                        const opt = document.createElement('option');
                        opt.value = y;
                        opt.innerText = y;
                        yearSel.appendChild(opt);
                    });
                }
                
                // Restore selection or select newest
                if (years.includes(Number(currentYearSelection))) {
                    yearSel.value = currentYearSelection;
                } else if (!currentYearSelection && years.length > 0) {
                    yearSel.value = years[0];
                }
            }

            // Filter data for the currently selected year
            const selectedYear = yearSel ? yearSel.value : (years[0] || '');
            const data = allData.filter(item => String(item.year) === String(selectedYear));

            // Sort by month (Uppercase for types)
            const monthOrder = {
                'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4, 'MAYO': 5, 'JUNIO': 6,
                'JULIO': 7, 'AGOSTO': 8, 'SEPTIEMBRE': 9, 'OCTUBRE': 10, 'NOVIEMBRE': 11, 'DICIEMBRE': 12,
                'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4, 'Mayo': 5, 'Junio': 6,
                'Julio': 7, 'Agosto': 8, 'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12
            };
            data.sort((a, b) => (monthOrder[a.month] || 99) - (monthOrder[b.month] || 99));

            this.medicalTypesData = data;
            this.filterMedicalTypes();
        } catch (error) {
            console.error('Error loading medical types:', error);
        }
    }

    filterMedicalTypes() {
        if (!this.medicalTypesData) return;
        const columns = ['month', 'traslado', 'ambulatorio', 'total'];
        const inputs = document.querySelectorAll('#table-medical-types .filter-row input');

        const filtered = this.medicalTypesData.filter(item => {
            let pass = true;
            inputs.forEach((input, index) => {
                if (!pass) return;
                const searchVal = (input.value || '').toLowerCase();
                if (!searchVal) return;

                const col = columns[index];
                if (!col) return;

                let itemVal = item[col];
                if (itemVal === null || itemVal === undefined) itemVal = '';

                 if (String(itemVal).toLowerCase().indexOf(searchVal) === -1) {
                    pass = false;
                }
            });
            return pass;
        });

        this.renderTable('table-medical-types', filtered, columns, 'medical_types');
    }

    async loadMedicalDirectory() {
        try {
            const data = await window.dataManager.getMedicalDirectory();
            // Custom renderer for directory to handle Documents array
            const tbody = document.querySelector('#table-medical-directory tbody');
            tbody.innerHTML = '';

            data.forEach(item => {
                const tr = document.createElement('tr');

                // Asunto
                const tdSubject = document.createElement('td');
                tdSubject.textContent = item.asunto;
                tr.appendChild(tdSubject);

                // Responsable
                const tdResp = document.createElement('td');
                tdResp.textContent = item.responsable;
                tr.appendChild(tdResp);

                // Estado
                const tdStatus = document.createElement('td');
                tdStatus.textContent = item.estado;
                tr.appendChild(tdStatus);

                // Documentos
                const tdDocs = document.createElement('td');
                // Assume documents is JSONB array of strings (filenames)
                let docs = [];
                if (Array.isArray(item.documentos)) {
                    docs = item.documentos;
                } else if (typeof item.documentos === 'string') {
                    try { docs = JSON.parse(item.documentos); } catch (e) { }
                }

                if (docs.length > 0) {
                    tdDocs.className = "d-flex flex-column gap-1";

                    docs.forEach((d, idx) => {
                        const fileRow = document.createElement('div');
                        fileRow.className = "d-flex align-items-center justify-content-between p-1 border rounded bg-light";

                        // Resolve URL and Name
                        let url = '', name = '';
                        if (typeof d === 'object' && d !== null) {
                            url = d.url;
                            name = d.name || 'Documento';
                        } else {
                            const isUrl = typeof d === 'string' && (d.startsWith('http') || d.startsWith('//'));
                            url = isUrl ? d : `pdfs/directorio/${d}`;
                            name = isUrl ? (d.split('/').pop().split('_').pop() || 'Documento') : d;
                        }

                        // Link
                        const link = document.createElement('a');
                        link.href = url;
                        link.target = "_blank";
                        link.className = "text-decoration-none text-truncate small me-2";
                        link.style.maxWidth = "150px";
                        link.innerHTML = `<i class="fas fa-file-pdf text-danger me-1"></i> ${name}`;
                        link.title = name;

                        // Controls container
                        const controls = document.createElement('div');
                        controls.className = "d-flex gap-1";

                        // Edit Name Button
                        const btnRename = document.createElement('button');
                        btnRename.className = "btn btn-xs btn-link text-secondary p-0";
                        btnRename.innerHTML = '<i class="fas fa-pen"></i>';
                        btnRename.title = "Cambiar nombre";
                        btnRename.onclick = () => this.renameMedicalDoc(item.id, idx, name);

                        // Delete Button
                        const btnRemove = document.createElement('button');
                        btnRemove.className = "btn btn-xs btn-link text-danger p-0";
                        btnRemove.innerHTML = '<i class="fas fa-times"></i>';
                        btnRemove.title = "Eliminar documento";
                        btnRemove.onclick = () => this.deleteMedicalDoc(item.id, idx);

                        controls.appendChild(btnRename);
                        controls.appendChild(btnRemove);

                        fileRow.appendChild(link);
                        fileRow.appendChild(controls);
                        tdDocs.appendChild(fileRow);
                    });
                } else {
                    tdDocs.textContent = '-';
                }
                // Add upload button
                const btnUpload = document.createElement('button');
                btnUpload.className = 'btn btn-sm btn-link mt-1';
                btnUpload.innerHTML = '<i class="fas fa-upload"></i> Agregar PDF';
                btnUpload.onclick = () => this.uploadMedicalPdf(item.id);
                tdDocs.appendChild(btnUpload);

                tr.appendChild(tdDocs);

                // Order Column Input
                const tdOrder = document.createElement('td');
                const inputOrder = document.createElement('input');
                inputOrder.type = 'number';
                inputOrder.className = 'form-control form-control-sm';
                inputOrder.style.width = '60px';
                inputOrder.value = item.order_index !== undefined ? item.order_index : 1000;
                inputOrder.onchange = async (e) => {
                    try {
                        await window.dataManager.updateTable('medical_directory', item.id, { order_index: Number(e.target.value) });
                        e.target.style.borderColor = 'green';
                    } catch (err) { alert('Error actualizando orden'); }
                };
                tdOrder.appendChild(inputOrder);
                // Prepend to row (making it the first column visually, user needs to update header in HTML manually or we do it here if possible)
                tr.insertBefore(tdOrder, tr.firstChild);


                // Actions
                const tdActions = document.createElement('td');
                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                btnEdit.onclick = () => this.editItem('medical_directory', item);
                tdActions.appendChild(btnEdit);

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn btn-sm btn-outline-danger';
                btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                btnDelete.onclick = () => this.deleteItem('medical_directory', item.id);
                tdActions.appendChild(btnDelete);

                tr.appendChild(tdActions);
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error('Error loading medical directory:', error);
        }
    }

    async renameMedicalDoc(id, docIndex, currentName) {
        const newName = prompt("Nuevo nombre para el documento:", currentName);
        if (!newName || newName.trim() === currentName) return;

        try {
            const { data: currentData, error: fetchError } = await this.client
                .from('medical_directory')
                .select('documentos')
                .eq('id', id)
                .single();
            if (fetchError) throw fetchError;

            let docs = [];
            if (currentData.documentos) {
                docs = typeof currentData.documentos === 'string' ? JSON.parse(currentData.documentos) : currentData.documentos;
            }

            if (docIndex >= 0 && docIndex < docs.length) {
                const doc = docs[docIndex];
                // Convert to object if legacy string
                if (typeof doc === 'string') {
                    docs[docIndex] = { url: doc, name: newName.trim() };
                } else if (typeof doc === 'object') {
                    docs[docIndex].name = newName.trim();
                }

                const { error: updateError } = await this.client
                    .from('medical_directory')
                    .update({ documentos: docs })
                    .eq('id', id);
                if (updateError) throw updateError;

                this.loadMedicalDirectory();
            }
        } catch (e) {
            console.error(e);
            alert('Error al renombrar: ' + e.message);
        }
    }

    async deleteMedicalDoc(id, docIndex) {
        if (!confirm("¿Eliminar este documento?")) return;
        try {
            const { data: currentData, error: fetchError } = await this.client
                .from('medical_directory')
                .select('documentos')
                .eq('id', id)
                .single();
            if (fetchError) throw fetchError;

            let docs = [];
            if (currentData.documentos) {
                docs = typeof currentData.documentos === 'string' ? JSON.parse(currentData.documentos) : currentData.documentos;
            }

            if (docIndex >= 0 && docIndex < docs.length) {
                docs.splice(docIndex, 1); // Remove item

                const { error: updateError } = await this.client
                    .from('medical_directory')
                    .update({ documentos: docs })
                    .eq('id', id);
                if (updateError) throw updateError;

                this.loadMedicalDirectory();
            }

        } catch (e) {
            console.error(e);
            alert('Error al eliminar documento: ' + e.message);
        }
    }

    async uploadMedicalPdf(id) {
        // Create file input dynamically
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Ask user for a display name
            let displayName = prompt("Ingrese el nombre que desea mostrar para este archivo:", file.name.replace('.pdf', ''));
            if (displayName === null) return; // User cancelled
            if (!displayName.trim()) displayName = file.name;

            try {
                // 1. Upload to Supabase Storage
                // Generate a unique path: medical_docs/recordId/timestamp_filename
                const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                const filePath = `medical_docs/${id}/${Date.now()}_${cleanName}`;

                // Show loading state (global spinner or alert for now)
                document.body.style.cursor = 'wait';

                const { data: uploadData, error: uploadError } = await this.client
                    .storage
                    .from('medical-files')
                    .upload(filePath, file);

                if (uploadError) throw new Error('Error subiendo archivo: ' + uploadError.message);

                // 2. Get Public URL
                const { data: { publicUrl } } = this.client
                    .storage
                    .from('medical-files')
                    .getPublicUrl(filePath);

                // 3. Update Record
                // First get current doc list to append
                const { data: currentData, error: fetchError } = await this.client
                    .from('medical_directory')
                    .select('documentos')
                    .eq('id', id)
                    .single();

                if (fetchError) throw new Error('Error leyendo registro actual');

                let docs = [];
                if (currentData.documentos) {
                    docs = typeof currentData.documentos === 'string'
                        ? JSON.parse(currentData.documentos)
                        : currentData.documentos;
                }
                if (!Array.isArray(docs)) docs = [];

                // Store object with url and name
                docs.push({ url: publicUrl, name: displayName.trim() });

                const { error: updateError } = await this.client
                    .from('medical_directory')
                    .update({ documentos: docs })
                    .eq('id', id);

                if (updateError) throw new Error('Error actualizando base de datos');

                alert('Documento subido correctamente');
                this.loadMedicalDirectory();

            } catch (err) {
                console.error('Upload failed:', err);
                alert('Fallo la carga: ' + err.message);
            } finally {
                document.body.style.cursor = 'default';
            }
        };

        input.click();
    }


    async loadDelays() {
        const year = document.getElementById('filter-delays-year').value;
        const month = document.getElementById('filter-delays-month').value;
        try {
            const data = await window.dataManager.getDelays(year, month);
            this.renderTable('table-delays', data, ['month', 'cause', 'count', 'description'], 'delays');
        } catch (error) {
            console.error('Error loading delays:', error);
        }
    }

    async loadPunctualityStats() {
        const yearInput = document.getElementById('filter-punctuality-year');
        const monthInput = document.getElementById('filter-punctuality-month');

        // Ensure values are clean strings or numbers
        const year = yearInput ? yearInput.value : null;
        const month = monthInput ? monthInput.value : null;

        try {
            // Pass null if empty string to avoid incorrect filtering query
            let data = await window.dataManager.getPunctualityStats(
                (month === "" ? null : month),
                (year === "" ? null : year)
            );

            // Sort: Passengers first, then Cargo, then by Airline name
            data.sort((a, b) => {
                const catA = String(a.category || '').toLowerCase();
                const catB = String(b.category || '').toLowerCase();

                const isPaxA = catA.includes('pasajero') || catA.includes('comercial');
                const isPaxB = catB.includes('pasajero') || catB.includes('comercial');

                if (isPaxA && !isPaxB) return -1; // A (Pax) comes before B (Non-Pax)
                if (!isPaxA && isPaxB) return 1;  // B (Pax) comes before A (Non-Pax)

                // If same category type, sort by airline name
                const airA = String(a.airline || '').toLowerCase();
                const airB = String(b.airline || '').toLowerCase();
                if (airA < airB) return -1;
                if (airA > airB) return 1;
                return 0;
            });

            this.renderTable('table-punctuality-stats', data, ['year', 'month', 'airline', 'category', 'on_time', 'delayed', 'cancelled', 'total_flights', 'imputable_airline', 'cancelled_imputable', 'total_imputable'], 'punctuality_stats');
        } catch (error) {
            console.error('Error loading punctuality stats:', error);
        }
    }

    // --- Importar CSV de Puntualidad ------------------------------------------
    importPunctualityCsv() {
        const MONTH_MAP = {
            'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
            'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
        };

        // Ask for the year (default current)
        const yearVal = prompt('¿A qué Año corresponde el CSV? (ejemplo: 2026)', new Date().getFullYear());
        if (!yearVal) return;
        const year = parseInt(yearVal, 10);
        if (isNaN(year) || year < 2020 || year > 2100) {
            alert('Año inválido.');
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const text = await file.text();
            const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
            if (lines.length < 2) { alert('El CSV está vacío o no tiene datos.'); return; }

            // Parse CSV (simple split — assumes no quoted commas in data)
            const parseRow = (line) => line.split(',').map(c => c.trim());
            const headers = parseRow(lines[0]).map(h => h.toLowerCase());

            // Column index lookup
            const idx = (candidates) => {
                for (const c of candidates) {
                    const i = headers.findIndex(h => h.includes(c));
                    if (i >= 0) return i;
                }
                return -1;
            };

            const colMes       = idx(['mes']);
            const colAerolinea = idx(['aerolinea', 'aerolínea', 'airline']);
            const colCategoria = idx(['categoria', 'categoría', 'category']);
            const colATiempo   = idx(['a tiempo', 'on_time', 'tiempo']);
            const colDemora    = idx(['demora', 'delayed']);
            const colCancelado = idx(['cancelado', 'cancelled']);
            const colTotal     = idx(['total_flights', 'total vuelos', 'total']);
            const colImp       = idx(['imputables a la', 'imputable_airline', 'imp. aerolínea']);
            const colCancImp   = idx(['cancelados imputables', 'cancelled_imputable']);
            const colTotImp    = idx(['total imputables', 'total_imputable']);

            if (colAerolinea < 0 || colTotal < 0) {
                alert('No se reconoció el formato del CSV. Asegúrese de que tenga columnas: Aerolinea, A tiempo, Demora, Cancelado, Total.');
                return;
            }

            const hasImputables = (colImp >= 0 && colCancImp >= 0 && colTotImp >= 0);
            const rows = [];

            for (let i = 1; i < lines.length; i++) {
                const cells = parseRow(lines[i]);
                if (cells.length < 4) continue;

                const mesRaw = colMes >= 0 ? (cells[colMes] || '').toLowerCase() : '';
                const month = MONTH_MAP[mesRaw] || null;
                if (!month) { console.warn(`Mes no reconocido: "${mesRaw}" en línea ${i + 1}`); continue; }

                const row = {
                    year,
                    month,
                    airline: cells[colAerolinea] || '',
                    category: cells[colCategoria] || 'Carga',
                    on_time: parseInt(cells[colATiempo], 10) || 0,
                    delayed: parseInt(cells[colDemora], 10) || 0,
                    cancelled: parseInt(cells[colCancelado], 10) || 0,
                    total_flights: parseInt(cells[colTotal], 10) || 0
                };

                if (hasImputables) {
                    row.imputable_airline   = parseInt(cells[colImp], 10) || 0;
                    row.cancelled_imputable = parseInt(cells[colCancImp], 10) || 0;
                    row.total_imputable     = parseInt(cells[colTotImp], 10) || 0;
                }

                if (!row.airline) continue;
                rows.push(row);
            }

            if (rows.length === 0) {
                alert('No se encontraron filas válidas en el CSV.');
                return;
            }

            // Group rows by month for confirmation message
            const months = [...new Set(rows.map(r => r.month))];
            const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            const monthsStr = months.map(m => monthNames[m] || m).join(', ');
            const confirm1 = confirm(`Se encontraron ${rows.length} filas para ${monthsStr} ${year}.\n${hasImputables ? '? Incluye columnas de imputables.' : '? Sin columnas de imputables.'}\n\n¿Desea importar los datos? Los registros existentes para estos meses serán reemplazados.`);
            if (!confirm1) return;

            try {
                // Delete existing records for the months in this CSV
                for (const m of months) {
                    const { error: delErr } = await this.client
                        .from('punctuality_stats')
                        .delete()
                        .eq('year', year)
                        .eq('month', m);
                    if (delErr) throw new Error('Error al borrar registros previos: ' + delErr.message);
                }

                // Insert
                const { data: inserted, error: insErr } = await this.client
                    .from('punctuality_stats')
                    .insert(rows)
                    .select();
                if (insErr) throw new Error('Error al insertar: ' + insErr.message);

                alert(`? ${inserted.length} registros importados correctamente para ${monthsStr} ${year}.`);
                this.loadPunctualityStats();
            } catch (err) {
                console.error(err);
                alert('Error al importar: ' + err.message);
            }
        };
        input.click();
    }

    renderTable(tableId, data, columns, tableName) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        tbody.innerHTML = '';

        data.forEach(item => {
            const tr = document.createElement('tr');

            columns.forEach(col => {
                const td = document.createElement('td');
                const raw = item[col];

                // Use schema options for mapping if available (Generic for all select fields)
                let display = raw == null ? '' : String(raw);
                const schema = this.schemas[tableName] || [];
                const fld = schema.find(f => f.name === col);
                const isMedical = (tableName === 'medical_attentions' || tableName === 'medical_types');

                if (fld && fld.options) {
                    const opt = fld.options.find(o => String(o.value) === display || (display !== '' && o.value === String(Number(display)).padStart(2, '0')));
                    if (opt) display = opt.label || opt.value;
                    td.textContent = display;
                    if (isMedical) td.classList.add('text-center');
                }
                // Alignment: center for year/month, right for numeric, left otherwise
                else if (col === 'year' || col === 'month') {
                    td.classList.add('text-center');
                    td.textContent = display;
                } else if (raw != null && raw !== '' && Number.isFinite(Number(raw))) {
                    if (isMedical) td.classList.add('text-center');
                    else td.classList.add('text-end');
                    td.textContent = this.formatNumber(raw, col);
                }
                // Format any date-like column (name contains 'date' or is exactly 'date')
                else if (col && String(col).toLowerCase().includes('date')) {
                    td.textContent = this.formatDisplayDate(raw);
                } else if (col === 'year') {
                    // Do not apply thousands separator to year values
                    td.textContent = display;
                } else {
                    td.textContent = display;
                }

                tr.appendChild(td);
            });

            // Apply row color based on category (operations_summary & punctuality_stats)
            try {
                if (tableName === 'operations_summary' || tableName === 'punctuality_stats') {
                    const catVal = String((item.category || '')).toLowerCase();
                    if (catVal.includes('carga')) tr.classList.add('table-warning');
                    else if (catVal.includes('general') || catVal.includes('operacion')) tr.classList.add('table-success');
                    else tr.classList.add('table-primary');
                }
            } catch (e) {
                // ignore
            }

            // Actions column
            const tdActions = document.createElement('td');

            // --- PERMISSION CHECK ---
            // Determine if current user can edit this table
            const globalDm = window.dataManager;
            const isAdmin = globalDm && globalDm.isAdmin;
            const role = globalDm && globalDm.userRole;

            let canEdit = false;
            
            const isMedicalTable = ['medical_attentions', 'medical_types', 'medical_directory'].includes(tableName);
            
            if (role === 'admin' || role === 'superadmin') {
                canEdit = true;
            } else if (role === 'servicio_medico') {
                canEdit = isMedicalTable;
            } else if (role === 'control_fauna') {
                 canEdit = (tableName === 'wildlife_strikes' || tableName === 'rescued_wildlife');
            } else if (role === 'editor') {
                 // Editor cannot edit medical tables (exclusive to medical/admin)
                 canEdit = !isMedicalTable;
            } else if (isAdmin) {
                 // Fallback for logic where isAdmin is true but role might not be matched above
                 canEdit = true;
            }

            if (canEdit) {
                // Edit Button
                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                btnEdit.onclick = () => this.editItem(tableName, item);
                tdActions.appendChild(btnEdit);

                // Delete Button
                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn btn-sm btn-outline-danger';
                btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                btnDelete.onclick = () => this.deleteItem(tableName, item.id); 
                tdActions.appendChild(btnDelete);
            }

            tr.appendChild(tdActions);
            tbody.appendChild(tr);
        });
    }

    addItem(tableName) {
        const schema = this.schemas[tableName];
        if (schema) {
            window.adminUI.openEditModal(tableName, null, schema);
        }
    }

    addAirlineToDestination(templateItem) {
        // Create a new object with only the destination fields
        const defaults = {
            week_label: templateItem.week_label,
            valid_from: templateItem.valid_from,
            valid_to: templateItem.valid_to,
            route_id: templateItem.route_id,
            city: templateItem.city,
            state: templateItem.state,
            iata: templateItem.iata,
            // Leave airline and counts empty
            airline: '',
            monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0, weekly_total: 0
        };

        const schema = this.schemas['weekly_frequencies'];
        if (schema) {
            window.adminUI.openEditModal('weekly_frequencies', defaults, schema);
        }
    }

    editItem(tableName, item) {
        const schema = this.schemas[tableName];
        if (schema) {
            window.adminUI.openEditModal(tableName, item, schema);
        }
    }

    parseDateFromWeekLabel(weekLabel) {
        const months = {
            'Ene': 0, 'Feb': 1, 'Mar': 2, 'Abr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Ago': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dic': 11,
            'ene': 0, 'feb': 1, 'mar': 2, 'abr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'ago': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11
        };

        // Try format: "08-14 Dic 2025"
        const regexSameMonth = /^(\d{1,2})-(\d{1,2})\s+([A-Za-z]{3})\.?\s+(\d{4})$/;
        const matchSame = weekLabel.match(regexSameMonth);

        if (matchSame) {
            const day = parseInt(matchSame[1], 10);
            const monthStr = matchSame[3];
            const year = parseInt(matchSame[4], 10);
            const month = months[monthStr.substring(0, 3)];
            if (month !== undefined) {
                return new Date(year, month, day);
            }
        }

        // Try format: "29 Dic - 04 Ene 2026"
        const regexDiffMonth = /^(\d{1,2})\s+([A-Za-z]{3})\.?\s+-\s+(\d{1,2})\s+([A-Za-z]{3})\.?\s+(\d{4})$/;
        const matchDiff = weekLabel.match(regexDiffMonth);
        if (matchDiff) {
            const day = parseInt(matchDiff[1], 10);
            const monthStr = matchDiff[2];
            let year = parseInt(matchDiff[5], 10);
            const startMonth = months[monthStr.substring(0, 3)];
            const endMonth = months[matchDiff[4].substring(0, 3)];

            if (startMonth === 11 && endMonth === 0) {
                year -= 1;
            }

            if (startMonth !== undefined) {
                return new Date(year, startMonth, day);
            }
        }
        return null;
    }

    updateWeeklyFreqHeaders(weekLabel, tableId = 'table-weekly-frequencies') {
        const startDate = this.parseDateFromWeekLabel(weekLabel);
        if (!startDate) return;

        const table = document.getElementById(tableId);
        if (!table) return;
        const headers = table.querySelectorAll('thead th');
        const days = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

        // Indices 4 to 10 correspond to L-D (0: Semana, 1: Id, 2: Ruta, 3: Aerolínea, 4: L, ..., 10: D)
        for (let i = 0; i < 7; i++) {
            const current = new Date(startDate);
            current.setDate(startDate.getDate() + i);
            const dayStr = current.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });

            if (headers[i + 4]) {
                headers[i + 4].innerHTML = `${days[i]}<br><small class="text-muted fw-normal" style="font-size: 0.7rem;">${dayStr}</small>`;
            }
        }
    }

    deleteItem(tableName, id) {
        let pkField = 'id';
        let recordId = id;

        if (tableName === 'daily_operations') {
            pkField = 'date';
        } else if (tableName === 'monthly_operations') {
            // If passed an object (item), try to extract ID or use composite key
            if (typeof id === 'object' && id !== null) {
                if (id.id) {
                    recordId = id.id;
                    pkField = 'id';
                } else {
                    // Start of fallback for missing ID
                    recordId = { year: id.year, month: id.month };
                    pkField = null; // Use composite match
                }
            }
        }

        window.adminUI.deleteRecord(tableName, recordId, pkField);
    }

    async deleteWeeklyTemplate() {
        const labelSelect = document.getElementById('filter-weekly-freq-label');
        const currentLabel = labelSelect ? labelSelect.value : '';

        if (!currentLabel) {
            alert('Por favor selecciona una semana para eliminar.');
            return;
        }

        if (!confirm(`¿Estás seguro de que deseas ELIMINAR TODAS las frecuencias de la semana "${currentLabel}"?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const { error } = await window.dataManager.client
                .from('weekly_frequencies')
                .delete()
                .eq('week_label', currentLabel);

            if (error) throw error;

            alert(`Semana "${currentLabel}" eliminada exitosamente.`);

            // Remove option from select
            if (labelSelect) {
                const option = labelSelect.querySelector(`option[value="${currentLabel}"]`);
                if (option) option.remove();
                labelSelect.value = ''; // Reset or select first
                this.loadWeeklyFrequencies();
            }

        } catch (err) {
            console.error('Error deleting week:', err);
            alert('Error al eliminar la semana: ' + err.message);
        }
    }

    openCopyWeekModal() {
        const labelSelect = document.getElementById('filter-weekly-freq-label');
        const sourceLabel = labelSelect ? labelSelect.value : '';

        if (!sourceLabel) {
            alert('Por favor selecciona una semana origen primero.');
            return;
        }

        document.getElementById('copy-source-week-label').textContent = sourceLabel;

        // Reset inputs
        const startDateInput = document.getElementById('copy-start-date');
        const endDateInput = document.getElementById('copy-end-date');
        startDateInput.value = '';
        endDateInput.value = '';
        document.getElementById('copy-preview-label').textContent = '';

        // Add listeners for preview
        startDateInput.onchange = () => {
            // Auto-calculate end date (Start + 6 days)
            const startVal = startDateInput.value;
            if (startVal) {
                const [y, m, d] = startVal.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                date.setDate(date.getDate() + 6);

                const yEnd = date.getFullYear();
                const mEnd = String(date.getMonth() + 1).padStart(2, '0');
                const dEnd = String(date.getDate()).padStart(2, '0');

                endDateInput.value = `${yEnd}-${mEnd}-${dEnd}`;
            }
            this.updateCopyPreview();
        };
        endDateInput.onchange = () => this.updateCopyPreview();

        const modal = new bootstrap.Modal(document.getElementById('modal-copy-week'));
        modal.show();
    }

    updateCopyPreview() {
        const start = document.getElementById('copy-start-date').value;
        const end = document.getElementById('copy-end-date').value;
        const preview = document.getElementById('copy-preview-label');

        if (start && end) {
            preview.textContent = this.generateWeekLabel(start, end);
        } else {
            preview.textContent = 'Selecciona ambas fechas...';
        }
    }

    generateWeekLabel(startDateStr, endDateStr) {
        // startDateStr: YYYY-MM-DD
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

        // Create dates using local time components to avoid timezone shifts
        const [y1, m1, d1] = startDateStr.split('-').map(Number);
        const [y2, m2, d2] = endDateStr.split('-').map(Number);

        const date1 = new Date(y1, m1 - 1, d1);
        const date2 = new Date(y2, m2 - 1, d2);

        const day1Str = String(d1).padStart(2, '0');
        const day2Str = String(d2).padStart(2, '0');
        const mon1Str = months[m1 - 1];
        const mon2Str = months[m2 - 1];

        // Logic: 
        // Same month: "Semana del 08 al 14 Dic 2025"
        // Diff month: "Semana del 29 Dic al 04 Ene 2026"

        if (m1 === m2 && y1 === y2) {
            return `Semana del ${day1Str} al ${day2Str} ${mon1Str} ${y1}`;
        } else {
            // If years are different, we usually append the year at the end.
            // But if it spans years, we might want "29 Dic - 04 Ene 2026" (end year)
            return `Semana del ${day1Str} ${mon1Str} al ${day2Str} ${mon2Str} ${y2}`;
        }
    }

    async confirmCopyWeek() {
        const labelSelect = document.getElementById('filter-weekly-freq-label');
        const sourceLabel = labelSelect ? labelSelect.value : '';
        const start = document.getElementById('copy-start-date').value;
        const end = document.getElementById('copy-end-date').value;

        if (!start || !end) {
            alert('Debes seleccionar fecha de inicio y fin.');
            return;
        }

        const newLabel = this.generateWeekLabel(start, end);
        const newValidFrom = start; // YYYY-MM-DD

        try {
            // 1. Get source data
            const sourceData = await window.dataManager.getWeeklyFrequencies(sourceLabel);
            if (!sourceData || sourceData.length === 0) {
                alert('No hay datos en la semana origen.');
                return;
            }

            // 2. Prepare new data
            const newData = sourceData.map(item => {
                const { id, created_at, ...rest } = item;
                return {
                    ...rest,
                    week_label: newLabel,
                    valid_from: newValidFrom
                };
            });

            // 3. Insert
            const { error } = await window.dataManager.client.from('weekly_frequencies').insert(newData);
            if (error) throw error;

            // Close modal
            const modalEl = document.getElementById('modal-copy-week');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();

            alert(`Se copiaron ${newData.length} registros a la semana ${newLabel}.`);

            // Refresh
            if (labelSelect) {
                const opt = document.createElement('option');
                opt.value = newLabel;
                opt.textContent = newLabel;
                labelSelect.appendChild(opt);
                labelSelect.value = newLabel;
            }
            this.loadWeeklyFrequencies();

        } catch (err) {
            console.error('Error copying:', err);
            alert('Error: ' + err.message);
        }
    }

    toggleWeeklyEditMode() {
        const table = document.getElementById('table-weekly-frequencies');
        const btnEdit = document.getElementById('btn-edit-weekly-mode');
        const btnSave = document.getElementById('btn-save-weekly-changes');

        if (!table || !btnEdit || !btnSave) return;

        const isEditing = btnEdit.classList.contains('active');

        if (isEditing) {
            // Cancel edit mode
            btnEdit.classList.remove('active', 'btn-secondary');
            btnEdit.classList.add('btn-outline-primary');
            btnEdit.innerHTML = '<i class="fas fa-edit"></i> Editar Tabla';
            btnSave.classList.add('d-none');
            this.loadWeeklyFrequencies(); // Reload to discard changes
        } else {
            // Enter edit mode
            btnEdit.classList.add('active', 'btn-secondary');
            btnEdit.classList.remove('btn-outline-primary');
            btnEdit.innerHTML = '<i class="fas fa-times"></i> Cancelar';
            btnSave.classList.remove('d-none');

            // Convert cells to inputs
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(tr => {
                // Skip header rows (if any logic separates them, but here we have grouped rows)
                // We need to find the cells that contain the daily counts.
                // Based on loadWeeklyFrequencies, indices 3-9 are days (L-D) if it's a full row.
                // BUT, rowSpan logic makes this tricky.
                // Let's look at the data attributes or structure.
                // The render logic adds cells sequentially.

                // Strategy: Identify cells by their content or position.
                // The daily count cells are simple <td> with numbers.
                // We can add a class during render to identify them easily, OR infer it.
                // Let's modify loadWeeklyFrequencies to add a class 'editable-day-cell' to daily cells.

                // Since we can't easily modify loadWeeklyFrequencies right now without re-reading/writing a huge chunk,
                // let's try to select them by index.
                // However, rowSpan messes up column indices in subsequent rows.

                // Better approach: Re-render the table in "Edit Mode" explicitly.
                // But that requires duplicating render logic.

                // Alternative: Iterate cells and check if they hold a number and are not the Total column.
                // The daily cells have `airline.daily?.[dayIdx]` content.

                // Let's rely on the fact that we can attach data-id to the TR and data-field to the TD in loadWeeklyFrequencies.
                // I will modify loadWeeklyFrequencies to add data attributes to make this robust.
            });

            // Since I need to modify loadWeeklyFrequencies anyway to support robust editing, 
            // I will do that first.
            this.enableWeeklyTableEditing(table);
        }
    }

    enableWeeklyTableEditing(table) {
        const inputs = table.querySelectorAll('.weekly-freq-value');
        inputs.forEach(span => {
            const val = span.textContent;
            const field = span.dataset.field; // e.g. 'monday', 'tuesday'...
            const id = span.dataset.id;

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'form-control form-control-sm p-1 text-center';
            input.value = val;
            input.style.width = '50px';
            input.dataset.original = val;
            input.dataset.id = id;
            input.dataset.field = field;

            span.innerHTML = '';
            span.appendChild(input);
        });
    }

    async saveWeeklyChanges() {
        const table = document.getElementById('table-weekly-frequencies');
        const inputs = table.querySelectorAll('input[type="number"]');
        const updates = {}; // Map<id, { field: value }>

        inputs.forEach(input => {
            if (input.value !== input.dataset.original) {
                const id = input.dataset.id;
                const field = input.dataset.field;
                if (!updates[id]) updates[id] = {};
                updates[id][field] = parseInt(input.value) || 0;
            }
        });

        const ids = Object.keys(updates);
        if (ids.length === 0) {
            alert('No hay cambios para guardar.');
            this.toggleWeeklyEditMode();
            return;
        }

        try {
            // Process updates sequentially (or Promise.all)
            // Supabase doesn't support bulk update with different values easily.
            // We'll do parallel requests.
            const promises = ids.map(id => {
                // Recalculate weekly_total
                // We need the other days too. This is complex because we only have the changed value.
                // Ideally, we should update the specific field and let the DB handle total, 
                // OR we fetch the row, update, and save.

                // Simplified: Just update the changed fields. 
                // WARNING: weekly_total will be out of sync if we don't update it.
                // Let's calculate the new total in the UI or fetch-update.

                // Better: Update the specific day column.
                // Then trigger a stored procedure or just update weekly_total in the same call?
                // We don't have the other values here easily unless we read the row from the DOM.

                // Let's read the full row from DOM to calc total.
                // Find the row (tr) containing this input.
                // Actually, inputs are scattered.

                // Let's just update the fields. We can fix totals later or assume the user updates them?
                // No, total should be auto.

                // Let's grab the row's inputs to sum them up.
                // We need to find all inputs for a given ID.
                const rowInputs = table.querySelectorAll(`input[data-id="${id}"]`);
                let newTotal = 0;
                const rowUpdates = { ...updates[id] };

                // If we are in edit mode, all days are inputs.
                // We can sum all inputs for this ID.
                rowInputs.forEach(inp => {
                    newTotal += parseInt(inp.value) || 0;
                    // Ensure all fields are in the update object if we want to be safe, 
                    // but strictly we only need to send changed ones + total.
                    // Actually, to be safe, let's send all day values for this ID.
                    rowUpdates[inp.dataset.field] = parseInt(inp.value) || 0;
                });

                rowUpdates.weekly_total = newTotal;

                return window.dataManager.client
                    .from('weekly_frequencies')
                    .update(rowUpdates)
                    .eq('id', id);
            });

            await Promise.all(promises);

            alert('Cambios guardados exitosamente.');
            this.toggleWeeklyEditMode(); // Exit edit mode and reload

        } catch (err) {
            console.error('Error saving changes:', err);
            alert('Error al guardar cambios: ' + err.message);
        }
    }

    async loadWeeklyFrequencies() {
        try {
            const labelSelect = document.getElementById('filter-weekly-freq-label');
            const airlineSelect = document.getElementById('filter-weekly-freq-airline');
            const destSelect = document.getElementById('filter-weekly-freq-destination');

            let selectedLabel = labelSelect ? labelSelect.value : '';
            let selectedAirline = airlineSelect ? airlineSelect.value : '';
            let selectedDest = destSelect ? destSelect.value : '';

            // Fetch data based on selection. If empty, fetch latest.
            let data = await window.dataManager.getWeeklyFrequencies(selectedLabel);

            // Update headers with dates if data exists
            if (data && data.length > 0 && data[0].week_label) {
                this.updateWeeklyFreqHeaders(data[0].week_label);
            }

            // Populate selects if empty or just refresh it
            // We need all data to populate filters correctly across all history
            if (labelSelect && (labelSelect.options.length <= 1 || !selectedLabel)) {
                const allData = await window.dataManager.getWeeklyFrequencies();

                // 1. Week Labels
                const uniqueLabels = [...new Set(allData.map(item => item.week_label))];
                const currentLabel = labelSelect.value;
                labelSelect.innerHTML = '<option value="">Todas las semanas</option>';
                uniqueLabels.forEach(label => {
                    const opt = document.createElement('option');
                    opt.value = label;
                    opt.textContent = label;
                    labelSelect.appendChild(opt);
                });
                if (currentLabel) labelSelect.value = currentLabel;

                // 2. Airlines
                if (airlineSelect) {
                    const uniqueAirlines = [...new Set(allData.map(item => item.airline))].sort();
                    const currentAirline = airlineSelect.value;
                    airlineSelect.innerHTML = '<option value="">Todas</option>';
                    uniqueAirlines.forEach(airline => {
                        const opt = document.createElement('option');
                        opt.value = airline;
                        opt.textContent = airline;
                        airlineSelect.appendChild(opt);
                    });
                    if (currentAirline) airlineSelect.value = currentAirline;
                }

                // 3. Destinations (City)
                if (destSelect) {
                    const uniqueDest = [...new Set(allData.map(item => item.city))].sort();
                    const currentDest = destSelect.value;
                    destSelect.innerHTML = '<option value="">Todos</option>';
                    uniqueDest.forEach(city => {
                        const opt = document.createElement('option');
                        opt.value = city;
                        opt.textContent = city;
                        destSelect.appendChild(opt);
                    });
                    if (currentDest) destSelect.value = currentDest;
                }
            }

            // Client-side filtering for Airline and Destination
            if (selectedAirline) {
                data = data.filter(item => item.airline === selectedAirline);
            }
            if (selectedDest) {
                data = data.filter(item => item.city === selectedDest);
            }

            const tbody = document.querySelector('#table-weekly-frequencies tbody');
            tbody.innerHTML = '';

            // Group data by destination (City + IATA)
            const grouped = {};
            data.forEach(item => {
                const key = `${item.week_label}||${item.city}||${item.iata}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(item);
            });

            const processedKeys = new Set();

            data.forEach(item => {
                const key = `${item.week_label}||${item.city}||${item.iata}`;
                if (processedKeys.has(key)) return;
                processedKeys.add(key);

                const groupItems = grouped[key];

                groupItems.forEach((groupItem, index) => {
                    const tr = document.createElement('tr');
                    tr.classList.add('freq-row-hover'); // Add hover class for better UX

                    // Group Hover Logic
                    const groupId = key.replace(/[^a-zA-Z0-9]/g, '_');
                    tr.dataset.groupId = groupId;

                    tr.onmouseenter = function () {
                        const gid = this.dataset.groupId;
                        const rows = this.closest('tbody').querySelectorAll(`tr[data-group-id="${gid}"]`);
                        rows.forEach(r => r.classList.add('group-hover'));
                    };
                    tr.onmouseleave = function () {
                        const gid = this.dataset.groupId;
                        const rows = this.closest('tbody').querySelectorAll(`tr[data-group-id="${gid}"]`);
                        rows.forEach(r => r.classList.remove('group-hover'));
                    };

                    // Determine airline config (Prioritize DB values over legacy config)
                    const slug = this.slugify(groupItem.airline || 'default');
                    const legacyConfig = this.airlineConfig[slug] || this.airlineConfig['default'];
                    
                    const config = {
                        color: groupItem.color || legacyConfig.color,
                        logo: groupItem.logo || legacyConfig.logo,
                        text: (groupItem.color) ? '#ffffff' : legacyConfig.text
                    };

                    // Apply row styles
                    tr.style.backgroundColor = config.color;
                    tr.style.color = config.text;
                    tr.style.setProperty('--bs-table-bg', 'transparent');
                    tr.style.setProperty('--bs-table-accent-bg', 'transparent');

                    // Week & Route - Only for first item
                    if (index === 0) {
                        const tdWeek = document.createElement('td');
                        tdWeek.textContent = groupItem.week_label;
                        tdWeek.style.backgroundColor = '#ffffff';
                        tdWeek.style.color = '#212529';
                        tdWeek.rowSpan = groupItems.length;
                        tdWeek.style.verticalAlign = 'middle';
                        tdWeek.classList.add('shared-info-cell'); // ADDED CLASS
                        tr.appendChild(tdWeek);

                        const tdRouteId = document.createElement('td');
                        tdRouteId.textContent = groupItem.route_id || groupItem.iata || '-';
                        tdRouteId.style.backgroundColor = '#ffffff';
                        tdRouteId.style.color = '#212529';
                        tdRouteId.rowSpan = groupItems.length;
                        tdRouteId.style.verticalAlign = 'middle';
                        tdRouteId.classList.add('shared-info-cell'); // ADDED CLASS
                        tr.appendChild(tdRouteId);

                        const tdRoute = document.createElement('td');
                        tdRoute.innerHTML = `<div><strong>${groupItem.city}</strong></div><small>${groupItem.state || ''}</small>`;
                        tdRoute.style.backgroundColor = '#ffffff';
                        tdRoute.style.color = '#212529';
                        tdRoute.rowSpan = groupItems.length;
                        tdRoute.style.verticalAlign = 'middle';
                        tdRoute.classList.add('shared-info-cell'); // ADDED CLASS

                        // Add "Add Airline" button
                        const btnAdd = document.createElement('button');
                        btnAdd.className = 'btn btn-sm btn-outline-success d-block mx-auto mt-2';
                        btnAdd.style.fontSize = '0.7rem';
                        btnAdd.style.padding = '2px 6px';
                        btnAdd.innerHTML = '<i class="fas fa-plus"></i> Aerolínea';
                        btnAdd.title = 'Agregar aerolínea a este destino';
                        btnAdd.onclick = () => this.addAirlineToDestination(groupItem);
                        tdRoute.appendChild(btnAdd);

                        tr.appendChild(tdRoute);
                    }

                    // Airline
                    const tdAirline = document.createElement('td');
                    tdAirline.style.backgroundColor = '#ffffff';
                    tdAirline.style.color = config.color;
                    tdAirline.style.borderLeft = `8px solid ${config.color}`;
                    tdAirline.style.verticalAlign = 'middle';
                    tdAirline.className = 'text-center';

                    if (config.logo) {
                        let logoStyle = 'height: 24px; max-width: 100px; object-fit: contain;';
                        if (['aeromexico', 'volaris', 'mexicana'].includes(slug)) {
                            logoStyle = 'height: 55px; max-width: 140px; object-fit: contain;';
                        }
                        tdAirline.innerHTML = `<img src="images/airlines/${config.logo}" alt="${groupItem.airline}" title="${groupItem.airline}" style="${logoStyle}">`;
                    } else {
                        tdAirline.textContent = groupItem.airline;
                    }
                    tr.appendChild(tdAirline);

                    // Days
                    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
                        const td = document.createElement('td');
                        td.className = 'text-center border-start';
                        td.style.verticalAlign = 'top'; // Align top for lists
                        td.style.color = '#ffffff';
                        td.style.fontSize = '0.85rem'; // Smaller font for details
                        
                        // Show count if simple, or detail if available
                        const count = groupItem[day] || 0;
                        const detail = groupItem[day + '_detail'];
                        
                        if (detail && count > 0) {
                            td.innerHTML = `<span class="weekly-freq-value" data-field="${day}" data-id="${groupItem.id}">${detail}</span>`;
                        } else {
                            td.innerHTML = `<span class="weekly-freq-value" data-field="${day}" data-id="${groupItem.id}">${count > 0 ? count : '-'}</span>`;
                        }
                        
                        // Inherit row color
                        tr.appendChild(td);
                    });

                    // Total
                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'text-center fw-bold border-start freq-total-cell'; // Custom class for total column styling
                    tdTotal.style.verticalAlign = 'middle';
                    tdTotal.style.color = '#ffffff';
                    tdTotal.textContent = groupItem.weekly_total;
                    tr.appendChild(tdTotal);

                    // Actions
                    const tdActions = document.createElement('td');
                    tdActions.className = 'text-center border-start';
                    tdActions.style.verticalAlign = 'middle';
                    // Reset background for actions cell to be readable
                    tdActions.style.backgroundColor = '#ffffff';

                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                    btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                    btnEdit.onclick = () => this.editItem(groupItem._sourceTable || 'weekly_frequencies', groupItem);
                    tdActions.appendChild(btnEdit);

                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn btn-sm btn-outline-danger';
                    btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                    btnDelete.onclick = () => this.deleteItem(groupItem._sourceTable || 'weekly_frequencies', groupItem.id);
                    tdActions.appendChild(btnDelete);

                    tr.appendChild(tdActions);
                    tbody.appendChild(tr);
                });
            });

        } catch (error) {
            console.error('Error loading weekly frequencies:', error);
        }
    }

    async updateAnnualDataAndCharts() {
        try {
            // 1. Fetch latest monthly data
            const monthly = await window.dataManager.getMonthlyOperations();

            // 2. Calculate Annual Data in memory
            const byYear = {};
            monthly.forEach(row => {
                const y = String(row.year || '');
                if (!byYear[y]) byYear[y] = {
                    year: y,
                    comercial_ops_total: 0, comercial_pax_total: 0,
                    general_ops_total: 0, general_pax_total: 0,
                    carga_ops_total: 0, carga_tons_total: 0
                };
                byYear[y].comercial_ops_total += Number(row.comercial_ops) || 0;
                byYear[y].comercial_pax_total += Number(row.comercial_pax) || 0;
                byYear[y].general_ops_total += Number(row.general_ops) || 0;
                byYear[y].general_pax_total += Number(row.general_pax) || 0;
                byYear[y].carga_ops_total += Number(row.carga_ops) || 0;
                byYear[y].carga_tons_total += Number(row.carga_tons) || 0;
            });

            // 3. Update UI (Charts) IMMEDIATELY using in-memory data
            if (!window.staticData) window.staticData = {};

            // Map Monthly for Charts
            const mappedMonthly = {
                comercial: [], comercialPasajeros: [],
                carga: [], cargaToneladas: [],
                general: { operaciones: [], pasajeros: [] }
            };
            const getMonthName = (monthCode) => {
                const map = { '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre' };
                const key = String(monthCode).padStart(2, '0');
                return map[key] || key;
            };
            monthly.forEach(m => {
                const label = getMonthName(m.month);
                mappedMonthly.comercial.push({ mes: m.month, operaciones: m.comercial_ops, label });
                mappedMonthly.comercialPasajeros.push({ mes: m.month, pasajeros: m.comercial_pax, label });
                mappedMonthly.carga.push({ mes: m.month, operaciones: m.carga_ops, label });
                mappedMonthly.cargaToneladas.push({ mes: m.month, toneladas: m.carga_tons, label });
                mappedMonthly.general.operaciones.push({ mes: m.month, operaciones: m.general_ops, label });
                mappedMonthly.general.pasajeros.push({ mes: m.month, pasajeros: m.general_pax, label });
            });
            window.staticData.mensual2025 = mappedMonthly;

            // Map Annual for Charts (using calculated byYear)
            const annualDataList = Object.values(byYear).sort((a, b) => Number(b.year) - Number(a.year));
            const mappedAnnual = { comercial: [], carga: [], general: [] };
            annualDataList.forEach(a => {
                mappedAnnual.comercial.push({ periodo: a.year, operaciones: a.comercial_ops_total, pasajeros: a.comercial_pax_total });
                mappedAnnual.carga.push({ periodo: a.year, operaciones: a.carga_ops_total, toneladas: a.carga_tons_total });
                mappedAnnual.general.push({ periodo: a.year, operaciones: a.general_ops_total, pasajeros: a.general_pax_total });
            });
            window.staticData.operacionesTotales = mappedAnnual;

            // Render Charts
            if (typeof window.renderOperacionesTotales === 'function') {
                window.renderOperacionesTotales();
            }

            // 4. Update Annual Table UI (using calculated data directly to be fast)
            this.renderAnnualTableFromData(annualDataList);

            // 5. Persist to DB (Background)
            const updatePromises = Object.keys(byYear).map(year =>
                window.dataManager.upsertAnnualOperation(year, byYear[year])
            );

            // Optional: Log when done
            Promise.all(updatePromises).then(() => {
                console.log('Annual data synced to DB');
            }).catch(err => console.error('Error saving annual data:', err));

        } catch (e) {
            console.error('Error updating charts and annual data:', e);
        }
    }

    async syncChartsData() {
        try {
            const monthly = await window.dataManager.getMonthlyOperations();
            const annual = await window.dataManager.getAnnualOperations();

            if (!window.staticData) window.staticData = {};

            const mappedMonthly = {
                comercial: [], comercialPasajeros: [],
                carga: [], cargaToneladas: [],
                general: { operaciones: [], pasajeros: [] }
            };

            const getMonthName = (monthCode) => {
                const map = { '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre' };
                const key = String(monthCode).padStart(2, '0');
                return map[key] || key;
            };

            monthly.forEach(m => {
                const label = getMonthName(m.month);
                mappedMonthly.comercial.push({ mes: m.month, operaciones: m.comercial_ops, label });
                mappedMonthly.comercialPasajeros.push({ mes: m.month, pasajeros: m.comercial_pax, label });
                mappedMonthly.carga.push({ mes: m.month, operaciones: m.carga_ops, label });
                mappedMonthly.cargaToneladas.push({ mes: m.month, toneladas: m.carga_tons, label });
                mappedMonthly.general.operaciones.push({ mes: m.month, operaciones: m.general_ops, label });
                mappedMonthly.general.pasajeros.push({ mes: m.month, pasajeros: m.general_pax, label });
            });

            window.staticData.mensual2025 = mappedMonthly;

            const mappedAnnual = {
                comercial: [],
                carga: [],
                general: []
            };

            annual.forEach(a => {
                mappedAnnual.comercial.push({ periodo: a.year, operaciones: a.comercial_ops_total, pasajeros: a.comercial_pax_total });
                mappedAnnual.carga.push({ periodo: a.year, operaciones: a.carga_ops_total, toneladas: a.carga_tons_total });
                mappedAnnual.general.push({ periodo: a.year, operaciones: a.general_ops_total, pasajeros: a.general_pax_total });
            });

            window.staticData.operacionesTotales = mappedAnnual;

            if (typeof window.renderOperacionesTotales === 'function') {
                window.renderOperacionesTotales();
            }
        } catch (e) {
            console.error('Error syncing charts data:', e);
        }
    }

    // --- International Weekly Frequencies ---

    async loadWeeklyFrequenciesInt() {
        try {
            const labelSelect = document.getElementById('filter-weekly-freq-int-label');
            const airlineSelect = document.getElementById('filter-weekly-freq-int-airline');
            const destSelect = document.getElementById('filter-weekly-freq-int-destination');

            let selectedLabel = labelSelect ? labelSelect.value : '';
            let selectedAirline = airlineSelect ? airlineSelect.value : '';
            let selectedDest = destSelect ? destSelect.value : '';

            // Fetch data based on selection. If empty, fetch latest.
            let data = await window.dataManager.getWeeklyFrequenciesInt(selectedLabel);

            // Update headers with dates if data exists
            if (data && data.length > 0 && data[0].week_label) {
                this.updateWeeklyFreqHeaders(data[0].week_label, 'table-weekly-frequencies-int');
            }

            if (labelSelect && (labelSelect.options.length <= 1 || !selectedLabel)) {
                const allData = await window.dataManager.getWeeklyFrequenciesInt();

                const uniqueLabels = [...new Set(allData.map(item => item.week_label))];
                const currentLabel = labelSelect.value;
                labelSelect.innerHTML = '<option value="">Todas las semanas</option>';
                uniqueLabels.forEach(label => {
                    const opt = document.createElement('option');
                    opt.value = label;
                    opt.textContent = label;
                    labelSelect.appendChild(opt);
                });
                if (currentLabel) labelSelect.value = currentLabel;

                if (airlineSelect) {
                    const uniqueAirlines = [...new Set(allData.map(item => item.airline))].sort();
                    const currentAirline = airlineSelect.value;
                    airlineSelect.innerHTML = '<option value="">Todas</option>';
                    uniqueAirlines.forEach(airline => {
                        const opt = document.createElement('option');
                        opt.value = airline;
                        opt.textContent = airline;
                        airlineSelect.appendChild(opt);
                    });
                    if (currentAirline) airlineSelect.value = currentAirline;
                }

                if (destSelect) {
                    const uniqueDest = [...new Set(allData.map(item => item.city))].sort();
                    const currentDest = destSelect.value;
                    destSelect.innerHTML = '<option value="">Todas</option>';
                    uniqueDest.forEach(city => {
                        const opt = document.createElement('option');
                        opt.value = city;
                        opt.textContent = city;
                        destSelect.appendChild(opt);
                    });
                    if (currentDest) destSelect.value = currentDest;
                }
            }

            if (selectedAirline) {
                data = data.filter(item => item.airline === selectedAirline);
            }
            if (selectedDest) {
                data = data.filter(item => item.city === selectedDest);
            }

            const tbody = document.querySelector('#table-weekly-frequencies-int tbody');
            tbody.innerHTML = '';

            // Manual mapping for clean international names
            const IATA_LOCATIONS = {
                'HAV': { city: 'La Habana', country: 'Cuba' },
                'PUJ': { city: 'Punta Cana', country: 'República Dominicana' },
                'SDQ': { city: 'Santo Domingo', country: 'República Dominicana' },
                'BOG': { city: 'Bogotá', country: 'Colombia' },
                'CCS': { city: 'Caracas', country: 'Venezuela' },
                'PTY': { city: 'Ciudad de Panamá', country: 'Panamá' },
                'IAH': { city: 'Houston', country: 'Estados Unidos' },
                'MIA': { city: 'Miami', country: 'Estados Unidos' },
                'JFK': { city: 'Nueva York', country: 'Estados Unidos' },
                'ORD': { city: 'Chicago', country: 'Estados Unidos' },
                'DFW': { city: 'Dallas', country: 'Estados Unidos' },
                'MAD': { city: 'Madrid', country: 'España' },
                'CDG': { city: 'París', country: 'Francia' },
                'AMS': { city: 'Ámsterdam', country: 'Países Bajos' },
                'LHR': { city: 'Londres', country: 'Reino Unido' },
                'FRA': { city: 'Fráncfort', country: 'Alemania' },
                'DOH': { city: 'Doha', country: 'Catar' },
                'ICN': { city: 'Seúl', country: 'Corea del Sur' },
                'NRT': { city: 'Tokio', country: 'Japón' },
                'HKG': { city: 'Hong Kong', country: 'China' },
                'YYZ': { city: 'Toronto', country: 'Canadá' },
                'YVR': { city: 'Vancouver', country: 'Canadá' },
                'YUL': { city: 'Montreal', country: 'Canadá' },
                'LIM': { city: 'Lima', country: 'Perú' },
                'SCL': { city: 'Santiago', country: 'Chile' },
                'EZE': { city: 'Buenos Aires', country: 'Argentina' },
                'GRU': { city: 'São Paulo', country: 'Brasil' },
                'GIG': { city: 'Río de Janeiro', country: 'Brasil' },
                'MCALLEN': { city: 'McAllen', country: 'Estados Unidos' },
                'MFE': { city: 'McAllen', country: 'Estados Unidos' }
            };

            const grouped = {};
            data.forEach(item => {
                const key = `${item.week_label}||${item.city}||${item.iata}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(item);
            });

            const processedKeys = new Set();

            data.forEach(item => {
                const key = `${item.week_label}||${item.city}||${item.iata}`;
                if (processedKeys.has(key)) return;
                processedKeys.add(key);

                const groupItems = grouped[key];

                groupItems.forEach((groupItem, index) => {
                    const tr = document.createElement('tr');
                    tr.classList.add('freq-row-hover'); // Add hover class for better UX

                    // Group Hover Logic
                    const groupId = key.replace(/[^a-zA-Z0-9]/g, '_');
                    tr.dataset.groupId = groupId;

                    tr.onmouseenter = function () {
                        const gid = this.dataset.groupId;
                        const rows = this.closest('tbody').querySelectorAll(`tr[data-group-id="${gid}"]`);
                        rows.forEach(r => r.classList.add('group-hover'));
                    };
                    tr.onmouseleave = function () {
                        const gid = this.dataset.groupId;
                        const rows = this.closest('tbody').querySelectorAll(`tr[data-group-id="${gid}"]`);
                        rows.forEach(r => r.classList.remove('group-hover'));
                    };

                    const slug = this.slugify(groupItem.airline || 'default');
                    const config = this.airlineConfig[slug] || this.airlineConfig['default'];

                    tr.style.backgroundColor = config.color;
                    tr.style.color = config.text;
                    tr.style.setProperty('--bs-table-bg', 'transparent');
                    tr.style.setProperty('--bs-table-accent-bg', 'transparent');

                    if (index === 0) {
                        const tdWeek = document.createElement('td');
                        tdWeek.textContent = groupItem.week_label;
                        tdWeek.style.backgroundColor = '#ffffff';
                        tdWeek.style.color = '#212529';
                        tdWeek.rowSpan = groupItems.length;
                        tdWeek.style.verticalAlign = 'middle';
                        tdWeek.classList.add('shared-info-cell'); // ADDED CLASS
                        tr.appendChild(tdWeek);

                        const tdRouteId = document.createElement('td');
                        tdRouteId.textContent = groupItem.route_id || groupItem.iata || '-';
                        tdRouteId.style.backgroundColor = '#ffffff';
                        tdRouteId.style.color = '#212529';
                        tdRouteId.rowSpan = groupItems.length;
                        tdRouteId.style.verticalAlign = 'middle';
                        tdRouteId.classList.add('shared-info-cell'); // ADDED CLASS
                        tr.appendChild(tdRouteId);

                        let cityName = groupItem.city;
                        let stateName = groupItem.state;
                        
                        if (IATA_LOCATIONS[groupItem.iata]) {
                             cityName = IATA_LOCATIONS[groupItem.iata].city;
                             stateName = IATA_LOCATIONS[groupItem.iata].country;
                        }

                        const tdRoute = document.createElement('td');
                        tdRoute.innerHTML = `<div><strong>${cityName}</strong></div><small>${stateName || ''} (${groupItem.iata})</small>`;
                        tdRoute.style.backgroundColor = '#ffffff';
                        tdRoute.style.color = '#212529';
                        tdRoute.rowSpan = groupItems.length;
                        tdRoute.style.verticalAlign = 'middle';
                        tdRoute.classList.add('shared-info-cell'); // ADDED CLASS

                        const btnAdd = document.createElement('button');
                        btnAdd.className = 'btn btn-sm btn-outline-success d-block mx-auto mt-2';
                        btnAdd.style.fontSize = '0.7rem';
                        btnAdd.style.padding = '2px 6px';
                        btnAdd.innerHTML = '<i class="fas fa-plus"></i> Aerolínea';
                        btnAdd.title = 'Agregar aerolínea a este destino';
                        btnAdd.onclick = () => this.addInternationalAirlineToDestination(groupItem);
                        tdRoute.appendChild(btnAdd);

                        tr.appendChild(tdRoute);
                    }

                    const tdAirline = document.createElement('td');
                    tdAirline.style.backgroundColor = '#ffffff';
                    tdAirline.style.color = config.color;
                    tdAirline.style.borderLeft = `8px solid ${config.color}`;
                    tdAirline.style.verticalAlign = 'middle';
                    tdAirline.className = 'text-center';

                    if (config.logo) {
                        let logoStyle = 'height: 24px; max-width: 100px; object-fit: contain;';
                        if (['aeromexico', 'volaris', 'mexicana', 'copa', 'avianca'].includes(slug)) {
                            logoStyle = 'height: 40px; max-width: 120px; object-fit: contain;';
                        }
                        tdAirline.innerHTML = `<img src="images/airlines/${config.logo}" alt="${groupItem.airline}" title="${groupItem.airline}" style="${logoStyle}">`;
                    } else {
                        tdAirline.textContent = groupItem.airline;
                    }
                    tr.appendChild(tdAirline);

                    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
                        const td = document.createElement('td');
                        td.className = 'text-center border-start';
                        td.style.verticalAlign = 'middle';
                        td.style.color = '#ffffff';
                        td.innerHTML = `<span class="weekly-freq-value" data-field="${day}" data-id="${groupItem.id}">${groupItem[day] || 0}</span>`;
                        tr.appendChild(td);
                    });

                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'text-center fw-bold border-start freq-total-cell'; // Custom class for total column styling
                    tdTotal.style.verticalAlign = 'middle';
                    tdTotal.style.color = '#ffffff';
                    tdTotal.textContent = groupItem.weekly_total;
                    tr.appendChild(tdTotal);

                    const tdActions = document.createElement('td');
                    tdActions.className = 'text-center border-start';
                    tdActions.style.verticalAlign = 'middle';
                    tdActions.style.backgroundColor = '#ffffff';

                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                    btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                    btnEdit.onclick = () => this.editItem('weekly_frequencies_int', groupItem);
                    tdActions.appendChild(btnEdit);

                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn btn-sm btn-outline-danger';
                    btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                    btnDelete.onclick = () => this.deleteItem('weekly_frequencies_int', groupItem.id);
                    tdActions.appendChild(btnDelete);

                    tr.appendChild(tdActions);
                    tbody.appendChild(tr);
                });
            });

        } catch (error) {
            console.error('Error loading international weekly frequencies:', error);
        }
    }

    addInternationalAirlineToDestination(templateItem) {
        const defaults = {
            week_label: templateItem.week_label,
            valid_from: templateItem.valid_from,
            valid_to: templateItem.valid_to,
            route_id: templateItem.route_id,
            city: templateItem.city,
            state: templateItem.state,
            iata: templateItem.iata,
            airline: '',
            monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0, weekly_total: 0
        };

        const schema = this.schemas['weekly_frequencies_int'];
        if (schema) {
            window.adminUI.openEditModal('weekly_frequencies_int', defaults, schema);
        }
    }

    openCopyWeekModalInt() {
        const labelSelect = document.getElementById('filter-weekly-freq-int-label');
        const sourceLabel = labelSelect ? labelSelect.value : '';

        if (!sourceLabel) {
            alert('Por favor selecciona una semana origen primero.');
            return;
        }

        document.getElementById('copy-source-week-label').textContent = sourceLabel;

        const startDateInput = document.getElementById('copy-start-date');
        const endDateInput = document.getElementById('copy-end-date');
        startDateInput.value = '';
        endDateInput.value = '';
        document.getElementById('copy-preview-label').textContent = '';

        const btnConfirm = document.querySelector('#modal-copy-week .btn-primary');
        const newBtn = btnConfirm.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);

        newBtn.onclick = () => this.confirmCopyWeekInt();

        startDateInput.onchange = () => {
            const startVal = startDateInput.value;
            if (startVal) {
                const [y, m, d] = startVal.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                date.setDate(date.getDate() + 6);

                const yEnd = date.getFullYear();
                const mEnd = String(date.getMonth() + 1).padStart(2, '0');
                const dEnd = String(date.getDate()).padStart(2, '0');

                endDateInput.value = `${yEnd}-${mEnd}-${dEnd}`;
            }
            this.updateCopyPreview();
        };
        endDateInput.onchange = () => this.updateCopyPreview();

        const modal = new bootstrap.Modal(document.getElementById('modal-copy-week'));
        modal.show();
    }

    async confirmCopyWeekInt() {
        const labelSelect = document.getElementById('filter-weekly-freq-int-label');
        const sourceLabel = labelSelect ? labelSelect.value : '';
        const start = document.getElementById('copy-start-date').value;
        const end = document.getElementById('copy-end-date').value;

        if (!start || !end) {
            alert('Debes seleccionar fecha de inicio y fin.');
            return;
        }

        const newLabel = this.generateWeekLabel(start, end);
        const newValidFrom = start;

        try {
            const sourceData = await window.dataManager.getWeeklyFrequenciesInt(sourceLabel);
            if (!sourceData || sourceData.length === 0) {
                alert('No hay datos en la semana origen.');
                return;
            }

            const newData = sourceData.map(item => {
                const { id, created_at, ...rest } = item;
                return {
                    ...rest,
                    week_label: newLabel,
                    valid_from: newValidFrom
                };
            });

            const { error } = await window.dataManager.client.from('weekly_frequencies_int').insert(newData);
            if (error) throw error;

            const modalEl = document.getElementById('modal-copy-week');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();

            alert(`Se copiaron ${newData.length} registros internacionales a la semana ${newLabel}.`);

            if (labelSelect) {
                labelSelect.innerHTML = '';
                await this.loadWeeklyFrequenciesInt();
                labelSelect.value = newLabel;
                this.loadWeeklyFrequenciesInt();
            }

        } catch (err) {
            console.error('Error copying week:', err);
            alert('Error al copiar: ' + err.message);
        }
    }

    async deleteWeeklyTemplateInt() {
        const labelSelect = document.getElementById('filter-weekly-freq-int-label');
        const currentLabel = labelSelect ? labelSelect.value : '';

        if (!currentLabel) {
            alert('Por favor selecciona una semana para eliminar.');
            return;
        }

        if (!confirm(`¿Estás seguro de que deseas ELIMINAR TODAS las frecuencias internacionales de la semana "${currentLabel}"?\n\nEsta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const { error } = await window.dataManager.client
                .from('weekly_frequencies_int')
                .delete()
                .eq('week_label', currentLabel);

            if (error) throw error;

            alert(`Semana "${currentLabel}" eliminada exitosamente.`);

            if (labelSelect) {
                labelSelect.innerHTML = '';
                this.loadWeeklyFrequenciesInt();
            }

        } catch (err) {
            console.error('Error deleting week:', err);
            alert('Error al eliminar la semana: ' + err.message);
        }
    }

    toggleWeeklyEditModeInt() {
        const table = document.getElementById('table-weekly-frequencies-int');
        const btnEdit = document.getElementById('btn-edit-weekly-int-mode');
        const btnSave = document.getElementById('btn-save-weekly-int-changes');

        if (!table || !btnEdit || !btnSave) return;

        const isEditing = btnEdit.classList.contains('active');

        if (isEditing) {
            btnEdit.classList.remove('active', 'btn-secondary');
            btnEdit.classList.remove('text-white');
            btnEdit.classList.add('btn-outline-primary');
            btnEdit.innerHTML = '<i class="fas fa-edit"></i> Editar Tabla';
            btnSave.classList.add('d-none');
            this.loadWeeklyFrequenciesInt();
        } else {
            btnEdit.classList.add('active', 'btn-secondary', 'text-white');
            btnEdit.classList.remove('btn-outline-primary');
            btnEdit.innerHTML = '<i class="fas fa-times"></i> Cancelar';
            btnSave.classList.remove('d-none');
            this.enableWeeklyTableEditing(table);
        }
    }

    async saveWeeklyChangesInt() {
        const table = document.getElementById('table-weekly-frequencies-int');
        const inputs = table.querySelectorAll('input[type="number"]');
        const updates = {};

        inputs.forEach(input => {
            if (input.value !== input.dataset.original) {
                const id = input.dataset.id;
                const field = input.dataset.field;
                if (!updates[id]) updates[id] = {};
                updates[id][field] = parseInt(input.value) || 0;
            }
        });

        const ids = Object.keys(updates);
        if (ids.length === 0) {
            alert('No hay cambios para guardar.');
            this.toggleWeeklyEditModeInt();
            return;
        }

        try {
            const promises = ids.map(id => {
                const rowInputs = table.querySelectorAll(`input[data-id="${id}"]`);
                let newTotal = 0;
                const rowUpdates = { ...updates[id] };

                rowInputs.forEach(inp => {
                    const val = parseInt(inp.value) || 0;
                    rowUpdates[inp.dataset.field] = val;
                    newTotal += val;
                });

                rowUpdates.weekly_total = newTotal;

                return window.dataManager.client
                    .from('weekly_frequencies_int')
                    .update(rowUpdates)
                    .eq('id', id);
            });

            await Promise.all(promises);

            alert('Cambios guardados exitosamente.');
            this.toggleWeeklyEditModeInt();

        } catch (err) {
            console.error('Error saving changes:', err);
            alert('Error al guardar cambios: ' + err.message);
        }
    }

    // --- Library Management ---
    async loadLibraryCategories() {
        try {
            const data = await window.dataManager.getLibraryCategories();
            this.renderTable('table-library-categories', data, ['icon', 'title', 'description', 'order_index'], 'library_categories');

            // Update library_items schema categories options
            const categoryOptions = data.map(c => ({ value: c.id, label: c.title }));
            if (this.schemas.library_items) {
                const catField = this.schemas.library_items.find(f => f.name === 'category_id');
                if (catField) catField.options = categoryOptions;
            }
        } catch (error) {
            console.error('Error loading library categories:', error);
        }
    }

    async loadLibraryItems() {
        try {
            const data = await window.dataManager.getLibraryItems();
            this.renderTable('table-library-items', data, ['category_id', 'title', 'type', 'url', 'order_index'], 'library_items');
            this.renderLibraryPublic(); // Update public view too
        } catch (error) {
            console.error('Error loading library items:', error);
        }
    }

    async renderLibraryPublic() {
        const container = document.getElementById('library-dynamic-container');
        if (!container) return;

        try {
            const categories = await window.dataManager.getLibraryCategories();
            const items = await window.dataManager.getLibraryItems();

            if (!categories || categories.length === 0) {
                container.innerHTML = '<div class="col-12 text-center py-5 text-muted">No hay categorías configuradas en la biblioteca.</div>';
                return;
            }

            container.innerHTML = '';
            categories.forEach(cat => {
                const catItems = items.filter(i => i.category_id === cat.id);

                const col = document.createElement('div');
                col.className = 'col-md-6 col-lg-4 mb-4';

                let itemsHtml = '';
                catItems.forEach(item => {
                    const icon = this.getLibraryItemIcon(item.type);
                    const actionIcon = item.type === 'link' || item.type === 'info' ? 'fas fa-external-link-alt' : 'fas fa-download';
                    const target = '_blank';
                    const href = item.url || '#';

                    // Handle multiple documents as modern chips
                    let docsHtml = '';
                    if (item.documentos) {
                        try {
                            const docs = typeof item.documentos === 'string' ? JSON.parse(item.documentos) : item.documentos;
                            if (Array.isArray(docs) && docs.length > 0) {
                                docsHtml = '<div class="ms-1 mt-2 d-flex flex-wrap gap-2">';
                                docs.forEach(doc => {
                                    const docUrl = typeof doc === 'string' ? doc : doc.url;
                                    const docName = doc.name || docUrl.split('/').pop();
                                    const isPdf = docUrl.toLowerCase().endsWith('.pdf');

                                    if (isPdf) {
                                        docsHtml += `
                                            <a href="javascript:void(0)" 
                                               onclick="dataManagement.previewPdf('${docUrl}', '${docName.replace(/'/g, "\\'")}')" 
                                               class="library-doc-chip" title="Ver Documento">
                                               <i class="fas fa-file-pdf text-danger me-1"></i>${docName}
                                            </a>`;
                                    } else {
                                        docsHtml += `<a href="${docUrl}" target="_blank" class="library-doc-chip" title="Descargar"><i class="fas fa-paperclip me-1"></i>${docName}</a>`;
                                    }
                                });
                                docsHtml += '</div>';
                            }
                        } catch (e) {
                            console.warn('Error parsing documentos for item:', item.title, e);
                        }
                    }

                    const isMainPdf = href.toLowerCase().endsWith('.pdf');
                    const actionOnClick = isMainPdf ? `onclick="dataManagement.previewPdf('${href}', '${item.title.replace(/'/g, "\\'")}')"; return false;` : '';
                    const finalHref = isMainPdf ? 'javascript:void(0)' : href;

                    itemsHtml += `
                        <li class="list-group-item library-item bg-transparent">
                            <div class="d-flex justify-content-between align-items-start w-100">
                                <div class="flex-grow-1">
                                    <div class="library-item-title mb-1">
                                        <i class="${icon} me-2 icon-indicator"></i>${item.title}
                                    </div>
                                    ${docsHtml}
                                </div>
                                <a href="${finalHref}" ${actionOnClick} target="${target}" class="library-action-btn ms-2 shadow-sm" title="Abrir recurso principal">
                                    <i class="${actionIcon}"></i>
                                </a>
                            </div>
                        </li>
                    `;
                });

                col.innerHTML = `
                    <div class="card h-100 library-card shadow-sm">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center mb-0 library-cat-header border-bottom-0 pb-0">
                                <div class="library-icon-box shadow-sm me-3">
                                    <i class="${cat.icon || 'fas fa-folder'} fa-lg"></i>
                                </div>
                                <div>
                                    <h5 class="mb-0 fw-bold text-dark">${cat.title}</h5>
                                    ${cat.description ? `<p class="small text-muted mb-0 mt-1">${cat.description}</p>` : ''}
                                </div>
                            </div>
                            <hr class="my-3 opacity-25">
                            <ul class="list-group list-group-flush">
                                ${itemsHtml || '<li class="list-group-item border-0 text-center py-4 text-muted small">Sin documentos disponibles.</li>'}
                            </ul>
                        </div>
                    </div>
                `;
                container.appendChild(col);
            });

        } catch (err) {
            console.error('Error rendering public library:', err);
            container.innerHTML = '<div class="col-12 text-center py-5 text-danger">Error al cargar la biblioteca.</div>';
        }
    }

    getLibraryItemIcon(type) {
        switch (type) {
            case 'pdf': return 'far fa-file-pdf text-danger';
            case 'excel': return 'far fa-file-excel text-success';
            case 'word': return 'far fa-file-word text-primary';
            case 'link': return 'fas fa-link text-info';
            case 'info': return 'fas fa-info-circle text-secondary';
            default: return 'far fa-file text-muted';
        }
    }

    previewPdf(url, title) {
        const modalEl = document.getElementById('pdfPreviewModal');
        const iframe = document.getElementById('pdf-preview-frame');
        const titleEl = document.getElementById('pdfPreviewModalLabel');
        const downloadBtn = document.getElementById('btn-download-pdf-modal');
        const fullScreenBtn = document.getElementById('btn-full-screen-pdf-modal');

        if (modalEl && iframe) {
            iframe.src = url;
            if (titleEl) titleEl.textContent = title || 'Vista Previa de Documento';
            if (downloadBtn) downloadBtn.href = url;
            if (fullScreenBtn) fullScreenBtn.href = url;

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        }
    }

    async getSystemAlerts(onlyActive = true) {
        let query = this.client
            .from('system_alerts')
            .select('*')
            .order('created_at', { ascending: false });

        if (onlyActive) {
            query = query.eq('active', true);
        }

        const { data, error } = await query;
        if (error) {
            console.error('Error fetching alerts:', error);
            return [];
        }
        return data;
    }

    async loadSystemAlertsTable() {
        try {
            const data = await this.getSystemAlerts(false);
            const tbody = document.querySelector('#table-system-alerts tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay alertas registradas.</td></tr>';
                return;
            }

            data.forEach(item => {
                const tr = document.createElement('tr');

                // Level
                const tdLevel = document.createElement('td');
                let badgeClass = 'bg-info text-dark';
                let levelLabel = 'Informativo';
                if (item.level === 'warning') { badgeClass = 'bg-warning text-dark'; levelLabel = 'Precaución'; }
                if (item.level === 'critical') { badgeClass = 'bg-danger text-white'; levelLabel = 'Crítico'; }
                tdLevel.innerHTML = `<span class="badge ${badgeClass}">${levelLabel}</span>`;
                tr.appendChild(tdLevel);

                // Title
                const tdTitle = document.createElement('td');
                tdTitle.textContent = item.title;
                tr.appendChild(tdTitle);

                // Message
                const tdMsg = document.createElement('td');
                tdMsg.className = "text-truncate";
                tdMsg.style.maxWidth = "200px";
                tdMsg.title = item.message;
                tdMsg.textContent = item.message;
                tr.appendChild(tdMsg);

                // Active
                const tdActive = document.createElement('td');
                tdActive.innerHTML = item.active
                    ? '<span class="badge bg-success"><i class="fas fa-check"></i> Activo</span>'
                    : '<span class="badge bg-secondary">Inactivo</span>';
                tr.appendChild(tdActive);

                // Expires
                const tdExp = document.createElement('td');
                tdExp.textContent = item.expires_at ? this.formatDisplayDate(item.expires_at) : '-';
                tr.appendChild(tdExp);

                // Actions
                const tdActions = document.createElement('td');

                const btnEdit = document.createElement('button');
                btnEdit.classList.add('btn', 'btn-sm', 'btn-outline-primary', 'me-1');
                btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                btnEdit.onclick = () => this.editItem('system_alerts', item);
                tdActions.appendChild(btnEdit);

                const btnDelete = document.createElement('button');
                btnDelete.classList.add('btn', 'btn-sm', 'btn-outline-danger');
                btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                btnDelete.onclick = () => this.deleteItem('system_alerts', item.id);
                tdActions.appendChild(btnDelete);

                tr.appendChild(tdActions);
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error("Error loading system alerts table:", e);
        }
    }

    async renderPublicAlerts() {
        // Only render if container exists
        const container = document.getElementById('public-alerts-container');
        if (!container) return;

        const alerts = await this.getSystemAlerts(true);
        container.innerHTML = '';

        if (!alerts || alerts.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'flex-start';
        container.style.paddingLeft = '20px';

        alerts.forEach(alert => {
            const el = document.createElement('div');
            // Choose color based on level
            let badgeClass = 'bg-info text-dark';
            let iconClass = 'fa-info-circle';
            let borderClass = 'border-info';

            if (alert.level === 'warning') {
                badgeClass = 'bg-warning text-dark';
                iconClass = 'fa-exclamation-triangle';
                borderClass = 'border-warning';
            } else if (alert.level === 'critical') {
                badgeClass = 'bg-danger text-white';
                iconClass = 'fa-radiation';
                borderClass = 'border-danger';
            }

            el.className = `alert-item aero-alert ${borderClass}`;

            // Icon logic to override general icon with a plane for the nose if desired, 
            // but keep the status icon inside or nearby. 
            // Let's use the status icon in the "cockpit".

            el.innerHTML = `
                <div class="aero-nose ${badgeClass}">
                    <i class="fas ${iconClass} fa-lg"></i>
                </div>
                <div class="aero-body">
                    <div class="d-flex align-items-center mb-1">
                        <h5 class="aero-title mb-0 fw-bold">${alert.title}</h5>
                        <i class="fas fa-plane text-primary fa-plane-alert ms-3" style="font-size: 1.2rem;"></i>
                    </div>
                    <p class="aero-message mb-0 text-secondary small text-truncate" style="max-width: 250px;">${alert.message || ''}</p>
                </div>
                <button type="button" class="btn-close ms-2 me-2 align-self-center" aria-label="Close" onclick="this.parentElement.remove()"></button>
            `;
            container.appendChild(el);
        });
    }

    // --- Cargo Weekly Frequencies ---

    async loadWeeklyFrequenciesCargo(forceRefresh = false) {
        try {
            const labelSelect = document.getElementById('filter-weekly-freq-cargo-label');
            const airlineSelect = document.getElementById('filter-weekly-freq-cargo-airline');
            // No destination filter for cargo usually needed or requested yet, but can add if needed.
            
            let selectedLabel = labelSelect ? labelSelect.value : '';
            let selectedAirline = airlineSelect ? airlineSelect.value : '';

            // Fetch data based on selection. If empty, fetch latest.
            let data = await window.dataManager.getWeeklyFrequenciesCargo(selectedLabel);

            // Update headers with dates if data exists
            if (data && data.length > 0 && data[0].week_label) {
                this.updateWeeklyFreqHeaders(data[0].week_label, 'table-weekly-frequencies-cargo');
            }

            if (labelSelect && (labelSelect.options.length <= 1 || !selectedLabel || forceRefresh)) {
                const allData = await window.dataManager.getWeeklyFrequenciesCargo();

                const uniqueLabels = [...new Set(allData.map(item => item.week_label))];
                // Keep selection if exists and still valid
                const currentLabel = labelSelect.value;
                
                labelSelect.innerHTML = '<option value="">Todas las semanas</option>';
                uniqueLabels.forEach(label => {
                    const opt = document.createElement('option');
                    opt.value = label;
                    opt.textContent = label;
                    labelSelect.appendChild(opt);
                });
                
                if (currentLabel && uniqueLabels.includes(currentLabel)) {
                    labelSelect.value = currentLabel;
                } else if (uniqueLabels.length > 0 && !currentLabel) {
                     // Auto select first (latest)
                     // labelSelect.value = uniqueLabels[0];
                }

                if (airlineSelect) {
                    const uniqueAirlines = [...new Set(allData.map(item => item.airline))].sort();
                    const currentAirline = airlineSelect.value;
                    airlineSelect.innerHTML = '<option value="">Todas</option>';
                    uniqueAirlines.forEach(airline => {
                        const opt = document.createElement('option');
                        opt.value = airline;
                        opt.textContent = airline;
                        airlineSelect.appendChild(opt);
                    });
                    if (currentAirline) airlineSelect.value = currentAirline;
                }
            }

            if (selectedAirline) {
                data = data.filter(item => item.airline === selectedAirline);
            }

            // Ensure route_id is number for sorting
            data.sort((a, b) => (Number(a.route_id) || 999) - (Number(b.route_id) || 999));

            const tbody = document.querySelector('#table-weekly-frequencies-cargo tbody');
            tbody.innerHTML = '';

            const grouped = {};
            data.forEach(item => {
                // Group by Week + City + Airline (since Cargo routes might be specific per airline)
                // Or just match the passenger grouping: Week + City + Code
                const key = `${item.week_label}||${item.city}||${item.iata}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(item);
            });

            const processedKeys = new Set();

            data.forEach(item => {
                const key = `${item.week_label}||${item.city}||${item.iata}`;
                if (processedKeys.has(key)) return;
                processedKeys.add(key);

                const groupItems = grouped[key];

                groupItems.forEach((groupItem, index) => {
                    const tr = document.createElement('tr');
                    tr.classList.add('freq-row-hover'); // Add hover class for better UX

                    // Group Hover Logic
                    const groupId = key.replace(/[^a-zA-Z0-9]/g, '_');
                    tr.dataset.groupId = groupId;

                    tr.onmouseenter = function () {
                        const gid = this.dataset.groupId;
                        const rows = this.closest('tbody').querySelectorAll(`tr[data-group-id="${gid}"]`);
                        rows.forEach(r => r.classList.add('group-hover'));
                    };
                    tr.onmouseleave = function () {
                        const gid = this.dataset.groupId;
                        const rows = this.closest('tbody').querySelectorAll(`tr[data-group-id="${gid}"]`);
                        rows.forEach(r => r.classList.remove('group-hover'));
                    };

                    const slug = this.slugify(groupItem.airline || 'default');
                    const config = this.airlineConfig[slug] || this.airlineConfig['default'];

                    // Force red theme for cargo if not defined, but rely on airline config mostly
                    // If no specific color, maybe default to Warning/Orange/Red?
                    // But we used config color in styling.
                    
                    tr.style.backgroundColor = config.color;
                    tr.style.color = config.text;
                    tr.style.setProperty('--bs-table-bg', 'transparent');
                    tr.style.setProperty('--bs-table-accent-bg', 'transparent');

                    if (index === 0) {
                        const tdWeek = document.createElement('td');
                        tdWeek.textContent = groupItem.week_label;
                        tdWeek.style.backgroundColor = '#ffffff'; 
                        tdWeek.style.color = '#212529';
                        tdWeek.rowSpan = groupItems.length;
                        tdWeek.style.verticalAlign = 'middle';
                        tdWeek.classList.add('shared-info-cell');
                        tr.appendChild(tdWeek);

                        const tdRouteId = document.createElement('td');
                        tdRouteId.textContent = groupItem.route_id || '-';
                        tdRouteId.style.backgroundColor = '#ffffff';
                        tdRouteId.style.color = '#212529';
                        tdRouteId.rowSpan = groupItems.length;
                        tdRouteId.style.verticalAlign = 'middle';
                        tdRouteId.classList.add('shared-info-cell');
                        tr.appendChild(tdRouteId);

                        const tdRoute = document.createElement('td');
                        tdRoute.innerHTML = `<div><strong>${groupItem.city}</strong></div><small>${groupItem.state || ''} (${groupItem.iata})</small>`;
                        tdRoute.style.backgroundColor = '#ffffff';
                        tdRoute.style.color = '#212529';
                        tdRoute.rowSpan = groupItems.length;
                        tdRoute.style.verticalAlign = 'middle';
                        tdRoute.classList.add('shared-info-cell');

                        const btnAdd = document.createElement('button');
                        btnAdd.className = 'btn btn-sm btn-outline-warning d-block mx-auto mt-2';
                        btnAdd.style.fontSize = '0.7rem';
                        btnAdd.style.padding = '2px 6px';
                        btnAdd.innerHTML = '<i class="fas fa-plus"></i> Aerolínea';
                        btnAdd.title = 'Agregar aerolínea a este destino de Carga';
                        btnAdd.onclick = () => this.addCargoAirlineToDestination(groupItem);
                        tdRoute.appendChild(btnAdd);

                        tr.appendChild(tdRoute);
                    }

                    const tdAirline = document.createElement('td');
                    tdAirline.style.backgroundColor = '#ffffff';
                    tdAirline.style.color = config.color;
                    tdAirline.style.borderLeft = `8px solid ${config.color}`;
                    tdAirline.style.verticalAlign = 'middle';
                    tdAirline.className = 'text-center';

                    if (config.logo) {
                         const logoStyle = 'height: 35px; max-width: 120px; object-fit: contain;';
                         tdAirline.innerHTML = `<img src="images/airlines/${config.logo}" alt="${groupItem.airline}" title="${groupItem.airline}" style="${logoStyle}">`;
                    } else {
                        tdAirline.textContent = groupItem.airline || 'UNK';
                    }
                    tr.appendChild(tdAirline);

                    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
                        const td = document.createElement('td');
                        td.className = 'text-center border-start';
                        td.style.verticalAlign = 'middle';
                        td.style.color = '#ffffff'; 
                        td.style.color = config.text; 
                        
                        // Show tooltip with details if available (detail columns need to be selected from DB)
                        // In RPC we added monday_detail etc.
                        // We should probably show them in title attribute
                        const details = groupItem[day + '_detail'] || '';
                        
                        // We can use a spanned structure: Num <br> List
                        // But table cell is small. Tooltip is better.
                        const val = groupItem[day] || 0;
                        const span = document.createElement('span');
                        span.className = 'weekly-freq-value';
                        span.dataset.field = day;
                        span.dataset.id = groupItem.id;
                        span.textContent = val;
                        if (details) span.title = details.replace(/<br>/g, '\n');
                        
                        td.appendChild(span);
                        tr.appendChild(td);
                    });

                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'text-center fw-bold border-start freq-total-cell';
                    tdTotal.style.verticalAlign = 'middle';
                    tdTotal.style.color = config.text;
                    tdTotal.textContent = groupItem.weekly_total;
                    tr.appendChild(tdTotal);

                    const tdActions = document.createElement('td');
                    tdActions.className = 'text-center border-start';
                    tdActions.style.verticalAlign = 'middle';
                    tdActions.style.backgroundColor = '#ffffff';

                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn btn-sm btn-outline-primary me-1';
                    btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
                    btnEdit.onclick = () => this.editItem('weekly_frequencies_cargo', groupItem);
                    tdActions.appendChild(btnEdit);

                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn btn-sm btn-outline-danger';
                    btnDelete.innerHTML = '<i class="fas fa-trash"></i>';
                    btnDelete.onclick = () => this.deleteItem('weekly_frequencies_cargo', groupItem.id);
                    tdActions.appendChild(btnDelete);

                    tr.appendChild(tdActions);
                    tbody.appendChild(tr);
                });
            });

        } catch (error) {
            console.error('Error loading cargo weekly frequencies:', error);
        }
    }

    async loadWeeklyFrequenciesPlayas(forceRefresh = false) {
        // Destinos de playa nacionales (IATA)
        const BEACH_NAC = new Set(['CUN','PVR','SJD','ACA','MZT','HUX','ZIH','ZLO','CZM','LTO','LAP','CTM']);
        // Destinos de playa internacionales (IATA)
        const BEACH_INT = new Set(['PUJ','HAV','SJU','BGI','HNL','KIN','LIR','MBJ','NAS','FPO','SDQ','CZM']);

        try {
            const labelSelect = document.getElementById('filter-weekly-freq-playas-label');
            const tipoSelect  = document.getElementById('filter-weekly-freq-playas-tipo');

            const selectedLabel = labelSelect ? labelSelect.value : '';
            const selectedTipo  = tipoSelect  ? tipoSelect.value  : '';

            // Fetch national and international concurrently
            const [nacData, intData] = await Promise.all([
                window.dataManager.getWeeklyFrequencies(selectedLabel || undefined),
                window.dataManager.getWeeklyFrequenciesInt(selectedLabel || undefined)
            ]);

            // Populate week label filter once
            if (labelSelect && (forceRefresh || labelSelect.options.length <= 1 || !selectedLabel)) {
                const allLabels = new Set([
                    ...nacData.map(i => i.week_label),
                    ...intData.map(i => i.week_label)
                ]);
                const sortedLabels = [...allLabels].filter(Boolean).sort().reverse();
                const prevLabel = labelSelect.value;
                labelSelect.innerHTML = '<option value="">Todas las semanas</option>';
                sortedLabels.forEach(label => {
                    const opt = document.createElement('option');
                    opt.value = label;
                    opt.textContent = label;
                    labelSelect.appendChild(opt);
                });
                if (prevLabel) labelSelect.value = prevLabel;
            }

            // Filter by beach IATA codes and tag type
            const nacBeach = nacData
                .filter(item => item.iata && BEACH_NAC.has(item.iata.toUpperCase()))
                .map(item => ({ ...item, _tipo: 'Nacional' }));

            const intBeach = intData
                .filter(item => item.iata && BEACH_INT.has(item.iata.toUpperCase()))
                .map(item => ({ ...item, _tipo: 'Internacional' }));

            let combined = [...nacBeach, ...intBeach];
            if (selectedTipo) {
                combined = combined.filter(item => item._tipo === selectedTipo);
            }

            // Sort: Nacional first, then by city
            combined.sort((a, b) => {
                if (a._tipo !== b._tipo) return a._tipo === 'Nacional' ? -1 : 1;
                return (a.city || '').localeCompare(b.city || '');
            });

            // Render summary cards
            this._renderPlayasSummaryCards(combined);

            // Render table
            const tbody = document.querySelector('#table-weekly-frequencies-playas tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (combined.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-4"><i class="fas fa-umbrella-beach me-2"></i>No se encontraron destinos de playa para la semana seleccionada.</td></tr>';
                return;
            }

            combined.forEach(item => {
                const tr = document.createElement('tr');
                const slug = this.slugify(item.airline || 'default');
                const legacyConfig = this.airlineConfig[slug] || this.airlineConfig['default'];
                const color     = item.color || legacyConfig.color;
                const textColor = item.color ? '#ffffff' : legacyConfig.text;

                // Semana
                const tdWeek = document.createElement('td');
                tdWeek.textContent = item.week_label || '-';
                tdWeek.style.verticalAlign = 'middle';
                tdWeek.style.fontSize = '0.82rem';
                tr.appendChild(tdWeek);

                // Destino
                const tdDest = document.createElement('td');
                tdDest.style.verticalAlign = 'middle';
                tdDest.innerHTML = `<strong>${item.city || item.iata}</strong><br><small class="text-muted">${item.iata || ''}</small>`;
                tr.appendChild(tdDest);

                // Tipo
                const tdTipo = document.createElement('td');
                tdTipo.className = 'text-center';
                tdTipo.style.verticalAlign = 'middle';
                tdTipo.innerHTML = item._tipo === 'Nacional'
                    ? '<span class="badge bg-danger">Nacional</span>'
                    : '<span class="badge bg-primary">Internacional</span>';
                tr.appendChild(tdTipo);

                // Aerolínea
                const tdAirline = document.createElement('td');
                tdAirline.style.backgroundColor = '#ffffff';
                tdAirline.style.color = color;
                tdAirline.style.borderLeft = `6px solid ${color}`;
                tdAirline.style.verticalAlign = 'middle';
                tdAirline.className = 'text-center';
                const logo = item.logo || legacyConfig.logo;
                if (logo) {
                    tdAirline.innerHTML = `<img src="images/airlines/${logo}" alt="${item.airline}" title="${item.airline}" style="height:24px;max-width:100px;object-fit:contain;">`;
                } else {
                    tdAirline.textContent = item.airline || '-';
                }
                tr.appendChild(tdAirline);

                // Días L-D
                ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach(day => {
                    const td = document.createElement('td');
                    td.className = 'text-center border-start';
                    td.style.backgroundColor = color;
                    td.style.color = textColor;
                    td.style.verticalAlign = 'middle';
                    const count = item[day] || 0;
                    td.textContent = count > 0 ? count : '-';
                    tr.appendChild(td);
                });

                // Total
                const tdTotal = document.createElement('td');
                tdTotal.className = 'text-center fw-bold border-start';
                tdTotal.style.backgroundColor = color;
                tdTotal.style.color = textColor;
                tdTotal.style.verticalAlign = 'middle';
                tdTotal.textContent = item.weekly_total || 0;
                tr.appendChild(tdTotal);

                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error('Error loading beach destinations:', error);
        }
    }

    _renderPlayasSummaryCards(data) {
        const container = document.getElementById('playas-summary-cards');
        if (!container) return;

        // Aggregate by destination + tipo
        const grouped = {};
        data.forEach(item => {
            const key = `${item.iata}||${item._tipo}`;
            if (!grouped[key]) {
                grouped[key] = { city: item.city || item.iata, iata: item.iata, tipo: item._tipo, total: 0, airlines: new Set() };
            }
            grouped[key].total += Number(item.weekly_total) || 0;
            if (item.airline) grouped[key].airlines.add(item.airline);
        });

        container.innerHTML = '';

        if (Object.keys(grouped).length === 0) {
            container.innerHTML = '<div class="col-12 text-muted small py-1"><i class="fas fa-info-circle me-1"></i>Sin destinos de playa disponibles para la selección actual.</div>';
            return;
        }

        // Sort: Nacional first, then alphabetically
        const sorted = Object.values(grouped).sort((a, b) => {
            if (a.tipo !== b.tipo) return a.tipo === 'Nacional' ? -1 : 1;
            return a.city.localeCompare(b.city);
        });

        sorted.forEach(dest => {
            const isNac = dest.tipo === 'Nacional';
            const accentColor = isNac ? '#dc3545' : '#0d6efd';
            const col = document.createElement('div');
            col.className = 'col';
            col.innerHTML = `
                <div class="card h-100 border-0 shadow-sm" style="border-left:4px solid ${accentColor} !important;">
                    <div class="card-body p-3">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="badge ${isNac ? 'bg-danger' : 'bg-primary'}">${dest.tipo}</span>
                            <span class="text-muted small fw-bold">${dest.iata}</span>
                        </div>
                        <h6 class="card-title mb-2 fw-bold" style="font-size:0.95rem;">${dest.city}</h6>
                        <div class="d-flex align-items-baseline gap-1">
                            <span class="fw-bold fs-5" style="color:${accentColor};">${dest.total}</span>
                            <span class="text-muted small">frec/sem</span>
                        </div>
                        <div class="text-muted mt-1" style="font-size:0.72rem;line-height:1.3;">${[...dest.airlines].join(' · ') || 'N/D'}</div>
                    </div>
                </div>`;
            container.appendChild(col);
        });
    }

    addCargoAirlineToDestination(templateItem) {
        const defaults = {
            week_label: templateItem.week_label,
            valid_from: templateItem.valid_from,
            valid_to: templateItem.valid_to,
            route_id: templateItem.route_id,
            city: templateItem.city,
            state: templateItem.state,
            iata: templateItem.iata,
            airline: '',
            monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0, weekly_total: 0
        };

        const schema = this.schemas['weekly_frequencies_cargo'];
        if (schema) {
            window.adminUI.openEditModal('weekly_frequencies_cargo', defaults, schema);
        }
    }

    openCopyWeekModalCargo() {
        const labelSelect = document.getElementById('filter-weekly-freq-cargo-label');
        const sourceLabel = labelSelect ? labelSelect.value : '';

        if (!sourceLabel) {
            alert('Por favor selecciona una semana origen primero.');
            return;
        }

        document.getElementById('copy-source-week-label').textContent = sourceLabel;
        const startDateInput = document.getElementById('copy-start-date');
        const endDateInput = document.getElementById('copy-end-date');
        startDateInput.value = '';
        endDateInput.value = '';
        document.getElementById('copy-preview-label').textContent = '';

        const btnConfirm = document.querySelector('#modal-copy-week .btn-primary');
        const newBtn = btnConfirm.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);

        newBtn.onclick = () => this.confirmCopyWeekCargo();
        
        startDateInput.onchange = () => {
             const startVal = startDateInput.value;
             if (startVal) {
                const [y, m, d] = startVal.split('-').map(Number);
                // Create date object correctly handling timezone offset or just string calc
                const date = new Date(y, m - 1, d);
                date.setDate(date.getDate() + 6);
                const yEnd = date.getFullYear();
                const mEnd = String(date.getMonth() + 1).padStart(2, '0');
                const dEnd = String(date.getDate()).padStart(2, '0');
                endDateInput.value = `${yEnd}-${mEnd}-${dEnd}`;
                
                const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                const mName = months[m - 1];
                const mNameEnd = months[date.getMonth()];
                
                document.getElementById('copy-preview-label').textContent = `${d} ${mName} - ${dEnd} ${mNameEnd} ${yEnd}`;
             }
        };

        const modal = new bootstrap.Modal(document.getElementById('modal-copy-week'));
        modal.show();
    }

    async confirmCopyWeekCargo() {
        const labelSelect = document.getElementById('filter-weekly-freq-cargo-label');
        const sourceLabel = labelSelect ? labelSelect.value : '';
        const startDate = document.getElementById('copy-start-date').value;
        const endDate = document.getElementById('copy-end-date').value;
        const newLabel = document.getElementById('copy-preview-label').textContent;

        if (!startDate || !endDate || !newLabel) {
            alert('Por favor selecciona las fechas.');
            return;
        }

        try {
            const sourceData = await window.dataManager.getWeeklyFrequenciesCargo(sourceLabel);
            if (!sourceData || sourceData.length === 0) {
                alert('No hay datos en la semana origen.');
                return;
            }

            const newRows = sourceData.map(item => {
                const { id, created_at, ...rest } = item;
                // Important: Ensure we don't carry over IDs primary key
                return {
                    ...rest,
                    week_label: newLabel,
                    valid_from: startDate,
                    valid_to: endDate
                };
            });

            const { error } = await this.client.from('weekly_frequencies_cargo').insert(newRows);
            if (error) throw error;

            bootstrap.Modal.getInstance(document.getElementById('modal-copy-week')).hide();
            alert('Semana (Carga) copiada exitosamente.');
            this.loadWeeklyFrequenciesCargo();

        } catch (error) {
            console.error('Error copying week:', error);
            alert('Error al copiar: ' + error.message);
        }
    }

    async deleteWeeklyTemplateCargo() {
        const labelSelect = document.getElementById('filter-weekly-freq-cargo-label');
        const selectedLabel = labelSelect ? labelSelect.value : '';
        if (!selectedLabel) return;

        if (!confirm(`¿Estás seguro de eliminar TODOS los registros de Carga de la semana: ${selectedLabel}?`)) return;

        try {
            const { error } = await this.client.from('weekly_frequencies_cargo').delete().eq('week_label', selectedLabel);
            if (error) throw error;
            
            // Clear Select to force refresh
            labelSelect.value = '';
            alert('Semana eliminada.');
            
            // Force refresh UI list
            this.loadWeeklyFrequenciesCargo(true);
        } catch (e) {
            console.error('Error deleting week:', e);
            alert('Error: ' + e.message);
        }
    }

    toggleWeeklyEditModeCargo() {
        const btn = document.getElementById('btn-edit-weekly-cargo-mode');
        const saveBtn = document.getElementById('btn-save-weekly-cargo-changes');
        const table = document.getElementById('table-weekly-frequencies-cargo');
        
        if (btn.classList.contains('active')) {
             btn.classList.remove('active');
             btn.innerHTML = '<i class="fas fa-edit"></i> Editar Tabla';
             saveBtn.classList.add('d-none');
             this.loadWeeklyFrequenciesCargo();
        } else {
             btn.classList.add('active');
             btn.innerHTML = '<i class="fas fa-times"></i> Cancelar';
             saveBtn.classList.remove('d-none');
             
             const spans = table.querySelectorAll('.weekly-freq-value');
             spans.forEach(span => {
                 const val = span.textContent;
                 const input = document.createElement('input');
                 input.type = 'number';
                 input.className = 'form-control form-control-sm p-0 text-center';
                 input.style.width = '40px';
                 input.value = val;
                 input.dataset.original = val;
                 span.style.display = 'none';
                 span.parentNode.insertBefore(input, span);
             });
        }
    }

    async saveWeeklyChangesCargo() {
        const table = document.getElementById('table-weekly-frequencies-cargo');
        const inputs = table.querySelectorAll('input[type="number"]');
        
        const updates = {};
        
        inputs.forEach(input => {
            const span = input.nextElementSibling;
            const original = input.dataset.original;
            const current = input.value;
            const id = span.dataset.id;
            const field = span.dataset.field;
            
            if (original !== current) {
                if (!updates[id]) updates[id] = {};
                updates[id][field] = parseInt(current) || 0;
            }
        });
        
        if (Object.keys(updates).length === 0) {
            alert('No hay cambios para guardar.');
            this.toggleWeeklyEditModeCargo();
            return;
        }
        
        try {
            const promises = Object.keys(updates).map(id => {
                 return this.client.from('weekly_frequencies_cargo').update(updates[id]).eq('id', id);
            });
            
            await Promise.all(promises);
            alert('Cambios guardados.');
            this.toggleWeeklyEditModeCargo(); 
            
        } catch (error) {
            console.error('Error saving changes:', error);
            alert('Error al guardar cambios.');
        }
    }

    parseRouteReminderDays(raw) {
        const fallback = [30, 14, 7, 3, 1, 0];
        if (!raw || typeof raw !== 'string') return fallback;
        const uniq = new Set();
        raw.split(',').forEach((part) => {
            const n = parseInt(String(part).trim(), 10);
            if (Number.isInteger(n) && n >= 0 && n <= 365) uniq.add(n);
        });
        const parsed = [...uniq].sort((a, b) => b - a);
        return parsed.length ? parsed : fallback;
    }

    async loadRouteLaunchCalendar() {
        const tbody = document.querySelector('#table-route-launch-calendar tbody');
        const monthInput = document.getElementById('route-launch-month');
        if (!tbody || !monthInput) return;

        if (!monthInput.value) {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            monthInput.value = `${now.getFullYear()}-${month}`;
        }

        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-1"></i>Cargando...</td></tr>';

        try {
            const { data, error } = await this.client
                .from('route_launch_calendar')
                .select('*')
                .eq('is_active', true)
                .order('launch_date', { ascending: true });
            if (error) throw error;
            this.routeLaunchEvents = data || [];
            this.renderRouteLaunchCalendar();
        } catch (error) {
            console.error('Error loading route launch calendar:', error);
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Error: ${error.message}</td></tr>`;
        }
    }

    renderRouteLaunchCalendar() {
        const tbody = document.querySelector('#table-route-launch-calendar tbody');
        const monthInput = document.getElementById('route-launch-month');
        const statusFilter = document.getElementById('route-launch-status-filter');
        const scopeFilter = document.getElementById('route-launch-scope-filter');
        const searchInput = document.getElementById('route-launch-search');
        const statusEl = document.getElementById('route-launch-status');
        const gridEl = document.getElementById('route-launch-calendar-grid');
        if (!tbody || !monthInput || !gridEl) return;

        const monthVal = monthInput.value || '';
        const statusVal = (statusFilter?.value || '').trim().toLowerCase();
        const scopeVal = (scopeFilter?.value || '').trim().toLowerCase();
        const searchVal = (searchInput?.value || '').trim().toLowerCase();

        const filtered = (this.routeLaunchEvents || []).filter((ev) => {
            const date = String(ev.launch_date || '');
            if (monthVal && !date.startsWith(monthVal)) return false;
            if (statusVal && String(ev.status || '').toLowerCase() !== statusVal) return false;
            if (scopeVal && String(ev.scope || '').toLowerCase() !== scopeVal) return false;
            if (searchVal) {
                const bag = `${ev.route_name || ''} ${ev.airline || ''}`.toLowerCase();
                if (!bag.includes(searchVal)) return false;
            }
            return true;
        });

        const badgeByStatus = {
            confirmada: 'success',
            programada: 'primary',
            pospuesta: 'warning',
            cancelada: 'secondary',
        };

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Sin inauguraciones para los filtros seleccionados.</td></tr>';
        } else {
            tbody.innerHTML = filtered.map((ev) => {
                const status = String(ev.status || 'programada').toLowerCase();
                const badge = badgeByStatus[status] || 'secondary';
                const reminderDays = Array.isArray(ev.reminder_days) ? ev.reminder_days : [];
                const reminderText = reminderDays.length ? reminderDays.join(', ') + ' dias' : 'Sin recordatorios';
                return `<tr>
                    <td>${this.formatDisplayDate(ev.launch_date)}</td>
                    <td>
                        <div class="fw-semibold">${ev.route_name || '-'}</div>
                        <small class="text-muted">${ev.route_code || ''}</small>
                    </td>
                    <td>${ev.airline || '-'}</td>
                    <td><span class="badge bg-light text-dark border text-uppercase">${ev.scope || 'nacional'}</span></td>
                    <td><span class="badge bg-${badge}">${status}</span></td>
                    <td class="small text-muted">${reminderText}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="dataManagement.openRouteLaunchModal('${ev.id}')" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="dataManagement.deleteRouteLaunchEvent('${ev.id}')" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');
        }

        const eventsByDate = {};
        filtered.forEach((ev) => {
            const key = String(ev.launch_date || '').slice(0, 10);
            if (!eventsByDate[key]) eventsByDate[key] = [];
            eventsByDate[key].push(ev);
        });

        const [yearStr, monthStr] = monthVal.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        if (!Number.isInteger(year) || !Number.isInteger(month)) return;

        const firstDay = new Date(year, month - 1, 1);
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekDays = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

        let html = '<div class="table-responsive"><table class="table table-bordered table-sm mb-0"><thead><tr>';
        html += weekDays.map((d) => `<th class="text-center small bg-light">${d}</th>`).join('');
        html += '</tr></thead><tbody><tr>';

        for (let i = 0; i < firstDay.getDay(); i++) {
            html += '<td style="height:94px;background:#fafbfc"></td>';
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const events = eventsByDate[dateIso] || [];
            const mini = events.slice(0, 2).map((ev) => `<div class="small text-truncate"><span class="badge bg-primary-subtle text-primary-emphasis">${ev.airline || ''}</span> ${ev.route_name || ''}</div>`).join('');
            const extra = events.length > 2 ? `<div class="small text-muted">+${events.length - 2} mas</div>` : '';

            html += `<td style="height:94px;vertical-align:top">
                <div class="fw-semibold small">${day}</div>
                ${mini}
                ${extra}
            </td>`;

            if ((firstDay.getDay() + day) % 7 === 0 && day < daysInMonth) html += '</tr><tr>';
        }

        const trailing = (7 - ((firstDay.getDay() + daysInMonth) % 7)) % 7;
        for (let i = 0; i < trailing; i++) {
            html += '<td style="height:94px;background:#fafbfc"></td>';
        }

        html += '</tr></tbody></table></div>';
        gridEl.innerHTML = html;

        if (statusEl) {
            statusEl.innerHTML = `<i class="fas fa-info-circle me-1"></i>${filtered.length} inauguracion(es) visibles de ${this.routeLaunchEvents.length} registradas.`;
        }
    }

    openRouteLaunchModal(id = '') {
        const modalEl = document.getElementById('routeLaunchModal');
        if (!modalEl) return;
        if (!this.routeLaunchModal) this.routeLaunchModal = new bootstrap.Modal(modalEl, { backdrop: 'static' });

        const event = id ? (this.routeLaunchEvents || []).find((item) => String(item.id) === String(id)) : null;
        const setVal = (elId, value) => {
            const el = document.getElementById(elId);
            if (el) el.value = value || '';
        };

        setVal('route-launch-id', event?.id || '');
        setVal('route-launch-route', event?.route_name || '');
        setVal('route-launch-airline', event?.airline || '');
        setVal('route-launch-date', event?.launch_date || new Date().toISOString().slice(0, 10));
        setVal('route-launch-scope', event?.scope || 'nacional');
        setVal('route-launch-status-field', event?.status || 'confirmada');
        setVal('route-launch-reminder-days', Array.isArray(event?.reminder_days) ? event.reminder_days.join(',') : '30,14,7,3,1,0');
        setVal('route-launch-notes', event?.notes || '');

        const statusEl = document.getElementById('route-launch-modal-status');
        if (statusEl) statusEl.innerHTML = '';
        this.routeLaunchModal.show();
    }

    async saveRouteLaunchEvent() {
        const id = (document.getElementById('route-launch-id')?.value || '').trim();
        const routeName = (document.getElementById('route-launch-route')?.value || '').trim();
        const airline = (document.getElementById('route-launch-airline')?.value || '').trim();
        const launchDate = (document.getElementById('route-launch-date')?.value || '').trim();
        const scope = (document.getElementById('route-launch-scope')?.value || 'nacional').trim().toLowerCase();
        const status = (document.getElementById('route-launch-status-field')?.value || 'confirmada').trim().toLowerCase();
        const reminderRaw = (document.getElementById('route-launch-reminder-days')?.value || '').trim();
        const notes = (document.getElementById('route-launch-notes')?.value || '').trim();
        const statusEl = document.getElementById('route-launch-modal-status');

        if (!routeName || !airline || !launchDate) {
            if (statusEl) statusEl.innerHTML = '<span class="text-danger">Ruta, aerolinea y fecha son obligatorios.</span>';
            return;
        }

        const payload = {
            route_name: routeName,
            airline,
            launch_date: launchDate,
            scope,
            status,
            reminder_days: this.parseRouteReminderDays(reminderRaw),
            notes: notes || null,
            updated_at: new Date().toISOString(),
        };

        if (statusEl) statusEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Guardando...</span>';

        try {
            if (id) {
                const { error } = await this.client.from('route_launch_calendar').update(payload).eq('id', id);
                if (error) throw error;
            } else {
                const { error } = await this.client.from('route_launch_calendar').insert(payload);
                if (error) throw error;
            }

            if (this.routeLaunchModal) this.routeLaunchModal.hide();
            await this.loadRouteLaunchCalendar();
            this.renderDmCalRutas();
            alert('Inauguracion guardada correctamente.');
        } catch (error) {
            console.error('Error saving route launch event:', error);
            if (statusEl) statusEl.innerHTML = `<span class="text-danger">Error: ${error.message}</span>`;
        }
    }

    async deleteRouteLaunchEvent(id) {
        if (!id) return;
        if (!confirm('Deseas eliminar esta inauguracion de ruta?')) return;
        try {
            const { error } = await this.client
                .from('route_launch_calendar')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
            await this.loadRouteLaunchCalendar();
            this.renderDmCalRutas();
        } catch (error) {
            console.error('Error deleting route launch event:', error);
            alert('No se pudo eliminar: ' + error.message);
        }
    }

    async sendRouteLaunchRemindersNow() {
        const statusEl = document.getElementById('route-launch-status');
        if (!confirm('Se enviaran recordatorios de inauguraciones programadas para hoy. Deseas continuar?')) return;

        try {
            if (statusEl) statusEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Enviando recordatorios...</span>';
            const { data, error } = await this.client.functions.invoke('send-route-launch-reminders', {
                body: { source: 'manual-ui' }
            });
            if (error) throw error;

            const sentWhatsApp = Number(data?.sent_whatsapp || 0);
            const sentEmail = Number(data?.sent_email || 0);
            const totalEvents = Number(data?.events_matched || 0);

            if (statusEl) {
                statusEl.innerHTML = `<span class="text-success"><i class="fas fa-check-circle me-1"></i>Envio finalizado.</span> Eventos: ${totalEvents}. WhatsApp: ${sentWhatsApp}. Correo: ${sentEmail}.`;
            }
        } catch (error) {
            console.error('Error sending route launch reminders:', error);
            if (statusEl) statusEl.innerHTML = `<span class="text-danger"><i class="fas fa-times-circle me-1"></i>${error.message}</span>`;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    _esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── Gestión de Datos: Calendario Rutas (pane propio del muro) ─────────────
    async loadDmCalRutas() {
        const monthInput = document.getElementById('dm-rlc-month');
        if (!monthInput) return;
        if (!monthInput.value) {
            const now = new Date();
            monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        const tbody = document.querySelector('#dm-table-rlc tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-1"></i>Cargando...</td></tr>';
        try {
            const { data, error } = await this.client
                .from('route_launch_calendar')
                .select('*')
                .eq('is_active', true)
                .order('launch_date', { ascending: true });
            if (error) throw error;
            this.routeLaunchEvents = data || [];
            this.renderDmCalRutas();
        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Error: ${err.message}</td></tr>`;
        }
    }

    renderDmCalRutas() {
        const tbody = document.querySelector('#dm-table-rlc tbody');
        const monthInput = document.getElementById('dm-rlc-month');
        const statusFilter = document.getElementById('dm-rlc-status-filter');
        const scopeFilter = document.getElementById('dm-rlc-scope-filter');
        const searchInput = document.getElementById('dm-rlc-search');
        const statusEl = document.getElementById('dm-rlc-status-bar');
        const gridEl = document.getElementById('dm-rlc-grid');
        if (!tbody || !monthInput || !gridEl) return;

        const monthVal = monthInput.value || '';
        const statusVal = (statusFilter?.value || '').trim().toLowerCase();
        const scopeVal = (scopeFilter?.value || '').trim().toLowerCase();
        const searchVal = (searchInput?.value || '').trim().toLowerCase();

        const filtered = (this.routeLaunchEvents || []).filter((ev) => {
            const date = String(ev.launch_date || '');
            if (monthVal && !date.startsWith(monthVal)) return false;
            if (statusVal && String(ev.status || '').toLowerCase() !== statusVal) return false;
            if (scopeVal && String(ev.scope || '').toLowerCase() !== scopeVal) return false;
            if (searchVal) {
                const bag = `${ev.route_name || ''} ${ev.airline || ''}`.toLowerCase();
                if (!bag.includes(searchVal)) return false;
            }
            return true;
        });

        const badgeByStatus = { confirmada: 'success', programada: 'primary', pospuesta: 'warning', cancelada: 'secondary' };

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Sin inauguraciones para los filtros seleccionados.</td></tr>';
        } else {
            tbody.innerHTML = filtered.map((ev) => {
                const status = String(ev.status || 'programada').toLowerCase();
                const badge = badgeByStatus[status] || 'secondary';
                const reminderDays = Array.isArray(ev.reminder_days) ? ev.reminder_days : [];
                const reminderText = reminderDays.length ? reminderDays.join(', ') + ' días' : 'Sin recordatorios';
                return `<tr>
                    <td>${this.formatDisplayDate(ev.launch_date)}</td>
                    <td><div class="fw-semibold">${this._esc(ev.route_name || '-')}</div><small class="text-muted">${this._esc(ev.route_code || '')}</small></td>
                    <td>${this._esc(ev.airline || '-')}</td>
                    <td><span class="badge bg-light text-dark border text-uppercase">${this._esc(ev.scope || 'nacional')}</span></td>
                    <td><span class="badge bg-${badge}">${status}</span></td>
                    <td class="small text-muted">${reminderText}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="dataManagement.openRouteLaunchModal('${ev.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="dataManagement.deleteRouteLaunchEvent('${ev.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
        }

        // Rejilla calendario
        const eventsByDate = {};
        filtered.forEach((ev) => {
            const key = String(ev.launch_date || '').slice(0, 10);
            if (!eventsByDate[key]) eventsByDate[key] = [];
            eventsByDate[key].push(ev);
        });
        const [yearStr, monthStr] = monthVal.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        if (!Number.isInteger(year) || !Number.isInteger(month)) { gridEl.innerHTML = ''; return; }
        const firstDay = new Date(year, month - 1, 1);
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekDays = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        let html = '<div class="table-responsive"><table class="table table-bordered table-sm mb-0"><thead><tr>';
        html += weekDays.map((d) => `<th class="text-center small bg-light">${d}</th>`).join('');
        html += '</tr></thead><tbody><tr>';
        for (let i = 0; i < firstDay.getDay(); i++) html += '<td style="height:90px;background:#fafbfc"></td>';
        for (let day = 1; day <= daysInMonth; day++) {
            const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const events = eventsByDate[dateIso] || [];
            const mini = events.slice(0, 2).map((ev) => `<div class="small text-truncate"><span class="badge bg-primary-subtle text-primary-emphasis">${this._esc(ev.airline || '')}</span> ${this._esc(ev.route_name || '')}</div>`).join('');
            const extra = events.length > 2 ? `<div class="small text-muted">+${events.length - 2} más</div>` : '';
            html += `<td style="height:90px;vertical-align:top"><div class="fw-semibold small">${day}</div>${mini}${extra}</td>`;
            if ((firstDay.getDay() + day) % 7 === 0 && day < daysInMonth) html += '</tr><tr>';
        }
        const trailing = (7 - ((firstDay.getDay() + daysInMonth) % 7)) % 7;
        for (let i = 0; i < trailing; i++) html += '<td style="height:90px;background:#fafbfc"></td>';
        html += '</tr></tbody></table></div>';
        gridEl.innerHTML = html;

        if (statusEl) statusEl.innerHTML = `<i class="fas fa-info-circle me-1"></i>${filtered.length} inauguración(es) visibles de ${(this.routeLaunchEvents || []).length} registradas.`;
    }

    // ── Notas TV Wall (Gestión de Datos) ─────────────────────────────────────
    async loadDmTvNotas() {
        const list = document.getElementById('dm-notas-list');
        const count = document.getElementById('dm-notas-count');
        if (!list) return;
        list.innerHTML = '<div class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Cargando...</div>';
        try {
            const { data, error } = await this.client
                .from('tv_notas')
                .select('id, titulo, nota, prioridad, activa, updated_at')
                .eq('activa', true)
                .order('prioridad', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(50);
            if (error) throw error;
            const rows = data || [];
            if (count) count.textContent = rows.length;
            if (!rows.length) {
                list.innerHTML = '<div class="text-center text-muted py-3">Sin notas activas.</div>';
                return;
            }
            const badgeMap = { 10: 'danger', 8: 'warning', 5: 'primary', 3: 'secondary' };
            const labelMap = { 10: 'Crítica', 8: 'Alta', 5: 'Media', 3: 'Baja' };
            list.innerHTML = rows.map((n) => `
                <div class="d-flex align-items-start border-bottom py-2 gap-3">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center gap-2 mb-1">
                            <span class="badge bg-${badgeMap[n.prioridad] || 'secondary'}">${labelMap[n.prioridad] || n.prioridad}</span>
                            <span class="fw-semibold">${this._esc(n.titulo || '')}</span>
                        </div>
                        <div class="small text-muted">${this._esc(n.nota || '')}</div>
                        <div class="small text-muted mt-1">${n.updated_at ? new Date(n.updated_at).toLocaleString('es-MX') : ''}</div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger flex-shrink-0" onclick="dataManagement.deactivateDmTvNota(${n.id})" title="Desactivar nota">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
        } catch (err) {
            list.innerHTML = `<div class="text-center text-danger py-3">Error: ${err.message}</div>`;
        }
    }

    async addDmTvNota() {
        const titleEl = document.getElementById('dm-nota-titulo');
        const bodyEl = document.getElementById('dm-nota-body');
        const priorEl = document.getElementById('dm-nota-prioridad');
        const statusEl = document.getElementById('dm-nota-status');
        const titulo = titleEl?.value.trim() || '';
        const nota = bodyEl?.value.trim() || '';
        const prioridad = Number(priorEl?.value || 5);
        if (!titulo || !nota) {
            if (statusEl) statusEl.innerHTML = '<span class="text-danger">Título y nota son obligatorios.</span>';
            return;
        }
        if (statusEl) statusEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Guardando...</span>';
        try {
            const { error } = await this.client.from('tv_notas').insert({ titulo, nota, prioridad, activa: true });
            if (error) throw error;
            if (titleEl) titleEl.value = '';
            if (bodyEl) bodyEl.value = '';
            if (statusEl) statusEl.innerHTML = '<span class="text-success"><i class="fas fa-check me-1"></i>Nota agregada correctamente.</span>';
            await this.loadDmTvNotas();
            setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 3000);
        } catch (err) {
            if (statusEl) statusEl.innerHTML = `<span class="text-danger">Error: ${err.message}</span>`;
        }
    }

    async deactivateDmTvNota(id) {
        if (!confirm('¿Desactivar esta nota del TV Wall?')) return;
        try {
            const { error } = await this.client.from('tv_notas').update({ activa: false }).eq('id', Number(id));
            if (error) throw error;
            await this.loadDmTvNotas();
        } catch (err) {
            alert('Error al desactivar: ' + err.message);
        }
    }
}

window.dataManagement = new DataManagement();

// Helper functions for Data Management Sidebar
function showDmSidebar() {
    const sidebar = document.getElementById('dm-sidebar');
    const content = document.getElementById('dm-content');
    const toggleBtn = document.getElementById('dm-sidebar-toggle');

    if (sidebar) sidebar.classList.remove('d-none');
    if (content) {
        content.classList.remove('col-md-12');
        content.classList.add('col-md-9');
    }
    if (toggleBtn) toggleBtn.classList.add('d-none');
}

function hideDmSidebar() {
    const sidebar = document.getElementById('dm-sidebar');
    const content = document.getElementById('dm-content');
    const toggleBtn = document.getElementById('dm-sidebar-toggle');

    if (sidebar) sidebar.classList.add('d-none');
    if (content) {
        content.classList.remove('col-md-9');
        content.classList.add('col-md-12');
    }
    if (toggleBtn) toggleBtn.classList.remove('d-none');
}

function toggleDmSidebar() {
    const sidebar = document.getElementById('dm-sidebar');
    if (sidebar && sidebar.classList.contains('d-none')) {
        showDmSidebar();
    } else {
        hideDmSidebar();
    }
}
window.showDmSidebar = showDmSidebar;
window.hideDmSidebar = hideDmSidebar;
window.toggleDmSidebar = toggleDmSidebar;

document.addEventListener('DOMContentLoaded', () => { setTimeout(() => window.dataManagement.renderPublicAlerts(), 2000); });

/* --------------------------------------------------------------------------
   MÓDULO AEROLÍNEAS — gestión inline en Gestión de Datos
   Tabla: airlines   Bucket: airline-logos
   -------------------------------------------------------------------------- */
(function () {
    const AL_TABLE  = 'airlines';
    const AL_BUCKET = 'airline-logos';
    const GURL      = iata => `https://www.gstatic.com/flights/airline_logos/70px/${iata}.png`;

    let alAll      = [];
    let alFiltered = [];
    let alFilter   = 'all';
    let alEditId   = null;
    let alPending  = null;
    let alLoadInFlight = false;
    let alReloadQueued = false;
    let alSuspendRender = false;
    let alModalEl = null;
    let alModal = null;

    // -- helpers --------------------------------------------------------------
    function esc(s)  { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function escA(s) { return String(s ?? '').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
    function sb()    { return window.supabaseClient; }

    function alGetModal() {
        if (!alModalEl) {
            alModalEl = document.getElementById('dm-airline-modal');
            if (!alModalEl) return null;

            // Keep modal outside tab panes to avoid parent repaint side-effects.
            if (alModalEl.parentElement !== document.body) {
                document.body.appendChild(alModalEl);
            }

            alModalEl.addEventListener('hidden.bs.modal', () => {
                alSuspendRender = false;
                alPending = null;
                if (alReloadQueued) {
                    alReloadQueued = false;
                    alLoad();
                }
            });
        }

        if (!alModal) {
            alModal = bootstrap.Modal.getOrCreateInstance(alModalEl, {
                backdrop: 'static',
                keyboard: false,
                focus: true
            });
        }
        return alModal;
    }

    function alLogoType(a) { return a.logo_url ? 'storage' : (a.iata ? 'iata' : 'none'); }

    // -- load & render --------------------------------------------------------
    window.alLoad = async function () {
        const tbody = document.getElementById('al-tbody');
        if (!tbody) return;
        if (alSuspendRender) {
            alReloadQueued = true;
            return;
        }
        if (alLoadInFlight) {
            alReloadQueued = true;
            return;
        }

        alLoadInFlight = true;
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Cargando...</td></tr>';
        const client = sb();
        if (!client) {
            tbody.innerHTML = '<tr><td colspan="7" class="alert alert-danger m-2">supabaseClient no disponible.</td></tr>';
            alLoadInFlight = false;
            return;
        }
        const { data, error } = await client.from(AL_TABLE).select('*').order('name');
        if (error) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-danger p-3">${esc(error.message)}</td></tr>`;
            alLoadInFlight = false;
            return;
        }
        alAll = data || [];
        alUpdateStats();
        alApplyFilters();
        alLoadInFlight = false;

        if (alReloadQueued && !alSuspendRender) {
            alReloadQueued = false;
            alLoad();
        }
    };

    function alUpdateStats() {
        const withLogo = alAll.filter(a => !!a.logo_url).length;
        const noLogo   = alAll.filter(a => !a.logo_url && !a.iata).length;
        const nac      = alAll.filter(a => (a.types||[]).includes('nacional')).length;
        const intl     = alAll.filter(a => (a.types||[]).includes('internacional')).length;
        const setS = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setS('al-stat-total',  `${alAll.length} total`);
        setS('al-stat-logo',   `${withLogo} con logo`);
        setS('al-stat-nologo', `${noLogo} sin logo`);
        setS('al-stat-nac',    `${nac} nacionales`);
        setS('al-stat-int',    `${intl} internacionales`);
    }

    window.alSetFilter = function (f, btn) {
        alFilter = f;
        document.querySelectorAll('.al-f-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        alApplyFilters();
    };

    window.alApplyFilters = function () {
        const q = (document.getElementById('al-search')?.value || '').toLowerCase().trim();
        alFiltered = alAll.filter(a => {
            if (alFilter !== 'all' && !(a.types || []).includes(alFilter)) return false;
            if (q) {
                const hay = [a.name, a.iata, a.icao, ...(a.aliases || [])].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
        alRender();
        const cnt = document.getElementById('al-count');
        if (cnt) cnt.textContent = `${alFiltered.length} aerolineas mostradas`;
    };

    function alLogoThumb(a) {
        const lt = alLogoType(a);
        let inner = '';
        if (lt === 'storage') {
            inner = `<img src="${escA(a.logo_url)}" alt="${escA(a.name)}" style="max-width:54px;max-height:34px;object-fit:contain" onerror="this.style.display='none'">`;
        } else if (lt === 'iata') {
            inner = `<img src="${GURL(a.iata)}" alt="${escA(a.name)}" style="max-width:54px;max-height:34px;object-fit:contain" onerror="this.parentElement.querySelector('span').style.display='block';this.remove()">`;
        }
        return `<div onclick="alInlineUpload('${escA(a.id)}')" title="Subir logo" style="
                    width:60px;height:38px;border-radius:6px;border:1.5px dashed #ced4da;
                    background:#f8f9fa;display:flex;align-items:center;justify-content:center;
                    overflow:hidden;cursor:pointer;position:relative;transition:.15s"
                    onmouseenter="this.style.borderColor='#0d6efd'" onmouseleave="this.style.borderColor='#ced4da'">
                  ${inner}
                  <span style="font-size:.6rem;color:#adb5bd;display:${inner ? 'none' : 'block'};text-align:center;line-height:1.2"><i class="fas fa-plane d-block"></i>Sin logo</span>
                </div>
                <div style="height:3px;background:#e9ecef;border-radius:2px;margin-top:2px;display:none" id="al-rprog-${escA(a.id)}">
                  <div style="height:100%;border-radius:2px;background:#0d6efd;width:0%;transition:width .25s" id="al-rbar-${escA(a.id)}"></div>
                </div>`;
    }

    function alTypeBadges(a) {
        const map = { nacional:'success', internacional:'primary', carga:'warning', pasajeros:'secondary' };
        return (a.types || []).map(t => `<span class="badge bg-${map[t]||'light'} text-${map[t]==='warning'?'dark':'white'} me-1" style="font-size:.6rem">${esc(t)}</span>`).join('');
    }

    function alStatusPill(a) {
        const lt = alLogoType(a);
        if (lt === 'storage') return '<span class="badge bg-success" style="font-size:.65rem"><i class="fas fa-cloud me-1"></i>Storage</span>';
        if (lt === 'iata')    return '<span class="badge bg-warning text-dark" style="font-size:.65rem"><i class="fas fa-link me-1"></i>IATA</span>';
        return '<span class="badge bg-secondary" style="font-size:.65rem">Sin logo</span>';
    }

    function alRender() {
        const tbody = document.getElementById('al-tbody');
        if (!tbody) return;
        if (!alFiltered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5"><i class="fas fa-search me-2"></i>Sin resultados</td></tr>';
            return;
        }
        tbody.innerHTML = alFiltered.map(a => {
            const color = a.color || '#6c757d';
            const codes = [(a.iata ? `<code style="font-size:.75rem;background:#e9ecef;padding:.1em .35em;border-radius:3px">${esc(a.iata)}</code>` : ''),
                           (a.icao ? `<code style="font-size:.75rem;background:#e2e8f0;padding:.1em .35em;border-radius:3px;color:#374151">${esc(a.icao)}</code>` : '')].filter(Boolean).join(' ');
            return `<tr id="al-row-${escA(a.id)}">
                <td style="vertical-align:middle;padding:.4rem .6rem">${alLogoThumb(a)}</td>
                <td style="font-weight:600;font-size:.88rem">${esc(a.name)}</td>
                <td>${codes || '<span class="text-muted small">—</span>'}</td>
                <td>${alTypeBadges(a) || '<span class="text-muted small">—</span>'}</td>
                <td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.15);background:${escA(color)};vertical-align:middle;margin-right:4px"></span><code style="font-size:.72rem">${esc(color)}</code></td>
                <td>${alStatusPill(a)}</td>
                <td style="text-align:center;white-space:nowrap">
                  <button class="btn btn-sm btn-outline-success px-2 py-1 me-1" title="Subir logo" onclick="alInlineUpload('${escA(a.id)}')"><i class="fas fa-image" style="font-size:.75rem"></i></button>
                  <button class="btn btn-sm btn-outline-primary px-2 py-1 me-1" title="Editar" onclick="alOpenEdit('${escA(a.id)}')"><i class="fas fa-pen" style="font-size:.75rem"></i></button>
                  <button class="btn btn-sm btn-outline-danger px-2 py-1" title="Eliminar" onclick="alConfirmDelete('${escA(a.id)}')"><i class="fas fa-trash" style="font-size:.75rem"></i></button>
                </td>
            </tr>`;
        }).join('');
    }

    // -- inline logo upload ----------------------------------------------------
    window.alInlineUpload = function (airlineId) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.onchange = () => { if (inp.files[0]) alDoUpload(airlineId, inp.files[0]); };
        inp.click();
    };

    async function alDoUpload(airlineId, file) {
        if (file.size > 2 * 1024 * 1024) { alToast('El archivo supera 2 MB.', 'danger'); return; }
        const prog  = document.getElementById(`al-rprog-${airlineId}`);
        const pbar  = document.getElementById(`al-rbar-${airlineId}`);
        const setW  = w => { if (pbar) pbar.style.width = w; };
        if (prog)  prog.style.display = 'block';
        setW('25%');

        const ext      = file.name.split('.').pop().toLowerCase();
        const filename = `${airlineId}.${ext}`;
        const client   = sb();

        await client.storage.from(AL_BUCKET).remove([filename]);
        setW('55%');

        const { error: upErr } = await client.storage.from(AL_BUCKET).upload(filename, file, { upsert: true, contentType: file.type });
        if (upErr) { if (prog) prog.style.display = 'none'; alToast(`Error subiendo: ${upErr.message}`, 'danger'); return; }
        setW('80%');

        const { data: { publicUrl } } = client.storage.from(AL_BUCKET).getPublicUrl(filename);
        const { error: dbErr } = await client.from(AL_TABLE).update({ logo_url: publicUrl, logo_filename: filename }).eq('id', airlineId);
        if (dbErr) { if (prog) prog.style.display = 'none'; alToast(`Error en DB: ${dbErr.message}`, 'danger'); return; }

        setW('100%');
        setTimeout(() => { if (prog) prog.style.display = 'none'; setW('0%'); }, 700);

        // Update local data
        const a = alAll.find(x => x.id === airlineId);
        if (a) { a.logo_url = publicUrl; a.logo_filename = filename; }
        alUpdateStats();
        alApplyFilters();
        alToast(`Logo actualizado: ${(alAll.find(x => x.id === airlineId) || {}).name || airlineId}`, 'success');
    }

    // -- modal: add / edit -----------------------------------------------------
    window.alOpenAdd = function () {
        const modalEl = document.getElementById('dm-airline-modal');
        if (modalEl && modalEl.classList.contains('show')) return;
        alEditId = null; alPending = null;
        document.getElementById('al-modal-title').innerHTML = '<i class="fas fa-plus me-2"></i>Nueva Aerolinea';
        document.getElementById('al-btn-delete').classList.add('d-none');
        alClearForm();
        alSuspendRender = true;
        const modal = alGetModal();
        if (modal) modal.show();
    };

    window.alOpenEdit = function (id) {
        const modalEl = document.getElementById('dm-airline-modal');
        if (modalEl && modalEl.classList.contains('show')) return;
        const a = alAll.find(x => x.id === id);
        if (!a) return;
        alEditId = id; alPending = null;
        document.getElementById('al-modal-title').innerHTML = `<i class="fas fa-edit me-2"></i>${esc(a.name)}`;
        document.getElementById('al-btn-delete').classList.remove('d-none');
        alFillForm(a);
        alSuspendRender = true;
        const modal = alGetModal();
        if (modal) modal.show();
    };

    function alClearForm() {
        ['al-f-name','al-f-iata','al-f-icao','al-f-aliases'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        ['al-f-nac','al-f-int','al-f-car','al-f-pax'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
        const col = document.getElementById('al-f-color'); if (col) col.value = '#0d6efd';
        const dt  = document.getElementById('al-drop-text'); if (dt) dt.textContent = 'Arrastra o haz click - PNG, JPG, SVG - max 2 MB';
        const prev = document.getElementById('al-logo-preview'); if (prev) prev.innerHTML = '<span class="text-muted small">Sube un logo para ver la vista previa</span>';
    }

    function alFillForm(a) {
        const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        sv('al-f-name',    a.name);
        sv('al-f-iata',    a.iata);
        sv('al-f-icao',    a.icao);
        sv('al-f-color',   a.color || '#0d6efd');
        sv('al-f-aliases', (a.aliases || []).join('\n'));
        ['al-f-nac','al-f-int','al-f-car','al-f-pax'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = (a.types || []).includes(el.value);
        });
        const prev = document.getElementById('al-logo-preview');
        if (!prev) return;
        if (a.logo_url) {
            prev.innerHTML = `<img src="${escA(a.logo_url)}" style="max-height:60px;object-fit:contain"><div class="small ms-2 text-muted">Logo actual - <span class="text-success"><i class="fas fa-cloud me-1"></i>Storage</span></div>`;
        } else if (a.iata) {
            prev.innerHTML = `<img src="${GURL(a.iata)}" style="max-height:50px;object-fit:contain"><div class="small ms-2 text-muted">Logo IATA - <span class="text-warning">No esta en Storage</span></div>`;
        } else {
            prev.innerHTML = '<span class="text-muted small">Sin logo - sube uno</span>';
        }
        const dt = document.getElementById('al-drop-text');
        if (dt) dt.innerHTML = a.logo_filename
            ? `<span class="text-success"><i class="fas fa-check me-1"></i>${esc(a.logo_filename)}</span> <small class="text-muted">- click para cambiar</small>`
            : 'Arrastra o haz click - PNG, JPG, SVG - max 2 MB';
    }

    window.alHandleDrop = function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) alHandleFile(e.dataTransfer.files[0]); };
    window.alHandleFile = function (file) {
        if (file.size > 2 * 1024 * 1024) { alToast('El archivo supera 2 MB.', 'danger'); return; }
        alPending = file;
        const url  = URL.createObjectURL(file);
        const dt   = document.getElementById('al-drop-text');
        const prev = document.getElementById('al-logo-preview');
        if (dt)   dt.innerHTML = `<span class="text-success"><i class="fas fa-check me-1"></i>${esc(file.name)}</span>`;
        if (prev) prev.innerHTML = `<img src="${url}" style="max-height:60px;object-fit:contain"><div class="small ms-2 text-muted">Vista previa - ${esc(file.name)}</div>`;
    };

    window.alSave = async function () {
        const name    = document.getElementById('al-f-name')?.value.trim();
        const iata    = document.getElementById('al-f-iata')?.value.trim().toUpperCase() || null;
        const icao    = document.getElementById('al-f-icao')?.value.trim().toUpperCase() || null;
        const color   = document.getElementById('al-f-color')?.value || '#6c757d';
        const aliases = (document.getElementById('al-f-aliases')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        const types   = ['al-f-nac','al-f-int','al-f-car','al-f-pax'].filter(id => document.getElementById(id)?.checked).map(id => document.getElementById(id).value);
        if (!name) { alToast('El nombre es obligatorio.', 'warning'); return; }

        const id = alEditId || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
        let logo_url = null, logo_filename = null;

        if (alPending) {
            const r = await alUploadModal(alPending, id);
            if (!r) return;
            logo_url = r.url; logo_filename = r.filename;
        } else if (alEditId) {
            const ex = alAll.find(a => a.id === alEditId);
            logo_url = ex?.logo_url || null;
            logo_filename = ex?.logo_filename || null;
        }

        const payload = { id, name, iata, icao, color, text_color: '#ffffff', types, aliases, logo_url, logo_filename, active: true };
        const client = sb();
        const res = alEditId
            ? await client.from(AL_TABLE).update(payload).eq('id', alEditId)
            : await client.from(AL_TABLE).insert(payload);

        if (res.error) { alToast(`Error: ${res.error.message}`, 'danger'); return; }
        alGetModal()?.hide();
        alToast(`${alEditId ? 'Actualizada' : 'Creada'}: ${name}`, 'success');
        window.dispatchEvent(new CustomEvent('airline-catalog-updated', { detail: { id, name, color } }));
        await alLoad();
    };

    async function alUploadModal(file, airlineId) {
        const ext = file.name.split('.').pop().toLowerCase();
        const filename = `${airlineId}.${ext}`;
        const prog = document.getElementById('al-upload-progress');
        const bar  = document.getElementById('al-prog-bar');
        if (prog) prog.classList.remove('d-none');
        if (bar)  bar.style.width = '30%';

        const client = sb();
        await client.storage.from(AL_BUCKET).remove([filename]);
        if (bar) bar.style.width = '60%';

        const { error } = await client.storage.from(AL_BUCKET).upload(filename, file, { upsert: true, contentType: file.type });
        if (error) { if (prog) prog.classList.add('d-none'); alToast(`Error subiendo: ${error.message}`, 'danger'); return null; }
        if (bar) bar.style.width = '100%';
        setTimeout(() => { if (prog) prog.classList.add('d-none'); if (bar) bar.style.width = '0%'; }, 800);

        const { data: { publicUrl } } = client.storage.from(AL_BUCKET).getPublicUrl(filename);
        return { url: publicUrl, filename };
    }

    // -- delete ----------------------------------------------------------------
    window.alConfirmDelete = async function (id) {
        const a = alAll.find(x => x.id === id);
        if (!confirm(`¿Eliminar "${a ? a.name : id}"? Esta acción no se puede deshacer.`)) return;
        const client = sb();
        if (a?.logo_filename) await client.storage.from(AL_BUCKET).remove([a.logo_filename]);
        const { error } = await client.from(AL_TABLE).delete().eq('id', id);
        if (error) { alToast(`Error: ${error.message}`, 'danger'); return; }
        alToast('Aerolínea eliminada.', 'warning');
        window.dispatchEvent(new CustomEvent('airline-catalog-updated', { detail: { id, deleted: true } }));
        await alLoad();
    };

    window.alDelete = async function () { if (alEditId) await alConfirmDelete(alEditId); };

    // -- toast -----------------------------------------------------------------
    function alToast(msg, type) {
        const t = document.createElement('div');
        t.className = `alert alert-${type || 'success'} position-fixed bottom-0 end-0 m-3 shadow`;
        t.style.cssText = 'z-index:9999;min-width:270px';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    }
})();

/* --------------------------------------------------------------------------
   MÓDULO AEROLÍNEAS MENSUALES — tabla completa inline-editable
   -------------------------------------------------------------------------- */
(function () {
    const AM_TABLE = 'Aerolíneas';
    const AM_MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const AM_MON_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    let amAllRows = [];
    let amSelectedYr = '25';
    let amSearchTerm = '';
    let amServiceFilter = ''; // '' = all, 'pasajero' = passengers only, 'carga' = cargo only
    let amNewRowIdx = 0; // for new-row temp keys

    function sb() { return window.supabaseClient; }

    function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function amToast(msg, type) {
        const t = document.createElement('div');
        t.className = 'alert alert-' + (type || 'success') + ' position-fixed bottom-0 end-0 m-3 shadow';
        t.style.cssText = 'z-index:9999;min-width:280px;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 4000);
    }

    // -- Render ----------------------------------------------------------------
    function amRender() {
        const thead = document.getElementById('am-thead');
        const tbody = document.getElementById('am-tbody');
        const countEl = document.getElementById('am-count');
        if (!thead || !tbody) return;

        // Header
        thead.innerHTML = '<tr>'
            + '<th style="min-width:220px;padding:10px 12px;">Aerolínea</th>'
            + '<th style="min-width:140px;padding:10px 12px;">Tipo de Servicio</th>'
            + AM_MON_SHORT.map(function(m){ return '<th style="min-width:68px;text-align:center;padding:10px 6px;">' + m + '</th>'; }).join('')
            + '<th style="min-width:80px;text-align:center;padding:10px 6px;">Acciones</th>'
            + '</tr>';

        const term = amSearchTerm.toLowerCase();
        const visible = amAllRows.filter(function(r) {
            const n = (r['AEROLINEA'] || r['AEROLINEA '] || '').toLowerCase();
            const s = (r['TIPO DE SERVICIO'] || '').toLowerCase();
            // Service type filter
            if (amServiceFilter && !s.includes(amServiceFilter)) return false;
            // Text search
            if (term && !n.includes(term) && !s.includes(term)) return false;
            return true;
        });

        tbody.innerHTML = '';
        visible.forEach(function(row) {
            tbody.appendChild(amBuildRow(row));
        });

        if (countEl) countEl.textContent = visible.length + ' aerolínea(s) mostradas de ' + amAllRows.length + ' en total.';
    }

    function amBuildRow(row) {
        const isNew = !!row._new;
        const rowKey = row.id !== undefined ? row.id : (row['AEROLINEA'] || row['AEROLINEA '] || '');
        const nombre = row['AEROLINEA'] || row['AEROLINEA '] || '';
        const servicio = row['TIPO DE SERVICIO'] || '';
        const tr = document.createElement('tr');
        tr.dataset.rowkey = rowKey;
        if (isNew) tr.classList.add('table-warning');

        let cells = '<td style="padding:4px 8px;"><input type="text" class="form-control form-control-sm am-cell-nombre" value="' + esc(nombre) + '" placeholder="Nombre aerolínea" style="min-width:180px;"></td>'
            + '<td style="padding:4px 8px;"><input type="text" class="form-control form-control-sm am-cell-servicio" value="' + esc(servicio) + '" placeholder="Ej. Regular de Carga" style="min-width:120px;"></td>';

        AM_MONTHS.forEach(function(mon) {
            const colKey = mon + '-' + amSelectedYr;
            const v = row[colKey];
            const val = (v !== null && v !== undefined && v !== '') ? v : '';
            cells += '<td style="padding:4px 4px;"><input type="number" class="form-control form-control-sm text-center am-cell-month" data-col="' + colKey + '" value="' + esc(val) + '" placeholder="…" min="0" step="1" style="min-width:60px;padding:4px 2px;"></td>';
        });

        cells += '<td style="text-align:center;padding:4px 6px;">'
            + '<button class="btn btn-xs btn-success me-1" style="font-size:0.75rem;padding:3px 7px;" onclick="amSaveRow(this)" title="Guardar"><i class="fas fa-save"></i></button>'
            + '<button class="btn btn-xs btn-outline-danger" style="font-size:0.75rem;padding:3px 7px;" onclick="amDeleteRow(this)" title="Eliminar"><i class="fas fa-trash"></i></button>'
            + '</td>';

        tr.innerHTML = cells;
        // store reference to data object on the row
        tr._amRow = row;
        // re-attach since innerHTML re-creates elements
        tr.querySelectorAll('button').forEach(function(btn) {
            btn._amTr = tr;
        });
        return tr;
    }

    // -- Load all data ---------------------------------------------------------
    window.amRefresh = async function () {
        const tbody = document.getElementById('am-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="16" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Cargando…</td></tr>';
        const client = sb();
        if (!client) { amToast('Cliente Supabase no disponible.', 'danger'); return; }
        const { data, error } = await client.from(AM_TABLE).select('*').order('AEROLINEA');
        if (error) { amToast('Error al cargar: ' + error.message, 'danger'); return; }
        amAllRows = data || [];
        amRender();
    };

    // -- Filter ----------------------------------------------------------------
    window.amFilterTable = function () {
        const inp = document.getElementById('am-search');
        amSearchTerm = inp ? inp.value : '';
        amRender();
    };

    window.amSetServiceFilter = function (btn) {
        document.querySelectorAll('.am-svc-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        amServiceFilter = btn.dataset.svc || '';
        amRender();
    };

    // -- Add new row -----------------------------------------------------------
    window.amAddRow = function () {
        const newRow = { _new: true, _tmpKey: '__new_' + (++amNewRowIdx), 'AEROLINEA': '', 'TIPO DE SERVICIO': '' };
        AM_MONTHS.forEach(function(mon) { newRow[mon + '-' + amSelectedYr] = null; });
        amAllRows.unshift(newRow);
        amRender();
        const tbody = document.getElementById('am-tbody');
        if (tbody && tbody.firstChild) {
            tbody.firstChild.querySelector('.am-cell-nombre')?.focus();
            tbody.firstChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    };

    // -- Save single row -------------------------------------------------------
    window.amSaveRow = async function (btn) {
        const tr = btn.closest('tr');
        if (!tr) return;
        const client = sb();
        if (!client) { amToast('Cliente Supabase no disponible.', 'danger'); return; }

        const nombre = tr.querySelector('.am-cell-nombre')?.value.trim() || '';
        const servicio = tr.querySelector('.am-cell-servicio')?.value.trim() || '';
        if (!nombre) { amToast('El nombre de la aerolínea no puede estar vacío.', 'warning'); return; }

        const updates = { 'AEROLINEA': nombre, 'TIPO DE SERVICIO': servicio };
        tr.querySelectorAll('.am-cell-month').forEach(function(inp) {
            const v = inp.value.trim();
            updates[inp.dataset.col] = (v === '' || isNaN(v)) ? null : parseFloat(v);
        });

        // Identify the cached row
        const cachedRow = tr._amRow;
        const isNew = cachedRow && !!cachedRow._new;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        let queryError;
        if (isNew) {
            const { error } = await client.from(AM_TABLE).insert(updates);
            queryError = error;
        } else {
            let q;
            if (cachedRow && cachedRow.id !== undefined) {
                q = client.from(AM_TABLE).update(updates).eq('id', cachedRow.id);
            } else {
                const oldNombre = cachedRow ? (cachedRow['AEROLINEA'] || cachedRow['AEROLINEA '] || '') : '';
                q = client.from(AM_TABLE).update(updates).eq('AEROLINEA', oldNombre || nombre);
            }
            const { error } = await q;
            queryError = error;
        }

        if (queryError) {
            amToast('Error: ' + queryError.message, 'danger');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i>';
            return;
        }

        amToast((isNew ? 'Aerolínea agregada' : 'Cambios guardados') + ': ' + nombre, 'success');
        // Reload fresh data
        await amRefresh();
        try { window.aeroDataCache = null; } catch(_) {}
    };

    // -- Delete row ------------------------------------------------------------
    window.amDeleteRow = async function (btn) {
        const tr = btn.closest('tr');
        if (!tr) return;
        const cachedRow = tr._amRow;
        const isNew = cachedRow && !!cachedRow._new;
        const nombre = tr.querySelector('.am-cell-nombre')?.value.trim() || (cachedRow && (cachedRow['AEROLINEA'] || cachedRow['AEROLINEA '])) || '';

        if (isNew) {
            // Just remove from local array and re-render
            amAllRows = amAllRows.filter(function(r) { return r !== cachedRow; });
            amRender();
            return;
        }

        if (!confirm('¿Eliminar la aerolínea "' + nombre + '"? Esta acción no se puede deshacer.')) return;

        const client = sb();
        if (!client) { amToast('Cliente Supabase no disponible.', 'danger'); return; }

        let queryError;
        if (cachedRow && cachedRow.id !== undefined) {
            const { error } = await client.from(AM_TABLE).delete().eq('id', cachedRow.id);
            queryError = error;
        } else {
            const { error } = await client.from(AM_TABLE).delete().eq('AEROLINEA', nombre);
            queryError = error;
        }

        if (queryError) { amToast('Error: ' + queryError.message, 'danger'); return; }
        amToast('Aerolínea eliminada: ' + nombre, 'warning');
        await amRefresh();
        try { window.aeroDataCache = null; } catch(_) {}
    };

    // -- Save all rows ---------------------------------------------------------
    window.amSaveAll = async function (btn) {
        const tbody = document.getElementById('am-tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (!rows.length) return;

        const client = sb();
        if (!client) { amToast('Cliente Supabase no disponible.', 'danger'); return; }

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Guardando…'; }

        let ok = 0, fail = 0;
        for (const tr of rows) {
            const cachedRow = tr._amRow;
            if (!cachedRow) continue;
            const isNew = !!cachedRow._new;

            const nombre = tr.querySelector('.am-cell-nombre')?.value.trim() || '';
            const servicio = tr.querySelector('.am-cell-servicio')?.value.trim() || '';
            if (!nombre) continue; // skip empty new rows

            const updates = { 'AEROLINEA': nombre, 'TIPO DE SERVICIO': servicio };
            tr.querySelectorAll('.am-cell-month').forEach(function(inp) {
                const v = inp.value.trim();
                updates[inp.dataset.col] = (v === '' || isNaN(v)) ? null : parseFloat(v);
            });

            let queryError;
            if (isNew) {
                const { error } = await client.from(AM_TABLE).insert(updates);
                queryError = error;
            } else {
                let q;
                if (cachedRow.id !== undefined) {
                    q = client.from(AM_TABLE).update(updates).eq('id', cachedRow.id);
                } else {
                    const oldNombre = cachedRow['AEROLINEA'] || cachedRow['AEROLINEA '] || nombre;
                    q = client.from(AM_TABLE).update(updates).eq('AEROLINEA', oldNombre);
                }
                const { error } = await q;
                queryError = error;
            }

            if (queryError) { fail++; } else { ok++; }
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Guardar todo'; }

        if (fail === 0) {
            amToast('Todas las filas guardadas correctamente (' + ok + ').', 'success');
        } else {
            amToast(ok + ' guardadas, ' + fail + ' con error.', 'warning');
        }
        await amRefresh();
        try { window.aeroDataCache = null; } catch(_) {}
    };

    // -- Wire events -----------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.am-yr-btn').forEach(function(btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.am-yr-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                amSelectedYr = btn.dataset.yr;
                amRender();
            });
        });

        document.querySelectorAll('.am-svc-btn').forEach(function(btn) {
            btn.addEventListener('click', function () { window.amSetServiceFilter(btn); });
        });

        const tabBtn = document.getElementById('tab-aerolineas-mensual');
        if (tabBtn) {
            tabBtn.addEventListener('shown.bs.tab', function () {
                if (!amAllRows.length) amRefresh();
            });
        }
    });
})();

