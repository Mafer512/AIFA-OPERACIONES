/**
 * @jest-environment jsdom
 *
 * Pantalla de inicio (modo tablero) con la interfaz nueva: encabezado de un
 * renglón con botón de usuario (nombre, rol, dirección y correo) que despliega
 * las opciones de la sesión; la barra de agenda con la fecha completa al final,
 * y el banner con el selector de vista arriba a la izquierda (Día, Semana, Mes,
 * Año, Histórico total) y la tarjeta del periodo, sin fecha ni leyendas de
 * cifras preliminares, y las tarjetas de cifras con su nombre completo.
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

  test('el menú empieza directo en Cambiar contraseña, sin cabecera de usuario', () => {
    expect(encabezado).not.toContain('hdr-user-menu-cabeza');
    expect(encabezado).not.toContain('hdr-user-avatar');
    const menu = encabezado.slice(encabezado.indexOf('id="hdr-user-menu"'));
    const primero = menu.indexOf('class="menu-item');
    expect(menu.indexOf('id="cambiar-password-menu"')).toBeGreaterThan(primero - 1);
    expect(menu.slice(primero, menu.indexOf('>', primero))).toContain('cambiar-password-menu');
  });

  test('el botón de usuario es blanco y el periodo va sin recuadro, sobre la foto', () => {
    expect(css.match(/\n\.hdr-user-btn \{[^}]*\}/)[0]).toMatch(/background: #fff;/);
    const periodo = css.match(/\n\.ndw-hero-card \{[^}]*\}/)[0];
    expect(periodo).not.toMatch(/background|border|box-shadow/);
    expect(css).toMatch(/body\.navdeck-mode \.ndw-hero-card \.ndw-hero-title \{\s*color: #fff !important;/);
    // El selector de mes y año lleva fondo propio para leerse sobre la foto.
    expect(css).toMatch(/\.ndw-hero-card \.ndw-month-stepper,[\s\S]*?\{\s*background: rgba\(255, 255, 255, \.92\) !important;/);
  });

  test('el botón Inicio va en el encabezado, centrado entre el título y el botón de usuario', () => {
    const titulo = encabezado.indexOf('class="main-title"');
    const inicio = encabezado.indexOf('id="navdeck-back"');
    const usuario = encabezado.indexOf('id="hdr-user"');
    expect(inicio).toBeGreaterThan(titulo);
    expect(usuario).toBeGreaterThan(inicio);
    expect(encabezado).toMatch(/id="navdeck-back"[^>]*aria-label="Volver al inicio"[\s\S]*?fa-house[\s\S]*?>Inicio<\/span>/);
    // Centrado en el hueco: márgenes automáticos a los dos lados, y el botón de
    // usuario sin el suyo (si no, se quedaría con un tercio del hueco).
    const regla = css.match(/body\.navdeck-mode\.navdeck-active \.navdeck-back-btn \{[^}]*\}/)[0];
    expect(regla).toMatch(/margin-inline: auto;/);
    expect(regla).not.toMatch(/position: fixed/);
    expect(css).toMatch(/body\.navdeck-mode\.navdeck-active \.navdeck-back-btn \+ \.hdr-user \{\s*margin-left: 0;/);
    // navigation.js ya no crea un botón flotante: conecta el del encabezado.
    const navegacion = fs.readFileSync(path.join(raiz, 'js', 'navigation.js'), 'utf8');
    expect(navegacion).not.toContain("createElement('button')");
    expect(navegacion).toMatch(/getElementById\('navdeck-back'\)[\s\S]*?addEventListener\('click', showMenu\)/);
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
  });
});

describe('la barra de agenda', () => {
  const barra = html.slice(html.indexOf('<div id="ag-today-bar"'), html.indexOf('<!-- Contenedor de Alertas del Sistema'));
  const inicioScript = html.indexOf('<script>', html.indexOf('BARRA DE AGENDA: Hoy / Mañana  —  siempre visible'));
  const fuenteBarra = html.slice(inicioScript + '<script>'.length, html.indexOf('</script>', inicioScript));

  test('la fecha completa va al final, antes del Mapa Interactivo, sin recuadro', () => {
    const acciones = barra.slice(barra.indexOf('class="ag-tb-actions'));
    const fecha = acciones.indexOf('id="ag-tb-fecha"');
    expect(fecha).toBeGreaterThan(-1);
    expect(fecha).toBeLessThan(acciones.indexOf('id="btn-mapa-interactivo"'));
    const regla = css.match(/\n\.ag-tb-fecha \{[^}]*\}/)[0];
    expect(regla).not.toMatch(/background|border|box-shadow/);
  });

  test('la letra de la barra crece', () => {
    expect(css).toMatch(/\n\.ag-tb-day-label \{\s*padding: 5px 18px;\s*font-size: \.8rem;/);
    expect(css).toMatch(/\n\.ag-tb-date \{\s*font-size: \.95rem;/);
    expect(css).toMatch(/\n\.ag-tb-hint \{\s*gap: 6px;\s*font-size: \.88rem;/);
  });

  test('pinta la fecha de hoy sin esperar a la agenda y cambia sola a medianoche', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-24T23:59:30'));
    try {
      document.body.innerHTML = barra;
      window.eval(fuenteBarra);
      expect($('ag-tb-fecha').textContent).toBe('Jueves, 24 de septiembre de 2026');
      jest.setSystemTime(new Date('2026-09-25T00:00:30'));
      jest.advanceTimersByTime(60000);
      expect($('ag-tb-fecha').textContent).toBe('Viernes, 25 de septiembre de 2026');
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('el banner de inicio', () => {
  const extraer = (inicio, fin) => {
    const i = script.indexOf(inicio);
    const j = script.indexOf(fin, i);
    if (i === -1 || j === -1) throw new Error(`No se encontró ${inicio} en script.js`);
    return script.slice(i, j + fin.length);
  };

  // detalleReal: usa las ventanas de detalle de verdad en lugar del espía.
  // mensual(i): lo que devuelve ndwResolveMonthlyVal para el mes i.
  // detalle: detalle por año (TotalesService.getDetalleDiario) para Día y
  // Semana; por omisión, 2026 con los números de la semana de prueba.
  // totales: totales mensuales de la capa unificada (Mes, Año, Histórico).
  const sinMes = () => ({ value: 0, hasData: false, lastDate: null });
  const LEYENDA = 'Cifras oficiales hasta agosto 2026 · posteriores: conciliación de manifiestos';
  function montarBanner({ modo = 'weekly', anual = 0, detalleReal = false, mensual = sinMes, detalle: detalleAnios, totales } = {}) {
    window._ndwCurrentManifestDays = {
      '2026-09-15': { status: 'ready', count: 3, totals: {
        comercial: { operaciones: 2, pasajeros: 240 }, carga: { operaciones: 1, toneladas: 3.5 }
      } },
      '2026-09-12': { status: 'ready', count: 0, totals: {
        comercial: { operaciones: 0, pasajeros: 0 }, carga: { operaciones: 0, toneladas: 0 }
      } }
    };
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
    window._ndwDetalle = detalleAnios !== undefined ? detalleAnios : {
      2026: { status: 'ready', porFecha: new Map(dias.map((d) => [d.fecha, { comercial: d.comercial, carga: d.carga, general: d.general }])) }
    };
    window._ndwTotales = totales !== undefined ? totales : { status: 'ready', porMes: new Map(), leyenda: LEYENDA };
    const detalle = jest.fn();
    const api = new Function('detalle', 'semana', 'anual', 'mensual', `
      const WEEKLY_OPERATIONS_DATASETS = [semana];
      const staticData = {};
      function ndwLoadCurrentManifestDay() {}
      function getActiveWeeklyDataset() { return semana; }
      function formatWeekLabel() { return '7 al 13 de septiembre de 2026'; }
      function getWeeklyValue(d, cat, metric) { return Number((d[cat] || {})[metric] || 0); }
      function ndwGetAvailableYears() { return ['2025', '2026']; }
      function ndwGetMonthCutoff() { return 8; }
      function ndwGetPreferredMonthIdx() { return 8; }
      function ndwGetMonthlyVal() { return 0; }
      function ndwGetAnnualVal() { return anual; }
      function parseIsoDay(s) { return new Date(s + 'T12:00:00'); }
      function escapeHTML(s) { return String(s); }
      function normalizeOpsDateKey(v) { return v ? String(v).slice(0, 10) : null; }
      function shouldReplaceDailyCandidate(existing) { return !existing; }
      function formatDateLabel(s) { return s; }
      ${detalleReal
        ? `const AVIATION_ANALYTICS_CUTOFF_YEAR = 2026;
           function ndwResolveMonthlyVal(cat, metric, y, i) { return mensual(i); }
           function formatSpanishDate(s) { return s; }
           ${script.slice(script.indexOf('/* ── Detalle de una tarjeta'), script.indexOf('window.renderNavdeckWeeklyBanner = '))}`
        : `const openNavdeckWeeklyDetail = detalle;
           function openNavdeckMonthlyDetail() {}
           function openNavdeckAnnualDetail() {}`}
      ${extraer('const NDW_CARD_DEFS = [', '];\n')}
      ${extraer('function ndwFormatValue(', '\n}\n')}
      ${extraer('let NDW_VIEW_STATE = ', ';\n')}
      ${modo ? `NDW_VIEW_STATE.mode = '${modo}';` : ''}
      ${script.slice(script.indexOf('/* ── Semana del banner'), script.indexOf('async function ndwLoadCurrentManifestDay('))}
      ${extraer('function renderNavdeckWeeklyBanner(', '\n}\n')}
      ${extraer('function ndwHeroImgPorHora(', '\n}\n')}
      ${extraer('function ndwActualizarFotoPorHora(', '\n}\n')}
      return { render: renderNavdeckWeeklyBanner, porHora: ndwHeroImgPorHora };
    `)(detalle, semana, anual, mensual);
    api.render();
    return { detalle, api, banner: $('navdeck-weekly-banner') };
  }

  test('el selector de vista abre el hero, arriba a la izquierda, seguido de la tarjeta del periodo', () => {
    const { banner } = montarBanner();
    const principal = banner.querySelector('.ndw-hero-main');
    // Donde iba la bienvenida ahora va el selector, y ya no queda uno suelto a la derecha.
    expect(principal.firstElementChild.classList.contains('ndw-view-toggle')).toBe(true);
    expect(banner.querySelectorAll('.ndw-view-toggle')).toHaveLength(1);
    expect(banner.querySelector('.ndw-hero-welcome')).toBeNull();
    const botones = [...banner.querySelectorAll('[data-ndw-mode]')];
    expect(botones.map((b) => b.dataset.ndwMode)).toEqual(['current', 'weekly', 'monthly', 'annual', 'historic']);
    expect(botones.map((b) => b.textContent.trim())).toEqual(['Día', 'Semana', 'Mes', 'Año', 'Histórico total']);
    expect(css).toMatch(/body\.navdeck-mode \.ndw-hero-main > \.ndw-view-toggle \{\s*align-self: flex-start;\s*margin-left: 0;/);
    expect(banner.querySelector('.ndw-hero-card .ndw-hero-title').textContent).toBe('7 al 13 de septiembre de 2026');
    const tarjetas = banner.querySelectorAll('.ndw-card');
    expect(tarjetas).toHaveLength(6);
    expect(tarjetas[0].getAttribute('style')).toContain('--ndw-img:');
    // La torre completa: la foto nueva, en su propia capa sobre el fondo desenfocado.
    expect(banner.querySelector('.ndw-hero').getAttribute('style')).toMatch(/images\/banner\d?\.png/);
    expect(banner.querySelector('.ndw-hero-media > .ndw-hero-foto')).not.toBeNull();
    expect(css).toMatch(/body\.navdeck-mode \.ndw-hero-foto \{[^}]*aspect-ratio: 1701 \/ 925;/);
    expect(fs.existsSync(path.join(raiz, 'images', 'banner.png'))).toBe(true);
    // En oscuro la torre también se ve: el velo se aligera hacia el centro.
    expect(css).toMatch(/body\.navdeck-mode\.dark-mode \.ndw-hero-media::after \{\s*background: linear-gradient\(95deg, rgba\(8, 14, 28, \.82\) 0%/);
  });

  test('el banner no lleva la fecha de hoy ni las leyendas de cifras preliminares y "Datos al"', () => {
    // Semana del mes en curso: antes era justo cuando aparecían las leyendas.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00'));
    try {
      const { banner } = montarBanner();
      ['weekly', 'monthly', 'annual', 'historic', 'current'].forEach((modo) => {
        banner.querySelector(`[data-ndw-mode="${modo}"]`).click();
        expect(banner.querySelector('.ndw-hero-fecha')).toBeNull();
        expect(banner.querySelector('.ndw-prelim-banner-group, .ndw-prelim-banner-note, .ndw-prelim-last-date')).toBeNull();
        expect(banner.textContent).not.toContain('Datos al');
      });
    } finally {
      jest.useRealTimers();
    }
    expect(css).not.toMatch(/\.ndw-hero-fecha|\.ndw-prelim-banner|\.ndw-prelim-last-date/);
  });

  test('las tarjetas llevan su nombre completo y, abajo de la cifra, el periodo', () => {
    const { banner } = montarBanner();
    const nombres = [...banner.querySelectorAll('.ndw-card-tag')].map((t) => t.textContent);
    expect(nombres).toEqual([
      'Operaciones comerciales', 'Pasajeros comerciales',
      'Operaciones carga', 'Toneladas de carga',
      'Operaciones aviación general', 'Pasajeros aviación general'
    ]);
    const primera = banner.querySelector('.ndw-card');
    expect(primera.querySelector('.ndw-card-value').textContent).toBe('770');
    expect(primera.querySelector('.ndw-card-sub').textContent).toBe('Total de la semana');
    expect(primera.getAttribute('aria-label')).toBe('Operaciones comerciales — Total de la semana');
    // El nombre se lee en mayúsculas y en oscuro sobre la tarjeta clara.
    expect(css).toMatch(/\n\.ndw-card-tag \{[^}]*text-transform: uppercase;/);
    expect(css).toMatch(/body\.navdeck-mode:not\(\.dark-mode\) \.ndw-card-tag \{\s*color: #1e293b !important;/);
    // Los detalles siguen con su encabezado corto ("Comercial · Operaciones").
    expect(script).toMatch(/titulo: 'Operaciones comerciales', label: 'Comercial', sub: 'Operaciones semana'/);
  });

  test('en Semana, abajo del periodo van las semanas del mes y el selector de mes, con la activa marcada', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00'));
    try {
      const { banner } = montarBanner();
      const semanas = () => [...banner.querySelectorAll('[data-ndw-week]')];
      const titulo = () => banner.querySelector('.ndw-hero-title').textContent;
      // Lunes a domingo, recortadas al mes; la activa es la del último día capturado.
      expect(semanas().map((c) => c.textContent)).toEqual(['1-6', '7-13', '14-20', '21-27', '28-30']);
      expect(semanas().filter((c) => c.classList.contains('is-active')).map((c) => c.textContent)).toEqual(['7-13']);
      expect(titulo()).toBe('7 al 13 de septiembre de 2026');
      // Las que aún no empiezan se ven, pero no se eligen.
      expect(semanas().map((c) => c.disabled)).toEqual([false, false, false, true, true]);
      expect(banner.querySelector('.ndw-month-step-label').textContent.trim()).toBe('Septiembre 2026');
      expect(banner.querySelector('[data-ndw-week-step="1"]').disabled).toBe(true);
      expect(banner.textContent).toContain('Toca una tarjeta para ver el desglose por día');

      semanas()[0].click();
      expect(titulo()).toBe('1 al 6 de septiembre de 2026');
      expect(banner.querySelector('.ndw-card-value').textContent).toBe('0');
      expect(banner.textContent).toContain('Detalle por FECHA del manifiesto');
      banner.querySelector('[data-ndw-week="2026-09-07"]').click();
      expect(banner.querySelector('.ndw-card-value').textContent).toBe('770');

      // Otro mes: sus semanas, con la primera elegida.
      banner.querySelector('[data-ndw-week-step="-1"]').click();
      expect(titulo()).toBe('1 al 2 de agosto de 2026');
      expect(semanas().map((c) => c.textContent)).toEqual(['1-2', '3-9', '10-16', '17-23', '24-30', '31']);
      expect(banner.querySelector('.ndw-month-step-label').textContent.trim()).toBe('Agosto 2026');
      expect(banner.querySelector('[data-ndw-week-step="1"]').disabled).toBe(false);
      semanas()[5].click();
      expect(titulo()).toBe('31 de agosto de 2026');
    } finally {
      jest.useRealTimers();
    }
  });

  test('al pasar a un mes de otro año, pide una vez el detalle de ese año (las tres aviaciones)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00'));
    const dia = (com, gen) => ({ comercial: { operaciones: com, pasajeros: com * 100 }, carga: { operaciones: 3, toneladas: 2 }, general: { operaciones: gen, pasajeros: gen * 2 } });
    const pedir = jest.fn().mockResolvedValue(new Map([
      ['2025-12-02', dia(140, 2)], ['2025-12-03', dia(10, 1)], ['2025-12-09', dia(150, 3)]
    ]));
    window.TotalesService = { getDetalleDiario: pedir };
    try {
      const { banner } = montarBanner();
      const valores = () => [...banner.querySelectorAll('.ndw-card-value')].map((v) => v.textContent);
      for (let i = 0; i < 9; i += 1) banner.querySelector('[data-ndw-week-step="-1"]').click();
      expect(banner.querySelector('.ndw-hero-title').textContent).toBe('1 al 7 de diciembre de 2025');
      expect(pedir).toHaveBeenCalledWith('2025-01-01', '2025-12-31');
      expect(valores()).toEqual(['—', '—', '—', '—', '—', '—']);
      expect(banner.textContent).toContain('Cargando el detalle de 2025');
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      expect([...banner.querySelectorAll('[data-ndw-week]')].map((c) => c.textContent)).toEqual(['1-7', '8-14', '15-21', '22-28', '29-31']);
      expect(valores()[0]).toBe('150');   // comercial 140 + 10
      expect(valores()[4]).toBe('3');     // general 2 + 1 (directorio de la Gerencia)
      banner.querySelector('[data-ndw-week="2025-12-08"]').click();
      expect(valores()[0]).toBe('150');
      expect(valores()[4]).toBe('3');
      expect(pedir).toHaveBeenCalledTimes(1);
    } finally {
      delete window.TotalesService;
      jest.useRealTimers();
    }
  });

  test('junto a Histórico total, el botón de regresar lleva cada vista a su periodo actual', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00'));
    try {
      const { banner } = montarBanner();
      const titulo = () => banner.querySelector('.ndw-hero-title').textContent;
      const regresar = () => banner.querySelector('[data-ndw-reset]');
      // Va al final del selector de vista, después de Histórico total.
      const selector = banner.querySelector('.ndw-view-toggle');
      expect(selector.lastElementChild).toBe(regresar());
      expect(regresar().previousElementSibling.previousElementSibling.dataset.ndwMode).toBe('historic');
      expect(regresar().getAttribute('aria-label')).toBe('Regresar al periodo actual');

      // Semana: otra semana y otro mes, y de vuelta a la del último día capturado.
      banner.querySelector('[data-ndw-week-step="-1"]').click();
      expect(titulo()).toBe('1 al 2 de agosto de 2026');
      regresar().click();
      expect(titulo()).toBe('7 al 13 de septiembre de 2026');
      expect(banner.querySelector('.ndw-period-chip.is-active').textContent).toBe('7-13');

      // Mes: un mes anterior, y de vuelta al mes en curso sin cambiar de vista.
      banner.querySelector('[data-ndw-mode="monthly"]').click();
      banner.querySelector('[data-ndw-step="-1"]').click();
      expect(titulo()).toBe('Agosto 2026');
      regresar().click();
      expect(titulo()).toBe('Septiembre 2026');
      expect(banner.querySelector('.ndw-view-btn.is-active').dataset.ndwMode).toBe('monthly');

      // Año: otro año, y de vuelta al actual.
      banner.querySelector('[data-ndw-mode="annual"]').click();
      banner.querySelector('[data-ndw-year="2025"]').click();
      expect(titulo()).toBe('2025');
      regresar().click();
      expect(titulo()).toBe('2026');

      // Día: otra fecha, y de vuelta a hoy.
      banner.querySelector('[data-ndw-mode="current"]').click();
      const fecha = banner.querySelector('[data-ndw-date]');
      fecha.value = '2026-09-12';
      fecha.dispatchEvent(new Event('change', { bubbles: true }));
      expect(titulo()).toBe('Sábado 12 de septiembre de 2026');
      regresar().click();
      expect(titulo()).toBe('Lunes 14 de septiembre de 2026');
    } finally {
      jest.useRealTimers();
    }
  });

  describe('las ventanas de detalle', () => {
    const texto = (sel) => document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim();
    const textos = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.replace(/\s+/g, ' ').trim());

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-15T12:00:00'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    test('en Semana: una ficha por día de la semana elegida y el último día en grande, sin gráfica', () => {
      const { banner } = montarBanner({ detalleReal: true });
      banner.querySelector('.ndw-card').click();
      expect(texto('.ndw-modal-range')).toBe('7 al 13 de septiembre de 2026');
      expect(document.querySelector('canvas')).toBeNull();
      expect(textos('.ndw-tile-lbl')).toEqual(['Lun 7', 'Mar 8', 'Mié 9', 'Jue 10', 'Vie 11', 'Sáb 12', 'Dom 13']);
      expect(textos('.ndw-kpi-val')).toEqual(['770', '110', '113']);
      expect(texto('.ndw-kpi-sub')).toBe('Domingo 13');
      // En foco, el día más reciente: su cifra, contra el día anterior, contra el promedio, su parte y su lugar.
      expect(texto('.ndw-focus-lbl')).toBe('Domingo 13 de septiembre de 2026');
      expect(texto('[data-ndw-focus-val]')).toBe('113');
      expect(textos('.ndw-focus-stats > *')).toEqual(['+0.9% vs sáb 12', '+2.7% vs promedio', '14.7% del total', '1.º lugar de 7']);
      expect(document.querySelector('.ndw-tile.is-focus').dataset.ndwTile).toBe('6');
      expect(document.querySelector('.ndw-tile.is-peak').dataset.ndwTile).toBe('6');
    });

    test('tocar una ficha la pone en foco, y las fichas se ordenan de mayor a menor o por fecha', () => {
      const { banner } = montarBanner({ detalleReal: true });
      banner.querySelector('.ndw-card').click();
      document.querySelector('[data-ndw-tile="0"]').click();
      expect(texto('.ndw-focus-lbl')).toBe('Lunes 7 de septiembre de 2026');
      expect(texto('[data-ndw-focus-val]')).toBe('107');
      expect(textos('.ndw-focus-stats > *')[0]).toBe('— sin día anterior');
      expect(textos('.ndw-focus-stats > *')[3]).toBe('7.º lugar de 7');
      expect(document.querySelector('[data-ndw-tile="0"]').getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelector('[data-ndw-tile="6"]').getAttribute('aria-pressed')).toBe('false');

      document.querySelector('[data-ndw-orden="valor"]').click();
      const orden = () => [...document.querySelectorAll('[data-ndw-tiles] > .ndw-tile')].map((t) => t.dataset.ndwTile);
      expect(orden()).toEqual(['6', '5', '4', '3', '2', '1', '0']);
      expect(document.querySelector('[data-ndw-orden="valor"]').classList.contains('is-active')).toBe(true);
      document.querySelector('[data-ndw-orden="fecha"]').click();
      expect(orden()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
      // El foco se conserva al reordenar.
      expect(document.querySelector('.ndw-tile.is-focus').dataset.ndwTile).toBe('0');
    });

    test('en Mes: el mes activo en grande, con su caída contra agosto, y el mes en curso marcado', () => {
      const valores = [4643, 4113, 4609, 4786, 4757, 4590, 5054, 5147, 3670];
      const { banner } = montarBanner({
        detalleReal: true,
        mensual: (i) => ({ value: valores[i], hasData: true, lastDate: i === 8 ? '2026-09-24' : null })
      });
      banner.querySelector('[data-ndw-mode="monthly"]').click();
      banner.querySelector('.ndw-card').click();
      expect(document.querySelector('canvas')).toBeNull();
      expect(textos('.ndw-kpi-val')).toEqual(['41,369', '4,597', '5,147']);
      expect(texto('.ndw-kpi-sub')).toBe('Agosto');
      expect(texto('.ndw-focus-lbl')).toBe('Septiembre 2026');
      expect(textos('.ndw-focus-tag')).toEqual(['En curso', 'Periodo activo']);
      expect(texto('[data-ndw-focus-val]')).toBe('3,670');
      expect(textos('.ndw-focus-stats > *')).toEqual(['-28.7% vs agosto', '-20.2% vs promedio', '8.9% del total', '9.º lugar de 9']);
      expect(document.querySelector('.ndw-focus-stats .ndw-delta').classList.contains('is-down')).toBe(true);
      expect(texto('.ndw-focus-note')).toContain('Mes en curso');
      expect(textos('.ndw-tile-lbl')).toEqual(['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep']);
      expect(document.querySelector('.ndw-tile.is-peak').dataset.ndwTile).toBe('7');
      expect(document.querySelector('.ndw-tile.is-prelim').dataset.ndwTile).toBe('8');
      expect(texto('.ndw-prelim-note')).toContain('Septiembre aún en curso');
    });
  });

  test('en el histórico, las cifras de millones van un punto más chicas', () => {
    const { banner } = montarBanner({ anual: 5000000 });
    banner.querySelector('[data-ndw-mode="historic"]').click();
    const valor = banner.querySelector('.ndw-card-value');
    expect(valor.textContent).toBe('10,000,000');
    expect(valor.classList.contains('ndw-card-value--largo')).toBe(true);
    expect(banner.querySelector('.ndw-card-sub').textContent).toBe('Total histórico');
    banner.querySelector('[data-ndw-mode="weekly"]').click();
    expect(banner.querySelector('.ndw-card-value').classList.contains('ndw-card-value--largo')).toBe(false);
  });

  test('el inicio abre en Día con ayer y permite elegir otra fecha sin reutilizar cifras anteriores', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-16T12:00:00-06:00'));
    try {
    const { banner, detalle } = montarBanner({ modo: null });
    expect(banner.querySelector('[data-ndw-mode="current"]').getAttribute('aria-pressed')).toBe('true');
    expect(banner.querySelector('[data-ndw-date]').value).toBe('2026-09-15');
    expect(banner.querySelector('.ndw-hero-kicker').textContent).toBe('Cifras del día');
    expect(banner.querySelector('.ndw-hero-title').textContent).toBe('Martes 15 de septiembre de 2026');
    const valores = [...banner.querySelectorAll('.ndw-card-value')].map((v) => v.textContent);
    expect(valores[0]).toBe('2');
    expect(valores[1]).toBe('240');
    expect(valores[5]).toBe('0');
    expect(banner.querySelector('.ndw-card-sub').textContent).toBe('Total del día');
    banner.querySelector('.ndw-card').click();
    expect(detalle).toHaveBeenCalledWith(0);
    const input = banner.querySelector('[data-ndw-date]');
    input.value = '2026-09-12';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(banner.querySelector('.ndw-hero-title').textContent).toBe('Sábado 12 de septiembre de 2026');
    expect(banner.querySelector('.ndw-card-value').textContent).toBe('0');
    expect(banner.textContent).toContain('Sin manifiestos para esta fecha');
    } finally { jest.useRealTimers(); }
  });

  test('Mes, Año e Histórico salen de la capa unificada: "—" mientras se consulta y su leyenda en el hero', () => {
    const { banner, api } = montarBanner({ totales: { status: 'loading', porMes: new Map(), leyenda: '' } });
    const valores = () => [...banner.querySelectorAll('.ndw-card-value')].map((v) => v.textContent);
    banner.querySelector('[data-ndw-mode="monthly"]').click();
    expect(valores()).toEqual(['—', '—', '—', '—', '—', '—']);
    window._ndwTotales = { status: 'ready', porMes: new Map(), leyenda: LEYENDA };
    api.render();
    expect(banner.textContent).toContain(LEYENDA);
    window._ndwTotales = { status: 'error', porMes: new Map(), leyenda: '' };
    api.render();
    expect(banner.textContent).toContain('No fue posible consultar los totales');
    // Semana es detalle: lo dice el hero.
    banner.querySelector('[data-ndw-mode="weekly"]').click();
    expect(banner.textContent).toContain('Detalle por FECHA del manifiesto');
  });

  test('el aviso "Carga ene–ago 2026 incompleta" sale discreto sólo en los periodos que lo tocan', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T12:00:00'));
    const avisosApi = require('../js/manifiestos-avisos.js');
    const avisos = [{ clave: 'carga_2026_ene_ago', texto: 'Carga ene–ago 2026 incompleta', desde: '2026-01-01',
      hasta: '2026-08-31', categoria: 'carga', ambitos: ['inicio', 'estadistica'], activo: true }];
    window.ManifiestosAvisos = { cargar: () => Promise.resolve(avisos), para: (a, d, h, c) => avisosApi.filtrar(avisos, a, d, h, c) };
    window._ndwAvisosPedidos = true;
    try {
      const { banner } = montarBanner();
      const aviso = () => banner.querySelector('.ndw-aviso-periodo');
      expect(aviso()).toBeNull();                      // semana del 7 al 13 de septiembre
      banner.querySelector('[data-ndw-mode="annual"]').click();
      expect(aviso().textContent).toContain('Carga ene–ago 2026 incompleta');
      banner.querySelector('[data-ndw-mode="monthly"]').click();
      expect(aviso()).toBeNull();                      // septiembre
      banner.querySelector('[data-ndw-step="-1"]').click();
      expect(aviso().textContent).toContain('Carga ene–ago 2026 incompleta');   // agosto
      banner.querySelector('[data-ndw-mode="historic"]').click();
      expect(aviso()).not.toBeNull();
    } finally {
      delete window.ManifiestosAvisos;
      delete window._ndwAvisosPedidos;
      jest.useRealTimers();
    }
  });

  test('la foto va según la hora local del sitio, en sus cuatro horarios', () => {
    const { api } = montarBanner();
    const foto = (hms) => api.porHora(new Date(`2026-09-15T${hms}`));
    expect(foto('06:00:00')).toBe('images/banner3.png');
    expect(foto('06:00:01')).toBe('images/banner4.png');
    expect(foto('15:00:00')).toBe('images/banner4.png');
    expect(foto('15:00:01')).toBe('images/banner.png');
    expect(foto('17:00:00')).toBe('images/banner.png');
    expect(foto('17:00:01')).toBe('images/banner2.png');
    expect(foto('20:00:00')).toBe('images/banner2.png');
    expect(foto('20:00:01')).toBe('images/banner3.png');
    expect(foto('00:00:00')).toBe('images/banner3.png');
    expect(foto('23:59:59')).toBe('images/banner3.png');
    ['banner', 'banner2', 'banner3', 'banner4'].forEach((n) => expect(fs.existsSync(path.join(raiz, 'images', `${n}.png`))).toBe(true));
  });

  test('ya no hay flechas y la foto cambia sola cuando el reloj cruza un horario', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T17:00:00'));
    try {
      const { banner } = montarBanner();
      const hero = () => banner.querySelector('.ndw-hero');
      expect(banner.querySelector('.ndw-hero-nav, [data-ndw-hero]')).toBeNull();
      expect(css).not.toContain('.ndw-hero-nav');
      expect(hero().getAttribute('style')).toContain('images/banner.png');
      jest.setSystemTime(new Date('2026-09-15T17:00:01'));
      jest.advanceTimersByTime(1000);
      expect(hero().getAttribute('style')).toContain('images/banner2.png');
      // Cambiar de vista vuelve a pintar el banner con la foto de la hora.
      banner.querySelector('[data-ndw-mode="current"]').click();
      expect(hero().getAttribute('style')).toContain('images/banner2.png');
    } finally {
      jest.useRealTimers();
    }
  });
});
