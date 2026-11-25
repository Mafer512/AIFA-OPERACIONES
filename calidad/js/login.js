(function () {
  'use strict';
  /** login.js — Inicio de sesión. */
  const { $ } = SIGEC.use('core/dom');
  const { signIn, current } = SIGEC.use('core/session');
  const { toast, showFieldErrors } = SIGEC.use('core/ui');
  // Si ya hay sesión vigente, ir directo al sistema.
  const HOME = window.SIGEC_ENV.page('index.html', {}, '#/inicio');
  if (current()) window.location.replace(HOME);

  const cfg = window.SIGEC_CONFIG || {};
  const esDemo = cfg.modoDemo === true && typeof cfg.autenticar !== 'function';
  $('#demo-box').hidden = !esDemo;

  const form = $('#login-form');
  const btn = $('#btn-login');
  const alertBox = $('#login-alert');
  const alertText = $('#login-alert-text');

  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 60000;
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* noop */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
  };

  function showAlert(msg) { alertText.textContent = msg; alertBox.hidden = !msg; }

  // Motivo de redirección
  const motivo = new URLSearchParams(location.search).get('motivo');
  if (motivo === 'inactividad') showAlert('Tu sesión se cerró por inactividad. Inicia sesión nuevamente.');

  // Usuario recordado (nunca la contraseña)
  const remembered = LS.get('sigec.remember');
  if (remembered && /^[a-z0-9._-]{3,40}$/.test(remembered)) {
    form.elements.username.value = remembered;
    $('#remember').checked = true;
    form.elements.password.focus();
  } else {
    form.elements.username.focus();
  }

  // Mostrar / ocultar contraseña
  $('#toggle-pw').addEventListener('click', (e) => {
    const b = e.currentTarget;
    const show = form.elements.password.type === 'password';
    form.elements.password.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    b.firstElementChild.className = `bi ${show ? 'bi-eye-slash' : 'bi-eye'}`;
  });

  // Aviso de Bloq Mayús
  form.elements.password.addEventListener('keyup', (e) => { $('#caps-warn').hidden = !e.getModifierState?.('CapsLock'); });

  $('#forgot').addEventListener('click', () => toast('Para restablecer tu contraseña comunícate con Mesa de Ayuda TI (ext. 5000).', 'info', 6000));

  // Bloqueo temporal tras intentos fallidos (UX; el límite real debe aplicarse en el servidor)
  function lockedFor() {
    const until = Number(LS.get('sigec.lock') || 0);
    return Math.max(0, until - Date.now());
  }
  let lockTimer;
  function applyLock() {
    const ms = lockedFor();
    if (!ms) { btn.disabled = false; return; }
    btn.disabled = true;
    showAlert(`Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(ms / 1000)} s.`);
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { if (lockedFor()) applyLock(); else { showAlert(''); btn.disabled = false; } }, 1000);
  }
  applyLock();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (lockedFor()) return applyLock();
    const username = form.elements.username.value.trim().toLowerCase();
    const password = form.elements.password.value;
    const errors = {};
    if (!username) errors.username = 'Escribe tu usuario.';
    if (!password) errors.password = 'Escribe tu contraseña.';
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;

    btn.disabled = true;
    btn.firstElementChild.textContent = 'Verificando…';
    btn.lastElementChild.className = 'bi bi-arrow-repeat spin';
    try {
      await signIn({ username, password, role: form.elements.role.value });
      LS.del('sigec.attempts');
      if ($('#remember').checked) LS.set('sigec.remember', username); else LS.del('sigec.remember');
      window.location.replace(HOME);
    } catch (err) {
      if (err.code === 'not_configured') { showAlert('El inicio de sesión aún no está configurado (js/config.js).'); btn.disabled = false; return; }
      const n = Number(LS.get('sigec.attempts') || 0) + 1;
      LS.set('sigec.attempts', String(n));
      form.elements.password.value = '';
      if (n >= MAX_ATTEMPTS) {
        LS.set('sigec.lock', String(Date.now() + LOCK_MS));
        LS.del('sigec.attempts');
        applyLock();
      } else {
        // Mensaje genérico: no revela si el usuario existe.
        showAlert(`Usuario o contraseña incorrectos. Intentos restantes: ${MAX_ATTEMPTS - n}.`);
        btn.disabled = false;
      }
      form.elements.password.focus();
    } finally {
      btn.firstElementChild.textContent = 'Ingresar';
      btn.lastElementChild.className = 'bi bi-arrow-right';
    }
  });
})();
