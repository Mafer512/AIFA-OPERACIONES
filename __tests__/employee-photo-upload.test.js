const fs = require('fs');
const path = require('path');
const photoUpload = require('../js/employee-photo-upload');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'db', 'create_employee_photos_bucket.sql'), 'utf8');

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

describe('carga segura de fotografías de empleados', () => {
    test.each([
        ['foto.jpg', 'image/jpeg', 'jpg'],
        ['foto.jpeg', 'image/jpeg', 'jpg'],
        ['foto.png', 'image/png', 'png'],
        ['foto.webp', 'image/webp', 'webp'],
        ['Foto José (final) 2026.JPEG', 'image/jpeg', 'jpg']
    ])('acepta %s con MIME y firma reales', async (name, type, extension) => {
        await expect(photoUpload.validate(testFile(name, type))).resolves.toMatchObject({ mime: type, extension });
    });

    test.each([
        ['100 KB', 100 * 1024, true],
        ['500 KB', 500 * 1024, true],
        ['1 MB', 1 * 1024 * 1024, true],
        ['2 MB', 2 * 1024 * 1024, true],
        ['5 MB', 5 * 1024 * 1024, true],
        ['10 MB', 10 * 1024 * 1024, false]
    ])('aplica el límite real a %s', async (_label, size, allowed) => {
        const promise = photoUpload.validate(testFile('celular.jpeg', 'image/jpeg', size));
        if (allowed) await expect(promise).resolves.toMatchObject({ size });
        else await expect(promise).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    test('rechaza extensión, MIME y firma que no coinciden', async () => {
        await expect(photoUpload.validate(testFile('foto.gif', 'image/gif')))
            .rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
        await expect(photoUpload.validate(testFile('foto.jpg', 'image/png')))
            .rejects.toMatchObject({ code: 'INVALID_MIME' });
        await expect(photoUpload.validate(testFile('foto.jpg', 'image/jpeg', 100, SIGNATURES['image/png'])))
            .rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    });

    test('sube el binario sin FormData, usa nombre canónico y devuelve URL versionada', async () => {
        const file = testFile('retrato con acentos áé.jpeg', 'image/jpeg');
        const upload = jest.fn().mockResolvedValue({ data: { path: '1541-2.jpg' }, error: null });
        const getPublicUrl = jest.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/employee-photos/1541-2.jpg' } });
        const bucket = { upload, getPublicUrl };
        const client = {
            auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'test' } }, error: null }) },
            storage: { from: jest.fn().mockReturnValue(bucket) }
        };

        const result = await photoUpload.upload({ client, file, employeeNumber: '1541-2' });

        expect(client.storage.from).toHaveBeenCalledWith('employee-photos');
        expect(upload).toHaveBeenCalledWith('1541-2.jpg', file, expect.objectContaining({
            upsert: true,
            contentType: 'image/jpeg'
        }));
        expect(result.publicUrl).toMatch(/^https:\/\/storage\.test\/employee-photos\/1541-2\.jpg\?v=\d+$/);
    });

    test.each([
        [{ statusCode: 400, code: 'NoSuchBucket', message: 'Bucket not found' }, 'BUCKET_NOT_CONFIGURED'],
        [{ statusCode: 401, message: 'Invalid JWT' }, 'AUTHENTICATION_REQUIRED'],
        [{ statusCode: 403, message: 'row-level security policy' }, 'UPLOAD_FORBIDDEN'],
        [{ statusCode: 413, message: 'Payload too large' }, 'FILE_TOO_LARGE'],
        [{ statusCode: 503, message: 'Unavailable' }, 'STORAGE_UNAVAILABLE'],
        [{ message: 'Failed to fetch' }, 'NETWORK_ERROR']
    ])('convierte errores técnicos en mensajes específicos', (error, code) => {
        expect(photoUpload.storageError(error)).toMatchObject({ code });
    });

    test('el editor acepta JPEG, persiste la URL y muestra estado accesible', () => {
        expect(html).toContain('accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"');
        expect(html).toContain('role="status" aria-live="polite"');
        expect(html).toContain('window.employeePhotoUpload.upload({');
        expect(html).toContain('updatePayload[photoCol] = uploadedPhoto.publicUrl');
        expect(html).toContain("const EMPLOYEE_PHOTO_EXTS  = ['jpg', 'jpeg', 'png', 'webp']");
    });

    test('la migración crea/repara el bucket sin habilitar escritura anónima', () => {
        expect(sql).toContain("'employee-photos'");
        expect(sql).toContain('file_size_limit    = EXCLUDED.file_size_limit');
        expect(sql).toContain("ARRAY['image/jpeg','image/png','image/webp']");
        expect(sql).toContain('FOR SELECT TO authenticated');
        expect(sql).toContain('FOR INSERT TO authenticated');
        expect(sql).toContain('AND public.is_colab_editor()');
        expect(sql).not.toMatch(/FOR INSERT\s+WITH CHECK/);
        expect(sql).not.toMatch(/FOR SELECT\s+USING/);
    });
});
