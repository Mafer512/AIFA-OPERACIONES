/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const rutaPanel = path.resolve(__dirname, '..', 'js', 'estadistica-panel.js');
const rutaMotor = path.resolve(__dirname, '..', 'js', 'estadistica-motor.js');
const panelSource = fs.readFileSync(rutaPanel, 'utf8');
const motorSource = fs.readFileSync(rutaMotor, 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// El marcado de la prueba se RECORTA DE index.html, no se reescribe a mano: si
// alguien renombra un id allá, esta prueba falla en vez de seguir pasando
// contra una copia que ya no existe.
function marcadoDelModulo() {
  const inicio = indexSource.indexOf('<div class="nav est-cabecera" id="est-subnav"');
  const fin = indexSource.indexOf('<!-- INFORME OFICIAL');
  if (inicio === -1 || fin === -1 || fin < inicio) {
    throw new Error('No se encontró el marcado del módulo estadístico en index.html');
  }
  return indexSource.slice(inicio, fin) + '</div>';
}

function respuestaAgregado(extra) {
  return Object.assign({
    d1: null, d2: null, d3: null, d4: null,
    operaciones: 120, operaciones_llegada: 60, operaciones_salida: 60,
    operaciones_canceladas: 4, operaciones_nacional: 100, operaciones_internacional: 20,
    pax_total: 15000, pax_llegada: 7600, pax_salida: 7400,
    pax_nacional: 12000, pax_internacional: 3000, operaciones_con_pax: 118,
    carga_total_kg: 45000, carga_nacional_kg: 30000, carga_internacional_kg: 15000,
    carga_descargada_kg: 20000, carga_embarcada_kg: 22000, carga_transito_kg: 3000,
    correo_kg: 500, operaciones_con_carga: 20, operaciones_con_desglose_carga: 12,
    ocupacion_pax: 15000, ocupacion_capacidad: 18000, factor_ocupacion: 83.33,
    operaciones_con_ocupacion: 110,
    operaciones_puntuales: 90, operaciones_demoradas: 20, minutos_demora_total: 600,
    demora_promedio: 5.45, demora_maxima: 120, demora_minima: -10,
    operaciones_evaluables_puntualidad: 110,
    operaciones_clasificadas: 115, operaciones_sin_clasificar: 5, operaciones_capturadas: 100
  }, extra || {});
}

function crearStub(nivel) {
  const llamadas = [];
  const client = {
    llamadas,
    vacio: false,
    rpc: jest.fn(async (nombre, params) => {
      llamadas.push({ nombre, params });
      if (nombre === 'estadistica_access_level') return { data: nivel, error: null };
      if (nombre === 'estadistica_opciones_filtro') {
        return {
          data: [
            { campo: 'aerolinea', valor: 'VOLARIS', etiqueta: 'VOLARIS', operaciones: 80 },
            { campo: 'aerolinea', valor: 'VIVA AEROBUS', etiqueta: 'VIVA AEROBUS', operaciones: 40 },
            { campo: 'tipo_aeronave', valor: 'A320', etiqueta: 'A320', operaciones: 90 },
            { campo: 'endpoint', valor: 'CUN', etiqueta: 'CUN — Cancún', operaciones: 30 },
            { campo: 'tipo_servicio', valor: 'J', etiqueta: 'J — Servicio Normal', operaciones: 100 },
            { campo: 'matricula', valor: 'XA-VRZ', etiqueta: 'XA-VRZ', operaciones: 12 },
            { campo: 'posicion', valor: 'A12', etiqueta: 'A12', operaciones: 55 },
            { campo: 'puerta', valor: '7', etiqueta: '7', operaciones: 40 }
          ],
          error: null
        };
      }
      if (nombre === 'estadistica_agregado') {
        const dims = params.p_dimensiones || [];
        // vacio=true simula un periodo sin operaciones, que es el caso que
        // tiene que explicarse en pantalla en vez de quedarse mudo.
        if (client.vacio) {
          return { data: [respuestaAgregado({ operaciones: 0, operaciones_llegada: 0, operaciones_salida: 0 })], error: null };
        }
        if (!dims.length) return { data: [respuestaAgregado()], error: null };
        return {
          data: [
            respuestaAgregado({ d1: '2026-01', d2: dims[1] ? 'X' : null }),
            respuestaAgregado({ d1: '2026-02', d2: dims[1] ? 'Y' : null })
          ],
          error: null
        };
      }
      if (nombre === 'estadistica_detalle') {
        // Dos páginas: la primera llena, la segunda corta. Sirve para
        // comprobar que la exportación pagina y no se queda con la primera.
        const offset = params.p_offset || 0;
        const limite = params.p_limite || 10000;
        if (offset === 0) {
          return { data: new Array(limite).fill(0).map((_, i) => ({ id: i, fecha_operacion: '2026-01-01' })), error: null };
        }
        return { data: [{ id: 999999, fecha_operacion: '2026-01-02' }], error: null };
      }
      if (nombre === 'estadistica_sin_clasificar') return { data: [], error: null };
      if (nombre === 'estadistica_diagnostico') {
        return {
          data: [{
            movimientos: 3676, canceladas: 12, clasificadas: 3600, sin_clasificar: 76,
            con_pax: 3400, con_capacidad: 3100, con_carga: 210, con_rotacion: 2900,
            conciliadas: 10, primera_fecha: '2026-07-01', ultima_fecha: '2026-08-31',
            refrescado_at: '2026-09-08T12:00:00.000Z', reglas_activas: 24,
            por_anio: { '2026': 3676 }, por_fuente: { MAESTRA_OPERACIONES: 3676 }
          }],
          error: null
        };
      }
      if (nombre === 'refrescar_estadistica') return { data: new Date().toISOString(), error: null };
      return { data: null, error: null };
    }),
    from: jest.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { refrescado_at: '2026-09-08T12:00:00.000Z' }, error: null }) }),
        order: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }), limit: async () => ({ data: [], error: null }) })
      })
    }))
  };
  return client;
}

async function reposar(veces = 8) {
  for (let i = 0; i < veces; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function montar(nivel) {
  document.body.innerHTML = `<button id="tab-conci-estadistica" class="active"></button>
    <div>${marcadoDelModulo()}</div>`;

  const client = crearStub(nivel);
  window.supabaseClient = client;
  window.ensureSupabaseClient = async () => client;
  // Chart.js sólo se comprueba que reciba una configuración razonable; en jsdom
  // no hay lienzo que pintar.
  const graficas = [];
  window.Chart = function (canvas, config) {
    graficas.push({ id: canvas && canvas.id, config });
    this.destroy = () => {};
    this.resize = () => {};
  };
  window.Chart.getChart = () => null;
  // jsdom no navega: el clic real del enlace de descarga sólo produce ruido de
  // "Not implemented: navigation". Se anula sin tocar el resto del flujo.
  window.HTMLAnchorElement.prototype.click = function () {};

  // Montar el mismo IIFE varias veces en el MISMO document deja pegados los
  // listeners de DOMContentLoaded de los montajes anteriores: cada uno se
  // vuelve a enlazar a los botones nuevos y las consultas se multiplican.
  // Por eso se intercepta el registro y sólo se arranca la instancia recién
  // evaluada, en vez de disparar un evento que despertaría a todas.
  const registrarOriginal = document.addEventListener.bind(document);
  const arranques = [];
  document.addEventListener = (tipo, fn, ...resto) => {
    if (tipo === 'DOMContentLoaded') { arranques.push(fn); return undefined; }
    return registrarOriginal(tipo, fn, ...resto);
  };
  try {
    window.eval(motorSource);
    window.eval(panelSource);
  } finally {
    document.addEventListener = registrarOriginal;
  }
  arranques.forEach((fn) => fn());
  await reposar();
  return { client, graficas };
}

function llamadasAgregado(client) {
  return client.llamadas.filter((l) => l.nombre === 'estadistica_agregado');
}

describe('Panel estadístico · origen de los datos', () => {
  beforeEach(() => { jest.restoreAllMocks(); });

  test('las cifras vienen del RPC de agregación, no de leer filas y sumarlas en el navegador', async () => {
    const { client } = await montar('admin');
    expect(llamadasAgregado(client).length).toBeGreaterThan(0);
    // Nada de traerse el detalle para calcular a mano en el arranque.
    expect(client.llamadas.some((l) => l.nombre === 'estadistica_detalle')).toBe(false);
    // Ninguna consulta directa a la maestra ni a la vista materializada.
    const tablasLeidas = client.from.mock.calls.map((c) => c[0]);
    expect(tablasLeidas).not.toContain('maestra_operaciones');
    expect(tablasLeidas).not.toContain('vw_maestra_operaciones');
    expect(tablasLeidas).not.toContain('mv_estadistica_operaciones');
  });

  test('el rango de fechas viaja como parámetros propios y es inclusivo en los dos extremos', async () => {
    const { client } = await montar('admin');
    const anio = new Date().getFullYear();
    const primera = llamadasAgregado(client)[0];
    expect(primera.params.p_desde).toBe(`${anio}-01-01`);
    expect(primera.params.p_hasta).toBe(`${anio}-12-31`);
  });

  test('el resumen pide también los dos periodos de referencia para las variaciones', async () => {
    const { client } = await montar('admin');
    const rangos = llamadasAgregado(client).map((l) => `${l.params.p_desde}..${l.params.p_hasta}`);
    const anio = new Date().getFullYear();
    expect(rangos).toContain(`${anio}-01-01..${anio}-12-31`);
    expect(rangos.some((r) => r.startsWith(`${anio - 1}-01-01`))).toBe(true);
  });
});

describe('Panel estadístico · filtros centralizados', () => {
  test('un filtro elegido llega al servidor dentro de p_filtros, no se aplica en el navegador', async () => {
    const { client } = await montar('admin');
    document.getElementById('est-f-aerolinea').value = 'VOLARIS';
    document.getElementById('est-f-segmento').value = 'COMERCIAL';
    client.llamadas.length = 0;
    document.getElementById('est-btn-aplicar').dispatchEvent(new window.Event('click'));
    await reposar();

    const conFiltro = llamadasAgregado(client);
    expect(conFiltro.length).toBeGreaterThan(0);
    conFiltro.forEach((l) => {
      expect(l.params.p_filtros.aerolinea).toEqual(['VOLARIS']);
      expect(l.params.p_filtros.segmento_aviacion).toEqual(['COMERCIAL']);
    });
  });

  test('un periodo invertido se rechaza antes de consultar', async () => {
    const { client } = await montar('admin');
    document.getElementById('est-f-desde').value = '2026-12-31';
    document.getElementById('est-f-hasta').value = '2026-01-01';
    client.llamadas.length = 0;
    document.getElementById('est-btn-aplicar').dispatchEvent(new window.Event('click'));
    await reposar();

    expect(llamadasAgregado(client)).toHaveLength(0);
    const error = document.getElementById('est-error');
    expect(error.classList.contains('d-none')).toBe(false);
    expect(error.textContent).toMatch(/invertido/i);
  });

  test('limpiar quita los filtros pero conserva el periodo', async () => {
    const { client } = await montar('admin');
    document.getElementById('est-f-aerolinea').value = 'VOLARIS';
    document.getElementById('est-btn-limpiar').dispatchEvent(new window.Event('click'));
    await reposar();
    expect(document.getElementById('est-f-aerolinea').value).toBe('');
    const ultima = llamadasAgregado(client).pop();
    expect(ultima.params.p_filtros).toEqual({});
    expect(ultima.params.p_desde).toBeTruthy();
  });

  test('los desplegables se llenan con lo que existe en el periodo', async () => {
    await montar('admin');
    const opciones = Array.from(document.getElementById('est-f-aerolinea').options).map((o) => o.value);
    expect(opciones).toEqual(['', 'VOLARIS', 'VIVA AEROBUS']);
  });
});

describe('Panel estadístico · permisos', () => {
  test('sin acceso no se pinta nada y se explica por qué', async () => {
    const { client } = await montar('none');
    expect(llamadasAgregado(client)).toHaveLength(0);
    expect(document.getElementById('est-error').classList.contains('d-none')).toBe(false);
    expect(document.getElementById('est-subcontent').classList.contains('d-none')).toBe(true);
  });

  test('solo lectura: no puede refrescar la materialización ni bajar el detalle', async () => {
    await montar('read');
    expect(document.getElementById('est-btn-refrescar').classList.contains('d-none')).toBe(true);
    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const detalle = document.querySelector('[data-est-doc="detalle"]');
    expect(detalle.disabled).toBe(true);
    const oficial = document.querySelector('[data-est-doc="informe_oficial"]');
    expect(oficial.disabled).toBe(true);
  });

  test('nivel de captura: puede bajar el detalle, no los documentos oficiales', async () => {
    await montar('capture');
    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    expect(document.querySelector('[data-est-doc="detalle"]').disabled).toBe(false);
    expect(document.querySelector('[data-est-doc="informe_oficial"]').disabled).toBe(true);
    expect(document.querySelector('[data-est-doc="resumen"]').disabled).toBe(false);
  });

  test('nivel admin: todo habilitado', async () => {
    await montar('admin');
    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    document.querySelectorAll('[data-est-doc]').forEach((b) => expect(b.disabled).toBe(false));
    expect(document.getElementById('est-btn-refrescar').classList.contains('d-none')).toBe(false);
  });

  test('el nivel lo dicta la base, no el navegador', async () => {
    const { client } = await montar('read');
    expect(client.llamadas[0].nombre).toBe('estadistica_access_level');
  });
});

describe('Panel estadístico · áreas', () => {
  test('cada área consulta al abrirse, y no vuelve a consultar si nada cambió', async () => {
    const { client } = await montar('admin');
    client.llamadas.length = 0;

    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const primeraVuelta = llamadasAgregado(client).length;
    expect(primeraVuelta).toBeGreaterThan(0);

    document.getElementById('est-tab-resumen').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    // La segunda visita a Carga no repite las consultas: ya estaba cargada.
    expect(llamadasAgregado(client).length).toBe(primeraVuelta);
  });

  test('cambiar los filtros invalida lo ya pintado', async () => {
    const { client } = await montar('admin');
    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    document.getElementById('est-f-nacint').value = 'Nacional';
    client.llamadas.length = 0;
    document.getElementById('est-btn-aplicar').dispatchEvent(new window.Event('click'));
    await reposar();
    expect(llamadasAgregado(client).length).toBeGreaterThan(0);
  });

  test('el resumen pinta tarjetas, calidad del dato y avisos', async () => {
    await montar('admin');
    expect(document.getElementById('est-resumen-tarjetas').innerHTML).toMatch(/Operaciones/);
    expect(document.getElementById('est-resumen-tarjetas').innerHTML).toMatch(/Factor de ocupación/);
    expect(document.getElementById('est-resumen-calidad').innerHTML).toMatch(/Cobertura de pasajeros/);
    // 4 canceladas y 5 sin clasificar en la fixture: los dos avisos salen.
    const avisos = document.getElementById('est-avisos').textContent;
    expect(avisos).toMatch(/canceladas/i);
    expect(avisos).toMatch(/sin clasificar/i);
  });

  test('la carga avisa cuando el desglose no está capturado del todo', async () => {
    await montar('admin');
    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const nota = document.getElementById('est-carga-nota');
    expect(nota.classList.contains('d-none')).toBe(false);
    expect(nota.textContent).toMatch(/desglose/i);
    // Las tarjetas separan los tres conceptos de carga.
    const tarjetas = document.getElementById('est-carga-tarjetas').textContent;
    expect(tarjetas).toMatch(/Descargada en AIFA/);
    expect(tarjetas).toMatch(/Embarcada en AIFA/);
    expect(tarjetas).toMatch(/En tránsito/);
  });

  test('el Informe oficial esconde los filtros del módulo: no le aplican', async () => {
    await montar('admin');
    document.getElementById('est-tab-informe').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    expect(document.getElementById('est-filtros').classList.contains('d-none')).toBe(true);
    document.getElementById('est-tab-resumen').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    expect(document.getElementById('est-filtros').classList.contains('d-none')).toBe(false);
  });

  test('el explorador agrupa por las dimensiones elegidas y sólo grafica cuando hay una', async () => {
    const { client, graficas } = await montar('admin');
    document.getElementById('est-tab-explorador').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    let ultima = llamadasAgregado(client).pop();
    expect(ultima.params.p_dimensiones).toEqual(['anio_mes']);
    expect(graficas.some((g) => g.id === 'est-exp-chart')).toBe(true);

    document.getElementById('est-exp-dim2').value = 'aerolinea';
    document.getElementById('est-exp-consultar').dispatchEvent(new window.Event('click'));
    await reposar();
    ultima = llamadasAgregado(client).pop();
    expect(ultima.params.p_dimensiones).toEqual(['anio_mes', 'aerolinea']);
  });
});

describe('Panel estadístico · comparador', () => {
  test('compara dos periodos arbitrarios y calcula la variación', async () => {
    const { client } = await montar('admin');
    document.getElementById('est-tab-comparador').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();

    const llamadas = llamadasAgregado(client).filter((l) => (l.params.p_dimensiones || []).length === 0);
    expect(llamadas.length).toBeGreaterThanOrEqual(2);

    const tabla = document.getElementById('est-cmp-tabla');
    expect(tabla.querySelector('tbody').textContent).toMatch(/Operaciones/);
    // Con dos periodos idénticos la variación es 0 %, nunca NaN.
    expect(tabla.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  test('el preset "mismo periodo del año anterior" llena las cuatro fechas', async () => {
    await montar('admin');
    document.getElementById('est-tab-comparador').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    ['est-cmp-a-desde', 'est-cmp-a-hasta', 'est-cmp-b-desde', 'est-cmp-b-hasta']
      .forEach((id) => expect(document.getElementById(id).value).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    const anio = new Date().getFullYear();
    expect(document.getElementById('est-cmp-b-desde').value).toBe(`${anio - 1}-01-01`);
  });
});

describe('Panel estadístico · centro de descargas', () => {
  test('centraliza los documentos en un solo lugar, incluidos los dos PDF oficiales', async () => {
    await montar('admin');
    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const claves = Array.from(document.querySelectorAll('[data-est-doc]')).map((b) => b.dataset.estDoc);
    ['resumen', 'mensual', 'aerolinea', 'ruta', 'pasajeros', 'carga', 'puntualidad',
      'comparativo', 'detalle', 'sin_clasificar', 'informe_oficial', 'resumen_oficial']
      .forEach((clave) => expect(claves).toContain(clave));
  });

  test('los PDF oficiales NO se regeneran aquí: mandan a la pestaña que ya los produce', async () => {
    await montar('admin');
    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const boton = document.querySelector('[data-est-doc="informe_oficial"]');
    expect(boton.dataset.estFormato).toBe('ir');
    const informe = document.getElementById('est-tab-informe');
    const clic = jest.fn();
    informe.addEventListener('click', clic);
    boton.dispatchEvent(new window.Event('click', { bubbles: true }));
    await reposar();
    expect(clic).toHaveBeenCalled();
  });

  test('la exportación de detalle pagina hasta agotar el resultado, no se queda con la primera página', async () => {
    const { client } = await montar('admin');
    // La descarga real usa URL.createObjectURL, que jsdom no implementa.
    window.URL.createObjectURL = jest.fn(() => 'blob:falso');
    window.URL.revokeObjectURL = jest.fn();

    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    client.llamadas.length = 0;
    document.querySelector('[data-est-doc="detalle"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await reposar(20);

    const paginas = client.llamadas.filter((l) => l.nombre === 'estadistica_detalle');
    expect(paginas.length).toBe(2);
    expect(paginas[0].params.p_offset).toBe(0);
    expect(paginas[1].params.p_offset).toBe(10000);
    expect(window.URL.createObjectURL).toHaveBeenCalled();
  });

  test('la exportación respeta los filtros vigentes', async () => {
    const { client } = await montar('admin');
    window.URL.createObjectURL = jest.fn(() => 'blob:falso');
    window.URL.revokeObjectURL = jest.fn();
    document.getElementById('est-f-aerolinea').value = 'VOLARIS';
    document.getElementById('est-btn-aplicar').dispatchEvent(new window.Event('click'));
    await reposar();
    document.getElementById('est-tab-descargas').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    client.llamadas.length = 0;
    document.querySelector('[data-est-doc="detalle"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await reposar(20);
    const detalle = client.llamadas.find((l) => l.nombre === 'estadistica_detalle');
    expect(detalle.params.p_filtros.aerolinea).toEqual(['VOLARIS']);
  });
});

describe('Panel estadístico · por qué una pantalla sale vacía', () => {
  test('un periodo sin operaciones se explica con las cifras reales, no con un silencio', async () => {
    const { client } = await montar('admin');
    client.vacio = true;
    client.llamadas.length = 0;
    document.getElementById('est-btn-aplicar').dispatchEvent(new window.Event('click'));
    await reposar();

    expect(client.llamadas.some((l) => l.nombre === 'estadistica_diagnostico')).toBe(true);
    const avisos = document.getElementById('est-avisos');
    expect(avisos.classList.contains('d-none')).toBe(false);
    // Dice el rango que SÍ tiene datos y cuándo se actualizó la estadística.
    expect(avisos.textContent).toMatch(/Sin operaciones/i);
    expect(avisos.textContent).toMatch(/2026-07-01/);
    expect(avisos.textContent).toMatch(/2026-08-31/);
    expect(avisos.textContent).toMatch(/3,676/);
  });

  test('con datos no aparece el aviso de vacío', async () => {
    await montar('admin');
    const avisos = document.getElementById('est-avisos').textContent;
    expect(avisos).not.toMatch(/Sin operaciones en/i);
  });
});

describe('Panel estadístico · esquema nuevo', () => {
  test('el resumen muestra las métricas que trajo el esquema real', async () => {
    await montar('admin');
    document.getElementById('est-tab-pasajeros').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const tarjetas = document.getElementById('est-pax-tarjetas').textContent;
    expect(tarjetas).toMatch(/Programados vs no abordados/);
    expect(tarjetas).toMatch(/Tránsitos y conexiones/);
    expect(tarjetas).toMatch(/Pagan TUA/);
  });

  test('aeronaves reporta rotaciones, tiempo en tierra y pernocta', async () => {
    await montar('admin');
    document.getElementById('est-tab-aeronaves').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const tarjetas = document.getElementById('est-aeronaves-tarjetas').textContent;
    expect(tarjetas).toMatch(/Rotaciones/);
    expect(tarjetas).toMatch(/Tiempo en tierra promedio/);
    expect(tarjetas).toMatch(/Pernoctas/);
  });

  test('carga separa importación y exportación del desglose territorial', async () => {
    await montar('admin');
    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    const tarjetas = document.getElementById('est-carga-tarjetas').textContent;
    expect(tarjetas).toMatch(/Importación \/ Exportación/);
    expect(tarjetas).toMatch(/En tránsito/);
    expect(tarjetas).toMatch(/Nacional/);
  });

  test('el explorador filtra por cualquier dimensión sin recargar la barra superior', async () => {
    const { client } = await montar('admin');
    document.getElementById('est-tab-explorador').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();

    const campo = document.getElementById('est-exp-filtro-campo');
    expect(Array.from(campo.options).map((o) => o.value)).toEqual(
      expect.arrayContaining(['posicion', 'puerta', 'banda', 'motivo_operativo']));

    campo.value = 'posicion';
    campo.dispatchEvent(new window.Event('change'));
    await reposar();
    const valor = document.getElementById('est-exp-filtro-valor');
    valor.value = 'A12';
    client.llamadas.length = 0;
    valor.dispatchEvent(new window.Event('change'));
    await reposar();

    const ultima = llamadasAgregado(client).pop();
    expect(ultima.params.p_filtros.posicion).toEqual(['A12']);
  });
});

describe('Panel estadístico · convivencia con lo que ya existía', () => {
  test('el marcado del Informe Estadístico sigue intacto dentro de su propia sub-pestaña', () => {
    // Los ids que usa js/estadistico-informe.js no cambiaron de nombre ni
    // desaparecieron al anidar las sub-pestañas.
    ['informe-est-toolbar', 'informe-est-anio', 'informe-est-btn-visto-bueno',
      'informe-est-btn-resumen', 'informe-est-root', 'informe-est-chart-mensual',
      'informe-est-tabla-mensual', 'informe-est-tabla-aerolinea', 'informe-est-tabla-ocupacion']
      .forEach((id) => expect(indexSource).toContain(`id="${id}"`));
    // Y siguen viviendo dentro de la pestaña Estadística de Conciliación.
    const pane = indexSource.indexOf('id="pane-conci-estadistica"');
    const informe = indexSource.indexOf('id="informe-est-root"');
    expect(pane).toBeGreaterThan(-1);
    expect(informe).toBeGreaterThan(pane);
  });

  test('el módulo nuevo no redefine ningún id del informe', () => {
    const nuevos = marcadoDelModulo().match(/id="([^"]+)"/g) || [];
    nuevos.forEach((attr) => {
      expect(attr).not.toMatch(/id="informe-est-/);
    });
    expect(nuevos.length).toBeGreaterThan(30);
  });

  test('no se introduce otra librería de gráficas ni otro framework de CSS', () => {
    expect(panelSource).toMatch(/window\.Chart/);
    expect(panelSource).not.toMatch(/echarts|plotly|highcharts|d3\.select|apexcharts/i);
    expect(marcadoDelModulo()).not.toMatch(/tailwind|bulma|foundation/i);
  });
});

describe('la ventana FBO · Aviación General', () => {
  // Lo que devuelve aviacion_general_resumen (migración 046), con la forma real.
  const RESUMEN = {
    totales: {
      movimientos: 200, llegadas: 101, salidas: 99, nacionales: 150, internacionales: 50,
      pax: 640, adultos: 600, infantes: 40, rotaciones: 95, operadores: 30, matriculas: 44,
      pendientes: 150, validados: 40, observados: 10, fecha_min: '2026-01-02', fecha_max: '2026-08-30'
    },
    por_mes: [
      { periodo: '2026-01', anio: 2026, mes: 1, movimientos: 80, llegadas: 41, salidas: 39, pax: 250 },
      { periodo: '2026-02', anio: 2026, mes: 2, movimientos: 120, llegadas: 60, salidas: 60, pax: 390 }
    ],
    por_ambito: [],
    por_tipo_operacion: [],
    top_operadores: [{ clave: 'JETS DEL NORTE', movimientos: 60, pax: 180 }, { clave: 'AERO SERVICIOS', movimientos: 40, pax: 90 }],
    top_aeronaves: [{ clave: 'G650', movimientos: 50, pax: 150 }],
    top_aeropuertos: [{ clave: null, movimientos: 104, pax: 300 }, { clave: 'MMTO', movimientos: 30, pax: 80 }],
    top_matriculas: [{ clave: 'XA-ABC', movimientos: 12, operador: 'JETS DEL NORTE', tipo_aeronave: 'G650' }]
  };

  async function montarFbo(respuesta) {
    const montaje = await montar('admin');
    const original = montaje.client.rpc.getMockImplementation();
    montaje.client.rpc.mockImplementation(async (nombre, params) => {
      if (nombre !== 'aviacion_general_resumen') return original(nombre, params);
      montaje.client.llamadas.push({ nombre, params });
      return typeof respuesta === 'function' ? respuesta(params) : { data: respuesta, error: null };
    });
    return montaje;
  }

  const llamadasFbo = (client) => client.llamadas.filter((l) => l.nombre === 'aviacion_general_resumen');
  const ultimaDe = (graficas, id) => graficas.filter((g) => g.id === id).pop().config;

  async function abrirFbo() {
    document.getElementById('est-tab-fbo').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
  }

  test('pide el resumen del periodo y del anterior, con los filtros que le aplican a Aviación General', async () => {
    const { client } = await montarFbo(RESUMEN);
    document.getElementById('est-f-direccion').value = 'A';
    document.getElementById('est-f-nacint').value = 'Internacional';
    document.getElementById('est-btn-aplicar').click();
    await reposar();
    await abrirFbo();
    const anio = new Date().getFullYear();
    const anterior = window.EstadisticaMotor.periodoAnterior(`${anio}-01-01`, `${anio}-12-31`);
    const [actual, previo] = llamadasFbo(client).map((l) => l.params.p_filtros);
    expect(actual).toEqual({
      fecha_desde: `${anio}-01-01`, fecha_hasta: `${anio}-12-31`,
      tipo_operacion: 'LLEGADA', ambito_operacion: 'INTERNACIONAL'
    });
    expect(previo).toMatchObject({ fecha_desde: anterior.desde, fecha_hasta: anterior.hasta });
  });

  test('pinta la frase, las tarjetas, los destacados, la composición y las gráficas', async () => {
    const { graficas } = await montarFbo(RESUMEN);
    await abrirFbo();
    const frase = document.getElementById('est-fbo-frase').textContent;
    expect(frase).toContain('200');
    expect(frase).toContain('640');
    const kpis = document.getElementById('est-fbo-kpis');
    expect(kpis.querySelectorAll('.fbo-kpi')).toHaveLength(6);
    expect(kpis.textContent).toContain('Vuelos atendidos');
    expect(kpis.textContent).toContain('95');
    expect(document.getElementById('est-fbo-composicion').querySelectorAll('.fbo-comp')).toHaveLength(4);
    const destacados = document.getElementById('est-fbo-destacados').textContent;
    expect(destacados).toContain('JETS DEL NORTE');
    // 104 de 200 movimientos no traen origen/destino: se dice, no se esconde.
    expect(destacados).toContain('52 % sin origen / destino');
    expect(graficas.map((g) => g.id)).toEqual(expect.arrayContaining(
      ['est-fbo-mes', 'est-fbo-operadores', 'est-fbo-aeronaves', 'est-fbo-aeropuertos']));
    // Lo que no trae origen/destino no entra a la gráfica (la aplastaría): se dice debajo.
    expect(ultimaDe(graficas, 'est-fbo-aeropuertos').data.labels).toEqual(['MMTO']);
    const sinDato = document.getElementById('est-fbo-aeropuertos-sin');
    expect(sinDato.hidden).toBe(false);
    expect(sinDato.textContent).toContain('104 movimientos (52 %) no traen origen / destino');
    expect(document.getElementById('est-fbo-operadores-sin').hidden).toBe(true);
    expect(document.getElementById('est-fbo-matriculas').textContent).toContain('XA-ABC');
  });

  test('tocar una barra filtra todo el tablero, y el chip quita el filtro', async () => {
    const { client, graficas } = await montarFbo(RESUMEN);
    await abrirFbo();
    ultimaDe(graficas, 'est-fbo-operadores').options.onClick({}, [{ index: 0 }]);
    await reposar();
    expect(llamadasFbo(client).slice(-2)[0].params.p_filtros.operador).toBe('JETS DEL NORTE');
    expect(document.getElementById('est-fbo-filtro').textContent).toContain('JETS DEL NORTE');
    document.querySelector('#est-fbo-filtro [data-fbo-quitar]').click();
    await reposar();
    expect(llamadasFbo(client).slice(-2)[0].params.p_filtros).not.toHaveProperty('operador');
    expect(document.querySelector('#est-fbo-filtro [data-fbo-quitar]')).toBeNull();
  });

  test('una matrícula o un destacado también filtran', async () => {
    const { client } = await montarFbo(RESUMEN);
    await abrirFbo();
    document.querySelector('#est-fbo-matriculas [data-fbo-campo="matricula"]').click();
    await reposar();
    expect(llamadasFbo(client).slice(-2)[0].params.p_filtros.matricula).toBe('XA-ABC');
    document.querySelector('#est-fbo-destacados [data-fbo-campo="tipo_aeronave"]').click();
    await reposar();
    expect(llamadasFbo(client).slice(-2)[0].params.p_filtros.tipo_aeronave).toBe('G650');
  });

  test('con un filtro puesto, su destacado sobra y no se repite', async () => {
    const { graficas } = await montarFbo(RESUMEN);
    await abrirFbo();
    ultimaDe(graficas, 'est-fbo-operadores').options.onClick({}, [{ index: 0 }]);
    await reposar();
    const destacados = document.getElementById('est-fbo-destacados');
    expect(destacados.querySelector('[data-fbo-campo="operador"]')).toBeNull();
    expect(destacados.querySelector('[data-fbo-campo="tipo_aeronave"]')).not.toBeNull();
  });

  test('los nombres largos se abrevian en el eje y la frase concuerda en singular', async () => {
    const largo = 'AEROSERVICIOS EJECUTIVOS DEL CENTRO DE MEXICO';
    const uno = Object.assign({}, RESUMEN, {
      totales: Object.assign({}, RESUMEN.totales, { operadores: 1, llegadas: 1 }),
      top_operadores: [{ clave: largo, movimientos: 60, pax: 180 }]
    });
    const { graficas } = await montarFbo(uno);
    await abrirFbo();
    const eje = ultimaDe(graficas, 'est-fbo-operadores').options.scales.y.ticks.callback;
    const texto = eje.call({ getLabelForValue: () => largo }, 0);
    expect(texto.length).toBeLessThanOrEqual(24);
    expect(texto.endsWith('…')).toBe(true);
    // En una gráfica angosta caben menos letras.
    expect(eje.call({ chart: { width: 300 }, getLabelForValue: () => largo }, 0).length).toBeLessThanOrEqual(12);
    const frase = document.getElementById('est-fbo-frase').textContent;
    expect(frase).toContain('de 1 operador y');
    expect(frase).toContain('(1 llegada y');
  });

  test('el selector de la tendencia cambia a pasajeros sin volver a consultar', async () => {
    const { client, graficas } = await montarFbo(RESUMEN);
    await abrirFbo();
    const antes = llamadasFbo(client).length;
    document.querySelector('#est-pane-fbo [data-fbo-metrica="pax"]').click();
    const tendencia = ultimaDe(graficas, 'est-fbo-mes');
    expect(tendencia.data.datasets[0].label).toBe('Pasajeros');
    expect(tendencia.data.datasets[0].data).toEqual([250, 390]);
    expect(tendencia.data.datasets[1].label).toContain('Promedio mensual');
    expect(document.getElementById('est-fbo-t-mes').textContent).toBe('Pasajeros por mes');
    expect(llamadasFbo(client).length).toBe(antes);
  });

  test('"Limpiar" de la barra también quita lo elegido en el tablero', async () => {
    const { client, graficas } = await montarFbo(RESUMEN);
    await abrirFbo();
    ultimaDe(graficas, 'est-fbo-operadores').options.onClick({}, [{ index: 0 }]);
    await reposar();
    document.getElementById('est-btn-limpiar').click();
    await reposar();
    expect(llamadasFbo(client).slice(-2)[0].params.p_filtros).not.toHaveProperty('operador');
    expect(document.querySelector('#est-fbo-filtro [data-fbo-quitar]')).toBeNull();
  });

  test('avisa qué filtros de la barra no le aplican a Aviación General', async () => {
    const { client } = await montarFbo(RESUMEN);
    document.getElementById('est-f-segmento').value = 'GENERAL';
    document.getElementById('est-btn-aplicar').click();
    await reposar();
    await abrirFbo();
    const nota = document.getElementById('est-fbo-nota');
    expect(nota.classList.contains('d-none')).toBe(false);
    expect(nota.textContent).toContain('Segmento');
    expect(llamadasFbo(client)[0].params.p_filtros).not.toHaveProperty('segmento_aviacion');
  });

  test('un periodo sin movimientos lo dice y ofrece ver todo el histórico', async () => {
    const vacio = { totales: { movimientos: 0 }, por_mes: [], top_operadores: [], top_aeronaves: [], top_aeropuertos: [], top_matriculas: [] };
    await montarFbo((params) => ({ data: params.p_filtros.fecha_desde ? vacio : RESUMEN, error: null }));
    await abrirFbo();
    const caja = document.getElementById('est-fbo-vacio');
    expect(caja.classList.contains('d-none')).toBe(false);
    expect(document.getElementById('est-fbo-contenido').classList.contains('d-none')).toBe(true);
    expect(caja.textContent).toContain('02/01/2026');
    expect(caja.querySelector('[data-fbo-historico]').dataset.desde).toBe('2026-01-02');
    // Sin movimientos no hay nada que tocar: tampoco se ofrece la pista.
    expect(document.getElementById('est-fbo-filtro').textContent.trim()).toBe('');
  });

  test('los avisos de la operación del itinerario se ocultan en FBO y vuelven al salir', async () => {
    await montarFbo(RESUMEN);
    await abrirFbo();
    expect(document.getElementById('est-avisos').hidden).toBe(true);
    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    await reposar();
    expect(document.getElementById('est-avisos').hidden).toBe(false);
  });

  test('al cambiar a oscuro, las gráficas se repintan con colores legibles y sin consultar', async () => {
    const { client, graficas } = await montarFbo(RESUMEN);
    await abrirFbo();
    const antes = llamadasFbo(client).length;
    const claro = ultimaDe(graficas, 'est-fbo-operadores').options.scales.x.ticks.color;
    document.body.classList.add('dark-mode');
    await reposar();
    const oscuro = ultimaDe(graficas, 'est-fbo-operadores').options.scales.x.ticks.color;
    document.body.classList.remove('dark-mode');
    await reposar();
    expect(oscuro).not.toBe(claro);
    expect(llamadasFbo(client).length).toBe(antes);
  });

  test('si la base no tiene la función del resumen, lo explica', async () => {
    await montarFbo(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.aviacion_general_resumen' } }));
    await abrirFbo();
    expect(document.getElementById('est-error').textContent).toContain('migración 046');
  });
});

describe('mientras carga un área', () => {
  test('su botón muestra que carga, pero no se ve gris ni deshabilitado', async () => {
    await montar('admin');
    await reposar();
    const boton = document.getElementById('est-tab-carga');
    boton.dispatchEvent(new window.Event('shown.bs.tab'));
    expect(boton.classList.contains('est-cargando')).toBe(true);
    expect(boton.getAttribute('aria-busy')).toBe('true');
    expect(boton.classList.contains('opacity-50')).toBe(false);
    await reposar();
    expect(boton.classList.contains('est-cargando')).toBe(false);
    expect(boton.getAttribute('aria-busy')).toBe('false');
  });
});

describe('mientras se arma el reporte de un área', () => {
  test('en vez de un espacio vacío muestra un aviso con su avance, y al llegar los datos se quita', async () => {
    await montar('admin');
    await reposar();
    const pane = document.getElementById('est-pane-carga');
    document.getElementById('est-tab-carga').dispatchEvent(new window.Event('shown.bs.tab'));
    const aviso = pane.querySelector('.est-carga');
    expect(aviso).not.toBeNull();
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.textContent).toContain('Estamos creando el reporte');
    expect(aviso.querySelector('.est-carga-mensaje').textContent).toBe('Conectando con la base de datos…');
    expect(aviso.querySelector('.est-carga-porcentaje').textContent).toMatch(/^\d+ %$/);
    expect(aviso.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toMatch(/^\d+$/);
    expect(pane.classList.contains('est-pane-cargando')).toBe(true);
    await reposar();
    expect(pane.querySelector('.est-carga')).toBeNull();
    expect(pane.classList.contains('est-pane-cargando')).toBe(false);
  });

  test('si la consulta falla, el aviso también se quita y queda el error', async () => {
    const { client } = await montar('admin');
    await reposar();
    const original = client.rpc.getMockImplementation();
    client.rpc.mockImplementation(async (nombre, params) => (nombre === 'estadistica_agregado'
      ? { data: null, error: { message: 'canceling statement due to statement timeout' } }
      : original(nombre, params)));
    const pane = document.getElementById('est-pane-pasajeros');
    document.getElementById('est-tab-pasajeros').dispatchEvent(new window.Event('shown.bs.tab'));
    expect(pane.querySelector('.est-carga')).not.toBeNull();
    await reposar();
    expect(pane.querySelector('.est-carga')).toBeNull();
    expect(document.getElementById('est-error').textContent).toContain('statement timeout');
  });

  test('el porcentaje es una estimación que sube y no llega a 100 antes de tiempo', async () => {
    await montar('admin');
    const { porcentajeCarga } = window.EstadisticaPanel;
    expect(porcentajeCarga(0)).toBe(0);
    expect(porcentajeCarga(3)).toBeGreaterThan(porcentajeCarga(1));
    expect(porcentajeCarga(6)).toBe(60);
    expect(porcentajeCarga(600)).toBe(95);
  });
});

describe('nombres del panel', () => {
  // Pasó una vez: la función del aviso de carga se llamó igual que el
  // renderizador del área de Carga y lo tapó, así que el aviso relanzaba esa
  // consulta cada 300 ms. Dos funciones de primer nivel con el mismo nombre
  // no dan error: la segunda gana en silencio.
  test('ninguna función de primer nivel se declara dos veces', () => {
    const nombres = [...panelSource.replace(/\r\n/g, '\n').matchAll(/^    (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    const repetidos = [...new Set(nombres.filter((n, i) => nombres.indexOf(n) !== i))];
    expect(nombres.length).toBeGreaterThan(20);
    expect(repetidos).toEqual([]);
  });
});
