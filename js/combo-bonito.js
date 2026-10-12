(function (root) {
    'use strict';

    /* Combo bonito: dibuja encima de un <select> nativo un botón y una lista
       propia (con buscador, grupos y el nivel como etiqueta). El select sigue
       siendo la fuente de verdad: la lista sólo le pone el value y dispara
       'change', y un MutationObserver vuelve a pintar cuando el código le
       cambia las opciones, las clases (is-invalid) o el disabled. */

    if (!root || !root.document) return;
    const doc = root.document;

    /* Los colores se pueden cambiar por página con variables CSS (el portal
       del QR usa su azul): --cb-acento, --cb-acento-sombra, --cb-hover,
       --cb-suave, --cb-grupo-fondo, --cb-grupo-texto, --cb-fondo, --cb-borde. */
    const CSS = `
.cb-wrap{position:relative;display:block}
.cb-wrap.cb-inline{display:inline-flex;vertical-align:middle}
.cb-native{opacity:0!important;pointer-events:none!important}
.cb-btn{position:absolute;inset:0;display:flex;align-items:center;gap:.5rem;width:100%;margin:0;padding:0 .7rem 0 .75rem;
  font-size:1rem;line-height:1.2;text-align:left;color:#1f2937;background:var(--cb-fondo,#fff);border:1px solid var(--cb-borde,#dee2e6);border-radius:.6rem;
  box-shadow:0 1px 2px rgba(16,24,40,.05);transition:border-color .15s,box-shadow .15s;cursor:pointer}
.cb-btn:hover{border-color:var(--cb-hover,#a7d7b8)}
.cb-btn:focus-visible,.cb-btn.cb-open{outline:0;border-color:var(--cb-acento,#1e8a4c);box-shadow:0 0 0 .2rem var(--cb-acento-sombra,rgba(30,138,76,.18))}
.cb-btn.is-invalid{border-color:#dc3545;box-shadow:0 0 0 .2rem rgba(220,53,69,.15)}
.cb-btn:disabled{background:#f1f3f5;color:#868e96;cursor:not-allowed}
.cb-wrap:has(> .es-activo) > .cb-btn{color:#15803d;font-weight:700;background:#f0fdf4;border-color:#86efac}
.cb-wrap:has(> .es-baja) > .cb-btn{color:#b91c1c;font-weight:700;background:#fef2f2;border-color:#fca5a5}
.cb-wrap:has(> .ca-select) > .cb-btn,.cb-wrap:has(> .ca-recur-select) > .cb-btn{background:#0b1324;color:#e2e8f0;border-color:#334155}
.cb-txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-btn.cb-vacio .cb-txt{color:#8a94a6}
.cb-chev{flex:none;width:.85em;height:.85em;color:#6b7280;transition:transform .18s}
.cb-btn.cb-open .cb-chev{transform:rotate(180deg)}
.cb-tag{flex:none;font-size:.72em;font-weight:700;letter-spacing:.02em;padding:.12em .55em;border-radius:999px;
  background:#e8f5ee;color:#16733e;border:1px solid #c6e6d3}
.cb-pop{position:fixed;z-index:2000;display:flex;flex-direction:column;background:#fff;border:1px solid #e3e8ef;border-radius:.8rem;
  box-shadow:0 18px 40px -12px rgba(16,24,40,.28),0 4px 10px -4px rgba(16,24,40,.12);overflow:hidden;
  animation:cb-in .14s ease-out;font-size:.92rem}
@keyframes cb-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
.cb-pop.cb-arriba{animation-name:cb-in-up}
@keyframes cb-in-up{from{opacity:0;transform:translateY(4px) scale(.985)}to{opacity:1;transform:none}}
.cb-buscar{position:relative;padding:.55rem;border-bottom:1px solid #eef1f5;background:#fafbfc}
.cb-buscar svg{position:absolute;left:1.1rem;top:50%;transform:translateY(-50%);width:.9rem;height:.9rem;color:#9aa4b2}
.cb-buscar input{width:100%;padding:.4rem .6rem .4rem 2rem;border:1px solid #dfe4ea;border-radius:.5rem;font-size:.9rem;background:#fff;color:inherit}
.cb-buscar input:focus{outline:0;border-color:var(--cb-acento,#1e8a4c);box-shadow:0 0 0 .15rem var(--cb-acento-sombra,rgba(30,138,76,.15))}
.cb-lista{overflow-y:auto;padding:.3rem;overscroll-behavior:contain}
.cb-lista::-webkit-scrollbar{width:8px}.cb-lista::-webkit-scrollbar-thumb{background:#d5dbe3;border-radius:8px}
.cb-grupo{position:sticky;top:-.3rem;z-index:1;display:flex;align-items:center;gap:.45rem;margin:.25rem 0 .1rem;padding:.4rem .6rem;
  font-size:.7rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--cb-grupo-texto,#1e6f43);background:var(--cb-grupo-fondo,#f3faf6);border-radius:.45rem}
.cb-grupo .cb-n{margin-left:auto;font-weight:600;color:#7aa58c;letter-spacing:0}
.cb-op{display:flex;align-items:center;gap:.55rem;padding:.45rem .6rem;border-radius:.45rem;cursor:pointer;color:#1f2937}
.cb-op .cb-check{flex:none;width:.85rem;height:.85rem;color:var(--cb-acento,#1e8a4c);visibility:hidden}
.cb-op.cb-sel .cb-check{visibility:visible}
.cb-op.cb-sel{font-weight:600}
.cb-op.cb-act{background:var(--cb-suave,#eaf6ef)}
.cb-op.cb-especial{color:#6b7280;font-style:italic}
.cb-op mark{padding:0;background:#fff1a8;border-radius:2px;color:inherit}
.cb-op .cb-txt{white-space:normal}
.cb-vacia{padding:1.2rem .8rem;text-align:center;color:#8a94a6}
body.dark-mode .cb-btn{background:#1f2937;color:#e5e7eb;border-color:#374151}
body.dark-mode .cb-btn.cb-vacio .cb-txt{color:#8b95a5}
body.dark-mode .cb-pop{background:#111827;border-color:#2b3442;color:#e5e7eb}
body.dark-mode .cb-buscar{background:#0f1622;border-color:#2b3442}
body.dark-mode .cb-buscar input{background:#1f2937;border-color:#374151}
body.dark-mode .cb-grupo{background:#14261c;color:#7fd3a2}
body.dark-mode .cb-op{color:#e5e7eb}
body.dark-mode .cb-op.cb-act{background:#1d3427}
body.dark-mode .cb-tag{background:#14261c;color:#7fd3a2;border-color:#24543a}
body.dark-mode .cb-op mark{background:#5c4d0f}
`;

    function estilos() {
        if (doc.getElementById('cb-estilos')) return;
        const s = doc.createElement('style');
        s.id = 'cb-estilos';
        s.textContent = CSS;
        doc.head.appendChild(s);
    }

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const normalize = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    /* "Gerente de Carga · N32" → texto y etiqueta. */
    function partir(texto) {
        const m = /^(.*\S)\s+·\s+(\S{1,6})$/.exec(texto);
        return m ? { txt: m[1], tag: m[2] } : { txt: texto, tag: '' };
    }

    function resaltar(texto, q) {
        if (!q) return esc(texto);
        const i = normalize(texto).indexOf(q);
        if (i < 0) return esc(texto);
        return esc(texto.slice(0, i)) + '<mark>' + esc(texto.slice(i, i + q.length)) + '</mark>' + esc(texto.slice(i + q.length));
    }

    const ICONO = {
        chev: '<svg class="cb-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 5 5 5-5"/></svg>',
        check: '<svg class="cb-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5"/></svg>',
        lupa: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="m10.5 10.5 3.5 3.5"/></svg>',
    };

    let abierto = null;
    const pintores = new Set();

    /* Lo que el código le pone al select a mano (value, selectedIndex) no
       dispara eventos: se envuelven los setters una vez y, si el select tiene
       combo, se repinta el botón. */
    const PINTAR = Symbol('cbPintar');
    const ABRIR = Symbol('cbAbrir');
    (function vigilarValor() {
        const proto = root.HTMLSelectElement && root.HTMLSelectElement.prototype;
        if (!proto) return;
        ['value', 'selectedIndex'].forEach(prop => {
            const d = Object.getOwnPropertyDescriptor(proto, prop);
            if (!d || !d.set || !d.configurable) return;
            Object.defineProperty(proto, prop, Object.assign({}, d, {
                set(v) { d.set.call(this, v); if (this[PINTAR]) this[PINTAR](); },
            }));
        });
    })();

    function mejorar(sel) {
        if (!sel || sel.dataset.cb || sel.multiple || sel.size > 1 || !sel.parentNode) return;
        estilos();
        sel.dataset.cb = '1';

        // El select se queda en su lugar (invisible) para conservar el tamaño y
        // el acomodo que ya tenía; el botón se le pone encima.
        const cs = root.getComputedStyle(sel);
        const wrap = doc.createElement('div');
        wrap.className = 'cb-wrap' + (/^inline/.test(cs.display) ? ' cb-inline' : '');
        ['width', 'maxWidth', 'minWidth', 'flex', 'flexGrow', 'flexShrink', 'flexBasis'].forEach(k => {
            if (sel.style[k]) wrap.style[k] = sel.style[k];
        });
        sel.parentNode.insertBefore(wrap, sel);
        wrap.appendChild(sel);
        sel.classList.add('cb-native');
        sel.tabIndex = -1;
        sel.setAttribute('aria-hidden', 'true');

        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        const etiqueta = sel.getAttribute('aria-label')
            || (sel.id && doc.querySelector('label[for="' + sel.id + '"]') || {}).textContent;
        if (etiqueta) btn.setAttribute('aria-label', etiqueta.trim());
        // Tamaño de letra y esquinas del select original; colores sólo si los traía en línea.
        btn.style.fontSize = cs.fontSize;
        if (parseFloat(cs.borderRadius)) btn.style.borderRadius = cs.borderRadius;
        ['color', 'background', 'backgroundColor', 'border', 'borderColor', 'fontWeight'].forEach(k => {
            if (sel.style[k]) btn.style[k] = sel.style[k];
        });
        wrap.appendChild(btn);

        function pintarBoton() {
            if (!sel.isConnected && pintores.has(pintarBoton)) { pintores.delete(pintarBoton); return; }
            const op = sel.options[sel.selectedIndex];
            const p = partir(op ? op.text : '');
            btn.className = 'cb-btn'
                + (sel.classList.contains('is-invalid') ? ' is-invalid' : '')
                + (!sel.value ? ' cb-vacio' : '')
                + (abierto && abierto.sel === sel ? ' cb-open' : '');
            btn.disabled = sel.disabled;
            btn.title = sel.title || '';
            btn.innerHTML = '<span class="cb-txt">' + esc(p.txt || '—') + '</span>'
                + (p.tag ? '<span class="cb-tag">' + esc(p.tag) + '</span>' : '')
                + ICONO.chev;
            wrap.classList.toggle('d-none', sel.classList.contains('d-none') || sel.hidden || sel.style.display === 'none');
        }
        pintores.add(pintarBoton);
        sel[PINTAR] = pintarBoton;
        sel[ABRIR] = () => { if (!btn.disabled && !(abierto && abierto.sel === sel)) abrir(sel, btn, pintarBoton); };

        // El código existente hace focus() / is-invalid sobre el select: se pasa al botón.
        sel.addEventListener('focus', () => btn.focus());
        sel.addEventListener('change', pintarBoton);
        wrap.addEventListener('pointerenter', pintarBoton);
        new MutationObserver(() => {
            pintarBoton();
            if (abierto && abierto.sel === sel) abierto.pintar();
        }).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ['class', 'disabled', 'title', 'hidden', 'style'] });

        btn.addEventListener('click', () => (abierto && abierto.sel === sel ? cerrar() : abrir(sel, btn, pintarBoton)));
        btn.addEventListener('keydown', e => {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !(abierto && abierto.sel === sel)) {
                e.preventDefault();
                abrir(sel, btn, pintarBoton);
            }
        });

        pintarBoton();
    }

    function repintarTodo() { Array.from(pintores).forEach(f => f()); }

    /* Todos los select de un contenedor, también los que se pinten después. */
    function mejorarEn(contenedor) {
        if (!contenedor || contenedor.dataset.cbAuto) return;
        contenedor.dataset.cbAuto = '1';
        const pasar = () => contenedor.querySelectorAll('select:not([data-cb]):not([multiple])').forEach(s => {
            if (s.dataset.cbNo === undefined) mejorar(s);
        });
        let pendiente = false;
        new MutationObserver(() => {
            if (pendiente) return;
            pendiente = true;
            Promise.resolve().then(() => { pendiente = false; pasar(); });
        }).observe(contenedor, { childList: true, subtree: true });
        pasar();
    }

    function abrir(sel, btn, pintarBoton) {
        cerrar();
        const contenedor = btn.closest('.modal') || doc.body;
        const pop = doc.createElement('div');
        pop.className = 'cb-pop';
        pop.setAttribute('role', 'listbox');
        const conBuscador = sel.options.length > 7;
        pop.innerHTML = (conBuscador
            ? '<div class="cb-buscar">' + ICONO.lupa + '<input type="text" placeholder="Buscar…" autocomplete="off"></div>'
            : '') + '<div class="cb-lista"></div>';
        contenedor.appendChild(pop);
        const buscar = pop.querySelector('input');
        const lista = pop.querySelector('.cb-lista');

        const estado = { sel, btn, pop, activo: -1, items: [] };
        abierto = estado;

        estado.pintar = function () {
            const q = normalize(buscar ? buscar.value.trim() : '');
            let html = '';
            const items = [];
            const renglon = (op) => {
                const p = partir(op.text);
                if (q && !normalize(op.text).includes(q) && !normalize(op.parentNode.label || '').includes(q)) return '';
                const especial = !op.value || op.value.startsWith('__');
                const idx = items.push(op) - 1;
                return '<div class="cb-op' + (op.value === sel.value ? ' cb-sel' : '') + (especial ? ' cb-especial' : '')
                    + '" role="option" data-i="' + idx + '">' + ICONO.check + '<span class="cb-txt">'
                    + resaltar(p.txt, q) + '</span>' + (p.tag ? '<span class="cb-tag">' + esc(p.tag) + '</span>' : '') + '</div>';
            };
            Array.from(sel.children).forEach(n => {
                if (n.tagName === 'OPTGROUP') {
                    const ops = Array.from(n.children).map(renglon).join('');
                    if (ops) html += '<div class="cb-grupo">' + esc(n.label)
                        + '<span class="cb-n">' + n.children.length + '</span></div>' + ops;
                } else {
                    html += renglon(n);
                }
            });
            estado.items = items;
            lista.innerHTML = html || '<div class="cb-vacia">Sin coincidencias</div>';
            const actual = items.findIndex(o => o.value === sel.value);
            mover(q ? items.findIndex(o => o.value) : actual, true);
        };

        function mover(i, centrar) {
            const els = lista.querySelectorAll('.cb-op');
            if (!els.length) { estado.activo = -1; return; }
            i = Math.max(0, Math.min(els.length - 1, i));
            els.forEach(e => e.classList.remove('cb-act'));
            els[i].classList.add('cb-act');
            estado.activo = i;
            if (centrar) lista.scrollTop = els[i].offsetTop - lista.clientHeight / 2 + els[i].offsetHeight / 2;
            else els[i].scrollIntoView({ block: 'nearest' });
        }

        function elegir(i) {
            const op = estado.items[i];
            if (!op) return;
            cerrar();
            btn.focus();
            if (op.value === sel.value) return;
            sel.value = op.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            pintarBoton();
        }

        estado.posicionar = function () {
            const r = btn.getBoundingClientRect();
            const vh = root.innerHeight, vw = root.innerWidth;
            const abajo = vh - r.bottom - 12, arriba = r.top - 12;
            const haciaArriba = abajo < 260 && arriba > abajo;
            const alto = Math.min(420, haciaArriba ? arriba : abajo);
            pop.style.minWidth = Math.min(Math.max(r.width, 200), vw - 16) + 'px';
            pop.style.maxWidth = Math.min(Math.max(r.width, 460), vw - 16) + 'px';
            pop.style.left = Math.max(8, Math.min(r.left, vw - pop.offsetWidth - 8)) + 'px';
            pop.style.maxHeight = alto + 'px';
            pop.style.top = haciaArriba ? '' : (r.bottom + 6) + 'px';
            pop.style.bottom = haciaArriba ? (vh - r.top + 6) + 'px' : '';
            pop.classList.toggle('cb-arriba', haciaArriba);
        };

        lista.addEventListener('mousemove', e => {
            const o = e.target.closest('.cb-op');
            if (o && !o.classList.contains('cb-act')) mover(Number(o.dataset.i));
        });
        lista.addEventListener('mousedown', e => e.preventDefault());
        lista.addEventListener('click', e => {
            const o = e.target.closest('.cb-op');
            if (o) elegir(Number(o.dataset.i));
        });
        pop.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); mover(estado.activo + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); mover(estado.activo - 1); }
            else if (e.key === 'PageDown') { e.preventDefault(); mover(estado.activo + 8); }
            else if (e.key === 'PageUp') { e.preventDefault(); mover(estado.activo - 8); }
            else if (e.key === 'Enter') { e.preventDefault(); elegir(estado.activo); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); btn.focus(); }
            else if (e.key === 'Tab') { cerrar(); }
        });
        if (buscar) buscar.addEventListener('input', estado.pintar);
        else { pop.tabIndex = -1; }

        estado.pintar();
        estado.posicionar();
        // Ya con su altura final, la lista se centra en lo que está elegido.
        const elegido = estado.items.findIndex(o => o.value === sel.value);
        if (elegido >= 0) mover(elegido, true);
        btn.setAttribute('aria-expanded', 'true');
        pintarBoton();
        (buscar || pop).focus({ preventScroll: true });
    }

    function cerrar() {
        if (!abierto) return;
        const { pop, btn } = abierto;
        abierto = null;
        pop.remove();
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('cb-open');
    }

    doc.addEventListener('mousedown', e => {
        if (abierto && !abierto.pop.contains(e.target) && !abierto.btn.contains(e.target)) cerrar();
    }, true);
    root.addEventListener('resize', () => abierto && abierto.posicionar());
    doc.addEventListener('scroll', e => {
        if (abierto && !abierto.pop.contains(e.target)) abierto.posicionar();
    }, true);
    doc.addEventListener('hide.bs.modal', cerrar);
    // Lo que no avisa (option.selected, form.reset) se alcanza al mostrar el modal o la pestaña.
    ['shown.bs.modal', 'shown.bs.tab', 'reset'].forEach(ev => doc.addEventListener(ev, () => setTimeout(repintarTodo), true));

    function auto() { mejorarEn(doc.getElementById('colaboradores-section')); }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', auto);
    else auto();

    /** Abre por código la lista de un select ya mejorado (p. ej. la profesión
        en cuanto se elige el grado). Devuelve false si ese select no tiene combo. */
    function abrirLista(sel) {
        if (!sel || typeof sel[ABRIR] !== 'function') return false;
        sel[ABRIR]();
        return true;
    }

    root.ComboBonito = Object.freeze({ mejorar, mejorarEn, cerrar, repintarTodo, abrir: abrirLista });
})(typeof window !== 'undefined' ? window : null);
