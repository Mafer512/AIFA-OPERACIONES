/**
 * @jest-environment jsdom
 *
 * Migración 054 (ajuste de lógica sobre 053) — Cierre de Subsecretaría.
 *
 * Cubre, con trazabilidad explícita, los 20 casos pedidos para este cambio:
 *
 *   CASO 1-4, 17-20  → el criterio del LOTE y de concurrencia NO cambiaron
 *                       (decisión confirmada: se conserva el comportamiento
 *                       de 053, "lo que falta por cerrar", que en operación
 *                       normal —un corte cada día— entra exactamente igual
 *                       que "capturado el día X entra en el corte X"). Estas
 *                       pruebas re-afirman, sobre el archivo 053 SIN TOCAR,
 *                       que esas garantías siguen intactas después de 054.
 *   CASO 5-10        → alerta de 30 horas (interruptor + cálculo real).
 *   CASO 11-12       → historial de "CAPTURÓ", del lado servidor (054).
 *   CASO 13-16       → ledger before/after (ya en 053, sin cambios; se deja
 *                       constancia explícita de que la aritmética sigue ahí).
 *
 * Igual que conciliacion-cierre-subsecretaria-sql.test.js: sin Supabase local
 * en este entorno, así que 054 se verifica como TEXTO (regex sobre la
 * migración) más ejecución REAL de la parte que sí es JavaScript puro
 * (_conciHorasDesdeSlot en script.js, y js/conci-alerta-30h.js completo).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const sql053 = leer('supabase/migrations/053_conciliacion_cierre_subsecretaria.sql');
const sql054 = leer('supabase/migrations/054_conciliacion_cierre_subsecretaria_ajuste_logica.sql');
const scriptJs = leer('script.js');
const indexHtml = leer('index.html');
const alertaJsSrc = leer('js/conci-alerta-30h.js');

const sinComentariosSQL = (texto) => texto
  .split('\n')
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n');

const sql054SC = sinComentariosSQL(sql054);
const sql053SC = sinComentariosSQL(sql053);

/** Cuerpo completo de una función CREATE OR REPLACE de un archivo dado. */
function fnDe(texto, nombre) {
  const m = texto.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nombre}[\\s\\S]*?^\\$\\$;`, 'm'));
  if (!m) throw new Error(`No se encontró la función ${nombre}`);
  return m[0];
}
const fn054 = (nombre) => fnDe(sql054, nombre);
const fn054SC = (nombre) => sinComentariosSQL(fn054(nombre));

/** Extrae el texto fuente de una `function nombre(...) { ... }` de nivel raíz
 * por conteo de llaves (evita depender de dónde empieza la siguiente función). */
function extraerFuncionJs(fuente, nombre) {
  const inicio = fuente.indexOf(`function ${nombre}(`);
  if (inicio === -1) throw new Error(`No se encontró function ${nombre} en el archivo`);
  let i = fuente.indexOf('{', inicio);
  let profundidad = 0;
  for (; i < fuente.length; i++) {
    if (fuente[i] === '{') profundidad++;
    else if (fuente[i] === '}') {
      profundidad--;
      if (profundidad === 0) return fuente.slice(inicio, i + 1);
    }
  }
  throw new Error(`Llaves desbalanceadas extrayendo ${nombre}`);
}

/* ════════════════════════════════════════════════════════════════════════
 * CASO 1-4 y 17-20 — el criterio del lote y la concurrencia de 053 siguen
 * intactos: 054 no los toca (decisión confirmada explícitamente).
 * ════════════════════════════════════════════════════════════════════════ */
describe('CASO 1-4 y 17-20 — 053 no se modificó: lote y concurrencia intactos', () => {
  test('054 no re-declara conciliacion_cerrar_subsecretaria ni cambia su criterio de lote', () => {
    // 054 no debe traer una CREATE OR REPLACE de esta función: la decisión
    // fue conservar exactamente la de 053.
    expect(sql054).not.toMatch(/CREATE OR REPLACE FUNCTION public\.conciliacion_cerrar_subsecretaria/);
  });

  test('CASO 1/2 (capturado el mismo día, o vuelo de días antes capturado el día del corte): sigue el criterio de 053 (cierre_id IS NULL + cierre_capturado_en dentro de la frontera, sin filtrar por FECHA de operación)', () => {
    const cerrar = sinComentariosSQL(fnDe(sql053, 'conciliacion_cerrar_subsecretaria'));
    expect(cerrar).toMatch(
      /FROM public\."Conciliación Manifiestos"\s+WHERE cierre_id IS NULL\s+AND cierre_capturado_en IS NOT NULL\s+AND cierre_capturado_en >= v_baseline\s+AND cierre_capturado_en <= v_instante/
    );
    expect(cerrar).not.toMatch(/"FECHA"/);
  });

  test('CASO 3 (capturado antes y aún abierto): decisión documentada — 054 explica por qué NO se restringe a "sólo el día del corte" (riesgo de huérfanos si se salta un corte) y dónde queda la constancia', () => {
    expect(sql054).toMatch(/Criterio del lote del corte — SIN CAMBIOS/);
    expect(sql054).toMatch(/dejar manifiestos huérfanos/);
    expect(sql054).toMatch(/Decisión confirmada\s*\n--\s+con el usuario/);
  });

  test('CASO 4 ("Solo Vuelos" sin manifiesto real no entra al cierre): el lote de 053 sólo lee "Conciliación Manifiestos" (fila real), nunca una fuente de itinerario', () => {
    const cerrar = sinComentariosSQL(fnDe(sql053, 'conciliacion_cerrar_subsecretaria'));
    expect(cerrar).not.toMatch(/itinerario|Solo Vuelos/i);
  });

  test('CASO 17 (fecha del filtro de Manifiestos ≠ fecha del cierre): el RPC sigue sin parámetros y el cliente sigue sin leer el filtro', () => {
    const jsCierre = leer('js/conci-cierre-subsecretaria.js');
    expect(jsCierre).toMatch(/rpc\('conciliacion_cerrar_subsecretaria'\)/);
    expect(jsCierre).not.toMatch(/p_fecha/);
    expect(jsCierre).not.toMatch(/function fechaSeleccionadaIso/);
    // Y el modal muestra explícitamente la fecha del CORTE, no la del filtro.
    expect(jsCierre).toMatch(/conci-cierre-fecha-1/);
    expect(jsCierre).toMatch(/_fijoData\?\.siguiente_fecha_corte/);
  });

  test('CASO 18 (dos cierres simultáneos, uno solo por fecha): el UNIQUE de 053 sigue ahí y 054 no lo toca', () => {
    expect(sql053).toMatch(/CONSTRAINT ux_conciliacion_cierres_fecha UNIQUE \(fecha_corte\)/);
    expect(sql054).not.toMatch(/ux_conciliacion_cierres_fecha/);
  });

  test('CASO 19 (captura concurrente en la frontera del cierre): el candado único y el orden lock→instante de 053 no se tocan en 054', () => {
    expect(sql053).toMatch(/_conci_lock_contabilidad\(\)/);
    expect(sql054).not.toMatch(/CREATE OR REPLACE FUNCTION public\._conci_lock_contabilidad/);
    expect(sql054).not.toMatch(/pg_advisory_xact_lock/);
  });

  test('CASO 20 (corrección concurrente con cierre: un ajuste se consume una sola vez): 054 no re-declara conciliacion_solicitar_correccion/resolver ni la tabla de ajustes', () => {
    expect(sql054).not.toMatch(/CREATE OR REPLACE FUNCTION public\.conciliacion_solicitar_correccion/);
    expect(sql054).not.toMatch(/CREATE OR REPLACE FUNCTION public\.conciliacion_resolver_solicitud_correccion/);
    expect(sql054).not.toMatch(/CREATE TABLE.*conciliacion_ajustes/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * CASO 13-16 — ledger before/after: ya existe en 053, 054 no lo toca.
 * ════════════════════════════════════════════════════════════════════════ */
describe('CASO 13-16 — ledger before/after (sin cambios, ya cubierto por 053)', () => {
  test('054 no redefine _conci_delta_numerico ni la vista reportable', () => {
    expect(sql054).not.toMatch(/CREATE OR REPLACE FUNCTION public\._conci_delta_numerico/);
    expect(sql054).not.toMatch(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable/);
  });

  test('CASO 13/14 (150→180 y luego →170: +30 y después −10, acumulado 170): la fórmula DESPUÉS−ANTES de 053 sostiene esa aritmética', () => {
    // No se reimplementa el trigger: se ejerce la MISMA fórmula que
    // _conci_delta_numerico documenta y que la sql.test.js ya verifica byte a
    // byte contra 053 ("el delta numérico se DERIVA de antes/después").
    const delta = (antes, despues) => despues - antes;
    const cierreA = 150;
    const cierreB = cierreA + delta(150, 180); // +30
    const cierreC = cierreB + delta(180, 170); // -10
    expect(delta(150, 180)).toBe(30);
    expect(delta(180, 170)).toBe(-10);
    expect(cierreC).toBe(170);
    expect(sinComentariosSQL(fnDe(sql053, '_conci_delta_numerico'))).toMatch(
      /coalesce\(public\._aifa_safe_numeric\(p_despues ->> t\.campo\), 0\)\s*-\s*coalesce\(public\._aifa_safe_numeric\(p_antes\s+->> t\.campo\), 0\)/
    );
  });

  test('CASO 15 (reclasificación NACIONAL→INTERNACIONAL: -150/-1 y +150/+1, neto 0): la vista sigue emitiendo las dos filas sintéticas con _signo -1/+1', () => {
    expect(sql053).toMatch(/\(-1\)::smallint,\s*\n\s*a\.id,/);
    expect(sql053).toMatch(/1::smallint,\s*\n\s*a\.id,/);
  });

  test('CASO 16 (solicitud creada día A, aprobada día B: el ajuste pertenece al cierre B): aprobado_en se fija con clock_timestamp() al aprobar, no al crear', () => {
    const resolver = sinComentariosSQL(fnDe(sql053, 'conciliacion_resolver_solicitud_correccion'));
    expect(resolver).toMatch(/v_instante := clock_timestamp\(\);/);
    expect(resolver).toMatch(/INSERT INTO public\.conciliacion_ajustes \([\s\S]*?aprobado_en\s*\)\s*VALUES \([\s\S]*?v_instante/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * CASO 7, 8, 9 — window._conciHorasDesdeSlot (script.js), EJECUTADA REAL:
 * prioridad SLOT COORDINADO > SLOT ASIGNADO, y "sin datos ⇒ null" (nunca
 * inventar un vencimiento).
 * ════════════════════════════════════════════════════════════════════════ */
describe('CASO 7-9 — _conciHorasDesdeSlot: prioridad de slots y ausencia de datos', () => {
  let horasDesdeSlot;

  beforeAll(() => {
    // Se extrae y ejecuta el CÓDIGO REAL de script.js (no una reimplementación):
    // las funciones de las que depende _conciHorasDesdeSlot.
    const src = [
      extraerFuncionJs(scriptJs, '_conciResolveYear'),
      extraerFuncionJs(scriptJs, '_conciParseDateTimeParts'),
      extraerFuncionJs(scriptJs, '_conciPartsToDate'),
      extraerFuncionJs(scriptJs, '_conciHorasDesdeSlot'),
      'return _conciHorasDesdeSlot;',
    ].join('\n\n');
    // eslint-disable-next-line no-new-func
    horasDesdeSlot = new Function(src)();
  });

  test('_conciHorasDesdeSlot está expuesta en window (script.js)', () => {
    expect(scriptJs).toMatch(/window\._conciHorasDesdeSlot = _conciHorasDesdeSlot;/);
  });

  test('CASO 7: con SLOT COORDINADO presente, se usa SLOT COORDINADO (no el asignado)', () => {
    const ahora = new Date(2026, 8, 23, 10, 0); // 23/09/2026 10:00
    const asignado = '20/09/2026 00:00';   // si se usara este: 3 días → vencido de sobra
    const coordinado = '23/09/2026 09:00'; // 1 hora antes de "ahora": NO vencido
    const horas = horasDesdeSlot(asignado, coordinado, 2026, ahora);
    expect(horas).toBeCloseTo(1, 5);
    expect(horas).toBeLessThan(30);
  });

  test('CASO 8: SLOT COORDINADO vacío, SLOT ASIGNADO presente → se usa el asignado', () => {
    const ahora = new Date(2026, 8, 23, 10, 0);
    const asignado = '22/09/2026 03:00'; // 31 horas antes de "ahora": vencido
    const horas = horasDesdeSlot(asignado, '', 2026, ahora);
    expect(horas).toBeCloseTo(31, 5);
    expect(horas).toBeGreaterThanOrEqual(30);
  });

  test('CASO 9: ambos slots vacíos o inválidos → null (nunca se inventa un vencimiento)', () => {
    const ahora = new Date(2026, 8, 23, 10, 0);
    expect(horasDesdeSlot('', '', 2026, ahora)).toBeNull();
    expect(horasDesdeSlot(null, undefined, 2026, ahora)).toBeNull();
    expect(horasDesdeSlot('texto-no-fecha', '', 2026, ahora)).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * CASO 5, 6, 10 — js/conci-alerta-30h.js EJECUTADO REAL en jsdom: la alerta
 * aparece cuando un vuelo vence, desaparece cuando se captura el manifiesto,
 * y el interruptor general la apaga por completo.
 * ════════════════════════════════════════════════════════════════════════ */
describe('CASO 5, 6, 10 — módulo de alerta de 30 h (ejecución real, jsdom)', () => {
  function montarDom() {
    document.body.innerHTML = `
      <select id="filter-conci-manifiestos-year"><option value="2026" selected>2026</option></select>
      <button class="d-none position-relative" id="btn-conci-alerta30h-pendientes">
        <span id="badge-conci-alerta30h-pendientes">0</span>
      </button>
      <div class="d-none" id="conci-alerta30h-toggle-wrap">
        <input type="checkbox" id="conci-alerta30h-toggle" checked>
      </div>
    `;
  }

  function crearClienteFalso({ habilitado = true } = {}) {
    const llamadas = { rpc: [], from: [] };
    return {
      llamadas,
      cliente: {
        from: jest.fn((tabla) => {
          llamadas.from.push(tabla);
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { habilitado }, error: null }),
              }),
            }),
          };
        }),
        rpc: jest.fn(async (nombre, params) => {
          llamadas.rpc.push({ nombre, params });
          return { data: { habilitado: params?.p_habilitado }, error: null };
        }),
      },
    };
  }

  function cargarModulo() {
    // eslint-disable-next-line no-new-func
    const factory = new Function('window', 'document', `${alertaJsSrc}\nreturn window;`);
    return factory(window, document);
  }

  function vueloSoloVuelosVencido() {
    return {
      _fuente: 'Solo Vuelos',
      'SLOT ASIGNADO': '20/09/2026 00:00', // muy anterior a "ahora" simulado más abajo
      'SLOT COORDINADO': '',
      '# DE VUELO': 'AM123',
      FECHA: '20/09',
    };
  }

  function manifiestoRealCapturado() {
    return {
      _fuente: undefined, // NO es 'Solo Vuelos': hay manifiesto real capturado
      'SLOT ASIGNADO': '20/09/2026 00:00',
      'SLOT COORDINADO': '',
      '# DE VUELO': 'AM123',
      FECHA: '20/09',
    };
  }

  let originalDate;
  beforeAll(() => {
    // "Ahora" fijo y lejano a los slots de prueba, para que la comparación de
    // 30 h sea determinística sin depender de la fecha real de ejecución.
    originalDate = Date;
    const fija = new originalDate(2026, 8, 23, 12, 0);
    // eslint-disable-next-line no-global-assign
    global.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) return new originalDate(fija.getTime());
        return new originalDate(...args);
      }
      static now() { return fija.getTime(); }
    };
  });
  afterAll(() => { global.Date = originalDate; });

  beforeEach(() => {
    jest.resetModules();
    montarDom();
    // Dependencia real de script.js (ya probada arriba); aquí se monta tal
    // cual para que conci-alerta-30h.js la use por window, como en producción.
    const src = [
      extraerFuncionJs(scriptJs, '_conciResolveYear'),
      extraerFuncionJs(scriptJs, '_conciParseDateTimeParts'),
      extraerFuncionJs(scriptJs, '_conciPartsToDate'),
      extraerFuncionJs(scriptJs, '_conciHorasDesdeSlot'),
    ].join('\n\n');
    // eslint-disable-next-line no-new-func
    new Function('window', src + '\nwindow._conciHorasDesdeSlot = _conciHorasDesdeSlot;')(window);
  });

  test('CASO 5: un "Solo Vuelos" vencido (>30h) hace aparecer la alerta cuando el interruptor está ON', async () => {
    const { cliente } = crearClienteFalso({ habilitado: true });
    window.supabaseClient = cliente;
    cargarModulo();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    window._conciAlerta30hOnSummaryData([vueloSoloVuelosVencido()]);
    await Promise.resolve(); await Promise.resolve();

    const btn = document.getElementById('btn-conci-alerta30h-pendientes');
    const badge = document.getElementById('badge-conci-alerta30h-pendientes');
    expect(btn.classList.contains('d-none')).toBe(false);
    expect(badge.textContent).toBe('1');
  });

  test('CASO 6: si el mismo vuelo YA tiene manifiesto real capturado (no es "Solo Vuelos"), la alerta desaparece', async () => {
    const { cliente } = crearClienteFalso({ habilitado: true });
    window.supabaseClient = cliente;
    cargarModulo();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    window._conciAlerta30hOnSummaryData([manifiestoRealCapturado()]);
    await Promise.resolve(); await Promise.resolve();

    const btn = document.getElementById('btn-conci-alerta30h-pendientes');
    expect(btn.classList.contains('d-none')).toBe(true);
  });

  test('CASO 10: con el interruptor general OFF, ningún vuelo vencido muestra alerta', async () => {
    const { cliente } = crearClienteFalso({ habilitado: false });
    window.supabaseClient = cliente;
    cargarModulo();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    window._conciAlerta30hOnSummaryData([vueloSoloVuelosVencido()]);
    await Promise.resolve(); await Promise.resolve();

    const btn = document.getElementById('btn-conci-alerta30h-pendientes');
    expect(btn.classList.contains('d-none')).toBe(true);
  });

  test('el interruptor NO crea un permiso nuevo: reutiliza el mismo flag que el Cierre de Subsecretaría', () => {
    expect(alertaJsSrc).toMatch(/permissions\?\.conciliacion_cierra_subsecretaria === true/);
    expect(alertaJsSrc).not.toMatch(/conciliacion_alerta30h[a-z_]*permiso/i);
  });

  test('el RPC de escritura del interruptor es el único invocado al cambiarlo (nunca se escribe la tabla de config directamente)', () => {
    expect(alertaJsSrc).toMatch(/rpc\('conciliacion_alerta30h_set_estado'/);
    expect(alertaJsSrc).not.toMatch(/from\('conciliacion_alerta30h_config'\)[\s\S]{0,80}\.(update|insert|delete)\(/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * CASO 11, 12 — historial de "CAPTURÓ" del lado SERVIDOR (054).
 * ════════════════════════════════════════════════════════════════════════ */
describe('CASO 11, 12 — historial de "CAPTURÓ" (trigger de 054, verificado como texto)', () => {
  test('existe el trigger BEFORE INSERT OR UPDATE que llama a _conci_capturo_historial()', () => {
    expect(sql054).toMatch(
      /CREATE TRIGGER trg_conci_manifiestos_capturo_historial\s+BEFORE INSERT OR UPDATE ON public\."Conciliación Manifiestos"\s+FOR EACH ROW EXECUTE FUNCTION public\._conci_capturo_historial\(\);/
    );
  });

  test('la detección de "cambió algo de negocio" reutiliza _conci_campos_editables_cierre() de 053 (no inventa una lista nueva) y excluye "CAPTURÓ" de sí misma', () => {
    const trg = fn054SC('_conci_capturo_historial');
    expect(trg).toMatch(/unnest\(public\._conci_campos_editables_cierre\(\)\) AS c\(campo\)/);
    expect(trg).toMatch(/c\.campo <> 'CAPTURÓ'/);
  });

  test('CASO 12: el cierre (cierre_id, "CIERRE SUBSECRETARIA", cierre_es_carga_reportado, cierre_aerolinea_reportada) NO está en la whitelist de negocio, así que quien cierra nunca se auto-concatena', () => {
    const whitelist = sinComentariosSQL(fnDe(sql053, '_conci_campos_editables_cierre'));
    expect(whitelist).not.toMatch(/'cierre_id'/);
    expect(whitelist).not.toMatch(/'CIERRE SUBSECRETARIA'/);
    expect(whitelist).not.toMatch(/'cierre_es_carga_reportado'/);
    expect(whitelist).not.toMatch(/'cierre_aerolinea_reportada'/);
  });

  test('si "CAPTURÓ" se fija explícitamente en el mismo UPDATE (captura manual o corrección dirigida a ese campo), el trigger la respeta sin concatenar', () => {
    const trg = fn054SC('_conci_capturo_historial');
    expect(trg).toMatch(/IF NEW\."CAPTURÓ" IS DISTINCT FROM OLD\."CAPTURÓ" THEN[\s\S]{0,200}RETURN NEW;/);
  });

  test('CASO 11: cada nombre se concatena una sola vez, en orden de primera intervención (Fernando | Juan | María, sin duplicar a Fernando)', () => {
    // _conci_capturo_agregar es SQL puro (no ejecutable sin Postgres aquí):
    // se verifica la fórmula exacta que hace el dedupe y el orden.
    const agregar = fn054SC('_conci_capturo_agregar');
    expect(agregar).toMatch(/btrim\(p_nombre\) = ANY \(\s*SELECT btrim\(parte\) FROM unnest\(string_to_array\(p_actual, '\|'\)\) AS parte\s*\)/);
    expect(agregar).toMatch(/THEN p_actual/); // ya estaba: no se vuelve a concatenar
    expect(agregar).toMatch(/ELSE btrim\(p_actual\) \|\| ' \| ' \|\| btrim\(p_nombre\)/); // nuevo: se agrega al final
  });

  test('_conci_capturo_agregar es la única función que decide el "cómo"; el trigger decide el "cuándo" y no duplica la lógica de dedupe inline', () => {
    const trg = fn054SC('_conci_capturo_historial');
    expect(trg).toMatch(/public\._conci_capturo_agregar\(OLD\."CAPTURÓ", v_nombre\)/);
    expect(trg).not.toMatch(/string_to_array/); // el split vive solo en el helper
  });

  test('resuelve el nombre con el mismo helper ya usado por el resto del módulo (_conci_usuario_nombre)', () => {
    const trg = fn054SC('_conci_capturo_historial');
    expect(trg).toMatch(/public\._conci_usuario_nombre\(\)/);
  });

  test('054 no otorga EXECUTE a PUBLIC/anon/authenticated sobre el helper interno de dedupe', () => {
    expect(sql054).toMatch(/REVOKE ALL ON FUNCTION public\._conci_capturo_agregar\(text, text\) FROM PUBLIC;/);
    expect(sql054).not.toMatch(/GRANT EXECUTE ON FUNCTION public\._conci_capturo_agregar/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * Estructura general de 054 e idempotencia — mismas convenciones que 053.
 * ════════════════════════════════════════════════════════════════════════ */
describe('054 — estructura, requisitos e idempotencia', () => {
  test('un solo BEGIN/COMMIT', () => {
    expect((sql054.match(/^BEGIN;/gm) || []).length).toBe(1);
    expect((sql054.match(/^COMMIT;/gm) || []).length).toBe(1);
  });

  test('NO usa CREATE INDEX CONCURRENTLY', () => {
    expect(sql054SC).not.toMatch(/CREATE INDEX CONCURRENTLY/);
  });

  test('valida al inicio que 053 ya esté instalada (aborta si no)', () => {
    expect(sql054).toMatch(/to_regprocedure\('public\.conciliacion_cerrar_subsecretaria\(\)'\) IS NULL/);
    expect(sql054).toMatch(/RAISE EXCEPTION/);
  });

  test('054 NO modifica el archivo 053 (verificación de integridad del propio repo)', () => {
    // No es una prueba de "diff contra git": es una guarda de que este set de
    // pruebas sigue leyendo el 053 real, no una copia, y que 054 no contiene
    // un DROP/CREATE de sus objetos centrales de negocio.
    expect(sql054).not.toMatch(/DROP TABLE.*conciliacion_cierres_subsecretaria/);
    expect(sql054).not.toMatch(/DROP TABLE.*conciliacion_cierres_snapshot/);
    expect(sql054).not.toMatch(/DROP TABLE.*conciliacion_ajustes\b/);
  });

  test('la tabla nueva usa el mismo patrón de fila única que conciliacion_cierre_config (053) e informe_estadistico_refresco (028)', () => {
    expect(sql054).toMatch(/id\s+boolean PRIMARY KEY DEFAULT true CHECK \(id\)/);
  });

  test('conciliacion_resumen_periodo NO se recrea (053 la eliminó a propósito y ningún JS la invoca)', () => {
    expect(sql054).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.conciliacion_resumen_periodo/);
    const jsCierre = leer('js/conci-cierre-subsecretaria.js');
    expect(jsCierre).not.toMatch(/conciliacion_resumen_periodo/);
    expect(scriptJs).not.toMatch(/conciliacion_resumen_periodo/);
  });

  test('conciliacion_alerta30h_set_estado exige sesión y el privilegio de cierre, y no acepta NULL', () => {
    const rpc = fn054SC('conciliacion_alerta30h_set_estado');
    expect(rpc).toMatch(/auth\.uid\(\) IS NULL/);
    expect(rpc).toMatch(/p_habilitado IS NULL/);
    expect(rpc).toMatch(/public\.conciliacion_puede_cerrar_subsecretaria\(\)/);
  });

  test('RLS: la tabla de configuración de la alerta no otorga escritura a authenticated', () => {
    expect(sql054).not.toMatch(/GRANT (INSERT|UPDATE|DELETE) ON public\.conciliacion_alerta30h_config/);
  });

  test('index.html registra el script nuevo con defer y cache-busting propio', () => {
    expect(indexHtml).toMatch(/<script src="js\/conci-alerta-30h\.js\?v=[^"]+" defer><\/script>/);
  });

  test('los botones/controles nuevos de la alerta empiezan ocultos en el HTML (la BD protege, la UI no decide)', () => {
    const m = indexHtml.match(/<div class="form-check form-switch d-none[^"]*" id="conci-alerta30h-toggle-wrap"[\s\S]{0,20}/);
    expect(m).toBeTruthy();
  });
});
