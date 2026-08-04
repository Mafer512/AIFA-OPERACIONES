(function employeeDocumentUploadFactory(root, factory) {
    const api = factory(root && root.employeePhotoUpload);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.employeeDocumentUpload = api;
})(typeof window !== 'undefined' ? window : globalThis, function createEmployeeDocumentUpload(imageValidator) {
    'use strict';

    const BUCKET = 'employee-document-images';
    const MAX_BYTES = 5 * 1024 * 1024;
    const SIGNED_URL_SECONDS = 15 * 60;
    const MAX_PIXELS = 50 * 1000 * 1000;
    const MAX_SIDE = 12000;
    const STORAGE_PREFIX = `storage://${BUCKET}/`;
    const TYPES = Object.freeze({
        ine_front: Object.freeze({ field: 'foto_ine', label: 'INE frente' }),
        ine_back: Object.freeze({ field: 'foto_ine_rev', label: 'INE reverso' }),
        credential: Object.freeze({ field: 'foto_cred', label: 'TIA / Credencial AIFA' })
    });

    class EmployeeDocumentUploadError extends Error {
        constructor(code, userMessage, details = {}) {
            super(userMessage);
            this.name = 'EmployeeDocumentUploadError';
            this.code = code;
            this.userMessage = userMessage;
            this.details = details;
            this.documentKind = details.documentKind || null;
        }
    }

    function typeConfig(kind) {
        const config = TYPES[kind];
        if (!config) {
            throw new EmployeeDocumentUploadError(
                'INVALID_DOCUMENT_TYPE',
                'El tipo de documento seleccionado no está configurado.'
            );
        }
        return config;
    }

    function isStorageReference(value) {
        return String(value || '').startsWith(STORAGE_PREFIX);
    }

    function pathFromReference(value) {
        if (!isStorageReference(value)) return null;
        const path = String(value).slice(STORAGE_PREFIX.length);
        if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) return null;
        return path;
    }

    function referenceFromPath(path) {
        const normalized = String(path || '').replace(/^\/+/, '');
        if (!normalized || normalized.includes('..') || normalized.includes('\\')) {
            throw new EmployeeDocumentUploadError(
                'INVALID_STORAGE_PATH',
                'No se pudo generar una ruta segura para el documento.'
            );
        }
        return STORAGE_PREFIX + normalized;
    }

    async function requireSession(client) {
        if (!client?.auth?.getSession) {
            throw new EmployeeDocumentUploadError(
                'CLIENT_UNAVAILABLE',
                'No se encontró la conexión segura con el servidor.'
            );
        }
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session?.access_token) {
            throw new EmployeeDocumentUploadError(
                'AUTHENTICATION_REQUIRED',
                'Tu sesión expiró. Inicia sesión nuevamente antes de cargar documentos.',
                { cause: error }
            );
        }
    }

    async function dimensionsOf(file) {
        if (typeof createImageBitmap !== 'function') return null;
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
            return { width: bitmap.width, height: bitmap.height };
        } catch (cause) {
            throw new EmployeeDocumentUploadError(
                'INVALID_IMAGE',
                'El archivo no se pudo decodificar como una imagen válida.',
                { cause }
            );
        } finally {
            if (bitmap?.close) bitmap.close();
        }
    }

    async function validate(file) {
        if (!imageValidator?.validate) {
            throw new EmployeeDocumentUploadError(
                'VALIDATOR_UNAVAILABLE',
                'El validador seguro de imágenes no está disponible.'
            );
        }
        let metadata;
        try {
            metadata = await imageValidator.validate(file);
        } catch (error) {
            throw mapError(error);
        }
        if (!['image/jpeg', 'image/png'].includes(metadata.mime)) {
            throw new EmployeeDocumentUploadError(
                'INVALID_MIME',
                'Tipo de archivo no permitido. Usa JPG, JPEG o PNG.'
            );
        }
        if (metadata.size > MAX_BYTES) {
            throw new EmployeeDocumentUploadError(
                'FILE_TOO_LARGE',
                'La imagen supera el límite permitido de 5 MB.'
            );
        }

        const dimensions = await dimensionsOf(file);
        if (dimensions && (
            dimensions.width < 1
            || dimensions.height < 1
            || dimensions.width > MAX_SIDE
            || dimensions.height > MAX_SIDE
            || dimensions.width * dimensions.height > MAX_PIXELS
        )) {
            throw new EmployeeDocumentUploadError(
                'IMAGE_DIMENSIONS_TOO_LARGE',
                'La resolución de la imagen es demasiado grande. El máximo permitido es 50 megapíxeles y 12,000 px por lado.',
                dimensions
            );
        }
        return { ...metadata, dimensions };
    }

    function mapError(error, documentKind) {
        if (error instanceof EmployeeDocumentUploadError) {
            if (documentKind && !error.documentKind) error.documentKind = documentKind;
            return error;
        }

        const mapped = imageValidator?.storageError ? imageValidator.storageError(error) : null;
        const code = mapped?.code || 'UPLOAD_FAILED';
        const details = {
            ...(mapped?.details || {}),
            documentKind
        };
        const messages = {
            BUCKET_NOT_CONFIGURED: 'El almacenamiento seguro de documentos no está configurado. Contacta al administrador.',
            FILE_TOO_LARGE: 'La imagen supera el límite permitido de 5 MB.',
            INVALID_EXTENSION: 'Tipo de archivo no permitido. Usa JPG, JPEG o PNG.',
            INVALID_MIME: 'El contenido no corresponde a una imagen JPG, JPEG o PNG válida.',
            INVALID_SIGNATURE: 'El archivo no contiene una imagen válida o su extensión fue modificada.',
            AUTHENTICATION_REQUIRED: 'Tu sesión expiró. Inicia sesión nuevamente antes de cargar documentos.',
            UPLOAD_FORBIDDEN: 'Tu usuario no tiene permiso para modificar documentos de colaboradores.',
            STORAGE_UNAVAILABLE: 'El servidor de documentos no está disponible. Intenta nuevamente más tarde.',
            NETWORK_ERROR: 'No se pudo conectar con el servidor. Verifica tu conexión e intenta nuevamente.'
        };
        return new EmployeeDocumentUploadError(
            code,
            messages[code] || mapped?.userMessage || 'No se pudo guardar el documento.',
            details
        );
    }

    function logError(error, file, kind, operation) {
        const mapped = mapError(error, kind);
        console.error('[Colaboradores][Documento] Fallo de almacenamiento', {
            operation,
            code: mapped.code,
            httpStatus: mapped.details?.status || null,
            storageCode: mapped.details?.storageCode || null,
            documentKind: kind || null,
            mime: file?.type || null,
            bytes: Number.isFinite(file?.size) ? file.size : null
        });
        return mapped;
    }

    function generatedPath(employeeNumber, kind, extension) {
        typeConfig(kind);
        if (!imageValidator?.safeEmployeeNumber) {
            throw new EmployeeDocumentUploadError('VALIDATOR_UNAVAILABLE', 'No se pudo generar una ruta segura.');
        }
        const employee = imageValidator.safeEmployeeNumber(employeeNumber);
        const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        return `${employee}/${kind}-${token}.${extension}`;
    }

    async function signedUrl(client, path, kind) {
        const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
        if (error) throw error;
        if (!data?.signedUrl) {
            throw new EmployeeDocumentUploadError(
                'SIGNED_URL_UNAVAILABLE',
                'El documento existe, pero no fue posible generar una vista segura.',
                { documentKind: kind }
            );
        }
        return data.signedUrl;
    }

    async function upload({ client, file, employeeNumber, kind }) {
        typeConfig(kind);
        let path = null;
        try {
            const metadata = await validate(file);
            await requireSession(client);
            path = generatedPath(employeeNumber, kind, metadata.extension);
            const { error } = await client.storage.from(BUCKET).upload(path, file, {
                upsert: false,
                contentType: metadata.mime,
                cacheControl: '3600'
            });
            if (error) throw error;
            const previewUrl = await signedUrl(client, path, kind);
            return {
                ...metadata,
                path,
                storageReference: referenceFromPath(path),
                previewUrl
            };
        } catch (error) {
            if (path) {
                try {
                    await client?.storage?.from(BUCKET)?.remove?.([path]);
                } catch (_) {
                    // La limpieza es de mejor esfuerzo; se conserva el error original de la carga.
                }
            }
            throw logError(error, file, kind, 'upload');
        }
    }

    async function resolve(client, value, kind) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        if (!isStorageReference(raw)) return raw;
        const path = pathFromReference(raw);
        if (!path) {
            throw new EmployeeDocumentUploadError(
                'INVALID_STORAGE_REFERENCE',
                'La referencia guardada para el documento no es válida.',
                { documentKind: kind }
            );
        }
        try {
            await requireSession(client);
            return await signedUrl(client, path, kind);
        } catch (error) {
            throw logError(error, null, kind, 'resolve');
        }
    }

    async function remove(client, value, kind) {
        const path = pathFromReference(value);
        if (!path) return false;
        try {
            await requireSession(client);
            const { error } = await client.storage.from(BUCKET).remove([path]);
            if (error) throw error;
            return true;
        } catch (error) {
            throw logError(error, null, kind, 'remove');
        }
    }

    return Object.freeze({
        BUCKET,
        MAX_BYTES,
        SIGNED_URL_SECONDS,
        MAX_PIXELS,
        MAX_SIDE,
        STORAGE_PREFIX,
        TYPES,
        EmployeeDocumentUploadError,
        isStorageReference,
        pathFromReference,
        referenceFromPath,
        generatedPath,
        validate,
        mapError,
        upload,
        resolve,
        remove
    });
});
