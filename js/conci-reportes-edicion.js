/* ==========================================================================
   Reportes de Conciliación: edición y marcatextos
   --------------------------------------------------------------------------
   Cualquier reporte de Carga o de Pasajeros se puede corregir a mano y marcar
   con colores antes de imprimirlo o descargarlo. Lo editado se guarda como
   una versión del reporte —por apartado, reporte y fecha— y NO toca los
   manifiestos: al volver a abrir ese reporte en esa fecha aparece la versión
   guardada, y "Descartar edición" regresa a las cifras calculadas.

   Se guarda en la tabla conci_reportes_ediciones de Supabase para que todo el
   equipo vea lo mismo (migrations/20260911_conci_reportes_ediciones.sql). Si
   la tabla aún no existe, se guarda en este navegador y se avisa.
   ========================================================================== */
(function () {
    'use strict';

    const TABLA = 'conci_reportes_ediciones';
    const LLAVE_LOCAL = 'conciRepEdicion';
    const LIMITE = 1900000;

    /** Los cinco marcatextos. El hex va sin # porque sirve igual en Excel y PowerPoint. */
    const COLORES = {
        rojo: { nombre: 'Rojo', hex: 'FF8A80' },
        verde: { nombre: 'Verde', hex: '9CE6A5' },
        amarillo: { nombre: 'Amarillo', hex: 'FFF176' },
        azul: { nombre: 'Azul', hex: '8FD3FE' },
        morado: { nombre: 'Morado', hex: 'D6A8F5' }
    };

    const ROLES_SOLO_LECTURA = ['viewer', 'lector', 'colab_viewer'];

    // Lo que se puede reescribir: celdas y renglones de texto. La hoja entera
    // no se vuelve editable para que no se puedan borrar tablas completas.
    const EDITABLES = 'td, th, h1, h2, p, dt, dd, .cp-txt-in, .cp-cifra, .cp-card > span, .cp-card > b, .cc-logo > span';
    // Lo que se colorea con el marcatextos: la celda más cercana al clic.
    const MARCABLES = 'td, th, dt, dd, h1, h2, p, .cp-txt-in, .cp-cifra, .cp-card, .cc-tarjeta';

    const escapar = t => String(t ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    /* ── limpieza del HTML guardado ─────────────────────────────────────── */

    const PROHIBIDAS = 'script, style, iframe, frame, frameset, object, embed, applet, link, meta, base, form, '
        + 'input, button, textarea, select, option, noscript, template, svg, math';
    const ATRIBUTOS_FUERA = ['srcset', 'srcdoc', 'action', 'formaction', 'background', 'poster', 'xlink:href',
        'contenteditable', 'spellcheck'];

    /** Solo rutas del sitio, http(s) e imágenes embebidas; nada de javascript:. */
    function urlSegura(valor) {
        // El navegador ignora espacios y controles dentro de la URL ("java\tscript:").
        const v = String(valor || '').replace(/[\u0000-\u0020]/g, '');
        const esquema = v.match(/^([a-z][a-z0-9+.-]*):/i);
        if (!esquema) return true;
        return /^https?$/i.test(esquema[1]) || /^data:image\/(png|jpe?g|gif|webp);/i.test(v);
    }

    /**
     * Lo guardado es HTML que alguien más pudo escribir directo en la tabla, así
     * que antes de pintarlo se le quita todo lo que pueda ejecutar código.
     */
    function limpiar(html) {
        const plantilla = document.createElement('template');
        plantilla.innerHTML = String(html || '');
        const raiz = plantilla.content;
        raiz.querySelectorAll(PROHIBIDAS).forEach(n => n.remove());
        raiz.querySelectorAll('*').forEach(n => {
            for (const { name, value } of [...n.attributes]) {
                const nombre = name.toLowerCase();
                if (nombre.startsWith('on') || ATRIBUTOS_FUERA.includes(nombre)
                    || ((nombre === 'src' || nombre === 'href') && !urlSegura(value))
                    || (nombre === 'style' && /url\s*\(|expression\s*\(/i.test(value))) {
                    n.removeAttribute(name);
                }
            }
        });
        const caja = document.createElement('div');
        caja.appendChild(raiz);
        return caja.innerHTML;
    }

    /* ── lectura de la vista ────────────────────────────────────────────── */

    const textoDe = nodo => String((nodo && nodo.textContent) || '')
        .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    /** Color (hex) con que está marcado el nodo o la celda que lo contiene. */
    function marcaDe(nodo, limite) {
        const marcado = nodo && nodo.closest ? nodo.closest('[data-marca]') : null;
        if (!marcado || (limite && !limite.contains(marcado))) return null;
        const color = COLORES[marcado.getAttribute('data-marca')];
        return color ? color.hex : null;
    }

    /** Un número tecleado ("1,234") vuelve a ser número en el Excel. */
    function comoValor(texto, antes) {
        if (typeof antes === 'number' || antes === '' || antes === undefined || antes === null) {
            const limpio = texto.replace(/[,\s]/g, '');
            if (/^-?\d+(\.\d+)?$/.test(limpio)) return Number(limpio);
        }
        return texto;
    }

    /**
     * Pasa a las filas del Excel lo que se cambió a mano. Cada celda con lugar
     * en el archivo lleva data-xl="renglón,columna". Se compara con la misma
     * celda recién calculada: así un promedio que en pantalla lleva decimales
     * no pisa al del archivo si nadie lo tocó. Devuelve las celdas marcadas.
     */
    function aplicarAFilas(filas, vista, calculado) {
        const originales = new Map();
        if (calculado) calculado.querySelectorAll('[data-xl]').forEach(n => originales.set(n.getAttribute('data-xl'), textoDe(n)));
        const marcas = [];
        vista.querySelectorAll('[data-xl]').forEach(nodo => {
            const clave = nodo.getAttribute('data-xl');
            const [r, c] = clave.split(',').map(Number);
            if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= filas.length) return;
            const fila = filas[r] || (filas[r] = []);
            const texto = textoDe(nodo);
            if (originales.has(clave) && originales.get(clave) !== texto) fila[c] = comoValor(texto, fila[c]);
            const hex = marcaDe(nodo, vista);
            if (hex) {
                // Una celda vacía no existe en el archivo: sin ella no hay dónde poner el color.
                if (fila[c] === undefined || fila[c] === null) fila[c] = '';
                marcas.push({ r, c, hex });
            }
        });
        return marcas;
    }

    const columnaXlsx = c => {
        let s = '';
        for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
    };

    /**
     * SheetJS (edición libre) no escribe colores, así que se agregan después:
     * un relleno sólido por color en styles.xml y el estilo en cada celda.
     */
    async function colorearXlsx(bytes, marcas, JSZip) {
        if (!marcas || !marcas.length) return bytes;
        const zip = await JSZip.loadAsync(bytes);
        const rutaEstilos = 'xl/styles.xml';
        const rutaHoja = 'xl/worksheets/sheet1.xml';
        let estilos = await zip.file(rutaEstilos).async('string');
        let hoja = await zip.file(rutaHoja).async('string');
        const colores = [...new Set(marcas.map(m => m.hex))];
        let primerRelleno = null;
        let primerEstilo = null;
        estilos = estilos.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (_, n, contenido) => {
            primerRelleno = Number(n);
            return `<fills count="${primerRelleno + colores.length}">${contenido}${colores.map(h =>
                `<fill><patternFill patternType="solid"><fgColor rgb="FF${h}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>`;
        });
        estilos = estilos.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_, n, contenido) => {
            primerEstilo = Number(n);
            return `<cellXfs count="${primerEstilo + colores.length}">${contenido}${colores.map((h, i) =>
                `<xf numFmtId="0" fontId="0" fillId="${primerRelleno + i}" borderId="0" xfId="0" applyFill="1"/>`).join('')}</cellXfs>`;
        });
        if (primerRelleno === null || primerEstilo === null) throw new Error('El Excel no trae la tabla de estilos esperada');
        for (const { r, c, hex } of marcas) {
            const ref = `${columnaXlsx(c)}${r + 1}`;
            hoja = hoja.replace(new RegExp(`<c r="${ref}"(?: s="\\d+")?`), `<c r="${ref}" s="${primerEstilo + colores.indexOf(hex)}"`);
        }
        zip.file(rutaEstilos, estilos);
        zip.file(rutaHoja, hoja);
        return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    }

    function bajarArchivo(bytes, nombre, tipo) {
        const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    /* ── quién y dónde se guarda ────────────────────────────────────────── */

    function leerSesion(clave) {
        try { return sessionStorage.getItem(clave) || ''; } catch (_) { return ''; }
    }

    /** Capturistas y editores sí; los roles de consulta solo ven. */
    function puedeEditar() {
        const rol = (leerSesion('user_role') || 'viewer').toLowerCase();
        return !ROLES_SOLO_LECTURA.includes(rol);
    }

    const usuarioActual = () => leerSesion('user_fullname') || leerSesion('currentUser');

    const faltaLaTabla = e => !!e && (e.code === 'PGRST205' || e.code === '42P01'
        || /does not exist|could not find the table|schema cache/i.test(e.message || ''));

    const llave = (area, fecha, reporte) => `${LLAVE_LOCAL}:${area}:${fecha}:${reporte}`;

    function leerLocal(area, fecha) {
        const mapa = new Map();
        try {
            const prefijo = `${LLAVE_LOCAL}:${area}:${fecha}:`;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(prefijo)) continue;
                const reg = JSON.parse(localStorage.getItem(k));
                if (reg && typeof reg.html === 'string') mapa.set(k.slice(prefijo.length), { ...reg, local: true });
            }
        } catch (_) { /* sin almacenamiento local */ }
        return mapa;
    }

    function borrarLocal(area, fecha, reporte) {
        try { localStorage.removeItem(llave(area, fecha, reporte)); } catch (_) { /* nada que borrar */ }
    }

    const almacen = {
        sinTabla: false,

        async leer(area, fecha) {
            const locales = leerLocal(area, fecha);
            const c = window.supabaseClient;
            if (!c || this.sinTabla) return locales;
            const { data, error } = await c.from(TABLA)
                .select('reporte, html, actualizado_por, actualizado_en')
                .eq('area', area).eq('fecha', fecha);
            if (error) {
                if (faltaLaTabla(error)) { this.sinTabla = true; return locales; }
                throw error;
            }
            // Lo compartido gana; lo que solo está en este navegador se sigue viendo.
            const mapa = new Map(locales);
            (data || []).forEach(f => mapa.set(f.reporte, {
                html: f.html, actualizado_por: f.actualizado_por, actualizado_en: f.actualizado_en, local: false
            }));
            return mapa;
        },

        async guardar(area, fecha, reporte, html) {
            const registro = { html, actualizado_por: usuarioActual(), actualizado_en: new Date().toISOString() };
            const c = window.supabaseClient;
            if (c && !this.sinTabla) {
                const { error } = await c.from(TABLA)
                    .upsert({ area, reporte, fecha, ...registro }, { onConflict: 'area,reporte,fecha' });
                if (!error) {
                    borrarLocal(area, fecha, reporte);
                    return { ...registro, local: false };
                }
                if (!faltaLaTabla(error)) throw error;
                this.sinTabla = true;
            }
            localStorage.setItem(llave(area, fecha, reporte), JSON.stringify(registro));
            return { ...registro, local: true };
        },

        async borrar(area, fecha, reporte) {
            borrarLocal(area, fecha, reporte);
            const c = window.supabaseClient;
            if (!c || this.sinTabla) return;
            const { error } = await c.from(TABLA).delete()
                .eq('area', area).eq('reporte', reporte).eq('fecha', fecha);
            if (error && !faltaLaTabla(error)) throw error;
        }
    };

    const dos = n => String(n).padStart(2, '0');
    function cuando(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return `el ${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} a las ${dos(d.getHours())}:${dos(d.getMinutes())}`;
    }

    /* ── la edición de un apartado ──────────────────────────────────────── */

    /**
     * Engancha la edición a un apartado de Reportes. Cada apartado sigue siendo
     * dueño de sus cálculos: aquí solo se decide si se pinta lo calculado o la
     * versión guardada, y se maneja la barra de edición.
     *
     *   area       'carga' | 'pasajeros' (lo que se guarda en la tabla)
     *   prefijo    'carga' | 'pax'       (el de los ids del marcado)
     *   alCambiar  vuelve a pintar el reporte activo
     */
    function crear({ area, prefijo, alCambiar, avisar, error }) {
        const el = id => document.getElementById(id);
        const salida = () => el(`conci-rep-${prefijo}-salida`);
        const barra = () => el(`conci-rep-${prefijo}-edicion`);
        const aviso = () => el(`conci-rep-${prefijo}-edicion-aviso`);
        const boton = () => el(`btn-conci-rep-${prefijo}-editar`);
        const repintar = () => { if (typeof alCambiar === 'function') alCambiar(); };
        const decir = t => { if (typeof avisar === 'function') avisar(t); };
        const fallar = t => { if (typeof error === 'function') error(t); };

        const guardadas = new Map();      // fecha → Map(reporte → registro)
        const verCalculado = new Set();   // "reporte|fecha" que se piden sin la edición
        let actual = null;                // { reporte, fecha }
        let sesion = null;                // la edición en curso
        let ocupado = false;

        const registro = (reporte, fecha) => (guardadas.get(fecha) && guardadas.get(fecha).get(reporte)) || null;

        async function cargar(fecha) {
            try {
                guardadas.set(fecha, await almacen.leer(area, fecha));
            } catch (e) {
                console.error('[Reportes] ediciones guardadas', e);
                guardadas.set(fecha, leerLocal(area, fecha));
            }
        }

        function pintarAviso() {
            const a = aviso();
            if (!a) return;
            const reg = actual && registro(actual.reporte, actual.fecha);
            if (!reg || sesion) {
                a.classList.add('d-none');
                a.innerHTML = '';
                return;
            }
            const quien = reg.actualizado_por ? ` por ${escapar(reg.actualizado_por)}` : '';
            const local = reg.local ? ' <span class="conci-rep-edicion-local">(solo en este navegador)</span>' : '';
            const viendoGuardada = !verCalculado.has(`${actual.reporte}|${actual.fecha}`);
            a.innerHTML = viendoGuardada
                ? `<i class="fas fa-pen-to-square"></i><span class="flex-grow-1">Estás viendo la <b>versión editada</b>, guardada
                    ${escapar(cuando(reg.actualizado_en))}${quien}${local}. Sus cifras ya no se recalculan.</span>
                   <button type="button" class="btn btn-sm btn-outline-primary" data-conci-rep-accion="ver-calculado">Ver calculado</button>
                   ${puedeEditar() ? '<button type="button" class="btn btn-sm btn-outline-danger" data-conci-rep-accion="descartar">Descartar edición</button>' : ''}`
                : `<i class="fas fa-calculator"></i><span class="flex-grow-1">Estás viendo las cifras <b>calculadas</b>.
                    Este reporte tiene una versión editada${quien}${local}.</span>
                   <button type="button" class="btn btn-sm btn-primary" data-conci-rep-accion="ver-editada">Ver versión editada</button>`;
            a.classList.remove('d-none');
        }

        /** Pinta el reporte: la versión guardada si la hay, si no lo calculado. */
        function pintar(reporte, fecha, calcular) {
            const s = salida();
            if (!s) return;
            if (sesion) terminar();
            actual = { reporte, fecha };
            const reg = registro(reporte, fecha);
            const guardada = reg && !verCalculado.has(`${reporte}|${fecha}`);
            s.innerHTML = guardada ? limpiar(reg.html) : calcular();
            pintarAviso();
            const b = boton();
            if (b) {
                b.classList.toggle('d-none', !puedeEditar());
                b.disabled = false;
            }
        }

        function montarBarra() {
            const b = barra();
            if (!b || b.dataset.montada === '1') return;
            b.dataset.montada = '1';
            b.innerHTML = `
                <span class="conci-rep-edicion-titulo"><i class="fas fa-pen-to-square me-1"></i>Modo edición</span>
                <button type="button" class="btn btn-sm btn-light conci-rep-herramienta" data-conci-rep-herramienta="texto"
                    aria-pressed="true" title="Escribir: haz clic en una celda y cambia su contenido">
                    <i class="fas fa-i-cursor me-1"></i>Escribir</button>
                <span class="conci-rep-edicion-sep" aria-hidden="true"></span>
                <span class="conci-rep-edicion-etiqueta">Marcatextos</span>
                ${Object.entries(COLORES).map(([clave, c]) => `<button type="button" class="conci-rep-color conci-rep-herramienta"
                    data-conci-rep-herramienta="${clave}" style="--marca:#${c.hex}" aria-pressed="false"
                    title="Marcatextos ${c.nombre.toLowerCase()}: elígelo y haz clic (o arrastra) sobre las celdas"
                    aria-label="Marcatextos ${c.nombre.toLowerCase()}"></button>`).join('')}
                <button type="button" class="btn btn-sm btn-light conci-rep-herramienta" data-conci-rep-herramienta="borrar"
                    aria-pressed="false" title="Quitar el color de las celdas"><i class="fas fa-eraser me-1"></i>Quitar color</button>
                <span class="flex-grow-1"></span>
                <button type="button" class="btn btn-sm btn-success" data-conci-rep-accion="guardar">
                    <i class="fas fa-floppy-disk me-1"></i>Guardar</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-conci-rep-accion="cancelar">Cancelar</button>`;
            b.addEventListener('click', ev => {
                const herramienta = ev.target.closest('[data-conci-rep-herramienta]');
                if (herramienta) { elegirHerramienta(herramienta.dataset.conciRepHerramienta); return; }
                const accion = ev.target.closest('[data-conci-rep-accion]');
                if (!accion) return;
                if (accion.dataset.conciRepAccion === 'guardar') guardar();
                else if (accion.dataset.conciRepAccion === 'cancelar') cancelar();
            });
        }

        function elegirHerramienta(herramienta) {
            if (!sesion) return;
            sesion.herramienta = herramienta in COLORES || herramienta === 'borrar' ? herramienta : 'texto';
            const b = barra();
            if (b) b.querySelectorAll('[data-conci-rep-herramienta]').forEach(x => {
                const activa = x.dataset.conciRepHerramienta === sesion.herramienta;
                x.classList.toggle('active', activa);
                x.setAttribute('aria-pressed', activa ? 'true' : 'false');
            });
            const s = salida();
            if (s) s.classList.toggle('conci-rep-pintando', sesion.herramienta !== 'texto');
            if (sesion.herramienta !== 'texto' && document.activeElement && s && s.contains(document.activeElement)) {
                document.activeElement.blur();
            }
        }

        function iniciar() {
            const s = salida();
            if (!s || !actual || sesion || !s.querySelector('#conci-rep-hoja')) return;
            if (!puedeEditar()) { fallar('Tu rol solo permite consultar los reportes.'); return; }
            sesion = { herramienta: 'texto', sucio: false, pintura: null, arrastrando: false };
            s.querySelectorAll(EDITABLES).forEach(n => {
                if (!n.closest('#conci-rep-hoja')) return;
                if (n.parentElement && n.parentElement.closest('[contenteditable="true"]')) return;
                n.setAttribute('contenteditable', 'true');
                n.setAttribute('spellcheck', 'false');
            });
            s.classList.add('conci-rep-editando');
            montarBarra();
            const b = barra();
            if (b) b.classList.remove('d-none');
            const e = boton();
            if (e) e.disabled = true;
            pintarAviso();
            elegirHerramienta('texto');
            decir('Modo edición: haz clic en una celda para cambiarla, o elige un color y márcala.');
        }

        function terminar() {
            const s = salida();
            if (s) {
                s.querySelectorAll('[contenteditable]').forEach(n => {
                    n.removeAttribute('contenteditable');
                    n.removeAttribute('spellcheck');
                });
                s.classList.remove('conci-rep-editando', 'conci-rep-pintando');
            }
            sesion = null;
            const b = barra();
            if (b) b.classList.add('d-none');
            const e = boton();
            if (e) e.disabled = false;
        }

        /** El HTML a guardar: lo que se ve, sin las marcas de edición. */
        function serializar() {
            const copia = salida().cloneNode(true);
            copia.querySelectorAll('[contenteditable], [spellcheck]').forEach(n => {
                n.removeAttribute('contenteditable');
                n.removeAttribute('spellcheck');
            });
            return limpiar(copia.innerHTML);
        }

        async function guardar() {
            if (!sesion || !actual || ocupado || !salida()) return;
            const html = serializar();
            if (html.length > LIMITE) { fallar('El reporte editado es demasiado grande para guardarse.'); return; }
            const b = barra();
            const botonGuardar = b && b.querySelector('[data-conci-rep-accion="guardar"]');
            ocupado = true;
            if (botonGuardar) botonGuardar.disabled = true;
            try {
                const { reporte, fecha } = actual;
                const reg = await almacen.guardar(area, fecha, reporte, html);
                if (!guardadas.has(fecha)) guardadas.set(fecha, new Map());
                guardadas.get(fecha).set(reporte, reg);
                verCalculado.delete(`${reporte}|${fecha}`);
                terminar();
                repintar();
                fallar('');
                decir(reg.local
                    ? 'Edición guardada solo en este navegador: falta crear la tabla compartida en Supabase.'
                    : 'Edición guardada.');
            } catch (e) {
                console.error('[Reportes] guardar edición', e);
                fallar(`No se pudo guardar la edición: ${e.message || e}`);
            } finally {
                ocupado = false;
                if (botonGuardar) botonGuardar.disabled = false;
            }
        }

        function cancelar() {
            if (!sesion) return;
            if (sesion.sucio && !window.confirm('¿Descartar los cambios que no has guardado?')) return;
            terminar();
            repintar();
            decir('');
        }

        /** Antes de cambiar de reporte o de fecha: false si el usuario prefiere seguir editando. */
        function soltar() {
            if (!sesion) return true;
            if (sesion.sucio && !window.confirm('Tienes cambios sin guardar en este reporte. ¿Descartarlos?')) return false;
            terminar();
            return true;
        }

        async function descartar() {
            if (!actual || ocupado || !registro(actual.reporte, actual.fecha)) return;
            if (!window.confirm('¿Descartar la versión editada? El reporte vuelve a mostrar las cifras calculadas.')) return;
            const { reporte, fecha } = actual;
            ocupado = true;
            try {
                await almacen.borrar(area, fecha, reporte);
                guardadas.get(fecha).delete(reporte);
                verCalculado.delete(`${reporte}|${fecha}`);
                repintar();
                decir('Se descartó la versión editada.');
            } catch (e) {
                console.error('[Reportes] descartar edición', e);
                fallar(`No se pudo descartar la edición: ${e.message || e}`);
            } finally {
                ocupado = false;
            }
        }

        /** La celda que colorea el marcatextos, siempre dentro de la hoja. */
        function objetivo(nodo) {
            const celda = nodo && nodo.closest ? nodo.closest(MARCABLES) : null;
            return celda && celda.closest('#conci-rep-hoja') && salida().contains(celda) ? celda : null;
        }

        function marcar(celda, color) {
            if (color) celda.setAttribute('data-marca', color);
            else celda.removeAttribute('data-marca');
            sesion.sucio = true;
        }

        const s0 = salida();
        if (s0) {
            // Con un color elegido, el clic colorea en vez de poner el cursor, y
            // arrastrar colorea todas las celdas por las que se pasa.
            s0.addEventListener('mousedown', ev => {
                if (!sesion || sesion.herramienta === 'texto' || ev.button !== 0) return;
                const celda = objetivo(ev.target);
                if (!celda) return;
                ev.preventDefault();
                const color = sesion.herramienta === 'borrar' ? null : sesion.herramienta;
                // Volver a pasar el mismo color lo quita, como un marcatextos que se borra.
                sesion.pintura = color && celda.getAttribute('data-marca') !== color ? color : null;
                marcar(celda, sesion.pintura);
                sesion.arrastrando = true;
            });
            s0.addEventListener('mouseover', ev => {
                if (!sesion || !sesion.arrastrando) return;
                const celda = objetivo(ev.target);
                if (celda) marcar(celda, sesion.pintura);
            });
            s0.addEventListener('input', () => { if (sesion) sesion.sucio = true; });
            s0.addEventListener('keydown', ev => {
                if (!sesion || !ev.target.isContentEditable) return;
                // Una celda es un renglón: Enter y Esc terminan de escribir en ella.
                if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); ev.target.blur(); }
            });
            // Pegar trae solo el texto: sin formato ni tablas de otro documento.
            s0.addEventListener('paste', ev => {
                if (!sesion || !ev.target.closest || !ev.target.closest('[contenteditable="true"]')) return;
                ev.preventDefault();
                const datos = ev.clipboardData || window.clipboardData;
                const texto = (datos && datos.getData('text')) || '';
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return;
                const rango = sel.getRangeAt(0);
                rango.deleteContents();
                const nodo = document.createTextNode(texto.replace(/\s+/g, ' '));
                rango.insertNode(nodo);
                rango.setStartAfter(nodo);
                rango.collapse(true);
                sel.removeAllRanges();
                sel.addRange(rango);
                sesion.sucio = true;
            });
        }
        document.addEventListener('mouseup', () => { if (sesion) sesion.arrastrando = false; });

        const b0 = boton();
        if (b0) b0.addEventListener('click', iniciar);

        const a0 = aviso();
        if (a0) a0.addEventListener('click', ev => {
            const accion = ev.target.closest('[data-conci-rep-accion]');
            if (!accion || !actual) return;
            const clave = `${actual.reporte}|${actual.fecha}`;
            if (accion.dataset.conciRepAccion === 'ver-calculado') { verCalculado.add(clave); repintar(); }
            else if (accion.dataset.conciRepAccion === 'ver-editada') { verCalculado.delete(clave); repintar(); }
            else if (accion.dataset.conciRepAccion === 'descartar') descartar();
        });

        return {
            cargar, pintar, soltar, iniciar, guardar, cancelar, descartar, elegirHerramienta,
            registro, editando: () => !!sesion
        };
    }

    window.ConciReportesEdicion = {
        crear, limpiar, textoDe, marcaDe, aplicarAFilas, colorearXlsx, bajarArchivo, puedeEditar,
        COLORES, TABLA, EDITABLES, MARCABLES,
        _almacen: almacen
    };
})();
