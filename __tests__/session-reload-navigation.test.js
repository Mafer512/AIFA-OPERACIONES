const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

describe('restauracion de sesion y apartado durante reload', () => {
  test('el login inicia oculto mientras se valida la sesion', () => {
    expect(html).toMatch(/id="login-screen"\s+class="login-screen hidden"/);
    expect(html).toMatch(/id="main-app"\s+class="main-app hidden"/);
    expect(html).toContain('id="auth-boot-screen"');
    expect(html).toMatch(/id="global-loader"\s+class="global-loader"/);
    expect(html).toContain('Restaurando sesión...');
  });

  test('checkSession delega en un solo flujo de restauracion', () => {
    const start = script.indexOf('function checkSession()');
    const end = script.indexOf('// PDFs dinámicos', start);
    const block = script.slice(start, end);
    expect(block).toContain('showMainApp()');
    expect(block).not.toContain('verifyToken(token)');
    expect(block).not.toContain('restoreSessionFromSupabase().then');
  });

  test('showMainApp conserva el hash permitido y solo cae a Inicio como respaldo', () => {
    const start = script.indexOf('function showMainApp()');
    const end = script.indexOf('function checkSession()', start);
    const block = script.slice(start, end);
    expect(block).toContain('const requestedSectionKey');
    expect(block).toContain('const requestedAllowed');
    expect(block).toContain('? requestedLink');
    expect(block).toContain('data-section="operaciones-totales"');
    expect(block).toContain('const startLink = requestedAllowed');
    expect(block).not.toContain('if (!_isColabOnly) {');
  });

  test('recuerda la seccion y la pestana interna activas', () => {
    expect(script).toContain("const LAST_SECTION_STORAGE_KEY = 'aifa.navigation.last_section'");
    expect(script).toContain("const LAST_TAB_STORAGE_PREFIX = 'aifa.navigation.last_tab.'");
    expect(script).toContain("document.addEventListener('shown.bs.tab', event => rememberActiveTab(event.target))");
    expect(script).toContain('rememberActiveSection(targetKey)');
    expect(script).toContain('restoreActiveTab(targetKey, target)');
  });

  test('Conciliacion permanece visible para toda sesion autenticada', () => {
    expect(script).toContain("const authenticatedCoreSections = ['conciliacion']");
    expect(script).toContain("!authenticatedCoreSections.includes(item.dataset.section)");
    expect(script).toContain("!authenticatedCoreSections.includes(key)");
    expect(html).toContain('script.js?v=20260812-restaura-navegacion-v2');
    expect(script).toContain("const isAuthenticatedCore = key === 'conciliacion'");
    expect(script).toContain("target.classList.remove('perm-hidden', 'd-none-auth')");
    expect(script).toContain("document.body.classList.add('navdeck-active')");
    expect(script).toContain('restoreSectionFromNavigation(requestedSectionKey)');
  });

  test('reafirma la URL despues de refrescar permisos', () => {
    const start = script.indexOf('async function refreshUserPermissionsFromServer()');
    const end = script.indexOf('// Polling ligero', start);
    expect(script.slice(start, end)).toContain('restoreSectionFromNavigation(routeKey)');
  });

  test('la restauracion tiene limite y nunca deja ambas pantallas ocultas', () => {
    expect(script).toContain('const AUTH_RESTORE_TIMEOUT_MS = 10000');
    expect(script).toContain('withAuthRestoreTimeout(verifyToken(token))');
    expect(script).toContain('withAuthRestoreTimeout(restoreSessionFromSupabase())');
    expect(script).toMatch(/withAuthRestoreTimeout\(\s*window\.supabaseClient\.auth\.getSession\(\)/);
    expect(script).toContain('getOperacionesAccess(sessionData?.session?.user)');
    const start = script.indexOf('function showMainApp()');
    const end = script.indexOf('function checkSession()', start);
    const block = script.slice(start, end);
    expect(block).toContain("login.classList.remove('hidden')");
    expect(block).toContain('hideGlobalLoader()');
    expect(block).toContain('hideAuthBootScreen()');
  });

  test('un rechazo de permisos muestra login antes de cerrar la sesion remota', () => {
    const start = script.indexOf('async function rejectOperacionesAccess()');
    const end = script.indexOf('function cacheSupabaseSession', start);
    const block = script.slice(start, end);
    expect(block.indexOf("login-screen')?.classList.remove('hidden')"))
      .toBeLessThan(block.indexOf("auth?.signOut()?.catch"));
  });

  test('la recuperacion automatica conserva query y hash del apartado', () => {
    expect(html).toContain('location.pathname + location.search + targetHash');
  });
});
