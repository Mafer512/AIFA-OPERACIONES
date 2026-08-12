/**
 * @jest-environment jsdom
 *
 * AIFONSO (asistente conversacional) solo debe cargarse en desarrollo local.
 *
 * Sigue en BETA. Las tres etiquetas <script src> se descargaban siempre, sin
 * importar dónde estuviera publicada la página, así que el botón flotante
 * llegaba a quien usa la plataforma a diario. Ahora la carga es condicional.
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

const ARCHIVOS = [
  'js/asistente-aifa-datos.js',
  'js/asistente-aifa.js',
  'js/asistente-aifa-ui.js',
];

/** Extrae el cargador condicional tal cual está en index.html. */
function extraerCargador() {
  const inicio = html.indexOf('var HOSTS_LOCALES');
  if (inicio === -1) throw new Error('No se encontró el cargador condicional en index.html');
  const fin = html.indexOf('</script>', inicio);
  const cuerpo = html.slice(html.lastIndexOf('(function ()', inicio), fin);
  return cuerpo;
}

const cargador = extraerCargador();

/** Ejecuta el cargador simulando un hostname. */
function cargarDesde(hostname) {
  document.head.innerHTML = '';
  const inyectados = [];
  const appendChild = document.head.appendChild.bind(document.head);
  document.head.appendChild = (el) => {
    if (el.tagName === 'SCRIPT') inyectados.push({ src: el.getAttribute('src'), async: el.async });
    return appendChild(el);
  };
  // location.hostname es de solo lectura en jsdom; se sustituye el objeto.
  new Function('location', 'document', cargador)(
    { hostname },
    document
  );
  document.head.appendChild = appendChild;
  return inyectados;
}

describe('en producción no se carga', () => {
  test.each([
    'aifa-operaciones.vercel.app',
    'operaciones.aifa.aero',
    'aifa-operaciones-git-main.vercel.app',
    '10.0.0.15',
    '192.168.1.40',
  ])('no inyecta nada desde %s', (host) => {
    expect(cargarDesde(host)).toEqual([]);
  });

  test('index.html no trae etiquetas <script src> fijas del asistente', () => {
    const fijas = [...html.matchAll(/<script[^>]*\ssrc="[^"]*asistente-aifa[^"]*"/g)];
    expect(fijas).toHaveLength(0);
  });
});

describe('en local sí se carga', () => {
  test.each(['localhost', '127.0.0.1', '::1', '[::1]'])('inyecta los tres archivos desde %s', (host) => {
    const inyectados = cargarDesde(host);
    expect(inyectados.map(s => s.src.split('?')[0])).toEqual(ARCHIVOS);
  });

  test('también con el archivo abierto directo del disco (file://)', () => {
    expect(cargarDesde('')).toHaveLength(3);
  });

  test('conserva el orden datos → motor → interfaz', () => {
    // Un <script> creado por código es async por omisión y se ejecutaría en
    // desorden; el motor depende de los datos y la interfaz del motor.
    const inyectados = cargarDesde('localhost');
    expect(inyectados.every(s => s.async === false)).toBe(true);
    expect(inyectados[0].src).toContain('asistente-aifa-datos');
    expect(inyectados[1].src).toContain('asistente-aifa.js');
    expect(inyectados[2].src).toContain('asistente-aifa-ui');
  });
});

describe('el resto de la plataforma no depende del asistente', () => {
  test('ningún otro archivo llama a sus globales', () => {
    const raiz = path.resolve(__dirname, '..');
    const candidatos = ['index.html', 'script.js', 'sw.js']
      .concat(fs.readdirSync(path.join(raiz, 'js'))
        .filter(f => f.endsWith('.js') && !f.startsWith('asistente-aifa'))
        .map(f => path.join('js', f)));

    const culpables = candidatos.filter(rel => {
      const contenido = fs.readFileSync(path.join(raiz, rel), 'utf8');
      return /window\.(AsistenteAifa|AsistenteAifaDatos|asistenteAifaAbrir)\b/.test(contenido);
    });
    expect(culpables).toEqual([]);
  });

  test('el service worker no precachea sus archivos', () => {
    const sw = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
    expect(sw).not.toContain('asistente-aifa');
  });
});
