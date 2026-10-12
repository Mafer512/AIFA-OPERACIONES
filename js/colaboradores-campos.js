(function (root, factory) {
    'use strict';

    const api = factory(root);

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ColaboradoresCampos = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    /* Campos de Colaboradores que se capturan igual en el alta, en la edición
       y en el portal del QR (colaborador-registro.html): la rúbrica, el
       domicilio por partes y las fechas DD/MM/AAAA. */

    const sinAcentos = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

    /* Partículas que no llevan inicial: "de la Rosa" da R, no DLR. */
    const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'mc']);

    /** Rúbrica a partir del nombre: una inicial por palabra, como la columna
        "Capturó" de Conciliación Manifiestos ("Isaac Azhael López Cancino" →
        IALC). Sin acentos y hasta 5 letras. */
    function rubricaDeNombre(nombre) {
        const palabras = sinAcentos(nombre).trim().split(/[\s.]+/).filter(Boolean);
        const utiles = palabras.filter(p => !PARTICULAS.has(p.toLowerCase()));
        const usar = utiles.length ? utiles : palabras;
        return usar.slice(0, 5).map(p => p[0]).join('').toUpperCase().replace(/[^A-Z0-9Ñ]/g, '');
    }

    /* ---------- Domicilio ----------
       En agenda_2026 es una sola columna de texto ("Domicilio (calle, colonia,
       municipio, estado y código postal)"). Se guarda con un formato fijo para
       poder volver a partirlo:
           Av. Reforma No. 123 Int. 4, Col. Centro, C.P. 55600, Tecámac, Estado de México
       Municipio y estado van al final, sin prefijo, en ese orden. */

    const PARTES_DOMICILIO = ['calle', 'numero', 'colonia', 'cp', 'municipio', 'estado'];

    function limpiar(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
    const sinComas = v => limpiar(v).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

    function componerDomicilio(partes) {
        const p = partes || {};
        // Sólo la calle: es un domicilio viejo en una línea que nadie ha separado.
        // Se devuelve tal cual, con sus comas, para no alterarlo al guardar.
        if (!['numero', 'colonia', 'cp', 'municipio', 'estado'].some(k => limpiar(p[k]))) return limpiar(p.calle);
        const calle = sinComas(p.calle);
        const numero = sinComas(limpiar(p.numero).replace(/^(no\.?|n[uú]m\.?|#)\s*/i, ''));
        const colonia = sinComas(limpiar(p.colonia).replace(/^(col\.?|colonia)\s+/i, ''));
        const cp = limpiar(p.cp).replace(/^c\.?\s*p\.?\s*/i, '').replace(/\s/g, '');
        const primero = [calle, numero ? 'No. ' + numero : ''].filter(Boolean).join(' ');
        return [primero, colonia ? 'Col. ' + colonia : '', cp ? 'C.P. ' + cp : '', sinComas(p.municipio), sinComas(p.estado)]
            .filter(Boolean).join(', ');
    }

    /** Lo inverso de componerDomicilio. Un domicilio capturado a mano antes
        (sin el formato) no se adivina: queda completo en "calle" y se marca
        como libre para que quien lo vea lo separe. */
    function partirDomicilio(texto) {
        const vacio = { calle: '', numero: '', colonia: '', cp: '', municipio: '', estado: '', libre: false };
        const t = limpiar(texto);
        if (!t) return vacio;
        const trozos = t.split(/\s*,\s*/);
        const out = Object.assign({}, vacio);
        let reconocido = true;
        trozos.forEach((trozo, i) => {
            let m;
            if (i === 0) {
                m = /^(.*?)\s*\bNo\.\s*(.*)$/.exec(trozo);
                if (m) { out.calle = m[1].trim(); out.numero = m[2].trim(); } else out.calle = trozo;
            } else if ((m = /^Col\.\s*(.*)$/.exec(trozo)) && !out.colonia && !out.cp && !out.municipio) {
                out.colonia = m[1].trim();
            } else if ((m = /^C\.P\.\s*(\d{5})$/.exec(trozo)) && !out.cp && !out.municipio) {
                out.cp = m[1];
            } else if ((out.numero || out.colonia || out.cp) && !out.municipio) {
                // Lo que sigue al formato, sin prefijo: municipio y luego estado.
                out.municipio = trozo;
            } else if (out.municipio && !out.estado) {
                out.estado = trozo;
            } else {
                reconocido = false;
            }
        });
        if (!reconocido || (trozos.length === 1 && !out.numero)) {
            return Object.assign({}, vacio, { calle: t, libre: true });
        }
        return out;
    }

    /** Qué le falta a un domicilio para estar completo (etiquetas legibles).
        Municipio y estado ayudan, pero no se exigen. */
    function faltantesDomicilio(partes) {
        const p = partes || {};
        const faltan = [];
        if (!limpiar(p.calle)) faltan.push('calle');
        if (!limpiar(p.numero)) faltan.push('número');
        if (!limpiar(p.colonia)) faltan.push('colonia');
        if (!/^\d{5}$/.test(limpiar(p.cp))) faltan.push('código postal de 5 dígitos');
        return faltan;
    }

    /** Respuesta de OpenStreetMap (Nominatim, addressdetails) → partes del
        domicilio. Lo que el mapa no sabe queda vacío para capturarlo a mano. */
    function domicilioDeMapa(address) {
        const a = address || {};
        const primero = (...ks) => { for (const k of ks) { if (limpiar(a[k])) return limpiar(a[k]); } return ''; };
        const cp = (primero('postcode').match(/\d{5}/) || [''])[0];
        return {
            calle: primero('road', 'pedestrian', 'residential', 'footway', 'path', 'street'),
            numero: primero('house_number'),
            colonia: primero('neighbourhood', 'suburb', 'quarter', 'residential', 'city_district', 'hamlet', 'village')
                .replace(/^(colonia|col\.?)\s+/i, ''),
            cp,
            municipio: primero('county', 'municipality', 'city', 'town', 'village'),
            estado: primero('state'),
        };
    }

    /* ---------- Fechas DD/MM/AAAA ---------- */

    /** Pone las diagonales mientras se escribe ("15032024" → "15/03/2024")
        y no deja pasar lo que no puede ser fecha: un día de 32 o un mes de 13
        se descartan en el dígito que los rompe, y un 4 al empezar el día (o un
        2 al empezar el mes) se completa con su cero: "4" → "04". El año va de
        1900 a 2100. */
    function formatearFechaTecleada(valor) {
        const digitos = String(valor || '').replace(/\D/g, '');
        let d = '';
        for (const c of digitos) {
            if (d.length >= 8) break;
            const n = +c;
            switch (d.length) {
                case 0: d += n > 3 ? '0' + c : c; break;
                case 1: { const dia = +(d + c); if (dia >= 1 && dia <= 31) d += c; break; }
                case 2: d += n > 1 ? '0' + c : c; break;
                case 3: { const mes = +(d[2] + c); if (mes >= 1 && mes <= 12) d += c; break; }
                case 4: if (c === '1' || c === '2') d += c; break;
                case 5: if ((d[4] === '1' && c === '9') || (d[4] === '2' && (c === '0' || c === '1'))) d += c; break;
                default: d += c;
            }
        }
        if (d.length <= 2) return d;
        if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
        return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    }

    function fechaValida(texto) {
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto || '').trim());
        if (!m) return false;
        const dia = +m[1], mes = +m[2], anio = +m[3];
        const f = new Date(anio, mes - 1, dia);
        return anio >= 1900 && anio <= 2100 && f.getFullYear() === anio && f.getMonth() === mes - 1 && f.getDate() === dia;
    }

    /* El calendario usa las mismas piezas que el resto de las fechas de la app
       (.fecha-ddmm de style.css, js/fecha-ddmm.js): texto + botón pegado a la
       derecha + <input type="date"> oculto. Aquí sólo se agrega lo mínimo por si
       la hoja no está (el portal del QR no la carga). */
    const CSS_FECHA = `
.cc-fecha-wrap{position:relative;display:flex;align-items:stretch;max-width:100%}
.cc-fecha-wrap>.cc-fecha-input{flex:1 1 auto;min-width:0;border-top-right-radius:0;border-bottom-right-radius:0}
.cc-fecha-wrap>.cc-fecha-btn{flex:0 0 auto;display:grid;place-items:center;min-height:0;padding:0 .55rem;border:1px solid #dee2e6;border-left:0;
  border-radius:0 .375rem .375rem 0;background:#fff;color:#64748b;cursor:pointer}
.cc-fecha-wrap>.cc-fecha-btn:hover:not(:disabled){background:#f1f5f9;color:#0d6efd}
.cc-fecha-wrap>.cc-fecha-btn:disabled{cursor:default;opacity:.6}
.cc-fecha-wrap>.cc-fecha-btn svg{width:.95rem;height:.95rem}
.cc-fecha-wrap>.cc-fecha-nativo{position:absolute!important;left:0;bottom:0;width:1px!important;min-width:0!important;height:1px!important;
  margin:0!important;padding:0!important;border:0!important;opacity:0;pointer-events:none}
body.dark-mode .cc-fecha-wrap>.cc-fecha-btn{border-color:rgba(255,255,255,.15);background:#1e293b;color:#cbd5e1}
`;

    function estilosFecha(doc) {
        if (!doc || doc.getElementById('cc-fecha-estilos')) return;
        const st = doc.createElement('style');
        st.id = 'cc-fecha-estilos';
        st.textContent = CSS_FECHA;
        (doc.head || doc.body).appendChild(st);
    }

    const aISO = dmy => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
    const aDMY = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };

    /** Fecha DD/MM/AAAA que se puede teclear o elegir del calendario (el botón
        de la derecha abre el selector nativo del navegador). La máscara sólo
        actúa al teclear: un valor que ya venía guardado con otro formato
        ("SI", "Sin información") no se toca. */
    function conectarFecha(opts) {
        const doc = opts.document || root.document;
        const input = doc && doc.getElementById(opts.id);
        if (!input || input.dataset.ccFecha) return null;
        input.dataset.ccFecha = '1';
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('placeholder', 'DD/MM/AAAA');
        input.setAttribute('autocomplete', 'off');
        estilosFecha(doc);

        // Con la fecha completa se avisa al momento si no existe (31/02).
        const marcar = () => {
            const v = input.value.trim();
            input.classList.toggle('is-invalid', /^[\d/]{10}$/.test(v) && !fechaValida(v));
        };

        input.addEventListener('input', e => {
            const v = input.value.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) input.value = aDMY(v);   // pegada como AAAA-MM-DD
            else if (!(e.inputType && e.inputType.indexOf('delete') === 0) && /^[\d/]*$/.test(v)) {
                input.value = formatearFechaTecleada(v);
            }
            marcar();
        });
        input.addEventListener('blur', () => {
            const v = input.value.trim();
            input.classList.toggle('is-invalid', Boolean(v) && /^[\d/]+$/.test(v) && !fechaValida(v));
        });

        // Calendario: un <input type="date"> invisible junto al campo.
        const wrap = doc.createElement('span');
        wrap.className = 'fecha-ddmm fecha-ddmm-bloque cc-fecha-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.classList.add('fecha-ddmm-texto', 'cc-fecha-input');

        const nativo = doc.createElement('input');
        nativo.type = 'date';
        nativo.className = 'fecha-ddmm-nativo cc-fecha-nativo';
        // js/fecha-ddmm.js convierte todo <input type="date"> en texto + botón;
        // éste es el calendario oculto de este campo y no debe tocarlo.
        nativo.dataset.fechaDdmm = '1';
        nativo.setAttribute('data-fecha-nativa', '');
        nativo.tabIndex = -1;
        nativo.min = '1900-01-01';
        nativo.max = '2100-12-31';
        nativo.setAttribute('aria-hidden', 'true');

        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'fecha-ddmm-calendario cc-fecha-btn';
        btn.tabIndex = -1;
        btn.title = 'Abrir calendario';
        btn.setAttribute('aria-label', 'Elegir fecha en el calendario');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';
        wrap.appendChild(nativo);
        wrap.appendChild(btn);

        const reflejar = () => { btn.disabled = input.readOnly || input.disabled; };
        reflejar();
        if (root.MutationObserver) {
            new root.MutationObserver(reflejar).observe(input, { attributes: true, attributeFilter: ['readonly', 'disabled'] });
        }

        btn.addEventListener('click', () => {
            if (input.readOnly || input.disabled) return;
            nativo.value = aISO(input.value.trim());
            try {
                if (typeof nativo.showPicker === 'function') { nativo.showPicker(); return; }
            } catch (_) { /* navegador sin showPicker */ }
            nativo.focus();
            nativo.click();
        });
        nativo.addEventListener('change', () => {
            if (!nativo.value) return;
            input.value = aDMY(nativo.value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.focus();
        });
        return input;
    }

    /* ---------- Combos de lista cerrada: Militar / Civil y Estado civil ----------
       El input sigue siendo el que se guarda; el combo sólo lo escribe. Lo ya
       capturado con otras letras ("MILITAR", "Soltera") se muestra en su opción
       sin reescribirse hasta que alguien elige, y un valor que no es ninguna de
       las opciones se conserva como opción aparte: si no, al guardar se borraba. */

    const combosFijos = [];

    const escHtml = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function normalizarMilitar(v) {
        const t = sinAcentos(v).trim().toLowerCase();
        if (/^mil/.test(t)) return 'Militar';
        if (/^civ/.test(t)) return 'Civil';
        return '';
    }

    /* Los del Código Civil y los que se usan en México en la práctica.
       Concubinato y unión libre se dejan separados porque así se capturan. */
    const ESTADOS_CIVILES = Object.freeze([
        'Soltero(a)', 'Casado(a)', 'Concubinato', 'Unión libre', 'Sociedad de convivencia',
        'Separado(a)', 'Divorciado(a)', 'Viudo(a)',
    ]);

    function normalizarEstadoCivil(v) {
        const t = sinAcentos(v).trim().toLowerCase().replace(/\s+/g, ' ');
        if (!t) return '';
        if (/^solter/.test(t)) return 'Soltero(a)';
        if (/^casad/.test(t)) return 'Casado(a)';
        if (/concubin/.test(t)) return 'Concubinato';
        if (/^union libre/.test(t)) return 'Unión libre';
        if (/sociedad de convivencia|convivencia/.test(t)) return 'Sociedad de convivencia';
        if (/^separad/.test(t)) return 'Separado(a)';
        if (/^divorciad/.test(t)) return 'Divorciado(a)';
        if (/^viud/.test(t)) return 'Viudo(a)';
        return '';
    }

    const OTRO = '__otro__';

    /* opciones: lista de textos o de grupos { grupo, items }. Con opts.otro, la
       lista termina en "Otro (escribir)…", que deja el input visible para
       capturar algo fuera de la lista. */
    function conectarFijo(opts, opciones, normalizar, etiqueta) {
        const doc = opts.document || root.document;
        const input = doc && doc.getElementById(opts.id);
        if (!input) return null;
        podar();
        const existente = combosFijos.find(c => c.input === input);
        if (existente) { existente.render(); return existente; }

        let sel = doc.getElementById(input.id + '-sel');
        if (!sel) {
            sel = doc.createElement('select');
            sel.id = input.id + '-sel';
            sel.className = input.classList.contains('form-control-sm') ? 'form-select form-select-sm' : 'form-select';
            sel.setAttribute('aria-label', etiqueta);
            if (opts.otro) { input.classList.add('mt-1'); input.setAttribute('placeholder', 'Escribe el ' + etiqueta.toLowerCase() + '…'); }
            input.parentNode.insertBefore(sel, input);
            const label = input.id && doc.querySelector('label[for="' + input.id + '"]');
            if (label) label.setAttribute('for', sel.id);
        }
        const combo = { input, sel };

        const op = o => '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>';

        combo.render = function () {
            const raw = input.value.trim();
            const otro = input.dataset.otro === '1';
            const v = otro ? '' : normalizar(raw);
            let html = '<option value="">— Seleccionar —</option>'
                + opciones.map(o => typeof o === 'string' ? op(o)
                    : '<optgroup label="' + escHtml(o.grupo) + '">' + o.items.map(op).join('') + '</optgroup>').join('');
            if (raw && !v && !otro) html += '<option value="__actual__">' + escHtml(raw) + '</option>';
            if (opts.otro) html += '<option value="' + OTRO + '">Otro (escribir)…</option>';
            sel.innerHTML = html;
            sel.value = otro ? OTRO : v || (raw ? '__actual__' : '');
            input.classList.toggle('d-none', !otro);
        };

        sel.addEventListener('change', () => {
            if (sel.value === '__actual__') return;
            if (sel.value === OTRO) {
                if (normalizar(input.value)) input.value = '';
                input.dataset.otro = '1';
                combo.render();
                input.focus();
                return;
            }
            delete input.dataset.otro;
            input.value = sel.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            combo.render();
        });

        combosFijos.push(combo);
        combo.render();
        return combo;
    }

    /** Militar / Civil, para que no queden "MiliTar" o "civil " sueltos. */
    function conectarMilitar(opts) {
        return conectarFijo(opts, ['Civil', 'Militar'], normalizarMilitar, 'Militar o civil');
    }

    /* "Licencia de Manejo" es un sí/no: el registro de origen trae SI, Si, Sí,
       No y 0 (0 = no tiene, como en las demás columnas de la planilla). */
    function normalizarLicencia(v) {
        const t = sinAcentos(v).trim().toLowerCase();
        if (/^s/.test(t)) return 'Sí';
        if (/^(n|0$)/.test(t)) return 'No';
        return '';
    }

    /** ¿Tiene licencia de manejo? Sí / No. */
    function conectarLicencia(opts) {
        return conectarFijo(opts, ['Sí', 'No'], normalizarLicencia, '¿Tiene licencia de manejo?');
    }

    /* ---------- Grado militar ----------
       SEDENA: Ejército y Fuerza Aérea Mexicanos (la FAM usa General de Grupo y
       General de Ala en lugar de Brigadier y de Brigada); SEMAR: Armada. Lo que
       no esté aquí (Guardia Nacional, una especialidad) va en "Otro". */
    const GRADOS_MILITARES = Object.freeze([
        { grupo: 'Ejército y Fuerza Aérea', items: [
            'Soldado', 'Cabo', 'Sargento Segundo', 'Sargento Primero',
            'Subteniente', 'Teniente', 'Capitán Segundo', 'Capitán Primero',
            'Mayor', 'Teniente Coronel', 'Coronel',
            'General Brigadier', 'General de Grupo', 'General de Brigada', 'General de Ala', 'General de División',
        ] },
        { grupo: 'Armada de México', items: [
            'Marinero', 'Cabo (Armada)', 'Tercer Maestre', 'Segundo Maestre', 'Primer Maestre',
            'Teniente de Corbeta', 'Teniente de Fragata', 'Teniente de Navío',
            'Capitán de Corbeta', 'Capitán de Fragata', 'Capitán de Navío',
            'Contralmirante', 'Vicealmirante', 'Almirante',
        ] },
    ]);

    /** "Capitán 1/o F.A.C.V.", "Cap. 2/o", "Sgto. 1/o", "Tte. Cor." → grado del
        catálogo. Sólo para mostrarlo en el combo: lo guardado no se reescribe. */
    function normalizarGrado(v) {
        const t = ' ' + sinAcentos(v).toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
        if (t.trim() === '' || /^\s*(militar|retirado|militar retirado|0|n\/?a)\s*$/.test(t)) return '';
        const reglas = [
            [/ (gral|general) de div/, 'General de División'],
            [/ (gral|general) de ala /, 'General de Ala'],
            [/ (gral|general) de brig/, 'General de Brigada'],
            [/ (gral|general) de grupo /, 'General de Grupo'],
            [/ (gral|general) brig/, 'General Brigadier'],
            [/ (tte|teniente) (cor|coronel)/, 'Teniente Coronel'],
            [/ (tte|teniente) de corbeta/, 'Teniente de Corbeta'],
            [/ (tte|teniente) de fragata/, 'Teniente de Fragata'],
            [/ (tte|teniente) de navio/, 'Teniente de Navío'],
            [/ (cap|capitan) de corbeta/, 'Capitán de Corbeta'],
            [/ (cap|capitan) de fragata/, 'Capitán de Fragata'],
            [/ (cap|capitan) de navio/, 'Capitán de Navío'],
            [/ (cap|capitan) (1|1\/o|1o|primero) /, 'Capitán Primero'],
            [/ (cap|capitan) (2|2\/o|2o|segundo) /, 'Capitán Segundo'],
            [/ (cor|coronel) /, 'Coronel'],
            [/ (my|mayor) /, 'Mayor'],
            [/ (subtte|subteniente) /, 'Subteniente'],
            [/ (tte|teniente) /, 'Teniente'],
            [/ (sgto|sargento) (1|1\/o|1o|primero) /, 'Sargento Primero'],
            [/ (sgto|sargento) (2|2\/o|2o|segundo) /, 'Sargento Segundo'],
            [/ cabo /, 'Cabo'],
            [/ (sld|soldado) /, 'Soldado'],
            [/ contralmirante /, 'Contralmirante'],
            [/ vicealmirante /, 'Vicealmirante'],
            [/ almirante /, 'Almirante'],
            [/ (1er|primer) maestre /, 'Primer Maestre'],
            [/ (2do|segundo) maestre /, 'Segundo Maestre'],
            [/ (3er|tercer) maestre /, 'Tercer Maestre'],
            [/ marinero /, 'Marinero'],
        ];
        for (const [re, grado] of reglas) if (re.test(t)) return grado;
        return '';
    }

    function conectarGradoMilitar(opts) {
        return conectarFijo(Object.assign({ otro: true }, opts), GRADOS_MILITARES, normalizarGrado, 'Grado');
    }

    /* "Personal en activo o retirado". */
    function normalizarSituacionMilitar(v) {
        const t = sinAcentos(v).trim().toLowerCase();
        if (/retir/.test(t)) return 'Retirado';
        if (/activ/.test(t)) return 'En activo';
        if (/licencia/.test(t)) return 'Con licencia';
        return '';
    }

    function conectarSituacionMilitar(opts) {
        return conectarFijo(opts, ['En activo', 'Con licencia', 'Retirado'], normalizarSituacionMilitar, 'Situación militar');
    }

    /** Estado civil con la lista completa (ESTADOS_CIVILES). */
    function conectarEstadoCivil(opts) {
        return conectarFijo(opts, ESTADOS_CIVILES, normalizarEstadoCivil, 'Estado civil');
    }

    /* ---------- Rúbrica automática / manual ---------- */

    const rubricas = [];

    const CSS = `
.cc-rub-nota{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem;margin-top:.3rem;font-size:.74rem;line-height:1.3;color:#64748b}
.cc-rub-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.08rem .5rem;border-radius:999px;font-weight:700;font-size:.7rem;letter-spacing:.02em}
.cc-rub-chip.auto{background:#e8f5ee;color:#16733e;border:1px solid #c6e6d3}
.cc-rub-chip.manual{background:#fff4e0;color:#9a5b00;border:1px solid #f6d9a6}
.cc-rub-chip.vacia{background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0}
.cc-rub-usar{padding:0;border:0;background:none;color:#0d6efd;font-size:.74rem;font-weight:600;text-decoration:underline;cursor:pointer}
body.dark-mode .cc-rub-nota{color:#94a3b8}
`;

    function estilos(doc) {
        if (!doc || doc.getElementById('cc-campos-estilos')) return;
        const s = doc.createElement('style');
        s.id = 'cc-campos-estilos';
        s.textContent = CSS;
        (doc.head || doc.body).appendChild(s);
    }

    /** La rúbrica se llena sola con las iniciales del nombre y lo sigue
        mientras nadie la cambie. Si alguien escribe otra, queda como manual
        y ya no se pisa; la nota de abajo dice cuál de las dos es y ofrece
        volver a la automática. */
    function conectarRubrica(opts) {
        const doc = opts.document || root.document;
        const input = doc && doc.getElementById(opts.id);
        const nombre = doc && doc.getElementById(opts.nombreId);
        if (!input || !nombre) return null;
        podar();
        const existente = rubricas.find(r => r.input === input);
        if (existente) { existente.refrescar(); return existente; }
        estilos(doc);

        const nota = doc.createElement('div');
        nota.className = 'cc-rub-nota';
        nota.setAttribute('aria-live', 'polite');
        input.insertAdjacentElement('afterend', nota);
        input.setAttribute('autocomplete', 'off');

        const ctrl = { input, nombre, nota };
        const auto = () => rubricaDeNombre(nombre.value);

        ctrl.modo = function () {
            const v = input.value.trim().toUpperCase();
            if (!v) return 'vacia';
            return v === auto() ? 'auto' : 'manual';
        };

        ctrl.pintar = function () {
            const modo = ctrl.modo();
            const a = auto();
            input.dataset.rubricaModo = modo;
            if (modo === 'auto') {
                nota.innerHTML = '<span class="cc-rub-chip auto">✓ Automática</span><span>Iniciales del nombre.</span>';
            } else if (modo === 'manual') {
                nota.innerHTML = '<span class="cc-rub-chip manual">✎ Manual</span>'
                    + (a ? '<button type="button" class="cc-rub-usar">Usar automática (' + a + ')</button>' : '');
            } else {
                nota.innerHTML = '<span class="cc-rub-chip vacia">Sin rúbrica</span>'
                    + (a ? '' : '<span>Se llena sola al capturar el nombre.</span>');
            }
            const usar = nota.querySelector('.cc-rub-usar');
            if (usar) usar.addEventListener('click', () => { input.value = auto(); input.dataset.rubricaManual = ''; ctrl.pintar(); dispararCambio(input); });
        };

        /** Después de llenar los inputs por código: vacía → automática. */
        ctrl.refrescar = function () {
            input.dataset.rubricaManual = ctrl.modo() === 'manual' ? '1' : '';
            if (!input.value.trim() && auto()) input.value = auto();
            ctrl.pintar();
        };

        nombre.addEventListener('input', () => {
            if (input.dataset.rubricaManual !== '1') input.value = auto();
            ctrl.pintar();
        });
        input.addEventListener('input', () => {
            const pos = input.selectionStart;
            input.value = input.value.toUpperCase();
            try { input.setSelectionRange(pos, pos); } catch (_) { /* no todos los tipos */ }
            // Borrarla toda la regresa a automática en el siguiente cambio de nombre.
            input.dataset.rubricaManual = ctrl.modo() === 'manual' ? '1' : '';
            ctrl.pintar();
        });

        rubricas.push(ctrl);
        ctrl.refrescar();
        return ctrl;
    }

    function dispararCambio(el) {
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { /* sin Event */ }
    }

    function podar() {
        [rubricas, combosFijos].forEach(lista => {
            for (let i = lista.length - 1; i >= 0; i--) {
                if (lista[i].input.isConnected === false) lista.splice(i, 1);
            }
        });
    }

    /** Vuelve a leer las rúbricas después de llenar el formulario por código. */
    function sincronizar() {
        podar();
        rubricas.forEach(r => r.refrescar());
        combosFijos.forEach(c => c.render());
    }

    return Object.freeze({
        rubricaDeNombre,
        PARTES_DOMICILIO,
        componerDomicilio,
        partirDomicilio,
        faltantesDomicilio,
        domicilioDeMapa,
        formatearFechaTecleada,
        fechaValida,
        conectarFecha,
        normalizarMilitar,
        conectarMilitar,
        ESTADOS_CIVILES,
        normalizarEstadoCivil,
        conectarEstadoCivil,
        normalizarLicencia,
        conectarLicencia,
        GRADOS_MILITARES,
        normalizarGrado,
        conectarGradoMilitar,
        normalizarSituacionMilitar,
        conectarSituacionMilitar,
        conectarRubrica,
        sincronizar,
    });
});
