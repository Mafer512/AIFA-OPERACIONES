/**
 * @jest-environment node
 *
 * Inicio · los días de carga con ajuste contra el cierre oficial
 * (carga_diaria_oficial) llevan un punto naranja, sin texto, que sólo ve el
 * superadmin.
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

const crear = (rol, ajustes) => new Function('sessionStorage', 'window', `
  ${extraer('ndwVeAjustesCarga')}
  ${extraer('ndwMarcaAjusteCarga')}
  return ndwMarcaAjusteCarga;
`)({ getItem: () => rol }, { _ndwAjustesCarga: new Set(ajustes) });

describe('ndwMarcaAjusteCarga', () => {
  test('superadmin: punto en el día o la semana que tiene un día ajustado', () => {
    const marca = crear('superadmin', ['2023-11-30']);
    expect(marca(['2023-11-30'])).toContain('ndw-marca-ajuste');
    expect(marca(['2023-11-27', '2023-11-28', '2023-11-29', '2023-11-30'])).toContain('ndw-marca-ajuste');
    expect(marca(['2023-11-29'])).toBe('');
  });

  test('la marca no trae texto ni tooltip', () => {
    const html = crear('superadmin', ['2023-11-30'])(['2023-11-30']);
    expect(html).toBe('<span class="ndw-marca-ajuste" aria-hidden="true"></span>');
  });

  test.each(['admin', 'editor', 'viewer', null])('%s no la ve', (rol) => {
    expect(crear(rol, ['2023-11-30'])(['2023-11-30'])).toBe('');
  });
});
