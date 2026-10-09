/**
 * @jest-environment jsdom
 *
 * Expediente laboral de la ficha (js/colab-expediente.js): incapacidades,
 * reconocimientos, retardos, designaciones y oficios de comisión.
 */

const fs = require('fs');
const path = require('path');
const cx = require('../js/colab-expediente');

describe('cálculos', () => {
  test('los días de incapacidad cuentan el primero y el último', () => {
    expect(cx.diasEntre('2026-03-01', '2026-03-03')).toBe(3);
    expect(cx.diasEntre('2026-03-01', '2026-03-01')).toBe(1);
    expect(cx.diasEntre('2026-03-05', '2026-03-01')).toBe(0);
  });

  test('una designación sin fecha final sigue vigente', () => {
    expect(cx.vigente({ fecha_inicio: '2026-01-10', fecha_fin: null }, '2026-10-03')).toBe(true);
    expect(cx.vigente({ fecha_inicio: '2026-01-10', fecha_fin: '2026-06-30' }, '2026-10-03')).toBe(false);
    expect(cx.vigente({ fecha_inicio: '2026-11-01', fecha_fin: null }, '2026-10-03')).toBe(false);
  });

  test('el resumen es del año en curso', () => {
    const hoy = '2026-10-03';
    expect(cx.resumen('incapacidad', [
      { fecha_inicio: '2026-02-01', fecha_fin: '2026-02-03' },
      { fecha_inicio: '2026-05-10', fecha_fin: '2026-05-10' },
      { fecha_inicio: '2025-12-30', fecha_fin: '2026-01-02' },
    ], hoy)).toBe('2 en 2026 · 4 días');
    expect(cx.resumen('retardo', [
      { fecha_inicio: '2026-09-01', justificado: true },
      { fecha_inicio: '2026-09-02', justificado: false },
      { fecha_inicio: '2026-09-03', justificado: null },
    ], hoy)).toBe('3 en 2026 · 2 sin justificar');
    expect(cx.resumen('designacion', [{ fecha_inicio: '2026-01-01', fecha_fin: null }], hoy)).toBe('1 vigente');
  });
});

describe('documentos', () => {
  test('la ruta cumple el formato que exige el almacenamiento', () => {
    const ruta = cx.rutaDocumento('1551-2', 'incapacidad', 'a1b2-c3', 'pdf', 'x9');
    expect(ruta).toBe('1551-2/incapacidad/a1b2-c3-x9.pdf');
    expect(ruta).toMatch(/^[A-Za-z0-9_-]{1,64}\/(incapacidad|reconocimiento|retardo|designacion|comision)\/[A-Za-z0-9_-]+\.(pdf|jpg|png)$/);
    expect(cx.rutaDocumento('12/3 A', 'retardo', 'id', 'jpg', 'm')).toBe('12_3_A/retardo/id-m.jpg');
    expect(() => cx.rutaDocumento('1', 'otro', 'id', 'pdf')).toThrow();
  });

  test('acepta PDF, JPG y PNG por su contenido, no por el nombre', async () => {
    expect((await cx.validarArchivo(new File(['%PDF-1.4'], 'a.pdf'))).ext).toBe('pdf');
    expect((await cx.validarArchivo(new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], 'a.jpg'))).ext).toBe('jpg');
    expect((await cx.validarArchivo(new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], 'a.png'))).ext).toBe('png');
    await expect(cx.validarArchivo(new File(['PK zip'], 'oficio.pdf'))).rejects.toThrow(/PDF, JPG o PNG/);
    await expect(cx.validarArchivo(new File([new Uint8Array(cx.DOC_MAX + 1)], 'a.pdf'))).rejects.toThrow(/10 MB/);
  });
});

/** Supabase simulado: una tabla en memoria y un almacenamiento que registra lo que pasa. */
function supabaseFalso(filas) {
  const tabla = filas.slice();
  const storage = { subidos: [], borrados: [] };
  let siguiente = 1;
  const consulta = () => {
    const q = { _filtros: [], _op: 'select', _datos: null };
    const resolver = () => {
      let rs = tabla.filter(r => q._filtros.every(([k, v]) => r[k] === v));
      if (q._op === 'insert') {
        const nueva = Object.assign({ id: 'n' + (siguiente++), documento_path: null }, q._datos);
        tabla.push(nueva); rs = [nueva];
      } else if (q._op === 'update') {
        rs.forEach(r => Object.assign(r, q._datos));
      } else if (q._op === 'delete') {
        rs.forEach(r => tabla.splice(tabla.indexOf(r), 1));
      }
      return { data: q._single ? rs[0] : rs, error: null };
    };
    Object.assign(q, {
      select() { return q; }, order() { return q; },
      eq(k, v) { q._filtros.push([k, v]); return q; },
      insert(d) { q._op = 'insert'; q._datos = d; return q; },
      update(d) { q._op = 'update'; q._datos = d; return q; },
      delete() { q._op = 'delete'; return q; },
      single() { q._single = true; return q; },
      then(ok, ko) { return Promise.resolve(resolver()).then(ok, ko); },
    });
    return q;
  };
  return {
    tabla, storage,
    from: () => consulta(),
    storage: {
      from: () => ({
        upload: async (ruta) => { storage.subidos.push(ruta); return { error: null }; },
        remove: async (rutas) => { storage.borrados.push(...rutas); return { error: null }; },
        createSignedUrl: async () => ({ data: { signedUrl: 'https://firmado' }, error: null }),
      }),
    },
    _storage: storage,
  };
}

const esperar = () => new Promise(r => setTimeout(r, 0));

describe('en la ficha', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="colaboradores-section"><div id="cf-expediente"></div><div id="cf-comision-docs"></div></div>';
    window.bootstrap = { Modal: { getOrCreateInstance: () => ({ show() {} }), getInstance: () => ({ hide() {} }) } };
  });

  const REGS = [
    { id: 'a', num_empleado: '320', tipo: 'incapacidad', titulo: 'Enfermedad general', fecha_inicio: '2026-02-01', fecha_fin: '2026-02-03' },
    { id: 'b', num_empleado: '320', tipo: 'designacion', titulo: 'Encargada de la Coordinación de Auditoría', fecha_inicio: '2026-01-15', fecha_fin: null, documento_path: '320/designacion/b-x.pdf' },
  ];

  test('pinta los cuatro apartados y el de comisión', async () => {
    window.supabaseClient = supabaseFalso(REGS);
    await cx.render({ num: '320', canEdit: true });
    const titulos = [...document.querySelectorAll('#cf-expediente .cx-tit')].map(e => e.textContent);
    expect(titulos).toEqual(['Incapacidades', 'Reconocimientos', 'Retardos', 'Designaciones']);
    expect(document.querySelector('#cf-comision-docs .cx-tit').textContent).toBe('Oficios de comisión');
    expect(document.querySelector('[data-cx-panel="designacion"]').textContent).toContain('Encargada de la Coordinación de Auditoría');
    expect(document.querySelector('[data-cx-panel="designacion"]').textContent).toContain('Vigente');
    expect(document.querySelector('[data-cx-panel="designacion"] [data-cx-doc]')).not.toBeNull();
  });

  test('quien no es editor no ve incapacidades ni botones para cambiar', async () => {
    window.supabaseClient = supabaseFalso(REGS);
    await cx.render({ num: '320', canEdit: false });
    expect(document.querySelector('[data-cx-panel="incapacidad"]').textContent).toContain('Sólo lo ve el área de personal');
    expect(document.querySelector('[data-cx-nuevo]')).toBeNull();
    expect(document.querySelector('[data-cx-editar]')).toBeNull();
  });

  test('agrega un retardo con su justificante', async () => {
    const sb = supabaseFalso([]);
    window.supabaseClient = sb;
    await cx.render({ num: '320', canEdit: true });
    document.querySelector('[data-cx-nuevo="retardo"]').click();
    document.getElementById('cx-f-fecha_inicio').value = '2026-09-02';
    document.getElementById('cx-f-minutos').value = '15';
    document.getElementById('cx-f-justificado').value = 'Sí';
    const archivo = new File(['%PDF-1.4 justificante'], 'justificante.pdf', { type: 'application/pdf' });
    Object.defineProperty(document.getElementById('cx-f-doc'), 'files', { value: [archivo] });

    document.getElementById('cx-guardar').click();
    for (let i = 0; i < 10; i++) await esperar();

    expect(sb.tabla).toHaveLength(1);
    expect(sb.tabla[0]).toEqual(expect.objectContaining({
      num_empleado: '320', tipo: 'retardo', fecha_inicio: '2026-09-02', minutos: 15, justificado: true,
      documento_nombre: 'justificante.pdf',
    }));
    expect(sb._storage.subidos[0]).toMatch(/^320\/retardo\/n1-[a-z0-9]+\.pdf$/);
    expect(document.querySelector('[data-cx-panel="retardo"]').textContent).toContain('15 min');
  });

  test('no deja guardar si falta lo obligatorio o las fechas van al revés', async () => {
    window.supabaseClient = supabaseFalso([]);
    await cx.render({ num: '320', canEdit: true });
    cx.abrirFormulario('incapacidad', null);
    document.getElementById('cx-f-titulo').value = 'Enfermedad general';
    document.getElementById('cx-f-fecha_inicio').value = '2026-03-10';
    document.getElementById('cx-f-fecha_fin').value = '2026-03-01';
    expect(cx.leerFormulario('incapacidad', document).error).toMatch(/antes de la inicial/);
    document.getElementById('cx-f-titulo').value = '';
    expect(cx.leerFormulario('incapacidad', document).error).toMatch(/Falta: Tipo/);
  });

  test('la comisión arranca con el área a la que está comisionado', async () => {
    window.supabaseClient = supabaseFalso([]);
    await cx.render({ num: '320', canEdit: true, comisionDestino: 'Gerencia de Aviación General' });
    document.querySelector('[data-cx-nuevo="comision"]').click();
    expect(document.getElementById('cx-f-titulo').value).toBe('Gerencia de Aviación General');
  });

  test('sin la tabla en la base, dice qué script falta', async () => {
    window.supabaseClient = {
      from: () => { const q = { select: () => q, eq: () => q, order: () => q, then: (ok) => Promise.resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.colab_expediente'" } }).then(ok) }; return q; },
    };
    await cx.render({ num: '320', canEdit: true });
    expect(document.getElementById('cf-expediente').textContent).toContain('db/create_colab_expediente.sql');
  });
});

describe('el SQL', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'create_colab_expediente.sql'), 'utf8');

  test('las incapacidades sólo las leen los editores, en la tabla y en los documentos', () => {
    expect(sql).toMatch(/FOR SELECT TO authenticated\s+USING \(tipo <> 'incapacidad' OR public\.is_colab_editor\(\)\)/);
    expect(sql).toMatch(/name !~ '\/incapacidad\/' OR public\.is_colab_editor\(\)/);
  });

  test('el bucket es privado y sólo acepta PDF, JPG y PNG', () => {
    expect(sql).toMatch(/'colab-expediente-docs',\s*'colab-expediente-docs',\s*false/);
    expect(sql).toContain("ARRAY['application/pdf', 'image/jpeg', 'image/png']");
  });

  test('los tipos de la tabla son los mismos que maneja la interfaz', () => {
    const chk = sql.match(/CHECK \(tipo IN \(([^)]*)\)\)/)[1];
    const tipos = [...chk.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
    expect(tipos).toEqual(Object.keys(cx.TIPOS).sort());
  });
});
