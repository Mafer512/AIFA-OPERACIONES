/**
 * @jest-environment jsdom
 *
 * Manifiestos > Reportes: el botón, la vista y sus dos apartados.
 *
 * El botón "Reportes" vive en la barra de Conciliación Manifiestos, a la
 * izquierda del selector de periodo, y abre una vista dividida en dos
 * apartados por pestañas: Carga y Pasajeros. La tabla no se destruye, solo se
 * oculta, de modo que la captura en curso sobrevive al ir y volver.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const moduloReportes = fs.readFileSync(path.join(raiz, 'js', 'conci-reportes.js'), 'utf8');

/** Recorta el marcado de la pestaña Manifiestos, que es donde vive todo esto. */
function paneManifiestos() {
  const inicio = html.indexOf('id="pane-conci-comercial"');
  const fin = html.indexOf('/pane-conci-comercial', inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(inicio);
  return html.slice(inicio, fin);
}

describe('marcado de index.html', () => {
  const pane = paneManifiestos();

  test('el botón Reportes está en la barra de Manifiestos', () => {
    expect(pane).toContain('id="btn-conci-reportes"');
    expect(pane).toMatch(/id="btn-conci-reportes"[\s\S]*?>\s*Reportes\s*</);
  });

  test('el botón queda a la izquierda del primer campo de fecha', () => {
    const posBoton = pane.indexOf('id="btn-conci-reportes"');
    const posFecha = pane.indexOf('data-conci-fecha-para="filter-conci-fecha-desde"');
    expect(posBoton).toBeGreaterThan(-1);
    expect(posFecha).toBeGreaterThan(-1);
    expect(posBoton).toBeLessThan(posFecha);
  });

  test('la vista de reportes nace oculta y hermana de la tabla', () => {
    expect(pane).toContain('id="conci-manifiestos-tabla-view"');
    expect(pane).toMatch(/id="conci-reportes-view"/);
    const vista = pane.slice(pane.indexOf('id="conci-reportes-view"') - 200, pane.indexOf('id="conci-reportes-view"') + 40);
    expect(vista).toContain('d-none');
  });

  test('los dos apartados son Carga y Pasajeros, en ese orden', () => {
    const tabs = pane.slice(pane.indexOf('id="conci-reportes-tabs"'), pane.indexOf('conci-reportes-tab-content'));
    expect(tabs).toContain('id="tab-conci-rep-carga"');
    expect(tabs).toContain('id="tab-conci-rep-pasajeros"');
    expect(tabs.indexOf('tab-conci-rep-carga')).toBeLessThan(tabs.indexOf('tab-conci-rep-pasajeros'));
    expect(tabs).toMatch(/>\s*Carga\s*</);
    expect(tabs).toMatch(/>\s*Pasajeros\s*</);
  });

  test('cada apartado tiene su panel', () => {
    expect(pane).toContain('id="pane-conci-rep-carga"');
    expect(pane).toContain('id="pane-conci-rep-pasajeros"');
  });

  test('index.html carga el módulo de reportes', () => {
    expect(html).toContain('js/conci-reportes.js');
  });
});

describe('comportamiento de la vista', () => {
  let tabla;
  let vista;
  let boton;

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = `
      <div id="conci-manifiestos-tabla-view">
        <button id="btn-conci-reportes" type="button">Reportes</button>
      </div>
      <div id="conci-reportes-view" class="d-none">
        <button id="btn-conci-reportes-volver" type="button">Regresar a Manifiestos</button>
      </div>
      <button id="tab-conci-itinerario"></button>
      <button id="tab-conci-estadistica"></button>
    `;

    jest.isolateModules(() => {
      // El módulo se engancha en DOMContentLoaded; en jsdom se dispara a mano.
      new Function(moduloReportes)();
      document.dispatchEvent(new Event('DOMContentLoaded'));
    });

    tabla = document.getElementById('conci-manifiestos-tabla-view');
    vista = document.getElementById('conci-reportes-view');
    boton = document.getElementById('btn-conci-reportes');
  });

  test('el clic en Reportes intercambia tabla por reportes', () => {
    boton.click();
    expect(vista.classList.contains('d-none')).toBe(false);
    expect(tabla.classList.contains('d-none')).toBe(true);
    expect(document.body.classList.contains('conci-reportes-abierto')).toBe(true);
  });

  test('Regresar a Manifiestos deja la tabla como estaba', () => {
    boton.click();
    document.getElementById('btn-conci-reportes-volver').click();
    expect(vista.classList.contains('d-none')).toBe(true);
    expect(tabla.classList.contains('d-none')).toBe(false);
    expect(document.body.classList.contains('conci-reportes-abierto')).toBe(false);
  });

  test('la tabla se oculta, no se destruye: el botón sigue en el DOM', () => {
    boton.click();
    expect(document.getElementById('btn-conci-reportes')).not.toBeNull();
  });

  test('Esc cierra los reportes solo cuando están abiertos', () => {
    // Cerrados: Esc es de la captura por celda, aquí no debe hacer nada.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tabla.classList.contains('d-none')).toBe(false);

    boton.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(vista.classList.contains('d-none')).toBe(true);
    expect(tabla.classList.contains('d-none')).toBe(false);
  });

  test('cambiar de pestaña en Conciliación cierra los reportes', () => {
    boton.click();
    document.getElementById('tab-conci-estadistica').dispatchEvent(new Event('shown.bs.tab'));
    expect(vista.classList.contains('d-none')).toBe(true);
    expect(tabla.classList.contains('d-none')).toBe(false);
  });

  test('window.conciReportes expone la API', () => {
    expect(typeof window.conciReportes.abrir).toBe('function');
    expect(typeof window.conciReportes.cerrar).toBe('function');
    expect(typeof window.conciReportes.alternar).toBe('function');
  });
});
