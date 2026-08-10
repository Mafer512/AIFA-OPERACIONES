// Simple static server for AIFA-OPERACIONES to avoid file:// CORS issues
const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const {
  MAX_FILE_BYTES,
  createWatermarkCode,
  decryptWatermarkCode,
  watermarkDocument,
  sanitizeDocumentName
} = require('./lib/watermark-service');

const fsp = fs.promises;

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname);
const DEV = process.env.NODE_ENV !== 'production';
const DATA_DIR = path.join(ROOT, 'data');
const CUSTOM_PARTE_FILE = path.join(DATA_DIR, 'custom_parte_operaciones.json');
const CUSTOM_STORE_DEFAULT = { dates: {}, updatedAt: null, version: 0 };
const APP_VERSION_FILES = [
  'index.html',
  'style.css',
  'script.js',
  'manifest.webmanifest',
  'js/core.js',
  'js/navigation.js',
  'js/itinerario.js'
];

function createDefaultStore() {
  return { dates: {}, updatedAt: null, version: 0 };
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sanitizeCustomEntry(entry) {
  const safeNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  };
  const tipo = (entry?.tipo || 'Sin clasificar').toString().trim();
  const llegada = safeNumber(entry?.llegada);
  const salida = safeNumber(entry?.salida);
  let subtotal = safeNumber(entry?.subtotal);
  if (!subtotal) subtotal = llegada + salida;
  return { tipo, llegada, salida, subtotal };
}

async function readCustomStore() {
  try {
    const raw = await fsp.readFile(CUSTOM_PARTE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createDefaultStore();
    return {
      dates: parsed.dates && typeof parsed.dates === 'object' ? parsed.dates : {},
      updatedAt: parsed.updatedAt || null,
      version: Number.isFinite(parsed.version) ? parsed.version : 0
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return createDefaultStore();
    }
    throw err;
  }
}

async function writeCustomStore(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(store, null, 2);
  await fsp.writeFile(CUSTOM_PARTE_FILE, payload, 'utf8');
}

async function getFileFingerprint(relPath) {
  try {
    const target = path.join(ROOT, relPath);
    const stat = await fsp.stat(target);
    return `${relPath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch (err) {
    return `${relPath}:missing`;
  }
}

async function computeAppVersionToken() {
  const signatures = await Promise.all(APP_VERSION_FILES.map(getFileFingerprint));
  return crypto.createHash('sha1').update(signatures.join('|')).digest('hex').slice(0, 16);
}

// CORS restringido a orígenes conocidos. Las peticiones same-origin (la propia
// SPA) y herramientas sin cabecera Origin no se ven afectadas; solo se limita el
// acceso cross-origin desde dominios no autorizados.
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const corsOptions = {
  origin(origin, callback) {
    // Sin Origin => same-origin, curl o server-to-server: permitido.
    if (!origin) return callback(null, true);
    if (LOCAL_ORIGIN_RE.test(origin)) return callback(null, true);
    if (EXTRA_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Denegar sin lanzar error: simplemente no se emiten cabeceras CORS.
    return callback(null, false);
  }
};
app.use(cors(corsOptions));
// Reduce de forma importante el peso de HTML, CSS, JS, JSON y SVG.
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '256kb' }));

// Cabeceras de cache + seguridad para assets y respuestas.
app.use((req, res, next) => {
  // El documento y la API deben revalidarse; los recursos con version en la URL
  // pueden permanecer en cache. express.static completa esta politica abajo.
  if (req.path === '/' || req.path.endsWith('.html') || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  // Sin CSP: la SPA usa scripts inline y múltiples CDNs (Bootstrap, Chart.js,
  // PDF.js, Tesseract, SheetJS); una CSP estricta requiere una allowlist probada.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // HSTS solo surte efecto sobre HTTPS; los navegadores lo ignoran en HTTP local.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// During development, block serving files from /www to avoid duplicate HTML/CSS/JS paths
if (DEV) {
  app.use('/www', (req, res) => {
    res.status(410).send('www folder disabled in development. Use root files only.');
  });
}

// Cliente Supabase para VALIDAR tokens de sesión en el servidor. Usa la anon key
// (pública por diseño); getUser() verifica el JWT contra Supabase sin exponer el
// service_role. Configurable por variables de entorno.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fgstncvuuhpgyzmjceyr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnc3RuY3Z1dWhwZ3l6bWpjZXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NzQ0NDQsImV4cCI6MjA4MTQ1MDQ0NH0.YEDIKuWt5iKUEI0BAvidINUz0aZBvQM0h6XRJ-uslB8';
const supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Middleware: exige una sesión Supabase válida (Authorization: Bearer <token>).
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const { data, error } = await supabaseAuthClient.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'Sesión inválida' });
    }
    req.user = data.user;
    req.accessToken = token;
    return next();
  } catch (err) {
    console.error('requireAuth failed', err);
    return res.status(401).json({ error: 'No autenticado' });
  }
}

function getRequesterClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}
async function requireMiscelaneaAccess(req, res, next) {
  try {
    const client = getRequesterClient(req.accessToken);
    const { data, error } = await client.rpc('can_use_miscelanea');
    if (error) { console.error('can_use_miscelanea failed', error); return res.status(503).json({ error: 'No se pudo comprobar el permiso de Miscelánea. Verifica que la migración esté aplicada.' }); }
    if (data !== true) return res.status(403).json({ error: 'No tienes acceso a Miscelánea.' });
    req.supabase = client;
    return next();
  } catch (err) { console.error('requireMiscelaneaAccess failed', err); return res.status(403).json({ error: 'No tienes acceso a Miscelánea.' }); }
}
const watermarkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 } });
function watermarkUserName(user) {
  const metadata = user?.user_metadata || {};
  const name = metadata.full_name || metadata.name || metadata.nombre || user?.email || 'Usuario AIFA';
  return String(name).trim().slice(0, 140) || 'Usuario AIFA';
}
function sendWatermarkError(res, error) {
  const status = error?.status || (error instanceof multer.MulterError ? 413 : 500);
  const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 'El documento excede el límite de 15 MB.' : (error?.message || 'No se pudo procesar el documento.');
  if (status >= 500) console.error('watermark request failed', error);
  return res.status(status).json({ error: message, code: error?.code || 'watermark_processing_failed' });
}

const api = express.Router();

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(ROOT, 'manifest.webmanifest'));
});

api.get('/app-version', async (req, res) => {
  try {
    const version = await computeAppVersionToken();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ version, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('GET /app-version failed', err);
    res.status(500).json({ error: 'No se pudo calcular la version del aplicativo' });
  }
});

api.post('/miscelanea/marca-agua/process', requireAuth, watermarkUpload.single('document'), requireMiscelaneaAccess, async (req, res) => {
  try {
    const issuedAt = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const documentName = sanitizeDocumentName(req.file?.originalname);
    const issuedByName = watermarkUserName(req.user);
    const payload = { v: 1, recordId, documentName, issuedAt, issuedByName, issuedBy: req.user.id };
    const watermarkCode = createWatermarkCode(payload, process.env.WATERMARK_ENCRYPTION_KEY);
    const result = await watermarkDocument(req.file, `AIFA - ${watermarkCode}`);
    const { error: insertError } = await req.supabase.from('document_watermarks').insert({ id: recordId, watermark_code: watermarkCode, document_name: result.name, document_sha256: result.sourceSha256, source_mime_type: result.mime, output_mime_type: result.outputMime, issued_at: issuedAt, issued_by: req.user.id, issued_by_name: issuedByName, encryption_version: 1 });
    if (insertError) {
      console.error('document_watermarks insert failed', insertError);
      const migrationMissing = /document_watermarks|relation|schema cache/i.test(insertError.message || '');
      const error = new Error(migrationMissing ? 'Falta aplicar la migración de Marca de agua en Supabase.' : 'No se pudo registrar la marca de agua.');
      error.status = migrationMissing ? 503 : 500;
      throw error;
    }
    res.setHeader('Content-Type', result.outputMime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.outputName)}`);
    res.setHeader('X-Watermark-Code', watermarkCode);
    res.setHeader('X-Watermark-Record-Id', recordId);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(result.output);
  } catch (error) { return sendWatermarkError(res, error); }
});
api.post('/miscelanea/marca-agua/validate', requireAuth, requireMiscelaneaAccess, async (req, res) => {
  try {
    let decoded;
    try { decoded = decryptWatermarkCode(req.body?.code, process.env.WATERMARK_ENCRYPTION_KEY); }
    catch (error) { return res.json({ valid: false, registered: false, decoded: false, message: error.message }); }
    const { data, error } = await req.supabase.rpc('validate_document_watermark', { p_code: decoded.code });
    if (error) { console.error('validate_document_watermark failed', error); throw Object.assign(new Error('No se pudo consultar el registro de la marca. Verifica que la migración esté aplicada.'), { status: 503 }); }
    const record = Array.isArray(data) ? data[0] : data;
    const registered = record?.registered === true && record.record_id === decoded.payload.recordId;
    if (!registered) return res.json({ valid: false, registered: false, decoded: true, details: { documentName: decoded.payload.documentName, issuedAt: decoded.payload.issuedAt, issuedByName: decoded.payload.issuedByName }, message: 'El código se descifró, pero no existe un registro vigente en AIFA Operaciones.' });
    return res.json({ valid: true, registered: true, decoded: true, details: { documentName: decoded.payload.documentName, issuedAt: decoded.payload.issuedAt, issuedByName: decoded.payload.issuedByName, validations: record.validation_count }, message: 'Marca de agua válida y registrada en AIFA Operaciones.' });
  } catch (error) { return sendWatermarkError(res, error); }
});

api.get('/parte-operaciones/custom', requireAuth, async (req, res) => {
  try {
    const store = await readCustomStore();
    const { date } = req.query || {};
    if (date && isIsoDate(date)) {
      return res.json({ date, entries: store.dates?.[date] || [] });
    }
    return res.json({ dates: store.dates || {}, updatedAt: store.updatedAt, version: store.version });
  } catch (err) {
    console.error('GET /parte-operaciones/custom failed', err);
    res.status(500).json({ error: 'No se pudo consultar el registro' });
  }
});

api.post('/parte-operaciones/custom', requireAuth, async (req, res) => {
  try {
    const { date, entries } = req.body || {};
    if (!isIsoDate(date)) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'Formato de entradas inválido' });
    }
    if (entries.length > 80) {
      return res.status(413).json({ error: 'Demasiadas filas. Limite 80 por día.' });
    }
    const sanitized = entries.map(sanitizeCustomEntry).filter((item) => item.tipo);
    const store = await readCustomStore();
    store.dates = store.dates || {};
    store.dates[date] = sanitized;
    store.updatedAt = new Date().toISOString();
    store.version = Number.isFinite(store.version) ? store.version + 1 : 1;
    await writeCustomStore(store);
    res.json({ ok: true, store: { dates: store.dates, updatedAt: store.updatedAt, version: store.version } });
  } catch (err) {
    console.error('POST /parte-operaciones/custom failed', err);
    res.status(500).json({ error: 'No se pudo guardar la captura' });
  }
});

api.delete('/parte-operaciones/custom/:date', requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!isIsoDate(date)) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }
    const store = await readCustomStore();
    if (store.dates && store.dates[date]) {
      delete store.dates[date];
      store.updatedAt = new Date().toISOString();
      store.version = Number.isFinite(store.version) ? store.version + 1 : 1;
      await writeCustomStore(store);
    }
    res.json({ ok: true, store: { dates: store.dates || {}, updatedAt: store.updatedAt, version: store.version } });
  } catch (err) {
    console.error('DELETE /parte-operaciones/custom/:date failed', err);
    res.status(500).json({ error: 'No se pudo eliminar la captura' });
  }
});

app.use('/api', api);

// Serve all static files from the repository root
app.use(express.static(ROOT, {
  index: 'index.html',
  etag: true,
  lastModified: true,
  maxAge: DEV ? 0 : '30d',
  immutable: !DEV,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Fallback for SPA routes: use a generic middleware (avoids path-to-regexp issues on Express 5)
app.use((req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// En local (o `npm start`) levantamos el servidor. En entornos serverless
// (p. ej. Vercel) se importa `app` sin escuchar en un puerto.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AIFA-OPERACIONES dev server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
