/**
 * Conciliación › Manifiestos a cualquier ancho.
 *
 * Al angostar la ventana la zona de arriba de la tabla se veía mal: por debajo
 * de 992 px cada franja se forzaba a una sola línea que se deslizaba de lado,
 * pero sus botones sí podían encogerse (el texto se partía en tres líneas, el
 * selector de fechas se apilaba y las pastillas caían en columna encima de las
 * fichas); y entre 992 y ~1300 px la franja de filtros no bajaba de renglón y
 * apretaba sus botones hasta partirles el texto.
 *
 * Ahora las tres franjas (herramientas; conteos y resumen; filtros con exportar
 * y capturar) conservan su orden a cualquier ancho y lo que no cabe baja
 * completo al renglón siguiente, como en pantalla completa.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

const seccion = css.slice(
  css.indexOf('Conciliación › Manifiestos a cualquier ancho.'),
  css.indexOf('/* Modales y offcanvas nunca exceden el viewport disponible. */')
);

/** El bloque de una media query dentro de la sección (termina en "}" al margen). */
function media(consulta) {
  const inicio = seccion.indexOf(`@media ${consulta} {`);
  if (inicio < 0) throw new Error(`No se encontró @media ${consulta}`);
  return seccion.slice(inicio, seccion.indexOf('\n}', inicio) + 2);
}

/** Cuerpo de la regla cuyo selector es exactamente el dado (no el final de una
 *  lista de selectores separados por comas), dentro de un bloque. */
function cuerpo(bloque, selector) {
  for (let desde = 0; ;) {
    const inicio = bloque.indexOf(`${selector} {`, desde);
    if (inicio < 0) return null;
    if (!/,\s*$/.test(bloque.slice(0, inicio))) {
      return bloque.slice(bloque.indexOf('{', inicio) + 1, bloque.indexOf('}', inicio));
    }
    desde = inicio + 1;
  }
}

describe('Conciliación › Manifiestos a cualquier ancho', () => {
  test('ninguna franja se fuerza a una sola línea con desplazamiento lateral', () => {
    // Las reglas de las franjas mismas (no las de lo que llevan dentro, como
    // el selector de fechas, que sí debe ir en una línea).
    const deFranja = (parte) => /\.conci-manifest-(toolbar|filters)( > (\*|div))?$/.test(parte.trim());
    const reglas = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => selector.split(',').some(deFranja));
    expect(reglas.length).toBeGreaterThan(0);
    reglas.forEach(([, , declaraciones]) => {
      expect(declaraciones).not.toMatch(/flex-wrap:\s*nowrap/);
      expect(declaraciones).not.toMatch(/overflow-x:\s*auto/);
    });
  });

  test('los controles no se encogen: si no caben, bajan completos de renglón', () => {
    expect(seccion).toMatch(/body\.conci-manifest-workspace \.conci-manifest-toolbar,\s*body\.conci-manifest-workspace \.conci-manifest-filters > div,\s*body\.conci-manifest-workspace \.conci-manifest-acciones \{\s*flex-wrap: wrap !important;/);
    const sinEncoger = seccion.match(/body\.conci-manifest-workspace \.conci-manifest-toolbar > div:first-child,[^{]*\{([^}]*)\}/);
    expect(sinEncoger[0]).toContain('.conci-manifest-toolbar .btn,');
    expect(sinEncoger[0]).toContain('.conci-manifest-filters .dropdown');
    expect(sinEncoger[1]).toMatch(/flex-shrink: 0;/);
    expect(sinEncoger[1]).toMatch(/white-space: nowrap;/);
    // El selector de fechas ya no se apila.
    expect(seccion).toMatch(/\.conci-manifest-toolbar \.input-group,\s*body\.conci-manifest-workspace \.conci-manifest-filters \.input-group \{\s*flex-wrap: nowrap;/);
    // Los botones de la barra van juntos desde la izquierda, sin huecos entre ellos.
    expect(cuerpo(seccion, 'body.conci-manifest-workspace .conci-manifest-toolbar')).toMatch(/justify-content: flex-start !important;/);
  });

  test('exportar y capturar van juntos y, si bajan de renglón, a la derecha', () => {
    const inicio = html.indexOf('<div class="conci-manifest-acciones">');
    const fin = html.indexOf('</div><!-- /conci-manifest-acciones -->');
    expect(inicio).toBeGreaterThan(html.indexOf('id="btn-conci-clear-filters"'));
    const grupo = html.slice(inicio, fin);
    const ids = ['dropdownExportConci', 'btn-conci-export-por-capturista', 'btn-conci-manifiestos-capturados', 'dropdownCapturarManifiestos'];
    const posiciones = ids.map((id) => grupo.indexOf(`id="${id}"`));
    posiciones.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    const acciones = cuerpo(seccion, 'body.conci-manifest-workspace .conci-manifest-acciones');
    expect(acciones).toMatch(/justify-content: flex-end;/);
    expect(acciones).toMatch(/margin-left: auto;/);
  });

  test('las fichas del resumen bajan a su propio renglón y se reparten el ancho', () => {
    const angosta = media('(max-width: 1279.98px)');
    const franja = cuerpo(angosta, '   body.conci-manifest-workspace #manifiestos-summary-strip');
    expect(franja).toMatch(/flex: 1 1 100%;/);
    expect(franja).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(cuerpo(media('(max-width: 699.98px)'), '   body.conci-manifest-workspace #manifiestos-summary-strip'))
      .toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // Más angosta aún, las pastillas en rejilla de tres y la franja a lo ancho.
    const telefono = media('(max-width: 639.98px)');
    expect(cuerpo(telefono, '   body.conci-manifest-workspace .conci-manifest-filters > div:first-child'))
      .toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(cuerpo(telefono, '   body.conci-manifest-workspace #manifiestos-summary-strip')).toMatch(/grid-column: 1 \/ -1;/);
  });

  test('en una ventana chica la página baja con el scroll y la tabla conserva casi toda la pantalla', () => {
    const chica = media('(max-width: 767.98px)');
    expect(cuerpo(chica, '   body.conci-manifest-workspace:not(.conci-itinerary-workspace) #conciliacion-section.active'))
      .toMatch(/overflow-y: auto;/);
    const tabla = cuerpo(chica, '   body.conci-manifest-workspace:not(.conci-itinerary-workspace) #conci-manifiestos-scroll');
    expect(tabla).toMatch(/height: calc\(100dvh - [\d.]+rem\) !important;/);
    expect(tabla).toMatch(/min-height: \d+rem;/);
  });

  test('en el teléfono el botón Inicio de las pestañas siempre queda a la vista', () => {
    const telefono = media('(max-width: 575.98px)');
    const inicio = cuerpo(telefono, '   #conciliacion-tabs .conci-tabs-menu-item');
    expect(inicio).toMatch(/position: sticky;/);
    expect(inicio).toMatch(/right: 0;/);
    expect(cuerpo(telefono, '   #conciliacion-tabs .nav-link > i')).toMatch(/display: none;/);
  });

  test('en el teléfono las cifras del resumen no se agrandan', () => {
    expect(cuerpo(seccion, 'body.conci-manifest-workspace #manifiestos-summary-strip .ops-kpi-value'))
      .toMatch(/font-size: 1\.05rem !important;/);
  });
});
