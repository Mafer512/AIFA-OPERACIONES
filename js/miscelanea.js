(function miscelaneaModuleFactory(window, document) {
    'use strict';

    const SECTION_KEY = 'miscelanea';
    const FULL_ACCESS_ROLES = new Set(['admin', 'superadmin']);
    const state = {
        initialized: false,
        auth: null,
        modal: null
    };

    function readStoredAllowedSections() {
        try {
            const raw = window.sessionStorage.getItem('user_allowed_sections');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function resolveAuth(detail) {
        const supplied = detail && typeof detail === 'object' ? detail : {};
        const role = String(
            supplied.role
            || window.dataManager?.userRole
            || window.sessionStorage.getItem('user_role')
            || ''
        ).toLowerCase();

        let permissions = null;
        if (Object.prototype.hasOwnProperty.call(supplied, 'permissions')) {
            permissions = supplied.permissions;
        } else if (window.dataManager?.permissions) {
            permissions = window.dataManager.permissions;
        }

        let allowedSections = Array.isArray(permissions?.allowed_sections)
            ? permissions.allowed_sections
            : readStoredAllowedSections();

        if (!Array.isArray(allowedSections)) allowedSections = null;
        return { role, permissions: permissions || {}, allowedSections };
    }

    function canAccess(authDetail) {
        const auth = authDetail?.allowedSections !== undefined
            ? authDetail
            : resolveAuth(authDetail);
        if (!auth.role) return false;
        if (FULL_ACCESS_ROLES.has(auth.role)) return true;
        // Compatibilidad con el RBAC actual: sin lista configurada no hay restricción.
        if (!Array.isArray(auth.allowedSections)) return true;
        return auth.allowedSections.length === 0 || auth.allowedSections.includes(SECTION_KEY);
    }

    function setElementVisibility(element, visible) {
        if (!element) return;
        element.classList.toggle('d-none', !visible);
        element.classList.toggle('perm-hidden', !visible);
        element.classList.toggle('d-none-auth', !visible);
        element.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (visible) {
            element.style.removeProperty('display');
        } else {
            element.style.display = 'none';
        }
    }

    function syncVisibility(detail) {
        const auth = resolveAuth(detail);
        state.auth = auth;
        const allowed = canAccess(auth);
        setElementVisibility(document.getElementById('miscelanea-menu'), allowed);

        const host = document.getElementById('miscelanea-section');
        if (host) {
            host.classList.toggle('perm-hidden', !allowed);
            host.setAttribute('aria-hidden', allowed ? 'false' : 'true');
        }
        return allowed;
    }

    function closeUserMenu() {
        const dropdown = document.getElementById('si-user-dropdown');
        if (dropdown) dropdown.classList.add('d-none');
        const chevron = document.getElementById('si-user-chevron');
        if (chevron) chevron.style.transform = '';
    }

    function getModal() {
        const modalElement = document.getElementById('miscelanea-modal');
        if (!modalElement || !window.bootstrap?.Modal) return null;
        if (!state.modal) {
            state.modal = typeof window.bootstrap.Modal.getOrCreateInstance === 'function'
                ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
                : new window.bootstrap.Modal(modalElement);
        }
        return state.modal;
    }

    function open() {
        const auth = state.auth || resolveAuth();
        if (!canAccess(auth)) {
            syncVisibility(auth);
            return false;
        }
        const modal = getModal();
        if (!modal) {
            console.warn('[Miscelánea] No se pudo inicializar el modal.');
            return false;
        }
        closeUserMenu();
        modal.show();
        return true;
    }

    function handleMenuClick(event) {
        event.preventDefault();
        // navigation.js delega sobre todo #sidebar; evitar que active el nav deck
        // o cambie la sección detrás del modal.
        event.stopPropagation();
        open();
    }

    function handleToolClick(event) {
        const button = event.currentTarget;
        const tool = button?.dataset?.miscelaneaTool || '';
        const label = button?.dataset?.toolLabel || button?.textContent?.trim() || tool;
        if (!tool) return;

        window.dispatchEvent(new window.CustomEvent('miscelanea:tool-selected', {
            detail: { tool, label },
            cancelable: true
        }));

        const status = document.getElementById('miscelanea-status');
        if (tool === 'marca-agua' && window.marcaAguaModule?.open) {
            window.marcaAguaModule.open();
            return;
        }

        if (status) {
            status.textContent = `${label} se integrará en el siguiente paso.`;
        }
    }

    function bindOnce(element, eventName, handler, marker) {
        if (!element || element.dataset[marker] === '1') return;
        element.dataset[marker] = '1';
        element.addEventListener(eventName, handler);
    }

    function init() {
        if (!state.initialized) {
            state.initialized = true;
            bindOnce(document.getElementById('miscelanea-menu'), 'click', handleMenuClick, 'miscelaneaBound');
            document.querySelectorAll('[data-miscelanea-open]').forEach((button) => {
                bindOnce(button, 'click', open, 'miscelaneaBound');
            });
            document.querySelectorAll('[data-miscelanea-tool]').forEach((button) => {
                bindOnce(button, 'click', handleToolClick, 'miscelaneaToolBound');
            });
        }
        syncVisibility();
        return api;
    }

    const api = {
        init,
        open,
        syncVisibility,
        canAccess
    };

    window.miscelaneaModule = api;
    window.miscelaneaOpen = open;

    window.addEventListener('admin-mode-changed', (event) => {
        syncVisibility(event.detail || {});
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(window, document);
