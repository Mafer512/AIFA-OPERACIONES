/**
 * Cinco capturistas a la vez sobre la tabla de manifiestos.
 *
 * Cada "persona" es una ventana independiente con TODO script.js cargado —los
 * mismos ~28.600 renglones que corren en producción—, y las cinco comparten un
 * Supabase falso que se comporta como el real: guarda filas, responde lo que
 * quedó guardado, y reparte por realtime lo que cambió a las demás.
 *
 * No se toca la base de producción. Los datos de esta prueba son inventados.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
//  El Supabase falso, compartido por las cinco ventanas
// ─────────────────────────────────────────────────────────────────────────────
function crearServidor() {
  const TABLA = 'Conciliación Manifiestos';
  const filas = new Map();          // id -> objeto
  const bitacora = [];              // toda escritura que llega
  const oyentes = [];               // postgres_changes
  const canales = [];               // broadcast + presence
  let siguienteId = 9000;

  const srv = {
    TABLA,
    filas,
    bitacora,
    // Perfil de red simulada. El banco de pruebas los mueve para reproducir
    // desde una oficina con fibra hasta un enlace saturado.
    latenciaMs: 15,
    jitterMs: 0,            // variacion aleatoria sobre la latencia
    tasaFallos: 0,          // 0..1 — proporcion de escrituras que se rechazan
    fallarSiguiente: null,          // para simular un error puntual
    // Falla determinista, acotada a una fila: "la siguiente peticion" es
    // ambiguo cuando hay capturas en vuelo de otras personas y el fallo puede
    // caerle a quien no toca.
    fallarFila: null,

    sembrar(fila) {
      const id = fila.id ?? ++siguienteId;
      filas.set(String(id), { ...fila, id });
      return id;
    },

    _emitir(evento, fila, exceptoCliente) {
      oyentes.forEach((o) => {
        if (o.cliente === exceptoCliente) return;
        try { o.cb({ eventType: evento, new: { ...fila }, table: TABLA }); } catch (_) {}
      });
    },

    _broadcast(evento, payload, remitente) {
      canales.forEach((c) => {
        if (c.cliente === remitente) return;   // Supabase no te devuelve lo tuyo
        (c.handlers[evento] || []).forEach((h) => {
          try { h({ payload }); } catch (_) {}
        });
      });
    },

    resumen() {
      return {
        filas: filas.size,
        escrituras: bitacora.length,
        errores: bitacora.filter((b) => b.error).length,
      };
    },
  };

  // Cliente por persona
  srv.cliente = function (quien) {
    const marca = { quien };

    function consulta(tabla) {
      const estado = { tabla, filtros: [], operacion: null, datos: null };

      const api = {
        select() { return api; },
        eq(col, val) { estado.filtros.push([col, String(val)]); return api; },
        in() { return api; },
        order() { return api; },
        limit() { return api; },
        gte() { return api; },
        lte() { return api; },
        neq() { return api; },
        is() { return api; },
        insert(datos) { estado.operacion = 'insert'; estado.datos = datos; return api; },
        update(datos) { estado.operacion = 'update'; estado.datos = datos; return api; },
        upsert(datos) { estado.operacion = 'insert'; estado.datos = datos; return api; },
        delete() { estado.operacion = 'delete'; return api; },
        maybeSingle() { estado.single = true; return api; },
        single() { estado.single = true; return api; },
        then(res, rej) { return ejecutar().then(res, rej); },
      };

      async function ejecutar() {
        const jitter = srv.jitterMs ? Math.random() * srv.jitterMs : 0;
        await esperar(srv.latenciaMs + jitter);

        if (srv.tasaFallos > 0 && estado.operacion && Math.random() < srv.tasaFallos) {
          bitacora.push({ quien, error: 'rechazo aleatorio', op: estado.operacion });
          return { data: null, error: { message: 'la base rechazo la escritura (simulado)' } };
        }

        if (srv.fallarSiguiente) {
          const err = srv.fallarSiguiente;
          srv.fallarSiguiente = null;
          bitacora.push({ quien, error: err.message, op: estado.operacion });
          return { data: null, error: err };
        }

        if (srv.fallarFila && estado.operacion) {
          const idFiltro = (estado.filtros.find(([c]) => c === 'id') || [])[1];
          if (String(idFiltro) === String(srv.fallarFila)) {
            bitacora.push({ quien, error: 'fila bloqueada', op: estado.operacion, id: String(idFiltro) });
            return { data: null, error: { message: 'fallo de red simulado' } };
          }
        }

        if (estado.operacion === 'insert') {
          const entrada = Array.isArray(estado.datos) ? estado.datos[0] : estado.datos;
          const id = ++siguienteId;
          const fila = { ...entrada, id };
          filas.set(String(id), fila);
          bitacora.push({ quien, op: 'insert', id, cols: Object.keys(entrada), ts: Date.now() });
          srv._emitir('INSERT', fila, marca);
          return { data: estado.single ? { ...fila } : [{ ...fila }], error: null };
        }

        if (estado.operacion === 'update') {
          const idFiltro = (estado.filtros.find(([c]) => c === 'id') || [])[1];
          const actual = filas.get(String(idFiltro));
          if (!actual) return { data: null, error: null };
          const entrada = Array.isArray(estado.datos) ? estado.datos[0] : estado.datos;
          // Igual que Postgres: solo se tocan las columnas que vienen.
          Object.assign(actual, entrada);
          bitacora.push({
            quien, op: 'update', id: String(idFiltro),
            cols: Object.keys(entrada), valores: { ...entrada }, ts: Date.now(),
          });
          srv._emitir('UPDATE', actual, marca);
          return { data: estado.single ? { ...actual } : [{ ...actual }], error: null };
        }

        if (estado.operacion === 'delete') {
          const idFiltro = (estado.filtros.find(([c]) => c === 'id') || [])[1];
          filas.delete(String(idFiltro));
          bitacora.push({ quien, op: 'delete', id: String(idFiltro) });
          return { data: null, error: null };
        }

        // select
        // Tablas de autorizacion: sin una fila aqui, la aplicacion concluye que
        // el usuario no tiene acceso, llama a rejectOperacionesAccess() y hace
        // sessionStorage.clear() — con lo que el nombre del capturista se pierde
        // y CAPTURO se queda vacio. Es lo que pasa en un entorno de prueba, no
        // en produccion, donde el usuario si tiene su fila de rol.
        if (tabla === 'user_roles') {
          return { data: estado.single ? { role: 'capturista', user_id: quien } : [{ role: 'capturista', user_id: quien }], error: null };
        }
        if (tabla === 'usuarios_aplicaciones') {
          return { data: estado.single ? { rol: 'capturista', estado: 'ACTIVO', aplicacion: 'OPERACIONES' } : [{ rol: 'capturista', estado: 'ACTIVO', aplicacion: 'OPERACIONES' }], error: null };
        }
        if (tabla === 'profiles') {
          return { data: estado.single ? { id: quien, full_name: quien } : [{ id: quien, full_name: quien }], error: null };
        }

        let salida = [...filas.values()];
        estado.filtros.forEach(([col, val]) => {
          salida = salida.filter((f) => String(f[col]) === val);
        });
        return { data: estado.single ? (salida[0] || null) : salida, error: null };
      }

      return api;
    }

    return {
      from: (t) => consulta(t),
      rpc: () => consulta('rpc'),
      removeChannel: () => {},
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: quien, email: quien + '@aifa.mx', user_metadata: { full_name: quien } } }, error: null }),
        getSession: () => Promise.resolve({ data: { session: { user: { id: quien, email: quien + '@aifa.mx', user_metadata: { full_name: quien } } } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
      channel(nombre) {
        const handlers = {};
        const registro = { cliente: marca, nombre, handlers, presencia: {} };
        canales.push(registro);
        const ch = {
          on(tipo, filtro, cb) {
            const fn = typeof filtro === 'function' ? filtro : cb;
            if (tipo === 'broadcast') {
              const ev = (filtro && filtro.event) || '*';
              (handlers[ev] = handlers[ev] || []).push(fn);
            } else if (tipo === 'postgres_changes') {
              oyentes.push({ cliente: marca, cb: (p) => fn(p) });
            } else if (tipo === 'presence') {
              (handlers['__presence'] = handlers['__presence'] || []).push(fn);
            }
            return ch;
          },
          subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return ch; },
          send(msg) {
            if (msg && msg.type === 'broadcast') srv._broadcast(msg.event, msg.payload, marca);
            return Promise.resolve('ok');
          },
          track: () => Promise.resolve('ok'),
          untrack: () => Promise.resolve('ok'),
          presenceState: () => ({}),
          unsubscribe: () => Promise.resolve('ok'),
        };
        return ch;
      },
    };
  };

  return srv;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Una ventana = una persona
// ─────────────────────────────────────────────────────────────────────────────

const codigoScript = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8');

// `opciones.almacenamiento` reproduce un refresco de la pestana: la ventana es
// nueva, pero el localStorage es el que dejo la anterior, igual que en un
// navegador de verdad.
async function abrirPersona(nombre, servidor, errores, opciones = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const noop = () => {};
  const doble = new Proxy(function () {}, { get: () => doble, apply: () => doble, construct: () => doble });

  win.addEventListener('error', (e) => errores.push(`${nombre}: ${(e.error && e.error.stack) || e.message}`));

  Object.assign(win, {
    supabaseClient: servidor.cliente(nombre),
    ensureSupabaseClient: async () => win.supabaseClient,
    supabase: { createClient: () => win.supabaseClient },
    bootstrap: { Modal: doble, Tooltip: doble, Tab: doble, Dropdown: doble },
    Chart: doble, XLSX: { utils: {} }, jspdf: { jsPDF: doble }, $: doble, jQuery: doble,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    fetch: () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    // Los avisos al usuario se recogen para poder comprobarlos.
    __avisos: [],
    showNotification: function (msg) { win.__avisos.push(String(msg)); },
    scrollTo: noop,
  });
  win.HTMLCanvasElement.prototype.getContext = () => doble;
  win.HTMLElement.prototype.scrollIntoView = noop;
  win.console.error = (...a) => errores.push(`${nombre} console.error: ${a.map(String).join(' ')}`);
  win.console.warn = (...a) => errores.push(`${nombre} WARN: ${a.map(String).join(' ')}`);
  win.console.log = noop;

  if (opciones.almacenamiento) {
    Object.entries(opciones.almacenamiento).forEach(([k, v]) => win.localStorage.setItem(k, v));
  }

  // Sesion de capturista: es lo que consulta _conciCurrentUserRole().
  win.sessionStorage.setItem('user_role', 'capturista');
  win.sessionStorage.setItem('user_fullname', nombre);
  win.dataManager = { userRole: 'capturista' };
  win.sectionLevel = () => 'capture';

  // El puente va DENTRO del mismo eval que script.js. En un eval indirecto las
  // declaraciones let/const solo existen durante esa llamada: desde fuera no se
  // ven, y asignarles algo crearia otra variable global distinta —que es lo que
  // pasaba: el modulo se quedaba con _conciEditMode = false y no guardaba nada.
  const puente = `
    // script.js declara su propia showNotification y al evaluarlo pisa
    // cualquier doble puesto antes. Se reemplaza aqui, ya dentro del mismo
    // eval, para poder comprobar lo que se le dice al usuario.
    showNotification = function (msg) { window.__avisos.push(String(msg)); };
    window.__t = {
      modoEdicion(v) { _conciEditMode = v; },
      pendientes() { return _conciPendingAutoSaveCount; },
      capturar(rowId, col, valor) {
        const tr = document.querySelector('tr[data-row-id="' + rowId + '"]');
        if (!tr) throw new Error('no existe la fila ' + rowId);
        const td = tr.querySelector('td[data-col="' + col + '"]');
        if (!td) throw new Error('no existe la columna ' + col);
        _conciStageCellDraft(td, valor);
        _conciQueueAutoSave(tr);
      },
      guardarYa(rowId) {
        const tr = document.querySelector('tr[data-row-id="' + rowId + '"]');
        return _conciAutoSaveRow(tr);
      },
      leer(rowId, col) {
        const tr = document.querySelector('tr[data-row-id="' + rowId + '"]');
        if (!tr) return null;
        const td = tr.querySelector('td[data-col="' + col + '"]');
        if (!td) return null;
        return td.dataset.pendingRaw !== undefined ? td.dataset.pendingRaw : (td.dataset.raw || td.textContent);
      },
      borradores() { return _conciBorradoresLeer(); },
      recibirBroadcast(payload) { _conciHandleRemoteCellSaved(payload); },
      puedeEditar() { return _conciCanCurrentUserEdit(); },
      conflictos() { return [..._conciConflictos.entries()].map(([k, v]) => k + ' -> ' + v.usuario + ':' + v.valor); },
      adoptar(rowId, col) {
        const td = document.querySelector('tr[data-row-id="' + rowId + '"] td[data-col="' + col + '"]');
        _conciAdoptarValorRemoto(td);
      },
      // ── Fila nueva desde el boton "Agregar fila" ──────────────────────────
      // Una fila recien agregada todavia no tiene id, asi que no se puede
      // apuntar con capturar(rowId, ...). Se la localiza por data-conci-new.
      // Se conserva la referencia al nodo: en cuanto la fila se guarda pierde
      // data-conci-new (deja de ser nueva), y buscarla por ese atributo la
      // perderia justo a mitad de la captura.
      agregarFila() {
        _conciAddBlankRow();
        window.__filaNueva = document.querySelector('tr[data-conci-new="1"]');
        return !!window.__filaNueva;
      },
      filaNuevaExiste() { return !!document.querySelector('tr[data-conci-new="1"]'); },
      idDeFilaNueva() {
        const tr = window.__filaNueva;
        return tr ? String(tr.dataset.rowId || '') : '';
      },
      capturarEnNueva(col, valor) {
        const tr = window.__filaNueva;
        if (!tr) throw new Error('no hay fila nueva');
        const td = tr.querySelector('td[data-col="' + col + '"]');
        if (!td) throw new Error('no existe la columna ' + col);
        _conciStageCellDraft(td, valor);
        _conciQueueAutoSave(tr);
      },
      // Cerrar el editor sin escribir nada es lo que hacia nacer la fila
      // fantasma: _conciCommitCellRaw llama al autoguardado igual.
      salirDeLaFilaNuevaSinEscribir() {
        const tr = window.__filaNueva;
        if (!tr) throw new Error('no hay fila nueva');
        return _conciAutoSaveRow(tr);
      },
      guardarTodo() { return _conciGuardarTodoAhora(); },
      avisos() { return window.__avisos.slice(); },
    };
  `;

  try {
    win.eval(codigoScript + String.fromCharCode(10) + ';' + puente);
  } catch (e) {
    errores.push(`${nombre}: al cargar script.js — ${(e && e.stack) || e}`);
  }

  return { nombre, win, dom };
}

// Construye la tabla igual que la pinta el módulo: mismos atributos.
const COLUMNAS = [
  'FECHA', '# DE VUELO', 'AEROLÍNEA', 'MATRÍCULA', 'ORIGEN/DESTINO',
  'TOTAL PAX', 'PAX PAGOS', 'INFANTES', 'TRIPULACIÓN', 'OBSERVACIONES', 'CAPTURÓ',
];

function pintarTabla(win, filas) {
  const cuerpo = filas.map((f) => `
    <tr data-row-id="${f.id}" data-row-fuente="Manifiestos + Vuelos">
      ${COLUMNAS.map((c) => `<td data-col="${c}" data-raw="${f[c] ?? ''}">${f[c] ?? ''}</td>`).join('')}
    </tr>`).join('');
  win.document.body.innerHTML = `
    <span id="conci-presencia"></span>
    <table id="table-conci-manifiestos"><tbody>${cuerpo}</tbody></table>`;
}

// Lo que la pestana dejaria escrito en disco al cerrarse.
function volcarAlmacenamiento(win) {
  const salida = {};
  for (let i = 0; i < win.localStorage.length; i++) {
    const k = win.localStorage.key(i);
    salida[k] = win.localStorage.getItem(k);
  }
  return salida;
}

module.exports = { crearServidor, abrirPersona, pintarTabla, COLUMNAS, esperar, volcarAlmacenamiento };
