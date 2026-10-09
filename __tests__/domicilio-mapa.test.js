/**
 * @jest-environment jsdom
 *
 * Domicilio desde el mapa (js/domicilio-mapa.js). Sin red: se prueba lo que
 * puede salir mal en silencio, que es cómo se llenan los campos cuando el
 * colaborador marca un punto y luego otro.
 */

window.ColaboradoresCampos = require('../js/colaboradores-campos');
require('../js/domicilio-mapa');

const IDS = { calle: 'c', numero: 'n', colonia: 'col', cp: 'cp', municipio: 'm', estado: 'e' };

function montar() {
  document.body.innerHTML = '<div id="mapa"></div>'
    + Object.values(IDS).map(id => '<input id="' + id + '">').join('');
  let llamadas = 0;
  const ctrl = window.DomicilioMapa.conectar({
    contenedor: document.getElementById('mapa'),
    campos: IDS,
    alLlenar: () => { llamadas++; },
  });
  return { ctrl, llamadas: () => llamadas };
}
const val = id => document.getElementById(id).value;

test('pinta el botón y deja el mapa cerrado hasta que lo abren', () => {
  montar();
  expect(document.querySelector('.dm-abrir').textContent).toContain('Ubicar mi casa en el mapa');
  expect(document.querySelector('.dm-panel').hidden).toBe(true);
  // Leaflet no se descarga hasta abrir el mapa.
  expect(document.querySelector('script[src*="leaflet"]')).toBeNull();
});

test('llena lo que da el mapa y avisa lo que falta', () => {
  const { ctrl, llamadas } = montar();
  ctrl.llenar({ calle: 'Calle Hidalgo', numero: '', colonia: 'Centro', cp: '55740', municipio: 'Tecámac', estado: 'Estado de México' });
  expect(val('c')).toBe('Calle Hidalgo');
  expect(val('cp')).toBe('55740');
  expect(llamadas()).toBe(1);
  expect(document.querySelector('.dm-estado').textContent).toContain('número');
});

test('un segundo punto quita lo que había puesto el primero, pero no lo que tecleó la persona', () => {
  const { ctrl } = montar();
  ctrl.llenar({ calle: 'Calle Hidalgo', numero: '5', colonia: 'Centro', cp: '55740', municipio: 'Tecámac', estado: 'México' });

  // La persona corrige la colonia a mano.
  const col = document.getElementById('col');
  col.value = 'San Francisco';
  col.dispatchEvent(new Event('input'));

  ctrl.llenar({ calle: 'Avenida Juárez', numero: '', colonia: '', cp: '55745', municipio: 'Tecámac', estado: 'México' });
  expect(val('c')).toBe('Avenida Juárez');
  expect(val('n')).toBe('');              // el 5 era del punto anterior
  expect(val('col')).toBe('San Francisco'); // ése lo escribió la persona
  expect(val('cp')).toBe('55745');
});

test('dentro del formulario del registro, Enter en el buscador no lo manda', () => {
  document.body.innerHTML = '<form id="registro"><div id="mapa"></div></form>';
  let enviado = false;
  document.getElementById('registro').addEventListener('submit', e => { enviado = true; e.preventDefault(); });
  window.DomicilioMapa.conectar({ contenedor: document.getElementById('mapa'), campos: {} });

  const buscador = document.querySelector('.dm-buscar input');
  expect(buscador).not.toBeNull();   // un <form> anidado se habría descartado
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  buscador.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(enviado).toBe(false);
});
