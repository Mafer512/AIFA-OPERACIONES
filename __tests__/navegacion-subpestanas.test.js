/**
 * @jest-environment jsdom
 *
 * Al entrar a un módulo debe abrirse el que se pidió.
 *
 * Síntoma reportado: entrar a "Resumen General" mostraba "Comparativa
 * Histórica". Las dos entradas del menú viven en la misma sección
 * (operaciones-totales) y se distinguen por su data-sub-tab, pero el código
 * intentaba PRIMERO restaurar la última pestaña usada y solo hacía caso al
 * menú si esa restauración fallaba. Como venías de Comparativa Histórica, esa
 * ganaba siempre.
 *
 * La pestaña recordada sirve para volver donde estabas al RECARGAR, no para
 * pisar un clic deliberado.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

// DOMParser en vez de require('jsdom'): dentro del entorno de pruebas jsdom,
// cargar el paquete otra vez falla por TextEncoder.
const doc = new DOMParser().parseFromString(html, 'text/html');

/** Entradas del menú agrupadas por la sección a la que llevan. */
function entradasPorSeccion() {
  const mapa = new Map();
  doc.querySelectorAll('.menu-item[data-section]').forEach(a => {
    const seccion = a.dataset.section;
    if (!mapa.has(seccion)) mapa.set(seccion, []);
    mapa.get(seccion).push({
      texto: (a.querySelector('.si-txt') || a).textContent.trim(),
      subTab: a.dataset.subTab || '',
    });
  });
  return mapa;
}

describe('cada entrada de menú dice qué pestaña abre', () => {
  const compartidas = [...entradasPorSeccion().entries()]
    .filter(([, items]) => items.length > 1);

  test('hay secciones a las que llegan varias entradas', () => {
    expect(compartidas.length).toBeGreaterThan(0);
  });

  test.each(compartidas.map(([s]) => s).filter(s => s !== 'conciliacion'))(
    'las entradas de %s declaran su sub-pestaña',
    (seccion) => {
      // Sin declararla, la restauración de la última usada decide por ellas y
      // se abre la pestaña equivocada.
      const items = entradasPorSeccion().get(seccion);
      items.forEach(i => expect(i.subTab).not.toBe(''));
    }
  );

  test('las dos entradas que comparten destino apuntan a pestañas distintas', () => {
    const items = entradasPorSeccion().get('operaciones-totales');
    const subs = items.map(i => i.subTab);
    expect(new Set(subs).size).toBe(subs.length);
    expect(subs).toContain('ops-resumen-tab');
    expect(subs).toContain('comparativa-yoy-tab');
  });

  test('cada sub-pestaña declarada existe de verdad', () => {
    [...entradasPorSeccion().values()].flat()
      .filter(i => i.subTab)
      .forEach(i => {
        const boton = doc.getElementById(i.subTab);
        expect(boton).not.toBeNull();
        expect(boton.getAttribute('data-bs-toggle')).toBe('tab');
      });
  });

  test('la sub-pestaña vive dentro de la sección que declara la entrada', () => {
    entradasPorSeccion().forEach((items, seccion) => {
      items.filter(i => i.subTab).forEach(i => {
        const boton = doc.getElementById(i.subTab);
        const contenedor = boton.closest('.content-section');
        expect(contenedor).not.toBeNull();
        expect(contenedor.id).toContain(seccion.replace(/-section$/, ''));
      });
    });
  });
});

describe('quién gana al abrir una sección', () => {
  const bloque = script.slice(
    script.indexOf('// Sub-pestaña a mostrar dentro de la sección.'),
    script.indexOf('// Hook específico para Historia')
  );

  test('el bloque de decisión existe', () => {
    expect(bloque.length).toBeGreaterThan(100);
  });

  test('lo pedido por el menú se atiende primero', () => {
    const pedida = bloque.indexOf('subTabSolicitada');
    const recordada = bloque.indexOf('restoreActiveTab(');
    expect(pedida).toBeGreaterThan(-1);
    expect(recordada).toBeGreaterThan(-1);
    expect(pedida).toBeLessThan(recordada);
  });

  test('si se atendió lo pedido, ya no se restaura nada más', () => {
    const trozo = bloque.slice(bloque.indexOf('subTabSolicitada'), bloque.indexOf('restoreActiveTab('));
    expect(trozo).toContain('return;');
  });

  test('sin petición explícita se vuelve a la última pestaña usada', () => {
    // Es lo que evita caer siempre en la primera (Itinerario en vez de
    // Manifiestos) al volver a Conciliación.
    expect(bloque).toContain('if (restoreActiveTab(targetKey, target)) return;');
  });

  test('ya no se consulta la recordada antes que el menú', () => {
    expect(bloque).not.toContain('if (!restoreActiveTab(targetKey, target)) {');
  });
});
