/**
 * @jest-environment jsdom
 *
 * Reportes › la base entrega como máximo 10,000 renglones por consulta y corta
 * el resto en silencio. La RPC conciliacion_reporte_reportable regresa TODOS
 * los manifiestos hasta la fecha ordenados por _uid, así que con más de 10,000
 * se perdía lo más reciente: el 31/08 salía vacío aunque la tabla tenía sus
 * cierres ("10,000 manifiestos leídos"). Ahora se pide por páginas hasta que
 * una venga vacía.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');

function cargar(fuente) {
  const arranques = [];
  const registrar = document.addEventListener.bind(document);
  const espia = jest.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, opciones) => {
    if (tipo === 'DOMContentLoaded') { arranques.push(fn); return; }
    registrar(tipo, fn, opciones);
  });
  new Function(fuente)();
  espia.mockRestore();
  arranques.forEach(fn => fn());
}

// Como PostgREST: cada consulta regresa a lo mucho TOPE renglones.
const TOPE = 10000;
function clienteConTope(total) {
  const filas = Array.from({ length: total }, (_, i) => ({
    'CIERRE SUBSECRETARIA': i === total - 1 ? '31/08/2026' : '30/08/2026',
    'FECHA': '30/08/2026', 'TIPO DE MANIFIESTO': 'SALIDA', 'TIPO DE OPERACIÓN': 'Nacional',
    'AEROLINEA': 'VB', 'TOTAL PAX': 1, '_uid': 'M' + String(i).padStart(18, '0'), '_signo': 1,
  }));
  const llamadas = [];
  return {
    llamadas,
    rpc(nombre, args) {
      let desde = 0, hasta = TOPE - 1;
      const q = {
        range(a, b) { desde = a; hasta = b; return q; },
        then(res, rej) {
          llamadas.push({ nombre, args, desde, hasta });
          const n = Math.min(hasta - desde + 1, TOPE);
          return Promise.resolve({ data: filas.slice(desde, desde + n), error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

describe('Reportes leen todos los manifiestos aunque pasen del tope de la base', () => {
  test('12,345 manifiestos: llegan todos, incluido el más reciente', async () => {
    const cliente = clienteConTope(12345);
    window.supabaseClient = cliente;
    cargar(leer('js/conci-reportes-pasajeros.js'));
    const datos = await window.conciReportesPasajeros.leer('2026-08-31');
    expect(datos.filas).toHaveLength(12345);
    expect(datos.filas[12344]['CIERRE SUBSECRETARIA']).toBe('31/08/2026');
    expect(cliente.llamadas.every(l => l.nombre === 'conciliacion_reporte_reportable' && l.args.p_hasta === '2026-08-31')).toBe(true);
    // 5000 + 5000 + 2345 y una vacía que confirma el final.
    expect(cliente.llamadas.map(l => l.desde)).toEqual([0, 5000, 10000, 12345]);
  });

  test('el reporte de carga pagina igual', () => {
    const carga = leer('js/conci-reportes-carga.js');
    expect(carga).toMatch(/const PAGINA_RPC = 5000;/);
    expect(carga).toMatch(/consulta\.range\(desde, desde \+ PAGINA_RPC - 1\)/);
    expect(carga).toMatch(/if \(!paginada \|\| !pagina\.length\) break;/);
  });
});
