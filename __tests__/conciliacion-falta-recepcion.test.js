/**
 * @jest-environment jsdom
 *
 * Conciliación › Manifiestos: HR. DE RECEPCIÓN es la llave de "capturado".
 *  1. Un renglón con CAPTURÓ pero sin HR. DE RECEPCIÓN ilumina esa celda en
 *     ámbar con "Falta capturar".
 *  2. Al salir de un renglón editado sin esa hora, un aviso lleva a la celda.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');

function extraer(inicio, fin) {
  const a = js.indexOf(inicio);
  const b = js.indexOf(fin, a + inicio.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return js.slice(a, b);
}

const llamadas = [];
// Las funciones del bloque, con dobles mínimos de lo que usan de script.js.
const bloque = extraer('// ─── HR. DE RECEPCIÓN pendiente en un renglón ya capturado', 'function _conciUpdateResumen(');
const api = new Function('llamadas', `
  let _conciEditMode = false;
  const _conciNormalizeEditableCellText = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
  const _conciIsReceptionColumn = (c) => /^hr\\.?\\s+de\\s+recepci[oó]n$/i.test(String(c).trim());
  const _conciCanCurrentUserEdit = () => true;
  const _conciEnterEditMode = () => { _conciEditMode = true; llamadas.push('editar'); };
  const _conciActivateCellEditor = (td) => llamadas.push('activar:' + td.dataset.col);
  ${bloque}
  return { _conciMarcarFaltaRecepcion, _conciFaltaRecepcion, _conciVigilarFaltaRecepcion, _conciAvisarFaltaRecepcion };
`)(llamadas);

function renglon({ vuelo = 'XN 1761', capturo = '', recepcion = '', id = '1' } = {}) {
  const tr = document.createElement('tr');
  tr.dataset.rowId = id;
  [['# DE VUELO', vuelo], ['CAPTURÓ', capturo], ['TOTAL PAX', '153'], ['HR. DE RECEPCIÓN', recepcion]].forEach(([col, v]) => {
    const td = document.createElement('td');
    td.dataset.col = col;
    td.dataset.raw = v;
    td.dataset.pendingRaw = v;
    tr.appendChild(td);
  });
  return tr;
}
const celda = (tr, col) => [...tr.children].find(td => td.dataset.col === col);
const espera = (ms) => new Promise(r => setTimeout(r, ms));

beforeEach(() => {
  llamadas.length = 0;
  document.body.innerHTML = '<table id="table-conci-manifiestos"><tbody></tbody></table>';
});

describe('iluminar la celda', () => {
  test('con CAPTURÓ y sin HR. DE RECEPCIÓN se ilumina', () => {
    const tr = renglon({ capturo: 'Laura Macotela M' });
    api._conciMarcarFaltaRecepcion(tr);
    expect(celda(tr, 'HR. DE RECEPCIÓN').classList.contains('conci-falta-recepcion')).toBe(true);
  });

  test('sin CAPTURÓ (nadie lo ha tocado) no se ilumina', () => {
    const tr = renglon();
    api._conciMarcarFaltaRecepcion(tr);
    expect(celda(tr, 'HR. DE RECEPCIÓN').classList.contains('conci-falta-recepcion')).toBe(false);
  });

  test('con HR. DE RECEPCIÓN capturada no se ilumina', () => {
    const tr = renglon({ capturo: 'Laura Macotela M', recepcion: '29/09/2026 14:10' });
    api._conciMarcarFaltaRecepcion(tr);
    expect(celda(tr, 'HR. DE RECEPCIÓN').classList.contains('conci-falta-recepcion')).toBe(false);
  });

  test('se apaga en cuanto se captura la hora, sin recargar', async () => {
    const tbody = document.querySelector('tbody');
    const tr = renglon({ capturo: 'Iván Galindo' });
    api._conciMarcarFaltaRecepcion(tr);
    tbody.appendChild(tr);
    api._conciVigilarFaltaRecepcion(tbody);
    const rec = celda(tr, 'HR. DE RECEPCIÓN');
    expect(rec.classList.contains('conci-falta-recepcion')).toBe(true);
    rec.dataset.pendingRaw = '30/09/2026 09:00';
    await espera(0);
    expect(rec.classList.contains('conci-falta-recepcion')).toBe(false);
  });

  test('se enciende cuando el autoguardado firma CAPTURÓ', async () => {
    const tbody = document.querySelector('tbody');
    const tr = renglon();
    tbody.appendChild(tr);
    api._conciVigilarFaltaRecepcion(tbody);
    celda(tr, 'CAPTURÓ').dataset.pendingRaw = 'Carlos Barrales';
    await espera(0);
    expect(celda(tr, 'HR. DE RECEPCIÓN').classList.contains('conci-falta-recepcion')).toBe(true);
  });

  test('el estilo: ámbar, borde y "Falta capturar" en gris', () => {
    expect(css).toMatch(/td\.conci-falta-recepcion \{\s*background: #fff3cd !important;\s*box-shadow: inset 0 0 0 2px #f59f00;/);
    expect(css).toMatch(/td\.conci-falta-recepcion:not\(\.conci-cell-active\)::after \{\s*content: "Falta capturar";\s*color: #6c757d;/);
  });

  test('el render marca cada tanda de renglones y vigila el tbody', () => {
    expect(js).toMatch(/frag\.querySelectorAll\('tr'\)\.forEach\(_conciMarcarFaltaRecepcion\);\s*_conciVigilarFaltaRecepcion\(tbody\);\s*tbody\.appendChild\(frag\);/);
  });
});

describe('aviso al salir del renglón', () => {
  test('editar un renglón y pasar a otro sin la hora muestra el aviso; "Ir a capturarla" abre la celda', async () => {
    const tbody = document.querySelector('tbody');
    const a = renglon({ vuelo: 'XN 1761', id: '1' });
    const b = renglon({ vuelo: 'CZ 2523', id: '2' });
    tbody.append(a, b);
    api._conciVigilarFaltaRecepcion(tbody);

    // Captura en A: la celda queda sucia y el autoguardado firma CAPTURÓ.
    celda(a, 'TOTAL PAX').dataset.dirty = '1';
    celda(a, 'CAPTURÓ').dataset.pendingRaw = 'Laura Macotela M';
    await espera(0);
    // Pasa a B.
    const destino = celda(b, 'TOTAL PAX');
    destino.tabIndex = -1;
    destino.focus();
    await espera(450);

    const aviso = document.getElementById('conci-aviso-recepcion');
    expect(aviso).not.toBeNull();
    expect(aviso.classList.contains('visible')).toBe(true);
    expect(aviso.textContent).toContain('XN 1761: falta HR. DE RECEPCIÓN');
    aviso.querySelector('.conci-aviso-recepcion-ir').click();
    expect(aviso.classList.contains('visible')).toBe(false);
    expect(llamadas).toEqual(['editar', 'activar:HR. DE RECEPCIÓN']);
  });

  test('si ya puso la hora antes de salir, no hay aviso', async () => {
    const tbody = document.querySelector('tbody');
    const a = renglon({ capturo: 'Laura Macotela M', id: '1' });
    const b = renglon({ id: '2' });
    tbody.append(a, b);
    api._conciVigilarFaltaRecepcion(tbody);
    celda(a, 'HR. DE RECEPCIÓN').dataset.dirty = '1';
    celda(a, 'HR. DE RECEPCIÓN').dataset.pendingRaw = '30/09/2026 10:00';
    await espera(0);
    const destino = celda(b, 'TOTAL PAX');
    destino.tabIndex = -1;
    destino.focus();
    await espera(450);
    const aviso = document.getElementById('conci-aviso-recepcion');
    expect(!aviso || !aviso.classList.contains('visible')).toBe(true);
  });

  test('moverse dentro del mismo renglón no avisa', async () => {
    const tbody = document.querySelector('tbody');
    const a = renglon({ capturo: 'Laura Macotela M', id: '1' });
    tbody.append(a);
    api._conciVigilarFaltaRecepcion(tbody);
    celda(a, 'TOTAL PAX').dataset.dirty = '1';
    await espera(0);
    const otra = celda(a, '# DE VUELO');
    otra.tabIndex = -1;
    otra.focus();
    await espera(450);
    expect(document.getElementById('conci-aviso-recepcion')).toBeNull();
  });
});
