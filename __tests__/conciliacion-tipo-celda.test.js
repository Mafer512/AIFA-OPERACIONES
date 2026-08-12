/**
 * Validación de tipo en la celda, antes de intentar guardar.
 *
 * Un solo carácter no numérico en una columna de conteo hace que Postgres
 * rechace el UPDATE completo, y el mecanismo de auto-corrección responde
 * descartando TODAS las columnas numéricas del envío (_conciWriteRowSafe):
 * un dedazo puede tirar catorce campos de golpe. Filtrando la entrada en la
 * celda, ese plan B casi nunca tiene que activarse.
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
  return source.slice(inicio, fin + 2);
}

const api = new Function(`
  ${extraer('_conciNormalizedColumnName')}
  ${extraer('_conciIsNumericCaptureColumn')}
  ${extraer('_conciSoloNumero')}
  return { _conciIsNumericCaptureColumn, _conciSoloNumero };
`)();

describe('qué columnas se filtran', () => {
  test.each([
    'TOTAL PAX', 'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS',
    'CONEXIONES', 'OTROS EXENTOS', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA',
    'CORREO', 'KGS. DE EQUIPAJE', 'KGS. DE CARGA NACIONAL',
    'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL',
  ])('%s es de conteo', (col) => {
    expect(api._conciIsNumericCaptureColumn(col)).toBe(true);
  });

  test('# DE VUELO queda fuera: los designadores reales traen letras', () => {
    // "VB 9999" debe poder capturarse; ese caso lo resuelve _conciWriteRowSafe.
    expect(api._conciIsNumericCaptureColumn('# DE VUELO')).toBe(false);
  });

  test.each([
    'AEROLINEA', 'OBSERVACIONES', 'MATRÍCULA', 'DESTINO / ORIGEN',
    'TIPO DE MANIFIESTO', 'SLOT ASIGNADO', 'CÓDIGO DEMORA', 'FECHA',
  ])('%s no se filtra', (col) => {
    expect(api._conciIsNumericCaptureColumn(col)).toBe(false);
  });

  test('no le afectan los acentos ni el espaciado', () => {
    expect(api._conciIsNumericCaptureColumn('  Total   Pax  ')).toBe(true);
    expect(api._conciIsNumericCaptureColumn('kgs de carga nacional')).toBe(true);
  });
});

describe('filtrado del valor', () => {
  test('deja pasar los enteros', () => {
    expect(api._conciSoloNumero('180')).toBe('180');
  });

  test('quita las letras de un dedazo', () => {
    expect(api._conciSoloNumero('18o')).toBe('18');
    expect(api._conciSoloNumero('ciento ochenta')).toBe('');
  });

  test('quita separadores de miles y espacios', () => {
    expect(api._conciSoloNumero('19,700')).toBe('19700');
    expect(api._conciSoloNumero('18 500 kg')).toBe('18500');
  });

  test('conserva un punto decimal para los kilos', () => {
    expect(api._conciSoloNumero('1250.75')).toBe('1250.75');
  });

  test('un segundo punto se descarta', () => {
    expect(api._conciSoloNumero('1.250.75')).toBe('1.25075');
  });

  test('el signo negativo no pasa: no hay conteos negativos', () => {
    expect(api._conciSoloNumero('-5')).toBe('5');
  });

  test('tolera vacío y nulos', () => {
    expect(api._conciSoloNumero('')).toBe('');
    expect(api._conciSoloNumero(null)).toBe('');
    expect(api._conciSoloNumero(undefined)).toBe('');
  });
});

describe('regresión', () => {
  test('el editor de celda aplica el filtro', () => {
    const editor = source.slice(source.indexOf('function _conciActivateCellEditor'));
    expect(editor).toContain('_conciIsNumericCaptureColumn(col)');
    expect(editor).toContain('_conciSoloNumero(input.value)');
  });

  test('sigue existiendo el respaldo del servidor para lo que se cuele', () => {
    // El filtro reduce la probabilidad, no sustituye la red de seguridad.
    expect(source).toContain('invalid input syntax for');
  });
});
