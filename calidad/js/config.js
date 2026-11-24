/**
 * config.js — ÚNICO archivo que debes editar al integrar el módulo.
 * Es público (lo descarga el navegador): no pongas aquí contraseñas ni la
 * llave service_role de Supabase.
 *
 * Integrado en AIFA Operaciones (Edificio Terminal → Calidad): la sesión, el
 * rol y la conexión a la base los entrega el sistema; ver js/calidad-host.js.
 */
window.SIGEC_CONFIG = {
  // true  = login de demostración (acepta cualquier contraseña). SOLO para pruebas.
  // false = exige `autenticar` o una sesión entregada por el sistema anfitrión.
  modoDemo: false,

  // Minutos de inactividad antes de cerrar la sesión. Dentro de AIFA Operaciones
  // la renueva el sistema mientras su sesión siga abierta.
  minutosInactividad: 15,

  // Página a la que se envía a quien no tiene sesión. null = login.html del módulo.
  loginUrl: '../index.html',

  // Enlace "Volver" del menú lateral. null = oculto.
  portalUrl: '../index.html#calidad',
  portalNombre: 'AIFA Operaciones',

  // true = el módulo solo funciona dentro de AIFA Operaciones: si se abre suelto
  // (calidad/index.html), se envía a portalUrl.
  soloIncrustado: true,

  // Cliente de Supabase con la sesión ya iniciada. El módulo vive en un iframe
  // del mismo sitio, así que usa el del sistema: mismo usuario, mismas reglas (RLS).
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
