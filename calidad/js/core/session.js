(function () {
  'use strict';
  /**
   * session.js — Sesión, roles y permisos.
   *
   * La sesión vive en sessionStorage (se borra al cerrar la pestaña) y expira
   * por inactividad. El origen de la identidad se define en js/config.js.
   *
   * Dentro de AIFA Operaciones la sesión la entrega el sistema
   * (SigecCalidad.iniciarSesion) con el rol que calcula la base
   * (calidad_mi_rol(), db/calidad_sigec.sql). Los permisos de esta capa solo
   * ocultan botones; quien autoriza es la base (RLS).
   */

  const KEY = 'sigec.session';
  const IDLE_MS = window.SIGEC_ENV.idleMs;

  const ROLES = {
    admin:      { label: 'Administrador', color: 'accent' },
    supervisor: { label: 'Supervisor de Calidad', color: 'brand' },
    capturista: { label: 'Capturista', color: 'info' },
    consulta:   { label: 'Consulta', color: 'neutral' },
  };

  const PERMISSIONS = {
    'incidencia:crear':    ['admin', 'supervisor', 'capturista'],
    'incidencia:editar':   ['admin', 'supervisor'],
    'documento:subir':     ['admin', 'supervisor'],
    'encuesta:capturar':   ['admin', 'supervisor', 'capturista'],
    'directorio:editar':   ['admin', 'supervisor'],
    'exportar':            ['admin', 'supervisor', 'capturista', 'consulta'],
    'usuarios:gestionar':  ['admin'],
    'catalogos:ver':       ['admin', 'supervisor'],
  };

  function read() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!s || !s.user) return null;
      if (Date.now() - s.lastActivity > IDLE_MS) { sessionStorage.removeItem(KEY); return null; }
      return s;
    } catch { return null; }
  }

  function write(s) {
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* almacenamiento bloqueado */ }
  }

  function current() { return read(); }
  function user() { return read()?.user ?? null; }

  function can(permission) {
    const u = user();
    return !!u && (PERMISSIONS[permission] || []).includes(u.role);
  }

  const fail = () => Object.assign(new Error('Usuario o contraseña incorrectos.'), { code: 'invalid_credentials' });

  /** Autentica con config.autenticar; si no existe, solo permite entrar en modo demo. */
  async function signIn({ username, password, role }) {
    const cfg = window.SIGEC_CONFIG || {};
    let u;
    if (typeof cfg.autenticar === 'function') {
      u = await cfg.autenticar({ username: String(username || '').trim(), password: String(password || '') });
      if (!u || !u.username) throw fail();
    } else if (cfg.modoDemo === true) {
      await new Promise((r) => setTimeout(r, 650)); // simula latencia de red
      const uname = String(username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(uname) || String(password || '').length < 8) throw fail();
      const pretty = uname.split(/[._-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
      u = { username: uname, name: pretty, role };
    } else {
      throw Object.assign(new Error('El inicio de sesión no está configurado.'), { code: 'not_configured' });
    }
    const session = {
      user: {
        username: String(u.username),
        name: String(u.name || u.username),
        role: Object.hasOwn(ROLES, u.role) ? u.role : 'consulta', // rol desconocido = mínimo privilegio
        area: String(u.area || 'Gerencia de Calidad'),
      },
      issuedAt: Date.now(),
      lastActivity: Date.now(),
    };
    write(session);
    return session;
  }

  function signOut(reason) {
    try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
    window.SIGEC_ENV.goLogin(reason || '');
  }

  /** Renueva la marca de actividad (con limitación de frecuencia). */
  let lastTouch = 0;
  function touch() {
    const now = Date.now();
    if (now - lastTouch < 15000) return;
    lastTouch = now;
    const s = read();
    if (s) { s.lastActivity = now; write(s); }
  }

  /** Observa la inactividad y cierra sesión al expirar. */
  function watchIdle(onWarn) {
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
      window.addEventListener(ev, touch, { passive: true }));
    let warned = false;
    setInterval(() => {
      const s = read();
      if (!s) return signOut('inactividad');
      const left = IDLE_MS - (Date.now() - s.lastActivity);
      if (left < 60000 && !warned) { warned = true; onWarn?.(left); }
      if (left > 60000) warned = false;
    }, 10000);
  }

  SIGEC.define('core/session', { IDLE_MS, ROLES, current, user, can, signIn, signOut, touch, watchIdle });
})();
