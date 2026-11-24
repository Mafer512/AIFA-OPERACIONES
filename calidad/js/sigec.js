/**
 * sigec.js — Registro de módulos sin servidor.
 * Permite abrir el sistema con doble clic (file://), donde el navegador
 * bloquea los módulos ES. Cada archivo se envuelve en una IIFE y publica
 * su API con SIGEC.define(); las dependencias se obtienen con SIGEC.use().
 * El orden de los <script> en el HTML debe respetar las dependencias.
 */
(function () {
  'use strict';
  const registry = Object.create(null);
  const api = {
    define(name, exports) {
      if (registry[name]) throw new Error(`Módulo duplicado: ${name}`);
      registry[name] = Object.freeze(exports);
    },
    use(name) {
      const m = registry[name];
      if (!m) throw new Error(`Módulo no cargado (revisa el orden de <script>): ${name}`);
      return m;
    },
  };
  Object.defineProperty(window, 'SIGEC', { value: Object.freeze(api), writable: false, configurable: false });
})();
