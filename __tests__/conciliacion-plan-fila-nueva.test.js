/**
 * Plan de pruebas de la fila que se creaba sola.
 *
 * Corre el script.js completo dentro de una ventana real (JSDOM) contra un
 * Supabase simulado que se comporta como el de producción: guarda filas y
 * devuelve lo que quedó guardado. Lo que se comprueba en cada caso es la
 * misma pregunta: ¿cuántas filas hay en la base y cuántas en pantalla?
 *
 * La regla que defiende: una fila nueva se crea única y exclusivamente cuando
 * el usuario pulsa "+ Agregar fila" y captura algo en ella. Ningún otro evento
 * —salir de la última celda con Tab, Enter o un clic fuera, repintar la tabla,
 * "Guardar todo", o volver a abrir la pestaña— puede dar origen a un registro.
 */

const {
  crearServidor,
  abrirPersona,
  esperar,
  volcarAlmacenamiento,
} = require('../test-utils/capturistas');

// Las mismas columnas que dibuja el módulo, con las dos que van bloqueadas en
// una fila nueva (MES y FECHA las completa el sistema) y una calculada.
const COLUMNAS = [
  'MES', 'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', 'MATRÍCULA',
  '# DE VUELO', 'TOTAL PAX', 'KGS. DE EQUIPAJE', 'OBSERVACIONES', 'CAPTURÓ',
];

// La tabla tal y como la deja el render: encabezados con data-conci-column-key,
// la fila de filtros ("Filtrar…") que también vive en el thead, y el cuerpo.
// _conciAddBlankRow lee de ahí las columnas, así que el thead tiene que estar.
function pintar(win, filas) {
  const ths = COLUMNAS.map(c => `<th data-conci-column-key="${c}">${c}</th>`).join('');
  const filtros = COLUMNAS.map(() => '<th><input class="form-control" placeholder="Filtrar…"></th>').join('');
  const cuerpo = filas.map(f => `
    <tr data-row-id="${f.id}" data-row-index="${f.id}" data-row-fuente="Manifiestos + Vuelos">
      ${COLUMNAS.map(c => `<td data-col="${c}" data-raw="${f[c] ?? ''}" data-orig-raw="${f[c] ?? ''}">${f[c] ?? ''}</td>`).join('')}
    </tr>`).join('');
  win.document.body.innerHTML = `
    <span id="conci-presencia"></span>
    <table id="table-conci-manifiestos">
      <thead><tr>${ths}</tr><tr class="conci-filter-row">${filtros}</tr></thead>
      <tbody>${cuerpo}</tbody>
    </table>`;
}

// Las herramientas de esta prueba, evaluadas dentro de la misma ventana para
// poder ver las variables internas del módulo (let/const de script.js).
const HERRAMIENTAS = `
  window.alert = function () {};
  window.__p = {
    agregarFila() { _conciAddBlankRow(); },
    filasEnPantalla() {
      return document.querySelectorAll('#table-conci-manifiestos tbody tr').length;
    },
    filasNuevas() {
      return document.querySelectorAll('#table-conci-manifiestos tbody tr[data-conci-new="1"]').length;
    },
    // Columnas de la fila nueva en las que de verdad se puede escribir.
    camposLibres() {
      const tr = document.querySelector('#table-conci-manifiestos tbody tr[data-conci-new="1"]');
      if (!tr) return [];
      return [...tr.querySelectorAll('td[data-col]:not([data-conci-readonly="1"])')]
        .map(td => td.dataset.col);
    },
    // Escribe en una celda de la fila nueva pasando por el editor de verdad y
    // sale como saldría una persona: Tab, Enter o clic fuera.
    escribir(col, valor, salida) {
      const tr = document.querySelector('#table-conci-manifiestos tbody tr[data-conci-new="1"]')
        || window.__ultimaNueva;
      if (!tr) throw new Error('no hay fila nueva en pantalla');
      window.__ultimaNueva = tr;
      const td = tr.querySelector('td[data-col="' + col + '"]');
      if (!td) throw new Error('no existe la columna ' + col);
      if (typeof td._conciCloseEditor !== 'function') _conciActivateCellEditor(td);
      const input = td.querySelector('input.conci-cell-input');
      // Fecha y los desplegables (tipo de manifiesto, routing…) abren su propio
      // editor, no un cuadro de texto. Aquí se cierran sin tocarlos: lo que
      // esta prueba mide es cuántas filas nacen, no cada tipo de editor.
      if (!input) {
        if (typeof td._conciCloseEditor === 'function') td._conciCloseEditor(false, false);
        return false;
      }
      input.value = valor;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (salida === 'tab') {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      } else if (salida === 'enter') {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      } else {
        input.dispatchEvent(new FocusEvent('blur'));
      }
      return true;
    },
    // Un clic en cualquier parte fuera de la tabla: cierra el editor abierto.
    clicFuera() {
      document.querySelectorAll('#table-conci-manifiestos td[data-col]').forEach(td => {
        if (typeof td._conciCloseEditor === 'function') td._conciCloseEditor(true, false);
      });
    },
    guardarTodo() { return _conciGuardarTodoAhora(); },
    modoEdicion(v) { _conciEditMode = v; },
    escrituraEnCurso() { return _conciPendingAutoSaveCount; },
  };
`;

async function abrir(servidor, errores, almacenamiento) {
  const persona = await abrirPersona('Ana Ruiz', servidor, errores, { almacenamiento });
  pintar(persona.win, [
    { id: 101, 'MES': 'Agosto', 'FECHA': '16/08/2026', 'AEROLINEA': 'VIVA AEROBUS', '# DE VUELO': '7305' },
    { id: 102, 'MES': 'Agosto', 'FECHA': '16/08/2026', 'AEROLINEA': 'AEROMÉXICO', '# DE VUELO': '9449' },
  ]);
  persona.win.eval(HERRAMIENTAS);
  persona.win.__p.modoEdicion(true);
  return persona;
}

let srv;
let errores;
let ana;

beforeEach(async () => {
  srv = crearServidor();
  srv.sembrar({ id: 101 });
  srv.sembrar({ id: 102 });
  errores = [];
  ana = await abrir(srv, errores);
});

describe('1. capturar un manifiesto completo y salir de la fila', () => {
  test('con Tab, Enter y clic fuera no aparece ninguna fila de más', async () => {
    const antes = srv.filas.size;
    ana.win.__p.agregarFila();

    const libres = ana.win.__p.camposLibres();
    expect(libres.length).toBeGreaterThan(0);

    // Se llena campo por campo saliendo con Tab, como se captura de verdad.
    let llenados = 0;
    libres.forEach((col, i) => {
      const valor = /PAX|KGS/.test(col) ? String(100 + i) : `DATO ${i}`;
      if (ana.win.__p.escribir(col, valor, 'tab')) llenados++;
    });
    expect(llenados).toBeGreaterThan(3);

    // Y el último campo se abandona de las tres formas posibles, una tras otra:
    // son los tres gestos con los que se reportó que aparecía la fila de más.
    const ultimo = libres[libres.length - 1];
    ana.win.__p.escribir(ultimo, 'FINAL-ENTER', 'enter');
    ana.win.__p.escribir(ultimo, 'FINAL-BLUR', 'clic');
    ana.win.__p.clicFuera();

    await esperar(1200);

    // Exactamente una fila nueva: la que se capturó. Ni una más.
    expect(srv.filas.size).toBe(antes + 1);
  }, 30000);
});

describe('2. el botón "+ Agregar fila"', () => {
  test('crea exactamente una fila, ni más ni menos', async () => {
    const enPantallaAntes = ana.win.__p.filasEnPantalla();

    ana.win.__p.agregarFila();

    expect(ana.win.__p.filasEnPantalla()).toBe(enPantallaAntes + 1);
    expect(ana.win.__p.filasNuevas()).toBe(1);
  });

  test('pulsarlo varias veces sin capturar no apila filas en blanco', async () => {
    const enPantallaAntes = ana.win.__p.filasEnPantalla();
    const enBaseAntes = srv.filas.size;

    ana.win.__p.agregarFila();
    ana.win.__p.agregarFila();
    ana.win.__p.agregarFila();
    await esperar(900);

    // La fila en blanco se reutiliza en vez de duplicarse, y ninguna llega a
    // la base: nadie capturó nada en ellas.
    expect(ana.win.__p.filasNuevas()).toBe(1);
    expect(ana.win.__p.filasEnPantalla()).toBe(enPantallaAntes + 1);
    expect(srv.filas.size).toBe(enBaseAntes);
  }, 30000);

  test('abrir el editor y salir sin escribir tampoco crea el registro', async () => {
    const enBaseAntes = srv.filas.size;

    ana.win.__p.agregarFila();
    // "+ Agregar fila" deja el cursor abierto en la primera celda editable.
    // Salir de ahí sin teclear nada es el gesto que creaba la fila fantasma.
    ana.win.__p.clicFuera();
    await esperar(900);

    expect(srv.filas.size).toBe(enBaseAntes);
  }, 30000);
});

describe('3. repintar la tabla (refrescar, cambiar fechas, filtrar)', () => {
  test('el número de filas se mantiene y no nacen filas vacías', async () => {
    const enBaseAntes = srv.filas.size;

    // Cada repintado es lo que hace el módulo al refrescar, al cambiar el rango
    // de fechas o al limpiar filtros: reconstruye el cuerpo de la tabla.
    for (let i = 0; i < 5; i++) {
      pintar(ana.win, [
        { id: 101, 'MES': 'Agosto', 'FECHA': '16/08/2026' },
        { id: 102, 'MES': 'Agosto', 'FECHA': '16/08/2026' },
      ]);
      await esperar(120);
    }
    await esperar(600);

    expect(srv.filas.size).toBe(enBaseAntes);
    expect(ana.win.__p.filasEnPantalla()).toBe(2);
    expect(ana.win.__p.filasNuevas()).toBe(0);
  }, 30000);
});

describe('4. "Guardar todo"', () => {
  test('con una fila nueva en blanco no escribe nada en la base', async () => {
    const enBaseAntes = srv.filas.size;

    ana.win.__p.agregarFila();
    ana.win.__p.clicFuera();
    await ana.win.__p.guardarTodo();
    await esperar(900);

    expect(srv.filas.size).toBe(enBaseAntes);
  }, 30000);

  test('con una fila capturada guarda esa fila y sólo esa', async () => {
    const enBaseAntes = srv.filas.size;

    ana.win.__p.agregarFila();
    ana.win.__p.escribir('AEROLINEA', 'EMIRATES', 'tab');
    ana.win.__p.escribir('# DE VUELO', '9935', 'tab');
    ana.win.__p.clicFuera();
    await ana.win.__p.guardarTodo();
    await esperar(1200);

    expect(srv.filas.size).toBe(enBaseAntes + 1);
    const creada = [...srv.filas.values()].find(f => String(f['# DE VUELO']) === '9935');
    expect(creada).toBeDefined();
    expect(creada.AEROLINEA).toBe('EMIRATES');
  }, 30000);
});

describe('5. volver a abrir la pestaña', () => {
  test('no reaparece ninguna fila vacía de la sesión anterior', async () => {
    // Se agrega una fila y se abandona sin capturar, que es como quedaban las
    // filas en blanco. Después se cierra la pestaña y se vuelve a entrar con el
    // mismo localStorage, igual que una recarga de verdad.
    ana.win.__p.agregarFila();
    ana.win.__p.clicFuera();
    await esperar(900);

    const almacenamiento = volcarAlmacenamiento(ana.win);

    const enBaseAntes = srv.filas.size;
    ana = await abrir(srv, errores, almacenamiento);
    await esperar(900);

    expect(srv.filas.size).toBe(enBaseAntes);
    expect(ana.win.__p.filasNuevas()).toBe(0);
    expect(ana.win.__p.filasEnPantalla()).toBe(2);
  }, 30000);
});

describe('la ventana no se rompió por el camino', () => {
  test('ningún error de la tabla de manifiestos', () => {
    const graves = errores.filter(e => /conciliaci/i.test(e) && !/WARN/.test(e));
    expect(graves).toEqual([]);
  });
});
