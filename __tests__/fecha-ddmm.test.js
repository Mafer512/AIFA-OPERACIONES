/**
 * @jest-environment jsdom
 *
 * Campos de fecha en dd/mm/aaaa en toda la aplicación (js/fecha-ddmm.js).
 *
 * El <input type="date"> nativo muestra el formato del idioma del navegador
 * (en inglés, 12/15/2026). Cada campo recibe delante un texto dd/mm/aaaa y un
 * botón de calendario; el nativo sigue como fuente de verdad en ISO.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const fuente = fs.readFileSync(path.join(raiz, 'js', 'fecha-ddmm.js'), 'utf8');
const esperar = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  window.eval(fuente);
});

function montar(html) {
  document.body.innerHTML = html;
  window.FechaDdmm.mejorar(document.body);
}

const escribir = (campo, texto) => {
  campo.value = texto;
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
};

describe('un campo de fecha', () => {
  test('muestra dd/mm/aaaa y el nativo sigue en ISO, con el mismo ancho', () => {
    montar('<label for="f">Desde</label><input type="date" id="f" class="form-control form-control-sm" value="2026-12-15" style="width:9.5rem">');
    const iso = document.getElementById('f');
    const texto = document.querySelector('.fecha-ddmm-texto');
    expect(texto.value).toBe('15/12/2026');
    expect(texto.placeholder).toBe('dd/mm/aaaa');
    expect(texto.getAttribute('aria-label')).toContain('Desde');
    expect(iso.value).toBe('2026-12-15');
    expect(iso.type).toBe('date');
    expect(document.querySelector('.fecha-ddmm').style.width).toBe('9.5rem');
    expect(document.querySelector('.fecha-ddmm-calendario')).not.toBeNull();
    // Un form-control es de bloque: el grupo también, para que su etiqueta quede encima.
    expect(document.querySelector('.fecha-ddmm').classList.contains('fecha-ddmm-bloque')).toBe(true);
  });

  test('teclear la fecha completa escribe el ISO y avisa con change', () => {
    montar('<input type="date" id="f">');
    const iso = document.getElementById('f');
    const cambio = jest.fn();
    iso.addEventListener('change', cambio);
    const texto = document.querySelector('.fecha-ddmm-texto');
    escribir(texto, '0101202');
    expect(texto.value).toBe('01/01/202');
    expect(cambio).not.toHaveBeenCalled();
    escribir(texto, '01012026');
    expect(texto.value).toBe('01/01/2026');
    expect(iso.value).toBe('2026-01-01');
    expect(cambio).toHaveBeenCalledTimes(1);
  });

  test('al salir, un año de dos dígitos se completa', () => {
    montar('<input type="date" id="f">');
    const texto = document.querySelector('.fecha-ddmm-texto');
    escribir(texto, '150326');
    expect(document.getElementById('f').value).toBe('');
    texto.dispatchEvent(new window.Event('blur'));
    expect(document.getElementById('f').value).toBe('2026-03-15');
    expect(texto.value).toBe('15/03/2026');
  });

  test('una fecha imposible no mueve el valor y se marca para corregirla', () => {
    montar('<input type="date" id="f" value="2026-01-01">');
    const texto = document.querySelector('.fecha-ddmm-texto');
    escribir(texto, '32132026');
    texto.dispatchEvent(new window.Event('blur'));
    expect(document.getElementById('f').value).toBe('2026-01-01');
    expect(texto.classList.contains('is-invalid')).toBe(true);
  });

  test('borrar el texto limpia el valor', () => {
    montar('<input type="date" id="f" value="2026-01-01">');
    const iso = document.getElementById('f');
    const cambio = jest.fn();
    iso.addEventListener('change', cambio);
    const texto = document.querySelector('.fecha-ddmm-texto');
    escribir(texto, '');
    texto.dispatchEvent(new window.Event('blur'));
    expect(iso.value).toBe('');
    expect(cambio).toHaveBeenCalled();
  });

  test('asignar .value por código actualiza lo que se ve', () => {
    montar('<input type="date" id="f">');
    document.getElementById('f').value = '2025-07-04';
    expect(document.querySelector('.fecha-ddmm-texto').value).toBe('04/07/2025');
  });

  test('el foco que llega al nativo (por su etiqueta) pasa al texto', () => {
    montar('<input type="date" id="f">');
    document.getElementById('f').focus();
    expect(document.activeElement).toBe(document.querySelector('.fecha-ddmm-texto'));
  });

  test('deshabilitar u ocultar el nativo se refleja en lo que se ve', async () => {
    montar('<input type="date" id="f">');
    const iso = document.getElementById('f');
    iso.disabled = true;
    iso.classList.add('d-none');
    await esperar();
    expect(document.querySelector('.fecha-ddmm-texto').disabled).toBe(true);
    expect(document.querySelector('.fecha-ddmm').hidden).toBe(true);
  });
});

describe('dónde se aplica', () => {
  test('respeta los que ya traen su máscara y los editores de celda', () => {
    montar(`<input type="text" data-conci-fecha-para="x"><input type="date" id="x" class="conci-fecha-iso">
      <table><tr><td><input type="date" id="celda"></td></tr></table>
      <div data-fecha-nativa><input type="date" id="nativa"></div>`);
    ['x', 'celda', 'nativa'].forEach((id) => expect(document.getElementById(id).dataset.fechaDdmm).toBeUndefined());
    expect(document.querySelectorAll('.fecha-ddmm-texto')).toHaveLength(0);
  });

  test('los campos que llegan después también se acomodan', async () => {
    montar('<div id="host"></div>');
    document.getElementById('host').innerHTML = '<input type="date" id="tarde" value="2024-02-29">';
    await esperar();
    expect(document.getElementById('tarde').dataset.fechaDdmm).toBe('1');
    expect(document.querySelector('.fecha-ddmm-texto').value).toBe('29/02/2024');
  });

  test('dentro de un input-group, el texto y el botón quedan como piezas del grupo', () => {
    montar('<div class="input-group" id="g"><span class="input-group-text">De</span><input type="date" id="f" class="form-control"></div>');
    const hijos = [...document.getElementById('g').children].map((el) => el.className);
    expect(hijos[1]).toContain('fecha-ddmm-texto');
    expect(hijos[2]).toContain('fecha-ddmm-calendario');
    expect(document.getElementById('g').nextElementSibling.id).toBe('f');
  });

  test('la página carga el script y su estilo', () => {
    const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
    expect(html).toMatch(/<script src="js\/fecha-ddmm\.js\?v=[^"]+" defer><\/script>/);
    const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
    expect(css).toMatch(/\.fecha-ddmm-nativo \{[^}]*opacity: 0;/);
  });
});
