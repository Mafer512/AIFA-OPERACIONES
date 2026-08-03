const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL || 'https://fgstncvuuhpgyzmjceyr.supabase.co';
const key = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!key) throw new Error('Falta SUPABASE_SERVICE_KEY. Configúrala localmente; no la escribas en el repositorio.');
if (/[^\x21-\x7E]/.test(key)) throw new Error('SUPABASE_SERVICE_KEY contiene espacios o caracteres invisibles. Copia únicamente el valor de la clave.');
if (/"role"\s*:\s*"anon"/.test(Buffer.from((key.split('.')[1] || ''), 'base64url').toString('utf8'))) throw new Error('SUPABASE_SERVICE_KEY no puede ser una clave anon.');

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const report = JSON.parse(fs.readFileSync(path.join(root, 'muebles_bienes_documentos_auditoria.json'), 'utf8'));
const pdfDir = path.join(root, 'carpeta pdfs');
const safe = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

async function checkSchema() {
  const [goods, bucket] = await Promise.all([
    sb.from('muebles_bienes').select('id', { count: 'exact', head: true }),
    sb.storage.getBucket('muebles-bienes-documentos')
  ]);
  if (goods.error) throw goods.error;
  if (goods.count !== 573) throw new Error(`Se esperaban 573 registros y Supabase reportó ${goods.count}.`);
  if (bucket.error) throw bucket.error;
  if (bucket.data.public) throw new Error('El bucket no debe ser público.');
}

async function targetGoods(file) {
  let query = sb.from('muebles_bienes').select('id,numero_serie,resguardo_folio');
  if (file.association === 'exact_folio') query = query.eq('resguardo_folio', file.folio);
  else if (file.association === 'exact_serial') query = query.eq('numero_serie', file.serial);
  else return [];
  const { data, error } = await query;
  if (error) throw error;
  if (data.length !== file.matchedGoods) throw new Error(`${file.name}: se esperaban ${file.matchedGoods} bienes y se encontraron ${data.length}.`);
  return data;
}

async function uploadOne(file) {
  const goods = await targetGoods(file);
  const existing = await sb.from('muebles_bienes_documentos_archivos').select('*').eq('sha256', file.sha256).maybeSingle();
  if (existing.error) throw existing.error;
  let doc = existing.data;
  let uploaded = false;
  if (!doc) {
    const folder = file.folio ? safe(file.folio) : safe(file.serial);
    const storagePath = `${folder}/${file.sha256.slice(0,16)}-${safe(file.name)}`;
    if (apply) {
      const bytes = fs.readFileSync(path.join(pdfDir, file.name));
      const up = await sb.storage.from('muebles-bienes-documentos').upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
      if (up.error && !/already exists/i.test(up.error.message)) throw up.error;
      const created = await sb.from('muebles_bienes_documentos_archivos').insert({ tipo_documento: 'Resguardo', nombre_original: file.name, storage_path: storagePath, mime_type: 'application/pdf', tamano_bytes: file.size, sha256: file.sha256 }).select().single();
      if (created.error) throw created.error;
      doc = created.data; uploaded = true;
    } else doc = { id: `dry-${file.sha256.slice(0,8)}`, storage_path: storagePath };
  }
  if (apply) {
    const links = goods.map(g => ({ bien_id: g.id, documento_id: doc.id }));
    const linked = await sb.from('muebles_bienes_documentos').upsert(links, { onConflict: 'bien_id,documento_id', ignoreDuplicates: true });
    if (linked.error) throw linked.error;
  }
  return { file: file.name, uploaded, goods: goods.length, documentId: doc.id };
}

(async () => {
  await checkSchema();
  const safeFiles = report.files.filter(file => file.association === 'exact_folio' || file.association === 'exact_serial');
  const results = [];
  for (const file of safeFiles) results.push(await uploadOne(file));
  const totals = { mode: apply ? 'APPLY' : 'DRY_RUN', documentsProcessed: results.length, uploaded: results.filter(r => r.uploaded).length, relationships: results.reduce((n,r)=>n+r.goods,0), pendingExcluded: report.pendingFiles };
  if (apply) {
    const [docs, links] = await Promise.all([
      sb.from('muebles_bienes_documentos_archivos').select('id',{count:'exact',head:true}),
      sb.from('muebles_bienes_documentos').select('bien_id',{count:'exact',head:true})
    ]);
    if (docs.error) throw docs.error; if (links.error) throw links.error;
    totals.databaseDocuments = docs.count; totals.databaseRelationships = links.count;
  }
  console.log(JSON.stringify({ totals, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
