/* Módulo estadístico — pantalla de administración de la clasificación.
 *
 * Administra public.estadistica_reglas_clasificacion (migración 036) y muestra
 * las operaciones que ninguna regla resuelve.
 *
 * SOBRE LOS PERMISOS
 *   Aquí se ocultan los botones de escritura cuando el nivel no alcanza, pero
 *   eso es comodidad, no seguridad: la política de RLS de la tabla exige
 *   estadistica_access_level(auth.uid()) = 'admin' para cualquier INSERT,
 *   UPDATE o DELETE. Forzar el DOM no sirve de nada.
 *
 * SOBRE EL HISTÓRICO
 *   Editar una regla cambia el pasado, porque la clasificación se resuelve por
 *   reglas y no está congelada en cada operación. Cuando lo que se quiere es
 *   cambiar el criterio A PARTIR DE una fecha, el botón "Reemplazar desde una
 *   fecha" cierra la regla vigente el día anterior y crea la nueva: así lo ya
 *   publicado se sigue reproduciendo igual. La pantalla lo dice en el momento
 *   de editar, no en un manual.
 */
(function () {
    'use strict';

    const Motor = window.EstadisticaMotor;
    if (!Motor) return;

    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[c]);

    const state = {
        reglas: [],
        aerolineas: [],
        serviciosCargados: false,
        sinClasificar: [],
        cargado: false,
        enlazado: false,
        modal: null
    };

    const Panel = () => window.EstadisticaPanel;
    const puedeAdministrar = () => !!Panel()?.puedeAdministrarReglas?.();

    async function getClient() {
        if (Panel()?.getClient) return Panel().getClient();
        return window.supabaseClient || (window.ensureSupabaseClient && await window.ensureSupabaseClient());
    }

    function error(mensaje) {
        Panel()?.mostrarError?.(mensaje);
    }

    function errorModal(mensaje) {
        const el = $('est-cla-modal-error');
        if (!el) return;
        if (!mensaje) { el.classList.add('d-none'); el.textContent = ''; return; }
        el.textContent = mensaje;
        el.classList.remove('d-none');
    }

    // ── Catálogos del formulario ─────────────────────────────────────────────
    async function cargarCatalogos() {
        const client = await getClient();
        if (!state.aerolineas.length) {
            const { data, error: err } = await client
                .from('conciliacion_catalogo_aerolineas')
                .select('id,name,iata,types,active')
                .order('name');
            if (err) throw err;
            state.aerolineas = data || [];
            const sel = $('est-cla-aerolinea');
            if (sel) {
                sel.innerHTML = '<option value="">— Cualquiera —</option>'
                    + state.aerolineas.map((a) =>
                        `<option value="${a.id}">${esc(a.name)}${a.iata ? ` (${esc(a.iata)})` : ''}</option>`).join('');
            }
        }
        if (!state.serviciosCargados) {
            const { data, error: err } = await client
                .from('flight_service_type')
                .select('codigo,descripcion,categoria,tipo_operacion')
                .order('codigo');
            if (err) throw err;
            const sel = $('est-cla-tipo-servicio');
            if (sel) {
                sel.innerHTML = '<option value="">— Cualquiera —</option>'
                    + (data || []).map((s) =>
                        `<option value="${esc(s.codigo)}">${esc(s.codigo)} — ${esc(s.descripcion)}</option>`).join('');
            }
            state.serviciosCargados = true;
        }
    }

    const nombreAerolinea = (id) => {
        const a = state.aerolineas.find((x) => String(x.id) === String(id));
        return a ? a.name : (id ? `#${id}` : null);
    };

    // ── Listado de reglas ────────────────────────────────────────────────────
    async function cargarReglas() {
        const client = await getClient();
        let consulta = client
            .from('estadistica_reglas_clasificacion')
            .select('id,activo,prioridad,aerolinea_id,aerolinea_texto,tipo_aeronave,tipo_servicio,'
                + 'segmento_aviacion,naturaleza_operacion,vigente_desde,vigente_hasta,observaciones,'
                + 'created_at,updated_at')
            .order('prioridad', { ascending: true })
            .order('id', { ascending: false })
            .limit(2000);
        if ($('est-cla-solo-activas')?.checked) consulta = consulta.eq('activo', true);
        const { data, error: err } = await consulta;
        if (err) throw err;
        state.reglas = data || [];
    }

    const criterios = (r) => {
        const partes = [];
        if (r.aerolinea_id) partes.push(`Aerolínea: ${nombreAerolinea(r.aerolinea_id)}`);
        if (r.aerolinea_texto) partes.push(`Aerolínea (texto): ${r.aerolinea_texto}`);
        if (r.tipo_aeronave) partes.push(`Aeronave: ${r.tipo_aeronave}`);
        if (r.tipo_servicio) partes.push(`Servicio: ${r.tipo_servicio}`);
        return partes.length ? partes.join(' · ') : 'Comodín (sin criterios)';
    };

    const vigencia = (r) => {
        if (!r.vigente_desde && !r.vigente_hasta) return 'Toda la historia';
        if (r.vigente_desde && !r.vigente_hasta) return `Desde ${r.vigente_desde}`;
        if (!r.vigente_desde && r.vigente_hasta) return `Hasta ${r.vigente_hasta}`;
        return `${r.vigente_desde} a ${r.vigente_hasta}`;
    };

    function pintarReglas() {
        const admin = puedeAdministrar();
        const columnas = [
            { titulo: 'Prio.', clave: 'prioridad', tipo: 'numero' },
            { titulo: 'Criterios', html: (r) => esc(criterios(r)) },
            {
                titulo: 'Resultado',
                html: (r) => `<span class="badge bg-primary-subtle text-primary-emphasis border">${esc(r.segmento_aviacion)}</span> `
                    + `<span class="badge bg-secondary-subtle text-secondary-emphasis border">${esc(r.naturaleza_operacion)}</span>`
            },
            { titulo: 'Vigencia', html: (r) => esc(vigencia(r)) },
            {
                titulo: 'Estado',
                html: (r) => r.activo
                    ? '<span class="badge bg-success-subtle text-success-emphasis border">Activa</span>'
                    : '<span class="badge bg-light text-muted border">Inactiva</span>'
            },
            { titulo: 'Observaciones', html: (r) => `<small class="text-muted">${esc(r.observaciones || '')}</small>` },
            {
                titulo: '',
                html: (r) => admin
                    ? `<div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary" data-est-regla-editar="${r.id}" title="Editar"><i class="fas fa-pen"></i></button>
                        <button class="btn btn-outline-secondary" data-est-regla-toggle="${r.id}" title="${r.activo ? 'Desactivar' : 'Activar'}">
                            <i class="fas ${r.activo ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></button>
                       </div>`
                    : ''
            }
        ];
        Panel()?.pintarTabla?.('est-cla-tabla', columnas, state.reglas, {
            vacio: 'No hay reglas. Mientras no exista ninguna, todas las operaciones quedan SIN CLASIFICAR.'
        });
        const conteo = $('est-cla-conteo');
        if (conteo) {
            const activas = state.reglas.filter((r) => r.activo).length;
            conteo.textContent = `${state.reglas.length} regla(s) · ${activas} activa(s)`;
        }
        $('est-cla-nueva')?.classList.toggle('d-none', !admin);
        $('est-cla-solo-lectura')?.classList.toggle('d-none', admin);
    }

    // ── Operaciones sin clasificar ───────────────────────────────────────────
    async function cargarSinClasificar() {
        const client = await getClient();
        const periodo = Panel()?.periodo?.() || {};
        if (!periodo.desde || !periodo.hasta) { state.sinClasificar = []; return; }
        const { data, error: err } = await client.rpc('estadistica_sin_clasificar', {
            p_desde: periodo.desde, p_hasta: periodo.hasta, p_limite: 300
        });
        if (err) throw err;
        state.sinClasificar = data || [];
    }

    function pintarSinClasificar() {
        const admin = puedeAdministrar();
        const columnas = [
            { titulo: 'Aerolínea', clave: 'aerolinea' },
            { titulo: 'Tipo de aeronave', clave: 'tipo_aeronave' },
            {
                titulo: 'Tipo de servicio',
                html: (f) => f.tipo_servicio
                    ? esc(`${f.tipo_servicio}${f.tipo_servicio_descripcion ? ` — ${f.tipo_servicio_descripcion}` : ''}`)
                    : '<span class="text-muted">sin dato</span>'
            },
            { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
            { titulo: 'Pasajeros', clave: 'pax_total', tipo: 'numero' },
            { titulo: 'Carga', clave: 'carga_total_kg', tipo: 'carga' },
            { titulo: 'Desde', clave: 'primera_fecha' },
            { titulo: 'Hasta', clave: 'ultima_fecha' },
            { titulo: 'Vuelo', clave: 'ejemplo_vuelo' },
            {
                titulo: '',
                html: (f, i) => admin
                    ? `<button class="btn btn-sm btn-outline-primary" data-est-crear-regla="${state.sinClasificar.indexOf(f)}">
                        <i class="fas fa-plus me-1"></i>Crear regla</button>`
                    : ''
            }
        ];
        Panel()?.pintarTabla?.('est-cla-sin-tabla', columnas, state.sinClasificar, {
            vacio: 'Todas las operaciones del periodo están clasificadas.'
        });

        const resumen = $('est-cla-sin-resumen');
        if (resumen) {
            const total = state.sinClasificar.reduce((acc, f) => acc + Number(f.operaciones || 0), 0);
            const periodo = Panel()?.periodo?.() || {};
            resumen.textContent = state.sinClasificar.length
                ? ` — ${Motor.fmtEntero(total)} operaciones en ${state.sinClasificar.length} combinaciones `
                  + `(${Motor.etiquetaRango(periodo.desde, periodo.hasta)})`
                : '';
        }
    }

    // ── Formulario ───────────────────────────────────────────────────────────
    function abrirModal(regla, precarga) {
        errorModal(null);
        $('est-cla-id').value = regla?.id || '';
        $('est-cla-aerolinea').value = regla?.aerolinea_id || precarga?.aerolinea_id || '';
        $('est-cla-aerolinea-texto').value = regla?.aerolinea_texto || precarga?.aerolinea_texto || '';
        $('est-cla-tipo-aeronave').value = regla?.tipo_aeronave || precarga?.tipo_aeronave || '';
        $('est-cla-tipo-servicio').value = regla?.tipo_servicio || precarga?.tipo_servicio || '';
        $('est-cla-segmento').value = regla?.segmento_aviacion || 'COMERCIAL';
        $('est-cla-naturaleza').value = regla?.naturaleza_operacion || 'PASAJEROS';
        $('est-cla-prioridad').value = regla?.prioridad ?? 100;
        $('est-cla-desde').value = regla?.vigente_desde || '';
        $('est-cla-hasta').value = regla?.vigente_hasta || '';
        $('est-cla-activo').checked = regla ? !!regla.activo : true;
        $('est-cla-observaciones').value = regla?.observaciones || '';

        const esEdicion = !!regla?.id;
        $('est-cla-modal-titulo').innerHTML = `<i class="fas fa-sitemap me-2"></i>${esEdicion ? 'Editar regla' : 'Nueva regla'}`;
        $('est-cla-reemplazar')?.classList.toggle('d-none', !esEdicion);
        $('est-cla-modal-aviso-historico')?.classList.toggle('d-none', !esEdicion);

        if (!state.modal && window.bootstrap) {
            state.modal = new window.bootstrap.Modal($('est-cla-modal'));
        }
        state.modal?.show();
    }

    function leerFormulario() {
        const texto = (id) => {
            const v = $(id)?.value;
            return v && String(v).trim() ? String(v).trim() : null;
        };
        return {
            activo: !!$('est-cla-activo')?.checked,
            prioridad: Number($('est-cla-prioridad')?.value || 100),
            aerolinea_id: $('est-cla-aerolinea')?.value ? Number($('est-cla-aerolinea').value) : null,
            aerolinea_texto: texto('est-cla-aerolinea-texto'),
            tipo_aeronave: texto('est-cla-tipo-aeronave'),
            tipo_servicio: texto('est-cla-tipo-servicio'),
            segmento_aviacion: $('est-cla-segmento')?.value,
            naturaleza_operacion: $('est-cla-naturaleza')?.value,
            vigente_desde: texto('est-cla-desde'),
            vigente_hasta: texto('est-cla-hasta'),
            observaciones: texto('est-cla-observaciones')
        };
    }

    // Misma comprobación que el CHECK de la tabla, para poder avisar antes de
    // ir al servidor y con un mensaje entendible.
    function validarFormulario(datos) {
        const sinCriterios = !datos.aerolinea_id && !datos.aerolinea_texto
            && !datos.tipo_aeronave && !datos.tipo_servicio;
        if (sinCriterios && datos.prioridad < 9000) {
            return 'Una regla sin ningún criterio clasificaría TODAS las operaciones. '
                + 'Si de verdad quieres un comodín, ponle prioridad 9000 o más para que sea la última en aplicarse.';
        }
        if (datos.vigente_desde && datos.vigente_hasta && datos.vigente_hasta < datos.vigente_desde) {
            return 'La vigencia está invertida: "hasta" es anterior a "desde".';
        }
        if (!Number.isFinite(datos.prioridad) || datos.prioridad < 0) {
            return 'La prioridad debe ser un número mayor o igual a cero.';
        }
        return null;
    }

    async function guardar() {
        const datos = leerFormulario();
        const problema = validarFormulario(datos);
        if (problema) { errorModal(problema); return; }

        const boton = $('est-cla-guardar');
        if (boton) boton.disabled = true;
        try {
            const client = await getClient();
            const id = $('est-cla-id')?.value;
            const { error: err } = id
                ? await client.from('estadistica_reglas_clasificacion').update(datos).eq('id', Number(id))
                : await client.from('estadistica_reglas_clasificacion').insert(datos);
            if (err) throw err;
            state.modal?.hide();
            await recargar(true);
            avisarRefrescoPendiente();
        } catch (e) {
            console.error('No se pudo guardar la regla de clasificación:', e);
            errorModal(`No se pudo guardar: ${e?.message || e}. `
                + 'Si el mensaje habla de permisos, la administración de reglas está reservada al nivel admin.');
        } finally {
            if (boton) boton.disabled = false;
        }
    }

    // Cierra la regla vigente el día anterior y crea la nueva desde la fecha
    // elegida. Es la forma correcta de cambiar un criterio sin reescribir el
    // pasado.
    async function reemplazarDesdeFecha() {
        const id = $('est-cla-id')?.value;
        if (!id) return;
        const fecha = window.prompt(
            'La regla actual se cerrará el día anterior y la nueva empezará en la fecha que indiques.\n'
            + 'Las estadísticas anteriores a esa fecha no cambian.\n\nFecha de inicio (AAAA-MM-DD):',
            Motor.hoyIso()
        );
        if (!fecha) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { errorModal('La fecha debe tener el formato AAAA-MM-DD.'); return; }

        const datos = leerFormulario();
        const problema = validarFormulario(datos);
        if (problema) { errorModal(problema); return; }

        try {
            const client = await getClient();
            const cierre = Motor.sumarDias(fecha, -1);

            const { error: errCierre } = await client
                .from('estadistica_reglas_clasificacion')
                .update({ vigente_hasta: cierre })
                .eq('id', Number(id));
            if (errCierre) throw errCierre;

            const nueva = Object.assign({}, datos, {
                vigente_desde: fecha,
                vigente_hasta: null,
                activo: true,
                observaciones: `${datos.observaciones || ''}${datos.observaciones ? ' · ' : ''}Reemplaza a la regla #${id} desde ${fecha}.`
            });
            const { error: errAlta } = await client.from('estadistica_reglas_clasificacion').insert(nueva);
            if (errAlta) throw errAlta;

            state.modal?.hide();
            await recargar(true);
            avisarRefrescoPendiente();
        } catch (e) {
            console.error('No se pudo reemplazar la regla:', e);
            errorModal(`No se pudo reemplazar: ${e?.message || e}`);
        }
    }

    async function alternarActivo(id) {
        const regla = state.reglas.find((r) => String(r.id) === String(id));
        if (!regla) return;
        try {
            const client = await getClient();
            const { error: err } = await client
                .from('estadistica_reglas_clasificacion')
                .update({ activo: !regla.activo })
                .eq('id', regla.id);
            if (err) throw err;
            await recargar(true);
            avisarRefrescoPendiente();
        } catch (e) {
            console.error('No se pudo cambiar el estado de la regla:', e);
            error(`No se pudo cambiar el estado de la regla: ${e?.message || e}`);
        }
    }

    // Las reglas se aplican sobre la vista materializada: hasta que se refresca,
    // las cifras siguen mostrando la clasificación anterior. Decirlo evita que
    // alguien crea que la regla no funcionó.
    function avisarRefrescoPendiente() {
        error('Regla guardada. Las cifras se actualizarán al refrescar la estadística '
            + '(botón de recarga en la barra de filtros) o en el refresco automático.');
    }

    // ── Ciclo de vida ────────────────────────────────────────────────────────
    function enlazar() {
        if (state.enlazado) return;
        state.enlazado = true;

        $('est-cla-nueva')?.addEventListener('click', async () => {
            await cargarCatalogos();
            abrirModal(null, null);
        });
        $('est-cla-guardar')?.addEventListener('click', guardar);
        $('est-cla-reemplazar')?.addEventListener('click', reemplazarDesdeFecha);
        $('est-cla-solo-activas')?.addEventListener('change', () => recargar(true));

        $('est-cla-tabla')?.addEventListener('click', async (e) => {
            const editar = e.target.closest('[data-est-regla-editar]');
            if (editar) {
                await cargarCatalogos();
                const regla = state.reglas.find((r) => String(r.id) === editar.dataset.estReglaEditar);
                if (regla) abrirModal(regla, null);
                return;
            }
            const toggle = e.target.closest('[data-est-regla-toggle]');
            if (toggle) alternarActivo(toggle.dataset.estReglaToggle);
        });

        $('est-cla-sin-tabla')?.addEventListener('click', async (e) => {
            const boton = e.target.closest('[data-est-crear-regla]');
            if (!boton) return;
            const fila = state.sinClasificar[Number(boton.dataset.estCrearRegla)];
            if (!fila) return;
            await cargarCatalogos();
            abrirModal(null, {
                aerolinea_id: fila.aerolinea_id || '',
                // Si la operación no resolvió el catálogo, se precarga el texto
                // crudo para que la regla igual pueda alcanzarla.
                aerolinea_texto: fila.aerolinea_id ? '' : (fila.aerolinea || ''),
                tipo_aeronave: fila.tipo_aeronave || '',
                tipo_servicio: fila.tipo_servicio || ''
            });
        });
    }

    async function recargar(forzar) {
        if (state.cargado && !forzar) return;
        try {
            await cargarCatalogos();
            await Promise.all([cargarReglas(), cargarSinClasificar()]);
            pintarReglas();
            pintarSinClasificar();
            state.cargado = true;
        } catch (e) {
            console.error('No se pudo cargar la pantalla de clasificación:', e);
            error(`No se pudo cargar la clasificación: ${e?.message || e}`);
        }
    }

    window.EstadisticaClasificacion = {
        mostrar: (forzar) => { enlazar(); return recargar(!!forzar); },
        invalidar: () => { state.cargado = false; }
    };

    document.addEventListener('DOMContentLoaded', enlazar);
})();
