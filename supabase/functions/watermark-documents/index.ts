// AIFA Operaciones — Marca de agua verificable.
// Se ejecuta en Supabase Edge Functions para que GitHub Pages y Live Server
// puedan procesar documentos sin depender de un servidor Node propio.
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';
import { PDFDocument, StandardFonts, degrees, rgb } from 'npm:pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const WATERMARK_KEY = Deno.env.get('WATERMARK_ENCRYPTION_KEY') || '';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const PAYLOAD_VERSION = 'AIFA2';
const VISIBLE_CODE_RE = /^AIFA-[A-Z0-9]{10}$/;
const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-Watermark-Code',
};

class WatermarkError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function bytesToBase64url(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sanitiseName(value: string) {
  const name = String(value || 'documento').replace(/[\\/\0]/g, '_').trim();
  return name.slice(0, 180) || 'documento';
}

function outputName(name: string, extension: string) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 110) || 'documento';
  return `${base}_AIFA_marca.${extension}`;
}

async function encryptionKey() {
  if (!WATERMARK_KEY) throw new WatermarkError(503, 'Falta configurar WATERMARK_ENCRYPTION_KEY en los secretos de Supabase.');
  const raw = base64urlToBytes(WATERMARK_KEY);
  if (raw.length !== 32) throw new WatermarkError(503, 'WATERMARK_ENCRYPTION_KEY debe tener 32 bytes en Base64URL.');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(payload: unknown) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  const joined = new Uint8Array(iv.length + encrypted.length);
  joined.set(iv); joined.set(encrypted, iv.length);
  return `${PAYLOAD_VERSION}.${bytesToBase64url(joined)}`;
}

function visibleCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `AIFA-${Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')}`;
}

function normalizeVisibleCode(input: string) {
  const code = String(input || '').trim().toUpperCase().replace(/\s/g, '');
  if (!VISIBLE_CODE_RE.test(code)) throw new WatermarkError(400, 'El código debe tener el formato AIFA-XXXXXXXXXX.');
  return code;
}

async function decryptPayload(encryptedPayload: string) {
  if (!encryptedPayload?.startsWith(`${PAYLOAD_VERSION}.`)) throw new WatermarkError(400, 'El registro no contiene un payload cifrado válido.');
  const raw = base64urlToBytes(encryptedPayload.slice(PAYLOAD_VERSION.length + 1));
  if (raw.length <= 28) throw new WatermarkError(400, 'El payload cifrado está incompleto.');
  try {
    const key = await encryptionKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    const payload = JSON.parse(new TextDecoder().decode(plain));
    if (!payload?.recordId || !payload?.documentName || !payload?.issuedAt || !payload?.issuedByName) throw new Error('payload');
    return payload;
  } catch (error) {
    if (error instanceof WatermarkError) throw error;
    throw new WatermarkError(400, 'El registro no pudo descifrarse con la clave de AIFA.');
  }
}

async function documentHash(data: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function docxHeader(text: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom"/><v:textpath on="t" fitshape="t"/></v:shapetype><v:shape id="AifaWatermark" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;width:468pt;height:42pt;z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin;rotation:315" fillcolor="#58657f" stroked="f"><v:fill opacity=".25"/><v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt" string="${xmlEscape(text)}"/></v:shape></w:pict></w:r></w:p></w:hdr>`;
}

function repeatedDocxShapes(text: string) {
  const safeText = xmlEscape(text);
  return Array.from({ length: 7 }, (_, index) => {
    const top = (index + 1) * 113.386;
    return `<v:shape id="AifaWatermark${index + 2}" o:spid="_x0000_s${2050 + index}" type="#_x0000_t136" style="position:absolute;margin-top:${top}pt;width:468pt;height:42pt;z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical-relative:margin;rotation:315" fillcolor="#58657f" stroked="f"><v:fill opacity=".25"/><v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt" string="${safeText}"/></v:shape>`;
  }).join('');
}

async function watermarkPdf(data: Uint8Array, text: string) {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false }); }
  catch (_) { throw new WatermarkError(422, 'No fue posible abrir el PDF. Si tiene contraseña, elimina la protección antes de cargarlo.'); }
  if (pdf.isEncrypted) throw new WatermarkError(422, 'No se pueden procesar PDF protegidos con contraseña.');
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const verticalSpacing = 4 * 72 / 2.54; // 4 cm en puntos PDF
    const horizontalSpacing = 250;
    for (let y = -verticalSpacing; y < height + verticalSpacing; y += verticalSpacing) {
      for (let x = -horizontalSpacing; x < width + horizontalSpacing; x += horizontalSpacing) {
        page.drawText(text, { x, y, size: 18, font, color: rgb(.25, .29, .45), opacity: .24, rotate: degrees(35) });
      }
    }
  }
  pdf.setProducer('AIFA Operaciones — Marca de agua');
  pdf.setSubject(`Marca de agua verificable: ${text}`);
  return new Uint8Array(await pdf.save());
}

async function watermarkDocx(data: Uint8Array, text: string) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch (_) { throw new WatermarkError(422, 'No fue posible abrir el archivo Word.'); }
  const doc = zip.file('word/document.xml');
  const rels = zip.file('word/_rels/document.xml.rels');
  const types = zip.file('[Content_Types].xml');
  if (!doc || !rels || !types) throw new WatermarkError(422, 'El archivo no es un documento Word (.docx) compatible.');
  const [documentXml, relsXml, typesXml] = await Promise.all([doc.async('string'), rels.async('string'), types.async('string')]);
  let sections = 0;
  const updatedDocument = documentXml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (section) => {
    sections += 1;
    return section.includes('rIdAifaWatermark') ? section : section.replace(/(<w:sectPr\b[^>]*>)/, '$1<w:headerReference w:type="default" r:id="rIdAifaWatermark"/>');
  });
  if (!sections) throw new WatermarkError(422, 'El documento Word no contiene secciones compatibles para insertar la marca.');
  zip.file('word/document.xml', updatedDocument);
  zip.file('word/_rels/document.xml.rels', relsXml.includes('Id="rIdAifaWatermark"') ? relsXml : relsXml.replace('</Relationships>', '<Relationship Id="rIdAifaWatermark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="headerAifaWatermark.xml"/></Relationships>'));
  zip.file('[Content_Types].xml', typesXml.includes('PartName="/word/headerAifaWatermark.xml"') ? typesXml : typesXml.replace('</Types>', '<Override PartName="/word/headerAifaWatermark.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
  zip.file('word/headerAifaWatermark.xml', docxHeader(text).replace('</w:pict>', `${repeatedDocxShapes(text)}</w:pict>`));
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
}

async function requester(req: Request) {
  const token = req.headers.get('Authorization') || '';
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: token } } });
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new WatermarkError(401, 'Sesión inválida.');
  const { data: allowed, error: permissionError } = await client.rpc('can_use_miscelanea');
  if (permissionError) throw new WatermarkError(503, 'No se pudo comprobar el permiso de Miscelánea. Verifica la migración.');
  if (allowed !== true) throw new WatermarkError(403, 'No tienes acceso a Miscelánea.');
  return { client, user: auth.user };
}

async function processDocument(req: Request, client: ReturnType<typeof createClient>, user: { id: string; email?: string; user_metadata?: Record<string, string> }) {
  const form = await req.formData();
  const file = form.get('document');
  if (!(file instanceof File)) throw new WatermarkError(400, 'Selecciona un documento PDF o Word (.docx).');
  if (file.size > MAX_FILE_BYTES) throw new WatermarkError(413, 'El documento excede el límite de 15 MB.');
  const name = sanitiseName(file.name);
  const extension = name.split('.').pop()?.toLowerCase();
  const data = new Uint8Array(await file.arrayBuffer());
  const isPdf = extension === 'pdf' && new TextDecoder().decode(data.slice(0, 5)) === '%PDF-';
  const isDocx = extension === 'docx' && data[0] === 0x50 && data[1] === 0x4b;
  if (extension === 'doc') throw new WatermarkError(415, 'Los archivos .doc antiguos deben guardarse como .docx antes de aplicar la marca.');
  if (!isPdf && !isDocx) throw new WatermarkError(415, 'Solo se admiten archivos PDF y Word (.docx) válidos.');
  const issuedAt = new Date().toISOString();
  const issuedByName = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Usuario AIFA').slice(0, 140);
  const recordId = crypto.randomUUID();
  const code = visibleCode();
  const encryptedPayload = await encryptPayload({ v: 2, recordId, documentName: name, issuedAt, issuedByName, issuedBy: user.id });
  const output = isPdf ? await watermarkPdf(data, code) : await watermarkDocx(data, code);
  const sourceMime = isPdf ? PDF_MIME : DOCX_MIME;
  const { error } = await client.from('document_watermarks').insert({ id: recordId, watermark_code: code, encrypted_payload: encryptedPayload, document_name: name, document_sha256: await documentHash(data), source_mime_type: sourceMime, output_mime_type: sourceMime, issued_at: issuedAt, issued_by: user.id, issued_by_name: issuedByName, encryption_version: 2 });
  if (error) throw new WatermarkError(503, /document_watermarks|schema cache|relation/i.test(error.message || '') ? 'Falta aplicar la migración de Marca de agua en Supabase.' : 'No se pudo registrar la marca de agua.');
  return new Response(output, { headers: { ...CORS_HEADERS, 'Content-Type': sourceMime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(outputName(name, isPdf ? 'pdf' : 'docx'))}`, 'X-Watermark-Code': code, 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const { client, user } = await requester(req);
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) return processDocument(req, client, user);
    const body = await req.json();
    if (body?.action !== 'validate') throw new WatermarkError(400, 'Acción no válida.');
    const code = normalizeVisibleCode(body.code);
    const { data, error } = await client.rpc('validate_document_watermark', { p_code: code });
    if (error) throw new WatermarkError(503, 'No se pudo consultar el registro de la marca. Verifica la migración.');
    const record = Array.isArray(data) ? data[0] : data;
    if (record?.registered !== true) return json({ valid: false, registered: false, decoded: false, message: 'El código no existe en el registro de AIFA Operaciones.' });
    const payload = await decryptPayload(record.encrypted_payload);
    const valid = record.record_id === payload.recordId;
    return json(valid ? { valid: true, registered: true, decoded: true, details: { documentName: payload.documentName, issuedAt: payload.issuedAt, issuedByName: payload.issuedByName, validations: record.validation_count }, message: 'Marca de agua válida y registrada en AIFA Operaciones.' } : { valid: false, registered: true, decoded: false, message: 'El registro no coincide con los datos cifrados.' });
  } catch (error) {
    const known = error instanceof WatermarkError;
    if (!known) console.error(error);
    return json({ error: known ? error.message : 'No se pudo procesar el documento.' }, known ? error.status : 500);
  }
});
