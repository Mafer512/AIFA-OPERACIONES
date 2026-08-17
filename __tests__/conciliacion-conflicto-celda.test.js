/**
 * @jest-environment node
 *
 * Dos personas capturando la MISMA celda.
 *
 * Lo que ya funcionaba: gana quien está escribiendo en esta pantalla. Su
 * captura no se pisa nunca.
 *
 * Lo que faltaba: enterarse. El valor de la otra persona se descartaba en
 * silencio y, al guardar, esta pantalla sobreescribía el suyo — ninguno de los
 * dos llegaba a saber que habían trabajado sobre la misma celda. Sobre una
 * tabla de manifiestos eso es un dato operativo que desaparece sin rastro.
 *
 * Ahora la celda queda marcada, dice quién puso qué, y ese valor se puede
 * adoptar de un clic.
 */

const { crearServidor, abrirPersona, pintarTabla, esperar } = require('../test-utils/capturistas');

let srv, ana, luis, errores, ids;

beforeAll(async () => {
  errores = [];
  srv = crearServidor();
  ids = [];
  for (let i = 0; i < 6; i++) {
    ids.push(String(srv.sembrar({
      FECHA: '2026-08-17', '# DE VUELO': 9500 + i, 'AEROLÍNEA': 'VOLARIS',
      'MATRÍCULA': '', 'ORIGEN/DESTINO': '', 'TOTAL PAX': null, 'PAX PAGOS': null,
      INFANTES: null, 'TRIPULACIÓN': null, OBSERVACIONES: '', 'CAPTURÓ': '',
    })));
  }
  ana = await abrirPersona('Ana Ruiz', srv, errores);
  luis = await abrirPersona('Luis Prado', srv, errores);
  [ana, luis].forEach((p) => { pintarTabla(p.win, [...srv.filas.values()]); p.win.__t.modoEdicion(true); });
}, 120000);

// Simula el aviso en vivo que manda Luis cuando guarda algo.
const luisGuarda = (fila, col, valor) =>
  ana.win.__t.recibirBroadcast({ rowId: fila, cols: [col], valores: { [col]: valor }, user: 'Luis Prado' });

const celda = (p, fila, col) => p.win.eval(`
  (() => {
    const td = document.querySelector('tr[data-row-id="${fila}"] td[data-col="${col}"]');
    return td ? JSON.stringify({
      conflicto: td.classList.contains('conci-cell-conflicto'),
      titulo: td.title || '',
      marca: !!td.querySelector('.conci-conflicto-marca'),
      valor: td.dataset.pendingRaw !== undefined ? td.dataset.pendingRaw : (td.dataset.raw || ''),
    }) : null;
  })()
`);

describe('cuando la celda está libre', () => {
  test('el valor de la otra persona entra sin marcar nada', async () => {
    const fila = ids[0];
    luisGuarda(fila, 'TOTAL PAX', '180');
    await esperar(200);

    const c = JSON.parse(celda(ana, fila, 'TOTAL PAX'));
    expect(c.valor).toBe('180');
    expect(c.conflicto).toBe(false);
    expect(c.marca).toBe(false);
  });
});

describe('cuando Ana está capturando esa celda', () => {
  const fila = () => ids[1];

  test('lo que escribió Ana no se pisa', async () => {
    ana.win.__t.capturar(fila(), 'TOTAL PAX', '150');
    luisGuarda(fila(), 'TOTAL PAX', '180');
    await esperar(200);

    expect(JSON.parse(celda(ana, fila(), 'TOTAL PAX')).valor).toBe('150');
  });

  test('pero la celda queda marcada, con el nombre y el valor del otro', () => {
    const c = JSON.parse(celda(ana, fila(), 'TOTAL PAX'));
    expect(c.conflicto).toBe(true);
    expect(c.marca).toBe(true);
    expect(c.titulo).toContain('Luis Prado');
    expect(c.titulo).toContain('180');
  });

  test('y se le avisa, diciendo quién y en qué vuelo', async () => {
    await esperar(1100);   // el aviso se agrupa para no salir en cada pulsación
    const avisos = ana.win.__avisos || [];
    const texto = avisos.join(' | ');
    expect(texto).toContain('Luis Prado');
    expect(texto).toMatch(/TOTAL PAX/);
  }, 15000);
});

describe('quedarse con el valor del otro', () => {
  test('un clic en la marca adopta su valor y lo guarda', async () => {
    const fila = ids[2];
    ana.win.__t.capturar(fila, 'OBSERVACIONES', 'lo de Ana');
    luisGuarda(fila, 'OBSERVACIONES', 'lo de Luis');
    await esperar(200);
    expect(JSON.parse(celda(ana, fila, 'OBSERVACIONES')).conflicto).toBe(true);

    ana.win.eval(`
      const td = document.querySelector('tr[data-row-id="${fila}"] td[data-col="OBSERVACIONES"]');
      _conciAdoptarValorRemoto(td);
    `);
    await esperar(1200);

    expect(JSON.parse(celda(ana, fila, 'OBSERVACIONES')).valor).toBe('lo de Luis');
    expect(JSON.parse(celda(ana, fila, 'OBSERVACIONES')).conflicto).toBe(false);
    // Y llega a la base, porque se captura por el camino de siempre.
    expect(srv.filas.get(fila).OBSERVACIONES).toBe('lo de Luis');
  }, 30000);
});

describe('la marca aguanta hasta que se decida', () => {
  test('guardar el valor propio NO borra la marca: el aviso debe llegar a verse', async () => {
    // Antes se borraba al confirmarse el guardado, a los ~400 ms. Nadie llegaba
    // a ver nunca que alguien mas habia puesto otra cosa.
    const fila = ids[3];
    ana.win.__t.capturar(fila, 'MATRÍCULA', 'XA-ANA');
    luisGuarda(fila, 'MATRÍCULA', 'XA-LUIS');
    await esperar(1500);   // el autoguardado ya confirmo el valor de Ana

    expect(srv.filas.get(fila)['MATRÍCULA']).toBe('XA-ANA');
    const c = JSON.parse(celda(ana, fila, 'MATRÍCULA'));
    expect(c.conflicto).toBe(true);
    expect(c.marca).toBe(true);
  }, 30000);

  test('y se retira cuando Ana vuelve a decidir sobre esa celda', async () => {
    const fila = ids[3];
    ana.win.__t.capturar(fila, 'MATRÍCULA', 'XA-OTRA');
    await esperar(1200);

    const c = JSON.parse(celda(ana, fila, 'MATRÍCULA'));
    expect(c.conflicto).toBe(false);
    expect(c.marca).toBe(false);
    expect(srv.filas.get(fila)['MATRÍCULA']).toBe('XA-OTRA');
  }, 30000);
});

describe('no se avisa de lo que no es un choque', () => {
  test('si el otro escribió exactamente lo mismo, no hay conflicto', async () => {
    const fila = ids[4];
    ana.win.__t.capturar(fila, 'TOTAL PAX', '99');
    luisGuarda(fila, 'TOTAL PAX', '99');
    await esperar(200);

    expect(JSON.parse(celda(ana, fila, 'TOTAL PAX')).conflicto).toBe(false);
  }, 30000);
});
