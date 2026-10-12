(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DocumentoFoto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    /* Foto de un documento (INE, licencia, TIA) en el portal del QR.

       Dos caminos: "Tomar foto" abre la cámara del celular (capture) y "Subir
       foto" deja elegir de la galería o de la computadora. Antes de aceptarla se
       revisa que se pueda leer —oscura, deslumbrada, borrosa o muy chica— y se
       avisa sin bloquear: la persona decide si la repite. La imagen se reduce a
       1600 px y se guarda como JPEG, igual que antes. */

    const LADO_MAX = 1600;
    const CALIDAD_JPEG = 0.82;
    const MB = 1024 * 1024;

    /** Lo que se guardó antes y no es imagen ("0", "P", "Pendiente") no cuenta
        como foto: el registro de origen usaba esas marcas. */
    function esImagen(valor) {
        return /^(data:image\/|https?:\/\/|storage:\/\/)/i.test(String(valor || '').trim());
    }

    /**
     * Mide qué tan legible es una foto a partir de sus pixeles en gris.
     * gris: Uint8 (0-255) de ancho×alto, ya reducida (≈400 px de ancho).
     * Devuelve { brillo, reflejo, nitidez, avisos[] }.
     */
    function medirLegibilidad(gris, ancho, alto, original) {
        const n = ancho * alto;
        let suma = 0, quemados = 0;
        for (let i = 0; i < n; i++) { suma += gris[i]; if (gris[i] >= 250) quemados++; }
        const brillo = n ? suma / n : 0;
        const reflejo = n ? quemados / n : 0;

        // Varianza del laplaciano: con texto enfocado los bordes son fuertes; en
        // una foto movida o desenfocada casi no hay.
        let m = 0, m2 = 0, k = 0;
        for (let y = 1; y < alto - 1; y++) {
            for (let x = 1; x < ancho - 1; x++) {
                const i = y * ancho + x;
                const lap = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - ancho] - gris[i + ancho];
                m += lap; m2 += lap * lap; k++;
            }
        }
        const nitidez = k ? (m2 / k) - Math.pow(m / k, 2) : 0;

        const avisos = [];
        const o = original || {};
        if (o.ancho && o.alto && Math.min(o.ancho, o.alto) < 600) avisos.push('tiene poca resolución');
        if (brillo < 60) avisos.push('está muy oscura');
        else if (brillo > 225) avisos.push('está muy clara');
        if (reflejo > 0.08) avisos.push('tiene reflejo o flash');
        if (nitidez < 40) avisos.push('se ve borrosa');
        return { brillo, reflejo, nitidez, avisos };
    }

    function leerComoDataUrl(file) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ''));
            fr.onerror = () => reject(fr.error || new Error('No se pudo leer el archivo.'));
            fr.readAsDataURL(file);
        });
    }

    function cargarImagen(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('El archivo no es una imagen que se pueda abrir.'));
            img.src = src;
        });
    }

    /** Reduce, convierte a JPEG y mide la legibilidad. */
    async function procesar(file) {
        if (!file) throw new Error('No se eligió ninguna foto.');
        if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name || '')) {
            throw new Error('Sube una foto (JPG o PNG).');
        }
        if (file.size > 25 * MB) throw new Error('La foto pesa más de 25 MB. Tómala de nuevo con menos resolución.');
        const doc = root.document;
        const img = await cargarImagen(await leerComoDataUrl(file));
        const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));
        const cvs = doc.createElement('canvas');
        cvs.width = w; cvs.height = h;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = cvs.toDataURL('image/jpeg', CALIDAD_JPEG);

        // Para medir basta una versión chica en gris.
        const mw = Math.min(400, w), mh = Math.max(1, Math.round(h * (mw / w)));
        const mini = doc.createElement('canvas');
        mini.width = mw; mini.height = mh;
        const mctx = mini.getContext('2d');
        mctx.drawImage(cvs, 0, 0, mw, mh);
        const px = mctx.getImageData(0, 0, mw, mh).data;
        const gris = new Uint8ClampedArray(mw * mh);
        for (let i = 0, j = 0; i < px.length; i += 4, j++) gris[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const calidad = medirLegibilidad(gris, mw, mh, { ancho: img.width, alto: img.height });
        return { dataUrl, calidad };
    }

    const escHtml = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const ICONO_CAMARA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
    const ICONO_SUBIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
    const ICONO_ID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.2"/><circle cx="8.5" cy="11" r="2.3"/><path d="M5.5 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3M14 10h4.5M14 13h3"/></svg>';

    const CSS = `
.df{border:1.5px dashed #b9cfec;border-radius:13px;background:#f7fbff;padding:12px;display:flex;flex-direction:column;gap:10px}
.df.df-lista{border-style:solid;border-color:#bfe3cf;background:#f5fbf7}
.df.df-aviso{border-color:#f0d39a;background:#fffaf0}
.df-cab{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:.82rem;font-weight:700;color:var(--ink-soft,#3d5470)}
.df-vista{display:flex;align-items:center;justify-content:center;min-height:120px;border-radius:10px;background:#fff;border:1px solid #e3ebf6;overflow:hidden}
.df-vista img{display:block;max-width:100%;max-height:200px;object-fit:contain}
.df-vacia{display:flex;flex-direction:column;align-items:center;gap:4px;color:#9fb0c6;font-size:.8rem;padding:14px;text-align:center}
.df-vacia svg{width:44px;height:44px}
.df-acciones{display:flex;flex-wrap:wrap;gap:8px}
.df-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1 1 130px;min-height:42px;padding:0 12px;border-radius:10px;
  border:1px solid #d6e1f0;background:#fff;color:var(--ink-soft,#3d5470);font-weight:600;font-size:.85rem;cursor:pointer;overflow:hidden}
.df-btn:hover{border-color:var(--accent,#1a73e8);color:var(--accent-dark,#0b57c9)}
.df-btn.df-prim{background:var(--accent,#1a73e8);border-color:var(--accent,#1a73e8);color:#fff}
.df-btn svg{width:18px;height:18px;flex:none}
.df-btn input{position:absolute;inset:0;opacity:0;cursor:pointer;font-size:0}
.df-quitar{flex:0 0 auto;border:0;background:none;color:#b42318;font-weight:600;font-size:.8rem;padding:0 4px;cursor:pointer;text-decoration:underline}
.df-estado{font-size:.8rem;line-height:1.4;color:var(--muted,#6b7d95)}
.df-estado.ok{color:#0f6b43}
.df-estado.warn{color:#8a5300}
.df-estado.err{color:#b42318}
`;

    function estilos(doc) {
        if (doc.getElementById('df-estilos')) return;
        const st = doc.createElement('style');
        st.id = 'df-estilos';
        st.textContent = CSS;
        doc.head.appendChild(st);
    }

    /**
     * Pinta el recuadro de una foto.
     * opts.contenedor, opts.titulo, opts.etiqueta ('Obligatorio' | 'Opcional'),
     * opts.valor (lo guardado), opts.alCambiar(dataUrl | '')
     */
    function conectar(opts) {
        const doc = opts.contenedor.ownerDocument;
        estilos(doc);
        const cont = opts.contenedor;
        const tag = opts.etiqueta === 'Obligatorio'
            ? '<span class="req-tag">Obligatorio</span>' : '<span class="opt-tag">' + escHtml(opts.etiqueta || 'Opcional') + '</span>';
        cont.innerHTML =
            '<div class="df">'
            + '<div class="df-cab">' + escHtml(opts.titulo) + ' ' + tag + '</div>'
            + '<div class="df-vista"></div>'
            + '<div class="df-acciones">'
            + '<label class="df-btn df-prim">' + ICONO_CAMARA + 'Tomar foto'
            + '<input type="file" accept="image/*" capture="environment" aria-label="Tomar foto de ' + escHtml(opts.titulo) + ' con la cámara"></label>'
            + '<label class="df-btn">' + ICONO_SUBIR + 'Subir foto'
            + '<input type="file" accept="image/*" aria-label="Subir foto de ' + escHtml(opts.titulo) + '"></label>'
            + '<button type="button" class="df-quitar" hidden>Quitar</button>'
            + '</div>'
            + '<div class="df-estado" aria-live="polite"></div>'
            + '</div>';

        const caja = cont.querySelector('.df');
        const vista = cont.querySelector('.df-vista');
        const estado = cont.querySelector('.df-estado');
        const quitar = cont.querySelector('.df-quitar');
        let valor = String(opts.valor || '').trim();

        const decir = (texto, cls) => { estado.className = 'df-estado' + (cls ? ' ' + cls : ''); estado.textContent = texto; };

        function pintar() {
            caja.classList.toggle('df-lista', esImagen(valor));
            quitar.hidden = !esImagen(valor);
            if (/^data:image\//.test(valor) || /^https?:\/\//.test(valor)) {
                vista.innerHTML = '<img alt="' + escHtml(opts.titulo) + '" src="' + escHtml(valor) + '">';
            } else if (esImagen(valor)) {
                // Subida por el área al almacenamiento privado: desde aquí no se ve.
                vista.innerHTML = '<div class="df-vacia">' + ICONO_ID + '<span>Ya hay una foto guardada. Sube otra sólo si quieres cambiarla.</span></div>';
            } else {
                vista.innerHTML = '<div class="df-vacia">' + ICONO_ID + '<span>Aún no hay foto</span></div>';
            }
        }

        async function recibir(input) {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            decir('Revisando la foto…');
            caja.classList.remove('df-aviso');
            try {
                const { dataUrl, calidad } = await procesar(file);
                valor = dataUrl;
                pintar();
                if (calidad.avisos.length) {
                    caja.classList.add('df-aviso');
                    decir('⚠ La foto ' + calidad.avisos.join(', ') + '. Revisa que se lean todos los datos; si no, tómala de nuevo.', 'warn');
                } else {
                    decir('✓ Foto lista. Revisa que se lean todos los datos.', 'ok');
                }
                if (typeof opts.alCambiar === 'function') opts.alCambiar(valor);
            } catch (e) {
                decir(e && e.message ? e.message : 'No se pudo usar esa foto.', 'err');
            }
        }

        cont.querySelectorAll('input[type=file]').forEach(inp => inp.addEventListener('change', () => recibir(inp)));
        quitar.addEventListener('click', () => {
            valor = '';
            caja.classList.remove('df-aviso');
            pintar();
            decir('');
            if (typeof opts.alCambiar === 'function') opts.alCambiar('');
        });

        pintar();
        return {
            valor: () => valor,
            poner(v) { valor = String(v || '').trim(); caja.classList.remove('df-aviso'); decir(''); pintar(); },
        };
    }

    /* ---------- CV: sólo PDF ---------- */

    const CV_MAX = 5 * MB;

    /** Valida que el CV sea PDF de verdad (tipo, extensión y la firma %PDF del
        archivo) y que no pase de 5 MB. Devuelve el data URL. */
    async function leerCv(file) {
        if (!file) throw new Error('No se eligió ningún archivo.');
        const pareceUnPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        if (!pareceUnPdf) throw new Error('El CV tiene que ser PDF. Si lo tienes en Word, guárdalo como PDF.');
        if (file.size > CV_MAX) throw new Error('El PDF pesa ' + (file.size / MB).toFixed(1) + ' MB; el máximo es 5 MB.');
        const cabeza = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(new Uint8Array(fr.result || new ArrayBuffer(0)));
            fr.onerror = () => reject(fr.error || new Error('No se pudo leer el archivo.'));
            fr.readAsArrayBuffer(file.slice(0, 5));
        });
        if (String.fromCharCode.apply(null, Array.from(cabeza)) !== '%PDF-') {
            throw new Error('Ese archivo no es un PDF válido. Vuelve a guardarlo como PDF.');
        }
        const dataUrl = await leerComoDataUrl(file);
        return dataUrl.replace(/^data:[^;,]*/, 'data:application/pdf');
    }

    return Object.freeze({ esImagen, medirLegibilidad, procesar, conectar, leerCv, CV_MAX });
});
