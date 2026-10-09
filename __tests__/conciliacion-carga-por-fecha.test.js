/**
 * @jest-environment node
 *
 * Carga de Conciliación Manifiestos al cambiar la fecha.
 *
 *  · Cada cambio de fecha consulta una sola vez: index.html y script.js
 *    escuchaban los dos el mismo campo y cada cambio cargaba dos veces.
 *  · Mientras llega la fecha nueva, lo que queda en pantalla es de la anterior:
 *    se marca como "cargando" y el badge no presenta el conteo anterior.
 *  · Si la carga falla, no se dejan las filas ni los contadores de otro día
 *    junto al error; el aviso es distinto de "No se encontraron registros".
 *  · Con una fecha fin anterior a la de inicio se pedía a los vuelos una
 *    ventana vacía y faltaban todas las filas del itinerario.
 *  · Sin fecha de inicio, el campo dice qué día se está mostrando.
 *
 * El doble de Supabase aplica gte/lte/or como PostgREST y registra lo pedido.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let siguienteId = 1000;
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
function manifiesto(iso, vuelo, hhmm) {
  return {
    id: siguienteId++, MES: String(Number(iso.slice(5, 7))), FECHA: ddmm(iso), 'TIPO DE MANIFIESTO': 'LLEGADA',
    AEROLINEA: vuelo.split(' ')[0], '# DE VUELO': vuelo, 'DESTINO / ORIGEN': 'MTY-NLU', RUTA: 'MTY-NLU',
    'SLOT ASIGNADO': `${ddmm(iso)} ${hhmm}`, 'HR. DE OPERACIÓN': '', 'HR. DE RECEPCIÓN': '06/10/2026 10:00', 'CAPTURÓ': 'Ana',
    _portal_flight_date: iso, movement_key: null,
  };
}
function vueloItinerario(iso, vuelo, hhmm) {
  return {
    id: siguienteId++, Status: 'Billing validated', Routing: 'MTY-NLU', 'Aircraft type': '320', Registration: 'XAVBM',
    '[Arr] Airline code': vuelo.split(' ')[0], '[Arr] Flight Designator': vuelo,
    '[Arr] SIBT': `${iso.slice(8, 10)}OCT ${hhmm}`, '[Arr] AIBT': `${iso.slice(8, 10)}OCT ${hhmm}`,
    '[Arr] Service Type': 'J', arr_scheduled_date: iso,
  };
}

const MANIFIESTOS = [
  manifiesto('2026-10-04', 'AM 401', '08:00'),
  manifiesto('2026-10-05', 'AM 501', '09:00'),
  manifiesto('2026-10-06', 'AM 601', '10:00'),
];
const VUELOS = [
  vueloItinerario('2026-10-04', 'VB 4000', '07:00'),
  vueloItinerario('2026-10-05', 'VB 5000', '07:00'),
  vueloItinerario('2026-10-06', 'VB 6000', '07:00'),
];

const servidor = { latenciaMs: 0, fallar: 0, consultas: [] };
function consulta(nombre) {
  const filtros = [];
  const descripcion = [];
  let yo = null;
  let sonda = false; // la consulta de una fila con que se leen las columnas
  const q = {
    select: () => yo,
    eq(c, v) { filtros.push((r) => String(r[c]) === String(v)); return yo; },
    gte(c, v) { descripcion.push(`${c}>=${v}`); filtros.push((r) => r[c] != null && String(r[c]) >= String(v)); return yo; },
    lte(c, v) { descripcion.push(`${c}<=${v}`); filtros.push((r) => r[c] != null && String(r[c]) <= String(v)); return yo; },
    or(expr) {
      descripcion.push(`or(${expr})`);
      const grupos = [...String(expr).matchAll(/and\(([^)]*)\)/g)].map((m) => m[1].split(',').map((p) => p.split('.')));
      filtros.push((r) => grupos.some((g) => g.every(([c, op, v]) => r[c] != null
        && (op === 'gte' ? String(r[c]) >= v : op === 'lte' ? String(r[c]) <= v : String(r[c]) === v))));
      return yo;
    },
    limit() { sonda = true; return yo; },
    then(resolver, rechazar) {
      const datos = nombre === 'Conciliación Manifiestos' ? MANIFIESTOS
        : nombre === 'manifiestos_vuelos_editable' ? VUELOS : [];
      const responder = () => {
        if (datos.length) servidor.consultas.push(`${nombre} ${descripcion.join(' ')}`.trim());
        if (servidor.fallar > 0 && nombre === 'Conciliación Manifiestos' && !sonda) {
          servidor.fallar--;
          return { data: null, error: { message: 'sin red (simulado)' } };
        }
        return { data: datos.filter((r) => filtros.every((f) => f(r))).map((f) => ({ ...f })), error: null };
      };
      return new Promise((r) => setTimeout(r, servidor.latenciaMs)).then(responder).then(resolver, rechazar);
    },
  };
  yo = new Proxy(q, { get: (t, p) => (p in t ? t[p] : () => yo) });
  return yo;
}

let win;
let doc;
let errores;

beforeAll(() => {
  errores = [];
  const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  win = dom.window;
  doc = win.document;
  win.addEventListener('error', (e) => errores.push((e.error && e.error.stack) || e.message));

  const noop = () => {};
  const doble = new Proxy(function () {}, { get: () => doble, apply: () => doble, construct: () => doble });
  const cliente = { from: consulta, rpc: () => consulta('rpc'), channel: () => doble, removeChannel: noop, auth: doble, storage: doble };
  Object.assign(win, {
    supabase: { createClient: () => cliente },
    bootstrap: { Modal: doble, Tooltip: doble, Tab: doble, Dropdown: doble, Offcanvas: doble, Collapse: doble, Popover: doble, Toast: doble },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
    Chart: doble, XLSX: doble, $: doble, jQuery: doble, Swal: doble, moment: doble,
    matchMedia: () => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    scrollTo: noop,
    open: () => null,
  });
  win.HTMLCanvasElement.prototype.getContext = () => doble;
  win.HTMLElement.prototype.scrollIntoView = noop;
  win.console.log = noop;
  win.console.warn = noop;
  win.console.error = noop;

  win.eval(fs.readFileSync(path.join(raiz, 'script.js'), 'utf8'));
  win.supabaseClient = cliente;
  win._conciInitCamposFecha(doc);
  // El oyente de las fechas lo pone el arranque de script.js (DOMContentLoaded).
}, 60000);

afterAll(() => { if (win) win.close(); });

const iso = (id) => doc.getElementById(id);
const campo = (id) => doc.querySelector(`input[data-conci-fecha-para="${id}"]`);
const filas = () => [...doc.querySelectorAll('#table-conci-manifiestos tbody tr[data-row-index]')];
const vuelos = () => filas().map((tr) => tr.querySelector('td[data-col="# DE VUELO"]').dataset.raw).sort();
const badge = () => doc.getElementById('badge-conci-manifiestos-count').textContent;
const cargando = () => doc.getElementById('conci-manifiestos-tabla-view').classList.contains('conci-cargando');

async function terminar() {
  for (let i = 0; i < 300; i++) {
    await esperar(20);
    if (!cargando() && doc.getElementById('conci-manifiestos-loading').classList.contains('d-none')) break;
  }
  await esperar(120);
}

async function elegir(id, texto) {
  const c = campo(id);
  c.value = texto;
  c.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

beforeEach(() => {
  servidor.latenciaMs = 0;
  servidor.fallar = 0;
  servidor.consultas.length = 0;
});
afterEach(() => { expect(errores).toEqual([]); });

describe('cambio de fecha', () => {
  test('la página escucha el cambio de fecha en un solo lugar', () => {
    const fuentes = [fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), fs.readFileSync(path.join(raiz, 'script.js'), 'utf8')];
    const oyentes = fuentes.join('\n').match(/\[\s*'filter-conci-fecha-desde'\s*,\s*'filter-conci-fecha-hasta'\s*\]\.forEach[\s\S]{0,260}?addEventListener\(\s*'change'/g) || [];
    expect(oyentes).toHaveLength(1);
  });

  test('una consulta de vuelos y una de manifiestos por cambio', async () => {
    await elegir('filter-conci-fecha-desde', '05/10/2026');
    await terminar();
    const vuelosQ = servidor.consultas.filter((c) => c.startsWith('manifiestos_vuelos_editable'));
    const manifQ = servidor.consultas.filter((c) => c.startsWith('Conciliación Manifiestos _portal'));
    expect(vuelosQ).toHaveLength(1);
    expect(manifQ).toHaveLength(1);
    expect(vuelos()).toEqual(['AM 501', 'VB 4000', 'VB 5000']);
  }, 30000);

  test('mientras carga, la tabla anterior se marca y el badge no muestra su conteo', async () => {
    await elegir('filter-conci-fecha-desde', '05/10/2026');
    await terminar();
    servidor.latenciaMs = 400;
    await elegir('filter-conci-fecha-desde', '06/10/2026');
    await esperar(150);
    expect(cargando()).toBe(true);
    expect(doc.getElementById('table-conci-manifiestos').getAttribute('aria-busy')).toBe('true');
    expect(badge()).toBe('Cargando…');
    expect(doc.querySelector('#conci-manifiestos-loading p').textContent).toBe('Cargando manifiestos del 06/10/2026…');
    await terminar();
    expect(cargando()).toBe(false);
    expect(doc.getElementById('table-conci-manifiestos').hasAttribute('aria-busy')).toBe(false);
    expect(vuelos()).toEqual(['AM 601', 'VB 5000', 'VB 6000']);
  }, 30000);

  test('si falla la carga de otro día, no quedan las filas ni los contadores anteriores', async () => {
    await elegir('filter-conci-fecha-desde', '05/10/2026');
    await terminar();
    expect(filas()).toHaveLength(3);
    servidor.fallar = 2;
    await elegir('filter-conci-fecha-desde', '04/10/2026');
    await terminar();
    expect(filas()).toHaveLength(0);
    const aviso = doc.querySelector('#table-conci-manifiestos tbody tr.conci-load-error-row');
    expect(aviso.textContent).toContain('No se pudieron cargar los manifiestos del 04/10/2026.');
    expect(aviso.querySelector('button').textContent).toBe('Reintentar');
    expect(badge()).toBe('Error al cargar');
    expect(doc.getElementById('conci-count-capturados').textContent).toBe('0');
    expect(doc.getElementById('conci-manifiestos-error').classList.contains('d-none')).toBe(false);

    aviso.querySelector('button').click();
    await terminar();
    expect(vuelos()).toEqual(['AM 401', 'VB 4000']);
    expect(doc.getElementById('conci-manifiestos-error').classList.contains('d-none')).toBe(true);
  }, 30000);

  test('si falla un Actualizar del mismo día, se conservan las filas y se avisa', async () => {
    await elegir('filter-conci-fecha-desde', '05/10/2026');
    await terminar();
    servidor.fallar = 2;
    doc.getElementById('btn-conci-refresh').disabled = false;
    await win.loadConciliacionManifiestos({ forceRefresh: true });
    await terminar();
    expect(vuelos()).toEqual(['AM 501', 'VB 4000', 'VB 5000']);
    expect(badge()).toBe('3 registros · Sin actualizar');
  }, 30000);

  test('fecha fin anterior a la de inicio: se marca y no se pierden los vuelos del itinerario', async () => {
    await elegir('filter-conci-fecha-desde', '05/10/2026');
    await terminar();
    servidor.consultas.length = 0;
    await elegir('filter-conci-fecha-hasta', '01/10/2026');
    await terminar();
    expect(campo('filter-conci-fecha-hasta').classList.contains('is-invalid')).toBe(true);
    expect(servidor.consultas.find((c) => c.startsWith('manifiestos_vuelos_editable')))
      .toContain('arr_scheduled_date.gte.2026-10-04,arr_scheduled_date.lte.2026-10-06');
    expect(vuelos()).toEqual(['AM 501', 'VB 4000', 'VB 5000']);
    await elegir('filter-conci-fecha-hasta', '');
    campo('filter-conci-fecha-hasta').dispatchEvent(new win.Event('blur'));
    await terminar();
    expect(campo('filter-conci-fecha-hasta').classList.contains('is-invalid')).toBe(false);
  }, 30000);

  test('sin fecha de inicio el campo vuelve al día que se muestra', async () => {
    await elegir('filter-conci-fecha-desde', '06/10/2026');
    await terminar();
    await elegir('filter-conci-fecha-desde', '');
    campo('filter-conci-fecha-desde').dispatchEvent(new win.Event('blur'));
    await terminar();
    expect(iso('filter-conci-fecha-desde').value).toBe('2026-10-06');
    expect(campo('filter-conci-fecha-desde').value).toBe('06/10/2026');
    expect(vuelos()).toEqual(['AM 601', 'VB 5000', 'VB 6000']);
  }, 30000);
});

describe('teclear la fecha dígito por dígito', () => {
  async function teclear(id, digitos) {
    const c = campo(id);
    c.focus();
    c.value = '';
    for (const d of digitos) {
      c.value += d;
      c.dispatchEvent(new win.Event('input', { bubbles: true }));
    }
  }

  test('"05102026" lleva al 05/10/2026 sin pasar por el 2020', async () => {
    await elegir('filter-conci-fecha-desde', '06/10/2026');
    await terminar();
    servidor.consultas.length = 0;
    await teclear('filter-conci-fecha-desde', '05102026');
    expect(campo('filter-conci-fecha-desde').value).toBe('05/10/2026');
    expect(iso('filter-conci-fecha-desde').value).toBe('2026-10-05');
    await terminar();
    expect(servidor.consultas.some((c) => c.includes('2020-'))).toBe(false);
    expect(vuelos()).toEqual(['AM 501', 'VB 4000', 'VB 5000']);
  }, 30000);

  test('"041026" (año de 2 dígitos) se aplica tras una pausa, sin Enter', async () => {
    await teclear('filter-conci-fecha-desde', '041026');
    expect(campo('filter-conci-fecha-desde').value).toBe('04/10/26');
    expect(iso('filter-conci-fecha-desde').value).toBe('2026-10-05');
    await esperar(1000);
    expect(campo('filter-conci-fecha-desde').value).toBe('04/10/2026');
    expect(iso('filter-conci-fecha-desde').value).toBe('2026-10-04');
    await terminar();
    expect(vuelos()).toEqual(['AM 401', 'VB 4000']);
  }, 30000);
});
