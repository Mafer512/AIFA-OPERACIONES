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
 *
 * El .pptx armado sobre la plantilla se prueba aparte, en Node, en
 * conciliacion-presentacion-carga.test.js.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
const MODULOS = ['conci-carga-catalogo.js', 'conci-presentacion-carga.js', 'conci-reportes-carga.js']
  .map(f => fs.readFileSync(path.join(raiz, 'js', f), 'utf8'));

/** Carga los tres módulos quedándose solo con los arranques de esta evaluación. */
function cargar() {
  const arranques = [];
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener')
    .mockImplementation((tipo, fn, opciones) => {
      if (tipo === 'DOMContentLoaded') { arranques.push(fn); return; }
      registrar(tipo, fn, opciones);
    });
  for (const src of MODULOS) new Function(src)();
  espia.mockRestore();
  arranques.forEach(fn => fn());
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

  test('index.html carga el catálogo y el generador antes que el módulo', () => {
    const cat = html.indexOf('js/conci-carga-catalogo.js');
    const gen = html.indexOf('js/conci-presentacion-carga.js');
    const mod = html.indexOf('js/conci-reportes-carga.js');
    expect(cat).toBeGreaterThan(-1);
    expect(gen).toBeGreaterThan(cat);
    expect(mod).toBeGreaterThan(gen);
  });

  test('la plantilla y los recursos del template están en el repo', () => {
    ['plantillas/presentacion-carga.pptx', 'images/presentacion-carga/fondo.svg',
      'images/presentacion-carga/logo-defensa.svg', 'images/presentacion-carga/ilustracion.png']
      .forEach(ruta => expect(fs.existsSync(path.join(raiz, ruta))).toBe(true));
  });

  test('los fondos SVG del template se estiran a su caja, como en PowerPoint', () => {
    // Sin esto el navegador los encaja con su proporción propia (16:9 en una
    // lámina 4:3) y la franja vino del fondo cae a media diapositiva.
    const dir = path.join(raiz, 'images', 'presentacion-carga');
    const svgs = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThan(0);
    svgs.forEach(f => {
      expect(fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 400)).toMatch(/<svg[^>]*preserveAspectRatio="none"/);
    });
  });
});

describe('agregación', () => {
  let api;

  beforeEach(() => {
    document.body.innerHTML = `
      <input type="date" id="conci-rep-carga-fecha" value="2026-08-31">
      <button id="btn-conci-rep-carga-generar"></button>
      <div id="conci-rep-carga-estado"></div>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>
    `;
    window._conciRowIsCargo = () => true;
    api = cargar();
  });

  afterEach(() => { delete window._conciRowIsCargo; delete window._conciResolveAirlineMeta; });

  const agregar = (filas, fecha = '2026-09-01') => api.agregar({ filas, columnas: COLUMNAS }, fecha);

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
    const r = agregar([
      manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'SALIDA', operacion: 'INTERNACIONAL', nac: 4150 })
    ]);
    expect(r.sub.actual.dia.SALIDA.NACIONAL.kg).toBe(4150);
    expect(r.sub.actual.dia.SALIDA.INTERNACIONAL.kg).toBe(0);
    // Pero la OPERACIÓN sí se cuenta como internacional, que es lo que declara.
    expect(r.sub.actual.dia.SALIDA.INTERNACIONAL.ops).toBe(1);
  });

  test('un manifiesto mixto aporta a los dos lados', () => {
    const r = agregar([manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', tipo: 'LLEGADA', nac: 1000, int: 5000 })]);
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

  test('el oficio compara el día pedido con el anterior, como el de pasajeros', () => {
    const r = agregar([
      manifiesto({ fecha: '2026-09-13', cierre: '2026-09-14', int: 500 }),
      manifiesto({ fecha: '2026-09-14', cierre: '2026-09-15', int: 300 })
    ], '2026-09-15');
    expect(r.cierres).toEqual({ anterior: '2026-09-14', actual: '2026-09-15' });
    expect(r.sub.anterior.dia.LLEGADA.INTERNACIONAL.kg).toBe(500);
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(300);
  });

  test('el día 1 se compara con el último del mes anterior', () => {
    const r = agregar([manifiesto({ fecha: '2026-07-31', cierre: '2026-08-01', int: 700 })], '2026-08-01');
    expect(r.cierres).toEqual({ anterior: '2026-07-31', actual: '2026-08-01' });
    expect(r.sub.actual.dia.LLEGADA.INTERNACIONAL.kg).toBe(700);
  });

  test('cada aerolínea guarda el IATA que le conoce el catálogo de la tabla', () => {
    window._conciResolveAirlineMeta = v => (String(v) === 'M7' ? { name: 'MAS Air', iata: 'M7' } : null);
    api = cargar();
    const r = api.agregar({ filas: [manifiesto({ fecha: '2026-08-31', aerolinea: 'M7', int: 10 })], columnas: COLUMNAS }, '2026-08-31');
    expect(r.porAerolinea.get('MAS AIR')).toMatchObject({ ops: 1, iata: 'M7' });
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
    const casos = [[56.85, 640.03], [0.5, 0.5], [10.4, 10.4], [0, 0], [1.6, 2.6]];
    for (const [nac, int] of casos) {
      const r = api.repartirEnteros(nac, int);
      expect(r.nacional + r.internacional).toBe(r.total);
      expect(r.total).toBe(Math.round(nac + int));
    }
  });

  test('el sobrante se le da al lado con la fracción mayor', () => {
    expect(api.repartirEnteros(1.2, 2.9)).toEqual({ nacional: 1, internacional: 3, total: 4 });
  });

  test('las toneladas de la Hoja 1 se truncan, no se redondean', () => {
    const r = api.agregar({
      filas: [manifiesto({ fecha: '2026-08-31', cierre: '2026-09-01', int: 1239, aerolinea: 'ESTAFETA' })],
      columnas: COLUMNAS
    }, '2026-09-01');
    expect(api.filasHoja1(r)[0].ton).toBe(1.23);
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

describe('Hoja 2 y la presentación, con el template', () => {
  let api;
  let datos;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-conci-rep-carga-imprimir" class="d-none"></button>
      <button id="btn-conci-rep-carga-descargar" class="d-none"></button>
      <button data-conci-rep-carga="subsecretaria" class="active"></button>
      <button data-conci-rep-carga="hoja1"></button>
      <button data-conci-rep-carga="hoja2"></button>
      <button data-conci-rep-carga="presentacion"></button>
      <div id="conci-rep-carga-estado"></div>
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

  afterEach(() => { delete window._conciRowIsCargo; delete window.print; delete window.getAirlineLogoCandidates; });

  const pintar = clave => {
    api.mostrar(datos);
    document.querySelector(`[data-conci-rep-carga="${clave}"]`).click();
    return document.getElementById('conci-rep-carga-salida');
  };

  test('la presentación son las diez diapositivas de la baraja, con sus piezas', () => {
    const salida = pintar('presentacion');
    expect(salida.querySelectorAll('.cp-slide')).toHaveLength(10);
    const h = salida.innerHTML;
    ['fondo.svg', 'encabezado.svg', 'logo-defensa.svg', 'ilustracion.png', 'avion.jpg', 'logos/estafeta.png']
      .forEach(pieza => expect(h).toContain(`images/presentacion-carga/${pieza}`));
    expect(h).toContain('Agosto 2026');
    expect(h).toContain('GRACIAS');
  });

  test('las tarjetas de la baraja llevan un logotipo cada una', () => {
    const salida = pintar('presentacion');
    expect(salida.querySelectorAll('.cp-card')).toHaveLength(58);
    expect(salida.querySelectorAll('.cp-logo img')).toHaveLength(58);
  });

  test('Hoja 2 son las mismas tarjetas, en los cuatro grupos, con logotipo', () => {
    const salida = pintar('hoja2');
    expect(salida.querySelectorAll('.cc-grupo')).toHaveLength(4);
    expect(salida.querySelectorAll('.cc-tarjeta')).toHaveLength(58);
    const estafeta = [...salida.querySelectorAll('.cc-tarjeta')].find(t => t.title === 'ESTAFETA');
    expect(estafeta.querySelector('img').getAttribute('src')).toBe('images/presentacion-carga/logos/estafeta.png');
    expect(estafeta.textContent).toContain('1,709.34');
  });

  test('una aerolínea fuera del catálogo va aparte, con el logotipo de la app', () => {
    window.getAirlineLogoCandidates = () => ['images/airlines/logo_nueva.png', 'images/airlines/logo_nueva.jpg'];
    datos = api.agregar({
      filas: [manifiesto({ fecha: '2026-08-31', int: 500, aerolinea: 'CARGUERA NUEVA' })],
      columnas: COLUMNAS
    }, '2026-08-31');
    const salida = pintar('hoja2');
    expect(salida.querySelectorAll('.cc-grupo')).toHaveLength(5);
    expect(salida.innerHTML).toContain('images/airlines/logo_nueva.png');
    // En la presentación se avisa: cuenta en totales pero no tiene tarjeta.
    expect(pintar('presentacion').innerHTML).toContain('CARGUERA NUEVA');
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

  test('imprimir marca el body, llama a print y limpia al terminar', () => {
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

  test('al imprimir, la baraja se ve y sale una diapositiva por hoja apaisada', () => {
    const impresion = css.slice(css.indexOf('@page diapositiva'));
    expect(impresion).toMatch(/size:\s*11in 8\.5in/);
    expect(impresion).toContain('body.conci-rep-imprimiendo .cp-baraja *');
    expect(impresion).toContain('visibility: visible');
    expect(impresion).toContain('page: diapositiva');
  });
});
