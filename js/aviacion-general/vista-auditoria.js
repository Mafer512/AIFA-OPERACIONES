/* Pantalla "Auditoría" del módulo de Aviación General / FBO.
 *
 * Lee public.aviacion_general_operaciones_auditoria, que guarda el estado
 * COMPLETO anterior y posterior de cada registro en cada cambio.
 *
 * LO QUE ESTA PANTALLA APORTA SOBRE LEER LA TABLA EN CRUDO
 *
 *   La tabla de auditoría guarda dos JSON enteros por evento. Puestos uno junto
 *   a otro son cuarenta campos de los que cambió uno, y encontrar cuál a simple
 *   vista es imposible. Aquí se comparan y se muestra ÚNICAMENTE lo que cambió,
 *   con el valor de antes tachado y el de después resaltado — que es la pregunta
 *   real: «XA-MAM pasó a XA-MAN, ¿quién y cuándo?».
 *
 * Columnas de la tabla, verificadas contra la base:
 *   id · registro_id · operacion · datos_anteriores · datos_nuevos ·
 *   realizado_por · fecha_evento
 *
 * Nota sobre la autoría: realizado_por guarda el UUID de auth. Mientras no
 * exista un catálogo de usuarios legible para este módulo se muestra abreviado,
 * en vez de inventar un nombre que podría no corresponder a quien hizo el
 * cambio.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-auditoria: falta panel.js'); return; }

    const { Core, Datos, esc, aviso, cargando, vacio } = AG;

    // Referencia al panel propio. Se guarda al montar porque el oyente de
    // "ver historial" se registra al CARGAR el archivo, no al montar: quien
    // pulsa ese botón en la tabla de Movimientos normalmente no ha abierto
    // nunca esta pestaña, y un oyente que sólo existiera después del montaje
    // dejaría muerto justo el primer clic.
    let panelRef = null;

    // Campos que no aportan al leer un cambio: son ruido de la propia auditoría.
    const CAMPOS_OCULTOS = new Set([
        'fecha_modificacion', 'modificado_por', 'version', 'fecha_creacion', 'creado_por'
    ]);

    const ETIQUETAS = {
        folio_rotacion: 'Folio de rotación', fecha_operacion: 'Fecha', tipo_operacion: 'Movimiento',
        ambito_operacion: 'Ámbito', operador: 'Operador', matricula: 'Matrícula',
        tipo_aeronave: 'Tipo de aeronave', aeropuerto_origen_destino: 'Origen / destino',
        hora_programada: 'Hora programada', hora_real: 'Hora real', adultos: 'Adultos',
        infantes: 'Infantes', pax_ag: 'Pax A.G.', pax_od: 'Pax O.D.', estado: 'Estado',
        pais: 'País', observaciones: 'Observaciones', estado_validacion: 'Validación',
        observacion_validacion: 'Comentario de validación', estatus_registro: 'Estatus',
        motivo_anulacion: 'Motivo de baja', movimiento_relacionado_id: 'Movimiento enlazado',
        tipo_fuente: 'Origen del dato', archivo_origen: 'Archivo de origen', fila_origen: 'Fila de origen'
    };

    const OPERACIONES = {
        INSERT: ['ag-aud--insert', 'fa-plus', 'Alta'],
        UPDATE: ['ag-aud--update', 'fa-pen', 'Modificación'],
        DELETE: ['ag-aud--delete', 'fa-trash', 'Baja']
    };

    function plantilla() {
        return `
        <div class="row g-3">
            <div class="col-12 col-lg-5">
                <div class="ag-card">
                    <h6>Historial de un movimiento</h6>
                    <div class="input-group input-group-sm mb-2">
                        <span class="input-group-text">#</span>
                        <input type="number" class="form-control" id="ag-aud-id"
                               placeholder="ID del movimiento" min="1" aria-label="ID del movimiento">
                        <button class="btn btn-outline-info" id="ag-aud-buscar">
                            <i class="fas fa-magnifying-glass"></i>
                        </button>
                    </div>
                    <div class="small text-muted" style="font-size:.72rem">
                        El ID aparece en la primera columna de la bandeja de Validación
                        y en el botón de historial de cada fila de Movimientos.
                    </div>
                    <div id="ag-aud-detalle" class="mt-3">
                        ${vacio('Busca un movimiento para ver todo lo que le ha pasado', 'fa-clock-rotate-left')}
                    </div>
                </div>
            </div>

            <div class="col-12 col-lg-7">
                <div class="ag-card">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <h6 class="mb-0">Actividad reciente del módulo</h6>
                        <button class="btn btn-sm btn-outline-secondary" id="ag-aud-recargar">
                            <i class="fas fa-rotate"></i>
                        </button>
                    </div>
                    <div id="ag-aud-reciente" style="max-height:62vh; overflow:auto"></div>
                </div>
            </div>
        </div>`;
    }

    // ── Comparación de dos estados ──────────────────────────────────────────

    function valorLegible(campo, valor) {
        if (valor === null || valor === undefined || valor === '') return '(vacío)';
        if (campo === 'fecha_operacion') return Core.fechaLarga(valor);
        if (campo === 'hora_programada' || campo === 'hora_real') return Core.horaCorta(valor);
        return String(valor);
    }

    /**
     * Devuelve sólo los campos que realmente cambiaron.
     *
     * La comparación es sobre el texto del valor: los dos JSON vienen de la
     * misma tabla, así que un 5 y un "5" son el mismo dato escrito distinto por
     * el serializador, no un cambio que alguien hizo.
     */
    function diferencias(antes, despues) {
        const a = antes || {};
        const d = despues || {};
        const campos = new Set([...Object.keys(a), ...Object.keys(d)]);
        const cambios = [];
        campos.forEach((campo) => {
            if (CAMPOS_OCULTOS.has(campo)) return;
            const va = a[campo] === null || a[campo] === undefined ? '' : String(a[campo]);
            const vd = d[campo] === null || d[campo] === undefined ? '' : String(d[campo]);
            if (va === vd) return;
            cambios.push({ campo, antes: a[campo], despues: d[campo] });
        });
        return cambios;
    }

    function fechaHora(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString('es-MX', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (_) { return String(iso); }
    }

    function autor(uuid) {
        if (!uuid) return 'sistema';
        return `usuario ${String(uuid).slice(0, 8)}`;
    }

    function eventoHTML(evento, conEnlace) {
        const [clase, icono, titulo] = OPERACIONES[evento.operacion] || ['', 'fa-circle', evento.operacion || 'Cambio'];
        const cambios = evento.operacion === 'INSERT'
            ? []
            : diferencias(evento.datos_anteriores, evento.datos_nuevos);

        const cuerpo = evento.operacion === 'INSERT'
            ? `<div class="ag-aud-diff">Se dio de alta el movimiento.</div>`
            : cambios.length
                ? `<div class="ag-aud-diff">${cambios.map((c) => `
                        <div>
                            <span class="fw-bold">${esc(ETIQUETAS[c.campo] || c.campo)}:</span>
                            <span class="ag-de">${esc(valorLegible(c.campo, c.antes))}</span>
                            <i class="fas fa-arrow-right-long mx-1 text-muted" style="font-size:.65rem"></i>
                            <span class="ag-a">${esc(valorLegible(c.campo, c.despues))}</span>
                        </div>`).join('')}</div>`
                : `<div class="ag-aud-diff text-muted">Sin cambios visibles en los campos operativos.</div>`;

        const referencia = conEnlace
            ? `<button class="btn btn-link btn-sm p-0 ms-1 align-baseline" data-ag-aud-id="${evento.registro_id}"
                   title="Ver el historial completo de este movimiento">#${evento.registro_id}</button>`
            : '';

        return `
        <div class="ag-aud-item ${clase}">
            <div class="d-flex flex-wrap align-items-center gap-2">
                <span class="fw-bold small"><i class="fas ${icono} me-1"></i>${esc(titulo)}</span>
                ${referencia}
                <span class="text-muted small ms-auto">${esc(fechaHora(evento.fecha_evento))}</span>
            </div>
            <div class="text-muted" style="font-size:.72rem">por ${esc(autor(evento.realizado_por))}</div>
            ${cuerpo}
        </div>`;
    }

    // ── Consultas ───────────────────────────────────────────────────────────

    async function verHistorial(panel, registroId) {
        const caja = panel.querySelector('#ag-aud-detalle');
        caja.innerHTML = cargando('Buscando el historial…');
        try {
            const eventos = await Datos.auditoriaDe(registroId);
            if (!eventos.length) {
                caja.innerHTML = vacio(`El movimiento #${registroId} no tiene cambios registrados`, 'fa-file-circle-question');
                return;
            }
            caja.innerHTML = `
                <div class="small fw-bold mb-2">
                    Movimiento #${esc(registroId)} · ${eventos.length} evento(s)
                </div>
                ${eventos.map((e) => eventoHTML(e, false)).join('')}`;
        } catch (error) {
            AG.pintarError(caja, error);
        }
    }

    async function cargarReciente(panel) {
        const caja = panel.querySelector('#ag-aud-reciente');
        caja.innerHTML = cargando('Cargando la actividad…');
        try {
            const eventos = await Datos.auditoriaReciente(150);
            caja.innerHTML = eventos.length
                ? eventos.map((e) => eventoHTML(e, true)).join('')
                : vacio('Todavía no hay actividad registrada en el módulo', 'fa-clock-rotate-left');
        } catch (error) {
            AG.pintarError(caja, error);
        }
    }

    AG.registrarVista({
        id: 'auditoria',
        etiqueta: 'Auditoría',
        icono: 'fa-clock-rotate-left',
        orden: 60,

        async montar(panel) {
            panelRef = panel;
            panel.innerHTML = plantilla();

            const buscar = () => {
                const id = Number(panel.querySelector('#ag-aud-id').value);
                if (!id) { aviso('Escribe el ID del movimiento.', 'warning'); return; }
                verHistorial(panel, id);
            };
            panel.querySelector('#ag-aud-buscar').addEventListener('click', buscar);
            panel.querySelector('#ag-aud-id').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); buscar(); }
            });
            panel.querySelector('#ag-aud-recargar').addEventListener('click', () => cargarReciente(panel));

            // Clic en el #id de la actividad reciente: trae ese historial al
            // panel de la izquierda, sin recargar nada más.
            panel.querySelector('#ag-aud-reciente').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-ag-aud-id]');
                if (!btn) return;
                panel.querySelector('#ag-aud-id').value = btn.dataset.agAudId;
                verHistorial(panel, Number(btn.dataset.agAudId));
            });
        },

        async refrescar(panel) { await cargarReciente(panel); }
    });

    // El botón de historial de cada fila de Movimientos entra por aquí.
    //
    // Se registra al cargar el archivo y no dentro de montar(): abrirVista()
    // monta esta pantalla si hacía falta, así que el oyente tiene que existir
    // ANTES de que se monte. Registrado dentro de montar(), el primer clic
    // —el único que importa, porque es el que abre la pestaña— se perdería.
    AG.on('movimiento:historial', async (fila) => {
        await AG.abrirVista('auditoria');
        if (!panelRef) return;
        const entrada = panelRef.querySelector('#ag-aud-id');
        if (entrada) entrada.value = fila.id;
        verHistorial(panelRef, fila.id);
    });
})(typeof window !== 'undefined' ? window : globalThis);
