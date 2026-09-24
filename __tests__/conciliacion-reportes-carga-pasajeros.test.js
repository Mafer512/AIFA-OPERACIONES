/**
 * @jest-environment jsdom
 *
 * Reportes (Carga / Pasajeros): el botón, la página y sus dos apartados.
 *
 * Reportes es una PÁGINA propia, no una vista dentro de Conciliación. Esa es
 * la parte que importa: su marcado tiene que ser una .content-section hermana
 * de #conciliacion-section, porque si vive dentro siguen viéndose las pestañas
 * de Conciliación (Itinerario / Manifiestos / Estadística) por encima.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const moduloReportes = fs.readFileSync(path.join(raiz, 'js', 'conci-reportes.js'), 'utf8');

/** Recorta el marcado de la pestaña Manifiestos, donde vive el botón. */
function paneManifiestos() {
  const inicio = html.indexOf('id="pane-conci-comercial"');
  const fin = html.indexOf('/pane-conci-comercial', inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(inicio);
  return html.slice(inicio, fin);
}

/** Recorta el marcado de la página de Reportes. */
function seccionReportes() {
  const inicio = html.indexOf('id="conci-reportes-section"');
  const fin = html.indexOf('/conci-reportes-section', inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(inicio);
  return html.slice(inicio, fin);
}

describe('el botón en Manifiestos', () => {
  const pane = paneManifiestos();

  test('está en la barra de Conciliación Manifiestos', () => {
    expect(pane).toContain('id="btn-conci-reportes"');
    expect(pane).toMatch(/id="btn-conci-reportes"[\s\S]*?>\s*Reportes\s*</);
  });

  test('queda a la izquierda del primer campo de fecha', () => {
    const posBoton = pane.indexOf('id="btn-conci-reportes"');
    const posFecha = pane.indexOf('data-conci-fecha-para="filter-conci-fecha-desde"');
    expect(posBoton).toBeGreaterThan(-1);
    expect(posFecha).toBeGreaterThan(-1);
    expect(posBoton).toBeLessThan(posFecha);
  });
});

describe('Reportes es una página propia', () => {
  test('es una .content-section, no un bloque dentro de Conciliación', () => {
    expect(html).toMatch(/<div id="conci-reportes-section" class="content-section">/);
  });

  test('vive FUERA de #conciliacion-section', () => {
    const finConciliacion = html.indexOf('/conciliacion-section');
    const inicioReportes = html.indexOf('id="conci-reportes-section"');
    expect(finConciliacion).toBeGreaterThan(-1);
    expect(inicioReportes).toBeGreaterThan(finConciliacion);
  });

  test('las pestañas de Conciliación no forman parte de la página', () => {
    const seccion = seccionReportes();
    expect(seccion).not.toContain('tab-conci-itinerario');
    expect(seccion).not.toContain('tab-conci-comercial');
    expect(seccion).not.toContain('tab-conci-estadistica');
  });

  test('nace inactiva: no se muestra hasta que se pulsa Reportes', () => {
    const apertura = html.slice(html.indexOf('<div id="conci-reportes-section"'), html.indexOf('<div id="conci-reportes-section"') + 90);
    expect(apertura).not.toContain('active');
  });

  test('tiene su propio botón de regreso y de menú', () => {
    const seccion = seccionReportes();
    expect(seccion).toContain('id="btn-conci-reportes-volver"');
    expect(seccion).toContain('id="btn-conci-reportes-menu"');
  });
});

describe('los dos apartados', () => {
  const seccion = seccionReportes();

  test('son Carga y Pasajeros, en ese orden', () => {
    const tabs = seccion.slice(seccion.indexOf('id="conci-reportes-tabs"'), seccion.indexOf('conci-reportes-tab-content'));
    expect(tabs).toContain('id="tab-conci-rep-carga"');
    expect(tabs).toContain('id="tab-conci-rep-pasajeros"');
    expect(tabs.indexOf('tab-conci-rep-carga')).toBeLessThan(tabs.indexOf('tab-conci-rep-pasajeros'));
    expect(tabs).toMatch(/>\s*Carga\s*</);
    expect(tabs).toMatch(/>\s*Pasajeros\s*</);
  });

  test('cada uno tiene su panel', () => {
    expect(seccion).toContain('id="pane-conci-rep-carga"');
    expect(seccion).toContain('id="pane-conci-rep-pasajeros"');
  });

  test('index.html carga el módulo de reportes', () => {
    expect(html).toContain('js/conci-reportes.js');
  });
});

describe('el espacio de trabajo a pantalla completa', () => {
  const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');

  /** Reglas de style.css que aplican con el body en modo Reportes. */
  function reglas() {
    return css.split('}').filter(bloque => bloque.includes('body.conci-reportes-workspace'));
  }

  test('oculta el encabezado, la barra de agenda y la barra lateral', () => {
    const ocultas = reglas().find(bloque => /display:\s*none/.test(bloque));
    expect(ocultas).toBeDefined();
    ['.header', '#ag-today-bar', '.sidebar'].forEach(selector => {
      expect(ocultas).toContain(`body.conci-reportes-workspace ${selector}`);
    });
  });

  test('oculta también el botón flotante de Menú, que quedaría duplicado', () => {
    const ocultas = reglas().find(bloque => /display:\s*none/.test(bloque));
    expect(ocultas).toContain('body.conci-reportes-workspace #navdeck-back');
  });

  test('la página ocupa la pantalla completa', () => {
    const fijada = reglas().find(bloque => bloque.includes('#conci-reportes-section.active')
      && /position:\s*fixed/.test(bloque));
    expect(fijada).toBeDefined();
  });
});

describe('navegación entre páginas', () => {
  let conciliacion;
  let reportes;
  let boton;

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = `
      <div id="conciliacion-section" class="content-section active">
        <button id="btn-conci-reportes" type="button">Reportes</button>
      </div>
      <div id="conci-reportes-section" class="content-section">
        <button id="btn-conci-reportes-volver" type="button">Regresar a Manifiestos</button>
        <button id="btn-conci-reportes-menu" type="button">Menú</button>
        <button id="tab-conci-rep-carga" type="button">Carga</button>
      </div>
      <div id="otra-section" class="content-section"></div>
      <a class="menu-item" data-section="otra"></a>
    `;
    document.body.classList.add('conci-manifest-workspace');

    // El módulo se engancha en DOMContentLoaded. Disparar el evento de verdad
    // ejecutaría también los enganches de las evaluaciones anteriores —jsdom
    // reutiliza el mismo document en todo el archivo— y el botón acabaría con
    // un listener por test: un número par de alternancias lo dejaría cerrado.
    // Se intercepta el registro para quedarse solo con el de esta evaluación.
    let arrancar;
    const registrar = document.addEventListener.bind(document);
    const espia = jest.spyOn(document, 'addEventListener')
      .mockImplementation((tipo, fn, opciones) => {
        if (tipo === 'DOMContentLoaded') { arrancar = fn; return; }
        registrar(tipo, fn, opciones);
      });
    new Function(moduloReportes)();
    espia.mockRestore();
    arrancar();

    conciliacion = document.getElementById('conciliacion-section');
    reportes = document.getElementById('conci-reportes-section');
    boton = document.getElementById('btn-conci-reportes');
  });

  test('el clic en Reportes apaga Conciliación y enciende Reportes', () => {
    boton.click();
    expect(reportes.classList.contains('active')).toBe(true);
    expect(conciliacion.classList.contains('active')).toBe(false);
    expect(document.body.classList.contains('conci-reportes-abierto')).toBe(true);
  });

  test('suelta el espacio de trabajo de Manifiestos y enciende el suyo', () => {
    boton.click();
    expect(document.body.classList.contains('conci-manifest-workspace')).toBe(false);
    expect(document.body.classList.contains('conci-reportes-workspace')).toBe(true);
  });

  test('Regresar a Manifiestos devuelve la sección de Conciliación', () => {
    boton.click();
    document.getElementById('btn-conci-reportes-volver').click();
    expect(conciliacion.classList.contains('active')).toBe(true);
    expect(reportes.classList.contains('active')).toBe(false);
    expect(document.body.classList.contains('conci-reportes-abierto')).toBe(false);
    expect(document.body.classList.contains('conci-reportes-workspace')).toBe(false);
  });

  test('al regresar se restaura el modo pantalla completa', () => {
    const restaurar = jest.fn(() => document.body.classList.add('conci-manifest-workspace'));
    window._conciUpdateWorkspaceMode = restaurar;
    boton.click();
    document.getElementById('btn-conci-reportes-volver').click();
    expect(restaurar).toHaveBeenCalled();
    expect(document.body.classList.contains('conci-manifest-workspace')).toBe(true);
    delete window._conciUpdateWorkspaceMode;
  });

  test('Conciliación no se destruye: su contenido sigue en el DOM', () => {
    boton.click();
    expect(document.getElementById('btn-conci-reportes')).not.toBeNull();
  });

  test('el botón Menú sale del módulo, no regresa a Manifiestos', () => {
    const salir = jest.fn();
    window._navdeckShowMenu = salir;
    boton.click();
    document.getElementById('btn-conci-reportes-menu').click();
    expect(salir).toHaveBeenCalled();
    expect(reportes.classList.contains('active')).toBe(false);
    expect(conciliacion.classList.contains('active')).toBe(false);
    // Sin esto el encabezado y la barra lateral quedarían ocultos en el menú.
    expect(document.body.classList.contains('conci-reportes-workspace')).toBe(false);
    delete window._navdeckShowMenu;
  });

  test('Esc regresa a Manifiestos solo desde Reportes', () => {
    // Con Reportes cerrado, Esc es de la captura por celda: no debe navegar.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(conciliacion.classList.contains('active')).toBe(true);

    boton.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(reportes.classList.contains('active')).toBe(false);
    expect(conciliacion.classList.contains('active')).toBe(true);
  });

  test('irse por el menú lateral limpia la marca del body', async () => {
    boton.click();
    // showSection es quien apaga las secciones; aquí se simula su efecto.
    reportes.classList.remove('active');
    document.querySelector('.menu-item').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.body.classList.contains('conci-reportes-abierto')).toBe(false);
  });

  test('window.conciReportes expone la API', () => {
    expect(typeof window.conciReportes.abrir).toBe('function');
    expect(typeof window.conciReportes.cerrar).toBe('function');
    expect(typeof window.conciReportes.alternar).toBe('function');
    expect(typeof window.conciReportes.abiertos).toBe('function');
  });
});
