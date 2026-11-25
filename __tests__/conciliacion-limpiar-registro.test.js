/**
 * @jest-environment jsdom
 *
 * Conciliación › Manifiestos › Acciones › Limpiar registro (migración 073).
 *
 * Quita un manifiesto ABIERTO para que no entre al Cierre de Subsecretaría,
 * por ejemplo cuando alguien escribió en una fila del itinerario y borró lo
 * escrito, pero el registro ya se había creado. Un capturista sólo limpia lo
 * que capturó él (según el historial, por usuario); editores y
 * administradores, cualquier fila abierta; nadie, una fila cerrada.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n');
const js = leer('script.js');
const sql = leer('supabase/migrations/073_conciliacion_limpiar_registro.sql');
const html = leer('index.html');

function extraer(inicio, fin) {
  const a = js.indexOf(inicio);
  const b = js.indexOf(fin, a + inicio.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return js.slice(a, b);
}

describe('la base decide quién puede limpiar (073)', () => {
  const revisar = sql.slice(sql.indexOf('FUNCTION public.conciliacion_revisar_limpieza'), sql.indexOf('FUNCTION public.conciliacion_limpiar_registro'));
  const limpiar = sql.slice(sql.indexOf('FUNCTION public.conciliacion_limpiar_registro'));

  test('un capturista sólo limpia lo que el historial dice que capturó él, comparando el usuario', () => {
    expect(revisar).toMatch(/FROM public\.conciliacion_manifiestos_historial h\s+WHERE h\.manifiesto_id = p_id\s+AND h\.operacion IN \('INSERT', 'UPDATE'\)/);
    expect(revisar).toMatch(/count\(\*\) FILTER \(WHERE h\.usuario_id IS DISTINCT FROM auth\.uid\(\)\)/);
    expect(revisar).toMatch(/ELSIF v_ajenos > 0 THEN\s+v_puede := false;/);
    // Sin historial (importada o de un script) no es "suya".
    expect(revisar).toMatch(/ELSIF v_total = 0 THEN\s+v_puede := false;/);
  });

  test('editores y administradores pueden; nadie limpia una fila cerrada', () => {
    expect(revisar).toMatch(/IF v_cerrado THEN\s+v_puede := false;/);
    expect(revisar).toMatch(/ELSIF v_nivel IN \('admin', 'edit'\) THEN\s+v_puede := true;/);
    expect(revisar.indexOf('IF v_cerrado THEN')).toBeLessThan(revisar.indexOf("ELSIF v_nivel IN ('admin', 'edit')"));
  });

  test('la limpieza bloquea la fila, vuelve a revisar, respalda y después borra', () => {
    const bloqueo = limpiar.indexOf('FOR UPDATE');
    const revision = limpiar.indexOf('public.conciliacion_revisar_limpieza(p_id)');
    const respaldo = limpiar.indexOf('INSERT INTO public.conciliacion_registros_limpiados');
    const borrado = limpiar.indexOf('DELETE FROM public."Conciliación Manifiestos" WHERE id = p_id');
    expect(bloqueo).toBeGreaterThan(-1);
    expect(revision).toBeGreaterThan(bloqueo);
    expect(respaldo).toBeGreaterThan(revision);
    expect(borrado).toBeGreaterThan(respaldo);
    expect(limpiar).toMatch(/RAISE EXCEPTION '%', v_revision ->> 'motivo'/);
  });

  test('sólo usuarios autenticados la usan y el respaldo no se escribe desde la app', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.conciliacion_revisar_limpieza\(bigint\) TO authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.conciliacion_limpiar_registro\(bigint\) TO authenticated;/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.conciliacion_registros_limpiados FROM authenticated;/);
  });
});

describe('el botón en la columna Acciones', () => {
  function pintar({ gestiona, cerrado }) {
    const ctx = {
      document,
      window: { _conciCierreEstaCerrado: () => cerrado },
      _conciCanCurrentUserManage: () => gestiona,
    };
    vm.createContext(ctx);
    vm.runInContext(extraer('function _conciFillRowActionCell(', '// Limpia el estado "dirty"/warning'), ctx);
    const td = document.createElement('td');
    ctx._conciFillRowActionCell(td, '108219');
    return td;
  }

  test('lo ve quien captura, aunque no pueda eliminar filas', () => {
    const td = pintar({ gestiona: false, cerrado: false });
    const boton = td.querySelector('.conci-limpiar-row');
    expect(boton).not.toBeNull();
    expect(boton.dataset.rowId).toBe('108219');
    expect(boton.title).toMatch(/no entre al Cierre de Subsecretaría/);
    expect(td.querySelector('.conci-delete-row')).toBeNull();
  });

  test('no aparece en una fila ya cerrada', () => {
    expect(pintar({ gestiona: true, cerrado: true }).querySelector('.conci-limpiar-row')).toBeNull();
  });

  test('el clic de la tabla lo atiende', () => {
    const bind = extraer('function _conciBindRowActions()', '// Devuelve el <tr> con el que se queda el cursor');
    expect(bind).toMatch(/closest\('\.conci-delete-row, \.conci-delete-new-row, \.conci-limpiar-row'\)/);
    expect(bind).toMatch(/if \(button\.classList\.contains\('conci-limpiar-row'\)\) \{\s+await _conciLimpiarRegistro\(tr, button\);/);
  });
});

describe('limpiar', () => {
  const codigo = extraer('function _conciTextoConfirmarLimpieza(', 'function _conciBindRowActions()');
  const FILA = {
    AEROLINEA: 'AM', '# DE VUELO': 'AM 2469', 'TIPO DE MANIFIESTO': 'LLEGADA', FECHA: '24/11/2026',
    'TOTAL PAX': 88, 'HR. DE RECEPCIÓN': '24/11/2026 12:10', 'MATRÍCULA': 'XAJAC', 'CAPTURÓ': 'Ana'
  };

  function preparar({ revision, confirma = true, errorLimpiar = null, errorRevisar = null }) {
    const llamadas = { rpc: [], alertas: [], confirmaciones: [], recargas: 0, olvidadas: 0, avisos: [] };
    const client = {
      rpc: jest.fn(async (nombre, args) => {
        llamadas.rpc.push([nombre, args]);
        if (nombre === 'conciliacion_revisar_limpieza') return { data: revision, error: errorRevisar };
        return { data: errorLimpiar ? null : { ok: true }, error: errorLimpiar };
      })
    };
    const ctx = {
      window: { supabaseClient: client },
      alert: m => llamadas.alertas.push(m),
      confirm: m => { llamadas.confirmaciones.push(m); return confirma; },
      _conciEscriturasEnVuelo: new Map(),
      _conciClaveEscrituraDeFila: () => 'id:108219',
      _conciBorradorOlvidarFila: () => { llamadas.olvidadas++; },
      _conciDesencolarPendientesDeFila: async () => {},
      _conciRenderCache: new Map([['x', 1]]),
      _conciRenderedKey: 'x',
      _conciNotificarManifiestosCambiaron: () => {},
      showNotification: (m, t) => llamadas.avisos.push([m, t]),
      loadConciliacionManifiestos: async () => { llamadas.recargas++; },
      String, Number, Set, Map, Promise, RegExp
    };
    vm.createContext(ctx);
    vm.runInContext(codigo + '\nthis._limpiar = _conciLimpiarRegistro; this._texto = _conciTextoConfirmarLimpieza;', ctx);
    const tr = document.createElement('tr');
    tr.dataset.rowId = '108219';
    tr.dataset.rowFuente = 'Manifiestos + Vuelos';
    tr.innerHTML = '<td data-col="TOTAL PAX"></td>';
    const boton = document.createElement('button');
    boton.dataset.rowId = '108219';
    return { ctx, llamadas, tr, boton };
  }

  test('si la base dice que no, explica por qué y no limpia', async () => {
    const motivo = 'En esta fila también capturó: Beto. Sólo puedes limpiar lo que capturaste tú; pídeselo a esa persona o a un editor.';
    const { ctx, llamadas, tr, boton } = preparar({ revision: { existe: true, puede: false, motivo } });
    await ctx._limpiar(tr, boton);
    expect(llamadas.alertas).toEqual([motivo]);
    expect(llamadas.rpc.map(r => r[0])).toEqual(['conciliacion_revisar_limpieza']);
    expect(llamadas.confirmaciones).toHaveLength(0);
    expect(llamadas.recargas).toBe(0);
    expect(boton.disabled).toBe(false);
  });

  test('pide confirmación con lo que se perderá y, si se cancela, no limpia', async () => {
    const { ctx, llamadas, tr, boton } = preparar({ revision: { existe: true, id: 108219, puede: true, capturistas: 'Ana', fila: FILA }, confirma: false });
    await ctx._limpiar(tr, boton);
    const texto = llamadas.confirmaciones[0];
    expect(texto).toMatch(/^¿Limpiar el registro del vuelo AM 2469 \(LLEGADA, 24\/11\/2026\)\?/);
    expect(texto).toMatch(/• Pasajeros: 88/);
    expect(texto).toMatch(/• HR\. DE RECEPCIÓN: 24\/11\/2026 12:10/);
    expect(texto).toMatch(/Capturó: Ana/);
    expect(texto).toMatch(/volverá a aparecer como vuelo del itinerario/);
    expect(llamadas.rpc.map(r => r[0])).toEqual(['conciliacion_revisar_limpieza']);
  });

  test('confirmado: la base la quita, se olvida lo local y se recarga la tabla', async () => {
    const { ctx, llamadas, tr, boton } = preparar({ revision: { existe: true, id: 108219, puede: true, capturistas: 'Ana', fila: FILA } });
    await ctx._limpiar(tr, boton);
    expect(llamadas.rpc).toEqual([
      ['conciliacion_revisar_limpieza', { p_id: 108219 }],
      ['conciliacion_limpiar_registro', { p_id: 108219 }]
    ]);
    expect(tr.dataset.conciDescartada).toBe('1');
    expect(llamadas.olvidadas).toBe(1);
    expect(ctx._conciRenderCache.size).toBe(0);
    expect(llamadas.recargas).toBe(1);
    expect(llamadas.avisos[0][0]).toMatch(/ya no entrará al Cierre de Subsecretaría/);
  });

  test('una fila sin datos propios lo dice, y una agregada a mano avisa que desaparece', () => {
    const { ctx } = preparar({ revision: null });
    const texto = ctx._texto({ id: 7, capturistas: 'Ana', fila: { AEROLINEA: 'XN', '# DE VUELO': '1943', 'TOTAL PAX': 0 } }, false);
    expect(texto).toMatch(/^¿Limpiar el registro del vuelo XN 1943\?/);
    expect(texto).toMatch(/No tiene pasajeros, kilos, matrícula ni HR\. DE RECEPCIÓN capturados\./);
    expect(texto).toMatch(/La fila desaparecerá de la tabla/);
  });

  test('si la base no tiene la migración 073, lo dice claro', async () => {
    const { ctx, llamadas, tr, boton } = preparar({
      revision: null,
      errorRevisar: { message: 'Could not find the function public.conciliacion_revisar_limpieza(p_id) in the schema cache' }
    });
    await ctx._limpiar(tr, boton);
    expect(llamadas.alertas).toEqual(['Falta instalar "Limpiar registro" en la base (migración 073).']);
  });
});

describe('index.html', () => {
  test('carga las versiones nuevas de script.js y del cierre', () => {
    expect(html).toMatch(/src="script\.js\?v=20261125-limpiar-registro"/);
    expect(html).toMatch(/src="js\/conci-cierre-subsecretaria\.js\?v=20261125-limpiar-registro"/);
  });
});
