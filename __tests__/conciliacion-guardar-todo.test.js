/**
 * @jest-environment jsdom
 *
 * Botón "Guardar todo" (Ctrl+G) de Conciliación Manifiestos.
 *
 * La captura ya se guarda sola, pero por fila y con 400 ms de retraso, y una
 * fila que falló espera hasta dos minutos a su siguiente reintento. Sin una
 * forma de decir "guarda TODO ahora" no hay manera de cerrar la jornada con la
 * certeza de que nada quedó a medio camino, ni de forzar el reintento salvo
 * volviendo a tocar la celda a mano.
 *
 * Lo que se protege aquí:
 *   • que el botón mande a guardar lo pendiente sin esperar al autoguardado;
 *   • que informe contra el estado REAL de la tabla, no contra lo que intentó;
 *   • que una fecha u hora inválida detenga el guardado en vez de mandar basura;
 *   • que NO reescriba filas que nadie tocó — la tabla es colaborativa y eso
 *     pisaría capturas ajenas.
 */

const fs = require('fs');
const path = require('path');

const source = fs
  .readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8')
  .replace(/\r\n/g, '\n');

const html = fs
  .readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

function extraer(nombre) {
  const marca = source.includes(`async function ${nombre}(`)
    ? `async function ${nombre}(`
    : `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}

const espias = {
  avisos: [],
  guardadas: [],
  reintentos: 0,
  guardadoFalla: false,
  incompletas: 0,
};

const api = new Function('document', 'console', 'espias', `
  let _conciEditMode = true;
  let _conciPuedeEditar = true;
  let _conciPuedeAdministrar = true;
  let _conciGuardadoTotalEnCurso = false;
  function _conciCanCurrentUserEdit() { return _conciPuedeEditar; }
  function _conciCanCurrentUserManage() { return _conciPuedeAdministrar; }
  function showNotification(texto, tipo) { espias.avisos.push({ texto, tipo }); }
  function _conciProgramarReintento() { espias.reintentos++; }
  // Doble del autoguardado real: confirma lo capturado salvo que la prueba
  // pida simular que la base rechaza la escritura.
  async function _conciAutoSaveRow(tr, opciones) {
    espias.guardadas.push({ tr, opciones });
    if (espias.guardadoFalla) return;
    tr.querySelectorAll('td[data-dirty="1"]').forEach(td => td.removeAttribute('data-dirty'));
    tr.removeAttribute('data-dirty');
  }
  // Marcado de filas incompletas: aqui se dobla a "ninguna incompleta" para no
  // mezclar dos cosas. Estas pruebas comprueban el CONTEO de lo guardado; el
  // aviso de fila incompleta se cubre en conciliacion-fila-incompleta.
  const _CONCI_COLUMNAS_OBLIGATORIAS = ['AEROLINEA', 'MATRICULA', 'TIPO DE OPERACIÓN'];
  function _conciMarcarFilasIncompletas() { return espias.incompletas || 0; }
  ${extraer('_conciContarCeldasSinGuardar')}
  ${extraer('_conciFilasPorGuardar')}
  ${extraer('_conciActualizarBotonGuardarTodo')}
  ${extraer('_conciEsperarEscriturasEnVuelo')}
  ${extraer('_conciGuardarTodoAhora')}
  return {
    _conciContarCeldasSinGuardar, _conciFilasPorGuardar,
    _conciActualizarBotonGuardarTodo, _conciGuardarTodoAhora,
    modoCaptura: (v) => { _conciEditMode = v; },
    permiso: (v) => { _conciPuedeEditar = v; },
    permisoAdmin: (v) => { _conciPuedeAdministrar = v; },
  };
`)(document, console, espias);

/** Barra + tabla, con una fila por descripción. */
function pintar(filas) {
  document.body.innerHTML = `
    <div class="btn-group d-none" id="grp-conci-save-all">
      <button id="btn-conci-save-all" class="btn btn-outline-success">
        Guardar todo <span id="badge-conci-save-all" class="badge d-none">0</span>
      </button>
      <button id="btn-conci-save-all-more" class="btn btn-outline-success dropdown-toggle-split"></button>
    </div>
    <table id="table-conci-manifiestos"><tbody></tbody></table>`;
  const tbody = document.querySelector('#table-conci-manifiestos tbody');
  return filas.map(({ rowId = '', nueva = false, descartada = false, sucias = [], fuente = '' }) => {
    const tr = document.createElement('tr');
    if (rowId) tr.dataset.rowId = rowId;
    if (nueva) tr.dataset.conciNew = '1';
    if (descartada) tr.dataset.conciDescartada = '1';
    if (fuente) tr.dataset.rowFuente = fuente;
    ['TOTAL PAX', 'OBSERVACIONES'].forEach(col => {
      const td = document.createElement('td');
      td.dataset.col = col;
      if (sucias.includes(col)) {
        td.dataset.dirty = '1';
        tr.dataset.dirty = '1';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    return tr;
  });
}

const grupo = () => document.getElementById('grp-conci-save-all');
const boton = () => document.getElementById('btn-conci-save-all');
const caret = () => document.getElementById('btn-conci-save-all-more');
const insignia = () => document.getElementById('badge-conci-save-all');

beforeEach(() => {
  espias.avisos.length = 0;
  espias.guardadas.length = 0;
  espias.reintentos = 0;
  espias.guardadoFalla = false;
  api.modoCaptura(true);
  api.permiso(true);
  api.permisoAdmin(true);
  document.body.innerHTML = '';
});

describe('el botón está en la barra', () => {
  test('existe junto al resto de acciones de captura y anuncia el atajo', () => {
    expect(html).toContain('id="btn-conci-save-all"');
    expect(html).toContain('id="badge-conci-save-all"');
    const marca = html.indexOf('id="btn-conci-save-all"');
    const titulo = html.slice(marca - 200, marca + 200);
    expect(titulo).toContain('Ctrl+G');
  });

  test('nace oculto y así se queda', () => {
    const marca = html.indexOf('id="grp-conci-save-all"');
    expect(marca).toBeGreaterThan(-1);
    expect(html.slice(marca - 120, marca)).toContain('d-none');
  });

  test('la reescritura completa vive en el desplegable y avisa del riesgo', () => {
    expect(html).toContain('id="btn-conci-rewrite-all"');
    const marca = html.indexOf('id="btn-conci-rewrite-all"');
    const bloque = html.slice(marca - 600, marca + 200);
    // Marcada en rojo y con puntos suspensivos: no es un guardado más.
    expect(bloque).toContain('text-danger');
    expect(bloque).toContain('Reescribir todas las filas…');
    expect(bloque).toContain('Puede reemplazar capturas de tus compañeros');
  });
});

describe('qué se manda a guardar', () => {
  test('cuenta las celdas capturadas que la base aún no confirmó', () => {
    pintar([
      { rowId: '1', sucias: ['TOTAL PAX'] },
      { rowId: '2', sucias: ['TOTAL PAX', 'OBSERVACIONES'] },
      { rowId: '3' },
    ]);
    expect(api._conciContarCeldasSinGuardar()).toBe(3);
  });

  test('incluye las filas con capturas pendientes y las filas nuevas', () => {
    const [sucia, nueva, limpia] = pintar([
      { rowId: '1', sucias: ['OBSERVACIONES'] },
      { nueva: true },
      { rowId: '3' },
    ]);
    const filas = api._conciFilasPorGuardar();
    expect(filas).toContain(sucia);
    expect(filas).toContain(nueva);
    expect(filas).not.toContain(limpia);
  });

  test('una fila descartada no revive: nunca se vuelve a guardar', () => {
    const [descartada] = pintar([{ nueva: true, descartada: true, sucias: ['TOTAL PAX'] }]);
    expect(api._conciFilasPorGuardar()).not.toContain(descartada);
  });

  test('no reescribe filas que nadie tocó', async () => {
    const [sucia] = pintar([
      { rowId: '1', sucias: ['TOTAL PAX'] },
      { rowId: '2' },
      { rowId: '3' },
    ]);
    await api._conciGuardarTodoAhora();
    expect(espias.guardadas).toHaveLength(1);
    expect(espias.guardadas[0].tr).toBe(sucia);
  });
});

// Guardado y COMPLETO no son lo mismo: lo capturado se persiste siempre, pero
// una fila a la que le faltan campos obligatorios no puede darse por cerrada en
// silencio. El detector real se prueba en conciliacion-fila-incompleta.
describe('filas incompletas al terminar de guardar', () => {
  test('avisa cuántas quedaron incompletas en vez de decir que todo salió bien', async () => {
    espias.incompletas = 2;
    pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);

    await api._conciGuardarTodoAhora();

    const ultimo = espias.avisos.at(-1);
    expect(ultimo.tipo).toBe('warning');
    expect(ultimo.texto).toContain('2 filas incompletas');
  });

  test('con una sola lo dice en singular', async () => {
    espias.incompletas = 1;
    pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);

    await api._conciGuardarTodoAhora();

    expect(espias.avisos.at(-1).texto).toContain('1 fila incompleta');
  });

  test('el aviso dice QUÉ falta, no sólo que falta algo', async () => {
    espias.incompletas = 1;
    pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);

    await api._conciGuardarTodoAhora();

    const texto = espias.avisos.at(-1).texto;
    expect(texto).toContain('AEROLINEA');
    expect(texto).toContain('MATRICULA');
  });

  test('sin filas incompletas el aviso sigue siendo de éxito', async () => {
    espias.incompletas = 0;
    pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);

    await api._conciGuardarTodoAhora();

    expect(espias.avisos.at(-1).tipo).toBe('success');
  });
});

describe('guarda sin esperar al autoguardado', () => {
  test('adelanta el temporizador de la fila en vez de esperar su turno', async () => {
    const [tr] = pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);
    tr._conciAutoSaveTimer = setTimeout(() => {}, 100000);

    await api._conciGuardarTodoAhora();

    expect(tr._conciAutoSaveTimer).toBeNull();
    expect(espias.guardadas).toHaveLength(1);
  });

  test('confirma con el número de capturas que la base aceptó', async () => {
    pintar([{ rowId: '7', sucias: ['TOTAL PAX', 'OBSERVACIONES'] }]);
    await api._conciGuardarTodoAhora();

    expect(espias.avisos.at(-1)).toEqual({
      texto: 'Guardado: 2 capturas confirmadas por la base.',
      tipo: 'success',
    });
  });

  test('sin nada pendiente lo dice y no escribe en la base', async () => {
    pintar([{ rowId: '7' }]);
    await api._conciGuardarTodoAhora();

    expect(espias.guardadas).toHaveLength(0);
    expect(espias.avisos.at(-1).tipo).toBe('info');
    expect(espias.avisos.at(-1).texto).toContain('todo está guardado');
  });
});

describe('cuando algo no se pudo guardar', () => {
  test('avisa qué quedó pendiente y deja el reintento programado', async () => {
    pintar([{ rowId: '7', sucias: ['TOTAL PAX', 'OBSERVACIONES'] }]);
    espias.guardadoFalla = true;

    await api._conciGuardarTodoAhora();

    const aviso = espias.avisos.at(-1);
    expect(aviso.tipo).toBe('warning');
    expect(aviso.texto).toContain('quedan 2 sin confirmar');
    expect(espias.reintentos).toBe(1);
  });

  test('una fecha u hora inválida detiene el guardado antes de escribir', async () => {
    const [tr] = pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);
    tr.querySelector('td[data-col="TOTAL PAX"]')._conciCloseEditor = () => false;

    await api._conciGuardarTodoAhora();

    expect(espias.guardadas).toHaveLength(0);
    expect(espias.avisos.at(-1).tipo).toBe('error');
    expect(espias.avisos.at(-1).texto).toContain('Corrige la fecha u hora');
  });

  test('los editores abiertos se cierran ACEPTANDO lo tecleado', async () => {
    const [tr] = pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);
    const recibido = [];
    tr.querySelector('td[data-col="TOTAL PAX"]')._conciCloseEditor = (aceptar) => {
      recibido.push(aceptar);
      return true;
    };

    await api._conciGuardarTodoAhora();
    expect(recibido).toEqual([true]);
  });
});

describe('permisos y modo de captura', () => {
  test('fuera del modo captura no escribe nada', async () => {
    pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);
    api.modoCaptura(false);

    await api._conciGuardarTodoAhora();
    expect(espias.guardadas).toHaveLength(0);
    expect(espias.avisos.at(-1).tipo).toBe('info');
  });

  test('sin permiso de captura lo rechaza explícitamente', async () => {
    pintar([{ rowId: '7', sucias: ['TOTAL PAX'] }]);
    api.permiso(false);

    await api._conciGuardarTodoAhora();
    expect(espias.guardadas).toHaveLength(0);
    expect(espias.avisos.at(-1).tipo).toBe('error');
  });
});

describe('el botón no se pinta en la barra', () => {
  // Operaciones pidió quitarlo de la vista: la captura se guarda sola celda a
  // celda, y un botón de guardar al lado hacía dudar de si lo tecleado ya
  // estaba en la base. El guardado a mano NO se retiró — vive en Ctrl+G y en
  // window.conciGuardarTodo, y el resto de este archivo lo sigue cubriendo.
  test('sigue oculto aunque haya capturas sin confirmar', () => {
    pintar([{ rowId: '1', sucias: ['TOTAL PAX', 'OBSERVACIONES'] }]);
    api._conciActualizarBotonGuardarTodo();

    expect(grupo().classList.contains('d-none')).toBe(true);
    // Ni el contador amarillo: no hay nada visible que lo muestre.
    expect(insignia().classList.contains('d-none')).toBe(true);
  });

  test('sigue oculto sin nada pendiente', () => {
    pintar([{ rowId: '1' }]);
    api._conciActualizarBotonGuardarTodo();

    expect(grupo().classList.contains('d-none')).toBe(true);
  });

  test('se esconde fuera del modo captura', () => {
    pintar([{ rowId: '1', sucias: ['TOTAL PAX'] }]);
    api.modoCaptura(false);
    api._conciActualizarBotonGuardarTodo();

    expect(grupo().classList.contains('d-none')).toBe(true);
  });

  test('la reescritura completa tampoco asoma para un capturista', () => {
    pintar([{ rowId: '1', sucias: ['TOTAL PAX'] }]);
    api.permisoAdmin(false);
    api._conciActualizarBotonGuardarTodo();

    expect(grupo().classList.contains('d-none')).toBe(true);
    expect(caret().classList.contains('d-none')).toBe(true);
  });
});

describe('atajo Ctrl+G', () => {
  test('está registrado y sólo actúa dentro de la pestaña de manifiestos', () => {
    const inicio = source.indexOf("if (String(event.key || '').toLowerCase() !== 'g') return;");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = source.slice(inicio - 400, inicio + 600);
    expect(bloque).toContain('conciliacion-section');
    expect(bloque).toContain('pane-conci-comercial');
    expect(bloque).toContain('_conciGuardarTodoAhora()');
  });

  test('neutraliza el "buscar siguiente" del navegador para no duplicar la acción', () => {
    const inicio = source.indexOf("if (String(event.key || '').toLowerCase() !== 'g') return;");
    const bloque = source.slice(inicio, inicio + 600);
    expect(bloque).toContain('event.preventDefault()');
  });

  test('respeta Ctrl+Shift+G y Ctrl+Alt+G del navegador', () => {
    const inicio = source.indexOf("if (String(event.key || '').toLowerCase() !== 'g') return;");
    const bloque = source.slice(inicio - 300, inicio);
    expect(bloque).toContain('event.altKey || event.shiftKey');
  });
});

describe('el botón queda conectado', () => {
  test('el clic dispara el mismo guardado que el atajo', () => {
    expect(source).toContain("const btnConciSaveAll = document.getElementById('btn-conci-save-all');");
    expect(source).toContain("btnConciSaveAll.addEventListener('click', () => { _conciGuardarTodoAhora(); })");
  });

  test('la opción de reescritura también', () => {
    expect(source).toContain("const btnConciRewriteAll = document.getElementById('btn-conci-rewrite-all');");
    expect(source).toContain('_conciReescribirTodasLasFilas();');
  });
});

// ── Reescritura completa ─────────────────────────────────────────────────────
//
// Reenvía el contenido de cada fila visible para dejar la base igual a la
// pantalla. Es la operación que puede pisar el trabajo de un compañero, así que
// lo que se protege aquí es sobre todo lo que NO debe pasar sin avisar.

const espiasRw = {
  avisos: [],
  escrituras: [],
  recargas: 0,
  confirmado: true,
  textoConfirm: '',
  conectados: [],
  escrituraFalla: false,
};

const rw = new Function('document', 'window', 'console', 'confirm', 'espias', `
  let _conciEditMode = true;
  let _conciPuedeAdministrar = true;
  let _conciGuardadoTotalEnCurso = false;
  let _conciReescrituraEnCurso = false;
  let _conciRenderedKey = 'algo';
  const _conciRenderCache = new Map();
  function _conciCanCurrentUserManage() { return _conciPuedeAdministrar; }
  function showNotification(texto, tipo) { espias.avisos.push({ texto, tipo }); }
  function _conciNormalizeEditableCellText(v) { return String(v ?? '').trim(); }
  function _conciIsRoutingColumn(col) { return col === 'DESTINO / ORIGEN'; }
  function _conciIsCalculatedColumn(col) { return col === 'HRS. CUMPLIDAS' || col === 'TOTAL EXENTOS'; }
  function _conciShouldPersistCalculatedColumn(col) { return col === 'TOTAL EXENTOS'; }
  function _conciPrepareValueForDatabase(col, v) { return v; }
  function _conciPresenciaConectados() { return espias.conectados; }
  function _conciActualizarBotonGuardarTodo() {}
  async function loadConciliacionManifiestos() { espias.recargas++; }
  async function _conciWriteRowSafe(client, payload, rowId) {
    espias.escrituras.push({ rowId, payload });
    return espias.escrituraFalla
      ? { ok: false, error: { message: 'permiso denegado' } }
      : { ok: true, payload };
  }
  ${extraer('_conciRunBatchWrites')}
  ${extraer('_conciValorVisibleDeCelda')}
  ${extraer('_conciPayloadCompletoDeFila')}
  ${extraer('_conciFilasReescribibles')}
  ${extraer('_conciOtrosCapturando')}
  ${extraer('_conciAvisoReescritura')}
  ${extraer('_conciReescribirTodasLasFilas')}
  return {
    _conciPayloadCompletoDeFila, _conciFilasReescribibles,
    _conciAvisoReescritura, _conciReescribirTodasLasFilas,
    modoCaptura: (v) => { _conciEditMode = v; },
    permisoAdmin: (v) => { _conciPuedeAdministrar = v; },
  };
`)(document, window, console, (texto) => {
  espiasRw.textoConfirm = texto;
  return espiasRw.confirmado;
}, espiasRw);

/** Tabla con filas y valores por columna. */
function pintarRw(filas) {
  document.body.innerHTML = `
    <div id="grp-conci-save-all"><button id="btn-conci-save-all">Guardar todo</button></div>
    <table id="table-conci-manifiestos"><tbody></tbody></table>`;
  const tbody = document.querySelector('#table-conci-manifiestos tbody');
  filas.forEach(({ rowId = '', nueva = false, descartada = false, fuente = '', valores = {} }) => {
    const tr = document.createElement('tr');
    if (rowId) tr.dataset.rowId = rowId;
    if (nueva) tr.dataset.conciNew = '1';
    if (descartada) tr.dataset.conciDescartada = '1';
    if (fuente) tr.dataset.rowFuente = fuente;
    Object.entries(valores).forEach(([col, valor]) => {
      const td = document.createElement('td');
      td.dataset.col = col;
      if (col === 'DESTINO / ORIGEN') {
        td.dataset.routeRaw = valor;
        td.dataset.raw = 'QUITO';
      } else {
        td.dataset.raw = valor;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

beforeEach(() => {
  espiasRw.avisos.length = 0;
  espiasRw.escrituras.length = 0;
  espiasRw.recargas = 0;
  espiasRw.confirmado = true;
  espiasRw.textoConfirm = '';
  espiasRw.conectados = [];
  espiasRw.escrituraFalla = false;
  rw.modoCaptura(true);
  rw.permisoAdmin(true);
  window.supabaseClient = { marca: 'cliente de prueba' };
  document.body.innerHTML = '';
});

describe('reescritura: qué filas toca', () => {
  test('sólo las que ya existen en la base', () => {
    pintarRw([
      { rowId: '1', valores: { 'TOTAL PAX': '100' } },
      { nueva: true, valores: { 'TOTAL PAX': '50' } },
      { rowId: '3', descartada: true, valores: { 'TOTAL PAX': '50' } },
      { rowId: '4', fuente: 'Solo Vuelos', valores: { 'TOTAL PAX': '50' } },
      { valores: { 'TOTAL PAX': '50' } },
    ]);
    const filas = rw._conciFilasReescribibles();
    expect(filas).toHaveLength(1);
    expect(filas[0].dataset.rowId).toBe('1');
  });
});

describe('reescritura: qué manda de cada fila', () => {
  test('manda la fila completa, no sólo lo capturado en esta sesión', () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100', 'OBSERVACIONES': 'demora' } }]);
    const payload = rw._conciPayloadCompletoDeFila(document.querySelector('tr'));
    expect(payload).toEqual({ 'TOTAL PAX': '100', 'OBSERVACIONES': 'demora' });
  });

  test('una celda vacía viaja como null: la base queda igual a la pantalla', () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100', 'OBSERVACIONES': '' } }]);
    const payload = rw._conciPayloadCompletoDeFila(document.querySelector('tr'));
    expect(payload['OBSERVACIONES']).toBeNull();
  });

  test('las columnas calculadas no viajan: su "-" no es una captura', () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100', 'HRS. CUMPLIDAS': '-' } }]);
    const payload = rw._conciPayloadCompletoDeFila(document.querySelector('tr'));
    expect(payload).not.toHaveProperty('HRS. CUMPLIDAS');
  });

  test('salvo las calculadas que la base sí almacena', () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL EXENTOS': '12' } }]);
    const payload = rw._conciPayloadCompletoDeFila(document.querySelector('tr'));
    expect(payload['TOTAL EXENTOS']).toBe('12');
  });

  test('en routing manda el código, no el nombre de ciudad que se muestra', () => {
    pintarRw([{ rowId: '1', valores: { 'DESTINO / ORIGEN': 'MEX-UIO' } }]);
    const payload = rw._conciPayloadCompletoDeFila(document.querySelector('tr'));
    expect(payload['DESTINO / ORIGEN']).toBe('MEX-UIO');
  });
});

describe('reescritura: el aviso previo', () => {
  test('dice cuántas filas se van a tocar y qué se pierde', () => {
    const texto = rw._conciAvisoReescritura(17);
    expect(texto).toContain('las 17 filas');
    expect(texto).toContain('aunque alguien lo haya cambiado después');
    expect(texto).toContain('quedarán vacías también en la base');
  });

  test('nombra a quién puede pisar', () => {
    espiasRw.conectados = [
      { nombre: 'Yo', esYo: true },
      { nombre: 'María Fernanda', esYo: false },
      { nombre: 'Luis', esYo: false },
    ];
    const texto = rw._conciAvisoReescritura(3);
    expect(texto).toContain('otras 2 personas capturando: María Fernanda, Luis');
    expect(texto).not.toContain('Yo,');
  });

  test('lo dice también cuando no hay nadie más', () => {
    expect(rw._conciAvisoReescritura(3)).toContain('Nadie más está capturando');
  });
});

describe('reescritura: la ejecución', () => {
  test('no escribe nada si el aviso se cancela', async () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100' } }]);
    espiasRw.confirmado = false;

    await rw._conciReescribirTodasLasFilas();
    expect(espiasRw.escrituras).toHaveLength(0);
    expect(espiasRw.recargas).toBe(0);
  });

  test('el aviso se muestra antes de tocar la base', async () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100' } }]);
    await rw._conciReescribirTodasLasFilas();

    expect(espiasRw.textoConfirm).toContain('¿Continuar?');
    expect(espiasRw.escrituras).toHaveLength(1);
  });

  test('actualiza cada fila por su id y recarga para mostrar la verdad', async () => {
    pintarRw([
      { rowId: '1', valores: { 'TOTAL PAX': '100' } },
      { rowId: '2', valores: { 'TOTAL PAX': '200' } },
    ]);
    await rw._conciReescribirTodasLasFilas();

    expect(espiasRw.escrituras.map(e => e.rowId)).toEqual(['1', '2']);
    expect(espiasRw.recargas).toBe(1);
    expect(espiasRw.avisos.at(-1)).toEqual({
      texto: 'Reescritura completa: 2 filas en la base.',
      tipo: 'success',
    });
  });

  test('una escritura fallida se reporta con su error, no se traga', async () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100' } }]);
    espiasRw.escrituraFalla = true;

    await rw._conciReescribirTodasLasFilas();
    const aviso = espiasRw.avisos.at(-1);
    expect(aviso.tipo).toBe('error');
    expect(aviso.texto).toContain('permiso denegado');
  });

  test('un capturista no puede reescribir aunque llame a la función', async () => {
    pintarRw([{ rowId: '1', valores: { 'TOTAL PAX': '100' } }]);
    rw.permisoAdmin(false);

    await rw._conciReescribirTodasLasFilas();
    expect(espiasRw.escrituras).toHaveLength(0);
    expect(espiasRw.textoConfirm).toBe('');
    expect(espiasRw.avisos.at(-1).tipo).toBe('error');
  });

  test('sin filas guardadas en pantalla no pregunta nada', async () => {
    pintarRw([{ nueva: true, valores: { 'TOTAL PAX': '100' } }]);
    await rw._conciReescribirTodasLasFilas();

    expect(espiasRw.textoConfirm).toBe('');
    expect(espiasRw.escrituras).toHaveLength(0);
    expect(espiasRw.avisos.at(-1).tipo).toBe('info');
  });
});
