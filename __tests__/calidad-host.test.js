/**
 * Calidad (SIGEC) en Edificio Terminal: el menú lo muestra en GOET y lo abre en
 * su propia pestaña. Allí la cuenta es la de AIFA Operaciones (misma sesión de
 * Supabase) y el rol lo da la base.
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
    // Si el navegador bloquea la pestaña, la sección ofrece abrirla con un enlace.
    expect(index).toMatch(/<div id="calidad-section" class="content-section">[\s\S]*?href="calidad\/index.html#\/inicio" target="aifa-calidad"/);
  });

  test('carga el archivo que abre la pestaña; ya no incrusta el módulo', () => {
    expect(index).toContain('<script src="js/calidad-host.js');
    expect(index).not.toContain('<script src="calidad/modulo.js');
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
    // Supabase local (la CSP no permite CDN) y la misma configuración que AIFA Operaciones.
    expect(srcs).toEqual(expect.arrayContaining(['vendor/supabase/supabase.js', '../js/supabase-client.js', 'js/core/conexion.js']));
    expect(srcs.indexOf('../js/supabase-client.js')).toBeGreaterThan(srcs.indexOf('vendor/supabase/supabase.js'));
    const cfg = leer('calidad/js/config.js');
    expect(cfg).toMatch(/modoDemo: false/);
    expect(cfg).toMatch(/sesionDelSistema: true/);
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

// ── El menú abre una pestaña ────────────────────────────────────────────────
function anfitrion({ bloqueada = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <nav><a class="menu-item" href="#" data-section="calidad"><span>Calidad (SIGEC)</span></a>
         <a class="menu-item" href="#" data-section="setp">SETP</a></nav>
    <div id="calidad-section" class="content-section"></div>
  </body></html>`, { url: 'http://localhost/index.html', runScripts: 'outside-only' });
  const w = dom.window;
  const abiertas = [];
  const secciones = [];
  w.open = (url, nombre) => { abiertas.push([url, nombre]); return bloqueada ? null : { focus() {} }; };
  w.showSection = (k) => secciones.push(k);
  // El manejador del menú del sistema (se registra antes, como en script.js).
  w.document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-section]');
    if (a) w.showSection(a.dataset.section);
  });
  w.eval(leer('js/calidad-host.js'));
  const clic = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { w, abiertas, secciones, clic };
}

describe('el enlace del menú', () => {
  test('abre Calidad en su propia pestaña sin cambiar la pantalla del sistema', () => {
    const h = anfitrion();
    h.clic('[data-section="calidad"] span');
    expect(h.abiertas).toEqual([['calidad/index.html#/inicio', 'aifa-calidad']]);
    expect(h.secciones).toEqual([]);
  });

  test('los demás módulos siguen igual', () => {
    const h = anfitrion();
    h.clic('[data-section="setp"]');
    expect(h.abiertas).toEqual([]);
    expect(h.secciones).toEqual(['setp']);
  });

  test('si el navegador bloquea la pestaña, muestra la sección con el botón para abrirla', () => {
    const h = anfitrion({ bloqueada: true });
    h.clic('[data-section="calidad"]');
    expect(h.secciones).toEqual(['calidad']);
  });
});

// ── En la pestaña de Calidad: la sesión sale de AIFA Operaciones ────────────
function pestana({ user = { id: 'u1', email: 'ana.ruiz@aifa.operaciones', user_metadata: { full_name: 'Ana Ruiz Gómez' } }, rol = 'capturista', rpcError = null } = {}) {
  const w = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/calidad/index.html', runScripts: 'outside-only' }).window;
  const eventos = [];
  const destinos = [];
  const cliente = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
      onAuthStateChange: (fn) => { eventos.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
    },
    rpc: async () => (rpcError ? { data: null, error: rpcError } : { data: rol, error: null }),
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { full_name: 'Ana del Perfil' }, error: null }) }),
  };
  w.SIGEC_CONFIG = { sesionDelSistema: true, supabase: () => cliente };
  w.SIGEC_ENV = { embed: false, goLogin: (r) => destinos.push(r) };
  w.eval(leer('calidad/js/sigec.js'));
  w.eval(leer('calidad/js/core/conexion.js'));
  const sesion = () => JSON.parse(w.sessionStorage.getItem('sigec.session') || 'null');
  return { w, conexion: w.SIGEC.use('core/conexion'), sesion, eventos, destinos };
}

describe('la pestaña de Calidad toma la sesión de AIFA Operaciones', () => {
  test('misma cuenta, sin pedir contraseña, con el rol que da la base', async () => {
    const p = pestana();
    expect(await p.conexion.conectar()).toEqual({ estado: 'ok' });
    expect(p.sesion().user).toMatchObject({ username: 'ana.ruiz@aifa.operaciones', name: 'Ana Ruiz Gómez', role: 'capturista' });
  });

  test('sin nombre en la cuenta, lo toma de su perfil', async () => {
    const p = pestana({ user: { id: 'u1', email: 'ana.ruiz@aifa.operaciones', user_metadata: {} } });
    await p.conexion.conectar();
    expect(p.sesion().user.name).toBe('Ana del Perfil');
  });

  test('sin sesión en el sistema, o sin el módulo, no entra', async () => {
    expect(await pestana({ user: null }).conexion.conectar()).toEqual({ estado: 'sin-sesion' });
    const p = pestana({ rol: null });
    expect(await p.conexion.conectar()).toEqual({ estado: 'sin-acceso' });
    expect(p.sesion()).toBeNull();
    expect((await pestana({ rpcError: { code: 'PGRST202' } }).conexion.conectar()).estado).toBe('error');
  });

  test('al cerrar sesión en AIFA Operaciones (en otra pestaña), Calidad se cierra', async () => {
    const p = pestana();
    await p.conexion.conectar();
    p.eventos.forEach((fn) => fn('SIGNED_OUT'));
    expect(p.sesion()).toBeNull();
    expect(p.destinos).toEqual(['']);
  });
});
