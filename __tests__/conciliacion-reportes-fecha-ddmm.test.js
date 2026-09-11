/**
 * @jest-environment jsdom
 *
 * "Fecha del reporte" se ve dd/mm/aaaa en Carga y en Pasajeros.
 *
 * El <input type="date"> nativo muestra la fecha en el orden del idioma del
 * navegador: en uno en inglés, el 10 de septiembre sale 09/10/2026. Los dos
 * filtros usan ahora la máscara de Manifiestos: un campo de texto dd/mm/aaaa
 * delante y el campo de fecha real, en ISO, detrás. El código de los reportes
 * sigue leyendo .value en ISO sin enterarse.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

function extraer(nombre) {
  const inicio = source.indexOf(`function ${nombre}(`);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const CAMPOS = ['conci-rep-pax-fecha', 'conci-rep-carga-fecha'];

describe.each(CAMPOS)('el filtro %s', id => {
  test('el campo de fecha real queda oculto detrás, como en Manifiestos', () => {
    expect(html).toMatch(new RegExp(`<input type="date" id="${id}" class="conci-fecha-iso"`));
    expect(html).not.toMatch(new RegExp(`<input type="date" class="form-control[^"]*" id="${id}"`));
  });

  test('lo que se ve es un campo dd/mm/aaaa con su calendario', () => {
    expect(html).toMatch(new RegExp(`<input type="text" class="[^"]*conci-fecha-mask" id="${id}-texto" data-conci-fecha-para="${id}"`));
    expect(html).toMatch(new RegExp(`<button class="[^"]*conci-fecha-calendario" type="button" data-conci-fecha-para="${id}"`));
    expect(html).toContain(`for="${id}-texto"`);
  });
});

test('ambos módulos montan la máscara al arrancar', () => {
  for (const archivo of ['conci-reportes-pasajeros.js', 'conci-reportes-carga.js']) {
    expect(fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8')).toContain('window._conciInitCamposFecha(');
  }
});

describe('la máscara con el marcado real', () => {
  let api;

  beforeEach(() => {
    const inicio = html.indexOf('<div class="input-group input-group-sm" style="width:auto">\n', html.indexOf('id="conci-rep-pax-fecha-texto"') - 600);
    const fin = html.indexOf('</div>', html.indexOf('id="conci-rep-pax-fecha"')) + 6;
    document.body.innerHTML = html.slice(inicio, fin);
    api = new Function(`
      ${['_conciPad2', '_conciIsValidCalendarDate', '_conciFormatDateMask', '_conciMaskedDateToIso', '_conciIsoToMaskedDate', '_conciExpandDateMaskYear',
        '_conciSincronizarCampoFecha', '_conciInterceptarValorIso', '_conciAplicarFechaMask', '_conciInitCamposFecha']
        .map(extraer).join('\n')}
      return { _conciInitCamposFecha };
    `)();
    api._conciInitCamposFecha(document);
  });

  test('una fecha puesta por código se ve día/mes/año', () => {
    document.getElementById('conci-rep-pax-fecha').value = '2026-09-10';
    expect(document.getElementById('conci-rep-pax-fecha-texto').value).toBe('10/09/2026');
  });

  test('lo que se teclea en dd/mm/aaaa llega al campo real en ISO', () => {
    const texto = document.getElementById('conci-rep-pax-fecha-texto');
    const cambios = jest.fn();
    document.getElementById('conci-rep-pax-fecha').addEventListener('change', cambios);
    texto.value = '01/09/2026';
    texto.dispatchEvent(new Event('input'));
    expect(document.getElementById('conci-rep-pax-fecha').value).toBe('2026-09-01');
    // Los reportes escuchan "change" para olvidar lo descargado de otra fecha.
    expect(cambios).toHaveBeenCalled();
  });
});
