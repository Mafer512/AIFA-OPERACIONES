(function () {
    'use strict';

    // ============================================================
    // SETP · Comparación de fotos de hallazgos ("¿Es el mismo hallazgo?")
    //  - buscar(): hallazgos pendientes que pueden ser el mismo (misma
    //    etiqueta e item; si el objeto se mueve, en todo el edificio durante
    //    24 h; si no, en el mismo nivel y local o módulo).
    //  - analizar(): compara tu foto con la de cada uno EN EL NAVEGADOR
    //    (TensorFlow.js): ubica el objeto (detector COCO-SSD), lo recorta y
    //    compara su forma (MobileNet, con espejo para tolerar otro ángulo) y
    //    su color. Las fotos no se envían a ningún servicio; sólo se
    //    descargan los modelos (una vez; luego quedan en caché).
    //  - pintar(): la vista con % de parecido, motivos y los poco parecidos
    //    plegados. Usa data-dup-mismo / data-dup="otro" / data-dup="volver".
    //  - preguntar(): la misma vista en su propia ventana (Agregar hallazgo
    //    del Reporte de hallazgos, js/setp-formato.js).
    // El % es una ayuda: nunca decide ni oculta candidatos; decide el usuario.
    // Lo usan js/setp-recorridos.js y js/setp-formato.js.
    // ============================================================

    var LIB_TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
    var LIB_COCO = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';
    var MODELO_FORMA = 'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.75_224/model.json';
    var CAPA_FORMA = 'conv_pw_13_relu';

    var UMBRAL_BAJO = 0.35;   // menos: "Poco probable" (queda plegado)
    var UMBRAL_ALTO = 0.70;   // desde aquí: "Muy probable"
    var MOVIBLE_HORAS = 24;
    var MAX_ANALIZAR = 12;    // candidatos con foto que se comparan
    var LIMITE_MS = 120000;   // carga de modelos + análisis

    // Calibración: similitud de forma (coseno) y de color (intersección de
    // histogramas) que equivalen a 0 % y 100 %.
    var FORMA_0 = 0.40, FORMA_1 = 0.85;
    var COLOR_0 = 0.25, COLOR_1 = 0.80;
    var PESO_FORMA = 0.65;

    // Objetos del detector (clases COCO) que corresponden a cada item.
    var OBJETOS = ['suitcase', 'backpack', 'handbag', 'umbrella', 'laptop', 'cell phone', 'bottle', 'book', 'teddy bear', 'sports ball', 'skateboard', 'tennis racket'];
    var CLASES = {
        'Maleta': ['suitcase'],
        'Mochila': ['backpack', 'suitcase', 'handbag'],
        'Bolsa': ['handbag', 'backpack', 'suitcase'],
        'Carrito portaequipaje': ['suitcase'],
        'Objeto olvidado': OBJETOS,
        'Butaca': ['chair', 'couch', 'bench'],
        'Banca': ['bench', 'chair', 'couch'],
        'Mesa': ['dining table'],
        'Inodoro': ['toilet'],
        'Lavabo': ['sink'],
        'Pantalla de vuelos': ['tv'],
        'Pantalla de información de vuelos': ['tv'],
        'Quiosco informativo': ['tv'],
        'Quiosco interactivo': ['tv']
    };
    var GRUPOS = [['suitcase', 'backpack', 'handbag'], ['chair', 'couch', 'bench']];
    var NOMBRE_CLASE = { suitcase: 'Maleta', backpack: 'Mochila', handbag: 'Bolsa', chair: 'Asiento', couch: 'Asiento', bench: 'Banca', 'dining table': 'Mesa', toilet: 'Inodoro', sink: 'Lavabo', tv: 'Pantalla', umbrella: 'Paraguas', laptop: 'Laptop', 'cell phone': 'Celular', bottle: 'Botella', book: 'Libro', 'teddy bear': 'Peluche', 'sports ball': 'Balón', skateboard: 'Patineta', 'tennis racket': 'Raqueta' };

    function cat() { return window.setpCatalogo; }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function clamp(x) { return Math.max(0, Math.min(1, x)); }

    function clasesDe(etiqueta, item) {
        if (CLASES[item]) return CLASES[item];
        if (etiqueta === 'EQUIPAJE') return OBJETOS;
        return null;
    }

    // ---------- búsqueda en la base ----------

    function nivelDe(n) {
        var c = cat();
        return c ? c.nivel(n) : String(n || '').trim();
    }

    // q = { etiqueta, item, nivel, modulo, local, excluir }
    async function buscar(sb, q) {
        var c = cat();
        if (!c || !q || !q.etiqueta || !q.item) return [];
        var mov = c.esMovible(q.etiqueta, q.item);
        if (q.item === c.OTRO && !mov) return [];
        var res = await sb.from('setp_hallazgos')
            .select('id, folio, fecha_reporte, created_at, modulo, local, nivel, etiqueta, item, condicion, cantidad, descripcion, evidencia_url, no_empleado, veces')
            .eq('estatus', 'PENDIENTE').is('duplicado_de', null).eq('etiqueta', q.etiqueta).eq('item', q.item)
            .order('created_at', { ascending: false }).limit(40);
        if (res.error) return [];
        var nivel = nivelDe(q.nivel);
        var desde = Date.now() - MOVIBLE_HORAS * 3600 * 1000;
        return (res.data || []).filter(function (h) {
            if (q.excluir && h.id === q.excluir) return false;
            if (mov) return new Date(h.created_at).getTime() >= desde;
            if (nivelDe(h.nivel) !== nivel) return false;
            // Mismo local o, si el local no coincide (o es "Otro lugar"), mismo módulo.
            return (q.local && h.local === q.local) || (q.modulo && h.modulo === q.modulo);
        }).sort(function (a, b) {
            var la = q.local && a.local === q.local ? 0 : 1, lb = q.local && b.local === q.local ? 0 : 1;
            return la - lb || String(b.created_at).localeCompare(String(a.created_at));
        });
    }

    // Dónde está cada candidato respecto a tu hallazgo.
    function lugar(q, h) {
        var mismoNivel = nivelDe(h.nivel) === nivelDe(q.nivel);
        if (mismoNivel && q.local && h.local === q.local) return { t: 'Mismo local', k: 'si' };
        if (mismoNivel && q.modulo && h.modulo === q.modulo) return { t: 'Mismo módulo, otro local', k: '' };
        if (mismoNivel) return { t: 'Mismo nivel', k: '' };
        return { t: 'Otro nivel', k: 'no' };
    }

    // ---------- modelos ----------

    var carga = null;
    var memo = {};   // análisis por URL de foto ya registrada

    function script(src) {
        return new Promise(function (ok, mal) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = ok;
            s.onerror = function () { s.remove(); mal(new Error('No se pudo cargar ' + src)); };
            document.head.appendChild(s);
        });
    }

    function cargar() {
        if (carga) return carga;
        carga = (async function () {
            if (!window.tf) await script(LIB_TF);
            if (!window.cocoSsd) await script(LIB_COCO);
            await window.tf.ready();
            var tf = window.tf;
            var det = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
            var base = await tf.loadLayersModel(MODELO_FORMA);
            var forma = tf.model({ inputs: base.inputs, outputs: base.getLayer(CAPA_FORMA).output });
            tf.tidy(function () { forma.predict(tf.zeros([1, 224, 224, 3])); });
            return { det: det, forma: forma };
        })();
        carga.catch(function () { carga = null; });
        return carga;
    }

    // Empieza a descargar los modelos sin esperar (al abrir la captura).
    function precargar() {
        cargar().catch(function () { /* se reintenta al comparar */ });
    }

    function conLimite(promesa, ms) {
        return Promise.race([promesa, new Promise(function (_, mal) { setTimeout(function () { mal(new Error('tiempo')); }, ms); })]);
    }

    // ---------- análisis de una foto ----------

    function cargarImagen(url) {
        return new Promise(function (ok, mal) {
            var img = new Image();
            if (!/^(blob|data):/.test(url)) img.crossOrigin = 'anonymous';
            img.onload = function () { ok(img); };
            img.onerror = function () { mal(new Error('No se pudo leer la foto')); };
            img.src = url;
        });
    }

    async function imagen(url) {
        try { return await cargarImagen(url); }
        catch (_) {
            // Copia en caché sin permiso de lectura: se pide otra vez.
            if (/^(blob|data):/.test(url)) throw _;
            return cargarImagen(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'cmp=1');
        }
    }

    function lienzo(img, max) {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return c;
    }

    // El objeto que corresponde al item: el más seguro y grande.
    function elegir(dets, clases, W, H) {
        if (!clases) return null;
        var mejor = null, val = 0;
        dets.forEach(function (d) {
            if (clases.indexOf(d.class) < 0) return;
            var area = (d.bbox[2] * d.bbox[3]) / (W * H);
            var v = d.score * (0.5 + 0.5 * Math.sqrt(area));
            if (v > val) { val = v; mejor = d; }
        });
        return mejor;
    }

    function ampliar(b, W, H, m) {
        var x = Math.max(0, b[0] - b[2] * m), y = Math.max(0, b[1] - b[3] * m);
        var x2 = Math.min(W, b[0] + b[2] * (1 + m)), y2 = Math.min(H, b[1] + b[3] * (1 + m));
        return { x: x, y: y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
    }

    // Sin objeto reconocido: la foto completa (sin el 5 % de las orillas).
    function centro(W, H) {
        return { x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 };
    }

    // Recorte cuadrado de 224 px con relleno gris (sin deformar el objeto).
    function recorte(c, b, S) {
        var t = document.createElement('canvas');
        t.width = S; t.height = S;
        var g = t.getContext('2d');
        g.fillStyle = '#808080';
        g.fillRect(0, 0, S, S);
        var s = S / Math.max(b.w, b.h);
        var w = b.w * s, h = b.h * s;
        g.drawImage(c, b.x, b.y, b.w, b.h, (S - w) / 2, (S - h) / 2, w, h);
        return t;
    }

    // Vector de forma (MobileNet), promedio con su espejo y normalizado.
    function vectorForma(modelo, canvas) {
        var tf = window.tf;
        return tf.tidy(function () {
            var x = tf.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims(0);
            var xs = tf.concat([x, x.reverse(2)], 0);
            var f = modelo.predict(xs).mean([1, 2]).mean(0);
            return f.div(f.norm().add(1e-8)).dataSync().slice();
        });
    }

    // Histograma de color (12 tonos × 2 saturaciones + negro/gris/blanco),
    // con más peso al centro del recorte, donde está el objeto.
    function histograma(c, b) {
        var S = 64;
        var t = document.createElement('canvas');
        t.width = S; t.height = S;
        var g = t.getContext('2d', { willReadFrequently: true });
        g.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, S, S);
        var d = g.getImageData(0, 0, S, S).data;
        var bins = new Float32Array(27), tot = 0;
        for (var y = 0; y < S; y++) {
            for (var x = 0; x < S; x++) {
                var i = (y * S + x) * 4;
                var r = d[i] / 255, gr = d[i + 1] / 255, bl = d[i + 2] / 255;
                var mx = Math.max(r, gr, bl), mn = Math.min(r, gr, bl), v = mx, s = mx ? (mx - mn) / mx : 0;
                var dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5;
                var w = Math.exp(-(dx * dx + dy * dy) / 0.18);
                if (s < 0.2 || v < 0.18) {
                    bins[24 + (v < 0.3 ? 0 : v < 0.72 ? 1 : 2)] += w;
                } else {
                    var hh;
                    if (mx === r) hh = ((gr - bl) / (mx - mn)) % 6;
                    else if (mx === gr) hh = (bl - r) / (mx - mn) + 2;
                    else hh = (r - gr) / (mx - mn) + 4;
                    hh = ((hh * 60) + 360) % 360;
                    // Reparto suave entre los dos tonos vecinos.
                    var p = hh / 30 - 0.5, k0 = Math.floor(p), f = p - k0;
                    var sat = s < 0.5 ? 0 : 1;
                    bins[(((k0 % 12) + 12) % 12) * 2 + sat] += w * (1 - f);
                    bins[((((k0 + 1) % 12) + 12) % 12) * 2 + sat] += w * f;
                }
                tot += w;
            }
        }
        for (var j = 0; j < 27; j++) bins[j] /= tot || 1;
        return bins;
    }

    async function describir(m, url, clases) {
        var img = await imagen(url);
        var c = lienzo(img, 640);
        var dets = await m.det.detect(c, 20, 0.2);
        var obj = elegir(dets, clases, c.width, c.height);
        var b = obj ? ampliar(obj.bbox, c.width, c.height, 0.08) : centro(c.width, c.height);
        return {
            w: c.width, h: c.height,
            caja: obj ? { x: obj.bbox[0], y: obj.bbox[1], w: obj.bbox[2], h: obj.bbox[3] } : null,
            clase: obj ? obj.class : '',
            forma: vectorForma(m.forma, recorte(c, b, 224)),
            color: histograma(c, b)
        };
    }

    function comparar(a, b) {
        var cos = 0, hi = 0, i;
        for (i = 0; i < a.forma.length; i++) cos += a.forma[i] * b.forma[i];
        for (i = 0; i < a.color.length; i++) hi += Math.min(a.color[i], b.color[i]);
        var forma = clamp((cos - FORMA_0) / (FORMA_1 - FORMA_0));
        var color = clamp((hi - COLOR_0) / (COLOR_1 - COLOR_0));
        var score = PESO_FORMA * forma + (1 - PESO_FORMA) * color;
        // Misma forma pero otro color (mochila negra vs. roja): casi seguro es otro.
        if (color < 0.3) score *= 0.6;
        var otroObjeto = false;
        if (a.clase && b.clase && a.clase !== b.clase) {
            var grupo = GRUPOS.some(function (g) { return g.indexOf(a.clase) >= 0 && g.indexOf(b.clase) >= 0; });
            score *= grupo ? 0.85 : 0.5;
            otroObjeto = !grupo;
        }
        return { score: clamp(score), forma: forma, color: color, cos: cos, hi: hi, otroObjeto: otroObjeto };
    }

    // miUrl: tu foto (blob: o URL); candidatos: filas de buscar().
    // op = { etiqueta, item, progreso(fase, i, n) } · null si no se pudo.
    async function analizar(miUrl, candidatos, op) {
        op = op || {};
        var progreso = op.progreso || function () { };
        var clases = clasesDe(op.etiqueta, op.item);
        var inicio = Date.now();
        progreso(carga ? 'mia' : 'cargando');
        var m = await conLimite(cargar(), LIMITE_MS);
        progreso('mia');
        var mia = await describir(m, miUrl, clases);
        var conFoto = candidatos.filter(function (h) { return h.evidencia_url; }).slice(0, MAX_ANALIZAR);
        var res = { mia: mia, por: {} };
        for (var i = 0; i < conFoto.length; i++) {
            if (Date.now() - inicio > LIMITE_MS) break;
            progreso('cand', i + 1, conFoto.length);
            var h = conFoto[i];
            try {
                var clave = h.evidencia_url + '|' + (clases ? clases.join(',') : '');
                var d = memo[clave] || (memo[clave] = await describir(m, h.evidencia_url, clases));
                res.por[h.id] = Object.assign({ d: d }, comparar(mia, d));
            } catch (_) {
                res.por[h.id] = { error: true };
            }
        }
        return res;
    }

    function nivel(score) {
        if (score >= UMBRAL_ALTO) return { k: 'ok', t: 'Muy probable' };
        if (score >= UMBRAL_BAJO) return { k: 'mid', t: 'Posible' };
        return { k: 'low', t: 'Poco probable' };
    }

    // ---------- vista ----------

    function estilos() {
        if (document.getElementById('setp-cmp-styles')) return;
        var st = document.createElement('style');
        st.id = 'setp-cmp-styles';
        var D = 'body.dark-mode ';
        st.textContent = [
            '.scmp{border:1px solid #fcd34d;background:#fffbeb;border-radius:14px;padding:12px;}',
            '.scmp-h{display:flex;gap:8px;align-items:flex-start;font-size:.86rem;color:#92400e;font-weight:700;line-height:1.35;}',
            '.scmp-h small{display:block;font-weight:400;color:#78716c;font-size:.74rem;margin-top:2px;}',
            '.scmp-estado{font-size:.75rem;color:#64748b;margin:8px 0 10px;display:flex;gap:6px;align-items:flex-start;line-height:1.4;}',
            '.scmp-estado > i,.scmp-estado > .spinner-border{flex:none;margin-top:2px;}',
            '.scmp-estado .fa-lock{color:#059669;}',
            '.scmp-estado.is-error{color:#b45309;}',
            '.scmp-lbl{font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:4px;}',
            '.scmp-mia{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:start;margin-bottom:10px;}',
            '.scmp-foto{position:relative;width:100%;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:#1f2937;border:1px solid #e2e8f0;}',
            '.scmp-foto img{width:100%;height:100%;object-fit:contain;display:block;}',
            '.scmp-foto .scmp-sin{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.75rem;color:#cbd5e1;}',
            '.scmp-caja{position:absolute;border:2px dashed #4ade80;border-radius:5px;pointer-events:none;}',
            '.scmp-caja span{position:absolute;left:-2px;top:-2px;transform:translateY(-100%);background:#4ade80;color:#052e16;font-size:.62rem;font-weight:800;padding:0 5px;border-radius:4px 4px 0 0;white-space:nowrap;line-height:1.5;}',
            '.scmp-caja.is-low{border-color:#94a3b8;}.scmp-caja.is-low span{background:#94a3b8;color:#0f172a;}',
            '.scmp-tit{font-size:.82rem;font-weight:700;color:#0f172a;overflow-wrap:anywhere;}',
            '.scmp-sub{font-size:.74rem;color:#64748b;overflow-wrap:anywhere;}',
            '.scmp-lista{display:flex;flex-direction:column;gap:8px;}',
            '.scmp-cand{display:grid;grid-template-columns:150px 1fr;gap:10px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:8px;}',
            '.scmp-cand.is-top{border-color:#22c55e;box-shadow:inset 0 0 0 1px rgba(34,197,94,.35);}',
            '.scmp-cand.is-low{opacity:.6;}',
            '.scmp-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
            '.scmp-folio{font-size:.68rem;font-weight:700;letter-spacing:.04em;color:#64748b;text-transform:uppercase;}',
            '.scmp-pct{margin-left:auto;font-size:.74rem;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap;}',
            '.scmp-pct.is-ok{background:#dcfce7;color:#15803d;}.scmp-pct.is-mid{background:#fef3c7;color:#b45309;}.scmp-pct.is-low{background:#f1f5f9;color:#64748b;}.scmp-pct.is-na{background:#f1f5f9;color:#94a3b8;font-weight:600;}',
            '.scmp-bar{height:5px;border-radius:99px;background:#e2e8f0;margin:5px 0 4px;overflow:hidden;}',
            '.scmp-bar i{display:block;height:100%;border-radius:99px;}',
            '.scmp-bar i.is-ok{background:#22c55e;}.scmp-bar i.is-mid{background:#f59e0b;}.scmp-bar i.is-low{background:#94a3b8;}',
            '.scmp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}',
            '.scmp-chip{font-size:.68rem;font-weight:600;padding:1px 7px;border-radius:999px;background:#f1f5f9;color:#475569;}',
            '.scmp-chip.is-si{background:#dcfce7;color:#166534;}.scmp-chip.is-no{background:#fee2e2;color:#b91c1c;}',
            '.scmp-cand .btn{width:100%;margin-top:7px;}',
            '.scmp-menos{border-top:1px dashed #e2e8f0;padding-top:6px;}',
            '.scmp-menos summary{cursor:pointer;font-size:.76rem;color:#64748b;list-style:none;padding:2px 0;}',
            '.scmp-menos summary::-webkit-details-marker{display:none;}',
            '.scmp-menos summary i{transition:transform .15s;margin-right:4px;}',
            '.scmp-menos[open] summary i{transform:rotate(90deg);}',
            '.scmp-menos .scmp-lista{margin-top:6px;}',
            '.scmp-info{font-size:.76rem;margin-top:10px;color:#334155;}',
            '.scmp-btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}',
            '.scmp-btns .btn{flex:1 1 160px;}',
            '.scmp-spin{width:12px;height:12px;border-width:2px;}',
            '@media (max-width:520px){.scmp-mia,.scmp-cand{grid-template-columns:1fr;}}',
            // Modo oscuro
            D + '.scmp{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.45);}',
            D + '.scmp-h{color:#fcd34d;}',
            D + '.scmp-h small,' + D + '.scmp-estado,' + D + '.scmp-lbl,' + D + '.scmp-sub,' + D + '.scmp-folio,' + D + '.scmp-menos summary{color:var(--text-muted-color,#9aa7bb);}',
            D + '.scmp-estado.is-error{color:#fcd34d;}',
            D + '.scmp-tit,' + D + '.scmp-info{color:var(--text-color,#e7ecf3);}',
            D + '.scmp-foto{border-color:var(--border-color,#334158);}',
            D + '.scmp-cand{background:rgba(15,23,42,.55);border-color:var(--border-color,#334158);}',
            D + '.scmp-cand.is-top{border-color:#22c55e;}',
            D + '.scmp-bar{background:#334158;}',
            D + '.scmp-pct.is-ok{background:rgba(34,197,94,.15);color:#4ade80;}' + D + '.scmp-pct.is-mid{background:rgba(245,158,11,.15);color:#fbbf24;}' +
                D + '.scmp-pct.is-low,' + D + '.scmp-pct.is-na{background:rgba(148,163,184,.15);color:#b4bccb;}',
            D + '.scmp-chip{background:rgba(148,163,184,.15);color:#c9d3e2;}' + D + '.scmp-chip.is-si{background:rgba(34,197,94,.13);color:#7ee2a2;}' + D + '.scmp-chip.is-no{background:rgba(239,68,68,.13);color:#fca5a5;}',
            D + '.scmp-menos{border-color:var(--border-color,#334158);}'
        ].join('');
        document.head.appendChild(st);
    }

    // Foto con el recuadro del objeto (posición sobre la imagen "contain" 4:3).
    function foto(url, d, low) {
        if (!url) return '<div class="scmp-foto"><div class="scmp-sin">Sin foto</div></div>';
        var caja = '';
        if (d && d.caja) {
            var A = 4 / 3, r = d.w / d.h;
            var fw = Math.min(1, r / A), fh = Math.min(1, A / r);
            var ox = (1 - fw) / 2, oy = (1 - fh) / 2;
            var pct = function (v) { return (v * 100).toFixed(2) + '%'; };
            caja = '<div class="scmp-caja' + (low ? ' is-low' : '') + '" style="left:' + pct(ox + fw * d.caja.x / d.w) + ';top:' + pct(oy + fh * d.caja.y / d.h) +
                ';width:' + pct(fw * d.caja.w / d.w) + ';height:' + pct(fh * d.caja.h / d.h) + '"><span>' + esc(NOMBRE_CLASE[d.clase] || 'Objeto') + '</span></div>';
        }
        return '<div class="scmp-foto"><img src="' + esc(url) + '" alt="Foto del hallazgo" loading="lazy">' + caja + '</div>';
    }

    function chip(t, k) {
        var ic = k === 'si' ? '<i class="fas fa-check"></i> ' : k === 'no' ? '<i class="fas fa-xmark"></i> ' : '';
        return '<span class="scmp-chip' + (k ? ' is-' + k : '') + '">' + ic + esc(t) + '</span>';
    }

    function motivos(r) {
        var out = [];
        if (r.otroObjeto) out.push(chip('Otro tipo de objeto', 'no'));
        else out.push(r.forma >= 0.6 ? chip('Misma forma', 'si') : r.forma >= 0.35 ? chip('Forma parecida', '') : chip('Otra forma', 'no'));
        out.push(r.color >= 0.6 ? chip('Mismo color', 'si') : r.color >= 0.35 ? chip('Color parecido', '') : chip('Otro color', 'no'));
        if (r.d && !r.d.caja) out.push(chip('Foto completa', ''));
        return out;
    }

    function fechaHora(ts) {
        var d = ts ? new Date(ts) : null;
        if (!d || isNaN(d)) return '';
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
            d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function estadoHtml(v) {
        if (v.fase === 'cargando') return '<div class="scmp-estado"><span class="spinner-border scmp-spin"></span>Preparando la comparación de fotos (la primera vez tarda unos segundos)…</div>';
        if (v.fase === 'mia') return '<div class="scmp-estado"><span class="spinner-border scmp-spin"></span>Buscando el objeto en tu foto…</div>';
        if (v.fase === 'cand') return '<div class="scmp-estado"><span class="spinner-border scmp-spin"></span>Comparando forma y color · ' + v.i + ' de ' + v.n + '…</div>';
        if (v.fase === 'error') return '<div class="scmp-estado is-error"><i class="fas fa-circle-exclamation"></i>No se pudieron comparar las fotos automáticamente (sin conexión o equipo sin soporte). Compáralas tú.</div>';
        return '<div class="scmp-estado"><i class="fas fa-lock"></i>Comparación hecha en tu equipo; las fotos no se envían a ningún servicio. El % es una ayuda: la decisión es tuya.</div>';
    }

    // v = { q, lista, mia:{url,tit,sub}, nombre(no_empleado), fase, i, n, res }
    function html(v) {
        var c = cat();
        var etq = c && c.etiqueta(v.q.etiqueta);
        var mov = c ? c.esMovible(v.q.etiqueta, v.q.item) : false;
        var res = v.fase === 'listo' ? v.res : null;
        var por = res ? res.por : {};
        var lista = v.lista.slice();
        if (res) {
            lista.sort(function (a, b) {
                var ra = por[a.id], rb = por[b.id];
                var sa = ra && !ra.error ? ra.score : -1, sb = rb && !rb.error ? rb.score : -1;
                return sb - sa;
            });
        }
        var mejor = res && lista.length && por[lista[0].id] && !por[lista[0].id].error ? por[lista[0].id].score : -1;
        var altos = res ? lista.filter(function (h) { var r = por[h.id]; return r && !r.error && r.score >= UMBRAL_ALTO; }).length : 0;
        var medios = res ? lista.filter(function (h) { var r = por[h.id]; return r && !r.error && r.score >= UMBRAL_BAJO; }).length : 0;
        var principal = [], bajos = [];
        lista.forEach(function (h) {
            var r = por[h.id];
            if (res && r && !r.error && r.score < UMBRAL_BAJO) bajos.push(h); else principal.push(h);
        });
        var n = v.lista.length;
        var titulo;
        if (!res) titulo = n === 1 ? 'Ya hay un hallazgo pendiente igual' : 'Ya hay ' + n + ' hallazgos pendientes iguales';
        else if (altos) titulo = altos === 1 ? 'Encontramos 1 hallazgo muy parecido a tu foto' : 'Encontramos ' + altos + ' hallazgos muy parecidos a tu foto';
        else if (medios) titulo = medios === 1 ? 'Hay 1 hallazgo que podría ser el mismo' : 'Hay ' + medios + ' hallazgos que podrían ser el mismo';
        else titulo = 'Ningún hallazgo pendiente se parece a tu foto';
        var donde = mov ? 'edificio terminal (todos los niveles) · últimas ' + MOVIBLE_HORAS + ' h' : 'mismo nivel · mismo local o módulo';
        var cand = function (h) {
            var r = por[h.id];
            var ok = r && !r.error;
            var nv = ok ? nivel(r.score) : null;
            var lg = lugar(v.q, h);
            var top = ok && r.score === mejor && r.score >= UMBRAL_BAJO;
            var cls = 'scmp-cand' + (top ? ' is-top' : '') + (ok && r.score < UMBRAL_BAJO ? ' is-low' : '');
            var pct = ok ? '<span class="scmp-pct is-' + nv.k + '">' + nv.t + ' · ' + Math.round(r.score * 100) + ' %</span>'
                : res ? '<span class="scmp-pct is-na">Sin comparar</span>' : '';
            var chips = (ok ? motivos(r) : []).concat([chip(lg.t, lg.k)]);
            if (h.veces > 1) chips.push(chip('Reportado ' + h.veces + ' veces', ''));
            // Botón amarillo: sin análisis (todos) o en el más probable.
            var fuerte = !res || !ok ? !res : top;
            return '<div class="' + cls + '">' + foto(h.evidencia_url, ok ? r.d : null, ok && r.score < UMBRAL_BAJO) +
                '<div><div class="scmp-row"><span class="scmp-folio">' + esc(h.folio || 'Registrado') + ' · pendiente</span>' + pct + '</div>' +
                (ok ? '<div class="scmp-bar"><i class="is-' + nv.k + '" style="width:' + Math.max(3, Math.round(r.score * 100)) + '%"></i></div>' : '') +
                '<div class="scmp-tit">' + esc(h.descripcion) + '</div>' +
                '<div class="scmp-sub">' + esc([h.nivel, h.modulo, h.local].filter(Boolean).join(' · ')) + '</div>' +
                '<div class="scmp-sub">' + esc([v.nombre ? v.nombre(h.no_empleado) : h.no_empleado, fechaHora(h.created_at) || h.fecha_reporte].filter(Boolean).join(' · ')) + '</div>' +
                '<div class="scmp-chips">' + chips.join('') + '</div>' +
                '<button type="button" class="btn btn-sm ' + (fuerte ? 'btn-warning' : 'btn-outline-warning') + '" data-dup-mismo="' + esc(h.id) + '" data-dup-folio="' + esc(h.folio || '') + '">' +
                '<i class="fas fa-link me-1"></i>Es el mismo · agregar mi foto</button></div></div>';
        };
        var bajosHtml = '';
        if (bajos.length) {
            var maxBajo = Math.round(Math.max.apply(null, bajos.map(function (h) { return por[h.id].score; })) * 100);
            bajosHtml = '<details class="scmp-menos"' + (principal.length ? '' : ' open') + '><summary><i class="fas fa-chevron-right"></i>' +
                (bajos.length === 1 ? '1 poco parecido' : bajos.length + ' poco parecidos') + ' (' + maxBajo + ' % o menos) · ver</summary>' +
                '<div class="scmp-lista">' + bajos.map(cand).join('') + '</div></details>';
        }
        return '<div class="scmp">' +
            '<div class="scmp-h"><i class="fas fa-triangle-exclamation mt-1"></i><div>' + esc(titulo) +
            '<small>' + esc((etq ? etq.nombre : '') + ' › ' + v.q.item) + ' · ' + esc(donde) + ' · ' + n + (n === 1 ? ' revisado' : ' revisados') + '</small></div></div>' +
            estadoHtml(v) +
            '<div class="scmp-lbl">Tu foto · ahora</div>' +
            '<div class="scmp-mia">' + foto(v.mia.url, res ? res.mia : null) +
            '<div><div class="scmp-tit">' + esc(v.mia.tit) + '</div><div class="scmp-sub">' + esc(v.mia.sub) + '</div></div></div>' +
            '<div class="scmp-lbl">' + (res ? 'Hallazgos pendientes · del más al menos parecido' : 'Hallazgos pendientes') + '</div>' +
            '<div class="scmp-lista">' + principal.map(cand).join('') + bajosHtml + '</div>' +
            '<div class="scmp-info"><i class="fas fa-circle-info me-1"></i>Compara las fotos. Si es el mismo, tu foto se agrega a ese hallazgo y no se crea otro.</div>' +
            '<div class="scmp-btns"><button type="button" class="btn btn-outline-secondary btn-sm" data-dup="volver"><i class="fas fa-arrow-left me-1"></i>Regresar</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-dup="otro"><i class="fas fa-plus me-1"></i>Es otro hallazgo</button></div></div>';
    }

    // Pinta la vista en `el` y compara las fotos; vuelve a pintar al avanzar.
    // sigue(): false si la vista ya se cerró (no se pinta más).
    // v = { q, lista, mia:{url,tit,sub}, nombre, sigue }
    function pintar(el, v) {
        estilos();
        var sigue = v.sigue || function () { return true; };
        var poner = function (cambios) {
            if (!sigue()) return;
            Object.assign(v, cambios);
            var foco = document.activeElement && el.contains(document.activeElement) ? document.activeElement.getAttribute('data-dup-mismo') || document.activeElement.getAttribute('data-dup') : null;
            var abierto = el.querySelector('details.scmp-menos[open]');
            el.innerHTML = html(v);
            if (abierto) { var dt = el.querySelector('details.scmp-menos'); if (dt) dt.open = true; }
            var f = foco && (el.querySelector('[data-dup-mismo="' + foco + '"]') || el.querySelector('[data-dup="' + foco + '"]'));
            if (f) f.focus({ preventScroll: true });
        };
        poner({ fase: v.lista.some(function (h) { return h.evidencia_url; }) ? (carga ? 'mia' : 'cargando') : 'error' });
        var b = el.querySelector('[data-dup-mismo]');
        if (b) b.focus();
        if (v.fase === 'error') return;
        analizar(v.mia.url, v.lista, {
            etiqueta: v.q.etiqueta, item: v.q.item,
            progreso: function (fase, i, n) { poner({ fase: fase, i: i, n: n }); }
        }).then(function (res) {
            poner({ fase: 'listo', res: res });
            if (!sigue()) return;
            var top = el.querySelector('.scmp-cand.is-top [data-dup-mismo]') || el.querySelector('[data-dup="otro"]');
            if (top && (!document.activeElement || !el.contains(document.activeElement) || document.activeElement.hasAttribute('data-dup-mismo'))) top.focus({ preventScroll: true });
        }).catch(function () {
            poner({ fase: 'error' });
        });
    }

    // ---------- ventana propia (Agregar hallazgo) ----------

    var MODAL_ID = 'setp-cmp-modal';

    function ventana() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        var st = document.createElement('style');
        st.id = 'setp-cmp-modal-styles';
        var M = '#' + MODAL_ID;
        st.textContent = [
            M + '{position:fixed;inset:0;z-index:1090;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}',
            M + '[hidden]{display:none;}',
            M + ' .scmp-card{width:100%;max-width:600px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);overflow:hidden;}',
            M + ' .scmp-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #e2e8f0;flex:none;}',
            M + ' .scmp-icon{width:40px;height:40px;border-radius:12px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;flex:none;}',
            M + ' .scmp-kicker{font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;}',
            M + ' .scmp-title{font-size:1.05rem;font-weight:800;color:#0f172a;margin:0;}',
            M + ' .scmp-head .btn-close{margin-left:auto;}',
            M + ' .scmp-body{padding:14px 18px;overflow-y:auto;flex:1 1 auto;min-height:0;}',
            'body.dark-mode ' + M + '{background:rgba(0,0,0,.55);}',
            'body.dark-mode ' + M + ' .scmp-card{background:rgba(30,39,57,.98);border-color:var(--border-color,#334158);color:var(--text-color,#e7ecf3);}',
            'body.dark-mode ' + M + ' .scmp-head{border-color:var(--border-color,#334158);}',
            'body.dark-mode ' + M + ' .scmp-icon{background:rgba(77,171,247,.14);color:var(--primary-color,#4dabf7);}',
            'body.dark-mode ' + M + ' .scmp-kicker{color:var(--text-muted-color,#9aa7bb);}',
            'body.dark-mode ' + M + ' .scmp-title{color:var(--text-color,#e7ecf3);}',
            'body.dark-mode ' + M + ' .btn-close{filter:invert(1) grayscale(100%) brightness(2);}'
        ].join('');
        document.head.appendChild(st);
        var w = document.createElement('div');
        w.innerHTML = '<div id="' + MODAL_ID + '" role="dialog" aria-modal="true" aria-labelledby="setp-cmp-title" hidden><div class="scmp-card">' +
            '<div class="scmp-head"><div class="scmp-icon"><i class="fas fa-magnifying-glass"></i></div>' +
            '<div><div class="scmp-kicker">Reporte de hallazgos</div><h3 class="scmp-title" id="setp-cmp-title">¿Es el mismo hallazgo?</h3></div>' +
            '<button type="button" class="btn-close" data-dup="volver" aria-label="Cerrar"></button></div>' +
            '<div class="scmp-body" id="setp-cmp-body"></div></div></div>';
        m = w.firstChild;
        document.body.appendChild(m);
        return m;
    }

    // Busca hallazgos iguales y, si hay, pregunta. Resuelve con
    // { accion: 'otro' } (no hay o es otro), { accion: 'volver' } o
    // { accion: 'mismo', id, folio }.
    async function preguntar(op) {
        var lista = [];
        try { lista = await buscar(op.sb, op.q); } catch (_) { lista = []; }
        if (!lista.length) return { accion: 'otro' };
        var m = ventana();
        var body = document.getElementById('setp-cmp-body');
        var abierta = true;
        var url = op.foto instanceof Blob ? URL.createObjectURL(op.foto) : op.foto;
        return new Promise(function (resolver) {
            var cerrar = function (r) {
                if (!abierta) return;
                abierta = false;
                m.hidden = true;
                document.body.style.overflow = '';
                m.removeEventListener('click', clic);
                m.removeEventListener('keydown', tecla);
                body.innerHTML = '';
                if (op.foto instanceof Blob) setTimeout(function () { URL.revokeObjectURL(url); }, 0);
                resolver(r);
            };
            var clic = function (e) {
                var b;
                if (e.target === m) return cerrar({ accion: 'volver' });
                if ((b = e.target.closest('[data-dup-mismo]'))) return cerrar({ accion: 'mismo', id: b.getAttribute('data-dup-mismo'), folio: b.getAttribute('data-dup-folio') || '' });
                if (e.target.closest('[data-dup="otro"]')) return cerrar({ accion: 'otro' });
                if (e.target.closest('[data-dup="volver"]')) return cerrar({ accion: 'volver' });
            };
            var tecla = function (e) {
                if (e.key === 'Escape') { e.preventDefault(); cerrar({ accion: 'volver' }); }
                else if (e.key === 'Tab') {
                    var f = Array.prototype.filter.call(m.querySelectorAll('button, summary'), function (x) { return x.offsetParent !== null; });
                    if (!f.length) return;
                    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
                    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
                }
            };
            m.addEventListener('click', clic);
            m.addEventListener('keydown', tecla);
            m.hidden = false;
            document.body.style.overflow = 'hidden';
            pintar(body, { q: op.q, lista: lista, mia: { url: url, tit: op.tit || '', sub: op.sub || '' }, nombre: op.nombre, sigue: function () { return abierta; } });
        });
    }

    window.setpComparar = {
        buscar: buscar,
        precargar: precargar,
        analizar: analizar,
        pintar: pintar,
        preguntar: preguntar,
        UMBRAL_BAJO: UMBRAL_BAJO,
        UMBRAL_ALTO: UMBRAL_ALTO,
        MOVIBLE_HORAS: MOVIBLE_HORAS,
        // Para pruebas de calibración.
        _medir: async function (urlA, urlB, etiqueta, item) {
            var m = await cargar();
            var cl = clasesDe(etiqueta, item);
            var a = await describir(m, urlA, cl), b = await describir(m, urlB, cl);
            return Object.assign({ claseA: a.clase, claseB: b.clase }, comparar(a, b));
        }
    };
})();
