/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const itinerarySource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'parte-ops-flights.js'), 'utf8');
const rbacMigration = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '016_conciliacion_manifiestos_rbac.sql'),
  'utf8'
);
const historyMigration = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '017_conciliacion_manifiestos_historial_no_block.sql'),
  'utf8'
);

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('No se encontro el bloque solicitado.');
  return source.slice(start, end);
}

describe('captura de celdas en Conciliacion > Manifiestos', () => {
  test('codigo de demora admite hasta cinco selecciones unicas y concatena sus descripciones', () => {
    const helpersSource = sourceBetween(
      'function _conciDemoraOptionDescription',
      'function _conciNormalizeManifestType'
    );
    const helpers = new Function(
      `${helpersSource}; return { _conciParseDemoraCodes, _conciDemoraDescriptionsForCodes };`
    )();
    const codes = helpers._conciParseDemoraCodes('01, 02; 01 | 03\n04, 05');
    expect(codes).toEqual(['01', '02', '03', '04', '05']);
    expect(helpers._conciDemoraDescriptionsForCodes(codes, [
      { codigo: '01', titulo: 'Clima' },
      { codigo: '02', titulo: 'Tripulación' },
      { codigo: '03', titulo: 'Equipaje' },
      { codigo: '04', titulo: 'Mantenimiento' },
      { codigo: '05', titulo: 'Tráfico' },
    ])).toBe('Clima; Tripulación; Equipaje; Mantenimiento; Tráfico');
  });

  test('al quitar todos los codigos la descripcion de demora queda vacia', () => {
    const helpersSource = sourceBetween(
      'function _conciDemoraOptionDescription',
      'function _conciNormalizeManifestType'
    );
    const descriptions = new Function(
      `${helpersSource}; return _conciDemoraDescriptionsForCodes;`
    )();
    expect(descriptions([], [{ codigo: '01', titulo: 'Clima' }])).toBe('');
  });

  test.each([
    '_conciInitLiveCollab',
    '_conciSetPresenceCell',
    '_conciBeginCellPresence',
    '_conciBroadcastCellInput',
    '_conciHandlePresenceSync',
    '_conciApplyRemotePresenceHighlights',
    '_conciCellStillClaimed',
    // Pintor único de los cursores ajenos: si aparece dos veces, alguien volvió
    // a partir el resaltado entre presencia y broadcast, que es justo lo que
    // hacía que el recuadro no se viera.
    '_conciRepintarFocos',
    '_conciHandleRemoteCellInput',
    '_conciHandleRemoteTableChange',
    '_conciMaybeApplyDeferredRemoteRefresh',
  ])('%s conserva su definicion', (functionName) => {
    const declaration = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`, 'g');
    expect(source.match(declaration)).toHaveLength(1);
  });

  test('los selectores de colaboracion admiten ids y columnas con espacios', () => {
    const findSource = sourceBetween(
      'function _conciFindLiveCell',
      'function _conciHandleRemoteCellInput'
    );
    const findLiveCell = new Function(
      findSource + '; return _conciFindLiveCell;'
    )();
    document.body.innerHTML = [
      '<table><tbody>',
      '<tr data-row-id="vuelo 42/[A]"><td data-col="HR. DE OPERACIÓN / SLOT"></td></tr>',
      '</tbody></table>',
    ].join('');

    const tbody = document.querySelector('tbody');
    const cell = document.querySelector('td');
    expect(findLiveCell(tbody, 'vuelo 42/[A]', 'HR. DE OPERACIÓN / SLOT')).toBe(cell);
    expect(findLiveCell(tbody, 'vuelo inexistente', 'HR. DE OPERACIÓN / SLOT')).toBeNull();
  });

  test('las celdas AERONAVE y de texto abren su editor sin bloquear la captura', () => {
    const activationSource = sourceBetween(
      'function _conciActivateCellEditor',
      'function _conciCommitCellRaw'
    );
    const beginPresence = jest.fn();
    const activateAircraft = jest.fn();
    const broadcastCellInput = jest.fn();
    const stageCellDraft = jest.fn();
    const queueAutoSave = jest.fn();
    const activateCell = new Function(
      '_conciIsMatriculaStatusColumn',
      '_conciIsProtectedEditColumn',
      '_conciIsCalculatedColumn',
      '_conciIsPassengerColumn',
      '_conciRowElementIsCargo',
      '_conciNormalizeEditableCellText',
      '_conciBeginCellPresence',
      '_conciIsOperationTypeColumn',
      '_conciActivateOperationTypeEditor',
      '_conciIsManifestTypeColumn',
      '_conciActivateManifestTypeEditor',
      '_conciIsRoutingColumn',
      '_conciActivateRoutingEditor',
      '_conciIsAeronaveColumn',
      '_conciActivateAeronaveEditor',
      '_conciColIsDate',
      '_conciColIsDateTime',
      '_conciRefreshMatriculaValidationForRow',
      '_conciUpdateSummaryLiveCell',
      '_conciRefreshCalculatedCellsForRow',
      '_conciBroadcastCellInput',
      '_conciStageCellDraft',
      '_conciQueueAutoSave',
      '_conciIsCodigoDemoraColumn',
      '_conciActivateDemoraCodeEditor',
      '_conciIsNumericCaptureColumn',
      '_conciSoloNumero',
      'document',
      activationSource + '; return _conciActivateCellEditor;'
    )(
      () => false,
      () => false,
      () => false,
      () => false,
      () => false,
      value => String(value || '').trim(),
      beginPresence,
      () => false,
      jest.fn(),
      () => false,
      jest.fn(),
      () => false,
      jest.fn(),
      column => column === 'AERONAVE',
      activateAircraft,
      () => false,
      () => false,
      jest.fn(),
      jest.fn(),
      jest.fn(),
      broadcastCellInput,
      stageCellDraft,
      queueAutoSave,
      () => false,
      jest.fn(),
      () => false,
      value => String(value ?? ''),
      document
    );

    const cell = document.createElement('td');
    cell.dataset.col = 'AERONAVE';
    cell.dataset.raw = 'A320';

    expect(() => activateCell(cell)).not.toThrow();
    expect(beginPresence).toHaveBeenCalledWith(cell);
    expect(activateAircraft).toHaveBeenCalledWith(cell, 'A320');

    const textCell = document.createElement('td');
    textCell.dataset.col = 'VUELO';
    textCell.dataset.raw = 'AM123';

    expect(() => activateCell(textCell)).not.toThrow();
    const input = textCell.querySelector('.conci-cell-input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('AM123');

    input.value = 'AM456';
    expect(() => input.dispatchEvent(new Event('input', { bubbles: true }))).not.toThrow();
    expect(stageCellDraft).toHaveBeenCalledWith(textCell, 'AM456');
    expect(queueAutoSave).toHaveBeenCalledWith(null);
    expect(broadcastCellInput).toHaveBeenCalledWith(textCell, 'AM456');
  });

  test('marca el borrador como pendiente desde el primer input, antes de perder el foco', () => {
    const draftSource = sourceBetween(
      'function _conciStageCellDraft',
      'function _conciQueueAutoSave'
    );
    const stageDraft = new Function(
      '_conciNormalizeEditableCellText',
      draftSource + '; return _conciStageCellDraft;'
    )(value => String(value ?? '').trim());
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.dataset.col = 'OBSERVACIONES';
    td.dataset.raw = 'anterior';
    td.dataset.origRaw = 'anterior';
    td.dataset.pendingRaw = 'anterior';
    tr.appendChild(td);

    stageDraft(td, 'nuevo valor');

    expect(td.dataset.pendingRaw).toBe('nuevo valor');
    expect(td.dataset.dirty).toBe('1');
    expect(tr.dataset.dirty).toBe('1');
  });

  test('agrupa la escritura mientras se captura y guarda sin cerrar el editor', () => {
    jest.useFakeTimers();
    const queueSource = sourceBetween(
      'const _CONCI_AUTOSAVE_INPUT_DELAY_MS',
      'function _conciActivateCellEditor'
    );
    const autoSave = jest.fn();
    const queue = new Function(
      '_conciEditMode', '_conciCanCurrentUserEdit', '_conciAutoSaveRow',
      'setTimeout', 'clearTimeout',
      queueSource + '; return _conciQueueAutoSave;'
    )(true, () => true, autoSave, setTimeout, clearTimeout);
    const tr = document.createElement('tr');
    document.body.appendChild(tr);

    queue(tr);
    queue(tr);
    jest.advanceTimersByTime(399);
    expect(autoSave).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(autoSave).toHaveBeenCalledWith(tr, { keepEditorsOpen: true });
    jest.useRealTimers();
  });

  test('capturista y editor pueden capturar respetando el nivel de Conciliacion', () => {
    const permissionSource = sourceBetween(
      'function _conciCurrentUserRole',
      'function _conciNormalizeEditableCellText'
    );
    const permissions = new Function(
      'window', 'sessionStorage', 'localStorage',
      permissionSource + '; return { canCapture: _conciCanCurrentUserEdit, canManage: _conciCanCurrentUserManage };'
    )(window, sessionStorage, localStorage);

    sessionStorage.setItem('user_role', 'capturista');
    window.dataManager = { userRole: 'lector' };
    window.sectionLevel = jest.fn(() => 'capture');
    expect(permissions.canCapture()).toBe(true);
    expect(permissions.canManage()).toBe(false);

    sessionStorage.setItem('user_role', 'editor');
    window.sectionLevel.mockReturnValue('capture');
    expect(permissions.canCapture()).toBe(true);
    expect(permissions.canManage()).toBe(false);

    window.sectionLevel.mockReturnValue('edit');
    expect(permissions.canCapture()).toBe(true);
    expect(permissions.canManage()).toBe(true);

    window.sectionLevel.mockReturnValue('read');
    expect(permissions.canCapture()).toBe(false);
    expect(permissions.canManage()).toBe(false);
  });

  test('la base limita escritura por aplicativo, seccion y rol', () => {
    expect(rbacMigration).toContain("v_role NOT IN ('capturista', 'editor')");
    expect(rbacMigration).toContain("v_permissions -> 'allowed_sections'");
    expect(rbacMigration).toContain("v_permissions -> 'section_levels' ->> 'conciliacion'");
    expect(rbacMigration).toContain('CREATE POLICY cm_insert_operaciones_capture');
    expect(rbacMigration).toContain('CREATE POLICY cm_update_operaciones_capture');
    expect(rbacMigration).toContain('CREATE POLICY cm_delete_operaciones_manage');
    expect(rbacMigration).toContain('CREATE POLICY cm_insert_portal_owner');
    expect(rbacMigration).toContain('CREATE POLICY cm_update_portal_reviewer');
    expect(rbacMigration).toContain('DROP POLICY IF EXISTS cm_update_authenticated');
    expect(rbacMigration).toContain('CREATE OR REPLACE FUNCTION public.admin_assign_operaciones_access');
    expect(rbacMigration).toContain('v_caller_authorized');
    expect(rbacMigration).toContain("lower(ua.rol) IN ('admin', 'superadmin')");
    expect(historyMigration).toContain('CREATE OR REPLACE FUNCTION public._conciliacion_manifiestos_log_change');
    expect(historyMigration).toContain('v_new := to_jsonb(NEW)');
    expect(historyMigration).not.toContain('hstore(NEW)');
    expect(historyMigration).toContain('EXCEPTION WHEN OTHERS');
  });

  test('una captura posterior no se marca como guardada por una escritura anterior', () => {
    const settleSource = sourceBetween(
      'function _conciSettleSavedCells',
      'async function _conciSaveVirtualAirlineOverride'
    );
    const settle = new Function(
      '_conciNormalizeEditableCellText',
      settleSource + '; return _conciSettleSavedCells;'
    )(value => String(value ?? '').trim());

    const tr = document.createElement('tr');
    const first = document.createElement('td');
    const second = document.createElement('td');
    first.dataset.col = 'TOTAL PAX';
    first.dataset.pendingRaw = '100';
    first.dataset.dirty = '1';
    second.dataset.col = 'OBSERVACIONES';
    second.dataset.pendingRaw = 'captura posterior';
    second.dataset.dirty = '1';
    tr.dataset.dirty = '1';
    tr.append(first, second);

    const valuesSentToDatabase = new Map([
      [first, '100'],
      [second, 'valor anterior'],
    ]);
    settle(tr, [first, second], valuesSentToDatabase, new Set(['TOTAL PAX', 'OBSERVACIONES']));

    expect(first.dataset.dirty).toBeUndefined();
    expect(second.dataset.dirty).toBe('1');
    expect(tr.dataset.dirty).toBe('1');
  });

  test('perder el foco no refresca ni borra una celda cuyo guardado sigue pendiente', () => {
    document.body.innerHTML = [
      '<table id="table-conci-manifiestos"><tbody>',
      '<tr data-dirty="1"><td data-dirty="1">CAPTURA SIN CONFIRMAR</td></tr>',
      '</tbody></table>',
    ].join('');
    const refreshSource = sourceBetween(
      'function _conciHandleRemoteTableChange',
      'function _conciActivateCellEditor'
    );
    let hasPendingEdits = true;
    const load = jest.fn();
    const renderCache = new Map([['old', {}]]);
    const realtime = new Function(
      '_conciPendingRemoteRefresh', '_conciHasPendingLocalEdits', '_conciRecargaYaCubierta',
      '_conciRenderCache', '_conciRenderedKey', 'loadConciliacionManifiestos', 'document',
      refreshSource
        + '; return { remote: _conciHandleRemoteTableChange, maybe: _conciMaybeApplyDeferredRemoteRefresh, pending: () => _conciPendingRemoteRefresh };'
    )(false, () => hasPendingEdits, () => false, renderCache, 'old', load, document);

    realtime.remote();

    expect(realtime.pending()).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(document.querySelector('td').textContent).toBe('CAPTURA SIN CONFIRMAR');
    expect(renderCache.size).toBe(1);

    hasPendingEdits = false;
    realtime.maybe();
    expect(load).toHaveBeenCalledWith({ forceRefresh: true, fromRemoteSync: true });
    expect(realtime.pending()).toBe(false);
  });

  test('detecta como pendiente una celda dirty aunque ya haya perdido el foco', () => {
    document.body.innerHTML = [
      '<table id="table-conci-manifiestos"><tbody>',
      '<tr data-dirty="1"><td data-dirty="1">123</td></tr>',
      '</tbody></table>',
    ].join('');
    const guardSource = sourceBetween(
      'function _conciHasPendingLocalEdits',
      '// ─── Colaboración en vivo'
    );
    const guard = new Function(
      '_conciPendingAutoSaveCount', '_conciPendingRemoteRefresh',
      '_conciDeferredRefreshNoticeAt', 'document', 'showNotification',
      guardSource
        + '; return { hasPending: _conciHasPendingLocalEdits, defer: _conciDeferRefreshForLocalEdits, refreshPending: () => _conciPendingRemoteRefresh };'
    )(0, false, 0, document, jest.fn());

    expect(guard.hasPending()).toBe(true);
    expect(guard.defer()).toBe(true);
    expect(guard.refreshPending()).toBe(true);

    document.querySelector('td').removeAttribute('data-dirty');
    document.querySelector('tr').removeAttribute('data-dirty');
    expect(guard.hasPending()).toBe(false);
  });

  test('al entrar a Conciliacion limpia filtros, caches y fechas anteriores', () => {
    document.body.innerHTML = [
      '<input id=filter-conci-fecha-desde>',
      '<input id=conci-date-picker value=2026-01-05>',
      '<input id=conci-date-end value=2026-01-09>',
    ].join('');
    const resetSource = sourceBetween(
      'function _conciResetModuleState',
      '// Fija los filtros Año/Mes/Día'
    );
    const renderCache = new Map([['old', {}]]);
    const summaryOverrides = new Map([['old', {}]]);
    const undoHistory = [{}];
    const clearFilters = jest.fn();
    const applyToday = jest.fn(() => {
      document.getElementById('filter-conci-fecha-desde').value = '2026-08-03';
    });
    const reset = new Function(
      '_conciLoadRequestSeq', '_conciRenderCache', '_conciRenderedKey', '_conciRawCache',
      '_conciVuelosCache', '_conciManifestColInfo', '_conciPendingRemoteRefresh',
      '_conciSummaryLiveOverrides', '_conciScopedCatalogColumnFilters', '_conciUndoHistory',
      '_conciClearAllTableFilters', '_conciApplyTodayFilters', '_conciEditMode',
      '_conciSetTableEditableState', '_conciRefreshEditToolbar',
      '_conciDeferRefreshForLocalEdits', 'document',
      resetSource + '; return _conciResetModuleState;'
    )(
      1, renderCache, 'old', {}, {}, {}, true, summaryOverrides, { airline: { old: 'x' } },
      undoHistory, clearFilters, applyToday, false, jest.fn(), jest.fn(), () => false, document
    );

    reset();

    expect(renderCache.size).toBe(0);
    expect(summaryOverrides.size).toBe(0);
    expect(undoHistory).toHaveLength(0);
    expect(clearFilters).toHaveBeenCalledTimes(1);
    expect(document.getElementById('conci-date-picker').value).toBe('2026-08-03');
    expect(document.getElementById('conci-date-end').value).toBe('');
    expect(itinerarySource).toContain('resetModuleState,');
    expect(itinerarySource).toContain('_flightProbeCache = null;');
    expect(source).toContain('loadConciliacionManifiestos({ forceRefresh: true })');
  });

  test('un guardado parcial conserva el DOM para corregir y reintentar', () => {
    const bulkSource = sourceBetween(
      'async function _conciSaveBulkEdits',
      '// ─────────────────────────────────────────────────────────────────────────────'
    );
    expect(bulkSource).toContain('Mantener el DOM y sus celdas dirty');
    expect(bulkSource).toMatch(/if \(fail\.length > 0\)[\s\S]*?_conciRefreshEditToolbar\(\);\s*return;/);
    // Un solo escritor por fila. El candado ya no cuelga del nodo <tr> —no
    // sobrevivía a un repintado del tbody y dejaba entrar una segunda
    // escritura— sino del registro por identidad de fila.
    expect(source).toMatch(
      /const escrituraPrevia = _conciEscriturasEnVuelo\.get\(claveFila\);\s*if \(escrituraPrevia\) \{\s*escrituraPrevia\.encolado = true;/
    );
    expect(source).toContain('_conciEscriturasEnVuelo.delete(claveFila);');
    expect(source).toContain('async function _conciAutoSaveRow(tr, options = {})');
    expect(source).toContain('if (!options.keepEditorsOpen)');
    // El reintento va sobre la fila VIVA: tras un repintado del tbody, el <tr>
    // que lanzó la escritura ya no es el que está en la tabla.
    expect(source).toContain('if (shouldRetry) _conciAutoSaveRow(filaViva, options);');
  });
});
