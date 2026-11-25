/**
 * config.js — ÚNICO archivo que debes editar al integrar el módulo.
 * Es público (lo descarga el navegador): no pongas aquí contraseñas ni la
 * llave service_role de Supabase.
 *
 * Integrado en AIFA Operaciones: el menú Edificio Terminal → Calidad (SIGEC)
 * abre esta página en una pestaña nueva (js/calidad-host.js). La cuenta, el rol
 * y la conexión a la base son los de AIFA Operaciones (js/core/conexion.js).
 */
window.SIGEC_CONFIG = {
  // true  = login de demostración (acepta cualquier contraseña). SOLO para pruebas.
  // false = exige `autenticar` o una sesión entregada por el sistema anfitrión.
  modoDemo: false,

  // true = la sesión es la de AIFA Operaciones en este navegador: no se pide
  // contraseña; sin sesión se va a loginUrl. El rol lo da la base (calidad_mi_rol).
  sesionDelSistema: true,

  // Minutos de inactividad antes de cerrar la sesión (con sesionDelSistema, la
  // gobierna AIFA Operaciones).
  minutosInactividad: 15,

  // Página a la que se envía a quien no tiene sesión. null = login.html del módulo.
  loginUrl: '../index.html',

  // Enlace "Volver" del menú lateral. null = oculto.
  portalUrl: '../index.html',
  portalNombre: 'AIFA Operaciones',

  // Cliente de Supabase. Suelto: el de ../js/supabase-client.js (misma base y
  // misma sesión que AIFA Operaciones). Incrustado en un iframe: el del sistema.
  supabase: function () {
    try {
      if (window.parent && window.parent !== window && window.parent.supabaseClient) return window.parent.supabaseClient;
    } catch (e) { /* otro origen: sin acceso */ }
    return window.supabaseClient || null;
  },

  // Inicio de sesión propio. Debe devolver { username, name, role, area } o lanzar un error.
  // role: 'admin' | 'supervisor' | 'capturista' | 'consulta'
  autenticar: null,
};
