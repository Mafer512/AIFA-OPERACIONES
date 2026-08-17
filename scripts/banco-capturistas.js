#!/usr/bin/env node
/**
 * Banco de pruebas de captura concurrente — Conciliación Manifiestos
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Levanta N capturistas simultáneos sobre la tabla de manifiestos y mide qué
 * pasa: cuánto tarda cada captura en quedar confirmada, cuántas hacen falta
 * reintentar, y —lo único que de verdad importa— si alguna se pierde.
 *
 * Cada "persona" es una ventana con TODO script.js cargado, la misma que corre
 * en producción. Las capturas entran por las mismas funciones que usa cualquier
 * editor de la tabla, así que lo que se ejercita es la ruta real de guardado.
 *
 *   npm run banco
 *   npm run banco -- --personas 8 --latencia 400 --jitter 300 --fallos 0.15
 *
 * Opciones:
 *   --personas N     cuántos capturistas a la vez            (5)
 *   --filas N        cuántos manifiestos en la tabla         (40)
 *   --capturas N     capturas por persona                    (30)
 *   --latencia MS    lo que tarda la base en responder       (15)
 *   --jitter MS      variación aleatoria sobre esa latencia  (0)
 *   --fallos 0..1    proporción de escrituras rechazadas     (0)
 *   --espera S       segundos de gracia al final             (25)
 *
 * Perfiles de red típicos para --latencia/--jitter:
 *
 *   oficina con fibra ....  --latencia 30   --jitter 20
 *   wifi del aeropuerto ..  --latencia 200  --jitter 150
 *   enlace saturado ......  --latencia 700  --jitter 600  --fallos 0.1
 *   red que va y viene ...  --latencia 300  --jitter 200  --fallos 0.35
 *
 * No toca la base de producción: todo ocurre contra un Supabase simulado en
 * memoria. Para medir contra un Supabase de verdad, ver el final de este
 * archivo.
 */

const path = require('path');
const { crearServidor, abrirPersona, pintarTabla, esperar } = require(
  path.resolve(__dirname, '..', 'test-utils', 'capturistas')
);

// ── Opciones ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (nombre, pordefecto) => {
  const i = args.indexOf('--' + nombre);
  return i === -1 ? pordefecto : Number(args[i + 1]);
};

const CFG = {
  personas: opt('personas', 5),
  filas: opt('filas', 40),
  capturas: opt('capturas', 30),
  latencia: opt('latencia', 15),
  jitter: opt('jitter', 0),
  fallos: opt('fallos', 0),
  espera: opt('espera', 25),
};

const NOMBRES = ['Ana Ruiz', 'Luis Prado', 'Marta Solis', 'Diego Cano', 'Sofia Lara',
  'Hugo Vega', 'Nadia Roldan', 'Omar Cisneros', 'Rita Mena', 'Pablo Serna'];
const COLS = ['TOTAL PAX', 'PAX PAGOS', 'INFANTES', 'TRIPULACIÓN', 'MATRÍCULA', 'OBSERVACIONES'];

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const orden = [...arr].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor(orden.length * p))];
};

(async () => {
  console.log('\n  BANCO DE CAPTURA CONCURRENTE — Conciliación Manifiestos');
  console.log('  ' + '─'.repeat(66));
  console.log(`  ${CFG.personas} capturistas · ${CFG.filas} filas · ${CFG.capturas} capturas cada uno`);
  console.log(`  Red simulada: ${CFG.latencia} ms de latencia`
    + (CFG.jitter ? ` ±${CFG.jitter} ms` : '')
    + (CFG.fallos ? ` · ${Math.round(CFG.fallos * 100)}% de escrituras rechazadas` : ' · sin fallos'));
  console.log('  ' + '─'.repeat(66) + '\n');

  const srv = crearServidor();
  srv.latenciaMs = CFG.latencia;
  srv.jitterMs = CFG.jitter;
  srv.tasaFallos = CFG.fallos;

  const ids = [];
  for (let i = 0; i < CFG.filas; i++) {
    ids.push(String(srv.sembrar({
      FECHA: '2026-08-17', '# DE VUELO': 9000 + i,
      'AEROLÍNEA': i % 2 ? 'VIVA AEROBUS' : 'VOLARIS',
      'MATRÍCULA': '', 'ORIGEN/DESTINO': '', 'TOTAL PAX': null, 'PAX PAGOS': null,
      INFANTES: null, 'TRIPULACIÓN': null, OBSERVACIONES: '', 'CAPTURÓ': '',
    })));
  }

  const errores = [];
  const personas = [];
  process.stdout.write('  Abriendo ventanas');
  for (let i = 0; i < CFG.personas; i++) {
    personas.push(await abrirPersona(NOMBRES[i % NOMBRES.length] + (i >= NOMBRES.length ? ` ${i}` : ''), srv, errores));
    process.stdout.write('.');
  }
  console.log(' listo\n');

  const filas = [...srv.filas.values()];
  personas.forEach((p) => { pintarTabla(p.win, filas); p.win.__t.modoEdicion(true); });

  // ── Capturar ───────────────────────────────────────────────────────────────
  // Cada persona trabaja sobre sus propias filas: es lo que pasa de verdad
  // —cada quien lleva unos vuelos— y permite saber exactamente qué debería
  // haber quedado guardado.
  const esperado = new Map();      // "fila|col" -> { valor, t0 }
  const arranque = Date.now();
  const porPersona = Math.max(1, Math.floor(CFG.filas / CFG.personas));

  personas.forEach((p, pi) => {
    for (let k = 0; k < CFG.capturas; k++) {
      const fila = ids[(pi * porPersona + (k % porPersona)) % ids.length];
      const col = COLS[k % COLS.length];
      const valor = col === 'MATRÍCULA' ? `XA-${pi}${k}`
        : col === 'OBSERVACIONES' ? `nota ${pi}-${k}`
          : String(pi * 1000 + k + 1);
      p.win.__t.capturar(fila, col, valor);
      esperado.set(`${fila}|${col}`, { valor, t0: Date.now() });
    }
  });
  console.log(`  ${esperado.size} celdas distintas capturadas en ${((Date.now() - arranque) / 1000).toFixed(1)}s`);
  console.log(`  Esperando a que la base confirme (hasta ${CFG.espera}s)...\n`);

  // ── Esperar y medir ────────────────────────────────────────────────────────
  const latencias = [];
  const confirmadas = new Set();
  const limite = Date.now() + CFG.espera * 1000;

  while (Date.now() < limite && confirmadas.size < esperado.size) {
    await esperar(250);
    esperado.forEach((info, clave) => {
      if (confirmadas.has(clave)) return;
      const [fila, col] = clave.split('|');
      if (String(srv.filas.get(fila)?.[col]) === String(info.valor)) {
        confirmadas.add(clave);
        latencias.push(Date.now() - info.t0);
      }
    });
  }

  // ── Resultado ──────────────────────────────────────────────────────────────
  const perdidas = [];
  esperado.forEach((info, clave) => { if (!confirmadas.has(clave)) perdidas.push({ clave, ...info }); });

  const escrituras = srv.bitacora.filter((b) => b.op).length;
  const rechazos = srv.bitacora.filter((b) => b.error).length;
  const enBorrador = personas.reduce((n, p) => n + Object.keys(p.win.__t.borradores()).length, 0);

  console.log('  ' + '─'.repeat(66));
  console.log('  RESULTADO');
  console.log('  ' + '─'.repeat(66));
  console.log(`  Capturas confirmadas en la base .... ${confirmadas.size} de ${esperado.size}`);
  console.log(`  Escrituras enviadas ............... ${escrituras}`);
  console.log(`  Rechazadas por la base ............ ${rechazos}`);
  console.log(`  Errores de JavaScript ............. ${errores.filter((e) => /conci/i.test(e) && !/pendiente de guardar/.test(e)).length}`);
  console.log('');
  console.log(`  Tiempo hasta quedar guardado    mitad de los casos: ${pct(latencias, 0.5)} ms`);
  console.log(`                                  9 de cada 10:       ${pct(latencias, 0.9)} ms`);
  console.log(`                                  el peor:            ${Math.max(0, ...latencias)} ms`);
  console.log('');

  if (!perdidas.length) {
    console.log('  ✅ No se perdió ninguna captura.');
    if (enBorrador) {
      console.log(`     (${enBorrador} siguen en el borrador local, esperando su reintento —`);
      console.log('      eso es la red de seguridad haciendo su trabajo, no una pérdida.)');
    }
  } else {
    const rescatables = perdidas.filter((p) => enBorrador > 0).length;
    console.log(`  ⚠️  ${perdidas.length} capturas no llegaron a la base en ${CFG.espera}s.`);
    console.log(`     ${enBorrador} siguen a salvo en el borrador local y se reintentarían solas;`);
    console.log('     sube --espera para darles más margen antes de darlas por perdidas.');
    perdidas.slice(0, 8).forEach((p) => console.log(`       · ${p.clave} = ${p.valor}`));
    if (rescatables === 0 && enBorrador === 0) {
      console.log('     NINGUNA está en el borrador: eso sí sería pérdida real.');
    }
  }
  console.log('');
  process.exit(perdidas.length && enBorrador === 0 ? 1 : 0);
})().catch((e) => { console.error('  El banco reventó:', e); process.exit(2); });

/*
 * ── Medir contra un Supabase de verdad ───────────────────────────────────────
 *
 * Lo de arriba mide el comportamiento del código con una red simulada, que es
 * lo que hace falta para saber si se pierden datos. Para medir la latencia REAL
 * de la base hay otra vía, y conviene tenerla clara:
 *
 *   1. Crea un proyecto de Supabase APARTE (uno de pruebas, gratuito).
 *   2. Ejecuta ahí db/reportes_hvac.sql y el resto de db/*.sql que apliquen,
 *      más db/conciliacion_capturas_pendientes.sql.
 *   3. Copia unas cuantas filas reales de "Conciliación Manifiestos" a ese
 *      proyecto para tener datos representativos.
 *   4. Abre la aplicación con window.APP_CONFIG apuntando a ese proyecto:
 *
 *        <script>
 *          window.APP_CONFIG = {
 *            SUPABASE_URL: 'https://TU-PROYECTO-DE-PRUEBAS.supabase.co',
 *            SUPABASE_ANON_KEY: '...'
 *          };
 *        </script>
 *
 *      Va antes de js/supabase-client.js en index.html; ese archivo ya lee
 *      APP_CONFIG y solo cae en el proyecto de siempre si no lo encuentra.
 *
 *   5. Abre cinco ventanas con cinco usuarios distintos y captura.
 *
 * NUNCA contra el proyecto de producción: este banco escribe cientos de valores
 * inventados, y en la tabla real eso es basura sobre datos de operación.
 */
