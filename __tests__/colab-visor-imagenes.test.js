/**
 * @jest-environment jsdom
 *
 * Visor de fotos e identificaciones de colaboradores.
 *
 * La foto de perfil se pinta en 110x130 px y las identificaciones en recuadros
 * de 16:10 con object-fit:cover. A ese tamaño no se distingue una cara ni se
 * lee un número de INE, y no había forma de ver el archivo original.
 *
 * Lo que se fija aquí es lo que se rompe fácil:
 *   · Los recuadros VACÍOS no deben reaccionar. Conservan su <img> con el src
 *     en blanco y display:none; si el visor no lo comprueba, se abre en negro.
 *   · El enganche tiene que ser por delegación: las fotos llegan de Supabase
 *     de forma asíncrona y las de documentos con URL firmada, así que al
 *     arrancar la página casi ninguna existe todavía.
 *   · La descarga no puede confiar en el atributo `download`: los archivos
 *     vienen de otro dominio y el navegador lo ignora.
 */

const fs = require('fs');
const path = require('path');

const FUENTE = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'colab-visor-imagenes.js'),
  'utf8',
);

// jsdom no descarga imágenes: `naturalWidth` se queda en 0 y el visor las
// tomaría por rotas. Se declara el tamaño que el navegador habría medido.
function conTamano(img, ancho = 1200, alto = 800) {
  Object.defineProperty(img, 'naturalWidth', { value: ancho, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: alto, configurable: true });
  return img;
}

function montarFicha() {
  document.body.innerHTML = `
    <div class="colab-avatar-wrap" id="colab-avatar-wrap">
      <img id="colab-avatar-img" src="https://sb.co/fotos/1747.jpg" alt="Foto del colaborador">
    </div>
    <span id="colab-h-numero">1747</span>
    <div id="colab-h-nombre">Gerardo Rodríguez Hernández</div>
    <div class="colab-doc-photos" id="colab-doc-photos-wrap">
      <div class="colab-doc-photo">
        <label>INE Frente</label>
        <div class="colab-doc-photo-frame">
          <img id="colab-foto-ine" src="" alt="INE frente" style="display:none">
        </div>
      </div>
      <div class="colab-doc-photo">
        <label>INE Reverso</label>
        <div class="colab-doc-photo-frame">
          <img id="colab-foto-ine-rev" src="https://sb.co/sign/ine-rev?token=abc" alt="INE reverso">
        </div>
      </div>
      <div class="colab-doc-photo">
        <label>Credencial AIFA</label>
        <div class="colab-doc-photo-frame">
          <img id="colab-foto-cred" src="https://sb.co/sign/cred?token=xyz" alt="Credencial">
        </div>
      </div>
    </div>`;
  conTamano(document.getElementById('colab-avatar-img'));
  conTamano(document.getElementById('colab-foto-ine-rev'));
  conTamano(document.getElementById('colab-foto-cred'));
}

function cargar() {
  // El módulo es una IIFE que se engancha a `document` al evaluarse.
  new Function(FUENTE)();
}

const pasarMouse = el => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
const sacarMouse = el => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
const clic = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const tecla = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

const previa = () => document.querySelector('.cvi-previa');
const visor = () => document.querySelector('.cvi-visor');
const visorAbierto = () => !!visor() && visor().classList.contains('abierto');

beforeEach(() => {
  jest.useFakeTimers();
  montarFicha();
  cargar();
});

afterEach(() => {
  jest.useRealTimers();
  delete window.colabVisorImagenes;
});

describe('vista previa al pasar el mouse', () => {
  test('asoma sobre la foto del colaborador tras el retardo', () => {
    pasarMouse(document.getElementById('colab-avatar-img'));
    expect(previa()).toBeNull();          // no antes de tiempo

    jest.advanceTimersByTime(400);
    expect(previa().classList.contains('visible')).toBe(true);
    expect(previa().querySelector('img').src).toContain('/fotos/1747.jpg');
    expect(previa().querySelector('.cvi-previa-txt').textContent).toBe('Fotografía');
  });

  test('nombra el documento con la etiqueta de su recuadro', () => {
    pasarMouse(document.getElementById('colab-foto-cred'));
    jest.advanceTimersByTime(400);
    expect(previa().querySelector('.cvi-previa-txt').textContent).toBe('Credencial AIFA');
  });

  test('un recuadro vacío no muestra nada', () => {
    pasarMouse(document.getElementById('colab-foto-ine'));
    jest.advanceTimersByTime(400);
    expect(previa()).toBeNull();
  });

  test('se retira al sacar el mouse', () => {
    const img = document.getElementById('colab-foto-cred');
    pasarMouse(img);
    jest.advanceTimersByTime(400);
    expect(previa().classList.contains('visible')).toBe(true);

    sacarMouse(img);
    expect(previa().classList.contains('visible')).toBe(false);
  });

  test('no se queda flotando al desplazar la página', () => {
    pasarMouse(document.getElementById('colab-foto-cred'));
    jest.advanceTimersByTime(400);
    window.dispatchEvent(new Event('scroll'));
    expect(previa().classList.contains('visible')).toBe(false);
  });
});

describe('visor a pantalla completa', () => {
  test('el clic lo abre con la imagen y la persona', () => {
    clic(document.getElementById('colab-foto-cred'));
    expect(visorAbierto()).toBe(true);
    expect(visor().querySelector('.cvi-img').src).toContain('/sign/cred');
    expect(visor().querySelector('.cvi-titulo-doc').textContent).toBe('Credencial AIFA');
    expect(visor().querySelector('.cvi-titulo-persona').textContent)
      .toBe('No. 1747 · Gerardo Rodríguez Hernández');
  });

  test('un recuadro vacío no abre el visor', () => {
    clic(document.getElementById('colab-foto-ine'));
    expect(visorAbierto()).toBe(false);
  });

  test('Escape lo cierra', () => {
    clic(document.getElementById('colab-foto-cred'));
    tecla('Escape');
    expect(visorAbierto()).toBe(false);
  });

  test('las flechas pasan entre las identificaciones cargadas, saltando las vacías', () => {
    clic(document.getElementById('colab-foto-ine-rev'));
    expect(visor().querySelector('.cvi-titulo-doc').textContent).toBe('INE Reverso');

    tecla('ArrowRight');
    expect(visor().querySelector('.cvi-titulo-doc').textContent).toBe('Credencial AIFA');

    // Solo hay dos con imagen; la vuelta regresa a la primera, nunca al hueco.
    tecla('ArrowRight');
    expect(visor().querySelector('.cvi-titulo-doc').textContent).toBe('INE Reverso');
  });

  test('la foto de perfil se abre sola: no pertenece al grupo de documentos', () => {
    clic(document.getElementById('colab-avatar-img'));
    visor().querySelectorAll('.cvi-nav').forEach(b => {
      expect(b.classList.contains('d-none')).toBe(true);
    });
  });

  test('acerca, aleja y vuelve a ajustar', () => {
    clic(document.getElementById('colab-foto-cred'));
    const zoom = () => visor().querySelector('.cvi-zoom').textContent;
    expect(zoom()).toBe('100%');

    tecla('+');
    expect(parseInt(zoom(), 10)).toBeGreaterThan(100);
    tecla('0');
    expect(zoom()).toBe('100%');
  });

  test('no se acerca más allá del tope', () => {
    clic(document.getElementById('colab-foto-cred'));
    for (let i = 0; i < 40; i++) tecla('+');
    expect(parseInt(visor().querySelector('.cvi-zoom').textContent, 10)).toBeLessThanOrEqual(800);
  });

  test('la imagen se muestra completa, sin el recorte del recuadro', () => {
    clic(document.getElementById('colab-foto-cred'));
    const css = document.getElementById('cvi-estilos').textContent;
    expect(css).toMatch(/\.cvi-img\s*\{[^}]*object-fit:\s*contain/);
  });
});

describe('descarga', () => {
  test('guarda el archivo con el nombre de la persona y del documento', async () => {
    jest.useRealTimers();
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    URL.createObjectURL = jest.fn(() => 'blob:falso');
    URL.revokeObjectURL = jest.fn();

    let anclaUsada = null;
    const crear = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(tag => {
      const el = crear(tag);
      if (tag === 'a') { anclaUsada = el; el.click = jest.fn(); }
      return el;
    });

    clic(document.getElementById('colab-foto-cred'));
    visor().querySelector('[data-cvi="descargar"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledWith('https://sb.co/sign/cred?token=xyz',
      expect.objectContaining({ mode: 'cors' }));
    expect(anclaUsada.download).toBe('1747 - Gerardo Rodríguez Hernández - Credencial AIFA.jpg');
    expect(anclaUsada.click).toHaveBeenCalled();
    document.createElement.mockRestore();
  });

  test('si el navegador bloquea la lectura, al menos abre el archivo en otra pestaña', async () => {
    jest.useRealTimers();
    global.fetch = jest.fn().mockRejectedValue(new Error('CORS'));
    window.open = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    clic(document.getElementById('colab-foto-cred'));
    visor().querySelector('[data-cvi="descargar"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(window.open).toHaveBeenCalledWith('https://sb.co/sign/cred?token=xyz', '_blank', 'noopener');
    console.warn.mockRestore();
  });
});

describe('enganche', () => {
  test('cubre las fotos que llegan después de cargar la página', () => {
    // Es el caso real: al abrir otro colaborador se reemplaza el <img>.
    const marco = document.querySelector('#colab-doc-photos-wrap .colab-doc-photo-frame');
    marco.innerHTML = '<img id="nuevo" src="https://sb.co/sign/otra?token=1" alt="INE frente">';
    conTamano(document.getElementById('nuevo'));

    clic(document.getElementById('nuevo'));
    expect(visorAbierto()).toBe(true);
    expect(visor().querySelector('.cvi-img').src).toContain('/sign/otra');
  });

  test('no toca imágenes ajenas al módulo de colaboradores', () => {
    document.body.insertAdjacentHTML('beforeend', '<img id="ajena" src="https://sb.co/logo.png">');
    conTamano(document.getElementById('ajena'));
    clic(document.getElementById('ajena'));
    expect(visorAbierto()).toBe(false);
  });
});
