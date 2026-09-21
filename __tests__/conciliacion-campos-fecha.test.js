/**
 * @jest-environment jsdom
 *
 * Formato fijo dd/mm/aaaa en los filtros de fecha.
 *
 * Eran <input type="date"> nativos, y el formato que muestra ese control no lo
 * decide la página: lo decide el idioma del navegador. En un equipo en español
 * se ve 11/08/2026 y en uno en inglés el MISMO campo muestra 08/11/2026. Para
 * un módulo donde la fecha define a qué día pertenece un manifiesto, esa
 * ambigüedad es un riesgo real.
 *
 * El <input type="date"> se conserva oculto como fuente de verdad en ISO, para
 * que todo el código que lo lee o escribe siga igual.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const api = new Function('document', 'HTMLInputElement', 'Event', `
  ${extraer('_conciPad2')}
  ${extraer('_conciIsValidCalendarDate')}
  ${extraer('_conciFormatDateMask')}
  ${extraer('_conciMaskedDateToIso')}
  ${extraer('_conciIsoToMaskedDate')}
  ${extraer('_conciExpandDateMaskYear')}
  ${extraer('_conciSincronizarCampoFecha')}
  ${extraer('_conciInterceptarValorIso')}
  ${extraer('_conciAplicarFechaMask')}
  ${extraer('_conciInitCamposFecha')}
  return { _conciInitCamposFecha, _conciIsoToMaskedDate, _conciMaskedDateToIso };
`)(document, window.HTMLInputElement, window.Event);

function montar(id = 'filter-conci-fecha-desde', valorIso = '') {
  document.body.innerHTML = `
    <input type="text" data-conci-fecha-para="${id}" class="conci-fecha-mask">
    <button type="button" data-conci-fecha-para="${id}"></button>
    <input type="date" id="${id}" class="conci-fecha-iso" value="${valorIso}">`;
  api._conciInitCamposFecha(document);
  return {
    mask: document.querySelector(`input[data-conci-fecha-para="${id}"]`),
    boton: document.querySelector(`button[data-conci-fecha-para="${id}"]`),
    iso: document.getElementById(id),
  };
}

const teclear = (mask, texto) => {
  mask.value = texto;
  mask.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('lo que se ve', () => {
  test('un valor ya cargado se muestra en dd/mm/aaaa', () => {
    const { mask } = montar('filter-conci-fecha-desde', '2026-08-11');
    expect(mask.value).toBe('11/08/2026');
  });

  test('sin valor, el campo queda vacío', () => {
    const { mask } = montar();
    expect(mask.value).toBe('');
  });

  test('el campo real sigue siendo type=date con el valor en ISO', () => {
    const { iso } = montar('filter-conci-fecha-desde', '2026-08-11');
    expect(iso.type).toBe('date');
    expect(iso.value).toBe('2026-08-11');
  });
});

describe('al teclear', () => {
  test('se da forma sola mientras se escribe', () => {
    const { mask } = montar();
    teclear(mask, '11');
    expect(mask.value).toBe('11');
    teclear(mask, '1108');
    expect(mask.value).toBe('11/08');
  });

  test('una fecha completa se lleva al campo real en ISO', () => {
    const { mask, iso } = montar();
    teclear(mask, '11/08/2026');
    expect(iso.value).toBe('2026-08-11');
  });

  test('el año de dos dígitos se completa al confirmar', () => {
    const { mask, iso } = montar();
    teclear(mask, '110826');
    mask.dispatchEvent(new Event('blur'));
    expect(mask.value).toBe('11/08/2026');
    expect(iso.value).toBe('2026-08-11');
  });

  test('una fecha incompleta no mueve el filtro', () => {
    const { mask, iso } = montar('filter-conci-fecha-desde', '2026-08-11');
    teclear(mask, '11/0');
    expect(iso.value).toBe('2026-08-11');
  });

  test('una fecha imposible no mueve el filtro', () => {
    const { mask, iso } = montar('filter-conci-fecha-desde', '2026-08-11');
    teclear(mask, '32/13/2026');
    expect(iso.value).toBe('2026-08-11');
  });

  test('vaciar el campo vacía el filtro — es el rango de un solo día', () => {
    const { mask, iso } = montar('filter-conci-fecha-hasta', '2026-08-15');
    teclear(mask, '');
    mask.dispatchEvent(new Event('blur'));
    expect(iso.value).toBe('');
  });

  test('confirmar avisa a quien escuche el campo real', () => {
    const { mask, iso } = montar();
    const escucha = jest.fn();
    iso.addEventListener('change', escucha);
    teclear(mask, '11/08/2026');
    expect(escucha).toHaveBeenCalled();
  });
});

describe('escrituras por código', () => {
  test('asignar el valor del campo real actualiza lo que se ve', () => {
    // Es lo que hace _conciApplyTodayFilters al abrir la pestaña.
    const { mask, iso } = montar();
    iso.value = '2026-08-11';
    expect(mask.value).toBe('11/08/2026');
  });

  test('vaciarlo por código también se refleja', () => {
    const { mask, iso } = montar('filter-conci-fecha-hasta', '2026-08-15');
    expect(mask.value).toBe('15/08/2026');
    iso.value = '';
    expect(mask.value).toBe('');
  });

  test('leer el valor sigue devolviendo ISO', () => {
    const { iso } = montar();
    iso.value = '2026-12-31';
    expect(iso.value).toBe('2026-12-31');
  });

  test('elegir en el calendario actualiza lo que se ve', () => {
    // El calendario nativo escribe por dentro y dispara "change".
    const { mask, iso } = montar();
    iso.setAttribute('value', '2026-09-01');
    iso.value = '2026-09-01';
    iso.dispatchEvent(new Event('change'));
    expect(mask.value).toBe('01/09/2026');
  });
});

describe('marcado en la página', () => {
  const campos = ['filter-conci-fecha-desde', 'filter-conci-fecha-hasta', 'filter-itinerary-date'];

  test.each(campos)('%s tiene campo con máscara, botón de calendario y campo ISO', (id) => {
    expect(html).toContain(`data-conci-fecha-para="${id}"`);
    expect(html).toContain(`<input type="date" id="${id}" class="conci-fecha-iso"`);
  });

  test('los tres campos muestran dd/mm/aaaa como pista', () => {
    const pistas = html.match(/placeholder="dd\/mm\/aaaa"/g) || [];
    expect(pistas.length).toBeGreaterThanOrEqual(campos.length);
  });

  test('ya no quedan filtros de fecha nativos a la vista en esos módulos', () => {
    // El type=date que queda es el oculto; no debe haber uno visible con ese id.
    campos.forEach(id => {
      const visibles = html.match(new RegExp(`<input type="date"[^>]*id="${id}"(?![^>]*conci-fecha-iso)`, 'g'));
      expect(visibles).toBeNull();
    });
  });

  test('se inicializa al arrancar el módulo', () => {
    expect(source).toContain('_conciInitCamposFecha(document);');
  });
});
