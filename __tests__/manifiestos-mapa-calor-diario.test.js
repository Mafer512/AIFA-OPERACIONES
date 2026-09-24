/**
 * @jest-environment jsdom
 *
 * El mapa de calor de la sub-pestaña Operaciones, ya dibujado.
 *
 * El módulo lee maestra_operaciones, traduce cada renglón y pinta los dos mapas
 * (pasajeros y operaciones). Aquí se arma un Supabase de mentiras con tres
 * vuelos de mayo de 2026 y se comprueba lo que se ve en pantalla:
 *
 *   · que la tabla salga con las siete columnas de la semana,
 *   · que al cambiar a "Fecha por fecha" salga una columna por día con su
 *     fecha y su día de la semana —que es justo lo que antes no se podía ver—,
 *   · y que la hora de la franja sea la que se capturó, no la del huso local.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');

/* Tres operaciones de mayo de 2026, como las entrega PostgREST. */
const OPERACIONES = [
    {
        id: 1, fecha_operacion: '2026-05-14', tipo_movimiento: 'LLEGADA',
        numero_vuelo: '4021', tipo_operacion: 'Nacional', aerolinea_origen: 'VIVA Aerobus',
        hora_operacion: '2026-05-14T14:30:00+00:00', hora_recepcion: '2026-05-14T15:00:00+00:00',
        pax_total: 180, origen_origen: 'CUN', fuente_principal: 'CONCILIACION_MANIFIESTOS',
    },
    {
        id: 2, fecha_operacion: '2026-05-15', tipo_movimiento: 'SALIDA',
        numero_vuelo: '4022', tipo_operacion: 'Nacional', aerolinea_origen: 'VIVA Aerobus',
        hora_operacion: '2026-05-15T07:10:00+00:00', hora_recepcion: '2026-05-15T07:40:00+00:00',
        pax_total: 150, destino_origen: 'GDL', fuente_principal: 'CONCILIACION_MANIFIESTOS',
    },
    {
        id: 3, fecha_operacion: '2026-05-21', tipo_movimiento: 'LLEGADA',
        numero_vuelo: '990', tipo_operacion: 'Internacional', aerolinea_origen: 'Arajet',
        hora_operacion: '2026-05-21T14:45:00+00:00', hora_recepcion: '2026-05-21T15:20:00+00:00',
        pax_total: 90, origen_origen: 'SDQ', fuente_principal: 'CONCILIACION_MANIFIESTOS',
    },
];

const AEROPUERTOS = [
    { iata: 'CUN', pais: 'México' },
    { iata: 'GDL', pais: 'México' },
    { iata: 'SDQ', pais: 'República Dominicana' },
];

/* Un cliente de Supabase apenas suficiente: encadena y al final se puede
   esperar, como el de verdad. */
function supabaseDeMentiras() {
    return {
        from(tabla) {
            const q = {
                _tabla: tabla, _head: false,
                select(_cols, opciones) { q._head = !!(opciones && opciones.head); return q; },
                gte() { return q; },
                lte() { return q; },
                order() { return q; },
                limit() { return q; },
                range(desde, hasta) { q._desde = desde; q._hasta = hasta; return q; },
                then(resolver) { return Promise.resolve(q._resultado()).then(resolver); },
                _resultado() {
                    if (tabla === 'catalogo_aeropuertos') return { data: AEROPUERTOS, error: null };
                    if (q._head) return { count: OPERACIONES.length, data: null, error: null };
                    const desde = q._desde || 0;
                    const hasta = q._hasta === undefined ? OPERACIONES.length - 1 : q._hasta;
                    return { data: OPERACIONES.slice(desde, hasta + 1), error: null };
                },
            };
            return q;
        },
    };
}

const FIXTURE = `
  <div id="mdb-overlay" class="d-none"><span id="mdb-overlay-text"></span></div>
  <div class="btn-group" aria-label="Seleccionar período">
    <button class="btn btn-outline-primary mdb-period-btn" data-table="Base de datos Manifiestos 2025"></button>
    <button class="btn btn-primary mdb-period-btn" data-table="maestra_operaciones" id="mdb-period-2026"></button>
  </div>
  <span id="mdb-period-label"></span>
  <select id="mdb-filter-year"><option value="" selected></option></select>
  <select id="mdb-filter-month"><option value="" selected></option></select>
  <select id="mdb-filter-direction"><option value="" selected></option></select>
  <select id="mdb-filter-optype"><option value="" selected></option></select>
  <select id="mdb-filter-airline"><option value="" selected></option></select>
  <div class="d-none" id="mdb-filter-origen-wrap">
    <select id="mdb-filter-origen">
      <option value="manifiesto" selected>Con manifiesto</option>
      <option value="itinerario">Sólo programados</option>
      <option value="">Todos los registros</option>
    </select>
  </div>
  <ul id="mdb-sub-tabs">
    <li><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#mdb-sub-operaciones"></button></li>
  </ul>
  <span id="ops-kpi-total"></span><span id="ops-kpi-nac"></span><span id="ops-kpi-int"></span>
  <span id="ops-kpi-avg"></span><span id="ops-total-badge"></span>
  <tbody id="ops-tbody-monthly"></tbody><tfoot id="ops-tfoot-monthly"></tfoot>
  <canvas id="ops-chart-monthly"></canvas><canvas id="ops-chart-donut"></canvas>
  <div id="mdb-ops-heatmap-pax"></div>
  <div id="mdb-ops-heatmap-ops"></div>
`;

function esperaA(condicion, ms = 3000) {
    const limite = Date.now() + ms;
    return new Promise((resolve, reject) => {
        const tic = () => {
            if (condicion()) return resolve();
            if (Date.now() > limite) return reject(new Error('el mapa de calor nunca se dibujó'));
            setTimeout(tic, 20);
        };
        tic();
    });
}

let mapaOps;
let mapaPax;

beforeAll(async () => {
    document.body.innerHTML = FIXTURE;

    // Chart.js y el catálogo de aerolíneas no son el tema de esta prueba.
    class ChartFalso {
        constructor() { this.data = {}; }
        destroy() {}
        static register() {}
        static unregister() {}
    }
    window.Chart = ChartFalso;
    global.Chart = ChartFalso;
    window.supabaseClient = supabaseDeMentiras();

    require(path.join(raiz, 'js/manifiestos-maestra.js'));
    require(path.join(raiz, 'js/manifiestos-analisis.js'));
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    // 2026 ya es el período por omisión: no hay que cambiar de botón.

    mapaOps = document.getElementById('mdb-ops-heatmap-ops');
    mapaPax = document.getElementById('mdb-ops-heatmap-pax');
    await esperaA(() => mapaOps.querySelector('table'));
});

describe('el mapa de calor por día de la semana', () => {
    test('abre en la vista semanal, con las siete columnas', () => {
        const encabezados = [...mapaOps.querySelectorAll('thead th')].map(th => th.textContent.trim());
        expect(encabezados[0]).toBe('Hora');
        expect(encabezados.slice(1, 8)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
        expect(encabezados[8]).toBe('Total');
    });

    test('sólo dibuja las franjas con actividad', () => {
        const horas = [...mapaOps.querySelectorAll('tbody tr th')].map(th => th.textContent.trim());
        expect(horas).toEqual(['07:00', '14:00', 'Total']);
    });

    test('la hora capturada no se corre al huso del navegador', () => {
        // Los tres vuelos son de las 14:30, 07:10 y 14:45 en hora del aeropuerto.
        // Si se hubieran pasado por Date(), en México caerían a las 08:xx y 01:xx.
        expect(mapaOps.innerHTML).toContain('14:00');
        expect(mapaOps.innerHTML).not.toContain('08:00');
    });

    test('los dos jueves se suman en la misma columna', () => {
        const fila14 = [...mapaOps.querySelectorAll('tbody tr')]
            .find(tr => tr.querySelector('th').textContent.trim() === '14:00');
        const celdas = [...fila14.querySelectorAll('td')].map(td => td.textContent.trim());
        expect(celdas[3]).toBe('2');   // jueves: el vuelo del 14 y el del 21
        expect(celdas[7]).toBe('2');   // total del renglón (la hora es <th>)
    });

    test('el de pasajeros cuenta pasajeros, no vuelos', () => {
        const fila14 = [...mapaPax.querySelectorAll('tbody tr')]
            .find(tr => tr.querySelector('th').textContent.trim() === '14:00');
        expect([...fila14.querySelectorAll('td')][3].textContent.trim()).toBe('270');
    });
});

describe('el mapa de calor día por día', () => {
    beforeAll(async () => {
        mapaOps.querySelector('button[data-mdbhm-vista="fecha"]').click();
        await esperaA(() => mapaOps.querySelector('th[style*="min-width"]'));
    });

    test('cada día tiene su propia columna, con fecha y día de la semana', () => {
        const encabezados = [...mapaOps.querySelectorAll('thead th')].map(th => th.textContent.trim());
        expect(encabezados[0]).toBe('Hora');
        expect(encabezados.slice(1, 4)).toEqual(['14 MayJue', '15 MayVie', '21 MayJue']);
        expect(encabezados[4]).toBe('Total');
    });

    test('ahora sí se distinguen los dos jueves', () => {
        const fila14 = [...mapaOps.querySelectorAll('tbody tr')]
            .find(tr => tr.querySelector('th').textContent.trim() === '14:00');
        const celdas = [...fila14.querySelectorAll('td')].map(td => td.textContent.trim());
        expect(celdas[0]).toBe('1');   // jueves 14
        expect(celdas[1]).toBe('0');   // viernes 15
        expect(celdas[2]).toBe('1');   // jueves 21
    });

    test('se elige el mes que se dibuja', () => {
        const meses = [...mapaOps.querySelectorAll('button[data-mdbhm-mes]')].map(b => b.dataset.mdbhmMes);
        expect(meses).toEqual(['2026-05']);
        expect(mapaOps.innerHTML).toContain('Mayo 2026');
    });

    test('cada mapa recuerda su vista por separado', () => {
        // El de pasajeros se quedó en la semanal: cambiar uno no mueve al otro.
        expect(mapaPax.querySelector('button[data-mdbhm-semana]')).not.toBeNull();
        expect(mapaPax.querySelector('button[data-mdbhm-mes]')).toBeNull();
    });
});

describe('la fuente de los datos', () => {
    test('el filtro de registros aparece sólo con la maestra', () => {
        expect(document.getElementById('mdb-filter-origen-wrap').classList.contains('d-none')).toBe(false);
        expect(document.getElementById('mdb-filter-origen').value).toBe('manifiesto');
    });

    test('el módulo pide a maestra_operaciones sólo las columnas que usa', () => {
        const fuente = fs.readFileSync(path.join(raiz, 'js/manifiestos-analisis.js'), 'utf8');
        expect(fuente).toContain('ManifiestosMaestra.COLUMNAS.join');
        expect(fuente).toContain("gte('fecha_operacion', periodo.desde)");
    });
});
