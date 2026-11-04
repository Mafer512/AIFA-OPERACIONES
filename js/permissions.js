(function() {
    // Roles con acceso total: ignoran la lista allowed_sections.
    const FULL_ACCESS_ROLES = ['admin', 'superadmin'];

    function applyViewerPermissions(detail) {
        const { role, permissions } = detail;
        
        // Filter out legacy events from script.js that don't include permissions object
        // This prevents 'script.js' from accidentally resetting UI to "no permissions" state (hiding everything)
        if (typeof permissions === 'undefined') {
            console.warn('Ignored admin-mode-changed event without permissions data (legacy script source)');
            return;
        }

        // Remove existing restriction class
        document.body.classList.remove('viewer-restricted');
        
        // Find all menu items with data-section
        const menuItems = document.querySelectorAll('.menu-item[data-section]');
        
        // Reset visibility first to ensure clean state
        menuItems.forEach(el => el.classList.remove('d-none-auth'));
        // Also restore any groups hidden by this system
        document.querySelectorAll('#sidebar-nav .si-group').forEach(g => g.classList.remove('d-none-auth'));

        // Admin / superadmin: acceso total, sin restricciones de vista.
        if (FULL_ACCESS_ROLES.includes(role)) {
            return;
        }

        const baseAllowed = permissions?.allowed_sections || [];

        // If allowed_sections is empty/not configured, treat as "no restrictions" (show all sections)
        if (baseAllowed.length === 0) {
            console.log('Permissions: no allowed_sections configured — showing all sections.');
            return;
        }

        document.body.classList.add('viewer-restricted');

        // Secciones que esta capa no oculta. Conciliación ya NO va aquí: sólo
        // se ve si el administrador la marcó (igual que applySectionPermissions
        // en script.js, que además oculta Historia/Biblioteca si no están marcadas).
        const alwaysVisible = ['historia', 'biblioteca'];
        const allowed = [...new Set([...baseAllowed, ...alwaysVisible])];
        
        console.log('Applying section Permissions:', allowed);

        menuItems.forEach(item => {
            const section = item.dataset.section;
            
            // Special handling for 'Inicio' dashboard alias
            if (section === 'operaciones-totales') { 
                 if (!allowed.includes('operaciones-totales') && !allowed.includes('inicio')) {
                     item.classList.add('d-none-auth');
                 }
                 return;
            }

            // El submodulo de estadisticas de equipaje comparte visibilidad con BHS
            if (section === 'bhs-estadisticas-equipaje') {
                if (!allowed.includes('bhs-estadisticas-equipaje') && !allowed.includes('bhs')) {
                    item.classList.add('d-none-auth');
                }
                return;
            }
           
            if (!allowed.includes(section)) {
                item.classList.add('d-none-auth');
            }
        });

        // Hide sidebar group containers whose every menu-item is now hidden
        const allGroups = Array.from(document.querySelectorAll('#sidebar-nav .si-group'));
        const hasHiddenItems = document.querySelectorAll('#sidebar-nav .menu-item[data-section].d-none-auth, #sidebar-nav .menu-item[data-section].perm-hidden').length > 0;
        allGroups.reverse().forEach(group => {
            const items = Array.from(group.querySelectorAll('.menu-item[data-section]'));
            if (items.length === 0) {
                // "Próximamente" decoration group — hide it when user is in restricted mode
                if (hasHiddenItems) group.classList.add('d-none-auth');
                return;
            }
            const allHidden = items.every(i => i.classList.contains('d-none-auth') || i.classList.contains('perm-hidden'));
            if (allHidden) group.classList.add('d-none-auth');
        });
    }

    // Listen for admin mode changes
    window.addEventListener('admin-mode-changed', (e) => {
        applyViewerPermissions(e.detail);
    });

    // Check immediate state on load (in case event fired before we listened)
    document.addEventListener('DOMContentLoaded', () => {
        if (window.dataManager) {
            // Apply if already determined
            if (window.dataManager.userRole || window.dataManager.isAdmin) {
                 applyViewerPermissions({
                     role: window.dataManager.userRole,
                     permissions: window.dataManager.permissions
                 });
            } 
            // Also check for cached state manually just in case dataManager isn't exposing props yet
            // (Though dataManager properties are updated before event dispatch)
        }
    });

    // Also check right now if scripts run sequentially and body is mostly parsed
    if (window.dataManager && (window.dataManager.userRole === 'viewer')) {
         // Try to apply immediately if DOM elements exist, waiting for DOMContentLoaded is usually safer
         // but if this script is at end of body, it's fine.
    }
})();
