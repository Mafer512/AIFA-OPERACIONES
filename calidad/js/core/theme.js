(function () {
  'use strict';
  /** theme.js — Preferencias de apariencia (tema y densidad). */
  const { applyChartTheme } = SIGEC.use('core/charts');
  const listeners = new Set();
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* bloqueado */ } },
  };

  const getThemePref = () => store.get('sigec.theme', 'light');
  const getDensity = () => store.get('sigec.density', 'comfortable');
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

  function resolve(pref) {
    return pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function apply() {
    const t = resolve(getThemePref());
    const root = document.documentElement;
    const changed = root.getAttribute('data-theme') !== t;
    root.setAttribute('data-theme', t);
    root.setAttribute('data-bs-theme', t);
    applyChartTheme();
    if (changed) listeners.forEach((fn) => fn(t));
  }

  function setThemePref(pref) {
    if (!['light', 'dark', 'system'].includes(pref)) return;
    store.set('sigec.theme', pref);
    apply();
  }

  function toggleTheme() { setThemePref(isDark() ? 'light' : 'dark'); }

  function setDensity(d) {
    const v = d === 'compact' ? 'compact' : 'comfortable';
    store.set('sigec.density', v);
    if (v === 'compact') document.documentElement.setAttribute('data-density', 'compact');
    else document.documentElement.removeAttribute('data-density');
  }

  function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') apply();
  });

  function initTheme() { apply(); }

  SIGEC.define('core/theme', { getThemePref, getDensity, isDark, setThemePref, toggleTheme, setDensity, onThemeChange, initTheme });
})();
