/**
 * @jest-environment node
 *
 * La presentación de carga con lo editado en la vista previa.
 *
 * Se arma el .pptx con la plantilla real y se revisa el XML de cada
 * diapositiva: lo corregido a mano sustituye al marcador solo en su
 * diapositiva, los marcatextos pintan la celda (tablas) o resaltan la cifra
 * (cuadros de texto), y el XML sigue bien formado para que PowerPoint lo abra
 * sin ofrecer "reparar".
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { SaxesParser } = require('saxes');

const raiz = path.resolve(__dirname, '..');

function cargar() {
  const window = { addEventListener() {} };
  const document = {
    addEventListener() {}, getElementById: () => null, querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {}, contains: () => false } }
  };
  window._conciRowIsCargo = () => true;
  for (const archivo of ['conci-carga-catalogo.js', 'conci-presentacion-carga.js', 'conci-reportes-carga.js']) {
    new Function('window', 'document', fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8'))(window, document);
  }
  return window;
}

const COLUMNAS = {
  cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO', operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA', cargaNac: 'KGS. DE CARGA NACIONAL', cargaInt: 'KGS. DE CARGA INTERNACIONAL',
  cargaTotal: 'KG DE CARGA TOTAL', portal: null
};

const manifiesto = c => ({
  'CIERRE SUBSECRETARIA': c.fecha, 'FECHA': c.fecha, 'TIPO DE MANIFIESTO': 'LLEGADA',
  'TIPO DE OPERACIÓN': 'INTERNACIONAL', 'AEROLINEA': c.aerolinea || 'ESTAFETA',
  'KGS. DE CARGA NACIONAL': 0, 'KGS. DE CARGA INTERNACIONAL': c.int || 0, 'KG DE CARGA TOTAL': 0
});

const leerDelRepo = ruta => fs.readFileSync(path.join(raiz, ruta));

function bienFormado(xml) {
  const p = new SaxesParser();
  let error = null;
  p.on('error', e => { error = e; });
  p.write(xml).close();
  return error;
}

/** El XML de la celda (a:tc) o del tramo (a:r) donde quedó un valor. */
function celdaCon(xml, valor) {
  const i = xml.indexOf(`>${valor}</a:t>`);
  const abre = Math.max(xml.lastIndexOf('<a:tc>', i), xml.lastIndexOf('<a:tc ', i));
  return xml.slice(abre, xml.indexOf('</a:tc>', i) + 7);
}

describe('marcar(): el XML de una diapositiva', () => {
  const { ConciPresentacionCarga: P } = cargar();

  test('en una tabla pinta la celda, después de los bordes y en lugar del relleno que traía', () => {
    const xml = '<a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:rPr/><a:t>{{X}}</a:t></a:r></a:p></a:txBody>'
      + '<a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL>'
      + '<a:lnB w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnB>'
      + '<a:solidFill><a:srgbClr val="B4C6E7"/></a:solidFill></a:tcPr></a:tc></a:tr></a:tbl>';
    const r = P.marcar(xml, { X: 'fff176' });
    expect(r).toContain('</a:lnB><a:solidFill><a:srgbClr val="FFF176"/></a:solidFill></a:tcPr>');
    expect(r).not.toContain('B4C6E7');
    // Los bordes conservan su propio relleno negro.
    expect(r.match(/val="000000"/g)).toHaveLength(2);
    expect(bienFormado(r)).toBeNull();
  });

  test('una celda sin propiedades recibe su tcPr', () => {
    const r = P.marcar('<a:tc><a:txBody><a:p><a:r><a:t>{{X}}</a:t></a:r></a:p></a:txBody></a:tc>', { X: 'D6A8F5' });
    expect(r).toContain('<a:tcPr><a:solidFill><a:srgbClr val="D6A8F5"/></a:solidFill></a:tcPr></a:tc>');
  });

  test('en un cuadro de texto resalta la cifra, antes de las fuentes como pide el esquema', () => {
    const xml = '<p:sp><p:txBody><a:p><a:r><a:rPr lang="es-MX" sz="3200"><a:solidFill><a:srgbClr val="235B4E"/></a:solidFill>'
      + '<a:latin typeface="Noto Sans"/></a:rPr><a:t>{{X}}</a:t></a:r></a:p></p:txBody></p:sp>';
    const r = P.marcar(xml, { X: '8FD3FE' });
    expect(r).toContain('</a:solidFill><a:highlight><a:srgbClr val="8FD3FE"/></a:highlight><a:latin');
    expect(bienFormado(r)).toBeNull();
  });

  test('ignora colores que no son hex y claves raras', () => {
    const xml = '<a:r><a:rPr/><a:t>{{X}}</a:t></a:r>';
    expect(P.marcar(xml, { X: 'red"/><evil', 'Y"': 'FFF176' })).toBe(xml);
  });
});

describe('el .pptx con ediciones, sobre la plantilla real', () => {
  const w = cargar();
  const api = w.conciReportesCarga;
  const datos = api.agregar({
    filas: [
      manifiesto({ fecha: '2026-08-30', int: 1709340 }),
      manifiesto({ fecha: '2026-08-31', int: 5000, aerolinea: 'DHL' })
    ],
    columnas: COLUMNAS
  }, '2026-08-31');

  let slides;
  let modelo;

  beforeAll(async () => {
    modelo = api.modeloPresentacion(datos);
    const acumuladoCalculado = modelo.texto.ACUM_OPS;
    modelo.porLamina = {
      texto: { 2: { ACUM_OPS: '99,999', DIA_TON: '1.23' } },
      marcas: { 1: { MES_ANIO: 'FFF176' }, 2: { H1_OPS_1: '9CE6A5', ACUM_OPS: 'FF8A80' }, 7: { ACUM_OPS: '8FD3FE' } }
    };
    modelo.tarjetas[3][0].marca = 'D6A8F5';
    modelo.tarjetas[3][0].ops = '77';
    modelo._acumuladoCalculado = acumuladoCalculado;
    const bytes = await w.ConciPresentacionCarga.construir({ JSZip, cargar: leerDelRepo }, modelo);
    const zip = await JSZip.loadAsync(bytes);
    slides = {};
    for (const n of [1, 2, 3, 7]) slides[n] = await zip.file(`ppt/slides/slide${n}.xml`).async('string');
  });

  test('las diapositivas siguen bien formadas', () => {
    for (const n of Object.keys(slides)) expect(bienFormado(slides[n])).toBeNull();
  });

  test('lo corregido sustituye al marcador solo en su diapositiva', () => {
    expect(slides[2]).toContain('>99,999</a:t>');
    expect(slides[2]).toContain('>1.23</a:t>');
    expect(slides[7]).not.toContain('>99,999</a:t>');
    expect(slides[7]).toContain(`>${modelo._acumuladoCalculado}</a:t>`);
  });

  test('una celda marcada de la tabla lleva el color del marcatextos', () => {
    expect(celdaCon(slides[2], '99,999')).toContain('<a:solidFill><a:srgbClr val="FF8A80"/></a:solidFill></a:tcPr>');
  });

  test('en cuadros de texto la cifra queda resaltada', () => {
    expect(slides[1]).toContain('<a:highlight><a:srgbClr val="FFF176"/></a:highlight>');
    expect(slides[7]).toContain('<a:highlight><a:srgbClr val="8FD3FE"/></a:highlight>');
  });

  test('la tarjeta marcada cambia el crema por el color, con su cifra corregida', () => {
    expect(slides[3]).toContain('<a:srgbClr val="D6A8F5"/>');
    expect(slides[3]).toContain('>77</a:t>');
  });

  test('sin ediciones no cambia nada respecto a lo calculado', async () => {
    const limpio = api.modeloPresentacion(datos);
    const zip = await JSZip.loadAsync(await w.ConciPresentacionCarga.construir({ JSZip, cargar: leerDelRepo }, limpio));
    const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
    expect(s2).not.toContain('<a:highlight');
    expect(s2).toContain(`>${limpio.texto.ACUM_OPS}</a:t>`);
  });
});
