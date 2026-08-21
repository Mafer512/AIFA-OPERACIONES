/**
 * @jest-environment jsdom
 *
 * Archivo aparte (a propósito): al montar el módulo vía window.eval() varias
 * veces en el MISMO documento (como hace estadistico-informe-ui.test.js), los
 * listeners de document.addEventListener('DOMContentLoaded', ...) de montajes
 * previos se quedan pegados y se re-disparan en cada dispatch posterior. Para
 * esta prueba en concreto (dispara un click real y espera la cadena async
 * completa de "dar visto bueno") eso duplica llamadas y ensucia console.error.
 * Un archivo de test propio le da a esta prueba un jsdom nuevo sin ese arrastre.
 */

const fs = require('fs');
const path = require('path');

const Core = require('../js/estadistico-informe-core');

const uiSource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'estadistico-informe.js'), 'utf8');

const resumenRows = [
  { anio: 2025, mes: 1, tipo_aviacion: 'comercial', direccion: 'A', nacional_internacional: 'Nacional', operaciones: 10, pax_total: 1000, carga_kg_total: 0 },
];
const aerolineaRows = [
  { anio: 2025, mes: 1, aerolinea: 'VOLARIS', tipo_aviacion: 'comercial', direccion: 'A', operaciones: 10, pax_total: 1000, carga_kg_total: 0 },
];
const monthlyOpsRows = [{ year: 2025, month: 1, general_ops: 2, general_pax: 6 }];
const annualOpsRows = [{ year: 2025, general_ops_total: 2, general_pax_total: 6 }];
// Con capacidad_matricula para que sí se construya la tabla de Factor de
// Ocupación (si va vacía, esa sección cae al mensaje de "sin datos").
const normalizadoRows = [
  { fecha_operacion: '2025-01-10', direccion: 'A', es_carga: false, pax_total: 150, carga_kg: 0, aerolinea: 'VIVA AEROBUS', endpoint_code: 'CUN', nacional_internacional: 'Nacional', capacidad_matricula: 186 },
  { fecha_operacion: '2025-01-10', direccion: 'D', es_carga: false, pax_total: 170, carga_kg: 0, aerolinea: 'VIVA AEROBUS', endpoint_code: 'CUN', nacional_internacional: 'Nacional', capacidad_matricula: 186 },
];

function makeQuery(data, error = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const chain = {
    select: () => makeQuery(data, error),
    eq: () => makeQuery(data, error),
    gte: () => makeQuery(data, error),
    lte: () => makeQuery(data, error),
    range: () => makeQuery(data, error),
    maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? (data[0] || null) : (data ?? null), error }),
    then: (...args) => promise.then(...args),
    catch: (...args) => promise.catch(...args),
    finally: (...args) => promise.finally(...args),
  };
  return chain;
}

function buildSupabaseStub() {
  const fixtures = {
    v_informe_estadistico_resumen: resumenRows,
    v_informe_estadistico_aerolinea: aerolineaRows,
    monthly_operations: monthlyOpsRows,
    annual_operations: annualOpsRows,
    v_informe_manifiestos_normalizado: normalizadoRows,
    // El informe nombra el destino por ciudad ("CANCÚN"), no por código de ruta.
    catalogo_aeropuertos: [{ iata: 'CUN', ciudad: 'Cancún' }],
    informe_estadistico_aprobaciones: [],
  };
  return {
    from: jest.fn(table => ({
      select: () => makeQuery(fixtures[table] ?? [], null),
      upsert: () => Promise.resolve({ data: null, error: null }),
    })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(async () => ({ data: {}, error: null })),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://example.com/test.pdf' } })),
      })),
    },
  };
}

function domMarkup() {
  return `
    <button id="tab-conci-estadistica" class="active"></button>
    <select id="informe-est-anio"></select>
    <select id="informe-est-anio-comparar"></select>
    <span id="informe-est-visto-bueno-badge"></span>
    <button id="informe-est-btn-refresh"></button>
    <button id="informe-est-btn-excel"></button>
    <button id="informe-est-btn-csv"></button>
    <button id="informe-est-btn-visto-bueno" class="d-none"></button>
    <div class="alert d-none" id="informe-est-error"></div>
    <div class="alert d-none" id="informe-est-alertas"></div>
    <div id="informe-est-root">
      <div id="informe-est-acumulado"></div>
      <div id="informe-est-dia"></div>
      <div class="d-none" id="informe-est-proyeccion"></div>
      <canvas id="informe-est-chart-mensual"></canvas>
      <table id="informe-est-tabla-mensual"><thead></thead><tbody></tbody></table>
      <div class="d-none" id="informe-est-comparativa">
        <table id="informe-est-tabla-comparativa"><thead></thead><tbody></tbody></table>
      </div>
      <table id="informe-est-tabla-aerolinea"><thead></thead><tbody></tbody></table>
      <table id="informe-est-tabla-ocupacion"><thead></thead><tbody></tbody></table>
      <span id="informe-est-ocupacion-promedio"></span>
    </div>`;
}

async function waitForRender() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!document.getElementById('informe-est-anio').innerHTML) {
      await new Promise(resolve => setTimeout(resolve, 0));
      continue;
    }
    return;
  }
  throw new Error('El Informe Estadístico no terminó de renderizar.');
}

describe('generación de PDF del Informe Estadístico (visto bueno)', () => {
  let consoleError;

  beforeEach(async () => {
    document.body.innerHTML = domMarkup();
    window.InformeEstadisticoCore = Core;
    window.supabaseClient = buildSupabaseStub();
    window.sectionLevel = () => 'admin';
    // jsdom no implementa URL.createObjectURL/revokeObjectURL (los navegadores reales sí).
    window.URL.createObjectURL = jest.fn(() => 'blob:mock');
    window.URL.revokeObjectURL = jest.fn();
    // Tampoco implementa getContext('2d'); si se deja tal cual, jsdom escupe un
    // "Not implemented" por consola. Devolver null a propósito además ejercita
    // el camino degradado del rebanado de páginas (una hoja == una imagen).
    window.HTMLCanvasElement.prototype.getContext = () => null;
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    window.eval(uiSource);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await waitForRender();
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    delete window.InformeEstadisticoCore;
    delete window.supabaseClient;
    delete window.sectionLevel;
    delete window.html2pdf;
    delete window.html2canvas;
    delete window.jspdf;
    delete window.URL.createObjectURL;
    delete window.URL.revokeObjectURL;
  });

  test('construye el reporte completo (Comercial/General/Carga, ocupación, Puntos de Conexión) sin lanzar errores', async () => {
    let capturedHtml = '';
    const hojasRasterizadas = [];
    let opcionesPdf = null;
    window.html2canvas = async (el) => {
      hojasRasterizadas.push(el);
      capturedHtml += el.outerHTML;
      return { width: 716, height: 1000, toDataURL: () => 'data:image/jpeg;base64,AAAA' };
    };
    window.jspdf = {
      jsPDF: class {
        constructor(opts) { opcionesPdf = opts; this.paginas = 1; }
        get internal() { return { pageSize: { getWidth: () => 215.9, getHeight: () => 355.6 } }; }
        addPage() { this.paginas += 1; }
        addImage() {}
        output() { return new Blob(['pdf']); }
      },
    };

    document.getElementById('informe-est-btn-visto-bueno').click();
    for (let attempt = 0; attempt < 40 && hojasRasterizadas.length < 2; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    expect(capturedHtml).toContain('INFORME ESTADÍSTICO');
    expect(capturedHtml).toContain('AVIACIÓN COMERCIAL');
    expect(capturedHtml).toContain('AVIACIÓN GENERAL');
    expect(capturedHtml).toContain('AVIACIÓN DE CARGA');
    expect(capturedHtml).toContain('FACTOR DE OCUPACIÓN PROMEDIO');
    expect(capturedHtml).toContain('PUNTOS DE CONEXIÓN AIFA - CDMX');
    expect(capturedHtml).toContain('Durango');
    expect(capturedHtml).toContain('TOTAL POR AÑO');
    expect(capturedHtml).toContain('ACUMULADO');

    // Regresión: el PDF salía horizontal (landscape) y luego, ya vertical, en
    // A4 — el documento autorizado es OFICIO (legal). Con A4 las tablas
    // quedaban más apretadas y el corte de página no coincidía.
    expect(opcionesPdf.orientation).toBe('portrait');
    expect(opcionesPdf.format).toBe('legal');
    // Una .informe-hoja se rasteriza una sola vez (luego se rebana en páginas
    // a escala fija); antes html2pdf paginaba solo y colaba el encabezado de
    // la hoja 2 al pie de la 1.
    expect(hojasRasterizadas).toHaveLength(2);
    expect(hojasRasterizadas.every(el => el.classList.contains('informe-hoja'))).toBe(true);

    // Regresión de rendimiento: el informe se arma dentro de un iframe propio,
    // no colgado de la página. html2canvas clona el documento ENTERO al que
    // pertenece cada elemento; con el marcado en index.html eso significaba
    // clonar toda la aplicación una vez por hoja, y el Resumen Estadístico
    // (17 hojas) se quedaba más de un minuto sin responder.
    expect(hojasRasterizadas.every(el => el.ownerDocument !== document)).toBe(true);
    // Y el iframe se retira al terminar: no deja basura en la página.
    expect(document.querySelectorAll('iframe')).toHaveLength(0);

    // Detalles del formato AUTORIZADO que el usuario rechazó explícitamente
    // cuando no coincidían. Los colores se muestrearon del PDF de referencia,
    // así que un cambio aquí es un cambio de formato, no un detalle estético.
    expect(capturedHtml).toContain('ENERO');            // meses en MAYÚSCULAS
    expect(capturedHtml).toContain('DICIEMBRE');
    expect(capturedHtml).not.toContain('>Enero<');      // no Title Case
    expect(capturedHtml).toContain('#D4C19C');          // fila de años, lado OPERACIONES
    expect(capturedHtml).toContain('#0D1F2D');          // fila de años, lado PASAJEROS
    expect(capturedHtml).toContain('#F3ECDD');          // súper-encabezado OPERACIONES
    expect(capturedHtml).toContain('#DEEBF7');          // súper-encabezado PASAJEROS
    expect(capturedHtml).toContain('#DADADA');          // fila TOTAL POR AÑO
    expect(capturedHtml).toContain('#BFBFBF');          // etiqueta ACUMULADO
    expect(capturedHtml).toContain('#9D2449');          // guinda de los números grandes
    expect(capturedHtml).toContain('TONS. TRANSPORTADAS');
    expect(capturedHtml).toContain('AHORRO DE TIEMPO'); // columna de Puntos de Conexión
    expect(capturedHtml).toContain('Promedio General');
    // El original no lleva títulos encima de las tablas de Puntos de Conexión.
    expect(capturedHtml).not.toContain('Rutas de conexión foránea');
    // Fechas en texto largo, nunca en ISO: "Del 28 de julio de 2026 al …".
    expect(capturedHtml).toContain('Periodo promediado');
    expect(capturedHtml).not.toMatch(/Del \d{4}-\d{2}-\d{2}/);
    // Toneladas siempre con dos decimales.
    expect(capturedHtml).toMatch(/>0\.00</);
    // Destino por ciudad, no por código de ruta.
    expect(capturedHtml).toContain('CANCÚN');
    expect(capturedHtml).not.toMatch(/>CUN</);
    expect(uiSource).toContain("font-family:'Montserrat'"); // tipografía institucional
  });
});
