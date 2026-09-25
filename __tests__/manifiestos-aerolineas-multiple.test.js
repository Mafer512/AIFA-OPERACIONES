/**
 * @jest-environment jsdom
 *
 * Aerolíneas: una sola por empresa, y varias a la vez en el filtro.
 *
 * En el manifiesto el capturista escribe la razón social, no la marca: los
 * vuelos de Aeroméxico entran como "AEROVÍAS" (Aerovías de México) y como
 * "AEROLITORAL" (Aeroméxico Connect). Contados aparte, la aerolínea más grande
 * del aeropuerto salía partida y el ranking mentía. Y el filtro era un select
 * de una sola opción: comparar Volaris contra Viva pedía mirar dos veces.
 *
 * Aquí se comprueban las dos cosas sobre el módulo ya montado: que las razones
 * sociales se sumen en un solo renglón, y que marcar dos aerolíneas filtre por
 * las dos.
 */

const path = require('path');

const raiz = path.resolve(__dirname, '..');

/* Ocho vuelos de la tabla anual, con las columnas tal como vienen del Excel.
   Cinco son Aeroméxico escrito de tres formas distintas. */
const fila = (aerolinea, vuelo, pax) => ({
  'MES': 'Enero',
  'FECHA': '2025-01-14',
  'TIPO DE MANIFIESTO': 'Llegada',
  'AEROLINEA': aerolinea,
  'TIPO DE OPERACIÓN': 'Nacional',
  '# DE VUELO': vuelo,
  'DESTINO / ORIGEN': 'CUN',
  'HR. DE OPERACIÓN': '08:30',
  'TOTAL PAX': pax,
});

const MANIFIESTOS = [
  fila('AEROVÍAS', 'AM100', 150),
  fila('AEROVÍAS', 'AM101', 160),
  fila('Aerovías de México', 'AM102', 140),
  fila('AEROLITORAL', 'AM200', 90),
  fila('AEROMEXICO', 'AM300', 120),
  fila('VOLARIS', 'Y4500', 180),
  fila('VOLARIS', 'Y4501', 175),
  fila('VIVA AEROBUS', 'VB700', 185),
];

/* El catálogo de aerolíneas, como lo entrega la tabla airlines. Nótese que
   NO trae alias de "aerovias": esa la resuelve el módulo por su cuenta. */
const CATALOGO = [
  {
    name: 'Aeroméxico', iata: 'AM', color: '#0b2161', logo_url: null,
    aliases: ['aeromexico', 'aeroméxico', 'aeromexico connect', 'aerolitoral'],
  },
  { name: 'Volaris', iata: 'Y4', color: '#a300e6', logo_url: null, aliases: ['volaris', 'vuela'] },
  { name: 'Viva Aerobus', iata: 'VB', color: '#00a850', logo_url: null, aliases: ['viva aerobus', 'viva'] },
];

function supabaseDeMentiras() {
  return {
    from() {
      const q = {
        _head: false,
        select(_c, o) { q._head = !!(o && o.head); return q; },
        gte() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; },
        range(d, h) { q._d = d; q._h = h; return q; },
        then(res) {
          const r = q._head
            ? { count: MANIFIESTOS.length, data: null, error: null }
            : { data: MANIFIESTOS.slice(q._d || 0, (q._h === undefined ? MANIFIESTOS.length - 1 : q._h) + 1), error: null };
          return Promise.resolve(r).then(res);
        },
      };
      return q;
    },
  };
}

const FIXTURE = `
  <div id="mdb-overlay" class="d-none"><span id="mdb-overlay-text"></span></div>
  <div class="btn-group" aria-label="Seleccionar período">
    <button class="btn btn-outline-primary mdb-period-btn" data-table="Base de datos Manifiestos 2025" id="mdb-period-2025"></button>
    <button class="btn btn-primary mdb-period-btn" data-table="maestra_operaciones" id="mdb-period-2026"></button>
  </div>
  <span id="mdb-period-label"></span>
  <select id="mdb-filter-year"><option value="" selected></option></select>
  <select id="mdb-filter-month"><option value="" selected></option><option value="01"></option><option value="02"></option></select>
  <select id="mdb-filter-direction"><option value="" selected></option><option value="Llegada"></option><option value="Salida"></option></select>
  <select id="mdb-filter-optype"><option value="" selected></option></select>
  <input type="hidden" id="mdb-filter-airline" value="">
  <div class="mdb-al" id="mdb-airline-picker">
    <button type="button" id="mdb-airline-trigger" aria-expanded="false">
      <span id="mdb-airline-logos"></span>
      <span id="mdb-airline-label">Todas las aerolíneas</span>
    </button>
    <div id="mdb-airline-panel" hidden>
      <div><input type="text" id="mdb-airline-search"></div>
      <div>
        <button type="button" data-mdb-al-act="todas"></button>
        <button type="button" data-mdb-al-act="ninguna"></button>
        <span id="mdb-airline-count"></span>
      </div>
      <div id="mdb-airline-list"></div>
    </div>
  </div>
  <div id="mdb-airline-chips"></div>
  <div class="d-none" id="mdb-filter-origen-wrap"><select id="mdb-filter-origen"><option value="" selected></option></select></div>
  <button id="mdb-btn-clear-filters"></button>
  <span id="mdb-record-count"></span>
  <ul id="mdb-sub-tabs">
    <li><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#mdb-sub-datos"></button></li>
  </ul>
  <table><thead id="mdb-main-thead"></thead><tbody id="mdb-main-tbody"></tbody></table>
  <span id="mdb-table-info"></span><div id="mdb-pagination"></div>
`;

const esperaA = (cond, ms = 3000) => new Promise((ok, no) => {
  const fin = Date.now() + ms;
  const tic = () => cond() ? ok() : (Date.now() > fin ? no(new Error('nunca se pintó')) : setTimeout(tic, 20));
  tic();
});

let lista;
const filasVisibles = () => document.getElementById('mdb-table-info').textContent;
const nombresEnLista = () => [...lista.querySelectorAll('[data-mdb-al]')].map(b => b.dataset.mdbAl);
const clicEn = (nombre) => lista.querySelector(`[data-mdb-al="${nombre}"]`).click();
// Los filtros se aplican solos, agrupando los cambios seguidos: hay que dejar
// pasar ese respiro antes de mirar la tabla.
const yaFiltro = () => new Promise(r => setTimeout(r, 100));

beforeAll(async () => {
  document.body.innerHTML = FIXTURE;
  class ChartFalso { constructor() {} destroy() {} static register() {} static unregister() {} }
  window.Chart = ChartFalso;
  global.Chart = ChartFalso;
  window.supabaseClient = supabaseDeMentiras();

  const catalogo = require(path.join(raiz, 'js/airline-catalog.js'));
  catalogo._sembrar(CATALOGO);
  require(path.join(raiz, 'js/manifiestos-maestra.js'));
  require(path.join(raiz, 'js/manifiestos-analisis.js'));
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  // Estos renglones tienen la forma de los Excel anuales, así que la prueba
  // corre sobre el período 2025; el de 2026 lee la maestra, que es otra forma.
  document.getElementById('mdb-period-2025').click();

  lista = document.getElementById('mdb-airline-list');
  await esperaA(() => lista.querySelector('[data-mdb-al]'));
});

afterEach(async () => {
  document.getElementById('mdb-btn-clear-filters').click();
  await yaFiltro();
});

describe('una sola aerolínea por empresa', () => {
  test('las tres razones sociales de Aeroméxico son un solo renglón', () => {
    const nombres = nombresEnLista();
    expect(nombres).toContain('Aeroméxico');
    expect(nombres).not.toContain('AEROVÍAS');
    expect(nombres).not.toContain('AEROLITORAL');
    // Ocho vuelos repartidos en tres empresas, no en cinco nombres.
    expect(nombres).toEqual(['Aeroméxico', 'Volaris', 'Viva Aerobus']);
  });

  test('sus vuelos se suman: cinco, no tres por un lado y uno por otro', () => {
    const fila = lista.querySelector('[data-mdb-al="Aeroméxico"]');
    expect(fila.textContent).toContain('5');
  });

  test('la lista sale de mayor a menor, para saber a quién mirar', () => {
    expect(nombresEnLista()[0]).toBe('Aeroméxico');
  });
});

describe('filtrar por varias aerolíneas', () => {
  test('sin selección se ven los ocho vuelos', () => {
    expect(filasVisibles()).toContain('de 8 registros');
  });

  test('una aerolínea deja sólo los suyos', async () => {
    clicEn('Volaris');
    await yaFiltro();
    expect(filasVisibles()).toContain('de 2 registros');
  });

  test('dos aerolíneas dejan las dos, no la última marcada', async () => {
    clicEn('Volaris');
    clicEn('Viva Aerobus');
    await yaFiltro();
    expect(filasVisibles()).toContain('de 3 registros');
    expect(document.getElementById('mdb-airline-label').textContent).toBe('2 aerolíneas');
  });

  test('marcar Aeroméxico arrastra las tres razones sociales', async () => {
    clicEn('Aeroméxico');
    await yaFiltro();
    expect(filasVisibles()).toContain('de 5 registros');
  });

  test('volver a hacer clic la desmarca', async () => {
    clicEn('Volaris');
    await yaFiltro();
    expect(filasVisibles()).toContain('de 2 registros');
    clicEn('Volaris');
    await yaFiltro();
    expect(filasVisibles()).toContain('de 8 registros');
  });

  test('con dos marcadas aparece un chip por cada una', async () => {
    clicEn('Volaris');
    clicEn('Aeroméxico');
    await yaFiltro();
    const chips = document.getElementById('mdb-airline-chips');
    expect(chips.querySelectorAll('[data-mdb-al-quitar]')).toHaveLength(2);
    // Y el chip las quita de una sin abrir el panel.
    chips.querySelector('[data-mdb-al-quitar="Volaris"]').click();
    await yaFiltro();
    expect(filasVisibles()).toContain('de 5 registros');
  });

  test('"Todas" marca todo y "Limpiar" lo deja como estaba', async () => {
    const panel = document.getElementById('mdb-airline-panel');
    panel.querySelector('[data-mdb-al-act="todas"]').click();
    await yaFiltro();
    expect(filasVisibles()).toContain('de 8 registros');
    expect(document.getElementById('mdb-airline-label').textContent).toBe('3 aerolíneas');
    panel.querySelector('[data-mdb-al-act="ninguna"]').click();
    await yaFiltro();
    expect(document.getElementById('mdb-airline-label').textContent).toBe('Todas las aerolíneas');
  });

  test('la selección viaja en el input oculto, que es lo que cuenta el badge', () => {
    clicEn('Volaris');
    clicEn('Viva Aerobus');
    expect(document.getElementById('mdb-filter-airline').value).toBe('Volaris|Viva Aerobus');
  });
});

describe('los filtros se aplican solos, sin botón', () => {
  test('ya no hay botón Aplicar en la pantalla', () => {
    const html = require('fs').readFileSync(require('path').join(raiz, 'index.html'), 'utf8');
    expect(html).not.toContain('mdb-btn-apply-filters');
  });

  test('cambiar el mes filtra sin tocar nada más', async () => {
    const mes = document.getElementById('mdb-filter-month');
    mes.value = '02';                       // los ocho vuelos son de enero
    mes.dispatchEvent(new window.Event('change', { bubbles: true }));
    await yaFiltro();
    expect(filasVisibles()).toContain('0 registros');
    mes.value = '01';
    mes.dispatchEvent(new window.Event('change', { bubbles: true }));
    await yaFiltro();
    expect(filasVisibles()).toContain('de 8 registros');
  });

  test('cambiar la dirección también', async () => {
    const dir = document.getElementById('mdb-filter-direction');
    dir.value = 'Salida';                   // todos son llegadas
    dir.dispatchEvent(new window.Event('change', { bubbles: true }));
    await yaFiltro();
    expect(filasVisibles()).toContain('0 registros');
    dir.value = '';
    dir.dispatchEvent(new window.Event('change', { bubbles: true }));
    await yaFiltro();
    expect(filasVisibles()).toContain('de 8 registros');
  });
});
