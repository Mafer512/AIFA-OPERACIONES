/**
 * @jest-environment jsdom
 *
 * Exportación anual del Parte de Operaciones en cuadrícula día × mes.
 *
 * La tabla de la pantalla es un registro cronológico: una fila por día, con
 * llegadas y salidas separadas. El formato que se usa fuera del sistema es el
 * contrario: los 31 días como renglones y los 12 meses como columnas, cada mes
 * con PAX / CARGA / GRAL.
 *
 * Lo que esta suite fija:
 *
 *  - La aritmética de cada casilla (llegadas + salidas por categoría), contra
 *    los datos reales de la pantalla.
 *  - Que un día sin parte capturado quede EN BLANCO y no en cero. Son cosas
 *    distintas: el cero dice "no hubo operaciones", el blanco dice "falta
 *    capturarlo". Confundirlos es lo que hace que un hueco pase inadvertido.
 *  - Que la fecha se lea del texto y no por new Date(), que corre el día según
 *    la zona horaria del equipo.
 */

const fs = require('fs');
const path = require('path');

require(path.resolve(__dirname, '..', 'js', 'parte-ops-export.js'));
const api = window.parteOpsExport;

/** Un renglón de parte_operations tal y como lo devuelve Supabase. */
function parte(fecha, comercial, carga, general) {
  return {
    fecha,
    comercial_llegada: comercial[0], comercial_salida: comercial[1],
    carga_llegada: carga[0], carga_salida: carga[1],
    general_llegada: general[0], general_salida: general[1],
  };
}

describe('cada casilla suma llegadas y salidas de su categoría', () => {
  // Tomado de la pantalla: 30 de Julio 2026, Comercial 92/93, Carga 20/18,
  // General 5/4, Total General 232. La suma de las tres casillas tiene que dar
  // ese mismo total, o la exportación estaría contando otra cosa.
  test('reproduce el 30 de julio de 2026 y cuadra con su Total General', () => {
    const filas = [parte('2026-07-30', [92, 93], [20, 18], [5, 4])];

    const matriz = api.construirMatrizAnual(filas, '2026');
    const celda = matriz.celdas[29][6];   // día 30, julio

    expect(celda).toEqual({ pax: 185, carga: 38, gral: 9 });
    expect(celda.pax + celda.carga + celda.gral).toBe(232);
  });

  test('varios días y meses caen cada uno en su casilla', () => {
    const filas = [
      parte('2026-01-01', [70, 72], [10, 11], [1, 1]),
      parte('2026-06-08', [81, 81], [16, 14], [1, 2]),
      parte('2026-12-31', [40, 41], [5, 5], [0, 0]),
    ];

    const matriz = api.construirMatrizAnual(filas, '2026');

    expect(matriz.celdas[0][0]).toEqual({ pax: 142, carga: 21, gral: 2 });
    expect(matriz.celdas[7][5]).toEqual({ pax: 162, carga: 30, gral: 3 });
    expect(matriz.celdas[30][11]).toEqual({ pax: 81, carga: 10, gral: 0 });
    expect(matriz.registros).toBe(3);
  });

  test('un valor ausente o no numérico cuenta como cero, no rompe la casilla', () => {
    const filas = [{ fecha: '2026-03-05', comercial_llegada: 50, carga_salida: '7' }];

    const matriz = api.construirMatrizAnual(filas, '2026');

    expect(matriz.celdas[4][2]).toEqual({ pax: 50, carga: 7, gral: 0 });
  });
});

describe('un día sin parte capturado queda en blanco, no en cero', () => {
  test('las casillas sin registro son null', () => {
    const matriz = api.construirMatrizAnual(
      [parte('2026-01-01', [10, 10], [1, 1], [0, 0])], '2026'
    );

    expect(matriz.celdas[0][0]).not.toBeNull();
    expect(matriz.celdas[1][0]).toBeNull();       // 2 de enero: sin parte
    expect(matriz.celdas[0][1]).toBeNull();       // 1 de febrero: sin parte
  });

  test('un día capturado con cero operaciones SÍ se distingue de uno sin capturar', () => {
    const matriz = api.construirMatrizAnual(
      [parte('2026-02-10', [0, 0], [0, 0], [0, 0])], '2026'
    );

    expect(matriz.celdas[9][1]).toEqual({ pax: 0, carga: 0, gral: 0 });
    expect(matriz.celdas[10][1]).toBeNull();
  });

  test('el mes sin ningún parte no aporta total', () => {
    const matriz = api.construirMatrizAnual(
      [parte('2026-01-01', [10, 10], [1, 1], [0, 0])], '2026'
    );

    const totales = api.totalesPorMes(matriz);

    expect(totales[0]).toEqual({ pax: 20, carga: 2, gral: 0, dias: 1 });
    expect(totales[1]).toBeNull();
  });
});

describe('la fecha se lee del texto, nunca por new Date()', () => {
  // new Date('2026-07-01') se interpreta como medianoche UTC: en México eso es
  // el 30 de junio a las 18:00, así que el día 1 se dibujaría en el mes
  // anterior. En una cuadrícula por día ese corrimiento no se nota a simple
  // vista, y desplaza el año entero.
  test('el primero de mes cae en su mes, no en el anterior', () => {
    const matriz = api.construirMatrizAnual(
      [parte('2026-07-01', [76, 77], [22, 22], [3, 4])], '2026'
    );

    expect(matriz.celdas[0][6]).toEqual({ pax: 153, carga: 44, gral: 7 });
    expect(matriz.celdas[29][5]).toBeNull();   // 30 de junio sigue vacío
  });

  test('partesDeFecha no depende de la zona horaria', () => {
    expect(api.partesDeFecha('2026-01-01')).toEqual({ anio: '2026', mes: 1, dia: 1 });
    expect(api.partesDeFecha('2026-12-31T00:00:00Z')).toEqual({ anio: '2026', mes: 12, dia: 31 });
  });

  test('una fecha ilegible se descarta en vez de caer en una casilla equivocada', () => {
    expect(api.partesDeFecha('')).toBeNull();
    expect(api.partesDeFecha(null)).toBeNull();
    expect(api.partesDeFecha('30/07/2026')).toBeNull();
    expect(api.partesDeFecha('2026-13-01')).toBeNull();

    const matriz = api.construirMatrizAnual([{ fecha: 'no es fecha' }], '2026');
    expect(matriz.registros).toBe(0);
  });
});

describe('sólo entra el año que se pidió', () => {
  test('los partes de otros años no se cuelan en la cuadrícula', () => {
    const filas = [
      parte('2025-07-30', [1, 1], [1, 1], [1, 1]),
      parte('2026-07-30', [92, 93], [20, 18], [5, 4]),
      parte('2027-07-30', [2, 2], [2, 2], [2, 2]),
    ];

    const matriz = api.construirMatrizAnual(filas, '2026');

    expect(matriz.registros).toBe(1);
    expect(matriz.celdas[29][6]).toEqual({ pax: 185, carga: 38, gral: 9 });
  });

  test('dos partes del mismo día se suman en vez de que uno pise al otro', () => {
    const filas = [
      parte('2026-05-04', [10, 10], [1, 1], [0, 0]),
      parte('2026-05-04', [5, 5], [2, 2], [1, 1]),
    ];

    const matriz = api.construirMatrizAnual(filas, '2026');

    expect(matriz.celdas[3][4]).toEqual({ pax: 30, carga: 6, gral: 2 });
    expect(matriz.registros).toBe(2);
  });

  test('los años ofrecidos son los que existen, del más reciente al más antiguo', () => {
    const filas = [
      parte('2025-01-01', [1, 1], [0, 0], [0, 0]),
      parte('2026-01-01', [1, 1], [0, 0], [0, 0]),
      parte('2026-06-01', [1, 1], [0, 0], [0, 0]),
    ];

    expect(api.aniosDisponibles(filas)).toEqual(['2026', '2025']);
    expect(api.aniosDisponibles([])).toEqual([]);
  });
});

describe('la hoja tiene la forma pedida', () => {
  // ExcelJS no está en el entorno de pruebas: se comprueba la estructura contra
  // un doble mínimo que registra lo que la escritura pide de él.
  function libroFalso() {
    const celdas = new Map();
    const merges = [];
    const clave = (f, c) => `${f}:${c}`;
    const celda = (f, c) => {
      const k = clave(f, c);
      if (!celdas.has(k)) celdas.set(k, {});
      return celdas.get(k);
    };
    const hoja = {
      nombre: '',
      vistas: null,
      anchos: new Map(),
      getColumn: (c) => ({ set width(v) { hoja.anchos.set(c, v); }, get width() { return hoja.anchos.get(c); } }),
      getRow: (f) => ({ set height(v) {}, getCell: (c) => celda(f, c) }),
      getCell: (f, c) => celda(f, c),
      mergeCells: (f1, c1, f2, c2) => merges.push([f1, c1, f2, c2]),
    };
    global.ExcelJS = {
      Workbook: function () {
        this.addWorksheet = (nombre, opciones) => {
          hoja.nombre = nombre;
          hoja.vistas = opciones && opciones.views;
          return hoja;
        };
      },
    };
    return { hoja, celdas, merges, valor: (f, c) => (celdas.get(clave(f, c)) || {}).value };
  }

  const filas = [
    parte('2026-01-01', [70, 72], [10, 11], [1, 1]),
    parte('2026-07-30', [92, 93], [20, 18], [5, 4]),
  ];

  test('dos pisos de encabezado: el mes arriba, sus tres medidas abajo', () => {
    const doble = libroFalso();
    api.construirLibro(api.construirMatrizAnual(filas, '2026'));

    expect(doble.valor(1, 1)).toBe('DIA');
    expect(doble.valor(1, 2)).toBe('ENE');
    expect(doble.valor(1, 20)).toBe('JUL');       // 2 + 6*3
    expect(doble.valor(1, 35)).toBe('DIC');       // 2 + 11*3
    expect([doble.valor(2, 2), doble.valor(2, 3), doble.valor(2, 4)])
      .toEqual(['PAX', 'CARGA', 'GRAL']);
    // El mes ocupa sus tres columnas; DIA ocupa los dos pisos.
    expect(doble.merges).toContainEqual([1, 2, 1, 4]);
    expect(doble.merges).toContainEqual([1, 1, 2, 1]);
  });

  test('31 renglones de día, con el dato en la columna que le toca', () => {
    const doble = libroFalso();
    api.construirLibro(api.construirMatrizAnual(filas, '2026'));

    expect(doble.valor(3, 1)).toBe(1);            // primer día
    expect(doble.valor(33, 1)).toBe(31);          // último día
    // 1 de enero → renglón 3, columnas 2/3/4
    expect([doble.valor(3, 2), doble.valor(3, 3), doble.valor(3, 4)]).toEqual([142, 21, 2]);
    // 30 de julio → renglón 32, columnas 20/21/22
    expect([doble.valor(32, 20), doble.valor(32, 21), doble.valor(32, 22)]).toEqual([185, 38, 9]);
  });

  test('el día sin parte se escribe vacío, no como cero', () => {
    const doble = libroFalso();
    api.construirLibro(api.construirMatrizAnual(filas, '2026'));

    expect(doble.valor(4, 2)).toBe('');           // 2 de enero
    expect(doble.valor(3, 5)).toBe('');           // 1 de febrero
  });

  test('cierra con el total del mes y deja fijos el día y los encabezados', () => {
    const doble = libroFalso();
    api.construirLibro(api.construirMatrizAnual(filas, '2026'));

    expect(doble.valor(34, 1)).toBe('TOTAL');
    expect([doble.valor(34, 2), doble.valor(34, 3), doble.valor(34, 4)]).toEqual([142, 21, 2]);
    expect(doble.valor(34, 5)).toBe('');          // febrero sin partes
    expect(doble.hoja.vistas).toEqual([{ state: 'frozen', xSplit: 1, ySplit: 2 }]);
  });
});

describe('la pantalla queda conectada', () => {
  const tab = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'parte-ops-tab.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

  test('el botón y el selector de año existen y el script se carga', () => {
    expect(html).toContain('id="btn-export-parte-ops"');
    expect(html).toContain('id="filter-parte-ops-year"');
    expect(html).toMatch(/<script src="js\/parte-ops-export\.js\?v=[^"]+"><\/script>/);
  });

  // El filtro de mes tenía el año fijo en '2025': devolvía registros de 2025
  // mientras la tabla mostraba 2026, y parecía que "no traía nada".
  test('el filtro de mes ya no trae el año inventado', () => {
    expect(tab).not.toContain("const year = '2025'");
    expect(tab).toContain('const year = anioSeleccionado()');
  });

  test('la exportación pide el año completo, no lo que esté filtrado', () => {
    const exportador = fs.readFileSync(
      path.resolve(__dirname, '..', 'js', 'parte-ops-export.js'), 'utf8');
    expect(exportador).toContain("gte('fecha', `${anio}-01-01`)");
    expect(exportador).toContain("lte('fecha', `${anio}-12-31`)");
  });
});
