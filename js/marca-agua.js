(function marcaAguaModuleFactory(window, document) {
    'use strict';

    const SUPABASE_URL = window.supabaseClient?.supabaseUrl
        || window.APP_CONFIG?.SUPABASE_URL
        || 'https://fgstncvuuhpgyzmjceyr.supabase.co';
    const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/watermark-documents`;
    const state = { initialized: false, modal: null, validationModal: null };

    function el(id) { return document.getElementById(id); }

    function setMessage(target, message, kind) {
        const node = typeof target === 'string' ? el(target) : target;
        if (!node) return;
        node.className = `marca-agua-message mt-3 ${kind ? `is-${kind}` : ''}`;
        node.textContent = message || '';
    }

    async function accessToken() {
        const client = window.supabaseClient;
        if (!client?.auth?.getSession) throw new Error('No se encontró una sesión activa.');
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session?.access_token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
        return data.session.access_token;
    }

    async function apiFetch(options) {
        const token = await accessToken();
        const headers = new Headers(options?.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        const publicKey = window.supabaseClient?.supabaseKey || window.APP_CONFIG?.SUPABASE_ANON_KEY;
        if (publicKey) headers.set('apikey', publicKey);
        return fetch(EDGE_FUNCTION_URL, { ...options, headers });
    }

    async function readApiError(response, fallback) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const body = await response.json().catch(() => ({}));
            if (body.error) return body.error;
        }
        if (response.status === 404 || response.status === 405) {
            return 'La función de Marca de agua no está desplegada todavía en Supabase.';
        }
        return `${fallback} (HTTP ${response.status}).`;
    }

    function showModal() {
        const node = el('marca-agua-modal');
        if (!node || !window.bootstrap?.Modal) return null;
        if (!state.modal) {
            state.modal = typeof window.bootstrap.Modal.getOrCreateInstance === 'function'
                ? window.bootstrap.Modal.getOrCreateInstance(node)
                : new window.bootstrap.Modal(node);
        }
        return state.modal;
    }

    function showValidationModal() {
        const node = el('marca-agua-validation-modal');
        if (!node || !window.bootstrap?.Modal) return null;
        if (!state.validationModal) {
            state.validationModal = typeof window.bootstrap.Modal.getOrCreateInstance === 'function'
                ? window.bootstrap.Modal.getOrCreateInstance(node)
                : new window.bootstrap.Modal(node);
        }
        return state.validationModal;
    }

    function openValidation() {
        state.modal?.hide();
        const result = el('marca-agua-validation-result');
        if (result) result.hidden = true;
        showValidationModal()?.show();
    }

    function open() {
        const launcher = el('miscelanea-modal');
        if (launcher && window.bootstrap?.Modal) window.bootstrap.Modal.getInstance(launcher)?.hide();
        showModal()?.show();
        return true;
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function renderValidation(result) {
        const target = el('marca-agua-validation-result');
        if (!target) return;
        target.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = result.valid ? '✓ Documento validado en AIFA Operaciones' : 'No se pudo validar el documento';
        target.append(title);
        const message = document.createElement('p');
        message.className = 'mb-0 mt-1';
        message.textContent = result.message || '';
        target.append(message);
        if (result.details) {
            const list = document.createElement('dl');
            list.className = 'marca-agua-details mb-0 mt-2';
            [['Documento', result.details.documentName], ['Fecha', formatDate(result.details.issuedAt)], ['Usuario', result.details.issuedByName]].forEach(([label, value]) => {
                const dt = document.createElement('dt'); dt.textContent = label;
                const dd = document.createElement('dd'); dd.textContent = value || '—';
                list.append(dt, dd);
            });
            target.append(list);
        }
        target.className = `marca-agua-validation-result mt-3 ${result.valid ? 'is-valid' : 'is-invalid'}`;
        target.hidden = false;
    }

    async function processDocument() {
        const input = el('marca-agua-file');
        const button = el('marca-agua-process');
        const file = input?.files?.[0];
        if (!file) return setMessage('marca-agua-process-message', 'Selecciona un archivo PDF o Word (.docx).', 'error');
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (!['pdf', 'docx'].includes(extension)) return setMessage('marca-agua-process-message', 'Solo se admiten archivos PDF y Word (.docx).', 'error');
        if (file.size > 15 * 1024 * 1024) return setMessage('marca-agua-process-message', 'El archivo supera el límite de 15 MB.', 'error');
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1" aria-hidden="true"></i>Procesando…';
        setMessage('marca-agua-process-message', 'Cifrando, registrando y aplicando la marca de agua…', 'info');
        try {
            const form = new FormData();
            form.append('document', file, file.name);
            const response = await apiFetch({ method: 'POST', body: form });
            if (!response.ok) {
                throw new Error(await readApiError(response, 'No se pudo procesar el documento'));
            }
            const code = response.headers.get('X-Watermark-Code');
            if (!code) throw new Error('El servidor no devolvió el código de validación.');
            const blob = await response.blob();
            const download = document.createElement('a');
            download.href = URL.createObjectURL(blob);
            const disposition = response.headers.get('Content-Disposition') || '';
            const fileName = decodeURIComponent((disposition.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || `documento_AIFA_marca.${extension}`);
            download.download = fileName;
            download.click();
            setTimeout(() => URL.revokeObjectURL(download.href), 1500);
            el('marca-agua-code').value = code;
            el('marca-agua-generated').hidden = false;
            setMessage('marca-agua-process-message', 'Documento marcado y descargado. Conserva el código para validarlo.', 'success');
        } catch (error) {
            setMessage('marca-agua-process-message', error.message || 'No se pudo procesar el documento.', 'error');
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-stamp me-1" aria-hidden="true"></i>Generar y descargar';
        }
    }

    async function validateCode() {
        const code = el('marca-agua-validation-code')?.value.trim();
        const button = el('marca-agua-validate');
        if (!code) return renderValidation({ valid: false, message: 'Ingresa el código de marca de agua.' });
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1" aria-hidden="true"></i>Validando…';
        try {
            const response = await apiFetch({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'validate', code })
            });
            if (!response.ok) throw new Error(await readApiError(response, 'No se pudo validar el código'));
            const result = await response.json().catch(() => ({}));
            renderValidation(result);
        } catch (error) {
            renderValidation({ valid: false, message: error.message || 'No se pudo validar el código.' });
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-shield-check me-1" aria-hidden="true"></i>Validar';
        }
    }

    async function copyCode() {
        const code = el('marca-agua-code')?.value;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            setMessage('marca-agua-process-message', 'Código copiado al portapapeles.', 'success');
        } catch (_) {
            el('marca-agua-code').select();
            document.execCommand('copy');
        }
    }

    function init() {
        if (state.initialized) return api;
        state.initialized = true;
        el('marca-agua-process')?.addEventListener('click', processDocument);
        el('marca-agua-validate')?.addEventListener('click', validateCode);
        el('marca-agua-open-validation')?.addEventListener('click', openValidation);
        el('marca-agua-validation-modal')?.addEventListener('shown.bs.modal', () => {
            el('marca-agua-validation-code')?.focus();
        });
        el('marca-agua-validation-modal')?.addEventListener('hidden.bs.modal', () => showModal()?.show());
        el('marca-agua-copy')?.addEventListener('click', copyCode);
        el('marca-agua-back')?.addEventListener('click', () => {
            state.modal?.hide();
            window.miscelaneaModule?.open();
        });
        el('marca-agua-file')?.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            el('marca-agua-file-name').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF o Word (.docx), máximo 15 MB.';
        });
        return api;
    }

    const api = { init, open };
    window.marcaAguaModule = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(window, document);
