/**
 * Coherencia de los campos que alimentan el TUA.
 *
 * Capturando celda por celda estos campos NO se pueden descuadrar: TOTAL
 * EXENTOS y PAX QUE PAGAN TUA son columnas calculadas, se recalculan solas y no
 * se dejan editar. El hueco está en el dato que no pasa por esos editores:
 * lo que entra por "Importar" desde Excel/CSV y lo que ya estaba guardado.
 *
 * Y ese hueco es difícil de ver: la tabla recalcula al renderizar, así que en
 * pantalla siempre aparece la cifra correcta aunque la guardada sea otra. Quien
 * lee la base directo — otras áreas, reportes, el portal — sí se lleva la mala.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  const fin = source.indexOf('\n}\n', inicio);
  if (fin === -1) throw new Error(`No se encontró el cierre de ${nombre}`);
  return source.slice(inicio, fin + 2);
}

const api = new Function(`
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciTuaCampos')}
  ${extraer('_conciTuaValoresEsperados')}
  ${extraer('_conciTuaDescuadres')}
  ${extraer('_conciTuaRecalcularPayload')}
  return { _conciTuaCampos, _conciTuaValoresEsperados, _conciTuaDescuadres, _conciTuaRecalcularPayload };
`)();

const COLUMNAS = [
  'FECHA', 'TIPO DE MANIFIESTO', 'AEROLINEA', '# DE VUELO', 'TOTAL PAX',
  'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS', 'CONEXIONES',
  'OTROS EXENTOS', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'OBSERVACIONES',
];

const campos = api._conciTuaCampos(COLUMNAS);
const descuadres = row => api._conciTuaDescuadres(row, campos);

describe('localiza los campos del TUA', () => {
  test('encuentra los seis rubros de exentos', () => {
    expect(campos.exentos).toEqual([
      'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS', 'CONEXIONES', 'OTROS EXENTOS',
    ]);
  });

  test('encuentra los dos derivados y el total', () => {
    expect(campos.totalExentos).toBe('TOTAL EXENTOS');
    expect(campos.paxTua).toBe('PAX QUE PAGAN TUA');
    expect(campos.totalPax).toBe('TOTAL PAX');
  });
});

describe('valores esperados', () => {
  test('el total de exentos es la suma de sus seis rubros', () => {
    const esperado = api._conciTuaValoresEsperados({
      'DIPLOMATICOS': '2', 'EN COMISION': '1', 'INFANTES': '4',
      'TRANSITOS': '10', 'CONEXIONES': '3', 'OTROS EXENTOS': '0',
    }, campos);
    expect(esperado.totalExentos).toBe(20);
  });

  test('en salidas, pagan TUA los que no están exentos', () => {
    const esperado = api._conciTuaValoresEsperados({
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': '180', 'INFANTES': '5', 'TRANSITOS': '15',
    }, campos);
    expect(esperado.totalExentos).toBe(20);
    expect(esperado.paxTua).toBe(160);
  });

  test('en llegadas nadie paga TUA', () => {
    const esperado = api._conciTuaValoresEsperados({
      'TIPO DE MANIFIESTO': 'LLEGADA', 'TOTAL PAX': '180', 'INFANTES': '5',
    }, campos);
    expect(esperado.paxTua).toBe(0);
  });
});

describe('detecta descuadres en el dato guardado', () => {
  test('un total de exentos que no cuadra con sus rubros', () => {
    const d = descuadres({
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': '180',
      'INFANTES': '5', 'TRANSITOS': '15',
      'TOTAL EXENTOS': '25',
      'PAX QUE PAGAN TUA': '160',
    });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ columna: 'TOTAL EXENTOS', guardado: 25, esperado: 20 });
  });

  test('un pax que pagan TUA que no cuadra', () => {
    const d = descuadres({
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': '180',
      'INFANTES': '5', 'TRANSITOS': '15',
      'TOTAL EXENTOS': '20',
      'PAX QUE PAGAN TUA': '175',
    });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ columna: 'PAX QUE PAGAN TUA', guardado: 175, esperado: 160 });
  });

  test('una llegada con TUA cobrado es un descuadre', () => {
    const d = descuadres({
      'TIPO DE MANIFIESTO': 'LLEGADA', 'TOTAL PAX': '180', 'PAX QUE PAGAN TUA': '180',
    });
    expect(d).toHaveLength(1);
    expect(d[0].esperado).toBe(0);
  });

  test('una fila coherente no se marca', () => {
    expect(descuadres({
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': '180',
      'INFANTES': '5', 'TRANSITOS': '15',
      'TOTAL EXENTOS': '20', 'PAX QUE PAGAN TUA': '160',
    })).toEqual([]);
  });

  test('un campo vacío es "sin capturar", no un descuadre', () => {
    expect(descuadres({
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': '180', 'INFANTES': '5',
      'TOTAL EXENTOS': '', 'PAX QUE PAGAN TUA': '   ',
    })).toEqual([]);
  });

  test('una fila de carga, sin rubros de pasajeros, no se marca', () => {
    expect(descuadres({ 'TIPO DE MANIFIESTO': 'SALIDA', 'AEROLINEA': 'CARGOLUX' })).toEqual([]);
  });

  test('acepta separadores de miles en el valor guardado', () => {
    expect(descuadres({
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': '1,200',
      'TRANSITOS': '200', 'TOTAL EXENTOS': '200', 'PAX QUE PAGAN TUA': '1,000',
    })).toEqual([]);
  });
});

describe('la importación guarda datos coherentes', () => {
  test('corrige un archivo con exentos descuadrados', () => {
    const payload = {
      'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': 180,
      'INFANTES': 5, 'TRANSITOS': 15,
      'TOTAL EXENTOS': 25,
      'PAX QUE PAGAN TUA': 155,
    };
    api._conciTuaRecalcularPayload(payload);
    expect(payload['TOTAL EXENTOS']).toBe(20);
    expect(payload['PAX QUE PAGAN TUA']).toBe(160);
  });

  test('no inventa columnas que el archivo no traía', () => {
    const payload = { 'TIPO DE MANIFIESTO': 'SALIDA', 'TOTAL PAX': 100, 'INFANTES': 4 };
    api._conciTuaRecalcularPayload(payload);
    expect(payload['TOTAL EXENTOS']).toBeUndefined();
    expect(payload['PAX QUE PAGAN TUA']).toBeUndefined();
  });

  test('respeta la regla de llegadas', () => {
    const payload = {
      'TIPO DE MANIFIESTO': 'LLEGADA', 'TOTAL PAX': 200,
      'TOTAL EXENTOS': 0, 'PAX QUE PAGAN TUA': 200,
    };
    api._conciTuaRecalcularPayload(payload);
    expect(payload['PAX QUE PAGAN TUA']).toBe(0);
  });

  test('no toca una fila de carga', () => {
    const payload = { 'TIPO DE MANIFIESTO': 'SALIDA', 'KG DE CARGA TOTAL': 31000 };
    const antes = { ...payload };
    api._conciTuaRecalcularPayload(payload);
    expect(payload).toEqual(antes);
  });
});
