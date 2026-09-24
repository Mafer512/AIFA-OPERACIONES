/**
 * Reportes hereda el permiso de Conciliación.
 *
 * La página de Reportes es una .content-section propia (conci-reportes-section)
 * y no un módulo que el administrador asigne. El filtro de permisos oculta toda
 * sección cuya clave no esté en la lista del usuario, así que a capturistas y
 * editores con Conciliación se les ocultaba Reportes, y la salvaguarda los
 * regresaba a su módulo por omisión cada vez que se reaplicaban los permisos.
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

function crear(lista) {
  return new Function(`
    let userSectionWhitelist = ${JSON.stringify(lista)};
    ${linea('const SECCIONES_DE_MODULO')}
    ${extraer('permisoDeSeccion')}
    ${extraer('isSectionAllowed')}
    return { permisoDeSeccion, isSectionAllowed };
  `)();
}

describe('Reportes hereda el permiso de Conciliación', () => {
  test('quien tiene Conciliación puede abrir Reportes', () => {
    expect(crear(['conciliacion', 'demoras']).isSectionAllowed('conci-reportes')).toBe(true);
  });

  test('quien no tiene Conciliación no la ve', () => {
    expect(crear(['demoras']).isSectionAllowed('conci-reportes')).toBe(false);
  });

  test('sin lista de módulos (administradores) se ve todo', () => {
    expect(crear(null).isSectionAllowed('conci-reportes')).toBe(true);
  });

  test('las demás secciones no cambian de clave', () => {
    const { permisoDeSeccion } = crear(null);
    expect(permisoDeSeccion('conci-reportes')).toBe('conciliacion');
    expect(permisoDeSeccion('demoras')).toBe('demoras');
  });

  test('los dos filtros que ocultan secciones usan la clave heredada', () => {
    expect(source).toContain("const key = permisoDeSeccion((sectionEl.id || '').replace(/-section$/, ''));");
    expect(source).toContain("const key = permisoDeSeccion(normalizeSectionKey((sectionEl.id || '').replace(/-section$/, '')));");
  });

  test('la salvaguarda no saca al usuario de Reportes ni reescribe la URL', () => {
    // Estando en Reportes, la sección activa cuenta como Conciliación: no se
    // considera oculta y el hash se queda en #conciliacion.
    expect(source).toContain("? permisoDeSeccion((activeSection.id || '').replace(/-section$/, ''))");
  });
});
