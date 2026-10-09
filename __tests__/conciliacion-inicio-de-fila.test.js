/**
 * @jest-environment jsdom
 *
 * Manifiestos › "Inicio de fila": botón discreto abajo a la derecha (junto al
 * conteo de vuelos) y Ctrl + Inicio. Con una celda en captura, confirma lo
 * tecleado y salta a la primera celda de esa fila; sin celda activa, regresa
 * la tabla a la primera columna. En un campo fuera de la tabla (buscador,
 * filtros), Ctrl + Inicio es del campo.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const bloque = (inicio, fin) => {
  const a = source.indexOf(inicio);
  const b = source.indexOf(fin, a);
  if (a === -1 || b === -1) throw new Error('No se encontró el bloque.');
  return source.slice(a, b);
};

function montar({ modoCaptura = true, celdaActiva = false } = {}) {
  document.body.innerHTML = `
    <div id="conciliacion-section" class="active"><div id="pane-conci-comercial" class="active">
      <input id="buscador">
      <div id="conci-manifiestos-scroll"><table id="table-conci-manifiestos"><tbody>
        <tr><td id="primera"></td><td id="otra" class="${celdaActiva ? 'conci-cell-active' : ''}" tabindex="0"></td></tr>
      </tbody></table></div>
      <button id="btn-conci-inicio-fila"></button>
    </div></div>`;
  const wrap = document.getElementById('conci-manifiestos-scroll');
  wrap.scrollTo = jest.fn();
  const llamadas = { activar: [], visible: [] };
  const registrar = document.addEventListener.bind(document);
  const arranques = [];
  const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, o) => {
    if (tipo === 'DOMContentLoaded') arranques.push(fn); else registrar(tipo, fn, o);
  });
  new Function(
    '_conciEditMode', '_conciFirstEditableCellInRow', '_conciAsegurarCeldaVisible', '_conciActivateCellEditor',
    bloque('// La celda en captura:', "window.addEventListener('resize'")
  )(
    modoCaptura,
    () => document.getElementById('primera'),
    (td) => llamadas.visible.push(td.id),
    (td) => llamadas.activar.push(td.id),
  );
  espia.mockRestore();
  arranques.forEach(fn => fn());
  return { wrap, llamadas };
}
const ctrlInicio = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true, cancelable: true }));

describe('Inicio de fila', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('el botón está abajo, junto al conteo de vuelos', () => {
    const i = html.indexOf('id="btn-conci-inicio-fila"');
    expect(i).toBeGreaterThan(html.indexOf('id="table-conci-manifiestos"'));
    expect(Math.abs(html.indexOf('id="conci-conteo-filas"') - i)).toBeLessThan(600);
  });

  test('sin celda activa, el botón regresa la tabla a la primera columna', () => {
    const { wrap } = montar();
    document.getElementById('btn-conci-inicio-fila').click();
    expect(wrap.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  test('con una celda en captura, Ctrl + Inicio va a la primera celda de esa fila y regresa la tabla', () => {
    const { llamadas, wrap } = montar({ celdaActiva: true });
    document.getElementById('otra').focus();
    ctrlInicio();
    expect(llamadas.activar).toEqual(['primera']);
    // FECHA es columna fija: abrirla no desplaza la tabla, hay que regresarla.
    expect(wrap.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  test('Ctrl + Inicio funciona aunque no haya una celda seleccionada (no se traba)', () => {
    const { wrap } = montar({ modoCaptura: false });
    ctrlInicio();
    expect(wrap.scrollTo).toHaveBeenCalled();
  });

  function montarEnEdicion(valido) {
    document.body.innerHTML = `
      <div id="conciliacion-section" class="active"><div id="pane-conci-comercial" class="active">
        <div id="conci-manifiestos-scroll"><table id="table-conci-manifiestos"><tbody>
          <tr><td id="arriba-primera"></td><td id="rezagada" class="conci-cell-active"></td></tr>
          <tr><td id="primera"></td><td id="editando" class="conci-cell-active"><input id="hora" value="21:00"></td></tr>
        </tbody></table></div>
      </div></div>`;
    const wrap = document.getElementById('conci-manifiestos-scroll');
    wrap.scrollTo = jest.fn();
    const cerradas = [];
    document.getElementById('editando')._conciCloseEditor = (aceptar, mover) => { cerradas.push([aceptar, mover]); return valido; };
    const registrar = document.addEventListener.bind(document);
    const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, o) => {
      if (tipo !== 'DOMContentLoaded') registrar(tipo, fn, o);
    });
    new Function('_conciEditMode', '_conciFirstEditableCellInRow', '_conciAsegurarCeldaVisible', '_conciActivateCellEditor',
      bloque('// La celda en captura:', "window.addEventListener('resize'"))(true, () => null, () => {}, () => {});
    espia.mockRestore();
    document.getElementById('hora').focus();
    return { wrap, cerradas };
  }

  test('en edición (campo de hora dentro de la celda) va al inicio de ESA fila, aunque haya otra marca rezagada', () => {
    const { wrap, cerradas } = montarEnEdicion(true);
    ctrlInicio();
    // Confirma lo tecleado en la celda que se edita y salta al inicio de su fila.
    // (Las pruebas anteriores dejaron su propio atajo registrado en el
    // documento; en la app hay uno solo. Todas deben hacer lo mismo.)
    expect(cerradas.length).toBeGreaterThan(0);
    expect(new Set(cerradas.map(String))).toEqual(new Set(['true,row-start']));
    // Y la tabla vuelve a la primera columna (FECHA es fija, no la desplaza sola).
    expect(wrap.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  test('en edición con una hora inválida, el editor se queda y la tabla no se mueve', () => {
    const { wrap, cerradas } = montarEnEdicion(false);
    ctrlInicio();
    expect(cerradas.length).toBeGreaterThan(0);
    expect(wrap.scrollTo).not.toHaveBeenCalled();
  });

  test('en el buscador, Ctrl + Inicio es del campo', () => {
    const { wrap } = montar();
    document.getElementById('buscador').focus();
    ctrlInicio();
    expect(wrap.scrollTo).not.toHaveBeenCalled();
  });
});
