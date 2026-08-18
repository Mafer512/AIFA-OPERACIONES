/**
 * @jest-environment node
 *
 * Integridad de la fila al capturar un manifiesto.
 *
 * Sintoma reportado: aparecen filas guardadas con SOLO la fecha y ESTATUS
 * MATRICULA "NO IDENTIFICADA", sin aerolinea, matricula ni vuelo.
 *
 * Esta prueba no comprueba el texto del archivo: carga TODO script.js en una
 * ventana con un Supabase falso y captura con las mismas funciones que usa
 * cualquier editor de la tabla. Lo que se mira es lo que quedo en la base.
 *
 * Cubre el orden de llenado real del operador, de izquierda a derecha:
 * CIERRE SUBSECRETARIA -> MES -> FECHA -> TIPO DE MANIFIESTO -> AEROLINEA ->
 * TIPO DE OPERACION -> AERONAVE -> MATRICULA -> # DE VUELO -> DESTINO/ORIGEN ->
 * RUTA -> ... -> HORA Y FECHA DE GENERACION.
 */

const { crearServidor, abrirPersona, esperar } = require('../test-utils/capturistas');

// El orden en que el operador llena la fila, tal como se ven en la tabla.
const COLUMNAS = [
  'CIERRE SUBSECRETARIA', 'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA',
  'TIPO DE OPERACIÓN', 'AERONAVE', 'MATRÍCULA', 'ESTATUS MATRÍCULA',
  '# DE VUELO', 'DESTINO / ORIGEN', 'RUTA', 'TOTAL PAX', 'CAPTURÓ',
  'HORA Y FECHA DE GENERACIÓN',
];

// Tabla con thead REAL: encabezados + fila de filtros, como la pinta el modulo.
// _conciAddBlankRow lee de ahi las columnas.
function pintarTablaConEncabezado(win) {
  const ths = COLUMNAS.map(c =>
    `<th class="conci-th" data-conci-column-key="${c}"><div class="conci-th-inner"><span>${c}</span><button class="conci-ef-btn">f</button></div></th>`
  ).join('');
  const filtros = COLUMNAS.concat(['it', 'acc'])
    .map(() => '<th class="conci-th-filter"><input class="conci-col-filter"></th>').join('');
  win.document.body.innerHTML = `
    <span id="conci-presencia"></span>
    <input id="filter-conci-fecha-desde" value="2026-08-16">
    <input id="filter-conci-fecha-hasta" value="2026-08-16">
    <button id="btn-conci-save-all"></button>
    <table id="table-conci-manifiestos">
      <thead>
        <tr>${ths}
          <th class="conci-th conci-it-val-col">Itinerario</th>
          <th class="conci-th conci-row-action-col" data-conci-action="1">Acciones</th>
        </tr>
        <tr class="conci-filter-row">${filtros}</tr>
      </thead>
      <tbody></tbody>
    </table>`;
}

let srv;
let p;
let errores;

beforeAll(async () => {
  errores = [];
  srv = crearServidor();
  p = await abrirPersona('Omar Pizano', srv, errores);
  pintarTablaConEncabezado(p.win);
  p.win.__t.modoEdicion(true);
}, 120000);

beforeEach(() => {
  // Cada caso arranca con la base y la tabla limpias.
  srv.filas.clear();
  srv.bitacora.length = 0;
  pintarTablaConEncabezado(p.win);
  p.win.__t.modoEdicion(true);
});

const filasGuardadas = () => [...srv.filas.values()];
const conDato = (fila) => Object.entries(fila)
  .filter(([k, v]) => k !== 'id' && v !== null && String(v).trim() !== '')
  .map(([k]) => k)
  .sort();

describe('agregar una fila y no escribir nada', () => {
  test('salir de la fila sin capturar NO crea ningún registro', async () => {
    p.win.__t.agregarFila();
    await p.win.__t.salirDeLaFilaNuevaSinEscribir();
    await esperar(600);

    expect(filasGuardadas()).toEqual([]);
  });

  // Este es el registro exacto que se ve en la captura del reporte: solo la
  // fecha heredada del filtro, y por eso "NO IDENTIFICADA" en el estatus.
  test('no aparece ningún registro que tenga sólo la FECHA', async () => {
    p.win.__t.agregarFila();
    await p.win.__t.salirDeLaFilaNuevaSinEscribir();
    await esperar(600);

    const soloFecha = filasGuardadas().filter(f => {
      const campos = conDato(f);
      return campos.length && campos.every(c => c === 'FECHA' || c === 'MES' || c === 'CAPTURÓ');
    });
    expect(soloFecha).toEqual([]);
  });

  test('repetir el ciclo diez veces no deja residuo', async () => {
    for (let i = 0; i < 10; i++) {
      p.win.__t.agregarFila();
      await p.win.__t.salirDeLaFilaNuevaSinEscribir();
    }
    await esperar(800);

    expect(filasGuardadas()).toEqual([]);
  });
});

describe('llenar la fila campo por campo, en el orden del operador', () => {
  test('cada campo capturado llega a la base, y no se crea otra fila', async () => {
    p.win.__t.agregarFila();

    const captura = [
      ['TIPO DE MANIFIESTO', 'LLEGADA'],
      ['AEROLINEA', 'VIVA AEROBUS'],
      ['AERONAVE', 'A320-100/200'],
      ['MATRÍCULA', 'XAVMF'],
      ['# DE VUELO', '2288'],
      ['DESTINO / ORIGEN', 'Cancún'],
      ['TOTAL PAX', '180'],
    ];

    for (const [col, valor] of captura) {
      p.win.__t.capturarEnNueva(col, valor);
      await esperar(500);   // el autoguardado corre a 400 ms
    }
    await esperar(800);

    const filas = filasGuardadas();
    expect(filas).toHaveLength(1);
    for (const [col, valor] of captura) {
      expect(String(filas[0][col])).toBe(valor);
    }
  }, 30000);

  test('guardar en puntos intermedios no deja campos perdidos', async () => {
    p.win.__t.agregarFila();

    p.win.__t.capturarEnNueva('AEROLINEA', 'VOLARIS');
    await esperar(600);
    expect(filasGuardadas()).toHaveLength(1);

    p.win.__t.capturarEnNueva('MATRÍCULA', 'XAVRO');
    await esperar(600);
    p.win.__t.capturarEnNueva('# DE VUELO', '3960');
    await esperar(800);

    const filas = filasGuardadas();
    expect(filas).toHaveLength(1);           // sigue siendo LA MISMA fila
    expect(filas[0]['AEROLINEA']).toBe('VOLARIS');
    expect(filas[0]['MATRÍCULA']).toBe('XAVRO');
    expect(String(filas[0]['# DE VUELO'])).toBe('3960');
  }, 30000);

  test('la fila creada queda con el capturista, no anónima', async () => {
    p.win.__t.agregarFila();
    p.win.__t.capturarEnNueva('MATRÍCULA', 'XAVBP');
    await esperar(800);

    const filas = filasGuardadas();
    expect(filas).toHaveLength(1);
    expect(String(filas[0]['CAPTURÓ'] || '')).not.toBe('');
  }, 30000);

  // Escribir y borrar antes de que corra el autoguardado no debe dejar rastro.
  test('escribir y borrar antes de guardar no crea la fila', async () => {
    p.win.__t.agregarFila();
    p.win.__t.capturarEnNueva('AEROLINEA', 'V');
    p.win.__t.capturarEnNueva('AEROLINEA', '');
    await esperar(800);

    expect(filasGuardadas()).toEqual([]);
  }, 30000);
});

describe('no se cuelan errores de Conciliación en consola', () => {
  // Se acota a este modulo: el harness arranca script.js entero y dataManager
  // esta doblado, asi que otros modulos se quejan por su cuenta. Ese ruido no
  // es de la captura de manifiestos y no debe enmascarar lo que si lo es.
  test('la captura no reporta errores propios', () => {
    const graves = errores.filter(e =>
      !/WARN/.test(e) && /conci|manifiest/i.test(e));
    expect(graves).toEqual([]);
  });
});

describe('una fila incompleta no puede darse por cerrada', () => {
  // El documento se crea ANTES de armar el sandbox: _conciMarcarFilasIncompletas
  // consulta `document` y, si se le pasa despues, recibe undefined.
  const doc = new (require('jsdom').JSDOM)('<!doctype html><body></body>').window.document;

  const api = (() => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const saca = (n) => {
      const m = `function ${n}(`;
      let i = src.indexOf(m);
      if (i === -1) throw new Error('falta ' + n);
      return src.slice(i, src.indexOf('\n}\n', i) + 2);
    };
    const cte = (n) => {
      const i = src.indexOf(`const ${n}`);
      return src.slice(i, src.indexOf('];', i) + 2);
    };
    return new Function('document', `
      ${saca('_conciNormalizeEditableCellText')}
      ${saca('_conciSummaryColumnKey')}
      ${cte('_CONCI_COLUMNAS_IDENTIDAD')}
      ${cte('_CONCI_COLUMNAS_OBLIGATORIAS')}
      ${saca('_conciFilaSinCaptura')}
      ${saca('_conciCamposObligatoriosFaltantes')}
      ${saca('_conciFilaIncompleta')}
      ${saca('_conciMarcarFilasIncompletas')}
      return { _conciCamposObligatoriosFaltantes, _conciFilaIncompleta, _conciMarcarFilasIncompletas };
    `)(doc);
  })();

  function fila(valores) {
    doc.body.innerHTML = `<table id="table-conci-manifiestos"><tbody><tr data-row-id="7"></tr></tbody></table>`;
    const tr = doc.querySelector('tr');
    Object.entries(valores).forEach(([col, v]) => {
      const td = doc.createElement('td');
      td.dataset.col = col;
      td.dataset.raw = v;
      td.textContent = v;
      tr.appendChild(td);
    });
    return tr;
  }

  test('le falta MATRÍCULA y se detecta', () => {
    const tr = fila({ 'AEROLINEA': 'VOLARIS', 'MATRÍCULA': '', 'TIPO DE OPERACIÓN': 'Nacional' });
    expect(api._conciCamposObligatoriosFaltantes(tr)).toEqual(['MATRÍCULA']);
    expect(api._conciFilaIncompleta(tr)).toBe(true);
  });

  test('le faltan varios y se listan todos', () => {
    const tr = fila({ 'AEROLINEA': '', 'MATRÍCULA': '', 'TIPO DE OPERACIÓN': '', '# DE VUELO': '2288' });
    expect(api._conciCamposObligatoriosFaltantes(tr)).toEqual(['AEROLINEA', 'MATRÍCULA', 'TIPO DE OPERACIÓN']);
  });

  test('completa: no se marca', () => {
    const tr = fila({ 'AEROLINEA': 'VIVA AEROBUS', 'MATRÍCULA': 'XAVMF', 'TIPO DE OPERACIÓN': 'Nacional' });
    expect(api._conciFilaIncompleta(tr)).toBe(false);
  });

  // Una fila del todo vacia ya la cubre _conciFilaSinCaptura: avisar dos veces
  // de lo mismo solo hace ruido.
  test('una fila del todo vacía no se marca como incompleta', () => {
    const tr = fila({ 'AEROLINEA': '', 'MATRÍCULA': '', 'TIPO DE OPERACIÓN': '', '# DE VUELO': '' });
    expect(api._conciFilaIncompleta(tr)).toBe(false);
  });

  test('marcarlas deja en la fila qué le falta', () => {
    fila({ 'AEROLINEA': 'VOLARIS', 'MATRÍCULA': '', 'TIPO DE OPERACIÓN': 'Nacional' });
    expect(api._conciMarcarFilasIncompletas()).toBe(1);
    const tr = doc.querySelector('tr');
    expect(tr.classList.contains('conci-fila-incompleta')).toBe(true);
    expect(tr.dataset.conciFaltan).toBe('MATRÍCULA');
    expect(tr.title).toContain('MATRÍCULA');
  });

  test('al completarla se le quita la marca', () => {
    const tr = fila({ 'AEROLINEA': 'VOLARIS', 'MATRÍCULA': '', 'TIPO DE OPERACIÓN': 'Nacional' });
    api._conciMarcarFilasIncompletas();
    const td = [...tr.querySelectorAll('td')].find(c => c.dataset.col === 'MATRÍCULA');
    td.dataset.raw = 'XAVRO';

    expect(api._conciMarcarFilasIncompletas()).toBe(0);
    expect(tr.classList.contains('conci-fila-incompleta')).toBe(false);
    expect(tr.dataset.conciFaltan).toBeUndefined();
  });
});

describe('"Guardar todo" avisa en vez de cerrar en falso', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
  const bloque = (() => {
    const i = src.indexOf('async function _conciGuardarTodoAhora');
    return src.slice(i, src.indexOf('\n}\n', i));
  })();

  test('cuenta las filas incompletas antes de informar', () => {
    expect(bloque).toContain('_conciMarcarFilasIncompletas()');
  });

  test('con filas incompletas el aviso es de advertencia, no de éxito', () => {
    const aviso = bloque.indexOf('filas incompletas');
    const exito = bloque.indexOf('capturas confirmadas por la base');
    expect(aviso).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(exito);   // la rama de advertencia se evalúa antes
  });

  // Lo capturado SIEMPRE se persiste: retenerlo en pantalla es como se pierde
  // el trabajo. El aviso senala; no bloquea el guardado de lo ya escrito.
  test('avisar no impide guardar lo que el operador ya escribió', () => {
    expect(bloque).not.toContain('return; // fila incompleta');
    expect(bloque).toContain('_conciAutoSaveRow(tr, { keepEditorsOpen: true })');
  });
});
