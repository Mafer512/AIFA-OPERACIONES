/**
 * @jest-environment jsdom
 *
 * Los datos que el QR necesita están repartidos por tres pestañas del alta:
 * Puesto en Generales, Nivel y Plaza en Clasificación, y la adscripción en
 * Organización. Antes, al pulsar "Generar QR onboarding" con algo sin capturar,
 * el aviso salía en el pie del alta y sólo saltaba a la pestaña del primero que
 * faltara: había que ir pestaña por pestaña a cazar los demás.
 *
 * Ahora se juntan en un modal. Lo que se prueba aquí es lo que de verdad puede
 * romperse en silencio:
 *
 * - que pinte exactamente los que faltan, y no los que ya están capturados;
 * - que cada campo diga de qué pestaña salió, leyendo el nombre de la pestaña
 *   misma en vez de repetirlo en una constante que luego se desincroniza;
 * - que al confirmar los copie de vuelta al alta, porque si se quedaran sólo en
 *   el modal, "Registrar Colaborador" guardaría el expediente sin ellos y el
 *   colaborador vería campos bloqueados y vacíos que nadie puede llenar.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

/** Trozo de HTML entre un marcador de apertura y el comentario que lo cierra. */
function trozoHtml(desde, hasta) {
  const i = app.indexOf(desde);
  if (i < 0) throw new Error('No se encontró: ' + desde);
  const j = app.indexOf(hasta, i);
  if (j < 0) throw new Error('Sin cierre: ' + hasta);
  return app.slice(i, j + hasta.length);
}

/**
 * Trozo de código entre dos marcadores, ambos incluidos.
 *
 * Se recorta por marcadores y no balanceando llaves porque el propio código que
 * se extrae lleva expresiones regulares con comillas dentro —replace(/"/g, …)—
 * y cualquier lector ingenuo de comillas se desincroniza ahí. Los cierres son
 * la llave a la indentación del IIFE, 24 espacios.
 */
function codigo(desde, hasta) {
  const i = app.indexOf(desde);
  if (i < 0) throw new Error('No se encontró: ' + desde);
  const j = app.indexOf(hasta, i + desde.length);
  if (j < 0) throw new Error('Sin cierre: ' + desde);
  return app.slice(i, j + hasta.length);
}

const FIN_FUNCION = '\n' + ' '.repeat(24) + '}';
const FIN_ASIGNACION = FIN_FUNCION + ';';
const FIN_ARREGLO = '\n' + ' '.repeat(24) + '];';

/**
 * Monta el alta y el modal de faltantes reales en jsdom y corre encima las
 * funciones reales de index.html. Devuelve el contexto y lo que se espió.
 */
function montarAlta(opciones = {}) {
  document.body.innerHTML =
    trozoHtml('<div class="modal fade" id="colabNuevoModal"', '<!-- /colabNuevoModal -->') +
    trozoHtml('<div class="modal fade" id="colabOnboardingFaltantesModal"', '<!-- /colabOnboardingFaltantesModal -->');

  const espia = { generado: null, mostrados: [], ocultados: [] };

  const ctx = {
    document,
    console,
    colabRequireEdit: () => true,
    colabGenerarOnboardingQrDesdeDatos: async (datos) => { espia.generado = datos; },
    ColaboradoresCatalogos: opciones.catalogo,
    ColaboradoresCampos: require('../js/colaboradores-campos'),
    bootstrap: {
      Modal: {
        getOrCreateInstance: (el) => ({ show: () => { espia.mostrados.push(el.id); el.classList.add('show'); } }),
        getInstance: (el) => ({ hide: () => { espia.ocultados.push(el.id); el.classList.remove('show'); } }),
      },
      Tab: { getOrCreateInstance: () => ({ show: () => {} }) },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  vm.runInContext([
    codigo('const COLAB_ONBOARDING_FIJOS = [', FIN_ARREGLO),
    codigo('const COLAB_ONBOARDING_ADMIN = [', FIN_ARREGLO),
    codigo('const COLAB_ONBOARDING_REQUERIDOS = [', '.filter(c => c.requerido));'),
    codigo('function colabNivelOrgRequerido(', FIN_FUNCION),
    codigo('function colabSeccionDeTab(', FIN_FUNCION),
    codigo('function colabPintarFaltantesOnboarding(', FIN_FUNCION),
    codigo('function colabAbrirFaltantesOnboarding(', FIN_FUNCION),
    codigo('window.colabConfirmarFaltantesOnboarding = async function()', FIN_ASIGNACION),
    codigo('window.colabGenerarNuevoOnboardingQr = async function()', FIN_ASIGNACION),
  ].join('\n'), ctx);

  return { ctx, espia };
}

/** Deja capturado todo lo que el QR exige, menos lo que se pida omitir. */
function capturarTodo(ctx, omitir = []) {
  const valores = {
    'cn-num': '1299-2',
    'cn-nombre': 'Pérez López Juan',
    'cn-fecha-ingreso': '01/10/2026',
    'cn-puesto': 'Analista de Operaciones',
    'cn-nivel': '11',
    'cn-plaza': 'Base',
    'cn-direccion': 'Dirección de Operación',
    'cn-subdireccion': 'Subdirección de Operaciones',
    'cn-gerencia': 'Gerencia de Plataforma',
    'cn-coordinacion': 'Coordinación de Rampa',
  };
  for (const [id, valor] of Object.entries(valores)) {
    document.getElementById(id).value = omitir.includes(id) ? '' : valor;
  }
}

const idsEnElModal = () =>
  Array.from(document.querySelectorAll('#colab-faltantes-body input[data-destino]'))
    .map(i => i.dataset.destino);

describe('con todo capturado el modal no estorba', () => {
  test('genera el QR directo, sin abrir nada', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx);

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(espia.mostrados).toEqual([]);
    expect(espia.generado.numEmpl).toBe('1299-2');
    // El número de empleado va como argumento aparte del RPC, no en la metadata.
    expect(espia.generado.fijos).not.toHaveProperty('num_empleado');
    expect(espia.generado.fijos.puesto).toBe('Analista de Operaciones');
    expect(espia.generado.fijos.coordinacion).toBe('Coordinación de Rampa');
  });
});

describe('cuando falta algo, el modal lo junta todo', () => {
  test('abre el modal en vez de generar el QR', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx, ['cn-puesto']);

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(espia.mostrados).toEqual(['colabOnboardingFaltantesModal']);
    expect(espia.generado).toBeNull();
  });

  test('pide sólo lo que falta, aunque esté en pestañas distintas', async () => {
    const { ctx } = montarAlta();
    capturarTodo(ctx, ['cn-puesto', 'cn-nivel', 'cn-gerencia']);

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(idsEnElModal()).toEqual(['cn-puesto', 'cn-nivel', 'cn-gerencia']);
  });

  test('agrupa cada campo bajo el nombre real de su pestaña', async () => {
    const { ctx } = montarAlta();
    capturarTodo(ctx, ['cn-puesto', 'cn-nivel', 'cn-gerencia']);

    await ctx.colabGenerarNuevoOnboardingQr();

    // Los nombres salen de las pestañas del alta, no de una lista aparte.
    const secciones = Array.from(document.querySelectorAll('.colab-faltantes-seccion'))
      .map(e => e.textContent.trim());
    expect(secciones).toEqual(['Generales', 'Clasificación', 'Organización']);
  });

  test('cada campo apunta a un input que existe en el alta', async () => {
    const { ctx } = montarAlta();
    capturarTodo(ctx, ['cn-num', 'cn-nombre', 'cn-fecha-ingreso', 'cn-puesto', 'cn-nivel', 'cn-plaza',
                       'cn-direccion', 'cn-subdireccion', 'cn-gerencia', 'cn-coordinacion']);

    await ctx.colabGenerarNuevoOnboardingQr();

    const destinos = idsEnElModal();
    expect(destinos).toHaveLength(10);
    for (const id of destinos) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});

describe('al confirmar el modal', () => {
  test('no deja pasar campos vacíos', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx, ['cn-puesto', 'cn-nivel']);
    await ctx.colabGenerarNuevoOnboardingQr();

    document.getElementById('cf-cn-puesto').value = 'Analista';
    // cf-cn-nivel se queda vacío a propósito.
    await ctx.colabConfirmarFaltantesOnboarding();

    expect(espia.generado).toBeNull();
    expect(document.getElementById('cf-cn-nivel').classList.contains('is-invalid')).toBe(true);
    expect(document.getElementById('colab-faltantes-error').style.display).toBe('');
  });

  test('copia lo capturado al alta y genera el QR', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx, ['cn-puesto', 'cn-gerencia']);
    await ctx.colabGenerarNuevoOnboardingQr();

    document.getElementById('cf-cn-puesto').value = '  Jefe de Plataforma  ';
    document.getElementById('cf-cn-gerencia').value = 'Gerencia de Rampa';
    await ctx.colabConfirmarFaltantesOnboarding();

    // Sin esta copia, "Registrar Colaborador" guardaría el expediente sin ellos.
    expect(document.getElementById('cn-puesto').value).toBe('Jefe de Plataforma');
    expect(document.getElementById('cn-gerencia').value).toBe('Gerencia de Rampa');

    expect(espia.ocultados).toEqual(['colabOnboardingFaltantesModal']);
    expect(espia.generado.fijos.puesto).toBe('Jefe de Plataforma');
    expect(espia.generado.fijos.gerencia).toBe('Gerencia de Rampa');
  });
});

describe('con el catálogo de áreas cargado', () => {
  const catalogo = require('../js/colaboradores-catalogos');

  function capturarArea(valores) {
    const base = {
      'cn-num': '1800', 'cn-nombre': 'Pérez López Juan', 'cn-fecha-ingreso': '01/10/2026',
      'cn-puesto': 'Gerente de Carga', 'cn-nivel': 'N32', 'cn-plaza': '90',
      'cn-direccion': '', 'cn-subdireccion': '', 'cn-gerencia': '', 'cn-coordinacion': '',
    };
    for (const [id, valor] of Object.entries(Object.assign(base, valores))) {
      document.getElementById(id).value = valor;
    }
  }

  test('no exige la coordinación de una gerencia que no tiene', async () => {
    const { ctx, espia } = montarAlta({ catalogo });
    capturarArea({
      'cn-direccion': 'Dirección de Operación',
      'cn-subdireccion': 'Subdirección de Servicios Conexos',
      'cn-gerencia': 'Gerencia de Carga',
    });

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(espia.mostrados).toEqual([]);
    expect(espia.generado.fijos.gerencia).toBe('Gerencia de Carga');
    expect(espia.generado.fijos).not.toHaveProperty('coordinacion');
  });

  test('no exige subdirección ni gerencia de lo que depende directo de la Dirección', async () => {
    const { ctx, espia } = montarAlta({ catalogo });
    capturarArea({ 'cn-direccion': 'Dirección de Operación', 'cn-coordinacion': 'Coordinación de Auditoría' });

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(espia.mostrados).toEqual([]);
    expect(espia.generado.fijos.coordinacion).toBe('Coordinación de Auditoría');
  });

  test('sí exige la coordinación cuando la gerencia tiene, y la ofrece del catálogo', async () => {
    const { ctx } = montarAlta({ catalogo });
    capturarArea({
      'cn-direccion': 'Dirección de Operación',
      'cn-subdireccion': 'Subdirección de Seguridad Operacional',
      'cn-gerencia': 'Gerencia de Seguridad Operacional',
    });

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(idsEnElModal()).toEqual(['cn-coordinacion']);
    // En el modal se elige del catálogo, filtrado por la gerencia del alta.
    const opciones = Array.from(document.getElementById('cf-cn-coordinacion-sel').options).map(o => o.textContent);
    expect(opciones).toContain('Coordinación de Control de Fauna');
    expect(opciones).not.toContain('Coordinación de Auditoría');
  });
});

/**
 * La fecha de ingreso ya no la captura el colaborador: la pone quien hace el
 * alta, antes de generar el QR. Y lo demás que es sólo del área (RyR, turno,
 * comisionado, doc. de ingreso, extensión y correo institucional) viaja aparte
 * en la metadata, para que el guardado lo escriba sin que el portal lo muestre.
 */
describe('los datos que sólo captura el área', () => {
  test('sin fecha de ingreso no hay QR: se pide en el modal', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx, ['cn-fecha-ingreso']);

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(espia.generado).toBeNull();
    expect(idsEnElModal()).toEqual(['cn-fecha-ingreso']);
    expect(document.getElementById('cf-cn-fecha-ingreso').placeholder).toBe('DD/MM/AAAA');
  });

  test('una fecha de ingreso que no es fecha no pasa', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx, ['cn-fecha-ingreso']);
    await ctx.colabGenerarNuevoOnboardingQr();

    document.getElementById('cf-cn-fecha-ingreso').value = '31/02/2026';
    await ctx.colabConfirmarFaltantesOnboarding();

    expect(espia.generado).toBeNull();
    expect(document.getElementById('cf-cn-fecha-ingreso').classList.contains('is-invalid')).toBe(true);
    expect(document.getElementById('colab-faltantes-error').textContent).toContain('DD/MM/AAAA');

    document.getElementById('cf-cn-fecha-ingreso').value = '28/02/2026';
    await ctx.colabConfirmarFaltantesOnboarding();
    expect(document.getElementById('cn-fecha-ingreso').value).toBe('28/02/2026');
    expect(espia.generado.admin.fecha_ingreso).toBe('28/02/2026');
  });

  test('viajan en admin, no entre los fijos que ve el colaborador', async () => {
    const { ctx, espia } = montarAlta();
    capturarTodo(ctx);
    document.getElementById('cn-ryr').value = '15/03/2024';
    document.getElementById('cn-turno').value = 'Matutino';
    document.getElementById('cn-correo').value = 'juan.perez@aifa.com.mx';

    await ctx.colabGenerarNuevoOnboardingQr();

    expect(espia.generado.admin).toEqual(expect.objectContaining({
      fecha_ingreso: '01/10/2026', ryr: '15/03/2024', turno: 'Matutino', correo: 'juan.perez@aifa.com.mx',
    }));
    for (const clave of ['fecha_ingreso', 'ryr', 'turno', 'correo']) {
      expect(espia.generado.fijos).not.toHaveProperty(clave);
    }
  });

  test('cada uno apunta a un input del alta marcado como sólo del área', () => {
    const arr = app.match(/const COLAB_ONBOARDING_ADMIN = \[([\s\S]*?)\n {24}\];/);
    const campos = [...arr[1].matchAll(/clave: '([^']+)',\s*input: '([^']+)'/g)];
    expect(campos.map(m => m[1]).sort()).toEqual(
      ['comisionado', 'correo', 'doc_ingreso', 'extension', 'fecha_ingreso', 'ryr', 'turno']);
    for (const [, , input] of campos) {
      const label = app.match(new RegExp('<label[^>]*for="' + input + '"[^>]*>([\\s\\S]*?)</label>'));
      expect(label).not.toBeNull();
      expect(label[1]).toContain('cn-solo-area');
    }
  });
});
