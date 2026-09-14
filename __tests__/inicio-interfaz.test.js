/**
 * @jest-environment jsdom
 *
 * Pantalla de inicio (modo tablero) con la interfaz nueva: encabezado de un
 * renglón con botón de usuario (nombre, rol, dirección y correo) que despliega
 * las opciones de la sesión, y el banner con la vista "Actual", la bienvenida,
 * la tarjeta del periodo y la fecha.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
const script = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
const fuenteUsuario = fs.readFileSync(path.join(raiz, 'js', 'inicio-usuario.js'), 'utf8');
const encabezado = html.slice(html.indexOf('<header class="header'), html.indexOf('</header>') + '</header>'.length);
const $ = (id) => document.getElementById(id);
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('el encabezado de inicio', () => {
  test('el botón de usuario va entre el título y el emblema, con icono, nombre, rol, dirección y correo', () => {
    const titulo = encabezado.indexOf('class="main-title"');
    const usuario = encabezado.indexOf('id="hdr-user-btn"');
    const emblema = encabezado.indexOf('emblema-aviacion.png');
    expect(titulo).toBeGreaterThan(-1);
    expect(usuario).toBeGreaterThan(titulo);
    expect(emblema).toBeGreaterThan(usuario);
    ['hdr-user-nombre', 'hdr-user-rol', 'hdr-user-area', 'hdr-user-correo'].forEach((id) => {
      expect(encabezado).toContain(`id="${id}"`);
    });
    expect(encabezado).toMatch(/class="hdr-user-icono"[^>]*>\s*<i class="fas fa-user"/);
  });

  test('el menú trae las opciones de siempre, en su orden, y Cerrar Sesión', () => {
    const ids = ['cambiar-password-menu', 'historia-admin-menu', 'miscelanea-menu', 'data-management-menu', 'admin-users-menu'];
    const posiciones = ids.map((id) => encabezado.indexOf(`id="${id}"`));
    posiciones.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect(encabezado).toMatch(/id="hdr-user-menu"[\s\S]*data-action="logout"/);
    // Se movieron, no se copiaron.
    expect(html.match(/id="si-user-dropdown"/g)).toHaveLength(1);
  });

  test('la página carga el script del botón', () => {
    expect(html).toMatch(/<script src="js\/inicio-usuario\.js\?v=[^"]+" defer><\/script>/);
  });

  test('en el tablero el encabezado es de un renglón y la tarjeta vieja de usuario se oculta', () => {
    expect(css).toMatch(/body\.navdeck-mode:not\(\.conci-estadistica-workspace\) \.header-center-content \.header-subtext \{\s*display: none;/);
    expect(css).toMatch(/body\.navdeck-mode \.sidebar\.nav-deck > \.si-user-card,\s*body\.navdeck-mode \.sidebar\.nav-deck > \.si-link--logout \{\s*display: none !important;/);
    // En Estadística el encabezado compacto sigue como estaba.
    expect(css).toMatch(/body\.conci-estadistica-workspace \.hdr-user \{\s*display: none !important;/);
    // En tema claro las cifras de las tarjetas van en oscuro (la regla vieja las ponía blancas).
    expect(css).toMatch(/body\.navdeck-mode:not\(\.dark-mode\) \.ndw-card-value \{\s*color: #0f172a !important;/);
  });
});

describe('el botón de usuario', () => {
  beforeAll(() => {
    document.body.innerHTML = `<div id="si-user-name">David Escudero</div>
      <div id="si-user-email">david.escudero@aifa.operaciones</div>
      <div id="current-user"></div>${encabezado}`;
    window.sessionStorage.setItem('user_role', 'superadmin');
    window.sessionStorage.setItem('user_area', 'DO');
    window.AG_AREA = { DO: { name: 'Dirección de Operación', border: '#16a34a' } };
    window.eval(fuenteUsuario);
  });

  test('pinta el nombre, el rol, la dirección, el correo y la inicial', () => {
    expect($('hdr-user-nombre').textContent).toBe('David Escudero');
    expect($('hdr-user-rol').textContent).toBe('Superadmin');
    expect($('hdr-user-area').hidden).toBe(false);
    expect($('hdr-user-area-texto').textContent).toBe('Dirección de Operación');
    expect($('hdr-user-correo').textContent).toBe('david.escudero@aifa.operaciones');
    expect($('hdr-user-avatar').textContent).toBe('D');
    expect($('hdr-user-menu-nombre').textContent).toBe('David Escudero');
    expect($('hdr-user-menu-correo').textContent).toBe('david.escudero@aifa.operaciones');
    expect($('hdr-user-btn').getAttribute('aria-label')).toContain('Superadmin');
  });

  test('abre y cierra con el botón, con Escape, con un clic fuera y al elegir una opción', () => {
    const boton = $('hdr-user-btn');
    const menu = $('hdr-user-menu');
    expect(menu.hidden).toBe(true);
    boton.click();
    expect(menu.hidden).toBe(false);
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.hidden).toBe(true);
    boton.click();
    document.body.click();
    expect(menu.hidden).toBe(true);
    // Una navegación anterior dejó la lista con d-none: al abrir se vuelve a ver.
    $('si-user-dropdown').classList.add('d-none');
    boton.click();
    expect($('si-user-dropdown').classList.contains('d-none')).toBe(false);
    $('miscelanea-menu').click();
    expect(menu.hidden).toBe(true);
  });

  test('mientras el menú está abierto, el encabezado sube por encima de la franja de agenda', () => {
    const cabecera = document.querySelector('header.header');
    $('hdr-user-btn').click();
    expect(cabecera.classList.contains('hdr-menu-abierto')).toBe(true);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cabecera.classList.contains('hdr-menu-abierto')).toBe(false);
    expect(css).toMatch(/\.header\.hdr-menu-abierto \{\s*z-index: 1320;/);
  });

  test('cuando la sesión cambia, se vuelve a pintar', async () => {
    $('si-user-name').textContent = 'Ana López';
    await esperar();
    expect($('hdr-user-nombre').textContent).toBe('Ana López');
    expect($('hdr-user-avatar').textContent).toBe('A');
  });
});

describe('el banner de inicio', () => {
  const extraer = (inicio, fin) => {
    const i = script.indexOf(inicio);
    const j = script.indexOf(fin, i);
    if (i === -1 || j === -1) throw new Error(`No se encontró ${inicio} en script.js`);
    return script.slice(i, j + fin.length);
  };

  function montarBanner() {
    document.body.innerHTML = '<div id="navdeck-weekly-banner"></div>';
    document.body.className = 'navdeck-mode';
    const dias = [];
    for (let d = 7; d <= 13; d += 1) {
      dias.push({
        fecha: `2026-09-${String(d).padStart(2, '0')}`,
        comercial: { operaciones: 100 + d, pasajeros: 1000 + d },
        carga: { operaciones: 40, toneladas: 150.5 },
        general: { operaciones: 6, pasajeros: d === 13 ? 43 : 30 }
      });
    }
    const semana = { rango: { inicio: '2026-09-07', fin: '2026-09-13' }, dias };
    const detalle = jest.fn();
    const api = new Function('detalle', 'semana', `
      const WEEKLY_OPERATIONS_DATASETS = [semana];
      const staticData = {};
      function getActiveWeeklyDataset() { return semana; }
      function formatWeekLabel() { return '7 al 13 de septiembre de 2026'; }
      function getWeeklyValue(d, cat, metric) { return Number((d[cat] || {})[metric] || 0); }
      function ndwGetAvailableYears() { return ['2025', '2026']; }
      function ndwGetMonthCutoff() { return 8; }
      function ndwGetPreferredMonthIdx() { return 8; }
      function ndwGetMonthlyVal() { return 0; }
      function ndwGetAnnualVal() { return 0; }
      function parseIsoDay(s) { return new Date(s + 'T12:00:00'); }
      function escapeHTML(s) { return String(s); }
      const openNavdeckWeeklyDetail = detalle;
      function openNavdeckMonthlyDetail() {}
      function openNavdeckAnnualDetail() {}
      ${extraer('const NDW_CARD_DEFS = [', '];\n')}
      ${extraer('function ndwFormatValue(', '\n}\n')}
      ${extraer('let NDW_VIEW_STATE = ', ';\n')}
      ${extraer('function renderNavdeckWeeklyBanner(', '\n}\n')}
      return { render: renderNavdeckWeeklyBanner };
    `)(detalle, semana);
    api.render();
    return { detalle, banner: $('navdeck-weekly-banner') };
  }

  test('la vista Actual va antes de Semanal y el hero trae bienvenida, tarjeta del periodo y fecha', () => {
    const { banner } = montarBanner();
    const modos = [...banner.querySelectorAll('[data-ndw-mode]')].map((b) => b.dataset.ndwMode);
    expect(modos).toEqual(['current', 'weekly', 'monthly', 'annual', 'historic']);
    expect(banner.querySelector('.ndw-hero-welcome').textContent).toBe('Bienvenido al sistema');
    expect(banner.querySelector('.ndw-hero-card .ndw-hero-title').textContent).toBe('7 al 13 de septiembre de 2026');
    expect(banner.querySelector('.ndw-hero-fecha').textContent).toMatch(/\d{1,2} de [a-záéíóú]+ de \d{4}/);
    const tarjetas = banner.querySelectorAll('.ndw-card');
    expect(tarjetas).toHaveLength(6);
    expect(tarjetas[0].getAttribute('style')).toContain('--ndw-img:');
  });

  test('Actual muestra las cifras del día más reciente con datos', () => {
    const { banner, detalle } = montarBanner();
    banner.querySelector('[data-ndw-mode="current"]').click();
    expect(banner.querySelector('.ndw-hero-kicker').textContent).toBe('Cifras del día');
    expect(banner.querySelector('.ndw-hero-title').textContent).toBe('Domingo 13 de septiembre de 2026');
    const valores = [...banner.querySelectorAll('.ndw-card-value')].map((v) => v.textContent);
    expect(valores[0]).toBe('113');
    expect(valores[5]).toBe('43');
    expect(banner.querySelector('.ndw-card-sub').textContent).toBe('Operaciones del día');
    banner.querySelector('.ndw-card').click();
    expect(detalle).toHaveBeenCalledWith(0);
  });
});
