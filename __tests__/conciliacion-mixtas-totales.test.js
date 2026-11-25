/**
 * @jest-environment jsdom
 *
 * Aerolíneas MIXTAS en las tarjetas de Conciliación › Manifiestos.
 *
 * Mixtas: aerolíneas de pasajeros que también llevan carga (Volaris,
 * Aeroméxico, Viva Aerobus, Mexicana y Conviasa; js/conci-carga-catalogo.js).
 *
 * Regla (sólo mixtas; las cargueras cuentan operación de carga y kilos):
 *   · Cada fila de mixta es un vuelo: una operación de pasajeros, sus
 *     pasajeros y sus kilos, aunque no traiga pasajeros. Nunca operación de
 *     carga.
 *   · Excepción: la fila sin pasajeros que es la carga aparte de UN vuelo de
 *     pasajeros ya contado (misma aerolínea, número, fecha, sentido y la misma
 *     hora de slot, que las dos filas deben traer): sólo suma kilos. Se queda
 *     en la tabla.
 *   · Vuelos de la misma llave cuentan todos; si comparten la hora de slot o a
 *     alguno le falta, se marcan para revisión.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8').replace(/\r\n/g, '\n');
const source = leer('script.js');
const css = leer('style.css');

function extraer(nombre) {
  const marca = `function ${nombre}(`;
  const inicio = source.indexOf(marca);
  if (inicio === -1) throw new Error(`No se encontró ${nombre} en script.js`);
  return source.slice(inicio, source.indexOf('\n}\n', inicio) + 2);
}
function extraerLinea(prefijo) {
  const inicio = source.indexOf(prefijo);
  if (inicio === -1) throw new Error(`No se encontró ${prefijo} en script.js`);
  return source.slice(inicio, source.indexOf('\n', inicio));
}

// Catálogo de aerolíneas de la tabla, como lo resuelve _conciResolveAirlineMeta:
// las mixtas están ahí SOLO como pasajeros.
const CATALOGO = [
  { name: 'VOLARIS', iata: 'Y4', types: ['pasajeros'] },
  { name: 'VIVA AEROBUS', iata: 'VB', types: ['pasajeros'] },
  { name: 'AEROMEXICO', iata: 'AM', types: ['pasajeros'] },
  { name: 'MEXICANA DE AVIACION', iata: 'XN', types: ['pasajeros'] },
  { name: 'CONVIASA', iata: 'V0', types: ['pasajeros'] },
  { name: 'COPA AIRLINES', iata: 'CM', types: ['pasajeros'] },
  { name: 'MAS AIR', iata: 'MY', types: ['carga'] },
  { name: 'CARGOLUX', iata: 'CV', types: ['carga'] },
];
window._conciResolveAirlineMeta = (valor) => {
  const v = String(valor || '').trim().toUpperCase();
  return CATALOGO.find(a => a.iata === v || a.name === v) || null;
};
// El catálogo de carga real, con su lista de mixtas.
new Function(leer('js/conci-carga-catalogo.js'))();

// La fecha de corte real (25/11/2026) y la que usan estas pruebas.
const LINEA_CORTE = extraerLinea('const _CONCI_REGLA_MIXTAS_DESDE = ');
const CORTE = '2026-11-25';

const api = new Function('document', 'window', `
  let _conciEditFallbackYear = 2026;
  ${LINEA_CORTE.replace(/= .*;$/, `= '${CORTE}';`)}
  ${extraerLinea('const _CONCI_MONTHS = ')}
  function _conciResolveAirlineMeta(valor) { return window._conciResolveAirlineMeta(valor); }
  ${extraer('_conciResolveYear')}
  ${extraer('_conciParseDateTimeParts')}
  ${extraer('_conciIsoDateKey')}
  ${extraer('_conciNumeroDeVuelo')}
  ${extraer('_conciSummaryColumnKey')}
  ${extraer('_conciSummaryNumber')}
  ${extraer('_conciSummaryFindColumn')}
  ${extraer('_conciSummaryHasValue')}
  ${extraer('_conciSummaryCargoColumns')}
  ${extraer('_conciSummaryCargoKgs')}
  ${extraer('_conciEsInformativo')}
  ${extraer('_conciRowIsCargo')}
  ${extraer('_conciAerolineaMixta')}
  ${extraer('_conciEsAerolineaMixta')}
  ${extraer('_conciColumnasDeTotales')}
  ${extraer('_conciLlaveVueloMixta')}
  ${extraer('_conciFechaIsoMixta')}
  ${extraer('_conciReglaNuevaAplica')}
  ${extraer('_conciContextoTotales')}
  ${extraer('_conciEstadoFilaMixta')}
  ${extraer('_conciFilaMixtaARevisar')}
  ${extraer('_conciTipoParaTotales')}
  ${extraer('_updateManifiestosSummaryStrip')}
  return {
    _conciEsAerolineaMixta, _conciLlaveVueloMixta, _conciContextoTotales, _conciEstadoFilaMixta,
    _conciFilaMixtaARevisar, _conciTipoParaTotales, _conciEsInformativo, _conciRowIsCargo,
    _updateManifiestosSummaryStrip,
  };
`)(document, window);

const COLUMNAS = [
  'FECHA', 'AEROLINEA', 'TIPO DE MANIFIESTO', 'TIPO DE OPERACIÓN', '# DE VUELO', 'DESTINO / ORIGEN',
  'SLOT ASIGNADO', 'TOTAL PAX', 'KGS. DE EQUIPAJE', 'KGS. DE CARGA NACIONAL',
  'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL',
];

const fila = (aerolinea, vuelo, tipo, campos = {}) => ({
  FECHA: '25/11/2026', AEROLINEA: aerolinea, '# DE VUELO': vuelo, 'TIPO DE MANIFIESTO': tipo, ...campos,
});

// Los casos. Todos el 25/11/2026.
const CASOS = {
  // Vuelo de pasajeros de Volaris, con carga en bodega en su misma fila.
  P1: fila('Y4', 'Y4 1001', 'LLEGADA', { 'DESTINO / ORIGEN': 'CUN', 'SLOT ASIGNADO': '25NOV 10:15', 'TOTAL PAX': '180', 'KG DE CARGA TOTAL': '200' }),
  // Carga aparte de P1: mismo vuelo y misma hora de slot (escrita en otro formato).
  C1: fila('Y4', '1001', 'LLEGADA', { 'DESTINO / ORIGEN': 'CUN-NLU', 'SLOT ASIGNADO': '25/11/2026 10:15', 'TOTAL PAX': '0', 'KG DE CARGA TOTAL': '3000' }),
  // Sin pasajeros y con kilos, sin vuelo de pasajeros Y4 1777: es el vuelo.
  C2: fila('Y4', 'Y4 1777', 'SALIDA', { 'DESTINO / ORIGEN': 'TIJ', 'TOTAL PAX': '0', 'KG DE CARGA TOTAL': '1500' }),
  // Mismo número que P1, abierta, sin slot, sin pasajeros ni kilos.
  C3: fila('Y4', 'Y41001', 'LLEGADA', { 'DESTINO / ORIGEN': 'CUN-NLU', 'TOTAL PAX': '', 'KG DE CARGA TOTAL': '' }),
  // Fila vacía de Volaris sin vuelo de pasajeros equivalente.
  C3b: fila('Y4', 'Y4 1888', 'SALIDA', { 'DESTINO / ORIGEN': 'GDL', 'TOTAL PAX': '', 'KG DE CARGA TOTAL': '' }),
  // Dos rotaciones del mismo número el mismo día, con slots distintos.
  R1: fila('XN', 'XN 1107', 'LLEGADA', { 'DESTINO / ORIGEN': 'MTY-NLU-MTY', 'SLOT ASIGNADO': '25NOV 01:55', 'TOTAL PAX': '150' }),
  R2: fila('XN', 'XN 1107', 'LLEGADA', { 'DESTINO / ORIGEN': 'MTY-NLU-BJX', 'SLOT ASIGNADO': '25/11/2026 23:05', 'TOTAL PAX': '160' }),
  // Carga aparte de R2: misma hora de slot.
  RC1: fila('XN', '1107', 'LLEGADA', { 'SLOT ASIGNADO': '25NOV 23:05', 'TOTAL PAX': '0', 'KG DE CARGA TOTAL': '900' }),
  // Carga sin slot: no se puede atribuir a R1 ni a R2.
  RC2: fila('XN', '1107', 'LLEGADA', { 'TOTAL PAX': '0', 'KG DE CARGA TOTAL': '500' }),
  // Carguera pura.
  MY: fila('MY', 'MY 300', 'LLEGADA', { 'KG DE CARGA TOTAL': '20000' }),
  // Carguero de una mixta: sin vuelo de pasajeros equivalente.
  AM: fila('AM', 'AM 9001', 'SALIDA', { 'TIPO DE OPERACIÓN': 'F', 'TOTAL PAX': '0', 'KG DE CARGA TOTAL': '40000' }),
};

const ctxDe = rows => api._conciContextoTotales(rows, COLUMNAS);
const DIA = Object.values(CASOS);
const ctxDia = ctxDe(DIA);
const tipo = nombre => api._conciTipoParaTotales(CASOS[nombre], ctxDia);
const estado = nombre => api._conciEstadoFilaMixta(CASOS[nombre], ctxDia);
const revisar = nombre => api._conciFilaMixtaARevisar(CASOS[nombre], ctxDia);

function pintarTarjetas(rows) {
  document.body.innerHTML = `
    <div id="manifiestos-summary-strip" class="d-none">
      <span id="mf-sum-pax-ops"></span><span id="mf-sum-total-pax"></span>
      <span id="mf-sum-cargo-ops"></span><span id="mf-sum-kgs-carga"></span>
    </div>`;
  api._updateManifiestosSummaryStrip(rows, COLUMNAS);
  const n = id => Number(document.getElementById(id).textContent.replace(/[^0-9]/g, ''));
  return {
    paxOps: n('mf-sum-pax-ops'), totalPax: n('mf-sum-total-pax'),
    cargaOps: n('mf-sum-cargo-ops'), kgs: n('mf-sum-kgs-carga'),
  };
}
const tarjetasDe = (...nombres) => pintarTarjetas(nombres.map(n => CASOS[n]));

describe('aerolíneas mixtas', () => {
  test.each(['Y4', 'VOLARIS', 'VB', 'AM', 'XN', 'V0'])('%s es mixta', (aerolinea) => {
    expect(api._conciEsAerolineaMixta({ AEROLINEA: aerolinea }, 'AEROLINEA')).toBe(true);
  });

  test.each(['MY', 'CV', 'COPA CARGO', ''])('%s no es mixta', (aerolinea) => {
    expect(api._conciEsAerolineaMixta({ AEROLINEA: aerolinea }, 'AEROLINEA')).toBe(false);
  });

  test('al cerrar manda la aerolínea reportada', () => {
    expect(api._conciEsAerolineaMixta({ AEROLINEA: 'CM', cierre_aerolinea_reportada: 'COPA CARGO' }, 'AEROLINEA')).toBe(false);
    expect(api._conciEsAerolineaMixta({ AEROLINEA: 'XX', cierre_aerolinea_reportada: 'MEXICANA' }, 'AEROLINEA')).toBe(true);
  });
});

describe('llave del vuelo', () => {
  const ctx = ctxDe([]);
  const llave = row => api._conciLlaveVueloMixta(row, ctx);

  test('el número se normaliza: con o sin código, pegado y con ceros a la izquierda', () => {
    const claves = ['Y4 1001', '1001', 'Y41001', 'Y4-01001']
      .map(v => llave(fila('Y4', v, 'LLEGADA')).clave);
    expect(new Set(claves).size).toBe(1);
  });

  test('la aerolínea se compara por su código: "Y4" y "VOLARIS" son la misma', () => {
    expect(llave(fila('VOLARIS', '1001', 'LLEGADA')).clave).toBe(llave(fila('Y4', '1001', 'LLEGADA')).clave);
  });

  test('el slot se normaliza a HH:MM: "22NOV 23:35" y "23/11/2026 23:35" son la misma hora', () => {
    expect(llave(fila('XN', '1943', 'SALIDA', { 'SLOT ASIGNADO': '22NOV 23:35' })).slot).toBe('23:35');
    expect(llave(fila('XN', '1943', 'SALIDA', { 'SLOT ASIGNADO': '23/11/2026 23:35' })).slot).toBe('23:35');
    expect(llave(fila('XN', '1943', 'SALIDA', { 'SLOT ASIGNADO': '7:05' })).slot).toBe('07:05');
  });

  test('el sentido y la fecha separan vuelos', () => {
    const base = llave(fila('Y4', '1001', 'LLEGADA')).clave;
    expect(llave(fila('Y4', '1001', 'SALIDA')).clave).not.toBe(base);
    expect(llave({ ...fila('Y4', '1001', 'LLEGADA'), FECHA: '26/11/2026' }).clave).not.toBe(base);
  });

  test('sin número, fecha o sentido no hay llave', () => {
    expect(llave(fila('Y4', '', 'LLEGADA'))).toBeNull();
    expect(llave(fila('Y4', '1001', ''))).toBeNull();
    expect(llave({ ...fila('Y4', '1001', 'LLEGADA'), FECHA: '' })).toBeNull();
  });
});

describe('los casos, uno por uno (tarjetas de cada caso solo)', () => {
  test('P1 · vuelo de pasajeros de mixta: 1 op PAX, sus pasajeros y sus kilos', () => {
    expect(tipo('P1')).toBe('pax');
    expect(tarjetasDe('P1')).toEqual({ paxOps: 1, totalPax: 180, cargaOps: 0, kgs: 200 });
  });

  test('C1 · carga aparte de P1 con la misma hora de slot: sólo suma kilos, sin operación, en la tabla', () => {
    expect(estado('C1')).toBe('carga-de-vuelo');
    expect(tipo('C1')).toBe('carga-mixta');
    expect(tarjetasDe('P1', 'C1')).toEqual({ paxOps: 1, totalPax: 180, cargaOps: 0, kgs: 3200 });
  });

  test('C1 sin slot · no se puede atribuir a P1: es un vuelo, 1 op PAX, y las dos se revisan', () => {
    const c1SinSlot = { ...CASOS.C1, 'SLOT ASIGNADO': '' };
    const ctx = ctxDe([CASOS.P1, c1SinSlot]);
    expect(api._conciTipoParaTotales(c1SinSlot, ctx)).toBe('pax');
    expect(api._conciFilaMixtaARevisar(c1SinSlot, ctx)).toBe(true);
    expect(api._conciFilaMixtaARevisar(CASOS.P1, ctx)).toBe(true);
  });

  test('C2 · sin pasajeros y sin vuelo de pasajeros: 1 op PAX y sus kilos', () => {
    expect(estado('C2')).toBe('vuelo');
    expect(tarjetasDe('C2')).toEqual({ paxOps: 1, totalPax: 0, cargaOps: 0, kgs: 1500 });
  });

  test('C2 cerrada como carga sigue siendo un vuelo de pasajeros: una mixta nunca cuenta op de carga', () => {
    const cerrada = { ...CASOS.C2, cierre_id: 9, cierre_es_carga_reportado: true };
    expect(pintarTarjetas([cerrada])).toEqual({ paxOps: 1, totalPax: 0, cargaOps: 0, kgs: 1500 });
  });

  test('C3 · sin slot, sin pasajeros ni kilos: 1 op PAX, no suma pasajeros ni carga; se revisa junto con P1', () => {
    expect(estado('C3')).toBe('vuelo');
    expect(tarjetasDe('C3')).toEqual({ paxOps: 1, totalPax: 0, cargaOps: 0, kgs: 0 });
    expect(revisar('C3')).toBe(true);
    expect(revisar('P1')).toBe(true);
  });

  test('C3b · fila vacía sin vuelo de pasajeros equivalente: 1 op PAX, sin revisión', () => {
    expect(estado('C3b')).toBe('vuelo');
    expect(revisar('C3b')).toBe(false);
  });

  test('R1 y R2 · slots distintos: 2 op PAX, sin revisión', () => {
    const ctx = ctxDe([CASOS.R1, CASOS.R2]);
    expect(api._conciFilaMixtaARevisar(CASOS.R1, ctx)).toBe(false);
    expect(api._conciFilaMixtaARevisar(CASOS.R2, ctx)).toBe(false);
    expect(tarjetasDe('R1', 'R2')).toEqual({ paxOps: 2, totalPax: 310, cargaOps: 0, kgs: 0 });
  });

  test('R1 y R2 · el mismo slot (retraso que se junta con el siguiente): 2 op PAX, las dos se revisan', () => {
    const r2MismoSlot = { ...CASOS.R2, 'SLOT ASIGNADO': '25/11/2026 01:55' };
    const ctx = ctxDe([CASOS.R1, r2MismoSlot]);
    expect(api._conciFilaMixtaARevisar(CASOS.R1, ctx)).toBe(true);
    expect(api._conciFilaMixtaARevisar(r2MismoSlot, ctx)).toBe(true);
    expect(pintarTarjetas([CASOS.R1, r2MismoSlot])).toEqual({ paxOps: 2, totalPax: 310, cargaOps: 0, kgs: 0 });
  });

  test('R1 y R2 · a una le falta el slot: se revisan', () => {
    const r2SinSlot = { ...CASOS.R2, 'SLOT ASIGNADO': '' };
    const ctx = ctxDe([CASOS.R1, r2SinSlot]);
    expect(api._conciFilaMixtaARevisar(CASOS.R1, ctx)).toBe(true);
    expect(api._conciFilaMixtaARevisar(r2SinSlot, ctx)).toBe(true);
  });

  test('RC1 · carga aparte de R2 (misma hora de slot): sólo suma kilos', () => {
    expect(estado('RC1')).toBe('carga-de-vuelo');
    expect(tarjetasDe('R1', 'R2', 'RC1')).toEqual({ paxOps: 2, totalPax: 310, cargaOps: 0, kgs: 900 });
  });

  test('RC2 · sin slot: suma 1 op PAX y sus kilos, y se revisa', () => {
    expect(estado('RC2')).toBe('vuelo');
    expect(revisar('RC2')).toBe(true);
    expect(tarjetasDe('R1', 'R2', 'RC2')).toEqual({ paxOps: 3, totalPax: 310, cargaOps: 0, kgs: 500 });
  });

  test('dos vuelos de pasajeros con el mismo slot y una carga con ese slot: no se elige, 1 op PAX y se revisa', () => {
    const duplicado = { ...CASOS.R1, 'DESTINO / ORIGEN': 'MTY' };
    const carga = fila('XN', '1107', 'LLEGADA', { 'SLOT ASIGNADO': '25NOV 01:55', 'TOTAL PAX': '0', 'KG DE CARGA TOTAL': '700' });
    const ctx = ctxDe([CASOS.R1, duplicado, carga]);
    expect(api._conciEstadoFilaMixta(carga, ctx)).toBe('ambigua');
    expect(api._conciTipoParaTotales(carga, ctx)).toBe('pax');
    expect(api._conciFilaMixtaARevisar(carga, ctx)).toBe(true);
  });

  test('MY · carguera pura: 1 op de carga y sus kilos', () => {
    expect(tipo('MY')).toBe('carga');
    expect(tarjetasDe('MY')).toEqual({ paxOps: 0, totalPax: 0, cargaOps: 1, kgs: 20000 });
  });

  test('carguero de mixta · 1 op PAX y sus kilos (aunque su tipo de servicio sea F)', () => {
    expect(estado('AM')).toBe('vuelo');
    expect(tarjetasDe('AM')).toEqual({ paxOps: 1, totalPax: 0, cargaOps: 0, kgs: 40000 });
  });

  test('el equipaje no es carga', () => {
    const conEquipaje = fila('Y4', 'Y4 2000', 'SALIDA', { 'TOTAL PAX': '0', 'KGS. DE EQUIPAJE': '900' });
    expect(pintarTarjetas([conEquipaje])).toEqual({ paxOps: 1, totalPax: 0, cargaOps: 0, kgs: 0 });
  });

  test('un vuelo marcado INFORMATIVO no cuenta ni sirve de pareja', () => {
    const informativo = { ...CASOS.P1, INFORMATIVO: true };
    const ctx = ctxDe([informativo, CASOS.C1]);
    expect(api._conciTipoParaTotales(informativo, ctx)).toBe('informativo');
    expect(api._conciTipoParaTotales(CASOS.C1, ctx)).toBe('pax');
  });

  test('las filas "Solo Vuelos" quedan fuera de la regla', () => {
    const soloVuelos = { ...fila('Y4', '1001', 'LLEGADA', { 'TOTAL PAX': '' }), _fuente: 'Solo Vuelos' };
    expect(api._conciEstadoFilaMixta(soloVuelos, ctxDe([CASOS.P1, soloVuelos]))).toBeNull();
    const soloConPax = { ...CASOS.P1, _fuente: 'Solo Vuelos' };
    expect(api._conciEstadoFilaMixta(CASOS.C1, ctxDe([soloConPax, CASOS.C1]))).toBe('vuelo');
  });
});

describe('tarjetas del día con todos los casos', () => {
  // Op PAX: P1, C2, C3, C3b, R1, R2, RC2 y AM = 8. Pasajeros: 180 + 150 + 160.
  // Op de carga: la carguera MY = 1. C1 y RC1 sólo suman kilos.
  // Kilos: P1 200 + C1 3,000 + C2 1,500 + RC1 900 + RC2 500 + MY 20,000 + AM 40,000.
  test('8 op PAX, 490 pax, 1 op de carga, 66,100 kg', () => {
    expect(pintarTarjetas(DIA)).toEqual({ paxOps: 8, totalPax: 490, cargaOps: 1, kgs: 66100 });
  });

  test('a revisar: P1 y C3 (C3 sin slot), y R1, R2 y RC2 (RC2 sin slot)', () => {
    const marcadas = Object.keys(CASOS).filter(revisar);
    expect(marcadas).toEqual(['P1', 'C3', 'R1', 'R2', 'RC2']);
  });

  test('un vuelo marcado INFORMATIVO no cambia nada, ni sus kilos', () => {
    const conInformativo = [...DIA, fila('VB', 'VB 500', 'SALIDA', { 'TOTAL PAX': '150', 'KG DE CARGA TOTAL': '400', INFORMATIVO: true })];
    expect(pintarTarjetas(conInformativo)).toEqual({ paxOps: 8, totalPax: 490, cargaOps: 1, kgs: 66100 });
  });
});

describe('fecha de corte: los días anteriores no cambian', () => {
  // El mismo día de casos, pero un día antes del corte.
  const antesDelCorte = filas => filas.map(r => ({ ...r, FECHA: '24/11/2026' }));
  const DIA_ANTERIOR = antesDelCorte(DIA);
  // Totales del CÓDIGO ORIGINAL (HEAD, antes de la regla de mixtas) para ese
  // día, calculados con su _updateManifiestosSummaryStrip.
  const ORIGINAL = { paxOps: 10, totalPax: 490, cargaOps: 1, kgs: 66100 };
  const ORIGINAL_C1_CERRADA = { paxOps: 9, totalPax: 490, cargaOps: 2, kgs: 66100 };

  test('ninguna función de script.js se declara dos veces (la segunda pisaría a la primera)', () => {
    const nombres = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
    const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i);
    expect(repetidos).toEqual([]);
  });

  test('la fecha de corte vive en un solo lugar y es null o AAAA-MM-DD', () => {
    expect(source.split('const _CONCI_REGLA_MIXTAS_DESDE = ').length - 1).toBe(1);
    expect(LINEA_CORTE).toMatch(/= (null|'\d{4}-\d{2}-\d{2}');$/);
  });

  test('un día anterior al corte da los mismos totales que el código original', () => {
    expect(pintarTarjetas(DIA_ANTERIOR)).toEqual(ORIGINAL);
  });

  test('también con la carga de un vuelo ya cerrada como carga', () => {
    const conC1Cerrada = DIA_ANTERIOR.map(r =>
      (r['# DE VUELO'] === '1001' && r['SLOT ASIGNADO'] ? { ...r, cierre_id: 9, cierre_es_carga_reportado: true } : r));
    expect(pintarTarjetas(conC1Cerrada)).toEqual(ORIGINAL_C1_CERRADA);
  });

  test('antes del corte cada fila se clasifica exactamente como en el original', () => {
    const ctx = ctxDe(DIA_ANTERIOR);
    for (const row of DIA_ANTERIOR) {
      const original = api._conciEsInformativo(row) ? 'informativo'
        : (api._conciRowIsCargo(row, ctx.optypeCol, ctx.airlineCol) ? 'carga' : 'pax');
      expect(api._conciTipoParaTotales(row, ctx)).toBe(original);
      expect(api._conciEstadoFilaMixta(row, ctx)).toBeNull();
      expect(api._conciFilaMixtaARevisar(row, ctx)).toBe(false);
    }
  });

  test('sin fecha de corte (null) la regla nueva no aplica a ningún día', () => {
    const ctx = api._conciContextoTotales(DIA, COLUMNAS, null);
    expect(DIA.every(row => api._conciEstadoFilaMixta(row, ctx) === null)).toBe(true);
    expect(ctx.revisar.size).toBe(0);
  });

  test('una fila sin FECHA legible se cuenta como antes', () => {
    const sinFecha = { ...CASOS.C1, FECHA: '' };
    expect(api._conciEstadoFilaMixta(sinFecha, ctxDe([CASOS.P1, sinFecha]))).toBeNull();
  });

  test('en un rango que cruza el corte, cada fila sigue la regla de su FECHA', () => {
    const rango = [...DIA_ANTERIOR, ...DIA];
    expect(pintarTarjetas(rango)).toEqual({
      paxOps: ORIGINAL.paxOps + 8, totalPax: 980, cargaOps: ORIGINAL.cargaOps + 1, kgs: 132200,
    });
  });
});

describe('tabla', () => {
  test('marca las filas de mixtas a revisar, con aviso al pasar el cursor', () => {
    const render = source.slice(source.indexOf('function _renderConciManifiestosTable('));
    expect(render).toMatch(/_conciFilaMixtaARevisar\(row, _contextoTotales\)\) \{[\s\S]*?tr\.classList\.add\('conci-row-revisar-mixta'\);\s+tr\.title = 'Revisar:/);
  });

  test('los vuelos INFORMATIVO se muestran en su lugar, como antes (sin sección aparte)', () => {
    expect(source).not.toContain('conci-seccion-informativos');
    expect(css).not.toContain('conci-seccion-informativos');
  });

  test('estilos de la fila a revisar, claro y oscuro', () => {
    expect(css).toContain('#table-conci-manifiestos tbody tr.conci-row-revisar-mixta>td:first-child {');
    expect(css).toContain('body.dark-mode #table-conci-manifiestos tbody tr.conci-row-revisar-mixta>td:first-child {');
  });
});
