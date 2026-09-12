/**
 * @jest-environment jsdom
 *
 * Estadística: cabecera con filtros y ventanas por área.
 *
 * Arriba, el recuadro "Estadísticas" —que es el botón del Resumen— y los 15
 * filtros del módulo, de "Desde" al botón de actualizar. Abajo, una ventana
 * por área, de Explorador a Informe oficial, más FBO (todavía vacía). En el
 * encabezado de la página, dentro de Estadística, el título es la frase del
 * tablero de diseño.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n');
const html = leer('index.html');
const css = leer('style.css');

const FILTROS = ['est-f-desde', 'est-f-hasta', 'est-f-preset', 'est-f-aerolinea', 'est-f-tipo-aeronave',
  'est-f-matricula', 'est-f-endpoint', 'est-f-direccion', 'est-f-nacint', 'est-f-segmento', 'est-f-naturaleza',
  'est-f-servicio', 'est-btn-aplicar', 'est-btn-limpiar', 'est-btn-refrescar'];

const VENTANAS = ['explorador', 'operaciones', 'pasajeros', 'aerolineas', 'rutas', 'aeronaves', 'carga', 'fbo',
  'puntualidad', 'comparador', 'clasificacion', 'descargas', 'informe'];

beforeAll(() => {
  const inicio = html.indexOf('<div class="tab-pane fade p-4" id="pane-conci-estadistica"');
  const fin = html.indexOf('<!-- INFORME OFICIAL');
  document.body.innerHTML = html.slice(inicio, fin);
});

const $ = id => document.getElementById(id);
const cabecera = () => $('est-subnav');

describe('la cabecera del módulo', () => {
  test('es un solo .nav con todos los botones de área, para que Bootstrap los alterne', () => {
    expect(cabecera().classList.contains('nav')).toBe(true);
    expect(cabecera().getAttribute('role')).toBe('tablist');
    const areas = [...cabecera().querySelectorAll('[data-bs-toggle="pill"]')].map(b => b.dataset.estArea);
    expect(areas).toEqual(['resumen', ...VENTANAS]);
  });

  test('"Estadísticas" es el botón del Resumen y abre abierto', () => {
    const resumen = $('est-tab-resumen');
    expect(resumen.classList.contains('est-resumen')).toBe(true);
    expect(resumen.classList.contains('active')).toBe(true);
    expect(resumen.textContent).toContain('Estadísticas');
    expect(resumen.dataset.bsTarget).toBe('#est-pane-resumen');
    // Va antes que los filtros y las ventanas.
    const orden = [...cabecera().children].map(n => n.id || n.className);
    expect(orden).toEqual(['est-tab-resumen', 'est-filtros', 'est-ventanas']);
  });

  test('los 15 filtros siguen ahí, en su orden, de "Desde" al botón de actualizar', () => {
    const filtros = $('est-filtros');
    expect(cabecera().contains(filtros)).toBe(true);
    const ids = [...filtros.querySelectorAll('input, select, button')].map(n => n.id);
    expect(ids).toEqual(FILTROS);
  });
});

describe('las ventanas por área', () => {
  test('van de Explorador a Informe oficial, con FBO después de Carga', () => {
    const ids = [...document.querySelectorAll('.est-ventanas > .est-ventana')].map(b => b.id);
    expect(ids).toEqual(VENTANAS.map(a => `est-tab-${a}`));
  });

  test('cada ventana tiene icono, título, descripción y un panel que abrir', () => {
    for (const area of VENTANAS) {
      const boton = $(`est-tab-${area}`);
      expect(boton.querySelector('.est-ventana-icono i.fas')).not.toBeNull();
      expect(boton.querySelector('.est-ventana-texto b').textContent.trim()).not.toBe('');
      expect(boton.querySelector('.est-ventana-texto small').textContent.trim()).not.toBe('');
      expect(boton.dataset.bsTarget).toBe(`#est-pane-${area}`);
      if (area !== 'informe') expect(document.querySelector(boton.dataset.bsTarget)).not.toBeNull();
    }
  });

  test('FBO es nueva y su panel todavía no muestra nada', () => {
    expect($('est-tab-fbo').querySelector('.est-ventana-nuevo').textContent).toBe('Nuevo');
    expect($('est-pane-fbo').innerHTML.trim()).toBe('');
    expect($('est-pane-fbo').classList.contains('tab-pane')).toBe(true);
  });
});

describe('el encabezado de la página en Estadística', () => {
  test('el título cambia a la frase del tablero solo dentro de Estadística', () => {
    expect(html).toContain('<h1 class="main-title"><span class="main-title-app">AEROPUERTO INTERNACIONAL FELIPE ÁNGELES</span>'
      + '<span class="main-title-est">Consulta y analiza la operación del aeropuerto en tiempo real</span></h1>');
    expect(css).toMatch(/\n\.main-title-est \{\n\s*display: none;/);
    expect(css).toMatch(/body\.conci-estadistica-workspace \.main-title-app \{\n\s*display: none;/);
    expect(css).toMatch(/body\.conci-estadistica-workspace \.main-title-est \{\n\s*display: inline;/);
  });
});

describe('el estilo', () => {
  test('arriba "Estadísticas" y filtros; abajo, las ventanas', () => {
    expect(css).toMatch(/#est-subnav\.est-cabecera \{[^}]*grid-template-areas:\s*"resumen filtros"\s*"ventanas ventanas"/);
  });

  test('el área abierta se pinta en azul', () => {
    expect(css).toMatch(/\.est-cabecera \.nav-link\.active \{[^}]*background: linear-gradient/);
  });
});
