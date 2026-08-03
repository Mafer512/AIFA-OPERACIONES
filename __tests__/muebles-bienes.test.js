const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'js', 'muebles-bienes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '011_muebles_bienes.sql'), 'utf8');
const documentUpgrade = fs.readFileSync(path.join(root, 'supabase', 'migrations', '014_muebles_bienes_documentos_versiones.sql'), 'utf8');
const quickUploadUpgrade = fs.readFileSync(path.join(root, 'supabase', 'migrations', '015_muebles_bienes_carga_historial.sql'), 'utf8');
const audit = JSON.parse(fs.readFileSync(path.join(root, 'muebles_bienes_import_auditoria.json'), 'utf8'));
const docsAudit = JSON.parse(fs.readFileSync(path.join(root, 'muebles_bienes_documentos_auditoria.json'), 'utf8'));
const uploader = fs.readFileSync(path.join(root, 'scripts', 'upload_muebles_bienes_documents.js'), 'utf8');

describe('modulo Muebles y Bienes', () => {
  test('aparece inmediatamente debajo de Vehiculos', () => {
    const vehicle = html.indexOf('id="menu-coord-auditoria"');
    const goods = html.indexOf('id="menu-muebles-bienes"');
    expect(vehicle).toBeGreaterThan(0);
    expect(goods).toBeGreaterThan(vehicle);
    expect(html.slice(vehicle, goods).match(/<a\b/g)).toHaveLength(1);
  });
  test('tiene sección y permiso independientes sin modificar el módulo de vehículos', () => {
    expect(script).toContain("targetKey === 'muebles-bienes'");
    expect(script).toContain("{ key: 'muebles-bienes'");
    expect(moduleSource).toContain("const SECTION = 'muebles-bienes'");
    expect(moduleSource).toContain(".from('muebles_bienes')");
  });
  test('inicia el inventario al entrar directamente por hash o restaurar la sección activa', () => {
    expect(html).toContain('js/muebles-bienes.js?v=4');
    expect(moduleSource).toContain("document.addEventListener('DOMContentLoaded',activateOnEntry,{once:true})");
    const start=moduleSource.indexOf('function activateOnEntry()');
    const end=moduleSource.indexOf('function populateFilters()',start);
    const build=new Function('$','location','load',`${moduleSource.slice(start,end)}; return activateOnEntry;`);
    let calls=0;
    build(()=>({classList:{contains:()=>false}}),{hash:'#muebles-bienes'},()=>{calls++;})();
    build(()=>({classList:{contains:()=>true}}),{hash:'#otra'},()=>{calls++;})();
    build(()=>({classList:{contains:()=>false}}),{hash:'#otra'},()=>{calls++;})();
    expect(calls).toBe(2);
  });
  test('limita la espera de Supabase y ofrece reintento en lugar de dejar el spinner permanente', async () => {
    expect(moduleSource).toContain('id="mb-load-error"');
    expect(moduleSource).toContain('mueblesBienesModule.reload()');
    expect(moduleSource).toContain('await withTimeout(window.ensureSupabaseClient()');
    expect(moduleSource).toContain('await withTimeout(Promise.all([');
    const start=moduleSource.indexOf('function withTimeout(');
    const end=moduleSource.indexOf('async function load(',start);
    const withTimeout=new Function('LOAD_TIMEOUT_MS',`${moduleSource.slice(start,end)}; return withTimeout;`)(20);
    await expect(withTimeout(new Promise(()=>{}),5,'Tiempo agotado')).rejects.toThrow('Tiempo agotado');
    await expect(withTimeout(Promise.resolve('ok'),50)).resolves.toBe('ok');
  });
  test('filtra localmente desde memoria y no consulta Supabase por tecla', () => {
    const start=moduleSource.indexOf('function applyFilters()');
    const end=moduleSource.indexOf('function updateKPIs()',start);
    const filter=moduleSource.slice(start,end);
    expect(filter).toContain('state.all.filter');
    expect(filter).not.toMatch(/\.from\s*\(|await|ensureSupabaseClient/);
    expect(moduleSource).toContain('requestAnimationFrame(applyFilters)');
  });
  test('valida PDF privado y límite de 10 MB', () => {
    expect(moduleSource).toContain("const MAX_PDF = 10 * 1024 * 1024");
    expect(moduleSource).toContain("mime!=='application/pdf'");
    expect(moduleSource).toContain("String.fromCharCode(...bytes)==='%PDF-'");
    expect(moduleSource).toContain('window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),stopAtErrors:true})');
    expect(moduleSource).toContain('await verifyStoredPdf(sb,storagePath');
    expect(moduleSource).toContain('createSignedUrl');
    expect(moduleSource).toContain("'REEMPLAZAR_DOCUMENTO'");
    expect(migration).toContain("'muebles-bienes-documentos','muebles-bienes-documentos',false");
  });
  test('la previsualización es diferida, funciona con puntero y toque y abre un visor real', () => {
    expect(moduleSource).toContain('onmouseenter="mueblesBienesModule.previewDocuments');
    expect(moduleSource).toContain('onclick="mueblesBienesModule.openDocuments(event');
    expect(moduleSource).toContain('consumeDocumentEvent(event)');
    expect(moduleSource).toContain('loading="lazy"');
    expect(moduleSource).toContain('function openViewer');
    expect(moduleSource).toContain('viewerPage');
    expect(moduleSource).toContain('viewerZoom');
    expect(moduleSource).toContain("createSignedUrl(doc.storage_path,300)");
    expect(moduleSource).toContain("select('bien_id,documento_id')");
    expect(moduleSource).toContain('async function loadDocuments(bienId)');
    expect(moduleSource).toContain('window.pdfjsLib.getDocument({url})');
    expect(moduleSource).toContain('state.viewerPages=pdf.numPages');
  });

  test('abre un PDF único directamente y presenta la lista cuando existen varios', async () => {
    const start = moduleSource.indexOf('async function openDocuments(');
    const end = moduleSource.indexOf('function positionPreview(', start);
    const buildOpenDocuments = new Function('deps', `
      const loadDocuments=deps.loadDocuments, closePreview=deps.closePreview;
      const openViewer=deps.openViewer, previewDocuments=deps.previewDocuments;
      const consumeDocumentEvent=deps.consumeDocumentEvent, toast=deps.toast;
      ${moduleSource.slice(start, end)}
      return openDocuments;
    `);
    const calls = [];
    const anchor = { getBoundingClientRect: () => ({}) };
    const event = {
      currentTarget: anchor,
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
      stopImmediatePropagation: () => calls.push('stopImmediatePropagation')
    };
    const common = {
      closePreview: () => calls.push('cerrar-lista'),
      openViewer: (...args) => calls.push(['visor', ...args]),
      previewDocuments: (...args) => calls.push(['lista', ...args]),
      consumeDocumentEvent: e => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      },
      toast: message => calls.push(['mensaje', message])
    };
    const openSingle = buildOpenDocuments({
      ...common,
      loadDocuments: async () => [{ id: 'pdf-del-bien-1' }]
    });
    await openSingle(event, 'bien-1');
    expect(calls).toContainEqual(['visor', null, 'pdf-del-bien-1', 'bien-1']);
    expect(calls).toEqual(expect.arrayContaining(['preventDefault', 'stopPropagation', 'stopImmediatePropagation']));

    calls.length = 0;
    const openMultiple = buildOpenDocuments({
      ...common,
      loadDocuments: async () => [{ id: 'pdf-1' }, { id: 'pdf-2' }]
    });
    await openMultiple(event, 'bien-2');
    const listCall = calls.find(call => Array.isArray(call) && call[0] === 'lista');
    expect(listCall[1].currentTarget).toBe(anchor);
    expect(listCall[2]).toBe('bien-2');
    expect(calls.some(call => Array.isArray(call) && call[0] === 'visor')).toBe(false);
  });

  test('cada tarjeta sólo puede resolver sus propios documentos', () => {
    const start = moduleSource.indexOf('function findDocument(');
    const end = moduleSource.indexOf('function documentOpenMessage(', start);
    const findDocument = new Function('state', `${moduleSource.slice(start, end)}; return findDocument;`)({
      docs: new Map([
        ['bien-1', [{ id: 'pdf-1', nombre_original: 'uno.pdf' }]],
        ['bien-2', [{ id: 'pdf-2', nombre_original: 'dos.pdf' }]]
      ])
    });
    expect(findDocument('pdf-1', 'bien-1').nombre_original).toBe('uno.pdf');
    expect(findDocument('pdf-2', 'bien-2').nombre_original).toBe('dos.pdf');
    expect(findDocument('pdf-2', 'bien-1')).toBeNull();
    expect(findDocument('pdf-1', 'bien-2')).toBeNull();
  });

  test('miniatura, nombre, lista y botón abren el visor sin descarga automática', () => {
    const previewStart = moduleSource.indexOf('async function previewDocuments(');
    const previewEnd = moduleSource.indexOf('function schedulePreviewClose(', previewStart);
    const preview = moduleSource.slice(previewStart, previewEnd);
    expect(preview).toContain('mb-preview-open mb-doc-clickable');
    expect(preview).toContain('mb-doc-name mb-doc-clickable');
    expect(preview).toContain('Ver PDF completo');
    expect(preview).toContain("onclick=\"mueblesBienesModule.openViewer(event,'${d.id}','${bienId}')\"");
    expect(preview).toContain("openAction=`mueblesBienesModule.openViewer(event,'${doc.id}','${bienId}')`");
    expect(preview).toContain("mueblesBienesModule.openPDF(event,'${doc.id}','${bienId}')");
    expect(preview).not.toMatch(/\.download\s*=|viewerDownload\(/);
    expect(moduleSource).toContain('.mb-doc-clickable{cursor:pointer}');
  });

  test('un archivo ausente muestra un error y no deja el visor anterior activo', () => {
    const signedStart = moduleSource.indexOf('async function signedUrl(');
    const signedEnd = moduleSource.indexOf('async function openPDF(', signedStart);
    const viewerStart = moduleSource.indexOf('async function openViewer(');
    const viewerEnd = moduleSource.indexOf('async function refreshViewer(', viewerStart);
    const signed = moduleSource.slice(signedStart, signedEnd);
    const viewer = moduleSource.slice(viewerStart, viewerEnd);
    expect(signed).toContain("if(!doc?.storage_path)throw new Error('El registro no tiene un archivo PDF asociado.')");
    expect(signed).toContain("if(!data?.signedUrl)throw new Error('El almacenamiento no devolvió una dirección válida para el PDF.')");
    expect(viewer).toContain('pdf=await loadViewerPdf(url)');
    expect(viewer).toContain("clearViewer();toast(documentOpenMessage(doc,e),'danger')");
    expect(viewer.indexOf('pdf=await loadViewerPdf(url)')).toBeLessThan(viewer.indexOf('showViewerModal()'));
    expect(viewer).toContain('if(modalOpened&&state.viewerDoc)showActiveViewerError(e)');
    expect(moduleSource).toContain("canvas?.classList.add('d-none')");
    expect(moduleSource).toContain("fallback.classList.remove('d-none')");
  });

  test('Sin PDF selecciona inmediatamente el archivo para el UUID correcto', async () => {
    const badgeStart = moduleSource.indexOf('function docBadge(');
    const badgeEnd = moduleSource.indexOf('function cardHTML(', badgeStart);
    const badge = moduleSource.slice(badgeStart, badgeEnd);
    expect(badge).toContain('data-mb-quick-upload="${row.id}"');
    expect(badge).toContain("mueblesBienesModule.chooseQuickDocument(event,'${row.id}')");
    expect(badge).toContain("if(!canEdit())return '<span class=\"badge bg-secondary\">Sin PDF</span>'");

    const start = moduleSource.indexOf('async function quickFileSelected(');
    const end = moduleSource.indexOf('async function uploadDocument()', start);
    const uploads = [], visualStates = [];
    const state = { quickBienId: 'bien-interno-27', quickUploads: new Set() };
    const quickFileSelected = new Function('deps', `
      const state=deps.state, canEdit=deps.canEdit, toast=deps.toast;
      const setQuickCardState=deps.setQuickCardState, uploadDocumentSafe=deps.uploadDocumentSafe;
      ${moduleSource.slice(start, end)}
      return quickFileSelected;
    `)({
      state,
      canEdit: () => true,
      toast: jest.fn(),
      setQuickCardState: (...args) => visualStates.push(args),
      uploadDocumentSafe: async options => uploads.push(options)
    });
    const file = { name: 'resguardo.pdf', type: 'application/pdf', size: 100 };
    const input = { files: [file], value: 'seleccionado' };
    await quickFileSelected({ target: input });
    expect(visualStates).toContainEqual(['bien-interno-27', 'loading']);
    expect(uploads).toContainEqual({ quick: true, bienId: 'bien-interno-27', file, type: 'Resguardo' });
    expect(state.quickUploads.has('bien-interno-27')).toBe(true);
  });

  test('muestra Subiendo PDF y confirma con paloma y Listo sin recargar', () => {
    const start = moduleSource.indexOf('function setQuickCardState(');
    const end = moduleSource.indexOf('function chooseQuickDocument(', start);
    const visual = moduleSource.slice(start, end);
    expect(moduleSource).toContain('.mb-quick-uploading,.mb-quick-upload-success{background:#ecfdf3');
    expect(visual).toContain('Subiendo PDF…');
    expect(visual).toContain('spinner-border spinner-border-sm');
    expect(visual).toContain('fa-check-circle');
    expect(visual).toContain('Listo');
    expect(visual).toContain("state.quickSuccess.add(bienId)");
    expect(visual).toContain("setTimeout(()=>{state.quickSuccess.delete(bienId)");
    expect(moduleSource).toContain("success=state.quickSuccess.has(row.id)");
    expect(visual).not.toMatch(/location\.reload|window\.location/);
    expect(moduleSource).toContain("refreshDocumentUI(bienId,quick?'Listo'");
    expect(moduleSource).toContain('state.docs.set(bienId,docs);state.docsLoaded.add(bienId)');

    const classes = new Set(), inserted = [], button = { disabled: false, innerHTML: '' };
    const card = {
      classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) },
      querySelector: () => null,
      insertAdjacentHTML: (_position, html) => inserted.push(html)
    };
    const quickState = { quickSuccess: new Set(), quickTimers: new Map() };
    let timerCallback = null;
    const setQuickCardState = new Function('deps', `
      const state=deps.state, document=deps.document;
      const clearTimeout=deps.clearTimeout, setTimeout=deps.setTimeout;
      ${moduleSource.slice(start, moduleSource.indexOf('function refreshDocumentUI(', start))}
      return setQuickCardState;
    `)({
      state: quickState,
      document: {
        querySelectorAll: () => [button],
        querySelector: () => card
      },
      clearTimeout: jest.fn(),
      setTimeout: callback => { timerCallback = callback; return 41; }
    });
    setQuickCardState('bien-visual', 'loading');
    expect(button.disabled).toBe(true);
    expect(button.innerHTML).toContain('Subiendo');
    expect(classes.has('mb-quick-uploading')).toBe(true);
    setQuickCardState('bien-visual', 'success');
    expect(quickState.quickSuccess.has('bien-visual')).toBe(true);
    expect(classes.has('mb-quick-upload-success')).toBe(true);
    expect(inserted.at(-1)).toContain('Listo');
    timerCallback();
    expect(quickState.quickSuccess.has('bien-visual')).toBe(false);
    expect(classes.has('mb-quick-upload-success')).toBe(false);
  });

  test('desplaza la vista a la tarjeta exacta después de cerrar los modales', () => {
    const start = moduleSource.indexOf('function focusBienRecord(');
    const end = moduleSource.indexOf('function refreshDocumentUI(', start);
    const selected = [];
    const target = { scrollIntoView: jest.fn() };
    let visibleModal = null, hiddenHandler = null;
    const focusBienRecord = new Function('deps', `
      const state=deps.state, document=deps.document, requestAnimationFrame=deps.requestAnimationFrame;
      ${moduleSource.slice(start, end)}
      return focusBienRecord;
    `)({
      state: { view: 'grid' },
      document: {
        querySelector(selector) {
          selected.push(selector);
          if (selector === '#mb-doc-modal.show,#mb-detail-modal.show') return visibleModal;
          return target;
        }
      },
      requestAnimationFrame: callback => callback()
    });
    focusBienRecord('bien-exacto-42');
    expect(selected).toContain('[data-mb-card="bien-exacto-42"]');
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    target.scrollIntoView.mockClear();
    visibleModal = { addEventListener: (_event, callback, options) => { hiddenHandler = callback; expect(options).toEqual({ once: true }); } };
    focusBienRecord('bien-exacto-42');
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    visibleModal = null;
    hiddenHandler();
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  test('un error rápido revierte la carga y restaura Sin PDF para reintentar', () => {
    const start = moduleSource.indexOf('async function uploadDocumentSafe(options={})');
    const end = moduleSource.indexOf('function historyActionLabel(', start);
    const upload = moduleSource.slice(start, end);
    expect(upload).toContain('rollbackNewDocument(sb,created,uploadedPath,bienId,linked)');
    expect(upload).toContain("else if(quick)toast(`No se pudo cargar el PDF: ${message}`,'danger')");
    expect(upload).toMatch(/if\(visualStarted&&!succeeded\)\{state\.quickUploads\.delete\(bienId\);setQuickCardState\(bienId,'idle'\);?\}/);
    expect(upload.indexOf('await insertDocumentHistory(')).toBeLessThan(upload.indexOf('committed=true'));
    expect(moduleSource).toContain("if(!canEdit())throw new Error('No tienes permiso de edición para cargar documentos.')");
    expect(upload).toContain("state.quickUploads.add(bienId);visualStarted=true;setQuickCardState(bienId,'loading')");
  });

  test('Últimas modificaciones consulta sólo datos reales del módulo y los ordena', async () => {
    expect(moduleSource).toContain('>Últimas modificaciones</button>');
    expect(moduleSource).toContain("const canViewHistory = () => canEdit()");
    const start = moduleSource.indexOf('async function loadRecentHistory(');
    const end = moduleSource.indexOf('function openRecentHistory(', start);
    const body = { innerHTML: '' }, calls = [];
    const query = {
      select(columns) { calls.push(['select', columns]); return this; },
      eq(column, value) { calls.push(['eq', column, value]); return this; },
      order(column, options) { calls.push(['order', column, options.ascending]); return this; },
      async limit(value) {
        calls.push(['limit', value]);
        return { data: [
          { record_id: 'más-reciente', created_at: '2026-07-30T12:00:00Z' },
          { record_id: 'anterior', created_at: '2026-07-29T12:00:00Z' }
        ], error: null };
      }
    };
    const loadRecentHistory = new Function('deps', `
      const $=deps.$, canViewHistory=deps.canViewHistory, window=deps.window;
      const historyRowHTML=deps.historyRowHTML, esc=deps.esc;
      ${moduleSource.slice(start, end)}
      return loadRecentHistory;
    `)({
      $: id => id === 'mb-history-body' ? body : null,
      canViewHistory: () => true,
      window: { ensureSupabaseClient: async () => ({ from: table => { calls.push(['from', table]); return query; } }) },
      historyRowHTML: log => `<tr><td>${log.record_id}</td></tr>`,
      esc: value => String(value)
    });
    await loadRecentHistory();
    expect(calls).toContainEqual(['from', 'change_history']);
    expect(calls).toContainEqual(['eq', 'entity_type', 'Muebles y Bienes']);
    expect(calls).toContainEqual(['order', 'created_at', false]);
    expect(calls).toContainEqual(['limit', 50]);
    expect(body.innerHTML.indexOf('<td>más-reciente</td>')).toBeLessThan(body.innerHTML.indexOf('<td>anterior</td>'));
    ['Fecha y hora','Usuario','Bien afectado','Acción','Archivo','Valor anterior y nuevo'].forEach(label=>expect(body.innerHTML).toContain(label));
  });

  test('RLS exige edición para PDFs y protege el historial del módulo', () => {
    expect(quickUploadUpgrade).toContain("public.mb_access_level() IN ('admin','edit')");
    expect(quickUploadUpgrade).toContain('DROP POLICY IF EXISTS mb_doc_file_insert');
    expect(quickUploadUpgrade).toContain('DROP POLICY IF EXISTS mb_doc_link_insert');
    expect(quickUploadUpgrade).toContain('DROP POLICY IF EXISTS mb_storage_insert');
    expect(quickUploadUpgrade).toContain('CREATE POLICY mb_change_history_select_guard');
    expect(quickUploadUpgrade).toContain('CREATE POLICY mb_change_history_insert_guard');
    expect(quickUploadUpgrade).toContain('AS RESTRICTIVE');
    expect(quickUploadUpgrade).toContain("entity_type IS DISTINCT FROM 'Muebles y Bienes'");
    expect(quickUploadUpgrade).toContain('AND user_id=auth.uid()');
    const openDocumentStart = moduleSource.indexOf('async function openDocument(');
    const openDocumentEnd = moduleSource.indexOf('function documentRecord(', openDocumentStart);
    expect(moduleSource.slice(openDocumentStart, openDocumentEnd)).toContain('if(!canEdit())');
  });

  test('confirma el reemplazo y conserva el archivo anterior hasta guardar y auditar', () => {
    const start = moduleSource.indexOf('async function openDocument(');
    const end = moduleSource.indexOf('function documentRecord(', start);
    const openDocument = moduleSource.slice(start, end);
    expect(openDocument).toContain('if(replaceId&&!previous)');
    expect(openDocument).toContain('confirm(`¿Reemplazar ${previous.nombre_original}?');
    expect(openDocument).toContain('se conservará hasta que el nuevo PDF quede guardado y auditado correctamente');
    const uploadStart = moduleSource.indexOf('async function uploadDocumentSafe(options={})');
    const uploadEnd = moduleSource.indexOf('function historyActionLabel(', uploadStart);
    const upload = moduleSource.slice(uploadStart, uploadEnd);
    expect(upload.indexOf('await insertDocumentHistory(')).toBeLessThan(upload.indexOf('await removeDocumentLink(sb,previous'));
  });

  test('ajusta inicialmente la página completa sin desbordamiento horizontal', () => {
    const start = moduleSource.indexOf('function viewerFitScale(');
    const end = moduleSource.indexOf('function updateViewerStatus(', start);
    const makeFitScale = new Function('$', 'window', `${moduleSource.slice(start, end)}; return viewerFitScale;`);
    const desktopStage = { clientWidth: 1000, clientHeight: 800 };
    const fitDesktop = makeFitScale(() => desktopStage, { innerWidth: 1200 });
    const pageScale = fitDesktop({ width: 1200, height: 1200 }, 'page');
    const widthScale = fitDesktop({ width: 1200, height: 1200 }, 'width');
    expect(pageScale).toBeCloseTo(766 / 1200, 6);
    expect(widthScale).toBeCloseTo(966 / 1200, 6);
    expect(1200 * pageScale).toBeLessThanOrEqual(desktopStage.clientWidth - 34);
    expect(1200 * pageScale).toBeLessThanOrEqual(desktopStage.clientHeight - 34);

    const mobileStage = { clientWidth: 360, clientHeight: 560 };
    const fitMobile = makeFitScale(() => mobileStage, { innerWidth: 390 });
    const mobileScale = fitMobile({ width: 600, height: 900 }, 'page');
    expect(600 * mobileScale).toBeLessThanOrEqual(mobileStage.clientWidth - 18);
    expect(900 * mobileScale).toBeLessThanOrEqual(mobileStage.clientHeight - 18);
    expect(moduleSource).toContain("state.viewerFitMode='page'");
    expect(moduleSource).toContain('await shown;await refreshViewer(true)');
  });

  test('el modal conserva controles visibles y un área desplazable responsiva', () => {
    expect(moduleSource).toContain('#mb-pdf-modal .modal-dialog{width:min(1500px,96vw)');
    expect(moduleSource).toContain('height:96vh;margin:2vh auto');
    expect(moduleSource).toContain('#mb-pdf-stage{position:relative;flex:1 1 auto;min-height:0;overflow:auto');
    expect(moduleSource).toContain('#mb-pdf-canvas-wrap{box-sizing:border-box;display:flex;align-items:center;justify-content:center');
    expect(moduleSource).toContain('@media(max-width:767.98px)');
    expect(moduleSource).toContain('height:100dvh');
    expect(moduleSource).toContain('id="mb-pdf-canvas"');
    expect(moduleSource).not.toContain('id="mb-pdf-frame"');
    expect(moduleSource).toContain('Ajustar al ancho');
    expect(moduleSource).toContain('Ajustar página');
    expect(moduleSource).toContain('Restablecer');
    expect(moduleSource).toContain('Otra pestaña');
    expect(moduleSource).toContain('id="mb-pdf-download"');
  });

  test('zoom y navegación conservan página y escala según corresponde', async () => {
    const pageStart = moduleSource.indexOf('async function viewerPage(');
    const zoomStart = moduleSource.indexOf('async function viewerZoom(', pageStart);
    const fitStart = moduleSource.indexOf('async function viewerFit(', zoomStart);
    const tabStart = moduleSource.indexOf('async function viewerOpenTab(', fitStart);
    const changes = [];
    const state = { viewerPage: 1, viewerPages: 3, viewerScale: 0.8, viewerFitMode: 'page' };
    const applyViewerChange = async recalculate => changes.push(recalculate);
    const viewerPage = new Function('state', 'applyViewerChange', `${moduleSource.slice(pageStart, zoomStart)}; return viewerPage;`)(state, applyViewerChange);
    const viewerZoom = new Function('state', 'applyViewerChange', `${moduleSource.slice(zoomStart, fitStart)}; return viewerZoom;`)(state, applyViewerChange);
    const fitControls = new Function('state', 'applyViewerChange', `${moduleSource.slice(fitStart, tabStart)}; return {viewerFit,viewerFitPage,viewerReset};`)(state, applyViewerChange);

    await viewerPage(1);
    expect(state.viewerPage).toBe(2);
    expect(state.viewerScale).toBe(0.8);
    expect(changes.at(-1)).toBe(false);

    const scaleBeforeZoom = state.viewerScale;
    await viewerZoom(1);
    expect(state.viewerPage).toBe(2);
    expect(state.viewerScale).toBeCloseTo(scaleBeforeZoom * 1.15, 8);
    expect(state.viewerFitMode).toBeNull();
    await viewerZoom(-1);
    expect(state.viewerScale).toBeCloseTo(scaleBeforeZoom, 8);

    await fitControls.viewerFit();
    expect(state.viewerFitMode).toBe('width');
    expect(changes.at(-1)).toBe(true);
    await fitControls.viewerFitPage();
    expect(state.viewerFitMode).toBe('page');
    await fitControls.viewerReset();
    expect(state.viewerFitMode).toBe('page');
    expect(state.viewerPage).toBe(2);
  });

  test('renderiza la página con PDF.js, alta resolución y cancelación segura', async () => {
    const start = moduleSource.indexOf('async function refreshViewer(');
    const end = moduleSource.indexOf('function showActiveViewerError(', start);
    const viewer = moduleSource.slice(start, end);
    expect(viewer).toContain('pdf.getPage(state.viewerPage)');
    expect(viewer).toContain("page.getViewport({scale:state.viewerScale})");
    expect(viewer).toContain('window.devicePixelRatio');
    expect(viewer).toContain('page.render({canvasContext:context,viewport:renderViewport})');
    expect(viewer).toContain("error?.name==='RenderingCancelledException'");
    expect(viewer).toContain("stage.scrollTo({top:0,left:Math.max(0,(stage.scrollWidth-stage.clientWidth)/2)");
    expect(moduleSource).toContain("$('mb-pdf-page-label').textContent=`Página ${state.viewerPage}${state.viewerPages?` de ${state.viewerPages}`:''}`");

    const classList = () => ({ add: jest.fn(), remove: jest.fn() });
    const canvas = { width: 0, height: 0, style: {}, classList: classList(), getContext: jest.fn(() => ({})) };
    const loading = { classList: classList() }, fallback = { classList: classList() };
    const stage = { scrollWidth: 700, clientWidth: 500, scrollTo: jest.fn() };
    const elements = { 'mb-pdf-canvas': canvas, 'mb-pdf-loading': loading, 'mb-pdf-fallback': fallback, 'mb-pdf-stage': stage };
    const render = jest.fn(() => ({ promise: Promise.resolve(), cancel: jest.fn() }));
    const page = { getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), render };
    const state = {
      viewerPdf: { getPage: jest.fn(async () => page) }, viewerRenderTask: null,
      viewerRenderRequest: 0, viewerPage: 1, viewerPages: 2, viewerScale: 1, viewerFitMode: 'page'
    };
    const refreshViewer = new Function('deps', `
      const state=deps.state, $=deps.$, window=deps.window;
      const cancelViewerRender=deps.cancelViewerRender, updateViewerStatus=deps.updateViewerStatus;
      const viewerFitScale=deps.viewerFitScale, requestAnimationFrame=deps.requestAnimationFrame;
      ${viewer}
      return refreshViewer;
    `)({
      state,
      $: id => elements[id],
      window: { devicePixelRatio: 2 },
      cancelViewerRender: () => { state.viewerRenderRequest++; state.viewerRenderTask?.cancel?.(); state.viewerRenderTask = null; },
      updateViewerStatus: jest.fn(),
      viewerFitScale: () => 0.5,
      requestAnimationFrame: callback => callback()
    });
    await refreshViewer(true);
    expect(state.viewerPdf.getPage).toHaveBeenCalledWith(1);
    expect(state.viewerScale).toBe(0.5);
    expect(canvas.style.width).toBe('306px');
    expect(canvas.style.height).toBe('396px');
    expect(canvas.width).toBe(612);
    expect(canvas.height).toBe(792);
    expect(render).toHaveBeenCalled();
    expect(canvas.classList.remove).toHaveBeenCalledWith('d-none');
    expect(stage.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0, behavior: 'auto' }));
  });
  test('mantiene el encabezado uniforme y sólo sustituye el ícono cuando existe un PDF', () => {
    const start = moduleSource.indexOf('function cardFallbackIcon(');
    const end = moduleSource.indexOf('function cardHTML(', start);
    const state = { docs: new Map(), thumbnailCache: new Map() };
    const helpers = new Function('deps', `
      const state=deps.state, norm=deps.norm, esc=deps.esc;
      const preferredThumbnailDocument=deps.preferredThumbnailDocument;
      const cachedDocumentThumbnail=deps.cachedDocumentThumbnail;
      ${moduleSource.slice(start, end)}
      return { cardVisual };
    `)({
      state,
      norm: value => String(value || '').toLowerCase(),
      esc: value => String(value || ''),
      preferredThumbnailDocument: docs => docs[0] || null,
      cachedDocumentThumbnail: doc => state.thumbnailCache.get(doc.id)?.src || null
    });
    const row = { id: 'bien-exacto', familia: 'Equipo KW' };
    const withoutPdf = helpers.cardVisual(row);
    expect(withoutPdf).toContain('mb-card-thumb-fallback');
    expect(withoutPdf).not.toContain('data-mb-thumbnail-bien');

    state.docs.set(row.id, [{ id: 'pdf-exacto' }]);
    const pendingThumbnail = helpers.cardVisual(row);
    expect(pendingThumbnail).toContain('data-mb-thumbnail-bien="bien-exacto"');
    expect(pendingThumbnail).toContain('data-mb-thumbnail-doc="pdf-exacto"');
    expect(pendingThumbnail).toContain('aria-busy="true"');
    state.thumbnailCache.set('pdf-exacto', { src: 'data:image/jpeg;base64,correcta' });
    expect(helpers.cardVisual(row)).toContain('class="mb-card-pdf-thumb"');
    expect(moduleSource).toContain('.mb-card-visual{width:100%;height:112px');
    expect(moduleSource).toContain('object-fit:cover');
    expect(moduleSource).toContain('object-position:center top');
    expect(moduleSource).toContain("const THUMBNAIL_STYLE = 'header-v3'");
    expect(moduleSource).toContain('Object.freeze({ left: .10, top: .085, width: .80, height: .115 })');
    const preferredStart = moduleSource.indexOf('function preferredThumbnailDocument(');
    const preferredEnd = moduleSource.indexOf('function thumbnailSignature(', preferredStart);
    const preferredThumbnailDocument = new Function(`${moduleSource.slice(preferredStart, preferredEnd)}; return preferredThumbnailDocument;`)();
    expect(preferredThumbnailDocument([
      { id: 'version-alta-antigua', version: 8, created_at: '2026-07-01T10:00:00Z' },
      { id: 'carga-reciente', version: 1, created_at: '2026-07-31T10:00:00Z' }
    ]).id).toBe('carga-reciente');
  });

  test('genera la primera página de forma diferida, nítida y asociada al bien correcto', async () => {
    const start = moduleSource.indexOf('async function generateDocumentThumbnail(');
    const end = moduleSource.indexOf('function pumpThumbnailQueue(', start);
    const documentRecord = { id: 'pdf-del-bien-9', sha256: 'hash-9', version: 3 };
    const visual = { dataset: { mbThumbnailDoc: documentRecord.id }, clientWidth: 520, clientHeight: 112 };
    const getViewport = jest.fn(({ scale }) => ({ width: 612 * scale, height: 792 * scale }));
    const render = jest.fn(() => ({ promise: Promise.resolve() }));
    const page = { getViewport, render, cleanup: jest.fn() };
    const pdf = { numPages: 2, getPage: jest.fn(async () => page), destroy: jest.fn(async () => {}) };
    const thumbnailContext = {}, thumbnailCanvas = { width: 0, height: 0, getContext: () => thumbnailContext, toDataURL: () => 'data:image/jpeg;base64,miniatura' };
    const applyDocumentThumbnail = jest.fn();
    const loadDocuments = jest.fn(async bienId => {
      expect(bienId).toBe('bien-9');
      return [documentRecord];
    });
    const state = { thumbnailCache: new Map(), thumbnailJobs: new Map() };
    const generateDocumentThumbnail = new Function('deps', `
      const state=deps.state, window=deps.window, document=deps.document, THUMBNAIL_CROP=deps.THUMBNAIL_CROP;
      const loadDocuments=deps.loadDocuments, preferredThumbnailDocument=deps.preferredThumbnailDocument;
      const thumbnailVisuals=deps.thumbnailVisuals, cachedDocumentThumbnail=deps.cachedDocumentThumbnail;
      const thumbnailSignature=deps.thumbnailSignature, signedUrl=deps.signedUrl;
      const applyDocumentThumbnail=deps.applyDocumentThumbnail;
      ${moduleSource.slice(start, end)}
      return generateDocumentThumbnail;
    `)({
      state,
      THUMBNAIL_CROP: { left: .10, top: .085, width: .80, height: .115 },
      window: { devicePixelRatio: 2, pdfjsLib: { getDocument: jest.fn(() => ({ promise: Promise.resolve(pdf) })) } },
      document: { createElement: jest.fn(() => thumbnailCanvas) },
      loadDocuments,
      preferredThumbnailDocument: docs => docs[0] || null,
      thumbnailVisuals: bienId => bienId === 'bien-9' ? [visual] : [],
      cachedDocumentThumbnail: doc => state.thumbnailCache.get(doc.id)?.src || null,
      thumbnailSignature: doc => `${doc.sha256}:${doc.version}`,
      signedUrl: jest.fn(async doc => {
        expect(doc.id).toBe('pdf-del-bien-9');
        return 'https://storage.test/pdf-9';
      }),
      applyDocumentThumbnail
    });
    await generateDocumentThumbnail('bien-9', 'pdf-del-bien-9');
    expect(pdf.getPage).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(getViewport).toHaveBeenNthCalledWith(1, { scale: 1 });
    const desktopScale = Math.max(1040 / (612 * .80), 224 / (792 * .115));
    expect(getViewport.mock.calls[1][0].scale).toBeCloseTo(desktopScale, 5);
    expect(thumbnailCanvas.width).toBe(1040);
    expect(thumbnailCanvas.height).toBe(224);
    const renderOptions = render.mock.calls[0][0];
    expect(renderOptions.canvasContext).toBe(thumbnailContext);
    expect(renderOptions.background).toBe('#fff');
    expect(renderOptions.transform.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(renderOptions.transform[4]).toBeCloseTo((1040 - 612 * .80 * desktopScale) / 2 - 612 * .10 * desktopScale, 5);
    expect(renderOptions.transform[5]).toBeCloseTo((224 - 792 * .115 * desktopScale) / 2 - 792 * .085 * desktopScale, 5);
    expect(state.thumbnailCache.get('pdf-del-bien-9').src).toBe('data:image/jpeg;base64,miniatura');
    expect(applyDocumentThumbnail).toHaveBeenCalledWith('bien-9', documentRecord, 'data:image/jpeg;base64,miniatura');

    state.thumbnailCache.clear();
    visual.clientWidth = 320;
    getViewport.mockClear();
    render.mockClear();
    await generateDocumentThumbnail('bien-9', 'pdf-del-bien-9');
    expect(thumbnailCanvas.width).toBe(640);
    expect(thumbnailCanvas.height).toBe(224);
    const mobileScale = Math.max(640 / (612 * .80), 224 / (792 * .115));
    expect(getViewport.mock.calls[1][0].scale).toBeCloseTo(mobileScale, 5);
    expect(render.mock.calls[0][0].transform[4]).toBeCloseTo((640 - 612 * .80 * mobileScale) / 2 - 612 * .10 * mobileScale, 5);
    expect(render.mock.calls[0][0].transform[5]).toBeCloseTo((224 - 792 * .115 * mobileScale) / 2 - 792 * .085 * mobileScale, 5);
    expect(moduleSource).toContain('state.thumbnailActive<2');
    expect(moduleSource).toContain("rootMargin:'320px 0px'");
    expect(moduleSource).toContain("if(showSuccess){setQuickCardState(bienId,'success');refreshCardThumbnail(bienId)");
    expect(moduleSource).toContain('previousRemoved=true;invalidateDocumentThumbnail(previous)');
  });
  test('versiona documentos y permite actualizar clasificación solo con permiso de edición', () => {
    expect(moduleSource).toContain('duplicateDecision');
    expect(moduleSource).toContain("choice==='replace'");
    expect(moduleSource).toContain("'REEMPLAZAR_DOCUMENTO'");
    expect(documentUpgrade).toContain('ADD COLUMN IF NOT EXISTS version');
    expect(documentUpgrade).toContain('ADD COLUMN IF NOT EXISTS uploader_email');
    expect(documentUpgrade).toContain('mb_doc_file_update');
    expect(documentUpgrade).toContain("IN ('admin','edit')");
  });
  test('aplica RLS por niveles y restringe eliminación definitiva', () => {
    expect(migration).toContain("public.mb_access_level()='admin'");
    expect(migration).toContain("IN ('admin','edit','capture')");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
  });
  test('la importación conserva totales y no inventa series', () => {
    expect(audit.physicalUnits).toBe(613);
    expect(audit.databaseRows).toBe(573);
    expect(audit.individualRows).toBe(566);
    expect(audit.lotRows).toBe(7);
    expect(audit.explicitSerials).toBe(566);
    expect(audit.duplicateSerials).toEqual([]);
  });
  test('audita PDFs duplicados y asociaciones pendientes', () => {
    expect(docsAudit.physicalFiles).toBe(49);
    expect(docsAudit.uniqueFiles).toBe(46);
    expect(docsAudit.exactDuplicates).toHaveLength(3);
    expect(docsAudit.pendingFiles).toBeGreaterThan(0);
    expect(uploader).toContain("file.association === 'exact_folio'");
    expect(uploader).toContain("file.association === 'exact_serial'");
    expect(uploader).toContain('pendingExcluded: report.pendingFiles');
    expect(uploader).toContain("upsert(links, { onConflict: 'bien_id,documento_id'");
    expect(moduleSource).toContain('async function bulkImportDocuments(files)');
    expect(moduleSource).toContain("crypto.subtle.digest('SHA-256'");
    expect(moduleSource).toContain('El nombre no contiene un folio DO-CA/CA-EC ni una serie reconocible.');
    expect(moduleSource).toContain("if(goods.length)return{criterion:'folio'");
    expect(moduleSource).toContain('if(goods.length===1)');
    expect(moduleSource).toContain('se requiere una coincidencia única.');
    expect(moduleSource).toContain('id="mb-import-pending-body"');
    expect(moduleSource).toContain('showPendingImports(summary.pending)');
  });

  test('la importación relaciona un folio exacto con todos sus bienes y explica pendientes', () => {
    const start = moduleSource.indexOf('function documentTargets(');
    const end = moduleSource.indexOf('function showPendingImports(', start);
    const state = { all: [
      { id: 'bien-1', resguardo_folio: 'DO/CA/0710' },
      { id: 'bien-2', resguardo_folio: 'do/ca/0710' },
      { id: 'bien-3', numero_serie: 'C1ABC123' },
      { id: 'bien-4', numero_serie: 'C1ABC123' }
    ] };
    const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const documentTargets = new Function('state', 'norm', `${moduleSource.slice(start, end)}; return documentTargets;`)(state, norm);
    const shared = documentTargets('resguardo DO-CA-0710.pdf');
    expect(shared.criterion).toBe('folio');
    expect(shared.goods.map(item => item.id)).toEqual(['bien-1','bien-2']);
    const missing = documentTargets('resguardo DO-CA-0999.pdf');
    expect(missing.goods).toEqual([]);
    expect(missing.reason).toContain('DO/CA/0999');
    const ambiguousSerial = documentTargets('equipo C1ABC123.pdf');
    expect(ambiguousSerial.goods).toEqual([]);
    expect(ambiguousSerial.reason).toContain('coincide con 2 bienes');
  });

  test('calcula disponibilidad desde los campos reales y normaliza variantes', () => {
    const start = moduleSource.indexOf('const norm =');
    const end = moduleSource.indexOf('function ensureUI()', start);
    const getAvailability = new Function(`${moduleSource.slice(start, end)}; return { isAvailable, qty };`);
    const { isAvailable, qty } = getAvailability();
    const aerialNote = 'NOTA: Disponibles: 2. Series 24002778 y 24002779. Instalados: 1, serie 24002780.';
    const importedCases = [
      { cantidad: 54, area_responsable: ' DISPONIBLE ' },
      { cantidad: 3, area_responsable: '----', numero_economico: 'Disponible' },
      { cantidad: 8, observaciones: 'Disponibles.' },
      { cantidad: 8, observaciones: 'DISPONIBLES' },
      { cantidad: 2, observaciones: 'Disponibles.' },
      { cantidad: 2, observaciones: 'Disponibles.' },
      { cantidad: 3, observaciones: 'Disponibles 2 nuevos y 1 usado.' },
      { cantidad: 1, numero_serie: '24002778', observaciones: aerialNote },
      { cantidad: 1, numero_serie: '24002779', observaciones: aerialNote },
      { cantidad: 1, numero_serie: '24002780', observaciones: aerialNote }
    ];
    expect(importedCases.filter(isAvailable).reduce((total, row) => total + qty(row), 0)).toBe(82);
    expect(isAvailable({ area_responsable: 'No disponible' })).toBe(false);
    expect(isAvailable({ observaciones: 'Equipo instalado y en uso.' })).toBe(false);
    expect(isAvailable(importedCases.at(-1))).toBe(false);
  });

  test('reemplaza únicamente después de auditar y recupera el documento anterior', async () => {
    const uploadStart = moduleSource.indexOf('async function uploadDocumentSafe(options={})');
    const uploadEnd = moduleSource.indexOf('function historyActionLabel(', uploadStart);
    const upload = moduleSource.slice(uploadStart, uploadEnd);
    expect(upload.indexOf('await insertDocumentHistory(')).toBeGreaterThan(0);
    expect(upload.indexOf('await removeDocumentLink(sb,previous')).toBeGreaterThan(upload.indexOf('await insertDocumentHistory('));
    expect(upload).toContain('rollbackNewDocument(sb,created,uploadedPath');

    const helperStart = moduleSource.indexOf('function documentRecord(');
    const helperEnd = moduleSource.indexOf('function validateFile(', helperStart);
    const helpers = new Function('BUCKET', `${moduleSource.slice(helperStart, helperEnd)}; return { removeDocumentLink };`)('muebles-bienes-documentos');
    const events = [];
    const deleteChain = result => ({ eq() { return { eq: async () => result, then: (resolve) => resolve(result) }; } });
    const sb = {
      from(table) {
        if (table === 'muebles_bienes_documentos') return {
          select: () => ({ eq: async () => ({ count: 1, error: null }) }),
          delete: () => { events.push('desvincular'); return deleteChain({ error: null }); },
          upsert: async () => { events.push('restaurar-relación'); return { error: null }; }
        };
        return {
          delete: () => ({ eq: async () => { events.push('eliminar-metadatos'); return { error: null }; } }),
          upsert: async () => { events.push('restaurar-metadatos'); return { error: null }; }
        };
      },
      storage: {
        from: () => ({
          download: async () => { events.push('respaldar-archivo'); return { data: new Blob(['pdf']), error: null }; },
          remove: async () => { events.push('eliminar-archivo'); return { error: new Error('fallo de almacenamiento') }; },
          upload: async () => { events.push('restaurar-archivo'); return { error: null }; }
        })
      }
    };
    await expect(helpers.removeDocumentLink(sb, {
      id: 'doc-anterior', tipo_documento: 'Resguardo', nombre_original: 'anterior.pdf',
      storage_path: 'bien/anterior.pdf', mime_type: 'application/pdf', tamano_bytes: 100, version: 1
    }, 'bien-1')).rejects.toThrow('fallo de almacenamiento');
    expect(events).toEqual([
      'respaldar-archivo','desvincular','eliminar-metadatos','eliminar-archivo',
      'restaurar-archivo','restaurar-metadatos','restaurar-relación'
    ]);
  });

  test('desbloquea antes de cerrar el modal y siempre restablece controles', () => {
    const start = moduleSource.indexOf('async function uploadDocumentSafe(options={})');
    const end = moduleSource.indexOf('function historyActionLabel(', start);
    const upload = moduleSource.slice(start, end);
    expect(upload).toMatch(/setUploadState\(false\);\s*if\(!quick\)\{bootstrap\.Modal\.getInstance\(\$\('mb-doc-modal'\)\)\?\.hide\(\)/);
    expect(upload).toContain("bootstrap.Modal.getInstance($('mb-detail-modal'))?.hide()");
    expect(upload).toMatch(/finally \{\s*setUploadState\(false\)/);
    expect(moduleSource).toContain("if(state.uploading){event.preventDefault()");
  });

  test('evita desbordamiento, texto corrupto y múltiples filas por hash', () => {
    expect(moduleSource).toContain('class="content-section container-fluid"');
    expect(moduleSource).not.toMatch(/#muebles-bienes-section[^}]*overflow-x\s*:\s*hidden/);
    expect(moduleSource).not.toMatch(/Ã|Â|â/);
    expect(moduleSource).toContain(".eq('sha256',hash).order('version',{ascending:false}).order('created_at',{ascending:false}).limit(1).maybeSingle()");
    expect(moduleSource).toContain('doc=batchDocs.get(hash)||null');
    expect(moduleSource).toContain('if(doc){summary.duplicates++;}');
  });

  test('rechaza archivos inválidos y conserva nombres largos o especiales de forma segura', () => {
    const validationStart = moduleSource.indexOf('function validateFile(');
    const validationEnd = moduleSource.indexOf('async function validateReadablePdf(', validationStart);
    const validateFile = new Function('MAX_PDF', `${moduleSource.slice(validationStart, validationEnd)}; return validateFile;`)(10 * 1024 * 1024);
    expect(() => validateFile({ name: 'válido.pdf', type: 'application/pdf', size: 100 })).not.toThrow();
    expect(() => validateFile({ name: 'sin-mime.pdf', type: '', size: 100 })).not.toThrow();
    expect(() => validateFile({ name: 'binario.pdf', type: 'application/octet-stream', size: 100 })).not.toThrow();
    expect(() => validateFile({ name: 'renombrado.pdf', type: 'text/plain', size: 100 })).toThrow('PDF válido');
    expect(() => validateFile({ name: 'documento.txt', type: 'application/pdf', size: 100 })).toThrow('extensión .pdf');
    expect(() => validateFile({ name: 'vacío.pdf', type: 'application/pdf', size: 0 })).toThrow('vacío');
    expect(() => validateFile({ name: 'grande.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 })).toThrow('10 MB');

    const safeStart = moduleSource.indexOf('function safePath(');
    const safeEnd = moduleSource.indexOf('function setUploadState(', safeStart);
    const safePath = new Function(`${moduleSource.slice(safeStart, safeEnd)}; return safePath;`)();
    expect(safePath('Resguardo número 10, área técnica #1.pdf')).toBe('Resguardo_numero_10_area_tecnica_1.pdf');
    expect(safePath('📄.pdf')).toBe('archivo.pdf');
    const longName = safePath(`${'área con espacios y símbolos # '.repeat(20)}documento.pdf`);
    expect(longName.length).toBeLessThanOrEqual(180);
    expect(longName).toMatch(/\.pdf$/i);
  });

  test('valida que el PDF sea estructuralmente legible y no sólo tenga cabecera', async () => {
    const start = moduleSource.indexOf('async function validateReadablePdf(');
    const end = moduleSource.indexOf('async function validateSelectedFile(', start);
    const buildValidator = deps => new Function('deps', `
      const state=deps.state, window=deps.window, console=deps.console, hasPdfHeader=deps.hasPdfHeader;
      ${moduleSource.slice(start, end)}
      return validateReadablePdf;
    `)(deps);
    const file = { name: 'válido.pdf', arrayBuffer: async () => new ArrayBuffer(20) };
    const getDocument = jest.fn(() => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }), destroy: async () => {} }) }));
    const validator = buildValidator({
      state: { validatedPdfs: new WeakSet() }, window: { pdfjsLib: { getDocument } },
      console: { warn: jest.fn() }, hasPdfHeader: async () => true
    });
    await expect(validator(file)).resolves.toBe(true);
    await expect(validator(file)).resolves.toBe(true);
    expect(getDocument).toHaveBeenCalledTimes(1);

    const damaged = buildValidator({
      state: { validatedPdfs: new WeakSet() },
      window: { pdfjsLib: { getDocument: () => ({ promise: Promise.reject(new Error('xref inválido')), destroy: async () => {} }) } },
      console: { warn: jest.fn() }, hasPdfHeader: async () => true
    });
    await expect(damaged({ name: 'dañado.pdf', arrayBuffer: async () => new ArrayBuffer(20) })).rejects.toThrow('dañado o no es un PDF legible');
    const damagedContent = buildValidator({
      state: { validatedPdfs: new WeakSet() },
      window: { pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }), getOperatorList: async () => { throw new Error('stream inválido'); } }), destroy: async () => {} }) }) } },
      console: { warn: jest.fn() }, hasPdfHeader: async () => true
    });
    await expect(damagedContent({ name: 'contenido-dañado.pdf', arrayBuffer: async () => new ArrayBuffer(20) })).rejects.toThrow('stream inválido');
    const fakeHeader = buildValidator({
      state: { validatedPdfs: new WeakSet() }, window: { pdfjsLib: { getDocument } },
      console: { warn: jest.fn() }, hasPdfHeader: async () => false
    });
    await expect(fakeHeader({ name: 'falso.pdf' })).rejects.toThrow('cabecera PDF válida');
  });

  test('verifica tamaño, hash y lectura del objeto después de subirlo', async () => {
    const start = moduleSource.indexOf('async function verifyStoredPdf(');
    const end = moduleSource.indexOf('function documentTargets(', start);
    const buildVerifier = deps => new Function('deps', `
      const BUCKET='muebles-bienes-documentos', sha256=deps.sha256, validateReadablePdf=deps.validateReadablePdf;
      ${moduleSource.slice(start, end)}
      return verifyStoredPdf;
    `)(deps);
    const stored = { size: 120 };
    const verifyReadable = jest.fn(async () => true);
    const verifier = buildVerifier({ sha256: async () => 'hash-correcto', validateReadablePdf: verifyReadable });
    const sb = { storage: { from: () => ({ download: async () => ({ data: stored, error: null }) }) } };
    await expect(verifier(sb, 'bien/documento.pdf', { name: 'documento.pdf', size: 120, hash: 'hash-correcto' })).resolves.toBe(true);
    expect(verifyReadable).toHaveBeenCalledWith(stored, 'documento.pdf');
    await expect(verifier(sb, 'bien/documento.pdf', { size: 121, hash: 'hash-correcto' })).rejects.toThrow('tamaño guardado');
    const wrongHash = buildVerifier({ sha256: async () => 'otro-hash', validateReadablePdf: verifyReadable });
    await expect(wrongHash(sb, 'bien/documento.pdf', { size: 120, hash: 'hash-correcto' })).rejects.toThrow('contenido guardado no coincide');
    const missing = { storage: { from: () => ({ download: async () => ({ data: null, error: new Error('404') }) }) } };
    await expect(verifier(missing, 'bien/inexistente.pdf')).rejects.toThrow('no se pudo verificar');
  });

  test('revierte relaciones, metadatos y almacenamiento ante un error parcial del lote', async () => {
    const start = moduleSource.indexOf('async function rollbackBulkImport(');
    const end = moduleSource.indexOf('async function bulkImportDocuments(', start);
    const rollbackBulkImport = new Function('BUCKET', `${moduleSource.slice(start, end)}; return rollbackBulkImport;`)('muebles-bienes-documentos');
    const events = [];
    const sb = {
      from(table) {
        if (table === 'muebles_bienes_documentos') return { delete: () => ({ eq: () => ({ in: async () => { events.push('relaciones'); return { error: null }; } }) }) };
        return { delete: () => ({ eq: async () => { events.push('metadatos'); return { error: null }; } }) };
      },
      storage: { from: () => ({ remove: async () => { events.push('almacenamiento'); return { error: null }; } }) }
    };
    await rollbackBulkImport(sb, { doc: { id: 'doc-nuevo' }, storagePath: 'ruta/doc.pdf', newBienIds: ['bien-1','bien-2'], created: true });
    expect(events).toEqual(['relaciones','metadatos','almacenamiento']);
    const protectedEvents = [];
    const protectedSb = {
      from(table) {
        if (table === 'muebles_bienes_documentos') return { delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }) };
        return { delete: () => ({ eq: async () => { protectedEvents.push('metadatos'); return { error: new Error('RLS') }; } }) };
      },
      storage: { from: () => ({ remove: async () => { protectedEvents.push('almacenamiento'); return { error: null }; } }) }
    };
    await expect(rollbackBulkImport(protectedSb, { doc: { id: 'doc-protegido' }, storagePath: 'ruta/protegida.pdf', created: true })).rejects.toThrow('archivo físico se conservó');
    expect(protectedEvents).toEqual(['metadatos']);
    const bulkStart = moduleSource.indexOf('async function bulkImportDocuments(');
    const bulkEnd = moduleSource.indexOf('function safePath(', bulkStart);
    const bulk = moduleSource.slice(bulkStart, bulkEnd);
    expect(bulk.indexOf('await verifyStoredPdf(sb,storagePath')).toBeLessThan(bulk.indexOf(".from('muebles_bienes_documentos_archivos').insert"));
    expect(bulk.indexOf(".from('muebles_bienes_documentos_archivos').insert")).toBeLessThan(bulk.indexOf(".from('muebles_bienes_documentos').insert(links)"));
    expect(bulk).toContain('await rollbackBulkImport(sb');
    expect(bulk).toContain('Se conservarán sus documentos actuales');
    expect(bulk).toContain('state.docs.set(bienId,[...current,doc])');
  });

  test('la importación reutiliza el hash, continúa tras un archivo inválido y crea sólo relaciones faltantes', async () => {
    const start = moduleSource.indexOf('async function bulkImportDocuments(');
    const end = moduleSource.indexOf('function safePath(', start);
    const makeImporter = new Function('deps', `
      const canEdit=()=>true, $=deps.$, validateFile=deps.validateFile, sha256=deps.sha256;
      const validateReadablePdf=deps.validateReadablePdf, documentTargets=deps.documentTargets;
      const showPendingImports=deps.showPendingImports, verifyStoredPdf=deps.verifyStoredPdf;
      const existingTargetLinks=deps.existingTargetLinks, rollbackBulkImport=deps.rollbackBulkImport;
      const insertDocumentHistory=deps.insertDocumentHistory, referenciaBien=deps.referenciaBien;
      const safePath=value=>String(value), BUCKET='muebles-bienes-documentos';
      const window=deps.window, toast=deps.toast, load=deps.load, console=deps.console, state=deps.state;
      ${moduleSource.slice(start, end)}
      return bulkImportDocuments;
    `);
    const events = [], toasts = [];
    const hashQuery = {
      select() { return this; },
      eq(column, value) { events.push(['hash', column, value]); return this; },
      order(column, options) { events.push(['orden', column, options.ascending]); return this; },
      limit(value) { events.push(['límite', value]); return this; },
      async maybeSingle() { events.push(['selección', 'doc-v3']); return { data: { id: 'doc-v3', version: 3, storage_path: 'docs/v3.pdf', nombre_original: 'v3.pdf', tamano_bytes: 100, sha256: 'hash-repetido' }, error: null }; }
    };
    const sb = {
      auth: { getUser: async () => ({ data: { user: { id: 'usuario-1', email: 'usuario@aifa.test' } }, error: null }) },
      from(table) {
        if (table === 'muebles_bienes_documentos_archivos') return hashQuery;
        return { insert: async links => { events.push(['relación', links[0].bien_id, links[0].documento_id]); return { error: null }; } };
      },
      storage: { from: () => ({ upload: async () => { throw new Error('no debe volver a subir el duplicado'); } }) }
    };
    const controls = {
      'mb-import-pdfs': { disabled: false, innerHTML: '' },
      'mb-import-files': { value: 'seleccionado' }
    };
    const importer = makeImporter({
      $: id => controls[id],
      validateFile: file => { if(file.name === 'invalido.txt')throw new Error('El archivo debe tener extensión .pdf.'); },
      sha256: async () => 'hash-repetido',
      validateReadablePdf: async () => true,
      documentTargets: name => ({ value: 'DO/CA/001', goods: [{ id: name.includes('002') ? 'bien-2' : 'bien-1', familia: 'Equipo KW' }] }),
      verifyStoredPdf: async (_sb, path) => events.push(['verificado', path]),
      existingTargetLinks: async () => new Set(),
      rollbackBulkImport: async (_sb, data) => events.push(['rollback', data.created]),
      insertDocumentHistory: async (_sb, _user, _action, bienId) => events.push(['auditoría', bienId]),
      referenciaBien: good => good.id,
      state: { loaded: true, docs: new Map() },
      window: { ensureSupabaseClient: async () => sb, confirm: () => true },
      toast: (message, type) => toasts.push({ message, type }),
      showPendingImports: jest.fn(),
      load: async () => events.push(['recarga']),
      console: { info: () => {}, error: () => {} }
    });
    await importer([
      { name: 'invalido.txt', type: 'text/plain', size: 100 },
      { name: 'DO-CA-001.pdf', type: 'application/pdf', size: 100 },
      { name: 'DO-CA-002.pdf', type: 'application/pdf', size: 100 }
    ]);
    expect(events).toContainEqual(['orden', 'version', false]);
    expect(events).toContainEqual(['orden', 'created_at', false]);
    expect(events).toContainEqual(['límite', 1]);
    expect(events).toContainEqual(['relación', 'bien-1', 'doc-v3']);
    expect(events).toContainEqual(['relación', 'bien-2', 'doc-v3']);
    expect(events.filter(event => event[0] === 'selección')).toHaveLength(1);
    expect(events.filter(event => event[0] === 'verificado')).toHaveLength(1);
    expect(toasts.at(-1).message).toContain('2 relación(es)');
    expect(toasts.at(-1).message).toContain('1 quedaron pendientes');
    expect(controls['mb-import-files'].value).toBe('');
  });
});
