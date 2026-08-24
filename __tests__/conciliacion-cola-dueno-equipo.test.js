/**
 * @jest-environment jsdom
 *
 * La cola de pendientes se limpia sola en vez de crecer para siempre.
 *
 * Síntoma: el contador marcaba "119 capturas pendientes de otro equipo" con
 * cero capturas sin guardar en la máquina y con buena conexión en todos los
 * equipos. Los datos SÍ estaban guardados; lo que se acumulaba era la
 * contabilidad de la cola.
 *
 * Tres causas encadenadas:
 *
 *   1. `visibilitychange → hidden` encolaba lo pendiente. Eso se dispara al
 *      cambiar de pestaña o de aplicación, no sólo al cerrar: cada vez que
 *      alguien salía de la pestaña dentro de los 400 ms del autoguardado, se
 *      escribía un renglón de cola para algo que se iba a guardar solo.
 *
 *   2. El dueño del renglón era el id de PESTAÑA (sessionStorage), que muere
 *      con ella.
 *
 *   3. Retirar un renglón exigía ser su dueño. Al volver a entrar, el equipo
 *      tenía otro id: sus propios renglones le aparecían como "de otro equipo"
 *      y nadie podía quitarlos nunca.
 *
 * Ahora: el dueño es el EQUIPO (localStorage, estable entre recargas), un valor
 * confirmado por la base retira el pendiente sin importar quién lo encoló, y al
 * cargar se reconcilia lo que ya está guardado.
 */

const fs = require('fs');
const path = require('path');

const source = fs
    .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
    .replace(/\r\n/g, '\n');

function extraer(nombre) {
    const marca = `function ${nombre}(`;
    let inicio = source.indexOf(marca);
    if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
    if (source.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
    return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

/** Cliente Supabase de mentiras con una tabla de cola en memoria. */
function montarCola(filas) {
    const tabla = filas.map(f => ({ ...f }));
    const registro = { borrados: [], selects: 0 };
    const client = {
        from() {
            const filtros = [];
            const api = {
                select() { registro.selects += 1; api._modo = 'select'; return api; },
                delete() { api._modo = 'delete'; return api; },
                eq(col, val) { filtros.push(f => String(f[col]) === String(val)); return api; },
                in(col, vals) {
                    const set = new Set(vals.map(String));
                    filtros.push(f => set.has(String(f[col])));
                    return api;
                },
                then(res, rej) {
                    const hit = tabla.filter(f => filtros.every(p => p(f)));
                    if (api._modo === 'delete') {
                        hit.forEach(f => {
                            registro.borrados.push(f.id);
                            tabla.splice(tabla.indexOf(f), 1);
                        });
                        return Promise.resolve({ data: null, error: null }).then(res, rej);
                    }
                    return Promise.resolve({ data: hit, error: null }).then(res, rej);
                },
            };
            return api;
        },
    };
    return { client, tabla, registro };
}

/** Sólo las piezas de la cola, con sus dependencias mínimas simuladas. */
function cargar(cola, pendientesRemotos = []) {
    return new Function('document', 'window', 'localStorage', 'cola', `
    let _conciLiveClientId = 'pestana-nueva';
    let _conciDeviceIdCache = '';
    let _conciColaDisponible = true;
    let _conciPendientesRemotos = ${JSON.stringify(pendientesRemotos)};
    const _CONCI_DEVICE_KEY = 'aifa-conci-device-id';
    const _CONCI_TABLA_PENDIENTES = 'conciliacion_capturas_pendientes';
    const crypto = { randomUUID: () => 'equipo-generado' };
    function _conciColaFalla(e) { throw e; }
    function _conciClientePendientes() { return Promise.resolve(cola.client); }
    function _conciActualizarIndicadorBorradores() { }
    function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
    function _conciPendienteEsIdentidad(reg) { return String(reg.row_id || '').startsWith('mov:'); }
    function _conciBuscarFilaPorIdentidad() { return null; }
    function _conciIdentidadDeFila(tr) { return String(tr.dataset.identidad || ''); }
    ${extraer('_conciDeviceId')}
    ${extraer('_conciFindLiveCell')}
    ${extraer('_conciCeldaDePendiente')}
    ${extraer('_conciBorrarPendientesRemotos')}
    ${extraer('_conciPurgarPendientesConfirmados')}
    ${extraer('_conciReconciliarPendientesRemotos')}
    ${extraer('_conciPendientesAjenos')}
    return {
        _conciDeviceId, _conciBorrarPendientesRemotos, _conciPurgarPendientesConfirmados,
        _conciReconciliarPendientesRemotos, _conciPendientesAjenos,
        pendientes: () => _conciPendientesRemotos,
    };
  `)(document, window, localStorage, cola);
}

/** Una fila de la tabla con sus celdas ya confirmadas (no sucias). */
function montarTabla(rowId, celdas, sucias = []) {
    document.body.innerHTML = `<table id="table-conci-manifiestos"><tbody>
        <tr data-row-id="${rowId}">
            ${Object.entries(celdas).map(([col, val]) =>
                `<td data-col="${col}" data-raw="${val}"${sucias.includes(col) ? ' data-dirty="1"' : ''}>${val}</td>`
            ).join('')}
        </tr></tbody></table>`;
    return document.querySelector('tr[data-row-id]');
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('el dueño de un renglón de la cola es el equipo, no la pestaña', () => {
    test('el id sobrevive a cerrar y reabrir la pestaña', () => {
        const primera = cargar(montarCola([]));
        const id = primera._conciDeviceId();
        expect(id).toBeTruthy();

        // Otra pestaña: sessionStorage se fue, localStorage sigue.
        const segunda = cargar(montarCola([]));
        expect(segunda._conciDeviceId()).toBe(id);
    });

    test('lo encolado por este equipo deja de verse como ajeno al volver a entrar', () => {
        const antes = cargar(montarCola([]));
        const equipo = antes._conciDeviceId();

        const despues = cargar(montarCola([]), [
            { id: 1, row_id: '10', columna: 'PASAJEROS', valor: '150', cliente_id: equipo },
            { id: 2, row_id: '11', columna: 'PASAJEROS', valor: '90', cliente_id: 'otro-equipo' },
        ]);
        const ajenos = despues._conciPendientesAjenos();
        expect(ajenos.map(a => a.id)).toEqual([2]);
    });
});

describe('un valor confirmado retira el pendiente, lo haya encolado quien lo haya encolado', () => {
    test('borra el renglón ajeno cuando la base ya tiene ese mismo valor', async () => {
        const cola = montarCola([
            { id: 7, row_id: '10', columna: 'PASAJEROS', valor: '150', cliente_id: 'pestana-muerta' },
        ]);
        const api = cargar(cola);
        const tr = montarTabla('10', { PASAJEROS: '150' });

        await api._conciPurgarPendientesConfirmados(tr, ['10'], ['PASAJEROS']);
        expect(cola.registro.borrados).toEqual([7]);
        expect(cola.tabla).toHaveLength(0);
    });

    test('NO borra el renglón ajeno si trae un valor distinto', async () => {
        const cola = montarCola([
            { id: 8, row_id: '10', columna: 'PASAJEROS', valor: '188', cliente_id: 'pestana-muerta' },
        ]);
        const api = cargar(cola);
        const tr = montarTabla('10', { PASAJEROS: '150' });

        await api._conciPurgarPendientesConfirmados(tr, ['10'], ['PASAJEROS']);
        // Es una captura ajena de verdad, todavía sin aplicar: se respeta.
        expect(cola.registro.borrados).toEqual([]);
        expect(cola.tabla).toHaveLength(1);
    });

    test('una celda que sigue sucia no confirma nada', async () => {
        const cola = montarCola([
            { id: 9, row_id: '10', columna: 'PASAJEROS', valor: '150', cliente_id: 'pestana-muerta' },
        ]);
        const api = cargar(cola);
        const tr = montarTabla('10', { PASAJEROS: '150' }, ['PASAJEROS']);

        await api._conciPurgarPendientesConfirmados(tr, ['10'], ['PASAJEROS']);
        expect(cola.registro.borrados).toEqual([]);
    });
});

describe('al cargar se reconcilia lo que ya está guardado', () => {
    test('retira los pendientes cuyo valor ya está en la celda', async () => {
        const remotos = [
            { id: 1, row_id: '10', columna: 'PASAJEROS', valor: '150', cliente_id: 'x' },
            { id: 2, row_id: '10', columna: 'CARGA', valor: '999', cliente_id: 'x' },
            { id: 3, row_id: '77', columna: 'PASAJEROS', valor: '50', cliente_id: 'x' },
        ];
        const cola = montarCola(remotos.map(r => ({ ...r })));
        const api = cargar(cola, remotos);
        montarTabla('10', { PASAJEROS: '150', CARGA: '12' });

        await api._conciReconciliarPendientesRemotos();

        // 1 coincide → fuera. 2 difiere → se queda. 3 no está a la vista → se queda.
        expect(cola.registro.borrados).toEqual([1]);
        expect(api.pendientes().map(p => p.id)).toEqual([2, 3]);
    });

    test('sin tabla en pantalla no borra nada', async () => {
        const remotos = [{ id: 1, row_id: '10', columna: 'PASAJEROS', valor: '150', cliente_id: 'x' }];
        const cola = montarCola(remotos.map(r => ({ ...r })));
        const api = cargar(cola, remotos);
        document.body.innerHTML = '';

        await api._conciReconciliarPendientesRemotos();
        expect(cola.registro.borrados).toEqual([]);
    });
});

describe('el contador sólo cuenta lo que alguien puede rescatar', () => {
    // Sólo el código: los comentarios citan el texto viejo para explicar de qué
    // venía, y no deben hacer fallar una prueba sobre lo que se muestra.
    const indicador = () => {
        const fn = source.slice(
            source.indexOf('function _conciActualizarIndicadorBorradores()'),
            source.indexOf('function _conciAbrirPanelPendientes')
        );
        expect(fn).toBeTruthy();
        return fn.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    };

    test('descarta las huérfanas del conteo', () => {
        // Las 'nueva:%' no se pueden aplicar ni retirar: sumarlas daba un número
        // enorme que nadie podía bajar y se leía como 'el guardado está roto'.
        expect(indicador()).toContain('ajenos.filter(p => !_conciPendienteEsHuerfano(p))');
        expect(indicador()).toContain('if (!celdas && !rescatables.length)');
    });

    test('ya no dice "sin guardar" de lo que sí se guardó', () => {
        const fn = indicador();
        expect(fn).not.toContain('capturas pendientes de otro equipo');
        expect(fn).not.toContain('capturas sin guardar');
        // Dice de quién son y que se pueden colocar, no un vago 'por revisar'.
        expect(fn).toContain('sin aplicar');
        expect(fn).not.toContain('por revisar');
        expect(fn).toContain('capturas guardándose');
    });
});

describe('reconciliar no puede congelar la pestaña', () => {
    // Regresión real: la primera versión recorría la tabla entera —calculando la
    // identidad de cada fila— una vez POR CADA pendiente. Con 119 pendientes y
    // una tabla grande eran millones de lecturas síncronas al abrir el módulo, y
    // la computadora se trababa. Ahora se indexa una vez y cada pendiente se
    // resuelve directo.
    test('el costo crece con las filas, no con filas × pendientes', async () => {
        const FILAS = 800;
        const PENDIENTES = 120;

        const filas = [];
        for (let i = 0; i < FILAS; i++) {
            filas.push(
                `<tr data-row-id="${i}" data-identidad="mov:X|${i}">`
                + `<td data-col="PASAJEROS" data-raw="${i}">${i}</td>`
                + `<td data-col="CARGA" data-raw="0">0</td></tr>`
            );
        }
        document.body.innerHTML =
            `<table id="table-conci-manifiestos"><tbody>${filas.join('')}</tbody></table>`;

        const remotos = [];
        for (let i = 0; i < PENDIENTES; i++) {
            remotos.push({
                id: i, row_id: `mov:X|${i}`, columna: 'PASAJEROS',
                valor: String(i), cliente_id: 'equipo-ajeno',
            });
        }
        const cola = montarCola(remotos.map(r => ({ ...r })));
        const api = cargar(cola, remotos);

        const t0 = Date.now();
        await api._conciReconciliarPendientesRemotos();
        const ms = Date.now() - t0;

        // Todos coinciden con lo que ya está en su celda: se retiran los 120.
        expect(cola.registro.borrados).toHaveLength(PENDIENTES);
        // Con el bug esto tardaba segundos; indexando es instantáneo.
        expect(ms).toBeLessThan(1500);
    });
});

describe('cambiar de pestaña guarda, no encola', () => {
    test('visibilitychange llama al guardado inmediato y no a la cola de cierre', () => {
        // Hay varios 'visibilitychange' en el archivo; el de conciliación es el
        // que reacciona a visibilityState === 'hidden'.
        const ancla = source.indexOf("if (document.visibilityState === 'hidden')");
        expect(ancla).toBeGreaterThan(-1);
        const bloque = source.slice(ancla, ancla + 120);
        expect(bloque).toMatch(/_conciGuardarPendientesYa\(\)/);
        expect(bloque).not.toMatch(/_conciEnviarPendientesAlCerrar\(\)/);
        // `pagehide` sí conserva el envío de último momento: ahí la página muere.
        expect(source).toMatch(/addEventListener\('pagehide', _conciEnviarPendientesAlCerrar\)/);
    });

    test('el guardado inmediato vence el temporizador del autoguardado', () => {
        const fn = extraer('_conciGuardarPendientesYa');
        expect(fn).toMatch(/clearTimeout\(tr\._conciAutoSaveTimer\)/);
        expect(fn).toMatch(/_conciAutoSaveRow\(tr/);
    });
});
