/**
 * Por qué tardaba en verse lo que hacía un compañero.
 *
 * No era el pintado: era congestión del canal. Se sumaban tres cosas.
 *
 * 1. El cliente de Supabase se creaba sin opciones, y supabase-js aplica un
 *    techo de 10 mensajes por segundo cuando no se le dice otra cosa.
 *
 * 2. Cada movimiento de celda llamaba a channel.track(). Eso no es un mensaje
 *    más: el servidor recalcula el estado de presencia y lo difunde a TODOS los
 *    conectados. Era la operación más cara del canal, repetida por cada
 *    movimiento de cursor, y consumía la mitad del presupuesto.
 *
 * 3. El anuncio de cursor no se agrupaba: navegando con las flechas salía un
 *    mensaje por celda.
 *
 * Con el presupuesto agotado los mensajes se encolan, y eso se ve como "el
 * recuadro tarda" o "tardé en ver lo que capturó".
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
const cliente = fs.readFileSync(path.join(raiz, 'js', 'supabase-client.js'), 'utf8');

describe('presupuesto de mensajes en vivo', () => {
  test('el cliente se crea con un techo explícito, no con el de por defecto', () => {
    expect(cliente).toContain('eventsPerSecond');
    const opciones = cliente.match(/eventsPerSecond:\s*(\d+)/);
    expect(opciones).not.toBeNull();
    expect(Number(opciones[1])).toBeGreaterThan(10);
  });

  test('todas las formas de crear el cliente llevan las mismas opciones', () => {
    const creaciones = cliente.match(/createClient\(SUPABASE_URL, SUPABASE_ANON_KEY[^)]*\)/g) || [];
    expect(creaciones.length).toBeGreaterThan(0);
    creaciones.forEach(c => expect(c).toContain('SUPABASE_OPTIONS'));
  });
});

describe('la presencia deja de moverse en cada celda', () => {
  test('abrir una celda ya no llama a presence.track', () => {
    const fn = script.slice(
      script.indexOf('function _conciBeginCellPresence'),
      script.indexOf('\n}\n', script.indexOf('function _conciBeginCellPresence'))
    );
    expect(fn).not.toContain('_conciSetPresenceCell(');
    expect(fn).toContain('_conciBroadcastFoco(');
  });

  test('presence.track queda para entrar y salir, no para el cursor', () => {
    // Solo debe quedar la llamada que libera la celda al cerrar el editor.
    const llamadas = (script.match(/_conciSetPresenceCell\(/g) || []).length;
    expect(llamadas).toBeLessThanOrEqual(2); // la definición y el reset final
  });
});

describe('el anuncio de cursor se agrupa', () => {
  test('existe un temporizador que junta los movimientos rápidos', () => {
    expect(script).toContain('_conciFocoThrottleTimer');
  });

  test('el envío real está separado del anuncio', () => {
    // _conciBroadcastFoco agrupa; _conciEnviarFoco es quien manda de verdad.
    expect(script).toContain('function _conciEnviarFoco(');
    const agrupa = script.slice(
      script.indexOf('function _conciBroadcastFoco'),
      script.indexOf('function _conciEnviarFoco')
    );
    expect(agrupa).toContain('clearTimeout(_conciFocoThrottleTimer)');
  });

  test('el latido manda directo, sin esperar al agrupamiento', () => {
    const latido = script.slice(script.indexOf('function _conciIniciarLatidoFoco'));
    expect(latido.slice(0, 800)).toContain('_conciEnviarFoco(');
  });
});

describe('lo que se sigue mandando por celda', () => {
  test('el cursor: un solo mensaje, agrupado', () => {
    const fn = script.slice(
      script.indexOf('function _conciBeginCellPresence'),
      script.indexOf('\n}\n', script.indexOf('function _conciBeginCellPresence'))
    );
    const envios = (fn.match(/_conciBroadcastFoco\(|_conciSetPresenceCell\(/g) || []).length;
    expect(envios).toBe(1);
  });

  test('lo que se teclea sigue con su propio agrupamiento', () => {
    const fn = script.slice(script.indexOf('function _conciBroadcastCellInput'));
    expect(fn.slice(0, 900)).toContain('_conciLastBroadcast');
  });
});
