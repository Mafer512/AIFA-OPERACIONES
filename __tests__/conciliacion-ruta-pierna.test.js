/**
 * @jest-environment node
 *
 * La columna RUTA muestra solo la pierna del manifiesto.
 *
 * El Routing del itinerario es la rotación completa (llegada + salida), así
 * que la llegada y la salida de "ANC-NLU-ANC" mostraban las dos "ANC-NLU-ANC":
 * el destino se repetía y, en el Excel de Carga, NLU salía como escala. Ahora
 * la llegada lleva del origen (con sus escalas) a NLU y la salida de NLU al
 * destino.
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

const { pierna } = new Function(`
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciNormalizeManifestType')}
  ${extraer('_conciRutaPierna')}
  return { pierna: _conciRutaPierna };
`)();

describe('_conciRutaPierna', () => {
  test.each([
    ['ANC-NLU-ANC', 'LLEGADA', 'ANC-NLU'],
    ['ANC-NLU-ANC', 'SALIDA', 'NLU-ANC'],
    ['UIO-NLU-LAX', 'Llegada', 'UIO-NLU'],
    ['UIO-NLU-LAX', 'Salida', 'NLU-LAX'],
    // Las escalas se conservan en su pierna.
    ['LAX-MTY-NLU-MTY-LAX', 'LLEGADA', 'LAX-MTY-NLU'],
    ['LAX-MTY-NLU-MTY-LAX', 'SALIDA', 'NLU-MTY-LAX'],
  ])('%s en %s → %s', (ruta, tipo, esperado) => {
    expect(pierna(ruta, tipo)).toBe(esperado);
  });

  test.each([
    // Ya es una sola pierna: no hay nada que recortar.
    ['LAX-MTY-NLU', 'LLEGADA'],
    ['NLU-GDL', 'SALIDA'],
    // Sin NLU, sin tipo o con nombre de ciudad: va igual.
    ['GDL-MTY', 'LLEGADA'],
    ['ANC-NLU-ANC', ''],
    ['Guadalajara', 'SALIDA'],
    ['', 'LLEGADA'],
  ])('%s en "%s" se queda igual', (ruta, tipo) => {
    expect(pierna(ruta, tipo)).toBe(ruta);
  });
});
