/**
 * @jest-environment jsdom
 *
 * Reportes › lectura de TODOS los manifiestos hasta la fecha.
 *
 * La API corta cada respuesta en 10,000 renglones y, con más manifiestos, se
 * perdía lo más reciente (el 31/08 salía vacío: "10,000 manifiestos leídos").
 * Paginar con offset sobre conciliacion_reporte_reportable lo resolvía, pero
 * cada página recalculaba todo y el reporte tardaba o caía por tiempo. Ahora
 * se usa conciliacion_reporte_reportable_pagina (migración 057): sólo las
 * columnas de los reportes y paginada por cursor (_uid). Si la base todavía no
 * la tiene, se usa la función de siempre por páginas.
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

const TOPE = 10000; // como la API: cada respuesta trae a lo mucho esto
function manifiestos(total) {
  return Array.from({ length: total }, (_, i) => ({
    'CIERRE SUBSECRETARIA': i === total - 1 ? '31/08/2026' : '30/08/2026',
    'FECHA': '30/08/2026', 'TIPO DE MANIFIESTO': 'SALIDA', 'TIPO DE OPERACIÓN': 'Nacional',
    'AEROLINEA': 'VB', 'TOTAL PAX': 1, '_uid': 'M' + String(i).padStart(18, '0'), '_signo': 1,
  }));
}

// Base con la función nueva: respeta p_despues y p_limite, igual que el SQL.
function baseConCursor(total) {
  const filas = manifiestos(total);
  const llamadas = [];
  return {
    llamadas,
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      if (nombre !== 'conciliacion_reporte_reportable_pagina') return { data: null, error: { message: 'no se esperaba' } };
      const siguientes = filas.filter(f => f._uid > (args.p_despues || ''));
      return { data: siguientes.slice(0, Math.min(args.p_limite, TOPE)), error: null };
    },
  };
}

// Base SIN la función nueva (todavía no se corre la 057): la de siempre con .range().
function baseSinCursor(total) {
  const filas = manifiestos(total);
  const llamadas = [];
  return {
    llamadas,
    rpc(nombre, args) {
      llamadas.push({ nombre, args });
      if (nombre === 'conciliacion_reporte_reportable_pagina') {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.conciliacion_reporte_reportable_pagina' } });
      }
      let desde = 0, hasta = TOPE - 1;
      const q = {
        range(a, b) { desde = a; hasta = b; return q; },
        then(res, rej) {
          const n = Math.min(hasta - desde + 1, TOPE);
          return Promise.resolve({ data: filas.slice(desde, desde + n), error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

describe('Reportes leen todos los manifiestos, rápido', () => {
  afterEach(() => { delete window.supabaseClient; delete window.conciReportesPasajeros; });

  test('con la función por cursor: 12,345 manifiestos en 3 páginas, incluido el más reciente', async () => {
    const base = baseConCursor(12345);
    window.supabaseClient = base;
    cargar(leer('js/conci-reportes-pasajeros.js'));
    const datos = await window.conciReportesPasajeros.leer('2026-08-31');
    expect(datos.filas).toHaveLength(12345);
    expect(datos.filas[12344]['CIERRE SUBSECRETARIA']).toBe('31/08/2026');
    expect(base.llamadas.map(l => l.args.p_despues)).toEqual(['', 'M000000000000004999', 'M000000000000009999']);
    expect(base.llamadas.every(l => l.nombre === 'conciliacion_reporte_reportable_pagina' && l.args.p_hasta === '2026-08-31' && l.args.p_limite === 5000)).toBe(true);
  });

  test('sin la función nueva en la base: usa la de siempre por páginas y llegan todos', async () => {
    const base = baseSinCursor(12345);
    window.supabaseClient = base;
    cargar(leer('js/conci-reportes-pasajeros.js'));
    const datos = await window.conciReportesPasajeros.leer('2026-08-31');
    expect(datos.filas).toHaveLength(12345);
    expect(base.llamadas[0].nombre).toBe('conciliacion_reporte_reportable_pagina');
    expect(base.llamadas.slice(1).every(l => l.nombre === 'conciliacion_reporte_reportable')).toBe(true);
  });

  test('el reporte de carga lee igual', () => {
    const carga = leer('js/conci-reportes-carga.js');
    expect(carga).toMatch(/client\.rpc\('conciliacion_reporte_reportable_pagina',\s*\{ p_hasta: hastaIso, p_despues: despues, p_limite: PAGINA_RPC \}\)/);
    expect(carga).toMatch(/if \(!filas\.length && funcionNoExiste\(respuesta\.error\)\) return leerReportableCompleto\(client, hastaIso, avisar\);/);
    expect(carga).toMatch(/const filasRpc = await leerReportable\(client, hastaIso, avisar\);/);
  });

  test('la migración 057 regresa sólo las columnas de los reportes y pagina por _uid', () => {
    const sql = leer('supabase/migrations/057_conciliacion_reporte_reportable_pagina.sql');
    expect(sql).toMatch(/WHERE v\._uid > coalesce\(p_despues, ''\)/);
    expect(sql).toMatch(/ORDER BY v\._uid\s+LIMIT least\(greatest\(coalesce\(p_limite, 5000\), 1\), 10000\);/);
    const cuerpo = sql.slice(sql.indexOf('AS $$'), sql.indexOf('$$;'));
    // Columnas normales (las serializa PostgREST una vez), nunca la fila completa.
    expect(sql).toMatch(/RETURNS TABLE \(/);
    expect(cuerpo).not.toMatch(/to_jsonb|jsonb_build_object|_portal_manifest_data/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.conciliacion_reporte_reportable_pagina\(date, text, integer\) TO authenticated;/);
  });
});
