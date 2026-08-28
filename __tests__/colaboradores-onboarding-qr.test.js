/**
 * @jest-environment jsdom
 *
 * El portal de onboarding por QR (colaborador-registro.html + las funciones de
 * db/create_colab_onboarding_portal.sql) nunca llegó a funcionar por dos
 * errores que no se ven leyendo el archivo por encima.
 *
 * 1) get_colab_onboarding usaba col_domicilio y col_rfc sin declararlas. plpgsql
 *    valida el cuerpo al crear la función, así que ese CREATE reventaba y el
 *    script se abortaba ahí: save_colab_onboarding, que va después, nunca
 *    llegaba a existir en la base. El portal respondía "function does not
 *    exist" y parecía que el módulo estaba a medio escribir.
 *
 * 2) Los patrones para detectar las columnas reales de agenda_2026 se copiaron
 *    del JS de index.html sin traducir el escapado. En JavaScript la secuencia
 *    de dos barras dentro de comillas es una sola barra, pero en SQL —con
 *    standard_conforming_strings en on, que es el default— las dos se quedan
 *    tal cual y el regex pasa a exigir un backslash literal. El patrón del
 *    número de empleado no casaba con la columna "No. Empleado", col_num
 *    quedaba en NULL y las dos funciones salían con "No se detecto columna de
 *    numero de empleado en agenda_2026".
 *
 * Encima, hay datos que no se editan desde el QR porque los asigna el área de
 * personal: el número de empleado, el nombre, el puesto y toda la adscripción.
 * No basta con poner readonly en el input, porque cualquiera edita el DOM o llama
 * al RPC a mano; el backend tiene que ignorar lo que venga en el payload.
 *
 * Esa lista vive en tres sitios que se tienen que mover juntos —locked_keys en el
 * SQL, LOCKED_SPECS en el portal y COLAB_ONBOARDING_FIJOS en el alta de index.html—
 * así que aquí se comparan entre sí. Si alguien agrega un campo bloqueado en uno
 * solo, el colaborador acabaría viendo un campo vacío que nadie puede llenar.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(raiz, 'db/create_colab_onboarding_portal.sql'), 'utf8');
const portal = fs.readFileSync(path.join(raiz, 'colaborador-registro.html'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

// El numero de empleado va aparte: sale del token, no de un campo del alta.
const CAMPOS_FIJOS = [
  'nombre', 'puesto', 'nivel', 'plaza', 'direccion', 'subdireccion', 'gerencia', 'coordinacion',
];

/** Cuerpo de una función plpgsql del script, partido en DECLARE y BEGIN. */
function funcion(nombre) {
  const desde = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + nombre);
  if (desde < 0) throw new Error('No existe la función ' + nombre);
  const trozo = sql.slice(desde);
  const cuerpo = trozo.slice(0, trozo.indexOf('\n$$;'));
  return {
    declare: cuerpo.slice(cuerpo.indexOf('DECLARE'), cuerpo.indexOf('\nBEGIN')),
    begin: cuerpo.slice(cuerpo.indexOf('\nBEGIN')),
  };
}

/** Patrones que la función le pasa a _agenda_col_by_patterns, por variable. */
function patronesDe(nombreFuncion) {
  const { begin } = funcion(nombreFuncion);
  const salida = new Map();
  const llamadas = begin.matchAll(/(col_\w+)\s*:=\s*public\._agenda_col_by_patterns\(ARRAY\[(.*?)\]\);/g);
  for (const m of llamadas) {
    const pats = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map(p => p[1].replace(/''/g, "'"));
    salida.set(m[1], pats);
  }
  return salida;
}

// Columnas reales de agenda_2026. Van las que hicieron caer los patrones:
// nombres de Excel con puntos, espacios y acentos, más las que agrega esta
// migración.
const COLUMNAS_REALES = [
  'No. Empleado', 'Nombre', 'Fecha de alta', 'Plaza', 'Nivel', 'Puesto',
  'Dir. Orgánica', 'Subdir. Orgánica', 'Gerencia Orgánica', 'Coordinación Orgánica',
  'Personal Comisionado', 'Dirección Comisionado', 'Rúbrica', 'Fecha de nacimiento',
  'CURP', 'RFC', 'NSS', 'Vigencia de INE', 'Fotografia de INE', 'No. telefónico',
  'Domicilio (calle, colonia, municipio, estado y código postal)',
  'Persona Civil o Militar', 'Matrícula Militar', 'Estado civil', 'Dependientes (hijos)',
  'Tipo de sangre', 'Alérgico a algún medicamento Si ó No (Especificar)',
  'Alérgico a algún alimento. Si ó No (Especificar)',
  'Contacto de emergencia 1 Nombre completo', 'Parentesco 1', 'Teléfono de emergencia 1',
  'Contacto de emergencia 2 Nombre completo', 'Parentesco 2', 'Teléfono de emergencia 2',
  'Nombre de la Licenciatura y/o Maestria', 'No. Cédula Profesional',
  'Correo Personal', 'Correo Institucional', 'Extensión',
  'Vigencia de la TIA', 'Fotografía de la TIA',
  'Licencia de Manejo', 'Tipo de licencia', 'Licencia Vigencia',
  'Cumpleaños', 'Doc. Para ingreso',
  // las que crea db/create_colab_onboarding_portal.sql
  'foto_ine', 'foto_ine_rev', 'foto_cred', 'cv_url', 'grado_academico', 'sangre',
  'onboarding_actualizado_en', 'onboarding_estado',
];

/** Réplica de _agenda_col_by_patterns: primer patrón que case, primera columna en orden. */
function resolver(patrones) {
  for (const p of patrones) {
    const rx = new RegExp(p, 'i');
    const hit = COLUMNAS_REALES.find(c => rx.test(c));
    if (hit) return hit;
  }
  return null;
}

const FUNCIONES_DEL_PORTAL = ['get_colab_onboarding', 'save_colab_onboarding'];

describe('el script SQL se puede instalar', () => {
  for (const nombre of FUNCIONES_DEL_PORTAL) {
    test(nombre + ' no usa variables sin declarar', () => {
      const { declare, begin } = funcion(nombre);
      const declaradas = new Set(
        declare
          .split('\n')
          .map(l => (l.trim().match(/^(col_\w+|v_\w+|row_json)\s/) || [])[1])
          .filter(Boolean)
      );
      const usadas = new Set(begin.match(/\b(?:col_|v_|row_json)\w*/g) || []);
      expect([...usadas].filter(u => !declaradas.has(u))).toEqual([]);
    });
  }
});

describe('los patrones de columna casan con agenda_2026', () => {
  const DOS_BARRAS = '\\' + '\\';

  for (const nombre of FUNCIONES_DEL_PORTAL) {
    test(nombre + ' no arrastra el escapado de JavaScript', () => {
      const conDoble = [...patronesDe(nombre)]
        .filter(([, pats]) => pats.some(p => p.includes(DOS_BARRAS)))
        .map(([col]) => col);
      expect(conDoble).toEqual([]);
    });

    test(nombre + ' encuentra el número de empleado y el nombre', () => {
      // Sin col_num las dos funciones abortan antes de tocar nada.
      const pats = patronesDe(nombre);
      expect(resolver(pats.get('col_num'))).toBe('No. Empleado');
      expect(resolver(pats.get('col_nombre'))).toBe('Nombre');
    });

    test(nombre + ' no confunde la foto de la TIA con su vigencia', () => {
      const pats = patronesDe(nombre);
      expect(resolver(pats.get('col_f_tia'))).not.toBe('Vigencia de la TIA');
      expect(resolver(pats.get('col_vig_credencial'))).toBe('Vigencia de la TIA');
    });

    test(nombre + ' manda cada campo fijo a una columna distinta', () => {
      // Si dos patrones cayeran en la misma columna, el ultimo del bucle pisaria
      // al anterior y la adscripcion quedaria mal escrita sin que nadie se entere.
      const pats = patronesDe(nombre);
      const columnas = CAMPOS_FIJOS.map(c => resolver(pats.get('col_' + c)));
      expect(columnas).not.toContain(null);
      expect(new Set(columnas).size).toBe(CAMPOS_FIJOS.length);
    });
  }
});

describe('los campos fijos son los mismos en los tres lados', () => {
  test('el SQL bloquea exactamente esa lista', () => {
    const { declare } = funcion('save_colab_onboarding');
    const arr = declare.match(/locked_keys text\[\] := ARRAY\[(.*?)\];/);
    expect(arr).not.toBeNull();
    const claves = [...arr[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(claves.sort()).toEqual([...CAMPOS_FIJOS].sort());
  });

  test('el portal los pinta como fijos', () => {
    const arr = portal.match(/const LOCKED_SPECS = \[([\s\S]*?)\n {6}\];/);
    expect(arr).not.toBeNull();
    const claves = [...arr[1].matchAll(/\['[^']+', '([^']+)'/g)].map(m => m[1]);
    expect(claves.sort()).toEqual(['num_empleado', ...CAMPOS_FIJOS].sort());
  });

  test('el alta los exige para poder generar el QR', () => {
    const arr = app.match(/const COLAB_ONBOARDING_FIJOS = \[([\s\S]*?)\n {24}\];/);
    expect(arr).not.toBeNull();
    const campos = [...arr[1].matchAll(/clave: '([^']+)',\s*input: '([^']+)'/g)];
    expect(campos.map(m => m[1]).sort()).toEqual([...CAMPOS_FIJOS].sort());

    // Un id mal escrito dejaria el campo siempre vacio y el QR nunca se generaria.
    for (const [, clave, input] of campos) {
      expect(app.includes('id="' + input + '"')).toBe(true);
    }
  });
});

describe('el backend no acepta los campos fijos del portal', () => {
  const { begin } = funcion('save_colab_onboarding');

  test.each(CAMPOS_FIJOS)('ignora el %s que mande el payload', (clave) => {
    expect(begin).not.toMatch(new RegExp("p_payload->>'" + clave + "'"));
  });

  test('los resuelve del expediente o de la metadata del link', () => {
    expect(begin).toMatch(/lnk\.metadata ->> locked_key/);
    expect(begin).toMatch(/FROM public\.agenda_2026 WHERE %I = \$1 LIMIT 1', locked_col, col_num/);
  });

  test('el número de empleado sale del token, no del payload', () => {
    expect(begin).toMatch(/jsonb_build_object\(col_num, lnk\.num_empleado\)/);
    expect(begin).not.toMatch(/p_payload->>'num_empleado'/);
  });
});

describe('el formulario del portal no deja tocarlos', () => {
  test.each(['f-num', 'f-nombre', 'f-puesto', 'f-nivel', 'f-plaza',
             'f-direccion', 'f-subdireccion', 'f-gerencia', 'f-coordinacion'])(
    '%s es de solo lectura', (id) => {
      const input = portal.match(new RegExp('<input id="' + id + '"[^>]*>'));
      expect(input).not.toBeNull();
      expect(input[0]).toMatch(/\breadonly\b/);
    });

  test('ninguno viaja entre los campos capturables', () => {
    const specs = portal.match(/const FIELD_SPECS = \[([\s\S]*?)\n {6}\];/);
    expect(specs).not.toBeNull();
    for (const clave of CAMPOS_FIJOS) {
      expect(specs[1]).not.toMatch(new RegExp("'" + clave + "'"));
    }
  });
});

describe('el payload que sale del portal', () => {
  const vm = require('vm');

  /** Recorta un bloque del script del portal desde su declaracion hasta el cierre. */
  function bloque(inicio, cierre) {
    const desde = portal.indexOf(inicio);
    if (desde < 0) throw new Error('No se encontro: ' + inicio);
    const hasta = portal.indexOf(cierre, desde);
    if (hasta < 0) throw new Error('Bloque sin cerrar: ' + inicio);
    return portal.slice(desde, hasta + cierre.length);
  }

  /** El portal real, con su formulario y sus funciones, corriendo en jsdom. */
  function montarPortal() {
    document.body.innerHTML = bloque('<form id="onboarding-form"', '</form>');
    const contexto = { document };
    vm.createContext(contexto);
    vm.runInContext(
      [
        bloque('const FIELD_SPECS = [', '\n      ];'),
        bloque('let currentData = {', '\n      };'),
        bloque('function $(id)', '}'),
        bloque('function collectPayload()', '\n      }'),
      ].join('\n'),
      contexto
    );
    return contexto;
  }

  test('lleva los datos que sí captura el colaborador', () => {
    const ctx = montarPortal();
    document.getElementById('f-turno').value = 'Matutino';
    document.getElementById('f-curp').value = 'gxpa900101hdfxxx01';

    const payload = ctx.collectPayload();
    expect(payload.turno).toBe('Matutino');
    expect(payload.curp).toBe('GXPA900101HDFXXX01');
  });

  test('no lleva ninguno de los campos fijos', () => {
    const ctx = montarPortal();
    const payload = ctx.collectPayload();

    expect(payload).not.toHaveProperty('num_empleado');
    for (const clave of CAMPOS_FIJOS) {
      expect(payload).not.toHaveProperty(clave);
    }
  });

  test('sigue sin llevarlos aunque le quiten el readonly a los inputs', () => {
    const ctx = montarPortal();
    // Lo que haría cualquiera desde las herramientas del navegador.
    for (const id of ['f-num', 'f-nombre', 'f-puesto', 'f-nivel', 'f-plaza',
                      'f-direccion', 'f-subdireccion', 'f-gerencia', 'f-coordinacion']) {
      const input = document.getElementById(id);
      input.removeAttribute('readonly');
      input.value = 'SUPLANTADO';
    }

    const payload = ctx.collectPayload();
    expect(JSON.stringify(payload)).not.toContain('SUPLANTADO');
  });
});
