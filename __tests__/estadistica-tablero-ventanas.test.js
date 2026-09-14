/**
 * @jest-environment jsdom
 *
 * Estadística: cabecera con filtros y ventanas por área.
 *
 * Arriba, el recuadro "Estadísticas" —que es el botón del Resumen— y los 15
 * filtros del módulo, de "Desde" al botón de actualizar. Abajo, una ventana
 * por área, de Explorador a Informe oficial, más FBO (tablero de Aviación General). En el
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

const VENTANAS = ['descargas', 'explorador', 'operaciones', 'pasajeros', 'aerolineas', 'rutas', 'aeronaves',
  'carga', 'fbo', 'puntualidad', 'comparador', 'clasificacion', 'informe'];

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
  test('Descargas primero; luego de Explorador a Informe oficial, con FBO después de Carga', () => {
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

  test('FBO es nueva y su panel trae el tablero de Aviación General', () => {
    expect($('est-tab-fbo').querySelector('.est-ventana-nuevo').textContent).toBe('Nuevo');
    expect($('est-pane-fbo').classList.contains('tab-pane')).toBe(true);
    for (const id of ['est-fbo-frase', 'est-fbo-filtro', 'est-fbo-nota', 'est-fbo-vacio', 'est-fbo-contenido', 'est-fbo-kpis',
      'est-fbo-destacados', 'est-fbo-mes', 'est-fbo-composicion', 'est-fbo-operadores', 'est-fbo-aeronaves',
      'est-fbo-aeropuertos', 'est-fbo-matriculas', 'est-fbo-operadores-sin', 'est-fbo-aeronaves-sin',
      'est-fbo-aeropuertos-sin']) {
      expect($('est-pane-fbo').querySelector('#' + id)).not.toBeNull();
    }
    expect([...$('est-pane-fbo').querySelectorAll('[data-fbo-metrica]')].map((b) => b.dataset.fboMetrica)).toEqual(['movimientos', 'pax']);
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

describe('el acomodo pedido', () => {
  test('en pantalla ancha, Descargas cuadrada a la izquierda y dos renglones de seis', () => {
    expect(css).toMatch(/@media \(min-width: 1200px\) \{\n\s*\.est-ventanas \{[^}]*grid-template-columns: 9\.2rem repeat\(6, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.est-ventanas > #est-tab-descargas \{[^}]*grid-row: 1 \/ span 2;/);
  });

  test('Descargas va primero y las otras doce quedan seis y seis', () => {
    const ids = [...document.querySelectorAll('.est-ventanas > .est-ventana')].map(b => b.id);
    expect(ids[0]).toBe('est-tab-descargas');
    expect(ids.slice(1, 7)).toEqual(['explorador', 'operaciones', 'pasajeros', 'aerolineas', 'rutas', 'aeronaves'].map(x => 'est-tab-' + x));
    expect(ids.slice(7)).toEqual(['carga', 'fbo', 'puntualidad', 'comparador', 'clasificacion', 'informe'].map(x => 'est-tab-' + x));
  });

  test('los filtros ceden espacio para caber en un renglón', () => {
    expect(css).toMatch(/\.est-cabecera #est-filtros \.card-body > \.d-flex > div \{\n\s*flex: 1 1 0;/);
  });

  test('la fecha de los datos va encima de Aplicar, limpiar y actualizar', () => {
    const acciones = document.querySelector('#est-filtros .est-filtros-acciones');
    expect(acciones.firstElementChild.id).toBe('est-frescura');
    expect([...acciones.querySelectorAll('button')].map(b => b.id))
      .toEqual(['est-btn-aplicar', 'est-btn-limpiar', 'est-btn-refrescar']);
  });

  test('un área que carga no se atenúa: lleva un indicador', () => {
    const panel = fs.readFileSync(path.join(raiz, 'js', 'estadistica-panel.js'), 'utf8');
    expect(panel).not.toContain("toggle('opacity-50'");
    expect(css).toMatch(/\.est-cabecera \.nav-link\.est-cargando::after \{/);
  });
});

describe('el aviso de carga', () => {
  test('mientras carga, lo que el área tenía queda detrás, difuminado', () => {
    expect(css).toMatch(/\.est-pane-cargando > :not\(\.est-carga\) \{[^}]*filter: blur\(/);
    expect(css).not.toMatch(/\.est-pane-cargando > :not\(\.est-carga\) \{\n\s*display: none !important;/);
    expect(css).toMatch(/\.est-carga-relleno \{[^}]*transition: width/);
  });

  test('el aviso flota sin tarjeta, contorno ni sombra sobre el contenido difuminado', () => {
    const regla = css.match(/\n\.est-carga \{[^}]*\}/)[0];
    expect(regla).toMatch(/border: 0;/);
    expect(regla).toMatch(/background: transparent;/);
    expect(regla).toMatch(/box-shadow: none;/);
  });
});

describe('el lienzo de Estadística', () => {
  test('el fondo es blanco y el área llena el alto: no asoma una franja gris', () => {
    expect(css).toMatch(/body\.conci-estadistica-workspace \{\n\s*background-color: #fff;/);
    expect(css).toMatch(/\.tab-content > #pane-conci-estadistica\.active \{[^}]*min-height: calc\(100vh/);
  });

  test('los avisos van al pie de la página, en blanco como el fondo', () => {
    expect(css).toMatch(/#pane-conci-estadistica > #est-avisos \{[^}]*order: 2;[^}]*margin-top: auto;/);
    expect(css.match(/\n\.est-aviso \{[^}]*\}/)[0]).toMatch(/background: transparent;/);
    expect($('est-avisos').classList.contains('mb-3')).toBe(false);
  });
});

describe('todas las áreas con el diseño de FBO', () => {
  const AREAS = [['resumen', 'est-resumen'], ['explorador', 'est-exp'], ['operaciones', 'est-ops'],
    ['pasajeros', 'est-pax'], ['aerolineas', 'est-aero'], ['rutas', 'est-rutas'], ['aeronaves', 'est-aeronaves'],
    ['carga', 'est-carga'], ['puntualidad', 'est-punt'], ['comparador', 'est-cmp']];

  test('cada área abre con su cabecera y su frase, y acomoda lo demás en paneles', () => {
    for (const [area, prefijo] of AREAS) {
      const pane = $(`est-pane-${area}`);
      expect(pane.querySelector('.fbo-tablero .fbo-cabeza .fbo-titulo')).not.toBeNull();
      expect(pane.querySelector(`#${prefijo}-frase.fbo-frase`)).not.toBeNull();
      expect(pane.querySelectorAll('.fbo-panel').length).toBeGreaterThan(0);
    }
    for (const area of ['clasificacion', 'descargas']) {
      expect($(`est-pane-${area}`).querySelector('.fbo-cabeza .fbo-titulo')).not.toBeNull();
    }
  });

  test('las tarjetas usan la rejilla de FBO y cada tabla va dentro de un panel', () => {
    AREAS.forEach(([, prefijo]) => expect($(`${prefijo}-tarjetas`).classList.contains('fbo-kpis')).toBe(true));
    const tablas = document.querySelectorAll('#est-subcontent table[id^="est-"]');
    expect(tablas.length).toBeGreaterThan(10);
    tablas.forEach((tabla) => expect(tabla.closest('.fbo-panel')).not.toBeNull());
  });

  test('siguen todos los identificadores que usan el panel y la clasificación', () => {
    ['est-resumen-calidad', 'est-resumen-chart', 'est-resumen-variaciones',
      'est-exp-dim1', 'est-exp-dim2', 'est-exp-dim3', 'est-exp-consultar', 'est-exp-filtro-campo', 'est-exp-filtro-valor',
      'est-exp-filtro-nota', 'est-exp-csv', 'est-exp-excel', 'est-exp-conteo', 'est-exp-chart', 'est-exp-tabla',
      'est-ops-chart', 'est-ops-tabla', 'est-ops-clasif', 'est-pax-chart', 'est-pax-tabla', 'est-pax-ocupacion',
      'est-aero-chart', 'est-aero-tabla', 'est-rutas-chart', 'est-rutas-tabla', 'est-aeronaves-tipo', 'est-aeronaves-matricula',
      'est-carga-nota', 'est-carga-chart', 'est-carga-tabla', 'est-carga-aerolinea', 'est-punt-chart', 'est-punt-aerolinea',
      'est-punt-causas', 'est-cmp-preset', 'est-cmp-a-desde', 'est-cmp-a-hasta', 'est-cmp-b-desde', 'est-cmp-b-hasta',
      'est-cmp-comparar', 'est-cmp-csv', 'est-cmp-tabla', 'est-cla-nueva', 'est-cla-solo-activas', 'est-cla-conteo',
      'est-cla-solo-lectura', 'est-cla-tabla', 'est-cla-sin-resumen', 'est-cla-sin-tabla', 'est-descargas-lista']
      .forEach((id) => expect($(id)).not.toBeNull());
  });

  test('las tablas largas se desplazan dentro de su panel con el encabezado fijo', () => {
    expect(css).toMatch(/\.tb-tabla-alta \{[^}]*max-height:[^}]*overflow: auto;/);
    expect(css).toMatch(/\.tb-tabla thead th \{[^}]*position: sticky;/);
  });

  test('el Informe oficial toma tarjetas y paneles del mismo lenguaje', () => {
    expect(css).toMatch(/#est-pane-informe \.airline-stat-card \{[^}]*border-left: 4px solid/);
    expect(css).toMatch(/#est-pane-informe \.table-responsive \{[^}]*border-radius: \.9rem;/);
  });
});

describe('los controles del Explorador', () => {
  test('agrupación, filtro, consultar, CSV y Excel van en un solo renglón', () => {
    const filas = $('est-pane-explorador').querySelectorAll('.tb-controles .tb-controles-fila');
    expect(filas).toHaveLength(1);
    const ids = [...filas[0].querySelectorAll('select, button')].map((el) => el.id);
    expect(ids).toEqual(['est-exp-dim1', 'est-exp-dim2', 'est-exp-dim3', 'est-exp-filtro-campo', 'est-exp-filtro-valor',
      'est-exp-consultar', 'est-exp-csv', 'est-exp-excel']);
    expect(filas[0].querySelector('#est-exp-conteo')).not.toBeNull();
    expect(filas[0].querySelector('#est-exp-filtro-nota')).not.toBeNull();
  });

  test('en pantalla ancha la fila no se parte', () => {
    expect(css).toMatch(/@media \(min-width: 1400px\) \{\s*\.tb-controles-fila \{\s*flex-wrap: nowrap;/);
    expect(css).toMatch(/\.tb-controles-fila \.form-select \{[^}]*max-width: 13rem;/);
  });
});

describe('la frase de cada área', () => {
  test('ocupa todo el ancho, sin tope', () => {
    expect(css.match(/\n\.fbo-frase \{[^}]*\}/)[0]).not.toMatch(/max-width/);
    expect(css).toMatch(/\.fbo-cabeza-texto \{[^}]*flex: 1 1 32rem;/);
  });
});
