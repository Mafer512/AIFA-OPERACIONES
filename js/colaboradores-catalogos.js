(function (root, factory) {
    'use strict';

    const api = factory(root);

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ColaboradoresCatalogos = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    /* Catálogos de Colaboradores: puestos y áreas.

       Las áreas vienen en dos catálogos porque la plantilla tiene dos lecturas:
       la ORGÁNICA es donde está adscrita la plaza conforme la planilla, y la
       REAL es donde la persona trabaja de verdad. Mucha gente está comisionada
       y las dos no coinciden, así que cada una se captura con su catálogo:
       la orgánica en Dir. Orgánica / Subdir. Orgánica / Gerencia Orgánica /
       Coordinación Orgánica, y la real en las columnas "… Comisionado". */

    const NIVELES = Object.freeze(['direccion', 'subdireccion', 'gerencia', 'coordinacion']);

    const DO = 'Dirección de Operación';
    const SSO = 'Subdirección de Seguridad Operacional';
    const SI = 'Subdirección de Ingeniería';
    const SSC = 'Subdirección de Servicios Conexos';
    const SGE = 'Subdirección de Gestión Energética';
    const SSA = 'Subdirección de Seguridad de la Aviación';
    const G_HIDRAULICAS = 'Gerencia de Operación y Mantenimiento de Instalaciones Hidráulicas';

    /* Cada rama: { nombre, coordinaciones, gerencias, subdirecciones }. Lo que
       cuelga directo de la Dirección (Auditoría, Archivo) va en la Dirección
       misma, sin subdirección ni gerencia. */
    const ORGANICA = [{
        nombre: DO,
        coordinaciones: ['Coordinación de Auditoría', 'Archivo'],
        subdirecciones: [
            { nombre: SSO, gerencias: [
                { nombre: 'Gerencia de Operaciones Parte Aeronáutica', coordinaciones: [
                    'Centro de Control Operativo (C.C.O.)', 'Jefe de Turno del C.C.O.',
                    'Coordinación de Abordadores Mecánicos', 'Operador de Pasillos', 'Operador de Aerocares',
                ] },
                { nombre: 'Gerencia de Operaciones Edificio Terminal', coordinaciones: [
                    'Jefatura de Operaciones del BHS', 'Jefe de Operaciones del BHS', 'Jefatura de Turnos de BHS',
                    'Técnico de BHS y Carruseles', 'Coordinación de Mostradores',
                    'Supervisión de Operación de Edificio Terminal', 'Supervisor de Operación de Edificio Terminal',
                ] },
                { nombre: 'Gerencia de Seguridad Operacional', coordinaciones: [
                    'Coordinación de Control de Fauna', 'Coordinación de Medidas de Seguridad Operacional',
                    'Servicio de Salvamento y Extinción de Incendios (S.E.I.)', 'Bombero de Aeropuerto',
                    'Coordinación de Normatividad Aeronáutica',
                ] },
                { nombre: 'Gerencia de Servicios Médicos' },
            ] },
            { nombre: SI, gerencias: [
                { nombre: 'Gerencia de Proyectos y Concursos', coordinaciones: [
                    'Coordinación de Proyectos', 'Coordinación de Concursos y Precios Unitarios',
                    'Coordinación de Área de Apoyo Técnico',
                ] },
                { nombre: 'Gerencia de Ingeniería Civil', coordinaciones: [
                    'Coordinación de Instalaciones Parte Aeronáutica', 'Coordinación de Conservación de Edificios',
                    'Coordinación de Conservación de Medio Ambiente',
                ] },
                { nombre: 'Gerencia de Ingeniería Electromecánica', coordinaciones: [
                    'Coordinación de Ingeniería Electromecánica', 'Coordinación de Instalaciones Eléctricas',
                    'Coordinación de Equipos Mecánicos', 'Coordinación de Conservación de Ayudas Visuales',
                ] },
                { nombre: G_HIDRAULICAS },
            ] },
            { nombre: SSC, gerencias: [
                { nombre: 'Gerencia de Carga' },
                { nombre: 'Gerencia de Combustibles' },
                { nombre: 'Gerencia de Aviación General' },
            ] },
            { nombre: SGE, gerencias: [
                { nombre: 'Gerencia de Transformación y Distribución' },
                { nombre: 'Gerencia de Generación' },
            ] },
            { nombre: SSA, gerencias: [
                { nombre: 'Gerencia de Seguridad', coordinaciones: [
                    'Jefatura de Seguridad a Terceros', 'Coordinación de Inspección de Equipaje Documentado',
                    'Coordinación de Seguridad Aeroportuaria', 'Supervisor de Seguridad Aeroportuaria',
                ] },
                { nombre: 'Gerencia de Identificación Aeroportuaria', coordinaciones: [
                    'Jefatura de Gestión de Identificación Aeroportuaria',
                ] },
                { nombre: 'Gerencia de Programas de Seguridad' },
                { nombre: 'Gerencia de Protección Civil' },
            ] },
        ],
    }];

    /* En la operación real la Gerencia de Proyectos y Concursos le reporta
       directo a la Dirección, y las coordinaciones se reorganizaron. */
    const REAL = [{
        nombre: DO,
        coordinaciones: ['Coordinación de Auditoría', 'Archivo'],
        gerencias: [{ nombre: 'Gerencia de Proyectos y Concursos' }],
        subdirecciones: [
            { nombre: SSO, gerencias: [
                { nombre: 'Gerencia de Operaciones Parte Aeronáutica', coordinaciones: [
                    'Centro de Control Operativo (C.C.O.)', 'Coordinación de Abordadores Mecánicos',
                    'Coordinación de Slots y Demoras',
                ] },
                { nombre: 'Gerencia de Operaciones Edificio Terminal', coordinaciones: [
                    'Sistema de Manejo de Equipaje BHS', 'Supervisión de Edificio Terminal',
                    'Grupo de Tecnologías de Seguridad', 'Grupo de Desarrollo de Software',
                ] },
                { nombre: 'Gerencia de Seguridad Operacional', coordinaciones: [
                    'Coordinación de Control de Fauna', 'Coordinación de Medidas de Seguridad Operacional',
                    'Servicio de Salvamento y Extinción de Incendios (S.E.I.)',
                    'Coordinación de Normatividad Aeronáutica',
                ] },
                { nombre: 'Gerencia de Servicios Médicos' },
            ] },
            { nombre: SI, gerencias: [
                { nombre: 'Gerencia de Ingeniería Civil', coordinaciones: [
                    'Coordinación de Vialidades Exteriores y Cercas Perimetrales',
                    'Coordinación de Instalaciones, Plomería y Red de Agua Potable',
                    'Coordinación de Plataformas y Vialidades Interiores',
                    'Coordinación de Pistas y Calles de Rodaje',
                ] },
                { nombre: 'Gerencia de Ingeniería Electromecánica', coordinaciones: [
                    'Coordinación de Equipos Especiales', 'Coordinación de Ayudas Visuales',
                    'Coordinación de HVAC', 'Coordinación de Sistemas Contra Incendios',
                ] },
                { nombre: G_HIDRAULICAS, coordinaciones: [
                    'Coordinación de Plantas de Almacenamiento de Agua Potable Primaria y Secundaria y Planta de Tratamiento de Aguas Residuales',
                    'Coordinación de Regulación Ambiental',
                    'Coordinación de Cuotas de Recuperación por el Servicio de Agua',
                ] },
            ] },
            { nombre: SSC, gerencias: [
                { nombre: 'Gerencia de Carga' },
                { nombre: 'Gerencia de Combustibles' },
                { nombre: 'Gerencia de Aviación General' },
            ] },
            { nombre: SGE, gerencias: [
                { nombre: 'Gerencia de Transformación y Distribución', coordinaciones: [
                    'Coordinación de Monitoreo', 'Coordinación de Mantenimiento', 'Coordinación de Medición',
                    'Coordinación de Utilización de la Energía', 'Coordinación de Distribución de la Energía',
                ] },
                { nombre: 'Gerencia de Generación', coordinaciones: [
                    'Coordinación de Monitoreo', 'Coordinación Operativa', 'Coordinación de Respaldo Energético',
                ] },
            ] },
            // El catálogo real que se recibió no trae Seguridad de la Aviación, pero
            // en agenda_2026 hay gente comisionada a "SSA" y a sus gerencias. Mientras
            // no llegue su estructura real, se toma la orgánica.
            { nombre: SSA, gerencias: ORGANICA[0].subdirecciones.find(s => s.nombre === SSA).gerencias },
        ],
    }];

    /* Grupo = el área a la que pertenece el puesto, como viene en el catálogo. */
    const PUESTOS = Object.freeze([
        ['Dirección de Operación', [
            ['K21', 'Subdirector General Operativo'],
            ['N6', 'Coordinador de Área'],
            ['N4', 'Profesional Ejecutivo Aeroportuario'],
            ['N3', 'Asistente Ejecutivo'],
            ['K11', 'Director de Operación'],
            ['N6', 'Supervisor de Contrataciones y Adquisiciones Públicas'],
            ['N5', 'Especialista en Contrataciones y Adquisiciones Públicas'],
            ['N6', 'Jefe de Archivo'],
            ['N4', 'Archivista'],
        ]],
        [SSO, [
            ['M33', 'Subdirector de Seguridad Operacional'],
            ['N32', 'Gerente de Operaciones de Edificio Terminal'],
            ['N6', 'Profesional de Servicios Aeroportuarios'],
            ['N5', 'Coordinador de Servicios Especializados Aeroportuarios'],
            ['N4', 'Técnico de BHS y Carruseles'],
            ['N32', 'Gerente de Operaciones Parte Aeronáutica'],
            ['N7', 'Jefe de Operaciones Aeroportuarias'],
            ['N6', 'Profesional de Operaciones Aeroportuarias'],
            ['N5', 'Técnico de Operaciones Aeroportuarias'],
            ['N6', 'Coordinador de Operaciones Aeroportuarias'],
            ['N4', 'Operador de Equipos Aeroportuarios'],
            ['N3', 'Operador de Vehículo Especializado'],
            ['N32', 'Gerente de Seguridad Operacional'],
            ['N4', 'Oficial de Operaciones Aeroportuarias'],
            ['N6', 'Comandante del S.E.I.'],
            ['N5', 'Jefe de Turno del S.E.I.'],
            ['N3', 'Bombero de Aeropuerto'],
            ['N32', 'Gerente de Servicios Médicos'],
            ['N5', 'Especialista en Servicios Médicos'],
        ]],
        [SSA, [
            ['M33', 'Subdirector de Seguridad de la Aviación'],
            ['N32', 'Gerente de Seguridad'],
            ['N6', 'Profesional en Seguridad de la Aviación'],
            ['N5', 'Especialista Ejecutivo en Seguridad de la Aviación'],
            ['N5', 'Supervisor de Seguridad Aeroportuaria'],
            ['N32', 'Gerente de Identificación Aeroportuaria'],
            ['N32', 'Gerente de Programas de Seguridad'],
        ]],
        [SI, [
            ['M33', 'Subdirector de Ingeniería'],
            ['N32', 'Gerente de Proyectos y Concursos'],
            ['N5', 'Profesional Ejecutivo en Contaduría Pública'],
            ['N6', 'Coordinador de Área Técnica'],
            ['N4', 'Profesional de Servicios Especializados Aeroportuarios'],
            ['N32', 'Gerente de Ingeniería Civil'],
            ['N6', 'Coordinador de Mantenimiento de Ingeniería Civil'],
            ['N5', 'Supervisor de Mantenimiento de Ingeniería Civil'],
            ['N32', 'Gerente de Ingeniería Electromecánica'],
            ['N6', 'Coordinador de Ingeniería Electromecánica'],
            ['N5', 'Supervisor de Ingeniería Electromecánica'],
        ]],
        [SSC, [
            ['M33', 'Subdirector de Servicios Conexos'],
            ['N32', 'Gerente de Carga'],
            ['N32', 'Gerente de Combustibles'],
            ['N32', 'Gerente de Aviación General'],
        ]],
        [SGE, [
            ['M33', 'Subdirector de Gestión Energética'],
            ['N32', 'Gerente de Transformación y Distribución'],
            ['N7', 'Coordinador de Soporte Técnico'],
            ['N32', 'Gerente de Generación'],
        ]],
        ['Otros puestos', [
            ['N7', 'Coordinador de Terminal'],
            ['N2', 'Asistente de Servicios Generales'],
            ['N32', 'Gerente de Operación y Mantenimiento de Instalaciones Hidráulicas'],
            ['N4', 'Especialista en Atención a Usuarios'],
            ['N3', 'Especialista Encuestador'],
            ['N3', 'Auxiliar en Procedimientos de Adquisiciones'],
            ['N5', 'Gestor de Contratos'],
        ]],
    ].flatMap(([grupo, puestos]) => puestos.map(([nivel, puesto]) => Object.freeze({ grupo, nivel, puesto }))));

    function normalize(value) {
        return String(value == null ? '' : value)
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /* Lo que la planilla usa para decir "no tiene": 0, guiones, N/A. */
    function esVacio(value) {
        const n = normalize(value);
        return !n || /^(?:0|-+|n\/?a|na|s\/?d|no|no aplica|ninguna?)$/.test(n);
    }

    /* Abreviaturas que ya vienen capturadas en agenda_2026. */
    const ALIAS = Object.freeze({
        'dir opn': DO,
        'direccion operacion': DO,
        'sso': SSO,
        'si': SI,
        'ssc': SSC,
        'sge': SGE,
        'ssa': SSA,
        'gerencia de operaciones de instalaciones hidraulicas': G_HIDRAULICAS,
        'gerencia de operacion y mantenimiento de intalaciones hidraulicas': G_HIDRAULICAS,
        'gerente de transformacion y distribucion': 'Gerencia de Transformación y Distribución',
        'coordinacion de slots': 'Coordinación de Slots y Demoras',
        'coord de area de apoyo tec': 'Coordinación de Área de Apoyo Técnico',
        'operador de vehiculo especializado': 'Operador de Vehículo Especializado',
    });

    /* Árbol → lista plana de nodos con su ruta completa. */
    function aplanar(arbol) {
        const nodos = [];
        const agregar = (nivel, nombre, ruta) => nodos.push(Object.freeze({
            nivel, nombre, ruta: Object.freeze(Object.assign({ direccion: '', subdireccion: '', gerencia: '', coordinacion: '' }, ruta, { [nivel]: nombre })),
        }));
        const gerencias = (lista, ruta) => (lista || []).forEach(g => {
            agregar('gerencia', g.nombre, ruta);
            (g.coordinaciones || []).forEach(c => agregar('coordinacion', c, Object.assign({}, ruta, { gerencia: g.nombre })));
        });
        arbol.forEach(d => {
            const rd = { direccion: d.nombre };
            agregar('direccion', d.nombre, {});
            (d.coordinaciones || []).forEach(c => agregar('coordinacion', c, rd));
            gerencias(d.gerencias, rd);
            (d.subdirecciones || []).forEach(s => {
                agregar('subdireccion', s.nombre, rd);
                gerencias(s.gerencias, Object.assign({}, rd, { subdireccion: s.nombre }));
            });
        });
        return Object.freeze(nodos);
    }

    const CATALOGOS = Object.freeze({
        organica: aplanar(ORGANICA),
        real: aplanar(REAL),
    });

    function nodosDe(catalogo) {
        const nodos = CATALOGOS[catalogo];
        if (!nodos) throw new Error('Catálogo de áreas desconocido: ' + catalogo);
        return nodos;
    }

    /** Nombre del catálogo que corresponde a lo capturado, o null si no está. */
    function buscar(catalogo, nivel, valor) {
        if (esVacio(valor)) return null;
        const n = normalize(valor);
        const alias = ALIAS[n];
        const nodo = nodosDe(catalogo).find(x => x.nivel === nivel && (normalize(x.nombre) === n || x.nombre === alias));
        return nodo ? nodo.nombre : null;
    }

    /** Un nivel que la persona no tiene. Además de "----", la planilla lo
        escribe repitiendo el de arriba (Subdirección = "Dir. Opn.") o con
        "Directo SSC": las dos cosas quieren decir "depende directo". */
    function sinNivel(catalogo, nivel, valor) {
        if (esVacio(valor) || /^directo(?:\s|$)/.test(normalize(valor))) return true;
        return NIVELES.slice(0, NIVELES.indexOf(nivel)).some(a => buscar(catalogo, a, valor));
    }

    /* Restricciones que imponen los niveles de arriba. Devuelve null cuando
       alguno está fuera del catálogo: de ahí para abajo no hay opciones que
       sugerir, sólo texto libre. */
    function restriccionesSobre(catalogo, nivel, valores) {
        const fijas = {};
        for (const arriba of NIVELES.slice(0, NIVELES.indexOf(nivel))) {
            const raw = valores[arriba];
            if (sinNivel(catalogo, arriba, raw)) continue;
            const canon = buscar(catalogo, arriba, raw);
            if (!canon) return null;
            fijas[arriba] = canon;
        }
        return fijas;
    }

    /** Nodos de un nivel compatibles con lo ya elegido arriba. Un nivel de
        arriba vacío no restringe: se puede elegir la coordinación primero y
        que ella llene su gerencia y su subdirección. */
    function opciones(catalogo, nivel, valores) {
        const fijas = restriccionesSobre(catalogo, nivel, valores || {});
        if (!fijas) return null;
        return nodosDe(catalogo).filter(x => x.nivel === nivel
            && Object.keys(fijas).every(k => x.ruta[k] === fijas[k]));
    }

    /** Nombre del área inmediata superior, para agrupar las opciones. */
    function grupoDe(nodo) {
        const arriba = NIVELES.slice(0, NIVELES.indexOf(nodo.nivel)).reverse();
        for (const k of arriba) if (nodo.ruta[k]) return nodo.ruta[k];
        return '';
    }

    /** Valores después de elegir un nodo: llena su ruta hacia arriba y limpia
        lo de abajo que ya no le pertenezca. Lo que la planilla tenía como
        "sin dato" ("----", "0") se respeta tal cual para no inventar cambios. */
    function seleccionar(catalogo, nodo, valores) {
        const actual = valores || {};
        const nuevos = {};
        const idx = NIVELES.indexOf(nodo.nivel);
        NIVELES.forEach((k, i) => {
            if (i < idx) {
                const destino = nodo.ruta[k];
                nuevos[k] = !destino && sinNivel(catalogo, k, actual[k]) ? (actual[k] || '') : destino;
            } else if (i === idx) {
                nuevos[k] = nodo.nombre;
            } else {
                const raw = actual[k];
                if (sinNivel(catalogo, k, raw)) { nuevos[k] = raw || ''; return; }
                const canon = buscar(catalogo, k, raw);
                const sigue = canon && nodosDe(catalogo).some(x => x.nivel === k && x.nombre === canon
                    && NIVELES.slice(0, i).every((a, j) => {
                        if (j <= idx) return x.ruta[a] === nodo.ruta[a];
                        const c = buscar(catalogo, a, nuevos[a]);
                        return !c || x.ruta[a] === c;
                    }));
                nuevos[k] = sigue ? raw : '';
            }
        });
        return nuevos;
    }

    /** ¿Hace falta capturar este nivel? No, cuando lo elegido no tiene nada
        en ese nivel (Gerencia de Carga no tiene coordinaciones; Auditoría no
        tiene subdirección) o cuando un nivel de arriba quedó fuera del
        catálogo y ya no hay cómo saber la estructura. */
    function nivelRequerido(catalogo, nivel, valores) {
        const v = valores || {};
        if (!esVacio(v[nivel])) return true;   // capturado, aunque sea "depende directo"

        const posibles = opciones(catalogo, nivel, v);
        if (!posibles || !posibles.length) return false;
        const i = NIVELES.indexOf(nivel);
        for (const abajo of NIVELES.slice(i + 1)) {
            const canon = buscar(catalogo, abajo, v[abajo]);
            if (!canon) continue;
            const nodo = (opciones(catalogo, abajo, v) || []).find(x => x.nombre === canon);
            if (nodo) return Boolean(nodo.ruta[nivel]);
        }
        return true;
    }

    function buscarPuesto(valor) {
        if (esVacio(valor)) return null;
        const n = normalize(valor);
        const alias = ALIAS[n];
        return PUESTOS.find(p => normalize(p.puesto) === n || p.puesto === alias) || null;
    }

    /** "1"/"Sí" → '1', "0"/"No" → '0', lo demás → ''. */
    function normalizarComisionado(valor) {
        const n = normalize(valor);
        if (/^(?:1|si|true|comisionad[oa])$/.test(n)) return '1';
        if (/^(?:0|no|false)$/.test(n)) return '0';
        return '';
    }

    /* =================== Combos en pantalla =================== */

    const OTRA = '__otra__';
    const gruposOrg = [];
    const combosPuesto = [];
    const combosComision = [];

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function crearSelect(input, etiqueta) {
        const doc = input.ownerDocument;
        let sel = doc.getElementById(input.id + '-sel');
        if (!sel) {
            sel = doc.createElement('select');
            sel.id = input.id + '-sel';
            sel.className = input.classList.contains('form-control-sm') ? 'form-select form-select-sm' : 'form-select';
            if (etiqueta) sel.setAttribute('aria-label', etiqueta);
            input.parentNode.insertBefore(sel, input);
            input.classList.add('mt-1');
            input.setAttribute('placeholder', 'Escribe el área…');
            // Si una etiqueta apuntaba al input, ahora el que se ve es el combo.
            const label = input.id && doc.querySelector('label[for="' + input.id + '"]');
            if (label) label.setAttribute('for', sel.id);
            if (root && root.ComboBonito) root.ComboBonito.mejorar(sel);
        }
        return sel;
    }

    /** Convierte cuatro inputs (dirección → coordinación) en combos en cascada.
        El input sigue siendo la fuente de verdad (lo leen el guardado, el QR y
        el historial); el combo sólo lo escribe. "Otra área…" lo deja visible
        para capturar un área fuera del catálogo (p. ej. comisionados a otra
        Dirección).

        opts.niveles limita los combos a algunos niveles: los demás sólo se leen
        para filtrar (lo usa el modal de faltantes, que pide únicamente lo que
        falta y toma el resto del alta). */
    function conectarOrg(opts) {
        const doc = opts.document || root.document;
        const activos = opts.niveles || NIVELES;
        const inputs = {};
        for (const k of NIVELES) {
            const el = doc.getElementById(opts.ids[k]);
            if (!el) return null;
            inputs[k] = el;
        }
        podar();
        const existente = gruposOrg.find(g => g.inputs[activos[0]] === inputs[activos[0]]);
        if (existente) { existente.render(true); return existente; }

        const selects = {};
        const grupo = { inputs, selects, activos, catalogo: opts.catalogo, onChange: opts.onChange };

        const leer = () => NIVELES.reduce((o, k) => { o[k] = inputs[k].value; return o; }, {});

        function renderNivel(k, valores) {
            const input = inputs[k];
            const sel = selects[k];
            const raw = input.value;
            const nodos = opciones(grupo.catalogo, k, valores);
            const canon = buscar(grupo.catalogo, k, raw);
            const elegido = canon && nodos ? nodos.find(x => x.nombre === canon) : null;
            const directo = !esVacio(raw) && sinNivel(grupo.catalogo, k, raw);
            const otra = input.dataset.otra === '1' || (!esVacio(raw) && !directo && !elegido);
            const lista = nodosDe(grupo.catalogo);

            let html = '<option value="">' + (directo ? '— Depende directo —' : '— Sin asignar —') + '</option>';
            const porGrupo = new Map();
            (nodos || []).forEach(x => {
                const g = grupoDe(x);
                if (!porGrupo.has(g)) porGrupo.set(g, []);
                porGrupo.get(g).push(x);
            });
            porGrupo.forEach((xs, g) => {
                const ops = xs.map(x => '<option value="n:' + lista.indexOf(x) + '">' + esc(x.nombre) + '</option>').join('');
                html += g ? '<optgroup label="' + esc(g) + '">' + ops + '</optgroup>' : ops;
            });
            html += '<option value="' + OTRA + '">Otra área (escribir)…</option>';
            sel.innerHTML = html;
            sel.value = otra ? OTRA : (elegido ? 'n:' + lista.indexOf(elegido) : '');
            input.classList.toggle('d-none', !otra);
            sel.title = !otra && !elegido && raw ? 'Capturado como "' + raw + '"' : '';
        }

        grupo.render = function (reiniciar) {
            if (reiniciar) activos.forEach(k => { delete inputs[k].dataset.otra; });
            const valores = leer();
            activos.forEach(k => renderNivel(k, valores));
        };

        activos.forEach(k => {
            const i = NIVELES.indexOf(k);
            const sel = crearSelect(inputs[k], opts.etiquetas && opts.etiquetas[k]);
            selects[k] = sel;
            sel.addEventListener('change', () => {
                const v = sel.value;
                const input = inputs[k];
                if (v === OTRA) {
                    if (buscar(grupo.catalogo, k, input.value)) input.value = '';
                    input.dataset.otra = '1';
                    grupo.render();
                    input.focus();
                } else if (!v) {
                    delete input.dataset.otra;
                    input.value = '';
                    grupo.render();
                } else {
                    const nodo = nodosDe(grupo.catalogo)[Number(v.slice(2))];
                    const nuevos = seleccionar(grupo.catalogo, nodo, leer());
                    activos.forEach(n => {
                        if (inputs[n].value !== nuevos[n]) {
                            inputs[n].value = nuevos[n];
                            delete inputs[n].dataset.otra;
                        }
                    });
                    delete input.dataset.otra;
                    grupo.render();
                }
                if (typeof grupo.onChange === 'function') grupo.onChange(leer());
            });
            // Mientras se escribe un área libre, sólo se recalculan los de abajo.
            inputs[k].addEventListener('input', () => {
                const valores = leer();
                NIVELES.slice(i + 1).filter(n => activos.includes(n)).forEach(n => renderNivel(n, valores));
                if (typeof grupo.onChange === 'function') grupo.onChange(valores);
            });
        });

        gruposOrg.push(grupo);
        grupo.render(true);
        return grupo;
    }

    function estilosNivel(doc) {
        if (!doc || doc.getElementById('cc-nivel-estilos')) return;
        const st = doc.createElement('style');
        st.id = 'cc-nivel-estilos';
        st.textContent = '.cc-nivel-fijo{background:#f1f5f9!important;color:#334155;font-weight:700;cursor:not-allowed}'
            + '.cc-nivel-fijo:focus{box-shadow:none!important}'
            + '.cc-nivel-nota{margin-top:.25rem;font-size:.72rem;color:#64748b}';
        (doc.head || doc.body).appendChild(st);
    }

    /** Combo de puestos agrupado por área. Un puesto del catálogo fija el
        Nivel (ver fijarNivel). */
    function conectarPuesto(opts) {
        const doc = opts.document || root.document;
        const input = doc.getElementById(opts.id);
        if (!input) return null;
        podar();
        const existente = combosPuesto.find(c => c.input === input);
        if (existente) { existente.render(); return existente; }

        const sel = crearSelect(input, 'Puesto');
        const combo = { input, sel, nivelId: opts.nivelId };

        combo.render = function () {
            const raw = input.value.trim();
            const actual = buscarPuesto(raw);
            let html = '<option value="">— Seleccionar puesto —</option>';
            if (raw && !actual) {
                html += '<option value="__actual__">' + esc(raw) + ' (fuera de catálogo)</option>';
            }
            let grupo = null;
            PUESTOS.forEach((p, i) => {
                if (p.grupo !== grupo) {
                    if (grupo !== null) html += '</optgroup>';
                    grupo = p.grupo;
                    html += '<optgroup label="' + esc(grupo) + '">';
                }
                html += '<option value="p:' + i + '">' + esc(p.puesto) + ' · ' + esc(p.nivel) + '</option>';
            });
            html += '</optgroup>';
            sel.innerHTML = html;
            sel.value = actual ? 'p:' + PUESTOS.indexOf(actual) : (raw ? '__actual__' : '');
            input.classList.add('d-none');
            combo.fijarNivel(actual);
        };

        /* Un puesto del catálogo trae su nivel: el Nivel se llena con ése y se
           bloquea, para que no quede un Subdirector General Operativo en N5.
           Sin puesto, o con uno fuera del catálogo, el Nivel queda libre. Si el
           expediente decía otro nivel, se ajusta y se avisa cuál era. */
        combo.fijarNivel = function (actual) {
            const nivel = combo.nivelId && doc.getElementById(combo.nivelId);
            if (!nivel) return;
            estilosNivel(doc);
            let nota = nivel.parentNode && nivel.parentNode.querySelector('.cc-nivel-nota');
            if (!actual) {
                nivel.readOnly = false;
                nivel.classList.remove('cc-nivel-fijo');
                nivel.removeAttribute('title');
                delete nivel.dataset.nivelPrevio;
                if (nota) nota.remove();
                return;
            }
            const previo = nivel.value.trim();
            if (normalize(previo) !== normalize(actual.nivel)) {
                if (previo) nivel.dataset.nivelPrevio = previo;
                nivel.value = actual.nivel;
            }
            nivel.readOnly = true;
            nivel.classList.add('cc-nivel-fijo');
            nivel.title = 'Lo fija el puesto. Para cambiarlo, cambia el puesto.';
            if (!nota) {
                nota = doc.createElement('div');
                nota.className = 'cc-nivel-nota';
                nivel.insertAdjacentElement('afterend', nota);
            }
            const antes = nivel.dataset.nivelPrevio;
            nota.textContent = antes && normalize(antes) !== normalize(actual.nivel)
                ? '🔒 Lo fija el puesto (antes decía ' + antes + ').'
                : '🔒 Lo fija el puesto.';
        };

        sel.addEventListener('change', () => {
            if (sel.value === '__actual__') return;
            const nuevo = sel.value ? PUESTOS[Number(sel.value.slice(2))] : null;
            input.value = nuevo ? nuevo.puesto : '';
            // Al elegir otro puesto a propósito, el aviso del nivel anterior ya no aplica.
            const nivel = combo.nivelId && doc.getElementById(combo.nivelId);
            if (nivel) delete nivel.dataset.nivelPrevio;
            combo.render();
        });

        combosPuesto.push(combo);
        combo.render();
        return combo;
    }

    /** "Personal Comisionado" como Sí / No. Guarda 1 / 0, como la planilla. */
    function conectarComisionado(opts) {
        const doc = opts.document || root.document;
        const input = doc.getElementById(opts.id);
        if (!input) return null;
        podar();
        const existente = combosComision.find(c => c.input === input);
        if (existente) { existente.render(); return existente; }

        const sel = crearSelect(input, 'Personal Comisionado');
        const combo = { input, sel, onChange: opts.onChange };

        combo.render = function () {
            const raw = input.value.trim();
            const v = normalizarComisionado(raw);
            let html = '<option value="">— Seleccionar —</option><option value="0">No</option><option value="1">Sí, está comisionado</option>';
            if (raw && !v) html += '<option value="__actual__">' + esc(raw) + '</option>';
            sel.innerHTML = html;
            sel.value = v || (raw ? '__actual__' : '');
            input.classList.add('d-none');
            if (typeof combo.onChange === 'function') combo.onChange(v);
        };

        sel.addEventListener('change', () => {
            if (sel.value === '__actual__') return;
            // Si ya decía lo mismo con otras letras ("Sí"), se respeta.
            if (normalizarComisionado(input.value) !== sel.value) input.value = sel.value;
            combo.render();
        });

        combosComision.push(combo);
        combo.render();
        return combo;
    }

    /* ---------- Estudios: nivel (Grado académico) → especialidad (Profesión) ----------
       Catálogo del área de personal. Se guarda en las mismas columnas de
       siempre: el nivel en grado_academico y la especialidad en profesion.
       Correcciones de captura respecto a la tabla original: "Ing. Mecánico
       Electricista" (sin acento), "Ing. Química Industrial" (abreviado como
       las demás), "Lic. en Medicina General" y "Lic. en Psicopedagogía" (con
       "en"), y "Lic. en Relaciones Internacionales" una sola vez. */

    const SIN_ESPECIALIDAD = '-';

    const ESTUDIOS = Object.freeze([
        { nivel: 'Secundaria', especialidades: [SIN_ESPECIALIDAD] },
        { nivel: 'Preparatoria/Bachillerato', especialidades: ['General', 'Tecnológico'] },
        { nivel: 'Curso de Formación de Oficiales', especialidades: [
            'Meteorólogo', 'Controlador de Vuelo', 'Electrónica de Aviación', 'Abastecedor de Material Aéreo',
            'Mantenimiento de Aviación', 'Armamento Aéreo', 'Aerologista', 'Infantería', 'Caballería',
            'Arma Blindada', 'Artillería', 'Zapadores', 'Policía Militar', 'Enfermería Militar', 'Piloto Aviador',
        ] },
        { nivel: 'TSU', especialidades: [
            'Enfermería Militar', 'Urgencias Médicas', 'Mecatrónica', 'Oficial de Operaciones Aeronáuticas',
            'Administración Aeronáutica', 'Administración del Capital Humano', 'Mantenimiento Industrial',
            'Sistemas de la Comunicación',
        ] },
        { nivel: 'Superior', especialidades: [
            'Lic. en Administración Militar', 'Lic. en Seguridad Pública', 'Médico Cirujano Militar',
            'Cirujano Dentista Militar', 'Lic. en Enfermería Militar', 'Lic. en Aeronáutica Militar', 'Ing. Militar',
            'Lic. en Matemáticas', 'Ing. Industrial', 'Ing. Industrial y de Sistemas', 'Ing. en Mecánica',
            'Ing. en Mecánica Automotriz', 'Ing. Mecánico Electricista', 'Ing. en Sistemas Automotrices',
            'Ing. en Metal Mecánica', 'Ing. en Mecánica Electricista', 'Ing. Electricista', 'Ing. Eléctrica',
            'Ing. Eléctrica Electrónica', 'Ing. en Electrónica', 'Ing. en Comunicaciones y Electrónica',
            'Ing. en Energía Electromecánica', 'Ing. en Nanotecnología', 'Ing. en Mecatrónica',
            'Ing. en Mecatrónica Especialidad en Automatización', 'Ing. en Robótica y Sistemas de Manufactura Industrial',
            'Ing. en Control y Automatización', 'Ing. en Sistemas', 'Ing. en Sistemas Computacionales',
            'Ing. en Computación', 'Lic. en Informática', 'Ing. en Biotecnología', 'Lic. en Biología', 'Ing. Química',
            'Ing. Química Industrial', 'Ing. Bioquímica', 'Ing. en Recursos Naturales Renovables', 'Ing. Agrónomo',
            'Ing. Ambiental', 'Ing. Ambiental y en Sustentabilidad', 'Ing. en Energías Renovables', 'Ing. en Minas',
            'Ing. Minera Metalúrgica', 'Ing. Aeronáutica',
            'Lic. en Dirección y Administración de Aeropuertos y Negocios Aéreos', 'Ing. Civil', 'Ing. en Arquitectura',
            'Lic. en Arquitectura', 'Ing. Constructor', 'Ing. en Logística', 'Lic. en Logística',
            'Ing. en Logística y Transportes', 'Ing. en Transporte', 'Lic. en Relaciones Internacionales',
            'Lic. en Comercio Internacional', 'Lic. en Comercio Internacional y Aduanas', 'Lic. en Comercio Exterior',
            'Lic. en Comercio y Negocios Internacionales', 'Lic. en Negocios Internacionales', 'Lic. en Turismo',
            'Lic. en Administración de Empresas Turísticas', 'Lic. en Gestión Turística', 'Lic. en Diseño Industrial',
            'Lic. en Diseño Gráfico', 'Lic. en Mercadotecnia', 'Lic. en Ciencias de la Comunicación',
            'Lic. en Comunicación y Administración de Empresas de Entretenimiento',
            'Lic. en Cosmetología e Imagen Integral', 'Lic. en Gestión y Desarrollo Empresarial',
            'Ing. en Gestión de Proyectos', 'Lic. en Gestión de Negocios y Proyectos',
            'Ing. en Negocios y Gestión Empresarial', 'Lic. en Administración de Empresas',
            'Lic. en Administración Pública', 'Lic. en Ciencias Políticas y Administración Pública',
            'Lic. en Administración en Recursos Humanos',
            'Lic. en Administración y Gestión de Pequeñas y Medianas Empresas',
            'Lic. en Administración de Empresas y Liderazgo Empresarial', 'Lic. en Administración Financiera',
            'Lic. en Contaduría', 'Lic. en Contaduría Pública', 'Lic. en Economía', 'Ing. en Finanzas',
            'Lic. en Protección Civil', 'Lic. en Protección Civil y Gestión de Riesgos',
            'Ing. en Protección Civil y Prevención de Riesgo Industrial y de Emergencias', 'Lic. Médico Cirujano',
            'Lic. en Medicina General', 'Lic. en Atención Médica Prehospitalaria', 'Lic. en Enfermería',
            'Lic. Médico Veterinario Zootecnista', 'Lic. en Cultura Deportiva para el Alto Desempeño',
            'Lic. en Educación Física', 'Lic. en Nutrición', 'Lic. en Gastronomía', 'Lic. en Psicopedagogía',
            'Lic. en Pedagogía', 'Lic. en Administración del Capital Humano', 'Lic. en Gestión de Capital Humano',
            'Lic. en Archivología', 'Lic. en Biblioteconomía', 'Lic. en Derecho', 'Lic. en Criminología',
            'Lic. en Criminología y Criminalística',
        ] },
        { nivel: 'Posgrado', especialidades: [
            'Mtría. en Educación y Docencia', 'Mtría. en Ciencias de la Ingeniería', 'Mtría. en Ingeniería',
            'Mtría. en Gestión de Proyectos', 'Mtría. en Sistemas Computacionales y Seguridad Informática',
            'Mtría. en Administración en Tecnologías de Información',
            'Mtría. en Gestión de Tecnologías de la Información', 'Mtría. en Ciencias en Administración de Negocios',
            'Mtría. en Comercio Exterior', 'Mtría. en Gestión Pública para la Buena Administración',
            'Mtría. en Ciencias en Ingeniería Metalúrgica', 'Mtría. en Diseño y Gestión de Proyectos Tecnológicos',
            'Mtría. en Dirección Estratégica', 'Doc. en Ciencias de la Ingeniería',
        ] },
    ].map(g => Object.freeze({ nivel: g.nivel, especialidades: Object.freeze(g.especialidades.slice()) })));

    const NIVELES_ESTUDIO = Object.freeze(ESTUDIOS.map(g => g.nivel));

    /** Grado académico capturado a mano → nivel del catálogo ("Licenciatura",
        "Ingeniería" → Superior; "Maestría" → Posgrado). '' si no se reconoce. */
    function nivelDeEstudios(texto) {
        const t = normalize(texto);
        if (!t) return '';
        const exacto = NIVELES_ESTUDIO.find(n => normalize(n) === t);
        if (exacto) return exacto;
        if (/^secundaria/.test(t)) return 'Secundaria';
        if (/prepa|bachiller/.test(t)) return 'Preparatoria/Bachillerato';
        if (/formacion de oficiales|^oficial/.test(t)) return 'Curso de Formación de Oficiales';
        if (/^t ?s ?u\b|tecnico superior/.test(t)) return 'TSU';   // normalize ya cambió los puntos por espacios
        if (/maestr|doctor|posgrado|postgrado/.test(t)) return 'Posgrado';
        if (/licenciatura|ingenier|superior|profesional/.test(t)) return 'Superior';
        return '';
    }

    /* "Ingeniería en X" y "Ing. en X" son lo mismo para comparar; también
       "Licenciatura en" / "Lic. en", "Maestría en" / "Mtría. en". */
    function claveEspecialidad(texto) {
        return normalize(texto)
            .replace(/^ingenieria\b\.?/, 'ing.')
            .replace(/^ing\b\.?/, 'ing.')
            .replace(/^licenciatura\b\.?/, 'lic.')
            .replace(/^lic\b\.?/, 'lic.')
            .replace(/^maestria\b\.?/, 'mtria.')
            .replace(/^mtria\b\.?/, 'mtria.')
            .replace(/^doctorado\b\.?/, 'doc.')
            .replace(/^doc\b\.?/, 'doc.')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Dónde está una profesión en el catálogo: [{ nivel, especialidad }]. Una
        misma especialidad puede estar en dos niveles (Enfermería Militar). */
    function buscarEspecialidad(texto, nivel) {
        const k = claveEspecialidad(texto);
        if (!k) return [];
        const hits = [];
        ESTUDIOS.forEach(g => {
            if (nivel && g.nivel !== nivel) return;
            g.especialidades.forEach(e => { if (claveEspecialidad(e) === k) hits.push({ nivel: g.nivel, especialidad: e }); });
        });
        return hits;
    }

    const combosEstudios = [];

    /** Grado académico y Profesión en cascada. Los inputs siguen siendo los que
        se guardan; los combos sólo los escriben, y lo capturado antes que no
        está en el catálogo se conserva tal cual. Elegir la profesión sin nivel
        llena el nivel; cambiar a un nivel donde la profesión no existe la
        limpia. "Otra profesión…" deja escribirla. */
    function conectarEstudios(opts) {
        const doc = opts.document || root.document;
        const gInput = doc.getElementById(opts.gradoId);
        const pInput = doc.getElementById(opts.profesionId);
        if (!gInput || !pInput) return null;
        podar();
        const existente = combosEstudios.find(c => c.gInput === gInput);
        if (existente) { existente.render(); return existente; }

        const gSel = crearSelect(gInput, 'Grado académico');
        const pSel = crearSelect(pInput, 'Profesión');
        pInput.setAttribute('placeholder', 'Escribe la profesión…');
        const combo = { gInput, pInput, gSel, pSel };

        // Nivel efectivo: el capturado; si no se reconoce, el de la profesión
        // cuando sólo hay uno posible.
        combo.nivel = function () {
            const n = nivelDeEstudios(gInput.value);
            if (n) return n;
            const hits = buscarEspecialidad(pInput.value);
            return hits.length === 1 ? hits[0].nivel : '';
        };

        combo.render = function () {
            const gRaw = gInput.value.trim();
            const gNorm = nivelDeEstudios(gRaw);
            let gh = '<option value="">— Seleccionar —</option>';
            NIVELES_ESTUDIO.forEach(n => { gh += '<option value="' + esc(n) + '">' + esc(n) + '</option>'; });
            if (gRaw && !gNorm) gh += '<option value="__actual__">' + esc(gRaw) + ' (fuera de catálogo)</option>';
            gSel.innerHTML = gh;
            gSel.value = gNorm || (gRaw ? '__actual__' : '');
            gInput.classList.add('d-none');

            const nivel = combo.nivel();
            const pRaw = pInput.value.trim();
            const otra = pInput.dataset.otra === '1';
            const hit = !otra && pRaw ? buscarEspecialidad(pRaw, nivel || undefined)[0] : null;
            const grupos = nivel ? ESTUDIOS.filter(g => g.nivel === nivel) : ESTUDIOS;
            let ph = '<option value="">' + (nivel ? '— Seleccionar —' : '— Seleccionar (elige primero el grado o búscala) —') + '</option>';
            if (pRaw && !hit && !otra) ph += '<option value="__actual__">' + esc(pRaw) + ' (fuera de catálogo)</option>';
            grupos.forEach(g => {
                const ops = g.especialidades.map(e => {
                    const texto = e === SIN_ESPECIALIDAD ? 'Sin especialidad' : e;
                    return '<option value="' + esc(g.nivel + '|' + e) + '">' + esc(texto) + '</option>';
                }).join('');
                ph += nivel ? ops : '<optgroup label="' + esc(g.nivel) + '">' + ops + '</optgroup>';
            });
            ph += '<option value="' + OTRA + '">Otra profesión (escribir)…</option>';
            pSel.innerHTML = ph;
            pSel.value = otra ? OTRA : hit ? hit.nivel + '|' + hit.especialidad : (pRaw ? '__actual__' : '');
            pInput.classList.toggle('d-none', !otra);
        };

        const avisar = () => { if (typeof opts.onChange === 'function') opts.onChange(); };

        gSel.addEventListener('change', () => {
            if (gSel.value === '__actual__') return;
            gInput.value = gSel.value;
            const nivel = gSel.value;
            const pRaw = pInput.value.trim();
            if (nivel === 'Secundaria') {
                pInput.value = SIN_ESPECIALIDAD;
                delete pInput.dataset.otra;
            } else if (pRaw && pInput.dataset.otra !== '1' && buscarEspecialidad(pRaw).length
                       && !buscarEspecialidad(pRaw, nivel || undefined).length) {
                // Era del catálogo pero de otro nivel: ya no aplica.
                pInput.value = '';
            } else if (pRaw === SIN_ESPECIALIDAD && nivel !== 'Secundaria') {
                pInput.value = '';
            }
            combo.render();
            avisar();
            // Elegido el nivel, lo siguiente es la profesión: se abre sola.
            if (nivel) combo.abrirProfesion();
        });

        combo.abrirProfesion = function () {
            const cb = root && root.ComboBonito;
            // Después del clic que cerró la lista del grado, no en medio de él.
            setTimeout(() => {
                if (pSel.isConnected === false) return;
                if (cb && typeof cb.abrir === 'function' && cb.abrir(pSel)) return;
                pSel.focus();
            }, 0);
        };

        pSel.addEventListener('change', () => {
            const v = pSel.value;
            if (v === '__actual__') return;
            if (v === OTRA) {
                if (buscarEspecialidad(pInput.value).length) pInput.value = '';
                pInput.dataset.otra = '1';
                combo.render();
                pInput.focus();
            } else {
                delete pInput.dataset.otra;
                const corte = v.indexOf('|');
                const nivel = corte >= 0 ? v.slice(0, corte) : '';
                pInput.value = corte >= 0 ? v.slice(corte + 1) : '';
                if (nivel && !nivelDeEstudios(gInput.value)) gInput.value = nivel;
                combo.render();
            }
            avisar();
        });

        combosEstudios.push(combo);
        combo.render();
        return combo;
    }

    /* Los combos de un modal que se vuelve a pintar quedan sueltos: fuera. */
    function podar() {
        const vivo = el => !el || el.isConnected !== false;
        [[gruposOrg, g => g.inputs[g.activos[0]]], [combosPuesto, c => c.input], [combosComision, c => c.input], [combosEstudios, c => c.gInput]]
            .forEach(([lista, pieza]) => {
                for (let i = lista.length - 1; i >= 0; i--) if (!vivo(pieza(lista[i]))) lista.splice(i, 1);
            });
    }

    /** Vuelve a leer los inputs después de llenarlos por código. */
    function sincronizar() {
        podar();
        gruposOrg.forEach(g => g.render(true));
        combosPuesto.forEach(c => c.render());
        combosComision.forEach(c => c.render());
        combosEstudios.forEach(c => c.render());
    }

    return Object.freeze({
        NIVELES,
        PUESTOS,
        CATALOGOS,
        normalize,
        esVacio,
        sinNivel,
        buscar,
        opciones,
        seleccionar,
        nivelRequerido,
        buscarPuesto,
        normalizarComisionado,
        conectarOrg,
        conectarPuesto,
        conectarComisionado,
        ESTUDIOS,
        NIVELES_ESTUDIO,
        nivelDeEstudios,
        buscarEspecialidad,
        conectarEstudios,
        sincronizar,
    });
});
