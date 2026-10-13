/* ==========================================================================
   Conciliación › Manifiestos: mensaje para WhatsApp o Webex
   --------------------------------------------------------------------------
   El botón del avión de papel, junto a "Limpiar filtros", abre una ventana con
   el texto que se envía a diario por WhatsApp o Webex: el día, el acumulado
   del mes, del año y desde el inicio de operaciones del AIFA —pasajeros y
   carga, cada uno con sus operaciones— y la variación del acumulado del año
   contra el mismo periodo del año anterior. Un botón lo copia.

   Las cifras son las de los oficios a la Subsecretaría (Reportes › Pasajeros y
   Reportes › Carga) y se calculan con sus mismas funciones: se agrupan por
   CIERRE SUBSECRETARIA —el bloque de texto del libro lee esas mismas
   dinámicas, ver docs/reportes-pasajeros-origen-de-datos.md— y la carga va en
   toneladas enteras, repartidas entre nacional e internacional como en el
   oficio. Así el mensaje nunca dice algo distinto de los oficios.

   Sólo cuentan los manifiestos con CIERRE SUBSECRETARIA. Hubo una regla
   provisional que contaba como cerrado en su FECHA lo capturado (con HR. DE
   RECEPCIÓN) sin cierre; se quitó porque sumaba al mes manifiestos que el
   oficio no incluye.
   ========================================================================== */
(function () {
    'use strict';

    const MES_CORTO = ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.',
        'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.'];
    const MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const ALCANCES = ['dia', 'mes', 'anio', 'historico'];

    // Lo leído se reutiliza si la ventana se abrió hace menos de esto; si no,
    // se vuelve a leer para que el mensaje salga con lo último capturado.
    const VIGENCIA_MS = 2 * 60 * 1000;

    const el = id => document.getElementById(id);
    const dos = n => String(n).padStart(2, '0');
    const numero = n => Math.round(Number(n) || 0).toLocaleString('es-MX');

    let datos = null;          // manifiestos leídos, con las columnas del reporte de pasajeros
    let columnasCarga = null;  // las columnas de carga de esas mismas filas
    let leidoEn = 0;

    function hoyIso(fecha = new Date()) {
        return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
    }

    function fechaCorta(iso) {
        const [a, m, d] = iso.split('-');
        return `${d}/${m}/${a}`;
    }

    /** El mismo día del año anterior; el 29 de febrero cae en el 28. */
    function mismoDiaAnioAnterior(iso) {
        const [a, m, d] = iso.split('-').map(Number);
        const ultimo = new Date(a - 1, m, 0).getDate();
        return `${a - 1}-${dos(m)}-${dos(Math.min(d, ultimo))}`;
    }

    /** Lo leído tal cual: sólo cuenta lo que tiene CIERRE SUBSECRETARIA. */
    function conCierre(leidos) {
        const columnas = leidos.columnas || {};
        return { ...leidos, columnas: { ...columnas, cierre: columnas.cierre || 'CIERRE SUBSECRETARIA' } };
    }

    /* ── cifras ─────────────────────────────────────────────────────────── */

    /** Total, nacionales e internacionales de un campo del cuadro de pasajeros. */
    function tercia(bloque, campo) {
        const nacional = bloque.LLEGADA.NACIONAL[campo] + bloque.SALIDA.NACIONAL[campo];
        const internacional = bloque.LLEGADA.INTERNACIONAL[campo] + bloque.SALIDA.INTERNACIONAL[campo];
        return { total: nacional + internacional, nacional, internacional };
    }

    /**
     * Las cifras del mensaje para una fecha de cierre: la columna "actual" de
     * los dos oficios en sus cuatro alcances, más el acumulado del año anterior
     * a la misma fecha para la variación.
     */
    function calcular(leidos, colCarga, fechaIso) {
        const P = window.conciReportesPasajeros;
        const C = window.conciReportesCarga;
        const anterior = mismoDiaAnioAnterior(fechaIso);
        const deCarga = { filas: leidos.filas, columnas: colCarga };

        const pax = P.agregar(leidos, fechaIso).sub.actual;
        const carga = C.agregar(deCarga, fechaIso).sub.actual;
        const paxAntes = P.agregar(leidos, anterior).sub.actual.anio;
        const cargaAntes = C.agregar(deCarga, anterior).sub.actual.anio;

        const cifras = {};
        for (const alcance of ALCANCES) {
            const ton = C.toneladas(carga[alcance]).enteras;
            const ops = C.totales(carga[alcance]);
            cifras[alcance] = {
                pax: tercia(pax[alcance], 'pax'),
                opsPax: tercia(pax[alcance], 'ops'),
                carga: { total: ton.total, nacional: ton.nacional, internacional: ton.internacional },
                opsCarga: { total: ops.total.ops, nacional: ops.nacional.ops, internacional: ops.internacional.ops }
            };
        }
        // 2025 no está en la base: su acumulado sale del libro de variación
        // (js/conci-saldos-oficio.js). Sin dato ahí, lo que haya en la base.
        const S = window.ConciSaldosOficio;
        const oficial = S && typeof S.acumuladoAnioAnterior === 'function' ? S.acumuladoAnioAnterior(anterior) : null;
        return {
            fechaIso,
            cifras,
            anioAnterior: {
                pax: oficial ? oficial.pax : tercia(paxAntes, 'pax').total,
                carga: oficial ? oficial.ton : C.toneladas(cargaAntes).enteras.total
            }
        };
    }

    /* ── texto ──────────────────────────────────────────────────────────── */

    /**
     * El texto tal como se envía hoy, renglón por renglón. Los tabuladores
     * después de "a." y "b." del día y de "A." y "B." de la variación vienen
     * del mensaje original, igual que el espacio sencillo de los demás.
     */
    function componer({ fechaIso, cifras, anioAnterior }) {
        const [anio, mes, dia] = fechaIso.split('-').map(Number);
        const renglon = (inciso, etiqueta, c) => `${inciso}${etiqueta}: ${numero(c.total)} `
            + `(${numero(c.nacional)} Nacionales, ${numero(c.internacional)} Internacionales).`;
        const bloque = (alcance, separador) => {
            const c = cifras[alcance];
            return [
                renglon(`a.${separador}`, 'Pasajeros', c.pax),
                renglon(`b.${separador}`, 'Operaciones', c.opsPax),
                '',
                renglon('c. ', 'Carga', c.carga),
                renglon('d. ', 'Operaciones', c.opsCarga)
            ];
        };
        const variacion = (actual, previo) => {
            if (!previo) return `(sin dato de ${anio - 1})`;
            const pct = ((actual - previo) / previo) * 100;
            const flecha = pct > 0 ? '⬆️' : pct < 0 ? '⬇️' : '➡️';
            return `(${flecha} ${Math.abs(pct).toFixed(2)}%)`;
        };
        const periodo = `del 01 de Enero al ${dos(dia)} ${MES_LARGO[mes - 1]} ${anio}`;

        return [
            'Se envía la información correspondiente (carga y pasajeros) al:',
            '',
            fechaCorta(fechaIso),
            '',
            ...bloque('dia', '\t'),
            '',
            `A. Acumulado del mes de ${MES_CORTO[mes - 1]} ${anio}`,
            '',
            ...bloque('mes', ' '),
            '',
            `B. Acumulado en el año ${anio}`,
            '',
            ...bloque('anio', ' '),
            '',
            'C. Acumulado desde el inicio de operaciones del AIFA',
            '',
            ...bloque('historico', ' '),
            '',
            `Porcentaje de variación en acumulados anuales (${anio - 1} vs ${anio}):`,
            '',
            `A.\tAcumulado Pasajeros ${periodo}: ${numero(cifras.anio.pax.total)} ${variacion(cifras.anio.pax.total, anioAnterior.pax)}`,
            `B.\tAcumulado Carga ${periodo}: ${numero(cifras.anio.carga.total)} ${variacion(cifras.anio.carga.total, anioAnterior.carga)}`
        ].join('\n');
    }

    /* ── ventana ────────────────────────────────────────────────────────── */

    function estado(texto) {
        const e = el('conci-msg-estado');
        if (e) e.textContent = texto || '';
    }

    function alerta(id, texto) {
        const a = el(id);
        if (!a) return;
        a.textContent = texto || '';
        a.classList.toggle('d-none', !texto);
    }
    const aviso = texto => alerta('conci-msg-aviso', texto);
    const error = texto => alerta('conci-msg-error', texto);

    /** El día más reciente con manifiestos cerrados o capturados. */
    function ultimoCierre(leidos, hasta) {
        const P = window.conciReportesPasajeros;
        const columna = leidos && leidos.columnas && leidos.columnas.cierre;
        if (!columna) return '';
        let ultimo = '';
        for (const fila of leidos.filas) {
            const cierre = P.aIso(fila[columna]);
            if (cierre && cierre <= hasta && cierre > ultimo) ultimo = cierre;
        }
        return ultimo;
    }

    /** Vuelve a armar el texto con lo ya leído, para la fecha elegida. */
    function recalcular() {
        const campo = el('conci-msg-fecha');
        const texto = el('conci-msg-texto');
        const fecha = campo && campo.value;
        if (!datos || !fecha || !texto) return;
        const resumen = calcular(datos, columnasCarga, fecha);
        texto.value = componer(resumen);
        const dia = resumen.cifras.dia;
        const sinCierre = [dia.pax, dia.opsPax, dia.carga, dia.opsCarga].every(c => !c.total);
        aviso(sinCierre
            ? `No hay manifiestos con CIERRE SUBSECRETARIA del ${fechaCorta(fecha)}.`
            : '');
        const copiar = el('btn-conci-msg-copiar');
        if (copiar) copiar.disabled = false;
    }

    /**
     * Lee los manifiestos —o reutiliza la lectura reciente— y arma el mensaje.
     * `forzar` vuelve a leer aunque la lectura sea reciente; `conservarFecha`
     * deja la fecha elegida en vez de saltar al último cierre. Si ya hay una
     * lectura en curso (doble clic), se espera esa en vez de pedir otra: la
     * lectura trae todo el histórico y es pesada.
     */
    let enCurso = null;
    function preparar(opciones) {
        if (!enCurso) enCurso = prepararAhora(opciones).finally(() => { enCurso = null; });
        return enCurso;
    }

    async function prepararAhora({ forzar = false, conservarFecha = false } = {}) {
        const P = window.conciReportesPasajeros;
        const C = window.conciReportesCarga;
        const texto = el('conci-msg-texto');
        const copiar = el('btn-conci-msg-copiar');
        const actualizar = el('btn-conci-msg-actualizar');
        error('');
        aviso('');
        if (!P || !C || typeof P.leer !== 'function' || typeof C.columnas !== 'function') {
            error('No se cargaron los reportes de Conciliación: recarga la página.');
            return;
        }
        if (copiar) copiar.disabled = true;
        if (actualizar) actualizar.disabled = true;
        if (texto) texto.value = '';
        estado('Leyendo manifiestos…');
        try {
            const hoy = hoyIso();
            if (forzar || !datos || Date.now() - leidoEn > VIGENCIA_MS) {
                // Los reportes guardan lo leído por fecha; esto lo tira para
                // traer lo último que se haya capturado, también en otras
                // computadoras.
                window.dispatchEvent(new CustomEvent('conciliacion:manifiestos-cambiaron'));
                // Sin el catálogo de aerolíneas no se distingue bien carga de
                // pasajeros; a esta ventana se puede llegar sin haberlo cargado.
                if (typeof window._ensureConciAirlineCatalog === 'function') {
                    try { await window._ensureConciAirlineCatalog(); } catch (_) { /* se usa lo capturado */ }
                }
                datos = conCierre(await P.leer(hoy, n => estado(`Leyendo manifiestos… ${numero(n)}`)));
                columnasCarga = { ...C.columnas(datos.filas[0] || {}), cierre: datos.columnas.cierre };
                leidoEn = Date.now();
            }
            // El mensaje es de un día completo: por omisión, el último con
            // datos hasta ayer (el del 27 se envía el 28).
            const ayer = hoyIso(new Date(Date.now() - 24 * 60 * 60 * 1000));
            const campo = el('conci-msg-fecha');
            const ultimo = ultimoCierre(datos, ayer);
            if (campo && (!conservarFecha || !campo.value)) campo.value = ultimo || ayer;
            recalcular();
            estado(`${numero(datos.filas.length)} manifiestos leídos${ultimo ? ` · último día con datos: ${fechaCorta(ultimo)}` : ''}`);
        } catch (e) {
            console.error('[Mensaje WhatsApp]', e);
            error(`No se pudo armar el mensaje: ${e.message || e}`);
            estado('');
        } finally {
            if (actualizar) actualizar.disabled = false;
        }
    }

    const ETIQUETA_COPIAR = '<i class="fas fa-copy me-1" aria-hidden="true"></i>Copiar mensaje';

    /** Copia el texto (tal como esté, si se corrigió a mano) al portapapeles. */
    async function copiar() {
        const texto = el('conci-msg-texto');
        const boton = el('btn-conci-msg-copiar');
        if (!texto || !texto.value) return false;
        let copiado = false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(texto.value);
                copiado = true;
            }
        } catch (_) { /* sin permiso para el portapapeles: se usa el respaldo */ }
        if (!copiado) {
            // Respaldo para páginas sin HTTPS; si tampoco funciona, el texto
            // queda seleccionado para copiarlo con Ctrl+C.
            texto.focus();
            texto.select();
            try { copiado = document.execCommand('copy'); } catch (_) { copiado = false; }
        }
        if (boton) {
            clearTimeout(boton._conciRestaurar);
            boton.innerHTML = copiado
                ? '<i class="fas fa-check me-1" aria-hidden="true"></i>¡Copiado!'
                : '<i class="fas fa-keyboard me-1" aria-hidden="true"></i>Cópialo con Ctrl+C';
            boton.classList.toggle('conci-msg-copiado', copiado);
            boton._conciRestaurar = setTimeout(() => {
                boton.innerHTML = ETIQUETA_COPIAR;
                boton.classList.remove('conci-msg-copiado');
            }, 2500);
        }
        return copiado;
    }

    function abrir() {
        const modal = el('modalConciMensaje');
        if (!modal) return undefined;
        if (window.bootstrap && window.bootstrap.Modal) {
            window.bootstrap.Modal.getOrCreateInstance(modal).show();
        }
        return preparar();
    }

    document.addEventListener('DOMContentLoaded', () => {
        el('btn-conci-enviar-mensaje')?.addEventListener('click', abrir);
        el('btn-conci-msg-copiar')?.addEventListener('click', copiar);
        el('btn-conci-msg-actualizar')?.addEventListener('click', () => preparar({ forzar: true, conservarFecha: true }));
        // Cambiar la fecha no vuelve a leer: los manifiestos hasta hoy ya
        // incluyen cualquier cierre anterior.
        el('conci-msg-fecha')?.addEventListener('change', recalcular);
        // Se ve dd/mm/aaaa aunque el navegador esté en inglés.
        if (typeof window._conciInitCamposFecha === 'function') {
            window._conciInitCamposFecha(el('modalConciMensaje') || document);
        }
    });

    window.conciMensajeEnvio = {
        abrir, preparar, copiar, calcular, componer, mismoDiaAnioAnterior, ultimoCierre, conCierre
    };
})();
