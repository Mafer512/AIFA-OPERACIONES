/**
 * @jest-environment node
 *
 * Cinco capturistas trabajando a la vez sobre la tabla de manifiestos.
 *
 * Cada "persona" es una ventana independiente con TODO script.js cargado —los
 * mismos renglones que corren en producción— y las cinco comparten un Supabase
 * falso que se comporta como el real: guarda, responde lo que quedó guardado, y
 * reparte por realtime lo que cambió a las demás.
 *
 * Se capturan celdas con las MISMAS funciones que usa cualquier editor de la
 * tabla (_conciStageCellDraft + _conciQueueAutoSave), no con atajos, así que lo
 * que se ejerce aquí es la ruta real de guardado.
 *
 * Lo que se quiere demostrar es una sola cosa, la que importa: que con cinco
 * personas encima no se pierde ni una captura.
 *
 * No toca la base de producción; los datos son inventados.
 */

const { crearServidor, abrirPersona, pintarTabla, COLUMNAS, esperar } = require('../test-utils/capturistas');

const NOMBRES = ['Ana Ruiz', 'Luis Prado', 'Marta Solis', 'Diego Cano', 'Sofia Lara'];

let srv;
let personas;
let ids;
let errores;

function sembrarFilas(n) {
  const lista = [];
  for (let i = 0; i < n; i++) {
    lista.push(String(srv.sembrar({
      FECHA: '2026-08-17',
      '# DE VUELO': 9500 + i,
      'AEROLÍNEA': i % 2 ? 'VIVA AEROBUS' : 'VOLARIS',
      'MATRÍCULA': '', 'ORIGEN/DESTINO': '', 'TOTAL PAX': null, 'PAX PAGOS': null,
      INFANTES: null, 'TRIPULACIÓN': null, OBSERVACIONES: '', 'CAPTURÓ': '',
    })));
  }
  return lista;
}

beforeAll(async () => {
  errores = [];
  srv = crearServidor();
  ids = sembrarFilas(45);   // cinco filas propias por persona para la prueba de volumen
  personas = [];
  for (const n of NOMBRES) personas.push(await abrirPersona(n, srv, errores));
  const filas = [...srv.filas.values()];
  personas.forEach((p) => { pintarTabla(p.win, filas); p.win.__t.modoEdicion(true); });
}, 120000);

const valor = (fila, col) => srv.filas.get(fila)[col];

describe('las cinco pueden capturar', () => {
  test.each(NOMBRES)('%s tiene permiso de captura', (nombre) => {
    const p = personas.find((x) => x.nombre === nombre);
    expect(p.win.__t.puedeEditar()).toBe(true);
  });
});

describe('cinco personas en cinco filas distintas, a la vez', () => {
  test('llega íntegro lo que capturó cada una', async () => {
    personas.forEach((p, i) => {
      p.win.__t.capturar(ids[i], 'TOTAL PAX', String(150 + i));
      p.win.__t.capturar(ids[i], 'MATRÍCULA', `XA-${100 + i}`);
      p.win.__t.capturar(ids[i], 'OBSERVACIONES', `capturado por ${p.nombre}`);
    });
    await esperar(1500);

    personas.forEach((p, i) => {
      expect(String(valor(ids[i], 'TOTAL PAX'))).toBe(String(150 + i));
      expect(valor(ids[i], 'MATRÍCULA')).toBe(`XA-${100 + i}`);
      expect(valor(ids[i], 'OBSERVACIONES')).toBe(`capturado por ${p.nombre}`);
    });
  }, 30000);
});

describe('varias personas sobre LA MISMA fila', () => {
  test('dos personas, columnas distintas: ninguna pisa a la otra', async () => {
    const fila = ids[7];
    personas[0].win.__t.capturar(fila, 'TOTAL PAX', '200');
    personas[1].win.__t.capturar(fila, 'OBSERVACIONES', 'lo escribió Luis');
    await esperar(1500);

    expect(String(valor(fila, 'TOTAL PAX'))).toBe('200');
    expect(valor(fila, 'OBSERVACIONES')).toBe('lo escribió Luis');
  }, 30000);

  test('las cinco a la vez, cinco columnas: sobreviven las cinco', async () => {
    const fila = ids[8];
    const cols = ['TOTAL PAX', 'PAX PAGOS', 'INFANTES', 'TRIPULACIÓN', 'MATRÍCULA'];
    const vals = ['180', '175', '5', '6', 'XA-ZZZ'];
    personas.forEach((p, i) => p.win.__t.capturar(fila, cols[i], vals[i]));
    await esperar(1800);

    cols.forEach((c, i) => expect(String(valor(fila, c))).toBe(vals[i]));
  }, 30000);

  test('la misma celda: gana la última, y el valor queda íntegro', async () => {
    // No hay control de concurrencia por celda: quien escribe al final manda.
    // Lo que NO puede pasar es que quede un valor a medias, mezcla de dos.
    const fila = ids[9];
    personas.forEach((p, i) => p.win.__t.capturar(fila, 'TOTAL PAX', String(200 + i)));
    await esperar(1500);

    const posibles = NOMBRES.map((_, i) => String(200 + i));
    expect(posibles).toContain(String(valor(fila, 'TOTAL PAX')));
  }, 30000);
});

describe('el tecleo se agrupa, pero no se pierde', () => {
  test('quince cambios seguidos guardan el último, en una sola escritura', async () => {
    const fila = ids[10];
    const antes = srv.bitacora.filter((b) => b.id === fila).length;
    for (let i = 1; i <= 15; i++) personas[0].win.__t.capturar(fila, 'OBSERVACIONES', `texto ${i}`);
    await esperar(1500);

    expect(valor(fila, 'OBSERVACIONES')).toBe('texto 15');
    const escrituras = srv.bitacora.filter((b) => b.id === fila).length - antes;
    expect(escrituras).toBeLessThanOrEqual(2);   // el retardo agrupa las pulsaciones
  }, 30000);
});

describe('si la base falla, la captura no se pierde', () => {
  test('queda en el borrador local y sigue en pantalla', async () => {
    const fila = ids[11];
    srv.fallarFila = fila;   // esta fila y solo esta rechaza escrituras
    personas[1].win.__t.capturar(fila, 'OBSERVACIONES', 'no se debe perder');
    await esperar(1200);

    expect(JSON.stringify(personas[1].win.__t.borradores())).toContain('no se debe perder');
    expect(personas[1].win.__t.leer(fila, 'OBSERVACIONES')).toBe('no se debe perder');
  }, 30000);

  test('y el reintento automático acaba guardándola sin que nadie haga nada', async () => {
    // El primer reintento va a los 15 s (_CONCI_REINTENTO_MIN_MS) y de ahí
    // duplicando. Esta prueba espera de verdad ese tiempo: es la garantía de
    // que una captura hecha durante un corte de red termina en la base.
    const fila = ids[11];
    srv.fallarFila = null;   // "vuelve la red"
    let recuperada = false;
    for (let i = 0; i < 40 && !recuperada; i++) {
      await esperar(1000);
      recuperada = valor(fila, 'OBSERVACIONES') === 'no se debe perder';
    }
    expect(recuperada).toBe(true);
    // Y el borrador se limpia solo cuando la base confirma ese valor exacto.
    expect(JSON.stringify(personas[1].win.__t.borradores())).not.toContain('no se debe perder');
  }, 60000);
});

describe('CAPTURÓ sobrevive a un corte de red', () => {
  // Antes se perdía en silencio. Al autocompletarse, la celda se pintaba con el
  // nombre y quedaba LIMPIA: ya no estaba vacía —así que el autocompletado no
  // volvía a entrar— ni estaba sucia —así que no entraba en el payload—. Si la
  // primera escritura fallaba, el reintento guardaba las demás columnas y
  // CAPTURÓ se quedaba fuera para siempre: la pantalla mostraba el nombre y la
  // base lo tenía vacío. Nadie se enteraba.
  test('se guarda aunque la primera escritura falle', async () => {
    const fila = ids[40];
    srv.fallarFila = fila;
    personas[3].win.__t.capturar(fila, 'TOTAL PAX', '123');
    await esperar(1200);

    // Mientras la base lo rechaza, el nombre ya está a salvo en el borrador.
    expect(JSON.stringify(personas[3].win.__t.borradores())).toContain('Diego Cano');

    srv.fallarFila = null;
    let listo = false;
    for (let i = 0; i < 40 && !listo; i++) {
      await esperar(1000);
      listo = String(valor(fila, 'TOTAL PAX')) === '123';
    }
    expect(listo).toBe(true);
    expect(valor(fila, 'CAPTURÓ')).toBe('Diego Cano');
    // Lo que se ve en pantalla y lo que hay en la base coinciden.
    expect(personas[3].win.__t.leer(fila, 'CAPTURÓ')).toBe('Diego Cano');
  }, 60000);
});

describe('volumen', () => {
  test('cien capturas repartidas entre las cinco llegan completas', async () => {
    const cols = ['TOTAL PAX', 'PAX PAGOS', 'INFANTES', 'TRIPULACIÓN'];
    const esperado = new Map();
    personas.forEach((p, pi) => {
      for (let k = 0; k < 20; k++) {
        const fila = ids[12 + pi * 5 + (k % 5)];        // cinco filas por persona
        const col = cols[Math.floor(k / 5)];           // y una columna por tanda
        const val = String(pi * 100 + k + 1);
        p.win.__t.capturar(fila, col, val);
        esperado.set(`${fila}|${col}`, val);      // el último en escribir manda
      }
    });
    await esperar(4000);

    const perdidas = [];
    esperado.forEach((val, clave) => {
      const [fila, col] = clave.split('|');
      if (String(valor(fila, col)) !== String(val)) perdidas.push(`${fila}/${col}`);
    });
    expect(perdidas).toEqual([]);
    expect(esperado.size).toBe(100);
  }, 60000);
});

describe('lo que captura una, lo ven las demás', () => {
  test('el aviso en vivo actualiza la celda en las otras cuatro pantallas', async () => {
    const fila = ids[0];
    const aviso = { rowId: fila, cols: ['TOTAL PAX'], valores: { 'TOTAL PAX': '999' }, user: 'Ana Ruiz' };
    personas.slice(1).forEach((p) => p.win.__t.recibirBroadcast(aviso));
    await esperar(300);

    personas.slice(1).forEach((p) => {
      expect(String(p.win.__t.leer(fila, 'TOTAL PAX'))).toBe('999');
    });
  }, 30000);
});

describe('filas nuevas creadas a la vez', () => {
  test('las cinco crean una fila y ninguna se pierde ni colisiona', async () => {
    personas.forEach((p, i) => {
      p.win.eval(`
        const tbody = document.querySelector('#table-conci-manifiestos tbody');
        const tr = document.createElement('tr');
        tr.dataset.conciNew = '1';
        tr.dataset.rowFuente = 'Manifiestos + Vuelos';
        tr.innerHTML = ${JSON.stringify(COLUMNAS.map((c) => `<td data-col="${c}" data-raw=""></td>`).join(''))};
        tbody.appendChild(tr);
        const pon = (col, val) => _conciStageCellDraft(tr.querySelector('td[data-col="' + col + '"]'), val);
        pon('# DE VUELO', '${7000 + i}');
        pon('AEROLÍNEA', 'AEROMEXICO');
        pon('TOTAL PAX', '${50 + i}');
        pon('OBSERVACIONES', 'fila nueva de ${NOMBRES[i]}');
        _conciQueueAutoSave(tr);
      `);
    });
    await esperar(2500);

    const nuevas = [...srv.filas.values()].filter((f) => String(f['# DE VUELO']).startsWith('7'));
    expect(nuevas).toHaveLength(5);
    expect(new Set(nuevas.map((f) => f.id)).size).toBe(5);   // sin ids repetidos

    NOMBRES.forEach((n, i) => {
      const f = nuevas.find((x) => String(x['# DE VUELO']) === String(7000 + i));
      expect(f).toBeDefined();
      expect(String(f['TOTAL PAX'])).toBe(String(50 + i));
      expect(f.OBSERVACIONES).toBe(`fila nueva de ${n}`);
    });
  }, 60000);

  test('CAPTURÓ se rellena solo con quien capturó cada fila', async () => {
    const nuevas = [...srv.filas.values()].filter((f) => String(f['# DE VUELO']).startsWith('7'));
    nuevas.forEach((f) => {
      const i = Number(String(f['# DE VUELO'])) - 7000;
      expect(f['CAPTURÓ']).toBe(NOMBRES[i]);
    });
  });
});

describe('al final de la jornada', () => {
  test('nadie se queda con borradores sin guardar', () => {
    personas.forEach((p) => {
      expect(Object.keys(p.win.__t.borradores())).toEqual([]);
    });
  });

  test('ninguna ventana lanzó un error de la tabla de manifiestos', () => {
    // El arranque sin index.html produce ruido ajeno al módulo (dataManager,
    // setupEventListeners); lo que no puede haber es un error de Conciliación.
    //
    // "fila pendiente de guardar" SÍ es esperado: es el aviso que el módulo
    // emite durante el corte de red que se provoca a propósito más arriba.
    // Que aparezca es señal de que el mecanismo funcionó, no de que algo falle.
    const propios = errores.filter((e) => /conci|Conciliación|manifiest/i.test(e)
      && !/fila pendiente de guardar/.test(e));
    expect(propios).toEqual([]);
  });
});
