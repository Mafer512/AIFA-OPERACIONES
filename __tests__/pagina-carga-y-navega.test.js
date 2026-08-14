/**
 * @jest-environment node
 *
 * Prueba de humo de la página entera.
 *
 * Carga index.html de verdad con sus 84 archivos de JavaScript, la arranca, y
 * después recorre TODAS las entradas del menú comprobando que cada una abre su
 * sección y la sub-pestaña que pide.
 *
 * Cubre dos cosas que ninguna prueba unitaria puede cubrir:
 *
 *   · que ningún archivo reviente al cargar ni al arrancar la página —un error
 *     en cualquiera de ellos deja la aplicación a medias sin avisar—;
 *
 *   · el bug reportado de navegación: al entrar a Resumen General reaparecía
 *     Comparativa Histórica, porque se restauraba la última pestaña usada antes
 *     de hacer caso al clic. Aquí se reproduce el camino exacto.
 *
 * Las librerías que vienen de CDN se sustituyen por dobles, porque jsdom no
 * descarga nada de la red. bootstrap.Tab sí se implementa de verdad: sin él no
 * habría forma de comprobar qué pestaña queda abierta.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let win;
let errores;
let avisos;

beforeAll(async () => {
  errores = [];
  avisos = [];

  const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  win = dom.window;

  win.addEventListener('error', (e) => errores.push('window.onerror: ' + ((e.error && e.error.stack) || e.message)));
  win.onunhandledrejection = (e) => errores.push('promesa sin capturar: ' + e.reason);

  const noop = () => {};
  const doble = new Proxy(function () {}, {
    get: () => doble,
    apply: () => doble,
    construct: () => doble,
  });

  // bootstrap.Tab de verdad: mueve las clases 'active' como lo hace bootstrap.
  const Tab = {
    getOrCreateInstance(el) {
      return {
        show() {
          const destino = el.getAttribute('data-bs-target') || el.getAttribute('href');
          const pane = destino && win.document.querySelector(destino);
          const grupo = el.closest('.nav, .nav-tabs, .nav-pills') || win.document;
          grupo.querySelectorAll('[data-bs-toggle="tab"], [data-bs-toggle="pill"]').forEach((b) => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          el.classList.add('active');
          el.setAttribute('aria-selected', 'true');
          if (pane && pane.parentElement) {
            pane.parentElement.querySelectorAll(':scope > .tab-pane')
              .forEach((p) => p.classList.remove('active', 'show'));
            pane.classList.add('active', 'show');
          }
          el.dispatchEvent(new win.Event('shown.bs.tab', { bubbles: true }));
        },
      };
    },
  };

  win.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve({}),
  });

  const consulta = new Proxy({}, {
    get: (t, p) => (p === 'then'
      ? (res) => Promise.resolve({ data: [], error: null }).then(res)
      : () => consulta),
  });
  const cliente = {
    from: () => consulta,
    rpc: () => consulta,
    channel: () => ({
      on() { return this; },
      subscribe() { return this; },
      send: () => Promise.resolve(),
      track: () => Promise.resolve(),
      untrack: () => Promise.resolve(),
      presenceState: () => ({}),
      unsubscribe: () => Promise.resolve(),
    }),
    removeChannel: noop,
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }),
      signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: {}, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
        list: () => Promise.resolve({ data: [], error: null }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  };

  Object.assign(win, {
    supabase: { createClient: () => cliente },
    bootstrap: { Modal: doble, Tooltip: doble, Tab, Dropdown: doble, Offcanvas: doble, Collapse: doble, Popover: doble, Toast: doble },
    Chart: doble,
    XLSX: {
      read: () => ({ SheetNames: [], Sheets: {} }),
      utils: { sheet_to_json: () => [], json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: noop, aoa_to_sheet: () => ({}), encode_cell: () => 'A1', decode_range: () => ({ s: {}, e: {} }) },
      writeFile: noop,
      write: () => '',
    },
    html2canvas: () => Promise.resolve({ toDataURL: () => '' }),
    jspdf: { jsPDF: doble },
    jsPDF: doble,
    L: doble,
    Tesseract: { createWorker: () => Promise.resolve(doble) },
    pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(doble) }), GlobalWorkerOptions: {} },
    Papa: { parse: () => ({ data: [], errors: [] }), unparse: () => '' },
    QRCode: doble,
    ApexCharts: doble,
    ExcelJS: { Workbook: doble },
    saveAs: noop,
    $: doble,
    jQuery: doble,
    moment: doble,
    Swal: doble,
    Sortable: doble,
    JSZip: doble,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }),
    scrollTo: noop,
    print: noop,
    open: () => null,
  });
  win.HTMLCanvasElement.prototype.getContext = () => doble;
  win.HTMLElement.prototype.scrollIntoView = noop;
  win.console.error = (...a) => errores.push('console.error: ' + a.map(String).join(' '));
  win.console.warn = (...a) => avisos.push(a.map(String).join(' '));
  win.console.log = noop;

  // Los archivos, en el mismo orden en que los pide el HTML.
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const archivos = ['script.js'];
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const ruta = m[1].split('?')[0];
    if (ruta.startsWith('http') || ruta.startsWith('//') || ruta === 'script.js') continue;
    if (fs.existsSync(path.join(raiz, ruta))) archivos.push(ruta);
  }

  for (const f of archivos) {
    try {
      win.eval(fs.readFileSync(path.join(raiz, f), 'utf8'));
    } catch (e) {
      errores.push('AL CARGAR ' + f + ': ' + ((e && e.stack) || e));
    }
  }

  try {
    win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
    win.dispatchEvent(new win.Event('load'));
  } catch (e) {
    errores.push('AL ARRANCAR: ' + ((e && e.stack) || e));
  }

  await esperar(2500);
}, 120000);

const abrir = async (a) => {
  a.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await esperar(90);
};

describe('la página carga entera', () => {
  test('los 84 archivos de JavaScript se cargan y arrancan sin un solo error', () => {
    expect(errores).toEqual([]);
  });

  test('el menú lateral tiene entradas', () => {
    expect(win.document.querySelectorAll('a.menu-item[data-section]').length).toBeGreaterThan(30);
  });
});

describe('cada entrada del menú abre lo que dice', () => {
  test('todas, sin excepción', async () => {
    const fallos = [];
    for (const a of win.document.querySelectorAll('a.menu-item[data-section]')) {
      const seccion = a.dataset.section;
      const subTab = (a.dataset.subTab || '').trim();
      const nombre = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || seccion;

      await abrir(a);

      const sec = win.document.getElementById(seccion)
        || win.document.getElementById(seccion + '-section');
      if (sec && sec.classList.contains('d-none')) {
        fallos.push(`${nombre} [${seccion}]: la sección quedó oculta`);
      }
      if (subTab) {
        const boton = win.document.getElementById(subTab);
        if (!boton) fallos.push(`${nombre}: data-sub-tab="${subTab}" no existe`);
        else if (!boton.classList.contains('active')) {
          fallos.push(`${nombre}: pidió "${subTab}" y no quedó abierta`);
        }
      }
    }
    expect(fallos).toEqual([]);
  }, 120000);
});

describe('el bug de navegación reportado', () => {
  test('venir de Comparativa Histórica no impide entrar a Resumen General', async () => {
    const comparativa = win.document.querySelector('a.menu-item[data-sub-tab="comparativa-yoy-tab"]');
    const resumen = win.document.querySelector('a.menu-item[data-sub-tab="ops-resumen-tab"]');
    expect(comparativa).not.toBeNull();
    expect(resumen).not.toBeNull();

    await abrir(comparativa);
    await esperar(80);
    expect(win.document.getElementById('comparativa-yoy-tab').classList.contains('active')).toBe(true);

    // El clic deliberado manda sobre la pestaña recordada.
    await abrir(resumen);
    await esperar(80);
    expect(win.document.getElementById('ops-resumen-tab').classList.contains('active')).toBe(true);
  }, 30000);

  test('y volver a Comparativa Histórica sigue funcionando', async () => {
    const comparativa = win.document.querySelector('a.menu-item[data-sub-tab="comparativa-yoy-tab"]');
    await abrir(comparativa);
    await esperar(80);
    expect(win.document.getElementById('comparativa-yoy-tab').classList.contains('active')).toBe(true);
  }, 30000);
});

/*
 * Esta prueba NO corre con `npm test`: tarda ~50 s y la aplicación deja
 * temporizadores vivos, así que jest necesita --forceExit para terminar.
 * Se ejecuta aparte:
 *
 *     npm run test:pagina
 */
