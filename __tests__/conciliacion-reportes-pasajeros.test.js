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

  test('tiene botón de imprimir y de descargar', () => {
    expect(html).toContain('id="btn-conci-rep-pax-imprimir"');
    expect(html).toContain('id="btn-conci-rep-pax-descargar"');
  });

  test('el de descargar nace oculto: solo aplica a las dos plantillas', () => {
    const boton = html.slice(html.indexOf('id="btn-conci-rep-pax-descargar"') - 160,
      html.indexOf('id="btn-conci-rep-pax-descargar"'));
    expect(boton).toContain('d-none');
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
    expect(r.porAerolinea.dia.get('VIVA AEROBUS')).toMatchObject({ pax: 180, ops: 1 });
    expect(r.porAerolinea.dia.get('VOLARIS')).toMatchObject({ pax: 150, ops: 1 });
    expect(r.porAerolinea.mes.get('VIVA AEROBUS')).toMatchObject({ pax: 350, ops: 2 });
  });

  test('PLANTILLA 1 cuenta TIPO DE OPERACIÓN en el bloque del día', () => {
    const r = agregar([manifiesto({ fecha: '2026-04-30', operacion: '', pax: 90 })]);
    expect(r.porAerolinea.dia.get('VIVA AEROBUS')).toMatchObject({ pax: 90, ops: 0 });
  });

  describe('el código IATA se cambia por el nombre comercial', () => {
    const CATALOGO = {
      'Y4': 'Volaris', 'VB': 'Viva Aerobus', 'AM': 'Aeroméxico',
      'XN': 'Mexicana de Aviación', 'DM': 'Arajet', 'ZV': 'Aerus',
      'WH': 'La Nueva Aerolínea'
    };

    beforeEach(() => {
      // Reproduce el catálogo real: resuelve por código y también por nombre.
      window._conciResolveAirlineMeta = valor => {
        const v = String(valor).toUpperCase();
        if (CATALOGO[v]) return { name: CATALOGO[v] };
        const porNombre = Object.values(CATALOGO)
          .find(n => n.toUpperCase() === v);
        return porNombre ? { name: porNombre } : null;
      };
      api = cargar();
    });

    afterEach(() => { delete window._conciResolveAirlineMeta; });

    test('Y4 se reporta como VOLARIS', () => {
      expect(api.nombreAerolinea('Y4')).toBe('VOLARIS');
      expect(api.nombreAerolinea('VB')).toBe('VIVA AEROBUS');
      expect(api.nombreAerolinea('DM')).toBe('ARAJET');
      expect(api.nombreAerolinea('ZV')).toBe('AERUS');
    });

    test('el código y el nombre caen en un solo renglón', () => {
      const r = api.agregar({
        filas: [
          manifiesto({ fecha: '2026-04-30', aerolinea: 'Y4', pax: 150 }),
          manifiesto({ fecha: '2026-04-30', aerolinea: 'VOLARIS', pax: 120 })
        ],
        columnas: COLUMNAS
      }, '2026-04-30');
      expect([...r.porAerolinea.dia.keys()]).toEqual(['VOLARIS']);
      expect(r.porAerolinea.dia.get('VOLARIS')).toMatchObject({ pax: 270, ops: 2 });
    });

    test('un código que no está en el catálogo se queda a la vista', () => {
      // Es la señal de que hay que darlo de alta en Catálogo de aerolíneas.
      expect(api.nombreAerolinea('G6')).toBe('G6');
      expect(api.nombreAerolinea('2D')).toBe('2D');
    });

    test('sin catálogo cargado no se rompe: se queda lo capturado', () => {
      delete window._conciResolveAirlineMeta;
      const suelto = cargar();
      expect(suelto.nombreAerolinea('Y4')).toBe('Y4');
      expect(suelto.nombreAerolinea('')).toBe('');
    });

    test('la fila guarda el código capturado para el tooltip', () => {
      const r = api.agregar({
        filas: [manifiesto({ fecha: '2026-04-30', aerolinea: 'Y4', pax: 150 })],
        columnas: COLUMNAS
      }, '2026-04-30');
      expect([...r.porAerolinea.dia.get('VOLARIS').codigos]).toEqual(['Y4']);
    });

    test('la Plantilla 1 que se descarga lleva el nombre, no el código', () => {
      const datos = api.agregar({
        filas: [manifiesto({ fecha: '2026-04-30', aerolinea: 'Y4', pax: 150 })],
        columnas: COLUMNAS
      }, '2026-04-30');
      const plano = api.filasPlantilla1(datos).map(f => f.join('|')).join('\n');
      expect(plano).toContain('VOLARIS|150|1');
      expect(plano).not.toMatch(/^Y4\|/m);
    });
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

describe('la hoja imprimible', () => {
  const css = fs.readFileSync(path.join(raiz, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
  let api;
  let datos;

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha" value="2026-09-01">
      <button id="btn-conci-rep-pax-generar"></button>
      <button id="btn-conci-rep-pax-imprimir"></button>
      <button id="btn-conci-rep-pax-descargar" class="d-none"></button>
      <button data-conci-rep-pax="subsecretaria" class="active"></button>
      <button data-conci-rep-pax="plantilla1"></button>
      <button data-conci-rep-pax="plantilla2"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>
    `;
    delete window._conciRowIsCargo;
    api = cargar();
    datos = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-09-01', tipo: 'LLEGADA', pax: 4337, aerolinea: 'VIVA AEROBUS' }),
        manifiesto({ fecha: '2026-09-01', tipo: 'SALIDA', pax: 5425, aerolinea: 'VOLARIS' })
      ],
      columnas: COLUMNAS
    }, '2026-09-01');
  });

  /** Pinta un reporte y devuelve el HTML de la hoja. */
  function pintar(clave) {
    api.mostrar(datos);
    document.querySelector(`[data-conci-rep-pax="${clave}"]`).click();
    return document.getElementById('conci-rep-pax-salida').innerHTML;
  }

  test('la paleta sale del libro, no de una aproximación', () => {
    // Verde institucional, gris del TOTAL y vino de las etiquetas.
    ['#255C4F', '#D9D9D9', '#A42145'].forEach(color => {
      expect(css.toUpperCase()).toContain(color);
    });
    expect(css).toContain('"Noto Sans"');
  });

  test('imprimir esconde el resto de la aplicación', () => {
    const bloque = css.slice(css.indexOf('@media print'));
    expect(bloque).toContain('body.conci-rep-imprimiendo * {');
    expect(bloque).toContain('visibility: hidden');
    expect(bloque).toContain('body.conci-rep-imprimiendo .conci-rep-hoja');
    // Sin esto el navegador tira los fondos de color al imprimir.
    expect(bloque).toContain('print-color-adjust: exact');
  });

  test('el botón de imprimir marca el body y llama a print', () => {
    window.print = jest.fn();
    api.mostrar(datos);
    document.getElementById('btn-conci-rep-pax-imprimir').click();
    expect(window.print).toHaveBeenCalled();
    expect(document.body.classList.contains('conci-rep-imprimiendo')).toBe(true);
    delete window.print;
  });

  test('al terminar de imprimir el body vuelve a la normalidad', () => {
    window.print = jest.fn();
    api.mostrar(datos);
    document.getElementById('btn-conci-rep-pax-imprimir').click();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('conci-rep-imprimiendo')).toBe(false);
    delete window.print;
  });

  test('imprimir sin reporte generado avisa en vez de imprimir', () => {
    // Módulo recién cargado, sin `ultimo`: no debe llamar a print.
    window.print = jest.fn();
    api.imprimir();
    expect(window.print).not.toHaveBeenCalled();
    expect(document.getElementById('conci-rep-pax-error').classList.contains('d-none')).toBe(false);
    delete window.print;
  });

  test('Descargar aparece en las plantillas y se esconde en Subsecretaría', () => {
    const boton = document.getElementById('btn-conci-rep-pax-descargar');
    document.querySelector('[data-conci-rep-pax="plantilla1"]').click();
    expect(boton.classList.contains('d-none')).toBe(false);
    document.querySelector('[data-conci-rep-pax="plantilla2"]').click();
    expect(boton.classList.contains('d-none')).toBe(false);
    document.querySelector('[data-conci-rep-pax="subsecretaria"]').click();
    expect(boton.classList.contains('d-none')).toBe(true);
  });

  test('la Plantilla 1 que se descarga lleva encabezados y totales', () => {
    const filas = api.filasPlantilla1(datos);
    const plano = filas.map(f => f.join('|')).join('\n');
    expect(plano).toContain('NUMERALIA AEROPORTUARIA SEPTIEMBRE 2026');
    expect(plano).toContain('AEROLÍNEA|PAX TRANSPORTADOS|NÚMERO DE OPERACIONES');
    expect(plano).toContain('VIVA AEROBUS|4337|1');
    expect(plano).toContain('TOTAL|9762|2');
  });

  test('la Plantilla 2 que se descarga lleva los 30 días de septiembre', () => {
    const filas = api.filasPlantilla2(datos);
    const dias = filas.filter(f => /^\d{2}\/09\/2026$/.test(String(f[0])));
    expect(dias).toHaveLength(30);
    expect(dias[0].slice(0, 4)).toEqual(['01/09/2026', 4337, 5425, 9762]);
    const plano = filas.map(f => f.join('|')).join('\n');
    expect(plano).toContain('PASAJEROS');
    expect(plano).toContain('OPERACIONES');
    expect(plano).toContain('Máximo PAX del mes|9762');
    expect(plano).toContain('PROMEDIO ANUAL');
  });

  test('cada reporte se dibuja dentro de una hoja con logo y nota', () => {
    ['subsecretaria', 'plantilla1', 'plantilla2'].forEach(clave => {
      const salida = pintar(clave);
      expect(salida).toContain('conci-rep-hoja');
      expect(salida).toContain('images/aifa-logo.png');
      expect(salida).toContain('Nota:');
    });
  });

  test('la Plantilla 1 tiñe la aerolínea con su color de catálogo', () => {
    window._conciResolveAirlineMeta = nombre => (
      String(nombre) === 'VIVA AEROBUS' ? { color: '#00a850', textColor: '#ffffff' } : null
    );
    const salida = pintar('plantilla1');
    expect(salida).toContain('background:#00a850');
    delete window._conciResolveAirlineMeta;
  });

  test('un color de catálogo que no sea hexadecimal no se inyecta', () => {
    window._conciResolveAirlineMeta = () => ({ color: 'red;background:url(javascript:alert(1))' });
    const salida = pintar('plantilla1');
    expect(salida).not.toContain('javascript:');
    delete window._conciResolveAirlineMeta;
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
