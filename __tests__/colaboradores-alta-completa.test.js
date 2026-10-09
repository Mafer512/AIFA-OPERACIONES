/**
 * @jest-environment jsdom
 *
 * El alta de colaborador sin QR tiene que pedir todo lo que la Tabla Completa
 * enseña: cada columna de agenda_2026 tiene un campo propio o aparece en
 * "Otros datos de la tabla". Con QR, en cambio, el área sólo llena lo que el
 * colaborador no puede capturar desde el portal, y los pasos que se quedan sin
 * nada que capturar se esconden.
 *
 * Se montan el modal real y las funciones reales de index.html en jsdom.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    if (j < 0) throw new Error('Sin cierre: ' + desde);
    return app.slice(i, j + hasta.length);
}

const FIN = '\n' + ' '.repeat(24);

/** Un registro de agenda_2026 con los nombres de columna reales y tres que el alta no conoce. */
const REGISTRO = {
    id: 1, created_at: '2026-01-01',
    'No. Empleado': '1551', Nombre: 'Pérez López Juan', Puesto: 'Analista', Sexo: 'Masculino',
    'Fecha de Ingreso': '01/01/2020', 'Fecha de nacimiento': '1990-05-04', Celular: '5512345678',
    'Ext.': '1234', 'Correo Institucional': 'a@aifa.com.mx', 'Correo Personal': 'a@gmail.com',
    'Profesión': 'Ingeniería', Militar: 'Civil', Nivel: '11', Plaza: 'Base', Turno: 'Matutino', RyR: '',
    'Grado Militar': '', 'Matrícula': '', 'Grado Académico': 'Licenciatura', 'Cédula': '',
    'Personal Comisionado': '0', 'Dir. Orgánica': 'DO', 'Subdir. Orgánica': 'SO', 'Gerencia Orgánica': 'G',
    'Coordinación Orgánica': 'C', 'Licencia de Manejo': '', 'Tipo Licencia': '', 'Vigencia Licencia': '',
    'Vigencia Credencial': '', 'Vigencia INE': '', Domicilio: '', RFC: '', CURP: '', 'Estado Civil': '',
    Dependientes: '', 'Rúbrica': 'PLJ', 'Doc. Ingreso': '', 'Contacto 1 Nombre': '', 'Contacto 1 Parentesco': '',
    'Contacto 1 Tel': '', 'Contacto 2 Nombre': '', 'Contacto 2 Parentesco': '', 'Contacto 2 Tel': '',
    'Tipo de sangre': 'O+', 'Alergia Medicamento': '', 'Alergia Alimento': '', NSS: '',
    Estatus: 'Activo', 'Sueldo Bruto': '25000', Comentarios: '', Amonestaciones: '',
    pertenece_direccion_operacion: true, foto: '', foto_ine: '', cv_url: '',
    cursos_programados: [], onboarding_estado: 'pendiente',
    // Las que el alta no conoce: tienen que pedirse en "Otros datos".
    Medidas: 'M', Permisos: '', 'Talla de calzado': 27, Vacunado: true,
};

function montar() {
    document.body.innerHTML = trozo('<div class="modal fade" id="colabNuevoModal"', '<!-- /colabNuevoModal -->');

    const ctx = {
        document, console, URL,
        setTimeout: (fn) => fn(),
        colabCache: [REGISTRO],
        colabCargarTodos: async () => [REGISTRO],
        bootstrap: { Tab: { getOrCreateInstance: (btn) => ({ show: () => {
            document.querySelectorAll('#colabNuevoTabs .nav-link').forEach(b => b.classList.toggle('active', b === btn));
        } }) } },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext([
        trozo('function norm(s) {', FIN + '}'),
        trozo('function colabDetectarColumnas(record) {', FIN + '}').replace(/console\.log\([^;]*;/g, ''),
        'var colabCols = colabDetectarColumnas(colabCache[0]);',
        trozo('const COLAB_ORG_NIVELES', ';'),
        trozo('const COLAB_DOCUMENT_IMAGE_UI = Object.freeze({', FIN + '});'),
        trozo('const COLAB_ONBOARDING_FIJOS = [', FIN + '];'),
        trozo('const COLAB_ONBOARDING_ADMIN = [', FIN + '];'),
        trozo('const COLAB_ONBOARDING_REQUERIDOS = [', '.filter(c => c.requerido));'),
        trozo('const COLAB_NUEVO_FIELD_MAP = {', FIN + '};'),
        trozo('const CTBL_COL_LABELS = {', FIN + '};'),
        trozo('const CTBL_HIDDEN_COLS', ';'),
        trozo('function ctblCanonCol(k) {', FIN + '}'),
        trozo('function ctblLabelCol(k) {', FIN + '}'),
        trozo('let colabNuevoModoActual', '/* ===').slice(0, -'/* ==='.length),
    ].join('\n'), ctx);
    ctx.colabNuevoPintarExtras();
    ctx.colabNuevoModo('completo');
    return ctx;
}

const columnaDe = (el) => el.closest('[class*="col-"]');
const visible = (ctx, id) => ctx.colabNuevoVisible(document.getElementById(id));
const pasos = () => [...document.querySelectorAll('#colabNuevoTabs .nav-item')]
    .filter(li => !li.classList.contains('cn-oculto'))
    .map(li => li.textContent.trim());

describe('captura completa', () => {
    test('cada columna de la tabla tiene dónde capturarse', () => {
        const ctx = montar();
        const mapa = vm.runInContext('COLAB_NUEVO_FIELD_MAP', ctx);
        const cols = vm.runInContext('colabCols', ctx);
        const cubiertas = new Set(Object.values(mapa).map(k => cols[k]).filter(Boolean));
        const extras = new Set([...document.querySelectorAll('#cn-extras [data-col]')].map(el => el.dataset.col));
        // Lo que se captura de otra forma: palomita, archivos, columnas internas.
        const aparte = new Set(['id', 'created_at', 'pertenece_direccion_operacion', 'foto', 'foto_ine', 'cv_url',
            'cursos_programados', 'onboarding_estado']);
        const sinLugar = Object.keys(REGISTRO).filter(c => !cubiertas.has(c) && !extras.has(c) && !aparte.has(c));
        expect(sinLugar).toEqual([]);
    });

    test('las columnas desconocidas salen en "Otros datos" con su tipo', () => {
        montar();
        const extras = [...document.querySelectorAll('#cn-extras [data-col]')];
        expect(extras.map(el => el.dataset.col)).toEqual(['Medidas', 'Permisos', 'Talla de calzado', 'Vacunado']);
        expect(extras.find(el => el.dataset.col === 'Talla de calzado').type).toBe('number');
        expect(extras.find(el => el.dataset.col === 'Vacunado').tagName).toBe('SELECT');
        expect(document.getElementById('cn-extras-wrap').classList.contains('d-none')).toBe(false);
    });

    test('lo de "Otros datos" se guarda con el tipo de la columna', () => {
        const ctx = montar();
        const porCol = col => document.querySelector('#cn-extras [data-col="' + col + '"]');
        porCol('Medidas').value = ' G ';
        porCol('Talla de calzado').value = '26';
        porCol('Vacunado').value = 'false';
        expect(ctx.colabNuevoLeerExtras()).toEqual({ Medidas: 'G', 'Talla de calzado': 26, Vacunado: false });
    });

    test('se ven los siete pasos y todos los campos', () => {
        const ctx = montar();
        expect(pasos()).toEqual(['Generales', 'Clasificación', 'Organización', 'Documentos', 'Emergencias',
            'Archivos', 'Notas']);
        ['cn-nss', 'cn-c1-nombre', 'cn-sueldo', 'cn-comentarios', 'cn-arch-foto'].forEach(id => {
            expect(visible(ctx, id)).toBe(true);
        });
    });

    test('el avance cuenta lo capturado', () => {
        const ctx = montar();
        document.getElementById('cn-num').value = '2001';
        document.getElementById('cn-nombre').value = 'Ruiz Ana';
        ctx.colabNuevoContar();
        const gen = document.querySelector('[data-bs-target="#cnuevo-gen"]');
        expect(gen.dataset.cuenta).toMatch(/^2\/\d+$/);
        expect(document.getElementById('cn-avance-txt').textContent).toMatch(/^2 de \d+ datos$/);
    });
});

describe('con QR de onboarding', () => {
    test('sólo pide lo que el colaborador no puede capturar', () => {
        const ctx = montar();
        ctx.colabNuevoModo('qr');
        ['cn-num', 'cn-nombre', 'cn-puesto', 'cn-nivel', 'cn-plaza', 'cn-direccion', 'cn-fecha-ingreso', 'cn-turno']
            .forEach(id => expect(visible(ctx, id)).toBe(true));
        ['cn-celular', 'cn-curp', 'cn-sexo', 'cn-sueldo', 'cn-nss']
            .forEach(id => expect(visible(ctx, id)).toBe(false));
        expect(document.getElementById('colabNuevoModal').classList.contains('cn-modo-qr')).toBe(true);
    });

    test('esconde los pasos que se quedan vacíos', () => {
        const ctx = montar();
        ctx.colabNuevoModo('qr');
        expect(pasos()).toEqual(['Generales', 'Clasificación', 'Organización', 'Documentos']);
        ctx.colabNuevoModo('completo');
        expect(pasos()).toHaveLength(7);
    });

    test('si estaba en un paso que se esconde, regresa al primero', () => {
        const ctx = montar();
        ctx.colabNuevoPaso(1); ctx.colabNuevoPaso(1); ctx.colabNuevoPaso(1); ctx.colabNuevoPaso(1);
        expect(document.querySelector('#colabNuevoTabs .nav-link.active').textContent.trim()).toBe('Emergencias');
        ctx.colabNuevoModo('qr');
        expect(document.querySelector('#colabNuevoTabs .nav-link.active').textContent.trim()).toBe('Generales');
    });
});

describe('Anterior y Siguiente', () => {
    test('recorren los pasos visibles y se apagan en las orillas', () => {
        const ctx = montar();
        const ant = document.getElementById('cn-paso-ant');
        const sig = document.getElementById('cn-paso-sig');
        ctx.colabNuevoPintarNav();
        expect(ant.disabled).toBe(true);
        for (let i = 0; i < 6; i++) ctx.colabNuevoPaso(1);
        ctx.colabNuevoPintarNav();
        expect(document.querySelector('#colabNuevoTabs .nav-link.active').textContent.trim()).toBe('Notas');
        expect(sig.classList.contains('d-none')).toBe(true);
        ctx.colabNuevoPaso(-1);
        ctx.colabNuevoPintarNav();
        expect(ant.disabled).toBe(false);
        expect(sig.classList.contains('d-none')).toBe(false);
    });
});

describe('campos sin columna en la base', () => {
    test('no se piden si no se guardarían, salvo los del QR', () => {
        const sinSueldo = Object.assign({}, REGISTRO);
        delete sinSueldo['Sueldo Bruto'];
        delete sinSueldo.Turno;
        const ctx = montar();
        vm.runInContext('colabCols = colabDetectarColumnas(' + JSON.stringify(sinSueldo) + ');', ctx);
        ctx.colabNuevoModo('completo');
        expect(columnaDe(document.getElementById('cn-sueldo')).classList.contains('cn-sin-columna')).toBe(true);
        // El turno viaja en el QR aunque la tabla no tenga columna.
        expect(columnaDe(document.getElementById('cn-turno')).classList.contains('cn-sin-columna')).toBe(false);
    });
});
