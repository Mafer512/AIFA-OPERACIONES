/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const RAIZ = 'c:/Users/misaa/Documents/AIFA-OPERACIONES';

/* Guarda lo que se le manda al modelo, para poder afirmar cómo llegó la
   pregunta (por ejemplo, si se le quitó el nombre "AIFONSO"). */
let ultimoEnvio = null;
function modeloSimulado(respuesta) {
  return {
    from: () => ({}),
    functions: {
      invoke: async (_n, { body }) => {
        ultimoEnvio = body;
        return { data: { choices: [{ message: { role: 'assistant', content: respuesta } }] }, error: null };
      },
    },
  };
}

describe('AIFONSO · interfaz', () => {
  beforeAll(() => {
    window.supabaseClient = modeloSimulado('Listo.');
    // Los tres módulos, en el mismo orden que index.html
    eval(fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa-datos.js'), 'utf8'));
    eval(fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa.js'), 'utf8'));
    eval(fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa-ui.js'), 'utf8'));
    // En pruebas no hay Ollama: se usa el camino de la nube, que sí está
    // simulado. El valor por defecto en producción sigue siendo 'local'.
    window.AsistenteAifa.configurar({ donde: 'nube' });
  });

  test('expone las tres APIs globales', () => {
    expect(window.AsistenteAifaDatos).toBeTruthy();
    expect(window.AsistenteAifa).toBeTruthy();
    expect(typeof window.asistenteAifaAbrir).toBe('function');
  });

  test('inyecta el botón flotante y el panel', () => {
    expect(document.getElementById('aifa-bot-fab')).toBeTruthy();
    expect(document.getElementById('aifa-bot-panel')).toBeTruthy();
  });

  test('el panel abre y cierra', () => {
    const panel = document.getElementById('aifa-bot-panel');
    document.getElementById('aifa-bot-fab').click();
    expect(panel.classList.contains('abierto')).toBe(true);
    panel.querySelector('[data-accion="cerrar"]').click();
    expect(panel.classList.contains('abierto')).toBe(false);
  });

  test('muestra saludo y sugerencias iniciales', () => {
    expect(document.querySelectorAll('.aifa-bot-msg.bot').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.aifa-bot-chip').length).toBe(4);
  });

  test('escapa HTML en las respuestas (no permite inyección)', () => {
    // Se usa un contenedor aparte para no alterar el chat real y que el
    // resto de pruebas no dependa del orden de ejecución.
    const div = document.createElement('div');
    div.className = 'aifa-bot-msg bot';
    const peligroso = '<img src=x onerror="window.__hackeado=1">';
    const esc = peligroso.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    div.innerHTML = esc;
    expect(div.querySelector('img')).toBeNull();
    expect(window.__hackeado).toBeUndefined();
  });

  test('cada herramienta declarada tiene implementación', () => {
    const declaradas = window.AsistenteAifaDatos.esquemas.map(e => e.function.name);
    const implementadas = Object.keys(window.AsistenteAifaDatos._herramientas);
    expect(declaradas.sort()).toEqual(implementadas.sort());
  });

  test('los esquemas cumplen el formato que exige el proveedor', () => {
    window.AsistenteAifaDatos.esquemas.forEach(e => {
      expect(e.type).toBe('function');
      expect(typeof e.function.name).toBe('string');
      expect(e.function.description.length).toBeGreaterThan(20);
      expect(e.function.parameters.type).toBe('object');
    });
  });

  test('se presenta como AIFONSO', () => {
    expect(window.AsistenteAifa.NOMBRE).toBe('AIFONSO');
    expect(document.querySelector('.aifa-bot-head h6').textContent).toContain('AIFONSO');
    expect(document.querySelector('.aifa-bot-msgs').textContent).toContain('AIFONSO');
  });

  test('se identifica como versión de pruebas', () => {
    // Debe notarse en el botón flotante y en el encabezado, no sólo por dentro.
    expect(document.querySelector('#aifa-bot-fab .aifa-bot-etapa')).toBeTruthy();
    expect(document.querySelector('.aifa-bot-head .aifa-bot-etapa').textContent).toBe('BETA');
    expect(document.querySelector('.aifa-bot-msgs').textContent).toMatch(/versión de pruebas/i);
  });

  test('la bienvenida lleva la identidad del aeropuerto', () => {
    const marca = document.querySelector('.aifa-bot-marca');
    expect(marca).toBeTruthy();
    // Logo del aeropuerto
    expect(marca.querySelector('img').getAttribute('src')).toMatch(/images\//);
    // Y la constancia de origen, para que quede claro de dónde salió
    expect(marca.textContent).toMatch(/Creado en el AIFA/i);
    expect(marca.textContent).toMatch(/Aeropuerto Internacional Felipe Ángeles/i);
  });

  test('expone el modo conversación manos libres', () => {
    ['iniciarConversacion', 'terminarConversacion', 'conversacionActiva']
      .forEach(m => expect(typeof window.AsistenteAifa[m]).toBe('function'));
    expect(document.querySelector('.aifa-bot-conv')).toBeTruthy();
    expect(document.querySelector('.aifa-bot-live')).toBeTruthy();
  });
});

describe('AIFONSO · se presenta con cortesía', () => {
  const original = Date.now;
  afterEach(() => { Date.now = original; jest.useRealTimers(); });

  function aLaHora(h) {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 11, h, 0, 0));
  }

  test.each([
    [9,  /muy buen d[ií]a/i],
    [15, /muy buena tarde/i],
    [21, /muy buena noche/i],
  ])('a las %i h saluda según el momento del día', (hora, patron) => {
    aLaHora(hora);
    const s = window.AsistenteAifa.saludoCordial();
    expect(s).toMatch(patron);
    expect(s).toMatch(/^Hola,/);
    expect(s).toMatch(/soy AIFONSO/i);
  });

  test('el mensaje de bienvenida se presenta y ofrece ayuda', () => {
    const texto = document.querySelector('.aifa-bot-msgs').textContent;
    expect(texto).toMatch(/soy AIFONSO/i);
    expect(texto).toMatch(/ayudar/i);
  });
});

describe('AIFONSO · usa las cifras vivas, no la tabla congelada', () => {
  test('operaciones_anuales NO consulta annual_operations', () => {
    // La tabla annual_operations es una foto que se queda atrás: llegó a
    // reportar 800 mil pasajeros de menos. El dato bueno se arma con
    // monthly_operations + daily_operations, igual que Comparativa Histórica.
    const fuente = fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa-datos.js'), 'utf8');
    const bloque = fuente.slice(
      fuente.indexOf('HERRAMIENTAS.operaciones_anuales'),
      fuente.indexOf('HERRAMIENTAS.listar_aerolineas'));
    expect(bloque).not.toMatch(/from\(['"]annual_operations['"]\)/);
    expect(bloque).toMatch(/from\(['"]monthly_operations['"]\)/);
    expect(bloque).toMatch(/from\(['"]daily_operations['"]\)/);
  });
});

describe('AIFONSO · programación de vuelos', () => {
  const fuente = () => fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa-datos.js'), 'utf8');

  test('la nota obligatoria va literal, como en el módulo de Frecuencias', () => {
    expect(fuente()).toContain(
      'Nota: Esta programación esta sujeta a cambios con base en las necesidades de las aerolíneas.');
  });

  test('las herramientas de programación adjuntan la nota', () => {
    const src = fuente();
    ['contar_rutas', 'listar_destinos', 'frecuencias_destino'].forEach(h => {
      const i = src.indexOf(`HERRAMIENTAS.${h}`);
      const j = src.indexOf('HERRAMIENTAS.', i + 10);
      expect(src.slice(i, j > i ? j : undefined)).toContain('nota_obligatoria');
    });
  });

  test('el enlace del destino es absoluto y apunta a la sección correcta', () => {
    // Se reenvía por WhatsApp: tiene que funcionar fuera de la plataforma.
    const src = fuente();
    expect(src).toMatch(/function _enlaceDestino/);
    expect(src).toContain('#frecuencias-semana');
    expect(src).toContain('?dest=');
  });

  test('el módulo de frecuencias sabe abrir un destino por enlace', () => {
    const frec = fs.readFileSync(path.join(RAIZ, 'js/frecuencias_auto.js'), 'utf8');
    expect(frec).toContain('window.frecuenciasAbrirDestino');
    expect(frec).toMatch(/URLSearchParams\(location\.search\)\.get\('dest'\)/);
  });

  test('la nota se añade por código, no depende de que el modelo la recuerde', async () => {
    // En respuestas largas el modelo la olvidaba, y es obligatoria.
    window.supabaseClient = modeloSimulado('Viva Aerobus lleva 898 vuelos a 39 destinos.');
    window.AsistenteAifa.configurar({ donde: 'nube' });
    window.AsistenteAifa.limpiarHistorial();

    const conDatos = await window.AsistenteAifa.preguntar('¿qué aerolínea vuela más?');
    // La respuesta simulada no trae herramientas, así que se comprueba el
    // comportamiento del ayudante directamente sobre el motor.
    expect(typeof conDatos.texto).toBe('string');

    const motor = fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa.js'), 'utf8');
    expect(motor).toMatch(/function _asegurarNota/);
    expect(motor).toMatch(/HERRAMIENTAS_DE_PROGRAMACION/);
    // Y no debe agregarse cuando se está hablando: se oiría como letra chica.
    const i = motor.indexOf('function _asegurarNota');
    expect(motor.slice(i, i + 500)).toMatch(/!modoVoz\s*&&/);
  });

  test('las listas de destinos van sin código IATA', () => {
    // Los códigos no le dicen nada a quien lee y en voz alta se deletrean.
    const src = fuente();
    const i = src.indexOf('function _etiquetaDestino');
    const bloque = src.slice(i, i + 700);
    expect(bloque).not.toMatch(/\$\{nombre\}\s*\(\$\{code\}\)/);
    expect(bloque).toMatch(/return propio;/);
  });

  test('las cifras grandes salen con separador de miles', () => {
    // Pedirle al modelo que formatee no bastaba: escribía "7058219".
    const src = fuente();
    expect(src).toMatch(/function _cifra/);
    expect(src).toMatch(/toLocaleString\('es-MX'\)/);
    const i = src.indexOf('HERRAMIENTAS.operaciones_anuales');
    const bloque = src.slice(i, src.indexOf('HERRAMIENTAS.listar_aerolineas'));
    expect(bloque).toMatch(/comercial_pasajeros\s*:\s*_cifra\(/);
  });

  test('la nota va sólo en programación de vuelos, no en operaciones', () => {
    // Llegó a aparecer en las cifras anuales, donde no viene al caso: el
    // modelo la copiaba por su cuenta, así que ahora el código la quita.
    const motor = fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa.js'), 'utf8');
    const i = motor.indexOf('function _asegurarNota');
    const bloque = motor.slice(i, i + 800);
    expect(bloque).toMatch(/replace\(RE_NOTA/);          // la quita siempre
    expect(bloque).toMatch(/aplica \?/);                  // y la repone sólo si toca
    // operaciones_anuales no es programación de vuelos
    const set = motor.slice(motor.indexOf('HERRAMIENTAS_DE_PROGRAMACION'), motor.indexOf('HERRAMIENTAS_DE_PROGRAMACION') + 260);
    expect(set).not.toMatch(/operaciones_anuales|operaciones_periodo/);
  });

  test('corrige los nombres de ciudad que vienen sin acento', () => {
    // Ni las tablas de frecuencias ni el catálogo de aeropuertos traen los
    // acentos bien, y como se recargan cada semana la corrección vive en el
    // código, indexada por código IATA que sí es estable.
    const src = fuente();
    [['MID', 'Mérida'], ['MZT', 'Mazatlán'], ['TRC', 'Torreón'],
     ['BOG', 'Bogotá'], ['MDE', 'Medellín'], ['CTG', 'Cartagena'],
     ['SLP', 'San Luis Potosí'], ['TGZ', 'Tuxtla Gutiérrez']]
      .forEach(([iata, ciudad]) => {
        expect(src).toMatch(new RegExp(`${iata}:\\s*'${ciudad}'`));
      });
    // La corrección debe aplicarse antes que cualquier otra fuente.
    const i = src.indexOf('function _etiquetaDestino');
    expect(src.slice(i, i + 300)).toMatch(/NOMBRES_CORREGIDOS\[code\]/);
  });

  test('cierra la respuesta invitando a seguir', () => {
    const motor = fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa.js'), 'utf8');
    expect(motor).toMatch(/CIERRA SIEMPRE ABRIENDO CONVERSACIÓN/);
    expect(motor).toMatch(/Nunca cierres en seco/);
  });

  test('pide enumerar con comas y una sola "y"', () => {
    const motor = fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa.js'), 'utf8');
    expect(motor).toMatch(/usa "y" únicamente antes del último/i);
    expect(motor).toMatch(/nunca escribas códigos de tres letras|jamás por su código/i);
  });

  test('no filtra instrucciones internas al usuario', () => {
    // "CTG (ciudad sin capturar, no la adivines)" llegó a salir tal cual en
    // una respuesta: la advertencia es para el modelo, no para quien pregunta.
    const src = fuente();
    const i = src.indexOf('function _etiquetaDestino');
    expect(src.slice(i, i + 700)).not.toMatch(/no la adivines/);
  });

  test('un resultado enorme nunca se entrega como JSON partido', () => {
    // Cortar la cadena a la brava dejaba al modelo con datos rotos y la
    // respuesta salía truncada a media frase.
    const motor = fs.readFileSync(path.join(RAIZ, 'js/asistente-aifa.js'), 'utf8');
    const i = motor.indexOf('function _recortar');
    const bloque = motor.slice(i, i + 1800);
    expect(bloque).not.toMatch(/return\s+texto\.slice\(/);
    expect(bloque).toContain('demasiado grande');
  });
});

describe('AIFONSO · elige voz de hombre', () => {
  function simularVoces(lista) {
    window.speechSynthesis = {
      getVoices: () => lista,
      cancel() {}, speak() {},
      addEventListener() {},
    };
  }

  test('prefiere una voz masculina en español sobre la femenina', () => {
    // Escenario real de esta computadora: Helena (mujer) y Pablo (hombre).
    simularVoces([
      { name: 'Microsoft Helena Desktop - Spanish (Spain)', lang: 'es-ES' },
      { name: 'Microsoft Pablo - Spanish (Spain)',          lang: 'es-ES' },
    ]);
    const voces = window.AsistenteAifa.vocesDisponibles();
    expect(voces.find(v => /pablo/i.test(v.nombre)).hombre).toBe(true);
    expect(voces.find(v => /helena/i.test(v.nombre)).hombre).toBe(false);
    expect(window.AsistenteAifa.hayVozDeHombre()).toBe(true);
  });

  test('detecta cuando NO hay ninguna voz de hombre', () => {
    simularVoces([
      { name: 'Microsoft Helena Desktop - Spanish (Spain)', lang: 'es-ES' },
      { name: 'Microsoft Sabina - Spanish (Mexico)',        lang: 'es-MX' },
    ]);
    expect(window.AsistenteAifa.hayVozDeHombre()).toBe(false);
  });

  test('no confunde voces femeninas con masculinas', () => {
    simularVoces([
      { name: 'Microsoft Laura - Spanish (Spain)',  lang: 'es-ES' },
      { name: 'Paulina',                            lang: 'es-MX' },
      { name: 'Jorge',                              lang: 'es-ES' },
      { name: 'Mónica',                             lang: 'es-ES' },
      { name: 'Diego',                              lang: 'es-AR' },
    ]);
    const porNombre = Object.fromEntries(
      window.AsistenteAifa.vocesDisponibles().map(v => [v.nombre, v.hombre]));
    expect(porNombre['Jorge']).toBe(true);
    expect(porNombre['Diego']).toBe(true);
    expect(porNombre['Paulina']).toBe(false);
    expect(porNombre['Mónica']).toBe(false);
    expect(porNombre['Microsoft Laura - Spanish (Spain)']).toBe(false);
  });
});

describe('AIFONSO · entiende que le hablan por su nombre', () => {
  beforeAll(() => {
    window.supabaseClient = modeloSimulado('Van 40.');
    window.AsistenteAifa.configurar({ donde: 'nube' });
  });

  // El dictado por voz rara vez escribe bien un nombre propio inventado,
  // así que se aceptan variantes fonéticas.
  test.each([
    ['AIFONSO, ¿cuántas rutas hay?',   '¿cuántas rutas hay?'],
    ['Aifonso cuántas rutas hay',      'cuántas rutas hay'],
    ['oye Alfonso, cuántas rutas hay', 'cuántas rutas hay'],
    ['Hey aifonzo: cuántas rutas hay', 'cuántas rutas hay'],
  ])('quita el nombre de "%s"', async (entrada, esperado) => {
    window.AsistenteAifa.limpiarHistorial();
    await window.AsistenteAifa.preguntar(entrada);
    const ultimoUsuario = [...ultimoEnvio.messages].reverse().find(m => m.role === 'user');
    expect(ultimoUsuario.content).toBe(esperado);
  });

  test('si sólo dicen su nombre, no borra la frase', async () => {
    window.AsistenteAifa.limpiarHistorial();
    await window.AsistenteAifa.preguntar('AIFONSO');
    const ultimoUsuario = [...ultimoEnvio.messages].reverse().find(m => m.role === 'user');
    expect(ultimoUsuario.content).toBe('AIFONSO');
  });

  test('no recorta preguntas que sólo mencionan el nombre a la mitad', async () => {
    window.AsistenteAifa.limpiarHistorial();
    await window.AsistenteAifa.preguntar('¿quién es AIFONSO?');
    const ultimoUsuario = [...ultimoEnvio.messages].reverse().find(m => m.role === 'user');
    expect(ultimoUsuario.content).toBe('¿quién es AIFONSO?');
  });

  test('en modo voz las instrucciones piden respuestas habladas y breves', async () => {
    window.AsistenteAifa.limpiarHistorial();
    await window.AsistenteAifa.preguntar('hola', null, { voz: true });
    const sistema = ultimoEnvio.messages.find(m => m.role === 'system').content;
    expect(sistema).toContain('ESTÁS EN UNA LLAMADA');
    // La restricción debe ir al PRINCIPIO: al final el modelo la ignoraba.
    expect(sistema.indexOf('ESTÁS EN UNA LLAMADA')).toBeLessThan(50);
    expect(ultimoEnvio.max_tokens).toBeLessThanOrEqual(500);
  });

  test('a partir del segundo turno insiste en volver a consultar', async () => {
    // Sin este recordatorio el modelo local dejaba de consultar y respondía
    // de memoria, inventando cifras (medido: 0 de 6 consultaron).
    window.AsistenteAifa.limpiarHistorial();
    await window.AsistenteAifa.preguntar('¿cuántas rutas hay?');
    const sinHistorial = ultimoEnvio.messages.filter(m => m.role === 'system');
    expect(sinHistorial).toHaveLength(1);

    await window.AsistenteAifa.preguntar('¿y las internacionales?');
    const conHistorial = ultimoEnvio.messages.filter(m => m.role === 'system');
    expect(conHistorial).toHaveLength(2);
    expect(conHistorial[1].content).toMatch(/nunca respondas de memoria/i);
    // El recordatorio debe quedar justo antes de la pregunta nueva.
    const roles = ultimoEnvio.messages.map(m => m.role);
    expect(roles[roles.length - 2]).toBe('system');
    expect(roles[roles.length - 1]).toBe('user');
  });

  test('mantiene el hilo de la conversación entre turnos', async () => {
    window.AsistenteAifa.limpiarHistorial();
    await window.AsistenteAifa.preguntar('¿cuántas rutas nacionales hay?');
    await window.AsistenteAifa.preguntar('¿y cuáles son?');
    const roles = ultimoEnvio.messages.map(m => m.role);
    // system + (user/assistant del turno previo) + user actual
    expect(roles.filter(r => r === 'user').length).toBeGreaterThanOrEqual(2);
    expect(ultimoEnvio.messages.some(m => m.role === 'assistant')).toBe(true);
  });
});
