/**
 * @jest-environment jsdom
 *
 * Catálogos de Colaboradores: puestos y adscripción.
 *
 * La plantilla tiene dos lecturas: la orgánica (dónde está la plaza conforme
 * la planilla) y la real (dónde trabaja la persona, porque mucha gente está
 * comisionada). Cada una se captura con su propio catálogo, en cascada. Lo que
 * se prueba aquí es lo que puede romperse sin que se note: que lo ya capturado
 * con abreviaturas se reconozca y no se reescriba solo, que elegir un nivel
 * llene su ruta hacia arriba, y que no se pidan niveles que el área no tiene.
 */

const cat = require('../js/colaboradores-catalogos');

const vacio = { direccion: '', subdireccion: '', gerencia: '', coordinacion: '' };
const nodo = (catalogo, nivel, nombre, gerencia) => cat.CATALOGOS[catalogo]
    .find(x => x.nivel === nivel && x.nombre === nombre && (!gerencia || x.ruta.gerencia === gerencia));

describe('reconoce lo que ya está capturado en agenda_2026', () => {
    test.each([
        ['real', 'direccion', 'Dir. Opn.', 'Dirección de Operación'],
        ['real', 'subdireccion', 'SSO', 'Subdirección de Seguridad Operacional'],
        ['real', 'subdireccion', 'SGE', 'Subdirección de Gestión Energética'],
        ['organica', 'gerencia', 'Gerencia de Operaciones Parte Aeronautica', 'Gerencia de Operaciones Parte Aeronáutica'],
        ['organica', 'gerencia', 'Gerencia de Servicios Medicos', 'Gerencia de Servicios Médicos'],
        ['organica', 'coordinacion', 'Coord. de Área de Apoyo Téc.', 'Coordinación de Área de Apoyo Técnico'],
    ])('%s · %s: "%s"', (catalogo, nivel, valor, esperado) => {
        expect(cat.buscar(catalogo, nivel, valor)).toBe(esperado);
    });

    test('"----", "0" y "N/A" son "sin dato", no un área', () => {
        ['----', '---', '0', 'N/A', '', null].forEach(v => expect(cat.esVacio(v)).toBe(true));
        expect(cat.esVacio('Archivo')).toBe(false);
    });

    test('repetir el nivel de arriba o "Directo SSC" quiere decir "depende directo"', () => {
        expect(cat.sinNivel('real', 'subdireccion', 'Dir. Opn.')).toBe(true);
        expect(cat.sinNivel('organica', 'subdireccion', 'Dirección de Operación')).toBe(true);
        expect(cat.sinNivel('real', 'gerencia', 'Directo SSC')).toBe(true);
        expect(cat.sinNivel('real', 'gerencia', 'Gerencia de Carga')).toBe(false);
        // Y como no es un área de ese nivel, no estorba la cascada.
        const ops = cat.opciones('real', 'gerencia', { ...vacio, direccion: 'Dir. Opn.', subdireccion: 'Dir. Opn.' });
        expect(ops.map(x => x.nombre)).toContain('Gerencia de Proyectos y Concursos');
    });

    test('el puesto sin acento es el mismo del catálogo, con su nivel', () => {
        expect(cat.buscarPuesto('Operador de Vehiculo Especializado')).toMatchObject({ nivel: 'N3' });
        expect(cat.buscarPuesto('Director de Operación')).toMatchObject({ nivel: 'K11' });
        expect(cat.buscarPuesto('Analista de Sistemas')).toBeNull();
    });

    test('Personal Comisionado se lee como 1 / 0', () => {
        expect(cat.normalizarComisionado('1')).toBe('1');
        expect(cat.normalizarComisionado('Sí')).toBe('1');
        expect(cat.normalizarComisionado('0')).toBe('0');
        expect(cat.normalizarComisionado('')).toBe('');
    });
});

describe('las dos plantillas no son iguales', () => {
    test('en la real, Proyectos y Concursos depende directo de la Dirección', () => {
        expect(nodo('real', 'gerencia', 'Gerencia de Proyectos y Concursos').ruta.subdireccion).toBe('');
        expect(nodo('organica', 'gerencia', 'Gerencia de Proyectos y Concursos').ruta.subdireccion)
            .toBe('Subdirección de Ingeniería');
    });

    test('cada catálogo tiene sus coordinaciones', () => {
        expect(nodo('real', 'coordinacion', 'Coordinación de HVAC')).toBeTruthy();
        expect(nodo('organica', 'coordinacion', 'Coordinación de HVAC')).toBeUndefined();
        expect(nodo('organica', 'coordinacion', 'Coordinación de Mostradores')).toBeTruthy();
    });
});

describe('cascada', () => {
    test('el nivel de arriba filtra al de abajo', () => {
        const ops = cat.opciones('organica', 'gerencia', { ...vacio, subdireccion: 'Subdirección de Servicios Conexos' });
        expect(ops.map(x => x.nombre)).toEqual(['Gerencia de Carga', 'Gerencia de Combustibles', 'Gerencia de Aviación General']);
    });

    test('un nivel de arriba fuera del catálogo deja abajo sólo texto libre', () => {
        expect(cat.opciones('real', 'subdireccion', { ...vacio, direccion: 'Dirección de Administración' })).toBeNull();
    });

    test('elegir la coordinación llena su gerencia, subdirección y dirección', () => {
        const monitoreoGen = nodo('real', 'coordinacion', 'Coordinación de Monitoreo', 'Gerencia de Generación');
        expect(cat.seleccionar('real', monitoreoGen, vacio)).toEqual({
            direccion: 'Dirección de Operación',
            subdireccion: 'Subdirección de Gestión Energética',
            gerencia: 'Gerencia de Generación',
            coordinacion: 'Coordinación de Monitoreo',
        });
    });

    test('lo que la planilla tenía como "----" se respeta para no inventar cambios', () => {
        const auditoria = nodo('organica', 'coordinacion', 'Coordinación de Auditoría');
        const r = cat.seleccionar('organica', auditoria, { direccion: '', subdireccion: '----', gerencia: '----', coordinacion: '' });
        expect(r).toEqual({ direccion: 'Dirección de Operación', subdireccion: '----', gerencia: '----', coordinacion: 'Coordinación de Auditoría' });
    });

    test('cambiar de gerencia limpia la coordinación que ya no le pertenece', () => {
        const carga = nodo('organica', 'gerencia', 'Gerencia de Carga');
        const r = cat.seleccionar('organica', carga, {
            direccion: 'Dirección de Operación', subdireccion: 'Subdirección de Seguridad Operacional',
            gerencia: 'Gerencia de Seguridad Operacional', coordinacion: 'Coordinación de Control de Fauna',
        });
        expect(r.subdireccion).toBe('Subdirección de Servicios Conexos');
        expect(r.coordinacion).toBe('');
    });

    test('cambiar de gerencia conserva la coordinación si sigue perteneciéndole', () => {
        const gso = nodo('organica', 'gerencia', 'Gerencia de Seguridad Operacional');
        const r = cat.seleccionar('organica', gso, { ...vacio, coordinacion: 'Coordinación de Control de Fauna' });
        expect(r.coordinacion).toBe('Coordinación de Control de Fauna');
    });
});

describe('niveles que el área no tiene no se piden', () => {
    const dir = 'Dirección de Operación';
    test('Gerencia de Carga no tiene coordinaciones', () => {
        expect(cat.nivelRequerido('organica', 'coordinacion',
            { direccion: dir, subdireccion: 'Subdirección de Servicios Conexos', gerencia: 'Gerencia de Carga', coordinacion: '' })).toBe(false);
    });
    test('Auditoría no tiene subdirección ni gerencia', () => {
        const v = { direccion: dir, subdireccion: '', gerencia: '', coordinacion: 'Coordinación de Auditoría' };
        expect(cat.nivelRequerido('organica', 'subdireccion', v)).toBe(false);
        expect(cat.nivelRequerido('organica', 'gerencia', v)).toBe(false);
    });
    test('con sólo la Dirección, falta la subdirección', () => {
        expect(cat.nivelRequerido('organica', 'subdireccion', { ...vacio, direccion: dir })).toBe(true);
    });
});

describe('combos en pantalla', () => {
    function montar(valores) {
        document.body.innerHTML = ['direccion', 'subdireccion', 'gerencia', 'coordinacion']
            .map(k => `<div><label for="x-${k}">${k}</label><input id="x-${k}" class="form-control form-control-sm"></div>`).join('')
            + '<div><input id="x-puesto" class="form-control form-control-sm"><input id="x-nivel"></div>';
        Object.entries(valores || {}).forEach(([k, v]) => { document.getElementById('x-' + k).value = v; });
        const ids = { direccion: 'x-direccion', subdireccion: 'x-subdireccion', gerencia: 'x-gerencia', coordinacion: 'x-coordinacion' };
        return cat.conectarOrg({ catalogo: 'real', ids });
    }
    const sel = k => document.getElementById('x-' + k + '-sel');
    const textoSel = k => sel(k).options[sel(k).selectedIndex].textContent;
    const elegir = (k, texto) => {
        const s = sel(k);
        s.value = Array.from(s.options).find(o => o.textContent === texto).value;
        s.dispatchEvent(new Event('change'));
    };

    test('lo capturado con abreviatura se muestra, pero no se reescribe solo', () => {
        montar({ direccion: 'Dir. Opn.', subdireccion: 'SSO', gerencia: '0', coordinacion: '0' });
        expect(textoSel('direccion')).toBe('Dirección de Operación');
        expect(textoSel('subdireccion')).toBe('Subdirección de Seguridad Operacional');
        expect(textoSel('gerencia')).toBe('— Sin asignar —');
        expect(document.getElementById('x-direccion').value).toBe('Dir. Opn.');
        expect(document.getElementById('x-gerencia').value).toBe('0');
        // La etiqueta ahora apunta al combo, que es lo que se ve.
        expect(document.querySelector('label[for="x-direccion-sel"]')).not.toBeNull();
    });

    test('elegir del combo escribe el nombre del catálogo y su ruta', () => {
        montar({ direccion: 'Dir. Opn.' });
        elegir('coordinacion', 'Coordinación de Slots y Demoras');
        expect(document.getElementById('x-direccion').value).toBe('Dirección de Operación');
        expect(document.getElementById('x-subdireccion').value).toBe('Subdirección de Seguridad Operacional');
        expect(document.getElementById('x-gerencia').value).toBe('Gerencia de Operaciones Parte Aeronáutica');
        expect(document.getElementById('x-coordinacion').value).toBe('Coordinación de Slots y Demoras');
    });

    test('un área fuera del catálogo queda como texto libre visible', () => {
        montar({ direccion: 'Dirección de Administración' });
        expect(sel('direccion').value).toBe('__otra__');
        expect(document.getElementById('x-direccion').classList.contains('d-none')).toBe(false);
        // Abajo de un área desconocida no hay nada del catálogo que sugerir.
        expect(Array.from(sel('subdireccion').options).map(o => o.value)).toEqual(['', '__otra__']);
    });

    test('"Otra área" abre el texto libre', () => {
        montar({});
        elegir('direccion', 'Otra área (escribir)…');
        const input = document.getElementById('x-direccion');
        expect(input.classList.contains('d-none')).toBe(false);
        input.value = 'Dirección Jurídica';
        input.dispatchEvent(new Event('input'));
        expect(Array.from(sel('subdireccion').options).map(o => o.value)).toEqual(['', '__otra__']);
    });

    test('el puesto llena el nivel', () => {
        montar();
        cat.conectarPuesto({ id: 'x-puesto', nivelId: 'x-nivel' });
        const s = document.getElementById('x-puesto-sel');
        s.value = Array.from(s.options).find(o => o.textContent.startsWith('Gerente de Carga')).value;
        s.dispatchEvent(new Event('change'));
        expect(document.getElementById('x-puesto').value).toBe('Gerente de Carga');
        expect(document.getElementById('x-nivel').value).toBe('N32');
    });

    test('un puesto del catálogo bloquea el nivel', () => {
        montar();
        cat.conectarPuesto({ id: 'x-puesto', nivelId: 'x-nivel' });
        const s = document.getElementById('x-puesto-sel');
        const nivel = document.getElementById('x-nivel');
        s.value = Array.from(s.options).find(o => o.textContent.startsWith('Gerente de Carga')).value;
        s.dispatchEvent(new Event('change'));
        expect(nivel.readOnly).toBe(true);

        // Sin puesto, el nivel vuelve a quedar libre.
        s.value = '';
        s.dispatchEvent(new Event('change'));
        expect(nivel.readOnly).toBe(false);
    });

    test('un nivel guardado que no es el del puesto se ajusta y se avisa', () => {
        montar({});
        document.getElementById('x-puesto').value = 'Gerente de Carga';
        document.getElementById('x-nivel').value = 'N5';
        cat.conectarPuesto({ id: 'x-puesto', nivelId: 'x-nivel' });
        expect(document.getElementById('x-nivel').value).toBe('N32');
        expect(document.querySelector('.cc-nivel-nota').textContent).toContain('N5');
    });

    test('un puesto fuera del catálogo se conserva', () => {
        montar({});
        document.getElementById('x-puesto').value = 'Gerente de Calidad';
        cat.conectarPuesto({ id: 'x-puesto', nivelId: 'x-nivel' });
        const s = document.getElementById('x-puesto-sel');
        expect(s.options[s.selectedIndex].textContent).toBe('Gerente de Calidad (fuera de catálogo)');
        expect(document.getElementById('x-puesto').value).toBe('Gerente de Calidad');
        // Fuera del catálogo no hay nivel que imponer.
        expect(document.getElementById('x-nivel').readOnly).toBe(false);
    });
});
