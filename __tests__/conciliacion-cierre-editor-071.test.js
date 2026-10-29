/* 071: Cierre de Subsecretaría, correcciones de cerrados y casilla
 * INFORMATIVO para editor, admin y superadmin.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const sql = leer('supabase/migrations/071_conciliacion_cierre_editor.sql');
const scriptJs = leer('script.js');
const cierreJs = leer('js/conci-cierre-subsecretaria.js');

const bloque = (texto, inicio, fin) => {
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`no encontré ${inicio}`);
  return texto.slice(i, texto.indexOf(fin, i) + fin.length);
};

describe('071_conciliacion_cierre_editor.sql', () => {
  test('cerrar y autorizar correcciones: nivel admin o edit, y el permiso suelto sigue valiendo', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    [
      ['conciliacion_puede_cerrar_subsecretaria', 'conciliacion_cierra_subsecretaria'],
      ['conciliacion_puede_autorizar_correccion', 'conciliacion_autoriza_correccion'],
    ].forEach(([fn, flag]) => {
      const cuerpo = bloque(sql, `CREATE OR REPLACE FUNCTION public.${fn}()`, '$$;');
      expect(cuerpo).toContain("IF public.conciliacion_manifiestos_access_level(v_uid) IN ('admin', 'edit') THEN RETURN true; END IF;");
      expect(cuerpo).toContain(`RETURN public._conci_tiene_flag_permiso(v_uid, '${flag}');`);
      expect(cuerpo).toContain('SECURITY DEFINER');
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}() TO authenticated;`);
    });
    // Asignar permisos sueltos sigue siendo sólo de admin: 071 no lo toca.
    expect(sql).not.toMatch(/FUNCTION public\.conciliacion_manifiestos_set_privilegio/);
  });

  test('INFORMATIVO: un capturista no lo cambia; sin sesión no se restringe', () => {
    const guard = bloque(sql, 'CREATE OR REPLACE FUNCTION public._conci_informativo_guard()', '$$;');
    expect(guard).toMatch(/IF auth\.uid\(\) IS NULL\s+OR public\.conciliacion_manifiestos_access_level\(auth\.uid\(\)\) IN \('admin', 'edit'\)\s+OR public\.conciliacion_puede_autorizar_correccion\(\) THEN\s+RETURN NEW;/);
    expect(guard).toContain("USING ERRCODE = '42501'");
    expect(sql).toMatch(/BEFORE UPDATE OF "INFORMATIVO" ON public\."Conciliación Manifiestos"\s+FOR EACH ROW\s+WHEN \(NEW\."INFORMATIVO" IS DISTINCT FROM OLD\."INFORMATIVO"\)/);
    expect(sql).toMatch(/BEFORE INSERT ON public\."Conciliación Manifiestos"\s+FOR EACH ROW\s+WHEN \(NEW\."INFORMATIVO"\)/);
  });
});

describe('interfaz', () => {
  test('la casilla INFORMATIVO se habilita con el permiso de editor/admin/superadmin', () => {
    expect(scriptJs).toContain('const puedeInformativo = _conciCanCurrentUserManage();');
    expect(scriptJs).toContain('tr.appendChild(_conciInformativoTd(tr, row, puedeInformativo));');
    expect(scriptJs).toContain('tr.appendChild(_conciInformativoTd(tr, null, _conciCanCurrentUserManage()));');
    const fn = bloque(scriptJs, 'async function _conciCambiarInformativo(', '\n}\n');
    expect(fn).toMatch(/if \(!_conciCanCurrentUserManage\(\)\) \{\s+box\.checked = !marcado;/);
  });

  // Ejecuta las funciones de privilegio del módulo con un rol simulado.
  const privilegios = (role, { nivel = 'edit', permisos = {} } = {}) => {
    const ini = cierreJs.indexOf('    function _conciEsEditorOMas()');
    const fin = cierreJs.indexOf('    function bsModal(');
    const window = {
      _conciCurrentUserRole: () => role,
      _conciCanCurrentUserManage: () => ['editor', 'admin', 'superadmin'].includes(role) && ['edit', 'admin'].includes(nivel),
      _conciCanCurrentUserEdit: () => ['capturista', 'editor', 'admin', 'superadmin'].includes(role),
      dataManager: { permissions: permisos },
    };
    const ctx = vm.createContext({ window });
    vm.runInContext(cierreJs.slice(ini, fin)
      + '\nthis.r = { cierra: puedeCerrar(), autoriza: puedeAutorizarCorreccion(), solicita: puedeSolicitarCorreccion() };', ctx);
    return ctx.r;
  };

  test.each(['editor', 'admin', 'superadmin'])('%s ve Cierre de Subsecretaría, Corregir cerrado y Solicitudes', (role) => {
    expect(privilegios(role)).toEqual({ cierra: true, autoriza: true, solicita: true });
  });

  test('capturista: sólo solicita la corrección, salvo permiso suelto', () => {
    expect(privilegios('capturista', { nivel: 'capture' })).toEqual({ cierra: false, autoriza: false, solicita: true });
    expect(privilegios('capturista', { nivel: 'capture', permisos: { conciliacion_cierra_subsecretaria: true } }).cierra).toBe(true);
  });

  test('editor con Conciliación sólo en captura no cierra', () => {
    expect(privilegios('editor', { nivel: 'capture' })).toMatchObject({ cierra: false, autoriza: false });
  });
});
