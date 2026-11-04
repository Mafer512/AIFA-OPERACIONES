/**
 * Permisos por módulo del panel "Módulos accesibles".
 *
 *  - Estadísticas de equipaje es una página de BHS: se ve cuando BHS está
 *    marcado y se oculta cuando no (antes se ocultaba siempre con una
 *    selección parcial, porque no está en el catálogo del panel).
 *  - Conciliación ya no es un módulo base: sólo se ve si está marcada.
 *  - Con "Ninguno" (lista ['__none__']) no hay sección por defecto: antes se
 *    devolvía el centinela '__none__' como si fuera una sección navegable.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8').replace(/\r\n/g, '\n');

function extraer(nombre) {
  const inicio = source.indexOf(`function ${nombre}(`);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

function linea(prefijo) {
  const inicio = source.indexOf(prefijo);
  if (inicio === -1) throw new Error(`No se encontró ${prefijo}`);
  return source.slice(inicio, source.indexOf('\n', inicio) + 1);
}

function crear(lista, porDefecto = null) {
  return new Function(`
    let userSectionWhitelist = ${JSON.stringify(lista)};
    let userDefaultSectionKey = ${JSON.stringify(porDefecto)};
    ${linea('const SECCIONES_DE_MODULO')}
    ${linea('const SECCION_SIN_MODULOS')}
    ${extraer('permisoDeSeccion')}
    ${extraer('isSectionAllowed')}
    ${extraer('getDefaultAllowedSection')}
    return { permisoDeSeccion, isSectionAllowed, getDefaultAllowedSection };
  `)();
}

describe('Estadísticas de equipaje hereda el permiso de BHS', () => {
  test('con BHS marcado se puede abrir', () => {
    expect(crear(['bhs', 'demoras']).isSectionAllowed('bhs-estadisticas-equipaje')).toBe(true);
  });

  test('sin BHS no se ve', () => {
    expect(crear(['demoras']).isSectionAllowed('bhs-estadisticas-equipaje')).toBe(false);
  });

  test('con acceso total se ve', () => {
    expect(crear(null).isSectionAllowed('bhs-estadisticas-equipaje')).toBe(true);
  });

  test('los botones del menú usan la misma clave heredada que las secciones', () => {
    expect(source).toContain('const sectionKey = permisoDeSeccion(normalizeSectionKey(item.dataset.section));');
  });
});

describe('Conciliación sólo si está marcada', () => {
  test('con una selección que no la incluye, no se permite', () => {
    expect(crear(['bhs']).isSectionAllowed('conciliacion')).toBe(false);
  });

  test('con una selección que la incluye, se permite', () => {
    expect(crear(['bhs', 'conciliacion']).isSectionAllowed('conciliacion')).toBe(true);
  });
});

describe('"Ninguno" no tiene sección por defecto', () => {
  test('con sólo el centinela no se devuelve "__none__"', () => {
    const api = crear(['__none__'], '__none__');
    expect(api.getDefaultAllowedSection()).toBeNull();
    expect(api.isSectionAllowed('conciliacion')).toBe(false);
    expect(api.isSectionAllowed('operaciones-totales')).toBe(false);
  });

  test('con módulos marcados se usa el primero real', () => {
    expect(crear(['bhs', 'demoras']).getDefaultAllowedSection()).toBe('bhs');
  });

  test('sin lista (acceso total) se sigue usando Inicio', () => {
    expect(crear(null).getDefaultAllowedSection()).toBe('operaciones-totales');
  });
});
