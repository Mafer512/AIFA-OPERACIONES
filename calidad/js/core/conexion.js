(function () {
  'use strict';
  /**
   * conexion.js — Sesión tomada de AIFA Operaciones.
   *
   * Calidad se abre en su propia pestaña. La cuenta es la misma con la que se
   * entró a AIFA Operaciones en este navegador (Supabase guarda la sesión para
   * todo el sitio), así que no se pide usuario ni contraseña otra vez. El rol lo
   * calcula la base con calidad_mi_rol() (db/calidad_sigec.sql) cada vez que se
   * abre la página, así un cambio de permisos aplica al recargar.
   */
  const cfg = window.SIGEC_CONFIG || {};
  const KEY = 'sigec.session';
  const ROLES = ['admin', 'supervisor', 'capturista', 'consulta'];

  function cliente() {
    try { return typeof cfg.supabase === 'function' ? cfg.supabase() : null; } catch { return null; }
  }

  function leer(clave) {
    try { return sessionStorage.getItem(clave) || ''; } catch { return ''; }
  }

  /** Nombre como lo muestra AIFA Operaciones: metadata de la cuenta o su perfil. */
  async function nombreDe(c, user) {
    const md = user.user_metadata || {};
    let n = String(md.full_name || md.name || '').trim();
    if (!n) {
      try {
        const { data } = await c.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
        n = String(data?.full_name || '').trim();
      } catch { n = ''; }
    }
    if (!n && leer('currentUser') === user.email) n = leer('user_fullname');
    return n || user.email;
  }

  /**
   * Entrega la sesión del módulo a partir de la de AIFA Operaciones.
   * Devuelve { estado: 'ok' | 'sin-sesion' | 'sin-acceso' | 'sin-conexion' | 'error', error? }.
   */
  async function conectar() {
    const c = cliente();
    if (!c || !c.auth || typeof c.rpc !== 'function') return { estado: 'sin-conexion' };
    let user = null;
    try {
      const { data } = await c.auth.getSession();
      user = data?.session?.user || null;
    } catch { user = null; }
    if (!user) return { estado: 'sin-sesion' };

    let r;
    try { r = await c.rpc('calidad_mi_rol'); } catch (e) { return { estado: 'error', error: e }; }
    if (r.error) return { estado: 'error', error: r.error };
    if (!ROLES.includes(r.data)) return { estado: 'sin-acceso' };

    const ahora = Date.now();
    const sesion = {
      user: {
        username: String(user.email || ''),
        name: await nombreDe(c, user),
        role: r.data,
        area: leer('user_area') || 'AIFA Operaciones',
      },
      issuedAt: ahora,
      lastActivity: ahora,
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(sesion)); } catch { /* almacenamiento bloqueado */ }

    // Si se cierra sesión en AIFA Operaciones (en cualquier pestaña), aquí también.
    try {
      c.auth.onAuthStateChange((evento) => {
        if (evento !== 'SIGNED_OUT') return;
        try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
        window.SIGEC_ENV.goLogin('');
      });
    } catch { /* noop */ }
    return { estado: 'ok' };
  }

  /** Cerrar sesión aquí es cerrarla en AIFA Operaciones: es la misma cuenta. */
  async function salir() {
    try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
    try { await cliente()?.auth?.signOut(); } catch { /* sin red: igual se sale */ }
    window.SIGEC_ENV.goLogin('');
  }

  SIGEC.define('core/conexion', { conectar, salir });
})();
