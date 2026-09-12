/* Pantalla "Captura" del módulo de Aviación General / FBO.
 *
 * Da de alta un movimiento y corrige uno existente. Es el mismo formulario para
 * las dos cosas: lo que cambia es si al guardar se hace INSERT o UPDATE. Tener
 * dos formularios parecidos es tener dos formularios que se separan, y acabar
 * con un campo que sólo se puede editar al capturar pero no al corregir.
 *
 * POR QUÉ EN UNA PESTAÑA Y NO EN UNA VENTANA EMERGENTE
 *
 *   Quien carga la bitácora del día mete veinte movimientos seguidos. Un modal
 *   obliga a abrir y cerrar veinte veces, y encima tapa la tabla que se está
 *   usando como referencia. En pestaña, "Guardar y capturar otro" deja el
 *   formulario listo conservando fecha y ámbito —lo que se repite— y limpiando
 *   matrícula, horas y pasajeros —lo que cambia—.
 *
 * VALIDACIÓN EN DOS TIEMPOS
 *
 *   Aquí se revisa con las mismas reglas del núcleo (core.js) para señalar el
 *   campo antes de gastar un viaje a la red. La base vuelve a revisarlo todo
 *   con sus CHECK: esta pantalla avisa, no autoriza.
 */
(function (root) {
    'use strict';

    const AG = root.AviacionGeneral;
    if (!AG) { console.error('[Aviación General] vista-captura: falta panel.js'); return; }

    const { Core, Datos, esc, aviso } = AG;

    const estado = { editando: null, guardando: false };
    let panelRef = null;

    const CAMPOS = [
        'folio_rotacion', 'fecha_operacion', 'tipo_operacion', 'ambito_operacion',
        'operador', 'matricula', 'tipo_aeronave', 'aeropuerto_origen_destino',
        'hora_programada', 'hora_real', 'adultos', 'infantes', 'pax_od',
        'estado', 'pais', 'observaciones'
    ];

    const id = (campo) => `ag-cap-${campo.replace(/_/g, '-')}`;

    function plantilla() {
        return `
        <form id="ag-cap-form" novalidate>
            <div class="ag-card mb-3">
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <h6 class="mb-0" id="ag-cap-titulo">Nuevo movimiento</h6>
                    <span class="badge bg-secondary d-none" id="ag-cap-chip-edicion"></span>
                </div>

                <div class="row g-3">
                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="${id('folio_rotacion')}">
                            Folio de rotación <span class="text-danger">*</span>
                        </label>
                        <input type="number" class="form-control form-control-sm" id="${id('folio_rotacion')}" min="0" step="1">
                        <div class="form-text" style="font-size:.7rem">Columna «No.» del Excel. Enlaza llegada y salida.</div>
                    </div>

                    <div class="col-6 col-md-3">
                        <label class="form-label small fw-bold" for="${id('fecha_operacion')}">
                            Fecha <span class="text-danger">*</span>
                        </label>
                        <input type="date" class="form-control form-control-sm" id="${id('fecha_operacion')}">
                    </div>

                    <div class="col-6 col-md-3">
                        <label class="form-label small fw-bold" for="${id('tipo_operacion')}">
                            Movimiento <span class="text-danger">*</span>
                        </label>
                        <select class="form-select form-select-sm" id="${id('tipo_operacion')}">
                            <option value="">Selecciona…</option>
                            <option value="LLEGADA">Llegada</option>
                            <option value="SALIDA">Salida</option>
                        </select>
                    </div>

                    <div class="col-6 col-md-4">
                        <label class="form-label small fw-bold" for="${id('ambito_operacion')}">
                            Ámbito <span class="text-danger">*</span>
                        </label>
                        <select class="form-select form-select-sm" id="${id('ambito_operacion')}">
                            <option value="">Selecciona…</option>
                            <option value="NACIONAL">Nacional</option>
                            <option value="INTERNACIONAL">Internacional</option>
                        </select>
                    </div>

                    <div class="col-12 col-md-6">
                        <label class="form-label small fw-bold" for="${id('operador')}">
                            Nombre del operador <span class="text-danger">*</span>
                        </label>
                        <input type="text" class="form-control form-control-sm" id="${id('operador')}"
                               list="ag-dl-operadores" placeholder="Persona, empresa u organismo" maxlength="200">
                    </div>

                    <div class="col-6 col-md-3">
                        <label class="form-label small fw-bold" for="${id('matricula')}">
                            Matrícula <span class="text-danger">*</span>
                        </label>
                        <input type="text" class="form-control form-control-sm text-uppercase" id="${id('matricula')}"
                               list="ag-dl-matriculas" placeholder="XA-ABC" maxlength="30">
                    </div>

                    <div class="col-6 col-md-3">
                        <label class="form-label small fw-bold" for="${id('tipo_aeronave')}">
                            Tipo de aeronave <span class="text-danger">*</span>
                        </label>
                        <input type="text" class="form-control form-control-sm text-uppercase" id="${id('tipo_aeronave')}"
                               list="ag-dl-aeronaves" placeholder="G650, C421, AW139" maxlength="30">
                    </div>

                    <div class="col-12 col-md-4">
                        <label class="form-label small fw-bold" for="${id('aeropuerto_origen_destino')}">
                            Origen / destino <span class="text-danger">*</span>
                        </label>
                        <input type="text" class="form-control form-control-sm text-uppercase" id="${id('aeropuerto_origen_destino')}"
                               list="ag-dl-aeropuertos" placeholder="MMTO" maxlength="10">
                        <div class="form-text" style="font-size:.7rem" id="ag-cap-pista-aeropuerto">
                            En llegada es el origen; en salida, el destino.
                        </div>
                    </div>

                    <div class="col-6 col-md-4">
                        <label class="form-label small fw-bold" for="${id('hora_programada')}">Hora programada</label>
                        <input type="time" class="form-control form-control-sm" id="${id('hora_programada')}">
                    </div>

                    <div class="col-6 col-md-4">
                        <label class="form-label small fw-bold" for="${id('hora_real')}">Hora real</label>
                        <input type="time" class="form-control form-control-sm" id="${id('hora_real')}">
                    </div>

                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="${id('adultos')}">Adultos</label>
                        <input type="number" class="form-control form-control-sm" id="${id('adultos')}"
                               min="0" step="1" placeholder="—">
                    </div>

                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="${id('infantes')}">Infantes</label>
                        <input type="number" class="form-control form-control-sm" id="${id('infantes')}"
                               min="0" step="1" placeholder="—">
                    </div>

                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="ag-cap-pax">Pax A.G.</label>
                        <input type="text" class="form-control form-control-sm bg-light fw-bold" id="ag-cap-pax" value="—" readonly tabindex="-1">
                        <div class="form-text" style="font-size:.7rem" id="ag-cap-pista-pax">
                            Lo calcula la base. Déjalo vacío si no se anotó.
                        </div>
                    </div>

                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="${id('pax_od')}">Pax O.D.</label>
                        <input type="number" class="form-control form-control-sm" id="${id('pax_od')}" min="0" step="1">
                    </div>

                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="${id('estado')}">Estado</label>
                        <input type="text" class="form-control form-control-sm" id="${id('estado')}" maxlength="100">
                    </div>

                    <div class="col-6 col-md-2">
                        <label class="form-label small fw-bold" for="${id('pais')}">País</label>
                        <input type="text" class="form-control form-control-sm" id="${id('pais')}" maxlength="100">
                    </div>

                    <div class="col-12">
                        <label class="form-label small fw-bold" for="${id('observaciones')}">Observaciones</label>
                        <textarea class="form-control form-control-sm" id="${id('observaciones')}" rows="2"
                                  placeholder="Notas operativas del movimiento"></textarea>
                    </div>
                </div>

                <div id="ag-cap-errores" class="mt-3"></div>

                <div class="d-flex flex-wrap gap-2 mt-3 pt-3 border-top">
                    <button type="submit" class="btn btn-sm btn-info text-white fw-semibold" id="ag-cap-guardar">
                        <i class="fas fa-floppy-disk me-1"></i>Guardar
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-info fw-semibold" id="ag-cap-guardar-otro">
                        <i class="fas fa-plus me-1"></i>Guardar y capturar otro
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="ag-cap-limpiar">
                        <i class="fas fa-eraser me-1"></i>Limpiar
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger ms-auto d-none" id="ag-cap-cancelar">
                        <i class="fas fa-xmark me-1"></i>Cancelar edición
                    </button>
                </div>
            </div>
        </form>

        <div class="alert alert-secondary small d-none" id="ag-cap-sin-permiso">
            <i class="fas fa-lock me-1"></i>
            Tu nivel de acceso en este módulo es de sólo lectura: puedes consultar el histórico, pero no capturar.
        </div>`;
    }

    // ── Lectura y escritura del formulario ──────────────────────────────────

    function leerFormulario() {
        const v = (campo) => {
            const el = document.getElementById(id(campo));
            return el ? el.value : '';
        };
        return {
            folio_rotacion:            Core.normalizarEntero(v('folio_rotacion')),
            fecha_operacion:           v('fecha_operacion') || null,
            tipo_operacion:            Core.normalizarTipoOperacion(v('tipo_operacion')),
            ambito_operacion:          Core.normalizarAmbito(v('ambito_operacion')),
            operador:                  Core.textoONulo(v('operador')) || '',
            matricula:                 Core.normalizarMatricula(v('matricula')),
            tipo_aeronave:             Core.textoONulo(v('tipo_aeronave')) || '',
            aeropuerto_origen_destino: Core.textoONulo(v('aeropuerto_origen_destino')) || '',
            hora_programada:           Core.normalizarHora(v('hora_programada')),
            hora_real:                 Core.normalizarHora(v('hora_real')),
            adultos:                   Core.normalizarEntero(v('adultos'), { porOmision: 0, minimo: 0 }),
            infantes:                  Core.normalizarEntero(v('infantes'), { porOmision: 0, minimo: 0 }),
            pax_od:                    Core.normalizarEntero(v('pax_od')),
            estado:                    Core.textoONulo(v('estado')),
            pais:                      Core.textoONulo(v('pais')),
            observaciones:             Core.normalizarObservacion(v('observaciones'))
        };
    }

    function escribirFormulario(mov) {
        const m = mov || {};
        CAMPOS.forEach((campo) => {
            const el = document.getElementById(id(campo));
            if (!el) return;
            let valor = m[campo];
            if (campo === 'hora_programada' || campo === 'hora_real') {
                // <input type="time"> quiere HH:MM; la base guarda HH:MM:SS.
                valor = valor ? String(valor).slice(0, 5) : '';
            }
            el.value = valor === null || valor === undefined ? '' : valor;
        });
        // adultos e infantes se quedan VACÍOS si el movimiento no los traía.
        //
        // Antes se pre-llenaban con 0, y eso convertía cada captura en "viajaron
        // cero pasajeros" aunque quien capturaba sólo hubiera pasado de largo por
        // el campo. No es lo mismo que "no se anotó", que es como están 2,670 de
        // las filas del histórico. Si el vuelo iba vacío, se teclea el 0 a
        // propósito y queda dicho.
        actualizarPax();
        marcarCampos([]);
    }

    function actualizarPax() {
        const textoA = document.getElementById(id('adultos'))?.value ?? '';
        const textoI = document.getElementById(id('infantes'))?.value ?? '';
        const caja = document.getElementById('ag-cap-pax');
        if (!caja) return;
        // Los dos vacíos = no se anotó nada. Mostrar 0 ahí sugeriría que el dato
        // ya está capturado cuando no lo está.
        if (textoA === '' && textoI === '') { caja.value = '—'; return; }
        caja.value = Core.numero((Number(textoA) || 0) + (Number(textoI) || 0));
    }

    function marcarCampos(errores) {
        CAMPOS.forEach((campo) => {
            document.getElementById(id(campo))?.classList.remove('is-invalid');
        });
        (errores || []).forEach((e) => {
            document.getElementById(id(e.campo))?.classList.add('is-invalid');
        });
    }

    function pintarErrores(errores) {
        const caja = document.getElementById('ag-cap-errores');
        if (!caja) return;
        if (!errores.length) { caja.innerHTML = ''; return; }
        caja.innerHTML = `
            <div class="alert alert-danger py-2 mb-0">
                <div class="fw-bold small mb-1"><i class="fas fa-circle-exclamation me-1"></i>Revisa estos campos</div>
                <ul class="mb-0 small">${errores.map((e) => `<li>${esc(e.mensaje)}</li>`).join('')}</ul>
            </div>`;
    }

    // ── Modo edición ────────────────────────────────────────────────────────

    function entrarEnEdicion(mov) {
        estado.editando = mov;
        escribirFormulario(mov);
        document.getElementById('ag-cap-titulo').textContent = `Editando el movimiento #${mov.id}`;
        const chip = document.getElementById('ag-cap-chip-edicion');
        chip.className = 'badge bg-warning text-dark';
        chip.textContent = `versión ${mov.version || 1} · ${mov.estado_validacion || 'PENDIENTE'}`;
        document.getElementById('ag-cap-cancelar').classList.remove('d-none');
        document.getElementById('ag-cap-guardar-otro').classList.add('d-none');
    }

    function salirDeEdicion() {
        estado.editando = null;
        document.getElementById('ag-cap-titulo').textContent = 'Nuevo movimiento';
        document.getElementById('ag-cap-chip-edicion').className = 'badge bg-secondary d-none';
        document.getElementById('ag-cap-cancelar').classList.add('d-none');
        document.getElementById('ag-cap-guardar-otro').classList.remove('d-none');
        limpiar();
    }

    function limpiar(conservarContexto) {
        const anterior = leerFormulario();
        escribirFormulario({});
        if (conservarContexto) {
            // Lo que se repite renglón a renglón en una misma bitácora se queda;
            // lo que identifica al movimiento se va.
            const asigna = (campo, valor) => {
                const el = document.getElementById(id(campo));
                if (el && valor) el.value = valor;
            };
            asigna('fecha_operacion', anterior.fecha_operacion);
            asigna('ambito_operacion', anterior.ambito_operacion);
            asigna('folio_rotacion', anterior.folio_rotacion === null ? '' : String(anterior.folio_rotacion));
            document.getElementById(id('matricula'))?.focus();
        } else {
            document.getElementById(id('folio_rotacion'))?.focus();
        }
        pintarErrores([]);
    }

    // ── Guardado ────────────────────────────────────────────────────────────

    async function guardar(seguirCapturando) {
        if (estado.guardando) return;

        const mov = leerFormulario();
        const errores = Core.validarMovimiento(mov);
        marcarCampos(errores);
        pintarErrores(errores);
        if (errores.length) {
            aviso('Faltan datos obligatorios o hay valores que no se pueden interpretar.', 'warning');
            return;
        }

        estado.guardando = true;
        const boton = document.getElementById(seguirCapturando ? 'ag-cap-guardar-otro' : 'ag-cap-guardar');
        const textoOriginal = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Guardando…';

        try {
            const payload = Core.aPayload(mov);
            if (estado.editando) {
                await Datos.actualizar(estado.editando.id, payload);
                aviso(`Movimiento #${estado.editando.id} actualizado.`, 'success');
                salirDeEdicion();
            } else {
                const creado = await Datos.crear(payload);
                aviso(`Movimiento #${creado.id} guardado.`, 'success');
                limpiar(seguirCapturando);
            }
            AG.emit('datos:cambiaron');
            AG.recargarOpciones();
        } catch (error) {
            pintarErrores([{ campo: '', mensaje: error.message }]);
            aviso(error.message, 'error');
        } finally {
            estado.guardando = false;
            boton.disabled = false;
            boton.innerHTML = textoOriginal;
        }
    }

    AG.registrarVista({
        id: 'captura',
        etiqueta: 'Captura',
        icono: 'fa-keyboard',
        orden: 30,
        // Un lector no necesita ver un formulario que no puede usar.
        visible: () => AG.puedeCapturar(),

        async montar(panel) {
            panelRef = panel;
            panel.innerHTML = plantilla();

            if (!AG.puedeCapturar()) {
                panel.querySelector('#ag-cap-form').classList.add('d-none');
                panel.querySelector('#ag-cap-sin-permiso').classList.remove('d-none');
                return;
            }

            panel.querySelector('#ag-cap-form').addEventListener('submit', (e) => {
                e.preventDefault();
                guardar(false);
            });
            panel.querySelector('#ag-cap-guardar-otro').addEventListener('click', () => guardar(true));
            panel.querySelector('#ag-cap-limpiar').addEventListener('click', () => {
                if (estado.editando) salirDeEdicion(); else limpiar(false);
            });
            panel.querySelector('#ag-cap-cancelar').addEventListener('click', salirDeEdicion);

            [id('adultos'), id('infantes')].forEach((campoId) => {
                document.getElementById(campoId)?.addEventListener('input', actualizarPax);
            });

            // La pista cambia según el movimiento: en llegada ese aeropuerto es
            // el origen, en salida el destino. Es el error de captura más común
            // del módulo y decirlo en el momento cuesta una línea.
            document.getElementById(id('tipo_operacion'))?.addEventListener('change', (e) => {
                const pista = document.getElementById('ag-cap-pista-aeropuerto');
                if (!pista) return;
                pista.textContent = e.target.value === 'LLEGADA'
                    ? 'Llegada: captura el aeropuerto de ORIGEN.'
                    : e.target.value === 'SALIDA'
                        ? 'Salida: captura el aeropuerto de DESTINO.'
                        : 'En llegada es el origen; en salida, el destino.';
            });

            const hoy = new Date();
            document.getElementById(id('fecha_operacion')).value =
                Core.normalizarFecha(hoy) || '';
        },

        async refrescar() { /* el formulario no depende de los filtros */ }
    });

    // Editar desde la tabla de Movimientos: se trae la versión completa de la
    // base y no la fila de la tabla, que sólo carga las columnas del listado.
    AG.on('movimiento:editar', async (fila) => {
        if (!AG.puedeCapturar()) { aviso('No tienes permiso para editar movimientos.', 'warning'); return; }
        await AG.abrirVista('captura');
        try {
            const completo = await Datos.obtener(fila.id);
            if (!completo) { aviso('Ese movimiento ya no existe.', 'warning'); return; }
            entrarEnEdicion(completo);
            panelRef?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            aviso(error.message, 'error');
        }
    });

    AG.on('movimiento:nuevo', async () => {
        await AG.abrirVista('captura');
        salirDeEdicion();
    });
})(typeof window !== 'undefined' ? window : globalThis);
