/**
 * @jest-environment jsdom
 *
 * Conciliación › Manifiestos: el mensaje para WhatsApp o Webex.
 *
 * El botón del avión de papel abre una ventana con el texto que se envía a
 * diario —el día, el acumulado del mes, del año y desde el inicio de
 * operaciones, de pasajeros y de carga, y la variación del año contra el mismo
 * periodo del anterior— y un botón para copiarlo. Las cifras son las de los
 * oficios a la Subsecretaría (agrupadas por CIERRE SUBSECRETARIA) y se calculan
 * con sus mismas funciones.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const leer = archivo => fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8');
const MODULOS = ['conci-reportes-pasajeros.js', 'conci-carga-catalogo.js', 'conci-presentacion-carga.js',
  'conci-reportes-carga.js', 'conci-mensaje-envio.js'].map(leer);

/** Carga los módulos y corre sus arranques de DOMContentLoaded. */
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
  return window.conciMensajeEnvio;
}

/** El mensaje que se envía hoy, tal como lo pasó el usuario. */
const MENSAJE_ORIGINAL = [
  'Se envía la información correspondiente (carga y pasajeros) al:',
  '',
  '27/09/2026',
  '',
  'a.\tPasajeros: 16,168 (14,791 Nacionales, 1,377 Internacionales).',
  'b.\tOperaciones: 112 (100 Nacionales, 12 Internacionales).',
  '',
  'c. Carga: 471 (6 Nacionales, 465 Internacionales).',
  'd. Operaciones: 23 (2 Nacionales, 21 Internacionales).',
  '',
  'A. Acumulado del mes de Sep. 2026',
  '',
  'a. Pasajeros: 521,632 (484,748 Nacionales, 36,884 Internacionales).',
  'b. Operaciones: 4,028 (3,737 Nacionales, 291 Internacionales).',
  '',
  'c. Carga: 31,654 (793 Nacionales, 30,861 Internacionales).',
  'd. Operaciones: 1,181 (255 Nacionales, 926 Internacionales).',
  '',
  'B. Acumulado en el año 2026',
  '',
  'a. Pasajeros: 5,575,873 (5,281,389 Nacionales, 294,484 Internacionales).',
  'b. Operaciones: 41,733 (39,484 Nacionales, 2,249 Internacionales).',
  '',
  'c. Carga: 308,408 (5,924 Nacionales, 302,484 Internacionales).',
  'd. Operaciones: 11,738 (2,740 Nacionales, 8,998 Internacionales).',
  '',
  'C. Acumulado desde el inicio de operaciones del AIFA',
  '',
  'a. Pasajeros: 22,496,421 (21,192,418 Nacionales, 1,304,003 Internacionales).',
  'b. Operaciones: 178,282 (166,662 Nacionales, 11,620 Internacionales).',
  '',
  'c. Carga: 1,347,811 (44,273 Nacionales, 1,303,538 Internacionales).',
  'd. Operaciones: 43,949 (4,504 Nacionales, 39,445 Internacionales).',
  '',
  'Porcentaje de variación en acumulados anuales (2025 vs 2026):',
  '',
  'A.\tAcumulado Pasajeros del 01 de Enero al 27 Septiembre 2026: 5,575,873 (⬆️ 9.31%)',
  'B.\tAcumulado Carga del 01 de Enero al 27 Septiembre 2026: 308,408 (⬆️ 6.53%)'
].join('\n');

const t = (total, nacional, internacional) => ({ total, nacional, internacional });

/** Manifiesto con las columnas de pasajeros y de carga de la vista reportable. */
function manifiesto(c) {
  return {
    'CIERRE SUBSECRETARIA': c.cierre,
    'FECHA': c.cierre,
    'TIPO DE MANIFIESTO': c.tipo ?? 'LLEGADA',
    'TIPO DE OPERACIÓN': c.operacion ?? 'NACIONAL',
    'AEROLINEA': c.aerolinea ?? 'VIVA AEROBUS',
    'TOTAL PAX': c.pax ?? 0,
    'KGS. DE CARGA NACIONAL': c.nac ?? 0,
    'KGS. DE CARGA INTERNACIONAL': c.int ?? 0,
    'KG DE CARGA TOTAL': 0
  };
}

// ESTAFETA es la de carga; VIVA AEROBUS, la de pasajeros.
const FILAS = [
  manifiesto({ cierre: '2026-09-27', pax: 100 }),
  manifiesto({ cierre: '2026-09-27', tipo: 'SALIDA', operacion: 'INTERNACIONAL', pax: 50 }),
  manifiesto({ cierre: '2026-09-27', aerolinea: 'ESTAFETA', operacion: 'INTERNACIONAL', int: 5400 }),
  manifiesto({ cierre: '2026-09-27', aerolinea: 'ESTAFETA', tipo: 'SALIDA', nac: 600 }),
  manifiesto({ cierre: '2026-09-20', pax: 200 }),
  manifiesto({ cierre: '2026-08-15', pax: 300 }),
  manifiesto({ cierre: '2026-08-15', aerolinea: 'ESTAFETA', operacion: 'INTERNACIONAL', int: 10000 }),
  manifiesto({ cierre: '2025-09-10', pax: 400 }),
  manifiesto({ cierre: '2025-09-10', aerolinea: 'ESTAFETA', operacion: 'INTERNACIONAL', int: 2000 }),
  // Del año anterior pero después de la misma fecha: cuenta en el histórico,
  // no en la comparación del acumulado anual.
  manifiesto({ cierre: '2025-10-01', pax: 999 }),
  manifiesto({ cierre: '2024-05-05', operacion: 'INTERNACIONAL', pax: 1000 })
];

describe('el marcado', () => {
  test('el botón de enviar va junto a Limpiar filtros, con el avión de papel', () => {
    const limpiar = html.indexOf('id="btn-conci-clear-filters"');
    const enviar = html.indexOf('id="btn-conci-enviar-mensaje"');
    expect(enviar).toBeGreaterThan(limpiar);
    expect(enviar).toBeLessThan(html.indexOf('<div class="conci-manifest-acciones">'));
    const boton = html.slice(html.lastIndexOf('<button', enviar), html.indexOf('</button>', enviar));
    expect(boton).toContain('fa-paper-plane');
    expect(boton).toContain('aria-label="Mensaje para WhatsApp o Webex"');
  });

  test('la ventana trae el texto, la fecha del cierre, Actualizar, Copiar y Cerrar', () => {
    const modal = html.slice(html.indexOf('id="modalConciMensaje"'), html.indexOf('<!-- MODAL: CATLOGO TIPO DE SERVICIO -->'));
    ['conci-msg-texto', 'conci-msg-fecha', 'conci-msg-fecha-texto', 'btn-conci-msg-actualizar', 'btn-conci-msg-copiar']
      .forEach(id => expect(modal).toContain(`id="${id}"`));
    expect(modal).toMatch(/data-bs-dismiss="modal">\s*<i class="fas fa-xmark[^>]*><\/i>Cerrar/);
    expect(modal).toMatch(/id="btn-conci-msg-copiar"[^>]*>\s*<i class="fas fa-copy[^>]*><\/i>Copiar mensaje/);
  });

  test('el módulo carga después de los dos reportes de los que toma las cifras', () => {
    const pax = html.indexOf('js/conci-reportes-pasajeros.js');
    const carga = html.indexOf('<script src="js/conci-reportes-carga.js');
    const mensaje = html.indexOf('<script src="js/conci-mensaje-envio.js');
    expect(carga).toBeGreaterThan(pax);
    expect(mensaje).toBeGreaterThan(carga);
    expect(html).toMatch(/<script src="js\/conci-mensaje-envio\.js\?v=[^"]+" defer><\/script>/);
  });
});

describe('el texto', () => {
  let api;
  beforeAll(() => { api = cargar(); });

  test('sale idéntico al mensaje que se envía hoy', () => {
    const texto = api.componer({
      fechaIso: '2026-09-27',
      cifras: {
        dia: { pax: t(16168, 14791, 1377), opsPax: t(112, 100, 12), carga: t(471, 6, 465), opsCarga: t(23, 2, 21) },
        mes: { pax: t(521632, 484748, 36884), opsPax: t(4028, 3737, 291), carga: t(31654, 793, 30861), opsCarga: t(1181, 255, 926) },
        anio: { pax: t(5575873, 5281389, 294484), opsPax: t(41733, 39484, 2249), carga: t(308408, 5924, 302484), opsCarga: t(11738, 2740, 8998) },
        historico: { pax: t(22496421, 21192418, 1304003), opsPax: t(178282, 166662, 11620), carga: t(1347811, 44273, 1303538), opsCarga: t(43949, 4504, 39445) }
      },
      anioAnterior: { pax: 5100973, carga: 289504 }
    });
    expect(texto).toBe(MENSAJE_ORIGINAL);
  });

  test('una baja se marca con la flecha hacia abajo, y sin dato del año anterior no inventa porcentaje', () => {
    const cero = { pax: t(0, 0, 0), opsPax: t(0, 0, 0), carga: t(0, 0, 0), opsCarga: t(0, 0, 0) };
    const base = { dia: cero, mes: cero, historico: cero };
    const baja = api.componer({
      fechaIso: '2026-03-05',
      cifras: { ...base, anio: { ...cero, pax: t(900, 900, 0), carga: t(50, 0, 50) } },
      anioAnterior: { pax: 1000, carga: 0 }
    });
    expect(baja).toContain('A. Acumulado del mes de Mar. 2026');
    expect(baja).toContain('A.\tAcumulado Pasajeros del 01 de Enero al 05 Marzo 2026: 900 (⬇️ 10.00%)');
    expect(baja).toContain('B.\tAcumulado Carga del 01 de Enero al 05 Marzo 2026: 50 (sin dato de 2025)');
  });

  test('la comparación es contra el mismo día del año anterior; el 29 de febrero cae en el 28', () => {
    expect(api.mismoDiaAnioAnterior('2026-09-27')).toBe('2025-09-27');
    expect(api.mismoDiaAnioAnterior('2028-02-29')).toBe('2027-02-28');
    expect(api.mismoDiaAnioAnterior('2026-01-01')).toBe('2025-01-01');
  });
});

describe('las cifras salen de los oficios a la Subsecretaría', () => {
  let api;
  beforeEach(() => {
    document.body.innerHTML = '';
    window._conciRowIsCargo = fila => fila['AEROLINEA'] === 'ESTAFETA';
    api = cargar();
  });
  afterEach(() => { delete window._conciRowIsCargo; });

  test('día, mes, año e histórico por CIERRE SUBSECRETARIA, con la carga en toneladas enteras', () => {
    const P = window.conciReportesPasajeros;
    const C = window.conciReportesCarga;
    const datos = { filas: FILAS, columnas: {
      cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO',
      operacion: 'TIPO DE OPERACIÓN', aerolinea: 'AEROLINEA', pax: 'TOTAL PAX'
    } };
    expect(typeof P.leer).toBe('function');
    const r = api.calcular(datos, C.columnas(FILAS[0]), '2026-09-27');

    expect(r.cifras.dia.pax).toEqual(t(150, 100, 50));
    expect(r.cifras.dia.opsPax).toEqual(t(2, 1, 1));
    // 0.6 t nacionales y 5.4 t internacionales: 6 enteras, repartidas como el oficio.
    expect(r.cifras.dia.carga).toEqual(t(6, 1, 5));
    expect(r.cifras.dia.opsCarga).toEqual(t(2, 1, 1));

    expect(r.cifras.mes.pax).toEqual(t(350, 300, 50));
    expect(r.cifras.anio.pax).toEqual(t(650, 600, 50));
    expect(r.cifras.anio.carga).toEqual(t(16, 1, 15));
    expect(r.cifras.historico.pax).toEqual(t(3049, 1999, 1050));
    expect(r.cifras.historico.carga).toEqual(t(18, 1, 17));

    // El año anterior, solo hasta el mismo día: el 1 de octubre de 2025 no entra.
    expect(r.anioAnterior).toEqual({ pax: 400, carga: 2 });
    const texto = api.componer(r);
    expect(texto).toContain('A.\tAcumulado Pasajeros del 01 de Enero al 27 Septiembre 2026: 650 (⬆️ 62.50%)');
    expect(texto).toContain('B.\tAcumulado Carga del 01 de Enero al 27 Septiembre 2026: 16 (⬆️ 700.00%)');
  });
});

describe('mientras no se registre el cierre, lo capturado cuenta como cerrado', () => {
  let api;
  beforeEach(() => {
    window._conciRowIsCargo = fila => fila['AEROLINEA'] === 'ESTAFETA';
    api = cargar();
  });
  afterEach(() => { delete window._conciRowIsCargo; });

  const fila = (c) => ({
    ...manifiesto({ cierre: c.cierre ?? '', pax: c.pax, aerolinea: c.aerolinea, int: c.int, operacion: c.operacion }),
    'FECHA': c.fecha,
    'HR. DE RECEPCIÓN': c.recepcion ?? ''
  });
  const COLUMNAS_PAX = {
    cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO',
    operacion: 'TIPO DE OPERACIÓN', aerolinea: 'AEROLINEA', pax: 'TOTAL PAX'
  };

  test('un manifiesto con HR. DE RECEPCIÓN cuenta en su FECHA; sin ella, no; uno ya cerrado conserva su cierre', () => {
    const filas = [
      fila({ fecha: '2026-09-27', recepcion: '27/09/2026 10:15', pax: 70 }),
      fila({ fecha: '2026-09-27', pax: 500 }),
      fila({ fecha: '2026-09-27', recepcion: '28/09/2026 01:00', aerolinea: 'ESTAFETA', operacion: 'INTERNACIONAL', int: 3000 }),
      fila({ fecha: '2026-09-25', cierre: '2026-09-26', recepcion: '25/09/2026 09:00', pax: 40 })
    ];
    const datos = api.comoCerrados({ filas, columnas: COLUMNAS_PAX });
    const C = window.conciReportesCarga;
    const colCarga = { ...C.columnas(datos.filas[0]), cierre: datos.columnas.cierre };

    const dia27 = api.calcular(datos, colCarga, '2026-09-27').cifras.dia;
    expect(dia27.pax).toEqual(t(70, 70, 0));
    expect(dia27.opsPax.total).toBe(1);
    expect(dia27.carga).toEqual(t(3, 0, 3));
    // El ya cerrado va en su fecha de cierre (26), no en su FECHA (25).
    expect(api.calcular(datos, colCarga, '2026-09-26').cifras.dia.pax.total).toBe(40);
    expect(api.calcular(datos, colCarga, '2026-09-25').cifras.dia.pax.total).toBe(0);
    // No se modifican las filas originales: las comparte la caché de Reportes.
    expect(filas[0]['CIERRE SUBSECRETARIA']).toBe('');
    expect(api.ultimoCierre(datos, '2026-09-27')).toBe('2026-09-27');
  });
});

describe('la ventana', () => {
  let api;
  let rpc;
  let mostrar;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-28T14:43:00'));
    const modal = html.slice(html.indexOf('<div class="modal fade" id="modalConciMensaje"'),
      html.indexOf('<!-- MODAL: CATLOGO TIPO DE SERVICIO -->'));
    document.body.innerHTML = `<button id="btn-conci-enviar-mensaje"></button>${modal}`;
    window._conciRowIsCargo = fila => fila['AEROLINEA'] === 'ESTAFETA';
    rpc = jest.fn(async () => ({ data: FILAS, error: null }));
    window.supabaseClient = { rpc };
    mostrar = jest.fn();
    window.bootstrap = { Modal: { getOrCreateInstance: () => ({ show: mostrar }) } };
    api = cargar();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window._conciRowIsCargo;
    delete window.supabaseClient;
    delete window.bootstrap;
    delete navigator.clipboard;
  });

  const texto = () => document.getElementById('conci-msg-texto').value;
  const aviso = () => document.getElementById('conci-msg-aviso');

  test('al abrir lee los manifiestos hasta hoy y arma el mensaje del último cierre', async () => {
    await api.abrir();
    expect(mostrar).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('conciliacion_reporte_reportable', { p_hasta: '2026-09-28' });
    expect(document.getElementById('conci-msg-fecha').value).toBe('2026-09-27');
    expect(texto()).toMatch(/^Se envía la información correspondiente \(carga y pasajeros\) al:\n\n27\/09\/2026\n\na\.\tPasajeros: 150 \(100 Nacionales, 50 Internacionales\)\./);
    expect(texto()).toContain('c. Carga: 6 (1 Nacionales, 5 Internacionales).');
    expect(aviso().classList.contains('d-none')).toBe(true);
    expect(document.getElementById('btn-conci-msg-copiar').disabled).toBe(false);
    expect(document.getElementById('conci-msg-estado').textContent).toContain('último día con datos: 27/09/2026');
  });

  test('otra fecha se calcula sin volver a leer, y avisa si ese día no tiene cierre', async () => {
    await api.abrir();
    const fecha = document.getElementById('conci-msg-fecha');
    fecha.value = '2026-09-20';
    fecha.dispatchEvent(new Event('change', { bubbles: true }));
    expect(texto()).toContain('\n20/09/2026\n');
    expect(texto()).toContain('a.\tPasajeros: 200 (200 Nacionales, 0 Internacionales).');
    fecha.value = '2026-09-21';
    fecha.dispatchEvent(new Event('change', { bubbles: true }));
    expect(aviso().classList.contains('d-none')).toBe(false);
    expect(aviso().textContent).toContain('No hay manifiestos capturados (con HR. DE RECEPCIÓN) ni cerrados del 21/09/2026');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  test('reabrir enseguida reutiliza lo leído; Actualizar vuelve a leer y conserva la fecha', async () => {
    await api.abrir();
    await api.abrir();
    expect(rpc).toHaveBeenCalledTimes(1);
    const fecha = document.getElementById('conci-msg-fecha');
    fecha.value = '2026-09-20';
    fecha.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-conci-msg-actualizar').click();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fecha.value).toBe('2026-09-20');
    expect(texto()).toContain('\n20/09/2026\n');
    // Pasados unos minutos, abrir vuelve a leer para traer lo último capturado.
    const antes = rpc.mock.calls.length;
    jest.setSystemTime(new Date('2026-09-28T15:00:00'));
    await api.abrir();
    expect(rpc.mock.calls.length).toBe(antes + 1);
  });

  test('un doble clic no lee dos veces: espera la lectura en curso', async () => {
    await Promise.all([api.abrir(), api.abrir()]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(texto()).toContain('\n27/09/2026\n');
  });

  test('Copiar lleva el texto al portapapeles, tal como esté', async () => {
    const writeText = jest.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await api.abrir();
    const area = document.getElementById('conci-msg-texto');
    area.value += '\nSaludos.';
    const boton = document.getElementById('btn-conci-msg-copiar');
    await api.copiar();
    expect(writeText).toHaveBeenCalledWith(area.value);
    expect(boton.textContent).toContain('¡Copiado!');
    jest.advanceTimersByTime(3000);
    expect(boton.textContent).toContain('Copiar mensaje');
  });

  test('un error al leer se avisa en la ventana', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: new Error('sin conexión') }));
    await api.abrir();
    const error = document.getElementById('conci-msg-error');
    expect(error.classList.contains('d-none')).toBe(false);
    expect(error.textContent).toContain('sin conexión');
    expect(document.getElementById('btn-conci-msg-copiar').disabled).toBe(true);
  });
});
