/**
 * modulo.js — Cargador del módulo SIGEC para incrustarlo en otro sistema.
 *
 *   <script src="calidad/modulo.js"></script>
 *   SigecCalidad.iniciarSesion({ username: 'ana', name: 'Ana', role: 'consulta', area: 'Calidad' });
 *   var modulo = SigecCalidad.montar('#contenedor', { ruta: 'reportes' });
 *
 * El módulo vive en un <iframe> del mismo origen: sus estilos y librerías no
 * chocan con los del sistema anfitrión. Solo agrega un global: SigecCalidad.
 */
(function () {
  'use strict';
  // Carpeta del módulo: la de este archivo. Sin currentScript (cargado por
  // eval, p. ej. en pruebas) se busca su <script>; si no, calidad/ del sitio.
  var yo = document.currentScript || Array.prototype.slice.call(document.getElementsByTagName('script'))
    .filter(function (s) { return /(^|\/)modulo\.js(\?|$)/.test(s.getAttribute('src') || ''); }).pop();
  var BASE = yo && yo.src ? new URL('.', yo.src).href : new URL('calidad/', document.baseURI).href;
  var KEY = 'sigec.session';
  var ROLES = ['admin', 'supervisor', 'capturista', 'consulta'];
  var RUTAS = ['inicio', 'reportes', 'encuestas', 'documentacion', 'directorio', 'configuracion'];

  function urlDe(ruta) {
    return BASE + 'index.html?embed=1#/' + (RUTAS.indexOf(ruta) >= 0 ? ruta : 'inicio');
  }

  /**
   * Entrega al módulo la identidad ya autenticada por el anfitrión.
   * Solo controla la interfaz: los datos deben protegerse en el servidor (RLS).
   */
  function iniciarSesion(usuario) {
    if (!usuario || !usuario.username) throw new Error('SigecCalidad: falta username.');
    var ahora = Date.now();
    window.sessionStorage.setItem(KEY, JSON.stringify({
      user: {
        username: String(usuario.username),
        name: String(usuario.name || usuario.username),
        role: ROLES.indexOf(usuario.role) >= 0 ? usuario.role : 'consulta',
        area: String(usuario.area || ''),
      },
      issuedAt: ahora,
      lastActivity: ahora,
    }));
  }

  /** Llamar al cerrar sesión en el anfitrión. */
  function cerrarSesion() {
    window.sessionStorage.removeItem(KEY);
  }

  /**
   * Marca actividad en la sesión vigente. El anfitrión la llama mientras su
   * propia sesión siga abierta, para que el módulo no caduque por su cuenta.
   */
  function renovarSesion() {
    try {
      var s = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
      if (!s || !s.user) return false;
      s.lastActivity = Date.now();
      window.sessionStorage.setItem(KEY, JSON.stringify(s));
      return true;
    } catch (e) { return false; }
  }

  function montar(destino, opciones) {
    var o = opciones || {};
    var el = typeof destino === 'string' ? document.querySelector(destino) : destino;
    if (!el) throw new Error('SigecCalidad: no existe el contenedor ' + destino);
    var f = document.createElement('iframe');
    f.title = 'SIGEC · Calidad';
    f.style.cssText = 'display:block;width:100%;border:0;';
    f.style.height = o.alto || '100%';
    f.src = urlDe(o.ruta);
    // Si el módulo se queda sin sesión, avisa aquí en vez de llevarse toda la
    // ventana al login (ver goLogin en js/boot.js).
    if (typeof o.alSalir === 'function') f.sigecAlSalir = o.alSalir;
    el.replaceChildren(f);
    return {
      iframe: f,
      ir: function (ruta) { f.src = urlDe(ruta); },
      desmontar: function () { f.remove(); },
    };
  }

  window.SigecCalidad = Object.freeze({
    montar: montar, iniciarSesion: iniciarSesion, cerrarSesion: cerrarSesion, renovarSesion: renovarSesion, rutas: RUTAS.slice(), version: '0.3.0',
  });
})();
