/**
 * @jest-environment node
 *
 * Refrescar la pestaña, cerrarla o irse a otra ventana no puede costar una
 * captura.
 *
 * Es el miedo razonable de cualquiera que captura: llevo veinte campos puestos,
 * se me va el internet, y si toco F5 lo pierdo todo. Aquí se comprueba que no.
 *
 * Tres redes de seguridad, en este orden:
 *
 *   1. El borrador local guarda cada celda desde el primer tecleo y solo se
 *      borra cuando la base confirma ese valor exacto. Sobrevive al refresco.
 *
 *   2. Al esconderse o cerrarse la pestaña, lo que aún no está confirmado se
 *      manda al servidor con `keepalive` — la única forma de que una petición
 *      sobreviva a la descarga de la página.
 *
 *   3. Esa cola del servidor la ve todo el mundo, así que una captura que se
 *      quedó a medias en una computadora que no vuelve a encenderse se puede
 *      rescatar desde cualquier otra.
 */

const {
  crearServidor, abrirPersona, pintarTabla, esperar, volcarAlmacenamiento,
} = require('../test-utils/capturistas');

const sembrar = (srv, n) => {
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(String(srv.sembrar({
      FECHA: '2026-08-17', '# DE VUELO': 9500 + i, 'AEROLÍNEA': 'VOLARIS',
      'MATRÍCULA': '', 'ORIGEN/DESTINO': '', 'TOTAL PAX': null, 'PAX PAGOS': null,
      INFANTES: null, 'TRIPULACIÓN': null, OBSERVACIONES: '', 'CAPTURÓ': '',
    })));
  }
  return ids;
};

describe('refrescar la pestaña con capturas sin guardar', () => {
  let srv, ids, errores;

  beforeAll(() => { errores = []; srv = crearServidor(); ids = sembrar(srv, 5); });

  test('lo capturado durante un corte reaparece tras el refresco y acaba en la base', async () => {
    // Ana captura tres campos mientras la base rechaza esa fila.
    const fila = ids[0];
    srv.fallarFila = fila;
    const antes = await abrirPersona('Ana Ruiz', srv, errores);
    pintarTabla(antes.win, [...srv.filas.values()]);
    antes.win.__t.modoEdicion(true);
    antes.win.__t.capturar(fila, 'TOTAL PAX', '177');
    antes.win.__t.capturar(fila, 'MATRÍCULA', 'XA-REF');
    antes.win.__t.capturar(fila, 'OBSERVACIONES', 'tres campos capturados');
    await esperar(1200);

    expect(srv.filas.get(fila)['TOTAL PAX']).toBeNull();          // no llegó
    const disco = volcarAlmacenamiento(antes.win);                 // lo que queda escrito
    expect(JSON.stringify(disco)).toContain('tres campos capturados');

    // F5: ventana nueva, mismo localStorage. Y vuelve la red.
    srv.fallarFila = null;
    const despues = await abrirPersona('Ana Ruiz', srv, errores, { almacenamiento: disco });
    pintarTabla(despues.win, [...srv.filas.values()]);
    despues.win.__t.modoEdicion(true);
    despues.win.eval('_conciRestaurarBorradores()');
    await esperar(1500);

    // Reaparecieron en su fila...
    expect(despues.win.__t.leer(fila, 'TOTAL PAX')).toBe('177');
    expect(despues.win.__t.leer(fila, 'MATRÍCULA')).toBe('XA-REF');
    expect(despues.win.__t.leer(fila, 'OBSERVACIONES')).toBe('tres campos capturados');

    // ...y se guardaron solas, sin que nadie las volviera a teclear.
    let listo = false;
    for (let i = 0; i < 20 && !listo; i++) {
      await esperar(500);
      listo = String(srv.filas.get(fila)['TOTAL PAX']) === '177';
    }
    expect(listo).toBe(true);
    expect(srv.filas.get(fila)['MATRÍCULA']).toBe('XA-REF');
    expect(srv.filas.get(fila).OBSERVACIONES).toBe('tres campos capturados');
  }, 60000);

  test('cuando todo se guardó bien, el refresco no resucita nada', async () => {
    const fila = ids[1];
    const p = await abrirPersona('Luis Prado', srv, errores);
    pintarTabla(p.win, [...srv.filas.values()]);
    p.win.__t.modoEdicion(true);
    p.win.__t.capturar(fila, 'TOTAL PAX', '88');
    await esperar(1200);
    expect(String(srv.filas.get(fila)['TOTAL PAX'])).toBe('88');

    // El borrador se limpió al confirmarse, así que no queda nada que reponer.
    const disco = volcarAlmacenamiento(p.win);
    expect(JSON.stringify(disco)).not.toContain('88');
  }, 30000);
});

describe('cerrar la pestaña', () => {
  test('lo que no estaba confirmado sale hacia el servidor con keepalive', async () => {
    const srv = crearServidor();
    const errores = [];
    const ids = sembrar(srv, 3);
    const fila = ids[0];

    const p = await abrirPersona('Marta Solis', srv, errores);
    pintarTabla(p.win, [...srv.filas.values()]);
    p.win.__t.modoEdicion(true);

    // Se recogen las peticiones de último momento, que no pasan por el cliente
    // de supabase-js sino por fetch directo contra el REST.
    p.win.eval(`
      window.__keepalive = [];
      window.SUPABASE_URL = 'https://ejemplo.supabase.co';
      window.SUPABASE_ANON_KEY = 'clave-de-prueba';
      fetch = function (url, opts) {
        window.__keepalive.push({ url: String(url), keepalive: !!(opts && opts.keepalive), body: opts && opts.body });
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      };
    `);

    srv.fallarFila = fila;
    p.win.__t.capturar(fila, 'OBSERVACIONES', 'se cierra la pestaña');
    await esperar(900);

    // La persona cierra la pestaña.
    p.win.eval("window.dispatchEvent(new window.Event('pagehide'))");
    await esperar(200);

    const envios = p.win.__keepalive.filter((e) => e.url.includes('conciliacion_capturas_pendientes'));
    expect(envios.length).toBeGreaterThan(0);
    expect(envios[0].keepalive).toBe(true);          // sobrevive a la descarga
    expect(envios[0].body).toContain('se cierra la pestaña');
    expect(envios[0].body).toContain('Marta Solis');
  }, 30000);

  test('sin nada pendiente no se manda nada al cerrar', async () => {
    const srv = crearServidor();
    const errores = [];
    const ids = sembrar(srv, 2);
    const p = await abrirPersona('Diego Cano', srv, errores);
    pintarTabla(p.win, [...srv.filas.values()]);
    p.win.__t.modoEdicion(true);
    p.win.eval(`
      window.__keepalive = [];
      window.SUPABASE_URL = 'https://ejemplo.supabase.co';
      window.SUPABASE_ANON_KEY = 'clave';
      fetch = function (url, opts) { window.__keepalive.push(String(url)); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    `);

    p.win.__t.capturar(ids[0], 'TOTAL PAX', '10');
    await esperar(1200);                              // se guarda bien
    p.win.eval("window.dispatchEvent(new window.Event('pagehide'))");
    await esperar(200);

    expect(p.win.__keepalive.filter((u) => u.includes('capturas_pendientes'))).toEqual([]);
  }, 30000);
});

describe('las instrucciones para quien captura', () => {
  test('el botón existe y abre un panel que explica lo importante', async () => {
    const srv = crearServidor();
    const p = await abrirPersona('Sofia Lara', srv, []);
    p.win.eval('_conciAbrirInstrucciones()');
    const texto = p.win.document.getElementById('conci-instrucciones-modal').textContent;

    expect(texto).toMatch(/No hace falta guardar/i);
    expect(texto).toMatch(/refrescas o cierras/i);
    expect(texto).toMatch(/No se pierde nada/i);
    expect(texto).toMatch(/misma celda/i);
  }, 30000);

  test('el botón está en la barra del módulo', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
    expect(html).toContain('id="btn-conci-instrucciones"');
    expect(html).toContain('_conciAbrirInstrucciones()');
  });
});
