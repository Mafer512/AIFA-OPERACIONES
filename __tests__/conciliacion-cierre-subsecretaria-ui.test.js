/**
 * @jest-environment jsdom
 *
 * Comportamiento real de js/conci-cierre-subsecretaria.js.
 *
 * A diferencia de las pruebas estáticas (que leen el SQL como texto), estas
 * EJECUTAN el módulo en un DOM simulado con un cliente de Supabase falso, y
 * comprueban lo que de verdad hace: qué botones muestra según privilegios,
 * que la doble confirmación no se pueda saltar, que la contraseña se limpie,
 * que FIJO/PREVIO/TOTAL se calculen sin doble conteo, y que un fallo del
 * módulo nunca rompa Manifiestos.
 *
 * Nada aquí toca Supabase real: el cliente es un doble de prueba.
 */
const fs = require('fs');
const path = require('path');

const moduleSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'conci-cierre-subsecretaria.js'),
  'utf8'
);

/** DOM mínimo con los mismos ids que index.html expone para este módulo. */
function montarDom() {
  document.body.innerHTML = `
    <button id="btn-conci-cierre-subsecretaria" class="d-none"></button>
    <button id="btn-conci-corregir-cerrado" class="d-none"></button>
    <button id="btn-conci-solicitudes-pendientes" class="d-none">
      <span id="badge-conci-solicitudes-pendientes" class="d-none">0</span>
    </button>
    <select id="filter-conci-manifiestos-year"><option value="2026" selected>2026</option></select>
    <select id="filter-conci-manifiestos-month"><option value="9" selected>9</option></select>
    <select id="filter-conci-manifiestos-day"><option value="22" selected>22</option></select>
    <div id="manifiestos-summary-strip">
      <div id="mf-cierre-card-fijo" class="d-none"><span id="mf-cierre-fijo">—</span></div>
      <div id="mf-cierre-card-previo" class="d-none"><span id="mf-cierre-previo">—</span></div>
      <div id="mf-cierre-card-total" class="d-none"><span id="mf-cierre-total">—</span></div>
    </div>
  `;
}

/**
 * Cliente de Supabase falso. Registra cada llamada para poder afirmar sobre
 * ellas, y permite programar la respuesta de cada RPC.
 */
function crearClienteFalso({ rpcRespuestas = {}, authError = null } = {}) {
  const llamadas = { rpc: [], signIn: [] };
  return {
    llamadas,
    cliente: {
      auth: {
        signInWithPassword: jest.fn(async (args) => {
          llamadas.signIn.push(args);
          return { error: authError };
        }),
      },
      rpc: jest.fn(async (nombre, params) => {
        llamadas.rpc.push({ nombre, params });
        if (Object.prototype.hasOwnProperty.call(rpcRespuestas, nombre)) {
          return rpcRespuestas[nombre];
        }
        return { data: null, error: null };
      }),
    },
  };
}

/** Carga el módulo (IIFE) en el jsdom actual y dispara DOMContentLoaded. */
function cargarModulo() {
  // eslint-disable-next-line no-new-func
  new Function(moduleSource)();
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
}

/** Espera a que se vacíe la cola de microtareas/temporizadores pendientes. */
const esperar = () => new Promise((resolve) => setTimeout(resolve, 0));

function configurarUsuario({ rol = 'capturista', permisos = {}, nivelSeccion = 'capture' } = {}) {
  window._conciCurrentUserRole = () => rol;
  window._conciSectionLevelAllows = (niveles) => niveles.has(nivelSeccion);
  window._conciCanCurrentUserEdit = () => ['capturista', 'editor', 'admin', 'superadmin'].includes(rol);
  window.dataManager = { permissions: permisos };
  window.sessionStorage.setItem('currentUser', 'usuario@aifa.test');
}

beforeEach(() => {
  jest.useRealTimers();
  montarDom();
  delete window._conciCierreOnSummaryData;
  delete window._conciCierreExtraRowAction;
  delete window.conciCierreSubsecretaria;
  window.bootstrap = undefined;   // sin bootstrap: los modales no se muestran, el resto sí corre
  window.loadConciliacionManifiestos = jest.fn();
});

describe('visibilidad de botones según privilegios (solo UX; la BD manda igual)', () => {
  test('un capturista sin privilegios no ve cerrar ni la bandeja, pero sí puede solicitar correcciones', async () => {
    configurarUsuario({ rol: 'capturista' });
    window.supabaseClient = crearClienteFalso().cliente;
    cargarModulo();
    await esperar();
    await new Promise((r) => setTimeout(r, 600)); // el módulo aplica visibilidad tras 500 ms

    expect(document.getElementById('btn-conci-cierre-subsecretaria').classList.contains('d-none')).toBe(true);
    expect(document.getElementById('btn-conci-solicitudes-pendientes').classList.contains('d-none')).toBe(true);
    expect(document.getElementById('btn-conci-corregir-cerrado').classList.contains('d-none')).toBe(false);
  });

  test('el flag conciliacion_cierra_subsecretaria muestra Cerrar sin volver admin al usuario', async () => {
    configurarUsuario({ rol: 'editor', permisos: { conciliacion_cierra_subsecretaria: true }, nivelSeccion: 'edit' });
    window.supabaseClient = crearClienteFalso().cliente;
    cargarModulo();
    await new Promise((r) => setTimeout(r, 600));

    expect(document.getElementById('btn-conci-cierre-subsecretaria').classList.contains('d-none')).toBe(false);
    // Solo tiene el privilegio de cierre: la bandeja de autorización sigue oculta.
    expect(document.getElementById('btn-conci-solicitudes-pendientes').classList.contains('d-none')).toBe(true);
  });

  test('el flag conciliacion_autoriza_correccion muestra la bandeja, pero no el cierre', async () => {
    configurarUsuario({ rol: 'editor', permisos: { conciliacion_autoriza_correccion: true }, nivelSeccion: 'edit' });
    window.supabaseClient = crearClienteFalso({
      rpcRespuestas: { conciliacion_solicitudes_pendientes: { data: [], error: null } },
    }).cliente;
    cargarModulo();
    await new Promise((r) => setTimeout(r, 600));

    expect(document.getElementById('btn-conci-solicitudes-pendientes').classList.contains('d-none')).toBe(false);
    expect(document.getElementById('btn-conci-cierre-subsecretaria').classList.contains('d-none')).toBe(true);
  });

  test('admin ve las tres acciones sin necesidad de flags', async () => {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    window.supabaseClient = crearClienteFalso({
      rpcRespuestas: { conciliacion_solicitudes_pendientes: { data: [], error: null } },
    }).cliente;
    cargarModulo();
    await new Promise((r) => setTimeout(r, 600));

    expect(document.getElementById('btn-conci-cierre-subsecretaria').classList.contains('d-none')).toBe(false);
    expect(document.getElementById('btn-conci-corregir-cerrado').classList.contains('d-none')).toBe(false);
    expect(document.getElementById('btn-conci-solicitudes-pendientes').classList.contains('d-none')).toBe(false);
  });
});

describe('un solo Cierre de Subsecretaría por fecha', () => {
  async function abrirConResumen(resumen) {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    const falso = crearClienteFalso({
      rpcRespuestas: {
        conciliacion_resumen_lote_abierto: { data: resumen, error: null },
        conciliacion_cerrar_subsecretaria: {
          data: { cierre_id: 1, fecha_corte: '2026-09-22', total_manifiestos: 12, total_ajustes_consumidos: 0 },
          error: null,
        },
      },
    });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    window.conciCierreSubsecretaria.abrirModalCierre();
    await esperar();
    await esperar();
    return falso;
  }

  test('si el corte de hoy ya se hizo, el modal lo dice y no deja continuar', async () => {
    await abrirConResumen({
      total_manifiestos: 4,
      ajustes_pendientes: 1,
      totales_reportados: { 'TOTAL PAX': 400 },
      cierre_de_hoy_realizado: true,
      siguiente_fecha_corte: '2026-09-23',
      ultimo_cierre: { cierre_id: 7, fecha_corte: '2026-09-22', cerrado_por_nombre: 'Jefa en turno' },
    });
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    const aviso = modal.querySelector('#conci-cierre-ya-cerrado');

    expect(aviso.classList.contains('d-none')).toBe(false);
    expect(aviso.textContent).toMatch(/2026-09-22/);
    expect(aviso.textContent).toMatch(/sólo se admite uno por fecha/i);
    // Y dice a qué corte irá lo que quede pendiente.
    expect(aviso.textContent).toMatch(/2026-09-23/);
    expect(modal.querySelector('#conci-cierre-continuar').disabled).toBe(true);
  });

  test('el lote pendiente NO se pierde: se anuncia que entrará al corte siguiente', async () => {
    await abrirConResumen({
      total_manifiestos: 4,
      ajustes_pendientes: 1,
      totales_reportados: {},
      cierre_de_hoy_realizado: true,
      siguiente_fecha_corte: '2026-09-23',
      ultimo_cierre: { fecha_corte: '2026-09-22' },
    });
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    expect(modal.querySelector('#conci-cierre-detalle').textContent)
      .toMatch(/4 manifiesto\(s\) capturado\(s\) y aún no cerrado\(s\), más 1 ajuste/);
    // La fecha que se anuncia es la del PRÓXIMO corte, no la de hoy.
    expect(modal.querySelector('#conci-cierre-fecha-1').textContent).toBe('2026-09-23');
  });

  test('si el corte de hoy no se ha hecho, se puede continuar con normalidad', async () => {
    await abrirConResumen({
      total_manifiestos: 4,
      ajustes_pendientes: 0,
      totales_reportados: {},
      cierre_de_hoy_realizado: false,
      siguiente_fecha_corte: '2026-09-22',
      ultimo_cierre: { fecha_corte: '2026-09-21' },
    });
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    expect(modal.querySelector('#conci-cierre-ya-cerrado').classList.contains('d-none')).toBe(true);
    expect(modal.querySelector('#conci-cierre-continuar').disabled).toBe(false);
    expect(modal.querySelector('#conci-cierre-fecha-1').textContent).toBe('2026-09-22');
  });

  test('el aviso se limpia al reabrir el modal: no se queda pegado de una apertura anterior', async () => {
    await abrirConResumen({
      total_manifiestos: 1, ajustes_pendientes: 0, totales_reportados: {},
      cierre_de_hoy_realizado: true, siguiente_fecha_corte: '2026-09-23',
      ultimo_cierre: { fecha_corte: '2026-09-22' },
    });
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    expect(modal.querySelector('#conci-cierre-continuar').disabled).toBe(true);

    // Reabrir tras un cierre de otro día: el resumen ya dice que se puede.
    window.supabaseClient.rpc = jest.fn(async (nombre) => (
      nombre === 'conciliacion_resumen_lote_abierto'
        ? { data: { total_manifiestos: 2, ajustes_pendientes: 0, totales_reportados: {},
                    cierre_de_hoy_realizado: false, siguiente_fecha_corte: '2026-09-23' }, error: null }
        : { data: null, error: null }
    ));
    window.conciCierreSubsecretaria.abrirModalCierre();
    await esperar();
    await esperar();

    expect(modal.querySelector('#conci-cierre-ya-cerrado').classList.contains('d-none')).toBe(true);
    expect(modal.querySelector('#conci-cierre-continuar').disabled).toBe(false);
  });

  test('el servidor sigue siendo quien rechaza: su error se muestra tal cual', async () => {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    const falso = crearClienteFalso({
      rpcRespuestas: {
        // El resumen dice que se puede (por ejemplo, otro usuario cerró justo
        // ahora y este cliente todavía no se había enterado).
        conciliacion_resumen_lote_abierto: {
          data: { total_manifiestos: 1, ajustes_pendientes: 0, totales_reportados: {},
                  cierre_de_hoy_realizado: false, siguiente_fecha_corte: '2026-09-22' },
          error: null,
        },
        conciliacion_cerrar_subsecretaria: {
          data: null,
          error: { message: 'Ya se realizó el Cierre de Subsecretaría del 22/09/2026. Lo capturado después y las correcciones autorizadas después entrarán al siguiente cierre, el del 23/09/2026.' },
        },
      },
    });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    window.conciCierreSubsecretaria.abrirModalCierre();
    await esperar();

    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    modal.querySelector('#conci-cierre-continuar').click();
    modal.querySelector('#conci-cierre-password').value = 'secreta';
    modal.querySelector('#conci-cierre-confirmar').click();
    await esperar();
    await esperar();

    expect(modal.querySelector('#conci-cierre-msg').textContent).toMatch(/Ya se realizó el Cierre de Subsecretaría del 22\/09\/2026/);
    expect(modal.querySelector('#conci-cierre-msg').textContent).toMatch(/23\/09\/2026/);
  });
});

describe('doble confirmación y contraseña del cierre', () => {
  function abrirCierre() {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    const falso = crearClienteFalso({
      rpcRespuestas: {
        conciliacion_cerrar_subsecretaria: {
          data: { cierre_id: 1, fecha_corte: '2026-09-22', total_manifiestos: 12, total_ajustes_consumidos: 2 },
          error: null,
        },
      },
    });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    window.conciCierreSubsecretaria.abrirModalCierre();
    return falso;
  }

  test('el primer paso no pide contraseña y el segundo sí: no se puede saltar la confirmación 1', () => {
    abrirCierre();
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    expect(modal).toBeTruthy();
    // Paso 1 visible, paso 2 (contraseña) oculto.
    expect(modal.querySelector('#conci-cierre-paso-1').classList.contains('d-none')).toBe(false);
    expect(modal.querySelector('#conci-cierre-paso-2').classList.contains('d-none')).toBe(true);
    // El botón de confirmar definitivo tampoco está disponible todavía.
    expect(modal.querySelector('#conci-cierre-confirmar').classList.contains('d-none')).toBe(true);

    modal.querySelector('#conci-cierre-continuar').click();

    expect(modal.querySelector('#conci-cierre-paso-2').classList.contains('d-none')).toBe(false);
    expect(modal.querySelector('#conci-cierre-confirmar').classList.contains('d-none')).toBe(false);
    expect(modal.querySelector('#conci-cierre-password').type).toBe('password');
  });

  test('sin contraseña no se llama al RPC', async () => {
    const falso = abrirCierre();
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    modal.querySelector('#conci-cierre-continuar').click();
    modal.querySelector('#conci-cierre-confirmar').click();
    await esperar();

    expect(falso.llamadas.signIn).toHaveLength(0);
    expect(falso.llamadas.rpc.filter(r => r.nombre === 'conciliacion_cerrar_subsecretaria')).toHaveLength(0);
    expect(modal.querySelector('#conci-cierre-msg').textContent).toMatch(/contraseña/i);
  });

  test('con contraseña correcta reautentica y luego llama al RPC, en ese orden', async () => {
    const falso = abrirCierre();
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    modal.querySelector('#conci-cierre-continuar').click();
    modal.querySelector('#conci-cierre-password').value = 'secreta';
    modal.querySelector('#conci-cierre-confirmar').click();
    await esperar();
    await esperar();

    expect(falso.llamadas.signIn).toHaveLength(1);
    expect(falso.llamadas.signIn[0].email).toBe('usuario@aifa.test');
    const cierres = falso.llamadas.rpc.filter(r => r.nombre === 'conciliacion_cerrar_subsecretaria');
    expect(cierres).toHaveLength(1);
    // El RPC ya no acepta fecha: no se le manda ningún argumento. Así no hay
    // nada que un usuario con privilegio de cierre pueda alterar desde
    // DevTools para fechar un corte en el pasado.
    expect(cierres[0].params).toBeUndefined();
  });

  test('contraseña incorrecta: no se llama al RPC de cierre y se avisa del error', async () => {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    const falso = crearClienteFalso({ authError: { message: 'Invalid login credentials' } });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    window.conciCierreSubsecretaria.abrirModalCierre();

    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    modal.querySelector('#conci-cierre-continuar').click();
    modal.querySelector('#conci-cierre-password').value = 'equivocada';
    modal.querySelector('#conci-cierre-confirmar').click();
    await esperar();
    await esperar();

    expect(falso.llamadas.signIn).toHaveLength(1);
    expect(falso.llamadas.rpc.filter(r => r.nombre === 'conciliacion_cerrar_subsecretaria')).toHaveLength(0);
    expect(modal.querySelector('#conci-cierre-msg').textContent).toMatch(/incorrecta/i);
  });

  test('la contraseña se borra del input después de intentarlo (acierte o falle)', async () => {
    const falso = abrirCierre();
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    modal.querySelector('#conci-cierre-continuar').click();
    const pw = modal.querySelector('#conci-cierre-password');
    pw.value = 'secreta';
    modal.querySelector('#conci-cierre-confirmar').click();
    await esperar();
    await esperar();

    expect(pw.value).toBe('');
    expect(falso.llamadas.signIn).toHaveLength(1);
  });

  test('la contraseña nunca viaja al RPC ni se guarda en storage', async () => {
    // Token deliberadamente improbable: "secreta" sería un falso positivo,
    // porque aparece dentro de "conciliacion_cerrar_subSECRETAria".
    const CLAVE = 'Zx9-clave-de-prueba-unica';
    const falso = abrirCierre();
    const modal = document.getElementById('modal-conci-cierre-subsecretaria');
    modal.querySelector('#conci-cierre-continuar').click();
    modal.querySelector('#conci-cierre-password').value = CLAVE;
    modal.querySelector('#conci-cierre-confirmar').click();
    await esperar();
    await esperar();

    // Sí llegó a signInWithPassword (única vía legítima) …
    expect(falso.llamadas.signIn[0].password).toBe(CLAVE);
    // … y a ningún otro lado.
    expect(JSON.stringify(falso.llamadas.rpc)).not.toMatch(CLAVE);
    expect(JSON.stringify(window.localStorage)).not.toMatch(CLAVE);
    expect(JSON.stringify(window.sessionStorage)).not.toMatch(CLAVE);
    expect(document.body.innerHTML).not.toMatch(CLAVE);
  });
});

describe('FIJO / PREVIO / TOTAL sin doble conteo', () => {
  async function pintar({ resumen, filas }) {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    const falso = crearClienteFalso({
      rpcRespuestas: {
        conciliacion_resumen_lote_abierto: { data: resumen, error: null },
        conciliacion_solicitudes_pendientes: { data: [], error: null },
      },
    });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    window._conciCierreOnSummaryData(filas, []);
    await esperar();
    await esperar();
    return falso;
  }

  const leer = (id) => document.getElementById(id).textContent;

  test('solo precarga: PREVIO 150, FIJO 0, TOTAL 150 (escenario A)', async () => {
    await pintar({
      resumen: { total_manifiestos: 0, ajustes_pendientes: 0, totales_reportados: {} },
      filas: [{ id: '', _fuente: 'Solo Vuelos', 'TOTAL PAX': 150 }],
    });
    expect(leer('mf-cierre-previo')).toBe('150');
    expect(leer('mf-cierre-fijo')).toBe('0');
    expect(leer('mf-cierre-total')).toBe('150');
  });

  test('capturado el manifiesto real: PREVIO 0, FIJO 145, TOTAL 145 — nunca 295 (escenario B)', async () => {
    await pintar({
      resumen: { total_manifiestos: 1, ajustes_pendientes: 0, totales_reportados: { 'TOTAL PAX': 145 } },
      // El vuelo ya no aparece como "Solo Vuelos": lo consumió el manifiesto.
      filas: [{ id: '77', 'TOTAL PAX': 145 }],
    });
    expect(leer('mf-cierre-previo')).toBe('0');
    expect(leer('mf-cierre-fijo')).toBe('145');
    expect(leer('mf-cierre-total')).toBe('145');
  });

  test('capturado 1000 + ajustes pendientes +5 y previo 100: FIJO 1005, TOTAL 1105 (escenario H)', async () => {
    await pintar({
      // El servidor ya entrega lote+ajustes en totales_reportados, con la MISMA
      // aritmética que el informe verá después del corte.
      resumen: {
        total_manifiestos: 1,
        ajustes_pendientes: 1,
        totales_fijo: { 'TOTAL PAX': 1000 },
        totales_ajustes: { 'TOTAL PAX': 5 },
        totales_reportados: { 'TOTAL PAX': 1005 },
      },
      filas: [
        { id: '1', 'TOTAL PAX': 1000 },
        { id: '', _fuente: 'Solo Vuelos', 'TOTAL PAX': 100 },
      ],
    });
    expect(leer('mf-cierre-fijo')).toBe('1,005');
    expect(leer('mf-cierre-previo')).toBe('100');
    expect(leer('mf-cierre-total')).toBe('1,105');
  });

  test('+30 y -10 pendientes antes del corte se reflejan netos (+20) sobre lo capturado', async () => {
    await pintar({
      resumen: {
        total_manifiestos: 1,
        ajustes_pendientes: 2,
        totales_fijo: { 'TOTAL PAX': 1000 },
        totales_ajustes: { 'TOTAL PAX': 20 },
        totales_reportados: { 'TOTAL PAX': 1020 },
      },
      filas: [{ id: '1', 'TOTAL PAX': 1000 }],
    });
    expect(leer('mf-cierre-fijo')).toBe('1,020');
  });

  test('FIJO es el LOTE pendiente, no lo que hay en pantalla: un manifiesto ya cerrado no lo infla', async () => {
    // La fila viva dice 180 porque se corrigió después del corte, pero ya está
    // cerrada (cierre_id): no pertenece al lote y el servidor no la cuenta. El
    // +30 de esa corrección viaja por totales_ajustes, una sola vez.
    await pintar({
      resumen: {
        total_manifiestos: 0,
        ajustes_pendientes: 1,
        totales_fijo: {},
        totales_ajustes: { 'TOTAL PAX': 30 },
        totales_reportados: { 'TOTAL PAX': 30 },
        ultimo_cierre: {
          cierre_id: 4, fecha_corte: '2026-09-21', cerrado_por_nombre: 'Jefa en turno',
          total_manifiestos: 12, totales_reportados: { 'TOTAL PAX': 150 },
        },
      },
      filas: [{ id: '9', cierre_id: 4, 'TOTAL PAX': 180 }],
    });
    expect(leer('mf-cierre-fijo')).toBe('30');
    // Y la tarjeta explica de dónde sale, incluido el último corte realizado.
    const titulo = document.getElementById('mf-cierre-card-fijo').title;
    expect(titulo).toMatch(/Lote pendiente/i);
    expect(titulo).toMatch(/1 ajuste/);
    expect(titulo).toMatch(/2026-09-21/);
  });

  test('la tarjeta avisa cuando todavía no se ha hecho ningún corte', async () => {
    await pintar({
      resumen: { total_manifiestos: 3, ajustes_pendientes: 0, totales_reportados: { 'TOTAL PAX': 10 } },
      filas: [{ id: '1', 'TOTAL PAX': 10 }],
    });
    expect(document.getElementById('mf-cierre-card-fijo').title)
      .toMatch(/Todavía no se ha realizado ningún Cierre de Subsecretaría/);
  });

  test('las filas "Solo Vuelos" sin TOTAL PAX no rompen la suma de PREVIO', async () => {
    await pintar({
      resumen: { total_manifiestos: 0, ajustes_pendientes: 0, totales_reportados: {} },
      filas: [
        { id: '', _fuente: 'Solo Vuelos', 'TOTAL PAX': '' },
        { id: '', _fuente: 'Solo Vuelos' },
        { id: '', _fuente: 'Solo Vuelos', 'TOTAL PAX': 40 },
      ],
    });
    expect(leer('mf-cierre-previo')).toBe('40');
  });

  test('el resumen del lote se pide SIN fecha: el lote no es un día', async () => {
    const falso = await pintar({
      resumen: { total_manifiestos: 1, ajustes_pendientes: 0, totales_reportados: { 'TOTAL PAX': 1 } },
      filas: [{ id: '1', 'TOTAL PAX': 1 }],
    });
    const llamadas = falso.llamadas.rpc.filter(r => r.nombre === 'conciliacion_resumen_lote_abierto');
    expect(llamadas.length).toBeGreaterThan(0);
    llamadas.forEach(l => expect(l.params).toBeUndefined());
    expect(falso.llamadas.rpc.some(r => r.nombre === 'conciliacion_resumen_periodo')).toBe(false);
  });
});

describe('candado por fila y hooks', () => {
  test('el hook de fila marca como cerrado solo los manifiestos con cierre_id', async () => {
    configurarUsuario({ rol: 'capturista' });
    window.supabaseClient = crearClienteFalso({
      rpcRespuestas: { conciliacion_resumen_lote_abierto: { data: { cerrado: false, totales_reportados: {} }, error: null } },
    }).cliente;
    cargarModulo();
    window._conciCierreOnSummaryData([
      { id: '10', cierre_id: 3, 'TOTAL PAX': 5 },
      { id: '11', cierre_id: null, 'TOTAL PAX': 5 },
    ], []);
    await esperar();

    const grupoCerrado = document.createElement('div');
    window._conciCierreExtraRowAction(grupoCerrado, '10');
    expect(grupoCerrado.querySelector('.fa-lock')).toBeTruthy();

    const grupoAbierto = document.createElement('div');
    window._conciCierreExtraRowAction(grupoAbierto, '11');
    expect(grupoAbierto.children).toHaveLength(0);
  });

  test('un capturista ve el candado deshabilitado; quien puede corregir ve un botón accionable', async () => {
    // Sin permiso de captura: candado informativo, no accionable.
    configurarUsuario({ rol: 'lector', nivelSeccion: 'read' });
    window._conciCanCurrentUserEdit = () => false;
    window.supabaseClient = crearClienteFalso().cliente;
    cargarModulo();
    window._conciCierreOnSummaryData([{ id: '10', cierre_id: 3 }], []);
    await esperar();

    const grupo = document.createElement('div');
    window._conciCierreExtraRowAction(grupo, '10');
    expect(grupo.querySelector('span.disabled')).toBeTruthy();
    expect(grupo.querySelector('button')).toBeNull();
  });

  test('el módulo expone ambos hooks en window para que script.js los encuentre', () => {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    window.supabaseClient = crearClienteFalso().cliente;
    cargarModulo();
    expect(typeof window._conciCierreOnSummaryData).toBe('function');
    expect(typeof window._conciCierreExtraRowAction).toBe('function');
  });
});

describe('resistencia: el módulo nunca debe tumbar Manifiestos', () => {
  test('si el RPC de resumen falla, las tarjetas no revientan y el resto sigue', async () => {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    window.supabaseClient = crearClienteFalso({
      rpcRespuestas: { conciliacion_resumen_lote_abierto: { data: null, error: { message: 'boom' } } },
    }).cliente;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    cargarModulo();

    expect(() => window._conciCierreOnSummaryData([{ id: '1', 'TOTAL PAX': 10 }], [])).not.toThrow();
    await esperar();
    await esperar();
    // PREVIO se calcula en el cliente y sigue disponible aunque el RPC falle.
    expect(document.getElementById('mf-cierre-previo').textContent).toBe('0');
    console.warn.mockRestore();
  });

  test('sin cliente de Supabase el módulo carga sin lanzar excepciones', () => {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    window.supabaseClient = undefined;
    expect(() => cargarModulo()).not.toThrow();
    expect(() => window._conciCierreOnSummaryData([{ id: '1' }], [])).not.toThrow();
  });

  test('sin los botones en el DOM (otra pantalla) el init no falla', () => {
    document.body.innerHTML = '';
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    window.supabaseClient = crearClienteFalso().cliente;
    expect(() => cargarModulo()).not.toThrow();
  });
});

describe('bandeja de solicitudes: confirmación con contraseña enmascarada', () => {
  async function abrirBandeja(solicitudes) {
    configurarUsuario({ rol: 'admin', nivelSeccion: 'admin' });
    const falso = crearClienteFalso({
      rpcRespuestas: {
        conciliacion_solicitudes_pendientes: { data: solicitudes, error: null },
        conciliacion_resolver_solicitud_correccion: { data: { estado: 'aplicada' }, error: null },
      },
    });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    await window.conciCierreSubsecretaria.abrirModalSolicitudes();
    await esperar();
    return falso;
  }

  const solicitudEjemplo = {
    id: 7,
    manifiesto_id: 321,
    campo: 'TOTAL PAX',
    valor_anterior: '150',
    valor_nuevo: '180',
    diferencia: 30,
    motivo: 'Conteo corregido por la aerolínea',
    usuario_modifica_nombre: 'Capturista Uno',
    creado_en: '2026-09-22T10:00:00Z',
  };

  test('la contraseña se pide en un campo enmascarado, nunca con prompt()', async () => {
    await abrirBandeja([solicitudEjemplo]);
    const item = document.querySelector('.conci-sol-item');
    expect(item).toBeTruthy();
    item.querySelector('[data-sol-pedir="aprobar"]').click();

    const pw = item.querySelector('.conci-sol-password');
    expect(pw).toBeTruthy();
    expect(pw.type).toBe('password');
    // El módulo no usa prompt() (que mostraría la contraseña en claro).
    expect(moduleSource).not.toMatch(/\bprompt\s*\(/);
  });

  test('confirmar aprueba: reautentica, llama al RPC con el id y limpia la contraseña', async () => {
    const falso = await abrirBandeja([solicitudEjemplo]);
    const item = document.querySelector('.conci-sol-item');
    item.querySelector('[data-sol-pedir="aprobar"]').click();
    const pw = item.querySelector('.conci-sol-password');
    pw.value = 'secreta';
    item.querySelector('.conci-sol-comentario').value = 'Autorizado por jefatura';
    item.querySelector('[data-sol-ejecutar]').click();
    await esperar();
    await esperar();

    expect(falso.llamadas.signIn).toHaveLength(1);
    const resolver = falso.llamadas.rpc.find(r => r.nombre === 'conciliacion_resolver_solicitud_correccion');
    expect(resolver.params).toEqual({
      p_solicitud_id: 7,
      p_aprobar: true,
      p_comentario: 'Autorizado por jefatura',
    });
    expect(pw.value).toBe('');
    expect(JSON.stringify(falso.llamadas.rpc)).not.toMatch(/secreta/);
  });

  test('rechazar envía p_aprobar=false', async () => {
    const falso = await abrirBandeja([solicitudEjemplo]);
    const item = document.querySelector('.conci-sol-item');
    item.querySelector('[data-sol-pedir="rechazar"]').click();
    item.querySelector('.conci-sol-password').value = 'secreta';
    item.querySelector('[data-sol-ejecutar]').click();
    await esperar();
    await esperar();

    const resolver = falso.llamadas.rpc.find(r => r.nombre === 'conciliacion_resolver_solicitud_correccion');
    expect(resolver.params.p_aprobar).toBe(false);
  });

  test('cancelar borra la contraseña escrita y no llama a nada', async () => {
    const falso = await abrirBandeja([solicitudEjemplo]);
    const item = document.querySelector('.conci-sol-item');
    item.querySelector('[data-sol-pedir="aprobar"]').click();
    const pw = item.querySelector('.conci-sol-password');
    pw.value = 'secreta';
    item.querySelector('[data-sol-cancelar]').click();

    expect(pw.value).toBe('');
    expect(falso.llamadas.signIn).toHaveLength(0);
    expect(falso.llamadas.rpc.some(r => r.nombre === 'conciliacion_resolver_solicitud_correccion')).toBe(false);
  });

  test('sin contraseña no se resuelve nada', async () => {
    const falso = await abrirBandeja([solicitudEjemplo]);
    const item = document.querySelector('.conci-sol-item');
    item.querySelector('[data-sol-pedir="aprobar"]').click();
    item.querySelector('[data-sol-ejecutar]').click();
    await esperar();

    expect(falso.llamadas.signIn).toHaveLength(0);
    expect(falso.llamadas.rpc.some(r => r.nombre === 'conciliacion_resolver_solicitud_correccion')).toBe(false);
    expect(item.querySelector('.conci-sol-resultado').textContent).toMatch(/contraseña/i);
  });
});

describe('corrección de un manifiesto cerrado', () => {
  async function abrirCorreccion({ rol, permisos }) {
    configurarUsuario({ rol, permisos, nivelSeccion: rol === 'admin' ? 'admin' : 'capture' });
    const falso = crearClienteFalso({
      rpcRespuestas: {
        conciliacion_solicitar_correccion: { data: { estado: 'pendiente', diferencia: 30 }, error: null },
        conciliacion_solicitudes_pendientes: { data: [], error: null },
      },
    });
    window.supabaseClient = falso.cliente;
    cargarModulo();
    window.conciCierreSubsecretaria.abrirModalCorreccion({ manifiestoId: '321' });
    return falso;
  }

  test('un capturista sin privilegio no ve el campo de contraseña: su envío es solo una solicitud', async () => {
    await abrirCorreccion({ rol: 'capturista', permisos: {} });
    const modal = document.getElementById('modal-conci-correccion-cerrado');
    expect(modal.querySelector('#conci-corr-password-grp').classList.contains('d-none')).toBe(true);
    expect(modal.querySelector('#conci-corr-confirmar').textContent).toMatch(/solicitud/i);
    expect(modal.querySelector('#conci-corr-aviso').textContent).toMatch(/SOLICITUD/);
  });

  test('quien puede autorizar sí debe confirmar contraseña, porque se aplica de inmediato', async () => {
    await abrirCorreccion({ rol: 'admin', permisos: {} });
    const modal = document.getElementById('modal-conci-correccion-cerrado');
    expect(modal.querySelector('#conci-corr-password-grp').classList.contains('d-none')).toBe(false);
    expect(modal.querySelector('#conci-corr-confirmar').textContent).toMatch(/aplicar/i);
  });

  test('exige motivo antes de enviar nada', async () => {
    const falso = await abrirCorreccion({ rol: 'capturista', permisos: {} });
    const modal = document.getElementById('modal-conci-correccion-cerrado');
    modal.querySelector('#conci-corr-valor-nuevo').value = '180';
    modal.querySelector('#conci-corr-confirmar').click();
    await esperar();

    expect(falso.llamadas.rpc.some(r => r.nombre === 'conciliacion_solicitar_correccion')).toBe(false);
    expect(modal.querySelector('#conci-corr-msg').textContent).toMatch(/motivo/i);
  });

  test('la solicitud viaja con manifiesto, campo, valor y motivo (sin contraseña)', async () => {
    const falso = await abrirCorreccion({ rol: 'capturista', permisos: {} });
    const modal = document.getElementById('modal-conci-correccion-cerrado');
    modal.querySelector('#conci-corr-campo').value = 'TOTAL PAX';
    modal.querySelector('#conci-corr-valor-nuevo').value = '180';
    modal.querySelector('#conci-corr-motivo').value = 'Conteo corregido';
    modal.querySelector('#conci-corr-confirmar').click();
    await esperar();
    await esperar();

    const envio = falso.llamadas.rpc.find(r => r.nombre === 'conciliacion_solicitar_correccion');
    expect(envio.params).toEqual({
      p_manifiesto_id: 321,
      p_campo: 'TOTAL PAX',
      p_valor_nuevo: '180',
      p_motivo: 'Conteo corregido',
    });
    // Sin privilegio no hubo reautenticación: todavía no se escribe nada.
    expect(falso.llamadas.signIn).toHaveLength(0);
    expect(modal.querySelector('#conci-corr-msg').textContent).toMatch(/solicitud enviada/i);
  });
});
