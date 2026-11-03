/**
 * @jest-environment jsdom
 *
 * Reinicializar gráficas (botón o Ctrl+Shift+R) destruye solo las gráficas que
 * después vuelve a crear. Antes destruía todas las de la página y la
 * Comparativa de Operaciones Totales —también en el Inicio de Dirección
 * General— se quedaba en blanco.
 */

const fs = require('fs');
const path = require('path');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8').replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = fuente.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre}`);
  return fuente.slice(inicio, fuente.indexOf('\n}\n', inicio) + 2);
}

const grafica = (id) => ({ canvas: { id }, destroy: jest.fn() });

test('solo destruye las gráficas que sabe volver a crear', () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  const operaciones = grafica('commercial-ops-chart');
  const demoras = grafica('delaysPieChart');
  const comparativa = grafica('yoyCompChart');
  const general = grafica('gen-yoy-chart');
  const carga = grafica('cargo-yoy-chart');
  window.Chart = { instances: { 0: operaciones, 1: demoras, 2: comparativa, 3: general, 4: carga } };

  const resetAllCharts = new Function(
    'destroyOpsCharts', 'stopOpsAnim', 'showNotification', 'getActiveSectionKey', 'verifyChartsCreated', 'detectChartErrors',
    `${extraer('resetAllCharts')}\nreturn resetAllCharts;`
  )(() => {}, () => {}, () => {}, () => '', () => true, () => {});

  resetAllCharts();
  jest.runAllTimers();

  expect(operaciones.destroy).toHaveBeenCalledTimes(1);
  expect(demoras.destroy).toHaveBeenCalledTimes(1);
  [comparativa, general, carga].forEach((g) => expect(g.destroy).not.toHaveBeenCalled());

  jest.useRealTimers();
  jest.restoreAllMocks();
  delete window.Chart;
});
