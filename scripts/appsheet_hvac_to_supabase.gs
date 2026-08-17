/**
 * ═══════════════════════════════════════════════════════════════════
 *  SYNC: Google Sheet (AppSheet HVAC) → Supabase  (Google Apps Script)
 * ───────────────────────────────────────────────────────────────────
 *  Cómo instalar:
 *   1. Abre el Google Sheet que usa AppSheet como backend.
 *   2. Menú: Extensiones → Apps Script.
 *   3. Borra el contenido y pega TODO este archivo.
 *   4. Ajusta SHEET_NAME si tu hoja no se llama "Reportes".
 *   5. Pon tu SERVICE_ROLE key (Supabase → Settings → API → service_role).
 *      ⚠️  Úsala SOLO aquí (servidor de Google), NUNCA en el front-end.
 *   6. Ejecuta una vez la función  setupTrigger  (autoriza permisos).
 *   7. Ejecuta  syncAll  una vez para la carga inicial.
 *  A partir de ahí, cada cambio en la hoja se envía a Supabase en segundos.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────
var SUPABASE_URL  = 'https://fgstncvuuhpgyzmjceyr.supabase.co';
var SUPABASE_KEY  = 'PEGA_AQUI_TU_SERVICE_ROLE_KEY';   // service_role (secreto)
var TABLE         = 'reportes_hvac';
var CONFLICT_COL  = 'reporte_id';                      // columna única para upsert
var SHEET_NAME    = 'Reportes';                        // ← nombre de la pestaña

// Mapa: encabezado EXACTO del Sheet  →  columna de Supabase
var COLUMN_MAP = {
  'Reporte ID'               : 'reporte_id',
  'Fecha'                    : 'fecha',
  'Quien elabora'            : 'quien_elabora',
  'ID'                       : 'id_registro',
  'Módulo'                   : 'modulo',
  'Nivel'                    : 'nivel',
  'Equipo'                   : 'equipo',
  'Tag'                      : 'tag',
  'No. de Serie'             : 'no_serie',
  'Dirección solicitante'    : 'direccion_solicitante',
  'Subdirección solicitante' : 'subdireccion_solicitante',
  'Gerencia solicitante'     : 'gerencia_solicitante',
  'Motivo de atención'       : 'motivo_atencion',
  'Revisión'                 : 'revision',
  'Mantenimiento'            : 'mantenimiento',
  'Estado'                   : 'estado',
  'Observaciones'            : 'observaciones',
  'Firma'                    : 'firma'
};

// Columnas que deben enviarse como fecha ISO (YYYY-MM-DD)
var DATE_COLUMNS = ['fecha'];

// Cuántas filas explorar al inicio buscando la fila de encabezados
// (la fila 1 suele ser un título/banner, no los encabezados reales).
var HEADER_SEARCH_ROWS = 10;

// ─── Encuentra la fila de encabezados (la que contiene "Reporte ID") ──
//  Devuelve el índice 0-based de esa fila dentro de `data`, o -1.
function findHeaderRow(data) {
  var limit = Math.min(HEADER_SEARCH_ROWS, data.length);
  for (var r = 0; r < limit; r++) {
    var row = data[r];
    for (var c = 0; c < row.length; c++) {
      if (COLUMN_MAP[String(row[c]).trim()] === 'reporte_id') return r;
    }
  }
  return -1;
}

// ─── TRIGGER: instala el disparador onChange (ejecuta UNA vez) ────────
function setupTrigger() {
  // Elimina triggers previos de esta función para no duplicar
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onSheetChange') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();
  Logger.log('Trigger onChange instalado correctamente.');
}

// ─── DIAGNÓSTICO: ejecuta esto para ver qué lee el script ────────────
//  Muestra: pestañas disponibles, pestaña usada, encabezados detectados,
//  número de filas y si "Reporte ID" coincide con el mapa.
function debugSheet() {
  var ss = SpreadsheetApp.getActive();

  // 1) Lista todas las pestañas del libro
  var tabs = ss.getSheets().map(function (s) {
    return '"' + s.getName() + '" (' + s.getLastRow() + ' filas)';
  });
  Logger.log('PESTAÑAS DISPONIBLES: ' + tabs.join('  |  '));

  // 2) Pestaña que el script intentará usar
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('⚠️ No existe una pestaña llamada "' + SHEET_NAME +
               '". Usando la pestaña activa: "' + ss.getActiveSheet().getName() + '".');
    sheet = ss.getActiveSheet();
  } else {
    Logger.log('Pestaña usada: "' + SHEET_NAME + '"');
  }

  // 3) Detecta la fila de encabezados real (saltando títulos/banners)
  var data = sheet.getDataRange().getValues();
  if (!data.length) { Logger.log('La pestaña está vacía.'); return; }
  var hr = findHeaderRow(data);
  if (hr === -1) {
    Logger.log('❌ NO se encontró "Reporte ID" en las primeras ' + HEADER_SEARCH_ROWS +
               ' filas. Encabezados de la fila 1: ' +
               data[0].map(function (h) { return '[' + h + ']'; }).join(' '));
    return;
  }
  var headers = data[hr];
  Logger.log('Fila de encabezados detectada: fila ' + (hr + 1));
  Logger.log('ENCABEZADOS DETECTADOS (' + headers.length + '): ' +
             headers.map(function (h) { return '[' + h + ']'; }).join(' '));
  Logger.log('FILAS DE DATOS: ' + (data.length - hr - 1));

  // 4) Confirma columnas mapeadas vs. no reconocidas
  var mapped = [], unknown = [];
  headers.forEach(function (h) {
    var key = String(h).trim();
    if (!key) return;
    if (COLUMN_MAP[key]) mapped.push(key); else unknown.push(key);
  });
  Logger.log('✅ Columnas reconocidas (' + mapped.length + '): ' + mapped.join(', '));
  if (unknown.length) Logger.log('⚠️ Columnas NO mapeadas (se ignorarán): ' + unknown.join(', '));
}

// ─── Se ejecuta automáticamente en cada cambio de la hoja ────────────
function onSheetChange(e) {
  try {
    syncAll();
  } catch (err) {
    Logger.log('Error en onSheetChange: ' + err);
  }
}

// ─── Lee toda la hoja y hace upsert en Supabase ──────────────────────
function syncAll() {
  var ss    = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet();
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('Sin filas de datos.'); return; }

  var hr = findHeaderRow(data);
  if (hr === -1) {
    Logger.log('No se encontró la fila de encabezados ("Reporte ID"). Ejecuta debugSheet.');
    return;
  }
  var headers = data[hr];
  var rows    = data.slice(hr + 1);

  var payload = [];
  rows.forEach(function (row) {
    var obj = {};
    headers.forEach(function (h, i) {
      var col = COLUMN_MAP[String(h).trim()];
      if (!col) return;                 // ignora columnas no mapeadas
      var val = row[i];
      if (val === '' || val === null || val === undefined) { obj[col] = null; return; }
      if (DATE_COLUMNS.indexOf(col) !== -1) {
        obj[col] = toISODate(val);
      } else {
        obj[col] = String(val);
      }
    });
    // Solo filas con clave de negocio válida
    if (obj[CONFLICT_COL]) payload.push(obj);
  });

  if (!payload.length) { Logger.log('Nada que sincronizar.'); return; }

  // Dos filas de la hoja con el mismo "Reporte ID" tumban la sincronización
  // ENTERA, no solo esa fila: el upsert va en una sola sentencia y Postgres
  // responde
  //
  //     ON CONFLICT DO UPDATE command cannot affect row a second time
  //
  // porque no puede insertar y actualizar la misma fila en el mismo comando.
  // Se manda una sola vez cada Reporte ID, la última, que es la que gana en un
  // upsert de todas formas.
  var limpio = dedupePorClave(payload, CONFLICT_COL);
  var repetidos = Object.keys(limpio.repetidas);
  if (repetidos.length) {
    Logger.log('⚠️ ' + repetidos.length + ' "Reporte ID" repetidos en la hoja. ' +
               'Se envía la última fila de cada uno, pero conviene corregir la hoja: ' +
               repetidos.map(function (k) {
                 return k + ' (x' + limpio.repetidas[k] + ')';
               }).join(', '));
  }

  upsertBatch(limpio.filas);
}

// ─── Quita repetidos por clave, quedándose con el último ─────────────
//  Devuelve { filas: [...], repetidas: { clave: cuántas veces } }.
function dedupePorClave(filas, clave) {
  var ultima    = Object.create(null);   // sin prototipo: ninguna clave choca
  var orden     = [];
  var repetidas = Object.create(null);

  filas.forEach(function (fila) {
    var k = String(fila[clave]);
    if (k in ultima) repetidas[k] = (repetidas[k] || 1) + 1;
    else             orden.push(k);
    ultima[k] = fila;
  });

  return {
    filas: orden.map(function (k) { return ultima[k]; }),
    repetidas: repetidas
  };
}

// ─── DIAGNÓSTICO: qué "Reporte ID" están repetidos en la hoja ────────
//  No manda nada a Supabase; solo informa. Útil para limpiar el origen.
function debugDuplicados() {
  var ss    = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet();
  var data  = sheet.getDataRange().getValues();
  var hr    = findHeaderRow(data);
  if (hr === -1) { Logger.log('No se encontró la fila de encabezados.'); return; }

  var headers = data[hr];
  var col = -1;
  headers.forEach(function (h, i) {
    if (COLUMN_MAP[String(h).trim()] === CONFLICT_COL) col = i;
  });
  if (col === -1) { Logger.log('No se encontró la columna "Reporte ID".'); return; }

  var vistos = Object.create(null);
  var repes  = [];
  data.slice(hr + 1).forEach(function (row, i) {
    var k = String(row[col]).trim();
    if (!k) return;
    if (k in vistos) repes.push('"' + k + '" en las filas ' + vistos[k] + ' y ' + (hr + i + 2));
    else vistos[k] = hr + i + 2;
  });

  if (!repes.length) Logger.log('✅ Sin "Reporte ID" repetidos.');
  else {
    Logger.log('❌ ' + repes.length + ' repetido(s), y esto es lo que tumba la sincronización:');
    repes.forEach(function (r) { Logger.log('   ' + r); });
  }
}

// ─── POST upsert a Supabase REST ─────────────────────────────────────
function upsertBatch(payload) {
  var url = SUPABASE_URL + '/rest/v1/' + TABLE +
            '?on_conflict=' + CONFLICT_COL;
  var options = {
    method            : 'post',
    contentType       : 'application/json',
    headers           : {
      'apikey'        : SUPABASE_KEY,
      'Authorization' : 'Bearer ' + SUPABASE_KEY,
      'Prefer'        : 'resolution=merge-duplicates,return=minimal'
    },
    payload           : JSON.stringify(payload),
    muteHttpExceptions: true
  };
  var res  = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    Logger.log('Sincronizado OK (' + payload.length + ' filas).');
  } else {
    Logger.log('Error Supabase ' + code + ': ' + res.getContentText());
  }
}

// ─── Convierte un valor de celda a fecha ISO YYYY-MM-DD ──────────────
function toISODate(val) {
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var d = new Date(val);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return null;
}
