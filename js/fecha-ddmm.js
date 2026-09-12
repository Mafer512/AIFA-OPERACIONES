/* Campos de fecha en dd/mm/aaaa en toda la aplicación.
 *
 * El <input type="date"> nativo muestra la fecha con el formato del idioma del
 * navegador: en un equipo en inglés, 12/15/2026. Aquí cada campo de fecha
 * recibe delante un campo de texto dd/mm/aaaa y un botón de calendario; el
 * nativo se queda, oculto, como fuente de verdad en ISO (aaaa-mm-dd). Así el
 * código que lee o escribe .value, escucha "change" o manda el formulario no
 * cambia en nada.
 *
 * Es el mismo patrón de los filtros de Manifiestos e Itinerario
 * (_conciInitCamposFecha en script.js). Esos ya traen su máscara en el HTML y
 * aquí se respetan; tampoco se tocan los editores dentro de celdas de tabla,
 * que tienen su propio manejo, ni lo marcado con data-fecha-nativa.
 *
 * Escribir .value por código no dispara ningún evento, así que se intercepta
 * esa propiedad en cada campo: cualquier asignación actualiza lo que se ve.
 */
(function (root) {
    'use strict';

    const pad2 = (n) => String(n).padStart(2, '0');

    function fechaValida(anio, mes, dia) {
        if (![anio, mes, dia].every(Number.isInteger)) return false;
        if (anio < 1000 || anio > 9999 || mes < 1 || mes > 12 || dia < 1) return false;
        return dia <= new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    }

    // Da forma mientras se teclea: "15122026" → "15/12/2026".
    function formatear(texto) {
        const d = String(texto || '').replace(/\D/g, '').slice(0, 8);
        if (d.length <= 2) return d;
        if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
        return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    }

    // dd/mm/aaaa → ISO, o '' si todavía no es una fecha real. Con permitirCorto,
    // dd/mm/aa se toma como 20aa (sólo al confirmar, no mientras se teclea).
    function aIso(texto, permitirCorto) {
        const d = String(texto || '').replace(/\D/g, '');
        if (!(d.length === 8 || (permitirCorto && d.length === 6))) return '';
        const dia = parseInt(d.slice(0, 2), 10);
        const mes = parseInt(d.slice(2, 4), 10);
        const anio = d.length === 6 ? 2000 + parseInt(d.slice(4), 10) : parseInt(d.slice(4), 10);
        return fechaValida(anio, mes, dia) ? `${anio}-${pad2(mes)}-${pad2(dia)}` : '';
    }

    // ISO → dd/mm/aaaa.
    function aTexto(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
    }

    const VALOR = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'value');
    const VALOR_FECHA = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'valueAsDate');
    const leerNativo = (iso) => VALOR.get.call(iso);
    const asignarNativo = (iso, valor) => VALOR.set.call(iso, valor);

    // Campos que ya traen su propia máscara en el HTML (Manifiestos, Itinerario).
    function idsConMascaraPropia() {
        return new Set([...document.querySelectorAll('[data-conci-fecha-para]')].map((el) => el.dataset.conciFechaPara));
    }

    function debeMejorarse(iso, propias) {
        return iso.type === 'date'
            && iso.dataset.fechaDdmm !== '1'
            && !iso.classList.contains('conci-fecha-iso')
            && !(iso.id && propias.has(iso.id))
            && !iso.closest('td, [data-fecha-nativa]');
    }

    function etiquetaDe(iso) {
        if (iso.getAttribute('aria-label')) return iso.getAttribute('aria-label');
        if (iso.id) {
            const label = [...document.querySelectorAll('label[for]')].find((l) => l.htmlFor === iso.id);
            if (label && label.textContent.trim()) return label.textContent.trim();
        }
        return iso.title || 'Fecha';
    }

    function mejorar(iso) {
        iso.dataset.fechaDdmm = '1';
        const padre = iso.parentElement;
        const enGrupo = !!(padre && padre.classList.contains('input-group'));
        const etiqueta = etiquetaDe(iso);

        const texto = document.createElement('input');
        texto.type = 'text';
        texto.className = `${iso.className} fecha-ddmm-texto`.trim();
        texto.placeholder = 'dd/mm/aaaa';
        texto.inputMode = 'numeric';
        texto.autocomplete = 'off';
        texto.maxLength = 10;
        texto.title = iso.title || `${etiqueta} (dd/mm/aaaa)`;
        texto.setAttribute('aria-label', `${etiqueta} (dd/mm/aaaa)`);

        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = enGrupo ? 'btn btn-outline-secondary fecha-ddmm-calendario' : 'fecha-ddmm-calendario';
        boton.tabIndex = -1;
        boton.title = 'Abrir calendario';
        boton.setAttribute('aria-label', `Abrir calendario de ${etiqueta}`);
        boton.innerHTML = '<i class="far fa-calendar-alt" aria-hidden="true"></i>';

        let visibles;
        if (enGrupo) {
            // Dentro de un input-group el texto y el botón son piezas del grupo,
            // y el nativo sale del grupo para no romperle las esquinas.
            if (iso.style.width) { texto.style.width = iso.style.width; iso.style.width = ''; }
            iso.before(texto, boton);
            padre.after(iso);
            visibles = [texto, boton];
        } else {
            const grupo = document.createElement('span');
            // Un form-control es de bloque: el grupo ocupa su renglón igual que
            // él (la etiqueta queda encima) y, sin ancho propio, llena su lugar.
            grupo.className = iso.classList.contains('form-control') ? 'fecha-ddmm fecha-ddmm-bloque' : 'fecha-ddmm';
            if (iso.style.width) {
                grupo.style.width = iso.style.width;
                grupo.classList.add('fecha-ddmm-ancho');
                iso.style.width = '';
            }
            iso.before(grupo);
            grupo.append(texto, boton, iso);
            visibles = [grupo];
        }
        iso.classList.add('fecha-ddmm-nativo');
        iso.tabIndex = -1;
        iso.setAttribute('aria-hidden', 'true');

        const mostrar = () => {
            texto.value = aTexto(leerNativo(iso));
            texto.classList.remove('is-invalid');
        };
        const aplicar = (nuevo) => {
            if (leerNativo(iso) === nuevo) return;
            asignarNativo(iso, nuevo);
            iso.dispatchEvent(new Event('input', { bubbles: true }));
            iso.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const reflejarEstado = () => {
            texto.disabled = iso.disabled;
            texto.readOnly = iso.readOnly;
            texto.required = iso.required;
            boton.disabled = iso.disabled || iso.readOnly;
            const oculto = iso.hidden || iso.classList.contains('d-none') || iso.style.display === 'none';
            visibles.forEach((el) => { el.hidden = oculto; });
        };
        mostrar();
        reflejarEstado();

        Object.defineProperty(iso, 'value', {
            configurable: true,
            enumerable: true,
            get() { return leerNativo(this); },
            set(valor) { asignarNativo(this, valor); mostrar(); }
        });
        if (VALOR_FECHA && typeof VALOR_FECHA.set === 'function') {
            Object.defineProperty(iso, 'valueAsDate', {
                configurable: true,
                enumerable: true,
                get() { return VALOR_FECHA.get.call(this); },
                set(valor) { VALOR_FECHA.set.call(this, valor); mostrar(); }
            });
        }

        // El calendario escribe por dentro, sin pasar por .value, pero avisa.
        iso.addEventListener('change', mostrar);
        // Una etiqueta <label for> enfoca al nativo: el foco pasa al texto.
        iso.addEventListener('focus', () => { if (!texto.disabled) texto.focus(); });

        // Mientras se teclea sólo se da forma; el valor real se mueve cuando la
        // fecha ya está completa, para no disparar filtros a media captura.
        texto.addEventListener('input', () => {
            texto.classList.remove('is-invalid');
            const alFinal = texto.selectionStart === texto.value.length;
            texto.value = formatear(texto.value);
            if (alFinal) {
                try { texto.setSelectionRange(texto.value.length, texto.value.length); } catch (_) { /* sin soporte */ }
            }
            const nuevo = aIso(texto.value, false);
            if (nuevo) aplicar(nuevo);
        });

        // Al salir se completa el año ("15/03/26" → "15/03/2026"). Una fecha
        // imposible no mueve el valor: se marca para que se corrija.
        const confirmar = () => {
            if (!texto.value.trim()) { aplicar(''); return; }
            const nuevo = aIso(texto.value, true);
            if (nuevo) {
                aplicar(nuevo);
                texto.value = aTexto(nuevo);
            } else {
                texto.classList.add('is-invalid');
            }
        };
        texto.addEventListener('blur', confirmar);
        texto.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') confirmar();
            else if (ev.key === 'Escape') mostrar();
        });

        boton.addEventListener('click', () => {
            if (typeof iso.showPicker === 'function') {
                try { iso.showPicker(); return; } catch (_) { /* sigue al respaldo */ }
            }
            iso.click();
        });

        if (root.MutationObserver) {
            new MutationObserver(reflejarEstado).observe(iso, {
                attributes: true,
                attributeFilter: ['disabled', 'readonly', 'required', 'hidden', 'class', 'style']
            });
        }
    }

    function mejorarEn(nodos) {
        const propias = idsConMascaraPropia();
        (Array.isArray(nodos) ? nodos : [nodos]).forEach((nodo) => {
            if (!nodo || nodo.nodeType !== 1) return;
            const candidatos = nodo.matches('input[type="date"]') ? [nodo] : [...nodo.querySelectorAll('input[type="date"]')];
            candidatos.forEach((iso) => {
                if (!debeMejorarse(iso, propias)) return;
                try { mejorar(iso); } catch (error) { console.warn('No se pudo dar formato dd/mm/aaaa a un campo de fecha:', error); }
            });
        });
    }

    let observando = false;
    function iniciar() {
        mejorarEn(document.documentElement);
        if (observando || !root.MutationObserver) return;
        observando = true;
        // Los campos que se crean después (formularios, modales, pestañas que
        // se arman por código) también se acomodan al llegar a la página.
        new MutationObserver((cambios) => {
            const nodos = [];
            cambios.forEach((c) => {
                if (c.type === 'attributes') {
                    if (c.target.type === 'date') nodos.push(c.target);
                    return;
                }
                c.addedNodes.forEach((n) => { if (n.nodeType === 1) nodos.push(n); });
            });
            if (nodos.length) mejorarEn(nodos);
        }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
    }

    root.FechaDdmm = { formatear, aIso, aTexto, mejorar: mejorarEn };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
