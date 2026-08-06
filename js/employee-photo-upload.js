(function employeePhotoUploadFactory(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.employeePhotoUpload = api;
})(typeof window !== 'undefined' ? window : globalThis, function createEmployeePhotoUpload() {
    'use strict';

    const BUCKET = 'employee-photos';
    const MAX_BYTES = 5 * 1024 * 1024;
    const ALLOWED_TYPES = Object.freeze({
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp'
    });

    class EmployeePhotoUploadError extends Error {
        constructor(code, userMessage, details = {}) {
            super(userMessage);
            this.name = 'EmployeePhotoUploadError';
            this.code = code;
            this.userMessage = userMessage;
            this.details = details;
        }
    }

    function extensionOf(filename) {
        const match = String(filename || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
        return match ? match[1] : '';
    }

    function canonicalExtension(filename) {
        const ext = extensionOf(filename);
        return ext === 'jpeg' ? 'jpg' : ext;
    }

    function safeEmployeeNumber(value) {
        const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!normalized) {
            throw new EmployeePhotoUploadError(
                'INVALID_EMPLOYEE_NUMBER',
                'No se pudo identificar el número de empleado para guardar la fotografía.'
            );
        }
        return normalized.slice(0, 64);
    }

    function hasExpectedSignature(bytes, mime) {
        if (mime === 'image/jpeg') {
            return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        }
        if (mime === 'image/png') {
            return bytes.length >= 8
                && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
                && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
        }
        if (mime === 'image/webp') {
            return bytes.length >= 12
                && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
                && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
        }
        return false;
    }

    async function readSignature(file) {
        try {
            const buffer = await file.slice(0, 12).arrayBuffer();
            return new Uint8Array(buffer);
        } catch (cause) {
            throw new EmployeePhotoUploadError(
                'UNREADABLE_FILE',
                'No se pudo leer la imagen. Selecciona nuevamente el archivo.',
                { cause }
            );
        }
    }

    async function validate(file) {
        if (!file) {
            throw new EmployeePhotoUploadError('NO_FILE', 'Selecciona una fotografía para continuar.');
        }
        if (!Number.isFinite(file.size) || file.size <= 0) {
            throw new EmployeePhotoUploadError('EMPTY_FILE', 'La imagen está vacía o no se pudo leer.');
        }
        if (file.size > MAX_BYTES) {
            throw new EmployeePhotoUploadError(
                'FILE_TOO_LARGE',
                'La fotografía supera el límite permitido de 5 MB.'
            );
        }

        const originalExtension = extensionOf(file.name);
        const expectedMime = ALLOWED_TYPES[originalExtension];
        if (!expectedMime) {
            throw new EmployeePhotoUploadError(
                'INVALID_EXTENSION',
                'Tipo de archivo no permitido. Usa JPG, JPEG, PNG o WEBP.'
            );
        }

        const actualMime = String(file.type || '').trim().toLowerCase();
        if (actualMime !== expectedMime) {
            throw new EmployeePhotoUploadError(
                'INVALID_MIME',
                `El contenido no corresponde a una imagen ${originalExtension.toUpperCase()} válida.`
            );
        }

        const signature = await readSignature(file);
        if (!hasExpectedSignature(signature, expectedMime)) {
            throw new EmployeePhotoUploadError(
                'INVALID_SIGNATURE',
                'El archivo no contiene una imagen válida o su extensión fue modificada.'
            );
        }

        return {
            mime: expectedMime,
            originalExtension,
            extension: canonicalExtension(file.name),
            size: file.size
        };
    }

    function statusOf(error) {
        const raw = error?.statusCode ?? error?.status ?? error?.originalError?.status;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function storageError(error) {
        if (error instanceof EmployeePhotoUploadError) return error;

        const status = statusOf(error);
        const storageCode = String(error?.code || error?.error || '').trim();
        const rawMessage = String(error?.message || '').trim();
        const searchable = `${storageCode} ${rawMessage}`.toLowerCase();
        const details = { status, storageCode, rawMessage };

        if (storageCode === 'NoSuchBucket' || searchable.includes('bucket not found')) {
            return new EmployeePhotoUploadError(
                'BUCKET_NOT_CONFIGURED',
                'El almacenamiento de fotografías no está configurado. Contacta al administrador.',
                details
            );
        }
        if (status === 413 || searchable.includes('maximum allowed size') || searchable.includes('file size')) {
            return new EmployeePhotoUploadError(
                'FILE_TOO_LARGE',
                'La fotografía supera el límite permitido de 5 MB.',
                details
            );
        }
        if (searchable.includes('mime type') || searchable.includes('content type')) {
            return new EmployeePhotoUploadError(
                'INVALID_MIME',
                'El servidor rechazó el tipo de imagen. Usa JPG, JPEG, PNG o WEBP.',
                details
            );
        }
        if (status === 401 || searchable.includes('jwt') || searchable.includes('not authenticated')) {
            return new EmployeePhotoUploadError(
                'AUTHENTICATION_REQUIRED',
                'Tu sesión expiró. Inicia sesión nuevamente antes de subir la fotografía.',
                details
            );
        }
        if (status === 403 || searchable.includes('row-level security') || searchable.includes('unauthorized')) {
            return new EmployeePhotoUploadError(
                'UPLOAD_FORBIDDEN',
                'Tu usuario no tiene permiso para modificar fotografías de empleados.',
                details
            );
        }
        if (status && status >= 500) {
            return new EmployeePhotoUploadError(
                'STORAGE_UNAVAILABLE',
                'El servidor de fotografías no está disponible. Intenta nuevamente más tarde.',
                details
            );
        }
        if (searchable.includes('failed to fetch') || searchable.includes('network')) {
            return new EmployeePhotoUploadError(
                'NETWORK_ERROR',
                'No se pudo conectar con el servidor. Verifica tu conexión e intenta nuevamente.',
                details
            );
        }
        return new EmployeePhotoUploadError(
            'UPLOAD_FAILED',
            'No se pudo guardar la fotografía. Intenta nuevamente o contacta al administrador.',
            details
        );
    }

    function logError(error, file) {
        const mapped = storageError(error);
        console.error('[Colaboradores][Foto] Fallo de carga', {
            code: mapped.code,
            httpStatus: mapped.details?.status || null,
            storageCode: mapped.details?.storageCode || null,
            mime: file?.type || null,
            bytes: Number.isFinite(file?.size) ? file.size : null
        });
        return mapped;
    }

    async function requireSession(client) {
        if (!client?.auth?.getSession) {
            throw new EmployeePhotoUploadError(
                'CLIENT_UNAVAILABLE',
                'No se encontró la conexión segura con el servidor.'
            );
        }
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session?.access_token) {
            throw new EmployeePhotoUploadError(
                'AUTHENTICATION_REQUIRED',
                'Tu sesión expiró. Inicia sesión nuevamente antes de subir la fotografía.',
                { cause: error }
            );
        }
    }

    async function upload({ client, file, employeeNumber }) {
        try {
            const metadata = await validate(file);
            await requireSession(client);

            const path = `${safeEmployeeNumber(employeeNumber)}.${metadata.extension}`;
            const { error } = await client.storage
                .from(BUCKET)
                .upload(path, file, {
                    upsert: true,
                    contentType: metadata.mime,
                    cacheControl: '3600'
                });
            if (error) throw error;

            const result = client.storage.from(BUCKET).getPublicUrl(path);
            const publicUrl = result?.data?.publicUrl;
            if (!publicUrl) {
                throw new EmployeePhotoUploadError(
                    'PUBLIC_URL_UNAVAILABLE',
                    'La fotografía se guardó, pero no fue posible obtener su dirección pública.'
                );
            }

            return {
                ...metadata,
                path,
                publicUrl: `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
            };
        } catch (error) {
            throw logError(error, file);
        }
    }

    return Object.freeze({
        BUCKET,
        MAX_BYTES,
        ALLOWED_TYPES,
        EmployeePhotoUploadError,
        extensionOf,
        canonicalExtension,
        safeEmployeeNumber,
        hasExpectedSignature,
        validate,
        storageError,
        upload
    });
});
