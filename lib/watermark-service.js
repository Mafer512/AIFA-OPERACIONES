'use strict';

const crypto = require('crypto');
const JSZip = require('jszip');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');

const CODE_VERSION = 'AIFA1';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

function httpError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function readEncryptionKey(rawKey) {
    if (!rawKey) {
        throw httpError(503, 'La clave de cifrado de marcas de agua no está configurada.', 'watermark_key_missing');
    }
    let key;
    try {
        key = Buffer.from(String(rawKey), 'base64url');
    } catch (_) {
        key = Buffer.alloc(0);
    }
    if (key.length !== 32) {
        throw httpError(503, 'La clave de cifrado de marcas de agua es inválida.', 'watermark_key_invalid');
    }
    return key;
}

function sanitizeDocumentName(value) {
    const name = String(value || 'documento').replace(/[\\/\0]/g, '_').trim();
    return name.slice(0, 180) || 'documento';
}

function normalizeWatermarkCode(value) {
    const code = String(value || '').trim().replace(/^AIFA\s*-\s*/i, '');
    if (!new RegExp(`^${CODE_VERSION}\\.[A-Za-z0-9_-]{30,}$`).test(code)) {
        throw httpError(400, 'El código de marca de agua no tiene un formato válido.', 'invalid_watermark_code');
    }
    return code;
}

function createWatermarkCode(payload, rawKey) {
    const key = readEncryptionKey(rawKey);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encoded = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${CODE_VERSION}.${base64url(Buffer.concat([iv, encoded, tag]))}`;
}

function decryptWatermarkCode(value, rawKey) {
    const code = normalizeWatermarkCode(value);
    const key = readEncryptionKey(rawKey);
    const raw = Buffer.from(code.slice(CODE_VERSION.length + 1), 'base64url');
    if (base64url(raw) !== code.slice(CODE_VERSION.length + 1)) {
        throw httpError(400, 'El código no pudo descifrarse con la clave de AIFA.', 'watermark_decryption_failed');
    }
    if (raw.length <= 28) {
        throw httpError(400, 'El código de marca de agua está incompleto.', 'invalid_watermark_code');
    }
    try {
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(raw.length - 16);
        const encoded = raw.subarray(12, raw.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const parsed = JSON.parse(Buffer.concat([decipher.update(encoded), decipher.final()]).toString('utf8'));
        if (!parsed || parsed.v !== 1 || !parsed.recordId || !parsed.documentName || !parsed.issuedAt || !parsed.issuedByName) {
            throw new Error('payload inválido');
        }
        return { code, payload: parsed };
    } catch (_) {
        throw httpError(400, 'El código no pudo descifrarse con la clave de AIFA.', 'watermark_decryption_failed');
    }
}

function detectDocument(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw httpError(400, 'Selecciona un documento PDF o Word (.docx).', 'missing_document');
    }
    if (file.buffer.length > MAX_FILE_BYTES) {
        throw httpError(413, 'El documento excede el límite de 15 MB.', 'document_too_large');
    }
    const name = sanitizeDocumentName(file.originalname);
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (extension === 'pdf' && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
        return { type: 'pdf', name, mime: PDF_MIME };
    }
    if (extension === 'docx' && file.buffer.subarray(0, 2).toString('ascii') === 'PK') {
        return { type: 'docx', name, mime: DOCX_MIME };
    }
    if (extension === 'doc') {
        throw httpError(415, 'Los archivos .doc antiguos no se pueden marcar de forma segura. Guárdalos como .docx e inténtalo de nuevo.', 'legacy_word_not_supported');
    }
    throw httpError(415, 'Solo se admiten archivos PDF y Word (.docx) válidos.', 'unsupported_document');
}

function safeOutputName(name, extension) {
    const base = name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 110) || 'documento';
    return `${base}_AIFA_marca.${extension}`;
}

async function watermarkPdf(input, visibleText) {
    let pdf;
    try {
        pdf = await PDFDocument.load(input, { ignoreEncryption: false, updateMetadata: false });
    } catch (error) {
        throw httpError(422, 'No fue posible abrir el PDF. Si está protegido con contraseña, elimina la protección antes de cargarlo.', 'pdf_unreadable');
    }
    if (pdf.isEncrypted) {
        throw httpError(422, 'No se pueden procesar PDF protegidos con contraseña.', 'pdf_encrypted');
    }
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        const diagonal = Math.sqrt((width * width) + (height * height));
        const unitWidth = Math.max(font.widthOfTextAtSize(visibleText, 1), 1);
        const fontSize = Math.max(3.5, Math.min(9, (diagonal * 0.84) / unitWidth));
        const textWidth = font.widthOfTextAtSize(visibleText, fontSize);
        page.drawText(visibleText, {
            x: (width - textWidth) / 2,
            y: height / 2,
            size: fontSize,
            font,
            color: rgb(0.25, 0.29, 0.45),
            opacity: 0.34,
            rotate: degrees(42)
        });
    }
    pdf.setProducer('AIFA Operaciones — Marca de agua');
    pdf.setSubject(`Marca de agua verificable: ${visibleText}`);
    pdf.setModificationDate(new Date());
    return Buffer.from(await pdf.save());
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildDocxHeader(visibleText) {
    const text = xmlEscape(visibleText);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:pict>
    <v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>
    <v:shape id="AifaWatermark" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:42pt;z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin;rotation:315" fillcolor="#58657f" stroked="f"><v:fill opacity=".25"/><v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt" string="${text}"/><w10:wrap xmlns:w10="urn:schemas-microsoft-com:office:word" anchorx="margin" anchory="margin"/></v:shape>
  </w:pict></w:r></w:p>
</w:hdr>`;
}

function addContentTypeOverride(xml) {
    if (xml.includes('PartName="/word/headerAifaWatermark.xml"')) return xml;
    return xml.replace('</Types>', '<Override PartName="/word/headerAifaWatermark.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
}

function addDocxRelationship(xml) {
    if (xml.includes('Id="rIdAifaWatermark"')) return xml;
    return xml.replace('</Relationships>', '<Relationship Id="rIdAifaWatermark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="headerAifaWatermark.xml"/></Relationships>');
}

function addHeaderToSections(xml) {
    if (xml.includes('r:id="rIdAifaWatermark"')) return xml;
    let found = false;
    const updated = xml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (section) => {
        found = true;
        return section.replace(/(<w:sectPr\b[^>]*>)/, '$1<w:headerReference w:type="default" r:id="rIdAifaWatermark"/>');
    });
    if (!found) throw httpError(422, 'El documento Word no contiene secciones compatibles para insertar la marca.', 'docx_sections_missing');
    return updated;
}

async function watermarkDocx(input, visibleText) {
    let zip;
    try {
        zip = await JSZip.loadAsync(input);
    } catch (_) {
        throw httpError(422, 'No fue posible abrir el archivo Word.', 'docx_unreadable');
    }
    const documentFile = zip.file('word/document.xml');
    const relsFile = zip.file('word/_rels/document.xml.rels');
    const typesFile = zip.file('[Content_Types].xml');
    if (!documentFile || !relsFile || !typesFile) {
        throw httpError(422, 'El archivo no es un documento Word (.docx) compatible.', 'docx_structure_invalid');
    }
    const [documentXml, relsXml, typesXml] = await Promise.all([
        documentFile.async('string'), relsFile.async('string'), typesFile.async('string')
    ]);
    zip.file('word/document.xml', addHeaderToSections(documentXml));
    zip.file('word/_rels/document.xml.rels', addDocxRelationship(relsXml));
    zip.file('[Content_Types].xml', addContentTypeOverride(typesXml));
    zip.file('word/headerAifaWatermark.xml', buildDocxHeader(visibleText));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function watermarkDocument(file, visibleText) {
    const document = detectDocument(file);
    const output = document.type === 'pdf'
        ? await watermarkPdf(file.buffer, visibleText)
        : await watermarkDocx(file.buffer, visibleText);
    return {
        ...document,
        output,
        outputName: safeOutputName(document.name, document.type),
        outputMime: document.type === 'pdf' ? PDF_MIME : DOCX_MIME,
        sourceSha256: crypto.createHash('sha256').update(file.buffer).digest('hex')
    };
}

module.exports = {
    CODE_VERSION,
    MAX_FILE_BYTES,
    DOCX_MIME,
    PDF_MIME,
    createWatermarkCode,
    decryptWatermarkCode,
    normalizeWatermarkCode,
    watermarkDocument,
    sanitizeDocumentName,
    httpError
};
