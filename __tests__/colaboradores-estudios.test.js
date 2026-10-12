/**
 * @jest-environment jsdom
 *
 * Catálogo de estudios del área de personal: el nivel va en Grado académico y
 * la especialidad en Profesión (js/colaboradores-catalogos.js). Lo que puede
 * romperse en silencio es que el combo pise lo ya capturado, o que nivel y
 * profesión queden de niveles distintos.
 */

const cat = require('../js/colaboradores-catalogos');

describe('el catálogo', () => {
  test('trae los seis niveles de la tabla, en orden', () => {
    expect(cat.NIVELES_ESTUDIO).toEqual([
      'Secundaria', 'Preparatoria/Bachillerato', 'Curso de Formación de Oficiales', 'TSU', 'Superior', 'Posgrado',
    ]);
  });

  test('con las especialidades de cada nivel, sin repetidas', () => {
    const cuenta = Object.fromEntries(cat.ESTUDIOS.map(g => [g.nivel, g.especialidades.length]));
    expect(cuenta).toEqual({
      'Secundaria': 1, 'Preparatoria/Bachillerato': 2, 'Curso de Formación de Oficiales': 15,
      'TSU': 8, 'Superior': 104, 'Posgrado': 14,
    });
    for (const g of cat.ESTUDIOS) expect(new Set(g.especialidades).size).toBe(g.especialidades.length);
  });

  test('reconoce el grado capturado a mano', () => {
    expect(cat.nivelDeEstudios('Licenciatura')).toBe('Superior');
    expect(cat.nivelDeEstudios('Ingeniería')).toBe('Superior');
    expect(cat.nivelDeEstudios('MAESTRÍA')).toBe('Posgrado');
    expect(cat.nivelDeEstudios('Bachillerato')).toBe('Preparatoria/Bachillerato');
    expect(cat.nivelDeEstudios('T.S.U.')).toBe('TSU');
    expect(cat.nivelDeEstudios('Kinder')).toBe('');
  });

  test('"Ingeniería en X" es la misma profesión que "Ing. en X"', () => {
    expect(cat.buscarEspecialidad('Ingeniería en Sistemas Computacionales'))
      .toEqual([{ nivel: 'Superior', especialidad: 'Ing. en Sistemas Computacionales' }]);
    expect(cat.buscarEspecialidad('licenciatura en derecho')[0].especialidad).toBe('Lic. en Derecho');
    expect(cat.buscarEspecialidad('Maestría en Ingeniería')[0].especialidad).toBe('Mtría. en Ingeniería');
  });
});

describe('Grado académico → Profesión en cascada', () => {
  function montar(grado, profesion) {
    document.body.innerHTML = '<div><label for="g">Grado</label><input id="g" class="form-control form-control-sm"></div>'
      + '<div><label for="p">Profesión</label><input id="p" class="form-control form-control-sm"></div>';
    document.getElementById('g').value = grado;
    document.getElementById('p').value = profesion;
    return cat.conectarEstudios({ gradoId: 'g', profesionId: 'p' });
  }
  const g = () => document.getElementById('g');
  const p = () => document.getElementById('p');
  const elegir = (sel, valor) => { sel.value = valor; sel.dispatchEvent(new Event('change')); };
  const textos = sel => Array.from(sel.options).map(o => o.textContent);

  test('con nivel elegido sólo ofrece sus profesiones', () => {
    const { gSel, pSel } = montar('', '');
    elegir(gSel, 'Posgrado');
    expect(g().value).toBe('Posgrado');
    expect(textos(pSel)).toContain('Doc. en Ciencias de la Ingeniería');
    expect(textos(pSel)).not.toContain('Ing. Civil');
  });

  test('elegir la profesión sin nivel llena el nivel', () => {
    const { pSel } = montar('', '');
    elegir(pSel, 'Superior|Ing. Civil');
    expect(p().value).toBe('Ing. Civil');
    expect(g().value).toBe('Superior');
  });

  test('cambiar a un nivel donde la profesión no existe la limpia', () => {
    const { gSel } = montar('Superior', 'Ing. Civil');
    elegir(gSel, 'Posgrado');
    expect(p().value).toBe('');
  });

  test('Secundaria no tiene especialidad', () => {
    const { gSel, pSel } = montar('', '');
    elegir(gSel, 'Secundaria');
    expect(p().value).toBe('-');
    expect(pSel.options[pSel.selectedIndex].textContent).toBe('Sin especialidad');
  });

  test('lo capturado antes se muestra en el catálogo sin reescribirse', () => {
    const { gSel, pSel } = montar('Licenciatura', 'Ingeniería Civil');
    expect(gSel.value).toBe('Superior');
    expect(pSel.value).toBe('Superior|Ing. Civil');
    expect(g().value).toBe('Licenciatura');
    expect(p().value).toBe('Ingeniería Civil');
  });

  test('una profesión fuera del catálogo se conserva', () => {
    const { pSel } = montar('Superior', 'Lic. en Psicología');
    expect(pSel.options[pSel.selectedIndex].textContent).toBe('Lic. en Psicología (fuera de catálogo)');
    expect(p().value).toBe('Lic. en Psicología');
  });

  test('"Otra profesión" deja escribirla', () => {
    const { pSel } = montar('Superior', '');
    elegir(pSel, '__otra__');
    expect(p().classList.contains('d-none')).toBe(false);
    p().value = 'Lic. en Psicología';
    cat.sincronizar();
    expect(pSel.value).toBe('__otra__');
    expect(p().value).toBe('Lic. en Psicología');
  });
});

describe('al elegir el grado se abre la profesión', () => {
  test('con la lista bonita, ya filtrada por ese nivel', async () => {
    require('../js/combo-bonito.js');
    document.body.innerHTML = '<div><input id="g2" class="form-control"></div><div><input id="p2" class="form-control"></div>';
    window.ComboBonito.mejorarEn(document.body);
    cat.conectarEstudios({ gradoId: 'g2', profesionId: 'p2' });
    await Promise.resolve();

    const botonDe = id => document.getElementById(id + '-sel').parentNode.querySelector('.cb-btn');
    botonDe('g2').click();
    const opcion = [...document.querySelectorAll('.cb-pop .cb-op')].find(o => o.textContent.trim() === 'Preparatoria/Bachillerato');
    opcion.click();
    await new Promise(r => setTimeout(r, 5));

    expect(document.getElementById('g2').value).toBe('Preparatoria/Bachillerato');
    const abiertas = document.querySelectorAll('.cb-pop');
    expect(abiertas).toHaveLength(1);
    expect([...abiertas[0].querySelectorAll('.cb-op')].map(o => o.textContent.trim()))
      .toEqual(expect.arrayContaining(['General', 'Tecnológico']));
    expect(botonDe('p2').getAttribute('aria-expanded')).toBe('true');
  });
});
