/**
 * @jest-environment jsdom
 *
 * Tres correcciones reportadas desde la pantalla en uso:
 *
 * 1. El recuadro de "aquí está capturando fulano" aparecía en unas celdas y en
 *    otras no. El broadcast lo pintaba al instante, pero el siguiente sync de
 *    presencia —que llega con el estado todavía sin actualizar— lo borraba,
 *    porque la limpieza solo miraba el mapa de presencia.
 *
 * 2. Los avatares se cortaban en el borde derecho de la pantalla.
 *
 * 3. Al cambiar un destino aparecía en mayúsculas ("MANZANILLO") en vez de
 *    "Manzanillo": el catálogo guarda unas ciudades gritadas y otras bien
 *    escritas, y se copiaban tal cual.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

function constante(nombre) {
  const i = source.indexOf(`const ${nombre}`);
  if (i === -1) throw new Error(`No se encontró ${nombre}`);
  return source.slice(i, source.indexOf('\n', i) + 1);
}

const api = new Function('document', `
  let _conciRemotePresenceByCell = new Map();
  let _conciFocoRemotoPorCliente = new Map();
  ${constante('_CONCI_CURSOR_VENCE_MS')}
  ${extraer('_conciCursoresVigentes')}
  ${extraer('_conciCellStillClaimed')}
  ${extraer('_conciCiudadBonita')}
  ${extraer('_conciAirportStoredValue')}
  return {
    _conciCellStillClaimed, _conciCiudadBonita, _conciAirportStoredValue,
    presencia: (m) => { _conciRemotePresenceByCell = m; },
    focos: (m) => { _conciFocoRemotoPorCliente = m; },
  };
`)(document);

function celdaEn(rowId, col) {
  document.body.innerHTML = `<table><tbody>
    <tr data-row-id="${rowId}"><td data-col="${col}"></td></tr>
  </tbody></table>`;
  return document.querySelector('td');
}

beforeEach(() => {
  api.presencia(new Map());
  api.focos(new Map());
  document.body.innerHTML = '';
});

describe('el recuadro de foco ya no parpadea', () => {
  test('una celda anunciada solo por broadcast se considera ocupada', () => {
    // Es el caso que fallaba: presence todavía no la conoce y el sync la borraba.
    const td = celdaEn('42', 'TOTAL PAX');
    api.focos(new Map([['otro', { rowId: '42', col: 'TOTAL PAX' }]]));
    expect(api._conciCellStillClaimed(td)).toBe(true);
  });

  test('una celda anunciada solo por presencia también', () => {
    const td = celdaEn('42', 'TOTAL PAX');
    api.presencia(new Map([['42|TOTAL PAX', [{ user: 'Ana' }]]]));
    expect(api._conciCellStillClaimed(td)).toBe(true);
  });

  test('una celda que nadie tiene abierta se libera', () => {
    const td = celdaEn('42', 'TOTAL PAX');
    api.focos(new Map([['otro', { rowId: '42', col: 'OBSERVACIONES' }]]));
    expect(api._conciCellStillClaimed(td)).toBe(false);
  });

  test('el foco de otra fila no la mantiene ocupada', () => {
    const td = celdaEn('42', 'TOTAL PAX');
    api.focos(new Map([['otro', { rowId: '99', col: 'TOTAL PAX' }]]));
    expect(api._conciCellStillClaimed(td)).toBe(false);
  });

  test('varias personas en celdas distintas no se estorban', () => {
    const td = celdaEn('42', 'TOTAL PAX');
    api.focos(new Map([
      ['a', { rowId: '42', col: 'OBSERVACIONES' }],
      ['b', { rowId: '42', col: 'TOTAL PAX' }],
    ]));
    expect(api._conciCellStillClaimed(td)).toBe(true);
  });
});

describe('nombres de ciudad', () => {
  test.each([
    ['MANZANILLO', 'Manzanillo'],
    ['LOS ANGELES', 'Los Angeles'],
    ['PANAMA CITY', 'Panama City'],
    ['SAN LUIS POTOSI', 'San Luis Potosi'],
    ['PUERTO VALLARTA', 'Puerto Vallarta'],
  ])('%s se muestra como %s', (entra, sale) => {
    expect(api._conciCiudadBonita(entra)).toBe(sale);
  });

  test('los conectores van en minúscula', () => {
    expect(api._conciCiudadBonita('CIUDAD DE MÉXICO')).toBe('Ciudad de México');
    expect(api._conciCiudadBonita('ISLA DE LA JUVENTUD')).toBe('Isla de la Juventud');
  });

  test('un nombre ya bien escrito no se toca', () => {
    expect(api._conciCiudadBonita('Monterrey')).toBe('Monterrey');
    expect(api._conciCiudadBonita('Ciudad del Carmen')).toBe('Ciudad del Carmen');
  });

  test('las siglas se dejan como están', () => {
    expect(api._conciCiudadBonita('JFK')).toBe('JFK');
    expect(api._conciCiudadBonita('LAX')).toBe('LAX');
  });

  test('respeta separadores que no son espacios', () => {
    expect(api._conciCiudadBonita('MEXICO/TOLUCA')).toBe('Mexico/Toluca');
  });

  test('tolera vacíos', () => {
    expect(api._conciCiudadBonita('')).toBe('');
    expect(api._conciCiudadBonita(null)).toBe('');
  });

  test('el valor que se guarda al elegir un destino ya viene corregido', () => {
    expect(api._conciAirportStoredValue({ ciudad: 'MANZANILLO' })).toBe('Manzanillo');
    expect(api._conciAirportStoredValue({ nombre: 'AEROPUERTO DE TOLUCA' })).toBe('Aeropuerto de Toluca');
  });
});

describe('integración en el módulo', () => {
  test('la celda de routing pinta la ciudad corregida', () => {
    expect(source).toContain('_conciCiudadBonita(catalogCity || (code ? iataToCity(code) : rawStr))');
  });

  test('los avatares van junto al título, donde no se cortan', () => {
    const i = html.indexOf('Conciliación Manifiestos</h6>');
    const j = html.indexOf('id="conci-presencia"');
    expect(j).toBeGreaterThan(i);
    // Y muy cerca: en el mismo bloque del encabezado, no al final de la barra.
    expect(j - i).toBeLessThan(200);
  });

  test('la barra de avatares no se deja encoger', () => {
    expect(html).toMatch(/\.conci-presencia\s*\{[^}]*display:\s*inline-flex[^}]*flex:\s*none[^}]*width:\s*145px/s);
    expect(html).toContain('.conci-presencia.conci-presencia-vacia');
  });

  test('el indicador y los avatares no usan animaciones que produzcan parpadeo', () => {
    expect(html).not.toContain('animation: conciPresenciaLatido');
    expect(html).not.toContain('animation: conciPresenciaReconectando');
    expect(html).not.toContain('transform: translateY(-2px) scale(1.08)');
  });

  test('las iniciales de edición remota permanecen dentro de la celda y sobre los datos', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    const selector = '#table-conci-manifiestos tbody td.conci-cell-remote-editing .conci-remote-badge';
    const start = css.indexOf(selector);
    const block = css.slice(start, css.indexOf('}', start));
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/top:\s*2px/);
    expect(block).toMatch(/z-index:\s*9/);
    expect(block).not.toMatch(/top:\s*-\d/);
  });
});
