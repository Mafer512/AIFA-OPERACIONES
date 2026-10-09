/**
 * @jest-environment jsdom
 *
 * Fotos de identificaciones y CV del portal del QR (js/documento-foto.js), y
 * la columna de licencia que el panel del área no encontraba.
 */

const fs = require('fs');
const path = require('path');
const df = require('../js/documento-foto');

/** Imagen en gris de prueba: fondo de un tono y, si se pide, "texto" nítido. */
function imagen({ fondo = 200, texto = true, ancho = 200, alto = 120 } = {}) {
  const g = new Uint8ClampedArray(ancho * alto).fill(fondo);
  if (texto) {
    for (let y = 20; y < alto - 20; y += 8) {
      for (let x = 15; x < ancho - 15; x++) if ((x >> 2) % 2 === 0) g[y * ancho + x] = 20;
    }
  }
  return { g, ancho, alto };
}

describe('qué tan legible es la foto', () => {
  test('una foto clara y con bordes definidos pasa sin avisos', () => {
    const { g, ancho, alto } = imagen();
    expect(df.medirLegibilidad(g, ancho, alto, { ancho: 1600, alto: 1000 }).avisos).toEqual([]);
  });

  test('oscura', () => {
    const { g, ancho, alto } = imagen({ fondo: 25, texto: false });
    expect(df.medirLegibilidad(g, ancho, alto, { ancho: 1600, alto: 1000 }).avisos).toContain('está muy oscura');
  });

  test('borrosa: sin bordes', () => {
    const { g, ancho, alto } = imagen({ texto: false });
    expect(df.medirLegibilidad(g, ancho, alto, { ancho: 1600, alto: 1000 }).avisos).toContain('se ve borrosa');
  });

  test('con flash: mucha zona quemada', () => {
    const { g, ancho, alto } = imagen({ fondo: 255 });
    const r = df.medirLegibilidad(g, ancho, alto, { ancho: 1600, alto: 1000 });
    expect(r.avisos).toContain('tiene reflejo o flash');
  });

  test('muy chica', () => {
    const { g, ancho, alto } = imagen();
    expect(df.medirLegibilidad(g, ancho, alto, { ancho: 480, alto: 300 }).avisos).toContain('tiene poca resolución');
  });
});

describe('lo guardado que no es foto', () => {
  test('las marcas de la planilla ("0", "P", "Pendiente") no cuentan como foto', () => {
    for (const v of ['0', 'P', 'Pendiente', 'Webex', '']) expect(df.esImagen(v)).toBe(false);
    expect(df.esImagen('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(df.esImagen('storage://employee-document-images/1/ine_front-x.jpg')).toBe(true);
  });
});

describe('el CV sólo en PDF', () => {
  const archivo = (contenido, nombre, tipo) => new File([contenido], nombre, { type: tipo });

  test('acepta un PDF de verdad', async () => {
    const url = await df.leerCv(archivo('%PDF-1.7 hola', 'cv.pdf', 'application/pdf'));
    expect(url.startsWith('data:application/pdf')).toBe(true);
  });

  test('rechaza un Word', async () => {
    await expect(df.leerCv(archivo('PK..', 'cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')))
      .rejects.toThrow(/PDF/);
  });

  test('rechaza un archivo renombrado a .pdf que no es PDF', async () => {
    await expect(df.leerCv(archivo('no soy pdf', 'cv.pdf', 'application/pdf'))).rejects.toThrow(/no es un PDF válido/);
  });

  test('rechaza más de 5 MB', async () => {
    const grande = new File([new Uint8Array(df.CV_MAX + 1)], 'cv.pdf', { type: 'application/pdf' });
    await expect(df.leerCv(grande)).rejects.toThrow(/máximo es 5 MB/);
  });
});

describe('el recuadro de la foto', () => {
  test('ofrece tomarla con la cámara o subirla', () => {
    document.body.innerHTML = '<div id="c"></div>';
    df.conectar({ contenedor: document.getElementById('c'), titulo: 'INE frente', etiqueta: 'Obligatorio' });
    const inputs = [...document.querySelectorAll('input[type=file]')];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].getAttribute('capture')).toBe('environment');
    expect(inputs[1].hasAttribute('capture')).toBe(false);
    expect(document.querySelector('.df').textContent).toContain('Tomar foto');
  });

  test('una marca vieja se muestra como "aún no hay foto"', () => {
    document.body.innerHTML = '<div id="c"></div>';
    const f = df.conectar({ contenedor: document.getElementById('c'), titulo: 'INE frente', valor: '0' });
    expect(document.querySelector('.df-vista').textContent).toContain('Aún no hay foto');
    expect(f.valor()).toBe('0');   // no se borra hasta que suban otra
  });
});

describe('el panel del área encuentra la columna de licencia', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const patrones = clave => {
    const m = app.match(new RegExp(clave + ':\\s+find\\(([^)]*)\\)'));
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  const COLUMNAS = ['No. Empleado', 'Nombre', 'Nombre de la Licenciatura y/o Maestria', 'Licencia de Manejo',
    'Tipo de licencia', 'Licencia Vigencia', 'Fotografia de licencia'];
  const resolver = pats => {
    for (const p of pats) { const k = COLUMNAS.find(c => new RegExp(p, 'i').test(c)); if (k) return k; }
    return null;
  };

  test('Licencia → "Licencia de Manejo" (antes no la encontraba y no se guardaba)', () => {
    expect(resolver(patrones('licencia'))).toBe('Licencia de Manejo');
  });
  test('la foto de la licencia → "Fotografia de licencia"', () => {
    expect(resolver(patrones('foto_licencia'))).toBe('Fotografia de licencia');
  });
  test('tipo y vigencia siguen en su columna', () => {
    expect(resolver(patrones('licencia_tipo'))).toBe('Tipo de licencia');
    expect(resolver(patrones('vig_licencia'))).toBe('Licencia Vigencia');
  });
});
