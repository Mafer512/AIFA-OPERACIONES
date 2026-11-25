/**
 * @jest-environment jsdom
 *
 * Conciliación › Manifiestos › Exportar Excel › Próximo cierre.
 *
 * Descarga sólo los manifiestos que entrarán al próximo Cierre de
 * Subsecretaría, como los contará el SWEAR: el mismo lote que toma el botón
 * del cierre (053), clasificado en carga o pasajeros con la regla del cierre
 * (069), con los ajustes pendientes, y las cifras del día calculadas con las
 * funciones del SWEAR.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const leer = archivo => fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8');

// Los reportes del SWEAR, cargados como en la página (sin sus arranques de DOM).
beforeAll(() => {
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, opciones) => {
    if (tipo !== 'DOMContentLoaded') registrar(tipo, fn, opciones);
  });
  for (const archivo of ['conci-reportes-pasajeros.js', 'conci-carga-catalogo.js',
    'conci-presentacion-carga.js', 'conci-reportes-carga.js']) new Function(leer(archivo))();
  espia.mockRestore();
});

const L = require('../js/conci-export-lote-cierre.js');

const CATALOGO = [
  { id: 1, name: 'Volaris', iata: 'Y4', aliases: ['VOLARIS'], types: ['pasajeros'], active: true },
  { id: 2, name: 'Atlas Air', iata: '5Y', aliases: [], types: ['carga'], active: true },
  { id: 3, name: 'Aeroméxico', iata: 'AM', aliases: [], types: ['pasajeros', 'carga'], active: true },
  { id: 4, name: 'Carga Vieja', iata: 'ZZ', aliases: [], types: ['carga'], active: false }
];

function manifiesto(id, campos) {
  return {
    id, AEROLINEA: 'Y4', '# DE VUELO': '1291', FECHA: '24/11/2026', 'TIPO DE MANIFIESTO': 'LLEGADA',
    'TIPO DE OPERACIÓN': 'Nacional', 'DESTINO / ORIGEN': 'CUN-NLU', 'TOTAL PAX': null,
    'KGS. DE CARGA NACIONAL': null, 'KGS. DE CARGA INTERNACIONAL': null, 'KG DE CARGA TOTAL': null,
    'HR. DE RECEPCIÓN': '24/11/2026 10:00', 'CAPTURÓ': 'Capturista', INFORMATIVO: false,
    cierre_id: null, cierre_es_carga_reportado: null, cierre_aerolinea_reportada: null,
    'CIERRE SUBSECRETARIA': null, cierre_capturado_en: '2026-11-24T20:00:00+00:00',
    ...campos
  };
}

describe('clasificar: carga o pasajeros como lo escribe el cierre (069)', () => {
  test('una aerolínea de pasajeros con kilos y sin pasajeros es carga (Volaris mixta)', () => {
    expect(L.clasificar(manifiesto(1, { 'TOTAL PAX': 0, 'KGS. DE CARGA NACIONAL': 589 }), CATALOGO))
      .toEqual({ esCarga: true, aerolinea: 'Volaris' });
    expect(L.clasificar(manifiesto(1, { 'TOTAL PAX': 173, 'KG DE CARGA TOTAL': 589 }), CATALOGO))
      .toEqual({ esCarga: false, aerolinea: 'Volaris' });
  });

  test('una aerolínea sólo de carga es carga aunque traiga pasajeros', () => {
    expect(L.clasificar(manifiesto(1, { AEROLINEA: '5Y', 'TOTAL PAX': 3 }), CATALOGO).esCarga).toBe(true);
    // Con pasajeros y carga en el catálogo decide la regla de los kilos.
    expect(L.clasificar(manifiesto(1, { AEROLINEA: 'AM', 'TOTAL PAX': 120 }), CATALOGO).esCarga).toBe(false);
  });

  test('la marca de la recarga se respeta en una fila abierta', () => {
    const fila = manifiesto(1, { 'TOTAL PAX': 200, cierre_es_carga_reportado: true, cierre_aerolinea_reportada: ' VOLARIS ' });
    expect(L.clasificar(fila, CATALOGO)).toEqual({ esCarga: true, aerolinea: 'VOLARIS' });
  });

  test('busca por IATA, nombre o alias, sólo en el catálogo activo', () => {
    expect(L.clasificar(manifiesto(1, { AEROLINEA: ' volaris ', 'TOTAL PAX': 10 }), CATALOGO).aerolinea).toBe('Volaris');
    expect(L.clasificar(manifiesto(1, { AEROLINEA: 'ZZ', 'TOTAL PAX': 10 }), CATALOGO))
      .toEqual({ esCarga: false, aerolinea: 'ZZ' });
  });

  test('KG DE CARGA TOTAL en cero cae a nacional + internacional; los números se leen como la base', () => {
    const fila = manifiesto(1, { 'TOTAL PAX': '', 'KG DE CARGA TOTAL': '0', 'KGS. DE CARGA INTERNACIONAL': '1,250 kg' });
    expect(L.clasificar(fila, CATALOGO).esCarga).toBe(true);
    expect(L.numeroSeguro('1,250 kg')).toBe(1250);
    expect(L.numeroSeguro('-')).toBeNull();
    expect(L.numeroSeguro('1.2.3')).toBeNull();
    expect(L.numeroSeguro(null)).toBeNull();
  });
});

/** Cliente de Supabase de mentira: filtra, ordena por id y corta en maxRows. */
function clienteFalso({ tablas, resumenes, maxRows = 1000 }) {
  let rpcs = 0;
  const consultas = [];
  return {
    consultas,
    rpc: jest.fn(async nombre => {
      expect(nombre).toBe('conciliacion_resumen_lote_abierto');
      return { data: resumenes[Math.min(rpcs++, resumenes.length - 1)], error: null };
    }),
    from(tabla) {
      const filtros = [];
      let limite = Infinity;
      const q = {
        select: () => q,
        is: (c, v) => { filtros.push(['is', c, v]); return q; },
        not: (c, op, v) => { filtros.push(['not', c, op, v]); return q; },
        gte: (c, v) => { filtros.push(['gte', c, v]); return q; },
        eq: (c, v) => { filtros.push(['eq', c, v]); return q; },
        gt: (c, v) => { filtros.push(['gt', c, v]); return q; },
        order: () => q,
        limit: n => { limite = n; return q; },
        then(resolver, rechazar) {
          consultas.push({ tabla, filtros: filtros.map(f => f.join(' ')) });
          const filas = (tablas[tabla] || []).filter(f => filtros.every(([op, c, a]) => {
            if (op === 'is') return f[c] === null || f[c] === undefined;
            if (op === 'not') return f[c] !== null && f[c] !== undefined;
            if (op === 'gte') return String(f[c]) >= String(a);
            if (op === 'eq') return f[c] === a;
            return f[c] > a;
          })).sort((x, y) => x.id - y.id).slice(0, Math.min(limite, maxRows));
          return Promise.resolve({ data: filas, error: null }).then(resolver, rechazar);
        }
      };
      return q;
    }
  };
}

const BASELINE = '2026-10-22T00:00:00+00:00';
const resumen = (total, ajustes = 0) => ({
  baseline_en: BASELINE, total_manifiestos: total, ajustes_pendientes: ajustes, siguiente_fecha_corte: '2026-11-25'
});

describe('leerLote: el mismo lote que toma el botón del cierre', () => {
  const tablas = {
    'Conciliación Manifiestos': [
      manifiesto(1), manifiesto(2), manifiesto(3), manifiesto(4), manifiesto(5),
      manifiesto(6, { cierre_id: 9 }),                                     // ya cerrado
      manifiesto(7, { cierre_capturado_en: null }),                        // legacy
      manifiesto(8, { cierre_capturado_en: '2026-10-01T00:00:00+00:00' }) // antes del baseline
    ],
    conciliacion_ajustes: [
      { id: 1, estado: 'pendiente', cierre_aplicacion_id: null },
      { id: 2, estado: 'aplicado', cierre_aplicacion_id: 4 }
    ],
    conciliacion_catalogo_aerolineas: CATALOGO
  };

  test('trae sólo lo abierto desde el baseline, aunque la API corte en menos filas por página', async () => {
    const client = clienteFalso({ tablas, resumenes: [resumen(5, 1)], maxRows: 2 });
    const leido = await L.leerLote(client);
    expect(leido.filas.map(f => f.id)).toEqual([1, 2, 3, 4, 5]);
    expect(leido.ajustes.map(a => a.id)).toEqual([1]);
    expect(leido.catalogo.map(c => c.id)).toEqual([1, 2, 3]);
    expect(leido.fechaCorte).toBe('2026-11-25');
    const filtros = client.consultas.find(c => c.tabla === 'Conciliación Manifiestos').filtros;
    expect(filtros).toEqual(expect.arrayContaining(['is cierre_id ', 'not cierre_capturado_en is ', `gte cierre_capturado_en ${BASELINE}`]));
  });

  test('si no cuadra con el servidor, vuelve a leer y, si sigue sin cuadrar, no entrega nada', async () => {
    const client = clienteFalso({ tablas, resumenes: [resumen(6, 1)] });
    await expect(L.leerLote(client)).rejects.toThrow(/reporta 6 manifiestos en el lote y se leyeron 5/);
    expect(client.rpc).toHaveBeenCalledTimes(6);   // antes y después, tres veces
  });

  test('si el lote cambia a media lectura, la segunda vuelta ya cuadra', async () => {
    const client = clienteFalso({ tablas, resumenes: [resumen(4, 1), resumen(5, 1), resumen(5, 1)] });
    const leido = await L.leerLote(client);
    expect(leido.filas).toHaveLength(5);
  });
});

// El lote de un día, con lo que suele confundir.
const LOTE = [
  manifiesto(101, { 'TOTAL PAX': 173 }),                                                   // Volaris pasajeros
  manifiesto(102, { 'TOTAL PAX': 0, 'KGS. DE CARGA NACIONAL': 589 }),                       // Volaris carga: kilos sí, operación no
  manifiesto(103, { AEROLINEA: '5Y', '# DE VUELO': '8000', 'TIPO DE MANIFIESTO': 'SALIDA',
    'TIPO DE OPERACIÓN': 'Internacional', 'DESTINO / ORIGEN': 'NLU-CVG', 'KGS. DE CARGA INTERNACIONAL': 44220 }),
  manifiesto(104, { AEROLINEA: 'AM', '# DE VUELO': '400', 'TIPO DE MANIFIESTO': 'SALIDA',
    'TIPO DE OPERACIÓN': 'J', 'DESTINO / ORIGEN': 'NLU-LAX', 'TOTAL PAX': 120 }),           // el SWEAR lo cuenta nacional
  manifiesto(105, { '# DE VUELO': '3533', 'TIPO DE MANIFIESTO': 'SALIDA', 'TIPO DE OPERACIÓN': 'Internacional',
    'DESTINO / ORIGEN': 'NLU-ORD', 'TOTAL PAX': 154 }),
  manifiesto(106, { '# DE VUELO': '1', 'TOTAL PAX': 50, INFORMATIVO: true }),               // se cierra, no suma
  manifiesto(107, { '# DE VUELO': '2', 'TIPO DE MANIFIESTO': '', 'TOTAL PAX': 30 }),         // sin llegada ni salida
  manifiesto(108, { AEROLINEA: 'XN', '# DE VUELO': 'XN 1943', FECHA: '23/11/2026', 'DESTINO / ORIGEN': 'ACA-NLU',
    'TOTAL PAX': null, 'HR. DE RECEPCIÓN': null }),                                         // fila creada al tocar una celda
  manifiesto(109, { AEROLINEA: 'XN', '# DE VUELO': '1943', FECHA: '2026-11-23', 'DESTINO / ORIGEN': 'ACA-NLU-CPE',
    'TOTAL PAX': 40 }),
  manifiesto(110, { '# DE VUELO': '7113', 'TOTAL PAX': 0, 'KG DE CARGA TOTAL': 1000,
    cierre_es_carga_reportado: true, cierre_aerolinea_reportada: 'VOLARIS' })               // marca de la recarga
];
const AJUSTE = {
  id: 7, manifiesto_id: 55, campo: 'TOTAL PAX', valor_anterior: '100', valor_nuevo: '130', estado: 'pendiente',
  datos_antes: { ...manifiesto(55, { 'TOTAL PAX': 100, cierre_id: 3, cierre_es_carga_reportado: false }), 'CIERRE SUBSECRETARIA': '20/11/2026' },
  datos_despues: { ...manifiesto(55, { 'TOTAL PAX': 130, cierre_id: 3, cierre_es_carga_reportado: false }), 'CIERRE SUBSECRETARIA': '20/11/2026' }
};
const rutaOperacion = f => {
  const ruta = String(f['DESTINO / ORIGEN'] || '');
  return /LAX|ORD|CVG/.test(ruta) ? 'Internacional' : (ruta ? 'Nacional' : '');
};
const analizar = () => L.analizar({ filas: LOTE, ajustes: [AJUSTE], catalogo: CATALOGO, fechaCorte: '2026-11-25' },
  { P: window.conciReportesPasajeros, C: window.conciReportesCarga, rutaOperacion });

describe('analizar: lo que contará el SWEAR del día del cierre', () => {
  test('las cifras salen de las funciones del SWEAR, con el ajuste y sin lo que no suma', () => {
    const a = analizar();
    expect(a.cifras.pax).toEqual({ total: 517, nacional: 363, internacional: 154 });   // 173+120+0+40+30 | 154
    expect(a.cifras.opsPax).toEqual({ total: 5, nacional: 4, internacional: 1 });      // el ajuste: −1 +1
    expect(a.cifras.kilos).toEqual({ total: 45809, nacional: 1589, internacional: 44220 });
    expect(a.cifras.opsCarga).toEqual({ total: 1, nacional: 0, internacional: 1 });   // Volaris no es operación de carga
    expect(a.cifras.toneladas).toEqual({ total: 46, nacional: 2, internacional: 44 });
  });

  test('cada manifiesto del lote va a una hoja o a la lista de los que no suman, ni más ni menos', () => {
    const a = analizar();
    expect(a.totalLote).toBe(LOTE.length);
    expect(a.cuentan.map(f => f.id)).toEqual([101, 102, 103, 104, 105, 108, 109, 110]);
    expect(a.noCuentan.map(n => [n.fila.id, n.motivo])).toEqual([
      [106, 'INFORMATIVO: se cierra, pero no suma'],
      [107, 'TIPO DE MANIFIESTO sin LLEGADA ni SALIDA: no suma']
    ]);
    expect(a.pasajeros + a.carga + a.noCuentan.length).toBe(a.totalLote);
    expect(a.cuentan.filter(f => f.cierre_es_carga_reportado).map(f => f.id)).toEqual([102, 103, 110]);
    expect(a.cuentan.every(f => f['CIERRE SUBSECRETARIA'] === '25/11/2026')).toBe(true);
    expect(a.mixtas).toBe(2);
  });

  test('avisa lo que conviene revisar antes de cerrar', () => {
    const avisos = analizar().revisar.map(r => `${r.fila.id} ${r.motivo}`);
    expect(avisos).toEqual([
      '104 TIPO DE OPERACIÓN «J»: el SWEAR lo cuenta nacional; la ruta indica internacional',
      '108 Sin HR. DE RECEPCIÓN, sin pasajeros ni kilos: ¿es una captura real?',
      '108 Mismo vuelo, fecha y sentido más de una vez en el lote (ids 108, 109)',
      '109 Mismo vuelo, fecha y sentido más de una vez en el lote (ids 108, 109)'
    ]);
  });
});

/** ExcelJS de mentira: sólo lo que usa el módulo. */
class Hoja {
  constructor(name) { this.name = name; this.celdas = new Map(); }
  getCell(r, c) { const k = `${r},${c}`; if (!this.celdas.has(k)) this.celdas.set(k, {}); return this.celdas.get(k); }
  mergeCells() {}
  getColumn() { return {}; }
  renglon(etiqueta) {
    for (const [k, v] of this.celdas) {
      if (v.value !== etiqueta) continue;
      const [r] = k.split(',').map(Number);
      return [2, 3, 4].map(c => this.getCell(r, c).value);
    }
    return null;
  }
  textos() { return [...this.celdas.values()].map(c => c.value); }
}
class Libro {
  constructor() { this.worksheets = []; }
  addWorksheet(nombre) { const h = new Hoja(nombre); this.worksheets.push(h); return h; }
}

describe('armarLibro', () => {
  test('Resumen, Pasajeros y Carga con el formato de Exportar Excel, y Ajustes', async () => {
    const llamadas = [];
    const exportarHoja = jest.fn(async (kind, wb, opts) => { llamadas.push({ kind, opts }); wb.addWorksheet(opts.sheetName); return true; });
    const wb = await L.armarLibro({ Workbook: Libro }, analizar(), { exportarHoja, generado: '25/11/2026 18:00' });

    expect(wb.worksheets.map(h => h.name)).toEqual(['Resumen', 'Pasajeros', 'Carga', 'Ajustes']);
    expect(llamadas.map(l => [l.kind, l.opts.sheetName, l.opts.soloRecibidos, l.opts.sinHojaInformativos]))
      .toEqual([['pax', 'Pasajeros', false, true], ['carga', 'Carga', false, true]]);
    const filas = llamadas[0].opts.rows;
    expect(filas.map(f => f.id)).toEqual([101, 102, 103, 104, 105, 108, 109, 110]);
    expect(filas.find(f => f.id === 104)['TIPO DE OPERACIÓN']).toBe('Nacional');
    expect(filas.find(f => f.id === 102).cierre_es_carga_reportado).toBe(true);

    const resumen = wb.worksheets[0];
    expect(resumen.renglon('a. Pasajeros')).toEqual([517, 363, 154]);
    expect(resumen.renglon('d. Operaciones')).toEqual([1, 0, 1]);
    expect(resumen.textos()).toEqual(expect.arrayContaining([
      'Próximo Cierre de Subsecretaría: 25/11/2026', 'INFORMATIVO: se cierra, pero no suma', 107, 108]));
    const ajustes = wb.worksheets[3].textos();
    expect(ajustes).toEqual(expect.arrayContaining(['− como se reportó', '+ corregido', 100, 130, '100 → 130']));
  });
});

describe('las hojas salen de la misma ruta que Exportar Excel (script.js)', () => {
  const vm = require('vm');
  const js = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
  const extraer = (inicio, fin) => {
    const a = js.indexOf(inicio);
    const b = js.indexOf(fin, a + inicio.length);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return js.slice(a, b);
  };

  test('toma las filas que se le pasan, todas (no sólo las recibidas), sin hoja de informativos', () => {
    const exportar = extraer('async function _conciExportToExcel(kind, targetWb, opts = {})', 'window.conciExportExcel = _conciExportToExcel;');
    expect(exportar).toMatch(/\(targetWb && Array\.isArray\(opts\.rows\)\) \? opts\.rows : _conciGetExportRows\(\)/);
    expect(exportar).toMatch(/const soloRecibidos = opts\.soloRecibidos \?\? !!targetWb;/);
    expect(exportar).toMatch(/opts\.sinHojaInformativos/);
    expect(exportar).toMatch(/_conciRowIsCargo\(r, optypeCol, airlineCol\) === isCarga/);
    expect(exportar).toMatch(/wb\.addWorksheet\(\(targetWb && opts\.sheetName\) \|\| sheetLabel,/);
    expect(exportar).toMatch(/if \(targetWb\) return true;/);
  });

  test('separa carga y pasajeros con la marca que les pone el cierre, no con el catálogo', () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(extraer('function _conciRowIsCargo(', '// Convierte un movimiento del itinerario'), ctx);
    const [volarisCarga, volarisPax] = analizar().cuentan.filter(f => [102, 101].includes(f.id)).sort((x, y) => y.id - x.id);
    expect(ctx._conciRowIsCargo(volarisCarga, 'TIPO DE OPERACIÓN', 'AEROLINEA')).toBe(true);
    expect(ctx._conciRowIsCargo(volarisPax, 'TIPO DE OPERACIÓN', 'AEROLINEA')).toBe(false);
  });
});

describe('index.html', () => {
  test('el botón va en Exportar Excel, debajo de Carga, en su propio apartado', () => {
    const menu = html.slice(html.indexOf('aria-labelledby="dropdownExportConci"'));
    const fin = menu.indexOf('</ul>');
    const carga = menu.indexOf("conciExportExcel('carga')");
    const boton = menu.indexOf('id="btn-conci-export-lote-cierre"');
    expect(carga).toBeGreaterThan(0);
    expect(boton).toBeGreaterThan(carga);
    expect(boton).toBeLessThan(fin);
    expect(menu.slice(carga, boton)).toMatch(/Cierre de Subsecretaría/);
    expect(menu.slice(boton, fin)).toMatch(/conciExportLoteCierre\(\)/);
  });

  test('el módulo se carga después de los reportes del SWEAR', () => {
    const modulo = html.indexOf('src="js/conci-export-lote-cierre.js');
    expect(modulo).toBeGreaterThan(html.indexOf('src="js/conci-reportes-pasajeros.js'));
    expect(modulo).toBeGreaterThan(html.indexOf('src="js/conci-reportes-carga.js'));
  });
});
