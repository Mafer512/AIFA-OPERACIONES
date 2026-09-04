/** @jest-environment jsdom */
/**
 * Destino del agua por pozo (AIFA / Cd. Militar).
 *
 * Una fila de hidra_pozo_destino rige DESDE su (anio, mes) en adelante hasta
 * que otra más reciente la reemplace. De ahí salen la demanda AIFA y la de
 * Cd. Militar del dashboard, que antes leían columnas que la captura ya no
 * llenaba y por eso salían siempre en cero.
 */
const fs = require('fs');
const path = require('path');

const DAILY = [
    // Marzo: tres pozos, uno de ellos nunca asignado.
    { id: 101, anio: 2026, mes: 3, dia: 1, pozo: 'Pozo 4', volumen_m3: 100, aifa_m3: 0, cd_militar_m3: 0 },
    { id: 102, anio: 2026, mes: 3, dia: 1, pozo: 'Pozo 5', volumen_m3: 200, aifa_m3: 0, cd_militar_m3: 0 },
    { id: 103, anio: 2026, mes: 3, dia: 1, pozo: 'Pozo 6', volumen_m3: 50,  aifa_m3: 0, cd_militar_m3: 0 },
    // Agosto: el Pozo 4 cambia de destino, el Pozo 5 hereda.
    { id: 104, anio: 2026, mes: 8, dia: 1, pozo: 'Pozo 4', volumen_m3: 10, aifa_m3: 0, cd_militar_m3: 0 },
    { id: 105, anio: 2026, mes: 8, dia: 1, pozo: 'Pozo 5', volumen_m3: 20, aifa_m3: 0, cd_militar_m3: 0 },
    // Fila con desglose histórico ya capturado: manda sobre la asignación.
    { id: 106, anio: 2026, mes: 8, dia: 2, pozo: 'Pozo 7', volumen_m3: 30, aifa_m3: 7, cd_militar_m3: 23 },
    // Noviembre 10: los 9 pozos leídos en cero → día completo, totales intactos.
    ...['Pozo 1', 'Pozo 2', 'Pozo 3', 'Pozo 4', 'Pozo 5', 'Pozo 6', 'Pozo 7', 'Pozo 8', 'Pozo 10']
        .map((pozo, i) => ({ id: 200 + i, anio: 2026, mes: 11, dia: 10, pozo, volumen_m3: 0, aifa_m3: 0, cd_militar_m3: 0 })),
];
const DESTINOS = [
    { id: 1, anio: 2026, mes: 3, pozo: 'Pozo 4', destino: 'CD_MILITAR' },
    { id: 2, anio: 2026, mes: 3, pozo: 'Pozo 5', destino: 'AIFA' },
    { id: 3, anio: 2026, mes: 8, pozo: 'Pozo 4', destino: 'AIFA' },
];

function montarDom() {
    document.body.innerHTML = `
        <span id="hidra-status-badge"></span>
        <select id="hidra-filter-year"></select><select id="hidra-filter-month"></select>
        <select id="hidra-filter-day"></select><select id="hidra-filter-pozo"></select>
        <select id="hidra-cap-year"></select><select id="hidra-cap-month"></select>
        <button id="hidra-cap-prev-month"></button><button id="hidra-cap-next-month"></button>
        <div id="hidra-cap-daygrid"></div><div id="hidra-capday-tip"></div>
        <span id="hidra-cap-quarter-badge"></span>
        <span id="hidra-cap-daytitle"></span><span id="hidra-cap-month-summary"></span>
        <span id="hidra-cap-status"></span><span id="hidra-auto-period" class="d-none"></span>
        <table><tbody id="hidra-cap-pozos-tbody"></tbody></table>
        <span id="hidra-m-extraccion"></span><span id="hidra-m-distribucion"></span>
        <span id="hidra-m-aifa"></span><span id="hidra-m-cdmilitar"></span>
        <span id="hidra-a-aifa"></span><span id="hidra-a-cdmilitar"></span>
        <span id="hidra-a-extraccion"></span><span id="hidra-a-distribucion"></span>
        <canvas id="hidra-chart-demanda-month"></canvas>
        <canvas id="hidra-chart-pozo-month"></canvas>
        <div id="hidra-demanda-hint" class="d-none"></div>
        <span id="hidra-dest-period"></span><span id="hidra-dest-status"></span>
        <div id="hidra-dest-totals"></div><div id="hidra-dest-grid"></div>
        <button id="hidra-dest-save"></button><button id="hidra-cap-save"></button>`;
}

/** Cliente Supabase de mentiras: sirve datos por tabla y registra escrituras. */
function montarSupabase(escrituras) {
    const datos = {
        'Extracción_agua_diaria': DAILY,
        'Suministro_paap_diario': [],
        'Tratamiento_ptar_diario': [],
        'hidra_pozo_destino': DESTINOS,
    };
    const consulta = filas => {
        const filtros = [];
        const api = {
            eq(col, valor) { filtros.push([col, valor]); return api; },
            then(res, rej) {
                const data = filas.filter(r => filtros.every(([c, v]) => String(r[c]) === String(v)));
                return Promise.resolve({ data, error: null }).then(res, rej);
            },
        };
        return api;
    };
    window.supabaseClient = {
        from(tabla) {
            return {
                select: () => consulta(datos[tabla] || []),
                upsert: (payload, opts) => {
                    escrituras.push({ tabla, tipo: 'upsert', payload, opts });
                    return Promise.resolve({ data: null, error: null });
                },
                delete: () => ({
                    in: (col, ids) => {
                        escrituras.push({ tabla, tipo: 'delete', col, ids });
                        return Promise.resolve({ data: null, error: null });
                    },
                }),
            };
        },
    };
}

function montarChart(instancias) {
    class ChartMock {
        constructor(ctx, config) {
            this.config = config;
            this.destroy = jest.fn();
            instancias.push(this);
        }
    }
    ChartMock.register = jest.fn();
    ChartMock.defaults = { plugins: { legend: { labels: {} } } };
    window.Chart = ChartMock;
    HTMLCanvasElement.prototype.getContext = () => ({});
}

async function arrancar(escrituras, instancias) {
    montarDom();
    montarSupabase(escrituras);
    montarChart(instancias);
    window.canCaptureSection = () => true;
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'js', 'hidraulicas.js'), 'utf8');
    window.eval(fuente);
    await window.hidraulicasModule.init();
    return window.hidraulicasModule;
}

/** Cambia el mes del panel de captura como lo haría el usuario. */
function elegirPeriodo(anio, mes) {
    const selAnio = document.getElementById('hidra-cap-year');
    const selMes = document.getElementById('hidra-cap-month');
    if (![...selAnio.options].some(o => o.value === String(anio))) {
        selAnio.insertAdjacentHTML('beforeend', `<option value="${anio}">${anio}</option>`);
    }
    selAnio.value = String(anio);
    selAnio.dispatchEvent(new Event('change'));
    selMes.value = String(mes);
    selMes.dispatchEvent(new Event('change'));
}

describe('Hidráulicas · destino del agua por pozo', () => {
    let escrituras, instancias, mod;

    beforeEach(async () => {
        escrituras = [];
        instancias = [];
        mod = await arrancar(escrituras, instancias);
    });

    test('si el mes en curso está vacío, abre en el último con información', async () => {
        // Reloj en diciembre: sin captura. El último mes con volumen extraído
        // es agosto (noviembre existe pero está todo en ceros).
        jest.useFakeTimers().setSystemTime(new Date(2026, 11, 15));
        try {
            const otro = await arrancar([], []);
            expect([otro.state.selectedYear, otro.state.selectedMonth, otro.state.selectedDay])
                .toEqual([2026, 8, 0]);
            const aviso = document.getElementById('hidra-auto-period');
            expect(aviso.classList.contains('d-none')).toBe(false);
            expect(aviso.textContent).toBe('Mostrando Agosto 2026, el último mes con información.');
            // Y el panel ya trae números en vez de ceros.
            expect(document.getElementById('hidra-m-extraccion').textContent).toBe('60');
        } finally {
            jest.useRealTimers();
        }
    });

    test('si el mes en curso sí tiene datos, no se mueve ni avisa', async () => {
        // El reloj se fija en agosto, que sí tiene captura: el tablero debe
        // respetar el mes de hoy en lugar de saltar a otro. Iba contra el reloj
        // real y la prueba se rompía sola al cambiar de mes.
        jest.useFakeTimers().setSystemTime(new Date(2026, 7, 15));
        try {
            const enAgosto = await arrancar([], []);
            expect([enAgosto.state.selectedYear, enAgosto.state.selectedMonth]).toEqual([2026, 8]);
            expect(document.getElementById('hidra-auto-period').classList.contains('d-none')).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    test('la asignación de un mes sigue vigente en los meses siguientes', () => {
        mod.state.selectedYear = 2026;
        mod.state.selectedMonth = 3;
        mod.state.selectedDay = 0;
        mod.renderDashboard();
        // Marzo: Pozo 4 → Cd. Militar (100), Pozo 5 → AIFA (200), Pozo 6 sin asignar (50).
        expect(document.getElementById('hidra-m-aifa').textContent).toBe('200');
        expect(document.getElementById('hidra-m-cdmilitar').textContent).toBe('100');
        expect(document.getElementById('hidra-m-extraccion').textContent).toBe('350');

        mod.state.selectedMonth = 8;
        mod.renderDashboard();
        // Agosto: el Pozo 4 cambió a AIFA (10), el Pozo 5 heredó AIFA (20)
        // y el Pozo 7 conserva su desglose histórico (7 / 23).
        expect(document.getElementById('hidra-m-aifa').textContent).toBe('37');
        expect(document.getElementById('hidra-m-cdmilitar').textContent).toBe('23');
    });

    test('lo no asignado se contabiliza aparte y nunca desaparece del total', () => {
        mod.state.selectedYear = 2026;
        mod.state.selectedMonth = 3;
        mod.state.selectedDay = 0;
        mod.renderDashboard();

        const dona = instancias.filter(i => i.config.type === 'pie').pop();
        expect(dona.config.data.labels).toEqual(['AIFA', 'Cd. Militar', 'Sin asignar']);
        expect(dona.config.data.datasets[0].data).toEqual([200, 100, 50]);
        // La suma del pastel es exactamente la extracción del mes.
        expect(dona.config.data.datasets[0].data.reduce((a, b) => a + b, 0)).toBe(350);

        const aviso = document.getElementById('hidra-demanda-hint');
        expect(aviso.classList.contains('d-none')).toBe(false);
        expect(aviso.textContent).toMatch(/50 m³ sin destino asignado/);
    });

    test('el acumulado anual usa la misma regla de vigencia', () => {
        mod.state.selectedYear = 2026;
        mod.renderDashboard();
        // AIFA: 200 (mar) + 10 + 20 + 7 (ago) · Cd. Militar: 100 (mar) + 23 (ago)
        expect(document.getElementById('hidra-a-aifa').textContent).toBe('237');
        expect(document.getElementById('hidra-a-cdmilitar').textContent).toBe('123');
    });

    test('el panel distingue lo fijado en el mes de lo heredado y lo no asignado', () => {
        elegirPeriodo(2026, 8);
        const tarjeta = pozo => [...document.querySelectorAll('.hidra-dest-card')]
            .find(c => c.querySelector('.hidra-dest-pozo').textContent === pozo);

        const p4 = tarjeta('Pozo 4');
        expect(p4.querySelector('button.active').dataset.destino).toBe('AIFA');
        expect(p4.querySelector('.hidra-dest-note').textContent).toMatch(/Cambia aquí · antes Cd\. Militar/);

        const p5 = tarjeta('Pozo 5');
        expect(p5.querySelector('button.active').dataset.destino).toBe('AIFA');
        expect(p5.querySelector('.hidra-dest-note').textContent).toMatch(/Heredado de Mar 2026/);

        const p6 = tarjeta('Pozo 6');
        expect(p6.querySelector('button.active')).toBeNull();
        expect(p6.querySelector('.hidra-dest-note').textContent).toMatch(/Sin asignar/);
    });

    test('guardar sólo manda los pozos que cambiaron en ese mes', async () => {
        elegirPeriodo(2026, 8);
        const boton = (pozo, destino) => document.querySelector(
            `[data-dest-pozo="${pozo}"][data-destino="${destino}"]`);

        boton('Pozo 6', 'CD_MILITAR').click();
        expect(document.getElementById('hidra-dest-status').textContent).toMatch(/1 cambio sin guardar/);

        document.getElementById('hidra-dest-save').click();
        await new Promise(r => setTimeout(r, 0));

        const upserts = escrituras.filter(e => e.tabla === 'hidra_pozo_destino' && e.tipo === 'upsert');
        expect(upserts).toHaveLength(1);
        expect(upserts[0].payload).toEqual([
            { anio: 2026, mes: 8, pozo: 'Pozo 6', destino: 'CD_MILITAR' },
        ]);
        expect(upserts[0].opts).toEqual({ onConflict: 'anio,mes,pozo' });
    });

    test('volver a picar el destino del mes lo suelta al heredado y borra la fila', async () => {
        elegirPeriodo(2026, 8);
        // El Pozo 4 tiene fila propia de agosto (AIFA); al re-picarla vuelve a
        // heredar Cd. Militar de marzo, así que la fila de agosto sobra.
        document.querySelector('[data-dest-pozo="Pozo 4"][data-destino="AIFA"]').click();

        const p4 = [...document.querySelectorAll('.hidra-dest-card')]
            .find(c => c.querySelector('.hidra-dest-pozo').textContent === 'Pozo 4');
        expect(p4.querySelector('button.active').dataset.destino).toBe('CD_MILITAR');
        expect(p4.querySelector('.hidra-dest-note').textContent).toMatch(/Heredado de Mar 2026/);

        document.getElementById('hidra-dest-save').click();
        await new Promise(r => setTimeout(r, 0));

        const borrados = escrituras.filter(e => e.tabla === 'hidra_pozo_destino' && e.tipo === 'delete');
        expect(borrados).toHaveLength(1);
        expect(borrados[0].ids).toEqual([3]);
    });

    test('un cambio sin guardar sobrevive a que se repinte el dashboard', () => {
        elegirPeriodo(2026, 8);
        document.querySelector('[data-dest-pozo="Pozo 6"][data-destino="AIFA"]').click();
        // Tocar un filtro del dashboard dispara renderDashboard(), que repinta
        // el panel: lo tecleado no debe borrarse.
        mod.renderDashboard();
        const p6 = [...document.querySelectorAll('.hidra-dest-card')]
            .find(c => c.querySelector('.hidra-dest-pozo').textContent === 'Pozo 6');
        expect(p6.querySelector('button.active').dataset.destino).toBe('AIFA');
        expect(document.getElementById('hidra-dest-status').textContent).toMatch(/1 cambio sin guardar/);
    });

    const celda = dia => document.querySelector(`#hidra-cap-daygrid [data-dia="${dia}"]`);
    const punto = dia => celda(dia).querySelector('.hidra-daydot').className;

    test('el calendario marca qué días están completos, incompletos o vacíos', () => {
        elegirPeriodo(2026, 3);
        // Marzo 1 tiene 3 de 9 pozos → incompleto. Marzo 2 no tiene nada.
        expect(punto(1)).toMatch(/is-part/);
        expect(punto(2)).not.toMatch(/is-part|is-full/);
        expect(document.getElementById('hidra-cap-month-summary').textContent)
            .toMatch(/0 de 31 días completos · 1 incompleto/);

        elegirPeriodo(2026, 11);
        expect(punto(10)).toMatch(/is-full/);
        expect(document.getElementById('hidra-cap-month-summary').textContent)
            .toMatch(/1 de 30 días completos/);
    });

    test('el detalle del día no arranca con el número de día que confundía', () => {
        elegirPeriodo(2026, 3);
        // Antes decía "10: 9 de 9 pozos capturados" y se leía como "9 de 10".
        expect(celda(1).getAttribute('title')).toBeNull();
        expect(celda(1).getAttribute('aria-label')).toBe('1 de Marzo: 3 de 9 pozos capturados');
        expect(celda(2).getAttribute('aria-label')).toBe('2 de Marzo: sin captura');
    });

    test('el tooltip muestra fecha, avance de pozos y volumen del día', () => {
        elegirPeriodo(2026, 3);
        const tip = document.getElementById('hidra-capday-tip');
        celda(1).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

        expect(tip.classList.contains('is-on')).toBe(true);
        expect(tip.querySelector('.hidra-tip-fecha').textContent).toBe('Domingo 1 de Marzo');
        expect(tip.textContent).toMatch(/3 de 9\s*pozos capturados/);
        expect(tip.textContent).toMatch(/350\s*m³ extraídos/);
        // 3 de 9 pozos: barra parcial, no completa.
        expect(tip.querySelector('.hidra-tip-bar').className).toMatch(/is-part/);
        expect(tip.querySelector('.hidra-tip-bar span').style.width).toBe('33%');

        document.getElementById('hidra-cap-daygrid')
            .dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
        expect(tip.classList.contains('is-on')).toBe(false);
    });

    test('un día completo pinta la barra llena y sin aviso de faltantes', () => {
        elegirPeriodo(2026, 11);
        const tip = document.getElementById('hidra-capday-tip');
        celda(10).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(tip.textContent).toMatch(/9 de 9\s*pozos capturados/);
        expect(tip.querySelector('.hidra-tip-bar').className).not.toMatch(/is-part/);
        expect(tip.querySelector('.hidra-tip-bar span').style.width).toBe('100%');
    });

    test('un día sin captura lo dice, sin inventar conteos', () => {
        elegirPeriodo(2026, 3);
        const tip = document.getElementById('hidra-capday-tip');
        celda(2).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(tip.textContent).toMatch(/Sin captura todavía/);
        expect(tip.textContent).not.toMatch(/pozos capturados/);
        expect(tip.querySelector('.hidra-tip-bar span').style.width).toBe('0%');
    });

    test('elegir un día lo carga solo, sin botón Cargar', async () => {
        elegirPeriodo(2026, 3);
        celda(1).click();
        await new Promise(r => setTimeout(r, 0));

        expect(celda(1).classList.contains('is-selected')).toBe(true);
        expect(document.getElementById('hidra-cap-daytitle').textContent).toBe('1 de Marzo 2026');
        // La tabla del día trae los valores capturados, sin pasos intermedios.
        const fila = document.querySelector('#hidra-cap-pozos-tbody [data-pozo="Pozo 4"] input');
        expect(fila.value).toBe('100');
        expect(document.getElementById('hidra-cap-status').textContent).toMatch(/3 pozos con dato/);
    });

    test('cambiar a un mes más corto recorta el día en vez de dejarlo inválido', () => {
        elegirPeriodo(2026, 1);
        celda(31).click();
        expect(mod.state.capDay).toBe(31);
        elegirPeriodo(2026, 2);
        expect(mod.state.capDay).toBe(28);
        expect(celda(28).classList.contains('is-selected')).toBe(true);
        expect(celda(29)).toBeNull();
    });

    test('las flechas de mes cruzan el fin de año', () => {
        elegirPeriodo(2026, 1);
        document.getElementById('hidra-cap-prev-month').click();
        expect([mod.state.capYear, mod.state.capMonth]).toEqual([2025, 12]);
        document.getElementById('hidra-cap-next-month').click();
        expect([mod.state.capYear, mod.state.capMonth]).toEqual([2026, 1]);
    });

    test('la captura diaria ya no pisa el desglose histórico con ceros', () => {
        const fuente = fs.readFileSync(path.join(__dirname, '..', 'js', 'hidraulicas.js'), 'utf8');
        expect(fuente).not.toMatch(/cd_militar_m3:\s*0,\s*aifa_m3:\s*0/);
    });
});
