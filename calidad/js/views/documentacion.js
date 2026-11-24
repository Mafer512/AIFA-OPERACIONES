(function () {
  'use strict';
  /** Documentación — Repositorio controlado de formatos, instructivos, procedimientos y capacitación. */
  const { html, mount, $, on, debounce } = SIGEC.use('core/dom');
  const { date, num } = SIGEC.use('core/format');
  const { pageHead, empty, badge, toast, openModal, options, showFieldErrors } = SIGEC.use('core/ui');
  const { listDocumentos, agregarDocumento, urlDocumento } = SIGEC.use('data/api');
  const { DOC_CATEGORIAS, DOC_TIPOS } = SIGEC.use('data/catalogs');
  const FILE_ICON = { PDF: 'bi-file-earmark-pdf-fill', XLSX: 'bi-file-earmark-excel-fill', PPTX: 'bi-file-earmark-slides-fill', MP4: 'bi-file-earmark-play-fill', DOCX: 'bi-file-earmark-word-fill' };
  const ALLOWED = { pdf: 'PDF', xlsx: 'XLSX', pptx: 'PPTX', docx: 'DOCX' };
  const MAX_MB = 20;

  let st;
  let ctxRef;

  const size = (kb) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${num(kb)} KB`);

  async function render(el, ctx) {
    ctxRef = ctx;
    st = { cat: DOC_CATEGORIAS.some((c) => c.id === ctx.params.cat) ? ctx.params.cat : 'formatos', q: '' };

    mount(el, html`
      ${pageHead({
        icon: 'bi-folder-fill',
        title: 'Documentación',
        subtitle: 'Documentos vigentes del Sistema de Gestión de la Calidad',
        aside: ctx.can('documento:subir') ? html`<button type="button" class="btn btn-accent btn-sm" id="btn-upload"><i class="bi bi-cloud-arrow-up-fill" aria-hidden="true"></i>Subir documento</button>` : '',
      })}
      <div class="tabs" role="tablist" aria-label="Categorías" id="doc-tabs"></div>
      <div class="filterbar">
        <div class="field field--grow"><label for="d-q">Buscar documento</label>
          <div class="input-icon"><i class="bi bi-search" aria-hidden="true"></i><input class="form-control" id="d-q" type="search" maxlength="60" placeholder="Nombre, código o descripción" autocomplete="off"></div></div>
      </div>
      <section class="card-x card-x--flush" aria-label="Documentos"><div class="card-x__body" id="doc-table"></div></section>
      <p class="footnote"><i class="bi bi-shield-check" aria-hidden="true"></i>Se muestra la versión vigente de cada código · Los archivos se guardan en almacenamiento privado y se descargan con enlaces temporales.</p>
    `);

    on(el, 'click', '[data-cat]', (_e, b) => { st.cat = b.dataset.cat; ctx.setParams({ cat: st.cat === 'formatos' ? '' : st.cat }); load(el); });
    $('#d-q', el).addEventListener('input', debounce((e) => { st.q = e.target.value.slice(0, 60); load(el); }, 250));
    on(el, 'click', '[data-download]', (_e, b) => descargar(b));
    $('#btn-upload', el)?.addEventListener('click', () => openUpload(el));

    await load(el);
  }

  async function descargar(b) {
    if (b.disabled) return;
    b.disabled = true;
    try {
      const url = await urlDocumento(b.dataset.download);
      // El enlace responde como adjunto: el navegador descarga sin salir de la página.
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast(err.amigable ? err.message : 'No fue posible descargar el documento.', 'crit');
    } finally {
      b.disabled = false;
    }
  }

  async function load(el) {
    const box = $('#doc-table', el);
    box.classList.add('is-busy');
    let res;
    try {
      res = await listDocumentos(st.cat, st.q);
    } catch (err) {
      box.classList.remove('is-busy');
      if (ctxRef.isCurrent()) mount(box, empty('No fue posible cargar los documentos', err.amigable ? err.message : 'Intenta nuevamente en unos momentos.', 'bi-cloud-slash'));
      return;
    }
    const { rows, counts } = res;
    box.classList.remove('is-busy');
    if (!ctxRef.isCurrent()) return;

    mount($('#doc-tabs', el), html`${DOC_CATEGORIAS.map((c) => html`
      <button type="button" class="tab" role="tab" data-cat="${c.id}" aria-selected="${String(c.id === st.cat)}">
        <i class="bi ${c.icon}" aria-hidden="true"></i>${c.label}<span class="tab__count">${counts[c.id]}</span></button>`)}`);

    mount(box, html`${rows.length === 0 ? empty('Sin documentos', st.q ? 'Ningún documento coincide con la búsqueda.' : 'Aún no hay documentos en esta categoría.', 'bi-folder2-open') : html`
      <div class="table-wrap"><table class="table-x">
        <caption class="visually-hidden">Documentos de la categoría seleccionada</caption>
        <thead><tr>
          <th scope="col">Nombre del documento</th>
          <th scope="col">Descripción</th>
          <th scope="col">Tipo</th>
          <th scope="col">Versión</th>
          <th scope="col">Fecha de actualización</th>
          <th scope="col" class="text-end">Descargar</th>
        </tr></thead>
        <tbody>${rows.map((d) => html`<tr>
          <td><div class="d-flex align-items-center gap-2">
            <i class="bi ${FILE_ICON[d.formato] || 'bi-file-earmark-fill'} file-ico" aria-hidden="true"></i>
            <div><div class="fw-semibold">${d.nombre}</div><div class="muted small mono">${d.codigo} · ${d.formato} · ${size(d.kb)}</div></div></div></td>
          <td class="muted">${d.descripcion}</td>
          <td>${badge(d.tipo, DOC_TIPOS[d.tipo] || 'neutral')}</td>
          <td class="mono">v${d.version}</td>
          <td>${date(d.fecha)}</td>
          <td class="text-end"><button type="button" class="icon-btn" data-download="${d.id}" aria-label="Descargar ${d.nombre}" title="Descargar ${d.codigo} v${d.version}"><i class="bi bi-download text-crit" aria-hidden="true"></i></button></td>
        </tr>`)}</tbody>
      </table></div>`}`);
  }

  /** Un DOCX/XLSX/PPTX es un ZIP que debe contener [Content_Types].xml y su carpeta propia. */
  async function esOffice(file, formato) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04)) return false;
    const text = new TextDecoder('latin1').decode(bytes);
    const carpeta = { DOCX: 'word/', XLSX: 'xl/', PPTX: 'ppt/' }[formato];
    return text.includes('[Content_Types].xml') && text.includes(carpeta);
  }

  function openUpload(el) {
    const { el: m, close } = openModal({
      title: 'Subir documento',
      icon: 'bi-cloud-arrow-up-fill',
      body: html`<form id="form-doc" novalidate><div class="row g-3">
        <div class="col-12"><label class="form-label" for="u-nombre">Nombre del documento *</label>
          <input class="form-control" id="u-nombre" name="nombre" maxlength="120" required><div class="invalid-feedback" data-for="nombre"></div></div>
        <div class="col-md-6"><label class="form-label" for="u-codigo">Código *</label>
          <input class="form-control text-uppercase" id="u-codigo" name="codigo" maxlength="20" placeholder="PR-CAL-006" required><div class="invalid-feedback" data-for="codigo"></div></div>
        <div class="col-md-6"><label class="form-label" for="u-version">Versión *</label>
          <input class="form-control" id="u-version" name="version" maxlength="6" placeholder="1.0" required><div class="invalid-feedback" data-for="version"></div></div>
        <div class="col-md-6"><label class="form-label" for="u-cat">Categoría *</label>
          <select class="form-select" id="u-cat" name="cat">${options(DOC_CATEGORIAS.map((c) => ({ value: c.id, label: c.label })), st.cat)}</select></div>
        <div class="col-md-6"><label class="form-label" for="u-tipo">Tipo *</label>
          <select class="form-select" id="u-tipo" name="tipo">${options(Object.keys(DOC_TIPOS), 'Procedimiento')}</select></div>
        <div class="col-12"><label class="form-label" for="u-desc">Descripción</label>
          <input class="form-control" id="u-desc" name="descripcion" maxlength="160"></div>
        <div class="col-12"><label class="form-label" for="u-file">Archivo *</label>
          <input class="form-control" type="file" id="u-file" name="archivo" accept=".pdf,.docx,.xlsx,.pptx" required>
          <div class="form-text">PDF, DOCX, XLSX o PPTX · máximo ${MAX_MB} MB.</div><div class="invalid-feedback" data-for="archivo"></div></div>
      </div></form>`,
      footer: html`<button type="button" class="btn btn-outline" data-bs-dismiss="modal">Cancelar</button>
        <button type="submit" form="form-doc" class="btn btn-accent"><i class="bi bi-upload" aria-hidden="true"></i>Publicar</button>`,
    });

    const form = $('#form-doc', m);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const file = form.elements.archivo.files[0];
      const errors = {};
      const nombre = String(fd.get('nombre') || '').trim();
      const codigo = String(fd.get('codigo') || '').trim().toUpperCase();
      const version = String(fd.get('version') || '').trim();
      if (nombre.length < 4) errors.nombre = 'Escribe un nombre descriptivo.';
      if (!/^[A-Z]{2}-[A-Z]{2,4}-\d{3,4}$/.test(codigo)) errors.codigo = 'Formato: XX-XXX-000 (p. ej. PR-CAL-006).';
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(version)) errors.version = 'Formato: 1.0';
      let formato = null;
      if (!file) errors.archivo = 'Selecciona un archivo.';
      else {
        const ext = file.name.split('.').pop().toLowerCase();
        formato = ALLOWED[ext];
        if (!formato) errors.archivo = 'Tipo de archivo no permitido.';
        else if (file.size > MAX_MB * 1024 * 1024) errors.archivo = `El archivo supera ${MAX_MB} MB.`;
        else if (formato === 'PDF') {
          const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
          if (String.fromCharCode(...head) !== '%PDF-') errors.archivo = 'El archivo no es un PDF válido.';
        } else {
          if (!(await esOffice(file, formato))) errors.archivo = 'El contenido no corresponde a un archivo de Office válido.';
        }
      }
      showFieldErrors(form, errors);
      if (Object.keys(errors).length) return;
      const btn = m.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await agregarDocumento({ nombre, codigo, version, cat: fd.get('cat'), tipo: fd.get('tipo'), descripcion: String(fd.get('descripcion') || '').trim(), formato, kb: Math.round(file.size / 1024), archivo: file }, ctxRef.user);
      } catch (err) {
        showFieldErrors(form, err.fields || {});
        toast(err.amigable ? err.message : 'No fue posible publicar el documento.', 'crit');
        btn.disabled = false;
        return;
      }
      close();
      toast(`Documento ${codigo} publicado.`, 'ok');
      st.cat = fd.get('cat');
      load(el);
    });
  }

  SIGEC.define('views/documentacion', { render });
})();
