/**
 * Calidad (SIGEC) en Edificio Terminal: el menú lo muestra en GOET, la sección
 * monta calidad/ en un iframe con la cuenta conectada y el rol que da la base,
 * y la sesión del módulo vive y muere con la de AIFA Operaciones.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

describe('piezas en su lugar', () => {
  const index = leer('index.html');

  test('el enlace está en Ops. Ed. Terminal (GOET), después de SETP', () => {
    const goet = index.slice(index.indexOf('id="sg-goet"'), index.indexOf('<!-- GSO -->'));
    expect(goet).toContain('data-section="calidad"');
    expect(goet.indexOf('data-section="calidad"')).toBeGreaterThan(goet.indexOf('data-section="setp"'));
    expect(index).toMatch(/<div id="calidad-section" class="content-section">[\s\S]*?<div id="vista-calidad" class="vista-calidad"><\/div>/);
  });

  test('carga el cargador del módulo antes del archivo que lo monta', () => {
    const a = index.indexOf('<script src="calidad/modulo.js');
    const b = index.indexOf('<script src="js/calidad-host.js');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  test('es un módulo que se asigna en Administración de usuarios (GOET dentro de SSO)', () => {
    const script = leer('script.js');
    expect(script).toMatch(/\{ key: 'calidad',\s+label: 'Calidad \(SIGEC\)'/);
    expect(script).toContain("'bhs', 'setp', 'calidad',");
  });

  test('se publica la carpeta, sin lo que sólo sirve para desarrollarla', () => {
    const vi = leer('.vercelignore');
    expect(vi).toContain('!/calidad/**');
    ['/calidad/server.js', '/calidad/package.json', '/calidad/paquete/'].forEach((r) => expect(vi).toContain(r));
  });

  test('la página del módulo usa la base, no datos ilustrativos', () => {
    const html = leer('calidad/index.html');
    expect(html).not.toContain('mock.js');
    expect(html.indexOf('js/data/fuente.js')).toBeGreaterThan(0);
    expect(html.indexOf('js/data/fuente.js')).toBeLessThan(html.indexOf('js/data/api.js'));
    expect(html).toContain("img-src 'self' data: blob: https://*.supabase.co");
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    srcs.forEach((s) => expect(fs.existsSync(path.join(raiz, 'calidad', s))).toBe(true));
    const cfg = leer('calidad/js/config.js');
    expect(cfg).toMatch(/modoDemo: false/);
    expect(cfg).toMatch(/soloIncrustado: true/);
    expect(cfg).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}/);   // ninguna llave en el archivo público
    expect(fs.existsSync(path.join(raiz, 'calidad/js/data/mock.js'))).toBe(false);
  });

  test('el SQL protege cada tabla y no deja cambiar el estado sin la función', () => {
    const sql = leer('db/calidad_sigec.sql');
    ['calidad_incidencias', 'calidad_incidencia_seguimiento', 'calidad_folios', 'calidad_encuestas_pasajeros', 'calidad_encuestas_aerolineas', 'calidad_documentos', 'calidad_directorio']
      .forEach((t) => expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`)));
    expect(sql).not.toMatch(/CREATE POLICY "calidad_inc_update"/);
    expect(sql).toMatch(/user_section_level\('calidad'\)/);
    expect(sql).toMatch(/'calidad-evidencias', 'calidad-evidencias', false/);
    expect(sql).toMatch(/'calidad-documentos', 'calidad-documentos', false/);
  });
});

// ── El montaje ──────────────────────────────────────────────────────────────
function anfitrion({ rol = 'capturista', rpcFalla = false, nivel = 'read' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div id="calidad-section" class="content-section"><div id="vista-calidad" class="vista-calidad"></div></div>
  </body></html>`, { url: 'http://localhost/index.html', runScripts: 'outside-only' });
  const w = dom.window;
  const intervalos = [];
  const esperas = [];
  w.setInterval = (fn) => { intervalos.push(fn); return intervalos.length; };
  w.clearInterval = () => {};
  w.setTimeout = (fn) => { esperas.push(fn); return esperas.length; };
  w.sessionStorage.setItem('currentUser', 'ana.ruiz@aifa.operaciones');
  w.sessionStorage.setItem('user_fullname', 'Ana Ruiz Gómez');
  w.sessionStorage.setItem('user_role', 'viewer');
  w.sessionStorage.setItem('user_area', 'GOET');
  const llamadas = [];
  w.supabaseClient = {
    rpc: async (nombre) => {
      llamadas.push(nombre);
      return rpcFalla ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: rol, error: null };
    },
  };
  w.sectionLevel = () => nivel;
  Object.defineProperty(w.document, 'currentScript', { configurable: true, get: () => ({ src: 'http://localhost/calidad/modulo.js?v=20261123' }) });
  w.eval(leer('calidad/modulo.js'));
  w.eval(leer('js/calidad-host.js'));
  const activar = async () => {
    w.document.getElementById('calidad-section').classList.add('active');
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const sesion = () => JSON.parse(w.sessionStorage.getItem('sigec.session') || 'null');
  const iframe = () => w.document.querySelector('#vista-calidad iframe');
  return { w, activar, sesion, iframe, intervalos, esperas, llamadas };
}

describe('al abrir la sección', () => {
  test('monta el módulo con la cuenta conectada y el rol que da la base', async () => {
    const h = anfitrion({ rol: 'capturista' });
    expect(h.iframe()).toBeNull();                    // nada hasta abrir la sección
    await h.activar();
    expect(h.llamadas).toEqual(['calidad_mi_rol']);
    expect(h.iframe().src).toBe('http://localhost/calidad/index.html?embed=1#/inicio');
    expect(h.sesion().user).toEqual({ username: 'ana.ruiz@aifa.operaciones', name: 'Ana Ruiz Gómez', role: 'capturista', area: 'GOET' });
  });

  test('al recargar en #calidad espera a que se restaure la sesión', async () => {
    const h = anfitrion();
    h.w.sessionStorage.removeItem('currentUser');
    await h.activar();
    expect(h.iframe()).toBeNull();
    expect(h.esperas).toHaveLength(1);
    h.w.sessionStorage.setItem('currentUser', 'ana.ruiz@aifa.operaciones');
    h.esperas.shift()();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.iframe()).not.toBeNull();
  });

  test('volver a la sección no recarga el módulo', async () => {
    const h = anfitrion();
    await h.activar();
    const primero = h.iframe();
    h.w.document.getElementById('calidad-section').classList.remove('active');
    await h.activar();
    expect(h.iframe()).toBe(primero);
  });

  test('sin acceso en la base, un aviso en lugar del módulo', async () => {
    const h = anfitrion({ rol: null });
    await h.activar();
    expect(h.iframe()).toBeNull();
    expect(h.w.document.querySelector('.vista-calidad__aviso').textContent).toContain('Sin acceso a Calidad');
    expect(h.sesion()).toBeNull();
  });

  test('sin la función en la base (falta el SQL), usa el nivel del menú', async () => {
    const h = anfitrion({ rpcFalla: true, nivel: 'edit' });
    await h.activar();
    expect(h.sesion().user.role).toBe('supervisor');
    expect(h.iframe()).not.toBeNull();
  });
});

describe('la sesión del módulo sigue a la de AIFA Operaciones', () => {
  test('mientras siga abierta, la renueva', async () => {
    const h = anfitrion();
    await h.activar();
    const s = h.sesion();
    s.lastActivity = 1;
    h.w.sessionStorage.setItem('sigec.session', JSON.stringify(s));
    h.intervalos.forEach((fn) => fn());
    expect(h.sesion().lastActivity).toBeGreaterThan(1);
  });

  test('al cerrar sesión en AIFA Operaciones, Calidad se cierra con ella', async () => {
    const h = anfitrion();
    await h.activar();
    h.w.sessionStorage.removeItem('currentUser');     // lo que hace performLogout
    h.intervalos.forEach((fn) => fn());
    expect(h.iframe()).toBeNull();
    expect(h.sesion()).toBeNull();
  });

  test('si el módulo se queda sin sesión, se le vuelve a entregar sin recargar todo el sistema', async () => {
    const h = anfitrion();
    await h.activar();
    h.w.sessionStorage.removeItem('sigec.session');
    expect(typeof h.iframe().sigecAlSalir).toBe('function');
    h.iframe().sigecAlSalir('inactividad');
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.sesion().user.username).toBe('ana.ruiz@aifa.operaciones');
    expect(h.iframe()).not.toBeNull();
  });
});
