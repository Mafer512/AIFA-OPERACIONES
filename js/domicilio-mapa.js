(function (root) {
    'use strict';

    /* Domicilio desde el mapa (portal del QR, colaborador-registro.html).

       El colaborador marca su casa —tocando el mapa, buscando la dirección o con
       "Usar mi ubicación"— y se llenan calle, número, colonia, código postal,
       municipio y estado. Todo queda editable: el mapa casi nunca sabe el número
       exterior y a veces no trae la colonia, así que se dice qué falta.

       Mapa y direcciones son de OpenStreetMap (Leaflet + Nominatim), igual que el
       plano interactivo: gratis y sin llave. Nominatim pide no buscar mientras
       se teclea y no más de una consulta por segundo; por eso la búsqueda va con
       Enter / botón y las consultas se espacian. Leaflet se descarga hasta que
       alguien abre el mapa. */

    if (!root || !root.document) return;
    const doc = root.document;

    const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    const NOMINATIM = 'https://nominatim.openstreetmap.org';
    const AIFA = [19.7425, -99.0150];

    const CSS = `
.dm-abrir{display:inline-flex;align-items:center;gap:.45rem;padding:.55rem .9rem;border-radius:11px;border:1px solid var(--accent,#1a73e8);
  background:#fff;color:var(--accent-dark,#0b57c9);font-weight:700;font-size:.88rem;cursor:pointer;transition:background .15s}
.dm-abrir:hover{background:#eef4ff}
.dm-abrir svg{width:1.05rem;height:1.05rem}
.dm-ayuda{font-size:.8rem;color:var(--muted,#6b7d95)}
.dm-panel{margin-top:.8rem;border:1px solid #dbe5f3;border-radius:14px;background:#fff;overflow:hidden}
.dm-barra{display:flex;flex-wrap:wrap;gap:.5rem;padding:.65rem;border-bottom:1px solid #eef3fa;background:#f7faff}
.dm-buscar{display:flex;flex:1 1 260px;gap:.4rem;min-width:0}
.dm-barra input{flex:1;min-width:0;min-height:40px;border:1px solid #d6e1f0;border-radius:10px;padding:.4rem .7rem;font-size:.9rem;background:#fff}
.dm-barra input:focus{outline:0;border-color:var(--accent,#1a73e8);box-shadow:0 0 0 3px rgba(26,115,232,.14)}
.dm-btn{display:inline-flex;align-items:center;gap:.35rem;min-height:40px;padding:0 .8rem;border-radius:10px;border:1px solid #d6e1f0;
  background:#fff;color:var(--ink-soft,#3d5470);font-weight:600;font-size:.85rem;cursor:pointer;white-space:nowrap}
.dm-btn:hover{border-color:var(--accent,#1a73e8);color:var(--accent-dark,#0b57c9)}
.dm-btn.dm-prim{background:var(--accent,#1a73e8);border-color:var(--accent,#1a73e8);color:#fff}
.dm-btn svg{width:1rem;height:1rem}
.dm-resultados{display:flex;flex-direction:column;border-bottom:1px solid #eef3fa;max-height:180px;overflow:auto}
.dm-resultados button{text-align:left;padding:.55rem .8rem;border:0;border-top:1px solid #f1f5fb;background:#fff;font-size:.85rem;color:var(--ink,#10233f);cursor:pointer}
.dm-resultados button:hover{background:#eef4ff}
.dm-mapa{height:320px;background:#e9eef5}
.dm-estado{padding:.6rem .8rem;font-size:.84rem;line-height:1.4;color:var(--ink-soft,#3d5470);border-top:1px solid #eef3fa}
.dm-estado.ok{color:#0f6b43;background:#effaf4}
.dm-estado.warn{color:#7a4f00;background:#fff8ea}
.dm-pin{width:34px;height:44px;margin:-44px 0 0 -17px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))}
.dm-llenado{animation:dm-flash 1.6s ease-out}
@keyframes dm-flash{0%{box-shadow:0 0 0 4px rgba(15,138,83,.35);border-color:#0f8a53}100%{box-shadow:none}}
@media (max-width:575px){.dm-mapa{height:280px}}
`;

    const ICONO_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
    const ICONO_GPS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>';
    const PIN_MAPA = '<svg class="dm-pin" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 43s15-14.2 15-26A15 15 0 0 0 2 17c0 11.8 15 26 15 26Z" fill="#1a73e8" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="5.5" fill="#fff"/></svg>';

    let leafletPromesa = null;
    function cargarLeaflet() {
        if (root.L && root.L.map) return Promise.resolve(root.L);
        if (leafletPromesa) return leafletPromesa;
        leafletPromesa = new Promise((resolve, reject) => {
            if (!doc.querySelector('link[href="' + LEAFLET_CSS + '"]')) {
                const css = doc.createElement('link');
                css.rel = 'stylesheet';
                css.href = LEAFLET_CSS;
                doc.head.appendChild(css);
            }
            const s = doc.createElement('script');
            s.src = LEAFLET_JS;
            s.onload = () => (root.L ? resolve(root.L) : reject(new Error('Leaflet no cargó')));
            s.onerror = () => { leafletPromesa = null; reject(new Error('Leaflet no cargó')); };
            doc.head.appendChild(s);
        });
        return leafletPromesa;
    }

    /* Una consulta por segundo como máximo, como pide Nominatim. */
    let ultimaConsulta = 0;
    async function consultar(ruta, params) {
        const espera = 1100 - (Date.now() - ultimaConsulta);
        if (espera > 0) await new Promise(r => setTimeout(r, espera));
        ultimaConsulta = Date.now();
        const qs = new URLSearchParams(Object.assign({ format: 'jsonv2', addressdetails: '1', 'accept-language': 'es' }, params));
        const r = await fetch(NOMINATIM + ruta + '?' + qs.toString(), { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('El mapa respondió ' + r.status);
        return r.json();
    }

    function estilos() {
        if (doc.getElementById('dm-estilos')) return;
        const st = doc.createElement('style');
        st.id = 'dm-estilos';
        st.textContent = CSS;
        doc.head.appendChild(st);
    }

    const escHtml = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const enLista = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];

    const ETIQUETAS = { calle: 'calle', numero: 'número', colonia: 'colonia', cp: 'código postal', municipio: 'municipio', estado: 'estado' };

    /**
     * opts.contenedor  elemento donde va el botón y el panel
     * opts.campos      { calle, numero, colonia, cp, municipio, estado } → ids de input
     * opts.alLlenar    se llama después de escribir los campos
     */
    function conectar(opts) {
        const cont = opts.contenedor;
        if (!cont || cont.dataset.dmListo) return null;
        cont.dataset.dmListo = '1';
        estilos();
        const campos = Campos();
        const input = k => doc.getElementById(opts.campos[k]);

        // Lo que alguien teclea deja de ser "del mapa": un pin nuevo ya no lo borra.
        Object.keys(opts.campos).forEach(k => {
            const el = input(k);
            if (el) el.addEventListener('input', () => { delete el.dataset.deMapa; });
        });

        cont.innerHTML =
            '<div class="d-flex flex-wrap align-items-center gap-2">'
            + '<button type="button" class="dm-abrir">' + ICONO_PIN + 'Ubicar mi casa en el mapa</button>'
            + '<span class="dm-ayuda">Marca tu casa y llenamos la dirección; tú sólo la revisas.</span></div>'
            + '<div class="dm-panel" hidden>'
            // Sin <form>: este bloque vive dentro del formulario del registro, y un
            // formulario dentro de otro el navegador lo descarta.
            + '<div class="dm-barra"><div class="dm-buscar" role="search"><input type="search" placeholder="Busca tu calle, colonia o C.P." enterkeyhint="search" aria-label="Buscar dirección">'
            + '<button type="button" class="dm-btn dm-prim">Buscar</button></div>'
            + '<button type="button" class="dm-btn dm-gps">' + ICONO_GPS + 'Usar mi ubicación</button></div>'
            + '<div class="dm-resultados" hidden></div>'
            + '<div class="dm-mapa" role="application" aria-label="Mapa: toca tu casa"></div>'
            + '<div class="dm-estado" aria-live="polite">Toca tu casa en el mapa o arrastra el marcador. También puedes buscar la dirección.</div>'
            + '</div>';

        const abrir = cont.querySelector('.dm-abrir');
        const panel = cont.querySelector('.dm-panel');
        const buscarInput = cont.querySelector('.dm-buscar input');
        const buscarBtn = cont.querySelector('.dm-buscar button');
        const resultados = cont.querySelector('.dm-resultados');
        const mapaDiv = cont.querySelector('.dm-mapa');
        const estado = cont.querySelector('.dm-estado');
        const gps = cont.querySelector('.dm-gps');

        let L = null, mapa = null, marcador = null, turno = 0;

        const decir = (texto, cls) => { estado.className = 'dm-estado' + (cls ? ' ' + cls : ''); estado.textContent = texto; };

        function llenar(partes) {
            const llenados = [];
            Object.keys(opts.campos).forEach(k => {
                const el = input(k);
                if (!el) return;
                const v = partes[k] || '';
                if (v) {
                    el.value = v;
                    el.dataset.deMapa = '1';
                    llenados.push(k);
                    el.classList.remove('dm-llenado');
                    void el.offsetWidth;
                    el.classList.add('dm-llenado');
                } else if (el.dataset.deMapa === '1') {
                    // Lo había puesto el pin anterior y aquí no aplica.
                    el.value = '';
                    delete el.dataset.deMapa;
                }
            });
            if (typeof opts.alLlenar === 'function') opts.alLlenar();

            const actuales = {};
            Object.keys(opts.campos).forEach(k => { actuales[k] = (input(k) || {}).value || ''; });
            const faltan = campos ? campos.faltantesDomicilio(actuales) : [];
            // OpenStreetMap a veces trae mal el municipio o la colonia (puede marcar
            // Atenco en un fraccionamiento de Tecámac): se pide revisarlos.
            const revisa = ' Revisa sobre todo la colonia y el municipio: el mapa a veces los trae mal.';
            if (!llenados.length) {
                decir('Ese punto no tiene dirección en el mapa. Acerca el mapa y toca justo tu casa, o captúrala abajo.', 'warn');
            } else if (faltan.length) {
                decir('Listo, llenamos ' + enLista(llenados.map(k => ETIQUETAS[k])) + '. Falta ' + enLista(faltan)
                    + ': escríbelo abajo.' + revisa, 'warn');
                // El cursor va a lo primero que falta (casi siempre el número).
                const clave = { 'calle': 'calle', 'número': 'numero', 'colonia': 'colonia' }[faltan[0]] || 'cp';
                const el = input(clave);
                if (el) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
            } else {
                decir('Listo, llenamos tu domicilio.' + revisa, 'ok');
            }
        }

        function ponerMarcador(lat, lon, zoom) {
            if (!marcador) {
                marcador = L.marker([lat, lon], {
                    draggable: true,
                    icon: L.divIcon({ className: '', html: PIN_MAPA, iconSize: [0, 0] }),
                    keyboard: false,
                }).addTo(mapa);
                marcador.on('dragend', () => { const p = marcador.getLatLng(); ubicar(p.lat, p.lng); });
            } else {
                marcador.setLatLng([lat, lon]);
            }
            mapa.setView([lat, lon], Math.max(zoom || 17, mapa.getZoom()));
        }

        async function ubicar(lat, lon) {
            const mio = ++turno;
            ponerMarcador(lat, lon);
            decir('Buscando la dirección de ese punto…');
            try {
                const r = await consultar('/reverse', { lat: String(lat), lon: String(lon), zoom: '18' });
                if (mio !== turno) return;   // ya marcaron otro punto
                llenar(campos ? campos.domicilioDeMapa(r && r.address) : {});
            } catch (e) {
                if (mio === turno) decir('No pudimos consultar el mapa. Captura tu domicilio abajo.', 'warn');
            }
        }

        async function iniciarMapa() {
            if (mapa) { mapa.invalidateSize(); return; }
            decir('Cargando el mapa…');
            try {
                L = await cargarLeaflet();
            } catch (e) {
                decir('No se pudo cargar el mapa. Revisa tu conexión o captura tu domicilio abajo.', 'warn');
                return;
            }
            mapa = L.map(mapaDiv, { zoomControl: true, attributionControl: true }).setView(AIFA, 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
            }).addTo(mapa);
            mapa.on('click', e => ubicar(e.latlng.lat, e.latlng.lng));
            decir('Toca tu casa en el mapa o arrastra el marcador. También puedes buscar la dirección.');

            // Si ya hay domicilio capturado, el mapa arranca ahí.
            const actual = campos ? campos.componerDomicilio({
                calle: (input('calle') || {}).value, numero: (input('numero') || {}).value,
                colonia: (input('colonia') || {}).value, cp: (input('cp') || {}).value,
                municipio: (input('municipio') || {}).value, estado: (input('estado') || {}).value,
            }) : '';
            if (actual && /\d/.test(actual)) {
                try {
                    const r = await consultar('/search', { q: actual.replace(/\b(No\.|Col\.|C\.P\.)\s*/g, ''), countrycodes: 'mx', limit: '1' });
                    if (r && r[0]) mapa.setView([+r[0].lat, +r[0].lon], 16);
                } catch (_) { /* se queda en el AIFA */ }
            }
        }

        abrir.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) {
                iniciarMapa();
                panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        // Enter busca; sin esto mandaría el formulario del registro completo.
        buscarInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); buscar(); }
        });
        buscarBtn.addEventListener('click', () => buscar());

        async function buscar() {
            const q = buscarInput.value.trim();
            if (!q) return;
            if (!mapa) await iniciarMapa();
            if (!mapa) return;
            decir('Buscando…');
            resultados.hidden = true;
            try {
                const r = await consultar('/search', { q, countrycodes: 'mx', limit: '5' });
                if (!r || !r.length) { decir('No encontramos esa dirección. Prueba con la calle y el municipio, o toca tu casa en el mapa.', 'warn'); return; }
                if (r.length === 1) { elegirResultado(r[0]); return; }
                resultados.innerHTML = r.map((x, i) => '<button type="button" data-i="' + i + '">' + escHtml(x.display_name) + '</button>').join('');
                resultados.hidden = false;
                resultados.querySelectorAll('button').forEach(b => b.addEventListener('click', () => elegirResultado(r[+b.dataset.i])));
                decir('Elige la que corresponde a tu casa.');
            } catch (err) {
                decir('No pudimos buscar en el mapa. Toca tu casa en el mapa o captura tu domicilio abajo.', 'warn');
            }
        }

        function elegirResultado(x) {
            resultados.hidden = true;
            ++turno;
            ponerMarcador(+x.lat, +x.lon, 18);
            llenar(campos ? campos.domicilioDeMapa(x.address) : {});
            if (!(x.address && x.address.house_number)) {
                estado.textContent += ' Si el marcador no quedó justo en tu casa, arrástralo.';
            }
        }

        gps.addEventListener('click', async () => {
            if (!root.navigator || !root.navigator.geolocation) {
                decir('Tu navegador no comparte la ubicación. Toca tu casa en el mapa.', 'warn');
                return;
            }
            if (!mapa) await iniciarMapa();
            if (!mapa) return;
            decir('Pidiendo tu ubicación… (acepta el permiso del navegador)');
            root.navigator.geolocation.getCurrentPosition(
                pos => ubicar(pos.coords.latitude, pos.coords.longitude),
                () => decir('No pudimos obtener tu ubicación. Toca tu casa en el mapa o búscala.', 'warn'),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
            );
        });

        return { llenar, abrir: () => abrir.click() };
    }

    function Campos() { return root.ColaboradoresCampos || null; }

    root.DomicilioMapa = Object.freeze({ conectar });
})(typeof window !== 'undefined' ? window : null);
