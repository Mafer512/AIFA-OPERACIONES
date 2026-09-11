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
  const inicio = indexSource.indexOf('<ul class="nav nav-pills gap-1 mb-3 flex-wrap" id="est-subnav"');
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
