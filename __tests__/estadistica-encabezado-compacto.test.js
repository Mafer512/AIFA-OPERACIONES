/**
 * @jest-environment node
 *
 * Estadística: el encabezado del aeropuerto en un solo renglón.
 *
 * En la pantalla completa de Estadística el encabezado queda como el tablero
 * de diseño: alas del AIFA con el nombre al lado, el título en una línea, el
 * escudo, las fichas "Hoy" y "Hora local", Actualizar y el tema, y debajo, sin
 * franja en medio, las pestañas de Conciliación. En el resto de la aplicación
 * el encabezado no cambia: las piezas nuevas nacen ocultas.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n');
const html = leer('index.html');
const css = leer('style.css');
const script = leer('script.js');

const encabezado = html.slice(html.indexOf('<header class="header'), html.indexOf('</header>'));

/** Las reglas (selector, cuerpo) cuyo selector nombra a `pieza`. */
const reglasDe = pieza => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selector]) => selector.split(',').some(s => s.trim().endsWith(pieza)));

describe('el marcado del encabezado', () => {
  test('trae la ficha "Hoy" con su fecha, junto a la hora local', () => {
    expect(encabezado).toMatch(/<div class="header-hoy-chip"[^>]*>[\s\S]*?id="header-hoy-fecha"/);
    expect(encabezado.indexOf('header-hoy-chip')).toBeLessThan(encabezado.indexOf('formal-clock-container'));
    expect(encabezado).toMatch(/<div class="formal-clock-container">\s*<i class="far fa-clock header-chip-icon"/);
  });

  test('el nombre del aeropuerto va junto a las alas, sin estorbar a los lectores de pantalla', () => {
    expect(encabezado).toContain('<span class="header-brand-text" aria-hidden="true">AEROPUERTO INTERNACIONAL<b>FELIPE ÁNGELES</b></span>');
  });
});

describe('fuera de Estadística el encabezado no cambia', () => {
  test('las piezas nuevas nacen ocultas', () => {
    const base = reglasDe('.header-hoy-chip').find(([selector]) => !selector.includes('conci-estadistica-workspace'));
    expect(base).toBeDefined();
    expect(base[1]).toMatch(/\.header-chip-icon/);
    expect(base[1]).toMatch(/\.header-brand-text/);
    expect(base[2]).toMatch(/display:\s*none/);
  });
});

describe('en Estadística, un solo renglón', () => {
  const regla = pieza => reglasDe(`body.conci-estadistica-workspace ${pieza}`).map(([, , cuerpo]) => cuerpo).join('\n');

  test('se quitan usuario, fecha larga, hora UTC, el avión animado y el logo de NLU', () => {
    for (const pieza of ['.header-subtext', '.utc-clock-container', '#flying-plane', '.header-title-row .header-logo:first-child']) {
      expect(regla(pieza)).toMatch(/display:\s*none\s*!important/);
    }
  });

  test('el título cabe en una línea y el encabezado no deja franja antes de las pestañas', () => {
    expect(regla('.main-title')).toMatch(/white-space:\s*nowrap/);
    expect(regla('.header')).toMatch(/margin-bottom:\s*0/);
    expect(regla('.header-content')).toMatch(/min-height:\s*0/);
    expect(regla('#conciliacion-tabs')).toMatch(/padding-top:\s*\.35rem/);
  });

  test('del logo solo se ven las alas', () => {
    expect(regla('.aifa-logo')).toMatch(/object-fit:\s*cover/);
    expect(regla('.aifa-logo')).toMatch(/object-position:\s*center top/);
  });

  test('las fichas de Hoy y Hora local se muestran con su icono', () => {
    expect(regla('.header-hoy-chip')).toMatch(/display:\s*grid/);
    expect(regla('.header-chip-icon')).toMatch(/display:\s*block/);
  });
});

describe('la fecha corta de la ficha "Hoy"', () => {
  const inicio = script.indexOf('function formatHeaderHoy(');
  const formatHeaderHoy = new Function(`${script.slice(inicio, script.indexOf('\n}\n', inicio) + 2)}; return formatHeaderHoy;`)();

  test('sale como en el diseño: día, número, mes y año', () => {
    expect(formatHeaderHoy(new Date(2026, 8, 11))).toBe('Vie 11 Sep 2026');
    expect(formatHeaderHoy(new Date(2026, 0, 4))).toBe('Dom 04 Ene 2026');
    expect(formatHeaderHoy(new Date(2026, 11, 2))).toBe('Mié 02 Dic 2026');
  });

  test('se escribe cada vez que se actualiza la fecha del encabezado', () => {
    const cuerpo = script.slice(script.indexOf('function updateDate()'), script.indexOf('\n}\n', script.indexOf('function updateDate()')));
    expect(cuerpo).toContain("document.getElementById('header-hoy-fecha')");
    expect(cuerpo).toContain('formatHeaderHoy(now)');
  });
});
