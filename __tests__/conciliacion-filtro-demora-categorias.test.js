/**
 * @jest-environment jsdom
 *
 * Manifiestos › filtro de la columna DEMORA +- 15 MIN.: en vez de una opción
 * por cada minuto (-1, -2, -3…), cinco categorías, en este orden:
 *   0 · Mayor a +15 · Entre +1 y +15 · Entre -1 y -15 · Menor a -15
 * y "-" cuando falta la hora de operación o el slot.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const bloque = (inicio, fin) => {
  const a = source.indexOf(inicio);
  const b = source.indexOf(fin, a);
  if (a === -1 || b === -1) throw new Error('No se encontró el bloque.');
  return source.slice(a, b);
};

const api = new Function(
  bloque('const _CONCI_DEMORA_CATEGORIAS', '// Alerta de 30 horas')
  + '; return { _CONCI_DEMORA_CATEGORIAS, _conciCategoriaDemora, _conciCompararCategoriasDemora, _conciEsColumnaDemora15 };'
)();

describe('categorías del filtro de DEMORA +- 15 MIN.', () => {
  test.each([
    [0, '0'],
    [1, 'Entre +1 y +15'],
    [15, 'Entre +1 y +15'],
    [16, 'Mayor a +15'],
    [115, 'Mayor a +15'],
    [-1, 'Entre -1 y -15'],
    [-15, 'Entre -1 y -15'],
    [-16, 'Menor a -15'],
    [-98, 'Menor a -15'],
    [null, '-'],
    [NaN, '-'],
  ])('%s minutos → %s', (minutos, categoria) => {
    expect(api._conciCategoriaDemora(minutos)).toBe(categoria);
  });

  test('las opciones salen en el orden pedido, con "-" al final', () => {
    const desordenadas = ['-', 'Menor a -15', 'Entre +1 y +15', '0', 'Entre -1 y -15', 'Mayor a +15'];
    expect(desordenadas.sort(api._conciCompararCategoriasDemora))
      .toEqual(['0', 'Mayor a +15', 'Entre +1 y +15', 'Entre -1 y -15', 'Menor a -15', '-']);
  });

  test('reconoce la columna como la nombra la tabla', () => {
    expect(api._conciEsColumnaDemora15('DEMORA +- 15 MIN.')).toBe(true);
    expect(api._conciEsColumnaDemora15('PUNTUALIDAD / CANCELACIÓN')).toBe(false);
  });

  test('el filtro de la columna usa la categoría y ordena con ese orden', () => {
    const conGetter = source.slice(source.indexOf('function _conciExcelFilterValueGetter'));
    expect(conGetter).toMatch(/return row => _conciCategoriaDemora\(\s*_conciDemoraMinutos\(slotCol \? row\[slotCol\] : '', slotCoordCol \? row\[slotCoordCol\] : '', row\[opCol\], anio\)\);/);
    expect(source).toMatch(/\.sort\(_conciEsColumnaDemora15\(col\) \? _conciCompararCategoriasDemora : _conciCompararOpcionesFiltro\);/);
  });
});
