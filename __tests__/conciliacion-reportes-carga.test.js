/**
 * @jest-environment jsdom
 *
 * Reportes > Carga: los cuatro reportes y la presentación.
 *
 * Lo que se fija aquí es de dónde sale cada kilo, que es donde el libro
 * esconde sus trampas:
 *
 *   · El libro parte la carga en IMPORTACIÓN / EXPORTACIÓN / KGS CARGA LLEGADA
 *     NLU / KG. DE CARGA SALIDA NLU. Aquí salen de cruzar KGS. DE CARGA
 *     NACIONAL y KGS. DE CARGA INTERNACIONAL con TIPO DE MANIFIESTO — no de
 *     TIPO DE OPERACIÓN, que en el libro se contradice 137 veces.
 *   · Las toneladas de la Hoja 1 se TRUNCAN a dos decimales, no se redondean.
 *   · En el oficio, nacional + internacional tiene que cuadrar con el total
 *     redondeado: es el renglón "REDONDEO" que allá se ajusta a mano.
 *   · El Reporte de Carga no cuenta operaciones mixtas.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const modulo = fs.readFileSync(path.join(raiz, 'js', 'conci-reportes-carga.js'), 'utf8');

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
  return window.conciReportesCarga;
}

const COLUMNAS = {
  cierre: 'CIERRE SUBSECRETARIA',
  fecha: 'FECHA',
  tipo: 'TIPO DE MANIFIESTO',
  operacion: 'TIPO DE OPERACIÓN',
  aerolinea: 'AEROLINEA',
  cargaNac: 'KGS. DE CARGA NACIONAL',
  cargaInt: 'KGS. DE CARGA INTERNACIONAL',
  cargaTotal: 'KG DE CARGA TOTAL',
  portal: '_portal_flight_date'
};

function manifiesto(c) {
  return {
    'CIERRE SUBSECRETARIA': c.cierre ?? c.fecha,
    'FECHA': c.fecha,
    'TIPO DE MANIFIESTO': c.tipo ?? 'LLEGADA',
    'TIPO DE OPERACIÓN': 'operacion' in c ? c.operacion : 'INTERNACIONAL',
    'AEROLINEA': 'aerolinea' in c ? c.aerolinea : 'ESTAFETA',
    'KGS. DE CARGA NACIONAL': c.nac ?? 0,
    'KGS. DE CARGA INTERNACIONAL': c.int ?? 0,
    'KG DE CARGA TOTAL': c.total ?? 0
  };
}

describe('el marcado', () => {
  test('la pestaña Carga trae los cuatro reportes y la presentación', () => {
    ['subsecretaria', 'hoja1', 'hoja2', 'reportecarga', 'presentacion'].forEach(clave => {
      expect(html).toContain(`data-conci-rep-carga="${clave}"`);
    });
  });

  test('imprimir y descargar nacen ocultos: son solo de la presentación', () => {
    ['btn-conci-rep-carga-imprimir', 'btn-conci-rep-carga-descargar'].forEach(id => {
      const antes = html.slice(html.indexOf(`id="${id}"`) - 160, html.indexOf(`id="${id}"`));
      expect(antes).toContain('d-none');
    });
  });

  test('index.html carga el módulo', () => {
    expect(html).toContain('js/conci-reportes-carga.js');
  });
});

describe('agregación', () => {
  let api;

  beforeEach(() => {
    document.body.innerHTML = `
      <input type="date" id="conci-rep-carga-fecha" value="2026-08-31">
      <button id="btn-conci-rep-carga-generar"></button>
      <button id="btn-conci-rep-carga-imprimir" class="d-none"></button>
      <button id="btn-conci-rep-carga-descargar" class="d-none"></button>
      <button data-conci-rep-carga="subsecretaria" class="active"></button>
      <button data-conci-rep-carga="hoja1"></button>
      <button data-conci-rep-carga="hoja2"></button>
      <button data-conci-rep-carga="reportecarga"></button>
      <button data-conci-rep-carga="presentacion"></button>
      <div id="conci-rep-carga-estado"></div>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>
    `;
    // Todo lo del fixture es carga salvo que la prueba diga otra cosa.
    window._conciRowIsCargo = () => true;
    api = cargar();
  });

  afterEach(() => { delete window._conciRowIsCargo; delete window._conciResolveAirlineMeta; });

  const agregar = (filas, fecha = '2026-09-01') =>
    api.agregar({ filas, columnas: COLUMNAS }, fecha);

  test('los cuatro campos del libro salen del cruce nacional/internacional × llegada/salida', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', int: 85727 }),
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'SALIDA', int: 42000 }),
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', nac: 6912, operacion: 'NACIONAL' }),
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'SALIDA', nac: 11465, operacion: 'NACIONAL' })
    ]);
    const dia = r.sub.actual.dia;
    expect(dia.LLEGADA.INTERNACIONAL.kg).toBe(85727);   // IMPORTACIÓN
    expect(dia.SALIDA.INTERNACIONAL.kg).toBe(42000);    // EXPORTACIÓN
    expect(dia.LLEGADA.NACIONAL.kg).toBe(6912);         // KGS CARGA LLEGADA NLU
    expect(dia.SALIDA.NACIONAL.kg).toBe(11465);         // KG. DE CARGA SALIDA NLU
  });

  test('una salida internacional con carga nacional cae del lado nacional', () => {
    // Es el caso que rompe derivar los campos de TIPO DE OPERACIÓN: en el
    // libro hay 137 filas así.
    const r = agregar([
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'SALIDA', operacion: 'INTERNACIONAL', nac: 4150 })
    ]);
    expect(r.sub.actual.dia.SALIDA.NACIONAL.kg).toBe(4150);
    expect(r.sub.actual.dia.SALIDA.INTERNACIONAL.kg).toBe(0);
    // Pero la OPERACIÓN sí se cuenta como internacional, que es lo que declara.
    expect(r.sub.actual.dia.SALIDA.INTERNACIONAL.ops).toBe(1);
  });

  test('un manifiesto mixto aporta a los dos lados', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', nac: 1000, int: 5000 })
    ]);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.kg).toBe(1000);
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(5000);
  });

  test('la captura vieja de solo total se atribuye por tipo de operación', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', operacion: 'INTERNACIONAL', total: 9000 }),
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', operacion: 'NACIONAL', total: 300 })
    ]);
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(9000);
    expect(r.sub.actual.dia.LLEGADA.NACIONAL.kg).toBe(300);
  });

  test('los manifiestos de pasajeros quedan fuera', () => {
    window._conciRowIsCargo = fila => String(fila['AEROLINEA']) !== 'VIVA AEROBUS';
    api = cargar();
    const r = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', int: 5000 }),
        manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', int: 999, aerolinea: 'VIVA AEROBUS' })
      ],
      columnas: COLUMNAS
    }, '2026-09-01');
    expect(r.descartadosPax).toBe(1);
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(5000);
  });

  test('el oficio va por mes, como el de pasajeros', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-08-30', cierre: '2026-08-31', int: 500 }),
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', int: 300 })
    ], '2026-09-15');
    expect(r.cierres).toEqual({ anterior: '2026-08-31', actual: '2026-09-01' });
    expect(r.sub.anterior.dia.LLEGADA.INTERNACIONAL.kg).toBe(500);
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(300);
  });

  test('si el día 1 no tiene cierre, retrocede un mes', () => {
    const r = agregar([manifiesto({ fecha: '2026-07-31', cierre: '2026-08-01', int: 700 })], '2026-09-01');
    expect(r.retrocedido).toBe(true);
    expect(r.cierres.actual).toBe('2026-08-01');
  });
});

describe('toneladas y redondeo', () => {
  let api;
  beforeEach(() => {
    document.body.innerHTML = '<div id="conci-rep-carga-salida"></div>';
    window._conciRowIsCargo = () => true;
    api = cargar();
  });
  afterEach(() => { delete window._conciRowIsCargo; });

  test('nacional + internacional siempre cuadra con el total redondeado', () => {
    // Es el renglón "REDONDEO" que en el libro se ajusta a mano.
    const casos = [[56.85, 640.03], [0.5, 0.5], [10.4, 10.4], [0, 0], [1.6, 2.6]];
    for (const [nac, int] of casos) {
      const r = api.repartirEnteros(nac, int);
      expect(r.nacional + r.internacional).toBe(r.total);
      expect(r.total).toBe(Math.round(nac + int));
    }
  });

  test('el sobrante se le da al lado con la fracción mayor', () => {
    const r = api.repartirEnteros(1.2, 2.9);   // total 4, enteros 1 + 2 = 3
    expect(r).toEqual({ nacional: 1, internacional: 3, total: 4 });
  });

  test('las toneladas de la Hoja 1 se truncan, no se redondean', () => {
    const r = api.agregar({
      // 1,239 kg = 1.239 ton → 1.23, no 1.24
      filas: [manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', int: 1239, aerolinea: 'ESTAFETA' })],
      columnas: COLUMNAS
    }, '2026-09-01');
    const filas = api.filasHoja1(r);
    expect(filas[0].ton).toBe(1.23);
  });
});

describe('Reporte de Carga', () => {
  let api;
  beforeEach(() => {
    document.body.innerHTML = '<div id="conci-rep-carga-salida"></div>';
    window._conciRowIsCargo = () => true;
    api = cargar();
  });
  afterEach(() => { delete window._conciRowIsCargo; });

  test('reparte la carga internacional por mes, en llegada y salida', () => {
    const r = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-01-15', tipo: 'LLEGADA', int: 26048504 }),
        manifiesto({ fecha: '2026-01-20', tipo: 'SALIDA', int: 4879391 }),
        manifiesto({ fecha: '2026-08-10', tipo: 'LLEGADA', int: 30355652 })
      ],
      columnas: COLUMNAS
    }, '2026-09-01');
    expect(r.porMes[0].impKg).toBe(26048504);
    expect(r.porMes[0].expKg).toBe(4879391);
    expect(r.porMes[7].impKg).toBe(30355652);
    expect(r.porMes[1].impKg).toBe(0);
  });

  test('no cuenta operaciones mixtas: solo las internacionales declaradas', () => {
    const r = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-03-01', tipo: 'LLEGADA', operacion: 'INTERNACIONAL', int: 100 }),
        manifiesto({ fecha: '2026-03-02', tipo: 'LLEGADA', operacion: 'NACIONAL', nac: 100 })
      ],
      columnas: COLUMNAS
    }, '2026-09-01');
    expect(r.porMes[2].opsIntLlegada).toBe(1);
  });
});

describe('la presentación', () => {
  let api;
  let datos;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-conci-rep-carga-imprimir" class="d-none"></button>
      <button id="btn-conci-rep-carga-descargar" class="d-none"></button>
      <button data-conci-rep-carga="subsecretaria" class="active"></button>
      <button data-conci-rep-carga="hoja1"></button>
      <button data-conci-rep-carga="presentacion"></button>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>
    `;
    window._conciRowIsCargo = () => true;
    api = cargar();
    datos = api.agregar({
      filas: [manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', int: 1709340, aerolinea: 'ESTAFETA' })],
      columnas: COLUMNAS
    }, '2026-08-31');
  });

  afterEach(() => { delete window._conciRowIsCargo; delete window.print; });

  test('el catálogo reproduce los conteos de la baraja original', () => {
    expect(api.CATALOGO.regular).toHaveLength(18);      // 18 CARGA REGULAR
    expect(api.CATALOGO.fletamento).toHaveLength(35);   // 35 FLETAMENTO
    expect(api.CATALOGO.mixtas).toHaveLength(5);        // 5 CARGA MIXTA
  });

  test('el acumulado suma la línea base de los años anteriores', () => {
    const r = api.resumenPresentacion(datos);
    const baseOps = api.BASE_HISTORICA.reduce((a, b) => a + b.ops, 0);
    expect(r.acumulado.ops).toBe(baseOps + datos.anioActual.ops + datos.delDia.ops);
    expect(r.anios).toHaveLength(api.BASE_HISTORICA.length + 1);
  });

  test('se dibuja como una baraja de diapositivas', () => {
    api.mostrar(datos);
    document.querySelector('[data-conci-rep-carga="presentacion"]').click();
    const salida = document.getElementById('conci-rep-carga-salida').innerHTML;
    expect(salida).toContain('conci-ppt-slide');
    expect(salida).toContain('Felipe Ángeles');
    expect(salida).toContain('Operaciones en la Terminal de Carga');
    expect(salida).toContain('GRACIAS');
    // 9 diapositivas: portada, resumen, 3 de tarjetas, totales, 2 catálogos y gracias.
    expect((salida.match(/conci-ppt-slide/g) || []).length).toBe(9);
  });

  test('imprimir y descargar solo aparecen en la presentación', () => {
    const imprimir = document.getElementById('btn-conci-rep-carga-imprimir');
    const descargar = document.getElementById('btn-conci-rep-carga-descargar');
    document.querySelector('[data-conci-rep-carga="presentacion"]').click();
    expect(imprimir.classList.contains('d-none')).toBe(false);
    expect(descargar.classList.contains('d-none')).toBe(false);
    document.querySelector('[data-conci-rep-carga="hoja1"]').click();
    expect(imprimir.classList.contains('d-none')).toBe(true);
    expect(descargar.classList.contains('d-none')).toBe(true);
  });

  test('imprimir marca el body y llama a print', () => {
    window.print = jest.fn();
    api.mostrar(datos);
    document.getElementById('btn-conci-rep-carga-imprimir').click();
    expect(window.print).toHaveBeenCalled();
    expect(document.body.classList.contains('conci-rep-imprimiendo')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('conci-rep-imprimiendo')).toBe(false);
  });

  test('sin datos generados, imprimir avisa en vez de imprimir', () => {
    window.print = jest.fn();
    api.imprimir();
    expect(window.print).not.toHaveBeenCalled();
    expect(document.getElementById('conci-rep-carga-error').classList.contains('d-none')).toBe(false);
  });
});
