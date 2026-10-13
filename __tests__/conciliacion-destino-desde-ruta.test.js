/**
 * @jest-environment node
 *
 * Sin DESTINO / ORIGEN (la carga del libro trae sólo la RUTA), la tabla y el
 * Excel muestran la ciudad del otro extremo de la RUTA: en la llegada el
 * origen (HKG-ANC-NLU → Hong Kong), en la salida el destino (NLU-LAX → Los
 * Ángeles).
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

const CIUDADES = { HKG: 'Hong Kong', LAX: 'Los Angeles', ANC: 'Anchorage', MTY: 'Monterrey', NLU: 'Mexico' };
const destino = new Function('ciudades', `
  const _conciAirportCatalogByIata = new Map();
  function _conciAirportStoredValue() { return ''; }
  function _conciCiudadBonita(s) { return s; }
  ${extraer('_conciDestinoOrigenVisible')}
  ${extraer('_conciDestinoOrigenRuta')}
  return (ruta, tipo) => _conciDestinoOrigenRuta(ruta, tipo, c => ciudades[c] || c);
`)(CIUDADES);

describe('_conciDestinoOrigenRuta', () => {
  test.each([
    ['HKG-ANC-NLU', 'LLEGADA', 'Hong Kong'],
    ['NLU-LAX', 'SALIDA', 'Los Angeles'],
    ['ANC-NLU', 'Llegada', 'Anchorage'],
    // Ruta capturada al revés: nunca muestra el AIFA.
    ['NLU-LAX', 'LLEGADA', 'Los Angeles'],
    ['NLU-MTY-MTY', 'SALIDA', 'Monterrey'],
  ])('%s en %s → %s', (ruta, tipo, esperado) => {
    expect(destino(ruta, tipo)).toBe(esperado);
  });

  test('sin otro extremo que el AIFA no inventa nada', () => {
    expect(destino('NLU', 'LLEGADA')).toBe('');
    expect(destino('', 'SALIDA')).toBe('');
  });
});
