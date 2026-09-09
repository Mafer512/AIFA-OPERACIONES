/**
 * @jest-environment jsdom
 *
 * Reportes > Pasajeros: que las cifras salgan como en el libro.
 *
 * Las fórmulas se sacaron de las tablas dinámicas de "TUA y REPORTE GENERAL"
 * y se verificaron reproduciendo abril 2026 contra la hoja DATA. Lo que se
 * fija aquí son esas reglas, que son justo donde es fácil equivocarse:
 *
 *   · SUBSECRETARÍA agrupa por CIERRE SUBSECRETARIA, no por FECHA.
 *   · Las plantillas 1 y 2 agrupan por FECHA, no por CIERRE.
 *   · "Operaciones" es la CUENTA del campo que cuenta cada reporte —AEROLINEA,
 *     TIPO DE OPERACIÓN o TIPO DE MANIFIESTO—, y Excel no cuenta celdas
 *     vacías: un manifiesto incompleto no suma operación.
 *   · Los vuelos de carga no entran: estos son los reportes de pasajeros.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const modulo = fs.readFileSync(path.join(raiz, 'js', 'conci-reportes-pasajeros.js'), 'utf8');

/** Carga el módulo quedándose solo con el arranque de esta evaluación. */
function cargar() {
  let arrancar;
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener')
    .mockImplementation((tipo, fn, opciones) => {
      if (tipo === 'DOMContentLoaded') { arrancar = fn; return; }
      registrar(tipo, fn, opciones);
    });
  new Function(modulo)();
  espia.mockRestore();
  if (arrancar) arrancar();
  return window.conciReportesPasajeros;
}

const COLUMNAS = {
  cierre: 'CIERRE SUBSECRETARIA',
  fecha: 'FECHA',
  tipo: 'TIPO DE MANIFIESTO',
  operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA',
  pax: 'TOTAL PAX',
  portal: '_portal_flight_date'
};

function manifiesto(campos) {
  return {
    'CIERRE SUBSECRETARIA': campos.cierre ?? campos.fecha,
    'FECHA': campos.fecha,
    'TIPO DE MANIFIESTO': campos.tipo ?? 'LLEGADA',
    'TIPO DE OPERACIÓN': 'operacion' in campos ? campos.operacion : 'NACIONAL',
    'AEROLINEA': 'aerolinea' in campos ? campos.aerolinea : 'VIVA AEROBUS',
    'TOTAL PAX': campos.pax ?? 0
  };
}

describe('el marcado del reporte', () => {
  test('la pestaña Pasajeros trae los tres reportes', () => {
    const pane = html.slice(html.indexOf('id="pane-conci-rep-pasajeros"'), html.indexOf('conci-rep-pax-error'));
    ['subsecretaria', 'plantilla1', 'plantilla2'].forEach(clave => {
      expect(pane).toContain(`data-conci-rep-pax="${clave}"`);
    });
  });

  test('tiene selector de fecha y botón de generar', () => {
    expect(html).toContain('id="conci-rep-pax-fecha"');
    expect(html).toContain('id="btn-conci-rep-pax-generar"');
  });

  test('index.html carga el módulo', () => {
    expect(html).toContain('js/conci-reportes-pasajeros.js');
  });
});

describe('agregación', () => {
  let api;

  beforeEach(() => {
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha">
      <button id="btn-conci-rep-pax-generar"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>
    `;
    delete window._conciRowIsCargo;
    api = cargar();
  });

  function agregar(filas, fecha = '2026-04-30') {
    return api.agregar({ filas, columnas: COLUMNAS }, fecha);
  }

  test('SUBSECRETARÍA cruza llegada/salida contra nacional/internacional', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-04-30', tipo: 'LLEGADA', operacion: 'NACIONAL', pax: 100 }),
      manifiesto({ fecha: '2026-04-30', tipo: 'LLEGADA', operacion: 'INTERNACIONAL', pax: 50 }),
      manifiesto({ fecha: '2026-04-30', tipo: 'SALIDA', operacion: 'NACIONAL', pax: 80 })
    ]);
    expect(r.sub.dia.LLEGADA.NACIONAL).toEqual({ pax: 100, ops: 1 });
    expect(r.sub.dia.LLEGADA.INTERNACIONAL).toEqual({ pax: 50, ops: 1 });
    expect(r.sub.dia.SALIDA.NACIONAL).toEqual({ pax: 80, ops: 1 });
    expect(r.sub.dia.SALIDA.INTERNACIONAL).toEqual({ pax: 0, ops: 0 });
  });

  test('SUBSECRETARÍA agrupa por CIERRE SUBSECRETARIA, no por FECHA', () => {
    // Vuelo del 29 que se cierra el 30: cuenta en el reporte del 30.
    const r = agregar([manifiesto({ fecha: '2026-04-29', cierre: '2026-04-30', pax: 200 })]);
    expect(r.sub.dia.LLEGADA.NACIONAL.pax).toBe(200);
    // Y en las plantillas, que van por FECHA, cae en el día 29.
    expect(r.porDia[28].pax.llegada).toBe(200);
    expect(r.porDia[29].pax.llegada).toBe(0);
  });

  test('los acumulados encadenan día → mes → año → histórico', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-04-30', pax: 10 }),   // día, mes, año, histórico
      manifiesto({ fecha: '2026-04-01', pax: 100 }),  // mes, año, histórico
      manifiesto({ fecha: '2026-01-15', pax: 1000 }), // año, histórico
      manifiesto({ fecha: '2025-06-10', pax: 10000 }) // solo histórico
    ]);
    const pax = alcance => r.sub[alcance].LLEGADA.NACIONAL.pax;
    expect(pax('dia')).toBe(10);
    expect(pax('mes')).toBe(110);
    expect(pax('anio')).toBe(1110);
    expect(pax('historico')).toBe(11110);
  });

  test('nada posterior a la fecha del reporte entra en el histórico', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-04-30', pax: 10 }),
      manifiesto({ fecha: '2026-05-01', pax: 999 })
    ]);
    expect(r.sub.historico.LLEGADA.NACIONAL.pax).toBe(10);
  });

  test('SUBSECRETARÍA cuenta AEROLINEA: sin aerolínea no hay operación', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-04-30', pax: 120, aerolinea: 'VOLARIS' }),
      manifiesto({ fecha: '2026-04-30', pax: 30, aerolinea: '' })
    ]);
    // Los pasajeros del manifiesto incompleto sí suman; la operación no.
    expect(r.sub.dia.LLEGADA.NACIONAL.pax).toBe(150);
    expect(r.sub.dia.LLEGADA.NACIONAL.ops).toBe(1);
  });

  test('PLANTILLA 1 agrupa por aerolínea, del día y del mes', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-04-30', aerolinea: 'VIVA AEROBUS', pax: 180 }),
      manifiesto({ fecha: '2026-04-30', aerolinea: 'VOLARIS', pax: 150 }),
      manifiesto({ fecha: '2026-04-02', aerolinea: 'VIVA AEROBUS', pax: 170 })
    ]);
    expect(r.porAerolinea.dia.get('VIVA AEROBUS')).toEqual({ pax: 180, ops: 1 });
    expect(r.porAerolinea.dia.get('VOLARIS')).toEqual({ pax: 150, ops: 1 });
    expect(r.porAerolinea.mes.get('VIVA AEROBUS')).toEqual({ pax: 350, ops: 2 });
  });

  test('PLANTILLA 1 cuenta TIPO DE OPERACIÓN en el bloque del día', () => {
    const r = agregar([manifiesto({ fecha: '2026-04-30', operacion: '', pax: 90 })]);
    expect(r.porAerolinea.dia.get('VIVA AEROBUS')).toEqual({ pax: 90, ops: 0 });
  });

  test('PLANTILLA 2 reparte el mes por día y por llegada/salida', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-04-01', tipo: 'LLEGADA', pax: 10837 }),
      manifiesto({ fecha: '2026-04-01', tipo: 'SALIDA', pax: 11546 }),
      manifiesto({ fecha: '2026-04-15', tipo: 'LLEGADA', pax: 500 })
    ]);
    expect(r.porDia).toHaveLength(30); // abril
    expect(r.porDia[0]).toMatchObject({
      pax: { llegada: 10837, salida: 11546 },
      ops: { llegada: 1, salida: 1 },
      hayDatos: true
    });
    expect(r.porDia[14].pax.llegada).toBe(500);
    expect(r.porDia[1].hayDatos).toBe(false);
  });

  test('los vuelos de carga quedan fuera', () => {
    window._conciRowIsCargo = fila => String(fila['AEROLINEA']).includes('ESTAFETA');
    api = cargar();
    const r = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-04-30', aerolinea: 'VIVA AEROBUS', pax: 180 }),
        manifiesto({ fecha: '2026-04-30', aerolinea: 'ESTAFETA', pax: 0 })
      ],
      columnas: COLUMNAS
    }, '2026-04-30');
    expect(r.descartadosCarga).toBe(1);
    expect(r.sub.dia.LLEGADA.NACIONAL.ops).toBe(1);
    expect(r.porAerolinea.dia.has('ESTAFETA')).toBe(false);
    delete window._conciRowIsCargo;
  });

  test('acepta las fechas en los formatos que conviven en la tabla', () => {
    expect(api.aIso('30/04/2026')).toBe('2026-04-30');
    expect(api.aIso('2026-04-30T05:00:00')).toBe('2026-04-30');
    expect(api.aIso('1/4/26')).toBe('2026-04-01');
    expect(api.aIso(new Date(2026, 3, 30))).toBe('2026-04-30');
    expect(api.aIso('')).toBe('');
    expect(api.aIso(null)).toBe('');
  });
});

describe('cifras reales de abril 2026', () => {
  let api;

  beforeEach(() => {
    document.body.innerHTML = '<div id="conci-rep-pax-salida"></div>';
    delete window._conciRowIsCargo;
    api = cargar();
  });

  /**
   * El 1 de abril el libro reporta 11,546 pax de salida y 10,837 de llegada,
   * con 78 operaciones de cada lado. Se reconstruye ese día repartiendo las
   * cifras en manifiestos y se comprueba que la agregación las devuelve.
   */
  test('PLANTILLA 2 reproduce el 01/04/2026 del libro', () => {
    const filas = [];
    for (let i = 0; i < 78; i++) {
      filas.push(manifiesto({ fecha: '2026-04-01', tipo: 'SALIDA', pax: i === 0 ? 11546 - 77 * 100 : 100 }));
      filas.push(manifiesto({ fecha: '2026-04-01', tipo: 'LLEGADA', pax: i === 0 ? 10837 - 77 * 100 : 100 }));
    }
    const r = api.agregar({ filas, columnas: COLUMNAS }, '2026-04-30');
    expect(r.porDia[0].pax.salida).toBe(11546);
    expect(r.porDia[0].pax.llegada).toBe(10837);
    expect(r.porDia[0].ops.salida).toBe(78);
    expect(r.porDia[0].ops.llegada).toBe(78);
  });
});
