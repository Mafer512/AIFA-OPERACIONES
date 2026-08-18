/**
 * @jest-environment jsdom
 *
 * El nombre del compañero no es parte del dato.
 *
 * Síntoma reportado: al capturar alguien sobre una celda, su nombre se quedaba
 * pegado al valor —"TIJ-NLU-MID" con "Omar" detrás, "TIJ-NLU-MIDOmar"— sin que
 * nadie lo hubiera escrito.
 *
 * La burbuja con el nombre (.conci-remote-badge) es un <span> HIJO del <td>. Se
 * ve flotando en la esquina gracias al CSS, pero para el DOM es contenido de la
 * celda: td.textContent devuelve el dato Y el nombre pegados.
 *
 * El preview en vivo guardaba td.textContent como "valor original" antes de
 * pintar lo que el compañero iba tecleando y, al terminar, restauraba esa
 * cadena ya contaminada. El nombre se quedaba dentro del dato.
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

const vigentes = new Map();

const api = new Function('document', 'vigentes', `
  function _conciCursoresVigentes() { return vigentes; }
  ${extraer('_conciTextoDeCelda')}
  ${extraer('_conciEscribirTextoDeCelda')}
  ${extraer('_conciFindLiveCell')}
  ${extraer('_conciRepintarFocos')}
  ${extraer('_conciHandleRemoteCellInput')}
  return {
    _conciTextoDeCelda, _conciEscribirTextoDeCelda,
    _conciRepintarFocos, _conciHandleRemoteCellInput,
  };
`)(document, vigentes);

/** Una fila con la celda de routing, tal como la pinta la tabla. */
function pintar(valor = 'TIJ-NLU-MID') {
  document.body.innerHTML = `
    <table id="table-conci-manifiestos"><tbody>
      <tr data-row-id="42">
        <td data-col="DESTINO / ORIGEN" data-raw="${valor}">${valor}</td>
      </tr>
    </tbody></table>`;
  return document.querySelector('td[data-col="DESTINO / ORIGEN"]');
}

const celda = () => document.querySelector('td[data-col="DESTINO / ORIGEN"]');
const insignia = () => celda().querySelector('.conci-remote-badge');

beforeEach(() => {
  vigentes.clear();
  document.body.innerHTML = '';
});

describe('leer y escribir el texto de una celda', () => {
  test('el texto de la celda no incluye la burbuja del compañero', () => {
    const td = pintar();
    api._conciRepintarFocos.call(null);
    vigentes.set('42|DESTINO / ORIGEN', { user: 'Omar Ruiz', color: '#e53935' });
    api._conciRepintarFocos();

    // La burbuja está puesta y textContent ya viene contaminado...
    expect(insignia().textContent).toBe('Omar');
    expect(td.textContent).toBe('TIJ-NLU-MIDOmar');
    // ...pero el texto propio de la celda sigue limpio.
    expect(api._conciTextoDeCelda(td)).toBe('TIJ-NLU-MID');
  });

  test('escribir el texto no borra la burbuja', () => {
    const td = pintar();
    vigentes.set('42|DESTINO / ORIGEN', { user: 'Omar', color: '#e53935' });
    api._conciRepintarFocos();

    api._conciEscribirTextoDeCelda(td, 'TIJ-NLU-GDL');

    expect(api._conciTextoDeCelda(td)).toBe('TIJ-NLU-GDL');
    expect(insignia()).not.toBeNull();
  });
});

describe('el preview en vivo del compañero', () => {
  test('guarda el valor original sin el nombre pegado', () => {
    const td = pintar();
    vigentes.set('42|DESTINO / ORIGEN', { user: 'Omar', color: '#e53935' });
    api._conciRepintarFocos();

    api._conciHandleRemoteCellInput({ rowId: '42', col: 'DESTINO / ORIGEN', value: 'TIJ' });

    expect(td.dataset.conciLivePreviewOrig).toBe('TIJ-NLU-MID');
  });

  test('al soltar la celda, el dato vuelve limpio: sin el nombre', () => {
    const td = pintar();
    vigentes.set('42|DESTINO / ORIGEN', { user: 'Omar', color: '#e53935' });
    api._conciRepintarFocos();

    // El compañero teclea y luego suelta la celda.
    api._conciHandleRemoteCellInput({ rowId: '42', col: 'DESTINO / ORIGEN', value: 'TIJ-NLU' });
    vigentes.clear();
    api._conciRepintarFocos();

    // Esto es el fallo reportado, medido: antes quedaba "TIJ-NLU-MIDOmar".
    expect(td.textContent).toBe('TIJ-NLU-MID');
    expect(td.textContent).not.toContain('Omar');
    expect(insignia()).toBeNull();
    expect(td.dataset.conciLivePreviewOrig).toBeUndefined();
  });

  test('varias rondas de captura no van acumulando el nombre', () => {
    const td = pintar();
    for (let ronda = 0; ronda < 3; ronda++) {
      vigentes.set('42|DESTINO / ORIGEN', { user: 'Omar', color: '#e53935' });
      api._conciRepintarFocos();
      api._conciHandleRemoteCellInput({ rowId: '42', col: 'DESTINO / ORIGEN', value: `TIJ-${ronda}` });
      vigentes.clear();
      api._conciRepintarFocos();
    }
    expect(td.textContent).toBe('TIJ-NLU-MID');
  });

  test('el dato guardado en data-raw nunca se toca', () => {
    const td = pintar();
    vigentes.set('42|DESTINO / ORIGEN', { user: 'Omar', color: '#e53935' });
    api._conciRepintarFocos();
    api._conciHandleRemoteCellInput({ rowId: '42', col: 'DESTINO / ORIGEN', value: 'basura' });

    // El preview es solo pintura: el valor real de la celda no cambia, así que
    // un autoguardado que lea data-raw nunca puede mandar el nombre a la base.
    expect(td.dataset.raw).toBe('TIJ-NLU-MID');
  });
});
