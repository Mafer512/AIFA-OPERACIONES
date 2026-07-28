/* Captura de manifiestos digitales dentro de Conciliación. */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    let modalInstance = null;

    function closeAndRefresh(saved) {
        modalInstance?.hide();
        const frame = $('conci-digital-manifest-frame');
        if (frame) frame.src = 'about:blank';
        if (saved && typeof window.loadConciliacionManifiestos === 'function') {
            window.setTimeout(() => window.loadConciliacionManifiestos({ forceRefresh: true }), 250);
        }
    }

    window.openConciDigitalManifest = function (manifest, label) {
        const modalEl = $('modal-conci-digital-manifest');
        const frame = $('conci-digital-manifest-frame');
        const title = $('modal-conci-digital-manifest-label');
        if (!modalEl || !frame || !window.bootstrap) return;

        if (title) title.innerHTML = `<i class="fas fa-file-signature me-2 text-primary"></i>Manifiesto de ${label || ''}`;
        frame.src = `portal.html?manifest=${encodeURIComponent(manifest)}&embed=1`;
        modalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.show();
    };

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) return;
        const type = event.data?.type;
        if (type === 'aifa-manifest-saved') closeAndRefresh(true);
        if (type === 'aifa-manifest-closed') closeAndRefresh(false);
    });

    document.addEventListener('DOMContentLoaded', () => {
        const modalEl = $('modal-conci-digital-manifest');
        if (!modalEl) return;
        modalEl.addEventListener('hidden.bs.modal', () => {
            const frame = $('conci-digital-manifest-frame');
            if (frame) frame.src = 'about:blank';
        });
    });
})();
