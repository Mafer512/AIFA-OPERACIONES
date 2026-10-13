/* ==========================================================================
   Vista de Dirección General
   --------------------------------------------------------------------------
   Con el rol director_general el Inicio se vuelve una vista ejecutiva: el
   banner de cifras con sus seis tarjetas, los accesos directos de siempre y
   dos accesos más que llaman a las MISMAS funciones de su pantalla de origen,
   sin salir del Inicio:

     · Informe oficial → InformeEstadistico.descargarPdf: el PDF de
       Conciliación › Estadística › Informe oficial ("Dar visto bueno y
       generar PDF"), con el mismo armado, pero SIN registrar visto bueno.
       Antes se pregunta la fecha de corte y qué años van en las tablas
       (#modalDgInforme).
     · SWEAR → conciMensajeEnvio.abrir, la ventana del botón SWEAR de
       Conciliación › Manifiestos (vive en <body>, se abre encima del Inicio).

   No se muestran Subdirecciones ni las opciones del menú de usuario que este
   perfil no usa. Todo lo enciende la clase rol-director-general en <body>
   (estilos en director-general.css): para los demás roles nada cambia.
   ========================================================================== */
(function (root) {
    'use strict';

    const ROL = 'director_general';
    const CLASE = 'rol-director-general';
    const $ = (id) => document.getElementById(id);

    function rolDeSesion() {
        try { return root.sessionStorage.getItem('user_role') || ''; } catch (_) { return ''; }
    }

    const esDirector = (rol) => String(rol || '').trim().toLowerCase() === ROL;

    /* ── barra de accesos nuevos ─────────────────────────────────────────── */

    // Los accesos directos de siempre se quedan en su lugar y con su estilo;
    // la barra con el Informe oficial y SWEAR va justo después de ellos,
    // en el mismo renglón, y solo se muestra con este rol.
    function montarAccesos(activo) {
        const barra = $('dg-barra');
        if (barra) barra.hidden = !activo;
    }

    let avisoReloj = null;
    function avisar(texto, esError) {
        const estado = $('dg-barra-estado');
        if (!estado) return;
        clearTimeout(avisoReloj);
        estado.textContent = texto || '';
        estado.hidden = !texto;
        estado.classList.toggle('dg-barra-estado--error', !!esError);
        if (texto && !esError) avisoReloj = setTimeout(() => { estado.hidden = true; }, 6000);
    }

    function ocupado(boton, si) {
        if (!boton) return;
        boton.disabled = si;
        boton.classList.toggle('is-ocupado', si);
        boton.setAttribute('aria-busy', si ? 'true' : 'false');
    }

    /* ── Informe oficial en PDF ─────────────────────────────────────────── */

    function fechaCorta(iso) {
        const [a, m, d] = String(iso || '').split('-');
        return a && m && d ? `${d}/${m}/${a}` : '';
    }

    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
        'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function fechaLarga(iso) {
        const [a, m, d] = String(iso).split('-').map(Number);
        return `${d} de ${MESES[m - 1]} de ${a}`;
    }

    // Lo elegido la última vez en la sesión: la ventana vuelve a abrir con eso.
    let ultimaEleccion = null;
    let limites = null;   // { corteMin, corteMax, corteIso, anios }

    function errorVentana(texto) {
        const caja = $('dg-iv-error');
        if (!caja) return;
        caja.textContent = texto || '';
        caja.classList.toggle('d-none', !texto);
    }

    function mostrarVentana(abrir) {
        const modal = $('modalDgInforme');
        if (!modal) return;
        const Modal = root.bootstrap && root.bootstrap.Modal;
        if (Modal) {
            const instancia = Modal.getOrCreateInstance(modal);
            if (abrir) instancia.show(); else instancia.hide();
            return;
        }
        modal.classList.toggle('show', abrir);
        modal.style.display = abrir ? 'block' : 'none';
        modal.setAttribute('aria-hidden', abrir ? 'false' : 'true');
    }

    // Años que se pueden elegir: los que tienen datos y no pasan del año del corte.
    function aniosHastaCorte() {
        const corte = $('dg-iv-corte')?.value || '';
        const tope = Number(corte.slice(0, 4)) || Infinity;
        return (limites?.anios || []).filter((a) => a <= tope);
    }

    function pintarAnios(anio, vs) {
        const selAnio = $('dg-iv-anio');
        const selVs = $('dg-iv-vs');
        if (!selAnio || !selVs) return;
        const anios = aniosHastaCorte();
        const actual = anio !== undefined ? anio : selAnio.value;
        const actualVs = vs !== undefined ? vs : selVs.value;
        selAnio.innerHTML = '<option value="">Todos los años</option>'
            + anios.map((a) => `<option value="${a}">${a}</option>`).join('');
        selAnio.value = anios.includes(Number(actual)) ? String(actual) : '';
        const otros = anios.filter((a) => String(a) !== selAnio.value);
        selVs.innerHTML = '<option value="">Sin comparar</option>'
            + otros.map((a) => `<option value="${a}">${a}</option>`).join('');
        selVs.value = otros.includes(Number(actualVs)) ? String(actualVs) : '';
        // Con "Todos los años" ya van todos: no hay contra qué comparar.
        selVs.disabled = !selAnio.value;
        if (!selAnio.value) selVs.value = '';
    }

    function eleccion() {
        const anio = $('dg-iv-anio')?.value;
        const vs = $('dg-iv-vs')?.value;
        return {
            corteIso: $('dg-iv-corte')?.value || '',
            anios: anio ? [Number(anio)].concat(vs ? [Number(vs)] : []) : null
        };
    }

    // Revisa la fecha y explica qué va a salir; habilita "Descargar PDF".
    function validar() {
        const ayuda = $('dg-iv-ayuda');
        const boton = $('dg-iv-descargar');
        const { corteIso } = eleccion();
        let texto = '';
        let valido = false;
        if (limites) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(corteIso)) texto = 'Escribe o elige la fecha de corte.';
            else if (corteIso < limites.corteMin || corteIso > limites.corteMax) {
                texto = `La fecha de corte debe estar entre el ${fechaLarga(limites.corteMin)} y el ${fechaLarga(limites.corteMax)}.`;
            } else {
                valido = true;
                texto = `El informe acumula del 21 de marzo de 2022 al ${fechaLarga(corteIso)}, y las cifras del día son las de esa fecha.`;
            }
        }
        if (ayuda) {
            ayuda.textContent = texto;
            ayuda.classList.toggle('dg-iv-ayuda--error', !valido && !!texto);
        }
        if (boton && !boton.classList.contains('is-ocupado')) boton.disabled = !valido;
        return valido;
    }

    // Al tocar "Informe oficial": se abre la ventana y, mientras carga el
    // informe, se avisa; luego se ofrecen la fecha de corte (ayer por omisión)
    // y los años, con lo último elegido en la sesión.
    async function pedirInforme() {
        const api = root.InformeEstadistico;
        if (!api || typeof api.descargarPdf !== 'function' || typeof api.opcionesPdf !== 'function') {
            avisar('No se cargó el Informe oficial: recarga la página.', true);
            return;
        }
        avisar('');
        errorVentana('');
        $('dg-iv-cargando').hidden = false;
        $('dg-iv-campos').hidden = true;
        $('dg-iv-descargar').disabled = true;
        mostrarVentana(true);
        try {
            limites = await api.opcionesPdf();
        } catch (e) {
            console.error('[Dirección General] Informe oficial:', e);
            $('dg-iv-cargando').hidden = true;
            errorVentana(`No se pudo cargar el Informe oficial: ${e && e.message ? e.message : e}`);
            return;
        }
        const corte = $('dg-iv-corte');
        corte.min = limites.corteMin;
        corte.max = limites.corteMax;
        corte.value = (ultimaEleccion && ultimaEleccion.corteIso) || limites.corteIso;
        const previos = ultimaEleccion && ultimaEleccion.anios;
        pintarAnios(previos ? String(previos[0]) : '', previos && previos[1] ? String(previos[1]) : '');
        $('dg-iv-cargando').hidden = true;
        $('dg-iv-campos').hidden = false;
        validar();
    }

    let generando = null;
    function descargarInforme() {
        if (generando) return generando;   // doble clic: se espera el mismo PDF
        if (!validar()) return null;
        const api = root.InformeEstadistico;
        const elegido = eleccion();
        const boton = $('dg-iv-descargar');
        const etiqueta = boton && boton.querySelector('span');
        errorVentana('');
        ocupado(boton, true);
        generando = (async () => {
            try {
                const r = await api.descargarPdf((texto) => { if (etiqueta) etiqueta.textContent = texto; }, elegido);
                ultimaEleccion = elegido;
                mostrarVentana(false);
                const corte = r && r.corteIso ? ` con corte al ${fechaCorta(r.corteIso)}` : '';
                const anios = elegido.anios && r && Array.isArray(r.anios) ? ` (${r.anios.join(' vs ')})` : '';
                avisar(`Informe oficial descargado en PDF${corte}${anios}.`);
            } catch (e) {
                console.error('[Dirección General] Informe oficial:', e);
                errorVentana(`No se pudo generar el Informe oficial: ${e && e.message ? e.message : e}`);
            } finally {
                if (etiqueta) etiqueta.textContent = 'Descargar PDF';
                ocupado(boton, false);
                validar();
                generando = null;
            }
        })();
        return generando;
    }

    function enlazarVentana() {
        const modal = $('modalDgInforme');
        if (!modal || modal._dgEnlazada) return;
        modal._dgEnlazada = true;
        ['change', 'input'].forEach((tipo) => $('dg-iv-corte')?.addEventListener(tipo, () => { pintarAnios(); validar(); }));
        $('dg-iv-anio')?.addEventListener('change', () => pintarAnios());
        $('dg-iv-descargar')?.addEventListener('click', descargarInforme);
    }

    function abrirSwear() {
        const api = root.conciMensajeEnvio;
        if (!api || typeof api.abrir !== 'function') {
            avisar('No se cargó el mensaje SWEAR: recarga la página.', true);
            return;
        }
        avisar('');
        // La propia ventana muestra el avance y cualquier error de la lectura.
        Promise.resolve(api.abrir()).catch((e) => console.error('[Dirección General] SWEAR:', e));
    }

    /* ── título del encabezado ──────────────────────────────────────────── */

    // El encabezado de esta vista lleva el nombre en altas y bajas con
    // "Panel de operaciones" abajo. Se agrega al <h1> solo al encender la vista
    // (director-general.css oculta el título de siempre mientras dura).
    function asegurarTitulo() {
        const h1 = document.querySelector('.header .main-title');
        if (!h1 || h1.querySelector('.main-title-dg')) return;
        const titulo = document.createElement('span');
        titulo.className = 'main-title-dg';
        titulo.textContent = 'Aeropuerto Internacional Felipe Ángeles';
        const sub = document.createElement('small');
        sub.textContent = 'Panel de operaciones';
        titulo.appendChild(sub);
        h1.appendChild(titulo);
    }

    /* ── iniciales en el botón de usuario ───────────────────────────────── */

    // Las mismas iniciales que la lista de Administración de Usuarios: la
    // primera letra de las dos primeras palabras del nombre.
    function iniciales(nombre) {
        return String(nombre || '').trim().split(/\s+/).slice(0, 2)
            .map((p) => (p[0] || '').toUpperCase()).join('');
    }

    function pintarIniciales() {
        const icono = document.querySelector('#hdr-user-btn .hdr-user-icono');
        const nombre = $('hdr-user-nombre');
        if (!icono || !nombre) return;
        let span = icono.querySelector('.hdr-user-iniciales');
        if (!span) {
            span = document.createElement('span');
            span.className = 'hdr-user-iniciales';
            icono.appendChild(span);
        }
        const texto = nombre.textContent.trim();
        span.textContent = texto && texto !== 'Sesión activa' ? iniciales(texto) : '';
    }

    /* ── aplicar ────────────────────────────────────────────────────────── */

    function aplicar(rol) {
        const activo = esDirector(rol === undefined || rol === null ? rolDeSesion() : rol);
        document.body.classList.toggle(CLASE, activo);
        montarAccesos(activo);
        if (activo) {
            asegurarTitulo();
            pintarIniciales();
        } else {
            avisar('');
        }
        return activo;
    }

    function iniciar() {
        const barra = $('dg-barra');
        if (barra && !barra._dgEnlazada) {
            barra._dgEnlazada = true;
            barra.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-dg-informe]')) {
                    pedirInforme();
                    return;
                }
                if (ev.target.closest('[data-dg-swear]')) abrirSwear();
            });
        }
        enlazarVentana();

        // El rol llega al iniciar o restaurar la sesión (admin-mode-changed) y se
        // borra al cerrarla (el mismo evento, sin rol).
        root.addEventListener('admin-mode-changed', (ev) => {
            const detalle = ev && ev.detail;
            aplicar(detalle && 'role' in detalle ? (detalle.role || '') : undefined);
        });

        const nombre = $('hdr-user-nombre');
        if (nombre && root.MutationObserver) {
            new MutationObserver(() => {
                if (document.body.classList.contains(CLASE)) pintarIniciales();
            }).observe(nombre, { childList: true, characterData: true, subtree: true });
        }

        aplicar();
    }

    root.VistaDirectorGeneral = { aplicar, esDirector, iniciales };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
