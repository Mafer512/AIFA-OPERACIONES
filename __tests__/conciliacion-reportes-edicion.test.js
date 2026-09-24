/**
 * @jest-environment jsdom
 *
 * Reportes: edición a mano y marcatextos.
 *
 * Cualquier reporte de Carga o Pasajeros se puede corregir y marcar con cinco
 * colores. Lo que se fija aquí:
 *
 *   · Se guarda como versión del reporte (apartado + reporte + fecha), en la
 *     tabla compartida o, si aún no existe, en el navegador. Nunca en los
 *     manifiestos.
 *   · Lo guardado se limpia antes de pintarse: es HTML que pudo escribir
 *     cualquiera con acceso a la tabla.
 *   · Lo que se ve es lo que se descarga: las celdas corregidas y sus colores
 *     llegan al Excel de las plantillas y al PowerPoint de la presentación.
 *   · Los roles de consulta no ven el botón.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const html = leer('index.html').replace(/\r\n/g, '\n');
const EDICION = leer('js/conci-reportes-edicion.js');

/** Carga módulos quedándose solo con sus arranques (DOMContentLoaded) de esta evaluación. */
function cargar(...archivos) {
  const arranques = [];
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener')
    .mockImplementation((tipo, fn, opciones) => {
      if (tipo === 'DOMContentLoaded') { arranques.push(fn); return; }
      registrar(tipo, fn, opciones);
    });
  new Function(EDICION)();
  for (const f of archivos) new Function(leer(`js/${f}`))();
  espia.mockRestore();
  arranques.forEach(fn => fn());
  return window.ConciReportesEdicion;
}

const esperar = () => new Promise(r => setTimeout(r, 0));
const clic = (nodo, tipo = 'click') => nodo.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0 }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('user_role', 'capturista');
  sessionStorage.setItem('user_fullname', 'Capturista Uno');
  delete window.supabaseClient;
  window.confirm = jest.fn(() => true);
});

describe('el marcado', () => {
  test.each(['carga', 'pax'])('el apartado %s trae Editar, la barra y el aviso', p => {
    expect(html).toMatch(new RegExp(`<button class="[^"]*d-none" id="btn-conci-rep-${p}-editar"`));
    expect(html).toContain(`id="conci-rep-${p}-edicion" class="conci-rep-edicion d-none"`);
    expect(html).toContain(`id="conci-rep-${p}-edicion-aviso" class="conci-rep-edicion-aviso d-none"`);
  });

  test('la barra y el aviso quedan fuera de la hoja: no salen al imprimir', () => {
    for (const p of ['carga', 'pax']) {
      expect(html.indexOf(`id="conci-rep-${p}-edicion-aviso"`)).toBeLessThan(html.indexOf(`id="conci-rep-${p}-salida"`));
    }
  });

  test('el módulo de edición carga antes que los de los reportes', () => {
    const pos = f => html.indexOf(`js/${f}`);
    expect(pos('conci-reportes-edicion.js')).toBeGreaterThan(-1);
    expect(pos('conci-reportes-edicion.js')).toBeLessThan(pos('conci-reportes-pasajeros.js'));
    expect(pos('conci-reportes-edicion.js')).toBeLessThan(pos('conci-reportes-carga.js'));
  });

  test('hay migración para la tabla compartida, con seguridad por renglón', () => {
    const sql = leer('migrations/20260911_conci_reportes_ediciones.sql');
    expect(sql).toContain('create table if not exists public.conci_reportes_ediciones');
    expect(sql).toContain('unique (area, reporte, fecha)');
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/revoke all on public\.conci_reportes_ediciones from anon/);
  });

  test('los cinco colores del marcatextos tienen su estilo', () => {
    const css = leer('style.css');
    for (const color of ['rojo', 'verde', 'amarillo', 'azul', 'morado']) {
      expect(css).toMatch(new RegExp(`\\[data-marca="${color}"\\] \\{ background-color: #[0-9A-F]{6} !important; \\}`));
    }
  });
});

describe('limpiar lo guardado', () => {
  let E;
  beforeEach(() => { E = cargar(); });

  test('quita scripts, manejadores y URLs javascript:', () => {
    const limpio = E.limpiar(`<div id="conci-rep-hoja"><script>alert(1)</script>
      <img src="x.png" onerror="alert(2)"><a href="java&#9;script:alert(3)">x</a>
      <iframe src="https://example.com"></iframe><td style="background:url(https://example.com/x)">1</td></div>`);
    expect(limpio).not.toMatch(/script>|onerror|javascript|iframe|url\(/i);
    expect(limpio).toContain('src="x.png"');
  });

  test('conserva lo que el reporte necesita: clases, estilos, celdas combinadas, marcas', () => {
    const limpio = E.limpiar('<table><tr><td class="num" colspan="2" style="background:#B4C6E7" data-xl="5,1" data-marca="verde">1</td></tr></table>');
    expect(limpio).toContain('class="num"');
    expect(limpio).toContain('colspan="2"');
    expect(limpio).toContain('style="background:#B4C6E7"');
    expect(limpio).toContain('data-xl="5,1"');
    expect(limpio).toContain('data-marca="verde"');
  });

  test('no guarda el modo edición', () => {
    expect(E.limpiar('<td contenteditable="true" spellcheck="false">1</td>')).not.toMatch(/contenteditable|spellcheck/);
  });
});

describe('editar, marcar y guardar', () => {
  const FECHA = '2026-09-10';
  let E, ed, salida, calculado;

  const hoja = valor => `<div id="conci-rep-hoja" class="conci-rep-hoja"><h1>NUMERALIA</h1>
    <table><tbody><tr><td class="conci-rep-aero" style="background:#123456">VOLARIS</td><td class="num" data-xl="5,1">${valor}</td></tr></tbody></table></div>`;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-conci-rep-pax-editar" class="d-none"></button>
      <div id="conci-rep-pax-edicion" class="conci-rep-edicion d-none"></div>
      <div id="conci-rep-pax-edicion-aviso" class="conci-rep-edicion-aviso d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    E = cargar();
    calculado = '1,000';
    ed = E.crear({ area: 'pasajeros', prefijo: 'pax', alCambiar: () => ed.pintar('plantilla1', FECHA, () => hoja(calculado)) });
    salida = document.getElementById('conci-rep-pax-salida');
  });

  async function abrir() {
    await ed.cargar(FECHA);
    ed.pintar('plantilla1', FECHA, () => hoja(calculado));
  }

  const celda = () => salida.querySelector('[data-xl="5,1"]');
  const barra = () => document.getElementById('conci-rep-pax-edicion');
  const aviso = () => document.getElementById('conci-rep-pax-edicion-aviso');
  const boton = () => document.getElementById('btn-conci-rep-pax-editar');
  const herramienta = h => barra().querySelector(`[data-conci-rep-herramienta="${h}"]`);
  const accion = (a, donde = barra()) => donde.querySelector(`[data-conci-rep-accion="${a}"]`);

  test('Editar aparece al pintar un reporte y abre la barra con los cinco colores', async () => {
    await abrir();
    expect(boton().classList.contains('d-none')).toBe(false);
    boton().click();
    expect(barra().classList.contains('d-none')).toBe(false);
    expect(barra().querySelectorAll('.conci-rep-color')).toHaveLength(5);
    expect(celda().getAttribute('contenteditable')).toBe('true');
    expect(salida.querySelector('h1').getAttribute('contenteditable')).toBe('true');
  });

  test('con un color elegido, el clic colorea la celda; otro clic con el mismo color la limpia', async () => {
    await abrir();
    boton().click();
    herramienta('amarillo').click();
    expect(herramienta('amarillo').getAttribute('aria-pressed')).toBe('true');
    clic(celda(), 'mousedown');
    expect(celda().getAttribute('data-marca')).toBe('amarillo');
    clic(celda(), 'mousedown');
    expect(celda().hasAttribute('data-marca')).toBe(false);
    herramienta('morado').click();
    clic(celda(), 'mousedown');
    expect(celda().getAttribute('data-marca')).toBe('morado');
    herramienta('borrar').click();
    clic(celda(), 'mousedown');
    expect(celda().hasAttribute('data-marca')).toBe(false);
  });

  test('arrastrar con el marcatextos colorea todas las celdas por las que pasa', async () => {
    await abrir();
    boton().click();
    herramienta('verde').click();
    const [nombre, numero] = salida.querySelectorAll('td');
    clic(nombre, 'mousedown');
    clic(numero, 'mouseover');
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(nombre.getAttribute('data-marca')).toBe('verde');
    expect(numero.getAttribute('data-marca')).toBe('verde');
  });

  test('guardar deja la versión editada con su color, sin el modo edición', async () => {
    await abrir();
    boton().click();
    celda().textContent = '1,500';
    salida.dispatchEvent(new Event('input'));
    herramienta('rojo').click();
    clic(celda(), 'mousedown');
    accion('guardar').click();
    await esperar();

    expect(celda().textContent).toBe('1,500');
    expect(celda().getAttribute('data-marca')).toBe('rojo');
    expect(salida.querySelector('[contenteditable]')).toBeNull();
    expect(barra().classList.contains('d-none')).toBe(true);
    expect(aviso().classList.contains('d-none')).toBe(false);
    expect(aviso().textContent).toContain('versión editada');
    expect(aviso().textContent).toContain('Capturista Uno');
    // Sin tabla compartida queda en el navegador, y se dice.
    expect(aviso().textContent).toContain('solo en este navegador');
    expect(localStorage.getItem(`conciRepEdicion:pasajeros:${FECHA}:plantilla1`)).toContain('1,500');
  });

  test('la versión guardada vuelve al abrir otra vez el reporte, aunque cambien los cálculos', async () => {
    await abrir();
    boton().click();
    celda().textContent = '1,500';
    accion('guardar').click();
    await esperar();

    calculado = '2,000';
    ed = E.crear({ area: 'pasajeros', prefijo: 'pax', alCambiar: () => {} });
    await abrir();
    expect(celda().textContent).toBe('1,500');
  });

  test('"Ver calculado" y "Ver versión editada" alternan sin perder la edición', async () => {
    await abrir();
    boton().click();
    celda().textContent = '1,500';
    accion('guardar').click();
    await esperar();

    accion('ver-calculado', aviso()).click();
    expect(celda().textContent).toBe('1,000');
    accion('ver-editada', aviso()).click();
    expect(celda().textContent).toBe('1,500');
  });

  test('"Descartar edición" regresa a lo calculado y borra lo guardado', async () => {
    await abrir();
    boton().click();
    celda().textContent = '1,500';
    accion('guardar').click();
    await esperar();

    accion('descartar', aviso()).click();
    await esperar();
    expect(celda().textContent).toBe('1,000');
    expect(aviso().classList.contains('d-none')).toBe(true);
    expect(localStorage.getItem(`conciRepEdicion:pasajeros:${FECHA}:plantilla1`)).toBeNull();
  });

  test('Cancelar deshace lo que no se guardó', async () => {
    await abrir();
    boton().click();
    celda().textContent = '9';
    salida.dispatchEvent(new Event('input'));
    accion('cancelar').click();
    expect(celda().textContent).toBe('1,000');
    expect(salida.querySelector('[contenteditable]')).toBeNull();
  });

  test('cambiar de reporte con cambios sin guardar pregunta antes', async () => {
    await abrir();
    boton().click();
    salida.dispatchEvent(new Event('input'));
    window.confirm = jest.fn(() => false);
    expect(ed.soltar()).toBe(false);
    expect(ed.editando()).toBe(true);
    window.confirm = jest.fn(() => true);
    expect(ed.soltar()).toBe(true);
    expect(ed.editando()).toBe(false);
  });

  test('un rol de consulta no ve Editar', async () => {
    sessionStorage.setItem('user_role', 'viewer');
    await abrir();
    expect(boton().classList.contains('d-none')).toBe(true);
  });

  test('lo guardado con código malicioso se pinta limpio', async () => {
    localStorage.setItem(`conciRepEdicion:pasajeros:${FECHA}:plantilla1`, JSON.stringify({
      html: '<div id="conci-rep-hoja"><img src="x" onerror="window.__atacado = 1"><script>window.__atacado = 2</script></div>',
      actualizado_en: new Date().toISOString()
    }));
    await abrir();
    expect(salida.innerHTML).not.toMatch(/onerror|<script/);
  });
});

describe('la tabla compartida de Supabase', () => {
  const FECHA = '2026-09-10';

  function clienteFalso({ filas = [], error = null } = {}) {
    const llamadas = [];
    const consulta = resultado => {
      const b = { eq: (...a) => { llamadas.push(['eq', ...a]); return b; }, then: (ok, ko) => Promise.resolve(resultado).then(ok, ko) };
      return b;
    };
    return {
      llamadas,
      from: tabla => ({
        select: columnas => { llamadas.push(['select', tabla, columnas]); return consulta({ data: filas, error }); },
        upsert: (fila, opciones) => { llamadas.push(['upsert', tabla, fila, opciones]); return Promise.resolve({ error }); },
        delete: () => { llamadas.push(['delete', tabla]); return consulta({ error }); }
      })
    };
  }

  let E;
  beforeEach(() => { E = cargar(); });

  test('lee de la tabla las ediciones del apartado y la fecha', async () => {
    window.supabaseClient = clienteFalso({ filas: [{ reporte: 'hoja1', html: '<p>guardado</p>', actualizado_por: 'Ana', actualizado_en: '2026-09-10T15:00:00Z' }] });
    const mapa = await E._almacen.leer('carga', FECHA);
    expect(mapa.get('hoja1')).toMatchObject({ html: '<p>guardado</p>', actualizado_por: 'Ana', local: false });
    expect(window.supabaseClient.llamadas).toEqual(expect.arrayContaining([
      ['select', 'conci_reportes_ediciones', 'reporte, html, actualizado_por, actualizado_en'],
      ['eq', 'area', 'carga'], ['eq', 'fecha', FECHA]
    ]));
  });

  test('guarda con upsert por apartado + reporte + fecha y firma quién', async () => {
    window.supabaseClient = clienteFalso();
    const reg = await E._almacen.guardar('carga', FECHA, 'hoja1', '<p>x</p>');
    expect(reg.local).toBe(false);
    const [, tabla, fila, opciones] = window.supabaseClient.llamadas.find(l => l[0] === 'upsert');
    expect(tabla).toBe('conci_reportes_ediciones');
    expect(fila).toMatchObject({ area: 'carga', reporte: 'hoja1', fecha: FECHA, html: '<p>x</p>', actualizado_por: 'Capturista Uno' });
    expect(opciones).toEqual({ onConflict: 'area,reporte,fecha' });
  });

  test('si la tabla aún no existe, guarda en el navegador sin fallar', async () => {
    window.supabaseClient = clienteFalso({ error: { code: 'PGRST205', message: "Could not find the table 'public.conci_reportes_ediciones'" } });
    const reg = await E._almacen.guardar('carga', FECHA, 'hoja1', '<p>x</p>');
    expect(reg.local).toBe(true);
    expect(localStorage.getItem(`conciRepEdicion:carga:${FECHA}:hoja1`)).toContain('<p>x</p>');
  });

  test('otro error de la base sí se informa: no se guarda a escondidas en otro lado', async () => {
    window.supabaseClient = clienteFalso({ error: { code: '42501', message: 'permission denied' } });
    await expect(E._almacen.guardar('carga', FECHA, 'hoja1', '<p>x</p>')).rejects.toMatchObject({ code: '42501' });
    expect(localStorage.getItem(`conciRepEdicion:carga:${FECHA}:hoja1`)).toBeNull();
  });
});

describe('Pasajeros: lo editado llega al Excel', () => {
  const COLUMNAS = {
    cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO', operacion: 'TIPO DE OPERACIÓN',
    aerolinea: 'AEROLINEA', pax: 'TOTAL PAX', portal: '_portal_flight_date'
  };
  const manifiesto = c => ({
    'CIERRE SUBSECRETARIA': c.fecha, 'FECHA': c.fecha, 'TIPO DE MANIFIESTO': c.tipo || 'LLEGADA',
    'TIPO DE OPERACIÓN': 'NACIONAL', 'AEROLINEA': c.aerolinea, 'TOTAL PAX': c.pax
  });

  let E, api, datos, salida;

  beforeEach(() => {
    document.body.innerHTML = `
      <input type="date" id="conci-rep-pax-fecha" value="2026-09-02">
      <button id="btn-conci-rep-pax-editar" class="d-none"></button>
      <button data-conci-rep-pax="subsecretaria" class="active"></button>
      <button data-conci-rep-pax="plantilla1"></button>
      <button data-conci-rep-pax="plantilla2"></button>
      <div id="conci-rep-pax-estado"></div>
      <div id="conci-rep-pax-error" class="d-none"></div>
      <div id="conci-rep-pax-edicion" class="d-none"></div>
      <div id="conci-rep-pax-edicion-aviso" class="d-none"></div>
      <div id="conci-rep-pax-salida"></div>`;
    delete window._conciRowIsCargo;
    E = cargar('conci-reportes-pasajeros.js');
    api = window.conciReportesPasajeros;
    datos = api.agregar({
      filas: [
        manifiesto({ fecha: '2026-09-01', aerolinea: 'VOLARIS', pax: 1200 }),
        manifiesto({ fecha: '2026-09-02', aerolinea: 'VIVA AEROBUS', pax: 4337 }),
        manifiesto({ fecha: '2026-09-02', aerolinea: 'VOLARIS', pax: 5425, tipo: 'SALIDA' })
      ],
      columnas: COLUMNAS
    }, '2026-09-02');
    salida = document.getElementById('conci-rep-pax-salida');
  });

  const pintar = clave => {
    api.mostrar(datos);
    document.querySelector(`[data-conci-rep-pax="${clave}"]`).click();
  };

  test.each([['plantilla1', 'filasPlantilla1'], ['plantilla2', 'filasPlantilla2']])(
    'en %s cada celda de la hoja apunta a su lugar en el Excel', (clave, funcion) => {
      pintar(clave);
      const filas = api[funcion](datos);
      const celdas = salida.querySelectorAll('[data-xl]');
      expect(celdas.length).toBeGreaterThan(10);
      celdas.forEach(nodo => {
        const [r, c] = nodo.getAttribute('data-xl').split(',').map(Number);
        const esperado = filas[r][c];
        const visto = E.textoDe(nodo);
        if (typeof esperado === 'number') {
          // El promedio sale con decimales en pantalla y redondeado en el archivo.
          expect(Math.round(Number(visto.replace(/,/g, '')))).toBe(esperado);
        } else {
          expect(visto).toBe(String(esperado ?? ''));
        }
      });
    });

  test('lo corregido a mano y su color pasan a las filas del archivo', () => {
    pintar('plantilla1');
    const filas = api.filasPlantilla1(datos);
    const volaris = [...salida.querySelectorAll('td.conci-rep-aero')].find(td => td.textContent === 'VOLARIS');
    const pax = volaris.nextElementSibling;
    const [r, c] = pax.getAttribute('data-xl').split(',').map(Number);
    pax.textContent = '6,000';
    pax.setAttribute('data-marca', 'amarillo');

    const calculado = document.createElement('div');
    api.mostrar(datos);   // la versión calculada para comparar
    calculado.innerHTML = salida.innerHTML;
    salida.querySelector(`[data-xl="${r},${c}"]`).textContent = '6,000';
    salida.querySelector(`[data-xl="${r},${c}"]`).setAttribute('data-marca', 'amarillo');

    const marcas = E.aplicarAFilas(filas, salida, calculado);
    expect(filas[r][c]).toBe(6000);
    expect(marcas).toEqual([{ r, c, hex: E.COLORES.amarillo.hex }]);
  });

  test('lo que nadie tocó queda igual que el cálculo, aunque en pantalla se vea redondeado', () => {
    pintar('plantilla2');
    const filas = api.filasPlantilla2(datos);
    const antes = JSON.stringify(filas);
    const calculado = document.createElement('div');
    calculado.innerHTML = salida.innerHTML;
    expect(E.aplicarAFilas(filas, salida, calculado)).toEqual([]);
    expect(JSON.stringify(filas)).toBe(antes);
  });

  test('el Excel sale con el relleno del marcatextos en la celda marcada', async () => {
    const filas = [['NUMERALIA'], ['AEROLÍNEA', 'PAX'], ['VOLARIS', 6000]];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Plantilla 1');
    const bytes = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    const coloreado = await E.colorearXlsx(bytes, [{ r: 2, c: 1, hex: 'FFF176' }, { r: 2, c: 0, hex: 'FF8A80' }], JSZip);

    const zip = await JSZip.loadAsync(coloreado);
    const estilos = await zip.file('xl/styles.xml').async('string');
    const hoja = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(estilos).toContain('<fgColor rgb="FFFFF176"/>');
    expect(estilos).toContain('<fgColor rgb="FFFF8A80"/>');
    const estilo = hoja.match(/<c r="B3" s="(\d+)"/);
    expect(estilo).not.toBeNull();
    // El estilo apunta al relleno amarillo.
    const xfs = estilos.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*\/>/g);
    const relleno = Number(xfs[Number(estilo[1])].match(/fillId="(\d+)"/)[1]);
    const fills = estilos.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)[1].match(/<fill>[\s\S]*?<\/fill>/g);
    expect(fills[relleno]).toContain('FFFFF176');
    // Y SheetJS lo vuelve a leer: el archivo no quedó dañado.
    const releido = XLSX.read(coloreado, { type: 'array' });
    expect(releido.Sheets['Plantilla 1'].B3.v).toBe(6000);
  });
});

describe('Carga: lo editado en la presentación llega al PowerPoint', () => {
  const COLUMNAS = {
    cierre: 'CIERRE SUBSECRETARIA', fecha: 'FECHA', tipo: 'TIPO DE MANIFIESTO', operacion: 'TIPO DE OPERACIÓN',
    aerolinea: 'AEROLINEA', cargaNac: 'KGS. DE CARGA NACIONAL', cargaInt: 'KGS. DE CARGA INTERNACIONAL',
    cargaTotal: 'KG DE CARGA TOTAL', portal: '_portal_flight_date'
  };

  let E, api, datos, salida;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-conci-rep-carga-imprimir" class="d-none"></button>
      <button id="btn-conci-rep-carga-descargar" class="d-none"></button>
      <button id="btn-conci-rep-carga-editar" class="d-none"></button>
      <button data-conci-rep-carga="subsecretaria" class="active"></button>
      <button data-conci-rep-carga="presentacion"></button>
      <div id="conci-rep-carga-estado"></div>
      <div id="conci-rep-carga-error" class="d-none"></div>
      <div id="conci-rep-carga-edicion" class="d-none"></div>
      <div id="conci-rep-carga-edicion-aviso" class="d-none"></div>
      <div id="conci-rep-carga-salida"></div>`;
    window._conciRowIsCargo = () => true;
    E = cargar('conci-carga-catalogo.js', 'conci-presentacion-carga.js', 'conci-reportes-carga.js');
    api = window.conciReportesCarga;
    datos = api.agregar({
      filas: [{
        'CIERRE SUBSECRETARIA': '2026-09-01', 'FECHA': '2026-08-31', 'TIPO DE MANIFIESTO': 'LLEGADA',
        'TIPO DE OPERACIÓN': 'INTERNACIONAL', 'AEROLINEA': 'ESTAFETA',
        'KGS. DE CARGA NACIONAL': 0, 'KGS. DE CARGA INTERNACIONAL': 1709340, 'KG DE CARGA TOTAL': 0
      }],
      columnas: COLUMNAS
    }, '2026-08-31');
    api.mostrar(datos);
    document.querySelector('[data-conci-rep-carga="presentacion"]').click();
    salida = document.getElementById('conci-rep-carga-salida');
  });

  afterEach(() => { delete window._conciRowIsCargo; });

  const calculado = () => {
    const c = document.createElement('div');
    c.innerHTML = salida.innerHTML;
    return c;
  };

  test('cada cifra de la vista previa sabe qué marcador de la plantilla es', () => {
    const t = api.modeloPresentacion(datos).texto;
    const marcados = salida.querySelectorAll('[data-ph]');
    expect(marcados.length).toBeGreaterThan(120);
    marcados.forEach(n => expect(E.textoDe(n)).toBe(String(t[n.getAttribute('data-ph')] ?? '').trim()));
  });

  test('lo corregido y marcado va por diapositiva; lo demás queda como se calculó', () => {
    const original = calculado();
    const lamina2 = salida.querySelectorAll('.cp-slide')[1];
    const acumulado = lamina2.querySelector('[data-ph="ACUM_OPS"]');
    acumulado.textContent = '99,999';
    acumulado.setAttribute('data-marca', 'azul');
    const tarjeta = salida.querySelector('.cp-card[data-tj="3:0"]');
    tarjeta.querySelector('[data-tj-campo="ops"]').textContent = '77';
    tarjeta.setAttribute('data-marca', 'rojo');

    const modelo = api.aplicarEdicionesPresentacion(api.modeloPresentacion(datos), salida, original);
    expect(modelo.porLamina.texto).toEqual({ 2: { ACUM_OPS: '99,999' } });
    expect(modelo.porLamina.marcas).toEqual({ 2: { ACUM_OPS: E.COLORES.azul.hex } });
    expect(modelo.tarjetas[3][0]).toMatchObject({ ops: '77', marca: E.COLORES.rojo.hex });
    // El acumulado de la diapositiva 7 no se tocó: sigue siendo el calculado.
    expect(modelo.porLamina.texto[7]).toBeUndefined();
  });

  test('sin tocar nada, el PowerPoint sale igual que siempre', () => {
    const modelo = api.aplicarEdicionesPresentacion(api.modeloPresentacion(datos), salida, calculado());
    expect(modelo.porLamina).toEqual({ texto: {}, marcas: {} });
  });
});
