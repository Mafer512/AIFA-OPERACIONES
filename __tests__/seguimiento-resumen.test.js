/**
 * @jest-environment jsdom
 *
 * Resumen ejecutivo de Seguimiento (PDF y Excel): lo que ven los jefes.
 * Cómo está hoy, qué se terminó en el periodo, quién lo hizo, cuánto tardó y
 * cuánto tardó la validación del Director, con lo más importante en palabras.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/seguimiento-core');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const HOY = '2026-11-18';

const tarea = o => Object.assign({ tipo: 'orden', estatus: 'pendiente', prioridad: 'normal', aviso_dias: 7, recurrencia: 'ninguna', subdireccion: 'SSO',
    checklist: [], evidencias: [], etiquetas: [], creado_en: '2026-11-03T09:00:00' }, o);
const TAREAS = [
    // Entregada a tiempo (1 día antes) y validada 2 días después.
    tarea({ id: 'a', folio: 1, titulo: 'Plan de ayudas visuales', responsable: 'Luis García', fecha_inicio: '2026-11-02', fecha_limite: '2026-11-10',
        estatus: 'completada', entregada_en: '2026-11-09T15:00:00', entregada_por: 'Luis García', validada_en: '2026-11-11T10:00:00', validada_por: 'Gonzalo Sandoval', completada_en: '2026-11-11T10:00:00' }),
    // Cerrada directo por el admin, 3 días tarde; sin inicio: cuenta desde que se registró.
    tarea({ id: 'b', folio: 2, titulo: 'Informe mensual', responsable: 'Ana Ruiz', fecha_limite: '2026-11-05', estatus: 'completada', completada_en: '2026-11-08T10:00:00', creado_en: '2026-11-03T09:00:00' }),
    // Abierta y vencida.
    tarea({ id: 'c', folio: 3, titulo: 'Manual SMS', responsable: 'Ana Ruiz', fecha_limite: '2026-11-12' }),
    // Entregada, espera al Director.
    tarea({ id: 'd', folio: 4, titulo: 'Bacheo', subdireccion: 'SI', responsable: 'Jorge Peña', estatus: 'por_validar', entregada_en: '2026-11-15T09:00:00', entregada_por: 'Jorge Peña', fecha_limite: '2026-11-20' }),
    // Renovación próxima, y una terminada en octubre (fuera del periodo).
    tarea({ id: 'e', folio: 5, titulo: 'Certificado AFAC', tipo: 'certificado', responsable: 'Isaac López', fecha_limite: '2027-01-05' }),
    tarea({ id: 'f', folio: 6, titulo: 'Inventario', responsable: 'Luis García', fecha_limite: '2026-10-20', estatus: 'completada', completada_en: '2026-10-19T10:00:00', creado_en: '2026-10-01T09:00:00' }),
    tarea({ id: 'g', folio: 7, titulo: 'Cancelada', estatus: 'cancelada' }),
];

describe('qué dice el resumen', () => {
    const r = C.reporteEjecutivo(TAREAS, { hoy: HOY, desde: '2026-11-01', hasta: HOY });

    test('periodos: este mes, mes anterior, últimos 30 días, todo y uno a la medida', () => {
        expect(C.rangoPeriodo('mes', HOY)).toMatchObject({ desde: '2026-11-01', hasta: HOY, texto: '1 al 18 de noviembre de 2026' });
        expect(C.rangoPeriodo('mes_anterior', HOY)).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31', texto: '1 al 31 de octubre de 2026' });
        expect(C.rangoPeriodo('30', HOY).texto).toBe('20 de octubre al 18 de noviembre de 2026');
        expect(C.rangoPeriodo('todo', HOY)).toMatchObject({ desde: null, texto: 'Todo el historial, al 18 de noviembre de 2026' });
        expect(C.rangoPeriodo('libre', HOY, '2026-11-10', '2026-11-01')).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-10' });
        expect(C.rangoPeriodo('anio', HOY).texto).toBe('1 de enero al 18 de noviembre de 2026');
    });

    test('cada terminada: cuánto tardó, cuánto tardó la validación y si fue a tiempo', () => {
        const a = r.terminadas.find(x => x.tarea.id === 'a');
        expect(a).toMatchObject({ inicio: '2026-11-02', fin: '2026-11-09', dias: 7, validacion: 2, desfase: -1, aTiempo: true });
        const b = r.terminadas.find(x => x.tarea.id === 'b');
        expect(b).toMatchObject({ inicio: '2026-11-03', fin: '2026-11-08', dias: 5, validacion: null, desfase: 3, aTiempo: false });
        // La de octubre no entra al periodo; la cancelada no cuenta.
        expect(r.terminadas.map(x => x.tarea.id)).toEqual(['a', 'b']);
    });

    test('las cifras: hoy al corte y en el periodo', () => {
        expect(r.kpis).toMatchObject({
            abiertas: 2, vencidas: 1, porValidar: 1, terminadas: 2, entregadas: 2, nuevas: 5,
            aTiempo: 1, conFecha: 2, aTiempoPct: 50, diasPromedio: 6, validacionPromedio: 2, total: 6, canceladas: 1,
        });
        expect(r.vencidas.map(x => [x.tarea.id, x.atraso])).toEqual([['c', 6]]);
        expect(r.porValidar.map(x => [x.tarea.id, x.esperando])).toEqual([['d', 3]]);
        expect(r.renovaciones.map(x => x.tarea.id)).toEqual(['e']);
    });

    test('quién hizo qué: por responsable y por subdirección', () => {
        const luis = r.porResponsable.find(p => p.nombre === 'Luis García');
        expect(luis).toMatchObject({ terminadas: 1, aTiempoPct: 100, diasPromedio: 7, abiertas: 0, vencidas: 0 });
        const ana = r.porResponsable.find(p => p.nombre === 'Ana Ruiz');
        expect(ana).toMatchObject({ terminadas: 1, aTiempoPct: 0, diasPromedio: 5, abiertas: 1, vencidas: 1 });
        expect(r.porResponsable.find(p => p.nombre === 'Jorge Peña')).toMatchObject({ porValidar: 1 });
        const sso = r.porSubdireccion.find(s => s.clave === 'SSO');
        expect(sso).toMatchObject({ abiertas: 2, vencidas: 1, terminadas: 2, aTiempoPct: 50 });
    });

    test('lo más importante, en palabras', () => {
        const textos = C.destacadosReporte(r).map(d => d.tono + ' · ' + d.texto);
        expect(textos[0]).toBe('rojo · 1 tarea vencida. La más atrasada: «Manual SMS», 6 días de atraso (Ana Ruiz).');
        expect(textos).toContain('rojo · Se terminaron 2 tareas en el periodo; 50% se entregó a tiempo (1 de 2 con fecha límite).');
        expect(textos).toContain('azul · En promedio, una tarea tardó 6 días desde su inicio hasta su entrega.');
        expect(textos).toContain('cian · La validación del Director tomó en promedio 2 días. 1 tarea espera su validación.');
        expect(textos.some(t => t.includes('«Certificado AFAC», el 5 de enero de 2027'))).toBe(true);
    });
});

/* ---------- En la página ---------- */
function fakeSupabase(db) {
    return {
        rpc: async () => ({ data: 'admin', error: null }),
        from(tabla) {
            const q = { f: [] };
            const api = { select() { return api; }, order() { return api; }, limit() { return api; }, eq(c, v) { q.f.push([c, v]); return api; },
                then(ok) { return Promise.resolve({ data: (db[tabla] || []).filter(r => q.f.every(([c, v]) => r[c] === v)), error: null }).then(ok); } };
            return api;
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {},
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { email: 'isaac.lopez@aifa.operaciones', user_metadata: {} } } } }) },
        storage: { from() { return {}; } },
    };
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(res => setTimeout(res, 20)); };

describe('descargar el resumen', () => {
    let escrito = '';
    beforeAll(async () => {
        document.body.innerHTML = `
            <nav><a class="menu-item" href="#" id="menu-seguimiento" data-section="seguimiento" style="display:none;">Seguimiento</a></nav>
            <main><div id="coord-auditoria-section" class="content-section"></div></main>`;
        window.supabaseClient = fakeSupabase({
            seguimiento_acceso: [{ email: 'isaac.lopez@aifa.operaciones', rol: 'admin' }],
            seguimiento_tareas: TAREAS.map(t => Object.assign({ clase: 'agenda', entregada_en: null }, t)),
            seguimiento_comentarios: [], seguimiento_actividad: [], agenda_2026: [],
        });
        sessionStorage.setItem('user_fullname', 'Isaac Azhael López Cancino');
        window.showSection = jest.fn();
        // Sin html2pdf (como en jsdom) se abre para imprimir: así se puede leer lo que sale.
        window.open = jest.fn(() => ({ document: { open() {}, write(h) { escrito += h; }, close() {} }, focus() {}, print() {} }));
        new Function(leer('js/seguimiento.js'))();
        await esperar();
        document.getElementById('seguimiento-section').classList.add('active');
        await esperar();
    });

    const modal = () => document.getElementById('seg-modal');

    test('se elige el periodo y el espacio, con una vista previa de lo que incluye', async () => {
        document.getElementById('seg-btn-resumen').click();
        expect(modal().hidden).toBe(false);
        expect(modal().textContent).toContain('Descargar resumen ejecutivo');
        const periodos = [...modal().querySelectorAll('[data-rep="periodo"]')].map(b => b.textContent.trim());
        expect(periodos).toEqual(['Este mes', 'Mes anterior', 'Últimos 30 días', 'Este trimestre', 'Este año', 'Todo el historial', 'Personalizado…']);
        modal().querySelector('[data-rep="periodo"][data-rv="todo"]').click();
        expect(modal().querySelector('.seg-rep-rango').textContent).toContain('Todo el historial');
        expect(modal().querySelector('.seg-rep-vista').textContent).toContain('terminadas');
        modal().querySelector('[data-rep="periodo"][data-rv="libre"]').click();
        expect(modal().querySelectorAll('[data-rep-f]')).toHaveLength(2);
        modal().querySelector('[data-rep="periodo"][data-rv="mes"]').click();
    });

    test('el PDF trae portada, indicadores, lo más importante y quién hizo qué', async () => {
        modal().querySelector('[data-rep-fmt="pdf"]').click();
        await esperar(4);
        expect(window.open).toHaveBeenCalled();
        expect(escrito).toContain('Resumen ejecutivo de seguimiento');
        ['Hoy, al corte', 'En el periodo', 'Lo más importante', 'Desempeño por responsable', 'Atención inmediata · vencidas',
            'Esperan la validación del Director', 'Terminadas en el periodo', 'Tiempo de atención'].forEach(t => expect(escrito).toContain(t));
        expect(escrito).toContain('Plan de ayudas visuales');
        expect(escrito).toContain('A tiempo · 1 día antes');
        expect(escrito).toContain('3 días tarde');
        expect(escrito).toContain('6 días de atraso');
        expect(modal().hidden).toBe(true);   // se cierra al descargar
    });

    test('el Excel: resumen y hojas de detalle con sus datos', () => {
        const M = window.seguimientoModule.resumen;
        const rep = M.armar({ periodo: 'mes', espacio: 'agenda' });
        const H = M.hojas(rep);
        expect(H.tablas.map(t => t.nombre)).toEqual(['Terminadas', 'Pendientes', 'Por validar', 'Todas las tareas']);
        const term = H.tablas[0];
        const fila = term.filas.find(f => f.celdas[1] === 'Plan de ayudas visuales');
        expect(fila.celdas.slice(4, 14)).toEqual(['Luis García', 'Luis García', 'Gonzalo Sandoval', '2026-11-02', '2026-11-09', '2026-11-11', '2026-11-10', 7, 2, 'A tiempo · 1 día antes']);
        expect(fila.tono).toBe('verde');
        expect(term.filas.find(f => f.celdas[1] === 'Informe mensual').tono).toBe('rojo');
        expect(H.resumen.kpisPeriodo.find(k => k.lbl === 'A tiempo')).toMatchObject({ val: 0.5, pct: true });
        // Mismas terminadas: primero quien tiene vencidas (pide atención).
        expect(H.resumen.responsables.filas.slice(0, 2).map(f => f[0])).toEqual(['Ana Ruiz', 'Luis García']);
        // Avance general: todas las completadas (también la de octubre), 3 de 6.
        expect(H.resumen.subdirecciones.total).toEqual(['TOTAL', 2, 1, 1, 2, 0.5, 0.5]);
    });
});
