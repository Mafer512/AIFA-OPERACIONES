/* Botón de usuario del encabezado (pantalla de inicio, modo tablero).
 *
 * Muestra el icono de usuario, el nombre, el rol, la dirección a la que
 * pertenece y el correo. Al presionarlo despliega la cabecera del usuario y
 * las opciones de siempre —Cambiar contraseña, Historia, Miscelánea, Gestión
 * de Datos, Administración— más Cerrar Sesión. Esas opciones son el mismo
 * #si-user-dropdown de antes (mismos ids, manejadores y permisos), sólo que
 * ahora viven aquí; Cerrar Sesión usa la delegación global de
 * data-action="logout".
 *
 * Los datos salen de lo que la sesión ya deja escrito: el nombre y el correo
 * en la tarjeta de usuario de la barra (#si-user-name, #si-user-email), y el
 * rol y el área en sessionStorage (user_role, user_area). Se vuelven a pintar
 * cuando cambian (inicio de sesión, refresco de permisos).
 */
(function (root) {
    'use strict';

    const ROLES = {
        admin: 'Admin', superadmin: 'Superadmin', editor: 'Editor', viewer: 'Viewer',
        colab_viewer: 'Colaborador', colab_editor: 'Colaborador Ed.'
    };

    const $ = (id) => document.getElementById(id);
    const texto = (id) => ((($(id) && $(id).textContent) || '').trim());

    function leerSesion(clave) {
        try { return root.sessionStorage.getItem(clave) || ''; } catch (_) { return ''; }
    }

    // Nombre y color del área con el catálogo de la agenda (AG_AREA), si está.
    function area(clave) {
        if (!clave) return null;
        const catalogo = typeof AG_AREA !== 'undefined' ? AG_AREA : null; // eslint-disable-line no-undef
        const datos = catalogo && catalogo[clave];
        return { nombre: datos ? datos.name : clave, color: datos ? datos.border : '#16a34a' };
    }

    function poner(id, valor) {
        const el = $(id);
        if (el && el.textContent !== valor) el.textContent = valor;
    }

    function pintar() {
        const nombreSidebar = texto('si-user-name');
        const nombre = nombreSidebar && nombreSidebar !== 'Sesión activa' ? nombreSidebar : '';
        const correo = texto('si-user-email');
        const rolClave = leerSesion('user_role');
        const rol = ROLES[rolClave] || (rolClave ? rolClave.charAt(0).toUpperCase() + rolClave.slice(1) : '');
        const dir = area(leerSesion('user_area'));

        poner('hdr-user-nombre', nombre || 'Sesión activa');
        poner('hdr-user-menu-nombre', nombre || 'Sesión activa');
        poner('hdr-user-correo', correo);
        poner('hdr-user-menu-correo', correo);
        poner('hdr-user-avatar', (nombre || '?').charAt(0).toUpperCase());
        poner('hdr-user-rol', rol);
        if ($('hdr-user-rol')) $('hdr-user-rol').hidden = !rol;
        if ($('hdr-user-correo')) $('hdr-user-correo').hidden = !correo;

        const areaEl = $('hdr-user-area');
        if (areaEl) {
            areaEl.hidden = !dir;
            if (dir) {
                poner('hdr-user-area-texto', dir.nombre);
                areaEl.style.setProperty('--hdr-area', dir.color);
            }
        }

        const boton = $('hdr-user-btn');
        if (boton) {
            const partes = [nombre, rol, dir && dir.nombre, correo].filter(Boolean);
            boton.setAttribute('aria-label', partes.length ? `Usuario: ${partes.join(' · ')}` : 'Usuario');
        }
    }

    function abrir(abrirlo) {
        const menu = $('hdr-user-menu');
        const boton = $('hdr-user-btn');
        if (!menu || !boton) return;
        const abierto = abrirlo === undefined ? menu.hidden : !!abrirlo;
        menu.hidden = !abierto;
        boton.setAttribute('aria-expanded', abierto ? 'true' : 'false');
        boton.classList.toggle('is-open', abierto);
        // La franja de agenda está por encima del encabezado (z-index 1310);
        // mientras el menú está abierto, el encabezado sube para no quedar tapado.
        const cabecera = boton.closest('.header');
        if (cabecera) cabecera.classList.toggle('hdr-menu-abierto', abierto);
        if (abierto) {
            // Al navegar desde una opción, siUserGoToSection oculta la lista con
            // d-none; al volver a abrir el menú tiene que verse otra vez.
            if ($('si-user-dropdown')) $('si-user-dropdown').classList.remove('d-none');
            pintar();
        }
    }

    function iniciar() {
        const boton = $('hdr-user-btn');
        const menu = $('hdr-user-menu');
        if (!boton || !menu || boton.dataset.listo === '1') return;
        boton.dataset.listo = '1';

        boton.addEventListener('click', (ev) => {
            ev.stopPropagation();
            abrir();
        });
        document.addEventListener('click', (ev) => {
            if (!menu.hidden && !(ev.target.closest && ev.target.closest('#hdr-user'))) abrir(false);
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !menu.hidden) {
                abrir(false);
                boton.focus();
            }
        });
        // Elegir una opción la ejecuta (su propio manejador va primero) y cierra el menú.
        menu.addEventListener('click', (ev) => {
            if (ev.target.closest && ev.target.closest('a')) abrir(false);
        });

        pintar();
        if (root.MutationObserver) {
            const observador = new MutationObserver(pintar);
            ['si-user-name', 'si-user-email', 'current-user'].forEach((id) => {
                const el = $(id);
                if (el) observador.observe(el, { childList: true, characterData: true, subtree: true });
            });
        }
        root.addEventListener('admin-mode-changed', pintar);
    }

    root.InicioUsuario = { pintar, abrir };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
