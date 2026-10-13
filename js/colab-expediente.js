(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ColabExpediente = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    /* Expediente laboral en la ficha del colaborador: incapacidades,
       reconocimientos, retardos, designaciones y oficios de comisión, cada uno
       con su documento. Tabla public.colab_expediente y bucket privado
       colab-expediente-docs (db/create_colab_expediente.sql). */

    const TABLA = 'colab_expediente';
    const BUCKET = 'colab-expediente-docs';
    const DOC_MAX = 10 * 1024 * 1024;
    const URL_SEGUNDOS = 10 * 60;

    /* Campos de cada tipo. k: columna de colab_expediente. */
    const TIPOS = Object.freeze({
        incapacidad: {
            titulo: 'Incapacidades', singular: 'incapacidad', icono: 'fa-notes-medical', color: '#b42318',
            soloEditores: true, documento: 'Certificado de incapacidad',
            campos: [
                { k: 'titulo', label: 'Tipo', tipo: 'select', req: true,
                  opciones: ['Enfermedad general', 'Riesgo de trabajo', 'Maternidad', 'Otra'] },
                { k: 'emisor', label: 'La expide', tipo: 'select',
                  opciones: ['IMSS', 'ISSSTE', 'ISSFAM', 'Médico particular', 'Otro'] },
                { k: 'folio', label: 'Folio', placeholder: 'Folio del certificado' },
                { k: 'fecha_inicio', label: 'Desde', tipo: 'date', req: true },
                { k: 'fecha_fin', label: 'Hasta', tipo: 'date', req: true },
                { k: 'detalle', label: 'Observaciones', tipo: 'textarea' },
            ],
        },
        reconocimiento: {
            titulo: 'Reconocimientos', singular: 'reconocimiento', icono: 'fa-award', color: '#b7791f',
            documento: 'Constancia o diploma',
            campos: [
                { k: 'titulo', label: 'Reconocimiento', req: true, placeholder: 'Reconocimiento al desempeño…', ancho: 12 },
                { k: 'emisor', label: 'Otorgado por', placeholder: 'Dirección de Operación' },
                { k: 'fecha_inicio', label: 'Fecha', tipo: 'date', req: true },
                { k: 'detalle', label: 'Motivo', tipo: 'textarea' },
            ],
        },
        retardo: {
            titulo: 'Retardos', singular: 'retardo', icono: 'fa-clock', color: '#c2410c',
            documento: 'Justificante',
            campos: [
                { k: 'fecha_inicio', label: 'Fecha', tipo: 'date', req: true },
                { k: 'minutos', label: 'Minutos de retardo', tipo: 'number', req: true, min: 1, max: 1440 },
                { k: 'justificado', label: '¿Justificado?', tipo: 'select', opciones: ['No', 'Sí'], req: true },
                { k: 'detalle', label: 'Motivo / observaciones', tipo: 'textarea' },
            ],
        },
        designacion: {
            titulo: 'Designaciones', singular: 'designación', icono: 'fa-user-tie', color: '#1d4ed8',
            documento: 'Oficio de designación',
            campos: [
                { k: 'titulo', label: 'Designación', req: true, ancho: 12,
                  placeholder: 'Encargado(a) de la Coordinación de …' },
                { k: 'folio', label: 'Oficio', placeholder: 'AIFA/DO/…' },
                { k: 'fecha_inicio', label: 'Desde', tipo: 'date', req: true },
                { k: 'fecha_fin', label: 'Hasta', tipo: 'date', ayuda: 'Vacío = sigue vigente' },
                { k: 'detalle', label: 'Observaciones', tipo: 'textarea' },
            ],
        },
        comision: {
            titulo: 'Oficios de comisión', singular: 'oficio de comisión', icono: 'fa-file-signature', color: '#0f766e',
            documento: 'Oficio de comisión',
            campos: [
                { k: 'titulo', label: 'Comisionado a', req: true, ancho: 12, placeholder: 'Gerencia de …' },
                { k: 'folio', label: 'Oficio', placeholder: 'AIFA-DA-SRH-…' },
                { k: 'fecha_inicio', label: 'Desde', tipo: 'date', req: true },
                { k: 'fecha_fin', label: 'Hasta', tipo: 'date', ayuda: 'Vacío = sigue vigente' },
                { k: 'detalle', label: 'Observaciones', tipo: 'textarea' },
            ],
        },
    });

    const ORDEN_FICHA = ['incapacidad', 'reconocimiento', 'retardo', 'designacion'];

    /* ---------- Utilidades puras (se prueban) ---------- */

    const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function fechaCorta(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
    }

    function hoyISO(ahora) {
        const d = ahora || new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /** Días de una incapacidad, contando el primero y el último. */
    function diasEntre(desde, hasta) {
        const a = Date.parse(desde + 'T00:00:00Z'), b = Date.parse(hasta + 'T00:00:00Z');
        if (isNaN(a) || isNaN(b) || b < a) return 0;
        return Math.round((b - a) / 86400000) + 1;
    }

    /** Designación o comisión sin fecha de fin, o que termina hoy o después. */
    function vigente(r, hoy) {
        const h = hoy || hoyISO();
        return !!r.fecha_inicio && r.fecha_inicio <= h && (!r.fecha_fin || r.fecha_fin >= h);
    }

    /** Resumen corto del apartado, del año en curso. */
    function resumen(tipo, regs, hoy) {
        const h = hoy || hoyISO();
        const anio = h.slice(0, 4);
        const delAnio = regs.filter(r => String(r.fecha_inicio || '').slice(0, 4) === anio);
        if (tipo === 'incapacidad') {
            const dias = delAnio.reduce((s, r) => s + diasEntre(r.fecha_inicio, r.fecha_fin || r.fecha_inicio), 0);
            return delAnio.length ? delAnio.length + ' en ' + anio + ' · ' + dias + ' día' + (dias === 1 ? '' : 's') : '';
        }
        if (tipo === 'retardo') {
            const sin = delAnio.filter(r => r.justificado !== true).length;
            return delAnio.length ? delAnio.length + ' en ' + anio + (sin ? ' · ' + sin + ' sin justificar' : '') : '';
        }
        if (tipo === 'designacion' || tipo === 'comision') {
            const v = regs.filter(r => vigente(r, h)).length;
            return v ? v + ' vigente' + (v === 1 ? '' : 's') : '';
        }
        return regs.length ? String(regs.length) : '';
    }

    /** Ruta del documento en el bucket: <num>/<tipo>/<id>-<marca>.<ext>. */
    function rutaDocumento(num, tipo, id, ext, marca) {
        const n = String(num || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'sin_num';
        if (!TIPOS[tipo]) throw new Error('Tipo de expediente no válido.');
        const nombre = String(id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + (marca || Date.now().toString(36));
        return n + '/' + tipo + '/' + nombre + '.' + ext;
    }

    /** PDF, JPG o PNG de hasta 10 MB, revisando la firma del archivo. */
    async function validarArchivo(file) {
        if (!file) throw new Error('No se eligió ningún archivo.');
        if (file.size > DOC_MAX) throw new Error('El archivo pesa más de 10 MB.');
        const cabeza = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(new Uint8Array(fr.result || new ArrayBuffer(0)));
            fr.onerror = () => reject(fr.error || new Error('No se pudo leer el archivo.'));
            fr.readAsArrayBuffer(file.slice(0, 8));
        });
        const b = Array.from(cabeza);
        if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: 'pdf', tipo: 'application/pdf' };
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { ext: 'jpg', tipo: 'image/jpeg' };
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { ext: 'png', tipo: 'image/png' };
        throw new Error('Sólo se aceptan PDF, JPG o PNG.');
    }

    /* ---------- Estado y estilos ---------- */

    const estado = { num: '', canEdit: false, regs: [], turno: 0, opts: {}, faltaTabla: false };

    const CSS = `
.cx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem;margin:.4rem 0 1rem}
@media (max-width:767px){.cx-grid{grid-template-columns:1fr}}
.cx-panel{border:1px solid #e3e9f2;border-radius:12px;background:#fff;overflow:hidden;display:flex;flex-direction:column}
.cx-head{display:flex;align-items:center;gap:.5rem;padding:.55rem .75rem;border-bottom:1px solid #eef2f7;background:#f8fafc}
.cx-head i.cx-ico{width:1.6rem;height:1.6rem;display:grid;place-items:center;border-radius:.45rem;color:#fff;font-size:.8rem;flex:none}
.cx-head .cx-tit{font-weight:800;font-size:.82rem;color:#1e293b;text-transform:uppercase;letter-spacing:.04em}
.cx-head .cx-res{white-space:nowrap;font-size:.72rem;font-weight:700;color:#475569;background:#eef2f7;border-radius:999px;padding:.08rem .5rem}
.cx-head .cx-add{margin-left:auto;flex:none;white-space:nowrap;border:1px solid #cfd8e3;background:#fff;border-radius:.5rem;font-size:.75rem;font-weight:700;color:#1558d6;padding:.2rem .6rem;min-height:0;line-height:1.5;cursor:pointer}
.cx-head .cx-add:hover{background:#eef4ff}
.cx-lista{list-style:none;margin:0;padding:0}
.cx-item{display:flex;gap:.6rem;align-items:flex-start;padding:.55rem .75rem;border-bottom:1px solid #f1f4f8}
.cx-item:last-child{border-bottom:0}
.cx-fecha{flex:none;min-width:5.6rem;font-size:.74rem;font-weight:700;color:#475569;font-variant-numeric:tabular-nums;line-height:1.35}
.cx-cuerpo{flex:1;min-width:0}
.cx-linea{font-size:.84rem;font-weight:600;color:#1e293b;overflow-wrap:anywhere}
.cx-meta{font-size:.74rem;color:#64748b;margin-top:.1rem;overflow-wrap:anywhere}
.cx-badge{display:inline-block;font-size:.66rem;font-weight:800;border-radius:999px;padding:.05rem .45rem;margin-left:.3rem;vertical-align:middle}
.cx-b-ok{background:#e7f6ec;color:#15803d}.cx-b-warn{background:#fff1e6;color:#c2410c}.cx-b-info{background:#e8f0fe;color:#1d4ed8}.cx-b-gris{background:#f1f5f9;color:#64748b}
.cx-acc{flex:none;display:flex;gap:.25rem}
.cx-panel .cx-acc button{border:0;background:none;color:#64748b;padding:.15rem .3rem;min-height:0;border-radius:.35rem;cursor:pointer;font-size:.8rem}
.cx-panel .cx-acc button:hover{background:#eef2f7;color:#1558d6}
.cx-panel .cx-acc .cx-doc{color:#15803d}
.cx-vacio,.cx-nota{padding:.75rem;font-size:.8rem;color:#94a3b8}
.cx-nota{color:#7c3306;background:#fff6ed}
.cx-panel .cx-mas{display:block;width:100%;border:0;border-top:1px solid #f1f4f8;background:#fbfcfe;font-size:.75rem;font-weight:700;color:#1558d6;padding:.4rem;min-height:0;cursor:pointer}
#colabExpedienteModal .modal-header{background:linear-gradient(135deg,#0d2152,#1565c0)}
#colabExpedienteModal .cx-docactual{font-size:.8rem;color:#475569;margin-top:.35rem}
`;

    function estilos(doc) {
        if (doc.getElementById('cx-estilos')) return;
        const st = doc.createElement('style');
        st.id = 'cx-estilos';
        st.textContent = CSS;
        doc.head.appendChild(st);
    }

    const sb = () => root.supabaseClient;

    function faltaLaTabla(error) {
        const t = String((error && (error.message || error.details)) || '');
        return (error && (error.code === '42P01' || error.code === 'PGRST205')) || /colab_expediente/.test(t) && /exist|find/i.test(t);
    }

    /* ---------- Pintar ---------- */

    function lineaDe(tipo, r) {
        const t = r.titulo ? esc(r.titulo) : '';
        if (tipo === 'retardo') {
            return esc(r.minutos) + ' min'
                + (r.justificado === true ? '<span class="cx-badge cx-b-ok">Justificado</span>' : '<span class="cx-badge cx-b-warn">Sin justificar</span>');
        }
        if (tipo === 'incapacidad') {
            const d = diasEntre(r.fecha_inicio, r.fecha_fin || r.fecha_inicio);
            return t + '<span class="cx-badge cx-b-gris">' + d + ' día' + (d === 1 ? '' : 's') + '</span>';
        }
        if (tipo === 'designacion' || tipo === 'comision') {
            return t + (vigente(r) ? '<span class="cx-badge cx-b-info">Vigente</span>' : '<span class="cx-badge cx-b-gris">Concluida</span>');
        }
        return t;
    }

    function fechasDe(tipo, r) {
        const a = fechaCorta(r.fecha_inicio);
        if (tipo === 'retardo' || tipo === 'reconocimiento') return a;
        if (tipo === 'incapacidad') return a + (r.fecha_fin && r.fecha_fin !== r.fecha_inicio ? '<br>a ' + fechaCorta(r.fecha_fin) : '');
        return 'Desde ' + a + (r.fecha_fin ? '<br>a ' + fechaCorta(r.fecha_fin) : '');
    }

    function itemHtml(tipo, r) {
        const etiquetaFolio = (TIPOS[tipo].campos.find(c => c.k === 'folio') || {}).label || 'Folio';
        const meta = [r.emisor, r.folio ? etiquetaFolio + ' ' + r.folio : '', r.detalle].filter(Boolean).map(esc).join(' · ');
        const acciones = (r.documento_path ? '<button type="button" class="cx-doc" data-cx-doc="' + esc(r.id) + '" title="Ver documento"><i class="fas fa-file-lines"></i></button>' : '')
            + (estado.canEdit
                ? '<button type="button" data-cx-editar="' + esc(r.id) + '" title="Editar"><i class="fas fa-pen"></i></button>'
                + '<button type="button" data-cx-borrar="' + esc(r.id) + '" title="Eliminar"><i class="fas fa-trash"></i></button>'
                : '');
        return '<li class="cx-item"><div class="cx-fecha">' + fechasDe(tipo, r) + '</div>'
            + '<div class="cx-cuerpo"><div class="cx-linea">' + lineaDe(tipo, r) + '</div>'
            + (meta ? '<div class="cx-meta">' + meta + '</div>' : '') + '</div>'
            + '<div class="cx-acc">' + acciones + '</div></li>';
    }

    function panelHtml(tipo, expandido) {
        const cfg = TIPOS[tipo];
        const regs = estado.regs.filter(r => r.tipo === tipo);
        const res = resumen(tipo, regs);
        let cuerpo;
        if (estado.faltaTabla) {
            cuerpo = '<div class="cx-nota">Falta preparar la base: corre <strong>db/create_colab_expediente.sql</strong> en Supabase.</div>';
        } else if (cfg.soloEditores && !estado.canEdit) {
            cuerpo = '<div class="cx-vacio"><i class="fas fa-lock me-1"></i>Sólo lo ve el área de personal.</div>';
        } else if (!regs.length) {
            cuerpo = '<div class="cx-vacio">Sin ' + esc(cfg.titulo.toLowerCase()) + ' registrad' + (tipo === 'retardo' || tipo === 'reconocimiento' ? 'os' : 'as') + '.</div>';
        } else {
            const visibles = expandido ? regs : regs.slice(0, 4);
            cuerpo = '<ul class="cx-lista">' + visibles.map(r => itemHtml(tipo, r)).join('') + '</ul>'
                + (regs.length > 4 ? '<button type="button" class="cx-mas" data-cx-mas="' + tipo + '">'
                    + (expandido ? 'Ver menos' : 'Ver todos (' + regs.length + ')') + '</button>' : '');
        }
        const agregar = estado.canEdit && !estado.faltaTabla
            ? '<button type="button" class="cx-add" data-cx-nuevo="' + tipo + '"><i class="fas fa-plus me-1"></i>Agregar</button>' : '';
        return '<div class="cx-panel" data-cx-panel="' + tipo + '"><div class="cx-head">'
            + '<i class="fas ' + cfg.icono + ' cx-ico" style="background:' + cfg.color + '" aria-hidden="true"></i>'
            + '<span class="cx-tit">' + esc(cfg.titulo) + '</span>'
            + (res ? '<span class="cx-res">' + esc(res) + '</span>' : '')
            + agregar + '</div>' + cuerpo + '</div>';
    }

    const expandidos = new Set();

    function pintar() {
        const doc = root.document;
        const cont = doc.getElementById(estado.opts.contenedor || 'cf-expediente');
        if (cont) cont.innerHTML = '<div class="cx-grid">' + ORDEN_FICHA.map(t => panelHtml(t, expandidos.has(t))).join('') + '</div>';
        const com = doc.getElementById(estado.opts.contenedorComision || 'cf-comision-docs');
        if (com) com.innerHTML = '<div class="cx-grid" style="grid-template-columns:1fr">' + panelHtml('comision', expandidos.has('comision')) + '</div>';
    }

    /** Carga y pinta el expediente de un colaborador. */
    async function render(opts) {
        const doc = root.document;
        estilos(doc);
        estado.opts = opts || {};
        estado.num = String(estado.opts.num || '').trim();
        estado.canEdit = !!estado.opts.canEdit;
        estado.regs = [];
        estado.faltaTabla = false;
        expandidos.clear();
        conectarClicks(doc);
        const mio = ++estado.turno;
        pintar();
        if (!estado.num || !sb()) return;
        const { data, error } = await sb().from(TABLA).select('*')
            .eq('num_empleado', estado.num)
            .order('fecha_inicio', { ascending: false, nullsFirst: false })
            .order('creado_en', { ascending: false });
        if (mio !== estado.turno) return;
        if (error) {
            estado.faltaTabla = faltaLaTabla(error);
            if (!estado.faltaTabla) console.error('[Expediente] No se pudo leer', error);
        } else {
            estado.regs = data || [];
        }
        pintar();
    }

    let clicksConectados = false;
    function conectarClicks(doc) {
        if (clicksConectados) return;
        clicksConectados = true;
        doc.addEventListener('click', ev => {
            const b = ev.target.closest('[data-cx-nuevo],[data-cx-editar],[data-cx-borrar],[data-cx-doc],[data-cx-mas]');
            if (!b) return;
            ev.preventDefault();
            if (b.dataset.cxNuevo) {
                const t = b.dataset.cxNuevo;
                // La comisión arranca con el área a la que está comisionado.
                abrirFormulario(t, null, t === 'comision' ? { titulo: estado.opts.comisionDestino || '' } : null);
            }
            else if (b.dataset.cxEditar) { const r = estado.regs.find(x => x.id === b.dataset.cxEditar); if (r) abrirFormulario(r.tipo, r); }
            else if (b.dataset.cxBorrar) borrar(b.dataset.cxBorrar);
            else if (b.dataset.cxDoc) verDocumento(b.dataset.cxDoc);
            else if (b.dataset.cxMas) { const t = b.dataset.cxMas; if (expandidos.has(t)) expandidos.delete(t); else expandidos.add(t); pintar(); }
        });
    }

    /* ---------- Formulario ---------- */

    function modal() {
        const doc = root.document;
        let el = doc.getElementById('colabExpedienteModal');
        if (el) return el;
        el = doc.createElement('div');
        el.className = 'modal fade';
        el.id = 'colabExpedienteModal';
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('aria-labelledby', 'colabExpedienteModalLabel');
        el.innerHTML = '<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content">'
            + '<div class="modal-header py-2"><h5 class="modal-title text-white mb-0" id="colabExpedienteModalLabel"></h5>'
            + '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>'
            + '<div class="modal-body"><form id="cx-form" novalidate><div class="row g-3" id="cx-campos"></div></form></div>'
            + '<div class="modal-footer justify-content-between"><small class="text-danger fw-semibold" id="cx-error"></small>'
            + '<div class="d-flex gap-2"><button type="button" class="btn btn-light border" data-bs-dismiss="modal">Cancelar</button>'
            + '<button type="button" class="btn btn-success" id="cx-guardar"><i class="fas fa-save me-1"></i>Guardar</button></div></div>'
            + '</div></div>';
        // Dentro de Colaboradores para que los combos y las fechas tomen el estilo del módulo.
        (doc.getElementById('colaboradores-section') || doc.body).appendChild(el);
        el.querySelector('#cx-guardar').addEventListener('click', guardar);
        return el;
    }

    let editando = null;

    function campoHtml(c, valor) {
        const id = 'cx-f-' + c.k;
        const req = c.req ? ' <span class="text-danger">*</span>' : '';
        const label = '<label class="form-label fw-semibold small" for="' + id + '">' + esc(c.label) + req + '</label>';
        const ancho = c.ancho || (c.tipo === 'textarea' ? 12 : 6);
        let control;
        if (c.tipo === 'select') {
            const v = valor === true ? 'Sí' : valor === false ? 'No' : (valor == null ? '' : String(valor));
            const ops = c.opciones.slice();
            if (v && !ops.includes(v)) ops.push(v);
            control = '<select class="form-select form-select-sm" id="' + id + '"><option value="">— Seleccionar —</option>'
                + ops.map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
        } else if (c.tipo === 'textarea') {
            control = '<textarea class="form-control form-control-sm" id="' + id + '" rows="2" maxlength="1000">' + esc(valor || '') + '</textarea>';
        } else {
            const type = c.tipo === 'date' ? 'date' : c.tipo === 'number' ? 'number' : 'text';
            control = '<input type="' + type + '" class="form-control form-control-sm" id="' + id + '" value="' + esc(valor == null ? '' : valor) + '"'
                + (c.placeholder ? ' placeholder="' + esc(c.placeholder) + '"' : '')
                + (c.min != null ? ' min="' + c.min + '"' : '') + (c.max != null ? ' max="' + c.max + '"' : '')
                + (type === 'text' ? ' maxlength="300" autocomplete="off"' : '') + '>';
        }
        const ayuda = c.ayuda ? '<div class="form-text">' + esc(c.ayuda) + '</div>' : '';
        return '<div class="col-12 col-md-' + ancho + '">' + label + control + ayuda + '</div>';
    }

    function abrirFormulario(tipo, reg, prellenado) {
        const cfg = TIPOS[tipo];
        if (!cfg || !estado.canEdit) return;
        const el = modal();
        editando = { tipo, reg };
        el.querySelector('#colabExpedienteModalLabel').innerHTML =
            '<i class="fas ' + cfg.icono + ' me-2"></i>' + (reg ? 'Editar ' : 'Agregar ') + esc(cfg.singular);
        const valores = Object.assign({}, prellenado || {}, reg || {});
        let html = cfg.campos.map(c => campoHtml(c, valores[c.k])).join('');
        html += '<div class="col-12"><label class="form-label fw-semibold small" for="cx-f-doc">' + esc(cfg.documento)
            + ' <span class="text-muted fw-normal">(PDF, JPG o PNG · hasta 10 MB)</span></label>'
            + '<input type="file" class="form-control form-control-sm" id="cx-f-doc" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png">'
            + (reg && reg.documento_path
                ? '<div class="cx-docactual"><i class="fas fa-paperclip me-1"></i>Documento actual: ' + esc(reg.documento_nombre || 'archivo')
                  + ' · <label class="mb-0"><input type="checkbox" id="cx-f-quitar"> quitarlo</label>'
                  + ' <span class="text-muted">(si subes otro, lo reemplaza)</span></div>'
                : '')
            + '</div>';
        el.querySelector('#cx-campos').innerHTML = html;
        el.querySelector('#cx-error').textContent = '';
        const bs = root.bootstrap;
        if (bs && bs.Modal) bs.Modal.getOrCreateInstance(el).show();
    }

    /** Lee y valida el formulario. Devuelve { datos } o { error }. */
    function leerFormulario(tipo, doc) {
        const cfg = TIPOS[tipo];
        const datos = {};
        for (const c of cfg.campos) {
            const el = doc.getElementById('cx-f-' + c.k);
            let v = el ? String(el.value || '').trim() : '';
            if (c.req && !v) return { error: 'Falta: ' + c.label + '.', foco: el };
            if (c.k === 'justificado') datos[c.k] = v ? v === 'Sí' : null;
            else if (c.tipo === 'number') {
                const n = v === '' ? null : Number(v);
                if (n != null && (!Number.isInteger(n) || n < (c.min || 0) || n > (c.max || 1e9))) {
                    return { error: c.label + ': escribe un número entre ' + c.min + ' y ' + c.max + '.', foco: el };
                }
                datos[c.k] = n;
            } else datos[c.k] = v || null;
        }
        if (datos.fecha_inicio && datos.fecha_fin && datos.fecha_fin < datos.fecha_inicio) {
            return { error: 'La fecha final no puede ser antes de la inicial.', foco: doc.getElementById('cx-f-fecha_fin') };
        }
        return { datos };
    }

    async function guardar() {
        const doc = root.document;
        const el = modal();
        const errEl = el.querySelector('#cx-error');
        const btn = el.querySelector('#cx-guardar');
        if (!editando) return;
        const { tipo, reg } = editando;
        const leido = leerFormulario(tipo, doc);
        if (leido.error) { errEl.textContent = leido.error; if (leido.foco) leido.foco.focus(); return; }
        const archivo = (doc.getElementById('cx-f-doc') || {}).files ? doc.getElementById('cx-f-doc').files[0] : null;
        const quitar = !!(doc.getElementById('cx-f-quitar') || {}).checked;
        let tipoArchivo = null;
        if (archivo) {
            try { tipoArchivo = await validarArchivo(archivo); } catch (e) { errEl.textContent = e.message; return; }
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Guardando…';
        errEl.textContent = '';
        try {
            let fila;
            if (reg) {
                const { data, error } = await sb().from(TABLA).update(leido.datos).eq('id', reg.id).select().single();
                if (error) throw error;
                fila = data;
            } else {
                const nuevo = Object.assign({ num_empleado: estado.num, tipo }, leido.datos);
                const { data, error } = await sb().from(TABLA).insert(nuevo).select().single();
                if (error) throw error;
                fila = data;
            }

            const anterior = reg && reg.documento_path;
            if (archivo) {
                const ruta = rutaDocumento(estado.num, tipo, fila.id, tipoArchivo.ext);
                const subida = await sb().storage.from(BUCKET).upload(ruta, archivo, { contentType: tipoArchivo.tipo, upsert: false });
                if (subida.error) {
                    throw Object.assign(new Error('Se guardó el registro, pero no el documento: ' + subida.error.message), { parcial: true });
                }
                const { data, error } = await sb().from(TABLA)
                    .update({ documento_path: ruta, documento_nombre: archivo.name.slice(0, 200) }).eq('id', fila.id).select().single();
                if (error) throw error;
                fila = data;
                if (anterior) await sb().storage.from(BUCKET).remove([anterior]);
            } else if (quitar && anterior) {
                const { data, error } = await sb().from(TABLA)
                    .update({ documento_path: null, documento_nombre: null }).eq('id', fila.id).select().single();
                if (error) throw error;
                fila = data;
                await sb().storage.from(BUCKET).remove([anterior]);
            }

            root.logHistory?.(reg ? 'EDITAR' : 'CREAR', 'Colaboradores', estado.num, {
                summary: (reg ? 'Editó ' : 'Agregó ') + TIPOS[tipo].singular + ' de No. ' + estado.num,
            });
            const bs = root.bootstrap;
            if (bs && bs.Modal) bs.Modal.getInstance(el)?.hide();
            await render(estado.opts);
        } catch (e) {
            console.error('[Expediente] No se pudo guardar', e);
            errEl.textContent = e && e.message ? (e.parcial ? e.message : 'No se pudo guardar: ' + e.message) : 'No se pudo guardar.';
            if (e && e.parcial) await render(estado.opts);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save me-1"></i>Guardar';
        }
    }

    async function borrar(id) {
        const r = estado.regs.find(x => x.id === id);
        if (!r || !estado.canEdit) return;
        const que = TIPOS[r.tipo].singular + (r.fecha_inicio ? ' del ' + fechaCorta(r.fecha_inicio) : '');
        if (!root.confirm('¿Eliminar ' + que + '?' + (r.documento_path ? ' También se borrará su documento.' : ''))) return;
        const { error } = await sb().from(TABLA).delete().eq('id', id);
        if (error) { root.alert('No se pudo eliminar: ' + error.message); return; }
        if (r.documento_path) await sb().storage.from(BUCKET).remove([r.documento_path]);
        root.logHistory?.('ELIMINAR', 'Colaboradores', estado.num, { summary: 'Eliminó ' + que + ' de No. ' + estado.num });
        await render(estado.opts);
    }

    async function verDocumento(id) {
        const r = estado.regs.find(x => x.id === id);
        if (!r || !r.documento_path) return;
        // La pestaña se abre antes de pedir el enlace: si no, el navegador la bloquea.
        const ventana = root.open('', '_blank');
        const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(r.documento_path, URL_SEGUNDOS);
        if (error || !data || !data.signedUrl) {
            if (ventana) ventana.close();
            root.alert('No se pudo abrir el documento' + (error ? ': ' + error.message : '.'));
            return;
        }
        if (ventana) ventana.location.href = data.signedUrl; else root.open(data.signedUrl, '_blank', 'noopener');
    }

    /** Abre el formulario de comisión con el área ya escrita. */
    function nuevaComision(destino) {
        abrirFormulario('comision', null, { titulo: destino || '' });
    }

    return Object.freeze({
        TIPOS, BUCKET, DOC_MAX,
        fechaCorta, diasEntre, vigente, resumen, rutaDocumento, validarArchivo, leerFormulario,
        render, abrirFormulario, nuevaComision,
    });
});
