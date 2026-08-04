const fs = require('fs');
const path = require('path');

global.employeePhotoUpload = require('../js/employee-photo-upload');
const documentUpload = require('../js/employee-document-upload');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'db', 'create_employee_document_images_bucket.sql'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'js', 'employee-document-upload.js'), 'utf8');

const SIGNATURES = {
    'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
    'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
};

function testFile(name, type, size = 100 * 1024, signature = SIGNATURES[type]) {
    const bytes = Uint8Array.from(signature || []);
    return {
        name,
        type,
        size,
        slice: () => ({ arrayBuffer: async () => bytes.buffer })
    };
}

function storageClient(overrides = {}) {
    const bucket = {
        upload: jest.fn().mockResolvedValue({ data: { path: 'ok' }, error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.test/document' }, error: null }),
        remove: jest.fn().mockResolvedValue({ data: {}, error: null }),
        ...overrides
    };
    return {
        bucket,
        client: {
            auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'test' } }, error: null }) },
            storage: { from: jest.fn().mockReturnValue(bucket) }
        }
    };
}

describe('documentos de identidad de colaboradores', () => {
    afterEach(() => {
        delete global.createImageBitmap;
        jest.restoreAllMocks();
    });

    test.each([
        ['ine.jpg', 'image/jpeg', 'jpg'],
        ['ine.jpeg', 'image/jpeg', 'jpg'],
        ['credencial.png', 'image/png', 'png'],
        ['INE José Pérez (frente) #1.JPEG', 'image/jpeg', 'jpg'],
        [`${'documento-muy-largo-'.repeat(20)}.png`, 'image/png', 'png']
    ])('acepta %s con MIME y firma válidos', async (name, mime, extension) => {
        await expect(documentUpload.validate(testFile(name, mime))).resolves.toMatchObject({ mime, extension });
    });

    test('rechaza WEBP y formatos no configurados para documentos', async () => {
        await expect(documentUpload.validate(testFile('doc.webp', 'image/webp')))
            .rejects.toMatchObject({ code: 'INVALID_MIME' });
        await expect(documentUpload.validate(testFile('doc.pdf', 'application/pdf', 100, [0x25, 0x50, 0x44, 0x46])))
            .rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
    });

    test.each([
        ['100 KB', 100 * 1024, true],
        ['500 KB', 500 * 1024, true],
        ['1 MB', 1 * 1024 * 1024, true],
        ['2 MB', 2 * 1024 * 1024, true],
        ['5 MB', 5 * 1024 * 1024, true],
        ['10 MB', 10 * 1024 * 1024, false]
    ])('aplica el límite a %s', async (_label, size, allowed) => {
        const promise = documentUpload.validate(testFile('documento.jpeg', 'image/jpeg', size));
        if (allowed) await expect(promise).resolves.toMatchObject({ size });
        else await expect(promise).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    test('valida resolución y cierra el bitmap decodificado', async () => {
        const close = jest.fn();
        global.createImageBitmap = jest.fn().mockResolvedValue({ width: 4000, height: 3000, close });
        await expect(documentUpload.validate(testFile('celular.jpg', 'image/jpeg')))
            .resolves.toMatchObject({ dimensions: { width: 4000, height: 3000 } });
        expect(close).toHaveBeenCalled();
    });

    test('rechaza imágenes de más de 50 megapíxeles', async () => {
        global.createImageBitmap = jest.fn().mockResolvedValue({ width: 10000, height: 6000, close: jest.fn() });
        await expect(documentUpload.validate(testFile('enorme.png', 'image/png')))
            .rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS_TOO_LARGE' });
    });

    test.each(['ine_front', 'ine_back', 'credential'])('sube %s como binario a una ruta generada y privada', async kind => {
        const file = testFile('archivo con espacios y áé.jpeg', 'image/jpeg');
        const { client, bucket } = storageClient();
        const result = await documentUpload.upload({ client, file, employeeNumber: '1739', kind });

        expect(client.storage.from).toHaveBeenCalledWith('employee-document-images');
        expect(bucket.upload).toHaveBeenCalledWith(
            expect.stringMatching(new RegExp(`^1739/${kind}-[a-z0-9-]+\\.jpg$`)),
            file,
            expect.objectContaining({ upsert: false, contentType: 'image/jpeg' })
        );
        expect(result.storageReference).toMatch(new RegExp(`^storage://employee-document-images/1739/${kind}-[a-z0-9-]+\\.jpg$`));
        expect(result.previewUrl).toBe('https://signed.test/document');
    });

    test('no usa FormData ni el nombre original en la ruta HTTP', () => {
        expect(helperSource).not.toContain('new FormData');
        expect(helperSource).toContain('.upload(path, file, {');
        expect(documentUpload.generatedPath('17 39/á', 'ine_front', 'png'))
            .toMatch(/^17_39__\/ine_front-[a-z0-9-]+\.png$/);
    });

    test('resuelve referencias privadas con URL firmada y conserva datos legacy', async () => {
        const { client, bucket } = storageClient();
        const ref = 'storage://employee-document-images/1739/ine_front-token.jpg';
        await expect(documentUpload.resolve(client, ref, 'ine_front')).resolves.toBe('https://signed.test/document');
        expect(bucket.createSignedUrl).toHaveBeenCalledWith('1739/ine_front-token.jpg', 900);

        const legacy = 'data:image/jpeg;base64,/9j/legacy';
        await expect(documentUpload.resolve(null, legacy, 'ine_front')).resolves.toBe(legacy);
    });

    test('elimina únicamente referencias pertenecientes al bucket privado', async () => {
        const { client, bucket } = storageClient();
        const ref = 'storage://employee-document-images/1739/credential-token.png';
        await expect(documentUpload.remove(client, ref, 'credential')).resolves.toBe(true);
        expect(bucket.remove).toHaveBeenCalledWith(['1739/credential-token.png']);
        await expect(documentUpload.remove(client, 'data:image/jpeg;base64,legacy', 'credential')).resolves.toBe(false);
    });

    test.each([
        [{ statusCode: 400, code: 'NoSuchBucket', message: 'Bucket not found' }, 'BUCKET_NOT_CONFIGURED'],
        [{ statusCode: 401, message: 'Invalid JWT' }, 'AUTHENTICATION_REQUIRED'],
        [{ statusCode: 403, message: 'row-level security policy' }, 'UPLOAD_FORBIDDEN'],
        [{ statusCode: 413, message: 'Payload too large' }, 'FILE_TOO_LARGE'],
        [{ message: 'Failed to fetch' }, 'NETWORK_ERROR']
    ])('mapea el error técnico a %s', (error, code) => {
        expect(documentUpload.mapError(error, 'ine_front')).toMatchObject({ code, documentKind: 'ine_front' });
    });

    test('el editor conecta los tres documentos configurados y persiste su referencia', () => {
        for (const id of ['ce-doc-ine-front', 'ce-doc-ine-back', 'ce-doc-credential']) {
            expect(html).toContain(`id="${id}"`);
            expect(html).toContain('accept="image/jpeg,image/png,.jpg,.jpeg,.png"');
        }
        expect(html).toContain("field: 'foto_ine'");
        expect(html).toContain("field: 'foto_ine_rev'");
        expect(html).toContain("field: 'foto_cred'");
        expect(html).toContain('await colabPrepareDocumentImageChanges(');
        expect(html).toContain('updatePayload[realCol] = result.storageReference');
        expect(html).toContain('Promise.allSettled(uploadedDocumentRefs.map');
    });

    test('mantiene como texto Licencia, CURP y RFC; no inventa una asociación de Pasaporte', () => {
        expect(html).toContain('id="ce-licencia" data-field="licencia"');
        expect(html).toContain('id="ce-curp" data-field="curp"');
        expect(html).toContain('id="ce-rfc" data-field="rfc"');
        expect(html).not.toMatch(/id="ce-(?:doc-)?pasaporte[^"].*type="file"/i);
    });

    test('la ficha resuelve las tres imágenes después de recargar', () => {
        expect(html).toContain("loadDocPhoto('colab-foto-ine',     val(gc(c, 'foto_ine')),     'ine_front')");
        expect(html).toContain("loadDocPhoto('colab-foto-ine-rev', val(gc(c, 'foto_ine_rev')), 'ine_back')");
        expect(html).toContain("loadDocPhoto('colab-foto-cred',    val(gc(c, 'foto_cred')),     'credential')");
        expect(helperSource).toContain('createSignedUrl(path, SIGNED_URL_SECONDS)');
    });

    test('el bucket es privado, limitado y sin escritura anónima', () => {
        expect(sql).toContain("'employee-document-images'");
        expect(sql).toMatch(/'employee-document-images',\s*'employee-document-images',\s*false,/);
        expect(sql).toContain('5242880');
        expect(sql).toContain("ARRAY['image/jpeg', 'image/png']");
        expect(sql).toContain('FOR SELECT TO authenticated');
        expect(sql).toContain('FOR INSERT TO authenticated');
        expect(sql).toContain('FOR UPDATE TO authenticated');
        expect(sql).toContain('FOR DELETE TO authenticated');
        expect(sql).toContain('AND public.is_colab_editor()');
        expect(sql).not.toMatch(/TO anon|public\s*,\s*true/i);
    });
});
