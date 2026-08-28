/* =============================================================================
   AIFA OPERACIONES · Visor de fotos e identificaciones
   js/colab-visor-imagenes.js

   POR QUÉ EXISTE
   --------------
   La foto del colaborador se muestra en 110x130 px y las identificaciones en
   recuadros de 16:10 recortados con object-fit:cover. A ese tamaño no se
   distingue una cara, no se lee un número de INE y la mitad de una credencial
   queda fuera del encuadre. El archivo original casi siempre tiene resolución
   de sobra: el problema era que no había forma de verlo.

   QUÉ AGREGA
   ----------
   · Al pasar el mouse: una vista previa flotante, ya sin recorte y varias
     veces más grande, sin necesidad de hacer clic.
   · Al hacer clic: pantalla completa, con acercamiento, arrastre y paso entre
     las identificaciones de la misma persona con las flechas.
   · Descargar el archivo tal como está guardado, sin recompresión.

   CÓMO SE ENGANCHA
   ----------------
   Por delegación desde `document`, no recorriendo elementos al arrancar. Las
   fotos se resuelven contra Supabase de forma asíncrona (las de documentos
   además con URL firmada y con caducidad), así que al cargar la página muchas
   todavía no existen; y al cambiar de colaborador se reemplazan. Delegar evita
   por completo esa carrera: cualquier imagen que aparezca después queda
   cubierta sin volver a registrar nada.
   ============================================================================= */

(function () {
    'use strict';

    // Todo <img> dentro de estas zonas entra al visor. Se apunta a los
    // contenedores y no a ids concretos para que una identificación nueva
    // —otra credencial, un gafete— quede cubierta con solo agregar su recuadro.
    const SELECTOR = [
        '#colab-avatar-wrap img',
        '.colab-doc-photo-frame img',
        '.cedit-doc-upload-preview img',
    ].join(', ');

    const RETARDO_PREVIA = 260;   // ms antes de asomar la vista previa
    const ANCHO_PREVIA   = 460;   // px, tope del lado mayor de la previa
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 8;

    /* ── Estado ─────────────────────────────────────────────────────────── */
    let _previa      = null;   // nodo de la vista previa flotante
    let _temporizador = null;
    let _imgActual   = null;   // <img> del que salió la previa
    let _visor       = null;   // nodo del visor a pantalla completa
    let _grupo       = [];     // imágenes hermanas, para las flechas
    let _indice      = 0;
    let _zoom        = 1;
    let _desplaz     = { x: 0, y: 0 };
    let _arrastre    = null;
    let _urlObjeto   = null;   // blob en uso; se libera al cerrar
    let _bloqueoPropio = false; // ¿el scroll lo bloqueó este visor o el modal?

    /* ── Utilidades ─────────────────────────────────────────────────────── */

    // Una imagen sirve solo si de verdad se pintó. Los recuadros vacíos
    // conservan su <img> con display:none y src vacío, y sobre esos no debe
    // aparecer nada.
    function utilizable(img) {
        if (!img || img.tagName !== 'IMG') return false;
        if (img.hidden) return false;
        const src = img.getAttribute('src') || '';
        if (!src.trim()) return false;
        if (getComputedStyle(img).display === 'none') return false;
        // naturalWidth es 0 mientras carga o si el archivo falló.
        return img.complete ? img.naturalWidth > 0 : true;
    }

    function fuente(img) {
        return img.currentSrc || img.src || '';
    }

    // El nombre del recuadro ("INE Frente", "TIA / Credencial AIFA") vive en el
    // <label> o el título de la tarjeta; para la foto de perfil no hay ninguno.
    function etiqueta(img) {
        const tarjeta = img.closest('.colab-doc-photo, .cedit-doc-upload-card');
        const titulo = tarjeta && tarjeta.querySelector('label, .cedit-doc-upload-title');
        const texto = titulo && titulo.textContent.trim();
        if (texto) return texto;
        if (img.closest('#colab-avatar-wrap')) return 'Fotografía';
        return (img.getAttribute('alt') || 'Imagen').trim();
    }

    function nombreColaborador() {
        const el = document.getElementById('colab-h-nombre');
        const t = el && el.textContent.trim();
        return (t && t !== '—') ? t : '';
    }

    function numeroColaborador() {
        const el = document.getElementById('colab-h-numero');
        const t = el && el.textContent.trim();
        return (t && t !== '—') ? t : '';
    }

    // Nombre con el que se guarda el archivo. La URL no sirve: la de documentos
    // viene firmada y termina en un identificador ilegible.
    function nombreArchivo(img) {
        const partes = [numeroColaborador(), nombreColaborador(), etiqueta(img)].filter(Boolean);
        const base = (partes.join(' - ') || 'imagen')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        const url = fuente(img).split('?')[0];
        const ext = (url.match(/\.(jpe?g|png|webp|gif|avif)$/i) || [, 'jpg'])[1];
        return `${base}.${ext.toLowerCase()}`;
    }

    // Las identificaciones de una misma persona son un grupo: teniendo una
    // abierta se pasa a las demás con las flechas, sin cerrar y volver a abrir.
    function grupoDe(img) {
        const zona = img.closest('#colab-doc-photos-wrap, .cedit-doc-upload-grid');
        if (!zona) return [img];
        const hermanas = Array.from(zona.querySelectorAll('img')).filter(utilizable);
        return hermanas.length ? hermanas : [img];
    }

    /* ── Vista previa al pasar el mouse ─────────────────────────────────── */

    function crearPrevia() {
        if (_previa) return _previa;
        _previa = document.createElement('div');
        _previa.className = 'cvi-previa';
        _previa.setAttribute('aria-hidden', 'true');   // el visor es la vía accesible
        _previa.innerHTML =
            '<img alt="">' +
            '<div class="cvi-previa-pie"><span class="cvi-previa-txt"></span>' +
            '<span class="cvi-previa-tip">Clic para ampliar</span></div>';
        document.body.appendChild(_previa);
        return _previa;
    }

    // Se coloca al costado y, si no cabe, del otro lado o encima. Va en
    // position:fixed para no depender de los contenedores con overflow:hidden
    // que tienen los recuadros.
    function colocarPrevia(img) {
        const p = _previa;
        const r = img.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        const margen = 12;

        let x = r.right + margen;
        if (x + pr.width > window.innerWidth - margen) x = r.left - pr.width - margen;
        if (x < margen) x = Math.max(margen, (window.innerWidth - pr.width) / 2);

        let y = r.top + r.height / 2 - pr.height / 2;
        if (y + pr.height > window.innerHeight - margen) y = window.innerHeight - pr.height - margen;
        if (y < margen) y = margen;

        p.style.left = Math.round(x) + 'px';
        p.style.top  = Math.round(y) + 'px';
    }

    function abrirPrevia(img) {
        const p = crearPrevia();
        const im = p.querySelector('img');
        im.src = fuente(img);
        im.alt = etiqueta(img);
        p.querySelector('.cvi-previa-txt').textContent = etiqueta(img);
        p.style.maxWidth = ANCHO_PREVIA + 'px';
        p.classList.add('visible');
        _imgActual = img;
        // Se mide una vez pintada; si aún no tiene alto se recoloca al cargar.
        colocarPrevia(img);
        if (!im.complete) im.addEventListener('load', () => {
            if (_imgActual === img) colocarPrevia(img);
        }, { once: true });
    }

    function cerrarPrevia() {
        clearTimeout(_temporizador);
        _temporizador = null;
        _imgActual = null;
        if (_previa) _previa.classList.remove('visible');
    }

    /* ── Visor a pantalla completa ──────────────────────────────────────── */

    function crearVisor() {
        if (_visor) return _visor;
        _visor = document.createElement('div');
        _visor.className = 'cvi-visor';
        _visor.setAttribute('role', 'dialog');
        _visor.setAttribute('aria-modal', 'true');
        _visor.setAttribute('aria-label', 'Visor de imagen');
        _visor.innerHTML = `
            <div class="cvi-barra">
                <div class="cvi-titulo"><span class="cvi-titulo-doc"></span><span class="cvi-titulo-persona"></span></div>
                <div class="cvi-acciones">
                    <button type="button" class="cvi-btn" data-cvi="alejar"  title="Alejar (tecla -)"><i class="fas fa-magnifying-glass-minus"></i></button>
                    <span class="cvi-zoom">100%</span>
                    <button type="button" class="cvi-btn" data-cvi="acercar" title="Acercar (tecla +)"><i class="fas fa-magnifying-glass-plus"></i></button>
                    <button type="button" class="cvi-btn" data-cvi="ajustar" title="Ajustar a la pantalla (tecla 0)"><i class="fas fa-expand"></i></button>
                    <span class="cvi-sep"></span>
                    <button type="button" class="cvi-btn" data-cvi="descargar" title="Descargar"><i class="fas fa-download"></i><span>Descargar</span></button>
                    <button type="button" class="cvi-btn" data-cvi="pestana" title="Abrir en una pestaña nueva"><i class="fas fa-arrow-up-right-from-square"></i></button>
                    <button type="button" class="cvi-btn cvi-btn-cerrar" data-cvi="cerrar" title="Cerrar (Esc)"><i class="fas fa-xmark"></i></button>
                </div>
            </div>
            <button type="button" class="cvi-nav cvi-nav-ant" data-cvi="anterior" title="Anterior (←)"><i class="fas fa-chevron-left"></i></button>
            <button type="button" class="cvi-nav cvi-nav-sig" data-cvi="siguiente" title="Siguiente (→)"><i class="fas fa-chevron-right"></i></button>
            <div class="cvi-lienzo"><img class="cvi-img" alt=""></div>
            <div class="cvi-pie"><span class="cvi-medidas"></span><span class="cvi-ayuda">Rueda para acercar · arrastra para mover · doble clic alterna</span></div>`;
        document.body.appendChild(_visor);

        _visor.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-cvi]');
            if (btn) { e.preventDefault(); accion(btn.dataset.cvi); return; }
            // Clic en el fondo vacío cierra; sobre la imagen no, para no
            // cerrarla sin querer al terminar de arrastrar.
            if (e.target === _visor || e.target.classList.contains('cvi-lienzo')) cerrarVisor();
        });

        const lienzo = _visor.querySelector('.cvi-lienzo');
        lienzo.addEventListener('wheel', alRodar, { passive: false });
        lienzo.addEventListener('mousedown', alPresionar);
        lienzo.addEventListener('dblclick', () => (_zoom > 1 ? ajustar() : acercar(2.5)));
        window.addEventListener('mousemove', alMover);
        window.addEventListener('mouseup', alSoltar);
        return _visor;
    }

    function abrirVisor(img) {
        cerrarPrevia();
        crearVisor();
        _grupo  = grupoDe(img);
        _indice = Math.max(0, _grupo.indexOf(img));
        mostrar();
        _visor.classList.add('abierto');
        // El visor puede abrirse encima del modal de edición, que ya bloqueó el
        // scroll por su cuenta. Solo se toca si el bloqueo es nuestro; si no,
        // al cerrar el visor el fondo volvería a desplazarse con el modal
        // todavía abierto.
        _bloqueoPropio = !document.body.classList.contains('modal-open');
        if (_bloqueoPropio) document.body.classList.add('cvi-sin-scroll');
        _visor.querySelector('.cvi-btn-cerrar').focus();
    }

    function mostrar() {
        const img = _grupo[_indice];
        if (!img) return;
        const destino = _visor.querySelector('.cvi-img');
        destino.src = fuente(img);
        destino.alt = etiqueta(img);
        _visor.querySelector('.cvi-titulo-doc').textContent = etiqueta(img);
        const persona = [numeroColaborador() && ('No. ' + numeroColaborador()), nombreColaborador()]
            .filter(Boolean).join(' · ');
        _visor.querySelector('.cvi-titulo-persona').textContent = persona;

        const hayVarias = _grupo.length > 1;
        _visor.querySelectorAll('.cvi-nav').forEach(b => b.classList.toggle('d-none', !hayVarias));

        ajustar();
        const medidas = _visor.querySelector('.cvi-medidas');
        const poner = () => {
            medidas.textContent = destino.naturalWidth
                ? `${destino.naturalWidth} × ${destino.naturalHeight} px`
                : '';
        };
        destino.complete ? poner() : destino.addEventListener('load', poner, { once: true });
    }

    function cerrarVisor() {
        if (!_visor) return;
        _visor.classList.remove('abierto');
        if (_bloqueoPropio) document.body.classList.remove('cvi-sin-scroll');
        _bloqueoPropio = false;
        if (_urlObjeto) { URL.revokeObjectURL(_urlObjeto); _urlObjeto = null; }
    }

    const abierto = () => !!_visor && _visor.classList.contains('abierto');

    /* ── Acercamiento y arrastre ────────────────────────────────────────── */

    function aplicar() {
        const im = _visor.querySelector('.cvi-img');
        im.style.transform = `translate(${_desplaz.x}px, ${_desplaz.y}px) scale(${_zoom})`;
        im.classList.toggle('cvi-movible', _zoom > 1);
        _visor.querySelector('.cvi-zoom').textContent = Math.round(_zoom * 100) + '%';
    }

    function ajustar() {
        _zoom = 1;
        _desplaz = { x: 0, y: 0 };
        aplicar();
    }

    function acercar(factor) {
        _zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, _zoom * factor));
        if (_zoom === 1) _desplaz = { x: 0, y: 0 };
        aplicar();
    }

    function alRodar(e) {
        e.preventDefault();
        acercar(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }

    function alPresionar(e) {
        if (_zoom <= 1 || e.button !== 0) return;
        e.preventDefault();
        _arrastre = { x: e.clientX - _desplaz.x, y: e.clientY - _desplaz.y };
    }

    function alMover(e) {
        if (!_arrastre) return;
        _desplaz = { x: e.clientX - _arrastre.x, y: e.clientY - _arrastre.y };
        aplicar();
    }

    function alSoltar() { _arrastre = null; }

    /* ── Descarga ───────────────────────────────────────────────────────── */

    // El atributo `download` de un enlace se ignora cuando el archivo viene de
    // otro dominio, y estos vienen de Supabase: el navegador abriría la imagen
    // en lugar de guardarla. Por eso se baja el archivo y se guarda el blob.
    // Si el navegador bloquea esa lectura, al menos se abre en otra pestaña.
    async function descargar() {
        const img = _grupo[_indice];
        if (!img) return;
        const url = fuente(img);
        const btn = _visor.querySelector('[data-cvi="descargar"]');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Descargando…</span>';
        try {
            const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            if (_urlObjeto) URL.revokeObjectURL(_urlObjeto);
            _urlObjeto = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = _urlObjeto;
            a.download = nombreArchivo(img);
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err) {
            console.warn('[Visor] No se pudo descargar directamente; se abre en otra pestaña.', err);
            window.open(url, '_blank', 'noopener');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function accion(cual) {
        switch (cual) {
            case 'cerrar':    cerrarVisor(); break;
            case 'acercar':   acercar(1.4); break;
            case 'alejar':    acercar(1 / 1.4); break;
            case 'ajustar':   ajustar(); break;
            case 'descargar': descargar(); break;
            case 'pestana':   window.open(fuente(_grupo[_indice]), '_blank', 'noopener'); break;
            case 'anterior':  _indice = (_indice - 1 + _grupo.length) % _grupo.length; mostrar(); break;
            case 'siguiente': _indice = (_indice + 1) % _grupo.length; mostrar(); break;
        }
    }

    /* ── Enganche por delegación ────────────────────────────────────────── */

    document.addEventListener('mouseover', (e) => {
        const img = e.target.closest(SELECTOR);
        if (!img || !utilizable(img) || img === _imgActual || abierto()) return;
        clearTimeout(_temporizador);
        _temporizador = setTimeout(() => abrirPrevia(img), RETARDO_PREVIA);
    });

    document.addEventListener('mouseout', (e) => {
        const img = e.target.closest(SELECTOR);
        if (!img) return;
        // Salir hacia un hijo del mismo elemento no cuenta como salir.
        if (e.relatedTarget && img.contains(e.relatedTarget)) return;
        cerrarPrevia();
    });

    document.addEventListener('click', (e) => {
        const img = e.target.closest(SELECTOR);
        if (!img || !utilizable(img)) return;
        e.preventDefault();
        abrirVisor(img);
    });

    // La previa queda anclada a una posición de pantalla; al desplazar o
    // redimensionar dejaría de corresponder con su recuadro.
    window.addEventListener('scroll', cerrarPrevia, true);
    window.addEventListener('resize', cerrarPrevia);

    document.addEventListener('keydown', (e) => {
        if (!abierto()) return;
        // Con el visor encima de un modal, Bootstrap también escucha Esc: sin
        // frenar la propagación se cerrarían los dos de un solo golpe.
        e.stopPropagation();
        switch (e.key) {
            case 'Escape':     e.preventDefault(); cerrarVisor(); break;
            case 'ArrowLeft':  e.preventDefault(); accion('anterior'); break;
            case 'ArrowRight': e.preventDefault(); accion('siguiente'); break;
            case '+': case '=': e.preventDefault(); acercar(1.4); break;
            case '-': case '_': e.preventDefault(); acercar(1 / 1.4); break;
            case '0':          e.preventDefault(); ajustar(); break;
        }
    });

    /* ── Estilos ────────────────────────────────────────────────────────── */

    const CSS = `
    /* Señal de que el recuadro se puede abrir. Solo sobre imágenes ya
       cargadas: un recuadro vacío no debe invitar al clic. */
    #colab-avatar-wrap img, .colab-doc-photo-frame img, .cedit-doc-upload-preview img {
        cursor: zoom-in;
        transition: transform .18s ease, filter .18s ease;
    }
    #colab-avatar-wrap:hover img,
    .colab-doc-photo-frame:hover img,
    .cedit-doc-upload-preview:hover img { transform: scale(1.04); filter: brightness(1.04); }

    .cvi-previa {
        position: fixed; z-index: 4000; left: 0; top: 0;
        background: #fff; border-radius: 14px; padding: 8px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, .28), 0 0 0 1px rgba(15, 23, 42, .08);
        opacity: 0; visibility: hidden; transform: scale(.97);
        transition: opacity .14s ease, transform .14s ease, visibility .14s;
        pointer-events: none;   /* nunca se interpone al mouse */
    }
    .cvi-previa.visible { opacity: 1; visibility: visible; transform: scale(1); }
    .cvi-previa img {
        display: block; max-width: 100%; max-height: 62vh;
        width: auto; height: auto;
        object-fit: contain;        /* sin recorte: la cara completa */
        border-radius: 8px; background: #f1f5f9;
    }
    .cvi-previa-pie {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 7px 4px 2px; font-size: .78rem;
    }
    .cvi-previa-txt { font-weight: 600; color: #0f172a; }
    .cvi-previa-tip { color: #64748b; }

    body.cvi-sin-scroll { overflow: hidden; }

    .cvi-visor {
        position: fixed; inset: 0; z-index: 4100;
        background: rgba(8, 12, 24, .93);
        display: none; flex-direction: column;
        backdrop-filter: blur(3px);
    }
    .cvi-visor.abierto { display: flex; }

    .cvi-barra {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 10px 16px; flex-wrap: wrap;
        border-bottom: 1px solid rgba(255, 255, 255, .10);
    }
    .cvi-titulo { display: flex; flex-direction: column; min-width: 0; }
    .cvi-titulo-doc { color: #fff; font-weight: 600; font-size: .95rem; }
    .cvi-titulo-persona { color: #94a3b8; font-size: .78rem; }
    .cvi-acciones { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cvi-zoom { color: #cbd5e1; font-size: .78rem; min-width: 46px; text-align: center; font-variant-numeric: tabular-nums; }
    .cvi-sep { width: 1px; height: 20px; background: rgba(255, 255, 255, .15); margin: 0 4px; }
    .cvi-btn {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(255, 255, 255, .09); color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, .12); border-radius: 9px;
        padding: 7px 11px; font-size: .82rem; line-height: 1; cursor: pointer;
        transition: background .15s ease, color .15s ease;
    }
    .cvi-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .18); color: #fff; }
    .cvi-btn:disabled { opacity: .6; cursor: default; }
    .cvi-btn-cerrar:hover { background: #dc2626; border-color: #dc2626; }

    .cvi-lienzo {
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow: hidden; padding: 18px; min-height: 0;
    }
    .cvi-img {
        max-width: 100%; max-height: 100%;
        object-fit: contain;               /* la imagen completa, sin recortar */
        image-orientation: from-image;     /* respeta el EXIF de las fotos de celular */
        border-radius: 6px;
        transform-origin: center center;
        transition: transform .12s ease-out;
        user-select: none; -webkit-user-drag: none;
    }
    .cvi-img.cvi-movible { cursor: grab; }
    .cvi-img.cvi-movible:active { cursor: grabbing; transition: none; }

    .cvi-nav {
        position: absolute; top: 50%; transform: translateY(-50%);
        width: 46px; height: 46px; border-radius: 50%;
        background: rgba(255, 255, 255, .10); color: #fff;
        border: 1px solid rgba(255, 255, 255, .14);
        cursor: pointer; z-index: 1; transition: background .15s ease;
    }
    .cvi-nav:hover { background: rgba(255, 255, 255, .22); }
    .cvi-nav-ant { left: 16px; }
    .cvi-nav-sig { right: 16px; }

    .cvi-pie {
        display: flex; align-items: center; justify-content: space-between;
        gap: 14px; padding: 9px 18px; flex-wrap: wrap;
        color: #94a3b8; font-size: .76rem;
        border-top: 1px solid rgba(255, 255, 255, .10);
    }
    .cvi-medidas { font-variant-numeric: tabular-nums; }

    @media (max-width: 640px) {
        .cvi-previa { display: none; }              /* sin mouse no hay hover */
        .cvi-btn span { display: none; }            /* solo los iconos */
        .cvi-ayuda { display: none; }
        .cvi-nav { width: 38px; height: 38px; }
    }
    @media (prefers-reduced-motion: reduce) {
        .cvi-previa, .cvi-img,
        #colab-avatar-wrap img, .colab-doc-photo-frame img, .cedit-doc-upload-preview img {
            transition: none;
        }
    }`;

    const estilo = document.createElement('style');
    estilo.id = 'cvi-estilos';
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    // Se expone lo mínimo para poder abrir el visor desde otro módulo.
    window.colabVisorImagenes = {
        abrir: abrirVisor,
        cerrar: cerrarVisor,
        SELECTOR,
    };
})();
