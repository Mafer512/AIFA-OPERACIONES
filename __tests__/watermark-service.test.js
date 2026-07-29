const crypto = require('crypto');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const {
  createWatermarkCode,
  decryptWatermarkCode,
  watermarkDocument,
  normalizeWatermarkCode
} = require('../lib/watermark-service');

const KEY = crypto.randomBytes(32).toString('base64url');
const payload = {
  v: 1,
  recordId: '1c2b9fb1-47bb-419e-8e7f-691018d66f8e',
  documentName: 'Informe operativo.pdf',
  issuedAt: '2026-07-28T12:00:00.000Z',
  issuedByName: 'Martín Juárez',
  issuedBy: '5f0a20b7-cfc1-427c-a44a-0cf2eb7ed01d'
};

async function docxFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p/><w:sectPr></w:sectPr></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('marca de agua verificable', () => {
  test('cifra y descifra los datos requeridos sin exponer texto plano en el código', () => {
    const code = createWatermarkCode(payload, KEY);
    expect(code).toMatch(/^AIFA1\.[A-Za-z0-9_-]+$/);
    expect(code).not.toContain('Informe');
    expect(decryptWatermarkCode(`AIFA - ${code}`, KEY)).toEqual({ code, payload });
    expect(normalizeWatermarkCode(` AIFA - ${code} `)).toBe(code);
  });

  test('rechaza un código manipulado', () => {
    const code = createWatermarkCode(payload, KEY);
    const altered = `${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`;
    expect(() => decryptWatermarkCode(altered, KEY)).toThrow('no pudo descifrarse');
  });

  test('inserta la marca en un PDF y conserva un PDF legible', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const output = await watermarkDocument({ originalname: 'prueba.pdf', buffer: Buffer.from(await pdf.save()) }, 'AIFA - AIFA1.prueba');
    expect(output.outputMime).toBe('application/pdf');
    expect(output.outputName).toBe('prueba_AIFA_marca.pdf');
    await expect(PDFDocument.load(output.output)).resolves.toBeDefined();
  });

  test('inserta una cabecera de marca en un DOCX compatible', async () => {
    const output = await watermarkDocument({ originalname: 'prueba.docx', buffer: await docxFixture() }, 'AIFA - AIFA1.prueba');
    const zip = await JSZip.loadAsync(output.output);
    expect(await zip.file('word/headerAifaWatermark.xml').async('string')).toContain('AIFA - AIFA1.prueba');
    expect(await zip.file('word/document.xml').async('string')).toContain('rIdAifaWatermark');
    expect(output.outputName).toBe('prueba_AIFA_marca.docx');
  });
});
