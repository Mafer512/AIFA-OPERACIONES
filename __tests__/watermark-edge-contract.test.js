const fs = require('fs');
const path = require('path');

describe('contrato Edge Function de marca de agua corta', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'watermark-documents', 'index.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'alter_document_watermarks_short_code.sql'), 'utf8');

  test('usa un identificador visible AIFA de diez caracteres y un payload cifrado separado', () => {
    expect(source).toContain('^AIFA-[A-Z0-9]{10}$');
    expect(source).toContain('encrypted_payload: encryptedPayload');
    expect(source).toContain("const PAYLOAD_VERSION = 'AIFA2'");
  });

  test('repite la marca PDF cada cuatro centímetros y actualiza el contrato SQL', () => {
    expect(source).toContain('const verticalSpacing = 4 * 72 / 2.54');
    expect(source).toContain('repeatedDocxShapes');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS encrypted_payload text');
    expect(migration).toContain('validate_document_watermark');
  });
});
