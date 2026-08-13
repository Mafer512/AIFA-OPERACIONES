/**
 * @jest-environment jsdom
 *
 * Navegar con las flechas no debe apoderarse del scroll.
 *
 * Bajando rápido con la flecha, al pasar del último renglón a la vista la tabla
 * se iba de lado sola. La causa: scrollIntoView, incluso pidiendo "nearest" en
 * los dos ejes, decide por su cuenta y mueve los dos. Con las columnas fijas eso
 * se volvió un problema, porque una celda que queda por debajo de ellas cuenta
 * como no visible y el navegador desplaza en HORIZONTAL para revelarla.
 *
 * Ahora el desplazamiento se calcula a mano y por eje.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const api = new Function('document', `
  ${extraer('_conciAnchoColumnasFijas')}
  ${extraer('_conciAsegurarCeldaVisible')}
  return { _conciAsegurarCeldaVisible };
`)(document);

/**
 * Monta un contenedor con medidas controladas.
 * El marco ocupa de 0 a 500 en horizontal y de 0 a 300 en vertical.
 * El encabezado tapa 40 px arriba; las columnas fijas, 120 px a la izquierda.
 */
function montar({ celda, esFija = false }) {
  document.body.innerHTML = `
    <div id="conci-manifiestos-scroll">
      <table id="table-conci-manifiestos">
        <thead><tr>
          <th class="conci-col-fija" data-conci-column-key="FECHA"></th>
          <th class="conci-col-fija" data-conci-column-key="AEROLINEA"></th>
          <th data-conci-column-key="TOTAL PAX"></th>
        </tr></thead>
        <tbody><tr data-row-id="1"><td data-col="TOTAL PAX"></td></tr></tbody>
      </table>
    </div>`;

  const cont = document.getElementById('conci-manifiestos-scroll');
  cont.scrollTop = 0;
  cont.scrollLeft = 0;
  cont.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 500 });

  const thead = cont.querySelector('thead');
  thead.getBoundingClientRect = () => ({ height: 40 });
  const fijas = [...cont.querySelectorAll('th.conci-col-fija')];
  fijas.forEach(th => { th.getBoundingClientRect = () => ({ width: 60 }); });  // 120 en total

  const td = cont.querySelector('td');
  if (esFija) td.classList.add('conci-col-fija');
  td.getBoundingClientRect = () => celda;
  return { cont, td };
}

describe('moverse en vertical no toca el scroll horizontal', () => {
  test('una celda por debajo del marco solo mueve el alto', () => {
    // Está fuera por abajo Y tapada por las columnas fijas: antes esto último
    // hacía que el navegador se fuera de lado.
    const { cont, td } = montar({ celda: { top: 320, bottom: 350, left: 20, right: 100 } });
    api._conciAsegurarCeldaVisible(td, 'vertical');

    expect(cont.scrollTop).toBe(50);    // 350 - 300
    expect(cont.scrollLeft).toBe(0);    // intacto
  });

  test('una celda por encima se acomoda debajo del encabezado fijo', () => {
    const { cont, td } = montar({ celda: { top: 10, bottom: 40, left: 200, right: 300 } });
    api._conciAsegurarCeldaVisible(td, 'vertical');

    // El encabezado tapa 40 px: hay que subir hasta quedar por debajo.
    expect(cont.scrollTop).toBe(-30);
    expect(cont.scrollLeft).toBe(0);
  });

  test('una celda ya visible no mueve nada', () => {
    const { cont, td } = montar({ celda: { top: 100, bottom: 130, left: 200, right: 300 } });
    api._conciAsegurarCeldaVisible(td, 'vertical');

    expect(cont.scrollTop).toBe(0);
    expect(cont.scrollLeft).toBe(0);
  });
});

describe('moverse en horizontal no toca el scroll vertical', () => {
  test('una celda fuera por la derecha solo mueve el ancho', () => {
    const { cont, td } = montar({ celda: { top: 100, bottom: 130, left: 480, right: 560 } });
    api._conciAsegurarCeldaVisible(td, 'horizontal');

    expect(cont.scrollLeft).toBe(60);   // 560 - 500
    expect(cont.scrollTop).toBe(0);
  });

  test('una celda escondida bajo las columnas fijas sale de debajo', () => {
    // Sin descontar las columnas fijas, el cursor quedaba tapado por ellas.
    const { cont, td } = montar({ celda: { top: 100, bottom: 130, left: 40, right: 140 } });
    api._conciAsegurarCeldaVisible(td, 'horizontal');

    expect(cont.scrollLeft).toBe(-80);  // 40 - 120
    expect(cont.scrollTop).toBe(0);
  });

  test('una columna fija nunca necesita desplazamiento', () => {
    const { cont, td } = montar({
      celda: { top: 100, bottom: 130, left: 0, right: 60 }, esFija: true,
    });
    api._conciAsegurarCeldaVisible(td, 'horizontal');

    expect(cont.scrollLeft).toBe(0);
    expect(cont.scrollTop).toBe(0);
  });
});

describe('Tab sí ajusta los dos ejes', () => {
  test('porque cambia de columna y de fila a la vez', () => {
    const { cont, td } = montar({ celda: { top: 320, bottom: 350, left: 480, right: 560 } });
    api._conciAsegurarCeldaVisible(td, 'ambos');

    expect(cont.scrollTop).toBe(50);
    expect(cont.scrollLeft).toBe(60);
  });
});

describe('robustez', () => {
  test('sin contenedor no revienta', () => {
    document.body.innerHTML = '';
    expect(() => api._conciAsegurarCeldaVisible(null, 'vertical')).not.toThrow();
  });

  test('una celda desconectada del documento se ignora', () => {
    montar({ celda: { top: 0, bottom: 0, left: 0, right: 0 } });
    const suelta = document.createElement('td');
    expect(() => api._conciAsegurarCeldaVisible(suelta, 'vertical')).not.toThrow();
  });
});

describe('integración en el módulo', () => {
  test('la navegación ya no usa scrollIntoView', () => {
    // Era quien decidía por su cuenta mover los dos ejes.
    expect(source).not.toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })");
  });

  test('las flechas verticales piden solo el eje vertical', () => {
    const abajo = source.slice(
      source.indexOf('function _conciFocusBelow'),
      source.indexOf('\n}\n', source.indexOf('function _conciFocusBelow'))
    );
    expect(abajo).toContain("_conciAsegurarCeldaVisible(below, 'vertical')");
  });

  test('las flechas laterales piden solo el eje horizontal', () => {
    const mover = source.slice(
      source.indexOf('function _conciMoveFromCell'),
      source.indexOf('\n}\n', source.indexOf('function _conciMoveFromCell'))
    );
    expect(mover).toContain("_conciAsegurarCeldaVisible(target, 'horizontal')");
  });

  test('la tecla se sigue consumiendo para que el contenedor no desplace solo', () => {
    const manejador = source.slice(source.indexOf('function _conciHandleGridArrowNavigation'));
    expect(manejador.slice(0, 1200)).toContain('ev.preventDefault();');
  });
});
