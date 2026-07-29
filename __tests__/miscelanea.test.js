/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scriptSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const modulePath = path.join(root, 'js', 'miscelanea.js');

function createFixture() {
  document.body.innerHTML = `
    <div id="si-user-dropdown">
      <a id="historia-admin-menu" class="menu-item" data-section="historia">Historia</a>
      <a id="miscelanea-menu" class="menu-item d-none" data-section="miscelanea">Miscelánea</a>
      <a id="data-management-menu" class="menu-item" data-section="data-management">Gestión de Datos</a>
    </div>
    <i id="si-user-chevron" style="transform:rotate(180deg)"></i>
    <div id="miscelanea-section" class="content-section"></div>
    <div id="miscelanea-modal" class="modal" aria-labelledby="miscelanea-modal-title">
      <div id="miscelanea-modal-title">Miscelánea</div>
      <button type="button" data-miscelanea-tool="directorio" data-tool-label="Directorio">Directorio</button>
      <button type="button" data-miscelanea-tool="marca-agua" data-tool-label="Marca de agua">Marca de agua</button>
      <div id="miscelanea-status"></div>
    </div>
  `;
}

function installBootstrapStub() {
  const instances = new WeakMap();
  class ModalStub {
    constructor(element) {
      this.element = element;
      this.show = jest.fn();
      this.hide = jest.fn();
      instances.set(element, this);
    }

    static getOrCreateInstance(element) {
      return instances.get(element) || new ModalStub(element);
    }
  }
  window.bootstrap = { Modal: ModalStub };
  return { instances, ModalStub };
}

function loadModule() {
  const source = fs.readFileSync(modulePath, 'utf8');
  const factory = new Function('window', 'document', 'bootstrap', source + '\nreturn window.miscelaneaModule;');
  return factory(window, document, window.bootstrap);
}

describe('contrato estático de Miscelánea', () => {
  test('el acceso está entre Historia y Gestión de Datos y tiene host formal', () => {
    const historia = indexSource.indexOf('id="historia-admin-menu"');
    const miscelanea = indexSource.indexOf('id="miscelanea-menu"');
    const dataManagement = indexSource.indexOf('id="data-management-menu"');

    expect(historia).toBeGreaterThan(-1);
    expect(miscelanea).toBeGreaterThan(historia);
    expect(dataManagement).toBeGreaterThan(miscelanea);
    expect(indexSource.match(/data-section="miscelanea"/g)).toHaveLength(1);
    expect(indexSource).toContain('id="miscelanea-section" class="content-section"');
  });

  test('declara modal, herramientas, archivo modular y vista administrable', () => {
    expect(indexSource).toContain('id="miscelanea-modal"');
    expect(indexSource).toContain('data-miscelanea-tool="directorio"');
    expect(indexSource).toContain('data-miscelanea-tool="marca-agua"');
    expect(indexSource).toContain('src="js/miscelanea.js');
    expect(scriptSource).toMatch(/\{\s*key:\s*'miscelanea',\s*label:\s*'Miscel[aá]nea'/);
    expect(scriptSource).toMatch(/sections:\s*\[\s*'miscelanea'\s*\]/);
  });
});

describe('control de acceso y modal de Miscelánea', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    delete window.miscelaneaModule;
    delete window.miscelaneaOpen;
    delete window.dataManager;
    createFixture();
    installBootstrapStub();
  });

  test('muestra el acceso a un usuario con permiso explícito y abre el modal', () => {
    const module = loadModule();
    module.init();
    module.syncVisibility({
      role: 'lector',
      permissions: { allowed_sections: ['inicio', 'miscelanea'] }
    });

    const menu = document.getElementById('miscelanea-menu');
    expect(menu.classList.contains('d-none')).toBe(false);

    menu.click();

    const instance = window.bootstrap.Modal.getOrCreateInstance(
      document.getElementById('miscelanea-modal')
    );
    expect(instance.show).toHaveBeenCalledTimes(1);
    expect(document.getElementById('si-user-dropdown').classList.contains('d-none')).toBe(true);
  });

  test('falla cerrado para un usuario restringido y para __none__', () => {
    const module = loadModule();
    module.init();

    module.syncVisibility({
      role: 'viewer',
      permissions: { allowed_sections: ['inicio'] }
    });
    expect(document.getElementById('miscelanea-menu').classList.contains('d-none')).toBe(true);
    expect(module.open()).toBe(false);

    module.syncVisibility({
      role: 'viewer',
      permissions: { allowed_sections: ['__none__'] }
    });
    expect(module.open()).toBe(false);

    const instance = window.bootstrap.Modal.getOrCreateInstance(
      document.getElementById('miscelanea-modal')
    );
    expect(instance.show).not.toHaveBeenCalled();
  });

  test.each(['admin', 'superadmin'])('%s conserva acceso total', (role) => {
    const module = loadModule();
    module.init();
    module.syncVisibility({ role, permissions: { allowed_sections: ['__none__'] } });

    expect(document.getElementById('miscelanea-menu').classList.contains('d-none')).toBe(false);
    expect(module.open()).toBe(true);
  });

  test('una lista vacía conserva la semántica existente de acceso total', () => {
    const module = loadModule();
    module.init();
    module.syncVisibility({ role: 'capturista', permissions: { allowed_sections: [] } });

    expect(document.getElementById('miscelanea-menu').classList.contains('d-none')).toBe(false);
  });

  test('permisos sin allowed_sections conservan el acceso sin restricciones', () => {
    const module = loadModule();
    module.init();
    module.syncVisibility({ role: 'lector', permissions: {} });

    expect(document.getElementById('miscelanea-menu').classList.contains('d-none')).toBe(false);
  });

  test('el inicializador es idempotente y cada herramienta emite un evento extensible', () => {
    const module = loadModule();
    module.init();
    module.init();
    module.syncVisibility({ role: 'editor', permissions: { allowed_sections: ['miscelanea'] } });

    document.getElementById('miscelanea-menu').click();
    const instance = window.bootstrap.Modal.getOrCreateInstance(
      document.getElementById('miscelanea-modal')
    );
    expect(instance.show).toHaveBeenCalledTimes(1);

    const selected = jest.fn();
    window.addEventListener('miscelanea:tool-selected', selected, { once: true });
    document.querySelector('[data-miscelanea-tool="directorio"]').click();

    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0][0].detail).toEqual({
      tool: 'directorio',
      label: 'Directorio'
    });
    expect(document.getElementById('miscelanea-status').textContent).toContain('Directorio');
  });
});

